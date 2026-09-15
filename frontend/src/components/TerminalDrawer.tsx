import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Terminal } from '@xterm/xterm';
import type { IDisposable } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Zap, Terminal as TerminalIcon, X, Square, ChevronsDownUp, ChevronsUpDown } from 'lucide-react';
import { api, authedFetch } from '../services/api';
import { scanOutputMarkers } from '../services/initialization';
import { notifyTerminalsChanged, TERMINAL_OPEN_EVENT } from '../hooks/useLiveTerminals';
import { clearTerminalPetSnapshot, publishTerminalPetSnapshot } from '../services/terminalPetFeed';
import { extractImageFiles, fileToDownscaledDataUrl } from '../services/imagePaste';
import { BRACKETED_PASTE_END, BRACKETED_PASTE_START, splitInputChunks } from '../services/terminalInput';

export type TerminalMode = 'cmd' | 'script';

export interface TerminalSessionDto {
  id: string;
  projectId: string;
  projectTitle: string;
  mode: TerminalMode;
  title: string;
  cwd: string;
  createdAt: string;
  alive: boolean;
  exitedAt: string | null;
  exitCode: number | null;
  reused?: boolean;
}

export interface OutputMarkerWait {
  afterRevision?: number;
  ready: RegExp[];
  blocked?: RegExp[];
  timeoutMs?: number;
}

export type OutputMarkerResult = 'ready' | 'blocked';

export interface TerminalDrawerHandle {
  create: (mode: TerminalMode, options?: { forceNew?: boolean }) => Promise<TerminalSessionDto>;
  restartIfRunning: (mode: TerminalMode) => Promise<TerminalSessionDto | null>;
  sendInput: (data: string, sessionId?: string) => Promise<void>;
  sendPastedText: (data: string, sessionId?: string) => Promise<void>;
  waitForOutputIdle: (sessionId: string, options?: { afterRevision?: number; quietMs?: number; timeoutMs?: number }) => Promise<number>;
  waitForOutputMarker: (sessionId: string, options: OutputMarkerWait) => Promise<OutputMarkerResult>;
  minimize: () => void;
}

interface Props {
  projectId: string | null;
}

const DEFAULT_HEIGHT = 340;
const MIN_HEIGHT = 160;
const MAX_VIEWPORT_RATIO = 0.85;
const FULLSCREEN_RATIO = 0.94;
const HEIGHT_STORAGE_KEY = 'solodev_terminal_height_px';
const MINIMIZED_STORAGE_PREFIX = 'solodev_terminal_minimized:';

const XTERM_THEME = {
  background: '#0b1120',
  foreground: '#e2e8f0',
  cursor: '#818cf8',
  cursorAccent: '#0b1120',
  selectionBackground: '#334155',
};

// xterm can emit device-attribute replies when it parses capability queries
// from CMD/OpenCode. Those replies are terminal protocol traffic, not user
// input; forwarding them to conhost makes CMD try to execute strings such as
// "^[?1;2c" as commands (especially when a session is reused).
const TERMINAL_QUERY_RESPONSE_RE = /\x1b\[[?>=][0-9;]*c/g;
const ANSI_SEQUENCE_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
const CMD_PROMPT_RE = /(?:^|\r?\n)(?:\([^\r\n)]*\)\s*)?[A-Za-z]:\\[^\r\n>]*>\s*$/;

// Paste tuning: large clipboard drops are split into sequential chunks so the
// ConPTY echo and the HTTP output stream stay fluid instead of one giant blob.
const PASTE_CHUNK_CHARS = 8192;
const PASTE_CHUNK_GAP_MS = 30;
const PASTE_CONFIRM_CHARS = 200 * 1024;
function removeTerminalQueryResponses(data: string): string {
  return data.replace(TERMINAL_QUERY_RESPONSE_RE, '');
}

function clampHeight(px: number): number {
  const max = Math.max(MIN_HEIGHT + 40, Math.floor(window.innerHeight * MAX_VIEWPORT_RATIO));
  return Math.min(Math.max(px, MIN_HEIGHT), max);
}

function loadStoredHeight(): number {
  try {
    const raw = window.localStorage.getItem(HEIGHT_STORAGE_KEY);
    const px = raw ? Number(raw) : NaN;
    if (Number.isFinite(px)) return clampHeight(px);
  } catch {
    /* ignore */
  }
  return DEFAULT_HEIGHT;
}

function persistHeightToStorage(px: number) {
  try {
    window.localStorage.setItem(HEIGHT_STORAGE_KEY, String(clampHeight(px)));
  } catch {
    /* storage unavailable */
  }
}

function persistMinimizedForProject(projectId: string | null, minimized: boolean) {
  if (!projectId) return;
  try {
    window.localStorage.setItem(`${MINIMIZED_STORAGE_PREFIX}${projectId}`, String(minimized));
  } catch {
    /* storage unavailable */
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const t = window.setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

interface TerminalRuntime {
  term: Terminal | null;
  fit: FitAddon | null;
  dataSub: IDisposable | null;
  abort: AbortController | null;
  pumpStopped: boolean;
  inputReady: boolean;
  lastCols: number;
  lastRows: number;
  resizeTimer: number | null;
  outputRevision: number;
  lastOutputAt: number;
  outputTail: string;
}

interface InputQueueItem {
  data: string;
  chunked: boolean;
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface InputQueue {
  pending: string[];
  timer: number | null;
  items: InputQueueItem[];
  processing: boolean;
  cancelled: boolean;
  abort: AbortController;
  activePasteEndPending: boolean;
}

/**
 * Bottom-docked terminal drawer for in-app project consoles.
 * Streams PTY output as NDJSON from the Django backend and renders it with xterm.
 * The drawer edge is draggable to resize (persisted in localStorage).
 */
export const TerminalDrawer = forwardRef<TerminalDrawerHandle, Props>(
  ({ projectId }, ref) => {
    const [sessions, setSessions] = useState<TerminalSessionDto[]>([]);
    const [open, setOpen] = useState<boolean>(false);
    const [heightPx, setHeightPx] = useState<number>(() => loadStoredHeight());
    const [fullscreen, setFullscreen] = useState<boolean>(false);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [loadingCreate, setLoadingCreate] = useState<TerminalMode | null>(null);
    const [activeSize, setActiveSize] = useState<{ cols: number; rows: number } | null>(null);
    const [connState, setConnState] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
    const [terminalReady, setTerminalReady] = useState(false);
    const [terminalError, setTerminalError] = useState<string | null>(null);
    const [pasteProgress, setPasteProgress] = useState<{ sent: number; total: number } | null>(null);
    const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const connStateRef = useRef<'idle' | 'connecting' | 'live' | 'error'>('idle');

    const sessionsRef = useRef<TerminalSessionDto[]>([]);
    const activeIdRef = useRef<string | null>(null);
    const runtimeRef = useRef<TerminalRuntime>({
      term: null,
      fit: null,
      dataSub: null,
      abort: null,
      pumpStopped: true,
      inputReady: false,
      lastCols: 0,
      lastRows: 0,
      resizeTimer: null,
      outputRevision: 0,
      lastOutputAt: 0,
      outputTail: '',
    });

    const containerRef = useRef<HTMLDivElement | null>(null);
    const dragStateRef = useRef<{ startY: number; startH: number } | null>(null);
    // Bumped to cancel an in-flight chunked paste (tab switch / close / new paste).
    const pasteSeqRef = useRef(0);
    const petPublishAtRef = useRef(0);
    const inputQueuesRef = useRef<Map<string, InputQueue>>(new Map());
    const pasteDispatchRef = useRef(false);
    const latestHeightRef = useRef<number>(heightPx);
    const projectIdRef = useRef<string | null>(projectId);
    // Set by a live-consoles pill click that navigates here. The navigation
    // lands after the click, so the [projectId] effect below consumes it.
    const pendingOpenRef = useRef<string | null>(null);

    useEffect(() => {
      sessionsRef.current = sessions;
    }, [sessions]);
    useEffect(() => {
      activeIdRef.current = activeId;
    }, [activeId]);
    useEffect(() => {
      latestHeightRef.current = heightPx;
    }, [heightPx]);
    useEffect(() => {
      if (!open || !activeId) setConnState('idle');
    }, [open, activeId]);
    useEffect(() => {
      projectIdRef.current = projectId;
      // A pill click (requestTerminalOpen) navigates here and explicitly asks
      // for the console. Honor it; any other visit keeps the drawer closed.
      if (projectId && pendingOpenRef.current === projectId) {
        pendingOpenRef.current = null;
        persistMinimizedForProject(projectId, false);
        setOpen(true);
        return;
      }
      // Visiting a project should not expose a console automatically. Opening
      // CMD, running a script, or using the floating terminal control is the
      // explicit user action that expands this drawer.
      setOpen(false);
    }, [projectId]);
    useEffect(() => {
      const onRequestOpen = (e: Event) => {
        const target = (e as CustomEvent<{ projectId?: string }>).detail?.projectId ?? null;
        if (!target) return;
        if (target === projectIdRef.current) {
          persistMinimizedForProject(target, false);
          setOpen(true);
        } else {
          // Navigation to that project hasn't landed yet; the [projectId]
          // effect above opens the drawer on arrival.
          pendingOpenRef.current = target;
        }
      };
      window.addEventListener(TERMINAL_OPEN_EVENT, onRequestOpen);
      return () => window.removeEventListener(TERMINAL_OPEN_EVENT, onRequestOpen);
    }, []);
    useEffect(() => {
      connStateRef.current = connState;
    }, [connState]);

    // ---------- session list ----------

    const refreshSessions = useCallback(async () => {
      if (!projectId) {
        setSessions([]);
        setActiveId(null);
        return;
      }
      try {
        const res = await api.get<TerminalSessionDto[]>('/terminals/', { params: { alive: 'true', project: projectId } });
        const liveSessions = res.data || [];
        setSessions(liveSessions);
        setActiveId(prev => {
          if (prev && liveSessions.some(s => s.id === prev)) return prev;
          return liveSessions[liveSessions.length - 1]?.id ?? null;
        });
        // Live sessions remain available from the floating launcher, but do
        // not reopen the drawer simply because this project was visited.
      } catch {
        /* best-effort */
      }
    }, [projectId]);

    useEffect(() => {
      setSessions([]);
      setActiveId(null);
      refreshSessions();
      const onFocus = () => refreshSessions();
      window.addEventListener('focus', onFocus);
      return () => window.removeEventListener('focus', onFocus);
    }, [refreshSessions, projectId]);

    useEffect(() => {
      if (!open) return;
      const t = window.setInterval(refreshSessions, 20000);
      return () => window.clearInterval(t);
    }, [open, refreshSessions]);

    // ---------- xterm lifecycle for the active tab ----------

    const markExited = useCallback((sessionId: string, code: number | null) => {
      setSessions(prev =>
        prev.map(s =>
          s.id === sessionId
            ? { ...s, alive: false, exitedAt: s.exitedAt ?? new Date().toISOString(), exitCode: code }
            : s
        )
      );
    }, []);

    // Publishes the active session's output tail for the desktop companion
    // ("pet") so it can show CMD progress and done state while minimized.
    // Throttled: the stream pump calls this on every chunk.
    const publishPetSnapshot = useCallback((opts?: { force?: boolean; alive?: boolean; exitCode?: number | null }) => {
      const sessionId = activeIdRef.current;
      if (!sessionId) return;
      const now = Date.now();
      if (!opts?.force && now - petPublishAtRef.current < 1000) return;
      petPublishAtRef.current = now;
      const rt = runtimeRef.current;
      const session = sessionsRef.current.find(s => s.id === sessionId);
      if (!session) return;
      const stripped = rt.outputTail.replace(ANSI_SEQUENCE_RE, '');
      publishTerminalPetSnapshot({
        sessionId,
        projectId: session.projectId ?? projectIdRef.current,
        projectTitle: session.projectTitle || '',
        mode: session.mode,
        alive: opts?.alive ?? session.alive,
        exitCode: opts?.exitCode !== undefined ? opts.exitCode : session.exitCode,
        tailText: stripped.slice(-600),
        promptReady: CMD_PROMPT_RE.test(stripped.slice(-512)),
        lastOutputAt: rt.lastOutputAt,
        revision: rt.outputRevision,
        updatedAt: now,
      });
    }, []);

    const markExitedAndPublish = useCallback((sessionId: string, code: number | null) => {
      markExited(sessionId, code);
      if (sessionId === activeIdRef.current) {
        publishPetSnapshot({ force: true, alive: false, exitCode: code });
      }
    }, [markExited, publishPetSnapshot]);

    const getInputQueue = useCallback((sessionId: string): InputQueue => {
      const existing = inputQueuesRef.current.get(sessionId);
      if (existing) return existing;
      const queue: InputQueue = {
        pending: [],
        timer: null,
        items: [],
        processing: false,
        cancelled: false,
        abort: new AbortController(),
        activePasteEndPending: false,
      };
      inputQueuesRef.current.set(sessionId, queue);
      return queue;
    }, []);

    const reportInputFailure = useCallback((error: unknown) => {
      if (error instanceof Error && error.name === 'CanceledError') return;
      setTerminalError('The terminal input could not be delivered. The paste was stopped; retry it if needed.');
    }, []);

    const runInputQueue = useCallback(async (sessionId: string, queue: InputQueue): Promise<void> => {
      if (queue.processing) return;
      queue.processing = true;
      try {
        while (!queue.cancelled && queue.items.length) {
          const item = queue.items.shift()!;
          const chunks = item.chunked ? splitInputChunks(item.data, PASTE_CHUNK_CHARS) : [item.data];
          queue.activePasteEndPending = item.chunked && item.data.includes(BRACKETED_PASTE_START);
          try {
            for (let index = 0; index < chunks.length; index += 1) {
              if (queue.cancelled) throw new DOMException('Input queue cancelled.', 'AbortError');
              await api.post('/terminals/' + sessionId + '/input/', { data: chunks[index] }, { signal: queue.abort.signal });
              if (item.chunked && chunks[index].includes(BRACKETED_PASTE_END)) queue.activePasteEndPending = false;
              if (item.chunked && index + 1 < chunks.length) await sleep(PASTE_CHUNK_GAP_MS, queue.abort.signal);
            }
            item.resolve();
          } catch (error) {
            item.reject(error);
            throw error;
          } finally {
            queue.activePasteEndPending = false;
          }
        }
      } catch (error) {
        if (!queue.cancelled) {
          while (queue.items.length) queue.items.shift()!.reject(error);
          reportInputFailure(error);
        }
      } finally {
        queue.processing = false;
        if (!queue.cancelled && queue.items.length) void runInputQueue(sessionId, queue);
      }
    }, [reportInputFailure]);

    const enqueueInput = useCallback((sessionId: string, data: string, chunked: boolean): Promise<void> => {
      if (!data) return Promise.resolve();
      const queue = getInputQueue(sessionId);
      if (queue.cancelled) return Promise.reject(new Error('Input queue cancelled.'));
      return new Promise<void>((resolve, reject) => {
        queue.items.push({ data, chunked, resolve, reject });
        void runInputQueue(sessionId, queue);
      });
    }, [getInputQueue, runInputQueue]);

    const flushInput = useCallback((sessionId: string): Promise<void> => {
      const queue = inputQueuesRef.current.get(sessionId);
      if (!queue || !queue.pending.length) return Promise.resolve();
      const data = queue.pending.join('');
      queue.pending = [];
      if (queue.timer !== null) {
        window.clearTimeout(queue.timer);
        queue.timer = null;
      }
      return enqueueInput(sessionId, data, false).catch(error => {
        reportInputFailure(error);
        throw error;
      });
    }, [enqueueInput, reportInputFailure]);

    const queueInput = useCallback((sessionId: string, data: string) => {
      const queue = getInputQueue(sessionId);
      if (queue.cancelled) return;
      queue.pending.push(data);
      if (queue.timer === null) {
        queue.timer = window.setTimeout(() => {
          queue.timer = null;
          void flushInput(sessionId).catch(() => undefined);
        }, 50);
      }
    }, [flushInput, getInputQueue]);

    const sendPastedChunks = useCallback(async (sessionId: string, text: string): Promise<void> => {
      const token = ++pasteSeqRef.current;
      await flushInput(sessionId);
      if (token !== pasteSeqRef.current || activeIdRef.current !== sessionId) throw new Error('Paste cancelled.');
      const total = text.length;
      setPasteProgress({ sent: 0, total });
      try {
        await enqueueInput(sessionId, text, true);
        setPasteProgress({ sent: total, total });
      } finally {
        if (token === pasteSeqRef.current) setPasteProgress(null);
      }
    }, [enqueueInput, flushInput]);

    const sendPastedText = useCallback(async (data: string, sessionId?: string): Promise<void> => {
      const targetId = sessionId || activeIdRef.current;
      if (!targetId) throw new Error('No active terminal session.');
      if (!data) return;
      await sendPastedChunks(targetId, data);
    }, [sendPastedChunks]);

    const handlePasteText = useCallback((rawText: string) => {
      const sessionId = activeIdRef.current;
      const rt = runtimeRef.current;
      if (!sessionId || !rt.term || !rt.inputReady) return;
      if (!rawText) return;
      if (rawText.length > PASTE_CONFIRM_CHARS) {
        const kb = Math.round(rawText.length / 1024);
        if (!window.confirm('Paste ' + kb + ' KB into the console? Very large pastes take a while to echo back.')) return;
      }
      // xterm performs the correct CR/LF conversion and adds bracketed-paste
      // markers only when the running application has enabled mode 2004.
      pasteDispatchRef.current = true;
      try {
        rt.term.paste(rawText);
      } finally {
        pasteDispatchRef.current = false;
      }
    }, []);

    const copyTerminalSelection = useCallback(async (): Promise<boolean> => {
      const sel = runtimeRef.current.term?.getSelection() || '';
      if (!sel) return false;
      try {
        await navigator.clipboard.writeText(sel);
        return true;
      } catch {
        setTerminalError('Unable to copy — the browser blocked clipboard access.');
        return false;
      }
    }, []);

    // Pasted bitmaps become file inputs: save the image server-side, then
    // type its quoted path so commands / agent CLIs can consume it.
    const handlePasteImages = useCallback(async (files: File[]): Promise<void> => {
      const sessionId = activeIdRef.current;
      const rt = runtimeRef.current;
      if (!sessionId || !rt.term || !rt.inputReady) return;
      setTerminalError(null);
      try {
        const images = [];
        for (const file of files.slice(0, 4)) {
          images.push(await fileToDownscaledDataUrl(file));
        }
        for (const image of images) {
          const blob = await (await fetch(image.dataUrl)).blob();
          const form = new FormData();
          form.append('image', blob, `pasted-image.${image.mimeType === 'image/png' ? 'png' : 'jpg'}`);
          const res = await api.post<{ path: string }>('/uploads/image/', form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
          const savedPath = res.data?.path;
          if (savedPath) handlePasteText(`"${savedPath}"`);
        }
      } catch (e: any) {
        setTerminalError(e?.response?.data?.error || e?.message || 'Could not save the pasted image.');
      }
    }, [handlePasteText]);

    // Used when Ctrl+V (etc.) is pressed while focus is outside the terminal:
    // focusing alone would not deliver the clipboard, so read it explicitly.
    const pasteFromClipboard = useCallback(async (): Promise<void> => {
      const rt = runtimeRef.current;
      if (!activeIdRef.current || !rt.term) return;
      try {
        rt.term.focus();
      } catch {
        /* focus is best-effort */
      }
      let text = '';
      try {
        text = await navigator.clipboard.readText();
      } catch {
        setTerminalError('Clipboard read was denied — click inside the console, then press Ctrl+V again.');
        return;
      }
      if (text) handlePasteText(text);
    }, [handlePasteText]);

    const syncBackendSize = useCallback(async (sessionId: string, cols: number, rows: number, force = false) => {
      const rt = runtimeRef.current;
      if (!(cols > 2 && rows > 2)) return;
      if (!force && cols === rt.lastCols && rows === rt.lastRows) return;
      await api.post(`/terminals/${sessionId}/resize/`, { cols, rows });
      rt.lastCols = cols;
      rt.lastRows = rows;
    }, []);

    const cancelInputQueue = useCallback((sessionId: string) => {
      const queue = inputQueuesRef.current.get(sessionId);
      if (!queue) return;
      if (queue.timer !== null) window.clearTimeout(queue.timer);
      queue.cancelled = true;
      queue.abort.abort();
      const cancellation = new DOMException('Input queue cancelled.', 'AbortError');
      while (queue.items.length) queue.items.shift()!.reject(cancellation);
      queue.pending = [];
      if (queue.activePasteEndPending) {
        void api.post('/terminals/' + sessionId + '/input/', { data: BRACKETED_PASTE_END }).catch(() => undefined);
      }
      inputQueuesRef.current.delete(sessionId);
    }, []);
    const teardownRuntime = useCallback(() => {
      const rt = runtimeRef.current;
      rt.pumpStopped = true;
      if (rt.abort) {
        rt.abort.abort();
        rt.abort = null;
      }
      if (activeIdRef.current) cancelInputQueue(activeIdRef.current);
      // Cancel any in-flight chunked paste for the same reason.
      pasteSeqRef.current += 1;
      setPasteProgress(null);
      setCtxMenu(null);
      rt.inputReady = false;
      setTerminalReady(false);
      if (rt.resizeTimer !== null) {
        window.clearTimeout(rt.resizeTimer);
        rt.resizeTimer = null;
      }
      try {
        rt.term?.dispose();
      } catch {
        /* already disposed */
      }
      rt.dataSub?.dispose();
      rt.dataSub = null;
      rt.term = null;
      rt.fit = null;
      rt.lastCols = 0;
      rt.lastRows = 0;
      rt.outputRevision = 0;
      rt.lastOutputAt = 0;
      rt.outputTail = '';
      setActiveSize(null);
    }, [cancelInputQueue]);

    useEffect(() => {
      if (!open || !activeId || !containerRef.current) {
        teardownRuntime();
        return undefined;
      }
      setTerminalReady(false);

      const container = containerRef.current;
      const session = sessionsRef.current.find(s => s.id === activeId);

      const term = new Terminal({
        theme: XTERM_THEME,
        fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
        fontSize: 12,
        lineHeight: 1.15,
        cursorBlink: true,
        scrollback: 4000,
        convertEol: false,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(container);
      try {
        fit.fit();
      } catch {
        /* zero-size first paint; ResizeObserver refits */
      }
      setActiveSize({ cols: term.cols, rows: term.rows });

      const rt = runtimeRef.current;
      rt.term = term;
      rt.fit = fit;

      const onMouseDown = () => {
        window.setTimeout(() => {
          if (rt.inputReady) term.focus();
        }, 0);
      };
      container.addEventListener('mousedown', onMouseDown);

      // Images are saved server-side and typed in as file paths (see
      // handlePasteImages); only pure-text pastes fall through to xterm.
      const onPaste = (event: ClipboardEvent) => {
        const images = extractImageFiles(event.clipboardData);
        if (images.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          void handlePasteImages(images);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const text = event.clipboardData?.getData('text/plain') || '';
        if (text) handlePasteText(text);
      };
      container.addEventListener('paste', onPaste, true);

      const onContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        setCtxMenu({ x: event.clientX, y: event.clientY });
      };
      container.addEventListener('contextmenu', onContextMenu);

      const attachInput = () => {
        if (session?.alive === false || rt.dataSub || !rt.inputReady) return;
        rt.dataSub = term.onData(data => {
          const userData = removeTerminalQueryResponses(data);
          if (!userData) return;
          if (pasteDispatchRef.current) {
            void sendPastedChunks(activeId, userData).catch(error => {
              if (error instanceof Error && error.message === 'Paste cancelled.') return;
              reportInputFailure(error);
            });
          } else {
            queueInput(activeId, userData);
          }
        });
      };

      const disableInput = () => {
        rt.inputReady = false;
        setTerminalReady(false);
        rt.dataSub?.dispose();
        rt.dataSub = null;
      };

      const onResized = () => {
        try {
          fit.fit();
        } catch {
          return;
        }
        setActiveSize({ cols: term.cols, rows: term.rows });
        if (!rt.inputReady) return;
        if (rt.resizeTimer !== null) return;
        rt.resizeTimer = window.setTimeout(() => {
          rt.resizeTimer = null;
          const t2 = rt.term;
          if (!t2 || rt.pumpStopped) return;
          disableInput();
          void syncBackendSize(activeId, t2.cols, t2.rows, true)
            .then(() => {
              if (!rt.pumpStopped) {
                rt.inputReady = true;
                setTerminalReady(true);
                attachInput();
              }
            })
            .catch((error: any) => {
              if (rt.pumpStopped) return;
              const detail = error?.response?.data?.error || error?.message || 'Unable to synchronize terminal size.';
              setTerminalError(detail);
              setConnState('error');
            });
        }, 120);
      };
      const ro = new ResizeObserver(onResized);
      ro.observe(container);

      // Initial resize kick so a slow ConPTY/cmd start flushes its banner promptly.
      term.write('\x1b[90mConnecting to console…\x1b[0m\r\n');

      // Stream: replay buffered output from offset 0, then follow live output.
      const ctrl = new AbortController();
      rt.abort = ctrl;
      rt.pumpStopped = false;
      const stopped = () => rt.pumpStopped || ctrl.signal.aborted;
      const waitsForCmdPrompt = session?.mode === 'cmd' && session.reused === false;
      let initialOutputTail = '';
      let initialOutputSeen = false;
      let initialQuietTimer: number | null = null;
      let initialFallbackTimer: number | null = null;

      const clearInitialTimers = () => {
        if (initialQuietTimer !== null) {
          window.clearTimeout(initialQuietTimer);
          initialQuietTimer = null;
        }
        if (initialFallbackTimer !== null) {
          window.clearTimeout(initialFallbackTimer);
          initialFallbackTimer = null;
        }
      };

      const enableInputAfterInitialRender = () => {
        if (stopped() || session?.alive === false || rt.inputReady) return;
        clearInitialTimers();
        rt.inputReady = true;
        setTerminalReady(true);
        attachInput();
        term.focus();
      };

      const scheduleCustomPromptFallback = () => {
        if (!initialOutputSeen || stopped()) return;
        if (initialQuietTimer !== null) window.clearTimeout(initialQuietTimer);
        initialQuietTimer = window.setTimeout(() => {
          initialQuietTimer = null;
          enableInputAfterInitialRender();
        }, 400);
        if (initialFallbackTimer === null) {
          initialFallbackTimer = window.setTimeout(() => {
            initialFallbackTimer = null;
            enableInputAfterInitialRender();
          }, 1800);
        }
      };

      const handleInitialOutputRendered = (text: string) => {
        if (rt.inputReady || !text) return;
        initialOutputSeen = true;
        initialOutputTail = `${initialOutputTail}${text}`.slice(-4096);
        const normalizedTail = initialOutputTail.replace(ANSI_SEQUENCE_RE, '');
        if (!waitsForCmdPrompt || CMD_PROMPT_RE.test(normalizedTail)) {
          enableInputAfterInitialRender();
          return;
        }
        // Custom PROMPT values may not match the standard drive/path form.
        // Wait for a quiet period, with a hard upper bound, before enabling.
        scheduleCustomPromptFallback();
      };
      // Keep the server cursor across the stream's periodic reconnects. The
      // terminal component can still start at zero when it is newly mounted,
      // but a reconnect must never replay from zero or clear the live screen.
      let streamCursor = 0;

      const pumpStreamOnce = async (): Promise<void> => {
        setConnState('connecting');
        const res = await authedFetch(
          `/terminals/${activeId}/output/?after=${streamCursor}`,
          { method: 'GET', headers: { Accept: 'application/x-ndjson' }, signal: ctrl.signal },
        );
        if (!res.ok || !res.body) {
          const status = `HTTP ${res.status}`;
          console.error('[TerminalDrawer] stream failed:', status);
          term.write(`\x1b[31m\r\n[stream error: ${status}] — is the backend running and restarted after the terminal update?\x1b[0m\r\n`);
          setConnState('error');
          throw new Error(status);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let carry = '';
        let finished = false;
        for (;;) {
          const { done, value } = await reader.read();
          if (done || stopped()) break;
          carry += decoder.decode(value, { stream: true });
          let nlIndex: number;
          while ((nlIndex = carry.indexOf('\n')) >= 0) {
            const line = carry.slice(0, nlIndex).trim();
            carry = carry.slice(nlIndex + 1);
            if (!line) continue;
            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(line);
            } catch {
              continue;
            }
            if (typeof evt.t === 'number' && Number.isFinite(evt.t)) {
              streamCursor = evt.t;
            }
            if (evt.reset) term.reset();
            if (typeof evt.d === 'string' && evt.d) {
              const output = evt.d;
              rt.outputRevision += 1;
              rt.lastOutputAt = Date.now();
              rt.outputTail = `${rt.outputTail}${output}`.slice(-8192);
              publishPetSnapshot();
              await new Promise<void>(resolve => {
                term.write(output, () => {
                  handleInitialOutputRendered(output);
                  resolve();
                });
              });
              if (connStateRef.current !== 'live') setConnState('live');
            }
            if (evt.e === true) {
              markExitedAndPublish(activeId, (evt.c as number | null) ?? null);
              finished = true;
              break;
            }
            if (evt.k === true) {
              finished = true;
              break;
            }
          }
          if (finished) break;
        }
        try {
          await reader.cancel();
        } catch {
          /* stream already closed */
        }
      };

      const runPump = async () => {
        let failures = 0;
        while (!stopped()) {
          try {
            await pumpStreamOnce();
            failures = 0;
            if (stopped()) break;
            // 'k' cutoffs reconnect; exits leave nothing alive to follow.
            const rec = sessionsRef.current.find(s => s.id === activeId);
            if (!rec || !rec.alive) break;
            await sleep(150, ctrl.signal);
          } catch (e) {
            if (stopped()) break;
            // Session gone (e.g. backend restarted, registry wiped) → stop cleanly.
            if (e instanceof Error && /HTTP 404/.test(e.message)) {
              term.write('\x1b[33m\r\n[session ended — backend may have restarted]\x1b[0m\r\n');
              markExitedAndPublish(activeId, null);
              setConnState('error');
              break;
            }
            console.error('[TerminalDrawer] stream error:', e);
            setConnState('error');
            failures += 1;
            await sleep(Math.min(500 * failures, 3000), ctrl.signal);
          }
        }
      };
      const startConsole = async () => {
        try {
          // CMD starts with the backend's default dimensions. Synchronize to
          // xterm before attaching input or reading the first prompt.
          await syncBackendSize(activeId, term.cols, term.rows, true);
          if (stopped()) return;
          if (!waitsForCmdPrompt) {
            // Existing interactive sessions become usable once their retained
            // screen has been parsed; fresh CMD sessions wait for the prompt.
            initialFallbackTimer = window.setTimeout(() => {
              initialFallbackTimer = null;
              enableInputAfterInitialRender();
            }, 1800);
          }
          await runPump();
        } catch (error: any) {
          if (stopped()) return;
          const detail = error?.response?.data?.error || error?.message || 'Unable to synchronize terminal size.';
          setTerminalError(detail);
          setConnState('error');
          term.write(`\x1b[31m\r\n[terminal setup error: ${detail}]\x1b[0m\r\n`);
        }
      };
      void startConsole();

      return () => {
        clearInitialTimers();
        ro.disconnect();
        container.removeEventListener('mousedown', onMouseDown);
        container.removeEventListener('paste', onPaste, true);
        container.removeEventListener('contextmenu', onContextMenu);
        teardownRuntime();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, activeId]);

    useEffect(
      () => () => {
        teardownRuntime();
      },
      [teardownRuntime]
    );

    // Paste/copy shortcuts while the drawer is open. A native `paste` event
    // only reaches the terminal when it is focused, so Ctrl+V pressed
    // elsewhere did nothing. Intercept it here (unless the user is typing in
    // a real field) and paste via the clipboard API instead.
    useEffect(() => {
      if (!open) return;
      const onKeyDown = (e: KeyboardEvent) => {
        const key = e.key ?? '';
        const isPaste =
          ((e.ctrlKey || e.metaKey) && key.toLowerCase() === 'v') ||
          (e.shiftKey && !e.ctrlKey && !e.metaKey && key === 'Insert');
        const isCopy = e.ctrlKey && !e.metaKey && !e.shiftKey && key === 'Insert';
        if (!isPaste && !isCopy) return;
        const t = e.target as HTMLElement | null;
        const inXterm = !!t?.classList?.contains('xterm-helper-textarea');
        const tag = t?.tagName;
        const inEditable =
          !inXterm && !!t && (tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable);
        if (inEditable) return;
        const rt = runtimeRef.current;
        if (!rt.term || activeIdRef.current == null) return;
        e.preventDefault();
        e.stopPropagation();
        if (isCopy) {
          void copyTerminalSelection();
        } else {
          setCtxMenu(null);
          void pasteFromClipboard();
        }
      };
      window.addEventListener('keydown', onKeyDown, true);
      return () => window.removeEventListener('keydown', onKeyDown, true);
    }, [open, pasteFromClipboard, copyTerminalSelection]);

    // ---------- imperative API ----------

    const create = useCallback(
      async (mode: TerminalMode, options?: { forceNew?: boolean }): Promise<TerminalSessionDto> => {
        if (!projectId) throw new Error('No project selected.');
        setLoadingCreate(mode);
        setTerminalError(null);
        try {
          const res = await api.post<TerminalSessionDto>(`/projects/${projectId}/terminals/`, {
            mode,
            force_new: options?.forceNew === true,
          });
          const dto = res.data;
          setSessions(prev => [...prev.filter(s => s.id !== dto.id), dto]);
          activeIdRef.current = dto.id;
          setActiveId(dto.id);
          persistMinimizedForProject(projectId, false);
          setOpen(true);
          notifyTerminalsChanged();
          return dto;
        } catch (error: any) {
          const message = error?.response?.data?.error || error?.message || 'Unable to create the terminal console.';
          setTerminalError(message);
          throw error;
        } finally {
          setLoadingCreate(null);
        }
      },
      [projectId]
    );

    const restartIfRunning = useCallback(
      async (mode: TerminalMode): Promise<TerminalSessionDto | null> => {
        if (!projectId) return null;
        const existing = sessionsRef.current.find(s => s.mode === mode && s.alive);
        if (!existing) return null;
        if (existing.id === activeId) teardownRuntime();
        await api.delete(`/terminals/${existing.id}/`);
        setSessions(prev => prev.filter(s => s.id !== existing.id));
        const res = await api.post<TerminalSessionDto>(`/projects/${projectId}/terminals/`, { mode });
        const dto = res.data;
        setSessions(prev => [...prev.filter(s => s.id !== dto.id), dto]);
        setActiveId(dto.id);
        persistMinimizedForProject(projectId, false);
        setOpen(true);
        notifyTerminalsChanged();
        return dto;
      },
      [activeId, projectId, teardownRuntime]
    );

    const sendInput = useCallback(async (data: string, sessionId?: string): Promise<void> => {
      const targetId = sessionId || activeIdRef.current;
      if (!targetId) throw new Error('No active terminal session.');
      await flushInput(targetId);
      await enqueueInput(targetId, data, false);
    }, [enqueueInput, flushInput]);
    const waitForOutputIdle = useCallback(
      (sessionId: string, options?: { afterRevision?: number; quietMs?: number; timeoutMs?: number }): Promise<number> => {
        const quietMs = Math.max(100, options?.quietMs ?? 450);
        const timeoutMs = Math.max(1000, options?.timeoutMs ?? 12000);
        const baseline = options?.afterRevision;
        const startedAt = Date.now();

        return new Promise((resolve, reject) => {
          const timer = window.setInterval(() => {
            const runtime = runtimeRef.current;
            const session = sessionsRef.current.find(item => item.id === sessionId);
            const activitySeen = baseline === undefined || runtime.outputRevision > baseline;
            const quiet = runtime.lastOutputAt === 0 || Date.now() - runtime.lastOutputAt >= quietMs;
            if (activeIdRef.current === sessionId && session && session.alive !== false && runtime.inputReady && activitySeen && quiet) {
              window.clearInterval(timer);
              resolve(runtime.outputRevision);
              return;
            }
            if (Date.now() - startedAt >= timeoutMs || session?.alive === false) {
              window.clearInterval(timer);
              reject(new Error('Timed out waiting for the terminal application to become ready.'));
            }
          }, 50);
        });
      },
      []
    );

    // Agent-launch handshake: resolve when the streamed output shows the
    // application is ready for input ('ready'), or when it is stopped at an
    // interactive gate such as a trust prompt ('blocked'). Only output
    // produced after `afterRevision` is scanned, so earlier shell banners
    // cannot false-positive the match.
    const waitForOutputMarker = useCallback(
      (sessionId: string, options: OutputMarkerWait): Promise<OutputMarkerResult> => {
        const timeoutMs = Math.max(2000, options.timeoutMs ?? 60000);
        const ready = options.ready;
        const blocked = options.blocked ?? [];
        const baseline = options.afterRevision;
        const startedAt = Date.now();
        return new Promise((resolve, reject) => {
          const timer = window.setInterval(() => {
            const runtime = runtimeRef.current;
            if (activeIdRef.current !== sessionId) {
              window.clearInterval(timer);
              reject(new Error('The active console changed.'));
              return;
            }
            const session = sessionsRef.current.find(item => item.id === sessionId);
            if (!session || session.alive === false) {
              window.clearInterval(timer);
              reject(new Error('The console session ended.'));
              return;
            }
            const tail = baseline === undefined || runtime.outputRevision > baseline ? runtime.outputTail : '';
            const found = scanOutputMarkers(tail, ready, blocked);
            if (found) {
              window.clearInterval(timer);
              resolve(found);
              return;
            }
            if (Date.now() - startedAt >= timeoutMs) {
              window.clearInterval(timer);
              reject(new Error('Timed out waiting for the console application to become ready.'));
            }
          }, 100);
        });
      },
      []
    );

    const minimize = useCallback(() => {
      persistMinimizedForProject(projectId, true);
      setOpen(false);
    }, [projectId]);

    useImperativeHandle(ref, () => ({ create, restartIfRunning, sendInput, sendPastedText, waitForOutputIdle, waitForOutputMarker, minimize }), [create, restartIfRunning, sendInput, sendPastedText, waitForOutputIdle, waitForOutputMarker, minimize]);

    // ---------- resize dragging ----------

    const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (fullscreen) return;
      e.preventDefault();
      dragStateRef.current = { startY: e.clientY, startH: latestHeightRef.current };
      setIsDragging(true);

      const move = (ev: PointerEvent) => {
        const start = dragStateRef.current;
        if (!start) return;
        ev.preventDefault();
        setHeightPx(clampHeight(start.startH + (start.startY - ev.clientY)));
      };
      const up = () => {
        dragStateRef.current = null;
        setIsDragging(false);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        persistHeightToStorage(latestHeightRef.current);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    };

    const onHandleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape' && open) {
        e.stopPropagation();
        return;
      }
      if (fullscreen) return;
      const step = e.shiftKey ? 40 : 12;
      let next: number | null = null;
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        next = clampHeight(latestHeightRef.current + step);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        next = clampHeight(latestHeightRef.current - step);
      } else if (e.key === 'Home') {
        e.preventDefault();
        next = Math.floor(window.innerHeight * MAX_VIEWPORT_RATIO);
      } else if (e.key === 'End') {
        e.preventDefault();
        resetHeight();
        return;
      }
      if (next !== null) {
        setHeightPx(next);
        persistHeightToStorage(next);
      }
    };

    const resetHeight = useCallback(() => {
      setFullscreen(false);
      setHeightPx(DEFAULT_HEIGHT);
      persistHeightToStorage(DEFAULT_HEIGHT);
    }, []);

    const toggleFullscreen = useCallback(() => {
      if (fullscreen) {
        setFullscreen(false);
        setHeightPx(h => clampHeight(h));
      } else {
        persistHeightToStorage(heightPx);
        setHeightPx(Math.floor(window.innerHeight * FULLSCREEN_RATIO));
        setFullscreen(true);
      }
    }, [fullscreen, heightPx]);

    // ---------- session actions ----------

    const closeTab = (sessionId: string) => {
      if (sessionId === activeId) teardownRuntime();
      clearTerminalPetSnapshot(sessionId);
      const remaining = sessionsRef.current.filter(s => s.id !== sessionId);
      setSessions(remaining);
      if (activeId === sessionId) {
        if (remaining.length > 0) {
          setActiveId(remaining[remaining.length - 1].id);
        } else {
          setActiveId(null);
          setOpen(false);
        }
      }
      api.delete(`/terminals/${sessionId}/`).catch(() => {});
      notifyTerminalsChanged();
    };

    const stopSession = useCallback(
      (sessionId: string) => {
        if (sessionId === activeId) {
          teardownRuntime();
          // Keep the panel open; the exit event will flip the tab to "exited".
          setActiveId(activeId);
        }
        markExited(sessionId, null);
        if (sessionId === activeIdRef.current) {
          publishPetSnapshot({ force: true, alive: false, exitCode: null });
        }
        api.delete(`/terminals/${sessionId}/`).catch(() => {});
        notifyTerminalsChanged();
      },
      [activeId]
    );

    const collapse = minimize;

    const anyLive = sessions.some(s => s.alive);
    const activeSession = sessions.find(s => s.id === activeId) ?? null;
    const effectiveHeight = fullscreen ? Math.floor(window.innerHeight * FULLSCREEN_RATIO) : heightPx;

    return (
      <>
        {!open && anyLive && (
          <button
            type="button"
            onClick={() => {
              persistMinimizedForProject(projectId, false);
              setOpen(true);
            }}
            className="fixed bottom-4 right-4 z-30 flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-2xl bg-slate-900 border border-line-strong shadow-2xl text-xs font-black font-mono text-indigo-300 hover:border-indigo-500 transition-colors animate-in fade-in"
          >
            <TerminalIcon className="w-4 h-4" />
            <span>Terminal{sessions.length > 1 ? ` (${sessions.length})` : ''}</span>
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
          </button>
        )}

        {ctxMenu && open && (
          <>
            <button
              type="button"
              aria-label="Close terminal menu"
              className="fixed inset-0 z-[60] cursor-default bg-transparent"
              onClick={() => setCtxMenu(null)}
              onContextMenu={e => {
                e.preventDefault();
                setCtxMenu(null);
              }}
            />
            <div
              role="menu"
              className="fixed z-[61] min-w-[160px] rounded-xl border border-line bg-slate-900 py-1 shadow-2xl"
              style={{
                left: Math.min(ctxMenu.x, window.innerWidth - 180),
                top: Math.min(ctxMenu.y, window.innerHeight - 110),
              }}
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setCtxMenu(null);
                  void pasteFromClipboard();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs font-mono text-content hover:bg-indigo-500/20 hover:text-white"
              >
                Paste <span className="ml-auto text-[10px] text-content-faint">Ctrl+V</span>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setCtxMenu(null);
                  void copyTerminalSelection();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs font-mono text-content hover:bg-indigo-500/20 hover:text-white"
              >
                Copy selection <span className="ml-auto text-[10px] text-content-faint">Ctrl+Ins</span>
              </button>
            </div>
          </>
        )}

        <div
          role="dialog"
          aria-modal="false"
          aria-label="Terminal drawer"
          className={`fixed left-0 right-0 bottom-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-md border-t border-x border-line shadow-[0_-16px_48px_rgba(0,0,0,0.55)] transition-transform duration-200 pb-[env(safe-area-inset-bottom)] ${
            open ? 'translate-y-0' : 'translate-y-full pointer-events-none'
          }`}
          style={{ height: `${effectiveHeight}px` }}
        >
          {/* Drag handle — custom tooltip only (no native `title`, which renders
              as an unstyled white box in Electron/Chromium and lingers during drag). */}
          <div
            role="slider"
            tabIndex={0}
            aria-label="Resize terminal drawer. Drag to resize, double-click to reset."
            aria-valuemin={160}
            aria-valuemax={800}
            aria-valuenow={Math.round(effectiveHeight)}
            aria-disabled={fullscreen}
            onPointerDown={onHandlePointerDown}
            onDoubleClick={resetHeight}
            onKeyDown={onHandleKeyDown}
            className={`group relative h-3 w-full shrink-0 flex items-center justify-center select-none touch-none focus-visible:outline-none focus-visible:bg-indigo-500/20 ${
              fullscreen ? 'cursor-default' : 'cursor-row-resize hover:bg-indigo-500/20'
            }`}
          >
            <div
              className={`h-1 w-24 rounded-full bg-slate-700 transition-colors ${
                fullscreen ? 'opacity-30' : 'group-hover:bg-indigo-400'
              }`}
            />
            {!fullscreen && !isDragging && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-full z-10 mt-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-slate-900 px-2.5 py-1 text-[11px] font-mono font-bold text-content shadow-xl opacity-0 translate-y-1 transition-all duration-150 group-hover:opacity-100 group-hover:translate-y-0 group-focus-visible:opacity-100 group-focus-visible:translate-y-0"
              >
                Drag to resize • double-click to reset
              </span>
            )}
          </div>

          {/* Tab strip */}
          <div className="flex items-stretch gap-1 px-3 pt-1 pb-0 overflow-x-auto scrollbar-none shrink-0 border-b border-line/70" role="tablist" aria-label="Terminal sessions">
            {sessions.map(s => {
              const isActive = s.id === activeId;
              const Icon = s.mode === 'script' ? Zap : TerminalIcon;
              return (
                <div
                  key={s.id}
                  role="tab"
                  tabIndex={0}
                  aria-selected={isActive}
                  onClick={() => setActiveId(s.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveId(s.id); } }}
                  title={`${s.projectTitle} — ${s.title}${
                    s.alive ? '' : s.exitCode != null ? ` (exited ${s.exitCode})` : ' (exited)'
                  }`}
                  className={`group flex items-center gap-2 pl-3 pr-2 py-2 rounded-t-xl border border-b-0 text-xs font-mono font-bold whitespace-nowrap cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-slate-900 border-line text-white'
                      : 'bg-transparent border-transparent text-content-faint hover:text-content hover:bg-slate-900/50'
                  }`}
                >
                  <Icon
                    className={`w-3.5 h-3.5 ${
                      s.mode === 'script' ? 'text-emerald-400' : 'text-sky-400'
                    } ${s.alive ? '' : 'opacity-40'}`}
                  />
                  <span className="max-w-[140px] truncate">{s.projectTitle}</span>
                  <span className="text-content-faint">·</span>
                  <span className="max-w-[100px] truncate text-content-muted">
                    {s.mode === 'script' ? 'server' : s.title.toLowerCase()}
                  </span>
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      s.alive
                        ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                        : 'bg-slate-600'
                    }`}
                  />
                  {!s.alive && (
                    <span
                      className={`text-[10px] uppercase tracking-wider ${
                        s.exitCode ? 'text-rose-400' : 'text-emerald-500/80'
                      }`}
                    >
                      {s.exitCode ? `exit ${s.exitCode}` : 'done'}
                    </span>
                  )}
                  {s.alive && (
                    <button
                      type="button"
                      onClick={e => {
                        e.stopPropagation();
                        stopSession(s.id);
                      }}
                      title="Stop terminal"
                      className="ml-1 p-0.5 rounded-md text-content-faint hover:text-rose-300 hover:bg-rose-500/10 transition-all"
                    >
                      <Square className="w-3 h-3" fill="currentColor" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      closeTab(s.id);
                    }}
                    title={s.alive ? 'Stop & close terminal' : 'Close terminal'}
                    aria-label={`Close terminal ${s.projectTitle} ${s.title}`}
                    className="ml-1 p-1 rounded-md text-content-faint hover:text-rose-300 hover:bg-rose-500/10 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 transition-all"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}

            <div className="ml-auto flex items-center gap-1 pb-1 pl-2 shrink-0">
              {projectId && (
                <div className="flex items-center gap-1 pr-1 mr-1 border-r border-line/60">
                  <button
                    type="button"
                    disabled={!open}
                    title="New separate CMD console"
                    onClick={() => void create('cmd', { forceNew: true }).catch(() => {})}
                    className="p-1.5 rounded-lg text-content-faint hover:text-sky-300 hover:bg-surface-2 transition-colors disabled:opacity-30"
                  >
                    {loadingCreate === 'cmd' ? (
                      <div className="w-3.5 h-3.5 border-2 border-sky-800 border-t-sky-300 rounded-full animate-spin" />
                    ) : (
                      <TerminalIcon className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={toggleFullscreen}
                title={fullscreen ? 'Restore size' : 'Fullscreen'}
                className="p-1.5 rounded-lg text-content-faint hover:text-white hover:bg-surface-2 transition-colors"
              >
                {fullscreen ? (
                  <ChevronsDownUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronsUpDown className="w-3.5 h-3.5" />
                )}
              </button>
              <button
                type="button"
                onClick={collapse}
                title="Hide panel (keeps terminals running)"
                className="p-1.5 rounded-lg text-content-faint hover:text-white hover:bg-surface-2 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {terminalError && (
            <div className="mx-3 mt-2 flex items-start justify-between gap-3 rounded-xl border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-200" role="alert">
              <span className="break-words">{terminalError}</span>
              <button type="button" onClick={() => setTerminalError(null)} className="shrink-0 text-rose-300 hover:text-white" aria-label="Dismiss terminal error">×</button>
            </div>
          )}

          {/* Terminal surface */}
          <div className="relative flex-1 min-h-0 p-1.5">
            {activeSession && open ? (
              <div key={activeSession.id} ref={containerRef} className="w-full h-full" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs font-mono text-content-faint">
                No active console — press Run Server or CMD to open one.
              </div>
            )}
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between px-3 py-1 border-t border-line/70 text-[11px] font-mono text-content-faint shrink-0">
              {pasteProgress && (
                <span className="text-sky-300 shrink-0 mr-2">
                  {`Pasting ${Math.round(pasteProgress.sent / 1024)} / ${Math.max(1, Math.round(pasteProgress.total / 1024))} KB...`}
                </span>
              )}
              <span className="truncate">{activeSession?.cwd || '\u00a0'}</span>
              <span className="flex items-center gap-3 shrink-0 ml-4">
                {activeSession?.alive && (
                  <button
                    type="button"
                    onClick={() => stopSession(activeSession.id)}
                    title="Stop terminal"
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-rose-300 hover:bg-rose-500/10 border border-rose-500/30 transition-colors"
                  >
                    <Square className="w-3 h-3" fill="currentColor" />
                    Stop
                  </button>
                )}
              {activeSize && <span>{`${activeSize.cols}×${activeSize.rows}`}</span>}
              {activeSession && (
                <span
                  className={
                    !terminalReady
                      ? 'text-amber-400'
                      : connState === 'error'
                      ? 'text-rose-400'
                      : connState === 'connecting'
                      ? 'text-amber-400'
                      : connState === 'live'
                      ? 'text-emerald-400'
                      : activeSession.alive
                      ? 'text-emerald-400'
                      : 'text-slate-500'
                  }
                >
                  {!terminalReady
                    ? '◌ waiting for prompt'
                    : connState === 'error'
                    ? '● error'
                    : connState === 'connecting'
                    ? '◌ connecting'
                    : activeSession.alive
                    ? '● running'
                    : `○ exited${activeSession.exitCode ? ` (${activeSession.exitCode})` : ''}`}
                </span>
              )}
            </span>
          </div>
        </div>
      </>
    );
  }
);

TerminalDrawer.displayName = 'TerminalDrawer';

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

export interface TerminalDrawerHandle {
  create: (mode: TerminalMode) => Promise<TerminalSessionDto>;
  restartIfRunning: (mode: TerminalMode) => Promise<TerminalSessionDto | null>;
}

interface Props {
  projectId: string | null;
}

const DEFAULT_HEIGHT = 340;
const MIN_HEIGHT = 160;
const MAX_VIEWPORT_RATIO = 0.85;
const FULLSCREEN_RATIO = 0.94;
const HEIGHT_STORAGE_KEY = 'solodev_terminal_height_px';

const XTERM_THEME = {
  background: '#0b1120',
  foreground: '#e2e8f0',
  cursor: '#818cf8',
  cursorAccent: '#0b1120',
  selectionBackground: '#334155',
};

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
  inputTimer: number | null;
  pendingInput: string[];
  lastCols: number;
  lastRows: number;
  resizeTimer: number | null;
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
    const connStateRef = useRef<'idle' | 'connecting' | 'live' | 'error'>('idle');

    const sessionsRef = useRef<TerminalSessionDto[]>([]);
    const runtimeRef = useRef<TerminalRuntime>({
      term: null,
      fit: null,
      dataSub: null,
      abort: null,
      pumpStopped: true,
      inputTimer: null,
      pendingInput: [],
      lastCols: 0,
      lastRows: 0,
      resizeTimer: null,
    });

    const containerRef = useRef<HTMLDivElement | null>(null);
    const dragStateRef = useRef<{ startY: number; startH: number } | null>(null);
    const latestHeightRef = useRef<number>(heightPx);

    useEffect(() => {
      sessionsRef.current = sessions;
    }, [sessions]);
    useEffect(() => {
      latestHeightRef.current = heightPx;
    }, [heightPx]);
    useEffect(() => {
      if (!open || !activeId) setConnState('idle');
    }, [open, activeId]);
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
        setSessions(res.data || []);
        setActiveId(prev => {
          if (prev && res.data?.some(s => s.id === prev)) return prev;
          return res.data?.[res.data.length - 1]?.id ?? null;
        });
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

    const flushInput = useCallback((sessionId: string) => {
      const rt = runtimeRef.current;
      if (!rt.pendingInput.length) return;
      const data = rt.pendingInput.join('');
      rt.pendingInput = [];
      if (rt.inputTimer !== null) {
        window.clearTimeout(rt.inputTimer);
        rt.inputTimer = null;
      }
      api.post(`/terminals/${sessionId}/input/`, { data }).catch(() => {
        /* stream will surface any real failure */
      });
    }, []);

    const queueInput = useCallback(
      (sessionId: string, data: string) => {
        const rt = runtimeRef.current;
        rt.pendingInput.push(data);
        if (rt.inputTimer === null) {
          rt.inputTimer = window.setTimeout(() => flushInput(sessionId), 50);
        }
      },
      [flushInput]
    );

    const notifyBackendSize = useCallback((sessionId: string, cols: number, rows: number) => {
      const rt = runtimeRef.current;
      if (!(cols > 2 && rows > 2)) return;
      if (cols === rt.lastCols && rows === rt.lastRows) return;
      rt.lastCols = cols;
      rt.lastRows = rows;
      api.post(`/terminals/${sessionId}/resize/`, { cols, rows }).catch(() => {});
    }, []);

    const teardownRuntime = useCallback(() => {
      const rt = runtimeRef.current;
      rt.pumpStopped = true;
      if (rt.abort) {
        rt.abort.abort();
        rt.abort = null;
      }
      if (rt.inputTimer !== null) {
        window.clearTimeout(rt.inputTimer);
        rt.inputTimer = null;
      }
      if (rt.resizeTimer !== null) {
        window.clearTimeout(rt.resizeTimer);
        rt.resizeTimer = null;
      }
      try {
        rt.term?.dispose();
      } catch {
        /* already disposed */
      }
      rt.term = null;
      rt.fit = null;
      rt.lastCols = 0;
      rt.lastRows = 0;
      setActiveSize(null);
    }, []);

    useEffect(() => {
      if (!open || !activeId || !containerRef.current) {
        teardownRuntime();
        return undefined;
      }

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
        window.setTimeout(() => term.focus(), 0);
      };
      container.addEventListener('mousedown', onMouseDown);

      if (session?.alive !== false) {
        rt.dataSub = term.onData(data => queueInput(activeId, data));
      }

      const onResized = () => {
        try {
          fit.fit();
        } catch {
          return;
        }
        setActiveSize({ cols: term.cols, rows: term.rows });
        if (rt.resizeTimer !== null) return;
        rt.resizeTimer = window.setTimeout(() => {
          rt.resizeTimer = null;
          const t2 = rt.term;
          if (t2) notifyBackendSize(activeId, t2.cols, t2.rows);
        }, 120);
      };
      const ro = new ResizeObserver(onResized);
      ro.observe(container);

      // Initial resize kick so a slow ConPTY/cmd start flushes its banner promptly.
      term.write('\x1b[90mConnecting to console…\x1b[0m\r\n');
      window.setTimeout(() => notifyBackendSize(activeId, term.cols, term.rows), 200);

      // Stream: replay buffered output from offset 0, then follow live output.
      const ctrl = new AbortController();
      rt.abort = ctrl;
      rt.pumpStopped = false;
      const stopped = () => rt.pumpStopped || ctrl.signal.aborted;

      const pumpStreamOnce = async (): Promise<void> => {
        setConnState('connecting');
        const res = await authedFetch(
          `/terminals/${activeId}/output/?after=0`,
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
            if (evt.reset) term.reset();
            if (typeof evt.d === 'string' && evt.d) {
              term.write(evt.d);
              if (connStateRef.current !== 'live') setConnState('live');
            }
            if (evt.e === true) {
              markExited(activeId, (evt.c as number | null) ?? null);
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
              markExited(activeId, null);
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
      void runPump();

      return () => {
        ro.disconnect();
        container.removeEventListener('mousedown', onMouseDown);
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

    // ---------- imperative API ----------

    const create = useCallback(
      async (mode: TerminalMode): Promise<TerminalSessionDto> => {
        if (!projectId) throw new Error('No project selected.');
        setLoadingCreate(mode);
        try {
          const res = await api.post<TerminalSessionDto>(`/projects/${projectId}/terminals/`, { mode });
          const dto = res.data;
          setSessions(prev => [...prev.filter(s => s.id !== dto.id), dto]);
          setActiveId(dto.id);
          setOpen(true);
          return dto;
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
        setOpen(true);
        return dto;
      },
      [activeId, projectId, teardownRuntime]
    );

    useImperativeHandle(ref, () => ({ create, restartIfRunning }), [create, restartIfRunning]);

    // ---------- resize dragging ----------

    const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (fullscreen) return;
      e.preventDefault();
      dragStateRef.current = { startY: e.clientY, startH: latestHeightRef.current };

      const move = (ev: PointerEvent) => {
        const start = dragStateRef.current;
        if (!start) return;
        ev.preventDefault();
        setHeightPx(clampHeight(start.startH + (start.startY - ev.clientY)));
      };
      const up = () => {
        dragStateRef.current = null;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        persistHeightToStorage(latestHeightRef.current);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
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
      const remaining = sessionsRef.current.filter(s => s.id !== sessionId);
      setSessions(remaining);
      if (activeId === sessionId) {
        if (remaining.length > 0) {
          setActiveId(remaining[remaining - 1].id);
        } else {
          setActiveId(null);
          setOpen(false);
        }
      }
      api.delete(`/terminals/${sessionId}/`).catch(() => {});
    };

    const stopSession = useCallback(
      (sessionId: string) => {
        if (sessionId === activeId) {
          teardownRuntime();
          // Keep the panel open; the exit event will flip the tab to "exited".
          setActiveId(activeId);
        }
        markExited(sessionId, null);
        api.delete(`/terminals/${sessionId}/`).catch(() => {});
      },
      [activeId]
    );

    const collapse = () => setOpen(false);

    const anyLive = sessions.some(s => s.alive);
    const activeSession = sessions.find(s => s.id === activeId) ?? null;
    const effectiveHeight = fullscreen ? Math.floor(window.innerHeight * FULLSCREEN_RATIO) : heightPx;

    return (
      <>
        {!open && anyLive && (
          <button
            type="button"
            onClick={() => setOpen(true)}
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

        <div
          className={`fixed left-0 right-0 bottom-0 z-40 flex flex-col bg-slate-950/95 backdrop-blur-md border-t border-x border-line shadow-[0_-16px_48px_rgba(0,0,0,0.55)] transition-transform duration-200 ${
            open ? 'translate-y-0' : 'translate-y-full pointer-events-none'
          }`}
          style={{ height: `${effectiveHeight}px` }}
          aria-hidden={!open}
        >
          {/* Drag handle */}
          <div
            onPointerDown={onHandlePointerDown}
            onDoubleClick={resetHeight}
            title={fullscreen ? 'Exit fullscreen' : 'Drag to resize • double-click to reset'}
            className={`group h-2 w-full shrink-0 cursor-row-resize flex items-center justify-center select-none touch-none ${
              fullscreen ? '' : 'hover:bg-indigo-500/20'
            }`}
          >
            <div
              className={`h-1 w-24 rounded-full bg-slate-700 group-hover:bg-indigo-400 transition-colors ${
                fullscreen ? 'opacity-30' : ''
              }`}
            />
          </div>

          {/* Tab strip */}
          <div className="flex items-stretch gap-1 px-3 pt-1 pb-0 overflow-x-auto scrollbar-none shrink-0 border-b border-line/70">
            {sessions.map(s => {
              const isActive = s.id === activeId;
              const Icon = s.mode === 'script' ? Zap : TerminalIcon;
              return (
                <div
                  key={s.id}
                  onClick={() => setActiveId(s.id)}
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
                    {s.mode === 'script' ? 'server' : 'cmd'}
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
                    className="ml-1 p-0.5 rounded-md text-content-faint opacity-0 group-hover:opacity-100 hover:text-rose-300 transition-all"
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
                    title="New server console (.bat)"
                    onClick={() => void create('script').catch(() => {})}
                    className="p-1.5 rounded-lg text-content-faint hover:text-emerald-300 hover:bg-surface-2 transition-colors disabled:opacity-30"
                  >
                    {loadingCreate === 'script' ? (
                      <div className="w-3.5 h-3.5 border-2 border-emerald-800 border-t-emerald-300 rounded-full animate-spin" />
                    ) : (
                      <Zap className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={!open}
                    title="New CMD console"
                    onClick={() => void create('cmd').catch(() => {})}
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
                    connState === 'error'
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
                  {connState === 'error'
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

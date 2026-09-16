/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CloudAuthProvider } from './context/CloudAuthContext';
import { Navigation } from './components/Navigation';
import { DashboardView } from './components/DashboardView';
import { ProjectsView } from './components/ProjectsView';
import { PriorityMatrixView } from './components/PriorityMatrixView';
import { IdeasView } from './components/IdeasView';
import { TimeTrackerView } from './components/TimeTrackerView';
import { QuickAddModal } from './components/QuickAddModal';
import { AuthView } from './components/AuthView';
import { CommandPalette } from './components/CommandPalette';
import { ActiveTerminalsPill } from './components/ActiveTerminalsPill';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toaster';
import { CloudSyncManager } from './components/CloudSyncManager';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './services/queryClient';
import { api, authedFetch } from './services/api';
import { useLiveTerminals } from './hooks/useLiveTerminals';
import {
  extractPetLines,
  getPetSnapshotFor,
  getPetSnapshots,
  getTerminalPetSnapshot,
  subscribeTerminalPetSnapshot,
  type TerminalPetSnapshot,
} from './services/terminalPetFeed';

export type CompanionTerminalStatus = 'running' | 'done' | 'exited' | 'idle';

export interface CompanionTerminalState {
  status: CompanionTerminalStatus;
  projectTitle: string;
  mode: string;
  exitCode: number | null;
  lines: string[];
  doneAt: number | null;
  updatedAt: number;
}

export interface CompanionTerminalOption {
  sessionId: string;
  projectTitle: string;
}

export type CompanionCommand =
  | string
  | { type: 'pet-input'; sessionId?: string; text?: string }
  | { type: 'pet-interrupt'; sessionId?: string }
  | { type: 'set-watched'; sessionId?: string | null };

const TERMINAL_DONE_QUIET_MS = 2000;
const TERMINAL_STALE_MS = 15000;
const WATCHED_STORAGE_KEY = 'solodev_pet_watched_cmd';
const PET_INPUT_MAX = 4000;
// Local copies (TerminalDrawer owns the canonical ones, but importing that
// module would pull xterm CSS into App): strip stream formatting and detect
// a trailing CMD prompt for the watched-tail poller below.
const PET_ANSI_RE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g;
const PET_CMD_PROMPT_RE = /(?:^|\r?\n)(?:\([^\r\n)]*\)\s*)?[A-Za-z]:\\[^\r\n>]*>\s*$/;

function loadStoredWatched(): string | null {
  try {
    const raw = window.localStorage.getItem(WATCHED_STORAGE_KEY);
    return raw ? raw : null;
  } catch {
    return null;
  }
}

function resolveCompanionTerminal(
  snapshot: TerminalPetSnapshot | null,
  liveIds: Set<string>,
  now: number,
): CompanionTerminalState | null {
  if (!snapshot) return null;
  if (now - snapshot.updatedAt > 60000 && !liveIds.has(snapshot.sessionId)) return null;
  // The live list only contains alive sessions: if it has loaded and the
  // snapshot session is gone while the snapshot itself is stale, the
  // session exited without the drawer noticing (e.g. drawer closed).
  const alive = snapshot.alive && (liveIds.has(snapshot.sessionId) || now - snapshot.updatedAt < TERMINAL_STALE_MS);
  let status: CompanionTerminalStatus;
  let doneAt: number | null = null;
  if (!alive) {
    status = 'exited';
    doneAt = snapshot.updatedAt;
  } else if (snapshot.lastOutputAt > 0 && now - snapshot.lastOutputAt >= TERMINAL_DONE_QUIET_MS && snapshot.promptReady) {
    status = 'done';
    doneAt = snapshot.lastOutputAt + TERMINAL_DONE_QUIET_MS;
  } else if (snapshot.lastOutputAt > 0) {
    status = 'running';
  } else {
    status = 'idle';
  }
  return {
    status,
    projectTitle: snapshot.projectTitle,
    mode: snapshot.mode,
    exitCode: snapshot.exitCode,
    lines: extractPetLines(snapshot.tailText, 30, 120),
    doneAt,
    updatedAt: snapshot.updatedAt,
  };
}

const DesktopCompanionBridge: React.FC = () => {
  const { projects, tasks, timeTracker, startTimer, pauseTimer, resumeTimer, setCurrentView, setSelectedProjectId, openQuickAdd } = useApp();
  const { isAuthenticated } = useAuth();
  const [focusIds, setFocusIds] = useState<string[]>([]);
  const [petSnapshot, setPetSnapshot] = useState<TerminalPetSnapshot | null>(() => getTerminalPetSnapshot());
  const [petSnapshots, setPetSnapshots] = useState<Record<string, TerminalPetSnapshot>>(() => getPetSnapshots());
  const [petTick, setPetTick] = useState(() => Date.now());
  const [storedWatched, setStoredWatched] = useState<string | null>(() => loadStoredWatched());
  const [watchedRemote, setWatchedRemote] = useState<TerminalPetSnapshot | null>(null);
  const { sessions: liveSessions } = useLiveTerminals();
  useEffect(() => subscribeTerminalPetSnapshot((latest, all) => {
    setPetSnapshot(latest);
    if (all) setPetSnapshots(all);
  }), []);
  useEffect(() => {
    try {
      if (storedWatched) window.localStorage.setItem(WATCHED_STORAGE_KEY, storedWatched);
      else window.localStorage.removeItem(WATCHED_STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }, [storedWatched]);
  useEffect(() => {
    const t = window.setInterval(() => setPetTick(Date.now()), 2000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => { if (!isAuthenticated) { setFocusIds([]); return; } let active = true; const load = () => { void api.get('/daily-focus/').then(res => { if (active) setFocusIds(Array.isArray(res.data?.task_ids) ? res.data.task_ids : []); }).catch(() => {}); }; load(); const interval = window.setInterval(load, 15000); return () => { active = false; window.clearInterval(interval); }; }, [isAuthenticated]);
  const liveIds = new Set(liveSessions.map(s => s.id));
  const cmdOptions: CompanionTerminalOption[] = liveSessions
    .filter(s => s.mode === 'cmd')
    .map(s => ({ sessionId: s.id, projectTitle: s.projectTitle || 'Console' }));
  // The pet pins one CMD session. A stored pin that vanished (session closed)
  // falls back temporarily without forgetting the pin; an empty pin defaults
  // to the freshest CMD snapshot or the first live CMD session.
  const knownIds = new Set([...cmdOptions.map(o => o.sessionId), ...Object.keys(petSnapshots)]);
  const effectiveWatched = storedWatched && knownIds.has(storedWatched)
    ? storedWatched
    : (() => {
      const cmdSnaps = Object.values(petSnapshots).filter(s => s.mode === 'cmd').sort((a, b) => b.updatedAt - a.updatedAt);
      return cmdSnaps[0]?.sessionId ?? cmdOptions[0]?.sessionId ?? null;
    })();
  const effectiveWatchedRef = useRef<string | null>(null);
  effectiveWatchedRef.current = effectiveWatched;
  // Background tail for the watched CMD: the drawer only streams its own
  // project, so a pinned session from another project (or a closed drawer)
  // would otherwise show nothing. Poll the retained output buffer directly.
  useEffect(() => {
    if (!isAuthenticated || !effectiveWatched) {
      setWatchedRemote(null);
      return;
    }
    let cancelled = false;
    const watchedId = effectiveWatched;
    const optionTitle = cmdOptions.find(o => o.sessionId === watchedId)?.projectTitle;
    const poll = async () => {
      if (cancelled) return;
      const drawerSnap = getPetSnapshotFor(watchedId);
      if (drawerSnap && Date.now() - drawerSnap.updatedAt < 5000) {
        if (!cancelled) setWatchedRemote(null);
        return;
      }
      const ctrl = new AbortController();
      const abortTimer = window.setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await authedFetch(
          `/terminals/${watchedId}/output/?after=0`,
          { method: 'GET', headers: { Accept: 'application/x-ndjson' }, signal: ctrl.signal },
        );
        if (!res.ok || !res.body || cancelled) return;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let text = '';
        try {
          for (let i = 0; i < 30; i += 1) {
            const { done, value } = await reader.read();
            if (value) buf += decoder.decode(value, { stream: true });
            let nlIndex: number;
            while ((nlIndex = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, nlIndex).trim();
              buf = buf.slice(nlIndex + 1);
              if (!line) continue;
              try {
                const evt = JSON.parse(line) as { d?: unknown };
                if (typeof evt.d === 'string' && evt.d) text = `${text}${evt.d}`.slice(-8192);
              } catch {
                /* partial line */
              }
            }
            if (text.length >= 4000 || done || cancelled) break;
          }
        } finally {
          try {
            await reader.cancel();
          } catch {
            /* stream already closed */
          }
        }
        if (cancelled || !text) return;
        const now = Date.now();
        const stripped = text.replace(PET_ANSI_RE, '');
        setWatchedRemote({
          sessionId: watchedId,
          projectId: null,
          projectTitle: optionTitle ?? drawerSnap?.projectTitle ?? '',
          mode: 'cmd',
          alive: true,
          exitCode: null,
          tailText: stripped.slice(-4000),
          promptReady: PET_CMD_PROMPT_RE.test(stripped.slice(-1024)),
          lastOutputAt: now,
          revision: now,
          updatedAt: now,
        });
      } catch {
        /* offline / session gone: the live list corrects liveness below */
      } finally {
        window.clearTimeout(abortTimer);
      }
    };
    void poll();
    const t = window.setInterval(poll, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [isAuthenticated, effectiveWatched, liveSessions]);
  useEffect(() => {
    const bridge = window.solodevDesktop;
    if (!bridge) return;
    if (!isAuthenticated) { bridge.updateCompanionState({ reportedAt: Date.now(), loggedOut: true, timer: null, task: null }); return; }
    const activeTask = tasks.find(task => task.id === timeTracker.taskId);
    const suggested = focusIds.map(id => tasks.find(task => task.id === id)).find(task => task && !task.completed) || tasks.find(task => !task.completed);
    const watchedSnapshot = (effectiveWatched && (petSnapshots[effectiveWatched] ?? (watchedRemote?.sessionId === effectiveWatched ? watchedRemote : null)))
      ?? petSnapshot;
    const terminal = resolveCompanionTerminal(watchedSnapshot, liveIds, petTick);
    bridge.updateCompanionState({ reportedAt: Date.now(),
      timer: timeTracker.isRunning || timeTracker.projectId ? { active: Boolean(timeTracker.isRunning || timeTracker.secondsElapsed), paused: !timeTracker.isRunning, secondsRemaining: timeTracker.secondsRemaining, secondsElapsed: timeTracker.secondsElapsed, taskTitle: activeTask?.title || '', projectTitle: projects.find(project => project.id === timeTracker.projectId)?.title || '' } : null,
      task: suggested ? { title: suggested.title, projectTitle: projects.find(project => project.id === suggested.projectId)?.title || '', taskId: suggested.id, projectId: suggested.projectId } : null,
      terminal,
      terminalOptions: cmdOptions,
      watchedSessionId: effectiveWatched,
    });
  }, [projects, tasks, timeTracker, isAuthenticated, focusIds, petSnapshot, petSnapshots, watchedRemote, petTick, liveSessions, effectiveWatched]);
  useEffect(() => {
    const bridge = window.solodevDesktop;
    if (!bridge) return;
    return bridge.onCompanionCommand((command: CompanionCommand) => {
      if (typeof command === 'string') {
        const suggested = tasks.find(task => !task.completed);
        if (command === 'pause') pauseTimer();
        else if (command === 'resume') resumeTimer();
        else if (command === 'start-focus' && suggested) startTimer('pomodoro', suggested.projectId, suggested.id);
        else if (command === 'restore-task') { const target = timeTracker.taskId ? tasks.find(task => task.id === timeTracker.taskId) : suggested; if (target) { setSelectedProjectId(target.projectId); setCurrentView('projects'); openQuickAdd('task', { taskId: target.id }); } else setCurrentView('projects'); }
        return;
      }
      if (!command || typeof command !== 'object') return;
      if (command.type === 'set-watched') {
        const id = typeof command.sessionId === 'string' && command.sessionId ? command.sessionId : null;
        setStoredWatched(id);
        return;
      }
      const targetId = (typeof command.sessionId === 'string' && command.sessionId)
        ? command.sessionId
        : effectiveWatchedRef.current;
      if (!targetId) return;
      if (command.type === 'pet-interrupt') {
        void api.post(`/terminals/${targetId}/input/`, { data: '\x03' }).catch(() => {});
        return;
      }
      if (command.type === 'pet-input') {
        const text = typeof command.text === 'string' ? command.text.slice(0, PET_INPUT_MAX) : '';
        if (!text.trim()) return;
        const data = /[\r\n]$/.test(text) ? text : `${text}\r`;
        void api.post(`/terminals/${targetId}/input/`, { data }).catch(() => {});
      }
    });
  }, [tasks, timeTracker.taskId, timeTracker.projectId, pauseTimer, resumeTimer, startTimer, setCurrentView, setSelectedProjectId, openQuickAdd]);
  return null;
};

const TimelineDeadlinesView = React.lazy(() => import('./components/TimelineDeadlinesView').then(m => ({ default: m.TimelineDeadlinesView })));
const SettingsView = React.lazy(() => import('./components/SettingsView').then(m => ({ default: m.SettingsView })));

const ViewFallback: React.FC<{ label: string }> = ({ label }) => (
  <div className="space-y-3" aria-busy="true" aria-label={`Loading ${label}`}>
    <div className="h-16 rounded-2xl bg-surface-2 border border-line animate-pulse" />
    <div className="h-64 rounded-2xl bg-surface-2 border border-line animate-pulse" />
  </div>
);

const MainContent: React.FC<{ authenticated: boolean; sidebarCollapsed: boolean }> = ({ authenticated, sidebarCollapsed }) => {
  const { currentView } = useApp();
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <main id="main-content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="text-sm text-content-faint font-mono" role="status">Loading session…</div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main id="main-content" className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <AuthView />
      </main>
    );
  }

  return (
    <main id="main-content" className={`mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 lg:px-8 lg:pb-8 transition-[margin] duration-200 ${authenticated ? `pt-24 ${sidebarCollapsed ? 'md:ml-[var(--sidebar-w,76px)]' : 'md:ml-[var(--sidebar-w,256px)]'} md:pt-24` : ''}`}>
      {currentView === 'dashboard' && <ErrorBoundary fallbackLabel="dashboard"><DashboardView /></ErrorBoundary>}
      {currentView === 'projects' && <ErrorBoundary fallbackLabel="projects"><ProjectsView /></ErrorBoundary>}
      {currentView === 'matrix' && <ErrorBoundary fallbackLabel="priority matrix"><PriorityMatrixView /></ErrorBoundary>}
      {currentView === 'ideas' && <ErrorBoundary fallbackLabel="ideas"><IdeasView /></ErrorBoundary>}
      {currentView === 'timetracker' && <ErrorBoundary fallbackLabel="focus timer"><TimeTrackerView /></ErrorBoundary>}
      {currentView === 'timeline' && <ErrorBoundary fallbackLabel="timeline"><React.Suspense fallback={<ViewFallback label="timeline" />}><TimelineDeadlinesView /></React.Suspense></ErrorBoundary>}
      {currentView === 'settings' && <ErrorBoundary fallbackLabel="settings"><React.Suspense fallback={<ViewFallback label="settings" />}><SettingsView /></React.Suspense></ErrorBoundary>}
      <QuickAddModal />
      <CommandPalette />
    </main>
  );
};

const AppFrame: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem('solodev_sidebar_collapsed') === 'true');
  useEffect(() => { localStorage.setItem('solodev_sidebar_collapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-50 text-slate-900 transition-colors dark:bg-surface-inverse dark:text-slate-100" style={{ ['--sidebar-w' as string]: sidebarCollapsed ? '76px' : '256px' }}>
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white">Skip to main content</a>
      <div className="pointer-events-none fixed -right-24 -top-24 -z-10 h-96 w-96 rounded-full bg-indigo-500/10 blur-[120px]" aria-hidden="true" />
      <div className="pointer-events-none fixed -bottom-24 -left-24 -z-10 h-96 w-96 rounded-full bg-emerald-500/5 blur-[120px]" aria-hidden="true" />
      <Navigation collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)} />
      <MainContent authenticated={isAuthenticated} sidebarCollapsed={sidebarCollapsed} />
      {isAuthenticated && <ActiveTerminalsPill />}
    </div>
  );
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CloudAuthProvider>
          <AppProvider>
            <ToastProvider>
              <DesktopCompanionBridge />
              <CloudSyncManager />
              <AppFrame />
            </ToastProvider>
          </AppProvider>
        </CloudAuthProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

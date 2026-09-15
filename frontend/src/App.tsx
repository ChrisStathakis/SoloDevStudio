/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
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
import { api } from './services/api';
import { useLiveTerminals } from './hooks/useLiveTerminals';
import {
  extractPetLines,
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

const TERMINAL_DONE_QUIET_MS = 2000;
const TERMINAL_STALE_MS = 15000;

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
    lines: extractPetLines(snapshot.tailText),
    doneAt,
    updatedAt: snapshot.updatedAt,
  };
}

const DesktopCompanionBridge: React.FC = () => {
  const { projects, tasks, timeTracker, startTimer, pauseTimer, resumeTimer, setCurrentView, setSelectedProjectId, openQuickAdd } = useApp();
  const { isAuthenticated } = useAuth();
  const [focusIds, setFocusIds] = useState<string[]>([]);
  const [petSnapshot, setPetSnapshot] = useState<TerminalPetSnapshot | null>(() => getTerminalPetSnapshot());
  const [petTick, setPetTick] = useState(() => Date.now());
  const { sessions: liveSessions } = useLiveTerminals();
  useEffect(() => subscribeTerminalPetSnapshot(setPetSnapshot), []);
  useEffect(() => {
    if (!petSnapshot) return;
    const t = window.setInterval(() => setPetTick(Date.now()), 2000);
    return () => window.clearInterval(t);
  }, [petSnapshot]);
  useEffect(() => { if (!isAuthenticated) { setFocusIds([]); return; } let active = true; const load = () => { void api.get('/daily-focus/').then(res => { if (active) setFocusIds(Array.isArray(res.data?.task_ids) ? res.data.task_ids : []); }).catch(() => {}); }; load(); const interval = window.setInterval(load, 15000); return () => { active = false; window.clearInterval(interval); }; }, [isAuthenticated]);
  useEffect(() => {
    const bridge = window.solodevDesktop;
    if (!bridge) return;
    if (!isAuthenticated) { bridge.updateCompanionState({ reportedAt: Date.now(), loggedOut: true, timer: null, task: null }); return; }
    const activeTask = tasks.find(task => task.id === timeTracker.taskId);
    const suggested = focusIds.map(id => tasks.find(task => task.id === id)).find(task => task && !task.completed) || tasks.find(task => !task.completed);
    const liveIds = new Set(liveSessions.map(s => s.id));
    const terminal = resolveCompanionTerminal(petSnapshot, liveIds, petTick);
    bridge.updateCompanionState({ reportedAt: Date.now(),
      timer: timeTracker.isRunning || timeTracker.projectId ? { active: Boolean(timeTracker.isRunning || timeTracker.secondsElapsed), paused: !timeTracker.isRunning, secondsRemaining: timeTracker.secondsRemaining, secondsElapsed: timeTracker.secondsElapsed, taskTitle: activeTask?.title || '', projectTitle: projects.find(project => project.id === timeTracker.projectId)?.title || '' } : null,
      task: suggested ? { title: suggested.title, projectTitle: projects.find(project => project.id === suggested.projectId)?.title || '', taskId: suggested.id, projectId: suggested.projectId } : null,
      terminal,
    });
  }, [projects, tasks, timeTracker, isAuthenticated, focusIds, petSnapshot, petTick, liveSessions]);
  useEffect(() => {
    const bridge = window.solodevDesktop;
    if (!bridge) return;
    return bridge.onCompanionCommand(command => {
      const suggested = tasks.find(task => !task.completed);
      if (command === 'pause') pauseTimer();
      else if (command === 'resume') resumeTimer();
      else if (command === 'start-focus' && suggested) startTimer('pomodoro', suggested.projectId, suggested.id);
      else if (command === 'restore-task') { const target = timeTracker.taskId ? tasks.find(task => task.id === timeTracker.taskId) : suggested; if (target) { setSelectedProjectId(target.projectId); setCurrentView('projects'); openQuickAdd('task', { taskId: target.id }); } else setCurrentView('projects'); }
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

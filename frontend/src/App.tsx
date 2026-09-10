/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AuthProvider, useAuth } from './context/AuthContext';
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
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './services/queryClient';

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
        <AppProvider>
          <ToastProvider>
            <AppFrame />
          </ToastProvider>
        </AppProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

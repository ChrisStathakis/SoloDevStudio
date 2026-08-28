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
import { TimelineDeadlinesView } from './components/TimelineDeadlinesView';
import { SettingsView } from './components/SettingsView';
import { QuickAddModal } from './components/QuickAddModal';
import { AuthView } from './components/AuthView';

const MainContent: React.FC<{ authenticated: boolean; sidebarCollapsed: boolean }> = ({ authenticated, sidebarCollapsed }) => {
  const { currentView } = useApp();
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="text-sm text-content-faint font-mono">Loading session…</div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <AuthView />
      </main>
    );
  }

  return (
    <main className={`mx-auto max-w-7xl px-4 py-8 pb-24 sm:px-6 lg:px-8 lg:pb-8 ${authenticated ? `pt-24 ${sidebarCollapsed ? 'md:ml-[76px]' : 'md:ml-64'} md:pt-24` : ''}`}>
      {currentView === 'dashboard' && <DashboardView />}
      {currentView === 'projects' && <ProjectsView />}
      {currentView === 'matrix' && <PriorityMatrixView />}
      {currentView === 'ideas' && <IdeasView />}
      {currentView === 'timetracker' && <TimeTrackerView />}
      {currentView === 'timeline' && <TimelineDeadlinesView />}
      {currentView === 'settings' && <SettingsView />}
      <QuickAddModal />
    </main>
  );
};

const AppFrame: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => localStorage.getItem('solodev_sidebar_collapsed') === 'true');
  useEffect(() => { localStorage.setItem('solodev_sidebar_collapsed', String(sidebarCollapsed)); }, [sidebarCollapsed]);
  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-50 text-slate-900 transition-colors dark:bg-surface-inverse dark:text-slate-100">
      <div className="pointer-events-none fixed -right-24 -top-24 -z-10 h-96 w-96 rounded-full bg-indigo-500/10 blur-[120px]" />
      <div className="pointer-events-none fixed -bottom-24 -left-24 -z-10 h-96 w-96 rounded-full bg-emerald-500/5 blur-[120px]" />
      <Navigation collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(v => !v)} />
      <MainContent authenticated={isAuthenticated} sidebarCollapsed={sidebarCollapsed} />
    </div>
  );
};

export default function App() {
  return (
    <AuthProvider>
      <AppProvider>
        <AppFrame />
      </AppProvider>
    </AuthProvider>
  );
}

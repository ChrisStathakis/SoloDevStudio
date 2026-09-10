import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useLiveTerminals, requestTerminalOpen } from '../hooks/useLiveTerminals';
import { LayoutDashboard, FolderKanban, Lightbulb, Grid2X2, Timer, CalendarClock, Plus, Moon, Sun, Play, Pause, Search, Layers, Settings, PanelLeftClose, PanelLeftOpen, MoreHorizontal, X, Terminal as TerminalIcon, ChevronDown, Zap } from 'lucide-react';
import { ActiveView } from '../types';
import { Button, IconButton } from './ui';

export const Navigation: React.FC<{ collapsed: boolean; onToggle: () => void }> = ({ collapsed, onToggle }) => {
  const { isAuthenticated } = useAuth();
  const { currentView, setCurrentView, selectedProjectId, setSelectedProjectId, isDarkMode, toggleDarkMode, searchQuery, setSearchQuery, timeTracker, pauseTimer, resumeTimer, openQuickAdd, projects, tasks, ideas } = useApp();
  const { byProject: liveProjects } = useLiveTerminals();
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const openLiveProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    setCurrentView('projects');
    setLiveOpen(false);
    requestTerminalOpen(projectId);
  };
  if (!isAuthenticated) return null;
  const formatTimer = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  const navItems: { id: ActiveView; label: string; icon: React.ComponentType<{ className?: string }>; count?: number }[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }, { id: 'projects', label: 'Projects', icon: FolderKanban, count: projects.length },
    { id: 'matrix', label: 'Priority Matrix', icon: Grid2X2, count: tasks.filter(t => !t.completed).length }, { id: 'ideas', label: 'Idea Canvas', icon: Lightbulb, count: ideas.filter(i => i.status !== 'archived').length },
    { id: 'timetracker', label: 'Focus & Timer', icon: Timer }, { id: 'timeline', label: 'Timeline', icon: CalendarClock },
  ];
  const navigate = (view: ActiveView) => {
    if (view === 'projects' && selectedProjectId) setSelectedProjectId(null);
    setCurrentView(view);
    setMoreOpen(false);
  };
  return <>
    <aside className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-line bg-surface/95 dark:bg-surface-inverse/95 backdrop-blur-xl transition-[width] duration-200 md:flex ${collapsed ? 'w-[76px]' : 'w-64'}`}>
      <div className={`flex h-20 items-center border-b border-line px-4 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        <button type="button" onClick={() => navigate('dashboard')} className="flex items-center gap-3 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500 text-white shadow-lg shadow-indigo-500/20"><Layers className="h-5 w-5" /></span>{!collapsed && <span><span className="block text-sm font-extrabold tracking-tight text-content">SoloDev Studio</span><span className="mt-0.5 block text-[10px] font-bold uppercase tracking-[0.16em] text-content-muted">Build with intent</span></span>}</button>
        {!collapsed && <IconButton label="Collapse sidebar" onClick={onToggle}><PanelLeftClose className="h-4 w-4" /></IconButton>}
      </div>
      {collapsed && <IconButton label="Expand sidebar" onClick={onToggle} className="mx-auto mt-3"><PanelLeftOpen className="h-4 w-4" /></IconButton>}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-6" aria-label="Primary navigation"><p className={`mb-3 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-content-muted ${collapsed ? 'sr-only' : ''}`}>Workspace</p>{navItems.map(({ id, label, icon: Icon, count }) => { const active = currentView === id; return <button key={id} type="button" onClick={() => navigate(id)} title={collapsed ? label : undefined} aria-current={active ? 'page' : undefined} className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${active ? 'bg-indigo-500/15 text-indigo-700 dark:text-indigo-200' : 'text-content-muted hover:bg-surface-2 hover:text-content'} ${collapsed ? 'justify-center' : ''}`}><Icon className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-indigo-700 dark:text-indigo-300' : 'text-content-muted group-hover:text-content'}`} />{!collapsed && <><span className="min-w-0 flex-1 truncate">{label}</span>{count !== undefined && count > 0 && <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${active ? 'bg-indigo-500/20 text-indigo-700 dark:text-indigo-200' : 'bg-surface-2 text-content-muted'}`}>{count}</span>}</>}</button>; })}</nav>
      <div className={`border-t border-line p-3 ${collapsed ? 'space-y-2' : 'space-y-3'}`}>{timeTracker.isRunning || timeTracker.secondsElapsed > 0 ? <div className={`flex w-full items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-2.5 ${collapsed ? 'justify-center' : ''}`} title={collapsed ? 'Active timer' : undefined}><span className={`h-2 w-2 shrink-0 rounded-full ${timeTracker.isRunning ? 'animate-pulse bg-emerald-400' : 'bg-content-muted'}`} aria-hidden="true" />{!collapsed && <><button type="button" onClick={() => navigate('timetracker')} className="flex-1 rounded-lg text-left font-mono text-xs font-bold text-emerald-700 dark:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" aria-label="Go to focus timer">{formatTimer(timeTracker.mode === 'pomodoro' ? timeTracker.secondsRemaining : timeTracker.secondsElapsed)}</button><button type="button" aria-label={timeTracker.isRunning ? 'Pause timer' : 'Resume timer'} onClick={() => { timeTracker.isRunning ? pauseTimer() : resumeTimer(); }} className="rounded-lg bg-emerald-400 p-1.5 text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200">{timeTracker.isRunning ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}</button></>}</div> : null}<div className={`flex items-center gap-2 ${collapsed ? 'flex-col' : ''}`}><IconButton label={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggleDarkMode}>{isDarkMode ? <Sun className="h-4 w-4 text-amber-700 dark:text-amber-300" /> : <Moon className="h-4 w-4" />}</IconButton><IconButton label="Settings" onClick={() => navigate('settings')} aria-current={currentView === 'settings' ? 'page' : undefined} className={currentView === 'settings' ? 'bg-surface-2 text-content' : ''}><Settings className="h-4 w-4" /></IconButton>{!collapsed && <span className="ml-auto text-[10px] font-mono text-content-muted">v1.0</span>}</div></div>
    </aside>
    <header className="fixed inset-x-0 top-0 z-30 hidden h-16 items-center gap-4 border-b border-line bg-surface/90 dark:bg-surface-inverse/85 px-6 backdrop-blur-xl md:flex md:left-[var(--sidebar-w,256px)]"><div className="min-w-0 flex-1"><h1 className="truncate text-sm font-bold text-content">{navItems.find(n => n.id === currentView)?.label || 'Settings'}</h1><p className="hidden text-[11px] text-content-muted lg:block">A clear place for your next deliberate move.</p></div>{liveProjects.length > 0 && <div className="relative hidden shrink-0 md:block">
        <button
          type="button"
          onClick={() => setLiveOpen(v => !v)}
          aria-expanded={liveOpen}
          aria-label={liveOpen ? 'Collapse live projects' : `Expand live projects: ${liveProjects.map(g => g.projectTitle).join(', ')}`}
          onKeyDown={e => { if (e.key === 'Escape') setLiveOpen(false); }}
          title={liveProjects.map(g => `${g.projectTitle} (${g.count})`).join(', ')}
          className="flex max-w-56 items-center gap-2 rounded-xl border border-line bg-surface-2 py-2 pl-3 pr-2.5 text-xs font-bold text-content outline-none transition hover:border-indigo-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20"
        >
          <TerminalIcon className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left">{liveProjects.length === 1 ? liveProjects[0].projectTitle : `${liveProjects.length} live projects`}</span>
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-content-muted transition-transform ${liveOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {liveOpen && <ul role="listbox" aria-label="Live project consoles" className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
          {liveProjects.map(g => (
            <li key={g.projectId}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                aria-label={`Open project ${g.projectTitle} (live console)`}
                title={`${g.projectTitle} — ${g.count} live console${g.count > 1 ? 's' : ''}`}
                onClick={() => openLiveProject(g.projectId)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: projects.find(p => p.id === g.projectId)?.color || '#6366f1' }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-xs font-bold text-content">{g.projectTitle}</span>
                {g.hasCmd && <span title="CMD console" className="flex shrink-0 items-center gap-0.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] font-black text-sky-700 dark:text-sky-300"><TerminalIcon className="h-3 w-3" />CMD</span>}
                {g.hasScript && <span title="Run Server console" className="flex shrink-0 items-center gap-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] font-black text-emerald-700 dark:text-emerald-300"><Zap className="h-3 w-3" />{g.hasCmd && g.count > 1 ? `×${g.count}` : 'SRV'}</span>}
              </button>
            </li>
          ))}
        </ul>}
      </div>}<div className="relative hidden w-64 lg:block"><label htmlFor="global-search-input" className="sr-only">Search workspace</label><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" aria-hidden="true" /><input id="global-search-input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search workspace" className="w-full rounded-xl border border-line bg-surface-2 py-2 pl-9 pr-3 text-xs text-content outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/20" /></div><Button size="sm" onClick={() => openQuickAdd('task')}><Plus className="h-4 w-4" />New action</Button></header>
    <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-line bg-surface/90 dark:bg-surface-inverse/90 px-4 backdrop-blur-xl md:hidden"><button type="button" onClick={() => navigate('dashboard')} className="flex shrink-0 items-center gap-2 rounded-lg text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-white"><Layers className="h-4 w-4" /></span><span className="text-sm font-extrabold">SoloDev Studio</span></button>{mobileSearchOpen ? <><label htmlFor="mobile-search-input" className="sr-only">Search workspace</label><input autoFocus id="mobile-search-input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search" className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-xs text-content outline-none focus:border-indigo-400" /></> : <span className="min-w-0 flex-1" /> }<div className="flex shrink-0 items-center gap-1"><IconButton label={mobileSearchOpen ? 'Close search' : 'Search workspace'} onClick={() => setMobileSearchOpen(v => !v)}>{mobileSearchOpen ? <X className="h-4 w-4" /> : <Search className="h-4 w-4" />}</IconButton><IconButton label="New action" onClick={() => openQuickAdd('task')}><Plus className="h-4 w-4" /></IconButton></div></header>
    <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-line bg-surface/95 dark:bg-surface-inverse/95 px-2 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur-xl md:hidden" aria-label="Mobile navigation">{[navItems[0], navItems[1], navItems[3], navItems[2], navItems[4]].map(({ id, label, icon: Icon }) => { const active = currentView === id; return <button key={id} type="button" onClick={() => navigate(id)} aria-label={label} aria-current={active ? 'page' : undefined} className={`flex min-w-14 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${active ? 'text-indigo-700 dark:text-indigo-300' : 'text-content-muted'}`}><Icon className="h-5 w-5" aria-hidden="true" /><span>{id === 'timetracker' ? 'Focus' : id === 'ideas' ? 'Ideas' : label.split(' ')[0]}</span></button>; })}<button type="button" onClick={() => setMoreOpen(v => !v)} aria-expanded={moreOpen} aria-label="More workspace" className={`flex min-w-14 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[10px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${moreOpen ? 'text-indigo-700 dark:text-indigo-300' : 'text-content-muted'}`}><MoreHorizontal className="h-5 w-5" aria-hidden="true" /><span>More</span></button></nav>
    {moreOpen && <div className="fixed inset-x-3 bottom-20 z-40 rounded-2xl border border-line bg-surface p-2 shadow-2xl md:hidden" role="dialog" aria-label="More workspace"><div className="flex items-center justify-between px-3 py-2"><span className="text-xs font-bold text-content">More workspace</span><IconButton label="Close menu" onClick={() => setMoreOpen(false)}><X className="h-4 w-4" /></IconButton></div>{[navItems[5], { id: 'settings' as ActiveView, label: 'Settings', icon: Settings }].map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => navigate(id)} aria-current={currentView === id ? 'page' : undefined} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold text-content-muted hover:bg-surface-2 hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"><Icon className="h-4 w-4" aria-hidden="true" />{label}</button>)}</div>}
  </>;
};

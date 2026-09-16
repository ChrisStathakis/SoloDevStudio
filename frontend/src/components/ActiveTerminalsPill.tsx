import React, { useState } from 'react';
import { Terminal as TerminalIcon, Zap, ChevronUp, ChevronDown } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useLiveTerminals, requestTerminalOpen } from '../hooks/useLiveTerminals';

/**
 * Global floating pill (bottom-left) listing projects with live consoles.
 * Clicking a project opens its project detail. Rendered in AppFrame so it is
 * visible on every view, unlike TerminalDrawer which only lives in ProjectsView.
 */
export const ActiveTerminalsPill: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const { projects, setCurrentView, setSelectedProjectId } = useApp();
  const { byProject } = useLiveTerminals();
  const [expanded, setExpanded] = useState(false);

  if (!isAuthenticated || byProject.length === 0) return null;

  const projectColor = (projectId: string) =>
    projects.find(p => p.id === projectId)?.color || '#6366f1';

  const openProject = (projectId: string) => {
    // Stale groups (deleted/recreated projects) have nowhere to navigate;
    // they are adopted or stopped from a project's stale-consoles row.
    if (!projects.some(p => p.id === projectId)) return;
    setSelectedProjectId(projectId);
    setCurrentView('projects');
    requestTerminalOpen(projectId);
  };

  const totalSessions = byProject.reduce((n, g) => n + g.count, 0);
  const label =
    byProject.length === 1
      ? byProject[0].projectTitle
      : `${byProject.length} live projects`;

  return (
    <div
      // Mobile only: on desktop the live-consoles chip lives in the top header
      // (left of the search bar), so the floating pill would just duplicate it.
      className="fixed left-4 bottom-20 z-30 w-auto max-w-[280px] animate-in fade-in md:hidden"
      aria-label="Projects with live consoles"
    >
      {expanded && (
        <ul
          role="listbox"
          aria-label="Live project consoles"
          className="mb-2 overflow-hidden rounded-2xl border border-line-strong bg-slate-900 shadow-2xl"
        >
          {byProject.map(g => (
            <li key={g.projectId}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                aria-disabled={!projects.some(p => p.id === g.projectId)}
                aria-label={projects.some(p => p.id === g.projectId) ? `Open project ${g.projectTitle} (live console)` : `${g.projectTitle} (stale console — project record missing)`}
                title={projects.some(p => p.id === g.projectId) ? `${g.projectTitle} — ${g.count} live console${g.count > 1 ? 's' : ''}` : `${g.projectTitle} — project record missing; adopt it from a project's stale-consoles row`}
                onClick={() => openProject(g.projectId)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openProject(g.projectId);
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: projectColor(g.projectId) }}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-100">
                  {g.projectTitle}
                  {!projects.some(p => p.id === g.projectId) && (
                    <span className="ml-1.5 rounded bg-amber-500/20 px-1 py-px text-[9px] font-black uppercase tracking-wide text-amber-300">stale</span>
                  )}
                </span>
                {g.hasCmd && (
                  <span
                    title="CMD console"
                    className="flex shrink-0 items-center gap-0.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-black font-mono text-sky-300"
                  >
                    <TerminalIcon className="h-3 w-3" />
                    CMD
                  </span>
                )}
                {g.hasScript && (
                  <span
                    title="Run Server console"
                    className="flex shrink-0 items-center gap-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-black font-mono text-emerald-300"
                  >
                    <Zap className="h-3 w-3" />
                    {g.hasCmd && g.count > 1 ? `×${g.count}` : 'SRV'}
                  </span>
                )}
                {!g.hasCmd && !g.hasScript && g.count > 1 && (
                  <span className="shrink-0 rounded-md bg-slate-700 px-1.5 py-0.5 text-[10px] font-black font-mono text-slate-200">
                    ×{g.count}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse live projects' : `Expand live projects: ${label}`}
        title={byProject.map(g => `${g.projectTitle} (${g.count})`).join(', ')}
        onKeyDown={e => {
          if (e.key === 'Escape') setExpanded(false);
        }}
        className="flex items-center gap-2 rounded-2xl border border-line-strong bg-slate-900 py-2.5 pl-3 pr-4 text-xs font-black font-mono text-indigo-300 shadow-2xl transition-colors hover:border-indigo-500"
      >
        <TerminalIcon className="h-4 w-4" />
        <span className="max-w-[160px] truncate">{expanded ? 'Live consoles' : label}</span>
        {totalSessions > 1 && !expanded && byProject.length === 1 && (
          <span className="rounded-md bg-slate-700 px-1.5 py-0.5 text-[10px] font-black text-slate-200">
            {totalSessions}
          </span>
        )}
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
};

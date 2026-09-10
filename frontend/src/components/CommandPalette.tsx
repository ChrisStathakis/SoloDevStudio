import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { ActiveView } from '../types';

interface PaletteAction {
  id: string;
  title: string;
  hint?: string;
  keywords: string;
  run: () => void;
}

export const CommandPalette: React.FC = () => {
  const { setCurrentView, openQuickAdd, projects, setSelectedProjectId, toggleDarkMode, isDarkMode, startTimer } = useApp();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(v => !v);
        setQuery('');
        setIndex(0);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open ]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
  }, [open ]);

  const actions: PaletteAction[] = useMemo(() => {
    const nav: { id: ActiveView; label: string }[] = [
      { id: 'dashboard', label: 'Go to Dashboard' },
      { id: 'projects', label: 'Go to Projects' },
      { id: 'ideas', label: 'Go to Idea Canvas' },
      { id: 'matrix', label: 'Go to Priority Matrix' },
      { id: 'timetracker', label: 'Go to Focus & Timer' },
      { id: 'timeline', label: 'Go to Timeline' },
      { id: 'settings', label: 'Go to Settings' },
    ];
    const base: PaletteAction[] = [
      ...nav.map(n => ({
        id: `nav-${n.id}`,
        title: n.label,
        hint: 'Navigate',
        keywords: `${n.label} ${n.id} goto view`,
        run: () => setCurrentView(n.id),
      })),
      {
        id: 'new-task',
        title: 'New task',
        hint: 'Quick add',
        keywords: 'new task create todo quick add',
        run: () => openQuickAdd('task'),
      },
      {
        id: 'new-project',
        title: 'New project',
        hint: 'Quick add',
        keywords: 'new project create launch',
        run: () => openQuickAdd('project'),
      },
      {
        id: 'new-idea',
        title: 'New idea spark',
        hint: 'Quick add',
        keywords: 'new idea spark canvas brainstorm',
        run: () => openQuickAdd('idea'),
      },
      {
        id: 'start-focus',
        title: 'Start focus timer',
        hint: 'Timer',
        keywords: 'start focus timer pomodoro stopwatch',
        run: () => {
          openQuickAdd('timer');
        },
      },
      {
        id: 'toggle-theme',
        title: isDarkMode ? 'Switch to light mode' : 'Switch to dark mode',
        hint: 'Appearance',
        keywords: 'theme dark light mode appearance',
        run: () => toggleDarkMode(),
      },
    ];
    const projectActions: PaletteAction[] = projects.slice(0, 8).map(p => ({
      id: `open-${p.id}`,
      title: `Open ${p.title}`,
      hint: 'Project',
      keywords: `open project ${p.title}`,
      run: () => {
        setSelectedProjectId(p.id);
        setCurrentView('projects');
      },
    }));
    const focusActions: PaletteAction[] = projects.slice(0, 5).map(p => ({
      id: `focus-${p.id}`,
      title: `Focus on ${p.title}`,
      hint: 'Timer',
      keywords: `focus timer ${p.title} pomodoro`,
      run: () => {
        startTimer('pomodoro', p.id);
        setCurrentView('timetracker');
      },
    }));
    return [...base, ...projectActions, ...focusActions];
  }, [projects, isDarkMode, setCurrentView, openQuickAdd, setSelectedProjectId, toggleDarkMode, startTimer]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions.slice(0, 12);
    return actions.filter(a => `${a.title} ${a.hint || ''} ${a.keywords}`.toLowerCase().includes(q)).slice(0, 12);
  }, [actions, query]);

  useEffect(() => setIndex(0), [query]);

  if (!open) return null;

  const runAction = (a: PaletteAction) => {
    setOpen(false);
    setQuery('');
    a.run();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh] bg-black/60 backdrop-blur-sm" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <span className="text-xs font-mono text-content-faint" aria-hidden="true">⌘K</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, filtered.length - 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)); }
              else if (e.key === 'Enter' && filtered[index]) { e.preventDefault(); runAction(filtered[index]); }
            }}
            placeholder="Type a command — try “focus”, “new task”, project name…"
            aria-label="Command palette search"
            className="w-full bg-transparent py-3 text-sm text-content outline-none placeholder:text-content-faint"
          />
          <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-content-faint">ESC</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-2" role="listbox" aria-label="Commands">
          {filtered.length === 0 && <li className="px-3 py-6 text-center text-xs text-content-faint">No matching commands.</li>}
          {filtered.map((a, i) => (
            <li key={a.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === index}
                onMouseEnter={() => setIndex(i)}
                onClick={() => runAction(a)}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${i === index ? 'bg-indigo-500/15 text-content' : 'text-content-muted hover:bg-surface-2 hover:text-content'}`}
              >
                <span className="font-semibold">{a.title}</span>
                {a.hint && <span className="text-[10px] font-bold uppercase tracking-wider text-content-faint">{a.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-4 py-2 text-[11px] text-content-faint">↑↓ to move · Enter to run · Ctrl/⌘+K to toggle</p>
      </div>
    </div>
  );
};

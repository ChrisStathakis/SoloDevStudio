import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Calendar, 
  Clock, 
  AlertCircle, 
  CheckCircle2, 
  Layers, 
  Flag, 
  ChevronRight, 
  ArrowRight,
  Filter,
  CalendarClock,
  Sparkles,
  Download,
  Loader2
} from 'lucide-react';
import { STAGE_CONFIG } from '../types';
import { api } from '../services/api';
import { PageHeader } from './ui';

interface TimelineItem {
  id: string;
  type: 'launch' | 'milestone' | 'task';
  title: string;
  date: string;
  projectId: string;
  projectTitle: string;
  color: string;
  stage?: string;
  completed?: boolean;
  daysRemaining: number;
}

export const TimelineDeadlinesView: React.FC = () => {
  const { projects, tasks, setSelectedProjectId, setCurrentView, searchQuery } = useApp();

  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'all' | 'launch' | 'milestone' | 'task'>('all');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>('all');
  const [serverGroups, setServerGroups] = useState<{ overdue: number; thisWeek: number; nextTwoWeeks: number; thisMonth: number; later: number } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const getDaysRemaining = (targetDate: string) => {
    const target = new Date(targetDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  };

  // Sync server timeline groups for stats parity (GET /api/timeline/ is authoritative)
  useEffect(() => {
    let mounted = true;
    setIsSyncing(true);
    const params: Record<string, string> = {};
    if (selectedTypeFilter !== 'all') params.type = selectedTypeFilter;
    if (selectedProjectFilter !== 'all') params.projectId = selectedProjectFilter;
    if (searchQuery) params.search = searchQuery;
    api.get('/timeline/', { params }).then(res => {
      if (!mounted) return;
      if (res.data?.groups) setServerGroups(res.data.groups);
    }).catch(() => {}).finally(() => {
      if (mounted) setIsSyncing(false);
    });
    return () => { mounted = false; };
  }, [selectedTypeFilter, selectedProjectFilter, searchQuery]);

  // Aggregate all events
  const allItems: TimelineItem[] = [
    // 1. Project Launches
    ...projects.map(p => ({
      id: `launch-${p.id}`,
      type: 'launch' as const,
      title: `${p.title} - Official Launch Target`,
      date: p.targetDeadline,
      projectId: p.id,
      projectTitle: p.title,
      color: p.color,
      stage: p.currentStage,
      completed: p.currentStage === 'live',
      daysRemaining: getDaysRemaining(p.targetDeadline)
    })),

    // 2. Project Milestones
    ...projects.flatMap(p => 
      p.milestones.map(m => ({
        id: `ms-${m.id}`,
        type: 'milestone' as const,
        title: m.title,
        date: m.targetDate,
        projectId: p.id,
        projectTitle: p.title,
        color: p.color,
        stage: m.stage,
        completed: m.completed,
        daysRemaining: getDaysRemaining(m.targetDate)
      }))
    ),

    // 3. Task Deadlines
    ...tasks
      .filter(t => t.dueDate)
      .map(t => {
        const proj = projects.find(p => p.id === t.projectId);
        return {
          id: `task-${t.id}`,
          type: 'task' as const,
          title: t.title,
          date: t.dueDate!,
          projectId: t.projectId,
          projectTitle: proj?.title || 'Personal Task',
          color: proj?.color || '#6366f1',
          stage: t.stage,
          completed: t.completed,
          daysRemaining: getDaysRemaining(t.dueDate!)
        };
      })
  ]
    .filter(item => {
      const matchesType = selectedTypeFilter === 'all' || item.type === selectedTypeFilter;
      const matchesProject = selectedProjectFilter === 'all' || item.projectId === selectedProjectFilter;
      const matchesSearch = !searchQuery || 
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.projectTitle.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesType && matchesProject && matchesSearch;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const handleExportICS = () => {
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SoloLab//Timeline//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];
    allItems.filter(i => !i.completed).forEach(item => {
      const dt = item.date.replace(/-/g, '');
      const uid = `${item.id}@sololab.local`;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
      lines.push(`DTSTART;VALUE=DATE:${dt}`);
      lines.push(`SUMMARY:${item.title.replace(/,/g, '\\,')} [${item.projectTitle}]`);
      lines.push(`DESCRIPTION:${item.type} — ${item.projectTitle}`);
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sololab-timeline-${new Date().toISOString().split('T')[0]}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Group by Time Horizon
  const overdueItems = allItems.filter(i => !i.completed && i.daysRemaining < 0);
  const thisWeekItems = allItems.filter(i => i.daysRemaining >= 0 && i.daysRemaining <= 7);
  const nextTwoWeeksItems = allItems.filter(i => i.daysRemaining > 7 && i.daysRemaining <= 14);
  const thisMonthItems = allItems.filter(i => i.daysRemaining > 14 && i.daysRemaining <= 30);
  const laterItems = allItems.filter(i => i.daysRemaining > 30);

  const renderSection = (title: string, items: TimelineItem[], isOverdue = false) => {
    if (items.length === 0) return null;

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {isOverdue && <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />}
          <h3 className={`text-xs font-black uppercase tracking-[0.2em] font-mono ${
            isOverdue ? 'text-rose-600 dark:text-rose-400' : 'text-content-faint'
          }`}>
            {title} ({items.length})
          </h3>
        </div>

        <div className="space-y-2.5">
          {items.map(item => (
            <div
              key={item.id}
              onClick={() => {
                setSelectedProjectId(item.projectId);
                setCurrentView('projects');
              }}
              className={`p-4 rounded-2xl bg-surface border transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 group ${
                item.completed
                  ? 'border-line opacity-50 bg-surface-2'
                  : isOverdue
                  ? 'border-rose-200 dark:border-rose-900/60 bg-rose-50 dark:bg-rose-950/10 hover:border-rose-500'
                  : 'border-line shadow-md hover:border-line-strong'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div
                  className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                  style={{ backgroundColor: item.color }}
                />

                <div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[12px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                      item.type === 'launch'
                        ? 'bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 dark:text-indigo-300'
                        : item.type === 'milestone'
                        ? 'bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300'
                        : 'bg-surface-3 border border-line-strong/60 text-content-muted'
                    }`}>
                      {item.type === 'launch' ? '🚀 Target Launch' : item.type === 'milestone' ? '🚩 Milestone' : '✓ Task Due'}
                    </span>

                    <span className="text-xs text-content-faint font-semibold">
                      {item.projectTitle}
                    </span>
                  </div>

                  <h4 className={`text-sm font-black mt-1 ${
                    item.completed ? 'line-through text-content-faint' : 'text-content'
                  }`}>
                    {item.title}
                  </h4>
                </div>
              </div>

              {/* Countdown Pill & Date */}
              <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
                <div className="text-right text-xs">
                  <div className="font-mono font-bold text-content-muted">
                    {item.date}
                  </div>
                  <div className={`text-[13px] font-mono font-bold ${
                    item.completed
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : item.daysRemaining < 0
                      ? 'text-rose-600 dark:text-rose-400 font-black'
                      : item.daysRemaining <= 3
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-content-faint'
                  }`}>
                    {item.completed
                      ? 'Completed'
                      : item.daysRemaining < 0
                      ? `${Math.abs(item.daysRemaining)} days overdue`
                      : item.daysRemaining === 0
                      ? 'Due Today'
                      : `${item.daysRemaining} days left`}
                  </div>
                </div>

                <ChevronRight className="w-4 h-4 text-content-faint group-hover:translate-x-1 group-hover:text-content transition-all" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in">
      
      {/* Header */}
      <PageHeader eyebrow="Planning workspace" title="Timeline" description="Keep launches, milestones, and task deadlines visible in sequence." actions={<div className="flex flex-wrap items-center gap-2.5">
          <select
            value={selectedTypeFilter}
            onChange={e => setSelectedTypeFilter(e.target.value as any)}
            className="px-3.5 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content font-bold outline-none shadow-sm focus:border-indigo-500"
          >
            <option value="all">All Events</option>
            <option value="launch">🚀 Project Launches</option>
            <option value="milestone">🚩 Milestones</option>
            <option value="task">✓ Task Deadlines</option>
          </select>

          <select
            value={selectedProjectFilter}
            onChange={e => setSelectedProjectFilter(e.target.value)}
            className="px-3.5 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content font-bold outline-none shadow-sm focus:border-indigo-500"
          >
            <option value="all">All Projects</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={handleExportICS}
            disabled={allItems.filter(i => !i.completed).length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-2 border border-line hover:border-indigo-700 text-content-muted hover:text-content text-xs font-black disabled:opacity-40 transition-all"
            title="Export visible deadlines as ICS calendar file"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export ICS</span>
          </button>

          {isSyncing && <Loader2 className="w-4 h-4 text-content-faint animate-spin" />}
          {serverGroups && (
            <span className="text-[12px] font-mono font-bold text-content-faint bg-surface-2 border border-line px-2 py-1 rounded-lg">
              server: {serverGroups.overdue} overdue · {serverGroups.thisWeek} this week
            </span>
          )}
        </div>} />

      {/* Timeline List */}
      <div className="space-y-8">
        {allItems.length === 0 ? (
          <div className="p-12 text-center text-xs text-content-faint bg-surface border border-line rounded-3xl">
            <CalendarClock className="w-8 h-8 mx-auto text-content-faint mb-2" />
            No deadlines matching filter criteria.
          </div>
        ) : (
          <>
            {renderSection('⚠️ Overdue Action Items', overdueItems, true)}
            {renderSection('⚡ This Week (Next 7 Days)', thisWeekItems)}
            {renderSection('📅 Next 2 Weeks (8 - 14 Days)', nextTwoWeeksItems)}
            {renderSection('🚀 This Month (15 - 30 Days)', thisMonthItems)}
            {renderSection('🔮 Later on the Roadmap (30+ Days)', laterItems)}
          </>
        )}
      </div>

    </div>
  );
};

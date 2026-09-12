import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  FolderKanban,
  CheckCircle2,
  Clock,
  ArrowRight,
  Play,
  Lightbulb,
  Flame,
  Sparkles,
  Layers,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  AlertCircle,
  Plus,
  History,
  Timer,
  BarChart3,
  GripVertical
} from 'lucide-react';
import { STAGE_CONFIG, ProjectStage } from '../types';
import { api } from '../services/api';
import { PageHeader, Button } from './ui';
import { TodayFocusCard } from './TodayFocusCard';

export const DashboardView: React.FC = () => {
  const {
    projects,
    tasks,
    ideas,
    timeEntries,
    setCurrentView,
    setSelectedProjectId,
    toggleTaskCompletion,
    startTimer,
    openQuickAdd,
    reorderProjects
  } = useApp();

  // Metrics calculations
  // projects arrive pre-sorted by manual sort_order (AppContext); active pipeline respects that order.
  const activeProjects = projects.filter(p => p.currentStage !== 'live');
  const pendingTasks = tasks.filter(t => !t.completed);
  const urgentTasks = pendingTasks.filter(t => t.quadrant === 'q1_do');
  
  // Focus time calculation (past 7 days)
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentTimeEntries = timeEntries.filter(e => new Date(e.timestamp) >= sevenDaysAgo);
  const totalSecondsWeek = recentTimeEntries.reduce((acc, curr) => acc + curr.durationSeconds, 0);
  const totalHoursWeek = (totalSecondsWeek / 3600).toFixed(1);

  // Recent focus sessions (latest 4)
  const recentSessions = [...timeEntries]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 4);

  // Server dashboard + timeline overdue for banner/analytics (new feature: server-authoritative stats)
  const [serverDashboard, setServerDashboard] = useState<{ stageTimeMap: Record<string, number>; totalHoursWeek: number } | null>(null);
  const [overdueCount, setOverdueCount] = useState<number | null>(null);
  useEffect(() => {
    let mounted = true;
    api.get('/dashboard/').then(r => {
      if (!mounted) return;
      setServerDashboard({ stageTimeMap: r.data?.stageTimeMap || {}, totalHoursWeek: r.data?.totalHoursWeek || 0 });
    }).catch(() => {});
    api.get('/timeline/').then(r => {
      if (!mounted) return;
      setOverdueCount(r.data?.groups?.overdue ?? null);
    }).catch(() => {});
    return () => { mounted = false; };
  }, [projects.length, tasks.length, timeEntries.length]);

  // Manual ordering (drag-and-drop, persisted via POST /projects/reorder/).
  // The pipeline shows the top 4 of the manually ordered active list.
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const visiblePipeline = activeProjects.slice(0, 4);

  const persistNewOrder = async (newActiveIds: string[]) => {
    // reorderProjects expects the full project order; append non-active (live)
    // projects after the reordered actives so their relative order is kept.
    const liveIds = projects.filter(p => p.currentStage === 'live').map(p => p.id);
    setIsReordering(true);
    try {
      await reorderProjects([...newActiveIds, ...liveIds]);
    } catch {
      // AppContext rolls back + refetches on failure; keep UI quiet here.
    } finally {
      setIsReordering(false);
    }
  };

  const moveActiveProject = (id: string, direction: -1 | 1) => {
    const idx = activeProjects.findIndex(p => p.id === id);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= activeProjects.length || isReordering) return;
    const ids = activeProjects.map(p => p.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(target, 0, moved);
    void persistNewOrder(ids);
  };

  const handlePipelineDrop = (targetId: string) => {
    if (!dragId || dragId === targetId || isReordering) return;
    const ids = activeProjects.map(p => p.id);
    const from = ids.indexOf(dragId);
    let to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ids.splice(from, 1);
    to = ids.indexOf(targetId);
    ids.splice(to, 0, moved);
    setDragId(null);
    setOverId(null);
    void persistNewOrder(ids);
  };

  return (
    <div className="space-y-8 pb-12 animate-in fade-in">
      <TodayFocusCard />
      {tasks.filter(task => !task.completed && task.blockerReason).length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-xs"><span className="font-bold text-rose-700 dark:text-rose-300"><AlertCircle className="mr-2 inline-block h-4 w-4" />{tasks.filter(task => !task.completed && task.blockerReason).length} blocked task{tasks.filter(task => !task.completed && task.blockerReason).length === 1 ? '' : 's'} need a next action.</span><button type="button" onClick={() => setCurrentView('projects')} className="font-black text-rose-700 dark:text-rose-300">Review blockers →</button></div>
      )}
      {/* NEW: Overdue alert banner (server timeline groups) */}
      {overdueCount !== null && overdueCount > 0 && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-200 text-xs">
          <div className="flex items-center gap-2 font-bold">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400" />
            <span>{overdueCount} overdue {overdueCount === 1 ? 'item' : 'items'} need attention</span>
            <span className="font-normal text-rose-700 dark:text-rose-300/70 hidden sm:inline">� launches, milestones or task deadlines past due</span>
          </div>
          <button type="button" onClick={() => setCurrentView('timeline')} className="px-3 py-1 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-black shrink-0">View Timeline {' >'}</button>
        </div>
      )}

      {/* NEW: Stage focus analytics (server stageTimeMap) */}
      {serverDashboard && Object.keys(serverDashboard.stageTimeMap).length > 0 && (
        <div className="p-4 rounded-2xl bg-white dark:bg-surface border border-slate-200 dark:border-line/80 flex flex-wrap items-center gap-4 text-xs">
          <div className="flex items-center gap-2 font-black text-slate-700 dark:text-content-muted">
            <BarChart3 className="w-4 h-4 text-indigo-500" />
            <span>Focus by stage (all time):</span>
          </div>
          {Object.entries(serverDashboard.stageTimeMap).slice(0, 5).map(([stage, secs]) => (
            <span key={stage} className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-surface-2 border border-slate-200 dark:border-line font-mono font-bold text-slate-600 dark:text-content-faint">
              {STAGE_CONFIG[stage as ProjectStage]?.label || stage}: {(Number(secs)/3600).toFixed(1)}h
            </span>
          ))}
          <span className="text-content-faint font-mono ml-auto">{serverDashboard.totalHoursWeek}h this week (server)</span>
        </div>
      )}
      
      {/* Top Overview & Quick Action Buttons */}
      <PageHeader
        eyebrow="Workspace overview"
        title="Command deck"
        description="Your projects, priorities, and focus momentum in one place."
        actions={<>
            <Button tone="secondary" size="sm"
              type="button"
              id="btn-dash-new-task"
              onClick={() => openQuickAdd('task')}
            >
              <Plus className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              <span>Add Task</span>
            </Button>

            <Button tone="secondary" size="sm"
              type="button"
              id="btn-dash-new-idea"
              onClick={() => openQuickAdd('idea')}
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
              <span>Spark Idea</span>
            </Button>

            <Button tone="success" size="sm"
              type="button"
              id="btn-dash-start-focus"
              onClick={() => openQuickAdd('timer')}
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Focus Session</span>
            </Button>
        </>}
      />

        {/* 4 Stat Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* Card 1: Active Projects */}
          <div 
            onClick={() => setCurrentView('projects')}
            className="p-5 rounded-2xl bg-white dark:bg-surface border border-slate-200 dark:border-line/80 shadow-sm hover:border-indigo-500/50 hover:bg-slate-50 dark:hover:bg-surface-3 transition-all cursor-pointer group relative overflow-hidden"
          >
            <div className="flex items-center justify-between text-content-faint dark:text-content-faint mb-2">
              <span className="text-[13px] font-bold uppercase tracking-wider">Active Projects</span>
              <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 group-hover:scale-110 transition-transform">
                <FolderKanban className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black font-mono text-slate-900 dark:text-white">
              {activeProjects.length}
            </div>
            <div className="text-xs text-content-faint dark:text-content-faint mt-1 flex items-center gap-1">
              <span>{projects.filter(p => p.currentStage === 'live').length} shipped live</span>
              <ChevronRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 text-indigo-500 dark:text-indigo-400 transition-opacity" />
            </div>
          </div>

          {/* Card 2: Top Focus Priority Tasks */}
          <div 
            onClick={() => setCurrentView('matrix')}
            className="p-5 rounded-2xl bg-white dark:bg-surface border border-slate-200 dark:border-line/80 shadow-sm hover:border-rose-500/50 hover:bg-slate-50 dark:hover:bg-surface-3 transition-all cursor-pointer group relative overflow-hidden"
          >
            <div className="flex items-center justify-between text-content-faint dark:text-content-faint mb-2">
              <span className="text-[13px] font-bold uppercase tracking-wider">High Impact (Q1)</span>
              <div className="p-2 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 group-hover:scale-110 transition-transform">
                <AlertCircle className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black font-mono text-slate-900 dark:text-white">
              {urgentTasks.length}
            </div>
            <div className="text-xs text-rose-600 dark:text-rose-400 mt-1 font-medium flex items-center gap-1">
              <span>{urgentTasks.length > 0 ? 'Top leverage items' : 'Clear queue!'}</span>
              <ChevronRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 text-rose-500 dark:text-rose-400 transition-opacity" />
            </div>
          </div>

          {/* Card 3: Deep Focus Time */}
          <div 
            onClick={() => setCurrentView('timetracker')}
            className="p-5 rounded-2xl bg-white dark:bg-surface border border-slate-200 dark:border-line/80 shadow-sm hover:border-emerald-500/50 hover:bg-slate-50 dark:hover:bg-surface-3 transition-all cursor-pointer group relative overflow-hidden"
          >
            <div className="flex items-center justify-between text-content-faint dark:text-content-faint mb-2">
              <span className="text-[13px] font-bold uppercase tracking-wider">Focus This Week</span>
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 group-hover:scale-110 transition-transform">
                <Clock className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black font-mono text-slate-900 dark:text-white">
              {totalHoursWeek} <span className="text-sm font-normal text-content-faint dark:text-content-faint">hrs</span>
            </div>
            <div className="text-xs text-content-faint dark:text-content-faint mt-1 flex items-center gap-1">
              <span>{recentTimeEntries.length} logged sessions</span>
              <ChevronRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 text-emerald-500 dark:text-emerald-400 transition-opacity" />
            </div>
          </div>

          {/* Card 4: Idea Vault */}
          <div 
            onClick={() => setCurrentView('ideas')}
            className="p-5 rounded-2xl bg-white dark:bg-surface border border-slate-200 dark:border-line/80 shadow-sm hover:border-amber-500/50 hover:bg-slate-50 dark:hover:bg-surface-3 transition-all cursor-pointer group relative overflow-hidden"
          >
            <div className="flex items-center justify-between text-content-faint dark:text-content-faint mb-2">
              <span className="text-[13px] font-bold uppercase tracking-wider">Ideas & Concepts</span>
              <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 group-hover:scale-110 transition-transform">
                <Lightbulb className="w-4 h-4" />
              </div>
            </div>
            <div className="text-3xl font-black font-mono text-slate-900 dark:text-white">
              {ideas.length}
            </div>
            <div className="text-xs text-content-faint dark:text-content-faint mt-1 flex items-center gap-1">
              <span>{ideas.filter(i => i.status === 'validated').length} validated concepts</span>
              <ChevronRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 text-amber-500 dark:text-amber-400 transition-opacity" />
            </div>
          </div>

        </div>

      {/* Main Grid: Active Project Pipeline + Top Priorities & Deep Work */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left 2 Columns: Active Projects Lifecycle */}
        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-5 h-5 text-indigo-500 dark:text-indigo-400" />
              <h2 className="text-lg font-black text-slate-900 dark:text-white">
                Project Pipeline
              </h2>
              {activeProjects.length > 1 && (
                <span className="text-[11px] font-mono text-content-faint dark:text-content-faint hidden sm:inline">
                  drag to reorder{isReordering ? '… saving' : ''}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCurrentView('projects')}
              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 flex items-center gap-1 font-mono"
            >
              <span>View All ({projects.length})</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-4">
            {activeProjects.length === 0 ? (
              <div className="py-8 text-center space-y-3 rounded-2xl border border-dashed border-line">
                <p className="text-sm font-bold text-content">No projects yet</p>
                <p className="text-xs text-content-faint">Create your first project to see progress, stages, and focus time here.</p>
                <button type="button" onClick={() => openQuickAdd('project')} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500">Create project</button>
              </div>
            ) : visiblePipeline.map((project, visibleIdx) => {
              const projTasks = tasks.filter(t => t.projectId === project.id);
              const projDone = projTasks.filter(t => t.completed).length;
              const progressPct = projTasks.length > 0 ? Math.round((projDone / projTasks.length) * 100) : 0;
              const stageInfo = STAGE_CONFIG[project.currentStage];
              
              // Project total focus time
              const projectTimeSeconds = timeEntries
                .filter(e => e.projectId === project.id)
                .reduce((acc, curr) => acc + curr.durationSeconds, 0);
              const projectHours = (projectTimeSeconds / 3600).toFixed(1);

              return (
                <div
                  key={project.id}
                  onClick={() => {
                    if (dragId) return;
                    setSelectedProjectId(project.id);
                    setCurrentView('projects');
                  }}
                  onDragOver={(e) => {
                    if (!dragId || dragId === project.id) return;
                    e.preventDefault();
                    setOverId(project.id);
                  }}
                  onDragLeave={() => {
                    if (overId === project.id) setOverId(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handlePipelineDrop(project.id);
                  }}
                  className={`p-5 rounded-2xl bg-white dark:bg-surface border shadow-sm hover:border-indigo-500/40 hover:bg-slate-50 dark:hover:bg-surface-3 transition-all cursor-pointer group ${overId === project.id ? 'border-indigo-500 ring-2 ring-indigo-500/40' : 'border-slate-200 dark:border-line/80'} ${dragId === project.id ? 'opacity-50' : ''}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Drag to reorder ${project.title}`}
                        title="Drag to reorder"
                        draggable
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', project.id);
                          setDragId(project.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverId(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'ArrowUp') { e.preventDefault(); moveActiveProject(project.id, -1); }
                          if (e.key === 'ArrowDown') { e.preventDefault(); moveActiveProject(project.id, 1); }
                        }}
                        className="p-1 -ml-1 rounded-lg text-content-faint hover:text-indigo-500 hover:bg-indigo-500/10 cursor-grab active:cursor-grabbing touch-none shrink-0"
                      >
                        <GripVertical className="w-4 h-4" />
                      </span>
                      <div className="flex flex-col shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          aria-label={`Move ${project.title} up`}
                          title="Move up"
                          disabled={visibleIdx === 0 && activeProjects.indexOf(project) === 0 || isReordering}
                          onClick={() => moveActiveProject(project.id, -1)}
                          className="p-0.5 rounded text-content-faint hover:text-indigo-500 hover:bg-indigo-500/10 disabled:opacity-30 disabled:pointer-events-none leading-none"
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${project.title} down`}
                          title="Move down"
                          disabled={activeProjects.indexOf(project) === activeProjects.length - 1 || isReordering}
                          onClick={() => moveActiveProject(project.id, 1)}
                          className="p-0.5 rounded text-content-faint hover:text-indigo-500 hover:bg-indigo-500/10 disabled:opacity-30 disabled:pointer-events-none leading-none"
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div
                        className="w-3.5 h-3.5 rounded-full shrink-0 shadow-sm ring-2 ring-slate-200 dark:ring-white/10"
                        style={{ backgroundColor: project.color || '#6366f1' }}
                      />
                      <div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {project.title}
                        </h3>
                        <p className="text-xs text-content-faint dark:text-content-faint line-clamp-1">
                          {project.tagline}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[13px] font-bold px-2.5 py-1 rounded-lg border ${stageInfo.bgLight} ${stageInfo.bgDark}`}>
                        {stageInfo.label}
                      </span>
                      <span className="text-[13px] text-slate-600 dark:text-content-faint px-2 py-0.5 bg-slate-100 dark:bg-surface-3/80 border border-slate-200 dark:border-line-strong/50 rounded-md font-medium font-mono">
                        {project.category}
                      </span>
                    </div>
                  </div>

                  {/* Stage Progress Roadmap Dots */}
                  <div className="grid grid-cols-7 gap-1.5 my-3">
                    {(Object.keys(STAGE_CONFIG) as ProjectStage[]).map((stg) => {
                      const cfg = STAGE_CONFIG[stg];
                      const isCurrent = project.currentStage === stg;
                      const isPassed = cfg.order < stageInfo.order;

                      return (
                        <div key={stg} className="text-center group/stage relative">
                          <div
                            className={`h-1.5 rounded-full transition-all ${
                              isCurrent
                                ? 'bg-indigo-500 shadow-sm shadow-indigo-500/50'
                                : isPassed
                                ? 'bg-indigo-300 dark:bg-indigo-900/80'
                                : 'bg-slate-200 dark:bg-slate-800'
                            }`}
                          />
                          <span className="text-[13px] text-content-faint dark:text-content-faint hidden sm:block truncate mt-1 font-mono">
                            {cfg.label.split(' ')[0]}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer with Task completion, time invested, tech tags */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-line/60 text-xs text-content-faint dark:text-content-faint font-mono">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-content">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 dark:text-emerald-400" />
                        <span>{projDone}/{projTasks.length} tasks ({progressPct}%)</span>
                      </div>

                      <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-300">
                        <Clock className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                        <span>{projectHours}h invested</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 font-mono">
                      {project.techStack.slice(0, 3).map(tech => (
                        <span key={tech} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[12px] text-slate-700 dark:text-content-muted font-semibold border border-slate-200 dark:border-line-strong/60">
                          {tech}
                        </span>
                      ))}
                      {project.techStack.length > 3 && (
                        <span className="text-[12px] text-content-faint dark:text-content-faint font-medium">
                          +{project.techStack.length - 3}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {activeProjects.length > visiblePipeline.length && (
              <button
                type="button"
                onClick={() => setCurrentView('projects')}
                className="w-full py-2.5 rounded-2xl border border-dashed border-line text-xs font-bold font-mono text-content-faint hover:text-indigo-500 hover:border-indigo-500/50 transition-colors"
              >
                +{activeProjects.length - visiblePipeline.length} more — reorder all in Projects
              </button>
            )}
          </div>
        </div>

        {/* Right Column: Top Focus Items & Recent Focus Flow */}
        <div className="space-y-6">
          
          {/* Top Focus Action Items (Q1) */}
          <div className="p-5 rounded-2xl bg-white dark:bg-surface border border-slate-200 dark:border-line/80 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider font-mono">
                  Priority Focus (Q1)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCurrentView('matrix')}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-bold font-mono"
              >
                Matrix {' >'}
              </button>
            </div>

            {urgentTasks.length === 0 ? (
              <div className="p-6 text-center text-content-faint dark:text-content-faint text-xs">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500/60 mb-2" />
                No high-impact blockers! Smooth sailing.
              </div>
            ) : (
              <div className="space-y-2.5">
                {urgentTasks.slice(0, 4).map(task => {
                  const proj = projects.find(p => p.id === task.projectId);
                  return (
                    <div
                      key={task.id}
                      className="p-3 rounded-xl bg-slate-50 dark:bg-surface-3 border border-slate-200 dark:border-line hover:border-slate-300 dark:hover:border-line-strong transition-all flex items-start justify-between gap-2.5 group"
                    >
                      <button
                        type="button"
                        onClick={() => toggleTaskCompletion(task.id)}
                        className="mt-0.5 p-0.5 rounded text-content-faint dark:text-content-faint hover:text-indigo-500 shrink-0"
                      >
                        <div className="w-4 h-4 rounded border border-slate-300 dark:border-slate-600 hover:border-indigo-500 flex items-center justify-center bg-white dark:bg-transparent" />
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white line-clamp-2">
                          {task.title}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-[13px] text-content-faint dark:text-content-faint">
                          <span className="truncate max-w-[150px] font-medium" style={{ color: proj?.color || '#818cf8' }}>
                            {proj?.title}
                          </span>
                          <span className="text-[12px] text-content-faint dark:text-content-faint font-mono">
                            {STAGE_CONFIG[task.stage]?.label}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          startTimer('pomodoro', task.projectId, task.id);
                          setCurrentView('timetracker');
                        }}
                        className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                        title="Start timer on this task"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recent Deep Work Sessions (Replaces Deadlines Widget) */}
          <div className="p-5 rounded-2xl bg-white dark:bg-surface border border-slate-200 dark:border-line/80 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Timer className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
                <h3 className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider font-mono">
                  Recent Deep Work
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCurrentView('timetracker')}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 font-bold font-mono"
              >
                Tracker {' >'}
              </button>
            </div>

            {recentSessions.length === 0 ? (
              <div className="p-6 text-center text-content-faint dark:text-content-faint text-xs">
                <History className="w-6 h-6 mx-auto text-content-faint dark:text-slate-600 mb-2" />
                No focus sessions logged yet.
                <button
                  type="button"
                  onClick={() => openQuickAdd('timer')}
                  className="block mx-auto mt-2 text-emerald-600 dark:text-emerald-400 hover:underline font-bold"
                >
                  Start a focus sprint
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {recentSessions.map(session => {
                  const proj = projects.find(p => p.id === session.projectId);
                  const sessionMinutes = Math.round(session.durationSeconds / 60);
                  const sessionDate = new Date(session.timestamp);
                  const timeFormatted = sessionDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                  return (
                    <div
                      key={session.id}
                      className="p-3 rounded-xl bg-slate-50 dark:bg-surface-3 border border-slate-200 dark:border-line/80 hover:bg-slate-100 dark:hover:bg-surface-3 hover:border-slate-300 dark:hover:border-line-strong transition-all flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                          {session.notes || 'Deep Focus Sprint'}
                        </div>
                        <div className="text-[13px] text-content-faint dark:text-content-faint flex items-center gap-1.5 mt-0.5">
                          {proj && (
                            <span 
                              className="w-2 h-2 rounded-full shrink-0" 
                              style={{ backgroundColor: proj.color || '#6366f1' }}
                            />
                          )}
                          <span className="truncate">{proj?.title || 'General Solo Work'}</span>
                          <span>�</span>
                          <span className="font-mono text-content-faint dark:text-content-faint">{timeFormatted}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[13px] font-mono font-bold px-2 py-0.5 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300">
                          {sessionMinutes}m
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            startTimer('pomodoro', session.projectId, session.taskId);
                            setCurrentView('timetracker');
                          }}
                          className="p-1.5 rounded-lg text-content-faint hover:text-slate-900 dark:hover:text-content hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
                          title="Start another session like this"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Idea Spark Snapshot */}
          {ideas.length > 0 && (
            <div className="p-5 rounded-2xl bg-white dark:bg-surface border border-amber-400/40 dark:border-amber-500/30 shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 blur-2xl rounded-full pointer-events-none" />
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 text-xs font-bold uppercase tracking-wider font-mono">
                  <Lightbulb className="w-4 h-4" />
                  <span>Concept Spark</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCurrentView('ideas')}
                  className="text-xs text-amber-600 dark:text-amber-400 hover:text-amber-500 dark:hover:text-amber-300 font-bold font-mono"
                >
                  Lab {' >'}
                </button>
              </div>

              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                {ideas[0].title}
              </h4>
              <p className="text-xs text-content-faint dark:text-content-faint mt-1 line-clamp-2">
                {ideas[0].tagline || ideas[0].solution}
              </p>
            </div>
          )}

        </div>
      </div>

    </div>
  );
};

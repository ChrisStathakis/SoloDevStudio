import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Plus, 
  Play, 
  CheckCircle2, 
  Calendar, 
  Clock, 
  Sparkles, 
  ArrowRight, 
  Layers, 
  Filter,
  CheckSquare,
  Trash2,
  MoveRight
} from 'lucide-react';
import { PriorityQuadrant, QUADRANT_CONFIG, STAGE_CONFIG, Task } from '../types';
import { PageHeader } from './ui';
import { useToast } from './Toaster';

export const PriorityMatrixView: React.FC = () => {
  const { 
    tasks, 
    projects, 
    toggleTaskCompletion, 
    moveTaskQuadrant, 
    deleteTask,
    startTimer,
    addTask,
    setCurrentView,
    searchQuery
  } = useApp();

  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>('all');
  const [showCompleted, setShowCompleted] = useState<boolean>(false);
  const [quickTaskInput, setQuickTaskInput] = useState<{ [key in PriorityQuadrant]?: string }>({});
  const { toast, confirm } = useToast();

  const filteredTasks = tasks.filter(task => {
    const matchesProject = selectedProjectFilter === 'all' || task.projectId === selectedProjectFilter;
    const matchesStatus = showCompleted || !task.completed;
    const matchesSearch = !searchQuery || 
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (task.description && task.description.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesProject && matchesStatus && matchesSearch;
  });

  const handleQuickAdd = (quadrant: PriorityQuadrant) => {
    const title = quickTaskInput[quadrant];
    if (!title || !title.trim()) return;
    if (selectedProjectFilter === 'all' && projects.length === 0) return;
    const targetProjectId = selectedProjectFilter !== 'all' ? selectedProjectFilter : projects[0]?.id;
    if (!targetProjectId) return;

    addTask({
      projectId: targetProjectId,
      title: title.trim(),
      stage: 'development',
      quadrant,
      category: 'feature',
      completed: false,
      estimatedMinutes: 45,
      subtasks: [],
      tags: ['matrix']
    } as any);

    setQuickTaskInput(prev => ({ ...prev, [quadrant]: '' }));
  };

  const handleDeleteTask = async (task: Task) => {
    const ok = await confirm({
      title: `Delete "${task.title}"?`,
      description: 'The task and its subtasks will be removed. You can undo right after.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    const { id, createdAt, timeSpentMinutes, ...snapshot } = task;
    void id; void createdAt; void timeSpentMinutes;
    try {
      await deleteTask(task.id);
      toast({
        title: `Deleted "${task.title}"`,
        tone: 'success',
        action: {
          label: 'Undo',
          onClick: () => {
            void addTask({ ...snapshot, completed: false } as Parameters<typeof addTask>[0])
              .then(() => toast({ title: 'Task restored', tone: 'success' }))
              .catch(() => toast({ title: 'Could not restore task', tone: 'error' }));
          },
        },
      });
    } catch {
      toast({ title: 'Could not delete task', tone: 'error' });
    }
  };

  const quadrants: PriorityQuadrant[] = ['q1_do', 'q2_schedule', 'q3_delegate', 'q4_eliminate'];

  return (
    <div className="space-y-6 pb-12 animate-in fade-in">
      
      {/* Header & Matrix Controls */}
      <PageHeader eyebrow="Decision workspace" title="Priority matrix" description="Make the next useful decision by separating urgency from importance." actions={<div className="flex flex-wrap items-center gap-3">
          <select
            value={selectedProjectFilter}
            onChange={e => setSelectedProjectFilter(e.target.value)}
            className="px-3.5 py-2 text-xs bg-surface-2 border border-line rounded-xl text-content font-semibold outline-none shadow-sm focus:border-indigo-500"
          >
            <option value="all">All Projects ({tasks.length} tasks)</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setShowCompleted(!showCompleted)}
            aria-pressed={showCompleted}
            className={`px-3.5 py-2 text-xs font-bold rounded-xl border transition-all ${
              showCompleted
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-surface-2 text-content-faint border-line hover:text-content'
            }`}
          >
            {showCompleted ? 'Hide Completed' : 'Show Completed'}
          </button>
        </div>} />

      {/* 2x2 Grid Layout with Visual Axis Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {quadrants.map(quadrantKey => {
          const qConfig = QUADRANT_CONFIG[quadrantKey];
          const quadTasks = filteredTasks.filter(t => t.quadrant === quadrantKey);
          const inputValue = quickTaskInput[quadrantKey] || '';

          return (
            <div
              key={quadrantKey}
              className="rounded-3xl border border-line bg-surface p-6 flex flex-col justify-between shadow-lg transition-all min-h-[380px] relative overflow-hidden"
            >
              <div>
                {/* Quadrant Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <span className={`text-[12px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${qConfig.badgeClass}`}>
                      {qConfig.tag}
                    </span>
                    <h3 className="text-base font-black text-content">
                      {qConfig.title}
                    </h3>
                  </div>

                  <span className="text-xs font-mono font-bold text-content-faint">
                    {quadTasks.filter(t => !t.completed).length} pending
                  </span>
                </div>

                <p className="text-xs text-content-faint mb-4">
                  {qConfig.subtitle}
                </p>

                {/* Quick Add Input inside Quadrant */}
                {selectedProjectFilter === 'all' && projects.length > 1 && (
                  <p className="mb-2 text-[11px] text-content-faint">Quick add will use <span className="font-bold text-content">{projects[0]?.title}</span>. Filter to a project to target it precisely.</p>
                )}
                <div className="flex items-center gap-2 mb-4">
                  <input
                    id={`quick-add-${quadrantKey}`}
                    type="text"
                    placeholder={`+ Quick add ${qConfig.title} task...`}
                    value={inputValue}
                    onChange={e => setQuickTaskInput({ ...quickTaskInput, [quadrantKey]: e.target.value })}
                    onKeyDown={e => e.key === 'Enter' && handleQuickAdd(quadrantKey)}
                    className="flex-1 px-3.5 py-2 text-xs bg-surface-3 border border-line rounded-xl text-content placeholder-slate-500 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleQuickAdd(quadrantKey)}
                    disabled={!inputValue.trim()}
                    className="px-3.5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-500 disabled:opacity-30 disabled:hover:opacity-30 transition-all shadow-md shrink-0"
                  >
                    Add
                  </button>
                </div>

                {/* Task Items */}
                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {quadTasks.length === 0 ? (
                    <div className="text-center py-8 space-y-3 border border-dashed border-line rounded-2xl">
                      <p className="text-xs text-content-faint">No tasks in this quadrant.</p>
                      <button type="button" onClick={() => document.getElementById(`quick-add-${quadrantKey}`)?.focus()} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-500">Add the first one above</button>
                    </div>
                  ) : (
                    quadTasks.map(task => {
                      const proj = projects.find(p => p.id === task.projectId);

                      return (
                        <div
                          key={task.id}
                          className={`p-3.5 rounded-2xl bg-surface-3 border border-line hover:border-line-strong shadow-sm transition-all ${
                            task.completed ? 'opacity-50 bg-surface-2' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2.5">
                            <button
                              type="button"
                              onClick={() => toggleTaskCompletion(task.id)}
                              className="mt-0.5 p-0.5 text-content-faint hover:text-emerald-400 transition-colors shrink-0"
                            >
                              {task.completed ? (
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                              ) : (
                                <div className="w-4 h-4 rounded border-2 border-slate-600 hover:border-indigo-400" />
                              )}
                            </button>

                            <div className="flex-1 min-w-0">
                              <div className={`text-xs font-bold ${task.completed ? 'line-through text-content-faint' : 'text-content'}`}>
                                {task.title}
                              </div>

                              {task.description && (
                                <p className="text-[13px] text-content-faint line-clamp-1 mt-0.5">
                                  {task.description}
                                </p>
                              )}

                              <div className="flex flex-wrap items-center gap-2 mt-2 text-[12px] text-content-faint">
                                <span className="font-semibold truncate max-w-[120px]" style={{ color: proj?.color || '#818cf8' }}>
                                  {proj?.title}
                                </span>
                                {task.dueDate && (
                                  <span className="flex items-center gap-0.5 text-content-muted font-mono">
                                    <Calendar className="w-3 h-3 text-content-faint" />
                                    <span>{task.dueDate}</span>
                                  </span>
                                )}
                                {task.timeSpentMinutes > 0 && (
                                  <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-mono font-semibold">
                                    <Clock className="w-3 h-3" />
                                    <span>{task.timeSpentMinutes}m spent</span>
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Actions: Start Pomodoro & Move Quadrant */}
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  startTimer('pomodoro', task.projectId, task.id);
                                  setCurrentView('timetracker');
                                }}
                                className="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/30"
                                title="Start Focus Timer"
                              >
                                <Play className="w-3 h-3 fill-current" />
                              </button>

                              {/* Move Quadrant quick cycle */}
                              <label className="sr-only" htmlFor={`move-${task.id}`}>Move {task.title} to quadrant</label>
                              <select
                                id={`move-${task.id}`}
                                value={task.quadrant}
                                onChange={e => moveTaskQuadrant(task.id, e.target.value as PriorityQuadrant)}
                                className="text-[12px] bg-surface-3 text-content-muted rounded-md px-1.5 py-0.5 border border-line-strong outline-none font-bold cursor-pointer"
                                title="Move to another quadrant (Q1 Do, Q2 Schedule, Q3 Quick Wins, Q4 Backlog)"
                              >
                                <option value="q1_do">Q1 Do</option>
                                <option value="q2_schedule">Q2 Schedule</option>
                                <option value="q3_delegate">Q3 Wins</option>
                                <option value="q4_eliminate">Q4 Backlog</option>
                              </select>

                              <button
                                type="button"
                                onClick={() => void handleDeleteTask(task)}
                                aria-label={`Delete task ${task.title}`}
                                title="Delete task"
                                className="p-2 text-content-faint hover:text-rose-400 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

    </div>
  );
};

import React from 'react';
import {
  Plus,
  CheckCircle2,
  Calendar,
  Clock,
  Play,
  Edit3,
  Trash2,
  Bug,
  Check,
  Clipboard,
  ClipboardPlus,
} from 'lucide-react';
import { Project, Task, ProjectStage, TaskCategory, STAGE_CONFIG, QUADRANT_CONFIG, TASK_CATEGORY_CONFIG } from '../types';
import { EmptyState, Button } from './ui';

interface EditingSubtask {
  taskId: string;
  subtaskId: string;
  title: string;
}

interface Props {
  project: Project;
  tasks: Task[];
  taskFilterStage: string;
  setTaskFilterStage: (v: string) => void;
  taskFilterCategory: string;
  setTaskFilterCategory: (v: string) => void;
  newSubtaskTitle: { [taskId: string]: string };
  setNewSubtaskTitle: (v: { [taskId: string]: string }) => void;
  editingSubtask: EditingSubtask | null;
  setEditingSubtask: (v: EditingSubtask | null) => void;
  taskPromptError: string | null;
  taskPromptStatus: Record<string, 'selected' | undefined>;
  addingTaskPromptId: string | null;
  addedTaskPromptId: string | null;
  toggleTaskCompletion: (id: string) => void;
  toggleSubtask: (taskId: string, subtaskId: string) => void;
  addSubtask: (taskId: string, title: string) => void;
  updateSubtask: (taskId: string, subtaskId: string, updates: { title?: string }) => Promise<void>;
  deleteSubtask: (taskId: string, subtaskId: string) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => Promise<void>;
  addTask: (task: Omit<Task, 'id' | 'createdAt' | 'timeSpentMinutes'>) => Promise<Task>;
  startTimer: (mode: 'pomodoro' | 'stopwatch', projectId?: string, taskId?: string) => void;
  openQuickAdd: (tab: 'task' | 'project' | 'idea' | 'timer', options?: { projectId?: string; taskId?: string }) => void;
  setCurrentView: (view: 'dashboard' | 'projects' | 'ideas' | 'matrix' | 'timetracker' | 'timeline' | 'settings') => void;
  useTaskPromptForLaunch: (taskId: string) => void;
  addTaskToPrompt: (taskId: string) => void;
  toast: (opts: { title: string; description?: string; tone?: 'success' | 'error' | 'info'; action?: { label: string; onClick: () => void } }) => void;
  confirm: (opts: { title: string; description?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }) => Promise<boolean>;
}

export const ProjectTasksTab: React.FC<Props> = ({
  project,
  tasks,
  taskFilterStage,
  setTaskFilterStage,
  taskFilterCategory,
  setTaskFilterCategory,
  newSubtaskTitle,
  setNewSubtaskTitle,
  editingSubtask,
  setEditingSubtask,
  taskPromptError,
  taskPromptStatus,
  addingTaskPromptId,
  addedTaskPromptId,
  toggleTaskCompletion,
  toggleSubtask,
  addSubtask,
  updateSubtask,
  deleteSubtask,
  updateTask,
  deleteTask,
  addTask,
  startTimer,
  openQuickAdd,
  setCurrentView,
  useTaskPromptForLaunch,
  addTaskToPrompt,
  toast,
  confirm,
}) => {
  const visibleTasks = tasks
    .filter(t => t.projectId === project.id)
    .filter(t => taskFilterStage === 'all' || t.stage === taskFilterStage)
    .filter(t => taskFilterCategory === 'all' || (t as unknown as { category?: string }).category === taskFilterCategory)
    .sort((a, b) => Number(a.completed) - Number(b.completed));

  const handleDeleteTask = async (task: Task) => {
    const ok = await confirm({
      title: `Delete task "${task.title}"?`,
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

  return (
    <div className="space-y-4">
      {taskPromptError && <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">{taskPromptError}</p>}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="task-filter-stage">Filter tasks by stage</label>
          <select
            id="task-filter-stage"
            value={taskFilterStage}
            onChange={e => setTaskFilterStage(e.target.value)}
            className="px-3.5 py-1.5 text-xs bg-surface-2 border border-line rounded-xl text-content-muted font-bold outline-none"
          >
            <option value="all">All Stages</option>
            {(Object.keys(STAGE_CONFIG) as ProjectStage[]).map(s => (
              <option key={s} value={s}>{STAGE_CONFIG[s].label}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="task-filter-category">Filter tasks by category</label>
          <select
            id="task-filter-category"
            value={taskFilterCategory}
            onChange={e => setTaskFilterCategory(e.target.value)}
            className="px-3.5 py-1.5 text-xs bg-surface-2 border border-line rounded-xl text-content-muted font-bold outline-none"
            title="Filter by task category"
          >
            <option value="all">All Categories</option>
            <option value="bug">🐛 Bugs</option>
            <option value="feature">✦ Features</option>
            <option value="chore">🔧 Chores</option>
            <option value="improvement">⬆ Improvements</option>
            <option value="general">• General</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => openQuickAdd('task', { projectId: project.id })}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Task</span>
        </button>
      </div>

      {/* Tasks List */}
      {visibleTasks.length === 0 ? (
        <EmptyState
          title="No tasks here yet"
          description="Break this project into small, trackable tasks. They'll show up in the matrix and timeline too."
          action={<Button size="sm" onClick={() => openQuickAdd('task', { projectId: project.id })}>Add the first task</Button>}
        />
      ) : (
        <div className="space-y-3">
          {visibleTasks.map(task => {
            const qConfig = QUADRANT_CONFIG[task.quadrant];
            const subtaskInput = newSubtaskTitle[task.id] || '';

            return (
              <div
                key={task.id}
                className={`p-4 rounded-2xl bg-surface border transition-all ${
                  task.completed
                    ? 'border-line/80 opacity-60 bg-surface-2'
                    : 'border-line shadow-md hover:border-line-strong'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleTaskCompletion(task.id)}
                      aria-label={task.completed ? `Mark task ${task.title} incomplete` : `Mark task ${task.title} complete`}
                      className="mt-1 p-0.5 text-content-faint hover:text-emerald-400 transition-colors shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                    >
                      {task.completed ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <div className="w-5 h-5 rounded-lg border-2 border-line-strong hover:border-indigo-500 transition-colors bg-surface-2" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-sm font-black ${
                          task.completed ? 'line-through text-content-faint' : 'text-content'
                        }`}>
                          {task.title}
                        </span>

                        <span className={`text-[12px] font-bold px-2 py-0.5 rounded-md border ${qConfig.badgeClass}`}>
                          {qConfig.tag} - {qConfig.title}
                        </span>

                        <span className="text-[12px] font-mono px-2 py-0.5 rounded-md bg-surface-3 text-content-faint font-bold">
                          {STAGE_CONFIG[task.stage]?.label}
                        </span>

                        {(() => { const cat = (task as unknown as { category?: TaskCategory }).category || 'feature'; const cfg = TASK_CATEGORY_CONFIG[cat]; return (
                          <span className={`text-[12px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 ${cfg.badgeClass}`} title={cfg.label}>
                            {cat === 'bug' ? <Bug className="w-3 h-3" /> : <span>{cfg.icon}</span>}
                            <span>{cfg.label}</span>
                          </span>
                        ); })()}

                        {task.milestoneIds?.map(milestoneId => {
                          const milestone = project.milestones.find(item => item.id === milestoneId);
                          return milestone ? (
                            <span key={milestone.id} className="text-[11px] font-bold px-2 py-0.5 rounded-md border border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300" title="Linked milestone">
                              {milestone.title}
                            </span>
                          ) : null;
                        })}
                      </div>

                      {task.description && (
                        <p className="text-xs text-content-faint mt-1">
                          {task.description}
                        </p>
                      )}

                      {/* Subtasks checklist */}
                      {task.subtasks.length > 0 && (
                        <div className="mt-3 space-y-1.5 pl-2.5 border-l-2 border-line">
                          {task.subtasks.map(st => (
                            <div
                              key={st.id}
                              className="flex items-center gap-2 text-xs text-content-muted group"
                            >
                              <button type="button" onClick={() => toggleSubtask(task.id, st.id)} aria-label={st.completed ? 'Mark subtask incomplete' : 'Mark subtask complete'} className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[12px] ${
                                st.completed ? 'bg-emerald-500 text-white' : 'border border-line-strong group-hover:border-indigo-500'
                              }`}>
                                {st.completed && '✓'}
                              </button>
                              {editingSubtask?.taskId === task.id && editingSubtask.subtaskId === st.id ? (
                                <input autoFocus value={editingSubtask.title} onChange={e => setEditingSubtask({ ...editingSubtask, title: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') setEditingSubtask(null); }} onBlur={async () => { const title = editingSubtask.title.trim(); if (title && title !== st.title) await updateSubtask(task.id, st.id, { title }); setEditingSubtask(null); }} aria-label="Edit subtask title" className="min-w-0 flex-1 px-2 py-0.5 rounded border border-indigo-500 bg-surface-2 text-content outline-none" />
                              ) : (
                                <button type="button" onClick={() => setEditingSubtask({ taskId: task.id, subtaskId: st.id, title: st.title })} className={`text-left flex-1 ${st.completed ? 'line-through text-content-faint' : ''}`}>{st.title}</button>
                              )}
                              <button type="button" onClick={() => void (async () => {
                                const ok = await confirm({ title: `Delete subtask "${st.title}"?`, confirmLabel: 'Delete', danger: true });
                                if (ok) void deleteSubtask(task.id, st.id);
                              })()} className="p-1.5 text-content-faint hover:text-rose-400 focus-visible:opacity-100 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400" aria-label={`Delete subtask ${st.title}`} title="Delete subtask"><Trash2 className="w-3 h-3" /></button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add subtask inline */}
                      <div className="mt-2.5 flex items-center gap-2 max-w-sm">
                        <label className="sr-only" htmlFor={`subtask-${task.id}`}>Add checklist step</label>
                        <input
                          id={`subtask-${task.id}`}
                          type="text"
                          placeholder="+ Add checklist step..."
                          value={subtaskInput}
                          onChange={e =>
                            setNewSubtaskTitle({ ...newSubtaskTitle, [task.id]: e.target.value })
                          }
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              addSubtask(task.id, subtaskInput);
                              setNewSubtaskTitle({ ...newSubtaskTitle, [task.id]: '' });
                            }
                          }}
                          className="px-3 py-1 text-xs bg-surface-2 border border-line rounded-xl text-content placeholder-slate-500 outline-none flex-1 focus:border-indigo-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Task Action Bar */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button type="button" onClick={() => openQuickAdd('task', { taskId: task.id })} className="p-1.5 text-content-faint hover:text-indigo-300 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" title="Edit task" aria-label={`Edit task ${task.title}`}>
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <label className="sr-only" htmlFor={`cat-${task.id}`}>Change task category</label>
                    <select
                      id={`cat-${task.id}`}
                      value={(task as unknown as { category?: string }).category || 'feature'}
                      onChange={e => updateTask(task.id, { category: e.target.value as TaskCategory } as Partial<Task>)}
                      className="px-2 py-1 text-[13px] bg-surface-2 border border-line rounded-lg text-content-muted font-bold outline-none"
                      title="Change task category"
                    >
                      <option value="feature">Feature</option>
                      <option value="bug">Bug</option>
                      <option value="chore">Chore</option>
                      <option value="improvement">Improvement</option>
                      <option value="general">General</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        startTimer('pomodoro', project.id, task.id);
                        setCurrentView('timetracker');
                      }}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20 text-xs font-bold transition-all"
                      title="Start Focus timer on this task"
                      aria-label={`Start focus timer on ${task.title}`}
                    >
                      <Play className="w-3 h-3" />
                      <span className="hidden sm:inline">Focus</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => useTaskPromptForLaunch(task.id)}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${taskPromptStatus[task.id] === 'selected' ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300' : 'bg-surface-2 border-line text-content-faint hover:text-indigo-300'}`}
                      title="Use this task prompt for one launch without changing the saved project prompt"
                    >
                      {taskPromptStatus[task.id] === 'selected' ? <Check className="w-3 h-3" /> : <Clipboard className="w-3 h-3" />}
                      <span className="hidden sm:inline">{taskPromptStatus[task.id] === 'selected' ? 'Selected' : 'Use for launch'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void addTaskToPrompt(task.id)}
                      disabled={addingTaskPromptId === task.id}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all disabled:cursor-wait disabled:opacity-60 ${addedTaskPromptId === task.id ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300' : 'bg-surface-2 border-line text-content-faint hover:text-indigo-300'}`}
                      title="Add this task snapshot to the saved project prompt"
                    >
                      {addingTaskPromptId === task.id ? <span className="text-[11px]">…</span> : addedTaskPromptId === task.id ? <Check className="w-3 h-3" /> : <ClipboardPlus className="w-3 h-3" />}
                      <span className="hidden sm:inline">{addedTaskPromptId === task.id ? 'Added' : 'Add to prompt'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleDeleteTask(task)}
                      className="p-2 text-content-faint hover:text-rose-400 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                      aria-label={`Delete task ${task.title}`}
                      title="Delete task"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Footer Meta */}
                <div className="mt-3 pt-2.5 border-t border-line/80 flex flex-wrap items-center justify-between gap-2 text-[13px] text-content-faint font-mono">
                  <div className="flex items-center gap-3">
                    {task.dueDate && (
                      <span className="flex items-center gap-1 text-content-faint">
                        <Calendar className="w-3 h-3 text-content-faint" />
                        <span>Due: {task.dueDate}</span>
                      </span>
                    )}
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <Clock className="w-3 h-3" />
                      <span>{task.timeSpentMinutes || 0}m spent (est. {task.estimatedMinutes || 60}m)</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    {task.tags.map(t => (
                      <span key={t} className="px-2 py-0.5 rounded-md bg-surface-2 border border-line text-[12px] text-content-muted">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Milestone, Project, ProjectStage, Task, STAGE_CONFIG } from '../types';

type Props = {
  project: Project;
  tasks: Task[];
  milestone?: Milestone | null;
  onSave: (values: Omit<Milestone, 'id'>) => Promise<void>;
  onClose: () => void;
};

export const MilestoneEditor: React.FC<Props> = ({ project, tasks, milestone, onSave, onClose }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stage, setStage] = useState<ProjectStage>(project.currentStage);
  const [targetDate, setTargetDate] = useState(project.targetDeadline);
  const [completed, setCompleted] = useState(false);
  const [taskIds, setTaskIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(milestone?.title || '');
    setDescription(milestone?.description || '');
    setStage(milestone?.stage || project.currentStage);
    setTargetDate(milestone?.targetDate || project.targetDeadline);
    setCompleted(milestone?.completed || false);
    setTaskIds(milestone ? tasks.filter(t => t.milestoneIds?.includes(milestone.id)).map(t => t.id) : []);
  }, [milestone?.id, project.id, tasks]);

  const toggleTask = (id: string) => {
    setTaskIds(current => current.includes(id) ? current.filter(taskId => taskId !== id) : [...current, id]);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !targetDate || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ title: title.trim(), description: description.trim(), stage, targetDate, completed, taskIds });
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.response?.data?.error || e?.message || 'Could not save milestone.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="milestone-editor-title">
      <form onSubmit={handleSubmit} className="w-full max-w-xl max-h-[92vh] overflow-y-auto rounded-3xl bg-surface border border-line shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id="milestone-editor-title" className="text-base font-black text-content">{milestone ? 'Edit milestone' : 'Add milestone'}</h2>
            <p className="text-xs text-content-faint mt-1">{project.title}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-xl text-content-faint hover:text-content hover:bg-surface-2" aria-label="Close milestone editor"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-3">
          <label className="block text-xs font-bold text-content-muted">Title *
            <input autoFocus required value={title} onChange={e => setTitle(e.target.value)} className="mt-1 w-full px-3 py-2.5 rounded-xl bg-surface-2 border border-line text-content text-sm outline-none focus:border-indigo-500" />
          </label>
          <label className="block text-xs font-bold text-content-muted">Description
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} className="mt-1 w-full px-3 py-2.5 rounded-xl bg-surface-2 border border-line text-content text-sm outline-none focus:border-indigo-500 resize-y" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs font-bold text-content-muted">Stage
              <select value={stage} onChange={e => setStage(e.target.value as ProjectStage)} className="mt-1 w-full px-3 py-2.5 rounded-xl bg-surface-2 border border-line text-content text-sm outline-none focus:border-indigo-500">
                {(Object.keys(STAGE_CONFIG) as ProjectStage[]).map(key => <option key={key} value={key}>{STAGE_CONFIG[key].label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-bold text-content-muted">Target date *
              <input required type="date" value={targetDate} onChange={e => setTargetDate(e.target.value)} className="mt-1 w-full px-3 py-2.5 rounded-xl bg-surface-2 border border-line text-content text-sm outline-none focus:border-indigo-500" />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-content-muted cursor-pointer">
            <input type="checkbox" checked={completed} onChange={e => setCompleted(e.target.checked)} className="accent-emerald-500" />
            Mark milestone complete
          </label>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-black uppercase tracking-wider text-content-muted">Link tasks (optional)</div>
          <div className="max-h-44 overflow-y-auto rounded-2xl border border-line bg-surface-2 p-2 space-y-1">
            {tasks.length === 0 ? <p className="p-3 text-xs text-content-faint">No tasks exist for this project yet.</p> : tasks.map(task => (
              <label key={task.id} className="flex items-center gap-2 p-2 rounded-xl hover:bg-surface-3 text-xs text-content cursor-pointer">
                <input type="checkbox" checked={taskIds.includes(task.id)} onChange={() => toggleTask(task.id)} className="accent-indigo-500" />
                <span className={task.completed ? 'line-through text-content-faint' : ''}>{task.title}</span>
              </label>
            ))}
          </div>
        </div>

        {error && <p className="text-xs text-rose-300" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-bold text-content-faint hover:text-content hover:bg-surface-2">Cancel</button>
          <button type="submit" disabled={saving || !title.trim()} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black disabled:opacity-50">{saving && <Check className="w-3.5 h-3.5 animate-pulse" />}{saving ? 'Saving…' : 'Save milestone'}</button>
        </div>
      </form>
    </div>
  );
};

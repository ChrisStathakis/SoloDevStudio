import React, { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import { api } from '../services/api';
import { mapStageWorkspaceFromApi } from '../services/mappers';
import { Project, ProjectStage, StageWorkspace, STAGE_CONFIG, STAGE_WORKSPACE_CONFIG } from '../types';
import { Check, ClipboardCheck, FileText, Loader2, Save, Sparkles } from 'lucide-react';

marked.setOptions({ gfm: true, breaks: true });

interface StageWorkspaceTabProps {
  project: Project;
  tasks: { projectId: string; stage: ProjectStage; completed: boolean }[];
  timeEntries: { projectId: string; stage: ProjectStage; durationSeconds: number }[];
}

export const StageWorkspaceTab: React.FC<StageWorkspaceTabProps> = ({ project, tasks, timeEntries }) => {
  const stage = project.currentStage;
  const config = STAGE_WORKSPACE_CONFIG[stage];
  const [workspace, setWorkspace] = useState<StageWorkspace>({ stage, notes: '', completedItems: [] });
  const [draftNotes, setDraftNotes] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingChecklist, setSavingChecklist] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMode('edit');
    api.get(`/projects/${project.id}/stage-workspaces/${stage}/`)
      .then(response => {
        if (cancelled) return;
        const next = mapStageWorkspaceFromApi(response.data, stage);
        setWorkspace(next);
        setDraftNotes(next.notes);
      })
      .catch(() => { if (!cancelled) setError('Unable to load this stage workspace.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project.id, stage]);

  const stageTasks = useMemo(() => tasks.filter(task => task.projectId === project.id && task.stage === stage), [tasks, project.id, stage]);
  const stageTime = useMemo(() => timeEntries.filter(entry => entry.projectId === project.id && entry.stage === stage).reduce((sum, entry) => sum + entry.durationSeconds, 0), [timeEntries, project.id, stage]);
  const completedCount = config.checklist.filter(item => workspace.completedItems.includes(item.id)).length;
  const dirty = draftNotes !== workspace.notes;

  const saveNotes = async () => {
    setSaving(true); setError(null); setSaved(false);
    try {
      const response = await api.patch(`/projects/${project.id}/stage-workspaces/${stage}/`, { notes: draftNotes });
      setWorkspace(mapStageWorkspaceFromApi(response.data, stage));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch { setError('Unable to save stage notes. Your draft is still here.'); }
    finally { setSaving(false); }
  };

  const toggleChecklist = async (itemId: string) => {
    const previousItems = workspace.completedItems;
    const completedItems = previousItems.includes(itemId)
      ? previousItems.filter(id => id !== itemId)
      : [...previousItems, itemId];
    setWorkspace(prev => ({ ...prev, completedItems }));
    setSavingChecklist(itemId); setError(null);
    try {
      const response = await api.patch(`/projects/${project.id}/stage-workspaces/${stage}/`, { completed_items: completedItems });
      setWorkspace(prev => ({ ...prev, ...mapStageWorkspaceFromApi(response.data, stage) }));
    } catch {
      setWorkspace(prev => ({ ...prev, completedItems: previousItems }));
      setError('Unable to update the checklist.');
    } finally { setSavingChecklist(null); }
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-content-faint"><Loader2 className="w-5 h-5 animate-spin" /></div>;

  return (
    <div className="space-y-5">
      {error && <div className="px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs font-bold text-rose-700 dark:text-rose-300" role="alert">{error}</div>}
      <div className="p-5 rounded-2xl bg-indigo-500/5 border border-indigo-500/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.15em] text-indigo-600 dark:text-indigo-400 font-mono"><Sparkles className="w-3.5 h-3.5" /> Current stage workspace</div>
            <h3 className="mt-2 text-xl font-black text-content">{STAGE_CONFIG[stage].label}</h3>
            <p className="mt-1 text-sm text-content-muted max-w-2xl">{config.guidance}</p>
          </div>
          <span className="shrink-0 px-2.5 py-1 rounded-lg bg-surface border border-line text-xs font-mono font-bold text-content-faint">Stage {STAGE_CONFIG[stage].order}</span>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-5">
          <div className="p-3 rounded-xl bg-surface border border-line"><div className="text-[11px] text-content-faint font-mono">TASKS</div><div className="mt-1 text-lg font-black text-content">{stageTasks.filter(task => task.completed).length}/{stageTasks.length}</div></div>
          <div className="p-3 rounded-xl bg-surface border border-line"><div className="text-[11px] text-content-faint font-mono">CHECKLIST</div><div className="mt-1 text-lg font-black text-content">{completedCount}/{config.checklist.length}</div></div>
          <div className="p-3 rounded-xl bg-surface border border-line"><div className="text-[11px] text-content-faint font-mono">TIME</div><div className="mt-1 text-lg font-black text-content">{(stageTime / 3600).toFixed(1)}h</div></div>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        <section className="p-4 rounded-2xl bg-surface border border-line">
          <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2 text-sm font-black text-content"><ClipboardCheck className="w-4 h-4 text-emerald-500" /> Guided checklist</div><span className="text-xs font-mono text-content-faint">{completedCount}/{config.checklist.length}</span></div>
          <div className="space-y-2">{config.checklist.map(item => { const checked = workspace.completedItems.includes(item.id); return <button key={item.id} type="button" onClick={() => toggleChecklist(item.id)} disabled={savingChecklist === item.id} className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${checked ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-surface-2 border-line hover:border-indigo-500/40'}`}><span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${checked ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-line-strong'}`}>{savingChecklist === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : checked ? <Check className="w-3.5 h-3.5" /> : null}</span><span className={`text-xs font-bold ${checked ? 'text-emerald-700 dark:text-emerald-300 line-through' : 'text-content-muted'}`}>{item.label}</span></button>; })}</div>
          <div className="mt-4 pt-3 border-t border-line"><div className="text-[11px] font-black uppercase tracking-wider text-content-faint mb-2">Prompts to consider</div>{config.prompts.map(prompt => <p key={prompt} className="text-xs text-content-muted mb-1.5">• {prompt}</p>)}</div>
        </section>

        <section className="p-4 rounded-2xl bg-surface border border-line">
          <div className="flex items-center justify-between gap-3 mb-3"><div className="flex items-center gap-2 text-sm font-black text-content"><FileText className="w-4 h-4 text-indigo-500" /> Stage notes</div><div className="flex items-center gap-2"><button type="button" onClick={() => setMode('edit')} className={`px-2.5 py-1 rounded-lg text-xs font-bold ${mode === 'edit' ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-content'}`}>Edit</button><button type="button" onClick={() => setMode('preview')} className={`px-2.5 py-1 rounded-lg text-xs font-bold ${mode === 'preview' ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-content'}`}>Preview</button></div></div>
          {mode === 'edit' ? <textarea value={draftNotes} onChange={event => setDraftNotes(event.target.value)} rows={14} placeholder={`Capture decisions, links, blockers, and next actions for ${STAGE_CONFIG[stage].label.toLowerCase()}...`} className="w-full resize-y rounded-xl bg-surface-2 border border-line p-3 text-sm text-content outline-none focus:border-indigo-500 font-mono" /> : <div className="md-preview min-h-[330px] rounded-xl bg-surface-2 border border-line p-4 text-sm text-content" dangerouslySetInnerHTML={{ __html: String(marked.parse(draftNotes || '*No notes yet.*')) }} />}
          <div className="flex items-center justify-between mt-3"><span className="text-xs text-content-faint">{dirty ? 'Unsaved changes' : saved ? 'Saved' : workspace.updatedAt ? `Updated ${new Date(workspace.updatedAt).toLocaleDateString()}` : 'Not saved yet'}</span><button type="button" onClick={saveNotes} disabled={saving || !dirty} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-black"><Save className="w-3.5 h-3.5" />{saving ? 'Saving...' : 'Save notes'}</button></div>
        </section>
      </div>
    </div>
  );
};

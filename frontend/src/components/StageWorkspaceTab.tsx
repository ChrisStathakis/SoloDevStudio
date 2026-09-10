import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { mapStageWorkspaceFromApi } from '../services/mappers';
import { renderMarkdownSafe } from '../utils/markdown';
import { Project, ProjectStage, StageWorkspace, STAGE_CONFIG, STAGE_WORKSPACE_CONFIG } from '../types';
import { Check, ClipboardCheck, FileText, Loader2, Save, Sparkles } from 'lucide-react';

interface StageWorkspaceTabProps {
  project: Project;
  tasks: { projectId: string; stage: ProjectStage; completed: boolean }[];
  timeEntries: { projectId: string; stage: ProjectStage; durationSeconds: number }[];
}

export const StageWorkspaceTab: React.FC<StageWorkspaceTabProps> = ({ project, tasks, timeEntries }) => {
  const stage = project.currentStage;
  const config = STAGE_WORKSPACE_CONFIG[stage];
  const draftKey = `solodev:stage-notes-draft:${project.id}:${stage}`;
  const [workspace, setWorkspace] = useState<StageWorkspace>({ stage, notes: '', completedItems: [] });
  const [draftNotes, setDraftNotes] = useState(() => {
    try { return localStorage.getItem(draftKey) || ''; } catch { return ''; }
  });
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [saving, setSaving] = useState(false);
  const [savingChecklist, setSavingChecklist] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const queryClient = useQueryClient();

  const workspaceQuery = useQuery({
    queryKey: ['stage-workspace', project.id, stage],
    queryFn: async (): Promise<StageWorkspace> => {
      const response = await api.get(`/projects/${project.id}/stage-workspaces/${stage}/`);
      return mapStageWorkspaceFromApi(response.data, stage);
    },
  });
  const loading = workspaceQuery.isLoading;
  const loadError = workspaceQuery.isError ? 'Unable to load this stage workspace.' : null;

  useEffect(() => {
    setMode('edit');
    setError(null);
    setSaved(false);
    // Prefer React Query cache instantly; fall back to empty so stale stage content never flashes
    const cached = queryClient.getQueryData<StageWorkspace>(['stage-workspace', project.id, stage]);
    if (cached) {
      setWorkspace(cached);
    } else {
      setWorkspace({ stage, notes: '', completedItems: [] });
    }
    // Restore any unsaved local draft first so it isn't lost while loading
    try {
      const draft = localStorage.getItem(`solodev:stage-notes-draft:${project.id}:${stage}`);
      if (draft !== null) setDraftNotes(draft);
      else if (cached) setDraftNotes(cached.notes);
    } catch { /* ignore */ }
  }, [project.id, stage, queryClient]);

  useEffect(() => {
    const next = workspaceQuery.data;
    if (!next) return;
    setWorkspace(next);
    // Prefer local draft if it exists and differs (don't silently clobber)
    try {
      const cached = localStorage.getItem(`solodev:stage-notes-draft:${project.id}:${stage}`);
      if (cached === null || cached === next.notes) setDraftNotes(next.notes);
    } catch {
      setDraftNotes(next.notes);
    }
  }, [workspaceQuery.data, project.id, stage]);

  const stageTasks = useMemo(() => tasks.filter(task => task.projectId === project.id && task.stage === stage), [tasks, project.id, stage]);
  const stageTime = useMemo(() => timeEntries.filter(entry => entry.projectId === project.id && entry.stage === stage).reduce((sum, entry) => sum + entry.durationSeconds, 0), [timeEntries, project.id, stage]);
  const completedCount = config.checklist.filter(item => workspace.completedItems.includes(item.id)).length;
  const dirty = draftNotes !== workspace.notes;

  // Autosave draft locally + warn on unload/stage switch with unsaved changes
  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(draftKey, draftNotes);
      else localStorage.removeItem(draftKey);
    } catch { /* ignore */ }
  }, [draftNotes, dirty, draftKey]);

  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const saveNotes = async () => {
    setSaving(true); setError(null); setSaved(false);
    try {
      const response = await api.patch(`/projects/${project.id}/stage-workspaces/${stage}/`, { notes: draftNotes });
      const next = mapStageWorkspaceFromApi(response.data, stage);
      setWorkspace(next);
      queryClient.setQueryData(['stage-workspace', project.id, stage], next);
      try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
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
      const next = { ...workspace, ...mapStageWorkspaceFromApi(response.data, stage) };
      setWorkspace(next);
      queryClient.setQueryData(['stage-workspace', project.id, stage], next);
    } catch {
      setWorkspace(prev => ({ ...prev, completedItems: previousItems }));
      setError('Unable to update the checklist.');
    } finally { setSavingChecklist(null); }
  };

  const displayError = error ?? loadError;
  const handleRetry = () => {
    if (loadError) void workspaceQuery.refetch();
    else setError(null);
  };

  if (loading) return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading stage workspace">
      <div className="h-24 rounded-2xl bg-surface-2 border border-line animate-pulse" />
      <div className="grid lg:grid-cols-2 gap-5">
        <div className="h-64 rounded-2xl bg-surface-2 border border-line animate-pulse" />
        <div className="h-64 rounded-2xl bg-surface-2 border border-line animate-pulse" />
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {displayError && <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs font-bold text-rose-700 dark:text-rose-300" role="alert"><span>{displayError}</span><button type="button" onClick={handleRetry} className="px-2.5 py-1 rounded-lg bg-rose-600 text-white hover:bg-rose-500">Retry</button></div>}
      {dirty && <div className="sticky top-16 z-10 flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-bold text-amber-700 dark:text-amber-300" role="status"><span>You have unsaved stage notes (draft kept locally).</span><button type="button" onClick={saveNotes} disabled={saving} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-40">{saving ? 'Saving…' : 'Save now'}</button></div>}
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
          {mode === 'edit' ? <textarea value={draftNotes} onChange={event => setDraftNotes(event.target.value)} rows={14} placeholder={`Capture decisions, links, blockers, and next actions for ${STAGE_CONFIG[stage].label.toLowerCase()}...`} aria-label="Stage notes editor" className="w-full resize-y rounded-xl bg-surface-2 border border-line p-3 text-sm text-content outline-none focus:border-indigo-500 font-mono" /> : <div className="md-preview min-h-[330px] rounded-xl bg-surface-2 border border-line p-4 text-sm text-content" dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(draftNotes || '*No notes yet.*') }} />}
          <div className="flex items-center justify-between mt-3"><span className="text-xs text-content-faint">{dirty ? 'Unsaved changes' : saved ? 'Saved' : workspace.updatedAt ? `Updated ${new Date(workspace.updatedAt).toLocaleDateString()}` : 'Not saved yet'}</span><button type="button" onClick={saveNotes} disabled={saving || !dirty} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-black"><Save className="w-3.5 h-3.5" />{saving ? 'Saving...' : 'Save notes'}</button></div>
        </section>
      </div>
    </div>
  );
};

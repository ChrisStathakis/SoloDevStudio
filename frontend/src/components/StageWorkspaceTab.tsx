import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { mapStageWorkspaceFromApi } from '../services/mappers';
import { renderMarkdownSafe } from '../utils/markdown';
import { ChecklistItem, Project, ProjectStage, StageReview, StageWorkspace, STAGE_CONFIG } from '../types';
import { Check, ClipboardCheck, FileText, Loader2, Save, Sparkles, Pencil, RotateCcw } from 'lucide-react';
import { ChecklistEditor } from './ChecklistEditor';
import { useImagePaste } from '../hooks/useImagePaste';

interface StageWorkspaceTabProps {
  project: Project;
  tasks: { id?: string; projectId: string; title: string; stage: ProjectStage; completed: boolean; blockerReason?: string; blockerNextAction?: string }[];
  timeEntries: { projectId: string; stage: ProjectStage; durationSeconds: number }[];
}
const stages = Object.keys(STAGE_CONFIG) as ProjectStage[];

export const StageWorkspaceTab: React.FC<StageWorkspaceTabProps> = ({ project, tasks, timeEntries }) => {
  const [stage, setStage] = useState<ProjectStage>(project.currentStage);
  const emptyWorkspace = (s: ProjectStage): StageWorkspace => ({ stage: s, notes: '', completedItems: [], checklist: [], shapingChecklist: [], guidance: '', prompts: [], shapingGuidance: '', shapingPrompts: [] });
  const [workspace, setWorkspace] = useState<StageWorkspace>(() => emptyWorkspace(project.currentStage));
  const [draftNotes, setDraftNotes] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [editingGroup, setEditingGroup] = useState<'guided' | 'shaping' | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [savingChecklist, setSavingChecklist] = useState<string | null>(null);
  const [savingNotes, setSavingNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<StageReview | null>(null);
  const [reviewDecision, setReviewDecision] = useState<'continue' | 'ready'>('continue');
  const [reviewNote, setReviewNote] = useState('');
  const [defaultsPreview, setDefaultsPreview] = useState<{ checklist: ChecklistItem[]; shapingChecklist: ChecklistItem[] } | null>(null);
  const draftNotesRef = React.useRef(draftNotes);
  draftNotesRef.current = draftNotes;
  const { areaRef: notesAreaRef, handlePaste: handleNotesPaste, pasteNotice: notesPasteNotice } = useImagePaste({
    getText: () => draftNotesRef.current,
    setText: setDraftNotes,
    altPrefix: 'stage note image',
  });
  const queryClient = useQueryClient();
  const draftKey = `solodev:stage-notes-draft:${project.id}:${stage}`;
  const workspaceQuery = useQuery({ queryKey: ['stage-workspace', project.id, stage], queryFn: async () => mapStageWorkspaceFromApi((await api.get(`/projects/${project.id}/stage-workspaces/${stage}/`)).data, stage) });
  useEffect(() => { setStage(project.currentStage); }, [project.currentStage]);

  useEffect(() => {
    let active = true;
    setError(null); setMode('edit'); setEditingGroup(null);
    const cached = queryClient.getQueryData<StageWorkspace>(['stage-workspace', project.id, stage]);
    if (cached) { setWorkspace(cached); setDraftNotes(cached.notes); }
    else { setWorkspace(emptyWorkspace(stage)); setDraftNotes(''); }
    try { const draft = localStorage.getItem(draftKey); if (draft !== null) setDraftNotes(draft); } catch { /* ignore */ }
    void api.get(`/projects/${project.id}/stage-reviews/${stage}/`).then(res => {
      if (!active) return;
      const latest = res.data?.latest;
      if (latest) { setReview({ ...latest, stage, reviewedAt: latest.reviewed_at || latest.reviewedAt }); setReviewDecision(latest.decision); setReviewNote(latest.note || ''); }
      else { setReview(null); setReviewNote(''); }
    }).catch(() => { if (active) setReview(null); });
    return () => { active = false; };
  }, [project.id, stage, queryClient, draftKey]);
  useEffect(() => {
    if (!workspaceQuery.data) return;
    setWorkspace(workspaceQuery.data);
    try { if (localStorage.getItem(draftKey) === null) setDraftNotes(workspaceQuery.data.notes); } catch { setDraftNotes(workspaceQuery.data.notes); }
  }, [workspaceQuery.data, draftKey]);
  useEffect(() => {
    try { if (draftNotes !== workspace.notes) localStorage.setItem(draftKey, draftNotes); else localStorage.removeItem(draftKey); } catch { /* ignore */ }
  }, [draftNotes, workspace.notes, draftKey]);

  const stageTasks = useMemo(() => tasks.filter(task => task.projectId === project.id && task.stage === stage), [tasks, project.id, stage]);
  const stageTime = useMemo(() => timeEntries.filter(entry => entry.projectId === project.id && entry.stage === stage).reduce((sum, entry) => sum + entry.durationSeconds, 0), [timeEntries, project.id, stage]);
  const complete = (items: ChecklistItem[]) => items.filter(item => workspace.completedItems.includes(item.id)).length;
  const dirty = draftNotes !== workspace.notes;
  const patchWorkspace = async (payload: Record<string, unknown>) => {
    const next = mapStageWorkspaceFromApi((await api.patch(`/projects/${project.id}/stage-workspaces/${stage}/`, payload)).data, stage);
    setWorkspace(next); queryClient.setQueryData(['stage-workspace', project.id, stage], next); return next;
  };
  const toggleChecklist = async (itemId: string) => {
    const previous = workspace.completedItems;
    const completedItems = previous.includes(itemId) ? previous.filter(id => id !== itemId) : [...previous, itemId];
    setWorkspace(prev => ({ ...prev, completedItems })); setSavingChecklist(itemId); setError(null);
    try { await patchWorkspace({ completed_items: completedItems }); } catch { setWorkspace(prev => ({ ...prev, completedItems: previous })); setError('Unable to update the checklist.'); } finally { setSavingChecklist(null); }
  };
  const saveGroup = async (group: 'guided' | 'shaping', items: ChecklistItem[]) => {
    setSavingGroup(true); setError(null);
    try { await patchWorkspace({ [group === 'guided' ? 'checklist' : 'shaping_checklist']: items }); setEditingGroup(null); } catch { setError('Unable to save checklist changes. Your draft is still here.'); } finally { setSavingGroup(false); }
  };
  const saveNotes = async () => {
    setSavingNotes(true); setError(null);
    try { await patchWorkspace({ notes: draftNotes }); try { localStorage.removeItem(draftKey); } catch { /* ignore */ } } catch { setError('Unable to save stage notes. Your draft is still here.'); } finally { setSavingNotes(false); }
  };
  const applyDefaults = async () => {
    try {
      const payload = (await api.get(`/settings/checklist-defaults/${stage}/`)).data;
      setDefaultsPreview({ checklist: payload.checklist || [], shapingChecklist: payload.shaping_checklist || [] });
    } catch { setError('Unable to apply your defaults.'); }
  };
  const confirmApplyDefaults = async () => { if (!defaultsPreview || !window.confirm('Replace this stage\'s two checklists with these defaults? Custom items will be removed.')) return; try { await patchWorkspace({ checklist: defaultsPreview.checklist, shaping_checklist: defaultsPreview.shapingChecklist }); setDefaultsPreview(null); } catch { setError('Unable to apply your defaults.'); } };
  const saveReview = async () => {
    try { const res = await api.post(`/projects/${project.id}/stage-reviews/${stage}/`, { decision: reviewDecision, note: reviewNote }); const saved = res.data?.review || res.data; setReview({ ...saved, stage, reviewedAt: saved.reviewed_at || saved.reviewedAt }); } catch { setError('Unable to save stage review.'); }
  };
  const renderGroup = (group: 'guided' | 'shaping', items: ChecklistItem[]) => {
    const count = complete(items); const title = group === 'guided' ? 'Guided checklist' : 'Shaping the build';
    if (editingGroup === group) return <ChecklistEditor title={title} items={items} saving={savingGroup} onCancel={() => setEditingGroup(null)} onSave={next => saveGroup(group, next)} />;
    return <section className="p-4 rounded-2xl bg-surface border border-line">
      <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2 text-sm font-black text-content">{group === 'guided' ? <ClipboardCheck className="w-4 h-4 text-emerald-500" /> : <Sparkles className="w-4 h-4 text-indigo-500" />}{title}</div><div className="flex items-center gap-2"><span className="text-xs font-mono text-content-faint">{count}/{items.length}</span><button type="button" onClick={() => setEditingGroup(group)} className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[11px] font-bold text-content-faint hover:text-indigo-500"><Pencil className="w-3 h-3" /> Edit</button></div></div>
      {items.length === 0 ? <button type="button" onClick={() => setEditingGroup(group)} className="w-full rounded-xl border border-dashed border-line p-4 text-xs font-bold text-content-faint hover:border-indigo-500">Empty list · Add item</button> : <div className="space-y-2">{items.map(item => { const checked = workspace.completedItems.includes(item.id); return <button key={item.id} type="button" onClick={() => void toggleChecklist(item.id)} disabled={savingChecklist !== null} className={`w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${checked ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-surface-2 border-line hover:border-indigo-500/40'}`}><span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${checked ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-line-strong'}`}>{savingChecklist === item.id ? <Loader2 className="w-3 h-3 animate-spin" /> : checked ? <Check className="w-3.5 h-3.5" /> : null}</span><span className={`text-xs font-bold ${checked ? 'text-emerald-700 dark:text-emerald-300 line-through' : 'text-content-muted'}`}>{item.label}</span></button>; })}</div>}
      <div className="mt-4 pt-3 border-t border-line"><div className="text-[11px] font-black uppercase tracking-wider text-content-faint mb-2">{group === 'guided' ? 'Prompts to consider' : 'Build review prompts'}</div>{(group === 'guided' ? workspace.prompts : workspace.shapingPrompts).map(prompt => <p key={prompt} className="text-xs text-content-muted mb-1.5">• {prompt}</p>)}</div>
    </section>;
  };
  if (workspaceQuery.isLoading) return <div className="space-y-3" aria-busy="true"><div className="h-24 rounded-2xl bg-surface-2 border border-line animate-pulse" /><div className="h-64 rounded-2xl bg-surface-2 border border-line animate-pulse" /></div>;
  return <div className="space-y-5">
    {(error || workspaceQuery.isError) && <div className="px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 text-xs font-bold text-rose-700 dark:text-rose-300" role="alert">{error || 'Unable to load this stage workspace.'}</div>}
    {dirty && <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-bold text-amber-700 dark:text-amber-300"><span>Unsaved stage notes (draft kept locally).</span><button type="button" onClick={() => void saveNotes()} disabled={savingNotes} className="px-3 py-1.5 rounded-lg bg-amber-600 text-white">{savingNotes ? 'Saving…' : 'Save now'}</button></div>}
    <div className="p-5 rounded-2xl bg-indigo-500/5 border border-indigo-500/20"><div className="flex flex-wrap items-center justify-between gap-4"><div><div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.15em] text-indigo-600 dark:text-indigo-400 font-mono"><Sparkles className="w-3.5 h-3.5" /> Stage workspace</div><div className="flex items-center gap-3 mt-2"><h3 className="text-xl font-black text-content">{STAGE_CONFIG[stage].label}</h3>{stage !== project.currentStage && <span className="text-[11px] rounded-full bg-surface px-2 py-1 border border-line text-content-faint">Browsing · current is {STAGE_CONFIG[project.currentStage].label}</span>}</div><p className="mt-1 text-sm text-content-muted max-w-2xl">{workspace.guidance}</p></div><label className="text-xs font-bold text-content-muted">Review stage<select value={stage} onChange={e => setStage(e.target.value as ProjectStage)} className="ml-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-content">{stages.map(item => <option key={item} value={item}>{STAGE_CONFIG[item].label}{item === project.currentStage ? ' · current' : ''}</option>)}</select></label></div><div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-5"><div className="p-3 rounded-xl bg-surface border border-line"><div className="text-[11px] text-content-faint font-mono">TASKS</div><div className="mt-1 text-lg font-black text-content">{stageTasks.filter(t => t.completed).length}/{stageTasks.length}</div></div><div className="p-3 rounded-xl bg-surface border border-line"><div className="text-[11px] text-content-faint font-mono">GUIDED</div><div className="mt-1 text-lg font-black text-content">{complete(workspace.checklist)}/{workspace.checklist.length}</div></div><div className="p-3 rounded-xl bg-surface border border-line"><div className="text-[11px] text-content-faint font-mono">SHAPING</div><div className="mt-1 text-lg font-black text-content">{complete(workspace.shapingChecklist)}/{workspace.shapingChecklist.length}</div></div><div className="p-3 rounded-xl bg-surface border border-line"><div className="text-[11px] text-content-faint font-mono">TIME</div><div className="mt-1 text-lg font-black text-content">{(stageTime / 3600).toFixed(1)}h</div></div></div></div>
    <div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => void applyDefaults()} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-content-faint hover:text-indigo-500"><RotateCcw className="w-3.5 h-3.5" /> Apply my defaults</button></div>
    {defaultsPreview && <section className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4"><div className="flex items-center justify-between gap-3"><div><h4 className="text-sm font-black text-content">Preview default replacement</h4><p className="mt-1 text-xs text-content-muted">Custom items will be removed. Completion is kept only for unchanged IDs.</p></div><button type="button" onClick={() => setDefaultsPreview(null)} className="text-xs font-bold text-content-faint">Cancel</button></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><PreviewList title="Guided" items={defaultsPreview.checklist} /><PreviewList title="Shaping" items={defaultsPreview.shapingChecklist} /></div><button type="button" onClick={() => void confirmApplyDefaults()} className="mt-3 rounded-lg bg-amber-600 px-3 py-2 text-xs font-black text-white">Confirm replacement</button></section>}
    <div className="grid lg:grid-cols-2 gap-5">{renderGroup('guided', workspace.checklist)}{renderGroup('shaping', workspace.shapingChecklist)}</div>
    <section className="p-4 rounded-2xl bg-surface border border-line"><div className="flex items-center justify-between gap-3 mb-3"><div className="flex items-center gap-2 text-sm font-black text-content"><FileText className="w-4 h-4 text-indigo-500" /> Stage notes</div><div className="flex items-center gap-2"><button type="button" onClick={() => setMode('edit')} className={`px-2.5 py-1 rounded-lg text-xs font-bold ${mode === 'edit' ? 'bg-indigo-600 text-white' : 'text-content-faint'}`}>Edit</button><button type="button" onClick={() => setMode('preview')} className={`px-2.5 py-1 rounded-lg text-xs font-bold ${mode === 'preview' ? 'bg-indigo-600 text-white' : 'text-content-faint'}`}>Preview</button></div></div>{mode === 'edit' ? <><textarea ref={notesAreaRef} value={draftNotes} onChange={e => setDraftNotes(e.target.value)} onPaste={e => void handleNotesPaste(e)} rows={10} placeholder={`Capture decisions, blockers, and next actions for ${STAGE_CONFIG[stage].label.toLowerCase()}… (tip: paste images to embed them)`} className="w-full resize-y rounded-xl bg-surface-2 border border-line p-3 text-sm text-content outline-none focus:border-indigo-500 font-mono" aria-label="Stage notes editor" />{notesPasteNotice && <p className="mt-1 text-xs font-bold text-indigo-600 dark:text-indigo-300" role="status">{notesPasteNotice}</p>}</> : <div className="md-preview min-h-[240px] rounded-xl bg-surface-2 border border-line p-4 text-sm text-content" dangerouslySetInnerHTML={{ __html: renderMarkdownSafe(draftNotes || '*No notes yet.*') }} />}<div className="flex items-center justify-between mt-3"><span className="text-xs text-content-faint">{dirty ? 'Unsaved changes' : workspace.updatedAt ? `Updated ${new Date(workspace.updatedAt).toLocaleDateString()}` : 'Not saved yet'}</span><button type="button" onClick={() => void saveNotes()} disabled={savingNotes || !dirty} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 text-white text-xs font-black disabled:opacity-40"><Save className="w-3.5 h-3.5" /> Save notes</button></div></section>
    <section className="p-4 rounded-2xl bg-surface border border-line"><div className="flex items-center justify-between"><div><h4 className="text-sm font-black text-content">Stage review</h4><p className="text-xs text-content-faint mt-1">Capture a decision without changing the project stage.</p></div>{review?.reviewedAt && <span className="text-[11px] text-content-faint">Last reviewed {new Date(review.reviewedAt).toLocaleString()}</span>}</div><div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-3 text-xs"><span className="rounded-lg bg-surface-2 p-2">Tasks {stageTasks.filter(t => t.completed).length}/{stageTasks.length}</span><span className="rounded-lg bg-surface-2 p-2">Blockers {stageTasks.filter(t => t.blockerReason).length}</span><span className="rounded-lg bg-surface-2 p-2">Milestones {project.milestones.filter(m => m.stage === stage && m.completed).length}/{project.milestones.filter(m => m.stage === stage).length}</span><span className="rounded-lg bg-surface-2 p-2">Guided {complete(workspace.checklist)}/{workspace.checklist.length}</span><span className="rounded-lg bg-surface-2 p-2">Shaping {complete(workspace.shapingChecklist)}/{workspace.shapingChecklist.length}</span></div><div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs"><div><div className="font-black text-content-faint">Outstanding tasks</div>{stageTasks.filter(t => !t.completed).slice(0, 5).map(t => <div key={t.id} className="mt-1 truncate text-content-muted">• {t.title}</div>)}</div><div><div className="font-black text-content-faint">Blockers</div>{stageTasks.filter(t => t.blockerReason).slice(0, 5).map(t => <div key={t.id} className="mt-1 truncate text-rose-600 dark:text-rose-300">• {t.blockerReason} <span className="text-content-faint">({t.blockerNextAction || 'next action needed'})</span></div>)}</div><div><div className="font-black text-content-faint">Milestones</div>{project.milestones.filter(m => m.stage === stage && !m.completed).slice(0, 5).map(m => <div key={m.id} className="mt-1 truncate text-content-muted">• {m.title}</div>)}</div></div><div className="mt-3 flex flex-wrap gap-2"><select value={reviewDecision} onChange={e => setReviewDecision(e.target.value as 'continue' | 'ready')} className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs font-bold text-content"><option value="continue">Continue working</option><option value="ready">Ready to advance</option></select><input value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Optional review note" className="min-w-[220px] flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-content" /><button type="button" onClick={() => void saveReview()} className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white">Save review</button></div></section>
  </div>;
};

const PreviewList: React.FC<{ title: string; items: ChecklistItem[] }> = ({ title, items }) => <div className="rounded-xl border border-line bg-surface p-3"><div className="text-[11px] font-black uppercase tracking-wider text-content-faint">{title} ({items.length})</div><ul className="mt-2 space-y-1">{items.map(item => <li key={item.id} className="text-xs text-content-muted">• {item.label}</li>)}</ul></div>;

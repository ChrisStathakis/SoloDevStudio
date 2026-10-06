import React, { useState } from 'react';
import { ArrowDown, ArrowUp, Check, Eye, EyeOff, Loader2, Pencil, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import { api } from '../services/api';
import { useWorkflowStages } from '../hooks/useWorkflowStages';
import { useToast } from './Toaster';
import type { WorkflowStage } from '../types';

const COLOR_PRESETS = ['#f59e0b', '#3b82f6', '#8b5cf6', '#6366f1', '#f43f5e', '#14b8a6', '#10b981', '#64748b'];

function usageText(stage: WorkflowStage): string | null {
  const u = stage.usage;
  if (!u) return null;
  const parts: string[] = [];
  if (u.projects > 0) parts.push(`${u.projects} project${u.projects === 1 ? '' : 's'}`);
  if (u.tasks > 0) parts.push(`${u.tasks} task${u.tasks === 1 ? '' : 's'}`);
  if (u.milestones > 0) parts.push(`${u.milestones} milestone${u.milestones === 1 ? '' : 's'}`);
  if (u.timeEntries > 0) parts.push(`${u.timeEntries} time`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export const StageDefinitionsManager: React.FC = () => {
  const { stages, refresh } = useWorkflowStages();
  const { confirm, toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftColor, setDraftColor] = useState(COLOR_PRESETS[3]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [editingDescription, setEditingDescription] = useState('');
  const [editingColor, setEditingColor] = useState(COLOR_PRESETS[3]);
  const [migrateKey, setMigrateKey] = useState<string | null>(null);
  const [migrateTo, setMigrateTo] = useState('');

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusyKey(key);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e: any) {
      const data = e?.response?.data;
      setError(data?.label?.[0] || data?.detail || data?.migrate_to?.[0] || 'Unable to save stage.');
    } finally {
      setBusyKey(null);
    }
  };

  const add = async () => {
    const label = draftLabel.trim();
    if (!label) return;
    await withBusy('new', async () => {
      await api.post('/settings/stages/', { label, description: draftDescription.trim(), color: draftColor });
      setDraftLabel('');
      setDraftDescription('');
    });
  };

  const startEdit = (stage: WorkflowStage) => {
    setEditingKey(stage.key);
    setEditingLabel(stage.label);
    setEditingDescription(stage.description || '');
    setEditingColor(stage.color || COLOR_PRESETS[3]);
    setError(null);
  };

  const saveEdit = async (stage: WorkflowStage) => {
    const label = editingLabel.trim();
    if (!label) return;
    await withBusy(stage.key, async () => {
      await api.patch(`/settings/stages/${stage.key}/`, { label, description: editingDescription.trim(), color: editingColor });
      setEditingKey(null);
    });
  };

  const move = async (index: number, direction: -1 | 1) => {
    const next = [...stages];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    await withBusy(moved.key, async () => {
      await api.post('/settings/stages/reorder/', { ordered_keys: next.map(s => s.key) });
    });
  };

  const toggleActive = async (stage: WorkflowStage) => {
    if (stage.isActive) {
      const used = usageText(stage);
      if (used) {
        setMigrateKey(stage.key);
        setMigrateTo(stages.find(s => s.key !== stage.key && s.isActive)?.key || '');
        return;
      }
      const ok = await confirm({ title: `Hide stage "${stage.label}"?`, description: 'It stays in your data and can be shown again later.', confirmLabel: 'Hide stage' });
      if (!ok) return;
    }
    await withBusy(stage.key, async () => {
      await api.patch(`/settings/stages/${stage.key}/`, { is_active: !stage.isActive });
    });
  };

  const confirmMigrateHide = async (stage: WorkflowStage) => {
    if (!migrateTo || migrateTo === stage.key) {
      setError('Choose where to move existing items.');
      return;
    }
    await withBusy(stage.key, async () => {
      await api.patch(`/settings/stages/${stage.key}/`, { is_active: false, migrate_to: migrateTo });
      setMigrateKey(null);
    });
  };

  const remove = async (stage: WorkflowStage) => {
    const used = usageText(stage);
    const ok = await confirm({
      title: stage.isBuiltin ? `Hide stage "${stage.label}"?` : `Delete stage "${stage.label}"?`,
      description: stage.isBuiltin
        ? 'Built-in stages are hidden, not deleted — defaults stay available via Reset.'
        : used
          ? `Still used by ${used}. Choose where to move those items first (use Hide with migration).`
          : 'This custom stage will be permanently removed.',
      confirmLabel: stage.isBuiltin ? 'Hide stage' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    if (!stage.isBuiltin && used) return;
    await withBusy(stage.key, async () => {
      await api.delete(`/settings/stages/${stage.key}/`);
    });
    toast({ title: stage.isBuiltin ? 'Stage hidden' : 'Stage deleted' });
  };

  const reset = async () => {
    const ok = await confirm({ title: 'Restore the 7 default stages?', description: 'Custom stages are removed and built-ins return to their default names and order.', confirmLabel: 'Restore defaults', danger: true });
    if (!ok) return;
    await withBusy('reset', async () => {
      await api.post('/settings/stages/reset/');
    });
    toast({ title: 'Default stages restored' });
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-content">Lifecycle stages</h3>
            <p className="text-xs text-content-faint mt-1">Rename, hide, reorder, or add phases. The 7 built-ins are never lost — hiding keeps your data, and Reset restores defaults.</p>
          </div>
          <button type="button" onClick={() => void reset()} disabled={busyKey !== null} className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-black text-content-faint hover:text-indigo-500 disabled:opacity-40 shrink-0">
            <RotateCcw className="w-3.5 h-3.5" />Reset
          </button>
        </div>

        <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
          <input value={draftLabel} onChange={e => setDraftLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add(); }} maxLength={100} placeholder="New phase name, e.g. User Research" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-content" />
          <input value={draftDescription} onChange={e => setDraftDescription(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void add(); }} maxLength={1000} placeholder="Short description (optional)" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs text-content" />
          <div className="flex items-center gap-2 flex-wrap">
            {COLOR_PRESETS.map(color => (
              <button key={color} type="button" onClick={() => setDraftColor(color)} aria-label={`Pick color ${color}`} className={`w-6 h-6 rounded-full border-2 ${draftColor === color ? 'border-content' : 'border-transparent'}`} style={{ backgroundColor: color }} />
            ))}
            <button type="button" onClick={() => void add()} disabled={!draftLabel.trim() || busyKey !== null} className="ml-auto flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40">
              {busyKey === 'new' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}Add phase
            </button>
          </div>
        </div>

        {error && <p className="text-xs font-bold text-rose-700 dark:text-rose-300" role="alert">{error}</p>}

        <div className="space-y-2">
          {stages.map((stage, index) => {
            const used = usageText(stage);
            const isEditing = editingKey === stage.key;
            const isMigrating = migrateKey === stage.key;
            return (
              <div key={stage.key} className={`rounded-xl border p-3 ${stage.isActive ? 'border-line bg-surface-2' : 'border-dashed border-line bg-surface opacity-70'}`}>
                <div className="flex items-center gap-3">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: stage.color || '#6366f1' }} />
                  {isEditing ? (
                    <div className="flex-1 min-w-0 space-y-2">
                      <input value={editingLabel} onChange={e => setEditingLabel(e.target.value)} maxLength={100} className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-content" autoFocus />
                      <input value={editingDescription} onChange={e => setEditingDescription(e.target.value)} maxLength={1000} placeholder="Short description (optional)" className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-content" />
                      <div className="flex items-center gap-1.5">
                        {COLOR_PRESETS.map(color => (
                          <button key={color} type="button" onClick={() => setEditingColor(color)} aria-label={`Pick color ${color}`} className={`w-5 h-5 rounded-full border-2 ${editingColor === color ? 'border-content' : 'border-transparent'}`} style={{ backgroundColor: color }} />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-content truncate">{stage.label}</span>
                        {stage.isBuiltin && <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-surface-3 border border-line text-content-faint">default</span>}
                        {!stage.isActive && <span className="text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300">hidden</span>}
                        <span className="text-[11px] font-mono text-content-faint">{stage.key}</span>
                      </div>
                      {stage.description && <p className="mt-0.5 text-xs text-content-faint line-clamp-2">{stage.description}</p>}
                      {used && <p className="mt-1 text-[11px] font-bold text-content-faint">In use: {used}</p>}
                    </div>
                  )}
                  {busyKey === stage.key ? (
                    <Loader2 className="w-4 h-4 animate-spin text-indigo-600 shrink-0" />
                  ) : isEditing ? (
                    <>
                      <button type="button" onClick={() => void saveEdit(stage)} className="p-1.5 text-emerald-700 dark:text-emerald-300" title="Save stage"><Check className="w-4 h-4" /></button>
                      <button type="button" onClick={() => setEditingKey(null)} className="p-1.5 text-content-faint" title="Cancel"><X className="w-4 h-4" /></button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => void move(index, -1)} disabled={index === 0} className="p-1.5 text-content-faint hover:text-content disabled:opacity-30" title="Move up"><ArrowUp className="w-4 h-4" /></button>
                      <button type="button" onClick={() => void move(index, 1)} disabled={index === stages.length - 1} className="p-1.5 text-content-faint hover:text-content disabled:opacity-30" title="Move down"><ArrowDown className="w-4 h-4" /></button>
                      <button type="button" onClick={() => startEdit(stage)} className="p-1.5 text-content-faint hover:text-indigo-600" title="Rename stage"><Pencil className="w-4 h-4" /></button>
                      <button type="button" onClick={() => void toggleActive(stage)} className="p-1.5 text-content-faint hover:text-content" title={stage.isActive ? 'Hide stage' : 'Show stage'}>
                        {stage.isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                      <button type="button" onClick={() => void remove(stage)} className="p-1.5 text-content-faint hover:text-rose-600" title={stage.isBuiltin ? 'Hide built-in stage' : 'Delete custom stage'}><Trash2 className="w-4 h-4" /></button>
                    </>
                  )}
                </div>
                {isMigrating && (
                  <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                    <p className="text-xs font-bold text-content">“{stage.label}” is used by {used}. Move those items to:</p>
                    <div className="flex gap-2">
                      <select value={migrateTo} onChange={e => setMigrateTo(e.target.value)} className="flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-content">
                        {stages.filter(s => s.key !== stage.key && s.isActive).map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                      </select>
                      <button type="button" onClick={() => void confirmMigrateHide(stage)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black text-white">Move & hide</button>
                      <button type="button" onClick={() => setMigrateKey(null)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-content-faint">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

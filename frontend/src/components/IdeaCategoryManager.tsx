import React, { useState } from 'react';
import { Check, Loader2, Pencil, Plus, Tags, Trash2, X } from 'lucide-react';
import { api } from '../services/api';
import { useIdeaCategories } from '../hooks/useIdeaCategories';

export const IdeaCategoryManager: React.FC = () => {
  const { categories, isLoading, refresh } = useIdeaCategories();
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    setBusyId('new');
    setError(null);
    try {
      await api.post('/idea-categories/', { name });
      setDraft('');
      await refresh();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.name?.[0] || 'Unable to add category.');
    } finally {
      setBusyId(null);
    }
  };

  const save = async (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    setBusyId(id);
    setError(null);
    try {
      await api.patch(`/idea-categories/${id}/`, { name });
      setEditingId(null);
      await refresh();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.name?.[0] || 'Unable to update category.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string, name: string, ideaCount: number) => {
    if (ideaCount > 0 || !window.confirm(`Delete category "${name}"?`)) return;
    setBusyId(id);
    setError(null);
    try {
      await api.delete(`/idea-categories/${id}/`);
      await refresh();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.detail || 'Unable to delete category.');
    } finally {
      setBusyId(null);
    }
  };

  return <div className="max-w-3xl space-y-4">
    <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
      <div>
        <h3 className="text-sm font-black text-content">Idea categories</h3>
        <p className="text-xs text-content-faint mt-1">Create categories for Idea Canvas. Categories used by ideas cannot be deleted, so existing ideas stay assigned.</p>
      </div>
      <div className="flex gap-2">
        <input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void add(); }} maxLength={50} placeholder="New category name" className="min-w-0 flex-1 rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs text-content" />
        <button type="button" onClick={() => void add()} disabled={!draft.trim() || busyId !== null} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40"><Plus className="w-3.5 h-3.5" />Add</button>
      </div>
      {error && <p className="text-xs font-bold text-rose-700 dark:text-rose-300" role="alert">{error}</p>}
      {isLoading ? <div className="flex justify-center py-10 text-content-faint"><Loader2 className="w-5 h-5 animate-spin" /></div> : <div className="space-y-2">
        {categories.map(category => <div key={category.id} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 p-3">
          <Tags className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
          {editingId === category.id ? <input value={editingName} onChange={event => setEditingName(event.target.value)} maxLength={50} className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs text-content" autoFocus /> : <span className="min-w-0 flex-1 truncate text-sm font-bold text-content">{category.name}</span>}
          <span className="rounded-md border border-line px-2 py-0.5 text-[11px] font-mono text-content-faint">{category.ideaCount} idea{category.ideaCount === 1 ? '' : 's'}</span>
          {busyId === category.id ? <Loader2 className="w-4 h-4 animate-spin text-indigo-600" /> : editingId === category.id ? <><button type="button" onClick={() => void save(category.id)} className="p-1.5 text-emerald-700 dark:text-emerald-300" title="Save category"><Check className="w-4 h-4" /></button><button type="button" onClick={() => setEditingId(null)} className="p-1.5 text-content-faint" title="Cancel"><X className="w-4 h-4" /></button></> : <><button type="button" onClick={() => { setEditingId(category.id); setEditingName(category.name); }} className="p-1.5 text-content-faint hover:text-indigo-600" title="Edit category"><Pencil className="w-4 h-4" /></button><button type="button" onClick={() => void remove(category.id, category.name, category.ideaCount)} disabled={category.ideaCount > 0} className="p-1.5 text-content-faint hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-30" title={category.ideaCount > 0 ? 'Reassign ideas before deleting this category' : 'Delete category'}><Trash2 className="w-4 h-4" /></button></>}
        </div>)}
      </div>}
    </div>
  </div>;
};

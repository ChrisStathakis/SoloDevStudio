import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from 'lucide-react';
import { ChecklistItem } from '../types';

export interface ChecklistEditorProps {
  title: string;
  items: ChecklistItem[];
  onSave: (items: ChecklistItem[]) => Promise<void>;
  onCancel?: () => void;
  saving?: boolean;
}

const makeId = () => `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const ChecklistEditor: React.FC<ChecklistEditorProps> = ({ title, items, onSave, onCancel, saving }) => {
  const [draft, setDraft] = useState<ChecklistItem[]>(items);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(items), [items]);
  const update = (id: string, label: string) => setDraft(prev => prev.map(item => item.id === id ? { ...item, label } : item));
  const move = (index: number, delta: number) => setDraft(prev => {
    const next = [...prev]; const target = index + delta;
    if (target < 0 || target >= next.length) return prev;
    [next[index], next[target]] = [next[target], next[index]]; return next;
  });
  const save = async () => {
    const trimmed = draft.map(item => ({ ...item, label: item.label.trim() }));
    if (trimmed.some(item => !item.label)) { setError('Every checklist item needs a label.'); return; }
    setError(null); await onSave(trimmed);
  };
  return <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-3 space-y-2">
    <div className="flex items-center justify-between gap-2"><span className="text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">Editing {title}</span><button type="button" onClick={onCancel} className="p-1 rounded-md text-content-faint hover:text-content" aria-label="Cancel editing"><X className="w-4 h-4" /></button></div>
    {draft.length === 0 && <p className="text-xs text-content-faint py-2">This list is empty. Add the first item when you are ready.</p>}
    {draft.map((item, index) => <div key={item.id} className="flex items-center gap-1.5">
      <input value={item.label} onChange={e => update(item.id, e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-content outline-none focus:border-indigo-500" aria-label={`${title} item ${index + 1}`} />
      <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="p-1.5 rounded-md text-content-faint hover:text-indigo-500 disabled:opacity-30" aria-label="Move item up"><ArrowUp className="w-3.5 h-3.5" /></button>
      <button type="button" onClick={() => move(index, 1)} disabled={index === draft.length - 1} className="p-1.5 rounded-md text-content-faint hover:text-indigo-500 disabled:opacity-30" aria-label="Move item down"><ArrowDown className="w-3.5 h-3.5" /></button>
      <button type="button" onClick={() => setDraft(prev => prev.filter(entry => entry.id !== item.id))} className="p-1.5 rounded-md text-content-faint hover:text-rose-500" aria-label={`Delete ${item.label}`}><Trash2 className="w-3.5 h-3.5" /></button>
    </div>)}
    {error && <p className="text-xs text-rose-600 dark:text-rose-300" role="alert">{error}</p>}
    <div className="flex items-center justify-between gap-2 pt-1"><button type="button" onClick={() => setDraft(prev => [...prev, { id: makeId(), label: '' }])} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-bold text-content-muted hover:border-indigo-500"><Plus className="w-3.5 h-3.5" /> Add item</button><div className="flex gap-2"><button type="button" onClick={onCancel} className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-content-faint hover:text-content">Cancel</button><button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50"><Save className="w-3.5 h-3.5" />{saving ? 'Saving…' : 'Save'}</button></div></div>
  </div>;
};

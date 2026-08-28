import React, { useState } from 'react';
import { api } from '../services/api';
import type { AgentFilter } from '../types';
import { X, Loader2, Save, Filter } from 'lucide-react';

interface AgentFilterModalProps {
  initial?: AgentFilter | null;
  onClose: () => void;
  onSaved: (filter: AgentFilter) => void;
}

export const AgentFilterModal: React.FC<AgentFilterModalProps> = ({ initial = null, onClose, onSaved }) => {
  const isEdit = Boolean(initial);
  const [name, setName] = useState<string>(initial?.name || '');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim() || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = isEdit
        ? await api.patch(`/agent-filters/${initial!.id}/`, { name: name.trim() })
        : await api.post('/agent-filters/', { name: name.trim() });
      onSaved({
        id: String(res.data.id),
        name: res.data.name,
        slug: res.data.slug,
        order: res.data.order ?? 0
      });
    } catch (e: any) {
      console.error('Failed to save agent filter', e);
      const detail = e?.response?.data;
      const msg = typeof detail?.name === 'string' ? detail.name
        : Array.isArray(detail?.name) && detail.name.length ? String(detail.name[0])
        : typeof detail === 'string' ? detail
        : 'Failed to save filter.';
      setError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-surface border border-line shadow-2xl animate-in zoom-in-95"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <Filter className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div>
              <h3 className="text-sm font-black text-content tracking-tight">
                {isEdit ? 'Edit Filter' : 'New Filter'}
              </h3>
              <p className="text-[13px] text-content-faint mt-0.5">
                {isEdit ? 'Rename this agent filter.' : 'Create a new agent filter category.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-content-faint hover:text-white hover:bg-surface-3 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {error && (
            <div className="px-3 py-2 rounded-xl bg-rose-950/30 border border-rose-900/50 text-xs font-bold text-rose-300">
              {error}
            </div>
          )}
          <label className="block">
            <span className="block text-[12px] font-black uppercase tracking-[0.15em] text-content-faint font-mono mb-1.5">
              Name
            </span>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSave();
              }}
              placeholder="e.g. Research"
              autoFocus
              className="w-full px-3 py-2.5 bg-surface-2 border border-line focus:border-indigo-500 rounded-xl text-xs font-bold text-content placeholder:text-slate-600 outline-none transition-colors"
            />
          </label>
          <p className="text-[12px] text-slate-600">
            {isEdit && initial
              ? `Slug stays as ./${initial.slug} — agents keep their link.`
              : 'A slug is generated automatically from the name.'}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-5 pt-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-xl bg-surface-2 border border-line text-content-muted hover:text-white hover:border-line-strong text-xs font-black transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !name.trim()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white text-xs font-black shadow-sm transition-all"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isEdit ? 'Save' : 'Create Filter'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

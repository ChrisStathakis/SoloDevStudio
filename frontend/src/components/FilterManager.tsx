import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, unwrapPaginated } from '../services/api';
import { mapProjectDocFromApi } from '../services/mappers';
import type { AgentFilter, ProjectDoc } from '../types';
import { useAgentFilters } from '../hooks/useAgentFilters';
import { AgentFilterModal } from './AgentFilterModal';
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Filter,
  ArrowUp,
  ArrowDown,
  ListFilter
} from 'lucide-react';

export const FilterManager: React.FC = () => {
  const { filters, isLoading: isLoadingFilters, refresh } = useAgentFilters();
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState<boolean>(true);
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<AgentFilter | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoadingDocs(true);
      try {
        const res = await api.get('/docs/', { params: { page_size: 100 } });
        if (!cancelled) setDocs(unwrapPaginated<any>(res.data).map(mapProjectDocFromApi));
      } catch (e) {
        console.error('Failed to load docs', e);
      } finally {
        if (!cancelled) setIsLoadingDocs(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const sorted = useMemo(
    () => [...filters].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
    [filters]
  );

  const usageCount = useCallback(
    (filterId: string) => docs.filter(d => d.filterId === filterId).length,
    [docs]
  );

  const openCreate = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const openEdit = (f: AgentFilter) => {
    setEditing(f);
    setModalOpen(true);
  };

  const handleSaved = async () => {
    setModalOpen(false);
    setEditing(null);
    await refresh();
  };

  const handleDelete = async (f: AgentFilter) => {
    const used = usageCount(f.id);
    const msg = used > 0
      ? `Delete filter "${f.name}"? ${used} agent${used > 1 ? 's are' : ' is'} using it and will become uncategorized.`
      : `Delete filter "${f.name}"?`;
    if (!window.confirm(msg)) return;
    setBusyId(f.id);
    setError(null);
    try {
      await api.delete(`/agent-filters/${f.id}/`);
      await refresh();
    } catch (e) {
      console.error('Failed to delete agent filter', e);
      setError('Failed to delete filter.');
    } finally {
      setBusyId(null);
    }
  };

  const handleMove = async (f: AgentFilter, dir: 'up' | 'down') => {
    const idx = sorted.findIndex(x => x.id === f.id);
    const swapWith = dir === 'up' ? sorted[idx - 1] : sorted[idx + 1];
    if (!swapWith || busyId) return;
    setBusyId(f.id);
    setError(null);
    try {
      await api.patch(`/agent-filters/${f.id}/`, { order: swapWith.order });
      await api.patch(`/agent-filters/${swapWith.id}/`, { order: f.order });
      await refresh();
    } catch (e) {
      console.error('Failed to reorder agent filters', e);
      setError('Failed to reorder filters.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-content-faint font-medium">
          Categories used to filter agents in agent lists — Backend, Frontend, Tools, Docs and any you add.
        </p>
        <button
          type="button"
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-lg shadow-indigo-600/20 transition-all shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>New Filter</span>
        </button>
      </div>

      {error && (
        <div className="px-4 py-2.5 rounded-xl bg-rose-950/30 border border-rose-900/50 text-xs font-bold text-rose-300">
          {error}
        </div>
      )}

      {isLoadingFilters || isLoadingDocs ? (
        <div className="flex items-center justify-center py-16 text-content-faint">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-line rounded-2xl bg-surface/50">
          <ListFilter className="w-10 h-10 text-slate-700 mb-3" />
          <p className="text-sm font-black text-content-faint">No filters yet</p>
          <p className="text-xs text-slate-600 mt-1">Create your first filter to categorize agents.</p>
          <button
            type="button"
            onClick={openCreate}
            className="mt-4 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Filter</span>
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map((f, idx) => {
            const used = usageCount(f.id);
            const isBusy = busyId === f.id;
            return (
              <div
                key={f.id}
                className="group flex items-center gap-3 p-4 rounded-2xl bg-surface border border-line shadow-md"
              >
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button
                    type="button"
                    disabled={idx === 0 || isBusy || Boolean(busyId)}
                    onClick={() => handleMove(f, 'up')}
                    className="p-1 rounded-lg text-content-faint hover:text-indigo-400 hover:bg-indigo-500/10 transition-all disabled:opacity-20 disabled:hover:text-content-faint disabled:hover:bg-transparent"
                    title="Move up"
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === sorted.length - 1 || isBusy || Boolean(busyId)}
                    onClick={() => handleMove(f, 'down')}
                    className="p-1 rounded-lg text-content-faint hover:text-indigo-400 hover:bg-indigo-500/10 transition-all disabled:opacity-20 disabled:hover:text-content-faint disabled:hover:bg-transparent"
                    title="Move down"
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 shrink-0">
                  <Filter className="w-4 h-4 text-indigo-400" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-black text-content truncate">{f.name}</span>
                    <span className="text-[12px] font-mono font-bold text-content-faint">/{f.slug}</span>
                    <span
                      className={`text-[12px] font-mono font-bold px-2 py-0.5 rounded-md ${
                        used > 0
                          ? 'text-emerald-300 bg-emerald-500/10 border border-emerald-500/20'
                          : 'text-content-faint bg-surface-2 border border-line'
                      }`}
                    >
                      {used} agent{used === 1 ? '' : 's'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {isBusy && <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />}
                  <button
                    type="button"
                    onClick={() => openEdit(f)}
                    disabled={Boolean(busyId)}
                    className="p-1.5 rounded-lg text-content-faint hover:text-indigo-400 hover:bg-indigo-500/10 transition-all disabled:opacity-40"
                    title="Edit filter"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(f)}
                    disabled={Boolean(busyId)}
                    className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all disabled:opacity-40"
                    title="Delete filter"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <AgentFilterModal
          initial={editing}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
};

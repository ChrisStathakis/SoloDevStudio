import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrapPaginated } from '../services/api';
import { mapProjectDocFromApi } from '../services/mappers';
import type { ProjectDoc } from '../types';
import { useApp } from '../context/AppContext';
import { useAgentFilters } from '../hooks/useAgentFilters';
import {
  FileText,
  Plus,
  Trash2,
  Loader2,
  FileCode2,
  Link2,
  Filter,
  Copy,
  Check,
  ClipboardPlus,
  Power
} from 'lucide-react';
import { DocEditor } from './DocEditor';
import { LinkDocModal } from './LinkDocModal';
import { useToast } from './Toaster';

interface DocsTabProps {
  projectId: string;
  onPromptAdded?: () => void;
}

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
};

export const DocsTab: React.FC<DocsTabProps> = ({ projectId, onPromptAdded }) => {
  const { projects, refreshData } = useApp();

  const [error, setError] = useState<string | null>(null);
  const [selectedFilterId, setSelectedFilterId] = useState<string>('all');
  const { filters: agentFilters } = useAgentFilters();

  // null = list view, 'new' = creating, otherwise editing existing doc id
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [showLinkModal, setShowLinkModal] = useState<boolean>(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [addedId, setAddedId] = useState<string | null>(null);
  const { confirm } = useToast();
  const queryClient = useQueryClient();

  // Server list is cached per project; local state holds optimistic edits on top
  const docsQuery = useQuery({
    queryKey: ['project-docs', projectId],
    queryFn: async (): Promise<ProjectDoc[]> => {
      const res = await api.get('/docs/', { params: { project: projectId, page_size: 100 } });
      return unwrapPaginated<any>(res.data).map(mapProjectDocFromApi);
    },
  });
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Fresh project: clear editor + stale filter, then sync server list when it arrives
  useEffect(() => {
    setOpenDocId(null);
    setSelectedFilterId('all');
    setDocs([]);
    setIsLoading(true);
  }, [projectId]);

  useEffect(() => {
    if (docsQuery.data) {
      setDocs(docsQuery.data);
      setIsLoading(false);
    } else if (docsQuery.isError) {
      setError('Failed to load skills.');
      setIsLoading(false);
    } else {
      setIsLoading(docsQuery.isLoading);
    }
  }, [docsQuery.data, docsQuery.isError, docsQuery.isLoading]);

  const copyTimeout = React.useRef<number | null>(null);

  const handleCopy = async (doc: ProjectDoc) => {
    try {
      await navigator.clipboard.writeText(doc.content || '');
      setCopiedId(doc.id);
      if (copyTimeout.current) window.clearTimeout(copyTimeout.current);
      copyTimeout.current = window.setTimeout(() => setCopiedId(null), 1500);
    } catch (e) {
      console.error('Failed to copy doc content', e);
    }
  };

  const handleToggleActive = async (doc: ProjectDoc) => {
    const next = doc.active === false;
    try {
      await api.patch(`/projects/${projectId}/agents/${doc.id}/`, { active: next });
      setDocs(prev => {
        const updated = prev.map(item => item.id === doc.id ? { ...item, active: next } : item);
        queryClient.setQueryData<ProjectDoc[]>(['project-docs', projectId], updated);
        return updated;
      });
    } catch (e) {
      console.error('Failed to update agent activity', e);
      setError('Failed to update agent activity.');
    }
  };

  const handleAddToPrompt = async (doc: ProjectDoc) => {
    if (addingId === doc.id) return;
    setAddingId(doc.id);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/agents/${doc.id}/add-to-prompt/`);
      setAddedId(doc.id);
      window.setTimeout(() => setAddedId(current => current === doc.id ? null : current), 1800);
      await refreshData();
      onPromptAdded?.();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to add skill to the project prompt.');
    } finally {
      setAddingId(null);
    }
  };

  const openNewDoc = () => setOpenDocId('new');

  const openDoc = (doc: ProjectDoc) => setOpenDocId(doc.id);

  // Editor saved (created or updated) — sync into this project's list + cache
  const handleSaved = (doc: ProjectDoc) => {
    setDocs(prev => {
      const next = !doc.projectIds.includes(projectId)
        ? prev.filter(d => d.id !== doc.id)
        : prev.some(d => d.id === doc.id)
          ? prev.map(d => (d.id === doc.id ? doc : d))
          : [doc, ...prev];
      queryClient.setQueryData<ProjectDoc[]>(['project-docs', projectId], next);
      return next;
    });
  };

  const handleDeleted = (id: string) => {
    setDocs(prev => {
      const next = prev.filter(d => d.id !== id);
      queryClient.setQueryData<ProjectDoc[]>(['project-docs', projectId], next);
      return next;
    });
    if (openDocId === id) setOpenDocId(null);
  };

  const handleLinked = (doc: ProjectDoc) => {
    setDocs(prev => {
      const next = prev.some(d => d.id === doc.id) ? prev : [doc, ...prev];
      queryClient.setQueryData<ProjectDoc[]>(['project-docs', projectId], next);
      return next;
    });
  };

  const openEditingDoc = docs.find(d => d.id === openDocId) || null;

  const visibleDocs = selectedFilterId === 'all'
    ? docs
    : docs.filter(d => d.filterId === selectedFilterId);

  const countForFilter = (filterId: string) =>
    filterId === 'all' ? docs.length : docs.filter(d => d.filterId === filterId).length;

  // ---------- EDITOR VIEW ----------
  if (openDocId) {
    return (
      <div className="space-y-4">
        {error && (
          <div className="px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs font-bold text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}
        <DocEditor
          allProjects={projects}
          initialDoc={openDocId === 'new' ? null : openEditingDoc}
          preselectedProjectIds={openDocId === 'new' ? [projectId] : []}
          contextProjectId={projectId}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onBack={() => setOpenDocId(null)}
        />
      </div>
    );
  }

  // ---------- LIST VIEW ----------
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-content-faint font-medium">
          Skills linked to this project — specs, orchestrator prompts, runbooks, notes.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowLinkModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-surface-2 border border-line hover:border-indigo-700 text-content-muted hover:text-content text-xs font-black transition-all"
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>Link Existing Skill</span>
          </button>
          <button
            type="button"
            id="btn-add-new-doc"
            onClick={openNewDoc}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Skill</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs font-bold text-rose-700 dark:text-rose-300" role="alert">
          <span>{error}</span>
          {docsQuery.isError && (
            <button type="button" onClick={() => void docsQuery.refetch()} className="shrink-0 rounded-lg bg-rose-600 px-2.5 py-1 text-white hover:bg-rose-500">Retry</button>
          )}
        </div>
      )}

      {!isLoading && docs.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="flex items-center gap-1 text-[12px] font-mono font-black uppercase tracking-[0.15em] text-content-faint mr-1">
            <Filter className="w-3.5 h-3.5" />
            Filters
          </span>
          {['all', ...agentFilters.map(f => f.id)].map(fid => {
            const isSelected = selectedFilterId === fid;
            const label = fid === 'all' ? 'All' : agentFilters.find(f => f.id === fid)?.name || fid;
            return (
              <button
                key={fid}
                type="button"
                onClick={() => setSelectedFilterId(fid)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black transition-all ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'bg-surface-2 border border-line text-content-muted hover:text-content hover:border-line-strong'
                }`}
              >
                {label}
                <span
                  className={`text-[12px] font-mono font-bold px-1.5 rounded-md ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-surface-3 text-content-faint'
                  }`}
                >
                  {countForFilter(fid)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-content-faint">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : visibleDocs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-line rounded-2xl bg-surface/50">
          <FileCode2 className="w-10 h-10 text-slate-700 mb-3" />
          {docs.length === 0 ? (
            <>
              <p className="text-sm font-black text-content-faint">No skills yet</p>
              <p className="text-xs text-slate-600 mt-1">Create one here or link an existing skill to this project.</p>
              <div className="mt-4 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowLinkModal(true)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-surface-2 border border-line hover:border-indigo-700 text-content-muted hover:text-content text-xs font-black transition-all"
                >
                  <Link2 className="w-3.5 h-3.5" />
                  <span>Link Existing Skill</span>
                </button>
                <button
                  type="button"
                  onClick={openNewDoc}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Skill</span>
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-black text-content-faint">No skills match this filter</p>
              <p className="text-xs text-slate-600 mt-1">Try a different filter or categorize a skill in the editor.</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleDocs.map(doc => {
            const sharedCount = doc.projectIds.filter(id => id !== projectId).length;
            return (
              <div
                key={doc.id}
                className="group w-full text-left p-4 rounded-2xl bg-surface border border-line shadow-md hover:border-indigo-800/60 transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => openDoc(doc)}
                    aria-label={`Open skill ${doc.title}`}
                    className="flex items-start gap-3 flex-1 min-w-0 text-left rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                  >
                    <div className="mt-0.5 p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 shrink-0">
                      <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-black text-content group-hover:text-indigo-600 transition-colors truncate">
                          {doc.title}
                        </span>
                        <span className="text-[12px] font-mono font-bold text-content-faint">
                          .md · {formatDate(doc.updatedAt)}
                        </span>
                        {doc.filterName && (
                          <span className="text-[12px] font-black text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                            {doc.filterName}
                          </span>
                        )}
                        {sharedCount > 0 && (
                          <span
                            className="text-[12px] font-mono font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md"
                            title={`Also linked to ${sharedCount} other project${sharedCount > 1 ? 's' : ''}`}
                          >
                            shared · +{sharedCount}
                          </span>
                        )}
                      </div>
                      {doc.content && (
                        <p className="text-xs text-content-faint mt-1 line-clamp-2 whitespace-pre-line">
                          {doc.content.replace(/[#*`>\-\[\]]/g, '').slice(0, 180)}
                        </p>
                      )}
                      </div>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      aria-pressed={doc.active !== false}
                      onClick={() => handleToggleActive(doc)}
                      className={`p-2 rounded-lg transition-all shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${doc.active === false ? 'text-slate-600 hover:text-emerald-400' : 'text-emerald-600 dark:text-emerald-400 hover:text-amber-300'}`}
                      title={doc.active === false ? 'Activate skill for this project' : 'Deactivate skill for this project'}
                      aria-label={`${doc.active === false ? 'Activate' : 'Deactivate'} skill ${doc.title}`}
                    >
                      <Power className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleAddToPrompt(doc)}
                      className={`p-2 rounded-lg transition-all shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${addedId === doc.id ? 'text-emerald-600 dark:text-emerald-400' : 'text-content-faint hover:text-indigo-400 hover:bg-indigo-500/10'}`}
                      title="Add this skill snapshot to the saved project prompt"
                      aria-label={`Add ${doc.title} to project prompt`}
                    >
                      {addingId === doc.id ? <span className="block w-4 h-4 text-center text-[11px]">…</span> : addedId === doc.id ? <Check className="w-4 h-4" /> : <ClipboardPlus className="w-4 h-4" />}
                    </button>

                  <button
                    type="button"
                    onClick={() => handleCopy(doc)}
                    className="p-2 rounded-lg text-content-faint hover:text-indigo-400 hover:bg-indigo-500/10 transition-all shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                    title="Copy full skill content"
                    aria-label={`Copy skill ${doc.title}`}
                  >
                    {copiedId === doc.id ? (
                      <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void (async () => {
                      const ok = await confirm({
                        title: `Remove skill "${doc.title}" from this project?`,
                        description: 'It will remain available in other linked projects.',
                        confirmLabel: 'Remove',
                        danger: true,
                      });
                      if (!ok) return;
                      api.delete(`/projects/${projectId}/agents/${doc.id}/`)
                        .then(() => handleDeleted(doc.id))
                        .catch(e2 => {
                          console.error('Failed to unlink doc', e2);
                          setError('Failed to remove skill from this project.');
                        });
                    })()}
                    className="p-2 rounded-lg text-content-faint hover:text-rose-400 focus-visible:opacity-100 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
                    title="Remove skill from this project"
                    aria-label={`Remove skill ${doc.title} from this project`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                    </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showLinkModal && (
        <LinkDocModal
          projectId={projectId}
          linkedIds={docs.map(d => d.id)}
          onClose={() => setShowLinkModal(false)}
          onLinked={handleLinked}
        />
      )}
    </div>
  );
};

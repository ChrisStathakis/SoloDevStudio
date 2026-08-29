import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, unwrapPaginated } from '../services/api';
import { mapProjectDocFromApi } from '../services/mappers';
import type { ProjectDoc } from '../types';
import {
  X,
  Search,
  FileText,
  Link2,
  Loader2,
  CheckCircle2
} from 'lucide-react';

interface LinkDocModalProps {
  projectId: string;
  linkedIds: string[];
  onClose: () => void;
  onLinked: (doc: ProjectDoc) => void;
}

export const LinkDocModal: React.FC<LinkDocModalProps> = ({ projectId, linkedIds, onClose, onLinked }) => {
  const [allDocs, setAllDocs] = useState<ProjectDoc[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkedNow, setLinkedNow] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await api.get('/docs/', { params: { page_size: 100 } });
        if (!cancelled) setAllDocs(unwrapPaginated<any>(res.data).map(mapProjectDocFromApi));
      } catch (e) {
        console.error('Failed to load docs', e);
        if (!cancelled) setError('Failed to load skills.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allDocs
      .filter(d => !linkedIds.includes(d.id) && !linkedNow.includes(d.id))
      .filter(d =>
        !q ||
        d.title.toLowerCase().includes(q) ||
        d.content.toLowerCase().includes(q)
      );
  }, [allDocs, linkedIds, linkedNow, query]);

  const handleLink = useCallback(async (doc: ProjectDoc) => {
    if (linkingId) return;
    setLinkingId(doc.id);
    setError(null);
    try {
      const res = await api.patch(`/docs/${doc.id}/`, {
        projects: [...doc.projectIds, projectId]
      });
      const updated = mapProjectDocFromApi(res.data);
      onLinked(updated);
      setLinkedNow(prev => [...prev, doc.id]);
    } catch (e) {
        console.error('Failed to link doc', e);
      setError('Failed to link skill.');
    } finally {
      setLinkingId(null);
    }
  }, [linkingId, projectId, onLinked]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[80vh] flex flex-col rounded-3xl bg-surface border border-line shadow-2xl animate-in zoom-in-95"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 pb-4 border-b border-line">
          <div>
            <h3 className="text-sm font-black text-content tracking-tight">Link Existing Skill</h3>
            <p className="text-[13px] text-content-faint mt-0.5">Attach any of your skills to this project.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-content-faint hover:text-white hover:bg-surface-3 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-content-faint" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search skills by name or content..."
              autoFocus
              className="w-full pl-9 pr-3 py-2.5 bg-surface-2 border border-line focus:border-indigo-500 rounded-xl text-xs font-bold text-content placeholder:text-slate-600 outline-none transition-colors"
            />
          </div>
        </div>

        {error && (
          <div className="mx-5 mb-3 px-3 py-2 rounded-xl bg-rose-950/30 border border-rose-900/50 text-xs font-bold text-rose-300">
            {error}
          </div>
        )}

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-5 space-y-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-content-faint">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FileText className="w-8 h-8 text-slate-700 mb-2" />
              <p className="text-xs font-bold text-content-faint">
                {allDocs.length === 0
                  ? 'No skills yet — create one first.'
                  : linkedNow.length > 0
                    ? 'Done! All matching skills are now linked.'
                    : 'Every skill is already linked to this project.'}
              </p>
            </div>
          ) : (
            candidates.map(doc => {
              const isLinking = linkingId === doc.id;
              const justLinked = linkedNow.includes(doc.id);
              return (
                <button
                  key={doc.id}
                  type="button"
                  disabled={isLinking || justLinked || Boolean(linkingId)}
                  onClick={() => handleLink(doc)}
                  className={`group w-full text-left p-3.5 rounded-2xl border transition-all ${
                    justLinked
                      ? 'bg-emerald-500/5 border-emerald-900/50 opacity-70'
                      : 'bg-surface-2 border-line hover:border-indigo-700 disabled:opacity-40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="mt-0.5 p-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 shrink-0">
                        <FileText className="w-3.5 h-3.5 text-indigo-400" />
                      </div>
                      <div className="min-w-0">
                        <span className="block text-xs font-black text-content truncate">{doc.title}</span>
                        {doc.content && (
                          <span className="block text-[13px] text-content-faint mt-0.5 line-clamp-1">
                            {doc.content.replace(/[#*`>\-\[\]]/g, '').slice(0, 90)}
                          </span>
                        )}
                      </div>
                    </div>

                    <span className="shrink-0">
                      {justLinked ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      ) : isLinking ? (
                        <Loader2 className="w-4 h-4 text-indigo-400 animate-spin" />
                      ) : (
                        <Link2 className="w-4 h-4 text-content-faint group-hover:text-indigo-400 transition-colors" />
                      )}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

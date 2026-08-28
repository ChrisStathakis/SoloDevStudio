import React, { useMemo, useState } from 'react';
import { api } from '../services/api';
import { mapProjectDocFromApi } from '../services/mappers';
import type { Project, ProjectDoc } from '../types';
import { useAgentFilters } from '../hooks/useAgentFilters';
import { marked } from 'marked';
import {
  FileText,
  Trash2,
  ArrowLeft,
  Eye,
  Edit3,
  Save,
  Loader2,
  Link2,
  Filter,
  Copy,
  Check
} from 'lucide-react';

marked.setOptions({ gfm: true, breaks: true });

interface DocEditorProps {
  allProjects: Project[];
  initialDoc?: ProjectDoc | null;
  preselectedProjectIds?: string[];
  onSaved: (doc: ProjectDoc) => void;
  onDeleted?: (id: string) => void;
  onBack: () => void;
}

export const DocEditor: React.FC<DocEditorProps> = ({
  allProjects,
  initialDoc = null,
  preselectedProjectIds = [],
  onSaved,
  onDeleted,
  onBack
}) => {
  const isNew = !initialDoc;
  const [draftTitle, setDraftTitle] = useState<string>(initialDoc?.title || '');
  const [draftContent, setDraftContent] = useState<string>(initialDoc?.content || '');
  const [draftFilterId, setDraftFilterId] = useState<string | null>(initialDoc?.filterId || null);
  const [draftProjectIds, setDraftProjectIds] = useState<string[]>(
    initialDoc ? initialDoc.projectIds : preselectedProjectIds
  );
  const { filters: agentFilters } = useAgentFilters();
  const [editorMode, setEditorMode] = useState<'edit' | 'preview'>(isNew ? 'edit' : 'preview');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const copyTimeout = React.useRef<number | null>(null);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draftContent || '');
      setCopied(true);
      if (copyTimeout.current) window.clearTimeout(copyTimeout.current);
      copyTimeout.current = window.setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error('Failed to copy doc content', e);
    }
  };

  const toggleDraftProject = (pid: string) => {
    setDraftProjectIds(prev => (prev.includes(pid) ? prev.filter(x => x !== pid) : [...prev, pid]));
  };

  const handleSave = async () => {
    if (!draftTitle.trim()) return;
    setIsSaving(true);
    setError(null);
    try {
      if (isNew) {
        const res = await api.post('/docs/', {
          projects: draftProjectIds,
          filter: draftFilterId,
          title: draftTitle.trim(),
          content: draftContent
        });
        onSaved(mapProjectDocFromApi(res.data));
      } else {
        const res = await api.patch(`/docs/${initialDoc.id}/`, {
          projects: draftProjectIds,
          filter: draftFilterId,
          title: draftTitle.trim(),
          content: draftContent
        });
        onSaved(mapProjectDocFromApi(res.data));
      }
      setEditorMode('preview');
    } catch (e) {
      console.error('Failed to save doc', e);
      setError('Failed to save agent.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!initialDoc) return;
    if (!window.confirm(`Delete agent "${initialDoc.title}"? It will be removed from all linked projects.`)) return;
    try {
      await api.delete(`/docs/${initialDoc.id}/`);
      onDeleted?.(initialDoc.id);
    } catch (e) {
      console.error('Failed to delete doc', e);
      setError('Failed to delete agent.');
    }
  };

  const renderedHtml = useMemo(
    () => (editorMode === 'preview' ? String(marked.parse(draftContent || '')) : ''),
    [editorMode, draftContent]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-2 border border-line text-content-muted hover:text-white hover:border-line-strong text-xs font-black transition-all"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back</span>
        </button>

        <div className="flex items-center gap-2">
          {/* Edit / Preview toggle */}
          <div className="flex items-center rounded-xl bg-surface-2 border border-line p-0.5">
            <button
              type="button"
              onClick={() => setEditorMode('edit')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-black transition-all ${
                editorMode === 'edit' ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white'
              }`}
            >
              <Edit3 className="w-3 h-3" />
              Edit
            </button>
            <button
              type="button"
              onClick={() => setEditorMode('preview')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] font-black transition-all ${
                editorMode === 'preview' ? 'bg-indigo-600 text-white' : 'text-content-faint hover:text-white'
              }`}
            >
              <Eye className="w-3 h-3" />
              Preview
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            disabled={!draftContent.trim()}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-black transition-all disabled:opacity-40 ${
              copied
                ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                : 'bg-surface-2 border-line text-content-muted hover:text-white hover:border-line-strong'
            }`}
            title="Copy full agent content"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || !draftTitle.trim()}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white text-xs font-black shadow-sm transition-all"
          >
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>{isNew ? 'Create Agent' : 'Save'}</span>
          </button>

          {!isNew && (
            <button
              type="button"
              onClick={handleDelete}
              className="p-2 rounded-xl bg-surface-2 border border-line text-rose-400 hover:text-rose-300 hover:border-rose-900/60 transition-all"
              title="Delete agent from all projects"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4 py-2.5 rounded-xl bg-rose-950/30 border border-rose-900/50 text-xs font-bold text-rose-300">
          {error}
        </div>
      )}

      <input
        type="text"
        value={draftTitle}
        onChange={e => setDraftTitle(e.target.value)}
        placeholder="Agent name..."
        className="w-full px-4 py-3 bg-surface-2 border border-line focus:border-indigo-500 rounded-2xl text-sm font-black text-content placeholder:text-slate-600 outline-none transition-colors"
      />

      {/* Filter category selector */}
      <div className="p-4 rounded-2xl bg-surface border border-line space-y-2.5">
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-[12px] font-black uppercase tracking-[0.15em] text-content-faint font-mono">
            Filter
          </span>
        </div>
        <p className="text-[13px] text-slate-600 -mt-1">
          Categorize this agent so it can be filtered in agent lists.
        </p>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setDraftFilterId(null)}
            className={`px-2.5 py-1 rounded-lg text-[13px] font-bold border transition-all ${
              draftFilterId === null
                ? 'bg-indigo-500/15 border-indigo-500/50 text-indigo-300'
                : 'bg-surface-2 border-line text-content-faint hover:border-line-strong hover:text-white'
            }`}
          >
            None
          </button>
          {agentFilters.map(f => {
            const active = draftFilterId === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setDraftFilterId(active ? null : f.id)}
                className={`px-2.5 py-1 rounded-lg text-[13px] font-bold border transition-all ${
                  active
                    ? 'bg-indigo-500/15 border-indigo-500/50 text-indigo-300'
                    : 'bg-surface-2 border-line text-content-faint hover:border-line-strong hover:text-white'
                }`}
              >
                {f.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Linked Projects multi-select */}
      <div className="p-4 rounded-2xl bg-surface border border-line space-y-2.5">
        <div className="flex items-center gap-1.5">
          <Link2 className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-[12px] font-black uppercase tracking-[0.15em] text-content-faint font-mono">
            Linked Projects ({draftProjectIds.length})
          </span>
        </div>
        <p className="text-[13px] text-slate-600 -mt-1">
          This agent appears in the Agents tab of every selected project — no need to recreate it.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {allProjects.length === 0 && (
            <span className="text-xs text-slate-600">No projects available.</span>
          )}
          {allProjects.map(p => {
            const active = draftProjectIds.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => toggleDraftProject(p.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[13px] font-bold border transition-all ${
                  active
                    ? 'bg-indigo-500/15 border-indigo-500/50 text-indigo-300'
                    : 'bg-surface-2 border-line text-content-faint hover:border-line-strong hover:text-white'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: p.color || '#6366f1' }}
                />
                {p.title}
              </button>
            );
          })}
        </div>
      </div>

      {editorMode === 'edit' ? (
        <textarea
          value={draftContent}
          onChange={e => setDraftContent(e.target.value)}
          placeholder={'# Heading\n\nWrite your markdown here...'}
          spellCheck={false}
          className="w-full min-h-[380px] p-4 bg-surface-2 border border-line focus:border-indigo-500 rounded-2xl text-sm font-mono text-content placeholder:text-slate-600 outline-none resize-y transition-colors leading-relaxed"
        />
      ) : (
        <div className="min-h-[380px] p-5 bg-surface-2 border border-line rounded-2xl overflow-auto">
          {draftContent.trim() ? (
            <div className="md-preview" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <FileText className="w-8 h-8 text-slate-700 mb-3" />
              <p className="text-xs font-bold text-slate-600">Nothing to preview yet — switch to Edit and write some markdown.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

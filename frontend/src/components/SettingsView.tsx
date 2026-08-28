import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, unwrapPaginated } from '../services/api';
import { mapProjectDocFromApi } from '../services/mappers';
import type { ProjectDoc } from '../types';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useAgentFilters } from '../hooks/useAgentFilters';
import {
  FileText,
  Plus,
  Search,
  Trash2,
  Loader2,
  FileCode2,
  Link2,
  Filter,
  Download,
  Upload,
  RotateCcw,
  LogOut,
  FileCog,
  ListFilter,
  DatabaseBackup,
  UserRound
} from 'lucide-react';
import { PageHeader } from './ui';
import { DocEditor } from './DocEditor';
import { FilterManager } from './FilterManager';

type SettingsSection = 'documents' | 'filters' | 'data' | 'account';

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
};

export const SettingsView: React.FC = () => {
  const { projects, exportData, importData, resetDefaults, setCurrentView } = useApp();
  const { user, logout } = useAuth();

  const [section, setSection] = useState<SettingsSection>('documents');

  // Docs state
  const [docs, setDocs] = useState<ProjectDoc[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState<boolean>(true);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const [selectedFilterId, setSelectedFilterId] = useState<string>('all');
  const { filters: agentFilters } = useAgentFilters();

  // Data & backup state
  const [backupStatus, setBackupStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);

  const loadDocs = useCallback(async () => {
    setIsLoadingDocs(true);
    setDocsError(null);
    try {
      const res = await api.get('/docs/', { params: { page_size: 100 } });
      setDocs(unwrapPaginated<any>(res.data).map(mapProjectDocFromApi));
    } catch (e) {
      console.error('Failed to load docs', e);
      setDocsError('Failed to load agents.');
    } finally {
      setIsLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    if (section === 'documents') loadDocs();
  }, [section, loadDocs]);

  const projectMap = useMemo(() => {
    const m = new Map<string, { title: string; color: string }>();
    projects.forEach(p => m.set(p.id, { title: p.title, color: p.color || '#6366f1' }));
    return m;
  }, [projects]);

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter(d => {
      if (selectedFilterId !== 'all' && d.filterId !== selectedFilterId) return false;
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.content.toLowerCase().includes(q)
      );
    });
  }, [docs, query, selectedFilterId]);

  const handleSaved = (doc: ProjectDoc) => {
    setDocs(prev => prev.map(d => (d.id === doc.id ? doc : d)));
    void loadDocs();
    if (openDocId === 'new') setOpenDocId(null);
  };

  const handleDeleted = (id: string) => {
    setDocs(prev => prev.filter(d => d.id !== id));
    setOpenDocId(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (!content) return;
      setIsBusy(true);
      const res = await importData(content);
      setBackupStatus({ ok: res.success, msg: res.message });
      setIsBusy(false);
      setTimeout(() => setBackupStatus(null), 4000);
    };
    reader.readAsText(file);
  };

  // ---------- DOC EDITOR ----------
  if (openDocId) {
    const editing = openDocId === 'new' ? null : docs.find(d => d.id === openDocId) || null;
    return (
      <div className="space-y-6 pb-12 animate-in fade-in">
        <div>
          <span className="text-[12px] font-black uppercase tracking-[0.2em] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md">
            SETTINGS · AGENTS
          </span>
          <h1 className="text-3xl font-black text-content tracking-tight mt-1">
            {openDocId === 'new' ? 'New Agent' : 'Edit Agent'}
          </h1>
        </div>
        <DocEditor
          allProjects={projects}
          initialDoc={editing}
          preselectedProjectIds={[]}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
          onBack={() => setOpenDocId(null)}
        />
      </div>
    );
  }

  const sections: { id: SettingsSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'documents', label: 'Agents', icon: FileCog },
    { id: 'filters', label: 'Filters', icon: ListFilter },
    { id: 'data', label: 'Data & Backup', icon: DatabaseBackup },
    { id: 'account', label: 'Account', icon: UserRound }
  ];

  return (
    <div className="space-y-6 pb-12 animate-in fade-in">
      <PageHeader eyebrow="Workspace" title="Settings" description="Manage your agents, backups, and account." />

      {/* Section tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {sections.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              section === id
                ? 'bg-slate-900 dark:bg-white/10 text-white shadow-sm border border-slate-900 dark:border-white/15'
                : 'text-content-faint hover:text-white hover:bg-surface-3 border border-transparent'
            }`}
          >
            <Icon className={`w-4 h-4 ${section === id ? 'text-indigo-400' : 'text-content-faint'}`} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* SECTION: DOCUMENTS */}
      {section === 'documents' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-content-faint" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search agents by name or content..."
                className="w-full pl-9 pr-3 py-2 bg-surface-2 border border-line focus:border-indigo-500 rounded-xl text-xs font-bold text-content placeholder:text-slate-600 outline-none transition-colors"
              />
            </div>
            <button
              type="button"
              onClick={() => setOpenDocId('new')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-lg shadow-indigo-600/20 transition-all shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>New Agent</span>
            </button>
          </div>

          {docsError && (
            <div className="px-4 py-2.5 rounded-xl bg-rose-950/30 border border-rose-900/50 text-xs font-bold text-rose-300">
              {docsError}
            </div>
          )}

          {!isLoadingDocs && docs.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 text-[12px] font-mono font-black uppercase tracking-[0.15em] text-content-faint mr-1">
                <Filter className="w-3.5 h-3.5" />
                Filters
              </span>
              {['all', ...agentFilters.map(f => f.id)].map(fid => {
                const isSelected = selectedFilterId === fid;
                const label = fid === 'all' ? 'All' : agentFilters.find(f => f.id === fid)?.name || fid;
                const count = fid === 'all' ? docs.length : docs.filter(d => d.filterId === fid).length;
                return (
                  <button
                    key={fid}
                    type="button"
                    onClick={() => setSelectedFilterId(fid)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-black transition-all ${
                      isSelected
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-surface-2 border border-line text-content-muted hover:text-white hover:border-line-strong'
                    }`}
                  >
                    {label}
                    <span
                      className={`text-[12px] font-mono font-bold px-1.5 rounded-md ${
                        isSelected ? 'bg-white/20 text-white' : 'bg-surface-3 text-content-faint'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {isLoadingDocs ? (
            <div className="flex items-center justify-center py-16 text-content-faint">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : filteredDocs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed border-line rounded-2xl bg-surface/50">
              <FileCode2 className="w-10 h-10 text-slate-700 mb-3" />
              <p className="text-sm font-black text-content-faint">
                {query ? 'No matching agents' : (docs.length > 0 ? 'No agents match this filter' : 'No agents yet')}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                {query ? 'Try a different search.' : (docs.length > 0 ? 'Try a different filter.' : 'Create your first agent — link it to any number of projects.')}
              </p>
              {!query && (
                <button
                  type="button"
                  onClick={() => setOpenDocId('new')}
                  className="mt-4 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Agent</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filteredDocs.map(doc => {
                const isOrphan = doc.projectIds.length === 0;
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setOpenDocId(doc.id)}
                    className="group w-full text-left p-4 rounded-2xl bg-surface border border-line shadow-md hover:border-indigo-800/60 transition-all"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="mt-0.5 p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 shrink-0">
                          <FileText className="w-4 h-4 text-indigo-400" />
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
                              <span className="text-[12px] font-black text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                                {doc.filterName}
                              </span>
                            )}
                            {isOrphan && (
                              <span
                                className="text-[12px] font-mono font-bold text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-md"
                                title="Not linked to any project — visible only here. Edit the agent and pick projects to link it."
                              >
                                unlinked
                              </span>
                            )}
                          </div>

                          {/* Linked project chips */}
                          <div className="flex flex-wrap items-center gap-1 mt-2">
                            {doc.projectIds.length === 0 ? (
                              <span className="text-[12px] text-slate-600 font-mono">no linked projects</span>
                            ) : (
                              <>
                                {doc.projectIds.slice(0, 3).map(pid => {
                                  const p = projectMap.get(pid);
                                  return (
                                    <span
                                      key={pid}
                                      className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-2 border border-line text-[12px] font-bold text-content-faint"
                                    >
                                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: p?.color || '#475569' }} />
                                      {p?.title || 'Unknown'}
                                    </span>
                                  );
                                })}
                                {doc.projectIds.length > 3 && (
                                  <span className="text-[12px] font-mono font-bold text-indigo-300">+{doc.projectIds.length - 3}</span>
                                )}
                              </>
                            )}
                          </div>

                          {doc.content && (
                            <p className="text-xs text-content-faint mt-1.5 line-clamp-2 whitespace-pre-line">
                              {doc.content.replace(/[#*`>\-\[\]]/g, '').slice(0, 140)}
                            </p>
                          )}
                        </div>
                      </div>

                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Delete ${doc.title}`}
                        onClick={e => {
                          e.stopPropagation();
                          if (!window.confirm(`Delete agent "${doc.title}"? It will be removed from all linked projects.`)) return;
                          api.delete(`/docs/${doc.id}/`)
                            .then(() => handleDeleted(doc.id))
                            .catch(e2 => {
                              console.error('Failed to delete doc', e2);
                              setDocsError('Failed to delete agent.');
                            });
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
                        }}
                        className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer shrink-0"
                        title="Delete agent from all projects"
                      >
                        <Trash2 className="w-4 h-4" />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SECTION: FILTERS */}
      {section === 'filters' && <FilterManager />}

      {/* SECTION: DATA & BACKUP */}
      {section === 'data' && (
        <div className="max-w-2xl space-y-3">
          {backupStatus && (
            <div
              className={`px-4 py-2.5 rounded-xl border text-xs font-bold ${
                backupStatus.ok
                  ? 'bg-emerald-950/30 border-emerald-900/50 text-emerald-300'
                  : 'bg-rose-950/30 border-rose-900/50 text-rose-300'
              }`}
            >
              {backupStatus.msg}
            </div>
          )}

          <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
            <div>
              <h3 className="text-sm font-black text-content">Workspace Backup</h3>
              <p className="text-xs text-content-faint mt-0.5">
                Export or restore all your data — projects, tasks, ideas, time entries and agents.
              </p>
            </div>

            <button
              type="button"
              disabled={isBusy}
              onClick={async () => {
                setIsBusy(true);
                try {
                  await exportData();
                  setBackupStatus({ ok: true, msg: 'Backup downloaded.' });
                  setTimeout(() => setBackupStatus(null), 3000);
                } catch {
                  setBackupStatus({ ok: false, msg: 'Export failed.' });
                } finally {
                  setIsBusy(false);
                }
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-2 border border-line hover:border-indigo-700 text-left transition-all disabled:opacity-40"
            >
              <Download className="w-4 h-4 text-indigo-400 shrink-0" />
              <div>
                <div className="text-xs font-black text-content">Export JSON Backup</div>
                <div className="text-[13px] text-content-faint">Downloads a full snapshot of your workspace.</div>
              </div>
            </button>

            <label className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-2 border border-line hover:border-emerald-700 cursor-pointer text-left transition-all">
              <Upload className="w-4 h-4 text-emerald-400 shrink-0" />
              <div>
                <div className="text-xs font-black text-content">Restore JSON Backup</div>
                <div className="text-[13px] text-content-faint">Imports a backup file into this workspace.</div>
              </div>
              <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          <div className="p-5 rounded-2xl bg-surface border border-rose-950/60 space-y-4">
            <div>
              <h3 className="text-sm font-black text-rose-300">Danger Zone</h3>
              <p className="text-xs text-content-faint mt-0.5">
                Deletes all server-side workspace data. This cannot be undone.
              </p>
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={async () => {
                if (!window.confirm('Reset workspace? This deletes all your projects/tasks/ideas/time entries/agents on the server.')) return;
                setIsBusy(true);
                try {
                  await resetDefaults();
                  setBackupStatus({ ok: true, msg: 'Workspace cleared.' });
                  setCurrentView('dashboard');
                } catch {
                  setBackupStatus({ ok: false, msg: 'Reset failed.' });
                } finally {
                  setIsBusy(false);
                  setTimeout(() => setBackupStatus(null), 4000);
                }
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-rose-950/20 border border-rose-900/50 hover:border-rose-700 text-left transition-all disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4 text-rose-400 shrink-0" />
              <div>
                <div className="text-xs font-black text-rose-200">Reset / Clear Server Data</div>
                <div className="text-[13px] text-content-faint">Removes everything and starts fresh.</div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* SECTION: ACCOUNT */}
      {section === 'account' && (
        <div className="max-w-2xl space-y-3">
          <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
            <div>
              <h3 className="text-sm font-black text-content">Signed In As</h3>
              <p className="text-xs text-content-faint mt-0.5 font-mono">
                {user?.username} • {user?.email}
              </p>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-2 border border-line hover:border-rose-800 text-left transition-all"
            >
              <LogOut className="w-4 h-4 text-content-faint shrink-0" />
              <div>
                <div className="text-xs font-black text-content">Logout</div>
                <div className="text-[13px] text-content-faint">End this session on this device.</div>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

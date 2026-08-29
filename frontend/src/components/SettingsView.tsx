import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, unwrapPaginated } from '../services/api';
import { mapLauncherModelPresetFromApi, mapProjectDocFromApi } from '../services/mappers';
import type { LauncherModelPreset, ProjectDoc } from '../types';
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
  UserRound,
  Cpu,
  Check,
  FolderOpen
} from 'lucide-react';
import { PageHeader } from './ui';
import { DocEditor } from './DocEditor';
import { FilterManager } from './FilterManager';
import { PathPickerModal } from './PathPickerModal';

type SettingsSection = 'documents' | 'filters' | 'models' | 'project-folder' | 'data' | 'account';

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
  const [modelPresets, setModelPresets] = useState<LauncherModelPreset[]>([]);
  const [modelPresetError, setModelPresetError] = useState<string | null>(null);
  const [newModelTool, setNewModelTool] = useState<'opencode' | 'codex'>('opencode');
  const [newModelId, setNewModelId] = useState('');
  const [newModelLabel, setNewModelLabel] = useState('');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState('');
  const [editingModelLabel, setEditingModelLabel] = useState('');
  const [projectFolderDraft, setProjectFolderDraft] = useState('');
  const [projectFolderEffective, setProjectFolderEffective] = useState('');
  const [projectFolderDefault, setProjectFolderDefault] = useState('');
  const [projectFolderIsCustom, setProjectFolderIsCustom] = useState(false);
  const [projectFolderError, setProjectFolderError] = useState<string | null>(null);
  const [projectFolderBusy, setProjectFolderBusy] = useState(false);
  const [showProjectFolderPicker, setShowProjectFolderPicker] = useState(false);

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
      setDocsError('Failed to load skills.');
    } finally {
      setIsLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    if (section === 'documents') loadDocs();
  }, [section, loadDocs]);

  const loadModelPresets = useCallback(async () => {
    try {
      const res = await api.get('/launcher-model-presets/', { params: { page_size: 100 } });
      const rows = Array.isArray(res.data) ? res.data : (res.data?.results || []);
      setModelPresets(rows.map(mapLauncherModelPresetFromApi));
      setModelPresetError(null);
    } catch {
      setModelPresetError('Unable to load model presets.');
    }
  }, []);

  useEffect(() => {
    if (section === 'models') loadModelPresets();
  }, [section, loadModelPresets]);

  const loadProjectFolder = useCallback(async () => {
    try {
      const res = await api.get('/settings/project-folder/');
      setProjectFolderDraft(res.data?.path || '');
      setProjectFolderEffective(res.data?.effective_path || '');
      setProjectFolderDefault(res.data?.default_path || '');
      setProjectFolderIsCustom(Boolean(res.data?.is_custom));
      setProjectFolderError(null);
    } catch {
      setProjectFolderError('Unable to load project folder setting.');
    }
  }, []);

  useEffect(() => {
    if (section === 'project-folder') loadProjectFolder();
  }, [section, loadProjectFolder]);

  const saveProjectFolder = async () => {
    if (!projectFolderDraft.trim()) return;
    setProjectFolderBusy(true);
    try {
      const res = await api.patch('/settings/project-folder/', { path: projectFolderDraft.trim() });
      setProjectFolderDraft(res.data?.path || '');
      setProjectFolderEffective(res.data?.effective_path || '');
      setProjectFolderDefault(res.data?.default_path || '');
      setProjectFolderIsCustom(Boolean(res.data?.is_custom));
      setProjectFolderError(null);
    } catch (error: any) {
      setProjectFolderError(error?.response?.data?.path?.[0] || 'Unable to save project folder.');
    } finally { setProjectFolderBusy(false); }
  };

  const resetProjectFolder = async () => {
    if (!window.confirm('Reset project folder to the app default?')) return;
    setProjectFolderBusy(true);
    try {
      const res = await api.delete('/settings/project-folder/');
      setProjectFolderDraft('');
      setProjectFolderEffective(res.data?.effective_path || '');
      setProjectFolderDefault(res.data?.default_path || '');
      setProjectFolderIsCustom(false);
      setProjectFolderError(null);
    } catch { setProjectFolderError('Unable to reset project folder.'); }
    finally { setProjectFolderBusy(false); }
  };

  const addModelPreset = async () => {
    if (!newModelId.trim()) return;
    try {
      await api.post('/launcher-model-presets/', { tool: newModelTool, model_id: newModelId.trim(), label: newModelLabel.trim(), enabled: true });
      setNewModelId('');
      setNewModelLabel('');
      await loadModelPresets();
    } catch (error: any) {
      setModelPresetError(error?.response?.data?.model_id?.[0] || 'Unable to save model preset.');
    }
  };

  const updateModelPreset = async (preset: LauncherModelPreset, updates: Partial<LauncherModelPreset>) => {
    try {
      await api.patch(`/launcher-model-presets/${preset.id}/`, {
        tool: updates.tool ?? preset.tool,
        model_id: updates.modelId ?? preset.modelId,
        label: updates.label ?? preset.label,
        enabled: updates.enabled ?? preset.enabled,
      });
      await loadModelPresets();
    } catch {
      setModelPresetError('Unable to update model preset.');
    }
  };

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
            SETTINGS · SKILLS
          </span>
          <h1 className="text-3xl font-black text-content tracking-tight mt-1">
            {openDocId === 'new' ? 'New Skill' : 'Edit Skill'}
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
    { id: 'documents', label: 'Skills', icon: FileCog },
    { id: 'filters', label: 'Filters', icon: ListFilter },
    { id: 'models', label: 'Models', icon: Cpu },
    { id: 'project-folder', label: 'Project folder', icon: FolderOpen },
    { id: 'data', label: 'Data & Backup', icon: DatabaseBackup },
    { id: 'account', label: 'Account', icon: UserRound }
  ];

  return (
    <div className="space-y-6 pb-12 animate-in fade-in">
      <PageHeader eyebrow="Workspace" title="Settings" description="Manage your skills, backups, and account." />

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
                placeholder="Search skills by name or content..."
                className="w-full pl-9 pr-3 py-2 bg-surface-2 border border-line focus:border-indigo-500 rounded-xl text-xs font-bold text-content placeholder:text-slate-600 outline-none transition-colors"
              />
            </div>
            <button
              type="button"
              onClick={() => setOpenDocId('new')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-lg shadow-indigo-600/20 transition-all shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>New Skill</span>
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
                {query ? 'No matching skills' : (docs.length > 0 ? 'No skills match this filter' : 'No skills yet')}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                {query ? 'Try a different search.' : (docs.length > 0 ? 'Try a different filter.' : 'Create your first skill — link it to any number of projects.')}
              </p>
              {!query && (
                <button
                  type="button"
                  onClick={() => setOpenDocId('new')}
                  className="mt-4 flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Skill</span>
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
                                title="Not linked to any project — visible only here. Edit the skill and pick projects to link it."
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
                          if (!window.confirm(`Delete skill "${doc.title}"? It will be removed from all linked projects.`)) return;
                          api.delete(`/docs/${doc.id}/`)
                            .then(() => handleDeleted(doc.id))
                            .catch(e2 => {
                              console.error('Failed to delete doc', e2);
                              setDocsError('Failed to delete skill.');
                            });
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ' ') e.preventDefault();
                        }}
                        className="p-1.5 rounded-lg text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all cursor-pointer shrink-0"
                        title="Delete skill from all projects"
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

      {section === 'models' && (
        <div className="max-w-3xl space-y-4">
          <div className="p-5 rounded-2xl bg-surface border border-line space-y-3">
            <div>
              <h3 className="text-sm font-black text-content">Model presets</h3>
              <p className="text-xs text-content-faint mt-1">Save the model IDs or names available to your local OpenCode and Codex installations.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[9rem_1fr_1fr_auto] gap-2">
              <select value={newModelTool} onChange={e => setNewModelTool(e.target.value as 'opencode' | 'codex')} className="rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content">
                <option value="opencode">OpenCode</option><option value="codex">Codex</option>
              </select>
              <input value={newModelId} onChange={e => setNewModelId(e.target.value)} placeholder={newModelTool === 'opencode' ? 'provider/model or model name' : 'model ID or name'} className="rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-mono text-content" />
              <input value={newModelLabel} onChange={e => setNewModelLabel(e.target.value)} placeholder="Friendly label (optional)" className="rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs text-content" />
              <button type="button" onClick={addModelPreset} disabled={!newModelId.trim()} className="flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40"><Plus className="w-3.5 h-3.5" />Add</button>
            </div>
            {modelPresetError && <p className="text-xs text-rose-300" role="alert">{modelPresetError}</p>}
          </div>
          <div className="space-y-2">
            {modelPresets.length === 0 ? <div className="rounded-2xl border border-dashed border-line p-8 text-center text-xs text-content-faint">No model presets yet.</div> : modelPresets.map(preset => (
              <div key={preset.id} className="flex items-center gap-3 rounded-2xl bg-surface border border-line px-4 py-3">
                <span className="w-20 text-[11px] font-black uppercase tracking-wider text-indigo-300">{preset.tool}</span>
                {editingPresetId === preset.id ? <div className="flex-1 min-w-0 flex gap-2"><input value={editingModelId} onChange={e => setEditingModelId(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-surface-2 border border-line px-2 py-1 text-xs font-mono text-content" /><input value={editingModelLabel} onChange={e => setEditingModelLabel(e.target.value)} placeholder="Label" className="min-w-0 w-28 rounded-lg bg-surface-2 border border-line px-2 py-1 text-xs text-content" /></div> : <span className="flex-1 min-w-0"><span className="block truncate text-xs font-mono text-content">{preset.modelId}</span>{preset.label && <span className="block truncate text-[11px] text-content-faint">{preset.label}</span>}</span>}
                <button type="button" onClick={() => updateModelPreset(preset, { enabled: !preset.enabled })} className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-black ${preset.enabled ? 'border-emerald-500/30 text-emerald-300' : 'border-line text-content-faint'}`}>{preset.enabled ? 'Enabled' : 'Disabled'}</button>
                {editingPresetId === preset.id ? <button type="button" onClick={async () => { await updateModelPreset(preset, { modelId: editingModelId.trim(), label: editingModelLabel.trim() }); setEditingPresetId(null); }} disabled={!editingModelId.trim()} className="p-1.5 text-emerald-300 disabled:opacity-40" title="Save model preset"><Check className="w-4 h-4" /></button> : <button type="button" onClick={() => { setEditingPresetId(preset.id); setEditingModelId(preset.modelId); setEditingModelLabel(preset.label); }} className="p-1.5 text-content-faint hover:text-white" title="Edit model preset"><FileCog className="w-4 h-4" /></button>}
                <button type="button" onClick={async () => { if (window.confirm(`Delete model preset "${preset.modelId}"?`)) { await api.delete(`/launcher-model-presets/${preset.id}/`); await loadModelPresets(); } }} className="p-1.5 text-content-faint hover:text-rose-400" title="Delete model preset"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {section === 'project-folder' && (
        <div className="max-w-3xl space-y-4">
          <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
            <div>
              <h3 className="text-sm font-black text-content">Project Folder</h3>
              <p className="text-xs text-content-faint mt-1">Choose where new projects created from Sparks will be stored. This affects future conversions only.</p>
            </div>
            <div className="rounded-xl bg-surface-2 border border-line px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider font-black text-content-faint">Current folder</div>
              <div className="mt-1 text-xs font-mono text-content break-all">{projectFolderEffective || 'Loading…'}</div>
              {!projectFolderIsCustom && projectFolderDefault && <div className="mt-1 text-[11px] text-content-faint">Using app default</div>}
            </div>
            <div className="flex gap-2">
              <input value={projectFolderDraft} onChange={e => setProjectFolderDraft(e.target.value)} placeholder={projectFolderDefault || 'D:\\projects\\potential_projects'} className="min-w-0 flex-1 rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-mono text-content" />
              <button type="button" onClick={() => setShowProjectFolderPicker(true)} className="flex items-center gap-1.5 rounded-xl border border-line px-3 py-2 text-xs font-black text-content hover:border-indigo-500"><FolderOpen className="w-4 h-4" />Choose</button>
            </div>
            {projectFolderError && <p className="text-xs text-rose-300" role="alert">{projectFolderError}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={saveProjectFolder} disabled={projectFolderBusy || !projectFolderDraft.trim()} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40">Save folder</button>
              <button type="button" onClick={resetProjectFolder} disabled={projectFolderBusy || !projectFolderIsCustom} className="rounded-xl border border-line px-4 py-2 text-xs font-black text-content-faint hover:text-content disabled:opacity-40">Reset to app default</button>
            </div>
          </div>
          {showProjectFolderPicker && <PathPickerModal mode="folder" initialPath={projectFolderDraft || projectFolderEffective} title="Choose project folder" onClose={() => setShowProjectFolderPicker(false)} onSelect={path => { setProjectFolderDraft(path); setShowProjectFolderPicker(false); }} />}
        </div>
      )}

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
                Export or restore all your data — projects, tasks, ideas, time entries and skills.
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
                if (!window.confirm('Reset workspace? This deletes all your projects/tasks/ideas/time entries/skills on the server.')) return;
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

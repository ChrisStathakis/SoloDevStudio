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
  Monitor,
  FolderOpen,
  Tags,
  HardDrive
} from 'lucide-react';
import { PageHeader } from './ui';
import { DocEditor } from './DocEditor';
import { FilterManager } from './FilterManager';
import { PathPickerModal } from './PathPickerModal';
import { IdeaCategoryManager } from './IdeaCategoryManager';

type SettingsSection = 'documents' | 'filters' | 'idea-categories' | 'models' | 'project-folder' | 'desktop' | 'data' | 'account';
const UNCATEGORIZED_FILTER_ID = 'uncategorized';

const formatDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
};

export const SettingsView: React.FC = () => {
  const { projects, exportData, importData, resetDefaults, setCurrentView, refreshData } = useApp();
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
  const [newModelReasoningEffort, setNewModelReasoningEffort] = useState<'low' | 'medium' | 'high'>('medium');
  const [newModelMode, setNewModelMode] = useState<'build' | 'plan'>('build');
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState('');
  const [editingModelLabel, setEditingModelLabel] = useState('');
  const [editingModelReasoningEffort, setEditingModelReasoningEffort] = useState<'low' | 'medium' | 'high'>('medium');
  const [editingModelMode, setEditingModelMode] = useState<'build' | 'plan'>('build');
  const [presetSearch, setPresetSearch] = useState('');
  const [presetToolFilter, setPresetToolFilter] = useState<'all' | 'opencode' | 'codex'>('all');
  const [projectFolderDraft, setProjectFolderDraft] = useState('');
  const [projectFolderEffective, setProjectFolderEffective] = useState('');
  const [projectFolderDefault, setProjectFolderDefault] = useState('');
  const [projectFolderIsCustom, setProjectFolderIsCustom] = useState(false);
  const [projectFolderError, setProjectFolderError] = useState<string | null>(null);
  const [projectFolderBusy, setProjectFolderBusy] = useState(false);
  const [showProjectFolderPicker, setShowProjectFolderPicker] = useState(false);
  const [globalDrive, setGlobalDrive] = useState('');
  const [globalDriveBusy, setGlobalDriveBusy] = useState(false);
  const [globalDriveStatus, setGlobalDriveStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Windows desktop runtime state
  const isDesktop = Boolean(window.solodevDesktop?.isDesktop);
  const [backendPortDraft, setBackendPortDraft] = useState('');
  const [activeApiBase, setActiveApiBase] = useState('');
  const [desktopPortStatus, setDesktopPortStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [desktopPortBusy, setDesktopPortBusy] = useState(false);

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
      setModelPresetError('Unable to load launch presets.');
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

  useEffect(() => {
    if (section !== 'desktop' || !window.solodevDesktop) return;
    window.solodevDesktop.getSettings().then(settings => {
      setBackendPortDraft(settings.backendPort ? String(settings.backendPort) : '');
      setActiveApiBase(settings.apiBase || '');
      setDesktopPortStatus(null);
    }).catch(() => setDesktopPortStatus({ ok: false, msg: 'Unable to load desktop settings.' }));
  }, [section]);

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

  const applyGlobalDrive = async () => {
    const drive = globalDrive.trim().toUpperCase();
    if (!drive) return;
    if (!window.confirm('Change the drive for all projects? This remaps each project folder, CMD directory, and server script path.')) return;
    setGlobalDriveBusy(true);
    setGlobalDriveStatus(null);
    try {
      const res = await api.patch('/settings/drive/', { drive });
      await refreshData();
      setGlobalDriveStatus({ ok: true, msg: `Updated ${res.data?.updated_count ?? 0} project${res.data?.updated_count === 1 ? '' : 's'} to ${res.data?.drive || drive}:.` });
    } catch (error: any) {
      setGlobalDriveStatus({ ok: false, msg: error?.response?.data?.drive?.[0] || 'Unable to update the drive for all projects.' });
    } finally { setGlobalDriveBusy(false); }
  };

  const saveDesktopPort = async () => {
    if (!window.solodevDesktop) return;
    const raw = backendPortDraft.trim();
    if (raw && (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535)) {
      setDesktopPortStatus({ ok: false, msg: 'Choose a port between 1 and 65535, or leave it blank for automatic selection.' });
      return;
    }
    setDesktopPortBusy(true);
    try {
      await window.solodevDesktop.setBackendPort(raw ? Number(raw) : null);
      setDesktopPortStatus({ ok: true, msg: 'Saved. Restart SoloDev Studio to apply the API port.' });
    } catch (error: any) {
      setDesktopPortStatus({ ok: false, msg: error?.message || 'Unable to save desktop settings.' });
    } finally { setDesktopPortBusy(false); }
  };

  const addModelPreset = async () => {
    if (!newModelLabel.trim() || !newModelId.trim()) {
      setModelPresetError('Preset name and model are required.');
      return;
    }
    try {
      const mode = newModelTool === 'codex' ? newModelMode : 'build';
      await api.post('/launcher-model-presets/', { tool: newModelTool, model_id: newModelId.trim(), reasoning_effort: newModelReasoningEffort, mode, label: newModelLabel.trim(), enabled: true });
      setNewModelId('');
      setNewModelLabel('');
      setModelPresetError(null);
      await loadModelPresets();
    } catch (error: any) {
      const details = error?.response?.data;
      setModelPresetError(details?.label?.[0] || details?.model_id?.[0] || details?.detail || 'Unable to save launch preset.');
    }
  };

  const updateModelPreset = async (preset: LauncherModelPreset, updates: Partial<LauncherModelPreset>) => {
    try {
      await api.patch(`/launcher-model-presets/${preset.id}/`, {
        tool: updates.tool ?? preset.tool,
        model_id: updates.modelId ?? preset.modelId,
        reasoning_effort: updates.reasoningEffort ?? preset.reasoningEffort,
        mode: (updates.mode ?? preset.mode) === 'plan' && (updates.tool ?? preset.tool) !== 'codex' ? 'build' : (updates.mode ?? preset.mode),
        label: updates.label ?? preset.label,
        enabled: updates.enabled ?? preset.enabled,
      });
      await loadModelPresets();
    } catch (error: any) {
      const details = error?.response?.data;
      setModelPresetError(details?.label?.[0] || details?.model_id?.[0] || details?.detail || 'Unable to update launch preset.');
    }
  };

  const filteredModelPresets = useMemo(() => {
    const search = presetSearch.trim().toLowerCase();
    return modelPresets.filter(preset => {
      if (presetToolFilter !== 'all' && preset.tool !== presetToolFilter) return false;
      if (!search) return true;
      return [preset.label, preset.modelId, preset.reasoningEffort, preset.tool].some(value => value.toLowerCase().includes(search));
    });
  }, [modelPresets, presetSearch, presetToolFilter]);

  const projectMap = useMemo(() => {
    const m = new Map<string, { title: string; color: string }>();
    projects.forEach(p => m.set(p.id, { title: p.title, color: p.color || '#6366f1' }));
    return m;
  }, [projects]);

  const filteredDocs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return docs.filter(d => {
      if (selectedFilterId !== 'all') {
        const matchesCategory = selectedFilterId === UNCATEGORIZED_FILTER_ID
          ? !d.filterId
          : d.filterId === selectedFilterId;
        if (!matchesCategory) return false;
      }
      if (!q) return true;
      return (
        d.title.toLowerCase().includes(q) ||
        d.content.toLowerCase().includes(q)
      );
    });
  }, [docs, query, selectedFilterId]);

  const handleSaved = (doc: ProjectDoc) => {
    setDocs(prev => prev.some(d => d.id === doc.id)
      ? prev.map(d => (d.id === doc.id ? doc : d))
      : [doc, ...prev]);
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
          <span className="text-[12px] font-black uppercase tracking-[0.2em] text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md">
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
    { id: 'idea-categories', label: 'Idea categories', icon: Tags },
    { id: 'models', label: 'Launch Presets', icon: Cpu },
    { id: 'project-folder', label: 'Project folder', icon: FolderOpen },
    ...(isDesktop ? [{ id: 'desktop' as SettingsSection, label: 'Desktop app', icon: Monitor }] : []),
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
                : 'text-content-faint hover:text-content hover:bg-surface-3 border border-transparent'
            }`}
          >
            <Icon className={`w-4 h-4 ${section === id ? 'text-indigo-600 dark:text-indigo-400' : 'text-content-faint'}`} />
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
            <div className="px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-xs font-bold text-rose-700 dark:text-rose-300">
              {docsError}
            </div>
          )}

          {!isLoadingDocs && docs.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 text-[12px] font-mono font-black uppercase tracking-[0.15em] text-content-faint mr-1">
                <Filter className="w-3.5 h-3.5" />
                Filters
              </span>
              {['all', ...agentFilters.map(f => f.id), UNCATEGORIZED_FILTER_ID].map(fid => {
                const isSelected = selectedFilterId === fid;
                const label = fid === 'all'
                  ? 'All'
                  : fid === UNCATEGORIZED_FILTER_ID
                    ? 'Uncategorized'
                    : agentFilters.find(f => f.id === fid)?.name || fid;
                const count = fid === 'all'
                  ? docs.length
                  : fid === UNCATEGORIZED_FILTER_ID
                    ? docs.filter(d => !d.filterId).length
                    : docs.filter(d => d.filterId === fid).length;
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
              <FileCode2 className="w-10 h-10 text-content-faint mb-3" />
              <p className="text-sm font-black text-content-faint">
                {query ? 'No matching skills' : (docs.length > 0 ? 'No skills match this filter' : 'No skills yet')}
              </p>
              <p className="text-xs text-content-faint mt-1">
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
                            {doc.filterName ? (
                              <span className="text-[12px] font-black text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                                {doc.filterName}
                              </span>
                            ) : (
                              <span className="text-[12px] font-black text-content-faint bg-surface-2 border border-line px-2 py-0.5 rounded-md">
                                Uncategorized
                              </span>
                            )}
                            {isOrphan && (
                              <span
                                className="text-[12px] font-mono font-bold text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-md"
                                title="Not linked to any project — visible only here. Edit the skill and pick projects to link it."
                              >
                                unlinked
                              </span>
                            )}
                          </div>

                          {/* Linked project chips */}
                          <div className="flex flex-wrap items-center gap-1 mt-2">
                            {doc.projectIds.length === 0 ? (
                              <span className="text-[12px] text-content-faint font-mono">no linked projects</span>
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
                                  <span className="text-[12px] font-mono font-bold text-indigo-700 dark:text-indigo-300">+{doc.projectIds.length - 3}</span>
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

      {section === 'idea-categories' && <IdeaCategoryManager />}

      {/* SECTION: FILTERS */}
      {section === 'filters' && <FilterManager />}

      {section === 'models' && (
        <div className="max-w-3xl space-y-4">
          <div className="p-5 rounded-2xl bg-surface border border-line space-y-3">
            <div>
              <h3 className="text-sm font-black text-content">Launch presets</h3>
              <p className="text-xs text-content-faint mt-1">Save reusable OpenCode and Codex launch configurations with a model and reasoning effort.</p>
            </div>
            <div className="flex flex-wrap items-stretch gap-2">
              <select value={newModelTool} onChange={e => { const next = e.target.value as 'opencode' | 'codex'; setNewModelTool(next); if (next === 'opencode') setNewModelMode('build'); }} className="w-full sm:w-36 rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content">
                <option value="opencode">OpenCode</option><option value="codex">Codex</option>
              </select>
              <input value={newModelId} onChange={e => setNewModelId(e.target.value)} placeholder={newModelTool === 'opencode' ? 'provider/model or model name' : 'model ID or name'} className="min-w-0 w-full sm:flex-1 sm:min-w-[14rem] rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-mono text-content" />
              <select value={newModelReasoningEffort} onChange={e => setNewModelReasoningEffort(e.target.value as 'low' | 'medium' | 'high')} className="w-full sm:w-32 rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
              {newModelTool === 'codex' && <select value={newModelMode} onChange={e => setNewModelMode(e.target.value as 'build' | 'plan')} className="w-full sm:w-28 rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content"><option value="build">Build</option><option value="plan">Plan</option></select>}
              <input value={newModelLabel} onChange={e => setNewModelLabel(e.target.value)} placeholder="Preset name" aria-label="Preset name" className="min-w-0 w-full sm:flex-1 sm:min-w-[10rem] rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs text-content" />
              <button type="button" onClick={addModelPreset} disabled={!newModelId.trim() || !newModelLabel.trim()} className="w-full sm:w-auto flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white disabled:opacity-40"><Plus className="w-3.5 h-3.5" />Add</button>
            </div>
            {modelPresetError && <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">{modelPresetError}</p>}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-content-faint" /><input value={presetSearch} onChange={e => setPresetSearch(e.target.value)} placeholder="Search presets…" aria-label="Search launch presets" className="w-full rounded-xl bg-surface border border-line py-2 pl-9 pr-3 text-xs text-content" /></div>
            <select value={presetToolFilter} onChange={e => setPresetToolFilter(e.target.value as 'all' | 'opencode' | 'codex')} aria-label="Filter launch presets by tool" className="rounded-xl bg-surface border border-line px-3 py-2 text-xs font-bold text-content"><option value="all">All tools</option><option value="codex">Codex</option><option value="opencode">OpenCode</option></select>
          </div>
          <div className="space-y-2">
            {filteredModelPresets.length === 0 ? <div className="rounded-2xl border border-dashed border-line p-8 text-center text-xs text-content-faint">{modelPresets.length === 0 ? 'No launch presets yet.' : 'No presets match your filters.'}</div> : filteredModelPresets.map(preset => (
              <div key={preset.id} className="flex items-center gap-3 rounded-2xl bg-surface border border-line px-4 py-3">
                <span className="w-20 text-[11px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">{preset.tool}</span>
                {editingPresetId === preset.id ? <div className="flex-1 min-w-0 flex flex-wrap gap-2"><input value={editingModelLabel} onChange={e => setEditingModelLabel(e.target.value)} placeholder="Name" aria-label="Preset name" className="min-w-0 w-full sm:w-32 rounded-lg bg-surface-2 border border-line px-2 py-1 text-xs text-content" /><input value={editingModelId} onChange={e => setEditingModelId(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-surface-2 border border-line px-2 py-1 text-xs font-mono text-content" /><select value={editingModelReasoningEffort} onChange={e => setEditingModelReasoningEffort(e.target.value as 'low' | 'medium' | 'high')} className="w-24 rounded-lg bg-surface-2 border border-line px-2 py-1 text-xs font-bold text-content"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>{preset.tool === 'codex' && <select value={editingModelMode} onChange={e => setEditingModelMode(e.target.value as 'build' | 'plan')} className="w-24 rounded-lg bg-surface-2 border border-line px-2 py-1 text-xs font-bold text-content"><option value="build">Build</option><option value="plan">Plan</option></select>}</div> : <span className="flex-1 min-w-0"><span className="block truncate text-sm font-black text-content">{preset.label}</span><span className="block truncate text-[11px] text-content-faint">{preset.tool} · {preset.modelId} · {preset.reasoningEffort}{preset.tool === 'codex' ? ` · ${preset.mode}` : ''}</span></span>}
                <button type="button" onClick={() => updateModelPreset(preset, { enabled: !preset.enabled })} className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-black ${preset.enabled ? 'border-emerald-500/30 text-emerald-700 dark:text-emerald-300' : 'border-line text-content-faint'}`}>{preset.enabled ? 'Enabled' : 'Disabled'}</button>
                {editingPresetId === preset.id ? <><button type="button" onClick={async () => { await updateModelPreset(preset, { modelId: editingModelId.trim(), reasoningEffort: editingModelReasoningEffort, mode: editingModelMode, label: editingModelLabel.trim() }); setEditingPresetId(null); }} disabled={!editingModelId.trim() || !editingModelLabel.trim()} className="p-1.5 text-emerald-700 dark:text-emerald-300 disabled:opacity-40" title="Save launch preset"><Check className="w-4 h-4" /></button><button type="button" onClick={() => setEditingPresetId(null)} className="p-1.5 text-content-faint hover:text-content" title="Cancel editing">Cancel</button></> : <button type="button" onClick={() => { setEditingPresetId(preset.id); setEditingModelId(preset.modelId); setEditingModelReasoningEffort(preset.reasoningEffort); setEditingModelMode(preset.mode); setEditingModelLabel(preset.label); setModelPresetError(null); }} className="p-1.5 text-content-faint hover:text-content" title="Edit launch preset"><FileCog className="w-4 h-4" /></button>}
                <button type="button" onClick={async () => { if (window.confirm(`Delete launch preset "${preset.label}"?`)) { await api.delete(`/launcher-model-presets/${preset.id}/`); await loadModelPresets(); } }} className="p-1.5 text-content-faint hover:text-rose-400" title={`Delete launch preset ${preset.label}`}><Trash2 className="w-4 h-4" /></button>
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
            {projectFolderError && <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">{projectFolderError}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={saveProjectFolder} disabled={projectFolderBusy || !projectFolderDraft.trim()} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40">Save folder</button>
              <button type="button" onClick={resetProjectFolder} disabled={projectFolderBusy || !projectFolderIsCustom} className="rounded-xl border border-line px-4 py-2 text-xs font-black text-content-faint hover:text-content disabled:opacity-40">Reset to app default</button>
            </div>
          </div>
          <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
            <div>
              <h3 className="text-sm font-black text-content flex items-center gap-2"><HardDrive className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />Drive for all projects</h3>
              <p className="text-xs text-content-faint mt-1">Use this when the drive letter changed on your computer. It updates every project you own and remaps folder, CMD, and server-script paths. Python environments are not changed.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select value={globalDrive} onChange={e => { setGlobalDrive(e.target.value); setGlobalDriveStatus(null); }} disabled={globalDriveBusy} className="rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-mono text-content">
                <option value="">Select drive</option>
                {['C', 'D', 'E', 'F', 'G', 'H'].map(drive => <option key={drive} value={drive}>{drive}:/</option>)}
              </select>
              <button type="button" onClick={applyGlobalDrive} disabled={globalDriveBusy || !globalDrive} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40">Apply to all projects</button>
            </div>
            {globalDriveStatus && <p className={`text-xs ${globalDriveStatus.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`} role="alert">{globalDriveStatus.msg}</p>}
          </div>
          {showProjectFolderPicker && <PathPickerModal mode="folder" initialPath={projectFolderDraft || projectFolderEffective} title="Choose project folder" onClose={() => setShowProjectFolderPicker(false)} onSelect={path => { setProjectFolderDraft(path); setShowProjectFolderPicker(false); }} />}
        </div>
      )}

      {section === 'desktop' && isDesktop && (
        <div className="max-w-2xl space-y-3">
          <div className="p-5 rounded-2xl bg-surface border border-line space-y-4">
            <div>
              <h3 className="text-sm font-black text-content">Desktop app networking</h3>
              <p className="text-xs text-content-faint mt-1">The desktop window loads its interface directly, so it does not need a frontend port. The private local API uses an available loopback port automatically.</p>
            </div>
            {activeApiBase && <div className="rounded-xl bg-surface-2 border border-line px-3 py-2 text-[11px] font-mono text-content-faint">Current API: {activeApiBase}</div>}
            <label className="block space-y-1.5">
              <span className="text-[10px] uppercase tracking-wider font-black text-content-faint">API port override (optional)</span>
              <input
                inputMode="numeric"
                value={backendPortDraft}
                onChange={e => setBackendPortDraft(e.target.value)}
                placeholder="Automatic"
                className="w-full rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-mono text-content"
              />
              <span className="block text-[11px] text-content-faint">Use 1–65535. Changes take effect after restarting the app.</span>
            </label>
            {desktopPortStatus && <p className={`text-xs ${desktopPortStatus.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`} role="alert">{desktopPortStatus.msg}</p>}
            <button type="button" onClick={saveDesktopPort} disabled={desktopPortBusy} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white disabled:opacity-40">Save desktop setting</button>
          </div>
        </div>
      )}

      {/* SECTION: DATA & BACKUP */}
      {section === 'data' && (
        <div className="max-w-2xl space-y-3">
          {backupStatus && (
            <div
              className={`px-4 py-2.5 rounded-xl border text-xs font-bold ${
                backupStatus.ok
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                  : 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300'
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
              <Download className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <div>
                <div className="text-xs font-black text-content">Export JSON Backup</div>
                <div className="text-[13px] text-content-faint">Downloads a full snapshot of your workspace.</div>
              </div>
            </button>

            <label className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-2 border border-line hover:border-emerald-700 cursor-pointer text-left transition-all">
              <Upload className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <div className="text-xs font-black text-content">Restore JSON Backup</div>
                <div className="text-[13px] text-content-faint">Imports a backup file into this workspace.</div>
              </div>
              <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          <div className="p-5 rounded-2xl bg-surface border border-rose-950/60 space-y-4">
            <div>
              <h3 className="text-sm font-black text-rose-700 dark:text-rose-300">Danger Zone</h3>
              <p className="text-xs text-content-faint mt-0.5">
                Deletes all server-side workspace data. This cannot be undone.
              </p>
            </div>
            <button
              type="button"
              disabled={isBusy}
              onClick={async () => {
                if (!window.confirm('Purge all workspace data? This deletes all projects, tasks, ideas, time entries, skills, launch presets, and the saved project folder. Your account and app preferences stay intact.')) return;
                setIsBusy(true);
                try {
                  await resetDefaults();
                  setBackupStatus({ ok: true, msg: 'All workspace data was purged.' });
                  setCurrentView('dashboard');
                } catch {
                  setBackupStatus({ ok: false, msg: 'Purge failed — no success message is shown until the workspace is confirmed empty.' });
                } finally {
                  setIsBusy(false);
                  setTimeout(() => setBackupStatus(null), 4000);
                }
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50 hover:border-rose-700 text-left transition-all disabled:opacity-40"
            >
              <RotateCcw className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <div>
                <div className="text-xs font-black text-rose-700 dark:text-rose-200">Purge all workspace data</div>
                <div className="text-[13px] text-content-faint">Removes every workspace record and verifies the result. Your account and app preferences stay intact.</div>
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

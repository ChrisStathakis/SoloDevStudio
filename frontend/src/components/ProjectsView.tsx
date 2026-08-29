import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Plus, 
  FolderKanban, 
  CheckCircle2, 
  Calendar, 
  Clock, 
  ExternalLink, 
  Github, 
  Figma, 
  Layers, 
  ChevronRight, 
  Play, 
  Edit3, 
  Trash2, 
  Pin, 
  PinOff,
  Filter, 
  CheckSquare, 
  AlertCircle,
  Bug,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Tag,
  ListTodo,
  Cpu,
  FileText,
  FolderOpen,
  HardDrive,
  Zap,
  Terminal,
  Boxes,
  X,
  Clipboard,
  Check,
  ChevronDown
} from 'lucide-react';
import { ProjectStage, STAGE_CONFIG, QUADRANT_CONFIG, TASK_CATEGORY_CONFIG, Project, PriorityQuadrant, TaskCategory, LauncherModelPreset } from '../types';
import { api } from '../services/api';
import { DocsTab } from './DocsTab';
import { PathPickerModal } from './PathPickerModal';
import { TerminalDrawer, TerminalDrawerHandle } from './TerminalDrawer';
import { PageHeader, Button } from './ui';
import { MilestoneEditor } from './MilestoneEditor';

export const ProjectsView: React.FC = () => {
  const { 
    projects, 
    tasks, 
    timeEntries, 
    selectedProjectId, 
    setSelectedProjectId,
    advanceProjectStage,
    addMilestone,
    updateMilestone,
    deleteMilestone,
    deleteProject,
    updateProject,
    toggleTaskCompletion,
    updateTask,
    toggleSubtask,
    addSubtask,
    deleteTask,
    startTimer,
    openQuickAdd,
    setCurrentView,
    searchQuery,
    refreshData
  } = useApp();

  const [selectedStageFilter, setSelectedStageFilter] = useState<string>('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [activeDetailTab, setActiveDetailTab] = useState<'tasks' | 'milestones' | 'timelogs' | 'docs' | 'prompt'>('tasks');
  const [taskFilterStage, setTaskFilterStage] = useState<string>('all');
  const [taskFilterCategory, setTaskFilterCategory] = useState<string>('all');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState<{ [taskId: string]: string }>({});
  const [isEditingProject, setIsEditingProject] = useState<boolean>(false);
  const [isEditingDirPath, setIsEditingDirPath] = useState<boolean>(false);
  const [dirPathDraft, setDirPathDraft] = useState<string>('');
  const [isSavingDirPath, setIsSavingDirPath] = useState<boolean>(false);
  const [isOpeningFolder, setIsOpeningFolder] = useState<boolean>(false);
  const [isEditingScriptPath, setIsEditingScriptPath] = useState<boolean>(false);
  const [scriptPathDraft, setScriptPathDraft] = useState<string>('');
  const [isSavingScriptPath, setIsSavingScriptPath] = useState<boolean>(false);
  const [isEditingPort, setIsEditingPort] = useState<boolean>(false);
  const [portDraft, setPortDraft] = useState<string>('');
  const [pickerField, setPickerField] = useState<null | 'directoryPath' | 'scriptPath' | 'cmdDirectory' | 'pythonEnv'>(null);
  const [isEditingCmdDir, setIsEditingCmdDir] = useState<boolean>(false);
  const [cmdDirDraft, setCmdDirDraft] = useState<string>('');
  const [isEditingPythonEnv, setIsEditingPythonEnv] = useState<boolean>(false);
  const [pythonEnvDraft, setPythonEnvDraft] = useState<string>('');
  const [isRunningScript, setIsRunningScript] = useState<boolean>(false);
  const [isOpeningCmd, setIsOpeningCmd] = useState<boolean>(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [promptCopyError, setPromptCopyError] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [promptSaveError, setPromptSaveError] = useState<string | null>(null);
  const [initializationStatus, setInitializationStatus] = useState<string | null>(null);
  const [modelPresets, setModelPresets] = useState<LauncherModelPreset[]>([]);
  const [isLaunchDialogOpen, setIsLaunchDialogOpen] = useState(false);
  const [launchTool, setLaunchTool] = useState<'opencode' | 'codex'>('opencode');
  const [launchModel, setLaunchModel] = useState('');
  const [isSavingInitializationSettings, setIsSavingInitializationSettings] = useState(false);
  const [toolAvailability, setToolAvailability] = useState<{ tool: 'opencode' | 'codex'; available: boolean; npm_available: boolean; install_command: string; documentation_url: string; message?: string } | null>(null);
  const [isCheckingTool, setIsCheckingTool] = useState(false);
  const [isInstallingTool, setIsInstallingTool] = useState(false);
  const [taskPromptStatus, setTaskPromptStatus] = useState<Record<string, 'copied' | 'error' | undefined>>({});
  const [promptSource, setPromptSource] = useState<'project' | 'task'>('project');
  const [selectedPromptTaskId, setSelectedPromptTaskId] = useState('');
  const [milestoneEditor, setMilestoneEditor] = useState<{ milestone?: Project['milestones'][number] } | null>(null);
  const terminalDrawerRef = useRef<TerminalDrawerHandle | null>(null);

  // Selected project object
  const activeProject = projects.find(p => p.id === selectedProjectId) || null;

  // Reset all path editors / drafts / picker when switching projects so a stale
  // draft from one project can't be saved onto another (Bug 1: "paths not saved").
  useEffect(() => {
    setIsEditingDirPath(false);
    setIsEditingScriptPath(false);
    setIsEditingPort(false);
    setIsEditingCmdDir(false);
    setIsEditingPythonEnv(false);
    setIsSavingDirPath(false);
    setIsSavingScriptPath(false);
    setDirPathDraft('');
    setScriptPathDraft('');
    setPortDraft('');
    setCmdDirDraft('');
    setPythonEnvDraft('');
    setPickerField(null);
    setFolderError(null);
    setCopiedPrompt(false);
    setPromptCopyError(null);
    setPromptDraft(activeProject?.initialPrompt || '');
    setIsEditingPrompt(false);
    setIsSavingPrompt(false);
    setPromptSaveError(null);
    setInitializationStatus(null);
    setLaunchTool(activeProject?.initializationTool || 'opencode');
    setLaunchModel(activeProject?.initializationModel || '');
    setIsLaunchDialogOpen(false);
    setToolAvailability(null);
    setTaskPromptStatus({});
    setPromptSource('project');
    setSelectedPromptTaskId('');
  }, [activeProject?.id]);

  useEffect(() => {
    if (!isEditingPrompt) setPromptDraft(activeProject?.initialPrompt || '');
  }, [activeProject?.initialPrompt, isEditingPrompt]);

  useEffect(() => {
    if (!activeProject) return;
    api.get('/launcher-model-presets/', { params: { page_size: 100, tool: launchTool } })
      .then(res => {
        const rows = Array.isArray(res.data) ? res.data : (res.data?.results || []);
        setModelPresets(rows.map((raw: any) => ({ id: String(raw.id), tool: raw.tool === 'codex' ? 'codex' : 'opencode', modelId: raw.model_id || '', label: raw.label || '', enabled: raw.enabled !== false, createdAt: raw.created_at, updatedAt: raw.updated_at })));
      })
      .catch(() => setModelPresets([]));
  }, [activeProject?.id, launchTool]);

  const handleSaveInitialPrompt = async () => {
    if (!activeProject || !promptDraft.trim() || isSavingPrompt) return;
    setIsSavingPrompt(true);
    setPromptSaveError(null);
    try {
      await api.put(`/projects/${activeProject.id}/initial-prompt/`, { content: promptDraft });
      setIsEditingPrompt(false);
      await refreshData();
    } catch (error: any) {
      setPromptSaveError(error?.response?.data?.content || 'Unable to save the initial prompt.');
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleClearInitialPrompt = async () => {
    if (!activeProject || !activeProject.initialPrompt || isSavingPrompt) return;
    if (!window.confirm('Clear this project’s saved initial prompt?')) return;
    setIsSavingPrompt(true);
    setPromptSaveError(null);
    try {
      await api.delete(`/projects/${activeProject.id}/initial-prompt/`);
      setPromptDraft('');
      setIsEditingPrompt(false);
      await refreshData();
    } catch {
      setPromptSaveError('Unable to clear the initial prompt.');
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const copyTaskPrompt = async (taskId: string) => {
    try {
      const res = await api.get(`/tasks/${taskId}/prompt/`);
      await navigator.clipboard.writeText(res.data?.content || '');
      setTaskPromptStatus(prev => ({ ...prev, [taskId]: 'copied' }));
      window.setTimeout(() => setTaskPromptStatus(prev => ({ ...prev, [taskId]: undefined })), 2200);
    } catch (error: any) {
      setTaskPromptStatus(prev => ({ ...prev, [taskId]: 'error' }));
      setPromptCopyError(error?.response?.data?.error || 'Unable to create the task prompt.');
    }
  };

  const handleStartInitialization = async (tool: 'opencode' | 'codex', model: string) => {
    if (!activeProject?.initialPrompt) {
      setPromptCopyError('Save an initial prompt before starting initialization.');
      return;
    }
    if (!model.trim()) {
      setPromptCopyError('Choose a model before starting initialization.');
      return;
    }
    setIsLaunchDialogOpen(false);
    setPromptCopyError(null);
    setInitializationStatus(null);
    try {
      if (promptSource === 'task' && !selectedPromptTaskId) {
        setPromptCopyError('Choose an open task before starting initialization.');
        return;
      }
      const res = await api.get(promptSource === 'task' ? `/tasks/${selectedPromptTaskId}/prompt/` : `/projects/${activeProject.id}/initialize-prompt/`);
      await navigator.clipboard.writeText(res.data?.content || activeProject.initialPrompt);
      setCopiedPrompt(true);
      window.setTimeout(() => setCopiedPrompt(false), 2200);
      setIsCheckingTool(true);
      let availability;
      try {
        availability = await api.get(`/projects/${activeProject.id}/tool-availability/`, { params: { tool } });
      } finally {
        setIsCheckingTool(false);
      }
      setToolAvailability(availability.data);
      if (!availability.data?.available) {
        setIsLaunchDialogOpen(true);
        return;
      }
      try {
        const drawer = terminalDrawerRef.current;
        if (!drawer) {
          throw new Error('Terminal console is still loading. Please try again in a moment.');
        }
        const session = await drawer.create('cmd');
        if (session && !session.reused) {
          const command = tool === 'codex' ? `codex --model "${model}"\r` : `opencode --model "${model}"\r`;
          await drawer.sendInput(command, session.id);
          setInitializationStatus(`${tool === 'codex' ? 'Codex' : 'OpenCode'} started with ${model}. Paste the copied initialization prompt when ready.`);
        } else {
          setInitializationStatus(`The project console is already open. Paste the copied ${tool === 'codex' ? 'Codex' : 'OpenCode'} prompt when ready.`);
        }
      } catch (error: any) {
        const detail = error?.response?.data?.error || 'Set a CMD folder for this project to open its console.';
        setPromptCopyError(`Prompt copied. ${detail}`);
      }
    } catch (error: any) {
      setPromptCopyError(error?.response?.data?.error || 'Unable to prepare the initialization prompt.');
    }
  };

  const installSelectedTool = async () => {
    if (!activeProject || !toolAvailability || toolAvailability.available || isInstallingTool) return;
    if (!toolAvailability.npm_available) {
      setPromptCopyError('npm is not available in the project terminal. Install Node.js/npm first.');
      return;
    }
    if (!window.confirm(`Install ${toolAvailability.tool === 'codex' ? 'Codex' : 'OpenCode'} in the project terminal?`)) return;
    setIsInstallingTool(true);
    try {
      const drawer = terminalDrawerRef.current;
      if (!drawer) throw new Error('Terminal console is still loading. Please try again in a moment.');
      const session = await drawer.create('cmd');
      if (!session) throw new Error('Unable to open the project terminal.');
      await drawer.sendInput(`${toolAvailability.install_command}\r`, session.id);
      setIsLaunchDialogOpen(false);
      setInitializationStatus(`Install command sent to the terminal. When it finishes, click Start initialization again${session.reused ? '' : ' after reopening the console if needed'}.`);
    } catch (error: any) {
      setPromptCopyError(error?.response?.data?.error || error?.message || 'Unable to start the installation command.');
    } finally {
      setIsInstallingTool(false);
    }
  };

  const checkToolAvailability = async (tool: 'opencode' | 'codex') => {
    if (!activeProject || isCheckingTool) return;
    setIsCheckingTool(true);
    try {
      const res = await api.get(`/projects/${activeProject.id}/tool-availability/`, { params: { tool } });
      setToolAvailability(res.data);
    } catch (error: any) {
      setPromptCopyError(error?.response?.data?.error || 'Unable to check CLI availability.');
    } finally {
      setIsCheckingTool(false);
    }
  };

  const saveInitializationSettings = async () => {
    if (!activeProject || !launchModel.trim() || isSavingInitializationSettings) return;
    setIsSavingInitializationSettings(true);
    try {
      await api.patch(`/projects/${activeProject.id}/initialization-settings/`, { tool: launchTool, model_id: launchModel.trim() });
      await refreshData();
      setInitializationStatus('Project initialization defaults saved.');
    } catch (error: any) {
      setPromptCopyError(error?.response?.data?.model_id || 'Unable to save initialization defaults.');
    } finally {
      setIsSavingInitializationSettings(false);
    }
  };

  // Filtered projects list
  const filteredProjects = projects.filter(p => {
    const matchesStage = selectedStageFilter === 'all' || p.currentStage === selectedStageFilter;
    const matchesCategory = selectedCategoryFilter === 'all' || p.category === selectedCategoryFilter;
    const matchesSearch = !searchQuery || 
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.techStack.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesStage && matchesCategory && matchesSearch;
  });

  const getDaysRemaining = (targetDate: string) => {
    const target = new Date(targetDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);
    const diff = Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  const handleSaveMilestone = async (values: Omit<Project['milestones'][number], 'id'>) => {
    if (!activeProject) return;
    const editing = milestoneEditor?.milestone;
    if (editing) {
      await updateMilestone(editing.id, values);
    } else {
      await addMilestone(activeProject.id, values);
    }
    setMilestoneEditor(null);
  };

  const handleDeleteMilestone = async (milestone: Project['milestones'][number]) => {
    if (!confirm(`Delete milestone "${milestone.title}"? Linked tasks will remain.`)) return;
    try {
      await deleteMilestone(milestone.id);
    } catch (e: any) {
      showActionError(e?.response?.data?.detail || e?.message || 'Failed to delete milestone.');
    }
  };

  const handleOpenFolder = async () => {
    if (!activeProject) return;
    if (!activeProject.directoryPath) {
      setDirPathDraft('');
      setIsEditingDirPath(true);
      return;
    }
    setIsOpeningFolder(true);
    setFolderError(null);
    try {
      await api.post(`/projects/${activeProject.id}/open-folder/`);
    } catch (e: any) {
      const msg = e?.response?.data?.error || 'Failed to open folder.';
      setFolderError(msg);
      window.setTimeout(() => setFolderError(null), 4000);
    } finally {
      setIsOpeningFolder(false);
    }
  };

  const handleSaveDirPath = async () => {
    if (!activeProject) return;
    if (isSavingDirPath) return;
    const path = dirPathDraft.trim();
    setIsSavingDirPath(true);
    setFolderError(null);
    try {
      await updateProject(activeProject.id, { directoryPath: path });
      setDirPathDraft(path);
      setIsEditingDirPath(false);
    } catch (e: any) {
      const responseData = e?.response?.data;
      const detail = responseData?.error
        || (typeof responseData === 'string' ? responseData : responseData ? JSON.stringify(responseData) : null)
        || e?.message;
      setFolderError(detail ? `Failed to save folder path: ${detail}` : 'Failed to save folder path.');
    } finally {
      setIsSavingDirPath(false);
    }
  };

  const showActionError = (msg: string) => {
    setFolderError(msg);
  };

  const handleRunScript = async () => {
    if (!activeProject) return;
    if (!activeProject.scriptPath) {
      setScriptPathDraft('');
      setIsEditingScriptPath(true);
      return;
    }
    setIsRunningScript(true);
    setFolderError(null);
    try {
      const drawer = terminalDrawerRef.current;
      if (!drawer) throw new Error('Terminal console is still loading. Please try again in a moment.');
      await drawer.create('script');
    } catch (e: any) {
      showActionError(e?.response?.data?.error || 'Failed to run script.');
    } finally {
      setIsRunningScript(false);
    }
  };

  const handleOpenCmd = async () => {
    if (!activeProject) return;
    if (!activeProject.cmdDirectory) {
      setCmdDirDraft('');
      setIsEditingCmdDir(true);
      return;
    }
    setIsOpeningCmd(true);
    setFolderError(null);
    try {
      const drawer = terminalDrawerRef.current;
      if (!drawer) throw new Error('Terminal console is still loading. Please try again in a moment.');
      await drawer.create('cmd');
    } catch (e: any) {
      showActionError(e?.response?.data?.error || 'Failed to open cmd.');
    } finally {
      setIsOpeningCmd(false);
    }
  };

  const handleMinimizeCmd = () => {
    const drawer = terminalDrawerRef.current;
    if (!drawer) {
      showActionError('Terminal console is still loading. Please try again in a moment.');
      return;
    }
    drawer.minimize();
  };

  const handleSaveScriptPath = async () => {
    if (!activeProject) return;
    if (isSavingScriptPath) return;
    const path = scriptPathDraft.trim();
    setIsSavingScriptPath(true);
    setFolderError(null);
    try {
      await updateProject(activeProject.id, { scriptPath: path });
      setScriptPathDraft(path);
      setIsEditingScriptPath(false);
    } catch (e: any) {
      const responseData = e?.response?.data;
      const detail = responseData?.error
        || responseData?.detail
        || (typeof responseData === 'string' ? responseData : responseData ? JSON.stringify(responseData) : null)
        || e?.message;
      setFolderError(detail ? `Failed to save script path: ${detail}` : 'Failed to save script path.');
    } finally {
      setIsSavingScriptPath(false);
    }
  };

  const handleSavePort = async () => {
    if (!activeProject) return;
    try {
      await updateProject(activeProject.id, { port: portDraft.trim() });
      setFolderError(null);
    } catch {
      showActionError('Failed to save port / run args.');
    } finally {
      setIsEditingPort(false);
    }
  };

    const handlePickerSelect = async (field: 'directoryPath' | 'scriptPath' | 'cmdDirectory' | 'pythonEnv', path: string) => {
    if (!activeProject) return;
    setPickerField(null);
    // Keep picker selections on the same explicit save flow as typed paths.
    // This lets the user review the value and makes failures visible instead
    // of silently discarding the selection.
    if (field === 'directoryPath') {
      setDirPathDraft(path);
      setIsEditingDirPath(true);
      setFolderError(null);
      return;
    }
    if (field === 'scriptPath') {
      setScriptPathDraft(path);
      setIsEditingScriptPath(true);
      setFolderError(null);
      return;
    }
    if (field === 'cmdDirectory') {
      setCmdDirDraft(path);
      setIsEditingCmdDir(true);
      setFolderError(null);
      return;
    }
    try {
      await updateProject(activeProject.id, { [field]: path });
      setFolderError(null);
    } catch {
      showActionError(`Failed to save ${field}.`);
    }
  };

    const handleSaveCmdDir = async () => {
      if (!activeProject) return;
      try {
        await updateProject(activeProject.id, { cmdDirectory: cmdDirDraft.trim() });
        setFolderError(null);
        try {
          const drawer = terminalDrawerRef.current;
          if (!drawer) throw new Error('Terminal console is still loading. Please try again in a moment.');
          await drawer.restartIfRunning('cmd');
        } catch (e: any) {
          const detail = e?.response?.data?.error || e?.message;
          showActionError(detail ? `CMD directory saved, but console restart failed: ${detail}` : 'CMD directory saved, but the console could not be restarted.');
        }
      } catch {
        showActionError('Failed to save CMD directory.');
      } finally {
        setIsEditingCmdDir(false);
      }
    };

    const handleSavePythonEnv = async () => {
      if (!activeProject) return;
      try {
        await updateProject(activeProject.id, { pythonEnv: pythonEnvDraft.trim() });
        setFolderError(null);
      } catch {
        showActionError('Failed to save Python environment.');
      } finally {
        setIsEditingPythonEnv(false);
      }
    };

    const handleChangeDrive = async (drive: string) => {
      if (!activeProject) return;
      try {
        await updateProject(activeProject.id, { drive });
        setFolderError(null);
      } catch {
        showActionError('Failed to update drive.');
      }
    };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in">
      
      {/* Top Header & Stage Filters */}
      <PageHeader
        eyebrow="Project workspace"
        title="Projects"
        description="Move each build from first spark to shipped product."
        actions={<Button
          type="button"
          id="btn-add-new-project"
          onClick={() => openQuickAdd('project')}
          size="md"
        >
          <Plus className="w-4 h-4" />
          <span>New Project</span>
        </Button>}
      />

      {/* Filter Tabs by Stage */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <button
          type="button"
          onClick={() => setSelectedStageFilter('all')}
          className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
            selectedStageFilter === 'all'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'bg-surface-2 border border-line text-content-faint hover:text-white hover:border-line-strong'
          }`}
        >
          All Stages ({projects.length})
        </button>

        {(Object.keys(STAGE_CONFIG) as ProjectStage[]).map(stageKey => {
          const cfg = STAGE_CONFIG[stageKey];
          const count = projects.filter(p => p.currentStage === stageKey).length;
          const isSelected = selectedStageFilter === stageKey;

          return (
            <button
              key={stageKey}
              type="button"
              onClick={() => setSelectedStageFilter(stageKey)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                isSelected
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'bg-surface-2 border border-line text-content-faint hover:text-white hover:border-line-strong'
              }`}
            >
              <span>{cfg.label}</span>
              {count > 0 && (
                <span className={`text-[12px] px-1.5 py-0.2 rounded-full font-mono font-bold ${
                  isSelected ? 'bg-indigo-700 text-white' : 'bg-surface-3 text-content-faint'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Content Layout: Project List or Active Project Detail View */}
      {activeProject ? (
        /* PROJECT DETAIL VIEW */
        <div className="space-y-6 animate-in fade-in">
          
          {/* Back Navigation Bar */}
          <div className="flex items-center justify-between">
            <button
              type="button"
              id="btn-back-to-projects"
              onClick={() => setSelectedProjectId(null)}
              className="text-xs font-black text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 transition-colors font-mono tracking-wide"
            >
              <span>← Back to All Projects</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => updateProject(activeProject.id, { pinned: !activeProject.pinned })}
                className="p-2 text-content-faint hover:text-white rounded-xl bg-surface-2 border border-line hover:border-line-strong transition-colors"
                title={activeProject.pinned ? 'Unpin' : 'Pin to top'}
              >
                {activeProject.pinned ? <PinOff className="w-4 h-4 text-amber-400" /> : <Pin className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete project "${activeProject.title}" and its tasks?`)) {
                    deleteProject(activeProject.id);
                  }
                }}
                className="p-2 text-rose-400 hover:text-rose-300 rounded-xl bg-surface-2 border border-line hover:border-rose-800 transition-colors"
                title="Delete Project"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Project Header Banner */}
          <div className="p-6 rounded-3xl bg-surface border border-line shadow-xl space-y-6">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="space-y-2 max-w-2xl">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-4 h-4 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: activeProject.color || '#6366f1' }}
                  />
                  <h2 className="text-2xl font-black text-content tracking-tight">
                    {activeProject.title}
                  </h2>
                  <span className="text-[12px] font-bold px-2.5 py-1 rounded-lg bg-surface-3 text-content-muted font-mono">
                    {activeProject.category}
                  </span>
                </div>

                <p className="text-sm font-semibold text-content-muted">
                  {activeProject.tagline}
                </p>

                {activeProject.description && (
                  <p className="text-xs text-content-faint whitespace-pre-line leading-relaxed">
                    {activeProject.description}
                  </p>
                )}
              </div>

              {/* Action Buttons & Links */}
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {activeProject.repoUrl && (
                  <a
                    href={activeProject.repoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-2 border border-line text-content text-xs font-bold hover:bg-surface-3 hover:border-line-strong transition-colors"
                  >
                    <Github className="w-3.5 h-3.5" />
                    <span>Repo</span>
                  </a>
                )}
                {activeProject.liveUrl && (
                  <a
                    href={activeProject.liveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-bold hover:bg-emerald-500/20 transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Live</span>
                  </a>
                )}
                {activeProject.figmaUrl && (
                  <a
                    href={activeProject.figmaUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-300 text-xs font-bold hover:bg-purple-500/20 transition-colors"
                  >
                    <Figma className="w-3.5 h-3.5" />
                    <span>Figma</span>
                  </a>
                )}
                <button
                  type="button"
                  onClick={handleOpenFolder}
                  disabled={isOpeningFolder}
                  title={activeProject.directoryPath ? `Open ${activeProject.directoryPath}` : 'Set a project folder path first'}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-2 border border-line text-content text-xs font-bold hover:bg-surface-3 hover:border-indigo-700 hover:text-indigo-300 transition-colors disabled:opacity-50"
                >
                  {isOpeningFolder ? (
                    <div className="w-3.5 h-3.5 border-2 border-slate-600 border-t-indigo-400 rounded-full animate-spin" />
                  ) : (
                    <FolderOpen className="w-3.5 h-3.5" />
                  )}
                  <span>{activeProject.directoryPath ? 'Open Folder' : 'Set Folder'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleRunScript}
                  disabled={isRunningScript}
                  title={activeProject.scriptPath ? `Run ${activeProject.scriptPath} in an in-app console` : 'Set a server script (.bat) path first'}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-bold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  {isRunningScript ? (
                    <div className="w-3.5 h-3.5 border-2 border-emerald-700 border-t-emerald-300 rounded-full animate-spin" />
                  ) : (
                    <Zap className="w-3.5 h-3.5" />
                  )}
                  <span>{activeProject.scriptPath ? 'Run Server' : 'Set Script'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleOpenCmd}
                  disabled={isOpeningCmd}
                  title={activeProject.cmdDirectory ? `Open in-app CMD at ${activeProject.cmdDirectory}` : 'Set a CMD directory first'}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-2 border border-line text-content text-xs font-bold hover:bg-surface-3 hover:border-slate-600 transition-colors disabled:opacity-50"
                >
                  {isOpeningCmd ? (
                    <div className="w-3.5 h-3.5 border-2 border-slate-600 border-t-slate-200 rounded-full animate-spin" />
                  ) : (
                    <Terminal className="w-3.5 h-3.5" />
                  )}
                  <span>{activeProject.cmdDirectory ? 'CMD' : 'Set CMD'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleMinimizeCmd}
                  title="Minimize the in-app CMD panel (keeps consoles running)"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-2 border border-line text-content text-xs font-bold hover:bg-surface-3 hover:border-slate-600 transition-colors"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                  <span>Minimize CMD</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    startTimer('pomodoro', activeProject.id);
                    setCurrentView('timetracker');
                  }}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-md tracking-wide"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Start Focus</span>
                </button>
              </div>
            </div>

            {/* Project Folder Path */}
            {folderError && (
              <div className="flex items-start justify-between gap-3 px-3.5 py-2 rounded-xl bg-rose-950/30 border border-rose-900/50 text-xs font-bold text-rose-300" role="alert">
                <span>{folderError}</span>
                <button type="button" onClick={() => setFolderError(null)} className="shrink-0 text-rose-300 hover:text-white" aria-label="Dismiss error">×</button>
              </div>
            )}
            {isEditingDirPath ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveDirPath();
                }}
              >
                <FolderOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <input
                  type="text"
                  autoFocus
                  value={dirPathDraft}
                  onChange={e => setDirPathDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape') setIsEditingDirPath(false);
                  }}
                  placeholder="e.g. D:\projects\my-app"
                  className="flex-1 min-w-[220px] px-3 py-2 bg-surface-2 border border-line focus:border-indigo-500 rounded-xl text-xs font-mono text-content placeholder-slate-600 outline-none transition-colors"
                />
                <button
                  type="submit"
                  disabled={isSavingDirPath}
                  className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black transition-all"
                >
                  {isSavingDirPath ? 'Saving…' : 'Save Path'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingDirPath(false)}
                  disabled={isSavingDirPath}
                  className="p-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-white transition-colors"
                  title="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPickerField('directoryPath')}
                  disabled={isSavingDirPath}
                  className="px-3 py-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-indigo-300 text-xs font-black transition-colors"
                  title="Browse for folder"
                >
                  Browse
                </button>
              </form>
            ) : activeProject.directoryPath ? (
              <div className="flex items-center gap-2 -mt-4">
                <FolderOpen className="w-3.5 h-3.5 text-content-faint shrink-0" />
                <span
                  className="text-[13px] font-mono text-content-faint truncate max-w-xs sm:max-w-md lg:max-w-lg"
                  title={activeProject.directoryPath}
                >
                  {activeProject.directoryPath}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setDirPathDraft(activeProject.directoryPath || '');
                    setIsEditingDirPath(true);
                  }}
                  className="text-[12px] font-black uppercase tracking-wider text-slate-600 hover:text-indigo-400 transition-colors shrink-0"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPickerField('directoryPath')}
                  className="text-[12px] font-black uppercase tracking-wider text-slate-600 hover:text-indigo-400 transition-colors shrink-0"
                >
                  Browse
                </button>
              </div>
            ) : null}

            {/* Server Script (.bat) Path */}
            {isEditingScriptPath ? (
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveScriptPath();
                }}
              >
                <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <input
                  type="text"
                  autoFocus
                  value={scriptPathDraft}
                  onChange={e => setScriptPathDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Escape' && !isSavingScriptPath) setIsEditingScriptPath(false);
                  }}
                  placeholder="e.g. D:\projects\my-app\start-server.bat"
                  className="flex-1 min-w-[220px] px-3 py-2 bg-surface-2 border border-line focus:border-emerald-500 rounded-xl text-xs font-mono text-content placeholder-slate-600 outline-none transition-colors"
                />
                <button
                  type="submit"
                  disabled={isSavingScriptPath}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition-all"
                >
                  {isSavingScriptPath ? 'Saving…' : 'Save Path'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingScriptPath(false)}
                  disabled={isSavingScriptPath}
                  className="p-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-white transition-colors"
                  title="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPickerField('scriptPath')}
                  disabled={isSavingScriptPath}
                  className="px-3 py-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-emerald-300 text-xs font-black transition-colors"
                  title="Browse for script (.bat/.cmd)"
                >
                  Browse
                </button>
              </form>
            ) : activeProject.scriptPath ? (
              <div className="flex items-center gap-2 -mt-4">
                <Zap className="w-3.5 h-3.5 text-content-faint shrink-0" />
                <span
                  className="text-[13px] font-mono text-content-faint truncate max-w-xs sm:max-w-md lg:max-w-lg"
                  title={activeProject.scriptPath}
                >
                  {activeProject.scriptPath}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setScriptPathDraft(activeProject.scriptPath || '');
                    setIsEditingScriptPath(true);
                  }}
                  className="text-[12px] font-black uppercase tracking-wider text-slate-600 hover:text-emerald-400 transition-colors shrink-0"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPickerField('scriptPath')}
                  className="text-[12px] font-black uppercase tracking-wider text-slate-600 hover:text-emerald-400 transition-colors shrink-0"
                >
                  Browse
                </button>
              </div>
            ) : null}

            {/* Port / Run Args */}
            {isEditingPort ? (
              <div className="flex flex-wrap items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <input
                  type="text"
                  autoFocus
                  value={portDraft}
                  onChange={e => setPortDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSavePort();
                    if (e.key === 'Escape') setIsEditingPort(false);
                  }}
                  placeholder="e.g. 8001 or --port 8001 (blank = none)"
                  className="flex-1 min-w-[220px] px-3 py-2 bg-surface-2 border border-line focus:border-emerald-500 rounded-xl text-xs font-mono text-content placeholder-slate-600 outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={handleSavePort}
                  className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black transition-all"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingPort(false)}
                  className="p-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-white transition-colors"
                  title="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 -mt-4">
                <Zap className="w-3.5 h-3.5 text-content-faint shrink-0" />
                <span
                  className="text-[13px] font-mono text-content-faint truncate max-w-xs sm:max-w-md lg:max-w-lg"
                  title={activeProject.port || 'No port / run args set'}
                >
                  {activeProject.port ? `Port / Args: ${activeProject.port}` : 'No port / run args set'}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPortDraft(activeProject.port || '');
                    setIsEditingPort(true);
                  }}
                  className="text-[12px] font-black uppercase tracking-wider text-slate-600 hover:text-emerald-400 transition-colors shrink-0"
                >
                  Edit
                </button>
              </div>
            )}

            {/* CMD Directory */}
            {isEditingCmdDir ? (
              <div className="flex flex-wrap items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-content-faint shrink-0" />
                <input
                  type="text"
                  autoFocus
                  value={cmdDirDraft}
                  onChange={e => setCmdDirDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSaveCmdDir();
                    if (e.key === 'Escape') setIsEditingCmdDir(false);
                  }}
                  placeholder="e.g. D:\projects\my-app"
                  className="flex-1 min-w-[220px] px-3 py-2 bg-surface-2 border border-line focus:border-indigo-500 rounded-xl text-xs font-mono text-content placeholder-slate-600 outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={handleSaveCmdDir}
                  className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black transition-all"
                >
                  Save Path
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingCmdDir(false)}
                  className="p-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-white transition-colors"
                  title="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPickerField('cmdDirectory')}
                  className="px-3 py-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-indigo-300 text-xs font-black transition-colors"
                  title="Browse for folder"
                >
                  Browse
                </button>
              </div>
            ) : activeProject.cmdDirectory ? (
              <div className="flex items-center gap-2 -mt-4">
                <Terminal className="w-3.5 h-3.5 text-content-faint shrink-0" />
                <span
                  className="text-[13px] font-mono text-content-faint truncate max-w-xs sm:max-w-md lg:max-w-lg"
                  title={activeProject.cmdDirectory}
                >
                  {activeProject.cmdDirectory}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setCmdDirDraft(activeProject.cmdDirectory || '');
                    setIsEditingCmdDir(true);
                  }}
                  className="text-[12px] font-black uppercase tracking-wider text-slate-600 hover:text-indigo-400 transition-colors shrink-0"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPickerField('cmdDirectory')}
                  className="text-[12px] font-black uppercase tracking-wider text-slate-600 hover:text-indigo-400 transition-colors shrink-0"
                >
                  Browse
                </button>
              </div>
            ) : null}

            {/* Python Environment */}
            {isEditingPythonEnv ? (
              <div className="flex flex-wrap items-center gap-2">
                <Boxes className="w-3.5 h-3.5 text-content-faint shrink-0" />
                <input
                  type="text"
                  autoFocus
                  value={pythonEnvDraft}
                  onChange={e => setPythonEnvDraft(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSavePythonEnv();
                    if (e.key === 'Escape') setIsEditingPythonEnv(false);
                  }}
                  placeholder="e.g. D:\envs\my-venv"
                  className="flex-1 min-w-[220px] px-3 py-2 bg-surface-2 border border-line focus:border-indigo-500 rounded-xl text-xs font-mono text-content placeholder-slate-600 outline-none transition-colors"
                />
                <button
                  type="button"
                  onClick={handleSavePythonEnv}
                  className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black transition-all"
                >
                  Save Path
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingPythonEnv(false)}
                  className="p-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-white transition-colors"
                  title="Cancel"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setPickerField('pythonEnv')}
                  className="px-3 py-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-indigo-300 text-xs font-black transition-colors"
                  title="Browse for virtualenv folder"
                >
                  Browse
                </button>
              </div>
            ) : activeProject.pythonEnv ? (
              <div className="flex items-center gap-2 -mt-4">
                <Boxes className="w-3.5 h-3.5 text-content-faint shrink-0" />
                <span
                  className="text-[13px] font-mono text-content-faint truncate max-w-xs sm:max-w-md lg:max-w-lg"
                  title={activeProject.pythonEnv}
                >
                  {activeProject.pythonEnv}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPythonEnvDraft(activeProject.pythonEnv || '');
                    setIsEditingPythonEnv(true);
                  }}
                  className="text-[12px] font-black uppercase tracking-wider text-slate-600 hover:text-indigo-400 transition-colors shrink-0"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPickerField('pythonEnv')}
                  className="text-[12px] font-black uppercase tracking-wider text-slate-600 hover:text-indigo-400 transition-colors shrink-0"
                >
                  Browse
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPythonEnvDraft('');
                  setIsEditingPythonEnv(true);
                }}
                className="flex items-center gap-2 -mt-4 text-[12px] font-black uppercase tracking-wider text-slate-600 hover:text-indigo-400 transition-colors"
              >
                <Boxes className="w-3.5 h-3.5" />
                Set Python Environment
              </button>
            )}

            {/* Drive (remaps all project folder paths when the USB drive letter changes) */}
            <div className="flex items-center gap-2 -mt-4">
              <HardDrive className="w-3.5 h-3.5 text-content-faint shrink-0" />
              <span className="text-[13px] font-mono text-content-faint">Drive:</span>
              <select
                value={activeProject.drive || ''}
                onChange={(e) => handleChangeDrive(e.target.value)}
                className="px-2 py-1 bg-surface-2 border border-line focus:border-indigo-500 rounded-lg text-xs font-mono text-content outline-none transition-colors"
                title="Select the drive letter for this project's paths (e.g. when moving to another PC via USB)"
              >
                <option value="">Select drive</option>
                {['C', 'D', 'E', 'F', 'G', 'H'].map((d) => (
                  <option key={d} value={d}>{d}:/</option>
                ))}
              </select>
              <span className="text-[11px] text-content-faint">
                remaps CMD / script / folder paths
              </span>
            </div>

            {pickerField && activeProject && (
              <PathPickerModal
                mode={pickerField === 'scriptPath' ? 'file' : 'folder'}
                fileFilter={pickerField === 'scriptPath' ? ['.bat', '.cmd'] : undefined}
                initialPath={
                    pickerField === 'directoryPath'
                    ? (isEditingDirPath ? dirPathDraft : activeProject.directoryPath)
                    : pickerField === 'scriptPath'
                    ? (isEditingScriptPath ? scriptPathDraft : activeProject.scriptPath)
                    : pickerField === 'pythonEnv'
                    ? activeProject.pythonEnv
                    : (isEditingCmdDir ? cmdDirDraft : activeProject.cmdDirectory)
                }
                title={
                  pickerField === 'scriptPath'
                    ? 'Select Server Script (.bat / .cmd)'
                    : pickerField === 'directoryPath'
                    ? 'Select Project Folder'
                    : pickerField === 'pythonEnv'
                    ? 'Select Python Virtualenv'
                    : 'Select CMD Directory'
                }
                onClose={() => setPickerField(null)}
                onSelect={(path) => handlePickerSelect(pickerField, path)}
              />
            )}

            {/* Interactive Lifecycle Stage Stepper */}
            <div className="pt-4 border-t border-line/80">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-black text-content-muted uppercase tracking-[0.15em] font-mono">
                  Lifecycle Progress & Stage Stepper
                </span>
                <span className="text-xs text-content-faint">
                  Click any stage to transition status
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                {(Object.keys(STAGE_CONFIG) as ProjectStage[]).map(stg => {
                  const cfg = STAGE_CONFIG[stg];
                  const isCurrent = activeProject.currentStage === stg;
                  const isCompleted = cfg.order < STAGE_CONFIG[activeProject.currentStage].order;

                  return (
                    <button
                      key={stg}
                      type="button"
                      onClick={() => advanceProjectStage(activeProject.id, stg)}
                      className={`p-3 rounded-2xl border text-left transition-all relative overflow-hidden ${
                        isCurrent
                          ? 'border-indigo-500 bg-indigo-950/40 ring-1 ring-indigo-500 shadow-md'
                          : isCompleted
                          ? 'border-emerald-900/60 bg-emerald-950/20 text-emerald-300 hover:border-emerald-700'
                          : 'border-line bg-surface-2 hover:bg-surface-3 text-content-faint'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] font-mono font-bold uppercase text-content-faint">
                          Stage {cfg.order}
                        </span>
                        {isCompleted && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                        {isCurrent && <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />}
                      </div>

                      <div className={`text-xs font-black ${isCurrent ? 'text-content' : ''}`}>
                        {cfg.label}
                      </div>

                      <p className="text-[12px] text-content-faint line-clamp-2 mt-1 leading-tight">
                        {cfg.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Target Deadline & Tech Stack */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-line/80 text-xs font-mono">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-content-muted">
                  <Calendar className="w-4 h-4 text-indigo-400" />
                  <span className="font-bold">Target Launch:</span>
                  <span>{activeProject.targetDeadline}</span>
                  <span className="text-[13px] px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-bold">
                    {getDaysRemaining(activeProject.targetDeadline)}d left
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-content-muted">
                  <Clock className="w-4 h-4 text-emerald-400" />
                  <span className="font-bold">Time Logged:</span>
                  <span className="text-emerald-400 font-bold">
                    {(
                      timeEntries
                        .filter(e => e.projectId === activeProject.id)
                        .reduce((acc, curr) => acc + curr.durationSeconds, 0) / 3600
                    ).toFixed(1)} hrs
                  </span>
                </div>
              </div>

              {/* Tech Stack Chips & Advisor Button */}
              <div className="flex flex-wrap items-center gap-1.5">
                {activeProject.techStack.map(t => (
                  <span
                    key={t}
                    className="px-2.5 py-1 rounded-lg bg-surface-2 border border-line text-content-muted text-xs font-medium"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Project Sub-Tabs: Tasks, Milestones, Time Logs */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-line">
              <button
                type="button"
                id="btn-tab-tasks"
                onClick={() => setActiveDetailTab('tasks')}
                className={`pb-3 px-3.5 text-xs font-black border-b-2 transition-all font-mono ${
                  activeDetailTab === 'tasks'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-content-faint hover:text-white'
                }`}
              >
                Tasks & Checklist ({tasks.filter(t => t.projectId === activeProject.id).length})
              </button>

              <button
                type="button"
                id="btn-tab-milestones"
                onClick={() => setActiveDetailTab('milestones')}
                className={`pb-3 px-3.5 text-xs font-black border-b-2 transition-all font-mono ${
                  activeDetailTab === 'milestones'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-content-faint hover:text-white'
                }`}
              >
                Milestones & Roadmap ({activeProject.milestones.length})
              </button>

              <button
                type="button"
                id="btn-tab-timelogs"
                onClick={() => setActiveDetailTab('timelogs')}
                className={`pb-3 px-3.5 text-xs font-black border-b-2 transition-all font-mono ${
                  activeDetailTab === 'timelogs'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-content-faint hover:text-white'
                }`}
              >
                Time Sessions ({timeEntries.filter(e => e.projectId === activeProject.id).length})
              </button>

              <button
                type="button"
                id="btn-tab-docs"
                onClick={() => setActiveDetailTab('docs')}
                className={`flex items-center gap-1.5 pb-3 px-3.5 text-xs font-black border-b-2 transition-all font-mono ${
                  activeDetailTab === 'docs'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-content-faint hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                Skills
              </button>

              <button
                type="button"
                id="btn-tab-prompt"
                onClick={() => setActiveDetailTab('prompt')}
                className={`flex items-center gap-1.5 pb-3 px-3.5 text-xs font-black border-b-2 transition-all font-mono ${
                  activeDetailTab === 'prompt'
                    ? 'border-indigo-500 text-indigo-400'
                    : 'border-transparent text-content-faint hover:text-white'
                }`}
              >
                <Clipboard className="w-3.5 h-3.5" />
                Initial Prompt
              </button>
            </div>

            {/* TAB: TASKS */}
            {activeDetailTab === 'tasks' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <select
                      value={taskFilterStage}
                      onChange={e => setTaskFilterStage(e.target.value)}
                      className="px-3.5 py-1.5 text-xs bg-surface-2 border border-line rounded-xl text-content-muted font-bold outline-none"
                    >
                      <option value="all">All Stages</option>
                      {(Object.keys(STAGE_CONFIG) as ProjectStage[]).map(s => (
                        <option key={s} value={s}>{STAGE_CONFIG[s].label}</option>
                      ))}
                    </select>
                    <select
                      value={taskFilterCategory}
                      onChange={e => setTaskFilterCategory(e.target.value)}
                      className="px-3.5 py-1.5 text-xs bg-surface-2 border border-line rounded-xl text-content-muted font-bold outline-none"
                      title="Filter by task category"
                    >
                      <option value="all">All Categories</option>
                      <option value="bug">🐛 Bugs</option>
                      <option value="feature">✦ Features</option>
                      <option value="chore">🔧 Chores</option>
                      <option value="improvement">⬆ Improvements</option>
                      <option value="general">• General</option>
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={() => openQuickAdd('task')}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Task</span>
                  </button>
                </div>

                {/* Tasks List */}
                <div className="space-y-3">
                  {tasks
                    .filter(t => t.projectId === activeProject.id)
                    .filter(t => taskFilterStage === 'all' || t.stage === taskFilterStage)
                    .filter(t => taskFilterCategory === 'all' || (t as any).category === taskFilterCategory)
                    .map(task => {
                      const qConfig = QUADRANT_CONFIG[task.quadrant];
                      const subtaskInput = newSubtaskTitle[task.id] || '';

                      return (
                        <div
                          key={task.id}
                          className={`p-4 rounded-2xl bg-surface border transition-all ${
                            task.completed
                              ? 'border-line/80 opacity-60 bg-surface-inverse'
                              : 'border-line shadow-md hover:border-line-strong'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              <button
                                type="button"
                                onClick={() => toggleTaskCompletion(task.id)}
                                className="mt-1 p-0.5 text-content-faint hover:text-emerald-400 transition-colors shrink-0"
                              >
                                {task.completed ? (
                                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                                ) : (
                                  <div className="w-5 h-5 rounded-lg border-2 border-line-strong hover:border-indigo-500 transition-colors bg-surface-2" />
                                )}
                              </button>

                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className={`text-sm font-black ${
                                    task.completed ? 'line-through text-content-faint' : 'text-content'
                                  }`}>
                                    {task.title}
                                  </span>

                                  <span className={`text-[12px] font-bold px-2 py-0.5 rounded-md border ${qConfig.badgeClass}`}>
                                    {qConfig.tag} - {qConfig.title}
                                  </span>

                                  <span className="text-[12px] font-mono px-2 py-0.5 rounded-md bg-surface-3 text-content-faint font-bold">
                                    {STAGE_CONFIG[task.stage]?.label}
                                  </span>

                                  {(() => { const cat = (task as any).category as TaskCategory || 'feature'; const cfg = TASK_CATEGORY_CONFIG[cat]; return (
                                    <span className={`text-[12px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 ${cfg.badgeClass}`} title={cfg.label}>
                                      {cat === 'bug' ? <Bug className="w-3 h-3" /> : <span>{cfg.icon}</span>}
                                      <span>{cfg.label}</span>
                                    </span>
                                  ); })()}

                                  {task.milestoneIds?.map(milestoneId => {
                                    const milestone = activeProject.milestones.find(item => item.id === milestoneId);
                                    return milestone ? (
                                      <span key={milestone.id} className="text-[11px] font-bold px-2 py-0.5 rounded-md border border-purple-500/25 bg-purple-500/10 text-purple-300" title="Linked milestone">
                                        {milestone.title}
                                      </span>
                                    ) : null;
                                  })}
                                </div>

                                {task.description && (
                                  <p className="text-xs text-content-faint mt-1">
                                    {task.description}
                                  </p>
                                )}

                                {/* Subtasks checklist */}
                                {task.subtasks.length > 0 && (
                                  <div className="mt-3 space-y-1.5 pl-2.5 border-l-2 border-line">
                                    {task.subtasks.map(st => (
                                      <div
                                        key={st.id}
                                        onClick={() => toggleSubtask(task.id, st.id)}
                                        className="flex items-center gap-2 text-xs text-content-muted cursor-pointer group"
                                      >
                                        <div className={`w-3.5 h-3.5 rounded flex items-center justify-center text-[12px] ${
                                          st.completed ? 'bg-emerald-500 text-white' : 'border border-line-strong group-hover:border-indigo-500'
                                        }`}>
                                          {st.completed && '✓'}
                                        </div>
                                        <span className={st.completed ? 'line-through text-content-faint' : ''}>
                                          {st.title}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                )}

                                {/* Add subtask inline */}
                                <div className="mt-2.5 flex items-center gap-2 max-w-sm">
                                  <input
                                    type="text"
                                    placeholder="+ Add checklist step..."
                                    value={subtaskInput}
                                    onChange={e =>
                                      setNewSubtaskTitle({ ...newSubtaskTitle, [task.id]: e.target.value })
                                    }
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        addSubtask(task.id, subtaskInput);
                                        setNewSubtaskTitle({ ...newSubtaskTitle, [task.id]: '' });
                                      }
                                    }}
                                    className="px-3 py-1 text-xs bg-surface-2 border border-line rounded-xl text-content placeholder-slate-500 outline-none flex-1 focus:border-indigo-500"
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Task Action Bar */}
                            <div className="flex items-center gap-2 shrink-0">
                              <select
                                value={(task as any).category || 'feature'}
                                onChange={e => updateTask(task.id, { category: e.target.value as TaskCategory } as any)}
                                className="px-2 py-1 text-[13px] bg-surface-2 border border-line rounded-lg text-content-muted font-bold outline-none"
                                title="Change task category"
                              >
                                <option value="feature">Feature</option>
                                <option value="bug">Bug</option>
                                <option value="chore">Chore</option>
                                <option value="improvement">Improvement</option>
                                <option value="general">General</option>
                              </select>
                              <button
                                type="button"
                                onClick={() => {
                                  startTimer('pomodoro', activeProject.id, task.id);
                                  setCurrentView('timetracker');
                                }}
                                className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 hover:bg-indigo-500/20 text-xs font-bold transition-all"
                                title="Start Focus timer on this task"
                              >
                                <Play className="w-3 h-3" />
                                <span className="hidden sm:inline">Focus</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => void copyTaskPrompt(task.id)}
                                className={`flex items-center gap-1 px-3 py-1.5 rounded-xl border text-xs font-bold transition-all ${taskPromptStatus[task.id] === 'copied' ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300' : taskPromptStatus[task.id] === 'error' ? 'bg-rose-500/10 border-rose-500/25 text-rose-300' : 'bg-surface-2 border-line text-content-faint hover:text-indigo-300'}`}
                                title="Copy a focused prompt for this task and its subtasks"
                              >
                                {taskPromptStatus[task.id] === 'copied' ? <Check className="w-3 h-3" /> : <Clipboard className="w-3 h-3" />}
                                <span className="hidden sm:inline">{taskPromptStatus[task.id] === 'copied' ? 'Copied' : taskPromptStatus[task.id] === 'error' ? 'Retry' : 'Copy prompt'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => deleteTask(task.id)}
                                className="p-1.5 text-content-faint hover:text-rose-400 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Footer Meta */}
                          <div className="mt-3 pt-2.5 border-t border-line/80 flex flex-wrap items-center justify-between gap-2 text-[13px] text-content-faint font-mono">
                            <div className="flex items-center gap-3">
                              {task.dueDate && (
                                <span className="flex items-center gap-1 text-content-faint">
                                  <Calendar className="w-3 h-3 text-content-faint" />
                                  <span>Due: {task.dueDate}</span>
                                </span>
                              )}
                              <span className="flex items-center gap-1 text-emerald-400">
                                <Clock className="w-3 h-3" />
                                <span>{task.timeSpentMinutes || 0}m spent (est. {task.estimatedMinutes || 60}m)</span>
                              </span>
                            </div>

                            <div className="flex items-center gap-1">
                              {task.tags.map(t => (
                                <span key={t} className="px-2 py-0.5 rounded-md bg-surface-2 border border-line text-[12px] text-content-muted">
                                  #{t}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* TAB: MILESTONES */}
            {activeDetailTab === 'milestones' && (
              <div className="space-y-4">
                <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black text-content uppercase tracking-[0.2em] font-mono">
                      Target Milestones & Roadmap Checkpoints
                    </h3>
                    <button
                      type="button"
                      onClick={() => setMilestoneEditor({})}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add milestone
                    </button>
                  </div>

                  <div className="space-y-3">
                    {activeProject.milestones.map((ms, idx) => (
                      (() => {
                        const linkedTasks = tasks.filter(task => task.milestoneIds?.includes(ms.id));
                        const linkedDone = linkedTasks.filter(task => task.completed).length;
                        return (
                      <div
                        key={ms.id}
                        className="p-4 rounded-2xl bg-surface-2 border border-line flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = activeProject.milestones.map(m =>
                                m.id === ms.id ? { ...m, completed: !m.completed } : m
                              );
                              updateProject(activeProject.id, { milestones: updated });
                            }}
                            className="text-content-faint hover:text-emerald-400"
                          >
                            {ms.completed ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                            ) : (
                              <div className="w-5 h-5 rounded-lg border-2 border-line-strong bg-surface-inverse" />
                            )}
                          </button>

                          <div>
                            <div className={`text-xs font-bold ${ms.completed ? 'line-through text-content-faint' : 'text-content'}`}>
                              {ms.title}
                            </div>
                            {ms.description && (
                              <div className="text-[13px] text-content-faint mt-0.5">
                                {ms.description}
                              </div>
                            )}
                            <div className="text-[11px] text-content-faint mt-1.5">
                              {linkedTasks.length ? `${linkedDone}/${linkedTasks.length} linked tasks complete` : 'No linked tasks'}
                              {linkedTasks.length > 0 && <span className="ml-2">· {linkedTasks.map(task => task.title).join(', ')}</span>}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0 text-xs font-mono">
                          <div className="text-[13px] font-bold text-content-muted">
                            {ms.targetDate}
                          </div>
                          <span className="text-[12px] text-indigo-400 font-bold">
                            {STAGE_CONFIG[ms.stage]?.label}
                          </span>
                          <div className="flex items-center justify-end gap-2 mt-2">
                            <button type="button" onClick={() => setMilestoneEditor({ milestone: ms })} className="text-[11px] font-bold text-indigo-300 hover:text-indigo-200">Edit</button>
                            <button type="button" onClick={() => handleDeleteMilestone(ms)} className="text-[11px] font-bold text-rose-300 hover:text-rose-200">Delete</button>
                          </div>
                        </div>
                      </div>
                        );
                      })()
                    ))}
                    {activeProject.milestones.length === 0 && <div className="p-8 text-center text-xs text-content-faint font-mono">No milestones yet. Add one to track a project checkpoint.</div>}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: TIME LOGS */}
            {activeDetailTab === 'timelogs' && (
              <div className="space-y-4">
                <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-4">
                  <h3 className="text-xs font-black text-content uppercase tracking-[0.2em] font-mono">
                    Deep Work Logs for {activeProject.title}
                  </h3>

                  {timeEntries.filter(e => e.projectId === activeProject.id).length === 0 ? (
                    <div className="text-center py-6 text-xs text-content-faint font-mono">
                      No focus sessions logged for this project yet. Start a pomodoro timer!
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {timeEntries
                        .filter(e => e.projectId === activeProject.id)
                        .map(entry => (
                          <div
                            key={entry.id}
                            className="p-3.5 rounded-2xl bg-surface-2 border border-line flex items-center justify-between text-xs font-mono"
                          >
                            <div>
                              <div className="font-bold text-white">
                                {entry.notes || 'Focus Session'}
                              </div>
                              <div className="text-[13px] text-content-faint mt-0.5">
                                {new Date(entry.timestamp).toLocaleDateString()} at{' '}
                                {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>

                            <span className="font-mono font-bold text-indigo-400">
                              {Math.round(entry.durationSeconds / 60)} mins
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: DOCS */}
            {activeDetailTab === 'docs' && (
              <DocsTab projectId={activeProject.id} />
            )}

            {/* TAB: INITIAL PROMPT */}
            {activeDetailTab === 'prompt' && (
              <div className="space-y-4">
                <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <h3 className="text-xs font-black text-content uppercase tracking-[0.2em] font-mono">Initial Prompt</h3>
                      <p className="text-xs text-content-faint mt-1">Edit the saved project brief separately from initialization.</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {!isEditingPrompt && (
                        <button
                          type="button"
                          onClick={() => { setPromptDraft(activeProject.initialPrompt || ''); setIsEditingPrompt(true); setPromptSaveError(null); }}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-2 border border-line text-content-muted hover:text-white hover:border-line-strong text-xs font-black transition-all"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit prompt
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { const tool = activeProject.initializationTool || 'opencode'; setLaunchTool(tool); setLaunchModel(activeProject.initializationModel || ''); setToolAvailability(null); setPromptSource('project'); setSelectedPromptTaskId(''); setIsLaunchDialogOpen(true); setPromptCopyError(null); void checkToolAvailability(tool); }}
                        disabled={!activeProject.initialPrompt || isEditingPrompt}
                        title={isEditingPrompt ? 'Save the prompt before starting initialization' : 'Choose a tool and model, then open the project console'}
                        className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-black transition-all disabled:opacity-40 ${
                          copiedPrompt
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                            : 'bg-indigo-500/10 border-indigo-500/25 text-indigo-300 hover:bg-indigo-500/20'
                        }`}
                      >
                        {copiedPrompt ? <Check className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        {copiedPrompt ? 'Prompt copied' : 'Start initialization'}
                      </button>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-line bg-surface-2/50 p-4 space-y-3">
                    <div>
                      <h4 className="text-xs font-black text-content">Initialization defaults</h4>
                      <p className="text-[11px] text-content-faint mt-0.5">Choose the CLI and model used by default. Start initialization can override these once.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-[9rem_1fr_auto] gap-2">
                      <select value={launchTool} onChange={e => { const next = e.target.value as 'opencode' | 'codex'; setLaunchTool(next); setLaunchModel(''); }} className="rounded-xl bg-surface border border-line px-3 py-2 text-xs font-bold text-content">
                        <option value="opencode">OpenCode</option><option value="codex">Codex</option>
                      </select>
                      <input list="project-model-presets" value={launchModel} onChange={e => setLaunchModel(e.target.value)} placeholder={launchTool === 'opencode' ? 'provider/model or model name' : 'model ID or name'} className="rounded-xl bg-surface border border-line px-3 py-2 text-xs font-mono text-content" />
                      <button type="button" onClick={saveInitializationSettings} disabled={!launchModel.trim() || isSavingInitializationSettings} className="rounded-xl bg-surface border border-line px-3 py-2 text-xs font-black text-content-muted hover:text-white disabled:opacity-40">{isSavingInitializationSettings ? 'Saving…' : 'Save default'}</button>
                    </div>
                    <datalist id="project-model-presets">{modelPresets.filter(p => p.enabled).map(p => <option key={p.id} value={p.modelId}>{p.label}</option>)}</datalist>
                    {modelPresets.filter(p => p.enabled).length === 0 && <p className="text-[11px] text-amber-300">No enabled presets for this tool. Type a model ID, then save it as the project default or <button type="button" onClick={() => setCurrentView('settings')} className="underline hover:text-amber-200">manage presets in Settings → Models</button>.</p>}
                  </div>
                  {promptCopyError && <p className="text-xs text-rose-300" role="alert">{promptCopyError}</p>}
                  {initializationStatus && <p className="text-xs text-emerald-300" role="status">{initializationStatus}</p>}
                  {promptSaveError && <p className="text-xs text-rose-300" role="alert">{promptSaveError}</p>}
                  {isEditingPrompt ? (
                    <>
                      <textarea
                        value={promptDraft}
                        onChange={e => setPromptDraft(e.target.value)}
                        rows={18}
                        autoFocus
                        className="w-full resize-y min-h-[20rem] rounded-2xl bg-surface-inverse border border-line focus:border-indigo-500 p-4 text-xs leading-relaxed text-content font-mono outline-none"
                        placeholder="Write the initial project prompt..."
                      />
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <button
                          type="button"
                          onClick={handleClearInitialPrompt}
                          disabled={!activeProject.initialPrompt || isSavingPrompt}
                          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-900/50 text-rose-300 hover:bg-rose-500/10 text-xs font-black disabled:opacity-40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Clear prompt
                        </button>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => { setPromptDraft(activeProject.initialPrompt || ''); setIsEditingPrompt(false); }} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-2 border border-line text-content-muted hover:text-white text-xs font-black">
                            Cancel
                          </button>
                          <button type="button" onClick={handleSaveInitialPrompt} disabled={!promptDraft.trim() || isSavingPrompt} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black disabled:opacity-40">
                            <Check className="w-3.5 h-3.5" />
                            {isSavingPrompt ? 'Saving…' : 'Save prompt'}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : activeProject.initialPrompt ? (
                    <pre className="whitespace-pre-wrap select-text max-h-[32rem] overflow-auto rounded-2xl bg-surface-inverse border border-line p-4 text-xs leading-relaxed text-content font-mono">
                      {activeProject.initialPrompt}
                    </pre>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-line p-8 text-center text-xs text-content-faint font-mono">
                      This project has no saved initial prompt. Use Edit prompt to create one.
                    </div>
                  )}
                </div>
                {isLaunchDialogOpen && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Choose initialization model">
                    <div className="w-full max-w-md rounded-3xl border border-line bg-surface p-5 shadow-2xl space-y-4">
                      <div className="flex items-start justify-between gap-3">
                        <div><h3 className="text-base font-black text-content">Initialize with…</h3><p className="text-xs text-content-faint mt-1">The prompt will be copied, then the selected CLI will open in the project folder.</p></div>
                        <button type="button" onClick={() => setIsLaunchDialogOpen(false)} className="p-1.5 text-content-faint hover:text-white" aria-label="Close"><X className="w-4 h-4" /></button>
                      </div>
                      <label className="block text-xs font-black text-content">Prompt source<select value={promptSource} onChange={e => { const next = e.target.value as 'project' | 'task'; setPromptSource(next); if (next === 'project') setSelectedPromptTaskId(''); }} className="mt-1 w-full rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content"><option value="project">Full project initialization</option><option value="task">Task prompt</option></select></label>
                      {promptSource === 'task' && (() => {
                        const openTasks = tasks.filter(t => t.projectId === activeProject.id && !t.completed);
                        return <label className="block text-xs font-black text-content">Open task<select value={selectedPromptTaskId} onChange={e => setSelectedPromptTaskId(e.target.value)} className="mt-1 w-full rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content"><option value="">Choose a task…</option>{openTasks.map(task => <option key={task.id} value={task.id}>{task.title}{task.subtasks.length ? ` (${task.subtasks.length} steps)` : ''}</option>)}</select>{openTasks.length === 0 && <span className="mt-1 block text-[11px] text-amber-300">There are no open tasks in this project.</span>}</label>;
                      })()}
                      <label className="block text-xs font-black text-content">Tool<select value={launchTool} onChange={e => { const next = e.target.value as 'opencode' | 'codex'; setLaunchTool(next); setLaunchModel(''); setToolAvailability(null); void checkToolAvailability(next); }} className="mt-1 w-full rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content"><option value="opencode">OpenCode</option><option value="codex">Codex</option></select></label>
                      <label className="block text-xs font-black text-content">Model<input list="project-model-presets" value={launchModel} onChange={e => setLaunchModel(e.target.value)} placeholder={launchTool === 'opencode' ? 'provider/model or model name' : 'model ID or name'} className="mt-1 w-full rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-mono text-content" /></label>
                      {isCheckingTool && <p className="text-xs text-content-faint">Checking whether {launchTool === 'codex' ? 'Codex' : 'OpenCode'} is installed…</p>}
                      {!isCheckingTool && toolAvailability && !toolAvailability.available && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2"><p className="text-xs font-bold text-amber-200">{toolAvailability.message || 'This CLI is not installed.'}</p><code className="block rounded-lg bg-black/20 p-2 text-[11px] text-amber-100 break-all">{toolAvailability.install_command}</code><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={async () => { await navigator.clipboard.writeText(toolAvailability.install_command); setInitializationStatus('Install command copied.'); }} className="rounded-lg border border-amber-500/30 px-2.5 py-1.5 text-[11px] font-black text-amber-200">Copy install command</button><button type="button" onClick={installSelectedTool} disabled={!toolAvailability.npm_available || isInstallingTool} className="rounded-lg bg-amber-500/20 px-2.5 py-1.5 text-[11px] font-black text-amber-100 disabled:opacity-40">{isInstallingTool ? 'Installing…' : 'Install in terminal'}</button><button type="button" onClick={() => void checkToolAvailability(launchTool)} disabled={isCheckingTool} className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-black text-content-muted">Check again</button><a href={toolAvailability.documentation_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-black text-indigo-300 hover:text-indigo-200">Docs <ExternalLink className="w-3 h-3" /></a></div>{!toolAvailability.npm_available && <p className="text-[11px] text-rose-300">npm is unavailable. Install Node.js/npm first, then check again.</p>}</div>}
                      <div className="flex items-center justify-end gap-2"><button type="button" onClick={() => setIsLaunchDialogOpen(false)} className="rounded-xl bg-surface-2 border border-line px-3.5 py-2 text-xs font-black text-content-muted">Cancel</button><button type="button" onClick={() => handleStartInitialization(launchTool, launchModel)} disabled={!launchModel.trim() || (promptSource === 'task' && !selectedPromptTaskId)} className="rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-black text-white disabled:opacity-40">Copy & start</button></div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* PROJECTS GRID VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredProjects.map(project => {
            const projTasks = tasks.filter(t => t.projectId === project.id);
            const projDone = projTasks.filter(t => t.completed).length;
            const progressPct = projTasks.length > 0 ? Math.round((projDone / projTasks.length) * 100) : 0;
            const stageInfo = STAGE_CONFIG[project.currentStage];
            const daysRemaining = getDaysRemaining(project.targetDeadline);

            return (
              <div
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                className="p-5 rounded-3xl bg-surface border border-line shadow-xl hover:border-line-strong transition-all cursor-pointer flex flex-col justify-between group"
              >
                <div>
                  {/* Top category & stage tag */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className={`text-[12px] font-black uppercase px-2.5 py-0.5 rounded-md border ${stageInfo.bgLight} ${stageInfo.bgDark}`}>
                      {stageInfo.label}
                    </span>
                    <span className="text-[12px] text-content-faint bg-surface-2 border border-line px-2 py-0.5 rounded-md font-mono font-semibold">
                      {project.category}
                    </span>
                  </div>

                  <div className="flex items-start gap-2.5 mb-2">
                    <div
                      className="w-3.5 h-3.5 rounded-full shrink-0 mt-1 shadow-sm"
                      style={{ backgroundColor: project.color || '#6366f1' }}
                    />
                    <h3 className="text-base font-black text-content group-hover:text-indigo-400 transition-colors flex items-center gap-1.5">
                      {project.title}
                      {project.pinned && <Pin className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                    </h3>
                  </div>

                  <p className="text-xs text-content-faint line-clamp-2 mb-4 leading-relaxed">
                    {project.tagline}
                  </p>

                  {/* Progress Bar */}
                  <div className="space-y-1.5 mb-4 font-mono">
                    <div className="flex items-center justify-between text-[13px]">
                      <span className="font-bold text-content-muted">
                        {projDone}/{projTasks.length} tasks completed
                      </span>
                      <span className="font-bold text-indigo-400">
                        {progressPct}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-surface-3 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Card Footer */}
                <div className="pt-3.5 border-t border-line/80 flex items-center justify-between text-xs text-content-faint font-mono">
                  <div className="flex items-center gap-1.5 text-[13px]">
                    <Calendar className="w-3.5 h-3.5 text-content-faint" />
                    <span className={daysRemaining <= 3 && daysRemaining >= 0 ? 'text-amber-400 font-bold' : daysRemaining < 0 ? 'text-rose-400 font-bold' : ''}>
                      {daysRemaining < 0 ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining}d left`}
                    </span>
                  </div>

                  <span className="text-xs font-black text-indigo-400 group-hover:translate-x-1 transition-transform flex items-center gap-0.5">
                    Open Project →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* In-app terminal consoles (Run Server / CMD) */}
      <TerminalDrawer ref={terminalDrawerRef} projectId={activeProject?.id ?? null} />

      {activeProject && milestoneEditor && (
        <MilestoneEditor
          project={activeProject}
          tasks={tasks.filter(task => task.projectId === activeProject.id)}
          milestone={milestoneEditor.milestone}
          onSave={handleSaveMilestone}
          onClose={() => setMilestoneEditor(null)}
        />
      )}

    </div>
  );
};

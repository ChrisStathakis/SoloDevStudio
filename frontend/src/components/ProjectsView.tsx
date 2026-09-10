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
  GripVertical,
  Pencil,
  ArrowUp,
  ArrowDown,
  RotateCcw,
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
  ClipboardPlus,
  Check,
  ChevronDown,
  Download,
  Copy
} from 'lucide-react';
import { ProjectStage, STAGE_CONFIG, QUADRANT_CONFIG, TASK_CATEGORY_CONFIG, Project, PriorityQuadrant, TaskCategory, LauncherModelPreset } from '../types';
import { api } from '../services/api';
import { downloadPdf } from '../services/pdfDownload';
import { DocsTab } from './DocsTab';
import { StageWorkspaceTab } from './StageWorkspaceTab';
import { PathPickerModal } from './PathPickerModal';
import { TerminalDrawer, TerminalDrawerHandle } from './TerminalDrawer';
import { PageHeader, Button } from './ui';
import { MilestoneEditor } from './MilestoneEditor';
import { ProjectEditor, ProjectDraft } from './ProjectEditor';
import { ProjectStageStepper } from './ProjectStageStepper';
import { ProjectRuntimeErrors } from './ProjectRuntimeErrors';
import { ProjectTasksTab } from './ProjectTasksTab';
import { ProjectPromptTab } from './ProjectPromptTab';
import { useToast } from './Toaster';
import { useConsoleRowLayout, type ConsoleRowId } from '../hooks/useConsoleRowLayout';
import { buildInitializationCommand, CODEX_PLAN_COMMAND, formatBracketedPaste, CODEX_READY_PATTERNS, OPENCODE_READY_PATTERNS, CODEX_TRUST_PATTERNS } from '../services/initialization';
import { getDaysRemaining } from '../utils/dates';

const recoverSavedProjectPrompt = (content: string) => {
  const marker = content.match(/(?:^|\r?\n)## Active project skills(?:\r?\n|$)/);
  if (!marker || marker.index === undefined) return null;
  const recovered = content.slice(0, marker.index).trim();
  return recovered || null;
};

type InitializationSettings = {
  tool: 'opencode' | 'codex';
  modelId: string;
  reasoningEffort: 'low' | 'medium' | 'high';
  mode: 'build' | 'plan';
};

const mapInitializationSettings = (raw: any): InitializationSettings => ({
  tool: raw?.tool === 'codex' ? 'codex' : 'opencode',
  modelId: typeof raw?.model_id === 'string' ? raw.model_id : '',
  reasoningEffort: raw?.reasoning_effort === 'low' || raw?.reasoning_effort === 'high'
    ? raw.reasoning_effort
    : 'medium',
  mode: raw?.mode === 'plan' ? 'plan' : 'build',
});

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
    duplicateProject,
    toggleTaskCompletion,
    updateTask,
    toggleSubtask,
    addSubtask,
    updateSubtask,
    deleteSubtask,
    deleteTask,
    addTask,
    startTimer,
    openQuickAdd,
    setCurrentView,
    searchQuery,
    refreshData,
    reorderProjects
  } = useApp();
  const { toast, confirm } = useToast();

  const [selectedStageFilter, setSelectedStageFilter] = useState<string>('all');
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState<string>('all');
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<'tasks' | 'milestones' | 'timelogs' | 'workspace' | 'docs' | 'prompt'>('tasks');
  const [taskFilterStage, setTaskFilterStage] = useState<string>('all');
  const [taskFilterCategory, setTaskFilterCategory] = useState<string>('all');
  const [newSubtaskTitle, setNewSubtaskTitle] = useState<{ [taskId: string]: string }>({});
  const [editingSubtask, setEditingSubtask] = useState<{ taskId: string; subtaskId: string; title: string } | null>(null);
  const [isEditingProject, setIsEditingProject] = useState<boolean>(false);
  const [isSavingProject, setIsSavingProject] = useState(false);
  const [isCopyingProject, setIsCopyingProject] = useState(false);
  const [copyProjectOpen, setCopyProjectOpen] = useState(false);
  const [copyProjectTitle, setCopyProjectTitle] = useState('');
  const [copyProjectError, setCopyProjectError] = useState<string | null>(null);
  const [projectSaveError, setProjectSaveError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [pdfExportError, setPdfExportError] = useState<string | null>(null);
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
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const setFieldError = (field: string, msg: string) => setActionErrors(prev => ({ ...prev, [field]: msg }));
  const clearFieldError = (field: string) => setActionErrors(prev => {
    if (!(field in prev)) return prev;
    const next = { ...prev };
    delete next[field];
    return next;
  });
  const clearAllActionErrors = () => setActionErrors({});
  // Back-compat helper: legacy single-channel callers map to the folder channel
  const setFolderError = (msg: string | null) => {
    if (msg === null) clearFieldError('folder');
    else setFieldError('folder', msg);
  };
  const folderError = actionErrors.folder ?? null;
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [promptCopyError, setPromptCopyError] = useState<string | null>(null);
  const [promptDraft, setPromptDraft] = useState('');
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);
  const [promptSaveError, setPromptSaveError] = useState<string | null>(null);
  const [initializationStatus, setInitializationStatus] = useState<string | null>(null);
  const [modelPresets, setModelPresets] = useState<LauncherModelPreset[]>([]);
  const [isLaunchDialogOpen, setIsLaunchDialogOpen] = useState(false);
  const [isPromptPreviewOpen, setIsPromptPreviewOpen] = useState(false);
  const [isLoadingPromptPreview, setIsLoadingPromptPreview] = useState(false);
  const [previewedPrompt, setPreviewedPrompt] = useState('');
  const [previewedLineCount, setPreviewedLineCount] = useState(0);
  const [previewedSkillCount, setPreviewedSkillCount] = useState(0);
  const [promptPreviewError, setPromptPreviewError] = useState<string | null>(null);
  const [copiedPreviewPrompt, setCopiedPreviewPrompt] = useState(false);
  const [launchTool, setLaunchTool] = useState<'opencode' | 'codex'>('opencode');
  const [launchModel, setLaunchModel] = useState('');
  const [launchReasoningEffort, setLaunchReasoningEffort] = useState<'low' | 'medium' | 'high'>('medium');
  const [launchMode, setLaunchMode] = useState<'build' | 'plan'>('build');
  const [isSavingInitializationSettings, setIsSavingInitializationSettings] = useState(false);
  const [toolAvailability, setToolAvailability] = useState<{ tool: 'opencode' | 'codex'; available: boolean; npm_available: boolean; install_command: string; documentation_url: string; message?: string } | null>(null);
  const [isCheckingTool, setIsCheckingTool] = useState(false);
  const [isInstallingTool, setIsInstallingTool] = useState(false);
  const [taskPromptStatus, setTaskPromptStatus] = useState<Record<string, 'selected' | undefined>>({});
  const [addingTaskPromptId, setAddingTaskPromptId] = useState<string | null>(null);
  const [addedTaskPromptId, setAddedTaskPromptId] = useState<string | null>(null);
  const [taskPromptError, setTaskPromptError] = useState<string | null>(null);
  const [promptSource, setPromptSource] = useState<'project' | 'task'>('project');
  const [selectedPromptTaskId, setSelectedPromptTaskId] = useState('');
  const [milestoneEditor, setMilestoneEditor] = useState<{ milestone?: Project['milestones'][number] } | null>(null);
  const terminalDrawerRef = useRef<TerminalDrawerHandle | null>(null);

  // Selected project object
  const activeProject = projects.find(p => p.id === selectedProjectId) || null;
  const hasGeneratedSkillContext = Boolean(activeProject?.initialPrompt && /(?:^|\r?\n)## Active project skills(?:\r?\n|$)/.test(activeProject.initialPrompt));

  const handleSaveProject = async (draft: ProjectDraft) => {
    if (!activeProject || isSavingProject) return;
    setIsSavingProject(true);
    setProjectSaveError(null);
    try {
      await updateProject(activeProject.id, draft);
      setIsEditingProject(false);
    } catch (error: any) {
      const detail = error?.response?.data;
      setProjectSaveError(typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : error?.message || 'Unable to save project.');
    } finally {
      setIsSavingProject(false);
    }
  };

  const handleExportPdf = async () => {
    if (!activeProject || isExportingPdf) return;
    setIsExportingPdf(true);
    setPdfExportError(null);
    try {
      await downloadPdf(`/projects/${activeProject.id}/export-pdf/`, `${activeProject.title || 'project'}-project-brief.pdf`);
    } catch (error: any) {
      setPdfExportError(error?.message || 'Unable to export PDF.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleDuplicateProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!activeProject || !copyProjectTitle.trim() || isCopyingProject) return;
    setIsCopyingProject(true);
    setCopyProjectError(null);
    try {
      await duplicateProject(activeProject.id, copyProjectTitle);
      setCopyProjectOpen(false);
      setCopyProjectTitle('');
    } catch (error: any) {
      const detail = error?.response?.data?.error || error?.response?.data?.title || error?.message;
      setCopyProjectError(detail || 'Unable to copy this project.');
    } finally {
      setIsCopyingProject(false);
    }
  };

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
    setIsPromptPreviewOpen(false);
    setIsLoadingPromptPreview(false);
    setPreviewedPrompt('');
    setPreviewedLineCount(0);
    setPreviewedSkillCount(0);
    setPromptPreviewError(null);
    setCopiedPreviewPrompt(false);
    setIsLaunchDialogOpen(false);
    setToolAvailability(null);
    setTaskPromptStatus({});
    setAddingTaskPromptId(null);
    setAddedTaskPromptId(null);
    setTaskPromptError(null);
    setIsEditingProject(false);
    setProjectSaveError(null);
    setPromptSource('project');
    setSelectedPromptTaskId('');
  }, [activeProject?.id]);

  // Keep the launch controls in sync with the saved project defaults even when
  // the project object is refreshed without changing its ID. The detail API is
  // authoritative here because the list response can be stale while a project
  // remains selected.
  useEffect(() => {
    const projectId = activeProject?.id;
    if (!projectId) {
      setLaunchTool('opencode');
      setLaunchModel('');
      setLaunchReasoningEffort('medium');
      setLaunchMode('build');
      return;
    }

    let cancelled = false;
    api.get(`/projects/${projectId}/initialization-settings/`)
      .then(res => {
        if (cancelled) return;
        const settings = mapInitializationSettings(res.data);
        setLaunchTool(settings.tool);
        setLaunchModel(settings.modelId);
        setLaunchReasoningEffort(settings.reasoningEffort);
        setLaunchMode(settings.mode);
      })
      .catch(() => {
        // The project list values remain available as a local fallback. Avoid
        // replacing them with an error state when only this optional refresh
        // request fails.
      });

    return () => {
      cancelled = true;
    };
  }, [
    activeProject?.id,
    activeProject?.initializationTool,
    activeProject?.initializationModel,
    activeProject?.initializationReasoningEffort,
    activeProject?.initializationMode,
  ]);

  // If refreshData replaces the selected project object, immediately reflect
  // those new values while the authoritative detail request is in flight.
  useEffect(() => {
    setLaunchTool(activeProject?.initializationTool || 'opencode');
    setLaunchModel(activeProject?.initializationModel || '');
    setLaunchReasoningEffort(activeProject?.initializationReasoningEffort || 'medium');
    setLaunchMode(activeProject?.initializationMode || 'build');
  }, [
    activeProject?.id,
    activeProject?.initializationTool,
    activeProject?.initializationModel,
    activeProject?.initializationReasoningEffort,
    activeProject?.initializationMode,
  ]);

  useEffect(() => {
    if (!isEditingPrompt) setPromptDraft(activeProject?.initialPrompt || '');
  }, [activeProject?.initialPrompt, isEditingPrompt]);

  useEffect(() => {
    if (!activeProject) return;
    api.get('/launcher-model-presets/', { params: { page_size: 100, tool: launchTool } })
      .then(res => {
        const rows = Array.isArray(res.data) ? res.data : (res.data?.results || []);
        setModelPresets(rows.map((raw: any) => ({ id: String(raw.id), tool: raw.tool === 'codex' ? 'codex' : 'opencode', modelId: raw.model_id || '', reasoningEffort: ['low', 'high'].includes(raw.reasoning_effort) ? raw.reasoning_effort : 'medium', mode: raw.mode === 'plan' ? 'plan' : 'build', label: raw.label || '', enabled: raw.enabled !== false, createdAt: raw.created_at, updatedAt: raw.updated_at })));
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
      setPromptSaveError(error?.response?.data?.content || 'Unable to save the prompt.');
    } finally {
      setIsSavingPrompt(false);
    }
  };

  const handleClearInitialPrompt = () => {
    if (isSavingPrompt) return;
    setPromptDraft('');
    setPromptSaveError(null);
  };

  const openPromptPreview = async () => {
    if (!activeProject || isLoadingPromptPreview) return;
    setIsPromptPreviewOpen(true);
    setIsLoadingPromptPreview(true);
    setPreviewedPrompt('');
    setPromptPreviewError(null);
    setCopiedPreviewPrompt(false);
    try {
      const response = await api.get(`/projects/${activeProject.id}/initialize-prompt/`);
      const content = String(response.data?.content || '').trim();
      if (!content) throw new Error('The generated initialization prompt is empty.');
      setPreviewedPrompt(content);
      setPreviewedLineCount(content.split(/\r?\n/).length);
      setPreviewedSkillCount(Array.isArray(response.data?.active_skills) ? response.data.active_skills.length : 0);
    } catch (error: any) {
      setPromptPreviewError(error?.response?.data?.error || error?.message || 'Unable to load the initialization prompt.');
    } finally {
      setIsLoadingPromptPreview(false);
    }
  };

  const copyPreviewedPrompt = async () => {
    if (!previewedPrompt) return;
    try {
      await navigator.clipboard.writeText(previewedPrompt);
      setCopiedPreviewPrompt(true);
      window.setTimeout(() => setCopiedPreviewPrompt(false), 2200);
    } catch {
      setPromptPreviewError('Unable to copy the initialization prompt.');
    }
  };

  const useTaskPromptForLaunch = (taskId: string) => {
    const tool = activeProject?.initializationTool || 'opencode';
    setPromptSource('task');
    setSelectedPromptTaskId(taskId);
    setLaunchTool(tool);
    setLaunchModel(activeProject?.initializationModel || '');
    setLaunchReasoningEffort(activeProject?.initializationReasoningEffort || 'medium');
    setLaunchMode(activeProject?.initializationMode || 'build');
    setToolAvailability(null);
    setPromptCopyError(null);
    setInitializationStatus('Task prompt selected for this launch. Your saved project prompt was not changed.');
    setTaskPromptStatus(prev => ({ ...prev, [taskId]: 'selected' }));
    setActiveDetailTab('prompt');
    setIsLaunchDialogOpen(true);
    void checkToolAvailability(tool);
    window.setTimeout(() => setTaskPromptStatus(prev => ({ ...prev, [taskId]: undefined })), 2200);
  };

  const addTaskToPrompt = async (taskId: string) => {
    if (addingTaskPromptId === taskId) return;
    setAddingTaskPromptId(taskId);
    setTaskPromptError(null);
    try {
      const response = await api.post(`/tasks/${taskId}/add-to-prompt/`);
      setAddedTaskPromptId(taskId);
      await refreshData();
      setActiveDetailTab('prompt');
      window.setTimeout(() => setAddedTaskPromptId(current => current === taskId ? null : current), 2200);
      if (response.data?.already_added) setInitializationStatus('This task is already included in the saved project prompt.');
    } catch (error: any) {
      setTaskPromptError(error?.response?.data?.error || 'Unable to add this task to the project prompt.');
    } finally {
      setAddingTaskPromptId(null);
    }
  };

  const preparePromptCleanup = () => {
    if (!activeProject || isSavingPrompt) return;
    const recovered = recoverSavedProjectPrompt(activeProject.initialPrompt || '');
    if (!recovered) {
      setPromptSaveError('No generated Active project skills section was found in the saved prompt.');
      return;
    }
    setPromptDraft(recovered);
    setIsEditingPrompt(true);
    setPromptSaveError(null);
    setInitializationStatus('Generated skill context was removed from the editable draft. Review it, then save the prompt if it looks correct.');
  };

  const handleStartInitialization = async (tool: 'opencode' | 'codex', model: string, reasoningEffort: 'low' | 'medium' | 'high', mode: 'build' | 'plan') => {
    if (!activeProject?.initialPrompt) {
      setPromptCopyError('Save a prompt before starting initialization.');
      return;
    }
    const normalizedModel = model.trim();
    if (!normalizedModel) {
      setPromptCopyError('Choose a model before starting initialization.');
      return;
    }
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9 ._:/-]*[A-Za-z0-9])?$/.test(normalizedModel)) {
      setPromptCopyError('Model IDs or names may contain only letters, numbers, spaces, ., _, :, /, and -.');
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
      const prompt = String(res.data?.content || (promptSource === 'project' ? activeProject.initialPrompt : '')).trim();
      if (!prompt) throw new Error('The selected initialization prompt is empty.');
      await navigator.clipboard.writeText(prompt);
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
        const session = await drawer.create('cmd', { forceNew: true });
        const initialRevision = await drawer.waitForOutputIdle(session.id);
        const appName = tool === 'codex' ? 'Codex' : 'OpenCode';
        const readyPatterns = tool === 'codex' ? CODEX_READY_PATTERNS : OPENCODE_READY_PATTERNS;
        setInitializationStatus(`Starting ${appName} — watching for its composer…`);
        await drawer.sendInput(`${buildInitializationCommand({ tool, model: normalizedModel, reasoningEffort, mode })}\r`, session.id);
        // The app may stop at an interactive trust gate first. Never
        // auto-accept it: a prompt dumped into stdin too early is exactly
        // what made Codex abort with "timed out discarding buffered
        // terminal input", spilling the prompt into the shell.
        const marker = await drawer.waitForOutputMarker(session.id, {
          afterRevision: initialRevision,
          ready: readyPatterns,
          blocked: tool === 'codex' ? CODEX_TRUST_PATTERNS : [],
          timeoutMs: 90000,
        });
        if (marker === 'blocked') {
          setInitializationStatus(`${appName} is asking for trust — press Enter in the console, then the prompt pastes automatically.`);
          await drawer.waitForOutputMarker(session.id, {
            ready: readyPatterns,
            timeoutMs: 180000,
          });
        }
        if (tool === 'codex' && mode === 'plan') {
          await drawer.sendInput(`${CODEX_PLAN_COMMAND}\r`, session.id);
          await drawer.waitForOutputMarker(session.id, { ready: readyPatterns, timeoutMs: 60000 });
        }
        setInitializationStatus(`Pasting the prompt into ${appName}…`);
        await drawer.sendPastedText(formatBracketedPaste(prompt), session.id);
        setInitializationStatus(`${appName} is ready with ${normalizedModel} (${reasoningEffort}, ${mode}). The prompt is prepared in the composer; review it and press Enter.`);
      } catch (error: any) {
        const detail = error?.response?.data?.error || 'Set a CMD folder for this project to open its console.';
        setIsLaunchDialogOpen(true);
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
    const ok = await confirm({
      title: `Install ${toolAvailability.tool === 'codex' ? 'Codex' : 'OpenCode'} in the project terminal?`,
      description: `Runs: ${toolAvailability.install_command}`,
      confirmLabel: 'Install',
    });
    if (!ok) return;
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
      const response = await api.patch(`/projects/${activeProject.id}/initialization-settings/`, { tool: launchTool, model_id: launchModel.trim(), reasoning_effort: launchReasoningEffort, mode: launchMode });
      const settings = mapInitializationSettings(response.data);
      setLaunchTool(settings.tool);
      setLaunchModel(settings.modelId);
      setLaunchReasoningEffort(settings.reasoningEffort);
      setLaunchMode(settings.mode);
      await refreshData();
      setInitializationStatus('Project initialization defaults saved.');
    } catch (error: any) {
      setPromptCopyError(error?.response?.data?.model_id?.[0] || error?.response?.data?.initialization_mode?.[0] || error?.response?.data?.mode?.[0] || error?.response?.data?.detail || 'Unable to save initialization defaults.');
    } finally {
      setIsSavingInitializationSettings(false);
    }
  };

  const applyLauncherPreset = (presetId: string) => {
    const preset = modelPresets.find(item => item.id === presetId);
    if (!preset) return;
    setLaunchModel(preset.modelId);
    setLaunchReasoningEffort(preset.reasoningEffort);
    setLaunchMode(preset.mode);
  };

  // Apply the existing search/category filters first, then separate completed
  // projects so they can live in their own section at the bottom.
  const matchesProjectFilters = (p: Project) => {
    const matchesCategory = selectedCategoryFilter === 'all' || p.category === selectedCategoryFilter;
    const matchesSearch = !searchQuery || 
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.techStack.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  };

  const activeProjects = projects.filter(p =>
    p.currentStage !== 'live' &&
    (selectedStageFilter === 'all' || p.currentStage === selectedStageFilter) &&
    matchesProjectFilters(p),
  );
  const completedProjects = (selectedStageFilter === 'all' || selectedStageFilter === 'live')
    ? projects.filter(p => p.currentStage === 'live' && matchesProjectFilters(p))
    : [];

  // Manual ordering (shared with the homepage pipeline, persisted via POST /projects/reorder/).
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const persistProjectOrder = async (newActiveIds: string[]) => {
    const liveIds = projects.filter(p => p.currentStage === 'live').map(p => p.id);
    setIsReordering(true);
    try {
      await reorderProjects([...newActiveIds, ...liveIds]);
    } catch {
      toast({ title: 'Could not save the new order', tone: 'error' });
    } finally {
      setIsReordering(false);
    }
  };
  const dropProjectOn = (targetId: string) => {
    if (!dragId || dragId === targetId || isReordering) return;
    // Map the drop position within the filtered view back onto the full active order.
    const fullIds = activeProjects.map(p => p.id);
    const from = fullIds.indexOf(dragId);
    let to = fullIds.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const [moved] = fullIds.splice(from, 1);
    to = fullIds.indexOf(targetId);
    fullIds.splice(to, 0, moved);
    setDragId(null);
    setOverId(null);
    void persistProjectOrder(fullIds);
  };
  const handleTogglePin = async (project: Project) => {
    if (project.pinned) {
      await updateProject(project.id, { pinned: false });
      return;
    }
    // Pinning moves the project to the top of the manual order.
    await updateProject(project.id, { pinned: true });
    const ids = [project.id, ...activeProjects.filter(p => p.id !== project.id).map(p => p.id)];
    await persistProjectOrder(ids);
  };

  const renderProjectCard = (project: Project) => {
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
          <div className="flex items-center justify-between gap-2 mb-3">
            <span className={`text-[12px] font-black uppercase px-2.5 py-0.5 rounded-md border ${stageInfo.bgLight} ${stageInfo.bgDark}`}>
              {stageInfo.label}
            </span>
            <span className="text-[12px] text-content-faint bg-surface-2 border border-line px-2 py-0.5 rounded-md font-mono font-semibold">
              {project.category}
            </span>
          </div>

          <div className="flex items-start gap-2.5 mb-2">
            <div className="w-3.5 h-3.5 rounded-full shrink-0 mt-1 shadow-sm" style={{ backgroundColor: project.color || '#6366f1' }} />
            <h3 className="text-base font-black text-content group-hover:text-indigo-400 transition-colors flex items-center gap-1.5">
              {project.title}
              {project.pinned && <Pin className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />}
            </h3>
          </div>

          <p className="text-xs text-content-faint line-clamp-2 mb-4 leading-relaxed">{project.tagline}</p>

          <div className="space-y-1.5 mb-4 font-mono">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-bold text-content-muted">{projDone}/{projTasks.length} tasks completed</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400">{progressPct}%</span>
            </div>
            <div className="w-full h-1.5 bg-surface-3 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
            </div>
          </div>
        </div>

        <div className="pt-3.5 border-t border-line/80 flex items-center justify-between text-xs text-content-faint font-mono">
          <div className="flex items-center gap-1.5 text-[13px]">
            <Calendar className="w-3.5 h-3.5 text-content-faint" />
            <span className={daysRemaining <= 3 && daysRemaining >= 0 ? 'text-amber-600 dark:text-amber-400 font-bold' : daysRemaining < 0 ? 'text-rose-600 dark:text-rose-400 font-bold' : ''}>
              {daysRemaining < 0 ? `${Math.abs(daysRemaining)}d overdue` : `${daysRemaining}d left`}
            </span>
          </div>
          <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 group-hover:translate-x-1 transition-transform flex items-center gap-0.5">Open Project →</span>
        </div>
      </div>
    );
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
    const ok = await confirm({
      title: `Delete milestone "${milestone.title}"?`,
      description: 'Linked tasks will remain.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMilestone(milestone.id);
      clearFieldError('milestone');
    } catch (e: any) {
      showActionError(e?.response?.data?.detail || e?.message || 'Failed to delete milestone.', 'milestone');
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

  const showActionError = (msg: string, field = 'general') => {
    setFieldError(field, msg);
  };

  const handleRunScript = async () => {
    if (!activeProject) return;
    if (!activeProject.scriptPath) {
      setScriptPathDraft('');
      setIsEditingScriptPath(true);
      return;
    }
    setIsRunningScript(true);
    clearFieldError('script');
    try {
      const drawer = terminalDrawerRef.current;
      if (!drawer) throw new Error('Terminal console is still loading. Please try again in a moment.');
      await drawer.create('script');
    } catch (e: any) {
      showActionError(e?.response?.data?.error || e?.message || 'Failed to run script.', 'script');
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
    clearFieldError('cmd');
    try {
      const drawer = terminalDrawerRef.current;
      if (!drawer) throw new Error('Terminal console is still loading. Please try again in a moment.');
      await drawer.create('cmd');
    } catch (e: any) {
      showActionError(e?.response?.data?.error || e?.message || 'Failed to open cmd.', 'cmd');
    } finally {
      setIsOpeningCmd(false);
    }
  };

  const handleMinimizeCmd = () => {
    const drawer = terminalDrawerRef.current;
    if (!drawer) {
      showActionError('Terminal console is still loading. Please try again in a moment.', 'terminal');
      return;
    }
    drawer.minimize();
  };

  const handleSaveScriptPath = async () => {
    if (!activeProject) return;
    if (isSavingScriptPath) return;
    const path = scriptPathDraft.trim();
    setIsSavingScriptPath(true);
    clearFieldError('script');
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
      setFieldError('script', detail ? `Failed to save script path: ${detail}` : 'Failed to save script path.');
    } finally {
      setIsSavingScriptPath(false);
    }
  };

  const handleSavePort = async () => {
    if (!activeProject) return;
    try {
      await updateProject(activeProject.id, { port: portDraft.trim() });
      clearFieldError('port');
    } catch {
      showActionError('Failed to save port / run args.', 'port');
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
      clearFieldError('folder');
      return;
    }
    if (field === 'scriptPath') {
      setScriptPathDraft(path);
      setIsEditingScriptPath(true);
      clearFieldError('script');
      return;
    }
    if (field === 'cmdDirectory') {
      setCmdDirDraft(path);
      setIsEditingCmdDir(true);
      clearFieldError('cmd');
      return;
    }
    try {
      await updateProject(activeProject.id, { [field]: path });
      clearFieldError(field === 'pythonEnv' ? 'pythonEnv' : 'general');
    } catch {
      showActionError(`Failed to save ${field}.`, field === 'pythonEnv' ? 'pythonEnv' : 'general');
    }
  };

    const handleSaveCmdDir = async () => {
      if (!activeProject) return;
      try {
        await updateProject(activeProject.id, { cmdDirectory: cmdDirDraft.trim() });
        clearFieldError('cmd');
        try {
          const drawer = terminalDrawerRef.current;
          if (!drawer) throw new Error('Terminal console is still loading. Please try again in a moment.');
          await drawer.restartIfRunning('cmd');
        } catch (e: any) {
          const detail = e?.response?.data?.error || e?.message;
          showActionError(detail ? `CMD directory saved, but console restart failed: ${detail}` : 'CMD directory saved, but the console could not be restarted.', 'cmd');
        }
      } catch {
        showActionError('Failed to save CMD directory.', 'cmd');
      } finally {
        setIsEditingCmdDir(false);
      }
    };

    const handleSavePythonEnv = async () => {
      if (!activeProject) return;
      try {
        await updateProject(activeProject.id, { pythonEnv: pythonEnvDraft.trim() });
        clearFieldError('pythonEnv');
      } catch {
        showActionError('Failed to save Python environment.', 'pythonEnv');
      } finally {
        setIsEditingPythonEnv(false);
      }
    };

    const handleChangeDrive = async (drive: string) => {
      if (!activeProject) return;
      try {
        await updateProject(activeProject.id, { drive });
        clearFieldError('drive');
      } catch {
        showActionError('Failed to update drive.', 'drive');
      }
    };

  // Console / path row layout: per-project order + custom labels (move + rename).
  const consoleLayout = useConsoleRowLayout(activeProject?.id ?? null);
  const [dragRowId, setDragRowId] = useState<ConsoleRowId | null>(null);
  const [overRowId, setOverRowId] = useState<ConsoleRowId | null>(null);
  const [renamingRowId, setRenamingRowId] = useState<ConsoleRowId | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  // Reset drag/rename UI when switching projects.
  useEffect(() => {
    setDragRowId(null);
    setOverRowId(null);
    setRenamingRowId(null);
    setRenameDraft('');
  }, [activeProject?.id]);
  const startRenameRow = (id: ConsoleRowId) => {
    setRenamingRowId(id);
    setRenameDraft(consoleLayout.displayLabel(id));
  };
  const saveRenameRow = () => {
    if (!renamingRowId) return;
    consoleLayout.rename(renamingRowId, renameDraft);
    setRenamingRowId(null);
    setRenameDraft('');
  };
  const dropRowOn = (targetId: ConsoleRowId) => {
    if (!dragRowId || dragRowId === targetId) return;
    consoleLayout.moveTo(dragRowId, targetId);
    setDragRowId(null);
    setOverRowId(null);
  };
  // Body of each console/path row (value editors). Returns null when the row
  // has no value and is not being edited — same visibility as before.
  const renderConsoleRowBody = (rowId: ConsoleRowId): React.ReactNode => {
    if (!activeProject) return null;
    switch (rowId) {
      case 'folder':
        if (isEditingDirPath) {
          return (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveDirPath();
              }}
            >
              <FolderOpen className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
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
                className="p-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-content transition-colors"
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
          );
        }
        if (!activeProject.directoryPath) return null;
        return (
          <div className="flex items-center gap-2">
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
        );
      case 'script':
        if (isEditingScriptPath) {
          return (
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveScriptPath();
              }}
            >
              <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
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
                className="p-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-content transition-colors"
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
          );
        }
        if (!activeProject.scriptPath) return null;
        return (
          <div className="flex items-center gap-2">
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
        );
      case 'port':
        if (isEditingPort) {
          return (
            <div className="flex flex-wrap items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
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
                className="p-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-content transition-colors"
                title="Cancel"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-2">
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
        );
      case 'cmd':
        if (isEditingCmdDir) {
          return (
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
                className="p-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-content transition-colors"
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
          );
        }
        if (!activeProject.cmdDirectory) return null;
        return (
          <div className="flex items-center gap-2">
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
        );
      case 'pythonEnv':
        if (isEditingPythonEnv) {
          return (
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
                className="p-2 rounded-xl bg-surface-2 border border-line text-content-faint hover:text-content transition-colors"
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
          );
        }
        if (!activeProject.pythonEnv) {
          return (
            <button
              type="button"
              onClick={() => {
                setPythonEnvDraft('');
                setIsEditingPythonEnv(true);
              }}
              className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wider text-slate-600 hover:text-indigo-400 transition-colors"
            >
              <Boxes className="w-3.5 h-3.5" />
              Set Python Environment
            </button>
          );
        }
        return (
          <div className="flex items-center gap-2">
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
        );
      case 'drive':
        return (
          <div className="flex items-center gap-2">
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
        );
      default:
        return null;
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
              : 'bg-surface-2 border border-line text-content-faint hover:text-content hover:border-line-strong'
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
                  : 'bg-surface-2 border border-line text-content-faint hover:text-content hover:border-line-strong'
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
              className="text-xs font-black text-indigo-600 dark:text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5 transition-colors font-mono tracking-wide"
            >
              <span>← Back to All Projects</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleExportPdf()}
                disabled={isExportingPdf}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-2 border border-line text-content-muted hover:text-content hover:border-indigo-500/60 text-xs font-black transition-colors disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5" />
                {isExportingPdf ? 'Exporting…' : 'Export PDF'}
              </button>
              <button
                type="button"
                onClick={() => { setProjectSaveError(null); setIsEditingProject(true); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-2 border border-line text-content-muted hover:text-content hover:border-indigo-500/60 text-xs font-black transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Edit Project
              </button>
              <button
                type="button"
                onClick={() => { setCopyProjectTitle(`${activeProject.title} Copy`); setCopyProjectError(null); setCopyProjectOpen(true); }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-surface-2 border border-line text-content-muted hover:text-content hover:border-indigo-500/60 text-xs font-black transition-colors"
                title="Copy Project"
              >
                <Copy className="w-3.5 h-3.5" />
                Copy Project
              </button>
              <button
                type="button"
                onClick={() => void handleTogglePin(activeProject)}
                className="p-2 text-content-faint hover:text-content rounded-xl bg-surface-2 border border-line hover:border-line-strong transition-colors"
                title={activeProject.pinned ? 'Unpin' : 'Pin to top'}
              >
                {activeProject.pinned ? <PinOff className="w-4 h-4 text-amber-600 dark:text-amber-400" /> : <Pin className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={() => void (async () => {
                  const ok = await confirm({
                    title: `Delete project "${activeProject.title}"?`,
                    description: 'The project, its tasks, and milestones will be removed. This cannot be undone.',
                    confirmLabel: 'Delete project',
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    await deleteProject(activeProject.id);
                    toast({ title: `Deleted "${activeProject.title}"`, tone: 'success' });
                  } catch {
                    toast({ title: 'Could not delete project', tone: 'error' });
                  }
                })()}
                className="p-2 text-rose-600 dark:text-rose-400 hover:text-rose-300 rounded-xl bg-surface-2 border border-line hover:border-rose-800 transition-colors"
                title="Delete Project"
                aria-label={`Delete project ${activeProject.title}`}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {pdfExportError && <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">{pdfExportError}</p>}

          {isEditingProject ? (
            <ProjectEditor
              project={activeProject}
              saving={isSavingProject}
              error={projectSaveError}
              onSave={handleSaveProject}
              onCancel={() => { setProjectSaveError(null); setIsEditingProject(false); }}
            />
          ) : <>
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
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-500/20 transition-colors"
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
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 text-xs font-bold hover:bg-purple-500/20 transition-colors"
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
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
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

                        {/* Project runtime errors - per field, persistent until dismissed */}
            <ProjectRuntimeErrors errors={actionErrors} onDismiss={clearFieldError} onDismissAll={clearAllActionErrors} />
            {/* Console / path rows — order + labels are customizable per project (move + rename). */}
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={consoleLayout.reset}
                className="flex items-center gap-1 text-[12px] font-black uppercase tracking-wider text-slate-600 hover:text-indigo-400 transition-colors"
                title="Reset row order and names to defaults"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Reset rows
              </button>
            </div>
            {consoleLayout.order.map((rowId, idx) => {
              const body = renderConsoleRowBody(rowId);
              if (!body) return null;
              const label = consoleLayout.displayLabel(rowId);
              const isRenaming = renamingRowId === rowId;
              const isDragOver = overRowId === rowId && dragRowId !== rowId;
              return (
                <div
                  key={rowId}
                  draggable={renamingRowId !== rowId}
                  onDragStart={() => setDragRowId(rowId)}
                  onDragEnd={() => { setDragRowId(null); setOverRowId(null); }}
                  onDragOver={(e) => { e.preventDefault(); setOverRowId(rowId); }}
                  onDrop={() => dropRowOn(rowId)}
                  className={`group/row flex items-start gap-2 rounded-xl border px-2 py-1.5 transition-colors ${isDragOver ? 'border-indigo-500 bg-indigo-500/5' : 'border-transparent hover:border-line hover:bg-surface-2/50'} ${dragRowId === rowId ? 'opacity-50' : ''}`}
                >
                  <span
                    className="mt-1 cursor-grab active:cursor-grabbing text-content-faint hover:text-content shrink-0"
                    title="Drag to reorder"
                  >
                    <GripVertical className="w-4 h-4" />
                  </span>
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {isRenaming ? (
                        <span className="flex items-center gap-1.5 flex-1 min-w-0">
                          <input
                            type="text"
                            autoFocus
                            value={renameDraft}
                            maxLength={60}
                            onChange={e => setRenameDraft(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveRenameRow();
                              if (e.key === 'Escape') { setRenamingRowId(null); setRenameDraft(''); }
                            }}
                            aria-label={`Rename ${label} row`}
                            placeholder="Row name"
                            className="min-w-0 flex-1 px-2 py-0.5 bg-surface-2 border border-indigo-500 rounded-lg text-[12px] font-black uppercase tracking-wider text-content outline-none"
                          />
                          <button
                            type="button"
                            onClick={saveRenameRow}
                            className="p-1 rounded-lg text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                            title="Save name"
                            aria-label={`Save name for ${label} row`}
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => { setRenamingRowId(null); setRenameDraft(''); }}
                            className="p-1 rounded-lg text-content-faint hover:text-content transition-colors"
                            title="Cancel rename"
                            aria-label={`Cancel rename for ${label} row`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ) : (
                        <>
                          <span className="text-[12px] font-black uppercase tracking-wider text-content-faint truncate" title={label}>
                            {label}
                          </span>
                          <button
                            type="button"
                            onClick={() => startRenameRow(rowId)}
                            className="p-0.5 rounded text-slate-600 hover:text-indigo-400 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 transition-opacity shrink-0"
                            title={`Rename ${label}`}
                            aria-label={`Rename ${label} row`}
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                        </>
                      )}
                      <span className="flex-1" />
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => consoleLayout.move(rowId, 'up')}
                        className="p-0.5 rounded text-content-faint hover:text-indigo-400 disabled:opacity-20 transition-all shrink-0"
                        title={`Move ${label} up`}
                        aria-label={`Move ${label} up`}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === consoleLayout.order.length - 1}
                        onClick={() => consoleLayout.move(rowId, 'down')}
                        className="p-0.5 rounded text-content-faint hover:text-indigo-400 disabled:opacity-20 transition-all shrink-0"
                        title={`Move ${label} down`}
                        aria-label={`Move ${label} down`}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {body}
                  </div>
                </div>
              );
            })}

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

              <ProjectStageStepper project={activeProject} onAdvance={(stg) => void (async () => {
                const isBackward = STAGE_CONFIG[stg].order < STAGE_CONFIG[activeProject.currentStage].order;
                if (isBackward) {
                  const ok = await confirm({
                    title: `Move back to ${STAGE_CONFIG[stg].label}?`,
                    description: `Progress in later stages is kept, but focus for "${activeProject.title}" shifts back.`,
                    confirmLabel: 'Move back',
                  });
                  if (!ok) return;
                }
                try {
                  await advanceProjectStage(activeProject.id, stg);
                } catch {
                  toast({ title: 'Could not change stage', tone: 'error' });
                }
              })()} />
            </div>

            {/* Target Deadline & Tech Stack */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-line/80 text-xs font-mono">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5 text-content-muted">
                  <Calendar className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span className="font-bold">Target Launch:</span>
                  <span>{activeProject.targetDeadline}</span>
                  <span className="text-[13px] px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-bold">
                    {getDaysRemaining(activeProject.targetDeadline)}d left
                  </span>
                </div>

                <div className="flex items-center gap-1.5 text-content-muted">
                  <Clock className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-bold">Time Logged:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-bold">
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

          {(activeProject.problem || activeProject.solution || activeProject.targetAudience || activeProject.monetization || activeProject.mvpFeatures?.length || activeProject.tags?.length) && (
            <div className="p-6 rounded-3xl bg-surface border border-line shadow-xl space-y-5">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <h3 className="text-xs font-black text-content uppercase tracking-[0.2em] font-mono">Spark Details</h3>
              </div>

              {(activeProject.problem || activeProject.solution) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeProject.problem && (
                    <div className="p-4 rounded-2xl bg-surface-2 border border-line">
                      <div className="text-[11px] font-black uppercase tracking-wider text-rose-600 dark:text-rose-400 mb-2">The Problem</div>
                      <p className="text-sm text-content-muted whitespace-pre-line leading-relaxed">{activeProject.problem}</p>
                    </div>
                  )}
                  {activeProject.solution && (
                    <div className="p-4 rounded-2xl bg-surface-2 border border-line">
                      <div className="text-[11px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-2">The Solution</div>
                      <p className="text-sm text-content-muted whitespace-pre-line leading-relaxed">{activeProject.solution}</p>
                    </div>
                  )}
                </div>
              )}

              {(activeProject.targetAudience || activeProject.monetization) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeProject.targetAudience && (
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400 mb-1.5">Target Audience</div>
                      <p className="text-sm text-content-muted">{activeProject.targetAudience}</p>
                    </div>
                  )}
                  {activeProject.monetization && (
                    <div>
                      <div className="text-[11px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1.5">Monetization</div>
                      <p className="text-sm text-content-muted">{activeProject.monetization}</p>
                    </div>
                  )}
                </div>
              )}

              {activeProject.mvpFeatures && activeProject.mvpFeatures.length > 0 && (
                <div>
                  <div className="text-[11px] font-black uppercase tracking-wider text-blue-400 mb-2">MVP Features</div>
                  <div className="flex flex-wrap gap-2">
                    {activeProject.mvpFeatures.map((feature, index) => (
                      <span key={`${feature}-${index}`} className="px-2.5 py-1.5 rounded-lg bg-surface-2 border border-line text-xs text-content-muted">{feature}</span>
                    ))}
                  </div>
                </div>
              )}

              {activeProject.tags && activeProject.tags.length > 0 && (
                <div>
                  <div className="text-[11px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400 mb-2">Tags</div>
                  <div className="flex flex-wrap gap-2">
                    {activeProject.tags.map(tag => (
                      <span key={tag} className="px-2.5 py-1 rounded-lg bg-surface-2 border border-line text-xs text-content-muted">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          </>}

          {/* Project Sub-Tabs: Tasks, Milestones, Time Logs */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-line">
              <button
                type="button"
                id="btn-tab-tasks"
                onClick={() => setActiveDetailTab('tasks')}
                className={`pb-3 px-3.5 text-xs font-black border-b-2 transition-all font-mono ${
                  activeDetailTab === 'tasks'
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-content-faint hover:text-content'
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
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-content-faint hover:text-content'
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
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-content-faint hover:text-content'
                }`}
              >
                Time Sessions ({timeEntries.filter(e => e.projectId === activeProject.id).length})
              </button>

              <button
                type="button"
                id="btn-tab-workspace"
                onClick={() => setActiveDetailTab('workspace')}
                className={`flex items-center gap-1.5 pb-3 px-3.5 text-xs font-black border-b-2 transition-all font-mono ${
                  activeDetailTab === 'workspace'
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-content-faint hover:text-content'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Stage Workspace
              </button>

              <button
                type="button"
                id="btn-tab-docs"
                onClick={() => setActiveDetailTab('docs')}
                className={`flex items-center gap-1.5 pb-3 px-3.5 text-xs font-black border-b-2 transition-all font-mono ${
                  activeDetailTab === 'docs'
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-content-faint hover:text-content'
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
                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                    : 'border-transparent text-content-faint hover:text-content'
                }`}
              >
                <Clipboard className="w-3.5 h-3.5" />
                Prompt
              </button>
            </div>

            {/* TAB: TASKS */}
            {activeDetailTab === 'tasks' && (
              <ProjectTasksTab
                project={activeProject}
                tasks={tasks}
                taskFilterStage={taskFilterStage}
                setTaskFilterStage={setTaskFilterStage}
                taskFilterCategory={taskFilterCategory}
                setTaskFilterCategory={setTaskFilterCategory}
                newSubtaskTitle={newSubtaskTitle}
                setNewSubtaskTitle={setNewSubtaskTitle}
                editingSubtask={editingSubtask}
                setEditingSubtask={setEditingSubtask}
                taskPromptError={taskPromptError}
                taskPromptStatus={taskPromptStatus}
                addingTaskPromptId={addingTaskPromptId}
                addedTaskPromptId={addedTaskPromptId}
                toggleTaskCompletion={toggleTaskCompletion}
                toggleSubtask={toggleSubtask}
                addSubtask={addSubtask}
                updateSubtask={updateSubtask}
                deleteSubtask={deleteSubtask}
                updateTask={updateTask}
                deleteTask={deleteTask}
                addTask={addTask}
                startTimer={startTimer}
                openQuickAdd={openQuickAdd}
                setCurrentView={setCurrentView}
                useTaskPromptForLaunch={useTaskPromptForLaunch}
                addTaskToPrompt={addTaskToPrompt}
                toast={toast}
                confirm={confirm}
              />
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
                              <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <div className="w-5 h-5 rounded-lg border-2 border-line-strong bg-surface-2" />
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
                          <span className="text-[12px] text-indigo-600 dark:text-indigo-400 font-bold">
                            {STAGE_CONFIG[ms.stage]?.label}
                          </span>
                          <div className="flex items-center justify-end gap-2 mt-2">
                            <button type="button" onClick={() => setMilestoneEditor({ milestone: ms })} className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 hover:text-indigo-200">Edit</button>
                            <button type="button" onClick={() => handleDeleteMilestone(ms)} className="text-[11px] font-bold text-rose-700 dark:text-rose-300 hover:text-rose-200">Delete</button>
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
                              <div className="font-bold text-content">
                                {entry.notes || 'Focus Session'}
                              </div>
                              <div className="text-[13px] text-content-faint mt-0.5">
                                {new Date(entry.timestamp).toLocaleDateString()} at{' '}
                                {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>

                            <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
                              {Math.round(entry.durationSeconds / 60)} mins
                            </span>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB: STAGE WORKSPACE */}
            {activeDetailTab === 'workspace' && (
              <StageWorkspaceTab project={activeProject} tasks={tasks} timeEntries={timeEntries} />
            )}

            {/* TAB: DOCS */}
            {activeDetailTab === 'docs' && (
              <DocsTab projectId={activeProject.id} onPromptAdded={() => setActiveDetailTab('prompt')} />
            )}

            {/* TAB: PROMPT */}
            {activeDetailTab === 'prompt' && (
              <ProjectPromptTab
                project={activeProject}
                tasks={tasks}
                isEditingPrompt={isEditingPrompt}
                promptDraft={promptDraft}
                promptSaveError={promptSaveError}
                promptCopyError={promptCopyError}
                initializationStatus={initializationStatus}
                copiedPrompt={copiedPrompt}
                hasGeneratedSkillContext={hasGeneratedSkillContext}
                launchTool={launchTool}
                launchModel={launchModel}
                launchReasoningEffort={launchReasoningEffort}
                launchMode={launchMode}
                modelPresets={modelPresets}
                isSavingInitializationSettings={isSavingInitializationSettings}
                isLaunchDialogOpen={isLaunchDialogOpen}
                promptSource={promptSource}
                selectedPromptTaskId={selectedPromptTaskId}
                toolAvailability={toolAvailability}
                isCheckingTool={isCheckingTool}
                isInstallingTool={isInstallingTool}
                isLoadingPromptPreview={isLoadingPromptPreview}
                isPromptPreviewOpen={isPromptPreviewOpen}
                previewedPrompt={previewedPrompt}
                previewedLineCount={previewedLineCount}
                previewedSkillCount={previewedSkillCount}
                promptPreviewError={promptPreviewError}
                copiedPreviewPrompt={copiedPreviewPrompt}
                isSavingPrompt={isSavingPrompt}
                setPromptDraft={setPromptDraft}
                setIsEditingPrompt={setIsEditingPrompt}
                setPromptSaveError={setPromptSaveError}
                setLaunchTool={setLaunchTool}
                setLaunchModel={setLaunchModel}
                setLaunchReasoningEffort={setLaunchReasoningEffort}
                setLaunchMode={setLaunchMode}
                setIsLaunchDialogOpen={setIsLaunchDialogOpen}
                setPromptSource={setPromptSource}
                setSelectedPromptTaskId={setSelectedPromptTaskId}
                setToolAvailability={setToolAvailability}
                setIsPromptPreviewOpen={setIsPromptPreviewOpen}
                setInitializationStatus={setInitializationStatus}
                setCurrentView={setCurrentView}
                preparePromptCleanup={preparePromptCleanup}
                openPromptPreview={openPromptPreview}
                applyLauncherPreset={applyLauncherPreset}
                saveInitializationSettings={saveInitializationSettings}
                handleClearInitialPrompt={handleClearInitialPrompt}
                handleSaveInitialPrompt={handleSaveInitialPrompt}
                checkToolAvailability={checkToolAvailability}
                installSelectedTool={installSelectedTool}
                handleStartInitialization={handleStartInitialization}
                copyPreviewedPrompt={copyPreviewedPrompt}
              />
            )}
          </div>
        </div>
      ) : (
        /* PROJECTS GRID VIEW */
        <div className="space-y-8">
          {activeProjects.length > 0 ? (
            <div className="space-y-3">
              {activeProjects.length > 1 && (
                <p className="text-[11px] font-mono text-content-faint">
                  Drag cards to reorder{isReordering ? '… saving' : ''} — same order as the homepage pipeline.
                </p>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {activeProjects.map(project => (
                  <div
                    key={project.id}
                    className={`relative rounded-3xl transition-all ${overId === project.id ? 'ring-2 ring-indigo-500/60 -translate-y-0.5' : ''} ${dragId === project.id ? 'opacity-50' : ''}`}
                    onDragOver={(e) => {
                      if (!dragId || dragId === project.id) return;
                      e.preventDefault();
                      setOverId(project.id);
                    }}
                    onDragLeave={() => {
                      if (overId === project.id) setOverId(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      dropProjectOn(project.id);
                    }}
                  >
                    {renderProjectCard(project)}
                    {activeProjects.length > 1 && (
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={`Drag to reorder ${project.title}`}
                        title="Drag to reorder"
                        draggable
                        onClick={(e) => e.stopPropagation()}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', project.id);
                          setDragId(project.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOverId(null);
                        }}
                        className="absolute -top-2.5 left-1/2 -translate-x-1/2 p-1.5 rounded-full bg-surface-2 border border-line text-content-faint hover:text-indigo-400 hover:border-indigo-500/60 cursor-grab active:cursor-grabbing touch-none shadow-md"
                      >
                        <GripVertical className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : selectedStageFilter !== 'live' ? (
            <div className="rounded-3xl border border-dashed border-line bg-surface/50 px-6 py-12 text-center">
              <p className="text-sm font-black text-content-faint">No active projects match these filters.</p>
              <p className="mt-1 text-xs text-content-faint">Create a project or adjust the stage, category, or search filters.</p>
            </div>
          ) : null}

          {completedProjects.length > 0 && (
            <section className="rounded-3xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 sm:p-5">
              <button
                type="button"
                onClick={() => setCompletedExpanded(expanded => !expanded)}
                aria-expanded={selectedStageFilter === 'live' || completedExpanded}
                className="flex w-full items-center justify-between gap-3 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                <span className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    <span className="block text-sm font-black text-content">Completed apps</span>
                    <span className="block text-xs text-content-faint">Live &amp; Shipped projects kept for reference</span>
                  </span>
                  <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[11px] font-mono font-bold text-emerald-700 dark:text-emerald-300">{completedProjects.length}</span>
                </span>
                <ChevronDown className={`h-4 w-4 text-content-faint transition-transform ${selectedStageFilter === 'live' || completedExpanded ? 'rotate-180' : ''}`} />
              </button>

              {(selectedStageFilter === 'live' || completedExpanded) && (
                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {completedProjects.map(renderProjectCard)}
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {copyProjectOpen && activeProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="copy-project-title">
          <form onSubmit={handleDuplicateProject} className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="copy-project-title" className="text-lg font-black text-content">Copy Project</h2>
                <p className="mt-1 text-xs text-content-faint">Create a new project folder and copy the source files.</p>
              </div>
              <button type="button" onClick={() => setCopyProjectOpen(false)} className="rounded-lg p-1 text-content-faint hover:text-content" aria-label="Close copy project dialog"><X className="h-4 w-4" /></button>
            </div>
            <label className="mt-5 block text-xs font-black uppercase tracking-wider text-content-muted">New project name</label>
            <input autoFocus required maxLength={300} value={copyProjectTitle} onChange={e => setCopyProjectTitle(e.target.value)} className="mt-1.5 w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm text-content outline-none focus:border-indigo-500" placeholder="e.g. Project v2" />
            {copyProjectError && <p className="mt-2 text-xs text-rose-400" role="alert">{copyProjectError}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setCopyProjectOpen(false)} disabled={isCopyingProject} className="rounded-xl px-4 py-2 text-xs font-bold text-content-faint hover:bg-surface-2">Cancel</button>
              <button type="submit" disabled={isCopyingProject || !copyProjectTitle.trim()} className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-black text-white hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-50">{isCopyingProject ? 'Copying…' : 'Copy Project'}</button>
            </div>
          </form>
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

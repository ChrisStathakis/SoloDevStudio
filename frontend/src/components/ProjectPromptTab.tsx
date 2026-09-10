import React from 'react';
import { Edit3, Sparkles, FileText, Play, Check, X, Clipboard, ExternalLink } from 'lucide-react';
import { Project, Task, LauncherModelPreset } from '../types';
import { Dialog } from './ui';

export interface PromptToolAvailability {
  tool: 'opencode' | 'codex';
  available: boolean;
  npm_available: boolean;
  install_command: string;
  documentation_url: string;
  message?: string;
}

interface Props {
  project: Project;
  tasks: Task[];
  isEditingPrompt: boolean;
  promptDraft: string;
  promptSaveError: string | null;
  promptCopyError: string | null;
  initializationStatus: string | null;
  copiedPrompt: boolean;
  hasGeneratedSkillContext: boolean;
  launchTool: 'opencode' | 'codex';
  launchModel: string;
  launchReasoningEffort: 'low' | 'medium' | 'high';
  launchMode: 'build' | 'plan';
  modelPresets: LauncherModelPreset[];
  isSavingInitializationSettings: boolean;
  isLaunchDialogOpen: boolean;
  promptSource: 'project' | 'task';
  selectedPromptTaskId: string;
  toolAvailability: PromptToolAvailability | null;
  isCheckingTool: boolean;
  isInstallingTool: boolean;
  isLoadingPromptPreview: boolean;
  isPromptPreviewOpen: boolean;
  previewedPrompt: string;
  previewedLineCount: number;
  previewedSkillCount: number;
  promptPreviewError: string | null;
  copiedPreviewPrompt: boolean;
  isSavingPrompt: boolean;
  setPromptDraft: (v: string) => void;
  setIsEditingPrompt: (v: boolean) => void;
  setPromptSaveError: (v: string | null) => void;
  setLaunchTool: (v: 'opencode' | 'codex') => void;
  setLaunchModel: (v: string) => void;
  setLaunchReasoningEffort: (v: 'low' | 'medium' | 'high') => void;
  setLaunchMode: (v: 'build' | 'plan') => void;
  setIsLaunchDialogOpen: (v: boolean) => void;
  setPromptSource: (v: 'project' | 'task') => void;
  setSelectedPromptTaskId: (v: string) => void;
  setToolAvailability: (v: PromptToolAvailability | null) => void;
  setIsPromptPreviewOpen: (v: boolean) => void;
  setInitializationStatus: (v: string | null) => void;
  setCurrentView: (view: 'dashboard' | 'projects' | 'ideas' | 'matrix' | 'timetracker' | 'timeline' | 'settings') => void;
  preparePromptCleanup: () => void;
  openPromptPreview: () => void;
  applyLauncherPreset: (presetId: string) => void;
  saveInitializationSettings: () => void;
  handleClearInitialPrompt: () => void;
  handleSaveInitialPrompt: () => void;
  checkToolAvailability: (tool: 'opencode' | 'codex') => void;
  installSelectedTool: () => void;
  handleStartInitialization: (tool: 'opencode' | 'codex', model: string, reasoningEffort: 'low' | 'medium' | 'high', mode: 'build' | 'plan') => void;
  copyPreviewedPrompt: () => void;
}

export const ProjectPromptTab: React.FC<Props> = ({
  project,
  tasks,
  isEditingPrompt,
  promptDraft,
  promptSaveError,
  promptCopyError,
  initializationStatus,
  copiedPrompt,
  hasGeneratedSkillContext,
  launchTool,
  launchModel,
  launchReasoningEffort,
  launchMode,
  modelPresets,
  isSavingInitializationSettings,
  isLaunchDialogOpen,
  promptSource,
  selectedPromptTaskId,
  toolAvailability,
  isCheckingTool,
  isInstallingTool,
  isLoadingPromptPreview,
  isPromptPreviewOpen,
  previewedPrompt,
  previewedLineCount,
  previewedSkillCount,
  promptPreviewError,
  copiedPreviewPrompt,
  isSavingPrompt,
  setPromptDraft,
  setIsEditingPrompt,
  setPromptSaveError,
  setLaunchTool,
  setLaunchModel,
  setLaunchReasoningEffort,
  setLaunchMode,
  setIsLaunchDialogOpen,
  setPromptSource,
  setSelectedPromptTaskId,
  setToolAvailability,
  setIsPromptPreviewOpen,
  setInitializationStatus,
  setCurrentView,
  preparePromptCleanup,
  openPromptPreview,
  applyLauncherPreset,
  saveInitializationSettings,
  handleClearInitialPrompt,
  handleSaveInitialPrompt,
  checkToolAvailability,
  installSelectedTool,
  handleStartInitialization,
  copyPreviewedPrompt,
}) => {
  return (
    <div className="space-y-4">
      <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="text-xs font-black text-content uppercase tracking-[0.2em] font-mono">Prompt</h3>
            <p className="text-xs text-content-faint mt-1">Edit the saved project brief separately from initialization.</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {!isEditingPrompt && (
              <button
                type="button"
                onClick={() => { setPromptDraft(project.initialPrompt || ''); setIsEditingPrompt(true); setPromptSaveError(null); }}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-2 border border-line text-content-muted hover:text-content hover:border-line-strong text-xs font-black transition-all"
              >
                <Edit3 className="w-3.5 h-3.5" />
                Edit prompt
              </button>
            )}
            {!isEditingPrompt && hasGeneratedSkillContext && (
              <button
                type="button"
                onClick={preparePromptCleanup}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15 text-xs font-black transition-all"
                title="Remove generated linked-skill sections from the saved prompt draft for review"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Clean generated skill context
              </button>
            )}
            <button
              type="button"
              onClick={() => void openPromptPreview()}
              disabled={!project.initialPrompt || isEditingPrompt || isLoadingPromptPreview}
              title={isEditingPrompt ? 'Save the prompt before previewing initialization' : 'Preview the full initialization prompt'}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-2 border border-line text-content-muted hover:text-content hover:border-line-strong text-xs font-black transition-all disabled:opacity-40"
            >
              <FileText className="w-3.5 h-3.5" />
              {isLoadingPromptPreview ? 'Loading preview…' : 'Preview prompt'}
            </button>
            <button
              type="button"
              onClick={() => { const tool = project.initializationTool || 'opencode'; setLaunchTool(tool); setLaunchModel(project.initializationModel || ''); setLaunchReasoningEffort(project.initializationReasoningEffort || 'medium'); setLaunchMode(project.initializationMode || 'build'); setToolAvailability(null); setPromptSource('project'); setSelectedPromptTaskId(''); setIsLaunchDialogOpen(true); setInitializationStatus(null); void checkToolAvailability(tool); }}
              disabled={!project.initialPrompt || isEditingPrompt}
              title={isEditingPrompt ? 'Save the prompt before starting initialization' : 'Choose a tool and model, then open the project console'}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-xs font-black transition-all disabled:opacity-40 ${
                copiedPrompt
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                  : 'bg-indigo-500/10 border-indigo-500/25 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20'
              }`}
            >
              {copiedPrompt ? <Check className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {copiedPrompt ? 'Prompt prepared' : 'Start initialization'}
            </button>
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-2/50 p-4 space-y-3">
          <div>
            <h4 className="text-xs font-black text-content">Initialization defaults</h4>
            <p className="text-[11px] text-content-faint mt-0.5">Choose the CLI and model used by default. Start initialization can override these once.</p>
          </div>
          <div className="flex flex-wrap items-stretch gap-2">
            <label className="sr-only" htmlFor="prompt-launch-tool">Initialization tool</label>
            <select id="prompt-launch-tool" value={launchTool} onChange={e => { const next = e.target.value as 'opencode' | 'codex'; setLaunchTool(next); setLaunchModel(''); }} className="w-full sm:w-36 rounded-xl bg-surface border border-line px-3 py-2 text-xs font-bold text-content">
              <option value="opencode">OpenCode</option><option value="codex">Codex</option>
            </select>
            <label className="sr-only" htmlFor="prompt-launch-model">Model</label>
            <input id="prompt-launch-model" list="project-model-presets" value={launchModel} onChange={e => setLaunchModel(e.target.value)} placeholder={launchTool === 'opencode' ? 'provider/model or model name' : 'model ID or name'} className="min-w-0 w-full sm:flex-1 sm:min-w-[14rem] rounded-xl bg-surface border border-line px-3 py-2 text-xs font-mono text-content" />
            <label className="sr-only" htmlFor="prompt-launch-preset">Saved model preset</label>
            <select id="prompt-launch-preset" value="" onChange={e => applyLauncherPreset(e.target.value)} className="w-full sm:w-40 rounded-xl bg-surface border border-line px-3 py-2 text-xs font-bold text-content" aria-label="Saved model preset">
              <option value="">Use preset…</option>
              {modelPresets.filter(p => p.enabled).map(p => <option key={p.id} value={p.id}>{p.label || p.modelId}</option>)}
            </select>
            <select value={launchReasoningEffort} onChange={e => setLaunchReasoningEffort(e.target.value as 'low' | 'medium' | 'high')} className="w-full sm:w-36 rounded-xl bg-surface border border-line px-3 py-2 text-xs font-bold text-content" aria-label="Reasoning effort">
              <option value="low">Low effort</option><option value="medium">Medium effort</option><option value="high">High effort</option>
            </select>
            <select value={launchMode} onChange={e => setLaunchMode(e.target.value as 'build' | 'plan')} className="w-full sm:w-28 rounded-xl bg-surface border border-line px-3 py-2 text-xs font-bold text-content" aria-label="Initialization mode"><option value="build">Build</option><option value="plan">Plan</option></select>
            <button type="button" onClick={saveInitializationSettings} disabled={!launchModel.trim() || isSavingInitializationSettings} className="w-full sm:w-auto rounded-xl bg-surface border border-line px-3 py-2 text-xs font-black text-content-muted hover:text-content disabled:opacity-40">{isSavingInitializationSettings ? 'Saving…' : 'Save default'}</button>
          </div>
          <datalist id="project-model-presets">{modelPresets.filter(p => p.enabled).map(p => <option key={p.id} value={p.modelId}>{p.label}</option>)}</datalist>
          {modelPresets.filter(p => p.enabled).length === 0 && <p className="text-[11px] text-amber-700 dark:text-amber-300">No enabled presets for this tool. Type a model ID, then save it as the project default or <button type="button" onClick={() => setCurrentView('settings')} className="underline hover:text-amber-200">manage presets in Settings → Launch Presets</button>.</p>}
        </div>
        {promptCopyError && <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">{promptCopyError}</p>}
        {initializationStatus && <p className="text-xs text-emerald-700 dark:text-emerald-300" role="status">{initializationStatus}</p>}
        {promptSaveError && <p className="text-xs text-rose-700 dark:text-rose-300" role="alert">{promptSaveError}</p>}
        {isEditingPrompt ? (
          <>
            <label className="sr-only" htmlFor="project-prompt-editor">Project prompt editor</label>
            <textarea
              id="project-prompt-editor"
              value={promptDraft}
              onChange={e => setPromptDraft(e.target.value)}
              rows={18}
              autoFocus
              className="w-full resize-y min-h-[20rem] rounded-2xl bg-surface-inverse border border-line focus:border-indigo-500 p-4 text-xs leading-relaxed text-slate-100 font-mono outline-none placeholder:text-slate-500"
              placeholder="Write the initial project prompt..."
            />
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleClearInitialPrompt}
                disabled={!promptDraft || isSavingPrompt}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 hover:bg-rose-500/10 text-xs font-black disabled:opacity-40"
              >
                <X className="w-3.5 h-3.5" />
                Clear text
              </button>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => { setPromptDraft(project.initialPrompt || ''); setIsEditingPrompt(false); }} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-surface-2 border border-line text-content-muted hover:text-content text-xs font-black">
                  Cancel
                </button>
                <button type="button" onClick={handleSaveInitialPrompt} disabled={!promptDraft.trim() || isSavingPrompt} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black disabled:opacity-40">
                  <Check className="w-3.5 h-3.5" />
                  {isSavingPrompt ? 'Saving…' : 'Save prompt'}
                </button>
              </div>
            </div>
          </>
        ) : project.initialPrompt ? (
          <pre className="whitespace-pre-wrap select-text max-h-[32rem] overflow-auto rounded-2xl bg-surface-inverse border border-line p-4 text-xs leading-relaxed text-slate-100 font-mono">
            {project.initialPrompt}
          </pre>
        ) : (
          <div className="rounded-2xl border border-dashed border-line p-8 text-center text-xs text-content-faint font-mono">
            This project has no saved prompt. Use Edit prompt to create one.
          </div>
        )}
      </div>
      {isLaunchDialogOpen && (
        <Dialog label="Choose initialization model" onClose={() => setIsLaunchDialogOpen(false)} className="max-w-md">
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div><h3 className="text-base font-black text-content">Initialize with…</h3><p className="text-xs text-content-faint mt-1">The prompt will be copied and prepared in the selected CLI composer for your review.</p></div>
              <button type="button" onClick={() => setIsLaunchDialogOpen(false)} className="p-1.5 text-content-faint hover:text-content rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <label className="block text-xs font-black text-content">Prompt source<select value={promptSource} onChange={e => { const next = e.target.value as 'project' | 'task'; setPromptSource(next); if (next === 'project') setSelectedPromptTaskId(''); }} className="mt-1 w-full rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content"><option value="project">Full project initialization</option><option value="task">Task prompt</option></select></label>
            {promptSource === 'task' && (() => {
              const openTasks = tasks.filter(t => t.projectId === project.id && !t.completed);
              return <label className="block text-xs font-black text-content">Open task<select value={selectedPromptTaskId} onChange={e => setSelectedPromptTaskId(e.target.value)} className="mt-1 w-full rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content"><option value="">Choose a task…</option>{openTasks.map(task => <option key={task.id} value={task.id}>{task.title}{task.subtasks.length ? ` (${task.subtasks.length} steps)` : ''}</option>)}</select>{openTasks.length === 0 && <span className="mt-1 block text-[11px] text-amber-700 dark:text-amber-300">There are no open tasks in this project.</span>}</label>;
            })()}
            <label className="block text-xs font-black text-content">Tool<select value={launchTool} onChange={e => { const next = e.target.value as 'opencode' | 'codex'; setLaunchTool(next); setLaunchModel(''); setLaunchReasoningEffort('medium'); setToolAvailability(null); void checkToolAvailability(next); }} className="mt-1 w-full rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content"><option value="opencode">OpenCode</option><option value="codex">Codex</option></select></label>
            <label className="block text-xs font-black text-content">Model<input list="project-model-presets" value={launchModel} onChange={e => setLaunchModel(e.target.value)} placeholder={launchTool === 'opencode' ? 'provider/model or model name' : 'model ID or name'} className="mt-1 w-full rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-mono text-content" /></label>
            <label className="block text-xs font-black text-content">Saved preset<select value="" onChange={e => applyLauncherPreset(e.target.value)} className="mt-1 w-full rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content"><option value="">Choose…</option>{modelPresets.filter(p => p.enabled).map(p => <option key={p.id} value={p.id}>{p.label || p.modelId}</option>)}</select></label>
            <label className="block text-xs font-black text-content">Reasoning effort<select value={launchReasoningEffort} onChange={e => setLaunchReasoningEffort(e.target.value as 'low' | 'medium' | 'high')} className="mt-1 w-full rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
            <label className="block text-xs font-black text-content">Mode<select value={launchMode} onChange={e => setLaunchMode(e.target.value as 'build' | 'plan')} className="mt-1 w-full rounded-xl bg-surface-2 border border-line px-3 py-2 text-xs font-bold text-content"><option value="build">Build</option><option value="plan">Plan</option></select></label>
            {launchTool === 'opencode' && <p className="text-[11px] text-content-faint">OpenCode launches as <span className="font-mono">opencode --agent {launchMode}</span>. Effort is saved on the preset but the interactive CLI has no top-level variant flag.</p>}
            {isCheckingTool && <p className="text-xs text-content-faint" role="status">Checking whether {launchTool === 'codex' ? 'Codex' : 'OpenCode'} is installed…</p>}
            {!isCheckingTool && toolAvailability && !toolAvailability.available && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2"><p className="text-xs font-bold text-amber-700 dark:text-amber-200">{toolAvailability.message || 'This CLI is not installed.'}</p><code className="block rounded-lg bg-black/20 p-2 text-[11px] text-amber-100 break-all">{toolAvailability.install_command}</code><div className="flex flex-wrap items-center gap-2"><button type="button" onClick={async () => { await navigator.clipboard.writeText(toolAvailability.install_command); setInitializationStatus('Install command copied.'); }} className="rounded-lg border border-amber-500/30 px-2.5 py-1.5 text-[11px] font-black text-amber-700 dark:text-amber-200">Copy install command</button><button type="button" onClick={installSelectedTool} disabled={!toolAvailability.npm_available || isInstallingTool} className="rounded-lg bg-amber-500/20 px-2.5 py-1.5 text-[11px] font-black text-amber-100 disabled:opacity-40">{isInstallingTool ? 'Installing…' : 'Install in terminal'}</button><button type="button" onClick={() => void checkToolAvailability(launchTool)} disabled={isCheckingTool} className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-black text-content-muted">Check again</button><a href={toolAvailability.documentation_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] font-black text-indigo-700 dark:text-indigo-300 hover:text-indigo-200">Docs <ExternalLink className="w-3 h-3" /></a></div>{!toolAvailability.npm_available && <p className="text-[11px] text-rose-700 dark:text-rose-300">npm is unavailable. Install Node.js/npm first, then check again.</p>}</div>}
            <div className="flex items-center justify-end gap-2"><button type="button" onClick={() => setIsLaunchDialogOpen(false)} className="rounded-xl bg-surface-2 border border-line px-3.5 py-2 text-xs font-black text-content-muted">Cancel</button><button type="button" onClick={() => handleStartInitialization(launchTool, launchModel, launchReasoningEffort, launchMode)} disabled={!launchModel.trim() || (promptSource === 'task' && !selectedPromptTaskId)} className="rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-black text-white disabled:opacity-40">Prepare in terminal</button></div>
          </div>
        </Dialog>
      )}
      {isPromptPreviewOpen && (
        <Dialog label="Initialization prompt preview" onClose={() => setIsPromptPreviewOpen(false)} className="max-w-4xl">
          <div className="flex min-h-0 flex-col p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-black text-content">Initialization prompt preview</h3>
                <p className="text-xs text-content-faint mt-1">This is the generated full-project prompt used by the default initialization flow.</p>
                {!isLoadingPromptPreview && !promptPreviewError && previewedPrompt && (
                  <p className="text-[11px] text-content-muted mt-1 font-mono">{previewedLineCount.toLocaleString()} lines · {previewedSkillCount} active {previewedSkillCount === 1 ? 'skill' : 'skills'}</p>
                )}
              </div>
              <button type="button" onClick={() => setIsPromptPreviewOpen(false)} className="p-1.5 text-content-faint hover:text-content rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400" aria-label="Close preview"><X className="w-4 h-4" /></button>
            </div>
            <div className="mt-4 min-h-0 max-h-[50vh] overflow-auto rounded-2xl border border-line bg-surface-inverse p-4">
              {isLoadingPromptPreview ? (
                <p className="text-xs text-slate-300" role="status">Generating preview…</p>
              ) : promptPreviewError ? (
                <p className="text-xs text-rose-300" role="alert">{promptPreviewError}</p>
              ) : (
                <pre className="whitespace-pre-wrap select-text text-xs leading-relaxed text-slate-100 font-mono">{previewedPrompt}</pre>
              )}
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setIsPromptPreviewOpen(false)} className="rounded-xl bg-surface-2 border border-line px-3.5 py-2 text-xs font-black text-content-muted">Close</button>
              <button type="button" onClick={() => void copyPreviewedPrompt()} disabled={!previewedPrompt} className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-black text-white disabled:opacity-40">
                {copiedPreviewPrompt ? <Check className="w-3.5 h-3.5" /> : <Clipboard className="w-3.5 h-3.5" />}
                {copiedPreviewPrompt ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
};

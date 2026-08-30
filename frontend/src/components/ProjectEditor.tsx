import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Save, X } from 'lucide-react';
import { AppCategory, Project, ProjectStage, STAGE_CONFIG } from '../types';
import { PathPickerModal } from './PathPickerModal';

const CATEGORIES: AppCategory[] = [
  'Web App / SaaS',
  'Mobile App',
  'Chrome Extension',
  'Developer Tool / CLI',
  'Open Source Library',
  'AI / ML Tool',
  'Desktop App',
  'Portfolio / Website',
];

type ProjectDraft = {
  title: string;
  tagline: string;
  description: string;
  problem: string;
  solution: string;
  targetAudience: string;
  monetization: string;
  mvpFeatures: string[];
  tags: string[];
  category: AppCategory;
  currentStage: ProjectStage;
  targetDeadline: string;
  startDate: string;
  actualLaunchDate: string;
  color: string;
  techStack: string[];
  repoUrl: string;
  liveUrl: string;
  figmaUrl: string;
  directoryPath: string;
  scriptPath: string;
  cmdDirectory: string;
  port: string;
  pythonEnv: string;
  drive: string;
  notes: string;
  initializationTool: 'opencode' | 'codex';
  initializationModel: string;
  pinned: boolean;
};

const fieldClass = 'w-full rounded-xl bg-surface-2 border border-line px-3 py-2.5 text-sm text-content placeholder:text-content-faint outline-none focus:border-indigo-500';
const labelClass = 'block text-[11px] font-black uppercase tracking-wider text-content-faint mb-1.5';

const draftFromProject = (project: Project): ProjectDraft => ({
  title: project.title,
  tagline: project.tagline || '',
  description: project.description || '',
  problem: project.problem || '',
  solution: project.solution || '',
  targetAudience: project.targetAudience || '',
  monetization: project.monetization || '',
  mvpFeatures: [...(project.mvpFeatures || [])],
  tags: [...(project.tags || [])],
  category: project.category,
  currentStage: project.currentStage,
  targetDeadline: project.targetDeadline || '',
  startDate: project.startDate || '',
  actualLaunchDate: project.actualLaunchDate || '',
  color: project.color || '#6366f1',
  techStack: [...(project.techStack || [])],
  repoUrl: project.repoUrl || '',
  liveUrl: project.liveUrl || '',
  figmaUrl: project.figmaUrl || '',
  directoryPath: project.directoryPath || '',
  scriptPath: project.scriptPath || '',
  cmdDirectory: project.cmdDirectory || '',
  port: project.port || '',
  pythonEnv: project.pythonEnv || '',
  drive: project.drive || '',
  notes: project.notes || '',
  initializationTool: project.initializationTool || 'opencode',
  initializationModel: project.initializationModel || '',
  pinned: project.pinned,
});

function ListEditor({ label, values, onChange, placeholder }: { label: string; values: string[]; onChange: (values: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const value = draft.trim();
    if (!value) return;
    onChange([...values, value]);
    setDraft('');
  };
  const remove = (index: number) => onChange(values.filter((_, itemIndex) => itemIndex !== index));
  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= values.length) return;
    const next = [...values];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onChange(next);
  };
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <div className="space-y-2">
        {values.map((value, index) => (
          <div key={`${value}-${index}`} className="flex items-center gap-2">
            <input
              className={fieldClass}
              value={value}
              onChange={event => onChange(values.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
            />
            <button type="button" onClick={() => move(index, -1)} disabled={index === 0} className="p-2 rounded-lg border border-line text-content-faint hover:text-content disabled:opacity-30" title="Move up"><ArrowUp className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => move(index, 1)} disabled={index === values.length - 1} className="p-2 rounded-lg border border-line text-content-faint hover:text-content disabled:opacity-30" title="Move down"><ArrowDown className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => remove(index)} className="p-2 rounded-lg border border-line text-rose-300 hover:text-rose-200" title="Remove"><X className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <input
            className={fieldClass}
            value={draft}
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
            placeholder={placeholder}
          />
          <button type="button" onClick={add} className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black"><Plus className="w-3.5 h-3.5" />Add</button>
        </div>
      </div>
    </div>
  );
}

export function ProjectEditor({ project, saving, error, onSave, onCancel }: {
  project: Project;
  saving: boolean;
  error: string | null;
  onSave: (draft: ProjectDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ProjectDraft>(() => draftFromProject(project));
  const [pathPicker, setPathPicker] = useState<null | 'directoryPath' | 'scriptPath' | 'cmdDirectory' | 'pythonEnv'>(null);

  useEffect(() => setDraft(draftFromProject(project)), [project.id]);
  const set = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const pathLabel = pathPicker === 'scriptPath' ? 'Server Script' : pathPicker === 'directoryPath' ? 'Project Folder' : pathPicker === 'pythonEnv' ? 'Python Virtualenv' : 'CMD Directory';

  return (
    <form onSubmit={event => { event.preventDefault(); void onSave(draft); }} className="p-6 rounded-3xl bg-surface border border-indigo-500/50 shadow-xl space-y-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-indigo-400 font-mono">Project editor</div>
          <h2 className="text-xl font-black text-content mt-1">Edit Project</h2>
          <p className="text-xs text-content-faint mt-1">Update all project-level details. Tasks, milestones, time logs, and the generated prompt stay in their own tabs.</p>
        </div>
        <button type="button" onClick={onCancel} className="p-2 rounded-xl border border-line text-content-faint hover:text-content" title="Cancel"><X className="w-4 h-4" /></button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}

      <section className="space-y-4">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-content font-mono">Identity & brief</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label><span className={labelClass}>Title</span><input required className={fieldClass} value={draft.title} onChange={event => set('title', event.target.value)} /></label>
          <label><span className={labelClass}>Tagline</span><input className={fieldClass} value={draft.tagline} onChange={event => set('tagline', event.target.value)} /></label>
        </div>
        <label><span className={labelClass}>Description</span><textarea rows={4} className={fieldClass} value={draft.description} onChange={event => set('description', event.target.value)} /></label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label><span className={labelClass}>Problem</span><textarea rows={4} className={fieldClass} value={draft.problem} onChange={event => set('problem', event.target.value)} /></label>
          <label><span className={labelClass}>Solution</span><textarea rows={4} className={fieldClass} value={draft.solution} onChange={event => set('solution', event.target.value)} /></label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label><span className={labelClass}>Target audience</span><textarea rows={3} className={fieldClass} value={draft.targetAudience} onChange={event => set('targetAudience', event.target.value)} /></label>
          <label><span className={labelClass}>Monetization</span><textarea rows={3} className={fieldClass} value={draft.monetization} onChange={event => set('monetization', event.target.value)} /></label>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-content font-mono">Planning</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <label><span className={labelClass}>Category</span><select className={fieldClass} value={draft.category} onChange={event => set('category', event.target.value as AppCategory)}>{CATEGORIES.map(category => <option key={category}>{category}</option>)}</select></label>
          <label><span className={labelClass}>Lifecycle stage</span><select className={fieldClass} value={draft.currentStage} onChange={event => set('currentStage', event.target.value as ProjectStage)}>{(Object.keys(STAGE_CONFIG) as ProjectStage[]).map(stage => <option key={stage} value={stage}>{STAGE_CONFIG[stage].label}</option>)}</select></label>
          <label><span className={labelClass}>Start date</span><input required type="date" className={fieldClass} value={draft.startDate} onChange={event => set('startDate', event.target.value)} /></label>
          <label><span className={labelClass}>Target deadline</span><input required type="date" className={fieldClass} value={draft.targetDeadline} onChange={event => set('targetDeadline', event.target.value)} /></label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label><span className={labelClass}>Actual launch date</span><input type="date" className={fieldClass} value={draft.actualLaunchDate} onChange={event => set('actualLaunchDate', event.target.value)} /></label>
          <label className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5"><input type="checkbox" checked={draft.pinned} onChange={event => set('pinned', event.target.checked)} /><span className="text-sm text-content">Pin this project</span></label>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <ListEditor label="Tech stack" values={draft.techStack} onChange={values => set('techStack', values)} placeholder="Add a technology" />
        <ListEditor label="MVP features" values={draft.mvpFeatures} onChange={values => set('mvpFeatures', values)} placeholder="Add an MVP feature" />
        <ListEditor label="Tags" values={draft.tags} onChange={values => set('tags', values)} placeholder="Add a tag" />
      </section>

      <section className="space-y-4">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-content font-mono">Links & local runtime</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <label><span className={labelClass}>Repository URL</span><input type="url" className={fieldClass} value={draft.repoUrl} onChange={event => set('repoUrl', event.target.value)} /></label>
          <label><span className={labelClass}>Live URL</span><input type="url" className={fieldClass} value={draft.liveUrl} onChange={event => set('liveUrl', event.target.value)} /></label>
          <label><span className={labelClass}>Figma URL</span><input type="url" className={fieldClass} value={draft.figmaUrl} onChange={event => set('figmaUrl', event.target.value)} /></label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label><span className={labelClass}>Project folder</span><div className="flex gap-2"><input className={fieldClass} value={draft.directoryPath} onChange={event => set('directoryPath', event.target.value)} /><button type="button" onClick={() => setPathPicker('directoryPath')} className="shrink-0 px-3 rounded-xl border border-line text-xs font-bold text-content-muted hover:text-content">Browse</button></div></label>
          <label><span className={labelClass}>Server script</span><div className="flex gap-2"><input className={fieldClass} value={draft.scriptPath} onChange={event => set('scriptPath', event.target.value)} /><button type="button" onClick={() => setPathPicker('scriptPath')} className="shrink-0 px-3 rounded-xl border border-line text-xs font-bold text-content-muted hover:text-content">Browse</button></div></label>
          <label><span className={labelClass}>CMD directory</span><div className="flex gap-2"><input className={fieldClass} value={draft.cmdDirectory} onChange={event => set('cmdDirectory', event.target.value)} /><button type="button" onClick={() => setPathPicker('cmdDirectory')} className="shrink-0 px-3 rounded-xl border border-line text-xs font-bold text-content-muted hover:text-content">Browse</button></div></label>
          <label><span className={labelClass}>Port / run args</span><input className={fieldClass} value={draft.port} onChange={event => set('port', event.target.value)} /></label>
          <label><span className={labelClass}>Python environment</span><div className="flex gap-2"><input className={fieldClass} value={draft.pythonEnv} onChange={event => set('pythonEnv', event.target.value)} /><button type="button" onClick={() => setPathPicker('pythonEnv')} className="shrink-0 px-3 rounded-xl border border-line text-xs font-bold text-content-muted hover:text-content">Browse</button></div></label>
          <label><span className={labelClass}>Drive</span><select className={fieldClass} value={draft.drive} onChange={event => set('drive', event.target.value)}><option value="">No drive remapping</option>{['C', 'D', 'E', 'F', 'G', 'H'].map(drive => <option key={drive} value={drive}>{drive}:</option>)}</select></label>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-xs font-black uppercase tracking-[0.18em] text-content font-mono">Notes & initialization</h3>
        <label><span className={labelClass}>Notes</span><textarea rows={4} className={fieldClass} value={draft.notes} onChange={event => set('notes', event.target.value)} /></label>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label><span className={labelClass}>Initialization tool</span><select className={fieldClass} value={draft.initializationTool} onChange={event => set('initializationTool', event.target.value as 'opencode' | 'codex')}><option value="opencode">OpenCode</option><option value="codex">Codex</option></select></label>
          <label><span className={labelClass}>Initialization model</span><input className={fieldClass} value={draft.initializationModel} onChange={event => set('initializationModel', event.target.value)} placeholder="provider/model or model name" /></label>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
        <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-line text-content-muted hover:text-content text-sm font-bold">Cancel</button>
        <button type="submit" disabled={saving} className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-black disabled:opacity-50"><Save className="w-4 h-4" />{saving ? 'Saving…' : 'Save Project'}</button>
      </div>
      {pathPicker && (
        <PathPickerModal
          mode={pathPicker === 'scriptPath' ? 'file' : 'folder'}
          fileFilter={pathPicker === 'scriptPath' ? ['.bat', '.cmd'] : undefined}
          initialPath={draft[pathPicker]}
          title={`Select ${pathLabel}`}
          onClose={() => setPathPicker(null)}
          onSelect={path => { setDraft(previous => ({ ...previous, [pathPicker]: path })); setPathPicker(null); }}
        />
      )}
    </form>
  );
}

export type { ProjectDraft };

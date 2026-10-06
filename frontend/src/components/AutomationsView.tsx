import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, authedFetch, unwrapPaginated } from '../services/api';
import { AutomationPrompt, CronJob, CronRun, LauncherModelPreset } from '../types';
import { sanitizeTerminalPrompt } from '../services/initialization';
import type { TerminalSessionDto } from './TerminalDrawer';
import { Button } from './ui';

type JobForm = {
  name: string;
  working_directory: string;
  python_env: string;
  tool: 'opencode' | 'codex' | 'kilo';
  model_id: string;
  reasoning_effort: 'low' | 'medium' | 'high';
  mode: 'build' | 'plan';
  prompt_template: string;
  schedule_kind: 'daily' | 'every_hours' | 'cron';
  schedule_value: string;
  timeout_minutes: number;
  notify_mode: 'always' | 'on_alert' | 'on_fail';
};

const EMPTY_FORM: JobForm = {
  name: '',
  working_directory: '',
  python_env: '',
  tool: 'opencode',
  model_id: '',
  reasoning_effort: 'medium',
  mode: 'build',
  prompt_template: '',
  schedule_kind: 'daily',
  schedule_value: '09:00',
  timeout_minutes: 15,
  notify_mode: 'on_alert',
};

function scheduleLabel(job: CronJob): string {
  if (job.schedule_kind === 'every_hours') return `Every ${job.schedule_value}h`;
  if (job.schedule_kind === 'cron') return `Cron ${job.schedule_value}`;
  return `Daily ${job.schedule_value || '09:00'}`;
}

function normalizePreset(raw: any): LauncherModelPreset {
  const tool = raw.tool === 'codex' || raw.tool === 'kilo' ? raw.tool : 'opencode';
  const reasoningEffort = raw.reasoningEffort === 'low' || raw.reasoningEffort === 'high'
    ? raw.reasoningEffort
    : (raw.reasoning_effort === 'low' || raw.reasoning_effort === 'high' ? raw.reasoning_effort : 'medium');
  return {
    id: String(raw.id),
    tool,
    modelId: String(raw.modelId ?? raw.model_id ?? ''),
    reasoningEffort,
    mode: raw.mode === 'plan' ? 'plan' : 'build',
    label: String(raw.label ?? raw.modelId ?? raw.model_id ?? ''),
    enabled: raw.enabled !== false,
    createdAt: String(raw.createdAt ?? raw.created_at ?? ''),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? ''),
  };
}

function normalizePrompt(raw: any): AutomationPrompt {
  return {
    id: String(raw.id),
    title: String(raw.title ?? ''),
    content: String(raw.content ?? ''),
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  };
}

type AutomationFile = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string;
  changed_in_run: boolean;
};

type FilePreview =
  | { kind: 'text'; name: string; path: string; size: number; truncated: boolean; content: string }
  | { kind: 'image'; name: string; path: string; size: number; mime: string; data_url: string };

function formatBytes(size: number): string {
  if (!size) return '0 B';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export const AutomationsView: React.FC = () => {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState<JobForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [openJobId, setOpenJobId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, CronRun[]>>({});
  const [taskStatus, setTaskStatus] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const [presets, setPresets] = useState<LauncherModelPreset[]>([]);
  const [presetId, setPresetId] = useState('');
  const [opencodeModels, setOpencodeModels] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<AutomationPrompt[]>([]);
  const [promptId, setPromptId] = useState('');
  const [saveTitle, setSaveTitle] = useState('');
  const [promptBusy, setPromptBusy] = useState(false);
  const [defaultFolder, setDefaultFolder] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const formTopRef = useRef<HTMLDivElement | null>(null);
  const [liveByJob, setLiveByJob] = useState<Record<string, TerminalSessionDto[]>>({});
  const [watching, setWatching] = useState<Record<string, { text: string; live: boolean; note: string }>>({});
  const watchTimers = useRef<Record<string, number>>({});
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [filesByJob, setFilesByJob] = useState<Record<string, { directory: string; current: string; parent: string | null; files: AutomationFile[]; error?: string }>>({});
  const [filesBusy, setFilesBusy] = useState<Record<string, boolean>>({});
  const [highlightRunId, setHighlightRunId] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [folderMsg, setFolderMsg] = useState<Record<string, string>>({});
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);

  const loadFiles = useCallback(async (jobId: string, runId?: string, subpath?: string) => {
    const effectiveRun = runId ?? highlightRunId[jobId];
    if (runId !== undefined) setHighlightRunId(m => ({ ...m, [jobId]: runId }));
    setFilesBusy(b => ({ ...b, [jobId]: true }));
    try {
      const params: Record<string, string> = {};
      if (effectiveRun) params.run_id = effectiveRun;
      if (subpath) params.path = subpath;
      const res = await api.get(`/cron-jobs/${jobId}/files/`, { params });
      const data = res.data ?? {};
      setFilesByJob(m => ({ ...m, [jobId]: {
        directory: String(data.directory || ''),
        current: String(data.current || ''),
        parent: (typeof data.parent === 'string' ? data.parent : null),
        files: Array.isArray(data.files) ? data.files as AutomationFile[] : [],
        error: typeof data.error === 'string' ? data.error : undefined,
      } }));
    } catch {
      setFilesByJob(m => ({ ...m, [jobId]: { directory: '', current: '', parent: null, files: [], error: 'Could not list files.' } }));
    } finally {
      setFilesBusy(b => ({ ...b, [jobId]: false }));
    }
  }, [highlightRunId]);

  const openFolder = useCallback(async (job: CronJob) => {
    try {
      await api.post(`/cron-jobs/${job.id}/open-folder/`, {});
      setFolderMsg(m => ({ ...m, [job.id]: '' }));
    } catch (e: any) {
      setFolderMsg(m => ({ ...m, [job.id]: String(e?.response?.data?.error || 'Could not open the folder.') }));
    }
  }, []);

  const openPreview = useCallback(async (path: string) => {
    setPreview(null);
    setPreviewError('');
    setPreviewBusy(true);
    try {
      const res = await api.get('/files/content/', { params: { path } });
      setPreview(res.data as FilePreview);
    } catch (e: any) {
      setPreviewError(String(e?.response?.data?.error || 'Could not preview the file.'));
    } finally {
      setPreviewBusy(false);
    }
  }, []);

  const fetchLiveText = useCallback(async (sessionId: string): Promise<{ text: string; ended: boolean }> => {
    const ctrl = new AbortController();
    const abortTimer = window.setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await authedFetch(
        `/terminals/${sessionId}/output/?after=0`,
        { method: 'GET', headers: { Accept: 'application/x-ndjson' }, signal: ctrl.signal },
      );
      if (res.status === 404) return { text: '', ended: true };
      if (!res.ok || !res.body) return { text: '', ended: false };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let text = '';
      let ended = false;
      try {
        for (let i = 0; i < 40; i += 1) {
          const { done, value } = await reader.read();
          if (value) buf += decoder.decode(value, { stream: true });
          let nlIndex: number;
          while ((nlIndex = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nlIndex).trim();
            buf = buf.slice(nlIndex + 1);
            if (!line) continue;
            try {
              const evt = JSON.parse(line) as { d?: unknown; e?: unknown };
              if (typeof evt.d === 'string' && evt.d) text = `${text}${evt.d}`.slice(-6000);
              if (evt.e) ended = true;
            } catch {
              /* partial line */
            }
          }
          if (done) break;
          if (text.length >= 6000) break;
        }
      } finally {
        try { await reader.cancel(); } catch { /* stream already closed */ }
      }
      return { text, ended };
    } catch {
      return { text: '', ended: false };
    } finally {
      window.clearTimeout(abortTimer);
    }
  }, []);

  const refreshLiveForJobs = useCallback(async (jobIds: string[]) => {
    if (jobIds.length === 0) {
      setLiveByJob({});
      return;
    }
    try {
      const res = await api.get<TerminalSessionDto[]>('/terminals/', { params: { alive: 'true' } });
      const grouped: Record<string, TerminalSessionDto[]> = {};
      for (const s of (res.data || []).filter(x => x.alive)) {
        if (jobIds.includes(s.projectId)) (grouped[s.projectId] ||= []).push(s);
      }
      setLiveByJob(grouped);
    } catch {
      /* keep last known liveness */
    }
  }, []);

  const stopWatching = useCallback((runId: string) => {
    const t = watchTimers.current[runId];
    if (t) window.clearInterval(t);
    delete watchTimers.current[runId];
    setWatching(w => {
      const next = { ...w };
      delete next[runId];
      return next;
    });
  }, []);

  const startWatching = useCallback((run: CronRun) => {
    if (!run.terminal_id || watchTimers.current[run.id]) return;
    // Single live panel: swap any existing watch to the newly selected run.
    Object.keys(watchTimers.current).forEach(id => {
      if (id !== run.id) {
        window.clearInterval(watchTimers.current[id]);
        delete watchTimers.current[id];
      }
    });
    setWatching(w => ({ [run.id]: { text: '', live: true, note: '' } }));
    const tick = async () => {
      const { text, ended } = await fetchLiveText(run.terminal_id);
      setWatching(w => ({
        ...w,
        [run.id]: {
          text: text || w[run.id]?.text || '',
          live: !ended,
          note: ended ? 'Live session ended — showing last captured output.' : '',
        },
      }));
      if (ended) {
        const t = watchTimers.current[run.id];
        if (t) window.clearInterval(t);
        delete watchTimers.current[run.id];
      }
    };
    void tick();
    watchTimers.current[run.id] = window.setInterval(() => void tick(), 3000);
  }, [fetchLiveText]);

  useEffect(() => () => {
    Object.values(watchTimers.current).forEach(t => window.clearInterval(t));
    watchTimers.current = {};
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/cron-jobs/', { params: { page_size: 100 } });
      setJobs(unwrapPaginated<CronJob>(res.data));
    } catch {
      setError('Could not load automations.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPresets = useCallback(async () => {
    try {
      const res = await api.get('/launcher-model-presets/', { params: { page_size: 100 } });
      setPresets(unwrapPaginated<any>(res.data).map(normalizePreset));
    } catch {
      setPresets([]);
    }
  }, []);

  const loadPrompts = useCallback(async () => {
    try {
      const res = await api.get('/automation-prompts/', { params: { page_size: 100 } });
      setPrompts(unwrapPaginated<any>(res.data).map(normalizePrompt));
    } catch {
      setPrompts([]);
    }
  }, []);

  const loadDefaultFolder = useCallback(async () => {
    try {
      const res = await api.get('/settings/automation-folder/');
      const effective = String(res.data?.effective_path || '');
      setDefaultFolder(effective);
      // Prefill only when the user has not typed anything yet; never overwrite edits.
      if (effective) setForm(f => (f.working_directory.trim() ? f : { ...f, working_directory: effective }));
    } catch {
      setDefaultFolder('');
    }
  }, []);

  const loadOpencodeModels = useCallback(async () => {
    try {
      const res = await api.get('/opencode-models/');
      const rows = Array.isArray(res.data) ? res.data : (res.data?.models || []);
      setOpencodeModels(rows.map(String));
    } catch {
      setOpencodeModels([]);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadPresets();
    void loadPrompts();
    void loadDefaultFolder();
    void loadOpencodeModels();
  }, [load, loadPresets, loadPrompts, loadDefaultFolder, loadOpencodeModels]);

  const applyPreset = (id: string) => {
    setPresetId(id);
    if (!id) return;
    const preset = presets.find(p => p.id === id);
    if (!preset) return;
    // Snapshot copy: values become editable form state, no stored link.
    setForm(f => ({
      ...f,
      tool: preset.tool,
      model_id: preset.modelId,
      reasoning_effort: preset.reasoningEffort,
      mode: preset.mode,
    }));
  };

  const useSavedPrompt = (id: string) => {
    setPromptId(id);
    if (!id) return;
    const saved = prompts.find(p => p.id === id);
    if (!saved) return;
    // Snapshot copy into the automation prompt textarea.
    setForm(f => ({ ...f, prompt_template: saved.content }));
    if (!saveTitle.trim()) setSaveTitle(saved.title);
  };

  const saveCurrentPrompt = async () => {
    const title = saveTitle.trim();
    const content = form.prompt_template.trim();
    if (title.length < 3) {
      setError('Give the saved prompt a title (3+ chars).');
      return;
    }
    if (content.length < 10) {
      setError('Prompt needs at least 10 characters before saving.');
      return;
    }
    setPromptBusy(true);
    setError('');
    try {
      const existing = prompts.find(p => p.title.toLowerCase() === title.toLowerCase());
      if (existing) {
        await api.patch(`/automation-prompts/${existing.id}/`, { content });
      } else {
        await api.post('/automation-prompts/', { title, content });
      }
      setSaveTitle('');
      await loadPrompts();
    } catch {
      setError('Could not save the prompt.');
    } finally {
      setPromptBusy(false);
    }
  };

  const deleteSavedPrompt = async () => {
    if (!promptId) return;
    const saved = prompts.find(p => p.id === promptId);
    if (!saved) return;
    if (!window.confirm(`Delete saved prompt "${saved.title}"?`)) return;
    setPromptBusy(true);
    try {
      await api.delete(`/automation-prompts/${saved.id}/`);
      setPromptId('');
      await loadPrompts();
    } catch {
      setError('Could not delete the saved prompt.');
    } finally {
      setPromptBusy(false);
    }
  };

  const onUploadMd = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 200 * 1024) {
      setError('Markdown file is too large (max 200KB).');
      return;
    }
    try {
      const text = (await file.text()).trim();
      if (text.length < 10) {
        setError('That file has less than 10 characters of text.');
        return;
      }
      setForm(f => ({ ...f, prompt_template: text.slice(0, 20000) }));
      if (!saveTitle.trim()) {
        setSaveTitle(file.name.replace(/\.(md|markdown|txt)$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 200));
      }
      setError('');
    } catch {
      setError('Could not read that markdown file.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const create = async () => {
    if (form.name.trim().length < 3 || form.prompt_template.trim().length < 10) {
      setError('Give a name (3+ chars) and a prompt (10+ chars).');
      return;
    }
    if (!form.working_directory.trim()) {
      setError('Working directory is required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...form,
        name: form.name.trim(),
        model_id: form.model_id.trim(),
        prompt_template: form.prompt_template.trim(),
      };
      if (editingId) {
        await api.patch(`/cron-jobs/${editingId}/`, payload);
      } else {
        await api.post('/cron-jobs/', payload);
      }
      setForm({ ...EMPTY_FORM, working_directory: defaultFolder });
      setPresetId('');
      setEditingId(null);
      setShowForm(false);
      await load();
    } catch (e: any) {
      const data = e?.response?.data;
      const detail = typeof data === 'object' && data
        ? (data.working_directory?.[0] || data.name?.[0] || data.prompt_template?.[0] || data.detail)
        : undefined;
      setError(typeof detail === 'string' && detail ? detail : (editingId ? 'Could not save the automation.' : 'Could not create the automation. Check that the directory exists.'));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (job: CronJob) => {
    setEditingId(job.id);
    setForm({
      name: job.name,
      working_directory: job.working_directory,
      python_env: job.python_env || '',
      tool: job.tool,
      model_id: job.model_id || '',
      reasoning_effort: job.reasoning_effort || 'medium',
      mode: job.mode,
      prompt_template: job.prompt_template,
      schedule_kind: job.schedule_kind,
      schedule_value: job.schedule_value,
      timeout_minutes: job.timeout_minutes,
      notify_mode: job.notify_mode,
    });
    setPresetId('');
    setShowForm(true);
    formTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, working_directory: defaultFolder });
    setPresetId('');
  };

  const toggle = async (job: CronJob) => {
    setBusyId(job.id);
    try {
      await api.patch(`/cron-jobs/${job.id}/`, { enabled: !job.enabled });
      await load();
    } catch {
      setError('Could not update the automation.');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (job: CronJob) => {
    if (!window.confirm(`Delete "${job.name}" and its Windows task?`)) return;
    setBusyId(job.id);
    try {
      await api.delete(`/cron-jobs/${job.id}/`);
      if (editingId === job.id) cancelEdit();
      await load();
    } catch {
      setError('Could not delete the automation.');
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (job: CronJob) => {
    setBusyId(job.id);
    try {
      await api.post(`/cron-jobs/${job.id}/run-now/`, {});
      await load();
      // Open history so the new running row (and its live session) is visible.
      setOpenJobId(job.id);
      try {
        const res = await api.get(`/cron-jobs/${job.id}/runs/`);
        setRuns(r => ({ ...r, [job.id]: Array.isArray(res.data) ? res.data : [] }));
      } catch {
        /* history refreshes on the next poll */
      }
      void refreshLiveForJobs([job.id]);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(typeof detail === 'string' && detail ? detail : 'Could not start the run.');
    } finally {
      setBusyId(null);
    }
  };

  const openHistory = async (job: CronJob) => {
    if (openJobId === job.id) {
      setOpenJobId(null);
      (runs[job.id] ?? []).forEach(r => {
        const t = watchTimers.current[r.id];
        if (t) window.clearInterval(t);
        delete watchTimers.current[r.id];
      });
      setWatching(w => {
        const next = { ...w };
        (runs[job.id] ?? []).forEach(r => { delete next[r.id]; });
        return next;
      });
      return;
    }
    setOpenJobId(job.id);
    try {
      const res = await api.get(`/cron-jobs/${job.id}/runs/`);
      const rows: CronRun[] = Array.isArray(res.data) ? res.data : [];
      setRuns(r => ({ ...r, [job.id]: rows }));
      const latestFinished = rows.find(r => r.finished_at);
      void loadFiles(job.id, latestFinished?.id);
      const st = await api.get(`/cron-jobs/${job.id}/windows-task/`);
      setTaskStatus(s => ({ ...s, [job.id]: st.data?.exists ? `Task Scheduler: ${st.data.task_name}` : 'Task Scheduler: not synced (needs Windows + open backend once)' }));
      void refreshLiveForJobs([job.id]);
    } catch {
      setRuns(r => ({ ...r, [job.id]: job.recent_runs || [] }));
      void loadFiles(job.id);
    }
  };

  // Auto-refresh open history + liveness while any visible run is queued/running.
  useEffect(() => {
    if (!openJobId) return;
    const hasActive = (runs[openJobId] ?? []).some(r => r.status === 'queued' || r.status === 'running');
    if (!hasActive) return;
    const t = window.setInterval(async () => {
      try {
        const res = await api.get(`/cron-jobs/${openJobId}/runs/`);
        if (Array.isArray(res.data)) {
          const prev = runs[openJobId] ?? [];
          const wasActive = prev.some(r => r.status === 'queued' || r.status === 'running');
          const rows = res.data as CronRun[];
          const nowActive = rows.some(r => r.status === 'queued' || r.status === 'running');
          setRuns(r => ({ ...r, [openJobId]: rows }));
          if (wasActive && !nowActive) {
            // A run just finished (possibly with the app open): the runner
            // wrote its report file, so refresh the listing in place.
            const latest = rows.find(r => r.finished_at);
            void loadFiles(openJobId, latest?.id, filesByJob[openJobId]?.current || undefined);
          }
        }
      } catch {
        /* keep last known history */
      }
      void refreshLiveForJobs([openJobId]);
      try {
        const res = await api.get('/cron-jobs/', { params: { page_size: 100 } });
        setJobs(unwrapPaginated<CronJob>(res.data));
      } catch {
        /* keep last known jobs */
      }
    }, 5000);
    return () => window.clearInterval(t);
  }, [openJobId, runs, filesByJob, loadFiles, refreshLiveForJobs]);

  const deleteRun = async (jobId: string, runId: string) => {
    try {
      await api.delete(`/cron-runs/${runId}/`);
      stopWatching(runId);
      setRuns(r => ({ ...r, [jobId]: (r[jobId] || []).filter(x => x.id !== runId) }));
    } catch {
      setError('Could not delete the run.');
    }
  };

  const clearRuns = async (job: CronJob) => {
    if (!window.confirm(`Clear all history for "${job.name}"?`)) return;
    try {
      await api.post(`/cron-jobs/${job.id}/clear-runs/`, {});
      (runs[job.id] ?? []).forEach(r => stopWatching(r.id));
      setRuns(r => ({ ...r, [job.id]: [] }));
      await load();
    } catch {
      setError('Could not clear history.');
    }
  };

  const livePreRef = useRef<HTMLPreElement | null>(null);
  const autoOpenedRef = useRef(false);

  useEffect(() => {
    const el = livePreRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [watching]);

  // Auto-expand the form on first load when there is nothing yet.
  useEffect(() => {
    if (!loading && jobs.length === 0 && !autoOpenedRef.current) {
      autoOpenedRef.current = true;
      setShowForm(true);
    }
  }, [loading, jobs.length]);

  if (loading) return <div className="text-sm text-content-faint font-mono">Loading automations…</div>;

  const toolPresets = presets.filter(p => p.enabled && p.tool === form.tool);
  const selectedPrompt = prompts.find(p => p.id === promptId);
  const watchedIds = Object.keys(watching);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-extrabold text-content">Automations</h2>
        <p className="text-xs text-content-muted">Recurring LLM jobs — each run opens a cmd terminal and lets the agent work. Windows Task Scheduler runs them even with the app closed.</p>
      </div>
      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">{error}</div>}

      <div ref={formTopRef} className="rounded-2xl border border-line bg-surface p-4 scroll-mt-24">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold text-content">{editingId ? 'Edit automation' : 'New automation'}</h3>
          {editingId && <span className="rounded-md bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-black uppercase text-indigo-700 dark:text-indigo-300">editing</span>}
          <button
            type="button"
            onClick={() => { if (editingId) cancelEdit(); setShowForm(v => !v); }}
            aria-expanded={showForm}
            className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] font-black text-content-faint hover:text-content"
          >
            {showForm ? 'Hide' : (editingId ? 'Hide' : '+ New')}
          </button>
        </div>
        {showForm && (
        <>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-content-muted">Name
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Daily videogame news" className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content outline-none focus:border-indigo-400" />
          </label>
          <label className="text-xs font-semibold text-content-muted">Working directory
            <input value={form.working_directory} onChange={e => setForm({ ...form, working_directory: e.target.value })} placeholder="e.g. C:\work\automations" className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-content outline-none focus:border-indigo-400" />
            {defaultFolder ? <span className="mt-1 block text-[11px] font-normal text-content-faint">Default from Settings: {defaultFolder}</span> : null}
          </label>
          <label className="text-xs font-semibold text-content-muted">Python env (optional)
            <input value={form.python_env} onChange={e => setForm({ ...form, python_env: e.target.value })} placeholder="Optional virtualenv folder" className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-content outline-none focus:border-indigo-400" />
          </label>
          <label className="text-xs font-semibold text-content-muted">Agent
            <select value={form.tool} onChange={e => setForm({ ...form, tool: e.target.value as JobForm['tool'] })} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content outline-none focus:border-indigo-400">
              <option value="opencode">opencode</option>
              <option value="codex">codex</option>
              <option value="kilo">kilo</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-content-muted">Launch preset
            <select value={presetId} onChange={e => applyPreset(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs font-bold text-content outline-none focus:border-indigo-400">
              <option value="">Use preset…</option>
              {toolPresets.map(p => <option key={p.id} value={p.id}>{p.label} · {p.modelId} · {p.reasoningEffort} · {p.mode}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-content-muted">Model
            <input list={form.tool === 'opencode' && opencodeModels.length > 0 ? 'automation-opencode-models' : 'automation-model-presets'} value={form.model_id} onChange={e => setForm({ ...form, model_id: e.target.value })} placeholder="provider/model or model name" className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-content outline-none focus:border-indigo-400" />
          </label>
          <datalist id="automation-model-presets">{toolPresets.map(p => <option key={p.id} value={p.modelId}>{p.label}</option>)}</datalist>
          <datalist id="automation-opencode-models">{opencodeModels.map(m => <option key={m} value={m} />)}</datalist>
          {form.tool === 'opencode' && <p className="text-[11px] text-content-faint sm:col-span-2">OpenCode needs <span className="font-mono">provider/model</span> — pick from the list. Bare names are resolved automatically when unambiguous.</p>}
          <label className="text-xs font-semibold text-content-muted">Effort
            <select value={form.reasoning_effort} onChange={e => setForm({ ...form, reasoning_effort: e.target.value as JobForm['reasoning_effort'] })} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content outline-none focus:border-indigo-400">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-content-muted">Mode
            <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value as JobForm['mode'] })} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content outline-none focus:border-indigo-400">
              <option value="build">build</option>
              <option value="plan">plan</option>
            </select>
          </label>
          {toolPresets.length === 0 && <p className="text-[11px] text-content-faint sm:col-span-2">No enabled presets for {form.tool}. Pick model/effort manually or add presets in Settings.</p>}
          <label className="text-xs font-semibold text-content-muted">Schedule
            <select value={form.schedule_kind} onChange={e => setForm({ ...form, schedule_kind: e.target.value as JobForm['schedule_kind'] })} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content outline-none focus:border-indigo-400">
              <option value="daily">Daily at time</option>
              <option value="every_hours">Every X hours</option>
              <option value="cron">Cron (m h * * *)</option>
            </select>
          </label>
          <label className="text-xs font-semibold text-content-muted">{form.schedule_kind === 'daily' ? 'Time (HH:MM)' : form.schedule_kind === 'every_hours' ? 'Hours' : 'Cron expr'}
            <input value={form.schedule_value} onChange={e => setForm({ ...form, schedule_value: e.target.value })} placeholder={form.schedule_kind === 'daily' ? '09:00' : form.schedule_kind === 'every_hours' ? '6' : '30 8 * * *'} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content outline-none focus:border-indigo-400" />
          </label>
          <label className="text-xs font-semibold text-content-muted">Timeout (min)
            <input type="number" min={1} max={120} value={form.timeout_minutes} onChange={e => setForm({ ...form, timeout_minutes: Number(e.target.value) || 15 })} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content outline-none focus:border-indigo-400" />
          </label>
          <label className="text-xs font-semibold text-content-muted">Notify
            <select value={form.notify_mode} onChange={e => setForm({ ...form, notify_mode: e.target.value as JobForm['notify_mode'] })} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content outline-none focus:border-indigo-400">
              <option value="on_alert">On alert</option>
              <option value="always">Always</option>
              <option value="on_fail">On fail</option>
            </select>
          </label>
          <div className="sm:col-span-2 rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-content">Saved prompt (.md library)</span>
              <select value={promptId} onChange={e => useSavedPrompt(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs font-bold text-content outline-none focus:border-indigo-400">
                <option value="">Choose saved prompt…</option>
                {prompts.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              {promptId && <button type="button" onClick={deleteSavedPrompt} disabled={promptBusy} className="rounded-lg px-2 py-1.5 text-[11px] font-bold text-rose-600 disabled:opacity-40 dark:text-rose-400">Delete</button>}
            </div>
            {selectedPrompt && <p className="mt-2 line-clamp-2 text-[11px] text-content-faint">{selectedPrompt.content.slice(0, 220)}</p>}
            {prompts.length === 0 && <p className="mt-2 text-[11px] text-content-faint">No saved prompts yet. Type below or upload an .md file, then save it.</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <input value={saveTitle} onChange={e => setSaveTitle(e.target.value)} placeholder="Saved prompt title" aria-label="Saved prompt title" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs text-content outline-none focus:border-indigo-400" />
              <button type="button" onClick={saveCurrentPrompt} disabled={promptBusy} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-40">{promptBusy ? 'Saving…' : 'Save current as…'}</button>
              <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-black text-content">Upload .md</button>
              <input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={e => void onUploadMd(e.target.files?.[0])} />
            </div>
          </div>
          <label className="text-xs font-semibold text-content-muted sm:col-span-2">Agent prompt
            <textarea value={form.prompt_template} onChange={e => setForm({ ...form, prompt_template: e.target.value })} rows={4} placeholder="e.g. Check these Greek shops for X shoes under €50. Set alert=true when the price drops below €50…" className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content outline-none focus:border-indigo-400" />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={create} disabled={saving}>{saving ? (editingId ? 'Saving…' : 'Creating…') : (editingId ? 'Save changes' : 'Create automation')}</Button>
          {editingId && <Button size="sm" onClick={cancelEdit} disabled={saving}>Cancel</Button>}
        </div>
        </>
        )}
      </div>

      <div className="space-y-3">
        {jobs.length === 0 && <div className="rounded-2xl border border-line bg-surface p-4 text-xs text-content-muted">No automations yet. Use + New above to create one.</div>}
        {jobs.map(job => {
          const history = runs[job.id] ?? job.recent_runs ?? [];
          return (
            <div key={job.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase ${job.enabled ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-slate-500/15 text-slate-500'}`}>{job.enabled ? 'on' : 'off'}</span>
                <span className="text-sm font-bold text-content">{job.name}</span>
                <span className="font-mono text-[11px] text-content-muted">{job.working_directory}</span>
                <span className="text-[11px] text-content-muted">{scheduleLabel(job)} · {job.tool}/{job.mode}{job.model_id ? ` · ${job.model_id} (${job.reasoning_effort || 'medium'})` : ''} · {job.timeout_minutes}min</span>
                {job.last_status && <span className="text-[11px] font-mono text-content-muted">last: {job.last_status}</span>}
                <span className="ml-auto flex gap-1.5">
                  <Button size="sm" onClick={() => runNow(job)} disabled={busyId === job.id}>Run now</Button>
                  <Button size="sm" onClick={() => openHistory(job)}>{openJobId === job.id ? 'Hide' : 'History'}</Button>
                  <Button size="sm" onClick={() => startEdit(job)} disabled={busyId === job.id}>Edit</Button>
                  <Button size="sm" onClick={() => toggle(job)} disabled={busyId === job.id}>{job.enabled ? 'Disable' : 'Enable'}</Button>
                  <Button size="sm" onClick={() => remove(job)} disabled={busyId === job.id}>Delete</Button>
                </span>
              </div>
              {taskStatus[job.id] && <div className="mt-1 font-mono text-[10px] text-content-muted">{taskStatus[job.id]}</div>}
              {openJobId === job.id && (() => {
                const activeWatchId = watchedIds.find(id => history.some(r => r.id === id));
                const activeWatch = activeWatchId ? watching[activeWatchId] : undefined;
                const activeRun = activeWatchId ? history.find(r => r.id === activeWatchId) : undefined;
                return (
                <div className="mt-3 space-y-3 border-t border-line pt-3">
                  <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-content">Run history</span>
                    {history.length > 0 && <button type="button" onClick={() => clearRuns(job)} className="text-[11px] font-bold text-rose-600 dark:text-rose-400">Clear all</button>}
                  </div>
                  {history.length === 0 && <div className="text-[11px] text-content-muted">No runs yet.</div>}
                  {history.some(r => r.status === 'queued' || r.status === 'running') && (liveByJob[job.id]?.length
                    ? <div className="text-[11px] text-emerald-700 dark:text-emerald-300">● Live session active — open a running run and Watch live.</div>
                    : <div className="text-[11px] text-content-faint">A run is active. Live output is available only while the app stays open; scheduled runs with the app closed appear here after they finish.</div>)}
                  {history.map(run => {
                    const isActive = run.status === 'queued' || run.status === 'running';
                    const liveSession = (liveByJob[job.id] || []).find(s => s.id === run.terminal_id)
                      || (run.terminal_id ? undefined : (liveByJob[job.id] || [])[0]);
                    const watch = watching[run.id];
                    const result = (run.structured_result ?? {}) as Record<string, unknown>;
                    const summary = typeof result.summary === 'string' ? result.summary : '';
                    const alert = result.alert === true;
                    const statusStyle = run.status === 'passed'
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : (run.status === 'failed' || run.status === 'timeout' || run.status === 'needs_attention')
                        ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                        : 'bg-slate-500/15 text-slate-500';
                    const expanded = !!expandedRuns[run.id];
                    const toggleExpanded = () => setExpandedRuns(m => ({ ...m, [run.id]: !m[run.id] }));
                    const copyTail = async () => {
                      try {
                        await navigator.clipboard.writeText(run.output_tail || '');
                        setCopiedRunId(run.id);
                        window.setTimeout(() => setCopiedRunId(c => (c === run.id ? null : c)), 1500);
                      } catch {
                        /* clipboard unavailable */
                      }
                    };
                    return (
                    <div key={run.id} className="rounded-xl border border-line bg-surface-2 p-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className={`rounded px-1.5 py-px font-mono font-bold ${statusStyle}`}>{run.status}</span>
                        {alert && <span className="rounded bg-amber-500/20 px-1.5 py-px text-[10px] font-black uppercase text-amber-700 dark:text-amber-300">alert</span>}
                        <span className="text-content-muted">{run.trigger} · {new Date(run.created_at).toLocaleString()}</span>
                        {run.notified && <span className="rounded bg-indigo-500/15 px-1 py-px text-[10px] font-bold text-indigo-700 dark:text-indigo-300">notified</span>}
                        {isActive && liveSession && (
                          watch
                            ? <button type="button" onClick={() => stopWatching(run.id)} className="font-bold text-content-faint hover:text-content">Hide live</button>
                            : <button type="button" onClick={() => startWatching(run)} className="font-bold text-indigo-600 dark:text-indigo-300">Watch live</button>
                        )}
                        <button type="button" onClick={toggleExpanded} aria-expanded={expanded} className="font-bold text-indigo-600 hover:underline dark:text-indigo-300">{expanded ? 'Hide' : 'Details'}</button>
                        <button type="button" onClick={() => deleteRun(job.id, run.id)} className="ml-auto font-bold text-rose-600 dark:text-rose-400">Delete</button>
                      </div>
                      {summary && <p className={`mt-1.5 text-xs leading-relaxed text-content ${expanded ? 'whitespace-pre-wrap' : 'line-clamp-2'}`}>{summary}</p>}
                      {isActive && !liveSession && <div className="mt-1 text-[11px] text-content-faint">No live session — the run started with the app closed or already finished its terminal.</div>}
                      {run.failure_reason && <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{expanded ? run.failure_reason : run.failure_reason.slice(0, 220)}</div>}
                      {expanded && (
                        <div className="mt-2 space-y-2 border-t border-line pt-2">
                          <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10px] text-content-faint">
                            {run.started_at && <span>started: {new Date(run.started_at).toLocaleString()}</span>}
                            {run.finished_at && <span>finished: {new Date(run.finished_at).toLocaleString()}</span>}
                            <span>trigger: {run.trigger}</span>
                          </div>
                          {Object.keys(result).length > 0 && (
                            <details open>
                              <summary className="cursor-pointer text-[11px] font-bold text-content-faint hover:text-content">Result JSON</summary>
                              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-content-muted">{JSON.stringify(result, null, 2)}</pre>
                            </details>
                          )}
                          {run.output_tail ? (
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-bold text-content-faint">Console output</span>
                                <button type="button" onClick={copyTail} className="text-[11px] font-bold text-indigo-600 dark:text-indigo-300">{copiedRunId === run.id ? 'Copied!' : 'Copy'}</button>
                              </div>
                              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-content-muted">{run.output_tail}</pre>
                            </div>
                          ) : (
                            <div className="text-[11px] text-content-faint">No console output captured.</div>
                          )}
                        </div>
                      )}
                      {!expanded && run.output_tail && (
                        <details className="mt-1.5">
                          <summary className="cursor-pointer text-[11px] font-bold text-content-faint hover:text-content">Console output</summary>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-content-muted">{run.output_tail.slice(-1500)}</pre>
                        </details>
                      )}
                    </div>
                    );
                  })}
                  </div>
                  <div className="rounded-xl border border-line bg-surface-2 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-content">Result files</span>
                      {filesByJob[job.id]?.directory && <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-content-faint">{filesByJob[job.id].directory}</span>}
                      <span className="ml-auto flex flex-wrap items-center gap-2">
                        {history.length > 0 && (
                          <select
                            value={highlightRunId[job.id] ?? ''}
                            onChange={e => void loadFiles(job.id, e.target.value || undefined)}
                            aria-label="Highlight files changed in run"
                            className="max-w-44 truncate rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-bold text-content outline-none focus:border-indigo-400"
                          >
                            <option value="">Highlight: off</option>
                            {history.slice(0, 10).map(r => (
                              <option key={r.id} value={r.id}>{r.status} · {new Date(r.created_at).toLocaleString()}</option>
                            ))}
                          </select>
                        )}
                        <button type="button" onClick={() => void loadFiles(job.id, highlightRunId[job.id] || undefined)} disabled={!!filesBusy[job.id]} className="text-[11px] font-bold text-content-faint hover:text-content disabled:opacity-40">{filesBusy[job.id] ? 'Loading…' : 'Refresh'}</button>
                        <button type="button" onClick={() => void openFolder(job)} className="text-[11px] font-bold text-indigo-600 dark:text-indigo-300">Open in Explorer</button>
                      </span>
                    </div>
                    {folderMsg[job.id] && <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{folderMsg[job.id]}</div>}
                    {filesByJob[job.id]?.error && <div className="mt-1 text-[11px] text-content-faint">{filesByJob[job.id].error}</div>}
                    {filesByJob[job.id]?.current && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
                        <button type="button" onClick={() => void loadFiles(job.id, undefined, undefined)} className="font-bold text-indigo-600 hover:underline dark:text-indigo-300">working dir</button>
                        {filesByJob[job.id].current.split('/').map((seg, i, segs) => (
                          <React.Fragment key={i}>
                            <span className="text-content-faint">/</span>
                            {i === segs.length - 1
                              ? <span className="font-bold text-content">{seg}</span>
                              : <button type="button" onClick={() => void loadFiles(job.id, undefined, segs.slice(0, i + 1).join('/'))} className="font-bold text-indigo-600 hover:underline dark:text-indigo-300">{seg}</button>}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                    {(filesByJob[job.id]?.files ?? []).length === 0 && !filesByJob[job.id]?.error && (
                      <div className="mt-1 text-[11px] text-content-faint">{filesBusy[job.id] ? 'Loading files…' : 'No files here yet.'}</div>
                    )}
                    {(filesByJob[job.id]?.files ?? []).length > 0 && (
                      <ul className="mt-2 divide-y divide-line">
                        {filesByJob[job.id].files.map(f => (
                          <li key={f.path} className="flex flex-wrap items-center gap-2 py-1 text-[11px]">
                            {f.is_dir
                              ? <button type="button" onClick={() => void loadFiles(job.id, undefined, filesByJob[job.id].current ? `${filesByJob[job.id].current}/${f.name}` : f.name)} className="min-w-0 truncate font-mono font-bold text-content hover:underline">{f.name}/</button>
                              : <button type="button" onClick={() => void openPreview(f.path)} className="min-w-0 truncate font-mono font-bold text-indigo-600 hover:underline dark:text-indigo-300">{f.name}</button>}
                            {f.changed_in_run && <span className="rounded bg-emerald-500/15 px-1 py-px text-[10px] font-bold text-emerald-700 dark:text-emerald-300">changed in run</span>}
                            <span className="ml-auto shrink-0 text-[10px] text-content-faint">{f.is_dir ? '' : `${formatBytes(f.size)} · `}{new Date(f.modified).toLocaleString()}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {activeWatch && activeRun && (
                    <aside className="w-full rounded-xl border border-line bg-surface-2 p-2.5" aria-label="Live console">
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="rounded bg-emerald-500/15 px-1 py-px text-[10px] font-bold text-emerald-700 dark:text-emerald-300">{activeWatch.live ? 'live' : 'ended'}</span>
                        <span className="font-mono font-bold text-content">{activeRun.status}</span>
                        <span className="truncate text-content-faint">{activeRun.trigger} · {new Date(activeRun.created_at).toLocaleString()}</span>
                        <button type="button" onClick={() => stopWatching(activeRun.id)} className="ml-auto font-bold text-content-faint hover:text-content">Hide</button>
                      </div>
                      {activeWatch.note && <div className="mt-1 text-[11px] text-content-faint">{activeWatch.note}</div>}
                      <pre ref={livePreRef} className="mt-1 max-h-[50vh] min-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-content">{activeWatch.text ? sanitizeTerminalPrompt(activeWatch.text).slice(-6000) : (activeWatch.live ? 'Connecting to live session…' : 'No live output captured yet.')}</pre>
                    </aside>
                  )}
                </div>
                );
              })()}
            </div>
          );
        })}
      </div>
      {(preview || previewBusy || previewError) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => { setPreview(null); setPreviewError(''); }}>
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl border border-line bg-surface p-4" onClick={e => e.stopPropagation()}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs font-bold text-content">{preview?.name ?? 'File preview'}</span>
              {preview && <span className="text-[10px] text-content-faint">{formatBytes(preview.size)}</span>}
              <button type="button" onClick={() => { setPreview(null); setPreviewError(''); }} className="ml-auto rounded-lg border border-line px-2.5 py-1 text-[11px] font-bold text-content">Close</button>
            </div>
            {previewBusy && <div className="mt-3 text-xs text-content-muted">Loading preview…</div>}
            {previewError && <div className="mt-3 text-xs text-rose-600 dark:text-rose-400">{previewError}</div>}
            {preview?.kind === 'text' && (
              <>
                {preview.truncated && <div className="mt-2 text-[11px] text-content-faint">Showing first 200 KB.</div>}
                <pre className="mt-2 max-h-[60vh] overflow-auto whitespace-pre-wrap font-mono text-[11px] text-content">{preview.content}</pre>
              </>
            )}
            {preview?.kind === 'image' && (
              <img src={preview.data_url} alt={preview.name} className="mt-2 max-h-[65vh] w-full object-contain rounded-xl border border-line" />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

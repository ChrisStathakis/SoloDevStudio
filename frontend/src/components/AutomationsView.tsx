import React, { useCallback, useEffect, useState } from 'react';
import { api, unwrapPaginated } from '../services/api';
import { CronJob, CronRun } from '../types';
import { Button } from './ui';

type JobForm = {
  name: string;
  working_directory: string;
  python_env: string;
  tool: 'opencode' | 'codex' | 'kilo';
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

  useEffect(() => {
    void load();
  }, [load]);

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
      await api.post('/cron-jobs/', { ...form, name: form.name.trim(), prompt_template: form.prompt_template.trim() });
      setForm(EMPTY_FORM);
      await load();
    } catch {
      setError('Could not create the automation. Check that the directory exists.');
    } finally {
      setSaving(false);
    }
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
    } catch {
      setError('Could not start the run.');
    } finally {
      setBusyId(null);
    }
  };

  const openHistory = async (job: CronJob) => {
    if (openJobId === job.id) {
      setOpenJobId(null);
      return;
    }
    setOpenJobId(job.id);
    try {
      const res = await api.get(`/cron-jobs/${job.id}/runs/`);
      setRuns(r => ({ ...r, [job.id]: Array.isArray(res.data) ? res.data : [] }));
      const st = await api.get(`/cron-jobs/${job.id}/windows-task/`);
      setTaskStatus(s => ({ ...s, [job.id]: st.data?.exists ? `Task Scheduler: ${st.data.task_name}` : 'Task Scheduler: not synced (needs Windows + open backend once)' }));
    } catch {
      setRuns(r => ({ ...r, [job.id]: job.recent_runs || [] }));
    }
  };

  const deleteRun = async (jobId: string, runId: string) => {
    try {
      await api.delete(`/cron-runs/${runId}/`);
      setRuns(r => ({ ...r, [jobId]: (r[jobId] || []).filter(x => x.id !== runId) }));
    } catch {
      setError('Could not delete the run.');
    }
  };

  const clearRuns = async (job: CronJob) => {
    if (!window.confirm(`Clear all history for "${job.name}"?`)) return;
    try {
      await api.post(`/cron-jobs/${job.id}/clear-runs/`, {});
      setRuns(r => ({ ...r, [job.id]: [] }));
      await load();
    } catch {
      setError('Could not clear history.');
    }
  };

  if (loading) return <div className="text-sm text-content-faint font-mono">Loading automations…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-extrabold text-content">Automations</h2>
        <p className="text-xs text-content-muted">Recurring LLM jobs — each run opens a cmd terminal and lets the agent work. Windows Task Scheduler runs them even with the app closed.</p>
      </div>
      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">{error}</div>}

      <div className="rounded-2xl border border-line bg-surface p-4">
        <h3 className="mb-3 text-sm font-bold text-content">New automation</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-content-muted">Name
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Daily videogame news" className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content outline-none focus:border-indigo-400" />
          </label>
          <label className="text-xs font-semibold text-content-muted">Working directory
            <input value={form.working_directory} onChange={e => setForm({ ...form, working_directory: e.target.value })} placeholder="e.g. C:\work\automations" className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-content outline-none focus:border-indigo-400" />
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
          <label className="text-xs font-semibold text-content-muted">Mode
            <select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value as JobForm['mode'] })} className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content outline-none focus:border-indigo-400">
              <option value="build">build</option>
              <option value="plan">plan</option>
            </select>
          </label>
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
          <label className="text-xs font-semibold text-content-muted sm:col-span-2">Agent prompt
            <textarea value={form.prompt_template} onChange={e => setForm({ ...form, prompt_template: e.target.value })} rows={4} placeholder="e.g. Check these Greek shops for X shoes under €50. Set alert=true when the price drops below €50…" className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-content outline-none focus:border-indigo-400" />
          </label>
        </div>
        <div className="mt-3"><Button size="sm" onClick={create} disabled={saving}>{saving ? 'Creating…' : 'Create automation'}</Button></div>
      </div>

      <div className="space-y-3">
        {jobs.length === 0 && <div className="rounded-2xl border border-line bg-surface p-4 text-xs text-content-muted">No automations yet. Create one above.</div>}
        {jobs.map(job => {
          const history = runs[job.id] ?? job.recent_runs ?? [];
          return (
            <div key={job.id} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase ${job.enabled ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-slate-500/15 text-slate-500'}`}>{job.enabled ? 'on' : 'off'}</span>
                <span className="text-sm font-bold text-content">{job.name}</span>
                <span className="font-mono text-[11px] text-content-muted">{job.working_directory}</span>
                <span className="text-[11px] text-content-muted">{scheduleLabel(job)} · {job.tool}/{job.mode} · {job.timeout_minutes}min</span>
                {job.last_status && <span className="text-[11px] font-mono text-content-muted">last: {job.last_status}</span>}
                <span className="ml-auto flex gap-1.5">
                  <Button size="sm" onClick={() => runNow(job)} disabled={busyId === job.id}>Run now</Button>
                  <Button size="sm" onClick={() => openHistory(job)}>{openJobId === job.id ? 'Hide' : 'History'}</Button>
                  <Button size="sm" onClick={() => toggle(job)} disabled={busyId === job.id}>{job.enabled ? 'Disable' : 'Enable'}</Button>
                  <Button size="sm" onClick={() => remove(job)} disabled={busyId === job.id}>Delete</Button>
                </span>
              </div>
              {taskStatus[job.id] && <div className="mt-1 font-mono text-[10px] text-content-muted">{taskStatus[job.id]}</div>}
              {openJobId === job.id && (
                <div className="mt-3 space-y-2 border-t border-line pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-content">Run history</span>
                    {history.length > 0 && <button type="button" onClick={() => clearRuns(job)} className="text-[11px] font-bold text-rose-600 dark:text-rose-400">Clear all</button>}
                  </div>
                  {history.length === 0 && <div className="text-[11px] text-content-muted">No runs yet.</div>}
                  {history.map(run => (
                    <div key={run.id} className="rounded-xl border border-line bg-surface-2 p-2.5">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-mono font-bold text-content">{run.status}</span>
                        <span className="text-content-muted">{run.trigger} · {new Date(run.created_at).toLocaleString()}</span>
                        {run.notified && <span className="rounded bg-indigo-500/15 px-1 py-px text-[10px] font-bold text-indigo-700 dark:text-indigo-300">notified</span>}
                        <button type="button" onClick={() => deleteRun(job.id, run.id)} className="ml-auto font-bold text-rose-600 dark:text-rose-400">Delete</button>
                      </div>
                      {run.failure_reason && <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{run.failure_reason}</div>}
                      {run.output_tail && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-content-muted">{run.output_tail.slice(-1500)}</pre>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

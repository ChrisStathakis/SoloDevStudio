import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Play, Check, X, RotateCcw, Terminal as TerminalIcon, ShieldAlert, Trash2 } from 'lucide-react';
import { api, unwrapPaginated } from '../services/api';
import { buildInitializationCommand, formatBracketedPaste, CODEX_READY_PATTERNS, KILO_READY_PATTERNS, OPENCODE_READY_PATTERNS, CODEX_TRUST_PATTERNS } from '../services/initialization';
import type { OrchestratorRun, OrchestratorStep, ProjectStage } from '../types';
import type { TerminalDrawerHandle } from './TerminalDrawer';
import { useToast } from './Toaster';
import { FRONTEND_BUILD_ID } from '../services/buildIdentity';
import { ProjectContextPicker } from './ProjectContextPicker';
import { CONTEXT_SECTIONS, type ContextSection } from '../services/projectContext';

interface Props {
  projectId: string;
  currentStage: ProjectStage;
  terminalRef: React.RefObject<TerminalDrawerHandle | null>;
}

const STATUS_LABEL: Record<string, string> = {
  planning: 'Planning',
  awaiting_plan: 'Awaiting plan approval',
  running: 'Running',
  paused: 'Paused',
  needs_approval: 'Needs approval',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const OrchestratorTab: React.FC<Props> = ({ projectId, currentStage, terminalRef }) => {
  const [runs, setRuns] = useState<OrchestratorRun[]>([]);
  const [goal, setGoal] = useState('');
  const [phaseMode, setPhaseMode] = useState<'goal' | 'goal_and_phases'>('goal');
  const [phaseStages, setPhaseStages] = useState<string[]>([currentStage]);
  const [phaseSections, setPhaseSections] = useState<ContextSection[]>([...CONTEXT_SECTIONS]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [cleaningPrevious, setCleaningPrevious] = useState(false);
  const [presets, setPresets] = useState<Array<{ tool: string; modelId: string; label: string }>>([]);
  const [buildMismatch, setBuildMismatch] = useState(false);
  const refreshInFlight = useRef(false);
  const seenTerminalIds = useRef<Set<string>>(new Set());
  const { confirm } = useToast();

  const refresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const res = await api.get<OrchestratorRun[]>(`/projects/${projectId}/orchestrator/runs/`);
      const nextRuns = Array.isArray(res.data) ? res.data : [];
      setRuns(nextRuns);
      const activeSteps = nextRuns.flatMap(r => r.steps || []).filter(s => ['sending', 'running'].includes(s.status) && s.terminal_id);
      if (activeSteps.length && terminalRef.current) {
        try {
          const terminals = await api.get('/terminals/', { params: { alive: 'true', project: projectId } });
          const liveSessions = Array.isArray(terminals.data) ? terminals.data as any[] : [];
          const byId = new Map<string, any>(liveSessions.map((item: any) => [String(item.id), item]));
          activeSteps.forEach(step => {
            const session = byId.get(step.terminal_id);
            if (session) terminalRef.current?.register({ ...session, mode: 'cmd' });
          });
          const candidate = activeSteps.find(step => step.status === 'sending' && !seenTerminalIds.current.has(step.terminal_id))
            || activeSteps.find(step => !seenTerminalIds.current.has(step.terminal_id));
          if (candidate) {
            const session = byId.get(candidate.terminal_id);
            if (session) {
              seenTerminalIds.current.add(candidate.terminal_id);
              await terminalRef.current.adopt({ ...session, mode: 'cmd' });
            }
          }
        } catch (e: any) {
          setError(e?.response?.data?.error || e?.message || 'Unable to attach the orchestrator terminal.');
        }
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Unable to load orchestrator runs.');
    } finally {
      refreshInFlight.current = false;
    }
  }, [projectId, terminalRef]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    setPhaseStages([currentStage]);
    setPhaseSections([...CONTEXT_SECTIONS]);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [healthResponse, desktopSettings] = await Promise.all([
          api.get('/health/'),
          window.solodevDesktop ? window.solodevDesktop.getSettings() : Promise.resolve(null),
        ]);
        const ids = [
          FRONTEND_BUILD_ID,
          String(healthResponse.data?.build_id || ''),
          String(desktopSettings?.buildId || ''),
        ].filter(Boolean);
        if (!cancelled) setBuildMismatch(new Set(ids).size > 1);
      } catch {
        if (!cancelled) setBuildMismatch(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/launcher-model-presets/', { params: { page_size: 100 } });
        const rows = unwrapPaginated<any>(res.data as any).filter((p: any) => p?.enabled !== false);
        if (!cancelled) setPresets(rows.map((p: any) => ({
          tool: p?.tool === 'codex' || p?.tool === 'kilo' ? p.tool : 'opencode',
          modelId: String(p?.model_id || ''),
          label: String(p?.label || p?.model_id || ''),
        })).filter(p => p.modelId));
      } catch {
        /* presets are suggestions only; free text still works */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const patchStep = useCallback(async (stepId: string, patch: Record<string, string>) => {
    setBusyStep(stepId);
    setError(null);
    try {
      await api.patch(`/orchestrator/steps/${stepId}/`, patch);
      await refresh();
    } catch (e: any) {
      const d = e?.response?.data;
      setError(typeof d === 'string' ? d : d?.error || d?.model_id || d?.tool || 'Unable to update step.');
    } finally {
      setBusyStep(null);
    }
  }, [refresh]);

  const createRun = async () => {
    if (!goal.trim() || loading) return;
    if (buildMismatch) {
      setError('The desktop, frontend, and backend builds do not match. Restart or reinstall the desktop app before starting a plan.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { goal: goal.trim(), max_parallel: 2 };
      if (phaseMode === 'goal_and_phases') {
        payload.phase_mode = 'goal_and_phases';
        payload.stages = phaseStages.join(',');
        payload.sections = phaseSections.join(',');
      }
      const res = await api.post(`/projects/${projectId}/orchestrator/runs/`, payload);
      setGoal('');
      setRuns(prev => [res.data, ...prev]);
    } catch (e: any) {
      const d = e?.response?.data;
      setError(typeof d === 'string' ? d : d?.goal || d?.error || 'Unable to create run.');
    } finally {
      setLoading(false);
    }
  };

  const clearPreviousPlans = async () => {
    const olderCount = Math.max(0, runs.length - 1);
    if (olderCount < 1 || cleaningPrevious) return;
    const ok = await confirm({
      title: `Clear ${olderCount} previous orchestrator plan${olderCount === 1 ? '' : 's'}?`,
      description: 'The newest plan will remain. Older plan history and any active terminals attached to those plans will be removed. Project files and Git worktrees will not be changed.',
      confirmLabel: 'Clear previous plans',
      danger: true,
    });
    if (!ok) return;
    setCleaningPrevious(true);
    setError(null);
    try {
      await api.delete(`/projects/${projectId}/orchestrator/runs/previous/`);
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Unable to clear previous plans.');
    } finally {
      setCleaningPrevious(false);
    }
  };

  const mutateRun = async (runId: string, suffix: string) => {
    setError(null);
    if (buildMismatch && (suffix === 'approve-plan' || suffix === 'resume')) {
      setError('The desktop, frontend, and backend builds do not match. Restart or reinstall the desktop app before starting this run.');
      return;
    }
    try {
      await api.post(`/orchestrator/runs/${runId}/${suffix}/`);
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Run action failed.');
    }
  };

  const stepAction = async (step: OrchestratorStep, op: string) => {
    setBusyStep(step.id);
    setError(null);
    try {
      if (op === 'dispatch') {
        // Semi-auto: server allocates a visible orchestrator terminal + prompt;
        // we paste via the existing TerminalDrawer handshake path.
        const res = await api.post(`/orchestrator/steps/${step.id}/action/`, { op });
        const sessionId = res.data?.id as string | undefined;
        const prompt = res.data?.prompt as string | undefined;
        if (sessionId && prompt && terminalRef?.current) {
          const drawer = terminalRef.current;
          await drawer.adopt({ ...res.data, mode: 'cmd' });
          const initialRevision = await drawer.waitForOutputIdle(sessionId);
          const command = buildInitializationCommand({
            tool: step.tool === 'codex' || step.tool === 'kilo' ? step.tool : 'opencode',
            model: step.model_id || 'default',
            reasoningEffort: step.reasoning_effort,
            mode: step.mode,
          });
          await drawer.sendInput(`${command}\r`, sessionId);
          const ready = step.tool === 'codex'
            ? CODEX_READY_PATTERNS
            : step.tool === 'kilo' ? KILO_READY_PATTERNS : OPENCODE_READY_PATTERNS;
          const marker = await drawer.waitForOutputMarker(sessionId, {
            afterRevision: initialRevision,
            ready,
            blocked: step.tool === 'codex' ? CODEX_TRUST_PATTERNS : [],
            timeoutMs: 90000,
          });
          if (marker === 'blocked') {
            throw new Error('The agent is waiting for trust approval in the terminal. Approve it, then retry this step.');
          }
          await drawer.sendPastedText(formatBracketedPaste(prompt), sessionId);
          await new Promise(resolve => window.setTimeout(resolve, 450));
          await drawer.sendInput('\r', sessionId);
          await api.post(`/orchestrator/steps/${step.id}/action/`, { op: 'submitted' });
        }
      } else {
        await api.post(`/orchestrator/steps/${step.id}/action/`, { op });
      }
      await refresh();
    } catch (e: any) {
      if (op === 'dispatch') {
        try { await api.post(`/orchestrator/steps/${step.id}/action/`, { op: 'retry' }); } catch { /* preserve original delivery error */ }
      }
      setError(e?.response?.data?.error || `Step ${op} failed.`);
    } finally {
      setBusyStep(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-500" />
            <h3 className="text-xs font-black uppercase tracking-[0.2em] font-mono">Step launcher</h3>
          </div>
          {runs.length > 1 && (
            <button
              type="button"
              onClick={() => void clearPreviousPlans()}
              disabled={cleaningPrevious}
              className="px-2.5 py-1.5 rounded-lg border border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-50 text-[11px] font-bold flex items-center gap-1"
              title="Delete older orchestrator plans and preserve the newest plan"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {cleaningPrevious ? 'Clearing…' : 'Clear previous plans'}
            </button>
          )}
        </div>
        <p className="text-xs text-content-faint font-mono">
          Goal → review the proposed graph → approve once → isolated agents run automatically (up to the configured parallelism). The app verifies their reports and checks, pauses on risk or failure, and shows every terminal and merge decision.
        </p>
        {buildMismatch && <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 px-3 py-2 text-xs text-rose-300" role="alert">Desktop, frontend, and backend build IDs do not match. Restart or reinstall the desktop app before starting or resuming an orchestrator run.</div>}
        <div className="flex gap-2">
          <input
            value={goal}
            onChange={e => setGoal(e.target.value)}
            placeholder="e.g. Implement login form + validation + tests"
            className="flex-1 px-3 py-2 rounded-xl bg-surface-2 border border-line text-sm"
          />
          <button
            type="button"
            onClick={createRun}
            disabled={loading || goal.trim().length < 4}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-black"
          >
            {loading ? 'Planning…' : 'Plan goal'}
          </button>
        </div>
        {error && <div className="text-xs text-rose-500 font-mono">{error}</div>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] font-black uppercase tracking-wider text-content-faint font-mono">Run mode</span>
          <button
            type="button"
            onClick={() => setPhaseMode('goal')}
            aria-pressed={phaseMode === 'goal'}
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold ${phaseMode === 'goal'
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'bg-surface-2 border-line text-content-faint hover:text-content'}`}
          >
            Goal only
          </button>
          <button
            type="button"
            onClick={() => setPhaseMode('goal_and_phases')}
            aria-pressed={phaseMode === 'goal_and_phases'}
            title="Inject the selected phases into planning and every step prompt"
            className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-bold ${phaseMode === 'goal_and_phases'
              ? 'bg-indigo-600 border-indigo-600 text-white'
              : 'bg-surface-2 border-line text-content-faint hover:text-content'}`}
          >
            Goal + phases
          </button>
        </div>
        {phaseMode === 'goal_and_phases' && (
          <div className="rounded-2xl border border-line bg-surface-2 p-3">
            <ProjectContextPicker
              currentStage={currentStage}
              value={{ stages: phaseStages, sections: phaseSections }}
              onChange={next => { setPhaseStages(next.stages); setPhaseSections(next.sections); }}
              compact
            />
          </div>
        )}
      </div>

      {runs.map(run => {
        const runCanChange = !['completed', 'cancelled'].includes(run.status);
        const coordinatorStarting = run.status === 'running'
          && run.steps.some(step => step.status === 'queued')
          && !run.steps.some(step => ['sending', 'running'].includes(step.status));
        return (
        <div key={run.id} className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-bold">{run.goal}</div>
              <div className="text-[11px] font-mono text-content-faint">{coordinatorStarting ? 'Starting coordinator' : STATUS_LABEL[run.status] || run.status} · {run.steps.length} steps</div>
              {(run.last_event as Record<string, unknown> | undefined)?.phase_mode === 'goal_and_phases' && (
                <div className="mt-1 inline-flex items-center px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/25 text-[11px] font-mono text-indigo-700 dark:text-indigo-300">
                  + {Array.isArray((run.last_event as Record<string, unknown>).phases) ? ((run.last_event as Record<string, unknown>).phases as string[]).length : 0} phases
                </div>
              )}
              {run.failure_reason && <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400 font-mono">{run.failure_reason}</div>}
            </div>
            <div className="flex gap-2">
              {run.status === 'awaiting_plan' && runCanChange && (
                <button type="button" onClick={() => mutateRun(run.id, 'approve-plan')}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1">
                  <Play className="w-3.5 h-3.5" /> Approve plan
                </button>
              )}
              {['running', 'needs_approval'].includes(run.status) && (
                <button type="button" onClick={() => mutateRun(run.id, 'pause')}
                  className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white text-xs font-black">Pause</button>
              )}
              {run.status === 'paused' && runCanChange && (
                <button type="button" onClick={() => mutateRun(run.id, 'resume')}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black">{run.failure_reason?.toLowerCase().includes('uncommitted') ? 'Continue with isolated snapshot' : run.failure_reason ? 'Retry start' : 'Resume'}</button>
              )}
              {!['completed', 'cancelled', 'failed'].includes(run.status) && (
                <button type="button" onClick={() => mutateRun(run.id, 'cancel')}
                  className="px-3 py-1.5 rounded-xl bg-surface-2 border border-line text-xs font-bold">
                  Cancel
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2">
            {run.steps.map(s => (
              <div key={s.id} className="p-3 rounded-2xl bg-surface-2 border border-line flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{s.title}</div>
                  <div className="text-[11px] font-mono text-content-faint">
                    {s.status} · {s.tool}{s.model_id ? ` / ${s.model_id}` : ''} · attempt {s.attempt}
                    {s.launch_phase ? ` · ${s.launch_phase}` : ''}
                    {s.verification_command ? ` · verify: ${s.verification_command}` : ''}
                    {s.terminal_id ? ` · term ${s.terminal_id.slice(0, 8)}` : ''}
                    {s.review_status ? ` · review: ${s.review_status}` : ''}
                    {s.dependencies?.length ? ` · after: ${s.dependencies.length} step${s.dependencies.length === 1 ? '' : 's'}` : ''}
                  </div>
                  {(s.worktree_path || s.branch_name) && <div className="text-[10px] font-mono text-content-faint truncate" title={s.worktree_path}>{s.branch_name || s.worktree_path}</div>}
                  {s.failure_reason && <div className="mt-1 text-[11px] text-rose-600 dark:text-rose-400 font-mono">{s.failure_reason}</div>}
                  {s.completion_report?.summary && <div className="mt-1 text-[11px] text-content-faint">{String(s.completion_report.summary)}</div>}
                  {s.status === 'awaiting_approval' && runCanChange && (
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-mono">
                      <ShieldAlert className="w-3.5 h-3.5" /> {s.approval_reason || 'Needs approval'}
                    </div>
                  )}
                  {['queued', 'awaiting_approval'].includes(s.status) && runCanChange && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      <select
                        aria-label="Agent"
                        value={s.tool}
                        disabled={busyStep === s.id}
                        onChange={e => patchStep(s.id, { tool: e.target.value })}
                        className="px-2 py-1 rounded-lg bg-surface border border-line text-[11px] font-mono"
                      >
                        <option value="opencode">opencode</option>
                        <option value="codex">codex</option>
                        <option value="kilo">kilo</option>
                      </select>
                      <input
                        aria-label="Model"
                        list={`orch-models-${s.id}`}
                        defaultValue={s.model_id}
                        key={`${s.id}-${s.model_id}`}
                        disabled={busyStep === s.id}
                        onBlur={e => { const v = e.target.value.trim(); if (v !== (s.model_id || '')) void patchStep(s.id, { model_id: v }); }}
                        placeholder="model (blank = project default)"
                        className="px-2 py-1 rounded-lg bg-surface border border-line text-[11px] font-mono w-44"
                      />
                      <datalist id={`orch-models-${s.id}`}>
                        {presets.filter(p => p.tool === s.tool).map(p => (
                          <option key={`${p.tool}-${p.modelId}-${p.label}`} value={p.modelId}>{p.label}</option>
                        ))}
                      </datalist>
                      <select
                        aria-label="Reasoning effort"
                        value={s.reasoning_effort}
                        disabled={busyStep === s.id}
                        onChange={e => patchStep(s.id, { reasoning_effort: e.target.value })}
                        className="px-2 py-1 rounded-lg bg-surface border border-line text-[11px] font-mono"
                      >
                        <option value="low">low</option>
                        <option value="medium">medium</option>
                        <option value="high">high</option>
                      </select>
                      <select
                        aria-label="Mode"
                        value={s.mode}
                        disabled={busyStep === s.id}
                        onChange={e => patchStep(s.id, { mode: e.target.value })}
                        className="px-2 py-1 rounded-lg bg-surface border border-line text-[11px] font-mono"
                      >
                        <option value="build">build</option>
                        <option value="plan">plan</option>
                      </select>
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0 flex-wrap justify-end">
                  {s.status === 'awaiting_approval' && runCanChange && (
                    <button type="button" disabled={busyStep === s.id} onClick={() => stepAction(s, 'approve')}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold">Approve</button>
                  )}
                  {s.status === 'failed' && runCanChange && (
                    <button type="button" disabled={busyStep === s.id} onClick={() => stepAction(s, 'retry')}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold flex items-center gap-1">
                      <TerminalIcon className="w-3 h-3" /> {busyStep === s.id ? 'Retrying…' : 'Retry'}
                    </button>
                  )}
                  {s.status === 'running' && runCanChange && (
                    <>
                      <button type="button" disabled={busyStep === s.id} onClick={() => stepAction(s, 'resend')}
                        className="px-2.5 py-1 rounded-lg bg-surface border border-line text-[11px] font-bold">Resend prompt</button>
                      <button type="button" onClick={() => stepAction(s, 'pass')}
                        className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-[11px] font-bold flex items-center gap-1"><Check className="w-3 h-3" /> Pass</button>
                      <button type="button" onClick={() => stepAction(s, 'fail')}
                        className="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-800 text-[11px] font-bold flex items-center gap-1"><X className="w-3 h-3" /> Fail</button>
                    </>
                  )}
                  {!['passed', 'skipped', 'running', 'sending'].includes(s.status) && s.status !== 'failed' && runCanChange && (
                    <button type="button" onClick={() => stepAction(s, 'skip')}
                      className="px-2.5 py-1 rounded-lg bg-surface border border-line text-[11px]">Skip</button>
                  )}
                </div>
              </div>
            ))}
            {run.steps.length === 0 && <div className="text-xs font-mono text-content-faint">No steps yet.</div>}
          </div>
        </div>
        );
      })}
      {runs.length === 0 && <div className="text-center text-xs font-mono text-content-faint py-6">No orchestrator runs yet. Enter a goal above.</div>}
    </div>
  );
};

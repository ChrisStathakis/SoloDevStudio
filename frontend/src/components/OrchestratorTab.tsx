import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Play, Check, X, RotateCcw, Terminal as TerminalIcon, ShieldAlert } from 'lucide-react';
import { api, unwrapPaginated } from '../services/api';
import { formatBracketedPaste } from '../services/initialization';
import type { OrchestratorRun, OrchestratorStep } from '../types';
import type { TerminalDrawerHandle } from './TerminalDrawer';

interface Props {
  projectId: string;
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

export const OrchestratorTab: React.FC<Props> = ({ projectId, terminalRef }) => {
  const [runs, setRuns] = useState<OrchestratorRun[]>([]);
  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [presets, setPresets] = useState<Array<{ tool: string; modelId: string; label: string }>>([]);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get<OrchestratorRun[]>(`/projects/${projectId}/orchestrator/runs/`);
      setRuns(Array.isArray(res.data) ? res.data : []);
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Unable to load orchestrator runs.');
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get('/launcher-model-presets/', { params: { page_size: 100 } });
        const rows = unwrapPaginated<any>(res.data as any).filter((p: any) => p?.enabled !== false);
        if (!cancelled) setPresets(rows.map((p: any) => ({
          tool: p?.tool === 'codex' ? 'codex' : 'opencode',
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
    setLoading(true);
    setError(null);
    try {
      const res = await api.post(`/projects/${projectId}/orchestrator/runs/`, { goal: goal.trim(), max_parallel: 2 });
      setGoal('');
      setRuns(prev => [res.data, ...prev]);
    } catch (e: any) {
      const d = e?.response?.data;
      setError(typeof d === 'string' ? d : d?.goal || d?.error || 'Unable to create run.');
    } finally {
      setLoading(false);
    }
  };

  const mutateRun = async (runId: string, suffix: string) => {
    setError(null);
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
          try {
            // TerminalDrawer owns xterm rendering; adopt by refreshing live list.
            // Paste bracketed so multi-line prompts arrive as one draft.
            await terminalRef.current.sendPastedText(formatBracketedPaste(prompt) + '\r', sessionId);
          } catch {
            // Paste is best-effort: session exists, user can paste manually.
          }
        }
      } else {
        await api.post(`/orchestrator/steps/${step.id}/action/`, { op });
      }
      await refresh();
    } catch (e: any) {
      setError(e?.response?.data?.error || `Step ${op} failed.`);
    } finally {
      setBusyStep(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-3">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-indigo-500" />
          <h3 className="text-xs font-black uppercase tracking-[0.2em] font-mono">Step launcher</h3>
        </div>
        <p className="text-xs text-content-faint font-mono">
          Goal → plan you approve → one visible terminal per step (max 2/run, 6/user). You pick the model per step, press Send, and judge each step yourself. High-risk steps pause for approval. Nothing runs hidden.
        </p>
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
      </div>

      {runs.map(run => (
        <div key={run.id} className="p-5 rounded-3xl bg-surface border border-line shadow-xl space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="text-sm font-bold">{run.goal}</div>
              <div className="text-[11px] font-mono text-content-faint">{STATUS_LABEL[run.status] || run.status} · {run.steps.length} steps</div>
            </div>
            <div className="flex gap-2">
              {(run.status === 'awaiting_plan' || run.status === 'paused') && (
                <button type="button" onClick={() => mutateRun(run.id, 'approve-plan')}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black flex items-center gap-1">
                  <Play className="w-3.5 h-3.5" /> Approve plan
                </button>
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
                    {s.verification_command ? ` · verify: ${s.verification_command}` : ''}
                    {s.terminal_id ? ` · term ${s.terminal_id.slice(0, 8)}` : ''}
                  </div>
                  {s.status === 'awaiting_approval' && (
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 font-mono">
                      <ShieldAlert className="w-3.5 h-3.5" /> {s.approval_reason || 'Needs approval'}
                    </div>
                  )}
                  {['queued', 'awaiting_approval'].includes(s.status) && (
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
                  {s.status === 'awaiting_approval' && (
                    <button type="button" disabled={busyStep === s.id} onClick={() => stepAction(s, 'approve')}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold">Approve</button>
                  )}
                  {['queued', 'failed'].includes(s.status) && (
                    <button type="button" disabled={busyStep === s.id} onClick={() => stepAction(s, 'dispatch')}
                      className="px-2.5 py-1 rounded-lg bg-indigo-600 text-white text-[11px] font-bold flex items-center gap-1">
                      <TerminalIcon className="w-3 h-3" /> {busyStep === s.id ? 'Sending…' : s.status === 'failed' ? 'Retry send' : 'Send'}
                    </button>
                  )}
                  {s.status === 'running' && (
                    <>
                      <button type="button" onClick={() => stepAction(s, 'pass')}
                        className="px-2.5 py-1 rounded-lg bg-emerald-100 text-emerald-800 text-[11px] font-bold flex items-center gap-1"><Check className="w-3 h-3" /> Pass</button>
                      <button type="button" onClick={() => stepAction(s, 'fail')}
                        className="px-2.5 py-1 rounded-lg bg-rose-100 text-rose-800 text-[11px] font-bold flex items-center gap-1"><X className="w-3 h-3" /> Fail</button>
                    </>
                  )}
                  {s.status === 'failed' && (
                    <button type="button" onClick={() => stepAction(s, 'retry')}
                      className="px-2.5 py-1 rounded-lg bg-surface border border-line text-[11px] font-bold flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Requeue</button>
                  )}
                  {!['passed', 'skipped', 'running'].includes(s.status) && s.status !== 'failed' && (
                    <button type="button" onClick={() => stepAction(s, 'skip')}
                      className="px-2.5 py-1 rounded-lg bg-surface border border-line text-[11px]">Skip</button>
                  )}
                </div>
              </div>
            ))}
            {run.steps.length === 0 && <div className="text-xs font-mono text-content-faint">No steps yet.</div>}
          </div>
        </div>
      ))}
      {runs.length === 0 && <div className="text-center text-xs font-mono text-content-faint py-6">No orchestrator runs yet. Enter a goal above.</div>}
    </div>
  );
};

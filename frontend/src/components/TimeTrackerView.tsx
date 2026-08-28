import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Square, 
  Clock, 
  Flame, 
  Plus, 
  CheckCircle2, 
  Trash2, 
  Coffee, 
  Briefcase, 
  Calendar, 
  BarChart3,
  Sparkles,
  Layers,
  CheckSquare
} from 'lucide-react';
import { STAGE_CONFIG, ProjectStage } from '../types';
import { PageHeader, Button } from './ui';

export const TimeTrackerView: React.FC = () => {
  const {
    timeTracker,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    switchPomodoroPhase,
    addManualTimeEntry,
    deleteTimeEntry,
    projects,
    tasks,
    timeEntries
  } = useApp();

  const [sessionNotes, setSessionNotes] = useState('');
  const [showManualModal, setShowManualModal] = useState(false);

  // Manual entry form
  const [manualProjectId, setManualProjectId] = useState(projects[0]?.id || '');
  const [manualTaskId, setManualTaskId] = useState('');
  const [manualMinutes, setManualMinutes] = useState('45');
  const [manualNotes, setManualNotes] = useState('');
  const [manualDate, setManualDate] = useState(new Date().toISOString().split('T')[0]);

  // Format MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const currentSeconds = timeTracker.mode === 'pomodoro' ? timeTracker.secondsRemaining : timeTracker.secondsElapsed;
  const totalPhaseSeconds = timeTracker.pomodoroType === 'work' ? 25 * 60 : timeTracker.pomodoroType === 'long_break' ? 15 * 60 : 5 * 60;
  const progressPercent = timeTracker.mode === 'pomodoro' 
    ? Math.max(0, Math.min(100, ((totalPhaseSeconds - timeTracker.secondsRemaining) / totalPhaseSeconds) * 100))
    : 100;

  const currentProject = projects.find(p => p.id === timeTracker.projectId);
  const currentTask = tasks.find(t => t.id === timeTracker.taskId);

  // Analytics calculation
  const totalSecondsAll = timeEntries.reduce((acc, curr) => acc + curr.durationSeconds, 0);
  const totalHoursAll = (totalSecondsAll / 3600).toFixed(1);

  // Project time breakdown
  const projectTimeMap: { [projId: string]: number } = {};
  timeEntries.forEach(entry => {
    projectTimeMap[entry.projectId] = (projectTimeMap[entry.projectId] || 0) + entry.durationSeconds;
  });

  // Stage time breakdown
  const stageTimeMap: { [stage in ProjectStage]?: number } = {};
  timeEntries.forEach(entry => {
    stageTimeMap[entry.stage] = (stageTimeMap[entry.stage] || 0) + entry.durationSeconds;
  });

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const proj = projects.find(p => p.id === manualProjectId);
    const tsk = tasks.find(t => t.id === manualTaskId);
    const durSec = (parseInt(manualMinutes) || 45) * 60;

    addManualTimeEntry({
      projectId: manualProjectId,
      projectTitle: proj?.title || 'General Focus',
      taskId: manualTaskId || undefined,
      taskTitle: tsk?.title,
      stage: proj?.currentStage || 'development',
      durationSeconds: durSec,
      mode: 'manual',
      notes: manualNotes.trim() || 'Manual time logged',
      timestamp: `${manualDate}T12:00:00.000Z`
    });

    setShowManualModal(false);
    setManualNotes('');
  };

  return (
    <div className="space-y-8 pb-12 animate-in fade-in">
      
      {/* Header */}
      <PageHeader eyebrow="Focus workspace" title="Focus timer" description="Protect deep work, attach it to the right project, and keep the history useful." actions={<Button
          type="button"
          id="btn-manual-time-entry"
          onClick={() => setShowManualModal(true)}
          tone="secondary"
        >
          <Plus className="w-4 h-4 text-emerald-400" />
          <span>Manual Time Log</span>
        </Button>} />

      {/* Main Focus Console Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left 7 Columns: Active Timer Card */}
        <div className="lg:col-span-7 space-y-6">
          <div className="p-8 rounded-3xl bg-surface border border-line shadow-2xl flex flex-col items-center justify-center text-center relative overflow-hidden">
            
            {/* Ambient Artistic Glow */}
            <div className={`absolute -top-24 -right-24 w-80 h-80 rounded-full blur-3xl opacity-20 pointer-events-none transition-all ${
              timeTracker.pomodoroType === 'work' ? 'bg-indigo-500' : 'bg-emerald-500'
            }`} />

            {/* Mode & Phase Switches */}
            <div className="flex items-center gap-2 mb-6 z-10">
              <button
                type="button"
                id="btn-pomodoro-work"
                onClick={() => switchPomodoroPhase('work')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  timeTracker.mode === 'pomodoro' && timeTracker.pomodoroType === 'work'
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                    : 'bg-surface-3 text-content-faint hover:text-white border border-line'
                }`}
              >
                <Briefcase className="w-3.5 h-3.5" />
                <span>25m Focus</span>
              </button>

              <button
                type="button"
                id="btn-pomodoro-break"
                onClick={() => switchPomodoroPhase('short_break')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  timeTracker.mode === 'pomodoro' && timeTracker.pomodoroType === 'short_break'
                    ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                    : 'bg-surface-3 text-content-faint hover:text-white border border-line'
                }`}
              >
                <Coffee className="w-3.5 h-3.5" />
                <span>5m Break</span>
              </button>

              <button
                type="button"
                id="btn-stopwatch-mode"
                onClick={() => startTimer('stopwatch')}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  timeTracker.mode === 'stopwatch'
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/30'
                    : 'bg-surface-3 text-content-faint hover:text-white border border-line'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Stopwatch</span>
              </button>
            </div>

            {/* Large Digit Display */}
            <div className="my-4 z-10">
              <div className="font-mono text-7xl sm:text-8xl font-black tracking-tight text-white tabular-nums drop-shadow-lg">
                {formatTime(currentSeconds)}
              </div>
              <div className="text-[13px] font-black uppercase tracking-[0.25em] text-content-faint mt-2 font-mono">
                {timeTracker.mode === 'stopwatch'
                  ? 'ELAPSED FOCUS TIME'
                  : timeTracker.pomodoroType === 'work'
                  ? 'DEEP WORK SPRINT'
                  : 'REST & RECHARGE'}
              </div>
            </div>

            {/* Target Project & Task Attachment */}
            <div className="w-full max-w-md bg-surface-3 p-4 rounded-2xl border border-line my-4 text-left z-10">
              <div className="text-[12px] font-black text-content-faint uppercase tracking-widest mb-2 font-mono">
                ACTIVE FOCUS TARGET
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={timeTracker.projectId || ''}
                  onChange={e => startTimer(timeTracker.mode, e.target.value || undefined, undefined)}
                  className="px-3 py-2 text-xs bg-surface border border-line rounded-xl text-white font-medium outline-none focus:border-indigo-500"
                >
                  <option value="">No Project Assigned</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>

                <select
                  value={timeTracker.taskId || ''}
                  onChange={e => startTimer(timeTracker.mode, timeTracker.projectId, e.target.value || undefined)}
                  className="px-3 py-2 text-xs bg-surface border border-line rounded-xl text-white font-medium outline-none focus:border-indigo-500"
                >
                  <option value="">No Specific Task</option>
                  {tasks
                    .filter(t => !timeTracker.projectId || t.projectId === timeTracker.projectId)
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.title}</option>
                    ))}
                </select>
              </div>
            </div>

            {/* Controls: Start / Pause / Stop */}
            <div className="flex items-center gap-3 mt-2 z-10">
              {timeTracker.isRunning ? (
                <button
                  type="button"
                  id="btn-timer-pause"
                  onClick={pauseTimer}
                  className="flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-amber-500 hover:bg-amber-400 text-black font-black text-sm shadow-xl shadow-amber-500/20 transition-all active:scale-95"
                >
                  <Pause className="w-4 h-4 fill-current" />
                  <span>Pause</span>
                </button>
              ) : (
                <button
                  type="button"
                  id="btn-timer-start"
                  onClick={() => {
                    if (timeTracker.secondsElapsed > 0 || timeTracker.mode === 'stopwatch') {
                      resumeTimer();
                    } else {
                      startTimer(timeTracker.mode, timeTracker.projectId, timeTracker.taskId);
                    }
                  }}
                  className="flex items-center gap-2 px-8 py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm shadow-xl shadow-indigo-600/30 transition-all active:scale-95"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>{timeTracker.secondsElapsed > 0 ? 'Resume' : 'Start Focus'}</span>
                </button>
              )}

              {(timeTracker.isRunning || timeTracker.secondsElapsed > 0) && (
                <button
                  type="button"
                  id="btn-timer-finish"
                  onClick={() => stopTimer(sessionNotes)}
                  className="flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-surface-3 hover:bg-surface-3 text-content font-bold text-xs shadow-md border border-line-strong transition-all active:scale-95"
                  title="Finish and log session"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Complete & Log</span>
                </button>
              )}
            </div>

            {/* Session Notes input */}
            {(timeTracker.isRunning || timeTracker.secondsElapsed > 0) && (
              <div className="w-full max-w-md mt-4 z-10">
                <input
                  type="text"
                  placeholder="Notes on what you are accomplishing in this sprint..."
                  value={sessionNotes}
                  onChange={e => setSessionNotes(e.target.value)}
                  className="w-full px-4 py-2 text-xs bg-surface-3 border border-line rounded-xl text-content placeholder-slate-500 outline-none focus:border-indigo-500"
                />
              </div>
            )}

            {/* Completed Pomodoro Counter */}
            <div className="flex items-center gap-2 mt-6 text-xs text-content-faint font-bold z-10 font-mono">
              <Flame className="w-4 h-4 text-amber-400 fill-amber-400" />
              <span>{timeTracker.pomodorosCompleted} Pomodoro sprints finished today</span>
            </div>
          </div>
        </div>

        {/* Right 5 Columns: Analytics & Time Distribution */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Summary Card */}
          <div className="p-6 rounded-3xl bg-surface border border-line shadow-xl space-y-5">
            <h3 className="text-xs font-black text-content uppercase tracking-[0.2em] flex items-center gap-2 font-mono">
              <BarChart3 className="w-4 h-4 text-indigo-400" />
              <span>Focus Distribution</span>
            </h3>

            {/* Project Distribution Bars */}
            <div className="space-y-3">
              <div className="text-xs font-bold text-content-muted">
                By Project
              </div>
              {projects.map(proj => {
                const sec = projectTimeMap[proj.id] || 0;
                const hours = (sec / 3600).toFixed(1);
                const pct = totalSecondsAll > 0 ? Math.round((sec / totalSecondsAll) * 100) : 0;

                return (
                  <div key={proj.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-content truncate max-w-[180px]">
                        {proj.title}
                      </span>
                      <span className="font-mono text-content-faint text-[13px]">
                        {hours}h ({pct}%)
                      </span>
                    </div>
                    <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden border border-line/80">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: proj.color || '#6366f1'
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Stage Distribution */}
            <div className="space-y-3 pt-4 border-t border-line">
              <div className="text-xs font-bold text-content-muted">
                By Lifecycle Stage
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(Object.keys(STAGE_CONFIG) as ProjectStage[]).map(stg => {
                  const sec = stageTimeMap[stg] || 0;
                  const mins = Math.round(sec / 60);
                  if (mins === 0) return null;

                  return (
                    <div
                      key={stg}
                      className="p-3 rounded-2xl bg-surface-3 border border-line text-xs"
                    >
                      <div className="text-[12px] text-content-faint uppercase font-black tracking-wider">
                        {STAGE_CONFIG[stg].label}
                      </div>
                      <div className="font-black text-white font-mono text-sm mt-1">
                        {mins >= 60 ? `${(mins / 60).toFixed(1)}h` : `${mins}m`}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Time Entries History Table */}
      <div className="p-6 rounded-3xl bg-surface border border-line shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-400" />
            <h3 className="text-xs font-black text-content uppercase tracking-[0.2em] font-mono">
              Focus History Logs ({timeEntries.length} sessions)
            </h3>
          </div>
        </div>

        {timeEntries.length === 0 ? (
          <div className="py-10 text-center text-xs text-content-faint">
            No time entries recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-line/80">
            {timeEntries.slice(0, 10).map(entry => {
              const mins = Math.round(entry.durationSeconds / 60);

              return (
                <div
                  key={entry.id}
                  className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-bold text-white">
                      {entry.notes || entry.taskTitle || 'Solo Focus Block'}
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-content-faint">
                      <span className="font-semibold text-indigo-400">
                        {entry.projectTitle}
                      </span>
                      {entry.taskTitle && <span>• Task: {entry.taskTitle}</span>}
                      <span>• {new Date(entry.timestamp).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-auto">
                    <span className="px-3 py-1 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-mono font-bold">
                      {mins} mins
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteTimeEntry(entry.id)}
                      className="p-1 text-content-faint hover:text-rose-400 rounded transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Manual Time Entry Modal */}
      {showManualModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-surface rounded-3xl p-6 shadow-2xl border border-line w-full max-w-md space-y-4">
            <h3 className="text-lg font-black text-content">
              Log Offline Work Time
            </h3>

            <form onSubmit={handleManualSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-content-muted mb-1">
                  Project
                </label>
                <select
                  value={manualProjectId}
                  onChange={e => setManualProjectId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-surface-3 border border-line rounded-xl text-white outline-none focus:border-indigo-500"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-content-muted mb-1">
                  Associated Task (Optional)
                </label>
                <select
                  value={manualTaskId}
                  onChange={e => setManualTaskId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-surface-3 border border-line rounded-xl text-white outline-none focus:border-indigo-500"
                >
                  <option value="">None</option>
                  {tasks.filter(t => t.projectId === manualProjectId).map(t => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-content-muted mb-1">
                    Duration (Minutes)
                  </label>
                  <input
                    type="number"
                    min="5"
                    step="5"
                    value={manualMinutes}
                    onChange={e => setManualMinutes(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-surface-3 border border-line rounded-xl text-white outline-none focus:border-indigo-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block font-bold text-content-muted mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={manualDate}
                    onChange={e => setManualDate(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-surface-3 border border-line rounded-xl text-white outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-content-muted mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  placeholder="e.g. Refactored API routing and fixed test fixtures"
                  value={manualNotes}
                  onChange={e => setManualNotes(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-surface-3 border border-line rounded-xl text-content placeholder-slate-500 outline-none focus:border-indigo-500"
                />
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 rounded-xl text-content-faint hover:text-white font-bold transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-lg shadow-indigo-900/40"
                >
                  Save Log
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

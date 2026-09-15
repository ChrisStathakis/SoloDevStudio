const title = document.getElementById('title');
const meta = document.getElementById('meta');
const action = document.getElementById('action');
const pause = document.getElementById('pause');
const root = document.getElementById('root');
const term = document.getElementById('term');
const termDot = document.getElementById('termdot');
const termLabel = document.getElementById('termlabel');
const termLines = document.getElementById('termlines');
let state = null;
const fmt = (seconds) => { const s = Math.max(0, Number(seconds) || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// A terminal snapshot is only trustworthy while the main window keeps
// reporting; otherwise the pet would show a stale "running" forever.
const freshTerminal = (t) => Boolean(t && (Date.now() - (t.updatedAt || 0) < 30000));
const termStatusText = (t) => {
  if (!t) return '';
  if (t.status === 'done') return 'CMD finished ✓';
  if (t.status === 'exited') return t.exitCode === 0 || t.exitCode == null ? 'CMD finished ✓' : `CMD exited (${t.exitCode})`;
  if (t.status === 'running') return 'CMD running…';
  return 'CMD idle';
};
const render = () => {
  const connected = Boolean(state && Date.now() - (state.reportedAt || Date.now()) < 30000);
  const timer = state?.timer;
  const task = state?.task;
  const terminal = connected && freshTerminal(state?.terminal) ? state.terminal : null;
  const termDone = Boolean(terminal && (terminal.status === 'done' || terminal.status === 'exited'));
  const drift = connected && timer?.active && !timer.paused ? Math.floor((Date.now() - (state.reportedAt || Date.now())) / 1000) : 0;
  // A finished command takes over the title so you know at a glance.
  // While it is still running, the timer/task title wins and the CMD
  // output shows underneath in its own block.
  title.textContent = state?.loggedOut ? 'Sign in to continue'
    : termDone ? termStatusText(terminal)
    : connected && timer?.active ? (timer.taskTitle || 'Focus session')
    : connected ? (task?.title || 'Choose your next task.')
    : 'Reconnecting to SoloDev…';
  const projectBit = terminal?.projectTitle ? ` · ${terminal.projectTitle}` : '';
  meta.textContent = state?.loggedOut ? 'Companion paused'
    : termDone ? `${terminal.projectTitle || 'Console'}${terminal.exitCode ? ` · exit ${terminal.exitCode}` : ''} · click to open`
    : connected ? (timer?.active ? `${timer.projectTitle || ''} · ${fmt((timer.secondsRemaining || 0) - drift)} · ${timer.paused ? 'Paused' : 'Running'}` : (task?.projectTitle || 'SoloDev companion'))
    : 'Main window unavailable';
  if (terminal && (terminal.lines?.length || terminal.status === 'running')) {
    term.classList.add('show');
    termDot.className = `dot ${terminal.status}`;
    termLabel.textContent = `CMD${projectBit} — ${termStatusText(terminal)}`;
    termLines.textContent = '';
    (terminal.lines || []).slice(-3).forEach((line) => {
      const div = document.createElement('div');
      div.className = 'termline';
      div.textContent = line;
      termLines.appendChild(div);
    });
    if (!terminal.lines?.length) {
      const div = document.createElement('div');
      div.className = 'termline';
      div.textContent = terminal.status === 'running' ? '…waiting for output' : 'no output captured';
      termLines.appendChild(div);
    }
  } else {
    term.classList.remove('show');
  }
  pause.textContent = timer?.paused ? 'Resume' : 'Pause';
  pause.disabled = !connected || !timer?.active || Boolean(state?.loggedOut);
  action.textContent = timer?.active ? 'Open task' : 'Start focus';
  action.disabled = !connected || (!timer?.active && !task) || Boolean(state?.loggedOut);
  root.classList.toggle('paused', Boolean(timer?.paused || state?.loggedOut));
};
window.soloDevCompanion.onState(next => { state = next; render(); });
document.getElementById('restore').onclick = () => window.soloDevCompanion.command('restore');
document.querySelector('.bubble').onclick = () => window.soloDevCompanion.command(termDoneFallback() ? 'restore' : 'restore-task');
document.getElementById('dismiss').onclick = () => window.soloDevCompanion.dismiss();
pause.onclick = () => window.soloDevCompanion.command(state?.timer?.paused ? 'resume' : 'pause');
action.onclick = () => window.soloDevCompanion.command(state?.timer?.active ? 'restore-task' : 'start-focus');
function termDoneFallback() {
  const terminal = state?.terminal;
  return Boolean(terminal && (terminal.status === 'done' || terminal.status === 'exited') && freshTerminal(terminal));
}
let dragging = false; let moved = false; let origin = null;
document.getElementById('robot').addEventListener('pointerdown', event => { dragging = true; moved = false; origin = { x: event.screenX, y: event.screenY }; event.currentTarget.setPointerCapture(event.pointerId); });
document.getElementById('robot').addEventListener('pointermove', event => { if (!dragging || !origin) return; moved = moved || Math.abs(event.screenX - origin.x) > 4 || Math.abs(event.screenX - origin.y) > 4; window.soloDevCompanion.move({ x: event.screenX - 126, y: event.screenY - 164 }); });
document.getElementById('robot').addEventListener('pointerup', () => { if (dragging && !moved) window.soloDevCompanion.command('restore'); dragging = false; origin = null; });
render();
setInterval(render, 1000);

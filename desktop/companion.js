const title = document.getElementById('title');
const meta = document.getElementById('meta');
const action = document.getElementById('action');
const pause = document.getElementById('pause');
const root = document.getElementById('root');
const term = document.getElementById('term');
const termDot = document.getElementById('termdot');
const termLabel = document.getElementById('termlabel');
const termLines = document.getElementById('termlines');
const termExpand = document.getElementById('termexpand');
const bubble = document.querySelector('.bubble');
const watchSel = document.getElementById('watchsel');
const petForm = document.getElementById('petform');
const petInput = document.getElementById('petinput');
const petSend = document.getElementById('petsend');
const petStop = document.getElementById('petstop');
const petStatus = document.getElementById('petstatus');
const pinBtn = document.getElementById('pin');
let pinned = false;
let state = null;
let lastOptionsKey = '';
let petNote = '';
let petNoteOk = false;
let petNoteAt = 0;
let termExpanded = false;
try { termExpanded = window.localStorage?.getItem('solodev_pet_expanded') === '1'; } catch { termExpanded = false; }
const fmt = (seconds) => { const s = Math.max(0, Number(seconds) || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// A terminal snapshot is only trustworthy while the main window keeps
// reporting; otherwise the pet would show a stale "running" forever.
const freshTerminal = (t) => Boolean(t && (Date.now() - (t.updatedAt || 0) < 60000));
const connected = () => Boolean(state && Date.now() - (state.reportedAt || Date.now()) < 60000);
const watchedId = () => state?.watchedSessionId || null;
const cmdOptions = () => (Array.isArray(state?.terminalOptions) ? state.terminalOptions : []).filter(o => o && o.sessionId);
const termStatusText = (t) => {
  if (!t) return '';
  if (t.status === 'done') return 'CMD finished ✓';
  if (t.status === 'exited') return t.exitCode === 0 || t.exitCode == null ? 'CMD finished ✓' : `CMD exited (${t.exitCode})`;
  if (t.status === 'running') return 'CMD running…';
  return 'CMD idle';
};
// 'exited' means the session is gone: no point sending keystrokes to it.
const terminalAlive = (t) => Boolean(t && freshTerminal(t) && t.status !== 'exited');
const say = (text, ok) => { petNote = text; petNoteOk = Boolean(ok); petNoteAt = Date.now(); render(); };
const shortId = (id) => String(id).slice(-4);
const optionLabel = (o, all) => {
  const name = o.projectTitle || 'Console';
  const dupes = all.filter(x => (x.projectTitle || 'Console') === name).length > 1;
  return dupes ? `${name} ···${shortId(o.sessionId)}` : name;
};
const render = () => {
  const isConnected = connected();
  const timer = state?.timer;
  const task = state?.task;
  const terminal = isConnected && freshTerminal(state?.terminal) ? state.terminal : null;
  const termDone = Boolean(terminal && (terminal.status === 'done' || terminal.status === 'exited'));
  const drift = isConnected && timer?.active && !timer.paused ? Math.floor((Date.now() - (state.reportedAt || Date.now())) / 1000) : 0;
  // A finished command takes over the title so you know at a glance.
  // While it is still running, the timer/task title wins and the CMD
  // output shows underneath in its own block.
  title.textContent = state?.loggedOut ? 'Sign in to continue'
    : termDone ? termStatusText(terminal)
    : isConnected && timer?.active ? (timer.taskTitle || 'Focus session')
    : isConnected ? (task?.title || 'Choose your next task.')
    : 'Reconnecting to SoloDev…';
  const projectBit = terminal?.projectTitle ? ` · ${terminal.projectTitle}` : '';
  meta.textContent = state?.loggedOut ? 'Companion paused'
    : termDone ? `${terminal.projectTitle || 'Console'}${terminal.exitCode ? ` · exit ${terminal.exitCode}` : ''} · click to open`
    : isConnected ? (timer?.active ? `${timer.projectTitle || ''} · ${fmt((timer.secondsRemaining || 0) - drift)} · ${timer.paused ? 'Paused' : 'Running'}` : (task?.projectTitle || 'SoloDev companion'))
    : 'Main window unavailable';
  if (terminal && (terminal.lines?.length || terminal.status === 'running')) {
    term.classList.add('show');
    term.classList.toggle('expanded', termExpanded);
    termDot.className = `dot ${terminal.status}`;
    termLabel.textContent = `CMD${projectBit} — ${termStatusText(terminal)}`;
    termLines.textContent = '';
    (terminal.lines || []).slice(termExpanded ? -30 : -3).forEach((line) => {
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
    if (termExpand) {
      termExpand.textContent = termExpanded ? '⤡' : '⤢';
      termExpand.title = termExpanded ? 'Collapse output' : 'Expand output (triple, scrollable)';
      termExpand.setAttribute('aria-label', termExpanded ? 'Collapse terminal output' : 'Expand terminal output');
      termExpand.setAttribute('aria-expanded', termExpanded ? 'true' : 'false');
    }
    if (termExpanded) termLines.scrollTop = termLines.scrollHeight;
  } else {
    term.classList.remove('show');
    term.classList.remove('expanded');
  }
  // --- watched-CMD selector (CMD sessions only, pinned from the pet) ---
  const options = cmdOptions();
  const key = options.map(o => o.sessionId).join(',');
  if (key !== lastOptionsKey && document.activeElement !== watchSel) {
    lastOptionsKey = key;
    watchSel.textContent = '';
    if (!options.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No CMD consoles';
      watchSel.appendChild(opt);
    } else {
      options.forEach((o) => {
        const opt = document.createElement('option');
        opt.value = o.sessionId;
        opt.textContent = optionLabel(o, options);
        watchSel.appendChild(opt);
      });
    }
  }
  const watched = watchedId();
  if (watched && options.some(o => o.sessionId === watched)) watchSel.value = watched;
  else if (options.length && document.activeElement !== watchSel) watchSel.value = options[0].sessionId;
  watchSel.disabled = !isConnected || !options.length || Boolean(state?.loggedOut);
  // --- prompt input + Ctrl+C ---
  const alive = terminalAlive(terminal);
  const canType = isConnected && alive && Boolean(watched) && !state?.loggedOut;
  petInput.disabled = !canType;
  petSend.disabled = !canType;
  petStop.disabled = !canType || terminal?.status !== 'running';
  petStop.title = terminal?.status === 'running' ? 'Send Ctrl+C to stop the running command' : 'Interrupt (active while a command runs)';
  if (Date.now() - petNoteAt < 4000 && petNote) {
    petStatus.textContent = petNote;
    petStatus.className = `petstatus show${petNoteOk ? ' ok' : ''}`;
  } else {
    petStatus.textContent = '';
    petStatus.className = 'petstatus';
  }
  pause.textContent = timer?.paused ? 'Resume' : 'Pause';
  pause.disabled = !isConnected || !timer?.active || Boolean(state?.loggedOut);
  action.textContent = timer?.active ? 'Open task' : 'Start focus';
  action.disabled = !isConnected || (!timer?.active && !task) || Boolean(state?.loggedOut);
  root.classList.toggle('paused', Boolean(timer?.paused || state?.loggedOut));
  if (pinBtn) {
    pinBtn.classList.toggle('pinned', pinned);
    pinBtn.title = pinned ? 'Pinned on top — click to unpin' : 'Keep on top';
    pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
  }
};
window.soloDevCompanion.onState(next => { state = next; render(); });
document.getElementById('restore').onclick = () => window.soloDevCompanion.command('restore');
// Bubble clicks restore/open, but never when interacting with the CMD
// picker, the prompt input, expanded scrollable output, or any button
// inside the bubble. Clicking a disabled input must not open a task:
// disabled controls may not hit-test as `input`, so only title/meta/
// collapsed output restore — never form rows, selects, or termlines.
bubble.onclick = (event) => {
  if (event.target.closest('input,select,button,form,#termlines,.petrow')) return;
  if (!event.target.closest('.title,.meta,.term')) return;
  window.soloDevCompanion.command(termDoneFallback() ? 'restore' : 'restore-task');
};
if (termExpand) {
  termExpand.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    termExpanded = !termExpanded;
    try { window.localStorage?.setItem('solodev_pet_expanded', termExpanded ? '1' : '0'); } catch { /* private mode */ }
    render();
  };
}
// Focusing/typing in the CMD prompt must not bubble up to `.bubble`.
petForm.addEventListener('mousedown', (event) => event.stopPropagation());
petForm.addEventListener('click', (event) => event.stopPropagation());
petInput.addEventListener('mousedown', (event) => event.stopPropagation());
watchSel.addEventListener('mousedown', (event) => event.stopPropagation());
watchSel.addEventListener('click', (event) => event.stopPropagation());
document.getElementById('dismiss').onclick = () => window.soloDevCompanion.dismiss();
// Pin keeps the pet visible above everything (including games). The main
// process owns the setting; this button is an optimistic toggle that the
// 'companion:pin' push confirms.
if (pinBtn) {
  pinBtn.onclick = (event) => {
    event.stopPropagation();
    const next = !pinned;
    pinned = next;
    render();
    try {
      const result = window.soloDevCompanion.setPinned(next);
      if (result && typeof result.then === 'function') {
        result.then(
          (res) => { pinned = Boolean(res && typeof res === 'object' ? res.companionPinned : res); render(); },
          () => { pinned = !next; render(); },
        );
      }
    } catch {
      pinned = !next;
      render();
    }
  };
}
if (window.soloDevCompanion.onPinState) {
  window.soloDevCompanion.onPinState((next) => { pinned = Boolean(next); render(); });
}
pause.onclick = () => window.soloDevCompanion.command(state?.timer?.paused ? 'resume' : 'pause');
action.onclick = () => window.soloDevCompanion.command(state?.timer?.active ? 'restore-task' : 'start-focus');
watchSel.onchange = () => {
  const id = watchSel.value || null;
  window.soloDevCompanion.command({ type: 'set-watched', sessionId: id });
  const label = watchSel.options[watchSel.selectedIndex]?.textContent || 'console';
  say(id ? `Watching ${label}` : 'Watch cleared', true);
};
petForm.onsubmit = (event) => {
  event.preventDefault();
  const id = watchedId();
  const text = petInput.value;
  if (!id || !text.trim()) return;
  window.soloDevCompanion.command({ type: 'pet-input', sessionId: id, text });
  petInput.value = '';
  petInput.focus();
  say('Sent ✓', true);
};
petStop.onclick = () => {
  const id = watchedId();
  if (!id) return;
  window.soloDevCompanion.command({ type: 'pet-interrupt', sessionId: id });
  say('Sent Ctrl+C', true);
};
function termDoneFallback() {
  const terminal = state?.terminal;
  return Boolean(terminal && (terminal.status === 'done' || terminal.status === 'exited') && freshTerminal(terminal));
}
const robotEl = document.getElementById('robot');
let dragging = false; let moved = false; let origin = null; let grabOffset = null;
const clearStraySelection = () => { try { const sel = window.getSelection(); if (sel && sel.rangeCount && !sel.isCollapsed) sel.removeAllRanges(); } catch { /* selection unavailable */ } };
robotEl.addEventListener('pointerdown', event => {
  // Prevent the native text-drag/selection gesture from starting: without
  // this, moving the pet paints a selection over the selectable CMD output.
  event.preventDefault();
  dragging = true; moved = false;
  origin = { x: event.screenX, y: event.screenY };
  // Window-relative grab point (clientX/Y), so the window follows the cursor
  // instead of teleporting to a fixed offset and landing it on the bubble text.
  grabOffset = { x: event.clientX, y: event.clientY };
  robotEl.classList.add('dragging');
  try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture unavailable */ }
});
robotEl.addEventListener('pointermove', event => {
  if (!dragging || !origin || !grabOffset) return;
  // Stay put inside the click-vs-drag threshold: no window jump, no selection.
  if (!moved && Math.abs(event.screenX - origin.x) <= 4 && Math.abs(event.screenY - origin.y) <= 4) return;
  if (!moved) { moved = true; clearStraySelection(); }
  window.soloDevCompanion.move({ x: event.screenX - grabOffset.x, y: event.screenY - grabOffset.y });
});
const endRobotDrag = (event, clicked) => {
  if (!dragging) return;
  try { if (event && event.pointerId !== undefined && robotEl.hasPointerCapture?.(event.pointerId)) robotEl.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  robotEl.classList.remove('dragging');
  if (clicked && !moved) window.soloDevCompanion.command('restore');
  dragging = false; moved = false; origin = null; grabOffset = null;
};
robotEl.addEventListener('pointerup', (event) => endRobotDrag(event, true));
robotEl.addEventListener('pointercancel', (event) => endRobotDrag(event, false));
render();
setInterval(render, 1000);

"""Shared launcher for LLM CLIs inside pywinpty terminals.

Used by cron jobs: write CLI command -> wait for composer ready -> bracketed paste
prompt + Enter -> poll output.
"""
from __future__ import annotations

import re
import time

from django.utils import timezone

from .terminal_manager import TerminalError

TRUST_RE = re.compile(r'do you trust|press enter to continue', re.I)
READY_RES = (
    re.compile(r'ask anything', re.I),
    re.compile(r'type / for commands', re.I),
    re.compile(r'esc to interrupt', re.I),
    re.compile(r'opencode[^\n]*\d+\.\d+', re.I),
    re.compile(r'kilo[^\n]*\d+\.\d+', re.I),
    re.compile(r'[─│┌┐└┘]{4,}'),
)

CRON_RESULT_RE = re.compile(r'CRON_RESULT\s*:\s*(\{.*?\})', re.S)
ORCH_RESULT_RE = re.compile(r'ORCHESTRATOR_RESULT\s*:\s*(\{.*?\})', re.S)

# Completion markers appended to headless commands. cmd.exe keeps living after
# the child exits, so without these the runner cannot tell "agent errored in
# 2s" from "agent still working" — and every fast failure looked like a
# 15-minute timeout.
CRON_EXIT_OK = 'SOLODEV_CRON_EXIT_0'
CRON_EXIT_FAIL = 'SOLODEV_CRON_EXIT_1'
# The typed command is echoed by cmd itself, so the marker text is present in
# the transcript from the very first poll. Only a marker NOT preceded by
# `echo ` counts as the process actually having finished.
EXIT_OK_RE = re.compile(r'(?<!echo )' + re.escape(CRON_EXIT_OK) + r'\b')
EXIT_FAIL_RE = re.compile(r'(?<!echo )' + re.escape(CRON_EXIT_FAIL) + r'\b')


def _shell_quote(value: str) -> str:
    return '"' + (value or '').replace('"', '') + '"'


def headless_command(*, model_id: str = '', agent: str = 'build', prompt_file: str = '', message: str = '', title: str = '') -> str:
    """Non-interactive `opencode run` command for headless automation.

    No composer detection, no pasting, no Enter handshake: the prompt file
    is attached and stdout streams back into the terminal for live watching.
    An exit marker is appended so the runner can stop polling the moment the
    process ends instead of waiting out the full job timeout.
    """
    parts = ['opencode run']
    model = (model_id or '').strip()
    if model and model.lower() != 'default':
        parts.append(f'--model {_shell_quote(model)}')
    agent = (agent or '').strip() or 'build'
    parts.append(f'--agent {agent}')
    parts.append('--auto')
    if title.strip():
        parts.append(f'--title {_shell_quote(title.strip()[:60])}')
    if prompt_file.strip():
        parts.append(f'--file {_shell_quote(prompt_file.strip())}')
    parts.append(_shell_quote(message.strip() or 'Follow the attached instructions.'))
    base = ' '.join(parts)
    return f'{base} && echo {CRON_EXIT_OK} || echo {CRON_EXIT_FAIL}'


def cli_command(*, tool: str, model_id: str = '', reasoning_effort: str = 'medium', mode: str = 'build') -> str:
    model = (model_id or '').strip()
    quoted = '"' + model.replace('"', '') + '"'
    if tool == 'codex':
        model_arg = f' --model {quoted}' if model and model.lower() != 'default' else ''
        sandbox = 'read-only' if mode == 'plan' else 'workspace-write'
        return f'codex --strict-config{model_arg} --sandbox {sandbox} -c model_reasoning_effort="{reasoning_effort}"'
    if tool == 'kilo':
        model_arg = f' --model {quoted}' if model and model.lower() != 'default' else ''
        return f'kilo --agent {mode}{model_arg}'
    # V2 interactive `opencode` accepts no top-level --agent/--model flags
    # (those live on `opencode run` only): launch the plain TUI and pick
    # agent/model inside. Mirrors frontend buildInitializationCommand.
    return 'opencode'


def wait_for_ready(session, timeout: int = 180, on_tick=None, heartbeat=None) -> str:
    appended, _dropped = session.stats()
    deadline = time.time() + timeout
    while time.time() < deadline:
        if heartbeat and not heartbeat():
            return 'lost_lease'
        if not session.is_alive():
            return 'dead'
        _truncated, text, _offset, _more = session.read_since(appended)
        if text:
            appended += len(text)
            if on_tick:
                try:
                    on_tick()
                except Exception:
                    pass
            if TRUST_RE.search(text):
                return 'trust'
            # Immediate match like frontend waitForOutputMarker; a quiet
            # period fails on streaming TUIs that never go silent.
            if any(rx.search(text) for rx in READY_RES):
                return 'ready'
        time.sleep(0.25)
    return 'timeout'


def _wait_for_output_growth(session, baseline: int, timeout: float) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        current, _dropped = session.stats()
        if current > baseline:
            return True
        time.sleep(0.2)
    return False


def submit_prompt(session, prompt: str, settle_seconds: float = 2.0) -> None:
    """Paste the prompt and submit it, tolerating TUIs that swallow framing.

    The composer was just detected as ready, but it may still be settling;
    some builds also drop bracketed-paste framing, so fall back to plain
    text before giving up.
    """
    if settle_seconds > 0:
        time.sleep(settle_seconds)
    session.write('\x1b[200~')
    for offset in range(0, len(prompt), 4096):
        session.write(prompt[offset:offset + 4096])
        time.sleep(0.015)
    session.write('\x1b[201~')
    time.sleep(0.45)
    baseline, _dropped = session.stats()
    session.write('\r')
    if _wait_for_output_growth(session, baseline, 5):
        return
    # OpenCode can drop the first Enter while it is finalising a large
    # bracketed paste. Retry once, then surface the failure to the user.
    session.write('\r')
    if _wait_for_output_growth(session, baseline, 5):
        return
    # Fallback: resend without bracketed framing for builds that swallow it.
    plain = prompt.replace('\x1b', '')
    for offset in range(0, len(plain), 4096):
        session.write(plain[offset:offset + 4096])
        time.sleep(0.015)
    time.sleep(0.45)
    baseline, _dropped = session.stats()
    session.write('\r')
    if _wait_for_output_growth(session, baseline, 8):
        return
    session.write('\r')
    if _wait_for_output_growth(session, baseline, 5):
        return
    raise TerminalError('Prompt was not accepted by the agent composer.', 504)


def touch_now():
    return timezone.now()

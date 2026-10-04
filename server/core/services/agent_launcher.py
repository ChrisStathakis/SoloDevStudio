"""Shared launcher for LLM CLIs inside pywinpty terminals.

Extracted from the orchestrator coordinator so cron jobs reuse the exact
same flow: write CLI command -> wait for composer ready -> bracketed paste
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
    re.compile(r'[─│┌┐└┘]{4,}'),
)

CRON_RESULT_RE = re.compile(r'CRON_RESULT\s*:\s*(\{.*?\})', re.S)
ORCH_RESULT_RE = re.compile(r'ORCHESTRATOR_RESULT\s*:\s*(\{.*?\})', re.S)


def cli_command(*, tool: str, model_id: str = '', reasoning_effort: str = 'medium', mode: str = 'build') -> str:
    model = (model_id or '').strip()
    quoted = '"' + model.replace('"', '') + '"'
    if tool == 'codex':
        model_arg = f' --model {quoted}' if model and model.lower() != 'default' else ''
        sandbox = 'read-only' if mode == 'plan' else 'workspace-write'
        return f'codex --strict-config{model_arg} --sandbox {sandbox} -c model_reasoning_effort="{reasoning_effort}"'
    model_arg = f' --model {quoted}' if model and model.lower() != 'default' else ''
    if tool == 'kilo':
        return f'kilo --agent {mode}{model_arg}'
    return f'opencode --agent {mode}{model_arg}'


def wait_for_ready(session, timeout: int = 180, on_tick=None, heartbeat=None) -> str:
    appended, _dropped = session.stats()
    deadline = time.time() + timeout
    ready_at = None
    while time.time() < deadline:
        if heartbeat and not heartbeat():
            return 'lost_lease'
        if not session.is_alive():
            return 'dead'
        _truncated, text, _offset, _more = session.read_since(appended)
        if text:
            appended += len(text)
            ready_at = None
            if on_tick:
                try:
                    on_tick()
                except Exception:
                    pass
            if TRUST_RE.search(text):
                return 'trust'
            if any(rx.search(text) for rx in READY_RES):
                ready_at = time.time()
        elif ready_at and time.time() - ready_at >= 0.8:
            return 'ready'
        time.sleep(0.25)
    return 'timeout'


def submit_prompt(session, prompt: str) -> None:
    session.write('\x1b[200~')
    for offset in range(0, len(prompt), 4096):
        session.write(prompt[offset:offset + 4096])
        time.sleep(0.015)
    session.write('\x1b[201~')
    time.sleep(0.45)
    baseline, _dropped = session.stats()
    session.write('\r')
    deadline = time.time() + 5
    while time.time() < deadline:
        current, _dropped = session.stats()
        if current > baseline:
            return
        time.sleep(0.2)
    session.write('\r')
    deadline = time.time() + 5
    while time.time() < deadline:
        current, _dropped = session.stats()
        if current > baseline:
            return
        time.sleep(0.2)
    raise TerminalError('Prompt was not accepted by the agent composer.', 504)


def touch_now():
    return timezone.now()

"""Headless + in-app execution of CronJob rows.

Single entry point run_job(job_id, trigger) used by:
- management command run_cron_job (Task Scheduler, app closed)
- in-app scheduler thread (app open)
- API run-now
"""
from __future__ import annotations

import json
import re
import time
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from ..models import CronJob, CronRun
from ..pathutils import normalize_path
from . import agent_launcher
from . import opencode_models
from .terminal_manager import TerminalError, terminal_manager
from .cron_schedule import compute_next_run

LEASE_TIMEOUT = timedelta(seconds=300)


def _workdir(job: CronJob) -> tuple[str, str]:
    primary = normalize_path(job.working_directory)
    return primary, ''


def _terminal_env(job: CronJob) -> dict:
    return {
        'SOLODEV_CRON': (job.name or '')[:120],
        'SOLODEV_CRON_ID': str(job.id),
        'SOLODEV_CRON_DIR': normalize_path(job.working_directory) or '',
    }


def _claim(job_id) -> CronJob | None:
    now = timezone.now()
    stale_before = now - LEASE_TIMEOUT
    with transaction.atomic():
        job = CronJob.objects.select_for_update().filter(pk=job_id).first()
        if not job or not job.enabled:
            return None
        if job.coordinator_id and job.coordinator_heartbeat and job.coordinator_heartbeat > stale_before:
            # Another runner owns it; check for a live run to avoid doubles.
            live = CronRun.objects.filter(job=job, status__in=[CronRun.QUEUED, CronRun.RUNNING]).exists()
            if live:
                return None
        import os
        import uuid as uuid_lib
        job.coordinator_id = f'{os.getpid()}-{uuid_lib.uuid4().hex}'
        job.coordinator_heartbeat = now
        job.save(update_fields=['coordinator_id', 'coordinator_heartbeat', 'updated_at'])
        return job


def _release(job: CronJob):
    CronJob.objects.filter(pk=job.pk).update(coordinator_id='', coordinator_heartbeat=None)


def _terminal_tail(session, limit: int = 4000) -> str:
    """Best-effort tail of a terminal session for failure diagnostics."""
    if session is None:
        return ''
    try:
        _t, text, _o, _m = session.read_since(0)
        return (text or '')[-limit:]
    except Exception:
        return ''


def _should_notify(job: CronJob, run: CronRun) -> bool:
    mode = (job.notify_mode or 'on_alert').lower()
    if mode == 'always':
        return True
    if mode == 'on_fail':
        return run.status in (CronRun.FAILED, CronRun.TIMEOUT, CronRun.NEEDS_ATTENTION)
    # on_alert: structured alert flag or failure
    alert = False
    try:
        alert = bool((run.structured_result or {}).get('alert'))
    except Exception:
        alert = False
    return alert or run.status in (CronRun.FAILED, CronRun.TIMEOUT, CronRun.NEEDS_ATTENTION)


def _send_notification(job: CronJob, run: CronRun) -> bool:
    try:
        from .windows_notify import send_toast
    except Exception:
        return False
    summary = ''
    try:
        summary = str((run.structured_result or {}).get('summary') or '')[:200]
    except Exception:
        summary = ''
    msg = summary or run.status
    if run.status in (CronRun.FAILED, CronRun.TIMEOUT):
        msg = f'{run.status}: {(run.failure_reason or "")[:200]}'
    try:
        return bool(send_toast(f'Cron: {job.name}', msg))
    except Exception:
        return False


def _build_prompt(job: CronJob) -> str:
    base = (job.prompt_template or '').strip()
    footer = (
        '\n\nWhen finished, print exactly one line beginning with '
        'CRON_RESULT: followed by JSON with keys status, summary, alert (boolean). '
        'Example: CRON_RESULT: {"status":"done","summary":"...","alert":false}'
        '\nAlso save your detailed findings (full list with links, beyond the one-line '
        'summary) to a markdown file inside the "results" subfolder of the working directory.'
    )
    return (base + footer).strip()


def _result_slug(name: str) -> str:
    import re as _re
    slug = _re.sub(r'[^a-z0-9]+', '-', (name or 'run').lower()).strip('-')[:60]
    return slug or 'run'


def _write_result_file(job: CronJob, run: CronRun) -> str:
    """Persist a markdown report for every run so Result files never stay empty.

    Best-effort: any failure returns '' and never breaks the run itself.
    """
    import os as _os
    try:
        from django.contrib.auth import get_user_model as _get_user
        target = normalize_path(job.working_directory)
        if not target or not _os.path.isdir(target):
            try:
                owner = job.owner if hasattr(job, 'owner') else _get_user().objects.filter(pk=job.owner_id).first()
                fallback = str(getattr(owner, 'automation_results_root', '') or '').strip()
            except Exception:
                fallback = ''
            target = normalize_path(fallback) if fallback else ''
            if not target:
                return ''
        results_dir = _os.path.join(target, 'results')
        _os.makedirs(results_dir, exist_ok=True)
        stamp = timezone.now().strftime('%Y-%m-%d_%H%M')
        filename = f'{stamp}_{_result_slug(job.name)}_{str(run.pk)[:8]}.md'
        path = _os.path.join(results_dir, filename)
        structured = run.structured_result or {}
        summary = str(structured.get('summary') or run.failure_reason or '').strip()
        finished = run.finished_at or timezone.now()
        started = run.started_at or finished
        lines = [
            f'# {job.name} — {run.status} ({run.trigger}, {finished:%Y-%m-%d %H:%M})',
            f'- Status: {run.status}',
            f'- Trigger: {run.trigger or "schedule"}',
            f'- Tool: {job.tool}/{job.mode}' + (f' · {job.model_id}' if job.model_id else ''),
            f'- Started: {started:%Y-%m-%d %H:%M}  Finished: {finished:%Y-%m-%d %H:%M}',
            f'- Alert: {bool(structured.get("alert"))}',
            '',
            '## Summary',
            summary or '(no summary)',
            '',
            '## Result JSON',
            '```json',
            json.dumps(structured, ensure_ascii=False, indent=2) if structured else '{}',
            '```',
            '',
            '## Console tail',
            '```',
            (run.output_tail or '(empty)')[-8000:],
            '```',
            '',
        ]
        with open(path, 'w', encoding='utf-8') as handle:
            handle.write('\n'.join(lines))
        return path
    except Exception:
        return ''


PASS_STATUSES = ('done', 'passed', 'success', 'completed', 'ok')


def _extract_error_line(tail: str, limit: int = 500) -> str:
    """Last `Error: ...` line from terminal output, or '' when absent."""
    if not tail:
        return ''
    lines = [line.strip() for line in tail.replace('\r', '\n').split('\n')]
    for line in reversed(lines):
        if not line or 'SOLODEV_CRON_EXIT' in line:
            continue
        match = re.search(r'error\s*:\s*(.+)', line, re.I)
        if match:
            return match.group(0).strip()[:limit]
    return ''


def _await_result(session, timeout_s: int, expect_exit: bool) -> dict:
    """Poll one terminal until CRON_RESULT, fast process exit, or timeout.

    Returns {'found', 'tail', 'exit_status', 'timed_out', 'dead'} where
    exit_status is 'ok'/'fail'/None (headless exit markers only).
    """
    deadline = time.time() + timeout_s
    tail = ''
    found: dict = {}
    exit_status = None
    while time.time() < deadline:
        if not session.is_alive():
            try:
                _t, text, _o, _m = session.read_since(0)
                tail = text[-12000:]
            except Exception:
                pass
            return {'found': found, 'tail': tail, 'exit_status': exit_status,
                    'timed_out': False, 'dead': True}
        try:
            _t, text, _o, _m = session.read_since(0)
            tail = text[-12000:]
        except Exception:
            pass
        match = agent_launcher.CRON_RESULT_RE.search(tail) or agent_launcher.ORCH_RESULT_RE.search(tail)
        if match:
            try:
                found = json.loads(match.group(1))
            except Exception:
                found = {'status': 'done', 'summary': match.group(1)[:500]}
            return {'found': found, 'tail': tail, 'exit_status': exit_status,
                    'timed_out': False, 'dead': False}
        if expect_exit:
            if agent_launcher.EXIT_FAIL_RE.search(tail):
                exit_status = 'fail'
            elif agent_launcher.EXIT_OK_RE.search(tail):
                exit_status = 'ok'
            if exit_status:
                return {'found': found, 'tail': tail, 'exit_status': exit_status,
                        'timed_out': False, 'dead': False}
        time.sleep(2.0)
    try:
        alive = bool(session.is_alive())
    except Exception:
        alive = False
    return {'found': found, 'tail': tail, 'exit_status': exit_status,
            'timed_out': alive, 'dead': not alive}


def _apply_headless_outcome(job: CronJob, run: CronRun, *, found: dict, tail: str,
                            exit_status: str | None, dead: bool) -> CronRun:
    """Finalize a headless run. No result + no success marker is a failure."""
    status_text = str((found or {}).get('status') or '').lower()
    run.structured_result = found if isinstance(found, dict) else {}
    run.output_tail = (tail or '')[-4000:]
    if found:
        run.status = CronRun.PASSED if status_text in PASS_STATUSES else CronRun.FAILED
        if run.status == CronRun.FAILED and not run.failure_reason:
            run.failure_reason = str(found.get('blockers') or found.get('summary') or 'Agent reported failure.')[:2000]
    elif exit_status == 'fail':
        run.status = CronRun.FAILED
        run.failure_reason = (_extract_error_line(tail)
                              or 'Agent exited with an error before emitting CRON_RESULT.')[:2000]
    elif exit_status == 'ok':
        run.status = CronRun.FAILED
        run.failure_reason = 'Agent finished without emitting CRON_RESULT.'
    elif dead:
        run.status = CronRun.FAILED
        run.failure_reason = (_extract_error_line(tail)
                              or 'Agent terminal closed before emitting CRON_RESULT.')[:2000]
    else:  # pragma: no cover - defensive; callers handle timeouts first
        run.status = CronRun.FAILED
        run.failure_reason = 'No CRON_RESULT emitted.'
    run.finished_at = timezone.now()
    run.save(update_fields=['structured_result', 'output_tail', 'status', 'failure_reason', 'finished_at'])
    return _finish(job, run)


def _run_headless_opencode(job: CronJob, run: CronRun, session, timeout_s: int, resolved_model: str) -> CronRun:
    """Execute an opencode automation via headless `opencode run`.

    The model reference was already resolved fail-fast (bare slug ->
    provider/model) before the terminal was spawned; the command carries an
    exit marker so CLI errors surface in seconds instead of masquerading as
    full-length timeouts. Output still streams into the same terminal, so
    Watch live keeps working unchanged.
    Returns via _finish like the TUI path; the outer finally cleans up.
    """
    import os as _os
    import tempfile as _tempfile

    prompt_path = ''
    try:
        with _tempfile.NamedTemporaryFile(mode='w', suffix='.md', delete=False, encoding='utf-8') as fh:
            fh.write(_build_prompt(job))
            prompt_path = fh.name
        message = (
            'Follow the instructions in the attached file. '
            'When finished, print exactly one line beginning with '
            'CRON_RESULT: followed by JSON with keys status, summary, alert (boolean).'
        )
        session.write(agent_launcher.headless_command(
            model_id=resolved_model, agent=job.mode or 'build',
            prompt_file=prompt_path, message=message,
            title=f'Cron {(job.name or "")[:60]}') + '\r')
        outcome = _await_result(session, timeout_s, expect_exit=True)
        if outcome['timed_out']:
            if session.is_alive():
                try:
                    session.write('\x03')
                except Exception:
                    pass
                time.sleep(2.0)
                tail = _terminal_tail(session, 12000)
                run.status = CronRun.TIMEOUT
                run.failure_reason = f'Exceeded {job.timeout_minutes}min timeout.'
                run.output_tail = tail[-4000:]
                run.finished_at = timezone.now()
                run.save(update_fields=['status', 'failure_reason', 'output_tail', 'finished_at'])
                return _finish(job, run)
        return _apply_headless_outcome(
            job, run, found=outcome['found'], tail=outcome['tail'],
            exit_status=outcome['exit_status'], dead=outcome['dead'])
    finally:
        if prompt_path:
            try:
                _os.unlink(prompt_path)
            except Exception:
                pass


def run_job(job_id, trigger: str = 'schedule') -> CronRun | None:
    job = _claim(job_id)
    if not job:
        return None
    timeout_s = max(1, int(job.timeout_minutes or 15)) * 60
    run = CronRun.objects.create(job=job, status=CronRun.RUNNING, trigger=trigger or 'schedule',
                                 started_at=timezone.now())
    session = None
    try:
        primary, fallback = _workdir(job)
        if not primary:
            raise TerminalError('Working directory is not set or invalid for this automation.')
        headless_model = ''
        if (job.tool or 'opencode') == 'opencode':
            # Fail fast before spawning a terminal: a bad model reference
            # would otherwise die in ~2s and poll until the full timeout.
            headless_model, model_error = opencode_models.resolve_model(job.model_id or '')
            if model_error:
                run.status = CronRun.FAILED
                run.failure_reason = model_error[:2000]
                run.output_tail = ''
                run.finished_at = timezone.now()
                run.save(update_fields=['status', 'failure_reason', 'output_tail', 'finished_at'])
                return _finish(job, run)
        session = terminal_manager.create_cmd(
            owner_id=job.owner_id, project_id=str(job.pk), project_title=f'Cron: {job.name[:60]}',
            directory=primary, fallback_directory=fallback or None,
            python_env=normalize_path(job.python_env),
            project_env=_terminal_env(job),
        )
        session.mode = 'cron'
        session.title = f'Cron: {job.name[:40]}'
        run.terminal_id = session.id
        run.save(update_fields=['terminal_id'])
        if (job.tool or 'opencode') == 'opencode':
            # Headless `opencode run`: no TUI composer, no paste handshake.
            # The TUI proved too flaky for automation (update notices and
            # chrome variations defeat ready detection), while `run` streams
            # straight into the same terminal for live watching.
            return _run_headless_opencode(job, run, session, timeout_s, headless_model)
        session.write(agent_launcher.cli_command(
            tool=job.tool, model_id=job.model_id or '',
            reasoning_effort=job.reasoning_effort or 'medium', mode=job.mode or 'build') + '\r')
        ready = agent_launcher.wait_for_ready(session, timeout=180)
        if ready == 'trust':
            run.status = CronRun.NEEDS_ATTENTION
            run.failure_reason = 'Agent is waiting for an interactive trust confirmation.'
            run.output_tail = _terminal_tail(session)
            run.finished_at = timezone.now()
            run.save(update_fields=['status', 'failure_reason', 'output_tail', 'finished_at'])
            return _finish(job, run)
        if ready != 'ready':
            raise TerminalError(f'Agent did not open its composer ({ready}).', 504)
        agent_launcher.submit_prompt(session, _build_prompt(job))
        outcome = _await_result(session, timeout_s, expect_exit=False)
        if outcome['timed_out']:
            # loop exhausted without break => timeout (only when deadline passed while alive)
            run.status = CronRun.TIMEOUT
            run.failure_reason = f'Exceeded {job.timeout_minutes}min timeout.'
            try:
                _t, text, _o, _m = session.read_since(0)
                outcome['tail'] = text[-12000:]
            except Exception:
                pass
            run.output_tail = outcome['tail'][-4000:]
            run.finished_at = timezone.now()
            run.save(update_fields=['status', 'failure_reason', 'output_tail', 'finished_at'])
            return _finish(job, run)
        found = outcome['found']
        tail = outcome['tail']
        status_text = str((found or {}).get('status') or '').lower()
        run.structured_result = found if isinstance(found, dict) else {}
        run.output_tail = tail[-4000:]
        if not found:
            run.status = CronRun.PASSED if session.is_alive() or tail else CronRun.FAILED
            if run.status == CronRun.FAILED and not run.failure_reason:
                run.failure_reason = 'No CRON_RESULT emitted.'
        else:
            run.status = CronRun.PASSED if status_text in PASS_STATUSES else CronRun.FAILED
            if run.status == CronRun.FAILED and not run.failure_reason:
                run.failure_reason = str(found.get('blockers') or found.get('summary') or 'Agent reported failure.')[:2000]
        run.finished_at = timezone.now()
        run.save(update_fields=['structured_result', 'output_tail', 'status', 'failure_reason', 'finished_at'])
        return _finish(job, run)
    except TerminalError as exc:
        run.status = CronRun.FAILED
        run.failure_reason = exc.message[:2000]
        run.output_tail = _terminal_tail(session)
        run.finished_at = timezone.now()
        run.save(update_fields=['status', 'failure_reason', 'output_tail', 'finished_at'])
        return _finish(job, run)
    except Exception as exc:
        run.status = CronRun.FAILED
        run.failure_reason = f'{type(exc).__name__}: {exc}'[:2000]
        run.output_tail = _terminal_tail(session)
        run.finished_at = timezone.now()
        run.save(update_fields=['status', 'failure_reason', 'output_tail', 'finished_at'])
        return _finish(job, run)
    finally:
        if session:
            try:
                terminal_manager.remove_for_user(session.id, job.owner_id)
            except Exception:
                pass
        try:
            _release(job)
        except Exception:
            pass


def _finish(job: CronJob, run: CronRun) -> CronRun:
    notified = False
    if _should_notify(job, run):
        notified = _send_notification(job, run)
    run.notified = notified
    run.save(update_fields=['notified'])
    # The report lands on disk right after the run so Result files / changed
    # highlighting always have something to show, even if the agent itself
    # never wrote a file. The +30s highlight buffer covers this write.
    _write_result_file(job, run)
    fails = int(job.consecutive_failures or 0)
    if run.status in (CronRun.FAILED, CronRun.TIMEOUT):
        fails += 1
    else:
        fails = 0
    paused = fails >= 3
    CronJob.objects.filter(pk=job.pk).update(
        consecutive_failures=fails,
        enabled=not paused if paused else job.enabled,
        last_status=run.status,
        last_run_at=timezone.now(),
        next_run_at=compute_next_run(job.schedule_kind, job.schedule_value),
        updated_at=timezone.now(),
    )
    return run

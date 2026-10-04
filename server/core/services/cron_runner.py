"""Headless + in-app execution of CronJob rows.

Single entry point run_job(job_id, trigger) used by:
- management command run_cron_job (Task Scheduler, app closed)
- in-app scheduler thread (app open)
- API run-now
"""
from __future__ import annotations

import json
import time
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from ..models import CronJob, CronRun
from ..pathutils import normalize_path
from . import agent_launcher
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
    )
    return (base + footer).strip()


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
        session.write(agent_launcher.cli_command(
            tool=job.tool, model_id=job.model_id or '',
            reasoning_effort=job.reasoning_effort or 'medium', mode=job.mode or 'build') + '\r')
        ready = agent_launcher.wait_for_ready(session, timeout=180)
        if ready == 'trust':
            run.status = CronRun.NEEDS_ATTENTION
            run.failure_reason = 'Agent is waiting for an interactive trust confirmation.'
            run.finished_at = timezone.now()
            run.save(update_fields=['status', 'failure_reason', 'finished_at'])
            return _finish(job, run)
        if ready != 'ready':
            raise TerminalError(f'Agent did not open its composer ({ready}).', 504)
        agent_launcher.submit_prompt(session, _build_prompt(job))
        deadline = time.time() + timeout_s
        tail = ''
        found: dict = {}
        import re as _re
        while time.time() < deadline:
            if not session.is_alive():
                break
            _t, text, _o, _m = session.read_since(0)
            tail = text[-12000:]
            match = agent_launcher.CRON_RESULT_RE.search(tail) or agent_launcher.ORCH_RESULT_RE.search(tail)
            if match:
                try:
                    found = json.loads(match.group(1))
                except Exception:
                    found = {'status': 'done', 'summary': match.group(1)[:500]}
                break
            time.sleep(2.0)
        else:
            # loop exhausted without break => timeout (only when deadline passed while alive)
            if session.is_alive():
                run.status = CronRun.TIMEOUT
                run.failure_reason = f'Exceeded {job.timeout_minutes}min timeout.'
                try:
                    _t, text, _o, _m = session.read_since(0)
                    tail = text[-12000:]
                except Exception:
                    pass
                run.output_tail = tail[-4000:]
                run.finished_at = timezone.now()
                run.save(update_fields=['status', 'failure_reason', 'output_tail', 'finished_at'])
                return _finish(job, run)
        try:
            _t, text, _o, _m = session.read_since(0)
            tail = text[-12000:]
        except Exception:
            pass
        status_text = str((found or {}).get('status') or '').lower()
        run.structured_result = found if isinstance(found, dict) else {}
        run.output_tail = tail[-4000:]
        if not found:
            run.status = CronRun.PASSED if session.is_alive() or tail else CronRun.FAILED
            if run.status == CronRun.FAILED and not run.failure_reason:
                run.failure_reason = 'No CRON_RESULT emitted.'
        else:
            run.status = CronRun.PASSED if status_text in ('done', 'passed', 'success', 'completed', 'ok') else CronRun.FAILED
            if run.status == CronRun.FAILED and not run.failure_reason:
                run.failure_reason = str(found.get('blockers') or found.get('summary') or 'Agent reported failure.')[:2000]
        run.finished_at = timezone.now()
        run.save(update_fields=['structured_result', 'output_tail', 'status', 'failure_reason', 'finished_at'])
        return _finish(job, run)
    except TerminalError as exc:
        run.status = CronRun.FAILED
        run.failure_reason = exc.message[:2000]
        run.finished_at = timezone.now()
        run.save(update_fields=['status', 'failure_reason', 'finished_at'])
        return _finish(job, run)
    except Exception as exc:
        run.status = CronRun.FAILED
        run.failure_reason = f'{type(exc).__name__}: {exc}'[:2000]
        run.finished_at = timezone.now()
        run.save(update_fields=['status', 'failure_reason', 'finished_at'])
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

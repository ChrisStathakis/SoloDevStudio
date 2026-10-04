"""In-app ticker for CronJobs (mirrors the orchestrator coordinator pattern).

Lightweight daemon thread: every 60s claim due jobs and run them via
cron_runner.run_job. State stays in DB; the thread is only a wake-up.
"""
from __future__ import annotations

import threading
import time

from django.db import close_old_connections
from django.utils import timezone

_cron_lock = threading.RLock()
_cron_thread: threading.Thread | None = None


def _tick_once():
    from ..models import CronJob
    from .cron_runner import run_job
    close_old_connections()
    now = timezone.now()
    due = list(CronJob.objects.filter(enabled=True).filter(next_run_at__lte=now)[:5])
    # Jobs without next_run_at (legacy) are due immediately, once.
    if not due:
        undated = list(CronJob.objects.filter(enabled=True, next_run_at__isnull=True)[:5])
        due = undated
    for job in due:
        try:
            run_job(str(job.pk), trigger='ticker')
        except Exception:
            continue
    close_old_connections()


def _loop():
    while True:
        try:
            _tick_once()
        except Exception:
            pass
        time.sleep(60)


def ensure_started():
    global _cron_thread
    with _cron_lock:
        if _cron_thread and _cron_thread.is_alive():
            return
        t = threading.Thread(target=_loop, name='cron-ticker', daemon=True)
        _cron_thread = t
        t.start()

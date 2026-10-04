"""Schedule helpers for CronJob: compute next_run_at without extra deps."""
from __future__ import annotations

from datetime import datetime, timedelta

from django.utils import timezone


def _parse_hhmm(value: str) -> tuple[int, int]:
    raw = (value or '').strip()
    try:
        hh, mm = raw.split(':')
        h, m = int(hh), int(mm)
        if 0 <= h <= 23 and 0 <= m <= 59:
            return h, m
    except Exception:
        pass
    return 9, 0


def _parse_hours(value: str) -> int:
    try:
        hours = int(str(value or '').strip())
        return max(1, min(hours, 168))
    except Exception:
        return 6


def compute_next_run(kind: str, value: str, from_dt=None):
    now = from_dt or timezone.now()
    kind = (kind or '').strip().lower()
    if kind == 'every_hours':
        hours = _parse_hours(value)
        return now + timedelta(hours=hours)
    if kind == 'cron':
        # Minimal cron support: "m h * * *" daily at h:m. Anything else -> hourly.
        try:
            parts = str(value or '').strip().split()
            if len(parts) >= 2:
                minute = int(parts[0])
                hour = int(parts[1])
                if 0 <= minute <= 59 and 0 <= hour <= 23:
                    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                    if candidate <= now:
                        candidate = candidate + timedelta(days=1)
                    return candidate
        except Exception:
            pass
        return now + timedelta(hours=1)
    # daily HH:MM
    h, m = _parse_hhmm(value)
    candidate = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if candidate <= now:
        candidate = candidate + timedelta(days=1)
    return candidate

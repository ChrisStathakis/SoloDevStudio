"""Windows Task Scheduler integration (per-job tasks, option A).

One scheduled task per CronJob: SoloDevStudio\\cron-<short8>.
Uses schtasks.exe (built-in, no extra deps). Tasks run only when the user
is logged on because ConPTY + LLM CLIs need a user session.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

TASK_FOLDER = 'SoloDevStudio'
CREATE_NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def task_name_for_job(job_id: str) -> str:
    short = str(job_id).replace('-', '')[:8]
    return rf'{TASK_FOLDER}\cron-{short}'


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent.parent.parent


def build_action(job_id: str) -> tuple[str, str, str]:
    """Return (python_exe, args, start_in) for the scheduled action."""
    root = repo_root()
    manage = root / 'server' / 'manage.py'
    db_path = os.environ.get('SQLITE_PATH') or str(root / 'server' / 'db.sqlite3')
    python_exe = sys.executable or 'python'
    args = f'"{manage}" run_cron_job --job-id {job_id} --db-path "{db_path}"'
    return python_exe, args, str(root)


def _run_schtasks(args: list[str], timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(
        ['schtasks', *args],
        text=True, capture_output=True, timeout=timeout,
        creationflags=CREATE_NO_WINDOW,
    )


def build_trigger_args(job) -> list[str]:
    kind = (job.schedule_kind or '').lower()
    value = (job.schedule_value or '').strip()
    if kind == 'every_hours':
        try:
            hours = max(1, min(int(value), 24))
        except Exception:
            hours = 6
        # schtasks HOURLY supports /MO 1..23
        return ['/SC', 'HOURLY', '/MO', str(hours)]
    if kind == 'cron':
        return ['/SC', 'HOURLY', '/MO', '1']
    # daily HH:MM
    try:
        hh, mm = value.split(':')
        st = f'{int(hh):02d}:{int(mm):02d}'
    except Exception:
        st = '09:00'
    return ['/SC', 'DAILY', '/ST', st]


def sync_job_task(job) -> dict:
    """Create or update the Windows task for an enabled job. Disabled jobs are removed."""
    name = task_name_for_job(job.id)
    if not job.enabled:
        delete_job_task(job.id)
        return {'task_name': name, 'synced': False, 'reason': 'job disabled'}
    if os.name != 'nt':
        return {'task_name': name, 'synced': False, 'reason': 'requires Windows'}
    python_exe, args, start_in = build_action(job.id)
    # schtasks /TR takes a single command string; quote exe for spaces.
    tr = f'"{python_exe}" {args}'
    trigger = build_trigger_args(job)
    final = ['/Create', '/F', '/TN', name, '/TR', tr] + trigger
    proc = _run_schtasks(final)
    ok = proc.returncode == 0
    return {'task_name': name, 'synced': bool(ok), 'output': (proc.stdout + proc.stderr)[-2000:]}


def delete_job_task(job_id: str) -> dict:
    name = task_name_for_job(job_id)
    if os.name != 'nt':
        return {'task_name': name, 'deleted': False}
    proc = _run_schtasks(['/Delete', '/F', '/TN', name])
    return {'task_name': name, 'deleted': proc.returncode == 0}


def query_task_status(job_id: str) -> dict:
    name = task_name_for_job(job_id)
    if os.name != 'nt':
        return {'task_name': name, 'exists': False, 'reason': 'requires Windows'}
    proc = _run_schtasks(['/Query', '/TN', name, '/FO', 'LIST', '/V'])
    exists = proc.returncode == 0
    return {'task_name': name, 'exists': exists, 'detail': (proc.stdout or proc.stderr)[-2000:]}

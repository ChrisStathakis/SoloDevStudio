"""Windows toast notifications for headless cron runs (no extra deps).

Uses PowerShell BurntToast when available, else falls back to a classic
balloon via System.Windows.Forms. Failures are silent — the CronRun row
remains the source of truth.
"""
from __future__ import annotations

import subprocess

CREATE_NO_WINDOW = getattr(subprocess, 'CREATE_NO_WINDOW', 0)


def send_toast(title: str, message: str) -> bool:
    text = (message or '')[:400].replace("'", "''").replace('"', '')
    title = (title or 'SoloDev Studio')[:120].replace("'", "''")
    ps = (
        "try { "
        "if (Get-Module -ListAvailable -Name BurntToast) { "
        "Import-Module BurntToast; "
        f"New-BurntToastNotification -Text '{title}', '{text}' | Out-Null; exit 0; "
        "} } catch { }; "
        "Add-Type -AssemblyName System.Windows.Forms | Out-Null; "
        "$n = New-Object System.Windows.Forms.NotifyIcon; "
        "$n.Icon = [System.Drawing.SystemIcons]::Information; "
        "$n.BalloonTipTitle = '" + title + "'; "
        "$n.BalloonTipText = '" + text + "'; "
        "$n.Visible = $true; $n.ShowBalloonTip(8000); "
        "Start-Sleep -Milliseconds 9000; $n.Dispose()"
    )
    try:
        proc = subprocess.run(
            ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
            capture_output=True, timeout=30, creationflags=CREATE_NO_WINDOW,
        )
        return proc.returncode == 0
    except Exception:
        return False

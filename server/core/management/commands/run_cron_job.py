"""Headless cron execution for Windows Task Scheduler (app may be closed).

Usage (dev sqlite):
    python server/manage.py run_cron_job --job-id <uuid>
    python server/manage.py run_cron_job --claim-due --db-path "C:\\...\\db.sqlite3"
"""
from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Run a SoloDev cron job headlessly (Windows Task Scheduler).'

    def add_arguments(self, parser):
        parser.add_argument('--job-id', default='')
        parser.add_argument('--claim-due', action='store_true')
        parser.add_argument('--db-path', default='')
        parser.add_argument('--trigger', default='task-scheduler')

    def handle(self, *args, **options):
        db_path = (options.get('db-path') or '').strip()
        if db_path:
            # Settings already read SQLITE_PATH at import; repoint the
            # connection explicitly so Task Scheduler can target dev sqlite.
            from django.conf import settings
            from django.db import connections
            settings.DATABASES['default']['NAME'] = db_path
            try:
                connections.close_all()
            except Exception:
                pass

        from core.models import CronJob
        from core.services.cron_runner import run_job
        from django.utils import timezone

        job_id = (options.get('job-id') or '').strip()
        if options.get('claim_due'):
            now = timezone.now()
            due = list(CronJob.objects.filter(enabled=True, next_run_at__lte=now)[:5])
            if not due:
                due = list(CronJob.objects.filter(enabled=True, next_run_at__isnull=True)[:5])
            if not due:
                self.stdout.write('No due cron jobs.')
                return
            for job in due:
                run = run_job(str(job.pk), trigger=options.get('trigger') or 'task-scheduler')
                self.stdout.write(f'{job.name}: {run.status if run else "skipped"}')
            return
        if not job_id:
            raise CommandError('--job-id is required (or use --claim-due).')
        if not CronJob.objects.filter(pk=job_id).exists():
            raise CommandError(f'CronJob not found: {job_id}')
        run = run_job(job_id, trigger=options.get('trigger') or 'task-scheduler')
        if not run:
            self.stdout.write('Skipped (lease held or disabled).')
            return
        self.stdout.write(f'{run.status}')
        if run.status in ('failed', 'timeout'):
            raise CommandError(run.failure_reason or run.status)

from django.apps import AppConfig


class CoreConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'core'

    def ready(self):
        # Start the in-app cron ticker (no-op for management commands like
        # run_cron_job / migrate / test that must stay short-lived).
        import os
        import sys
        argv = ' '.join(sys.argv)
        if any(cmd in argv for cmd in ('run_cron_job', 'migrate', 'makemigrations', 'test', 'shell')):
            return
        if os.environ.get('RUN_MAIN') == 'true' or 'runserver' in argv or 'desktop_backend' in argv:
            try:
                from .services.cron_scheduler import ensure_started
                ensure_started()
            except Exception:
                pass

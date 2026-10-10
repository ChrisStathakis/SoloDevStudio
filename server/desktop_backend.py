"""Small, self-contained WSGI host used by the Windows desktop build.

The regular development scripts continue to use Django's runserver.  This
entrypoint exists so the packaged app can carry its own Python runtime and
start only a loopback API process with a per-user database.
"""

from __future__ import annotations

import argparse
import atexit
import os
import secrets
import threading
from pathlib import Path
from signal import SIGINT, SIGTERM, signal
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIServer, make_server


class BackendInstanceLock:
    """Keep one packaged backend writer per per-user SQLite database."""

    def __init__(self, db_path: Path):
        self.path = Path(f'{db_path}.backend.lock')
        self.handle = self.path.open('a+', encoding='utf-8')
        try:
            if os.name == 'nt':
                import msvcrt
                # msvcrt.locking requires at least one byte in the file.  Do
                # this before writing our PID so a rejected second backend
                # cannot overwrite the first backend's diagnostic owner.
                self.handle.seek(0, 2)
                if self.handle.tell() == 0:
                    self.handle.write('0')
                    self.handle.flush()
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (OSError, BlockingIOError):
            self.handle.close()
            raise SystemExit(f'Another SoloDev Studio backend already owns {db_path}. Close it before starting another instance.')
        self.handle.seek(0)
        self.handle.write(str(os.getpid()).ljust(32))
        self.handle.truncate()
        self.handle.flush()

    def release(self):
        if not self.handle or self.handle.closed:
            return
        try:
            if os.name == 'nt':
                import msvcrt
                self.handle.seek(0)
                msvcrt.locking(self.handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        self.handle.close()


class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True
    allow_reuse_address = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SoloDev Studio desktop API")
    parser.add_argument("--port", type=int)
    parser.add_argument("--db-path")
    parser.add_argument("--terminal-self-test", action="store_true")
    parser.add_argument("--origin", default="app://solodev")
    return parser.parse_args()


INSECURE_DEFAULT_KEY = 'django-insecure-dev-key-change-in-prod-solodev-2026'


def ensure_secret_key(app_dir: Path) -> str:
    """Return a stable per-install SECRET_KEY, generating one on first run.

    The packaged desktop app runs with DEBUG=False but ships no SECRET_KEY,
    which trips the production guard in config.settings. Keep a random key
    next to the per-user database so sessions stay valid across restarts.
    An explicit SECRET_KEY env var (custom or >=32 chars) always wins.
    """
    override = os.environ.get('SECRET_KEY')
    if override and override != INSECURE_DEFAULT_KEY and len(override) >= 32:
        return override
    key_file = app_dir / 'secret.key'
    try:
        existing = key_file.read_text(encoding='utf-8').strip()
    except OSError:
        existing = ''
    if len(existing) >= 32:
        os.environ['SECRET_KEY'] = existing
        return existing
    fresh = secrets.token_urlsafe(64)
    try:
        fd = os.open(str(key_file), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            handle.write(fresh)
    except OSError:
        key_file.write_text(fresh, encoding='utf-8')
    os.environ['SECRET_KEY'] = fresh
    return fresh


def main() -> None:
    args = parse_args()
    if args.terminal_self_test:
        os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
        import django
        django.setup()
        from django.core.management import call_command
        failures = call_command('test', 'core.test_terminal_runtime', verbosity=2)
        raise SystemExit(1 if failures else 0)
    if args.port is None or not args.db_path:
        raise SystemExit('--port and --db-path are required')
    if not 1 <= args.port <= 65535:
        raise SystemExit("--port must be between 1 and 65535")

    db_path = Path(args.db_path).expanduser().resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    ensure_secret_key(db_path.parent)
    backend_lock = BackendInstanceLock(db_path)
    atexit.register(backend_lock.release)
    project_root = db_path.parent / 'projects'
    project_root.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    os.environ["SQLITE_PATH"] = str(db_path)
    os.environ.setdefault("PROJECTS_ROOT", str(project_root))
    os.environ["ALLOWED_HOSTS"] = "127.0.0.1,localhost"
    # Preserve web dev origins alongside the desktop custom-scheme origin.
    # Overwriting with only app://solodev blocks localhost frontends with
    # "No 'Access-Control-Allow-Origin'" on preflight.
    _web_origins = (
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:5174,http://127.0.0.1:5174"
    )
    os.environ["CORS_ALLOWED_ORIGINS"] = ",".join(
        dict.fromkeys([args.origin, *_web_origins.split(",")])
    )
    os.environ.setdefault("DEBUG", "False")

    # Import Django only after runtime settings have been supplied.
    import django

    django.setup()

    from django.core.management import call_command
    from config.wsgi import application

    call_command("migrate", interactive=False, verbosity=0)
    from core.services.orchestrator_coordinator import coordinator
    coordinator.recover_active_runs()
    server = make_server(
        "127.0.0.1",
        args.port,
        application,
        server_class=ThreadingWSGIServer,
    )

    def stop(_signum, _frame):
        # shutdown() must run outside the serve_forever thread.
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal(SIGINT, stop)
    signal(SIGTERM, stop)

    print(f"SoloDev Studio desktop API listening on http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

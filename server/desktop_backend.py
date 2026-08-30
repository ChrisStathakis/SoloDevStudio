"""Small, self-contained WSGI host used by the Windows desktop build.

The regular development scripts continue to use Django's runserver.  This
entrypoint exists so the packaged app can carry its own Python runtime and
start only a loopback API process with a per-user database.
"""

from __future__ import annotations

import argparse
import os
import threading
from pathlib import Path
from signal import SIGINT, SIGTERM, signal
from socketserver import ThreadingMixIn
from wsgiref.simple_server import WSGIServer, make_server


class ThreadingWSGIServer(ThreadingMixIn, WSGIServer):
    daemon_threads = True
    allow_reuse_address = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="SoloDev Studio desktop API")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--db-path", required=True)
    parser.add_argument("--origin", default="app://solodev")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if not 1 <= args.port <= 65535:
        raise SystemExit("--port must be between 1 and 65535")

    db_path = Path(args.db_path).expanduser().resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    os.environ["SQLITE_PATH"] = str(db_path)
    os.environ["ALLOWED_HOSTS"] = "127.0.0.1,localhost"
    os.environ["CORS_ALLOWED_ORIGINS"] = args.origin
    os.environ.setdefault("DEBUG", "False")

    # Import Django only after runtime settings have been supplied.
    import django

    django.setup()

    from django.core.management import call_command
    from config.wsgi import application

    call_command("migrate", interactive=False, verbosity=0)
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

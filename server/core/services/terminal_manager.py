"""In-app terminal sessions backed by Windows ConPTY (pywinpty).

Each session spawns cmd.exe (or a project's .bat/.cmd script) inside its own
pseudo console owned by the Django process, buffers recent output in memory
and lets HTTP clients consume it incrementally by byte/char offset.
"""
import os
import subprocess
import threading
import time
import uuid as uuid_lib
from collections import OrderedDict
from datetime import timedelta

from django.utils import timezone

try:
    from winpty import PtyProcess
    HAS_WINPTY = True
except Exception:  # pragma: no cover - non-Windows or missing dependency
    PtyProcess = None
    HAS_WINPTY = False

from core.pathutils import resolve_venv


DEFAULT_COLS = 110
DEFAULT_ROWS = 28
MAX_BUFFER_CHARS = 256 * 1024          # ~256 KB of replay history per session
MAX_ALIVE_SESSIONS_PER_USER = 6
EXITED_SESSION_TTL = timedelta(minutes=30)
STREAM_MAX_SECONDS = 540               # long-poll ceiling; client reconnects after


class TerminalError(Exception):
    def __init__(self, message, http_status=400):
        super().__init__(message)
        self.message = message
        self.http_status = http_status


class TerminalSession:
    def __init__(self, *, owner_id, project_id, project_title, mode, pty, title, cwd):
        self.id = uuid_lib.uuid4().hex
        self.owner_id = str(owner_id)
        self.project_id = str(project_id)
        self.project_title = project_title
        self.mode = mode                     # 'cmd' | 'script'
        self.title = title
        self.cwd = cwd
        self.created_at = timezone.now()
        self.exited_at = None
        self.exit_code = None
        self.killed = False

        self._pty = pty
        self._buf_lock = threading.Lock()
        self._buffer = ''
        self._dropped = 0                    # chars trimmed off the front
        self._appended = 0                   # total chars ever received

        t = threading.Thread(target=self._reader_loop, name=f'term-{self.id[:8]}', daemon=True)
        t.start()

    # ---------- output buffering ----------

    def _append(self, chunk):
        with self._buf_lock:
            self._buffer += chunk
            self._appended += len(chunk)
            overflow = len(self._buffer) - MAX_BUFFER_CHARS
            if overflow > 0:
                self._buffer = self._buffer[overflow:]
                self._dropped += overflow

    def stats(self):
        with self._buf_lock:
            return self._appended, self._dropped

    def read_since(self, offset):
        """Return (truncated, text, next_offset, has_more)."""
        with self._buf_lock:
            if offset < self._dropped or offset > self._appended:
                return (True, self._buffer, self._appended, False)
            text = self._buffer[offset - self._dropped:]
            return (False, text, self._appended, False)

    # ---------- liveness ----------

    def is_alive(self):
        if self.exited_at is not None:
            return False
        try:
            return bool(self._pty.isalive())
        except Exception:
            return False

    def finalize_if_dead(self):
        if self.exited_at is not None:
            return
        if not self.is_alive():
            self.exited_at = timezone.now()
            try:
                status = getattr(self._pty, 'exitstatus', None)
                self.exit_code = int(status) if status is not None else None
            except Exception:
                self.exit_code = None

    def resize(self, cols, rows):
        cols = max(2, min(int(cols), 500))
        rows = max(2, min(int(rows), 300))
        self.finalize_if_dead()
        if self.exited_at is not None:
            raise TerminalError('Session already exited.', 409)
        try:
            # pywinpty >=3 exposes setwinsize(rows, cols); older builds had set_size(cols, rows)
            setter = getattr(self._pty, 'setwinsize', None)
            if callable(setter):
                setter(rows, cols)
            else:
                self._pty.set_size(cols, rows)
        except Exception as e:
            raise TerminalError(f'Resize failed: {e}', 500)

    def write(self, data):
        if self.exited_at is not None:
            raise TerminalError('Session already exited.', 409)
        try:
            payload = data if isinstance(data, str) else str(data)
            self._pty.write(payload)
        except EOFError:
            self.finalize_if_dead()
            raise TerminalError('Session already exited.', 409)
        except Exception as e:
            raise TerminalError(f'Write failed: {e}', 500)

    def kill(self):
        self.killed = True
        pid = None
        try:
            pid = self._pty.pid
        except Exception:
            pid = None
        # Tree-kill the whole process tree so grandchildren launched by a
        # .bat/.cmd script (e.g. uvicorn/node/python servers) are terminated
        # too, not just the direct ConPTY child (cmd.exe).
        if pid:
            try:
                subprocess.run(
                    ['taskkill', '/PID', str(pid), '/T', '/F'],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=10,
                )
            except Exception:
                pass
        if not self.is_alive():
            self.finalize_if_dead()
            return
        try:
            self._pty.terminate(force=True)
        except Exception:
            pass
        self.finalize_if_dead()

    # ---------- background reader ----------

    def _reader_loop(self):
        try:
            while True:
                data = None
                try:
                    data = self._pty.read()
                except (EOFError, KeyboardInterrupt):
                    break
                except Exception:
                    break
                if not data:
                    if not self.is_alive():
                        break
                    time.sleep(0.05)
                    continue
                if isinstance(data, (bytes, bytearray)):
                    data = bytes(data).decode('utf-8', errors='replace')
                self._append(data)
                if not self.is_alive():
                    break
        finally:
            self.finalize_if_dead()

    # ---------- serialization ----------

    def to_dict(self):
        alive = self.is_alive()
        return {
            'id': self.id,
            'projectId': self.project_id,
            'projectTitle': self.project_title,
            'mode': self.mode,
            'title': self.title,
            'cwd': self.cwd,
            'createdAt': self.created_at.isoformat(),
            'alive': alive,
            'exitedAt': self.exited_at.isoformat() if self.exited_at else None,
            'exitCode': self.exit_code,
            'replayChars': min(MAX_BUFFER_CHARS, self.stats()[0]),
        }


class TerminalManager:
    def __init__(self):
        self._sessions = OrderedDict()       # id -> TerminalSession
        self._lock = threading.RLock()

    @property
    def supported(self):
        return HAS_WINPTY

    # ---------- bookkeeping ----------

    def _prune(self, owner_id, now):
        expired_before = now - EXITED_SESSION_TTL
        doomed = [
            sid for sid, s in self._sessions.items()
            if (
                str(s.owner_id) == str(owner_id)
                and s.exited_at is not None
                and s.exited_at < expired_before
            )
        ]
        for sid in doomed:
            self._sessions.pop(sid, None)

    def count_alive_for_user(self, owner_id):
        return sum(1 for s in self._sessions.values() if str(s.owner_id) == str(owner_id) and s.is_alive())

    # ---------- public API ----------

    def create_cmd(self, *, owner_id, project_id, project_title, directory, fallback_directory=None, python_env=None, cols=DEFAULT_COLS, rows=DEFAULT_ROWS):
        self._assert_supported()
        cwd = self._resolve_cmd_cwd(directory, fallback_directory)
        # /d disables registry AutoRun commands and /q keeps the prompt clean.
        # Do not leak Django's server-only process context into a developer shell.
        command = ['cmd.exe', '/d', '/q']
        title = 'CMD'
        activate_bat, _scripts_dir = resolve_venv(python_env)
        if activate_bat:
            # Auto-activate the project's virtualenv on open (keeps the resolved cwd).
            # Pass activate.bat as its own argv token so winpty quotes it correctly
            # (embedding quotes in the string gets re-escaped and breaks `call`).
            command = ['cmd.exe', '/d', '/q', '/k', 'call', activate_bat]
            title = 'CMD (venv)'
        env = dict(os.environ)
        for key in ('DJANGO_SETTINGS_MODULE', 'DJANGO_ALLOW_ASYNC_UNSAFE', 'RUN_MAIN'):
            env.pop(key, None)
        return self._spawn(
            owner_id=owner_id,
            project_id=project_id,
            project_title=project_title,
            mode='cmd',
            command=command,
            title=title,
            cwd=cwd,
            cols=cols,
            rows=rows,
            env=env,
        )

    def _resolve_cmd_cwd(self, directory, fallback_directory=None):
        """Pick a usable CMD working directory, falling back so a console always opens.

        Order: configured cmd_directory -> project directory_path -> PROJECTS_ROOT
        env / process cwd. Raises only if nothing usable exists.
        """
        for cand in (directory, fallback_directory):
            if cand and os.path.isdir(cand):
                return cand
        root = os.environ.get('PROJECTS_ROOT') or os.getcwd()
        if root and os.path.isdir(root):
            return root
        raise TerminalError(
            'No valid CMD directory is configured for this project and no fallback is available. '
            'Set a CMD directory in the project settings.',
            400,
        )

    def create_script(self, *, owner_id, project_id, project_title, script_path, run_args, python_env=None, cols=DEFAULT_COLS, rows=DEFAULT_ROWS):
        self._assert_supported()
        if not script_path:
            raise TerminalError('No script path set for this project.')
        if not os.path.isfile(script_path):
            raise TerminalError(f'Script file does not exist: {script_path}')
        if not script_path.lower().endswith(('.bat', '.cmd')):
            raise TerminalError('Only .bat / .cmd scripts are supported.')
        cwd = os.path.dirname(script_path) or None
        args = [script_path, *run_args]
        pretty_args = f" {' '.join(run_args)}" if run_args else ''
        title = f"{os.path.basename(script_path)}{pretty_args}"
        env = self._build_venv_env(python_env)
        return self._spawn(
            owner_id=owner_id,
            project_id=project_id,
            project_title=project_title,
            mode='script',
            command=args,
            title=title,
            cwd=cwd,
            cols=cols,
            rows=rows,
            env=env,
        )

    def _build_venv_env(self, python_env):
        """Return a modified environment with the venv Scripts dir first on PATH.

        Returns None when no usable venv is configured, so the child inherits the
        parent environment unchanged (preserving existing behavior).
        """
        _activate_bat, scripts_dir = resolve_venv(python_env)
        if not scripts_dir:
            return None
        env = dict(os.environ)
        existing = env.get('PATH', '')
        env['PATH'] = scripts_dir + ';' + existing if existing else scripts_dir
        return env

    def _assert_supported(self):
        if os.name != 'nt' or not hasattr(subprocess, 'CREATE_NEW_CONSOLE') or not HAS_WINPTY:
            raise TerminalError('In-app terminals are only supported on Windows with pywinpty installed.', 501)

    def _spawn(self, **kw):
        owner_id = kw['owner_id']
        now = timezone.now()
        with self._lock:
            self._prune(owner_id, now)
            if self.count_alive_for_user(owner_id) >= MAX_ALIVE_SESSIONS_PER_USER:
                raise TerminalError(
                    f'Maximum of {MAX_ALIVE_SESSIONS_PER_USER} live terminals reached. Close one first.', 429
                )
            try:
                pty = PtyProcess.spawn(
                    kw['command'],
                    cwd=kw['cwd'] or None,
                    env=kw.get('env'),
                    dimensions=(kw['rows'], kw['cols']),
                )
            except Exception as e:
                raise TerminalError(f'Failed to start terminal: {e}', 500)
            session = TerminalSession(
                owner_id=str(owner_id),
                project_id=str(kw['project_id']),
                project_title=kw['project_title'],
                mode=kw['mode'],
                pty=pty,
                title=kw['title'],
                cwd=kw['cwd'] or '',
            )
            self._sessions[session.id] = session
            return session

    def _find_live_unlocked(self, *, owner_id, project_id, mode):
        """Return the newest live session for a project/mode pair.

        Callers must hold ``self._lock``. Keeping this lookup in the manager
        makes the reuse decision atomic with creation, so two rapid requests
        cannot spawn duplicate consoles.
        """
        candidates = [
            s for s in self._sessions.values()
            if str(s.owner_id) == str(owner_id)
            and str(s.project_id) == str(project_id)
            and s.mode == mode
            and s.is_alive()
        ]
        return max(candidates, key=lambda s: s.created_at, default=None)

    def get_or_create_cmd(self, **kwargs):
        with self._lock:
            existing = self._find_live_unlocked(
                owner_id=kwargs['owner_id'], project_id=kwargs['project_id'], mode='cmd'
            )
            if existing is not None:
                return existing, True
            return self.create_cmd(**kwargs), False

    def get_or_create_script(self, **kwargs):
        with self._lock:
            existing = self._find_live_unlocked(
                owner_id=kwargs['owner_id'], project_id=kwargs['project_id'], mode='script'
            )
            if existing is not None:
                return existing, True
            return self.create_script(**kwargs), False

    def get_for_user(self, session_id, owner_id):
        with self._lock:
            session = self._sessions.get(session_id)
            if session is None or str(session.owner_id) != str(owner_id):
                return None
            session.finalize_if_dead()
            return session

    def remove_for_user(self, session_id, owner_id):
        with self._lock:
            session = self.get_for_user(session_id, owner_id)
            if session is None:
                return None
            session.kill()
            self._sessions.pop(session_id, None)
            return session

    def list_for_user(self, owner_id, project_id=None, alive_only=False):
        with self._lock:
            sessions = []
            for s in list(self._sessions.values()):
                if str(s.owner_id) != str(owner_id):
                    continue
                if project_id and s.project_id != str(project_id):
                    continue
                s.finalize_if_dead()
                if alive_only and s.exited_at is not None:
                    continue
                sessions.append(s)
            sessions.sort(key=lambda s: s.created_at)
            return sessions

    def drop_missing_from_registry(self, session):
        """True once the registry no longer tracks this session."""
        with self._lock:
            return session.id not in self._sessions


terminal_manager = TerminalManager()

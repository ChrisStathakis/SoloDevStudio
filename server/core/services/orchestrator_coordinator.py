"""Small persisted coordinator for supervised orchestrator runs.

The desktop app is a single-user local process, so a lightweight worker is a
better fit than introducing a queue service. All important state is persisted
on the run/step rows; the thread is only a wake-up mechanism.
"""
import json
import os
import re
import sqlite3
import subprocess
import threading
import time
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path

from django.db import OperationalError, close_old_connections, transaction
from django.utils import timezone

from ..models import OrchestratorRun, OrchestratorStep
from .terminal_manager import TerminalError, terminal_manager
from ..pathutils import normalize_path

RESULT_RE = re.compile(r'ORCHESTRATOR_RESULT\s*:\s*(\{.*?\})', re.S)
TRUST_RE = re.compile(r'do you trust|press enter to continue', re.I)
_FINALIZE_LOCKS = {}
_FINALIZE_LOCKS_GUARD = threading.Lock()
# OpenCode versions use different chrome.  The stable composer placeholder is
# the common signal across the minimalist screen shown by the desktop app and
# the bordered variants.
READY_RES = (
    re.compile(r'ask anything', re.I),
    re.compile(r'type / for commands', re.I),
    re.compile(r'esc to interrupt', re.I),
    re.compile(r'[─│┌┐└┘]{4,}'),
)


def _cli_command(step):
    model = (step.model_id or '').strip()
    quoted = '"' + model.replace('"', '') + '"'
    if step.tool == 'codex':
        model_arg = f' --model {quoted}' if model and model.lower() != 'default' else ''
        return f'codex --strict-config{model_arg} --sandbox {"read-only" if step.mode == "plan" else "workspace-write"} -c model_reasoning_effort="{step.reasoning_effort}"'
    model_arg = f' --model {quoted}' if model and model.lower() != 'default' else ''
    if step.tool == 'kilo':
        return f'kilo --agent {step.mode}{model_arg}'
    return f'opencode --agent {step.mode}{model_arg}'


def _git(root, *args):
    return subprocess.run(['git', '-C', root, *args], text=True, capture_output=True, timeout=30)


def _git_with_input(root, data, *args):
    return subprocess.run(['git', '-C', root, *args], input=data, text=True, capture_output=True, timeout=120)


def _git_bytes(root, *args):
    return subprocess.run(['git', '-C', root, *args], capture_output=True, timeout=120)


def _git_with_bytes(root, data, *args):
    return subprocess.run(['git', '-C', root, *args], input=data, capture_output=True, timeout=120)


def _git_bytes_text(value):
    return (value or b'').decode('utf-8', errors='replace')


def _workspace_state(root):
    """Return HEAD, worktree tree, dirty paths, and the real index tree.

    An alternate index is used so this inspection never changes the user's
    index or working tree.  The orchestrator's own worktree directory is
    intentionally excluded from the snapshot.
    """
    head = _git(root, 'rev-parse', 'HEAD')
    if head.returncode != 0:
        raise TerminalError(head.stderr.strip() or 'Git could not resolve HEAD.', 500)
    status = _git(root, 'status', '--porcelain=v1', '--untracked-files=all')
    if status.returncode != 0:
        raise TerminalError(status.stderr.strip() or 'Git could not inspect the checkout.', 500)
    dirty_files = []
    for line in status.stdout.splitlines():
        if not line or '.orchestrator' in line:
            continue
        path = line[3:].strip() if len(line) >= 3 else line.strip()
        if ' -> ' in path:
            path = path.split(' -> ', 1)[1].strip()
        dirty_files.append(path[:400].strip('"'))

    index = _git(root, 'write-tree')
    if index.returncode != 0:
        raise TerminalError(index.stderr.strip() or 'Git could not fingerprint the current index.', 500)

    fd, index_path = tempfile.mkstemp(prefix='solodev-orch-index-', suffix='.tmp')
    os.close(fd)
    try:
        env = dict(os.environ, GIT_INDEX_FILE=index_path)
        read = subprocess.run(['git', '-C', root, 'read-tree', head.stdout.strip()], env=env, text=True, capture_output=True, timeout=30)
        if read.returncode != 0:
            raise TerminalError(read.stderr.strip() or 'Git could not prepare an isolated index.', 500)
        added = subprocess.run(
            ['git', '-C', root, 'add', '-A', '--', '.', ':(exclude).orchestrator'],
            env=env, text=True, capture_output=True, timeout=120,
        )
        if added.returncode != 0:
            raise TerminalError(added.stderr.strip() or 'Git could not snapshot the working tree.', 500)
        tree = subprocess.run(['git', '-C', root, 'write-tree'], env=env, text=True, capture_output=True, timeout=30)
        if tree.returncode != 0:
            raise TerminalError(tree.stderr.strip() or 'Git could not hash the working tree.', 500)
        return head.stdout.strip(), tree.stdout.strip(), dirty_files, index.stdout.strip()
    finally:
        try:
            os.unlink(index_path)
        except OSError:
            pass


def _create_workspace_snapshot(root, goal):
    head, tree, dirty_files, index_tree = _workspace_state(root)
    commit = _git_with_input(
        root, '', '-c', 'user.name=SoloDev Studio', '-c', 'user.email=solodev@localhost',
        'commit-tree', tree, '-p', head, '-m', f'SoloDev orchestrator snapshot: {goal[:120]}',
    )
    if commit.returncode != 0:
        raise TerminalError(commit.stderr.strip() or 'Git could not create the isolated snapshot.', 500)
    return head, commit.stdout.strip(), tree, dirty_files, index_tree


def _finalize_lock(root):
    with _FINALIZE_LOCKS_GUARD:
        lock = _FINALIZE_LOCKS.get(root)
        if lock is None:
            lock = threading.RLock()
            _FINALIZE_LOCKS[root] = lock
        return lock


def _manage_check(root):
    direct = os.path.join(root, 'manage.py')
    if os.path.isfile(direct):
        return 'python manage.py test'
    for current, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in {'.git', '.orchestrator', 'node_modules', 'venv', '.venv'}]
        if 'manage.py' in files:
            relative = os.path.relpath(os.path.join(current, 'manage.py'), root).replace(os.sep, '/')
            return f'python {relative} test'
    return ''


class OrchestratorCoordinator:
    def __init__(self):
        self._lock = threading.RLock()
        self._workers = {}
        self.instance_id = f'{os.getpid()}-{uuid.uuid4().hex}'
        self.lease_timeout = timedelta(seconds=90)

    def kick(self, run_id, owner_id):
        key = str(run_id)
        with self._lock:
            if key in self._workers and self._workers[key].is_alive():
                return
            thread = threading.Thread(target=self._run, args=(key, owner_id), daemon=True, name=f'orch-{key[:8]}')
            self._workers[key] = thread
            thread.start()

    def recover_active_runs(self, project_id=None):
        """Wake recoverable runs after backend startup or a frontend refresh."""
        query = OrchestratorRun.objects.filter(
            status=OrchestratorRun.RUNNING,
            steps__status__in=[OrchestratorStep.QUEUED, OrchestratorStep.SENDING, OrchestratorStep.RUNNING],
        ).distinct()
        if project_id:
            query = query.filter(project_id=project_id)
        for run in query.values('id', 'project__owner_id'):
            self.kick(run['id'], run['project__owner_id'])

    def resend(self, step, owner_id):
        """Recover a ready composer without creating another terminal."""
        if not step.terminal_id:
            raise TerminalError('This step has no live terminal; use Retry instead.', 409)
        session = terminal_manager.get_for_user(step.terminal_id, owner_id)
        if not session or not session.is_alive():
            raise TerminalError('The step terminal has exited; use Retry instead.', 409)
        step.launch_phase = 'pasting_prompt'
        step.save(update_fields=['launch_phase', 'updated_at'])
        self._submit_prompt(session, self._prompt(step, step.run), step)
        step.status = OrchestratorStep.RUNNING
        step.launch_phase = 'waiting_for_response'
        step.save(update_fields=['status', 'launch_phase', 'updated_at'])

    def _run(self, run_id, owner_id):
        lock_retries = 0
        try:
            while True:
                try:
                    close_old_connections()
                    run = OrchestratorRun.objects.prefetch_related('steps').filter(pk=run_id).first()
                    if not run or run.status in (OrchestratorRun.CANCELLED, OrchestratorRun.PAUSED, OrchestratorRun.FAILED, OrchestratorRun.COMPLETED):
                        return
                    if not self._claim_lease_with_retry(run.id):
                        return
                    self._reconcile(run, owner_id)
                    self._observe_running(run, owner_id)
                    dispatched = self._dispatch_ready(run, owner_id)
                    run.refresh_from_db()
                    if run.steps.filter(status__in=[OrchestratorStep.QUEUED, OrchestratorStep.SENDING, OrchestratorStep.RUNNING]).exists():
                        queued = list(run.steps.filter(status=OrchestratorStep.QUEUED))
                        if not dispatched and not run.steps.filter(status__in=[OrchestratorStep.SENDING, OrchestratorStep.RUNNING]).exists() and queued:
                            blocked = all(bool(s.dependencies) for s in queued)
                            if blocked:
                                run.status = OrchestratorRun.FAILED
                                run.failure_reason = 'No dependency-ready step remains; inspect the plan graph.'
                                run.save(update_fields=['status', 'failure_reason', 'updated_at'])
                                return
                        time.sleep(1.0)
                        continue
                    if run.steps.filter(status=OrchestratorStep.AWAITING_APPROVAL).exists():
                        run.status = OrchestratorRun.NEEDS_APPROVAL
                        run.save(update_fields=['status', 'updated_at'])
                    elif run.steps.exclude(status__in=[OrchestratorStep.PASSED, OrchestratorStep.SKIPPED]).exists():
                        run.status = OrchestratorRun.FAILED
                        run.save(update_fields=['status', 'updated_at'])
                    else:
                        if run.integration_branch and not self._finalize_run(run):
                            return
                        run.status = OrchestratorRun.COMPLETED
                        run.last_event = {'type': 'run_completed', 'at': timezone.now().isoformat()}
                        run.save(update_fields=['status', 'last_event', 'updated_at'])
                    return
                except (OperationalError, sqlite3.OperationalError) as exc:
                    if self._is_transient_db_error(exc) and lock_retries < 3:
                        lock_retries += 1
                        time.sleep(0.5 * lock_retries)
                        continue
                    self._pause_after_error(run_id, owner_id, exc)
                    return
                except Exception as exc:
                    self._pause_after_error(run_id, owner_id, exc)
                    return
        finally:
            self._release_lease(run_id)
            close_old_connections()

    @staticmethod
    def _is_transient_db_error(exc):
        text = str(exc).lower()
        return 'locked' in text or 'busy' in text or 'database is unavailable' in text

    def _pause_after_error(self, run_id, owner_id, exc):
        message = f'Coordinator stopped before dispatch: {type(exc).__name__}: {exc}'
        run = OrchestratorRun.objects.filter(pk=run_id).first()
        if run:
            for step in run.steps.filter(status=OrchestratorStep.SENDING):
                if step.terminal_id:
                    terminal_manager.remove_for_user(step.terminal_id, owner_id)
                step.status = OrchestratorStep.QUEUED if (step.attempt or 0) < 3 else OrchestratorStep.FAILED
                step.failure_reason = message[:4000]
                step.launch_phase = 'retrying' if step.status == OrchestratorStep.QUEUED else 'failed'
                step.terminal_id = ''
                step.save(update_fields=['status', 'failure_reason', 'launch_phase', 'terminal_id', 'updated_at'])
        OrchestratorRun.objects.filter(
            pk=run_id,
            status__in=[OrchestratorRun.RUNNING, OrchestratorRun.NEEDS_APPROVAL],
        ).update(
            status=OrchestratorRun.PAUSED,
            failure_reason=message[:4000],
            last_event={'type': 'coordinator_failed', 'message': message[:4000], 'at': timezone.now().isoformat()},
            updated_at=timezone.now(),
        )

    def _claim_lease_with_retry(self, run_id):
        for attempt in range(3):
            try:
                return self._claim_lease(run_id)
            except (OperationalError, sqlite3.OperationalError) as exc:
                if not self._is_transient_db_error(exc) or attempt == 2:
                    raise
                time.sleep(0.35 * (attempt + 1))
        return False

    def _claim_lease(self, run_id):
        """Claim a run only for this backend process, recovering stale owners."""
        now = timezone.now()
        stale_before = now - self.lease_timeout
        with transaction.atomic():
            run = OrchestratorRun.objects.select_for_update().filter(pk=run_id).first()
            if not run or run.status in (OrchestratorRun.CANCELLED, OrchestratorRun.PAUSED, OrchestratorRun.FAILED, OrchestratorRun.COMPLETED):
                return False
            if run.coordinator_id and run.coordinator_id != self.instance_id and run.coordinator_heartbeat and run.coordinator_heartbeat > stale_before:
                return False
            run.coordinator_id = self.instance_id
            run.coordinator_heartbeat = now
            run.save(update_fields=['coordinator_id', 'coordinator_heartbeat', 'updated_at'])
            return True

    def _heartbeat(self, run_id):
        now = timezone.now()
        return OrchestratorRun.objects.filter(
            pk=run_id,
            coordinator_id=self.instance_id,
            status=OrchestratorRun.RUNNING,
        ).update(
            coordinator_heartbeat=now, updated_at=now
        ) == 1

    def _release_lease(self, run_id):
        OrchestratorRun.objects.filter(pk=run_id, coordinator_id=self.instance_id).update(
            coordinator_id='', coordinator_heartbeat=None, updated_at=timezone.now()
        )

    def _reconcile(self, run, owner_id):
        for step in run.steps.filter(status__in=[OrchestratorStep.SENDING, OrchestratorStep.RUNNING]):
            if step.status == OrchestratorStep.SENDING:
                # A live terminal owned by this backend is still in launch. Do
                # not requeue it merely because the scheduler loop ran again.
                live = terminal_manager.get_for_user(step.terminal_id, owner_id) if step.terminal_id else None
                if live and live.is_alive():
                    continue
                if step.terminal_id:
                    terminal_manager.remove_for_user(step.terminal_id, owner_id)
                step.status = OrchestratorStep.QUEUED if (step.attempt or 0) < 3 else OrchestratorStep.FAILED
                step.failure_reason = 'Launch was interrupted; requeued for recovery.'
                step.terminal_id = ''
                step.launch_phase = 'retrying'
                step.save(update_fields=['status', 'failure_reason', 'terminal_id', 'launch_phase', 'updated_at'])
                continue
            live = terminal_manager.get_for_user(step.terminal_id, owner_id) if step.terminal_id else None
            if not live or not live.is_alive():
                step.status = OrchestratorStep.QUEUED if (step.attempt or 0) < 3 else OrchestratorStep.FAILED
                step.failure_reason = 'Agent terminal disappeared; requeued for recovery.'
                step.save(update_fields=['status', 'failure_reason', 'updated_at'])

    def _observe_running(self, run, owner_id):
        for step in run.steps.filter(status=OrchestratorStep.RUNNING):
            session = terminal_manager.get_for_user(step.terminal_id, owner_id) if step.terminal_id else None
            if not session:
                continue
            _truncated, text, _offset, _more = session.read_since(0)
            tail = text[-12000:]
            if tail:
                step.last_output_at = timezone.now()
                step.output_tail = tail[-4000:]
                step.save(update_fields=['last_output_at', 'output_tail', 'updated_at'])
            match = RESULT_RE.search(tail)
            if not match:
                continue
            try:
                report = json.loads(match.group(1))
            except json.JSONDecodeError:
                step.failure_reason = 'Agent emitted malformed ORCHESTRATOR_RESULT JSON.'
                step.status = OrchestratorStep.FAILED
                step.finished_at = timezone.now()
                step.save(update_fields=['status', 'failure_reason', 'finished_at', 'updated_at'])
                continue
            checks = []
            command = (step.verification_command or '').strip()
            if command:
                try:
                    proc = subprocess.run(command, cwd=step.worktree_path or None, shell=True, text=True,
                        capture_output=True, timeout=900)
                    checks.append({'command': command, 'returncode': proc.returncode,
                        'output_tail': (proc.stdout + proc.stderr)[-4000:]})
                except Exception as exc:
                    checks.append({'command': command, 'returncode': -1, 'output_tail': str(exc)})
            step.completion_report = report
            step.check_results = checks
            step.output_tail = tail[-4000:]
            passed = str(report.get('status', '')).lower() in ('passed', 'success', 'completed') and all(c.get('returncode') == 0 for c in checks)
            step.status = OrchestratorStep.PASSED if passed else OrchestratorStep.FAILED
            step.review_status = 'pending' if passed else 'not_run'
            step.failure_reason = '' if passed else (report.get('blockers') or 'Verification failed.')
            step.finished_at = timezone.now()
            step.save(update_fields=['completion_report', 'check_results', 'output_tail', 'status', 'review_status', 'failure_reason', 'finished_at', 'updated_at'])
            if passed:
                self._integrate_step(run, step)

    def _integrate_step(self, run, step):
        if not step.branch_name or not run.integration_branch:
            step.review_status = 'skipped_non_git'
            step.save(update_fields=['review_status', 'updated_at'])
            return
        root = normalize_path(run.project.directory_path or run.project.cmd_directory)
        review = _git(root, 'diff', '--check', f'{run.integration_branch}..{step.branch_name}')
        if review.returncode != 0:
            step.review_status = 'rejected'
            step.status = OrchestratorStep.FAILED
            step.failure_reason = review.stderr or review.stdout or 'Diff review failed.'
            step.save(update_fields=['review_status', 'status', 'failure_reason', 'updated_at'])
            return
        integration_root = run.integration_worktree or root
        merged = _git(integration_root, 'merge', '--no-ff', '--no-edit', step.branch_name)
        if merged.returncode != 0:
            _git(integration_root, 'merge', '--abort')
            step.review_status = 'conflict'
            step.status = OrchestratorStep.FAILED
            step.failure_reason = merged.stderr[-2000:] or 'Merge conflict.'
            step.save(update_fields=['review_status', 'status', 'failure_reason', 'updated_at'])
            return
        step.review_status = 'merged'
        step.save(update_fields=['review_status', 'updated_at'])

    def _finalize_run(self, run):
        root = normalize_path(run.project.directory_path or run.project.cmd_directory)
        if not root or not run.base_branch or not run.integration_branch:
            return True
        with _finalize_lock(root):
            return self._finalize_run_locked(run, root)

    def _finalize_run_locked(self, run, root):
        if run.snapshot_commit and run.workspace_fingerprint and run.dirty_files:
            return self._apply_dirty_snapshot_delta(run, root)
        if run.snapshot_commit and run.workspace_fingerprint:
            try:
                _head, current_tree, current_files, current_index = _workspace_state(root)
            except TerminalError as exc:
                run.status = OrchestratorRun.PAUSED
                run.failure_reason = f'Unable to verify the original checkout before merging: {exc.message}'
                run.save(update_fields=['status', 'failure_reason', 'updated_at'])
                return False
            baseline_changed = current_tree != run.workspace_fingerprint or (
                run.index_fingerprint and current_index != run.index_fingerprint
            ) or (_git(root, 'rev-parse', 'HEAD').stdout.strip() != run.original_head)
        else:
            current_files = [line for line in _git(root, 'status', '--porcelain').stdout.splitlines() if '.orchestrator' not in line]
            baseline_changed = bool(current_files)
        if baseline_changed:
            run.status = OrchestratorRun.PAUSED
            run.failure_reason = f'The original checkout changed while the run was executing ({", ".join(current_files[:12])}). Review and merge the integration branch manually.'
            run.save(update_fields=['status', 'failure_reason', 'updated_at'])
            return False
        final_check = _manage_check(root)
        if not final_check and os.path.isfile(os.path.join(root, 'package.json')):
            final_check = 'npm test -- --watchAll=false'
        if final_check:
            try:
                proc = subprocess.run(final_check, cwd=run.integration_worktree or root, shell=True, text=True, capture_output=True, timeout=900)
            except Exception as exc:
                proc = None
                run.failure_reason = str(exc)
            if proc is None or proc.returncode != 0:
                run.status = OrchestratorRun.PAUSED
                run.failure_reason = run.failure_reason or (proc.stdout + proc.stderr)[-4000:]
                run.save(update_fields=['status', 'failure_reason', 'updated_at'])
                return False
        merged = _git(root, 'merge', '--no-ff', '--no-edit', run.integration_branch)
        if merged.returncode != 0:
            _git(root, 'merge', '--abort')
            run.status = OrchestratorRun.PAUSED
            run.failure_reason = merged.stderr[-3000:] or 'Final integration merge failed.'
            run.save(update_fields=['status', 'failure_reason', 'updated_at'])
            return False
        return True

    def _apply_dirty_snapshot_delta(self, run, root):
        """Apply only agent changes back onto the unchanged dirty checkout."""
        with _finalize_lock(root):
            return self._apply_dirty_snapshot_delta_locked(run, root)

    def _apply_dirty_snapshot_delta_locked(self, run, root):
        """Apply a dirty-run patch while holding the repository finalize lock."""
        if not run.index_fingerprint:
            run.status = OrchestratorRun.PAUSED
            run.failure_reason = 'This run predates staged-state tracking. The isolated integration branch is ready; merge it manually to preserve the original index safely.'
            run.save(update_fields=['status', 'failure_reason', 'updated_at'])
            return False
        current_head = _git(root, 'rev-parse', 'HEAD')
        if current_head.returncode != 0 or current_head.stdout.strip() != run.original_head:
            run.status = OrchestratorRun.PAUSED
            run.failure_reason = 'The original branch changed while this run was executing; review the integration branch before applying it.'
            run.save(update_fields=['status', 'failure_reason', 'updated_at'])
            return False
        try:
            _head, current_tree, current_files, current_index = _workspace_state(root)
        except TerminalError as exc:
            run.status = OrchestratorRun.PAUSED
            run.failure_reason = f'Unable to verify the original checkout before applying the result: {exc.message}'
            run.save(update_fields=['status', 'failure_reason', 'updated_at'])
            return False
        if current_tree != run.workspace_fingerprint or current_index != run.index_fingerprint:
            run.status = OrchestratorRun.PAUSED
            run.failure_reason = f'The original checkout changed while this run was executing ({", ".join(current_files[:12])}). Review the integration branch before applying it.'
            run.save(update_fields=['status', 'failure_reason', 'updated_at'])
            return False
        final_check = _manage_check(root)
        if not final_check and os.path.isfile(os.path.join(root, 'package.json')):
            final_check = 'npm test -- --watchAll=false'
        if final_check:
            try:
                proc = subprocess.run(
                    final_check,
                    cwd=run.integration_worktree or root,
                    shell=True,
                    text=True,
                    capture_output=True,
                    timeout=900,
                )
            except Exception as exc:
                proc = None
                check_output = str(exc)
            else:
                check_output = (proc.stdout + proc.stderr)[-4000:]
            if proc is None or proc.returncode != 0:
                run.status = OrchestratorRun.PAUSED
                run.failure_reason = f'Final project checks failed ({final_check}): {check_output}'
                run.save(update_fields=['status', 'failure_reason', 'updated_at'])
                return False
        # Recheck immediately before applying because verification may have
        # taken a long time and the user can edit the original checkout.
        current_head = _git(root, 'rev-parse', 'HEAD')
        try:
            _head, current_tree, current_files, current_index = _workspace_state(root)
        except TerminalError as exc:
            run.status = OrchestratorRun.PAUSED
            run.failure_reason = f'Unable to recheck the original checkout before applying the result: {exc.message}'
            run.save(update_fields=['status', 'failure_reason', 'updated_at'])
            return False
        if current_head.returncode != 0 or current_head.stdout.strip() != run.original_head or current_tree != run.workspace_fingerprint or current_index != run.index_fingerprint:
            run.status = OrchestratorRun.PAUSED
            run.failure_reason = f'The original checkout changed during final verification ({", ".join(current_files[:12])}). Review the integration branch before applying it.'
            run.save(update_fields=['status', 'failure_reason', 'updated_at'])
            return False
        delta = _git_bytes(root, 'diff', '--binary', '--full-index', f'{run.snapshot_commit}..{run.integration_branch}')
        if delta.returncode != 0:
            run.status = OrchestratorRun.PAUSED
            run.failure_reason = _git_bytes_text(delta.stderr)[-3000:] or 'Unable to calculate the isolated agent changes.'
            run.save(update_fields=['status', 'failure_reason', 'updated_at'])
            return False
        if delta.stdout:
            check = _git_with_bytes(root, delta.stdout, 'apply', '--check', '--binary')
            if check.returncode != 0:
                run.status = OrchestratorRun.PAUSED
                run.failure_reason = f'Agent changes could not be applied cleanly to the original checkout: {_git_bytes_text(check.stderr or check.stdout)[-3000:]}'
                run.save(update_fields=['status', 'failure_reason', 'updated_at'])
                return False
            applied = _git_with_bytes(root, delta.stdout, 'apply', '--binary')
            if applied.returncode != 0:
                run.status = OrchestratorRun.PAUSED
                run.failure_reason = f'Applying agent changes failed: {_git_bytes_text(applied.stderr or applied.stdout)[-3000:]}'
                run.save(update_fields=['status', 'failure_reason', 'updated_at'])
                return False
        run.snapshot_finished_at = timezone.now()
        run.last_event = {'type': 'dirty_snapshot_applied', 'at': timezone.now().isoformat()}
        run.save(update_fields=['snapshot_finished_at', 'last_event', 'updated_at'])
        return True

    def _dispatch_ready(self, run, owner_id):
        running = run.steps.filter(status__in=[OrchestratorStep.RUNNING, OrchestratorStep.SENDING]).count()
        dispatched = 0
        root = normalize_path(run.project.directory_path or run.project.cmd_directory)
        limit = max(1, run.max_parallel)
        if not root or _git(root, 'rev-parse', '--show-toplevel').returncode != 0:
            # Non-Git projects have no isolation or merge semantics.
            limit = 1
        for step in run.steps.filter(status=OrchestratorStep.QUEUED).order_by('order', 'created_at'):
            if running >= limit:
                break
            deps = set(str(x) for x in (step.dependencies or []))
            if deps and not all(run.steps.filter(pk=d, status__in=[OrchestratorStep.PASSED, OrchestratorStep.SKIPPED]).exists() for d in deps):
                continue
            if self._dispatch_step(run, step, owner_id):
                running += 1
                dispatched += 1
        return dispatched

    def _dispatch_step(self, run, step, owner_id):
        project = run.project
        root = normalize_path(project.directory_path or project.cmd_directory)
        if not root or not os.path.isdir(root):
            step.status = OrchestratorStep.AWAITING_APPROVAL
            step.failure_reason = 'Project directory is not available.'
            step.save(update_fields=['status', 'failure_reason', 'updated_at'])
            return False
        worktree = root
        branch = ''
        git = _git(root, 'rev-parse', '--show-toplevel')
        if git.returncode == 0:
            try:
                self._ensure_snapshot(run, root)
            except TerminalError as exc:
                run.status = OrchestratorRun.PAUSED
                run.failure_reason = exc.message
                run.last_event = {'type': 'snapshot_failed', 'message': exc.message, 'at': timezone.now().isoformat()}
                run.save(update_fields=['status', 'failure_reason', 'last_event', 'updated_at'])
                return False
            base = (run.integration_branch or '').strip()
            if not base:
                base = f'codex/orchestrator-{str(run.id)[:8]}'
                created = _git(root, 'branch', base, run.snapshot_commit or run.original_head or 'HEAD')
                if created.returncode not in (0, 128):
                    step.failure_reason = created.stderr[-1000:]
                    step.status = OrchestratorStep.FAILED
                    step.save(update_fields=['status', 'failure_reason', 'updated_at'])
                    return False
                run.integration_branch = base
                run.base_branch = (_git(root, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.strip() or 'HEAD')
                integration = os.path.join(root, '.orchestrator', str(run.id)[:8], 'integration')
                Path(integration).parent.mkdir(parents=True, exist_ok=True)
                if not os.path.exists(integration):
                    iw = _git(root, 'worktree', 'add', integration, base)
                    if iw.returncode != 0:
                        step.status = OrchestratorStep.FAILED
                        step.failure_reason = iw.stderr[-1500:]
                        step.save(update_fields=['status', 'failure_reason', 'updated_at'])
                        return False
                run.integration_worktree = integration
                run.save(update_fields=['integration_branch', 'base_branch', 'integration_worktree', 'updated_at'])
            branch = f'{base}-{str(step.id)[:8]}'
            worktree = os.path.join(root, '.orchestrator', str(run.id)[:8], str(step.id)[:8])
            Path(worktree).parent.mkdir(parents=True, exist_ok=True)
            if not os.path.exists(worktree):
                added = _git(root, 'worktree', 'add', '-b', branch, worktree, base)
                if added.returncode != 0:
                    step.status = OrchestratorStep.FAILED
                    step.failure_reason = added.stderr[-1500:]
                    step.save(update_fields=['status', 'failure_reason', 'updated_at'])
                    return False
        session = None
        try:
            session = terminal_manager.create_cmd(owner_id=owner_id, project_id=project.id, project_title=project.title,
                directory=worktree, fallback_directory=root, python_env=normalize_path(project.python_env))
            session.mode = 'orchestrator'
            session.title = f'Orchestrator: {step.title[:40]}'
            step.terminal_id = session.id
            step.worktree_path = worktree
            step.branch_name = branch
            step.status = OrchestratorStep.SENDING
            step.attempt = (step.attempt or 0) + 1
            step.started_at = timezone.now()
            step.launch_phase = 'launching_cli'
            step.last_output_at = timezone.now()
            step.save(update_fields=['terminal_id', 'worktree_path', 'branch_name', 'status', 'attempt', 'started_at', 'launch_phase', 'last_output_at', 'updated_at'])
            session.write(_cli_command(step) + '\r')
            step.launch_phase = 'waiting_for_composer'
            step.save(update_fields=['launch_phase', 'updated_at'])
            ready = self._wait_for_ready(session, timeout=180, step=step, heartbeat=lambda: self._heartbeat(run.id))
            if ready == 'trust':
                step.status = OrchestratorStep.AWAITING_APPROVAL
                step.approval_reason = 'The agent is waiting for an interactive trust confirmation.'
                step.launch_phase = 'trust_gate'
                step.save(update_fields=['status', 'approval_reason', 'launch_phase', 'updated_at'])
                return False
            if ready != 'ready':
                raise TerminalError('Agent did not open its composer before the launch timeout.', 504)
            prompt = self._prompt(step, run)
            step.launch_phase = 'pasting_prompt'
            step.save(update_fields=['launch_phase', 'updated_at'])
            self._submit_prompt(session, prompt, step)
            step.launch_phase = 'waiting_for_response'
            step.save(update_fields=['launch_phase', 'updated_at'])
        except TerminalError as exc:
            tail = ''
            if session:
                try:
                    _t, output, _o, _m = session.read_since(0)
                    tail = output[-4000:]
                    terminal_manager.remove_for_user(session.id, owner_id)
                except Exception:
                    pass
            step.output_tail = tail or step.output_tail
            current_run_status = OrchestratorRun.objects.filter(pk=run.id).values_list('status', flat=True).first()
            if current_run_status == OrchestratorRun.CANCELLED:
                # Cancellation owns the terminal state; a late launch failure
                # must not resurrect or requeue the step.
                step.status = OrchestratorStep.SKIPPED
                step.failure_reason = 'Run cancelled.'
                step.launch_phase = 'cancelled'
            else:
                step.status = OrchestratorStep.QUEUED if (step.attempt or 0) < 3 else OrchestratorStep.FAILED
                step.failure_reason = exc.message
                step.launch_phase = 'retrying' if step.status == OrchestratorStep.QUEUED else 'failed'
            step.terminal_id = ''
            step.save(update_fields=['status', 'failure_reason', 'launch_phase', 'terminal_id', 'output_tail', 'updated_at'])
            return False
        except Exception as exc:
            # Keep the same cancellation guarantee for non-terminal errors
            # (worktree, Git, and process-launch failures).
            current_run_status = OrchestratorRun.objects.filter(pk=run.id).values_list('status', flat=True).first()
            if current_run_status == OrchestratorRun.CANCELLED:
                step.status = OrchestratorStep.SKIPPED
                step.failure_reason = 'Run cancelled.'
                step.launch_phase = 'cancelled'
                step.terminal_id = ''
                step.save(update_fields=['status', 'failure_reason', 'launch_phase', 'terminal_id', 'updated_at'])
                return False
            raise
        step.status = OrchestratorStep.RUNNING
        step.save(update_fields=['status', 'updated_at'])
        return True

    @staticmethod
    def _ensure_snapshot(run, root):
        if run.snapshot_commit and run.workspace_fingerprint:
            return
        started = timezone.now()
        run.snapshot_started_at = started
        run.save(update_fields=['snapshot_started_at', 'updated_at'])
        head, commit, fingerprint, dirty_files, index_fingerprint = _create_workspace_snapshot(root, run.goal)
        run.original_head = head
        run.snapshot_commit = commit
        run.workspace_fingerprint = fingerprint
        run.index_fingerprint = index_fingerprint
        run.dirty_files = dirty_files
        run.snapshot_created_at = timezone.now()
        run.snapshot_finished_at = timezone.now()
        run.last_event = {
            'type': 'workspace_snapshot_created',
            'dirty_files': dirty_files,
            'snapshot_commit': commit,
            'at': timezone.now().isoformat(),
        }
        run.save(update_fields=[
            'original_head', 'snapshot_commit', 'workspace_fingerprint', 'index_fingerprint', 'dirty_files',
            'snapshot_created_at', 'snapshot_finished_at', 'last_event', 'updated_at',
        ])

    @staticmethod
    def _wait_for_ready(session, timeout=180, step=None, heartbeat=None):
        _appended, _dropped = session.stats()
        deadline = time.time() + timeout
        ready_at = None
        while time.time() < deadline:
            if heartbeat and not heartbeat():
                return 'lost_lease'
            if not session.is_alive():
                return 'dead'
            _truncated, text, _offset, _more = session.read_since(_appended)
            if text:
                _appended += len(text)
                ready_at = None
                if step:
                    step.last_output_at = timezone.now()
                    step.save(update_fields=['last_output_at', 'updated_at'])
                if TRUST_RE.search(text):
                    return 'trust'
                if any(rx.search(text) for rx in READY_RES):
                    ready_at = time.time()
            elif ready_at and time.time() - ready_at >= 0.8:
                return 'ready'
            time.sleep(0.25)
        return 'timeout'

    @staticmethod
    def _submit_prompt(session, prompt, step):
        """Use the same framing as xterm's paste path, with Enter separate."""
        session.write('\x1b[200~')
        for offset in range(0, len(prompt), 4096):
            session.write(prompt[offset:offset + 4096])
            time.sleep(0.015)
        session.write('\x1b[201~')
        time.sleep(0.45)
        _baseline, _dropped = session.stats()
        session.write('\r')
        deadline = time.time() + 5
        while time.time() < deadline:
            current, _dropped = session.stats()
            if current > _baseline:
                return
            time.sleep(0.2)
        # OpenCode can drop the first Enter while it is finalising a large
        # bracketed paste. Retry once, then surface the failure to the user.
        session.write('\r')
        deadline = time.time() + 5
        while time.time() < deadline:
            current, _dropped = session.stats()
            if current > _baseline:
                return
            time.sleep(0.2)
        raise TerminalError('Prompt was not accepted by the agent composer.', 504)

    @staticmethod
    def _prompt(step, run):
        return ('# Orchestrator step\n' + (step.instructions or step.title) + '\n\n'
            'Work only on this step. Run the requested verification command. '
            'When finished, print exactly one line beginning with '
            'ORCHESTRATOR_RESULT: followed by JSON with keys status, summary, '
            'changed_files, tests_run, blockers. Do not claim success if checks fail.')


coordinator = OrchestratorCoordinator()

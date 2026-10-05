"""CronJob / CronRun API: CRUD + run-now + Windows task sync + history."""
from __future__ import annotations

import os
import threading
from datetime import datetime, timedelta, timezone as _timezone

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.response import Response

from .models import AutomationPrompt, CronJob, CronRun
from .permissions import IsOwner
from .serializers import AutomationPromptSerializer, CronJobSerializer, CronRunSerializer
from .services.cron_schedule import compute_next_run
from .services import windows_tasks


def _sync_windows_task(job: CronJob) -> dict:
    try:
        result = windows_tasks.sync_job_task(job)
        task_name = result.get('task_name', '')
        if task_name and task_name != (job.windows_task_name or ''):
            CronJob.objects.filter(pk=job.pk).update(windows_task_name=task_name)
            job.windows_task_name = task_name
        return result
    except Exception as exc:
        return {'synced': False, 'reason': str(exc)[:300]}


class CronJobViewSet(viewsets.ModelViewSet):
    serializer_class = CronJobSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return CronJob.objects.filter(owner=self.request.user).prefetch_related('runs')

    def perform_create(self, serializer):
        job = serializer.save(
            owner=self.request.user,
            next_run_at=compute_next_run(
                serializer.validated_data.get('schedule_kind', 'daily'),
                serializer.validated_data.get('schedule_value', '09:00'),
            ),
        )
        _sync_windows_task(job)

    def perform_update(self, serializer):
        job = serializer.save(
            next_run_at=compute_next_run(
                serializer.validated_data.get('schedule_kind', serializer.instance.schedule_kind),
                serializer.validated_data.get('schedule_value', serializer.instance.schedule_value),
            ),
        )
        _sync_windows_task(job)

    def perform_destroy(self, instance):
        job_id = str(instance.pk)
        instance.delete()
        try:
            windows_tasks.delete_job_task(job_id)
        except Exception:
            pass

    @action(detail=True, methods=['post'], url_path='run-now')
    def run_now(self, request, pk=None):
        job = self.get_object()
        if not job.enabled:
            return Response(
                {'detail': 'Automation is disabled — enable it first.', 'disabled': True},
                status=status.HTTP_409_CONFLICT,
            )
        trigger = str((request.data or {}).get('trigger') or 'manual')[:30]

        def _bg():
            try:
                from .services.cron_runner import run_job
                run_job(str(job.pk), trigger=trigger)
            except Exception:
                pass

        threading.Thread(target=_bg, name=f'cron-run-{str(job.pk)[:8]}', daemon=True).start()
        job.refresh_from_db()
        return Response(CronJobSerializer(job, context={'request': request}).data, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=['get'], url_path='windows-task')
    def windows_task(self, request, pk=None):
        job = self.get_object()
        try:
            result = windows_tasks.query_task_status(str(job.pk))
        except Exception as exc:
            result = {'exists': False, 'reason': str(exc)[:300]}
        return Response(result)

    @action(detail=True, methods=['post'], url_path='resync-task')
    def resync_task(self, request, pk=None):
        job = self.get_object()
        return Response(_sync_windows_task(job))

    @action(detail=True, methods=['get'], url_path='runs')
    def runs(self, request, pk=None):
        job = self.get_object()
        runs = job.runs.order_by('-created_at')[:50]
        return Response(CronRunSerializer(runs, many=True).data)

    @action(detail=True, methods=['post'], url_path='clear-runs')
    def clear_runs(self, request, pk=None):
        job = self.get_object()
        deleted, _ = job.runs.all().delete()
        return Response({'deleted_count': deleted})

    @action(detail=True, methods=['post'], url_path='open-folder')
    def open_folder(self, request, pk=None):
        job = self.get_object()
        raw = (job.working_directory or '').strip().strip('"').strip("'")
        if not raw:
            return Response({'error': 'No working directory set for this automation.'}, status=400)
        if not os.path.isdir(raw):
            return Response({'error': f'Directory does not exist: {raw}'}, status=400)
        if not hasattr(os, 'startfile'):
            return Response({'error': 'Opening folders is only supported on Windows.'}, status=501)
        try:
            os.startfile(raw)  # noqa: S606 - opens Explorer at the validated directory
        except Exception as exc:
            return Response({'error': f'Failed to open directory: {exc}'}, status=500)
        return Response({'ok': True, 'path': raw})

    @action(detail=True, methods=['get'], url_path='files')
    def files(self, request, pk=None):
        """List files in the automation working directory for the results UI.

        GET /api/cron-jobs/{id}/files/?run_id=<uuid>&path=<subfolder>
        `path` navigates inside the working directory only (traversal
        rejected); `run_id` flags files changed while that run was active.
        """
        job = self.get_object()
        base = (job.working_directory or '').strip().strip('"').strip("'")
        if not base or not os.path.isdir(base):
            return Response({'directory': base or '', 'current': '', 'parent': None, 'files': [], 'error': 'Working directory is not available.'})
        base_abs = os.path.abspath(base)
        sub = (request.query_params.get('path') or '').strip().replace('\\', '/').strip('/')
        current_abs = os.path.abspath(os.path.join(base_abs, sub)) if sub else base_abs
        try:
            inside = os.path.commonpath([base_abs, current_abs]) == base_abs
        except ValueError:
            inside = False
        if not inside:
            return Response({'directory': base, 'current': '', 'parent': None, 'files': [], 'error': 'Path is outside the working directory.'}, status=400)
        if not os.path.isdir(current_abs):
            return Response({'directory': base, 'current': sub, 'parent': None, 'files': [], 'error': 'Not a folder.'}, status=400)
        try:
            names = os.listdir(current_abs)
        except OSError as exc:
            return Response({'directory': base, 'current': sub, 'parent': None, 'files': [], 'error': str(exc)[:300]})
        parent = os.path.dirname(sub) if sub else None
        if parent == '':
            parent = None
        window = None
        run_id = (request.query_params.get('run_id') or '').strip()
        if run_id:
            run = job.runs.filter(pk=run_id).first()
            if run is not None and run.started_at:
                from django.utils import timezone as _tz
                start = run.started_at - timedelta(seconds=30)
                end = (run.finished_at + timedelta(seconds=30)) if run.finished_at else _tz.now() + timedelta(seconds=30)
                window = (start, end)
        entries = []
        for name in names:
            full = os.path.join(current_abs, name)
            try:
                entry_stat = os.stat(full)
                is_dir = os.path.isdir(full)
            except OSError:
                continue
            modified = datetime.fromtimestamp(entry_stat.st_mtime, tz=_timezone.utc)
            entries.append({
                'name': name, 'path': full, 'is_dir': is_dir,
                'size': 0 if is_dir else entry_stat.st_size,
                'modified': modified.isoformat(),
                'changed_in_run': bool(window and window[0] <= modified <= window[1]),
            })
            if len(entries) >= 2000:
                break
        entries.sort(key=lambda e: (not e['is_dir'], e['name'].lower()))
        return Response({'directory': base, 'current': sub, 'parent': parent, 'files': entries[:500]})


class CronRunViewSet(viewsets.ModelViewSet):
    serializer_class = CronRunSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'delete', 'head', 'options']

    def get_queryset(self):
        return CronRun.objects.filter(job__owner=self.request.user).select_related('job')

    def get_object(self):
        return get_object_or_404(CronRun, pk=self.kwargs.get('pk'), job__owner=self.request.user)


class AutomationPromptViewSet(viewsets.ModelViewSet):
    serializer_class = AutomationPromptSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwner]
    http_method_names = ['get', 'post', 'patch', 'put', 'delete', 'head', 'options']

    def get_queryset(self):
        queryset = AutomationPrompt.objects.filter(owner=self.request.user)
        search = (self.request.query_params.get('search') or '').strip()
        if search:
            queryset = queryset.filter(Q(title__icontains=search) | Q(content__icontains=search))
        return queryset

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def opencode_models_view(request):
    """Cached `opencode models` list for model pickers. Never 500s."""
    from .services import opencode_models as _om
    force = str(request.query_params.get('refresh') or '').lower() in ('1', 'true', 'yes')
    try:
        models = _om.list_models(force_refresh=force)
    except Exception as exc:
        return Response({'models': [], 'error': str(exc)[:300]})
    return Response({'models': models})

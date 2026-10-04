"""CronJob / CronRun API: CRUD + run-now + Windows task sync + history."""
from __future__ import annotations

import threading

from django.shortcuts import get_object_or_404
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import CronJob, CronRun
from .serializers import CronJobSerializer, CronRunSerializer
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


class CronRunViewSet(viewsets.ModelViewSet):
    serializer_class = CronRunSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ['get', 'delete', 'head', 'options']

    def get_queryset(self):
        return CronRun.objects.filter(job__owner=self.request.user).select_related('job')

    def get_object(self):
        return get_object_or_404(CronRun, pk=self.kwargs.get('pk'), job__owner=self.request.user)

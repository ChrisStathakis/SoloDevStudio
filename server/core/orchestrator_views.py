"""P1 orchestrator API: goal -> approvable plan -> semi-auto terminal dispatch."""
from django.db import transaction
from django.shortcuts import get_object_or_404
from rest_framework import status, permissions
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import (
    Project, Task, ProjectAgentLink,
    OrchestratorRun, OrchestratorStep,
    InitializationTool, ReasoningEffort, InitializationMode,
)
from .serializers import OrchestratorRunSerializer, OrchestratorStepSerializer
from .services.orchestrator import propose_plan, classify_risk
from .model_validation import is_safe_model_id, MODEL_ID_ERROR
from .services.terminal_manager import terminal_manager, TerminalError
from .pathutils import normalize_path
from .views import compose_project_initialization_prompt, compose_task_prompt


def _owned_project(request, pk):
    return get_object_or_404(Project, pk=pk, owner=request.user)


def _run_owned(request, run_id):
    return get_object_or_404(OrchestratorRun, pk=run_id, project__owner=request.user)


def _compose_step_prompt(step, user):
    """Reuse existing prompt composers; step prompt = project/skills + step focus."""
    if step.task_id:
        try:
            task = Task.objects.select_related('project').get(pk=step.task_id)
            content, _base, _links = compose_task_prompt(task, user)
            if content:
                extra = f"\n\n## Orchestrator step\n- Step: {step.title}\n- Tool: {step.tool} / {step.model_id or 'default'}\n"
                if step.verification_command:
                    extra += f"- Verify with: `{step.verification_command}`\n"
                return content + extra
        except Task.DoesNotExist:
            pass
    project = step.run.project
    content, _base, _links = compose_project_initialization_prompt(project, user)
    lines = [
        content or f"# {project.title}",
        '',
        '## Orchestrator step',
        f"- Step: {step.title}",
        f"- Tool: {step.tool} / {step.model_id or 'default'}",
    ]
    if step.verification_command:
        lines.append(f"- Verify with: `{step.verification_command}`")
    lines.append('- Implement only this step; report tests/checks run.')
    return '\n'.join(lines).strip()


@api_view(['GET', 'POST'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_runs(request, pk=None):
    project = _owned_project(request, pk)
    if request.method == 'GET':
        runs = OrchestratorRun.objects.filter(project=project).prefetch_related('steps')
        return Response(OrchestratorRunSerializer(runs, many=True).data)
    goal = (request.data.get('goal') or '').strip()
    if len(goal) < 4:
        return Response({'goal': 'Describe the goal (min 4 chars).'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        max_parallel = int(request.data.get('max_parallel') or 2)
    except (TypeError, ValueError):
        max_parallel = 2
    max_parallel = max(1, min(max_parallel, 3))
    open_tasks = list(Task.objects.filter(project=project, completed=False).values('id', 'title', 'category')[:20])
    links = list(ProjectAgentLink.objects.filter(project=project, active=True).select_related('agent')[:10])
    active_skills = [{'id': str(l.agent_id), 'title': l.agent.title} for l in links]
    plan = propose_plan(
        goal=goal, project=project, open_tasks=open_tasks,
        active_skills=active_skills, mvp_features=project.mvp_features or [],
    )
    with transaction.atomic():
        run = OrchestratorRun.objects.create(
            project=project, goal=goal, status=OrchestratorRun.AWAITING_PLAN,
            plan=plan, max_parallel=max_parallel,
        )
        for i, item in enumerate(plan):
            task_ref = None
            if item.get('task_id'):
                task_ref = Task.objects.filter(pk=item['task_id'], project=project).first()
            is_risky, reason = classify_risk(item['title'] + '\n' + goal)
            OrchestratorStep.objects.create(
                run=run, task=task_ref, title=item['title'],
                tool=project.initialization_tool or 'opencode',
                model_id=project.initialization_model or '',
                reasoning_effort=project.initialization_reasoning_effort or 'medium',
                mode=project.initialization_mode or 'build',
                skill_ids=item.get('skill_ids') or [],
                verification_command=item.get('verification_command') or '',
                status=OrchestratorStep.AWAITING_APPROVAL if is_risky else OrchestratorStep.QUEUED,
                approval_reason=reason,
                order=i,
            )
    run = OrchestratorRun.objects.prefetch_related('steps').get(pk=run.pk)
    return Response(OrchestratorRunSerializer(run).data, status=status.HTTP_201_CREATED)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_approve_plan(request, run_id=None):
    run = _run_owned(request, run_id)
    if run.status not in (OrchestratorRun.AWAITING_PLAN, OrchestratorRun.PAUSED):
        return Response({'error': 'Plan is not awaiting approval.'}, status=status.HTTP_409_CONFLICT)
    run.status = OrchestratorRun.RUNNING
    run.save(update_fields=['status', 'updated_at'])
    return Response(OrchestratorRunSerializer(run).data)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_cancel_run(request, run_id=None):
    run = _run_owned(request, run_id)
    run.status = OrchestratorRun.CANCELLED
    run.save(update_fields=['status', 'updated_at'])
    return Response(OrchestratorRunSerializer(run).data)


@api_view(['GET', 'PATCH'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_step_detail(request, step_id=None):
    """Read or update a queued step's agent config (tool/model/effort/mode).

    Only steps that have not been dispatched yet (queued/awaiting_approval)
    are editable. model_id blank means "project default at dispatch".
    """
    step = get_object_or_404(OrchestratorStep, pk=step_id, run__project__owner=request.user)
    if request.method == 'GET':
        return Response(OrchestratorStepSerializer(step).data)
    if step.status not in (OrchestratorStep.QUEUED, OrchestratorStep.AWAITING_APPROVAL):
        return Response(
            {'error': 'Only queued steps can be edited. Retry/requeue first.'},
            status=status.HTTP_409_CONFLICT,
        )
    data = request.data if isinstance(request.data, dict) else {}
    allowed = {'tool', 'model_id', 'reasoning_effort', 'mode'}
    unknown = [k for k in data.keys() if k not in allowed]
    if unknown:
        return Response({'error': f'Unknown fields: {sorted(unknown)}.'}, status=status.HTTP_400_BAD_REQUEST)
    if 'tool' in data:
        tool = str(data.get('tool') or '').strip().lower()
        if tool not in (InitializationTool.OPENCODE, InitializationTool.CODEX):
            return Response({'tool': "Must be 'opencode' or 'codex'."}, status=status.HTTP_400_BAD_REQUEST)
        step.tool = tool
    if 'model_id' in data:
        raw_model = data.get('model_id')
        model_id = '' if raw_model is None else str(raw_model).strip()
        if model_id and not is_safe_model_id(model_id):
            return Response({'model_id': MODEL_ID_ERROR}, status=status.HTTP_400_BAD_REQUEST)
        step.model_id = model_id
    if 'reasoning_effort' in data:
        effort = str(data.get('reasoning_effort') or '').strip().lower()
        if effort not in (ReasoningEffort.LOW, ReasoningEffort.MEDIUM, ReasoningEffort.HIGH):
            return Response({'reasoning_effort': "Must be 'low', 'medium' or 'high'."}, status=status.HTTP_400_BAD_REQUEST)
        step.reasoning_effort = effort
    if 'mode' in data:
        mode = str(data.get('mode') or '').strip().lower()
        if mode not in (InitializationMode.BUILD, InitializationMode.PLAN):
            return Response({'mode': "Must be 'build' or 'plan'."}, status=status.HTTP_400_BAD_REQUEST)
        step.mode = mode
    step.save(update_fields=['tool', 'model_id', 'reasoning_effort', 'mode', 'updated_at'])
    return Response(OrchestratorStepSerializer(step).data)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_step_prompt(request, step_id=None):
    step = get_object_or_404(OrchestratorStep, pk=step_id, run__project__owner=request.user)
    content = _compose_step_prompt(step, request.user)
    return Response({'step_id': str(step.id), 'content': content})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_step_action(request, step_id=None):
    """approve | dispatch (create orchestrator terminal + record id) | pass | fail | retry | skip."""
    step = get_object_or_404(
        OrchestratorStep.objects.select_related('run__project'), pk=step_id, run__project__owner=request.user
    )
    run = step.run
    project = run.project
    op = (request.data.get('op') or '').strip().lower()
    if op == 'approve':
        step.status = OrchestratorStep.QUEUED
        step.approval_reason = ''
        step.save(update_fields=['status', 'approval_reason', 'updated_at'])
        if run.status == OrchestratorRun.NEEDS_APPROVAL and not run.steps.filter(status=OrchestratorStep.AWAITING_APPROVAL).exists():
            run.status = OrchestratorRun.RUNNING
            run.save(update_fields=['status', 'updated_at'])
        return Response(OrchestratorStepSerializer(step).data)
    if op == 'dispatch':
        # P1 semi-auto: server creates a dedicated visible terminal; the
        # frontend pastes the prompt (same handshake as Prompt tab).
        if step.status == OrchestratorStep.AWAITING_APPROVAL:
            return Response({'error': 'Approve this high-risk step first.'}, status=status.HTTP_409_CONFLICT)
        alive = terminal_manager.count_alive_for_user(request.user.id)
        if alive >= 6:
            return Response({'error': 'Maximum of 6 live terminals reached. Close one first.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        running = run.steps.filter(status=OrchestratorStep.RUNNING).exclude(pk=step.pk).count()
        if running >= (run.max_parallel or 2):
            return Response({'error': f'Run parallelism limit reached ({run.max_parallel}). Wait for a step to finish.'}, status=status.HTTP_429_TOO_MANY_REQUESTS)
        try:
            session = terminal_manager.create_cmd(
                owner_id=request.user.id, project_id=project.id, project_title=project.title,
                directory=normalize_path(project.cmd_directory),
                fallback_directory=normalize_path(project.directory_path),
                python_env=normalize_path(project.python_env),
            )
            session.mode = 'orchestrator'
            session.title = f'Orchestrator: {step.title[:40]}'
        except TerminalError as e:
            return Response({'error': e.message}, status=e.http_status)
        step.terminal_id = session.id
        step.status = OrchestratorStep.RUNNING
        step.attempt = (step.attempt or 0) + 1
        step.save(update_fields=['terminal_id', 'status', 'attempt', 'updated_at'])
        prompt = _compose_step_prompt(step, request.user)
        payload = session.to_dict()
        payload['prompt'] = prompt
        return Response(payload, status=status.HTTP_201_CREATED)
    if op in ('pass', 'fail'):
        step.status = OrchestratorStep.PASSED if op == 'pass' else OrchestratorStep.FAILED
        tail = request.data.get('output_tail')
        if isinstance(tail, str):
            step.output_tail = tail[-4000:]
        step.save(update_fields=['status', 'output_tail', 'updated_at'])
        _rollup_run(run)
        return Response(OrchestratorStepSerializer(step).data)
    if op == 'retry':
        is_risky, reason = classify_risk(step.title)
        step.status = OrchestratorStep.AWAITING_APPROVAL if is_risky else OrchestratorStep.QUEUED
        step.approval_reason = reason
        step.save(update_fields=['status', 'approval_reason', 'updated_at'])
        if run.status in (OrchestratorRun.FAILED, OrchestratorRun.COMPLETED):
            run.status = OrchestratorRun.RUNNING
            run.save(update_fields=['status', 'updated_at'])
        return Response(OrchestratorStepSerializer(step).data)
    if op == 'skip':
        step.status = OrchestratorStep.SKIPPED
        step.save(update_fields=['status', 'updated_at'])
        _rollup_run(run)
        return Response(OrchestratorStepSerializer(step).data)
    return Response({'error': "op must be approve|dispatch|pass|fail|retry|skip."}, status=status.HTTP_400_BAD_REQUEST)


def _rollup_run(run):
    steps = list(run.steps.all())
    if not steps:
        return
    if any(s.status == OrchestratorStep.AWAITING_APPROVAL for s in steps):
        run.status = OrchestratorRun.NEEDS_APPROVAL
    elif any(s.status in (OrchestratorStep.RUNNING, OrchestratorStep.SENDING) for s in steps):
        run.status = OrchestratorRun.RUNNING
    elif all(s.status in (OrchestratorStep.PASSED, OrchestratorStep.SKIPPED) for s in steps):
        run.status = OrchestratorRun.COMPLETED
    elif any(s.status == OrchestratorStep.FAILED for s in steps):
        run.status = OrchestratorRun.FAILED
    elif any(s.status == OrchestratorStep.QUEUED for s in steps):
        run.status = OrchestratorRun.RUNNING
    run.save(update_fields=['status', 'updated_at'])

"""P1 orchestrator API: goal -> approvable plan -> semi-auto terminal dispatch."""
from django.db import transaction
from django.utils import timezone
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
from .views import compose_project_initialization_prompt, compose_task_prompt, _project_terminal_env
from .services.project_context import (
    parse_max_chars, parse_sections, parse_stages, build_project_context,
)
from .version import BUILD_ID


def _owned_project(request, pk):
    return get_object_or_404(Project, pk=pk, owner=request.user)


def _run_owned(request, run_id):
    return get_object_or_404(OrchestratorRun, pk=run_id, project__owner=request.user)


def _build_mismatch(request):
    frontend_id = (request.headers.get('X-SoloDev-Frontend-Build') or '').strip()
    return bool(frontend_id and frontend_id != BUILD_ID)


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
                return _with_phase_context(content + extra, step)
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
    return _with_phase_context('\n'.join(lines).strip(), step)


def _with_phase_context(content, step):
    """Append the run's selected phase brief so workers see stage context."""
    try:
        last_event = step.run.last_event or {}
    except AttributeError:
        return content
    brief = (last_event.get('phase_brief') or '').strip() if isinstance(last_event, dict) else ''
    if not brief:
        return content
    return f"{content}\n\n## Selected phase context\n{brief[:8000]}".strip()


@api_view(['GET', 'POST'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_runs(request, pk=None):
    project = _owned_project(request, pk)
    if request.method == 'GET':
        runs = OrchestratorRun.objects.filter(project=project).prefetch_related('steps')
        try:
            from .services.orchestrator_coordinator import coordinator
            coordinator.recover_active_runs(project.id)
        except Exception:
            # The persisted run state remains authoritative; the coordinator
            # will expose a pause reason if recovery itself cannot start.
            pass
        return Response(OrchestratorRunSerializer(runs, many=True).data)
    goal = (request.data.get('goal') or '').strip()
    if len(goal) < 4:
        return Response({'goal': 'Describe the goal (min 4 chars).'}, status=status.HTTP_400_BAD_REQUEST)
    try:
        max_parallel = int(request.data.get('max_parallel') or 2)
    except (TypeError, ValueError):
        max_parallel = 2
    max_parallel = max(1, min(max_parallel, 3))
    data = request.data if isinstance(request.data, dict) else {}
    phase_mode = str(data.get('phase_mode') or 'goal').strip().lower()
    if phase_mode not in ('goal', 'goal_and_phases'):
        return Response({'phase_mode': "Must be 'goal' or 'goal_and_phases'."}, status=status.HTTP_400_BAD_REQUEST)
    from .stage_definitions import valid_stage_keys
    valid_stages = sorted(valid_stage_keys(request.user))
    phase_stages: list[str] = []
    phase_sections: list[str] = []
    phase_brief = ''
    if phase_mode == 'goal_and_phases':
        try:
            phase_stages = parse_stages(data.get('stages'), project.current_stage, valid_stages)
            phase_sections = parse_sections(data.get('sections'))
            phase_max_chars = parse_max_chars(data.get('max_chars'))
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        phase_payload = build_project_context(
            project, request.user, phase_stages, phase_sections, phase_max_chars
        )
        phase_brief = phase_payload['markdown']
    open_tasks = list(Task.objects.filter(project=project, completed=False).values('id', 'title', 'category')[:20])
    links = list(ProjectAgentLink.objects.filter(project=project, active=True).select_related('agent')[:10])
    active_skills = [{'id': str(l.agent_id), 'title': l.agent.title} for l in links]
    planning_goal = f"{goal}\n\n## Selected phase context\n{phase_brief[:8000]}" if phase_brief else goal
    plan = propose_plan(
        goal=planning_goal, project=project, open_tasks=open_tasks,
        active_skills=active_skills, mvp_features=project.mvp_features or [],
    )
    with transaction.atomic():
        run = OrchestratorRun.objects.create(
            project=project, goal=goal, status=OrchestratorRun.AWAITING_PLAN,
            plan=plan, max_parallel=max_parallel,
            last_event={
                'type': 'run_created',
                'at': timezone.now().isoformat(),
                'phase_mode': phase_mode,
                'phases': phase_stages,
                'sections': phase_sections,
                'phase_brief': phase_brief,
            },
        )
        for i, item in enumerate(plan):
            task_ref = None
            if item.get('task_id'):
                task_ref = Task.objects.filter(pk=item['task_id'], project=project).first()
            is_risky, reason = classify_risk('\n'.join([item['title'], item.get('instructions') or '', item.get('verification_command') or '', goal]))
            OrchestratorStep.objects.create(
                run=run, task=task_ref, title=item['title'],
                tool=project.initialization_tool or 'opencode',
                model_id=project.initialization_model or '',
                reasoning_effort=project.initialization_reasoning_effort or 'medium',
                mode=project.initialization_mode or 'build',
                skill_ids=item.get('skill_ids') or [],
                verification_command=item.get('verification_command') or '',
                instructions=item.get('instructions') or item.get('title') or '',
                dependencies=item.get('dependencies') or [],
                expected_files=item.get('expected_files') or [],
                status=OrchestratorStep.AWAITING_APPROVAL if is_risky else OrchestratorStep.QUEUED,
                approval_reason=reason,
                order=i,
            )
    run = OrchestratorRun.objects.prefetch_related('steps').get(pk=run.pk)
    return Response(OrchestratorRunSerializer(run).data, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_clear_previous_runs(request, pk=None):
    """Delete older orchestrator history while preserving the newest run."""
    project = _owned_project(request, pk)
    runs = list(OrchestratorRun.objects.filter(project=project).order_by('-created_at', '-id'))
    if not runs:
        return Response({'deleted_count': 0, 'preserved_run_id': None})
    preserved = runs[0]
    older = runs[1:]
    for run in older:
        for step in run.steps.filter(status__in=[OrchestratorStep.SENDING, OrchestratorStep.RUNNING]):
            if step.terminal_id:
                terminal_manager.remove_for_user(step.terminal_id, request.user.id)
    deleted_count = len(older)
    if older:
        OrchestratorRun.objects.filter(pk__in=[run.pk for run in older]).delete()
    return Response({'deleted_count': deleted_count, 'preserved_run_id': str(preserved.id)})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_approve_plan(request, run_id=None):
    run = _run_owned(request, run_id)
    if _build_mismatch(request):
        return Response({'error': 'Frontend and backend build IDs do not match. Restart or reinstall the desktop app.'}, status=status.HTTP_409_CONFLICT)
    if run.status not in (OrchestratorRun.AWAITING_PLAN, OrchestratorRun.PAUSED):
        return Response({'error': 'Plan is not awaiting approval.'}, status=status.HTTP_409_CONFLICT)
    if run.status in (OrchestratorRun.CANCELLED, OrchestratorRun.COMPLETED, OrchestratorRun.FAILED):
        return Response({'error': 'This run cannot be started from its current state.'}, status=status.HTTP_409_CONFLICT)
    run.status = OrchestratorRun.RUNNING
    run.last_event = {'type': 'run_started', 'at': timezone.now().isoformat()}
    run.save(update_fields=['status', 'last_event', 'updated_at'])
    # The coordinator is deliberately imported lazily so Django startup and
    # migrations never start worker threads.
    try:
        from .services.orchestrator_coordinator import coordinator
        coordinator.kick(run.id, request.user.id)
    except Exception as exc:
        run.status = OrchestratorRun.PAUSED
        run.failure_reason = f'Unable to start coordinator: {exc}'
        run.save(update_fields=['status', 'failure_reason', 'updated_at'])
    return Response(OrchestratorRunSerializer(run).data)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_cancel_run(request, run_id=None):
    run = _run_owned(request, run_id)
    if run.status == OrchestratorRun.CANCELLED:
        return Response(OrchestratorRunSerializer(run).data)
    for step in run.steps.filter(status__in=[OrchestratorStep.RUNNING, OrchestratorStep.SENDING]):
        if step.terminal_id:
            terminal_manager.remove_for_user(step.terminal_id, request.user.id)
            step.terminal_id = ''
        step.status = OrchestratorStep.SKIPPED
        step.failure_reason = 'Run cancelled.'
        step.launch_phase = 'cancelled'
        step.finished_at = timezone.now()
        step.save(update_fields=['status', 'failure_reason', 'finished_at', 'terminal_id', 'launch_phase', 'updated_at'])
    run.status = OrchestratorRun.CANCELLED
    run.last_event = {'type': 'run_cancelled', 'at': timezone.now().isoformat()}
    run.save(update_fields=['status', 'last_event', 'updated_at'])
    return Response(OrchestratorRunSerializer(run).data)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_pause_run(request, run_id=None):
    run = _run_owned(request, run_id)
    if run.status not in (OrchestratorRun.RUNNING, OrchestratorRun.NEEDS_APPROVAL):
        return Response({'error': 'Only a running run can be paused.'}, status=status.HTTP_409_CONFLICT)
    run.status = OrchestratorRun.PAUSED
    run.last_event = {'type': 'run_paused', 'at': timezone.now().isoformat()}
    run.save(update_fields=['status', 'last_event', 'updated_at'])
    return Response(OrchestratorRunSerializer(run).data)


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_resume_run(request, run_id=None):
    run = _run_owned(request, run_id)
    if _build_mismatch(request):
        return Response({'error': 'Frontend and backend build IDs do not match. Restart or reinstall the desktop app.'}, status=status.HTTP_409_CONFLICT)
    if run.status != OrchestratorRun.PAUSED:
        return Response({'error': 'Only a paused run can be resumed.'}, status=status.HTTP_409_CONFLICT)
    run.status = OrchestratorRun.RUNNING
    run.last_event = {'type': 'run_resumed', 'at': timezone.now().isoformat()}
    run.save(update_fields=['status', 'last_event', 'updated_at'])
    from .services.orchestrator_coordinator import coordinator
    coordinator.kick(run.id, request.user.id)
    return Response(OrchestratorRunSerializer(run).data)


@api_view(['PATCH'])
@permission_classes([permissions.IsAuthenticated])
def orchestrator_plan_edit(request, run_id=None):
    """Edit the proposed graph before execution starts."""
    run = _run_owned(request, run_id)
    if run.status not in (OrchestratorRun.AWAITING_PLAN, OrchestratorRun.PAUSED):
        return Response({'error': 'Only an unstarted plan can be edited.'}, status=status.HTTP_409_CONFLICT)
    raw_steps = request.data.get('steps') if isinstance(request.data, dict) else None
    if not isinstance(raw_steps, list) or not raw_steps:
        return Response({'steps': 'Provide a non-empty list of steps.'}, status=status.HTTP_400_BAD_REQUEST)
    if len(raw_steps) > 32:
        return Response({'steps': 'A run may contain at most 32 steps.'}, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        run.steps.all().delete()
        normalized = []
        for index, item in enumerate(raw_steps):
            if not isinstance(item, dict) or len(str(item.get('title') or '').strip()) < 4:
                transaction.set_rollback(True)
                return Response({'steps': f'Step {index + 1} needs a title.'}, status=status.HTTP_400_BAD_REQUEST)
            title = str(item.get('title')).strip()[:400]
            is_risky, reason = classify_risk('\n'.join([title, str(item.get('instructions') or ''), str(item.get('verification_command') or ''), run.goal]))
            normalized.append({
                'title': title,
                'instructions': str(item.get('instructions') or title)[:10000],
                'dependencies': item.get('dependencies') if isinstance(item.get('dependencies'), list) else [],
                'expected_files': item.get('expected_files') if isinstance(item.get('expected_files'), list) else [],
                'verification_command': str(item.get('verification_command') or '')[:500],
                'status': OrchestratorStep.AWAITING_APPROVAL if is_risky else OrchestratorStep.QUEUED,
                'approval_reason': reason,
                'order': index,
            })
        for item in normalized:
            OrchestratorStep.objects.create(run=run, title=item['title'], instructions=item['instructions'],
                dependencies=item['dependencies'], expected_files=item['expected_files'],
                verification_command=item['verification_command'], status=item['status'],
                approval_reason=item['approval_reason'], order=item['order'], tool=run.project.initialization_tool or 'opencode',
                model_id=run.project.initialization_model or '', reasoning_effort=run.project.initialization_reasoning_effort or 'medium',
                mode=run.project.initialization_mode or 'build')
        run.plan = normalized
        run.save(update_fields=['plan', 'updated_at'])
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
        if tool not in (InitializationTool.OPENCODE, InitializationTool.CODEX, InitializationTool.KILO):
            return Response({'tool': "Must be 'opencode', 'codex', or 'kilo'."}, status=status.HTTP_400_BAD_REQUEST)
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
        if run.status not in (OrchestratorRun.NEEDS_APPROVAL, OrchestratorRun.PAUSED, OrchestratorRun.RUNNING):
            return Response({'error': 'The run is not awaiting step approval.'}, status=status.HTTP_409_CONFLICT)
        step.status = OrchestratorStep.QUEUED
        step.approval_reason = ''
        step.save(update_fields=['status', 'approval_reason', 'updated_at'])
        if run.status == OrchestratorRun.NEEDS_APPROVAL and not run.steps.filter(status=OrchestratorStep.AWAITING_APPROVAL).exists():
            run.status = OrchestratorRun.RUNNING
            run.save(update_fields=['status', 'updated_at'])
        try:
            from .services.orchestrator_coordinator import coordinator
            coordinator.kick(run.id, request.user.id)
        except Exception:
            pass
        return Response(OrchestratorStepSerializer(step).data)
    if op == 'dispatch':
        # P1 semi-auto: server creates a dedicated visible terminal; the
        # frontend pastes the prompt (same handshake as Prompt tab).
        if run.status != OrchestratorRun.RUNNING:
            return Response({'error': 'Approve the plan before dispatching steps.'}, status=status.HTTP_409_CONFLICT)
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
                project_env=_project_terminal_env(project),
            )
            session.mode = 'orchestrator'
            session.title = f'Orchestrator: {step.title[:40]}'
        except TerminalError as e:
            return Response({'error': e.message}, status=e.http_status)
        step.terminal_id = session.id
        step.status = OrchestratorStep.SENDING
        step.attempt = (step.attempt or 0) + 1
        step.started_at = timezone.now()
        step.failure_reason = ''
        step.launch_phase = 'launching_cli'
        step.last_output_at = timezone.now()
        step.save(update_fields=['terminal_id', 'status', 'attempt', 'started_at', 'failure_reason', 'launch_phase', 'last_output_at', 'updated_at'])
        prompt = _compose_step_prompt(step, request.user)
        payload = session.to_dict()
        payload['prompt'] = prompt
        return Response(payload, status=status.HTTP_201_CREATED)
    if op == 'submitted':
        if step.status != OrchestratorStep.SENDING:
            return Response({'error': 'This step is not awaiting submission confirmation.'}, status=status.HTTP_409_CONFLICT)
        step.status = OrchestratorStep.RUNNING
        step.launch_phase = 'waiting_for_response'
        step.save(update_fields=['status', 'launch_phase', 'updated_at'])
        return Response(OrchestratorStepSerializer(step).data)
    if op == 'resend':
        if run.status != OrchestratorRun.RUNNING:
            return Response({'error': 'The run is not active.'}, status=status.HTTP_409_CONFLICT)
        if step.status != OrchestratorStep.RUNNING:
            return Response({'error': 'Only a running step can resend its prompt.'}, status=status.HTTP_409_CONFLICT)
        try:
            from .services.orchestrator_coordinator import coordinator
            coordinator.resend(step, request.user.id)
        except TerminalError as exc:
            return Response({'error': exc.message}, status=exc.http_status)
        return Response(OrchestratorStepSerializer(step).data)
    if op in ('pass', 'fail'):
        if step.status != OrchestratorStep.RUNNING:
            return Response({'error': 'A step must be running before it can be marked passed or failed.'}, status=status.HTTP_409_CONFLICT)
        step.status = OrchestratorStep.PASSED if op == 'pass' else OrchestratorStep.FAILED
        tail = request.data.get('output_tail')
        if isinstance(tail, str):
            step.output_tail = tail[-4000:]
        step.finished_at = timezone.now()
        step.save(update_fields=['status', 'output_tail', 'finished_at', 'updated_at'])
        _rollup_run(run)
        return Response(OrchestratorStepSerializer(step).data)
    if op == 'retry':
        if run.status in (OrchestratorRun.CANCELLED, OrchestratorRun.COMPLETED):
            return Response({'error': 'This run cannot be restarted from its current state.'}, status=status.HTTP_409_CONFLICT)
        if step.status not in (OrchestratorStep.FAILED, OrchestratorStep.QUEUED, OrchestratorStep.AWAITING_APPROVAL):
            return Response({'error': 'Only a failed or queued step can be requeued.'}, status=status.HTTP_409_CONFLICT)
        if step.terminal_id:
            terminal_manager.remove_for_user(step.terminal_id, request.user.id)
            step.terminal_id = ''
        is_risky, reason = classify_risk('\n'.join([step.title, step.instructions or '', step.verification_command or '']))
        step.status = OrchestratorStep.AWAITING_APPROVAL if is_risky else OrchestratorStep.QUEUED
        step.approval_reason = reason
        step.save(update_fields=['status', 'approval_reason', 'terminal_id', 'updated_at'])
        if run.status in (OrchestratorRun.FAILED, OrchestratorRun.COMPLETED):
            run.status = OrchestratorRun.RUNNING
            run.save(update_fields=['status', 'updated_at'])
        if run.status == OrchestratorRun.RUNNING:
            try:
                from .services.orchestrator_coordinator import coordinator
                coordinator.kick(run.id, request.user.id)
            except Exception:
                pass
        return Response(OrchestratorStepSerializer(step).data)
    if op == 'skip':
        if run.status in (OrchestratorRun.CANCELLED, OrchestratorRun.COMPLETED, OrchestratorRun.FAILED):
            return Response({'error': 'This run cannot be changed from its current state.'}, status=status.HTTP_409_CONFLICT)
        if step.status not in (OrchestratorStep.QUEUED, OrchestratorStep.AWAITING_APPROVAL, OrchestratorStep.FAILED):
            return Response({'error': 'Only a queued, approval, or failed step can be skipped.'}, status=status.HTTP_409_CONFLICT)
        step.status = OrchestratorStep.SKIPPED
        step.save(update_fields=['status', 'updated_at'])
        # Skipping while the plan is still being reviewed must not approve or
        # start the run implicitly; approval remains the explicit transition.
        if run.status != OrchestratorRun.AWAITING_PLAN:
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

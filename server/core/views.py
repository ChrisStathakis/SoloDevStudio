import os
import ctypes
import re
import json
import shutil
import subprocess
import uuid
from pathlib import Path
from datetime import timedelta, date, datetime
from .pathutils import normalize_path
from django.utils import timezone
from django.db import connection, transaction
from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import HttpResponse
from rest_framework import viewsets, status, permissions, filters
from rest_framework.decorators import api_view, permission_classes, action, throttle_classes
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from django_filters.rest_framework import DjangoFilterBackend

from .models import Project, ProjectLaunchPrompt, LauncherModelPreset, Milestone, Task, Subtask, Idea, IdeaCategory, TimeEntry, ProjectDoc, ProjectAgentLink, AgentFilter, StageWorkspace, StageChecklistDefault, StageDefinition, DailyFocus, StageReview, ProjectStage, InitializationTool, ReasoningEffort, InitializationMode, CloudBackup, CronJob, CronRun, AutomationPrompt, DEFAULT_STAGE_DEFINITIONS
from .serializers import (
    UserSerializer, RegisterSerializer,
    ProjectSerializer, MilestoneSerializer, StageWorkspaceSerializer, StageChecklistDefaultSerializer, StageDefinitionSerializer,
    TaskSerializer, SubtaskSerializer,
    IdeaSerializer, IdeaCategorySerializer, TimeEntrySerializer,
    ProjectDocSerializer, AgentFilterSerializer, LauncherModelPresetSerializer, AutomationPromptSerializer
)
from .stage_definitions import (
    ensure_stage_definitions,
    migrate_stage_references,
    reset_to_defaults,
    serialize_definition,
    stage_usage_counts,
    unique_key_for_label,
    valid_stage_keys,
)
from .filters import ProjectFilter, TaskFilter, IdeaFilter, TimeEntryFilter, ProjectDocFilter
from .permissions import IsOwner
from .model_validation import is_safe_model_id, MODEL_ID_ERROR
from .pdf_exports import idea_pdf, project_pdf
from .stage_workspaces import STAGE_WORKSPACE_CONFIG, checklist_ids, builtin_checklists, effective_checklists, stage_guidance, initialize_project_workspaces
from .services.terminal_manager import TerminalError, terminal_manager


def find_global_npm_executable(command):
    """Locate a Windows npm global shim even when the packaged backend lacks it on PATH."""
    executable = shutil.which(command)
    if executable:
        return executable
    appdata = os.environ.get('APPDATA', '')
    if not appdata:
        return None
    shim = os.path.join(appdata, 'npm', f'{command}.cmd')
    return shim if os.path.isfile(shim) else None
from .version import APP_VERSION, BUILD_ID

User = get_user_model()

# ---------- Auth & Health ----------

class AuthRegisterThrottle(AnonRateThrottle):
    scope = 'auth'


class AuthLoginThrottle(AnonRateThrottle):
    scope = 'auth_login'


class ThrottledTokenObtainPairView(TokenObtainPairView):
    throttle_classes = [AuthLoginThrottle]

@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def health_view(request):
    return Response({
        "status": "ok",
        "version": APP_VERSION,
        "build_id": BUILD_ID,
    })

@api_view(['POST'])
@permission_classes([permissions.AllowAny])
@throttle_classes([AuthRegisterThrottle])
def register_view(request):
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    refresh = RefreshToken.for_user(user)
    return Response({
        "user": UserSerializer(user).data,
        "access": str(refresh.access_token),
        "refresh": str(refresh),
    }, status=status.HTTP_201_CREATED)

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def me_view(request):
    return Response(UserSerializer(request.user).data)


def _project_folder_payload(user):
    configured = str(getattr(user, 'potential_projects_root', '') or '').strip()
    default_path = str(Path(settings.POTENTIAL_PROJECTS_ROOT).expanduser())
    effective = configured or default_path
    return {'path': configured, 'effective_path': effective, 'default_path': default_path, 'is_custom': bool(configured)}


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([permissions.IsAuthenticated])
def project_folder_settings_view(request):
    user = request.user
    if request.method == 'GET':
        return Response(_project_folder_payload(user))
    if request.method == 'DELETE':
        user.potential_projects_root = ''
        user.save(update_fields=['potential_projects_root'])
        return Response(_project_folder_payload(user))
    raw = request.data.get('path')
    if not isinstance(raw, str) or not raw.strip():
        return Response({'path': ['Enter an absolute folder path.']}, status=status.HTTP_400_BAD_REQUEST)
    candidate = os.path.expanduser(raw.strip().strip('"').strip("'"))
    # Accept native absolute paths on the host plus Windows drive/UNC paths.
    is_windows_absolute = bool(re.match(r'^[A-Za-z]:[\\/]', candidate) or candidate.startswith('\\\\'))
    value = os.path.abspath(candidate) if os.path.isabs(candidate) else candidate
    if any(ord(ch) < 32 for ch in value):
        return Response({'path': ['Folder path contains invalid characters.']}, status=status.HTTP_400_BAD_REQUEST)
    if not os.path.isabs(value) and not is_windows_absolute:
        return Response({'path': ['Folder path must be absolute.']}, status=status.HTTP_400_BAD_REQUEST)
    if os.path.exists(value) and not os.path.isdir(value):
        return Response({'path': ['Selected path is not a folder.']}, status=status.HTTP_400_BAD_REQUEST)
    user.potential_projects_root = value
    user.save(update_fields=['potential_projects_root'])
    return Response(_project_folder_payload(user))


def _automation_folder_payload(user):
    configured = str(getattr(user, 'automation_results_root', '') or '').strip()
    default_path = str(Path(settings.AUTOMATION_RESULTS_ROOT).expanduser())
    effective = configured or default_path
    return {'path': configured, 'effective_path': effective, 'default_path': default_path, 'is_custom': bool(configured)}


def _validate_folder_path(raw):
    """Shared absolute-folder validation (setting may not exist yet; never auto-creates)."""
    if not isinstance(raw, str) or not raw.strip():
        return None, {'path': ['Enter an absolute folder path.']}
    candidate = os.path.expanduser(raw.strip().strip('"').strip("'"))
    is_windows_absolute = bool(re.match(r'^[A-Za-z]:[\\/]', candidate) or candidate.startswith('\\\\'))
    value = os.path.abspath(candidate) if os.path.isabs(candidate) else candidate
    if any(ord(ch) < 32 for ch in value):
        return None, {'path': ['Folder path contains invalid characters.']}
    if not os.path.isabs(value) and not is_windows_absolute:
        return None, {'path': ['Folder path must be absolute.']}
    if os.path.exists(value) and not os.path.isdir(value):
        return None, {'path': ['Selected path is not a folder.']}
    return value, None


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([permissions.IsAuthenticated])
def automation_folder_settings_view(request):
    user = request.user
    if request.method == 'GET':
        return Response(_automation_folder_payload(user))
    if request.method == 'DELETE':
        user.automation_results_root = ''
        user.save(update_fields=['automation_results_root'])
        return Response(_automation_folder_payload(user))
    value, error = _validate_folder_path(request.data.get('path'))
    if error:
        return Response(error, status=status.HTTP_400_BAD_REQUEST)
    try:
        os.makedirs(value, exist_ok=True)
    except PermissionError:
        return Response({'path': ['Permission denied for that location.']}, status=status.HTTP_403_FORBIDDEN)
    except OSError:
        return Response({'path': ['Could not create the folder there.']}, status=status.HTTP_400_BAD_REQUEST)
    user.automation_results_root = value
    user.save(update_fields=['automation_results_root'])
    return Response(_automation_folder_payload(user))


@api_view(['PATCH'])
@permission_classes([permissions.IsAuthenticated])
def project_drive_settings_view(request):
    """Remap the configured drive letter for every project owned by the user."""
    raw_drive = request.data.get('drive')
    drive = str(raw_drive or '').strip().rstrip(':').upper()
    allowed_drives = {'C', 'D', 'E', 'F', 'G', 'H'}
    if drive not in allowed_drives:
        return Response(
            {'drive': ['Choose a drive letter from C through H.']},
            status=status.HTTP_400_BAD_REQUEST,
        )

    from .pathutils import remap_drive

    updated_count = 0
    with transaction.atomic():
        projects = Project.objects.select_for_update().filter(owner=request.user)
        for project in projects:
            project.drive = drive
            for field in ('cmd_directory', 'script_path', 'directory_path'):
                current = getattr(project, field) or ''
                if current:
                    setattr(project, field, remap_drive(current, drive))
            project.save(update_fields=[
                'drive', 'cmd_directory', 'script_path', 'directory_path', 'updated_at',
            ])
            updated_count += 1

    return Response({'drive': drive, 'updated_count': updated_count})


def _checklist_default_payload(owner, stage):
    builtins = builtin_checklists(stage)
    custom = StageChecklistDefault.objects.filter(owner=owner, stage=stage).first()
    effective = effective_checklists(owner, stage)
    return {
        'stage': stage,
        'checklist': effective['checklist'],
        'shaping_checklist': effective['shaping_checklist'],
        'built_in': builtins,
        'customized': custom is not None,
        'updated_at': custom.updated_at if custom else None,
    }


def _valid_stage(stage):
    return isinstance(stage, str) and bool(__import__('re').fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', stage or ''))


def _user_stage_keys(user):
    try:
        return valid_stage_keys(user)
    except Exception:
        return {value for value, _label in ProjectStage.choices}


@api_view(['GET', 'POST'])
@permission_classes([permissions.IsAuthenticated])
def stage_definitions_view(request):
    from .stage_definitions import ordered_definitions
    definitions = ordered_definitions(request.user)
    if request.method == 'GET':
        return Response({'stages': [serialize_definition(d, stage_usage_counts(request.user, d.key)) for d in definitions]})
    payload = request.data if isinstance(request.data, dict) else {}
    serializer = StageDefinitionSerializer(data=payload, context={'request': request})
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    key = unique_key_for_label(request.user, values['label'])
    max_order = max([d.order for d in definitions] + [0])
    stage = StageDefinition.objects.create(
        owner=request.user,
        key=key,
        label=values['label'],
        description=values.get('description', ''),
        color=values.get('color') or '#6366f1',
        order=values.get('order') if values.get('order') else max_order + 1,
        is_active=True,
        is_builtin=False,
        builtin_key='',
    )
    return Response(serialize_definition(stage, stage_usage_counts(request.user, stage.key)), status=status.HTTP_201_CREATED)


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([permissions.IsAuthenticated])
def stage_definition_detail_view(request, key):
    ensure_stage_definitions(request.user)
    stage = StageDefinition.objects.filter(owner=request.user, key=key).first()
    if not stage:
        return Response({'key': 'Unknown lifecycle stage.'}, status=status.HTTP_404_NOT_FOUND)
    if request.method == 'GET':
        return Response(serialize_definition(stage, stage_usage_counts(request.user, stage.key)))
    if request.method == 'DELETE':
        payload = request.data if isinstance(request.data, dict) else {}
        migrate_to = (payload.get('migrate_to') or request.query_params.get('migrate_to') or '').strip()
        usage = stage_usage_counts(request.user, stage.key)
        in_use = any(usage.values())
        if in_use and not migrate_to:
            return Response({'detail': 'This stage is still in use.', 'usage': usage}, status=status.HTTP_409_CONFLICT)
        if migrate_to:
            target = StageDefinition.objects.filter(owner=request.user, key=migrate_to).first()
            if not target or not target.is_active:
                return Response({'migrate_to': 'Choose an active stage to move existing items to.'}, status=status.HTTP_400_BAD_REQUEST)
            if migrate_to == stage.key:
                return Response({'migrate_to': 'Choose a different stage.'}, status=status.HTTP_400_BAD_REQUEST)
            migrate_stage_references(request.user, stage.key, migrate_to)
        if stage.is_builtin:
            stage.is_active = False
            stage.save(update_fields=['is_active', 'updated_at'])
            return Response(serialize_definition(stage, stage_usage_counts(request.user, stage.key)))
        stage.delete()
        return Response({'deleted': key, 'migrated_to': migrate_to or None})
    payload = request.data if isinstance(request.data, dict) else {}
    if 'migrate_to' in payload and 'is_active' not in payload:
        payload = {k: v for k, v in payload.items() if k != 'migrate_to'}
    serializer = StageDefinitionSerializer(stage, data=payload, partial=True, context={'request': request})
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    # Hiding a stage with content requires an explicit migration target.
    if values.get('is_active') is False and stage.is_active:
        usage = stage_usage_counts(request.user, stage.key)
        if any(usage.values()):
            migrate_to = (payload.get('migrate_to') or '').strip()
            target = StageDefinition.objects.filter(owner=request.user, key=migrate_to).first()
            if not target or not target.is_active or migrate_to == stage.key:
                return Response({'detail': 'This stage is still in use. Choose where to move existing items.', 'usage': usage}, status=status.HTTP_409_CONFLICT)
            migrate_stage_references(request.user, stage.key, migrate_to)
    for field, value in values.items():
        setattr(stage, field, value)
    stage.save()
    return Response(serialize_definition(stage, stage_usage_counts(request.user, stage.key)))


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def stage_definitions_reset_view(request):
    definitions = reset_to_defaults(request.user)
    return Response({'stages': [serialize_definition(d, stage_usage_counts(request.user, d.key)) for d in definitions]})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def stage_definitions_reorder_view(request):
    payload = request.data if isinstance(request.data, dict) else {}
    ordered_keys = payload.get('ordered_keys') or payload.get('order') or []
    if not isinstance(ordered_keys, list) or not ordered_keys:
        return Response({'ordered_keys': 'Provide an ordered list of stage keys.'}, status=status.HTTP_400_BAD_REQUEST)
    owned = {d.key: d for d in ensure_stage_definitions(request.user)}
    unknown = [k for k in ordered_keys if k not in owned]
    if unknown:
        return Response({'ordered_keys': f'Unknown stages: {unknown}'}, status=status.HTTP_400_BAD_REQUEST)
    if set(ordered_keys) != set(owned.keys()):
        return Response({'ordered_keys': 'The list must contain every stage exactly once.'}, status=status.HTTP_400_BAD_REQUEST)
    with transaction.atomic():
        for idx, key in enumerate(ordered_keys, start=1):
            owned[key].order = idx
            owned[key].save(update_fields=['order', 'updated_at'])
    definitions = ensure_stage_definitions(request.user)
    return Response({'stages': [serialize_definition(d, stage_usage_counts(request.user, d.key)) for d in definitions]})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def checklist_defaults_view(request):
    return Response({'stages': [_checklist_default_payload(request.user, stage) for stage, _label in ProjectStage.choices]})


@api_view(['GET', 'PATCH', 'DELETE'])
@permission_classes([permissions.IsAuthenticated])
def checklist_default_stage_view(request, stage):
    if not _valid_stage(stage):
        return Response({'stage': 'Unknown lifecycle stage.'}, status=status.HTTP_400_BAD_REQUEST)
    custom = StageChecklistDefault.objects.filter(owner=request.user, stage=stage).first()
    if request.method == 'GET':
        return Response(_checklist_default_payload(request.user, stage))
    if request.method == 'DELETE':
        if custom:
            custom.delete()
        return Response(_checklist_default_payload(request.user, stage))
    payload = request.data if isinstance(request.data, dict) else {}
    if custom:
        serializer = StageChecklistDefaultSerializer(custom, data=payload, partial=True, context={'request': request, 'stage': stage})
    else:
        serializer = StageChecklistDefaultSerializer(data={**payload, 'stage': stage}, partial=True, context={'request': request, 'stage': stage})
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    if custom:
        for field, value in values.items():
            setattr(custom, field, value)
        custom.save()
    else:
        custom = StageChecklistDefault.objects.create(owner=request.user, stage=stage, checklist=values.get('checklist', builtin_checklists(stage)['checklist']), shaping_checklist=values.get('shaping_checklist', builtin_checklists(stage)['shaping_checklist']))
    return Response(_checklist_default_payload(request.user, stage))


@api_view(['GET', 'PATCH'])
@permission_classes([permissions.IsAuthenticated])
def daily_focus_view(request):
    raw_day = request.query_params.get('day') if request.method == 'GET' else request.data.get('day')
    try:
        focus_day = datetime.strptime(raw_day, '%Y-%m-%d').date() if raw_day else timezone.localdate()
    except (TypeError, ValueError):
        return Response({'day': 'Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)
    focus = DailyFocus.objects.filter(owner=request.user, day=focus_day).first()
    if request.method == 'GET':
        return Response({'id': str(focus.id) if focus else None, 'day': focus_day.isoformat(), 'task_ids': list(focus.task_ids or []) if focus else [], 'updated_at': focus.updated_at if focus else None})
    task_ids = request.data.get('task_ids')
    if not isinstance(task_ids, list) or any(not isinstance(task_id, str) for task_id in task_ids):
        return Response({'task_ids': 'Provide an ordered list of task IDs.'}, status=status.HTTP_400_BAD_REQUEST)
    task_ids = list(dict.fromkeys(task_ids))
    owned_ids = {str(task_id) for task_id in Task.objects.filter(project__owner=request.user, id__in=task_ids).values_list('id', flat=True)}
    if set(task_ids) - owned_ids:
        return Response({'task_ids': 'Every selected task must belong to you.'}, status=status.HTTP_400_BAD_REQUEST)
    focus, _created = DailyFocus.objects.update_or_create(owner=request.user, day=focus_day, defaults={'task_ids': task_ids})
    return Response({'id': str(focus.id), 'day': focus.day.isoformat(), 'task_ids': list(focus.task_ids or []), 'updated_at': focus.updated_at})


def build_launch_prompt(idea):
    """Create a stable, readable coding-agent brief from the idea's saved fields."""
    lines = [
        'You are a coding agent helping turn this validated product idea into a working MVP.',
        'Create an implementation plan first, then build the solution in small, testable increments.',
        'Keep the scope focused on the stated MVP features and call out assumptions before making them.',
        '',
        '# Project brief',
        f"- Title: {idea.title}",
    ]

    def add(label, value):
        if value is None or value == '' or value == [] or value == {}:
            return
        lines.extend(['', f'## {label}', str(value).strip()])

    add('Tagline', idea.tagline)
    add('Category', idea.category)
    add('Problem', idea.problem)
    add('Solution', idea.solution)
    add('Target audience', idea.target_audience)
    add('Monetization', idea.monetization)
    if idea.mvp_features:
        add('MVP features', '\n'.join(f'- {feature}' for feature in idea.mvp_features))
    if idea.tags:
        add('Tags', ', '.join(str(tag) for tag in idea.tags))
    add('Notes', idea.notes)
    if idea.market_research:
        add('Market research', json.dumps(idea.market_research, ensure_ascii=False, indent=2))
    if idea.sketch_data_url or idea.sketch_objects:
        add('Sketch', 'A visual concept sketch is attached to the source idea in SoloDev Studio.')

    lines.extend([
        '',
        '## Delivery expectations',
        '- Explain the architecture and data flow before implementation.',
        '- Reuse the project requirements above as acceptance criteria.',
        '- Include validation, error handling, and tests for the core user flows.',
    ])
    return '\n'.join(lines).strip()


def get_potential_projects_root(user=None):
    configured = str(getattr(user, 'potential_projects_root', '') or '').strip()
    return Path(configured).expanduser() if configured else Path(settings.POTENTIAL_PROJECTS_ROOT).expanduser()


def create_potential_project_folder(title, user=None):
    """Create a unique, Windows-safe project folder and return its absolute path."""
    configured_root = get_potential_projects_root(user)
    # A stale or protected configured drive should not prevent idea conversion
    # or leave the user with a project that cannot open its in-app terminal.
    # Keep the fallback local to the active database: this is persistent for a
    # desktop install and stays inside the repository for local development.
    db_path = os.environ.get('SQLITE_PATH')
    fallback_root = (Path(db_path).expanduser().resolve().parent / 'projects') if db_path else (Path(settings.BASE_DIR).resolve() / 'projects')
    roots = [configured_root]
    if fallback_root.resolve() != configured_root.resolve():
        roots.append(fallback_root)
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '-', str(title or '').strip())
    safe = re.sub(r'\s+', ' ', safe).rstrip(' .') or 'project'
    if safe.upper().split('.')[0] in {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}:
        safe = f'_{safe}'
    safe = safe[:180].rstrip(' .') or 'project'
    last_error = None
    for root in roots:
        try:
            root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            last_error = exc
            continue
        candidate = root / safe
        suffix = 2
        while True:
            try:
                candidate.mkdir()
                return str(candidate.resolve())
            except FileExistsError:
                candidate = root / f'{safe}-{suffix}'
                suffix += 1
            except OSError as exc:
                last_error = exc
                break
    raise last_error or OSError('Unable to create a project folder.')


def _copy_project_source(source, destination):
    excluded_directories = {
        '.git', '.hg', '.svn', 'node_modules', 'dist', 'build', 'out',
        '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
        '.venv', 'venv', 'env', 'coverage', '.next', '.nuxt', 'output', 'tmp',
    }

    def ignore(_directory, names):
        return [name for name in names if name.casefold() in excluded_directories]

    shutil.copytree(source, destination, ignore=ignore, dirs_exist_ok=True)


def _remap_project_path(raw_path, source, destination):
    raw = (raw_path or '').strip().strip('"').strip("'")
    if not raw:
        return ''
    try:
        source_abs = os.path.abspath(source)
        raw_abs = os.path.abspath(raw)
        if os.path.commonpath([source_abs, raw_abs]).casefold() != source_abs.casefold():
            return ''
        return str(Path(destination) / os.path.relpath(raw_abs, source_abs))
    except (OSError, ValueError):
        return ''


GITHUB_HTTPS_RE = re.compile(r'^https://github\.com/[^/\s]+/[^/\s]+?(\.git)?/?$', re.IGNORECASE)
GITHUB_SSH_RE = re.compile(r'^git@github\.com:[^/\s]+/[^/\s]+?(\.git)?$', re.IGNORECASE)


def _is_github_url(url):
    value = (url or '').strip()
    return bool(GITHUB_HTTPS_RE.match(value) or GITHUB_SSH_RE.match(value))


def _project_git_dir(project):
    return normalize_path(project.directory_path) or normalize_path(project.cmd_directory)


def _project_terminal_env(project):
    """Small SOLODEV_* markers injected into every spawned project terminal."""
    directory = _project_git_dir(project)
    return {
        'SOLODEV_PROJECT': (project.title or '')[:120],
        'SOLODEV_PROJECT_ID': str(project.id),
        'SOLODEV_STAGE': project.current_stage or '',
        'SOLODEV_PROJECT_DIR': directory or '',
    }


def _tail_output(text, limit=4000):
    text = (text or '').strip()
    if len(text) > limit:
        return '…' + text[-limit:]
    return text


def _run_git(cwd, *args, timeout=60):
    try:
        return subprocess.run(
            ['git', *args],
            cwd=cwd or None,
            text=True,
            capture_output=True,
            timeout=timeout,
        )
    except FileNotFoundError:
        return None
    except subprocess.TimeoutExpired:
        completed = subprocess.CompletedProcess(
            args=['git', *args], returncode=124, stdout='', stderr='Git timed out.'
        )
        return completed


def _git_repo_state(directory):
    state = {
        'is_repo': False,
        'directory': directory,
        'branch': '',
        'remote': '',
        'dirty_count': 0,
        'has_changes': False,
    }
    if not directory or not os.path.isdir(directory):
        return state
    toplevel = _run_git(directory, 'rev-parse', '--show-toplevel', timeout=15)
    if toplevel is None or toplevel.returncode != 0:
        return state
    state['is_repo'] = True
    state['directory'] = (toplevel.stdout or '').strip() or directory
    branch = _run_git(state['directory'], 'rev-parse', '--abbrev-ref', 'HEAD', timeout=15)
    if branch is not None and branch.returncode == 0:
        state['branch'] = (branch.stdout or '').strip()
    remote = _run_git(state['directory'], 'remote', 'get-url', 'origin', timeout=15)
    if remote is not None and remote.returncode == 0:
        state['remote'] = (remote.stdout or '').strip()
    porcelain = _run_git(state['directory'], 'status', '--porcelain=v1', timeout=15)
    if porcelain is not None and porcelain.returncode == 0:
        lines = [line for line in (porcelain.stdout or '').splitlines() if line.strip()]
        state['dirty_count'] = len(lines)
        state['has_changes'] = bool(lines)
    return state


def compose_project_initialization_prompt(project, user):
    """Compose the saved project prompt with the project's currently active Skills."""
    prompt = ProjectLaunchPrompt.objects.filter(project=project).first()
    base = (prompt.content if prompt else '') or ''
    links = list(ProjectAgentLink.objects.filter(
        project=project, active=True, agent__owner=user
    ).select_related('agent__filter'))
    links.sort(key=lambda link: (
        link.agent.filter.order if link.agent.filter else 10**9,
        (link.agent.title or '').casefold(),
        str(link.agent.id),
    ))
    # Skills explicitly embedded through the Skills tab are already present in
    # the saved prompt; don't inject them a second time at launch.
    embedded_skill_ids = set(re.findall(
        r'<!--\s*solodev:embedded-skill:([0-9a-f-]{32,36})\s*-->', base,
        flags=re.IGNORECASE,
    ))
    sections = []
    for link in links:
        if str(link.agent_id) in embedded_skill_ids:
            continue
        agent = link.agent
        lines = [f'### {agent.title}']
        if agent.filter:
            lines.append(f'Filter: {agent.filter.name}')
        lines.extend(['', agent.content or ''])
        sections.append('\n'.join(lines).strip())
    content = f'{base}\n\n## Active project skills' if base else '## Active project skills'
    if sections:
        content += '\n\n' + '\n\n'.join(sections)
    return content, base, links


def compose_task_prompt(task, user):
    """Compose a focused implementation prompt for one open task."""
    project = task.project
    content, base, links = compose_project_initialization_prompt(project, user)
    if not base:
        return '', base, links
    lines = [
        content,
        '',
        '# Focus task',
        f'## Task: {task.title}',
    ]
    if task.description:
        lines.extend(['', '### Description', task.description.strip()])
    from .stage_definitions import stage_label as _stage_label
    lines.extend(['', f'- Stage: {_stage_label(user, task.stage)}', f'- Category: {task.get_category_display()}', f'- Priority: {task.get_quadrant_display()}'])
    if task.estimated_minutes:
        lines.append(f'- Estimate: {task.estimated_minutes} minutes')
    if task.tags:
        lines.append(f"- Tags: {', '.join(str(tag) for tag in task.tags)}")
    subtasks = list(task.subtasks.order_by('order', 'created_at'))
    if subtasks:
        lines.extend(['', '### Subtasks', *[f"- [{'x' if sub.completed else ' '}] {sub.title}" for sub in subtasks]])
    lines.extend([
        '',
        '## Task delivery instructions',
        '- Implement only this task and its subtasks within the existing project scope.',
        '- Preserve existing behavior outside this task and call out assumptions before changing shared interfaces.',
        '- Validate the core workflow with focused tests or checks and report what was verified.',
    ])
    return '\n'.join(lines).strip(), base, links

# ---------- Projects ----------

class ProjectViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwner]
    filterset_class = ProjectFilter
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['title', 'tagline', 'description', 'problem', 'solution', 'target_audience', 'monetization', 'notes']
    ordering_fields = ['created_at', 'target_deadline', 'start_date', 'updated_at', 'sort_order']

    def get_queryset(self):
        return Project.objects.filter(owner=self.request.user).prefetch_related('milestones', 'stage_workspaces')

    def perform_create(self, serializer):
        last = Project.objects.filter(owner=self.request.user).order_by('-sort_order').first()
        next_order = (last.sort_order + 1) if last is not None else 0
        serializer.save(owner=self.request.user, sort_order=next_order)

    @action(detail=False, methods=['post'], url_path='reorder')
    def reorder(self, request):
        ordered_ids = request.data.get('ordered_ids')
        if not isinstance(ordered_ids, list) or not ordered_ids:
            return Response({'ordered_ids': 'Provide a non-empty list of project IDs.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            parsed_ids = [str(x) for x in ordered_ids]
        except Exception:
            return Response({'ordered_ids': 'Invalid project IDs.'}, status=status.HTTP_400_BAD_REQUEST)
        owned = set(
            str(pid) for pid in Project.objects.filter(owner=request.user).values_list('id', flat=True)
        )
        unknown = [pid for pid in parsed_ids if pid not in owned]
        if unknown:
            return Response({'ordered_ids': 'Some projects were not found.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(set(parsed_ids)) != len(parsed_ids):
            return Response({'ordered_ids': 'Duplicate project IDs are not allowed.'}, status=status.HTTP_400_BAD_REQUEST)
        with transaction.atomic():
            for index, pid in enumerate(parsed_ids):
                Project.objects.filter(id=pid, owner=request.user).update(sort_order=index)
            # Projects not included keep their relative order after the reordered ones.
            remaining = (
                Project.objects.filter(owner=request.user)
                .exclude(id__in=parsed_ids)
                .order_by('sort_order', '-created_at')
            )
            offset = len(parsed_ids)
            for extra_index, project in enumerate(remaining):
                Project.objects.filter(id=project.id).update(sort_order=offset + extra_index)
        return Response({'success': True, 'ordered_ids': parsed_ids})

    @action(detail=True, methods=['get'], url_path='export-pdf')
    def export_pdf(self, request, pk=None):
        project = self.get_object()
        tasks = list(
            Task.objects.filter(project=project)
            .prefetch_related('subtasks')
            .order_by('-created_at')
        )
        time_entries = list(TimeEntry.objects.filter(project=project).order_by('-timestamp'))
        filename, content = project_pdf(project, tasks, time_entries)
        response = HttpResponse(content, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        response['Content-Length'] = len(content)
        return response

    def _manage_initial_prompt(self, request, project):
        prompt = ProjectLaunchPrompt.objects.filter(project=project).first()
        if request.method == 'GET':
            return Response({
                'id': str(prompt.id) if prompt else None,
                'content': prompt.content if prompt else '',
            })
        if request.method == 'DELETE':
            if prompt:
                prompt.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        content = request.data.get('content')
        if not isinstance(content, str):
            return Response({'content': 'This field must be a string.'}, status=status.HTTP_400_BAD_REQUEST)
        content = content.strip()
        if not content:
            return Response({'content': 'Prompt cannot be empty. Use DELETE to clear it.'}, status=status.HTTP_400_BAD_REQUEST)
        if prompt:
            prompt.content = content
            prompt.save(update_fields=['content', 'updated_at'])
        else:
            prompt = ProjectLaunchPrompt.objects.create(project=project, content=content)
        return Response({
            'id': str(prompt.id),
            'content': prompt.content,
            'created_at': prompt.created_at,
            'updated_at': prompt.updated_at,
        }, status=status.HTTP_200_OK if request.method == 'PATCH' else status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'put', 'patch', 'delete'], url_path='initial-prompt')
    def initial_prompt(self, request, pk=None):
        return self._manage_initial_prompt(request, self.get_object())

    @action(detail=True, methods=['get', 'patch'], url_path='initialization-settings')
    def initialization_settings(self, request, pk=None):
        project = self.get_object()
        if request.method == 'PATCH':
            tool = request.data.get('tool', project.initialization_tool)
            model_id = request.data.get('model_id', project.initialization_model)
            reasoning_effort = request.data.get('reasoning_effort', project.initialization_reasoning_effort)
            mode = request.data.get('mode', project.initialization_mode)
            if tool not in InitializationTool.values:
                return Response({'tool': 'Tool must be opencode, codex, or kilo.'}, status=400)
            if mode not in InitializationMode.values:
                return Response({'mode': 'Mode must be build or plan.'}, status=400)
            if not isinstance(model_id, str):
                return Response({'model_id': 'Model ID must be a string.'}, status=400)
            if reasoning_effort not in ReasoningEffort.values:
                return Response({'reasoning_effort': 'Reasoning effort must be low, medium, or high.'}, status=400)
            model_id = model_id.strip()
            if model_id and not is_safe_model_id(model_id):
                return Response({'model_id': MODEL_ID_ERROR}, status=400)
            project.initialization_tool = tool
            project.initialization_model = model_id
            project.initialization_reasoning_effort = reasoning_effort
            project.initialization_mode = mode
            project.save(update_fields=['initialization_tool', 'initialization_model', 'initialization_reasoning_effort', 'initialization_mode', 'updated_at'])
        return Response({'tool': project.initialization_tool, 'model_id': project.initialization_model or '', 'reasoning_effort': project.initialization_reasoning_effort, 'mode': project.initialization_mode})

    @action(detail=True, methods=['get'], url_path='tool-availability')
    def tool_availability(self, request, pk=None):
        self.get_object()
        tool = (request.query_params.get('tool') or '').strip().lower()
        configs = {
            'opencode': {
                'command': 'opencode',
                'install_command': 'npm install -g opencode-ai',
                'documentation_url': 'https://dev.opencode.ai/docs/',
            },
            'codex': {
                'command': 'codex',
                'install_command': 'npm install -g @openai/codex',
                'documentation_url': 'https://learn.chatgpt.com/docs/codex/cli',
            },
            'kilo': {
                'command': 'kilo',
                'install_command': 'npm install -g @kilocode/cli',
                'documentation_url': 'https://kilo.ai/docs/',
            },
        }
        config = configs.get(tool)
        if not config:
            return Response({'error': 'tool must be opencode, codex, or kilo.'}, status=400)
        executable = find_global_npm_executable(config['command'])
        npm_available = shutil.which('npm') is not None
        return Response({
            'tool': tool,
            'available': bool(executable),
            'executable': executable,
            'npm_available': npm_available,
            'install_command': config['install_command'],
            'documentation_url': config['documentation_url'],
            'message': None if executable else ('npm is not available on the server PATH.' if not npm_available else f'{config["command"]} is not installed.'),
        })

    @action(detail=True, methods=['get', 'put', 'patch', 'delete'], url_path='launch-prompt')
    def launch_prompt_endpoint(self, request, pk=None):
        return self._manage_initial_prompt(request, self.get_object())

    @action(detail=True, methods=['post'], url_path='advance-stage')
    def advance_stage(self, request, pk=None):
        project = self.get_object()
        next_stage = request.data.get('nextStage') or request.data.get('next_stage')
        if not next_stage:
            return Response({"error": "nextStage is required"}, status=400)
        valid = _user_stage_keys(request.user)
        if next_stage not in valid:
            return Response({"error": f"Invalid stage. Must be one of {sorted(valid)}"}, status=400)
        project.current_stage = next_stage
        if next_stage == ProjectStage.LIVE and not project.actual_launch_date:
            project.actual_launch_date = timezone.now().date()
        project.save(update_fields=['current_stage', 'actual_launch_date', 'updated_at'])
        return Response(ProjectSerializer(project).data)

    @action(detail=True, methods=['get', 'patch'], url_path=r'stage-workspaces/(?P<stage>[^/.]+)')
    def stage_workspace(self, request, pk=None, stage=None):
        project = self.get_object()
        if not _valid_stage(stage) or stage not in _user_stage_keys(request.user):
            return Response({'stage': 'Unknown lifecycle stage.'}, status=status.HTTP_400_BAD_REQUEST)
        workspace = StageWorkspace.objects.filter(project=project, stage=stage).first()
        if request.method == 'GET':
            if workspace:
                return Response(StageWorkspaceSerializer(workspace).data)
            definitions = effective_checklists(project.owner, stage)
            return Response({'id': None, 'project_id': str(project.id), 'stage': stage, 'notes': '', 'completed_items': [], **definitions, **stage_guidance(stage), 'built_in': builtin_checklists(stage), 'created_at': None, 'updated_at': None})
        if workspace:
            serializer = StageWorkspaceSerializer(workspace, data=request.data, partial=True, context={'request': request, 'stage': stage})
        else:
            definitions = effective_checklists(project.owner, stage)
            serializer = StageWorkspaceSerializer(data={**definitions, **request.data}, partial=True, context={'request': request, 'stage': stage})
        serializer.is_valid(raise_exception=True)
        if workspace:
            workspace = serializer.save()
        else:
            workspace = StageWorkspace.objects.create(project=project, stage=stage, **serializer.validated_data)
        return Response(StageWorkspaceSerializer(workspace).data)

    @action(detail=True, methods=['get', 'post'], url_path=r'stage-reviews/(?P<stage>[^/.]+)')
    def stage_review(self, request, pk=None, stage=None):
        project = self.get_object()
        if not _valid_stage(stage):
            return Response({'stage': 'Unknown lifecycle stage.'}, status=status.HTTP_400_BAD_REQUEST)
        workspace = StageWorkspace.objects.filter(project=project, stage=stage).first()
        tasks = list(Task.objects.filter(project=project, stage=stage).values('id', 'completed', 'blocker_reason'))
        milestones = list(project.milestones.filter(stage=stage).values('id', 'completed'))
        checklist = workspace or None
        snapshot = {
            'task_total': len(tasks),
            'task_completed': sum(1 for task in tasks if task['completed']),
            'blocked_tasks': sum(1 for task in tasks if task['blocker_reason']),
            'milestone_total': len(milestones),
            'milestone_completed': sum(1 for milestone in milestones if milestone['completed']),
            'checklist_completed': len(checklist.completed_items or []) if checklist else 0,
            'checklist_total': len((checklist.checklist if checklist else effective_checklists(project.owner, stage)['checklist']) or []) + len((checklist.shaping_checklist if checklist else effective_checklists(project.owner, stage)['shaping_checklist']) or []),
        }
        latest = StageReview.objects.filter(project=project, stage=stage).first()
        if request.method == 'GET':
            return Response({'latest': self._stage_review_payload(latest) if latest else None, 'current_snapshot': snapshot})
        decision = request.data.get('decision')
        if decision not in {StageReview.CONTINUE, StageReview.READY}:
            return Response({'decision': 'Choose continue or ready.'}, status=status.HTTP_400_BAD_REQUEST)
        note = request.data.get('note', '')
        if not isinstance(note, str):
            return Response({'note': 'Review note must be a string.'}, status=status.HTTP_400_BAD_REQUEST)
        review = StageReview.objects.create(project=project, stage=stage, decision=decision, note=note.strip(), snapshot=snapshot)
        return Response({'review': self._stage_review_payload(review), 'current_snapshot': snapshot}, status=status.HTTP_201_CREATED)

    @staticmethod
    def _stage_review_payload(review):
        return {'id': str(review.id), 'stage': review.stage, 'decision': review.decision, 'note': review.note, 'snapshot': review.snapshot, 'reviewed_at': review.reviewed_at}

    @action(detail=True, methods=['post'], url_path='open-folder')
    def open_folder(self, request, pk=None):
        project = self.get_object()
        raw = (project.directory_path or '').strip().strip('"').strip("'")
        if not raw:
            return Response({"error": "No folder path set for this project."}, status=400)
        if not os.path.isdir(raw):
            return Response({"error": f"Directory does not exist: {raw}"}, status=400)
        if not hasattr(os, 'startfile'):
            return Response({"error": "Opening folders is only supported on Windows."}, status=501)
        try:
            os.startfile(raw)  # noqa: S606 - opens Explorer at the validated directory
        except Exception as e:
            return Response({"error": f"Failed to open directory: {e}"}, status=500)
        return Response({"ok": True, "path": raw})

    @action(detail=True, methods=['get'], url_path='git-status')
    def git_status(self, request, pk=None):
        project = self.get_object()
        directory = _project_git_dir(project)
        state = _git_repo_state(directory)
        return Response({
            **state,
            'has_directory': bool(directory and os.path.isdir(directory)),
            'repo_url': project.repo_url or '',
        })

    @action(detail=True, methods=['post'], url_path='git-clone')
    def git_clone(self, request, pk=None):
        project = self.get_object()
        repo_url = (project.repo_url or '').strip()
        if not repo_url:
            return Response({'error': 'Set a GitHub repository URL for this project first.'}, status=400)
        if not _is_github_url(repo_url):
            return Response({'error': 'Repository URL must be a github.com HTTPS or SSH address.'}, status=400)
        raw_dir = _project_git_dir(project)
        destination = None
        clone_cwd = None
        clone_target = None
        try:
            if not raw_dir:
                destination = Path(create_potential_project_folder(project.title, request.user)).resolve()
                clone_cwd = str(destination)
                clone_target = '.'
            else:
                candidate = Path(os.path.expanduser(raw_dir))
                if candidate.is_file():
                    return Response({'error': f'Project path is a file, not a folder: {raw_dir}'}, status=400)
                if candidate.is_dir():
                    resolved = candidate.resolve()
                    if (resolved / '.git').is_dir():
                        return Response({'error': 'This folder is already a git repository.'}, status=400)
                    try:
                        entries = list(resolved.iterdir())
                    except OSError as exc:
                        return Response({'error': f'Unable to read project folder: {exc}'}, status=400)
                    if entries:
                        return Response({'error': 'Project folder is not empty. Clone needs an empty folder.'}, status=400)
                    destination = resolved
                    clone_cwd = str(destination)
                    clone_target = '.'
                else:
                    try:
                        candidate.parent.mkdir(parents=True, exist_ok=True)
                    except OSError as exc:
                        return Response({'error': f'Unable to create project folder: {exc}'}, status=400)
                    destination = candidate.resolve() if candidate.exists() else candidate.absolute()
                    clone_cwd = str(candidate.parent.resolve())
                    clone_target = str(destination)
            result = _run_git(clone_cwd, 'clone', repo_url, clone_target, timeout=180)
            if result is None:
                return Response({'error': 'Git is not installed or not on the server PATH.'}, status=500)
            if result.returncode != 0:
                detail = (result.stderr or result.stdout or '').strip()
                if 'Authentication failed' in detail or 'could not read Username' in detail or '403' in detail:
                    detail += ' Check Windows Credential Manager or run `gh auth login` in a terminal, then try again.'
                return Response({'error': f'Clone failed: {_tail_output(detail) or "unknown git error"}'}, status=400)
            dest_str = str(destination)
            project.directory_path = dest_str
            if not (project.cmd_directory or '').strip():
                project.cmd_directory = dest_str
            project.save(update_fields=['directory_path', 'cmd_directory', 'updated_at'])
            state = _git_repo_state(dest_str)
            return Response({'ok': True, 'path': dest_str, 'output': _tail_output(result.stderr or result.stdout), **state})
        except OSError as exc:
            return Response({'error': f'Unable to prepare project folder: {exc}'}, status=500)

    @action(detail=True, methods=['post'], url_path='git-pull')
    def git_pull(self, request, pk=None):
        project = self.get_object()
        directory = _project_git_dir(project)
        state = _git_repo_state(directory)
        if not state['is_repo']:
            return Response({'error': 'Project folder is not a git repository. Clone it first.'}, status=400)
        result = _run_git(state['directory'], 'pull', '--ff-only', timeout=120)
        if result is None:
            return Response({'error': 'Git is not installed or not on the server PATH.'}, status=500)
        if result.returncode != 0:
            return Response({'error': f'Pull failed: {_tail_output(result.stderr or result.stdout) or "unknown git error"}'}, status=400)
        fresh = _git_repo_state(state['directory'])
        return Response({'ok': True, 'output': _tail_output(result.stdout or result.stderr), **fresh})

    @action(detail=True, methods=['post'], url_path='git-push')
    def git_push(self, request, pk=None):
        project = self.get_object()
        directory = _project_git_dir(project)
        state = _git_repo_state(directory)
        if not state['is_repo']:
            return Response({'error': 'Project folder is not a git repository. Clone it first.'}, status=400)
        repo_dir = state['directory']
        outputs = []
        committed = False
        commit_message = ''
        if state.get('has_changes'):
            data = request.data if isinstance(request.data, dict) else {}
            raw_message = data.get('message', '')
            if raw_message is None:
                raw_message = ''
            commit_message = str(raw_message).strip() if isinstance(raw_message, str) else ''
            if not commit_message:
                commit_message = f"Save from SoloDev Studio ({timezone.localdate().isoformat()})"
            if len(commit_message) > 500:
                return Response({'error': 'Commit message must be 500 characters or fewer.'}, status=400)
            add_result = _run_git(repo_dir, 'add', '-A', timeout=120)
            if add_result is None:
                return Response({'error': 'Git is not installed or not on the server PATH.'}, status=500)
            if add_result.returncode != 0:
                return Response({'error': f'Commit failed during git add: {_tail_output(add_result.stderr or add_result.stdout) or "unknown git error"}'}, status=400)
            commit_result = _run_git(repo_dir, 'commit', '-m', commit_message, timeout=120)
            if commit_result is None:
                return Response({'error': 'Git is not installed or not on the server PATH.'}, status=500)
            if commit_result.returncode != 0:
                detail = (commit_result.stderr or commit_result.stdout or '').strip()
                if 'nothing to commit' in detail.lower():
                    pass
                elif 'user.name' in detail or 'user.email' in detail or 'Author identity unknown' in detail:
                    return Response({'error': 'Git author identity is not configured. Run `git config user.name "Your Name"` and `git config user.email "you@example.com"` in the project folder, then try again.'}, status=400)
                else:
                    return Response({'error': f'Commit failed: {_tail_output(detail) or "unknown git error"}'}, status=400)
            else:
                committed = True
                outputs.append(_tail_output(commit_result.stdout or commit_result.stderr))
                state = _git_repo_state(repo_dir)
        result = _run_git(repo_dir, 'push', timeout=120)
        if result is None:
            return Response({'error': 'Git is not installed or not on the server PATH.'}, status=500)
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or '').strip()
            if 'Authentication failed' in detail or 'could not read Username' in detail or '403' in detail:
                detail += ' Check Windows Credential Manager or run `gh auth login` in a terminal, then try again.'
            return Response({'error': f'Push failed: {_tail_output(detail) or "unknown git error"}'}, status=400)
        outputs.append(_tail_output(result.stdout or result.stderr or 'Pushed.'))
        fresh = _git_repo_state(repo_dir)
        return Response({'ok': True, 'output': '\n'.join(part for part in outputs if part), 'committed': committed, 'commit_message': commit_message if committed else '', **fresh})

    @action(detail=True, methods=['get'], url_path='context-brief')
    def context_brief(self, request, pk=None):
        from .services.project_context import (
            parse_max_chars, parse_sections, parse_stages, build_project_context,
        )
        project = self.get_object()
        valid_stages = sorted(_user_stage_keys(request.user))
        try:
            stages = parse_stages(request.query_params.get('stages'), project.current_stage, valid_stages)
            sections = parse_sections(request.query_params.get('sections'))
            max_chars = parse_max_chars(request.query_params.get('max_chars'))
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        payload = build_project_context(project, request.user, stages, sections, max_chars)
        return Response({'project': str(project.id), 'current_stage': project.current_stage, **payload})

    @action(detail=True, methods=['post'], url_path='write-context-file')
    def write_context_file(self, request, pk=None):
        from .services.project_context import (
            parse_max_chars, parse_sections, parse_stages, build_project_context, write_context_files,
        )
        project = self.get_object()
        data = request.data if isinstance(request.data, dict) else {}
        valid_stages = sorted(_user_stage_keys(request.user))
        try:
            stages = parse_stages(data.get('stages'), project.current_stage, valid_stages)
            sections = parse_sections(data.get('sections'))
            max_chars = parse_max_chars(data.get('max_chars'))
        except ValueError as exc:
            return Response({'error': str(exc)}, status=400)
        directory = _project_git_dir(project)
        if not directory:
            return Response({'error': 'Set a project folder first.'}, status=400)
        if not os.path.isdir(directory):
            return Response({'error': f'Project folder does not exist: {directory}'}, status=400)
        payload = build_project_context(project, request.user, stages, sections, max_chars)
        try:
            paths = write_context_files(directory, payload['markdown'], {
                'project': str(project.id),
                'title': project.title,
                'current_stage': project.current_stage,
                **payload,
            })
        except OSError as exc:
            return Response({'error': f'Unable to write context file: {exc}'}, status=500)
        return Response({'ok': True, **paths, **payload})

    @action(detail=True, methods=['post'], url_path='duplicate')
    def duplicate(self, request, pk=None):
        source_project = self.get_object()
        title = request.data.get('title')
        if not isinstance(title, str) or not title.strip():
            return Response({'title': 'A name is required for the copied project.'}, status=status.HTTP_400_BAD_REQUEST)
        title = title.strip()
        if len(title) > 300:
            return Response({'title': 'Project name must be 300 characters or fewer.'}, status=status.HTTP_400_BAD_REQUEST)

        source_raw = (source_project.directory_path or '').strip().strip('"').strip("'")
        if not source_raw:
            return Response({'error': 'This project does not have a source folder to copy.'}, status=status.HTTP_400_BAD_REQUEST)
        source_dir = Path(source_raw).expanduser()
        if not source_dir.is_dir():
            return Response({'error': f'Project folder does not exist: {source_raw}'}, status=status.HTTP_400_BAD_REQUEST)
        source_dir = source_dir.resolve()
        destination = None
        try:
            destination = Path(create_potential_project_folder(title, request.user)).resolve()
            try:
                destination.relative_to(source_dir)
            except ValueError:
                pass
            else:
                raise OSError('The configured project root is inside the source folder; choose a different project root before copying.')
            _copy_project_source(source_dir, destination)
            script_path = _remap_project_path(source_project.script_path, source_dir, destination)
            destination_drive = destination.drive[:1].upper() if destination.drive else source_project.drive
            with transaction.atomic():
                project_values = {
                    field.name: getattr(source_project, field.name)
                    for field in Project._meta.concrete_fields
                    if field.name not in {'id', 'owner', 'title', 'created_at', 'updated_at', 'directory_path', 'cmd_directory', 'script_path', 'python_env', 'port', 'drive', 'sort_order'}
                }
                last_order = Project.objects.filter(owner=request.user).order_by('-sort_order').first()
                project = Project.objects.create(
                    owner=request.user,
                    title=title,
                    directory_path=str(destination),
                    cmd_directory=str(destination),
                    script_path=script_path,
                    python_env='',
                    port='',
                    drive=destination_drive,
                    sort_order=(last_order.sort_order + 1) if last_order is not None else 0,
                    **project_values,
                )
                milestone_map = {}
                for milestone in source_project.milestones.all():
                    copied = Milestone.objects.create(
                        project=project,
                        title=milestone.title,
                        stage=milestone.stage,
                        target_date=milestone.target_date,
                        completed=milestone.completed,
                        description=milestone.description,
                        order=milestone.order,
                    )
                    milestone_map[milestone.pk] = copied
                for task in source_project.tasks.prefetch_related('subtasks', 'milestones').all():
                    copied_task = Task.objects.create(
                        project=project,
                        title=task.title,
                        description=task.description,
                        stage=task.stage,
                        quadrant=task.quadrant,
                        category=task.category,
                        completed=task.completed,
                        due_date=task.due_date,
                        estimated_minutes=task.estimated_minutes,
                        time_spent_minutes=0,
                        tags=list(task.tags or []),
                        blocker_reason=task.blocker_reason,
                        blocker_next_action=task.blocker_next_action,
                        completed_at=None,
                    )
                    for index, subtask in enumerate(task.subtasks.all()):
                        Subtask.objects.create(
                            task=copied_task,
                            title=subtask.title,
                            completed=subtask.completed,
                            order=subtask.order if subtask.order is not None else index,
                        )
                    copied_task.milestones.set([milestone_map[m.pk] for m in task.milestones.all() if m.pk in milestone_map])
                prompt = ProjectLaunchPrompt.objects.filter(project=source_project).first()
                if prompt:
                    ProjectLaunchPrompt.objects.create(project=project, content=prompt.content)
                for link in source_project.agent_links.all():
                    ProjectAgentLink.objects.create(project=project, agent=link.agent, active=link.active)
                for workspace in source_project.stage_workspaces.all():
                    StageWorkspace.objects.create(
                        project=project,
                        stage=workspace.stage,
                        notes=workspace.notes,
                        completed_items=list(workspace.completed_items or []),
                        checklist=[dict(item) for item in (workspace.checklist or [])],
                        shaping_checklist=[dict(item) for item in (workspace.shaping_checklist or [])],
                    )
        except Exception as exc:
            if destination and destination.is_dir():
                shutil.rmtree(destination, ignore_errors=True)
            return Response({'error': f'Unable to copy project: {exc}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        return Response({'project': ProjectSerializer(project).data}, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='run-script')
    def run_script(self, request, pk=None):
        project = self.get_object()
        raw = normalize_path(project.script_path)
        if not raw:
            return Response({"error": "No script path set for this project."}, status=400)
        if not os.path.isfile(raw):
            return Response({"error": f"Script file does not exist: {raw}"}, status=400)
        if not raw.lower().endswith(('.bat', '.cmd')):
            return Response({"error": "Only .bat / .cmd scripts are supported."}, status=400)
        run_args = project.port.split() if project.port and project.port.strip() else []
        try:
            session, reused = terminal_manager.get_or_create_script(
                owner_id=request.user.id,
                project_id=project.id,
                project_title=project.title,
                script_path=raw,
                run_args=run_args,
                python_env=normalize_path(project.python_env),
                project_env=_project_terminal_env(project),
            )
        except TerminalError as e:
            return Response({'error': e.message}, status=e.http_status)
        return Response({'ok': True, 'session': session.to_dict(), 'reused': reused,
                         'script': raw, 'args': run_args}, status=200 if reused else 201)

    @action(detail=True, methods=['post'], url_path='open-cmd')
    def open_cmd(self, request, pk=None):
        project = self.get_object()
        raw = normalize_path(project.cmd_directory)
        fallback = normalize_path(project.directory_path)
        try:
            session, reused = terminal_manager.get_or_create_cmd(
                owner_id=request.user.id,
                project_id=project.id,
                project_title=project.title,
                directory=raw,
                fallback_directory=fallback,
                python_env=normalize_path(project.python_env),
                project_env=_project_terminal_env(project),
            )
        except TerminalError as e:
            return Response({'error': e.message}, status=e.http_status)
        return Response({'ok': True, 'session': session.to_dict(), 'reused': reused,
                         'path': session.cwd}, status=200 if reused else 201)

    @action(detail=True, methods=['patch', 'delete'], url_path=r'agents/(?P<agent_id>[^/.]+)')
    def update_agent_link(self, request, pk=None, agent_id=None):
        project = self.get_object()
        try:
            link = ProjectAgentLink.objects.select_related('agent').get(
                project=project, agent_id=agent_id, agent__owner=request.user
            )
        except ProjectAgentLink.DoesNotExist:
            return Response({'error': 'Agent is not linked to this project.'}, status=404)
        if request.method == 'DELETE':
            link.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        if 'active' not in request.data:
            return Response({'active': 'This field is required.'}, status=400)
        raw_active = request.data['active']
        if isinstance(raw_active, str):
            raw_active = raw_active.strip().lower() in {'1', 'true', 'yes', 'on'}
        link.active = bool(raw_active)
        link.save(update_fields=['active'])
        return Response({'project': str(project.id), 'agent': str(link.agent_id), 'active': link.active})

    @action(detail=True, methods=['post'], url_path=r'agents/(?P<agent_id>[^/.]+)/add-to-prompt')
    def add_skill_to_prompt(self, request, pk=None, agent_id=None):
        project = self.get_object()
        try:
            link = ProjectAgentLink.objects.select_related('agent').get(
                project=project, agent_id=agent_id, agent__owner=request.user
            )
        except ProjectAgentLink.DoesNotExist:
            return Response({'error': 'Skill is not linked to this project.'}, status=status.HTTP_404_NOT_FOUND)

        prompt = ProjectLaunchPrompt.objects.filter(project=project).first()
        if not prompt or not (prompt.content or '').strip():
            return Response({'error': 'Save a project prompt before adding a skill.'}, status=status.HTTP_400_BAD_REQUEST)

        marker = f'<!-- solodev:embedded-skill:{link.agent_id} -->'
        content = prompt.content or ''
        if marker not in content:
            block = '\n\n'.join((
                marker,
                f'## Skill: {link.agent.title}',
                link.agent.content or '',
            )).strip()
            prompt.content = f'{content.rstrip()}\n\n{block}'
            prompt.save(update_fields=['content', 'updated_at'])
        return Response({
            'content': prompt.content,
            'skill': {'id': str(link.agent_id), 'title': link.agent.title},
            'already_added': marker in content,
        })

    @action(detail=True, methods=['get'], url_path='copy-prompt')
    def copy_prompt(self, request, pk=None):
        project = self.get_object()
        content, base, links = compose_project_initialization_prompt(project, request.user)
        return Response({'content': content, 'launch_prompt': base, 'active_agents': [
            {'title': link.agent.title, 'filter': link.agent.filter.name if link.agent.filter else None, 'content': link.agent.content or ''}
            for link in links
        ], 'active_skills': [
            {'title': link.agent.title, 'filter': link.agent.filter.name if link.agent.filter else None, 'content': link.agent.content or ''}
            for link in links
        ]})

    @action(detail=True, methods=['get'], url_path='initialize-prompt')
    def initialize_prompt(self, request, pk=None):
        project = self.get_object()
        content, base, links = compose_project_initialization_prompt(project, request.user)
        return Response({'content': content, 'initial_prompt': base, 'active_skills': [
            {'title': link.agent.title, 'filter': link.agent.filter.name if link.agent.filter else None, 'content': link.agent.content or ''}
            for link in links
        ]})

# ---------- Milestones (standalone, optional) ----------
class MilestoneViewSet(viewsets.ModelViewSet):
    serializer_class = MilestoneSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwner]

    def get_queryset(self):
        return Milestone.objects.filter(project__owner=self.request.user)

    def perform_create(self, serializer):
        project_id = self.request.data.get('project') or self.request.data.get('project_id')
        if not project_id:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"project": "project is required"})
        project = Project.objects.get(id=project_id, owner=self.request.user)
        serializer.save(project=project)

    @action(detail=True, methods=['put', 'patch'], url_path='tasks')
    def sync_tasks(self, request, pk=None):
        milestone = self.get_object()
        task_ids = request.data.get('task_ids', [])
        if not isinstance(task_ids, list):
            return Response({'task_ids': 'Expected a list of task IDs.'}, status=400)
        task_ids = list(dict.fromkeys(task_ids))
        tasks = list(Task.objects.filter(id__in=task_ids, project=milestone.project, project__owner=request.user))
        if len(tasks) != len(task_ids):
            return Response({'task_ids': 'Every task must belong to this milestone project.'}, status=400)
        with transaction.atomic():
            milestone.tasks.set(tasks)
        return Response(MilestoneSerializer(milestone).data)

# ---------- Tasks ----------

class TaskViewSet(viewsets.ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwner]
    filterset_class = TaskFilter
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['title', 'description']
    ordering_fields = ['created_at', 'due_date', 'estimated_minutes']

    def get_queryset(self):
        return Task.objects.filter(project__owner=self.request.user).prefetch_related('subtasks')

    @action(detail=True, methods=['get'], url_path='prompt')
    def prompt(self, request, pk=None):
        task = self.get_object()
        if not ProjectLaunchPrompt.objects.filter(project=task.project).exclude(content='').exists():
            return Response({'error': 'Save an initial project prompt before creating a task prompt.'}, status=status.HTTP_400_BAD_REQUEST)
        content, base, links = compose_task_prompt(task, request.user)
        return Response({
            'content': content,
            'initial_prompt': base,
            'task': {
                'id': str(task.id),
                'title': task.title,
                'subtasks': [
                    {'id': str(sub.id), 'title': sub.title, 'completed': sub.completed}
                    for sub in task.subtasks.order_by('order', 'created_at')
                ],
            },
            'active_skills': [
                {'title': link.agent.title, 'filter': link.agent.filter.name if link.agent.filter else None, 'content': link.agent.content or ''}
                for link in links
            ],
        })

    @action(detail=True, methods=['post'], url_path='add-to-prompt')
    def add_to_prompt(self, request, pk=None):
        task = self.get_object()
        prompt = ProjectLaunchPrompt.objects.filter(project=task.project).first()
        if not prompt or not (prompt.content or '').strip():
            return Response({'error': 'Save an initial project prompt before adding a task.'}, status=status.HTTP_400_BAD_REQUEST)

        marker = f'<!-- solodev:embedded-task:{task.id} -->'
        content = prompt.content or ''
        already_added = marker in content
        if not already_added:
            lines = [marker, f'## Task: {task.title}']
            if task.description and task.description.strip():
                lines.extend(['', '### Description', task.description.strip()])
            subtasks = list(task.subtasks.order_by('order', 'created_at'))
            if subtasks:
                lines.extend([
                    '',
                    '### Checklist',
                    *[f"- [{'x' if sub.completed else ' '}] {sub.title}" for sub in subtasks],
                ])
            block = '\n'.join(lines).strip()
            prompt.content = f'{content.rstrip()}\n\n{block}'
            prompt.save(update_fields=['content', 'updated_at'])

        return Response({
            'content': prompt.content,
            'task': {'id': str(task.id), 'title': task.title},
            'already_added': already_added,
        })

    @action(detail=True, methods=['post'], url_path='toggle-complete')
    def toggle_complete(self, request, pk=None):
        task = self.get_object()
        task.completed = not task.completed
        task.completed_at = timezone.now() if task.completed else None
        if task.completed:
            task.blocker_reason = ''
            task.blocker_next_action = ''
        task.save(update_fields=['completed', 'completed_at', 'blocker_reason', 'blocker_next_action'])
        return Response(TaskSerializer(task).data)

    @action(detail=True, methods=['post'], url_path='move-quadrant')
    def move_quadrant(self, request, pk=None):
        task = self.get_object()
        quadrant = request.data.get('quadrant')
        if not quadrant:
            return Response({"error": "quadrant is required"}, status=400)
        valid = ['q1_do', 'q2_schedule', 'q3_delegate', 'q4_eliminate']
        if quadrant not in valid:
            return Response({"error": f"Invalid quadrant {quadrant}"}, status=400)
        task.quadrant = quadrant
        task.save(update_fields=['quadrant'])
        return Response(TaskSerializer(task).data)

    @action(detail=True, methods=['post'], url_path='subtasks')
    def add_subtask(self, request, pk=None):
        task = self.get_object()
        title = request.data.get('title', '').strip()
        if not title:
            return Response({"error": "title is required"}, status=400)
        order = (task.subtasks.order_by('-order').first().order + 1) if task.subtasks.exists() else 0
        sub = Subtask.objects.create(task=task, title=title, order=order)
        return Response(SubtaskSerializer(sub).data, status=201)

    @action(detail=True, methods=['patch', 'delete'], url_path='subtasks/(?P<sub_id>[^/.]+)')
    def subtask_detail(self, request, pk=None, sub_id=None):
        task = self.get_object()
        try:
            sub = task.subtasks.get(id=sub_id)
        except Subtask.DoesNotExist:
            return Response({'error': 'Subtask not found'}, status=status.HTTP_404_NOT_FOUND)
        if request.method == 'DELETE':
            sub.delete()
            return Response(status=status.HTTP_204_NO_CONTENT)
        serializer = SubtaskSerializer(sub, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)

    @action(detail=True, methods=['post', 'patch'], url_path='subtasks/(?P<sub_id>[^/.]+)/toggle')
    def toggle_subtask(self, request, pk=None, sub_id=None):
        task = self.get_object()
        try:
            sub = task.subtasks.get(id=sub_id)
        except Subtask.DoesNotExist:
            return Response({"error": "Subtask not found"}, status=404)
        sub.completed = not sub.completed
        sub.save(update_fields=['completed'])
        return Response(SubtaskSerializer(sub).data)

# ---------- Ideas ----------

class IdeaViewSet(viewsets.ModelViewSet):
    serializer_class = IdeaSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwner]
    filterset_class = IdeaFilter
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['title', 'tagline', 'problem', 'solution']
    ordering_fields = ['created_at', 'updated_at']

    def get_queryset(self):
        return Idea.objects.filter(owner=self.request.user)

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

    @action(detail=True, methods=['get'], url_path='export-pdf')
    def export_pdf(self, request, pk=None):
        idea = self.get_object()
        filename, content = idea_pdf(idea)
        response = HttpResponse(content, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        response['Content-Length'] = len(content)
        return response

    @action(detail=True, methods=['post'], url_path='convert')
    def convert_to_project(self, request, pk=None):
        idea = self.get_object()
        if idea.status == 'converted' and idea.converted_project:
            return Response({"error": "Idea already converted", "project_id": str(idea.converted_project.id)}, status=400)
        today = timezone.now().date()
        deadline = today + timedelta(days=30)
        tech_stack = idea.tags if idea.tags else ['TypeScript', 'Tailwind CSS']
        notes = idea.notes or ''
        description_parts = []
        if idea.problem:
            description_parts.append(f"Problem: {idea.problem}")
        if idea.solution:
            description_parts.append(f"Solution: {idea.solution}")
        if idea.notes:
            description_parts.append(idea.notes)
        description = "\n\n".join(description_parts).strip()
        folder_path = None
        try:
            folder_path = create_potential_project_folder(idea.title, request.user)
        except OSError as exc:
            return Response({'error': f'Unable to create project folder: {exc}'}, status=500)
        try:
            with transaction.atomic():
                last_order = Project.objects.filter(owner=request.user).order_by('-sort_order').first()
                project = Project.objects.create(
                    owner=request.user,
                    title=idea.title,
                    tagline=idea.tagline or idea.problem or 'Built from idea brainstorm',
                    description=description,
                    problem=idea.problem,
                    solution=idea.solution,
                    target_audience=idea.target_audience,
                    monetization=idea.monetization,
                    mvp_features=idea.mvp_features or [],
                    tags=idea.tags or [],
                    category=idea.category.name,
                    current_stage=ProjectStage.PLANNING,
                    start_date=today,
                    target_deadline=deadline,
                    color='#6366f1',
                    tech_stack=tech_stack,
                    notes=notes,
                    pinned=True,
                    sort_order=(last_order.sort_order + 1) if last_order is not None else 0,
                    directory_path=folder_path,
                    cmd_directory=folder_path,
                    script_path='',
                    python_env='',
                )
                initialize_project_workspaces(project)
                ProjectLaunchPrompt.objects.create(project=project, content=build_launch_prompt(idea))
                # milestones
                Milestone.objects.create(project=project, title='MVP Architecture & Data Model', stage=ProjectStage.PLANNING, target_date=today + timedelta(days=7), completed=False, description='Define initial data contracts and flow.', order=0)
                Milestone.objects.create(project=project, title='Core MVP Features Complete', stage=ProjectStage.DEVELOPMENT, target_date=today + timedelta(days=21), completed=False, description='Implement primary user workflows.', order=1)
                # tasks from mvp_features
                for idx, feat in enumerate(idea.mvp_features or []):
                    Task.objects.create(
                        project=project,
                        title=feat,
                        stage=ProjectStage.DEVELOPMENT,
                        quadrant='q1_do' if idx == 0 else 'q2_schedule',
                        completed=False,
                        estimated_minutes=60,
                        time_spent_minutes=0,
                        tags=['mvp', 'core'],
                    )
                idea.status = 'converted'
                idea.converted_project = project
                idea.save(update_fields=['status', 'converted_project', 'updated_at'])
        except Exception:
            if folder_path:
                try:
                    folder = Path(folder_path)
                    if folder.is_dir() and not any(folder.iterdir()):
                        folder.rmdir()
                except OSError:
                    pass
            raise
        return Response({
            "project": ProjectSerializer(project).data,
            "idea": IdeaSerializer(idea).data,
        }, status=201)

# ---------- Launcher model presets ----------

class LauncherModelPresetViewSet(viewsets.ModelViewSet):
    serializer_class = LauncherModelPresetSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwner]
    http_method_names = ['get', 'post', 'patch', 'put', 'delete', 'head', 'options']

    def get_queryset(self):
        queryset = LauncherModelPreset.objects.filter(owner=self.request.user)
        tool = self.request.query_params.get('tool')
        if tool:
            queryset = queryset.filter(tool=tool)
        return queryset

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)


class IdeaCategoryViewSet(viewsets.ModelViewSet):
    serializer_class = IdeaCategorySerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None
    queryset = IdeaCategory.objects.all()

    def destroy(self, request, *args, **kwargs):
        category = self.get_object()
        if category.ideas.exists():
            return Response(
                {'detail': 'This category is still assigned to one or more ideas. Reassign those ideas before deleting it.'},
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

# ---------- Time Entries ----------

class TimeEntryViewSet(viewsets.ModelViewSet):
    serializer_class = TimeEntrySerializer
    permission_classes = [permissions.IsAuthenticated, IsOwner]
    filterset_class = TimeEntryFilter
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['project_title', 'task_title', 'notes']
    ordering_fields = ['timestamp', 'duration_seconds']
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        return TimeEntry.objects.filter(owner=self.request.user).select_related('project', 'task')

    def perform_destroy(self, instance):
        task = instance.task
        instance.delete()
        if task:
            total = sum(t.duration_seconds for t in task.time_entries.all())
            task.time_spent_minutes = round(total / 60) if total else 0
            task.save(update_fields=['time_spent_minutes'])

# ---------- Agent Filters ----------

class AgentFilterViewSet(viewsets.ModelViewSet):
    serializer_class = AgentFilterSerializer
    permission_classes = [permissions.IsAuthenticated]
    pagination_class = None
    queryset = AgentFilter.objects.all()
    ordering = ['order', 'name']

# ---------- Project Docs ----------

class ProjectDocViewSet(viewsets.ModelViewSet):
    serializer_class = ProjectDocSerializer
    permission_classes = [permissions.IsAuthenticated, IsOwner]
    filterset_class = ProjectDocFilter
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['title', 'content']
    ordering_fields = ['created_at', 'updated_at']

    def get_queryset(self):
        return ProjectDoc.objects.filter(owner=self.request.user).prefetch_related('projects', 'filter', 'project_links__project')

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

# ---------- Export / Import / Cloud backup / Dashboard / Timeline / Research ----------

CLOUD_BACKUP_SLOT = 'manual'
CLOUD_BACKUP_MAX_BYTES = 10 * 1024 * 1024


def _build_export_payload(user):
    projects = Project.objects.filter(owner=user).prefetch_related('milestones')
    tasks = Task.objects.filter(project__owner=user).prefetch_related('subtasks')
    ideas = Idea.objects.filter(owner=user)
    time_entries = TimeEntry.objects.filter(owner=user)
    docs = ProjectDoc.objects.filter(owner=user)
    presets = LauncherModelPreset.objects.filter(owner=user)
    automation_prompts = AutomationPrompt.objects.filter(owner=user)
    stage_workspaces = StageWorkspace.objects.filter(project__owner=user)
    from .serializers import ProjectSerializer, TaskSerializer, IdeaSerializer, TimeEntrySerializer, LauncherModelPresetSerializer, CronJobSerializer, AutomationPromptSerializer
    return {
        "version": "1.0",
        "exportedAt": timezone.now().isoformat(),
        "ownerUsername": user.username,
        "projects": ProjectSerializer(projects, many=True).data,
        "tasks": TaskSerializer(tasks, many=True).data,
        "ideas": IdeaSerializer(ideas, many=True).data,
        "timeEntries": TimeEntrySerializer(time_entries, many=True).data,
        "docs": ProjectDocSerializer(docs, many=True).data,
        "stageWorkspaces": StageWorkspaceSerializer(stage_workspaces, many=True).data,
        "checklistDefaults": [{**_checklist_default_payload(user, stage)} for stage, _label in ProjectStage.choices if StageChecklistDefault.objects.filter(owner=user, stage=stage).exists()],
        "stageDefinitions": [serialize_definition(d) for d in ensure_stage_definitions(user)] if StageDefinition.objects.filter(owner=user).exists() else [],
        "dailyFocuses": [{'day': focus.day.isoformat(), 'task_ids': list(focus.task_ids or [])} for focus in DailyFocus.objects.filter(owner=user)],
        "stageReviews": [{'project': str(review.project_id), 'stage': review.stage, 'decision': review.decision, 'note': review.note, 'snapshot': review.snapshot, 'reviewed_at': review.reviewed_at} for review in StageReview.objects.filter(project__owner=user)],
        "modelPresets": LauncherModelPresetSerializer(presets, many=True).data,
        "cronJobs": CronJobSerializer(CronJob.objects.filter(owner=user), many=True).data,
        "automationPrompts": AutomationPromptSerializer(automation_prompts, many=True).data,
        "settings": {"potentialProjectsRoot": user.potential_projects_root or '', "automationResultsRoot": getattr(user, 'automation_results_root', '') or ''},
    }


def _wipe_workspace_data(user):
    """Delete every user-owned workspace record; shared by reset + cloud restore."""
    project_ids = list(Project.objects.filter(owner=user).values_list('id', flat=True))
    doc_ids = list(ProjectDoc.objects.filter(owner=user).values_list('id', flat=True))
    legacy_link_table = 'core_projectdoc_projects'
    if legacy_link_table in connection.introspection.table_names() and (project_ids or doc_ids):
        clauses = []
        params = []
        if doc_ids:
            placeholders = ', '.join(['%s'] * len(doc_ids))
            clauses.append(f'projectdoc_id IN ({placeholders})')
            params.extend(value.hex for value in doc_ids)
        if project_ids:
            placeholders = ', '.join(['%s'] * len(project_ids))
            clauses.append(f'project_id IN ({placeholders})')
            params.extend(value.hex for value in project_ids)
        with connection.cursor() as cursor:
            cursor.execute(f'DELETE FROM {legacy_link_table} WHERE {" OR ".join(clauses)}', params)
    TimeEntry.objects.filter(owner=user).delete()
    ProjectDoc.objects.filter(owner=user).delete()
    LauncherModelPreset.objects.filter(owner=user).delete()
    AutomationPrompt.objects.filter(owner=user).delete()
    CronJob.objects.filter(owner=user).delete()
    DailyFocus.objects.filter(owner=user).delete()
    StageChecklistDefault.objects.filter(owner=user).delete()
    StageDefinition.objects.filter(owner=user).delete()
    Idea.objects.filter(owner=user).delete()
    Project.objects.filter(owner=user).delete()
    if user.potential_projects_root:
        user.potential_projects_root = ''
        user.save(update_fields=['potential_projects_root'])
    if getattr(user, 'automation_results_root', ''):
        user.automation_results_root = ''
        user.save(update_fields=['automation_results_root'])


def _cloud_backup_meta(backup):
    return {
        'exists': True,
        'name': backup.name,
        'exportedAt': backup.exported_at.isoformat() if backup.exported_at else None,
        'updatedAt': backup.updated_at.isoformat() if backup.updated_at else None,
        'sizeBytes': backup.size_bytes,
        'ownerUsername': backup.owner.username,
    }


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def export_data_view(request):
    return Response(_build_export_payload(request.user))


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def reset_workspace_view(request):
    """Delete every user-owned workspace record in one atomic operation."""
    user = request.user
    with transaction.atomic():
        project_ids = list(Project.objects.filter(owner=user).values_list('id', flat=True))
        doc_ids = list(ProjectDoc.objects.filter(owner=user).values_list('id', flat=True))
        deleted = {
            'projects': len(project_ids),
            'tasks': Task.objects.filter(project__owner=user).count(),
            'ideas': Idea.objects.filter(owner=user).count(),
            'timeEntries': TimeEntry.objects.filter(owner=user).count(),
            'docs': len(doc_ids),
            'stageWorkspaces': StageWorkspace.objects.filter(project__owner=user).count(),
            'checklistDefaults': StageChecklistDefault.objects.filter(owner=user).count(),
            'dailyFocuses': DailyFocus.objects.filter(owner=user).count(),
            'stageReviews': StageReview.objects.filter(project__owner=user).count(),
            'modelPresets': LauncherModelPreset.objects.filter(owner=user).count(),
            'cronJobs': CronJob.objects.filter(owner=user).count(),
            'automationPrompts': AutomationPrompt.objects.filter(owner=user).count(),
        }

        _wipe_workspace_data(user)

    return Response({'success': True, 'deleted': deleted})


def _perform_import(user, data):
    """Shared additive import used by manual import and cloud restore."""
    if not isinstance(data, dict):
        raise ValueError('Invalid backup format.')
    imported = {"projects": 0, "tasks": 0, "ideas": 0, "timeEntries": 0, "docs": 0, "stageWorkspaces": 0, "checklistDefaults": 0, "dailyFocuses": 0, "stageReviews": 0, "modelPresets": 0, "automationPrompts": 0, "settings": 0}
    project_id_map = {}
    milestone_id_map = {}
    task_id_map = {}

    with transaction.atomic():
        settings_data = data.get('settings') if isinstance(data.get('settings'), dict) else {}
        if 'potentialProjectsRoot' in settings_data or 'potential_projects_root' in settings_data:
            raw_root = settings_data.get('potentialProjectsRoot', settings_data.get('potential_projects_root'))
            if isinstance(raw_root, str):
                value = raw_root.strip()
                if not value:
                    user.potential_projects_root = ''
                    user.save(update_fields=['potential_projects_root'])
                    imported['settings'] = 1
                else:
                    normalized_candidate = os.path.expanduser(value.strip('"').strip("'"))
                    normalized = os.path.abspath(normalized_candidate) if os.path.isabs(normalized_candidate) else normalized_candidate
                    windows_abs = bool(re.match(r'^[A-Za-z]:[\\/]', normalized_candidate) or normalized_candidate.startswith('\\\\'))
                    if (os.path.isabs(normalized) or windows_abs) and not any(ord(ch) < 32 for ch in normalized) and (not os.path.exists(normalized) or os.path.isdir(normalized)):
                        user.potential_projects_root = normalized
                        user.save(update_fields=['potential_projects_root'])
                        imported['settings'] = 1
        if 'automationResultsRoot' in settings_data or 'automation_results_root' in settings_data:
            raw_auto = settings_data.get('automationResultsRoot', settings_data.get('automation_results_root'))
            if isinstance(raw_auto, str):
                value = raw_auto.strip()
                if not value:
                    user.automation_results_root = ''
                    user.save(update_fields=['automation_results_root'])
                    imported['settings'] = 1
                else:
                    normalized_candidate = os.path.expanduser(value.strip('"').strip("'"))
                    normalized = os.path.abspath(normalized_candidate) if os.path.isabs(normalized_candidate) else normalized_candidate
                    windows_abs = bool(re.match(r'^[A-Za-z]:[\\/]', normalized_candidate) or normalized_candidate.startswith('\\\\'))
                    if (os.path.isabs(normalized) or windows_abs) and not any(ord(ch) < 32 for ch in normalized) and (not os.path.exists(normalized) or os.path.isdir(normalized)):
                        user.automation_results_root = normalized
                        user.save(update_fields=['automation_results_root'])
                        imported['settings'] = 1
        # Projects with milestones
        if 'projects' in data and isinstance(data['projects'], list):
            # optional: clear or merge? We'll merge (create)
            for p in data['projects']:
                old_project_id = p.get('id')
                milestones = p.pop('milestones', [])
                launch_prompt = p.pop('launch_prompt', None) or p.pop('initialPrompt', None)
                # ignore client id to avoid collision, create new
                p.pop('id', None)
                p.pop('owner', None)
                p.pop('created_at', None)
                p.pop('updated_at', None)
                # map frontend camelCase to model fields if needed? Expect serializer fields; but allow both
                # Convert frontend keys if present
                mapped = {}
                key_map = {
                    'tagline': 'tagline', 'description': 'description', 'category': 'category',
                    'problem': 'problem', 'solution': 'solution',
                    'targetAudience': 'target_audience', 'target_audience': 'target_audience',
                    'monetization': 'monetization', 'mvpFeatures': 'mvp_features', 'mvp_features': 'mvp_features',
                    'tags': 'tags',
                    'currentStage': 'current_stage', 'current_stage': 'current_stage',
                    'targetDeadline': 'target_deadline', 'target_deadline': 'target_deadline',
                    'startDate': 'start_date', 'start_date': 'start_date',
                    'actualLaunchDate': 'actual_launch_date', 'actual_launch_date': 'actual_launch_date',
                    'color': 'color', 'techStack': 'tech_stack', 'tech_stack': 'tech_stack',
                    'repoUrl': 'repo_url', 'repo_url': 'repo_url',
                    'liveUrl': 'live_url', 'live_url': 'live_url',
                    'figmaUrl': 'figma_url', 'figma_url': 'figma_url',
                    'directoryPath': 'directory_path', 'directory_path': 'directory_path',
                    'scriptPath': 'script_path', 'script_path': 'script_path',
                    'cmdDirectory': 'cmd_directory', 'cmd_directory': 'cmd_directory',
                    'pythonEnv': 'python_env', 'python_env': 'python_env',
                    'port': 'port', 'drive': 'drive',
                    'notes': 'notes', 'pinned': 'pinned',
                    'sortOrder': 'sort_order', 'sort_order': 'sort_order',
                    'initializationTool': 'initialization_tool', 'initialization_tool': 'initialization_tool',
                    'initializationModel': 'initialization_model', 'initialization_model': 'initialization_model',
                    'initializationReasoningEffort': 'initialization_reasoning_effort', 'initialization_reasoning_effort': 'initialization_reasoning_effort',
                    'initializationMode': 'initialization_mode', 'initialization_mode': 'initialization_mode',
                    'techResearch': 'tech_research', 'tech_research': 'tech_research',
                    'title': 'title',
                }
                for k, v in p.items():
                    if k in key_map:
                        mapped[key_map[k]] = v
                    else:
                        mapped[k] = v
                # required fields defaults
                if 'target_deadline' not in mapped or not mapped['target_deadline']:
                    mapped['target_deadline'] = timezone.now().date()
                if 'start_date' not in mapped or not mapped['start_date']:
                    mapped['start_date'] = timezone.now().date()
                mapped['owner'] = user
                # Use serializer for validation? Direct create for speed
                proj = Project.objects.create(**{k: v for k, v in mapped.items() if k in [f.name for f in Project._meta.get_fields() if hasattr(f, 'column')]})
                initialize_project_workspaces(proj)
                if old_project_id:
                    project_id_map[str(old_project_id)] = proj
                imported["projects"] += 1
                prompt_content = launch_prompt.get('content') if isinstance(launch_prompt, dict) else launch_prompt
                if prompt_content is not None:
                    ProjectLaunchPrompt.objects.create(project=proj, content=prompt_content)
                for idx, m in enumerate(milestones):
                    old_milestone_id = m.get('id')
                    imported_milestone = Milestone.objects.create(
                        project=proj,
                        title=m.get('title', 'Milestone'),
                        stage=m.get('stage', ProjectStage.PLANNING),
                        target_date=m.get('targetDate') or m.get('target_date') or timezone.now().date(),
                        completed=m.get('completed', False),
                        description=m.get('description', ''),
                        order=m.get('order', idx),
                    )
                    if old_milestone_id:
                        milestone_id_map[str(old_milestone_id)] = imported_milestone
        # Stage workspaces (optional for compatibility with older exports)
        raw_workspaces = data.get('stageWorkspaces', data.get('stage_workspaces', []))
        if isinstance(raw_workspaces, list):
            import re as _re2
            for workspace_data in raw_workspaces:
                if not isinstance(workspace_data, dict):
                    continue
                project_ref = workspace_data.get('project') or workspace_data.get('projectId') or workspace_data.get('project_id')
                stage = workspace_data.get('stage')
                project_obj = project_id_map.get(str(project_ref)) if project_ref else None
                if not project_obj and project_ref:
                    try:
                        project_obj = Project.objects.get(id=project_ref, owner=user)
                    except (Project.DoesNotExist, ValueError, TypeError):
                        project_obj = Project.objects.filter(owner=user, title=project_ref).first()
                if not project_obj or not _re2.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', str(stage or '')):
                    continue
                completed = workspace_data.get('completedItems', workspace_data.get('completed_items', []))
                if not isinstance(completed, list):
                    completed = []
                definitions = {
                    'checklist': workspace_data.get('checklist', workspace_data.get('checklistItems')),
                    'shaping_checklist': workspace_data.get('shaping_checklist', workspace_data.get('shapingChecklist')),
                }
                if not all(isinstance(definitions.get(name), list) and all(isinstance(item, dict) for item in definitions.get(name, [])) for name in ('checklist', 'shaping_checklist')):
                    definitions = builtin_checklists(stage)
                    # Backups created before editable definitions only carried completion IDs.
                    # Keep those checked steps visible instead of silently dropping them.
                    known_ids = {item['id'] for group in definitions.values() for item in group}
                    for legacy_id in completed:
                        if isinstance(legacy_id, str) and legacy_id not in known_ids:
                            label = legacy_id.replace('-', ' ').strip().capitalize()
                            definitions['checklist'].append({'id': legacy_id, 'label': f'Legacy step: {label}'})
                            known_ids.add(legacy_id)
                valid_ids = {item.get('id') for group in definitions.values() if isinstance(group, list) for item in group if isinstance(item, dict)}
                completed = [item for item in completed if isinstance(item, str) and item in valid_ids]
                StageWorkspace.objects.update_or_create(
                    project=project_obj,
                    stage=stage,
                    defaults={'notes': workspace_data.get('notes', '') if isinstance(workspace_data.get('notes', ''), str) else '', 'completed_items': completed, **definitions},
                )
                imported['stageWorkspaces'] += 1
        # Personal checklist defaults (optional for compatibility with older exports)
        raw_defaults = data.get('checklistDefaults', data.get('checklist_defaults', []))
        if isinstance(raw_defaults, list):
            for default_data in raw_defaults:
                if not isinstance(default_data, dict) or not _valid_stage(default_data.get('stage')):
                    continue
                stage = default_data['stage']
                builtins = builtin_checklists(stage)
                guided = default_data.get('checklist') if isinstance(default_data.get('checklist'), list) else builtins['checklist']
                shaping = default_data.get('shaping_checklist') if isinstance(default_data.get('shaping_checklist'), list) else builtins['shaping_checklist']
                StageChecklistDefault.objects.update_or_create(owner=user, stage=stage, defaults={'checklist': guided, 'shaping_checklist': shaping})
                imported['checklistDefaults'] += 1
        # Lifecycle stage definitions (optional; older exports fall back to built-ins)
        raw_stages = data.get('stageDefinitions', data.get('stage_definitions', []))
        if isinstance(raw_stages, list) and raw_stages:
            import re as _re
            for entry in raw_stages:
                if not isinstance(entry, dict):
                    continue
                key = str(entry.get('key') or '').strip()
                if not _re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', key or ''):
                    continue
                label = str(entry.get('label') or key).strip()[:100] or key
                StageDefinition.objects.update_or_create(
                    owner=user,
                    key=key,
                    defaults={
                        'label': label,
                        'description': str(entry.get('description') or '')[:1000],
                        'color': str(entry.get('color') or '#6366f1')[:30],
                        'order': int(entry.get('order') or 0),
                        'is_active': bool(entry.get('is_active', True)),
                        'is_builtin': bool(entry.get('is_builtin', False)),
                        'builtin_key': str(entry.get('builtin_key') or ''),
                    },
                )
        # Tasks
        if 'tasks' in data and isinstance(data['tasks'], list):
            for t in data['tasks']:
                old_task_id = t.get('id')
                milestone_refs = t.pop('milestones', []) or []
                subtasks = t.pop('subtasks', [])
                t.pop('id', None)
                t.pop('created_at', None)
                t.pop('completed_at', None)
                # map keys
                key_map = {
                    'projectId': 'project', 'project_id': 'project',
                    'title': 'title', 'description': 'description', 'stage': 'stage', 'quadrant': 'quadrant', 'category': 'category',
                    'completed': 'completed', 'dueDate': 'due_date', 'due_date': 'due_date',
                    'estimatedMinutes': 'estimated_minutes', 'estimated_minutes': 'estimated_minutes',
                    'timeSpentMinutes': 'time_spent_minutes', 'time_spent_minutes': 'time_spent_minutes',
                    'tags': 'tags',
                    'blockerReason': 'blocker_reason', 'blocker_reason': 'blocker_reason',
                    'blockerNextAction': 'blocker_next_action', 'blocker_next_action': 'blocker_next_action',
                }
                mapped = {}
                project_ref = None
                for k, v in t.items():
                    if k in ['project', 'projectId', 'project_id']:
                        project_ref = v
                    elif k in key_map:
                        mapped[key_map[k]] = v
                    else:
                        mapped[k] = v
                # resolve project by title or id? try id first
                proj_obj = None
                if project_ref:
                    proj_obj = project_id_map.get(str(project_ref))
                    try:
                        if not proj_obj:
                            proj_obj = Project.objects.get(id=project_ref, owner=user)
                    except:
                        # try by title
                        proj_obj = Project.objects.filter(owner=user, title=project_ref).first()
                if not proj_obj:
                    proj_obj = Project.objects.filter(owner=user).first()
                    if not proj_obj:
                        continue
                mapped['project'] = proj_obj
                task = Task.objects.create(**mapped)
                if old_task_id:
                    task_id_map[str(old_task_id)] = task
                linked_milestones = [milestone_id_map[str(ref)] for ref in milestone_refs if str(ref) in milestone_id_map and milestone_id_map[str(ref)].project_id == proj_obj.id]
                if linked_milestones:
                    task.milestones.set(linked_milestones)
                imported["tasks"] += 1
                for idx, s in enumerate(subtasks):
                    Subtask.objects.create(task=task, title=s.get('title', 'Subtask'), completed=s.get('completed', False), order=s.get('order', idx))
        # Ideas
        if 'ideas' in data and isinstance(data['ideas'], list):
            for i in data['ideas']:
                i.pop('id', None)
                i.pop('owner', None)
                i.pop('created_at', None)
                i.pop('updated_at', None)
                i.pop('converted_project', None)
                i.pop('convertedProjectId', None)
                # map
                key_map = {
                    'title': 'title', 'tagline': 'tagline', 'problem': 'problem', 'solution': 'solution',
                    'notes': 'notes', 'category': 'category', 'status': 'status',
                    'sketchDataUrl': 'sketch_data_url', 'sketch_data_url': 'sketch_data_url',
                    'targetAudience': 'target_audience', 'target_audience': 'target_audience',
                    'monetization': 'monetization', 'mvpFeatures': 'mvp_features', 'mvp_features': 'mvp_features',
                    'tags': 'tags', 'marketResearch': 'market_research', 'market_research': 'market_research',
                }
                mapped = {}
                for k, v in i.items():
                    if k in key_map:
                        mapped[key_map[k]] = v
                category_name = str(mapped.pop('category', '') or 'Web App / SaaS').strip()
                category, _ = IdeaCategory.objects.get_or_create(
                    name=category_name[:50],
                    defaults={'order': IdeaCategory.objects.count()},
                )
                mapped['category'] = category
                mapped['owner'] = user
                Idea.objects.create(**mapped)
                imported["ideas"] += 1
        # TimeEntries
        if 'timeEntries' in data and isinstance(data['timeEntries'], list):
            for e in data['timeEntries']:
                e.pop('id', None)
                e.pop('owner', None)
                # map
                proj_ref = e.get('projectId') or e.get('project_id') or e.get('project')
                task_ref = e.get('taskId') or e.get('task_id') or e.get('task')
                proj_obj = None
                if proj_ref:
                    proj_obj = project_id_map.get(str(proj_ref))
                    try:
                        if not proj_obj:
                            proj_obj = Project.objects.get(id=proj_ref, owner=user)
                    except:
                        proj_obj = Project.objects.filter(owner=user).first()
                if not proj_obj:
                    continue
                task_obj = None
                if task_ref:
                    task_obj = task_id_map.get(str(task_ref))
                    try:
                        if not task_obj:
                            task_obj = Task.objects.get(id=task_ref, project__owner=user)
                    except:
                        pass
                TimeEntry.objects.create(
                    owner=user,
                    project=proj_obj,
                    project_title=e.get('projectTitle') or e.get('project_title') or proj_obj.title,
                    task=task_obj,
                    task_title=e.get('taskTitle') or e.get('task_title') or (task_obj.title if task_obj else ''),
                    stage=e.get('stage', ProjectStage.DEVELOPMENT),
                    duration_seconds=e.get('durationSeconds') or e.get('duration_seconds') or 60,
                    mode=e.get('mode', 'manual'),
                    notes=e.get('notes', ''),
                    timestamp=e.get('timestamp') or timezone.now().isoformat(),
                )
                imported["timeEntries"] += 1
        # Daily focus and stage review history are optional in older backups.
        raw_focuses = data.get('dailyFocuses', data.get('daily_focuses', []))
        if isinstance(raw_focuses, list):
            for focus_data in raw_focuses:
                if not isinstance(focus_data, dict):
                    continue
                try:
                    focus_day = datetime.strptime(str(focus_data.get('day')), '%Y-%m-%d').date()
                except (TypeError, ValueError):
                    continue
                refs = focus_data.get('task_ids', focus_data.get('taskIds', []))
                if not isinstance(refs, list):
                    continue
                mapped_ids = [str(task_id_map[str(ref)].id) for ref in refs if str(ref) in task_id_map]
                DailyFocus.objects.update_or_create(owner=user, day=focus_day, defaults={'task_ids': mapped_ids})
                imported['dailyFocuses'] += 1
        raw_reviews = data.get('stageReviews', data.get('stage_reviews', []))
        if isinstance(raw_reviews, list):
            for review_data in raw_reviews:
                if not isinstance(review_data, dict) or not _valid_stage(review_data.get('stage')):
                    continue
                project_ref = review_data.get('project') or review_data.get('projectId')
                project_obj = project_id_map.get(str(project_ref))
                if not project_obj:
                    continue
                decision = review_data.get('decision')
                if decision not in {StageReview.CONTINUE, StageReview.READY}:
                    continue
                StageReview.objects.create(project=project_obj, stage=review_data['stage'], decision=decision, note=str(review_data.get('note') or ''), snapshot=review_data.get('snapshot') if isinstance(review_data.get('snapshot'), dict) else {})
                imported['stageReviews'] += 1
        # Project Docs (M2M: projects list)
        if 'docs' in data and isinstance(data['docs'], list):
            for d in data['docs']:
                d.pop('id', None)
                d.pop('owner', None)
                d.pop('created_at', None)
                d.pop('updated_at', None)
                refs = d.pop('projects', None) or []
                link_states = {
                    str(link.get('project')): bool(link.get('active', True))
                    for link in (d.pop('project_links', None) or [])
                    if isinstance(link, dict) and link.get('project')
                }
                legacy_ref = d.get('projectId') or d.get('project_id') or d.get('project')
                if not refs and legacy_ref:
                    refs = [legacy_ref]
                proj_objs = []
                project_active_states = []
                for ref in refs:
                    po = None
                    try:
                        po = project_id_map.get(str(ref)) or Project.objects.get(id=ref, owner=user)
                    except Exception:
                        po = Project.objects.filter(owner=user, title=ref).first()
                    if po:
                        proj_objs.append(po)
                        project_active_states.append(link_states.get(str(ref), True))
                doc = ProjectDoc.objects.create(
                    owner=user,
                    title=d.get('title') or 'Untitled Doc',
                    content=d.get('content', ''),
                )
                raw_filter = d.get('filter') or d.get('filterId') or d.get('filter_slug')
                if raw_filter:
                    af = None
                    try:
                        if isinstance(raw_filter, str) and len(raw_filter) == 36:
                            af = AgentFilter.objects.filter(id=raw_filter).first()
                        if not af:
                            af = AgentFilter.objects.filter(slug=raw_filter).first()
                    except Exception:
                        af = None
                    if af:
                        doc.filter = af
                        doc.save(update_fields=['filter'])
                if proj_objs:
                    ProjectAgentLink.objects.bulk_create([
                        ProjectAgentLink(project=project_obj, agent=doc, active=project_active_states[idx])
                        for idx, project_obj in enumerate(proj_objs)
                    ], ignore_conflicts=True)
                imported["docs"] += 1
        # User-owned model presets
        if 'modelPresets' in data and isinstance(data['modelPresets'], list):
            for preset in data['modelPresets']:
                tool = preset.get('tool')
                model_id = preset.get('modelId') or preset.get('model_id')
                reasoning_effort = preset.get('reasoningEffort') or preset.get('reasoning_effort') or ReasoningEffort.MEDIUM
                mode = preset.get('mode') or InitializationMode.BUILD
                label = preset.get('label') or preset.get('name')
                if not label and isinstance(model_id, str):
                    label = f'{model_id.strip()} ({reasoning_effort})'
                if tool not in [InitializationTool.OPENCODE, InitializationTool.CODEX, InitializationTool.KILO] or not isinstance(model_id, str):
                    continue
                if not is_safe_model_id(model_id):
                    continue
                if reasoning_effort not in ReasoningEffort.values:
                    continue
                if mode not in InitializationMode.values:
                    continue
                label = str(label).strip()
                if not label:
                    continue
                base_label = label
                suffix = 2
                while True:
                    existing = LauncherModelPreset.objects.filter(owner=user, tool=tool, label__iexact=label).first()
                    if not existing:
                        break
                    if existing.model_id == model_id.strip() and existing.reasoning_effort == reasoning_effort:
                        label = existing.label
                        break
                    label = f'{base_label} {suffix}'
                    suffix += 1
                obj, _created = LauncherModelPreset.objects.update_or_create(
                    owner=user, tool=tool, label=label,
                    defaults={'model_id': model_id.strip(), 'reasoning_effort': reasoning_effort, 'mode': mode, 'enabled': preset.get('enabled', True)},
                )
                imported["modelPresets"] += 1
        # Cron jobs (standalone schedules; run history stays local)
        raw_cron = data.get('cronJobs', data.get('cron_jobs', []))
        if isinstance(raw_cron, list):
            from .services.cron_schedule import compute_next_run
            if 'cronJobs' not in imported:
                imported['cronJobs'] = 0
            for entry in raw_cron:
                if not isinstance(entry, dict):
                    continue
                name = str(entry.get('name') or '').strip()[:200]
                prompt = str(entry.get('prompt_template') or entry.get('promptTemplate') or '').strip()
                if len(name) < 3 or len(prompt) < 10:
                    continue
                tool = entry.get('tool') or InitializationTool.OPENCODE
                if tool not in InitializationTool.values:
                    tool = InitializationTool.OPENCODE
                working_directory = str(entry.get('working_directory') or entry.get('workingDirectory') or '').strip()
                if not working_directory or not os.path.isdir(os.path.expanduser(working_directory)):
                    continue
                CronJob.objects.create(
                    owner=user, name=name, working_directory=working_directory,
                    python_env=str(entry.get('python_env') or entry.get('pythonEnv') or '')[:500],
                    tool=tool,
                    model_id=str(entry.get('model_id') or entry.get('modelId') or '')[:200],
                    reasoning_effort=entry.get('reasoning_effort') or entry.get('reasoningEffort') or ReasoningEffort.MEDIUM,
                    mode=entry.get('mode') or InitializationMode.BUILD,
                    prompt_template=prompt,
                    schedule_kind=entry.get('schedule_kind') or entry.get('scheduleKind') or 'daily',
                    schedule_value=str(entry.get('schedule_value') or entry.get('scheduleValue') or '09:00')[:200],
                    timeout_minutes=int(entry.get('timeout_minutes') or entry.get('timeoutMinutes') or 15),
                    enabled=bool(entry.get('enabled', True)),
                    notify_mode=entry.get('notify_mode') or entry.get('notifyMode') or 'on_alert',
                    next_run_at=compute_next_run(
                        entry.get('schedule_kind') or entry.get('scheduleKind') or 'daily',
                        str(entry.get('schedule_value') or entry.get('scheduleValue') or '09:00'),
                    ),
                )
                imported['cronJobs'] += 1
        # Automation prompts (reusable markdown library; snapshot-copied into jobs)
        raw_prompts = data.get('automationPrompts', data.get('automation_prompts', []))
        if isinstance(raw_prompts, list):
            for entry in raw_prompts:
                if not isinstance(entry, dict):
                    continue
                title = str(entry.get('title') or '').strip()[:200]
                content = str(entry.get('content') or '').strip()
                if len(title) < 3 or len(content) < 10:
                    continue
                existing = AutomationPrompt.objects.filter(owner=user, title__iexact=title).first()
                if existing:
                    existing.content = content
                    existing.save(update_fields=['content', 'updated_at'])
                else:
                    AutomationPrompt.objects.create(owner=user, title=title, content=content)
                imported['automationPrompts'] += 1
    return imported


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def import_data_view(request):
    try:
        with transaction.atomic():
            imported = _perform_import(request.user, request.data)
    except ValueError as exc:
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
    return Response({"success": True, "imported": imported})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def cloud_backup_latest_view(request):
    backup = CloudBackup.objects.filter(owner=request.user, name=CLOUD_BACKUP_SLOT).first()
    if not backup:
        return Response({'exists': False})
    meta_only = request.query_params.get('meta') in ('1', 'true', 'yes')
    meta = _cloud_backup_meta(backup)
    if meta_only:
        return Response(meta)
    return Response({**meta, 'payload': backup.payload})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def cloud_backup_push_view(request):
    data = request.data
    if not isinstance(data, dict) or data.get('version') != '1.0':
        return Response({'error': 'Invalid backup format: version 1.0 payload required.'}, status=status.HTTP_400_BAD_REQUEST)
    # Strict per-account sync: a payload stamped for another username cannot be
    # stored under this JWT identity. The client also blocks mismatched
    # local/cloud logins before sending; this is the server-side backstop.
    claimed = data.get('ownerUsername')
    if isinstance(claimed, str):
        if claimed.strip() and claimed.strip() != request.user.username:
            return Response(
                {'error': 'Backup owner mismatch.', 'code': 'USER_MISMATCH'},
                status=status.HTTP_403_FORBIDDEN,
            )
    local_header = request.headers.get('X-Local-Username')
    if isinstance(local_header, str):
        if local_header.strip() and local_header.strip() != request.user.username:
            return Response(
                {'error': 'Local and cloud accounts must match.', 'code': 'USER_MISMATCH'},
                status=status.HTTP_403_FORBIDDEN,
            )
    try:
        raw = json.dumps(data)
    except (TypeError, ValueError):
        return Response({'error': 'Backup payload is not JSON serializable.'}, status=status.HTTP_400_BAD_REQUEST)
    size_bytes = len(raw.encode('utf-8'))
    if size_bytes > CLOUD_BACKUP_MAX_BYTES:
        return Response({'error': f'Backup too large ({size_bytes} bytes, max {CLOUD_BACKUP_MAX_BYTES}).'}, status=status.HTTP_400_BAD_REQUEST)
    exported_at = None
    raw_exported = data.get('exportedAt')
    if isinstance(raw_exported, str):
        try:
            exported_at = datetime.fromisoformat(raw_exported)
        except ValueError:
            exported_at = None
    backup, _ = CloudBackup.objects.update_or_create(
        owner=request.user,
        name=CLOUD_BACKUP_SLOT,
        defaults={'payload': data, 'exported_at': exported_at or timezone.now(), 'size_bytes': size_bytes},
    )
    return Response({'success': True, **_cloud_backup_meta(backup)})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def cloud_backup_restore_view(request):
    """Replace the caller's workspace with their stored cloud snapshot."""
    backup = CloudBackup.objects.filter(owner=request.user, name=CLOUD_BACKUP_SLOT).first()
    if not backup or not isinstance(backup.payload, dict):
        return Response({'error': 'No cloud backup found.'}, status=status.HTTP_404_NOT_FOUND)
    with transaction.atomic():
        _wipe_workspace_data(request.user)
        imported = _perform_import(request.user, backup.payload)
    return Response({"success": True, "imported": imported, **_cloud_backup_meta(backup)})

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def dashboard_view(request):
    user = request.user
    projects = Project.objects.filter(owner=user)
    tasks_qs = Task.objects.filter(project__owner=user)
    time_entries = TimeEntry.objects.filter(owner=user)
    active_projects = projects.exclude(current_stage=ProjectStage.LIVE).count()
    shipped = projects.filter(current_stage=ProjectStage.LIVE).count()
    pending = tasks_qs.filter(completed=False).count()
    urgent = tasks_qs.filter(completed=False, quadrant='q1_do').count()
    # weekly hours
    week_ago = timezone.now() - timedelta(days=7)
    recent_entries = time_entries.filter(timestamp__gte=week_ago)
    total_seconds_week = sum(e.duration_seconds for e in recent_entries)
    total_seconds_all = sum(e.duration_seconds for e in time_entries)
    recent_sessions = time_entries.order_by('-timestamp')[:4]
    # project time map
    project_time_map = {}
    stage_time_map = {}
    for e in time_entries:
        project_time_map[str(e.project_id)] = project_time_map.get(str(e.project_id), 0) + e.duration_seconds
        stage_time_map[e.stage] = stage_time_map.get(e.stage, 0) + e.duration_seconds
    return Response({
        "activeProjects": active_projects,
        "shippedLive": shipped,
        "pendingTasks": pending,
        "urgentQ1Tasks": urgent,
        "totalHoursWeek": round(total_seconds_week / 3600, 1),
        "totalHoursAll": round(total_seconds_all / 3600, 1),
        "totalSecondsWeek": total_seconds_week,
        "totalSecondsAll": total_seconds_all,
        "projectTimeMap": project_time_map,
        "stageTimeMap": stage_time_map,
        "recentSessions": [
            {
                "id": str(e.id), "projectTitle": e.project_title, "taskTitle": e.task_title,
                "durationSeconds": e.duration_seconds, "mode": e.mode, "timestamp": e.timestamp.isoformat(),
                "stage": e.stage
            } for e in recent_sessions
        ],
        "projectsCount": projects.count(),
        "ideasCount": Idea.objects.filter(owner=user).count(),
    })

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def timeline_view(request):
    user = request.user
    projects = Project.objects.filter(owner=user)
    milestones = Milestone.objects.filter(project__owner=user)
    tasks = Task.objects.filter(project__owner=user, due_date__isnull=False)
    items = []
    for p in projects:
        items.append({
            "id": f"launch-{p.id}",
            "type": "launch",
            "title": f"Launch: {p.title}",
            "projectTitle": p.title,
            "projectId": str(p.id),
            "date": str(p.target_deadline),
            "completed": p.current_stage == ProjectStage.LIVE,
        })
    for m in milestones:
        items.append({
            "id": f"ms-{m.id}",
            "type": "milestone",
            "title": m.title,
            "projectTitle": m.project.title,
            "projectId": str(m.project.id),
            "date": str(m.target_date),
            "completed": m.completed,
        })
    for t in tasks:
        items.append({
            "id": f"task-{t.id}",
            "type": "task",
            "title": t.title,
            "projectTitle": t.project.title,
            "projectId": str(t.project.id),
            "date": str(t.due_date),
            "completed": t.completed,
        })
    # filter by search query param ?search=
    search = request.query_params.get('search', '').lower()
    if search:
        items = [it for it in items if search in it['title'].lower() or search in it['projectTitle'].lower()]
    # filter type/project
    type_filter = request.query_params.get('type')
    if type_filter and type_filter != 'all':
        items = [it for it in items if it['type'] == type_filter]
    proj_filter = request.query_params.get('projectId') or request.query_params.get('project')
    if proj_filter and proj_filter != 'all':
        items = [it for it in items if it['projectId'] == str(proj_filter)]
    # sort by date
    def parse_date(d): 
        try:
            return datetime.fromisoformat(d).date()
        except:
            return date.max
    items.sort(key=lambda x: parse_date(x['date']))
    # grouping counts
    today = timezone.now().date()
    def days_remaining(d):
        try:
            target = datetime.fromisoformat(d).date()
            return (target - today).days
        except:
            return 999
    groups = {"overdue":0,"thisWeek":0,"nextTwoWeeks":0,"thisMonth":0,"later":0}
    for it in items:
        if it['completed']:
            continue
        dr = days_remaining(it['date'])
        if dr < 0: groups["overdue"] += 1
        elif dr <= 7: groups["thisWeek"] += 1
        elif dr <= 14: groups["nextTwoWeeks"] += 1
        elif dr <= 30: groups["thisMonth"] += 1
        else: groups["later"] += 1
    return Response({"items": items, "groups": groups})


# ---------- Filesystem browser (local dev tool) ----------
def _list_drive_roots():
    """Return mounted drive roots without touching removable media.

    ``os.path.exists('E:\\')`` can block for a surprisingly long time when a
    USB volume has disappeared or a mapped volume is offline.  The Windows
    logical-drive bitmask is a metadata query and does not perform that I/O.
    """
    if os.name != 'nt':
        return [os.path.sep]

    try:
        mask = int(ctypes.windll.kernel32.GetLogicalDrives())
    except (AttributeError, OSError, TypeError, ValueError):
        # Do not fall back to probing every drive: that is the operation this
        # endpoint must avoid when a removable volume is unavailable.
        return []
    return [f"{chr(ord('A') + bit)}:\\" for bit in range(26) if mask & (1 << bit)]


def _drive_root_for_path(path):
    """Return a normalized drive root for a Windows drive-letter path."""
    match = re.match(r'^([A-Za-z]):(?:[\\/]|$)', path or '')
    return f"{match.group(1).upper()}:\\" if match else None


def _filesystem_roots_response(warning=None, roots=None):
    if roots is None:
        roots = _list_drive_roots()
    payload = {
        "path": "",
        "parent": None,
        "entries": [
            {"name": root, "path": root, "is_dir": True}
            for root in roots
        ],
        "is_roots": True,
    }
    if warning:
        payload["warning"] = warning
    return Response(payload)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def filesystem_browse(request):
    """Browse the local filesystem for picking project folder / script paths.

    GET /api/filesystem/?path=<dir>
      - path omitted  -> user home directory
      - path=""       -> list drive roots
    Returns: { path, parent, entries:[{name, path, is_dir}], warning? }
    Read-only; no writes. Safe for a local single-user dev tool.
    """
    raw_path = (request.query_params.get('path') or '').strip()
    if raw_path == '':
        # Show drive roots (computer view)
        return _filesystem_roots_response()

    current = os.path.abspath(os.path.expanduser(raw_path))
    drive_root = _drive_root_for_path(current)
    mounted_roots = _list_drive_roots() if drive_root else None
    if drive_root and drive_root not in mounted_roots:
        return _filesystem_roots_response(
            f"The drive {drive_root[:2]} is unavailable. Reconnect it or choose another location.",
            mounted_roots,
        )
    if not os.path.exists(current):
        return Response({"error": f"Path does not exist: {current}"}, status=400)
    if not os.path.isdir(current):
        # If a file path was given, browse its parent instead
        current = os.path.dirname(current)

    parent = os.path.dirname(current) if current != drive_root else None
    try:
        names = os.listdir(current)
    except PermissionError:
        return Response({"error": f"Permission denied: {current}"}, status=403)
    except OSError as exc:
        return Response({"error": f"Unable to list directory: {exc}"}, status=400)

    entries = []
    for name in names:
        full = os.path.join(current, name)
        try:
            is_dir = os.path.isdir(full)
        except OSError:
            is_dir = False
        entries.append({"name": name, "path": full, "is_dir": is_dir})
    # Directories first, then files; alphabetical within each group
    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))

    return Response({
        "path": current,
        "parent": parent,
        "entries": entries,
        "is_roots": False,
    })


WINDOWS_RESERVED_NAMES = {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}


def _validate_new_folder_name(raw):
    name = str(raw or '').strip().strip('"').strip("'")
    if not name or len(name) > 180:
        return None, 'Enter a folder name (1-180 characters).'
    if '/' in name or '\\' in name or any(ord(ch) < 32 for ch in name):
        return None, 'Folder name must not contain path separators.'
    if re.search(r'[<>:"|?*]', name):
        return None, 'Folder name contains invalid characters.'
    if name.rstrip(' .') == '' or name != name.strip(' .') and name.strip(' .') == '':
        return None, 'Enter a folder name.'
    clean = name.rstrip(' .')
    if not clean:
        return None, 'Enter a folder name.'
    if clean.upper().split('.')[0] in WINDOWS_RESERVED_NAMES:
        return None, 'That name is reserved by Windows.'
    return clean, None


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def filesystem_mkdir(request):
    """Create one folder level inside an existing directory for the path picker.

    POST /api/filesystem/mkdir/ { path: <existing parent dir>, name: <new folder> }
    Returns: { path } of the created (or already-existing) directory.
    """
    raw_parent = request.data.get('path')
    if not isinstance(raw_parent, str) or not raw_parent.strip():
        return Response({'path': ['Choose the parent folder first.']}, status=status.HTTP_400_BAD_REQUEST)
    parent = os.path.abspath(os.path.expanduser(raw_parent.strip().strip('"').strip("'")))
    drive_root = _drive_root_for_path(parent)
    if drive_root:
        mounted_roots = _list_drive_roots()
        if drive_root not in mounted_roots:
            return Response({'path': [f'The drive {drive_root[:2]} is unavailable.']}, status=status.HTTP_400_BAD_REQUEST)
    if not os.path.isabs(parent):
        return Response({'path': ['Parent path must be absolute.']}, status=status.HTTP_400_BAD_REQUEST)
    if not os.path.isdir(parent):
        return Response({'path': ['Parent folder does not exist.']}, status=status.HTTP_400_BAD_REQUEST)
    name, name_error = _validate_new_folder_name(request.data.get('name'))
    if name_error:
        return Response({'name': [name_error]}, status=status.HTTP_400_BAD_REQUEST)
    target = os.path.join(parent, name)
    try:
        if os.path.exists(target) and not os.path.isdir(target):
            return Response({'name': ['A file with that name already exists.']}, status=status.HTTP_400_BAD_REQUEST)
        os.makedirs(target, exist_ok=True)
    except PermissionError:
        return Response({'name': ['Permission denied for that location.']}, status=status.HTTP_403_FORBIDDEN)
    except OSError:
        return Response({'name': ['Could not create the folder there.']}, status=status.HTTP_400_BAD_REQUEST)
    return Response({'path': target}, status=status.HTTP_201_CREATED)


RESULT_TEXT_EXTS = frozenset({
    '.md', '.markdown', '.txt', '.json', '.jsonl', '.csv', '.tsv', '.log',
    '.yaml', '.yml', '.xml', '.html', '.htm', '.css', '.js', '.ts', '.tsx',
    '.py', '.cfg', '.ini', '.toml',
})
RESULT_IMAGE_EXTS = frozenset({'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'})
RESULT_TEXT_CAP = 200 * 1024
RESULT_IMAGE_CAP = 8 * 1024 * 1024


def _automation_roots_for(user):
    """Absolute working directories (plus results root) this user may preview."""
    roots = []
    try:
        for job in CronJob.objects.filter(owner=user).only('working_directory'):
            raw = (job.working_directory or '').strip().strip('"').strip("'")
            if raw:
                roots.append(os.path.abspath(os.path.expanduser(raw)))
    except Exception:
        pass
    configured = str(getattr(user, 'automation_results_root', '') or '').strip()
    if configured:
        roots.append(os.path.abspath(os.path.expanduser(configured)))
    return roots


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def file_content_view(request):
    """Preview one automation result file inside the app.

    GET /api/files/content/?path=<absolute file path>
    Restricted to the caller's automation working directories (plus the
    default results folder). Text kinds are capped at 200KB, images at 8MB.
    """
    raw = (request.query_params.get('path') or '').strip().strip('"').strip("'")
    if not raw or not os.path.isabs(raw):
        return Response({'error': 'Provide an absolute file path.'}, status=400)
    current = os.path.abspath(os.path.expanduser(raw))
    if not os.path.isfile(current):
        return Response({'error': 'File does not exist.'}, status=404)
    roots = _automation_roots_for(request.user)
    if not any(current == root or current.startswith(root + os.sep) for root in roots):
        return Response({'error': 'File is outside your automation folders.'}, status=403)
    try:
        size = os.path.getsize(current)
    except OSError:
        return Response({'error': 'Could not read the file.'}, status=400)
    ext = os.path.splitext(current)[1].lower()
    if ext in RESULT_IMAGE_EXTS:
        if size > RESULT_IMAGE_CAP:
            return Response({'error': 'Image is too large to preview.'}, status=413)
        import base64 as _b64
        import mimetypes as _mime
        try:
            with open(current, 'rb') as handle:
                blob = handle.read()
        except OSError:
            return Response({'error': 'Could not read the file.'}, status=400)
        mime = _mime.guess_type(current)[0] or 'application/octet-stream'
        return Response({
            'kind': 'image', 'name': os.path.basename(current), 'path': current,
            'size': size, 'mime': mime,
            'data_url': f'data:{mime};base64,{_b64.b64encode(blob).decode("ascii")}',
        })
    if ext not in RESULT_TEXT_EXTS:
        return Response({'error': f'Preview is not supported for {ext or "this file type"}.'}, status=415)
    try:
        with open(current, 'r', encoding='utf-8', errors='replace') as handle:
            text = handle.read(RESULT_TEXT_CAP + 1)
    except OSError:
        return Response({'error': 'Could not read the file.'}, status=400)
    truncated = len(text) > RESULT_TEXT_CAP
    return Response({
        'kind': 'text', 'name': os.path.basename(current), 'path': current,
        'size': size, 'truncated': truncated,
        'content': text[:RESULT_TEXT_CAP],
    })

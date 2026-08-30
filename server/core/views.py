import os
import json
import re
import shutil
import subprocess
import uuid
from pathlib import Path
from datetime import timedelta, date, datetime
from .pathutils import normalize_path, resolve_venv
from django.utils import timezone
from django.db import transaction
from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import viewsets, status, permissions, filters
from rest_framework.decorators import api_view, permission_classes, action
from rest_framework.response import Response
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.tokens import RefreshToken
from django_filters.rest_framework import DjangoFilterBackend

from .models import Project, ProjectLaunchPrompt, LauncherModelPreset, Milestone, Task, Subtask, Idea, TimeEntry, ProjectDoc, ProjectAgentLink, AgentFilter, ProjectStage, InitializationTool, ReasoningEffort, InitializationMode
from .serializers import (
    UserSerializer, RegisterSerializer,
    ProjectSerializer, MilestoneSerializer,
    TaskSerializer, SubtaskSerializer,
    IdeaSerializer, TimeEntrySerializer,
    ProjectDocSerializer, AgentFilterSerializer, LauncherModelPresetSerializer
)
from .filters import ProjectFilter, TaskFilter, IdeaFilter, TimeEntryFilter, ProjectDocFilter
from .permissions import IsOwner
from .model_validation import is_safe_model_id, MODEL_ID_ERROR

User = get_user_model()

# ---------- Auth & Health ----------

@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def health_view(request):
    return Response({
        "status": "ok",
    })

@api_view(['POST'])
@permission_classes([permissions.AllowAny])
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
    root = get_potential_projects_root(user)
    root.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '-', str(title or '').strip())
    safe = re.sub(r'\s+', ' ', safe).rstrip(' .') or 'project'
    if safe.upper().split('.')[0] in {'CON', 'PRN', 'AUX', 'NUL', *(f'COM{i}' for i in range(1, 10)), *(f'LPT{i}' for i in range(1, 10))}:
        safe = f'_{safe}'
    safe = safe[:180].rstrip(' .') or 'project'
    candidate = root / safe
    suffix = 2
    while True:
        try:
            candidate.mkdir()
            return str(candidate.resolve())
        except FileExistsError:
            candidate = root / f'{safe}-{suffix}'
            suffix += 1


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
    sections = []
    for link in links:
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
    lines.extend(['', f'- Stage: {task.get_stage_display()}', f'- Category: {task.get_category_display()}', f'- Priority: {task.get_quadrant_display()}'])
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
    ordering_fields = ['created_at', 'target_deadline', 'start_date', 'updated_at']

    def get_queryset(self):
        return Project.objects.filter(owner=self.request.user).prefetch_related('milestones')

    def perform_create(self, serializer):
        serializer.save(owner=self.request.user)

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
                return Response({'tool': 'Tool must be opencode or codex.'}, status=400)
            if mode not in InitializationMode.values:
                return Response({'mode': 'Mode must be build or plan.'}, status=400)
            if mode == InitializationMode.PLAN and tool != InitializationTool.CODEX:
                return Response({'mode': 'Plan mode is only available for Codex.'}, status=400)
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
        }
        config = configs.get(tool)
        if not config:
            return Response({'error': 'tool must be opencode or codex.'}, status=400)
        executable = shutil.which(config['command'])
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
        valid = [c[0] for c in ProjectStage.choices]
        if next_stage not in valid:
            return Response({"error": f"Invalid stage. Must be one of {valid}"}, status=400)
        project.current_stage = next_stage
        if next_stage == ProjectStage.LIVE and not project.actual_launch_date:
            project.actual_launch_date = timezone.now().date()
        project.save(update_fields=['current_stage', 'actual_launch_date', 'updated_at'])
        return Response(ProjectSerializer(project).data)

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
        if os.name != 'nt' or not hasattr(subprocess, 'CREATE_NEW_CONSOLE'):
            return Response({"error": "Running scripts is only supported on Windows."}, status=501)
        cwd = os.path.dirname(raw) or None
        # Pass the project's optional port / run args to the script (blank = none)
        run_args = project.port.split() if project.port and project.port.strip() else []
        # If a project virtualenv is configured, put its Scripts dir first on PATH so
        # `python` inside the script resolves to the venv interpreter.
        env = None
        _activate_bat, scripts_dir = resolve_venv(project.python_env)
        if scripts_dir:
            env = dict(os.environ)
            existing = env.get('PATH', '')
            env['PATH'] = scripts_dir + ';' + existing if existing else scripts_dir
        try:
            subprocess.Popen(  # noqa: S603, S606 - user-owned local script launched in its own console
                [raw, *run_args],
                cwd=cwd,
                env=env,
                creationflags=subprocess.CREATE_NEW_CONSOLE,
            )
        except Exception as e:
            return Response({"error": f"Failed to run script: {e}"}, status=500)
        return Response({"ok": True, "script": raw, "args": run_args, "venv": scripts_dir or None})

    @action(detail=True, methods=['post'], url_path='open-cmd')
    def open_cmd(self, request, pk=None):
        project = self.get_object()
        raw = normalize_path(project.cmd_directory)
        if not raw:
            return Response({"error": "No CMD directory set for this project."}, status=400)
        if not os.path.isdir(raw):
            return Response({"error": f"Directory does not exist: {raw}"}, status=400)
        if os.name != 'nt' or not hasattr(subprocess, 'CREATE_NEW_CONSOLE'):
            return Response({"error": "Opening cmd is only supported on Windows."}, status=501)
        # Auto-activate the project's virtualenv on open when configured.
        command = ['cmd']
        activate_bat, _scripts_dir = resolve_venv(project.python_env)
        if activate_bat:
            command = ['cmd', '/k', 'call', activate_bat]
        try:
            subprocess.Popen(  # noqa: S603 - interactive shell rooted at the validated directory
                command,
                cwd=raw,
                creationflags=subprocess.CREATE_NEW_CONSOLE,
            )
        except Exception as e:
            return Response({"error": f"Failed to open cmd: {e}"}, status=500)
        return Response({"ok": True, "path": raw, "venv": activate_bat or None})

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

    @action(detail=True, methods=['post'], url_path='toggle-complete')
    def toggle_complete(self, request, pk=None):
        task = self.get_object()
        task.completed = not task.completed
        task.completed_at = timezone.now() if task.completed else None
        task.save(update_fields=['completed', 'completed_at'])
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
                    category=idea.category,
                    current_stage=ProjectStage.PLANNING,
                    start_date=today,
                    target_deadline=deadline,
                    color='#6366f1',
                    tech_stack=tech_stack,
                    notes=notes,
                    pinned=True,
                    directory_path=folder_path,
                    cmd_directory=folder_path,
                    script_path='',
                    python_env='',
                )
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

# ---------- Export / Import / Dashboard / Timeline / Research ----------

@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def export_data_view(request):
    user = request.user
    projects = Project.objects.filter(owner=user).prefetch_related('milestones')
    tasks = Task.objects.filter(project__owner=user).prefetch_related('subtasks')
    ideas = Idea.objects.filter(owner=user)
    time_entries = TimeEntry.objects.filter(owner=user)
    docs = ProjectDoc.objects.filter(owner=user)
    presets = LauncherModelPreset.objects.filter(owner=user)
    from .serializers import ProjectSerializer, TaskSerializer, IdeaSerializer, TimeEntrySerializer, LauncherModelPresetSerializer
    data = {
        "version": "1.0",
        "exportedAt": timezone.now().isoformat(),
        "projects": ProjectSerializer(projects, many=True).data,
        "tasks": TaskSerializer(tasks, many=True).data,
        "ideas": IdeaSerializer(ideas, many=True).data,
        "timeEntries": TimeEntrySerializer(time_entries, many=True).data,
        "docs": ProjectDocSerializer(docs, many=True).data,
        "modelPresets": LauncherModelPresetSerializer(presets, many=True).data,
        "settings": {"potentialProjectsRoot": user.potential_projects_root or ''},
    }
    return Response(data)

@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def import_data_view(request):
    data = request.data
    user = request.user
    imported = {"projects": 0, "tasks": 0, "ideas": 0, "timeEntries": 0, "docs": 0, "modelPresets": 0, "settings": 0}
    project_id_map = {}
    milestone_id_map = {}

    # Reject impossible mode/tool combinations before mutating any imported data.
    for project_data in data.get('projects', []) if isinstance(data.get('projects'), list) else []:
        imported_tool = project_data.get('initializationTool', project_data.get('initialization_tool', InitializationTool.OPENCODE))
        imported_mode = project_data.get('initializationMode', project_data.get('initialization_mode', InitializationMode.BUILD))
        if imported_mode == InitializationMode.PLAN and imported_tool != InitializationTool.CODEX:
            return Response({'initialization_mode': 'Plan mode is only available for Codex.'}, status=400)
    for preset_data in data.get('modelPresets', []) if isinstance(data.get('modelPresets'), list) else []:
        imported_tool = preset_data.get('tool')
        imported_mode = preset_data.get('mode', InitializationMode.BUILD)
        if imported_mode == InitializationMode.PLAN and imported_tool != InitializationTool.CODEX:
            return Response({'mode': 'Plan mode is only available for Codex.'}, status=400)

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
        # Tasks
        if 'tasks' in data and isinstance(data['tasks'], list):
            for t in data['tasks']:
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
                    try:
                        proj_obj = Project.objects.get(id=proj_ref, owner=user)
                    except:
                        proj_obj = Project.objects.filter(owner=user).first()
                if not proj_obj:
                    continue
                task_obj = None
                if task_ref:
                    try:
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
                if tool not in [InitializationTool.OPENCODE, InitializationTool.CODEX] or not isinstance(model_id, str):
                    continue
                if not is_safe_model_id(model_id):
                    continue
                if reasoning_effort not in ReasoningEffort.values:
                    continue
                if mode not in InitializationMode.values or (mode == InitializationMode.PLAN and tool != InitializationTool.CODEX):
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
    return Response({"success": True, "imported": imported})

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
    """Return a list of available drive root paths (Windows)."""
    roots = []
    if os.name == 'nt':
        for d in range(ord('A'), ord('Z') + 1):
            drive = f"{chr(d)}:\\"
            if os.path.exists(drive):
                roots.append(drive)
    else:
        roots.append(os.path.sep)
    return roots


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def filesystem_browse(request):
    """Browse the local filesystem for picking project folder / script paths.

    GET /api/filesystem/?path=<dir>
      - path omitted  -> user home directory
      - path=""       -> list drive roots
    Returns: { path, parent, entries:[{name, path, is_dir}] }
    Read-only; no writes. Safe for a local single-user dev tool.
    """
    raw_path = (request.query_params.get('path') or '').strip()
    if raw_path == '':
        # Show drive roots (computer view)
        entries = [
            {"name": r, "path": r, "is_dir": True}
            for r in _list_drive_roots()
        ]
        return Response({"path": "", "parent": None, "entries": entries, "is_roots": True})

    current = os.path.abspath(os.path.expanduser(raw_path))
    if not os.path.exists(current):
        return Response({"error": f"Path does not exist: {current}"}, status=400)
    if not os.path.isdir(current):
        # If a file path was given, browse its parent instead
        current = os.path.dirname(current)

    parent = os.path.dirname(current) if current not in _list_drive_roots() else None
    try:
        names = os.listdir(current)
    except PermissionError:
        return Response({"error": f"Permission denied: {current}"}, status=403)

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

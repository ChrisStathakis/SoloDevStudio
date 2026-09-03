import uuid
import re
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from django.contrib.auth import get_user_model
from django.utils import timezone
from django.utils.text import slugify
from .models import (
    Project, ProjectLaunchPrompt, LauncherModelPreset, Milestone, Task, Subtask, Idea, IdeaCategory, TimeEntry, ProjectDoc, ProjectAgentLink, AgentFilter, StageWorkspace,
    ProjectStage, AppCategory, PriorityQuadrant, TaskCategory, IdeaStatus, TimeMode, InitializationTool, ReasoningEffort, InitializationMode
)
from .stage_workspaces import checklist_ids
from .model_validation import is_safe_model_id, MODEL_ID_ERROR

User = get_user_model()

# ---------- User / Auth ----------

class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'date_joined', 'potential_projects_root']
        read_only_fields = ['id', 'date_joined']

class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'password']
        read_only_fields = ['id']

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("Email already in use.")
        return value

    def validate(self, attrs):
        # Run Django's password validators (min length, common, numeric, etc.)
        password = attrs.get('password')
        if password:
            try:
                validate_password(password)
            except DjangoValidationError as e:
                raise serializers.ValidationError({"password": list(e.messages)})
        return attrs

    def create(self, validated_data):
        user = User(
            username=validated_data['username'],
            email=validated_data['email'],
        )
        user.set_password(validated_data['password'])
        user.save()
        return user

# ---------- Milestone ----------

class MilestoneSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)
    task_ids = serializers.SerializerMethodField()

    def get_task_ids(self, obj):
        return [str(task_id) for task_id in obj.tasks.values_list('id', flat=True)]

    class Meta:
        model = Milestone
        fields = ['id', 'title', 'stage', 'target_date', 'completed', 'description', 'order', 'task_ids']
        read_only_fields = []

# ---------- Subtask ----------

class SubtaskSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(required=False)

    class Meta:
        model = Subtask
        fields = ['id', 'title', 'completed', 'order']

    def validate_title(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('title is required.')
        return value

# ---------- Project ----------

class StageWorkspaceSerializer(serializers.ModelSerializer):
    project_id = serializers.UUIDField(source='project.id', read_only=True)

    class Meta:
        model = StageWorkspace
        fields = ['id', 'project_id', 'stage', 'notes', 'completed_items', 'created_at', 'updated_at']
        read_only_fields = ['id', 'stage', 'created_at', 'updated_at']

    def validate_completed_items(self, value):
        if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
            raise serializers.ValidationError('completed_items must be a list of strings.')
        stage = self.instance.stage if self.instance else self.context.get('stage')
        invalid = sorted(set(value) - checklist_ids(stage))
        if invalid:
            raise serializers.ValidationError(f'Unknown checklist item(s) for {stage}: {", ".join(invalid)}')
        return list(dict.fromkeys(value))

    def validate_notes(self, value):
        if not isinstance(value, str):
            raise serializers.ValidationError('notes must be a string.')
        return value

class ProjectLaunchPromptSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectLaunchPrompt
        fields = ['id', 'content', 'created_at', 'updated_at']
        read_only_fields = fields

class ProjectSerializer(serializers.ModelSerializer):
    milestones = MilestoneSerializer(many=True, required=False)
    launch_prompt = ProjectLaunchPromptSerializer(read_only=True, allow_null=True)
    # tech_stack is JSON list, expose as is
    class Meta:
        model = Project
        fields = [
            'id', 'title', 'tagline', 'description', 'problem', 'solution',
            'target_audience', 'monetization', 'mvp_features', 'tags', 'category', 'current_stage',
            'target_deadline', 'start_date', 'actual_launch_date', 'color',
            'tech_stack', 'repo_url', 'live_url', 'figma_url', 'directory_path',
            'script_path', 'cmd_directory', 'port', 'python_env', 'drive', 'notes',
            'initialization_tool', 'initialization_model', 'initialization_reasoning_effort', 'initialization_mode', 'pinned', 'tech_research', 'created_at', 'updated_at', 'milestones', 'launch_prompt'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_tech_stack(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("tech_stack must be a list.")
        return value

    def validate_mvp_features(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("mvp_features must be a list.")
        return value

    def validate_tags(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("tags must be a list.")
        return value

    def validate_initialization_model(self, value):
        value = (value or '').strip()
        if value and not is_safe_model_id(value):
            raise serializers.ValidationError(MODEL_ID_ERROR)
        return value

    def validate_initialization_reasoning_effort(self, value):
        if value not in ReasoningEffort.values:
            raise serializers.ValidationError('Reasoning effort must be low, medium, or high.')
        return value

    def validate_initialization_mode(self, value):
        if value not in InitializationMode.values:
            raise serializers.ValidationError('Initialization mode must be build or plan.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        tool = attrs.get('initialization_tool', getattr(self.instance, 'initialization_tool', InitializationTool.OPENCODE))
        mode = attrs.get('initialization_mode', getattr(self.instance, 'initialization_mode', InitializationMode.BUILD))
        if mode == InitializationMode.PLAN and tool != InitializationTool.CODEX:
            raise serializers.ValidationError({'initialization_mode': 'Plan mode is only available for Codex.'})
        return attrs

    def create(self, validated_data):
        milestones_data = validated_data.pop('milestones', [])
        project = Project.objects.create(**validated_data)
        for idx, m in enumerate(milestones_data):
            # allow client to pass id? generate if not
            m_id = m.get('id') or uuid.uuid4()
            Milestone.objects.create(project=project, id=m_id, order=m.get('order', idx), **{k: v for k, v in m.items() if k not in ['id', 'order']})
        return project

    def update(self, instance, validated_data):
        milestones_data = validated_data.pop('milestones', None)
        # When the drive letter changes, remap the project's folder paths to the
        # new drive (python_env is intentionally left alone — it lives on the system).
        # An explicitly provided path in the same request wins and is left untouched.
        new_drive = validated_data.get('drive')
        if new_drive:
            from .pathutils import remap_drive
            for field in ('cmd_directory', 'script_path', 'directory_path'):
                if field in validated_data:
                    continue
                current = getattr(instance, field) or ''
                if current:
                    validated_data[field] = remap_drive(current, new_drive)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if milestones_data is not None:
            # Full replacement strategy: delete missing, update existing, create new
            existing_ids = {str(m.id): m for m in instance.milestones.all()}
            keep_ids = set()
            for idx, m in enumerate(milestones_data):
                m_id = str(m.get('id') or '')
                if m_id and m_id in existing_ids:
                    obj = existing_ids[m_id]
                    for k, v in m.items():
                        if k == 'id':
                            continue
                        if k == 'order':
                            obj.order = v
                        else:
                            setattr(obj, k, v)
                    if 'order' not in m:
                        obj.order = idx
                    obj.save()
                    keep_ids.add(m_id)
                else:
                    new_id = m.get('id') or uuid.uuid4()
                    Milestone.objects.create(
                        project=instance,
                        id=new_id,
                        order=m.get('order', idx),
                        **{k: v for k, v in m.items() if k not in ['id', 'order']}
                    )
                    keep_ids.add(str(new_id))
            # delete not in keep_ids
            for eid, obj in existing_ids.items():
                if eid not in keep_ids:
                    obj.delete()
        return instance


class LauncherModelPresetSerializer(serializers.ModelSerializer):
    class Meta:
        model = LauncherModelPreset
        fields = ['id', 'tool', 'model_id', 'reasoning_effort', 'mode', 'label', 'enabled', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

    def validate_model_id(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Model ID is required.')
        if not is_safe_model_id(value):
            raise serializers.ValidationError(MODEL_ID_ERROR)
        return value

    def validate_tool(self, value):
        if value not in InitializationTool.values:
            raise serializers.ValidationError('Tool must be opencode or codex.')
        return value

    def validate_reasoning_effort(self, value):
        if value not in ReasoningEffort.values:
            raise serializers.ValidationError('Reasoning effort must be low, medium, or high.')
        return value

    def validate_label(self, value):
        value = (value or '').strip()
        if not value:
            raise serializers.ValidationError('Preset name is required.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)
        tool = attrs.get('tool', self.instance.tool if self.instance else None)
        mode = attrs.get('mode', self.instance.mode if self.instance else InitializationMode.BUILD)
        if mode == InitializationMode.PLAN and tool != InitializationTool.CODEX:
            raise serializers.ValidationError({'mode': 'Plan mode is only available for Codex.'})
        request = self.context.get('request')
        owner = getattr(request, 'user', None)
        if owner and getattr(owner, 'is_authenticated', False):
            tool = attrs.get('tool', self.instance.tool if self.instance else None)
            label = attrs.get('label', self.instance.label if self.instance else '')
            query = LauncherModelPreset.objects.filter(owner=owner, tool=tool, label__iexact=label)
            if self.instance:
                query = query.exclude(pk=self.instance.pk)
            if query.exists():
                raise serializers.ValidationError({'label': 'A preset with this name already exists for this tool.'})
        return attrs

    def validate_mode(self, value):
        if value not in InitializationMode.values:
            raise serializers.ValidationError('Mode must be build or plan.')
        return value

# ---------- Task ----------

class TaskSerializer(serializers.ModelSerializer):
    subtasks = SubtaskSerializer(many=True, required=False)
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all(), required=True)
    milestones = serializers.PrimaryKeyRelatedField(many=True, queryset=Milestone.objects.all(), required=False)
    category = serializers.ChoiceField(choices=TaskCategory.choices, required=False, default=TaskCategory.FEATURE)

    class Meta:
        model = Task
        fields = [
            'id', 'project', 'title', 'description', 'stage', 'quadrant', 'category',
            'completed', 'due_date', 'estimated_minutes', 'time_spent_minutes',
            'tags', 'created_at', 'completed_at', 'subtasks', 'milestones'
        ]
        read_only_fields = ['id', 'created_at', 'time_spent_minutes', 'completed_at']

    def validate_tags(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("tags must be a list.")
        return value

    def validate_project(self, project):
        request = self.context.get('request')
        if request and hasattr(request, 'user') and request.user.is_authenticated:
            if project.owner_id != request.user.id:
                raise serializers.ValidationError("Project does not belong to you.")
        return project

    def validate(self, attrs):
        attrs = super().validate(attrs)
        project = attrs.get('project') or (self.instance.project if self.instance else None)
        milestones = attrs.get('milestones')
        if project and milestones is not None:
            invalid = [str(m.id) for m in milestones if m.project_id != project.id]
            if invalid:
                raise serializers.ValidationError({'milestones': 'All milestones must belong to the task project.'})
        return attrs

    def create(self, validated_data):
        subtasks_data = validated_data.pop('subtasks', [])
        milestones_data = validated_data.pop('milestones', [])
        # handle project_id alias
        task = Task.objects.create(**validated_data)
        task.milestones.set(milestones_data)
        for idx, s in enumerate(subtasks_data):
            s_id = s.get('id') or uuid.uuid4()
            Subtask.objects.create(task=task, id=s_id, order=s.get('order', idx), **{k: v for k, v in s.items() if k not in ['id', 'order']})
        return task

    def update(self, instance, validated_data):
        subtasks_data = validated_data.pop('subtasks', None)
        milestones_data = validated_data.pop('milestones', None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        # handle completed toggling
        if 'completed' in validated_data:
            if validated_data['completed'] and not instance.completed_at:
                instance.completed_at = timezone.now()
            elif not validated_data['completed']:
                instance.completed_at = None
        instance.save()
        if milestones_data is not None:
            instance.milestones.set(milestones_data)
        if subtasks_data is not None:
            existing = {str(s.id): s for s in instance.subtasks.all()}
            keep = set()
            for idx, s in enumerate(subtasks_data):
                sid = str(s.get('id') or '')
                if sid and sid in existing:
                    obj = existing[sid]
                    for k, v in s.items():
                        if k == 'id':
                            continue
                        if k == 'order':
                            obj.order = v
                        else:
                            setattr(obj, k, v)
                    if 'order' not in s:
                        obj.order = idx
                    obj.save()
                    keep.add(sid)
                else:
                    new_id = s.get('id') or uuid.uuid4()
                    Subtask.objects.create(task=instance, id=new_id, order=s.get('order', idx), **{k: v for k, v in s.items() if k not in ['id', 'order']})
                    keep.add(str(new_id))
            for eid, obj in existing.items():
                if eid not in keep:
                    obj.delete()
        return instance

# ---------- Idea ----------

class IdeaSerializer(serializers.ModelSerializer):
    category = serializers.SlugRelatedField(slug_field='name', queryset=IdeaCategory.objects.all())
    class Meta:
        model = Idea
        fields = [
            'id', 'title', 'tagline', 'problem', 'solution', 'notes', 'category', 'status',
            'sketch_data_url', 'sketch_objects', 'target_audience', 'monetization', 'mvp_features',
            'tags', 'converted_project', 'market_research', 'created_at', 'updated_at'
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'converted_project']

    def validate_mvp_features(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("mvp_features must be a list.")
        return value

    def validate_tags(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("tags must be a list.")
        return value


class IdeaCategorySerializer(serializers.ModelSerializer):
    idea_count = serializers.IntegerField(source='ideas.count', read_only=True)

    class Meta:
        model = IdeaCategory
        fields = ['id', 'name', 'order', 'idea_count', 'created_at', 'updated_at']
        read_only_fields = ['id', 'idea_count', 'created_at', 'updated_at']

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Name is required.')
        return value

    def create(self, validated_data):
        if 'order' not in validated_data:
            last = IdeaCategory.objects.order_by('-order').first()
            validated_data['order'] = (last.order + 1) if last else 0
        return super().create(validated_data)

# ---------- Agent Filter ----------

class AgentFilterSerializer(serializers.ModelSerializer):
    class Meta:
        model = AgentFilter
        fields = ['id', 'name', 'slug', 'order']
        read_only_fields = ['id', 'slug']

    def validate_name(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("name is required.")
        return value.strip()

    def _unique_slug(self, base):
        slug = base
        i = 2
        while AgentFilter.objects.filter(slug=slug).exclude(pk=self.instance.pk if self.instance else None).exists():
            slug = f"{base}-{i}"
            i += 1
        return slug

    def create(self, validated_data):
        if 'order' not in validated_data:
            last = AgentFilter.objects.order_by('-order').first()
            validated_data['order'] = (last.order + 1) if last else 1
        validated_data['slug'] = self._unique_slug(slugify(validated_data['name']))
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('slug', None)
        return super().update(instance, validated_data)

# ---------- Project Doc ----------

class ProjectDocSerializer(serializers.ModelSerializer):
    projects = serializers.PrimaryKeyRelatedField(many=True, queryset=Project.objects.all(), required=False)
    filter = serializers.PrimaryKeyRelatedField(queryset=AgentFilter.objects.all(), required=False, allow_null=True)
    filter_name = serializers.CharField(source='filter.name', read_only=True, default=None)
    filter_slug = serializers.CharField(source='filter.slug', read_only=True, default=None)
    project_links = serializers.SerializerMethodField()
    active = serializers.SerializerMethodField()

    class Meta:
        model = ProjectDoc
        fields = ['id', 'owner', 'projects', 'project_links', 'active', 'filter', 'filter_name', 'filter_slug', 'title', 'content', 'created_at', 'updated_at']
        read_only_fields = ['id', 'owner', 'created_at', 'updated_at']

    def get_project_links(self, obj):
        links = getattr(obj, 'project_links', None)
        if hasattr(links, 'all'):
            links = links.all()
        links = links or []
        return [{'project': str(link.project_id), 'active': bool(link.active)} for link in links]

    def get_active(self, obj):
        return None

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        project_id = request.query_params.get('project') if request else None
        if project_id:
            link = next((l for l in self.get_project_links(instance) if l['project'] == str(project_id)), None)
            data['active'] = link['active'] if link else None
        else:
            data.pop('active', None)
        return data

    def validate_projects(self, value):
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            foreign = [str(p.id) for p in value if p.owner_id != request.user.id]
            if foreign:
                raise serializers.ValidationError(f"Projects not owned by you: {foreign}")
        return value

    def validate_title(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError("title is required.")
        return value.strip()

    def create(self, validated_data):
        projects = validated_data.pop('projects', [])
        doc = ProjectDoc.objects.create(**validated_data)
        if projects:
            ProjectAgentLink.objects.bulk_create([
                ProjectAgentLink(project=project, agent=doc) for project in projects
            ], ignore_conflicts=True)
        return doc

    def update(self, instance, validated_data):
        projects = validated_data.pop('projects', None)
        for attr, val in validated_data.items():
            setattr(instance, attr, val)
        instance.save()
        if projects is not None:
            ProjectAgentLink.objects.filter(agent=instance).exclude(project__in=projects).delete()
            ProjectAgentLink.objects.bulk_create([
                ProjectAgentLink(project=project, agent=instance) for project in projects
            ], ignore_conflicts=True)
        return instance

# ---------- TimeEntry ----------

class TimeEntrySerializer(serializers.ModelSerializer):
    project = serializers.PrimaryKeyRelatedField(queryset=Project.objects.all())
    task = serializers.PrimaryKeyRelatedField(queryset=Task.objects.all(), required=False, allow_null=True)

    class Meta:
        model = TimeEntry
        fields = [
            'id', 'project', 'project_title', 'task', 'task_title', 'stage',
            'duration_seconds', 'mode', 'notes', 'timestamp'
        ]
        read_only_fields = ['id']

    def validate_duration_seconds(self, value):
        if value < 1:
            raise serializers.ValidationError("duration_seconds must be >=1")
        # For non-manual, enforce >30s threshold? Let view handle if needed but allow any; we allow but will filter in view? Enforce here for pomodoro/stopwatch >30
        return value

    def validate(self, attrs):
        request = self.context.get('request')
        project = attrs.get('project') or (self.instance.project if self.instance else None)
        task = attrs.get('task') or (self.instance.task if self.instance else None)
        if request and request.user.is_authenticated and project and project.owner_id != request.user.id:
            raise serializers.ValidationError({"project": "Project does not belong to you."})
        if task and project and task.project_id != project.id:
            raise serializers.ValidationError({"task": "Task does not belong to the specified project."})
        if task and request and request.user.is_authenticated and task.project.owner_id != request.user.id:
            raise serializers.ValidationError({"task": "Task does not belong to you."})
        # For pomodoro/stopwatch, enforce >30 seconds (stopTimer threshold)
        mode = attrs.get('mode') or (self.instance.mode if self.instance else TimeMode.MANUAL)
        duration = attrs.get('duration_seconds') or (self.instance.duration_seconds if self.instance else 0)
        if mode in [TimeMode.POMODORO, TimeMode.STOPWATCH] and duration <= 30:
            raise serializers.ValidationError({"duration_seconds": "Duration must be >30s for pomodoro/stopwatch."})
        return attrs

    def create(self, validated_data):
        # owner from request
        request = self.context.get('request')
        if request and request.user.is_authenticated:
            validated_data['owner'] = request.user
        # fill project_title/task_title if not provided? require client to send; but fallback
        if not validated_data.get('project_title'):
            validated_data['project_title'] = validated_data['project'].title
        if validated_data.get('task') and not validated_data.get('task_title'):
            validated_data['task_title'] = validated_data['task'].title
        entry = super().create(validated_data)
        # update task time_spent_minutes
        if entry.task:
            total = sum(t.duration_seconds for t in entry.task.time_entries.all())
            entry.task.time_spent_minutes = round(total / 60)
            entry.task.save(update_fields=['time_spent_minutes'])
        return entry

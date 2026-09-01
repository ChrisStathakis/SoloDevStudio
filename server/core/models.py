import uuid
from django.db import models
from django.contrib.auth.models import AbstractUser
from django.core.validators import MinValueValidator, MaxValueValidator
from django.conf import settings


# Choices mirroring frontend/src/types.ts
class ProjectStage(models.TextChoices):
    IDEATION = 'ideation', 'Ideation'
    PLANNING = 'planning', 'Planning'
    ARCHITECTURE = 'architecture', 'Design & Arch'
    DEVELOPMENT = 'development', 'Development'
    TESTING = 'testing', 'Testing & QA'
    DEPLOYMENT = 'deployment', 'Deployment'
    LIVE = 'live', 'Live & Shipped'


class InitializationTool(models.TextChoices):
    OPENCODE = 'opencode', 'OpenCode'
    CODEX = 'codex', 'Codex'


class ReasoningEffort(models.TextChoices):
    LOW = 'low', 'Low'
    MEDIUM = 'medium', 'Medium'
    HIGH = 'high', 'High'


class InitializationMode(models.TextChoices):
    BUILD = 'build', 'Build'
    PLAN = 'plan', 'Plan'


class AppCategory(models.TextChoices):
    WEB_SAAS = 'Web App / SaaS', 'Web App / SaaS'
    MOBILE = 'Mobile App', 'Mobile App'
    CHROME_EXT = 'Chrome Extension', 'Chrome Extension'
    DEV_TOOL = 'Developer Tool / CLI', 'Developer Tool / CLI'
    OSS_LIB = 'Open Source Library', 'Open Source Library'
    AI_ML = 'AI / ML Tool', 'AI / ML Tool'
    DESKTOP = 'Desktop App', 'Desktop App'
    PORTFOLIO = 'Portfolio / Website', 'Portfolio / Website'


class IdeaCategory(models.Model):
    """A shared, settings-managed category for idea records."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=50, unique=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class PriorityQuadrant(models.TextChoices):
    Q1_DO = 'q1_do', 'Do First'
    Q2_SCHEDULE = 'q2_schedule', 'Schedule & Deep Work'
    Q3_DELEGATE = 'q3_delegate', 'Quick Wins / Streamline'
    Q4_ELIMINATE = 'q4_eliminate', 'Backlog & Evaluate'


class TaskCategory(models.TextChoices):
    GENERAL = 'general', 'General'
    FEATURE = 'feature', 'Feature'
    BUG = 'bug', 'Bug'
    CHORE = 'chore', 'Chore'
    IMPROVEMENT = 'improvement', 'Improvement'


class IdeaStatus(models.TextChoices):
    SPARK = 'spark', 'Spark'
    EVALUATING = 'evaluating', 'Evaluating'
    VALIDATED = 'validated', 'Validated'
    CONVERTED = 'converted', 'Converted'
    ARCHIVED = 'archived', 'Archived'


class TimeMode(models.TextChoices):
    POMODORO = 'pomodoro', 'Pomodoro'
    STOPWATCH = 'stopwatch', 'Stopwatch'
    MANUAL = 'manual', 'Manual'


class User(AbstractUser):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, blank=False)
    potential_projects_root = models.CharField(max_length=500, blank=True, default='')

    class Meta:
        ordering = ['-date_joined']

    def __str__(self):
        return self.username or self.email


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='projects')
    title = models.CharField(max_length=300)
    tagline = models.CharField(max_length=500, blank=True, default='')
    description = models.TextField(blank=True, default='')
    # Structured product brief fields carried over from a Spark when it is
    # converted into a project.  Keep these separate from description so the
    # original problem/solution and planning inputs remain addressable.
    problem = models.TextField(blank=True, default='')
    solution = models.TextField(blank=True, default='')
    target_audience = models.TextField(blank=True, default='')
    monetization = models.TextField(blank=True, default='')
    mvp_features = models.JSONField(default=list, blank=True)
    tags = models.JSONField(default=list, blank=True)
    category = models.CharField(max_length=50, choices=AppCategory.choices, default=AppCategory.WEB_SAAS)
    current_stage = models.CharField(max_length=20, choices=ProjectStage.choices, default=ProjectStage.IDEATION)
    target_deadline = models.DateField()
    start_date = models.DateField()
    actual_launch_date = models.DateField(null=True, blank=True)
    color = models.CharField(max_length=7, default='#6366f1')
    tech_stack = models.JSONField(default=list, blank=True)
    repo_url = models.URLField(blank=True, default='')
    live_url = models.URLField(blank=True, default='')
    figma_url = models.URLField(blank=True, default='')
    directory_path = models.CharField(max_length=500, blank=True, default='')
    script_path = models.CharField(max_length=500, blank=True, default='')
    cmd_directory = models.CharField(max_length=500, blank=True, default='')
    port = models.CharField(max_length=200, blank=True, default='', help_text='Optional port / run args passed to script_path, e.g. "8001" or "--port 8001". Blank = no args.')
    python_env = models.CharField(max_length=500, blank=True, default='', help_text='Optional virtualenv folder. Auto-activates in the in-app terminal and is used for script runs (resolves Scripts/activate.bat and Scripts/python.exe).')
    drive = models.CharField(max_length=2, blank=True, default='', choices=[('C', 'C:'), ('D', 'D:'), ('E', 'E:'), ('F', 'F:'), ('G', 'G:'), ('H', 'H:')], help_text="Drive letter for this project's paths (useful when the project lives on a USB drive that gets a different letter on another PC). Changing it remaps cmd_directory/script_path/directory_path.")
    notes = models.TextField(blank=True, default='')
    initialization_tool = models.CharField(max_length=20, choices=InitializationTool.choices, default=InitializationTool.OPENCODE)
    initialization_model = models.CharField(max_length=200, blank=True, default='')
    initialization_reasoning_effort = models.CharField(max_length=10, choices=ReasoningEffort.choices, default=ReasoningEffort.MEDIUM)
    initialization_mode = models.CharField(max_length=10, choices=InitializationMode.choices, default=InitializationMode.BUILD)
    pinned = models.BooleanField(default=False)
    tech_research = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['owner', 'current_stage']),
            models.Index(fields=['owner', 'pinned']),
        ]

    def __str__(self):
        return self.title


class ProjectLaunchPrompt(models.Model):
    """The initial coding-agent brief generated when an idea becomes a project."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.OneToOneField(Project, on_delete=models.CASCADE, related_name='launch_prompt')
    content = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Launch prompt: {self.project.title}"


class LauncherModelPreset(models.Model):
    """A user-managed launch configuration for a local coding CLI."""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='launcher_model_presets')
    tool = models.CharField(max_length=20, choices=InitializationTool.choices)
    model_id = models.CharField(max_length=200)
    reasoning_effort = models.CharField(max_length=10, choices=ReasoningEffort.choices, default=ReasoningEffort.MEDIUM)
    mode = models.CharField(max_length=10, choices=InitializationMode.choices, default=InitializationMode.BUILD)
    label = models.CharField(max_length=200)
    enabled = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['tool', 'label', 'model_id']
        constraints = [
            models.UniqueConstraint(fields=['owner', 'tool', 'label'], name='unique_launcher_model_preset_name'),
        ]

    def __str__(self):
        return self.label or self.model_id


class Milestone(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='milestones')
    title = models.CharField(max_length=400)
    stage = models.CharField(max_length=20, choices=ProjectStage.choices, default=ProjectStage.PLANNING)
    target_date = models.DateField()
    completed = models.BooleanField(default=False)
    description = models.TextField(blank=True, default='')
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'target_date', 'created_at']

    def __str__(self):
        return f"{self.title} ({self.project.title})"


class Task(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='tasks')
    milestones = models.ManyToManyField(Milestone, blank=True, related_name='tasks')
    title = models.CharField(max_length=400)
    description = models.TextField(blank=True, default='')
    stage = models.CharField(max_length=20, choices=ProjectStage.choices, default=ProjectStage.DEVELOPMENT)
    quadrant = models.CharField(max_length=20, choices=PriorityQuadrant.choices, default=PriorityQuadrant.Q1_DO)
    category = models.CharField(max_length=20, choices=TaskCategory.choices, default=TaskCategory.FEATURE)
    completed = models.BooleanField(default=False)
    due_date = models.DateField(null=True, blank=True)
    estimated_minutes = models.PositiveIntegerField(null=True, blank=True)
    time_spent_minutes = models.PositiveIntegerField(default=0)
    tags = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['project', 'completed']),
            models.Index(fields=['project', 'quadrant']),
            models.Index(fields=['project', 'category']),
        ]

    def __str__(self):
        return self.title


class Subtask(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='subtasks')
    title = models.CharField(max_length=400)
    completed = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'created_at']

    def __str__(self):
        return self.title


class Idea(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='ideas')
    title = models.CharField(max_length=400)
    tagline = models.CharField(max_length=500, blank=True, default='')
    problem = models.TextField(blank=True, default='')
    solution = models.TextField(blank=True, default='')
    notes = models.TextField(blank=True, default='')
    category = models.ForeignKey(IdeaCategory, on_delete=models.PROTECT, related_name='ideas')
    status = models.CharField(max_length=20, choices=IdeaStatus.choices, default=IdeaStatus.SPARK)
    sketch_data_url = models.TextField(null=True, blank=True)
    sketch_objects = models.JSONField(default=list, blank=True, null=True)
    target_audience = models.TextField(blank=True, default='')
    monetization = models.TextField(blank=True, default='')
    mvp_features = models.JSONField(default=list, blank=True)
    tags = models.JSONField(default=list, blank=True)
    converted_project = models.ForeignKey(Project, on_delete=models.SET_NULL, null=True, blank=True, related_name='converted_from_ideas')
    market_research = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['owner', 'status']),
        ]

    def __str__(self):
        return self.title


class AgentFilter(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=100, unique=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['order', 'name']

    def __str__(self):
        return self.name


class ProjectDoc(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='project_docs')
    projects = models.ManyToManyField(Project, blank=True, through='ProjectAgentLink', related_name='docs')
    filter = models.ForeignKey(AgentFilter, null=True, blank=True, on_delete=models.SET_NULL, related_name='docs')
    title = models.CharField(max_length=400)
    content = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        indexes = [
            models.Index(fields=['owner', 'updated_at']),
            models.Index(fields=['owner', 'filter']),
        ]

    def __str__(self):
        return self.title


class ProjectAgentLink(models.Model):
    """A project-scoped link to a reusable Agent document."""
    id = models.BigAutoField(primary_key=True)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='agent_links')
    agent = models.ForeignKey(ProjectDoc, on_delete=models.CASCADE, related_name='project_links')
    active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['project', 'agent'], name='unique_project_agent_link'),
        ]
        indexes = [
            models.Index(fields=['project', 'active']),
        ]


class TimeEntry(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='time_entries')
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name='time_entries')
    project_title = models.CharField(max_length=400)
    task = models.ForeignKey(Task, on_delete=models.SET_NULL, null=True, blank=True, related_name='time_entries')
    task_title = models.CharField(max_length=400, blank=True, default='')
    stage = models.CharField(max_length=20, choices=ProjectStage.choices, default=ProjectStage.DEVELOPMENT)
    duration_seconds = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    mode = models.CharField(max_length=20, choices=TimeMode.choices, default=TimeMode.MANUAL)
    notes = models.TextField(blank=True, default='')
    timestamp = models.DateTimeField()

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['owner', 'timestamp']),
            models.Index(fields=['project', 'timestamp']),
            models.Index(fields=['task', 'timestamp']),
        ]

    def __str__(self):
        return f"{self.project_title} - {self.duration_seconds}s"

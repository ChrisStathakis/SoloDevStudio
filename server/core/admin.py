from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import User, Project, ProjectLaunchPrompt, Milestone, Task, Subtask, Idea, TimeEntry, ProjectDoc

@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = ('username', 'email', 'is_staff', 'date_joined')
    search_fields = ('username', 'email')

@admin.register(Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ('title', 'owner', 'category', 'current_stage', 'pinned', 'target_deadline', 'created_at')
    list_filter = ('current_stage', 'category', 'pinned')
    search_fields = ('title', 'tagline', 'description')
    raw_id_fields = ('owner',)

@admin.register(ProjectLaunchPrompt)
class ProjectLaunchPromptAdmin(admin.ModelAdmin):
    list_display = ('project', 'created_at', 'updated_at')
    search_fields = ('project__title', 'content')
    raw_id_fields = ('project',)

@admin.register(Milestone)
class MilestoneAdmin(admin.ModelAdmin):
    list_display = ('title', 'project', 'stage', 'target_date', 'completed', 'order')
    list_filter = ('stage', 'completed')
    raw_id_fields = ('project',)

class SubtaskInline(admin.TabularInline):
    model = Subtask
    extra = 0

@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ('title', 'project', 'stage', 'quadrant', 'category', 'completed', 'due_date', 'created_at')
    list_filter = ('stage', 'quadrant', 'category', 'completed')
    search_fields = ('title', 'description')
    raw_id_fields = ('project',)
    inlines = [SubtaskInline]

@admin.register(Subtask)
class SubtaskAdmin(admin.ModelAdmin):
    list_display = ('title', 'task', 'completed', 'order')
    raw_id_fields = ('task',)

@admin.register(Idea)
class IdeaAdmin(admin.ModelAdmin):
    list_display = ('title', 'owner', 'category', 'status', 'created_at')
    list_filter = ('status', 'category')
    search_fields = ('title', 'tagline', 'problem')
    raw_id_fields = ('owner', 'converted_project')

@admin.register(TimeEntry)
class TimeEntryAdmin(admin.ModelAdmin):
    list_display = ('project_title', 'owner', 'task_title', 'mode', 'duration_seconds', 'timestamp')
    list_filter = ('mode', 'stage')
    raw_id_fields = ('owner', 'project', 'task')

@admin.register(ProjectDoc)
class ProjectDocAdmin(admin.ModelAdmin):
    list_display = ('title', 'owner', 'updated_at')
    search_fields = ('title', 'content')
    raw_id_fields = ('owner',)

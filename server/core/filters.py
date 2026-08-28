import django_filters
from .models import Project, Task, Idea, TimeEntry, ProjectDoc, AgentFilter

class AgentFilterFilterSet(django_filters.FilterSet):
    slug = django_filters.CharFilter(field_name='slug')
    class Meta:
        model = AgentFilter
        fields = ['slug']

class ProjectFilter(django_filters.FilterSet):
    stage = django_filters.CharFilter(field_name='current_stage')
    category = django_filters.CharFilter(field_name='category')
    pinned = django_filters.BooleanFilter(field_name='pinned')
    class Meta:
        model = Project
        fields = ['current_stage', 'category', 'pinned']

class TaskFilter(django_filters.FilterSet):
    projectId = django_filters.UUIDFilter(field_name='project__id')
    project = django_filters.UUIDFilter(field_name='project__id')
    stage = django_filters.CharFilter(field_name='stage')
    quadrant = django_filters.CharFilter(field_name='quadrant')
    category = django_filters.CharFilter(field_name='category')
    completed = django_filters.BooleanFilter(field_name='completed')
    class Meta:
        model = Task
        fields = ['project', 'stage', 'quadrant', 'category', 'completed']

class IdeaFilter(django_filters.FilterSet):
    status = django_filters.CharFilter(field_name='status')
    category = django_filters.CharFilter(field_name='category')
    class Meta:
        model = Idea
        fields = ['status', 'category']

class TimeEntryFilter(django_filters.FilterSet):
    projectId = django_filters.UUIDFilter(field_name='project__id')
    taskId = django_filters.UUIDFilter(field_name='task__id')
    mode = django_filters.CharFilter(field_name='mode')
    stage = django_filters.CharFilter(field_name='stage')
    since = django_filters.DateTimeFilter(field_name='timestamp', lookup_expr='gte')
    until = django_filters.DateTimeFilter(field_name='timestamp', lookup_expr='lte')
    class Meta:
        model = TimeEntry
        fields = ['project', 'task', 'mode', 'stage']

class ProjectDocFilter(django_filters.FilterSet):
    projectId = django_filters.UUIDFilter(field_name='projects__id')
    project = django_filters.UUIDFilter(field_name='projects__id')
    filter = django_filters.UUIDFilter(field_name='filter__id')
    filterSlug = django_filters.CharFilter(field_name='filter__slug')
    search = django_filters.CharFilter(method='filter_search')
    class Meta:
        model = ProjectDoc
        fields = ['project', 'filter', 'filterSlug']

    def filter_search(self, queryset, name, value):
        from django.db.models import Q
        return queryset.filter(Q(title__icontains=value) | Q(content__icontains=value))

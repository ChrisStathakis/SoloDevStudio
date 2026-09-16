from django.urls import path, include
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from .views import (
    health_view, register_view, me_view,
    ProjectViewSet, MilestoneViewSet, TaskViewSet, IdeaViewSet, TimeEntryViewSet,
    ProjectDocViewSet, AgentFilterViewSet, IdeaCategoryViewSet, LauncherModelPresetViewSet,
    export_data_view, import_data_view, reset_workspace_view, dashboard_view, timeline_view,
    cloud_backup_latest_view, cloud_backup_push_view, cloud_backup_restore_view,
    filesystem_browse, project_folder_settings_view, project_drive_settings_view, checklist_defaults_view, checklist_default_stage_view, daily_focus_view,
)
from .terminal_views import (
    create_project_terminal, list_terminals, kill_terminal,
    terminal_input, terminal_output, terminal_resize, adopt_terminal,
)
from .upload_views import upload_image
from .search_views import market_research_view, tech_research_view

router = DefaultRouter()
router.register(r'projects', ProjectViewSet, basename='project')
router.register(r'milestones', MilestoneViewSet, basename='milestone')
router.register(r'tasks', TaskViewSet, basename='task')
router.register(r'ideas', IdeaViewSet, basename='idea')
router.register(r'time-entries', TimeEntryViewSet, basename='timeentry')
router.register(r'docs', ProjectDocViewSet, basename='doc')
router.register(r'agent-filters', AgentFilterViewSet, basename='agent-filter')
router.register(r'idea-categories', IdeaCategoryViewSet, basename='idea-category')
router.register(r'launcher-model-presets', LauncherModelPresetViewSet, basename='launcher-model-preset')

urlpatterns = [
    path('health/', health_view, name='health'),
    path('auth/register/', register_view, name='register'),
    path('auth/login/', TokenObtainPairView.as_view(), name='login'),
    path('auth/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('auth/me/', me_view, name='me'),
    path('export/', export_data_view, name='export'),
    path('import/', import_data_view, name='import_data'),
    path('cloud-backup/latest/', cloud_backup_latest_view, name='cloud-backup-latest'),
    path('cloud-backup/push/', cloud_backup_push_view, name='cloud-backup-push'),
    path('cloud-backup/restore/', cloud_backup_restore_view, name='cloud-backup-restore'),
    path('workspace/reset/', reset_workspace_view, name='workspace-reset'),
    path('dashboard/', dashboard_view, name='dashboard'),
    path('timeline/', timeline_view, name='timeline'),
    path('filesystem/', filesystem_browse, name='filesystem-browse'),
    path('settings/project-folder/', project_folder_settings_view, name='project-folder-settings'),
    path('settings/drive/', project_drive_settings_view, name='project-drive-settings'),
    path('settings/checklist-defaults/', checklist_defaults_view, name='checklist-defaults'),
    path('settings/checklist-defaults/<str:stage>/', checklist_default_stage_view, name='checklist-default-stage'),
    path('daily-focus/', daily_focus_view, name='daily-focus'),
    path('search/market/', market_research_view, name='search-market'),
    path('search/tech-stack/', tech_research_view, name='search-tech-stack'),
    # Pasted-image uploads (consoles consume them as file paths)
    path('uploads/image/', upload_image, name='upload-image'),
    # In-app terminal sessions
    path('terminals/', list_terminals, name='terminal-list'),
    path('terminals/<str:session_id>/output/', terminal_output, name='terminal-output'),
    path('terminals/<str:session_id>/input/', terminal_input, name='terminal-input'),
    path('terminals/<str:session_id>/resize/', terminal_resize, name='terminal-resize'),
    path('terminals/<str:session_id>/adopt/', adopt_terminal, name='terminal-adopt'),
    path('terminals/<str:session_id>/', kill_terminal, name='terminal-kill'),
    path('projects/<uuid:pk>/terminals/', create_project_terminal, name='project-terminal-create'),
    path('', include(router.urls)),
]

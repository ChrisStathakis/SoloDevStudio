from datetime import date, timedelta
from pathlib import Path
import os
import subprocess
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import AgentFilter, DailyFocus, Idea, IdeaCategory, LauncherModelPreset, Milestone, Project, ProjectAgentLink, ProjectDoc, ProjectLaunchPrompt, StageChecklistDefault, StageReview, StageWorkspace, Subtask, Task, TimeEntry, User, OrchestratorRun, OrchestratorStep
from .services.orchestrator import propose_plan, _verification_for
from .services.orchestrator_coordinator import OrchestratorCoordinator, READY_RES, _create_workspace_snapshot
from .services.terminal_manager import _script_uses_detached_start
from .serializers import ProjectSerializer


class ProjectLaunchPromptTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='prompt-owner',
            email='prompt-owner@example.com',
            password='test-password-123',
        )
        self.category = IdeaCategory.objects.get_or_create(name='Web App / SaaS')[0]
        self.idea = Idea.objects.create(
            owner=self.user,
            category=self.category,
            title='Team Notes',
            tagline='Shared notes for small teams',
            problem='Important decisions get lost in chat.',
            solution='A searchable, collaborative decision log.',
            target_audience='Remote product teams',
            monetization='Paid team plans',
            mvp_features=['Create a note', 'Search decisions'],
            notes='Keep the first release deliberately small.',
            tags=['React', 'search'],
            market_research={'marketSummary': 'Growing demand'},
        )

    def test_conversion_creates_and_serializes_prompt(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(f'/api/ideas/{self.idea.pk}/convert/')

        self.assertEqual(response.status_code, 201)
        project = Project.objects.get(pk=response.data['project']['id'])
        prompt = ProjectLaunchPrompt.objects.get(project=project)
        self.assertEqual(response.data['project']['launch_prompt']['content'], prompt.content)
        self.assertEqual(project.problem, self.idea.problem)
        self.assertEqual(project.solution, self.idea.solution)

        self.assertEqual(project.target_audience, self.idea.target_audience)
        self.assertEqual(project.monetization, self.idea.monetization)
        self.assertEqual(project.mvp_features, self.idea.mvp_features)
        self.assertEqual(project.tags, self.idea.tags)
        self.assertEqual(response.data['project']['target_audience'], self.idea.target_audience)
        self.assertEqual(response.data['project']['mvp_features'], self.idea.mvp_features)
        for value in ('Team Notes', 'Important decisions get lost in chat.', 'Create a note', 'Paid team plans', 'Growing demand'):
            self.assertIn(value, prompt.content)
        self.assertNotIn('Evaluation scores', prompt.content)


    def test_projects_without_prompt_expose_null(self):
        project = Project.objects.create(
            owner=self.user,
            title='Manual project',
            target_deadline=date(2026, 12, 1),
            start_date=date(2026, 1, 1),
        )

        self.assertIsNone(ProjectSerializer(project).data['launch_prompt'])

    def test_initialization_endpoints_include_saved_prompt_and_active_skills(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(f'/api/ideas/{self.idea.pk}/convert/')
        self.assertEqual(response.status_code, 201)
        project = Project.objects.get(pk=response.data['project']['id'])
        active_skill = ProjectDoc.objects.create(owner=self.user, title='React conventions', content='Prefer small components.')
        inactive_skill = ProjectDoc.objects.create(owner=self.user, title='Inactive skill', content='Do not include this.')
        ProjectAgentLink.objects.create(project=project, agent=active_skill, active=True)
        ProjectAgentLink.objects.create(project=project, agent=inactive_skill, active=False)
        task = Task.objects.create(project=project, title='Build notes', description='Keep the first slice small.')

        project_prompt = self.client.get(f'/api/projects/{project.pk}/initialize-prompt/')
        self.assertEqual(project_prompt.status_code, 200)
        self.assertIn('Team Notes', project_prompt.data['content'])
        self.assertIn('Prefer small components.', project_prompt.data['content'])
        self.assertNotIn('Do not include this.', project_prompt.data['content'])
        self.assertEqual([skill['title'] for skill in project_prompt.data['active_skills']], ['React conventions'])

        task_prompt = self.client.get(f'/api/tasks/{task.pk}/prompt/')
        self.assertEqual(task_prompt.status_code, 200)
        self.assertIn('Build notes', task_prompt.data['content'])
        self.assertIn('Keep the first slice small.', task_prompt.data['content'])
        self.assertIn('Prefer small components.', task_prompt.data['content'])

    def test_initialization_settings_returns_saved_project_defaults(self):
        project = Project.objects.create(
            owner=self.user,
            title='Saved defaults project',
            target_deadline=date(2026, 12, 1),
            start_date=date(2026, 1, 1),
            initialization_tool='codex',
            initialization_model='gpt-5.6-terra',
            initialization_reasoning_effort='high',
            initialization_mode='plan',
        )
        self.client.force_authenticate(self.user)

        response = self.client.get(f'/api/projects/{project.pk}/initialization-settings/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {
            'tool': 'codex',
            'model_id': 'gpt-5.6-terra',
            'reasoning_effort': 'high',
            'mode': 'plan',
        })

    def test_skill_can_be_added_to_saved_prompt_without_runtime_duplication(self):
        self.client.force_authenticate(self.user)
        response = self.client.post(f'/api/ideas/{self.idea.pk}/convert/')
        project = Project.objects.get(pk=response.data['project']['id'])
        skill = ProjectDoc.objects.create(owner=self.user, title='React conventions', content='Prefer small components.')
        ProjectAgentLink.objects.create(project=project, agent=skill, active=True)

        added = self.client.post(f'/api/projects/{project.pk}/agents/{skill.pk}/add-to-prompt/')
        self.assertEqual(added.status_code, 200)
        self.assertIn('Prefer small components.', added.data['content'])
        self.assertFalse(added.data['already_added'])

        repeated = self.client.post(f'/api/projects/{project.pk}/agents/{skill.pk}/add-to-prompt/')
        self.assertEqual(repeated.status_code, 200)
        self.assertTrue(repeated.data['already_added'])
        self.assertEqual(repeated.data['content'], added.data['content'])

        initialized = self.client.get(f'/api/projects/{project.pk}/initialize-prompt/')
        self.assertEqual(initialized.status_code, 200)
        self.assertEqual(initialized.data['content'].count('Prefer small components.'), 1)

    def test_task_can_be_added_to_saved_prompt_without_runtime_duplication(self):
        project = Project.objects.create(
            owner=self.user,
            title='Task prompt project',
            target_deadline=date(2026, 12, 1),
            start_date=date(2026, 1, 1),
        )
        ProjectLaunchPrompt.objects.create(project=project, content='Base project instructions.')
        task = Task.objects.create(project=project, title='Build dashboard', description='Create the first dashboard view.')
        Subtask.objects.create(task=task, title='Add metrics', completed=True, order=0)
        Subtask.objects.create(task=task, title='Add empty state', order=1)
        self.client.force_authenticate(self.user)

        added = self.client.post(f'/api/tasks/{task.pk}/add-to-prompt/')
        self.assertEqual(added.status_code, 200)
        self.assertFalse(added.data['already_added'])
        self.assertIn('## Task: Build dashboard', added.data['content'])
        self.assertIn('Create the first dashboard view.', added.data['content'])
        self.assertIn('- [x] Add metrics', added.data['content'])
        self.assertIn('- [ ] Add empty state', added.data['content'])

        repeated = self.client.post(f'/api/tasks/{task.pk}/add-to-prompt/')
        self.assertEqual(repeated.status_code, 200)
        self.assertTrue(repeated.data['already_added'])
        self.assertEqual(repeated.data['content'], added.data['content'])


    def test_task_add_to_prompt_requires_saved_project_prompt(self):
        project = Project.objects.create(
            owner=self.user,
            title='Task prompt project without prompt',
            target_deadline=date(2026, 12, 1),
            start_date=date(2026, 1, 1),
        )
        task = Task.objects.create(project=project, title='Build dashboard')
        self.client.force_authenticate(self.user)

        response = self.client.post(f'/api/tasks/{task.pk}/add-to-prompt/')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data['error'], 'Save an initial project prompt before adding a task.')

    def test_task_add_to_prompt_is_private_to_project_owner(self):
        other_user = User.objects.create_user(
            username='other-task-owner',
            email='other-task-owner@example.com',
            password='test-password-123',
        )
        project = Project.objects.create(
            owner=other_user,
            title='Private task prompt project',
            target_deadline=date(2026, 12, 1),
            start_date=date(2026, 1, 1),
        )
        ProjectLaunchPrompt.objects.create(project=project, content='Private instructions.')
        task = Task.objects.create(project=project, title='Private task')
        self.client.force_authenticate(self.user)

        response = self.client.post(f'/api/tasks/{task.pk}/add-to-prompt/')

        self.assertEqual(response.status_code, 404)

    def test_project_updates_accept_spark_fields(self):
        self.client.force_authenticate(self.user)
        project = Project.objects.create(
            owner=self.user,
            title='Editable project',
            target_deadline=date(2026, 12, 1),
            start_date=date(2026, 1, 1),
        )
        response = self.client.patch(
            f'/api/projects/{project.pk}/',
            {
                'problem': 'A clear problem',
                'solution': 'A focused solution',
                'target_audience': 'Small teams',
                'monetization': '$10/month',
                'mvp_features': ['First feature'],
                'tags': ['spark'],
            },
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['mvp_features'], ['First feature'])
        self.assertEqual(response.data['tags'], ['spark'])
        project.refresh_from_db()
        self.assertEqual(project.target_audience, 'Small teams')


    def test_project_updates_accept_opencode_plan_mode(self):
        self.client.force_authenticate(self.user)
        project = Project.objects.create(
            owner=self.user,
            title='Mode validation project',
            target_deadline=date(2026, 12, 1),
            start_date=date(2026, 1, 1),
        )
        response = self.client.patch(
            f'/api/projects/{project.pk}/',
            {'initialization_tool': 'opencode', 'initialization_mode': 'plan'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        project.refresh_from_db()
        self.assertEqual(project.initialization_mode, 'plan')

    def test_initialization_settings_accept_kilo(self):
        self.client.force_authenticate(self.user)
        project = Project.objects.create(
            owner=self.user,
            title='Kilo project',
            target_deadline=date(2026, 12, 1),
            start_date=date(2026, 1, 1),
        )
        response = self.client.patch(
            f'/api/projects/{project.pk}/initialization-settings/',
            {'tool': 'kilo', 'model_id': 'openai/gpt-5', 'reasoning_effort': 'high', 'mode': 'plan'},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['tool'], 'kilo')

    def test_conversion_rolls_back_when_prompt_creation_fails(self):
        self.client.force_authenticate(self.user)
        with patch('core.views.ProjectLaunchPrompt.objects.create', side_effect=RuntimeError('prompt failed')):
            with self.assertRaises(RuntimeError):
                self.client.post(f'/api/ideas/{self.idea.pk}/convert/')

        self.assertEqual(Project.objects.filter(owner=self.user).count(), 0)
        self.assertEqual(ProjectLaunchPrompt.objects.count(), 0)
        self.idea.refresh_from_db()
        self.assertEqual(self.idea.status, 'spark')


class DesktopCorsTests(APITestCase):
    def test_desktop_build_header_is_allowed_by_preflight(self):
        response = self.client.options(
            '/api/auth/login/',
            HTTP_ORIGIN='app://solodev',
            HTTP_ACCESS_CONTROL_REQUEST_METHOD='POST',
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS='content-type,x-solodev-frontend-build',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get('Access-Control-Allow-Origin'), 'app://solodev')
        self.assertIn('x-solodev-frontend-build', response.headers.get('Access-Control-Allow-Headers', '').lower())


class ProjectDriveSettingsTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='drive-owner', email='drive-owner@example.com', password='test-password-123',
        )
        self.other_user = User.objects.create_user(
            username='other-drive-owner', email='other-drive-owner@example.com', password='test-password-123',
        )
        defaults = {'target_deadline': date(2026, 12, 1), 'start_date': date(2026, 1, 1)}
        self.project = Project.objects.create(
            owner=self.user, title='Drive project', drive='D',
            directory_path=r'D:\workspace\app', script_path=r'D:\workspace\app\run.cmd',
            cmd_directory=r'D:\workspace\app', python_env=r'C:\venvs\app', **defaults,
        )
        self.second_project = Project.objects.create(
            owner=self.user, title='Second drive project', drive='C',
            directory_path=r'\\server\share\app', script_path=r'relative\run.cmd', **defaults,
        )
        self.other_project = Project.objects.create(
            owner=self.other_user, title='Other user project', drive='D',
            directory_path=r'D:\private\app', **defaults,
        )
        self.client.force_authenticate(self.user)

    def test_project_detail_drive_update_is_scoped_to_one_project(self):
        response = self.client.patch(f'/api/projects/{self.project.pk}/', {'drive': 'E'}, format='json')

        self.assertEqual(response.status_code, 200)
        self.project.refresh_from_db()
        self.second_project.refresh_from_db()
        self.assertEqual(self.project.drive, 'E')
        self.assertEqual(self.project.directory_path, r'E:\workspace\app')
        self.assertEqual(self.project.script_path, r'E:\workspace\app\run.cmd')
        self.assertEqual(self.project.cmd_directory, r'E:\workspace\app')
        self.assertEqual(self.project.python_env, r'C:\venvs\app')
        self.assertEqual(self.second_project.drive, 'C')

    def test_global_drive_update_remaps_only_owned_projects(self):
        response = self.client.patch('/api/settings/drive/', {'drive': 'F'}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {'drive': 'F', 'updated_count': 2})
        self.project.refresh_from_db()
        self.second_project.refresh_from_db()
        self.other_project.refresh_from_db()
        self.assertEqual(self.project.drive, 'F')
        self.assertEqual(self.project.directory_path, r'F:\workspace\app')
        self.assertEqual(self.project.python_env, r'C:\venvs\app')
        self.assertEqual(self.second_project.drive, 'F')
        self.assertEqual(self.second_project.directory_path, r'\\server\share\app')
        self.assertEqual(self.second_project.script_path, r'relative\run.cmd')
        self.assertEqual(self.other_project.drive, 'D')
        self.assertEqual(self.other_project.directory_path, r'D:\private\app')

    def test_global_drive_update_rejects_invalid_drive(self):
        response = self.client.patch('/api/settings/drive/', {'drive': 'Z'}, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertIn('drive', response.data)

    def test_global_drive_update_is_atomic(self):
        from . import pathutils

        original = pathutils.remap_drive
        calls = {'count': 0}

        def fail_after_first(path, drive):
            calls['count'] += 1
            if calls['count'] == 2:
                raise RuntimeError('simulated remap failure')
            return original(path, drive)

        with patch('server.core.pathutils.remap_drive', side_effect=fail_after_first):
            with self.assertRaises(RuntimeError):
                self.client.patch('/api/settings/drive/', {'drive': 'G'}, format='json')

        self.project.refresh_from_db()
        self.second_project.refresh_from_db()
        self.assertEqual(self.project.drive, 'D')
        self.assertEqual(self.project.directory_path, r'D:\workspace\app')
        self.assertEqual(self.second_project.drive, 'C')


class FilesystemBrowseTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='filesystem-owner',
            email='filesystem-owner@example.com',
            password='test-password-123',
        )
        self.client.force_authenticate(self.user)

    def test_missing_drive_returns_roots_and_warning_without_probing_path(self):
        missing_path = r'E:\projects\potential_projects\rag_systems'
        with patch('core.views._list_drive_roots', return_value=['C:\\', 'D:\\']) as roots:
            with patch('core.views.os.name', 'nt'):
                with patch('core.views.os.path.abspath', return_value=missing_path):
                    with patch('core.views.os.path.exists') as exists:
                        response = self.client.get('/api/filesystem/', {'path': missing_path})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['is_roots'])
        self.assertEqual(response.data['path'], '')
        self.assertIn('E:', response.data['warning'])
        self.assertEqual([entry['path'] for entry in response.data['entries']], ['C:\\', 'D:\\'])
        roots.assert_called_once()
        exists.assert_not_called()

    def test_root_listing_uses_drive_helper(self):
        with patch('core.views._list_drive_roots', return_value=['C:\\']) as roots:
            response = self.client.get('/api/filesystem/', {'path': ''})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['is_roots'])
        self.assertEqual(response.data['entries'][0]['path'], 'C:\\')
        roots.assert_called_once()


class FilesystemMkdirTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='mkdir-owner',
            email='mkdir-owner@example.com',
            password='test-password-123',
        )
        self.client.force_authenticate(self.user)
        self._tmp = TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)

    def test_creates_folder_and_returns_path(self):
        res = self.client.post('/api/filesystem/mkdir/', {'path': self._tmp.name, 'name': 'new-results'}, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertTrue(os.path.isdir(res.data['path']))

    def test_existing_directory_is_idempotent(self):
        target = Path(self._tmp.name) / 'exists'
        target.mkdir()
        res = self.client.post('/api/filesystem/mkdir/', {'path': self._tmp.name, 'name': 'exists'}, format='json')
        self.assertEqual(res.status_code, 201)

    def test_rejects_separators_reserved_and_file_collision(self):
        self.assertEqual(self.client.post('/api/filesystem/mkdir/', {'path': self._tmp.name, 'name': 'a/b'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/filesystem/mkdir/', {'path': self._tmp.name, 'name': 'CON'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/filesystem/mkdir/', {'path': self._tmp.name, 'name': ''}, format='json').status_code, 400)
        clash = Path(self._tmp.name) / 'file.txt'
        clash.write_text('x')
        self.assertEqual(self.client.post('/api/filesystem/mkdir/', {'path': self._tmp.name, 'name': 'file.txt'}, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/filesystem/mkdir/', {'path': str(Path(self._tmp.name) / 'missing-parent'), 'name': 'child'}, format='json').status_code, 400)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        res = self.client.post('/api/filesystem/mkdir/', {'path': self._tmp.name, 'name': 'nope'}, format='json')
        self.assertEqual(res.status_code, 401)


class ProjectDuplicateTests(APITestCase):
    def test_duplicate_uses_requested_title_and_copies_source_folder(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source_dir = root / 'source-project'
            source_dir.mkdir()
            (source_dir / 'README.md').write_text('source project', encoding='utf-8')
            destination_root = root / 'potential-projects'

            user = User.objects.create_user(
                username='duplicate-owner',
                email='duplicate-owner@example.com',
                password='test-password-123',
                potential_projects_root=str(destination_root),
            )
            project = Project.objects.create(
                owner=user,
                title='Original project',
                target_deadline=date(2026, 12, 1),
                start_date=date(2026, 1, 1),
                directory_path=str(source_dir),
            )
            self.client.force_authenticate(user)

            response = self.client.post(
                f'/api/projects/{project.pk}/duplicate/',
                {'title': 'Copied project'},
                format='json',
            )

            self.assertEqual(response.status_code, 201)
            copied = Project.objects.get(pk=response.data['project']['id'])
            self.assertNotEqual(copied.pk, project.pk)
            self.assertEqual(copied.title, 'Copied project')
            self.assertEqual(project.title, 'Original project')
            copied_readme = Path(copied.directory_path) / 'README.md'
            self.assertEqual(copied_readme.read_text(encoding='utf-8'), 'source project')


class ProjectGitTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='git-owner',
            email='git-owner@example.com',
            password='test-password-123',
        )
        self.client.force_authenticate(self.user)

    def _make_project(self, **kwargs):
        defaults = {
            'title': 'Git project',
            'target_deadline': date(2026, 12, 1),
            'start_date': date(2026, 1, 1),
        }
        defaults.update(kwargs)
        return Project.objects.create(owner=self.user, **defaults)

    def test_git_status_reports_missing_repo(self):
        with TemporaryDirectory() as temp_dir:
            project = self._make_project(directory_path=temp_dir)
            response = self.client.get(f'/api/projects/{project.pk}/git-status/')
            self.assertEqual(response.status_code, 200)
            self.assertFalse(response.data['is_repo'])
            self.assertTrue(response.data['has_directory'])

    def test_git_status_reports_branch_and_dirty_files(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            subprocess.run(['git', 'init', '-q'], cwd=root, check=True)
            subprocess.run(['git', 'config', 'user.name', 'Test'], cwd=root, check=True)
            subprocess.run(['git', 'config', 'user.email', 'test@example.com'], cwd=root, check=True)
            (root / 'README.md').write_text('hello', encoding='utf-8')
            project = self._make_project(directory_path=str(root))
            response = self.client.get(f'/api/projects/{project.pk}/git-status/')
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data['is_repo'])
            self.assertEqual(response.data['dirty_count'], 1)
            self.assertTrue(response.data['has_changes'])

    def test_git_clone_rejects_non_github_url(self):
        with TemporaryDirectory() as temp_dir:
            project = self._make_project(
                repo_url='https://example.com/owner/repo.git',
                directory_path=str(Path(temp_dir) / 'dest'),
            )
            response = self.client.post(f'/api/projects/{project.pk}/git-clone/')
            self.assertEqual(response.status_code, 400)
            self.assertIn('github', response.data['error'].lower())

    def test_git_clone_rejects_non_empty_folder(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            (root / 'existing.txt').write_text('data', encoding='utf-8')
            project = self._make_project(
                repo_url='https://github.com/owner/repo.git',
                directory_path=str(root),
            )
            response = self.client.post(f'/api/projects/{project.pk}/git-clone/')
            self.assertEqual(response.status_code, 400)
            self.assertIn('not empty', response.data['error'].lower())

    def test_git_clone_rejects_missing_repo_url(self):
        with TemporaryDirectory() as temp_dir:
            project = self._make_project(directory_path=str(Path(temp_dir) / 'dest'))
            response = self.client.post(f'/api/projects/{project.pk}/git-clone/')
            self.assertEqual(response.status_code, 400)

    def test_git_pull_and_push_require_repo(self):
        with TemporaryDirectory() as temp_dir:
            project = self._make_project(directory_path=temp_dir)
            pull = self.client.post(f'/api/projects/{project.pk}/git-pull/')
            push = self.client.post(f'/api/projects/{project.pk}/git-push/')
            self.assertEqual(pull.status_code, 400)
            self.assertEqual(push.status_code, 400)

    def test_git_pull_reports_git_output(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            subprocess.run(['git', 'init', '-q'], cwd=root, check=True)
            project = self._make_project(directory_path=str(root))
            fake = subprocess.CompletedProcess(
                args=['git', 'pull', '--ff-only'], returncode=0, stdout='Already up to date.', stderr=''
            )
            with patch('core.views._run_git', return_value=fake):
                response = self.client.post(f'/api/projects/{project.pk}/git-pull/')
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.data['ok'])


class ProjectContextTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='context-owner',
            email='context-owner@example.com',
            password='test-password-123',
        )
        self.client.force_authenticate(self.user)

    def _make_project(self, **kwargs):
        defaults = {
            'title': 'Context project',
            'target_deadline': date(2026, 12, 1),
            'start_date': date(2026, 1, 1),
            'current_stage': 'planning',
        }
        defaults.update(kwargs)
        return Project.objects.create(owner=self.user, **defaults)

    def test_context_brief_defaults_to_current_stage(self):
        project = self._make_project()
        response = self.client.get(f'/api/projects/{project.pk}/context-brief/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['stages'], ['planning'])
        self.assertIn('## Phase: planning', response.data['markdown'])

    def test_context_brief_rejects_unknown_stage(self):
        project = self._make_project()
        response = self.client.get(f'/api/projects/{project.pk}/context-brief/', {'stages': 'nope'})
        self.assertEqual(response.status_code, 400)

    def test_context_brief_sections_filter(self):
        project = self._make_project()
        response = self.client.get(
            f'/api/projects/{project.pk}/context-brief/',
            {'stages': 'planning', 'sections': 'git'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['sections'], ['git'])
        self.assertIn('## Git', response.data['markdown'])
        self.assertNotIn('## Phase', response.data['markdown'])

    def test_write_context_file_creates_solodev_files(self):
        with TemporaryDirectory() as temp_dir:
            project = self._make_project(directory_path=temp_dir)
            response = self.client.post(
                f'/api/projects/{project.pk}/write-context-file/',
                {'stages': 'planning', 'sections': 'brief'},
                format='json',
            )
            self.assertEqual(response.status_code, 200)
            self.assertTrue(Path(response.data['context_md']).is_file())
            self.assertTrue(Path(response.data['context_json']).is_file())

    def test_orchestrator_run_with_phases_stores_brief(self):
        project = self._make_project()
        response = self.client.post(
            f'/api/projects/{project.pk}/orchestrator/runs/',
            {'goal': 'Ship the planning milestone', 'phase_mode': 'goal_and_phases',
             'stages': 'planning', 'sections': 'brief,tasks'},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        run = OrchestratorRun.objects.get(pk=response.data['id'])
        self.assertEqual(run.last_event.get('phase_mode'), 'goal_and_phases')
        self.assertEqual(run.last_event.get('phases'), ['planning'])
        self.assertIn('Phase: planning', run.last_event.get('phase_brief') or '')
        step = run.steps.first()
        prompt_response = self.client.get(f'/api/orchestrator/steps/{step.pk}/prompt/')
        self.assertEqual(prompt_response.status_code, 200)
        self.assertIn('Selected phase context', prompt_response.data['content'])

    def test_orchestrator_run_rejects_bad_phase_mode(self):
        project = self._make_project()
        response = self.client.post(
            f'/api/projects/{project.pk}/orchestrator/runs/',
            {'goal': 'Ship the planning milestone', 'phase_mode': 'everything'},
            format='json',
        )
        self.assertEqual(response.status_code, 400)


class ProjectReorderTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='reorder-owner', email='reorder@example.com', password='test-password-123')
        self.client.force_authenticate(self.user)

    def _make_project(self, title, sort_order):
        return Project.objects.create(
            owner=self.user,
            title=title,
            target_deadline=date(2026, 12, 1),
            start_date=date(2026, 1, 1),
            sort_order=sort_order,
        )

    def test_reorder_persists_manual_order(self):
        first = self._make_project('First', 0)
        second = self._make_project('Second', 1)
        third = self._make_project('Third', 2)

        response = self.client.post(
            '/api/projects/reorder/',
            {'ordered_ids': [str(third.pk), str(first.pk), str(second.pk)]},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [str(p.pk) for p in Project.objects.filter(owner=self.user)],
            [str(third.pk), str(first.pk), str(second.pk)],
        )

    def test_reorder_rejects_unknown_ids(self):
        project = self._make_project('Only', 0)
        response = self.client.post(
            '/api/projects/reorder/',
            {'ordered_ids': [str(project.pk), '00000000-0000-0000-0000-000000000000']},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        project.refresh_from_db()
        self.assertEqual(project.sort_order, 0)


class IdeaCategoryTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='category-owner', email='category@example.com', password='test-password-123')
        self.client.force_authenticate(self.user)

    def test_categories_are_seeded_and_custom_categories_are_safe_to_manage(self):
        seeded = self.client.get('/api/idea-categories/')
        self.assertEqual(seeded.status_code, 200)
        self.assertIn('Mobile App', [category['name'] for category in seeded.data])

        created = self.client.post('/api/idea-categories/', {'name': 'Browser Game'})
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.data['name'], 'Browser Game')

        idea = self.client.post('/api/ideas/', {'title': 'Arcade idea', 'category': 'Browser Game'})
        self.assertEqual(idea.status_code, 201)
        self.assertEqual(idea.data['category'], 'Browser Game')

        protected_delete = self.client.delete(f"/api/idea-categories/{created.data['id']}/")
        self.assertEqual(protected_delete.status_code, 409)

        renamed = self.client.patch(f"/api/idea-categories/{created.data['id']}/", {'name': 'Web Game'})
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(self.client.get(f"/api/ideas/{idea.data['id']}/").data['category'], 'Web Game')


class PdfExportTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='pdf-owner', email='pdf@example.com', password='test-password-123')
        self.other_user = User.objects.create_user(username='pdf-other', email='pdf-other@example.com', password='test-password-123')
        self.category = IdeaCategory.objects.get_or_create(name='Web App / SaaS')[0]
        self.project = Project.objects.create(
            owner=self.user,
            title='Printable Project',
            tagline='A report-ready project',
            description='A detailed project description.',
            problem='A clear problem.',
            solution='A focused solution.',
            target_audience='Small teams',
            monetization='Subscription',
            mvp_features=['Export reports'],
            tags=['reports'],
            tech_stack=['Django', 'React'],
            target_deadline=date(2026, 12, 1),
            start_date=date(2026, 1, 1),
        )
        self.milestone = Milestone.objects.create(project=self.project, title='First release', target_date=date(2026, 4, 1))
        self.task = Task.objects.create(project=self.project, title='Build PDF export', description='Make a printable report.')
        Subtask.objects.create(task=self.task, title='Render the layout')
        TimeEntry.objects.create(owner=self.user, project=self.project, task=self.task, project_title=self.project.title, task_title=self.task.title, duration_seconds=1800, timestamp='2026-01-01T12:00:00Z')
        self.idea = Idea.objects.create(
            owner=self.user,
            category=self.category,
            title='Printable Idea',
            problem='Ideas need a shareable format.',
            solution='Generate a PDF.',
            mvp_features=['Download PDF'],
            tags=['pdf'],
            sketch_data_url='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JviIAAAAASUVORK5CYII=',
            market_research={
                'marketSummary': 'There is demand for concise reports.',
                'competitors': [{'name': 'Example', 'description': 'A similar tool.', 'pricing': 'Free', 'differentiationOpportunity': 'Focused project exports.'}],
                'keyRisks': ['Long content'],
                'sources': [{'title': 'Example source', 'url': 'https://example.com'}],
            },
        )
        self.invalid_sketch_idea = Idea.objects.create(
            owner=self.user,
            category=self.category,
            title='Invalid Sketch',
            sketch_data_url='not-a-valid-image',
        )
        self.client.force_authenticate(self.user)

    def assert_pdf(self, response, expected_filename):
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'application/pdf')
        self.assertIn(expected_filename, response['Content-Disposition'])
        self.assertTrue(response.content.startswith(b'%PDF-'))
        self.assertGreater(len(response.content), 1000)

    def test_project_export_is_a_pdf_with_project_data(self):
        response = self.client.get(f'/api/projects/{self.project.pk}/export-pdf/')
        self.assert_pdf(response, 'printable-project-project-brief.pdf')

    def test_idea_export_is_a_pdf_with_a_sketch_and_research(self):
        response = self.client.get(f'/api/ideas/{self.idea.pk}/export-pdf/')
        self.assert_pdf(response, 'printable-idea-idea-brief.pdf')

    def test_idea_export_ignores_invalid_sketch_data(self):
        response = self.client.get(f'/api/ideas/{self.invalid_sketch_idea.pk}/export-pdf/')
        self.assert_pdf(response, 'invalid-sketch-idea-brief.pdf')

    def test_exports_are_private_to_the_owner(self):
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.client.get(f'/api/projects/{self.project.pk}/export-pdf/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/ideas/{self.idea.pk}/export-pdf/').status_code, 404)


class MilestoneTaskLinkTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='milestone-owner', email='milestone@example.com', password='test-password-123')
        self.other_user = User.objects.create_user(username='other-owner', email='other@example.com', password='test-password-123')
        self.project = Project.objects.create(owner=self.user, title='Roadmap', target_deadline=date(2026, 12, 1), start_date=date(2026, 1, 1))
        self.other_project = Project.objects.create(owner=self.other_user, title='Other', target_deadline=date(2026, 12, 1), start_date=date(2026, 1, 1))
        self.first = Milestone.objects.create(project=self.project, title='First', target_date=date(2026, 2, 1))
        self.second = Milestone.objects.create(project=self.project, title='Second', target_date=date(2026, 3, 1))
        self.foreign = Milestone.objects.create(project=self.other_project, title='Foreign', target_date=date(2026, 3, 1))
        self.task = Task.objects.create(project=self.project, title='Build the thing')
        self.client.force_authenticate(self.user)

    def test_task_can_link_to_multiple_milestones(self):
        response = self.client.patch(f'/api/tasks/{self.task.pk}/', {'milestones': [str(self.first.pk), str(self.second.pk)]}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual({str(value) for value in response.data['milestones']}, {str(self.first.pk), str(self.second.pk)})

    def test_cross_project_milestone_is_rejected(self):
        response = self.client.patch(f'/api/tasks/{self.task.pk}/', {'milestones': [str(self.foreign.pk)]}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.task.milestones.count(), 0)

    def test_milestone_task_sync_and_delete_unlink_only(self):
        response = self.client.put(f'/api/milestones/{self.first.pk}/tasks/', {'task_ids': [str(self.task.pk)]}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['task_ids'], [str(self.task.pk)])
        self.client.delete(f'/api/milestones/{self.first.pk}/')
        self.task.refresh_from_db()
        self.assertEqual(self.task.milestones.count(), 0)
        self.assertTrue(Task.objects.filter(pk=self.task.pk).exists())


class ProjectSkillLinkTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='skill-owner', email='skill-owner@example.com', password='test-password-123')
        self.first_project = Project.objects.create(owner=self.user, title='First', target_deadline=date(2026, 12, 1), start_date=date(2026, 1, 1))
        self.second_project = Project.objects.create(owner=self.user, title='Second', target_deadline=date(2026, 12, 1), start_date=date(2026, 1, 1))
        self.skill = ProjectDoc.objects.create(owner=self.user, title='Shared skill', content='Use this skill.')
        ProjectAgentLink.objects.create(project=self.first_project, agent=self.skill)
        ProjectAgentLink.objects.create(project=self.second_project, agent=self.skill)
        self.client.force_authenticate(self.user)

    def test_delete_project_skill_link_preserves_shared_skill(self):
        response = self.client.delete(f'/api/projects/{self.first_project.pk}/agents/{self.skill.pk}/')
        self.assertEqual(response.status_code, 204)
        self.assertFalse(ProjectAgentLink.objects.filter(project=self.first_project, agent=self.skill).exists())
        self.assertTrue(ProjectAgentLink.objects.filter(project=self.second_project, agent=self.skill).exists())
        self.assertTrue(ProjectDoc.objects.filter(pk=self.skill.pk).exists())


class StageWorkspaceTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='workspace-owner', email='workspace-owner@example.com', password='test-password-123')
        self.other_user = User.objects.create_user(username='workspace-other', email='workspace-other@example.com', password='test-password-123')
        self.project = Project.objects.create(owner=self.user, title='Workspace project', target_deadline=date(2026, 12, 1), start_date=date(2026, 1, 1), current_stage='ideation')
        self.client.force_authenticate(self.user)

    def test_empty_workspace_can_be_read_and_saved(self):
        empty = self.client.get(f'/api/projects/{self.project.pk}/stage-workspaces/ideation/')
        self.assertEqual(empty.status_code, 200)
        self.assertEqual(empty.data['notes'], '')
        saved = self.client.patch(f'/api/projects/{self.project.pk}/stage-workspaces/ideation/', {'notes': '# Hypothesis', 'completed_items': ['problem-defined']}, format='json')
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.data['completed_items'], ['problem-defined'])
        self.assertEqual(StageWorkspace.objects.get(project=self.project, stage='ideation').notes, '# Hypothesis')

    def test_stage_and_checklist_validation(self):
        self.assertEqual(self.client.get(f'/api/projects/{self.project.pk}/stage-workspaces/not-a-stage/').status_code, 400)
        invalid = self.client.patch(f'/api/projects/{self.project.pk}/stage-workspaces/ideation/', {'completed_items': ['not-real']}, format='json')
        self.assertEqual(invalid.status_code, 400)

    def test_shaping_checklist_items_save_reload_and_invalid_items_are_rejected(self):
        saved = self.client.patch(
            f'/api/projects/{self.project.pk}/stage-workspaces/development/',
            {'completed_items': ['build-inspect-learn-adjust', 'progress-update']},
            format='json',
        )
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.data['completed_items'], ['build-inspect-learn-adjust', 'progress-update'])
        reloaded = self.client.get(f'/api/projects/{self.project.pk}/stage-workspaces/development/')
        self.assertEqual(reloaded.data['completed_items'], ['build-inspect-learn-adjust', 'progress-update'])
        invalid = self.client.patch(
            f'/api/projects/{self.project.pk}/stage-workspaces/development/',
            {'completed_items': ['shaping-item-does-not-exist']},
            format='json',
        )
        self.assertEqual(invalid.status_code, 400)

    def test_workspace_is_owner_scoped(self):
        self.client.force_authenticate(self.other_user)
        self.assertEqual(self.client.get(f'/api/projects/{self.project.pk}/stage-workspaces/ideation/').status_code, 404)

    def test_each_stage_is_isolated_and_prompt_unchanged(self):
        self.client.patch(f'/api/projects/{self.project.pk}/stage-workspaces/ideation/', {'notes': 'Idea notes'}, format='json')
        self.client.patch(f'/api/projects/{self.project.pk}/stage-workspaces/planning/', {'notes': 'Plan notes'}, format='json')
        self.assertEqual(StageWorkspace.objects.get(project=self.project, stage='ideation').notes, 'Idea notes')
        self.assertEqual(StageWorkspace.objects.get(project=self.project, stage='planning').notes, 'Plan notes')
        ProjectLaunchPrompt.objects.create(project=self.project, content='Base prompt')
        self.assertNotIn('Idea notes', self.client.get(f'/api/projects/{self.project.pk}/initialize-prompt/').data['content'])

    def test_editable_definitions_preserve_only_unchanged_completion(self):
        current = self.client.get(f'/api/projects/{self.project.pk}/stage-workspaces/ideation/').data
        guided = [current['checklist'][0], {'id': 'custom-check', 'label': 'Custom check'}]
        shaped = current['shaping_checklist']
        saved = self.client.patch(f'/api/projects/{self.project.pk}/stage-workspaces/ideation/', {'checklist': guided, 'shaping_checklist': shaped, 'completed_items': [guided[0]['id']]}, format='json')
        self.assertEqual(saved.status_code, 200)
        renamed = self.client.patch(f'/api/projects/{self.project.pk}/stage-workspaces/ideation/', {'checklist': [{'id': guided[0]['id'], 'label': 'Renamed problem'}] + guided[1:]}, format='json')
        self.assertEqual(renamed.status_code, 200)
        self.assertEqual(renamed.data['completed_items'], [])

    def test_defaults_daily_focus_blocker_and_review_are_owner_scoped(self):
        defaults = self.client.patch('/api/settings/checklist-defaults/ideation/', {'checklist': []}, format='json')
        self.assertEqual(defaults.status_code, 200)
        self.assertEqual(defaults.data['checklist'], [])
        self.assertTrue(StageChecklistDefault.objects.filter(owner=self.user, stage='ideation').exists())
        task = Task.objects.create(project=self.project, title='Unblock slice', stage='ideation')
        focus = self.client.patch('/api/daily-focus/', {'day': '2026-09-12', 'task_ids': [str(task.id)]}, format='json')
        self.assertEqual(focus.status_code, 200)
        task.blocker_reason = 'Waiting on evidence'; task.blocker_next_action = 'Run interview'; task.save()
        completed = self.client.post(f'/api/tasks/{task.pk}/toggle-complete/')
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.data['blocker_reason'], '')
        review = self.client.post(f'/api/projects/{self.project.pk}/stage-reviews/ideation/', {'decision': 'continue', 'note': 'Keep validating'}, format='json')
        self.assertEqual(review.status_code, 201)
        self.assertEqual(review.data['review']['decision'], StageReview.CONTINUE)


class LauncherModelPresetTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='preset-owner', email='preset-owner@example.com', password='test-password-123')
        self.other_user = User.objects.create_user(username='preset-other', email='preset-other@example.com', password='test-password-123')
        self.client.force_authenticate(self.user)

    def test_create_list_update_toggle_and_delete_named_preset(self):
        response = self.client.post('/api/launcher-model-presets/', {
            'tool': 'codex', 'model_id': 'gpt-5.6-terra', 'reasoning_effort': 'high', 'mode': 'plan', 'label': 'Deep work', 'enabled': True,
        }, format='json')
        self.assertEqual(response.status_code, 201)
        preset_id = response.data['id']
        self.assertEqual(response.data['label'], 'Deep work')
        self.assertEqual(response.data['reasoning_effort'], 'high')
        self.assertEqual(response.data['mode'], 'plan')

        response = self.client.get('/api/launcher-model-presets/')
        self.assertEqual(response.status_code, 200)
        rows = response.data if isinstance(response.data, list) else response.data['results']
        self.assertEqual(len(rows), 1)

        response = self.client.patch(f'/api/launcher-model-presets/{preset_id}/', {'enabled': False}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data['enabled'])

        response = self.client.delete(f'/api/launcher-model-presets/{preset_id}/')
        self.assertEqual(response.status_code, 204)
        self.assertFalse(LauncherModelPreset.objects.filter(pk=preset_id).exists())

    def test_name_and_effort_are_validated_and_names_are_tool_scoped(self):
        response = self.client.post('/api/launcher-model-presets/', {'tool': 'codex', 'model_id': 'gpt-5.6-terra', 'reasoning_effort': 'fast'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('label', response.data)
        self.assertIn('reasoning_effort', response.data)

        payload = {'tool': 'codex', 'model_id': 'gpt-5.6-terra', 'reasoning_effort': 'medium', 'mode': 'build', 'label': 'Default'}
        self.assertEqual(self.client.post('/api/launcher-model-presets/', payload, format='json').status_code, 201)
        duplicate = self.client.post('/api/launcher-model-presets/', {**payload, 'label': ' default '}, format='json')
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn('label', duplicate.data)

        opencode_same_name = self.client.post('/api/launcher-model-presets/', {**payload, 'tool': 'opencode'}, format='json')
        self.assertEqual(opencode_same_name.status_code, 201)

        opencode_plan = self.client.post('/api/launcher-model-presets/', {**payload, 'tool': 'opencode', 'label': 'Open plan', 'mode': 'plan'}, format='json')
        self.assertEqual(opencode_plan.status_code, 201)
        self.assertEqual(opencode_plan.data['mode'], 'plan')

        kilo_same_name = self.client.post('/api/launcher-model-presets/', {**payload, 'tool': 'kilo'}, format='json')
        self.assertEqual(kilo_same_name.status_code, 201)

    def test_presets_are_private_to_the_owner(self):
        preset = LauncherModelPreset.objects.create(owner=self.other_user, tool='codex', model_id='gpt-5.6-terra', reasoning_effort='medium', label='Other')
        response = self.client.get(f'/api/launcher-model-presets/{preset.pk}/')
        self.assertEqual(response.status_code, 404)


class WorkspaceResetTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='reset-owner', email='reset@example.com', password='test-password-123', potential_projects_root='D:/projects')
        self.other_user = User.objects.create_user(username='reset-other', email='reset-other@example.com', password='test-password-123')
        self.project = Project.objects.create(owner=self.user, title='Reset me', target_deadline=date(2026, 12, 1), start_date=date(2026, 1, 1))
        self.other_project = Project.objects.create(owner=self.other_user, title='Keep me', target_deadline=date(2026, 12, 1), start_date=date(2026, 1, 1))
        self.task = Task.objects.create(project=self.project, title='Reset task')
        self.idea = Idea.objects.create(owner=self.user, title='Reset idea', category=IdeaCategory.objects.get_or_create(name='Web App / SaaS')[0])
        self.skill = ProjectDoc.objects.create(owner=self.user, title='Reset skill')
        ProjectAgentLink.objects.create(project=self.project, agent=self.skill)
        self.preset = LauncherModelPreset.objects.create(owner=self.user, tool='codex', model_id='gpt-5.6-terra', reasoning_effort='medium', label='Reset preset')
        TimeEntry.objects.create(owner=self.user, project=self.project, task=self.task, project_title=self.project.title, task_title=self.task.title, duration_seconds=60, timestamp='2026-01-01T12:00:00Z')
        self.filter = AgentFilter.objects.create(name='Reset filter', slug='reset-filter', order=99)
        self.client.force_authenticate(self.user)

    def test_reset_deletes_all_workspace_data_but_preserves_account_and_shared_filters(self):
        response = self.client.post('/api/workspace/reset/')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['success'])
        self.assertEqual(response.data['deleted']['docs'], 1)
        self.assertEqual(response.data['deleted']['modelPresets'], 1)
        self.assertFalse(Project.objects.filter(owner=self.user).exists())
        self.assertFalse(Task.objects.filter(project__owner=self.user).exists())
        self.assertFalse(Idea.objects.filter(owner=self.user).exists())
        self.assertFalse(TimeEntry.objects.filter(owner=self.user).exists())
        self.assertFalse(ProjectDoc.objects.filter(owner=self.user).exists())
        self.assertFalse(LauncherModelPreset.objects.filter(owner=self.user).exists())
        self.assertTrue(Project.objects.filter(pk=self.other_project.pk).exists())
        self.assertTrue(AgentFilter.objects.filter(pk=self.filter.pk).exists())
        self.user.refresh_from_db()
        self.assertEqual(self.user.potential_projects_root, '')


class TerminalOutputTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='terminal-owner',
            email='terminal-owner@example.com',
            password='test-password-123',
        )
        self.client.force_authenticate(self.user)

    def test_missing_terminal_returns_rendered_ndjson_error(self):
        response = self.client.get(
            '/api/terminals/missing-session/output/?after=0',
            HTTP_ACCEPT='application/x-ndjson',
        )

        self.assertEqual(response.status_code, 404)
        self.assertTrue(response['Content-Type'].startswith('application/x-ndjson'))
        self.assertEqual(response.content, b'{"error":"Terminal session not found."}\n')


class TerminalAdoptTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='adopt-owner',
            email='adopt-owner@example.com',
            password='test-password-123',
        )
        self.other = User.objects.create_user(
            username='adopt-stranger',
            email='adopt-stranger@example.com',
            password='test-password-123',
        )
        self.client.force_authenticate(self.user)
        self.project = Project.objects.create(
            owner=self.user,
            title='Adopt target',
            target_deadline=date(2026, 12, 1),
            start_date=date(2026, 1, 1),
        )
        from unittest.mock import Mock

        from .services.terminal_manager import terminal_manager
        self.manager = terminal_manager
        # In-memory stub session (no PTY required): simulates an orphaned
        # console whose project record is gone.
        self.session = Mock()
        self.session.id = 'adopt-session-1'
        self.session.owner_id = self.user.id
        self.session.project_id = 'deleted-project-id'
        self.session.project_title = 'Ghost project'
        self.session.exited_at = None
        self.session.exit_code = None
        self.session.finalize_if_dead = lambda: None
        self.session.to_dict = lambda: {
            'id': self.session.id,
            'projectId': self.session.project_id,
            'projectTitle': self.session.project_title,
            'mode': 'cmd',
            'title': 'CMD',
            'cwd': '',
            'alive': True,
            'exitedAt': None,
            'exitCode': None,
        }
        self.manager._sessions[self.session.id] = self.session
        self.addCleanup(self.manager._sessions.pop, self.session.id, None)

    def test_adopt_relinks_session_to_owned_project(self):
        response = self.client.post(
            f'/api/terminals/{self.session.id}/adopt/',
            {'project_id': str(self.project.pk)},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['projectId'], str(self.project.pk))
        self.assertEqual(response.data['projectTitle'], 'Adopt target')
        self.assertEqual(self.session.project_id, str(self.project.pk))

    def test_adopt_missing_session_returns_404(self):
        response = self.client.post('/api/terminals/nope/adopt/', {'project_id': str(self.project.pk)}, format='json')

        self.assertEqual(response.status_code, 404)

    def test_adopt_foreign_project_returns_404(self):
        foreign = Project.objects.create(
            owner=self.other,
            title='Not mine',
            target_deadline=date(2026, 12, 1),
            start_date=date(2026, 1, 1),
        )
        response = self.client.post(
            f'/api/terminals/{self.session.id}/adopt/',
            {'project_id': str(foreign.pk)},
            format='json',
        )

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self.session.project_id, 'deleted-project-id')

    def test_adopt_foreign_session_returns_404(self):
        self.client.force_authenticate(self.other)
        response = self.client.post(
            f'/api/terminals/{self.session.id}/adopt/',
            {'project_id': str(self.project.pk)},
            format='json',
        )

        self.assertEqual(response.status_code, 404)

    def test_adopt_exited_session_returns_409(self):
        from django.utils import timezone

        self.session.exited_at = timezone.now()
        response = self.client.post(
            f'/api/terminals/{self.session.id}/adopt/',
            {'project_id': str(self.project.pk)},
            format='json',
        )

        self.assertEqual(response.status_code, 409)


class ImageUploadTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='upload-owner',
            email='upload-owner@example.com',
            password='test-password-123',
        )
        self.client.force_authenticate(self.user)
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def _png(self, name='paste.png'):
        # Minimal valid PNG (1x1 pixel).
        payload = (
            b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01'
            b'\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00'
            b'\x00\x01\x01\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82'
        )
        return SimpleUploadedFile(name, payload, content_type='image/png')

    def _post_image(self, **kwargs):
        db_path = str(Path(self.tmp.name) / 'test.sqlite3')
        with override_settings(DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': db_path}}):
            return self.client.post('/api/uploads/image/', {'image': self._png()}, format='multipart', **kwargs)

    def test_upload_saves_png_next_to_database(self):
        response = self._post_image()

        self.assertEqual(response.status_code, 201)
        saved = Path(response.data['path'])
        self.assertEqual(saved.parent, Path(self.tmp.name) / 'uploads')
        self.assertTrue(saved.suffix == '.png' and saved.exists())

    def test_upload_rejects_non_images(self):
        db_path = str(Path(self.tmp.name) / 'test.sqlite3')
        bad = SimpleUploadedFile('note.txt', b'hello', content_type='text/plain')
        with override_settings(DATABASES={'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': db_path}}):
            response = self.client.post('/api/uploads/image/', {'image': bad}, format='multipart')

        self.assertEqual(response.status_code, 400)

    def test_upload_requires_auth(self):
        self.client.force_authenticate(user=None)
        response = self.client.post('/api/uploads/image/', {'image': self._png()}, format='multipart')

        self.assertIn(response.status_code, (401, 403))


class CloudBackupStrictTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(
            username='alice',
            email='alice@example.com',
            password='test-password-123',
        )
        self.bob = User.objects.create_user(
            username='bob',
            email='bob@example.com',
            password='test-password-123',
        )

    def _payload(self, owner='alice'):
        return {'version': '1.0', 'exportedAt': '2026-09-15T00:00:00+00:00', 'ownerUsername': owner, 'projects': []}

    def test_push_and_meta_include_owner(self):
        self.client.force_authenticate(self.alice)
        response = self.client.post('/api/cloud-backup/push/', self._payload('alice'), format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data.get('ownerUsername'), 'alice')

    def test_users_are_isolated(self):
        self.client.force_authenticate(self.alice)
        self.client.post('/api/cloud-backup/push/', self._payload('alice'), format='json')
        self.client.force_authenticate(self.bob)
        latest = self.client.get('/api/cloud-backup/latest/', {'meta': 1})
        self.assertEqual(latest.data, {'exists': False})
        restore = self.client.post('/api/cloud-backup/restore/')
        self.assertEqual(restore.status_code, 404)

    def test_push_rejects_other_username(self):
        self.client.force_authenticate(self.bob)
        response = self.client.post('/api/cloud-backup/push/', self._payload('alice'), format='json')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data.get('code'), 'USER_MISMATCH')

    def test_push_rejects_local_header_mismatch(self):
        self.client.force_authenticate(self.alice)
        response = self.client.post(
            '/api/cloud-backup/push/', self._payload('alice'), format='json',
            HTTP_X_LOCAL_USERNAME='bob',
        )
        self.assertEqual(response.status_code, 403)


class OrchestratorPlanningTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='orch-owner', password='test-password-123')
        self.project = Project.objects.create(owner=self.user, title='Django monitor', target_deadline=date(2026, 12, 1), start_date=date(2026, 1, 1))

    def test_planner_does_not_inject_unrelated_open_tasks(self):
        plan = propose_plan(
            goal='Create a dashboard for price alerts', project=self.project,
            open_tasks=[{'id': '1', 'title': 'Create MkDocs documentation', 'category': 'chore'}],
            active_skills=[], mvp_features=['Dashboard', 'Price alert'],
        )
        titles = [item['title'] for item in plan]
        self.assertNotIn('Create MkDocs documentation', titles)
        self.assertTrue(any('dashboard' in title.lower() for title in titles))

    def test_dispatch_requires_plan_approval(self):
        self.client.force_authenticate(self.user)
        created = self.client.post(f'/api/projects/{self.project.pk}/orchestrator/runs/', {'goal': 'Build dashboard'})
        self.assertEqual(created.status_code, 201)
        step_id = created.data['steps'][0]['id']
        response = self.client.post(f'/api/orchestrator/steps/{step_id}/action/', {'op': 'dispatch'})
        self.assertEqual(response.status_code, 409)

    def test_build_mismatch_blocks_plan_approval(self):
        self.client.force_authenticate(self.user)
        created = self.client.post(f'/api/projects/{self.project.pk}/orchestrator/runs/', {'goal': 'Build dashboard'})
        response = self.client.post(
            f"/api/orchestrator/runs/{created.data['id']}/approve-plan/",
            HTTP_X_SOLODEV_FRONTEND_BUILD='different-build',
        )
        self.assertEqual(response.status_code, 409)
        self.assertIn('build IDs', response.data['error'])

    def test_plan_can_be_edited_before_approval(self):
        self.client.force_authenticate(self.user)
        created = self.client.post(f'/api/projects/{self.project.pk}/orchestrator/runs/', {'goal': 'Build dashboard'})
        run_id = created.data['id']
        response = self.client.patch(f'/api/orchestrator/runs/{run_id}/plan/', {'steps': [
            {'title': 'Create dashboard model', 'instructions': 'Add the model and migration.', 'dependencies': [], 'verification_command': 'python manage.py test'}
        ]}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['steps'][0]['title'], 'Create dashboard model')

    def test_cancelled_run_rejects_step_requeue(self):
        self.client.force_authenticate(self.user)
        created = self.client.post(f'/api/projects/{self.project.pk}/orchestrator/runs/', {'goal': 'Build dashboard'})
        run_id = created.data['id']
        step_id = created.data['steps'][0]['id']
        cancelled = self.client.post(f'/api/orchestrator/runs/{run_id}/cancel/')
        self.assertEqual(cancelled.status_code, 200)
        response = self.client.post(f'/api/orchestrator/steps/{step_id}/action/', {'op': 'retry'})
        self.assertEqual(response.status_code, 409)

    def test_coordinator_lease_blocks_other_process_and_allows_expiry(self):
        run = OrchestratorRun.objects.create(project=self.project, goal='Lease test', status=OrchestratorRun.RUNNING)
        coordinator = OrchestratorCoordinator()
        self.assertTrue(coordinator._claim_lease(run.id))
        other = OrchestratorCoordinator()
        self.assertFalse(other._claim_lease(run.id))
        run.refresh_from_db()
        run.coordinator_heartbeat = run.coordinator_heartbeat.replace(year=2020)
        run.save(update_fields=['coordinator_heartbeat'])
        self.assertTrue(other._claim_lease(run.id))

    def test_clear_previous_plans_preserves_newest_and_stops_old_active_terminal(self):
        self.client.force_authenticate(self.user)
        old = OrchestratorRun.objects.create(project=self.project, goal='Old plan', status=OrchestratorRun.RUNNING)
        old.created_at = timezone.now() - timedelta(minutes=1)
        old.save(update_fields=['created_at'])
        OrchestratorStep.objects.create(
            run=old, title='Old active step', status=OrchestratorStep.RUNNING, terminal_id='old-terminal'
        )
        newest = OrchestratorRun.objects.create(project=self.project, goal='Newest plan', status=OrchestratorRun.CANCELLED)
        with patch('core.orchestrator_views.terminal_manager.remove_for_user') as remove:
            response = self.client.delete(f'/api/projects/{self.project.pk}/orchestrator/runs/previous/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['deleted_count'], 1)
        self.assertEqual(response.data['preserved_run_id'], str(newest.id))
        self.assertTrue(OrchestratorRun.objects.filter(pk=newest.pk).exists())
        self.assertFalse(OrchestratorRun.objects.filter(pk=old.pk).exists())
        remove.assert_called_once_with('old-terminal', self.user.id)

        repeated = self.client.delete(f'/api/projects/{self.project.pk}/orchestrator/runs/previous/')
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.data['deleted_count'], 0)
        self.assertEqual(repeated.data['preserved_run_id'], str(newest.id))

    def test_skipped_step_stays_skipped_when_plan_is_approved(self):
        self.client.force_authenticate(self.user)
        created = self.client.post(f'/api/projects/{self.project.pk}/orchestrator/runs/', {'goal': 'Build dashboard'})
        run_id = created.data['id']
        step_id = created.data['steps'][0]['id']
        skipped = self.client.post(f'/api/orchestrator/steps/{step_id}/action/', {'op': 'skip'})
        self.assertEqual(skipped.status_code, 200)
        with patch('core.services.orchestrator_coordinator.coordinator.kick'):
            approved = self.client.post(f'/api/orchestrator/runs/{run_id}/approve-plan/')
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.data['steps'][0]['status'], OrchestratorStep.SKIPPED)

    def test_coordinator_exception_pauses_run_with_diagnostic(self):
        run = OrchestratorRun.objects.create(project=self.project, goal='Failure test', status=OrchestratorRun.RUNNING)
        coordinator = OrchestratorCoordinator()
        coordinator._pause_after_error(run.id, self.user.id, RuntimeError('git unavailable'))
        run.refresh_from_db()
        self.assertEqual(run.status, OrchestratorRun.PAUSED)
        self.assertIn('git unavailable', run.failure_reason)

    def test_nested_django_project_gets_django_verification(self):
        with TemporaryDirectory() as root:
            Path(root, 'website').mkdir()
            Path(root, 'website', 'manage.py').write_text('')
            self.project.directory_path = root
            self.assertEqual(_verification_for(self.project), 'python website/manage.py test')


class OrchestratorDeliveryTests(TestCase):
    class FakeSession:
        def __init__(self):
            self.writes = []
            self.output = 0

        def write(self, data):
            self.writes.append(data)
            if data == '\r':
                self.output += 1

        def stats(self):
            return self.output, 0

    def test_prompt_paste_ends_before_separate_enter(self):
        session = self.FakeSession()
        OrchestratorCoordinator._submit_prompt(session, 'step instructions', None)
        self.assertEqual(session.writes[0], '\x1b[200~')
        self.assertEqual(session.writes[-1], '\r')
        self.assertEqual(session.writes[-2], '\x1b[201~')
        self.assertNotIn('\x1b[201~\r', session.writes)

    def test_opencode_minimal_composer_is_a_ready_signal(self):
        self.assertTrue(any(pattern.search('Ask anything… "What is the tech stack?"') for pattern in READY_RES))

    def test_detached_batch_launcher_is_detected(self):
        with TemporaryDirectory() as root:
            script = Path(root, 'start_server.bat')
            script.write_text('@echo off\nstart "Django" cmd /k "python manage.py runserver"\n')
            self.assertTrue(_script_uses_detached_start(str(script)))
            script.write_text('@echo off\npython manage.py runserver\n')
            self.assertFalse(_script_uses_detached_start(str(script)))

    def test_dirty_workspace_snapshot_preserves_index_and_worktree(self):
        with TemporaryDirectory() as root:
            def git(*args, input_text=None):
                return subprocess.run(
                    ['git', '-C', root, *args], input=input_text, text=True,
                    capture_output=True, check=True,
                )

            git('init', '-q')
            git('config', 'user.name', 'Test User')
            git('config', 'user.email', 'test@example.com')
            Path(root, 'tracked.txt').write_text('base\n')
            git('add', 'tracked.txt')
            git('commit', '-qm', 'initial')
            Path(root, 'tracked.txt').write_text('staged\n')
            git('add', 'tracked.txt')
            Path(root, 'tracked.txt').write_text('staged then edited\n')
            Path(root, 'untracked.txt').write_text('new\n')

            head_before = git('rev-parse', 'HEAD').stdout.strip()
            cached_before = git('diff', '--cached', '--name-only').stdout.splitlines()
            worktree_before = git('diff', '--name-only').stdout.splitlines()
            head, snapshot, _fingerprint, dirty_files, _index_fingerprint = _create_workspace_snapshot(root, 'dirty test')

            self.assertEqual(head, head_before)
            self.assertIn('tracked.txt', dirty_files)
            self.assertIn('untracked.txt', dirty_files)
            self.assertEqual(cached_before, git('diff', '--cached', '--name-only').stdout.splitlines())
            self.assertEqual(worktree_before, git('diff', '--name-only').stdout.splitlines())
            files = git('ls-tree', '-r', '--name-only', snapshot).stdout.splitlines()
            self.assertIn('tracked.txt', files)
            self.assertIn('untracked.txt', files)


class CronJobTests(APITestCase):
    def setUp(self):
        from .models import CronJob
        self.CronJob = CronJob
        self.user = User.objects.create_user(
            username='cron-owner', email='cron-owner@example.com', password='test-password-123',
        )
        self._tmp = TemporaryDirectory()
        self.workdir = self._tmp.name
        self.client.force_authenticate(self.user)

    def tearDown(self):
        self._tmp.cleanup()

    def _make_job(self, **kwargs):
        defaults = {
            'owner': self.user, 'name': 'Daily news',
            'working_directory': self.workdir,
            'tool': 'opencode', 'prompt_template': 'Find videogame news from the last 24h.',
            'schedule_kind': 'daily', 'schedule_value': '09:00',
        }
        defaults.update(kwargs)
        return self.CronJob.objects.create(**defaults)

    def _job_payload(self, **kwargs):
        payload = {
            'name': 'Daily news', 'working_directory': self.workdir, 'tool': 'opencode',
            'prompt_template': 'Find videogame news from the last 24h.',
            'schedule_kind': 'daily', 'schedule_value': '09:00',
            'timeout_minutes': 15, 'enabled': True, 'notify_mode': 'on_alert',
        }
        payload.update(kwargs)
        return payload

    def test_schedule_helpers(self):
        from .services.cron_schedule import compute_next_run
        now = timezone.now()
        nxt = compute_next_run('daily', '09:00', from_dt=now)
        self.assertGreater(nxt, now)
        self.assertEqual((nxt.hour, nxt.minute), (9, 0))
        nxt2 = compute_next_run('every_hours', '6', from_dt=now)
        self.assertAlmostEqual((nxt2 - now).total_seconds(), 6 * 3600, delta=5)
        nxt3 = compute_next_run('cron', '30 8 * * *', from_dt=now)
        self.assertEqual((nxt3.hour, nxt3.minute), (8, 30))

    def test_crud_sets_next_run_and_syncs_windows_task(self):
        with patch('core.cron_views.windows_tasks.sync_job_task', return_value={'synced': False}) as sync:
            response = self.client.post('/api/cron-jobs/', self._job_payload(), format='json')
        self.assertEqual(response.status_code, 201)
        self.assertIsNotNone(response.data['next_run_at'])
        sync.assert_called_once()
        job_id = response.data['id']
        listed = self.client.get('/api/cron-jobs/')
        rows = listed.data['results'] if isinstance(listed.data, dict) else listed.data
        self.assertEqual(len(rows), 1)
        patched = self.client.patch(f'/api/cron-jobs/{job_id}/', {'schedule_value': '10:30'}, format='json')
        self.assertEqual(patched.status_code, 200)
        with patch('core.cron_views.windows_tasks.delete_job_task', return_value={'deleted': True}):
            deleted = self.client.delete(f'/api/cron-jobs/{job_id}/')
        self.assertEqual(deleted.status_code, 204)

    def test_validation_rejects_short_prompt_and_bad_timeout(self):
        bad_prompt = self.client.post('/api/cron-jobs/', self._job_payload(prompt_template='short'), format='json')
        self.assertEqual(bad_prompt.status_code, 400)
        bad_timeout = self.client.post('/api/cron-jobs/', self._job_payload(timeout_minutes=500), format='json')
        self.assertEqual(bad_timeout.status_code, 400)
        with TemporaryDirectory() as tmp:
            file_path = str(Path(tmp) / 'not-a-dir.txt')
            Path(file_path).write_text('x')
            bad_dir = self.client.post('/api/cron-jobs/', self._job_payload(working_directory=file_path), format='json')
            self.assertEqual(bad_dir.status_code, 400)
        missing_dir = self.client.post('/api/cron-jobs/', self._job_payload(working_directory=''), format='json')
        self.assertEqual(missing_dir.status_code, 400)

    def test_create_makes_missing_working_directory(self):
        with TemporaryDirectory() as tmp:
            target = str(Path(tmp) / 'nested' / 'automation-dir')
            with patch('core.cron_views.windows_tasks.sync_job_task', return_value={'synced': False}):
                response = self.client.post('/api/cron-jobs/', self._job_payload(working_directory=target), format='json')
            self.assertEqual(response.status_code, 201)
            self.assertTrue(Path(target).is_dir())

    def test_run_history_crud(self):
        from .models import CronRun
        job = self._make_job()
        run = CronRun.objects.create(job=job, status=CronRun.PASSED, output_tail='ok')
        history = self.client.get(f'/api/cron-jobs/{job.pk}/runs/')
        self.assertEqual(history.status_code, 200)
        self.assertEqual(len(history.data), 1)
        self.assertEqual(self.client.get(f'/api/cron-runs/{run.pk}/').status_code, 200)
        cleared = self.client.post(f'/api/cron-jobs/{job.pk}/clear-runs/')
        self.assertEqual(cleared.data['deleted_count'], 1)
        self.assertEqual(self.client.get(f'/api/cron-runs/{run.pk}/').status_code, 404)

    def test_run_now_returns_202(self):
        job = self._make_job()
        with patch('core.cron_views.windows_tasks.sync_job_task', return_value={'synced': False}):
            pass
        with patch('core.services.cron_runner.run_job', return_value=None):
            response = self.client.post(f'/api/cron-jobs/{job.pk}/run-now/', {}, format='json')
        self.assertEqual(response.status_code, 202)

    def test_run_job_success_parses_cron_result(self):
        from .models import CronRun
        from .services import cron_runner

        chunks = [
            'composer ready — ask anything, type / for commands',
            '',
            'done. CRON_RESULT: {"status":"done","summary":"3 news items","alert":true}',
        ]

        class FakeSession:
            def __init__(self):
                self.id = 'sess1'
                self.mode = ''
                self.title = ''
                self._counter = 0
                self._calls = 0

            def stats(self):
                return (self._counter, 0)

            def write(self, data):
                self._counter += len(str(data))

            def is_alive(self):
                return True

            def read_since(self, offset):
                idx = self._calls
                self._calls += 1
                text = chunks[idx] if idx < len(chunks) else chunks[-1]
                self._counter += len(text)
                return (False, text, self._counter, False)

        job = self._make_job(tool='codex')
        with patch('core.services.cron_runner.terminal_manager') as tm, \
             patch.object(cron_runner.agent_launcher, 'wait_for_ready', return_value='ready'), \
             patch.object(cron_runner.agent_launcher, 'submit_prompt', return_value=None), \
             patch('core.services.cron_runner._send_notification', return_value=True):
            tm.create_cmd.return_value = FakeSession()
            tm.remove_for_user.return_value = None
            run = cron_runner.run_job(str(job.pk), trigger='manual')
        self.assertIsNotNone(run)
        self.assertEqual(run.status, CronRun.PASSED)
        _, kwargs = tm.create_cmd.call_args
        self.assertEqual(kwargs.get('directory'), self.workdir)
        self.assertEqual(kwargs.get('owner_id'), self.user.id)
        self.assertTrue(run.structured_result.get('alert'))
        self.assertTrue(run.notified)
        job.refresh_from_db()
        self.assertEqual(job.last_status, CronRun.PASSED)
        self.assertIsNotNone(job.next_run_at)

    def test_run_job_trust_gate_needs_attention(self):
        from .models import CronRun
        from .services import cron_runner

        class FakeSession:
            id = 'sess2'
            mode = ''
            title = ''

            def write(self, data):
                return None

            def is_alive(self):
                return True

        job = self._make_job(tool='codex')
        with patch('core.services.cron_runner.terminal_manager') as tm, \
             patch.object(cron_runner.agent_launcher, 'wait_for_ready', return_value='trust'), \
             patch('core.services.cron_runner._send_notification', return_value=False):
            tm.create_cmd.return_value = FakeSession()
            tm.remove_for_user.return_value = None
            run = cron_runner.run_job(str(job.pk), trigger='manual')
        self.assertEqual(run.status, CronRun.NEEDS_ATTENTION)

    def test_run_job_skipped_when_lease_held(self):
        from .services import cron_runner
        job = self._make_job()
        with patch.object(cron_runner, '_claim', return_value=None):
            self.assertIsNone(cron_runner.run_job(str(job.pk)))

    def test_opencode_model_resolution(self):
        from .services import opencode_models as om
        items = ['opencode/muse-spark-1.3-contributor-free', 'opencode-go/deepseek-v4-flash']
        resolved, err = om.resolve_from_items('muse-spark-1.3-contributor-free', items)
        self.assertEqual(resolved, 'opencode/muse-spark-1.3-contributor-free')
        self.assertIsNone(err)
        resolved, err = om.resolve_from_items('opencode/muse-spark-1.3-contributor-free', items)
        self.assertEqual(resolved, 'opencode/muse-spark-1.3-contributor-free')
        self.assertIsNone(err)
        resolved, err = om.resolve_from_items('custom/my-model', items)
        self.assertEqual(resolved, 'custom/my-model')
        self.assertIsNone(err)
        resolved, err = om.resolve_from_items('Hy3 Free', items)
        self.assertEqual(resolved, '')
        self.assertIn('Unknown opencode model', err)
        resolved, err = om.resolve_from_items('', items)
        self.assertEqual(resolved, '')
        self.assertIsNone(err)

    def test_headless_command_has_exit_markers(self):
        from .services import agent_launcher
        cmd = agent_launcher.headless_command(agent='build', message='Do it.')
        self.assertIn('SOLODEV_CRON_EXIT_0', cmd)
        self.assertIn('SOLODEV_CRON_EXIT_1', cmd)

    def test_headless_run_fails_fast_on_unknown_model(self):
        from .models import CronRun
        from .services import cron_runner
        job = self._make_job(tool='opencode', model_id='nope-bare-slug-xyz')
        items = ['opencode/muse-spark-1.3-contributor-free']
        with patch('core.services.opencode_models.list_models', return_value=items), \
             patch('core.services.cron_runner.terminal_manager') as tm, \
             patch('core.services.cron_runner._send_notification', return_value=False):
            run = cron_runner.run_job(str(job.pk), trigger='manual')
        self.assertEqual(run.status, CronRun.FAILED)
        self.assertIn('Unknown opencode model', run.failure_reason)
        tm.create_cmd.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.last_status, CronRun.FAILED)

    def test_headless_run_fast_fail_on_process_error(self):
        from .models import CronRun
        from .services import cron_runner
        transcript = (
            'C:\\projects\\automations>opencode run --model "prov/model" --agent plan --auto\n'
            'Error: Invalid model reference: prov/model\n'
            'SOLODEV_CRON_EXIT_1\n'
        )

        class FakeSession:
            id = 'sess-fastfail'
            mode = ''
            title = ''

            def write(self, data):
                return None

            def is_alive(self):
                return True

            def read_since(self, offset):
                return (False, transcript, len(transcript), False)

        job = self._make_job(tool='opencode', model_id='prov/model')
        with patch('core.services.cron_runner.terminal_manager') as tm, \
             patch('core.services.cron_runner._send_notification', return_value=False):
            tm.create_cmd.return_value = FakeSession()
            tm.remove_for_user.return_value = None
            run = cron_runner.run_job(str(job.pk), trigger='manual')
        self.assertEqual(run.status, CronRun.FAILED)
        self.assertIn('Invalid model reference', run.failure_reason)
        self.assertIn('Invalid model reference', run.output_tail)
        job.refresh_from_db()
        self.assertEqual(job.last_status, CronRun.FAILED)

    def test_exit_markers_ignore_command_echo(self):
        from .services import agent_launcher
        echo_only = ('C:\\projects\\automations>opencode run --model "m" --agent plan --auto '
                     '&& echo SOLODEV_CRON_EXIT_0 || echo SOLODEV_CRON_EXIT_1\n')
        self.assertIsNone(agent_launcher.EXIT_OK_RE.search(echo_only))
        self.assertIsNone(agent_launcher.EXIT_FAIL_RE.search(echo_only))
        self.assertIsNotNone(agent_launcher.EXIT_OK_RE.search(
            'agent output\nC:\\WINDOWS\\system32\\cmd.exeSOLODEV_CRON_EXIT_0 C:\\projects\\automations> '))
        self.assertIsNotNone(agent_launcher.EXIT_FAIL_RE.search(
            'Error: Invalid model reference: x\nSOLODEV_CRON_EXIT_1\n'))

    def test_headless_ignores_echoed_markers_until_real_exit(self):
        from .models import CronRun
        from .services import cron_runner
        echo = ('C:\\projects\\automations>opencode run --model "opencode/m" --agent plan --auto '
                '&& echo SOLODEV_CRON_EXIT_0 || echo SOLODEV_CRON_EXIT_1\n')
        working = echo + '> plan · muse-spark\nFinding the latest videogame news.\n'
        done = (working
                + 'CRON_RESULT: {"status":"done","summary":"3 news items","alert":false}\n'
                + 'C:\\WINDOWS\\system32\\cmd.exeSOLODEV_CRON_EXIT_0 C:\\projects\\automations> ')
        reads = [echo, working, done]

        class FakeSession:
            id = 'sess-echo'
            mode = ''
            title = ''

            def __init__(self):
                self._calls = 0

            def write(self, data):
                return None

            def is_alive(self):
                return True

            def read_since(self, offset):
                text = reads[min(self._calls, len(reads) - 1)]
                self._calls += 1
                return (False, text, len(text), False)

        job = self._make_job(tool='opencode', model_id='prov/model')
        with patch('core.services.cron_runner.terminal_manager') as tm, \
             patch('core.services.cron_runner._send_notification', return_value=False):
            tm.create_cmd.return_value = FakeSession()
            tm.remove_for_user.return_value = None
            run = cron_runner.run_job(str(job.pk), trigger='manual')
        self.assertEqual(run.status, CronRun.PASSED)
        self.assertEqual(run.structured_result.get('summary'), '3 news items')
        job.refresh_from_db()
        self.assertEqual(job.last_status, CronRun.PASSED)

    def test_run_now_disabled_returns_409(self):
        from .models import CronRun
        job = self._make_job()
        job.enabled = False
        job.save(update_fields=['enabled'])
        with patch('core.services.cron_runner.run_job') as run_job:
            response = self.client.post(f'/api/cron-jobs/{job.pk}/run-now/', {}, format='json')
        self.assertEqual(response.status_code, 409)
        self.assertIn('disabled', response.data['detail'].lower())
        run_job.assert_not_called()
        self.assertFalse(CronRun.objects.filter(job=job).exists())

    def test_bare_slug_normalized_on_create(self):
        items = ['opencode/muse-spark-1.3-contributor-free']
        with patch('core.services.opencode_models.list_models', return_value=items), \
             patch('core.cron_views.windows_tasks.sync_job_task', return_value={'synced': False}):
            response = self.client.post(
                '/api/cron-jobs/',
                self._job_payload(model_id='muse-spark-1.3-contributor-free'), format='json')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['model_id'], 'opencode/muse-spark-1.3-contributor-free')

    def test_finished_run_writes_result_file(self):
        from .models import CronRun
        from .services import cron_runner
        transcript = 'agent working...\nCRON_RESULT: {"status":"done","summary":"3 news items","alert":true}\n'

        class FakeSession:
            id = 'sess-report'
            mode = ''
            title = ''

            def write(self, data):
                return None

            def is_alive(self):
                return True

            def read_since(self, offset):
                return (False, transcript, len(transcript), False)

        job = self._make_job(tool='opencode', model_id='prov/model')
        with patch('core.services.cron_runner.terminal_manager') as tm, \
             patch('core.services.cron_runner._send_notification', return_value=False):
            tm.create_cmd.return_value = FakeSession()
            tm.remove_for_user.return_value = None
            run = cron_runner.run_job(str(job.pk), trigger='manual')
        self.assertEqual(run.status, CronRun.PASSED)
        reports = sorted(Path(self.workdir, 'results').glob('*.md'))
        self.assertEqual(len(reports), 1)
        body = reports[0].read_text(encoding='utf-8')
        self.assertIn('3 news items', body)
        self.assertIn('passed', body)

    def test_failed_run_writes_result_file(self):
        from .models import CronRun
        from .services import cron_runner
        job = self._make_job(tool='opencode', model_id='nope-bare-slug-xyz')
        with patch('core.services.opencode_models.list_models', return_value=['opencode/known-model']), \
             patch('core.services.cron_runner.terminal_manager'), \
             patch('core.services.cron_runner._send_notification', return_value=False):
            run = cron_runner.run_job(str(job.pk), trigger='manual')
        self.assertEqual(run.status, CronRun.FAILED)
        reports = sorted(Path(self.workdir, 'results').glob('*.md'))
        self.assertEqual(len(reports), 1)
        self.assertIn('Unknown opencode model', reports[0].read_text(encoding='utf-8'))

    def test_prompt_footer_asks_for_results_file(self):
        from .services import cron_runner
        job = self._make_job()
        prompt = cron_runner._build_prompt(job)
        self.assertIn('CRON_RESULT', prompt)
        self.assertIn('results', prompt)

    def test_files_navigation_and_traversal_rejected(self):
        job = self._make_job()
        subdir = Path(self.workdir, 'results')
        subdir.mkdir(exist_ok=True)
        Path(subdir, 'report.md').write_text('# Report\n', encoding='utf-8')
        listed = self.client.get(f'/api/cron-jobs/{job.pk}/files/')
        self.assertEqual(listed.data['current'], '')
        self.assertIsNone(listed.data['parent'])
        inside = self.client.get(f'/api/cron-jobs/{job.pk}/files/', {'path': 'results'})
        self.assertEqual(inside.status_code, 200)
        self.assertEqual(inside.data['current'], 'results')
        self.assertIsNone(inside.data['parent'])
        self.assertEqual([e['name'] for e in inside.data['files']], ['report.md'])
        traversal = self.client.get(f'/api/cron-jobs/{job.pk}/files/', {'path': '../..'})
        self.assertEqual(traversal.status_code, 400)
        not_a_folder = self.client.get(f'/api/cron-jobs/{job.pk}/files/', {'path': 'results/report.md'})
        self.assertEqual(not_a_folder.status_code, 400)

    def test_automation_files_and_preview(self):
        from .models import CronRun
        from django.utils import timezone
        job = self._make_job()
        fresh = Path(self.workdir, 'news.md')
        fresh.write_text('# News\n- item one\n', encoding='utf-8')
        old = Path(self.workdir, 'archive.md')
        old.write_text('# Old\n', encoding='utf-8')
        two_days_ago = timezone.now().timestamp() - 2 * 86400
        os.utime(old, (two_days_ago, two_days_ago))
        run = CronRun.objects.create(
            job=job, status=CronRun.PASSED,
            started_at=timezone.now() - timedelta(minutes=5),
            finished_at=timezone.now(),
            structured_result={'status': 'done', 'summary': '3 news items', 'alert': False},
        )
        listed = self.client.get(f'/api/cron-jobs/{job.pk}/files/', {'run_id': str(run.pk)})
        self.assertEqual(listed.status_code, 200)
        by_name = {entry['name']: entry for entry in listed.data['files']}
        self.assertTrue(by_name['news.md']['changed_in_run'])
        self.assertFalse(by_name['archive.md']['changed_in_run'])
        preview = self.client.get('/api/files/content/', {'path': str(fresh)})
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.data['kind'], 'text')
        self.assertIn('item one', preview.data['content'])
        exe = Path(self.workdir, 'tool.exe')
        exe.write_bytes(b'MZ')
        unsupported = self.client.get('/api/files/content/', {'path': str(exe)})
        self.assertEqual(unsupported.status_code, 415)
        outside = self.client.get('/api/files/content/', {'path': 'C:\\Windows\\System32\\drivers\\etc\\hosts'})
        self.assertIn(outside.status_code, (403, 404))
        missing = self.client.get('/api/files/content/', {'path': str(Path(self.workdir, 'nope.md'))})
        self.assertEqual(missing.status_code, 404)

    def test_open_folder_action(self):
        job = self._make_job()
        with patch('os.startfile', create=True) as opener:
            response = self.client.post(f'/api/cron-jobs/{job.pk}/open-folder/')
        self.assertEqual(response.status_code, 200)
        opener.assert_called_once_with(job.working_directory)
        job.working_directory = str(Path(self.workdir, 'missing-dir'))
        job.save(update_fields=['working_directory'])
        gone = self.client.post(f'/api/cron-jobs/{job.pk}/open-folder/')
        self.assertEqual(gone.status_code, 400)

    def test_opencode_models_endpoint(self):
        with patch('core.services.opencode_models.list_models', return_value=['a/b']) as listed:
            response = self.client.get('/api/opencode-models/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['models'], ['a/b'])
        listed.assert_called_once()

    def test_headless_command_builder(self):
        from .services import agent_launcher
        cmd = agent_launcher.headless_command(model_id='prov/model', agent='build', prompt_file='C:\\tmp\\p.md', message='Do it.', title='Cron News')
        self.assertTrue(cmd.startswith('opencode run'))
        self.assertIn('--model "prov/model"', cmd)
        self.assertIn('--agent build', cmd)
        self.assertIn('--auto', cmd)
        self.assertIn('--file "C:\\tmp\\p.md"', cmd)
        bare = agent_launcher.headless_command(agent='plan', message='Do it.')
        self.assertNotIn('--model', bare)
        self.assertNotIn('--file', bare)

    def test_headless_run_parses_cron_result_without_composer(self):
        from .models import CronRun
        from .services import cron_runner

        transcript = 'agent working...\nCRON_RESULT: {"status":"done","summary":"3 news items","alert":true}\n'

        class FakeSession:
            id = 'sess-headless'
            mode = ''
            title = ''

            def __init__(self):
                self.writes = []

            def write(self, data):
                self.writes.append(data)

            def is_alive(self):
                return True

            def read_since(self, offset):
                return (False, transcript, len(transcript), False)

        job = self._make_job(tool='opencode', model_id='prov/model')
        with patch('core.services.cron_runner.terminal_manager') as tm, \
             patch.object(cron_runner.agent_launcher, 'wait_for_ready', side_effect=AssertionError('TUI path must not run')), \
             patch.object(cron_runner.agent_launcher, 'submit_prompt', side_effect=AssertionError('TUI path must not run')), \
             patch('core.services.cron_runner._send_notification', return_value=True):
            tm.create_cmd.return_value = FakeSession()
            tm.remove_for_user.return_value = None
            run = cron_runner.run_job(str(job.pk), trigger='manual')
        self.assertEqual(run.status, CronRun.PASSED)
        self.assertTrue(run.structured_result.get('alert'))
        self.assertTrue(run.notified)
        sent = ' '.join(tm.create_cmd.return_value.writes)
        self.assertIn('opencode run', sent)
        self.assertIn('--auto', sent)
        job.refresh_from_db()
        self.assertEqual(job.last_status, CronRun.PASSED)

    def test_export_includes_cron_jobs(self):
        self._make_job(name='Export job')
        response = self.client.get('/api/export/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['cronJobs']), 1)
        self.assertEqual(response.data['cronJobs'][0]['name'], 'Export job')

    def test_opencode_launches_plain_tui_without_agent_flags(self):
        from .services import agent_launcher
        self.assertEqual(agent_launcher.cli_command(tool='opencode', model_id='gpt-x', mode='build'), 'opencode')
        codex_cmd = agent_launcher.cli_command(tool='codex', model_id='gpt-5', mode='plan')
        self.assertIn('--sandbox read-only', codex_cmd)
        kilo_cmd = agent_launcher.cli_command(tool='kilo', model_id='m', mode='plan')
        self.assertIn('--agent plan', kilo_cmd)

    def test_composer_timeout_saves_terminal_tail(self):
        from .services import cron_runner

        class FakeSession:
            id = 'sess-timeout'
            mode = ''
            title = ''

            def write(self, data):
                return None

            def is_alive(self):
                return True

            def read_since(self, offset):
                return (False, 'opencode v2 booting… waiting', 32, False)

        job = self._make_job(tool='codex')
        with patch('core.services.cron_runner.terminal_manager') as tm, \
             patch.object(cron_runner.agent_launcher, 'wait_for_ready', return_value='timeout'), \
             patch('core.services.cron_runner._send_notification', return_value=False):
            tm.create_cmd.return_value = FakeSession()
            tm.remove_for_user.return_value = None
            run = cron_runner.run_job(str(job.pk), trigger='manual')
        self.assertEqual(run.status, 'failed')
        self.assertIn('composer', run.failure_reason)
        self.assertIn('booting', run.output_tail)

    def test_submit_prompt_falls_back_to_plain_text(self):
        from .services import agent_launcher
        from .services.terminal_manager import TerminalError

        class FakeSession:
            def __init__(self):
                self.writes = []

            def write(self, data):
                self.writes.append(data)

            def stats(self):
                return 0, 0

        session = FakeSession()
        with patch.object(agent_launcher.time, 'sleep', return_value=None), \
             patch.object(agent_launcher, '_wait_for_output_growth', side_effect=[False, False, True]):
            agent_launcher.submit_prompt(session, 'plain fallback prompt', settle_seconds=0)
        self.assertIn('\x1b[200~', session.writes)
        self.assertIn('plain fallback prompt', session.writes)

    def test_submit_prompt_raises_after_all_attempts(self):
        from .services import agent_launcher
        from .services.terminal_manager import TerminalError

        class FakeSession:
            def write(self, data):
                return None

            def stats(self):
                return 0, 0

        with patch.object(agent_launcher.time, 'sleep', return_value=None), \
             patch.object(agent_launcher, '_wait_for_output_growth', return_value=False):
            with self.assertRaises(TerminalError):
                agent_launcher.submit_prompt(session=FakeSession(), prompt='never accepted', settle_seconds=0)


class AutomationPromptTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='prompt-owner', email='prompt-owner@example.com', password='test-password-123',
        )
        self.other = User.objects.create_user(
            username='prompt-other', email='prompt-other@example.com', password='test-password-123',
        )
        self.client.force_authenticate(self.user)

    def test_crud_and_owner_isolation(self):
        created = self.client.post('/api/automation-prompts/', {
            'title': 'Price watch', 'content': 'Check these shops for price drops and report.',
        }, format='json')
        self.assertEqual(created.status_code, 201)
        prompt_id = created.data['id']
        listed = self.client.get('/api/automation-prompts/')
        rows = listed.data['results'] if isinstance(listed.data, dict) else listed.data
        self.assertEqual(len(rows), 1)
        # Other user sees nothing and cannot access the row.
        self.client.force_authenticate(self.other)
        other_listed = self.client.get('/api/automation-prompts/')
        other_rows = other_listed.data['results'] if isinstance(other_listed.data, dict) else other_listed.data
        self.assertEqual(len(other_rows), 0)
        self.assertEqual(self.client.get(f'/api/automation-prompts/{prompt_id}/').status_code, 404)
        # Owner can update + search + delete.
        self.client.force_authenticate(self.user)
        patched = self.client.patch(f'/api/automation-prompts/{prompt_id}/', {'title': 'Price watch v2'}, format='json')
        self.assertEqual(patched.status_code, 200)
        searched = self.client.get('/api/automation-prompts/', {'search': 'v2'})
        search_rows = searched.data['results'] if isinstance(searched.data, dict) else searched.data
        self.assertEqual(len(search_rows), 1)
        self.assertEqual(self.client.delete(f'/api/automation-prompts/{prompt_id}/').status_code, 204)

    def test_validation_rejects_short_title_and_content(self):
        self.assertEqual(self.client.post('/api/automation-prompts/', {
            'title': 'ab', 'content': 'Check these shops for price drops and report.',
        }, format='json').status_code, 400)
        self.assertEqual(self.client.post('/api/automation-prompts/', {
            'title': 'Valid title', 'content': 'short',
        }, format='json').status_code, 400)

    def test_export_import_roundtrip(self):
        self.client.post('/api/automation-prompts/', {
            'title': 'Export me', 'content': 'Exported prompt content for automations.',
        }, format='json')
        exported = self.client.get('/api/export/')
        self.assertEqual(exported.status_code, 200)
        self.assertEqual(len(exported.data['automationPrompts']), 1)
        self.client.delete(f"/api/automation-prompts/{exported.data['automationPrompts'][0]['id']}/")
        imported = self.client.post('/api/import/', {
            'automationPrompts': [{'title': 'Export me', 'content': 'Exported prompt content for automations.'}],
        }, format='json')
        self.assertEqual(imported.status_code, 200)
        self.assertEqual(imported.data['imported']['automationPrompts'], 1)


class AutomationFolderSettingsTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='auto-folder-owner', email='auto-folder@example.com', password='test-password-123',
        )
        self._tmp = TemporaryDirectory()
        self.client.force_authenticate(self.user)

    def tearDown(self):
        self._tmp.cleanup()

    def test_get_returns_app_default_when_unset(self):
        res = self.client.get('/api/settings/automation-folder/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data['path'], '')
        self.assertTrue(res.data['effective_path'])
        self.assertFalse(res.data['is_custom'])

    def test_patch_save_and_reset(self):
        target = self._tmp.name
        saved = self.client.patch('/api/settings/automation-folder/', {'path': target}, format='json')
        self.assertEqual(saved.status_code, 200)
        self.assertEqual(saved.data['path'], target)
        self.assertTrue(saved.data['is_custom'])
        # Non-absolute rejected; file path rejected.
        self.assertEqual(self.client.patch('/api/settings/automation-folder/', {'path': 'relative/dir'}, format='json').status_code, 400)
        reset = self.client.delete('/api/settings/automation-folder/')
        self.assertEqual(reset.status_code, 200)
        self.assertEqual(reset.data['path'], '')
        self.assertFalse(reset.data['is_custom'])

    def test_patch_creates_missing_directory(self):
        target = str(Path(self._tmp.name) / 'nested' / 'results')
        self.assertFalse(os.path.exists(target))
        saved = self.client.patch('/api/settings/automation-folder/', {'path': target}, format='json')
        self.assertEqual(saved.status_code, 200)
        self.assertTrue(os.path.isdir(target))

    def test_export_import_roundtrip(self):
        self.client.patch('/api/settings/automation-folder/', {'path': self._tmp.name}, format='json')
        exported = self.client.get('/api/export/')
        self.assertEqual(exported.data['settings']['automationResultsRoot'], self._tmp.name)
        self.client.delete('/api/settings/automation-folder/')
        imported = self.client.post('/api/import/', {
            'settings': {'automationResultsRoot': self._tmp.name},
        }, format='json')
        self.assertEqual(imported.data['imported']['settings'], 1)
        self.user.refresh_from_db()
        self.assertEqual(self.user.automation_results_root, self._tmp.name)

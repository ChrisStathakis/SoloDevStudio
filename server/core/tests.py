from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from rest_framework.test import APITestCase

from .models import AgentFilter, Idea, IdeaCategory, LauncherModelPreset, Milestone, Project, ProjectAgentLink, ProjectDoc, ProjectLaunchPrompt, Subtask, Task, TimeEntry, User
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


    def test_project_updates_reject_opencode_plan_mode(self):
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
        self.assertEqual(response.status_code, 400)
        self.assertIn('initialization_mode', response.data)

    def test_conversion_rolls_back_when_prompt_creation_fails(self):
        self.client.force_authenticate(self.user)
        with patch('core.views.ProjectLaunchPrompt.objects.create', side_effect=RuntimeError('prompt failed')):
            with self.assertRaises(RuntimeError):
                self.client.post(f'/api/ideas/{self.idea.pk}/convert/')

        self.assertEqual(Project.objects.filter(owner=self.user).count(), 0)
        self.assertEqual(ProjectLaunchPrompt.objects.count(), 0)
        self.idea.refresh_from_db()
        self.assertEqual(self.idea.status, 'spark')


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
        self.assertEqual(opencode_plan.status_code, 400)
        self.assertIn('mode', opencode_plan.data)

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

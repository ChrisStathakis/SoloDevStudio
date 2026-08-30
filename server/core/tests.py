from datetime import date
from unittest.mock import patch

from rest_framework.test import APITestCase

from .models import Idea, LauncherModelPreset, Milestone, Project, ProjectAgentLink, ProjectDoc, ProjectLaunchPrompt, Task, User
from .serializers import ProjectSerializer


class ProjectLaunchPromptTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='prompt-owner',
            email='prompt-owner@example.com',
            password='test-password-123',
        )
        self.idea = Idea.objects.create(
            owner=self.user,
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

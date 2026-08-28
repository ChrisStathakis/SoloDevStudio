from datetime import date
from unittest.mock import patch

from rest_framework.test import APITestCase

from .models import Idea, Milestone, Project, ProjectLaunchPrompt, Task, User
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

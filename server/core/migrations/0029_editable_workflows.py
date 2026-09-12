from django.db import migrations, models
import django.db.models.deletion
import uuid


LEGACY_CHECKLISTS = {
    'ideation': [('problem-defined', 'Problem statement is clear'), ('audience-defined', 'Target audience is identified'), ('assumptions-recorded', 'Key assumptions are recorded'), ('evidence-collected', 'Validation evidence is captured'), ('go-no-go', 'Go / no-go criteria are defined')],
    'planning': [('mvp-scope', 'MVP scope and non-goals are agreed'), ('requirements', 'Core requirements are captured'), ('estimates', 'Work is estimated'), ('dependencies-risks', 'Dependencies and risks are recorded'), ('milestones', 'Milestones are defined')],
    'architecture': [('ux-flows', 'UX flows are mapped'), ('data-model', 'Data model is defined'), ('interfaces', 'Interfaces and APIs are documented'), ('decisions', 'Architecture decisions are recorded'), ('constraints', 'Security and performance constraints are listed')],
    'development': [('setup', 'Development setup is verified'), ('slices', 'Implementation is split into deliverable slices'), ('blockers', 'Blockers and tradeoffs are tracked'), ('quality', 'Code quality checks are running'), ('documentation', 'Technical documentation is kept current')],
    'testing': [('critical-paths', 'Critical paths have coverage'), ('regression', 'Regression checks are complete'), ('accessibility', 'Responsive and accessibility checks are complete'), ('bugs', 'Bugs are triaged'), ('release-criteria', 'Release criteria are met')],
    'deployment': [('environment', 'Deployment environment is configured'), ('secrets', 'Secrets and configuration are verified'), ('backup-migration', 'Backups and migrations are ready'), ('cicd', 'CI/CD path is verified'), ('monitoring-rollback', 'Monitoring and rollback are ready'), ('release-notes', 'Release notes are prepared')],
    'live': [('health', 'Health and usage metrics are reviewed'), ('feedback', 'User feedback is captured'), ('incidents', 'Incidents are recorded and reviewed'), ('maintenance', 'Maintenance work is planned'), ('improvements', 'Improvement backlog is prioritized'), ('retrospective', 'A release retrospective is captured')],
}
LEGACY_SHAPING = {
    'ideation': [('riskiest-assumption', 'Riskiest assumption is identified'), ('validation-decision', 'Proceed, revise, or stop decision is recorded')],
    'planning': [('success-outcome', 'Measurable success outcome is defined'), ('smallest-useful-delivery', 'Smallest useful delivery is chosen'), ('priority-tradeoffs', 'Priority tradeoffs are explained')],
    'architecture': [('user-journey-review', 'Approach is reviewed against a core user journey'), ('approach-rationale', 'Chosen approach and rationale are recorded')],
    'development': [('build-inspect-learn-adjust', 'Build → inspect → learn → adjust cycle is applied'), ('blocker-next-action', 'Each blocker has a concrete next action'), ('progress-update', 'Brief progress update is recorded')],
    'testing': [('outcome-comparison', 'Working product is compared with the intended outcome'), ('release-rework-decision', 'Release or rework decision is recorded')],
    'deployment': [('user-update-support', 'User-facing update and support instructions are prepared'), ('release-check-owner', 'Post-release check and owner are identified')],
    'live': [('feedback-outcome-review', 'Feedback is reviewed against the success outcome'), ('next-improvement', 'Next improvement is chosen'), ('build-cycle-lesson', 'Lesson for the next build cycle is captured')],
}
STAGES = tuple(LEGACY_CHECKLISTS)


def as_items(items):
    return [{'id': item_id, 'label': label} for item_id, label in items]


def backfill_workspace_definitions(apps, schema_editor):
    Project = apps.get_model('core', 'Project')
    Workspace = apps.get_model('core', 'StageWorkspace')
    for project in Project.objects.all().iterator():
        for stage in STAGES:
            workspace, _created = Workspace.objects.get_or_create(
                project_id=project.id,
                stage=stage,
                defaults={
                    'checklist': as_items(LEGACY_CHECKLISTS[stage]),
                    'shaping_checklist': as_items(LEGACY_SHAPING[stage]),
                },
            )
            changed = False
            if not workspace.checklist:
                workspace.checklist = as_items(LEGACY_CHECKLISTS[stage])
                changed = True
            if not workspace.shaping_checklist:
                workspace.shaping_checklist = as_items(LEGACY_SHAPING[stage])
                changed = True
            if changed:
                workspace.save(update_fields=['checklist', 'shaping_checklist'])


class Migration(migrations.Migration):
    dependencies = [('core', '0028_project_sort_order')]

    operations = [
        migrations.AddField(model_name='stageworkspace', name='checklist', field=models.JSONField(blank=True, default=list)),
        migrations.AddField(model_name='stageworkspace', name='shaping_checklist', field=models.JSONField(blank=True, default=list)),
        migrations.AddField(model_name='task', name='blocker_next_action', field=models.TextField(blank=True, default='')),
        migrations.AddField(model_name='task', name='blocker_reason', field=models.TextField(blank=True, default='')),
        migrations.CreateModel(
            name='DailyFocus',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('day', models.DateField()),
                ('task_ids', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='daily_focuses', to='core.user')),
            ],
            options={'ordering': ['-day'], 'indexes': [models.Index(fields=['owner', 'day'], name='core_dailyfo_owner_i_5e5e8b_idx')], 'constraints': [models.UniqueConstraint(fields=('owner', 'day'), name='unique_owner_daily_focus')]},
        ),
        migrations.CreateModel(
            name='StageChecklistDefault',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('stage', models.CharField(choices=[('ideation', 'Ideation'), ('planning', 'Planning'), ('architecture', 'Design & Arch'), ('development', 'Development'), ('testing', 'Testing & QA'), ('deployment', 'Deployment'), ('live', 'Live & Shipped')], max_length=20)),
                ('checklist', models.JSONField(blank=True, default=list)),
                ('shaping_checklist', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='stage_checklist_defaults', to='core.user')),
            ],
            options={'ordering': ['stage'], 'indexes': [models.Index(fields=['owner', 'stage'], name='core_stagech_owner_i_7bdb03_idx')], 'constraints': [models.UniqueConstraint(fields=('owner', 'stage'), name='unique_owner_stage_checklist_default')]},
        ),
        migrations.CreateModel(
            name='StageReview',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('stage', models.CharField(choices=[('ideation', 'Ideation'), ('planning', 'Planning'), ('architecture', 'Design & Arch'), ('development', 'Development'), ('testing', 'Testing & QA'), ('deployment', 'Deployment'), ('live', 'Live & Shipped')], max_length=20)),
                ('decision', models.CharField(choices=[('continue', 'Continue working'), ('ready', 'Ready to advance')], max_length=20)),
                ('note', models.TextField(blank=True, default='')),
                ('snapshot', models.JSONField(blank=True, default=dict)),
                ('reviewed_at', models.DateTimeField(auto_now_add=True)),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='stage_reviews', to='core.project')),
            ],
            options={'ordering': ['-reviewed_at'], 'indexes': [models.Index(fields=['project', 'stage', 'reviewed_at'], name='core_stagere_project__6cc5db_idx')]},
        ),
        migrations.RunPython(backfill_workspace_definitions, migrations.RunPython.noop),
    ]

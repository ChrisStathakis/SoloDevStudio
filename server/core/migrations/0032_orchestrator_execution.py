from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0031_orchestrator_runs')]

    operations = [
        migrations.AddField('orchestratorrun', 'integration_branch', models.CharField(blank=True, default='', max_length=240)),
        migrations.AddField('orchestratorrun', 'integration_worktree', models.TextField(blank=True, default='')),
        migrations.AddField('orchestratorrun', 'base_branch', models.CharField(blank=True, default='', max_length=240)),
        migrations.AddField('orchestratorrun', 'autonomous', models.BooleanField(default=True)),
        migrations.AddField('orchestratorrun', 'failure_reason', models.TextField(blank=True, default='')),
        migrations.AddField('orchestratorrun', 'last_event', models.JSONField(blank=True, default=dict)),
        migrations.AddField('orchestratorstep', 'instructions', models.TextField(blank=True, default='')),
        migrations.AddField('orchestratorstep', 'dependencies', models.JSONField(blank=True, default=list)),
        migrations.AddField('orchestratorstep', 'expected_files', models.JSONField(blank=True, default=list)),
        migrations.AddField('orchestratorstep', 'worktree_path', models.TextField(blank=True, default='')),
        migrations.AddField('orchestratorstep', 'branch_name', models.CharField(blank=True, default='', max_length=240)),
        migrations.AddField('orchestratorstep', 'completion_report', models.JSONField(blank=True, default=dict)),
        migrations.AddField('orchestratorstep', 'check_results', models.JSONField(blank=True, default=list)),
        migrations.AddField('orchestratorstep', 'review_status', models.CharField(blank=True, default='', max_length=30)),
        migrations.AddField('orchestratorstep', 'failure_reason', models.TextField(blank=True, default='')),
        migrations.AddField('orchestratorstep', 'started_at', models.DateTimeField(blank=True, null=True)),
        migrations.AddField('orchestratorstep', 'finished_at', models.DateTimeField(blank=True, null=True)),
    ]

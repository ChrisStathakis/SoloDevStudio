from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0034_orchestrator_coordinator_lease')]

    operations = [
        migrations.AddField('orchestratorrun', 'original_head', models.CharField(blank=True, default='', max_length=240)),
        migrations.AddField('orchestratorrun', 'snapshot_commit', models.CharField(blank=True, default='', max_length=240)),
        migrations.AddField('orchestratorrun', 'workspace_fingerprint', models.CharField(blank=True, default='', max_length=128)),
        migrations.AddField('orchestratorrun', 'dirty_files', models.JSONField(blank=True, default=list)),
        migrations.AddField('orchestratorrun', 'snapshot_started_at', models.DateTimeField(blank=True, null=True)),
        migrations.AddField('orchestratorrun', 'snapshot_created_at', models.DateTimeField(blank=True, null=True)),
        migrations.AddField('orchestratorrun', 'snapshot_finished_at', models.DateTimeField(blank=True, null=True)),
    ]

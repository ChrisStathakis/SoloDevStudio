from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0032_orchestrator_execution')]

    operations = [
        migrations.AddField('orchestratorstep', 'launch_phase', models.CharField(blank=True, default='', max_length=40)),
        migrations.AddField('orchestratorstep', 'last_output_at', models.DateTimeField(blank=True, null=True)),
    ]

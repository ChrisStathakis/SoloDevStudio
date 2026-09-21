from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0033_orchestrator_launch_diagnostics')]

    operations = [
        migrations.AddField(
            model_name='orchestratorrun',
            name='coordinator_id',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.AddField(
            model_name='orchestratorrun',
            name='coordinator_heartbeat',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]

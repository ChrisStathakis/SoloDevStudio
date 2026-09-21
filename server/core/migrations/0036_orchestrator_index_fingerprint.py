from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0035_orchestrator_workspace_snapshot')]

    operations = [
        migrations.AddField(
            model_name='orchestratorrun',
            name='index_fingerprint',
            field=models.CharField(blank=True, default='', max_length=128),
        ),
    ]

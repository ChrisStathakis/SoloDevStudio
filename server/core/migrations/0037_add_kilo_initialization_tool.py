from django.db import migrations, models


TOOL_CHOICES = [
    ('opencode', 'OpenCode'),
    ('codex', 'Codex'),
    ('kilo', 'Kilo'),
]


class Migration(migrations.Migration):
    dependencies = [('core', '0036_orchestrator_index_fingerprint')]

    operations = [
        migrations.AlterField(
            model_name='project',
            name='initialization_tool',
            field=models.CharField(choices=TOOL_CHOICES, default='opencode', max_length=20),
        ),
        migrations.AlterField(
            model_name='launchermodelpreset',
            name='tool',
            field=models.CharField(choices=TOOL_CHOICES, max_length=20),
        ),
        migrations.AlterField(
            model_name='orchestratorstep',
            name='tool',
            field=models.CharField(choices=TOOL_CHOICES, default='opencode', max_length=20),
        ),
    ]

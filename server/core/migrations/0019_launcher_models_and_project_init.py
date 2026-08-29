from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):
    dependencies = [('core', '0018_projectagentlink')]

    operations = [
        migrations.AddField(
            model_name='project',
            name='initialization_model',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='project',
            name='initialization_tool',
            field=models.CharField(choices=[('opencode', 'OpenCode'), ('codex', 'Codex')], default='opencode', max_length=20),
        ),
        migrations.CreateModel(
            name='LauncherModelPreset',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('tool', models.CharField(choices=[('opencode', 'OpenCode'), ('codex', 'Codex')], max_length=20)),
                ('model_id', models.CharField(max_length=200)),
                ('label', models.CharField(blank=True, default='', max_length=200)),
                ('enabled', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='launcher_model_presets', to='core.user')),
            ],
            options={'ordering': ['tool', 'label', 'model_id']},
        ),
        migrations.AddConstraint(
            model_name='launchermodelpreset',
            constraint=models.UniqueConstraint(fields=('owner', 'tool', 'model_id'), name='unique_launcher_model_preset'),
        ),
    ]

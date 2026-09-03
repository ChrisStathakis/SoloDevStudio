import uuid

from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('core', '0025_ideacategory')]

    operations = [
        migrations.CreateModel(
            name='StageWorkspace',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('stage', models.CharField(choices=[('ideation', 'Ideation'), ('planning', 'Planning'), ('architecture', 'Design & Arch'), ('development', 'Development'), ('testing', 'Testing & QA'), ('deployment', 'Deployment'), ('live', 'Live & Shipped')], max_length=20)),
                ('notes', models.TextField(blank=True, default='')),
                ('completed_items', models.JSONField(blank=True, default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='stage_workspaces', to='core.project')),
            ],
            options={'ordering': ['stage'], 'indexes': [models.Index(fields=['project', 'stage'], name='core_sw_project_stage_idx')], 'constraints': [models.UniqueConstraint(fields=('project', 'stage'), name='unique_project_stage_workspace')]},
        ),
    ]

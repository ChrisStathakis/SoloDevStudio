from django.db import migrations, models
import django.db.models.deletion


def copy_existing_links(apps, schema_editor):
    ProjectAgentLink = apps.get_model('core', 'ProjectAgentLink')
    connection = schema_editor.connection
    old_table = 'core_projectdoc_projects'
    tables = connection.introspection.table_names()
    if old_table not in tables:
        return
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT projectdoc_id, project_id FROM {old_table}')
        rows = cursor.fetchall()
    ProjectAgentLink.objects.bulk_create(
        [ProjectAgentLink(agent_id=agent_id, project_id=project_id, active=True) for agent_id, project_id in rows],
        ignore_conflicts=True,
    )


class Migration(migrations.Migration):
    dependencies = [('core', '0017_task_milestones')]

    operations = [
        migrations.CreateModel(
            name='ProjectAgentLink',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False)),
                ('active', models.BooleanField(default=True)),
                ('agent', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='project_links', to='core.projectdoc')),
                ('project', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='agent_links', to='core.project')),
            ],
            options={
                'constraints': [models.UniqueConstraint(fields=('project', 'agent'), name='unique_project_agent_link')],
                'indexes': [models.Index(fields=('project', 'active'), name='core_projec_project_1cedfd_idx')],
            },
        ),
        migrations.RunPython(copy_existing_links, migrations.RunPython.noop),
        migrations.SeparateDatabaseAndState(
            state_operations=[migrations.AlterField(
                model_name='projectdoc',
                name='projects',
                field=models.ManyToManyField(blank=True, related_name='docs', through='core.ProjectAgentLink', to='core.project'),
            )],
        ),
    ]

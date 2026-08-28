from django.db import migrations


FILTERS = [
    ('Backend', 'backend', 1),
    ('Frontend', 'frontend', 2),
    ('Tools', 'tools', 3),
    ('Docs', 'docs', 4),
]


def seed_agent_filters(apps, schema_editor):
    AgentFilter = apps.get_model('core', 'AgentFilter')
    for name, slug, order in FILTERS:
        AgentFilter.objects.get_or_create(
            slug=slug,
            defaults={'name': name, 'order': order},
        )


def unseed_agent_filters(apps, schema_editor):
    AgentFilter = apps.get_model('core', 'AgentFilter')
    AgentFilter.objects.filter(slug__in=[slug for _, slug, _ in FILTERS]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0013_agentfilter_projectdoc_filter_and_more'),
    ]

    operations = [
        migrations.RunPython(seed_agent_filters, unseed_agent_filters),
    ]

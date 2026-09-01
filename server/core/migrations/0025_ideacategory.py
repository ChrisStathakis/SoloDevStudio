import uuid

from django.db import migrations, models
import django.db.models.deletion


DEFAULT_CATEGORIES = [
    'Web App / SaaS',
    'Mobile App',
    'Chrome Extension',
    'Developer Tool / CLI',
    'Open Source Library',
    'AI / ML Tool',
    'Desktop App',
    'Portfolio / Website',
]


def seed_categories_and_preserve_ideas(apps, schema_editor):
    Idea = apps.get_model('core', 'Idea')
    IdeaCategory = apps.get_model('core', 'IdeaCategory')
    categories = {}
    for order, name in enumerate(DEFAULT_CATEGORIES):
        category, _ = IdeaCategory.objects.get_or_create(name=name, defaults={'order': order})
        categories[name] = category

    for idea in Idea.objects.all().iterator():
        name = idea.category or DEFAULT_CATEGORIES[0]
        category = categories.get(name)
        if category is None:
            category, _ = IdeaCategory.objects.get_or_create(name=name[:50], defaults={'order': len(categories)})
            categories[name] = category
        idea.idea_category = category
        idea.save(update_fields=['idea_category'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0024_initialization_modes'),
    ]

    operations = [
        migrations.CreateModel(
            name='IdeaCategory',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('name', models.CharField(max_length=50, unique=True)),
                ('order', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'ordering': ['order', 'name']},
        ),
        migrations.AddField(
            model_name='idea',
            name='idea_category',
            field=models.ForeignKey(null=True, on_delete=django.db.models.deletion.PROTECT, related_name='ideas', to='core.ideacategory'),
        ),
        migrations.RunPython(seed_categories_and_preserve_ideas, migrations.RunPython.noop),
        migrations.RemoveField(
            model_name='idea',
            name='category',
        ),
        migrations.RenameField(
            model_name='idea',
            old_name='idea_category',
            new_name='category',
        ),
        migrations.AlterField(
            model_name='idea',
            name='category',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='ideas', to='core.ideacategory'),
        ),
    ]

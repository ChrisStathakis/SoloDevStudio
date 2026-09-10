from django.db import migrations


CATEGORY_NAME = 'Video Games'


def add_video_games_category(apps, schema_editor):
    IdeaCategory = apps.get_model('core', 'IdeaCategory')
    if IdeaCategory.objects.filter(name=CATEGORY_NAME).exists():
        return
    last = IdeaCategory.objects.order_by('-order').first()
    next_order = (last.order + 1) if last is not None else 0
    IdeaCategory.objects.create(name=CATEGORY_NAME, order=next_order)


class Migration(migrations.Migration):

    dependencies = [('core', '0026_stageworkspace')]

    operations = [
        migrations.RunPython(add_video_games_category, migrations.RunPython.noop),
    ]

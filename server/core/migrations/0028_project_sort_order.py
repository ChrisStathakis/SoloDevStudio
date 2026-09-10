from django.db import migrations, models


def backfill_sort_order(apps, schema_editor):
    Project = apps.get_model('core', 'Project')
    # Assign per-owner ordering by created_at so existing users keep a stable order.
    # Use owner_id grouping to avoid cross-user interference.
    seen_owners = Project.objects.values_list('owner_id', flat=True).distinct()
    for owner_id in seen_owners:
        order = 0
        ids = list(
            Project.objects.filter(owner_id=owner_id)
            .order_by('created_at')
            .values_list('id', flat=True)
        )
        for pid in ids:
            Project.objects.filter(id=pid).update(sort_order=order)
            order += 1


class Migration(migrations.Migration):

    dependencies = [('core', '0027_ideacategory_video_games')]

    operations = [
        migrations.AddField(
            model_name='project',
            name='sort_order',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AlterModelOptions(
            name='project',
            options={'ordering': ['sort_order', '-created_at']},
        ),
        migrations.AddIndex(
            model_name='project',
            index=models.Index(fields=['owner', 'sort_order'], name='core_projec_owner_i_8f2e1a_idx'),
        ),
        migrations.RunPython(backfill_sort_order, migrations.RunPython.noop),
    ]

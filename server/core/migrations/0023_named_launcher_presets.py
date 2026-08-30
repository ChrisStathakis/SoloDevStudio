from django.db import migrations, models


def name_existing_presets(apps, schema_editor):
    Preset = apps.get_model('core', 'LauncherModelPreset')
    seen = set()
    for preset in Preset.objects.order_by('owner_id', 'tool', 'created_at', 'id'):
        base = (preset.label or '').strip() or f'{preset.model_id} ({preset.reasoning_effort})'
        candidate = base[:200].rstrip() or 'Launch preset'
        suffix = 2
        key = (preset.owner_id, preset.tool, candidate.casefold())
        while key in seen:
            suffix_text = f' {suffix}'
            candidate = f'{base[:200 - len(suffix_text)]}{suffix_text}'.rstrip()
            key = (preset.owner_id, preset.tool, candidate.casefold())
            suffix += 1
        preset.label = candidate
        preset.save(update_fields=['label'])
        seen.add(key)


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0022_initialization_reasoning_effort'),
    ]

    operations = [
        migrations.RunPython(name_existing_presets, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='launchermodelpreset',
            name='label',
            field=models.CharField(max_length=200),
        ),
        migrations.RemoveConstraint(
            model_name='launchermodelpreset',
            name='unique_launcher_model_preset',
        ),
        migrations.AddConstraint(
            model_name='launchermodelpreset',
            constraint=models.UniqueConstraint(fields=('owner', 'tool', 'label'), name='unique_launcher_model_preset_name'),
        ),
    ]

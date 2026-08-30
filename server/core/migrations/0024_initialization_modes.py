from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0023_named_launcher_presets'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='initialization_mode',
            field=models.CharField(choices=[('build', 'Build'), ('plan', 'Plan')], default='build', max_length=10),
        ),
        migrations.AddField(
            model_name='launchermodelpreset',
            name='mode',
            field=models.CharField(choices=[('build', 'Build'), ('plan', 'Plan')], default='build', max_length=10),
        ),
    ]

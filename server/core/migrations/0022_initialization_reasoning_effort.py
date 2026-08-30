from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0021_project_spark_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='initialization_reasoning_effort',
            field=models.CharField(choices=[('low', 'Low'), ('medium', 'Medium'), ('high', 'High')], default='medium', max_length=10),
        ),
        migrations.AddField(
            model_name='launchermodelpreset',
            name='reasoning_effort',
            field=models.CharField(choices=[('low', 'Low'), ('medium', 'Medium'), ('high', 'High')], default='medium', max_length=10),
        ),
        migrations.RemoveConstraint(
            model_name='launchermodelpreset',
            name='unique_launcher_model_preset',
        ),
        migrations.AddConstraint(
            model_name='launchermodelpreset',
            constraint=models.UniqueConstraint(fields=('owner', 'tool', 'model_id', 'reasoning_effort'), name='unique_launcher_model_preset'),
        ),
    ]

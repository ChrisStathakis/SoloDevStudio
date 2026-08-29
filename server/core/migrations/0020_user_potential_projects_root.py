from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0019_launcher_models_and_project_init'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='potential_projects_root',
            field=models.CharField(blank=True, default='', max_length=500),
        ),
    ]

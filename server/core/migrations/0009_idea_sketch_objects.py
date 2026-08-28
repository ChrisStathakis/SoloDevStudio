# Generated for idea sketch object whiteboard support

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0008_project_cmd_directory_project_script_path'),
    ]

    operations = [
        migrations.AddField(
            model_name='idea',
            name='sketch_objects',
            field=models.JSONField(blank=True, default=list, null=True),
        ),
    ]

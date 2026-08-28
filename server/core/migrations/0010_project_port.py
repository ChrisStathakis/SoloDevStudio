from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0009_idea_sketch_objects'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='port',
            field=models.CharField(blank=True, default='', max_length=200, help_text='Optional port / run args passed to script_path, e.g. "8001" or "--port 8001". Blank = no args.'),
        ),
    ]

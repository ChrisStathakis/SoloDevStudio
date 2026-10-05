from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0040_automation_prompt'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='automation_results_root',
            field=models.CharField(blank=True, default='', max_length=500),
        ),
    ]

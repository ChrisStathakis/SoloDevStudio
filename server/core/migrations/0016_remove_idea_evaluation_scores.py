from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0015_projectlaunchprompt'),
    ]

    operations = [
        migrations.RemoveField(model_name='idea', name='feasibility_score'),
        migrations.RemoveField(model_name='idea', name='market_potential_score'),
        migrations.RemoveField(model_name='idea', name='excitement_score'),
    ]

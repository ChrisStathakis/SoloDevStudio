from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0016_remove_idea_evaluation_scores'),
    ]

    operations = [
        migrations.AddField(
            model_name='task',
            name='milestones',
            field=models.ManyToManyField(blank=True, related_name='tasks', to='core.milestone'),
        ),
    ]

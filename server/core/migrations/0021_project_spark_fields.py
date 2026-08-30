from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0020_user_potential_projects_root'),
    ]

    operations = [
        migrations.AddField(
            model_name='project',
            name='problem',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='project',
            name='solution',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='project',
            name='target_audience',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='project',
            name='monetization',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='project',
            name='mvp_features',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.AddField(
            model_name='project',
            name='tags',
            field=models.JSONField(blank=True, default=list),
        ),
    ]

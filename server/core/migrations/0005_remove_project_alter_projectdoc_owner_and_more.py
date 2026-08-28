import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0004_backfill_projectdoc_owner_projects'),
    ]

    operations = [
        migrations.RemoveIndex(
            model_name='projectdoc',
            name='core_projec_project_f8df04_idx',
        ),
        migrations.RemoveField(
            model_name='projectdoc',
            name='project',
        ),
        migrations.AlterField(
            model_name='projectdoc',
            name='owner',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='project_docs', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AlterField(
            model_name='projectdoc',
            name='projects',
            field=models.ManyToManyField(blank=True, related_name='docs', to='core.project'),
        ),
        migrations.AddIndex(
            model_name='projectdoc',
            index=models.Index(fields=['owner', 'updated_at'], name='core_projec_owner_i_d5f24d_idx'),
        ),
    ]

# Generated migration for social_sim

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="SocialSimRun",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4, editable=False, primary_key=True, serialize=False
                    ),
                ),
                ("property_id", models.CharField(blank=True, max_length=255, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                (
                    "status",
                    models.CharField(
                        choices=[
                            ("queued", "Queued"),
                            ("running", "Running"),
                            ("completed", "Completed"),
                            ("failed", "Failed"),
                        ],
                        default="queued",
                        max_length=20,
                    ),
                ),
                ("progress", models.IntegerField(default=0)),
                ("persona_a", models.JSONField()),
                ("persona_b", models.JSONField(blank=True, null=True)),
                ("apartment_layout", models.JSONField(blank=True, null=True)),
                ("environment_state", models.JSONField(blank=True, null=True)),
                ("result", models.JSONField(blank=True, null=True)),
                ("mediation_rules", models.JSONField(blank=True, null=True)),
                ("mediation_summary", models.TextField(blank=True, default="")),
                ("compatibility_score", models.FloatField(blank=True, null=True)),
                ("error", models.TextField(blank=True, default="")),
                (
                    "user",
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="social_sim_runs",
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at"],
            },
        ),
    ]

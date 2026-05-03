import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("core", "0003_propertyinterest"),
        ("room_sim", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Appliance",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("source", models.CharField(
                    choices=[("manual", "Manual upload"), ("panorama", "Auto-extracted from panorama")],
                    default="manual", max_length=16,
                )),
                ("photo", models.ImageField(blank=True, null=True, upload_to="appliances/photos/")),
                ("detected_class", models.CharField(max_length=32)),
                ("confidence", models.FloatField()),
                ("etat_visuel", models.CharField(default="normal", max_length=16)),
                ("age_years", models.IntegerField(blank=True, null=True)),
                ("kwh_per_year", models.IntegerField(blank=True, null=True)),
                ("energy_class", models.CharField(default="?", max_length=8)),
                ("brand", models.CharField(default="?", max_length=64)),
                ("technology", models.CharField(default="inconnu", max_length=32)),
                ("efficiency_score", models.FloatField()),
                ("grade", models.CharField(max_length=4)),
                ("score_details", models.JSONField(default=dict)),
                ("recommendation_text", models.TextField(blank=True)),
                ("cubemap_face", models.CharField(blank=True, max_length=16)),
                ("cubemap_bbox", models.JSONField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("property", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="appliances", to="core.property",
                )),
                ("reconstruction_job", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="appliances", to="room_sim.reconstructionjob",
                )),
                ("user", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="appliances", to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="ApplianceScan",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("global_score", models.FloatField()),
                ("grade", models.CharField(max_length=4)),
                ("scores_by_device", models.JSONField(default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("appliances", models.ManyToManyField(blank=True, related_name="scans", to="appliances.appliance")),
                ("property", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="appliance_scans", to="core.property",
                )),
                ("reconstruction_job", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="appliance_scans", to="room_sim.reconstructionjob",
                )),
                ("user", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="appliance_scans", to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]

from django.db import models
from django.conf import settings


class Appliance(models.Model):
    """One scanned appliance — either from a manual upload or auto-extracted from a panorama."""

    SOURCE_CHOICES = [
        ("manual", "Manual upload"),
        ("panorama", "Auto-extracted from panorama"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="appliances",
        null=True, blank=True,
    )
    property = models.ForeignKey(
        "core.Property",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="appliances",
    )
    reconstruction_job = models.ForeignKey(
        "room_sim.ReconstructionJob",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="appliances",
    )

    source = models.CharField(max_length=16, choices=SOURCE_CHOICES, default="manual")
    photo = models.ImageField(upload_to="appliances/photos/", null=True, blank=True)

    # CNN detection output
    detected_class = models.CharField(max_length=32)
    confidence = models.FloatField()

    # Visual state (TokenFactory LLM, skipped in auto mode)
    etat_visuel = models.CharField(max_length=16, default="normal")

    # User-supplied or inferred metadata
    age_years = models.IntegerField(null=True, blank=True)
    kwh_per_year = models.IntegerField(null=True, blank=True)
    energy_class = models.CharField(max_length=8, default="?")
    brand = models.CharField(max_length=64, default="?")
    technology = models.CharField(max_length=32, default="inconnu")

    # Scoring output
    efficiency_score = models.FloatField()
    grade = models.CharField(max_length=4)
    score_details = models.JSONField(default=dict)
    recommendation_text = models.TextField(blank=True)

    # Panorama-specific: which cubemap face / bbox the crop came from
    cubemap_face = models.CharField(max_length=16, blank=True)
    cubemap_bbox = models.JSONField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.detected_class} ({self.grade}) — job {self.reconstruction_job_id}"


class ApplianceScan(models.Model):
    """Groups multiple Appliance records into one household scan."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="appliance_scans",
        null=True, blank=True,
    )
    property = models.ForeignKey(
        "core.Property",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="appliance_scans",
    )
    reconstruction_job = models.ForeignKey(
        "room_sim.ReconstructionJob",
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name="appliance_scans",
    )
    appliances = models.ManyToManyField(Appliance, related_name="scans", blank=True)

    global_score = models.FloatField()
    grade = models.CharField(max_length=4)
    scores_by_device = models.JSONField(default=dict)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Scan {self.id} — score {self.global_score} ({self.grade})"

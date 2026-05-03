"""SocialSimRun Django model."""

from django.contrib.auth import get_user_model
from django.db import models
import uuid


User = get_user_model()


class SocialSimRun(models.Model):
    STATUS_CHOICES = [
        ("queued", "Queued"),
        ("running", "Running"),
        ("completed", "Completed"),
        ("failed", "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name="social_sim_runs",
        null=True,
        blank=True,
    )
    # Optional second user (Persona B linked to a real account)
    user_b = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        related_name="social_sim_runs_as_b",
        null=True,
        blank=True,
    )
    # Optional link to a property (by ID string — no FK to keep engine decoupled)
    property_id = models.CharField(max_length=255, blank=True, null=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="queued")
    progress = models.IntegerField(default=0)  # 0–100

    # Input payloads
    persona_a = models.JSONField()
    persona_b = models.JSONField(null=True, blank=True)
    apartment_layout = models.JSONField(null=True, blank=True)
    environment_state = models.JSONField(null=True, blank=True)

    # Life sim context (lat/lon of the property)
    property_lat = models.FloatField(null=True, blank=True)
    property_lon = models.FloatField(null=True, blank=True)
    simulation_month = models.IntegerField(null=True, blank=True)  # 1-12
    commute_destination = models.CharField(max_length=255, blank=True)
    num_ticks = models.IntegerField(default=24)

    # Output payloads
    result = models.JSONField(null=True, blank=True)       # VisualSimulationReplay
    mediation_rules = models.JSONField(null=True, blank=True)  # list[str]
    mediation_summary = models.TextField(blank=True, default="")
    compatibility_score = models.FloatField(null=True, blank=True)

    # Map overlay data (populated before sim starts, so map can show them immediately)
    noise_sources_geo = models.JSONField(null=True, blank=True)   # [{type, lat, lon, count, weight}]
    neighbourhood_pois_geo = models.JSONField(null=True, blank=True)  # [{category, name, lat, lon, distance_m}]

    # Partial streaming (populated every 4 ticks during simulation)
    sim_events_partial = models.JSONField(null=True, blank=True)  # list of NarratedEvent dicts

    # Cached assessment data fed into the EILS engine
    noise_assessment_data = models.JSONField(null=True, blank=True)
    thermal_assessment_data = models.JSONField(null=True, blank=True)
    neighbourhood_profile_data = models.JSONField(null=True, blank=True)

    error = models.TextField(blank=True, default="")

    class Meta:
        ordering = ["-created_at"]

    def __str__(self) -> str:
        name_a = (self.persona_a or {}).get("name", "?")
        name_b = (self.persona_b or {}).get("name", "?") if self.persona_b else "solo"
        return f"SocialSimRun({name_a} & {name_b}) [{self.status}]"


class CompatibilityReport(models.Model):
    """Stores roommate compatibility simulation results and mediation outputs."""

    report_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject_a_id = models.CharField(max_length=100)
    subject_b_id = models.CharField(max_length=100)
    property_config = models.JSONField(default=dict)
    compatibility_score = models.FloatField()
    grade = models.CharField(max_length=120)
    full_report = models.JSONField(default=dict)
    lease_checklist = models.JSONField(default=list)
    llm_backend_used = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Compatibility Report"
        verbose_name_plural = "Compatibility Reports"

    def __str__(self) -> str:
        return (
            f"CompatibilityReport({self.report_id}, "
            f"{self.subject_a_id} vs {self.subject_b_id})"
        )


class NeighborhoodProfileRecord(models.Model):
    """Stores computed neighborhood intelligence profiles."""

    record_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    address = models.CharField(max_length=255, blank=True)
    lat = models.FloatField()
    lon = models.FloatField()
    walkability_score = models.FloatField(default=0.0)
    mobility_score = models.FloatField(default=0.0)
    emergency_score = models.FloatField(default=0.0)
    full_profile = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Neighborhood Profile Record"
        verbose_name_plural = "Neighborhood Profile Records"

    def __str__(self) -> str:
        return f"NeighborhoodProfileRecord({self.record_id}, {self.lat:.4f},{self.lon:.4f})"


class ThermalAssessmentRecord(models.Model):
    """Stores generated thermal assessment reports for apartment configurations."""

    record_id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    address = models.CharField(max_length=255, blank=True)
    lat = models.FloatField()
    lon = models.FloatField()
    floor_number = models.IntegerField(default=1)
    orientation = models.CharField(max_length=20, default="unknown")
    building_mass = models.CharField(max_length=20, default="heavy")
    has_cooling = models.BooleanField(default=False)
    has_heating = models.BooleanField(default=False)
    comfort_score = models.FloatField(default=0.0)
    months_comfortable = models.IntegerField(default=0)
    hottest_month_temp = models.FloatField(default=0.0)
    coldest_month_temp = models.FloatField(default=0.0)
    full_report = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Thermal Assessment Record"
        verbose_name_plural = "Thermal Assessment Records"

    def __str__(self) -> str:
        return f"ThermalAssessmentRecord({self.record_id}, {self.lat:.4f},{self.lon:.4f})"

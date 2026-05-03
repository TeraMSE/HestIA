from django.db import models
from django.conf import settings


class MaterialEstimate(models.Model):
    """Persisted result of one run of the materiaux analysis pipeline."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        related_name="material_estimates",
        on_delete=models.CASCADE,
    )
    property = models.ForeignKey(
        "core.Property",
        null=True,
        blank=True,
        related_name="material_estimates",
        on_delete=models.SET_NULL,
    )
    plan_image = models.ImageField(
        upload_to="materiaux/plans/",
        null=True,
        blank=True,
        help_text="Uploaded 2D floor plan (optional if manual override used)",
    )

    # --- Input parameters ---
    region = models.CharField(max_length=64)
    gamme = models.CharField(
        max_length=16,
        default="moyenne",
        help_text="bas / moyenne / haute",
    )
    budget_tnd = models.DecimalField(max_digits=14, decimal_places=2)

    # Architectural values (parsed from plan or manual overrides)
    surface_m2 = models.FloatField(null=True, blank=True)
    nb_chambres = models.PositiveSmallIntegerField(null=True, blank=True)
    nb_sdb = models.PositiveSmallIntegerField(null=True, blank=True)
    nb_etages = models.PositiveSmallIntegerField(null=True, blank=True)

    # --- Analysis results (full JSON blobs) ---
    plan_data = models.JSONField(default=dict, help_text="Architectural extraction output")
    materiaux = models.JSONField(default=list, help_text="Bill of Quantities list")
    main_oeuvre = models.JSONField(default=dict, help_text="Labour breakdown")
    clim_detail = models.JSONField(default=list, help_text="Per-room HVAC sizing")
    eval_budget = models.JSONField(default=dict, help_text="Budget verdict / ratio / message")

    # --- LLM-generated text ---
    analyse_text = models.TextField(blank=True)
    recommandation_text = models.TextField(blank=True)
    conseil_deco_text = models.TextField(blank=True)

    cout_total_tnd = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"MaterialEstimate #{self.pk} — {self.region} / {self.gamme}"

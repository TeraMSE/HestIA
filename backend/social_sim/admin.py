"""Admin registration for social_sim models."""

from django.contrib import admin

from .models import (
    CompatibilityReport,
    NeighborhoodProfileRecord,
    SocialSimRun,
    ThermalAssessmentRecord,
)


@admin.register(SocialSimRun)
class SocialSimRunAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "status", "progress", "compatibility_score", "created_at"]
    list_filter = ["status"]
    readonly_fields = ["id", "created_at", "updated_at"]
    search_fields = ["user__email"]


@admin.register(CompatibilityReport)
class CompatibilityReportAdmin(admin.ModelAdmin):
    list_display = ["report_id", "subject_a_id", "subject_b_id", "compatibility_score", "grade", "created_at"]
    list_filter = ["grade"]
    readonly_fields = ["report_id", "created_at"]
    search_fields = ["subject_a_id", "subject_b_id"]


@admin.register(NeighborhoodProfileRecord)
class NeighborhoodProfileRecordAdmin(admin.ModelAdmin):
    list_display = ["record_id", "address", "lat", "lon", "walkability_score", "mobility_score", "created_at"]
    readonly_fields = ["record_id", "created_at"]
    search_fields = ["address"]


@admin.register(ThermalAssessmentRecord)
class ThermalAssessmentRecordAdmin(admin.ModelAdmin):
    list_display = ["record_id", "address", "lat", "lon", "comfort_score", "months_comfortable", "created_at"]
    list_filter = ["orientation", "building_mass"]
    readonly_fields = ["record_id", "created_at"]
    search_fields = ["address"]

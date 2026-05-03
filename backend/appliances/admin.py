from django.contrib import admin
from .models import Appliance, ApplianceScan

@admin.register(Appliance)
class ApplianceAdmin(admin.ModelAdmin):
    list_display = ("detected_class", "grade", "efficiency_score", "source", "property", "created_at")
    list_filter = ("source", "detected_class", "grade")
    readonly_fields = ("score_details",)

@admin.register(ApplianceScan)
class ApplianceScanAdmin(admin.ModelAdmin):
    list_display = ("id", "global_score", "grade", "property", "created_at")
    list_filter = ("grade",)

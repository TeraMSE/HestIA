from django.contrib import admin
from .models import MaterialEstimate


@admin.register(MaterialEstimate)
class MaterialEstimateAdmin(admin.ModelAdmin):
    list_display = ["id", "user", "region", "gamme", "cout_total_tnd", "created_at"]
    list_filter = ["region", "gamme"]
    search_fields = ["user__email", "region"]
    readonly_fields = ["created_at", "plan_data", "materiaux", "main_oeuvre", "clim_detail", "eval_budget"]

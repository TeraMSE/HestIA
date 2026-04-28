from django.contrib import admin
from .models import Property, Panorama, PropertyImage


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ("address", "owner", "bedrooms", "bathrooms", "price_tnd", "for_sale", "for_rent", "is_active", "created_at")
    list_filter = ("for_sale", "for_rent", "is_active", "bedrooms", "created_at")
    search_fields = ("address", "owner__email")
    readonly_fields = ("created_at", "updated_at")
    fieldsets = (
        ("Basic", {"fields": ("owner", "address", "lat", "lng")}),
        ("Details", {"fields": ("bedrooms", "bathrooms", "area_m2", "price_tnd", "description")}),
        ("Listing", {"fields": ("for_sale", "for_rent", "is_active")}),
        ("Timestamps", {"fields": ("created_at", "updated_at")}),
    )


@admin.register(Panorama)
class PanoramaAdmin(admin.ModelAdmin):
    list_display = ("property", "uploaded_by", "status", "job_id", "created_at")
    list_filter = ("status", "created_at")
    search_fields = ("property__address", "uploaded_by__email", "job_id")
    readonly_fields = ("created_at", "completed_at", "job_id")


@admin.register(PropertyImage)
class PropertyImageAdmin(admin.ModelAdmin):
    list_display = ("property", "is_thumbnail", "created_at")
    list_filter = ("is_thumbnail", "created_at")
    search_fields = ("property__address",)
    readonly_fields = ("created_at",)

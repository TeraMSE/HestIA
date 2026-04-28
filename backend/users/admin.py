from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from .models import CustomUser


@admin.register(CustomUser)
class CustomUserAdmin(BaseUserAdmin):
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Personal info", {"fields": ("first_name", "last_name")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Important dates", {"fields": ("last_login", "date_joined")}),
        ("Additional", {"fields": ("role", "verified_email")}),
    )
    add_fieldsets = (
        (None, {
            "classes": ("wide",),
            "fields": ("email", "password1", "password2", "role"),
        }),
    )
    list_display = ("email", "first_name", "last_name", "role", "is_staff")
    list_filter = ("role", "is_staff", "verified_email")
    search_fields = ("email", "first_name", "last_name")
    ordering = ("-created_at",)
    filter_horizontal = ("groups", "user_permissions")

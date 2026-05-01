from django.contrib import admin
from django.utils.html import format_html
import shutil

from .models import ReconstructionJob


def _reset_jobs(modeladmin, request, queryset):
    """Admin action: reset selected jobs so they can be re-run or replaced."""
    for job in queryset:
        # Delete the job directory (mesh, layout, detections, etc.)
        job_dir = job.job_dir()
        if job_dir.exists():
            shutil.rmtree(job_dir, ignore_errors=True)

        # Reset all fields to initial state
        ReconstructionJob.objects.filter(pk=job.pk).update(
            state="queued",
            current_step="queued",
            started_at=None,
            finished_at=None,
            mesh_vertices=None,
            mesh_faces=None,
            error_message="",
            error_trace="",
        )

    modeladmin.message_user(
        request,
        f"Reset {queryset.count()} job(s). Their disk artifacts have been deleted.",
    )


_reset_jobs.short_description = "Reset selected jobs (deletes artifacts)"  # type: ignore


@admin.register(ReconstructionJob)
class ReconstructionJobAdmin(admin.ModelAdmin):
    list_display = (
        "short_id", "state", "property_link", "current_step",
        "mesh_vertices", "created_at", "finished_at",
    )
    list_filter = ("state", "created_at")
    search_fields = ("id", "property__address", "error_message")
    readonly_fields = (
        "id", "created_at", "started_at", "finished_at",
        "mesh_vertices", "mesh_faces", "error_trace",
    )
    actions = [_reset_jobs]

    fieldsets = (
        ("Job Identity", {
            "fields": ("id", "property", "state", "current_step"),
        }),
        ("Pipeline Options", {
            "fields": ("align_panorama", "force_cuboid", "mesh_stride", "ignore_ceiling", "checkpoint_path"),
        }),
        ("Timing", {
            "fields": ("created_at", "started_at", "finished_at"),
        }),
        ("Results", {
            "fields": ("mesh_vertices", "mesh_faces"),
        }),
        ("Errors", {
            "fields": ("error_message", "error_trace"),
            "classes": ("collapse",),
        }),
    )

    def short_id(self, obj):
        return str(obj.id)[:8] + "…"
    short_id.short_description = "ID"

    def property_link(self, obj):
        if obj.property:
            return format_html(
                '<a href="/admin/core/property/{}/change/">{}</a>',
                obj.property.id,
                obj.property.address[:40],
            )
        return "—"
    property_link.short_description = "Property"
    property_link.allow_tags = True

"""URL configuration for room_sim app."""
from django.urls import path
from . import views

app_name = "room_sim"

urlpatterns = [
    # Frontend
    path("", views.sim_page, name="sim"),

    # Pipeline
    path("api/jobs/start/", views.job_start, name="job_start"),
    path("api/jobs/<uuid:job_id>/status/", views.job_status, name="job_status"),
    path("api/jobs/<uuid:job_id>/events/", views.job_events, name="job_events"),

    # Shared 3D world lookup — any user can check if a property has a completed job
    path("api/jobs/property/<int:property_id>/", views.property_job_status, name="property_job_status"),

    # Artifacts
    path("api/jobs/<uuid:job_id>/artifact/mesh/", views.artifact_mesh, name="artifact_mesh"),
    path("api/jobs/<uuid:job_id>/artifact/layout/", views.artifact_layout, name="artifact_layout"),
    path("api/jobs/<uuid:job_id>/artifact/panorama/", views.artifact_panorama, name="artifact_panorama"),
    path("api/jobs/<uuid:job_id>/artifact/detections/", views.artifact_detections, name="artifact_detections"),
    path("api/jobs/<uuid:job_id>/artifact/analysis/",  views.artifact_analysis,   name="artifact_analysis"),

    # Derived data
    path("api/jobs/<uuid:job_id>/floor_polygon/", views.floor_polygon, name="floor_polygon"),
]

"""URL routing for the social_sim app."""

from django.urls import path

from . import views

urlpatterns = [
    # ── Existing life-sim run endpoints ──────────────────────────────────────
    path("runs/", views.create_run, name="social-sim-create"),
    path("runs/<uuid:run_id>/", views.run_status, name="social-sim-status"),
    path("runs/<uuid:run_id>/replay/", views.run_replay, name="social-sim-replay"),
    path("runs/<uuid:run_id>/mediation/", views.run_mediation, name="social-sim-mediation"),

    # ── HestIA-LS: Compatibility ─────────────────────────────────────────────
    path(
        "compatibility/simulate/",
        views.CompatibilitySimulationView.as_view(),
        name="social-sim-compatibility-simulate",
    ),
    path(
        "compatibility/report/<uuid:report_id>/",
        views.CompatibilityReportView.as_view(),
        name="social-sim-compatibility-report",
    ),

    # ── HestIA-LS: Noise Assessment ──────────────────────────────────────────
    path(
        "noise/assess/",
        views.NoiseAssessmentView.as_view(),
        name="social-sim-noise-assess",
    ),
    path(
        "noise/cache/stats/",
        views.NoiseCacheStatsView.as_view(),
        name="social-sim-noise-cache-stats",
    ),
    path(
        "noise/cache/clear/",
        views.NoiseCacheClearView.as_view(),
        name="social-sim-noise-cache-clear",
    ),

    # ── HestIA-LS: Neighborhood ──────────────────────────────────────────────
    path(
        "neighborhood/profile/",
        views.NeighborhoodProfileView.as_view(),
        name="social-sim-neighborhood-profile",
    ),

    # ── HestIA-LS: Thermal Assessment ────────────────────────────────────────
    path(
        "thermal/assess/",
        views.ThermalAssessmentView.as_view(),
        name="social-sim-thermal-assess",
    ),

    # ── HestIA-LS: Life Simulation ────────────────────────────────────────────
    path(
        "life-sim/start/",
        views.LifeSimStartView.as_view(),
        name="social-sim-life-sim-start",
    ),
    path(
        "life-sim/<uuid:run_id>/",
        views.LifeSimStatusView.as_view(),
        name="social-sim-life-sim-status",
    ),

    # ── HestIA-LS: Cohabitation Simulation ────────────────────────────────────
    path(
        "cohab/start/",
        views.CohabStartView.as_view(),
        name="social-sim-cohab-start",
    ),
    path(
        "cohab/<uuid:run_id>/",
        views.CohabStatusView.as_view(),
        name="social-sim-cohab-status",
    ),
]

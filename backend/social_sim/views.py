"""Views for the social_sim Django app.

Endpoints (existing life‑sim CRUD):
  POST   /api/v1/social-sim/runs/                → start run
  GET    /api/v1/social-sim/runs/{id}/            → status poll
  GET    /api/v1/social-sim/runs/{id}/replay/     → full frame payload
  GET    /api/v1/social-sim/runs/{id}/mediation/  → house rules

HestIA-LS endpoints:
  POST   /api/v1/social-sim/compatibility/simulate/    → compatibility simulation
  GET    /api/v1/social-sim/compatibility/report/{id}/ → stored report
  POST   /api/v1/social-sim/noise/assess/              → noise assessment
  GET    /api/v1/social-sim/noise/cache/stats/          → cache stats
  DELETE /api/v1/social-sim/noise/cache/clear/          → clear cache
  POST   /api/v1/social-sim/neighborhood/profile/      → neighborhood profile
  POST   /api/v1/social-sim/thermal/assess/            → thermal assessment
"""

import os

from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    CompatibilityReport,
    NeighborhoodProfileRecord,
    SocialSimRun,
    ThermalAssessmentRecord,
)
from .serializers import (
    SocialSimRunCreateSerializer,
    SocialSimRunMediationSerializer,
    SocialSimRunReplaySerializer,
    SocialSimRunSerializer,
)
from .tasks import start_simulation_thread


# ──────────────────────────────────────────────────────────────────────────────
# Existing life‑sim run endpoints
# ──────────────────────────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([IsAuthenticated])
def create_run(request):
    """Create a new SocialSimRun and kick off the background simulation."""
    serializer = SocialSimRunCreateSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    run = serializer.save(user=request.user, status="queued", progress=0)
    start_simulation_thread(str(run.id))

    return Response(
        {"id": str(run.id), "status": run.status},
        status=status.HTTP_201_CREATED,
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def run_status(request, run_id):
    """Return the current status and progress of a run (for polling)."""
    run = _get_run(run_id, request.user)
    if run is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    return Response(SocialSimRunSerializer(run).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def run_replay(request, run_id):
    """Return the full VisualSimulationReplay JSON once status == completed."""
    run = _get_run(run_id, request.user)
    if run is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    if run.status != "completed":
        return Response(
            {"detail": f"Run is not completed yet (status: {run.status})."},
            status=status.HTTP_202_ACCEPTED,
        )
    return Response(SocialSimRunReplaySerializer(run).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def run_mediation(request, run_id):
    """Return the LLM-generated house rules and mediation summary."""
    run = _get_run(run_id, request.user)
    if run is None:
        return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
    if run.status != "completed":
        return Response(
            {"detail": f"Run is not completed yet (status: {run.status})."},
            status=status.HTTP_202_ACCEPTED,
        )
    return Response(SocialSimRunMediationSerializer(run).data)


def _get_run(run_id: str, user) -> SocialSimRun | None:
    try:
        return SocialSimRun.objects.get(pk=run_id, user=user)
    except (SocialSimRun.DoesNotExist, Exception):
        return None


# ──────────────────────────────────────────────────────────────────────────────
# HestIA-LS: Roommate Compatibility Simulation
# ──────────────────────────────────────────────────────────────────────────────

class CompatibilitySimulationView(APIView):
    """
    POST /api/v1/social-sim/compatibility/simulate/

    Runs social-agent compatibility simulation + mediation + scoring,
    persists a CompatibilityReport, and returns summary JSON.
    """

    def post(self, request: Request) -> Response:
        body = request.data or {}

        subject_a_id = body.get("subject_a_id")
        subject_b_id = body.get("subject_b_id")
        if not subject_a_id or not subject_b_id:
            return Response(
                {"detail": "subject_a_id and subject_b_id are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        property_config = body.get("property_config") or {}
        try:
            num_ticks = int(body.get("num_ticks", 12))
        except (TypeError, ValueError):
            num_ticks = 12
        num_ticks = max(1, min(48, num_ticks))

        from .engine.persona import Persona
        from .engine.environment import EnvironmentEngine
        from .engine.llm_client import UnifiedLLMClient
        from .engine.compatibility import RoommateCompatibilityAgent
        from .engine.mediation import MediationAgent
        from .engine.scoring import SOTOPIAInspiredScorer

        traits_a = body.get("traits_a") or {}
        traits_b = body.get("traits_b") or {}

        persona_a = Persona.from_traits(subject_id=subject_a_id, traits=traits_a)
        persona_b = Persona.from_traits(subject_id=subject_b_id, traits=traits_b)

        engine = EnvironmentEngine()
        property_obj = engine.create_mock_property(
            property_type="2br",
            noise_level=float(property_config.get("noise_level", 0.5)),
            temperature=float(property_config.get("temperature", 0.5)),
            smoking_allowed=bool(property_config.get("smoking_allowed", False)),
        )

        llm_client = UnifiedLLMClient()
        compatibility_agent = RoommateCompatibilityAgent(
            persona_a=persona_a,
            persona_b=persona_b,
            property=property_obj,
            llm_client=llm_client,
        )
        compatibility_result = compatibility_agent.run_cohabitation_simulation(
            num_ticks=num_ticks
        )

        mediation_agent = MediationAgent(llm_client=llm_client)
        mediation_result = mediation_agent.mediate_all_conflicts(
            compatibility_result=compatibility_result,
            persona_a=persona_a,
            persona_b=persona_b,
        )

        simulation_result = {
            "final_satisfaction": (
                float(compatibility_result.get("persona_a_satisfaction", 0.5))
                + float(compatibility_result.get("persona_b_satisfaction", 0.5))
            )
            / 2.0
        }

        scorer = SOTOPIAInspiredScorer(llm_client=llm_client)
        score = scorer.compute_full_score(
            sim_result=simulation_result,
            compat_result=compatibility_result,
            med_result=mediation_result,
            persona_a=persona_a,
            persona_b=persona_b,
            property_id=property_obj.property_id,
        )

        full_report = {
            "compatibility": compatibility_result,
            "mediation": mediation_result,
            "score": score.model_dump(),
        }
        backend_info = llm_client.get_backend_info()

        report = CompatibilityReport.objects.create(
            subject_a_id=subject_a_id,
            subject_b_id=subject_b_id,
            property_config={
                "noise_level": float(property_config.get("noise_level", 0.5)),
                "temperature": float(property_config.get("temperature", 0.5)),
                "smoking_allowed": bool(property_config.get("smoking_allowed", False)),
                "num_ticks": num_ticks,
            },
            compatibility_score=float(
                mediation_result.get(
                    "final_compatibility_score",
                    compatibility_result.get("compatibility_score", 0.5),
                )
            ),
            grade=score.grade,
            full_report=full_report,
            lease_checklist=mediation_result.get("lease_checklist", []),
            llm_backend_used=str(backend_info.get("backend", "unknown")),
        )

        return Response(
            {
                "report_id": str(report.report_id),
                "compatibility_score": report.compatibility_score,
                "overall_score": score.overall_score,
                "grade": report.grade,
                "needs_mediation": bool(
                    mediation_result.get("mediation_applied", False)
                ),
                "lease_checklist": report.lease_checklist,
                "llm_backend_used": report.llm_backend_used,
                "created_at": report.created_at,
            },
            status=status.HTTP_200_OK,
        )


class CompatibilityReportView(APIView):
    """
    GET /api/v1/social-sim/compatibility/report/<report_id>/

    Returns full stored compatibility report JSON.
    """

    def get(self, request: Request, report_id: str) -> Response:
        try:
            report = CompatibilityReport.objects.get(report_id=report_id)
        except CompatibilityReport.DoesNotExist:
            return Response(
                {"detail": "Compatibility report not found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(
            {
                "report_id": str(report.report_id),
                "subject_a_id": report.subject_a_id,
                "subject_b_id": report.subject_b_id,
                "property_config": report.property_config,
                "compatibility_score": report.compatibility_score,
                "grade": report.grade,
                "full_report": report.full_report,
                "lease_checklist": report.lease_checklist,
                "llm_backend_used": report.llm_backend_used,
                "created_at": report.created_at,
            },
            status=status.HTTP_200_OK,
        )


# ──────────────────────────────────────────────────────────────────────────────
# HestIA-LS: Noise Assessment
# ──────────────────────────────────────────────────────────────────────────────

class NoiseAssessmentView(APIView):
    """
    POST /api/v1/social-sim/noise/assess/

    Body JSON accepts either:
    - {"address": "Avenue Habib Bourguiba, Tunis", "radius_m": 300, "force_refresh": false}
    - {"lat": 36.8065, "lon": 10.1815, "radius_m": 300}
    """

    def post(self, request: Request) -> Response:
        body = request.data or {}
        has_address = bool(str(body.get("address", "")).strip())
        has_coords = body.get("lat") is not None and body.get("lon") is not None

        if not has_address and not has_coords:
            return Response(
                {"detail": "Provide either address or both lat/lon."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if body.get("radius_m") is not None:
            try:
                radius = int(body.get("radius_m"))
                if radius <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                return Response(
                    {"detail": "radius_m must be a positive integer."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        else:
            radius = 300

        try:
            from social_sim.noise_assessment.noise_engine import (
                NoiseAssessmentEngine,
                NoiseAssessmentRequest,
            )

            req_model = NoiseAssessmentRequest(
                address=body.get("address"),
                lat=body.get("lat"),
                lon=body.get("lon"),
                radius_m=radius,
                force_refresh=bool(body.get("force_refresh", False)),
            )
            result = NoiseAssessmentEngine().assess(req_model)
            raw = result.model_dump()

            # Map internal field names → frontend contract
            noise_level = float(raw.get("noise_level", 0.4))
            noise_score = round((1.0 - noise_level) * 100, 1)  # invert: 0=loud → 100=quiet
            label = str(raw.get("noise_label", "")).lower()
            if "very quiet" in label or "very_quiet" in label:
                noise_category = "very_quiet"
            elif "quiet" in label:
                noise_category = "quiet"
            elif "very noisy" in label or "very_noisy" in label or "extremely" in label:
                noise_category = "very_noisy"
            elif "noisy" in label:
                noise_category = "noisy"
            else:
                noise_category = "moderate"

            top_sources = raw.get("top_sources") or []
            sources = [
                {"type": s.split("(")[-1].rstrip(")").strip() if "(" in s else s.strip(),
                 "count": 1, "distance_m": 0, "weight": 0.5}
                for s in top_sources
            ]

            return Response({
                "address": raw.get("resolved_address"),
                "lat": raw.get("lat"),
                "lon": raw.get("lon"),
                "radius_m": raw.get("radius_m", 300),
                "noise_level": noise_level,
                "noise_score": noise_score,
                "noise_category": noise_category,
                "sources": sources,
                "dominant_source": sources[0]["type"] if sources else None,
                "assessment_summary": (
                    f"{'Fallback estimate — ' if raw.get('fallback_used') else ''}"
                    f"Noise level: {raw.get('noise_label', 'Moderate')}. "
                    f"{raw.get('fallback_reason', '')}"
                ).strip(),
                "cached": raw.get("from_cache", False),
                "assessed_at": raw.get("assessed_at", ""),
            }, status=status.HTTP_200_OK)

        except ValueError as exc:
            return Response(
                {"detail": str(exc)},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as exc:  # noqa: BLE001
            return Response(
                {"detail": f"Noise assessment failed: {str(exc)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )


class NoiseCacheStatsView(APIView):
    """GET /api/v1/social-sim/noise/cache/stats/"""

    def get(self, request: Request) -> Response:
        try:
            from social_sim.noise_assessment.noise_engine import NoiseAssessmentEngine

            engine = NoiseAssessmentEngine()
            return Response(engine.cache.stats(), status=status.HTTP_200_OK)
        except Exception as exc:  # noqa: BLE001
            return Response(
                {"detail": f"Unable to read cache stats: {str(exc)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )


class NoiseCacheClearView(APIView):
    """DELETE /api/v1/social-sim/noise/cache/clear/ (admin use only)."""

    def delete(self, request: Request) -> Response:
        if not self._is_authorized_admin(request):
            return Response(
                {
                    "detail": "Not authorized to clear noise cache. "
                    "Requires staff user or valid admin secret header."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            from social_sim.noise_assessment.noise_engine import NoiseAssessmentEngine

            engine = NoiseAssessmentEngine()
            engine.cache.clear_all()
            return Response(
                {"detail": "Noise cache cleared."},
                status=status.HTTP_200_OK,
            )
        except Exception as exc:  # noqa: BLE001
            return Response(
                {"detail": f"Unable to clear cache: {str(exc)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

    @staticmethod
    def _is_authorized_admin(request: Request) -> bool:
        user = getattr(request, "user", None)
        if bool(getattr(user, "is_authenticated", False)) and bool(
            getattr(user, "is_staff", False)
        ):
            return True

        configured_secret = os.getenv("NOISE_ADMIN_SECRET", "").strip()
        provided_secret = str(request.headers.get("X-Noise-Admin-Secret", "")).strip()
        return bool(configured_secret) and provided_secret == configured_secret


# ──────────────────────────────────────────────────────────────────────────────
# HestIA-LS: Neighborhood Profile
# ──────────────────────────────────────────────────────────────────────────────

class NeighborhoodProfileView(APIView):
    """
    POST /api/v1/social-sim/neighborhood/profile/

    Body JSON accepts either:
    - {"lat": 36.8065, "lon": 10.1815, "address": "...", "commute_destination": "...", "radius_m": 1000}
    - {"address": "Avenue Habib Bourguiba, Tunis", "commute_destination": "...", "radius_m": 1000}
    """

    def post(self, request: Request) -> Response:
        body = request.data or {}
        address = str(body.get("address", "")).strip()
        commute_destination = str(body.get("commute_destination", "")).strip() or None

        try:
            radius_m = int(body.get("radius_m", 1000))
        except (TypeError, ValueError):
            return Response(
                {"detail": "radius_m must be an integer."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        radius_m = max(100, min(3000, radius_m))

        lat = body.get("lat")
        lon = body.get("lon")

        if lat is None or lon is None:
            if not address:
                return Response(
                    {"detail": "Provide either lat/lon or address."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            try:
                from social_sim.noise_assessment.geocoder import PropertyGeocoder

                geocoder = PropertyGeocoder()
                geo = geocoder.geocode_address(address)
                lat = geo.lat
                lon = geo.lon
                if not address:
                    address = geo.display_name
            except Exception as exc:  # noqa: BLE001
                return Response(
                    {"detail": f"Unable to geocode address: {str(exc)}"},
                    status=status.HTTP_400_BAD_REQUEST,
                )

        try:
            lat_f = float(lat)
            lon_f = float(lon)
        except (TypeError, ValueError):
            return Response(
                {"detail": "lat and lon must be numeric."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        noise_assessment = body.get("noise_assessment")
        if not isinstance(noise_assessment, dict):
            noise_assessment = None

        try:
            from social_sim.neighborhood.neighborhood_profile import (
                NeighborhoodProfileBuilder,
            )

            builder = NeighborhoodProfileBuilder()
            profile = builder.build(
                lat=lat_f,
                lon=lon_f,
                address=address,
                commute_destination=commute_destination,
                noise_assessment=noise_assessment,
                radius_m=radius_m,
            )
            profile_payload = profile.model_dump()

            walkability = profile_payload.get("walkability", {}) or {}
            transport = profile_payload.get("transport", {}) or {}
            emergency = profile_payload.get("emergency_accessibility", {}) or {}

            NeighborhoodProfileRecord.objects.create(
                address=profile_payload.get("address", address) or "",
                lat=lat_f,
                lon=lon_f,
                walkability_score=float(walkability.get("overall_score", 0.0) or 0.0),
                mobility_score=float(transport.get("mobility_score", 0.0) or 0.0),
                emergency_score=float(emergency.get("score", 0.0) or 0.0),
                full_profile=profile_payload,
            )

            return Response(profile_payload, status=status.HTTP_200_OK)
        except Exception as exc:  # noqa: BLE001
            return Response(
                {"detail": f"Neighborhood profile build failed: {str(exc)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )


# ──────────────────────────────────────────────────────────────────────────────
# HestIA-LS: Thermal Assessment
# ──────────────────────────────────────────────────────────────────────────────

class ThermalAssessmentView(APIView):
    """
    POST /api/v1/social-sim/thermal/assess/

    Builds thermal assessment report from apartment params,
    persists it to ThermalAssessmentRecord, and returns full report JSON.
    """

    def post(self, request: Request) -> Response:
        body = request.data or {}

        required_fields = [
            "lat",
            "lon",
            "floor_number",
            "orientation",
            "building_mass",
            "building_condition",
            "has_cooling",
            "has_heating",
            "has_balcony",
            "has_windows",
        ]
        missing = [field for field in required_fields if field not in body]
        if missing:
            return Response(
                {"detail": f"Missing required fields: {', '.join(missing)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            lat = float(body.get("lat"))
            lon = float(body.get("lon"))
            floor_number = int(body.get("floor_number"))
        except (TypeError, ValueError):
            return Response(
                {"detail": "lat, lon, and floor_number must be numeric."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        address = str(body.get("address", "")).strip()
        orientation = str(body.get("orientation", "unknown")).strip().lower()
        building_mass = str(body.get("building_mass", "heavy")).strip().lower()
        building_condition = str(body.get("building_condition", "good")).strip().lower()
        has_cooling = bool(body.get("has_cooling", False))
        has_heating = bool(body.get("has_heating", False))
        has_balcony = bool(body.get("has_balcony", False))
        has_windows = bool(body.get("has_windows", True))

        if orientation not in {"north", "south", "east", "west", "unknown"}:
            return Response(
                {"detail": "orientation must be one of north/south/east/west/unknown."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if building_mass not in {"heavy", "medium", "light"}:
            return Response(
                {"detail": "building_mass must be one of heavy/medium/light."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if building_condition not in {"new", "good", "fair", "poor"}:
            return Response(
                {"detail": "building_condition must be one of new/good/fair/poor."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from social_sim.thermal.cache import ThermalCache
            from social_sim.thermal.thermal_report import ThermalReportBuilder

            cache = ThermalCache(cache_dir="./thermal_cache", ttl_days=7)
            cache_key = cache.build_key(
                "api_thermal_assessment",
                f"{lat:.4f}",
                f"{lon:.4f}",
                floor_number,
                orientation,
                building_mass,
                building_condition,
                has_cooling,
                has_heating,
                has_balcony,
                has_windows,
                address.lower(),
            )

            cached_report = cache.get(cache_key)
            if cached_report:
                report_payload = dict(cached_report)
            else:
                builder = ThermalReportBuilder()
                report = builder.build(
                    lat=lat,
                    lon=lon,
                    address=address,
                    floor_number=floor_number,
                    orientation=orientation,
                    building_mass=building_mass,
                    building_condition=building_condition,
                    has_cooling=has_cooling,
                    has_heating=has_heating,
                    has_balcony=has_balcony,
                    has_windows=has_windows,
                )
                report_payload = report.model_dump()
                cache.set(cache_key, report_payload)

            comfort_report = report_payload.get("comfort_report", {}) or {}
            climate_summary = report_payload.get("climate_summary", {}) or {}

            ThermalAssessmentRecord.objects.create(
                address=address,
                lat=lat,
                lon=lon,
                floor_number=floor_number,
                orientation=orientation,
                building_mass=building_mass,
                has_cooling=has_cooling,
                has_heating=has_heating,
                comfort_score=float(comfort_report.get("comfort_score", 0.0) or 0.0),
                months_comfortable=int(
                    comfort_report.get("months_in_comfort_band", 0) or 0
                ),
                hottest_month_temp=float(
                    climate_summary.get("hottest_month_avg", 0.0) or 0.0
                ),
                coldest_month_temp=float(
                    climate_summary.get("coldest_month_avg", 0.0) or 0.0
                ),
                full_report=report_payload,
            )

            return Response(report_payload, status=status.HTTP_200_OK)
        except Exception as exc:  # noqa: BLE001
            return Response(
                {"detail": f"Thermal assessment failed: {str(exc)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )


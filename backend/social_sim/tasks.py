"""Background simulation runners for HestIA-LS."""

from __future__ import annotations

import threading
import traceback
import logging
from typing import Optional

logger = logging.getLogger(__name__)


# ── Outdoor action IDs that mean the persona leaves the apartment ─────────────
OUTDOOR_ACTION_IDS = {
    "take_bus_university",
    "take_bus_general",
    "walk_to_destination",
    "go_to_park",
    "commute_to_work_uni",
    "get_groceries",
    "go_to_cafe",
    "go_to_restaurant",
    "go_to_gym",
    "visit_friend",
    "go_shopping",
    "go_for_walk",
}


def _tag_event_location(event: dict, center_lat: float, center_lon: float) -> dict:
    """Add location_type and optional destination coords to a narrated event dict."""
    action_id = str(event.get("action_id", "")).lower()
    is_outdoor = any(oid in action_id for oid in OUTDOOR_ACTION_IDS)

    event = dict(event)
    if is_outdoor:
        event["location_type"] = "outdoor"
        # Approximate destination: small random offset so dot moves visibly
        import random, math
        bearing = random.uniform(0, 2 * math.pi)
        dist_m = random.uniform(200, 800)
        lat_offset = (dist_m / 111320) * math.cos(bearing)
        lon_offset = (dist_m / (111320 * math.cos(math.radians(center_lat)))) * math.sin(bearing)
        event["destination_lat"] = round(center_lat + lat_offset, 6)
        event["destination_lon"] = round(center_lon + lon_offset, 6)
    else:
        event["location_type"] = "indoor"
        event.pop("destination_lat", None)
        event.pop("destination_lon", None)

    return event


def _build_geo_sources_from_noise(noise_result: dict, center_lat: float, center_lon: float) -> list[dict]:
    """Extract geo-located noise sources from a noise assessment result dict."""
    geo = noise_result.get("geo_sources") or []
    if geo:
        return geo

    # Fallback: if cached response has no geo_sources, return empty
    return []


def _build_pois_from_neighbourhood(nb_result: dict) -> list[dict]:
    """Flatten neighbourhood poi_details into a flat list with lat/lon for map overlay."""
    poi_details = (nb_result or {}).get("poi_details") or {}
    flat: list[dict] = []
    for category, items in poi_details.items():
        for item in (items or []):
            if item.get("lat") is not None and item.get("lon") is not None:
                flat.append({
                    "category": category,
                    "name": item.get("name") or category,
                    "lat": float(item["lat"]),
                    "lon": float(item["lon"]),
                    "distance_m": item.get("distance_m"),
                })
    return flat


# ── Original social_sim run (roommate compatibility) ─────────────────────────

def run_simulation(run_id: str) -> None:
    """Execute the full roommate compatibility simulation pipeline in a background thread."""
    import django
    django.setup() if not django.conf.settings.configured else None

    from social_sim.models import SocialSimRun
    from social_sim.engine.llm_client import OllamaLLMClient
    from social_sim.engine.life_sim_engine import LifeSimEngine, LifeSimRequest
    from social_sim.engine.persona import Persona
    from social_sim.engine.compatibility_simple import compute_compatibility
    from social_sim.engine.mediation import MediationAgent
    from social_sim.engine.frame_builder import FrameBuilder
    from social_sim.engine.layout_builder import build_default_layout

    try:
        run = SocialSimRun.objects.get(pk=run_id)
    except SocialSimRun.DoesNotExist:
        logger.error("[SocialSim] Run %s not found", run_id)
        return

    def _update(progress: int, status: str = "running") -> None:
        SocialSimRun.objects.filter(pk=run_id).update(progress=progress, status=status)

    try:
        _update(2, "running")

        llm = OllamaLLMClient()

        engine = LifeSimEngine(llm_client=llm)

        persona_a_data = run.persona_a
        persona_b_data = run.persona_b
        env_data = run.environment_state
        layout_data = run.apartment_layout or build_default_layout()

        # Phase 1: Simulate Persona A (0→40 %)
        req_a = LifeSimRequest(
            mode="solo",
            persona_a=persona_a_data,
            environment_state=env_data,
            num_ticks=24,
            use_daily_plan=True,
        )

        def cb_a(pct: int, msg: str) -> None:
            _update(int(pct * 0.4))

        result_a = engine.simulate_solo(req_a, progress_callback=cb_a)
        _update(40)

        # Phase 2: Simulate Persona B (40→70 %)
        result_b: Optional[dict] = None
        if persona_b_data:
            req_b = LifeSimRequest(
                mode="solo",
                persona_a=persona_b_data,
                environment_state=env_data,
                num_ticks=24,
                use_daily_plan=True,
            )

            def cb_b(pct: int, msg: str) -> None:
                _update(40 + int(pct * 0.3))

            result_b = engine.simulate_solo(req_b, progress_callback=cb_b)
        _update(70)

        # Phase 3: Compatibility (70→85 %)
        compat_result: Optional[dict] = None
        if result_b:
            persona_a = Persona.from_dict(persona_a_data)
            persona_b = Persona.from_dict(persona_b_data)
            compat_result = compute_compatibility(
                persona_a=persona_a,
                persona_b=persona_b,
                events_a=result_a.get("events", []),
                events_b=result_b.get("events", []),
            )
        _update(85)

        # Phase 4: Mediation (85→95 %)
        mediation: Optional[dict] = None
        if compat_result:
            mediator = MediationAgent(llm_client=llm)
            name_a = result_a.get("persona_name", "Persona A")
            name_b = result_b.get("persona_name", "Persona B") if result_b else "Persona B"
            mediation = mediator.mediate(
                compatibility_result=compat_result,
                persona_a_name=name_a,
                persona_b_name=name_b,
            )
        _update(95)

        # Phase 5: Build frames (95→100 %)
        builder = FrameBuilder(layout=layout_data)
        replay = builder.build_full_sequence(
            run_id=str(run_id),
            result_a=result_a,
            result_b=result_b,
            compatibility_result=compat_result,
            mediation=mediation,
        )
        _update(100)

        SocialSimRun.objects.filter(pk=run_id).update(
            status="completed",
            progress=100,
            result=replay.model_dump(),
            mediation_rules=mediation.get("rules", []) if mediation else [],
            mediation_summary=mediation.get("summary", "") if mediation else "",
            compatibility_score=(
                compat_result.get("compatibility_score") if compat_result else None
            ),
        )
        logger.info("[SocialSim] Run %s completed successfully.", run_id)

    except Exception as exc:
        err_text = traceback.format_exc()
        logger.error("[SocialSim] Run %s failed: %s", run_id, err_text)
        SocialSimRun.objects.filter(pk=run_id).update(
            status="failed",
            error=err_text[:4000],
        )


def start_simulation_thread(run_id: str) -> None:
    """Kick off the roommate compatibility simulation in a daemon thread."""
    t = threading.Thread(target=run_simulation, args=(str(run_id),), daemon=True)
    t.start()


# ── Solo EILS Life Simulation (new — triggered by LifeSimStartView) ───────────

def run_life_simulation(run_id: str) -> None:
    """
    Execute the solo EILS life simulation pipeline:
    1. Load Property model + stored assessments from the DB.
    2. Build a proper LifeSimRequest matching the domus-ai pipeline.
    3. Run the EILS engine with real apartment config, noise, thermal, neighbourhood data.
    4. Stream partial events to DB every 4 ticks for live UI updates.
    5. Tag each event with indoor/outdoor location and coordinates.
    """
    import django
    django.setup() if not django.conf.settings.configured else None

    from social_sim.models import SocialSimRun
    from social_sim.engine.persona import Persona
    from social_sim.engine.life_sim_engine import LifeSimEngine, LifeSimRequest
    from social_sim.engine.environment import Property as SimProperty, RoomEnvironment as Room

    # ── Try to use UnifiedLLMClient (TokenFactory) if available ──────────────
    try:
        from personality_builder.llm_client import UnifiedLLMClient
        import os
        llm_backend = os.getenv("LLM_BACKEND", "tokenfactory")
        llm = UnifiedLLMClient(backend=llm_backend)
        logger.info("[LifeSim] Using UnifiedLLMClient backend=%s", llm_backend)
    except Exception:
        from social_sim.engine.llm_client import OllamaLLMClient
        llm = OllamaLLMClient()
        logger.info("[LifeSim] Falling back to OllamaLLMClient")

    try:
        run = SocialSimRun.objects.get(pk=run_id)
    except SocialSimRun.DoesNotExist:
        logger.error("[LifeSim] Run %s not found", run_id)
        return

    lat = run.property_lat
    lon = run.property_lon
    sim_month = run.simulation_month or 7
    num_ticks = run.num_ticks or 24

    def _update(progress: int, status: str = "running", **fields) -> None:
        SocialSimRun.objects.filter(pk=run_id).update(
            progress=progress, status=status, **fields
        )

    try:
        _update(2, "running")
        logger.info("[LifeSim] Run %s starting (lat=%.4f, lon=%.4f, month=%s)", run_id, lat, lon, sim_month)

        # ── Load Property model if linked ─────────────────────────────────────
        prop_model = None
        if run.property_id:
            try:
                from core.models import Property as CoreProperty
                prop_model = CoreProperty.objects.get(pk=run.property_id)
            except Exception:
                logger.warning("[LifeSim] Could not load Property %s", run.property_id)

        # ── Step 1: Load or run noise assessment ──────────────────────────────
        noise_data = run.noise_assessment_data or {}
        if not noise_data:
            try:
                from social_sim.noise_assessment.noise_engine import (
                    NoiseAssessmentEngine, NoiseAssessmentRequest,
                )
                noise_engine = NoiseAssessmentEngine()
                noise_req = NoiseAssessmentRequest(lat=lat, lon=lon, radius_m=500)
                noise_resp = noise_engine.assess(noise_req)
                noise_data = noise_resp.model_dump()
                logger.info("[LifeSim] Noise assessed: level=%.2f", noise_resp.noise_level)
            except Exception as exc:
                logger.warning("[LifeSim] Noise assessment failed: %s", exc)

        geo_sources = _build_geo_sources_from_noise(noise_data, lat, lon)
        _update(10)

        # ── Step 2: Load or run neighbourhood profile ─────────────────────────
        neighbourhood_data = run.neighbourhood_profile_data or {}
        if not neighbourhood_data:
            try:
                from social_sim.neighborhood.neighborhood_profile import NeighborhoodProfileBuilder
                nb_engine = NeighborhoodProfileBuilder()
                nb_result = nb_engine.build(lat=lat, lon=lon, radius_m=1000)
                neighbourhood_data = nb_result.model_dump() if hasattr(nb_result, "model_dump") else {}
                logger.info("[LifeSim] Neighbourhood profiled")
            except Exception as exc:
                logger.warning("[LifeSim] Neighbourhood profile failed: %s", exc)

        poi_geo = _build_pois_from_neighbourhood(neighbourhood_data)
        SocialSimRun.objects.filter(pk=run_id).update(
            noise_sources_geo=geo_sources,
            neighbourhood_pois_geo=poi_geo,
            progress=18,
        )

        # ── Step 3: Load or run thermal assessment ────────────────────────────
        thermal_data = run.thermal_assessment_data or {}
        if not thermal_data:
            try:
                from social_sim.thermal.thermal_report import ThermalReportBuilder
                t_engine = ThermalReportBuilder()
                t_result = t_engine.build(
                    lat=lat, lon=lon, address="",
                    floor_number=prop_model.floor_number if prop_model else 1,
                    orientation=prop_model.orientation if prop_model else "unknown",
                    building_mass=prop_model.building_mass if prop_model else "heavy",
                    building_condition=prop_model.building_condition if prop_model else "good",
                    has_cooling=prop_model.has_cooling if prop_model else False,
                    has_heating=prop_model.has_heating if prop_model else True,
                    has_balcony=prop_model.has_balcony if prop_model else False,
                    has_windows=prop_model.has_windows if prop_model else True,
                )
                thermal_data = t_result.model_dump() if hasattr(t_result, "model_dump") else {}
                logger.info("[LifeSim] Thermal assessed")
            except Exception as exc:
                logger.warning("[LifeSim] Thermal assessment failed: %s", exc)

        _update(25)

        # ── Step 4: Build property_data dict from Property model ──────────────
        from social_sim.engine.environment import EnvironmentEngine
        env_engine = EnvironmentEngine()
        
        if prop_model:
            sim_property = env_engine.create_mock_property(
                noise_level=float(noise_data.get("noise_level", 0.4)),
                smoking_allowed=prop_model.smoking_allowed,
                building_condition=prop_model.building_condition,
                has_elevator=prop_model.has_elevator,
                floor_number=prop_model.floor_number,
                furnished=prop_model.furnished,
                has_parking=prop_model.has_parking,
                has_security=prop_model.has_security,
                internet_type=prop_model.internet_type,
            )
            sim_property.property_id = str(prop_model.pk)
            sim_property.address = prop_model.address or ""
            
            user_attributes = {
                "has_heating": prop_model.has_heating,
                "has_cooling": prop_model.has_cooling,
                "has_elevator": prop_model.has_elevator,
                "floor_number": prop_model.floor_number,
                "has_kitchen": prop_model.has_kitchen,
                "has_cleaning_supplies": prop_model.has_cleaning_supplies,
                "has_internet": prop_model.has_internet,
                "internet_type": prop_model.internet_type,
                "building_condition": prop_model.building_condition,
                "furnished": prop_model.furnished,
                "has_parking": prop_model.has_parking,
                "has_storage": prop_model.has_storage,
                "has_security": prop_model.has_security,
                "natural_light": prop_model.natural_light,
                "has_balcony": prop_model.has_balcony,
                "has_windows": prop_model.has_windows,
                "building_age_years": prop_model.building_age_years,
                "simulation_month": sim_month,
                "bus_stop_nearby": bool((neighbourhood_data.get("walkability") or {}).get("bus_stop_nearby", False)),
                "cafe_nearby": bool((neighbourhood_data.get("walk_times") or {}).get("cafe") is not None),
                "restaurant_nearby": bool((neighbourhood_data.get("walk_times") or {}).get("restaurant") is not None),
            }
        else:
            # Fallback when no Property model linked
            sim_property = env_engine.create_mock_property(
                noise_level=float(noise_data.get("noise_level", 0.4))
            )
            sim_property.property_id = "unknown"
            sim_property.address = ""
            user_attributes = {
                "has_heating": True, "has_elevator": False, "floor_number": 1,
                "has_kitchen": True, "has_cleaning_supplies": True,
                "has_internet": True, "building_condition": "good",
                "furnished": False, "simulation_month": sim_month,
                "bus_stop_nearby": True, "cafe_nearby": True, "restaurant_nearby": True,
            }

        property_data = sim_property.model_dump()
        _update(28)

        # ── Step 5: Run EILS life simulation ──────────────────────────────────
        persona_data = run.persona_a or {}
        persona = Persona.from_dict(persona_data)
        engine = LifeSimEngine(llm_client=llm)

        partial_events: list[dict] = []
        tick_counter = [0]

        def progress_cb(pct: int, msg: str, event: any = None) -> None:
            """Stream events to DB every 4 ticks."""
            tick_counter[0] += 1
            if event:
                tagged = _tag_event_location(event.model_dump() if hasattr(event, "model_dump") else event, lat, lon)
                partial_events.append(tagged)

            progress_pct = 28 + int(pct * 0.67)  # 28→95%
            if tick_counter[0] % 4 == 0 or pct >= 99:
                SocialSimRun.objects.filter(pk=run_id).update(
                    sim_events_partial=partial_events,
                    progress=min(95, progress_pct),
                )

        req = LifeSimRequest(
            mode="solo",
            persona_a=persona_data,
            property_data=property_data,
            user_attributes=user_attributes,
            noise_assessment=noise_data if noise_data else None,
            neighborhood_profile=neighbourhood_data if neighbourhood_data else None,
            thermal_report=thermal_data if thermal_data else None,
            simulation_month=sim_month,
            commute_destination=run.commute_destination or None,
            num_ticks=num_ticks,
            use_daily_plan=True,
        )

        result = engine.simulate_solo(req, progress_callback=progress_cb)

        # Tag events with indoor/outdoor location and coordinates
        tagged_events = []
        for event in result.get("events", []):
            tagged = _tag_event_location(event, lat, lon)
            tagged_events.append(tagged)
            partial_events.append(tagged)

        result["events"] = tagged_events
        _update(96)

        # ── Step 6: Persist final result ──────────────────────────────────────
        SocialSimRun.objects.filter(pk=run_id).update(
            status="completed",
            progress=100,
            result=result if isinstance(result, dict) else (result.model_dump() if hasattr(result, "model_dump") else {}),
            sim_events_partial=partial_events,
        )
        logger.info("[LifeSim] Run %s completed: %d events, %d ticks", run_id, len(partial_events), num_ticks)

    except Exception as exc:
        err_text = traceback.format_exc()
        logger.error("[LifeSim] Run %s failed: %s", run_id, err_text)
        SocialSimRun.objects.filter(pk=run_id).update(
            status="failed",
            error=err_text[:4000],
        )


def start_life_sim_thread(run_id: str) -> None:
    """Kick off the solo EILS life simulation in a daemon thread."""
    t = threading.Thread(target=run_life_simulation, args=(str(run_id),), daemon=True)
    t.start()


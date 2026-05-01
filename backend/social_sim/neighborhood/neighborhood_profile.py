"""Neighborhood profile assembly from POI, transport, and travel intelligence."""

from __future__ import annotations

from datetime import datetime
import logging
import os
from typing import Any

from pydantic import BaseModel

from social_sim.noise_assessment.cache import NoiseCache
from .poi_fetcher import POIFetcher
from .transport_network import TransportNetworkFetcher
from .travel_time import TravelTimeCalculator
from .walkability_scorer import WalkabilityScorer


logger = logging.getLogger(__name__)


class NeighborhoodProfile(BaseModel):
    lat: float
    lon: float
    address: str

    poi_catalog: dict[str, list[dict[str, Any]]]
    nearest_by_category: dict[str, dict[str, Any]]

    transport: dict[str, Any]

    walkability: dict[str, Any]
    noise_level: float

    walk_times: dict[str, float]
    emergency_accessibility: dict[str, Any]

    commute: dict[str, Any] | None = None

    profile_timestamp: str
    data_sources: list[str]


class NeighborhoodProfileBuilder:
    """Builds complete neighborhood context payloads for apartment simulation."""

    def __init__(self) -> None:
        self.poi_fetcher = POIFetcher()
        self.travel_calc = TravelTimeCalculator()
        self.transport_fetcher = TransportNetworkFetcher()
        self.walkability_scorer = WalkabilityScorer()
        self.cache = self._init_cache()

    @staticmethod
    def _init_cache() -> NoiseCache:
        previous_cache_dir = os.getenv("NOISE_CACHE_DIR")
        previous_ttl = os.getenv("NOISE_CACHE_TTL_HOURS")
        os.environ["NOISE_CACHE_DIR"] = "./neighborhood_cache"
        os.environ["NOISE_CACHE_TTL_HOURS"] = "48"
        try:
            return NoiseCache()
        finally:
            if previous_cache_dir is None:
                os.environ.pop("NOISE_CACHE_DIR", None)
            else:
                os.environ["NOISE_CACHE_DIR"] = previous_cache_dir

            if previous_ttl is None:
                os.environ.pop("NOISE_CACHE_TTL_HOURS", None)
            else:
                os.environ["NOISE_CACHE_TTL_HOURS"] = previous_ttl

    def build(
        self,
        lat: float,
        lon: float,
        address: str = "",
        commute_destination: str | None = None,
        noise_assessment: dict[str, Any] | None = None,
        radius_m: int = 1000,
        force_refresh: bool = False,
        progress_callback: Any = None,
    ) -> NeighborhoodProfile:
        cache_key = f"{float(lat):.4f},{float(lon):.4f}"
        if not force_refresh:
            cached = self.cache.get(cache_key, radius_m)
            if cached:
                return NeighborhoodProfile(**cached)

        if progress_callback:
            progress_callback(10, "Fetching nearby POIs...")

        raw_pois = self.poi_fetcher.fetch_all_categories(lat=lat, lon=lon, radius_m=radius_m)
        nearest_pois = self.poi_fetcher.get_nearest_per_category(lat=lat, lon=lon, radius_m=radius_m)

        if progress_callback:
            progress_callback(30, "Computing travel times...")

        walk_times: dict[str, float] = {}
        all_nearest = [poi for poi in nearest_pois.values() if poi is not None]

        if all_nearest:
            travel_results = self.travel_calc.compute_batch(
                origin_lat=lat,
                origin_lon=lon,
                destinations=all_nearest,
            )
            for result in travel_results:
                if result.walk_time_min is not None:
                    walk_times[result.destination_category] = float(result.walk_time_min)
                elif result.walk_distance_m is not None:
                    walk_times[result.destination_category] = float(result.walk_distance_m) / 1000.0 / 5.0 * 60.0

        if progress_callback:
            progress_callback(55, "Analyzing transport network...")

        transport = self.transport_fetcher.fetch(lat=lat, lon=lon, radius_m=radius_m)

        if progress_callback:
            progress_callback(70, "Computing walkability score...")

        walkability = self.walkability_scorer.score(nearest_pois)

        if progress_callback:
            progress_callback(85, "Computing commute time...")

        commute: dict[str, Any] | None = None
        if commute_destination:
            try:
                commute = self.travel_calc.compute_commute_time(
                    origin_lat=lat,
                    origin_lon=lon,
                    destination_address=commute_destination,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Commute computation failed: %s", exc)
                commute = {
                    "destination": commute_destination,
                    "walk_time_min": None,
                    "drive_time_min": None,
                    "walk_feasible": False,
                    "drive_feasible": False,
                    "recommendation": "transit",
                    "error": str(exc),
                }

        emergency = {
            "hospital_walk_min": walk_times.get("hospital"),
            "pharmacy_walk_min": walk_times.get("pharmacy"),
            "clinic_walk_min": walk_times.get("clinic"),
            "score": self._compute_emergency_score(walk_times),
        }

        if progress_callback:
            progress_callback(100, "Profile complete.")

        poi_catalog: dict[str, list[dict[str, Any]]] = {
            category: [poi.model_dump() for poi in pois]
            for category, pois in raw_pois.items()
        }

        nearest_by_category: dict[str, dict[str, Any]] = {
            category: poi.model_dump()
            for category, poi in nearest_pois.items()
            if poi is not None
        }

        profile = NeighborhoodProfile(
            lat=lat,
            lon=lon,
            address=address,
            poi_catalog=poi_catalog,
            nearest_by_category=nearest_by_category,
            transport=transport.model_dump(),
            walkability=walkability.model_dump(),
            noise_level=float((noise_assessment or {}).get("noise_level", 0.4)),
            walk_times=walk_times,
            emergency_accessibility=emergency,
            commute=commute,
            profile_timestamp=datetime.now().isoformat(),
            data_sources=[
                "overpass_osm",
                "openrouteservice" if self.travel_calc.available else "fallback_estimates",
            ],
        )

        self.cache.set(cache_key, radius_m, profile.model_dump())
        return profile

    def _compute_emergency_score(self, walk_times: dict[str, float]) -> float:
        hospital_time = float(walk_times.get("hospital", 60.0))
        pharmacy_time = float(walk_times.get("pharmacy", 30.0))
        clinic_time = float(walk_times.get("clinic", 20.0))

        hospital_score = max(0.0, 1.0 - (hospital_time / 60.0))
        pharmacy_score = max(0.0, 1.0 - (pharmacy_time / 30.0))
        clinic_score = max(0.0, 1.0 - (clinic_time / 30.0))

        return (hospital_score * 0.5) + (pharmacy_score * 0.3) + (clinic_score * 0.2)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")

    builder = NeighborhoodProfileBuilder()
    profile = builder.build(
        lat=36.8065,
        lon=10.1815,
        address="Avenue Habib Bourguiba, Tunis",
        radius_m=1000,
    )

    walkability_score = float(profile.walkability.get("overall_score", 0.0))
    walkability_label = str(profile.walkability.get("label", "unknown"))
    mobility_score = float(profile.transport.get("mobility_score", 0.0))
    emergency_score = float(profile.emergency_accessibility.get("score", 0.0))

    print(f"Walkability: {walkability_score:.3f} ({walkability_label})")
    print(f"Walk time to hospital: {profile.walk_times.get('hospital')}")
    print(f"Walk time to supermarket: {profile.walk_times.get('supermarket')}")
    print(f"Walk time to cafe: {profile.walk_times.get('cafe')}")
    print(f"Transport mobility score: {mobility_score:.3f}")
    print(f"Emergency accessibility score: {emergency_score:.3f}")

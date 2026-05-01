"""OpenRouteService routing and travel time utilities."""

from __future__ import annotations

import logging
import os
import time
from math import atan2, cos, pi, radians, sin, sqrt
from typing import Any

from pydantic import BaseModel

from social_sim.noise_assessment.cache import NoiseCache
from social_sim.noise_assessment.geocoder import PropertyGeocoder
from .poi_fetcher import POIResult


logger = logging.getLogger(__name__)


class TravelTimeResult(BaseModel):
    origin_lat: float
    origin_lon: float
    destination_lat: float
    destination_lon: float
    destination_name: str
    destination_category: str
    walk_time_min: float | None = None
    drive_time_min: float | None = None
    walk_distance_m: float | None = None
    drive_distance_m: float | None = None
    reachable_by_walk: bool
    reachable_by_drive: bool


class TravelTimeCalculator:
    def __init__(self) -> None:
        self.ors_api_key = str(os.getenv("ORS_API_KEY", "")).strip()
        self.available = False
        self.client: Any | None = None

        if not self.ors_api_key:
            logger.warning("ORS_API_KEY not set. Travel times will use fallback estimates.")
        else:
            try:
                import openrouteservice

                self.client = openrouteservice.Client(key=self.ors_api_key)
                self.available = True
            except Exception as exc:  # noqa: BLE001
                logger.info("OpenRouteService unavailable (using haversine fallback): %s", exc)

        self.cache = self._init_cache()

    @staticmethod
    def _init_cache() -> NoiseCache:
        previous_cache_dir = os.getenv("NOISE_CACHE_DIR")
        previous_ttl = os.getenv("NOISE_CACHE_TTL_HOURS")
        os.environ["NOISE_CACHE_DIR"] = "./travel_cache"
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

    @staticmethod
    def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        radius_earth_m = 6371000.0
        d_lat = radians(lat2 - lat1)
        d_lon = radians(lon2 - lon1)
        lat1_r = radians(lat1)
        lat2_r = radians(lat2)

        hav = sin(d_lat / 2) ** 2 + cos(lat1_r) * cos(lat2_r) * sin(d_lon / 2) ** 2
        c = 2 * atan2(sqrt(hav), sqrt(1 - hav))
        return radius_earth_m * c

    def _cache_key(
        self,
        origin_lat: float,
        origin_lon: float,
        dest_lat: float,
        dest_lon: float,
        dest_name: str,
        dest_category: str,
    ) -> str:
        return (
            f"{origin_lat:.6f},{origin_lon:.6f}|"
            f"{dest_lat:.6f},{dest_lon:.6f}|"
            f"{dest_name.strip().lower()}|{dest_category.strip().lower()}"
        )

    def _fallback_estimate(self, distance_m: float) -> dict[str, float | str]:
        corrected_distance = float(distance_m) * 1.4
        walk_time_min = ((float(distance_m) / 1000.0) / 5.0) * 60.0 * 1.4
        drive_time_min = ((float(distance_m) / 1000.0) / 30.0) * 60.0 * 1.4
        return {
            "walk_time_min": walk_time_min,
            "drive_time_min": drive_time_min,
            "walk_distance_m": corrected_distance,
            "drive_distance_m": corrected_distance,
            "source": "fallback_estimate",
        }

    def compute_single(
        self,
        origin_lat: float,
        origin_lon: float,
        dest_lat: float,
        dest_lon: float,
        dest_name: str,
        dest_category: str,
    ) -> TravelTimeResult:
        key = self._cache_key(
            origin_lat=origin_lat,
            origin_lon=origin_lon,
            dest_lat=dest_lat,
            dest_lon=dest_lon,
            dest_name=dest_name,
            dest_category=dest_category,
        )
        cached = self.cache.get(identifier=key, radius_m=0)
        if cached:
            return TravelTimeResult(**cached)

        walk_time_min: float | None = None
        drive_time_min: float | None = None
        walk_distance_m: float | None = None
        drive_distance_m: float | None = None

        if self.available and self.client is not None:
            try:
                matrix_walk = self.client.distance_matrix(
                    locations=[[origin_lon, origin_lat], [dest_lon, dest_lat]],
                    profile="foot-walking",
                    metrics=["duration", "distance"],
                    sources=[0],
                    destinations=[1],
                )
                walk_time_min = float(matrix_walk["durations"][0][0]) / 60.0
                walk_distance_m = float(matrix_walk["distances"][0][0])

                time.sleep(0.5)

                matrix_drive = self.client.distance_matrix(
                    locations=[[origin_lon, origin_lat], [dest_lon, dest_lat]],
                    profile="driving-car",
                    metrics=["duration", "distance"],
                    sources=[0],
                    destinations=[1],
                )
                drive_time_min = float(matrix_drive["durations"][0][0]) / 60.0
                drive_distance_m = float(matrix_drive["distances"][0][0])
            except Exception as exc:  # noqa: BLE001
                logger.warning("ORS single route failed, falling back to estimate: %s", exc)

        if walk_time_min is None or drive_time_min is None:
            straight_distance = self._haversine(origin_lat, origin_lon, dest_lat, dest_lon)
            fallback = self._fallback_estimate(straight_distance)
            walk_time_min = float(fallback["walk_time_min"])
            drive_time_min = float(fallback["drive_time_min"])
            walk_distance_m = float(fallback["walk_distance_m"])
            drive_distance_m = float(fallback["drive_distance_m"])

        result = TravelTimeResult(
            origin_lat=origin_lat,
            origin_lon=origin_lon,
            destination_lat=dest_lat,
            destination_lon=dest_lon,
            destination_name=dest_name,
            destination_category=dest_category,
            walk_time_min=walk_time_min,
            drive_time_min=drive_time_min,
            walk_distance_m=walk_distance_m,
            drive_distance_m=drive_distance_m,
            reachable_by_walk=bool(walk_time_min < 30.0),
            reachable_by_drive=bool(drive_time_min < 20.0),
        )
        self.cache.set(identifier=key, radius_m=0, result=result.model_dump())
        return result

    def compute_batch(
        self,
        origin_lat: float,
        origin_lon: float,
        destinations: list[POIResult],
    ) -> list[TravelTimeResult]:
        if not destinations:
            return []

        results: list[TravelTimeResult | None] = [None] * len(destinations)
        pending: list[tuple[int, POIResult]] = []

        for index, destination in enumerate(destinations):
            key = self._cache_key(
                origin_lat=origin_lat,
                origin_lon=origin_lon,
                dest_lat=destination.lat,
                dest_lon=destination.lon,
                dest_name=destination.name,
                dest_category=destination.category,
            )
            cached = self.cache.get(identifier=key, radius_m=0)
            if cached:
                results[index] = TravelTimeResult(**cached)
            else:
                pending.append((index, destination))

        if not pending:
            return [item for item in results if item is not None]

        if not self.available or self.client is None:
            for index, destination in pending:
                results[index] = self.compute_single(
                    origin_lat=origin_lat,
                    origin_lon=origin_lon,
                    dest_lat=destination.lat,
                    dest_lon=destination.lon,
                    dest_name=destination.name,
                    dest_category=destination.category,
                )
            return [item for item in results if item is not None]

        chunk_size = 24
        for chunk_start in range(0, len(pending), chunk_size):
            chunk = pending[chunk_start: chunk_start + chunk_size]
            locations = [[origin_lon, origin_lat]] + [[d.lon, d.lat] for _, d in chunk]
            destination_indexes = list(range(1, len(locations)))

            try:
                matrix_walk = self.client.distance_matrix(
                    locations=locations,
                    profile="foot-walking",
                    metrics=["duration", "distance"],
                    sources=[0],
                    destinations=destination_indexes,
                )
                time.sleep(1)
                matrix_drive = self.client.distance_matrix(
                    locations=locations,
                    profile="driving-car",
                    metrics=["duration", "distance"],
                    sources=[0],
                    destinations=destination_indexes,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("ORS batch matrix failed, falling back for chunk: %s", exc)
                for index, destination in chunk:
                    results[index] = self.compute_single(
                        origin_lat=origin_lat,
                        origin_lon=origin_lon,
                        dest_lat=destination.lat,
                        dest_lon=destination.lon,
                        dest_name=destination.name,
                        dest_category=destination.category,
                    )
                continue

            walk_durations = matrix_walk.get("durations", [[None]])[0]
            walk_distances = matrix_walk.get("distances", [[None]])[0]
            drive_durations = matrix_drive.get("durations", [[None]])[0]
            drive_distances = matrix_drive.get("distances", [[None]])[0]

            for local_idx, (global_index, destination) in enumerate(chunk):
                walk_duration_s = walk_durations[local_idx] if local_idx < len(walk_durations) else None
                walk_distance_m = walk_distances[local_idx] if local_idx < len(walk_distances) else None
                drive_duration_s = drive_durations[local_idx] if local_idx < len(drive_durations) else None
                drive_distance_m = drive_distances[local_idx] if local_idx < len(drive_distances) else None

                if walk_duration_s is None or drive_duration_s is None:
                    results[global_index] = self.compute_single(
                        origin_lat=origin_lat,
                        origin_lon=origin_lon,
                        dest_lat=destination.lat,
                        dest_lon=destination.lon,
                        dest_name=destination.name,
                        dest_category=destination.category,
                    )
                    continue

                result = TravelTimeResult(
                    origin_lat=origin_lat,
                    origin_lon=origin_lon,
                    destination_lat=destination.lat,
                    destination_lon=destination.lon,
                    destination_name=destination.name,
                    destination_category=destination.category,
                    walk_time_min=float(walk_duration_s) / 60.0,
                    drive_time_min=float(drive_duration_s) / 60.0,
                    walk_distance_m=float(walk_distance_m) if walk_distance_m is not None else None,
                    drive_distance_m=float(drive_distance_m) if drive_distance_m is not None else None,
                    reachable_by_walk=bool((float(walk_duration_s) / 60.0) < 30.0),
                    reachable_by_drive=bool((float(drive_duration_s) / 60.0) < 20.0),
                )
                key = self._cache_key(
                    origin_lat=origin_lat,
                    origin_lon=origin_lon,
                    dest_lat=destination.lat,
                    dest_lon=destination.lon,
                    dest_name=destination.name,
                    dest_category=destination.category,
                )
                self.cache.set(identifier=key, radius_m=0, result=result.model_dump())
                results[global_index] = result

            time.sleep(1)

        return [item for item in results if item is not None]

    def compute_isochrone(
        self,
        origin_lat: float,
        origin_lon: float,
        range_minutes: list[int] | None = None,
        profile: str = "foot-walking",
    ) -> dict[str, Any]:
        range_minutes = range_minutes or [5, 10, 15, 20]

        if self.available and self.client is not None:
            try:
                return self.client.isochrones(
                    locations=[[origin_lon, origin_lat]],
                    profile=profile,
                    range_type="time",
                    range=[int(value) * 60 for value in range_minutes],
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("ORS isochrone failed, using fallback circles: %s", exc)

        features: list[dict[str, Any]] = []
        for minutes in range_minutes:
            radius_m = (float(minutes) / 60.0) * 5000.0 / 1.4
            polygon = self._circle_polygon(lon=origin_lon, lat=origin_lat, radius_m=radius_m)
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "range_minutes": int(minutes),
                        "profile": profile,
                        "source": "fallback_estimate",
                    },
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [polygon],
                    },
                }
            )

        return {
            "type": "FeatureCollection",
            "features": features,
        }

    def compute_commute_time(
        self,
        origin_lat: float,
        origin_lon: float,
        destination_address: str,
    ) -> dict[str, Any]:
        geocoder = PropertyGeocoder()
        geocoded = geocoder.geocode_address(destination_address)

        travel_result = self.compute_single(
            origin_lat=origin_lat,
            origin_lon=origin_lon,
            dest_lat=geocoded.lat,
            dest_lon=geocoded.lon,
            dest_name=geocoded.display_name,
            dest_category="commute",
        )

        walk_time = travel_result.walk_time_min
        drive_time = travel_result.drive_time_min
        walk_feasible = bool(walk_time is not None and walk_time < 45.0)
        drive_feasible = bool(drive_time is not None and drive_time < 45.0)

        recommendation = "transit"
        if walk_feasible:
            recommendation = "walk"
        elif drive_feasible:
            recommendation = "drive"

        return {
            "destination": geocoded.display_name,
            "walk_time_min": walk_time,
            "drive_time_min": drive_time,
            "walk_feasible": walk_feasible,
            "drive_feasible": drive_feasible,
            "recommendation": recommendation,
        }

    @staticmethod
    def _circle_polygon(lon: float, lat: float, radius_m: float, steps: int = 36) -> list[list[float]]:
        lat_rad = radians(lat)
        lon_scale = max(0.000001, cos(lat_rad))
        deg_per_meter_lat = 1.0 / 111320.0
        deg_per_meter_lon = 1.0 / (111320.0 * lon_scale)

        points: list[list[float]] = []
        for idx in range(steps + 1):
            angle = 2.0 * pi * (idx / steps)
            dx = radius_m * cos(angle)
            dy = radius_m * sin(angle)
            points.append([
                lon + (dx * deg_per_meter_lon),
                lat + (dy * deg_per_meter_lat),
            ])
        return points


class TravelTimeEngine(TravelTimeCalculator):
    pass


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")

    origin_lat = 36.8065
    origin_lon = 10.1815
    calculator = TravelTimeCalculator()

    if not calculator.available:
        print("ORS key not available. Using fallback estimates.")

    targets = [
        {
            "name": "Hôpital Charles Nicolle",
            "category": "hospital",
            "lat": 36.8089,
            "lon": 10.1565,
        },
        {
            "name": "Supermarket Mock",
            "category": "supermarket",
            "lat": 36.8042,
            "lon": 10.1885,
        },
        {
            "name": "Cafe Mock",
            "category": "cafe",
            "lat": 36.8048,
            "lon": 10.1790,
        },
    ]

    for target in targets:
        result = calculator.compute_single(
            origin_lat=origin_lat,
            origin_lon=origin_lon,
            dest_lat=target["lat"],
            dest_lon=target["lon"],
            dest_name=target["name"],
            dest_category=target["category"],
        )
        print(
            f"{target['name']}: walk={result.walk_time_min:.1f} min, "
            f"drive={result.drive_time_min:.1f} min, "
            f"walk_reachable={result.reachable_by_walk}"
        )

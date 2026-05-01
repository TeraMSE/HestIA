"""Overpass-based point-of-interest fetcher for neighborhood intelligence."""

from __future__ import annotations

from collections import defaultdict
import logging
from math import atan2, cos, radians, sin, sqrt
import os
import time
from typing import Any

import requests
from pydantic import BaseModel


logger = logging.getLogger(__name__)


POI_CATEGORIES: dict[str, dict[str, Any]] = {
    "hospital": {
        "osm_query": 'node["amenity"="hospital"]',
        "simulation_relevance": "emergency",
        "urgency_weight": 1.0,
    },
    "clinic": {
        "osm_query": 'node["amenity"~"clinic|doctors|health_centre"]',
        "simulation_relevance": "health",
        "urgency_weight": 0.8,
    },
    "pharmacy": {
        "osm_query": 'node["amenity"="pharmacy"]',
        "simulation_relevance": "health",
        "urgency_weight": 0.7,
    },
    "dentist": {
        "osm_query": 'node["amenity"="dentist"]',
        "simulation_relevance": "health",
        "urgency_weight": 0.5,
    },
    "supermarket": {
        "osm_query": 'node["shop"~"supermarket|grocery"]',
        "simulation_relevance": "daily",
        "urgency_weight": 0.6,
    },
    "bakery": {
        "osm_query": 'node["shop"="bakery"]',
        "simulation_relevance": "daily",
        "urgency_weight": 0.4,
    },
    "cafe": {
        "osm_query": 'node["amenity"="cafe"]',
        "simulation_relevance": "social",
        "urgency_weight": 0.3,
    },
    "restaurant": {
        "osm_query": 'node["amenity"="restaurant"]',
        "simulation_relevance": "social",
        "urgency_weight": 0.3,
    },
    "fast_food": {
        "osm_query": 'node["amenity"="fast_food"]',
        "simulation_relevance": "daily",
        "urgency_weight": 0.25,
    },
    "bus_stop": {
        "osm_query": 'node["highway"="bus_stop"]',
        "simulation_relevance": "mobility",
        "urgency_weight": 0.8,
    },
    "metro_station": {
        "osm_query": 'node["station"~"subway|metro"]',
        "simulation_relevance": "mobility",
        "urgency_weight": 0.9,
    },
    "tram_stop": {
        "osm_query": 'node["railway"~"tram_stop|halt"]',
        "simulation_relevance": "mobility",
        "urgency_weight": 0.7,
    },
    "taxi_stand": {
        "osm_query": 'node["amenity"="taxi"]',
        "simulation_relevance": "mobility",
        "urgency_weight": 0.5,
    },
    "school": {
        "osm_query": 'node["amenity"~"school|kindergarten"]',
        "simulation_relevance": "routine",
        "urgency_weight": 0.7,
    },
    "university": {
        "osm_query": 'node["amenity"="university"]',
        "simulation_relevance": "routine",
        "urgency_weight": 0.8,
    },
    "library": {
        "osm_query": 'node["amenity"="library"]',
        "simulation_relevance": "enrichment",
        "urgency_weight": 0.3,
    },
    "bank": {
        "osm_query": 'node["amenity"="bank"]',
        "simulation_relevance": "admin",
        "urgency_weight": 0.5,
    },
    "atm": {
        "osm_query": 'node["amenity"="atm"]',
        "simulation_relevance": "daily",
        "urgency_weight": 0.5,
    },
    "post_office": {
        "osm_query": 'node["amenity"="post_office"]',
        "simulation_relevance": "admin",
        "urgency_weight": 0.4,
    },
    "government": {
        "osm_query": 'node["amenity"~"townhall|courthouse|government"]',
        "simulation_relevance": "admin",
        "urgency_weight": 0.4,
    },
    "park": {
        "osm_query": 'node["leisure"="park"]',
        "simulation_relevance": "leisure",
        "urgency_weight": 0.4,
    },
    "gym": {
        "osm_query": 'node["leisure"~"fitness_centre|sports_centre"]',
        "simulation_relevance": "leisure",
        "urgency_weight": 0.4,
    },
    "coworking": {
        "osm_query": 'node["amenity"~"coworking_space|office"]',
        "simulation_relevance": "work",
        "urgency_weight": 0.5,
    },
    "place_of_worship": {
        "osm_query": 'node["amenity"="place_of_worship"]',
        "simulation_relevance": "spiritual",
        "urgency_weight": 0.4,
    },
    "bar": {
        "osm_query": 'node["amenity"="bar"]',
        "simulation_relevance": "social",
        "urgency_weight": 0.2,
    },
    "nightclub": {
        "osm_query": 'node["amenity"="nightclub"]',
        "simulation_relevance": "social",
        "urgency_weight": 0.2,
    },
}


class POIResult(BaseModel):
    category: str
    name: str
    osm_id: int
    lat: float
    lon: float
    distance_m: float
    walk_time_min: float | None = None
    transit_time_min: float | None = None
    simulation_relevance: str
    urgency_weight: float


class POIFetcher:
    OVERPASS_URL = os.getenv(
        "OVERPASS_URL",
        "https://overpass-api.de/api/interpreter",
    )

    def __init__(self) -> None:
        self.timeout_seconds = 60
        self.max_retries = 2
        self.retry_delay_seconds = 1.2
        self.session = requests.Session()
        # Note: Do NOT set Accept: application/json — overpass-api.de returns 406.
        # JSON output is requested via [out:json] in the query itself.
        self.session.headers.update(
            {
                "User-Agent": os.getenv(
                    "OVERPASS_USER_AGENT",
                    "HestIA/1.0 (neighborhood-intelligence; contact=hestia@localhost)",
                ),
            }
        )
        self.overpass_endpoints = self._build_overpass_endpoints()

    def _build_overpass_endpoints(self) -> list[str]:
        configured_list_raw = str(os.getenv("OVERPASS_ENDPOINTS", "")).strip()
        configured_list = [
            item.strip() for item in configured_list_raw.split(",") if item.strip()
        ]
        configured = str(self.OVERPASS_URL).strip()
        fallbacks = [
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass.openstreetmap.fr/api/interpreter",
        ]
        endpoints: list[str] = []
        for item in configured_list:
            if item not in endpoints:
                endpoints.append(item)
        if configured:
            endpoints.append(configured)
        for item in fallbacks:
            if item not in endpoints:
                endpoints.append(item)
        return endpoints

    def fetch_category(
        self,
        lat: float,
        lon: float,
        category: str,
        radius_m: int = 1000,
        limit: int = 5,
    ) -> list[POIResult]:
        if category not in POI_CATEGORIES:
            raise ValueError(f"Unknown POI category: {category}")

        category_cfg = POI_CATEGORIES[category]
        osm_query = str(category_cfg["osm_query"])
        query = (
            "[out:json][timeout:60];\n"
            "(\n"
            f"  {osm_query}(around:{int(radius_m)},{float(lat)},{float(lon)});\n"
            ");\n"
            "out center;"
        )
        payload = self._post_overpass(query)
        elements = payload.get("elements", []) or []

        results: list[POIResult] = []
        for element in elements:
            parsed = self._parse_element(element, center_lat=lat, center_lon=lon)
            if parsed is None:
                continue
            results.append(
                POIResult(
                    category=category,
                    name=parsed["name"],
                    osm_id=parsed["osm_id"],
                    lat=parsed["lat"],
                    lon=parsed["lon"],
                    distance_m=parsed["distance_m"],
                    simulation_relevance=str(category_cfg["simulation_relevance"]),
                    urgency_weight=float(category_cfg["urgency_weight"]),
                )
            )

        results.sort(key=lambda item: item.distance_m)
        return results[: max(0, int(limit))]

    def fetch_all_categories(
        self,
        lat: float,
        lon: float,
        radius_m: int = 1000,
    ) -> dict[str, list[POIResult]]:
        query_parts: list[str] = []
        for config in POI_CATEGORIES.values():
            osm_query = str(config["osm_query"])
            query_parts.append(
                f"  {osm_query}(around:{int(radius_m)},{float(lat)},{float(lon)});"
            )


        joined_parts = "\n".join(query_parts)
        query = (
            "[out:json][timeout:60];\n"
            "(\n"
            f"{joined_parts}\n"
            ");\n"
            "out center;"
        )

        payload = self._post_overpass(query)
        elements = payload.get("elements", []) or []

        categorized: dict[str, list[POIResult]] = defaultdict(list)
        for element in elements:
            parsed = self._parse_element(element, center_lat=lat, center_lon=lon)
            if parsed is None:
                continue

            tags = parsed["tags"]
            category = self._match_category(tags)
            if category is None:
                continue

            config = POI_CATEGORIES[category]
            categorized[category].append(
                POIResult(
                    category=category,
                    name=parsed["name"],
                    osm_id=parsed["osm_id"],
                    lat=parsed["lat"],
                    lon=parsed["lon"],
                    distance_m=parsed["distance_m"],
                    simulation_relevance=str(config["simulation_relevance"]),
                    urgency_weight=float(config["urgency_weight"]),
                )
            )

        output: dict[str, list[POIResult]] = {category: [] for category in POI_CATEGORIES}
        for category, items in categorized.items():
            output[category] = sorted(items, key=lambda poi: poi.distance_m)
        return output

    def get_nearest_per_category(
        self,
        lat: float,
        lon: float,
        radius_m: int = 1000,
    ) -> dict[str, POIResult | None]:
        all_results = self.fetch_all_categories(lat=lat, lon=lon, radius_m=radius_m)
        nearest: dict[str, POIResult | None] = {}
        for category in POI_CATEGORIES:
            category_results = all_results.get(category, [])
            nearest[category] = category_results[0] if category_results else None
        return nearest

    def _post_overpass(self, query: str) -> dict[str, Any]:
        last_error: Exception | None = None
        failures: list[str] = []
        for endpoint in self.overpass_endpoints:
            for attempt in range(1, self.max_retries + 1):
                try:
                    response = self.session.post(
                        endpoint,
                        data={"data": query},
                        timeout=self.timeout_seconds,
                    )
                    response.raise_for_status()
                    return response.json() or {}
                except Exception as exc:  # noqa: BLE001
                    last_error = exc
                    resp_obj = getattr(exc, "response", None)
                    status_code = getattr(resp_obj, "status_code", None)
                    failures.append(f"{endpoint} (attempt {attempt}): {exc}")
                    logger.warning(
                        "POI Overpass fetch failed (endpoint=%s, attempt=%s/%s): %s",
                        endpoint,
                        attempt,
                        self.max_retries,
                        exc,
                    )
                    # Skip immediately to next endpoint on hard errors
                    if status_code in (403, 406, 429, 503):
                        logger.debug("HTTP %s on %s — skipping to next endpoint", status_code, endpoint)
                        break
                    if attempt < self.max_retries:
                        time.sleep(self.retry_delay_seconds)

        if failures:
            raise RuntimeError(
                "Overpass POI fetch failed across endpoints: " + " | ".join(failures)
            ) from last_error
        raise RuntimeError("Overpass POI fetch failed without explicit error")

    def _parse_element(
        self,
        element: dict[str, Any],
        center_lat: float,
        center_lon: float,
    ) -> dict[str, Any] | None:
        element_type = str(element.get("type", "")).strip().lower()
        if element_type == "node":
            lat = element.get("lat")
            lon = element.get("lon")
        else:
            center = element.get("center") or {}
            lat = center.get("lat")
            lon = center.get("lon")

        if lat is None or lon is None:
            return None

        lat_f = float(lat)
        lon_f = float(lon)
        tags = element.get("tags") or {}
        return {
            "osm_id": int(element.get("id", 0)),
            "lat": lat_f,
            "lon": lon_f,
            "distance_m": self._haversine(center_lat, center_lon, lat_f, lon_f),
            "name": str(tags.get("name", "") or ""),
            "tags": {str(k): str(v).lower() for k, v in tags.items()},
        }

    def _match_category(self, tags: dict[str, str]) -> str | None:
        amenity = tags.get("amenity", "")
        shop = tags.get("shop", "")
        station = tags.get("station", "")
        railway = tags.get("railway", "")
        highway = tags.get("highway", "")
        leisure = tags.get("leisure", "")

        if amenity == "hospital":
            return "hospital"
        if amenity in {"clinic", "doctors", "health_centre"}:
            return "clinic"
        if amenity == "pharmacy":
            return "pharmacy"
        if amenity == "dentist":
            return "dentist"

        if shop in {"supermarket", "grocery"}:
            return "supermarket"
        if shop == "bakery":
            return "bakery"
        if amenity == "cafe":
            return "cafe"
        if amenity == "restaurant":
            return "restaurant"
        if amenity == "fast_food":
            return "fast_food"

        if highway == "bus_stop":
            return "bus_stop"
        if station in {"subway", "metro"}:
            return "metro_station"
        if railway in {"tram_stop", "halt"}:
            return "tram_stop"
        if amenity == "taxi":
            return "taxi_stand"

        if amenity in {"school", "kindergarten"}:
            return "school"
        if amenity == "university":
            return "university"
        if amenity == "library":
            return "library"

        if amenity == "bank":
            return "bank"
        if amenity == "atm":
            return "atm"
        if amenity == "post_office":
            return "post_office"
        if amenity in {"townhall", "courthouse", "government"}:
            return "government"

        if leisure == "park":
            return "park"
        if leisure in {"fitness_centre", "sports_centre"}:
            return "gym"
        if amenity in {"coworking_space", "office"}:
            return "coworking"
        if amenity == "place_of_worship":
            return "place_of_worship"

        if amenity == "bar":
            return "bar"
        if amenity == "nightclub":
            return "nightclub"

        return None

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


if __name__ == "__main__":
    center_lat = 36.8065
    center_lon = 10.1815

    fetcher = POIFetcher()
    nearest = fetcher.get_nearest_per_category(
        lat=center_lat,
        lon=center_lon,
        radius_m=1000,
    )

    print("Nearest POI per category around Avenue Habib Bourguiba, Tunis:")
    for category in POI_CATEGORIES:
        item = nearest.get(category)
        if item is None:
            print(f"- {category}: none")
            continue
        print(f"- {category}: {item.distance_m:.1f}m | {item.name or '(unnamed)'}")

"""Public transport network discovery utilities for neighborhood context."""

from __future__ import annotations

import logging
from math import atan2, cos, radians, sin, sqrt
import os
import time
from typing import Any

import requests
from pydantic import BaseModel


logger = logging.getLogger(__name__)


class TransportStop(BaseModel):
    stop_id: int
    name: str
    stop_type: str
    lat: float
    lon: float
    distance_m: float
    lines: list[str]
    walk_time_min: float | None = None


class TransportLine(BaseModel):
    line_id: int
    name: str
    ref: str
    route_type: str
    operator: str | None = None


class TransportNetworkResult(BaseModel):
    center_lat: float
    center_lon: float
    radius_m: int
    stops: list[TransportStop]
    lines_serving_area: list[TransportLine]
    nearest_stop: TransportStop | None = None
    nearest_stop_walk_time: float | None = None
    total_lines_count: int
    transport_types_available: list[str]
    mobility_score: float


class TransportNetworkFetcher:
    OVERPASS_URL = os.getenv(
        "OVERPASS_URL",
        "https://overpass-api.de/api/interpreter",
    )

    def __init__(self) -> None:
        self.timeout_seconds = 60
        self.max_retries = 2
        self.retry_delay_seconds = 1.2
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": os.getenv(
                    "OVERPASS_USER_AGENT",
                    "DomusAI/1.0 (neighborhood-scan)",
                ),
                "Accept": "application/json",
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

    def fetch(self, lat: float, lon: float, radius_m: int = 500) -> TransportNetworkResult:
        query = self._build_query(lat=lat, lon=lon, radius_m=radius_m)

        try:
            payload = self._post_overpass(query)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Transport network fetch failed: %s", exc)
            return TransportNetworkResult(
                center_lat=lat,
                center_lon=lon,
                radius_m=int(radius_m),
                stops=[],
                lines_serving_area=[],
                nearest_stop=None,
                nearest_stop_walk_time=None,
                total_lines_count=0,
                transport_types_available=[],
                mobility_score=0.0,
            )

        elements = payload.get("elements", []) or []
        stops: list[TransportStop] = []
        lines: list[TransportLine] = []

        for element in elements:
            element_type = str(element.get("type", "")).lower().strip()
            if element_type == "node":
                stop = self._parse_stop(element=element, center_lat=lat, center_lon=lon)
                if stop is not None:
                    stops.append(stop)
            elif element_type == "relation":
                line = self._parse_line(element=element)
                if line is not None:
                    lines.append(line)

        stops.sort(key=lambda item: item.distance_m)
        nearest_stop = stops[0] if stops else None
        nearest_stop_walk_time = nearest_stop.walk_time_min if nearest_stop else None

        unique_lines_by_id: dict[int, TransportLine] = {}
        for line in lines:
            unique_lines_by_id[line.line_id] = line
        lines_sorted = sorted(unique_lines_by_id.values(), key=lambda item: (item.route_type, item.ref, item.name))

        transport_types_available = sorted({stop.stop_type for stop in stops})
        total_lines_count = len(lines_sorted)
        mobility_score = self._compute_mobility_score(stops=stops, lines=lines_sorted)

        return TransportNetworkResult(
            center_lat=lat,
            center_lon=lon,
            radius_m=int(radius_m),
            stops=stops,
            lines_serving_area=lines_sorted,
            nearest_stop=nearest_stop,
            nearest_stop_walk_time=nearest_stop_walk_time,
            total_lines_count=total_lines_count,
            transport_types_available=transport_types_available,
            mobility_score=mobility_score,
        )

    def get_reachable_destinations(self, result: TransportNetworkResult) -> list[str]:
        descriptions: list[str] = []

        for line in result.lines_serving_area:
            route_label = self._route_label(line.route_type)
            route_ref = line.ref.strip() if line.ref else "?"
            route_name = line.name.strip() if line.name else ""

            if route_name and route_name.lower() != route_ref.lower():
                descriptions.append(f"{route_label} {route_ref} ({route_name})")
            else:
                descriptions.append(f"{route_label} {route_ref}")

        if descriptions:
            return descriptions

        inferred_count = result.total_lines_count if result.total_lines_count > 0 else len(
            [stop for stop in result.stops if stop.stop_type == "bus"]
        )
        return [f"{inferred_count} bus lines serving this area"]

    def _build_query(self, lat: float, lon: float, radius_m: int) -> str:
        return f"""
[out:json][timeout:60];
(
  node["highway"="bus_stop"](around:{radius_m},{lat},{lon});
  node["public_transport"~"stop_position|platform"](around:{radius_m},{lat},{lon});
  node["railway"~"tram_stop|halt|station"](around:{radius_m},{lat},{lon});
  node["station"~"subway|metro"](around:{radius_m},{lat},{lon});
  node["amenity"="taxi"](around:{radius_m},{lat},{lon});
  relation["route"~"bus|tram|subway|train|trolleybus|ferry"](around:{radius_m},{lat},{lon});
);
out center tags;
""".strip()

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
                    status_code = getattr(getattr(exc, "response", None), "status_code", None)
                    failures.append(f"{endpoint} (attempt {attempt}): {exc}")
                    logger.warning(
                        "Transport Overpass fetch failed (endpoint=%s, attempt=%s/%s): %s",
                        endpoint,
                        attempt,
                        self.max_retries,
                        exc,
                    )
                    if status_code == 403:
                        break
                    if attempt < self.max_retries:
                        time.sleep(self.retry_delay_seconds)

        if failures:
            raise RuntimeError(
                "Overpass transport fetch failed across endpoints: "
                + " | ".join(failures)
            ) from last_error
        raise RuntimeError("Overpass transport fetch failed without explicit error")

    def _parse_stop(self, element: dict[str, Any], center_lat: float, center_lon: float) -> TransportStop | None:
        lat = element.get("lat")
        lon = element.get("lon")
        if lat is None or lon is None:
            return None

        tags = element.get("tags", {}) or {}
        stop_type = self._infer_stop_type(tags)
        if stop_type is None:
            return None

        lat_f = float(lat)
        lon_f = float(lon)
        distance_m = self._haversine(center_lat, center_lon, lat_f, lon_f)
        walk_time_min = ((distance_m / 1000.0) / 5.0) * 60.0 * 1.4

        lines = self._extract_stop_lines(tags)

        return TransportStop(
            stop_id=int(element.get("id", 0)),
            name=str(tags.get("name", "") or "").strip(),
            stop_type=stop_type,
            lat=lat_f,
            lon=lon_f,
            distance_m=distance_m,
            lines=lines,
            walk_time_min=walk_time_min,
        )

    def _parse_line(self, element: dict[str, Any]) -> TransportLine | None:
        tags = element.get("tags", {}) or {}
        route_value = str(tags.get("route", "")).strip().lower()
        if not route_value:
            return None

        route_type = "metro" if route_value == "subway" else route_value
        if route_type not in {"bus", "tram", "metro", "train", "trolleybus", "ferry"}:
            return None

        return TransportLine(
            line_id=int(element.get("id", 0)),
            name=str(tags.get("name", "") or "").strip(),
            ref=str(tags.get("ref", "") or "").strip(),
            route_type=route_type,
            operator=str(tags.get("operator", "") or "").strip() or None,
        )

    @staticmethod
    def _infer_stop_type(tags: dict[str, Any]) -> str | None:
        highway = str(tags.get("highway", "")).lower().strip()
        railway = str(tags.get("railway", "")).lower().strip()
        station = str(tags.get("station", "")).lower().strip()
        amenity = str(tags.get("amenity", "")).lower().strip()

        if highway == "bus_stop":
            return "bus"
        if station in {"subway", "metro"}:
            return "metro"
        if railway == "tram_stop":
            return "tram"
        if railway in {"halt", "station"}:
            return "train"
        if amenity == "taxi":
            return "taxi"

        public_transport = str(tags.get("public_transport", "")).lower().strip()
        if public_transport in {"stop_position", "platform"}:
            return "bus"

        return None

    @staticmethod
    def _extract_stop_lines(tags: dict[str, Any]) -> list[str]:
        candidate_keys = [
            "ref",
            "name",
            "operator",
            "route_ref",
            "bus_lines",
            "lines",
        ]
        lines: list[str] = []

        for key in candidate_keys:
            raw = str(tags.get(key, "") or "").strip()
            if not raw:
                continue
            split_values = [item.strip() for item in raw.replace("|", ";").split(";") if item.strip()]
            for value in split_values:
                if value not in lines:
                    lines.append(value)
        return lines

    def _compute_mobility_score(self, stops: list[TransportStop], lines: list[TransportLine]) -> float:
        score = 0.0

        has_metro = any(stop.stop_type == "metro" and stop.distance_m <= 400.0 for stop in stops)
        has_tram = any(stop.stop_type == "tram" and stop.distance_m <= 400.0 for stop in stops)
        has_bus = any(stop.stop_type == "bus" and stop.distance_m <= 400.0 for stop in stops)
        has_taxi = any(stop.stop_type == "taxi" and stop.distance_m <= 400.0 for stop in stops)

        if has_metro:
            score += 0.4
        if has_tram:
            score += 0.3
        if has_bus:
            score += 0.2
        if has_taxi:
            score += 0.1

        unique_bus_lines = {
            (line.ref or line.name or str(line.line_id))
            for line in lines
            if line.route_type == "bus"
        }
        additional_bus_count = max(0, len(unique_bus_lines) - 1)
        score += min(0.3, additional_bus_count * 0.1)

        return max(0.0, min(1.0, score))

    @staticmethod
    def _route_label(route_type: str) -> str:
        mapping = {
            "bus": "Bus",
            "tram": "Tram",
            "metro": "Metro",
            "train": "Train",
            "trolleybus": "Trolleybus",
            "ferry": "Ferry",
        }
        return mapping.get(route_type, route_type.title())

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


class TransportNetworkAnalyzer:
    """Compatibility wrapper around TransportNetworkFetcher."""

    def __init__(self) -> None:
        self.fetcher = TransportNetworkFetcher()

    def analyze(self, request: Any) -> dict[str, Any]:
        latitude = float(getattr(request, "latitude", 0.0))
        longitude = float(getattr(request, "longitude", 0.0))
        radius_m = int(getattr(request, "radius_m", 1200))
        result = self.fetcher.fetch(lat=latitude, lon=longitude, radius_m=radius_m)
        return result.model_dump()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")

    fetcher = TransportNetworkFetcher()
    result = fetcher.fetch(lat=36.8065, lon=10.1815, radius_m=500)

    print("Transport stops near Tunis city center:")
    for stop in result.stops:
        stop_name = stop.name or "(unnamed)"
        lines = ", ".join(stop.lines) if stop.lines else "no line tags"
        print(f"- {stop_name} [{stop.stop_type}] {stop.distance_m:.1f}m | lines: {lines}")

    print(f"\nMobility score: {result.mobility_score:.2f}")

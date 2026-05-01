"""Overpass API client for OSM noise-related features."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import logging
import os
import time
from math import atan2, cos, radians, sin, sqrt
from typing import Any, Dict, Optional

import requests
from pydantic import BaseModel


logger = logging.getLogger(__name__)


class OSMFetchError(Exception):
  pass


class OSMFeature(BaseModel):
  osm_id: int
  osm_type: str
  feature_type: str
  osm_tag_key: str
  osm_tag_value: str
  name: str
  lat: float
  lon: float
  distance_m: float


class OSMFetchResult(BaseModel):
  center_lat: float
  center_lon: float
  radius_m: int
  features: list[OSMFeature]
  query_timestamp: str
  total_count: int


class OSMFetcher:
  SCOPE = "noise"
  OVERPASS_URL = os.getenv(
    "OVERPASS_URL",
    "https://overpass-api.de/api/interpreter",
  )
  DEFAULT_RADIUS_M = 300

  def __init__(self) -> None:
    self.timeout_seconds = 60
    self.max_retries = 2
    self.retry_delay_seconds = 1.2
    self.overpass_endpoints = self._build_overpass_endpoints()
    # Note: Do NOT set Accept: application/json — overpass-api.de returns 406.
    # JSON output is controlled by [out:json] inside the query.
    self._headers = {
      "User-Agent": os.getenv(
        "OVERPASS_USER_AGENT",
        "HestIA/1.0 (noise-assessment; contact=hestia@localhost)",
      ),
    }

  def _build_overpass_endpoints(self) -> list[str]:
    configured = str(self.OVERPASS_URL).strip()
    fallbacks = [
      "https://overpass-api.de/api/interpreter",
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.openstreetmap.fr/api/interpreter",
    ]
    endpoints: list[str] = []
    if configured:
      endpoints.append(configured)
    for item in fallbacks:
      if item not in endpoints:
        endpoints.append(item)
    return endpoints

  def _build_overpass_query(self, lat: float, lon: float, radius_m: int) -> str:
    return f"""
[out:json][timeout:60];
(
  // Roads (ways, not nodes)
  way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|living_street|service|pedestrian|unclassified"](around:{radius_m},{lat},{lon});

  // Nightlife
  node["amenity"~"bar|nightclub|pub|biergarten"](around:{radius_m},{lat},{lon});
  way["amenity"~"bar|nightclub|pub|biergarten"](around:{radius_m},{lat},{lon});

  // Food & social
  node["amenity"~"restaurant|fast_food|cafe|food_court"](around:{radius_m},{lat},{lon});

  // Transport
  node["amenity"~"bus_station|ferry_terminal"](around:{radius_m},{lat},{lon});
  node["public_transport"~"station|stop_area"](around:{radius_m},{lat},{lon});
  node["railway"~"station|tram_stop|halt"](around:{radius_m},{lat},{lon});

  // Places of worship
  node["amenity"="place_of_worship"](around:{radius_m},{lat},{lon});
  way["amenity"="place_of_worship"](around:{radius_m},{lat},{lon});

  // Commercial
  node["shop"~"supermarket|mall|department_store"](around:{radius_m},{lat},{lon});
  node["amenity"="marketplace"](around:{radius_m},{lat},{lon});

  // Entertainment & leisure
  node["amenity"~"cinema|theatre|arts_centre"](around:{radius_m},{lat},{lon});
  node["leisure"~"sports_centre|stadium|park"](around:{radius_m},{lat},{lon});
  way["leisure"~"sports_centre|stadium|park"](around:{radius_m},{lat},{lon});

  // Industrial
  way["landuse"~"industrial|construction"](around:{radius_m},{lat},{lon});
  way["man_made"="works"](around:{radius_m},{lat},{lon});
);
out center;
""".strip()

  def _parse_element(
    self,
    element: Dict[str, Any],
    center_lat: float,
    center_lon: float,
  ) -> Optional[OSMFeature]:
    element_type = str(element.get("type", "")).strip().lower()

    if element_type == "node":
      lat = element.get("lat")
      lon = element.get("lon")
    elif element_type == "way" and "center" in element:
      center = element.get("center", {}) or {}
      lat = center.get("lat")
      lon = center.get("lon")
    else:
      return None

    if lat is None or lon is None:
      return None

    tags = element.get("tags", {}) or {}
    osm_tag_key = ""
    for key in [
      "amenity",
      "highway",
      "shop",
      "leisure",
      "landuse",
      "public_transport",
      "railway",
      "man_made",
    ]:
      if key in tags:
        osm_tag_key = key
        break

    if not osm_tag_key:
      return None

    osm_tag_value = str(tags.get(osm_tag_key, "")).strip().lower()
    if not osm_tag_value:
      return None

    lat_f = float(lat)
    lon_f = float(lon)
    distance = self._haversine(center_lat, center_lon, lat_f, lon_f)

    return OSMFeature(
      osm_id=int(element.get("id", 0)),
      osm_type=element_type,
      feature_type=osm_tag_value,
      osm_tag_key=osm_tag_key,
      osm_tag_value=osm_tag_value,
      name=str(tags.get("name", "") or ""),
      lat=lat_f,
      lon=lon_f,
      distance_m=distance,
    )

  def fetch(self, lat: float, lon: float, radius_m: int = None) -> OSMFetchResult:
    resolved_radius = int(radius_m or self.DEFAULT_RADIUS_M)
    query = self._build_overpass_query(lat, lon, resolved_radius)

    last_error: Exception | None = None
    for endpoint in self.overpass_endpoints:
      for attempt in range(1, self.max_retries + 1):
        try:
          response = requests.post(
            endpoint,
            data={"data": query},
            headers=self._headers,
            timeout=self.timeout_seconds,
          )
          response.raise_for_status()
          payload = response.json() or {}
          elements = payload.get("elements", []) or []

          features: list[OSMFeature] = []
          for element in elements:
            parsed = self._parse_element(element, center_lat=lat, center_lon=lon)
            if parsed is not None:
              features.append(parsed)

          return OSMFetchResult(
            center_lat=float(lat),
            center_lon=float(lon),
            radius_m=resolved_radius,
            features=features,
            query_timestamp=datetime.now(timezone.utc).isoformat(),
            total_count=len(features),
          )
        except Exception as exc:  # noqa: BLE001
          last_error = exc
          resp_obj = getattr(exc, "response", None)
          status_code = getattr(resp_obj, "status_code", None)
          logger.warning(
            "Overpass fetch failed (endpoint=%s, attempt=%s/%s): %s",
            endpoint,
            attempt,
            self.max_retries,
            exc,
          )
          # Skip immediately on hard errors — no point retrying the same endpoint
          if status_code in (403, 406, 429, 503):
            logger.debug("HTTP %s on %s — skipping to next endpoint", status_code, endpoint)
            break
          if attempt < self.max_retries:
            time.sleep(self.retry_delay_seconds)

    raise OSMFetchError(
      "Overpass API unavailable. Using fallback noise estimate."
    ) from last_error

  def fetch_noise_sources(self, lat: float, lon: float, radius_m: int = 300) -> Dict[str, Any]:
    """Compatibility method for existing scaffolded engine calls."""
    result = self.fetch(lat=lat, lon=lon, radius_m=radius_m)
    return {
      "elements": [feature.model_dump() for feature in result.features],
      "center_lat": result.center_lat,
      "center_lon": result.center_lon,
      "radius_m": result.radius_m,
      "query_timestamp": result.query_timestamp,
      "total_count": result.total_count,
    }

  def fetch_noise_only(self, lat: float, lon: float, radius_m: int = 300) -> Dict[str, Any]:
    """Explicit alias to emphasize this fetcher is noise-oriented only."""
    return self.fetch_noise_sources(lat=lat, lon=lon, radius_m=radius_m)

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
  logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")

  fetcher = OSMFetcher()
  result = fetcher.fetch(lat=36.8065, lon=10.1815, radius_m=300)

  print("TOTAL_COUNT", result.total_count)
  counts = Counter(feature.feature_type for feature in result.features)
  print("FEATURE_BREAKDOWN")
  for feature_type, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
    print(f"- {feature_type}: {count}")

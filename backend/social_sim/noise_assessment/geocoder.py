"""Address/coordinate geocoding via OpenStreetMap Nominatim API."""

from __future__ import annotations

import os
import re
import time
from difflib import SequenceMatcher
from dataclasses import dataclass
from typing import Any, Dict, Optional

import requests
from pydantic import BaseModel


class GeocodingError(Exception):
    pass


class GeocoderResult(BaseModel):
    address_input: str
    lat: float
    lon: float
    display_name: str
    place_type: str
    confidence: float
    country_code: str


@dataclass
class GeoPoint:
    lat: float
    lon: float


class PropertyGeocoder:
    NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
    REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"

    def __init__(self) -> None:
        user_agent = os.getenv("NOMINATIM_USER_AGENT", "domusai/1.0")
        self.headers = {"User-Agent": user_agent}
        self.timeout = 10

    def geocode_address(self, address: str) -> GeocoderResult:
        if not str(address).strip():
            raise GeocodingError("Address cannot be empty.")

        candidates = self.search_candidates(address=address, max_results=1)
        if candidates:
            return candidates[0]

        raise GeocodingError(f"Address not found: {address}")

    def search_candidates(self, address: str, max_results: int = 8) -> list[GeocoderResult]:
        if not str(address).strip():
            raise GeocodingError("Address cannot be empty.")

        max_results = max(1, min(20, int(max_results)))
        query_variants = self._build_query_variants(address)
        raw_candidates: list[Dict[str, Any]] = []
        seen_keys: set[str] = set()

        for candidate_query in query_variants:
            for restrict_tunisia in [True, False]:
                fetched = self._search_many(
                    query=candidate_query,
                    restrict_tunisia=restrict_tunisia,
                    limit=max_results,
                )
                for item in fetched:
                    key = str(item.get("place_id", "")) or str(item.get("osm_id", ""))
                    if not key:
                        key = f"{item.get('lat')}:{item.get('lon')}:{item.get('display_name', '')}"
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    raw_candidates.append(item)

            if len(raw_candidates) >= max_results * 2:
                break

        if not raw_candidates:
            raise GeocodingError(f"Address not found: {address}")

        scored: list[tuple[float, GeocoderResult]] = []
        normalized_query = self._normalize_for_match(address)

        for item in raw_candidates:
            parsed = self._parse_result(address_input=address, result=item)
            display_norm = self._normalize_for_match(parsed.display_name)
            similarity = SequenceMatcher(None, normalized_query, display_norm).ratio()
            country_bonus = 0.08 if parsed.country_code == "tn" else 0.0
            score = similarity + (0.25 * parsed.confidence) + country_bonus
            scored.append((score, parsed))

        scored.sort(key=lambda row: row[0], reverse=True)
        return [item for _, item in scored[:max_results]]

    @staticmethod
    def _normalize_for_match(text: str) -> str:
        return " ".join(str(text).lower().replace(",", " ").split())

    @staticmethod
    def _build_query_variants(address: str) -> list[str]:
        normalized = " ".join(str(address).strip().split())
        no_postal = re.sub(r"\b\d{4,5}\b", "", normalized).replace(" ,", ",")
        no_postal = " ".join(no_postal.split()).strip(" ,")
        no_house = re.sub(r"^\d+\s+", "", normalized)
        no_house = " ".join(no_house.split()).strip(" ,")

        variants: list[str] = []
        for candidate in [normalized, no_house, no_postal]:
            clean_candidate = " ".join(candidate.split()).strip(" ,")
            if clean_candidate and clean_candidate not in variants:
                variants.append(clean_candidate)

        with_country: list[str] = []
        for candidate in variants:
            if "tunisia" not in candidate.lower() and "tunisie" not in candidate.lower():
                with_country.append(f"{candidate}, Tunisia")
        variants.extend(with_country)
        return variants

    def _search_many(self, query: str, restrict_tunisia: bool, limit: int) -> list[Dict[str, Any]]:
        params: Dict[str, Any] = {
            "q": query,
            "format": "json",
            "addressdetails": 1,
            "limit": max(1, min(20, int(limit))),
            "accept-language": "fr,en,ar",
        }
        if restrict_tunisia:
            params["countrycodes"] = "tn"

        try:
            time.sleep(1)
            response = requests.get(
                self.NOMINATIM_URL,
                params=params,
                headers=self.headers,
                timeout=self.timeout,
            )
            response.raise_for_status()
            return response.json() or []
        except requests.RequestException:
            return []

    def _search_once(self, query: str, restrict_tunisia: bool) -> Dict[str, Any] | None:
        data = self._search_many(query=query, restrict_tunisia=restrict_tunisia, limit=1)
        return data[0] if data else None

    def geocode_coordinates(self, lat: float, lon: float) -> GeocoderResult:
        params = {
            "lat": lat,
            "lon": lon,
            "format": "json",
            "addressdetails": 1,
        }

        time.sleep(1)
        response = requests.get(
            self.REVERSE_URL,
            params=params,
            headers=self.headers,
            timeout=self.timeout,
        )
        response.raise_for_status()
        data = response.json() or {}

        if not data:
            raise GeocodingError(f"Coordinates not found: {lat},{lon}")

        return self._parse_result(address_input=f"{lat},{lon}", result=data)

    def validate_tunisia_address(self, result: GeocoderResult) -> bool:
        return str(result.country_code).lower() == "tn"

    @staticmethod
    def _parse_result(address_input: str, result: Dict[str, Any]) -> GeocoderResult:
        lat = float(result["lat"])
        lon = float(result["lon"])
        display_name = str(result.get("display_name", "")).strip()
        place_type = str(result.get("type", result.get("addresstype", "unknown")))
        importance = float(result.get("importance", 0.5) or 0.5)
        confidence = max(0.0, min(1.0, importance))
        country_code = str((result.get("address", {}) or {}).get("country_code", "?")).lower()

        return GeocoderResult(
            address_input=address_input,
            lat=lat,
            lon=lon,
            display_name=display_name,
            place_type=place_type,
            confidence=confidence,
            country_code=country_code,
        )


class Geocoder(PropertyGeocoder):
    """Compatibility wrapper for existing noise engine scaffold."""

    def geocode(self, address: str) -> Optional[GeoPoint]:
        result = self.geocode_address(address)
        return GeoPoint(lat=result.lat, lon=result.lon)


if __name__ == "__main__":
    geocoder = PropertyGeocoder()
    addresses = [
        "Avenue Habib Bourguiba, Tunis",
        "Rue de la Liberté, Sfax",
        "Place 7 Novembre, Sousse",
    ]

    for address in addresses:
        try:
            item = geocoder.geocode_address(address)
            print(f"{address} -> lat={item.lat:.6f}, lon={item.lon:.6f}")
            print(f"  {item.display_name}")
        except Exception as exc:  # noqa: BLE001
            print(f"{address} -> ERROR: {exc}")
        time.sleep(1)

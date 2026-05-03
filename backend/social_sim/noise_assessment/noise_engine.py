"""Orchestrator for dynamic noise level assessment."""

from __future__ import annotations

import time

from pydantic import BaseModel

try:
    from .cache import NoiseCache
    from .geocoder import GeocodingError, PropertyGeocoder
    from .noise_scorer import NoiseScorer
    from .osm_fetcher import OSMFetchError, OSMFetcher
except ImportError:  # pragma: no cover
    from cache import NoiseCache
    from geocoder import GeocodingError, PropertyGeocoder
    from noise_scorer import NoiseScorer
    from osm_fetcher import OSMFetchError, OSMFetcher


class NoiseAssessmentRequest(BaseModel):
    address: str | None = None
    lat: float | None = None
    lon: float | None = None
    radius_m: int = 300
    force_refresh: bool = False


class NoiseAssessmentResponse(BaseModel):
    address_input: str
    resolved_address: str
    lat: float
    lon: float
    noise_level: float
    noise_label: str
    top_sources: list[str]
    geo_sources: list[dict] = []  # [{type, name, lat, lon, distance_m, weight}]
    breakdown: dict
    feature_count: int
    radius_m: int
    from_cache: bool
    fallback_used: bool
    fallback_reason: str


class NoiseAssessmentEngine:
    def __init__(self) -> None:
        self.geocoder = PropertyGeocoder()
        self.fetcher = OSMFetcher()
        self.scorer = NoiseScorer()
        self.cache = NoiseCache()

    def assess(self, request: NoiseAssessmentRequest) -> NoiseAssessmentResponse:
        if request.lat is not None and request.lon is not None:
            lat = float(request.lat)
            lon = float(request.lon)
            address_str = f"{lat},{lon}"
            resolved_address = address_str
        elif request.address:
            try:
                geo_result = self.geocoder.geocode_address(request.address)
                lat = geo_result.lat
                lon = geo_result.lon
                address_str = request.address
                resolved_address = geo_result.display_name
            except GeocodingError:
                return self._fallback_response(
                    request.address or "unknown",
                    reason="Address could not be geocoded. Using default noise estimate.",
                )
        else:
            raise ValueError("Either address or lat/lon must be provided.")

        cache_key = f"{lat:.5f},{lon:.5f}"
        if not request.force_refresh:
            cached = self.cache.get(cache_key, request.radius_m)
            if cached:
                payload = dict(cached)
                payload["from_cache"] = True
                return NoiseAssessmentResponse(**payload)

        try:
            fetch_result = self.fetcher.fetch(lat, lon, request.radius_m)
        except OSMFetchError as exc:
            return self._fallback_response(
                address_str,
                lat=lat,
                lon=lon,
                reason=f"OSM data unavailable: {str(exc)}",
            )

        score_result = self.scorer.score(fetch_result)

        response = NoiseAssessmentResponse(
            address_input=address_str,
            resolved_address=resolved_address,
            lat=lat,
            lon=lon,
            noise_level=score_result.noise_level,
            noise_label=score_result.label,
            top_sources=score_result.top_sources,
            geo_sources=[src.model_dump() for src in score_result.geo_sources],
            breakdown=score_result.breakdown,
            feature_count=score_result.feature_count,
            radius_m=request.radius_m,
            from_cache=False,
            fallback_used=False,
            fallback_reason="",
        )

        self.cache.set(cache_key, request.radius_m, response.model_dump())
        return response

    def _fallback_response(
        self,
        address_str: str,
        lat: float | None = None,
        lon: float | None = None,
        reason: str = "",
    ) -> NoiseAssessmentResponse:
        return NoiseAssessmentResponse(
            address_input=address_str,
            resolved_address=address_str,
            lat=lat or 0.0,
            lon=lon or 0.0,
            noise_level=0.4,
            noise_label="Moderate (estimated)",
            top_sources=["Data unavailable"],
            breakdown={},
            feature_count=0,
            radius_m=300,
            from_cache=False,
            fallback_used=True,
            fallback_reason=reason,
        )

    def assess_batch(
        self,
        requests: list[NoiseAssessmentRequest],
        delay_seconds: float = 1.5,
    ) -> list[NoiseAssessmentResponse]:
        results: list[NoiseAssessmentResponse] = []
        for req in requests:
            results.append(self.assess(req))
            time.sleep(delay_seconds)
        return results


if __name__ == "__main__":
    engine = NoiseAssessmentEngine()
    request = NoiseAssessmentRequest(
        address="Avenue Habib Bourguiba, Tunis",
        radius_m=300,
    )

    first = engine.assess(request)
    print("FIRST_CALL")
    print("noise_level:", first.noise_level)
    print("noise_label:", first.noise_label)
    print("top_sources:", first.top_sources)
    print("breakdown:", first.breakdown)
    print("feature_count:", first.feature_count)
    print("from_cache:", first.from_cache)

    second = engine.assess(request)
    print("SECOND_CALL")
    print("noise_level:", second.noise_level)
    print("noise_label:", second.noise_label)
    print("top_sources:", second.top_sources)
    print("breakdown:", second.breakdown)
    print("feature_count:", second.feature_count)
    print("from_cache:", second.from_cache)

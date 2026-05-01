"""Noise scoring model converting OSM features to a 0.0-1.0 noise level."""

from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel

try:
    from .osm_fetcher import OSMFeature, OSMFetchResult
except ImportError:  # pragma: no cover
    from osm_fetcher import OSMFeature, OSMFetchResult


NOISE_WEIGHTS: Dict[str, float] = {
    "motorway": 1.0,
    "trunk": 0.90,
    "primary": 0.75,
    "secondary": 0.60,
    "tertiary": 0.45,
    "unclassified": 0.30,
    "residential": 0.20,
    "living_street": 0.10,
    "service": 0.15,
    "pedestrian": 0.25,
    "bar": 0.85,
    "nightclub": 0.95,
    "pub": 0.70,
    "biergarten": 0.60,
    "restaurant": 0.35,
    "fast_food": 0.40,
    "cafe": 0.25,
    "food_court": 0.45,
    "marketplace": 0.65,
    "bus_station": 0.70,
    "ferry_terminal": 0.55,
    "station": 0.65,
    "tram_stop": 0.40,
    "stop_area": 0.30,
    "place_of_worship": 0.50,
    "supermarket": 0.35,
    "mall": 0.45,
    "department_store": 0.40,
    "sports_centre": 0.60,
    "stadium": 0.90,
    "cinema": 0.20,
    "theatre": 0.15,
    "industrial": 0.80,
    "construction": 0.85,
}


class NoiseContribution(BaseModel):
    feature: OSMFeature
    base_weight: float
    decay_factor: float
    contribution: float
    label: str


class NoiseScoreResult(BaseModel):
    noise_level: float
    label: str
    contributions: List[NoiseContribution]
    top_sources: List[str]
    breakdown: Dict[str, Dict[str, float | int]]
    raw_score: float
    feature_count: int
    radius_m: int


class NoiseScorer:
    def __init__(self, radius_m: int = 300) -> None:
        self.radius_m = radius_m
        self.weights = NOISE_WEIGHTS

    def _get_base_weight(self, feature: OSMFeature) -> float:
        return float(self.weights.get(feature.osm_tag_value, 0.30))

    def _compute_decay(self, distance_m: float) -> float:
        if self.radius_m <= 0:
            return 0.0
        decay = 1.0 - (float(distance_m) / float(self.radius_m)) ** 0.7
        return max(0.0, min(1.0, decay))

    @staticmethod
    def _get_label(score: float) -> str:
        if score < 0.15:
            return "Very Quiet"
        if score < 0.30:
            return "Quiet"
        if score < 0.45:
            return "Moderate"
        if score < 0.60:
            return "Noisy"
        if score < 0.75:
            return "Very Noisy"
        return "Extremely Noisy"

    @staticmethod
    def _get_feature_label(feature: OSMFeature) -> str:
        name = feature.name if feature.name else feature.osm_tag_value
        return f"{name} ({feature.osm_tag_value})"

    def score(self, fetch_result: OSMFetchResult | float, center_lon: float | None = None, elements: Any = None) -> NoiseScoreResult | float:
        """Scores noise.

        Primary API: score(fetch_result: OSMFetchResult) -> NoiseScoreResult
        Compatibility API: score(center_lat, center_lon, elements) -> float
        """
        if isinstance(fetch_result, OSMFetchResult):
            self.radius_m = int(fetch_result.radius_m)
            contributions: List[NoiseContribution] = []

            for feature in fetch_result.features:
                base_weight = self._get_base_weight(feature)
                decay = self._compute_decay(feature.distance_m)
                contribution = base_weight * decay
                contributions.append(
                    NoiseContribution(
                        feature=feature,
                        base_weight=base_weight,
                        decay_factor=decay,
                        contribution=contribution,
                        label=self._get_feature_label(feature),
                    )
                )

            contributions.sort(key=lambda item: item.contribution, reverse=True)

            raw_score = 0.0
            for index, item in enumerate(contributions):
                diminishing_factor = 1.0 / (1.0 + index * 0.15)
                raw_score += item.contribution * diminishing_factor

            noise_level = min(1.0, raw_score)

            breakdown: Dict[str, Dict[str, float | int]] = {}
            for item in contributions:
                category = item.feature.osm_tag_key
                if category not in breakdown:
                    breakdown[category] = {
                        "count": 0,
                        "total_contribution": 0.0,
                    }
                breakdown[category]["count"] = int(breakdown[category]["count"]) + 1
                breakdown[category]["total_contribution"] = float(
                    breakdown[category]["total_contribution"]
                ) + float(item.contribution)

            top_3 = [item.label for item in contributions[:3]]

            return NoiseScoreResult(
                noise_level=noise_level,
                label=self._get_label(noise_level),
                contributions=contributions,
                top_sources=top_3,
                breakdown=breakdown,
                raw_score=raw_score,
                feature_count=len(contributions),
                radius_m=self.radius_m,
            )

        parsed_features: List[OSMFeature] = []
        if isinstance(elements, list):
            for element in elements:
                try:
                    parsed_features.append(OSMFeature.model_validate(element))
                except Exception:
                    continue
        mock = OSMFetchResult(
            center_lat=float(fetch_result),
            center_lon=float(center_lon or 0.0),
            radius_m=self.radius_m,
            features=parsed_features,
            query_timestamp="",
            total_count=len(parsed_features),
        )
        return self.score(mock).noise_level


if __name__ == "__main__":
    mock_result = OSMFetchResult(
        center_lat=36.8065,
        center_lon=10.1815,
        radius_m=300,
        query_timestamp="test",
        total_count=6,
        features=[
            OSMFeature(
                osm_id=1,
                osm_type="node",
                feature_type="nightclub",
                osm_tag_key="amenity",
                osm_tag_value="nightclub",
                name="Club Test",
                lat=36.8067,
                lon=10.1819,
                distance_m=50.0,
            ),
            OSMFeature(
                osm_id=2,
                osm_type="way",
                feature_type="primary",
                osm_tag_key="highway",
                osm_tag_value="primary",
                name="Primary Road",
                lat=36.8066,
                lon=10.1816,
                distance_m=20.0,
            ),
            OSMFeature(
                osm_id=3,
                osm_type="node",
                feature_type="cafe",
                osm_tag_key="amenity",
                osm_tag_value="cafe",
                name="Cafe 1",
                lat=36.8060,
                lon=10.1820,
                distance_m=100.0,
            ),
            OSMFeature(
                osm_id=4,
                osm_type="node",
                feature_type="cafe",
                osm_tag_key="amenity",
                osm_tag_value="cafe",
                name="Cafe 2",
                lat=36.8058,
                lon=10.1821,
                distance_m=150.0,
            ),
            OSMFeature(
                osm_id=5,
                osm_type="node",
                feature_type="cafe",
                osm_tag_key="amenity",
                osm_tag_value="cafe",
                name="Cafe 3",
                lat=36.8056,
                lon=10.1822,
                distance_m=200.0,
            ),
            OSMFeature(
                osm_id=6,
                osm_type="way",
                feature_type="residential",
                osm_tag_key="highway",
                osm_tag_value="residential",
                name="Residential Street",
                lat=36.8059,
                lon=10.1812,
                distance_m=150.0,
            ),
        ],
    )

    scorer = NoiseScorer(radius_m=300)
    result = scorer.score(mock_result)
    print("noise_level:", round(result.noise_level, 4))
    print("label:", result.label)
    print("top_sources:", result.top_sources)
    print("breakdown:", result.breakdown)

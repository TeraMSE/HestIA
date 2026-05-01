"""Composite walkability scoring for neighborhood intelligence."""

from __future__ import annotations

from math import exp

from pydantic import BaseModel

from .poi_fetcher import POIResult


IDEAL_DISTANCES: dict[str, float] = {
    "supermarket": 300.0,
    "bakery": 200.0,
    "cafe": 250.0,
    "restaurant": 350.0,
    "pharmacy": 400.0,
    "bus_stop": 300.0,
    "bank": 500.0,
    "atm": 400.0,
    "school": 600.0,
    "park": 500.0,
    "clinic": 600.0,
    "hospital": 1500.0,
    "post_office": 700.0,
    "place_of_worship": 400.0,
    "gym": 600.0,
    "library": 800.0,
}


CATEGORY_WEIGHTS: dict[str, float] = {
    "supermarket": 0.15,
    "bakery": 0.08,
    "cafe": 0.07,
    "restaurant": 0.07,
    "pharmacy": 0.10,
    "bus_stop": 0.15,
    "bank": 0.06,
    "atm": 0.06,
    "park": 0.06,
    "clinic": 0.08,
    "place_of_worship": 0.05,
    "school": 0.05,
    "library": 0.02,
}


class WalkabilityScore(BaseModel):
    overall_score: float
    label: str
    dimension_scores: dict[str, float]
    top_assets: list[str]
    top_gaps: list[str]
    tunisia_bonus: float
    raw_score: float


class WalkabilityScorer:
    """Computes a normalized walkability score from neighborhood signals."""

    def score(self, nearest_pois: dict[str, POIResult | None]) -> WalkabilityScore:
        dimension_scores: dict[str, float] = {}
        weighted_sum = 0.0
        total_weight = 0.0

        for category, weight in CATEGORY_WEIGHTS.items():
            poi = nearest_pois.get(category)

            if poi is None:
                dim_score = 0.0
            else:
                ideal_distance = float(IDEAL_DISTANCES.get(category, 500.0))
                dim_score = exp(-0.5 * (float(poi.distance_m) / ideal_distance) ** 2)

            rounded_score = round(float(dim_score), 3)
            dimension_scores[category] = rounded_score
            weighted_sum += float(dim_score) * float(weight)
            total_weight += float(weight)

        raw_score = (weighted_sum / total_weight) if total_weight > 0 else 0.0

        tunisia_bonus = 0.0
        place_of_worship = nearest_pois.get("place_of_worship")
        bakery = nearest_pois.get("bakery")
        if place_of_worship is not None and float(place_of_worship.distance_m) < 300.0:
            tunisia_bonus += 0.03
        if bakery is not None and float(bakery.distance_m) < 200.0:
            tunisia_bonus += 0.03

        overall = min(1.0, raw_score + tunisia_bonus)

        top_assets = [
            category
            for category, score in dimension_scores.items()
            if score > 0.7
        ]
        top_gaps = [
            category
            for category, score in dimension_scores.items()
            if score < 0.2 and CATEGORY_WEIGHTS.get(category, 0.0) > 0.07
        ]

        label = self._walkability_label(overall)

        return WalkabilityScore(
            overall_score=overall,
            label=label,
            dimension_scores=dimension_scores,
            top_assets=top_assets,
            top_gaps=top_gaps,
            tunisia_bonus=tunisia_bonus,
            raw_score=raw_score,
        )

    @staticmethod
    def _walkability_label(score: float) -> str:
        if score >= 0.90:
            return "Walker's Paradise 🏆"
        if score >= 0.75:
            return "Very Walkable 🚶"
        if score >= 0.55:
            return "Walkable 👣"
        if score >= 0.35:
            return "Some Walkability 🚌"
        return "Car Dependent 🚗"


if __name__ == "__main__":
    mock_nearest_pois: dict[str, POIResult | None] = {
        "supermarket": POIResult(
            category="supermarket",
            name="MG Maxi",
            osm_id=101,
            lat=36.805,
            lon=10.182,
            distance_m=120.0,
            simulation_relevance="daily",
            urgency_weight=0.6,
        ),
        "bakery": POIResult(
            category="bakery",
            name="Boulangerie",
            osm_id=102,
            lat=36.806,
            lon=10.180,
            distance_m=140.0,
            simulation_relevance="daily",
            urgency_weight=0.4,
        ),
        "cafe": POIResult(
            category="cafe",
            name="Café Phénicia",
            osm_id=103,
            lat=36.806,
            lon=10.181,
            distance_m=90.0,
            simulation_relevance="social",
            urgency_weight=0.3,
        ),
        "restaurant": POIResult(
            category="restaurant",
            name="L'Escale",
            osm_id=104,
            lat=36.807,
            lon=10.181,
            distance_m=380.0,
            simulation_relevance="social",
            urgency_weight=0.3,
        ),
        "pharmacy": POIResult(
            category="pharmacy",
            name="Pharmacie",
            osm_id=105,
            lat=36.806,
            lon=10.183,
            distance_m=240.0,
            simulation_relevance="health",
            urgency_weight=0.7,
        ),
        "bus_stop": POIResult(
            category="bus_stop",
            name="République",
            osm_id=106,
            lat=36.807,
            lon=10.182,
            distance_m=60.0,
            simulation_relevance="mobility",
            urgency_weight=0.8,
        ),
        "bank": POIResult(
            category="bank",
            name="Bank",
            osm_id=107,
            lat=36.807,
            lon=10.185,
            distance_m=650.0,
            simulation_relevance="admin",
            urgency_weight=0.5,
        ),
        "atm": None,
        "park": POIResult(
            category="park",
            name="Small Park",
            osm_id=108,
            lat=36.809,
            lon=10.189,
            distance_m=1050.0,
            simulation_relevance="leisure",
            urgency_weight=0.4,
        ),
        "clinic": POIResult(
            category="clinic",
            name="Clinic",
            osm_id=109,
            lat=36.810,
            lon=10.190,
            distance_m=1250.0,
            simulation_relevance="health",
            urgency_weight=0.8,
        ),
        "place_of_worship": POIResult(
            category="place_of_worship",
            name="Mosque",
            osm_id=110,
            lat=36.806,
            lon=10.179,
            distance_m=180.0,
            simulation_relevance="spiritual",
            urgency_weight=0.4,
        ),
        "school": None,
        "library": POIResult(
            category="library",
            name="Library",
            osm_id=111,
            lat=36.812,
            lon=10.193,
            distance_m=1600.0,
            simulation_relevance="enrichment",
            urgency_weight=0.3,
        ),
    }

    scorer = WalkabilityScorer()
    walkability = scorer.score(mock_nearest_pois)

    print(f"Overall score: {walkability.overall_score:.3f}")
    print(f"Raw score: {walkability.raw_score:.3f}")
    print(f"Tunisia bonus: {walkability.tunisia_bonus:.3f}")
    print(f"Label: {walkability.label}")
    print("Dimension scores:")
    for category, score in walkability.dimension_scores.items():
        print(f"- {category}: {score:.3f}")
    print(f"Top assets: {walkability.top_assets}")
    print(f"Top gaps: {walkability.top_gaps}")

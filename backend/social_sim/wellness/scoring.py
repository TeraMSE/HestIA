"""Scoring helpers for the Property Wellness composite score."""
from core.services.grading import grade_from_score


STALE_DAYS = 30


def ratio_to_score(ratio: float) -> float:
    """Convert a materiaux budget ratio (1.0 = perfect) to a 0-100 score.

    1.05 (5% over budget) → 100
    0.70 or 1.30         → 50
    0.50 or 1.50         → 0
    """
    delta = abs(ratio - 1.05)
    return max(0.0, min(100.0, 100.0 - delta * 200))


def blend(pillar_scores: dict, weights: dict) -> float:
    """Weighted average, renormalizing weights when pillars are missing."""
    available = {k: v for k, v in pillar_scores.items() if v is not None}
    if not available:
        return 0.0
    total_weight = sum(weights[k] for k in available)
    if total_weight == 0:
        return 0.0
    return sum(available[k] * weights[k] for k in available) / total_weight

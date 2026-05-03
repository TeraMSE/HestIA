"""Shared A/B/C/D/F grading utility used by both appliances and wellness aggregator."""


def grade_from_score(score: float) -> str:
    """Map a 0-100 score to a letter grade.

    A ≥ 80 | B ≥ 65 | C ≥ 50 | D ≥ 35 | F < 35
    """
    if score >= 80:
        return "A"
    if score >= 65:
        return "B"
    if score >= 50:
        return "C"
    if score >= 35:
        return "D"
    return "F"

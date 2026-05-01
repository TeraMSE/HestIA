"""Simplified roommate compatibility scorer.

Instead of running the legacy LifeSimulationAgent, we compute compatibility
from trait differences and the two solo event streams produced by LifeSimEngine.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any

from pydantic import BaseModel

from .persona import Persona


class ConflictEvent(BaseModel):
    conflict_id: str
    tick: int
    conflict_type: str
    room: str
    persona_a_id: str
    persona_b_id: str
    description: str
    severity: float
    resolved: bool = False
    resolution: str | None = None


def _compute_trait_signals(persona_a: Persona, persona_b: Persona) -> dict[str, float]:
    noise_a = float(persona_a.traits.get("noise_sensitivity", 0.5))
    noise_b = float(persona_b.traits.get("noise_sensitivity", 0.5))
    clean_a = float(persona_a.traits.get("cleanliness", 0.5))
    clean_b = float(persona_b.traits.get("cleanliness", 0.5))
    thermal_a = float(persona_a.traits.get("thermal_sensitivity", 0.5))
    thermal_b = float(persona_b.traits.get("thermal_sensitivity", 0.5))
    intro_a = float(persona_a.traits.get("introversion", 0.5))
    intro_b = float(persona_b.traits.get("introversion", 0.5))
    early_a = bool(persona_a.traits.get("early_riser", False))
    early_b = bool(persona_b.traits.get("early_riser", False))
    smoker_a = bool(persona_a.traits.get("smoker", False))
    smoker_b = bool(persona_b.traits.get("smoker", False))

    return {
        "noise": min(1.0, abs(noise_a - noise_b) * 0.5 + max(noise_a, noise_b) * 0.3),
        "cleanliness": min(1.0, abs(clean_a - clean_b)),
        "smoking": min(1.0, (1.0 if smoker_a != smoker_b else 0.0) + (0.6 if (smoker_a or smoker_b) else 0.0)),
        "thermal": min(1.0, abs(thermal_a - thermal_b) * 0.7),
        "schedule": 1.0 if early_a != early_b else 0.15,
        "space": min(1.0, abs(intro_a - intro_b) * 0.8),
    }


CONFLICT_THRESHOLDS: dict[str, float] = {
    "noise": 0.55,
    "cleanliness": 0.45,
    "smoking": 0.6,
    "thermal": 0.55,
    "schedule": 0.7,
    "space": 0.5,
}

CONFLICT_DESCRIPTIONS: dict[str, str] = {
    "noise": "Significant noise sensitivity mismatch may cause friction in shared spaces.",
    "cleanliness": "Differing cleanliness standards are likely to create tension.",
    "smoking": "One person smokes while the other does not — a major compatibility concern.",
    "thermal": "Thermal sensitivity difference may lead to ongoing thermostat disagreements.",
    "schedule": "Different wake/sleep schedules will cause morning/evening friction.",
    "space": "Introversion mismatch may create tension around privacy and shared time.",
}


def compute_compatibility(
    persona_a: Persona,
    persona_b: Persona,
    events_a: list[dict],
    events_b: list[dict],
) -> dict[str, Any]:
    signals = _compute_trait_signals(persona_a, persona_b)

    avg_satisfaction_a = _avg_satisfaction(events_a)
    avg_satisfaction_b = _avg_satisfaction(events_b)

    conflict_penalty = sum(
        max(0.0, sig - CONFLICT_THRESHOLDS[ctype])
        for ctype, sig in signals.items()
        if sig > CONFLICT_THRESHOLDS[ctype]
    ) * 0.08
    base_score = (0.35 * avg_satisfaction_a + 0.35 * avg_satisfaction_b + 0.30 * 0.7)
    compatibility_score = max(0.0, min(1.0, base_score - conflict_penalty))

    conflicts: list[ConflictEvent] = []
    shared_ticks = min(len(events_a), len(events_b))
    conflict_tick = max(0, shared_ticks // 2)

    for ctype, sig in signals.items():
        if sig > CONFLICT_THRESHOLDS[ctype]:
            h = hashlib.sha256(f"{persona_a.subject_id}|{persona_b.subject_id}|{ctype}".encode()).digest()[0]
            tick = (conflict_tick + (h % 6)) % max(1, shared_ticks)
            severity = min(0.9, 0.3 + sig * 0.6)
            conflicts.append(ConflictEvent(
                conflict_id=str(uuid.uuid4()), tick=tick, conflict_type=ctype, room="shared",
                persona_a_id=persona_a.subject_id, persona_b_id=persona_b.subject_id,
                description=CONFLICT_DESCRIPTIONS.get(ctype, "Behavioral friction detected."),
                severity=severity))

    score = compatibility_score
    label = ("Excellent Match" if score >= 0.80 else "Good Match" if score >= 0.65 else
             "Acceptable" if score >= 0.50 else "Challenging" if score >= 0.35 else "Poor Match")

    return {
        "compatibility_score": compatibility_score,
        "label": label,
        "conflicts": [c.model_dump() for c in conflicts],
        "signals": signals,
        "events": [],
    }


def _avg_satisfaction(events: list[dict]) -> float:
    if not events:
        return 0.5
    deltas = [float(e.get("satisfaction_delta", 0.0)) for e in events]
    cumulative = 0.75 + sum(deltas)
    return max(0.0, min(1.0, cumulative))

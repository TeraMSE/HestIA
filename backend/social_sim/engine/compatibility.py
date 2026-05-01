"""Roommate Compatibility Agent (Feature 3)."""

from __future__ import annotations

import logging
import time
import uuid
import hashlib
import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

try:
    from .environment import EnvironmentEngine, Property
    from .life_simulation import LifeSimulationAgent, SimulationEvent
    from .llm_client import UnifiedLLMClient
    from .memory import MemoryStream
    from .persona import Persona
except ImportError:  # pragma: no cover - allows direct script execution
    from environment import EnvironmentEngine, Property
    from life_simulation import LifeSimulationAgent, SimulationEvent
    from llm_client import UnifiedLLMClient
    from memory import MemoryStream
    from persona import Persona


logger = logging.getLogger(__name__)


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
    resolution: Optional[str] = None


class RoommateCompatibilityAgent:
    """Runs cohabitation simulation for two independent personas."""

    def __init__(
        self,
        persona_a: Persona,
        persona_b: Persona,
        property: Property,
        llm_client: UnifiedLLMClient,
    ) -> None:
        self.persona_a = persona_a
        self.persona_b = persona_b
        self.property = property
        self.llm_client = llm_client

        self.memory_a = MemoryStream(persona_a.subject_id, llm_client)
        self.memory_b = MemoryStream(persona_b.subject_id, llm_client)

        self.agent_a = LifeSimulationAgent(
            persona_a,
            property,
            llm_client,
            self.memory_a,
        )
        self.agent_b = LifeSimulationAgent(
            persona_b,
            property,
            llm_client,
            self.memory_b,
        )

        self.conflicts: List[ConflictEvent] = []
        self.shared_rooms = [
            room.name for room in property.rooms if bool(room.properties["shared"])
        ]

    def detect_behavioral_conflicts(
        self,
        event_a: SimulationEvent,
        event_b: SimulationEvent,
        tick: int,
    ) -> List[ConflictEvent]:
        logger.info(
            "Groq rate-limit precaution: sleeping 1.5s before conflict detection call."
        )
        time.sleep(1.5)

        system_prompt = (
            "You are a neutral housing mediator analyzing two roommates' "
            "behaviors. Be objective and specific."
        )

        user_message = (
            f"Roommate A ({self.persona_a.name}) this hour:\n"
            f"{event_a.action}\n\n"
            f"Roommate B ({self.persona_b.name}) this hour:\n"
            f"{event_b.action}\n\n"
            "Shared spaces in the apartment:\n"
            f"{', '.join(self.shared_rooms)}\n\n"
            "Known friction points:\n"
            f"- A's noise sensitivity: {self.persona_a.traits.get('noise_sensitivity', 0.5):.1f}\n"
            f"- B smoker: {bool(self.persona_b.traits.get('smoker', False))}\n"
            f"- A cleanliness: {self.persona_a.traits.get('cleanliness', 0.5):.1f}\n"
            f"- B cleanliness: {self.persona_b.traits.get('cleanliness', 0.5):.1f}\n"
            f"- A early_riser: {bool(self.persona_a.traits.get('early_riser', False))}\n"
            f"- B early_riser: {bool(self.persona_b.traits.get('early_riser', False))}\n\n"
            "Identify any behavioral conflicts between these two actions in shared "
            "living. Only report real conflicts, not hypothetical ones. If no "
            "conflict exists, return empty list."
        )

        result = self.llm_client.complete_structured(
            system_prompt=system_prompt,
            user_message=user_message,
            output_schema={
                "conflicts": [
                    {
                        "conflict_type": "string (noise/cleanliness/smoking/thermal/schedule/space/other)",
                        "room": "string",
                        "description": "string",
                        "severity": 0.0,
                    }
                ]
            },
        )

        events: List[ConflictEvent] = []
        for conflict in result.get("conflicts", []) or []:
            conflict_type_raw = str(conflict.get("conflict_type", "other")).strip().lower() or "other"
            room = str(conflict.get("room", "Living Room")).strip() or "Living Room"
            description = str(conflict.get("description", "Behavioral friction detected.")).strip()
            severity_raw = conflict.get("severity", 0.3)
            try:
                severity = float(severity_raw)
            except (TypeError, ValueError):
                severity = 0.3

            inferred_type = self._infer_conflict_type(
                conflict_type=conflict_type_raw,
                description=description,
            )
            severity = self._calibrate_conflict_severity(
                inferred_type=inferred_type,
                llm_severity=severity,
                description=description,
                tick=tick,
            )

            if re.search(r"\b(may|might|potential(?:ly)?|possibly)\b", description.lower()):
                description = f"Observed behavioral friction: {description}"

            events.append(
                ConflictEvent(
                    conflict_id=str(uuid.uuid4()),
                    tick=tick,
                    conflict_type=inferred_type,
                    room=room,
                    persona_a_id=self.persona_a.subject_id,
                    persona_b_id=self.persona_b.subject_id,
                    description=description,
                    severity=severity,
                )
            )
        return events

    def _infer_conflict_type(self, conflict_type: str, description: str) -> str:
        allowed_types = {"noise", "cleanliness", "smoking", "thermal", "schedule", "space", "other"}
        text = f"{conflict_type} {description}".lower()

        alias_map = {
            "temperature": "thermal",
            "thermostat": "thermal",
            "heat": "thermal",
            "heating": "thermal",
            "cooling": "thermal",
            "cold": "thermal",
            "hot": "thermal",
        }
        if conflict_type in alias_map:
            conflict_type = alias_map[conflict_type]

        keyword_map = {
            "noise": ["noise", "loud", "music", "sound", "volume", "disturb", "quiet"],
            "cleanliness": ["clean", "dirty", "mess", "trash", "dishes", "hygiene"],
            "smoking": ["smok", "cigarette", "vape", "odor", "smell"],
            "thermal": [
                "temperature",
                "thermostat",
                "heat",
                "heating",
                "cool",
                "cooling",
                "cold",
                "warm",
                "hot",
                "air conditioning",
                "ac",
            ],
            "schedule": ["late", "early", "morning", "night", "sleep", "wake", "routine"],
            "space": ["space", "shared", "kitchen", "bathroom", "living room", "occupy"],
        }

        keyword_scores: Dict[str, float] = {name: 0.0 for name in keyword_map}
        for conflict_name, tokens in keyword_map.items():
            for token in tokens:
                if token in text:
                    keyword_scores[conflict_name] += 1.0

        signal_scores = self._compute_conflict_signals()
        combined_scores: Dict[str, float] = {}
        for conflict_name in keyword_map:
            combined_scores[conflict_name] = (
                0.55 * keyword_scores.get(conflict_name, 0.0)
                + 2.5 * signal_scores.get(conflict_name, 0.0)
            )

        best_type = max(combined_scores, key=lambda name: combined_scores[name])
        best_score = combined_scores[best_type]

        if conflict_type in allowed_types and conflict_type != "other":
            current_score = combined_scores.get(conflict_type, 0.0)
            if current_score >= best_score - 0.05:
                return conflict_type

        if best_score <= 0.2:
            return conflict_type if conflict_type in allowed_types else "other"
        return best_type

    def _compute_conflict_signals(self) -> Dict[str, float]:
        noise_a = float(self.persona_a.traits.get("noise_sensitivity", 0.5))
        noise_b = float(self.persona_b.traits.get("noise_sensitivity", 0.5))
        clean_a = float(self.persona_a.traits.get("cleanliness", 0.5))
        clean_b = float(self.persona_b.traits.get("cleanliness", 0.5))
        thermal_a = float(self.persona_a.traits.get("thermal_sensitivity", 0.5))
        thermal_b = float(self.persona_b.traits.get("thermal_sensitivity", 0.5))
        intro_a = float(self.persona_a.traits.get("introversion", 0.5))
        intro_b = float(self.persona_b.traits.get("introversion", 0.5))

        early_a = bool(self.persona_a.traits.get("early_riser", False))
        early_b = bool(self.persona_b.traits.get("early_riser", False))
        smoker_a = bool(self.persona_a.traits.get("smoker", False))
        smoker_b = bool(self.persona_b.traits.get("smoker", False))

        neighborhood_noise = float(getattr(self.property, "neighborhood_noise", 0.5))
        avg_temp = 0.0
        room_count = 0
        smoking_rooms = 0
        for room in self.property.rooms:
            avg_temp += float(room.properties.get("temperature", 0.5))
            room_count += 1
            if bool(room.properties.get("smoking_allowed", False)):
                smoking_rooms += 1
        avg_temp = (avg_temp / room_count) if room_count else 0.5
        smoking_allowed_anywhere = smoking_rooms > 0

        noise_signal = min(1.0, (abs(noise_a - noise_b) * 0.5) + (neighborhood_noise * max(noise_a, noise_b)))
        cleanliness_signal = min(1.0, abs(clean_a - clean_b))
        smoking_signal = min(
            1.0,
            (1.0 if smoker_a != smoker_b else 0.0)
            + (0.6 if (smoker_a or smoker_b) and not smoking_allowed_anywhere else 0.0),
        )
        schedule_signal = 1.0 if early_a != early_b else 0.15
        temperature_signal = min(1.0, abs(thermal_a - thermal_b) * 0.7 + abs(avg_temp - 0.5) * 0.6)
        space_signal = min(1.0, abs(intro_a - intro_b) * 0.8)

        return {
            "noise": noise_signal,
            "cleanliness": cleanliness_signal,
            "smoking": smoking_signal,
            "thermal": temperature_signal,
            "schedule": schedule_signal,
            "space": space_signal,
        }

    def _calibrate_conflict_severity(
        self,
        inferred_type: str,
        llm_severity: float,
        description: str,
        tick: int,
    ) -> float:
        llm_severity = max(0.0, min(1.0, float(llm_severity)))
        signals = self._compute_conflict_signals()
        signal_strength = signals.get(inferred_type, 0.35)

        hash_key = f"{self.persona_a.subject_id}|{self.persona_b.subject_id}|{tick}|{description}"
        hashed = hashlib.sha256(hash_key.encode("utf-8")).digest()[0]
        jitter = ((hashed / 255.0) - 0.5) * 0.14

        severity_from_signal = 0.22 + (0.62 * signal_strength)
        calibrated = (0.55 * llm_severity) + (0.45 * severity_from_signal) + jitter

        if re.search(r"\b(shouting|screaming|argument|fight|threat)\b", description.lower()):
            calibrated += 0.08
        if re.search(r"\b(minor|small|brief)\b", description.lower()):
            calibrated -= 0.06

        return max(0.15, min(0.95, calibrated))

    def run_cohabitation_simulation(
        self,
        num_ticks: int = 12,
        progress_callback=None,
    ) -> Dict[str, Any]:
        for tick in range(num_ticks):
            event_a = self.agent_a.run_tick()
            event_b = self.agent_b.run_tick()

            new_conflicts = self.detect_behavioral_conflicts(event_a, event_b, tick)

            for conflict in new_conflicts:
                self.conflicts.append(conflict)

                self.memory_a.add_memory(
                    f"Conflict with {self.persona_b.name}: {conflict.description}",
                    simulation_time=float(tick),
                    tags=["conflict", conflict.conflict_type],
                )
                self.memory_b.add_memory(
                    f"Conflict with {self.persona_a.name}: {conflict.description}",
                    simulation_time=float(tick),
                    tags=["conflict", conflict.conflict_type],
                )

                penalty = conflict.severity * 0.05
                self.agent_a.satisfaction = max(0.0, self.agent_a.satisfaction - penalty)
                self.agent_b.satisfaction = max(0.0, self.agent_b.satisfaction - penalty)

            if progress_callback:
                progress_callback(
                    tick / num_ticks * 100,
                    f"Cohabitation hour {tick + 1}/{num_ticks}...",
                )

        score = self._compute_compatibility_score()
        label = self._compatibility_label(score)

        conflict_summary: Dict[str, int] = {}
        for conflict in self.conflicts:
            conflict_summary[conflict.conflict_type] = (
                conflict_summary.get(conflict.conflict_type, 0) + 1
            )

        return {
            "persona_a": self.persona_a.to_dict(),
            "persona_b": self.persona_b.to_dict(),
            "property_id": self.property.property_id,
            "num_ticks": num_ticks,
            "compatibility_score": score,
            "compatibility_label": label,
            "conflicts": [conflict.model_dump() for conflict in self.conflicts],
            "conflict_summary": conflict_summary,
            "persona_a_satisfaction": self.agent_a.satisfaction,
            "persona_b_satisfaction": self.agent_b.satisfaction,
            "needs_mediation": score < 0.6,
        }

    def _compute_compatibility_score(self) -> float:
        if not self.conflicts:
            return 1.0

        total_ticks = max(len(self.agent_a.events), len(self.agent_b.events), 1)
        total_conflicts = len(self.conflicts)
        conflict_ticks = len({int(conflict.tick) for conflict in self.conflicts})

        avg_severity = sum(float(conflict.severity) for conflict in self.conflicts) / total_conflicts
        high_severity_ratio = (
            sum(1 for conflict in self.conflicts if float(conflict.severity) >= 0.7) / total_conflicts
        )

        conflicts_per_tick = min(1.0, total_conflicts / total_ticks)
        tick_conflict_ratio = min(1.0, conflict_ticks / total_ticks)

        penalty = (
            0.55 * tick_conflict_ratio
            + 0.30 * (avg_severity * conflicts_per_tick)
            + 0.15 * (high_severity_ratio * conflicts_per_tick)
        )
        score = 1.0 - penalty
        return max(0.0, min(1.0, score))

    @staticmethod
    def _compatibility_label(score: float) -> str:
        if score >= 0.8:
            return "Highly Compatible"
        if score >= 0.65:
            return "Compatible with Minor Friction"
        if score >= 0.5:
            return "Moderate Compatibility"
        if score >= 0.35:
            return "Significant Conflicts"
        return "Incompatible"


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")

    persona_a = Persona.from_traits(
        subject_id="clean001",
        name="Amina",
        traits={
            "introversion": 0.55,
            "noise_sensitivity": 0.7,
            "cleanliness": 0.92,
            "thermal_sensitivity": 0.5,
            "early_riser": True,
            "smoker": False,
        },
    )
    persona_b = Persona.from_traits(
        subject_id="messy002",
        name="Youssef",
        traits={
            "introversion": 0.25,
            "noise_sensitivity": 0.3,
            "cleanliness": 0.2,
            "thermal_sensitivity": 0.4,
            "early_riser": False,
            "smoker": True,
        },
    )

    property = EnvironmentEngine().create_mock_property(
        property_type="2br",
        noise_level=0.7,
        temperature=0.5,
        smoking_allowed=False,
    )

    compatibility_agent = RoommateCompatibilityAgent(
        persona_a=persona_a,
        persona_b=persona_b,
        property=property,
        llm_client=UnifiedLLMClient(),
    )

    results = compatibility_agent.run_cohabitation_simulation(num_ticks=4)

    print("Compatibility score:", results["compatibility_score"])
    print("Compatibility label:", results["compatibility_label"])
    print("\nConflicts:")
    for conflict in results["conflicts"]:
        print(conflict)

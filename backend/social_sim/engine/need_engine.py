"""Need states and priority modeling for EILS."""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List

from pydantic import BaseModel, Field

from .persona import Persona


class NeedCategory(str, Enum):
    THERMAL_COMFORT = "thermal_comfort"
    ACOUSTIC_COMFORT = "acoustic_comfort"
    MOBILITY = "mobility"
    NOURISHMENT = "nourishment"
    SOCIAL = "social"
    REST = "rest"
    ROUTINE = "routine"
    SPACE = "space"
    CLEANLINESS = "cleanliness_env"


class NeedState(BaseModel):
    category: NeedCategory
    urgency: float = Field(ge=0.0, le=1.0)
    label: str
    last_fulfilled_tick: int = 0
    fulfillment_attempts: int = 0


class NeedEngine:
    """Need engine for emergent persona behavior in EILS."""

    TRAIT_NEED_MAP: Dict[str, Dict[NeedCategory, float]] = {
        "thermal_sensitivity": {
            NeedCategory.THERMAL_COMFORT: 1.0,
        },
        "noise_sensitivity": {
            NeedCategory.ACOUSTIC_COMFORT: 1.0,
        },
        "introversion": {
            NeedCategory.SPACE: 0.8,
            NeedCategory.ACOUSTIC_COMFORT: 0.3,
            NeedCategory.SOCIAL: -0.5,
        },
        "early_riser": {
            NeedCategory.ROUTINE: 0.9,
            NeedCategory.MOBILITY: 0.6,
        },
        "cleanliness": {
            NeedCategory.CLEANLINESS: 1.0,
        },
    }

    def __init__(self, persona: Persona | None = None):
        self.persona = persona
        self.base_need_intensities: Dict[NeedCategory, float] = {}
        self.need_states: Dict[NeedCategory, NeedState] = {}

        if persona is not None:
            self._initialize_for_persona(persona)

    def _initialize_for_persona(self, persona: Persona) -> None:
        self.persona = persona
        self.base_need_intensities = self._compute_base_need_intensities(persona)
        self.need_states = {
            category: NeedState(
                category=category,
                urgency=0.2,
                label=self._label_for(category=category, urgency=0.2),
                last_fulfilled_tick=0,
                fulfillment_attempts=0,
            )
            for category in NeedCategory
        }

    @staticmethod
    def _clamp(value: float) -> float:
        return max(0.0, min(1.0, float(value)))

    def _compute_base_need_intensities(self, persona: Persona) -> Dict[NeedCategory, float]:
        traits = persona.traits
        big_five = persona.big_five or {}

        thermal_sensitivity = self._clamp(float(traits.get("thermal_sensitivity", 0.5)))
        noise_sensitivity = self._clamp(float(traits.get("noise_sensitivity", 0.5)))
        introversion = self._clamp(float(traits.get("introversion", 0.5)))
        cleanliness = self._clamp(float(traits.get("cleanliness", 0.5)))
        early_riser = bool(traits.get("early_riser", False))

        base: Dict[NeedCategory, float] = {
            NeedCategory.THERMAL_COMFORT: thermal_sensitivity,
            NeedCategory.ACOUSTIC_COMFORT: noise_sensitivity,
            NeedCategory.MOBILITY: 0.7 + (0.3 if early_riser else 0.0),
            NeedCategory.NOURISHMENT: 0.8,
            NeedCategory.SOCIAL: 0.7 * (1.0 - introversion),
            NeedCategory.REST: 0.7,
            NeedCategory.ROUTINE: 0.8 if early_riser else 0.4,
            NeedCategory.SPACE: introversion * 0.8,
            NeedCategory.CLEANLINESS: cleanliness,
        }

        trait_adjustments: Dict[NeedCategory, float] = {
            category: 0.0 for category in NeedCategory
        }
        for trait_name, mapping in self.TRAIT_NEED_MAP.items():
            raw_trait = traits.get(trait_name, 0.0)
            trait_value = 1.0 if isinstance(raw_trait, bool) and raw_trait else float(raw_trait)
            trait_value = self._clamp(trait_value)
            for category, weight in mapping.items():
                trait_adjustments[category] += trait_value * float(weight)

        neuroticism = self._clamp(float(big_five.get("neuroticism", 0.5)))
        conscientiousness = self._clamp(float(big_five.get("conscientiousness", 0.5)))
        extraversion = self._clamp(float(big_five.get("extraversion", 0.5)))

        for category in NeedCategory:
            adjusted = base[category] + (0.08 * trait_adjustments[category])
            if category == NeedCategory.REST:
                adjusted += 0.05 * neuroticism
            if category == NeedCategory.ROUTINE:
                adjusted += 0.05 * conscientiousness
            if category == NeedCategory.SOCIAL:
                adjusted += 0.05 * extraversion
            base[category] = self._clamp(adjusted)

        return base

    @staticmethod
    def _label_for(category: NeedCategory, urgency: float) -> str:
        level = (
            "critical"
            if urgency >= 0.85
            else "high"
            if urgency >= 0.65
            else "moderate"
            if urgency >= 0.4
            else "low"
        )
        return f"{category.value.replace('_', ' ')} need is {level}"

    def tick(
        self,
        current_tick: int,
        fulfilled_needs: list[NeedCategory],
        env_state: Any | None = None,
    ) -> list[NeedState]:
        if self.persona is None:
            raise ValueError("NeedEngine requires a persona before ticking.")

        for category, state in self.need_states.items():
            if category in fulfilled_needs:
                state.urgency = max(0.1, state.urgency - 0.3)
                state.last_fulfilled_tick = current_tick
                state.fulfillment_attempts += 1
            else:
                ticks_since_fulfilled = max(0, current_tick - state.last_fulfilled_tick)
                growth = 0.1 * self.base_need_intensities[category] * (
                    1 + ticks_since_fulfilled * 0.05
                )
                state.urgency = min(1.0, state.urgency + growth)

            state.label = self._label_for(category, state.urgency)

        thermal_state = self.need_states.get(NeedCategory.THERMAL_COMFORT)
        if thermal_state is not None and env_state is not None:
            if bool(getattr(env_state, "heat_stress_active", False)):
                thermal_state.urgency = min(1.0, thermal_state.urgency + 0.3)
            elif bool(getattr(env_state, "too_hot_for_comfort", False)):
                thermal_state.urgency = min(1.0, thermal_state.urgency + 0.15)
            elif bool(getattr(env_state, "dangerously_cold", False)):
                thermal_state.urgency = min(1.0, thermal_state.urgency + 0.25)

            thermal_state.label = self._label_for(
                NeedCategory.THERMAL_COMFORT,
                thermal_state.urgency,
            )

        return list(self.need_states.values())

    def get_priority_needs(
        self,
        states: list[NeedState],
        top_k: int = 3,
    ) -> list[NeedState]:
        top_k = max(1, int(top_k))
        ordered = sorted(states, key=lambda item: item.urgency, reverse=True)
        return ordered[:top_k]

    def compute_needs(self, persona: Persona, tick: int) -> List[NeedState]:
        """Compatibility wrapper for existing scaffolded engine."""
        if self.persona is None or self.persona.subject_id != persona.subject_id:
            self._initialize_for_persona(persona)
        return self.tick(current_tick=tick, fulfilled_needs=[])


if __name__ == "__main__":
    test_persona = Persona.from_traits(
        subject_id="eils_test_001",
        name="EILS Test Persona",
        traits={
            "introversion": 0.45,
            "noise_sensitivity": 0.6,
            "cleanliness": 0.5,
            "thermal_sensitivity": 0.95,
            "early_riser": True,
            "smoker": False,
        },
    )

    engine = NeedEngine(test_persona)

    print("Running 3 ticks with thermal/mobility unmet...")
    for tick in range(1, 4):
        states = engine.tick(
            current_tick=tick,
            fulfilled_needs=[
                NeedCategory.NOURISHMENT,
                NeedCategory.REST,
            ],
        )
        thermal = next(s for s in states if s.category == NeedCategory.THERMAL_COMFORT)
        mobility = next(s for s in states if s.category == NeedCategory.MOBILITY)
        print(
            f"Tick {tick}: thermal={thermal.urgency:.3f}, mobility={mobility.urgency:.3f}"
        )

        top = engine.get_priority_needs(states, top_k=3)
        top_readable = ", ".join(f"{item.category.value}:{item.urgency:.3f}" for item in top)
        print(f"  Priority needs -> {top_readable}")

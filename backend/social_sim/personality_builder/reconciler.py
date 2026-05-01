"""Reconciliation layer mapping interview extraction to Persona/slider format."""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Dict, List

from pydantic import BaseModel, Field

from social_sim.engine.llm_client import UnifiedLLMClient
from social_sim.engine.persona import Persona


class ReconciliationResult(BaseModel):
    subject_id: str
    trait_vector: Dict[str, Any]
    slider_values: Dict[str, Any]
    confidence_per_trait: Dict[str, float]
    low_confidence_traits: List[str] = Field(default_factory=list)
    overrides: Dict[str, Any] = Field(default_factory=dict)
    source: str
    explanation: Dict[str, str]


class PersonalityReconciler:
    """Bridges interview extraction and manual slider workflow."""

    TRAIT_LABELS = {
        "introversion": "How introverted you are",
        "noise_sensitivity": "Sensitivity to noise",
        "cleanliness": "Cleanliness standards",
        "thermal_sensitivity": "Temperature sensitivity",
        "early_riser": "Morning vs night person",
        "smoker": "Whether you smoke",
    }

    NUMERIC_TRAITS = [
        "introversion",
        "noise_sensitivity",
        "cleanliness",
        "thermal_sensitivity",
    ]

    def reconcile(self, finalized_session: Dict[str, Any]) -> ReconciliationResult:
        trait_vector = dict(finalized_session.get("trait_vector", {}))
        confidence = {
            key: float(value)
            for key, value in dict(finalized_session.get("confidence_per_trait", {})).items()
        }
        explanation = {
            key: str(value)
            for key, value in dict(finalized_session.get("explanation", {})).items()
        }

        slider_values = {
            "introversion": int(self._clamp01(trait_vector.get("introversion", 0.5)) * 100),
            "noise_sensitivity": int(self._clamp01(trait_vector.get("noise_sensitivity", 0.5)) * 100),
            "cleanliness": int(self._clamp01(trait_vector.get("cleanliness", 0.5)) * 100),
            "thermal_sensitivity": int(self._clamp01(trait_vector.get("thermal_sensitivity", 0.5)) * 100),
            "early_riser": bool(trait_vector.get("early_riser", False)),
            "smoker": bool(trait_vector.get("smoker", False)),
        }

        low_confidence = [
            trait for trait, conf in confidence.items() if float(conf) < 0.5
        ]

        return ReconciliationResult(
            subject_id=str(finalized_session.get("subject_id", "unknown_subject")),
            trait_vector=trait_vector,
            slider_values=slider_values,
            confidence_per_trait=confidence,
            low_confidence_traits=low_confidence,
            overrides={},
            source="interview",
            explanation=explanation,
        )

    def apply_manual_override(
        self,
        result: ReconciliationResult,
        trait_name: str,
        new_value: Any,
    ) -> ReconciliationResult:
        previous_value = result.trait_vector.get(trait_name)
        result.overrides[trait_name] = {
            "previous": previous_value,
            "new": new_value,
            "timestamp": datetime.now().isoformat(),
        }

        if trait_name in self.NUMERIC_TRAITS:
            normalized_value = self._clamp01(new_value)
            result.trait_vector[trait_name] = normalized_value
            result.slider_values[trait_name] = int(normalized_value * 100)
        elif trait_name in {"early_riser", "smoker"}:
            bool_value = bool(new_value)
            result.trait_vector[trait_name] = bool_value
            result.slider_values[trait_name] = bool_value
        else:
            result.trait_vector[trait_name] = new_value
            result.slider_values[trait_name] = new_value

        result.source = "interview+manual"
        return result

    def to_persona(
        self,
        result: ReconciliationResult,
        name: str = None,
    ) -> Persona:
        return Persona.from_traits(
            subject_id=result.subject_id,
            traits=result.trait_vector,
            name=name,
        )

    def generate_profile_summary(
        self,
        result: ReconciliationResult,
        llm_client: UnifiedLLMClient,
    ) -> str:
        system_prompt = (
            "You are summarizing someone's personality for a housing compatibility "
            "system. Be warm, accurate, and concise."
        )
        user_message = (
            "Based on this person's profile:\n"
            f"{result.trait_vector}\n\n"
            "Explanations:\n"
            f"{result.explanation}\n\n"
            "Write a 3-sentence personality summary that describes how they'd be "
            "as a roommate. Use second person ('You are...'). Be specific and friendly."
        )

        time.sleep(1)
        return llm_client.complete(
            system_prompt=system_prompt,
            user_message=user_message,
            use_fast_model=True,
        )

    @staticmethod
    def _clamp01(value: Any) -> float:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            numeric = 0.5
        return max(0.0, min(1.0, numeric))


TraitReconciler = PersonalityReconciler


if __name__ == "__main__":
    mock_finalized_session = {
        "subject_id": "demo_reconcile_001",
        "trait_vector": {
            "introversion": 0.62,
            "noise_sensitivity": 0.81,
            "cleanliness": 0.77,
            "thermal_sensitivity": 0.58,
            "early_riser": True,
            "smoker": False,
        },
        "confidence_per_trait": {
            "introversion": 0.74,
            "noise_sensitivity": 0.66,
            "cleanliness": 0.42,
            "thermal_sensitivity": 0.71,
            "early_riser": 0.63,
            "smoker": 0.49,
        },
        "explanation": {
            "introversion": "You prefer quieter weekdays and private space.",
            "noise_sensitivity": "You said loud sounds disturb your focus.",
            "cleanliness": "You described strong standards around kitchen hygiene.",
            "thermal_sensitivity": "You mentioned feeling cold faster than others.",
            "early_riser": "You reported waking up early on weekdays.",
            "smoker": "You explicitly said you do not smoke.",
        },
    }

    reconciler = PersonalityReconciler()
    result = reconciler.reconcile(mock_finalized_session)
    result = reconciler.apply_manual_override(result, "cleanliness", 0.85)

    print("Slider values:")
    print(result.slider_values)
    print("\nLow confidence traits:")
    print(result.low_confidence_traits)

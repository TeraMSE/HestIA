"""Reconciliation layer mapping interview extraction to Persona/slider format.
Ported from Domus AI — import path adapted for HestIA backend.
"""

from __future__ import annotations

import time
from datetime import datetime
from typing import Any, Dict, List

from .llm_client import UnifiedLLMClient


class ReconciliationResult:
    def __init__(
        self,
        subject_id: str,
        trait_vector: Dict[str, Any],
        slider_values: Dict[str, Any],
        confidence_per_trait: Dict[str, float],
        low_confidence_traits: List[str],
        source: str,
        explanation: Dict[str, str],
    ) -> None:
        self.subject_id = subject_id
        self.trait_vector = trait_vector
        self.slider_values = slider_values
        self.confidence_per_trait = confidence_per_trait
        self.low_confidence_traits = low_confidence_traits
        self.overrides: Dict[str, Any] = {}
        self.source = source
        self.explanation = explanation


class PersonalityReconciler:
    """Bridges interview extraction and manual slider workflow."""

    NUMERIC_TRAITS = ["introversion", "noise_sensitivity", "cleanliness", "thermal_sensitivity",
                      "openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism"]

    def reconcile(self, finalized_session: Dict[str, Any]) -> ReconciliationResult:
        trait_vector = dict(finalized_session.get("trait_vector", {}))
        confidence = {k: float(v) for k, v in dict(finalized_session.get("confidence_per_trait", {})).items()}
        explanation = {k: str(v) for k, v in dict(finalized_session.get("explanation", {})).items()}

        slider_values = {
            "introversion": int(self._clamp01(trait_vector.get("introversion", 0.5)) * 100),
            "noise_sensitivity": int(self._clamp01(trait_vector.get("noise_sensitivity", 0.5)) * 100),
            "cleanliness": int(self._clamp01(trait_vector.get("cleanliness", 0.5)) * 100),
            "thermal_sensitivity": int(self._clamp01(trait_vector.get("thermal_sensitivity", 0.5)) * 100),
            "openness": int(self._clamp01(trait_vector.get("openness", 0.5)) * 100),
            "conscientiousness": int(self._clamp01(trait_vector.get("conscientiousness", 0.5)) * 100),
            "extraversion": int(self._clamp01(trait_vector.get("extraversion", 0.5)) * 100),
            "agreeableness": int(self._clamp01(trait_vector.get("agreeableness", 0.5)) * 100),
            "neuroticism": int(self._clamp01(trait_vector.get("neuroticism", 0.5)) * 100),
            "early_riser": bool(trait_vector.get("early_riser", False)),
            "smoker": bool(trait_vector.get("smoker", False)),
        }
        low_confidence = [t for t, c in confidence.items() if c < 0.5]

        return ReconciliationResult(
            subject_id=str(finalized_session.get("subject_id", "unknown")),
            trait_vector=trait_vector,
            slider_values=slider_values,
            confidence_per_trait=confidence,
            low_confidence_traits=low_confidence,
            source="interview",
            explanation=explanation,
        )

    def apply_manual_override(self, result: ReconciliationResult, trait_name: str, new_value: Any) -> ReconciliationResult:
        previous_value = result.trait_vector.get(trait_name)
        result.overrides[trait_name] = {"previous": previous_value, "new": new_value, "timestamp": datetime.now().isoformat()}
        if trait_name in self.NUMERIC_TRAITS:
            normalized = self._clamp01(new_value)
            result.trait_vector[trait_name] = normalized
            result.slider_values[trait_name] = int(normalized * 100)
        elif trait_name in {"early_riser", "smoker"}:
            b = bool(new_value)
            result.trait_vector[trait_name] = b
            result.slider_values[trait_name] = b
        else:
            result.trait_vector[trait_name] = new_value
            result.slider_values[trait_name] = new_value
        result.source = "interview+manual"
        return result

    def generate_profile_summary(self, result: ReconciliationResult, llm_client: UnifiedLLMClient) -> str:
        system_prompt = (
            "You are summarizing someone's personality for a housing compatibility system. "
            "Be warm, accurate, and concise."
        )
        user_message = (
            f"Based on this person's profile:\n{result.trait_vector}\n\n"
            f"Explanations:\n{result.explanation}\n\n"
            "Write a 3-sentence personality summary that describes how they'd be as a roommate. "
            "Use second person ('You are...'). Be specific and friendly."
        )
        time.sleep(0.5)
        return llm_client.complete(system_prompt=system_prompt, user_message=user_message, use_fast_model=True)

    @staticmethod
    def _clamp01(value: Any) -> float:
        try:
            return max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            return 0.5

"""SOTOPIA-inspired scoring for roommate housing compatibility."""

from __future__ import annotations

import logging
import math
import time
from typing import Any, Dict

from pydantic import BaseModel

try:
    from .compatibility import RoommateCompatibilityAgent
    from .environment import EnvironmentEngine
    from .llm_client import UnifiedLLMClient
    from .mediation import MediationAgent
    from .persona import Persona
except ImportError:  # pragma: no cover - allows direct script execution
    from compatibility import RoommateCompatibilityAgent
    from environment import EnvironmentEngine
    from llm_client import UnifiedLLMClient
    from mediation import MediationAgent
    from persona import Persona


logger = logging.getLogger(__name__)


class HousingCompatibilityScore(BaseModel):
    subject_a_id: str
    subject_b_id: str
    property_id: str
    comfort_achievement: float
    social_compatibility: float
    conflict_intensity: float
    mediation_effectiveness: float
    lifestyle_alignment: float
    resolution_acceptance: float
    overall_score: float
    grade: str
    llm_evaluation: str


class SOTOPIAInspiredScorer:
    def __init__(self, llm_client: UnifiedLLMClient):
        self.llm_client = llm_client
        self.weights = {
            "comfort_achievement": 0.20,
            "social_compatibility": 0.25,
            "conflict_intensity": 0.20,
            "mediation_effectiveness": 0.10,
            "lifestyle_alignment": 0.15,
            "resolution_acceptance": 0.10,
        }

    def score_comfort(self, sim_result: Dict[str, Any]) -> float:
        return self._clamp(float(sim_result.get("final_satisfaction", 0.5)) * 10.0)

    def score_social(self, compat_result: Dict[str, Any]) -> float:
        return self._clamp(float(compat_result.get("compatibility_score", 0.5)) * 10.0)

    def score_conflict_intensity(self, compat_result: Dict[str, Any]) -> float:
        conflicts = compat_result.get("conflicts", [])
        if not conflicts:
            return 10.0
        average_severity = sum(float(conflict.get("severity", 0.0)) for conflict in conflicts) / len(conflicts)
        return self._clamp(10.0 - average_severity * 10.0)

    def score_mediation(self, med_result: Dict[str, Any]) -> float:
        if not med_result.get("mediation_applied"):
            return 5.0
        final_score = float(
            med_result.get(
                "final_compatibility_score",
                med_result.get("compatibility_score", 0.5),
            )
        )
        base_score = float(med_result.get("compatibility_score", final_score))
        improvement = final_score - base_score
        return self._clamp(5.0 + improvement * 20.0)

    def score_lifestyle(self, persona_a: Persona, persona_b: Persona) -> float:
        vector_a = list(persona_a.big_five.values())
        vector_b = list(persona_b.big_five.values())

        dot_product = sum(value_a * value_b for value_a, value_b in zip(vector_a, vector_b))
        norm_a = math.sqrt(sum(value * value for value in vector_a))
        norm_b = math.sqrt(sum(value * value for value in vector_b))

        if norm_a == 0.0 or norm_b == 0.0:
            cosine_similarity = 0.0
        else:
            cosine_similarity = dot_product / (norm_a * norm_b)
            cosine_similarity = max(-1.0, min(1.0, cosine_similarity))

        return self._clamp((cosine_similarity + 1.0) * 5.0)

    def score_acceptance(self, med_result: Dict[str, Any]) -> float:
        if not med_result.get("mediation_applied"):
            return 5.0

        acceptance_values = []
        for mediation in med_result.get("mediations", []):
            proposed_rule = mediation.get("proposed_rule", {})
            acceptance_values.append(float(proposed_rule.get("acceptance_likelihood", 0.5)))

        if not acceptance_values:
            return 5.0
        return self._clamp(sum(acceptance_values) / len(acceptance_values) * 10.0)

    def llm_judge(
        self,
        persona_a: Persona,
        persona_b: Persona,
        med_result: Dict[str, Any],
    ) -> str:
        logger.info("Rate-limit precaution: sleeping 1s before LLM judge call.")
        time.sleep(1)

        score = float(
            med_result.get(
                "final_compatibility_score",
                med_result.get("compatibility_score", 0.5),
            )
        )
        conflicts = med_result.get("conflicts", [])
        rules = med_result.get("lease_checklist", [])

        system_prompt = "You are a neutral housing counselor in Tunisia giving practical advice."
        user_message = (
            "Evaluate this roommate pairing:\n\n"
            f"Person A: {persona_a.persona_description}\n"
            f"Person B: {persona_b.persona_description}\n\n"
            f"Compatibility score: {score:.0%}\n"
            f"Conflicts: {len(conflicts)} detected\n"
            f"House rules proposed: {rules}\n\n"
            "In 2 sentences: would you recommend this pairing? "
            "Be direct and practical."
        )
        return self.llm_client.complete(
            system_prompt=system_prompt,
            user_message=user_message,
            use_fast_model=True,
        )

    def compute_full_score(
        self,
        sim_result: Dict[str, Any],
        compat_result: Dict[str, Any],
        med_result: Dict[str, Any],
        persona_a: Persona,
        persona_b: Persona,
        property_id: str,
    ) -> HousingCompatibilityScore:
        dimensions = {
            "comfort_achievement": self.score_comfort(sim_result),
            "social_compatibility": self.score_social(compat_result),
            "conflict_intensity": self.score_conflict_intensity(compat_result),
            "mediation_effectiveness": self.score_mediation(med_result),
            "lifestyle_alignment": self.score_lifestyle(persona_a, persona_b),
            "resolution_acceptance": self.score_acceptance(med_result),
        }

        overall_score = sum(
            dimensions[dimension] * self.weights[dimension]
            for dimension in dimensions
        )

        if overall_score >= 8.0:
            grade = "A — Highly Recommended"
        elif overall_score >= 6.5:
            grade = "B — Recommended"
        elif overall_score >= 5.0:
            grade = "C — Acceptable with Conditions"
        elif overall_score >= 3.5:
            grade = "D — Not Recommended"
        else:
            grade = "F — Incompatible"

        llm_evaluation = self.llm_judge(persona_a, persona_b, med_result)

        return HousingCompatibilityScore(
            subject_a_id=persona_a.subject_id,
            subject_b_id=persona_b.subject_id,
            property_id=property_id,
            comfort_achievement=dimensions["comfort_achievement"],
            social_compatibility=dimensions["social_compatibility"],
            conflict_intensity=dimensions["conflict_intensity"],
            mediation_effectiveness=dimensions["mediation_effectiveness"],
            lifestyle_alignment=dimensions["lifestyle_alignment"],
            resolution_acceptance=dimensions["resolution_acceptance"],
            overall_score=overall_score,
            grade=grade,
            llm_evaluation=llm_evaluation,
        )

    @staticmethod
    def _clamp(value: float) -> float:
        return max(0.0, min(10.0, value))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")

    llm = UnifiedLLMClient()

    persona_a = Persona.from_traits(
        subject_id="scoreA001",
        name="Amina",
        traits={
            "introversion": 0.65,
            "noise_sensitivity": 0.8,
            "cleanliness": 0.9,
            "thermal_sensitivity": 0.45,
            "early_riser": True,
            "smoker": False,
        },
    )
    persona_b = Persona.from_traits(
        subject_id="scoreB001",
        name="Youssef",
        traits={
            "introversion": 0.2,
            "noise_sensitivity": 0.35,
            "cleanliness": 0.2,
            "thermal_sensitivity": 0.4,
            "early_riser": False,
            "smoker": True,
        },
    )

    property_data = EnvironmentEngine().create_mock_property(
        property_type="2br",
        noise_level=0.75,
        temperature=0.5,
        smoking_allowed=False,
    )

    compatibility_agent = RoommateCompatibilityAgent(
        persona_a=persona_a,
        persona_b=persona_b,
        property=property_data,
        llm_client=llm,
    )
    compatibility_result = compatibility_agent.run_cohabitation_simulation(num_ticks=4)

    mediation_agent = MediationAgent(llm_client=llm)
    mediation_result = mediation_agent.mediate_all_conflicts(
        compatibility_result=compatibility_result,
        persona_a=persona_a,
        persona_b=persona_b,
    )

    simulation_result = {
        "final_satisfaction": (
            float(compatibility_result.get("persona_a_satisfaction", 0.5))
            + float(compatibility_result.get("persona_b_satisfaction", 0.5))
        )
        / 2.0
    }

    scorer = SOTOPIAInspiredScorer(llm_client=llm)
    final_score = scorer.compute_full_score(
        sim_result=simulation_result,
        compat_result=compatibility_result,
        med_result=mediation_result,
        persona_a=persona_a,
        persona_b=persona_b,
        property_id=property_data.property_id,
    )

    print("Grade:", final_score.grade)
    print("Overall score:", round(final_score.overall_score, 2))
    print("LLM evaluation:", final_score.llm_evaluation)

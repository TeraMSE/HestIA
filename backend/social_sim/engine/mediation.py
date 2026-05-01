"""Mediation Agent (Feature 4)."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

try:
    from .compatibility import ConflictEvent, RoommateCompatibilityAgent
    from .llm_client import UnifiedLLMClient
    from .persona import Persona
except ImportError:  # pragma: no cover - allows direct script execution
    from compatibility import ConflictEvent, RoommateCompatibilityAgent
    from llm_client import UnifiedLLMClient
    from persona import Persona


logger = logging.getLogger(__name__)


class HouseRule(BaseModel):
    rule_id: str
    description: str
    target_conflict_type: str
    estimated_satisfaction_delta_a: float
    estimated_satisfaction_delta_b: float
    joint_score: float
    acceptance_likelihood: float


class MediationResult(BaseModel):
    mediation_id: str
    conflict_ids: List[str]
    proposed_rule: HouseRule
    rejected_rules: List[HouseRule]
    new_compatibility_score: float
    score_improvement: float
    mediation_summary: str


class MediationAgent:
    """Goal-directed mediator for high-severity roommate conflicts."""

    def __init__(self, llm_client: UnifiedLLMClient) -> None:
        self.llm_client = llm_client

    def mediate(
        self,
        conflicts: List[ConflictEvent],
        persona_a: Persona,
        persona_b: Persona,
        current_score: float,
    ) -> MediationResult:
        unresolved = [conflict for conflict in conflicts if not conflict.resolved]
        if not unresolved:
            raise ValueError("No unresolved conflicts available for mediation.")

        conflict = sorted(unresolved, key=lambda item: item.severity, reverse=True)[0]

        logger.info("Rate-limit precaution: sleeping 1s before mediation LLM call.")
        time.sleep(1)

        system_prompt = (
            "You are an expert housing mediator with deep knowledge of personality "
            "psychology. Be practical and specific."
        )
        root_cause_message = (
            f"Conflict: {conflict.description}\n"
            f"Type: {conflict.conflict_type}\n\n"
            f"Person A ({persona_a.name}):\n"
            f"{persona_a.persona_description}\n"
            f"Internal priorities:\n{persona_a.get_internal_parliament()}\n\n"
            f"Person B ({persona_b.name}):\n"
            f"{persona_b.persona_description}\n"
            f"Internal priorities:\n{persona_b.get_internal_parliament()}\n\n"
            "Using theory-of-mind:\n"
            "1. What does Person A fundamentally need?\n"
            "2. What does Person B fundamentally need?\n"
            "3. Root cause of this conflict in one sentence.\n\n"
            "Reply in JSON."
        )
        root_cause_result = self.llm_client.complete_structured(
            system_prompt=system_prompt,
            user_message=root_cause_message,
            output_schema={
                "person_a_need": "string",
                "person_b_need": "string",
                "root_cause": "string",
            },
        )

        time.sleep(1)

        rules_message = (
            f"Root cause: {root_cause_result.get('root_cause', '')}\n"
            f"Person A needs: {root_cause_result.get('person_a_need', '')}\n"
            f"Person B needs: {root_cause_result.get('person_b_need', '')}\n\n"
            "Generate exactly 3 house rules to resolve this.\n"
            "Each rule must:\n"
            "- Be specific and enforceable (e.g. time, place, frequency)\n"
            "- Fairly balance both parties' core needs\n"
            "- Be realistic for a shared Tunisian apartment\n\n"
            "For each: estimate satisfaction improvement (0.0-0.25) for each person "
            "and acceptance likelihood (0.0-1.0)."
        )
        rules_result = self.llm_client.complete_structured(
            system_prompt=system_prompt,
            user_message=rules_message,
            output_schema={
                "rules": [
                    {
                        "description": "string",
                        "satisfaction_delta_a": 0.0,
                        "satisfaction_delta_b": 0.0,
                        "acceptance_likelihood": 0.0,
                    }
                ]
            },
        )

        rule_objects: List[HouseRule] = []
        for raw_rule in (rules_result.get("rules") or [])[:3]:
            delta_a = self._clamp(float(raw_rule.get("satisfaction_delta_a", 0.0)), 0.0, 0.25)
            delta_b = self._clamp(float(raw_rule.get("satisfaction_delta_b", 0.0)), 0.0, 0.25)
            acceptance = self._clamp(float(raw_rule.get("acceptance_likelihood", 0.0)), 0.0, 1.0)
            joint_score = delta_a + delta_b

            rule_objects.append(
                HouseRule(
                    rule_id=str(uuid.uuid4()),
                    description=str(raw_rule.get("description", "No rule description provided.")).strip(),
                    target_conflict_type=conflict.conflict_type,
                    estimated_satisfaction_delta_a=delta_a,
                    estimated_satisfaction_delta_b=delta_b,
                    joint_score=joint_score,
                    acceptance_likelihood=acceptance,
                )
            )

        if not rule_objects:
            fallback_rule = HouseRule(
                rule_id=str(uuid.uuid4()),
                description="Agree on a weekly check-in and clear quiet-hours schedule.",
                target_conflict_type=conflict.conflict_type,
                estimated_satisfaction_delta_a=0.1,
                estimated_satisfaction_delta_b=0.1,
                joint_score=0.2,
                acceptance_likelihood=0.6,
            )
            rule_objects = [fallback_rule]

        ranked_rules = sorted(
            rule_objects,
            key=lambda rule: (
                rule.joint_score * rule.acceptance_likelihood,
                -abs(rule.estimated_satisfaction_delta_a - rule.estimated_satisfaction_delta_b),
            ),
            reverse=True,
        )

        proposed_rule = ranked_rules[0]
        rejected_rules = ranked_rules[1:]

        score_improvement = proposed_rule.joint_score / 2
        new_score = min(1.0, current_score + score_improvement)

        summary = (
            f"The {conflict.conflict_type} conflict was traced to: "
            f"{root_cause_result.get('root_cause', 'unclear root cause')}. "
            f"Proposed rule: '{proposed_rule.description}'. "
            f"Expected improvement: {current_score:.0%} → {new_score:.0%}."
        )

        conflict.resolved = True
        conflict.resolution = proposed_rule.description

        return MediationResult(
            mediation_id=str(uuid.uuid4()),
            conflict_ids=[conflict.conflict_id],
            proposed_rule=proposed_rule,
            rejected_rules=rejected_rules,
            new_compatibility_score=new_score,
            score_improvement=score_improvement,
            mediation_summary=summary,
        )

    def mediate_all_conflicts(
        self,
        compatibility_result: Dict[str, Any],
        persona_a: Persona,
        persona_b: Persona,
    ) -> Dict[str, Any]:
        result = dict(compatibility_result)

        if not compatibility_result.get("needs_mediation"):
            result.update(
                {
                    "mediation_applied": False,
                    "final_compatibility_score": compatibility_result.get("compatibility_score", 0.5),
                    "final_compatibility_label": compatibility_result.get("compatibility_label", self._label(compatibility_result.get("compatibility_score", 0.5))),
                    "lease_checklist": [],
                }
            )
            return result

        current_score = float(compatibility_result.get("compatibility_score", 0.5))
        conflicts = [ConflictEvent(**item) for item in compatibility_result.get("conflicts", [])]
        unresolved = sorted(
            [conflict for conflict in conflicts if not conflict.resolved],
            key=lambda item: -item.severity,
        )

        mediations: List[Dict[str, Any]] = []
        lease_checklist: List[str] = []

        for conflict in unresolved[:3]:
            mediation_result = self.mediate(
                conflicts=[conflict],
                persona_a=persona_a,
                persona_b=persona_b,
                current_score=current_score,
            )
            current_score = mediation_result.new_compatibility_score
            mediations.append(mediation_result.model_dump())
            lease_checklist.append(mediation_result.proposed_rule.description)

        result.update(
            {
                "mediation_applied": True,
                "mediations": mediations,
                "final_compatibility_score": current_score,
                "final_compatibility_label": self._label(current_score),
                "lease_checklist": lease_checklist,
            }
        )
        return result

    @staticmethod
    def _label(score: float) -> str:
        if score >= 0.8:
            return "Highly Compatible"
        if score >= 0.65:
            return "Compatible with Minor Friction"
        if score >= 0.5:
            return "Moderate Compatibility"
        if score >= 0.35:
            return "Significant Conflicts"
        return "Incompatible"

    @staticmethod
    def _clamp(value: float, min_value: float, max_value: float) -> float:
        return max(min_value, min(max_value, value))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")

    from .environment import EnvironmentEngine

    persona_a = Persona.from_traits(
        subject_id="medA001",
        name="Amina",
        traits={
            "introversion": 0.65,
            "noise_sensitivity": 0.8,
            "cleanliness": 0.9,
            "thermal_sensitivity": 0.4,
            "early_riser": True,
            "smoker": False,
        },
    )
    persona_b = Persona.from_traits(
        subject_id="medB001",
        name="Youssef",
        traits={
            "introversion": 0.2,
            "noise_sensitivity": 0.3,
            "cleanliness": 0.25,
            "thermal_sensitivity": 0.4,
            "early_riser": False,
            "smoker": True,
        },
    )

    property_data = EnvironmentEngine().create_mock_property(
        property_type="2br",
        noise_level=0.8,
        temperature=0.5,
        smoking_allowed=False,
    )

    llm = UnifiedLLMClient()
    compat = RoommateCompatibilityAgent(persona_a, persona_b, property_data, llm)
    compat_result = compat.run_cohabitation_simulation(num_ticks=4)

    mediator = MediationAgent(llm)
    mediated = mediator.mediate_all_conflicts(compat_result, persona_a, persona_b)

    print("Final score:", mediated.get("final_compatibility_score"))
    print("Lease checklist:", mediated.get("lease_checklist"))

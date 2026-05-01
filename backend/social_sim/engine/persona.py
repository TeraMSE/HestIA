"""Persona models for social simulation agents."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class Persona(BaseModel):
    subject_id: str
    name: str
    traits: Dict[str, Any] = Field(default_factory=dict)
    big_five: Dict[str, float] = Field(default_factory=dict)
    persona_description: str = ""
    behavioral_adjectives: List[str] = Field(default_factory=list)

    @classmethod
    def from_traits(cls, subject_id: str, traits: Dict[str, Any], name: Optional[str] = None) -> "Persona":
        if name is None:
            name = f"Person_{subject_id[:6]}"

        introversion = cls._clamp_float(traits.get("introversion", 0.5))
        noise_sensitivity = cls._clamp_float(traits.get("noise_sensitivity", 0.5))
        cleanliness = cls._clamp_float(traits.get("cleanliness", 0.5))
        thermal_sensitivity = cls._clamp_float(traits.get("thermal_sensitivity", 0.5))
        early_riser = bool(traits.get("early_riser", False))
        smoker = bool(traits.get("smoker", False))

        big_five = {
            "extraversion": 1.0 - introversion,
            "conscientiousness": cleanliness * 0.6 + (1.0 if early_riser else 0.0) * 0.4,
            "neuroticism": noise_sensitivity * 0.5 + thermal_sensitivity * 0.5,
            "agreeableness": 0.3 if smoker else 0.8,
            "openness": 0.5,
        }

        persona_description = cls._build_persona_description(
            introversion=introversion, cleanliness=cleanliness, early_riser=early_riser,
            smoker=smoker, noise_sensitivity=noise_sensitivity, thermal_sensitivity=thermal_sensitivity,
        )
        behavioral_adjectives = cls._build_behavioral_adjectives(big_five)
        normalized_traits = {
            "introversion": introversion, "noise_sensitivity": noise_sensitivity,
            "cleanliness": cleanliness, "thermal_sensitivity": thermal_sensitivity,
            "early_riser": early_riser, "smoker": smoker,
        }
        return cls(subject_id=subject_id, name=name, traits=normalized_traits,
                   big_five=big_five, persona_description=persona_description,
                   behavioral_adjectives=behavioral_adjectives)

    def to_system_prompt(self) -> str:
        return (
            f"You are {self.name}, a person living in a shared apartment. "
            f"Your profile:\n{self.persona_description}\n"
            f"Your personality style: {', '.join(self.behavioral_adjectives)}\n"
            f"Big Five scores (0.0=low, 1.0=high):\n"
            f"- Extraversion: {self.big_five['extraversion']:.2f}\n"
            f"- Conscientiousness: {self.big_five['conscientiousness']:.2f}\n"
            f"- Neuroticism: {self.big_five['neuroticism']:.2f}\n"
            f"- Agreeableness: {self.big_five['agreeableness']:.2f}\n"
            "Always respond and react consistently with this personality profile."
        )

    def get_internal_parliament(self) -> List[Dict[str, Any]]:
        traits = self.traits
        return [
            {"name": "Comfort Voice", "concern": "physical comfort, temperature, noise levels",
             "weight": round((traits["noise_sensitivity"] + traits["thermal_sensitivity"]) / 2, 2)},
            {"name": "Social Voice", "concern": "privacy, social interaction, smoking habits",
             "weight": round(traits["introversion"] * 0.6 + (0.7 if traits["smoker"] else 0.2) * 0.4, 2)},
            {"name": "Order Voice", "concern": "cleanliness, schedule, routine",
             "weight": round(traits["cleanliness"] * 0.6 + (0.8 if traits["early_riser"] else 0.3) * 0.4, 2)},
            {"name": "Adaptation Voice", "concern": "compromise, flexibility", "weight": 0.3},
        ]

    def to_dict(self) -> Dict[str, Any]:
        return self.model_dump()

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Persona":
        return cls.model_validate(data)

    @staticmethod
    def _clamp_float(value: Any) -> float:
        try:
            num = float(value)
        except (TypeError, ValueError):
            num = 0.5
        return max(0.0, min(1.0, num))

    @classmethod
    def _build_persona_description(cls, introversion, cleanliness, early_riser, smoker,
                                   noise_sensitivity, thermal_sensitivity) -> str:
        sentences: List[str] = []
        if introversion > 0.7:
            sentences.append("prefers quiet evenings at home over social gatherings")
        elif introversion <= 0.3:
            sentences.append("enjoys having people around and a lively home atmosphere")
        if cleanliness > 0.7:
            sentences.append("keeps living spaces spotlessly clean and expects the same")
        elif cleanliness <= 0.3:
            sentences.append("has a relaxed approach to tidiness")
        if early_riser:
            sentences.append("wakes up early and values a quiet morning routine")
        if smoker:
            sentences.append("smokes regularly and needs access to smoking areas")
        if noise_sensitivity > 0.7:
            sentences.append("is highly sensitive to noise and needs a quiet environment")
        if thermal_sensitivity > 0.7:
            sentences.append("is very sensitive to temperature and needs proper heating/cooling")
        if not sentences:
            sentences.append("maintains balanced habits and adapts to shared apartment routines")
        return ". ".join(sentences[:4]) + "."

    @classmethod
    def _build_behavioral_adjectives(cls, big_five: Dict[str, float]) -> List[str]:
        adjectives: List[str] = []
        if big_five["conscientiousness"] >= 0.6:
            adjectives.extend(["organized", "punctual"])
        else:
            adjectives.extend(["spontaneous", "flexible"])
        if big_five["neuroticism"] >= 0.6:
            adjectives.extend(["sensitive", "particular"])
        else:
            adjectives.append("steady")
        if big_five["extraversion"] >= 0.6:
            adjectives.extend(["sociable", "open"])
        elif big_five["extraversion"] <= 0.4:
            adjectives.extend(["private", "reserved"])
        else:
            adjectives.append("balanced")
        if big_five["agreeableness"] <= 0.4:
            adjectives.extend(["independent", "assertive"])
        else:
            adjectives.append("cooperative")
        deduped: List[str] = []
        for adj in adjectives:
            if adj not in deduped:
                deduped.append(adj)
        while len(deduped) < 5:
            deduped.append("adaptable")
        return deduped[:5]

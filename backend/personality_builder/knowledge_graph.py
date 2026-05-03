"""Local in-memory personality knowledge graph with traceability and gap detection.
Ported from Domus AI — import path adapted for HestIA backend.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any, Dict, List, Optional

import networkx as nx


class PersonalityKnowledgeGraph:
    """In-memory directed graph for personality evidence and trait aggregation."""

    BIG_FIVE_TRAITS = [
        "openness",
        "conscientiousness",
        "extraversion",
        "agreeableness",
        "neuroticism",
    ]

    HOUSING_TRAITS = [
        "noise_sensitivity",
        "thermal_sensitivity",
        "cleanliness",
        "schedule_preference",
    ]

    def __init__(self, subject_id: str) -> None:
        self.subject_id = subject_id
        self.graph = nx.DiGraph()
        self.person_node_id = f"person:{subject_id}"
        self.graph.add_node(self.person_node_id, type="person", label=subject_id)

        for trait_name in self.BIG_FIVE_TRAITS + self.HOUSING_TRAITS:
            self._ensure_trait_node(trait_name)

    def add_evidence(
        self,
        trait_name: str,
        evidence_text: str,
        implied_value: float,
        confidence: float,
        context: Optional[str] = None,
    ) -> str:
        trait_node_id = self._ensure_trait_node(trait_name)
        evidence_node_id = f"evidence:{uuid.uuid4()}"

        implied_value = max(0.0, min(1.0, float(implied_value)))
        confidence = max(0.0, min(1.0, float(confidence)))

        self.graph.add_node(
            evidence_node_id,
            type="evidence",
            label=evidence_text,
            text=evidence_text,
            implied_value=implied_value,
            confidence=confidence,
            has_contradiction=False,
        )

        self.graph.add_edge(trait_node_id, evidence_node_id, relation="SUPPORTED_BY")
        self.graph.add_edge(self.person_node_id, evidence_node_id, relation="MENTIONED")

        if context:
            context_node_id = self._context_node_id(context)
            if context_node_id not in self.graph:
                self.graph.add_node(context_node_id, type="context", label=context, text=context)
            self.graph.add_edge(evidence_node_id, context_node_id, relation="DERIVED_FROM")

        trait_data = self.graph.nodes[trait_node_id]
        existing_value = trait_data.get("value")
        existing_confidence = float(trait_data.get("confidence", 0.0))
        evidence_count = int(trait_data.get("evidence_count", 0))

        if existing_value is None:
            new_value = implied_value
        else:
            denom = existing_confidence + confidence
            new_value = (
                float(existing_value) * existing_confidence + implied_value * confidence
            ) / denom if denom > 0.0 else float(existing_value)

        trait_data["value"] = max(0.0, min(1.0, float(new_value)))
        updated_count = evidence_count + 1
        blended_confidence = (
            confidence * 0.75
            if evidence_count <= 0
            else ((existing_confidence * evidence_count) + confidence) / updated_count
        )
        coverage_bonus = min(0.18, 0.04 * (updated_count - 1))
        trait_data["confidence"] = min(0.95, blended_confidence * 0.85 + coverage_bonus)
        trait_data["evidence_count"] = updated_count
        return evidence_node_id

    def get_trait_value(self, trait_name: str) -> Dict[str, Any]:
        trait_node_id = self._trait_node_id(trait_name)
        if trait_node_id not in self.graph:
            raise ValueError(f"Trait node not found: {trait_name}")

        trait_data = self.graph.nodes[trait_node_id]
        evidence_texts: List[str] = [
            str(self.graph.nodes[eid].get("text", self.graph.nodes[eid].get("label", "")))
            for eid in self.graph.successors(trait_node_id)
            if self.graph.get_edge_data(trait_node_id, eid, {}).get("relation") == "SUPPORTED_BY"
        ]
        return {
            "trait": trait_name,
            "value": trait_data.get("value"),
            "confidence": float(trait_data.get("confidence", 0.0)),
            "evidence_count": int(trait_data.get("evidence_count", 0)),
            "evidence": evidence_texts,
        }

    def get_missing_traits(self) -> List[str]:
        missing: List[str] = []
        for trait_name in self.BIG_FIVE_TRAITS + self.HOUSING_TRAITS:
            trait_data = self.get_trait_value(trait_name)
            if trait_data.get("value") is None or float(trait_data.get("confidence", 0.0)) < 0.4:
                missing.append(trait_name)
        return missing

    def get_explanation(self, trait_name: str) -> str:
        trait_info = self.get_trait_value(trait_name)
        evidence = trait_info.get("evidence", [])
        value = trait_info.get("value")
        if not evidence:
            return f"No information collected yet for {trait_name}."
        evidence_text = ", ".join(f'"{item}"' for item in evidence)
        return (
            f"Your {trait_name} was set to {float(value):.2f} because you mentioned: {evidence_text}."
        )

    def get_summary(self) -> Dict[str, int]:
        total_evidence = sum(
            1 for _, d in self.graph.nodes(data=True) if d.get("type") == "evidence"
        )
        trait_nodes_with_value = sum(
            1 for _, d in self.graph.nodes(data=True)
            if d.get("type") == "trait" and d.get("value") is not None
        )
        return {
            "total_nodes": self.graph.number_of_nodes(),
            "trait_nodes_with_value": trait_nodes_with_value,
            "total_evidence": total_evidence,
        }

    def to_trait_vector(self) -> Dict[str, Any]:
        defaults = 0.5
        extraversion = self._trait_numeric_value("extraversion", default=defaults)
        noise_sensitivity = self._trait_numeric_value("noise_sensitivity", default=defaults)
        cleanliness = self._trait_numeric_value("cleanliness", default=defaults)
        thermal_sensitivity = self._trait_numeric_value("thermal_sensitivity", default=defaults)
        schedule_preference = self._trait_numeric_value("schedule_preference", default=defaults)
        smoker_value = self._trait_numeric_value("smoker", default=0.0)

        return {
            "introversion": max(0.0, min(1.0, 1.0 - extraversion)),
            "openness": self._trait_numeric_value("openness", default=defaults),
            "conscientiousness": self._trait_numeric_value("conscientiousness", default=defaults),
            "agreeableness": self._trait_numeric_value("agreeableness", default=defaults),
            "neuroticism": self._trait_numeric_value("neuroticism", default=defaults),
            "extraversion": extraversion,
            "noise_sensitivity": noise_sensitivity,
            "cleanliness": cleanliness,
            "thermal_sensitivity": thermal_sensitivity,
            "early_riser": bool(schedule_preference > 0.6),
            "smoker": bool(smoker_value >= 0.5),
        }

    def to_dict(self) -> Dict[str, Any]:
        return nx.node_link_data(self.graph)

    @classmethod
    def from_dict(cls, data: Dict[str, Any], subject_id: str) -> "PersonalityKnowledgeGraph":
        obj = cls(subject_id=subject_id)
        obj.graph = nx.node_link_graph(data)
        obj.subject_id = subject_id
        obj.person_node_id = f"person:{subject_id}"
        if obj.person_node_id not in obj.graph:
            obj.graph.add_node(obj.person_node_id, type="person", label=subject_id)
        return obj

    # ── Private ───────────────────────────────────────────────────────────────

    def _trait_node_id(self, trait_name: str) -> str:
        return f"trait:{trait_name.strip().lower()}"

    def _ensure_trait_node(self, trait_name: str) -> str:
        trait_name = trait_name.strip().lower()
        trait_node_id = self._trait_node_id(trait_name)
        if trait_node_id not in self.graph:
            self.graph.add_node(
                trait_node_id, type="trait", label=trait_name,
                trait=trait_name, value=None, confidence=0.0, evidence_count=0,
            )
            self.graph.add_edge(self.person_node_id, trait_node_id, relation="HAS_TRAIT")
        elif not self.graph.has_edge(self.person_node_id, trait_node_id):
            self.graph.add_edge(self.person_node_id, trait_node_id, relation="HAS_TRAIT")
        return trait_node_id

    @staticmethod
    def _context_node_id(context: str) -> str:
        digest = hashlib.sha1(context.strip().lower().encode("utf-8")).hexdigest()[:12]
        return f"context:{digest}"

    def _trait_numeric_value(self, trait_name: str, default: float = 0.5) -> float:
        trait_id = self._trait_node_id(trait_name)
        if trait_id not in self.graph:
            return default
        value = self.graph.nodes[trait_id].get("value")
        if value is None:
            return default
        try:
            return max(0.0, min(1.0, float(value)))
        except (TypeError, ValueError):
            return default

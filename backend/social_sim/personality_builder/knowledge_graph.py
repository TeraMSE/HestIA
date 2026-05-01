"""Local in-memory personality knowledge graph with traceability and gap detection."""

from __future__ import annotations

import hashlib
import uuid
from typing import Any, Dict, List, Optional

import matplotlib.pyplot as plt
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
        self.graph.add_node(
            self.person_node_id,
            type="person",
            label=subject_id,
        )

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
                self.graph.add_node(
                    context_node_id,
                    type="context",
                    label=context,
                    text=context,
                )
            self.graph.add_edge(evidence_node_id, context_node_id, relation="DERIVED_FROM")

        trait_data = self.graph.nodes[trait_node_id]
        existing_value = trait_data.get("value")
        existing_confidence = float(trait_data.get("confidence", 0.0))
        evidence_count = int(trait_data.get("evidence_count", 0))

        if existing_value is None:
            new_value = implied_value
        else:
            denom = existing_confidence + confidence
            if denom <= 0.0:
                new_value = float(existing_value)
            else:
                new_value = (
                    float(existing_value) * existing_confidence
                    + implied_value * confidence
                ) / denom

        trait_data["value"] = max(0.0, min(1.0, float(new_value)))
        updated_count = evidence_count + 1
        if evidence_count <= 0:
            blended_confidence = confidence * 0.75
        else:
            blended_confidence = (
                (existing_confidence * evidence_count) + confidence
            ) / updated_count
        coverage_bonus = min(0.18, 0.04 * (updated_count - 1))
        trait_data["confidence"] = min(0.95, blended_confidence * 0.85 + coverage_bonus)
        trait_data["evidence_count"] = updated_count

        return evidence_node_id

    def add_contradiction(
        self,
        evidence_id_a: str,
        evidence_id_b: str,
        reason: str,
    ) -> None:
        self._ensure_evidence_node(evidence_id_a)
        self._ensure_evidence_node(evidence_id_b)

        self.graph.add_edge(
            evidence_id_a,
            evidence_id_b,
            relation="CONTRADICTS",
            reason=reason,
        )
        self.graph.nodes[evidence_id_a]["has_contradiction"] = True
        self.graph.nodes[evidence_id_b]["has_contradiction"] = True

    def get_trait_value(self, trait_name: str) -> Dict[str, Any]:
        trait_node_id = self._trait_node_id(trait_name)
        if trait_node_id not in self.graph:
            raise ValueError(f"Trait node not found: {trait_name}")

        trait_data = self.graph.nodes[trait_node_id]
        evidence_texts: List[str] = []
        for evidence_id in self.graph.successors(trait_node_id):
            edge_data = self.graph.get_edge_data(trait_node_id, evidence_id, default={})
            if edge_data.get("relation") != "SUPPORTED_BY":
                continue
            evidence_data = self.graph.nodes[evidence_id]
            evidence_texts.append(str(evidence_data.get("text", evidence_data.get("label", ""))))

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
            value = trait_data.get("value")
            confidence = float(trait_data.get("confidence", 0.0))
            if value is None or confidence < 0.4:
                missing.append(trait_name)
        return missing

    def get_contradictions(self) -> List[Dict[str, str]]:
        contradictions: List[Dict[str, str]] = []
        for source_id, target_id, edge_data in self.graph.edges(data=True):
            if edge_data.get("relation") != "CONTRADICTS":
                continue

            source_node = self.graph.nodes[source_id]
            target_node = self.graph.nodes[target_id]
            source_traits = self._traits_for_evidence(source_id)
            target_traits = self._traits_for_evidence(target_id)
            trait_name = source_traits[0] if source_traits else (target_traits[0] if target_traits else "unknown")

            contradictions.append(
                {
                    "trait": trait_name,
                    "evidence_a": str(source_node.get("text", source_node.get("label", ""))),
                    "evidence_b": str(target_node.get("text", target_node.get("label", ""))),
                    "reason": str(edge_data.get("reason", "No reason provided.")),
                }
            )
        return contradictions

    def get_summary(self) -> Dict[str, int]:
        total_nodes = self.graph.number_of_nodes()
        total_evidence = 0
        trait_nodes_with_value = 0

        for _node_id, node_data in self.graph.nodes(data=True):
            node_type = node_data.get("type")
            if node_type == "evidence":
                total_evidence += 1
            if node_type == "trait" and node_data.get("value") is not None:
                trait_nodes_with_value += 1

        contradictions = len(self.get_contradictions())

        return {
            "total_nodes": total_nodes,
            "trait_nodes_with_value": trait_nodes_with_value,
            "total_evidence": total_evidence,
            "contradictions": contradictions,
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
            "noise_sensitivity": noise_sensitivity,
            "cleanliness": cleanliness,
            "thermal_sensitivity": thermal_sensitivity,
            "early_riser": bool(schedule_preference > 0.6),
            "smoker": bool(smoker_value >= 0.5),
        }

    def to_dict(self) -> Dict[str, Any]:
        return nx.node_link_data(self.graph)

    @classmethod
    def from_dict(
        cls,
        data: Dict[str, Any],
        subject_id: str,
    ) -> "PersonalityKnowledgeGraph":
        obj = cls(subject_id=subject_id)
        obj.graph = nx.node_link_graph(data)
        obj.subject_id = subject_id
        obj.person_node_id = f"person:{subject_id}"

        if obj.person_node_id not in obj.graph:
            obj.graph.add_node(obj.person_node_id, type="person", label=subject_id)
        return obj

    def get_explanation(self, trait_name: str) -> str:
        trait_info = self.get_trait_value(trait_name)
        evidence = trait_info.get("evidence", [])
        value = trait_info.get("value")

        if not evidence:
            return f"No information collected yet for {trait_name}."

        evidence_text = ", ".join(f'"{item}"' for item in evidence)
        return (
            f"Your {trait_name} was set to {float(value):.2f} because you mentioned: "
            f"{evidence_text}."
        )

    def visualize(self, output_path: Optional[str] = None) -> None:
        node_colors: List[str] = []
        labels: Dict[str, str] = {}

        for node_id, node_data in self.graph.nodes(data=True):
            node_type = node_data.get("type")
            if node_type == "person":
                node_colors.append("#4A90E2")
            elif node_type == "trait":
                node_colors.append("#8BC34A" if node_data.get("value") is not None else "#F4D35E")
            elif node_type == "evidence":
                node_colors.append("#B0BEC5")
            elif node_type == "context":
                node_colors.append("#CFD8DC")
            elif node_type == "preference":
                node_colors.append("#90A4AE")
            else:
                node_colors.append("#E0E0E0")

            labels[node_id] = str(node_data.get("label", node_id.split(":", 1)[-1]))

        edge_colors: List[str] = []
        for _source, _target, edge_data in self.graph.edges(data=True):
            edge_colors.append("#D32F2F" if edge_data.get("relation") == "CONTRADICTS" else "#757575")

        plt.figure(figsize=(14, 10))
        pos = nx.spring_layout(self.graph, seed=42, k=0.9)
        nx.draw_networkx_nodes(
            self.graph,
            pos,
            node_color=node_colors,
            node_size=1200,
            alpha=0.9,
        )
        nx.draw_networkx_labels(self.graph, pos, labels=labels, font_size=8)
        nx.draw_networkx_edges(
            self.graph,
            pos,
            edge_color=edge_colors,
            arrows=True,
            arrowstyle="-|>",
            arrowsize=14,
            width=1.5,
            alpha=0.85,
        )

        edge_labels = {
            (source, target): str(data.get("relation", ""))
            for source, target, data in self.graph.edges(data=True)
        }
        nx.draw_networkx_edge_labels(self.graph, pos, edge_labels=edge_labels, font_size=7)

        plt.title(f"Personality Knowledge Graph: {self.subject_id}")
        plt.axis("off")
        plt.tight_layout()

        if output_path:
            plt.savefig(output_path, dpi=180)
            plt.close()
        else:
            plt.show()

    def _trait_node_id(self, trait_name: str) -> str:
        return f"trait:{trait_name.strip().lower()}"

    def _ensure_trait_node(self, trait_name: str) -> str:
        trait_name = trait_name.strip().lower()
        trait_node_id = self._trait_node_id(trait_name)
        if trait_node_id not in self.graph:
            self.graph.add_node(
                trait_node_id,
                type="trait",
                label=trait_name,
                trait=trait_name,
                value=None,
                confidence=0.0,
                evidence_count=0,
            )
            self.graph.add_edge(self.person_node_id, trait_node_id, relation="HAS_TRAIT")
        elif not self.graph.has_edge(self.person_node_id, trait_node_id):
            self.graph.add_edge(self.person_node_id, trait_node_id, relation="HAS_TRAIT")
        return trait_node_id

    @staticmethod
    def _context_node_id(context: str) -> str:
        digest = hashlib.sha1(context.strip().lower().encode("utf-8")).hexdigest()[:12]
        return f"context:{digest}"

    def _ensure_evidence_node(self, evidence_id: str) -> None:
        if evidence_id not in self.graph:
            raise ValueError(f"Evidence node not found: {evidence_id}")
        if self.graph.nodes[evidence_id].get("type") != "evidence":
            raise ValueError(f"Node is not evidence: {evidence_id}")

    def _traits_for_evidence(self, evidence_id: str) -> List[str]:
        trait_names: List[str] = []
        for predecessor in self.graph.predecessors(evidence_id):
            edge_data = self.graph.get_edge_data(predecessor, evidence_id, default={})
            if edge_data.get("relation") != "SUPPORTED_BY":
                continue
            pred_node = self.graph.nodes[predecessor]
            if pred_node.get("type") == "trait":
                trait_names.append(str(pred_node.get("trait", pred_node.get("label", "unknown"))))
        return trait_names

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


if __name__ == "__main__":
    kg = PersonalityKnowledgeGraph(subject_id="demo_user_001")

    evidence_1 = kg.add_evidence(
        trait_name="extraversion",
        evidence_text="I love going out with friends every weekend.",
        implied_value=0.78,
        confidence=0.82,
        context="student in Tunis",
    )
    evidence_2 = kg.add_evidence(
        trait_name="cleanliness",
        evidence_text="I clean the kitchen every night before sleeping.",
        implied_value=0.86,
        confidence=0.75,
        context="lives with roommate",
    )
    evidence_3 = kg.add_evidence(
        trait_name="noise_sensitivity",
        evidence_text="Loud music while studying really annoys me.",
        implied_value=0.88,
        confidence=0.81,
        context="exam period",
    )

    kg.add_contradiction(
        evidence_id_a=evidence_1,
        evidence_id_b=evidence_3,
        reason="High social activity may conflict with noise sensitivity in shared spaces.",
    )

    print("Missing traits:", kg.get_missing_traits())
    print("\nTrait explanations:")
    for trait in PersonalityKnowledgeGraph.BIG_FIVE_TRAITS + PersonalityKnowledgeGraph.HOUSING_TRAITS:
        print(f"- {kg.get_explanation(trait)}")

    print("\nTrait vector:", kg.to_trait_vector())
    print("\nContradictions:", kg.get_contradictions())

    output_file = "personality_graph_demo.png"
    kg.visualize(output_path=output_file)
    print(f"\nGraph visualization saved to {output_file}")

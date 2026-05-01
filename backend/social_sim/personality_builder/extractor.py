"""Big Five and housing trait extraction using two-pass zero-shot LLM inference."""

from __future__ import annotations

import time
from typing import Any, Dict, List

from social_sim.engine.llm_client import UnifiedLLMClient
from .knowledge_graph import PersonalityKnowledgeGraph


class PersonalityExtractor:
    """Extracts trait evidence and holistic personality scores from conversation text."""

    SUPPORTED_TRAITS = {
        "openness",
        "conscientiousness",
        "extraversion",
        "agreeableness",
        "neuroticism",
        "noise_sensitivity",
        "thermal_sensitivity",
        "cleanliness",
        "schedule_preference",
        "smoker",
    }

    OCEAN_TRAITS = [
        "openness",
        "conscientiousness",
        "extraversion",
        "agreeableness",
        "neuroticism",
    ]

    def __init__(self, llm_client: UnifiedLLMClient) -> None:
        self.llm_client = llm_client

    def extract_evidence_quotes(
        self,
        transcript: List[Dict[str, str]],
        graph: PersonalityKnowledgeGraph,
    ) -> List[Dict[str, Any]]:
        user_text = self._user_text_block(transcript)
        if not user_text:
            return []

        system_prompt = (
            "You are a psychologist analyzing a conversation to extract personality "
            "evidence. Be precise and only extract what was explicitly stated or "
            "strongly implied."
        )

        user_message = (
            "Read this person's statements from a conversation:\n\n"
            "---\n"
            f"{user_text}\n"
            "---\n\n"
            "For each statement that reveals something about their personality or "
            "living preferences, extract:\n"
            "1. The exact quote or paraphrase\n"
            "2. Which personality trait it reveals:\n"
            "   (openness / conscientiousness / extraversion /\n"
            "    agreeableness / neuroticism / noise_sensitivity /\n"
            "    thermal_sensitivity / cleanliness / schedule_preference / smoker)\n"
            "3. The implied value (0.0 = very low, 1.0 = very high)\n"
            "4. Your confidence (0.0-1.0)\n"
            "5. The context (what situation they described)\n\n"
            "Extract ALL relevant evidence, even indirect."
        )

        result = self.llm_client.complete_structured(
            system_prompt=system_prompt,
            user_message=user_message,
            output_schema={
                "evidence_items": [
                    {
                        "quote": "string",
                        "trait": "string",
                        "implied_value": 0.0,
                        "confidence": 0.0,
                        "context": "string",
                    }
                ]
            },
            use_fast_model=True,
        )

        evidence_items: List[Dict[str, Any]] = []
        smoker_signal = self._smoker_explicit_signal(user_text)
        for raw_item in result.get("evidence_items", []) or []:
            trait = str(raw_item.get("trait", "")).strip().lower()
            if trait not in self.SUPPORTED_TRAITS:
                continue

            quote = str(raw_item.get("quote", "")).strip()
            context = str(raw_item.get("context", "")).strip() or None

            implied_value = self._as_float(raw_item.get("implied_value"), default=0.5)
            confidence = self._as_float(raw_item.get("confidence"), default=0.5)

            implied_value = max(0.0, min(1.0, implied_value))
            confidence = max(0.0, min(1.0, confidence))

            if trait == "smoker":
                if smoker_signal is None:
                    continue
                implied_value = 1.0 if smoker_signal else 0.0
                confidence = max(confidence, 0.85)

            graph.add_evidence(
                trait_name=trait,
                evidence_text=quote or "Personality-related statement extracted from transcript.",
                implied_value=implied_value,
                confidence=confidence,
                context=context,
            )

            evidence_items.append(
                {
                    "quote": quote,
                    "trait": trait,
                    "implied_value": implied_value,
                    "confidence": confidence,
                    "context": context,
                }
            )

        time.sleep(1)
        return evidence_items

    def extract_holistic_bigfive(
        self,
        transcript: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        user_text = self._user_text_block(transcript)
        if not user_text:
            return self._empty_holistic_result()

        system_prompt = (
            "You are an expert psychologist trained in the Big Five (OCEAN) "
            "personality model. You assess personality from written text using "
            "established psychometric principles."
        )

        user_message = (
            "Analyze this person's self-description and infer their Big Five "
            "personality traits.\n\n"
            "Text:\n"
            "---\n"
            f"{user_text}\n"
            "---\n\n"
            "For each of the 5 Big Five dimensions, provide:\n"
            "- A score from 0.0 (very low) to 1.0 (very high)\n"
            "- A one-sentence justification\n"
            "- Your confidence (0.0-1.0)\n\n"
            "Also infer these housing-specific traits:\n"
            "- noise_sensitivity (0.0-1.0)\n"
            "- thermal_sensitivity (0.0-1.0)\n"
            "- cleanliness (0.0-1.0)\n"
            "- schedule_preference (0.0=night owl, 1.0=early riser)\n"
            "- smoker (true/false, only if explicitly mentioned)\n\n"
            "Base your assessment ONLY on what was explicitly stated or strongly "
            "implied. Do not guess."
        )

        result = self.llm_client.complete_structured(
            system_prompt=system_prompt,
            user_message=user_message,
            output_schema={
                "openness": {"score": 0.5, "justification": "", "confidence": 0.5},
                "conscientiousness": {"score": 0.5, "justification": "", "confidence": 0.5},
                "extraversion": {"score": 0.5, "justification": "", "confidence": 0.5},
                "agreeableness": {"score": 0.5, "justification": "", "confidence": 0.5},
                "neuroticism": {"score": 0.5, "justification": "", "confidence": 0.5},
                "noise_sensitivity": {"score": 0.5, "justification": "", "confidence": 0.5},
                "thermal_sensitivity": {"score": 0.5, "justification": "", "confidence": 0.5},
                "cleanliness": {"score": 0.5, "justification": "", "confidence": 0.5},
                "schedule_preference": {"score": 0.5, "justification": "", "confidence": 0.5},
                "smoker": {"value": False, "justification": "", "confidence": 0.5},
            },
            use_fast_model=False,
        )

        normalized = self._normalize_holistic(result)
        time.sleep(1)
        return normalized

    def extract_full(
        self,
        transcript: List[Dict[str, str]],
        graph: PersonalityKnowledgeGraph,
    ) -> Dict[str, Any]:
        evidence = self.extract_evidence_quotes(transcript=transcript, graph=graph)
        holistic = self.extract_holistic_bigfive(transcript=transcript)

        for dimension, payload in holistic.items():
            if dimension not in self.SUPPORTED_TRAITS:
                continue

            if dimension == "smoker":
                implied_value = 1.0 if bool(payload.get("value", False)) else 0.0
            else:
                implied_value = self._as_float(payload.get("score"), default=0.5)

            confidence = self._as_float(payload.get("confidence"), default=0.5)
            justification = str(payload.get("justification", "")).strip() or (
                f"Holistic inference for {dimension}."
            )

            graph.add_evidence(
                trait_name=dimension,
                evidence_text=justification,
                implied_value=max(0.0, min(1.0, implied_value)),
                confidence=max(0.0, min(1.0, confidence * 0.8)),
                context="holistic_bigfive_inference",
            )

        trait_vector = graph.to_trait_vector()

        confidence_per_trait: Dict[str, float] = {}
        for trait_name in sorted(self.SUPPORTED_TRAITS):
            try:
                confidence_per_trait[trait_name] = float(
                    graph.get_trait_value(trait_name).get("confidence", 0.0)
                )
            except ValueError:
                confidence_per_trait[trait_name] = 0.0

        total_evidence = len(
            [
                node_id
                for node_id, data in graph.graph.nodes(data=True)
                if data.get("type") == "evidence"
            ]
        )

        return {
            "trait_vector": trait_vector,
            "bigfive_raw": {trait: holistic.get(trait, {}) for trait in self.OCEAN_TRAITS},
            "evidence_count": total_evidence,
            "missing_traits": graph.get_missing_traits(),
            "confidence_per_trait": confidence_per_trait,
            "graph_summary": graph.get_summary() if hasattr(graph, "get_summary") else {},
            "evidence_items": evidence,
            "holistic": holistic,
        }

    @staticmethod
    def _user_text_block(transcript: List[Dict[str, str]]) -> str:
        user_messages = [
            str(item.get("content", "")).strip()
            for item in transcript
            if str(item.get("role", "")).strip().lower() == "user"
            and str(item.get("content", "")).strip()
        ]
        return "\n".join(user_messages).strip()

    @staticmethod
    def _as_float(value: Any, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return float(default)

    def _empty_holistic_result(self) -> Dict[str, Any]:
        empty = {
            trait: {"score": 0.5, "justification": "No user evidence available.", "confidence": 0.0}
            for trait in self.OCEAN_TRAITS
        }
        empty.update(
            {
                "noise_sensitivity": {"score": 0.5, "justification": "No user evidence available.", "confidence": 0.0},
                "thermal_sensitivity": {"score": 0.5, "justification": "No user evidence available.", "confidence": 0.0},
                "cleanliness": {"score": 0.5, "justification": "No user evidence available.", "confidence": 0.0},
                "schedule_preference": {"score": 0.5, "justification": "No user evidence available.", "confidence": 0.0},
                "smoker": {"value": False, "justification": "No explicit smoker mention.", "confidence": 0.0},
            }
        )
        return empty

    def _normalize_holistic(self, raw: Dict[str, Any]) -> Dict[str, Any]:
        normalized = self._empty_holistic_result()

        for trait in self.OCEAN_TRAITS + [
            "noise_sensitivity",
            "thermal_sensitivity",
            "cleanliness",
            "schedule_preference",
        ]:
            payload = raw.get(trait, {}) if isinstance(raw, dict) else {}
            score = max(0.0, min(1.0, self._as_float(payload.get("score"), 0.5)))
            confidence = max(0.0, min(1.0, self._as_float(payload.get("confidence"), 0.5)))
            justification = str(payload.get("justification", "")).strip()
            normalized[trait] = {
                "score": score,
                "justification": justification or f"Inferred {trait} from transcript.",
                "confidence": confidence,
            }

        smoker_payload = raw.get("smoker", {}) if isinstance(raw, dict) else {}
        smoker_conf = max(0.0, min(1.0, self._as_float(smoker_payload.get("confidence"), 0.5)))
        normalized["smoker"] = {
            "value": bool(smoker_payload.get("value", False)),
            "justification": str(smoker_payload.get("justification", "")).strip()
            or "Smoker status inferred only from explicit mention.",
            "confidence": smoker_conf,
        }
        return normalized

    @staticmethod
    def _smoker_explicit_signal(text: str) -> bool | None:
        lowered = (text or "").lower()
        if "smok" not in lowered:
            return None
        negative = ["don't smoke", "do not smoke", "not a smoker", "non-smoker", "never smoke"]
        positive = ["i smoke", "smoke occasionally", "i do smoke", "i am a smoker"]
        if any(token in lowered for token in negative):
            return False
        if any(token in lowered for token in positive):
            return True
        return None


if __name__ == "__main__":
    sample_transcript = [
        {"role": "assistant", "content": "Tell me about your daily routine."},
        {
            "role": "user",
            "content": "I usually wake up at 6am and like to start my day quietly with tea.",
        },
        {
            "role": "user",
            "content": "Loud sounds really bother me, especially while studying in the evening.",
        },
        {
            "role": "assistant", "content": "How do you handle shared spaces?"},
        {
            "role": "user",
            "content": "I'm very organized and I clean the kitchen every night after dinner.",
        },
        {
            "role": "user",
            "content": "I enjoy hanging out with friends on weekends but prefer calm weekdays.",
        },
        {
            "role": "user",
            "content": "I don't smoke and I prefer keeping the room slightly cool.",
        },
        {
            "role": "user",
            "content": "I like trying new ideas, books, and places whenever I can.",
        },
    ]

    llm = UnifiedLLMClient()
    extractor = PersonalityExtractor(llm_client=llm)
    graph = PersonalityKnowledgeGraph(subject_id="demo_extract_001")

    result = extractor.extract_full(transcript=sample_transcript, graph=graph)

    print("Trait vector:")
    print(result["trait_vector"])
    print("\nConfidence per trait:")
    print(result["confidence_per_trait"])

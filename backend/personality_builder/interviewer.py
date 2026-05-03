"""Guided conversation agent for personality-building interviews.
Ported from Domus AI — import path adapted for HestIA backend.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from .llm_client import UnifiedLLMClient
from .extractor import PersonalityExtractor
from .knowledge_graph import PersonalityKnowledgeGraph


@dataclass
class InterviewSession:
    subject_id: str
    transcript: List[Dict[str, str]]
    graph: PersonalityKnowledgeGraph
    exchange_count: int
    is_complete: bool
    extraction_result: Optional[Dict[str, Any]]


class InterviewerAgent:
    """Natural, gap-driven interviewer for personality and housing preferences."""

    MIN_EXCHANGES = 6
    TARGET_EXCHANGES = 14
    MAX_EXCHANGES = 20

    OPENING_QUESTIONS = [
        (
            "Let's start simple — describe your ideal living situation in a few "
            "sentences. What matters most to you at home?"
        ),
        (
            "Tell me a bit about how you live day to day. What does a typical "
            "weekday look like for you at home?"
        ),
        (
            "Imagine you're moving into a new apartment in Tunis. What are the "
            "first three things you'd notice or care about?"
        ),
    ]

    TARGETED_QUESTIONS: Dict[str, List[str]] = {
        "noise_sensitivity": [
            "How do you feel about noise — street sounds, neighbors, music? Does it affect you much?",
            "Can you work or sleep with background noise, or do you need it quiet?",
        ],
        "cleanliness": [
            "How do you feel about household cleanliness? Are you the type to clean as you go, or more relaxed about it?",
            "If a roommate left dishes in the sink overnight, how would that sit with you?",
        ],
        "thermal_sensitivity": [
            "Do you tend to feel cold easily, or are you usually comfortable temperature-wise?",
            "How important is heating or cooling to you in a home?",
        ],
        "schedule_preference": [
            "Are you more of a morning person or do you come alive later in the day?",
            "What time do you usually wake up and wind down at night?",
        ],
        "extraversion": [
            "Do you enjoy having people over, or do you prefer a quieter, more private space?",
            "How do you feel about a lively home versus a calm, private one?",
        ],
        "conscientiousness": [
            "Are you someone who keeps a schedule and sticks to routines, or more flexible?",
            "How do you handle shared responsibilities like cleaning or bills with roommates?",
        ],
        "openness": [
            "Are you usually open to trying new habits or living arrangements, or do you strongly prefer familiar routines?",
            "How comfortable are you with change in your home environment?",
        ],
        "agreeableness": [
            "When living with others, do you usually compromise easily, or do you prefer things done your own way?",
            "How do you usually handle disagreements with roommates?",
        ],
        "neuroticism": [
            "When home life gets stressful, do you stay calm or feel tension quickly?",
            "How much does everyday stress at home affect your mood?",
        ],
        "smoker": [
            "One practical question — do you smoke? And if so, where do you usually smoke when at home?",
            "Just to confirm clearly: do you currently smoke at all (yes or no)?",
        ],
    }

    ALL_TRAITS = [
        "openness", "conscientiousness", "extraversion", "agreeableness", "neuroticism",
        "noise_sensitivity", "thermal_sensitivity", "cleanliness", "schedule_preference", "smoker",
    ]

    def __init__(self, llm_client: UnifiedLLMClient) -> None:
        self.llm_client = llm_client
        self.extractor = PersonalityExtractor(llm_client)

    def start_session(self, subject_id: str, name: str = None) -> InterviewSession:
        _ = name
        graph = PersonalityKnowledgeGraph(subject_id=subject_id)
        opening = random.choice(self.OPENING_QUESTIONS)
        return InterviewSession(
            subject_id=subject_id,
            transcript=[{"role": "assistant", "content": opening}],
            graph=graph,
            exchange_count=0,
            is_complete=False,
            extraction_result=None,
        )

    def get_missing_traits(self, session: InterviewSession) -> List[str]:
        missing = list(session.graph.get_missing_traits())
        smoker_conf = self._trait_confidence(session.graph, "smoker")
        if smoker_conf < 0.4 and "smoker" not in missing:
            missing.append("smoker")
        return missing

    def process_user_response(self, session: InterviewSession, user_message: str) -> Dict[str, Any]:
        session.transcript.append({"role": "user", "content": user_message})
        self._capture_direct_smoker_evidence(session, user_message)
        self._capture_direct_openness_evidence(session, user_message)
        self.extractor.extract_evidence_quotes(
            transcript=[{"role": "user", "content": user_message}],
            graph=session.graph,
        )
        session.exchange_count += 1

        current_missing = self.get_missing_traits(session)
        complete = (
            session.exchange_count >= self.MAX_EXCHANGES
            or (session.exchange_count >= self.MIN_EXCHANGES and len(current_missing) == 0)
        )

        if complete:
            session.is_complete = True
            next_message = (
                "Perfect — I have everything I need. Let me build your personality profile now."
                if len(current_missing) == 0
                else "Thanks — I have enough context to build your profile now. Some traits may stay lower-confidence, and you can fine-tune them right after this."
            )
        else:
            next_message = self._choose_next_question(session)

        session.transcript.append({"role": "assistant", "content": next_message})
        return {
            "assistant_message": next_message,
            "is_complete": session.is_complete,
            "exchange_count": session.exchange_count,
            "missing_traits": current_missing,
            "current_confidences": {
                trait: self._trait_confidence(session.graph, trait) for trait in self.ALL_TRAITS
            },
        }

    def finalize_session(self, session: InterviewSession, extractor: PersonalityExtractor) -> Dict[str, Any]:
        result = extractor.extract_full(session.transcript, session.graph)
        session.extraction_result = result
        return {
            "subject_id": session.subject_id,
            "trait_vector": result["trait_vector"],
            "bigfive_raw": result["bigfive_raw"],
            "confidence_per_trait": result["confidence_per_trait"],
            "missing_traits": result["missing_traits"],
            "transcript": session.transcript,
            "explanation": {
                trait: session.graph.get_explanation(trait) for trait in self.ALL_TRAITS
            },
        }

    # ── Private helpers ───────────────────────────────────────────────────────

    def _choose_next_question(self, session: InterviewSession) -> str:
        missing_traits = self.get_missing_traits(session)

        if session.exchange_count >= self.MAX_EXCHANGES:
            return "Thanks — this is enough context. I may keep a couple of traits at lower confidence, and you can fine-tune them after this."

        if session.exchange_count >= self.TARGET_EXCHANGES and missing_traits:
            target = self._priority_missing_trait(missing_traits)
            if target:
                q = self._unused_targeted_question(session, target)
                return f"I still need one quick confirmation: {q or self._llm_targeted_question(session, target)}"

        if session.exchange_count >= self.MIN_EXCHANGES and len(missing_traits) <= 1:
            target = self._priority_missing_trait(missing_traits)
            if target:
                q = self._unused_targeted_question(session, target)
                return f"Almost done — one last thing: {q or self._llm_targeted_question(session, target)}"

        if not missing_traits:
            return self._llm_deepening_question(session)

        target_trait = self._priority_missing_trait(missing_traits)
        targeted_question = self._unused_targeted_question(session, target_trait)
        if targeted_question:
            return targeted_question
        return self._llm_targeted_question(session, target_trait)

    def _priority_missing_trait(self, missing_traits: List[str]) -> str:
        priority = [
            "noise_sensitivity", "cleanliness", "thermal_sensitivity", "schedule_preference",
            "extraversion", "conscientiousness", "smoker", "openness", "agreeableness", "neuroticism",
        ]
        for trait in priority:
            if trait in missing_traits:
                return trait
        return missing_traits[0] if missing_traits else "conscientiousness"

    def _unused_targeted_question(self, session: InterviewSession, trait: str) -> Optional[str]:
        candidates = self.TARGETED_QUESTIONS.get(trait, [])
        asked = [
            self._normalize_question_text(e.get("content", ""))
            for e in session.transcript if e.get("role") == "assistant"
        ]
        for question in candidates:
            q_norm = self._normalize_question_text(question)
            if not any(q_norm and q_norm in a for a in asked):
                return question
        return None

    def _llm_deepening_question(self, session: InterviewSession) -> str:
        last_three = session.transcript[-6:]
        question = self.llm_client.complete(
            system_prompt="You are conducting a friendly interview about living preferences.",
            user_message=(
                f"The person has described themselves well.\nConversation so far: {last_three}\n"
                "What is ONE follow-up question that would reveal something new and useful about "
                "how they'd behave as a roommate? Ask it naturally and conversationally.\n"
                "Reply with ONLY the question, nothing else."
            ),
            use_fast_model=True, temperature=0.6,
        ).strip()
        return question or "Could you share one recent situation that tested your patience at home?"

    def _llm_targeted_question(self, session: InterviewSession, trait: str) -> str:
        question = self.llm_client.complete(
            system_prompt="You are conducting a friendly interview about living preferences in Tunisian shared-apartment contexts.",
            user_message=(
                f"Generate ONE natural, conversational question to better infer this trait: {trait}.\n"
                "Keep it practical, avoid clinical language, and make it relevant to roommate life. "
                f"Reply with ONLY the question.\nConversation context: {session.transcript[-4:]}"
            ),
            use_fast_model=True, temperature=0.6,
        ).strip()
        if not question:
            return "Could you describe how you and a roommate would split daily home responsibilities?"
        if self._has_asked_similar_question(session, question):
            return f"Could you share one concrete real-life example that reveals your {trait.replace('_', ' ')} in a roommate situation?"
        return question

    def _capture_direct_smoker_evidence(self, session: InterviewSession, user_message: str) -> None:
        text = (user_message or "").strip().lower()
        if "smok" not in text:
            return
        if any(t in text for t in ["don't smoke", "do not smoke", "non-smoker", "never smoke", "not a smoker"]):
            session.graph.add_evidence("smoker", user_message, 0.0, 0.9, "direct_smoker_statement")
        elif any(t in text for t in ["i smoke", "smoke occasionally", "smoker", "i do smoke"]):
            session.graph.add_evidence("smoker", user_message, 1.0, 0.9, "direct_smoker_statement")

    def _capture_direct_openness_evidence(self, session: InterviewSession, user_message: str) -> None:
        text = (user_message or "").strip().lower()
        low = ["prefer familiar routines", "prefer familiar routine", "do not like change", "don't like change", "not comfortable with change"]
        high = ["open to change", "comfortable with change", "i like trying new", "i enjoy trying new", "i adapt quickly"]
        if any(p in text for p in low):
            session.graph.add_evidence("openness", user_message, 0.2, 0.85, "direct_openness_statement")
        elif any(p in text for p in high):
            session.graph.add_evidence("openness", user_message, 0.8, 0.85, "direct_openness_statement")

    @staticmethod
    def _trait_confidence(graph: PersonalityKnowledgeGraph, trait: str) -> float:
        try:
            return float(graph.get_trait_value(trait).get("confidence", 0.0))
        except ValueError:
            return 0.0

    @staticmethod
    def _normalize_question_text(text: str) -> str:
        normalized = (text or "").strip().lower()
        normalized = normalized.replace("almost done — one last thing:", "").replace("i still need one quick confirmation:", "").strip().strip('"').strip("'")
        return re.sub(r"\s+", " ", normalized)

    def _has_asked_similar_question(self, session: InterviewSession, question: str) -> bool:
        q_norm = self._normalize_question_text(question)
        if not q_norm:
            return False
        for entry in session.transcript:
            if entry.get("role") != "assistant":
                continue
            asked = self._normalize_question_text(entry.get("content", ""))
            if q_norm == asked or q_norm in asked or asked in q_norm:
                return True
        return False

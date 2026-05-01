"""LLM-assisted narrative rendering of action outcomes."""

from __future__ import annotations

import time

from pydantic import BaseModel

from .llm_client import UnifiedLLMClient
from .persona import Persona
from .action_catalog import ActionOutcomeType, get_action_by_id
from .environment_resolver import ActionOutcome


class NarratedEvent(BaseModel):
    tick: int
    time_of_day: str
    action_name: str
    outcome_type: ActionOutcomeType
    satisfaction_delta: float
    narrative: str
    emotion: str
    memory_content: str


class EventNarrator:
    """Narrates resolved outcomes from persona first-person perspective."""

    SUCCESS_NARRATIVES = {
        "turn_on_heating": "The heating is working well, I feel warm and comfortable.",
        "sleep_properly": "I slept well last night, feeling rested.",
        "go_to_cafe": "Had a nice coffee nearby, pleasant start to the day.",
        "cook_at_home": "Cooked myself a meal, the kitchen is well-equipped.",
        "take_bus_university": "Caught the bus on time and got where I needed smoothly.",
        "take_bus_general": "Public transport worked well and saved time.",
        "use_elevator": "The elevator made carrying things much easier.",
        "walk_to_destination": "The walk was manageable and helped clear my head.",
        "invite_friends_over": "Had people over and the space felt welcoming.",
        "go_out_socially": "Going out helped me recharge socially.",
        "nap_afternoon": "The nap helped me recover energy for the rest of the day.",
        "morning_routine_quiet": "My morning routine felt smooth and calm.",
        "have_private_time": "I got private time and felt more centered afterward.",
        "clean_shared_spaces": "Cleaning improved the space and made me feel in control.",
        "open_window_ventilation": "Fresh air made the apartment feel better quickly.",
        "go_to_restaurant": "Dinner out was convenient and satisfying.",
        "seek_quiet_room": "Moving to a quieter room helped me focus again.",
        "tolerate_noise": "I managed to push through the noise this time.",
    }

    def __init__(self, llm_client: UnifiedLLMClient) -> None:
        self.llm_client = llm_client

    def narrate(
        self,
        outcome: ActionOutcome,
        persona: Persona,
        tick: int,
        time_of_day: str,
    ) -> NarratedEvent:
        if outcome.outcome_type == ActionOutcomeType.NOT_ATTEMPTED:
            return NarratedEvent(
                tick=tick,
                time_of_day=time_of_day,
                action_name=outcome.action.name,
                outcome_type=outcome.outcome_type,
                satisfaction_delta=0.0,
                narrative="",
                emotion="neutral",
                memory_content="",
            )

        time.sleep(0.8)

        system_prompt = (
            f"You are {persona.name}. Narrate what just happened in 1-2 sentences "
            "from first person. Be specific and emotional."
        )
        user_message = f"""
At {time_of_day}:
You tried to: {outcome.action.name}
What happened: {outcome.outcome_type.value}
{f'Blocked because: {outcome.blocking_reason}' if outcome.blocking_reason else ''}
{f'Friction: {outcome.friction_reason}' if outcome.friction_reason else ''}
Hint: {outcome.narrative_hint}
Your personality: {persona.persona_description}

Write:
1. A 1-2 sentence first-person narrative
2. Your emotion (one word)
3. A memory note (what you'd remember later, for storing in memory: max 20 words)
""".strip()

        schema = {
            "narrative": "string",
            "emotion": "string",
            "memory_content": "string",
        }

        try:
            parsed = self.llm_client.complete_structured(
                system_prompt=system_prompt,
                user_message=user_message,
                output_schema=schema,
                use_fast_model=False,
            )
            narrative = str(parsed.get("narrative", "")).strip()
            emotion = str(parsed.get("emotion", "neutral")).strip() or "neutral"
            memory_content = str(parsed.get("memory_content", "")).strip()
        except Exception:
            fallback_reason = outcome.blocking_reason or outcome.friction_reason or "completed"
            narrative = f"I tried to {outcome.action.name.lower()}, but {fallback_reason.lower()}."
            emotion = (
                "frustrated"
                if outcome.outcome_type in {ActionOutcomeType.BLOCKED, ActionOutcomeType.PARTIAL}
                else "content"
            )
            memory_content = f"{outcome.action.name}: {fallback_reason}"[:120]

        return NarratedEvent(
            tick=tick,
            time_of_day=time_of_day,
            action_name=outcome.action.name,
            outcome_type=outcome.outcome_type,
            satisfaction_delta=float(outcome.satisfaction_delta),
            narrative=narrative,
            emotion=emotion,
            memory_content=memory_content,
        )

    def narrate_batch_fast(
        self,
        outcomes: list[ActionOutcome],
        persona: Persona,
        tick: int,
        time_of_day: str,
    ) -> list[NarratedEvent]:
        narrated: list[NarratedEvent] = []

        for outcome in outcomes:
            if outcome.outcome_type == ActionOutcomeType.SUCCESS:
                template = self.SUCCESS_NARRATIVES.get(
                    outcome.action.action_id,
                    f"I completed {outcome.action.name.lower()} successfully.",
                )
                narrated.append(
                    NarratedEvent(
                        tick=tick,
                        time_of_day=time_of_day,
                        action_name=outcome.action.name,
                        outcome_type=outcome.outcome_type,
                        satisfaction_delta=float(outcome.satisfaction_delta),
                        narrative=template,
                        emotion="content",
                        memory_content=template[:80],
                    )
                )
                continue

            narrated.append(
                self.narrate(
                    outcome=outcome,
                    persona=persona,
                    tick=tick,
                    time_of_day=time_of_day,
                )
            )

        return narrated


if __name__ == "__main__":
    from .llm_client import UnifiedLLMClient
    from .environment_resolver import ActionOutcome

    cold_sensitive_persona = Persona.from_traits(
        subject_id="cold_sensitive_001",
        name="Cold Sensitive Persona",
        traits={
            "introversion": 0.6,
            "noise_sensitivity": 0.7,
            "cleanliness": 0.6,
            "thermal_sensitivity": 0.95,
            "early_riser": True,
            "smoker": False,
        },
    )

    action = get_action_by_id("turn_on_heating")
    if action is None:
        raise RuntimeError("turn_on_heating action missing from catalog")

    blocked_outcome = ActionOutcome(
        action=action,
        outcome_type=ActionOutcomeType.BLOCKED,
        satisfaction_delta=action.satisfaction_delta_blocked,
        blocking_reason="No heating system in the apartment",
        friction_reason="",
        environment_values={"has_heating": False},
        narrative_hint="blocked:has_heating:turn_on_heating",
    )

    narrator = EventNarrator(llm_client=UnifiedLLMClient())
    narrated = narrator.narrate(
        outcome=blocked_outcome,
        persona=cold_sensitive_persona,
        tick=1,
        time_of_day="06:00",
    )
    print("Narrative:", narrated.narrative)
    print("Emotion:", narrated.emotion)

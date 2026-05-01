"""Satisfaction delta accumulation and bounds management."""

from __future__ import annotations

from pydantic import BaseModel, Field

try:
    from .action_catalog import ActionOutcomeType
    from .event_narrator import NarratedEvent
except ImportError:  # pragma: no cover
    from action_catalog import ActionOutcomeType
    from event_narrator import NarratedEvent


class SatisfactionState(BaseModel):
    current: float = Field(default=0.5, ge=0.0, le=1.0)
    cumulative_delta: float = 0.0


class SatisfactionEvent(BaseModel):
    tick: int
    time_of_day: str
    action_id: str
    outcome_type: ActionOutcomeType
    delta: float
    cumulative_score: float
    emotion: str
    flagged: bool


class SatisfactionTracker:
    """Accumulates satisfaction over time and tracks harmful patterns."""

    def __init__(self, initial_score: float = 0.75):
        bounded_initial = max(0.0, min(1.0, float(initial_score)))
        self.initial_score = bounded_initial
        self.score = bounded_initial
        self.events: list[SatisfactionEvent] = []
        self.trajectory: list[float] = [bounded_initial]
        self.persistent_blocks: dict[str, int] = {}
        self.flags: list[dict] = []

    def record(
        self,
        tick: int,
        time_of_day: str,
        narrated_event: NarratedEvent,
    ) -> SatisfactionEvent:
        self.score = max(
            0.0,
            min(1.0, self.score + float(narrated_event.satisfaction_delta)),
        )

        self.trajectory.append(self.score)
        flagged = float(narrated_event.satisfaction_delta) < -0.10

        if narrated_event.outcome_type == ActionOutcomeType.BLOCKED:
            aid = narrated_event.action_name
            self.persistent_blocks[aid] = self.persistent_blocks.get(aid, 0) + 1

            if self.persistent_blocks[aid] >= 3:
                self.flags.append(
                    {
                        "type": "persistent_block",
                        "action": aid,
                        "count": self.persistent_blocks[aid],
                        "tick": tick,
                        "message": (
                            f"Tried {aid} {self.persistent_blocks[aid]} times, "
                            "always blocked by environment"
                        ),
                    }
                )

        event = SatisfactionEvent(
            tick=tick,
            time_of_day=time_of_day,
            action_id=narrated_event.action_name,
            outcome_type=narrated_event.outcome_type,
            delta=float(narrated_event.satisfaction_delta),
            cumulative_score=float(self.score),
            emotion=narrated_event.emotion,
            flagged=flagged,
        )
        self.events.append(event)

        if flagged:
            self.flags.append(
                {
                    "type": "large_negative",
                    "action": narrated_event.action_name,
                    "delta": float(narrated_event.satisfaction_delta),
                    "tick": tick,
                    "narrative": narrated_event.narrative,
                }
            )

        return event

    def _label_for_score(self, score: float) -> str:
        if score >= 0.80:
            return "Very Satisfied"
        if score >= 0.65:
            return "Satisfied"
        if score >= 0.50:
            return "Mixed"
        if score >= 0.35:
            return "Unsatisfied"
        return "Very Unsatisfied"

    def get_summary(self) -> dict:
        blocked_events = sum(
            1 for event in self.events if event.outcome_type == ActionOutcomeType.BLOCKED
        )
        success_events = sum(
            1 for event in self.events if event.outcome_type == ActionOutcomeType.SUCCESS
        )
        friction_events = sum(
            1
            for event in self.events
            if event.outcome_type == ActionOutcomeType.SUCCESS_WITH_FRICTION
        )

        if self.events:
            worst_event = min(self.events, key=lambda event: event.cumulative_score)
            best_event = max(self.events, key=lambda event: event.cumulative_score)
            worst_tick = int(worst_event.tick)
            best_tick = int(best_event.tick)
        else:
            worst_tick = 0
            best_tick = 0

        final_score = float(self.score)
        initial_score = float(self.initial_score)

        return {
            "final_score": final_score,
            "initial_score": initial_score,
            "net_change": final_score - initial_score,
            "trajectory": list(self.trajectory),
            "total_events": len(self.events),
            "blocked_events": blocked_events,
            "success_events": success_events,
            "friction_events": friction_events,
            "flags": list(self.flags),
            "persistent_blocks": dict(self.persistent_blocks),
            "worst_tick": worst_tick,
            "best_tick": best_tick,
            "satisfaction_label": self._label_for_score(final_score),
        }

    def get_top_pain_points(self) -> list[dict]:
        negatives = [event for event in self.events if event.delta < 0]
        negatives.sort(key=lambda event: abs(event.delta), reverse=True)
        top = negatives[:3]
        return [
            {
                "tick": event.tick,
                "time_of_day": event.time_of_day,
                "action": event.action_id,
                "delta": event.delta,
                "outcome_type": event.outcome_type.value,
                "emotion": event.emotion,
            }
            for event in top
        ]

    def apply_delta(self, state: SatisfactionState, delta: float) -> SatisfactionState:
        """Compatibility helper for existing scaffolded engine usage."""
        next_value = max(0.0, min(1.0, state.current + float(delta)))
        return SatisfactionState(
            current=next_value,
            cumulative_delta=state.cumulative_delta + float(delta),
        )


if __name__ == "__main__":
    tracker = SatisfactionTracker(initial_score=0.75)

    sample_events = [
        NarratedEvent(
            tick=1,
            time_of_day="06:00",
            action_name="turn_on_heating",
            outcome_type=ActionOutcomeType.BLOCKED,
            satisfaction_delta=-0.12,
            narrative="Heating failed; the room stayed cold.",
            emotion="frustrated",
            memory_content="No heating, freezing morning.",
        ),
        NarratedEvent(
            tick=2,
            time_of_day="07:00",
            action_name="take_bus_university",
            outcome_type=ActionOutcomeType.BLOCKED,
            satisfaction_delta=-0.15,
            narrative="No bus nearby, arrived late.",
            emotion="stressed",
            memory_content="Missed class timing due to transport.",
        ),
        NarratedEvent(
            tick=3,
            time_of_day="08:00",
            action_name="cook_at_home",
            outcome_type=ActionOutcomeType.SUCCESS,
            satisfaction_delta=0.08,
            narrative="Cooked breakfast and felt better.",
            emotion="content",
            memory_content="Simple breakfast improved mood.",
        ),
        NarratedEvent(
            tick=4,
            time_of_day="09:00",
            action_name="sleep_properly",
            outcome_type=ActionOutcomeType.SUCCESS_WITH_FRICTION,
            satisfaction_delta=0.03,
            narrative="Rested a little despite noise.",
            emotion="tired",
            memory_content="Sleep disturbed by neighborhood noise.",
        ),
        NarratedEvent(
            tick=5,
            time_of_day="10:00",
            action_name="turn_on_heating",
            outcome_type=ActionOutcomeType.BLOCKED,
            satisfaction_delta=-0.12,
            narrative="Still no heating.",
            emotion="disappointed",
            memory_content="Second failed attempt to warm apartment.",
        ),
        NarratedEvent(
            tick=6,
            time_of_day="11:00",
            action_name="go_to_cafe",
            outcome_type=ActionOutcomeType.SUCCESS,
            satisfaction_delta=0.10,
            narrative="Coffee break helped reset my day.",
            emotion="relieved",
            memory_content="Nearby cafe gave positive break.",
        ),
        NarratedEvent(
            tick=7,
            time_of_day="12:00",
            action_name="turn_on_heating",
            outcome_type=ActionOutcomeType.BLOCKED,
            satisfaction_delta=-0.12,
            narrative="Third attempt failed again.",
            emotion="angry",
            memory_content="Persistent heating failure becoming major issue.",
        ),
        NarratedEvent(
            tick=8,
            time_of_day="13:00",
            action_name="clean_shared_spaces",
            outcome_type=ActionOutcomeType.SUCCESS,
            satisfaction_delta=0.08,
            narrative="Cleaning made me feel in control.",
            emotion="content",
            memory_content="Clean apartment reduced stress.",
        ),
        NarratedEvent(
            tick=9,
            time_of_day="14:00",
            action_name="take_bus_university",
            outcome_type=ActionOutcomeType.BLOCKED,
            satisfaction_delta=-0.15,
            narrative="Transport issue repeated.",
            emotion="frustrated",
            memory_content="Still lacking reliable transport.",
        ),
        NarratedEvent(
            tick=10,
            time_of_day="15:00",
            action_name="have_private_time",
            outcome_type=ActionOutcomeType.SUCCESS_WITH_FRICTION,
            satisfaction_delta=0.03,
            narrative="Got some alone time, but noise lingered.",
            emotion="mixed",
            memory_content="Partial privacy helped a bit.",
        ),
    ]

    for item in sample_events:
        tracker.record(
            tick=item.tick,
            time_of_day=item.time_of_day,
            narrated_event=item,
        )

    print("SUMMARY")
    print(tracker.get_summary())
    print("TOP_PAIN_POINTS")
    print(tracker.get_top_pain_points())

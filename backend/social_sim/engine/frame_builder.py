"""Frame builder: assembles the VisualSimulationReplay from solo event streams.

Takes two event streams (from LifeSimEngine.simulate_solo) plus a
compatibility result and produces a tick-by-tick frame sequence ready for
the frontend LifeSimDriver to play back.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from .data_contract import (
    ApartmentLayout,
    FrameAgentState,
    FrameConflict,
    SimulationFrame,
    SimulationSummary,
    VisualSimulationReplay,
)
from .layout_builder import (
    ACTION_EMOJI_MAP,
    LEAVING_ACTIONS,
    build_default_layout,
    get_hotspot_for_action,
)


def _mood_from_delta(delta: float) -> tuple[str, str]:
    """Map satisfaction delta to mood label and emoji."""
    if delta >= 0.08:
        return "happy", "😊"
    elif delta >= 0.02:
        return "neutral", "😐"
    elif delta >= -0.05:
        return "neutral", "🙂"
    elif delta >= -0.12:
        return "frustrated", "😟"
    else:
        return "upset", "😫"


def _action_label(action_id: str) -> str:
    """Convert action_id to a human-readable label."""
    return action_id.replace("_", " ").title()


def _agent_state_from_event(
    event: Dict[str, Any],
    persona_id: str,
    persona_name: str,
    layout: Dict[str, Any],
    is_leaving: bool = False,
) -> FrameAgentState:
    action_id = event.get("action_id", "idle")
    hs = get_hotspot_for_action(action_id)
    x = float(hs["x"]) if hs else 5.0
    y = float(hs["y"]) if hs else 4.0
    room = hs["room"] if hs else "living_room"

    delta = float(event.get("satisfaction_delta", 0.0))
    mood, mood_emoji = _mood_from_delta(delta)

    emoji = ACTION_EMOJI_MAP.get(action_id, "🚶")
    narration = event.get("narrative", "")
    speech = None
    # Show short speech bubble for high-impact events
    if abs(delta) > 0.1:
        speech = narration[:60] + "…" if len(narration) > 60 else narration

    return FrameAgentState(
        persona_id=persona_id,
        name=persona_name,
        x=x,
        y=y,
        room=room,
        action_id=action_id,
        action_label=_action_label(action_id),
        action_emoji=emoji,
        mood=mood,
        mood_emoji=mood_emoji,
        speech_bubble=speech,
        narration=narration,
        outside_room=is_leaving,
        satisfaction_delta=delta,
    )


class FrameBuilder:
    def __init__(self, layout: Optional[Dict[str, Any]] = None) -> None:
        self.layout = layout or build_default_layout()

    def build_full_sequence(
        self,
        run_id: str,
        result_a: Dict[str, Any],
        result_b: Optional[Dict[str, Any]],
        compatibility_result: Optional[Dict[str, Any]],
        mediation: Optional[Dict[str, Any]] = None,
    ) -> VisualSimulationReplay:
        """Build a VisualSimulationReplay from one or two solo results."""
        events_a: List[Dict[str, Any]] = result_a.get("events", [])
        events_b: List[Dict[str, Any]] = result_b.get("events", []) if result_b else []

        persona_a = {
            "subject_id": result_a.get("subject_id", "persona_a"),
            "name": result_a.get("persona_name", "Persona A"),
        }
        persona_b = (
            {
                "subject_id": result_b.get("subject_id", "persona_b"),
                "name": result_b.get("persona_name", "Persona B"),
            }
            if result_b
            else None
        )

        mode = "cohabitation" if result_b else "solo"
        num_ticks = max(len(events_a), len(events_b), 1)

        # Index conflicts by tick
        conflict_by_tick: Dict[int, Dict[str, Any]] = {}
        if compatibility_result:
            for c in compatibility_result.get("conflicts", []):
                tick = int(c.get("tick", 0))
                conflict_by_tick[tick] = c

        frames: List[SimulationFrame] = []

        for tick in range(num_ticks):
            hour = (6 + tick) % 24
            time_label = f"{hour:02d}:00"

            agents: List[FrameAgentState] = []

            # Agent A
            if tick < len(events_a):
                ev_a = events_a[tick]
                action_id_a = ev_a.get("action_id", "idle")
                agent_a = _agent_state_from_event(
                    event=ev_a,
                    persona_id=persona_a["subject_id"],
                    persona_name=persona_a["name"],
                    layout=self.layout,
                    is_leaving=action_id_a in LEAVING_ACTIONS,
                )
                agents.append(agent_a)

            # Agent B
            if persona_b and tick < len(events_b):
                ev_b = events_b[tick]
                action_id_b = ev_b.get("action_id", "idle")
                agent_b = _agent_state_from_event(
                    event=ev_b,
                    persona_id=persona_b["subject_id"],
                    persona_name=persona_b["name"],
                    layout=self.layout,
                    is_leaving=action_id_b in LEAVING_ACTIONS,
                )
                # Offset B's position slightly to avoid perfect overlap
                agent_b.x = max(0.0, agent_b.x - 1.0)
                agent_b.y = min(7.0, agent_b.y + 0.5)

                # Inject conflict speech bubble if same hotspot this tick
                if tick in conflict_by_tick and not agents[0].outside_room:
                    conflict_data = conflict_by_tick[tick]
                    agents[0].speech_bubble = "I was about to use this! 😤"
                    agent_b.speech_bubble = "Sorry, I'll wait… 🙂"

                agents.append(agent_b)

            # Conflict frame
            frame_conflict: Optional[FrameConflict] = None
            if tick in conflict_by_tick:
                cd = conflict_by_tick[tick]
                frame_conflict = FrameConflict(
                    conflict_id=cd.get("conflict_id", str(uuid.uuid4())),
                    conflict_type=cd.get("conflict_type", "other"),
                    description=cd.get("description", "Conflict detected."),
                    severity=float(cd.get("severity", 0.5)),
                    tick=tick,
                )

            frames.append(
                SimulationFrame(
                    frame_index=tick,
                    tick=tick,
                    time_label=time_label,
                    agents=agents,
                    conflict=frame_conflict,
                    events=[],
                )
            )

        # Build summary
        compat_score = 0.5
        compat_label = "Unknown"
        conflicts_count = 0
        if compatibility_result:
            compat_score = float(compatibility_result.get("compatibility_score", 0.5))
            compat_label = compatibility_result.get("label", "Unknown")
            conflicts_count = len(compatibility_result.get("conflicts", []))

        sat_a = float(result_a.get("satisfaction_summary", {}).get("final_score", 0.5) if result_a else 0.5)
        sat_b = float(result_b.get("satisfaction_summary", {}).get("final_score", 0.5) if result_b else 0.5)

        summary = SimulationSummary(
            compatibility_score=compat_score,
            label=compat_label,
            conflicts_count=conflicts_count,
            persona_a_satisfaction=sat_a,
            persona_b_satisfaction=sat_b,
            total_ticks=num_ticks,
        )

        personas_list = [persona_a]
        if persona_b:
            personas_list.append(persona_b)

        rules = []
        med_summary = ""
        if mediation:
            rules = mediation.get("rules", [])
            med_summary = mediation.get("summary", "")

        return VisualSimulationReplay(
            run_id=run_id,
            mode=mode,
            personas=personas_list,
            apartment=ApartmentLayout(**self.layout),
            frames=frames,
            simulation_summary=summary,
            mediation_rules=rules,
            mediation_summary=med_summary,
        )

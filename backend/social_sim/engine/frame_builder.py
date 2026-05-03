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

    def build_cohab_sequence(
        self,
        run_id: str,
        persona_a: dict,
        persona_b: dict,
        joint_events: List[Dict[str, Any]],
        compatibility_result: Optional[Dict[str, Any]] = None,
        mediation: Optional[Dict[str, Any]] = None,
    ) -> "VisualSimulationReplay":
        """Build a cohabitation replay with 2 agents from joint_events produced by compatibility.py."""

        id_a = str(persona_a.get("subject_id", "persona_a"))
        id_b = str(persona_b.get("subject_id", "persona_b"))
        name_a = str(persona_a.get("name", "Roommate A"))
        name_b = str(persona_b.get("name", "Roommate B"))

        # Default positions: Agent A in bedroom_a, Agent B in bedroom_b
        # They move to shared rooms when their action implies it
        SHARED_ACTION_KEYWORDS = {
            "kitchen", "cook", "meal", "breakfast", "lunch", "dinner", "eat",
            "living", "sofa", "relax", "tv", "couch", "watch",
        }

        def _resolve_cohab_position(action_str: str, is_agent_b: bool) -> tuple:
            """Return (x, y, room) based on action text."""
            action_lower = action_str.lower()
            if any(kw in action_lower for kw in ["kitchen", "cook", "meal", "breakfast", "lunch", "dinner", "eat"]):
                x_offset = 0.8 if is_agent_b else 0.0
                return 1.0 + x_offset, 6.0, "kitchen"
            if any(kw in action_lower for kw in ["living", "sofa", "relax", "tv", "couch", "watch"]):
                x_offset = 1.2 if is_agent_b else 0.0
                return 4.5 + x_offset, 3.5, "living_room"
            if any(kw in action_lower for kw in ["bath", "shower", "toilet"]):
                return 9.0, 5.0, "bathroom"
            if any(kw in action_lower for kw in ["sleep", "bed", "nap", "rest"]):
                return (7.5, 1.0, "bedroom_b") if is_agent_b else (1.5, 1.0, "bedroom_a")
            if any(kw in action_lower for kw in ["work", "study", "desk", "computer", "read"]):
                return (7.0, 2.0, "bedroom_b") if is_agent_b else (2.0, 2.0, "bedroom_a")
            # Default: own bedroom
            return (7.5, 1.5, "bedroom_b") if is_agent_b else (1.5, 1.5, "bedroom_a")

        frames: List[SimulationFrame] = []

        for tick, ev in enumerate(joint_events):
            hour = (6 + tick) % 24
            time_label = f"{hour:02d}:00"

            action_a = str(ev.get("persona_a_action", ""))
            action_b = str(ev.get("persona_b_action", ""))
            feeling_a = str(ev.get("persona_a_feeling", ""))
            feeling_b = str(ev.get("persona_b_feeling", ""))
            sat_a = float(ev.get("satisfaction_a", 0.5))
            sat_b = float(ev.get("satisfaction_b", 0.5))

            x_a, y_a, room_a = _resolve_cohab_position(action_a, is_agent_b=False)
            x_b, y_b, room_b = _resolve_cohab_position(action_b, is_agent_b=True)

            delta_a = sat_a - (float(joint_events[tick - 1].get("satisfaction_a", sat_a)) if tick > 0 else sat_a)
            delta_b = sat_b - (float(joint_events[tick - 1].get("satisfaction_b", sat_b)) if tick > 0 else sat_b)

            mood_a, mood_emoji_a = _mood_from_delta(delta_a)
            mood_b, mood_emoji_b = _mood_from_delta(delta_b)

            conflicts_this_tick = ev.get("conflicts", []) or []
            speech_a: Optional[str] = None
            speech_b: Optional[str] = None
            frame_conflict: Optional[FrameConflict] = None

            if conflicts_this_tick:
                c = conflicts_this_tick[0]
                desc = str(c.get("description", ""))[:80]
                speech_a = f"😤 {desc}" if len(desc) <= 60 else f"😤 {desc[:57]}…"
                speech_b = "😅 Sorry about that…"
                frame_conflict = FrameConflict(
                    conflict_id=str(c.get("conflict_id", uuid.uuid4())),
                    conflict_type=str(c.get("conflict_type", "other")),
                    description=str(c.get("description", "")),
                    severity=float(c.get("severity", 0.5)),
                    tick=tick,
                )

            agent_a_state = FrameAgentState(
                persona_id=id_a,
                name=name_a,
                x=x_a,
                y=y_a,
                room=room_a,
                action_id="idle",
                action_label=action_a[:50] if action_a else "Idle",
                action_emoji="🏠",
                mood=mood_a,
                mood_emoji=mood_emoji_a,
                speech_bubble=speech_a,
                narration=feeling_a,
                outside_room=False,
                satisfaction_delta=round(delta_a, 3),
            )

            agent_b_state = FrameAgentState(
                persona_id=id_b,
                name=name_b,
                x=x_b,
                y=y_b,
                room=room_b,
                action_id="idle",
                action_label=action_b[:50] if action_b else "Idle",
                action_emoji="🏠",
                mood=mood_b,
                mood_emoji=mood_emoji_b,
                speech_bubble=speech_b,
                narration=feeling_b,
                outside_room=False,
                satisfaction_delta=round(delta_b, 3),
            )

            frames.append(SimulationFrame(
                frame_index=tick,
                tick=tick,
                time_label=time_label,
                agents=[agent_a_state, agent_b_state],
                conflict=frame_conflict,
                events=[],
            ))

        # Build summary
        compat_score = float((compatibility_result or {}).get("compatibility_score", 0.5))
        compat_label = str((compatibility_result or {}).get("compatibility_label", "Unknown"))
        conflicts_count = len((compatibility_result or {}).get("conflicts", []))
        final_sat_a = float(joint_events[-1].get("satisfaction_a", 0.5)) if joint_events else 0.5
        final_sat_b = float(joint_events[-1].get("satisfaction_b", 0.5)) if joint_events else 0.5

        summary = SimulationSummary(
            compatibility_score=compat_score,
            label=compat_label,
            conflicts_count=conflicts_count,
            persona_a_satisfaction=final_sat_a,
            persona_b_satisfaction=final_sat_b,
            total_ticks=len(joint_events),
        )

        rules = (mediation or {}).get("rules", []) if mediation else []
        med_summary = (mediation or {}).get("summary", "") if mediation else ""

        return VisualSimulationReplay(
            run_id=run_id,
            mode="cohabitation",
            personas=[
                {"subject_id": id_a, "name": name_a},
                {"subject_id": id_b, "name": name_b},
            ],
            apartment=ApartmentLayout(**self.layout),
            frames=frames,
            simulation_summary=summary,
            mediation_rules=rules,
            mediation_summary=med_summary,
        )


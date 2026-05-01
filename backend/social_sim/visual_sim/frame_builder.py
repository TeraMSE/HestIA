"""Convert roommate simulation events into visual frame sequences for playback."""

from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from typing import Any

from .data_contract import (
    ApartmentLayout,
    FrameAgentState,
    FrameConflict,
    FrameEvent,
    GridPosition,
    PersonaVisual,
    SimulationFrame,
    SimulationSummary,
    VisualSimulationReplay,
)
from .layout_builder import LayoutBuilder


ACTION_HOTSPOT_MAP: dict[str, str | None] = {
    "sleep_properly": "bed",
    "nap_afternoon": "bed",
    "cook_at_home": "stove",
    "get_groceries": "dining_table",
    "have_private_time": "desk",
    "morning_routine_quiet": "bathroom:shower",
    "invite_friends_over": "sofa",
    "go_out_socially": None,
    "commute_to_work_uni": None,
    "seek_quiet_room": "desk",
    "tolerate_noise": None,
    "clean_shared_spaces": "kitchen:fridge",
    "watch_tv": "living_room:tv",
    "study": "bedroom:desk",
    "eat_meal": "kitchen:dining_table",
    "relax_sofa": "living_room:sofa",
}

ACTION_EMOJI_MAP: dict[str, str] = {
    "sleep_properly": "😴",
    "cook_at_home": "🍳",
    "have_private_time": "📚",
    "morning_routine_quiet": "🪥",
    "invite_friends_over": "🤝",
    "seek_quiet_room": "🤫",
    "clean_shared_spaces": "🧹",
    "turn_on_heating": "🥶",
    "go_to_cafe": "☕",
    "take_bus_general": "🚌",
    "go_to_hospital": "🏥",
}


class FrameBuilder:
    """Bridge text simulation events to replayable visual frame sequences."""

    def __init__(self, layout: dict):
        self.layout = layout
        self.hotspot_positions, self.room_centers, self.hotspots_by_room = self._index_hotspots(layout)

    def _index_hotspots(
        self,
        layout: dict,
    ) -> tuple[dict[str, tuple[float, float]], dict[str, tuple[float, float]], dict[str, list[dict[str, Any]]]]:
        """Build hotspot and room center lookups for fast target resolution."""
        hotspot_lookup: dict[str, tuple[float, float]] = {}
        room_centers: dict[str, tuple[float, float]] = {}
        hotspots_by_room: dict[str, list[dict[str, Any]]] = defaultdict(list)

        rooms = layout.get("rooms", [])
        for room in rooms:
            cx = float(room["x"]) + (float(room["w"]) / 2.0)
            cy = float(room["y"]) + (float(room["h"]) / 2.0)
            room_id = str(room["id"])
            room_centers[room_id] = (cx, cy)
            room_centers[str(room.get("type", room_id))] = (cx, cy)

        for hotspot in layout.get("hotspots", []):
            hid = str(hotspot["id"])
            x, y = float(hotspot["x"]), float(hotspot["y"])
            hotspot_lookup[hid] = (x, y)
            hotspot_lookup[hid.split("_")[-1]] = (x, y)
            room_id = str(hotspot["room_id"])
            hotspots_by_room[room_id].append(hotspot)

        return hotspot_lookup, room_centers, hotspots_by_room

    @staticmethod
    def _normalize_action_id(event: dict[str, Any]) -> str:
        if event.get("action_id"):
            return str(event.get("action_id"))

        action = event.get("action")
        if isinstance(action, dict) and action.get("action_id"):
            return str(action.get("action_id"))

        action_name = str(event.get("action_name") or "").strip().lower()
        heuristic_map = {
            "full night of sleep": "sleep_properly",
            "afternoon nap": "nap_afternoon",
            "cook": "cook_at_home",
            "private time": "have_private_time",
            "morning routine": "morning_routine_quiet",
            "friends over": "invite_friends_over",
            "go out": "go_out_socially",
            "quiet room": "seek_quiet_room",
            "noise": "tolerate_noise",
            "clean": "clean_shared_spaces",
            "tv": "watch_tv",
            "study": "study",
            "meal": "eat_meal",
            "sofa": "relax_sofa",
            "grocery": "get_groceries",
            "commute": "commute_to_work_uni",
        }
        for key, mapped in heuristic_map.items():
            if key in action_name:
                return mapped

        return action_name.replace(" ", "_") if action_name else "idle"

    @staticmethod
    def _mood_from_delta(delta: float) -> str:
        if delta > 0.05:
            return "happy"
        if -0.03 < delta <= 0.05:
            return "neutral"
        if -0.08 < delta <= -0.03:
            return "frustrated"
        return "upset"

    @staticmethod
    def _emoji_for_action(action_id: str) -> str:
        if action_id in ACTION_EMOJI_MAP:
            return ACTION_EMOJI_MAP[action_id]
        if "sleep" in action_id:
            return "😴"
        if "cook" in action_id:
            return "🍳"
        if "study" in action_id:
            return "📚"
        if "clean" in action_id:
            return "🧹"
        if "bus" in action_id or "commute" in action_id:
            return "🚌"
        return "🙂"

    def _persona_bedroom_room_id(self, persona_id: str) -> str | None:
        for room in self.layout.get("rooms", []):
            if room.get("type") == "bedroom" and room.get("assigned_to") == persona_id:
                return str(room["id"])
        return None

    def _hotspot_in_room(self, room_id: str, token: str) -> tuple[str | None, tuple[float, float] | None]:
        for hotspot in self.hotspots_by_room.get(room_id, []):
            hid = str(hotspot["id"])
            if hid.endswith(f"_{token}") or hid == token:
                return hid, (float(hotspot["x"]), float(hotspot["y"]))
        return None, None

    def _find_alternate_hotspot(self, room_id: str, excluded_hotspot_id: str | None) -> tuple[str | None, tuple[float, float] | None]:
        for hotspot in self.hotspots_by_room.get(room_id, []):
            hid = str(hotspot["id"])
            if excluded_hotspot_id and hid == excluded_hotspot_id:
                continue
            return hid, (float(hotspot["x"]), float(hotspot["y"]))
        center = self.room_centers.get(room_id)
        return None, center

    def _entrance_position(self) -> tuple[float, float]:
        width = float(self.layout.get("width_units", 20))
        height = float(self.layout.get("height_units", 15))
        return (max(0.0, width - 0.5), max(0.0, height / 2.0))

    def _infer_fallback_room(self, action_id: str, persona_id: str) -> str | None:
        if "bed" in action_id or "sleep" in action_id or "study" in action_id:
            return self._persona_bedroom_room_id(persona_id)
        if "kitchen" in action_id or "cook" in action_id or "meal" in action_id:
            for room in self.layout.get("rooms", []):
                if room.get("type") == "kitchen":
                    return str(room["id"])
        if "sofa" in action_id or "social" in action_id or "tv" in action_id:
            for room in self.layout.get("rooms", []):
                if room.get("type") == "living_room":
                    return str(room["id"])
        return None

    def _room_id_from_hint(self, room_hint: str | None, persona_id: str) -> str | None:
        if not room_hint:
            return None

        hint = str(room_hint).strip().lower()
        if not hint:
            return None

        if "bedroom" in hint:
            assigned = self._persona_bedroom_room_id(persona_id)
            if assigned:
                return assigned

        for room in self.layout.get("rooms", []):
            room_id = str(room.get("id", ""))
            room_type = str(room.get("type", ""))
            room_label = str(room.get("label", ""))
            hay = f"{room_id} {room_type} {room_label}".lower()
            if hint in hay or any(token and token in hay for token in hint.replace("-", " ").split()):
                return room_id

        return None

    def _get_target_position(
        self,
        action_id: str,
        persona_id: str,
        room_hint: str | None = None,
    ) -> tuple[float, float, str | None, str | None, bool]:
        """Resolve action_id to (x, y, room_id, hotspot_id, leaving_apartment)."""
        mapped_present = action_id in ACTION_HOTSPOT_MAP
        mapped = ACTION_HOTSPOT_MAP.get(action_id)
        entrance = self._entrance_position()

        if mapped_present and mapped is None:
            return entrance[0], entrance[1], None, None, True

        if isinstance(mapped, str) and ":" in mapped:
            left, right = mapped.split(":", 1)
            if left == "bedroom":
                room_id = self._persona_bedroom_room_id(persona_id)
                if room_id:
                    hot_id, pos = self._hotspot_in_room(room_id, right)
                    if pos:
                        return pos[0], pos[1], room_id, hot_id, False
            else:
                room_id = None
                for room in self.layout.get("rooms", []):
                    if str(room.get("type")) == left:
                        room_id = str(room["id"])
                        break
                if room_id:
                    hot_id, pos = self._hotspot_in_room(room_id, right)
                    if pos:
                        return pos[0], pos[1], room_id, hot_id, False
                    center = self.room_centers.get(room_id)
                    if center:
                        return center[0], center[1], room_id, None, False

        if mapped == "desk":
            assigned_bed = self._persona_bedroom_room_id(persona_id)
            if assigned_bed:
                hot_id, pos = self._hotspot_in_room(assigned_bed, "desk")
                if pos:
                    return pos[0], pos[1], assigned_bed, hot_id, False

        if mapped == "bed":
            assigned_bed = self._persona_bedroom_room_id(persona_id)
            if assigned_bed:
                hot_id, pos = self._hotspot_in_room(assigned_bed, "bed")
                if pos:
                    return pos[0], pos[1], assigned_bed, hot_id, False

        if isinstance(mapped, str) and mapped:
            for room in self.layout.get("rooms", []):
                room_id = str(room["id"])
                hot_id, pos = self._hotspot_in_room(room_id, mapped)
                if pos:
                    return pos[0], pos[1], room_id, hot_id, False

        hinted_room = self._room_id_from_hint(room_hint, persona_id)
        if hinted_room:
            if mapped:
                hinted_hot_id, hinted_hot = self._hotspot_in_room(hinted_room, mapped)
                if hinted_hot:
                    return hinted_hot[0], hinted_hot[1], hinted_room, hinted_hot_id, False

            _, alternate = self._find_alternate_hotspot(hinted_room, None)
            if alternate:
                return alternate[0], alternate[1], hinted_room, None, False

            hinted_center = self.room_centers.get(hinted_room)
            if hinted_center:
                return hinted_center[0], hinted_center[1], hinted_room, None, False

        fallback_room = self._infer_fallback_room(action_id, persona_id)
        if fallback_room and fallback_room in self.room_centers:
            cx, cy = self.room_centers[fallback_room]
            return cx, cy, fallback_room, None, False

        return entrance[0], entrance[1], None, None, False

    def _detect_conflicts(self, tick_agents: list[dict[str, Any]]) -> dict[str, Any] | None:
        """Detect hotspot conflicts for same tick when both target same resource."""
        if len(tick_agents) < 2:
            return None

        first, second = tick_agents[0], tick_agents[1]
        target_a = first.get("target_hotspot")
        target_b = second.get("target_hotspot")

        if not target_a or not target_b:
            return None
        if target_a != target_b:
            return None

        return {
            "type": "space_conflict",
            "hotspot": target_a,
            "agents": [first["persona_id"], second["persona_id"]],
            "description": f"Both agents targeted hotspot '{target_a}' at the same time.",
            "satisfaction_impact": -0.05,
        }

    @staticmethod
    def _event_for_tick(events_by_tick: dict[int, list[dict[str, Any]]], tick: int) -> dict[str, Any]:
        events = events_by_tick.get(tick, [])
        if not events:
            return {}
        return max(events, key=lambda e: abs(float(e.get("satisfaction_delta", 0.0))))

    @staticmethod
    def _time_label_for_tick(tick: int) -> str:
        hour = (6 + int(tick)) % 24
        return f"{hour:02d}:00"

    @staticmethod
    def _scenario_label(action_id_a: str, action_id_b: str) -> str:
        if action_id_a == action_id_b and action_id_a:
            return action_id_a.replace("_", " ").title()
        if action_id_a and action_id_b:
            return f"{action_id_a.replace('_', ' ').title()} / {action_id_b.replace('_', ' ').title()}"
        return "Routine"

    @staticmethod
    def _conscientiousness(persona: dict[str, Any]) -> float:
        traits = persona.get("traits") or {}
        big5 = persona.get("big_five") or {}
        value = traits.get("conscientiousness", big5.get("conscientiousness", 0.5))
        try:
            return max(0.0, min(1.0, float(value)))
        except Exception:
            return 0.5

    def build_frames(
        self,
        persona_a_events: list[dict],
        persona_b_events: list[dict],
        personas: list[dict],
        frames_per_tick: int = 10,
    ) -> list[dict]:
        """Convert two personas' narrated event streams into interpolated visual frames."""
        frames_per_tick = max(1, int(frames_per_tick))

        persona_a_id = str(personas[0].get("id", "persona_a"))
        persona_b_id = str(personas[1].get("id", "persona_b"))

        grouped_a: dict[int, list[dict[str, Any]]] = defaultdict(list)
        grouped_b: dict[int, list[dict[str, Any]]] = defaultdict(list)

        for event in persona_a_events:
            grouped_a[int(event.get("tick", 0))].append(event)
        for event in persona_b_events:
            grouped_b[int(event.get("tick", 0))].append(event)

        all_ticks = sorted(set(grouped_a.keys()) | set(grouped_b.keys()))
        if not all_ticks:
            all_ticks = [0]

        persona_starts = {
            str(personas[0].get("id", "persona_a")): personas[0].get("start_position") or {"x": 1.0, "y": 1.0},
            str(personas[1].get("id", "persona_b")): personas[1].get("start_position") or {"x": 2.0, "y": 1.0},
        }

        current_pos = {
            persona_a_id: (float(persona_starts[persona_a_id]["x"]), float(persona_starts[persona_a_id]["y"])),
            persona_b_id: (float(persona_starts[persona_b_id]["x"]), float(persona_starts[persona_b_id]["y"])),
        }

        outside_state: dict[str, bool] = {persona_a_id: False, persona_b_id: False}

        all_frames: list[dict[str, Any]] = []
        frame_id_counter = 0

        for tick in all_ticks:
            event_a = self._event_for_tick(grouped_a, tick)
            event_b = self._event_for_tick(grouped_b, tick)

            action_a = self._normalize_action_id(event_a) if event_a else "idle"
            action_b = self._normalize_action_id(event_b) if event_b else "idle"

            delta_a = float(event_a.get("satisfaction_delta", 0.0)) if event_a else 0.0
            delta_b = float(event_b.get("satisfaction_delta", 0.0)) if event_b else 0.0
            mood_a = self._mood_from_delta(delta_a)
            mood_b = self._mood_from_delta(delta_b)

            tx_a, ty_a, room_a, hotspot_a, leaves_a = self._get_target_position(
                action_a,
                persona_a_id,
                room_hint=str(event_a.get("room", "")) if event_a else None,
            )
            tx_b, ty_b, room_b, hotspot_b, leaves_b = self._get_target_position(
                action_b,
                persona_b_id,
                room_hint=str(event_b.get("room", "")) if event_b else None,
            )

            tick_agents = [
                {
                    "persona_id": persona_a_id,
                    "target": (tx_a, ty_a),
                    "target_room": room_a,
                    "target_hotspot": hotspot_a,
                    "action_id": action_a,
                    "delta": delta_a,
                    "mood": mood_a,
                },
                {
                    "persona_id": persona_b_id,
                    "target": (tx_b, ty_b),
                    "target_room": room_b,
                    "target_hotspot": hotspot_b,
                    "action_id": action_b,
                    "delta": delta_b,
                    "mood": mood_b,
                },
            ]

            conflict = self._detect_conflicts(tick_agents)
            conflict_winner = None
            loser_alt_target: tuple[float, float] | None = None

            if conflict is not None:
                con_a = self._conscientiousness(personas[0])
                con_b = self._conscientiousness(personas[1])
                conflict_winner = persona_a_id if con_a >= con_b else persona_b_id
                loser = persona_b_id if conflict_winner == persona_a_id else persona_a_id

                loser_room = room_b if loser == persona_b_id else room_a
                loser_hotspot = hotspot_b if loser == persona_b_id else hotspot_a
                if loser_room:
                    _, alt = self._find_alternate_hotspot(loser_room, loser_hotspot)
                    loser_alt_target = alt

            midpoint_frame = frames_per_tick // 2
            for i in range(frames_per_tick):
                t = float(i) / float(frames_per_tick)
                frame_agents: list[FrameAgentState] = []
                frame_events: list[FrameEvent] = []
                frame_conflict = None

                for idx, agent in enumerate(tick_agents):
                    pid = agent["persona_id"]
                    sx, sy = current_pos[pid]
                    ex, ey = agent["target"]

                    bubble = None
                    if conflict and i == midpoint_frame:
                        if pid == conflict_winner:
                            bubble = "I was about to use this!"
                        else:
                            bubble = "Sorry, I'll wait..."
                    elif i == midpoint_frame and agent["delta"] <= -0.08:
                        bubble = "This apartment is really bothering me."

                    if (
                        not conflict
                        and i == midpoint_frame
                        and room_a
                        and room_b
                        and room_a == room_b
                        and mood_a in {"happy", "neutral"}
                        and mood_b in {"happy", "neutral"}
                    ):
                        bubble = "Nice to share this space." if idx == 0 else "Yeah, this works well."

                    if conflict and pid != conflict_winner and loser_alt_target is not None:
                        mid_x = sx + ((ex - sx) * 0.5)
                        mid_y = sy + ((ey - sy) * 0.5)
                        if i <= midpoint_frame:
                            seg_t = (float(i) / float(max(1, midpoint_frame)))
                            x = sx + ((mid_x - sx) * seg_t)
                            y = sy + ((mid_y - sy) * seg_t)
                        else:
                            seg_t = float(i - midpoint_frame) / float(max(1, frames_per_tick - midpoint_frame))
                            x = mid_x + ((loser_alt_target[0] - mid_x) * seg_t)
                            y = mid_y + ((loser_alt_target[1] - mid_y) * seg_t)
                    else:
                        x = sx + ((ex - sx) * t)
                        y = sy + ((ey - sy) * t)

                    if pid == persona_a_id:
                        leaves_now = leaves_a
                    else:
                        leaves_now = leaves_b

                    action_emoji = self._emoji_for_action(agent["action_id"])
                    action_label = agent["action_id"] or "idle"
                    if leaves_now:
                        if outside_state[pid] and i == 0:
                            action_label = f"returning:{action_label}"
                        elif i >= midpoint_frame:
                            action_label = f"leaving:{action_label}"
                            action_emoji = "🚪"

                    frame_agents.append(
                        FrameAgentState(
                            persona_id=pid,
                            position=GridPosition(x=round(x, 3), y=round(y, 3)),
                            target_room=agent["target_room"],
                            action=action_label,
                            action_emoji=action_emoji,
                            speech_bubble=bubble,
                            satisfaction_delta=float(agent["delta"]),
                            mood=str(agent["mood"]),
                        )
                    )

                if conflict is not None and i == midpoint_frame:
                    frame_events.append(
                        FrameEvent(
                            type="conflict",
                            description=str(conflict["description"]),
                            agents_involved=list(conflict["agents"]),
                        )
                    )
                    frame_conflict = FrameConflict(
                        type="space_conflict",
                        description=str(conflict["description"]),
                        resolution=f"{conflict_winner} proceeds, other waits",
                        satisfaction_impact=float(conflict["satisfaction_impact"]),
                    )
                elif i == midpoint_frame and room_a and room_b and room_a == room_b and not conflict:
                    frame_events.append(
                        FrameEvent(
                            type="positive_interaction",
                            description="Both agents shared the same room positively.",
                            agents_involved=[persona_a_id, persona_b_id],
                        )
                    )

                scenario_desc = str(
                    event_a.get("narrative")
                    or event_b.get("narrative")
                    or "Routine apartment activity."
                )

                all_frames.append(
                    SimulationFrame(
                        frame_id=frame_id_counter,
                        tick=int(tick),
                        time_label=str(event_a.get("time_of_day") or event_b.get("time_of_day") or self._time_label_for_tick(tick)),
                        scenario_label=self._scenario_label(action_a, action_b),
                        scenario_description=scenario_desc,
                        agents=frame_agents,
                        events=frame_events,
                        conflict=frame_conflict,
                    ).model_dump()
                )
                frame_id_counter += 1

            if conflict and loser_alt_target is not None:
                loser = persona_b_id if conflict_winner == persona_a_id else persona_a_id
                current_pos[loser] = loser_alt_target
                winner_target = (tx_a, ty_a) if conflict_winner == persona_a_id else (tx_b, ty_b)
                current_pos[conflict_winner] = winner_target
            else:
                current_pos[persona_a_id] = (tx_a, ty_a)
                current_pos[persona_b_id] = (tx_b, ty_b)

            outside_state[persona_a_id] = leaves_a
            outside_state[persona_b_id] = leaves_b

        return all_frames

    def build_full_sequence(
        self,
        solo_result_a: dict,
        solo_result_b: dict,
        compat_result: dict,
        personas: list[dict],
    ) -> dict:
        """Build full visual replay JSON payload from cohabitation simulation outputs."""
        def _safe_unit_score(value: Any, default: float = 0.5) -> float:
            try:
                return max(0.0, min(1.0, float(value)))
            except Exception:
                return default

        def _extract_satisfaction_score(persona_dict: dict[str, Any], solo_result: dict[str, Any]) -> float:
            summary = (solo_result.get("simulation_summary") or solo_result.get("summary") or {})
            candidates = [
                persona_dict.get("satisfaction_score"),
                summary.get("satisfaction_score"),
                summary.get("final_satisfaction"),
                summary.get("avg_satisfaction"),
                summary.get("average_satisfaction"),
            ]
            for candidate in candidates:
                if candidate is None:
                    continue
                return _safe_unit_score(candidate)
            return 0.5

        persona_a_events = list(solo_result_a.get("events", []))
        persona_b_events = list(solo_result_b.get("events", []))
        compat_events = list(compat_result.get("events", [])) if isinstance(compat_result, dict) else []

        normalized_personas: list[dict[str, Any]] = []
        for idx, persona in enumerate(personas[:2]):
            p = deepcopy(persona)
            p.setdefault("id", f"persona_{'a' if idx == 0 else 'b'}")
            p.setdefault("name", f"Persona {'A' if idx == 0 else 'B'}")
            p.setdefault("color", "#FF6B6B" if idx == 0 else "#4ECDC4")
            p.setdefault("emoji", "👩" if idx == 0 else "👨")
            p.setdefault("big5_summary", "Unknown")
            if "start_position" not in p:
                assigned_bedroom = self._persona_bedroom_room_id(str(p.get("id", "")))
                if assigned_bedroom and assigned_bedroom in self.room_centers:
                    sx, sy = self.room_centers[assigned_bedroom]
                    p["start_position"] = {"x": float(sx), "y": float(sy)}
                else:
                    fallback_center = next(iter(self.room_centers.values()), (1.0 + (idx * 2.0), 1.0))
                    p["start_position"] = {"x": float(fallback_center[0]), "y": float(fallback_center[1])}
            source_result = solo_result_a if idx == 0 else solo_result_b
            p["satisfaction_score"] = _extract_satisfaction_score(p, source_result)
            normalized_personas.append(p)

        frames = self.build_frames(
            persona_a_events=persona_a_events,
            persona_b_events=persona_b_events,
            personas=normalized_personas,
            frames_per_tick=10,
        )

        conflict_count = sum(1 for frame in frames if frame.get("conflict") is not None)
        compat_conflicts_count = len(compat_result.get("conflicts", [])) if isinstance(compat_result, dict) else 0
        conflict_count = max(conflict_count, compat_conflicts_count)
        positive_interactions = sum(
            1
            for frame in frames
            for event in frame.get("events", [])
            if event.get("type") == "positive_interaction"
        )

        compatibility_score = 0.5
        if isinstance(compat_result, dict):
            compat_summary = compat_result.get("simulation_summary") or compat_result.get("summary") or {}
            if compat_result.get("compatibility_score") is not None:
                compatibility_score = _safe_unit_score(compat_result.get("compatibility_score"), 0.5)
            elif compat_summary.get("compatibility_score") is not None:
                compatibility_score = _safe_unit_score(compat_summary.get("compatibility_score"), 0.5)

        sequence = {
            "apartment": {
                "width_units": int(self.layout.get("width_units", 20)),
                "height_units": int(self.layout.get("height_units", 15)),
                "rooms": self.layout.get("rooms", []),
                "hotspots": self.layout.get("hotspots", []),
            },
            "personas": normalized_personas,
            "frames": frames,
            "simulation_summary": {
                "total_frames": len(frames),
                "duration_hours": round(len(frames) / 20.0, 2),
                "compatibility_score": compatibility_score,
                "conflict_count": int(conflict_count),
                "positive_interactions": int(positive_interactions),
                "compat_events_count": len(compat_events),
            },
        }

        replay_model = VisualSimulationReplay(
            apartment=ApartmentLayout.model_validate(sequence["apartment"]),
            personas=[PersonaVisual.model_validate(p) for p in normalized_personas],
            frames=[SimulationFrame.model_validate(f) for f in frames],
            simulation_summary=SimulationSummary.model_validate(
                {
                    "total_frames": sequence["simulation_summary"]["total_frames"],
                    "duration_hours": sequence["simulation_summary"]["duration_hours"],
                    "compatibility_score": sequence["simulation_summary"]["compatibility_score"],
                    "conflict_count": sequence["simulation_summary"]["conflict_count"],
                    "positive_interactions": sequence["simulation_summary"]["positive_interactions"],
                }
            ),
        )

        output = replay_model.model_dump()
        if not isinstance(output.get("simulation_summary"), dict):
            output["simulation_summary"] = {}

        summary_out = output["simulation_summary"]
        fallback_summary = sequence.get("simulation_summary", {})
        summary_out.setdefault("total_frames", fallback_summary.get("total_frames", len(frames)))
        summary_out.setdefault("duration_hours", fallback_summary.get("duration_hours", round(len(frames) / 20.0, 2)))
        summary_out.setdefault("compatibility_score", compatibility_score)
        summary_out.setdefault("conflict_count", int(conflict_count))
        summary_out.setdefault("positive_interactions", int(positive_interactions))
        summary_out["compat_events_count"] = len(compat_events)

        for idx, persona_out in enumerate(output.get("personas", [])):
            persona_out["satisfaction_score"] = normalized_personas[idx].get("satisfaction_score", 0.5)

        return output

    def from_event_log(
        self,
        *,
        personas: list[PersonaVisual],
        events: list[dict[str, Any]],
        compatibility_score: float,
    ) -> VisualSimulationReplay:
        """Compatibility wrapper for legacy usage in existing code."""
        if len(personas) < 2:
            raise ValueError("from_event_log expects two personas.")

        persona_ids = [personas[0].id, personas[1].id]
        grouped: dict[str, list[dict[str, Any]]] = {persona_ids[0]: [], persona_ids[1]: []}

        for item in events:
            pid = str(item.get("persona_id", persona_ids[0]))
            if pid not in grouped:
                pid = persona_ids[0]
            grouped[pid].append(item)

        payload = self.build_full_sequence(
            solo_result_a={"events": grouped[persona_ids[0]]},
            solo_result_b={"events": grouped[persona_ids[1]]},
            compat_result={"compatibility_score": compatibility_score, "events": []},
            personas=[persona.model_dump() for persona in personas],
        )

        return VisualSimulationReplay.model_validate(payload)


FrameSequenceBuilder = FrameBuilder


if __name__ == "__main__":
    import sys

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    builder = LayoutBuilder()
    layout = builder.build_default_layout(
        num_bedrooms=2,
        has_living_room=True,
        has_kitchen=True,
        has_balcony=False,
        num_bathrooms=1,
        persona_a_name="Amira",
        persona_b_name="Karim",
    )

    personas = [
        {
            "id": "persona_a",
            "name": "Amira",
            "color": "#FF6B6B",
            "emoji": "👩",
            "big5_summary": "Introverted, Conscientious",
            "traits": {"conscientiousness": 0.8},
            "start_position": {"x": 3.0, "y": 2.5},
        },
        {
            "id": "persona_b",
            "name": "Karim",
            "color": "#4ECDC4",
            "emoji": "👨",
            "big5_summary": "Extraverted, Agreeable",
            "traits": {"conscientiousness": 0.45},
            "start_position": {"x": 10.0, "y": 2.5},
        },
    ]

    persona_a_events = [
        {
            "tick": 0,
            "time_of_day": "07:00",
            "action_id": "sleep_properly",
            "action_name": "Get a full night of sleep",
            "satisfaction_delta": 0.02,
            "narrative": "I slept well and woke up rested.",
        },
        {
            "tick": 1,
            "time_of_day": "08:00",
            "action_id": "cook_at_home",
            "action_name": "Cook a meal at home",
            "satisfaction_delta": 0.03,
            "narrative": "I moved to the kitchen to prepare breakfast.",
        },
        {
            "tick": 2,
            "time_of_day": "09:00",
            "action_id": "study",
            "action_name": "Study",
            "satisfaction_delta": 0.01,
            "narrative": "I focused on coursework at my desk.",
        },
        {
            "tick": 3,
            "time_of_day": "10:00",
            "action_id": "go_out_socially",
            "action_name": "Go out socially",
            "satisfaction_delta": -0.01,
            "narrative": "I stepped outside for a bit.",
        },
        {
            "tick": 4,
            "time_of_day": "11:00",
            "action_id": "relax_sofa",
            "action_name": "Relax on sofa",
            "satisfaction_delta": 0.04,
            "narrative": "I came back and relaxed in the living room.",
        },
    ]

    persona_b_events = [
        {
            "tick": 0,
            "time_of_day": "07:00",
            "action_id": "sleep_properly",
            "action_name": "Get a full night of sleep",
            "satisfaction_delta": 0.01,
            "narrative": "I had an okay night of sleep.",
        },
        {
            "tick": 1,
            "time_of_day": "08:00",
            "action_id": "cook_at_home",
            "action_name": "Cook a meal at home",
            "satisfaction_delta": -0.05,
            "narrative": "I also headed to the kitchen at the same time.",
        },
        {
            "tick": 2,
            "time_of_day": "09:00",
            "action_id": "have_private_time",
            "action_name": "Have private time",
            "satisfaction_delta": 0.02,
            "narrative": "I took some quiet time in my room.",
        },
        {
            "tick": 3,
            "time_of_day": "10:00",
            "action_id": "tolerate_noise",
            "action_name": "Try to focus despite noise",
            "satisfaction_delta": -0.09,
            "narrative": "The apartment noise was tiring.",
        },
        {
            "tick": 4,
            "time_of_day": "11:00",
            "action_id": "relax_sofa",
            "action_name": "Relax on sofa",
            "satisfaction_delta": 0.03,
            "narrative": "I joined in the living room to relax.",
        },
    ]

    frame_builder = FrameBuilder(layout)
    sequence = frame_builder.build_full_sequence(
        solo_result_a={"events": persona_a_events},
        solo_result_b={"events": persona_b_events},
        compat_result={"compatibility_score": 0.72, "events": []},
        personas=personas,
    )

    frames = sequence["frames"]
    print("Frame 0:")
    print(frames[0])

    conflict_frame = next((frame for frame in frames if frame.get("conflict")), None)
    print("\nConflict frame:")
    print(conflict_frame if conflict_frame else "No conflict frame found")

    print(f"\nTotal frame count: {len(frames)}")

"""LLM-assisted daily plan generation for EILS."""

from __future__ import annotations

import calendar
from datetime import datetime
import time
from typing import List

from pydantic import BaseModel, Field

from .llm_client import UnifiedLLMClient
from .persona import Persona
from .action_catalog import ACTION_CATALOG, ActionIntent, get_actions_for_need
from .environment_resolver import EnvironmentState
from .need_engine import NeedEngine, NeedState


class TickPlan(BaseModel):
    tick: int
    time_of_day: str
    intended_actions: list[str] = Field(default_factory=list)
    narrative_intent: str


class DailyPlanner:
    """LLM planner for daily and per-tick action intent generation."""

    def __init__(self, llm_client: UnifiedLLMClient) -> None:
        self.llm_client = llm_client

    @staticmethod
    def _time_of_day_for_tick(tick: int, start_hour: int = 6) -> str:
        hour = (start_hour + tick) % 24
        return f"{hour:02d}:00"

    @staticmethod
    def _sanitize_action_ids(raw_ids: list[str]) -> list[str]:
        valid_ids = {action.action_id for action in ACTION_CATALOG}
        cleaned = [action_id for action_id in raw_ids if action_id in valid_ids]
        deduped: list[str] = []
        for item in cleaned:
            if item not in deduped:
                deduped.append(item)
        return deduped[:2]

    def generate_daily_plan(
        self,
        persona: Persona,
        env_state: EnvironmentState,
        day_number: int = 1,
    ) -> list[TickPlan]:
        need_engine = NeedEngine(persona)
        states = need_engine.tick(current_tick=1, fulfilled_needs=[])
        priority_needs = need_engine.get_priority_needs(states, top_k=3)
        priority_summary = ", ".join(
            f"{state.category.value}:{state.urgency:.2f}" for state in priority_needs
        )

        commute_text = "not set"
        if env_state.commute_feasible is True:
            commute_text = "feasible"
        elif env_state.commute_feasible is False:
            commute_text = "not feasible"

        hospital_text = (
            f"{env_state.walk_time_hospital:.1f}"
            if env_state.walk_time_hospital is not None
            else "unknown"
        )
        supermarket_text = (
            f"{env_state.walk_time_supermarket:.1f}"
            if env_state.walk_time_supermarket is not None
            else "unknown"
        )
        cafe_text = (
            f"{env_state.walk_time_cafe:.1f}"
            if env_state.walk_time_cafe is not None
            else "unknown"
        )

        sim_month = env_state.month_of_simulation or datetime.now().month
        month_name = calendar.month_name[int(sim_month)]
        indoor_temp = float(env_state.indoor_temp_celsius)
        thermal_state = str(env_state.thermal_state)
        thermal_flag = (
            "⚠️ Heat stress conditions"
            if env_state.heat_stress_active
            else "❄️ Cold risk conditions"
            if env_state.dangerously_cold
            else "✅ Comfortable temperature"
        )

        system_prompt = persona.to_system_prompt()
        user_message = f"""
It is day {day_number} of living in this apartment.
Time: Starting from 06:00.

Your apartment has:
- Heating: {'Yes' if env_state.has_heating else 'No'}
- Elevator: {'Yes' if env_state.has_elevator else 'No'}
- Floor: {env_state.floor_number}
- Kitchen: {'Yes' if env_state.has_kitchen else 'No'}
- Noise level: {env_state.noise_level:.0%}
- Bus nearby: {'Yes' if env_state.bus_stop_nearby else 'No'}
- Café nearby: {'Yes' if env_state.cafe_nearby else 'No'}

Accessibility context:
- Hospital: {hospital_text} min walk
- Supermarket: {supermarket_text} min walk
- Café: {cafe_text} min walk
- Bus stops nearby: {env_state.transit_lines} lines
- Walkability: {env_state.walkability_score:.0%}
- Commute to destination: {commute_text}

Thermal context:
- Current simulation month: {month_name}
- Indoor temperature: {indoor_temp:.0f}°C (estimated)
- Thermal state: {thermal_state}
- Status: {thermal_flag}

Current priority needs:
{priority_summary}

Your available actions today (from catalog):
{[a.action_id for a in ACTION_CATALOG]}

Plan your day hour by hour for 24 ticks.
For each hour, specify 1-2 action_ids you
want to attempt and a brief reason why.
Focus on what feels natural given your
personality and what the apartment offers.

Include realistic scenarios like:
- Getting sick and needing the pharmacy/hospital
- Running errands that depend on transport
- Spontaneous café visits based on proximity
- Commute to work/uni if applicable
""".strip()

        schema = {
            "daily_plan": [
                {
                    "tick": 0,
                    "time_of_day": "06:00",
                    "intended_actions": ["action_id_1"],
                    "narrative_intent": "I want to...",
                }
            ]
        }

        parsed: dict = {}
        try:
            parsed = self.llm_client.complete_structured(
                system_prompt=system_prompt,
                user_message=user_message,
                output_schema=schema,
                use_fast_model=False,
            )
        except Exception:
            parsed = {}

        time.sleep(1.5)

        tick_plans: list[TickPlan] = []
        raw_items = parsed.get("daily_plan", []) if isinstance(parsed, dict) else []
        for idx, item in enumerate(raw_items[:24]):
            if not isinstance(item, dict):
                continue
            raw_ids = item.get("intended_actions", [])
            action_ids = self._sanitize_action_ids(raw_ids if isinstance(raw_ids, list) else [])
            if not action_ids:
                fallback = ACTION_CATALOG[idx % len(ACTION_CATALOG)].action_id
                action_ids = [fallback]

            tick = int(item.get("tick", idx))
            time_of_day = str(item.get("time_of_day") or self._time_of_day_for_tick(idx))
            narrative_intent = str(item.get("narrative_intent") or "I want to keep my day balanced.")

            tick_plans.append(
                TickPlan(
                    tick=tick,
                    time_of_day=time_of_day,
                    intended_actions=action_ids,
                    narrative_intent=narrative_intent,
                )
            )

        if len(tick_plans) < 24:
            for idx in range(len(tick_plans), 24):
                fallback_action = ACTION_CATALOG[idx % len(ACTION_CATALOG)].action_id
                tick_plans.append(
                    TickPlan(
                        tick=idx,
                        time_of_day=self._time_of_day_for_tick(idx),
                        intended_actions=[fallback_action],
                        narrative_intent="I want to keep progressing through my day.",
                    )
                )

        return tick_plans

    def generate_tick_intent(
        self,
        persona: Persona,
        priority_needs: list[NeedState],
        current_tick: int,
        recent_events: list[str],
    ) -> list[str]:
        candidate_actions: list[str] = []
        for need in priority_needs[:3]:
            for action in get_actions_for_need(need.category):
                if action.action_id not in candidate_actions:
                    candidate_actions.append(action.action_id)

        if not candidate_actions:
            return [ACTION_CATALOG[0].action_id]

        top_needs_text = ", ".join(
            f"{item.category.value}:{item.urgency:.2f}" for item in priority_needs[:3]
        )
        recent_text = " | ".join(recent_events[-3:]) if recent_events else "None"
        time_of_day = self._time_of_day_for_tick(current_tick)

        system_prompt = persona.to_system_prompt()
        user_message = f"""
Current tick: {current_tick} ({time_of_day})
Priority needs: {top_needs_text}
Recent events: {recent_text}
Candidate actions: {candidate_actions}

Pick the best 1-2 action_ids to attempt now.
Return only those IDs in the schema.
""".strip()
        schema = {"action_ids": ["action_id_1", "action_id_2"]}

        try:
            parsed = self.llm_client.complete_structured(
                system_prompt=system_prompt,
                user_message=user_message,
                output_schema=schema,
                use_fast_model=True,
                temperature=0.2,
            )
            raw_ids = parsed.get("action_ids", []) if isinstance(parsed, dict) else []
            cleaned = [item for item in self._sanitize_action_ids(raw_ids) if item in candidate_actions]
            if cleaned:
                return cleaned[:2]
        except Exception:
            pass

        return candidate_actions[:2]

    def build_plan(self, persona: Persona, actions: List[ActionIntent], tick: int) -> List[ActionIntent]:
        """Compatibility wrapper for current scaffolded engine path."""
        _ = persona
        if actions:
            return actions[:2]
        fallback_action = ACTION_CATALOG[tick % len(ACTION_CATALOG)].action_id
        return [
            ActionIntent(
                action_id=fallback_action,
                need="routine",
                intent="Follow a basic routine",
                tags=["fallback"],
            )
        ]

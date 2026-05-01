"""Main orchestrator for Environment-Interaction Life Simulation (EILS)."""

from __future__ import annotations

import calendar
from typing import Any, Optional

from pydantic import BaseModel, Field

from .compatibility import RoommateCompatibilityAgent
from .environment import EnvironmentEngine, Property
from .llm_client import UnifiedLLMClient
from .memory import MemoryStream
from .persona import Persona
from .action_catalog import Action, ActionOutcomeType, get_action_by_id, get_actions_for_need
from .daily_planner import DailyPlanner
from .environment_resolver import EnvironmentResolver
from .event_narrator import EventNarrator
from .need_engine import NeedEngine
from .satisfaction_tracker import SatisfactionTracker


class LifeSimRequest(BaseModel):
    mode: str
    persona_a: dict
    persona_b: Optional[dict] = None
    property_data: dict
    user_attributes: dict
    noise_assessment: Optional[dict] = None
    neighborhood_profile: dict | None = None
    thermal_report: dict | None = None
    simulation_month: int | None = Field(default=None, ge=1, le=12)
    commute_destination: str | None = None
    num_ticks: int = Field(default=24, ge=1, le=168)
    use_daily_plan: bool = True


class LifeSimEngine:
    """Orchestrates EILS in solo and cohabitation modes."""

    def __init__(self, llm_client: UnifiedLLMClient) -> None:
        self.need_engine_cls = NeedEngine
        self.resolver = EnvironmentResolver()
        self.planner = DailyPlanner(llm_client)
        self.narrator = EventNarrator(llm_client)
        self.llm_client = llm_client

    @staticmethod
    def _should_skip_action(
        action: Action,
        env_state,
        tick: int,
        recent_action_ticks: dict[str, int],
    ) -> bool:
        if action.action_id == "use_elevator" and not bool(env_state.has_elevator):
            return True

        hot_actions = {"suffer_from_heat", "turn_on_fan", "open_window_ventilation"}
        cold_actions = {"layer_up_for_cold", "turn_on_heating"}
        thermal_state = str(getattr(env_state, "thermal_state", "comfortable")).lower()

        if action.action_id in hot_actions and thermal_state == "cold":
            return True
        if action.action_id in cold_actions and thermal_state == "hot":
            return True

        thermal_coping_actions = {"suffer_from_heat", "layer_up_for_cold"}
        if action.action_id in thermal_coping_actions:
            opposite = (
                "layer_up_for_cold"
                if action.action_id == "suffer_from_heat"
                else "suffer_from_heat"
            )
            latest_tick = max(
                recent_action_ticks.get(action.action_id, -999),
                recent_action_ticks.get(opposite, -999),
            )
            if tick - latest_tick < 3:
                return True

        return False

    def _find_fallback_action(
        self,
        skipped_action: Action,
        env_state,
        persona: Persona,
        tick: int,
        recent_action_ticks: dict[str, int],
    ) -> Action | None:
        for candidate in get_actions_for_need(skipped_action.need_fulfilled):
            if candidate.action_id == skipped_action.action_id:
                continue
            if self._should_skip_action(candidate, env_state, tick, recent_action_ticks):
                continue

            trial_outcome = self.resolver.resolve(
                action=candidate,
                env_state=env_state,
                persona=persona,
            )
            if trial_outcome.outcome_type in {
                ActionOutcomeType.SUCCESS,
                ActionOutcomeType.SUCCESS_WITH_FRICTION,
                ActionOutcomeType.PARTIAL,
            }:
                return candidate
        return None

    def _prepare_intended_actions(
        self,
        intended_action_ids: list[str],
        env_state,
        persona: Persona,
        tick: int,
        recent_action_ticks: dict[str, int],
    ) -> list[str]:
        prepared: list[str] = []

        for action_id in intended_action_ids:
            action = get_action_by_id(action_id)
            if action is None:
                continue

            if self._should_skip_action(action, env_state, tick, recent_action_ticks):
                fallback = self._find_fallback_action(
                    skipped_action=action,
                    env_state=env_state,
                    persona=persona,
                    tick=tick,
                    recent_action_ticks=recent_action_ticks,
                )
                if fallback and fallback.action_id not in prepared:
                    prepared.append(fallback.action_id)
                continue

            if action_id not in prepared:
                prepared.append(action_id)

            if len(prepared) >= 2:
                break

        return prepared[:2]

    def simulate_solo(
        self,
        request: LifeSimRequest,
        progress_callback=None,
    ) -> dict:
        persona = Persona.from_dict(request.persona_a)
        property_obj = Property(**request.property_data)
        neighborhood = None
        if request.neighborhood_profile:
            from social_sim.neighborhood.neighborhood_profile import NeighborhoodProfile

            neighborhood = NeighborhoodProfile(**request.neighborhood_profile)

        env_state = EnvironmentResolver.build_from_property(
            property=property_obj,
            noise_assessment=request.noise_assessment,
            user_attributes=request.user_attributes,
            neighborhood=neighborhood,
            thermal_report=request.thermal_report,
        )

        if request.simulation_month:
            env_state.month_of_simulation = request.simulation_month
            if request.thermal_report:
                month_temps = request.thermal_report.get("monthly_indoor_temps", {}) or {}
                indoor_temp = month_temps.get(
                    str(request.simulation_month),
                    month_temps.get(request.simulation_month, env_state.indoor_temp_celsius),
                )
                env_state.indoor_temp_celsius = float(indoor_temp)

                if env_state.indoor_temp_celsius > 28:
                    env_state.thermal_state = "hot"
                elif env_state.indoor_temp_celsius < 16:
                    env_state.thermal_state = "cold"
                else:
                    env_state.thermal_state = "comfortable"

                env_state.too_hot_for_comfort = env_state.indoor_temp_celsius > 28
                env_state.heat_stress_active = env_state.indoor_temp_celsius > 32
                env_state.dangerously_cold = env_state.indoor_temp_celsius < 12
                env_state.not_too_hot_for_comfort = not env_state.too_hot_for_comfort
                env_state.not_dangerously_cold = not env_state.dangerously_cold

        need_engine = self.need_engine_cls(persona)
        tracker = SatisfactionTracker(initial_score=0.75)
        memory = MemoryStream(persona.subject_id, self.llm_client)

        daily_plan = None
        if request.use_daily_plan:
            daily_plan = self.planner.generate_daily_plan(
                persona=persona,
                env_state=env_state,
                day_number=1,
            )

        all_narrated_events = []
        fulfilled_needs = []
        recent_action_ticks: dict[str, int] = {}

        for tick in range(request.num_ticks):
            hour = (6 + tick) % 24
            time_of_day = f"{hour:02d}:00"

            need_states = need_engine.tick(
                current_tick=tick,
                fulfilled_needs=fulfilled_needs,
                env_state=env_state,
            )
            priority_needs = need_engine.get_priority_needs(need_states, top_k=2)
            fulfilled_needs = []

            if daily_plan and tick < len(daily_plan):
                tick_plan = daily_plan[tick]
                intended_action_ids = tick_plan.intended_actions
            else:
                recent_events = [event.narrative for event in all_narrated_events[-3:]]
                intended_action_ids = self.planner.generate_tick_intent(
                    persona=persona,
                    priority_needs=priority_needs,
                    current_tick=tick,
                    recent_events=recent_events,
                )

            action_ids_to_attempt = self._prepare_intended_actions(
                intended_action_ids=intended_action_ids,
                env_state=env_state,
                persona=persona,
                tick=tick,
                recent_action_ticks=recent_action_ticks,
            )

            for action_id in action_ids_to_attempt:
                action = get_action_by_id(action_id)
                if action is None:
                    continue

                outcome = self.resolver.resolve(
                    action=action,
                    env_state=env_state,
                    persona=persona,
                )
                recent_action_ticks[action.action_id] = tick

                narrated = self.narrator.narrate_batch_fast(
                    outcomes=[outcome],
                    persona=persona,
                    tick=tick,
                    time_of_day=time_of_day,
                )[0]
                all_narrated_events.append(narrated)

                tracker.record(
                    tick=tick,
                    time_of_day=time_of_day,
                    narrated_event=narrated,
                )

                if abs(narrated.satisfaction_delta) > 0.05:
                    memory.add_memory(
                        content=narrated.memory_content,
                        simulation_time=float(tick),
                        tags=[
                            outcome.outcome_type.value,
                            action.need_fulfilled.value,
                        ],
                    )

                if outcome.outcome_type in [
                    ActionOutcomeType.SUCCESS,
                    ActionOutcomeType.SUCCESS_WITH_FRICTION,
                ]:
                    fulfilled_needs.append(action.need_fulfilled)

            if progress_callback:
                progress_callback(
                    int(tick / request.num_ticks * 100),
                    f"Simulating {time_of_day}...",
                )

        try:
            reflection = memory.reflect(float(request.num_ticks))
        except Exception:
            reflection = (
                "Reflection is temporarily unavailable because the language model or memory "
                "service did not respond."
            )

        summary = tracker.get_summary()
        pain_points = tracker.get_top_pain_points()

        return {
            "mode": "solo",
            "subject_id": persona.subject_id,
            "persona_name": persona.name,
            "property_id": property_obj.property_id,
            "num_ticks": request.num_ticks,
            "satisfaction_summary": summary,
            "pain_points": pain_points,
            "events": [event.model_dump() for event in all_narrated_events],
            "reflection": reflection,
            "env_state": env_state.model_dump(),
            "persistent_blocks": tracker.persistent_blocks,
            "flags": tracker.flags,
        }

    def simulate_cohabitation(
        self,
        request: LifeSimRequest,
        progress_callback=None,
    ) -> dict:
        if request.persona_b is None:
            raise ValueError("persona_b is required for cohabitation mode.")

        persona_a = Persona.from_dict(request.persona_a)
        persona_b = Persona.from_dict(request.persona_b)
        property_obj = Property(**request.property_data)

        solo_req_a = request.model_copy(update={"mode": "solo", "persona_a": persona_a.to_dict()})
        solo_req_b = request.model_copy(update={"mode": "solo", "persona_a": persona_b.to_dict()})

        solo_result_a = self.simulate_solo(solo_req_a, progress_callback=progress_callback)
        solo_result_b = self.simulate_solo(solo_req_b, progress_callback=progress_callback)

        compat_agent = RoommateCompatibilityAgent(
            persona_a=persona_a,
            persona_b=persona_b,
            property=property_obj,
            llm_client=self.llm_client,
        )
        compat_result = compat_agent.run_cohabitation_simulation(
            num_ticks=min(request.num_ticks, 12),
            progress_callback=progress_callback,
        )

        combined_score = self._combine_scores(
            solo_result_a,
            solo_result_b,
            compat_result,
        )

        return {
            "mode": "cohabitation",
            "persona_a_solo": solo_result_a,
            "persona_b_solo": solo_result_b,
            "roommate_compatibility": compat_result,
            "combined_score": combined_score,
            "overall_recommendation": self._recommendation(
                solo_result_a,
                solo_result_b,
                compat_result,
            ),
        }

    def _combine_scores(self, solo_a: dict, solo_b: dict, compat_result: dict) -> float:
        solo_a_score = float(solo_a["satisfaction_summary"]["final_score"])
        solo_b_score = float(solo_b["satisfaction_summary"]["final_score"])
        compat_score = float(compat_result.get("compatibility_score", 0.5))
        return (0.35 * solo_a_score) + (0.35 * solo_b_score) + (0.30 * compat_score)

    def _recommendation(self, solo_a: dict, solo_b: dict, compat_result: dict) -> str:
        combined = self._combine_scores(solo_a, solo_b, compat_result)
        if combined >= 0.75:
            return "Strongly Recommended"
        if combined >= 0.60:
            return "Recommended"
        if combined >= 0.45:
            return "Acceptable with Conditions"
        if combined >= 0.30:
            return "Not Recommended"
        return "Strongly Not Recommended"

    def run(self, request: LifeSimRequest, progress_callback=None) -> dict:
        if request.mode == "solo":
            return self.simulate_solo(request, progress_callback=progress_callback)
        if request.mode == "cohabitation":
            return self.simulate_cohabitation(request, progress_callback=progress_callback)
        raise ValueError(f"Unknown mode: {request.mode}")


if __name__ == "__main__":
    llm_client = UnifiedLLMClient()
    engine = LifeSimEngine(llm_client=llm_client)

    persona = Persona.from_traits(
        subject_id="solo_test_001",
        name="Cold Early Riser",
        traits={
            "introversion": 0.6,
            "noise_sensitivity": 0.8,
            "cleanliness": 0.7,
            "thermal_sensitivity": 0.95,
            "early_riser": True,
            "smoker": False,
        },
    )

    from social_sim.thermal.thermal_report import ThermalReportBuilder

    thermal_builder = ThermalReportBuilder()
    thermal_report = thermal_builder.build(
        lat=36.8065,
        lon=10.1815,
        address="Avenue Habib Bourguiba, Tunis",
        floor_number=5,
        orientation="south",
        building_mass="heavy",
        building_condition="good",
        has_cooling=False,
        has_heating=False,
        has_balcony=True,
        has_windows=True,
    ).model_dump()

    july_temp = (thermal_report.get("monthly_indoor_temps", {}) or {}).get(
        7,
        (thermal_report.get("monthly_indoor_temps", {}) or {}).get("7"),
    )
    print("July indoor temp estimate:", july_temp)

    env_engine = EnvironmentEngine()

    property_obj = env_engine.create_mock_property(
        property_type="2br",
        noise_level=0.7,
        temperature=0.2,
        smoking_allowed=False,
    )
    property_obj.floor = 4
    property_obj.has_elevator = False

    env_state_test = EnvironmentResolver.build_from_property(
        property=property_obj,
        noise_assessment={"noise_level": 0.7},
        user_attributes={"simulation_month": 7, "has_heating": False, "has_elevator": False},
        thermal_report=thermal_report,
    )
    print("July thermal state test ->", env_state_test.indoor_temp_celsius, "°C")
    assert env_state_test.too_hot_for_comfort is True

    request = LifeSimRequest(
        mode="solo",
        persona_a=persona.to_dict(),
        property_data=property_obj.model_dump(),
        thermal_report=thermal_report,
        simulation_month=7,
        commute_destination="Université de Tunis",
        user_attributes={
            "has_heating": False,
            "has_elevator": False,
            "floor_number": 4,
            "bus_stop_nearby": False,
            "simulation_month": 7,
        },
        noise_assessment={"noise_level": 0.7},
        num_ticks=4,
        use_daily_plan=False,
    )

    result = engine.simulate_solo(request)
    summary = result["satisfaction_summary"]

    print("Final satisfaction:", summary["final_score"])

    sim_month = request.simulation_month or 7
    print("Simulation month:", calendar.month_name[sim_month])
    print("Thermal-related actions attempted and outcomes:")
    for event in result["events"]:
        need_label = str(event.get("need", "")).lower()
        action_name = str(event.get("action_name", ""))
        if "thermal" in need_label or any(
            marker in action_name.lower() for marker in ["heat", "fan", "cold", "window", "heating"]
        ):
            print(f"- {action_name}: {event.get('outcome_type')} | {event.get('summary')}")

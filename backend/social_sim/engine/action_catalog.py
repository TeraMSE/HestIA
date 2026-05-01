"""Action catalog for daily life intents in EILS."""

from __future__ import annotations

from enum import Enum
from typing import List

from pydantic import BaseModel, Field

from .need_engine import NeedCategory, NeedState


class ActionOutcomeType(str, Enum):
    SUCCESS = "success"
    SUCCESS_WITH_FRICTION = "success_with_friction"
    PARTIAL = "partial_success"
    BLOCKED = "blocked"
    NOT_ATTEMPTED = "not_attempted"


class Action(BaseModel):
    action_id: str
    name: str
    need_fulfilled: NeedCategory
    satisfaction_delta_success: float
    satisfaction_delta_friction: float
    satisfaction_delta_blocked: float
    environment_checks: list[str] = Field(default_factory=list)
    personality_prerequisite: dict = Field(default_factory=dict)


class ActionIntent(BaseModel):
    action_id: str
    need: str
    intent: str
    tags: List[str] = Field(default_factory=list)


ACTION_CATALOG: list[Action] = [
    Action(
        action_id="turn_on_heating",
        name="Turn on heating",
        need_fulfilled=NeedCategory.THERMAL_COMFORT,
        satisfaction_delta_success=+0.10,
        satisfaction_delta_friction=+0.03,
        satisfaction_delta_blocked=-0.12,
        environment_checks=["has_heating"],
        personality_prerequisite={"thermal_sensitivity": ">0.5"},
    ),
    Action(
        action_id="open_window_ventilation",
        name="Open window for air",
        need_fulfilled=NeedCategory.THERMAL_COMFORT,
        satisfaction_delta_success=+0.05,
        satisfaction_delta_friction=+0.02,
        satisfaction_delta_blocked=-0.04,
        environment_checks=["has_windows"],
        personality_prerequisite={},
    ),
    Action(
        action_id="turn_on_fan",
        name="Turn on fan to cool down",
        need_fulfilled=NeedCategory.THERMAL_COMFORT,
        satisfaction_delta_success=+0.06,
        satisfaction_delta_friction=+0.02,
        satisfaction_delta_blocked=-0.08,
        environment_checks=["has_electricity"],
        personality_prerequisite={"thermal_sensitivity": ">0.3"},
    ),
    Action(
        action_id="suffer_from_heat",
        name="Struggle with heat (no cooling)",
        need_fulfilled=NeedCategory.THERMAL_COMFORT,
        satisfaction_delta_success=0.0,
        satisfaction_delta_friction=-0.08,
        satisfaction_delta_blocked=-0.15,
        environment_checks=["not_too_hot_for_comfort"],
        personality_prerequisite={},
    ),
    Action(
        action_id="layer_up_for_cold",
        name="Put on extra layers (no heating)",
        need_fulfilled=NeedCategory.THERMAL_COMFORT,
        satisfaction_delta_success=+0.04,
        satisfaction_delta_friction=+0.01,
        satisfaction_delta_blocked=-0.10,
        environment_checks=["not_dangerously_cold"],
        personality_prerequisite={},
    ),
    Action(
        action_id="seek_quiet_room",
        name="Move to a quiet room",
        need_fulfilled=NeedCategory.ACOUSTIC_COMFORT,
        satisfaction_delta_success=+0.08,
        satisfaction_delta_friction=+0.02,
        satisfaction_delta_blocked=-0.10,
        environment_checks=["has_private_room", "room_noise_below_0.4"],
        personality_prerequisite={"noise_sensitivity": ">0.5"},
    ),
    Action(
        action_id="tolerate_noise",
        name="Try to focus despite noise",
        need_fulfilled=NeedCategory.ACOUSTIC_COMFORT,
        satisfaction_delta_success=+0.02,
        satisfaction_delta_friction=-0.05,
        satisfaction_delta_blocked=-0.09,
        environment_checks=[],
        personality_prerequisite={},
    ),
    Action(
        action_id="take_bus_university",
        name="Take bus to university",
        need_fulfilled=NeedCategory.MOBILITY,
        satisfaction_delta_success=+0.10,
        satisfaction_delta_friction=+0.03,
        satisfaction_delta_blocked=-0.15,
        environment_checks=["bus_stop_nearby"],
        personality_prerequisite={"early_riser": "true"},
    ),
    Action(
        action_id="take_bus_general",
        name="Take public transport",
        need_fulfilled=NeedCategory.MOBILITY,
        satisfaction_delta_success=+0.08,
        satisfaction_delta_friction=+0.02,
        satisfaction_delta_blocked=-0.12,
        environment_checks=["bus_stop_nearby"],
        personality_prerequisite={},
    ),
    Action(
        action_id="use_elevator",
        name="Use elevator to carry groceries/bags",
        need_fulfilled=NeedCategory.MOBILITY,
        satisfaction_delta_success=+0.06,
        satisfaction_delta_friction=0.0,
        satisfaction_delta_blocked=-0.06,
        environment_checks=["has_elevator"],
        personality_prerequisite={},
    ),
    Action(
        action_id="walk_to_destination",
        name="Walk to nearby destination",
        need_fulfilled=NeedCategory.MOBILITY,
        satisfaction_delta_success=+0.04,
        satisfaction_delta_friction=-0.02,
        satisfaction_delta_blocked=-0.08,
        environment_checks=["walkable_area"],
        personality_prerequisite={},
    ),
    Action(
        action_id="cook_at_home",
        name="Cook a meal at home",
        need_fulfilled=NeedCategory.NOURISHMENT,
        satisfaction_delta_success=+0.08,
        satisfaction_delta_friction=+0.02,
        satisfaction_delta_blocked=-0.10,
        environment_checks=["has_kitchen"],
        personality_prerequisite={},
    ),
    Action(
        action_id="go_to_cafe",
        name="Go to a nearby café",
        need_fulfilled=NeedCategory.NOURISHMENT,
        satisfaction_delta_success=+0.10,
        satisfaction_delta_friction=+0.01,
        satisfaction_delta_blocked=-0.08,
        environment_checks=["cafe_nearby"],
        personality_prerequisite={"introversion": "<0.8"},
    ),
    Action(
        action_id="go_to_restaurant",
        name="Go to a restaurant for dinner",
        need_fulfilled=NeedCategory.NOURISHMENT,
        satisfaction_delta_success=+0.10,
        satisfaction_delta_friction=+0.01,
        satisfaction_delta_blocked=-0.07,
        environment_checks=["restaurant_nearby"],
        personality_prerequisite={},
    ),
    Action(
        action_id="go_to_pharmacy_urgent",
        name="Get medication from pharmacy urgently",
        need_fulfilled=NeedCategory.MOBILITY,
        satisfaction_delta_success=+0.15,
        satisfaction_delta_friction=+0.05,
        satisfaction_delta_blocked=-0.20,
        environment_checks=["pharmacy_accessible"],
        personality_prerequisite={},
    ),
    Action(
        action_id="go_to_hospital",
        name="Go to hospital when sick",
        need_fulfilled=NeedCategory.MOBILITY,
        satisfaction_delta_success=+0.20,
        satisfaction_delta_friction=+0.08,
        satisfaction_delta_blocked=-0.25,
        environment_checks=["hospital_accessible"],
        personality_prerequisite={},
    ),
    Action(
        action_id="commute_to_work_uni",
        name="Commute to work/university",
        need_fulfilled=NeedCategory.ROUTINE,
        satisfaction_delta_success=+0.12,
        satisfaction_delta_friction=+0.04,
        satisfaction_delta_blocked=-0.18,
        environment_checks=["commute_feasible", "bus_stop_nearby"],
        personality_prerequisite={},
    ),
    Action(
        action_id="get_groceries",
        name="Do grocery shopping",
        need_fulfilled=NeedCategory.NOURISHMENT,
        satisfaction_delta_success=+0.10,
        satisfaction_delta_friction=+0.02,
        satisfaction_delta_blocked=-0.12,
        environment_checks=["supermarket_accessible"],
        personality_prerequisite={},
    ),
    Action(
        action_id="go_to_park",
        name="Walk to nearby park for exercise",
        need_fulfilled=NeedCategory.SOCIAL,
        satisfaction_delta_success=+0.08,
        satisfaction_delta_friction=+0.02,
        satisfaction_delta_blocked=-0.05,
        environment_checks=["walkable_area"],
        personality_prerequisite={"introversion": "<0.8"},
    ),
    Action(
        action_id="invite_friends_over",
        name="Invite friends over",
        need_fulfilled=NeedCategory.SOCIAL,
        satisfaction_delta_success=+0.12,
        satisfaction_delta_friction=+0.05,
        satisfaction_delta_blocked=-0.06,
        environment_checks=["has_living_space"],
        personality_prerequisite={"introversion": "<0.5"},
    ),
    Action(
        action_id="go_out_socially",
        name="Go out to meet people",
        need_fulfilled=NeedCategory.SOCIAL,
        satisfaction_delta_success=+0.10,
        satisfaction_delta_friction=+0.02,
        satisfaction_delta_blocked=-0.08,
        environment_checks=["social_venues_nearby"],
        personality_prerequisite={"introversion": "<0.6"},
    ),
    Action(
        action_id="sleep_properly",
        name="Get a full night of sleep",
        need_fulfilled=NeedCategory.REST,
        satisfaction_delta_success=+0.12,
        satisfaction_delta_friction=+0.03,
        satisfaction_delta_blocked=-0.14,
        environment_checks=["room_noise_below_0.5", "has_bedroom"],
        personality_prerequisite={},
    ),
    Action(
        action_id="nap_afternoon",
        name="Take an afternoon nap",
        need_fulfilled=NeedCategory.REST,
        satisfaction_delta_success=+0.06,
        satisfaction_delta_friction=+0.01,
        satisfaction_delta_blocked=-0.07,
        environment_checks=["room_noise_below_0.6", "has_bedroom"],
        personality_prerequisite={},
    ),
    Action(
        action_id="morning_routine_quiet",
        name="Complete morning routine in quiet",
        need_fulfilled=NeedCategory.ROUTINE,
        satisfaction_delta_success=+0.08,
        satisfaction_delta_friction=+0.02,
        satisfaction_delta_blocked=-0.09,
        environment_checks=["morning_quiet"],
        personality_prerequisite={"early_riser": "true"},
    ),
    Action(
        action_id="have_private_time",
        name="Have private time in own space",
        need_fulfilled=NeedCategory.SPACE,
        satisfaction_delta_success=+0.10,
        satisfaction_delta_friction=+0.03,
        satisfaction_delta_blocked=-0.11,
        environment_checks=["has_private_room"],
        personality_prerequisite={"introversion": ">0.5"},
    ),
    Action(
        action_id="clean_shared_spaces",
        name="Clean shared spaces",
        need_fulfilled=NeedCategory.CLEANLINESS,
        satisfaction_delta_success=+0.08,
        satisfaction_delta_friction=+0.02,
        satisfaction_delta_blocked=-0.06,
        environment_checks=["has_cleaning_supplies"],
        personality_prerequisite={"cleanliness": ">0.5"},
    ),
]


def get_actions_for_need(need: NeedCategory) -> list[Action]:
    return [action for action in ACTION_CATALOG if action.need_fulfilled == need]


def get_action_by_id(action_id: str) -> Action | None:
    for action in ACTION_CATALOG:
        if action.action_id == action_id:
            return action
    return None


class ActionCatalog:
    """Catalog accessor + compatibility proposal helper."""

    def propose_actions(self, needs: List[NeedState]) -> List[ActionIntent]:
        actions: List[ActionIntent] = []
        for idx, need_state in enumerate(needs):
            candidates = get_actions_for_need(need_state.category)
            if not candidates:
                continue
            chosen = candidates[0]
            actions.append(
                ActionIntent(
                    action_id=chosen.action_id,
                    need=need_state.category.value,
                    intent=chosen.name,
                    tags=["catalog", f"priority_{idx+1}"],
                )
            )
        return actions

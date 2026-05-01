"""Resolve intended actions against apartment/neighborhood constraints."""

from __future__ import annotations

from datetime import datetime
import re
from typing import Any, Dict, TYPE_CHECKING

from pydantic import BaseModel

from .environment import Property
from .persona import Persona
from .action_catalog import Action, ActionOutcomeType, get_action_by_id

if TYPE_CHECKING:
    from social_sim.neighborhood.neighborhood_profile import NeighborhoodProfile


class EnvironmentState(BaseModel):
    has_heating: bool
    has_elevator: bool
    has_kitchen: bool
    has_bedroom: bool
    has_living_space: bool
    has_private_room: bool
    has_windows: bool
    has_cleaning_supplies: bool
    floor_number: int
    has_internet: bool
    has_parking: bool
    has_storage: bool
    has_security: bool
    furnished: bool
    has_balcony: bool
    building_age_years: int | None
    internet_type: str
    building_condition: str

    noise_level: float
    natural_light: float
    morning_quiet: bool
    room_noise_below_0_4: bool
    room_noise_below_0_5: bool
    room_noise_below_0_6: bool
    natural_light_good: bool
    building_condition_good: bool
    commute_feasible: bool | None = None
    hospital_accessible: bool
    supermarket_accessible: bool
    pharmacy_accessible: bool = False

    bus_stop_nearby: bool
    cafe_nearby: bool
    restaurant_nearby: bool
    social_venues_nearby: bool
    walkable_area: bool
    walk_time_hospital: float | None = None
    walk_time_supermarket: float | None = None
    walk_time_cafe: float | None = None
    walk_time_pharmacy: float | None = None
    transit_lines: int = 0
    walkability_score: float = 0.5

    has_transport: bool
    has_electricity: bool

    indoor_temp_celsius: float = 22.0
    thermal_state: str = "comfortable"
    month_of_simulation: int | None = None
    too_hot_for_comfort: bool = False
    dangerously_cold: bool = False
    heat_stress_active: bool = False
    not_too_hot_for_comfort: bool = True
    not_dangerously_cold: bool = True


class ActionOutcome(BaseModel):
    action: Action
    outcome_type: ActionOutcomeType
    satisfaction_delta: float
    blocking_reason: str = ""
    friction_reason: str = ""
    environment_values: dict
    narrative_hint: str


class EnvironmentResolver:
    """Deterministic action resolver for EILS."""

    @staticmethod
    def build_from_property(
        property: Property,
        noise_assessment: dict | None = None,
        user_attributes: dict | None = None,
        neighborhood: "NeighborhoodProfile" | None = None,
        thermal_report: dict | None = None,
    ) -> EnvironmentState:
        user_attributes = user_attributes or {}
        noise_assessment = noise_assessment or {}

        rooms = property.rooms or []
        room_names = [room.name.lower() for room in rooms]

        has_bedroom = any("bedroom" in name for name in room_names)
        has_kitchen = any("kitchen" in name for name in room_names)
        has_living_space = any(bool(room.properties.get("shared", False)) for room in rooms)
        has_private_room = any(not bool(room.properties.get("shared", True)) for room in rooms)

        property_noise = float(getattr(property, "neighborhood_noise", 0.5))
        assessed_noise = noise_assessment.get("noise_level")
        noise_level = (
            float(assessed_noise)
            if assessed_noise is not None
            else property_noise
        )
        noise_level = max(0.0, min(1.0, noise_level))

        top_sources = [str(item).lower() for item in (noise_assessment.get("top_sources") or [])]
        breakdown = noise_assessment.get("breakdown") or {}
        feature_count = int(noise_assessment.get("feature_count", 0) or 0)

        room_natural_light = [
            float(room.properties.get("natural_light", 0.5))
            for room in rooms
            if room.properties.get("natural_light") is not None
        ]
        inferred_natural_light = (
            sum(room_natural_light) / len(room_natural_light)
            if room_natural_light
            else 0.5
        )

        commute_candidates = [
            user_attributes.get("commute_transit_time"),
            user_attributes.get("commute_walk_time"),
            getattr(property, "commute_transit_time", None),
            getattr(property, "commute_walk_time", None),
        ]
        commute_candidates = [
            float(value) for value in commute_candidates if value is not None
        ]
        commute_time = min(commute_candidates) if commute_candidates else None

        hospital_walk_time = user_attributes.get(
            "walk_time_to_nearest_hospital",
            getattr(property, "walk_time_to_nearest_hospital", None),
        )
        pharmacy_walk_time = user_attributes.get(
            "walk_time_to_nearest_pharmacy",
            getattr(property, "walk_time_to_nearest_pharmacy", None),
        )
        cafe_walk_time = user_attributes.get(
            "walk_time_to_nearest_cafe",
            getattr(property, "walk_time_to_nearest_cafe", None),
        )
        supermarket_walk_time = user_attributes.get(
            "walk_time_to_nearest_supermarket",
            getattr(property, "walk_time_to_nearest_supermarket", None),
        )

        property_condition = str(getattr(property, "building_condition", "unknown") or "unknown").lower().strip()

        bus_stop_nearby = (
            int((breakdown.get("railway") or {}).get("count", 0)) > 0
            or int((breakdown.get("public_transport") or {}).get("count", 0)) > 0
            or (getattr(property, "walk_time_to_nearest_bus_stop", None) is not None and float(getattr(property, "walk_time_to_nearest_bus_stop", 999.0)) <= 10.0)
            or any("tram" in src or "station" in src for src in top_sources)
        )
        cafe_nearby = (
            any("cafe" in src for src in top_sources)
            or (getattr(property, "walk_time_to_nearest_cafe", None) is not None and float(getattr(property, "walk_time_to_nearest_cafe", 999.0)) <= 12.0)
            or (int((breakdown.get("amenity") or {}).get("count", 0)) > 0 and feature_count > 3)
        )
        restaurant_nearby = (
            any("restaurant" in src for src in top_sources)
            or (getattr(property, "walk_time_to_nearest_restaurant", None) is not None and float(getattr(property, "walk_time_to_nearest_restaurant", 999.0)) <= 12.0)
        )
        social_venues_nearby = any(
            any(keyword in src for keyword in ["bar", "pub", "nightclub", "cafe"])
            for src in top_sources
        )
        walkable_area = (
            "pedestrian" in breakdown
            or any("pedestrian" in src for src in top_sources)
            or int((breakdown.get("highway") or {}).get("count", 0)) > 0
        )

        base = {
            "has_heating": True,
            "has_elevator": bool(getattr(property, "has_elevator", False)),
            "has_kitchen": has_kitchen,
            "has_bedroom": has_bedroom,
            "has_living_space": has_living_space,
            "has_private_room": has_private_room,
            "has_windows": True,
            "has_cleaning_supplies": True,
            "floor_number": int(getattr(property, "floor", 1)),
            "has_internet": bool(getattr(property, "has_internet", True)),
            "has_parking": bool(getattr(property, "has_parking", False)),
            "has_storage": bool(getattr(property, "has_storage", False)),
            "has_security": bool(getattr(property, "has_security", False)),
            "furnished": bool(getattr(property, "furnished", False)),
            "has_balcony": any(bool(room.properties.get("has_balcony", False)) for room in rooms),
            "building_age_years": getattr(property, "building_age_years", None),
            "internet_type": str(getattr(property, "internet_type", "unknown") or "unknown").lower().strip(),
            "building_condition": property_condition,
            "noise_level": noise_level,
            "natural_light": inferred_natural_light,
            "bus_stop_nearby": bus_stop_nearby,
            "cafe_nearby": cafe_nearby,
            "restaurant_nearby": restaurant_nearby,
            "social_venues_nearby": social_venues_nearby,
            "walkable_area": walkable_area,
            "building_condition_good": property_condition in {"new", "good"},
            "commute_feasible": bool(commute_time is not None and commute_time < 45.0),
            "hospital_accessible": bool(hospital_walk_time is not None and float(hospital_walk_time) < 20.0),
            "supermarket_accessible": bool(supermarket_walk_time is not None and float(supermarket_walk_time) < 15.0),
            "pharmacy_accessible": bool(pharmacy_walk_time is not None and float(pharmacy_walk_time) < 10.0),
            "walk_time_hospital": float(hospital_walk_time) if hospital_walk_time is not None else None,
            "walk_time_supermarket": float(supermarket_walk_time) if supermarket_walk_time is not None else None,
            "walk_time_cafe": float(cafe_walk_time) if cafe_walk_time is not None else None,
            "walk_time_pharmacy": float(pharmacy_walk_time) if pharmacy_walk_time is not None else None,
            "transit_lines": int(user_attributes.get("transit_lines_within_400m", getattr(property, "transit_lines_within_400m", 0)) or 0),
            "walkability_score": float(user_attributes.get("walkability_score", getattr(property, "walkability_score", 0.5) or 0.5)),
            "has_electricity": bool(getattr(property, "has_internet", True)),
        }

        for key, value in user_attributes.items():
            if key in base:
                base[key] = value

        internet_type = str(
            user_attributes.get("internet_type", getattr(property, "internet_type", "unknown"))
        ).lower().strip()
        base["internet_type"] = internet_type
        if internet_type == "none":
            base["has_internet"] = False
        base["has_electricity"] = bool(base["has_internet"])

        condition_value = str(
            user_attributes.get("building_condition", getattr(property, "building_condition", "unknown"))
        ).lower().strip()
        base["building_condition"] = condition_value
        base["building_condition_good"] = condition_value in {"new", "good"}

        if neighborhood is not None:
            neighborhood_transport = neighborhood.transport or {}
            nearest_stop = neighborhood_transport.get("nearest_stop") or None
            neighborhood_walk_times = neighborhood.walk_times or {}

            base["bus_stop_nearby"] = bool(
                nearest_stop is not None and float(nearest_stop.get("distance_m", 999.0)) < 400.0
            )
            base["cafe_nearby"] = bool(float(neighborhood_walk_times.get("cafe", 999.0)) < 15.0)
            base["restaurant_nearby"] = bool(float(neighborhood_walk_times.get("restaurant", 999.0)) < 20.0)
            base["hospital_accessible"] = bool(float(neighborhood_walk_times.get("hospital", 999.0)) < 25.0)
            base["supermarket_accessible"] = bool(float(neighborhood_walk_times.get("supermarket", 999.0)) < 15.0)
            base["pharmacy_accessible"] = bool(float(neighborhood_walk_times.get("pharmacy", 999.0)) < 10.0)

            if neighborhood.commute:
                base["commute_feasible"] = bool(neighborhood.commute.get("walk_feasible"))
            else:
                base["commute_feasible"] = None

            base["walk_time_hospital"] = neighborhood_walk_times.get("hospital")
            base["walk_time_supermarket"] = neighborhood_walk_times.get("supermarket")
            base["walk_time_cafe"] = neighborhood_walk_times.get("cafe")
            base["walk_time_pharmacy"] = neighborhood_walk_times.get("pharmacy")
            base["transit_lines"] = int(neighborhood_transport.get("total_lines_count", 0) or 0)
            base["walkability_score"] = float((neighborhood.walkability or {}).get("overall_score", 0.5) or 0.5)

        base["noise_level"] = max(0.0, min(1.0, float(base["noise_level"])))
        base["natural_light"] = max(0.0, min(1.0, float(base.get("natural_light", inferred_natural_light))))
        base["walkability_score"] = max(0.0, min(1.0, float(base.get("walkability_score", 0.5))))
        base["morning_quiet"] = bool(base["noise_level"] < 0.3 and not base["social_venues_nearby"])
        base["room_noise_below_0_4"] = bool(base["noise_level"] < 0.4)
        base["room_noise_below_0_5"] = bool(base["noise_level"] < 0.5)
        base["room_noise_below_0_6"] = bool(base["noise_level"] < 0.6)
        base["natural_light_good"] = bool(base["natural_light"] > 0.6)
        base["has_transport"] = bool(base["bus_stop_nearby"] or int(base.get("transit_lines", 0)) > 0)

        if thermal_report:
            current_month = datetime.now().month
            month_temps = thermal_report.get("monthly_indoor_temps", {}) or {}
            sim_month = int(user_attributes.get("simulation_month", current_month))

            indoor_temp = month_temps.get(
                str(sim_month),
                month_temps.get(sim_month, thermal_report.get("current_month_temp", 22.0)),
            )
            indoor_temp = float(indoor_temp)

            base["month_of_simulation"] = sim_month
            base["indoor_temp_celsius"] = indoor_temp
            base["thermal_state"] = str(
                thermal_report.get("simulation_thermal_state", "comfortable")
            )
            base["too_hot_for_comfort"] = bool(indoor_temp > 28.0)
            base["heat_stress_active"] = bool(indoor_temp > 32.0)
            base["dangerously_cold"] = bool(indoor_temp < 12.0)
            base["not_too_hot_for_comfort"] = not bool(indoor_temp > 28.0)
            base["not_dangerously_cold"] = not bool(indoor_temp < 12.0)
        else:
            temp = float(user_attributes.get("temperature", 0.5))
            indoor_temp = 10.0 + (temp * 28.0)
            base["indoor_temp_celsius"] = indoor_temp
            base["thermal_state"] = (
                "hot"
                if indoor_temp > 28.0
                else "cold"
                if indoor_temp < 16.0
                else "comfortable"
            )
            base["too_hot_for_comfort"] = bool(indoor_temp > 28.0)
            base["heat_stress_active"] = bool(indoor_temp > 32.0)
            base["dangerously_cold"] = bool(indoor_temp < 12.0)
            base["not_too_hot_for_comfort"] = not bool(indoor_temp > 28.0)
            base["not_dangerously_cold"] = not bool(indoor_temp < 12.0)
            if user_attributes.get("simulation_month") is not None:
                base["month_of_simulation"] = int(user_attributes.get("simulation_month"))

        return EnvironmentState(**base)

    @staticmethod
    def _normalize_check_key(check_key: str) -> str:
        return check_key.replace(".", "_")

    def _prerequisite_met(self, persona: Persona, trait_key: str, condition: str) -> bool:
        raw_value = persona.traits.get(trait_key, persona.big_five.get(trait_key) if persona.big_five else None)

        cond = str(condition).strip().lower()
        if cond in {"true", "false"}:
            desired = cond == "true"
            return bool(raw_value) is desired

        match = re.match(
            r"^\s*(?:(?P<lhs>[a-z_]+)\s*)?(?P<op>>=|<=|==|!=|>|<)\s*(?P<rhs>-?\d*\.?\d+)\s*$",
            str(condition).strip().lower(),
        )
        if not match:
            return True

        lhs = match.group("lhs")
        op = match.group("op")
        rhs = float(match.group("rhs"))

        compare_key = lhs if lhs else trait_key
        compare_value = persona.traits.get(compare_key, persona.big_five.get(compare_key) if persona.big_five else None)
        if compare_value is None:
            return False
        left = float(compare_value)

        if op == ">":
            return left > rhs
        if op == "<":
            return left < rhs
        if op == ">=":
            return left >= rhs
        if op == "<=":
            return left <= rhs
        if op == "==":
            return left == rhs
        if op == "!=":
            return left != rhs
        return True

    def resolve(
        self,
        action: Action,
        env_state: EnvironmentState,
        persona: Persona,
    ) -> ActionOutcome:
        for trait_key, condition in action.personality_prerequisite.items():
            if not self._prerequisite_met(persona, trait_key, str(condition)):
                return ActionOutcome(
                    action=action,
                    outcome_type=ActionOutcomeType.NOT_ATTEMPTED,
                    satisfaction_delta=0.0,
                    blocking_reason=f"Personality prerequisite not met: {trait_key} {condition}",
                    friction_reason="",
                    environment_values={
                        "noise_level": env_state.noise_level,
                        "floor_number": env_state.floor_number,
                    },
                    narrative_hint=self._get_narrative_hint(trait_key, action, "not_attempted"),
                )

        check_values: dict[str, Any] = {}
        for check_key in action.environment_checks:
            normalized_key = self._normalize_check_key(check_key)
            value = getattr(env_state, normalized_key, None)
            check_values[check_key] = value
            if value is False or value is None:
                return ActionOutcome(
                    action=action,
                    outcome_type=ActionOutcomeType.BLOCKED,
                    satisfaction_delta=action.satisfaction_delta_blocked,
                    blocking_reason=self._get_blocking_message(check_key, env_state),
                    friction_reason="",
                    environment_values=check_values,
                    narrative_hint=self._get_narrative_hint(check_key, action, "blocked"),
                )

        friction = self._compute_friction(action, env_state)
        if friction > 0:
            return ActionOutcome(
                action=action,
                outcome_type=ActionOutcomeType.SUCCESS_WITH_FRICTION,
                satisfaction_delta=action.satisfaction_delta_friction,
                blocking_reason="",
                friction_reason=self._get_friction_message(action, env_state, friction),
                environment_values={"noise_level": env_state.noise_level, "friction_score": friction},
                narrative_hint=self._get_narrative_hint(None, action, "friction"),
            )

        return ActionOutcome(
            action=action,
            outcome_type=ActionOutcomeType.SUCCESS,
            satisfaction_delta=action.satisfaction_delta_success,
            blocking_reason="",
            friction_reason="",
            environment_values={"noise_level": env_state.noise_level},
            narrative_hint=self._get_narrative_hint(None, action, "success"),
        )

    def _get_blocking_message(self, check_key: str, env_state: EnvironmentState) -> str:
        normalized_key = self._normalize_check_key(check_key)
        pharmacy_time = env_state.walk_time_pharmacy
        hospital_time = env_state.walk_time_hospital
        mapping = {
            "has_heating": "No heating system in the apartment",
            "has_elevator": f"No elevator — apartment is on floor {env_state.floor_number}",
            "has_kitchen": "No kitchen available",
            "has_bedroom": "No dedicated bedroom",
            "bus_stop_nearby": "No bus stop within walking distance",
            "cafe_nearby": "No café within walking distance",
            "restaurant_nearby": "No restaurant nearby",
            "room_noise_below_0_4": f"Too noisy (noise level: {env_state.noise_level:.0%})",
            "room_noise_below_0_5": f"Too noisy for rest (noise level: {env_state.noise_level:.0%})",
            "room_noise_below_0_6": f"Still noisy for comfort (noise level: {env_state.noise_level:.0%})",
            "morning_quiet": "Neighborhood is not quiet in the morning",
            "has_private_room": "No private room available",
            "social_venues_nearby": "No social venues nearby",
            "has_internet": "No internet connection available",
            "has_electricity": "No reliable electricity available for cooling devices",
            "has_parking": "No parking available",
            "has_storage": "No storage space available",
            "has_security": "No security features available",
            "furnished": "Apartment is unfurnished",
            "has_balcony": "No balcony available",
            "natural_light_good": "Natural light is insufficient",
            "building_condition_good": "Building condition is not good",
            "commute_feasible": "Commute route is not feasible on foot or by available public transport",
            "hospital_accessible": (
                f"Nearest hospital requires {hospital_time:.0f} minutes on foot — not accessible quickly"
                if hospital_time is not None
                else "Nearest hospital is not accessible quickly"
            ),
            "supermarket_accessible": "Supermarket is not within short walking range",
            "pharmacy_accessible": (
                f"Nearest pharmacy is {pharmacy_time:.0f} minutes away — too far in an emergency"
                if pharmacy_time is not None
                else "Nearest pharmacy is too far in an emergency"
            ),
            "not_too_hot_for_comfort": (
                f"Apartment is {env_state.indoor_temp_celsius:.0f}°C — no cooling system to cope with this heat"
            ),
            "not_dangerously_cold": (
                f"Apartment is {env_state.indoor_temp_celsius:.0f}°C — dangerously cold without heating"
            ),
        }
        return mapping.get(normalized_key, f"Environment requirement not met: {check_key}")

    def _compute_friction(self, action: Action, env_state: EnvironmentState) -> float:
        friction = 0.0

        mobility_actions = {
            "take_bus_university",
            "take_bus_general",
            "walk_to_destination",
            "go_to_park",
            "commute_to_work_uni",
            "get_groceries",
        }
        home_comfort_actions = {
            "sleep_properly",
            "nap_afternoon",
            "have_private_time",
            "morning_routine_quiet",
            "clean_shared_spaces",
        }

        if action.action_id in {"take_bus_university", "take_bus_general"}:
            if env_state.bus_stop_nearby and env_state.noise_level > 0.6:
                friction = max(friction, 0.3)
            if env_state.bus_stop_nearby and int(env_state.transit_lines) <= 1:
                friction = max(friction, 0.22)

        if action.action_id in mobility_actions:
            if env_state.walkability_score < 0.30:
                friction = max(friction, 0.45)
            elif env_state.walkability_score < 0.45:
                friction = max(friction, 0.25)

        if action.action_id == "go_to_cafe":
            if env_state.cafe_nearby and env_state.noise_level > 0.65:
                friction = max(friction, 0.3)

        if action.action_id in {"sleep_properly", "nap_afternoon"}:
            if env_state.has_bedroom and 0.5 <= env_state.noise_level <= 0.7:
                friction = max(friction, 0.5)

        if action.action_id in home_comfort_actions and not env_state.building_condition_good:
            friction = max(friction, 0.20)

        if action.action_id in {"morning_routine_quiet", "have_private_time"} and not env_state.natural_light_good:
            friction = max(friction, 0.18)

        if action.action_id == "use_elevator":
            if env_state.floor_number > 3 and not env_state.has_elevator:
                friction = max(friction, 0.8)

        if action.action_id == "walk_to_destination":
            if env_state.floor_number > 3 and not env_state.has_elevator:
                friction = max(friction, 0.4)

        return max(0.0, min(1.0, friction))

    def _get_friction_message(self, action: Action, env_state: EnvironmentState, friction: float) -> str:
        if action.action_id in {
            "take_bus_university",
            "take_bus_general",
        } and env_state.bus_stop_nearby and int(env_state.transit_lines) <= 1:
            return "Transit access exists, but limited line options make movement less reliable"
        if action.action_id in {
            "take_bus_university",
            "take_bus_general",
            "walk_to_destination",
            "go_to_park",
            "commute_to_work_uni",
            "get_groceries",
        } and env_state.walkability_score < 0.45:
            return "The route is reachable, but low walkability makes it tiring"
        if action.action_id in {
            "morning_routine_quiet",
            "have_private_time",
        } and not env_state.natural_light_good:
            return "Low natural light made the activity feel draining"
        if action.action_id in {
            "sleep_properly",
            "nap_afternoon",
            "have_private_time",
            "morning_routine_quiet",
            "clean_shared_spaces",
        } and not env_state.building_condition_good:
            return "Building condition reduced comfort while doing this activity"
        if action.action_id in {"sleep_properly", "nap_afternoon"}:
            return f"Sleep quality reduced by noise ({env_state.noise_level:.0%})"
        if action.action_id in {"take_bus_university", "take_bus_general"}:
            return "Transit is available but waiting conditions are uncomfortable"
        if action.action_id == "go_to_cafe":
            return "Café is reachable but the area is crowded/noisy"
        if action.action_id == "walk_to_destination":
            return "Trip is possible but physically tiring"
        return f"Action completed with friction ({friction:.2f})"

    def _get_narrative_hint(self, check_key: str | None, action: Action, outcome: str) -> str:
        check_part = self._normalize_check_key(check_key) if check_key else "env"
        context = action.action_id
        if outcome == "blocked" and check_key == "has_elevator":
            context = f"floor_{action.action_id}"
        if outcome == "friction":
            context = f"friction_{action.action_id}"
        return f"{outcome}:{check_part}:{context}"

    def resolve_batch(
        self,
        actions: list[Action],
        env_state: EnvironmentState,
        persona: Persona,
    ) -> list[ActionOutcome]:
        return [self.resolve(action=action, env_state=env_state, persona=persona) for action in actions]


if __name__ == "__main__":
    from .persona import Persona

    test_persona = Persona.from_traits(
        subject_id="resolver_test_001",
        name="Resolver Test",
        traits={
            "introversion": 0.4,
            "noise_sensitivity": 0.8,
            "cleanliness": 0.6,
            "thermal_sensitivity": 0.9,
            "early_riser": True,
            "smoker": False,
        },
    )

    env = EnvironmentState(
        has_heating=False,
        has_elevator=False,
        has_kitchen=True,
        has_bedroom=True,
        has_living_space=True,
        has_private_room=True,
        has_windows=True,
        has_cleaning_supplies=True,
        floor_number=5,
        has_internet=True,
        has_parking=False,
        has_storage=False,
        has_security=False,
        furnished=True,
        has_balcony=False,
        building_age_years=20,
        internet_type="adsl",
        building_condition="fair",
        noise_level=0.75,
        natural_light=0.52,
        morning_quiet=False,
        room_noise_below_0_4=False,
        room_noise_below_0_5=False,
        room_noise_below_0_6=False,
        natural_light_good=False,
        building_condition_good=False,
        commute_feasible=False,
        hospital_accessible=False,
        supermarket_accessible=False,
        pharmacy_accessible=False,
        bus_stop_nearby=False,
        cafe_nearby=True,
        restaurant_nearby=False,
        social_venues_nearby=True,
        walkable_area=True,
        walk_time_hospital=45.0,
        walk_time_supermarket=22.0,
        walk_time_cafe=14.0,
        walk_time_pharmacy=18.0,
        transit_lines=1,
        walkability_score=0.41,
        has_transport=False,
    )

    resolver = EnvironmentResolver()
    action_ids = [
        "turn_on_heating",
        "use_elevator",
        "take_bus_university",
        "sleep_properly",
        "go_to_cafe",
    ]

    for action_id in action_ids:
        action_obj = get_action_by_id(action_id)
        if action_obj is None:
            print(f"{action_id}: missing")
            continue
        outcome = resolver.resolve(action=action_obj, env_state=env, persona=test_persona)
        print(
            f"{action_id}: {outcome.outcome_type.value}, "
            f"delta={outcome.satisfaction_delta:+.2f}, "
            f"block='{outcome.blocking_reason}'"
        )

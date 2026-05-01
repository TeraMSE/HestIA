"""Environment state models used by social agents."""

from __future__ import annotations

from typing import Any, Dict, List

from pydantic import BaseModel, Field, model_validator

try:
    from .persona import Persona
except ImportError:  # pragma: no cover - allows direct script execution
    from persona import Persona


class RoomEnvironment(BaseModel):
    """Represents one room and its physical/social properties."""

    room_id: str
    name: str
    properties: Dict[str, Any]

    @model_validator(mode="after")
    def validate_required_properties(self) -> "RoomEnvironment":
        required_keys = {
            "noise_level",
            "temperature",
            "natural_light",
            "has_ventilation",
            "has_balcony",
            "size_category",
            "space_sq_m",
            "shared",
            "smoking_allowed",
            "cleanliness_state",
        }
        missing = [key for key in required_keys if key not in self.properties]
        if missing:
            raise ValueError(f"Missing required room property keys: {missing}")

        for bounded_key in (
            "noise_level",
            "temperature",
            "natural_light",
            "cleanliness_state",
        ):
            value = float(self.properties[bounded_key])
            if not (0.0 <= value <= 1.0):
                raise ValueError(f"{bounded_key} must be in range [0.0, 1.0]")

        self.properties["space_sq_m"] = float(self.properties["space_sq_m"])
        self.properties["has_ventilation"] = bool(self.properties["has_ventilation"])
        self.properties["has_balcony"] = bool(self.properties["has_balcony"])
        size_category = str(self.properties["size_category"]).lower().strip()
        if size_category not in {"small", "medium", "large"}:
            raise ValueError("size_category must be one of: small, medium, large")
        self.properties["size_category"] = size_category
        self.properties["shared"] = bool(self.properties["shared"])
        self.properties["smoking_allowed"] = bool(self.properties["smoking_allowed"])
        return self


class Property(BaseModel):
    """Represents a full real-estate unit with multiple rooms."""

    property_id: str
    address: str
    rooms: List[RoomEnvironment]
    monthly_rent_tnd: float
    property_type: str
    floor: int
    has_elevator: bool
    neighborhood_noise: float = Field(ge=0.0, le=1.0)

    furnished: bool = False
    building_age_years: int | None = None
    has_parking: bool = False
    has_storage: bool = False
    has_security: bool = False
    has_internet: bool = True
    has_kitchen: bool = True
    internet_type: str = "unknown"
    building_condition: str = "unknown"

    walk_time_to_nearest_hospital: float | None = None
    walk_time_to_nearest_pharmacy: float | None = None
    walk_time_to_nearest_supermarket: float | None = None
    walk_time_to_nearest_cafe: float | None = None
    walk_time_to_nearest_restaurant: float | None = None
    walk_time_to_nearest_bus_stop: float | None = None
    walk_time_to_nearest_school: float | None = None
    walk_time_to_nearest_bank: float | None = None
    walk_time_to_nearest_park: float | None = None
    transit_lines_within_400m: int = 0
    walkability_score: float | None = None
    emergency_access_score: float | None = None

    commute_destination: str | None = None
    commute_walk_time: float | None = None
    commute_transit_time: float | None = None


class EnvironmentEngine:
    """Environment builder and mismatch scoring engine (no LLM calls)."""

    def create_mock_property(
        self,
        property_type: str = "2br",
        noise_level: float = 0.5,
        temperature: float = 0.5,
        smoking_allowed: bool = False,
        building_condition: str = "good",
        has_elevator: bool = True,
        floor_number: int = 1,
        furnished: bool = True,
        has_parking: bool = False,
        has_security: bool = False,
        internet_type: str = "fiber",
    ) -> Property:
        noise_level = max(0.0, min(1.0, float(noise_level)))
        temperature = max(0.0, min(1.0, float(temperature)))

        def room_props(
            *,
            shared: bool,
            space_sq_m: float,
            natural_light: float,
            room_smoking_allowed: bool,
            has_ventilation: bool = True,
            has_balcony: bool = False,
            size_category: str = "medium",
        ) -> Dict[str, Any]:
            return {
                "noise_level": noise_level if shared else max(0.0, noise_level - 0.15),
                "temperature": temperature,
                "natural_light": natural_light,
                "has_ventilation": has_ventilation,
                "has_balcony": has_balcony,
                "size_category": size_category,
                "space_sq_m": space_sq_m,
                "shared": shared,
                "smoking_allowed": room_smoking_allowed,
                "cleanliness_state": 0.7,
            }

        rooms = [
            RoomEnvironment(
                room_id="bedroom_1",
                name="Bedroom 1",
                properties=room_props(
                    shared=False,
                    space_sq_m=14.0,
                    natural_light=0.7,
                    room_smoking_allowed=False,
                    has_balcony=True,
                    size_category="medium",
                ),
            ),
            RoomEnvironment(
                room_id="bedroom_2",
                name="Bedroom 2",
                properties=room_props(
                    shared=False,
                    space_sq_m=12.0,
                    natural_light=0.65,
                    room_smoking_allowed=False,
                    size_category="medium",
                ),
            ),
            RoomEnvironment(
                room_id="living_room",
                name="Living Room",
                properties=room_props(
                    shared=True,
                    space_sq_m=20.0,
                    natural_light=0.8,
                    room_smoking_allowed=smoking_allowed,
                    has_balcony=True,
                    size_category="large",
                ),
            ),
            RoomEnvironment(
                room_id="kitchen",
                name="Kitchen",
                properties=room_props(
                    shared=True,
                    space_sq_m=10.0,
                    natural_light=0.55,
                    room_smoking_allowed=smoking_allowed,
                    has_ventilation=True,
                    size_category="small",
                ),
            ),
            RoomEnvironment(
                room_id="bathroom",
                name="Bathroom",
                properties=room_props(
                    shared=True,
                    space_sq_m=6.0,
                    natural_light=0.35,
                    room_smoking_allowed=False,
                    has_ventilation=True,
                    size_category="small",
                ),
            ),
        ]

        return Property(
            property_id="mock_property_001",
            address="Lac 2, Tunis",
            rooms=rooms,
            monthly_rent_tnd=1850.0,
            property_type=property_type,
            floor=floor_number,
            has_elevator=has_elevator,
            neighborhood_noise=noise_level,
            furnished=furnished,
            building_age_years=6,
            has_parking=has_parking,
            has_storage=False,
            has_security=has_security,
            has_internet=internet_type != "none",
            internet_type=internet_type,
            building_condition=building_condition,
            walk_time_to_nearest_hospital=14.0,
            walk_time_to_nearest_pharmacy=8.0,
            walk_time_to_nearest_supermarket=9.0,
            walk_time_to_nearest_cafe=6.0,
            walk_time_to_nearest_restaurant=7.0,
            walk_time_to_nearest_bus_stop=5.0,
            walk_time_to_nearest_school=12.0,
            walk_time_to_nearest_bank=10.0,
            walk_time_to_nearest_park=11.0,
            transit_lines_within_400m=3,
            walkability_score=0.74,
            emergency_access_score=0.81,
            commute_destination="INSAT, Ariana",
            commute_walk_time=38.0,
            commute_transit_time=24.0,
        )

    def compute_trait_environment_mismatches(
        self,
        persona: Persona,
        property: Property,
    ) -> List[Dict[str, Any]]:
        mismatches: List[Dict[str, Any]] = []

        noise_sensitivity = float(persona.traits.get("noise_sensitivity", 0.5))
        thermal_sensitivity = float(persona.traits.get("thermal_sensitivity", 0.5))
        smoker = bool(persona.traits.get("smoker", False))
        cleanliness = float(persona.traits.get("cleanliness", 0.5))

        for room in property.rooms:
            room_noise = float(room.properties["noise_level"])
            room_temp = float(room.properties["temperature"])
            room_smoking_allowed = bool(room.properties["smoking_allowed"])
            room_cleanliness = float(room.properties["cleanliness_state"])

            if abs(noise_sensitivity - room_noise) > 0.3:
                delta = -abs(room_noise - 0.3)
                mismatches.append(
                    {
                        "trait": "noise_sensitivity",
                        "room": room.name,
                        "property_value": room_noise,
                        "persona_threshold": noise_sensitivity,
                        "severity": self._severity(delta),
                        "satisfaction_delta": delta,
                    }
                )

            if thermal_sensitivity > 0.6 and room_temp < 0.4:
                delta = -(0.4 - room_temp)
                mismatches.append(
                    {
                        "trait": "thermal_sensitivity",
                        "room": room.name,
                        "property_value": room_temp,
                        "persona_threshold": 0.6,
                        "severity": self._severity(delta),
                        "satisfaction_delta": delta,
                    }
                )

            if smoker and not room_smoking_allowed:
                delta = -0.15
                mismatches.append(
                    {
                        "trait": "smoker",
                        "room": room.name,
                        "property_value": 0.0,
                        "persona_threshold": 1.0,
                        "severity": self._severity(delta),
                        "satisfaction_delta": delta,
                    }
                )

            if abs(cleanliness - room_cleanliness) > 0.3:
                delta = -abs(cleanliness - room_cleanliness)
                mismatches.append(
                    {
                        "trait": "cleanliness",
                        "room": room.name,
                        "property_value": room_cleanliness,
                        "persona_threshold": cleanliness,
                        "severity": self._severity(delta),
                        "satisfaction_delta": delta,
                    }
                )

        return mismatches

    def compute_initial_satisfaction(
        self,
        persona: Persona,
        property: Property,
    ) -> float:
        score = 1.0
        for mismatch in self.compute_trait_environment_mismatches(persona, property):
            score += float(mismatch["satisfaction_delta"])
        return max(0.0, min(1.0, score))

    @staticmethod
    def _severity(delta: float) -> str:
        abs_delta = abs(delta)
        if abs_delta > 0.4:
            return "high"
        if abs_delta > 0.2:
            return "medium"
        return "low"


if __name__ == "__main__":
    engine = EnvironmentEngine()
    extended_property = engine.create_mock_property(
        property_type="2br",
        noise_level=0.42,
        temperature=0.6,
        smoking_allowed=False,
        building_condition="good",
        has_elevator=True,
        floor_number=4,
        furnished=True,
        has_parking=True,
        has_security=True,
        internet_type="fiber",
    )
    extended_property = extended_property.model_copy(
        update={
            "has_storage": True,
            "building_age_years": 9,
            "walk_time_to_nearest_hospital": 12.0,
            "walk_time_to_nearest_supermarket": 7.0,
            "walkability_score": 0.82,
            "emergency_access_score": 0.86,
            "commute_destination": "Université de Tunis El Manar",
            "commute_walk_time": 34.0,
            "commute_transit_time": 21.0,
        }
    )

    print("Extended mock property:")
    print(extended_property.model_dump())

"""Convert apartment room configuration into visual simulation grid layouts."""

from __future__ import annotations

from copy import deepcopy
from typing import Any


ROOM_DEFAULTS: dict[str, dict[str, Any]] = {
    "bedroom": {
        "color": "#A8D8EA",
        "min_w": 5,
        "min_h": 4,
        "default_w": 6,
        "default_h": 5,
        "hotspots": [
            {"id": "bed", "emoji": "🛏️", "rel_x": 0.5, "rel_y": 0.5},
            {"id": "desk", "emoji": "💻", "rel_x": 0.8, "rel_y": 0.2},
        ],
    },
    "living_room": {
        "color": "#F8E9A0",
        "min_w": 6,
        "min_h": 5,
        "default_w": 8,
        "default_h": 6,
        "hotspots": [
            {"id": "sofa", "emoji": "🛋️", "rel_x": 0.4, "rel_y": 0.5},
            {"id": "tv", "emoji": "📺", "rel_x": 0.85, "rel_y": 0.5},
        ],
    },
    "kitchen": {
        "color": "#FFD3A5",
        "default_w": 5,
        "default_h": 4,
        "hotspots": [
            {"id": "stove", "emoji": "🍳", "rel_x": 0.2, "rel_y": 0.3},
            {"id": "fridge", "emoji": "🥗", "rel_x": 0.8, "rel_y": 0.3},
            {"id": "dining_table", "emoji": "🍽️", "rel_x": 0.5, "rel_y": 0.7},
        ],
    },
    "bathroom": {
        "color": "#C3E8CF",
        "default_w": 3,
        "default_h": 3,
        "hotspots": [
            {"id": "shower", "emoji": "🚿", "rel_x": 0.3, "rel_y": 0.5},
            {"id": "toilet", "emoji": "🚽", "rel_x": 0.7, "rel_y": 0.5},
        ],
    },
    "balcony": {
        "color": "#D4F1C0",
        "default_w": 3,
        "default_h": 2,
        "hotspots": [
            {"id": "balcony_spot", "emoji": "🌿", "rel_x": 0.5, "rel_y": 0.5},
        ],
    },
    "hallway": {
        "color": "#E8E8E8",
        "default_w": 2,
        "default_h": 6,
        "hotspots": [],
    },
}


class LayoutBuilder:
    """Build visual apartment layout dictionaries from room configuration."""

    GAP = 1

    @staticmethod
    def build_default_two_bedroom_layout():
        """Compatibility helper returning an ApartmentLayout model."""
        from .data_contract import ApartmentLayout

        builder = LayoutBuilder()
        layout_dict = builder.build_default_layout(
            num_bedrooms=2,
            has_living_room=True,
            has_kitchen=True,
            has_balcony=False,
            num_bathrooms=1,
            persona_a_name="Persona A",
            persona_b_name="Persona B",
        )
        return ApartmentLayout.model_validate(layout_dict)

    @staticmethod
    def _size_for_room(room_type: str, size_label: str | None = None) -> tuple[int, int]:
        defaults = ROOM_DEFAULTS.get(room_type, ROOM_DEFAULTS["hallway"])
        width = int(defaults.get("default_w", 4))
        height = int(defaults.get("default_h", 4))

        min_w = int(defaults.get("min_w", max(2, width - 1)))
        min_h = int(defaults.get("min_h", max(2, height - 1)))

        size_mode = (size_label or "medium").strip().lower()
        if size_mode == "small":
            width = max(min_w, width - 1)
            height = max(min_h, height - 1)
        elif size_mode == "large":
            width = width + 1
            height = height + 1

        return width, height

    @staticmethod
    def _room_id(room_type: str, index_by_type: dict[str, int]) -> str:
        idx = index_by_type.get(room_type, 0) + 1
        index_by_type[room_type] = idx
        return f"{room_type}_{idx}" if idx > 1 else room_type

    @staticmethod
    def _room_center(room: dict[str, Any]) -> dict[str, float]:
        return {
            "x": float(room["x"]) + (float(room["w"]) / 2.0),
            "y": float(room["y"]) + (float(room["h"]) / 2.0),
        }

    @staticmethod
    def _overlap(a: dict[str, Any], b: dict[str, Any]) -> bool:
        return not (
            a["x"] + a["w"] <= b["x"]
            or b["x"] + b["w"] <= a["x"]
            or a["y"] + a["h"] <= b["y"]
            or b["y"] + b["h"] <= a["y"]
        )

    def _build_hotspots(self, rooms: list[dict[str, Any]]) -> list[dict[str, Any]]:
        hotspots: list[dict[str, Any]] = []
        for room in rooms:
            room_defaults = ROOM_DEFAULTS.get(room["type"], {"hotspots": []})
            for hot in room_defaults.get("hotspots", []):
                hx = float(room["x"]) + (float(room["w"]) * float(hot.get("rel_x", 0.5)))
                hy = float(room["y"]) + (float(room["h"]) * float(hot.get("rel_y", 0.5)))
                hotspots.append(
                    {
                        "id": f"{room['id']}_{hot['id']}",
                        "room_id": room["id"],
                        "label": str(hot["id"]).replace("_", " ").title(),
                        "emoji": hot.get("emoji", "📍"),
                        "x": round(hx, 2),
                        "y": round(hy, 2),
                    }
                )
        return hotspots

    def _assign_persona_starts(
        self,
        personas: list[dict[str, Any]],
        rooms: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        updated_personas: list[dict[str, Any]] = []
        assigned_centers = {
            room.get("assigned_to"): self._room_center(room)
            for room in rooms
            if room.get("assigned_to")
        }
        bedroom_centers = [
            self._room_center(room)
            for room in rooms
            if room.get("type") == "bedroom"
        ]

        default_pos = bedroom_centers[0] if bedroom_centers else {"x": 1.0, "y": 1.0}

        for persona in personas:
            p = deepcopy(persona)
            persona_id = str(p.get("id") or p.get("subject_id") or "").strip()
            if persona_id:
                p["id"] = persona_id
            p["start_position"] = assigned_centers.get(persona_id, default_pos)
            updated_personas.append(p)

        return updated_personas

    def build_layout(
        self,
        rooms_config: list[dict],
        personas: list[dict],
        apartment_name: str = "Apartment",
    ) -> dict:
        """Build grid-based apartment layout from room configuration."""
        bedrooms = [room for room in rooms_config if room.get("type") == "bedroom"]
        shared = [room for room in rooms_config if room.get("type") != "bedroom"]

        rooms_out: list[dict[str, Any]] = []
        index_by_type: dict[str, int] = {}

        x_cursor = 0
        top_row_height = 0
        for room in bedrooms:
            room_type = str(room.get("type", "bedroom"))
            w, h = self._size_for_room(room_type, room.get("size"))
            room_id = self._room_id(room_type, index_by_type)
            color = ROOM_DEFAULTS.get(room_type, {}).get("color", "#DDDDDD")

            placed = {
                "id": room_id,
                "label": room.get("label", room_id.replace("_", " ").title()),
                "color": color,
                "x": x_cursor,
                "y": 0,
                "w": w,
                "h": h,
                "type": room_type,
                "assigned_to": room.get("assigned_to"),
            }
            rooms_out.append(placed)
            x_cursor += w + self.GAP
            top_row_height = max(top_row_height, h)

        max_layout_width = max(14, x_cursor - self.GAP if x_cursor > 0 else 14)

        shared_order = {
            "living_room": 0,
            "kitchen": 1,
            "bathroom": 2,
            "balcony": 3,
        }
        shared_sorted = sorted(
            shared,
            key=lambda room: shared_order.get(str(room.get("type", "")), 99),
        )

        tentative_shared_y = top_row_height + self.GAP
        sx = 0
        sy = tentative_shared_y
        row_h = 0
        for room in shared_sorted:
            room_type = str(room.get("type", "hallway"))
            w, h = self._size_for_room(room_type, room.get("size"))
            if sx > 0 and sx + w > max_layout_width:
                sy += row_h + self.GAP
                sx = 0
                row_h = 0
            sx += w + self.GAP
            row_h = max(row_h, h)

        estimated_height = sy + row_h if shared_sorted else top_row_height
        use_hallway = estimated_height > 10

        shared_start_y = top_row_height + (2 * self.GAP) + (1 if use_hallway else 0)
        if use_hallway:
            hallway_room = {
                "id": self._room_id("hallway", index_by_type),
                "label": "Hallway",
                "color": ROOM_DEFAULTS["hallway"]["color"],
                "x": 0,
                "y": top_row_height + self.GAP,
                "w": max_layout_width,
                "h": 1,
                "type": "hallway",
                "assigned_to": None,
            }
            rooms_out.append(hallway_room)

        sx = 0
        sy = shared_start_y
        row_h = 0
        for room in shared_sorted:
            room_type = str(room.get("type", "hallway"))
            w, h = self._size_for_room(room_type, room.get("size"))
            if sx > 0 and sx + w > max_layout_width:
                sy += row_h + self.GAP
                sx = 0
                row_h = 0

            room_id = self._room_id(room_type, index_by_type)
            color = ROOM_DEFAULTS.get(room_type, {}).get("color", "#DDDDDD")
            rooms_out.append(
                {
                    "id": room_id,
                    "label": room.get("label", room_id.replace("_", " ").title()),
                    "color": color,
                    "x": sx,
                    "y": sy,
                    "w": w,
                    "h": h,
                    "type": room_type,
                    "assigned_to": room.get("assigned_to"),
                }
            )
            sx += w + self.GAP
            row_h = max(row_h, h)

        width_units = max((room["x"] + room["w"]) for room in rooms_out) if rooms_out else 0
        height_units = max((room["y"] + room["h"]) for room in rooms_out) if rooms_out else 0

        hotspots = self._build_hotspots(rooms_out)
        personas_with_starts = self._assign_persona_starts(personas, rooms_out)

        return {
            "apartment_name": apartment_name,
            "width_units": int(width_units),
            "height_units": int(height_units),
            "rooms": rooms_out,
            "hotspots": hotspots,
            "personas": personas_with_starts,
        }

    def build_default_layout(
        self,
        num_bedrooms: int,
        has_living_room: bool,
        has_kitchen: bool,
        has_balcony: bool,
        num_bathrooms: int,
        persona_a_name: str,
        persona_b_name: str,
    ) -> dict:
        """Convenience constructor for typical roommate-compatible apartment layouts."""
        rooms_config: list[dict[str, Any]] = []
        personas: list[dict[str, Any]] = [
            {
                "id": "persona_a",
                "name": persona_a_name,
                "color": "#FF6B6B",
                "emoji": "👩",
                "big5_summary": "Unknown",
            },
            {
                "id": "persona_b",
                "name": persona_b_name,
                "color": "#4ECDC4",
                "emoji": "👨",
                "big5_summary": "Unknown",
            },
        ]

        for i in range(max(1, num_bedrooms)):
            assigned = "persona_a" if i == 0 else "persona_b" if i == 1 else None
            label = f"Bedroom {chr(65 + i)}"
            rooms_config.append(
                {
                    "type": "bedroom",
                    "label": label,
                    "assigned_to": assigned,
                    "size": "medium",
                }
            )

        if has_living_room:
            rooms_config.append({"type": "living_room", "label": "Living Room", "size": "large"})
        if has_kitchen:
            rooms_config.append({"type": "kitchen", "label": "Kitchen", "size": "medium"})
        for i in range(max(0, int(num_bathrooms))):
            rooms_config.append({"type": "bathroom", "label": f"Bathroom {i + 1}", "size": "small"})
        if has_balcony:
            rooms_config.append({"type": "balcony", "label": "Balcony", "size": "small"})

        return self.build_layout(
            rooms_config=rooms_config,
            personas=personas,
            apartment_name="Default Layout",
        )

    def layout_from_apartment_config(self, apartment_config: dict, personas: list[dict]) -> dict:
        """Convert saved Streamlit apartment configuration to visual layout config."""
        num_bedrooms = int(apartment_config.get("num_bedrooms", 2) or 2)
        num_bathrooms = int(apartment_config.get("num_bathrooms", 1) or 1)
        has_balcony = bool(apartment_config.get("has_balcony", False))
        has_kitchen = bool(apartment_config.get("has_kitchen", True))
        has_living_room = bool(apartment_config.get("has_living_room", True))
        floor_number = int(apartment_config.get("floor_number", 1) or 1)

        rooms_config: list[dict[str, Any]] = []

        persona_ids = [str(persona.get("id") or persona.get("subject_id") or "").strip() for persona in personas]
        for i in range(max(1, num_bedrooms)):
            assigned = persona_ids[i] if i < len(persona_ids) else None
            rooms_config.append(
                {
                    "type": "bedroom",
                    "label": f"Bedroom {chr(65 + i)}",
                    "assigned_to": assigned,
                    "size": "medium",
                }
            )

        if has_living_room:
            rooms_config.append({"type": "living_room", "label": "Living Room", "size": "large"})
        if has_kitchen:
            rooms_config.append({"type": "kitchen", "label": "Kitchen", "size": "medium"})
        for i in range(max(0, num_bathrooms)):
            rooms_config.append({"type": "bathroom", "label": f"Bathroom {i + 1}", "size": "small"})
        if has_balcony:
            rooms_config.append({"type": "balcony", "label": "Balcony", "size": "small"})

        layout = self.build_layout(
            rooms_config=rooms_config,
            personas=personas,
            apartment_name=str(apartment_config.get("name") or apartment_config.get("apartment_name") or "Apartment"),
        )

        for room in layout["rooms"]:
            if room["type"] == "hallway":
                room["label"] = f"Hallway (Floor {floor_number})"

        return layout


if __name__ == "__main__":
    builder = LayoutBuilder()

    test_personas = [
        {
            "id": "persona_a",
            "name": "Amira",
            "color": "#FF6B6B",
            "emoji": "👩",
            "big5_summary": "Introverted, Conscientious",
        },
        {
            "id": "persona_b",
            "name": "Karim",
            "color": "#4ECDC4",
            "emoji": "👨",
            "big5_summary": "Extraverted, Agreeable",
        },
    ]

    layout = builder.build_layout(
        rooms_config=[
            {"type": "bedroom", "label": "Bedroom A", "assigned_to": "persona_a", "size": "medium"},
            {"type": "bedroom", "label": "Bedroom B", "assigned_to": "persona_b", "size": "medium"},
            {"type": "living_room", "label": "Living Room", "size": "large"},
            {"type": "kitchen", "label": "Kitchen", "size": "medium"},
            {"type": "bathroom", "label": "Bathroom", "size": "small"},
            {"type": "balcony", "label": "Balcony", "size": "small"},
        ],
        personas=test_personas,
        apartment_name="Visual Sim Test Apartment",
    )

    print("Rooms:")
    for room in layout["rooms"]:
        print(
            f"- {room['id']} ({room['type']}): x={room['x']}, y={room['y']}, "
            f"w={room['w']}, h={room['h']}, assigned_to={room.get('assigned_to')}"
        )

    print("\nHotspots:")
    for spot in layout["hotspots"]:
        print(
            f"- {spot['id']} in {spot['room_id']}: x={spot['x']}, y={spot['y']} {spot['emoji']}"
        )

    overlaps: list[tuple[str, str]] = []
    rooms = layout["rooms"]
    for i in range(len(rooms)):
        for j in range(i + 1, len(rooms)):
            if LayoutBuilder._overlap(rooms[i], rooms[j]):
                overlaps.append((rooms[i]["id"], rooms[j]["id"]))

    if overlaps:
        print("\nOverlap check: FAILED")
        for a_id, b_id in overlaps:
            print(f"- Overlap detected between {a_id} and {b_id}")
    else:
        print("\nOverlap check: PASSED (no overlapping rooms)")

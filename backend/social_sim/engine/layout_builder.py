"""Layout builder: provides default apartment layouts and hotspot indexing.

Hotspot = a named anchor point in grid space (column, row) that the agent
walks to when performing a particular action. These map 1:1 to furniture
types recognized by the frontend FurnitureManager.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


# Default hotspot positions (grid columns 0–9, rows 0–7 for a 10×8 grid)
DEFAULT_HOTSPOTS: List[Dict[str, Any]] = [
    {"id": "bed_a",         "type": "bed",      "x": 1,  "y": 1,  "room": "bedroom_a"},
    {"id": "bed_b",         "type": "bed",      "x": 8,  "y": 1,  "room": "bedroom_b"},
    {"id": "stove",         "type": "stove",    "x": 1,  "y": 6,  "room": "kitchen"},
    {"id": "dining_table",  "type": "table",    "x": 3,  "y": 6,  "room": "kitchen"},
    {"id": "sofa",          "type": "chair",    "x": 5,  "y": 4,  "room": "living_room"},
    {"id": "tv",            "type": "tv",       "x": 5,  "y": 2,  "room": "living_room"},
    {"id": "desk_a",        "type": "desk",     "x": 2,  "y": 2,  "room": "bedroom_a"},
    {"id": "desk_b",        "type": "desk",     "x": 7,  "y": 2,  "room": "bedroom_b"},
    {"id": "bathroom",      "type": "bathroom", "x": 9,  "y": 5,  "room": "bathroom"},
    {"id": "door",          "type": "door",     "x": 5,  "y": 7,  "room": "hallway"},
]

DEFAULT_ROOMS: List[Dict[str, Any]] = [
    {"id": "bedroom_a",   "type": "bedroom",     "label": "Bedroom A",   "x": 0, "y": 0, "w": 4, "h": 4},
    {"id": "bedroom_b",   "type": "bedroom",     "label": "Bedroom B",   "x": 6, "y": 0, "w": 4, "h": 4},
    {"id": "living_room", "type": "living_room", "label": "Living Room", "x": 3, "y": 2, "w": 4, "h": 3},
    {"id": "kitchen",     "type": "kitchen",     "label": "Kitchen",     "x": 0, "y": 5, "w": 5, "h": 3},
    {"id": "bathroom",    "type": "bathroom",    "label": "Bathroom",    "x": 8, "y": 4, "w": 2, "h": 4},
    {"id": "hallway",     "type": "hallway",     "label": "Hallway",     "x": 4, "y": 6, "w": 2, "h": 2},
]


# Maps LS action IDs → hotspot types (primary target)
ACTION_HOTSPOT_MAP: Dict[str, str] = {
    "sleep_properly":         "bed",
    "nap_afternoon":          "bed",
    "cook_at_home":           "stove",
    "get_groceries":          "table",
    "have_private_time":      "desk",
    "seek_quiet_room":        "desk",
    "morning_routine_quiet":  "bathroom",
    "invite_friends_over":    "chair",
    "clean_shared_spaces":    "table",
    "relax_sofa":             "chair",
    "watch_tv":               "tv",
    "turn_on_heating":        "door",   # no real target, brief emote
    "commute_to_work_uni":    "door",
    "take_bus_to_work":       "door",
    "take_bus_to_university": "door",
    "go_to_gym":              "door",
    "go_to_grocery_store":    "door",
    "go_out_socially":        "door",
    "tolerate_noise":         "chair",
    "do_laundry":             "table",
    "exercise_at_home":       "chair",
    "study_at_home":          "desk",
    "work_from_home":         "desk",
    "video_call_family":      "desk",
    "meditate_or_journal":    "chair",
    "take_shower":            "bathroom",
    "grocery_delivery":       "door",
}

# Maps action IDs to emoji shown on agent bubble
ACTION_EMOJI_MAP: Dict[str, str] = {
    "sleep_properly":         "💤",
    "nap_afternoon":          "😴",
    "cook_at_home":           "🍳",
    "get_groceries":          "🛒",
    "have_private_time":      "🔒",
    "seek_quiet_room":        "🤫",
    "morning_routine_quiet":  "🌅",
    "invite_friends_over":    "🎉",
    "clean_shared_spaces":    "🧹",
    "relax_sofa":             "🛋️",
    "watch_tv":               "📺",
    "turn_on_heating":        "🌡️",
    "commute_to_work_uni":    "🚌",
    "take_bus_to_work":       "🚌",
    "take_bus_to_university": "🚌",
    "go_to_gym":              "🏋️",
    "go_to_grocery_store":    "🛒",
    "go_out_socially":        "🚪",
    "tolerate_noise":         "😤",
    "do_laundry":             "👕",
    "exercise_at_home":       "🏃",
    "study_at_home":          "📚",
    "work_from_home":         "💻",
    "video_call_family":      "📱",
    "meditate_or_journal":    "🧘",
    "take_shower":            "🚿",
    "grocery_delivery":       "📦",
}

# Action IDs that cause the agent to leave the room
LEAVING_ACTIONS = {
    "commute_to_work_uni", "take_bus_to_work", "take_bus_to_university",
    "go_to_gym", "go_to_grocery_store", "go_out_socially", "grocery_delivery",
}


def build_default_layout() -> Dict[str, Any]:
    """Return the default apartment layout with rooms and hotspots."""
    return {
        "rooms": DEFAULT_ROOMS,
        "hotspots": DEFAULT_HOTSPOTS,
        "width": 10,
        "height": 8,
    }


def get_hotspot_for_action(action_id: str) -> Optional[Dict[str, Any]]:
    """Return the hotspot dict for the given action ID, or None."""
    target_type = ACTION_HOTSPOT_MAP.get(action_id)
    if not target_type:
        return None
    for hs in DEFAULT_HOTSPOTS:
        if hs["type"] == target_type:
            return hs
    return None


def get_hotspot_by_id(hotspot_id: str) -> Optional[Dict[str, Any]]:
    for hs in DEFAULT_HOTSPOTS:
        if hs["id"] == hotspot_id:
            return hs
    return None

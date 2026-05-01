"""Visual roommate simulation frame contract + builders."""

from __future__ import annotations

from importlib import import_module


__all__ = [
    "ApartmentHotspot",
    "ApartmentLayout",
    "ApartmentRoom",
    "FrameAgentState",
    "FrameBuilder",
    "FrameConflict",
    "FrameEvent",
    "FrameSequenceBuilder",
    "GridPosition",
    "LayoutBuilder",
    "PersonaVisual",
    "SimulationFrame",
    "SimulationSummary",
    "VisualSimulationReplay",
]


def __getattr__(name: str):
    if name in {
        "ApartmentHotspot",
        "ApartmentLayout",
        "ApartmentRoom",
        "FrameAgentState",
        "FrameConflict",
        "FrameEvent",
        "GridPosition",
        "PersonaVisual",
        "SimulationFrame",
        "SimulationSummary",
        "VisualSimulationReplay",
    }:
        module = import_module(".data_contract", __name__)
        return getattr(module, name)

    if name in {"FrameSequenceBuilder", "FrameBuilder"}:
        module = import_module(".frame_builder", __name__)
        return getattr(module, name)

    if name == "LayoutBuilder":
        module = import_module(".layout_builder", __name__)
        return getattr(module, name)

    raise AttributeError(f"module '{__name__}' has no attribute '{name}'")

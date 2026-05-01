"""Pydantic data contract for the visual simulation replay payload.

This defines the shape of the data returned from the frame builder and
consumed by the frontend LifeSimDriver.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class FrameAgentState(BaseModel):
    """State of one agent at a given frame."""

    persona_id: str
    name: str
    x: float  # grid column (layout space)
    y: float  # grid row (layout space)
    room: str = "living_room"
    action_id: str = "idle"
    action_label: str = "Idle"
    action_emoji: str = "💤"
    mood: str = "neutral"  # "happy" | "neutral" | "frustrated" | "upset"
    mood_emoji: str = "😐"
    speech_bubble: Optional[str] = None
    narration: Optional[str] = None
    outside_room: bool = False  # True during commute/leaving actions
    satisfaction_delta: float = 0.0


class FrameConflict(BaseModel):
    conflict_id: str
    conflict_type: str
    description: str
    severity: float
    tick: int


class SimulationFrame(BaseModel):
    """One tick / interpolated sub-frame of the simulation."""

    frame_index: int
    tick: int  # 0–23 (hour offset from 06:00)
    time_label: str  # "06:00" – "05:00" next day
    agents: List[FrameAgentState] = Field(default_factory=list)
    conflict: Optional[FrameConflict] = None
    events: List[Dict[str, Any]] = Field(default_factory=list)


class ApartmentLayout(BaseModel):
    """Minimal layout description for the frontend to resolve hotspot positions."""

    rooms: List[Dict[str, Any]] = Field(default_factory=list)
    hotspots: List[Dict[str, Any]] = Field(default_factory=list)
    width: int = 10
    height: int = 8


class SimulationSummary(BaseModel):
    compatibility_score: float = 0.5
    label: str = "Unknown"
    conflicts_count: int = 0
    persona_a_satisfaction: float = 0.5
    persona_b_satisfaction: float = 0.5
    total_ticks: int = 24


class VisualSimulationReplay(BaseModel):
    """Full replay payload sent from backend to frontend."""

    run_id: str
    mode: str = "cohabitation"  # "solo" | "cohabitation"
    personas: List[Dict[str, Any]] = Field(default_factory=list)
    apartment: ApartmentLayout = Field(default_factory=ApartmentLayout)
    frames: List[SimulationFrame] = Field(default_factory=list)
    simulation_summary: SimulationSummary = Field(default_factory=SimulationSummary)
    mediation_rules: List[str] = Field(default_factory=list)
    mediation_summary: str = ""

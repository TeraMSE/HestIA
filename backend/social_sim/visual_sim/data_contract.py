"""Pydantic data contract for visual roommate simulation frame replay."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, model_validator


class GridPosition(BaseModel):
    x: float
    y: float


class ApartmentRoom(BaseModel):
    id: str
    label: str
    color: str
    x: int = Field(ge=0)
    y: int = Field(ge=0)
    w: int = Field(gt=0)
    h: int = Field(gt=0)
    type: str
    assigned_to: Optional[str] = None


class ApartmentHotspot(BaseModel):
    id: str
    room_id: str
    label: str
    emoji: str
    x: float
    y: float


class ApartmentLayout(BaseModel):
    width_units: int = Field(gt=0)
    height_units: int = Field(gt=0)
    rooms: list[ApartmentRoom] = Field(default_factory=list)
    hotspots: list[ApartmentHotspot] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_relations(self) -> "ApartmentLayout":
        room_ids = {room.id for room in self.rooms}
        for hotspot in self.hotspots:
            if hotspot.room_id not in room_ids:
                raise ValueError(f"Hotspot '{hotspot.id}' references unknown room '{hotspot.room_id}'.")
        return self


class PersonaVisual(BaseModel):
    id: str
    name: str
    color: str
    emoji: str
    big5_summary: str
    start_position: GridPosition


class FrameAgentState(BaseModel):
    persona_id: str
    position: GridPosition
    target_room: Optional[str] = None
    action: str
    action_emoji: str
    speech_bubble: Optional[str] = None
    satisfaction_delta: float = 0.0
    mood: str = "neutral"


class FrameEvent(BaseModel):
    type: str
    description: str
    agents_involved: list[str] = Field(default_factory=list)


class FrameConflict(BaseModel):
    type: str
    description: str
    resolution: str
    satisfaction_impact: float


class SimulationFrame(BaseModel):
    frame_id: int = Field(ge=0)
    tick: int = Field(ge=0)
    time_label: str
    scenario_label: str
    scenario_description: str
    agents: list[FrameAgentState] = Field(default_factory=list)
    events: list[FrameEvent] = Field(default_factory=list)
    conflict: Optional[FrameConflict] = None


class SimulationSummary(BaseModel):
    total_frames: int = Field(ge=0)
    duration_hours: float = Field(ge=0)
    compatibility_score: float = Field(ge=0.0, le=1.0)
    conflict_count: int = Field(ge=0)
    positive_interactions: int = Field(ge=0)


class VisualSimulationReplay(BaseModel):
    apartment: ApartmentLayout
    personas: list[PersonaVisual] = Field(default_factory=list)
    frames: list[SimulationFrame] = Field(default_factory=list)
    simulation_summary: SimulationSummary

    @model_validator(mode="after")
    def validate_references(self) -> "VisualSimulationReplay":
        persona_ids = {persona.id for persona in self.personas}
        room_ids = {room.id for room in self.apartment.rooms}

        for room in self.apartment.rooms:
            if room.assigned_to is not None and room.assigned_to not in persona_ids:
                raise ValueError(
                    f"Room '{room.id}' assigned_to unknown persona '{room.assigned_to}'."
                )

        for frame in self.frames:
            for agent in frame.agents:
                if agent.persona_id not in persona_ids:
                    raise ValueError(
                        f"Frame {frame.frame_id} agent references unknown persona '{agent.persona_id}'."
                    )
                if agent.target_room is not None and agent.target_room not in room_ids:
                    raise ValueError(
                        f"Frame {frame.frame_id} agent target_room '{agent.target_room}' does not exist."
                    )

            for event in frame.events:
                unknown = [pid for pid in event.agents_involved if pid not in persona_ids]
                if unknown:
                    raise ValueError(
                        f"Frame {frame.frame_id} event references unknown personas: {unknown}."
                    )

        expected_count = len(self.frames)
        if self.simulation_summary.total_frames != expected_count:
            raise ValueError(
                "simulation_summary.total_frames must equal len(frames). "
                f"Got {self.simulation_summary.total_frames} vs {expected_count}."
            )

        return self


def _build_minimal_example() -> VisualSimulationReplay:
    apartment = ApartmentLayout(
        width_units=20,
        height_units=15,
        rooms=[
            ApartmentRoom(
                id="bedroom_a",
                label="Bedroom A",
                color="#A8D8EA",
                x=0,
                y=0,
                w=6,
                h=5,
                type="bedroom",
                assigned_to="persona_a",
            ),
            ApartmentRoom(
                id="bedroom_b",
                label="Bedroom B",
                color="#D6CDEA",
                x=0,
                y=5,
                w=6,
                h=5,
                type="bedroom",
                assigned_to="persona_b",
            ),
            ApartmentRoom(
                id="living_room",
                label="Living Room",
                color="#F8E9A0",
                x=6,
                y=0,
                w=8,
                h=6,
                type="living_room",
                assigned_to=None,
            ),
            ApartmentRoom(
                id="kitchen",
                label="Kitchen",
                color="#C8F7C5",
                x=14,
                y=0,
                w=6,
                h=5,
                type="kitchen",
                assigned_to=None,
            ),
        ],
        hotspots=[
            ApartmentHotspot(
                id="sofa",
                room_id="living_room",
                label="Sofa",
                emoji="🛋️",
                x=10.5,
                y=2.5,
            ),
            ApartmentHotspot(
                id="sink",
                room_id="kitchen",
                label="Sink",
                emoji="🚰",
                x=16.5,
                y=2.0,
            ),
        ],
    )

    personas = [
        PersonaVisual(
            id="persona_a",
            name="Amira",
            color="#FF6B6B",
            emoji="👩",
            big5_summary="Introverted, Conscientious",
            start_position=GridPosition(x=3.0, y=2.0),
        ),
        PersonaVisual(
            id="persona_b",
            name="Karim",
            color="#4ECDC4",
            emoji="👨",
            big5_summary="Extraverted, Agreeable",
            start_position=GridPosition(x=3.0, y=7.0),
        ),
    ]

    frames = [
        SimulationFrame(
            frame_id=0,
            tick=0,
            time_label="07:00",
            scenario_label="Wake Up",
            scenario_description="Both personas are still in their bedrooms.",
            agents=[
                FrameAgentState(
                    persona_id="persona_a",
                    position=GridPosition(x=3.0, y=2.0),
                    target_room="bedroom_a",
                    action="sleeping",
                    action_emoji="😴",
                    mood="neutral",
                ),
                FrameAgentState(
                    persona_id="persona_b",
                    position=GridPosition(x=3.0, y=7.0),
                    target_room="bedroom_b",
                    action="sleeping",
                    action_emoji="😴",
                    mood="neutral",
                ),
            ],
        ),
        SimulationFrame(
            frame_id=1,
            tick=1,
            time_label="07:30",
            scenario_label="Heading to Kitchen",
            scenario_description="Both walk toward the kitchen.",
            agents=[
                FrameAgentState(
                    persona_id="persona_a",
                    position=GridPosition(x=8.0, y=3.0),
                    target_room="kitchen",
                    action="walking",
                    action_emoji="🚶",
                    mood="focused",
                ),
                FrameAgentState(
                    persona_id="persona_b",
                    position=GridPosition(x=7.5, y=4.0),
                    target_room="kitchen",
                    action="walking",
                    action_emoji="🚶",
                    mood="neutral",
                ),
            ],
        ),
        SimulationFrame(
            frame_id=2,
            tick=2,
            time_label="08:00",
            scenario_label="Kitchen Conflict",
            scenario_description="Both reach the kitchen and want to use it at once.",
            agents=[
                FrameAgentState(
                    persona_id="persona_a",
                    position=GridPosition(x=16.0, y=2.0),
                    target_room="kitchen",
                    action="making_breakfast",
                    action_emoji="🍳",
                    mood="tense",
                    speech_bubble="I need this space now.",
                    satisfaction_delta=-0.02,
                ),
                FrameAgentState(
                    persona_id="persona_b",
                    position=GridPosition(x=15.8, y=2.2),
                    target_room="kitchen",
                    action="making_breakfast",
                    action_emoji="🍳",
                    mood="tense",
                    speech_bubble="We arrived at the same time.",
                    satisfaction_delta=-0.03,
                ),
            ],
            events=[
                FrameEvent(
                    type="conflict",
                    description="Both want to use the kitchen simultaneously",
                    agents_involved=["persona_a", "persona_b"],
                )
            ],
            conflict=FrameConflict(
                type="space_conflict",
                description="Both agents in kitchen",
                resolution="Karim waits",
                satisfaction_impact=-0.05,
            ),
        ),
        SimulationFrame(
            frame_id=3,
            tick=3,
            time_label="08:30",
            scenario_label="Resolution",
            scenario_description="Amira finishes first; Karim waits calmly.",
            agents=[
                FrameAgentState(
                    persona_id="persona_a",
                    position=GridPosition(x=16.5, y=2.0),
                    target_room="kitchen",
                    action="eating",
                    action_emoji="🥣",
                    mood="calm",
                    satisfaction_delta=0.02,
                ),
                FrameAgentState(
                    persona_id="persona_b",
                    position=GridPosition(x=14.8, y=2.0),
                    target_room="kitchen",
                    action="waiting",
                    action_emoji="⏳",
                    mood="neutral",
                    satisfaction_delta=-0.01,
                ),
            ],
            events=[
                FrameEvent(
                    type="resolution",
                    description="Turn-taking avoids escalation",
                    agents_involved=["persona_a", "persona_b"],
                )
            ],
        ),
        SimulationFrame(
            frame_id=4,
            tick=4,
            time_label="09:00",
            scenario_label="Shared Living Room",
            scenario_description="Both relax in the living room with no conflict.",
            agents=[
                FrameAgentState(
                    persona_id="persona_a",
                    position=GridPosition(x=10.5, y=2.5),
                    target_room="living_room",
                    action="reading",
                    action_emoji="📖",
                    mood="positive",
                    satisfaction_delta=0.03,
                ),
                FrameAgentState(
                    persona_id="persona_b",
                    position=GridPosition(x=11.0, y=3.0),
                    target_room="living_room",
                    action="chatting",
                    action_emoji="💬",
                    mood="positive",
                    satisfaction_delta=0.04,
                ),
            ],
            events=[
                FrameEvent(
                    type="positive_interaction",
                    description="Relaxed social moment in living room",
                    agents_involved=["persona_a", "persona_b"],
                )
            ],
        ),
    ]

    summary = SimulationSummary(
        total_frames=len(frames),
        duration_hours=2.0,
        compatibility_score=0.72,
        conflict_count=1,
        positive_interactions=2,
    )

    return VisualSimulationReplay(
        apartment=apartment,
        personas=personas,
        frames=frames,
        simulation_summary=summary,
    )


if __name__ == "__main__":
    import sys

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    replay = _build_minimal_example()
    payload_json = replay.model_dump_json(indent=2)
    print(payload_json)

    validated = VisualSimulationReplay.model_validate_json(payload_json)
    print("\nValidation successful")
    print(
        f"Frames={validated.simulation_summary.total_frames}, "
        f"Compatibility={validated.simulation_summary.compatibility_score:.2f}"
    )

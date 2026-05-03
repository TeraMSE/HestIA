"""Life Simulation Agent (Feature 2)."""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from pydantic import BaseModel

try:
    from .environment import EnvironmentEngine, Property
    from .llm_client import UnifiedLLMClient
    from .memory import MemoryStream
    from .persona import Persona
except ImportError:  # pragma: no cover - allows direct script execution
    from environment import EnvironmentEngine, Property
    from llm_client import UnifiedLLMClient
    from memory import MemoryStream
    from persona import Persona


logger = logging.getLogger(__name__)


class SimulationEvent(BaseModel):
    event_id: str
    tick: int
    event_type: str
    content: str
    satisfaction_delta: float
    room: str
    feeling: str
    action: str


class LifeSimulationAgent:
    """Autonomous, tick-based life simulation for one persona in one property."""

    def __init__(
        self,
        persona: Persona,
        property: Property,
        llm_client: UnifiedLLMClient,
        memory: MemoryStream,
    ) -> None:
        self.persona = persona
        self.property = property
        self.llm_client = llm_client
        self.memory = memory

        self.engine = EnvironmentEngine()
        self.satisfaction = self.engine.compute_initial_satisfaction(persona, property)
        self.mismatches = self.engine.compute_trait_environment_mismatches(persona, property)

        self.tick = 0
        self.events: List[SimulationEvent] = []
        self.flags: List[Dict[str, Any]] = []
        self.satisfaction_trajectory: List[float] = [self.satisfaction]

    def set_roommate_context(
        self,
        roommate_persona: "Persona",
        roommate_last_event: "SimulationEvent | None" = None,
    ) -> None:
        """Inject the other persona's last action so this agent reasons about shared living."""
        self._roommate_persona = roommate_persona
        self._roommate_last_event = roommate_last_event

    def perceive(self) -> List[str]:
        observations: List[str] = []

        for mismatch in self.mismatches:
            trait = mismatch.get("trait", "")
            severity = mismatch.get("severity", "low")

            if trait == "noise_sensitivity":
                if severity == "high":
                    observations.append(
                        "The ambient noise level in the apartment is high and genuinely bothers you."
                    )
                elif severity == "medium":
                    observations.append(
                        "There is noticeable noise in the apartment that affects your comfort."
                    )
                else:
                    observations.append(
                        "There is some background noise, but it is still manageable."
                    )

            elif trait == "thermal_sensitivity":
                if severity == "high":
                    observations.append(
                        "The apartment temperature feels uncomfortable — heating or cooling may be needed."
                    )
                elif severity == "medium":
                    observations.append(
                        "The temperature feels slightly off from your ideal range."
                    )
                else:
                    observations.append(
                        "The temperature is not ideal, but you can still tolerate it."
                    )

            elif trait == "smoker":
                observations.append(
                    "You cannot smoke inside — you need to step outside."
                )

            elif trait == "cleanliness":
                observations.append("The apartment isn't as clean as you'd like it to be.")

        # Varied shared-living daily scenarios (not just apartment mismatch)
        shared_scenarios = [
            "You are in the kitchen preparing a meal and thinking about how the shared space feels.",
            "You are working from home in your room, noticing sounds from the rest of the apartment.",
            "You are relaxing in the living room, which you share with your roommate.",
            "You are in the bathroom and thinking about the morning routine schedule.",
            "You are winding down for the evening and aware of your roommate's activity.",
            "You are having breakfast and thinking about the rhythm of living with someone else.",
            "You just came home and noticed how your roommate left the shared areas.",
            "You are trying to study or concentrate and notice what your roommate is doing.",
            "You pass through the hallway and briefly interact with your roommate.",
            "You are in your room but can hear what is happening in the rest of the apartment.",
            "It is mid-morning and you and your roommate are both home.",
            "You are thinking about whether the apartment routines feel sustainable.",
        ]
        observations.append(shared_scenarios[self.tick % len(shared_scenarios)])

        # Cohabitation-aware: inject what the other roommate just did
        if hasattr(self, "_roommate_persona") and self._roommate_persona:
            rp = self._roommate_persona
            re = getattr(self, "_roommate_last_event", None)
            if re:
                observations.append(
                    f"Your roommate {rp.name} just did: \"{re.action}\". "
                    f"They feel: \"{re.feeling}\"."
                )
            else:
                smoker_note = "is a smoker" if rp.traits.get("smoker") else "is a non-smoker"
                early_note = "wakes up early" if rp.traits.get("early_riser") else "is a night owl"
                observations.append(
                    f"Your roommate {rp.name} has moved in. They {smoker_note} and {early_note}."
                )

        return observations

    def reason(self, observations: List[str]) -> Dict[str, Any]:
        recalled = self.memory.retrieve(
            query=" ".join(observations),
            simulation_time=float(self.tick),
            top_k=3,
        )
        memory_text = (
            "; ".join(f"[{m.importance:.1f}] {m.content}" for m in recalled)
            if recalled
            else "No recent memories."
        )

        # Build roommate context for the prompt
        roommate_context = ""
        if hasattr(self, "_roommate_persona") and self._roommate_persona:
            rp = self._roommate_persona
            roommate_context = (
                f"\nYour roommate {rp.name} traits: "
                f"smoker={rp.traits.get('smoker', False)}, "
                f"early_riser={rp.traits.get('early_riser', False)}, "
                f"cleanliness={rp.traits.get('cleanliness', 0.5):.1f}, "
                f"noise_sensitivity={rp.traits.get('noise_sensitivity', 0.5):.1f}."
            )

        system_prompt = self.persona.to_system_prompt()
        user_message = (
            f"Hour {self.tick} living in this shared apartment.{roommate_context}\n"
            "Your observations this hour:\n"
            f"{chr(10).join(f'- {o}' for o in observations)}\n\n"
            f"Recent memories: {memory_text}\n"
            f"Current satisfaction: {self.satisfaction:.0%}\n\n"
            "Based on your personality and the shared-living context, respond with:\n"
            "1. How you feel right now about living with your roommate (one short sentence)\n"
            "2. Your comfort level this hour (integer 0-100)\n"
            "3. Is there a recurring problem worth flagging about the cohabitation? (yes or no, and brief reason if yes)\n"
            "4. One specific action you take this hour — make it varied and realistic for shared apartment life"
        )

        schema = {
            "feeling": "string",
            "comfort_level": 0,
            "flag_issue": False,
            "flag_reason": None,
            "action": "string",
        }
        reasoning = self.llm_client.complete_structured(
            system_prompt=system_prompt,
            user_message=user_message,
            output_schema=schema,
            temperature=0.7,  # Higher than 0.2 for more variation in actions
        )

        comfort_level = reasoning.get("comfort_level", 50)
        try:
            comfort_level = int(comfort_level)
        except (TypeError, ValueError):
            comfort_level = 50
        reasoning["comfort_level"] = max(0, min(100, comfort_level))

        reasoning["flag_issue"] = bool(reasoning.get("flag_issue", False))
        reasoning["flag_reason"] = reasoning.get("flag_reason")
        reasoning["feeling"] = str(reasoning.get("feeling", "I feel neutral right now."))
        reasoning["action"] = str(reasoning.get("action", "I continue my routine."))
        return reasoning

    def act(self, reasoning: Dict[str, Any]) -> SimulationEvent:
        new_satisfaction = reasoning["comfort_level"] / 100.0
        delta = new_satisfaction - self.satisfaction
        self.satisfaction = new_satisfaction
        self.satisfaction_trajectory.append(self.satisfaction)

        primary_room = self._determine_primary_room()
        event = SimulationEvent(
            event_id=str(uuid.uuid4()),
            tick=self.tick,
            event_type="hourly_update",
            content=reasoning["feeling"],
            satisfaction_delta=delta,
            room=primary_room,
            feeling=reasoning["feeling"],
            action=reasoning["action"],
        )
        self.events.append(event)

        tags = ["observation"] + (["flag"] if reasoning["flag_issue"] else [])
        self.memory.add_memory(
            content=f"{reasoning['feeling']} {reasoning['action']}",
            simulation_time=float(self.tick),
            tags=tags,
        )

        if reasoning["flag_issue"]:
            self.flags.append(
                {
                    "tick": self.tick,
                    "reason": reasoning.get("flag_reason"),
                    "satisfaction": self.satisfaction,
                }
            )

        return event

    def run_tick(self) -> SimulationEvent:
        observations = self.perceive()
        reasoning = self.reason(observations)
        event = self.act(reasoning)
        self.tick += 1
        return event

    def run_simulation(
        self,
        num_ticks: int = 12,
        progress_callback: Optional[Any] = None,
    ) -> Dict[str, Any]:
        for index in range(num_ticks):
            self.run_tick()

            tick_number = index + 1
            if progress_callback:
                progress_callback(
                    tick_number / num_ticks * 90,
                    f"Simulating hour {tick_number}/{num_ticks}...",
                )

            if self.tick > 0 and self.tick % 6 == 0:
                self.memory.reflect(float(self.tick))

        verdict = self.generate_verdict()
        if progress_callback:
            progress_callback(100, "Done.")

        summary = self.memory.get_summary()
        return {
            "subject_id": self.persona.subject_id,
            "property_id": self.property.property_id,
            "total_ticks": num_ticks,
            "final_satisfaction": self.satisfaction,
            "satisfaction_trajectory": self.satisfaction_trajectory,
            "flags": self.flags,
            "reflection": summary.get("latest_reflection"),
            "verdict": verdict,
            "events": [event.model_dump() for event in self.events],
        }

    def generate_verdict(self) -> str:
        system_prompt = self.persona.to_system_prompt()
        user_message = (
            f"You just spent {self.tick} hours in this apartment. "
            f"Your final satisfaction: {self.satisfaction:.0%}.\n"
            f"Issues flagged: {len(self.flags)}.\n\n"
            "Write 2 sentences from your perspective on whether this apartment "
            "suits your lifestyle. Be honest and specific."
        )
        return self.llm_client.complete(
            system_prompt=system_prompt,
            user_message=user_message,
            use_fast_model=True,
        )

    def _determine_primary_room(self) -> str:
        if not self.mismatches:
            return "Living Room"

        severity_rank = {"high": 3, "medium": 2, "low": 1}
        ranked = sorted(
            self.mismatches,
            key=lambda mismatch: (
                severity_rank.get(str(mismatch.get("severity", "low")), 1),
                abs(float(mismatch.get("satisfaction_delta", -0.05))),
            ),
            reverse=True,
        )
        return str(ranked[0].get("room", "Living Room"))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")

    demo_persona = Persona.from_traits(
        subject_id="noise123",
        name="NoiseSensitiveUser",
        traits={
            "introversion": 0.7,
            "noise_sensitivity": 0.95,
            "cleanliness": 0.65,
            "thermal_sensitivity": 0.4,
            "early_riser": True,
            "smoker": False,
        },
    )

    env_engine = EnvironmentEngine()
    noisy_property = env_engine.create_mock_property(
        property_type="2br",
        noise_level=0.95,
        temperature=0.5,
        smoking_allowed=False,
    )

    llm = UnifiedLLMClient()
    memory = MemoryStream(subject_id=demo_persona.subject_id, llm_client=llm)

    agent = LifeSimulationAgent(
        persona=demo_persona,
        property=noisy_property,
        llm_client=llm,
        memory=memory,
    )
    result = agent.run_simulation(num_ticks=4)

    print("Satisfaction trajectory:", result["satisfaction_trajectory"])
    print("Flags:", result["flags"])

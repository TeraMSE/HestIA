"""Simulation report assembly for EILS runs."""

from __future__ import annotations

from typing import Any, Dict, List

from .persona import Persona
from .environment_resolver import ActionOutcome


class SimReportBuilder:
    """Placeholder report builder; full diagnostics schema added later."""

    def build(
        self,
        persona: Persona,
        outcomes: List[ActionOutcome],
    ) -> Dict[str, Any]:
        return {
            "subject_id": persona.subject_id,
            "ticks": len(outcomes),
            "outcomes": [o.model_dump() for o in outcomes],
        }

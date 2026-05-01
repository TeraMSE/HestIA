"""Background simulation runner for SocialSimRun."""

from __future__ import annotations

import threading
import traceback
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def run_simulation(run_id: str) -> None:
    """Execute the full life simulation pipeline in a background thread."""
    # Import inside to avoid circular imports at module load time
    import django

    django.setup() if not django.conf.settings.configured else None

    from social_sim.models import SocialSimRun
    from social_sim.engine.llm_client import OllamaLLMClient
    from social_sim.engine.life_sim_engine import LifeSimEngine, LifeSimRequest
    from social_sim.engine.persona import Persona
    from social_sim.engine.compatibility_simple import compute_compatibility
    from social_sim.engine.mediation import MediationAgent
    from social_sim.engine.frame_builder import FrameBuilder
    from social_sim.engine.layout_builder import build_default_layout

    try:
        run = SocialSimRun.objects.get(pk=run_id)
    except SocialSimRun.DoesNotExist:
        logger.error("[SocialSim] Run %s not found", run_id)
        return

    def _update(progress: int, status: str = "running") -> None:
        SocialSimRun.objects.filter(pk=run_id).update(progress=progress, status=status)

    try:
        _update(2, "running")

        llm = OllamaLLMClient()

        engine = LifeSimEngine(llm_client=llm)

        persona_a_data = run.persona_a
        persona_b_data = run.persona_b
        env_data = run.environment_state
        layout_data = run.apartment_layout or build_default_layout()

        # ── Phase 1: Simulate Persona A (0→40 %) ─────────────────────
        req_a = LifeSimRequest(
            mode="solo",
            persona_a=persona_a_data,
            environment_state=env_data,
            num_ticks=24,
            use_daily_plan=True,
        )

        def cb_a(pct: int, msg: str) -> None:
            _update(int(pct * 0.4))

        result_a = engine.simulate_solo(req_a, progress_callback=cb_a)
        _update(40)

        # ── Phase 2: Simulate Persona B (40→70 %) ────────────────────
        result_b: Optional[dict] = None
        if persona_b_data:
            req_b = LifeSimRequest(
                mode="solo",
                persona_a=persona_b_data,
                environment_state=env_data,
                num_ticks=24,
                use_daily_plan=True,
            )

            def cb_b(pct: int, msg: str) -> None:
                _update(40 + int(pct * 0.3))

            result_b = engine.simulate_solo(req_b, progress_callback=cb_b)
        _update(70)

        # ── Phase 3: Compatibility (70→85 %) ─────────────────────────
        compat_result: Optional[dict] = None
        if result_b:
            persona_a = Persona.from_dict(persona_a_data)
            persona_b = Persona.from_dict(persona_b_data)
            compat_result = compute_compatibility(
                persona_a=persona_a,
                persona_b=persona_b,
                events_a=result_a.get("events", []),
                events_b=result_b.get("events", []),
            )
        _update(85)

        # ── Phase 4: Mediation (85→95 %) ─────────────────────────────
        mediation: Optional[dict] = None
        if compat_result:
            mediator = MediationAgent(llm_client=llm)
            name_a = result_a.get("persona_name", "Persona A")
            name_b = result_b.get("persona_name", "Persona B") if result_b else "Persona B"
            mediation = mediator.mediate(
                compatibility_result=compat_result,
                persona_a_name=name_a,
                persona_b_name=name_b,
            )
        _update(95)

        # ── Phase 5: Build frames (95→100 %) ─────────────────────────
        builder = FrameBuilder(layout=layout_data)
        replay = builder.build_full_sequence(
            run_id=str(run_id),
            result_a=result_a,
            result_b=result_b,
            compatibility_result=compat_result,
            mediation=mediation,
        )
        _update(100)

        # Persist results
        SocialSimRun.objects.filter(pk=run_id).update(
            status="completed",
            progress=100,
            result=replay.model_dump(),
            mediation_rules=mediation.get("rules", []) if mediation else [],
            mediation_summary=mediation.get("summary", "") if mediation else "",
            compatibility_score=(
                compat_result.get("compatibility_score") if compat_result else None
            ),
        )
        logger.info("[SocialSim] Run %s completed successfully.", run_id)

    except Exception as exc:
        err_text = traceback.format_exc()
        logger.error("[SocialSim] Run %s failed: %s", run_id, err_text)
        SocialSimRun.objects.filter(pk=run_id).update(
            status="failed",
            error=err_text[:4000],
        )


def start_simulation_thread(run_id: str) -> None:
    """Kick off the simulation in a daemon thread (mirrors room_sim pattern)."""
    t = threading.Thread(target=run_simulation, args=(str(run_id),), daemon=True)
    t.start()

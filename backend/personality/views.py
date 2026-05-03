"""
Personality Builder API — Django views.

Endpoints (all AllowAny — user is not authenticated during onboarding):

  POST /api/v1/personality/interview/start/
  POST /api/v1/personality/interview/respond/
  POST /api/v1/personality/interview/finalize/
  POST /api/v1/personality/sliders/save/
"""

from __future__ import annotations

import uuid
from typing import Dict

from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework import status

from personality_builder.llm_client import UnifiedLLMClient
from personality_builder.interviewer import InterviewerAgent, InterviewSession
from personality_builder.extractor import PersonalityExtractor
from personality_builder.reconciler import PersonalityReconciler

# ── In-memory session store (keyed by session_id string) ─────────────────────
# Suitable for development / single-worker. Ephemeral — cleared on server restart.
_SESSIONS: Dict[str, Dict] = {}


def _get_llm_client() -> UnifiedLLMClient:
    """Return a fresh LLM client (reads env vars set in Django settings)."""
    return UnifiedLLMClient()


# ── Helper: serialize session for progress responses ──────────────────────────

def _session_progress(session_data: dict) -> dict:
    session: InterviewSession = session_data["session"]
    agent: InterviewerAgent = session_data["agent"]
    return {
        "exchange_count": session.exchange_count,
        "missing_traits": agent.get_missing_traits(session),
        "target_exchanges": InterviewerAgent.TARGET_EXCHANGES,
        "max_exchanges": InterviewerAgent.MAX_EXCHANGES,
        "is_complete": session.is_complete,
    }


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/v1/personality/interview/start/
# ─────────────────────────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
def interview_start(request: Request) -> Response:
    """
    Start a new AI interview session.

    Request body (optional):
        { "name": "Alice" }

    Response:
        { "session_id": "...", "first_question": "..." }
    """
    name = request.data.get("name", "User")
    session_id = str(uuid.uuid4())

    try:
        client = _get_llm_client()
        agent = InterviewerAgent(llm_client=client)
        session = agent.start_session(subject_id=session_id, name=name)

        _SESSIONS[session_id] = {
            "session": session,
            "agent": agent,
            "client": client,
            "name": name,
            "complete": False,
            "result": None,
            "summary": None,
        }

        first_question = session.transcript[-1]["content"] if session.transcript else ""
        return Response(
            {"session_id": session_id, "first_question": first_question},
            status=status.HTTP_201_CREATED,
        )
    except Exception as exc:
        return Response(
            {"error": f"Failed to start interview: {exc}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/v1/personality/interview/respond/
# ─────────────────────────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
def interview_respond(request: Request) -> Response:
    """
    Send the user's reply and receive the next question.

    Request body:
        { "session_id": "...", "message": "..." }

    Response:
        {
            "assistant_message": "...",
            "is_complete": false,
            "exchange_count": 3,
            "missing_traits": [...],
            "progress": { ... }
        }
    """
    session_id = request.data.get("session_id", "")
    message = request.data.get("message", "").strip()

    if not session_id or session_id not in _SESSIONS:
        return Response({"error": "Session not found."}, status=status.HTTP_404_NOT_FOUND)
    if not message:
        return Response({"error": "message is required."}, status=status.HTTP_400_BAD_REQUEST)

    session_data = _SESSIONS[session_id]
    if session_data.get("complete"):
        return Response({"error": "Interview already complete. Call finalize."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        agent: InterviewerAgent = session_data["agent"]
        session: InterviewSession = session_data["session"]
        result = agent.process_user_response(session, message)

        if result["is_complete"]:
            session_data["complete"] = True

        return Response({
            "assistant_message": result["assistant_message"],
            "is_complete": result["is_complete"],
            "exchange_count": result["exchange_count"],
            "missing_traits": result["missing_traits"],
            "progress": _session_progress(session_data),
        })
    except Exception as exc:
        return Response(
            {"error": f"Interview step failed: {exc}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/v1/personality/interview/finalize/
# ─────────────────────────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
def interview_finalize(request: Request) -> Response:
    """
    Finalize an interview and get the full personality profile.

    Request body:
        { "session_id": "..." }

    Response:
        {
            "trait_vector": { ... },
            "slider_values": { ... },
            "confidence_per_trait": { ... },
            "low_confidence_traits": [...],
            "summary": "You are..."
        }
    """
    session_id = request.data.get("session_id", "")
    if not session_id or session_id not in _SESSIONS:
        return Response({"error": "Session not found."}, status=status.HTTP_404_NOT_FOUND)

    session_data = _SESSIONS[session_id]

    # Return cached result if already finalized
    if session_data.get("result"):
        recon: object = session_data["result"]
        return Response({
            "trait_vector": recon.trait_vector,
            "slider_values": recon.slider_values,
            "confidence_per_trait": recon.confidence_per_trait,
            "low_confidence_traits": recon.low_confidence_traits,
            "summary": session_data.get("summary", ""),
        })

    try:
        agent: InterviewerAgent = session_data["agent"]
        session: InterviewSession = session_data["session"]
        client: UnifiedLLMClient = session_data["client"]

        extractor = PersonalityExtractor(client)
        finalized = agent.finalize_session(session, extractor)

        reconciler = PersonalityReconciler()
        recon = reconciler.reconcile(finalized)
        summary = reconciler.generate_profile_summary(recon, client)

        session_data["result"] = recon
        session_data["summary"] = summary

        return Response({
            "trait_vector": recon.trait_vector,
            "slider_values": recon.slider_values,
            "confidence_per_trait": recon.confidence_per_trait,
            "low_confidence_traits": recon.low_confidence_traits,
            "summary": summary,
        })
    except Exception as exc:
        return Response(
            {"error": f"Finalization failed: {exc}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/v1/personality/interview/override/
# ─────────────────────────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
def interview_override(request: Request) -> Response:
    """
    Apply manual slider overrides to a finalized session.

    Request body:
        {
            "session_id": "...",
            "overrides": {
                "introversion": 65,
                "cleanliness": 80,
                "smoker": false,
                ...
            }
        }

    Response: updated trait_vector and slider_values.
    """
    session_id = request.data.get("session_id", "")
    overrides = request.data.get("overrides", {})

    if not session_id or session_id not in _SESSIONS:
        return Response({"error": "Session not found."}, status=status.HTTP_404_NOT_FOUND)

    session_data = _SESSIONS[session_id]
    recon = session_data.get("result")
    if recon is None:
        return Response({"error": "Session not finalized yet. Call finalize first."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        reconciler = PersonalityReconciler()
        for trait, value in overrides.items():
            # Numeric traits arrive as 0-100 int from sliders, normalize to 0-1
            numeric_traits = reconciler.NUMERIC_TRAITS
            if trait in numeric_traits and isinstance(value, (int, float)):
                reconciler.apply_manual_override(recon, trait, value / 100)
            else:
                reconciler.apply_manual_override(recon, trait, value)

        session_data["result"] = recon
        return Response({
            "trait_vector": recon.trait_vector,
            "slider_values": recon.slider_values,
        })
    except Exception as exc:
        return Response(
            {"error": f"Override failed: {exc}"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )


# ─────────────────────────────────────────────────────────────────────────────
# POST /api/v1/personality/sliders/
# ─────────────────────────────────────────────────────────────────────────────

@api_view(["POST"])
@permission_classes([AllowAny])
def sliders_save(request: Request) -> Response:
    """
    Build a trait_vector from direct slider values (Manual mode).

    Request body:
        {
            "openness": 60,
            "conscientiousness": 70,
            "extraversion": 45,
            "agreeableness": 55,
            "neuroticism": 30,
            "noise_sensitivity": 70,
            "cleanliness": 80,
            "thermal_sensitivity": 40,
            "early_riser": true,
            "smoker": false
        }
        All numeric values are 0-100; booleans are plain booleans.

    Response:
        { "trait_vector": { ... }, "slider_values": { ... } }
    """
    def _n(key: str, default: int = 50) -> float:
        val = request.data.get(key, default)
        try:
            return max(0.0, min(1.0, float(val) / 100))
        except (TypeError, ValueError):
            return default / 100

    def _b(key: str) -> bool:
        return bool(request.data.get(key, False))

    openness = _n("openness")
    conscientiousness = _n("conscientiousness")
    extraversion = _n("extraversion")
    agreeableness = _n("agreeableness")
    neuroticism = _n("neuroticism")
    noise_sensitivity = _n("noise_sensitivity")
    cleanliness = _n("cleanliness")
    thermal_sensitivity = _n("thermal_sensitivity")
    early_riser = _b("early_riser")
    smoker = _b("smoker")

    trait_vector = {
        "introversion": max(0.0, min(1.0, 1.0 - extraversion)),
        "openness": openness,
        "conscientiousness": conscientiousness,
        "extraversion": extraversion,
        "agreeableness": agreeableness,
        "neuroticism": neuroticism,
        "noise_sensitivity": noise_sensitivity,
        "cleanliness": cleanliness,
        "thermal_sensitivity": thermal_sensitivity,
        "early_riser": early_riser,
        "smoker": smoker,
    }

    slider_values = {k: (int(v * 100) if isinstance(v, float) else v) for k, v in trait_vector.items()}

    return Response({"trait_vector": trait_vector, "slider_values": slider_values})

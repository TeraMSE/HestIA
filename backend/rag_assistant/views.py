"""Views for the RAG assistant chat endpoint."""
from __future__ import annotations

import json
import logging

from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .retriever import get_retriever
from .generator import generate_answer

logger = logging.getLogger(__name__)


@csrf_exempt
@require_POST
def chat(request):
    """
    POST /api/v1/rag/chat/
    Body: { "message": "Quels documents pour un permis de bâtir ?" }
    Returns: { "answer": "...", "sources": [...], "confidence": 0.85, "suggested_question": "..." }
    """
    try:
        body = json.loads(request.body or b"{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid JSON"}, status=400)

    question = str(body.get("message", "")).strip()
    if not question:
        return JsonResponse(
            {"answer": "Please enter a question.", "sources": [], "confidence": 0.0, "suggested_question": ""},
            status=200,
        )

    try:
        retriever = get_retriever()
        chunks = retriever.search(question, top_k=5)
        result = generate_answer(question, chunks)
        return JsonResponse(result)
    except Exception as exc:
        logger.exception("RAG chat error: %s", exc)
        return JsonResponse(
            {"answer": f"Internal error: {exc}", "sources": [], "confidence": 0.0, "suggested_question": ""},
            status=500,
        )

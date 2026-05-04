"""
Generator – builds RAG answer using UnifiedLLMClient (TokenFactory → Groq → Ollama chain).
"""
from __future__ import annotations

import logging

from personality_builder.llm_client import UnifiedLLMClient

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """
You are HestIA, an AI assistant specialized in real estate administrative procedures in Tunisia.

Your role is to answer the user's question in a human, clear and helpful way, relying solely on the CONTEXT provided.

STRICT RULES:
1. Answer only the question asked.
2. Use only the information present in the CONTEXT.
3. Never invent a procedure, deadline, document, authority, cost or rule.
4. If information is not available in the context, say so plainly.
5. Do not force a fixed format. Choose the most natural structure for the question.
6. Be professional, reassuring and easy to understand.
7. Avoid overly long answers when the question is simple.
8. If a procedure may vary by municipality, governorate or personal situation, mention it.
9. You are not a lawyer, notary or official administration: your answers are a guide to understanding.

STYLE: human, fluid, educational, direct, structured when useful.

When the context is insufficient, say:
"I could not find enough information in the available sources to answer with certainty."
""".strip()


def _build_context(chunks: list[dict]) -> str:
    parts = []
    for i, chunk in enumerate(chunks, 1):
        text = chunk.get("text", "").strip()
        if not text:
            continue
        source = chunk.get("source_file", "unknown source")
        category = chunk.get("category", "")
        procedure = chunk.get("procedure", "")
        score = chunk.get("score", 0)
        parts.append(
            f"Document {i}\nSource: {source}\nCategory: {category}"
            f"\nProcedure: {procedure}\nScore: {score:.3f}\n\n{text}"
        )
    return "\n\n---\n\n".join(parts)


def generate_answer(question: str, chunks: list[dict]) -> dict:
    if not chunks:
        return {
            "answer": "No reliable source was found in the current knowledge base.",
            "sources": [],
            "confidence": 0.0,
            "suggested_question": "",
        }

    context = _build_context(chunks)

    user_message = (
        f"USER QUESTION:\n{question}\n\n"
        f"DOCUMENTARY CONTEXT:\n{context}\n\n"
        "INSTRUCTION:\n"
        "Answer the user's question naturally using only the documentary context. "
        "Do not add a 'Sources used' section."
    )

    try:
        client = UnifiedLLMClient()
        answer = client.complete(
            system_prompt=SYSTEM_PROMPT,
            user_message=user_message,
            temperature=0.2,
        )
    except Exception as exc:
        logger.exception("RAG LLM call failed: %s", exc)
        return {
            "answer": f"Error generating the response: {exc}",
            "sources": [],
            "confidence": 0.0,
            "suggested_question": "",
        }

    # Build deduplicated source list
    sources: list[dict] = []
    seen: set[str] = set()
    for chunk in chunks:
        sf = chunk.get("source_file", "")
        if sf and sf not in seen:
            sources.append({"source_file": sf, "score": round(float(chunk.get("score", 0)), 3)})
            seen.add(sf)

    avg_score = sum(float(c.get("score", 0)) for c in chunks) / len(chunks)

    # Suggested follow-up (best-effort, no crash if it fails)
    suggested_question = ""
    try:
        sugg_msg = (
            f"Initial question: {question}\n\n"
            f"Answer given: {answer}\n\n"
            "Suggest ONE short, useful follow-up question in English, "
            "with no explanation or quotation marks."
        )
        suggested_question = client.complete(
            system_prompt="You suggest a single relevant follow-up question for a Tunisian real estate assistant.",
            user_message=sugg_msg,
            temperature=0.4,
        ).strip(" -\"'")
    except Exception:
        pass

    return {
        "answer": answer,
        "sources": sources,
        "confidence": round(avg_score, 3),
        "suggested_question": suggested_question,
    }

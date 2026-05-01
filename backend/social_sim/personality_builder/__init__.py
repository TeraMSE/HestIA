"""Personality Builder package exports.

Uses lazy imports to avoid import-order issues during hot-reload (e.g. Streamlit).
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "PersonalityInterviewer",
    "PersonalityExtractor",
    "PersonalityKnowledgeGraph",
    "TraitReconciler",
]


def __getattr__(name: str) -> Any:
    if name == "PersonalityInterviewer":
        from .interviewer import PersonalityInterviewer

        return PersonalityInterviewer
    if name == "PersonalityExtractor":
        from .extractor import PersonalityExtractor

        return PersonalityExtractor
    if name == "PersonalityKnowledgeGraph":
        from .knowledge_graph import PersonalityKnowledgeGraph

        return PersonalityKnowledgeGraph
    if name == "TraitReconciler":
        from .reconciler import TraitReconciler

        return TraitReconciler
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

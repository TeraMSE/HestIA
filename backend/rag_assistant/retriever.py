"""
RAG Retriever – loads FAISS index + metadata from hestiaagent/data/vector_store
and exposes a search() method.
"""
from __future__ import annotations

import logging
import pickle
from pathlib import Path

import faiss
import numpy as np
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

# Path to the pre-built vector store (relative to backend root ../../hestiaagent/data)
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
VECTOR_DIR = _BACKEND_ROOT.parent / "hestiaagent" / "data" / "vector_store"

FAISS_INDEX_PATH = VECTOR_DIR / "chunks.index"
METADATA_PATH    = VECTOR_DIR / "chunks_metadata.pkl"

EMBEDDING_MODEL  = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

_retriever_instance: "Retriever | None" = None


class Retriever:
    def __init__(self) -> None:
        logger.info("RAG: loading embedding model %s", EMBEDDING_MODEL)
        self.model = SentenceTransformer(EMBEDDING_MODEL)

        logger.info("RAG: loading FAISS index from %s", FAISS_INDEX_PATH)
        self.index = faiss.read_index(str(FAISS_INDEX_PATH))

        with open(METADATA_PATH, "rb") as fh:
            self.metadata: list[dict] = pickle.load(fh)
        logger.info("RAG: ready – %d vectors", self.index.ntotal)

    def search(self, query: str, top_k: int = 5) -> list[dict]:
        embedding = self.model.encode(
            [query], normalize_embeddings=True
        ).astype("float32")

        scores, indices = self.index.search(embedding, top_k)
        results: list[dict] = []

        for score, idx in zip(scores[0], indices[0]):
            if idx == -1:
                continue
            chunk = self.metadata[idx]
            results.append(
                {
                    "score":       float(score),
                    "text":        chunk.get("text", ""),
                    "source_file": chunk.get("source_file", ""),
                    "category":    chunk.get("category", ""),
                    "procedure":   chunk.get("procedure_id", ""),
                }
            )
        return results


def get_retriever() -> Retriever:
    """Singleton – loaded once on first request."""
    global _retriever_instance
    if _retriever_instance is None:
        _retriever_instance = Retriever()
    return _retriever_instance

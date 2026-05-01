"""Memory abstraction for social agents."""

from __future__ import annotations

import logging
import math
import re
import uuid
import hashlib
from typing import Any, Dict, List, Optional

import chromadb
from pydantic import BaseModel, Field

try:
    from .llm_client import LLMCallError, UnifiedLLMClient
except ImportError:  # pragma: no cover - allows direct script execution
    from llm_client import LLMCallError, UnifiedLLMClient


logger = logging.getLogger(__name__)


class MemoryEntry(BaseModel):
    """A single autobiographical memory item for one subject."""

    memory_id: str
    subject_id: str
    content: str
    timestamp: float
    importance: float
    tags: List[str] = Field(default_factory=list)


class MemoryStream:
    """Generative Agents style memory stream with composite retrieval scoring."""

    def __init__(
        self,
        subject_id: str,
        llm_client: UnifiedLLMClient,
    ) -> None:
        self.subject_id = subject_id
        self.llm_client = llm_client

        self.client = chromadb.PersistentClient(path="./chroma_db/memories")
        self.collection = self.client.get_or_create_collection(
            name=f"memories_{subject_id}"
        )

        self.embedding_model = None
        try:
            from sentence_transformers import SentenceTransformer

            self.embedding_model = SentenceTransformer(
                "all-MiniLM-L6-v2",
                device="cpu",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "SentenceTransformer unavailable, using deterministic fallback embeddings: %s",
                exc,
            )

        logger.info(
            "MemoryStream initialized for subject_id=%s with CPU embeddings",
            subject_id,
        )

    def _rate_importance(self, content: str) -> float:
        """Rate event importance with fast model; fallback to 5 on parse failure."""
        system_prompt = (
            "You are rating event importance for a shared housing simulation."
        )
        user_prompt = (
            "Rate the importance of this event from 1 (mundane daily activity) to 10 "
            "(serious conflict or critical issue) for someone living in a shared "
            f"apartment.\nEvent: '{content}'\n"
            "Reply with ONLY a single integer 1-10."
        )

        try:
            response = self.llm_client.complete(
                system_prompt=system_prompt,
                user_message=user_prompt,
                use_fast_model=True,
            )
            match = re.search(r"\b(10|[1-9])\b", response)
            if not match:
                return 5.0
            value = float(match.group(1))
            return max(1.0, min(10.0, value))
        except (LLMCallError, ValueError, TypeError):
            return 5.0

    def add_memory(
        self,
        content: str,
        simulation_time: float,
        tags: Optional[List[str]] = None,
    ) -> str:
        """Add a memory with LLM-rated importance and return memory_id."""
        importance = self._rate_importance(content)
        return self._store_memory(
            content=content,
            simulation_time=simulation_time,
            importance=importance,
            tags=tags or [],
        )

    def retrieve(
        self,
        query: str,
        simulation_time: float,
        top_k: int = 5,
    ) -> List[MemoryEntry]:
        """Retrieve memories by composite score (recency, importance, relevance)."""
        top_k = max(1, top_k)
        query_embedding = self._embed(query)

        results = self.collection.query(
            query_embeddings=[query_embedding],
            n_results=20,
            include=["metadatas", "documents", "distances"],
        )

        ids = results.get("ids", [[]])[0]
        documents = results.get("documents", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]
        distances = results.get("distances", [[]])[0]

        scored: List[tuple[float, MemoryEntry]] = []
        for idx, memory_id in enumerate(ids):
            metadata = metadatas[idx] if idx < len(metadatas) else {}
            content = documents[idx] if idx < len(documents) else ""
            distance = float(distances[idx]) if idx < len(distances) else 1.0

            timestamp = float(metadata.get("timestamp", 0.0))
            importance = float(metadata.get("importance", 5.0))
            tags = self._parse_tags(metadata.get("tags", ""))

            time_delta = max(0.0, simulation_time - timestamp)
            recency = 0.5 ** (time_delta / 1.0)
            importance_norm = max(0.0, min(1.0, importance / 10.0))
            relevance = max(0.0, min(1.0, 1.0 - distance))
            score = 0.35 * recency + 0.35 * importance_norm + 0.30 * relevance

            entry = MemoryEntry(
                memory_id=memory_id,
                subject_id=self.subject_id,
                content=content,
                timestamp=timestamp,
                importance=importance,
                tags=tags,
            )
            scored.append((score, entry))

        scored.sort(key=lambda item: item[0], reverse=True)
        return [entry for _, entry in scored[:top_k]]

    def reflect(self, simulation_time: float) -> str:
        """Generate a reflection from top important memories and store it."""
        data = self.collection.get(include=["metadatas", "documents", "ids"])

        ids = data.get("ids", [])
        documents = data.get("documents", [])
        metadatas = data.get("metadatas", [])

        memories: List[MemoryEntry] = []
        for idx, memory_id in enumerate(ids):
            metadata = metadatas[idx] if idx < len(metadatas) else {}
            content = documents[idx] if idx < len(documents) else ""
            memories.append(
                MemoryEntry(
                    memory_id=memory_id,
                    subject_id=self.subject_id,
                    content=content,
                    timestamp=float(metadata.get("timestamp", 0.0)),
                    importance=float(metadata.get("importance", 5.0)),
                    tags=self._parse_tags(metadata.get("tags", "")),
                )
            )

        memories.sort(key=lambda memory: (memory.importance, memory.timestamp), reverse=True)
        top_memories = memories[:10]

        if top_memories:
            numbered_memories = "\n".join(
                f"{index + 1}. {memory.content} (importance={memory.importance:.1f})"
                for index, memory in enumerate(top_memories)
            )
        else:
            numbered_memories = "1. No notable memories recorded yet."

        reflection = self.llm_client.complete(
            system_prompt="You are reflecting on living experiences in a shared apartment.",
            user_message=(
                "Based on these recent experiences:\n"
                f"{numbered_memories}\n"
                "What are the 3 most important insights about living compatibility in "
                "this apartment? Be specific and practical. Max 3 sentences."
            ),
            use_fast_model=False,
        )

        self._store_memory(
            content=reflection,
            simulation_time=simulation_time,
            importance=7.0,
            tags=["reflection"],
        )
        return reflection

    def get_summary(self) -> Dict[str, Any]:
        """Return summary statistics for this subject memory stream."""
        data = self.collection.get(include=["metadatas", "documents", "ids"])

        ids = data.get("ids", [])
        documents = data.get("documents", [])
        metadatas = data.get("metadatas", [])

        conflict_count = 0
        reflection_count = 0
        latest_reflection: Optional[str] = None
        latest_reflection_ts = -math.inf

        for idx, _memory_id in enumerate(ids):
            metadata = metadatas[idx] if idx < len(metadatas) else {}
            tags = self._parse_tags(metadata.get("tags", ""))
            timestamp = float(metadata.get("timestamp", 0.0))
            content = documents[idx] if idx < len(documents) else ""

            if "conflict" in tags:
                conflict_count += 1
            if "reflection" in tags:
                reflection_count += 1
                if timestamp > latest_reflection_ts:
                    latest_reflection_ts = timestamp
                    latest_reflection = content

        return {
            "total_memories": len(ids),
            "conflict_count": conflict_count,
            "reflection_count": reflection_count,
            "latest_reflection": latest_reflection,
        }

    def _store_memory(
        self,
        content: str,
        simulation_time: float,
        importance: float,
        tags: List[str],
    ) -> str:
        """Store a memory entry with explicit importance and embedding."""
        memory_id = str(uuid.uuid4())
        embedding = self._embed(content)
        tags_clean = [tag.strip().lower() for tag in tags if tag and tag.strip()]

        self.collection.add(
            ids=[memory_id],
            documents=[content],
            embeddings=[embedding],
            metadatas=[
                {
                    "subject_id": self.subject_id,
                    "content": content,
                    "timestamp": float(simulation_time),
                    "importance": float(max(1.0, min(10.0, importance))),
                    "tags": ",".join(tags_clean),
                }
            ],
        )
        return memory_id

    @staticmethod
    def _parse_tags(tags_value: Any) -> List[str]:
        if not tags_value:
            return []
        if isinstance(tags_value, list):
            return [str(tag).strip().lower() for tag in tags_value if str(tag).strip()]
        return [tag.strip().lower() for tag in str(tags_value).split(",") if tag.strip()]

    def _embed(self, text: str) -> List[float]:
        """Return embedding vector (SentenceTransformer if available, else deterministic hash vector)."""
        if self.embedding_model is not None:
            try:
                return self.embedding_model.encode(text).tolist()
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "SentenceTransformer encode failed, switching to fallback embeddings: %s",
                    exc,
                )
                self.embedding_model = None

        dims = 64
        vector = [0.0] * dims
        for token in text.lower().split():
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            index = digest[0] % dims
            sign = 1.0 if (digest[1] % 2 == 0) else -1.0
            magnitude = (digest[2] / 255.0)
            vector[index] += sign * magnitude

        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0.0:
            return vector
        return [value / norm for value in vector]


MemoryStore = MemoryStream


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")

    client = UnifiedLLMClient()
    stream = MemoryStream(subject_id="demo_subject", llm_client=client)

    demo_memories = [
        ("Cooked dinner quietly in the kitchen.", 1.0, ["routine"]),
        (
            "Roommate played loud music at midnight and I couldn't sleep.",
            2.0,
            ["conflict", "noise"],
        ),
        ("We agreed to split cleaning tasks weekly.", 3.5, ["agreement", "cleaning"]),
        ("Temperature in bedroom was too hot overnight.", 4.0, ["comfort", "temperature"]),
        (
            "Argument happened over smoking near shared living room window.",
            5.0,
            ["conflict", "smoking"],
        ),
    ]

    for content, sim_time, tags in demo_memories:
        memory_id = stream.add_memory(content, simulation_time=sim_time, tags=tags)
        print(f"Added memory: {memory_id} | t={sim_time} | {tags}")

    print("\nRetrieved memories for conflict query:")
    retrieved = stream.retrieve(
        query="conflict about noise and smoking in shared apartment",
        simulation_time=6.0,
        top_k=5,
    )
    for idx, memory in enumerate(retrieved, start=1):
        print(f"{idx}. [{memory.importance:.1f}] {memory.content} | tags={memory.tags}")

    reflection = stream.reflect(simulation_time=6.5)
    print("\nReflection:")
    print(reflection)

    summary = stream.get_summary()
    print("\nSummary:")
    print(summary)

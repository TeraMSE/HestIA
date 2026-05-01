"""File-based cache for noise assessment results."""

from __future__ import annotations

import hashlib
import logging
import os
import time
from typing import Any


logger = logging.getLogger(__name__)


class _MemoryTTLCache:
    def __init__(self) -> None:
        self._store: dict[str, tuple[Any, float | None]] = {}

    def get(self, key: str, default: Any = None) -> Any:
        item = self._store.get(key)
        if item is None:
            return default
        value, expires_at = item
        if expires_at is not None and time.time() >= expires_at:
            self.delete(key)
            return default
        return value

    def set(self, key: str, value: Any, expire: int | None = None) -> None:
        expires_at = (time.time() + int(expire)) if expire else None
        self._store[key] = (value, expires_at)

    def delete(self, key: str) -> None:
        self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()

    def __len__(self) -> int:
        for key in list(self._store.keys()):
            self.get(key)
        return len(self._store)


class NoiseCache:
    def __init__(self) -> None:
        self.cache_dir = os.getenv("NOISE_CACHE_DIR", "./noise_cache")
        self.ttl_hours = int(os.getenv("NOISE_CACHE_TTL_HOURS", "24"))
        self.ttl_seconds = self.ttl_hours * 3600
        self.using_diskcache = True

        try:
            import diskcache

            self.cache = diskcache.Cache(self.cache_dir)
        except ModuleNotFoundError:
            self.using_diskcache = False
            self.cache = _MemoryTTLCache()
            logger.warning(
                "diskcache is not installed; using in-memory noise cache fallback. "
                "Install diskcache for persistent caching."
            )

    def _make_key(self, identifier: str, radius_m: int) -> str:
        raw = f"{identifier.lower().strip()}:{radius_m}"
        return hashlib.md5(raw.encode()).hexdigest()

    def get(self, identifier: str, radius_m: int) -> dict[str, Any] | None:
        key = self._make_key(identifier, radius_m)
        result = self.cache.get(key, default=None)
        if result is not None:
            logger.info("Cache hit for %s", identifier)
        return result

    def set(self, identifier: str, radius_m: int, result: dict[str, Any]) -> None:
        key = self._make_key(identifier, radius_m)
        self.cache.set(key, result, expire=self.ttl_seconds)
        logger.info(
            "Cached noise result for %s (TTL: %sh)",
            identifier,
            self.ttl_hours,
        )

    def invalidate(self, identifier: str, radius_m: int) -> None:
        key = self._make_key(identifier, radius_m)
        self.cache.delete(key)

    def clear_all(self) -> None:
        self.cache.clear()
        logger.info("Noise cache cleared")

    def stats(self) -> dict[str, Any]:
        return {
            "cache_size": len(self.cache),
            "cache_dir": self.cache_dir,
            "ttl_hours": self.ttl_hours,
        }


NoiseAssessmentCache = NoiseCache


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    cache = NoiseCache()
    identifier = "Avenue Habib Bourguiba, Tunis"
    radius = 600
    mock_result = {
        "noise_level": 0.62,
        "label": "Moderately Noisy",
        "source": "mock",
    }

    cache.set(identifier, radius, mock_result)
    retrieved = cache.get(identifier, radius)
    assert retrieved == mock_result, "Cache round-trip did not match"
    print("Cache round-trip OK")

    cache.clear_all()
    print("Cache cleared")

"""Caching utilities for thermal assessment outputs."""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any

from diskcache import Cache


class ThermalCache:
    """Simple 7-day cache wrapper for climate and thermal payloads."""

    def __init__(self, cache_dir: str = "./thermal_cache", ttl_days: int = 7) -> None:
        self.cache = Cache(cache_dir)
        self.ttl = timedelta(days=ttl_days)

    @staticmethod
    def build_key(*parts: Any) -> str:
        raw = "|".join(str(part) for part in parts)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def get(self, key: str) -> Any | None:
        payload = self.cache.get(key)
        if not payload:
            return None

        expires_at_raw = payload.get("expires_at")
        if not expires_at_raw:
            return None

        expires_at = datetime.fromisoformat(str(expires_at_raw))
        if datetime.now(timezone.utc) >= expires_at:
            self.cache.delete(key)
            return None

        return payload.get("data")

    def set(self, key: str, data: Any) -> None:
        expires_at = datetime.now(timezone.utc) + self.ttl
        self.cache.set(
            key,
            {
                "expires_at": expires_at.isoformat(),
                "data": data,
            },
        )

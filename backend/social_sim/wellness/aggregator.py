"""Aggregator that reads the six HestIA-LS pillars for a property and produces a wellness payload."""

from datetime import datetime, timezone, timedelta
from django.conf import settings
from .scoring import ratio_to_score, blend, STALE_DAYS
from core.services.grading import grade_from_score


def _is_stale(dt: datetime) -> bool:
    if dt is None:
        return True
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - dt).days > STALE_DAYS


def _try_noise(property_id: int) -> dict:
    """Read latest noise score from diskcache or DB."""
    try:
        import diskcache
        from django.conf import settings as s
        cache = diskcache.Cache(str(s.BASE_DIR / "noise_cache"))
        key = f"noise:{property_id}"
        cached = cache.get(key)
        if cached and "noise_score" in cached:
            ts = cached.get("assessed_at")
            ts_dt = datetime.fromisoformat(ts) if ts else None
            return {
                "score": float(cached["noise_score"]),
                "source": "noise_cache",
                "stale": _is_stale(ts_dt),
                "ts": ts,
            }
    except Exception:
        pass
    return {"score": None, "source": None, "stale": True, "ts": None}


def _try_neighborhood(property_id: int) -> dict:
    try:
        import diskcache
        from django.conf import settings as s
        cache = diskcache.Cache(str(s.BASE_DIR / "neighborhood_cache"))
        key = f"neighborhood:{property_id}"
        cached = cache.get(key)
        if cached and "overall_neighborhood_score" in cached:
            ts = cached.get("assessed_at")
            ts_dt = datetime.fromisoformat(ts) if ts else None
            return {
                "score": float(cached["overall_neighborhood_score"]),
                "source": "neighborhood_cache",
                "stale": _is_stale(ts_dt),
                "ts": ts,
            }
    except Exception:
        pass
    return {"score": None, "source": None, "stale": True, "ts": None}


def _try_thermal(property_id: int) -> dict:
    try:
        import diskcache
        from django.conf import settings as s
        cache = diskcache.Cache(str(s.BASE_DIR / "noise_cache"))
        key = f"thermal:{property_id}"
        cached = cache.get(key)
        if cached and "comfort_report" in cached:
            score = float((cached["comfort_report"] or {}).get("comfort_score", 0))
            ts = cached.get("assessed_at")
            ts_dt = datetime.fromisoformat(ts) if ts else None
            return {
                "score": score,
                "source": "thermal_cache",
                "stale": _is_stale(ts_dt),
                "ts": ts,
            }
    except Exception:
        pass
    return {"score": None, "source": None, "stale": True, "ts": None}


def _try_materiaux(property_id: int) -> dict:
    try:
        from materiaux.models import MaterialEstimate
        est = MaterialEstimate.objects.filter(property_id=property_id).latest("created_at")
        ratio = float((est.eval_budget or {}).get("ratio", 1.0))
        score = ratio_to_score(ratio)
        return {
            "score": score,
            "source": f"MaterialEstimate#{est.pk}",
            "stale": _is_stale(est.created_at),
            "ts": est.created_at.isoformat(),
        }
    except Exception:
        pass
    return {"score": None, "source": None, "stale": True, "ts": None}


def _try_appliances(property_id: int) -> dict:
    try:
        from appliances.models import ApplianceScan
        scan = ApplianceScan.objects.filter(property_id=property_id).latest("created_at")
        return {
            "score": float(scan.global_score),
            "source": f"ApplianceScan#{scan.pk}",
            "stale": _is_stale(scan.created_at),
            "ts": scan.created_at.isoformat(),
        }
    except Exception:
        pass
    return {"score": None, "source": None, "stale": True, "ts": None}


def _try_compatibility(property_id: int) -> dict:
    try:
        from social_sim.models import SimulationRun
        run = SimulationRun.objects.filter(property_id=property_id).latest("created_at")
        full = run.full_report or {}
        score = float(full.get("overall_score") or full.get("overallScore") or 0)
        return {
            "score": score,
            "source": f"CompatibilityRun#{run.pk}",
            "stale": _is_stale(run.created_at),
            "ts": run.created_at.isoformat(),
        }
    except Exception:
        pass
    return {"score": None, "source": None, "stale": True, "ts": None}


def aggregate(property_id: int) -> dict:
    """Build the full wellness payload for a property."""
    weights = getattr(settings, "WELLNESS_WEIGHTS", {
        "noise": 0.15, "neighborhood": 0.15, "thermal": 0.15,
        "materiaux": 0.20, "appliances": 0.15, "compatibility": 0.20,
    })

    pillars = {
        "noise":         _try_noise(property_id),
        "neighborhood":  _try_neighborhood(property_id),
        "thermal":       _try_thermal(property_id),
        "materiaux":     _try_materiaux(property_id),
        "appliances":    _try_appliances(property_id),
        "compatibility": _try_compatibility(property_id),
    }

    scores = {k: v["score"] for k, v in pillars.items()}
    wellness_score = round(blend(scores, weights))
    missing = [k for k, v in scores.items() if v is None]

    return {
        "property_id": property_id,
        "wellness_score": wellness_score,
        "grade": grade_from_score(wellness_score),
        "pillars": pillars,
        "weights": weights,
        "missing": missing,
    }

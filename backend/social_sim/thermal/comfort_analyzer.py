"""Thermal comfort analysis for SITA monthly estimates."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel

from .indoor_estimator import IndoorTemperatureEstimate


class MonthComfortBand(str, Enum):
    COMFORTABLE = "comfortable"
    WARM = "warm"
    HOT = "hot"
    EXTREME_HEAT = "extreme_heat"
    COOL = "cool"
    COLD = "cold"


class ComfortReport(BaseModel):
    comfortable_months: list[str]
    warm_months: list[str]
    hot_months: list[str]
    extreme_months: list[str]
    cool_months: list[str]
    cold_months: list[str]
    months_in_comfort_band: int
    comfort_score: float
    worst_month: str
    worst_month_indoor_temp: float
    best_month: str
    best_month_indoor_temp: float
    overheating_warning: bool
    cold_warning: bool
    annual_discomfort_severity: str
    recommendations: list[str]
    simulation_impact: dict[str, Any]


class ComfortAnalyzer:
    """Computes comfort profile and recommendations from indoor temperature estimates."""

    def analyze(
        self,
        estimates: list[IndoorTemperatureEstimate],
        has_cooling: bool,
        has_heating: bool,
    ) -> ComfortReport:
        bands: dict[int, MonthComfortBand] = {
            estimate.month: self._classify_band(estimate.indoor_mean)
            for estimate in estimates
        }

        comfortable_months = [
            estimate.month_name
            for estimate in estimates
            if bands.get(estimate.month) == MonthComfortBand.COMFORTABLE
        ]
        warm_months = [
            estimate.month_name
            for estimate in estimates
            if bands.get(estimate.month) == MonthComfortBand.WARM
        ]
        hot_months = [
            estimate.month_name
            for estimate in estimates
            if bands.get(estimate.month) == MonthComfortBand.HOT
        ]
        extreme_months = [
            estimate.month_name
            for estimate in estimates
            if bands.get(estimate.month) == MonthComfortBand.EXTREME_HEAT
        ]
        cool_months = [
            estimate.month_name
            for estimate in estimates
            if bands.get(estimate.month) == MonthComfortBand.COOL
        ]
        cold_months = [
            estimate.month_name
            for estimate in estimates
            if bands.get(estimate.month) == MonthComfortBand.COLD
        ]

        simulation_impact = {
            f"month_{estimate.month}": {
                "indoor_temp": estimate.indoor_mean,
                "overheating_risk": estimate.overheating_risk,
                "cold_risk": estimate.cold_risk,
                "comfort_met": estimate.comfort_band_met,
            }
            for estimate in estimates
        }

        worst = max(estimates, key=lambda estimate: abs(estimate.indoor_mean - 21.0))
        best = min(estimates, key=lambda estimate: abs(estimate.indoor_mean - 21.0))

        return ComfortReport(
            comfortable_months=comfortable_months,
            warm_months=warm_months,
            hot_months=hot_months,
            extreme_months=extreme_months,
            cool_months=cool_months,
            cold_months=cold_months,
            months_in_comfort_band=len(comfortable_months),
            comfort_score=self._compute_score(estimates),
            worst_month=worst.month_name,
            worst_month_indoor_temp=worst.indoor_mean,
            best_month=best.month_name,
            best_month_indoor_temp=best.indoor_mean,
            overheating_warning=any(estimate.overheating_risk != "none" for estimate in estimates),
            cold_warning=any(estimate.cold_risk != "none" for estimate in estimates),
            annual_discomfort_severity=self._severity(estimates),
            recommendations=self._recommendations(estimates, has_cooling, has_heating),
            simulation_impact=simulation_impact,
        )

    def _classify_band(self, indoor_mean: float) -> MonthComfortBand:
        if indoor_mean >= 35:
            return MonthComfortBand.EXTREME_HEAT
        if indoor_mean >= 30:
            return MonthComfortBand.HOT
        if indoor_mean >= 26.5:
            return MonthComfortBand.WARM
        if indoor_mean >= 16:
            return MonthComfortBand.COMFORTABLE
        if indoor_mean >= 13:
            return MonthComfortBand.COOL
        return MonthComfortBand.COLD

    def _compute_score(self, estimates: list[IndoorTemperatureEstimate]) -> float:
        weights = {
            MonthComfortBand.COMFORTABLE: 1.0,
            MonthComfortBand.WARM: 0.6,
            MonthComfortBand.COOL: 0.7,
            MonthComfortBand.HOT: 0.3,
            MonthComfortBand.COLD: 0.4,
            MonthComfortBand.EXTREME_HEAT: 0.0,
        }
        if not estimates:
            return 0.0

        weighted_total = sum(weights[self._classify_band(estimate.indoor_mean)] for estimate in estimates)
        raw_score = weighted_total / 12.0
        clamped = max(0.0, min(1.0, raw_score))
        return round(clamped, 3)

    def _severity(self, estimates: list[IndoorTemperatureEstimate]) -> str:
        bad_months = sum(
            1
            for estimate in estimates
            if estimate.overheating_risk in {"mild", "severe"}
            or estimate.cold_risk in {"mild", "severe"}
        )
        if bad_months >= 5:
            return "high"
        if bad_months >= 2:
            return "medium"
        return "low"

    def _recommendations(
        self,
        estimates: list[IndoorTemperatureEstimate],
        has_cooling: bool,
        has_heating: bool,
    ) -> list[str]:
        recommendations: list[str] = []

        extreme_heat_count = sum(1 for estimate in estimates if estimate.indoor_mean >= 35)
        hot_count = sum(1 for estimate in estimates if estimate.indoor_mean >= 30)
        cold_count = sum(1 for estimate in estimates if estimate.indoor_mean < 13)

        if extreme_heat_count > 0 and not has_cooling:
            recommendations.append(
                "🌡️ Summer overheating is severe (>35°C est. indoor). Install fans or AC before signing."
            )

        if hot_count >= 3 and not has_cooling:
            recommendations.append(
                "🔥 At least 3 months estimated above 30°C indoors. A portable AC or ceiling fan is strongly recommended."
            )

        if cold_count > 0 and not has_heating:
            recommendations.append(
                "🥶 Winter cold risk detected. Inspect insulation and consider electric heaters."
            )

        if estimates:
            sample_meta = estimates[0].correction_factors_applied
            orientation = str(sample_meta.get("orientation", "unknown")).lower()
            floor_number = int(sample_meta.get("floor_number", sample_meta.get("floor_key", 0)) or 0)
            has_balcony = bool(sample_meta.get("has_balcony", False))

            if orientation in {"south", "west"} and floor_number > 5:
                recommendations.append(
                    "☀️ High solar exposure. Thermal curtains or exterior shutters can reduce summer peak temperature by up to 4°C."
                )

            if has_balcony:
                recommendations.append(
                    "🌬️ Balcony enables effective night ventilation in shoulder seasons — open windows after 22:00 in summer to flush hot air."
                )

        return recommendations

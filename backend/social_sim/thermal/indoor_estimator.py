"""Indoor temperature estimation utilities for SITA."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from .climate_fetcher import MonthlyClimateStats, YearlyClimateSummary


class IndoorTemperatureEstimate(BaseModel):
    month: int
    month_name: str
    outdoor_mean: float
    outdoor_max_avg: float
    outdoor_min_avg: float
    indoor_mean: float
    indoor_daily_max: float
    indoor_daily_min: float
    indoor_swing: float
    comfort_band_met: bool
    overheating_risk: str
    cold_risk: str
    correction_factors_applied: dict[str, Any]


class IndoorEstimator:
    """Applies a simplified RC thermal model to monthly climate stats."""

    COMFORT_MIN = 16.0
    COMFORT_MAX = 26.5

    SUMMER_MONTHS = {6, 7, 8, 9}
    WINTER_MONTHS = {12, 1, 2, 3}

    MASS_DAMPING = {
        "heavy": 0.55,
        "medium": 0.72,
        "light": 0.88,
    }

    ORIENTATION_SOLAR = {
        "south": {"summer": +1.5, "winter": +2.0},
        "north": {"summer": -0.5, "winter": -1.5},
        "east": {"summer": +0.5, "winter": +0.5},
        "west": {"summer": +1.0, "winter": +0.5},
        "unknown": {"summer": 0.0, "winter": 0.0},
    }

    FLOOR_CORRECTION = {
        "summer": {
            1: -1.5,
            2: -0.8,
            3: 0.0,
            4: 0.0,
            5: 0.5,
            6: 0.8,
            7: 1.0,
            8: 1.2,
            9: 1.5,
            10: 2.0,
        },
        "winter": {
            1: +1.0,
            2: +0.5,
            3: 0.0,
            4: 0.0,
            5: -0.3,
            6: -0.5,
            7: -0.7,
            8: -0.8,
            9: -1.0,
            10: -1.2,
        },
    }

    VENTILATION_COOLING = {
        (True, True): -1.5,
        (True, False): -0.8,
        (False, True): -1.0,
        (False, False): +2.0,
    }

    CONDITION_INSULATION = {
        "new": 0.85,
        "good": 1.00,
        "fair": 1.15,
        "poor": 1.30,
    }

    INTERNAL_GAIN = 0.8

    def estimate(
        self,
        climate_stats: MonthlyClimateStats,
        floor_number: int,
        orientation: str,
        building_mass: str,
        building_condition: str,
        has_balcony: bool,
        has_windows: bool,
        has_cooling: bool,
        has_heating: bool,
    ) -> IndoorTemperatureEstimate:
        month = int(climate_stats.month)
        t_out_mean = float(climate_stats.temp_mean)
        t_out_max = float(climate_stats.temp_max_avg)
        t_out_min = float(climate_stats.temp_min_avg)
        t_out_swing = t_out_max - t_out_min

        season = (
            "summer"
            if month in self.SUMMER_MONTHS
            else "winter"
            if month in self.WINTER_MONTHS
            else "shoulder"
        )

        t_indoor = t_out_mean
        corrections: dict[str, Any] = {
            "season": season,
            "building_mass": building_mass,
            "orientation": orientation,
            "building_condition": building_condition,
            "floor_number": int(floor_number),
            "has_balcony": bool(has_balcony),
            "has_windows": bool(has_windows),
        }

        mass_key = str(building_mass).strip().lower()
        damping = self.MASS_DAMPING.get(mass_key, self.MASS_DAMPING["medium"])
        indoor_swing = t_out_swing * damping
        corrections["thermal_mass_damping"] = damping

        orientation_key = str(orientation).strip().lower()
        season_key = season if season != "shoulder" else "summer"
        orient_correction = self.ORIENTATION_SOLAR.get(
            orientation_key,
            self.ORIENTATION_SOLAR["unknown"],
        ).get(season_key, 0.0)
        t_indoor += orient_correction
        corrections["orientation_gain"] = orient_correction

        floor_key = min(max(1, int(floor_number)), 10)
        floor_corr = self.FLOOR_CORRECTION.get(season_key, {}).get(floor_key, 0.0)
        t_indoor += floor_corr
        corrections["floor_key"] = floor_key
        corrections["floor_correction"] = floor_corr

        vent_key = (bool(has_balcony), bool(has_windows))
        vent_corr = (
            self.VENTILATION_COOLING.get(vent_key, 0.0)
            if season == "summer"
            else 0.0
        )
        t_indoor += vent_corr
        corrections["ventilation_cooling"] = vent_corr

        t_indoor += self.INTERNAL_GAIN
        corrections["internal_gains"] = self.INTERNAL_GAIN

        condition_key = str(building_condition).strip().lower()
        deviation = t_indoor - t_out_mean
        insulation_factor = self.CONDITION_INSULATION.get(condition_key, 1.0)
        t_indoor = t_out_mean + deviation * insulation_factor
        corrections["insulation_factor"] = insulation_factor

        if has_cooling and t_indoor > self.COMFORT_MAX:
            t_indoor = self.COMFORT_MAX
            corrections["cooling_clipped"] = True
        if has_heating and t_indoor < 18.0:
            t_indoor = 18.0
            corrections["heating_clipped"] = True

        indoor_max = t_indoor + (indoor_swing * 0.5)
        indoor_min = t_indoor - (indoor_swing * 0.5)

        comfort_met = self.COMFORT_MIN <= t_indoor <= self.COMFORT_MAX

        if t_indoor > 34 or climate_stats.days_above_35 > 8:
            overheating_risk = "severe"
        elif t_indoor > 29 or climate_stats.days_above_30 > 10:
            overheating_risk = "mild"
        else:
            overheating_risk = "none"

        if t_indoor < 12:
            cold_risk = "severe"
        elif t_indoor < 16:
            cold_risk = "mild"
        else:
            cold_risk = "none"

        return IndoorTemperatureEstimate(
            month=month,
            month_name=climate_stats.month_name,
            outdoor_mean=round(t_out_mean, 1),
            outdoor_max_avg=round(t_out_max, 1),
            outdoor_min_avg=round(t_out_min, 1),
            indoor_mean=round(t_indoor, 1),
            indoor_daily_max=round(indoor_max, 1),
            indoor_daily_min=round(indoor_min, 1),
            indoor_swing=round(indoor_swing, 1),
            comfort_band_met=bool(comfort_met),
            overheating_risk=overheating_risk,
            cold_risk=cold_risk,
            correction_factors_applied=corrections,
        )

    def estimate_full_year(
        self,
        climate_summary: YearlyClimateSummary,
        floor_number: int,
        orientation: str,
        building_mass: str,
        building_condition: str,
        has_balcony: bool,
        has_windows: bool,
        has_cooling: bool,
        has_heating: bool,
    ) -> list[IndoorTemperatureEstimate]:
        return [
            self.estimate(
                month_stats,
                floor_number,
                orientation,
                building_mass,
                building_condition,
                has_balcony,
                has_windows,
                has_cooling,
                has_heating,
            )
            for month_stats in climate_summary.monthly_stats
        ]


if __name__ == "__main__":
    july_tunis = MonthlyClimateStats(
        month=7,
        month_name="July",
        temp_mean=32.0,
        temp_max_avg=37.0,
        temp_min_avg=27.0,
        temp_max_extreme=45.0,
        temp_min_extreme=20.0,
        humidity_mean=58.0,
        precipitation_mm=2.0,
        wind_speed_avg=18.0,
        solar_radiation_mj=28.0,
        days_above_30=24.0,
        days_above_35=12.0,
        days_below_10=0.0,
        days_below_5=0.0,
        comfort_assessment="hot",
    )

    estimator = IndoorEstimator()

    scenario_a = estimator.estimate(
        climate_stats=july_tunis,
        floor_number=5,
        orientation="south",
        building_mass="heavy",
        building_condition="good",
        has_balcony=True,
        has_windows=True,
        has_cooling=False,
        has_heating=False,
    )

    scenario_b = estimator.estimate(
        climate_stats=july_tunis,
        floor_number=1,
        orientation="north",
        building_mass="heavy",
        building_condition="good",
        has_balcony=True,
        has_windows=True,
        has_cooling=False,
        has_heating=False,
    )

    print("Scenario A (floor 5, south)")
    print(f"Indoor mean: {scenario_a.indoor_mean}°C")
    print(f"Indoor max/min: {scenario_a.indoor_daily_max} / {scenario_a.indoor_daily_min}°C")
    print(f"Correction factors: {scenario_a.correction_factors_applied}")
    print()
    print("Scenario B (floor 1, north)")
    print(f"Indoor mean: {scenario_b.indoor_mean}°C")
    print(f"Indoor max/min: {scenario_b.indoor_daily_max} / {scenario_b.indoor_daily_min}°C")
    print(f"Correction factors: {scenario_b.correction_factors_applied}")
    print()
    print("Comparison")
    print(f"Indoor mean delta (A - B): {round(scenario_a.indoor_mean - scenario_b.indoor_mean, 1)}°C")

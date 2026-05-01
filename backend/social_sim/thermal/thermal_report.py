"""Thermal assessment report builder for SITA."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from .climate_fetcher import ClimateFetcher
from .comfort_analyzer import ComfortAnalyzer
from .indoor_estimator import IndoorEstimator


class ThermalAssessmentReport(BaseModel):
    lat: float
    lon: float
    address: str

    floor_number: int
    orientation: str
    building_mass: str
    building_condition: str
    has_cooling: bool
    has_heating: bool
    has_balcony: bool

    climate_summary: dict
    monthly_estimates: list[dict]
    comfort_report: dict

    monthly_indoor_temps: dict[int, float]
    current_month_temp: float
    simulation_thermal_state: str

    report_timestamp: str
    data_source: str = "Open-Meteo Historical API (ERA5)"


class ThermalReportBuilder:
    """Builds full SITA thermal assessment reports from coordinates and apartment metadata."""

    def build(
        self,
        lat: float,
        lon: float,
        address: str,
        floor_number: int,
        orientation: str = "unknown",
        building_mass: str = "heavy",
        building_condition: str = "good",
        has_cooling: bool = False,
        has_heating: bool = False,
        has_balcony: bool = False,
        has_windows: bool = True,
    ) -> ThermalAssessmentReport:
        fetcher = ClimateFetcher()
        estimator = IndoorEstimator()
        analyzer = ComfortAnalyzer()

        climate = fetcher.fetch_historical(lat, lon, years=10)

        estimates = estimator.estimate_full_year(
            climate,
            floor_number,
            orientation,
            building_mass,
            building_condition,
            has_balcony,
            has_windows,
            has_cooling,
            has_heating,
        )

        comfort = analyzer.analyze(estimates, has_cooling, has_heating)

        monthly_temps = {estimate.month: estimate.indoor_mean for estimate in estimates}

        current_month = datetime.now().month
        default_temp = estimates[5].indoor_mean if len(estimates) > 5 else (estimates[0].indoor_mean if estimates else 21.0)
        current_temp = monthly_temps.get(current_month, default_temp)

        if current_temp > 28:
            state = "hot"
        elif current_temp < 16:
            state = "cold"
        else:
            state = "comfortable"

        return ThermalAssessmentReport(
            lat=lat,
            lon=lon,
            address=address,
            floor_number=floor_number,
            orientation=orientation,
            building_mass=building_mass,
            building_condition=building_condition,
            has_cooling=has_cooling,
            has_heating=has_heating,
            has_balcony=has_balcony,
            climate_summary=climate.model_dump(),
            monthly_estimates=[estimate.model_dump() for estimate in estimates],
            comfort_report=comfort.model_dump(),
            monthly_indoor_temps=monthly_temps,
            current_month_temp=current_temp,
            simulation_thermal_state=state,
            report_timestamp=datetime.now().isoformat(),
        )


if __name__ == "__main__":
    builder = ThermalReportBuilder()
    report = builder.build(
        lat=36.8065,
        lon=10.1815,
        address="Tunis",
        floor_number=5,
        orientation="south",
        building_mass="heavy",
        building_condition="good",
        has_cooling=False,
        has_heating=False,
        has_balcony=True,
        has_windows=True,
    )

    print("Monthly indoor temperature table")
    for month, temp in sorted(report.monthly_indoor_temps.items()):
        print(f"Month {month}: {temp}°C")

    comfort = report.comfort_report
    print()
    print("Comfort months:", comfort.get("comfortable_months", []))
    print("Hot months:", comfort.get("hot_months", []))
    print()
    print("Recommendations:")
    for rec in comfort.get("recommendations", []):
        print("-", rec)
    print()
    print("Simulation thermal state:", report.simulation_thermal_state)

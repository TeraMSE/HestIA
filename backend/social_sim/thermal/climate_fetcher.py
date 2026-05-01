"""Open-Meteo historical climate client for SITA."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import numpy as np
import pandas as pd
import requests
from pydantic import BaseModel

from .cache import ThermalCache


MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]


class MonthlyClimateStats(BaseModel):
    month: int
    month_name: str
    temp_mean: float
    temp_max_avg: float
    temp_min_avg: float
    temp_max_extreme: float
    temp_min_extreme: float
    humidity_mean: float
    precipitation_mm: float
    wind_speed_avg: float
    solar_radiation_mj: float
    days_above_30: float
    days_above_35: float
    days_below_10: float
    days_below_5: float
    comfort_assessment: str


class YearlyClimateSummary(BaseModel):
    lat: float
    lon: float
    location_name: str = ""
    data_years: int
    start_year: int
    end_year: int
    monthly_stats: list[MonthlyClimateStats]
    annual_mean_temp: float
    annual_max_temp: float
    annual_min_temp: float
    annual_precipitation_mm: float
    hottest_month: str
    coldest_month: str
    hottest_month_avg: float
    coldest_month_avg: float
    heat_stress_months: list[str]
    cold_stress_months: list[str]
    climate_type: str


class ClimateFetcher:
    ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

    DAILY_VARIABLES = [
        "temperature_2m_max",
        "temperature_2m_min",
        "temperature_2m_mean",
        "apparent_temperature_mean",
        "precipitation_sum",
        "rain_sum",
        "windspeed_10m_max",
        "relative_humidity_2m_mean",
        "shortwave_radiation_sum",
        "et0_fao_evapotranspiration",
        "cloudcover_mean",
    ]

    def __init__(self) -> None:
        self.cache = ThermalCache(cache_dir="./thermal_cache", ttl_days=7)
        self.session = requests.Session()

    def fetch_historical(
        self,
        lat: float,
        lon: float,
        years: int = 10,
        location_name: str = "",
    ) -> YearlyClimateSummary:
        cache_key = f"climate_{lat:.3f}_{lon:.3f}_{years}yr"
        cached = self.cache.get(cache_key)
        if cached:
            return YearlyClimateSummary(**cached)

        end_year = datetime.now().year - 1
        start_year = end_year - int(years) + 1

        params = {
            "latitude": float(lat),
            "longitude": float(lon),
            "start_date": f"{start_year}-01-01",
            "end_date": f"{end_year}-12-31",
            "daily": ",".join(self.DAILY_VARIABLES),
            "timezone": "auto",
        }

        response = self.session.get(self.ARCHIVE_URL, params=params, timeout=30)
        response.raise_for_status()
        payload = response.json()

        daily = payload.get("daily") or {}
        if not daily:
            raise ValueError("Open-Meteo response does not contain daily data")

        df = pd.DataFrame(daily)
        if "time" not in df.columns:
            raise ValueError("Open-Meteo daily payload is missing time series")

        df["date"] = pd.to_datetime(df["time"], errors="coerce")
        df = df.dropna(subset=["date"]).copy()
        df["month"] = df["date"].dt.month
        df["year"] = df["date"].dt.year

        numeric_columns = [
            "temperature_2m_max",
            "temperature_2m_min",
            "temperature_2m_mean",
            "apparent_temperature_mean",
            "precipitation_sum",
            "rain_sum",
            "windspeed_10m_max",
            "relative_humidity_2m_mean",
            "shortwave_radiation_sum",
            "et0_fao_evapotranspiration",
            "cloudcover_mean",
        ]
        for column in numeric_columns:
            if column not in df.columns:
                df[column] = np.nan
            df[column] = pd.to_numeric(df[column], errors="coerce")

        used_years = int(df["year"].nunique()) if not df.empty else int(years)
        used_years = max(1, used_years)

        monthly_stats: list[MonthlyClimateStats] = []
        for month in range(1, 13):
            month_df = df[df["month"] == month]
            stats = MonthlyClimateStats(
                month=month,
                month_name=MONTH_NAMES[month - 1],
                temp_mean=self._safe_float(month_df["temperature_2m_mean"].mean()),
                temp_max_avg=self._safe_float(month_df["temperature_2m_max"].mean()),
                temp_min_avg=self._safe_float(month_df["temperature_2m_min"].mean()),
                temp_max_extreme=self._safe_float(month_df["temperature_2m_max"].max()),
                temp_min_extreme=self._safe_float(month_df["temperature_2m_min"].min()),
                humidity_mean=self._safe_float(month_df["relative_humidity_2m_mean"].mean()),
                precipitation_mm=self._safe_float(month_df["precipitation_sum"].sum() / used_years),
                wind_speed_avg=self._safe_float(month_df["windspeed_10m_max"].mean()),
                solar_radiation_mj=self._safe_float(month_df["shortwave_radiation_sum"].mean()),
                days_above_30=self._safe_float((month_df["temperature_2m_max"] > 30).sum() / used_years),
                days_above_35=self._safe_float((month_df["temperature_2m_max"] > 35).sum() / used_years),
                days_below_10=self._safe_float((month_df["temperature_2m_min"] < 10).sum() / used_years),
                days_below_5=self._safe_float((month_df["temperature_2m_min"] < 5).sum() / used_years),
                comfort_assessment=self._assess_month_comfort(month_df),
            )
            monthly_stats.append(stats)

        climate_type = self._classify_climate(df, monthly_stats)

        hottest = max(monthly_stats, key=lambda item: item.temp_mean)
        coldest = min(monthly_stats, key=lambda item: item.temp_mean)

        summary = YearlyClimateSummary(
            lat=float(lat),
            lon=float(lon),
            location_name=location_name,
            data_years=used_years,
            start_year=start_year,
            end_year=end_year,
            monthly_stats=monthly_stats,
            annual_mean_temp=self._safe_float(df["temperature_2m_mean"].mean()),
            annual_max_temp=self._safe_float(df["temperature_2m_max"].max()),
            annual_min_temp=self._safe_float(df["temperature_2m_min"].min()),
            annual_precipitation_mm=self._safe_float(df["precipitation_sum"].sum() / used_years),
            hottest_month=hottest.month_name,
            coldest_month=coldest.month_name,
            hottest_month_avg=hottest.temp_mean,
            coldest_month_avg=coldest.temp_mean,
            heat_stress_months=[row.month_name for row in monthly_stats if row.temp_mean > 30],
            cold_stress_months=[row.month_name for row in monthly_stats if row.temp_mean < 10],
            climate_type=climate_type,
        )

        self.cache.set(cache_key, summary.model_dump())
        return summary

    def _assess_month_comfort(self, month_df: pd.DataFrame) -> str:
        if month_df.empty:
            return "comfortable"

        avg_max = self._safe_float(month_df["temperature_2m_max"].mean())
        avg_min = self._safe_float(month_df["temperature_2m_min"].mean())

        if avg_max > 38:
            return "extreme_heat"
        if avg_max > 32:
            return "hot"
        if avg_min < 0:
            return "very_cold"
        if avg_min < 5:
            return "cold"
        return "comfortable"

    def _classify_climate(
        self,
        df: pd.DataFrame,
        monthly: list[MonthlyClimateStats],
    ) -> str:
        unique_years = max(1, int(df["year"].nunique()) if not df.empty else 1)
        annual_precip = self._safe_float(df["precipitation_sum"].sum() / unique_years)

        summer_temp = sum(item.temp_mean for item in monthly[5:8]) / 3.0
        winter_temp = sum(item.temp_mean for item in [monthly[11], monthly[0], monthly[1]]) / 3.0

        if summer_temp > 28 and winter_temp > 8 and annual_precip < 600:
            return "Mediterranean (Hot Summer - Csa)"
        if summer_temp > 22 and winter_temp > 5 and annual_precip < 400:
            return "Semi-arid (Steppe)"
        if summer_temp > 25 and annual_precip < 250:
            return "Arid (Desert-like)"
        return "Temperate"

    @staticmethod
    def _safe_float(value: Any, default: float = 0.0) -> float:
        if value is None:
            return float(default)
        value_float = float(value)
        if np.isnan(value_float):
            return float(default)
        return value_float


if __name__ == "__main__":
    fetcher = ClimateFetcher()
    result = fetcher.fetch_historical(
        lat=36.8065,
        lon=10.1815,
        years=10,
        location_name="Tunis",
    )

    table = pd.DataFrame(
        [
            {
                "month": row.month_name,
                "temp_mean": round(row.temp_mean, 2),
                "temp_max_avg": round(row.temp_max_avg, 2),
                "temp_min_avg": round(row.temp_min_avg, 2),
                "humidity_mean": round(row.humidity_mean, 2),
                "precipitation_mm": round(row.precipitation_mm, 2),
                "wind_speed_avg": round(row.wind_speed_avg, 2),
                "days_above_35": round(row.days_above_35, 2),
                "comfort": row.comfort_assessment,
            }
            for row in result.monthly_stats
        ]
    )

    print("10-year monthly climate stats (Tunis)")
    print(table.to_string(index=False))
    print()
    print(f"Climate type: {result.climate_type}")
    print(f"Hottest month: {result.hottest_month} ({result.hottest_month_avg:.2f}°C)")
    print(f"Coldest month: {result.coldest_month} ({result.coldest_month_avg:.2f}°C)")
    print(f"Heat stress months: {', '.join(result.heat_stress_months) or 'None'}")

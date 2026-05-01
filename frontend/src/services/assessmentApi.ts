/**
 * assessmentApi.ts — Client for the HestIA-LS environment intelligence endpoints.
 *
 * Endpoints consumed:
 *   POST /api/v1/social-sim/noise/assess/
 *   POST /api/v1/social-sim/neighborhood/profile/
 *   POST /api/v1/social-sim/thermal/assess/
 *   POST /api/v1/social-sim/compatibility/simulate/
 *   GET  /api/v1/social-sim/compatibility/report/{id}/
 */
import api from "./api";

// ── Noise ──────────────────────────────────────────────────────────────────

export interface NoiseSource {
  type: string;
  count: number;
  distance_m: number;
  weight: number;
}

export interface NoiseAssessmentResult {
  address: string | null;
  lat: number;
  lon: number;
  radius_m: number;
  noise_level: number;          // 0–1
  noise_score: number;          // 0–100 (inverted: 100 = quiet)
  noise_category: "very_quiet" | "quiet" | "moderate" | "noisy" | "very_noisy";
  sources: NoiseSource[];
  dominant_source: string | null;
  assessment_summary: string;
  cached: boolean;
  assessed_at: string;
}

export interface NoiseAssessPayload {
  lat?: number;
  lon?: number;
  address?: string;
  radius_m?: number;
  force_refresh?: boolean;
}

// ── Neighborhood ──────────────────────────────────────────────────────────

export interface WalkabilityProfile {
  overall_score: number;
  poi_summary: Record<string, number>;
  closest_by_category: Record<string, { name: string; distance_m: number } | null>;
}

export interface TransportProfile {
  mobility_score: number;
  bus_stops: number;
  metro_stations: number;
  tram_stops: number;
  taxi_stands: number;
  nearest_bus_m: number | null;
  nearest_metro_m: number | null;
  commute_feasibility: string;
}

export interface EmergencyAccessibility {
  score: number;
  nearest_hospital_m: number | null;
  nearest_clinic_m: number | null;
  nearest_pharmacy_m: number | null;
  assessment: string;
}

export interface NeighborhoodProfile {
  address: string;
  lat: number;
  lon: number;
  radius_m: number;
  walkability: WalkabilityProfile;
  transport: TransportProfile;
  emergency_accessibility: EmergencyAccessibility;
  poi_details: Record<string, Array<{ name: string; distance_m: number; lat: number; lon: number }>>;
  overall_neighborhood_score: number;
  neighborhood_summary: string;
  assessed_at: string;
}

export interface NeighborhoodPayload {
  lat?: number;
  lon?: number;
  address?: string;
  commute_destination?: string;
  radius_m?: number;
  noise_assessment?: Record<string, unknown>;
}

// ── Thermal ───────────────────────────────────────────────────────────────

export interface ComfortReport {
  comfort_score: number;          // 0–100
  months_in_comfort_band: number; // how many months are comfortable (18–26°C)
  overheating_risk: "low" | "moderate" | "high";
  undercooling_risk: "low" | "moderate" | "high";
  assessment: string;
}

export interface ClimateSummary {
  hottest_month: string;
  hottest_month_avg: number;
  coldest_month: string;
  coldest_month_avg: number;
  annual_avg: number;
}

export interface ThermalAssessmentResult {
  address: string;
  lat: number;
  lon: number;
  floor_number: number;
  orientation: string;
  building_mass: string;
  has_cooling: boolean;
  has_heating: boolean;
  comfort_report: ComfortReport;
  climate_summary: ClimateSummary;
  monthly_indoor_temps: Record<string, number>;
  monthly_outdoor_temps: Record<string, number>;
  recommendations: string[];
  assessed_at: string;
}

export interface ThermalAssessPayload {
  lat: number;
  lon: number;
  floor_number: number;
  orientation: "north" | "south" | "east" | "west" | "unknown";
  building_mass: "heavy" | "medium" | "light";
  building_condition: "new" | "good" | "fair" | "poor";
  has_cooling: boolean;
  has_heating: boolean;
  has_balcony: boolean;
  has_windows: boolean;
  address?: string;
}

// ── Compatibility ─────────────────────────────────────────────────────────

export interface CompatibilitySimulatePayload {
  subject_a_id: string;
  subject_b_id: string;
  traits_a?: Record<string, unknown>;
  traits_b?: Record<string, unknown>;
  property_config?: {
    noise_level?: number;
    temperature?: number;
    smoking_allowed?: boolean;
  };
  num_ticks?: number;
}

export interface CompatibilitySimulationResult {
  report_id: string;
  compatibility_score: number;   // 0–1
  overall_score: number;         // 0–100
  grade: "A" | "B" | "C" | "D" | "F";
  needs_mediation: boolean;
  lease_checklist: string[];
  llm_backend_used: string;
  created_at: string;
}

export interface CompatibilityReportFull extends CompatibilitySimulationResult {
  subject_a_id: string;
  subject_b_id: string;
  property_config: Record<string, unknown>;
  full_report: Record<string, unknown>;
}

// ── API client ────────────────────────────────────────────────────────────

export const assessmentApi = {
  /** POST /social-sim/noise/assess/ */
  async noiseAssess(payload: NoiseAssessPayload): Promise<NoiseAssessmentResult> {
    const res = await api.post("/social-sim/noise/assess/", payload);
    return res.data;
  },

  /** POST /social-sim/neighborhood/profile/ */
  async neighborhoodProfile(payload: NeighborhoodPayload): Promise<NeighborhoodProfile> {
    const res = await api.post("/social-sim/neighborhood/profile/", payload);
    return res.data;
  },

  /** POST /social-sim/thermal/assess/ */
  async thermalAssess(payload: ThermalAssessPayload): Promise<ThermalAssessmentResult> {
    const res = await api.post("/social-sim/thermal/assess/", payload);
    return res.data;
  },

  /** POST /social-sim/compatibility/simulate/ */
  async compatibilitySimulate(
    payload: CompatibilitySimulatePayload,
  ): Promise<CompatibilitySimulationResult> {
    const res = await api.post("/social-sim/compatibility/simulate/", payload);
    return res.data;
  },

  /** GET /social-sim/compatibility/report/{id}/ */
  async compatibilityReport(reportId: string): Promise<CompatibilityReportFull> {
    const res = await api.get(`/social-sim/compatibility/report/${reportId}/`);
    return res.data;
  },
};

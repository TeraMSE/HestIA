/**
 * lifeSimApi.ts — typed client for the HestIA life simulation endpoints.
 */
import api from "./api";

export interface LifeSimStartPayload {
  lat: number;
  lon: number;
  property_id?: string;
  simulation_month?: number; // 1-12
  commute_destination?: string;
  num_ticks?: number; // 6-48, default 24
}

export interface GeoNoiseSource {
  type: string;
  name: string;
  lat: number;
  lon: number;
  distance_m: number;
  weight: number;
}

export interface GeoPOI {
  category: string;
  name: string;
  lat: number;
  lon: number;
  distance_m?: number;
}

export interface SimEvent {
  tick: number;
  time_label?: string;
  action?: string;
  action_id?: string;
  narrative?: string;
  emotion?: string;
  satisfaction_delta?: number;
  outcome_type?: "success" | "success_with_friction" | "blocked" | "not_attempted";
  blocking_reason?: string;
  location_type?: "indoor" | "outdoor";
  destination_lat?: number;
  destination_lon?: number;
  msg?: string;
}

export interface LifeSimStartResponse {
  run_id: string;
  status: string;
  simulation_month: number;
  month_name: string;
}

export interface LifeSimStatus {
  run_id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number; // 0-100
  simulation_month: number | null;
  commute_destination: string;
  property_lat: number | null;
  property_lon: number | null;
  noise_sources_geo: GeoNoiseSource[];
  neighbourhood_pois_geo: GeoPOI[];
  events: SimEvent[];
  result: Record<string, unknown> | null;
  mediation_rules: string[] | null;
  error: string | null;
}

export const lifeSimApi = {
  async startSim(payload: LifeSimStartPayload): Promise<LifeSimStartResponse> {
    const res = await api.post("/social-sim/life-sim/start/", payload);
    return res.data;
  },

  async getStatus(runId: string): Promise<LifeSimStatus> {
    const res = await api.get(`/social-sim/life-sim/${runId}/`);
    return res.data;
  },
};

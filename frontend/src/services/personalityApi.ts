/**
 * personalityApi.ts — client for the HestIA Personality Builder backend.
 *
 * Endpoints (all AllowAny — no auth required during onboarding):
 *   POST /api/v1/personality/interview/start/
 *   POST /api/v1/personality/interview/respond/
 *   POST /api/v1/personality/interview/finalize/
 *   POST /api/v1/personality/interview/override/
 *   POST /api/v1/personality/sliders/
 */

import api from "@/services/api";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface TraitVector {
  introversion: number;
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  noise_sensitivity: number;
  cleanliness: number;
  thermal_sensitivity: number;
  early_riser: boolean;
  smoker: boolean;
}

export interface SliderValues {
  introversion: number;
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
  noise_sensitivity: number;
  cleanliness: number;
  thermal_sensitivity: number;
  early_riser: boolean;
  smoker: boolean;
}

export interface InterviewProgress {
  exchange_count: number;
  missing_traits: string[];
  target_exchanges: number;
  max_exchanges: number;
  is_complete: boolean;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const personalityApi = {
  /** Start a new AI interview session. Returns session_id + first question. */
  async startInterview(name?: string): Promise<{ session_id: string; first_question: string }> {
    const res = await api.post("/personality/interview/start/", { name: name || "User" });
    return res.data;
  },

  /** Send the user's message. Returns next question + completion status. */
  async respond(
    session_id: string,
    message: string
  ): Promise<{
    assistant_message: string;
    is_complete: boolean;
    exchange_count: number;
    missing_traits: string[];
    progress: InterviewProgress;
  }> {
    const res = await api.post("/personality/interview/respond/", { session_id, message });
    return res.data;
  },

  /** Finalize the interview — triggers LLM extraction + reconciliation. */
  async finalize(session_id: string): Promise<{
    trait_vector: TraitVector;
    slider_values: SliderValues;
    confidence_per_trait: Record<string, number>;
    low_confidence_traits: string[];
    summary: string;
  }> {
    const res = await api.post("/personality/interview/finalize/", { session_id });
    return res.data;
  },

  /** Apply manual slider overrides after finalization. */
  async override(
    session_id: string,
    overrides: Partial<Record<string, number | boolean>>
  ): Promise<{ trait_vector: TraitVector; slider_values: SliderValues }> {
    const res = await api.post("/personality/interview/override/", { session_id, overrides });
    return res.data;
  },

  /** Build trait_vector from plain slider values (Manual mode). */
  async fromSliders(values: {
    openness: number;
    conscientiousness: number;
    extraversion: number;
    agreeableness: number;
    neuroticism: number;
    noise_sensitivity: number;
    cleanliness: number;
    thermal_sensitivity: number;
    early_riser: boolean;
    smoker: boolean;
  }): Promise<{ trait_vector: TraitVector; slider_values: SliderValues }> {
    const res = await api.post("/personality/sliders/", values);
    return res.data;
  },
};

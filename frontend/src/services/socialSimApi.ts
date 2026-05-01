/**
 * socialSimApi.ts — Thin axios wrapper for the /api/v1/social-sim/ endpoints.
 */
import api from "./api";

export interface StartRunPayload {
  persona_a: Record<string, unknown>;
  persona_b?: Record<string, unknown> | null;
  apartment_layout?: Record<string, unknown> | null;
  environment_state?: Record<string, unknown> | null;
  property_id?: string | null;
}

export interface RunStatus {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  progress: number;
  compatibility_score?: number | null;
  error?: string;
}

export interface SimulationReplay {
  id: string;
  status: string;
  result: VisualSimulationReplay;
}

export interface VisualSimulationReplay {
  run_id: string;
  mode: string;
  personas: Array<{ subject_id: string; name: string }>;
  apartment: ApartmentLayout;
  frames: SimulationFrame[];
  simulation_summary: SimulationSummary;
  mediation_rules: string[];
  mediation_summary: string;
}

export interface ApartmentLayout {
  rooms: RoomDef[];
  hotspots: HotspotDef[];
  width: number;
  height: number;
}

export interface RoomDef {
  id: string;
  type: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HotspotDef {
  id: string;
  type: string;
  x: number;
  y: number;
  room: string;
}

export interface FrameAgentState {
  persona_id: string;
  name: string;
  x: number;
  y: number;
  room: string;
  action_id: string;
  action_label: string;
  action_emoji: string;
  mood: "happy" | "neutral" | "frustrated" | "upset";
  mood_emoji: string;
  speech_bubble?: string | null;
  narration?: string | null;
  outside_room: boolean;
  satisfaction_delta: number;
}

export interface FrameConflict {
  conflict_id: string;
  conflict_type: string;
  description: string;
  severity: number;
  tick: number;
}

export interface FrameEvent {
  type: "conflict" | "positive_interaction" | "resolution" | string;
  description: string;
  agents_involved: string[];
}

export interface SimulationFrame {
  frame_index: number;
  tick: number;
  time_label: string;
  agents: FrameAgentState[];
  conflict?: FrameConflict | null;
  events: FrameEvent[];
}

export interface SimulationSummary {
  compatibility_score: number;
  label: string;
  conflicts_count: number;
  persona_a_satisfaction: number;
  persona_b_satisfaction: number;
  total_ticks: number;
}

export interface MediationResult {
  id: string;
  status: string;
  mediation_rules: string[];
  mediation_summary: string;
  compatibility_score: number | null;
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const socialSimApi = {
  /** POST /api/v1/social-sim/runs/ — start a new simulation run */
  async startRun(payload: StartRunPayload): Promise<{ id: string; status: string }> {
    const res = await api.post("/social-sim/runs/", payload);
    return res.data;
  },

  /** GET /api/v1/social-sim/runs/{id}/ — poll run status */
  async getRun(id: string): Promise<RunStatus> {
    const res = await api.get(`/social-sim/runs/${id}/`);
    return res.data;
  },

  /** GET /api/v1/social-sim/runs/{id}/replay/ — fetch full replay once completed */
  async getReplay(id: string): Promise<SimulationReplay> {
    const res = await api.get(`/social-sim/runs/${id}/replay/`);
    return res.data;
  },

  /** GET /api/v1/social-sim/runs/{id}/mediation/ — fetch house rules */
  async getMediation(id: string): Promise<MediationResult> {
    const res = await api.get(`/social-sim/runs/${id}/mediation/`);
    return res.data;
  },
};

/**
 * Poll /runs/{id}/ every `intervalMs` until status is completed or failed.
 * Calls `onProgress` with progress (0–100) and the current status string.
 * Resolves with final RunStatus or rejects on failure.
 *
 * Resilient to transient errors: the axios interceptor handles JWT refresh
 * transparently on 401, so isolated errors are retried up to `maxConsecutiveErrors`
 * times before the poll is aborted.
 */
export async function pollUntilDone(
  runId: string,
  onProgress?: (progress: number, status: string) => void,
  intervalMs = 2500,
  timeoutMs = 600_000,
  maxConsecutiveErrors = 3,
): Promise<RunStatus> {
  const deadline = Date.now() + timeoutMs;
  let consecutiveErrors = 0;

  while (Date.now() < deadline) {
    try {
      const run = await socialSimApi.getRun(runId);
      consecutiveErrors = 0;                                   // reset on success
      onProgress?.(run.progress, run.status);
      if (run.status === "completed") return run;
      if (run.status === "failed") throw new Error(run.error || "Simulation failed.");
    } catch (err: any) {
      // "Simulation failed." is a terminal error — rethrow immediately
      if (err?.message?.startsWith("Simulation failed")) throw err;

      consecutiveErrors++;
      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw new Error(`Polling aborted after ${maxConsecutiveErrors} consecutive errors: ${err?.message}`);
      }
      // Otherwise swallow the transient error (JWT refresh, brief network blip)
      // and try again after the normal interval
    }
    // Small jitter (±10 %) to avoid hammering if multiple tabs are open
    const jitter = intervalMs * 0.1 * (Math.random() * 2 - 1);
    await new Promise((r) => setTimeout(r, intervalMs + jitter));
  }
  throw new Error("Simulation timed out.");
}

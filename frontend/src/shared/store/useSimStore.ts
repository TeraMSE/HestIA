/**
 * useSimStore.ts — Zustand store for life simulation overlay state.
 *
 * Holds all geo overlay data (noise sources, neighbourhood POIs, persona position)
 * that MapShell's SimOverlayLayer reads from. Also tracks simulation run status
 * for the LifeSimPanel poller.
 */
import { create } from "zustand";
import type { GeoNoiseSource, GeoPOI, SimEvent } from "@/services/lifeSimApi";

export interface PersonaPosition {
  lat: number;
  lon: number;
}

interface SimStore {
  // ── Map overlay data ────────────────────────────────────────────────────────
  noiseSources: GeoNoiseSource[];
  neighbourhoodPois: GeoPOI[];
  showSimOverlay: boolean; // toggle from NeighborhoodIntel "Show on map"

  // ── Persona dot state ───────────────────────────────────────────────────────
  personaPosition: PersonaPosition | null;
  personaTargetPosition: PersonaPosition | null;

  // ── Simulation run state ────────────────────────────────────────────────────
  simRunId: string | null;
  simStatus: "idle" | "queued" | "running" | "completed" | "failed";
  simProgress: number; // 0-100
  simMonth: number | null;
  simMonthName: string;
  simEvents: SimEvent[];

  // ── Actions ─────────────────────────────────────────────────────────────────
  setNoiseSources: (sources: GeoNoiseSource[]) => void;
  setNeighbourhoodPois: (pois: GeoPOI[]) => void;
  setShowSimOverlay: (show: boolean) => void;
  toggleSimOverlay: () => void;

  setPersonaPosition: (pos: PersonaPosition | null) => void;
  setPersonaTargetPosition: (pos: PersonaPosition | null) => void;

  startRun: (runId: string, month: number, monthName: string) => void;
  updateRun: (
    status: "queued" | "running" | "completed" | "failed",
    progress: number,
    events: SimEvent[],
    noiseSources?: GeoNoiseSource[],
    pois?: GeoPOI[]
  ) => void;
  resetSim: () => void;
}

export const useSimStore = create<SimStore>((set, get) => ({
  noiseSources: [],
  neighbourhoodPois: [],
  showSimOverlay: false,
  personaPosition: null,
  personaTargetPosition: null,
  simRunId: null,
  simStatus: "idle",
  simProgress: 0,
  simMonth: null,
  simMonthName: "",
  simEvents: [],

  setNoiseSources: (sources) => set({ noiseSources: sources }),
  setNeighbourhoodPois: (pois) => set({ neighbourhoodPois: pois }),
  setShowSimOverlay: (show) => set({ showSimOverlay: show }),
  toggleSimOverlay: () => set((s) => ({ showSimOverlay: !s.showSimOverlay })),

  setPersonaPosition: (pos) => set({ personaPosition: pos }),
  setPersonaTargetPosition: (pos) => set({ personaTargetPosition: pos }),

  startRun: (runId, month, monthName) =>
    set({
      simRunId: runId,
      simStatus: "queued",
      simProgress: 0,
      simMonth: month,
      simMonthName: monthName,
      simEvents: [],
      personaPosition: null,
      personaTargetPosition: null,
    }),

  updateRun: (status, progress, events, noiseSources, pois) => {
    const update: Partial<SimStore> = { simStatus: status, simProgress: progress };
    if (events.length > 0) update.simEvents = events;
    if (noiseSources && noiseSources.length > 0) update.noiseSources = noiseSources;
    if (pois && pois.length > 0) update.neighbourhoodPois = pois;

    // Advance persona position for the latest outdoor event
    const latestOutdoor = [...events].reverse().find((e) => e.location_type === "outdoor");
    if (latestOutdoor?.destination_lat != null) {
      update.personaTargetPosition = {
        lat: latestOutdoor.destination_lat!,
        lon: latestOutdoor.destination_lon!,
      };
    }

    set(update);
  },

  resetSim: () =>
    set({
      simRunId: null,
      simStatus: "idle",
      simProgress: 0,
      simMonth: null,
      simMonthName: "",
      simEvents: [],
      personaPosition: null,
      personaTargetPosition: null,
    }),
}));

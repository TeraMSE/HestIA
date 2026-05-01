import { create } from "zustand";
import type { User, PersonaProfile, ApartmentConfig, CompatibilityResult, FrameSequence, PropertyPin } from "@/contracts/types";
import type { FriendEntry } from "@/services/socialApi";

export type OverlayId =
  | null
  | "module-dashboard"
  | "persona-builder"
  | "apartment-configurator"
  | "simulation-runner"
  | "visual-replay"
  | "reports"
  | "material-agent"
  | "admin-assistant"
  | "room-sim"
  | "neighborhood-intel";

interface AppState {
  // Auth
  user: User | null;
  setUser: (u: User | null) => void;

  // Social — friends list (lazy loaded)
  friends: FriendEntry[];
  setFriends: (f: FriendEntry[]) => void;

  // The currently selected map pin (used to bind property_id to life-sim)
  selectedPin: PropertyPin | null;
  setSelectedPin: (p: PropertyPin | null) => void;

  // Onboarding draft
  onboardingPersona: Partial<PersonaProfile["bigFive"] & PersonaProfile["lifestyle"]>;
  setOnboardingPersona: (p: AppState["onboardingPersona"]) => void;

  // Map / pins
  pins: PropertyPin[];
  setPins: (p: PropertyPin[]) => void;
  selectedPinId: string | null;
  setSelectedPinId: (id: string | null) => void;
  activeFilters: string[];
  toggleFilter: (filter: string) => void;

  // Personas / apartments cache
  personas: PersonaProfile[];
  setPersonas: (p: PersonaProfile[]) => void;
  apartments: ApartmentConfig[];
  setApartments: (a: ApartmentConfig[]) => void;

  // Simulation selection state
  selectedPersonaA: string | null;
  selectedPersonaB: string | null;
  selectedApartment: string | null;
  setSelectedPersonaA: (id: string | null) => void;
  setSelectedPersonaB: (id: string | null) => void;
  setSelectedApartment: (id: string | null) => void;

  // Run + replay
  lastResult: CompatibilityResult | null;
  setLastResult: (r: CompatibilityResult | null) => void;
  frameSequence: FrameSequence | null;
  setFrameSequence: (f: FrameSequence | null) => void;
  currentFrame: number;
  setCurrentFrame: (n: number) => void;
  playing: boolean;
  setPlaying: (b: boolean) => void;
  speed: 0.5 | 1 | 2 | 4;
  setSpeed: (s: 0.5 | 1 | 2 | 4) => void;
  replayMode: "2d" | "3d";
  setReplayMode: (m: "2d" | "3d") => void;

  // Overlays
  activeOverlay: OverlayId;
  openOverlay: (id: OverlayId) => void;
  closeOverlay: () => void;
}

export const useApp = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),

  friends: [],
  setFriends: (friends) => set({ friends }),

  selectedPin: null,
  setSelectedPin: (selectedPin) => set({ selectedPin }),

  onboardingPersona: {},
  setOnboardingPersona: (p) => set((s) => ({ onboardingPersona: { ...s.onboardingPersona, ...p } })),

  pins: [],
  setPins: (pins) => set({ pins }),
  selectedPinId: null,
  setSelectedPinId: (selectedPinId) => set({ selectedPinId }),
  activeFilters: ["property", "hospital", "school", "commodity", "user_pin"],
  toggleFilter: (filter) => set((state) => ({
    activeFilters: state.activeFilters.includes(filter)
      ? state.activeFilters.filter((f) => f !== filter)
      : [...state.activeFilters, filter],
  })),

  personas: [],
  setPersonas: (personas) => set({ personas }),
  apartments: [],
  setApartments: (apartments) => set({ apartments }),

  selectedPersonaA: null,
  selectedPersonaB: null,
  selectedApartment: null,
  setSelectedPersonaA: (selectedPersonaA) => set({ selectedPersonaA }),
  setSelectedPersonaB: (selectedPersonaB) => set({ selectedPersonaB }),
  setSelectedApartment: (selectedApartment) => set({ selectedApartment }),

  lastResult: null,
  setLastResult: (lastResult) => set({ lastResult }),
  frameSequence: null,
  setFrameSequence: (frameSequence) => set({ frameSequence, currentFrame: 0 }),
  currentFrame: 0,
  setCurrentFrame: (currentFrame) => set({ currentFrame }),
  playing: false,
  setPlaying: (playing) => set({ playing }),
  speed: 1,
  setSpeed: (speed) => set({ speed }),
  replayMode: "2d",
  setReplayMode: (replayMode) => set({ replayMode }),

  activeOverlay: null,
  openOverlay: (id) => set({ activeOverlay: id }),
  closeOverlay: () => set({ activeOverlay: null }),
}));

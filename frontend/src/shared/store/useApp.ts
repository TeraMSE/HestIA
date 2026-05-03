import { create } from "zustand";
import type { User, PersonaProfile, ApartmentConfig, CompatibilityResult, FrameSequence, PropertyPin } from "@/contracts/types";
import type { FriendEntry } from "@/services/socialApi";

export type OverlayId =
  | null
  | "module-dashboard"
  | "persona-builder"
  | "apartment-configurator"
  | "apt-configurator"
  | "visual-replay"
  | "reports"
  | "material-agent"
  | "admin-assistant"
  | "neighborhood-intel"
  | "appliance-energy"
  | "roommate-compat";

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
  replayMode: "2d" | "3d";
  setReplayMode: (m: "2d" | "3d") => void;

  // Overlays
  activeOverlay: OverlayId;
  openOverlay: (id: OverlayId) => void;
  closeOverlay: () => void;

  // Landlord placement mode
  placementMode: boolean;
  setPlacementMode: (v: boolean) => void;
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
  replayMode: "2d",
  setReplayMode: (replayMode) => set({ replayMode }),

  activeOverlay: null,
  openOverlay: (id) => set({ activeOverlay: id }),
  closeOverlay: () => set({ activeOverlay: null }),

  placementMode: false,
  setPlacementMode: (placementMode) => set({ placementMode }),
}));

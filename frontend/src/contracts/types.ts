// HestIA frontend contract types — backend will conform to these.

export type UserRole = "renter" | "buyer" | "landlord";

export interface User {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  displayName?: string;
  role: UserRole;
  avatarColor?: string;
  verified_email?: boolean;
  created_at?: string;
  bio?: string;
  // Living preferences — set from Settings; power the Life Sim persona
  noise_tolerance?: number | null;
  cleanliness?: number | null;
  thermal_sensitivity?: number | null;
  smoker?: boolean | null;
  daily_schedule?: "early_bird" | "flexible" | "night_owl" | "";
}

// === Persona ===
export interface BigFive {
  openness: number;        // 0..100
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

export interface LifestyleTraits {
  noiseTolerance: number;       // 0..100
  cleanliness: number;          // 0..100
  thermalSensitivity: number;   // 0..100 (higher = more sensitive)
  smoker: boolean;
  schedule: "early_bird" | "night_owl" | "flexible";
}

export interface PersonaProfile {
  id: string;
  name: string;
  avatarColor: string;
  bigFive: BigFive;
  lifestyle: LifestyleTraits;
  notes?: string;
  traitCoverage: number; // 0..100, how complete the interview was
  updatedAt: string;
}

// === Apartment ===
export type Orientation = "N" | "S" | "E" | "W" | "NE" | "NW" | "SE" | "SW";

export interface RoomTopology {
  bedrooms: number;
  bathrooms: number;
  livingRooms: number;
  kitchens: number;
  balconies: number;
}

export interface BuildingMetadata {
  floor: number;
  condition: "new" | "renovated" | "old";
  mass: "light" | "medium" | "heavy";
  orientation: Orientation;
  elevator: boolean;
  heating: boolean;
  cooling: boolean;
  windows: "single" | "double" | "triple";
}

export interface Utilities {
  internet: boolean;
  water: boolean;
  electricity: boolean;
  gas: boolean;
}

export interface ApartmentConfig {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  rooms: RoomTopology;
  building: BuildingMetadata;
  utilities: Utilities;
  noiseScore?: number;        // 0..100
  neighborhoodScore?: number; // 0..100
  thermalScore?: number;      // 0..100
  // Cached full assessment payloads (from real LS API)
  noiseAssessment?: import("@/services/assessmentApi").NoiseAssessmentResult;
  neighborhoodProfile?: import("@/services/assessmentApi").NeighborhoodProfile;
  thermalAssessment?: import("@/services/assessmentApi").ThermalAssessmentResult;
  updatedAt: string;
}

// === Compatibility / Simulation ===
export interface ConflictEvent {
  tick: number;
  category: "noise" | "cleanliness" | "thermal" | "schedule" | "social" | "other";
  description: string;
  severity: "low" | "medium" | "high";
}

export interface PositiveEvent {
  tick: number;
  description: string;
}

export interface MediationRule {
  id: string;
  title: string;
  done: boolean;
}

export interface ScoreBreakdown {
  noise: number;
  cleanliness: number;
  thermal: number;
  schedule: number;
  social: number;
}

export type Grade = "A" | "B" | "C" | "D" | "F";

export interface CompatibilityResult {
  id: string;
  personaAId: string;
  personaBId: string;
  apartmentId: string;
  ticks: number;
  compatibilityPct: number;     // 0..100
  conflicts: ConflictEvent[];
  positives: PositiveEvent[];
  grade: Grade;
  overallScore: number;         // 0..100
  breakdown: ScoreBreakdown;
  createdAt: string;
}

export interface MediationResult {
  rules: MediationRule[];
  summary: string;
}

// === Visual Replay frame contract ===
export interface PersonaFrame {
  personaId: string;
  x: number; // 0..1 normalized within apartment bbox
  y: number;
  room?: string;
  speech?: string;
  mood?: "happy" | "neutral" | "annoyed" | "angry" | "sleepy";
}

export interface FrameEvent {
  type: "conflict" | "positive" | "info";
  description: string;
}

export interface Frame {
  tick: number;
  timeLabel: string; // e.g. "08:30"
  personas: PersonaFrame[];
  events: FrameEvent[];
}

export interface FrameSequence {
  apartment: ApartmentConfig;
  personas: PersonaProfile[];
  frames: Frame[];
  simulation_summary: CompatibilityResult;
}

// === Material Agent ===
export type TunisianClimate = "coastal" | "sahelian" | "northern" | "inland";

export interface MaterialItem {
  id: string;
  name: string;
  category:
    | "structural"
    | "waterproofing"
    | "insulation"
    | "coatings"
    | "carpentry"
    | "plumbing"
    | "electrical"
    | "finishing";
  brand?: string;
  unit: string;
  unitPriceTND: number;
  quantity: number;
  totalTND: number;
}

export type BudgetVerdict = "optimal" | "insufficient" | "excess";

export interface MaterialEstimate {
  id: string;
  region: string;
  climate: TunisianClimate;
  budgetTND: number;
  estimatedAreaM2: number;
  rooms: number;
  items: MaterialItem[];
  totalTND: number;
  verdict: BudgetVerdict;
  verdictExplanation: string;
  waterproofingPlan: {
    antiMold: string[];
    antiCracking: string[];
    antiInfiltration: string[];
  };
  upgrades?: string[];
  reductionSuggestion?: string;
  createdAt: string;
}

// === Map pins ===
export type PinKind = "property" | "user_pin" | "simulation";
export type PoiType = "hospital" | "school" | "commodity" | "other";
export type ScanStatus = "scanned" | "unscanned";

export interface POINode {
  id: string;
  lat: number;
  lng: number;
  type: PoiType;
  name?: string;
}

export interface PropertyPin {
  id: string;
  kind: PinKind;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  /** User ID of the property owner. Only that user can upload panoramas. */
  ownerId?: string;
  scan: ScanStatus;
  apartmentId?: string;
  priceTND?: number;
  forSale?: boolean;
  forRent?: boolean;
  /** True when a completed 3D reconstruction exists for this property. */
  has_3d?: boolean;
}

// === Admin assistant ===
export interface AdminMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  cards?: AdminProcedureCard[];
}

export interface AdminProcedureCard {
  title: string;
  steps: string[];
  documents: string[];
  timeline: string;
  risks: string[];
}

// === Reports ===
export interface ReportEntry {
  id: string;
  createdAt: string;
  personaA: string;
  personaB: string;
  apartmentLabel: string;
  grade: Grade;
  score: number;
}

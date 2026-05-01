/**
 * ActionMap.ts — Maps LS action_id strings to Three.js animation states
 * and furniture target types.
 *
 * Two lookup tables:
 *  1. ACTION_MAP  — exact HestIA-LS action_catalog.py action_id keys
 *  2. FREE_TEXT_MAP — human-readable strings emitted by frame_builder.py
 *
 * getActionMapping() tries ACTION_MAP first, then FREE_TEXT_MAP, then idle.
 */
import type { FurnitureType } from "./FurnitureManager";

export type AnimState =
  | "idle" | "walk" | "sleep" | "sit" | "interact" | "emote"
  | "cook" | "clean" | "eat" | "shower" | "exercise";

export interface ActionMapping {
  animState: AnimState;
  furnitureTarget: FurnitureType | null;
  /** True if this action takes the agent outside the room */
  isLeaving: boolean;
  /** True if agent should sleep/lay on arrival */
  isSleeping?: boolean;
  /** True if agent should sit on arrival */
  isSitting?: boolean;
}

// ── Exact HestIA-LS action_catalog.py action_ids ──────────────────────────
const ACTION_MAP: Record<string, ActionMapping> = {
  // Sleep
  sleep_properly:   { animState: "sleep",    furnitureTarget: "bed",    isLeaving: false, isSleeping: true },
  nap_afternoon:    { animState: "sleep",    furnitureTarget: "bed",    isLeaving: false, isSleeping: true },

  // Cook / Eat
  cook_at_home:     { animState: "cook",     furnitureTarget: "stove",  isLeaving: false },
  get_groceries:    { animState: "interact", furnitureTarget: "table",  isLeaving: false },
  grocery_delivery: { animState: "idle",     furnitureTarget: "door",   isLeaving: false },

  // Work / Study
  work_from_home:      { animState: "sit", furnitureTarget: "desk",  isLeaving: false, isSitting: true },
  study_at_home:       { animState: "sit", furnitureTarget: "desk",  isLeaving: false, isSitting: true },
  video_call_family:   { animState: "sit", furnitureTarget: "desk",  isLeaving: false, isSitting: true },

  // Private / Quiet
  have_private_time:    { animState: "sit",  furnitureTarget: "desk",  isLeaving: false, isSitting: true },
  seek_quiet_room:      { animState: "sit",  furnitureTarget: "desk",  isLeaving: false, isSitting: true },
  meditate_or_journal:  { animState: "sit",  furnitureTarget: "chair", isLeaving: false, isSitting: true },

  // Hygiene
  morning_routine_quiet: { animState: "interact", furnitureTarget: "toilet", isLeaving: false },
  take_shower:           { animState: "shower",   furnitureTarget: "shower", isLeaving: false },

  // Relax / Social (in-room)
  relax_sofa:          { animState: "sit",   furnitureTarget: "sofa", isLeaving: false, isSitting: true },
  watch_tv:            { animState: "sit",   furnitureTarget: "sofa", isLeaving: false, isSitting: true },
  invite_friends_over: { animState: "emote", furnitureTarget: "sofa", isLeaving: false },
  tolerate_noise:      { animState: "idle",  furnitureTarget: null,   isLeaving: false },

  // Thermal comfort (brief emotes)
  turn_on_heating:         { animState: "emote", furnitureTarget: null, isLeaving: false },
  open_window_ventilation: { animState: "emote", furnitureTarget: null, isLeaving: false },
  turn_on_fan:             { animState: "emote", furnitureTarget: null, isLeaving: false },
  suffer_from_heat:        { animState: "idle",  furnitureTarget: null, isLeaving: false },
  layer_up_for_cold:       { animState: "idle",  furnitureTarget: null, isLeaving: false },

  // Clean
  clean_shared_spaces: { animState: "clean",   furnitureTarget: "sink", isLeaving: false },
  do_laundry:          { animState: "clean",   furnitureTarget: "sink", isLeaving: false },

  // Exercise (in-room)
  exercise_at_home: { animState: "exercise", furnitureTarget: null, isLeaving: false },

  // Mobility (brief elevator/walk — agent stays visible)
  use_elevator: { animState: "walk", furnitureTarget: "door", isLeaving: false },

  // Leaving actions (agent exits through door)
  commute_to_work_uni:    { animState: "walk", furnitureTarget: "door", isLeaving: true },
  // Exact HestIA-LS catalog IDs:
  take_bus_university:    { animState: "walk", furnitureTarget: "door", isLeaving: true },
  take_bus_general:       { animState: "walk", furnitureTarget: "door", isLeaving: true },
  walk_to_destination:    { animState: "walk", furnitureTarget: "door", isLeaving: true },
  go_to_cafe:             { animState: "walk", furnitureTarget: "door", isLeaving: true },
  go_to_restaurant:       { animState: "walk", furnitureTarget: "door", isLeaving: true },
  go_to_pharmacy_urgent:  { animState: "walk", furnitureTarget: "door", isLeaving: true },
  go_to_hospital:         { animState: "walk", furnitureTarget: "door", isLeaving: true },
  go_to_park:             { animState: "walk", furnitureTarget: "door", isLeaving: true },
  go_out_socially:        { animState: "walk", furnitureTarget: "door", isLeaving: true },
  // Legacy aliases kept for backwards compatibility:
  take_bus_to_work:       { animState: "walk", furnitureTarget: "door", isLeaving: true },
  take_bus_to_university: { animState: "walk", furnitureTarget: "door", isLeaving: true },
  go_to_gym:              { animState: "walk", furnitureTarget: "door", isLeaving: true },
  go_to_grocery_store:    { animState: "walk", furnitureTarget: "door", isLeaving: true },

  // Default fallback key
  idle: { animState: "idle", furnitureTarget: null, isLeaving: false },
};

// ── Free-text strings emitted by HestIA-LS frame_builder.py ───────────────
const FREE_TEXT_MAP: Record<string, ActionMapping> = {
  sleeping:         { animState: "sleep",    furnitureTarget: "bed",    isLeaving: false, isSleeping: true },
  walking:          { animState: "walk",     furnitureTarget: null,     isLeaving: false },
  making_breakfast: { animState: "cook",     furnitureTarget: "stove",  isLeaving: false },
  cooking:          { animState: "cook",     furnitureTarget: "stove",  isLeaving: false },
  eating:           { animState: "eat",      furnitureTarget: "table",  isLeaving: false },
  drinking:         { animState: "eat",      furnitureTarget: "table",  isLeaving: false },
  chatting:         { animState: "emote",    furnitureTarget: null,     isLeaving: false },
  talking:          { animState: "emote",    furnitureTarget: null,     isLeaving: false },
  reading:          { animState: "sit",      furnitureTarget: "desk",   isLeaving: false, isSitting: true },
  studying:         { animState: "sit",      furnitureTarget: "desk",   isLeaving: false, isSitting: true },
  working:          { animState: "sit",      furnitureTarget: "desk",   isLeaving: false, isSitting: true },
  waiting:          { animState: "idle",     furnitureTarget: null,     isLeaving: false },
  cleaning:         { animState: "clean",    furnitureTarget: "sink",   isLeaving: false },
  showering:        { animState: "shower",   furnitureTarget: "shower", isLeaving: false },
  exercising:       { animState: "exercise", furnitureTarget: null,     isLeaving: false },
  relaxing:         { animState: "sit",      furnitureTarget: "sofa",   isLeaving: false, isSitting: true },
  watching:         { animState: "sit",      furnitureTarget: "sofa",   isLeaving: false, isSitting: true },
  sleeping_lightly: { animState: "sleep",    furnitureTarget: "bed",    isLeaving: false, isSleeping: true },
};

/** Get the animation mapping for an action ID.
 *  Tries ACTION_MAP → FREE_TEXT_MAP → idle fallback.
 */
export function getActionMapping(actionId: string): ActionMapping {
  if (!actionId) return { animState: "idle", furnitureTarget: null, isLeaving: false };
  const exact = ACTION_MAP[actionId];
  if (exact) return exact;
  // Normalize free-text: lowercase, replace spaces/hyphens with underscores
  const key = actionId.toLowerCase().replace(/[\s-]+/g, "_");
  return FREE_TEXT_MAP[key] ?? { animState: "idle", furnitureTarget: null, isLeaving: false };
}

export { ACTION_MAP, FREE_TEXT_MAP };

/**
 * toLifeSimPersona.ts — Adapts a HestIA PersonaProfile to the backend
 * Persona shape expected by the LS engine.
 *
 * Backend Persona schema:
 *   subject_id: str
 *   name: str
 *   traits: { introversion, noise_sensitivity, cleanliness,
 *              thermal_sensitivity, early_riser, smoker }
 *   big_five: { extraversion, conscientiousness, neuroticism, agreeableness, openness }
 *   persona_description: str
 *   behavioral_adjectives: str[]
 */

import type { PersonaProfile } from "@/contracts/types";

export interface LSPersona {
  subject_id: string;
  name: string;
  traits: {
    introversion: number;
    noise_sensitivity: number;
    cleanliness: number;
    thermal_sensitivity: number;
    early_riser: boolean;
    smoker: boolean;
  };
  big_five: {
    extraversion: number;
    conscientiousness: number;
    neuroticism: number;
    agreeableness: number;
    openness: number;
  };
  persona_description: string;
  behavioral_adjectives: string[];
}

/**
 * Convert a HestIA PersonaProfile (0–100 sliders) to the backend LS Persona dict.
 */
export function toLifeSimPersona(profile: PersonaProfile): LSPersona {
  const b5 = profile.bigFive;
  const ls = profile.lifestyle;

  // Normalize 0–100 → 0–1
  const norm = (v: number) => v / 100;

  // Derive LS traits from HestIA traits
  const introversion = 1 - norm(b5.extraversion);
  const noise_sensitivity = norm(ls.noiseTolerance); // high tolerance → low sensitivity; invert below
  const cleanliness = norm(ls.cleanliness);
  const thermal_sensitivity = norm(ls.thermalSensitivity);
  const early_riser = ls.schedule === "early_bird";
  const smoker = ls.smoker;

  // Derive Big Five for LS engine
  const extraversion = norm(b5.extraversion);
  const conscientiousness = norm(b5.conscientiousness);
  const neuroticism = norm(b5.neuroticism);
  const agreeableness = norm(b5.agreeableness);
  const openness = norm(b5.openness);

  const persona_description = _buildDescription({
    introversion,
    cleanliness,
    early_riser,
    smoker,
    noise_sensitivity: 1 - norm(ls.noiseTolerance), // high tolerance → low sensitivity
    thermal_sensitivity,
  });

  return {
    subject_id: profile.id,
    name: profile.name,
    traits: {
      introversion,
      noise_sensitivity: 1 - norm(ls.noiseTolerance), // invert: high tolerance = low sensitivity
      cleanliness,
      thermal_sensitivity,
      early_riser,
      smoker,
    },
    big_five: { extraversion, conscientiousness, neuroticism, agreeableness, openness },
    persona_description,
    behavioral_adjectives: _buildAdjectives({
      extraversion,
      conscientiousness,
      neuroticism,
      agreeableness,
      openness,
    }),
  };
}

function _buildDescription(t: {
  introversion: number;
  cleanliness: number;
  early_riser: boolean;
  smoker: boolean;
  noise_sensitivity: number;
  thermal_sensitivity: number;
}): string {
  const parts: string[] = [];
  if (t.introversion > 0.7) parts.push("prefers quiet evenings at home");
  else if (t.introversion < 0.3) parts.push("enjoys a lively, social home atmosphere");
  if (t.cleanliness > 0.7) parts.push("keeps shared spaces spotlessly clean");
  else if (t.cleanliness < 0.3) parts.push("has a relaxed approach to tidiness");
  if (t.early_riser) parts.push("wakes up early and values a quiet morning routine");
  if (t.smoker) parts.push("smokes regularly");
  if (t.noise_sensitivity > 0.7) parts.push("is highly sensitive to noise");
  if (t.thermal_sensitivity > 0.7) parts.push("needs proper heating and cooling");
  if (parts.length === 0) parts.push("adapts well to shared apartment routines");
  return parts.slice(0, 4).join(". ") + ".";
}

function _buildAdjectives(b5: {
  extraversion: number;
  conscientiousness: number;
  neuroticism: number;
  agreeableness: number;
  openness: number;
}): string[] {
  const adj: string[] = [];
  if (b5.conscientiousness >= 0.6) adj.push("organized", "punctual");
  else adj.push("spontaneous", "flexible");
  if (b5.neuroticism >= 0.6) adj.push("sensitive");
  else adj.push("steady");
  if (b5.extraversion >= 0.6) adj.push("sociable", "open");
  else if (b5.extraversion <= 0.4) adj.push("private", "reserved");
  else adj.push("balanced");
  if (b5.agreeableness <= 0.4) adj.push("assertive");
  else adj.push("cooperative");
  // Deduplicate and pad to 5
  const uniq = [...new Set(adj)];
  while (uniq.length < 5) uniq.push("adaptable");
  return uniq.slice(0, 5);
}

/**
 * Build a LSPersona directly from a User's settings fields.
 * Preferred path � no separate PersonaBuilder step needed.
 */
export function userToLifeSimPersona(user: {
  id: number;
  email: string;
  first_name?: string;
  last_name?: string;
  noise_tolerance?: number | null;
  cleanliness?: number | null;
  thermal_sensitivity?: number | null;
  smoker?: boolean | null;
  daily_schedule?: string | null;
}): LSPersona {
  const norm = (v: number | null | undefined, fallback = 50) => (v ?? fallback) / 100;

  const noise_tol = norm(user.noise_tolerance);
  const clean = norm(user.cleanliness);
  const thermal = norm(user.thermal_sensitivity);
  const smoker = user.smoker ?? false;
  const early_riser = user.daily_schedule === "early_bird";
  const name = user.first_name
    ? `${user.first_name} ${user.last_name ?? ""}`.trim()
    : user.email.split("@")[0];

  const traits = {
    introversion: 0.5,
    noise_sensitivity: 1 - noise_tol,
    cleanliness: clean,
    thermal_sensitivity: thermal,
    early_riser,
    smoker,
  };
  const big_five = {
    extraversion: 0.5,
    conscientiousness: clean,
    neuroticism: thermal,
    agreeableness: 0.6,
    openness: 0.5,
  };

  return {
    subject_id: String(user.id),
    name,
    traits,
    big_five,
    persona_description: _buildDescription({
      introversion: 0.5,
      cleanliness: clean,
      early_riser,
      smoker,
      noise_sensitivity: 1 - noise_tol,
      thermal_sensitivity: thermal,
    }),
    behavioral_adjectives: _buildAdjectives(big_five),
  };
}

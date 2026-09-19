/**
 * ResQ taxonomy — the single source of truth for skills, need types and urgencies
 * (README §4, CONTRACTS §1). Both the Ollama system prompt (lib/triage.ts) and the
 * keyword-rules fallback (lib/triage-rules.ts) read from this file; the UI and the
 * SMS templates use the label maps.
 *
 * This module must NOT import runtime values from ./types: types.ts derives its
 * Skill / NeedType / Urgency unions from the `as const` arrays below via `typeof`.
 * The import here is type-only and is erased at compile time, so there is no
 * runtime cycle between the two modules.
 */
import type { NeedType, Skill, Urgency } from "./types";

export const SKILLS = [
  "doctor",
  "nurse",
  "first_aid",
  "swimmer",
  "boat_owner",
  "electrician",
  "plumber",
  "driver_4x4",
  "generator_owner",
  "counselor",
  "volunteer",
] as const;

export const NEED_TYPES = [
  "flood_rescue",
  "cardiac_no_breathing",
  "bleeding",
  "fracture",
  "electrical",
  "fire",
  "trapped_structural",
  "snakebite",
  "evacuation_mobility",
  "supplies_oxygen_meds",
  "missing_person",
  "other",
] as const;

export const URGENCIES = ["critical", "high", "medium", "low"] as const;

/**
 * Default skills per need type (CONTRACTS §1). Every array is non-empty; triage
 * falls back to `TYPE_SKILLS[type]` when the model returns no known skill.
 * These arrays are shared module state — copy (`[...TYPE_SKILLS[t]]`) before mutating.
 */
export const TYPE_SKILLS: Record<NeedType, Skill[]> = {
  flood_rescue: ["swimmer", "boat_owner", "first_aid"],
  cardiac_no_breathing: ["doctor", "nurse", "first_aid"],
  bleeding: ["nurse", "doctor", "first_aid"],
  fracture: ["nurse", "doctor", "first_aid", "driver_4x4"],
  electrical: ["electrician", "first_aid"],
  fire: ["volunteer", "first_aid", "driver_4x4"],
  trapped_structural: ["volunteer", "first_aid", "driver_4x4"],
  snakebite: ["doctor", "nurse", "driver_4x4"],
  evacuation_mobility: ["boat_owner", "swimmer", "driver_4x4"],
  supplies_oxygen_meds: ["driver_4x4", "volunteer", "nurse"],
  missing_person: ["volunteer", "counselor"],
  other: ["volunteer", "first_aid"],
};

/** Short human labels for skills (UI chips, checkboxes, SMS via `.toUpperCase()`). */
export const SKILL_LABELS: Record<Skill, string> = {
  doctor: "Doctor",
  nurse: "Nurse",
  first_aid: "First aid",
  swimmer: "Swimmer",
  boat_owner: "Boat owner",
  electrician: "Electrician",
  plumber: "Plumber",
  driver_4x4: "4×4 driver",
  generator_owner: "Generator owner",
  counselor: "Counselor",
  volunteer: "Volunteer",
};

/** Short human labels for need types (triage chip on `/`, lists on `/ops`). */
export const TYPE_LABELS: Record<NeedType, string> = {
  flood_rescue: "Flood rescue",
  cardiac_no_breathing: "Cardiac arrest / not breathing",
  bleeding: "Severe bleeding",
  fracture: "Fracture / broken bone",
  electrical: "Electrical hazard",
  fire: "Fire",
  trapped_structural: "Trapped / structural collapse",
  snakebite: "Snakebite",
  evacuation_mobility: "Evacuation / mobility",
  supplies_oxygen_meds: "Oxygen / medicines / supplies",
  missing_person: "Missing person",
  other: "Other emergency",
};

/** ≤ 12 chars each; used only inside SMS templates so a ping stays one segment (CONTRACTS §1, §7). */
export const TYPE_SMS_LABELS: Record<NeedType, string> = {
  flood_rescue: "flood",
  cardiac_no_breathing: "cardiac",
  bleeding: "bleeding",
  fracture: "fracture",
  electrical: "electrical",
  fire: "fire",
  trapped_structural: "trapped",
  snakebite: "snakebite",
  evacuation_mobility: "evacuation",
  supplies_oxygen_meds: "supplies",
  missing_person: "missing",
  other: "emergency",
};

/** The one fixed clarifying question (README §4); set on TriageResult when the rules fallback is unsure. */
export const CLARIFYING_QUESTION =
  "Is anyone hurt, trapped, or in water right now? Tell me what you see.";

// Hand-written type guards (README §4: no schema libraries).

export function isSkill(x: unknown): x is Skill {
  return typeof x === "string" && (SKILLS as readonly string[]).includes(x);
}

export function isNeedType(x: unknown): x is NeedType {
  return typeof x === "string" && (NEED_TYPES as readonly string[]).includes(x);
}

export function isUrgency(x: unknown): x is Urgency {
  return typeof x === "string" && (URGENCIES as readonly string[]).includes(x);
}

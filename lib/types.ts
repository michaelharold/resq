/**
 * ResQ shared types (README §8, CONTRACTS §2).
 *
 * All timestamps are ISO-8601 strings (JSON-safe, adapter-agnostic). Ids are
 * `crypto.randomUUID()` except seeded helpers (`seed-helper-01` … `seed-helper-30`).
 * The README's `Request` entity is named `HelpRequest` in code because `Request`
 * collides with the Fetch API global.
 *
 * The unions below are derived from the `as const` arrays in ./taxonomy. That import
 * is type-only (erased at compile time), so this file has no runtime dependencies and
 * `scripts/seed.ts` can `import type` from it under Node's type stripping.
 */
import type { NEED_TYPES, SKILLS, URGENCIES } from "./taxonomy";

export type Skill = (typeof SKILLS)[number];
export type NeedType = (typeof NEED_TYPES)[number];
export type Urgency = (typeof URGENCIES)[number];

export type LatLng = { lat: number; lng: number };
export type Channel = "app" | "sms";

export type Helper = {
  id: string;
  name: string;
  phone: string; // E.164, e.g. "+919000000001"
  skills: Skill[];
  location: LatLng | null;
  onDuty: boolean;
  reliability: number; // 0..1, starts 0.7 (INITIAL_RELIABILITY)
  lastSeen: string;
};

export type TriageResult = {
  type: NeedType;
  urgency: Urgency;
  skills: Skill[]; // never empty: falls back to TYPE_SKILLS[type]
  summary: string;
  confidence: number; // 0..1
  source: "ollama" | "rules";
  // CLARIFYING_QUESTION when source === "rules" && confidence < 0.5; never blocks dispatch (CONTRACTS §6)
  clarifyingQuestion: string | null;
};

export type RequestStatus = "triaging" | "searching" | "matched" | "resolved" | "escalated" | "cancelled";
export type LocationSource = "gps" | "landmark" | "none";

export type HelpRequest = {
  id: string;
  requesterId: string; // app: x-resq-uid; sms: "sms:+91..."
  requesterPhone: string | null; // set for channel "sms" so we can text updates back; null for app requests
  // The requester's own helper record, if any — excluded from selectWave.
  // app: getHelperSession(req)?.helperId ?? null; sms: (await store.getHelperByPhone(phone))?.id ?? null
  requesterHelperId: string | null;
  description: string;
  location: LatLng | null;
  locationSource: LocationSource;
  landmark: string | null;
  channel: Channel;
  triage: TriageResult | null;
  status: RequestStatus;
  wave: number; // 0 before dispatch starts, 1..4 while searching
  radiusKm: number; // WAVE_RADII_KM[wave-1], 0 before dispatch
  waveStartedAt: string | null; // when the current wave's pings went out; null before wave 1 and after escalate
  matchedHelperId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DispatchStatus = "pinged" | "accepted" | "rejected" | "expired" | "cancelled";

export type Dispatch = {
  id: string;
  requestId: string;
  helperId: string;
  wave: number;
  score: number;
  distanceKm: number;
  // Records how the helper answered: created as "app"; the inbound webhook sets it to "sms" on the
  // dispatch it accepts or rejects (waves.accept / waves.onReject with via: "sms"). Shown as a badge
  // on /ops; nothing else reads it.
  channel: Channel;
  status: DispatchStatus;
  pingedAt: string;
  respondedAt: string | null;
};

export type Rating = { id: string; requestId: string; helperId: string; stars: number; createdAt: string };

export type Otp = { phone: string; code: string; expiresAt: string; attempts: number }; // attempts = wrong tries so far, starts 0

// Wire shapes (what routes return). Defined here so client and server share them.

export type GuidanceCard = {
  type: NeedType;
  title: string;
  steps: string[];
  doNot: string[];
  call112When: string[];
  source: string;
};

/** Public projection of a dispatch for the requester: no helper name/phone. */
export type DispatchPublic = Pick<Dispatch, "id" | "wave" | "status" | "distanceKm" | "pingedAt"> & {
  helperSkills: Skill[];
};

/** The matched helper as shown to the requester; distanceKm = the accepted dispatch's distanceKm. */
export type HelperPublic = Pick<Helper, "id" | "name" | "skills" | "phone"> & { distanceKm: number | null };

/** GET /api/requests/:id, POST .../tick, requester SSE snapshot. */
export type RequestView = {
  request: HelpRequest;
  dispatches: DispatchPublic[];
  guidance: GuidanceCard | null;
  matchedHelper: HelperPublic | null;
  waveEndsAt: string | null; // waveStartedAt + WAVE_WINDOW_MS while status === "searching"; null otherwise
};

/** Helper SSE snapshot item / GET /api/helpers/me. */
export type IncomingCard = {
  dispatch: Dispatch;
  request: Pick<HelpRequest, "id" | "description" | "triage" | "status" | "createdAt" | "wave">;
  expiresAt: string; // dispatch.pingedAt + WAVE_WINDOW_MS
};

export type HelperView = {
  helper: Helper | null;
  pinged: IncomingCard[];
  active: { request: HelpRequest; mapsUrl: string | null } | null;
};

export type OpsView = {
  requests: HelpRequest[];
  helpers: Helper[];
  dispatches: Dispatch[];
  center: LatLng;
  generatedAt: string;
};

export type StoreErrorReason = "already_matched" | "expired" | "not_found";

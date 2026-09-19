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
import type { NEED_TYPES, SKILLS, URGENCIES, Equipment } from "./taxonomy";
export type { Equipment } from "./taxonomy";
import type { HazardKind } from "./hazards";
export type { HazardKind } from "./hazards";

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
  equipment?: Equipment[]; // what they own that helps in an emergency
  trustTier?: TrustTier;        // read via tierOf() — absent on older records = TIER_1_NEIGHBOR
  credentialId?: string | null; // licence / registration number given for Tier 2 / Tier 3 (self-declared in the demo)
  walletBalance?: number;       // read via walletOf() — credited when escrow is released
  profile?: UserProfile;   // basic details collected at sign-up
};

/** Basic details every user gives at sign-up. Shared with the person on the other side of an accepted request. */
export type UserProfile = {
  age: number | null; bloodGroup: string | null; address: string | null; medicalNotes: string | null;
  emergencyContactName: string | null; emergencyContactPhone: string | null;
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
  equipment: Equipment[]; // equipment the situation specifically calls for ("need a pump" → water_pump); may be empty
  hazardAlert: HazardAlert; // hidden scene hazard; texts are curated (lib/hazards.ts), only the kind is classified
};

/** Hazard warning shown to the requester. hazardTitle/hazardAction are null when hasHazard is false. */
export type HazardAlert = { hasHazard: boolean; kind: HazardKind; hazardTitle: string | null; hazardAction: string | null };

// ─── Upgrade: monetization, trust tiers ──────────────────────────────────────────────────────────────────────
export type RequestCategory = "LIFE_SAFETY" | "HOUSEHOLD_MICROGIG";
export type EscrowStatus = "HELD" | "RELEASED" | "REFUNDED";
export type GigType = "plumbing" | "electrical" | "generator_power" | "other_repair";
export type TrustTier = "TIER_1_NEIGHBOR" | "TIER_2_CERTIFIED_PRO" | "TIER_3_FIRST_RESPONDER";

export type RequestStatus = "triaging" | "searching" | "matched" | "resolved" | "escalated" | "cancelled";
export type RequesterRole = "self" | "other";
export type LocationSource = "gps" | "landmark" | "none";

export type HelpRequest = {
  id: string;
  requesterId: string; // app: x-resq-uid; sms: "sms:+91..."
  requesterName: string | null; // optional, app requests: shown to the accepted helper only
  requesterPhone: string | null; // SMS sender, or the optional phone an app requester gave; shown to the accepted helper only
  // The requester's own helper record, if any — excluded from selectWave.
  // app: getHelperSession(req)?.helperId ?? null; sms: (await store.getHelperByPhone(phone))?.id ?? null
  requesterHelperId: string | null;
  description: string;
  location: LatLng | null;
  locationSource: LocationSource;
  landmark: string | null;
  channel: Channel;
  role: RequesterRole; // "self" = the requester is the person in trouble; "other" = a witness/bystander
  requesterProfile?: UserProfile | null; // snapshot of the signed-in requester's profile at request time
  category?: RequestCategory;          // read via categoryOf() — absent = LIFE_SAFETY
  gigType?: GigType | null;            // set for HOUSEHOLD_MICROGIG
  calloutFee?: number;                 // 0 for LIFE_SAFETY; one of CALLOUT_FEES for a micro-gig
  escrowStatus?: EscrowStatus | null;  // null = no escrow (free request)
  upgradedToLifeSafety?: boolean;      // filed as a paid job but converted to a free emergency by the safety override
  fallbackAt?: string | null;          // when the 3-minute / all-waves fallback fired (LIFE_SAFETY)
  emergencyContactNotifiedAt?: string | null; // when the requester's emergency contact was texted
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
  selfSteps: string[]; // shown when the person describing it IS the person in trouble (role "self")
};

/** Public projection of a dispatch for the requester: no helper name/phone. */
export type DispatchPublic = Pick<Dispatch, "id" | "wave" | "status" | "distanceKm" | "pingedAt"> & {
  helperSkills: Skill[];
  helperTier: TrustTier;
};

/** The matched helper as shown to the requester; distanceKm = the accepted dispatch's distanceKm. */
export type HelperPublic = Pick<Helper, "id" | "name" | "skills" | "phone" | "location" | "reliability" | "equipment"> & { distanceKm: number | null; trustTier: TrustTier };

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

// ─── Disaster response (authorities) ─────────────────────────────────────────────────────────────────────────

export type PingSource = "gps" | "demo" | "request" | "seed";
/** Last known location of a person (signed-in user, helper, or SMS/app requester), keyed by phone. */
export type UserLocation = {
  phone: string; name: string | null; helperId: string | null;
  location: LatLng; accuracyM: number | null; source: PingSource; updatedAt: string;
  history: { lat: number; lng: number; at: string }[]; // last 24 h, oldest first, thinned to one point per minute
};
export type ZoneKind = "landslide" | "flood" | "fire" | "building_collapse" | "cyclone" | "other";
export type Zone = { id: string; name: string; kind: ZoneKind; center: LatLng; radiusKm: number; createdAt: string; createdBy: string; active: boolean };
export type AuthorityRole = "admin" | "officer";
export type Authority = { username: string; name: string; role: AuthorityRole; passwordHash: string; createdAt: string };
export type AuditEntry = { at: string; user: string; action: string; detail: string };

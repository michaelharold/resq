/** Hand-written input guards shared by every route (README §10 rule 6). */
import { BLOOD_GROUPS, SKILLS, isEquipment, isSkill } from "./taxonomy";
import type { Equipment, UserProfile } from "./types";
import type { LatLng, Skill } from "./types";

export function isLatLng(x: unknown): x is LatLng {
  if (!x || typeof x !== "object") return false;
  const { lat, lng } = x as Record<string, unknown>;
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}
export function isUid(x: unknown): x is string {
  return typeof x === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(x);
}
export function text(x: unknown, max: number): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim();
  return t.length >= 1 && t.length <= max ? t : null;
}
export function isStars(x: unknown): x is number {
  return Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 5;
}
export function skillsOf(x: unknown): Skill[] | null {
  if (!Array.isArray(x)) return null;
  if (!x.every(isSkill)) return null;
  const out = [...new Set(x as Skill[])];
  return out.length >= 1 && out.length <= SKILLS.length ? out : null;
}
/** Skills may be empty now: everyone signs up, not only people with special skills. */
export function skillsOrEmpty(x: unknown): Skill[] | null {
  if (x === undefined) return [];
  if (!Array.isArray(x) || !x.every(isSkill)) return null;
  return [...new Set(x as Skill[])];
}
export function equipmentOf(x: unknown): Equipment[] | null {
  if (x === undefined) return [];
  if (!Array.isArray(x) || !x.every(isEquipment)) return null;
  return [...new Set(x as Equipment[])];
}
/** Hand-validated profile; returns an error field name on failure. */
export function profileOf(x: unknown, normalizePhone: (p: unknown) => string | null): { ok: true; value: UserProfile } | { ok: false; field: string } {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const opt = (v: unknown, max: number) => (v === undefined || v === null || v === "" ? null : text(v, max));
  const age = o.age === undefined || o.age === null || o.age === "" ? null : Number(o.age);
  if (age !== null && !(Number.isInteger(age) && age >= 1 && age <= 120)) return { ok: false, field: "age" };
  const bloodGroup = opt(o.bloodGroup, 3);
  if (bloodGroup !== null && !(BLOOD_GROUPS as readonly string[]).includes(bloodGroup)) return { ok: false, field: "bloodGroup" };
  const address = opt(o.address, 200);
  if (o.address && address === null) return { ok: false, field: "address" };
  const medicalNotes = opt(o.medicalNotes, 300);
  if (o.medicalNotes && medicalNotes === null) return { ok: false, field: "medicalNotes" };
  const emergencyContactName = opt(o.emergencyContactName, 60);
  const ecp = o.emergencyContactPhone;
  const emergencyContactPhone = ecp === undefined || ecp === null || ecp === "" ? null : normalizePhone(ecp);
  if (ecp && !emergencyContactPhone) return { ok: false, field: "emergencyContactPhone" };
  return { ok: true, value: { age, bloodGroup, address, medicalNotes, emergencyContactName, emergencyContactPhone } };
}

export async function readJson(req: Request): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false }> {
  try {
    const raw = await req.text();
    if (!raw.trim()) return { ok: false };
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? { ok: true, value: v as Record<string, unknown> } : { ok: false };
  } catch {
    return { ok: false };
  }
}
export function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(value, { status, headers });
}
export function jsonError(status: number, error: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error, ...extra }, { status });
}
/** Wraps a handler so an unexpected throw becomes 500 { error: "internal" }. */
export function safe<A extends unknown[]>(fn: (...a: A) => Promise<Response>): (...a: A) => Promise<Response> {
  return async (...a: A) => {
    try {
      return await fn(...a);
    } catch (e) {
      console.error("[route]", e);
      return jsonError(500, "internal");
    }
  };
}

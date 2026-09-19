/**
 * Helper ranking (README §5). Pure functions: no store, no I/O, `now` passed in.
 *   score = 0.45*skillMatch + 0.30*proximity + 0.15*reliability + 0.10*recency
 *   skillMatch = |needed ∩ helper.skills| / |needed|; proximity = max(0, 1 - d/radius)
 *   recency = 1 if lastSeen < 10 min else 0.5
 */
import type { Helper, HelpRequest, LatLng, Skill } from "./types";

export const WAVE_RADII_KM = [1, 2, 4, 8] as const;
export const MAX_WAVES = 4;
export const PINGS_PER_WAVE = 3;
export const TICK_GRACE_MS = 1000;
export const RECENCY_WINDOW_MS = 10 * 60_000;
export const INITIAL_RELIABILITY = 0.7;
export const SEED_CENTER_DEFAULT: LatLng = { lat: 8.913, lng: 76.635 };

export function waveWindowMs(): number {
  const n = Number(process.env.RESQ_WAVE_WINDOW_MS);
  return Number.isFinite(n) && n > 0 ? n : 30_000;
}

export function getSeedCenter(): LatLng {
  const lat = Number(process.env.SEED_CENTER_LAT);
  const lng = Number(process.env.SEED_CENTER_LNG);
  return process.env.SEED_CENTER_LAT && process.env.SEED_CENTER_LNG && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng }
    : SEED_CENTER_DEFAULT;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371.0088;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function scoreHelper(i: { helper: Helper; needed: Skill[]; distanceKm: number; radiusKm: number; now: Date }): {
  score: number;
  skillMatch: number;
} {
  const needed = [...new Set(i.needed)];
  const skillMatch = needed.length ? needed.filter((s) => i.helper.skills.includes(s)).length / needed.length : 0;
  const proximity = Math.max(0, 1 - i.distanceKm / i.radiusKm);
  const seen = Date.parse(i.helper.lastSeen);
  const recency = Number.isFinite(seen) && i.now.getTime() - seen < RECENCY_WINDOW_MS ? 1 : 0.5;
  return { score: 0.45 * skillMatch + 0.3 * proximity + 0.15 * i.helper.reliability + 0.1 * recency, skillMatch };
}

export function selectWave(i: {
  request: HelpRequest;
  helpers: Helper[];
  radiusKm: number;
  excludeHelperIds: Set<string>;
  now: Date;
}): Array<{ helper: Helper; score: number; distanceKm: number }> {
  const { location, triage } = i.request;
  if (!location || !triage) return [];
  return i.helpers
    .filter((h) => h.onDuty && h.location && !i.excludeHelperIds.has(h.id))
    .map((helper) => {
      const distanceKm = haversineKm(location, helper.location as LatLng);
      return { helper, distanceKm, score: scoreHelper({ helper, needed: triage.skills, distanceKm, radiusKm: i.radiusKm, now: i.now }).score };
    })
    .filter((c) => c.distanceKm <= i.radiusKm)
    .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm || a.helper.id.localeCompare(b.helper.id))
    .slice(0, PINGS_PER_WAVE);
}

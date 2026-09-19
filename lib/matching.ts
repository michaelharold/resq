/**
 * AI matching engine: verified, available providers within 10 km whose skills match the AI's tags and who carry the
 * required tools. MongoDB does the spatial work on `users.geo` (2dsphere, GeoJSON [lng, lat]):
 *   1. toolsOnHand $all requiredTools   → "all"   (has every tool)
 *   2. toolsOnHand $in  requiredTools   → "any"   (has some of them)
 *   3. skills only                      → "skills_only"
 * Results are cross-checked with the live engine (available for work, not already on a job) and tagged with
 * isAppOnline so dispatch can choose app notification (SSE) or SMS.
 */
import { getDb } from "./mongodb";
import { getStore } from "./store";
import { haversineKm } from "./dispatch";
import { isAppOnline } from "./presence";
import { rateFor } from "./policy";
import { busyHelperIds } from "./waves";
import type { Helper, LatLng, RateRange, TaskScope, Tool } from "./types";

export const MATCH_RADIUS_M = 10_000;
export type MatchedWorker = {
  id: string; name: string; phone: string; distanceKm: number; toolsMatched: Tool[]; toolsMissing: Tool[];
  online: boolean; rate: RateRange | null;
};
export type MatchResult = { workers: MatchedWorker[]; toolMatch: "all" | "any" | "skills_only" | "none" };

type UserDoc = Helper & { _id: string };

export async function findMatchingWorkers(i: { location: LatLng; scope: TaskScope; excludeId: string; limit?: number }): Promise<MatchResult> {
  const users = (await getDb()).collection<UserDoc>("users");
  const base = {
    geo: { $near: { $geometry: { type: "Point", coordinates: [i.location.lng, i.location.lat] }, $maxDistance: MATCH_RADIUS_M } },
    skills: { $in: i.scope.workerMatchingTags },          // specializations / service category
    "idProof.status": "verified",                         // verified workers only
    _id: { $ne: i.excludeId },
  };
  const tools = i.scope.requiredTools;
  const tiers: [MatchResult["toolMatch"], Record<string, unknown>][] = tools.length
    ? [["all", { ...base, toolsOnHand: { $all: tools } }], ["any", { ...base, toolsOnHand: { $in: tools } }], ["skills_only", base]]
    : [["skills_only", base]];

  const store = getStore();
  const busy = await busyHelperIds();
  for (const [tier, filter] of tiers) {
    const docs = await users.find(filter as never).limit(i.limit ?? 25).toArray(); // $near already sorts by distance
    const workers: MatchedWorker[] = [];
    for (const d of docs) {
      const live = await store.getHelper(d._id); // the live engine knows who is available right now
      if (!live || !live.onDuty || !live.location || busy.has(live.id)) continue;
      const have = live.toolsOnHand ?? [];
      workers.push({
        id: live.id, name: live.name, phone: live.phone, distanceKm: +haversineKm(i.location, live.location).toFixed(2),
        toolsMatched: tools.filter((t) => have.includes(t)), toolsMissing: tools.filter((t) => !have.includes(t)),
        online: isAppOnline(live.id), rate: rateFor(live, i.scope.category),
      });
    }
    if (workers.length) return { workers, toolMatch: tier };
  }
  return { workers: [], toolMatch: "none" };
}

/**
 * The signed-in user's dashboard in the community-services app:
 *   - their profile, their own open request, and the job they accepted (if any);
 *   - as a provider: open service requests nearby for the services they offer, with the requester's details,
 *     newest first. Hidden while they are unavailable or already on a job.
 */
import { getStore } from "./store";
import { haversineKm } from "./dispatch";
import { mapsUrl } from "./sms";
import { hasDeclined } from "./waves";
import { categoryOf, rateFor } from "./policy";
import { buildHelperView } from "./views";
import type { Equipment, Helper, HelperView, HelpRequest, RateRange, Skill } from "./types";

export const FEED_RADIUS_KM = 10;

export type FeedItem = {
  request: HelpRequest; distanceKm: number | null; mapsUrl: string | null;
  matchedSkills: Skill[]; matchedEquipment: Equipment[]; picked: boolean; expiresAt: string | null;
  myRate: RateRange | null; // what this provider charges for the requested service
};
export type Dashboard = {
  me: Helper | null; phone: string; active: HelperView["active"]; myRequest: HelpRequest | null;
  feed: FeedItem[]; otherNearby: number; radiusKm: number;
  hiddenWhileUnavailable: number; // matching requests nearby that are not shown because availability is off
  hiddenWhileBusy: number;        // matching requests waiting while this person is on a job (shown after "Mark as done")
};

export async function buildDashboard(helperId: string | null, phone: string): Promise<Dashboard> {
  const store = getStore();
  const me = helperId ? await store.getHelper(helperId) : null;
  const open = await store.listOpenRequests();
  const base: Dashboard = { me, phone, active: null, myRequest: null, feed: [], otherNearby: 0, radiusKm: FEED_RADIUS_KM, hiddenWhileUnavailable: 0, hiddenWhileBusy: 0 };
  if (!me) return base;
  base.active = (await buildHelperView(me.id)).active;
  base.myRequest = open.find((r) => r.requesterHelperId === me.id && categoryOf(r) === "SERVICE" && r.status !== "resolved" && r.status !== "cancelled") ?? null;

  for (const r of open) {
    if (categoryOf(r) !== "SERVICE" || r.status !== "searching" || !r.service) continue;
    if (r.requesterHelperId === me.id || hasDeclined(r.id, me.id)) continue;
    const distanceKm = me.location && r.location ? +haversineKm(me.location, r.location).toFixed(2) : null;
    if (distanceKm !== null && distanceKm > FEED_RADIUS_KM) continue;
    if (!me.skills.includes(r.service)) { base.otherNearby++; continue; }
    base.feed.push({
      request: r, distanceKm, mapsUrl: r.location ? mapsUrl(r.location) : null, matchedSkills: [r.service], matchedEquipment: [],
      picked: false, expiresAt: null, myRate: rateFor(me, r.service),
    });
  }
  base.feed.sort((a, b) => b.request.createdAt.localeCompare(a.request.createdAt) || (a.distanceKm ?? 99) - (b.distanceKm ?? 99));
  // On a job: nothing else until it is marked done. Not available: no requests, no alerts.
  if (base.active) { base.hiddenWhileBusy = base.feed.length; base.feed = []; }
  else if (!me.onDuty) { base.hiddenWhileUnavailable = base.feed.length; base.feed = []; }
  return base;
}

/**
 * The signed-in user's dashboard: their profile, their own open request, the job they accepted, and nearby open
 * requests that need their skills or equipment (full requester details, so they can decide).
 * Upgrade: requests the user may not accept (paid micro-gigs without a Certified Pro badge) are hidden entirely;
 * equipment matches use what triage says the situation calls for plus the usual kit for the need type; a paid
 * micro-gig is only relevant to someone with the trade skill (owning a pump does not make you the plumber).
 */
import { getStore } from "./store";
import { haversineKm, waveWindowMs } from "./dispatch";
import { mapsUrl } from "./sms";
import { TYPE_EQUIPMENT } from "./taxonomy";
import { hasDeclined } from "./waves";
import { canAccept, categoryOf } from "./policy";
import { buildHelperView } from "./views";
import type { Equipment, Helper, HelperView, HelpRequest, Skill } from "./types";

export const FEED_RADIUS_KM = 10;
const URGENCY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export type FeedItem = {
  request: HelpRequest; distanceKm: number | null; mapsUrl: string | null;
  matchedSkills: Skill[]; matchedEquipment: Equipment[]; picked: boolean; expiresAt: string | null;
};
export type Dashboard = {
  me: Helper | null; phone: string; active: HelperView["active"]; myRequest: HelpRequest | null;
  feed: FeedItem[]; otherNearby: number; radiusKm: number;
  hiddenWhileUnavailable: number; // matching requests nearby that are not shown because availability is off
};

export async function buildDashboard(helperId: string | null, phone: string): Promise<Dashboard> {
  const store = getStore();
  const me = helperId ? await store.getHelper(helperId) : null;
  const open = await store.listOpenRequests();
  const base: Dashboard = { me, phone, active: null, myRequest: null, feed: [], otherNearby: 0, radiusKm: FEED_RADIUS_KM, hiddenWhileUnavailable: 0 };
  if (!me) return base;
  base.active = (await buildHelperView(me.id)).active;
  base.myRequest = open.find((r) => r.requesterHelperId === me.id && r.status !== "resolved" && r.status !== "cancelled") ?? null;

  for (const r of open) {
    if (r.status !== "searching" && r.status !== "escalated") continue;
    if (r.requesterHelperId === me.id || hasDeclined(r.id, me.id)) continue;
    if (!canAccept(me, r)) continue; // not shown, not counted: they could not take it anyway
    const distanceKm = me.location && r.location ? +haversineKm(me.location, r.location).toFixed(2) : null;
    if (distanceKm !== null && distanceKm > FEED_RADIUS_KM) continue;
    const type = r.triage?.type ?? "other";
    const matchedSkills = (r.triage?.skills ?? []).filter((s) => me.skills.includes(s));
    const gig = categoryOf(r) === "HOUSEHOLD_MICROGIG";
    // A paid job lists only the tools of its trade; an emergency also lists the usual kit for its need type.
    const wanted: Equipment[] = [...new Set([...(r.triage?.equipment ?? []), ...(gig ? [] : TYPE_EQUIPMENT[type])])];
    const matchedEquipment = wanted.filter((e) => (me.equipment ?? []).includes(e));
    const ping = (await store.listDispatches(r.id)).find((d) => d.helperId === me.id && d.status === "pinged");
    const relevant = matchedSkills.length > 0 || (!gig && matchedEquipment.length > 0) || !!ping;
    if (!relevant) { base.otherNearby++; continue; }
    base.feed.push({
      request: r, distanceKm, mapsUrl: r.location ? mapsUrl(r.location) : null, matchedSkills, matchedEquipment,
      picked: !!ping, expiresAt: ping ? new Date(Date.parse(ping.pingedAt) + waveWindowMs()).toISOString() : null,
    });
  }
  base.feed.sort((a, b) => Number(b.picked) - Number(a.picked)
    || (URGENCY_RANK[a.request.triage?.urgency ?? "low"] - URGENCY_RANK[b.request.triage?.urgency ?? "low"])
    || (a.distanceKm ?? 99) - (b.distanceKm ?? 99));
  // Not available (switched off, or paused automatically after asking for help): no requests, no alerts.
  if (!me.onDuty) { base.hiddenWhileUnavailable = base.feed.length; base.feed = []; }
  return base;
}

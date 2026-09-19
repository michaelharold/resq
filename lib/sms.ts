/** Twilio SMS with a simulated mode (no credentials → messages are logged). Never throws. */
import { getTwilio, twilioAuthConfigured } from "./twilio";
import { SKILL_LABELS, TYPE_SMS_LABELS } from "./taxonomy";
import { waveWindowMs } from "./dispatch";
import type { LatLng, NeedType, Skill, Urgency } from "./types";

export function normalizePhone(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const s = x.replace(/[\s\-().]/g, "");
  if (/^\+\d{8,15}$/.test(s)) return s;
  if (/^\d{10}$/.test(s)) return `+91${s}`;
  if (/^0\d{10}$/.test(s)) return `+91${s.slice(1)}`;
  return null;
}
export function smsConfigured(): boolean {
  return twilioAuthConfigured() && !!process.env.TWILIO_FROM?.trim(); // messaging needs a Twilio sender number
}

export type SmsLog = { to: string; body: string; at: string; simulated: boolean; ok: boolean };
const g = globalThis as unknown as { __resq_smslog?: SmsLog[] };
export function recentSms(): SmsLog[] { return [...(g.__resq_smslog ?? [])]; }
function record(e: SmsLog) { (g.__resq_smslog ??= []).unshift(e); g.__resq_smslog.length = Math.min(g.__resq_smslog.length, 50); }

export async function sendSms(to: string, body: string): Promise<{ ok: boolean; simulated: boolean; sid?: string; error?: string }> {
  const at = new Date().toISOString();
  if (!smsConfigured()) {
    console.log(`[sms:simulated] to=${to} body=${body}`);
    record({ to, body, at, simulated: true, ok: true });
    return { ok: true, simulated: true };
  }
  try {
    const msg = await (await getTwilio()).messages.create({
      to, from: process.env.TWILIO_FROM, body,
    });
    record({ to, body, at, simulated: false, ok: true });
    return { ok: true, simulated: false, sid: msg.sid };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[sms] to=${to} failed: ${error}`);
    record({ to, body, at, simulated: false, ok: false });
    return { ok: false, simulated: false, error };
  }
}

export function twiml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${esc}</Message></Response>`;
}
export function formatDistance(km: number): string {
  return km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${(Math.round(km * 10) / 10).toFixed(1)} km`;
}
export function mapsUrl(loc: LatLng): string {
  return `https://maps.google.com/?q=${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}`;
}
export function tplPing(i: { distanceKm: number; skill: Skill; type: NeedType; urgency: Urgency }): string {
  return `RESQ: person ${formatDistance(i.distanceKm)} away needs a ${SKILL_LABELS[i.skill].toUpperCase()} (${TYPE_SMS_LABELS[i.type]}, ${i.urgency}). Reply YES to accept, NO to skip. Expires in ${Math.round(waveWindowMs() / 1000)} s.`;
}
export const tplOtp = (code: string) => `RESQ: your login code is ${code}. It expires in 5 min.`;
export const tplRequesterMatched = (i: { name: string; skill: Skill; distanceKm: number; phone: string }) =>
  `RESQ: ${i.name} (${SKILL_LABELS[i.skill]}, ${formatDistance(i.distanceKm)} away) is coming. Call ${i.phone}.`;
export const tplRequesterEscalated = () => "RESQ: No helper could be reached. A coordinator is alerted. Call 112 now.";
export const tplHelperAccepted = (i: { mapsUrl: string | null; phone: string | null }) =>
  `RESQ: You're matched. Map: ${i.mapsUrl ?? "location unknown"}. Call the requester: ${i.phone ?? "via app"}.`;

/** Sent to helpers who were pinged but did not take the job, once the request is closed. */
export const tplRequestClosed = (i: { typeLabel: string; outcome: "resolved" | "cancelled" }) =>
  `RESQ: The ${i.typeLabel} request near you has been ${i.outcome === "resolved" ? "resolved" : "cancelled"}. No action needed. Thank you.`;

/** New service request near a provider (they accept in the app). */
export const tplServiceRequest = (i: { service: Skill; distanceKm: number }) =>
  `RESQ: New ${SKILL_LABELS[i.service]} request ${formatDistance(i.distanceKm)} from you. Open the ResQ app to see details and accept.`;

/** Job alert for providers who are not in the app (basic phones). They claim it by replying ACCEPT <code>. */
export function tplScopedJob(i: { category: string; title: string; minutes: number; tools: string[]; code: string; distanceKm: number }): string {
  const tools = i.tools.length ? i.tools.join(", ") : "standard kit";
  const msg = `[ResQ Alert] ${i.category} Job Nearby! Task: ${i.title}. Est: ${i.minutes}m. Tools: ${tools}. ${formatDistance(i.distanceKm)} away. Reply ACCEPT ${i.code} to claim.`;
  return msg.length <= 320 ? msg : `[ResQ Alert] ${i.category} Job Nearby! Task: ${i.title.slice(0, 50)}. Est: ${i.minutes}m. Reply ACCEPT ${i.code} to claim.`;
}

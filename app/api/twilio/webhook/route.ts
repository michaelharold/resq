/**
 * Twilio webhook for offline providers. "ACCEPT 1234" claims the open job with that code:
 *   1. parse Body (case-insensitive, "ACCEPT 1234" / "accept #1234") and From (the worker's phone);
 *   2. find the OPEN job in MongoDB `jobs` by its 4-digit code;
 *   3. claim it atomically through the live engine (same lock as an in-app Accept, so app and SMS can never both win)
 *      and mark it ASSIGNED in MongoDB with a conditional update (status must still be OPEN);
 *   4. reply with TwiML: the job details, or why it could not be claimed.
 * Anything else (YES / NO / HELP …) is passed to the existing SMS handler, because a Twilio number has one webhook.
 */
import { getStore } from "@/lib/store";
import { isOps } from "@/lib/auth";
import { findOpenByCode, jobsCollection, markAssigned, registerJobMirror } from "@/lib/jobs";
import { mapsUrl, normalizePhone, twiml } from "@/lib/sms";
import { SKILL_LABELS, TOOL_LABELS } from "@/lib/taxonomy";
import { claim } from "@/lib/waves";
import { POST as legacyInbound } from "../inbound/route";

export const dynamic = "force-dynamic";
const ACCEPT = /^\s*accept\s*#?\s*(\d{4})\b/i;
const reply = (t: string) => new Response(twiml(t), { status: 200, headers: { "content-type": "text/xml" } });

export async function POST(req: Request) {
  const raw = await req.text(); // read once so it can be re-sent to the legacy handler
  const fields = Object.fromEntries(new URLSearchParams(raw));
  const body = (fields.Body ?? "").trim();
  const m = body.match(ACCEPT);
  if (!m) {
    return legacyInbound(new Request(req.url, { method: "POST", headers: req.headers, body: raw }));
  }
  try {
    if (process.env.TWILIO_VALIDATE_SIGNATURE === "1" && !isOps(req)) {
      const twilio = (await import("twilio")).default;
      const valid = twilio.validateRequest(process.env.TWILIO_AUTH_TOKEN ?? "", req.headers.get("x-twilio-signature") ?? "",
        `${process.env.PUBLIC_BASE_URL ?? ""}/api/twilio/webhook`, fields);
      if (!valid) return Response.json({ error: "forbidden" }, { status: 403 });
    }
    registerJobMirror();
    const phone = normalizePhone(fields.From ?? "");
    const code = m[1];
    const worker = phone ? await getStore().getHelperByPhone(phone) : null;
    if (!worker) return reply(`ResQ: This number is not registered as a provider. Sign up in the ResQ app first.`);
    const job = await findOpenByCode(code);
    if (!job) return reply(`ResQ: Job ${code} is no longer open. It may have been taken by another provider. Thank you!`);
    const r = await claim(job._id, worker.id);
    if (!r.ok && r.reason === "not_found") {
      await (await jobsCollection()).updateOne({ _id: job._id, status: "OPEN" }, { $set: { status: "CANCELLED", updatedAt: new Date() } });
      return reply(`ResQ: Job ${code} is no longer open. Thank you!`);
    }
    if (!r.ok) {
      const why = r.reason === "already_matched" ? `Sorry, job ${code} was just taken by another provider.`
        : r.reason === "busy" ? `Finish your current job first, then you can accept ${code}.`
        : r.reason === "service_mismatch" ? `Job ${code} needs a ${SKILL_LABELS[job.scope.category]}; your profile doesn't offer that service.`
        : r.reason === "own_request" ? `That is your own request.` : `Job ${code} can't be accepted right now.`;
      return reply(`ResQ: ${why}`);
    }
    await markAssigned(job._id, { id: worker.id, phone: worker.phone }, "sms");
    const req2 = r.request;
    const tools = job.scope.requiredTools.map((t) => TOOL_LABELS[t]).join(", ") || "standard kit";
    const answers = (req2.answers ?? []).map((a) => `${a.question} ${a.answer}`).join("; ");
    const where = req2.location ? mapsUrl(req2.location) : "ask the customer";
    return reply([
      `ResQ: Job ${code} is yours: ${job.scope.parsedTitle}.`,
      `Customer: ${req2.requesterName ?? "customer"} ${req2.requesterPhone ?? ""}.`,
      `Bring: ${tools}. Est ${job.scope.estimatedTimeMinutes} min.`,
      answers ? `Details: ${answers}.` : "",
      `Map: ${where}`,
      (req2.attachments?.length ?? 0) > 0 ? `${req2.attachments!.length} photo(s) in the ResQ app.` : "",
    ].filter(Boolean).join(" "));
  } catch (e) {
    console.error("[twilio/webhook]", e);
    return reply("ResQ: Something went wrong. Please try again or accept in the app.");
  }
}

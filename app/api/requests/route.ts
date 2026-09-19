import { getHelperSession, getRequesterId } from "@/lib/auth";
import { isLatLng, json, jsonError, pricingOf, readJson, safe, text } from "@/lib/validate";
import { normalizePhone } from "@/lib/sms";
import { getStore } from "@/lib/store";
import { createHelpRequest } from "@/lib/waves";
import { buildRequestView } from "@/lib/views";

export const dynamic = "force-dynamic";

/**
 * POST /api/requests → 201 RequestView.
 * Body: { description, location?, role?, name?, phone?, category?, gigType?, calloutFee? }.
 * category defaults to LIFE_SAFETY (always free). HOUSEHOLD_MICROGIG needs gigType + calloutFee ∈ CALLOUT_FEES and a
 * signed-in account (401): money is only ever held for, and refunded to, a known person. The fee is held in the
 * in-memory escrow; if triage finds an emergency the request is converted to a free life-safety request (lib/waves.ts).
 */
export const POST = safe(async (req: Request) => {
  // Signed-in users (the normal path): name, phone and profile come from their account.
  const session = getHelperSession(req);
  const account = session?.helperId ? await getStore().getHelper(session.helperId) : null;
  const requesterId = account ? `acct:${account.id}` : getRequesterId(req);
  if (!requesterId) return jsonError(401, "unauthenticated");
  const body = await readJson(req);
  if (!body.ok) return jsonError(400, "bad_json");
  const description = text(body.value.description, 1000);
  if (!description) return jsonError(400, "description_invalid");
  const loc = body.value.location;
  if (loc !== undefined && loc !== null && !isLatLng(loc)) return jsonError(400, "location_invalid");
  const location = isLatLng(loc) ? loc : null;
  const role = body.value.role;
  if (role !== undefined && role !== "self" && role !== "other") return jsonError(400, "role_invalid");
  const b = body.value;
  const requesterName = b.name === undefined || b.name === "" ? null : text(b.name, 60);
  if (requesterName === null && b.name !== undefined && b.name !== "") return jsonError(400, "name_invalid");
  const requesterPhone = b.phone === undefined || b.phone === "" ? null : normalizePhone(b.phone);
  if (requesterPhone === null && b.phone !== undefined && b.phone !== "") return jsonError(400, "phone_invalid");
  const pricing = pricingOf(b);
  if (!pricing.ok) return jsonError(400, pricing.error);
  if (pricing.value.category === "HOUSEHOLD_MICROGIG" && !account) return jsonError(401, "unauthenticated", { detail: "A paid household job needs a signed-in account." });
  const r = await createHelpRequest({
    requesterId, requesterPhone: requesterPhone ?? account?.phone ?? null, requesterName: requesterName ?? account?.name ?? null,
    requesterProfile: account?.profile ?? null, requesterHelperId: account?.id ?? null, description,
    location, locationSource: location ? "gps" : "none", landmark: null, channel: "app", role,
    category: pricing.value.category, gigType: pricing.value.gigType, calloutFee: pricing.value.calloutFee,
  });
  return json(await buildRequestView(r.id), 201);
});

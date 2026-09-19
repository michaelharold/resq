import { getHelperSession, getRequesterId } from "@/lib/auth";
import { isLatLng, json, jsonError, readJson, safe, text } from "@/lib/validate";
import { normalizePhone } from "@/lib/sms";
import { createHelpRequest } from "@/lib/waves";
import { buildRequestView } from "@/lib/views";

export const dynamic = "force-dynamic";

export const POST = safe(async (req: Request) => {
  const requesterId = getRequesterId(req);
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
  const r = await createHelpRequest({
    requesterId, requesterPhone, requesterName, requesterHelperId: getHelperSession(req)?.helperId ?? null, description,
    location, locationSource: location ? "gps" : "none", landmark: null, channel: "app", role,
  });
  return json(await buildRequestView(r.id), 201);
});

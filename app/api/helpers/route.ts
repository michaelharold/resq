import { randomUUID } from "node:crypto";
import { getStore } from "@/lib/store";
import { getHelperSession, isOps } from "@/lib/auth";
import { emit } from "@/lib/events";
import { INITIAL_RELIABILITY } from "@/lib/dispatch";
import { HELPER_SESSION_MAX_AGE_SEC, SESSION_COOKIE, isSecureRequest, serializeCookie, sign } from "@/lib/session";
import { normalizePhone } from "@/lib/sms";
import { isLatLng, json, jsonError, readJson, safe, skillsOf, text } from "@/lib/validate";
import { onReject } from "@/lib/waves";
import type { Helper } from "@/lib/types";

export const dynamic = "force-dynamic";

export const POST = safe(async (req: Request) => {
  const ops = isOps(req);
  const s = getHelperSession(req);
  if (!ops && !s) return jsonError(401, "unauthenticated");
  const body = await readJson(req);
  if (!body.ok) return jsonError(400, "bad_json");
  const b = body.value;
  const name = text(b.name, 60);
  if (!name) return jsonError(400, "name_invalid");
  const phone = normalizePhone(b.phone);
  if (!phone) return jsonError(400, "phone_invalid");
  const skills = skillsOf(b.skills);
  if (!skills) return jsonError(400, "skills_invalid");
  if (b.location !== undefined && b.location !== null && !isLatLng(b.location)) return jsonError(400, "location_invalid");
  if (b.onDuty !== undefined && typeof b.onDuty !== "boolean") return jsonError(400, "onDuty_invalid");
  if (b.reliability !== undefined && !(typeof b.reliability === "number" && b.reliability >= 0 && b.reliability <= 1)) return jsonError(400, "reliability_invalid");
  if (b.lastSeen !== undefined && !(typeof b.lastSeen === "string" && Number.isFinite(Date.parse(b.lastSeen)))) return jsonError(400, "lastSeen_invalid");
  if (b.id !== undefined && typeof b.id !== "string") return jsonError(400, "id_invalid");
  const store = getStore();
  let existing: Helper | null;
  if (!ops && s) {
    if (phone !== s.phone) return jsonError(403, "forbidden");
    if (b.id !== undefined && b.id !== s.helperId) return jsonError(403, "forbidden");
    if (b.reliability !== undefined || b.lastSeen !== undefined) return jsonError(403, "forbidden");
    existing = await store.getHelperByPhone(phone);
  } else {
    existing = typeof b.id === "string" ? await store.getHelper(b.id) : await store.getHelperByPhone(phone);
  }
  const now = new Date().toISOString();
  const helper = await store.upsertHelper({
    id: existing?.id ?? (typeof b.id === "string" ? b.id : randomUUID()),
    name, phone, skills,
    location: isLatLng(b.location) ? b.location : b.location === null ? null : existing?.location ?? null,
    onDuty: typeof b.onDuty === "boolean" ? b.onDuty : existing?.onDuty ?? false,
    reliability: typeof b.reliability === "number" ? b.reliability : existing?.reliability ?? INITIAL_RELIABILITY,
    lastSeen: typeof b.lastSeen === "string" ? b.lastSeen : existing?.lastSeen ?? now,
  });
  emit("helper:updated", { helper });
  const headers: HeadersInit = {};
  let token: string | undefined;
  if (!ops && s) {
    token = sign({ phone, helperId: helper.id, exp: Date.now() + HELPER_SESSION_MAX_AGE_SEC * 1000 });
    headers["set-cookie"] = serializeCookie(SESSION_COOKIE, token, { maxAgeSec: HELPER_SESSION_MAX_AGE_SEC, secure: isSecureRequest(req) });
  }
  return json({ helper, token }, 200, headers);
});

export const PATCH = safe(async (req: Request) => {
  const ops = isOps(req);
  const s = getHelperSession(req);
  if (!ops && !s) return jsonError(401, "unauthenticated");
  const body = await readJson(req);
  if (!body.ok) return jsonError(400, "bad_json");
  const b = body.value;
  let id: string;
  if (!ops && s) {
    if (!s.helperId) return jsonError(401, "unauthenticated");
    id = s.helperId;
  } else {
    if (typeof b.id !== "string") return jsonError(400, "id_invalid");
    id = b.id;
  }
  if (b.onDuty !== undefined && typeof b.onDuty !== "boolean") return jsonError(400, "onDuty_invalid");
  if (b.location !== undefined && !isLatLng(b.location)) return jsonError(400, "location_invalid");
  if (b.onDuty === undefined && b.location === undefined) return jsonError(400, "body_invalid");
  const store = getStore();
  const cur = await store.getHelper(id);
  if (!cur) return jsonError(404, "not_found");
  const helper = (await store.setOnDuty(id, typeof b.onDuty === "boolean" ? b.onDuty : cur.onDuty, isLatLng(b.location) ? b.location : undefined)) as Helper;
  emit("helper:updated", { helper });
  if (b.onDuty === false) for (const d of await store.listPingedForHelper(id)) await onReject(d.id);
  return json({ helper });
});

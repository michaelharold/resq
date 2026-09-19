/** Signed-in users share their location every ~30 s so authorities can find them inside a disaster zone. */
import { getHelperSession } from "@/lib/auth";
import { getStore } from "@/lib/store";
import { isLatLng, json, jsonError, readJson, safe } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const POST = safe(async (req: Request) => {
  const s = getHelperSession(req);
  if (!s) return jsonError(401, "unauthenticated");
  const body = await readJson(req);
  if (!body.ok) return jsonError(400, "bad_json");
  const { location, accuracyM, source } = body.value;
  if (!isLatLng(location)) return jsonError(400, "location_invalid");
  if (accuracyM !== undefined && accuracyM !== null && !(typeof accuracyM === "number" && accuracyM >= 0 && accuracyM < 100_000)) return jsonError(400, "accuracy_invalid");
  const store = getStore();
  const helper = s.helperId ? await store.getHelper(s.helperId) : await store.getHelperByPhone(s.phone);
  const saved = await store.recordLocation({
    phone: s.phone, name: helper?.name ?? null, helperId: helper?.id ?? null, location,
    accuracyM: typeof accuracyM === "number" ? Math.round(accuracyM) : null, source: source === "demo" ? "demo" : "gps", updatedAt: new Date().toISOString(),
  });
  // Keep the account's own position current too, so nearby requests and dispatch use where the person is now.
  if (helper) await store.upsertHelper({ ...helper, location, lastSeen: saved.updatedAt });
  return json({ ok: true, updatedAt: saved.updatedAt });
});

/** Stop sharing: forget this person's location and trail. */
export const DELETE = safe(async (req: Request) => {
  const s = getHelperSession(req);
  if (!s) return jsonError(401, "unauthenticated");
  await getStore().deleteLocation(s.phone);
  return json({ ok: true });
});

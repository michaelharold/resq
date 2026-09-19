/**
 * The dispatch state machine (README §5, docs/CONTRACTS.md §4). This is the ONLY module that changes a request's
 * status/wave, a dispatch's status, or calls store.acceptDispatch. Transitions on one request are serialised by an
 * in-process lock, re-read state inside it, persist all writes, and only then emit events. No timers: waves advance
 * when somebody calls tick() (requester screen, ops screen), so it is idempotent.
 */
import { randomUUID } from "node:crypto";
import { emit } from "./events";
import { getStore } from "./store";
import { MAX_WAVES, TICK_GRACE_MS, WAVE_RADII_KM, selectWave, waveWindowMs } from "./dispatch";
import { mapsUrl, sendSms, tplPing, tplRequesterEscalated, tplRequesterMatched } from "./sms";
import { triage } from "./triage";
import type { Channel, Dispatch, Helper, HelpRequest, LatLng, LocationSource, StoreErrorReason } from "./types";

const g = globalThis as unknown as { __resq_locks?: Map<string, Promise<unknown>> };
const locks = (g.__resq_locks ??= new Map());

export function withRequestLock<T>(requestId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(requestId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  const tail = run.catch(() => undefined);
  locks.set(requestId, tail);
  void tail.then(() => { if (locks.get(requestId) === tail) locks.delete(requestId); });
  return run;
}

const nowIso = () => new Date().toISOString();

// ── internal transitions (call only while holding the lock) ─────────────────────────────────────────────────────

async function escalateLocked(id: string): Promise<HelpRequest | null> {
  const store = getStore();
  const r = await store.updateRequest(id, { status: "escalated", waveStartedAt: null });
  if (!r) return null;
  emit("request:updated", { request: r });
  if (r.channel === "sms" && r.requesterPhone) void sendSms(r.requesterPhone, tplRequesterEscalated());
  return r;
}

async function runWaveLocked(id: string, first: number): Promise<HelpRequest | null> {
  const store = getStore();
  for (let n = first; n <= MAX_WAVES; n++) {
    const fresh = await store.getRequest(id);
    if (!fresh || fresh.status !== "searching") return fresh;
    const radiusKm = WAVE_RADII_KM[n - 1];
    const now = new Date();
    const request = (await store.updateRequest(id, { wave: n, radiusKm, waveStartedAt: now.toISOString() })) as HelpRequest;
    const existing = await store.listDispatches(id);
    const exclude = new Set(existing.map((d) => d.helperId));
    if (request.requesterHelperId) exclude.add(request.requesterHelperId);
    const picks = selectWave({ request, helpers: await store.getOnDutyHelpers(), radiusKm, excludeHelperIds: exclude, now });
    if (picks.length === 0) continue; // nobody to wait for → widen immediately
    const ds: Dispatch[] = picks.map((p) => ({
      id: randomUUID(), requestId: id, helperId: p.helper.id, wave: n, score: +p.score.toFixed(4),
      distanceKm: +p.distanceKm.toFixed(3), channel: "app", status: "pinged", pingedAt: now.toISOString(), respondedAt: null,
    }));
    await store.createDispatches(ds);
    for (const d of ds) emit("dispatch:created", { dispatch: d, request });
    emit("request:updated", { request });
    const t = request.triage;
    if (t) {
      for (const p of picks) {
        const skill = t.skills.find((s) => p.helper.skills.includes(s)) ?? t.skills[0];
        void sendSms(p.helper.phone, tplPing({ distanceKm: p.distanceKm, skill, type: t.type, urgency: t.urgency }));
      }
    }
    return request;
  }
  return escalateLocked(id);
}

async function expirePinged(id: string): Promise<void> {
  const store = getStore();
  const request = await store.getRequest(id);
  for (const d of await store.listDispatches(id)) {
    if (d.status !== "pinged") continue;
    const u = await store.updateDispatch(d.id, { status: "expired", respondedAt: nowIso() });
    if (u && request) emit("dispatch:updated", { dispatch: u, request });
  }
}

// ── public API ──────────────────────────────────────────────────────────────────────────────────────────────────

export type NewRequestInput = {
  requesterId: string; requesterPhone: string | null; requesterHelperId: string | null; description: string;
  location: LatLng | null; locationSource: LocationSource; landmark: string | null; channel: Channel;
};

export async function createHelpRequest(input: NewRequestInput): Promise<HelpRequest> {
  const store = getStore();
  const now = nowIso();
  const created = await store.createRequest({
    id: randomUUID(), ...input, triage: null, status: "triaging", wave: 0, radiusKm: 0, waveStartedAt: null,
    matchedHelperId: null, createdAt: now, updatedAt: now,
  });
  emit("request:updated", { request: created });
  const t = await triage(input.description);
  const withTriage = (await store.updateRequest(created.id, { triage: t })) as HelpRequest;
  emit("request:updated", { request: withTriage });
  const final = input.location ? await startSearch(created.id) : await escalate(created.id);
  return final ?? withTriage;
}

export function startSearch(id: string): Promise<HelpRequest | null> {
  return withRequestLock(id, async () => {
    const store = getStore();
    const r = await store.getRequest(id);
    if (!r || r.status !== "triaging") return r;
    await store.updateRequest(id, { status: "searching", wave: 0 });
    return runWaveLocked(id, 1);
  });
}

export function tick(id: string): Promise<{ advanced: boolean; request: HelpRequest | null }> {
  return withRequestLock(id, async () => {
    const store = getStore();
    const r = await store.getRequest(id);
    if (!r || r.status !== "searching") return { advanced: false, request: r };
    const elapsed = r.waveStartedAt === null || Date.now() - Date.parse(r.waveStartedAt) >= waveWindowMs() - TICK_GRACE_MS;
    const ds = await store.listDispatches(id);
    if (!elapsed && ds.some((d) => d.wave === r.wave && d.status === "pinged")) return { advanced: false, request: r };
    await expirePinged(id);
    const next = r.wave < MAX_WAVES ? await runWaveLocked(id, r.wave + 1) : await escalateLocked(id);
    return { advanced: true, request: next };
  });
}

export async function onReject(dispatchId: string, via: Channel = "app"): Promise<{ ok: true; dispatch: Dispatch } | { ok: false; reason: "expired" | "not_found" }> {
  const d0 = await getStore().getDispatch(dispatchId);
  if (!d0) return { ok: false, reason: "not_found" };
  return withRequestLock(d0.requestId, async () => {
    const store = getStore();
    const d = await store.getDispatch(dispatchId);
    if (!d) return { ok: false as const, reason: "not_found" as const };
    if (d.status !== "pinged") return { ok: false as const, reason: "expired" as const };
    const u = (await store.updateDispatch(d.id, { status: "rejected", respondedAt: nowIso(), ...(via === "sms" ? { channel: "sms" as const } : {}) })) as Dispatch;
    const r = await store.getRequest(d.requestId);
    if (r) emit("dispatch:updated", { dispatch: u, request: r });
    if (r && r.status === "searching" && d.wave === r.wave) {
      const stillPinged = (await store.listDispatches(r.id)).some((x) => x.wave === r.wave && x.status === "pinged");
      if (!stillPinged) { if (r.wave < MAX_WAVES) await runWaveLocked(r.id, r.wave + 1); else await escalateLocked(r.id); }
    }
    return { ok: true as const, dispatch: u };
  });
}

export type AcceptOk = { ok: true; request: HelpRequest; dispatch: Dispatch; location: LatLng | null; mapsUrl: string | null; requesterPhone: string | null };

export async function accept(dispatchId: string, via: Channel = "app"): Promise<AcceptOk | { ok: false; reason: StoreErrorReason }> {
  const d0 = await getStore().getDispatch(dispatchId);
  if (!d0) return { ok: false, reason: "not_found" };
  return withRequestLock(d0.requestId, async () => {
    const store = getStore();
    const res = await store.acceptDispatch(dispatchId);
    if (!res.ok) return res;
    const dispatch = via === "sms" ? ((await store.updateDispatch(dispatchId, { channel: "sms" })) as Dispatch) : res.dispatch;
    const request = res.request;
    emit("dispatch:updated", { dispatch, request });
    for (const c of res.cancelled) emit("dispatch:updated", { dispatch: c, request });
    emit("request:updated", { request });
    if (request.channel === "sms" && request.requesterPhone) {
      const h = await store.getHelper(dispatch.helperId);
      const skill = h && request.triage ? request.triage.skills.find((s) => h.skills.includes(s)) ?? h.skills[0] : null;
      if (h && skill) void sendSms(request.requesterPhone, tplRequesterMatched({ name: h.name, skill, distanceKm: dispatch.distanceKm, phone: h.phone }));
    }
    return { ok: true as const, request, dispatch, location: request.location, mapsUrl: request.location ? mapsUrl(request.location) : null, requesterPhone: request.requesterPhone };
  });
}

type Simple = { ok: true; request: HelpRequest } | { ok: false; reason: "conflict" | "not_found" };

export function cancel(id: string): Promise<Simple> {
  return withRequestLock(id, async () => {
    const store = getStore();
    const r = await store.getRequest(id);
    if (!r) return { ok: false, reason: "not_found" };
    if (!["triaging", "searching", "matched", "escalated"].includes(r.status)) return { ok: false, reason: "conflict" };
    for (const d of await store.listDispatches(id)) {
      if (d.status !== "pinged") continue;
      const u = await store.updateDispatch(d.id, { status: "cancelled", respondedAt: nowIso() });
      if (u) emit("dispatch:updated", { dispatch: u, request: r });
    }
    const request = (await store.updateRequest(id, { status: "cancelled", waveStartedAt: null })) as HelpRequest;
    emit("request:updated", { request });
    return { ok: true, request };
  });
}

export function resolve(id: string): Promise<Simple> {
  return withRequestLock(id, async () => {
    const store = getStore();
    const r = await store.getRequest(id);
    if (!r) return { ok: false, reason: "not_found" };
    if (r.status !== "matched") return { ok: false, reason: "conflict" };
    const request = (await store.updateRequest(id, { status: "resolved" })) as HelpRequest;
    emit("request:updated", { request });
    return { ok: true, request };
  });
}

export function rate(id: string, stars: number): Promise<{ ok: true; request: HelpRequest; helper: Helper | null } | { ok: false; reason: "conflict" | "not_found" }> {
  return withRequestLock(id, async () => {
    const store = getStore();
    const r = await store.getRequest(id);
    if (!r) return { ok: false, reason: "not_found" };
    if (r.status !== "resolved" || !r.matchedHelperId) return { ok: false, reason: "conflict" };
    await store.saveRating({ id: randomUUID(), requestId: id, helperId: r.matchedHelperId, stars, createdAt: nowIso() });
    const h = await store.getHelper(r.matchedHelperId);
    let helper: Helper | null = null;
    if (h) {
      helper = await store.upsertHelper({ ...h, reliability: +(0.8 * h.reliability + 0.2 * (stars / 5)).toFixed(4) });
      emit("helper:updated", { helper });
    }
    return { ok: true, request: r, helper };
  });
}

export function escalate(id: string): Promise<HelpRequest | null> {
  return withRequestLock(id, () => escalateLocked(id));
}

export async function tickDueRequests(): Promise<number> {
  let n = 0;
  for (const r of await getStore().listOpenRequests()) {
    if (r.status !== "searching") continue;
    if (r.waveStartedAt && Date.now() - Date.parse(r.waveStartedAt) < waveWindowMs() - TICK_GRACE_MS) continue;
    if ((await tick(r.id)).advanced) n++;
  }
  return n;
}

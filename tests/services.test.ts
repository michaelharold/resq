process.env.SEED_ON_BOOT = "0";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

import { test } from "node:test";
import assert from "node:assert/strict";
import { getStore, resetStoreForTests } from "../lib/store";
import { MemoryStore } from "../lib/store/memory";
import { buildDashboard } from "../lib/feed";
import { claim, createServiceRequest, resolve } from "../lib/waves";
import { recentSms } from "../lib/sms";
import type { Helper, Skill } from "../lib/types";

const C = { lat: 8.913, lng: 76.635 };
const at = (km: number) => ({ lat: C.lat + km / 111.32, lng: C.lng });
const person = (id: string, km: number, skills: Skill[], phone: string, rates?: Helper["rates"]): Helper => ({
  id, name: id, phone, skills, rates, location: at(km), onDuty: true, reliability: 0.9, lastSeen: new Date().toISOString(),
});

async function world() {
  resetStoreForTests(new MemoryStore({ seed: false }));
  const s = getStore();
  await s.upsertHelper(person("leela", 0, [], "+919200000001"));
  await s.upsertHelper(person("plumberNear", 0.5, ["plumber"], "+919200000002", { plumber: { min: 300, max: 800 } }));
  await s.upsertHelper(person("plumberFar", 25, ["plumber"], "+919200000003"));
  await s.upsertHelper(person("electrician", 0.4, ["electrician"], "+919200000004"));
  const leela = (await s.getHelper("leela"))!;
  const r = await createServiceRequest({ service: "plumber", description: "Kitchen sink pipe is leaking", location: C, account: leela });
  return { r };
}

test("a service request reaches nearby providers of that service only, with their own price range", async () => {
  const { r } = await world();
  assert.equal(r.category, "SERVICE");
  assert.equal(r.service, "plumber");
  assert.equal(r.status, "searching");
  const near = await buildDashboard("plumberNear", "+919200000002");
  assert.deepEqual(near.feed.map((f) => f.request.id), [r.id]);
  assert.deepEqual(near.feed[0].myRate, { min: 300, max: 800 });
  assert.equal((await buildDashboard("plumberFar", "+919200000003")).feed.length, 0, "25 km away: outside the 10 km radius");
  assert.equal((await buildDashboard("electrician", "+919200000004")).feed.length, 0, "wrong service");
  assert.equal((await buildDashboard("leela", "+919200000001")).myRequest?.id, r.id, "requester sees it as their own request");
  assert.ok(recentSms().some((m) => m.to === "+919200000002" && /New Plumber request/.test(m.body)), "nearby plumber is texted");
  assert.ok(!recentSms().some((m) => m.to === "+919200000004" && /New Plumber request/.test(m.body)), "electrician is not texted");
});

test("only a provider of that service can accept; done marks payment due", async () => {
  const { r } = await world();
  const wrong = await claim(r.id, "electrician");
  assert.equal(wrong.ok, false);
  assert.equal((await claim(r.id, "plumberNear")).ok, true);
  const done = await resolve(r.id);
  assert.equal(done.ok, true);
  assert.equal(done.ok ? done.request.paymentStatus : null, "due");
});

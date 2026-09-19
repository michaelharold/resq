/**
 * 30 deterministic demo helpers around SEED_CENTER (docs/CONTRACTS.md §7). Self-contained so Node can run it
 * directly (`npm run seed`): only `node:` builtins and `import type`. Seeded helpers are deliberately weaker
 * than a real demo phone (reliability 0.5–0.65, lastSeen −15 min, never every flood/evacuation skill, none
 * within 150 m) so demo phones registered at the venue land in wave 1's top 3.
 */
import type { Helper, LatLng, Skill, UserLocation } from "../lib/types";

const NAMES = ["Anjali Nair", "Faizal Rahman", "Reshma Pillai", "Sreekumar V", "Fathima Beevi", "Vishnu Prasad",
  "Divya Menon", "Joseph Thomas", "Nimmy George", "Rahul Krishnan", "Athira S", "Shaji Mathew", "Lekshmi Devi",
  "Anas Muhammed", "Meera Suresh", "Arjun Das", "Sneha Varghese", "Biju Kumar", "Ayesha Salim", "Gokul Raj",
  "Parvathy R", "Nikhil Jose", "Haritha K", "Sabu Abraham", "Jithin Lal", "Revathi Mohan", "Irfan Ali",
  "Sandra Babu", "Manoj Pillai", "Deepa Unni"];

// 30 skill sets: every skill ≥ 2×, doctor/nurse/swimmer/boat_owner ≥ 3×, nobody holds all of
// {boat_owner, swimmer, driver_4x4} or all of {swimmer, boat_owner, first_aid}.
const SKILLSETS: Skill[][] = [
  ["doctor"], ["nurse", "first_aid"], ["swimmer", "volunteer"], ["boat_owner", "driver_4x4"], ["electrician"],
  ["plumber", "volunteer"], ["driver_4x4", "first_aid"], ["generator_owner"], ["counselor", "volunteer"], ["doctor", "counselor"],
  ["nurse"], ["swimmer", "first_aid"], ["boat_owner"], ["electrician", "generator_owner"], ["plumber"],
  ["volunteer", "driver_4x4"], ["first_aid", "counselor"], ["doctor", "first_aid"], ["nurse", "volunteer"], ["swimmer", "boat_owner"],
  ["boat_owner", "volunteer"], ["swimmer", "driver_4x4"], ["electrician", "volunteer"], ["generator_owner", "driver_4x4"], ["counselor"],
  ["plumber", "electrician"], ["doctor", "nurse"], ["first_aid"], ["volunteer"], ["nurse", "counselor"],
];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedHelpers(center: LatLng, now: Date): Helper[] {
  const rnd = mulberry32(20260919);
  const lastSeen = new Date(now.getTime() - 15 * 60_000).toISOString();
  return NAMES.map((name, i) => {
    const band = i % 3; // 0: 0.15–1 km, 1: 1–2 km, 2: 2–5 km — 10 each
    const [lo, hi] = band === 0 ? [0.15, 1] : band === 1 ? [1.001, 2] : [2.001, 5];
    const km = lo + rnd() * (hi - lo);
    const bearing = (i * 137.508 + rnd() * 20) * (Math.PI / 180);
    const dLat = (km / 111.32) * Math.cos(bearing);
    const dLng = (km / (111.32 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(bearing);
    return {
      id: `seed-helper-${String(i + 1).padStart(2, "0")}`,
      name,
      phone: `+9190000000${String(i + 1).padStart(2, "0")}`,
      skills: SKILLSETS[i],
      location: { lat: +(center.lat + dLat).toFixed(6), lng: +(center.lng + dLng).toFixed(6) },
      onDuty: true,
      reliability: +(0.5 + rnd() * 0.15).toFixed(3),
      lastSeen,
    };
  });
}

const FIRST = ["Aarav", "Diya", "Kiran", "Lakshmi", "Manu", "Neha", "Omana", "Pranav", "Rani", "Sajan", "Tessa", "Unni",
  "Varsha", "Abdul", "Bindu", "Chandran", "Devika", "Eldho", "Gayathri", "Hari"];
const LAST = ["Nair", "Pillai", "Kurian", "Menon", "Varghese", "Rahman", "Das", "Thomas", "Iyer", "Joseph"];

/** 60 synthetic residents who share their location, so a disaster zone has people to find in a demo. */
export function seedResidents(center: LatLng, now: Date): UserLocation[] {
  const rnd = mulberry32(424242);
  return Array.from({ length: 60 }, (_, i) => {
    const km = 0.1 + rnd() * 3.5, b = rnd() * 2 * Math.PI;
    const location = {
      lat: +(center.lat + (km / 111.32) * Math.cos(b)).toFixed(6),
      lng: +(center.lng + (km / (111.32 * Math.cos((center.lat * Math.PI) / 180))) * Math.sin(b)).toFixed(6),
    };
    const updatedAt = new Date(now.getTime() - Math.floor(rnd() * 20) * 60_000).toISOString();
    return {
      phone: `+9191100000${String(i + 1).padStart(2, "0")}`, name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
      helperId: null, location, accuracyM: Math.round(8 + rnd() * 40), source: "seed" as const, updatedAt,
      history: [{ ...location, at: updatedAt }],
    };
  });
}

async function main(): Promise<void> {
  const fs = await import("node:fs");
  const env: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.replace(/\s+#.*$/, "").match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env.local is fine */ }
  const lat = Number(env.SEED_CENTER_LAT), lng = Number(env.SEED_CENTER_LNG);
  const center = Number.isFinite(lat) && Number.isFinite(lng) && env.SEED_CENTER_LAT ? { lat, lng } : { lat: 8.913, lng: 76.635 };
  const base = process.env.RESQ_URL ?? "http://127.0.0.1:3000";
  const headers = { "content-type": "application/json", "x-ops-password": env.OPS_PASSWORD || "resq-ops" };
  let ok = 0;
  try {
    for (const h of seedHelpers(center, new Date())) {
      const r = await fetch(`${base}/api/helpers`, { method: "POST", headers, body: JSON.stringify(h) });
      if (r.ok) ok++; else console.error(`seed: ${h.id} → ${r.status} ${await r.text()}`);
    }
  } catch {
    console.log(`seed: server not reachable at ${base}; MemoryStore seeds itself at boot (SEED_ON_BOOT=1)`);
    return;
  }
  const warm = await fetch(`${base}/api/triage`).then((r) => r.json()).catch(() => null);
  console.log(`seed: ${ok}/30 helpers upserted around ${center.lat},${center.lng}; ollama warm-up: ${JSON.stringify(warm)}`);
}

if (/scripts[\\/]seed\.[tj]s$/.test(process.argv[1] ?? "")) void main();

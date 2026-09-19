/**
 * GET /api/config → { seedCenter, waveWindowMs, smsSimulated, ollamaModel }
 * (CONTRACTS §6; README §10 rule 7 — the browser needs the seed centre and wave window).
 * Env is read at request time, by hand, so this route has no dependency on lib/dispatch.ts.
 */
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SEED_CENTER_DEFAULT = { lat: 8.913, lng: 76.635 };
const WAVE_WINDOW_DEFAULT_MS = 30_000;

function finiteOr(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(): Promise<Response> {
  const lat = finiteOr(process.env.SEED_CENTER_LAT, NaN);
  const lng = finiteOr(process.env.SEED_CENTER_LNG, NaN);
  const seedCenter =
    Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : { ...SEED_CENTER_DEFAULT };

  const waveRaw = finiteOr(process.env.RESQ_WAVE_WINDOW_MS, WAVE_WINDOW_DEFAULT_MS);
  const waveWindowMs = waveRaw > 0 ? waveRaw : WAVE_WINDOW_DEFAULT_MS;

  const smsSimulated = !(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM
  );

  const modelRaw = process.env.OLLAMA_MODEL;
  const ollamaModel = modelRaw && modelRaw.trim() ? modelRaw.trim() : "qwen2.5:3b";

  return NextResponse.json({ seedCenter, waveWindowMs, smsSimulated, ollamaModel }, { status: 200 });
}

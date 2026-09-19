import { randomInt } from "node:crypto";
import { getStore } from "@/lib/store";
import { normalizePhone, sendSms, tplOtp } from "@/lib/sms";
import { json, jsonError, readJson, safe } from "@/lib/validate";

export const dynamic = "force-dynamic";
const g = globalThis as unknown as { __resq_otp_rate?: Map<string, number> };

export const POST = safe(async (req: Request) => {
  const body = await readJson(req);
  if (!body.ok) return jsonError(400, "bad_json");
  const phone = normalizePhone(body.value.phone);
  if (!phone) return jsonError(400, "phone_invalid");
  const rate = (g.__resq_otp_rate ??= new Map());
  const last = rate.get(phone) ?? 0;
  if (Date.now() - last < 30_000) return jsonError(429, "too_many_requests", { retryAfterSec: Math.ceil((30_000 - (Date.now() - last)) / 1000) });
  rate.set(phone, Date.now());
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await getStore().saveOtp({ phone, code, expiresAt: new Date(Date.now() + 300_000).toISOString(), attempts: 0 });
  console.log(`[otp] phone=${phone} code=${code}`);
  const r = await sendSms(phone, tplOtp(code));
  if (!r.ok) return jsonError(502, "sms_failed", { detail: r.error ?? "unknown" });
  return json({ ok: true, expiresInSec: 300, ...(r.simulated ? { devCode: code } : {}) });
});

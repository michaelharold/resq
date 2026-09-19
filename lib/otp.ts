/**
 * Sign-in codes are delivered to the phone, never shown on screen:
 *   1. TWILIO_VERIFY_SERVICE_SID set → Twilio Verify sends and checks the code (best delivery to Indian numbers).
 *   2. Otherwise → ResQ generates the code and texts it with Twilio Messaging (TWILIO_FROM).
 *   3. No Twilio at all → refused with "sms_not_configured", unless RESQ_SHOW_OTP_ON_SCREEN=1 (offline demo only).
 */
import { randomInt } from "node:crypto";
import { getStore } from "./store";
import { sendSms, smsConfigured, tplOtp } from "./sms";

export const OTP_TTL_SEC = 300;
const verifySid = () => process.env.TWILIO_VERIFY_SERVICE_SID?.trim() || null;
const twilioCreds = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
export const showOtpOnScreen = () => process.env.RESQ_SHOW_OTP_ON_SCREEN === "1";
export type OtpChannel = "verify" | "sms" | "screen";

async function twilioClient() {
  const twilio = (await import("twilio")).default;
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
}
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function sendCode(phone: string): Promise<
  { ok: true; channel: OtpChannel; devCode?: string } | { ok: false; error: "sms_not_configured" | "sms_failed"; detail?: string }
> {
  const sid = verifySid();
  if (sid && twilioCreds()) {
    try {
      await (await twilioClient()).verify.v2.services(sid).verifications.create({ to: phone, channel: "sms" });
      return { ok: true, channel: "verify" };
    } catch (e) {
      console.error(`[otp] Twilio Verify send to ${phone} failed: ${errText(e)}`);
      return { ok: false, error: "sms_failed", detail: errText(e) };
    }
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  if (smsConfigured()) {
    await getStore().saveOtp({ phone, code, expiresAt: new Date(Date.now() + OTP_TTL_SEC * 1000).toISOString(), attempts: 0 });
    const r = await sendSms(phone, tplOtp(code));
    return r.ok ? { ok: true, channel: "sms" } : { ok: false, error: "sms_failed", detail: r.error };
  }
  if (showOtpOnScreen()) {
    await getStore().saveOtp({ phone, code, expiresAt: new Date(Date.now() + OTP_TTL_SEC * 1000).toISOString(), attempts: 0 });
    console.log(`[otp] (on-screen demo mode) phone=${phone} code=${code}`);
    return { ok: true, channel: "screen", devCode: code };
  }
  return { ok: false, error: "sms_not_configured" };
}

export async function checkCode(phone: string, code: string): Promise<boolean> {
  const sid = verifySid();
  if (sid && twilioCreds()) {
    try {
      const r = await (await twilioClient()).verify.v2.services(sid).verificationChecks.create({ to: phone, code });
      return r.status === "approved";
    } catch (e) {
      console.error(`[otp] Twilio Verify check for ${phone} failed: ${errText(e)}`);
      return false;
    }
  }
  return getStore().verifyOtp(phone, code);
}

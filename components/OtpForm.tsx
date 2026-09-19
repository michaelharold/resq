"use client";
/* Phone + one-time code sign-in, shared by the helper page and the login sheet. Session is kept per window. */
import { useState } from "react";
import { api, setHelperToken } from "@/lib/client/api";
import type { Helper } from "@/lib/types";

export function OtpForm({ onDone, cta = "Verify & continue" }: { onDone: (helper: Helper | null) => void; cta?: string }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true); setMsg(null);
    const r = await api<{ devCode?: string }>("/api/auth/otp/send", { body: { phone } });
    setBusy(false);
    if (r.ok) { setSent(true); setDevCode(r.data.devCode ?? null); }
    else if (r.error === "sms_failed") { setSent(true); setMsg("SMS failed. Ask the organiser for your code."); }
    else setMsg(r.error === "phone_invalid" ? "Enter a valid mobile number." : r.error === "too_many_requests" ? `Wait ${String(r.data.retryAfterSec ?? 30)} s before asking again.` : `Could not send code (${r.error}).`);
  };
  const verify = async () => {
    setBusy(true); setMsg(null);
    const r = await api<{ token: string; helper: Helper | null }>("/api/auth/otp/verify", { body: { phone, code } });
    setBusy(false);
    if (r.ok) { setHelperToken(r.data.token); onDone(r.data.helper); }
    else setMsg(r.error === "invalid_code" ? "That code is wrong or expired." : `Could not verify (${r.error}).`);
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void (sent ? verify() : send()); }}>
      <label htmlFor="otp-phone" className="text-sm font-semibold text-resq-navy">Mobile number</label>
      <input id="otp-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={sent}
        placeholder="+91 98765 43210" className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-4 text-base outline-none focus:ring-2 focus:ring-resq-green/30 disabled:bg-slate-50" />
      {sent && (
        <>
          <label htmlFor="otp-code" className="mt-4 block text-sm font-semibold text-resq-navy">6-digit code</label>
          <input id="otp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} autoFocus
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="••••••" className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-4 font-mono text-xl tracking-[.5em] outline-none focus:ring-2 focus:ring-resq-green/30" />
          {devCode && <p className="mt-2 rounded-xl bg-resq-cyan-light p-2.5 text-xs text-resq-navy">Demo mode (no SMS configured): your code is <strong className="font-mono">{devCode}</strong></p>}
        </>
      )}
      {msg && <p role="alert" className="mt-3 text-sm font-medium text-resq-red">{msg}</p>}
      <p className="mt-3 text-xs leading-snug text-resq-slate">
        While signed in, ResQ shares your location every 30 s with verified authorities so they can find you if a disaster
        zone (landslide, flood…) is declared around you. You can pause it any time.
      </p>
      <button type="submit" disabled={busy || (!sent ? phone.trim().length < 10 : code.length !== 6)}
        className="mt-4 min-h-14 w-full rounded-2xl bg-success-gradient font-display text-lg font-bold text-white shadow-lg disabled:opacity-50">
        {busy ? "Please wait…" : sent ? cta : "Send code"}
      </button>
      {sent && <button type="button" onClick={() => { setSent(false); setCode(""); setDevCode(null); }} className="mt-2 min-h-12 w-full text-sm font-semibold text-resq-slate">Change number</button>}
    </form>
  );
}

/** Bottom sheet (phone) / centred dialog (desktop) asking the user to sign in before continuing. */
export function LoginSheet({ reason, onDone, onClose }: { reason: string; onDone: (helper: Helper | null) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-resq-navy-dark/60 backdrop-blur-sm md:items-center" role="dialog" aria-modal="true" aria-labelledby="login-title" onClick={onClose}>
      <div className="animate-slide-up w-full max-w-md rounded-t-3xl bg-white p-6 shadow-2xl md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-slate-200 md:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="login-title" className="font-display text-xl font-bold text-resq-navy">Sign in to continue</h2>
            <p className="mt-1 text-sm text-resq-slate">{reason}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-xl text-resq-slate hover:bg-slate-100">✕</button>
        </div>
        <p className="mb-4 mt-3 rounded-xl bg-resq-red-light p-3 text-xs text-resq-red-dark">In an emergency you never need to sign in: use <strong>Request help</strong> or call <strong>112</strong>.</p>
        <OtpForm onDone={onDone} />
      </div>
    </div>
  );
}

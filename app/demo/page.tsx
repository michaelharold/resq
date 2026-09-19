"use client";
/* Presenter's launcher: opens phone-sized windows, each with its own identity (requester / helpers / coordinator). */
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/ui";

const W = 400, H = 820;

function open(path: string, slot: number) {
  const left = 20 + slot * (W + 12);
  // noopener → a fresh window with its own sessionStorage (its own identity); ?new=1 clears any copied identity.
  window.open(`${path}${path.includes("?") ? "&" : "?"}new=1`, `_blank`, `popup,noopener,width=${W},height=${H},left=${left},top=40`);
}

export default function DemoPage() {
  const [slot, setSlot] = useState(0);
  const next = () => { const s = slot; setSlot((x) => (x + 1) % 4); return s; };
  const steps = [
    { n: 1, t: "Open 4 user windows + the coordinator", d: "Each window signs in with a different 10-digit number (e.g. 98765 00001, …02) and types the on-screen demo code. Keep /ops (coordinator / resq-ops) open on the side and switch the seeded helpers off so only your windows get pinged." },
    { n: 2, t: "Pick a badge at sign-up", d: "Fill basic details, including an emergency contact in window 1, then skills and equipment. Choose a trust badge: window 2 a Nurse as First Responder (red), window 3 a Plumber with a water pump as Certified Pro (blue, needs a licence number), window 4 a plain Neighbor (green). Badges are self-declared in the demo." },
    { n: 3, t: "Free emergency: skills + equipment matching", d: "Window 1 taps ASK FOR HELP: “My father collapsed and is not breathing”. It is FREE, the First Responder is ranked first in wave 1, and only windows whose skills or equipment match beep. “I'll help” shares details both ways and starts live tracking; a second person is told it is taken." },
    { n: 4, t: "Hands-free voice", d: "On Ask for help tap the pulsing microphone and just speak (Chrome / Edge / Safari). The words appear live, go straight to the on-device AI triage, and the request sends itself after a 3-second countdown you can cancel. No typing." },
    { n: 5, t: "Hazard banner", d: "Say or type “Basement flooded, need pump”. A pulsing amber/red banner appears at the top: DANGER: HIGH RISK OF ELECTROCUTION, shut off the main breaker. The AI only detects the hazard type; the wording is curated. The request also asks for a Water pump, so the pump owner is pinged." },
    { n: 6, t: "Paid plumbing job: only a Certified Pro can accept", d: "Window 1 files a Household job → Plumbing → ₹500 callout fee: “Kitchen tap is leaking, need a plumber”. The fee is HELD in escrow. The Neighbor and the Nurse never see it (or get “Certified Pro badge required”); the Certified Pro plumber accepts." },
    { n: 7, t: "Wallet payout", d: "The plumber taps Mark as done: escrow flips to RELEASED, ₹500 lands in their wallet, and the requester sees “Released to <name>”. Cancel a paid job instead and it says “Refunded to you”. File a “paid” job that mentions sparks or someone hurt and it is upgraded to a FREE emergency." },
    { n: 8, t: "3-minute fallback + emergency-contact SMS", d: "Switch every helper off duty and ask for help from window 1. “Auto-escalates in m:ss” counts down; at 3 minutes (or after 4 waves) an alarm sounds with one button: “No local helper responded · Tap to call 112 immediately”. In /ops → SMS log you can read the text sent to the emergency contact." },
    { n: 9, t: "Authorities", d: "In /ops watch dispatch live: FREE / Paid · ₹500 · HELD chips, a Tier column per dispatch, helpers by badge, escalations. Then declare a disaster zone and see everyone's latitude/longitude inside it." },
  ];
  return (
    <div className="min-h-dvh bg-navy-gradient px-5 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-resq-red"><Logo size={28} /></div>
          <div><h1 className="font-display text-3xl font-bold text-white">Demo launcher</h1><p className="text-sm text-white/60">Run the whole network on one laptop: every window is a different person. About 7 minutes.</p></div>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Coordinator", sub: "Login: coordinator / resq-ops", icon: <Icon.Activity size={22} />, cls: "bg-resq-cyan", path: "/ops", wide: true },
            { label: "User window", sub: "Open 3–4 of these", icon: <Icon.User size={22} />, cls: "bg-resq-green", path: "/" },
          ].map((b) => (
            <button key={b.label} onClick={() => (b.wide ? window.open("/ops", "_blank", "noopener") : open(b.path, next()))}
              className="rounded-2xl border border-white/15 bg-white/5 p-5 text-left transition-colors hover:bg-white/10">
              <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-xl text-white ${b.cls}`}>{b.icon}</div>
              <p className="font-display text-lg font-bold text-white">Open {b.label.toLowerCase()}</p>
              <p className="text-sm text-white/60">{b.sub}</p>
            </button>
          ))}
          <button onClick={() => { open("/", 0); open("/", 1); open("/", 2); open("/", 3); }}
            className="rounded-2xl border-2 border-resq-red bg-resq-red/20 p-5 text-left transition-colors hover:bg-resq-red/30">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-resq-red text-white"><Icon.Expand size={22} /></div>
            <p className="font-display text-lg font-bold text-white">Open 4 users</p>
            <p className="text-sm text-white/60">4 users side by side</p>
          </button>
        </div>
        <p className="mt-3 text-xs text-white/50">If nothing opens, allow pop-ups for this site. On phones, just open the helper and requester pages on different devices.</p>

        <ol className="mt-10 grid gap-3 md:grid-cols-2">
          {steps.map((s) => (
            <li key={s.n} className="flex gap-4 rounded-2xl bg-white p-5 card-shadow">
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-resq-navy font-display font-bold text-white">{s.n}</span>
              <div><p className="font-display font-bold text-resq-navy">{s.t}</p><p className="mt-1 text-sm text-resq-slate">{s.d}</p></div>
            </li>
          ))}
        </ol>

        <div className="mt-8 rounded-2xl border border-amber-300/40 bg-amber-50/10 p-5 text-sm text-amber-100">
          <p className="font-semibold text-amber-200">Why windows, not tabs?</p>
          <p className="mt-1">Each window keeps its own identity in session storage, so one browser can be a requester and several helpers at once. A duplicated tab copies that identity; open new ones from here instead.</p>
        </div>
        <Link href="/" className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/20 px-5 text-sm font-semibold text-white"><Icon.ChevronLeft size={16} />Back to ResQ</Link>
      </div>
    </div>
  );
}

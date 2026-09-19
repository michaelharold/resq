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
    { n: 1, t: "Coordinator: switch seeded helpers off", d: "In /ops, press “Seeded helpers off” so only your helper windows can receive pings. Keep it open to watch everything live." },
    { n: 2, t: "Open 2–3 helper windows", d: "In each: enter any 10-digit number (e.g. 98765 00001, …02), type the on-screen demo code, add skills (Swimmer + Boat owner for a flood demo) and switch On duty." },
    { n: 3, t: "Open a requester window", d: "Tap REQUEST HELP, say or type e.g. “Water is rising, my grandmother can't walk”, add a name/phone and send." },
    { n: 4, t: "Watch the dispatch", d: "Every helper window beeps and shows the request with a 30 s countdown. One Declines, another Accepts: the rest are stood down instantly." },
    { n: 5, t: "Live tracking", d: "The accepted helper travels toward the requester (simulated on a laptop, real GPS on phones). Both maps update every 3 s until “Arrived”." },
    { n: 6, t: "Finish", d: "Helper taps “Mark as done”; the requester rates them. Try “no one answers” too: 4 waves widen 1→2→4→8 km, then it escalates on /ops." },
  ];
  return (
    <div className="min-h-dvh bg-navy-gradient px-5 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-resq-red"><Logo size={28} /></div>
          <div><h1 className="font-display text-3xl font-bold text-white">Demo launcher</h1><p className="text-sm text-white/60">Run the whole network on one laptop: every window is a different person.</p></div>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Coordinator", sub: "Password: resq-ops", icon: <Icon.Activity size={22} />, cls: "bg-resq-cyan", path: "/ops", wide: true },
            { label: "Helper window", sub: "Open 2–3 of these", icon: <Icon.Shield size={22} />, cls: "bg-resq-green", path: "/helper" },
            { label: "Requester window", sub: "The person in trouble", icon: <Icon.AlertTriangle size={22} />, cls: "bg-resq-red", path: "/" },
          ].map((b) => (
            <button key={b.label} onClick={() => (b.wide ? window.open("/ops", "_blank", "noopener") : open(b.path, next()))}
              className="rounded-2xl border border-white/15 bg-white/5 p-5 text-left transition-colors hover:bg-white/10">
              <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-xl text-white ${b.cls}`}>{b.icon}</div>
              <p className="font-display text-lg font-bold text-white">Open {b.label.toLowerCase()}</p>
              <p className="text-sm text-white/60">{b.sub}</p>
            </button>
          ))}
          <button onClick={() => { open("/helper", 0); open("/helper", 1); open("/helper", 2); open("/", 3); }}
            className="rounded-2xl border-2 border-resq-red bg-resq-red/20 p-5 text-left transition-colors hover:bg-resq-red/30">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-resq-red text-white"><Icon.Expand size={22} /></div>
            <p className="font-display text-lg font-bold text-white">Open all 4</p>
            <p className="text-sm text-white/60">3 helpers + 1 requester, side by side</p>
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

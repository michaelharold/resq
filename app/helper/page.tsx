"use client";
/* Helper app: phone + OTP → skills profile → on duty (shares location) → incoming pings → active job. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, BottomNav, Call112Bar, Container, NavBar, PhoneShell, ProgressBar, PulsingDot, TopNav, initials } from "@/components/ui";
import { SKILL_META, SkillPill, URGENCY_STYLE } from "@/components/skills";
import { DEMO_RADIUS_KM, api, demoSpot, distanceKm, fmtDistance, getHelperToken, getPosition, setHelperToken, stepToward, windowStore, type LatLng } from "@/lib/client/api";
import { LiveMap, type MapMarker } from "@/components/LiveMap";
import { useSecondsLeft, useSnapshot } from "@/lib/client/sse";
import { SKILLS, TYPE_LABELS } from "@/lib/taxonomy";
import type { Helper, HelperView, IncomingCard, Skill } from "@/lib/types";

type Me = HelperView & { phone: string };

export default function HelperApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<"loading" | "login" | "ready">("loading");

  const load = useCallback(async () => {
    const r = await api<Me>("/api/helpers/me");
    if (r.ok) { setMe(r.data); setState("ready"); } else setState("login");
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <PhoneShell>
      {state === "loading" && <div className="flex flex-1 items-center justify-center text-resq-slate">Loading…</div>}
      {state === "login" && <Login onDone={load} />}
      {state === "ready" && me && !me.helper && <Profile phone={me.phone} onSaved={load} />}
      {state === "ready" && me?.helper && <Dashboard initial={me} onLogout={() => { setMe(null); setState("login"); }} onReload={load} />}
    </PhoneShell>
  );
}

// ─── Login ─────────────────────────────────────────────────────────────────────────────────────────────────

function Login({ onDone }: { onDone: () => void }) {
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
    const r = await api<{ token: string }>("/api/auth/otp/verify", { body: { phone, code } });
    setBusy(false);
    if (r.ok) { setHelperToken(r.data.token); onDone(); } else setMsg(r.error === "invalid_code" ? "That code is wrong or expired." : `Could not verify (${r.error}).`);
  };

  return (
    <>
      <div className="bg-navy-gradient px-6 pb-10 pt-10 text-center md:pb-16">
        <Container className="mb-4 hidden justify-end md:flex"><TopNav active="helper" /></Container>
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-resq-green shadow-2xl" style={{ boxShadow: "0 0 50px rgba(22,163,74,.35)" }}>
          <Icon.Shield size={40} className="text-white" />
        </div>
        <h1 className="font-display text-3xl font-bold text-white">Become a ResQ helper</h1>
        <p className="mt-2 text-sm text-white/70">Your skills can save a neighbour. Sign in with your phone to go on duty.</p>
        <ol className="mx-auto mt-5 flex max-w-md justify-center gap-2 text-xs text-white/70">
          {["Verify phone", "Add skills", "Go on duty"].map((t, i) => (
            <li key={t} className="flex items-center gap-1.5"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/15 font-bold text-white">{i + 1}</span>{t}</li>
          ))}
        </ol>
      </div>
      <main className="relative z-10 mx-auto -mt-5 w-full max-w-md flex-1 px-5 md:-mt-10">
        <div className="card-shadow-lg rounded-2xl border border-slate-100 bg-white p-5">
          <label htmlFor="phone" className="text-sm font-semibold text-resq-navy">Mobile number</label>
          <input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} disabled={sent}
            placeholder="+91 98765 43210" className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-4 text-base outline-none focus:ring-2 focus:ring-resq-green/30 disabled:bg-slate-50" />
          {sent && (
            <>
              <label htmlFor="code" className="mt-4 block text-sm font-semibold text-resq-navy">6-digit code</label>
              <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="••••••" className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-4 font-mono text-xl tracking-[.5em] outline-none focus:ring-2 focus:ring-resq-green/30" />
              {devCode && <p className="mt-2 rounded-xl bg-resq-cyan-light p-2.5 text-xs text-resq-navy">Demo mode (no SMS configured): your code is <strong className="font-mono">{devCode}</strong></p>}
            </>
          )}
          {msg && <p role="alert" className="mt-3 text-sm font-medium text-resq-red">{msg}</p>}
          <button onClick={sent ? verify : send} disabled={busy || (!sent ? phone.trim().length < 10 : code.length !== 6)}
            className="mt-4 min-h-14 w-full rounded-2xl bg-success-gradient font-display text-lg font-bold text-white shadow-lg disabled:opacity-50">
            {busy ? "Please wait…" : sent ? "Verify & continue" : "Send code"}
          </button>
          {sent && <button onClick={() => { setSent(false); setCode(""); setDevCode(null); }} className="mt-2 min-h-12 w-full text-sm font-semibold text-resq-slate">Change number</button>}
        </div>
      </main>
      <Call112Bar />
      <BottomNav active="helper" />
    </>
  );
}

// ─── Profile ───────────────────────────────────────────────────────────────────────────────────────────────

function Profile({ phone, helper, onSaved, onCancel }: { phone: string; helper?: Helper; onSaved: () => void; onCancel?: () => void }) {
  const [name, setName] = useState(helper?.name ?? "");
  const [skills, setSkills] = useState<Skill[]>(helper?.skills ?? []);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (s: Skill) => setSkills((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await api<{ token?: string }>("/api/helpers", { body: { name, phone, skills } });
    setBusy(false);
    if (r.ok) { if (r.data.token) setHelperToken(r.data.token); onSaved(); } else setMsg(`Could not save (${r.error}).`);
  };
  return (
    <>
      <div className="bg-success-gradient">
        <Container><NavBar title={helper ? "Edit skills" : "Your skills"} onBack={onCancel} light /></Container>
        <p className="mx-auto max-w-4xl px-5 pb-5 text-sm text-white/85">Tell neighbours what you can do. We only ping you for emergencies that match.</p>
      </div>
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-4">
        <label htmlFor="name" className="text-sm font-semibold text-resq-navy">Your name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name"
          className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base outline-none focus:ring-2 focus:ring-resq-green/30 md:max-w-md" />
        <p className="mb-2 mt-5 text-sm font-semibold text-resq-navy">Skills & resources <span className="font-normal text-resq-slate">({skills.length} selected)</span></p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
          {SKILLS.map((s) => {
            const m = SKILL_META[s];
            const on = skills.includes(s);
            return (
              <button key={s} onClick={() => toggle(s)} aria-pressed={on}
                className={`flex min-h-14 items-center gap-2.5 rounded-2xl border-2 bg-white p-3 text-left transition-all ${on ? "shadow-md" : "border-slate-100"}`}
                style={on ? { borderColor: m.color } : undefined}>
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: m.bg, color: m.color }}>{m.icon}</div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-tight text-resq-navy">{m.label}</p>
                  <p className="truncate text-[11px] text-resq-slate">{m.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-resq-slate">Skills are self-declared. Ratings from the people you help build your reliability score.</p>
        {msg && <p role="alert" className="mt-3 text-sm font-medium text-resq-red">{msg}</p>}
        <button onClick={save} disabled={busy || !name.trim() || skills.length === 0}
          className="mt-4 min-h-14 w-full rounded-2xl bg-success-gradient font-display text-lg font-bold text-white shadow-lg disabled:opacity-50 md:max-w-xs">
          {busy ? "Saving…" : "Save"}
        </button>
      </main>
      <Call112Bar />
    </>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────────────────────────────────

function Dashboard({ initial, onLogout, onReload }: { initial: Me; onLogout: () => void; onReload: () => void }) {
  const id = initial.helper!.id;
  const token = getHelperToken() ?? "none";
  const { data, connected, setData } = useSnapshot<Me>(`/api/helpers/${id}/stream?s=${encodeURIComponent(token)}`, "/api/helpers/me", { "x-resq-session": token });
  const me = data ?? initial;
  const helper = me.helper ?? initial.helper!;
  const [editing, setEditing] = useState(false);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const prevCount = useRef(0);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [mode, setMode] = useState<"gps" | "demo">(() => (windowStore.get("resq_loc_mode") as "gps" | "demo") ?? "gps");
  const pos = useRef<LatLng | null>(helper.location);
  pos.current = helper.location ?? pos.current;
  useEffect(() => { void api<{ seedCenter: LatLng }>("/api/config").then((r) => r.ok && setCenter(r.data.seedCenter)); }, []);

  // New ping: vibrate, beep, and flag the tab title.
  useEffect(() => {
    if (me.pinged.length > prevCount.current) {
      try { navigator.vibrate?.([250, 100, 250]); } catch { /* unsupported */ }
      beep();
    }
    prevCount.current = me.pinged.length;
    document.title = me.pinged.length ? `(${me.pinged.length}) Emergency nearby · ResQ` : "ResQ Helper";
  }, [me.pinged.length]);

  /** Where this helper is now: GPS (if at the venue) or this window's demo spot. */
  const locate = useCallback(async (m = mode): Promise<LatLng | null> => {
    if (!center) return null;
    if (m === "gps") {
      const p = await getPosition();
      if (p && distanceKm(p, center) <= DEMO_RADIUS_KM) { setLocMsg(null); return p; }
      setLocMsg(p ? "Your GPS is far from the demo area, so a demo spot is used." : "GPS unavailable, so a demo spot is used.");
      setMode("demo"); windowStore.set("resq_loc_mode", "demo");
    }
    return demoSpot(center);
  }, [center, mode]);
  const pushLocation = useCallback(async (p: LatLng) => {
    pos.current = p;
    await api("/api/helpers", { method: "PATCH", body: { location: p } });
  }, []);

  // On duty with no job: refresh location every 60 s.
  useEffect(() => {
    if (!helper.onDuty || me.active || !center) return;
    const t = setInterval(async () => { const p = await locate(); if (p) await pushLocation(p); }, 60_000);
    return () => clearInterval(t);
  }, [helper.onDuty, me.active, center, locate, pushLocation]);

  // On a job: stream location every 3 s so the requester sees you coming. Demo mode simulates the trip.
  const activeId = me.active?.request.id ?? null;
  const tLat = me.active?.request.location?.lat ?? null, tLng = me.active?.request.location?.lng ?? null;
  useEffect(() => {
    if (!activeId || tLat === null || tLng === null) return;
    const target = { lat: tLat, lng: tLng };
    const t = setInterval(async () => {
      if (mode === "gps") { const p = await getPosition(3000); if (p) await pushLocation(p); return; }
      const cur = pos.current;
      if (cur && distanceKm(cur, target) > 0.005) await pushLocation(stepToward(cur, target, 0.06));
    }, 3000);
    return () => clearInterval(t);
  }, [activeId, tLat, tLng, mode, pushLocation]);

  const toggleDuty = async () => {
    const onDuty = !helper.onDuty;
    const p = onDuty ? await locate() : null;
    const r = await api<{ helper: Helper }>("/api/helpers", { method: "PATCH", body: { onDuty, ...(p ? { location: p } : {}) } });
    if (r.ok) setData({ ...me, helper: r.data.helper });
  };
  const changeLoc = async (m: "gps" | "demo", reroll = false) => {
    setMode(m); windowStore.set("resq_loc_mode", m);
    const p = m === "demo" && center ? demoSpot(center, reroll) : await locate(m);
    if (p) await pushLocation(p);
  };
  const respond = async (card: IncomingCard, action: "accept" | "reject") => {
    const r = await api<{ ok: boolean; reason?: string }>(`/api/dispatches/${card.dispatch.id}/respond`, { body: { action } });
    if (!r.ok && action === "accept") setTaken(r.data.reason === "already_matched" ? "Another helper accepted first. Thank you!" : "That request has expired.");
    void onReloadSnapshot();
  };
  const onReloadSnapshot = async () => { const r = await api<Me>("/api/helpers/me"); if (r.ok) setData(r.data); };
  const done = async () => {
    if (!me.active) return;
    await api(`/api/requests/${me.active.request.id}`, { method: "PATCH", body: { action: "resolve" } });
    void onReloadSnapshot();
  };
  const logout = async () => { await api("/api/auth/logout", { method: "POST", body: {} }); setHelperToken(null); document.title = "ResQ"; onLogout(); };

  if (editing) return <Profile phone={me.phone} helper={helper} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); onReload(); }} />;

  return (
    <>
      <div className="bg-navy-gradient">
        <Container className="px-5 pb-6 pt-5 md:px-8">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-resq-cyan to-resq-navy font-bold text-white">{initials(helper.name)}</div>
              <div>
                <p className="text-sm text-white/60">Helper</p>
                <h1 className="font-display text-xl font-bold text-white">{helper.name}</h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <TopNav active="helper" />
              <span className="flex items-center gap-1.5 rounded-xl bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white">
                <PulsingDot color={connected ? "green" : "red"} />{connected ? "Live" : "Offline"}
              </span>
            </div>
          </div>
          <button onClick={toggleDuty} aria-pressed={helper.onDuty}
            className={`mt-5 flex min-h-16 w-full items-center justify-between rounded-2xl px-5 text-left transition-all md:max-w-md ${helper.onDuty ? "bg-resq-green" : "bg-white/10"}`}>
            <div>
              <p className="font-display text-lg font-bold text-white">{helper.onDuty ? "On duty" : "Off duty"}</p>
              <p className="text-xs text-white/75">{helper.onDuty ? "Sharing your location · you will get pings" : "Tap to start receiving emergency pings"}</p>
            </div>
            <div className={`flex h-8 w-14 items-center rounded-full p-1 transition-all ${helper.onDuty ? "justify-end bg-white/30" : "justify-start bg-white/20"}`}>
              <div className="h-6 w-6 rounded-full bg-white shadow" />
            </div>
          </button>
          {locMsg && <p className="mt-2 text-xs text-amber-300">{locMsg}</p>}
        </Container>
      </div>

      <main className="mx-auto grid w-full max-w-6xl flex-1 content-start gap-4 px-4 py-4 md:px-8 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <div className="flex flex-col gap-4">
        {taken && (
          <div className="flex items-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white animate-fade-in">
            <Icon.AlertTriangle size={16} />{taken}
            <button onClick={() => setTaken(null)} aria-label="Dismiss" className="ml-auto flex h-10 w-10 items-center justify-center"><Icon.X size={16} /></button>
          </div>
        )}
        {me.active && <ActiveJob active={me.active} me={helper.location} simulated={mode === "demo"} onDone={done} />}
        {me.pinged.map((c) => <Incoming key={c.dispatch.id} card={c} onRespond={respond} />)}
        {!me.active && me.pinged.length === 0 && (
          <div className="card-shadow rounded-2xl border border-slate-100 bg-white p-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100"><Icon.Bell size={26} className="text-resq-slate" /></div>
            <p className="font-display font-semibold text-resq-navy">{helper.onDuty ? "Waiting for emergencies near you" : "You are off duty"}</p>
            <p className="mt-1 text-sm text-resq-slate">{helper.onDuty ? "Keep this page open. You will also get an SMS when pinged." : "Go on duty to help neighbours nearby."}</p>
          </div>
        )}
        </div>
        <div className="flex flex-col gap-4">

        <section className="card-shadow rounded-2xl border border-slate-100 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display font-semibold text-resq-navy">My skills</h2>
            <button onClick={() => setEditing(true)} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-resq-cyan">Edit</button>
          </div>
          <div className="flex flex-wrap gap-1.5">{helper.skills.map((s) => <SkillPill key={s} skill={s} />)}</div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="font-display text-base font-bold text-resq-navy">{(helper.reliability * 5).toFixed(1)}★</p><p className="text-xs text-resq-slate">Reliability</p></div>
            <div className="rounded-xl bg-slate-50 p-3 text-center"><p className="font-display text-base font-bold text-resq-navy">{me.phone}</p><p className="text-xs text-resq-slate">Phone</p></div>
          </div>
        </section>
        <section className="card-shadow rounded-2xl border border-slate-100 bg-white p-4">
          <h2 className="mb-1 flex items-center gap-2 font-display font-semibold text-resq-navy"><Icon.MapPin size={16} />My location</h2>
          <p className="text-sm text-resq-slate">
            {helper.location && center ? `${mode === "gps" ? "GPS" : "Demo spot"} · ${fmtDistance(distanceKm(helper.location, center))} from TKMCE` : "Not shared yet. Go on duty to share it."}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button onClick={() => changeLoc("gps")} aria-pressed={mode === "gps"} className={`min-h-11 rounded-xl border-2 text-sm font-semibold ${mode === "gps" ? "border-resq-navy bg-resq-navy text-white" : "border-slate-200 text-resq-navy"}`}>Use GPS</button>
            <button onClick={() => changeLoc("demo", mode === "demo")} className={`min-h-11 rounded-xl border-2 text-sm font-semibold ${mode === "demo" ? "border-resq-navy bg-resq-navy text-white" : "border-slate-200 text-resq-navy"}`}>{mode === "demo" ? "New demo spot" : "Demo spot"}</button>
          </div>
          <p className="mt-2 text-xs text-resq-slate">Demo spots are 200–900 m from TKMCE, different in every window, and travel towards the emergency once you accept.</p>
        </section>
        <button onClick={logout} className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-resq-slate">Sign out</button>
        </div>
      </main>
      <Call112Bar />
      <BottomNav active="helper" />
    </>
  );
}

function Incoming({ card, onRespond }: { card: IncomingCard; onRespond: (c: IncomingCard, a: "accept" | "reject") => void }) {
  const left = useSecondsLeft(card.expiresAt);
  const total = Math.max(1, Math.round((Date.parse(card.expiresAt) - Date.parse(card.dispatch.pingedAt)) / 1000));
  const [busy, setBusy] = useState(false);
  const t = card.request.triage;
  if (left === 0) return null; // expired: the server moves on at the next tick
  const act = async (a: "accept" | "reject") => { setBusy(true); await onRespond(card, a); setBusy(false); };
  return (
    <section className="card-shadow-lg animate-slide-up overflow-hidden rounded-2xl border-2 border-resq-red bg-white">
      <div className="bg-emergency-gradient px-5 py-4 text-center">
        <div className="mb-1 flex items-center justify-center gap-2"><PulsingDot color="red" /><span className="text-xs font-semibold uppercase tracking-wider text-white/85">Dispatch request</span></div>
        <h2 className="font-display text-2xl font-bold text-white">{t ? TYPE_LABELS[t.type] : "Emergency"}</h2>
        <p className="mt-1 text-xs text-white/70">You are 1 of 3 helpers pinged at once. First to accept wins.</p>
      </div>
      <div className="space-y-3 p-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between"><span className="text-sm font-semibold text-resq-navy">Response window</span><span className="font-mono text-2xl font-bold" style={{ color: left / total > 0.5 ? "#16A34A" : left / total > 0.2 ? "#D97706" : "#DC2626" }}>{left}s</span></div>
          <ProgressBar seconds={left} total={total} />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3"><Icon.MapPin size={14} className="text-resq-red" /><div><p className="text-xs text-resq-slate">Distance</p><p className="text-sm font-bold text-resq-navy">{fmtDistance(card.dispatch.distanceKm)}</p></div></div>
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3"><Icon.AlertTriangle size={14} className="text-resq-red" /><div><p className="text-xs text-resq-slate">Priority</p>{t && <span className={`rounded px-1.5 text-xs font-bold uppercase ${URGENCY_STYLE[t.urgency]}`}>{t.urgency}</span>}</div></div>
        </div>
        <p className="rounded-xl bg-resq-red-light p-3 text-sm leading-relaxed text-resq-red-dark">“{card.request.description}”</p>
        {t && <div className="flex flex-wrap gap-1.5">{t.skills.map((s) => <SkillPill key={s} skill={s} />)}</div>}
        <p className="text-xs text-resq-slate">The exact location is shared only after you accept.</p>
        <div className="grid grid-cols-2 gap-3">
          <button disabled={busy} onClick={() => act("accept")} className="flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl bg-success-gradient font-display text-xl font-bold text-white shadow-xl disabled:opacity-60"><Icon.Check size={26} />ACCEPT</button>
          <button disabled={busy} onClick={() => act("reject")} className="card-shadow flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border-2 border-slate-200 bg-white font-display text-xl font-bold text-resq-slate disabled:opacity-60"><Icon.X size={26} />DECLINE</button>
        </div>
      </div>
    </section>
  );
}

function ActiveJob({ active, me, simulated, onDone }: { active: NonNullable<HelperView["active"]>; me: LatLng | null; simulated: boolean; onDone: () => void }) {
  const r = active.request;
  const t = r.triage;
  const dist = me && r.location ? distanceKm(me, r.location) : null;
  const arrived = dist !== null && dist < 0.05;
  const markers: MapMarker[] = [];
  if (r.location) markers.push({ id: "req", at: r.location, color: "#DC2626", kind: "target", label: "Help" });
  if (me) markers.push({ id: "me", at: me, color: "#16A34A", kind: "you", label: "You", pulse: false });
  return (
    <section className="card-shadow-lg animate-slide-up overflow-hidden rounded-2xl border-2 border-resq-green bg-white">
      <div className="bg-success-gradient px-5 py-4">
        <Badge variant="success">Active job</Badge>
        <h2 className="mt-2 font-display text-xl font-bold text-white">{t ? TYPE_LABELS[t.type] : "Emergency"}</h2>
        <p className="text-sm text-white/80">{r.landmark ? `Near ${r.landmark}` : r.location ? "GPS location shared" : "No location: call the requester"}</p>
      </div>
      <div className="space-y-3 p-4">
        <p className="rounded-xl bg-slate-50 p-3 text-sm text-resq-navy">“{r.description}”</p>
        {r.location && (
          <div className="relative overflow-hidden rounded-2xl">
            <LiveMap center={r.location} radiusKm={Math.max(0.3, (dist ?? 0.5) * 1.3)} markers={markers} height={190} route={me ? [me, r.location] : undefined} />
            <div className="absolute left-3 top-3 rounded-xl bg-white px-3 py-1.5 text-xs font-bold text-resq-navy shadow">
              {arrived ? "You have arrived" : `${fmtDistance(dist)} to go${simulated ? " · simulated travel" : " · live GPS"}`}
            </div>
          </div>
        )}
        {(r.requesterName || r.requesterPhone) && <p className="text-sm text-resq-navy"><strong>Requester:</strong> {r.requesterName ?? "Unnamed"}{r.requesterPhone ? ` · ${r.requesterPhone}` : ""}</p>}
        {active.mapsUrl && (
          <a href={active.mapsUrl} target="_blank" rel="noopener noreferrer" className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-resq-navy font-semibold text-white shadow-lg">
            <Icon.Navigation size={18} />Navigate in Maps
          </a>
        )}
        {r.requesterPhone ? (
          <a href={`tel:${r.requesterPhone}`} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-200 font-semibold text-resq-navy"><Icon.Phone size={16} />Call {r.requesterPhone}</a>
        ) : <p className="text-center text-xs text-resq-slate">Contact: via app. The requester sees your name and phone.</p>}
        <button onClick={onDone} className="min-h-14 w-full rounded-2xl bg-success-gradient font-display text-lg font-bold text-white">Mark as done</button>
      </div>
    </section>
  );
}

/** Short two-tone alert via Web Audio (no audio files). Browsers allow it after the user has clicked on the page. */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [880, 660, 880].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
      o.start(t0); o.stop(t0 + 0.17);
    });
    setTimeout(() => void ctx.close(), 1000);
  } catch { /* no audio */ }
}

"use client";
/*
 * ResQ app (everyone uses the same app):
 *   sign in (phone + code) → onboarding (basic details, skills, equipment) → dashboard
 *   dashboard: "Ask for help" (minimal form, the rest comes from the profile) + your request + the job you accepted
 *              + nearby requests that need your skills or equipment (tap → full details → I'll help / Not now)
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Call112Bar, Container, Logo, NavBar, PhoneShell, PulsingDot, initials } from "@/components/ui";
import { EMERGENCY_TILES, SKILL_META, SkillPill, URGENCY_STYLE } from "@/components/skills";
import { EQUIPMENT_META, EquipmentPill, PERSON_SKILLS, RESOURCE_SKILLS } from "@/components/equipment";
import { OtpForm } from "@/components/OtpForm";
import { BeaconChip } from "@/components/BeaconChip";
import { ActiveJob, PersonDetails, beep } from "@/components/ActiveJob";
import { RequestScreen, Triaging } from "@/components/RequestView";
import { LiveMap, type MapMarker } from "@/components/LiveMap";
import { DEMO_RADIUS_KM, api, demoSpot, distanceKm, fmtDistance, fmtTime, getHelperToken, getPosition, setHelperToken, stepToward, type LatLng } from "@/lib/client/api";
import { useLocationBeacon } from "@/lib/client/beacon";
import { useSecondsLeft, useSnapshot } from "@/lib/client/sse";
import { useSpeech } from "@/lib/client/speech";
import { BLOOD_GROUPS, EQUIPMENT, EQUIPMENT_LABELS, TYPE_LABELS } from "@/lib/taxonomy";
import type { Dashboard, FeedItem } from "@/lib/feed";
import type { Equipment, Helper, RequestView, RequesterRole, Skill, UserProfile } from "@/lib/types";

type Config = { seedCenter: LatLng; waveWindowMs: number; smsNumber: string | null };
type Screen = "loading" | "auth" | "onboarding" | "dashboard" | "profile" | "ask" | "request";

/** Where this person is: GPS if it is plausibly at the venue, else this window's demo spot near TKMCE. */
async function whereAmI(center: LatLng): Promise<{ at: LatLng; source: "gps" | "demo" }> {
  const p = await getPosition(6000);
  return p && distanceKm(p, center) <= DEMO_RADIUS_KM ? { at: p, source: "gps" } : { at: demoSpot(center), source: "demo" };
}

export default function ResQApp() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [config, setConfig] = useState<Config | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!getHelperToken()) { setScreen("auth"); return; }
    const r = await api<Dashboard>("/api/dashboard");
    if (!r.ok) { setHelperToken(null); setScreen("auth"); return; }
    setDash(r.data);
    setScreen((s) => (r.data.me ? (s === "loading" || s === "auth" || s === "onboarding" ? "dashboard" : s) : "onboarding"));
  }, []);

  useEffect(() => {
    void api<Config>("/api/config").then((r) => r.ok && setConfig(r.data));
    void fetch("/api/triage").catch(() => undefined); // warm the AI model
    void refresh();
  }, [refresh]);

  const openRequest = (id: string) => { setRequestId(id); setScreen("request"); };

  return (
    <PhoneShell>
      {screen === "loading" && <div className="flex flex-1 items-center justify-center text-resq-slate">Loading…</div>}
      {screen === "auth" && <AuthScreen onDone={refresh} />}
      {(screen === "onboarding" || screen === "profile") && dash && config && (
        <Onboarding phone={dash.phone} me={dash.me} center={config.seedCenter} editing={screen === "profile"}
          onCancel={() => setScreen("dashboard")} onDone={async () => { await refresh(); setScreen("dashboard"); }} />
      )}
      {screen === "dashboard" && dash?.me && config && (
        <DashboardScreen initial={dash} config={config} onAsk={() => setScreen("ask")} onOpenRequest={openRequest}
          onProfile={() => setScreen("profile")} onSignOut={() => { setHelperToken(null); setDash(null); setScreen("auth"); }} />
      )}
      {screen === "ask" && dash?.me && config && <AskForm me={dash.me} center={config.seedCenter} onBack={() => setScreen("dashboard")} onCreated={openRequest} />}
      {screen === "request" && requestId && (
        <RequestScreen id={requestId} config={config} onClose={() => { setScreen("dashboard"); void refresh(); }} onRetry={openRequest} />
      )}
    </PhoneShell>
  );
}

// ─── Sign in ───────────────────────────────────────────────────────────────────────────────────────────────

function AuthScreen({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col bg-navy-gradient">
      <Container className="flex flex-1 flex-col items-center justify-center gap-6 px-5 py-10">
        <div className="animate-slide-up flex flex-col items-center gap-3 text-center">
          <div className="relative">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-resq-red" style={{ boxShadow: "0 0 60px rgba(220,38,38,.4)" }}><Logo size={42} /></div>
            <div className="animate-spin-slow absolute -inset-3 border border-white/10" style={{ borderRadius: "40%" }} />
          </div>
          <h1 className="font-display text-4xl font-bold text-white">ResQ</h1>
          <p className="max-w-sm text-white/70">Your neighbours&apos; skills and equipment, one tap away in an emergency.</p>
        </div>
        <div className="card-shadow-lg w-full max-w-md rounded-3xl bg-white p-6">
          <h2 className="font-display text-xl font-bold text-resq-navy">Sign in or create your account</h2>
          <p className="mb-4 mt-1 text-sm text-resq-slate">We&apos;ll text you a 6-digit code. New here? You&apos;ll add your details next.</p>
          <OtpForm onDone={() => onDone()} cta="Continue" />
        </div>
        <a href="tel:112" className="flex min-h-14 w-full max-w-md items-center justify-center gap-2 rounded-2xl bg-resq-red font-display text-lg font-bold text-white shadow-lg">
          <Icon.Phone size={20} />Emergency right now? Call 112
        </a>
        <div className="flex gap-4 text-xs text-white/50">
          <Link href="/ops" className="underline">Authority login</Link>
          <Link href="/demo" className="underline">Demo launcher</Link>
        </div>
      </Container>
    </div>
  );
}

// ─── Onboarding / profile ──────────────────────────────────────────────────────────────────────────────────

function Onboarding({ phone, me, center, editing, onDone, onCancel }: {
  phone: string; me: Helper | null; center: LatLng; editing: boolean; onDone: () => void; onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const p = me?.profile;
  const [name, setName] = useState(me?.name ?? "");
  const [profile, setProfile] = useState<Record<keyof UserProfile, string>>({
    age: p?.age ? String(p.age) : "", bloodGroup: p?.bloodGroup ?? "", address: p?.address ?? "", medicalNotes: p?.medicalNotes ?? "",
    emergencyContactName: p?.emergencyContactName ?? "", emergencyContactPhone: p?.emergencyContactPhone ?? "",
  });
  const [skills, setSkills] = useState<Skill[]>(me?.skills ?? []);
  const [equipment, setEquipment] = useState<Equipment[]>(me?.equipment ?? []);
  const [available, setAvailable] = useState(me ? me.onDuty : true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof UserProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setProfile({ ...profile, [k]: e.target.value });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async () => {
    setBusy(true); setMsg(null);
    const r = await api<{ token?: string; helper: Helper }>("/api/helpers", {
      body: { name, phone, skills, equipment, profile: { ...profile, age: profile.age ? Number(profile.age) : null } },
    });
    if (!r.ok) { setBusy(false); setMsg(`Please check your details (${r.error.replace(/_/g, " ")}).`); setStep(0); return; }
    if (r.data.token) setHelperToken(r.data.token);
    const loc = await whereAmI(center);
    await api("/api/helpers", { method: "PATCH", body: { onDuty: available, location: loc.at } });
    setBusy(false);
    onDone();
  };

  const steps = ["Your details", "Skills & equipment", "Ready"];
  const input = "mt-1 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-normal outline-none focus:ring-2 focus:ring-resq-red/30";
  const tileCls = (on: boolean) => `flex min-h-14 items-center gap-2.5 rounded-2xl border-2 bg-white p-3 text-left ${on ? "shadow-md" : "border-slate-100"}`;
  return (
    <>
      <div className="bg-navy-gradient">
        <Container><NavBar title={editing ? "Edit profile" : "Create your profile"} onBack={editing ? onCancel : step > 0 ? () => setStep(step - 1) : undefined} light /></Container>
        <ol className="mx-auto flex max-w-3xl gap-2 px-5 pb-5">
          {steps.map((t, i) => (
            <li key={t} className="flex-1">
              <div className={`h-1.5 rounded-full ${i <= step ? "bg-resq-red" : "bg-white/15"}`} />
              <p className={`mt-1.5 text-xs ${i === step ? "font-semibold text-white" : "text-white/50"}`}>{i + 1}. {t}</p>
            </li>
          ))}
        </ol>
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-5">
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <p className="text-sm text-resq-slate sm:col-span-2">These details are shared <strong>only</strong> with the person on the other side of an accepted request, so help arrives informed. Signed in as <strong>{phone}</strong>.</p>
            <label className="text-sm font-semibold text-resq-navy sm:col-span-2">Full name *<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" className={input} /></label>
            <label className="text-sm font-semibold text-resq-navy">Age<input type="number" inputMode="numeric" min={1} max={120} value={profile.age} onChange={set("age")} className={input} /></label>
            <label className="text-sm font-semibold text-resq-navy">Blood group
              <select value={profile.bloodGroup} onChange={set("bloodGroup")} className={input}><option value="">Don&apos;t know</option>{BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}</select>
            </label>
            <label className="text-sm font-semibold text-resq-navy sm:col-span-2">Home address / area<input value={profile.address} onChange={set("address")} maxLength={200} autoComplete="street-address" placeholder="e.g. Near Karicode junction, Kollam" className={input} /></label>
            <label className="text-sm font-semibold text-resq-navy sm:col-span-2">Medical conditions, allergies, medicines<textarea value={profile.medicalNotes} onChange={set("medicalNotes")} maxLength={300} rows={2} placeholder="e.g. Diabetic, on insulin. Allergic to penicillin." className={`${input} py-3`} /></label>
            <label className="text-sm font-semibold text-resq-navy">Emergency contact name<input value={profile.emergencyContactName} onChange={set("emergencyContactName")} maxLength={60} className={input} /></label>
            <label className="text-sm font-semibold text-resq-navy">Emergency contact phone<input type="tel" value={profile.emergencyContactPhone} onChange={set("emergencyContactPhone")} className={input} /></label>
            {msg && <p role="alert" className="text-sm font-medium text-resq-red sm:col-span-2">{msg}</p>}
            <button onClick={() => (name.trim() ? setStep(1) : setMsg("Please enter your name."))} className="min-h-14 rounded-2xl bg-resq-red font-display text-lg font-bold text-white sm:col-span-2">Next</button>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="font-display text-lg font-bold text-resq-navy">What can you do?</h2>
            <p className="mb-3 text-sm text-resq-slate">We only show you requests that need these. Skip if none apply: you can still ask for help.</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {PERSON_SKILLS.map((s) => {
                const m = SKILL_META[s], on = skills.includes(s);
                return (
                  <button key={s} onClick={() => setSkills(toggle(skills, s))} aria-pressed={on} style={on ? { borderColor: m.color } : undefined} className={tileCls(on)}>
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: m.bg, color: m.color }}>{m.icon}</div>
                    <span className="text-sm font-semibold text-resq-navy">{m.label}</span>
                  </button>
                );
              })}
            </div>
            <h2 className="mt-6 font-display text-lg font-bold text-resq-navy">What equipment do you have?</h2>
            <p className="mb-3 text-sm text-resq-slate">Vehicles, tools and supplies that could help a neighbour.</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {RESOURCE_SKILLS.map((s) => {
                const m = SKILL_META[s], on = skills.includes(s);
                const label = s === "boat_owner" ? "Boat" : s === "driver_4x4" ? "4×4 vehicle" : "Generator";
                return (
                  <button key={s} onClick={() => setSkills(toggle(skills, s))} aria-pressed={on} style={on ? { borderColor: m.color } : undefined} className={tileCls(on)}>
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: m.bg, color: m.color }}>{m.icon}</div>
                    <span className="text-sm font-semibold text-resq-navy">{label}</span>
                  </button>
                );
              })}
              {EQUIPMENT.map((e) => {
                const m = EQUIPMENT_META[e], on = equipment.includes(e);
                return (
                  <button key={e} onClick={() => setEquipment(toggle(equipment, e))} aria-pressed={on} style={on ? { borderColor: m.color } : undefined} className={tileCls(on)}>
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: m.bg, color: m.color }}>{m.icon}</div>
                    <span className="text-sm font-semibold text-resq-navy">{EQUIPMENT_LABELS[e]}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setStep(2)} className="mt-6 min-h-14 w-full rounded-2xl bg-resq-red font-display text-lg font-bold text-white">Next</button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="card-shadow rounded-2xl bg-white p-5">
              <p className="font-display text-lg font-bold text-resq-navy">{name}</p>
              <p className="text-sm text-resq-slate">{phone}{profile.bloodGroup ? ` · ${profile.bloodGroup}` : ""}{profile.age ? ` · ${profile.age} yrs` : ""}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {skills.map((s) => <SkillPill key={s} skill={s} />)}{equipment.map((e) => <EquipmentPill key={e} item={e} />)}
                {skills.length + equipment.length === 0 && <span className="text-sm text-resq-slate">No skills or equipment added.</span>}
              </div>
            </div>
            <button onClick={() => setAvailable(!available)} aria-pressed={available}
              className={`flex min-h-16 w-full items-center justify-between rounded-2xl px-5 text-left ${available ? "bg-resq-green text-white" : "border-2 border-slate-200 bg-white text-resq-navy"}`}>
              <div><p className="font-display text-lg font-bold">Available to help nearby</p><p className={`text-xs ${available ? "text-white/80" : "text-resq-slate"}`}>You&apos;ll get alerts for requests that match your skills or equipment.</p></div>
              <div className={`flex h-8 w-14 items-center rounded-full p-1 ${available ? "justify-end bg-white/30" : "justify-start bg-slate-200"}`}><div className="h-6 w-6 rounded-full bg-white shadow" /></div>
            </button>
            <p className="text-xs text-resq-slate">While signed in, your location is shared every 30 s so nearby requests can reach you and authorities can find you in a declared disaster zone. You can pause it on your dashboard.</p>
            <button onClick={save} disabled={busy} className="min-h-14 w-full rounded-2xl bg-resq-red font-display text-lg font-bold text-white disabled:opacity-60">{busy ? "Saving…" : editing ? "Save profile" : "Go to my dashboard"}</button>
          </div>
        )}
      </main>
    </>
  );
}

// ─── Dashboard ─────────────────────────────────────────────────────────────────────────────────────────────

function DashboardScreen({ initial, config, onAsk, onOpenRequest, onProfile, onSignOut }: {
  initial: Dashboard; config: Config; onAsk: () => void; onOpenRequest: (id: string) => void; onProfile: () => void; onSignOut: () => void;
}) {
  const tok = getHelperToken() ?? "none";
  const { data, connected, setData } = useSnapshot<Dashboard>(`/api/dashboard/stream?s=${encodeURIComponent(tok)}`, "/api/dashboard", { "x-resq-session": tok });
  const dash = data ?? initial;
  const me = dash.me!;
  const beacon = useLocationBeacon(true, config.seedCenter);
  const [open, setOpen] = useState<FeedItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set(initial.feed.map((f) => f.request.id)));
  const pos = useRef<LatLng | null>(me.location);
  pos.current = me.location ?? pos.current;

  const reload = useCallback(async () => { const r = await api<Dashboard>("/api/dashboard"); if (r.ok) setData(r.data); }, [setData]);
  // Keep waves moving and the feed fresh even if a stream frame is missed.
  useEffect(() => { const t = setInterval(reload, 10_000); return () => clearInterval(t); }, [reload]);

  // New request for me → sound + tab title.
  useEffect(() => {
    const fresh = dash.feed.filter((f) => !seen.current.has(f.request.id));
    if (fresh.length) { beep(); try { navigator.vibrate?.([250, 100, 250]); } catch { /* unsupported */ } }
    fresh.forEach((f) => seen.current.add(f.request.id));
    document.title = dash.feed.length ? `(${dash.feed.length}) Help needed nearby · ResQ` : "ResQ";
  }, [dash.feed]);

  // While helping someone, stream position every 3 s (simulated travel in demo mode) so they see you coming.
  const activeId = dash.active?.request.id ?? null;
  const tLat = dash.active?.request.location?.lat ?? null, tLng = dash.active?.request.location?.lng ?? null;
  useEffect(() => {
    if (!activeId || tLat === null || tLng === null) return;
    const target = { lat: tLat, lng: tLng };
    const t = setInterval(async () => {
      let next: LatLng | null = null;
      if (beacon.source === "gps") next = await getPosition(3000);
      else if (pos.current && distanceKm(pos.current, target) > 0.005) next = stepToward(pos.current, target, 0.06);
      if (next) { pos.current = next; await api("/api/me/location", { body: { location: next, source: beacon.source ?? "demo" } }); }
    }, 3000);
    return () => clearInterval(t);
  }, [activeId, tLat, tLng, beacon.source]);

  const toggleAvailable = async () => {
    const r = await api<{ helper: Helper }>("/api/helpers", { method: "PATCH", body: { onDuty: !me.onDuty } });
    if (r.ok) setData({ ...dash, me: r.data.helper });
  };
  const accept = async (f: FeedItem) => {
    const r = await api<{ ok: boolean; reason?: string }>(`/api/requests/${f.request.id}/accept`, { method: "POST" });
    setOpen(null);
    setToast(r.ok ? `You're helping ${f.request.requesterName ?? "them"}. Your details were shared with them.`
      : r.data.reason === "already_matched" ? "Someone else already accepted this request. Thank you!" : "Could not accept that request.");
    void reload();
  };
  const notNow = async (f: FeedItem) => { await api(`/api/requests/${f.request.id}/decline`, { method: "POST" }); setOpen(null); void reload(); };
  const done = async () => { if (dash.active) { await api(`/api/requests/${dash.active.request.id}`, { method: "PATCH", body: { action: "resolve" } }); void reload(); } };
  const signOut = async () => { await api("/api/auth/logout", { method: "POST", body: {} }); document.title = "ResQ"; onSignOut(); };

  return (
    <>
      <div className="bg-navy-gradient">
        <Container className="px-5 pb-7 pt-5 md:px-8">
          <div className="flex items-start justify-between gap-3">
            <button onClick={onProfile} className="flex items-center gap-3 text-left">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-resq-cyan to-resq-navy font-bold text-white">{initials(me.name)}</div>
              <div><p className="text-sm text-white/60">Hello,</p><h1 className="font-display text-xl font-bold text-white">{me.name}</h1></div>
            </button>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-xl bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white"><PulsingDot color={connected ? "green" : "red"} />{connected ? "Live" : "…"}</span>
              <button onClick={onProfile} className="min-h-10 rounded-xl border border-white/20 px-3 text-xs font-semibold text-white">Profile</button>
              <button onClick={signOut} className="min-h-10 rounded-xl border border-white/20 px-3 text-xs font-semibold text-white">Sign out</button>
            </div>
          </div>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            <button onClick={toggleAvailable} aria-pressed={me.onDuty}
              className={`flex min-h-14 items-center justify-between rounded-2xl px-4 text-left ${me.onDuty ? "bg-resq-green" : "bg-white/10"}`}>
              <div><p className="font-display font-bold text-white">{me.onDuty ? "Available to help" : "Not available"}</p><p className="text-xs text-white/75">{me.onDuty ? "You get alerts for matching requests" : "Tap to receive alerts"}</p></div>
              <div className={`flex h-7 w-12 items-center rounded-full p-1 ${me.onDuty ? "justify-end bg-white/30" : "justify-start bg-white/20"}`}><div className="h-5 w-5 rounded-full bg-white" /></div>
            </button>
            <BeaconChip light paused={beacon.paused} ago={beacon.ago} source={beacon.source} onToggle={(p) => void beacon.setPaused(p)} />
          </div>
        </Container>
      </div>

      <main className="mx-auto grid w-full max-w-6xl flex-1 content-start gap-4 px-4 py-4 md:px-8 lg:grid-cols-[1fr_1.2fr] lg:items-start">
        <div className="flex flex-col gap-4">
          {toast && (
            <div className="animate-fade-in flex items-center gap-2 rounded-2xl bg-resq-navy px-4 py-3 text-sm font-semibold text-white">
              <Icon.Check size={16} />{toast}<button onClick={() => setToast(null)} aria-label="Dismiss" className="ml-auto flex h-9 w-9 items-center justify-center"><Icon.X size={16} /></button>
            </div>
          )}
          {dash.myRequest ? (
            <button onClick={() => onOpenRequest(dash.myRequest!.id)} className="card-shadow-lg animate-slide-up rounded-2xl border-2 border-resq-red bg-white p-5 text-left">
              <div className="flex items-center gap-2"><PulsingDot color="red" /><span className="text-xs font-bold uppercase tracking-wider text-resq-red">Your request</span>
                <span className="ml-auto rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold capitalize text-resq-navy">{dash.myRequest.status}</span></div>
              <p className="mt-2 font-display text-lg font-bold text-resq-navy">{dash.myRequest.triage ? TYPE_LABELS[dash.myRequest.triage.type] : "Understanding your request…"}</p>
              <p className="line-clamp-2 text-sm text-resq-slate">{dash.myRequest.description}</p>
              <p className="mt-2 text-sm font-semibold text-resq-cyan">{dash.myRequest.status === "matched" ? "A helper is on the way · view their details →" : "View live status, guidance and tracking →"}</p>
            </button>
          ) : (
            <button onClick={onAsk} className="flex w-full items-center justify-between rounded-2xl bg-emergency-gradient p-6 text-left text-white shadow-lg transition-transform active:scale-[.99]" style={{ boxShadow: "0 8px 32px rgba(220,38,38,.3)" }}>
              <div><p className="mb-1 text-xs font-medium uppercase tracking-wider text-white/70">Need help?</p><p className="font-display text-3xl font-bold">ASK FOR HELP</p>
                <p className="mt-1 text-sm text-white/80">Say what&apos;s wrong. Your details are sent automatically.</p></div>
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15"><Icon.AlertTriangle size={30} /></div>
            </button>
          )}
          {dash.active && <ActiveJob r={dash.active.request} mapsUrl={dash.active.mapsUrl} me={me.location} simulated={beacon.source !== "gps"} onDone={done} />}
          <section className="card-shadow rounded-2xl border border-slate-100 bg-white p-4">
            <div className="mb-2 flex items-center justify-between"><h2 className="font-display font-semibold text-resq-navy">What you can offer</h2><button onClick={onProfile} className="min-h-10 px-2 text-sm font-semibold text-resq-cyan">Edit</button></div>
            <div className="flex flex-wrap gap-1.5">
              {me.skills.map((s) => <SkillPill key={s} skill={s} />)}{(me.equipment ?? []).map((e) => <EquipmentPill key={e} item={e} />)}
              {me.skills.length + (me.equipment ?? []).length === 0 && <p className="text-sm text-resq-slate">Nothing added yet. Add skills or equipment to see requests you can help with.</p>}
            </div>
          </section>
        </div>

        <section>
          <div className="mb-3 flex items-end justify-between">
            <div><h2 className="font-display text-lg font-bold text-resq-navy">People near you who need help</h2>
              <p className="text-xs text-resq-slate">Within {dash.radiusKm} km, matching your skills or equipment · updates live</p></div>
            <Badge variant={dash.feed.length ? "emergency" : "default"}>{dash.feed.length}</Badge>
          </div>
          <div className="space-y-3">
            {dash.feed.map((f) => <FeedCard key={f.request.id} f={f} onOpen={() => setOpen(f)} />)}
            {dash.feed.length === 0 && (
              <div className="card-shadow rounded-2xl border border-slate-100 bg-white p-6 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100"><Icon.Bell size={26} className="text-resq-slate" /></div>
                <p className="font-display font-semibold text-resq-navy">No one nearby needs your help right now</p>
                <p className="mt-1 text-sm text-resq-slate">Keep this open. New requests appear here instantly{dash.otherNearby ? ` (${dash.otherNearby} other nearby request${dash.otherNearby > 1 ? "s" : ""} need different skills)` : ""}.</p>
              </div>
            )}
          </div>
        </section>
      </main>
      {open && <RequestSheet f={open} me={me} onClose={() => setOpen(null)} onAccept={() => accept(open)} onDecline={() => notNow(open)} />}
      <Call112Bar />
    </>
  );
}

function FeedCard({ f, onOpen }: { f: FeedItem; onOpen: () => void }) {
  const r = f.request, t = r.triage;
  const left = useSecondsLeft(f.expiresAt);
  return (
    <button onClick={onOpen} className={`card-shadow animate-slide-up w-full rounded-2xl border-2 bg-white p-4 text-left transition-colors hover:bg-slate-50 ${f.picked ? "border-resq-red" : "border-slate-100"}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {t && <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${URGENCY_STYLE[t.urgency]}`}>{t.urgency}</span>}
        <span className="font-display font-bold text-resq-navy">{t ? TYPE_LABELS[t.type] : "Emergency"}</span>
        {f.picked && left > 0 && <Badge variant="emergency">You were picked · {left}s</Badge>}
        {r.status === "escalated" && <Badge variant="warning">No one yet</Badge>}
        <span className="ml-auto text-xs text-resq-slate">{fmtTime(r.createdAt)}</span>
      </div>
      <p className="mt-1.5 text-sm text-resq-navy"><strong>{r.requesterName ?? "Someone"}</strong>{r.requesterProfile?.age ? `, ${r.requesterProfile.age}` : ""} · {fmtDistance(f.distanceKm)} away</p>
      <p className="line-clamp-2 text-sm text-resq-slate">“{r.description}”</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="font-semibold text-resq-slate">Needs your:</span>
        {f.matchedSkills.map((s) => <SkillPill key={s} skill={s} />)}{f.matchedEquipment.map((e) => <EquipmentPill key={e} item={e} />)}
      </div>
      <p className="mt-2 text-sm font-semibold text-resq-cyan">View details →</p>
    </button>
  );
}

function RequestSheet({ f, me, onClose, onAccept, onDecline }: { f: FeedItem; me: Helper; onClose: () => void; onAccept: () => void; onDecline: () => void }) {
  const r = f.request, t = r.triage;
  const [busy, setBusy] = useState(false);
  const markers: MapMarker[] = [];
  if (r.location) markers.push({ id: "r", at: r.location, color: "#DC2626", kind: "target", label: "Help" });
  if (me.location) markers.push({ id: "me", at: me.location, color: "#16A34A", kind: "you", label: "You", pulse: false });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-resq-navy-dark/60 backdrop-blur-sm md:items-center" role="dialog" aria-modal="true" aria-labelledby="req-title" onClick={onClose}>
      <div className="animate-slide-up max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-2xl md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-emergency-gradient px-5 py-4 text-white">
          <div className="flex items-start justify-between">
            <div>
              {t && <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase">{t.urgency}</span>}
              <h2 id="req-title" className="mt-1 font-display text-2xl font-bold">{t ? TYPE_LABELS[t.type] : "Emergency"}</h2>
              <p className="text-sm text-white/80">{fmtDistance(f.distanceKm)} from you · asked at {fmtTime(r.createdAt)}</p>
            </div>
            <button onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/15"><Icon.X size={18} /></button>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <p className="rounded-xl bg-resq-red-light p-3 text-sm text-resq-red-dark">“{r.description}”</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="font-semibold text-resq-slate">Needs your:</span>
            {f.matchedSkills.map((s) => <SkillPill key={s} skill={s} />)}{f.matchedEquipment.map((e) => <EquipmentPill key={e} item={e} />)}
          </div>
          <PersonDetails r={r} />
          {r.location && (
            <div className="overflow-hidden rounded-2xl">
              <LiveMap center={r.location} radiusKm={Math.max(0.4, (f.distanceKm ?? 0.5) * 1.4)} markers={markers} height={170} route={me.location ? [me.location, r.location] : undefined} />
            </div>
          )}
          <p className="text-xs text-resq-slate">If you accept, {r.requesterName ?? "they"} will see your name, phone, skills and equipment, and you&apos;ll be guided to their location.</p>
          <div className="grid grid-cols-2 gap-3">
            <button disabled={busy} onClick={() => { setBusy(true); onAccept(); }} className="flex min-h-16 flex-col items-center justify-center rounded-2xl bg-success-gradient font-display text-lg font-bold text-white shadow-lg disabled:opacity-60"><Icon.Check size={22} />I&apos;ll help</button>
            <button disabled={busy} onClick={() => { setBusy(true); onDecline(); }} className="flex min-h-16 flex-col items-center justify-center rounded-2xl border-2 border-slate-200 font-display text-lg font-bold text-resq-slate disabled:opacity-60"><Icon.X size={22} />Not now</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Ask for help (minimal: the profile supplies the rest) ─────────────────────────────────────────────────

function AskForm({ me, center, onBack, onCreated }: { me: Helper; center: LatLng; onBack: () => void; onCreated: (id: string) => void }) {
  const [text, setText] = useState("");
  const [tile, setTile] = useState<string | null>(null);
  const [role, setRole] = useState<RequesterRole>("self");
  const [loc, setLoc] = useState<{ at: LatLng; source: "gps" | "demo" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const speech = useSpeech(setText);
  useEffect(() => { void whereAmI(center).then(setLoc); }, [center]);

  const submit = async () => {
    const t = EMERGENCY_TILES.find((x) => x.id === tile);
    const description = [t && !text.toLowerCase().includes(t.label.toLowerCase()) ? t.hint : "", text.trim() || (t ? t.sub : "")].filter(Boolean).join(" ").trim();
    if (!description) { setError("Tell us what is happening, or pick a type."); return; }
    setBusy(true); setError(null);
    const r = await api<RequestView>("/api/requests", { body: { description, role, location: loc?.at ?? me.location ?? null } });
    setBusy(false);
    if (r.ok) onCreated(r.data.request.id); else setError(`Could not send (${r.error}). Call 112.`);
  };
  if (busy) return <Triaging text={text || EMERGENCY_TILES.find((x) => x.id === tile)?.sub || ""} />;

  const p = me.profile;
  return (
    <>
      <div className="bg-emergency-gradient">
        <Container><NavBar title="Ask for help" onBack={onBack} light /></Container>
        <p className="mx-auto max-w-3xl px-5 pb-5 text-sm text-white/85">Just say what&apos;s wrong. Nearby people with the right skills or equipment are alerted at once.</p>
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-4">
        <label htmlFor="what" className="mb-1.5 block font-display text-lg font-bold text-resq-navy">What&apos;s happening?</label>
        <div className="relative">
          <textarea id="what" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={3} autoFocus
            placeholder="e.g. My father collapsed and is not breathing" className="card-shadow w-full rounded-2xl border border-slate-200 bg-white p-4 pr-16 text-base text-resq-navy outline-none focus:ring-2 focus:ring-resq-red/30" />
          {speech.supported && (
            <button aria-label="Hold to speak" onPointerDown={(e) => { e.preventDefault(); speech.start(); }} onPointerUp={speech.stop} onPointerLeave={() => speech.listening && speech.stop()}
              className={`absolute bottom-3 right-3 flex h-12 w-12 touch-none items-center justify-center rounded-xl text-white ${speech.listening ? "scale-110 bg-resq-red" : "bg-resq-navy"}`}>
              <Icon.Mic size={20} />
            </button>
          )}
        </div>
        {speech.supported && <p className="mt-1 text-xs text-resq-slate">{speech.listening ? "Listening… release to stop" : "Hold the mic button to speak instead of typing."}</p>}

        <p className="mb-2 mt-4 text-sm font-semibold text-resq-navy">Quick pick <span className="font-normal text-resq-slate">(optional)</span></p>
        <div className="flex flex-wrap gap-2">
          {EMERGENCY_TILES.map((t) => (
            <button key={t.id} onClick={() => setTile(tile === t.id ? null : t.id)} aria-pressed={tile === t.id}
              className={`flex min-h-11 items-center gap-1.5 rounded-xl border-2 px-3 text-sm font-semibold ${tile === t.id ? "border-resq-red bg-resq-red-light text-resq-red" : "border-slate-200 bg-white text-resq-navy"}`}>
              <span style={{ color: t.color }} className="[&_svg]:h-4 [&_svg]:w-4">{t.icon}</span>{t.label}
            </button>
          ))}
        </div>

        <p className="mb-2 mt-4 text-sm font-semibold text-resq-navy">Who needs help?</p>
        <div className="grid grid-cols-2 gap-2">
          {([["self", "Me"], ["other", "Someone with me"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setRole(v)} aria-pressed={role === v}
              className={`min-h-12 rounded-xl border-2 text-sm font-semibold ${role === v ? "border-resq-navy bg-resq-navy text-white" : "border-slate-200 bg-white text-resq-navy"}`}>{label}</button>
          ))}
        </div>

        <div className="mt-4 rounded-2xl bg-slate-100 p-3 text-xs text-resq-slate">
          <p className="font-semibold text-resq-navy">Sent automatically from your profile</p>
          <p className="mt-1">{me.name} · {me.phone}{p?.bloodGroup ? ` · Blood ${p.bloodGroup}` : ""}{p?.age ? ` · ${p.age} yrs` : ""}{p?.medicalNotes ? ` · ${p.medicalNotes}` : ""}</p>
          <p className="mt-1 flex items-center gap-1"><Icon.MapPin size={12} />{loc ? (loc.source === "gps" ? "Your GPS location" : "Demo location near TKMCE (GPS not in the demo area)") : "Getting your location…"}</p>
        </div>
        {error && <p role="alert" className="mt-3 rounded-xl bg-resq-red-light p-3 text-sm font-medium text-resq-red">{error}</p>}
        <button onClick={submit} disabled={!text.trim() && !tile}
          className={`mt-4 min-h-16 w-full rounded-2xl font-display text-xl font-bold ${text.trim() || tile ? "bg-resq-red text-white shadow-lg" : "cursor-not-allowed bg-slate-200 text-slate-400"}`}>
          Send for help
        </button>
      </main>
      <Call112Bar />
    </>
  );
}

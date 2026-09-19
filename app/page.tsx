"use client";
/*
 * ResQ — a local-services community ("Uber for neighbours and local professionals").
 *   sign in (phone + code) → profile (details, services you offer with a price range, ID proof) → home
 *   home: tap a service (Plumber, Electrician, Doctor…) → describe the problem → nearby providers get it live
 *         → one accepts → call / message / live map → done → pay (placeholder) + rate
 *   providers: "Requests for you" with the requester's details → Accept / Not now → one job at a time
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Container, Logo, NavBar, PhoneShell, PulsingDot, initials } from "@/components/ui";
import { SKILL_META } from "@/components/skills";
import { OtpForm } from "@/components/OtpForm";
import { BeaconChip } from "@/components/BeaconChip";
import { ActiveJob, PersonDetails, beep } from "@/components/ActiveJob";
import { ServiceRequestView, Stars, VerifiedBadge, fmtRate, type ProviderPreview } from "@/components/ServiceRequestView";
import { VoiceMic } from "@/components/VoiceMic";
import { LiveMap, type MapMarker } from "@/components/LiveMap";
import { DEMO_RADIUS_KM, api, demoSpot, distanceKm, fmtDistance, fmtTime, getHelperToken, getPosition, setHelperToken, stepToward, type LatLng } from "@/lib/client/api";
import { useLocationBeacon } from "@/lib/client/beacon";
import { useSnapshot } from "@/lib/client/sse";
import { speechErrorText, useSpeech } from "@/lib/client/speech";
import { BLOOD_GROUPS, MEDICAL_SERVICES, SERVICES, type Service } from "@/lib/taxonomy";
import { isVerified } from "@/lib/policy";
import type { Dashboard, FeedItem } from "@/lib/feed";
import type { Helper, RateRange, RequestView, Skill, UserProfile } from "@/lib/types";

type Config = { seedCenter: LatLng };
type Screen = { name: "loading" } | { name: "auth" } | { name: "onboarding" } | { name: "profile" } | { name: "home" }
  | { name: "describe"; service: Service } | { name: "request"; id: string };
type ServiceSummary = { service: Service; count: number; verified: number; minRate: number | null; maxRate: number | null; nearestKm: number | null };

/** Where this person is: GPS if it is plausibly at the venue, else this window's demo spot near TKMCE. */
async function whereAmI(center: LatLng): Promise<{ at: LatLng; source: "gps" | "demo" }> {
  const p = await getPosition(6000);
  return p && distanceKm(p, center) <= DEMO_RADIUS_KM ? { at: p, source: "gps" } : { at: demoSpot(center), source: "demo" };
}

export default function ResQApp() {
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [config, setConfig] = useState<Config | null>(null);
  const [dash, setDash] = useState<Dashboard | null>(null);

  const refresh = useCallback(async () => {
    if (!getHelperToken()) { setScreen({ name: "auth" }); return; }
    const r = await api<Dashboard>("/api/dashboard");
    if (!r.ok) { setHelperToken(null); setScreen({ name: "auth" }); return; }
    setDash(r.data);
    setScreen((s) => (!r.data.me ? { name: "onboarding" } : s.name === "loading" || s.name === "auth" || s.name === "onboarding" ? { name: "home" } : s));
  }, []);

  useEffect(() => {
    void api<Config>("/api/config").then((r) => r.ok && setConfig(r.data));
    void refresh();
  }, [refresh]);

  const home = () => { setScreen({ name: "home" }); void refresh(); };
  return (
    <PhoneShell>
      {screen.name === "loading" && <div className="flex flex-1 items-center justify-center text-resq-slate">Loading…</div>}
      {screen.name === "auth" && <AuthScreen onDone={refresh} />}
      {(screen.name === "onboarding" || screen.name === "profile") && dash && config && (
        <Onboarding phone={dash.phone} me={dash.me} center={config.seedCenter} editing={screen.name === "profile"} onCancel={home}
          onDone={async () => { await refresh(); setScreen({ name: "home" }); }} />
      )}
      {screen.name === "home" && dash?.me && config && (
        <Home initial={dash} config={config} onService={(service) => setScreen({ name: "describe", service })}
          onOpenRequest={(id) => setScreen({ name: "request", id })} onProfile={() => setScreen({ name: "profile" })}
          onSignOut={() => { setHelperToken(null); setDash(null); setScreen({ name: "auth" }); }} />
      )}
      {screen.name === "describe" && dash?.me && config && (
        <Describe service={screen.service} me={dash.me} center={config.seedCenter} onBack={home} onCreated={(id) => setScreen({ name: "request", id })} />
      )}
      {screen.name === "request" && <ServiceRequestView id={screen.id} onClose={home} />}
    </PhoneShell>
  );
}

// ─── Sign in ───────────────────────────────────────────────────────────────────────────────────────────────

function AuthScreen({ onDone }: { onDone: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col bg-navy-gradient">
      <Container className="flex flex-1 flex-col items-center justify-center gap-6 px-5 py-10">
        <div className="animate-slide-up flex flex-col items-center gap-3 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-resq-red" style={{ boxShadow: "0 0 60px rgba(220,38,38,.4)" }}><Logo size={42} /></div>
          <h1 className="font-display text-4xl font-bold text-white">ResQ</h1>
          <p className="max-w-sm text-white/70">Trusted local help, one tap away. Plumbers, electricians, doctors and more from your own neighbourhood, and a way to earn from your skills.</p>
        </div>
        <div className="card-shadow-lg w-full max-w-md rounded-3xl bg-white p-6">
          <h2 className="font-display text-xl font-bold text-resq-navy">Sign in or create your account</h2>
          <p className="mb-4 mt-1 text-sm text-resq-slate">We&apos;ll text you a 6-digit code. New here? You&apos;ll set up your profile next.</p>
          <OtpForm onDone={() => onDone()} cta="Continue" />
        </div>
        <div className="flex gap-4 text-xs text-white/50">
          <Link href="/ops" className="underline">Admin login</Link>
          <Link href="/demo" className="underline">Demo launcher</Link>
        </div>
      </Container>
    </div>
  );
}

// ─── Profile: details, services with price ranges, ID proof ─────────────────────────────────────────────────

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
  const [offered, setOffered] = useState<Service[]>((me?.skills ?? []).filter((s): s is Service => (SERVICES as readonly string[]).includes(s)));
  const [rates, setRates] = useState<Partial<Record<Service, { min: string; max: string }>>>(() => {
    const o: Partial<Record<Service, { min: string; max: string }>> = {};
    for (const [k, v] of Object.entries(me?.rates ?? {})) if (v) o[k as Service] = { min: String(v.min), max: String(v.max) };
    return o;
  });
  const [file, setFile] = useState<File | null>(null);
  const [available, setAvailable] = useState(me ? me.onDuty : true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof UserProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setProfile({ ...profile, [k]: e.target.value });
  const toggle = (s: Service) => setOffered((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const rateErrors = offered.filter((s) => {
    const r = rates[s];
    const min = Number(r?.min), max = Number(r?.max);
    return !r || r.min === "" || r.max === "" || !Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max > 100000 || min > max;
  });

  const save = async () => {
    setBusy(true); setMsg(null);
    // Keep non-service skills the person already had (older profiles); services come from this form.
    const otherSkills = (me?.skills ?? []).filter((s) => !(SERVICES as readonly string[]).includes(s));
    const rateBody: Partial<Record<Skill, RateRange>> = {};
    for (const s of offered) rateBody[s] = { min: Number(rates[s]!.min), max: Number(rates[s]!.max) };
    const r = await api<{ token?: string; helper: Helper }>("/api/helpers", {
      body: { name, phone, skills: [...otherSkills, ...offered], rates: rateBody, profile: { ...profile, age: profile.age ? Number(profile.age) : null } },
    });
    if (!r.ok) { setBusy(false); setMsg(`Please check your details (${r.error.replace(/_/g, " ")}).`); setStep(0); return; }
    if (r.data.token) setHelperToken(r.data.token);
    if (file) {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/me/id-proof", { method: "POST", body: fd, headers: { "x-resq-session": getHelperToken() ?? "none" } });
      if (!up.ok) {
        const e = (await up.json().catch(() => ({}))) as { error?: string };
        setBusy(false);
        setMsg(e.error === "file_type_invalid" ? "ID proof must be a JPG, PNG, WEBP or PDF." : e.error === "file_size_invalid" ? "ID proof must be under 5 MB." : "Could not upload the ID proof.");
        setStep(1);
        return;
      }
    }
    const loc = await whereAmI(center);
    await api("/api/helpers", { method: "PATCH", body: { onDuty: offered.length > 0 && available, location: loc.at } });
    setBusy(false);
    onDone();
  };

  const input = "mt-1 min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base font-normal outline-none focus:ring-2 focus:ring-resq-red/30";
  const steps = ["Your details", "Offer your skills", "Done"];
  return (
    <>
      <div className="bg-navy-gradient">
        <Container><NavBar title={editing ? "Edit profile" : "Set up your profile"} onBack={editing ? onCancel : step > 0 ? () => setStep(step - 1) : undefined} light /></Container>
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
            <p className="text-sm text-resq-slate sm:col-span-2">Signed in as <strong>{phone}</strong>. Your details are shared only with the person on the other side of a job you both agreed to.</p>
            <label className="text-sm font-semibold text-resq-navy sm:col-span-2">Full name *<input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" className={input} /></label>
            <label className="text-sm font-semibold text-resq-navy">Age<input type="number" inputMode="numeric" min={1} max={120} value={profile.age} onChange={set("age")} className={input} /></label>
            <label className="text-sm font-semibold text-resq-navy">Blood group <span className="font-normal text-resq-slate">(for medical help)</span>
              <select value={profile.bloodGroup} onChange={set("bloodGroup")} className={input}><option value="">Don&apos;t know</option>{BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}</select>
            </label>
            <label className="text-sm font-semibold text-resq-navy sm:col-span-2">Address / area<input value={profile.address} onChange={set("address")} maxLength={200} autoComplete="street-address" placeholder="e.g. Near Karicode junction, Kollam" className={input} /></label>
            <label className="text-sm font-semibold text-resq-navy sm:col-span-2">Health notes <span className="font-normal text-resq-slate">(optional, shared with a doctor or nurse you book)</span><textarea value={profile.medicalNotes} onChange={set("medicalNotes")} maxLength={300} rows={2} className={`${input} py-3`} /></label>
            <label className="text-sm font-semibold text-resq-navy">Alternate contact name<input value={profile.emergencyContactName} onChange={set("emergencyContactName")} maxLength={60} className={input} /></label>
            <label className="text-sm font-semibold text-resq-navy">Alternate contact phone<input type="tel" value={profile.emergencyContactPhone} onChange={set("emergencyContactPhone")} className={input} /></label>
            {msg && <p role="alert" className="text-sm font-medium text-resq-red sm:col-span-2">{msg}</p>}
            <button onClick={() => (name.trim() ? setStep(1) : setMsg("Please enter your name."))} className="min-h-14 rounded-2xl bg-resq-red font-display text-lg font-bold text-white sm:col-span-2">Next</button>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="font-display text-lg font-bold text-resq-navy">Earn by offering your skills <span className="text-sm font-normal text-resq-slate">(optional)</span></h2>
            <p className="mb-3 text-sm text-resq-slate">Pick what you do and what you charge. Neighbours see your price range before they book. Skip this if you only want to hire help.</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {SERVICES.map((s) => {
                const m = SKILL_META[s], on = offered.includes(s);
                return (
                  <button key={s} onClick={() => toggle(s)} aria-pressed={on} style={on ? { borderColor: m.color } : undefined}
                    className={`flex min-h-14 items-center gap-2.5 rounded-2xl border-2 bg-white p-3 text-left ${on ? "shadow-md" : "border-slate-100"}`}>
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl" style={{ background: m.bg, color: m.color }}>{m.icon}</div>
                    <span className="text-sm font-semibold text-resq-navy">{m.label}</span>
                  </button>
                );
              })}
            </div>

            {offered.length > 0 && (
              <>
                <h3 className="mb-2 mt-6 font-display font-bold text-resq-navy">Your price range (₹ per visit)</h3>
                <div className="space-y-2">
                  {offered.map((s) => (
                    <div key={s} className="flex flex-wrap items-center gap-2 rounded-2xl bg-white p-3 card-shadow">
                      <span className="w-36 text-sm font-semibold text-resq-navy">{SKILL_META[s].label}</span>
                      <label className="flex items-center gap-1 text-sm text-resq-slate">₹<input aria-label={`${SKILL_META[s].label} minimum`} type="number" inputMode="numeric" min={0} value={rates[s]?.min ?? ""} placeholder="min"
                        onChange={(e) => setRates({ ...rates, [s]: { min: e.target.value, max: rates[s]?.max ?? "" } })} className="min-h-11 w-24 rounded-lg border border-slate-200 px-2 text-resq-navy" /></label>
                      <span className="text-resq-slate">to</span>
                      <label className="flex items-center gap-1 text-sm text-resq-slate">₹<input aria-label={`${SKILL_META[s].label} maximum`} type="number" inputMode="numeric" min={0} value={rates[s]?.max ?? ""} placeholder="max"
                        onChange={(e) => setRates({ ...rates, [s]: { min: rates[s]?.min ?? "", max: e.target.value } })} className="min-h-11 w-24 rounded-lg border border-slate-200 px-2 text-resq-navy" /></label>
                      {rateErrors.includes(s) && <span className="text-xs text-resq-red">Enter whole rupees, min ≤ max</span>}
                    </div>
                  ))}
                </div>

                <h3 className="mb-1 mt-6 font-display font-bold text-resq-navy">Verify your identity</h3>
                <p className="mb-2 text-sm text-resq-slate">Upload a government ID (Aadhaar, driving licence, voter ID) or a professional licence. An admin checks it and you get the <strong>ID verified</strong> badge, which neighbours trust more.</p>
                <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-4">
                  {me?.idProof && !file && <div className="mb-2 flex items-center gap-2 text-sm text-resq-navy"><VerifiedBadge verified={me.idProof.status === "verified"} pending={me.idProof.status === "pending"} /><span className="truncate">{me.idProof.fileName}</span>{me.idProof.status === "rejected" && <span className="text-resq-red">Rejected{me.idProof.note ? `: ${me.idProof.note}` : ""}. Upload again.</span>}</div>}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" aria-label="ID proof" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-resq-slate file:mr-3 file:min-h-11 file:rounded-xl file:border-0 file:bg-resq-navy file:px-4 file:font-semibold file:text-white" />
                  <p className="mt-2 text-xs text-resq-slate">JPG, PNG, WEBP or PDF, up to 5 MB. Visible only to ResQ admins.</p>
                </div>
              </>
            )}
            {msg && <p role="alert" className="mt-3 text-sm font-medium text-resq-red">{msg}</p>}
            <button onClick={() => (rateErrors.length ? setMsg("Please set a price range for every service you offer.") : (setMsg(null), setStep(2)))}
              className="mt-6 min-h-14 w-full rounded-2xl bg-resq-red font-display text-lg font-bold text-white">{offered.length ? "Next" : "Skip, I only want to hire help"}</button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="card-shadow rounded-2xl bg-white p-5">
              <p className="font-display text-lg font-bold text-resq-navy">{name}</p>
              <p className="text-sm text-resq-slate">{phone}{profile.address ? ` · ${profile.address}` : ""}</p>
              {offered.length > 0 ? (
                <ul className="mt-3 space-y-1.5">
                  {offered.map((s) => <li key={s} className="flex justify-between text-sm"><span className="font-semibold text-resq-navy">{SKILL_META[s].label}</span><span className="text-resq-slate">₹{rates[s]?.min}–₹{rates[s]?.max}</span></li>)}
                </ul>
              ) : <p className="mt-3 text-sm text-resq-slate">You can hire help. Add skills any time to start earning.</p>}
              {offered.length > 0 && <p className="mt-3 text-xs text-resq-slate">{file ? "ID proof will be uploaded for review." : me?.idProof ? "ID proof already on file." : "No ID proof yet: you can still accept jobs, but without the verified badge."}</p>}
            </div>
            {offered.length > 0 && (
              <button onClick={() => setAvailable(!available)} aria-pressed={available}
                className={`flex min-h-16 w-full items-center justify-between rounded-2xl px-5 text-left ${available ? "bg-resq-green text-white" : "border-2 border-slate-200 bg-white text-resq-navy"}`}>
                <div><p className="font-display text-lg font-bold">Available for work</p><p className={`text-xs ${available ? "text-white/80" : "text-resq-slate"}`}>Nearby requests for your services reach you instantly.</p></div>
                <div className={`flex h-8 w-14 items-center rounded-full p-1 ${available ? "justify-end bg-white/30" : "justify-start bg-slate-200"}`}><div className="h-6 w-6 rounded-full bg-white shadow" /></div>
              </button>
            )}
            <button onClick={save} disabled={busy} className="min-h-14 w-full rounded-2xl bg-resq-red font-display text-lg font-bold text-white disabled:opacity-60">{busy ? "Saving…" : editing ? "Save profile" : "Start using ResQ"}</button>
          </div>
        )}
      </main>
    </>
  );
}

// ─── Home ──────────────────────────────────────────────────────────────────────────────────────────────────

function Home({ initial, config, onService, onOpenRequest, onProfile, onSignOut }: {
  initial: Dashboard; config: Config; onService: (s: Service) => void; onOpenRequest: (id: string) => void; onProfile: () => void; onSignOut: () => void;
}) {
  const tok = getHelperToken() ?? "none";
  const { data, connected, setData } = useSnapshot<Dashboard>(`/api/dashboard/stream?s=${encodeURIComponent(tok)}`, "/api/dashboard", { "x-resq-session": tok });
  const dash = data ?? initial;
  const me = dash.me!;
  const isProvider = me.skills.some((s) => (SERVICES as readonly string[]).includes(s));
  const beacon = useLocationBeacon(true, config.seedCenter);
  const [summary, setSummary] = useState<ServiceSummary[] | null>(null);
  const [open, setOpen] = useState<FeedItem | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set(initial.feed.map((f) => f.request.id)));
  const pos = useRef<LatLng | null>(me.location);
  pos.current = me.location ?? pos.current;

  const reload = useCallback(async () => { const r = await api<Dashboard>("/api/dashboard"); if (r.ok) setData(r.data); }, [setData]);
  useEffect(() => { const t = setInterval(reload, 10_000); return () => clearInterval(t); }, [reload]);

  // What's available nearby (counts + price ranges per service).
  const at = me.location ?? config.seedCenter;
  useEffect(() => {
    const load = () => api<{ services: ServiceSummary[] }>(`/api/services?lat=${at.lat}&lng=${at.lng}`).then((r) => r.ok && setSummary(r.data.services));
    void load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [at.lat, at.lng]);

  // New request for me → sound + tab title.
  useEffect(() => {
    const fresh = dash.feed.filter((f) => !seen.current.has(f.request.id));
    if (fresh.length) { beep(); try { navigator.vibrate?.([250, 100, 250]); } catch { /* unsupported */ } }
    fresh.forEach((f) => seen.current.add(f.request.id));
    document.title = dash.feed.length ? `(${dash.feed.length}) New job nearby · ResQ` : "ResQ";
  }, [dash.feed]);

  // The request someone is reading was taken or closed meanwhile → close it and say so.
  useEffect(() => {
    if (open && !dash.feed.some((f) => f.request.id === open.request.id)) { setOpen(null); setToast("That request is no longer open: someone else took it or it was cancelled."); }
  }, [dash.feed, open]);

  // On a job: stream position every 3 s (simulated travel in demo mode) so the customer sees you coming.
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
    setToast(r.ok ? `Job accepted. ${f.request.requesterName ?? "The customer"} can now see your details and call you.`
      : r.data.reason === "already_matched" ? "Someone else already accepted this job." : r.data.reason === "busy" ? "Finish your current job first." : "Could not accept that job.");
    void reload();
  };
  const notNow = async (f: FeedItem) => { await api(`/api/requests/${f.request.id}/decline`, { method: "POST" }); setOpen(null); void reload(); };
  const done = async () => { if (dash.active) { await api(`/api/requests/${dash.active.request.id}`, { method: "PATCH", body: { action: "resolve" } }); setToast("Job marked as done. Collect payment from the customer."); void reload(); } };
  const signOut = async () => { await api("/api/auth/logout", { method: "POST", body: {} }); document.title = "ResQ"; onSignOut(); };

  return (
    <>
      <div className="bg-navy-gradient">
        <Container className="px-5 pb-6 pt-5 md:px-8">
          <div className="flex items-start justify-between gap-3">
            <button onClick={onProfile} className="flex items-center gap-3 text-left">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-resq-cyan to-resq-navy font-bold text-white">{initials(me.name)}</div>
              <div>
                <p className="text-sm text-white/60">Hello,</p>
                <h1 className="font-display text-xl font-bold text-white">{me.name}</h1>
                {isProvider && <div className="mt-1"><VerifiedBadge verified={isVerified(me)} pending={me.idProof?.status === "pending"} /></div>}
              </div>
            </button>
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 rounded-xl bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white"><PulsingDot color={connected ? "green" : "red"} />{connected ? "Live" : "…"}</span>
              <button onClick={onProfile} className="min-h-10 rounded-xl border border-white/20 px-3 text-xs font-semibold text-white">Profile</button>
              <button onClick={signOut} className="min-h-10 rounded-xl border border-white/20 px-3 text-xs font-semibold text-white">Sign out</button>
            </div>
          </div>
        </Container>
      </div>

      {dash.active ? (
        <JobMode active={dash.active} me={me} simulated={beacon.source !== "gps"} waiting={dash.hiddenWhileBusy} toast={toast} onDismissToast={() => setToast(null)} onDone={done} />
      ) : (
        <main className="mx-auto grid w-full max-w-6xl flex-1 content-start gap-5 px-4 py-5 md:px-8 lg:grid-cols-[1.25fr_1fr] lg:items-start">
          <div className="flex flex-col gap-4">
            {toast && <Toast text={toast} onClose={() => setToast(null)} />}
            {dash.myRequest && (
              <button onClick={() => onOpenRequest(dash.myRequest!.id)} className="card-shadow-lg animate-slide-up rounded-2xl border-2 border-resq-cyan bg-white p-5 text-left">
                <div className="flex items-center gap-2"><PulsingDot color="cyan" /><span className="text-xs font-bold uppercase tracking-wider text-resq-cyan">Your request</span>
                  <span className="ml-auto rounded-lg bg-slate-100 px-2 py-0.5 text-xs font-semibold text-resq-navy">{dash.myRequest.status === "matched" ? "Provider on the way" : "Finding a provider"}</span></div>
                <p className="mt-2 font-display text-lg font-bold text-resq-navy">{dash.myRequest.service ? SKILL_META[dash.myRequest.service].label : "Request"}</p>
                <p className="line-clamp-2 text-sm text-resq-slate">{dash.myRequest.description}</p>
                <p className="mt-2 text-sm font-semibold text-resq-cyan">View live status →</p>
              </button>
            )}
            <section>
              <h2 className="font-display text-xl font-bold text-resq-navy">What do you need help with?</h2>
              <p className="mb-3 text-sm text-resq-slate">Tap a service. Nearby providers get your request instantly.</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {SERVICES.map((s) => {
                  const m = SKILL_META[s], sum = summary?.find((x) => x.service === s);
                  return (
                    <button key={s} onClick={() => onService(s)} className="card-shadow flex min-h-28 flex-col items-start rounded-2xl border border-slate-100 bg-white p-4 text-left transition-transform active:scale-[.98]">
                      <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: m.bg, color: m.color }}>{m.icon}</div>
                      <p className="font-display font-bold text-resq-navy">{m.label}</p>
                      <p className="text-xs text-resq-slate">{sum ? (sum.count ? `${sum.count} nearby${sum.minRate !== null ? ` · ₹${sum.minRate}–₹${sum.maxRate}` : ""}` : "None nearby yet") : "…"}</p>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>

          <section className="flex flex-col gap-3">
            {isProvider ? (
              <>
                <button onClick={toggleAvailable} aria-pressed={me.onDuty}
                  className={`flex min-h-14 items-center justify-between rounded-2xl px-4 text-left ${me.onDuty ? "bg-resq-green text-white" : "border-2 border-slate-200 bg-white text-resq-navy"}`}>
                  <div><p className="font-display font-bold">{me.onDuty ? "Available for work" : "Not taking jobs"}</p>
                    <p className={`text-xs ${me.onDuty ? "text-white/80" : "text-resq-slate"}`}>{me.onDuty ? "Nearby requests for your services reach you" : me.availabilityPausedAt ? `Paused at ${fmtTime(me.availabilityPausedAt)} after you booked medical help · tap when you're free` : "Tap to receive requests"}</p></div>
                  <div className={`flex h-7 w-12 items-center rounded-full p-1 ${me.onDuty ? "justify-end bg-white/30" : "justify-start bg-slate-200"}`}><div className="h-5 w-5 rounded-full bg-white" /></div>
                </button>
                <BeaconChip paused={beacon.paused} ago={beacon.ago} source={beacon.source} onToggle={(p) => void beacon.setPaused(p)} />
                <div className="mt-2 flex items-end justify-between">
                  <div><h2 className="font-display text-lg font-bold text-resq-navy">Job requests for you</h2>
                    <p className="text-xs text-resq-slate">Within {dash.radiusKm} km for {me.skills.filter((s) => (SERVICES as readonly string[]).includes(s)).map((s) => SKILL_META[s].label).join(", ")}</p></div>
                  <Badge variant={dash.feed.length ? "emergency" : "default"}>{dash.feed.length}</Badge>
                </div>
                {dash.feed.map((f) => <JobCard key={f.request.id} f={f} onOpen={() => setOpen(f)} />)}
                {me.onDuty && dash.feed.length === 0 && (
                  <div className="card-shadow rounded-2xl border border-slate-100 bg-white p-6 text-center">
                    <Icon.Bell size={26} className="mx-auto text-resq-slate" />
                    <p className="mt-2 font-display font-semibold text-resq-navy">No job requests right now</p>
                    <p className="mt-1 text-sm text-resq-slate">Keep this open: new requests appear here instantly with a sound.</p>
                  </div>
                )}
                {!me.onDuty && (
                  <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    You&apos;re not taking jobs.{dash.hiddenWhileUnavailable ? ` ${dash.hiddenWhileUnavailable} request${dash.hiddenWhileUnavailable > 1 ? "s are" : " is"} waiting nearby.` : ""}
                    <button onClick={toggleAvailable} className="mt-3 min-h-12 w-full rounded-xl bg-resq-green font-semibold text-white">I&apos;m available for work</button>
                  </div>
                )}
              </>
            ) : (
              <div className="card-shadow rounded-2xl border border-slate-100 bg-gradient-to-br from-white to-resq-green-light p-5">
                <p className="font-display text-lg font-bold text-resq-navy">Earn from your skills</p>
                <p className="mt-1 text-sm text-resq-slate">Plumber, electrician, nurse, cleaner…? Set your price range, verify your ID and get job requests from neighbours.</p>
                <button onClick={onProfile} className="mt-3 min-h-12 w-full rounded-xl bg-resq-green font-semibold text-white">Start offering a service</button>
              </div>
            )}
          </section>
        </main>
      )}
      {open && <JobSheet f={open} me={me} onClose={() => setOpen(null)} onAccept={() => accept(open)} onDecline={() => notNow(open)} />}
    </>
  );
}

function Toast({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div className="animate-fade-in flex items-center gap-2 rounded-2xl bg-resq-navy px-4 py-3 text-sm font-semibold text-white">
      <Icon.Check size={16} />{text}<button onClick={onClose} aria-label="Dismiss" className="ml-auto flex h-9 w-9 items-center justify-center"><Icon.X size={16} /></button>
    </div>
  );
}

function JobCard({ f, onOpen }: { f: FeedItem; onOpen: () => void }) {
  const r = f.request;
  const m = r.service ? SKILL_META[r.service] : null;
  return (
    <button onClick={onOpen} className="card-shadow animate-slide-up w-full rounded-2xl border-2 border-slate-100 bg-white p-4 text-left transition-colors hover:bg-slate-50">
      <div className="flex items-center gap-2">
        {m && <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: m.bg, color: m.color }}>{m.icon}</span>}
        <span className="font-display font-bold text-resq-navy">{m?.label ?? "Job"}</span>
        <span className="ml-auto text-xs text-resq-slate">{fmtTime(r.createdAt)}</span>
      </div>
      <p className="mt-1.5 text-sm text-resq-navy"><strong>{r.requesterName ?? "A neighbour"}</strong> · {fmtDistance(f.distanceKm)} away</p>
      <p className="line-clamp-2 text-sm text-resq-slate">“{r.description}”</p>
      <p className="mt-2 text-xs text-resq-slate">Your rate: <strong className="text-resq-navy">{fmtRate(f.myRate)}</strong></p>
    </button>
  );
}

function JobSheet({ f, me, onClose, onAccept, onDecline }: { f: FeedItem; me: Helper; onClose: () => void; onAccept: () => void; onDecline: () => void }) {
  const r = f.request;
  const m = r.service ? SKILL_META[r.service] : null;
  const [busy, setBusy] = useState(false);
  const markers: MapMarker[] = [];
  if (r.location) markers.push({ id: "r", at: r.location, color: "#DC2626", kind: "target", label: "Job" });
  if (me.location) markers.push({ id: "me", at: me.location, color: "#16A34A", kind: "you", label: "You", pulse: false });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-resq-navy-dark/60 backdrop-blur-sm md:items-center" role="dialog" aria-modal="true" aria-labelledby="job-title" onClick={onClose}>
      <div className="animate-slide-up max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white shadow-2xl md:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="bg-navy-gradient px-5 py-4 text-white">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-white/60">New job request</p>
              <h2 id="job-title" className="mt-1 font-display text-2xl font-bold">{m?.label ?? "Job"}</h2>
              <p className="text-sm text-white/80">{fmtDistance(f.distanceKm)} from you · {fmtTime(r.createdAt)}</p>
            </div>
            <button onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/15"><Icon.X size={18} /></button>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-resq-navy">“{r.description}”</p>
          <PersonDetails r={r} />
          <p className="rounded-xl bg-resq-green-light p-3 text-sm text-resq-navy">Your listed rate for this service: <strong>{fmtRate(f.myRate)}</strong></p>
          {r.location && <div className="overflow-hidden rounded-2xl"><LiveMap center={r.location} radiusKm={Math.max(0.4, (f.distanceKm ?? 0.5) * 1.4)} markers={markers} height={170} route={me.location ? [me.location, r.location] : undefined} /></div>}
          <p className="text-xs text-resq-slate">If you accept, {r.requesterName ?? "the customer"} sees your name, phone, rating and price range, and you&apos;re guided to their location.</p>
          <div className="grid grid-cols-2 gap-3">
            <button disabled={busy} onClick={() => { setBusy(true); onAccept(); }} className="flex min-h-16 flex-col items-center justify-center rounded-2xl bg-success-gradient font-display text-lg font-bold text-white shadow-lg disabled:opacity-60"><Icon.Check size={22} />Accept job</button>
            <button disabled={busy} onClick={() => { setBusy(true); onDecline(); }} className="flex min-h-16 flex-col items-center justify-center rounded-2xl border-2 border-slate-200 font-display text-lg font-bold text-resq-slate disabled:opacity-60"><Icon.X size={22} />Not now</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// On a job: only the customer's details; other requests wait in a locked tab until "Mark as done".
function JobMode({ active, me, simulated, waiting, toast, onDismissToast, onDone }: {
  active: NonNullable<Dashboard["active"]>; me: Helper; simulated: boolean; waiting: number; toast: string | null; onDismissToast: () => void; onDone: () => void;
}) {
  const [tab, setTab] = useState<"job" | "others">("job");
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4 md:px-8">
      <div role="tablist" aria-label="Your work" className="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/70 p-1">
        <button role="tab" aria-selected={tab === "job"} onClick={() => setTab("job")} className={`min-h-12 rounded-xl text-sm font-semibold ${tab === "job" ? "bg-white text-resq-navy shadow" : "text-resq-slate"}`}>Current job</button>
        <button role="tab" aria-selected={tab === "others"} onClick={() => setTab("others")} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold ${tab === "others" ? "bg-white text-resq-navy shadow" : "text-resq-slate"}`}>
          Other requests<span className="rounded-full bg-slate-300/80 px-2 py-0.5 text-xs text-resq-navy">{waiting}</span>
        </button>
      </div>
      {toast && <div className="mb-4"><Toast text={toast} onClose={onDismissToast} /></div>}
      {tab === "job" ? (
        <ActiveJob r={active.request} mapsUrl={active.mapsUrl} me={me.location} simulated={simulated} onDone={onDone} />
      ) : (
        <section className="card-shadow rounded-2xl border border-slate-100 bg-white p-6 text-center">
          <Icon.Clock size={26} className="mx-auto text-resq-slate" />
          <p className="mt-2 font-display text-lg font-bold text-resq-navy">Finish your current job first</p>
          <p className="mt-1 text-sm text-resq-slate">{waiting > 0 ? `${waiting} request${waiting > 1 ? "s" : ""} for your services ${waiting > 1 ? "are" : "is"} waiting nearby. ` : ""}They appear here as soon as you tap <strong>Mark as done</strong>.</p>
          <button onClick={() => setTab("job")} className="mt-4 min-h-12 w-full rounded-xl bg-resq-navy font-semibold text-white">Back to {active.request.requesterName ?? "the customer"}</button>
        </section>
      )}
    </main>
  );
}

// ─── Describe the problem (after tapping a service) ─────────────────────────────────────────────────────────

function Describe({ service, me, center, onBack, onCreated }: { service: Service; me: Helper; center: LatLng; onBack: () => void; onCreated: (id: string) => void }) {
  const m = SKILL_META[service];
  const [text, setText] = useState("");
  const [loc, setLoc] = useState<{ at: LatLng; source: "gps" | "demo" } | null>(null);
  const [providers, setProviders] = useState<ProviderPreview[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const speech = useSpeech({ onText: setText, onFinal: setText, onError: (e) => setVoiceErr(speechErrorText(e)) });
  useEffect(() => { void whereAmI(center).then(setLoc); }, [center]);
  useEffect(() => {
    if (!loc) return;
    void api<{ providers: ProviderPreview[] }>(`/api/services?service=${service}&lat=${loc.at.lat}&lng=${loc.at.lng}`).then((r) => r.ok && setProviders(r.data.providers.filter((p) => p.id !== me.id)));
  }, [loc, service, me.id]);

  const submit = async () => {
    if (text.trim().length < 5) { setError("Please describe the problem in a few words."); return; }
    setBusy(true); setError(null);
    const r = await api<RequestView>("/api/requests", { body: { service, description: text.trim(), location: loc?.at ?? me.location ?? null } });
    setBusy(false);
    if (r.ok) onCreated(r.data.request.id); else setError(`Could not send the request (${r.error.replace(/_/g, " ")}).`);
  };
  const rates = (providers ?? []).map((p) => p.rate).filter((r): r is RateRange => !!r);
  return (
    <>
      <div className="bg-navy-gradient">
        <Container><NavBar title={`Book a ${m.label.toLowerCase()}`} onBack={onBack} light /></Container>
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 pb-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: m.bg, color: m.color }}>{m.icon}</div>
          <p className="text-sm text-white/80">{providers === null ? "Checking who's nearby…" : providers.length ? `${providers.length} ${m.label.toLowerCase()}${providers.length > 1 ? "s" : ""} nearby${rates.length ? ` · usually ₹${Math.min(...rates.map((r) => r.min))}–₹${Math.max(...rates.map((r) => r.max))}` : ""}` : `No ${m.label.toLowerCase()} online nearby right now. You can still post; it stays open.`}</p>
        </div>
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-5">
        <label htmlFor="what" className="mb-1.5 block font-display text-lg font-bold text-resq-navy">Describe the problem</label>
        <div className="flex items-start gap-3">
          <textarea id="what" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={4} autoFocus
            placeholder={service === "plumber" ? "e.g. Kitchen sink pipe is leaking and water is spreading on the floor" : service === "doctor" ? "e.g. Fever since yesterday, need a home visit" : "What needs to be done, and anything they should bring"}
            className="card-shadow min-h-32 flex-1 rounded-2xl border border-slate-200 bg-white p-4 text-base text-resq-navy outline-none focus:ring-2 focus:ring-resq-red/30" />
          {speech.supported && <VoiceMic listening={speech.listening} onToggle={() => { setVoiceErr(null); speech.toggle(); }} />}
        </div>
        {speech.supported && <p className="mt-1 text-xs text-resq-slate">{speech.listening ? "Listening… speak now" : voiceErr ?? "Tap the mic to speak instead of typing."}</p>}

        {providers && providers.length > 0 && (
          <section className="mt-5">
            <h3 className="mb-2 font-display font-semibold text-resq-navy">Who will get your request</h3>
            <ul className="space-y-2">
              {providers.slice(0, 5).map((p) => (
                <li key={p.id} className="card-shadow flex items-center gap-3 rounded-xl bg-white p-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: m.color }}>{initials(p.name)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-resq-navy">{p.name}<Stars rating={p.rating} /><VerifiedBadge verified={p.verified} /></p>
                    <p className="text-xs text-resq-slate">{fmtDistance(p.distanceKm)} away · {fmtRate(p.rate)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="mt-4 flex items-center gap-1 text-xs text-resq-slate"><Icon.MapPin size={12} />{loc ? (loc.source === "gps" ? "Using your GPS location" : "Demo location near TKMCE (this device's GPS isn't in the demo area)") : "Getting your location…"}. Shared only with the provider who accepts.</p>
        {MEDICAL_SERVICES.includes(service) && <p className="mt-2 rounded-xl bg-resq-red-light p-3 text-xs text-resq-red-dark">For a medical emergency, don&apos;t wait: <a href="tel:112" className="font-bold underline">call 112</a>.</p>}
        {error && <p role="alert" className="mt-3 rounded-xl bg-resq-red-light p-3 text-sm font-medium text-resq-red">{error}</p>}
        <button onClick={submit} disabled={busy || text.trim().length < 5}
          className={`mt-4 min-h-16 w-full rounded-2xl font-display text-xl font-bold ${text.trim().length >= 5 ? "bg-resq-red text-white shadow-lg" : "cursor-not-allowed bg-slate-200 text-slate-400"}`}>
          {busy ? "Sending…" : `Request a ${m.label.toLowerCase()}`}
        </button>
      </main>
    </>
  );
}

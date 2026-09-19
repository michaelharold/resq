"use client";
/* Requester app: home → report (text / hold-to-speak) → live request (triage, guidance, dispatch, match). */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoginSheet } from "@/components/OtpForm";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, BottomNav, Call112Bar, Container, Countdown, ETABadge, Logo, NavBar, PhoneShell, ProgressBar, PulsingDot, TopNav, TypingDots, initials } from "@/components/ui";
import { EMERGENCY_TILES, SKILL_META, SkillPill, URGENCY_STYLE } from "@/components/skills";
import { LiveMap, type MapMarker } from "@/components/LiveMap";
import { DEMO_RADIUS_KM, api, distanceKm, getHelperToken, setHelperToken, etaMinutes, fmtDistance, fmtTime, getPosition, getUid, windowStore, type LatLng } from "@/lib/client/api";
import { useSecondsLeft, useSnapshot } from "@/lib/client/sse";
import { useSpeech } from "@/lib/client/speech";
import { TYPE_LABELS } from "@/lib/taxonomy";
import type { RequestView, RequesterRole, Skill } from "@/lib/types";

type Config = { seedCenter: LatLng; waveWindowMs: number; smsSimulated: boolean; smsNumber: string | null; landmarks: { name: string; location: LatLng }[] };
type Nearby = { center: LatLng; area: string | null; count: number; helpers: { skills: Skill[]; distanceKm: number; at: LatLng }[] };
type Loc = { at: LatLng; source: "gps" | "demo"; label: string };
const ACTIVE_KEY = "resq_active_request";

export default function RequesterApp() {
  const [view, setView] = useState<"home" | "report" | "request">("home");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loc, setLoc] = useState<Loc | null>(null);
  const [welcome, setWelcome] = useState(false);

  useEffect(() => {
    void api<Config>("/api/config").then((r) => r.ok && setConfig(r.data));
    void fetch("/api/triage").catch(() => undefined); // warm the model so the first triage is fast
    const id = windowStore.get(ACTIVE_KEY);
    if (id) { setRequestId(id); setView("request"); }
    else if (!windowStore.get("resq_welcomed")) setWelcome(true);
  }, []);

  // GPS when it is plausibly at the venue; otherwise (e.g. a laptop elsewhere) a demo spot at the seed centre.
  useEffect(() => {
    if (!config) return;
    const saved = windowStore.get("resq_loc");
    if (saved) { try { setLoc(JSON.parse(saved) as Loc); return; } catch { /* ignore */ } }
    void getPosition().then((p) => {
      if (p && distanceKm(p, config.seedCenter) <= DEMO_RADIUS_KM) setLoc({ at: p, source: "gps", label: "Your GPS location" });
      else setLoc({ at: config.seedCenter, source: "demo", label: "Demo: TKMCE campus" });
    });
  }, [config]);
  const chooseLoc = (l: Loc) => { setLoc(l); windowStore.set("resq_loc", JSON.stringify(l)); };

  const openRequest = (id: string) => {
    windowStore.set(ACTIVE_KEY, id);
    setRequestId(id);
    setView("request");
  };
  const closeRequest = () => {
    windowStore.set(ACTIVE_KEY, null);
    setRequestId(null);
    setView("home");
  };
  if (welcome) return <Welcome onClose={() => { windowStore.set("resq_welcomed", "1"); setWelcome(false); }} />;

  return (
    <PhoneShell>
      {view === "home" && <Home loc={loc} config={config} onRequest={() => setView("report")} />}
      {view === "report" && <Report loc={loc} config={config} onChooseLoc={chooseLoc} onBack={() => setView("home")} onCreated={openRequest} />}
      {view === "request" && requestId && <RequestScreen id={requestId} config={config} onClose={closeRequest} onRetry={openRequest} />}
    </PhoneShell>
  );
}

// ─── Home ──────────────────────────────────────────────────────────────────────────────────────────────────

function Home({ loc, config, onRequest }: { loc: Loc | null; config: Config | null; onRequest: () => void }) {
  const [nearby, setNearby] = useState<Nearby | null>(null);
  const router = useRouter();
  // Only "Request help", 112 and SMS work signed out; every other option asks the user to sign in first.
  const [signedIn, setSignedIn] = useState(false);
  const [sheet, setSheet] = useState<{ reason: string; then: () => void } | null>(null);
  useEffect(() => { setSignedIn(!!getHelperToken()); }, []);
  const gate = (reason: string, then: () => void) => (getHelperToken() ? then() : setSheet({ reason, then }));
  const toHelper = () => gate("Helpers sign in with their phone so neighbours know who is coming.", () => router.push("/helper"));
  const signOut = async () => { await api("/api/auth/logout", { method: "POST", body: {} }); setHelperToken(null); setSignedIn(false); };
  useEffect(() => {
    if (!loc) return;
    const load = () => api<Nearby>(`/api/helpers/nearby?lat=${loc.at.lat}&lng=${loc.at.lng}`).then((r) => r.ok && setNearby(r.data));
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [loc]);

  const share = () => gate("Sign in to share your location.", () => void doShare());
  const doShare = async () => {
    if (!loc) return;
    const url = `https://maps.google.com/?q=${loc.at.lat.toFixed(6)},${loc.at.lng.toFixed(6)}`;
    try {
      if (navigator.share) await navigator.share({ title: "My location", text: "I need help. My location:", url });
      else { await navigator.clipboard.writeText(url); alert("Location link copied"); }
    } catch { /* cancelled */ }
  };
  const smsHref = config?.smsNumber ? `sms:${config.smsNumber}?body=${encodeURIComponent("HELP ")}` : null;
  const markers: MapMarker[] = [
    ...(nearby?.helpers ?? []).map((h, i) => ({ id: `h${i}`, at: h.at, color: SKILL_META[h.skills[0]].color, kind: "helper" as const, label: SKILL_META[h.skills[0]].label })),
    ...(loc ? [{ id: "you", at: loc.at, color: "#DC2626", kind: "you" as const, label: "You" }] : []),
  ];

  return (
    <>
      <div className="bg-navy-gradient">
        <Container className="px-5 pb-8 pt-5 md:px-8 lg:grid lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-10 lg:pb-14 lg:pt-8">
          <div>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-resq-red"><Logo size={22} /></div>
                <h1 className="font-display text-2xl font-bold text-white">ResQ</h1>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <PulsingDot color="green" />
                <span className="text-xs font-medium text-white/70">
                  Live coverage{nearby?.area ? ` · ${nearby.area}` : ""}{loc?.source === "demo" ? " · demo location" : ""}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {signedIn ? (
                <button onClick={signOut} className="flex min-h-12 items-center gap-1.5 rounded-xl border border-white/20 px-3 text-xs font-semibold text-white">
                  <Icon.User size={14} />Sign out
                </button>
              ) : (
                <button onClick={() => gate("Sign in to use helper features and share your location.", () => undefined)}
                  className="flex min-h-12 items-center gap-1.5 rounded-xl border border-white/20 px-3 text-xs font-semibold text-white">
                  <Icon.User size={14} />Sign in
                </button>
              )}
              <TopNav active="home" guard={toHelper} />
            </div>
          </div>
          <p className="mt-6 hidden max-w-md font-display text-4xl font-bold leading-tight text-white lg:block">Help is closer than you think.</p>
          <p className="mt-3 hidden max-w-md text-white/60 lg:block">Skilled neighbours (doctors, nurses, swimmers, boat owners, 4×4 drivers) dispatched in seconds. ResQ complements 112.</p>
          </div>
          <div className="relative mt-5 overflow-hidden rounded-2xl lg:mt-0">
            {loc ? <LiveMap center={loc.at} radiusKm={2.2} rings={[1, 2]} markers={markers} height={160} className="md:!h-[260px] lg:!h-[320px]" />
              : <div className="flex h-40 items-center justify-center rounded-2xl bg-white/10 text-sm text-white/60">Finding your location…</div>}
            {nearby && (
              <div className="absolute right-3 top-3 rounded-xl border border-slate-100 bg-white px-2.5 py-1 shadow">
                <span className="text-xs font-bold text-resq-navy">{nearby.count} helpers within 5 km</span>
              </div>
            )}
          </div>
        </Container>
      </div>

      <Container className="relative z-10 -mt-5 flex-1 px-5 pb-4 md:grid md:grid-cols-2 md:items-start md:gap-x-5 md:px-8 lg:-mt-8 lg:grid-cols-3">
        <button onClick={onRequest} className="mb-3 flex w-full md:mb-4 items-center justify-between rounded-2xl bg-emergency-gradient p-5 text-left text-white shadow-lg transition-transform active:scale-[.99]"
          style={{ boxShadow: "0 8px 32px rgba(220,38,38,.3)" }}>
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-white/70">Need help?</p>
            <p className="font-display text-2xl font-bold">REQUEST HELP</p>
            <p className="mt-1 text-sm text-white/80">Voice or text. AI finds the right neighbours.</p>
          </div>
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/15"><Icon.AlertTriangle size={30} /></div>
        </button>

        <button onClick={toHelper} className="card-shadow mb-4 flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left transition-transform active:scale-[.99]">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-resq-slate">Community helper</p>
            <p className="font-display text-xl font-bold text-resq-navy">I CAN HELP</p>
            <p className="mt-1 text-sm text-resq-slate">Offer your skills and go on duty</p>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-resq-green-light"><Icon.Shield size={28} className="text-resq-green" /></div>
        </button>

        <div className="mb-4 grid grid-cols-3 gap-3 md:col-span-2 lg:col-span-1">
          <a href="tel:112" className="card-shadow flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-white p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-resq-red-light"><Icon.Phone size={20} className="text-resq-red" /></div>
            <div className="text-center"><p className="text-sm font-semibold leading-none text-resq-navy">112</p><p className="mt-0.5 text-xs text-resq-slate">Emergency</p></div>
          </a>
          <button onClick={share} className="card-shadow flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-white p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100"><Icon.MapPin size={20} className="text-resq-navy" /></div>
            <div className="text-center"><p className="text-sm font-semibold leading-none text-resq-navy">Share</p><p className="mt-0.5 text-xs text-resq-slate">Location</p></div>
          </button>
          {smsHref ? (
            <a href={smsHref} className="card-shadow flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-white p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50"><Icon.Radio size={20} className="text-amber-600" /></div>
              <div className="text-center"><p className="text-sm font-semibold leading-none text-resq-navy">SMS</p><p className="mt-0.5 text-xs text-resq-slate">No data</p></div>
            </a>
          ) : (
            <div className="card-shadow flex flex-col items-center gap-2 rounded-2xl border border-slate-100 bg-white p-4 opacity-70">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50"><Icon.Radio size={20} className="text-amber-600" /></div>
              <div className="text-center"><p className="text-sm font-semibold leading-none text-resq-navy">SMS</p><p className="mt-0.5 text-xs text-resq-slate">Demo mode</p></div>
            </div>
          )}
        </div>

        <section className="card-shadow mb-4 rounded-2xl border border-slate-100 bg-white p-4 md:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-display font-semibold text-resq-navy">Helpers nearby</h2>
            <Badge variant="success">{nearby?.count ?? 0} on duty</Badge>
          </div>
          {nearby && nearby.helpers.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-1">
              {nearby.helpers.slice(0, 12).map((h, i) => {
                const m = SKILL_META[h.skills[0]];
                return (
                  <div key={i} className="flex w-16 flex-shrink-0 flex-col items-center gap-1.5">
                    <div className="relative">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-md" style={{ background: m.color }}>{m.icon}</div>
                      <div className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white bg-resq-green" />
                    </div>
                    <p className="text-center text-xs font-medium leading-tight text-resq-navy">{m.label}</p>
                    <p className="text-xs text-resq-slate">{fmtDistance(h.distanceKm)}</p>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-sm text-resq-slate">No helpers on duty near you right now. Call 112.</p>}
        </section>

        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-3.5 md:col-span-2 lg:col-span-1">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-amber-100"><Icon.Radio size={15} className="text-amber-700" /></div>
          <p className="text-xs leading-snug text-amber-800">
            <strong>No mobile data?</strong> Text <strong>HELP</strong> followed by what happened and where
            {config?.smsNumber ? <> to <strong>{config.smsNumber}</strong></> : null}, e.g. “HELP trapped near TKMCE hostel”.
          </p>
        </div>
      </Container>
      <Call112Bar />
      <BottomNav active="home" guard={toHelper} />
      {sheet && (
        <LoginSheet reason={sheet.reason} onClose={() => setSheet(null)}
          onDone={() => { const next = sheet.then; setSheet(null); setSignedIn(true); next(); }} />
      )}
    </>
  );
}

// ─── Report ────────────────────────────────────────────────────────────────────────────────────────────────

function Report({ loc, config, onChooseLoc, onBack, onCreated }: { loc: Loc | null; config: Config | null; onChooseLoc: (l: Loc) => void; onBack: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(() => windowStore.get("resq_name") ?? "");
  const [phone, setPhone] = useState(() => windowStore.get("resq_phone") ?? "");
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [tile, setTile] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [role, setRole] = useState<RequesterRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recSec, setRecSec] = useState(0);
  const speech = useSpeech(setText);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    if (!speech.listening) { setRecSec(0); return; }
    const t = setInterval(() => setRecSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [speech.listening]);

  const submit = useCallback(async (override?: string) => {
    const t = EMERGENCY_TILES.find((x) => x.id === tile);
    const body = (override ?? textRef.current).trim();
    const description = [t && !body.toLowerCase().includes(t.label.toLowerCase()) ? t.hint : "", body || (t ? t.sub : "")].filter(Boolean).join(" ").trim();
    if (!description) { setError("Tell us what is happening, or pick a type."); return; }
    setBusy(true);
    setError(null);
    windowStore.set("resq_name", name.trim() || null);
    windowStore.set("resq_phone", phone.trim() || null);
    const pos = loc?.at ?? null;
    const r = await api<RequestView>("/api/requests", {
      body: { description, location: pos, ...(role ? { role } : {}), ...(name.trim() ? { name: name.trim() } : {}), ...(phone.trim() ? { phone: phone.trim() } : {}) },
      headers: { "x-resq-uid": getUid() },
    });
    setBusy(false);
    if (r.ok) onCreated(r.data.request.id);
    else setError(r.status === 0 ? "No connection. Text HELP to the ResQ number, or call 112." : `Could not send (${r.error}). Call 112.`);
  }, [tile, role, loc, onCreated, name, phone]);

  const stopAndSend = () => {
    speech.stop();
    setTimeout(() => { if (textRef.current.trim()) void submit(); }, 400);
  };

  if (busy) return <Triaging text={text || EMERGENCY_TILES.find((x) => x.id === tile)?.sub || ""} />;

  return (
    <>
      <div className="bg-emergency-gradient">
        <Container><NavBar title="Report emergency" onBack={onBack} light /></Container>
        <Container className="max-w-3xl px-5 pb-5">
          <p className="text-sm text-white/85">Say or type what is happening. AI works out the help you need and pings the 3 best-placed neighbours at once.</p>
          <div className="mt-4 flex gap-2 rounded-2xl bg-white/10 p-1">
            {(["text", "voice"] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)}
                className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all ${mode === m ? "bg-white text-resq-red shadow" : "text-white"}`}>
                {m === "voice" ? <Icon.Mic size={15} /> : <Icon.MessageSquare size={15} />}
                {m === "voice" ? "Hold to speak" : "Type / select"}
              </button>
            ))}
          </div>
        </Container>
      </div>

      <main className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-5 py-4">
        {mode === "voice" && (
          <div className="flex flex-col items-center gap-5 py-4">
            {speech.supported ? (
              <>
                <p className="text-center font-semibold text-resq-navy">Hold the button and speak clearly</p>
                <button
                  onPointerDown={(e) => { e.preventDefault(); speech.start(); }}
                  onPointerUp={stopAndSend} onPointerLeave={() => speech.listening && stopAndSend()}
                  className={`flex h-32 w-32 touch-none select-none flex-col items-center justify-center gap-2 rounded-full shadow-2xl transition-all ${speech.listening ? "scale-110 bg-resq-red" : "bg-resq-navy"}`}
                  style={{ boxShadow: speech.listening ? "0 0 60px rgba(220,38,38,.5)" : "0 16px 48px rgba(30,58,95,.4)" }}>
                  <Icon.Mic size={40} className="text-white" />
                  <span className="text-xs font-semibold text-white">{speech.listening ? `${recSec}s · release to send` : "Hold to speak"}</span>
                </button>
                {speech.listening && (
                  <div className="flex h-8 items-end gap-1">
                    {[4, 7, 5, 9, 6, 8, 4, 6, 9, 5, 7, 4].map((h, i) => (
                      <div key={i} className="animate-dispatch-pulse w-1.5 rounded-full bg-resq-red" style={{ height: h * 3, animationDelay: `${i * 0.08}s` }} />
                    ))}
                  </div>
                )}
                {text && <p className="w-full rounded-2xl border border-slate-100 bg-white p-4 text-sm text-resq-navy card-shadow">“{text}”</p>}
              </>
            ) : (
              <p className="rounded-2xl bg-white p-4 text-center text-sm text-resq-slate card-shadow">Voice input is not available in this browser. Please type instead.</p>
            )}
          </div>
        )}

        {mode === "text" && (
          <>
            <p className="mb-3 text-xs font-medium text-resq-slate">Pick a type (optional), then describe it</p>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {EMERGENCY_TILES.map((t) => (
                <button key={t.id} onClick={() => setTile(tile === t.id ? null : t.id)} aria-pressed={tile === t.id}
                  className={`card-shadow rounded-2xl border-2 bg-white p-3.5 text-left transition-all ${tile === t.id ? "border-resq-red shadow-lg" : "border-slate-100"}`}>
                  <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-2xl" style={{ background: t.bg, color: t.color }}>{t.icon}</div>
                  <p className="font-display text-sm font-bold leading-tight text-resq-navy">{t.label}</p>
                  <p className="mt-0.5 text-xs leading-tight text-resq-slate">{t.sub}</p>
                </button>
              ))}
            </div>
            <label htmlFor="desc" className="mb-1.5 block text-sm font-semibold text-resq-navy">What is happening, and where?</label>
            <textarea id="desc" value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} rows={4}
              placeholder="e.g. Water is rising, my grandmother can't walk, ground floor, near Kadappakada"
              className="card-shadow w-full rounded-2xl border border-slate-200 bg-white p-4 text-base text-resq-navy outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-resq-red/30" />
          </>
        )}

        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-resq-navy">Who needs help?</p>
          <div className="grid grid-cols-2 gap-2">
            {([["self", "It's me"], ["other", "Someone else"]] as const).map(([v, label]) => (
              <button key={v} onClick={() => setRole(role === v ? null : v)} aria-pressed={role === v}
                className={`min-h-12 rounded-xl border-2 text-sm font-semibold ${role === v ? "border-resq-navy bg-resq-navy text-white" : "border-slate-200 bg-white text-resq-navy"}`}>
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-resq-slate">Changes what we tell you to do while help comes. Leave blank and we will guess.</p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="rname" className="mb-1.5 block text-sm font-semibold text-resq-navy">Your name <span className="font-normal text-resq-slate">(optional)</span></label>
            <input id="rname" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name"
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base outline-none focus:ring-2 focus:ring-resq-red/30" />
          </div>
          <div>
            <label htmlFor="rphone" className="mb-1.5 block text-sm font-semibold text-resq-navy">Phone <span className="font-normal text-resq-slate">(optional)</span></label>
            <input id="rphone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="So the helper can call you"
              className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base outline-none focus:ring-2 focus:ring-resq-red/30" />
          </div>
        </div>
        <p className="mt-1.5 text-xs text-resq-slate">Shared only with the helper who accepts. No account needed.</p>

        <label htmlFor="rloc" className="mb-1.5 mt-4 flex items-center gap-1.5 text-sm font-semibold text-resq-navy"><Icon.MapPin size={14} />Where are you?</label>
        <select id="rloc" value={loc?.label ?? ""} onChange={(e) => {
            const v = e.target.value;
            if (v === "__gps") { void getPosition().then((p) => p && onChooseLoc({ at: p, source: "gps", label: "Your GPS location" })); return; }
            const lm = config?.landmarks.find((l) => `Demo: ${l.name}` === v);
            if (v === "Demo: TKMCE campus" && config) onChooseLoc({ at: config.seedCenter, source: "demo", label: v });
            else if (lm) onChooseLoc({ at: lm.location, source: "demo", label: v });
          }}
          className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-base text-resq-navy">
          {loc?.source === "gps" && <option value="Your GPS location">Your GPS location</option>}
          <option value="__gps">Use my GPS</option>
          <option value="Demo: TKMCE campus">Demo: TKMCE campus</option>
          {config?.landmarks.map((l) => <option key={l.name} value={`Demo: ${l.name}`}>Demo: {l.name}</option>)}
        </select>
        <p className="mt-1.5 text-xs text-resq-slate">{loc?.source === "gps" ? "Your exact location goes only to the helper who accepts." : "Demo location, used because this device's GPS is not near the demo area."}</p>
        {error && <p role="alert" className="mt-3 rounded-xl bg-resq-red-light p-3 text-sm font-medium text-resq-red">{error}</p>}
        <button onClick={() => void submit()} disabled={!text.trim() && !tile}
          className={`mt-4 min-h-14 w-full rounded-2xl font-display text-lg font-bold transition-all ${text.trim() || tile ? "bg-resq-red text-white shadow-lg" : "cursor-not-allowed bg-slate-200 text-slate-400"}`}>
          {text.trim() || tile ? "Get help now" : "Describe or pick a type"}
        </button>
      </main>
      <Call112Bar />
    </>
  );
}

function Triaging({ text }: { text: string }) {
  return (
    <>
      <div className="bg-ai-gradient px-5 pb-5 pt-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/20"><Icon.Activity size={20} className="text-white" /></div>
          <div><p className="text-sm font-semibold text-white">ResQ AI · on-device</p><p className="text-xs text-white/75">Understanding your emergency…</p></div>
        </div>
      </div>
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-5">
        {text && <div className="flex justify-end"><div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-resq-navy px-4 py-3 text-sm text-white">{text}</div></div>}
        <div className="flex items-start gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-ai-gradient"><Icon.Activity size={14} className="text-white" /></div>
          <div className="card-shadow rounded-2xl rounded-tl-sm border border-slate-100 bg-white px-5 py-4"><TypingDots /></div>
        </div>
      </main>
      <Call112Bar />
    </>
  );
}

// ─── Live request ──────────────────────────────────────────────────────────────────────────────────────────

function RequestScreen({ id, config, onClose, onRetry }: { id: string; config: Config | null; onClose: () => void; onRetry: (id: string) => void }) {
  const uid = typeof window === "undefined" ? "" : getUid();
  const { data: view, connected, setData } = useSnapshot<RequestView>(`/api/requests/${id}/stream?uid=${encodeURIComponent(uid)}`, `/api/requests/${id}`, { "x-resq-uid": uid });
  const left = useSecondsLeft(view?.waveEndsAt);
  const ticking = useRef(0);
  const [notFound, setNotFound] = useState(false);

  const tick = useCallback(async () => {
    if (Date.now() - ticking.current < 2000) return;
    ticking.current = Date.now();
    const r = await api<RequestView & { advanced: boolean }>(`/api/requests/${id}/tick`, { method: "POST", headers: { "x-resq-uid": getUid() } });
    if (r.ok) setData(r.data);
    else if (r.status === 404 || r.status === 403) setNotFound(true);
  }, [id, setData]);

  useEffect(() => { void tick(); }, [tick]);
  useEffect(() => { if (view?.request.status === "searching" && view.waveEndsAt && left === 0) void tick(); }, [left, view, tick]);

  const patch = async (body: Record<string, unknown>) => {
    const r = await api<RequestView>(`/api/requests/${id}`, { method: "PATCH", body, headers: { "x-resq-uid": getUid() } });
    if (r.ok) setData(r.data);
  };
  const retry = async () => {
    if (!view) return;
    const r = await api<RequestView>("/api/requests", { body: { description: view.request.description, location: view.request.location, role: view.request.role }, headers: { "x-resq-uid": getUid() } });
    if (r.ok) onRetry(r.data.request.id);
  };

  if (notFound) return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-resq-navy">This request is no longer available.</p>
      <button onClick={onClose} className="min-h-12 rounded-xl bg-resq-navy px-6 font-semibold text-white">Back to home</button>
    </main>
  );
  if (!view) return <Triaging text="" />;

  const r = view.request;
  const t = r.triage;
  const windowS = Math.round((config?.waveWindowMs ?? 30000) / 1000);
  const header = {
    triaging: { bg: "bg-ai-gradient", title: "Understanding your emergency", sub: "ResQ AI is classifying your request" },
    searching: { bg: "bg-navy-gradient", title: "Finding help", sub: `Wave ${r.wave} of 4 · pinging the best helpers within ${r.radiusKm} km` },
    matched: { bg: "bg-success-gradient", title: "Help is on the way", sub: view.matchedHelper ? `${view.matchedHelper.name} accepted your request` : "A helper accepted" },
    resolved: { bg: "bg-success-gradient", title: "Marked as resolved", sub: "We hope everyone is safe" },
    escalated: { bg: "bg-emergency-gradient", title: "Call 112 now", sub: "No neighbour could be reached. A coordinator has been alerted." },
    cancelled: { bg: "bg-navy-gradient", title: "Request cancelled", sub: "Helpers have been stood down" },
  }[r.status];

  return (
    <>
      <div className={header.bg}>
        <Container><NavBar title="Your request" onBack={onClose} light action={
          <span className="flex items-center gap-1.5 rounded-xl bg-white/15 px-2.5 py-1.5 text-xs font-semibold text-white">
            <PulsingDot color={connected ? "green" : "red"} />{connected ? "LIVE" : "…"}
          </span>} /></Container>
        <div className="px-5 pb-6 text-center">
          {r.status === "matched" && <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-3xl bg-white/20"><Icon.Check size={34} className="text-white" /></div>}
          <h2 className="font-display text-2xl font-bold text-white">{header.title}</h2>
          <p className="mt-1 text-sm text-white/80">{header.sub}</p>
        </div>
      </div>

      <main className="relative z-10 mx-auto -mt-3 grid w-full max-w-6xl flex-1 content-start gap-4 px-4 pb-6 md:px-8 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-4">
        {r.status === "escalated" && (
          <div className="card-shadow-lg rounded-2xl border-2 border-resq-red bg-white p-5 text-center">
            <p className="font-display text-lg font-bold text-resq-red">No helper could be reached.</p>
            <p className="mt-1 text-sm text-resq-slate">{r.location ? "We tried 4 waves up to 8 km." : "We could not get your location."} Please call emergency services.</p>
            <a href="tel:112" className="mt-4 flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-resq-red font-display text-lg font-bold text-white"><Icon.Phone size={20} />Call 112</a>
            <button onClick={retry} className="mt-3 min-h-12 w-full rounded-2xl border border-slate-200 font-semibold text-resq-navy">Try again</button>
          </div>
        )}

        {r.status === "searching" && <DispatchCard view={view} left={left} windowS={windowS} />}
        {(r.status === "matched" || r.status === "resolved") && view.matchedHelper && <MatchedCard view={view} />}
        {r.status === "resolved" && <RateCard onRate={(stars) => patch({ action: "rate", stars })} />}
        {t && <TriageCard view={view} />}
        </div>
        <div className="flex flex-col gap-4">
        {view.guidance && <GuidanceCard view={view} />}
        <Timeline view={view} />

        {(r.status === "searching" || r.status === "matched" || r.status === "escalated") && (
          <button onClick={() => { if (confirm("Cancel this request? Helpers will be stood down.")) void patch({ action: "cancel" }); }}
            className="min-h-12 w-full rounded-2xl border border-slate-200 bg-slate-100 text-sm font-semibold text-resq-slate">Cancel request</button>
        )}
        {(r.status === "resolved" || r.status === "cancelled") && (
          <button onClick={onClose} className="min-h-12 w-full rounded-2xl bg-resq-navy font-semibold text-white">Back to home</button>
        )}
        </div>
      </main>
      <Call112Bar />
    </>
  );
}

function DispatchCard({ view, left, windowS }: { view: RequestView; left: number; windowS: number }) {
  const r = view.request;
  const current = view.dispatches.filter((d) => d.wave === r.wave);
  const earlier = view.dispatches.filter((d) => d.wave < r.wave).length;
  const statusText = (s: string) => ({ pinged: "● Notified", rejected: "✕ Declined", expired: "○ No answer", cancelled: "○ Stood down", accepted: "✓ Accepted" }[s] ?? s);
  const statusColor = (s: string) => (s === "pinged" ? "#0EA5E9" : s === "accepted" ? "#16A34A" : "#94A3B8");
  return (
    <section className="card-shadow-lg animate-slide-up rounded-3xl border border-slate-100 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="font-display text-sm font-bold text-resq-navy">{current.length} helpers pinged at once</p>
          <p className="text-xs text-resq-slate">First to accept gets the job{earlier ? ` · ${earlier} tried earlier` : ""}</p>
        </div>
        <Countdown seconds={left} total={windowS} />
      </div>
      <div className="space-y-2.5">
        {current.map((d, i) => (
          <div key={d.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl text-white" style={{ background: d.helperSkills[0] ? SKILL_META[d.helperSkills[0]].color : "#64748B" }}>
              {d.helperSkills[0] ? SKILL_META[d.helperSkills[0]].icon : <Icon.User size={18} />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-resq-navy">Helper {i + 1} · {fmtDistance(d.distanceKm)}</p>
              <div className="mt-1 flex flex-wrap gap-1">{d.helperSkills.slice(0, 3).map((s) => <SkillPill key={s} skill={s} />)}</div>
            </div>
            <span className="text-xs font-semibold" style={{ color: statusColor(d.status) }}>{statusText(d.status)}</span>
          </div>
        ))}
        {current.length === 0 && <p className="text-sm text-resq-slate">Widening the search…</p>}
      </div>
      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="mb-1.5 flex justify-between text-xs"><span className="font-medium text-resq-slate">Response window</span><span className="font-mono font-bold text-resq-navy">{left}s</span></div>
        <ProgressBar seconds={left} total={windowS} />
        <p className="mt-1.5 text-xs text-resq-slate">No answer? The search widens automatically: 1 → 2 → 4 → 8 km.</p>
      </div>
    </section>
  );
}

function MatchedCard({ view }: { view: RequestView }) {
  const h = view.matchedHelper!;
  const r = view.request;
  const eta = etaMinutes(h.distanceKm);
  const arrived = h.distanceKm !== null && h.distanceKm < 0.05;
  const markers: MapMarker[] = [];
  if (r.location) markers.push({ id: "you", at: r.location, color: "#DC2626", kind: "you", label: "You" });
  if (h.location) markers.push({ id: "helper", at: h.location, color: "#16A34A", kind: "target", label: h.name.split(" ")[0].slice(0, 7) });
  const radius = Math.max(0.4, (h.distanceKm ?? 0.5) * 1.4);
  return (
    <section className="animate-slide-up space-y-4">
      <div className="card-shadow-lg rounded-2xl border border-slate-100 bg-white p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-resq-red to-resq-navy text-xl font-bold text-white shadow-lg">{initials(h.name)}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="font-display text-lg font-bold text-resq-navy">{h.name}</h3>
              <span className="flex items-center gap-0.5 rounded-lg bg-amber-50 px-2 py-0.5"><Icon.Star size={11} className="text-amber-400" /><span className="text-xs font-bold text-amber-700">{(h.reliability * 5).toFixed(1)}</span></span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">{h.skills.map((s) => <SkillPill key={s} skill={s} />)}</div>
          </div>
        </div>
        {view.request.status === "matched" && (
          <div className="mt-4 flex items-center justify-center gap-3">
            {arrived ? <Badge variant="success">Arrived at your location</Badge> : <>
              <ETABadge minutes={eta} />
              <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-1.5 text-resq-navy"><Icon.MapPin size={14} /><span className="text-sm font-medium">{fmtDistance(h.distanceKm)} away</span></div>
            </>}
          </div>
        )}
      </div>
      {view.request.status === "matched" && r.location && (
        <div className="card-shadow relative overflow-hidden rounded-2xl">
          <LiveMap center={r.location} radiusKm={radius} markers={markers} height={180} route={h.location ? [h.location, r.location] : undefined} />
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-1.5 shadow">
            <Icon.Navigation size={14} className="text-resq-green" /><span className="text-xs font-bold text-resq-navy">{arrived ? "Arrived" : `Live · ${fmtDistance(h.distanceKm)} · ~${eta} min`}</span>
          </div>
        </div>
      )}
      {view.request.status === "matched" && (
        <div className="grid grid-cols-2 gap-3">
          <a href={`tel:${h.phone}`} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-resq-navy text-sm font-semibold text-white shadow-lg"><Icon.Phone size={18} />Call {h.name.split(" ")[0]}</a>
          <a href={`sms:${h.phone}`} className="card-shadow flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-resq-navy"><Icon.MessageSquare size={18} />Message</a>
        </div>
      )}
    </section>
  );
}

function RateCard({ onRate }: { onRate: (stars: number) => void }) {
  const [stars, setStars] = useState(0);
  return (
    <section className="card-shadow rounded-2xl border border-slate-100 bg-white p-5 text-center">
      <p className="font-display font-semibold text-resq-navy">{stars ? "Thank you for rating" : "How did your helper do?"}</p>
      <div className="mt-3 flex justify-center gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} aria-label={`${n} stars`} disabled={stars > 0} onClick={() => { setStars(n); onRate(n); }}
            className={`flex h-12 w-12 items-center justify-center rounded-xl ${n <= stars ? "text-amber-400" : "text-slate-300"}`}>
            <Icon.Star size={28} />
          </button>
        ))}
      </div>
    </section>
  );
}

function TriageCard({ view }: { view: RequestView }) {
  const t = view.request.triage!;
  return (
    <section className="card-shadow overflow-hidden rounded-2xl border border-slate-100 bg-white">
      <div className="flex items-center gap-2 bg-ai-gradient px-4 py-2.5">
        <Icon.Activity size={16} className="text-white" />
        <p className="text-sm font-semibold text-white">ResQ AI triage</p>
        <span className="ml-auto rounded-lg bg-white/20 px-2 py-0.5 text-xs font-semibold text-white">{t.source === "ollama" ? "Local AI" : "Keyword rules"}</span>
      </div>
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-display text-lg font-bold text-resq-navy">{TYPE_LABELS[t.type]}</p>
          <span className={`rounded-lg px-2 py-0.5 text-xs font-bold uppercase ${URGENCY_STYLE[t.urgency]}`}>{t.urgency}</span>
        </div>
        <p className="mt-1 text-sm text-resq-slate">{t.summary}</p>
        <p className="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-wider text-resq-slate">Skills we are looking for</p>
        <div className="flex flex-wrap gap-1.5">{t.skills.map((s) => <SkillPill key={s} skill={s} />)}</div>
        {t.clarifyingQuestion && (
          <p className="mt-3 rounded-xl bg-resq-cyan-light p-3 text-sm text-resq-navy"><strong>Tell the helper:</strong> {t.clarifyingQuestion}</p>
        )}
      </div>
    </section>
  );
}

function GuidanceCard({ view }: { view: RequestView }) {
  const g = view.guidance!;
  const [role, setRole] = useState<RequesterRole>(view.request.role ?? "other");
  const steps = role === "self" ? g.selfSteps : g.steps;
  return (
    <section className="card-shadow rounded-2xl border border-slate-100 bg-white p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display font-bold text-resq-navy">What to do now</h3>
        <div className="flex rounded-xl bg-slate-100 p-0.5" role="group" aria-label="Who needs help">
          {([["self", "It's me"], ["other", "Someone else"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setRole(v)} aria-pressed={role === v}
              className={`min-h-10 rounded-lg px-3 text-xs font-semibold ${role === v ? "bg-white text-resq-navy shadow" : "text-resq-slate"}`}>{label}</button>
          ))}
        </div>
      </div>
      <p className="mb-2 text-sm font-semibold text-resq-red">{g.title}</p>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm text-resq-navy">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-resq-navy text-xs font-bold text-white">{i + 1}</span>
            <span className="pt-0.5">{s}</span>
          </li>
        ))}
      </ol>
      {g.doNot.length > 0 && (
        <div className="mt-3 rounded-xl bg-amber-50 p-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-amber-800">Do not</p>
          <ul className="list-disc space-y-0.5 pl-4 text-sm text-amber-900">{g.doNot.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </div>
      )}
      <div className="mt-3 rounded-xl bg-resq-red-light p-3">
        <p className="mb-1 text-xs font-bold uppercase tracking-wider text-resq-red">Call 112 if</p>
        <ul className="list-disc space-y-0.5 pl-4 text-sm text-resq-red-dark">{g.call112When.map((s, i) => <li key={i}>{s}</li>)}</ul>
      </div>
      <p className="mt-3 text-xs text-resq-slate">Curated guidance ({g.source}). Not written by AI. Not a substitute for 112.</p>
    </section>
  );
}

function Timeline({ view }: { view: RequestView }) {
  const r = view.request;
  const waves = [...new Set(view.dispatches.map((d) => d.wave))];
  const acc = view.dispatches.find((d) => d.status === "accepted");
  const ev: { label: string; detail?: string; time?: string; state: "done" | "active" | "pending" }[] = [
    { label: "Emergency reported", detail: r.channel === "sms" ? "By SMS" : "In the app", time: fmtTime(r.createdAt), state: "done" },
    { label: "AI identified the help needed", detail: r.triage ? `${TYPE_LABELS[r.triage.type]} · ${r.triage.skills.map((s) => SKILL_META[s].label).join(", ")}` : undefined, state: r.triage ? "done" : "active" },
    ...waves.map((w) => ({ label: `Wave ${w}: ${view.dispatches.filter((d) => d.wave === w).length} helpers pinged`, detail: `Within ${[1, 2, 4, 8][w - 1]} km`, time: fmtTime(view.dispatches.find((d) => d.wave === w)?.pingedAt), state: (r.status === "searching" && w === r.wave ? "active" : "done") as "done" | "active" })),
  ];
  if (acc || r.status === "matched" || r.status === "resolved") ev.push({ label: `${view.matchedHelper?.name ?? "Helper"} accepted`, time: fmtTime(acc?.pingedAt), state: "done" });
  if (r.status === "matched") ev.push({ label: "En route", detail: `About ${etaMinutes(view.matchedHelper?.distanceKm)} min away`, state: "active" });
  if (r.status === "resolved") ev.push({ label: "Help delivered", time: fmtTime(r.updatedAt), state: "done" });
  if (r.status === "escalated") ev.push({ label: "Escalated to coordinator", detail: "Call 112", time: fmtTime(r.updatedAt), state: "active" });
  if (r.status === "cancelled") ev.push({ label: "Cancelled", time: fmtTime(r.updatedAt), state: "done" });
  return (
    <section className="card-shadow rounded-2xl border border-slate-100 bg-white p-4">
      <h3 className="mb-4 font-display font-semibold text-resq-navy">Timeline</h3>
      <div className="relative">
        <div className="timeline-line" style={{ top: 12, bottom: 12 }} />
        <ol className="space-y-4">
          {ev.map((e, i) => (
            <li key={i} className="relative flex gap-4">
              <div className={`z-10 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border-2 ${e.state === "done" ? "border-resq-green bg-resq-green" : e.state === "active" ? "animate-dispatch-pulse border-resq-red bg-resq-red" : "border-slate-300 bg-white"}`}>
                {e.state === "done" && <Icon.Check size={12} className="text-white" />}
                {e.state === "active" && <div className="h-2 w-2 rounded-full bg-white" />}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <p className="text-sm font-semibold text-resq-navy">{e.label}</p>
                  {e.time && <span className="font-mono text-xs text-resq-slate">{e.time}</span>}
                </div>
                {e.detail && <p className="mt-0.5 text-xs text-resq-slate">{e.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ─── Welcome (first visit in a window) ─────────────────────────────────────────────────────────────────────

function Welcome({ onClose }: { onClose: () => void }) {
  const roles = [
    { title: "I need help", sub: "No account. Describe it by voice or text; we ping the 3 best-placed neighbours.", icon: <Icon.AlertTriangle size={24} />, cls: "bg-resq-red", onClick: onClose },
    { title: "I can help", sub: "Sign in with your phone, add your skills, go on duty and receive pings.", icon: <Icon.Shield size={24} />, cls: "bg-resq-green", href: "/helper" },
    { title: "Coordinator", sub: "Ward officers and NGOs: live map, escalations and coverage.", icon: <Icon.Activity size={24} />, cls: "bg-resq-cyan", href: "/ops" },
  ];
  return (
    <div className="flex min-h-dvh flex-col bg-navy-gradient">
      <Container className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-10">
        <div className="animate-slide-up flex flex-col items-center gap-4 text-center">
          <div className="relative">
            <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-resq-red" style={{ boxShadow: "0 0 60px rgba(220,38,38,.4)" }}><Logo size={48} /></div>
            <div className="animate-spin-slow absolute -inset-3 border border-white/10" style={{ borderRadius: "40%" }} />
          </div>
          <h1 className="font-display text-5xl font-bold tracking-tight text-white">ResQ</h1>
          <p className="font-mono text-xs uppercase tracking-widest text-white/50">Community emergency network</p>
          <p className="max-w-sm text-lg font-light text-white/80">Help is closer than you think.</p>
        </div>
        <div className="grid w-full max-w-3xl gap-3 md:grid-cols-3">
          {roles.map((r) => {
            const inner = (
              <>
                <div className={`mb-3 flex h-12 w-12 items-center justify-center rounded-2xl text-white ${r.cls}`}>{r.icon}</div>
                <p className="font-display text-lg font-bold text-white">{r.title}</p>
                <p className="mt-1 text-sm text-white/60">{r.sub}</p>
              </>
            );
            return r.href
              ? <Link key={r.title} href={r.href} className="rounded-2xl border border-white/15 bg-white/5 p-5 text-left transition-colors hover:bg-white/10">{inner}</Link>
              : <button key={r.title} onClick={r.onClick} className="rounded-2xl border border-white/15 bg-white/5 p-5 text-left transition-colors hover:bg-white/10">{inner}</button>;
          })}
        </div>
        <Link href="/demo" className="flex min-h-12 items-center gap-2 rounded-xl border border-white/20 px-5 text-sm font-semibold text-white/80 hover:text-white">
          <Icon.Expand size={16} />Presenting? Open the multi-window demo guide
        </Link>
        <p className="flex items-center gap-2 text-xs text-white/40"><Icon.Phone size={12} />ResQ complements 112. It does not replace emergency services.</p>
      </Container>
    </div>
  );
}

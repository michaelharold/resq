"use client";
/* Coordinator dashboard: live SVG map, open + escalated requests, coverage by skill, SMS log and simulator. */
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Logo, PulsingDot } from "@/components/ui";
import { SKILL_META, SkillPill, URGENCY_STYLE } from "@/components/skills";
import { LiveMap, type MapMarker } from "@/components/LiveMap";
import { api, fmtDistance, fmtTime } from "@/lib/client/api";
import { useSnapshot } from "@/lib/client/sse";
import { SKILLS, TYPE_LABELS } from "@/lib/taxonomy";
import type { HelpRequest, OpsView } from "@/lib/types";

type SmsLog = { to: string; body: string; at: string; simulated: boolean; ok: boolean };
type Ops = OpsView & { sms: SmsLog[]; smsSimulated: boolean };

const STATUS_COLOR: Record<string, string> = { triaging: "#0EA5E9", searching: "#D97706", matched: "#16A34A", escalated: "#DC2626", resolved: "#64748B", cancelled: "#94A3B8" };

export default function OpsPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  useEffect(() => { void api("/api/ops/requests").then((r) => setAuthed(r.ok)); }, []);
  if (authed === null) return <div className="flex min-h-dvh items-center justify-center text-resq-slate">Loading…</div>;
  return authed ? <Dashboard /> : <Login onDone={() => setAuthed(true)} />;
}

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api("/api/ops/login", { body: { password: pw } });
    if (r.ok) onDone(); else setErr("Wrong password.");
  };
  return (
    <div className="flex min-h-dvh items-center justify-center bg-navy-gradient p-5">
      <form onSubmit={submit} className="card-shadow-lg w-full max-w-sm rounded-3xl bg-white p-6">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-resq-red"><Logo size={30} /></div>
        <h1 className="font-display text-2xl font-bold text-resq-navy">Coordinator</h1>
        <p className="mt-1 text-sm text-resq-slate">Ward officers and NGOs: live view of unmet needs.</p>
        <label htmlFor="pw" className="mt-5 block text-sm font-semibold text-resq-navy">Ops password</label>
        <input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)}
          className="mt-1.5 min-h-12 w-full rounded-xl border border-slate-200 px-4 outline-none focus:ring-2 focus:ring-resq-navy/30" />
        {err && <p role="alert" className="mt-2 text-sm font-medium text-resq-red">{err}</p>}
        <button className="mt-4 min-h-12 w-full rounded-xl bg-resq-navy font-semibold text-white">Open dashboard</button>
      </form>
    </div>
  );
}

function Dashboard() {
  const { data, connected, refresh } = useSnapshot<Ops>("/api/ops/stream", "/api/ops/requests");
  const [selected, setSelected] = useState<string | null>(null);

  // The ops GET also advances overdue waves (SMS-in and abandoned requests have no requester screen ticking them).
  useEffect(() => { const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [refresh]);

  const helperById = useMemo(() => new Map((data?.helpers ?? []).map((h) => [h.id, h])), [data]);
  if (!data) return <div className="flex min-h-dvh items-center justify-center text-resq-slate">Connecting…</div>;

  const onDuty = data.helpers.filter((h) => h.onDuty && h.location);
  const escalated = data.requests.filter((r) => r.status === "escalated");
  const open = data.requests.filter((r) => r.status !== "escalated");
  const coverage = SKILLS.map((s) => ({ s, n: onDuty.filter((h) => h.skills.includes(s)).length }));
  const maxCov = Math.max(1, ...coverage.map((c) => c.n));
  const markers: MapMarker[] = [
    ...data.helpers.filter((h) => h.location).map((h) => ({
      id: h.id, at: h.location!, kind: "helper" as const, label: `${h.name} · ${h.skills.map((s) => SKILL_META[s].label).join(", ")}`,
      color: h.onDuty ? SKILL_META[h.skills[0]].color : "#CBD5E1",
      ring: data.requests.some((r) => r.matchedHelperId === h.id && r.status === "matched") ? "#16A34A"
        : data.dispatches.some((d) => d.helperId === h.id && d.status === "pinged") ? "#D97706" : undefined,
    })),
    ...data.requests.filter((r) => r.location).map((r) => ({
      id: r.id, at: r.location!, kind: "request" as const, color: STATUS_COLOR[r.status], label: `${r.triage ? TYPE_LABELS[r.triage.type] : "Request"} · ${r.status}`,
    })),
  ];
  const sel = data.requests.find((r) => r.id === selected) ?? null;

  return (
    <div className="min-h-dvh bg-slate-100">
      <header className="bg-navy-gradient px-5 py-4">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-resq-red"><Logo size={24} /></div>
            <div><h1 className="font-display text-xl font-bold text-white">ResQ Coordinator</h1><p className="text-xs text-white/60">Live community response</p></div>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {[
              ["Open", data.requests.length, "#fff"], ["Searching", data.requests.filter((r) => r.status === "searching").length, "#FBBF24"],
              ["Matched", data.requests.filter((r) => r.status === "matched").length, "#4ADE80"], ["Escalated", escalated.length, "#F87171"],
              ["On duty", onDuty.length, "#7DD3FC"],
            ].map(([l, n, c]) => (
              <div key={String(l)} className="rounded-xl bg-white/10 px-3 py-1.5 text-center">
                <p className="font-mono text-lg font-bold" style={{ color: String(c) }}>{n}</p><p className="text-[11px] text-white/60">{l}</p>
              </div>
            ))}
            <span className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 text-xs font-semibold text-white"><PulsingDot color={connected ? "green" : "red"} />{connected ? "LIVE" : "Reconnecting"}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 p-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="space-y-4">
          <div className="card-shadow overflow-hidden rounded-2xl bg-white">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="font-display font-semibold text-resq-navy">Live map</h2>
              <p className="text-xs text-resq-slate">Rings: wave radii 1 · 2 · 4 · 8 km</p>
            </div>
            <LiveMap center={data.center} radiusKm={5.5} rings={[1, 2, 4, 8]} markers={markers} height={460} />
            <div className="flex flex-wrap gap-3 px-4 py-3 text-xs text-resq-slate">
              {Object.entries(STATUS_COLOR).slice(0, 4).map(([s, c]) => <span key={s} className="flex items-center gap-1"><span className="h-3 w-3 rounded-full" style={{ background: c }} />{s}</span>)}
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full border-2 border-amber-500" />helper pinged</span>
              <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-full bg-slate-300" />off duty</span>
            </div>
          </div>

          <div className="card-shadow rounded-2xl bg-white p-4">
            <h2 className="mb-3 font-display font-semibold text-resq-navy">Coverage by skill (on duty)</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {coverage.map(({ s, n }) => (
                <div key={s} className="flex items-center gap-2">
                  <span className="w-24 text-xs font-medium text-resq-navy">{SKILL_META[s].label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${(n / maxCov) * 100}%`, background: SKILL_META[s].color }} /></div>
                  <span className={`w-6 text-right font-mono text-xs font-bold ${n === 0 ? "text-resq-red" : "text-resq-navy"}`}>{n}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-4">
          {escalated.length > 0 && (
            <div className="card-shadow rounded-2xl border-2 border-resq-red bg-white p-4">
              <h2 className="mb-2 flex items-center gap-2 font-display font-semibold text-resq-red"><Icon.AlertTriangle size={18} />Escalated: needs a human ({escalated.length})</h2>
              <div className="space-y-2">{escalated.map((r) => <RequestRow key={r.id} r={r} data={data} onSelect={setSelected} selected={selected === r.id} />)}</div>
            </div>
          )}
          <div className="card-shadow rounded-2xl bg-white p-4">
            <h2 className="mb-2 font-display font-semibold text-resq-navy">Open requests ({open.length})</h2>
            <div className="space-y-2">
              {open.length === 0 && <p className="text-sm text-resq-slate">Nothing open right now.</p>}
              {open.map((r) => <RequestRow key={r.id} r={r} data={data} onSelect={setSelected} selected={selected === r.id} />)}
            </div>
          </div>
          {sel && (
            <div className="card-shadow rounded-2xl bg-white p-4">
              <div className="mb-2 flex items-center justify-between"><h2 className="font-display font-semibold text-resq-navy">Dispatches</h2><button onClick={() => setSelected(null)} className="h-10 w-10" aria-label="Close"><Icon.X size={16} /></button></div>
              <p className="mb-3 text-sm text-resq-navy">“{sel.description}”</p>
              <table className="w-full text-left text-xs">
                <thead className="text-resq-slate"><tr><th className="py-1">Wave</th><th>Helper</th><th>Dist</th><th>Score</th><th>Status</th></tr></thead>
                <tbody>
                  {data.dispatches.filter((d) => d.requestId === sel.id).map((d) => (
                    <tr key={d.id} className="border-t border-slate-100">
                      <td className="py-1.5 font-mono">{d.wave}</td>
                      <td>{helperById.get(d.helperId)?.name ?? d.helperId}</td>
                      <td>{fmtDistance(d.distanceKm)}</td>
                      <td className="font-mono">{d.score.toFixed(2)}</td>
                      <td><span className="font-semibold">{d.status}</span>{d.channel === "sms" && <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800">SMS</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <DemoControls data={data} />
          <SmsPanel data={data} />
        </section>
      </main>
    </div>
  );
}

function RequestRow({ r, data, onSelect, selected }: { r: HelpRequest; data: Ops; onSelect: (id: string) => void; selected: boolean }) {
  const ds = data.dispatches.filter((d) => d.requestId === r.id);
  const helper = r.matchedHelperId ? data.helpers.find((h) => h.id === r.matchedHelperId) : null;
  return (
    <button onClick={() => onSelect(r.id)} className={`w-full rounded-xl border p-3 text-left transition-colors ${selected ? "border-resq-navy bg-slate-50" : "border-slate-100 hover:bg-slate-50"}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[r.status] }} />
        <span className="text-sm font-semibold text-resq-navy">{r.triage ? TYPE_LABELS[r.triage.type] : "Triaging…"}</span>
        {r.triage && <span className={`rounded px-1.5 text-[10px] font-bold uppercase ${URGENCY_STYLE[r.triage.urgency]}`}>{r.triage.urgency}</span>}
        {r.channel === "sms" && <Badge variant="warning">SMS-in</Badge>}
        {!r.location && <Badge variant="emergency">No location</Badge>}
        <span className="ml-auto font-mono text-xs text-resq-slate">{fmtTime(r.createdAt)}</span>
      </div>
      <p className="mt-1 line-clamp-2 text-xs text-resq-slate">{r.description}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-resq-slate">
        <span className="font-semibold capitalize" style={{ color: STATUS_COLOR[r.status] }}>{r.status}</span>
        {r.wave > 0 && <span>· wave {r.wave} ({r.radiusKm} km)</span>}
        <span>· {ds.length} pinged</span>
        {r.landmark && <span>· near {r.landmark}</span>}
        {r.requesterPhone && <a href={`tel:${r.requesterPhone}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-resq-cyan">· call {r.requesterPhone}</a>}
        {helper && <span>· helper {helper.name}</span>}
      </div>
      {r.triage && <div className="mt-1.5 flex flex-wrap gap-1">{r.triage.skills.map((s) => <SkillPill key={s} skill={s} />)}</div>}
    </button>
  );
}

function SmsPanel({ data }: { data: Ops }) {
  const [open, setOpen] = useState(data.smsSimulated);
  const [from, setFrom] = useState("+919000000099");
  const [body, setBody] = useState("HELP trapped near TKMCE hostel");
  const [reply, setReply] = useState<string | null>(null);
  const send = async () => {
    const res = await fetch("/api/twilio/inbound", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ From: from, Body: body }) });
    const xml = await res.text();
    setReply(new DOMParser().parseFromString(xml, "text/xml").querySelector("Message")?.textContent ?? xml);
  };
  return (
    <div className="card-shadow rounded-2xl bg-white p-4">
      <button onClick={() => setOpen(!open)} className="flex min-h-10 w-full items-center justify-between">
        <h2 className="flex items-center gap-2 font-display font-semibold text-resq-navy"><Icon.Radio size={16} />SMS {data.smsSimulated && <Badge variant="warning">simulated</Badge>}</h2>
        <Icon.ChevronRight size={16} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <p className="mb-2 text-xs font-semibold text-resq-navy">Simulate an inbound SMS (YES / NO / HELP …)</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm sm:w-40" />
              <input value={body} onChange={(e) => setBody(e.target.value)} aria-label="Body" className="min-h-10 flex-1 rounded-lg border border-slate-200 px-3 text-sm" />
              <button onClick={send} className="min-h-10 rounded-lg bg-resq-navy px-4 text-sm font-semibold text-white">Send</button>
            </div>
            <p className="mt-1.5 text-[11px] text-resq-slate">Seeded helpers use +919000000001 … +919000000030.</p>
            {reply && <p className="mt-2 rounded-lg bg-white p-2 text-xs text-resq-navy">↩ {reply}</p>}
          </div>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {data.sms.length === 0 && <p className="text-xs text-resq-slate">No outbound SMS yet.</p>}
            {data.sms.map((m, i) => (
              <div key={i} className="rounded-lg border border-slate-100 p-2 text-xs">
                <div className="flex justify-between text-resq-slate"><span className="font-mono">→ {m.to}</span><span>{fmtTime(m.at)}{!m.ok && <span className="ml-1 text-resq-red">failed</span>}</span></div>
                <p className="mt-0.5 text-resq-navy">{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DemoControls({ data }: { data: Ops }) {
  const [msg, setMsg] = useState<string | null>(null);
  const seededOn = data.helpers.filter((h) => h.id.startsWith("seed-helper-") && h.onDuty).length;
  const act = async (action: string, label: string) => {
    const r = await api<{ helpers?: number; cancelled?: number }>("/api/ops/demo", { body: { action } });
    setMsg(r.ok ? label : `Failed (${r.error})`);
  };
  return (
    <div className="card-shadow rounded-2xl bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold text-resq-navy">Demo controls</h2>
        <a href="/demo" target="_blank" className="text-sm font-semibold text-resq-cyan">Open launcher →</a>
      </div>
      <p className="mt-1 text-xs text-resq-slate">{seededOn} of 30 seeded helpers on duty. Switch them off so only real helper windows get pinged.</p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button onClick={() => act("seeded_off", "Seeded helpers are off duty")} className="min-h-11 rounded-xl bg-resq-navy text-xs font-semibold text-white">Seeded helpers off</button>
        <button onClick={() => act("seeded_on", "Seeded helpers are on duty")} className="min-h-11 rounded-xl border border-slate-200 text-xs font-semibold text-resq-navy">Seeded helpers on</button>
        <button onClick={() => { if (confirm("Cancel every open request?")) void act("reset", "All open requests cancelled"); }} className="min-h-11 rounded-xl border border-resq-red/30 bg-resq-red-light text-xs font-semibold text-resq-red">Reset requests</button>
      </div>
      {msg && <p className="mt-2 text-xs font-medium text-resq-green">{msg}</p>}
    </div>
  );
}

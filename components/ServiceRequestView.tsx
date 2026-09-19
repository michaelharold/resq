"use client";
/* The requester's live view of a service request: finding a provider → matched (details, map, call, message) → done (pay, rate). */
import { useEffect, useState } from "react";
import { Icon } from "./icons";
import { Badge, ETABadge, NavBar, PulsingDot, initials } from "./ui";
import { SKILL_META } from "./skills";
import { LiveMap, type MapMarker } from "./LiveMap";
import { api, etaMinutes, fmtDistance, fmtTime, getHelperToken, getUid } from "@/lib/client/api";
import { useSnapshot } from "@/lib/client/sse";
import { MEDICAL_SERVICES, type Service } from "@/lib/taxonomy";
import type { RateRange, RequestView, Skill } from "@/lib/types";

export type ProviderPreview = { id: string; name: string; verified: boolean; rating: number; rate: RateRange | null; distanceKm: number };
export const fmtRate = (r: RateRange | null | undefined) => (r ? `₹${r.min.toLocaleString("en-IN")}–₹${r.max.toLocaleString("en-IN")}` : "Rate on request");

export function VerifiedBadge({ verified, pending = false }: { verified: boolean; pending?: boolean }) {
  if (verified) return <span className="inline-flex items-center gap-1 rounded-full bg-resq-cyan-light px-2 py-0.5 text-xs font-semibold text-resq-cyan"><Icon.Shield size={12} />ID verified</span>;
  if (pending) return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"><Icon.Clock size={12} />ID under review</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-resq-slate">Not verified</span>;
}

export function Stars({ rating }: { rating: number }) {
  return <span className="inline-flex items-center gap-0.5 rounded-lg bg-amber-50 px-1.5 py-0.5 text-xs font-bold text-amber-700"><Icon.Star size={11} className="text-amber-400" />{rating.toFixed(1)}</span>;
}

export function ServiceRequestView({ id, onClose }: { id: string; onClose: () => void }) {
  const uid = typeof window === "undefined" ? "" : getUid();
  const tok = typeof window === "undefined" ? "none" : getHelperToken() ?? "none";
  const { data: view, connected, setData } = useSnapshot<RequestView>(
    `/api/requests/${id}/stream?uid=${encodeURIComponent(uid)}&s=${encodeURIComponent(tok)}`, `/api/requests/${id}`, { "x-resq-uid": uid, "x-resq-session": tok });
  const [providers, setProviders] = useState<ProviderPreview[] | null>(null);
  const [stars, setStars] = useState(0);
  const r = view?.request;
  const service = (r?.service ?? null) as Skill | null;

  useEffect(() => {
    if (!service || !r?.location || r.status !== "searching") return;
    const load = () => api<{ providers: ProviderPreview[] }>(`/api/services?service=${service}&lat=${r.location!.lat}&lng=${r.location!.lng}`).then((x) => x.ok && setProviders(x.data.providers));
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [service, r?.location, r?.status]);

  const patch = async (body: Record<string, unknown>) => {
    const x = await api<RequestView>(`/api/requests/${id}`, { method: "PATCH", body });
    if (x.ok) setData(x.data);
  };

  if (!view || !r || !service) return <div className="flex flex-1 items-center justify-center text-resq-slate">Loading…</div>;
  const meta = SKILL_META[service];
  const h = view.matchedHelper;
  const medical = MEDICAL_SERVICES.includes(service as Service);
  const header = {
    searching: { title: `Finding a ${meta.label.toLowerCase()}`, sub: "Nearby providers have your request. The first to accept gets the job.", bg: "bg-navy-gradient" },
    matched: { title: `${h?.name ?? "Your provider"} is on the way`, sub: `${meta.label} · accepted at ${fmtTime(r.updatedAt)}`, bg: "bg-success-gradient" },
    resolved: { title: "Job done", sub: "Thanks for using ResQ", bg: "bg-success-gradient" },
    cancelled: { title: "Request cancelled", sub: "Providers have been told", bg: "bg-navy-gradient" },
    escalated: { title: "Still looking", sub: "No one has accepted yet", bg: "bg-navy-gradient" },
    triaging: { title: "Sending…", sub: "", bg: "bg-navy-gradient" },
  }[r.status];

  const markers: MapMarker[] = [];
  if (r.location) markers.push({ id: "you", at: r.location, color: "#DC2626", kind: "you", label: "You" });
  if (h?.location) markers.push({ id: "pro", at: h.location, color: "#16A34A", kind: "target", label: h.name.split(" ")[0].slice(0, 8) });
  const arrived = h?.distanceKm != null && h.distanceKm < 0.05;

  return (
    <>
      <div className={header.bg}>
        <div className="mx-auto max-w-6xl">
          <NavBar title={meta.label} onBack={onClose} light action={
            <span className="flex items-center gap-1.5 rounded-xl bg-white/15 px-2.5 py-1.5 text-xs font-semibold text-white"><PulsingDot color={connected ? "green" : "red"} />{connected ? "LIVE" : "…"}</span>} />
        </div>
        <div className="px-5 pb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-white">{meta.icon}</div>
          <h2 className="font-display text-2xl font-bold text-white">{header.title}</h2>
          <p className="mt-1 text-sm text-white/80">{header.sub}</p>
        </div>
      </div>

      <main className="mx-auto grid w-full max-w-6xl flex-1 content-start gap-4 px-4 py-4 md:px-8 lg:grid-cols-2 lg:items-start">
        <div className="flex flex-col gap-4">
          <section className="card-shadow rounded-2xl border border-slate-100 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-resq-slate">Your request</p>
            <p className="mt-1 text-sm text-resq-navy">“{r.description}”</p>
            <p className="mt-2 text-xs text-resq-slate">Sent {fmtTime(r.createdAt)}{r.location ? " · your location is shared with the provider who accepts" : ""}</p>
          </section>

          {r.status === "searching" && (
            <section className="card-shadow rounded-2xl border border-slate-100 bg-white p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-display font-semibold text-resq-navy">{meta.label}s near you</h3>
                <Badge variant={providers?.length ? "success" : "default"}>{providers?.length ?? 0} notified</Badge>
              </div>
              {providers === null && <p className="text-sm text-resq-slate">Loading…</p>}
              {providers?.length === 0 && <p className="text-sm text-resq-slate">No {meta.label.toLowerCase()} is available within 10 km right now. Your request stays open and appears as soon as one comes online.</p>}
              <ul className="space-y-2">
                {providers?.slice(0, 6).map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-xl bg-slate-50 p-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold text-white" style={{ background: meta.color }}>{initials(p.name)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-resq-navy">{p.name}<Stars rating={p.rating} /><VerifiedBadge verified={p.verified} /></p>
                      <p className="text-xs text-resq-slate">{fmtDistance(p.distanceKm)} away · {fmtRate(p.rate)}</p>
                    </div>
                    <PulsingDot color="cyan" />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {h && (r.status === "matched" || r.status === "resolved") && (
            <section className="card-shadow-lg animate-slide-up rounded-2xl border border-slate-100 bg-white p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl text-xl font-bold text-white shadow-lg" style={{ background: meta.color }}>{initials(h.name)}</div>
                <div className="min-w-0 flex-1">
                  <h3 className="font-display text-lg font-bold text-resq-navy">{h.name}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5"><Stars rating={h.reliability * 5} /><VerifiedBadge verified={h.verified} /></div>
                  <p className="mt-1 text-sm text-resq-slate">{meta.label} · charges <strong className="text-resq-navy">{fmtRate(h.rate)}</strong></p>
                </div>
              </div>
              {r.status === "matched" && (
                <>
                  <div className="mt-4 flex items-center justify-center gap-3">
                    {arrived ? <Badge variant="success">Arrived at your location</Badge> : <>
                      <ETABadge minutes={etaMinutes(h.distanceKm)} />
                      <span className="rounded-xl bg-slate-100 px-3 py-1.5 text-sm font-medium text-resq-navy">{fmtDistance(h.distanceKm)} away</span>
                    </>}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <a href={`tel:${h.phone}`} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-resq-navy text-sm font-semibold text-white shadow-lg"><Icon.Phone size={18} />Call</a>
                    <a href={`sms:${h.phone}`} className="card-shadow flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-resq-navy"><Icon.MessageSquare size={18} />Message</a>
                  </div>
                </>
              )}
            </section>
          )}

          {r.status === "resolved" && (
            <section className="card-shadow rounded-2xl border border-slate-100 bg-white p-5">
              <h3 className="font-display font-semibold text-resq-navy">Pay {h?.name ?? "your provider"}</h3>
              <p className="mt-1 text-sm text-resq-slate">Agreed range {fmtRate(h?.rate)}. In-app payment is coming soon; for now please pay the provider directly.</p>
              <button disabled className="mt-3 min-h-14 w-full cursor-not-allowed rounded-2xl bg-slate-200 font-display text-lg font-bold text-slate-500">Pay in app · coming soon</button>
              <p className="mt-4 text-center font-display font-semibold text-resq-navy">{stars ? "Thanks for rating" : "How was the service?"}</p>
              <div className="mt-2 flex justify-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} aria-label={`${n} stars`} disabled={stars > 0} onClick={() => { setStars(n); void patch({ action: "rate", stars: n }); }}
                    className={`flex h-12 w-12 items-center justify-center rounded-xl ${n <= stars ? "text-amber-400" : "text-slate-300"}`}><Icon.Star size={28} /></button>
                ))}
              </div>
            </section>
          )}

          {r.status === "searching" && (
            <button onClick={() => { if (confirm("Cancel this request?")) void patch({ action: "cancel" }); }}
              className="min-h-12 w-full rounded-2xl border border-slate-200 bg-white text-sm font-semibold text-resq-slate">Cancel request</button>
          )}
          {(r.status === "resolved" || r.status === "cancelled") && (
            <button onClick={onClose} className="min-h-12 w-full rounded-2xl bg-resq-navy font-semibold text-white">Back to home</button>
          )}
          {medical && <p className="rounded-xl bg-resq-red-light p-3 text-xs text-resq-red-dark">For a medical emergency, don&apos;t wait: <a href="tel:112" className="font-bold underline">call 112</a>.</p>}
        </div>

        {r.location && (r.status === "matched" || r.status === "searching") && (
          <section className="card-shadow relative overflow-hidden rounded-2xl">
            <LiveMap center={r.location} radiusKm={h?.distanceKm ? Math.max(0.4, h.distanceKm * 1.4) : 2} rings={r.status === "searching" ? [1] : []}
              markers={markers} height={320} route={h?.location && r.status === "matched" ? [h.location, r.location] : undefined} />
            <div className="absolute left-4 top-4 rounded-xl border border-slate-100 bg-white px-3 py-1.5 text-xs font-bold text-resq-navy shadow">
              {r.status === "matched" ? (arrived ? "Arrived" : `Live · ${fmtDistance(h?.distanceKm)}`) : "Waiting for a provider"}
            </div>
          </section>
        )}
      </main>
    </>
  );
}

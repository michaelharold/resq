"use client";

export function getUid(): string {
  try {
    let id = localStorage.getItem("resq_uid");
    if (!id) {
      id = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("resq_uid", id);
    }
    return id;
  } catch {
    return "anon-" + Math.random().toString(36).slice(2, 12);
  }
}

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; status: number; error: string; data: Record<string, unknown> };

export async function api<T>(url: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, status: res.status, data: data as T } : { ok: false, status: res.status, error: String(data?.error ?? res.statusText), data };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network_error", data: {} };
  }
}

export type LatLng = { lat: number; lng: number };

export function getPosition(timeoutMs = 8000): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

export function fmtDistance(km: number | null | undefined): string {
  if (km == null || !Number.isFinite(km)) return "–";
  return km < 1 ? `${Math.max(50, Math.round((km * 1000) / 50) * 50)} m` : `${(Math.round(km * 10) / 10).toFixed(1)} km`;
}

/** Rough ETA for a neighbour on a two-wheeler in town (~20 km/h) plus a minute to set off. */
export function etaMinutes(km: number | null | undefined): number {
  return km == null ? 0 : Math.max(1, Math.ceil(km * 3 + 1));
}

export function fmtTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}

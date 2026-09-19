/**
 * In-process store. Reads and writes are structuredClone'd so callers never share references.
 * No database was purchased, so user accounts (helpers: name, phone, skills, reliability) are saved to a local
 * JSON file when `persistPath` is set, and reloaded at boot. Requests and dispatches stay in memory.
 */
import { JsonFilePersistence, type Changes, type Persistence } from "./persist";
import type { AuditEntry, Authority, Dispatch, Helper, HelpRequest, LatLng, Otp, Rating, UserLocation, Zone } from "../types";
import type { AcceptResult, Store } from "./index";
import { seedHelpers, seedResidents } from "../../scripts/seed";
import { getSeedCenter } from "../dispatch";

const c = structuredClone;
const OPEN = new Set(["triaging", "searching", "matched", "escalated"]);

export type MemoryStoreOptions = { seed?: boolean; center?: LatLng; now?: Date; persistPath?: string | null; persistence?: Persistence | null };
const SEEDED = /^seed-helper-/;

export class MemoryStore implements Store {
  private helpers = new Map<string, Helper>();
  private requests = new Map<string, HelpRequest>();
  private dispatches = new Map<string, Dispatch>();
  private ratings = new Map<string, Rating>();
  private otps = new Map<string, Otp>();
  private locations = new Map<string, UserLocation>();
  private zones = new Map<string, Zone>();
  private authorities = new Map<string, Authority>();
  private auditLog: AuditEntry[] = [];
  private persistence: Persistence | null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dirty = { helpers: new Set<string>(), locations: new Set<string>(), deletedLocations: new Set<string>(), zones: new Set<string>(), authorities: new Set<string>(), audit: [] as AuditEntry[] };
  /** Resolves once saved data has been loaded; every public method awaits it (before any check, so accept stays atomic). */
  private ready: Promise<void>;

  constructor(opts: MemoryStoreOptions = {}) {
    this.persistence = opts.persistence ?? (opts.persistPath ? new JsonFilePersistence(opts.persistPath) : null);
    if (opts.seed ?? process.env.SEED_ON_BOOT !== "0") {
      for (const h of seedHelpers(opts.center ?? getSeedCenter(), opts.now ?? new Date())) this.helpers.set(h.id, h);
      for (const r of seedResidents(opts.center ?? getSeedCenter(), opts.now ?? new Date())) this.locations.set(r.phone, r);
    }
    this.ready = this.load();
  }

  private async load() {
    if (!this.persistence) return;
    try {
      const saved = await this.persistence.load();
      if (!saved) return;
      for (const l of saved.locations ?? []) if (l?.phone && l.source !== "seed") this.locations.set(l.phone, l);
      for (const z of saved.zones ?? []) if (z?.id) this.zones.set(z.id, z);
      for (const a of saved.authorities ?? []) if (a?.username) this.authorities.set(a.username, a);
      this.auditLog = (saved.audit ?? []).slice(0, 500);
      // Accounts come back off duty: nobody should be pinged until they reopen the app and go on duty again.
      for (const h of saved.helpers ?? []) if (h && typeof h.id === "string" && !SEEDED.test(h.id)) this.helpers.set(h.id, { ...h, onDuty: false });
      console.log(`[store] loaded ${saved.helpers?.length ?? 0} users from ${this.persistence.name}`);
    } catch (e) {
      console.error(`[store] could not load from ${this.persistence.name}; continuing in memory`, e);
    }
  }
  private save() {
    if (!this.persistence || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const d = this.dirty;
      this.dirty = { helpers: new Set(), locations: new Set(), deletedLocations: new Set(), zones: new Set(), authorities: new Set(), audit: [] };
      const pick = <T,>(m: Map<string, T>, ids: Set<string>) => [...ids].map((id) => m.get(id)).filter((x): x is T => !!x).map((x) => c(x));
      const changes: Changes = {
        helpers: pick(this.helpers, d.helpers).filter((h) => !SEEDED.test(h.id)),
        locations: pick(this.locations, d.locations).filter((l) => l.source !== "seed"),
        deletedLocations: [...d.deletedLocations], zones: pick(this.zones, d.zones), authorities: pick(this.authorities, d.authorities), audit: d.audit,
        full: {
          helpers: [...this.helpers.values()].filter((h) => !SEEDED.test(h.id)), locations: [...this.locations.values()].filter((l) => l.source !== "seed"),
          zones: [...this.zones.values()], authorities: [...this.authorities.values()], audit: this.auditLog.slice(0, 500),
        },
      };
      this.persistence!.flush(changes).catch((e) => console.error(`[store] save to ${this.persistence!.name} failed`, e));
    }, 300);
  }
  private touch(kind: "helpers" | "locations" | "zones" | "authorities", id: string) { this.dirty[kind].add(id); if (kind === "locations") this.dirty.deletedLocations.delete(id); this.save(); }

  async upsertHelper(h: Helper) { await this.ready; this.helpers.set(h.id, c(h)); this.touch("helpers", h.id); return c(h); }
  async getHelper(id: string) { await this.ready; const h = this.helpers.get(id); return h ? c(h) : null; }
  async getHelperByPhone(phone: string) { await this.ready;
    for (const h of this.helpers.values()) if (h.phone === phone) return c(h);
    return null;
  }
  async listHelpers() { await this.ready; return [...this.helpers.values()].map((h) => c(h)); }
  async getOnDutyHelpers() { await this.ready; return [...this.helpers.values()].filter((h) => h.onDuty && h.location).map((h) => c(h)); }
  async setOnDuty(id: string, onDuty: boolean, location?: LatLng | null) { await this.ready;
    const h = this.helpers.get(id);
    if (!h) return null;
    h.onDuty = onDuty;
    if (location !== undefined) h.location = location;
    h.lastSeen = new Date().toISOString();
    this.touch("helpers", id);
    return c(h);
  }

  async createRequest(r: HelpRequest) { await this.ready; this.requests.set(r.id, c(r)); return c(r); }
  async getRequest(id: string) { await this.ready; const r = this.requests.get(id); return r ? c(r) : null; }
  async updateRequest(id: string, patch: Partial<HelpRequest>) { await this.ready;
    const r = this.requests.get(id);
    if (!r) return null;
    Object.assign(r, c(patch), { id, updatedAt: new Date().toISOString() });
    return c(r);
  }
  async listOpenRequests() { await this.ready;
    return [...this.requests.values()]
      .filter((r) => OPEN.has(r.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => c(r));
  }

  async createDispatches(ds: Dispatch[]) { await this.ready; for (const d of ds) this.dispatches.set(d.id, c(d)); return c(ds); }
  async getDispatch(id: string) { await this.ready; const d = this.dispatches.get(id); return d ? c(d) : null; }
  async listDispatches(requestId: string) { await this.ready;
    return [...this.dispatches.values()].filter((d) => d.requestId === requestId).map((d) => c(d));
  }
  async listPingedForHelper(helperId: string) { await this.ready;
    return [...this.dispatches.values()].filter((d) => d.helperId === helperId && d.status === "pinged").map((d) => c(d));
  }
  async updateDispatch(id: string, patch: Partial<Dispatch>) { await this.ready;
    const d = this.dispatches.get(id);
    if (!d) return null;
    Object.assign(d, c(patch), { id });
    return c(d);
  }

  /** Atomic: no await between the checks and the writes. */
  async acceptDispatch(dispatchId: string): Promise<AcceptResult> { await this.ready;
    const d = this.dispatches.get(dispatchId);
    if (!d) return { ok: false, reason: "not_found" };
    if (d.status === "cancelled") return { ok: false, reason: "already_matched" };
    if (d.status !== "pinged") return { ok: false, reason: "expired" };
    const r = this.requests.get(d.requestId);
    if (!r) return { ok: false, reason: "not_found" };
    if (r.status !== "searching" && r.status !== "escalated") return { ok: false, reason: "already_matched" };
    const now = new Date().toISOString();
    d.status = "accepted"; d.respondedAt = now;
    r.status = "matched"; r.matchedHelperId = d.helperId; r.waveStartedAt = null; r.updatedAt = now;
    const cancelled: Dispatch[] = [];
    for (const o of this.dispatches.values()) {
      if (o.requestId === r.id && o.id !== d.id && o.status === "pinged") {
        o.status = "cancelled"; o.respondedAt = now; cancelled.push(c(o));
      }
    }
    return { ok: true, request: c(r), dispatch: c(d), cancelled };
  }

  async saveRating(r: Rating) { await this.ready; this.ratings.set(r.requestId, c(r)); return c(r); }
  async saveOtp(o: Otp) { await this.ready; this.otps.set(o.phone, { ...c(o), attempts: 0 }); }
  async verifyOtp(phone: string, code: string) { await this.ready;
    const o = this.otps.get(phone);
    if (!o) return false;
    if (Date.parse(o.expiresAt) <= Date.now()) { this.otps.delete(phone); return false; }
    if (o.code !== code) {
      o.attempts += 1;
      if (o.attempts >= 5) this.otps.delete(phone);
      return false;
    }
    this.otps.delete(phone);
    return true;
  }

  // ── Disaster response ──────────────────────────────────────────────────────────────────────────────────────
  async recordLocation(u: Omit<UserLocation, "history">) { await this.ready;
    const prev = this.locations.get(u.phone);
    const history = prev ? prev.history : [];
    const last = history[history.length - 1];
    const at = u.updatedAt;
    // One point per minute is plenty to answer "who was in this area"; keep 24 h.
    if (!last || Date.parse(at) - Date.parse(last.at) >= 60_000) history.push({ lat: u.location.lat, lng: u.location.lng, at });
    const cutoff = Date.parse(at) - 24 * 3600_000;
    while (history.length && Date.parse(history[0].at) < cutoff) history.shift();
    const next: UserLocation = { ...c(u), name: u.name ?? prev?.name ?? null, helperId: u.helperId ?? prev?.helperId ?? null, history };
    this.locations.set(u.phone, next);
    this.touch("locations", u.phone);
    return c(next);
  }
  async listLocations() { await this.ready; return [...this.locations.values()].map((l) => c(l)); }
  async deleteLocation(phone: string) { await this.ready; this.locations.delete(phone); this.dirty.locations.delete(phone); this.dirty.deletedLocations.add(phone); this.save(); }
  async saveZone(z: Zone) { await this.ready; this.zones.set(z.id, c(z)); this.touch("zones", z.id); return c(z); }
  async listZones() { await this.ready; return [...this.zones.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((z) => c(z)); }
  async getAuthority(username: string) { await this.ready; const a = this.authorities.get(username); return a ? c(a) : null; }
  async listAuthorities() { await this.ready; return [...this.authorities.values()].map((a) => c(a)); }
  async upsertAuthority(a: Authority) { await this.ready; this.authorities.set(a.username, c(a)); this.touch("authorities", a.username); return c(a); }
  async audit(e: AuditEntry) { await this.ready; this.auditLog.unshift(c(e)); if (this.auditLog.length > 500) this.auditLog.length = 500; this.dirty.audit.push(c(e)); this.save(); }
  async listAudit() { await this.ready; return this.auditLog.map((e) => c(e)); }
}

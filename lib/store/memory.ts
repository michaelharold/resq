/** In-process store. Reads and writes are structuredClone'd so callers never share references. */
import type { Dispatch, Helper, HelpRequest, LatLng, Otp, Rating } from "../types";
import type { AcceptResult, Store } from "./index";
import { seedHelpers } from "../../scripts/seed";
import { getSeedCenter } from "../dispatch";

const c = structuredClone;
const OPEN = new Set(["triaging", "searching", "matched", "escalated"]);

export type MemoryStoreOptions = { seed?: boolean; center?: LatLng; now?: Date };

export class MemoryStore implements Store {
  private helpers = new Map<string, Helper>();
  private requests = new Map<string, HelpRequest>();
  private dispatches = new Map<string, Dispatch>();
  private ratings = new Map<string, Rating>();
  private otps = new Map<string, Otp>();

  constructor(opts: MemoryStoreOptions = {}) {
    if (opts.seed ?? process.env.SEED_ON_BOOT !== "0") {
      for (const h of seedHelpers(opts.center ?? getSeedCenter(), opts.now ?? new Date())) this.helpers.set(h.id, h);
    }
  }

  async upsertHelper(h: Helper) { this.helpers.set(h.id, c(h)); return c(h); }
  async getHelper(id: string) { const h = this.helpers.get(id); return h ? c(h) : null; }
  async getHelperByPhone(phone: string) {
    for (const h of this.helpers.values()) if (h.phone === phone) return c(h);
    return null;
  }
  async listHelpers() { return [...this.helpers.values()].map((h) => c(h)); }
  async getOnDutyHelpers() { return [...this.helpers.values()].filter((h) => h.onDuty && h.location).map((h) => c(h)); }
  async setOnDuty(id: string, onDuty: boolean, location?: LatLng | null) {
    const h = this.helpers.get(id);
    if (!h) return null;
    h.onDuty = onDuty;
    if (location !== undefined) h.location = location;
    h.lastSeen = new Date().toISOString();
    return c(h);
  }

  async createRequest(r: HelpRequest) { this.requests.set(r.id, c(r)); return c(r); }
  async getRequest(id: string) { const r = this.requests.get(id); return r ? c(r) : null; }
  async updateRequest(id: string, patch: Partial<HelpRequest>) {
    const r = this.requests.get(id);
    if (!r) return null;
    Object.assign(r, c(patch), { id, updatedAt: new Date().toISOString() });
    return c(r);
  }
  async listOpenRequests() {
    return [...this.requests.values()]
      .filter((r) => OPEN.has(r.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => c(r));
  }

  async createDispatches(ds: Dispatch[]) { for (const d of ds) this.dispatches.set(d.id, c(d)); return c(ds); }
  async getDispatch(id: string) { const d = this.dispatches.get(id); return d ? c(d) : null; }
  async listDispatches(requestId: string) {
    return [...this.dispatches.values()].filter((d) => d.requestId === requestId).map((d) => c(d));
  }
  async listPingedForHelper(helperId: string) {
    return [...this.dispatches.values()].filter((d) => d.helperId === helperId && d.status === "pinged").map((d) => c(d));
  }
  async updateDispatch(id: string, patch: Partial<Dispatch>) {
    const d = this.dispatches.get(id);
    if (!d) return null;
    Object.assign(d, c(patch), { id });
    return c(d);
  }

  /** Atomic: no await between the checks and the writes. */
  async acceptDispatch(dispatchId: string): Promise<AcceptResult> {
    const d = this.dispatches.get(dispatchId);
    if (!d) return { ok: false, reason: "not_found" };
    if (d.status === "cancelled") return { ok: false, reason: "already_matched" };
    if (d.status !== "pinged") return { ok: false, reason: "expired" };
    const r = this.requests.get(d.requestId);
    if (!r) return { ok: false, reason: "not_found" };
    if (r.status !== "searching") return { ok: false, reason: "already_matched" };
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

  async saveRating(r: Rating) { this.ratings.set(r.requestId, c(r)); return c(r); }
  async saveOtp(o: Otp) { this.otps.set(o.phone, { ...c(o), attempts: 0 }); }
  async verifyOtp(phone: string, code: string) {
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
}

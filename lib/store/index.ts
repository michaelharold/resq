/**
 * Persistence boundary (README §9). Everything goes through getStore(); only MemoryStore exists because no data
 * layer was purchased (Firebase bid lost). Additions to the README interface: getHelperByPhone (OTP + inbound SMS),
 * listHelpers (ops map), getDispatch (respond), saveRating (§3 "gets rated").
 */
import type { Dispatch, Helper, HelpRequest, LatLng, Otp, Rating, StoreErrorReason } from "../types";
import { MemoryStore } from "./memory";

export type AcceptResult =
  | { ok: true; request: HelpRequest; dispatch: Dispatch; cancelled: Dispatch[] }
  | { ok: false; reason: StoreErrorReason };

export interface Store {
  upsertHelper(h: Helper): Promise<Helper>;
  getHelper(id: string): Promise<Helper | null>;
  getHelperByPhone(phone: string): Promise<Helper | null>;
  listHelpers(): Promise<Helper[]>;
  getOnDutyHelpers(): Promise<Helper[]>;
  setOnDuty(id: string, onDuty: boolean, location?: LatLng | null): Promise<Helper | null>;
  createRequest(r: HelpRequest): Promise<HelpRequest>;
  getRequest(id: string): Promise<HelpRequest | null>;
  updateRequest(id: string, patch: Partial<HelpRequest>): Promise<HelpRequest | null>;
  listOpenRequests(): Promise<HelpRequest[]>;
  createDispatches(ds: Dispatch[]): Promise<Dispatch[]>;
  getDispatch(id: string): Promise<Dispatch | null>;
  listDispatches(requestId: string): Promise<Dispatch[]>;
  listPingedForHelper(helperId: string): Promise<Dispatch[]>;
  updateDispatch(id: string, patch: Partial<Dispatch>): Promise<Dispatch | null>;
  acceptDispatch(dispatchId: string): Promise<AcceptResult>;
  saveRating(r: Rating): Promise<Rating>;
  saveOtp(o: Otp): Promise<void>;
  verifyOtp(phone: string, code: string): Promise<boolean>;
}

const g = globalThis as unknown as { __resq_store?: Store };

function createStore(): Store {
  const kind = process.env.STORE || "memory";
  if (kind !== "memory") throw new Error(`store adapter "${kind}" not purchased`);
  const f = process.env.RESQ_DATA_FILE?.trim();
  const persistPath = f === "off" ? null : f || `${process.cwd()}/.data/accounts.json`;
  return new MemoryStore({ persistPath });
}

export function getStore(): Store {
  return (g.__resq_store ??= createStore());
}

export function resetStoreForTests(store?: Store): void {
  g.__resq_store = store ?? createStore();
}

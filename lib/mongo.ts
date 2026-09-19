/** One MongoDB client per server process (globalThis, so Next dev hot reloads reuse it). null when MONGODB_URI is unset. */
import type { Db } from "mongodb";

const g = globalThis as unknown as { __resq_mongo?: Promise<Db> };
export const mongoConfigured = () => !!process.env.MONGODB_URI?.trim();

export function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) return Promise.reject(new Error("MONGODB_URI is not set"));
  g.__resq_mongo ??= (async () => {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, appName: "resq" });
    await client.connect();
    return client.db(process.env.MONGODB_DB?.trim() || "resq");
  })().catch((e) => { g.__resq_mongo = undefined; throw e; });
  return g.__resq_mongo;
}

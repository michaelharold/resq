/**
 * Identity documents uploaded for verification. Stored in MongoDB GridFS (bucket "id_proofs") when MongoDB is
 * configured, otherwise under .data/uploads/. Only the owner and signed-in authorities can read them.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { getDb, mongoConfigured } from "./mongo";

export const ID_PROOF_MAX_BYTES = 5 * 1024 * 1024;
export const ID_PROOF_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
const dir = () => `${process.cwd()}/.data/uploads`;

export async function saveIdProof(bytes: Buffer, meta: { ownerId: string; fileName: string; mime: string }): Promise<string> {
  if (mongoConfigured()) {
    const { GridFSBucket } = await import("mongodb");
    const bucket = new GridFSBucket(await getDb(), { bucketName: "id_proofs" });
    const id = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const up = bucket.openUploadStreamWithId(id as never, meta.fileName, { metadata: { ownerId: meta.ownerId, mime: meta.mime, uploadedAt: new Date().toISOString() } });
      up.on("finish", () => resolve()).on("error", reject);
      up.end(bytes);
    });
    return `gridfs:${id}`;
  }
  const id = randomUUID();
  mkdirSync(dir(), { recursive: true });
  writeFileSync(`${dir()}/${id}`, bytes);
  return `file:${id}`;
}

export async function readIdProof(fileId: string): Promise<Buffer | null> {
  try {
    const [kind, id] = fileId.split(":");
    if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
    if (kind === "gridfs") {
      const { GridFSBucket } = await import("mongodb");
      const bucket = new GridFSBucket(await getDb(), { bucketName: "id_proofs" });
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        bucket.openDownloadStream(id as never).on("data", (c: Buffer) => chunks.push(c)).on("end", () => resolve()).on("error", reject);
      });
      return Buffer.concat(chunks);
    }
    if (kind === "file") return readFileSync(`${dir()}/${id}`);
    return null;
  } catch {
    return null;
  }
}

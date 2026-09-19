/**
 * POST /api/triage  { text } → TriageResult   (README §11 M1; preview only, CONTRACTS §6)
 * GET  /api/triage  → warm-up / health        (CONTRACTS §6: { ollama, model, ms, modelPresent })
 */
import { NextResponse } from "next/server";
import { triage, warmOllama } from "@/lib/triage";

export const dynamic = "force-dynamic";

const TEXT_MAX = 1000;

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return NextResponse.json({ error: "text must be 1–1000 characters" }, { status: 400 });
  }
  const raw = (body as Record<string, unknown>).text;
  if (typeof raw !== "string") {
    return NextResponse.json({ error: "text must be 1–1000 characters" }, { status: 400 });
  }
  const text = raw.trim();
  if (text.length < 1 || text.length > TEXT_MAX) {
    return NextResponse.json({ error: "text must be 1–1000 characters" }, { status: 400 });
  }

  const result = await triage(text);
  return NextResponse.json(result, { status: 200 });
}

export async function GET(): Promise<Response> {
  const result = await warmOllama();
  return NextResponse.json(result, { status: 200 });
}

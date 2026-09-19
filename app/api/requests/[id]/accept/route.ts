import { getHelperSession } from "@/lib/auth";
import { json, jsonError, safe } from "@/lib/validate";
import { claim } from "@/lib/waves";

export const dynamic = "force-dynamic";

/** "I'll help": take the request from the feed. On success both sides get each other's details. */
export const POST = safe(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = getHelperSession(req);
  if (!s?.helperId) return jsonError(401, "unauthenticated");
  const { id } = await params;
  const r = await claim(id, s.helperId);
  if (!r.ok) return json({ ok: false, reason: r.reason, error: r.reason }, r.reason === "not_found" ? 404 : 409);
  return json(r);
});

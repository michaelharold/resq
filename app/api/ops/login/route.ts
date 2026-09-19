import { checkOpsPassword } from "@/lib/auth";
import { OPS_COOKIE, OPS_SESSION_MAX_AGE_SEC, isSecureRequest, serializeCookie, sign } from "@/lib/session";
import { json, jsonError, readJson, safe } from "@/lib/validate";

export const dynamic = "force-dynamic";

export const POST = safe(async (req: Request) => {
  const body = await readJson(req);
  if (!body.ok) return jsonError(400, "bad_json");
  const pw = body.value.password;
  if (typeof pw !== "string" || !pw) return jsonError(400, "password_invalid");
  if (!checkOpsPassword(pw)) return jsonError(401, "invalid_password");
  const token = sign({ ops: true, exp: Date.now() + OPS_SESSION_MAX_AGE_SEC * 1000 });
  return json({ ok: true }, 200, { "set-cookie": serializeCookie(OPS_COOKIE, token, { maxAgeSec: OPS_SESSION_MAX_AGE_SEC, secure: isSecureRequest(req) }) });
});

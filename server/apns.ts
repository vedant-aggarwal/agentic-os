// Push to iPhones from the PC: token-based APNs over HTTP/2 (Bun's fetch speaks HTTP/1.1 to Apple, so node:http2).
// Config (server/config.json): APNS_KEY_PATH (.p8), APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC (bundle id), APNS_ENV (production|sandbox).
import { connect, type ClientHttp2Session } from "node:http2";
import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

type Cfg = { keyPath: string; keyId: string; teamId: string; topic: string; production: boolean };
export type PushKind = "alert" | "voip" | "liveactivity";
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function openApns(cfg: Cfg | null) {
  if (!cfg?.keyPath || !cfg.keyId || !cfg.teamId || !existsSync(cfg.keyPath)) return null;
  const key: KeyObject = createPrivateKey(readFileSync(cfg.keyPath));
  const host = cfg.production ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com";
  let jwt = { token: "", at: 0 };
  // Apple wants the token refreshed between 20 and 60 minutes.
  const bearer = () => {
    const now = Math.floor(Date.now() / 1000);
    if (jwt.token && now - jwt.at < 40 * 60) return jwt.token;
    const head = b64url(JSON.stringify({ alg: "ES256", kid: cfg.keyId })), body = b64url(JSON.stringify({ iss: cfg.teamId, iat: now }));
    const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
    jwt = { token: `${head}.${body}.${b64url(sig)}`, at: now };
    return jwt.token;
  };
  let session: ClientHttp2Session | null = null;
  const sess = () => {
    if (session && !session.closed && !session.destroyed) return session;
    session = connect(host);
    session.on("error", () => { session = null; });
    session.on("goaway", () => { session = null; });
    session.on("close", () => { session = null; });
    return session;
  };
  function send(token: string, payload: unknown, kind: PushKind = "alert", opts: { priority?: number; expiration?: number; collapseId?: string } = {}) {
    const topic = kind === "voip" ? `${cfg!.topic}.voip` : kind === "liveactivity" ? `${cfg!.topic}.push-type.liveactivity` : cfg!.topic;
    return new Promise<{ status: number; reason?: string }>((resolve) => {
      const req = sess().request({
        ":method": "POST", ":path": `/3/device/${token}`, authorization: `bearer ${bearer()}`, "apns-topic": topic, "apns-push-type": kind,
        "apns-priority": String(opts.priority ?? 10), ...(opts.expiration != null ? { "apns-expiration": String(opts.expiration) } : {}),
        ...(opts.collapseId ? { "apns-collapse-id": opts.collapseId } : {}), "content-type": "application/json",
      });
      let status = 0, body = "";
      req.on("response", (h) => { status = Number(h[":status"]); });
      req.setEncoding("utf8");
      req.on("data", (c) => { body += c; });
      req.on("end", () => { let reason; try { reason = JSON.parse(body).reason; } catch {} resolve({ status, reason }); });
      req.on("error", (e) => resolve({ status: 0, reason: String(e) }));
      req.end(JSON.stringify(payload));
    });
  }
  return { send };
}
export type Apns = NonNullable<ReturnType<typeof openApns>>;

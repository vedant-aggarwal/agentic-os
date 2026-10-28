// Idempotency-Key for writes (v2). The phone sends a key with every create it may have to resend (the app's sync
// uses `task:<user>:<temp id>` for a new task, `goal:…` for a goal): if the first answer was lost on the way back,
// the resend gets that first answer again instead of making a second record. Keys are per user, kept 48 hours in
// <DATA_DIR>/idempotency.db; two copies arriving at once wait for the first. 5xx answers are not kept (a retry runs).
//
// Wiring (server/index.ts; the lead applies it, two lines):
//   import { idempotency } from "./idempotency";   const idem = idempotency(DATA_DIR);   // with the other singletons
//   in Bun.serve's fetch, the /api/v1 call:
//     res = url.pathname.startsWith("/mock/") ? mockFile(req, url)
//       : await idem.wrap(req, auth.sessionUser(tokenOf(req)), () => api(req, url, server));
// A thrown error (ApiError) is not kept either: it propagates as before and a resend runs again.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const KEEP_MS = 48 * 3600_000;
const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
type Saved = { status: number; body: string; type: string | null };

export function idempotency(dataDir: string, { file = "idempotency.db", now = () => Date.now() } = {}) {
  if (file !== ":memory:") mkdirSync(dataDir, { recursive: true });
  const db = new Database(file === ":memory:" ? ":memory:" : join(dataDir, file));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  db.exec("CREATE TABLE IF NOT EXISTS idem (key TEXT PRIMARY KEY, status INTEGER NOT NULL, body TEXT NOT NULL, type TEXT, at INTEGER NOT NULL)");
  const get = db.prepare("SELECT status, body, type, at FROM idem WHERE key = ?");
  const put = db.prepare("INSERT OR REPLACE INTO idem (key, status, body, type, at) VALUES (?, ?, ?, ?, ?)");
  const sweep = () => db.prepare("DELETE FROM idem WHERE at < ?").run(now() - KEEP_MS);
  sweep();
  const timer = setInterval(sweep, 3600_000);
  (timer as any).unref?.();
  const inflight = new Map<string, Promise<Saved>>();
  const answer = (s: Saved, replay: boolean) => new Response(s.body, { status: s.status, headers: { ...(s.type ? { "Content-Type": s.type } : {}), "Cache-Control": "no-store", ...(replay ? { "Idempotent-Replay": "true" } : {}) } });

  /** Run a write once per (user, Idempotency-Key). Requests without the header, and reads, pass straight through. */
  async function wrap(req: Request, user: { id: number | string } | null, run: () => Promise<Response>): Promise<Response> {
    const raw = req.headers.get("idempotency-key");
    if (!raw || !user || !WRITE.has(req.method) || raw.length > 200) return run();
    const key = `${user.id}:${req.method}:${new URL(req.url).pathname}:${raw}`;
    const hit = get.get(key) as (Saved & { at: number }) | null;
    if (hit && now() - hit.at < KEEP_MS) return answer(hit, true);
    const pending = inflight.get(key);
    if (pending) return answer(await pending, true);
    const p = (async (): Promise<Saved> => {
      const r = await run();
      const s = { status: r.status, body: await r.text(), type: r.headers.get("content-type") };
      if (r.status < 500) put.run(key, s.status, s.body, s.type, now());
      return s;
    })();
    inflight.set(key, p);
    try { return answer(await p, false); } finally { inflight.delete(key); }
  }
  return { wrap, close: () => { clearInterval(timer); db.close(); } };
}

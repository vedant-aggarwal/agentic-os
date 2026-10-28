// Agentic OS app server: serves the phone web app and the /api/v1 it talks to.
// Run: bun server/index.ts   (PORT 8090 by default, loopback only; a tunnel makes it public)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { Database } from "bun:sqlite";
import { openAuth, throttle, verifyGoogle, type User } from "./auth";
import { idempotency } from "./idempotency";
import { ApiError, ensureDb, openStore, type Store } from "./store";
import { openAI } from "./ai";
import { openProposals } from "./proposals";
import { openWyn } from "./wyn";
import { openWhatsApp } from "./wyn-whatsapp";
import { openCapture } from "./capture";
import { openApns } from "./apns";
import { openWorkActivity } from "./work-activity";
import { runCodex } from "./codex";
import { MODULES } from "./modules";
import { startScheduler } from "./modules/scheduler";
import type { JobCtx, ModCtx, Module } from "./modules/types";
import { configFor } from "./config";
import { APP_ORIGINS, appCors, appPreflight } from "./app-cors";
import { openVoice } from "./voice";
import { openKb } from "./kb";
import { MAX_ATTACHMENT, openAttachments, withAttachments, type Attachment } from "./attachments";
import { briefJob, engineModels, openJobs, type Jobs } from "./jobs";
import { inside, openWorktrees } from "./worktrees";
import { openJobWorkspace } from "./job-workspace";
import { openTerm } from "./term";
import { folders, under } from "./folders";
import { listSessions } from "./sessions";

const ROOT = resolve(import.meta.dir, "..");
const cfgPath = join(import.meta.dir, "config.json");
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
const conf = configFor(cfg);
const PORT = Number(conf("PORT", "8090"));
const HOST = conf("HOST", "127.0.0.1");
const GOOGLE_CLIENT_ID = conf("GOOGLE_CLIENT_ID", "") || null;
const APP_DIR = join(ROOT, "app");
const auth = openAuth(
  conf("DATA_DIR", join(ROOT, "data")),
  conf("OWNER_DB", join(homedir(), ".agentos", "agentos.db")),
  conf("OWNER_EVENTS", join(homedir(), "agentic-os", ".operator-data", "workspace.json")),
);

const ai = openAI(conf("DATA_DIR", join(ROOT, "data")));
const proposals = openProposals(ai);
const apns = openApns(conf("APNS_KEY_PATH", "") ? { keyPath: conf("APNS_KEY_PATH", ""), keyId: conf("APNS_KEY_ID", ""), teamId: conf("APNS_TEAM_ID", ""),
  topic: conf("APNS_TOPIC", "dev.agenticos.app"), production: conf("APNS_ENV", "production") !== "sandbox" } : null);
const wyn = openWyn({
  dataDir: conf("DATA_DIR", join(ROOT, "data")), ai, storeFor, userById: (id) => auth.userById(id),
  owners: () => (auth.listUsers() as any[]).filter((r) => r.role === "owner").map((r) => auth.userById(r.id)!).filter(Boolean),
  // A real key in config.json wins over a placeholder like OPENAI_API_KEY=not-needed in the environment.
  openaiKey: conf("OPENAI_API_KEY", ""), apns,
});
// Local agents (Claude Code sessions, scripts on this PC) reach Wyn through /api/v1/agent/* with this token.
// The routes answer only on this machine: never through the Cloudflare tunnel, which always adds cf-connecting-ip.
const AGENT_TOKEN_PATH = join(conf("DATA_DIR", join(ROOT, "data")), "agent.token");
if (!existsSync(AGENT_TOKEN_PATH)) writeFileSync(AGENT_TOKEN_PATH, randomBytes(24).toString("hex"));
const AGENT_TOKEN = readFileSync(AGENT_TOKEN_PATH, "utf8").trim();
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const fromThisPC = (req: Request, server: any) => !req.headers.get("cf-connecting-ip") && LOOPBACK.has(server.requestIP(req)?.address ?? "");
const ownerUser = () => (auth.listUsers() as any[]).filter((r) => r.role === "owner").map((r) => auth.userById(r.id)).find(Boolean) ?? null;
const capture = openCapture(conf("CAPTURE_USER", "") ? { base: conf("CAPTURE_JMAP", "https://mail.your-server.example"), user: conf("CAPTURE_USER", ""),
  password: conf("CAPTURE_PASSWORD", ""), allow: conf("CAPTURE_FROM", "").split(",") } : null,
  () => { const o = ownerUser(); return o ? { store: storeFor(o), email: o.email } : null; });
const stores = new Map<number, Store>();
function storeFor(u: User) {
  let s = stores.get(u.id);
  if (!s) {
    ensureDb(u.agentos_db, u.role);
    s = openStore(u.agentos_db, u.events_path);
    stores.set(u.id, s);
  }
  return s;
}

// ── modules (server/modules/*, contract in server/modules/types.ts) ─────────
const DATA_DIR = conf("DATA_DIR", join(ROOT, "data"));
const idem = idempotency(DATA_DIR);   // Idempotency-Key on writes: a resent create gets the first answer (server/idempotency.ts)
const AGENTOS_BIN = conf("AGENTOS_BIN", "agentos");
// AGENTOS_SRC=<path to agentos.ts> runs the CLI from source with bun instead of the built exe (v2 development: no 99 MB rebuild per change)
const AGENTOS_SRC = conf("AGENTOS_SRC", "");
const agentosCmd = () => (AGENTOS_SRC ? [process.execPath, AGENTOS_SRC] : [AGENTOS_BIN]);
// Content OS keeps a second file beside the agentos db. The owner's can be moved with AGENTOS_CONTENT_DB; members' stay beside theirs.
const contentDbFor = (u: User) => (u.role === "owner" && conf("AGENTOS_CONTENT_DB", "")) || join(dirname(u.agentos_db), "content.db");
/** `agentos <args> --json` against this user's db. Exit 2 is the CLI's usage error (400); anything else failing is 502. */
async function runAgentos(u: User, args: string[]) {
  const argv = args.map(String);
  if (!argv.includes("--json")) argv.push("--json");
  const p = Bun.spawn([...agentosCmd(), ...argv], { env: { ...process.env, AGENTOS_DB: u.agentos_db, AGENTOS_CONTENT_DB: contentDbFor(u) }, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), 60_000);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  clearTimeout(timer);
  await p.exited;
  if (p.exitCode !== 0) {
    const last = (err || out).trim().split("\n").filter(Boolean).at(-1)?.slice(0, 300);
    if (p.exitCode !== 2) console.error(`[mod] agentos ${argv.join(" ")} exit ${p.exitCode}: ${last}`);
    throw new ApiError(p.exitCode === 2 ? 400 : 502, last || `agentos ${argv[0]} failed.`);
  }
  const text = out.trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { console.error(`[mod] agentos ${argv[0]} gave no JSON: ${text.slice(0, 200)}`); throw new ApiError(502, `agentos ${argv[0]} gave no JSON.`); }
}
/** The part of a module context that jobs and requests share. `close` releases the per-call db handle. */
function modBase(u: User, mod: Module, owner: boolean): { ctx: JobCtx; close: () => void } {
  let dbh: Database | null = null;
  const ctx: JobCtx = {
    user: u, owner, store: storeFor(u), dbPath: u.agentos_db,
    db: () => {
      if (!dbh) { dbh = new Database(u.agentos_db); dbh.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;"); }
      return dbh;
    },
    contentDbPath: contentDbFor(u), ai, codex: runCodex, agentos: (args) => runAgentos(u, args),
    push: (title, body, data) => wyn.pushAlert(u, { title, body, data }),
    wyn, conf, dataDir: DATA_DIR, log: (msg) => console.log(`[mod:${mod.name}] ${msg}`),
  };
  return { ctx, close: () => { try { dbh?.close(); } catch {} dbh = null; } };
}
// the agent's app tools get exactly the context the apps' own routes get (server/agent-tools.ts useModuleContext)
wyn.useModuleContext((u, mod) => modBase(u, mod, true));

// ── work: voice, keyboard AI, jobs (contract: Desktop/agentic-os-build/work/CONTRACT.md) ─────
const voice = openVoice({ dataDir: DATA_DIR, openaiKey: () => conf("OPENAI_API_KEY", "") });
// Wyn on WhatsApp (server/wyn-whatsapp.ts): off until WA_* is set in config.json.
const wa = openWhatsApp({ conf, wyn, owner: ownerUser, transcribe: (path) => voice.transcribeFile(path), dataDir: DATA_DIR });
const kb = openKb({ dataDir: DATA_DIR, codex: runCodex });
const attachments = openAttachments(DATA_DIR);
const pubAtt = (a: Attachment) => ({ id: a.id, name: a.name, size: a.size, image: a.image });
// Jobs run on the owner's own Claude/Codex logins, so only the owner has a runner.
const runners = new Map<number, Jobs>();
function jobsFor(u: User) {
  let j = runners.get(u.id);
  if (!j) { j = openJobs({ dataDir: DATA_DIR, store: storeFor(u), push: (title, body, data) => work.alert(title, body, data), changed: () => work.kick(), workspace: jobWorkspace }); runners.set(u.id, j); }
  return j;
}
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { for (const j of runners.values()) j.shutdown(); process.exit(0); });
// Separate copies (git worktrees) for agents. Owner only, like jobs; deleting a copy first stops jobs running in it.
// Terminals on the PC (aos-ptyd) for the phone and the agentos CLI, plus phone alerts when a terminal agent needs him.
const term = openTerm({
  dataDir: DATA_DIR,
  push: (title, body, data) => work.alert(title, body, data),
  folderOf: (slug) => { const u = ownerUser(); try { return u ? (storeFor(u).project(slug) as any)?.folder ?? null : null; } catch { return null; } },
});
// What the agents are doing, on the phone's lock screen and Dynamic Island: working, needs you, done (server/work-activity.ts).
const work = openWorkActivity({
  apns, dataDir: DATA_DIR, owner: ownerUser,
  sources: async () => {
    const u = ownerUser();
    if (!u) return [];
    const js = jobsFor(u).list({ live: true }).map((x: any) => ({ id: x.id, title: x.title ?? x.id, status: x.status, updatedAt: x.updatedAt,
      url: `agenticos://job/${x.id}`, engine: x.engine, detail: x.status === "needs_input" ? x.pending?.title ?? null : null }));
    const ts = (await term.list()).sessions.filter((s) => s.kind === "claude" || s.kind === "codex").map((s) => ({ id: s.id, title: s.title, status: s.status,
      updatedAt: s.updatedAt, url: `agenticos://term/${s.id}`, engine: s.kind, detail: s.status === "needs_input" ? s.detail : null }));
    return [...js, ...ts];
  },
  tokens: (u, kind) => wyn.deviceTokens(u, kind), drop: (u, t) => wyn.dropDevice(u, t),
  pushAlert: (u, x) => wyn.pushAlert(u, x), pushBadge: (u, n) => wyn.pushBadge(u, n),
});
const worktrees = openWorktrees({ dataDir: DATA_DIR, beforeRemove: async (path) => { for (const j of runners.values()) await j.stopUnder(path, inside); } });
const jobWorkspace = openJobWorkspace(worktrees);
/** Claude/Codex sessions on this PC in the contract's shape, optionally only those whose folder is under `folder`.
 *  Which are live comes from the last `claude agents` answer (renewed in the background), so a project page never
 *  waits ~1.5 s on it; the first answer is read at startup. */
setTimeout(() => listSessions(1, 1, { stale: true }).catch(() => {}), 0);
async function sessionsFor(u: User, folder: string | null | undefined, all = false) {
  if (!all && !folder) return [];
  const native = jobsFor(u).byNative();
  return (await listSessions(14, 300, { stale: true }))
    .filter((x) => !folder || (x.cwd && under(x.cwd, folder)))
    .slice(0, 60)
    .map((x) => ({ id: x.id, tool: x.tool, title: x.title, cwd: x.cwd, updatedAt: x.updatedAt, live: x.live, where: x.where, jobId: native.get(x.id) ?? null }));
}
/** Raw request bodies (audio chunks, images) skip the JSON parser. */
const rawLimit = (req: Request, max: number) => { if (Number(req.headers.get("content-length") ?? 0) > max) throw new ApiError(413, "Too large."); };

// ── http helpers ────────────────────────────────────────────────────────────
const SEC = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=()",
};
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...SEC, ...extra } });
const fail = (status: number, error: string) => json({ error }, status);
/** JSON with an ETag (also in the body as `etag`, which the phone keeps with its copy and sends back as If-None-Match).
 *  The tag covers everything except today.now, so an unchanged day answers 304 with no body. */
function tagged(req: Request, data: any) {
  const { now: _now, ...today } = data.today ?? {};
  const tag = `W/"${Bun.hash(JSON.stringify({ ...data, today })).toString(36)}"`;
  const asked = (req.headers.get("if-none-match") ?? "").split(",").map((t) => t.trim());
  if (asked.includes(tag)) return new Response(null, { status: 304, headers: { ETag: tag, "Cache-Control": "no-store", ...SEC } });
  return json({ ...data, etag: tag }, 200, { ETag: tag });
}
const cookieOf = (req: Request, name: string) =>
  (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(name + "="))?.slice(name.length + 1) ?? null;
const isHttps = (req: Request) => req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
const COOKIE = "aos_session";
const sessionCookie = (req: Request, token: string, maxAge: number) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? "; Secure" : ""}`;
const tokenOf = (req: Request) => {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : cookieOf(req, COOKIE);
};
const ipOf = (req: Request, server: any) => req.headers.get("cf-connecting-ip") ?? server.requestIP(req)?.address ?? "?";
async function body(req: Request) {
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) throw new ApiError(415, "Send JSON.");
  const raw = await req.text();
  if (raw.length > 200_000) throw new ApiError(413, "Too large.");
  try { return raw ? JSON.parse(raw) : {}; } catch { throw new ApiError(400, "Bad JSON."); }
}
// Cookie-authenticated writes must come from this site. Bearer clients (a native app) are exempt.
function sameOrigin(req: Request) {
  if (req.headers.get("authorization")) return true;
  const o = req.headers.get("origin");
  if (o && APP_ORIGINS.has(o)) return true;
  if (!o) return req.headers.get("sec-fetch-site") !== "cross-site";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try { return new URL(o).host === host; } catch { return false; }
}
const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, role: u.role, google: !!u.google_sub, hasPassword: !!(u as any).password_hash });

function signedIn(req: Request, u: User, native: boolean) {
  const s = auth.createSession(u.id, req.headers.get("user-agent"));
  return json({ user: publicUser(u), ...(native ? { token: s.token } : {}) }, 200, { "Set-Cookie": sessionCookie(req, s.token, s.maxAge) });
}
const validEmail = (e: unknown) => typeof e === "string" && e.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
const validPassword = (p: unknown) => typeof p === "string" && p.length >= 8 && p.length <= 200;

// ── static files ────────────────────────────────────────────────────────────
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json",
  ".ico": "image/x-icon", ".woff2": "font/woff2",
};
function file(path: string, extra: Record<string, string> = {}) {
  const full = normalize(join(APP_DIR, path));
  if (!full.startsWith(APP_DIR) || !existsSync(full)) return null;
  const f = Bun.file(full);
  return new Response(f, { headers: { "Content-Type": TYPES[extname(full)] ?? "application/octet-stream", "Cache-Control": "no-cache", ...SEC, ...extra } });
}

// ── routes ──────────────────────────────────────────────────────────────────
async function api(req: Request, url: URL, server: any): Promise<Response> {
  const p = url.pathname.slice("/api/v1".length);
  const m = req.method;
  const native = req.headers.get("x-client") === "native";
  if (m !== "GET" && !sameOrigin(req)) return fail(403, "Cross-site request blocked.");

  // public auth endpoints
  if (p === "/auth/config" && m === "GET") return json({ google: GOOGLE_CLIENT_ID, ownerExists: auth.hasOwner() });
  if (p === "/auth/login" && m === "POST") {
    const b = await body(req);
    if (!throttle(`login:${ipOf(req, server)}`) || !throttle(`login:${String(b.email).toLowerCase()}`, 10))
      return fail(429, "Too many tries. Wait 15 minutes.");
    const u = validEmail(b.email) ? await auth.checkPassword(b.email, b.password) : null;
    if (!u) return fail(401, "Email or password is wrong.");
    return signedIn(req, u, native);
  }
  if (p === "/auth/signup" && m === "POST") {
    const b = await body(req);
    if (!throttle(`signup:${ipOf(req, server)}`, 10)) return fail(429, "Too many tries. Wait 15 minutes.");
    if (!validEmail(b.email)) return fail(400, "Enter a valid email.");
    if (!validPassword(b.password)) return fail(400, "Use at least 8 characters for the password.");
    const inv = auth.takeInvite(b.invite);
    if (!inv) return fail(403, "That invite code is wrong or used up.");
    if (auth.userByEmail(b.email)) return fail(409, "That email already has an account. Sign in instead.");
    const u = auth.createUser({ email: b.email, name: String(b.name ?? "").slice(0, 80), password: b.password, role: inv.row.role });
    inv.use();
    return signedIn(req, u, native);
  }
  if (p === "/auth/google" && m === "POST") {
    if (!GOOGLE_CLIENT_ID) return fail(404, "Google sign-in is not set up yet.");
    const b = await body(req);
    if (!throttle(`google:${ipOf(req, server)}`, 20)) return fail(429, "Too many tries. Wait 15 minutes.");
    const g = await verifyGoogle(String(b.credential ?? ""), GOOGLE_CLIENT_ID);
    if (!g) return fail(401, "Google could not confirm that account.");
    let u = auth.userByGoogle(g.sub);
    if (!u) {
      const byEmail = auth.userByEmail(g.email);
      if (byEmail) { auth.linkGoogle(byEmail.id, g.sub); u = auth.userById(byEmail.id); }
    }
    if (!u) {
      const inv = auth.takeInvite(b.invite);
      if (!inv) return json({ error: "New here? Enter your invite code, then continue with Google.", needInvite: true }, 403);
      u = auth.createUser({ email: g.email, name: g.name, googleSub: g.sub, role: inv.row.role });
      inv.use();
    }
    return signedIn(req, u!, native);
  }

  // WhatsApp messages for Wyn, from the control bridge on this PC, signed with WA_SECRET. Never through the tunnel.
  if (p === "/whatsapp/inbound" && m === "POST") {
    if (!fromThisPC(req, server)) return fail(404, "No such endpoint.");
    rawLimit(req, 8 * 1024 * 1024);
    return json(await wa.inbound(await req.text(), req.headers.get("x-wyn-signature")));
  }
  // Local agents asking for the owner: Wyn decides whether to call, message, schedule, answer herself or decline.
  if (p.startsWith("/agent/")) {
    if (!fromThisPC(req, server) || tokenOf(req) !== AGENT_TOKEN) return fail(404, "No such endpoint.");
    const owner = ownerUser();
    if (!owner) return fail(503, "No owner account yet.");
    if (p === "/agent/call" && m === "POST") return json(await wyn.agentCall(owner, await body(req)), 201);
    // The wyn plugin in Claude sessions: hello on start, the reply on stop, and a listener that waits for prompts.
    const hk = p.match(/^\/agent\/hooks\/(hello|stop)$/);
    if (hk && m === "POST") return json(hk[1] === "hello" ? wyn.hookHello(owner, await body(req)) : wyn.hookStop(owner, await body(req)));
    const ib = p.match(/^\/agent\/sessions\/([\w-]+)\/inbox$/);
    if (ib && m === "GET") {
      const r = await wyn.inbox(owner, ib[1], url.searchParams.get("listener") ?? "", Number(url.searchParams.get("wait") ?? 0));
      return r.status === 200 ? new Response(r.text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } }) : new Response(null, { status: r.status });
    }
    const ask = p.match(/^\/agent\/requests\/([\w-]+)$/);
    if (ask && m === "GET") return json(await wyn.agentRequest(owner, ask[1], Number(url.searchParams.get("wait") ?? 0)));
    return fail(404, "No such endpoint.");
  }

  // Modules: /api/v1/mod/<name>/<rest>. A session as usual; from this PC with the agent token (the desktop proxy,
  // local scripts) the call runs as the owner without a cookie.
  const mod = p.match(/^\/mod\/([a-z0-9-]+)(\/.*)?$/);
  if (mod) {
    const module = MODULES.find((x) => x.name === mod[1]);
    if (!module) return fail(404, "No such module.");
    const rest = mod[2] || "/";
    // A module's publicPaths need no session (a client's page): they run on the owner's data with user = null.
    const pub = module.publicPaths?.some((x) => rest.startsWith(x)) ?? false;
    const agent = !pub && fromThisPC(req, server) && tokenOf(req) === AGENT_TOKEN;
    const u = pub ? null : agent ? ownerUser() : auth.sessionUser(tokenOf(req));
    const dbUser = pub ? ownerUser() : u;
    if (!dbUser) return fail(agent || pub ? 503 : 401, agent || pub ? "No owner account yet." : "Sign in first.");
    const { ctx: base, close } = modBase(dbUser, module, !!u && (agent || u.role === "owner"));
    const ctx: ModCtx = { ...base, user: u, req, url, method: m, path: rest, body: () => body(req), json: (data, status = 200) => json(data, status), fail };
    try { return (await module.handle(ctx)) ?? fail(404, "No such endpoint."); } finally { close(); }
  }

  // everything else needs a session. From this PC, the agent token runs as the owner (the desktop's /__aos proxy, scripts).
  const token = tokenOf(req);
  const agentCall = !!token && token === AGENT_TOKEN && fromThisPC(req, server);
  const user = agentCall ? ownerUser() : auth.sessionUser(token);
  if (!user) return fail(agentCall ? 503 : 401, agentCall ? "No owner account yet." : "Sign in first.");
  if (p === "/auth/logout" && m === "POST" && !agentCall) {
    auth.endSession(token!);
    return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
  }
  if (p === "/me" && m === "GET") return json({ user: publicUser(user) });
  if (p === "/account/password" && m === "POST") {
    const b = await body(req);
    if (!validPassword(b.next)) return fail(400, "Use at least 8 characters.");
    const hasPw = !!auth.userByEmail(user.email)?.password_hash;
    if (hasPw && !(await auth.checkPassword(user.email, b.current))) return fail(401, "Current password is wrong.");
    auth.setPassword(user.id, b.next);
    auth.endAllSessions(user.id);
    return signedIn(req, user, native);
  }
  if (p === "/invites" && user.role === "owner") {
    if (m === "GET") return json({ invites: auth.listInvites(), users: auth.listUsers() });
    if (m === "POST") {
      const b = await body(req);
      const uses = Math.max(1, Math.min(50, Number(b.uses ?? 1)));
      const days = Math.max(1, Math.min(90, Number(b.days ?? 7)));
      return json(auth.createInvite({ uses, days, label: b.label ? String(b.label).slice(0, 60) : null, by: user.id }), 201);
    }
  }

  const s = storeFor(user);
  let mm: RegExpMatchArray | null;
  const owner = user.role === "owner";
  if (p === "/bootstrap" && m === "GET") {
    // jobs are the list shape (briefJob); a job page reads its own GET /jobs/:id
    return tagged(req, { user: publicUser(user), ...s.bootstrap(), jobs: owner ? jobsFor(user).list({ limit: 30 }).map(briefJob) : [], ai: owner,
      agents: owner ? await ai.agentsFor(user).catch(() => ({})) : {}, aiPlan: owner ? proposals.openPlan(s) : null });
  }
  // ── ideas ──
  if (p === "/ideas" && m === "GET") return json({ ideas: s.ideas({ project: url.searchParams.get("project"), status: url.searchParams.get("status") }) });
  if (p === "/ideas" && m === "POST") return json({ idea: s.createIdea(await body(req)) }, 201);
  if ((mm = p.match(/^\/ideas\/(i?\d+)$/)) && m === "GET") return json({ idea: s.idea(mm[1]) });
  if ((mm = p.match(/^\/ideas\/(i?\d+)$/)) && m === "PATCH") return json({ idea: s.patchIdea(mm[1], await body(req)) });
  if ((mm = p.match(/^\/ideas\/(i?\d+)$/)) && m === "DELETE") { s.patchIdea(mm[1], { status: "archived" }); return json({ ok: true }); }
  if ((mm = p.match(/^\/ideas\/(i?\d+)\/task$/)) && m === "POST") {
    const b = await body(req);
    return json(s.ideaToTask(mm[1], b), 201);
  }
  // ── voice recordings (any signed-in user; files under data/voice/<userId>) ──
  if (p === "/voice" && m === "GET") return json({ recordings: voice.list(user.id) });
  if (p === "/voice" && m === "POST") return json({ recording: voice.create(user.id, await body(req)) }, 201);
  if ((mm = p.match(/^\/voice\/(v_[A-Za-z0-9]+)\/chunk\/(\d+)$/)) && m === "PUT") { rawLimit(req, 20 * 1024 * 1024); return json(await voice.putChunk(user.id, mm[1], Number(mm[2]), req)); }
  // { async: true }: 202 at once while it's written down (GET /voice/:id?wait=25 brings the words); without it, the words
  if ((mm = p.match(/^\/voice\/(v_[A-Za-z0-9]+)\/finish$/)) && m === "POST") {
    const recording = await voice.finish(user.id, mm[1], await body(req));
    return json({ recording }, recording.status === "transcribing" ? 202 : 200);
  }
  if ((mm = p.match(/^\/voice\/(v_[A-Za-z0-9]+)\/retry$/)) && m === "POST") return json({ recording: await voice.retry(user.id, mm[1]) });
  if ((mm = p.match(/^\/voice\/(v_[A-Za-z0-9]+)\/audio$/)) && m === "GET") return voice.audio(user.id, mm[1]);
  if ((mm = p.match(/^\/voice\/(v_[A-Za-z0-9]+)$/)) && m === "GET") return json({ recording: await voice.getWait(user.id, mm[1], Number(url.searchParams.get("wait") ?? 0)) });
  if ((mm = p.match(/^\/voice\/(v_[A-Za-z0-9]+)$/)) && m === "DELETE") return json(voice.remove(user.id, mm[1]));
  // ── owner only: keyboard AI (Codex), jobs (Claude/Codex over ACP), sessions, folders ──
  if (p.startsWith("/kb/") || p.startsWith("/jobs") || p.startsWith("/sessions") || p === "/folders" || p.startsWith("/worktrees") || p === "/term" || p.startsWith("/term/")) {
    if (!owner) return fail(403, "This runs on the owner's PC accounts, so it's owner only for now.");
    if (p === "/kb/modes" && m === "GET") return json(kb.modes());
    if (p === "/kb/image" && m === "POST") { rawLimit(req, 15 * 1024 * 1024); return json(await kb.putImage(user.id, req), 201); }
    if (p === "/kb/chat" && m === "POST") return json(await kb.chat(user.id, await body(req)));
    if ((mm = p.match(/^\/kb\/chat\/(k_[A-Za-z0-9]+)$/)) && m === "GET") return json(kb.thread(user.id, mm[1]));
    const jobs = jobsFor(user);
    if (p === "/jobs" && m === "GET") return json({ jobs: jobs.list({ project: url.searchParams.get("project"), live: url.searchParams.get("live") === "1" }) });
    if (p === "/jobs" && m === "POST") {
      // worktree: true runs it in its own copy (git worktree) when its folder is a repo with commits (server/job-workspace.ts).
      const b = await body(req);
      const att = attachments.resolve(b.attachments);
      if (att.length) b.context = withAttachments(String(b.context ?? ""), att);
      return json({ job: await jobs.create(b) }, 201);
    }
    // Attachments: upload one file (raw body, ?name=), then name its id in POST /jobs or /jobs/:id/prompt.
    if (p === "/jobs/attachments" && m === "POST") { rawLimit(req, MAX_ATTACHMENT); return json({ attachment: pubAtt(await attachments.put(req)) }, 201); }
    if ((mm = p.match(/^\/jobs\/attachments\/(a_[a-f0-9]{16})$/)) && m === "GET") return attachments.file(mm[1]);
    if (p === "/jobs/models" && m === "GET") return json({ models: engineModels() });
    if ((mm = p.match(/^\/jobs\/(j?\d+)$/)) && m === "GET") return json(jobs.get(mm[1]));
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/stream$/)) && m === "GET") return jobs.stream(mm[1], Number(url.searchParams.get("after") ?? 0) || 0, req.signal);
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/prompt$/)) && m === "POST") {
      const b = await body(req);
      return json({ job: await jobs.prompt(mm[1], withAttachments(String(b.text ?? ""), attachments.resolve(b.attachments)), { plan: typeof b.plan === "boolean" ? b.plan : undefined, queue: !!b.queue, interrupt: !!b.interrupt, force: !!b.force, steer: !!b.steer }) });
    }
    // The board: lanes, stars, review flags, keep-warm; the message queue; rewind; board settings; Builders.
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/board$/)) && m === "POST") return json({ job: await jobs.board(mm[1], await body(req)) });
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/queue$/)) && m === "POST") return json({ job: await jobs.queue(mm[1], await body(req)) });
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/rewind$/)) && m === "POST") return json(await jobs.rewind(mm[1], await body(req)));
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/fork$/)) && m === "POST") return json({ job: await jobs.fork(mm[1], await body(req)) }, 201);
    if (p === "/jobs/board-settings" && m === "GET") return json({ settings: jobs.boardSettings() });
    if (p === "/jobs/board-settings" && m === "POST") return json({ settings: jobs.setBoardSettings(await body(req)) });
    if (p === "/jobs/builders" && m === "GET") return json({ builders: jobs.builderList() });
    if ((mm = p.match(/^\/jobs\/builders\/([a-z0-9_][a-z0-9_-]{0,60})$/i)) && m === "POST") return json({ builder: jobs.builderConfigure(mm[1], await body(req)) });
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/settings$/)) && m === "POST") return json({ job: jobs.settings(mm[1], await body(req)) });
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/turns$/)) && m === "GET") return json(jobs.turns(mm[1]));
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/diff$/)) && m === "GET") return json(await jobs.diff(mm[1], Number(url.searchParams.get("turn") ?? 0) || 0, url.searchParams.get("file")));
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/revert$/)) && m === "POST") return json(await jobs.revert(mm[1], Number((await body(req)).turn) || 0));
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/permission$/)) && m === "POST") return json({ job: jobs.permission(mm[1], await body(req)) });
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/cancel$/)) && m === "POST") return json({ job: await jobs.cancel(mm[1]) });
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/stop$/)) && m === "POST") return json({ job: jobs.stop(mm[1]) });
    if ((mm = p.match(/^\/jobs\/(j?\d+)\/done$/)) && m === "POST") return json({ job: jobs.done(mm[1], await body(req).catch(() => ({}))) });
    // Terminals. A phone (not this PC) can't type into a plain shell unless that setting is on.
    if (p === "/term" && m === "GET") return json({ ...(await term.list()), settings: term.settings() });
    if (p === "/term" && m === "POST") {
      const b = await body(req);
      // copy: start in a separate copy (git worktree) of the project; group/label make it part of a compare.
      if (b.copy) {
        const folder = b.cwd ?? (b.project ? (s.project(b.project) as any)?.folder : null);
        if (!folder) throw new ApiError(400, "A separate copy needs a project with a folder.");
        const w = await worktrees.create({ folder, title: b.title ?? b.prompt?.split("\n")[0] ?? "Terminal", project: b.project ?? null, group: b.group ?? null, label: b.label ?? null });
        b.cwd = w.cwd;
      }
      return json({ session: await term.create(b) }, 201);
    }
    if (p === "/term/settings" && m === "GET") return json({ settings: term.settings() });
    if (p === "/term/settings" && m === "POST") return json({ settings: term.setSettings(await body(req)) });
    if ((mm = p.match(/^\/term\/([\w-]+)$/)) && m === "GET") return json({ session: await term.get(mm[1]) });
    if ((mm = p.match(/^\/term\/([\w-]+)$/)) && m === "DELETE") return json(await term.remove(mm[1]));
    if ((mm = p.match(/^\/term\/([\w-]+)\/text$/)) && m === "GET") return json(await term.text(mm[1], Number(url.searchParams.get("lines") ?? 200) || 200));
    if ((mm = p.match(/^\/term\/([\w-]+)\/wait$/)) && m === "GET")
      return json(await term.wait(mm[1], url.searchParams.get("until") ?? "settled", Number(url.searchParams.get("timeout") ?? 600) || 600, req.signal));
    if ((mm = p.match(/^\/term\/([\w-]+)\/send$/)) && m === "POST") return json(await term.send(mm[1], await body(req), !agentCall));
    if ((mm = p.match(/^\/term\/([\w-]+)\/key$/)) && m === "POST") return json(await term.key(mm[1], (await body(req)).key, !agentCall));
    if ((mm = p.match(/^\/term\/([\w-]+)\/(kill|restart|done)$/)) && m === "POST") return json(await term.action(mm[1], mm[2] as "kill", await body(req).catch(() => ({}))));
    if (p === "/worktrees/check" && m === "GET") return json(await worktrees.check(url.searchParams.get("folder") ?? ""));
    if (p === "/worktrees" && m === "GET") return json({ worktrees: await worktrees.list({ all: url.searchParams.get("all") === "1", group: url.searchParams.get("group") }) });
    if (p === "/worktrees" && m === "POST") return json({ worktree: await worktrees.create(await body(req)) }, 201);
    if ((mm = p.match(/^\/worktrees\/(w_[a-f0-9]+)$/)) && m === "GET") return json({ worktree: await worktrees.status(mm[1]) });
    if ((mm = p.match(/^\/worktrees\/(w_[a-f0-9]+)\/diff$/)) && m === "GET") return json(await worktrees.diff(mm[1], url.searchParams.get("file")));
    if ((mm = p.match(/^\/worktrees\/(w_[a-f0-9]+)\/(merge|discard|pr|pick)$/)) && m === "POST") {
      const b = await body(req).catch(() => ({}));
      const fn = { merge: worktrees.merge, discard: worktrees.discard, pr: worktrees.pr, pick: worktrees.pick }[mm[2] as "merge"];
      return json(await fn(mm[1], b));
    }
    if (p === "/sessions" && m === "GET") {
      const slug = url.searchParams.get("project");
      const folder = slug ? s.project(slug).folder : null;
      return json({ sessions: slug && !folder ? [] : await sessionsFor(user, folder, !slug) });
    }
    if (p === "/folders" && m === "GET") {
      const extra = (s.projects() as any[]).map((x) => x.folder).filter(Boolean);
      return json(await folders({ under: url.searchParams.get("under"), extra }));
    }
    return fail(404, "No such endpoint.");
  }
  // Wyn: chat on Codex and calls on OpenAI realtime, both on the owner's accounts, so owner only for now.
  if (p === "/wyn" || p.startsWith("/wyn/")) {
    if (!owner) return fail(403, "Wyn isn't on for this account yet.");
    if (p === "/wyn" && m === "GET") {
      const after = Number(url.searchParams.get("after") ?? 0), wait = Number(url.searchParams.get("wait") ?? 0);
      return json(wait > 0 ? await wyn.poll(user, after, wait) : wyn.state(user, after));
    }
    if (p === "/wyn/messages" && m === "POST") return json(wyn.send(user, (await body(req)).text), 201);
    if (p === "/wyn/undo" && m === "POST") return json(await wyn.undo(user, await body(req)));
    if (p === "/wyn/prefs" && m === "PUT") return json(wyn.prefs(user, await body(req)));
    if (p === "/wyn/models" && m === "GET") return json(wyn.models());
    if (p === "/wyn/whatsapp" && m === "GET") return json(wa.status(user));
    if (p === "/wyn/whatsapp/test" && m === "POST") return json(await wa.test(user));
    if (p === "/wyn/call" && m === "POST") return json(await wyn.startCall(user, await body(req)));
    if ((mm = p.match(/^\/wyn\/call\/([\w-]+)\/end$/)) && m === "POST") return json(await wyn.endCall(user, mm[1]));
    if (p === "/wyn/call-tool" && m === "POST") return json(await wyn.callTool(user, await body(req)));
    if (p === "/wyn/calls" && m === "GET") return json({ calls: wyn.calls(user) });
    if ((mm = p.match(/^\/wyn\/calls\/([\w-]+)$/)) && m === "GET") return json(wyn.callDetail(user, mm[1]));
    if ((mm = p.match(/^\/wyn\/incoming\/([\w-]+)\/(snooze|decline)$/)) && m === "POST")
      return json(mm[2] === "snooze" ? wyn.snooze(user, mm[1], (await body(req)).minutes) : wyn.decline(user, mm[1]));
    if (p === "/wyn/ring" && m === "POST") return json(wyn.ring(user, String((await body(req)).reason ?? "Just checking in")));
    if (p === "/wyn/journal" && m === "GET") return json({ journal: wyn.journal(user) });
    if (p === "/wyn/memories" && m === "GET") return json({ memories: wyn.memories(user) });
    if (p === "/wyn/memory" && m === "GET") return json(wyn.memory(user));
    if ((mm = p.match(/^\/wyn\/asks\/([\w-]+)\/answer$/)) && m === "POST") return json(wyn.answerAsk(user, mm[1], (await body(req)).text));
    if ((mm = p.match(/^\/wyn\/memory\/([LSls]?\d+)$/)) && m === "DELETE") return json(wyn.forgetMemory(user, mm[1]));
    if (p === "/wyn/soul" && m === "GET") return json(wyn.soul(user));
    if (p === "/wyn/soul" && m === "PUT") return json(wyn.setSoul(user, await body(req)));
    // v2 (Agent area): her home, feed, heartbeats, mood, tools and autonomy, ladder, breaths, the free voice path (wyn.ts route)
    { const r = await wyn.route(user, p, m, req, url); if (r) return r; }
    return fail(404, "No such endpoint.");
  }
  // Claude on the PC. Owner only for now: it runs on the owner's Claude subscription.
  if (p.startsWith("/ai/") || /^\/tasks\/t\d+\/agent/.test(p)) {
    if (!owner) return fail(403, "AI isn't on for this account yet.");
    if (p === "/ai/ask" && m === "POST") return json(await ai.ask(s, (await body(req)).text));
    if (p === "/ai/review" && m === "GET") return json(await ai.review(user, s, url.searchParams.get("fresh") === "1"));
    if (p === "/ai/agents" && m === "GET") return json({ agents: await ai.agentsFor(user) });
    if (p === "/ai/plan" && m === "POST") return json(await proposals.plan(s, { owner, date: (await body(req)).date ?? null }));
    if (p === "/ai/plan" && m === "GET") return json({ plan: proposals.openPlan(s) });
    if (p === "/ai/parse" && m === "POST") return json(await proposals.parse(s, (await body(req)).text));
    if (p === "/ai/triage" && m === "POST") return json(await proposals.triage(s));
    if (p === "/ai/tag" && m === "POST") return json(await proposals.tag(s, (await body(req)).titles));
    if ((mm = p.match(/^\/ai\/batches\/(b\d+)\/decide$/)) && m === "POST") return json(proposals.decide(s, mm[1], await body(req)));
    if ((mm = p.match(/^\/tasks\/(t\d+)\/agent$/)) && m === "POST") return json(await ai.give(user, s, mm[1], await body(req)), 201);
    if ((mm = p.match(/^\/tasks\/(t\d+)\/agent$/)) && m === "DELETE") return json({ agent: await ai.act(user, s, mm[1], "stop") });
    if ((mm = p.match(/^\/tasks\/(t\d+)\/agent\/(answer|accept|back)$/)) && m === "POST") return json(await ai.act(user, s, mm[1], mm[2], await body(req)));
    return fail(404, "No such endpoint.");
  }
  if (p === "/today" && m === "GET") return json(s.bootstrap().today);
  if (p === "/week" && m === "GET") return json(s.bootstrap().week);
  // any run of days (Today's week and month views beyond the bootstrap's seven): Google events, overrides, sleep
  if (p === "/days" && m === "GET") {
    const from = url.searchParams.get("from") ?? "";
    const n = Math.max(1, Math.min(42, Math.round(Number(url.searchParams.get("n") ?? 7)) || 7));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return fail(400, "from is YYYY-MM-DD.");
    return json({ days: s.days(from, n) });
  }
  if (p === "/tasks" && m === "GET") {
    const st = url.searchParams.get("status");
    return json({ tasks: s.tasks().filter((t) => (st === "open" ? ["inbox", "todo", "doing"].includes(t.status) : true)) });
  }
  if (p === "/tasks" && m === "POST") return json(s.createTask(await body(req)), 201);
  if (p === "/inbox" && m === "POST") { const b = await body(req); return json(s.createTask({ title: b.text, status: "inbox" }), 201); }
  if ((mm = p.match(/^\/tasks\/(t?\d+)$/)) && m === "PATCH") return json(s.patchTask(mm[1], await body(req)));
  if ((mm = p.match(/^\/tasks\/(t?\d+)$/)) && m === "DELETE") return json(s.patchTask(mm[1], { status: "dropped" }));
  if (p === "/areas" && m === "GET") return json({ areas: s.bootstrap().areas });
  if ((mm = p.match(/^\/areas\/([a-z0-9-]+)\/rules$/)) && m === "POST") return json(s.addAreaRule(mm[1], (await body(req)).title));
  if (p === "/goals" && m === "GET") return json(s.bootstrap().goals);
  if (p === "/goals" && m === "POST") return json(s.createGoal(await body(req)), 201);
  if ((mm = p.match(/^\/goals\/(g?\d+)$/)) && m === "PATCH") return json(s.patchGoal(mm[1], await body(req)));
  if (p === "/projects" && m === "GET") return json({ projects: s.projects() });
  if (p === "/projects" && m === "POST") return json({ project: s.upsertProject(null, await body(req)) }, 201);
  if ((mm = p.match(/^\/projects\/([a-z0-9-]+)$/)) && m === "PATCH") return json({ project: s.upsertProject(mm[1], await body(req)) });
  if ((mm = p.match(/^\/projects\/([a-z0-9-]+)$/)) && m === "GET") {
    const d = s.projectDetail(mm[1]);
    return json({ ...d, jobs: owner ? jobsFor(user).list({ project: mm[1], limit: 50 }) : [],
      sessions: owner && d.project.folder ? await sessionsFor(user, d.project.folder).catch(() => []) : [] });
  }
  if ((mm = p.match(/^\/events\/(.+)$/)) && m === "PATCH") return json(s.patchEvent(decodeURIComponent(mm[1]), await body(req)));
  if (p === "/life" && m === "GET") return json(s.life());
  if (p === "/life/snapshots" && m === "POST") return json(s.putSnapshot(await body(req)), 201);
  if (p === "/life/area-aspects" && m === "PUT") return json(s.putAreaAspects(await body(req)));
  if (p === "/settings/sleep" && m === "PUT") return json(s.putSleep(await body(req)));
  if (p === "/devices" && m === "POST") { const b = await body(req); const r = wyn.registerDevice(user, b); if (owner) work.deviceChanged(b); return json(r); }
  if (p === "/work/activity" && m === "GET") { if (!owner) return fail(403, "Owner only."); return json(await work.state()); }
  // The iPhone share sheet: text, a link, or both; kind "content" files it under Content ideas.
  if (p === "/capture" && m === "POST") {
    const b = await body(req);
    const content = b.kind === "content";
    const textIn = String(b.text ?? "").trim(), link = String(b.url ?? "").trim();
    const title = String(b.title ?? "").trim() || textIn.split("\n").find((l) => l.trim())?.trim() || link;
    if (!title) throw new ApiError(400, "Nothing to capture.");
    // Content ideas now go to Content OS (content.db) through the content module's CLI; its sweep job downloads a reel link and writes the card.
    if (content) return json(await runAgentos(user, ["content", "capture", textIn || title, ...(link ? ["--link", link] : []), "--source", "share"]), 201);
    return json(s.captureTask({ title: title.slice(0, 300), notes: [textIn !== title ? textIn : "", link].filter(Boolean).join("\n\n") || null,
      area: null, list: null, source: "share" }), 201);
  }
  if (p === "/capture/status" && m === "GET") return json(capture.status());
  return fail(404, "No such endpoint.");
}

// Demo files carry the owner's calendar, so only the owner gets them.
function mockFile(req: Request, url: URL) {
  if (req.method !== "GET" || auth.sessionUser(tokenOf(req))?.role !== "owner") return fail(404, "Not found.");
  return file(url.pathname.slice(1)) ?? fail(404, "Not found.");
}
const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: 120, // a Claude call can take a while; don't drop the phone's request
  // Native Wyn calls (CallKit): the iPhone streams audio over this socket and the PC relays it to OpenAI.
  websocket: {
    open(ws: any) { ws.data.r = wyn.relay(ws.data.user, { send: (x) => ws.send(x), close: () => ws.close() }, ws.data); },
    message(ws: any, msg) { ws.data.r?.message(String(msg)); },
    close(ws: any) { ws.data.r?.close(); },
  },
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/api/v1/wyn/relay") {
      const u = auth.sessionUser(tokenOf(req) ?? url.searchParams.get("token"));
      if (!u || u.role !== "owner") return fail(401, "Sign in first.");
      return server.upgrade(req, { data: { user: u, incomingId: url.searchParams.get("incomingId"), reason: url.searchParams.get("reason") } })
        ? undefined as any : fail(400, "Expected a WebSocket.");
    }
    try {
      if (url.pathname === "/healthz") {
        if (req.method === "OPTIONS") return appPreflight(req);
        return appCors(req, json({ ok: true }));
      }
      if (url.pathname.startsWith("/api/v1/") || url.pathname.startsWith("/mock/")) {
        // The iPhone app runs from capacitor://localhost and authenticates with a Bearer token, never a cookie.
        const origin = req.headers.get("origin") ?? "";
        const app = APP_ORIGINS.has(origin);
        if (req.method === "OPTIONS") return appPreflight(req);
        if (app && !req.headers.get("authorization") && !url.pathname.startsWith("/api/v1/auth/")) return appCors(req, fail(401, "Sign in first."));
        let res: Response;
        try {
          res = url.pathname.startsWith("/mock/") ? mockFile(req, url) : await idem.wrap(req, auth.sessionUser(tokenOf(req)), () => api(req, url, server));
        } catch (e) {
          if (!(e instanceof ApiError)) console.error(e);
          res = e instanceof ApiError ? fail(e.status, e.message) : fail(500, "Something went wrong on the PC. Try again.");
        }
        return appCors(req, res);
      }
      if (req.method !== "GET" && req.method !== "HEAD") return fail(405, "Method not allowed.");
      if (url.pathname === "/login") return file("login.html")!;
      if (/^\/c\/[A-Za-z0-9_-]{16,}$/.test(url.pathname)) return file("client.html")!;   // a client's public page (modules/clients)
      if (url.pathname === "/" || url.pathname === "/index.html") {
        if (!auth.sessionUser(tokenOf(req))) {
          const next = url.search ? `/${url.search}` : "/";
          return new Response(null, { status: 303, headers: { Location: `/login${next !== "/" ? `?next=${encodeURIComponent(next)}` : ""}`, ...SEC } });
        }
        return file("index.html")!;
      }
      return file(url.pathname.slice(1)) ?? fail(404, "Not found.");
    } catch (e) {
      if (e instanceof ApiError) return fail(e.status, e.message);
      console.error(e);
      return fail(500, "Something went wrong on the PC. Try again.");
    }
  },
});
console.log(`Agentic OS app on http://${HOST}:${server.port}  (google sign-in: ${GOOGLE_CLIENT_ID ? "on" : "off"}; modules: ${MODULES.map((x) => x.name).join(", ") || "none"})`);
// Module jobs run for the owner only; the scheduler ticks every 60 s and remembers runs in <dataDir>/mod/jobs.json.
// MOD_SCHEDULER=off for test servers on a copy of the data, so module jobs don't act on it.
if (conf("MOD_SCHEDULER", "on") !== "off") startScheduler({ modules: MODULES, dataDir: DATA_DIR, ctxFor: (mod) => { const o = ownerUser(); return o ? modBase(o, mod, true) : null; } });

// From 07:00 IST, have the owner's plan ready before the app opens. Once a day, and only if no plan was made yet.
let prefetched = "";
setInterval(async () => {
  const ist = new Date(Date.now() + 330 * 60000);
  const date = ist.toISOString().slice(0, 10), h = ist.getUTCHours();
  if (prefetched === date || h < 7 || h >= 11 || conf("AI_PREFETCH", "on") === "off") return;
  prefetched = date;
  for (const row of auth.listUsers() as any[]) {
    const u = row.role === "owner" ? auth.userById(row.id) : null;
    if (!u) continue;
    try {
      const s = storeFor(u);
      if (proposals.madeToday(s, "plan")) continue;
      const r = await proposals.plan(s, { owner: true, prefetch: true });
      console.log(`[ai] morning plan ready: ${r.ghosts.length} suggestions (${r.model})`);
    } catch (e) { console.error("[ai] morning plan failed", e); }
  }
}, 60_000);

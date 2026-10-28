// Client window (outward group, concept 4). Each client gets a public page built from the owner's
// agentos: shipped (done tasks with evidence in the client's projects, 14 days), next (open tasks
// with due dates, never notes) and the decisions waiting on them. They answer with a tap and the
// answer lands in the owner's inbox as a resolved blocker. Tables are owned by the agentos CLI
// module (agentos src/modules/clients.ts); the DDL below is the same text so either side can run first.
//   owner   GET /            clients with link state, open decisions, views
//           POST /           { slug, name, projects: [...], contactName?, contactChannel? }
//           PATCH /:slug     { name?, projects?, contactName?, contactChannel?, active? }
//           POST /:slug/link { rotate?: true }  → { url, path, token, minted }
//           POST /:slug/revoke
//           GET /:slug/preview   the exact payload the client sees, plus the link
//           GET /decisions[?all=1]   POST /decisions { client, question, options?, source? }
//           GET /questions   agent questions waiting on tasks in client projects (ai.agentsFor), with their mark
//           POST /asks { task, question?, options? }   mark a task's question "ask the client" (files it now)
//   public  GET /public/:token           POST /public/:token/decisions/:id { answer }
//   job     clients-sync, every 15m: marked tasks whose agent still needs input → open decisions
import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import { throttle } from "../auth";
import type { JobCtx, ModCtx, Module } from "./types";

const DDL = `
  CREATE TABLE IF NOT EXISTS clients_clients (slug TEXT PRIMARY KEY, name TEXT NOT NULL, project_slugs TEXT NOT NULL DEFAULT '[]',
    contact_name TEXT, contact_channel TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS clients_tokens (token TEXT PRIMARY KEY, client_slug TEXT NOT NULL REFERENCES clients_clients(slug) ON DELETE CASCADE,
    created_at TEXT NOT NULL, revoked_at TEXT, last_seen_at TEXT);
  CREATE INDEX IF NOT EXISTS clients_tokens_client ON clients_tokens(client_slug);
  CREATE TABLE IF NOT EXISTS clients_decisions (id INTEGER PRIMARY KEY, client_slug TEXT NOT NULL REFERENCES clients_clients(slug) ON DELETE CASCADE,
    question TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]', source TEXT, status TEXT NOT NULL DEFAULT 'open',
    answer TEXT, answered_at TEXT, created_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS clients_decisions_client ON clients_decisions(client_slug, status);
  CREATE TABLE IF NOT EXISTS clients_views (token TEXT NOT NULL, at TEXT NOT NULL, ip_hash TEXT);
  CREATE INDEX IF NOT EXISTS clients_views_token ON clients_views(token, at);
  CREATE TABLE IF NOT EXISTS clients_asks (task_id TEXT PRIMARY KEY, client_slug TEXT NOT NULL REFERENCES clients_clients(slug) ON DELETE CASCADE,
    marked_at TEXT NOT NULL);
`;
const ensure = (db: Database) => { db.exec(DDL); return db; };
const now = () => new Date().toISOString();
const parse = <T,>(s: unknown, d: T): T => { try { return s == null ? d : (JSON.parse(String(s)) as T); } catch { return d; } };
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const TOKEN = /^[A-Za-z0-9_-]{16,}$/;
const appUrl = (ctx: { conf: (k: string, d: string) => string }) => ctx.conf("APP_URL", "https://your-server.example").replace(/\/+$/, "");
const ipHash = (req: Request) => createHash("sha256").update(req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "local").digest("hex").slice(0, 16);

// ── what the client sees ────────────────────────────────────────────────────
/** Evidence as the client may see it: URLs become links; paths on the PC are never shown. */
export function renderEvidence(ev: string | null | undefined) {
  if (!ev) return null;
  const URL_RE = /https?:\/\/[^\s)>\]"'<]+/g;
  const links = [...new Set([...ev.matchAll(URL_RE)].map((m) => m[0].replace(/[.,;:]+$/, "")))];
  const text = ev.replace(URL_RE, "").replace(/(?:(?<![A-Za-z])[A-Za-z]:[\\/]|\\\\|(?<!\S)~[\\/]|\/home\/|\/Users\/)[^\s)>\]"'<]*/g, "a file on Alex's PC")
    .replace(/\(\s*\)/g, "").replace(/\s+/g, " ").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").trim();
  return { links, text };
}
type Client = { slug: string; name: string; project_slugs: string; contact_name: string | null; contact_channel: string | null; active: number; created_at: string };
const projectsOf = (c: Client) => parse<string[]>(c.project_slugs, []).filter((s) => SLUG.test(s));
function shapeDecision(d: any) {
  return { id: d.id, client: d.client_slug, question: d.question, options: parse<string[]>(d.options, []), source: d.source, status: d.status,
    answer: d.answer, answeredAt: d.answered_at, createdAt: d.created_at };
}
/** The public payload: nothing from other clients, no notes, no private paths. */
export function pagePayload(db: Database, c: Client) {
  const projects = projectsOf(c);
  const q = projects.map(() => "?").join(",") || "''";
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  const names = Object.fromEntries((db.query(`SELECT slug, name FROM projects WHERE slug IN (${q})`).all(...projects) as any[]).map((p) => [p.slug, p.name]));
  const shipped = (db.query(`SELECT id, title, project, done_at, evidence FROM tasks WHERE status = 'done' AND evidence IS NOT NULL AND evidence != ''
      AND project IN (${q}) AND done_at >= ? ORDER BY done_at DESC LIMIT 30`).all(...projects, since) as any[])
    .map((t) => ({ id: `t${t.id}`, title: t.title, project: names[t.project] ?? t.project, doneAt: t.done_at, evidence: renderEvidence(t.evidence) }));
  const next = (db.query(`SELECT id, title, project, due, status, priority FROM tasks WHERE status IN ('todo','doing') AND project IN (${q})
      ORDER BY due IS NULL, due, priority, id LIMIT 30`).all(...projects) as any[])
    .map((t) => ({ id: `t${t.id}`, title: t.title, project: names[t.project] ?? t.project, due: t.due, doing: t.status === "doing" }));
  const decisions = (db.query("SELECT * FROM clients_decisions WHERE client_slug = ? AND status = 'open' ORDER BY created_at").all(c.slug) as any[])
    .map((d) => ({ id: d.id, question: d.question, options: parse<string[]>(d.options, []), createdAt: d.created_at }));
  const answered = (db.query("SELECT * FROM clients_decisions WHERE client_slug = ? AND status = 'answered' ORDER BY answered_at DESC LIMIT 10").all(c.slug) as any[])
    .map((d) => ({ id: d.id, question: d.question, answer: d.answer, answeredAt: d.answered_at }));
  return { client: { slug: c.slug, name: c.name, projects: projects.map((p) => names[p] ?? p) }, shipped, next, decisions, answered, updatedAt: now() };
}

// ── owner-side shapes ───────────────────────────────────────────────────────
function activeToken(db: Database, slug: string, rotate = false) {
  if (rotate) db.query("UPDATE clients_tokens SET revoked_at = ? WHERE client_slug = ? AND revoked_at IS NULL").run(now(), slug);
  const cur = db.query("SELECT token FROM clients_tokens WHERE client_slug = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1").get(slug) as any;
  if (cur) return { token: cur.token as string, minted: false };
  const token = randomBytes(24).toString("base64url");
  db.query("INSERT INTO clients_tokens (token, client_slug, created_at) VALUES (?, ?, ?)").run(token, slug, now());
  return { token, minted: true };
}
function shapeClient(db: Database, c: Client, base: string) {
  const t = db.query("SELECT token, created_at, last_seen_at FROM clients_tokens WHERE client_slug = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1").get(c.slug) as any;
  const open = (db.query("SELECT count(*) n FROM clients_decisions WHERE client_slug = ? AND status = 'open'").get(c.slug) as any).n;
  const answered = (db.query("SELECT count(*) n FROM clients_decisions WHERE client_slug = ? AND status = 'answered' AND answered_at >= ?").get(c.slug, new Date(Date.now() - 7 * 864e5).toISOString()) as any).n;
  const views = t ? (db.query("SELECT count(*) n FROM clients_views WHERE token = ? AND at >= ?").get(t.token, new Date(Date.now() - 7 * 864e5).toISOString()) as any).n : 0;
  return { slug: c.slug, name: c.name, projects: projectsOf(c), contactName: c.contact_name, contactChannel: c.contact_channel, active: !!c.active,
    link: t ? { url: `${base}/c/${t.token}`, path: `/c/${t.token}`, token: t.token, createdAt: t.created_at, lastSeen: t.last_seen_at } : null,
    openDecisions: open, answeredThisWeek: answered, viewsThisWeek: views, createdAt: c.created_at };
}
function clientBy(db: Database, slug: string) { return db.query("SELECT * FROM clients_clients WHERE slug = ?").get(slug) as Client | null; }
function clientForProject(db: Database, project: string | null): Client | null {
  if (!project) return null;
  for (const c of db.query("SELECT * FROM clients_clients WHERE active = 1").all() as Client[]) if (projectsOf(c).includes(project)) return c;
  return null;
}
function checkProjects(db: Database, slugs: unknown): string[] | string {
  const list = (Array.isArray(slugs) ? slugs : String(slugs ?? "").split(",")).map((s) => String(s).trim()).filter(Boolean);
  const missing = list.filter((s) => !SLUG.test(s) || !db.query("SELECT 1 FROM projects WHERE slug = ?").get(s));
  return missing.length ? `No project ${missing.map((m) => `"${m}"`).join(", ")}. Projects come from agentos (agentos project add).` : list;
}
/** A marked task's current agent question becomes (or refreshes) one open decision; an already answered copy of the same question is left alone. */
function upsertDecision(db: Database, client: string, source: string, question: string, options: string[]) {
  const open = db.query("SELECT * FROM clients_decisions WHERE client_slug = ? AND source = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(client, source) as any;
  if (open) {
    if (open.question !== question || open.options !== JSON.stringify(options)) db.query("UPDATE clients_decisions SET question = ?, options = ? WHERE id = ?").run(question, JSON.stringify(options), open.id);
    return { id: open.id as number, created: false };
  }
  const done = db.query("SELECT id FROM clients_decisions WHERE client_slug = ? AND source = ? AND status = 'answered' AND question = ?").get(client, source, question) as any;
  if (done) return { id: done.id as number, created: false };
  const r = db.query("INSERT INTO clients_decisions (client_slug, question, options, source, status, created_at) VALUES (?, ?, ?, ?, 'open', ?) RETURNING id")
    .get(client, question, JSON.stringify(options), source, now()) as any;
  return { id: r.id as number, created: true };
}
/** Claude's open questions on tasks that sit in a client's project (ai.agentsFor), each with its mark. Offline gateway → none. */
async function agentQuestions(ctx: ModCtx | JobCtx, db: Database) {
  if (!ctx.user) return [];
  const agents = await ctx.ai.agentsFor(ctx.user).catch(() => ({} as Record<string, any>));
  const out: any[] = [];
  for (const [taskId, a] of Object.entries(agents)) {
    if (a?.state !== "needs" || !a.question) continue;
    const t = db.query("SELECT id, title, project FROM tasks WHERE id = ?").get(Number(taskId.slice(1))) as any;
    const c = t ? clientForProject(db, t.project) : null;
    if (!t || !c) continue;
    const mark = db.query("SELECT marked_at FROM clients_asks WHERE task_id = ?").get(taskId) as any;
    out.push({ task: taskId, title: t.title, project: t.project, client: c.slug, clientName: c.name, question: a.question, options: a.options ?? [], detail: a.detail ?? null, marked: mark?.marked_at ?? null });
  }
  return out;
}

export const clients: Module = {
  name: "clients",
  publicPaths: ["/public/"],
  async handle(ctx) {
    const { path: p, method: m } = ctx;
    if (p.startsWith("/public/")) return publicRoute(ctx);
    if (!ctx.owner || !ctx.user) return ctx.fail(403, "Owner only.");
    const db = ensure(ctx.db());
    const base = appUrl(ctx);

    if (p === "/" && m === "GET") {
      const rows = (db.query("SELECT * FROM clients_clients ORDER BY active DESC, name").all() as Client[]).map((c) => shapeClient(db, c, base));
      const projects = db.query("SELECT slug, name, area FROM projects WHERE status = 'active' OR status IS NULL ORDER BY name").all();
      return ctx.json({ clients: rows, projects, appUrl: base });
    }
    if (p === "/" && m === "POST") {
      const b = await ctx.body();
      const slug = String(b.slug ?? "").trim().toLowerCase(), name = String(b.name ?? "").trim();
      if (!SLUG.test(slug) || !name) return ctx.fail(400, "Give a slug (letters, digits, dashes) and a name.");
      if (clientBy(db, slug)) return ctx.fail(409, `There is already a client "${slug}".`);
      const projects = checkProjects(db, b.projects);
      if (typeof projects === "string") return ctx.fail(400, projects);
      db.query("INSERT INTO clients_clients (slug, name, project_slugs, contact_name, contact_channel, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)")
        .run(slug, name, JSON.stringify(projects), b.contactName ? String(b.contactName).slice(0, 120) : null, b.contactChannel ? String(b.contactChannel).slice(0, 120) : null, now());
      return ctx.json({ ok: true, client: shapeClient(db, clientBy(db, slug)!, base) }, 201);
    }
    if (p === "/decisions" && m === "GET") {
      const all = ctx.url.searchParams.get("all") === "1";
      const rows = (db.query(`SELECT * FROM clients_decisions ${all ? "" : "WHERE status = 'open'"} ORDER BY status = 'open' DESC, coalesce(answered_at, created_at) DESC LIMIT 200`).all() as any[]).map(shapeDecision);
      return ctx.json({ decisions: rows });
    }
    if (p === "/decisions" && m === "POST") {
      const b = await ctx.body();
      const c = clientBy(db, String(b.client ?? ""));
      if (!c) return ctx.fail(404, "No such client.");
      const question = String(b.question ?? "").trim().slice(0, 500);
      if (question.length < 3) return ctx.fail(400, "Write the question.");
      const options = (Array.isArray(b.options) ? b.options : String(b.options ?? "").split("|")).map((o: unknown) => String(o).trim().slice(0, 80)).filter(Boolean).slice(0, 6);
      const r = db.query("INSERT INTO clients_decisions (client_slug, question, options, source, status, created_at) VALUES (?, ?, ?, ?, 'open', ?) RETURNING *")
        .get(c.slug, question, JSON.stringify(options), b.source ? String(b.source).slice(0, 40) : null, now()) as any;
      return ctx.json({ ok: true, decision: shapeDecision(r) }, 201);
    }
    if (p === "/questions" && m === "GET") return ctx.json({ questions: await agentQuestions(ctx, db) });
    if (p === "/asks" && m === "POST") {
      // "Ask the client": mark the task, and file its question now rather than at the next sync.
      const b = await ctx.body();
      const task = String(b.task ?? "").trim();
      if (!/^t\d+$/.test(task)) return ctx.fail(400, "Give a task id like t12.");
      const t = db.query("SELECT id, title, project FROM tasks WHERE id = ?").get(Number(task.slice(1))) as any;
      const c = (t && clientForProject(db, t.project)) ?? (b.client ? clientBy(db, String(b.client)) : null);
      if (!t) return ctx.fail(404, "No such task.");
      if (!c) return ctx.fail(400, "That task is not in a client's project. Give --client or move the task.");
      db.query("INSERT INTO clients_asks (task_id, client_slug, marked_at) VALUES (?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET client_slug = excluded.client_slug, marked_at = excluded.marked_at").run(task, c.slug, now());
      const live = (await agentQuestions(ctx, db)).find((q) => q.task === task);
      const question = live?.question ?? (b.question ? String(b.question).trim().slice(0, 500) : "");
      const options = live?.options ?? (Array.isArray(b.options) ? b.options.map((o: unknown) => String(o).trim().slice(0, 80)).filter(Boolean).slice(0, 6) : []);
      const filed = question.length >= 3 ? upsertDecision(db, c.slug, task, question, options) : null;
      return ctx.json({ ok: true, task, client: c.slug, decision: filed ? shapeDecision(db.query("SELECT * FROM clients_decisions WHERE id = ?").get(filed.id)) : null,
        note: filed ? null : "Marked. The question is filed for the client when Claude asks one on this task (checked every 15 minutes)." });
    }
    const one = p.match(/^\/([a-z0-9][a-z0-9-]*)(?:\/(link|revoke|preview))?$/);
    if (one) {
      const c = clientBy(db, one[1]);
      if (!c) return ctx.fail(404, "No such client.");
      const sub = one[2];
      if (!sub && m === "PATCH") {
        const b = await ctx.body();
        const cols: Record<string, unknown> = {};
        if (b.name !== undefined) { const n = String(b.name).trim(); if (!n) return ctx.fail(400, "The name can't be empty."); cols.name = n; }
        if (b.projects !== undefined) { const pr = checkProjects(db, b.projects); if (typeof pr === "string") return ctx.fail(400, pr); cols.project_slugs = JSON.stringify(pr); }
        if (b.contactName !== undefined) cols.contact_name = b.contactName ? String(b.contactName).slice(0, 120) : null;
        if (b.contactChannel !== undefined) cols.contact_channel = b.contactChannel ? String(b.contactChannel).slice(0, 120) : null;
        if (b.active !== undefined) cols.active = b.active ? 1 : 0;
        const keys = Object.keys(cols);
        if (keys.length) db.query(`UPDATE clients_clients SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE slug = ?`).run(...(keys.map((k) => cols[k]) as any[]), c.slug);
        return ctx.json({ ok: true, client: shapeClient(db, clientBy(db, c.slug)!, base) });
      }
      if (sub === "link" && m === "POST") {
        if (!c.active) return ctx.fail(400, `${c.name} is inactive. Reactivate first.`);
        const b = await ctx.body().catch(() => ({}));
        const t = activeToken(db, c.slug, !!b?.rotate);
        return ctx.json({ ok: true, minted: t.minted, url: `${base}/c/${t.token}`, path: `/c/${t.token}`, token: t.token, client: shapeClient(db, c, base) });
      }
      if (sub === "revoke" && m === "POST") {
        const r = db.query("UPDATE clients_tokens SET revoked_at = ? WHERE client_slug = ? AND revoked_at IS NULL").run(now(), c.slug);
        return ctx.json({ ok: true, revoked: r.changes, client: shapeClient(db, c, base) });
      }
      if (sub === "preview" && m === "GET") return ctx.json({ ...pagePayload(db, c), preview: true, link: shapeClient(db, c, base).link });
    }
    return null;
  },
  jobs: [{
    id: "clients-sync", every: "15m",
    async run(ctx) {
      const db = ensure(ctx.db());
      const marks = db.query("SELECT task_id, client_slug FROM clients_asks").all() as { task_id: string; client_slug: string }[];
      if (!marks.length) return;
      const live = await agentQuestions(ctx, db);
      let filed = 0;
      for (const mk of marks) {
        const q = live.find((x) => x.task === mk.task_id);
        if (!q) continue;
        if (upsertDecision(db, mk.client_slug, mk.task_id, q.question, q.options).created) filed++;
      }
      if (filed) ctx.log(`clients-sync: ${filed} agent question(s) filed for clients`);
    },
  }],
};

// ── the public side: a token is the whole identity ──────────────────────────
async function publicRoute(ctx: ModCtx): Promise<Response | null> {
  const m = ctx.path.match(/^\/public\/([A-Za-z0-9_-]+)(?:\/decisions\/(\d+))?$/);
  if (!m || !TOKEN.test(m[1])) return ctx.fail(404, "Not found.");
  const ip = ipHash(ctx.req);
  if (!throttle(`clients:${ip}`, 120)) return ctx.fail(429, "Too many requests. Try again in a few minutes.");
  const db = ensure(ctx.db());
  const t = db.query("SELECT * FROM clients_tokens WHERE token = ? AND revoked_at IS NULL").get(m[1]) as any;
  const c = t ? clientBy(db, t.client_slug) : null;
  if (!t || !c || !c.active) return ctx.fail(404, "This link is no longer active. Ask Alex for a new one.");
  if (!m[2] && ctx.method === "GET") {
    const at = now();
    db.query("INSERT INTO clients_views (token, at, ip_hash) VALUES (?, ?, ?)").run(t.token, at, ip);
    db.query("UPDATE clients_tokens SET last_seen_at = ? WHERE token = ?").run(at, t.token);
    return ctx.json(pagePayload(db, c));
  }
  if (m[2] && ctx.method === "POST") {
    if (!throttle(`clients-answer:${ip}`, 30)) return ctx.fail(429, "Too many answers. Try again in a few minutes.");
    const d = db.query("SELECT * FROM clients_decisions WHERE id = ? AND client_slug = ?").get(Number(m[2]), c.slug) as any;
    if (!d) return ctx.fail(404, "That question is not on your page.");
    if (d.status !== "open") return ctx.json({ ok: true, already: true, decision: { id: d.id, answer: d.answer, answeredAt: d.answered_at } });
    const b = await ctx.body();
    const answer = String(b.answer ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
    if (!answer) return ctx.fail(400, "Pick an option or write an answer.");
    const at = now();
    db.query("UPDATE clients_decisions SET status = 'answered', answer = ?, answered_at = ? WHERE id = ?").run(answer, at, d.id);
    // The owner's inbox gets it as a resolved blocker: same source + id twice is a no-op in agentos.
    const project = projectsOf(c)[0];
    const sourceTask = typeof d.source === "string" && /^t\d+$/.test(d.source) ? d.source : null;
    const args = ["capture", `${c.name} decided: ${answer}`, "--source", "client", "--external-id", `decision:${d.id}`,
      "--notes", `Question: ${d.question}${sourceTask ? `\nOn task ${sourceTask}` : ""}\nAnswered from the client page on ${at.slice(0, 16).replace("T", " ")} UTC. Blocker resolved.`];
    if (project) args.push("--project", project);
    let task: any = null;
    try { task = (await ctx.agentos(args))?.task ?? null; } catch (e: any) { ctx.log(`capture failed for decision ${d.id}: ${e?.message ?? e}`); }
    ctx.push(`${c.name} decided`, `${d.question} → ${answer}`, { kind: "client-decision", id: d.id }).catch(() => {});
    return ctx.json({ ok: true, decision: { id: d.id, answer, answeredAt: at }, task: task ? { id: task.id } : null });
  }
  return ctx.fail(404, "Not found.");
}

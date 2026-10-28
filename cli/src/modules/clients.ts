// Client window (outward group, concept 4). Each Northwind client gets a public page made from this
// OS: what shipped (done tasks with evidence in the client's projects), what is next, and the
// decisions waiting on them. This file owns the schema and the CLI; the phone server module
// (the Agentic OS server, server/modules/clients.ts) serves the page and answers from the same tables.
//   agentos clients                                  clients, their link state and open decisions
//   agentos clients add <slug> --name "N" --projects a,b [--contact "Name"] [--channel whatsapp:+91...]
//   agentos clients set <slug> [--name N] [--projects a,b] [--contact N] [--channel c] [--active true|false]
//   agentos clients link <slug> [--rotate]           the public URL (mints a token when none is active)
//   agentos clients revoke <slug>                    revokes every token: the page stops working
//   agentos clients ask <slug> "<question>" [--options "A|B|C"] [--source t12]   file a decision for the client
//   agentos clients decisions [--all]                decisions waiting on clients (and answered ones with --all)
import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import type { Args, ModCtx, Module } from "./types";

/** Where the public page lives: the phone server's public host. The server reads APP_URL from its config. */
export const APP_URL = () => (process.env.AGENTOS_APP_URL || "https://your-server.example").replace(/\/+$/, "");
export const linkFor = (token: string) => `${APP_URL()}/c/${token}`;

/** Shared with the phone server (it runs the same statements before touching these tables). Keep both copies identical. */
export const CLIENTS_DDL = `
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

const parseList = (s: string | undefined) => (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const json = <T,>(s: unknown, d: T): T => { try { return s == null ? d : (JSON.parse(String(s)) as T); } catch { return d; } };
export const newToken = () => randomBytes(24).toString("base64url");

function shapeClient(db: Database, c: any, jsonOut: boolean) {
  const token = db.query("SELECT token, created_at, last_seen_at FROM clients_tokens WHERE client_slug = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1").get(c.slug) as any;
  const open = (db.query("SELECT count(*) n FROM clients_decisions WHERE client_slug = ? AND status = 'open'").get(c.slug) as any).n;
  const projects: string[] = json(c.project_slugs, []);
  return {
    slug: c.slug, name: c.name, projects: jsonOut ? projects : projects.join(" "), contact: c.contact_name, channel: c.contact_channel,
    active: !!c.active, link: token ? linkFor(token.token) : null, lastSeen: token?.last_seen_at ?? null, openDecisions: open,
  };
}

/** Every slug must be a real project; the page is built from their tasks. */
function checkProjects(db: Database, slugs: string[], ctx: ModCtx) {
  const missing = slugs.filter((s) => !db.query("SELECT 1 FROM projects WHERE slug = ?").get(s));
  if (missing.length) throw new ctx.UserError(`No project ${missing.map((m) => `"${m}"`).join(", ")}. Create it first: agentos project add <slug> "Name" --area <area>`);
}
function getClient(db: Database, slug: string | undefined, ctx: ModCtx) {
  if (!slug) throw new ctx.UserError("Give a client slug. List them: agentos clients");
  const c = db.query("SELECT * FROM clients_clients WHERE slug = ?").get(slug) as any;
  if (!c) throw new ctx.UserError(`No client "${slug}". List them: agentos clients`);
  return c;
}

export const clients: Module = {
  name: "clients",
  help: `agentos clients [add <slug> --name N --projects a,b | set <slug> ... | link <slug> | revoke <slug> | ask <slug> "<q>" --options "A|B" | decisions]
                                client window: each client's public page (shipped, next, decisions) and the answers they give`,
  migrate(db) { db.exec(CLIENTS_DDL); },
  run(db, a, ctx) {
    const sub = a._[1];
    if (!sub) return list(db, ctx);
    if (sub === "add") return add(db, a, ctx);
    if (sub === "set") return set(db, a, ctx);
    if (sub === "link") return link(db, a, ctx);
    if (sub === "revoke") return revoke(db, a, ctx);
    if (sub === "ask") return ask(db, a, ctx);
    if (sub === "decisions") return decisions(db, a, ctx);
    throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos clients [add|set|link|revoke|ask|decisions]`);
  },
};

function list(db: Database, ctx: ModCtx) {
  const rows = (db.query("SELECT * FROM clients_clients ORDER BY active DESC, name").all() as any[]).map((c) => shapeClient(db, c, ctx.jsonOut));
  ctx.out({ count: rows.length, clients: rows }, [
    'agentos clients add <slug> --name "Name" --projects <project,...>',
    "agentos clients link <slug>",
    "agentos clients decisions",
  ]);
}
function add(db: Database, a: Args, ctx: ModCtx) {
  const slug = a._[2];
  const name = ctx.str(a, "name");
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug) || !name) throw new ctx.UserError('agentos clients add <slug> --name "Name" --projects a,b [--contact "Name"] [--channel whatsapp:+91...]');
  if (db.query("SELECT 1 FROM clients_clients WHERE slug = ?").get(slug)) return ctx.out({ already: true, client: slug }, [`agentos clients link ${slug}`]);
  const projects = parseList(ctx.str(a, "projects"));
  checkProjects(db, projects, ctx);
  db.query("INSERT INTO clients_clients (slug, name, project_slugs, contact_name, contact_channel, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)")
    .run(slug, name, JSON.stringify(projects), ctx.str(a, "contact") ?? null, ctx.str(a, "channel") ?? null, ctx.iso(ctx.now()));
  ctx.out({ ok: true, action: "added", client: shapeClient(db, getClient(db, slug, ctx), ctx.jsonOut) }, [`agentos clients link ${slug}`, `agentos clients ask ${slug} "<question>" --options "A|B"`]);
}
function set(db: Database, a: Args, ctx: ModCtx) {
  const c = getClient(db, a._[2], ctx);
  const cols: Record<string, unknown> = {};
  if (ctx.str(a, "name")) cols.name = ctx.str(a, "name");
  if (ctx.str(a, "projects") !== undefined) { const p = parseList(ctx.str(a, "projects")); checkProjects(db, p, ctx); cols.project_slugs = JSON.stringify(p); }
  if (ctx.str(a, "contact") !== undefined) cols.contact_name = ctx.str(a, "contact") || null;
  if (ctx.str(a, "channel") !== undefined) cols.contact_channel = ctx.str(a, "channel") || null;
  if (ctx.str(a, "active") !== undefined) cols.active = ctx.str(a, "active") === "false" ? 0 : 1;
  const keys = Object.keys(cols);
  if (!keys.length) throw new ctx.UserError("Nothing to set. Use --name, --projects, --contact, --channel or --active.");
  db.query(`UPDATE clients_clients SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE slug = ?`).run(...(keys.map((k) => cols[k]) as any[]), c.slug);
  ctx.out({ ok: true, action: "updated", client: shapeClient(db, getClient(db, c.slug, ctx), ctx.jsonOut) }, ["agentos clients"]);
}
/** The active token, or a fresh one. --rotate revokes the old link first (send the new one to the client). */
export function activeToken(db: Database, slug: string, { rotate = false, now = new Date().toISOString() } = {}) {
  if (rotate) db.query("UPDATE clients_tokens SET revoked_at = ? WHERE client_slug = ? AND revoked_at IS NULL").run(now, slug);
  const cur = db.query("SELECT token FROM clients_tokens WHERE client_slug = ? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1").get(slug) as any;
  if (cur) return { token: cur.token as string, minted: false };
  const token = newToken();
  db.query("INSERT INTO clients_tokens (token, client_slug, created_at) VALUES (?, ?, ?)").run(token, slug, now);
  return { token, minted: true };
}
function link(db: Database, a: Args, ctx: ModCtx) {
  const c = getClient(db, a._[2], ctx);
  if (!c.active) throw new ctx.UserError(`${c.name} is inactive. Reactivate first: agentos clients set ${c.slug} --active true`);
  const t = activeToken(db, c.slug, { rotate: !!a.flags.rotate, now: ctx.iso(ctx.now()) });
  ctx.out({ ok: true, action: t.minted ? "minted" : "existing", client: c.slug, url: linkFor(t.token) }, [`agentos clients revoke ${c.slug}`, `agentos clients link ${c.slug} --rotate  # new link, old one stops`]);
}
function revoke(db: Database, a: Args, ctx: ModCtx) {
  const c = getClient(db, a._[2], ctx);
  const r = db.query("UPDATE clients_tokens SET revoked_at = ? WHERE client_slug = ? AND revoked_at IS NULL").run(ctx.iso(ctx.now()), c.slug);
  ctx.out({ ok: true, action: "revoked", client: c.slug, tokens: r.changes }, [`agentos clients link ${c.slug}  # a new link`]);
}
function ask(db: Database, a: Args, ctx: ModCtx) {
  const c = getClient(db, a._[2], ctx);
  const question = a._.slice(3).join(" ").trim();
  if (!question) throw new ctx.UserError(`agentos clients ask ${c.slug} "Which colour for the header?" --options "Plum|Ivory"`);
  const options = (ctx.str(a, "options") ?? "").split("|").map((s) => s.trim()).filter(Boolean);
  const r = db.query("INSERT INTO clients_decisions (client_slug, question, options, source, status, created_at) VALUES (?, ?, ?, ?, 'open', ?) RETURNING *")
    .get(c.slug, question, JSON.stringify(options), ctx.str(a, "source") ?? null, ctx.iso(ctx.now())) as any;
  ctx.out({ ok: true, action: "asked", decision: shapeDecision(r, ctx.jsonOut) }, ["agentos clients decisions", `agentos clients link ${c.slug}`]);
}
export function shapeDecision(d: any, jsonOut: boolean) {
  const options: string[] = json(d.options, []);
  return { id: d.id, client: d.client_slug, question: d.question, options: jsonOut ? options : options.join(" | "), source: d.source,
    status: d.status, answer: d.answer, answeredAt: d.answered_at, createdAt: d.created_at };
}
function decisions(db: Database, a: Args, ctx: ModCtx) {
  const all = !!a.flags.all;
  const rows = (db.query(`SELECT * FROM clients_decisions ${all ? "" : "WHERE status = 'open'"} ORDER BY status = 'open' DESC, created_at DESC LIMIT 200`).all() as any[])
    .map((d) => shapeDecision(d, ctx.jsonOut));
  ctx.out({ count: rows.length, decisions: rows }, [all ? "agentos clients decisions" : "agentos clients decisions --all", 'agentos clients ask <slug> "<question>" --options "A|B"']);
}

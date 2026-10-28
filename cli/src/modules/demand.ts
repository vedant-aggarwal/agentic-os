// Demand radar (outward group, concept 8). Repeated asks across clients, leads and captures become
// clusters; a cluster with enough weight gets a product candidate (spec, a price marked as a guess,
// a landing draft). This file owns the schema and the CLI; the phone server module
// (the Agentic OS server, server/modules/demand.ts) pulls the lanes, clusters with Claude and writes candidates.
//   agentos demand [--all]                           clusters ranked by asks and clients (dropped ones with --all)
//   agentos demand show <id>                         one cluster: its asks and candidate
//   agentos demand add "<ask>" --client <slug> [--source manual|lead|chat|capture] [--at 2026-10-12]
//   agentos demand import --file <path> --source chat --client <slug>   one ask per dated chat line or paragraph
//   agentos demand status <id> new|candidate|building|dropped
import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import type { Args, ModCtx, Module } from "./types";

export const DEMAND_SOURCES = ["lead", "capture", "chat", "manual"] as const;
export const DEMAND_STATUSES = ["new", "candidate", "building", "dropped"] as const;

/** Shared with the phone server (it runs the same statements before touching these tables). Keep both copies identical. */
export const DEMAND_DDL = `
  CREATE TABLE IF NOT EXISTS demand_items (id INTEGER PRIMARY KEY, source TEXT NOT NULL, external_id TEXT, client_slug TEXT, text TEXT NOT NULL,
    asked_at TEXT, cluster_id INTEGER, created_at TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS demand_items_external ON demand_items(source, external_id) WHERE external_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS demand_items_cluster ON demand_items(cluster_id);
  CREATE TABLE IF NOT EXISTS demand_clusters (id INTEGER PRIMARY KEY, title TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, clients TEXT NOT NULL DEFAULT '[]',
    item_ids TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS demand_candidates (cluster_id INTEGER PRIMARY KEY REFERENCES demand_clusters(id) ON DELETE CASCADE, spec_md TEXT, price_guess TEXT,
    price_is_guess INTEGER NOT NULL DEFAULT 1, landing_md TEXT, created_at TEXT NOT NULL);
`;

const json = <T,>(s: unknown, d: T): T => { try { return s == null ? d : (JSON.parse(String(s)) as T); } catch { return d; } };

export function shapeCluster(c: any, jsonOut: boolean) {
  const clients: string[] = json(c.clients, []);
  const itemIds: number[] = json(c.item_ids, []);
  return { id: c.id, title: c.title, count: c.count, clients: jsonOut ? clients : clients.join(" "), clientCount: clients.length,
    items: jsonOut ? itemIds : itemIds.length, status: c.status, candidate: !!c.has_candidate, createdAt: c.created_at };
}
export const shapeItem = (i: any) => ({ id: i.id, source: i.source, client: i.client_slug, text: i.text, askedAt: i.asked_at, cluster: i.cluster_id, externalId: i.external_id });

/** One WhatsApp-style export line: "12/10/26, 9:41 pm - Name: text" or "[12/10/26, 21:41:03] Name: text". */
const CHAT_LINE = /^\[?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?\]?\s*[-–]?\s*([^:]{1,60}):\s*(.+)$/i;
function chatDate(d: string, m: string, y: string, h: string, min: string, ampm?: string) {
  let hh = Number(h);
  if (ampm) { const pm = /p/i.test(ampm); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
  const yy = y.length === 2 ? 2000 + Number(y) : Number(y);
  const t = Date.UTC(yy, Number(m) - 1, Number(d), hh, Number(min)) - 330 * 60000; // IST wall clock → UTC
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
/** Splits a pasted chat export or an email thread into asks without a model: dated chat lines become one ask each
 *  (the sender's own lines are kept too; the radar cares about what was asked, the owner drops the rest),
 *  anything else splits on blank lines. Lines under 12 characters are noise. */
export function splitAsks(text: string, { me }: { me?: string } = {}): { text: string; askedAt: string | null }[] {
  const out: { text: string; askedAt: string | null }[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let dated = 0;
  let cur: { text: string; askedAt: string | null } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const m = CHAT_LINE.exec(line);
    if (m) {
      dated++;
      if (cur) out.push(cur);
      const who = m[7].trim();
      cur = me && who.toLowerCase() === me.toLowerCase() ? null : { text: m[8].trim(), askedAt: chatDate(m[1], m[2], m[3], m[4], m[5], m[6]) };
      continue;
    }
    if (dated) { if (cur && line) cur.text += ` ${line}`; continue; }
    if (!line) { if (cur) out.push(cur); cur = null; continue; }
    cur = cur ? { ...cur, text: `${cur.text} ${line}` } : { text: line, askedAt: null };
  }
  if (cur) out.push(cur);
  return out.map((x) => ({ ...x, text: x.text.replace(/\s+/g, " ").trim() })).filter((x) => x.text.length >= 12);
}

export const demand: Module = {
  name: "demand",
  help: `agentos demand [show <id> | add "<ask>" --client <slug> | import --file <path> --source chat --client <slug> | status <id> <status>]
                                demand radar: repeated asks across clients, clustered, each heavy cluster a product candidate`,
  migrate(db) { db.exec(DEMAND_DDL); },
  run(db, a, ctx) {
    const sub = a._[1];
    if (!sub) return list(db, a, ctx);
    if (sub === "show") return show(db, a, ctx);
    if (sub === "add") return add(db, a, ctx);
    if (sub === "import") return importFile(db, a, ctx);
    if (sub === "status") return status(db, a, ctx);
    throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos demand [show|add|import|status]`);
  },
};

const CLUSTER_SQL = `SELECT c.*, (SELECT 1 FROM demand_candidates d WHERE d.cluster_id = c.id) AS has_candidate FROM demand_clusters c`;
function list(db: Database, a: Args, ctx: ModCtx) {
  const rows = (db.query(`${CLUSTER_SQL} ${a.flags.all ? "" : "WHERE c.status != 'dropped'"} ORDER BY json_array_length(c.clients) DESC, c.count DESC, c.id`).all() as any[])
    .map((c) => shapeCluster(c, ctx.jsonOut));
  const unclustered = (db.query("SELECT count(*) n FROM demand_items WHERE cluster_id IS NULL").get() as any).n;
  ctx.out({ count: rows.length, unclustered, clusters: rows }, [
    "agentos demand show <id>",
    'agentos demand add "<ask>" --client <slug>',
    unclustered ? `# ${unclustered} asks wait for the next radar run (05:30 on the phone server, or POST /api/v1/mod/demand/run)` : "agentos demand import --file <chat.txt> --source chat --client <slug>",
  ]);
}
function clusterOf(db: Database, input: string | undefined, ctx: ModCtx) {
  const id = Number(String(input ?? "").replace(/^c/, ""));
  const c = Number.isInteger(id) && id > 0 ? (db.query(`${CLUSTER_SQL} WHERE c.id = ?`).get(id) as any) : null;
  if (!c) throw new ctx.UserError(`No cluster ${input ?? ""}. List them: agentos demand`);
  return c;
}
function show(db: Database, a: Args, ctx: ModCtx) {
  const c = clusterOf(db, a._[2], ctx);
  const items = (db.query("SELECT * FROM demand_items WHERE cluster_id = ? ORDER BY asked_at IS NULL, asked_at DESC, id").all(c.id) as any[]).map(shapeItem);
  const cand = db.query("SELECT * FROM demand_candidates WHERE cluster_id = ?").get(c.id) as any;
  ctx.out({
    cluster: shapeCluster(c, ctx.jsonOut), items,
    candidate: cand ? { spec: cand.spec_md, priceGuess: cand.price_guess, priceIsGuess: !!cand.price_is_guess, landing: cand.landing_md, createdAt: cand.created_at } : null,
  }, [`agentos demand status ${c.id} building`, `agentos demand status ${c.id} dropped`]);
}
export function insertItem(db: Database, it: { source: string; externalId?: string | null; client?: string | null; text: string; askedAt?: string | null }, now: string) {
  if (it.externalId && db.query("SELECT 1 FROM demand_items WHERE source = ? AND external_id = ?").get(it.source, it.externalId)) return null;
  return db.query("INSERT INTO demand_items (source, external_id, client_slug, text, asked_at, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
    .get(it.source, it.externalId ?? null, it.client ?? null, it.text.trim(), it.askedAt ?? null, now) as any;
}
function sourceOf(a: Args, ctx: ModCtx, d: string) {
  const s = ctx.str(a, "source") ?? d;
  if (!(DEMAND_SOURCES as readonly string[]).includes(s)) throw new ctx.UserError(`--source is one of ${DEMAND_SOURCES.join(", ")}.`);
  return s;
}
function add(db: Database, a: Args, ctx: ModCtx) {
  const text = a._.slice(2).join(" ").trim();
  if (text.length < 4) throw new ctx.UserError('agentos demand add "WhatsApp order status for customers" --client dad-shop');
  const at = ctx.str(a, "at");
  if (at && Number.isNaN(Date.parse(at))) throw new ctx.UserError("--at takes an ISO date like 2026-10-12.");
  const r = insertItem(db, { source: sourceOf(a, ctx, "manual"), client: ctx.str(a, "client") ?? null, text, askedAt: at ? new Date(at).toISOString() : ctx.iso(ctx.now()), externalId: ctx.str(a, "external-id") ?? null }, ctx.iso(ctx.now()));
  if (!r) return ctx.out({ already: true }, ["agentos demand"]);
  ctx.out({ ok: true, action: "added", item: shapeItem(r) }, ["agentos demand"]);
}
function importFile(db: Database, a: Args, ctx: ModCtx) {
  const file = ctx.str(a, "file");
  if (!file) throw new ctx.UserError("agentos demand import --file <chat export or email thread> --source chat --client <slug>");
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { throw new ctx.UserError(`Can't read "${file}".`); }
  const source = sourceOf(a, ctx, "chat");
  const client = ctx.str(a, "client") ?? null;
  const asks = splitAsks(text, { me: ctx.str(a, "me") });
  const now = ctx.iso(ctx.now());
  let added = 0, skipped = 0;
  for (const [i, ask] of asks.entries()) {
    // The same file twice adds nothing: the external id is the file's name plus the ask's position and a hash of its text.
    const ext = `${file.replace(/^.*[\\/]/, "")}#${i}:${Bun.hash(ask.text).toString(36)}`;
    if (insertItem(db, { source, client, text: ask.text, askedAt: ask.askedAt, externalId: ext }, now)) added++; else skipped++;
  }
  ctx.out({ ok: true, action: "imported", file, source, client, added, skipped, total: asks.length }, ["agentos demand", "# the next radar run clusters them"]);
}
function status(db: Database, a: Args, ctx: ModCtx) {
  const c = clusterOf(db, a._[2], ctx);
  const s = a._[3];
  if (!(DEMAND_STATUSES as readonly string[]).includes(s ?? "")) throw new ctx.UserError(`agentos demand status ${c.id} ${DEMAND_STATUSES.join("|")}`);
  db.query("UPDATE demand_clusters SET status = ? WHERE id = ?").run(s, c.id);
  ctx.out({ ok: true, action: "status", cluster: shapeCluster({ ...c, status: s }, ctx.jsonOut) }, ["agentos demand"]);
}

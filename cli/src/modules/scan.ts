// Scan: the history of what the one lens read and where it went (camera shots, documents, shared-in links and photos,
// "say it once" voice notes). The phone server's scan module (server/modules/scan.ts) classifies and files; this CLI
// module owns the table and lets the agent and Alex look back. (v2, CAPTURE)
//   agentos scan                       the last 20: kind, title, status, where it went
//   agentos scan list [--status ready|filed|undone|failed] [--source camera|share|voice|file|document] [--limit n]
//   agentos scan show <id>             one scan with its fields and filing
// The table follows the phone store's collection shape (server/modules/_collection.ts): id, data (JSON), created_at,
// updated_at, deleted_at, rev, plus columns for queries.
import type { Database } from "bun:sqlite";
import type { Args, ModCtx, Module } from "./types";

export const DDL = `CREATE TABLE IF NOT EXISTS scan_items (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  kind TEXT,
  status TEXT,
  source TEXT,
  app TEXT
);
CREATE INDEX IF NOT EXISTS scan_items_rev ON scan_items(rev);`;

const parse = (s: unknown) => { try { return JSON.parse(String(s ?? "{}")); } catch { return {}; } };
const docOf = (r: any) => (r ? { ...parse(r.data), id: r.id, kind: r.kind, status: r.status, source: r.source, app: r.app, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at } : null);
const where = (d: any) => (d.kind === "say" ? (d.results ?? []).filter((r: any) => r.ok && !r.undone).map((r: any) => r.where).join(", ") : d.filed?.where ?? null);
const brief = (d: any) => ({ id: d.id, at: d.created_at, kind: d.kind, status: d.status, source: d.source, title: d.title ?? (d.text ? String(d.text).slice(0, 80) : null), where: where(d), by: d.filed?.by ?? null });

function list(db: Database, a: Args, c: ModCtx) {
  const status = c.str(a, "status"), source = c.str(a, "source");
  const limit = Math.max(1, Math.min(200, Number(c.str(a, "limit") ?? 20) || 20));
  const conds = ["deleted_at IS NULL"], args: any[] = [];
  if (status) { conds.push("status = ?"); args.push(status); }
  if (source) { conds.push("source = ?"); args.push(source); }
  const rows = db.query(`SELECT * FROM scan_items WHERE ${conds.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).all(...args, limit) as any[];
  c.out({ scans: rows.map((r) => brief(docOf(r))) }, ["agentos scan show <id>", "agentos scan list --status ready"]);
}
function show(db: Database, a: Args, c: ModCtx) {
  const id = a._[2];
  if (!id) throw new c.UserError("agentos scan show <id>");
  const r = db.query("SELECT * FROM scan_items WHERE id = ?").get(id);
  if (!r) throw new c.UserError(`No scan ${id}.`);
  const d = docOf(r)!;
  c.out({ scan: { ...brief(d), summary: d.summary ?? null, confidence: d.confidence ?? null, fields: d.fields ?? null, suggestion: d.suggestion ?? null, filed: d.filed ?? null, results: d.results ?? null, engine: d.engine ?? null, ms: d.ms ?? null, note: d.note ?? null, url: d.url ?? null } });
}

export const scan: Module = {
  name: "scan",
  help: "agentos scan [list --status ready|filed --source share|camera|voice] | show <id>   what the lens read and where it went (v2)",
  migrate: (db) => db.exec(DDL),
  run(db, a, c) {
    const sub = a._[1] ?? "list";
    if (sub === "list") return list(db, a, c);
    if (sub === "show") return show(db, a, c);
    throw new c.UserError(`agentos scan ${sub}? Try: agentos scan list | show <id>`);
  },
};

// The server half of the app's offline store (app/js/svc/store.js): one table per collection, upsert by the client's
// id, last write wins by updated_at, soft deletes, and a cursor so a phone pulls only what changed. A module mounts
// it on a path and gets every route below for free (v2/notes/engine.md "The store contract").
//
//   GET    /api/v1/mod/<module>/<path>?since=<cursor> → { items, cursor }   (since: changed rows, tombstones included)
//   GET    /api/v1/mod/<module>/<path>/<id>           → { item }            404 when unknown
//   PUT    /api/v1/mod/<module>/<path>/<id>  doc      → { item }            upsert; an older updated_at loses
//   POST   /api/v1/mod/<module>/<path>       doc      → { item }            the same upsert, id in the body
//   DELETE /api/v1/mod/<module>/<path>/<id>           → { item }            soft delete; idempotent
//
// Usage in server/modules/<name>.ts:
//   import { mountCollection } from "./_collection";
//   const expenses = mountCollection({ table: "money_expenses", columns: { amount: "real", note: "text", at: "text", category: "text" },
//     validate: (d) => (typeof d.amount === "number" ? null : "amount is a number") });
//   handle: async (ctx) => (await expenses.handle(ctx, "/expenses")) ?? null,
// The table belongs to the agentos CLI module (its migrate creates it; collectionDDL() prints the shape to copy).
// Pass ensure: true to create it on first use while a module is being built.
import type { Database } from "bun:sqlite";
import type { ModCtx } from "./types";

export type ColumnType = "text" | "real" | "integer" | "json" | "bool";
export type CollectionSpec = {
  table: string;                                   // <module>_<name>, e.g. money_expenses (agentos prefix rule)
  columns?: Record<string, ColumnType>;            // doc fields with a column of their own (for queries); the rest go in data
  validate?: (doc: any, current: any | null) => string | null;   // a message refuses the write with 400
  onWrite?: (doc: any, ctx: ModCtx, op: "put" | "delete") => void | Promise<void>;
  ensure?: boolean;                                // CREATE TABLE IF NOT EXISTS on first use (development)
  limit?: number;                                  // items per GET, default 5000
};
export type Collection = {
  handle: (ctx: ModCtx, path: string) => Promise<Response | null>;
  list: (db: Database, o?: { since?: number | null; deleted?: boolean }) => { items: any[]; cursor: string };
  get: (db: Database, id: string) => any | null;
  upsert: (db: Database, doc: any) => { item: any; written: boolean };
  remove: (db: Database, id: string) => any;
};

const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const SQL_TYPE: Record<ColumnType, string> = { text: "TEXT", real: "REAL", integer: "INTEGER", json: "TEXT", bool: "INTEGER" };
const META = new Set(["id", "created_at", "updated_at", "deleted_at", "rev", "data"]);
const isIso = (s: unknown) => typeof s === "string" && !Number.isNaN(Date.parse(s));

/** The table a collection needs. Copy it into the agentos module's migrate(db). */
export function collectionDDL(spec: Pick<CollectionSpec, "table" | "columns">): string {
  if (!NAME.test(spec.table)) throw new Error(`Bad table name ${spec.table}`);
  const cols = Object.entries(spec.columns ?? {}).map(([k, t]) => {
    if (!NAME.test(k) || META.has(k)) throw new Error(`Bad column ${k}`);
    return `,\n  ${k} ${SQL_TYPE[t]}`;
  }).join("");
  return `CREATE TABLE IF NOT EXISTS ${spec.table} (\n  id TEXT PRIMARY KEY,\n  data TEXT NOT NULL DEFAULT '{}',\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  deleted_at TEXT,\n  rev INTEGER NOT NULL DEFAULT 0${cols}\n);\nCREATE INDEX IF NOT EXISTS ${spec.table}_rev ON ${spec.table}(rev);`;
}

export function mountCollection(spec: CollectionSpec): Collection {
  if (!NAME.test(spec.table)) throw new Error(`Bad table name ${spec.table}`);
  const columns = spec.columns ?? {};
  for (const k of Object.keys(columns)) if (!NAME.test(k) || META.has(k)) throw new Error(`Bad column ${k}`);
  const limit = spec.limit ?? 5000;
  const T = spec.table;
  const ready = new WeakSet<Database>();
  const prepare = (db: Database) => {
    if (ready.has(db)) return;
    if (spec.ensure) db.exec(collectionDDL(spec));
    ready.add(db);
  };

  const toRow = (doc: any) => {
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(doc)) if (!META.has(k) && !(k in columns)) rest[k] = v;
    const row: Record<string, unknown> = { id: doc.id, data: JSON.stringify(rest), created_at: doc.created_at, updated_at: doc.updated_at, deleted_at: doc.deleted_at ?? null };
    for (const [k, t] of Object.entries(columns)) {
      const v = doc[k];
      row[k] = v == null ? null : t === "json" ? JSON.stringify(v) : t === "bool" ? (v ? 1 : 0) : t === "real" || t === "integer" ? Number(v) : String(v);
    }
    return row;
  };
  const toDoc = (r: any) => {
    if (!r) return null;
    let rest: Record<string, unknown> = {};
    try { rest = JSON.parse(r.data ?? "{}"); } catch {}
    const doc: Record<string, unknown> = { ...rest, id: r.id, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at ?? null };
    for (const [k, t] of Object.entries(columns)) {
      const v = r[k];
      if (v == null) { doc[k] = null; continue; }
      if (t === "json") { try { doc[k] = JSON.parse(v); } catch { doc[k] = null; } }
      else if (t === "bool") doc[k] = !!v;
      else doc[k] = v;
    }
    return doc;
  };
  const nextRev = (db: Database) => ((db.query(`SELECT coalesce(max(rev), 0) + 1 AS r FROM ${T}`).get() as any).r as number);
  const get = (db: Database, id: string) => { prepare(db); return toDoc(db.query(`SELECT * FROM ${T} WHERE id = ?`).get(id)); };
  const write = (db: Database, doc: any) => {
    const row = toRow(doc);
    row.rev = nextRev(db);
    const keys = Object.keys(row);
    db.query(`INSERT INTO ${T} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
      ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`).run(...(Object.values(row) as any[]));
  };

  function list(db: Database, { since = null, deleted = false }: { since?: number | null; deleted?: boolean } = {}) {
    prepare(db);
    const rows = (since != null
      ? db.query(`SELECT * FROM ${T} WHERE rev > ? ORDER BY rev LIMIT ?`).all(since, limit)
      : db.query(`SELECT * FROM ${T} ${deleted ? "" : "WHERE deleted_at IS NULL"} ORDER BY rev LIMIT ?`).all(limit)) as any[];
    // the cursor is where this answer ends, so a capped answer is picked up from there next time
    const top = rows.length >= limit ? rows[rows.length - 1].rev : (db.query(`SELECT coalesce(max(rev), 0) AS r FROM ${T}`).get() as any).r;
    return { items: rows.map(toDoc), cursor: String(top) };
  }
  function upsert(db: Database, input: any) {
    prepare(db);
    const now = new Date().toISOString();
    const cur = get(db, input.id);
    const doc = { ...input, id: input.id, created_at: cur?.created_at ?? (isIso(input.created_at) ? input.created_at : now), updated_at: isIso(input.updated_at) ? input.updated_at : now, deleted_at: input.deleted_at ?? null };
    // last write wins: a write older than what the PC has loses, and the caller gets the newer copy back.
    // The same updated_at again is a replay of a write the PC already has (a lost reply): nothing changes.
    if (cur && String(cur.updated_at) >= String(doc.updated_at)) return { item: cur, written: false };
    db.transaction(() => write(db, doc))();
    return { item: get(db, doc.id), written: true };
  }
  function remove(db: Database, id: string) {
    prepare(db);
    const now = new Date().toISOString();
    const cur = get(db, id);
    if (cur?.deleted_at) return cur;
    db.transaction(() => write(db, { ...(cur ?? { id, created_at: now }), deleted_at: now, updated_at: now }))();
    return get(db, id);
  }

  async function handle(ctx: ModCtx, base: string): Promise<Response | null> {
    const b = base.replace(/\/+$/, "");
    if (ctx.path !== b && !ctx.path.startsWith(`${b}/`)) return null;
    const rest = ctx.path.slice(b.length).replace(/^\//, "");
    if (rest.includes("/")) return null;
    const id = rest ? decodeURIComponent(rest) : null;
    if (id != null && !ID.test(id)) return ctx.fail(400, "Bad id.");
    let db: Database;
    try { db = ctx.db(); prepare(db); db.query(`SELECT 1 FROM ${T} LIMIT 1`).get(); }
    catch { return ctx.fail(503, "This app's data isn't set up on your PC yet."); }
    const m = ctx.method;
    if (m === "GET" && id == null) {
      const s = ctx.url.searchParams.get("since");
      const since = s != null && s !== "" && Number.isFinite(Number(s)) ? Number(s) : null;
      return ctx.json(list(db, { since }));
    }
    if (m === "GET") { const item = get(db, id!); return item ? ctx.json({ item }) : ctx.fail(404, "Not found."); }
    if (m === "DELETE" && id != null) {
      const item = remove(db, id);
      await spec.onWrite?.(item, ctx, "delete");
      return ctx.json({ item });
    }
    if ((m === "PUT" && id != null) || (m === "POST" && id == null)) {
      const body = await ctx.body();
      if (!body || typeof body !== "object" || Array.isArray(body)) return ctx.fail(400, "Send the record as a JSON object.");
      const docId = id ?? (body.id != null ? String(body.id) : `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
      if (!ID.test(docId)) return ctx.fail(400, "Bad id.");
      if (id != null && body.id != null && String(body.id) !== id) return ctx.fail(400, "The id in the body doesn't match the path.");
      const doc = { ...body, id: docId };
      const msg = spec.validate?.(doc, get(db, docId));
      if (msg) return ctx.fail(400, msg);
      const r = upsert(db, doc);
      if (r.written) await spec.onWrite?.(r.item, ctx, "put");
      return ctx.json({ item: r.item }, m === "POST" && r.written ? 201 : 200);
    }
    return null;
  }

  return { handle, list, get, upsert, remove };
}

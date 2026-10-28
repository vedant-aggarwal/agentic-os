// The Cabinet: one advocate per area argues for next week; a referee turns the agreement into pencilled
// blocks (an ai_batches batch of kind "cabinet") and leaves what could not be settled as conflicts.
// The negotiation itself runs in the phone server (server/modules/cabinet.ts); this module owns the tables
// and the read side: sessions, turns, outcomes and the advocates' standing briefs.
//   agentos cabinet                      sessions, newest first
//   agentos cabinet show <id>            one session with every turn and outcome
//   agentos cabinet advocates            the standing briefs (an area without a row gets the default brief)
//   agentos cabinet advocate <area> --brief "..." [--kpis "a, b"] [--on|--off]
import type { Database } from "bun:sqlite";
import type { Args, Module } from "./types";
import { findArea } from "./price";

/** A week is named by its Monday (YYYY-MM-DD); weeks run Monday to Sunday like the goals module. */
export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5);
  return monday.toISOString().slice(0, 10);
}
export const plusDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** this | next | prev | a date inside the week → that week's Monday. */
export function weekFrom(input: string | undefined, today: string): string {
  const s = String(input ?? "this").trim().toLowerCase();
  if (s === "this" || s === "current" || s === "") return mondayOf(today);
  if (s === "next") return plusDays(mondayOf(today), 7);
  if (s === "prev" || s === "last") return plusDays(mondayOf(today), -7);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))) return mondayOf(s);
  throw new Error(`Can't read the week "${input}". Use this, next, prev or a date.`);
}

export function defaultBrief(name: string) {
  return `Speak for ${name}: ask for the hours its open tasks and standing blocks need next week, cite its deadlines and goals, and concede where another area's deadline is harder.`;
}
export function advocateRows(db: Database) {
  return (db.query(`SELECT a.slug AS area, a.name, a.color, c.brief, c.kpis, c.active, c.updated_at
    FROM areas a LEFT JOIN cabinet_advocates c ON c.area = a.slug ORDER BY a.sort`).all() as any[]).map((r) => {
    let kpis: string[] = [];
    try { kpis = r.kpis ? JSON.parse(r.kpis) : []; } catch {}
    return { area: r.area, name: r.name, color: r.color, brief: r.brief || defaultBrief(r.name), kpis, active: r.active == null ? true : !!r.active,
      custom: r.brief != null, updated_at: r.updated_at ?? null };
  });
}
export function sessionRows(db: Database, limit = 20) {
  return (db.query(`SELECT s.*,
      (SELECT count(*) FROM cabinet_outcomes o WHERE o.session_id = s.id AND o.kind = 'block') AS blocks,
      (SELECT count(*) FROM cabinet_outcomes o WHERE o.session_id = s.id AND o.kind = 'block' AND o.status = 'kept') AS kept,
      (SELECT count(*) FROM cabinet_outcomes o WHERE o.session_id = s.id AND o.kind = 'conflict') AS conflicts,
      (SELECT count(*) FROM cabinet_outcomes o WHERE o.session_id = s.id AND o.kind = 'conflict' AND o.status = 'open') AS open_conflicts,
      (SELECT count(*) FROM cabinet_turns t WHERE t.session_id = s.id) AS turns
    FROM cabinet_sessions s ORDER BY s.id DESC LIMIT ?`).all(limit) as any[]).map(shapeSession);
}
function shapeSession(s: any) {
  return { id: `c${s.id}`, week: s.week, status: s.status, started_at: s.started_at, settled_at: s.settled_at ?? null,
    summary: s.summary ?? "", batch: s.batch_id ? `b${s.batch_id}` : null, model: s.model ?? null, ms: s.ms ?? null, error: s.error ?? null,
    blocks: s.blocks ?? 0, kept: s.kept ?? 0, conflicts: s.conflicts ?? 0, open_conflicts: s.open_conflicts ?? 0, turns: s.turns ?? 0 };
}
const parse = (s: string, d: any) => { try { return JSON.parse(s); } catch { return d; } };
export function sessionDetail(db: Database, id: number) {
  const s = sessionRows(db, 1000).find((x) => x.id === `c${id}`);
  if (!s) return null;
  const turns = (db.query("SELECT * FROM cabinet_turns WHERE session_id = ? ORDER BY round, id").all(id) as any[])
    .map((t) => ({ id: t.id, round: t.round, advocate: t.advocate, text: t.text, asks: parse(t.asks, []), model: t.model ?? null, ms: t.ms ?? null, created_at: t.created_at }));
  const outcomes = (db.query("SELECT * FROM cabinet_outcomes WHERE session_id = ? ORDER BY kind DESC, id").all(id) as any[])
    .map((o) => ({ id: o.id, kind: o.kind, status: o.status, reason: o.reason ?? null, payload: parse(o.payload, {}), created_at: o.created_at, decided_at: o.decided_at ?? null }));
  return { session: s, turns, outcomes };
}

export const cabinet: Module = {
  name: "cabinet",
  help: `agentos cabinet [show <id>]        weekly cabinet sessions: the advocates' turns, settled blocks, open conflicts
agentos cabinet advocates          one advocate per area and its standing brief
agentos cabinet advocate <area> --brief "..." [--kpis "a, b"] [--on|--off]`,
  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cabinet_advocates (area TEXT PRIMARY KEY REFERENCES areas(slug) ON DELETE CASCADE,
        brief TEXT, kpis TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cabinet_sessions (id INTEGER PRIMARY KEY, week TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
        started_at TEXT NOT NULL, settled_at TEXT, summary TEXT, batch_id INTEGER, model TEXT, ms INTEGER, error TEXT);
      CREATE TABLE IF NOT EXISTS cabinet_turns (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES cabinet_sessions(id) ON DELETE CASCADE,
        round INTEGER NOT NULL DEFAULT 1, advocate TEXT NOT NULL, text TEXT NOT NULL, asks TEXT NOT NULL DEFAULT '[]', model TEXT, ms INTEGER, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cabinet_outcomes (id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES cabinet_sessions(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', reason TEXT, created_at TEXT NOT NULL, decided_at TEXT);
      CREATE INDEX IF NOT EXISTS cabinet_sessions_week ON cabinet_sessions(week, id);
      CREATE INDEX IF NOT EXISTS cabinet_turns_session ON cabinet_turns(session_id, round);
      CREATE INDEX IF NOT EXISTS cabinet_outcomes_session ON cabinet_outcomes(session_id, kind, status);
    `);
  },
  run(db, a: Args, ctx) {
    const sub = a._[1];
    if (sub === "show") {
      const id = Number(String(a._[2] ?? "").replace(/^c/i, ""));
      const d = Number.isInteger(id) && id > 0 ? sessionDetail(db, id) : null;
      if (!d) throw new ctx.UserError(`No session "${a._[2] ?? ""}". List them: agentos cabinet`);
      if (ctx.jsonOut) return ctx.out(d, ["agentos cabinet"]);
      return ctx.out({
        session: d.session,
        turns: d.turns.map((t) => ({ round: t.round, advocate: t.advocate, asks: t.asks.length, text: t.text })),
        outcomes: d.outcomes.map((o) => ({ id: o.id, kind: o.kind, status: o.status,
          what: o.kind === "block" ? `${o.payload.date ?? ""} ${o.payload.start ?? ""}-${o.payload.end ?? ""} ${o.payload.title ?? ""}`.trim() : String(o.payload.question ?? ""),
          reason: o.reason ?? "" })),
      }, ["agentos cabinet", "agentos ai show <batch>  # the pencilled blocks as proposals"]);
    }
    if (sub === "advocates") {
      const rows = advocateRows(db);
      return ctx.out({ count: rows.length, advocates: rows.map((r) => (ctx.jsonOut ? r : { area: r.area, active: r.active, kpis: r.kpis.join(", "), brief: r.brief })) },
        ['agentos cabinet advocate <area> --brief "<what it fights for>" --kpis "<a, b>"', "agentos cabinet advocate <area> --off"]);
    }
    if (sub === "advocate") {
      const area = findArea(db, a._[2], ctx.UserError);
      const brief = ctx.str(a, "brief");
      const kpisIn = ctx.str(a, "kpis");
      const on = a.flags.on ? 1 : a.flags.off ? 0 : null;
      if (brief === undefined && kpisIn === undefined && on === null) throw new ctx.UserError('Nothing to change. Pass --brief "...", --kpis "a, b", --on or --off.');
      if (brief !== undefined && brief.trim().length > 1000) throw new ctx.UserError("Keep a brief under 1,000 characters.");
      const cur = db.query("SELECT * FROM cabinet_advocates WHERE area = ?").get(area) as any;
      const kpis = kpisIn === undefined ? (cur?.kpis ?? "[]") : JSON.stringify(kpisIn.split(/\s*,\s*/).map((k) => k.trim()).filter(Boolean).slice(0, 8));
      db.query(`INSERT INTO cabinet_advocates (area, brief, kpis, active, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(area) DO UPDATE SET brief = excluded.brief, kpis = excluded.kpis, active = excluded.active, updated_at = excluded.updated_at`)
        .run(area, brief === undefined ? (cur?.brief ?? null) : brief.trim() || null, kpis, on ?? (cur?.active ?? 1), ctx.iso());
      return ctx.out({ ok: true, action: cur ? "updated" : "added", advocate: advocateRows(db).find((r) => r.area === area) }, ["agentos cabinet advocates"]);
    }
    if (sub) throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos cabinet [show <id> | advocates | advocate <area> ...]`);
    const sessions = sessionRows(db, Number(ctx.str(a, "limit") ?? 20));
    ctx.out({ count: sessions.length, sessions: sessions.map((s) => (ctx.jsonOut ? s : { id: s.id, week: s.week, status: s.status, blocks: s.blocks, kept: s.kept,
      conflicts: `${s.open_conflicts} open of ${s.conflicts}`, summary: s.summary }))},
    [sessions[0] ? `agentos cabinet show ${sessions[0].id}` : "POST /api/v1/mod/cabinet/run on the phone server starts a session", "agentos cabinet advocates"]);
  },
};

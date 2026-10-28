// Soul: habits and check-ins (forgiving streaks), the Clean streak (behind Face ID in the app), urges, the blocker's
// locks, its asks and unlock talks, values and the nightly reflection. (v2)
// Every table has the phone store's shape (server/modules/_collection.ts: id, data, created_at, updated_at, deleted_at,
// rev + a few columns), so the phone, widgets, Siri and this CLI all write the same records.
//   agentos soul                         today: habits done, the next lock, Clean only as "Day N"
//   agentos soul habits                  every habit with its streak
//   agentos soul habit add "<title>" [--part morning|evening] [--at HH:MM] [--aspect body] [--of 20 --unit pages]
//   agentos soul check <habit> [--undo] [--rest] [--count n] [--date YYYY-MM-DD]
//   agentos soul urge [--place ..] [--feel ..] [--before ..] [--slip] [--mins n]
//   agentos soul locks
// The streak rule lives in phone/app/js/aspects/soul-logic.js (the app and the server run it); streakOf() below is
// the same rule, kept small so the CLI needs nothing outside this repo.
import type { Database } from "bun:sqlite";
import type { Args, ModCtx, Module } from "./types";

type Cols = Record<string, "text" | "real" | "integer" | "json" | "bool">;
export const SOUL_TABLES: Record<string, Cols> = {
  soul_habits: { title: "text", part: "text", sort: "integer" },
  soul_checks: { habit: "text", date: "text", done: "bool" },
  soul_clean: { since: "text" },
  soul_resets: { tracker: "text", at: "text" },
  soul_urges: { at: "text", out: "text" },
  soul_moods: { date: "text", v: "integer" },
  soul_locks: { kind: "text", active: "bool" },
  soul_asks: { date: "text", state: "text" },
  soul_talks: { date: "text", out: "text" },
  soul_values: { name: "text", sort: "integer" },
  soul_reflections: { date: "text", value: "text", v: "integer" },
};
const SQL: Record<string, string> = { text: "TEXT", real: "REAL", integer: "INTEGER", json: "TEXT", bool: "INTEGER" };
export function soulDDL(table: string): string {
  const cols = Object.entries(SOUL_TABLES[table]).map(([k, t]) => `,\n  ${k} ${SQL[t]}`).join("");
  return `CREATE TABLE IF NOT EXISTS ${table} (\n  id TEXT PRIMARY KEY,\n  data TEXT NOT NULL DEFAULT '{}',\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  deleted_at TEXT,\n  rev INTEGER NOT NULL DEFAULT 0${cols}\n);\nCREATE INDEX IF NOT EXISTS ${table}_rev ON ${table}(rev);`;
}

// ── records in the store's shape ─────────────────────────────────────────
const META = new Set(["id", "created_at", "updated_at", "deleted_at", "rev", "data"]);
function toDoc(table: string, r: any) {
  if (!r) return null;
  let rest: any = {};
  try { rest = JSON.parse(r.data ?? "{}"); } catch {}
  const doc: any = { ...rest, id: r.id, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at ?? null };
  for (const [k, t] of Object.entries(SOUL_TABLES[table])) doc[k] = r[k] == null ? null : t === "bool" ? !!r[k] : t === "json" ? JSON.parse(r[k]) : r[k];
  return doc;
}
export function rows(db: Database, table: string, { deleted = false } = {}) {
  return (db.query(`SELECT * FROM ${table} ${deleted ? "" : "WHERE deleted_at IS NULL"} ORDER BY rev`).all() as any[]).map((r) => toDoc(table, r));
}
export function put(db: Database, table: string, doc: any, nowIso: string) {
  const cols = SOUL_TABLES[table];
  const cur = db.query(`SELECT created_at FROM ${table} WHERE id = ?`).get(doc.id) as any;
  const rest: any = {};
  for (const [k, v] of Object.entries(doc)) if (!META.has(k) && !(k in cols)) rest[k] = v;
  const row: Record<string, any> = { id: doc.id, data: JSON.stringify(rest), created_at: cur?.created_at ?? doc.created_at ?? nowIso, updated_at: nowIso, deleted_at: doc.deleted_at ?? null };
  for (const [k, t] of Object.entries(cols)) { const v = doc[k]; row[k] = v == null ? null : t === "bool" ? (v ? 1 : 0) : t === "json" ? JSON.stringify(v) : v; }
  row.rev = ((db.query(`SELECT coalesce(max(rev), 0) + 1 AS r FROM ${table}`).get() as any).r);
  const keys = Object.keys(row);
  db.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
    ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`).run(...Object.values(row));
  return toDoc(table, db.query(`SELECT * FROM ${table} WHERE id = ?`).get(doc.id));
}

// ── the forgiving streak (same rule as soul-logic.js habitState) ─────────
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = (d: string) => { const x = new Date(`${d}T00:00:00Z`).getUTCDay(); return x === 0 ? 7 : x; };
const istDate = (ms: number) => new Date(ms + 330 * 6e4).toISOString().slice(0, 10);
export function streakOf(h: any, checks: any[], today: string) {
  const by = new Map<string, any>();
  for (const c of checks) {
    if (c.habit !== h.id || c.deleted_at) continue;
    const date = c.date ?? (c.at ? istDate(Date.parse(c.at)) : null);
    if (date && (!by.has(date) || String(c.updated_at) > String(by.get(date).updated_at))) by.set(date, c);
  }
  const start = h.start ?? (h.created_at ? istDate(Date.parse(h.created_at)) : today);
  let run = 0, misses = 0, best = 0;
  for (let d = start < addDays(today, -400) ? addDays(today, -400) : start; d <= today; d = addDays(d, 1)) {
    const c = by.get(d);
    const done = !!c && !c.rest && (c.done === true || (h.of > 0 && Number(c.count) >= h.of));
    if (c?.rest) continue;
    if (done) { run += 1; misses = 0; best = Math.max(best, run); continue; }
    if (Array.isArray(h.days) && h.days.length && !h.days.includes(dow(d))) continue;
    if (d === today) continue;
    misses += 1; if (misses >= 2) run = 0;
  }
  const t = by.get(today);
  return { streak: run, best, today: !!t && !t.rest && (t.done === true || (h.of > 0 && Number(t.count) >= h.of)), rest: !!t?.rest };
}
const checkId = (habit: string, date: string) => `c_${habit.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 50)}_${date}`;
const newId = (p: string) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function findHabit(db: Database, q: string | undefined, UserError: ModCtx["UserError"]) {
  const hs = rows(db, "soul_habits").filter((h) => !h.archived);
  const s = String(q ?? "").trim().toLowerCase();
  if (!s) throw new UserError(`Which habit? ${hs.map((h) => h.id).join(", ") || "none yet: agentos soul habit add \"<title>\""}`);
  const hit = hs.find((h) => h.id === q) ?? hs.find((h) => h.title.toLowerCase() === s);
  if (hit) return hit;
  const some = hs.filter((h) => h.title.toLowerCase().includes(s));
  if (some.length === 1) return some[0];
  throw new UserError(some.length ? `"${q}" matches ${some.map((h) => h.title).join(" and ")}. Use the id.` : `No habit "${q}".`);
}

export function soulStatus(db: Database, nowMs: number) {
  const today = istDate(nowMs);
  const checks = rows(db, "soul_checks");
  const habits = rows(db, "soul_habits").filter((h) => !h.archived).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((h) => ({ id: h.id, title: h.title, part: h.part, at: h.at ?? null, ...streakOf(h, checks, today) }));
  const clean = rows(db, "soul_clean").find((c) => c.since && c.active !== false);
  return {
    date: today,
    habits: { done: habits.filter((h) => h.today).length, total: habits.length, items: habits },
    // private: outside the app's Clean tab it is only ever the day he is on
    clean: clean ? { text: `Day ${Math.floor(Math.max(0, nowMs - Date.parse(clean.since)) / 864e5) + 1}`, private: true } : null,
    locks: rows(db, "soul_locks").filter((l) => l.active !== false && l.kind !== "now").map((l) => ({ id: l.id, name: l.name, kind: l.kind, start: l.start ?? null, end: l.end ?? null })),
    ask: rows(db, "soul_asks").find((a) => a.date === today && a.state === "pending") ?? null,
  };
}

export const soul: Module = {
  name: "soul",
  help: `agentos soul                      Soul today: habits, the next lock, Clean only as "Day N"
agentos soul habits | locks
agentos soul habit add "<title>" [--part morning|evening] [--at HH:MM] [--aspect <id>] [--of n --unit pages]
agentos soul check <habit> [--undo] [--rest] [--count n] [--date YYYY-MM-DD]
agentos soul urge [--place ..] [--feel ..] [--before ..] [--slip] [--mins n]`,
  migrate(db) { for (const t of Object.keys(SOUL_TABLES)) db.exec(soulDDL(t)); },
  run(db, a: Args, ctx) {
    const [, sub, arg] = a._;
    const now = ctx.now(); const nowMs = now.getTime(); const iso = ctx.iso(now);
    if (!sub) return ctx.out(soulStatus(db, nowMs), ["agentos soul habits", "agentos soul check <habit>"]);
    if (sub === "habits") return ctx.out({ habits: soulStatus(db, nowMs).habits.items }, ["agentos soul habit add \"<title>\""]);
    if (sub === "locks") return ctx.out({ locks: rows(db, "soul_locks").map((l) => ({ id: l.id, name: l.name, kind: l.kind, active: l.active, start: l.start ?? null, end: l.end ?? null, apps: l.apps ?? [] })) });
    if (sub === "habit" && arg === "add") {
      const title = String(a._[3] ?? "").trim();
      if (!title || title.length > 60) throw new ctx.UserError('A habit needs a title of 1 to 60 characters: agentos soul habit add "Read 20 pages"');
      const part = ctx.str(a, "part") ?? "morning";
      if (!["morning", "evening"].includes(part)) throw new ctx.UserError("--part is morning or evening");
      const at = ctx.str(a, "at");
      if (at && !/^\d{1,2}:\d{2}$/.test(at)) throw new ctx.UserError("--at is HH:MM");
      const of = ctx.str(a, "of") ? Number(ctx.str(a, "of")) : null;
      if (of != null && !(of > 0)) throw new ctx.UserError("--of is a positive number");
      const sort = rows(db, "soul_habits").length;
      const h = put(db, "soul_habits", { id: newId("hab_"), title, part, at: at ?? null, aspect: ctx.str(a, "aspect") ?? null, of, unit: ctx.str(a, "unit") ?? null, by: "you", icon: "seedling", sort, start: istDate(nowMs) }, iso);
      return ctx.out({ ok: true, habit: h }, [`agentos soul check ${h.id}`]);
    }
    if (sub === "check") {
      const h = findHabit(db, arg, ctx.UserError);
      const date = ctx.str(a, "date") ?? istDate(nowMs);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ctx.UserError("--date is YYYY-MM-DD");
      const id = checkId(h.id, date);
      const count = ctx.str(a, "count") != null ? Number(ctx.str(a, "count")) : null;
      const doc = a.flags.undo
        ? { id, habit: h.id, date, at: iso, done: false, rest: false, source: "cli", deleted_at: iso }
        : { id, habit: h.id, date, at: iso, done: count == null ? !a.flags.rest : h.of > 0 && count >= h.of, rest: !!a.flags.rest, count, source: "cli", by: "you" };
      put(db, "soul_checks", doc, iso);
      const s = streakOf(h, rows(db, "soul_checks"), istDate(nowMs));
      return ctx.out({ ok: true, habit: h.id, title: h.title, date, ...s });
    }
    if (sub === "urge") {
      const mins = ctx.str(a, "mins") != null ? Number(ctx.str(a, "mins")) : null;
      const u = put(db, "soul_urges", { id: newId("urg_"), at: iso, place: ctx.str(a, "place") ?? null, feel: ctx.str(a, "feel") ?? null, before: ctx.str(a, "before") ?? null, out: a.flags.slip ? "slip" : "rode", mins, source: "cli" }, iso);
      return ctx.out({ ok: true, urge: { id: u.id, at: u.at, out: u.out } });
    }
    throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos soul [habits | locks | habit add | check | urge]`);
  },
};

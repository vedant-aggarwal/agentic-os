// Mission (v2): what goals don't carry themselves. Goals stay core (src/goals.ts: goals on horizons, v3; aspects, v5);
// this module adds the purpose and its versions, milestones and check-ins per goal, notes per horizon period, the
// lifetime directions, and a daily history of every goal's progress for the mission graph (done vs set over time).
//   agentos mission                                   purpose, counts, streak, today's history row
//   agentos mission purpose [set "<text>"]            the purpose statement and its earlier versions
//   agentos mission milestones <goal>                 a goal's milestones (goal: g4 or 4)
//   agentos mission milestone add <goal> "<title>" [--due YYYY-MM-DD] | done <id> | undo <id> | drop <id>
//   agentos mission checkin <goal> on|risk|off [--note "..."]    | checkins <goal>
//   agentos mission note <week|month|quarter|year|decade|life> "<body>" [--period 2026-W43]
//   agentos mission life [add "<title>" --fam work|health|people]  · snapshot · graph · history <goal>
// The phone's offline store syncs the collection tables (mission_purpose, _milestones, _checkins, _notes, _life) through
// /api/v1/mod/mission/<plural> (server/modules/_collection.ts shape: id, data, created_at, updated_at, deleted_at, rev).
import type { Database } from "bun:sqlite";
import { HORIZONS, periodOf, type Horizon } from "../goals";
import type { Args, ModCtx, Module } from "./types";

// ── tables ─────────────────────────────────────────────────────────────
const COLL = `id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted_at TEXT, rev INTEGER NOT NULL DEFAULT 0`;
/** Collection columns, shared with server/modules/mission.ts so both sides agree on the shape. */
export const MISSION_COLLECTIONS = {
  purpose: { table: "mission_purpose", columns: { text: "text" } },
  milestones: { table: "mission_milestones", columns: { goal: "text", title: "text", done: "bool", due: "text", position: "real", done_at: "text" } },
  checkins: { table: "mission_checkins", columns: { goal: "text", state: "text", note: "text", by: "text", at: "text", progress: "real" } },
  notes: { table: "mission_notes", columns: { horizon: "text", period: "text", body: "text" } },
  life: { table: "mission_life", columns: { title: "text", fam: "text", position: "real" } },
} as const;
const SQL: Record<string, string> = { text: "TEXT", real: "REAL", bool: "INTEGER", integer: "INTEGER", json: "TEXT" };

export function migrateMission(db: Database) {
  for (const { table, columns } of Object.values(MISSION_COLLECTIONS)) {
    const cols = Object.entries(columns).map(([k, t]) => `, ${k} ${SQL[t]}`).join("");
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${COLL}${cols}); CREATE INDEX IF NOT EXISTS ${table}_rev ON ${table}(rev);`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS mission_milestones_goal ON mission_milestones(goal);
    CREATE INDEX IF NOT EXISTS mission_checkins_goal ON mission_checkins(goal, at);
    CREATE TABLE IF NOT EXISTS mission_history (date TEXT NOT NULL, goal TEXT NOT NULL, horizon TEXT, period TEXT,
      status TEXT NOT NULL, progress REAL NOT NULL, time REAL, PRIMARY KEY (date, goal));`);
}

// ── collection docs (the same rules as the server's _collection.ts: upsert by id, rev counter, soft delete) ──
const nowIso = () => new Date().toISOString();
const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
type Kind = keyof typeof MISSION_COLLECTIONS;
function toDoc(kind: Kind, r: any) {
  if (!r) return null;
  const cols = MISSION_COLLECTIONS[kind].columns as Record<string, string>;
  let rest: Record<string, unknown> = {};
  try { rest = JSON.parse(r.data ?? "{}"); } catch {}
  const doc: Record<string, unknown> = { ...rest, id: r.id, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at ?? null };
  for (const [k, t] of Object.entries(cols)) doc[k] = r[k] == null ? null : t === "bool" ? !!r[k] : r[k];
  return doc as any;
}
export function getDoc(db: Database, kind: Kind, id: string) {
  return toDoc(kind, db.query(`SELECT * FROM ${MISSION_COLLECTIONS[kind].table} WHERE id = ?`).get(id));
}
export function listDocs(db: Database, kind: Kind, where = "", ...args: any[]) {
  const T = MISSION_COLLECTIONS[kind].table;
  return (db.query(`SELECT * FROM ${T} WHERE deleted_at IS NULL ${where ? `AND ${where}` : ""} ORDER BY rev`).all(...args) as any[]).map((r) => toDoc(kind, r));
}
/** Upsert a doc the way the phone's store does; fields not given keep their stored value. */
export function putDoc(db: Database, kind: Kind, input: Record<string, any>) {
  const { table: T, columns } = MISSION_COLLECTIONS[kind];
  const cols = columns as Record<string, string>;
  const cur = input.id ? getDoc(db, kind, input.id) : null;
  const now = nowIso();
  const doc = { ...(cur ?? {}), ...input, id: input.id ?? newId(kind.slice(0, 2)), created_at: cur?.created_at ?? now, updated_at: now, deleted_at: input.deleted_at ?? null };
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!["id", "created_at", "updated_at", "deleted_at", "rev", "data"].includes(k) && !(k in cols)) rest[k] = v;
  const row: Record<string, any> = { id: doc.id, data: JSON.stringify(rest), created_at: doc.created_at, updated_at: doc.updated_at, deleted_at: doc.deleted_at };
  for (const [k, t] of Object.entries(cols)) { const v = doc[k]; row[k] = v == null ? null : t === "bool" ? (v ? 1 : 0) : t === "real" ? Number(v) : String(v); }
  row.rev = (db.query(`SELECT coalesce(max(rev), 0) + 1 AS r FROM ${T}`).get() as any).r;
  const keys = Object.keys(row);
  db.query(`INSERT INTO ${T} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
    ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`).run(...Object.values(row));
  return getDoc(db, kind, doc.id);
}
export const dropDoc = (db: Database, kind: Kind, id: string) => putDoc(db, kind, { id, deleted_at: nowIso() });

// ── goals, read from the core tables ────────────────────────────────────
export const goalKey = (v: unknown) => { const m = String(v ?? "").trim().match(/^g?(\d+)$/i); return m ? `g${Number(m[1])}` : null; };
const gnum = (k: string) => Number(k.slice(1));
const istDay = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
const dayMs = (s: string) => Date.parse(`${s}T00:00:00Z`);
function goalRows(db: Database) { return db.query("SELECT * FROM goals ORDER BY id").all() as any[]; }
/** Progress 0–100, the way the phone server shapes it (store.ts progressOf): child goals and linked tasks, or the stored number. */
export function progressOf(db: Database, g: any, depth = 0): number {
  if (g.status === "done") return 100;
  if (g.progress_mode === "manual" || depth > 8) return g.progress ?? 0;
  const kids = db.query("SELECT * FROM goals WHERE parent_id = ? AND status != 'dropped'").all(g.id) as any[];
  const ts = db.query("SELECT status FROM tasks WHERE goal = ? AND status != 'dropped'").all(g.id) as any[];
  const units = [...kids.map((k) => progressOf(db, k, depth + 1)), ...ts.map((t) => (t.status === "done" ? 100 : 0))];
  return units.length ? Math.round(units.reduce((x, y) => x + y, 0) / units.length) : g.progress ?? 0;
}
/** How much of a goal's period has gone, 0–1 (null for the lifetime and goals without dates). */
export function timeOf(g: any, today = istDay()): number | null {
  const s = g.period_start ?? (g.created_at ? String(g.created_at).slice(0, 10) : null), e = g.period_end ?? g.due;
  if (!s || !e) return null;
  const a = dayMs(s), b = dayMs(e) + 864e5, n = dayMs(today) + 864e5 / 2;
  return Math.min(1, Math.max(0, (n - a) / (b - a)));
}
/** Milestones close a goal's progress when nothing else measures it (no linked tasks, no child goals, auto mode). */
export function milestoneProgress(db: Database, goal: string) {
  const g = db.query("SELECT * FROM goals WHERE id = ?").get(gnum(goal)) as any;
  if (!g || g.progress_mode !== "auto") return null;
  const units = (db.query("SELECT (SELECT count(*) FROM goals WHERE parent_id = ? AND status != 'dropped') + (SELECT count(*) FROM tasks WHERE goal = ? AND status != 'dropped') AS n").get(g.id, g.id) as any).n;
  if (units) return null;
  const ms = listDocs(db, "milestones", "goal = ?", goal);
  if (!ms.length) return null;
  const p = Math.round((ms.filter((m: any) => m.done).length / ms.length) * 100);
  if (p !== g.progress) db.query("UPDATE goals SET progress = ?, updated_at = ? WHERE id = ?").run(p, nowIso(), g.id);
  return p;
}

// ── history: one row per goal per day, so the graph can say how things moved ──
export function snapshot(db: Database, date = istDay()) {
  const put = db.prepare(`INSERT INTO mission_history (date, goal, horizon, period, status, progress, time) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, goal) DO UPDATE SET horizon = excluded.horizon, period = excluded.period, status = excluded.status, progress = excluded.progress, time = excluded.time`);
  let n = 0;
  db.transaction(() => {
    for (const g of goalRows(db)) {
      if (g.status === "dropped" && !db.query("SELECT 1 FROM mission_history WHERE goal = ? AND status != 'dropped'").get(`g${g.id}`)) continue;
      put.run(date, `g${g.id}`, g.horizon, g.period, g.status, progressOf(db, g), timeOf(g, date)); n++;
    }
  })();
  return { date, goals: n };
}
export function history(db: Database, goal?: string) {
  const rows = (goal ? db.query("SELECT * FROM mission_history WHERE goal = ? ORDER BY date").all(goal)
    : db.query("SELECT * FROM mission_history ORDER BY date, goal").all()) as any[];
  const by: Record<string, [string, number, number | null][]> = {};
  for (const r of rows) (by[r.goal] ??= []).push([r.date, r.progress / 100, r.time]);
  return by;
}

// ── the mission graph: set vs done by week since the first goal, the weeks, months and quarters closed ──
const addDays = (s: string, n: number) => new Date(dayMs(s) + n * 864e5).toISOString().slice(0, 10);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dlabel = (s: string) => `${Number(s.slice(8))} ${MON[Number(s.slice(5, 7)) - 1]}`;
export function graph(db: Database, today = istDay()) {
  const gs = goalRows(db);
  const created = (g: any) => istDay(new Date(g.created_at));
  const doneDay = (g: any) => (g.done_at ? istDay(new Date(g.done_at)) : null);
  const thisWeek = periodOf("week", today);
  const first = gs.length ? gs.map(created).sort()[0] : today;
  const weeks: { start: string; end: string; label: string; month: string; set: number; done: number; hit: boolean | null; goals: any[] }[] = [];
  let lastMonth = "";
  for (let w = periodOf("week", first); w.start! <= thisWeek.start!; w = periodOf("week", addDays(w.start!, 7))) {
    const end = w.end!, cut = w.start === thisWeek.start ? today : end;
    const live = gs.filter((g) => created(g) <= cut);
    const wg = gs.filter((g) => g.horizon === "week" && g.period === w.key && g.status !== "dropped");
    const now = w.start === thisWeek.start;
    const m = MON[Number(w.start!.slice(5, 7)) - 1];
    weeks.push({
      start: w.start!, end, label: `${dlabel(w.start!)} – ${dlabel(end)}`, month: m !== lastMonth ? m : "",
      set: live.length,
      done: live.filter((g) => g.status === "done" && doneDay(g) && doneDay(g)! <= cut).length,
      hit: now ? null : wg.length ? wg.every((g) => g.status === "done" && doneDay(g)! <= addDays(end, 1)) : null,
      goals: wg.map((g) => ({ id: `g${g.id}`, title: g.title, status: g.status })),
    });
    lastMonth = m;
  }
  const closedOf = (h: Horizon, n: number) => {
    const out: { key: string; label: string; hit: number; total: number; now: boolean }[] = [];
    let p = periodOf(h, today);
    for (let i = 0; i < n; i++) {
      const pg = gs.filter((g) => g.horizon === h && g.period === p.key && g.status !== "dropped");
      if (pg.length || i === 0) out.unshift({ key: p.key, label: h === "month" ? MON[Number(p.start!.slice(5, 7)) - 1] : p.key.replace(/^\d{4}-/, ""), hit: pg.filter((g) => g.status === "done").length, total: pg.length, now: i === 0 });
      p = periodOf(h, addDays(p.start!, -1));
      if (p.end! < first) break;
    }
    return out;
  };
  let streak = 0;
  for (let i = weeks.length - 2; i >= 0 && weeks[i].hit === true; i--) streak++;
  const missed = gs.filter((g) => g.status === "active" && g.period_end && g.period_end < today);
  const closed = gs.filter((g) => g.status === "done" || g.status === "dropped").map((g) => ({
    id: `g${g.id}`, title: g.title, horizon: g.horizon, period: g.period, state: g.status, area: g.area,
    when: g.status === "done" ? (g.done_at ?? g.updated_at) : g.updated_at,
  })).concat(missed.map((g) => ({ id: `g${g.id}`, title: g.title, horizon: g.horizon, period: g.period, state: "missed", area: g.area, when: g.period_end })))
    .sort((a, b) => String(b.when).localeCompare(String(a.when)));
  return {
    today, since: first, weeks,
    totals: { set: gs.length, done: gs.filter((g) => g.status === "done").length,
      pending: gs.filter((g) => g.status === "active" && !(g.period_end && g.period_end < today)).length, missed: missed.length, dropped: gs.filter((g) => g.status === "dropped").length },
    months: closedOf("month", 12), quarters: closedOf("quarter", 8), streak, closed, history: history(db),
  };
}

// ── the CLI ───────────────────────────────────────────────────────────
function needGoal(db: Database, v: unknown, ctx: ModCtx) {
  const k = goalKey(v);
  if (!k || !db.query("SELECT 1 FROM goals WHERE id = ?").get(gnum(k))) throw new ctx.UserError(`No goal "${v ?? ""}". Goals look like g4 (agentos goal board).`);
  return k;
}
export function currentPurpose(db: Database) {
  const all = listDocs(db, "purpose").sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  return { current: all[0] ?? null, versions: all };
}

export const mission: Module = {
  name: "mission",
  help: `agentos mission                    purpose, goal counts, the week streak (purpose | milestones | checkin | note | life | graph)
agentos mission purpose set "<text>"   · milestone add <goal> "<title>" [--due] | done|undo|drop <id> · milestones <goal>
agentos mission checkin <goal> on|risk|off [--note ".."] · note <horizon> "<body>" [--period] · life [add "<t>" --fam work]`,
  migrate: migrateMission,
  run(db, a: Args, ctx: ModCtx) {
    const [, sub, x, y, z] = a._;
    const today = ctx.istDate();
    if (!sub) {
      const g = graph(db, today);
      return ctx.out({ purpose: currentPurpose(db).current?.text ?? null, totals: g.totals, streak: g.streak, life: listDocs(db, "life").length,
        milestones: listDocs(db, "milestones").length, checkins: listDocs(db, "checkins").length });
    }
    if (sub === "purpose") {
      if (x === "set") {
        const text = String(y ?? "").trim();
        if (!text) throw new ctx.UserError('Say it: agentos mission purpose set "<text>"');
        const cur = currentPurpose(db).current;
        if (cur?.text === text) return ctx.out({ ok: true, already: true, purpose: cur });
        return ctx.out({ ok: true, purpose: putDoc(db, "purpose", { text, by: ctx.str(a, "by") ?? "me", note: ctx.str(a, "note") ?? null }) });
      }
      return ctx.out(currentPurpose(db));
    }
    if (sub === "milestones") { const k = needGoal(db, x, ctx); return ctx.out({ goal: k, milestones: listDocs(db, "milestones", "goal = ?", k).sort((p: any, q: any) => (p.position ?? 0) - (q.position ?? 0)) }); }
    if (sub === "milestone") {
      if (x === "add") {
        const k = needGoal(db, y, ctx), title = String(z ?? "").trim();
        if (!title) throw new ctx.UserError('agentos mission milestone add <goal> "<title>"');
        const due = ctx.str(a, "due");
        if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new ctx.UserError("--due is YYYY-MM-DD.");
        const n = listDocs(db, "milestones", "goal = ?", k).length;
        const m = putDoc(db, "milestones", { goal: k, title, done: false, due: due ?? null, position: n });
        milestoneProgress(db, k);
        return ctx.out({ ok: true, milestone: m });
      }
      if (["done", "undo", "drop"].includes(String(x))) {
        const m = y ? getDoc(db, "milestones", String(y)) : null;
        if (!m || m.deleted_at) throw new ctx.UserError(`No milestone "${y ?? ""}".`);
        const out = x === "drop" ? dropDoc(db, "milestones", m.id) : putDoc(db, "milestones", { id: m.id, done: x === "done", done_at: x === "done" ? nowIso() : null });
        return ctx.out({ ok: true, milestone: out, progress: milestoneProgress(db, m.goal) });
      }
      throw new ctx.UserError("agentos mission milestone add|done|undo|drop");
    }
    if (sub === "checkin") {
      const k = needGoal(db, x, ctx);
      if (!["on", "risk", "off"].includes(String(y))) throw new ctx.UserError("A check-in is on, risk or off.");
      const g = db.query("SELECT * FROM goals WHERE id = ?").get(gnum(k)) as any;
      return ctx.out({ ok: true, checkin: putDoc(db, "checkins", { goal: k, state: y, note: ctx.str(a, "note") ?? null, by: ctx.str(a, "by") ?? "me", at: nowIso(), progress: progressOf(db, g) / 100 }) });
    }
    if (sub === "checkins") { const k = needGoal(db, x, ctx); return ctx.out({ goal: k, checkins: listDocs(db, "checkins", "goal = ?", k).reverse() }); }
    if (sub === "note") {
      const h = String(x ?? "") as Horizon;
      if (!HORIZONS.includes(h)) throw new ctx.UserError(`A horizon: ${HORIZONS.join(", ")}`);
      const period = ctx.str(a, "period") ?? periodOf(h, today).key;
      const body = String(y ?? "");
      return ctx.out({ ok: true, note: putDoc(db, "notes", { id: `${h}:${period}`, horizon: h, period, body }) });
    }
    if (sub === "notes") return ctx.out({ notes: listDocs(db, "notes") });
    if (sub === "life") {
      if (x === "add") {
        const title = String(y ?? "").trim(), fam = ctx.str(a, "fam") ?? "work";
        if (!title) throw new ctx.UserError('agentos mission life add "<title>" --fam work|health|people');
        if (!["work", "health", "people"].includes(fam)) throw new ctx.UserError("--fam is work, health or people.");
        return ctx.out({ ok: true, direction: putDoc(db, "life", { title, fam, position: listDocs(db, "life").length, aspects: ctx.str(a, "aspects")?.split(",") ?? [] }) });
      }
      return ctx.out({ life: listDocs(db, "life") });
    }
    if (sub === "snapshot") return ctx.out({ ok: true, ...snapshot(db, today) });
    if (sub === "graph") return ctx.out(graph(db, today));
    if (sub === "history") return ctx.out({ history: history(db, x ? needGoal(db, x, ctx) : undefined) });
    throw new ctx.UserError("agentos mission [purpose|milestones|milestone|checkin|checkins|note|notes|life|snapshot|graph|history]");
  },
};

// Goals on time horizons, the Timestripe way: every goal belongs to one period
// (a day, week, month, quarter, year, decade or life), nests under a goal in any
// horizon, and each period carries its own note and review. Kept apart from
// agentos.ts so task work and goal work don't collide.
import type { Database } from "bun:sqlite";

export const HORIZONS = ["day", "week", "month", "quarter", "year", "decade", "life"] as const;
export type Horizon = (typeof HORIZONS)[number];
type Period = { key: string; start: string | null; end: string | null };
type Args = { _: string[]; flags: Record<string, string | boolean> }; // same shape as src/modules/types.ts
/** Helpers owned by agentos.ts, passed in to avoid a circular import. */
export type Ctx = {
  out: (data: Record<string, unknown>, help?: string[]) => void;
  area: (db: Database, input?: string) => string | undefined;
  parseDay: (input: string) => string;
  today: () => string;
  stamp: () => string;
  fail: (msg: string) => never;
  json: () => boolean;
};

// ── migration (schema v3) ───────────────────────────────────────────────────
/** Written to run on a v1 or v2 store and to be safe if re-run: every step checks what is already there. */
export function migrateGoals(db: Database, version: number, today: string) {
  const cols = new Set((db.query("PRAGMA table_info(goals)").all() as any[]).map((c) => c.name));
  if (version >= 3 && cols.has("period") && cols.has("progress_mode")) return;
  db.transaction(() => {
    const add = (name: string, def: string) => {
      if (!cols.has(name)) db.exec(`ALTER TABLE goals ADD COLUMN ${name} ${def}`);
    };
    add("parent_id", "INTEGER REFERENCES goals(id)");
    add("period", "TEXT");
    add("period_start", "TEXT");
    add("period_end", "TEXT");
    add("position", "INTEGER NOT NULL DEFAULT 0");
    add("color", "TEXT");
    add("progress_mode", "TEXT NOT NULL DEFAULT 'auto'");
    add("notes", "TEXT");
    add("updated_at", "TEXT");
    add("done_at", "TEXT");
    db.exec(`
      CREATE TABLE IF NOT EXISTS period_notes (horizon TEXT NOT NULL, period TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'note',
        body TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (horizon, period, kind));
      CREATE INDEX IF NOT EXISTS goals_period ON goals(horizon, period, position);
      CREATE INDEX IF NOT EXISTS goals_parent ON goals(parent_id);
    `);
    // v1 goals had a horizon and a due date; the period is the one holding that date.
    const loose = db.query("SELECT * FROM goals WHERE period IS NULL").all() as any[];
    const set = db.prepare(
      `UPDATE goals SET horizon = ?, period = ?, period_start = ?, period_end = ?, position = ?, updated_at = coalesce(updated_at, created_at),
         progress_mode = ?, done_at = CASE WHEN status = 'done' THEN coalesce(done_at, created_at) END WHERE id = ?`,
    );
    for (const g of loose) {
      const h: Horizon = (HORIZONS as readonly string[]).includes(g.horizon) ? g.horizon : "month";
      const p = periodOf(h, g.due ?? String(g.created_at ?? today).slice(0, 10));
      // A number set by hand under v1 stays as typed.
      set.run(h, p.key, p.start, p.end, g.id, g.progress > 0 ? "manual" : "auto", g.id);
    }
    db.exec(`PRAGMA user_version = ${Math.max(version, 3)}`);
  })();
}

// ── periods (dates are IST calendar days as YYYY-MM-DD; weeks start Monday) ─
const pad = (n: number) => String(n).padStart(2, "0");
const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dayAdd = (s: string, n: number) => ymd(new Date(utc(s).getTime() + n * 86_400_000));
function monthAdd(s: string, n: number) {
  const t = Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-01`;
}
const monthEnd = (s: string) => dayAdd(monthAdd(s, 1), -1);
function isoWeek(monday: string) {
  const thu = utc(dayAdd(monday, 3));
  const y = thu.getUTCFullYear();
  const w = 1 + Math.floor((thu.getTime() - Date.UTC(y, 0, 1)) / (7 * 86_400_000));
  return `${y}-W${pad(w)}`;
}

export function periodOf(h: Horizon, date: string): Period {
  const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
  switch (h) {
    case "day": return { key: date, start: date, end: date };
    case "week": {
      const start = dayAdd(date, -((utc(date).getUTCDay() + 6) % 7));
      return { key: isoWeek(start), start, end: dayAdd(start, 6) };
    }
    case "month": {
      const start = `${date.slice(0, 7)}-01`;
      return { key: date.slice(0, 7), start, end: monthEnd(start) };
    }
    case "quarter": {
      const q = Math.floor((m - 1) / 3) + 1;
      const start = `${y}-${pad(q * 3 - 2)}-01`;
      return { key: `${y}-Q${q}`, start, end: monthEnd(monthAdd(start, 2)) };
    }
    case "year": return { key: String(y), start: `${y}-01-01`, end: `${y}-12-31` };
    case "decade": {
      const d = Math.floor(y / 10) * 10;
      return { key: `${d}s`, start: `${d}-01-01`, end: `${d + 9}-12-31` };
    }
    case "life": return { key: "life", start: null, end: null };
  }
}
/** The period a key names, or null when the key isn't in that horizon's format. */
function fromKey(h: Horizon, key: string): Period | null {
  const k = key.trim();
  let m: RegExpMatchArray | null;
  if (h === "day" && /^\d{4}-\d{2}-\d{2}$/.test(k)) return periodOf(h, k);
  if (h === "week" && (m = k.match(/^(\d{4})-?W(\d{1,2})$/i))) {
    const jan4 = `${m[1]}-01-04`;
    const p = periodOf("week", dayAdd(periodOf("week", jan4).start!, (Number(m[2]) - 1) * 7));
    return p.key.startsWith(m[1]) && Number(m[2]) >= 1 ? p : null;
  }
  if (h === "month" && (m = k.match(/^(\d{4})-(\d{2})$/)) && Number(m[2]) >= 1 && Number(m[2]) <= 12) return periodOf(h, `${k}-01`);
  if (h === "quarter" && (m = k.match(/^(\d{4})-?Q([1-4])$/i))) return periodOf(h, `${m[1]}-${pad(Number(m[2]) * 3 - 2)}-01`);
  if (h === "year" && /^\d{4}$/.test(k)) return periodOf(h, `${k}-01-01`);
  if (h === "decade" && (m = k.match(/^(\d{3}0)s$/))) return periodOf(h, `${m[1]}-01-01`);
  if (h === "life" && k.toLowerCase() === "life") return periodOf(h, "2000-01-01");
  return null;
}
/** Guess the horizon from a period key, so `--period 2026-Q4` needs no `--horizon`. */
function horizonOfKey(key: string): Horizon | undefined {
  return HORIZONS.find((h) => h !== "day" && fromKey(h, key));
}
export function shiftPeriod(h: Horizon, p: Period, n: number): Period {
  if (h === "life" || !p.start) return p;
  const step: Record<Exclude<Horizon, "life">, (s: string) => string> = {
    day: (s) => dayAdd(s, n), week: (s) => dayAdd(s, 7 * n), month: (s) => monthAdd(s, n),
    quarter: (s) => monthAdd(s, 3 * n), year: (s) => monthAdd(s, 12 * n), decade: (s) => monthAdd(s, 120 * n),
  };
  return periodOf(h, step[h](p.start));
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function periodLabel(h: Horizon, p: Period): string {
  const s = p.start, e = p.end;
  if (!s || !e) return "Life";
  const day = (d: string) => `${Number(d.slice(8))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
  switch (h) {
    case "day": return `${WEEKDAYS[utc(s).getUTCDay()]} ${day(s)}`;
    case "week": return s.slice(5, 7) === e.slice(5, 7) ? `${Number(s.slice(8))}–${day(e)}` : `${day(s)} – ${day(e)}`;
    case "month": return `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
    case "quarter": return `${p.key.slice(5)} ${s.slice(0, 4)}`;
    case "year": return s.slice(0, 4);
    case "decade": return p.key;
    case "life": return "Life";
  }
}

// ── lookups ─────────────────────────────────────────────────────────────────
function horizon(c: Ctx, input?: string): Horizon {
  const s = String(input ?? "").toLowerCase();
  const hit = HORIZONS.find((h) => h === s || (s.length >= 2 && h.startsWith(s)));
  if (!hit) c.fail(`Horizon is ${HORIZONS.join(", ")}.`);
  return hit;
}
/** this | next | prev | +2 | -1 | a period key (2026-W43, 2026-10, 2026-Q4, 2026, 2020s, life) | any day agentos reads. */
function resolvePeriod(c: Ctx, h: Horizon, input?: string): Period {
  const cur = periodOf(h, c.today());
  const s = String(input ?? "").trim().toLowerCase();
  if (!s || s === "this" || s === "current" || s === "now") return cur;
  if (s === "next") return shiftPeriod(h, cur, 1);
  if (s === "prev" || s === "last" || s === "previous") return shiftPeriod(h, cur, -1);
  if (/^[+-]\d+$/.test(s)) return shiftPeriod(h, cur, Number(s));
  const keyed = fromKey(h, input!);
  if (keyed) return keyed;
  const other = horizonOfKey(input!);
  if (other && other !== h) c.fail(`"${input}" is a ${other} period, not a ${h}. Pass --horizon ${other}, or a date.`);
  try {
    return periodOf(h, c.parseDay(input!));
  } catch {
    return c.fail(`Can't read the period "${input}". Use this, next, prev, +2, a date, or a key like ${periodOf(h, c.today()).key}.`);
  }
}
function getGoal(db: Database, c: Ctx, input?: string): any {
  const id = Number(String(input ?? "").replace(/^g/i, ""));
  const g = Number.isInteger(id) && id > 0 ? db.query("SELECT * FROM goals WHERE id = ?").get(id) : null;
  if (!g) c.fail(`No goal "${input ?? ""}". List them: agentos goal`);
  return g;
}

// ── progress + shaping ──────────────────────────────────────────────────────
/** Done = 100. Manual = the stored number. Auto = mean of child goals and linked tasks, else the stored number. */
function progressOf(db: Database, g: any, depth = 0): number {
  if (g.status === "done") return 100;
  if (g.progress_mode === "manual" || depth > 8) return g.progress;
  const kids = db.query("SELECT * FROM goals WHERE parent_id = ? AND status != 'dropped'").all(g.id) as any[];
  const tasks = db.query("SELECT status FROM tasks WHERE goal = ? AND status != 'dropped'").all(g.id) as any[];
  const units = [...kids.map((k) => progressOf(db, k, depth + 1)), ...tasks.map((t) => (t.status === "done" ? 100 : 0))];
  return units.length ? Math.round(units.reduce((x, y) => x + y, 0) / units.length) : g.progress;
}
function areaColors(db: Database): Record<string, string> {
  return Object.fromEntries((db.query("SELECT slug, color FROM areas").all() as any[]).map((r) => [r.slug, r.color]));
}
function shape(db: Database, g: any, colors = areaColors(db), detail = false) {
  const kids = db.query("SELECT id, title, horizon, period, period_start, period_end, status FROM goals WHERE parent_id = ? AND status != 'dropped' ORDER BY period_start IS NULL, period_start, position").all(g.id) as any[];
  const tasks = db.query("SELECT id, title, status, due FROM tasks WHERE goal = ? AND status != 'dropped' ORDER BY status = 'done', due IS NULL, due, id").all(g.id) as any[];
  const parent = g.parent_id ? (db.query("SELECT id, title, horizon, period FROM goals WHERE id = ?").get(g.parent_id) as any) : null;
  const h = g.horizon as Horizon;
  const base: Record<string, unknown> = {
    id: `g${g.id}`, title: g.title, horizon: h, period: g.period,
    label: periodLabel(h, { key: g.period, start: g.period_start, end: g.period_end }),
    area: g.area, color: g.color ?? (g.area ? colors[g.area] : null) ?? null, status: g.status,
    progress: progressOf(db, g), parent: parent ? `g${parent.id}` : null,
    children: `${kids.filter((k) => k.status === "done").length}/${kids.length}`,
    tasks: `${tasks.filter((t) => t.status === "done").length}/${tasks.length}`,
  };
  if (!detail) return base;
  return {
    ...base, start: g.period_start, end: g.period_end, position: g.position, progress_mode: g.progress_mode,
    measure: g.measure, due: g.due, notes: g.notes, own_color: g.color, done_at: g.done_at,
    parent_title: parent?.title ?? null,
    child_goals: kids.map((k) => ({ id: `g${k.id}`, title: k.title, horizon: k.horizon, period: k.period,
      label: periodLabel(k.horizon, { key: k.period, start: k.period_start, end: k.period_end }), status: k.status,
      progress: progressOf(db, db.query("SELECT * FROM goals WHERE id = ?").get(k.id)) })),
    linked_tasks: tasks.map((t) => ({ id: `t${t.id}`, title: t.title, status: t.status, due: t.due })),
  };
}
function chain(db: Database, g: any) {
  const up: any[] = [];
  let p = g.parent_id;
  while (p && up.length < 10) {
    const row = db.query("SELECT id, title, horizon, period, parent_id FROM goals WHERE id = ?").get(p) as any;
    if (!row) break;
    up.push({ id: `g${row.id}`, title: row.title, horizon: row.horizon, period: row.period });
    p = row.parent_id;
  }
  return up;
}
function noteOf(db: Database, h: string, period: string, kind: string): string | null {
  return ((db.query("SELECT body FROM period_notes WHERE horizon = ? AND period = ? AND kind = ?").get(h, period, kind) as any)?.body) ?? null;
}

// ── writes ──────────────────────────────────────────────────────────────────
/** Put a goal at `index` in its column (end by default) and renumber the column. */
function place(db: Database, id: number, h: Horizon, p: Period, index?: number) {
  const rest = (db.query("SELECT id FROM goals WHERE horizon = ? AND period = ? AND id != ? AND status != 'dropped' ORDER BY position, id")
    .all(h, p.key, id) as any[]).map((r) => r.id);
  const at = index === undefined ? rest.length : Math.max(0, Math.min(index, rest.length));
  rest.splice(at, 0, id);
  db.query("UPDATE goals SET horizon = ?, period = ?, period_start = ?, period_end = ? WHERE id = ?").run(h, p.key, p.start, p.end, id);
  const pos = db.prepare("UPDATE goals SET position = ? WHERE id = ?");
  rest.forEach((gid, i) => pos.run(i, gid));
}
function checkParent(db: Database, c: Ctx, id: number | null, parentInput: string): number | null {
  if (parentInput === "none") return null;
  const parent = getGoal(db, c, parentInput);
  for (let p: any = parent, n = 0; p && n < 20; n++) {
    if (p.id === id) c.fail(`g${parent.id} sits under g${id}, so it can't also be its parent.`);
    p = p.parent_id ? db.query("SELECT id, parent_id FROM goals WHERE id = ?").get(p.parent_id) : null;
  }
  return parent.id;
}
const one = (h: Horizon) => HORIZONS[Math.max(0, HORIZONS.indexOf(h) - 1)];
const str = (a: Args, k: string) => (typeof a.flags[k] === "string" ? (a.flags[k] as string) : undefined);
const index = (a: Args) => (str(a, "index") !== undefined ? Number(str(a, "index")) : undefined);

function addGoal(db: Database, c: Ctx, a: Args) {
  const title = (str(a, "title") ?? a._.slice(2).join(" ")).trim();
  if (!title) c.fail('Give a title: agentos goal add "Ship the Harborline demo" --horizon week --period next --parent g1');
  if (title.length > 300) c.fail("Keep a goal title under 300 characters; put detail in --notes.");
  const parentId = str(a, "parent") ? checkParent(db, c, null, str(a, "parent")!) : null;
  const parent = parentId ? (db.query("SELECT * FROM goals WHERE id = ?").get(parentId) as any) : null;
  const periodIn = str(a, "period") ?? str(a, "due");
  // A child defaults one horizon below its parent, starting where the parent starts if that is still ahead.
  const h = str(a, "horizon") ? horizon(c, str(a, "horizon")) : (periodIn && horizonOfKey(periodIn)) || (parent ? one(parent.horizon) : "month");
  let p = resolvePeriod(c, h, periodIn);
  if (!periodIn && parent?.period_start && parent.period_start > c.today()) p = periodOf(h, parent.period_start);
  const dup = db.query(
    "SELECT * FROM goals WHERE lower(title) = lower(?) AND horizon = ? AND period = ? AND coalesce(parent_id, 0) = ? AND status != 'dropped'",
  ).get(title, h, p.key, parentId ?? 0) as any;
  if (dup) return c.out({ already: true, goal: shape(db, dup) }, [`agentos goal show g${dup.id}`]);
  const color = str(a, "color");
  if (color && !/^#[0-9a-f]{6}$/i.test(color)) c.fail("--color takes a hex color like #e0559b.");
  const stamp = c.stamp();
  const r = db.query(
    `INSERT INTO goals (title, area, horizon, due, progress, measure, status, created_at, parent_id, period, period_start, period_end,
       position, color, progress_mode, notes, updated_at) VALUES (?, ?, ?, ?, 0, ?, 'active', ?, ?, ?, ?, ?, 0, ?, 'auto', ?, ?) RETURNING *`,
  ).get(
    title, c.area(db, str(a, "area")) ?? parent?.area ?? null, h, str(a, "due") ? c.parseDay(str(a, "due")!) : null,
    str(a, "measure") ?? null, stamp, parentId, p.key, p.start, p.end, color ?? null, str(a, "notes") ?? null, stamp,
  ) as any;
  place(db, r.id, h, p, index(a));
  c.out({ ok: true, action: "added", goal: shape(db, db.query("SELECT * FROM goals WHERE id = ?").get(r.id)) }, [
    `agentos goal add "<step>" --parent g${r.id}`, `agentos add "<task>" --goal g${r.id}`, `agentos goal board --horizon ${h}`,
  ]);
}

function updateGoal(db: Database, c: Ctx, a: Args, status?: "active" | "done" | "dropped") {
  const g = getGoal(db, c, a._[2]);
  const set: Record<string, unknown> = {};
  if (str(a, "title")) set.title = str(a, "title")!.trim();
  if (a.flags.notes !== undefined) set.notes = str(a, "notes") || null;
  if (str(a, "measure")) set.measure = str(a, "measure") === "none" ? null : str(a, "measure");
  if (str(a, "area")) set.area = str(a, "area") === "none" ? null : c.area(db, str(a, "area"));
  if (str(a, "color")) {
    const color = str(a, "color")!;
    if (color !== "none" && !/^#[0-9a-f]{6}$/i.test(color)) c.fail("--color takes a hex color like #e0559b, or none.");
    set.color = color === "none" ? null : color.toLowerCase();
  }
  if (str(a, "parent")) set.parent_id = checkParent(db, c, g.id, str(a, "parent")!);
  if (str(a, "due")) set.due = str(a, "due") === "none" ? null : c.parseDay(str(a, "due")!);
  const st = status ?? (str(a, "status") as any);
  if (st) {
    if (!["active", "done", "dropped"].includes(st)) c.fail("Goal status is active, done or dropped.");
    set.status = st;
    set.done_at = st === "done" ? (g.done_at ?? c.stamp()) : null;
  }
  const changed = Object.entries(set).filter(([k, v]) => g[k] !== v);

  // Moving: a new horizon without a period lands in the period that holds the goal's old start.
  let moved = false;
  if (str(a, "horizon") || str(a, "period") || str(a, "index") !== undefined) {
    const periodIn = str(a, "period");
    const h = str(a, "horizon") ? horizon(c, str(a, "horizon")) : (periodIn && horizonOfKey(periodIn)) || (g.horizon as Horizon);
    const p = periodIn ? resolvePeriod(c, h, periodIn)
      : h === g.horizon ? { key: g.period, start: g.period_start, end: g.period_end } : periodOf(h, g.period_start ?? c.today());
    const col = (db.query("SELECT id FROM goals WHERE horizon = ? AND period = ? AND status != 'dropped' ORDER BY position, id").all(h, p.key) as any[]).map((r) => r.id);
    const want = index(a);
    if (want !== undefined && !(Number.isInteger(want) && want >= 0)) c.fail("--index is a position from 0.");
    const same = h === g.horizon && p.key === g.period && (want === undefined || col.indexOf(g.id) === Math.min(want, col.length - 1));
    if (!same) {
      place(db, g.id, h, p, want);
      moved = true;
    }
  }
  if (!changed.length && !moved) return c.out({ already: true, goal: shape(db, g) }, [`agentos goal show g${g.id}`]);
  changed.push(["updated_at", c.stamp()]);
  db.query(`UPDATE goals SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...(changed.map(([, v]) => v) as any[]), g.id);
  const keys = changed.map(([k]) => k).filter((k) => k !== "updated_at" && k !== "done_at");
  if (moved) keys.push("period");
  c.out({ ok: true, action: status ? { active: "reopened", done: "done", dropped: "dropped" }[status] : moved && keys.length === 1 ? "moved" : "updated",
    changed: keys, goal: shape(db, db.query("SELECT * FROM goals WHERE id = ?").get(g.id)) },
  [`agentos goal show g${g.id}`, `agentos goal board --horizon ${(db.query("SELECT horizon FROM goals WHERE id = ?").get(g.id) as any).horizon}`]);
}

function setProgress(db: Database, c: Ctx, a: Args) {
  const g = getGoal(db, c, a._[2]);
  const v = String(a._[3] ?? "").toLowerCase();
  if (v === "auto") {
    if (g.progress_mode === "auto") return c.out({ already: true, goal: shape(db, g) });
    db.query("UPDATE goals SET progress_mode = 'auto', updated_at = ? WHERE id = ?").run(c.stamp(), g.id);
  } else {
    const pct = Number(v);
    if (v === "" || !(pct >= 0 && pct <= 100)) c.fail("Progress is 0 to 100, or auto.");
    if (g.progress_mode === "manual" && g.progress === Math.round(pct) && !(pct >= 100 && g.status !== "done"))
      return c.out({ already: true, goal: shape(db, g) });
    db.query(`UPDATE goals SET progress = ?, progress_mode = 'manual', updated_at = ?,
      status = CASE WHEN ? >= 100 THEN 'done' ELSE status END, done_at = CASE WHEN ? >= 100 THEN coalesce(done_at, ?) ELSE done_at END WHERE id = ?`)
      .run(Math.round(pct), c.stamp(), pct, pct, c.stamp(), g.id);
  }
  c.out({ ok: true, action: "progress", goal: shape(db, db.query("SELECT * FROM goals WHERE id = ?").get(g.id)) }, [`agentos goal progress g${g.id} auto`]);
}

function writeNote(db: Database, c: Ctx, a: Args) {
  const h = horizon(c, a._[2]);
  const p = resolvePeriod(c, h, a._[3]);
  const kind = str(a, "kind") ?? "note";
  if (!["note", "review"].includes(kind)) c.fail("--kind is note or review.");
  const body = (str(a, "text") ?? a._.slice(4).join(" ")).trim();
  if (body.length > 20_000) c.fail("Keep a period note under 20,000 characters.");
  const old = noteOf(db, h, p.key, kind);
  if ((old ?? "") === body) return c.out({ already: true, horizon: h, period: p.key, kind });
  if (!body) db.query("DELETE FROM period_notes WHERE horizon = ? AND period = ? AND kind = ?").run(h, p.key, kind);
  else db.query(`INSERT INTO period_notes (horizon, period, kind, body, updated_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (horizon, period, kind) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`).run(h, p.key, kind, body, c.stamp());
  c.out({ ok: true, action: body ? "noted" : "cleared", horizon: h, period: p.key, label: periodLabel(h, p), kind },
    [`agentos goal notes --horizon ${h}`]);
}

// ── views ───────────────────────────────────────────────────────────────────
const DEFAULT_COUNT: Record<Horizon, number> = { day: 7, week: 6, month: 6, quarter: 4, year: 3, decade: 2, life: 1 };

function board(db: Database, c: Ctx, a: Args) {
  const h = horizon(c, str(a, "horizon") ?? "week");
  const count = h === "life" ? 1 : Math.max(1, Math.min(24, Number(str(a, "count") ?? DEFAULT_COUNT[h]) || DEFAULT_COUNT[h]));
  const first = resolvePeriod(c, h, str(a, "from"));
  const current = periodOf(h, c.today()).key;
  const colors = areaColors(db);
  const columns = Array.from({ length: count }, (_, i) => shiftPeriod(h, first, i)).map((p) => {
    const rows = db.query("SELECT * FROM goals WHERE horizon = ? AND period = ? AND status != 'dropped' ORDER BY position, id").all(h, p.key) as any[];
    return {
      period: p.key, label: periodLabel(h, p), start: p.start, end: p.end, current: p.key === current,
      goals: rows.map((g) => (c.json() ? { ...shape(db, g, colors, true), chain: chain(db, g) } : shape(db, g, colors))),
      note: noteOf(db, h, p.key, "note"), review: noteOf(db, h, p.key, "review"),
    };
  });
  if (c.json())
    return c.out({ horizon: h, current, horizons: HORIZONS.map((x) => ({ horizon: x, current: periodOf(x, c.today()).key })),
      columns, areas: db.query("SELECT slug, name, color FROM areas ORDER BY sort").all() });
  // TOON: one block per column.
  const view: Record<string, unknown> = { horizon: h, current };
  for (const col of columns) {
    view[`${col.period}${col.current ? " (now)" : ""}`] = {
      label: col.label, goals: col.goals.length ? col.goals : "none",
      ...(col.note ? { note: col.note } : {}), ...(col.review ? { review: col.review } : {}),
    };
  }
  c.out(view, [
    `agentos goal add "<goal>" --horizon ${h} --period ${columns[0].period}`,
    `agentos goal board --horizon ${h} --from next`,
    `agentos goal note ${h} ${current} --text "<plan or review>" [--kind review]`,
  ]);
}

function dashboard(db: Database, c: Ctx, a: Args) {
  const colors = areaColors(db);
  const now = HORIZONS.map((h) => {
    const p = periodOf(h, c.today());
    const rows = db.query("SELECT status FROM goals WHERE horizon = ? AND period = ? AND status != 'dropped'").all(h, p.key) as any[];
    return { horizon: h, period: p.key, label: periodLabel(h, p), open: rows.filter((r) => r.status === "active").length,
      done: rows.filter((r) => r.status === "done").length };
  });
  const rows = db.query(
    `SELECT * FROM goals WHERE status = 'active' OR ? ORDER BY
       CASE horizon ${HORIZONS.map((h, i) => `WHEN '${h}' THEN ${i}`).join(" ")} END, period_start IS NULL, period_start, position`,
  ).all(a.flags.all ? 1 : 0) as any[];
  // `due` stays for callers written against v1 output.
  const list = rows.map((g) => ({ ...shape(db, g, colors), due: g.due }));
  c.out({ now, goals: list }, [
    'agentos goal add "<goal>" --horizon quarter --area <area>',
    "agentos goal board --horizon week",
    "agentos goal show <id>",
  ]);
}

function show(db: Database, c: Ctx, a: Args) {
  const g = getGoal(db, c, a._[2]);
  const d = shape(db, g, areaColors(db), true) as any;
  const data: Record<string, unknown> = { goal: c.json() ? d : { ...d, child_goals: undefined, linked_tasks: undefined, chain: undefined } };
  data.chain = chain(db, g);
  if (!c.json()) {
    data.child_goals = d.child_goals.length ? d.child_goals : "none";
    data.linked_tasks = d.linked_tasks.length ? d.linked_tasks : "none";
  }
  c.out(data, [
    `agentos goal add "<step>" --parent g${g.id}`, `agentos goal move g${g.id} --period next`,
    `agentos goal done g${g.id}`, `agentos add "<task>" --goal g${g.id}`,
  ]);
}

function notes(db: Database, c: Ctx, a: Args) {
  const where: string[] = [], vals: string[] = [];
  if (str(a, "horizon")) { where.push("horizon = ?"); vals.push(horizon(c, str(a, "horizon"))); }
  if (str(a, "period")) { where.push("period = ?"); vals.push(resolvePeriod(c, (vals[0] as Horizon) ?? "week", str(a, "period")).key); }
  if (str(a, "kind")) { where.push("kind = ?"); vals.push(str(a, "kind")!); }
  const rows = db.query(`SELECT horizon, period, kind, body, updated_at FROM period_notes ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY updated_at DESC LIMIT 50`).all(...vals);
  c.out({ notes: rows }, ["agentos goal note week this --text \"<plan>\"", "agentos goal note week this --kind review --text \"<how it went>\""]);
}

export function goals(db: Database, c: Ctx, a: Args) {
  const sub = a._[1];
  switch (sub) {
    case undefined: case "list": case "ls": return dashboard(db, c, a);
    case "board": return board(db, c, a);
    case "add": return addGoal(db, c, a);
    case "show": return show(db, c, a);
    case "update": case "set": case "move": return updateGoal(db, c, a);
    case "done": return updateGoal(db, c, a, "done");
    case "drop": return updateGoal(db, c, a, "dropped");
    case "reopen": return updateGoal(db, c, a, "active");
    case "progress": return setProgress(db, c, a);
    case "note": return writeNote(db, c, a);
    case "notes": return notes(db, c, a);
    default: return c.fail(`Unknown goal command "${sub}". Run: agentos help`);
  }
}

export const GOAL_HELP = `agentos goal [--all]               goals now in each horizon, then every open goal
agentos goal board [--horizon day|week|month|quarter|year|decade|life] [--from next|2026-W40] [--count 6]
agentos goal add "<title>" [--horizon h] [--period this|next|+2|<key>|<date>] [--parent g1] [--area a]
                           [--color #hex] [--measure "..."] [--notes "..."] [--index 0]
agentos goal show <id>              parent chain, child goals, linked tasks
agentos goal update <id> [--title|--notes|--area|--color|--parent g2|none|--measure|--due]
agentos goal move <id> [--horizon h] [--period p] [--index n]
agentos goal done|drop|reopen <id>
agentos goal progress <id> <0-100|auto>   auto = mean of child goals and linked tasks
agentos goal note <horizon> <period> --text "..." [--kind note|review]   empty text clears
agentos goal notes [--horizon h] [--period p] [--kind note|review]
Period keys: 2026-10-17, 2026-W43, 2026-10, 2026-Q4, 2026, 2020s, life. Weeks start Monday.`;

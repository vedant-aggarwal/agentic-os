// Growth: the journal (entries and check-ins), the Sunday review, the overnight dream, the day and week plans, and the
// growth index: a level per week (0-100, from every app's data) and growth as its rate of change. (v2)
//   agentos growth                         today: the streak, this week's level, the latest dream and review
//   agentos growth journal [--days 14]     entries, newest first
//   agentos growth write "<text>" [--date YYYY-MM-DD] [--p 1-5 --e 1-5] [--by me|wyn]   add to that day's entry
//   agentos growth week [--week 2026-W43]  the week's data points against last week, its level and the review draft
//   agentos growth levels [--weeks 12]     the level week by week, overall and per aspect, with the rate of change
//   agentos growth streak                  the journal streak (nights written, backfills don't count)
// Tables follow the phone store's collection shape (server/modules/_collection.ts): id, data (JSON), created_at,
// updated_at, deleted_at, rev, plus a few columns for queries. The phone server mounts them at /api/v1/mod/growth/...
// and imports the pure functions below (levels, points, streak, the review draft) so the CLI and the PC agree.
import type { Database } from "bun:sqlite";
import type { Args, ModCtx, Module } from "./types";

const IST_MS = 330 * 60_000;
export const ASPECTS = ["body", "mind", "soul", "mission", "money", "growth", "family", "romance", "friends"] as const;
export const ASPECT_NAME: Record<string, string> = { body: "Body", mind: "Mind", soul: "Soul", mission: "Mission", money: "Money", growth: "Growth", family: "Family", romance: "Romance", friends: "Friends" };

// ── the tables ─────────────────────────────────────────────────────────────────────────────────────────────────────
type Col = "TEXT" | "INTEGER" | "REAL";
export const TABLES: Record<string, Record<string, Col>> = {
  growth_journal: { date: "TEXT", at: "TEXT", kind: "TEXT", words: "INTEGER", p: "INTEGER", e: "INTEGER", by: "TEXT", source: "TEXT" },
  growth_checkins: { date: "TEXT", at: "TEXT", p: "INTEGER", e: "INTEGER" },
  growth_reviews: { week: "TEXT", status: "TEXT", score: "REAL" },
  growth_dreams: { date: "TEXT", status: "TEXT" },
  growth_plans: { kind: "TEXT", date: "TEXT", week: "TEXT" },
  growth_settings: {},
};
export function ddl(table: string): string {
  const cols = Object.entries(TABLES[table]).map(([k, t]) => `,\n  ${k} ${t}`).join("");
  return `CREATE TABLE IF NOT EXISTS ${table} (\n  id TEXT PRIMARY KEY,\n  data TEXT NOT NULL DEFAULT '{}',\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  deleted_at TEXT,\n  rev INTEGER NOT NULL DEFAULT 0${cols}\n);\nCREATE INDEX IF NOT EXISTS ${table}_rev ON ${table}(rev);`;
}
export function migrate(db: Database) {
  for (const t of Object.keys(TABLES)) db.exec(ddl(t));
  db.exec("CREATE INDEX IF NOT EXISTS growth_journal_date ON growth_journal(date); CREATE INDEX IF NOT EXISTS growth_checkins_date ON growth_checkins(date);");
}
const hasTable = (db: Database, name: string) => !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
const parse = (s: unknown) => { try { return JSON.parse(String(s ?? "{}")); } catch { return {}; } };
/** A collection row as the phone sees it: the data JSON spread, then the columns. */
export function docOf(r: any) {
  if (!r) return null;
  const { data, rev, ...cols } = r;
  return { ...parse(data), ...Object.fromEntries(Object.entries(cols).filter(([, v]) => v !== undefined)) };
}
/** Upsert a document the way the phone store does (last write wins by updated_at). For the CLI, jobs and tools. */
export function putDoc(db: Database, table: string, doc: any) {
  const now = new Date().toISOString();
  const cols = TABLES[table];
  const cur = db.query(`SELECT * FROM ${table} WHERE id = ?`).get(doc.id) as any;
  const full = { ...(cur ? docOf(cur) : {}), ...doc, created_at: cur?.created_at ?? doc.created_at ?? now, updated_at: doc.updated_at ?? now, deleted_at: doc.deleted_at ?? null };
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) if (!["id", "created_at", "updated_at", "deleted_at", "rev", "data"].includes(k) && !(k in cols)) rest[k] = v;
  const rev = ((db.query(`SELECT coalesce(max(rev), 0) + 1 AS r FROM ${table}`).get() as any).r) as number;
  const row: Record<string, any> = { id: full.id, data: JSON.stringify(rest), created_at: full.created_at, updated_at: full.updated_at, deleted_at: full.deleted_at, rev };
  for (const k of Object.keys(cols)) row[k] = full[k] == null ? null : cols[k] === "TEXT" ? String(full[k]) : Number(full[k]);
  const keys = Object.keys(row);
  db.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`).run(...keys.map((k) => row[k]));
  return docOf(db.query(`SELECT * FROM ${table} WHERE id = ?`).get(full.id));
}
export const listDocs = (db: Database, table: string, where = "1 = 1", ...args: any[]) =>
  (db.query(`SELECT * FROM ${table} WHERE deleted_at IS NULL AND ${where}`).all(...args) as any[]).map(docOf);

// ── dates (IST) ────────────────────────────────────────────────────────────────────────────────────────────────────
export const istDate = (d = new Date()) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
export const istHm = (d = new Date()) => new Date(d.getTime() + IST_MS).toISOString().slice(11, 16);
export const addDays = (date: string, n: number) => { const t = new Date(`${date}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
/** The instant an IST date starts, as a UTC ISO string (for comparing with stored timestamps). */
export const istStart = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - IST_MS).toISOString();
export const mondayOf = (date: string) => { const d = new Date(`${date}T00:00:00Z`); return addDays(date, -((d.getUTCDay() + 6) % 7)); };
/** ISO week key of a date: 2026-W43. */
export function weekKey(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
export const weekNum = (key: string) => Number(key.slice(6));
/** Monday of an ISO week key. */
export function weekMonday(key: string): string {
  const y = Number(key.slice(0, 4)), w = weekNum(key);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const mon1 = new Date(jan4.getTime() - (((jan4.getUTCDay() + 6) % 7) * 864e5));
  return new Date(mon1.getTime() + (w - 1) * 7 * 864e5).toISOString().slice(0, 10);
}
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function weekLabel(key: string) {
  const a = weekMonday(key), b = addDays(a, 6);
  const [ma, da] = [Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10))], [mb, db] = [Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10))];
  return ma === mb ? `${da}–${db} ${MON[ma]}` : `${da} ${MON[ma]} – ${db} ${MON[mb]}`;
}

// ── the journal and the streak ─────────────────────────────────────────────────────────────────────────────────────
export type JournalDay = { date: string; n: number; p: number | null; e: number | null; live: boolean };
/** Every day with an entry. `live` days were written on the night (backfills for a missed day don't count for streaks).
 *  `extra` adds days from elsewhere (Wyn's journal in her own db), always live. */
export function journalDays(db: Database, extra: { date: string; p?: number | null; e?: number | null }[] = []): Map<string, JournalDay> {
  const out = new Map<string, JournalDay>();
  const add = (date: string, p: number | null, e: number | null, live: boolean) => {
    const c = out.get(date) ?? { date, n: 0, p: null, e: null, live: false };
    c.n++; c.live ||= live;
    if (p != null && c.p == null) { c.p = p; c.e = e; }
    out.set(date, c);
  };
  if (hasTable(db, "growth_journal")) {
    for (const r of db.query("SELECT date, p, e, data FROM growth_journal WHERE deleted_at IS NULL AND date IS NOT NULL").all() as any[]) {
      add(r.date, r.p ?? null, r.e ?? null, !parse(r.data).backfill);
    }
  }
  for (const x of extra) if (x.date) add(x.date, x.p ?? null, x.e ?? null, true);
  return out;
}
export type Streak = { n: number; today: boolean; current: number; best: number; bestFrom: string | null; bestTo: string | null; total: number; year: number; lastDate: string | null };
/** n: nights in a row ending yesterday; current: n plus tonight once it's written. */
export function streakOf(days: Map<string, JournalDay>, today: string): Streak {
  const live = (d: string) => !!days.get(d)?.live;
  let n = 0;
  for (let d = addDays(today, -1); live(d); d = addDays(d, -1)) n++;
  const dates = [...days.values()].filter((x) => x.live).map((x) => x.date).sort();
  let best = 0, run = 0, prev: string | null = null, bestTo: string | null = null;
  for (const d of dates) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    if (run > best) { best = run; bestTo = d; }
    prev = d;
  }
  const year = [...days.keys()].filter((d) => d.slice(0, 4) === today.slice(0, 4)).length;
  return { n, today: live(today), current: n + (live(today) ? 1 : 0), best, bestFrom: bestTo ? addDays(bestTo, -(best - 1)) : null, bestTo, total: days.size, year, lastDate: dates.at(-1) ?? null };
}

// ── the growth index: a level per week per aspect, from every app's data ───────────────────────────────────────────
export type Signal = { k: string; label: string; v: number; raw: string };
export type WeekLevel = { key: string; from: string; to: string; level: number | null; aspects: Record<string, number | null>; signals: Record<string, Signal[]> };
type Ctx = { today: string; nowIso: string; journal: Map<string, JournalDay>; areaAspects: Record<string, string[]>; moduleTables: { table: string; aspect: string | null; byAspect: boolean; label: string }[]; first: string | null };

// Other apps' activity tables (in the collection shape): each row is a data point for that aspect. An allowlist, because
// many tables hold catalogues (books, courses, lessons) rather than things he did. Add a table here when an app adds one.
export const ACTIVITY: Record<string, { aspect: string; label: string }> = {
  body_workouts: { aspect: "body", label: "Workouts" }, body_meals: { aspect: "body", label: "Meals logged" }, body_sleep: { aspect: "body", label: "Nights of sleep logged" },
  body_protocol_runs: { aspect: "body", label: "Protocol sessions" }, body_checks: { aspect: "body", label: "Protocol steps checked" },
  mind_sessions: { aspect: "mind", label: "Reading and study sessions" }, mind_checkins: { aspect: "mind", label: "Evening check-ins" },
  soul_checks: { aspect: "soul", label: "Habits checked" }, soul_checkins: { aspect: "soul", label: "Soul check-ins" }, soul_moods: { aspect: "soul", label: "Moods logged" },
  money_expenses: { aspect: "money", label: "Expenses logged" }, money_transactions: { aspect: "money", label: "Transactions" },
  mission_checkins: { aspect: "mission", label: "Mission check-ins" },
  people_moments: { aspect: "family", label: "Moments with people" }, people_plans: { aspect: "friends", label: "Plans with people" },
};
/** The activity tables that exist in this db, with whether rows carry their own aspect (people: family, friends, romance). */
export function moduleTables(db: Database) {
  const out: Ctx["moduleTables"] = [];
  for (const [table, a] of Object.entries(ACTIVITY)) {
    if (!hasTable(db, table)) continue;
    const cols = (db.query(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);
    if (!cols.includes("created_at") || !cols.includes("deleted_at")) continue;
    out.push({ table, aspect: a.aspect, byAspect: cols.includes("aspect"), label: a.label });
  }
  return out;
}
function context(db: Database, now: Date, extraJournal: { date: string; p?: number | null; e?: number | null }[] = []): Ctx {
  const areaAspects: Record<string, string[]> = {};
  if (hasTable(db, "life_area_aspects")) for (const r of db.query("SELECT area, aspect FROM life_area_aspects ORDER BY rank").all() as any[]) (areaAspects[r.area] ??= []).push(r.aspect);
  const journal = journalDays(db, extraJournal);
  const firsts: string[] = [];
  const t = hasTable(db, "tasks") ? (db.query("SELECT min(created_at) m FROM tasks").get() as any)?.m : null;
  if (t) firsts.push(istDate(new Date(t)));
  const jd = [...journal.keys()].sort()[0]; if (jd) firsts.push(jd);
  if (hasTable(db, "growth_checkins")) { const c = (db.query("SELECT min(date) m FROM growth_checkins WHERE deleted_at IS NULL").get() as any)?.m; if (c) firsts.push(c); }
  const mt = moduleTables(db);
  for (const m of mt) { const c = (db.query(`SELECT min(created_at) m FROM ${m.table} WHERE deleted_at IS NULL`).get() as any)?.m; if (c) firsts.push(istDate(new Date(c))); }
  return { today: istDate(now), nowIso: now.toISOString(), journal, areaAspects, moduleTables: mt, first: firsts.sort()[0] ?? null };
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const aspectAreas = (c: Ctx, a: string) => Object.entries(c.areaAspects).filter(([, as]) => as.includes(a)).map(([ar]) => ar);

/** One week's signals and levels. `to` is the last day counted (today for this week). */
export function weekLevel(db: Database, c: Ctx, key: string, uptoDate?: string): WeekLevel {
  const from = weekMonday(key);
  const to = uptoDate ?? addDays(from, 6);
  const days = daysBetween(from, to) + 1;
  const startIso = istStart(from), endIso = istStart(addDays(to, 1));
  const sig: Record<string, Signal[]> = Object.fromEntries(ASPECTS.map((a) => [a, [] as Signal[]]));
  const tasks = hasTable(db, "tasks");
  for (const a of ASPECTS) {
    const areas = aspectAreas(c, a);
    if (tasks && areas.length) {
      const q = areas.map(() => "?").join(", ");
      const due = db.query(`SELECT count(*) n, sum(CASE WHEN status = 'done' AND julianday(done_at) < julianday(?) THEN 1 ELSE 0 END) d FROM tasks WHERE area IN (${q}) AND status != 'dropped' AND substr(due, 1, 10) BETWEEN ? AND ?`).get(endIso, ...areas, from, to) as any;
      if (due.n > 0) sig[a].push({ k: "due", label: "Tasks due, done", v: (due.d ?? 0) / due.n, raw: `${due.d ?? 0} of ${due.n}` });
      const any = (db.query(`SELECT count(*) n FROM tasks WHERE area IN (${q}) AND julianday(created_at) < julianday(?)`).get(...areas, endIso) as any).n;
      if (any > 0) {
        const done = (db.query(`SELECT count(*) n FROM tasks WHERE area IN (${q}) AND status = 'done' AND julianday(done_at) >= julianday(?) AND julianday(done_at) < julianday(?)`).get(...areas, startIso, endIso) as any).n;
        sig[a].push({ k: "done", label: "Tasks done", v: clamp01(done / Math.max(3, Math.round(5 * days / 7))), raw: String(done) });
      }
    }
    for (const m of c.moduleTables) {
      if (m.byAspect || m.aspect !== a) continue;
      const before = (db.query(`SELECT count(*) n FROM ${m.table} WHERE deleted_at IS NULL AND julianday(created_at) < julianday(?)`).get(endIso) as any).n;
      if (!before) continue;
      const n = (db.query(`SELECT count(*) n FROM ${m.table} WHERE deleted_at IS NULL AND julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?)`).get(startIso, endIso) as any).n;
      sig[a].push({ k: m.table, label: m.label, v: clamp01(n / days), raw: String(n) });
    }
  }
  // tables that tag each row with its aspect (people moments: family, friends, romance)
  for (const m of c.moduleTables.filter((x) => x.byAspect)) {
    const rows = db.query(`SELECT aspect, count(*) n FROM ${m.table} WHERE deleted_at IS NULL AND julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?) GROUP BY aspect`).all(startIso, endIso) as any[];
    const ever = db.query(`SELECT DISTINCT aspect FROM ${m.table} WHERE deleted_at IS NULL AND julianday(created_at) < julianday(?)`).all(endIso) as any[];
    for (const { aspect } of ever) if (sig[aspect]) { const n = rows.find((r) => r.aspect === aspect)?.n ?? 0; sig[aspect].push({ k: m.table, label: m.label, v: clamp01(n / days), raw: String(n) }); }
  }
  // Growth: nights written; a sealed review for the week
  const firstJ = [...c.journal.keys()].sort()[0];
  if (firstJ && firstJ <= to) {
    let w = 0; for (let d = from; d <= to; d = addDays(d, 1)) if (c.journal.get(d)) w++;
    sig.growth.push({ k: "journal", label: "Nights written", v: w / days, raw: `${w} of ${days}` });
  }
  if (hasTable(db, "growth_reviews")) {
    const any = (db.query("SELECT count(*) n FROM growth_reviews WHERE deleted_at IS NULL AND status = 'sealed' AND week < ?").get(key) as any).n;
    if (any) { const s = db.query("SELECT 1 FROM growth_reviews WHERE deleted_at IS NULL AND status = 'sealed' AND week = ?").get(key); sig.growth.push({ k: "review", label: "Sunday review", v: s ? 1 : 0, raw: s ? "sealed" : "not done" }); }
  }
  // Soul: how the days felt (check-ins and entry moods, pleasantness 1-5)
  const moods: number[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) { const j = c.journal.get(d); if (j?.p) moods.push(j.p); }
  if (hasTable(db, "growth_checkins")) for (const r of db.query("SELECT p FROM growth_checkins WHERE deleted_at IS NULL AND date BETWEEN ? AND ? AND p IS NOT NULL").all(from, to) as any[]) moods.push(r.p);
  if (moods.length) sig.soul.push({ k: "mood", label: "How the days felt", v: (moods.reduce((s, x) => s + x, 0) / moods.length - 1) / 4, raw: `${moods.length} check-ins` });
  // his own score from the life wheel, when it's recent (within six weeks)
  if (hasTable(db, "life_snapshots")) {
    const s = db.query("SELECT date, scores FROM life_snapshots WHERE date <= ? ORDER BY date DESC LIMIT 1").get(to) as any;
    if (s && daysBetween(s.date, to) <= 42) { const sc = parse(s.scores); for (const a of ASPECTS) if (typeof sc[a] === "number") sig[a].push({ k: "self", label: "Your own score", v: clamp01(sc[a] / 10), raw: `${sc[a]}/10` }); }
  }
  const aspects: Record<string, number | null> = {};
  for (const a of ASPECTS) aspects[a] = sig[a].length ? Math.round((100 * sig[a].reduce((s, x) => s + x.v, 0)) / sig[a].length) : null;
  const vals = Object.values(aspects).filter((v): v is number => v != null);
  return { key, from, to, level: vals.length ? Math.round(vals.reduce((s, x) => s + x, 0) / vals.length) : null, aspects, signals: sig };
}
export const rateAt = (arr: (number | null)[], i: number, span = 4) => {
  const cur = arr[i]; if (cur == null) return 0;
  let j = Math.max(0, i - span); while (j < i && arr[j] == null) j++;
  return j >= i ? 0 : (cur - (arr[j] as number)) / (i - j);
};
/** Week by week since his data starts (at most `weeks` back), this week counted to today. */
export function levels(db: Database, { now = new Date(), weeks = 53, extraJournal = [] as { date: string; p?: number | null; e?: number | null }[] } = {}) {
  const c = context(db, now, extraJournal);
  const thisKey = weekKey(c.today);
  if (!c.first) return { ctx: c, weeks: [] as (WeekLevel & { rate: number })[], thisKey };
  let start = weekMonday(weekKey(c.first));
  const cap = addDays(weekMonday(thisKey), -7 * (weeks - 1));
  if (start < cap) start = cap;
  const out: WeekLevel[] = [];
  for (let m = start; m <= c.today; m = addDays(m, 7)) { const k = weekKey(m); out.push(weekLevel(db, c, k, k === thisKey ? c.today : undefined)); }
  const lv = out.map((w) => w.level);
  return { ctx: c, thisKey, weeks: out.map((w, i) => ({ ...w, rate: Math.round(rateAt(lv, i) * 10) / 10 })) };
}

// ── the week's data points, this week so far against the same days last week ───────────────────────────────────────
export type Point = { aspect: string; label: string; now: string; was: string; dir: number; good: boolean | null; note: string; to?: string; n?: number; m?: number };
export function weekPoints(db: Database, now = new Date(), extraJournal: { date: string; p?: number | null; e?: number | null }[] = [], contentDb?: Database | null) {
  const c = context(db, now, extraJournal);
  const today = c.today, mon = mondayOf(today), daysIn = daysBetween(mon, today) + 1;
  const lastMon = addDays(mon, -7), lastTo = addDays(lastMon, daysIn - 1);
  const pts: Point[] = [];
  const cmp = (aspect: string, label: string, n: number, m: number, note: string, lowerBetter = false, fmt = (x: number) => String(x), to?: string) => {
    const dir = n > m ? 1 : n < m ? -1 : 0;
    pts.push({ aspect, label, now: fmt(n), was: fmt(m), dir, good: dir === 0 ? null : (dir > 0) !== lowerBetter, note, to, n, m });
  };
  const span = (a: string, b: string) => [istStart(a), istStart(addDays(b, 1))];
  if (hasTable(db, "tasks")) {
    const done = (a: string, b: string) => (db.query("SELECT count(*) n FROM tasks WHERE status = 'done' AND julianday(done_at) >= julianday(?) AND julianday(done_at) < julianday(?)").get(...span(a, b)) as any).n as number;
    const overdue = (db.query("SELECT count(*) n FROM tasks WHERE status NOT IN ('done', 'dropped') AND due IS NOT NULL AND substr(due, 1, 10) < ?").get(today) as any).n as number;
    cmp("mission", "Tasks done", done(mon, today), done(lastMon, lastTo), overdue ? `${overdue} overdue now` : "Nothing overdue", false, String, "tasks:done");
    for (const a of ASPECTS) {
      if (a === "mission") continue;
      const areas = aspectAreas(c, a).filter((ar) => (c.areaAspects[ar] ?? [])[0] === a);
      if (!areas.length) continue;
      const q = areas.map(() => "?").join(", ");
      const d = (x: string, y: string) => (db.query(`SELECT count(*) n FROM tasks WHERE area IN (${q}) AND status = 'done' AND julianday(done_at) >= julianday(?) AND julianday(done_at) < julianday(?)`).get(...areas, ...span(x, y)) as any).n as number;
      const n = d(mon, today), m = d(lastMon, lastTo);
      const names = areas.map((ar) => (hasTable(db, "areas") ? (db.query("SELECT name FROM areas WHERE slug = ?").get(ar) as any)?.name : null) ?? ar);
      if (n || m) cmp(a, `Tasks done in ${names.join(", ")}`, n, m, "", false, String, `aspect:${a}`);
    }
  }
  let w = 0, lw = 0;
  for (let i = 0; i < daysIn; i++) { if (c.journal.get(addDays(mon, i))) w++; if (c.journal.get(addDays(lastMon, i))) lw++; }
  if (c.journal.size) cmp("growth", "Journal", w, lw, w === daysIn ? "Every night so far" : `${daysIn - w} ${daysIn - w === 1 ? "night" : "nights"} missed`, false, (x) => `${x} of ${daysIn}`);
  if (hasTable(db, "growth_checkins")) {
    const ck = (a: string, b: string) => db.query("SELECT count(*) n, avg(p) p FROM growth_checkins WHERE deleted_at IS NULL AND date BETWEEN ? AND ?").get(a, b) as any;
    const x = ck(mon, today), y = ck(lastMon, lastTo);
    if (x.n || y.n) cmp("soul", "Check-ins", x.n, y.n, x.p ? `Mood ${(x.p as number).toFixed(1)} of 5 on average` : "", false);
  }
  for (const m of c.moduleTables) {
    const cnt = (a: string, b: string) => (db.query(`SELECT count(*) n FROM ${m.table} WHERE deleted_at IS NULL AND julianday(created_at) >= julianday(?) AND julianday(created_at) < julianday(?)`).get(...span(a, b)) as any).n as number;
    const n = cnt(mon, today), mm = cnt(lastMon, lastTo);
    if (n || mm) cmp(m.aspect ?? "mission", m.label, n, mm, "", false, String, `aspect:${m.aspect}`);
  }
  if (contentDb) {
    try {
      const posted = (a: string, b: string) => (contentDb.query("SELECT count(*) n FROM content_posts WHERE status IN ('posted', 'published', 'live') AND julianday(coalesce(scheduled_at, created_at)) >= julianday(?) AND julianday(coalesce(scheduled_at, created_at)) < julianday(?)").get(...span(a, b)) as any).n as number;
      const n = posted(mon, today), mm = posted(lastMon, lastTo);
      cmp("content", "Posts published", n, mm, "From the Content tab", false, String, "content:stats");
    } catch { /* no content db yet */ }
  }
  return { key: weekKey(today), from: mon, to: addDays(mon, 6), label: weekLabel(weekKey(today)), daysIn, points: pts };
}

// ── the Sunday review, drafted in code from the numbers (the AI job rewrites the words when it runs) ───────────────
export const WHYS = ["Avoided it", "No time", "Tired", "Phone in bed", "No plan", "Forgot", "Didn't matter"];
export function draftReview(db: Database, now = new Date(), extraJournal: { date: string; p?: number | null; e?: number | null }[] = [], contentDb?: Database | null) {
  const wk = weekPoints(db, now, extraJournal, contentDb);
  const lv = levels(db, { now, weeks: 12, extraJournal });
  const cur = lv.weeks.at(-1), prev = lv.weeks.at(-2);
  const score = cur?.level ?? null, last = prev?.level ?? null;
  const moved = ASPECTS.map((a) => ({ a, d: (cur?.aspects[a] ?? null) != null && (prev?.aspects[a] ?? null) != null ? (cur!.aspects[a] as number) - (prev!.aspects[a] as number) : null })).filter((x) => x.d != null) as { a: string; d: number }[];
  const up = moved.filter((x) => x.d > 0).sort((x, y) => y.d - x.d).slice(0, 2).map((x) => ASPECT_NAME[x.a]);
  const down = moved.filter((x) => x.d < 0).sort((x, y) => x.d - y.d).slice(0, 2).map((x) => ASPECT_NAME[x.a]);
  const headline = score == null ? "Not enough data for a score yet. The numbers below are what the apps logged."
    : `Your week scores ${score}${last != null ? `, ${score >= last ? "up" : "down"} ${Math.abs(score - last)}` : ""}.${up.length ? ` ${up.join(" and ")} carried it` : ""}${down.length ? `${up.length ? ";" : ""} ${down.join(" and ")} held it back` : ""}${up.length || down.length ? "." : ""}`;
  const wins = wk.points.filter((p) => p.good === true).map((p) => ({ text: `${p.label}: ${p.now}, up from ${p.was}`, aspect: p.aspect === "content" ? "mission" : p.aspect, on: true }));
  const misses: any[] = wk.points.filter((p) => p.good === false).map((p) => ({ text: `${p.label}: ${p.now}, down from ${p.was}`, aspect: p.aspect === "content" ? "mission" : p.aspect, why: null, whys: WHYS.slice(0, 4), detail: p.note }));
  const overdue = hasTable(db, "tasks") ? db.query("SELECT id, title, area, substr(due, 1, 10) due FROM tasks WHERE status NOT IN ('done', 'dropped') AND due IS NOT NULL AND substr(due, 1, 10) < ? ORDER BY due LIMIT 3").all(istDate(now)) as any[] : [];
  for (const t of overdue) misses.push({ text: `"${t.title}" is ${daysBetween(t.due, istDate(now))} days late`, aspect: aspectOfArea(db, t.area) ?? "mission", why: null, whys: ["Avoided it", "No time", "Unclear next step", "Doesn't matter now"], detail: `Due ${t.due}`, task: `t${t.id}` });
  const rules: { id: string; text: string; why: string }[] = [];
  if (overdue.length) rules.push({ id: "u1", text: "Close one open loop before starting a new one", why: `${overdue.length} tasks are past their date.` });
  const j = wk.points.find((p) => p.label === "Journal");
  if (j && (j.n ?? 0) < wk.daysIn) rules.push({ id: `u${rules.length + 1}`, text: "On days I feel behind, I still write two lines", why: `The journal missed ${wk.daysIn - (j.n ?? 0)} nights this week.` });
  rules.push({ id: `u${rules.length + 1}`, text: "Plan three things before the phone", why: "A short morning plan sets the day's first move." });
  const moves: any[] = [];
  for (const t of overdue.slice(0, 2)) moves.push({ id: `m${moves.length + 1}`, text: `Finish "${String(t.title).slice(0, 60)}" by Tuesday`, aspect: aspectOfArea(db, t.area) ?? "mission", lands: "A goal for next week and the task moved to Tuesday", on: true, task: `t${t.id}` });
  const low = ASPECTS.filter((a) => a !== "romance" && cur?.aspects[a] != null).sort((x, y) => (cur!.aspects[x] as number) - (cur!.aspects[y] as number));
  for (const a of low) { if (moves.length >= 3) break; if (moves.some((m) => m.aspect === a)) continue; moves.push({ id: `m${moves.length + 1}`, text: `${ASPECT_NAME[a]}: one block on the calendar`, aspect: a, lands: "A goal for next week", on: true }); }
  if (moves.length < 3 && !moves.some((m) => m.aspect === "growth")) moves.push({ id: `m${moves.length + 1}`, text: "Journal five nights", aspect: "growth", lands: "A goal for next week", on: true });
  return { id: wk.key, week: wk.key, n: weekNum(wk.key), label: wk.label, from: wk.from, to: wk.to, next: weekLabel(weekKey(addDays(wk.from, 7))), status: "draft", score, last, headline, feel: { p: null, e: null, line: "" }, wins, misses, whys: WHYS, rules, moves, points: wk.points, daysIn: wk.daysIn, drafted_by: "code", drafted_at: new Date().toISOString() };
}
export function aspectOfArea(db: Database, area: string | null): string | null {
  if (!area || !hasTable(db, "life_area_aspects")) return null;
  return (db.query("SELECT aspect FROM life_area_aspects WHERE area = ? ORDER BY rank LIMIT 1").get(area) as any)?.aspect ?? null;
}

/** Append to a day's entry (or start it). For the CLI and the agent's tool: what he said, in his words. */
export function writeLine(db: Database, { text, date, p = null, e = null, by = "me", source = "cli", now = new Date() }: { text: string; date?: string; p?: number | null; e?: number | null; by?: string; source?: string; now?: Date }) {
  const t = String(text ?? "").trim();
  if (!t) throw new Error("Give the text to write.");
  const d = date ?? istDate(now);
  const today = d === istDate(now);
  const cur = listDocs(db, "growth_journal", "date = ? ORDER BY created_at LIMIT 1", d)[0] as any;
  const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
  if (cur) {
    const body = `${cur.text ?? ""}\n\n${t}`.trim();
    return putDoc(db, "growth_journal", { ...cur, text: body, words: words(body), p: cur.p ?? p, e: cur.e ?? e, lines: [...(cur.lines ?? []), { at: now.toISOString(), by, text: t }] });
  }
  const id = `j_${d}_${Math.random().toString(36).slice(2, 7)}`;
  const title = t.split(/[.!?\n]/)[0].trim().slice(0, 46) || "Tonight";
  return putDoc(db, "growth_journal", { id, date: d, at: now.toISOString(), kind: by === "wyn" ? "agent" : "typed", text: t, title, words: words(t), p, e, by, source, backfill: !today && d < istDate(now), lines: [{ at: now.toISOString(), by, text: t }] });
}

// ── the CLI ────────────────────────────────────────────────────────────────────────────────────────────────────────
function run(db: Database, a: Args, ctx: ModCtx) {
  const sub = a._[1];
  const now = ctx.now();
  const num = (k: string) => { const v = ctx.str(a, k); return v == null ? null : Number(v); };
  if (!sub || sub === "status") {
    const s = streakOf(journalDays(db), istDate(now));
    const lv = levels(db, { now, weeks: 8 });
    const dream = listDocs(db, "growth_dreams", "1 = 1 ORDER BY date DESC LIMIT 1")[0] ?? null;
    const review = listDocs(db, "growth_reviews", "week = ?", weekKey(istDate(now)))[0] ?? null;
    return ctx.out({ today: istDate(now), streak: s, week: lv.weeks.at(-1) ? { key: lv.thisKey, level: lv.weeks.at(-1)!.level, rate: lv.weeks.at(-1)!.rate } : null, dream: dream ? { date: dream.date, status: dream.status, connections: (dream.connections ?? []).length } : null, review: review ? { week: review.week, status: review.status } : null },
      ["agentos growth journal", "agentos growth write \"<text>\"", "agentos growth week", "agentos growth levels"]);
  }
  if (sub === "journal") {
    const days = num("days") ?? 14;
    const rows = listDocs(db, "growth_journal", "date >= ? ORDER BY date DESC", addDays(istDate(now), -days));
    return ctx.out(rows.map((r: any) => ({ id: r.id, date: r.date, kind: r.kind, by: r.by, p: r.p, e: r.e, words: r.words, text: r.text })));
  }
  if (sub === "write") {
    const text = a._.slice(2).join(" ") || ctx.str(a, "text") || "";
    if (!text.trim()) throw new ctx.UserError('Give the text: agentos growth write "Two lines about today"');
    const p = num("p"), e = num("e");
    for (const v of [p, e]) if (v != null && !(v >= 1 && v <= 5)) throw new ctx.UserError("--p and --e are 1 to 5.");
    return ctx.out(writeLine(db, { text, date: ctx.str(a, "date"), p, e, by: ctx.str(a, "by") ?? "me", source: "cli", now }));
  }
  if (sub === "streak") return ctx.out(streakOf(journalDays(db), istDate(now)));
  if (sub === "levels") {
    const lv = levels(db, { now, weeks: num("weeks") ?? 12 });
    return ctx.out(lv.weeks.map((w) => ({ week: w.key, label: weekLabel(w.key), level: w.level, rate: w.rate, ...Object.fromEntries(ASPECTS.map((x) => [x, w.aspects[x]])) })));
  }
  if (sub === "week") return ctx.out(draftReview(db, now));
  throw new ctx.UserError("agentos growth [status] | journal [--days n] | write \"<text>\" | streak | levels [--weeks n] | week");
}

export const growth: Module = {
  name: "growth",
  help: "agentos growth [journal|write \"<text>\"|streak|levels|week]   Growth: journal, streak, the growth index, the Sunday review draft (v2)",
  migrate,
  run,
};

// Body (v2): the gym, food, recovery inputs and looks. Every table is a phone-store collection (server/modules/_collection.ts
// shape: id, data, created_at, updated_at, deleted_at, rev, plus the columns below) synced through /api/v1/mod/body/<plural>.
//   agentos body                                   this week: sessions, today's food, protocol ticks, latest readings
//   agentos body workouts [--days 30]              sessions (done, missed, planned) with sets and volume
//   agentos body meals [--date YYYY-MM-DD]         a day's meals and totals
//   agentos body log-meal "<name>" --kcal N --protein N [--slot lunch] [--at ISO]
//   agentos body reading <weight|sleep|steps|rhr|hrv|water|activeEnergy> <value> [--date YYYY-MM-DD] [--source manual]
//   agentos body records                           best set per exercise (estimated max for weights)
//   agentos body exercises [--search bench] [--muscle chest] [--limit 20]   the free-exercise-db library + his own
//   agentos body import-wyn [--dir <wyn home\life>] [--dry]   his gym, cardio, diet and profile lines from Wyn's files
// The exercise library is yuhonas/free-exercise-db (Unlicense, 876 exercises), trimmed to Body's 16 muscle groups in
// body-library.json. Sets live inside their workout (one doc per session), so a session syncs as one record.
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Args, ModCtx, Module } from "./types";

// ── tables ─────────────────────────────────────────────────────────────
const COLL = `id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted_at TEXT, rev INTEGER NOT NULL DEFAULT 0`;
/** Collection columns, shared with server/modules/body.ts so both sides agree on the shape. */
export const BODY_COLLECTIONS = {
  workouts: { table: "body_workouts", columns: { date: "text", status: "text", split: "text", name: "text", started_at: "text", ended_at: "text", source: "text" } },
  meals: { table: "body_meals", columns: { date: "text", at: "text", slot: "text", name: "text", kcal: "real", protein: "real", source: "text" } },
  readings: { table: "body_readings", columns: { kind: "text", date: "text", value: "real", source: "text" } },
  protocol: { table: "body_protocol", columns: { half: "text", ord: "integer", active: "bool" } },
  checks: { table: "body_checks", columns: { date: "text", item: "text", done: "bool" } },
  programs: { table: "body_programs", columns: { started: "text", active: "bool" } },
  scans: { table: "body_scans", columns: { date: "text", angle: "text" } },
  settings: { table: "body_settings", columns: {} },
  exercises: { table: "body_exercises", columns: { name: "text", kind: "text" } },
} as const;
export type BodyKind = keyof typeof BODY_COLLECTIONS;
const SQL: Record<string, string> = { text: "TEXT", real: "REAL", bool: "INTEGER", integer: "INTEGER", json: "TEXT" };

export function migrateBody(db: Database) {
  for (const { table, columns } of Object.values(BODY_COLLECTIONS)) {
    const cols = Object.entries(columns).map(([k, t]) => `, ${k} ${SQL[t]}`).join("");
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${COLL}${cols}); CREATE INDEX IF NOT EXISTS ${table}_rev ON ${table}(rev);`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS body_workouts_date ON body_workouts(date);
    CREATE INDEX IF NOT EXISTS body_meals_date ON body_meals(date);
    CREATE INDEX IF NOT EXISTS body_readings_kind ON body_readings(kind, date);
    CREATE INDEX IF NOT EXISTS body_checks_date ON body_checks(date);`);
}

// ── collection docs (the same rules as the server's _collection.ts: upsert by id, rev counter, soft delete) ──
const nowIso = () => new Date().toISOString();
const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const META = ["id", "created_at", "updated_at", "deleted_at", "rev", "data"];
function toDoc(kind: BodyKind, r: any) {
  if (!r) return null;
  const cols = BODY_COLLECTIONS[kind].columns as Record<string, string>;
  let rest: Record<string, unknown> = {};
  try { rest = JSON.parse(r.data ?? "{}"); } catch {}
  const doc: Record<string, unknown> = { ...rest, id: r.id, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at ?? null };
  for (const [k, t] of Object.entries(cols)) doc[k] = r[k] == null ? null : t === "bool" ? !!r[k] : r[k];
  return doc as any;
}
export function getDoc(db: Database, kind: BodyKind, id: string) {
  return toDoc(kind, db.query(`SELECT * FROM ${BODY_COLLECTIONS[kind].table} WHERE id = ?`).get(id));
}
export function listDocs(db: Database, kind: BodyKind, where = "", ...args: any[]): any[] {
  const T = BODY_COLLECTIONS[kind].table;
  return (db.query(`SELECT * FROM ${T} WHERE deleted_at IS NULL ${where ? `AND ${where}` : ""} ORDER BY rev`).all(...args) as any[]).map((r) => toDoc(kind, r));
}
/** Upsert a doc the way the phone's store does; fields not given keep their stored value. */
export function putDoc(db: Database, kind: BodyKind, input: Record<string, any>) {
  const { table: T, columns } = BODY_COLLECTIONS[kind];
  const cols = columns as Record<string, string>;
  const cur = input.id ? getDoc(db, kind, input.id) : null;
  const now = nowIso();
  const doc = { ...(cur ?? {}), ...input, id: input.id ?? newId(kind.slice(0, 2)), created_at: cur?.created_at ?? now, updated_at: now, deleted_at: input.deleted_at ?? null };
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!META.includes(k) && !(k in cols)) rest[k] = v;
  const row: Record<string, any> = { id: doc.id, data: JSON.stringify(rest), created_at: doc.created_at, updated_at: doc.updated_at, deleted_at: doc.deleted_at };
  for (const [k, t] of Object.entries(cols)) { const v = (doc as any)[k]; row[k] = v == null ? null : t === "bool" ? (v ? 1 : 0) : t === "real" || t === "integer" ? Number(v) : String(v); }
  row.rev = (db.query(`SELECT coalesce(max(rev), 0) + 1 AS r FROM ${T}`).get() as any).r;
  const keys = Object.keys(row);
  db.query(`INSERT INTO ${T} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
    ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`).run(...Object.values(row));
  return getDoc(db, kind, doc.id);
}
export const dropDoc = (db: Database, kind: BodyKind, id: string) => putDoc(db, kind, { id, deleted_at: nowIso() });

// ── the numbers every view shares ──────────────────────────────────────
export const istDay = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** Estimated one-rep max (Epley). */
export const e1rm = (w: number, r: number) => (r <= 1 ? w : w * (1 + r / 30));
const workSets = (it: any) => (Array.isArray(it?.sets) ? it.sets : []).filter((s: any) => !s.warm && s.done !== false);
export function volumeOf(w: any) {
  return (w.items ?? []).reduce((a: number, it: any) => a + workSets(it).reduce((b: number, s: any) => b + (Number(s.w) || 0) * (Number(s.r) || 0), 0), 0);
}
export const setsOf = (w: any) => (w.items ?? []).reduce((a: number, it: any) => a + workSets(it).length, 0);
export function mealTotals(meals: any[]) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, n: meals.length };
  for (const m of meals) { t.kcal += Number(m.kcal) || 0; t.protein += Number(m.protein) || 0; t.carbs += Number(m.carbs) || 0; t.fat += Number(m.fat) || 0; }
  return { ...t, kcal: Math.round(t.kcal), protein: Math.round(t.protein), carbs: Math.round(t.carbs), fat: Math.round(t.fat) };
}
/** The best set per exercise across done sessions: estimated max for weights, reps for body weight, seconds for holds. */
export function records(workouts: any[]) {
  const best: Record<string, { ex: string; name: string; set: any; score: number; date: string; est: number | null }> = {};
  for (const w of [...workouts].filter((x) => x.status === "done").sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    for (const it of w.items ?? []) {
      const kind = it.kind ?? "weight";
      if (kind === "cardio") continue;
      for (const s of workSets(it)) {
        const score = kind === "weight" ? e1rm(Number(s.w) || 0, Number(s.r) || 0) : kind === "time" ? Number(s.t) || 0 : Number(s.r) || 0;
        if (!score) continue;
        if (!best[it.ex] || score > best[it.ex].score) best[it.ex] = { ex: it.ex, name: it.name ?? it.ex, set: s, score, date: w.date, est: kind === "weight" ? Math.round(score * 2) / 2 : null };
      }
    }
  }
  return best;
}

// ── the exercise library (free-exercise-db, Unlicense) ─────────────────
type LibEx = { id: string; name: string; kind: string; equip: string; level: string | null; mech: string | null; cat: string | null; p: string[]; s: string[]; how: string[]; img: string | null };
let LIB: LibEx[] | null = null;
/** The 876 exercises, loaded on first use (the file is ~770 KB, so commands that don't need it never read it). */
export function library(): LibEx[] {
  if (LIB) return LIB;
  // require (not a top-level import) so it is bundled into agentos.exe yet parsed only when a command needs it
  try { LIB = require("./body-library.json") as LibEx[]; } catch { LIB = []; }
  return LIB!;
}
export const LIB_IMG = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises";
export function searchLibrary(q = "", muscle = "", limit = 20) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  return library().filter((e) => (!muscle || e.p.includes(muscle) || e.s.includes(muscle)) && terms.every((t) => e.name.toLowerCase().includes(t) || e.equip.toLowerCase().includes(t)))
    .sort((a, b) => a.name.length - b.name.length).slice(0, limit);
}

// ── Wyn's life files: what she logged before the app had Body (read only; ids fixed, so a re-run is a no-op) ──
const SLOT: Record<string, string> = { breakfast: "breakfast", lunch: "lunch", dinner: "dinner", snack: "snack", home_meal: "dinner", first: "lunch" };
const slotOf = (s: string, hour: number) => SLOT[s] ?? (/^college_/.test(s) ? "lunch" : /coke|biscuit|choco|chai|snack/.test(s) ? "snack" : hour < 11 ? "breakfast" : hour < 16 ? "lunch" : hour < 19 ? "snack" : "dinner");
const readLines = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.trim()).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }) : []);
const tsIso = (ts: number) => new Date(ts * 1000).toISOString();
const istHour = (ts: number) => new Date(ts * 1000 + 330 * 60000).getUTCHours();
const istHm = (ts: number) => new Date(ts * 1000 + 330 * 60000).toISOString().slice(11, 16);
export function importWyn(db: Database, dir: string, { dry = false } = {}) {
  const out = { meals: 0, workouts: 0, missed: 0, profile: 0, skipped: 0, docs: [] as any[] };
  const put = (kind: BodyKind, doc: any) => {
    if (getDoc(db, kind, doc.id)) { out.skipped++; return; }
    out.docs.push({ kind, id: doc.id });
    if (!dry) putDoc(db, kind, doc);
  };
  // food: one meal per line with numbers; a correction line folds into the meal it corrects
  const diet = readLines(join(dir, "diet.jsonl"));
  const meals: any[] = [];
  diet.forEach((l, i) => {
    if (l.plan || l.kcal == null || !l.ts) return;
    const slotRaw = String(l.slot ?? "");
    if (/_adjustment$/.test(slotRaw) || l.correction) {
      const base = slotRaw.replace(/_adjustment$/, "");
      const prev = [...meals].reverse().find((m) => m.date === l.date && m.raw === base);
      if (prev) { prev.kcal += Number(l.kcal) || 0; prev.protein += Number(l.protein_g) || 0; prev.note = String(l.correction ?? ""); }
      return;
    }
    const name = String(l.items ?? l.food ?? l.note ?? slotRaw).trim();
    meals.push({ id: `wyn-diet-${l.ts}-${i}`, raw: slotRaw, date: l.date, at: tsIso(l.ts), slot: slotOf(slotRaw, istHour(l.ts)), name: name.charAt(0).toUpperCase() + name.slice(1),
      kcal: Number(l.kcal) || 0, protein: Number(l.protein_g) || 0, estimate: !!l.estimate, source: "wyn", how: "Logged by Wyn from your message" });
  });
  for (const { raw, ...m } of meals) { put("meals", m); out.meals++; }
  // gym and cardio: a day he went is one session (cardio lines become its items); a missed day keeps his reason
  const gym = readLines(join(dir, "gym.jsonl")), cardio = readLines(join(dir, "cardio.jsonl"));
  const days = [...new Set([...gym, ...cardio].map((l) => l.date).filter(Boolean))].sort();
  for (const date of days) {
    const g = gym.filter((l) => l.date === date), c = cardio.filter((l) => l.date === date && l.mins);
    const started = g.find((l) => l.started), split = g.find((l) => typeof l.planned === "string")?.planned ?? null;
    const cardioOnly = g.some((l) => l.type === "cardio_only") || (!split && c.length);
    if (started || c.length) {
      const t0 = started?.time ? `${date}T${started.time}:00+05:30` : started?.ts ? tsIso(started.ts) : c[0]?.ts ? tsIso(c[0].ts - (c[0].mins ?? 0) * 60) : `${date}T18:00:00+05:30`;
      const items = c.map((x) => ({ ex: x.type === "treadmill" ? "walk" : "bike", kind: "cardio", name: x.type === "treadmill" ? "Treadmill" : String(x.type ?? "Cardio"),
        sets: [{ min: Number(x.mins) || 0, km: x.distance_km ?? null, incline: x.incline_pct ?? null, speed: x.speed_kmh ?? null, done: true }] }));
      const notes = g.map((l) => l.note).filter(Boolean).concat(c.map((l) => l.note).filter(Boolean));
      const mins = c.reduce((a, x) => a + (Number(x.mins) || 0), 0) || null;
      put("workouts", { id: `wyn-gym-${date}`, date, status: "done", split: cardioOnly ? "cardio" : split, name: cardioOnly ? "Cardio" : split ? split[0].toUpperCase() + split.slice(1) : "Gym",
        started_at: new Date(t0).toISOString(), ended_at: null, at: started?.time ?? (started?.ts ? istHm(started.ts) : null), dur: mins, kcal: c.reduce((a, x) => a + (Number(x.kcal_out) || 0), 0) || null,
        items, note: notes.join(" · "), logged: items.length > 0, source: "wyn" });
      out.workouts++;
    } else if (g.some((l) => l.done === 0)) {
      const miss = g.find((l) => l.done === 0);
      put("workouts", { id: `wyn-miss-${date}`, date, status: "skipped", split: null, name: "Missed", started_at: null, ended_at: null, items: [], note: String(miss.reason ?? ""), source: "wyn" });
      out.missed++;
    }
  }
  // profile: the latest line wins (age, height, the 105-day challenge)
  const body = readLines(join(dir, "body.jsonl")).sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0));
  const last = body[body.length - 1];
  if (last) {
    const prof = { id: "profile", age: last.age ?? null, height_cm: last.height_cm ?? null, sex: last.sex ?? null, source: "wyn",
      challenge: last.challenge_days ? { days: last.challenge_days, end: last.challenge_end ?? null, start: last.challenge_end ? addDays(last.challenge_end, -(last.challenge_days - 1)) : last.date } : null };
    const cur = getDoc(db, "settings", "profile");
    if (!cur) { out.docs.push({ kind: "settings", id: "profile" }); if (!dry) putDoc(db, "settings", prof); out.profile = 1; } else out.skipped++;
  }
  return out;
}

// ── the CLI ─────────────────────────────────────────────────────────────
const READING_KINDS = ["weight", "sleep", "steps", "rhr", "hrv", "water", "activeEnergy"];
const UNITS: Record<string, string> = { weight: "kg", sleep: "min", steps: "steps", rhr: "bpm", hrv: "ms", water: "glasses", activeEnergy: "kcal" };

export const body: Module = {
  name: "body",
  help: `agentos body [workouts|meals|records|exercises]  Body: sessions, sets, meals, readings, the free-exercise-db library (v2)
agentos body log-meal "<name>" --kcal N --protein N [--slot lunch] · body reading <kind> <value> [--date]
agentos body import-wyn [--dir <wyn home\\life>] [--dry]   his gym, diet and profile lines from Wyn's files`,
  migrate: migrateBody,
  run(db, a, ctx) {
    const sub = a._[1];
    if (!sub) return overview(db, ctx);
    if (sub === "workouts") return workouts(db, a, ctx);
    if (sub === "meals") return meals(db, a, ctx);
    if (sub === "records") {
      const r = Object.values(records(listDocs(db, "workouts")));
      return ctx.out({ count: r.length, records: r.map((x) => ({ ex: x.ex, name: x.name, best: x.set.w != null ? `${x.set.w} kg × ${x.set.r}` : x.set.t != null ? `${x.set.t} s` : `${x.set.r} reps`, est: x.est, date: x.date })) });
    }
    if (sub === "exercises") {
      const q = ctx.str(a, "search") ?? a._.slice(2).join(" "); const m = ctx.str(a, "muscle") ?? "";
      const lim = Math.min(200, Number(ctx.str(a, "limit") ?? 20) || 20);
      const mine = listDocs(db, "exercises").filter((e) => !q || String(e.name).toLowerCase().includes(q.toLowerCase()));
      const lib = searchLibrary(q, m, lim);
      return ctx.out({ library: library().length, mine: mine.map((e) => ({ id: e.id, name: e.name, kind: e.kind })),
        matches: lib.map((e) => ({ id: e.id, name: e.name, kind: e.kind, equip: e.equip, muscles: [...e.p, ...e.s].join(" ") })) }, ["agentos body exercises --search \"bench press\" --json"]);
    }
    if (sub === "log-meal") {
      const name = a._.slice(2).join(" ").trim();
      if (!name) throw new ctx.UserError('Say what you ate: agentos body log-meal "2 roti and dal" --kcal 420 --protein 18');
      const kcal = Number(ctx.str(a, "kcal")), protein = Number(ctx.str(a, "protein") ?? 0);
      if (!Number.isFinite(kcal) || kcal < 0) throw new ctx.UserError("--kcal takes the calories, e.g. --kcal 420.");
      const at = ctx.str(a, "at") ?? ctx.iso();
      if (Number.isNaN(Date.parse(at))) throw new ctx.UserError("--at takes an ISO time.");
      const hour = new Date(Date.parse(at) + 330 * 60000).getUTCHours();
      const doc = putDoc(db, "meals", { name, kcal, protein: Number.isFinite(protein) ? protein : 0, at: new Date(at).toISOString(), date: istDay(new Date(at)),
        slot: ctx.str(a, "slot") ?? slotOf("", hour), source: "cli", items: [] });
      return ctx.out({ ok: true, meal: { id: doc.id, name: doc.name, kcal: doc.kcal, protein: doc.protein, slot: doc.slot, date: doc.date } });
    }
    if (sub === "reading") {
      const kind = a._[2]; const value = Number(a._[3]);
      if (!kind || !READING_KINDS.includes(kind)) throw new ctx.UserError(`Kinds: ${READING_KINDS.join(", ")}. Example: agentos body reading weight 76.8 --date 2026-07-18`);
      if (!Number.isFinite(value)) throw new ctx.UserError("The value is a number.");
      const date = ctx.str(a, "date") ?? ctx.istDate();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ctx.UserError("--date is YYYY-MM-DD.");
      const doc = putDoc(db, "readings", { id: `${kind}:${date}`, kind, date, value, unit: UNITS[kind], source: ctx.str(a, "source") ?? "manual" });
      return ctx.out({ ok: true, reading: { id: doc.id, kind, date, value, unit: doc.unit, source: doc.source } });
    }
    if (sub === "import-wyn") {
      const dir = ctx.str(a, "dir") ?? join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "wyn", "home", "life");
      if (!existsSync(dir)) throw new ctx.UserError(`No folder at ${dir}. Pass --dir <Wyn's home\\life folder>.`);
      const r = importWyn(db, dir, { dry: !!a.flags.dry });
      return ctx.out({ dir, dry: !!a.flags.dry, meals: r.meals, workouts: r.workouts, missed: r.missed, profile: r.profile, alreadyThere: r.skipped, written: r.docs.length });
    }
    throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos body [workouts|meals|records|exercises|log-meal|reading|import-wyn]`);
  },
};

function overview(db: Database, ctx: ModCtx) {
  const today = ctx.istDate();
  const since = addDays(today, -6);
  const all = listDocs(db, "workouts", "date >= ? AND date <= ?", addDays(today, -27), addDays(today, 7));
  const week = all.filter((w) => w.date >= since && w.date <= today && w.status === "done");
  const planned = all.filter((w) => w.status === "planned" && w.date >= today);
  const food = listDocs(db, "meals", "date = ?", today);
  const checks = listDocs(db, "checks", "date = ? AND done = 1", today).length;
  const items = listDocs(db, "protocol", "active = 1").length;
  const latest: Record<string, any> = {};
  for (const r of listDocs(db, "readings").sort((x, y) => String(x.date).localeCompare(String(y.date)))) latest[r.kind] = { value: r.value, date: r.date, source: r.source };
  const last = listDocs(db, "workouts", "status = 'done'").sort((x, y) => String(y.date).localeCompare(String(x.date)))[0] ?? null;
  ctx.out({
    today, sessions7: week.length, sets7: week.reduce((a, w) => a + setsOf(w), 0), volume7: Math.round(week.reduce((a, w) => a + volumeOf(w), 0)),
    last: last ? { date: last.date, name: last.name, sets: setsOf(last) } : null,
    planned: planned.map((w) => ({ date: w.date, name: w.name, at: w.at ?? null })),
    food: mealTotals(food), protocol: { done: checks, items }, readings: latest,
  }, ["agentos body workouts", "agentos body meals", "agentos body records"]);
}
function workouts(db: Database, a: Args, ctx: ModCtx) {
  const days = Number(ctx.str(a, "days") ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new ctx.UserError("--days takes 1 to 3650.");
  const from = addDays(ctx.istDate(), -days);
  const rows = listDocs(db, "workouts", "date >= ?", from).sort((x, y) => String(y.date).localeCompare(String(x.date)));
  ctx.out({ count: rows.length, workouts: rows.map((w) => ({ id: w.id, date: w.date, status: w.status, name: w.name, sets: setsOf(w), volume: Math.round(volumeOf(w)), source: w.source ?? "", note: w.note ?? "" })) });
}
function meals(db: Database, a: Args, ctx: ModCtx) {
  const date = ctx.str(a, "date") ?? ctx.istDate();
  const rows = listDocs(db, "meals", "date = ?", date).sort((x, y) => String(x.at).localeCompare(String(y.at)));
  ctx.out({ date, totals: mealTotals(rows), meals: rows.map((m) => ({ id: m.id, at: String(m.at ?? "").slice(11, 16), slot: m.slot, name: m.name, kcal: m.kcal, protein: m.protein, source: m.source ?? "" })) });
}

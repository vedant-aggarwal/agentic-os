// Soul (v2): habits and check-ins with forgiving streaks, the Clean streak (private: outside its own tab it is only
// ever "Day N"), urges, the blocker (locks, the agent's lock asks, unlock talks), values and the nightly reflection.
// The tables belong to agentos's soul module (cli/src/modules/soul.ts, migrated here on first use); the rules
// (streaks, Clean's day, lock windows, the unlock judge) are app/js/aspects/soul-logic.js, which the phone runs too.
//   GET/PUT/POST/DELETE /api/v1/mod/soul/{habits,checks,clean,resets,urges,moods,locks,asks,talks,values,reflections}[/<id>]
//   GET  /api/v1/mod/soul/summary           habits today, streaks, the lock that holds, her open ask; Clean as "Day N" only
//   POST /api/v1/mod/soul/asks/<id>/answer  { choice: "yes" | "no" }  (the widget's Yes/No and the agent feed)
// POST /checks takes NATIVE's App Intent body { id, habit, at, done, source } and fills the date from `at`.
// Jobs: soul-asks (every 15 min: her lock ask before an "ask first" window), soul-links (every 15 min: ticks habits
// that another app proves, e.g. a journal entry in Growth or a workout in Body).
import type { Database } from "bun:sqlite";
import { mountCollection } from "./_collection";
import type { AgentTool, JobCtx, ModCtx, Module } from "./types";
import { SOUL_TABLES, soul as soulCli } from "../../cli/src/modules/soul.ts";
import {
  habitState, checkId, dateAt, minOfDay, cleanDay, lockHolds, lockEnds, lockWhen, judgeUnlock, parseHM, DAILY_OPENS, WEAK, toMs, hhmmAt, addDays,
} from "../../app/js/aspects/soul-logic.js";

const ready = new Set<string>(), readyMem = new WeakSet<Database>();
const prepare = (db: Database) => {
  const k = (db as any).filename ?? "";
  if (k && k !== ":memory:" ? ready.has(k) : readyMem.has(db)) return;
  soulCli.migrate(db);
  if (k && k !== ":memory:") ready.add(k); else readyMem.add(db);
};
const str = (v: unknown, max = 200) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
const HM = /^\d{1,2}:\d{2}$/;

// validation per collection (a message refuses the write with 400)
const V: Record<string, (d: any) => string | null> = {
  habits: (d) => (d.deleted_at ? null : !str(d.title, 80) ? "a habit needs a title" : d.part && !["morning", "evening"].includes(d.part) ? "part is morning or evening" : d.at && !HM.test(d.at) && !str(d.at, 30) ? "at is HH:MM" : null),
  checks: (d) => {
    if (!str(d.habit, 80)) return "habit is the habit's id";
    if (!d.date && d.at && Number.isFinite(Date.parse(d.at))) d.date = dateAt(Date.parse(d.at));   // App Intents send at only
    if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return "date is YYYY-MM-DD";
    if (d.done == null && d.count == null && !d.rest) d.done = true;
    return d.date ? null : "a check needs a date or at";
  },
  clean: (d) => (d.since && !Number.isFinite(Date.parse(d.since)) ? "since is a time" : null),
  resets: (d) => (Number.isFinite(Date.parse(d.at)) ? null : "at is a time"),
  urges: (d) => (Number.isFinite(Date.parse(d.at)) ? (d.out && !["rode", "slip"].includes(d.out) ? "out is rode or slip" : null) : "at is a time"),
  moods: (d) => (Number(d.v) >= 1 && Number(d.v) <= 5 ? null : "v is 1 to 5"),
  locks: (d) => (d.deleted_at ? null : !str(d.name, 60) ? "a lock needs a name" : !["window", "bedtime", "limit", "hard", "now"].includes(d.kind) ? "kind is window, bedtime, limit, hard or now"
    : (d.kind === "window" || d.kind === "bedtime") && !(HM.test(d.start) && HM.test(d.end)) ? "a window needs start and end as HH:MM" : null),
  asks: (d) => (["pending", "yes", "no"].includes(d.state) ? null : "state is pending, yes or no"),
  talks: (d) => (["open", "held", "pass"].includes(d.out) ? null : "out is open, held or pass"),
  values: (d) => (d.deleted_at || str(d.name, 60) ? null : "a value needs a name"),
  reflections: (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d.date) && str(d.value, 80) && [0, 1, 2].includes(Number(d.v)) ? null : "a reflection needs date, value and v (0, 1, 2)"),
};
const COLS = Object.fromEntries(Object.keys(V).map((name) => [name, mountCollection({
  table: `soul_${name}`, columns: SOUL_TABLES[`soul_${name}`] as any, validate: V[name],
  ...(name === "asks" ? { onWrite: (doc: any, ctx: ModCtx) => { if (doc.state === "yes") applyAskYes(ctx.db(), doc); } } : {}),
})])) as Record<string, ReturnType<typeof mountCollection>>;
const list = (db: Database, name: string) => COLS[name].list(db).items;
// a server-side edit must beat the stored copy under last-write-wins, even in the same millisecond
const later = (cur: any) => new Date(Math.max(Date.now(), (Date.parse(cur?.updated_at ?? "") || 0) + 1)).toISOString();

// ── the reads everyone shares ────────────────────────────────────────────
function today(db: Database, nowMs = Date.now()) {
  prepare(db);
  const date = dateAt(nowMs), m = minOfDay(nowMs);
  const checks = list(db, "checks");
  const habits = list(db, "habits").filter((h: any) => !h.archived).sort((a: any, b: any) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((h: any) => ({ h, s: habitState(h, checks, date, m) }));
  const asks = list(db, "asks");
  const locks = list(db, "locks");
  const holding = locks.filter((l: any) => lockHolds(l, nowMs, { asks }));
  return { date, m, habits, asks, locks, holding };
}
const habitOut = ({ h, s }: any) => ({ id: h.id, title: h.title, part: h.part ?? "morning", at: h.at ?? null, done: s.done, streak: s.streak, best: s.best, atRisk: s.atRisk, missed: s.missed, rested: s.rested });

export function summary(db: Database, nowMs = Date.now()) {
  const t = today(db, nowMs);
  const clean = list(db, "clean").find((c: any) => c.since && c.active !== false);
  const pending = t.asks.filter((a: any) => a.date === t.date && a.state === "pending").sort((a: any, b: any) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] ?? null;
  return {
    date: t.date,
    habits: { done: t.habits.filter((x) => x.s.done).length, total: t.habits.length, items: t.habits.map(habitOut) },
    // Clean is private: only "Day N" leaves its tab, and only when he set one up
    clean: clean ? { text: `Day ${cleanDay(toMs(clean.since), nowMs)}`, private: true, widget: !!clean.widget } : null,
    locks: { on: t.locks.filter((l: any) => l.active !== false && l.kind !== "now").length, holding: t.holding.map((l: any) => ({ id: l.id, name: l.name, apps: l.apps ?? [], until: lockEnds(l, nowMs) })) },
    ask: pending ? { id: pending.id, title: pending.title, text: pending.text ?? null, lock: pending.lock ?? null } : null,
  };
}

// his yes to a lock ask: an "ask first" lock already holds by it (lockHolds reads the ask); a one-off window becomes a lock
function applyAskYes(db: Database, ask: any) {
  if (ask.lock || !ask.start || !ask.end) return;
  const id = `lk_ask_${ask.id}`.slice(0, 80);
  if (COLS.locks.get(db, id)) return;
  COLS.locks.upsert(db, { id, name: ask.name ?? "Lock", kind: "window", apps: ask.apps ?? [], start: ask.start, end: ask.end, days: ask.days ?? [], active: true, strict: "reason", how: "You said yes to her ask", learned: !!ask.learned });
}

// the talk, on the PC: the agent hears his reason (chat, a call, the shield's Ask) and decides within his rules
function judge(db: Database, { app, reason, round = 0 }: { app?: string; reason: string; round?: number }, nowMs = Date.now()) {
  const t = today(db, nowMs);
  const appId = String(app ?? "").toLowerCase() || null;
  const lock = t.holding.find((l: any) => !appId || !(l.apps ?? []).length || (l.apps ?? []).map((x: string) => x.toLowerCase()).includes(appId)) ?? null;
  if (!lock) return { out: "open", locked: false, say: "Nothing is locked right now." };
  const talks = list(db, "talks");
  const opensUsed = talks.filter((x: any) => x.date === t.date && x.out === "open").length;
  const weekAgo = addDays(t.date, -6);
  const weakWeek = talks.filter((x: any) => x.date >= weekAgo && WEAK.test(String(x.reason ?? ""))).length;
  const hard = t.locks.some((l: any) => l.kind === "hard" && l.active !== false);
  const ends = lockEnds(lock, nowMs);
  const d = judgeUnlock({ text: reason, round, opensLeft: DAILY_OPENS - opensUsed, strict: lock.strict ?? "reason", hard, ends, weakWeek });
  if (d.out === "more") return { out: "more", locked: true, say: d.text, lock: lock.id };
  const until = d.out === "open" ? new Date(nowMs + d.mins * 6e4).toISOString() : null;
  const say = d.out === "open" ? d.say(hhmmAt(toMs(until!))) : d.text;
  const talk = COLS.talks.upsert(db, { id: `tk_${nowMs.toString(36)}${Math.random().toString(36).slice(2, 6)}`, date: t.date, at: new Date(nowMs).toISOString(), app: appId ?? (lock.apps ?? [])[0] ?? null,
    lock: lock.id, lockName: lock.name, reason, out: d.out === "open" ? "open" : "held", mins: d.out === "open" ? d.mins : null, until, chat: [["me", reason], ["wyn", say]], source: "agent" }).item;
  return { out: talk.out, locked: true, mins: talk.mins, until, say, talk: talk.id, lock: lock.id };
}

// ── jobs ──────────────────────────────────────────────────────────────────
// Before an "ask first" window she asks once that day (the Today card, the feed, the Yes/No widget). The push is the
// shipping app's: a no-op without APNs keys.
async function askJob(ctx: JobCtx) {
  const db = ctx.db(); prepare(db);
  const nowMs = Date.now(), date = dateAt(nowMs), m = minOfDay(nowMs);
  const asks = list(db, "asks");
  for (const l of list(db, "locks") as any[]) {
    if (l.active === false || !l.ask_first || !HM.test(l.start ?? "")) continue;
    if (Array.isArray(l.days) && l.days.length && !l.days.includes(((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1)) continue;
    const s = parseHM(l.start)!;
    if (m < s - 45 || m >= s) continue;
    const id = `ask_${l.id}_${date}`.slice(0, 80);
    if (asks.some((a: any) => a.id === id)) continue;
    const apps = (l.apps ?? []).join(", ") || "your apps";
    const title = `Lock ${apps} ${l.start}–${l.end}?`;
    COLS.asks.upsert(db, { id, date, lock: l.id, title, text: `${l.name}: ${apps} locks at ${l.start} and opens at ${l.end}. Say no and it stays open tonight.`, state: "pending", by: "wyn", at: new Date(nowMs).toISOString() });
    await ctx.push(title, `Yes locks it at ${l.start}. You can still ask me to open it.`, { link: "agenticos://soul/blocker" }).catch(() => {});
  }
}
// A habit linked to another app ticks itself when that app has a record today (only tables that exist are read).
const LINKS: Record<string, { table: string; at: string }> = {
  "growth/journal": { table: "growth_journal", at: "at" }, "body/workouts": { table: "body_workouts", at: "at" }, "mind/reading": { table: "mind_sessions", at: "at" },
};
async function linksJob(ctx: JobCtx) {
  const db = ctx.db(); prepare(db);
  const nowMs = Date.now(), date = dateAt(nowMs);
  const have = new Set((db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as any[]).map((r) => r.name));
  for (const h of list(db, "habits") as any[]) {
    const link = LINKS[h.link]; if (!link || !have.has(link.table) || h.archived) continue;
    const id = checkId(h.id, date);
    if (COLS.checks.get(db, id)) continue;   // his own tick or undo wins
    let hit: any = null;
    try {
      const cols = (db.query(`PRAGMA table_info(${link.table})`).all() as any[]).map((c) => c.name);
      const atCol = cols.includes(link.at) ? link.at : "created_at";
      hit = (db.query(`SELECT ${atCol} AS at FROM ${link.table} WHERE deleted_at IS NULL AND ${atCol} >= ? ORDER BY ${atCol} LIMIT 1`).get(new Date(Date.parse(`${date}T00:00:00Z`) - 330 * 6e4).toISOString()) as any);
    } catch { continue; }
    if (hit?.at) COLS.checks.upsert(db, { id, habit: h.id, date, at: hit.at, done: true, by: h.link.split("/")[0], source: "link", how: `From ${h.link.split("/")[0]}` });
  }
}

// ── agent tools (DECISIONS 2: ticking, logging and the unlock call are hers; a new lock window asks him first) ──
const tools: AgentTool[] = [
  {
    name: "soul_status", auto: true,
    description: "Read Soul today: each habit (done, streak, at risk), the lock holding now, her open lock ask. Clean is private: it is only ever \"Day N\"; never name what it is for, and never mention it outside Soul unless he does.",
    input: { type: "object", properties: {} },
    async run(ctx) { return summary(ctx.db()); },
  },
  {
    name: "soul_check_habit", auto: true,
    description: "Tick (or untick, or mark a rest day for) one of Alex's habits for today, when he says he did it or another app proves it. Report it after.",
    input: { type: "object", required: ["habit"], properties: { habit: { type: "string", description: "The habit's id or title" }, done: { type: "boolean" }, rest: { type: "boolean" }, count: { type: "number" } } },
    async run(ctx, a) {
      const db = ctx.db(); const t = today(db);
      const q = String(a.habit ?? "").toLowerCase();
      const hit = t.habits.find((x) => x.h.id === a.habit) ?? t.habits.find((x) => x.h.title.toLowerCase() === q) ?? t.habits.find((x) => x.h.title.toLowerCase().includes(q));
      if (!hit) return { ok: false, error: `No habit "${a.habit}"`, habits: t.habits.map((x) => ({ id: x.h.id, title: x.h.title })) };
      const id = checkId(hit.h.id, t.date);
      COLS.checks.upsert(db, { id, habit: hit.h.id, date: t.date, at: new Date().toISOString(), updated_at: later(COLS.checks.get(db, id)), done: a.rest ? false : a.done !== false, rest: !!a.rest, count: a.count ?? null, by: "wyn", source: "agent" });
      return { ok: true, ...habitOut(today(db).habits.find((x) => x.h.id === hit.h.id)) };
    },
  },
  {
    name: "soul_log_urge", auto: true,
    description: "Log an urge or a pull he tells you about (an app, a habit he's leaving): when, where, how he felt, what came before, whether he rode it out. Private to Soul.",
    input: { type: "object", properties: { at: { type: "string", description: "ISO time, default now" }, place: { type: "string" }, feel: { type: "string" }, before: { type: "string" }, did: { type: "string" }, out: { type: "string", enum: ["rode", "slip"] }, mins: { type: "number" } } },
    async run(ctx, a) {
      const db = ctx.db(); prepare(db);
      const u = COLS.urges.upsert(db, { id: `urg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: a.at ?? new Date().toISOString(), place: a.place ?? null, feel: a.feel ?? null, before: a.before ?? null, did: a.did ?? null, out: a.out ?? "rode", mins: a.mins ?? null, source: "agent" }).item;
      return { ok: true, id: u.id, out: u.out };
    },
  },
  {
    name: "soul_propose_lock", auto: false,
    description: "Propose locking an app for a window of time (from the hours his time slips). This puts a Yes/No ask on his Soul screen and widget; the lock starts only on his yes. Ask him before proposing a new recurring window.",
    input: { type: "object", required: ["apps", "start", "end"], properties: { apps: { type: "array", items: { type: "string" } }, start: { type: "string", description: "HH:MM" }, end: { type: "string", description: "HH:MM" }, days: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 }, description: "1 = Monday" }, name: { type: "string" }, why: { type: "string" } } },
    async run(ctx, a) {
      const db = ctx.db(); prepare(db);
      if (!HM.test(a.start ?? "") || !HM.test(a.end ?? "")) return { ok: false, error: "start and end are HH:MM" };
      const date = dateAt(Date.now()); const apps = (a.apps ?? []).join(", ");
      const ask = COLS.asks.upsert(db, { id: `ask_${Date.now().toString(36)}`, date, title: `Lock ${apps} ${a.start}–${a.end}?`, text: a.why ?? null, state: "pending", by: "wyn", apps: a.apps ?? [], start: a.start, end: a.end, days: a.days ?? [], name: a.name ?? `${apps} ${a.start}–${a.end}`, at: new Date().toISOString() }).item;
      return { ok: true, ask: ask.id, title: ask.title };
    },
  },
  {
    name: "soul_answer_unlock", auto: true,
    description: "He asks to open a locked app. Pass his reason; this applies his rules (3 opens a day, hard mode, the lock's strictness) and decides: open for 2 to 15 minutes, hold the line, or ask him for more. Say the returned line in your own warm, steady words. A friend, never a cop.",
    input: { type: "object", required: ["reason"], properties: { app: { type: "string" }, reason: { type: "string" }, round: { type: "integer", description: "1 if you already asked him for more" } } },
    async run(ctx, a) { return judge(ctx.db(), { app: a.app, reason: String(a.reason ?? ""), round: Number(a.round) || 0 }); },
  },
  {
    name: "soul_check_in", auto: true,
    description: "Log how he says he feels right now, 1 (low) to 5 (great). It times her nudges; it stays in Soul.",
    input: { type: "object", required: ["v"], properties: { v: { type: "integer", minimum: 1, maximum: 5 } } },
    async run(ctx, a) {
      const db = ctx.db(); prepare(db); const now = new Date();
      COLS.moods.upsert(db, { id: `md_${now.getTime().toString(36)}`, date: dateAt(now.getTime()), at: now.toISOString(), v: Math.max(1, Math.min(5, Math.round(Number(a.v)))), source: "agent" });
      return { ok: true };
    },
  },
];

export const soul: Module = {
  name: "soul",
  async handle(ctx) {
    let db: Database;
    try { db = ctx.db(); prepare(db); } catch { return ctx.fail(503, "Soul isn't set up on your PC yet."); }
    if (ctx.method === "GET" && (ctx.path === "/" || ctx.path === "/summary")) return ctx.json(summary(db));
    const ans = ctx.path.match(/^\/asks\/([A-Za-z0-9_.:-]{1,80})\/answer$/);
    if (ans && ctx.method === "POST") {
      const b = await ctx.body().catch(() => ({}));
      const choice = b?.choice === "no" || /^(no|keep|not)/i.test(String(b?.text ?? "")) ? "no" : "yes";
      const cur = COLS.asks.get(db, decodeURIComponent(ans[1]));
      if (!cur) return ctx.fail(404, "No such ask.");
      const r = COLS.asks.upsert(db, { ...cur, state: choice, answered_at: new Date().toISOString(), updated_at: later(cur) });
      if (r.item.state === "yes") applyAskYes(db, r.item);
      return ctx.json({ item: r.item });
    }
    for (const name of Object.keys(COLS)) { const r = await COLS[name].handle(ctx, `/${name}`); if (r) return r; }
    return null;
  },
  jobs: [
    { id: "soul-asks", every: "15m", run: askJob },
    { id: "soul-links", every: "15m", run: linksJob },
  ],
  tools,
};
// for tests
export const _soul = { summary, judge, askJob, linksJob, COLS, prepare };

// Week weather: a forecast of the week, not a plan. No LLM touches the numbers. From the user's own history
// (how long tasks really took per area, which hours they finish things in, which standing blocks get skipped,
// how dense each weekday usually is) the week is simulated a thousand times over the open tasks and the
// calendar: per dated task and per project, the chance it is done by its due day; per day, how booked it is;
// per standing block (gym, class, shoot), the chance it happens. Then the three changes that move the numbers
// most, found by re-running the simulation with each change applied. The phone server words those three lines
// with Haiku and writes a chosen change as a pencilled ai_batches batch; this module owns the tables, the
// inputs and the simulation.
//   agentos weather [--week this|next|<date>]      the latest forecast for that week
//   agentos weather run [--week ..] [--draws 1000] [--if-changed] [--seed n]
//   agentos weather inputs [--week ..] --json      the evidence the simulation saw (the cabinet reads this)
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Args, Module } from "./types";
import { mondayOf, plusDays, weekFrom } from "./cabinet";

const DEFAULT_EVENTS = () => process.env.AGENTOS_EVENTS || join(homedir(), "agentic-os", ".operator-data", "workspace.json");
const OFFSET = 330;
const DAY = 1440;
const CONTAINER = /deep work|strategy|hustle|side project|buffer|free time/i;
const GENERAL = /hustle|side project|buffer|free time/i;
const SLEEP = /\bsleep\b/i;
const MISS = /^(skipped( today)?|not attended|missed|didn.?t (do|go|attend))\s*[:\-–]\s*/i;
const STANDING = /gym|shoot|study|class|lecture|lab|tut|defen|cardio|workout|run\b|yoga|walk|practice|reel/i;
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Priors used while the history is thin: tasks run 25% over their estimate with a wide spread, a standing block
// happens 85% of the time, a scheduled task block is kept 80% of the time. Each one yields to data as it arrives.
const PRIOR_MU = Math.log(1.25), PRIOR_SIGMA = 0.45, PRIOR_K = 3, PRIOR_BLOCK = 0.85, P_TASK_SLOT = 0.8;

export const istDate = (d: Date) => new Date(d.getTime() + OFFSET * 60000).toISOString().slice(0, 10);
const minOf = (isoStr: string, date: string) => (Date.parse(isoStr) - Date.parse(`${date}T00:00:00+05:30`)) / 60000;
const hhmmMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
export const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const weekdayOf = (date: string) => WD[new Date(`${date}T00:00:00Z`).getUTCDay()];
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const baseTitle = (t: string) => String(t ?? "").replace(MISS, "").replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim().toLowerCase();
const round2 = (x: number) => Math.round(x * 100) / 100;

// ── inputs ──────────────────────────────────────────────────────────────────
export type Slot = { s: number; e: number };
export type EvIn = { id: string; title: string; area: string | null; s: number; e: number; container: boolean; general: boolean };
export type DayIn = {
  date: string; weekday: string; past: boolean; awake: Slot; events: EvIn[]; gaps: Slot[];
  containers: { title: string; area: string | null; general: boolean; s: number; e: number; minutes: number }[];
  scheduled: { taskId: number; s: number; e: number }[]; booked: number; free: number;
};
export type TaskIn = {
  id: number; title: string; area: string | null; project: string | null; due: string | null; minutes: number | null;
  priority: number; status: string; scheduled: { date: string; s: number; e: number } | null; created_at: string;
};
export type History = {
  overrun: Record<string, { mu: number; sigma: number; n: number }>;   // per area, ln(actual/planned); "*" is the pooled prior
  median: Record<string, number>; globalMedian: number | null; doneWithTimes: number;
  hourEff: number[];                                                  // 24 entries, 0.6..1: how often work gets finished in that hour
  density: Record<string, number>;                                    // weekday → booked share of the awake day, last 4 weeks
  blocks: Record<string, { title: string; occurrences: number; misses: number; p: number; basis: "history" | "prior" }>;
};
export type WeekInputs = {
  week: string; from: string | null; to: string; today: string; nowMin: number; days: DayIn[]; tasks: TaskIn[];
  projects: { key: string; name: string; area: string | null; deadline: string | null; taskIds: number[] }[];
  areas: { slug: string; name: string; color: string | null }[]; history: History; hash: string;
};

export function readEventsFile(path: string): any[] {
  if (!path || !existsSync(path)) return [];
  try { const ws = JSON.parse(readFileSync(path, "utf8")); return Array.isArray(ws.events) ? ws.events : []; } catch { return []; }
}

export function buildInputs(db: Database, opts: { week: string; now: Date; eventsPath?: string }): WeekInputs {
  const now = opts.now, today = istDate(now), nowMin = clamp(minOf(now.toISOString(), today), 0, DAY);
  const week = mondayOf(opts.week), to = plusDays(week, 6);
  const dates = Array.from({ length: 7 }, (_, i) => plusDays(week, i));
  const from = dates.find((d) => d >= today) ?? null;
  const areas = db.query("SELECT slug, name, color, pattern FROM areas ORDER BY sort").all() as any[];
  const areaOf = (title: string) => {
    for (const r of areas) { if (!r.pattern) continue; try { if (new RegExp(r.pattern, "i").test(title)) return r.slug as string; } catch {} }
    return null;
  };
  const overrides = new Map<string, any>();
  try { for (const o of db.query("SELECT * FROM event_overrides").all() as any[]) overrides.set(o.event_id, o); } catch {}
  let sleepDefault: { bed: string; wake: string } | null = null;
  try { const r = db.query("SELECT value FROM settings WHERE key = 'sleep.default'").get() as any; sleepDefault = r?.value ? JSON.parse(r.value) : null; } catch {}
  const raw = readEventsFile(opts.eventsPath ?? DEFAULT_EVENTS());
  // Multi-day events (a hack week, a trip) are background, not booked time, like all-day ones.
  const placed = raw.filter((e) => e?.start && !e.allDay).map((e) => {
    const o = overrides.get(e.id);
    const title = String(e.title ?? "");
    return { id: String(e.id), title, start: String(o?.start_at ?? e.start), end: String(o?.end_at ?? e.end ?? e.start), area: (o?.area ?? areaOf(`${title} ${e.calendarName ?? ""}`)) as string | null };
  }).filter((e) => Date.parse(e.end) - Date.parse(e.start) < 18 * 36e5);
  const tasksRaw = db.query("SELECT * FROM tasks WHERE status IN ('todo','doing') AND owner != 'claude' ORDER BY due IS NULL, due, priority, id").all() as any[];
  const tasks: TaskIn[] = tasksRaw.map((t) => {
    let scheduled: TaskIn["scheduled"] = null;
    if (t.start_at && t.end_at) {
      const date = istDate(new Date(t.start_at));
      scheduled = { date, s: minOf(t.start_at, date), e: minOf(t.end_at, date) };
    }
    return { id: t.id, title: t.title, area: t.area ?? null, project: t.project ?? null, due: t.due ?? null, minutes: t.estimate_minutes ?? null,
      priority: t.priority ?? 2, status: t.status, scheduled, created_at: t.created_at };
  }).filter((t) => (t.due && t.due <= to) || (t.scheduled && t.scheduled.date >= week && t.scheduled.date <= to) || (!t.due && !t.scheduled));
  // Undated, unscheduled tasks compete for time behind everything dated; keep the twenty most likely to be touched.
  const undated = tasks.filter((t) => !t.due && !t.scheduled).sort((x, y) => x.priority - y.priority || (x.created_at < y.created_at ? -1 : 1)).slice(0, 20);
  const kept = new Set([...tasks.filter((t) => t.due || t.scheduled), ...undated].map((t) => t.id));
  const taskList = tasks.filter((t) => kept.has(t.id));

  const days: DayIn[] = dates.map((date) => {
    const items = placed.map((ev) => ({ ...ev, s: minOf(ev.start, date), e: minOf(ev.end, date) })).filter((it) => it.e > 0 && it.s < DAY);
    const sleeps = items.filter((it) => SLEEP.test(it.title));
    const top = sleeps.filter((it) => it.s < 0 && it.e > 0).sort((a, b) => b.e - a.e)[0];
    const bottom = sleeps.filter((it) => it.s >= 12 * 60 && it.s < DAY).sort((a, b) => a.s - b.s)[0];
    let ws = top ? top.e : sleepDefault ? hhmmMin(sleepDefault.wake) : 7 * 60;
    let we = bottom ? bottom.s : sleepDefault ? (sleepDefault.bed >= "12:00" ? hhmmMin(sleepDefault.bed) : DAY) : 22 * 60;
    ws = clamp(Math.round(ws), 0, DAY); we = clamp(Math.round(we), ws, DAY);
    const events: EvIn[] = items.filter((it) => !SLEEP.test(it.title)).map((it) => ({ id: it.id, title: it.title, area: it.area, s: Math.max(it.s, ws), e: Math.min(it.e, we),
      container: CONTAINER.test(it.title), general: GENERAL.test(it.title) })).filter((it) => it.e > it.s);
    const scheduled = taskList.filter((t) => t.scheduled?.date === date).map((t) => ({ taskId: t.id, s: Math.max(t.scheduled!.s, ws), e: Math.min(t.scheduled!.e, we) })).filter((x) => x.e > x.s);
    const busy = [...events.map((x) => [x.s, x.e]), ...scheduled.map((x) => [x.s, x.e])].sort((x, y) => x[0] - y[0]);
    const gaps: Slot[] = [];
    let cur = ws;
    for (const [a, z] of busy) { if (a - cur >= 15) gaps.push({ s: cur, e: a }); cur = Math.max(cur, z); }
    if (we - cur >= 15) gaps.push({ s: cur, e: we });
    const containers = events.filter((x) => x.container).map((x) => {
      const inside = scheduled.reduce((n, s) => n + Math.max(0, Math.min(s.e, x.e) - Math.max(s.s, x.s)), 0);
      return { title: x.title.replace(/\s*\(.*$/, "").split(" & ")[0], area: x.area, general: x.general, s: x.s, e: x.e, minutes: Math.max(0, x.e - x.s - inside) };
    });
    const booked = events.reduce((n, x) => n + x.e - x.s, 0) + scheduled.reduce((n, x) => n + x.e - x.s, 0);
    return { date, weekday: weekdayOf(date), past: date < today, awake: { s: ws, e: we }, events, gaps, containers, scheduled, booked, free: gaps.reduce((n, g) => n + g.e - g.s, 0) };
  });

  // Projects: real ones from tasks.project, plus title prefixes ("Pulse Chat: ...") shared by two or more open tasks.
  const projRows = (() => { try { return db.query("SELECT slug, name, area, deadline FROM projects").all() as any[]; } catch { return []; } })();
  const groups = new Map<string, { name: string; area: string | null; deadline: string | null; taskIds: number[] }>();
  for (const t of taskList) {
    let key: string | null = null, name = "";
    if (t.project) { key = `p:${t.project}`; name = projRows.find((p) => p.slug === t.project)?.name ?? t.project; }
    else { const m = t.title.match(/^([^:]{2,40}):\s+\S/); if (m) { key = `t:${m[1].trim().toLowerCase()}`; name = m[1].trim(); } }
    if (!key) continue;
    const g = groups.get(key) ?? { name, area: t.area, deadline: projRows.find((p) => `p:${p.slug}` === key)?.deadline ?? null, taskIds: [] };
    g.taskIds.push(t.id);
    groups.set(key, g);
  }
  const projects = [...groups.entries()].filter(([k, g]) => k.startsWith("p:") || g.taskIds.length >= 2).map(([key, g]) => ({ key, ...g }));

  const history = buildHistory(db, placed, week, now, taskList, days);
  const hash = createHash("sha1").update(JSON.stringify({
    week, today,
    tasks: taskList.map((t) => [t.id, t.status, t.due, t.scheduled, t.minutes, t.area, t.project, t.priority]),
    events: days.flatMap((d) => d.events.map((e) => [e.id, e.s, e.e, d.date])), awake: days.map((d) => d.awake), sleepDefault,
  })).digest("hex").slice(0, 16);
  return { week, from, to, today, nowMin, days, tasks: taskList, projects, areas: areas.map(({ slug, name, color }) => ({ slug, name, color })), history, hash };
}

function buildHistory(db: Database, placed: { id: string; title: string; start: string; end: string; area: string | null }[], week: string, now: Date, tasks: TaskIn[], days: DayIn[]): History {
  const since = new Date(now.getTime() - 90 * 864e5).toISOString();
  const done = (() => { try { return db.query("SELECT title, area, estimate_minutes, started_at, done_at, start_at, end_at FROM tasks WHERE status = 'done' AND done_at >= ?").all(since) as any[]; } catch { return []; } })();
  const perArea: Record<string, { actual: number[]; ln: number[] }> = {};
  const hours = new Array(24).fill(0);
  let withTimes = 0;
  for (const r of done) {
    if (r.done_at) { const h = Number(new Date(Date.parse(r.done_at) + OFFSET * 60000).toISOString().slice(11, 13)); hours[h]++; }
    if (!r.started_at || !r.done_at) continue;
    const actual = (Date.parse(r.done_at) - Date.parse(r.started_at)) / 60000;
    if (!(actual >= 5 && actual <= 600)) continue;
    withTimes++;
    const planned = r.estimate_minutes ?? (r.start_at && r.end_at ? (Date.parse(r.end_at) - Date.parse(r.start_at)) / 60000 : null);
    const a = (perArea[r.area ?? "none"] ??= { actual: [], ln: [] });
    a.actual.push(actual);
    if (planned && planned > 0) a.ln.push(Math.log(actual / planned));
  }
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const allLn = Object.values(perArea).flatMap((a) => a.ln);
  const fit = (ln: number[]) => {
    const n = ln.length;
    const mean = n ? ln.reduce((x, y) => x + y, 0) / n : PRIOR_MU;
    const sd = n >= 3 ? Math.sqrt(ln.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : PRIOR_SIGMA;
    // Shrink toward the prior: with k pseudo-observations the prior fades as real ones arrive.
    return { mu: (n * mean + PRIOR_K * PRIOR_MU) / (n + PRIOR_K), sigma: clamp((n * sd + PRIOR_K * PRIOR_SIGMA) / (n + PRIOR_K), 0.15, 1.2), n };
  };
  const overrun: History["overrun"] = { "*": fit(allLn) };
  const median: Record<string, number> = {};
  for (const [area, a] of Object.entries(perArea)) {
    overrun[area] = fit(a.ln);
    if (a.actual.length >= 3) median[area] = Math.max(5, Math.round(med(a.actual) / 5) * 5);
  }
  const allActual = Object.values(perArea).flatMap((a) => a.actual);
  const globalMedian = allActual.length >= 3 ? Math.max(5, Math.round(med(allActual) / 5) * 5) : null;
  // Finish rate by hour: how much of the finishing happens in each hour, shrunk toward flat while the sample is small.
  const total = hours.reduce((x, y) => x + y, 0), peak = Math.max(...hours, 1);
  const weight = Math.min(1, total / 20);
  const hourEff = hours.map((n) => 1 - weight * 0.4 * (1 - n / peak));
  // Calendar density per weekday over the four weeks before this one, and how often standing blocks were skipped
  // (the calendar carries "Skipped today: X" / "Not attended: X" entries) over the eight weeks before it.
  const density: Record<string, number> = {};
  const dens: Record<string, { booked: number; awake: number }> = {};
  const occ: Record<string, { title: string; occurrences: number; misses: number }> = {};
  const h8 = plusDays(week, -56), h4 = plusDays(week, -28);
  for (const ev of placed) {
    const date = istDate(new Date(ev.start));
    if (date < h8 || date >= week) continue;
    const key = baseTitle(ev.title);
    if (!key) continue;
    if (MISS.test(ev.title)) { (occ[key] ??= { title: key, occurrences: 0, misses: 0 }).misses++; continue; }
    (occ[key] ??= { title: key, occurrences: 0, misses: 0 }).occurrences++;
    if (date >= h4 && !SLEEP.test(ev.title)) {
      const wd = weekdayOf(date);
      const d = (dens[wd] ??= { booked: 0, awake: 0 });
      d.booked += Math.max(0, (Date.parse(ev.end) - Date.parse(ev.start)) / 60000);
    }
  }
  for (const wd of WD) { const d = dens[wd]; density[wd] = d ? clamp(d.booked / (4 * 15 * 60), 0, 1) : 0; }
  const blocks: History["blocks"] = {};
  const inWeek = new Map<string, number>();
  for (const d of days) for (const e of d.events) inWeek.set(baseTitle(e.title), (inWeek.get(baseTitle(e.title)) ?? 0) + 1);
  for (const [key, n] of inWeek) {
    if (n < 2 && !STANDING.test(key)) continue;
    const o = occ[key] ?? { title: key, occurrences: 0, misses: 0 };
    const p = (o.occurrences - o.misses + PRIOR_BLOCK * 2) / (o.occurrences + 2);
    blocks[key] = { title: key, occurrences: o.occurrences, misses: o.misses, p: clamp(round2(p), 0.05, 0.99), basis: o.occurrences >= 3 ? "history" : "prior" };
  }
  return { overrun, median, globalMedian, doneWithTimes: withTimes, hourEff, density, blocks };
}

// ── simulation ──────────────────────────────────────────────────────────────
export type Mods = { move?: number; drop?: number; shrink?: number };
export type Forecast = {
  tasks: { id: number; title: string; area: string | null; due: string | null; late: boolean; minutes: number; probability: number; pWeek: number }[];
  projects: { key: string; name: string; area: string | null; due: string | null; tasks: number; probability: number }[];
  days: { date: string; weekday: string; past: boolean; awake: number; booked: number; demand: number; free: number; load: number }[];
  blocks: { key: string; title: string; area: string | null; days: string[]; probability: number; occurrences: number; misses: number; basis: string }[];
  score: number; draws: number;
};
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const normal = (rnd: () => number) => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const effOf = (h: History, s: number, e: number) => {
  let sum = 0;
  for (let m = s; m < e; m += 15) sum += 15 * (h.hourEff[Math.min(23, Math.floor(m / 60))] ?? 1);
  return sum;
};

export function simulate(inp: WeekInputs, opts: { draws?: number; seed?: number; mods?: Mods } = {}): Forecast {
  const draws = Math.max(50, Math.min(5000, opts.draws ?? 1000)), rnd = mulberry32(opts.seed ?? 42), mods = opts.mods ?? {};
  const H = inp.history;
  const days = inp.days.filter((d) => !d.past);
  const first = days[0]?.date ?? null, last = inp.to;
  const idx = new Map(days.map((d, i) => [d.date, i]));
  // A dropped task is deferred: it takes no time this week and never finishes, so it counts against its own odds
  // and its project's; the change only wins when the freed hours help the rest more than that costs.
  const tasks = inp.tasks.map((t) => ({ ...t }));
  for (const t of tasks) if (t.id === mods.move && first) { t.due = first; t.priority = 0; t.scheduled = null; }
  const base = (t: TaskIn) => (t.minutes ?? (t.area && H.median[t.area]) ?? H.globalMedian ?? 30) * (t.id === mods.shrink ? 0.5 : 1);
  const dist = (t: TaskIn) => H.overrun[t.area ?? "none"] ?? H.overrun["*"];
  const dueIdx = (t: TaskIn) => (!t.due ? days.length : first && t.due < first ? 0 : idx.get(t.due) ?? (t.due > last ? days.length : 0));
  const queue = [...tasks].filter((t) => t.id !== mods.drop).sort((x, y) => dueIdx(x) - dueIdx(y) || x.priority - y.priority || x.id - y.id);
  const pos = new Map(tasks.map((t, i) => [t.id, i]));
  const n = tasks.length;
  // Deterministic capacity per day: free gaps weighted by the hours work actually gets finished in.
  const cap0 = days.map((d) => d.gaps.reduce((s, g) => s + effOf(H, g.s, g.e), 0));
  const conts = days.map((d) => d.containers.map((c) => ({ ...c, eff: c.minutes ? effOf(H, c.s, c.e) * (c.minutes / (c.e - c.s)) : 0, p: H.blocks[baseTitle(c.title)]?.p ?? PRIOR_BLOCK })));
  const sched = days.map((d) => d.scheduled.filter((s) => s.taskId !== mods.drop).map((s) => ({ i: pos.get(s.taskId)!, len: s.e - s.s })).filter((s) => s.i !== undefined));
  const avail = (d: DayIn) => clamp(0.85 - 0.2 * (H.density[d.weekday] ?? 0) + 0.12 * normal(rnd), 0.4, 1);

  const finBy = new Array(n).fill(0), finWeek = new Array(n).fill(0), minsSum = new Array(n).fill(0);
  const projOk = inp.projects.map(() => 0);
  const target = tasks.map((t) => (t.due && first && t.due < first ? days.length - 1 : t.due ? idx.get(t.due) ?? (t.due > last ? days.length - 1 : -1) : days.length - 1));
  const rem = new Array(n).fill(0), fin = new Array(n).fill(-1);
  for (let k = 0; k < draws; k++) {
    for (let i = 0; i < n; i++) { const d = dist(tasks[i]); rem[i] = base(tasks[i]) * Math.exp(d.mu + d.sigma * normal(rnd)); minsSum[i] += rem[i]; fin[i] = -1; }
    for (let di = 0; di < days.length; di++) {
      const day = days[di], a = avail(day);
      let cap = cap0[di] * a, anyCap = 0;
      const ded: Record<string, number> = {};
      for (const c of conts[di]) if (rnd() < c.p) { const v = c.eff * a; if (c.general || !c.area) anyCap += v; else ded[c.area] = (ded[c.area] ?? 0) + v; }
      for (const s of sched[di]) {
        if (fin[s.i] >= 0 || rnd() >= P_TASK_SLOT) continue;
        rem[s.i] -= Math.min(rem[s.i], s.len * a);
        if (rem[s.i] <= 0.5) fin[s.i] = di;
      }
      // Due-date order, but no single task takes more than three quarters of a day: a thirty-hour monster
      // does not stop a fifteen-minute call from happening.
      const share = Math.max(15, 0.75 * (cap + anyCap + Object.values(ded).reduce((s, v) => s + v, 0)));
      for (const t of queue) {
        const i = pos.get(t.id)!;
        if (fin[i] >= 0 || (t.scheduled && t.scheduled.date > day.date)) continue;
        let room = Math.min(rem[i], share);
        if (t.area && ded[t.area] > 0) { const w = Math.min(room, ded[t.area]); rem[i] -= w; ded[t.area] -= w; room -= w; }
        if (room > 0 && cap > 0) { const w = Math.min(room, cap); rem[i] -= w; cap -= w; room -= w; }
        if (room > 0 && anyCap > 0) { const w = Math.min(room, anyCap); rem[i] -= w; anyCap -= w; room -= w; }
        if (rem[i] <= 0.5) fin[i] = di;
      }
    }
    for (let i = 0; i < n; i++) { if (fin[i] >= 0) finWeek[i]++; if (fin[i] >= 0 && fin[i] <= target[i]) finBy[i]++; }
    inp.projects.forEach((p, j) => { if (p.taskIds.every((id) => { const i = pos.get(id); return i === undefined || (fin[i] >= 0 && fin[i] <= target[i]); })) projOk[j]++; });
  }
  const taskOut = tasks.map((t, i) => ({ id: t.id, title: t.title, area: t.area, due: t.due, late: !!(t.due && first && t.due < first), minutes: Math.round(minsSum[i] / draws),
    probability: round2(finBy[i] / draws), pWeek: round2(finWeek[i] / draws) }));
  const dated = taskOut.filter((t) => t.due && t.due <= last);
  const projects = inp.projects.map((p, j) => ({ key: p.key, name: p.name, area: p.area, tasks: p.taskIds.length,
    due: p.deadline ?? p.taskIds.map((id) => tasks.find((t) => t.id === id)?.due).filter((d): d is string => !!d).sort().at(-1) ?? null, probability: round2(projOk[j] / draws) }));
  const expect = (t: TaskIn) => { const d = dist(t); return base(t) * Math.exp(d.mu + d.sigma ** 2 / 2); };
  const dayOut = inp.days.map((d) => {
    const demand = d.past ? 0 : tasks.filter((t) => !t.scheduled && t.due && ((t.due === d.date) || (d.date === first && t.due < first))).reduce((s, t) => s + expect(t), 0);
    const awake = Math.max(1, d.awake.e - d.awake.s);
    return { date: d.date, weekday: d.weekday, past: d.past, awake, booked: Math.round(d.booked), demand: Math.round(demand), free: d.free, load: Math.round(((d.booked + demand) / awake) * 100) };
  });
  const blocks = Object.values(H.blocks).map((b) => {
    const on = inp.days.filter((d) => d.events.some((e) => baseTitle(e.title) === b.title));
    return { key: b.title, title: on[0]?.events.find((e) => baseTitle(e.title) === b.title)?.title.replace(/\s*\([^)]*\)/g, "").trim() ?? b.title,
      area: on[0]?.events.find((e) => baseTitle(e.title) === b.title)?.area ?? null, days: on.map((d) => d.weekday), probability: b.p, occurrences: b.occurrences, misses: b.misses, basis: b.basis };
  }).sort((x, y) => x.probability - y.probability);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const parts = [mean(dated.map((t) => t.probability)), mean(projects.map((p) => p.probability))].filter((x): x is number => x != null);
  return { tasks: taskOut, projects, days: dayOut, blocks, score: parts.length ? round2(parts.reduce((a, b) => a + b, 0) / parts.length) : 0, draws };
}

// ── the three changes, and a plain-code wording for each ────────────────────
export type Change = { kind: "move" | "drop" | "shrink"; taskId: number; title: string; area: string | null; delta: number; before: number; after: number;
  metric: string; line: string; proposal: Record<string, unknown> };
export function rankChanges(inp: WeekInputs, baseline: Forecast, opts: { draws?: number; seed?: number } = {}): Change[] {
  const draws = opts.draws ?? 300, seed = opts.seed ?? 42;
  const first = inp.from;
  if (!first) return [];
  const nextWeek = plusDays(inp.week, 7);
  const cands: { kind: Change["kind"]; t: TaskIn }[] = [];
  const base = new Map(baseline.tasks.map((t) => [t.id, t]));
  for (const t of inp.tasks) {
    const b = base.get(t.id);
    if (!b) continue;
    if (t.due && t.due <= inp.to && t.due > first && !t.scheduled && b.probability < 0.8) cands.push({ kind: "move", t });
    if (b.minutes >= 60) cands.push({ kind: "shrink", t });
  }
  // Drop candidates: the long tasks least likely to make it anyway, so deferring one costs little and frees the most.
  for (const b of [...baseline.tasks].filter((t) => t.probability < 0.6).sort((x, y) => y.minutes - x.minutes).slice(0, 6)) { const t = inp.tasks.find((x) => x.id === b.id); if (t) cands.push({ kind: "drop", t }); }
  const out: Change[] = [];
  const dayName = (d: string) => weekdayOf(d);
  const ref = simulate(inp, { draws, seed });
  for (const c of cands.slice(0, 24)) {
    const f = simulate(inp, { draws, seed, mods: { [c.kind]: c.t.id } as Mods });
    const delta = round2(f.score - ref.score);
    if (delta <= 0.005) continue;
    // The number that moved most, named so the line can say "X: 40% → 71%".
    let best = { label: "the week", before: ref.score, after: f.score, gain: delta };
    for (const p of f.projects) { const r = ref.projects.find((x) => x.key === p.key); if (r && p.probability - r.probability > best.gain) best = { label: `${p.name} ships`, before: r.probability, after: p.probability, gain: p.probability - r.probability }; }
    const short = (s: string) => (s.length > 36 ? `${s.slice(0, 35).trimEnd()}…` : s);
    for (const t of f.tasks) { const r = ref.tasks.find((x) => x.id === t.id); if (r && t.due && t.probability - r.probability > best.gain) best = { label: `“${short(t.title)}” by ${dayName(t.due)}`, before: r.probability, after: t.probability, gain: t.probability - r.probability }; }
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    const title = c.t.title.length > 48 ? `${c.t.title.slice(0, 47)}…` : c.t.title;
    const half = Math.max(15, Math.round((base.get(c.t.id)?.minutes ?? 60) / 2 / 5) * 5);
    const what = c.kind === "move" ? `Start “${title}” on ${dayName(first)} instead of waiting for ${dayName(c.t.due!)}`
      : c.kind === "drop" ? `Push “${title}” to next week` : `Time-box “${title}” to ${half} min`;
    const proposal = c.kind === "move" ? { taskId: `t${c.t.id}`, due: first, date: first } : c.kind === "drop" ? { taskId: `t${c.t.id}`, due: nextWeek, scheduled: null }
      : { taskId: `t${c.t.id}`, estimateMinutes: half };
    out.push({ kind: c.kind, taskId: c.t.id, title: c.t.title, area: c.t.area, delta, before: ref.score, after: f.score, metric: best.label,
      line: `${what}: ${best.label} ${pct(best.before)} → ${pct(best.after)}.`, proposal });
  }
  const seen = new Set<number>();
  return out.sort((x, y) => y.delta - x.delta).filter((c) => !seen.has(c.taskId) && seen.add(c.taskId)).slice(0, 3);
}

export function headline(inp: WeekInputs, f: Forecast): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const parts: string[] = [];
  const proj = [...f.projects].filter((p) => p.due && p.due <= inp.to).sort((a, b) => a.probability - b.probability)[0];
  const task = [...f.tasks].filter((t) => t.due && t.due <= inp.to).sort((a, b) => a.probability - b.probability)[0];
  if (proj) parts.push(`${proj.name} ships ${weekdayOf(proj.due!)}: ${pct(proj.probability)}.`);
  else if (task) parts.push(`“${task.title.length > 36 ? `${task.title.slice(0, 35).trimEnd()}…` : task.title}” by ${weekdayOf(task.due!)}: ${pct(task.probability)}.`);
  else parts.push("Nothing is due this week.");
  const worst = [...f.days].filter((d) => !d.past).sort((a, b) => b.load - a.load)[0];
  if (worst) parts.push(`${worst.weekday} is ${worst.load}% booked.`);
  const shaky = f.blocks.filter((b) => b.probability < 0.6);
  if (shaky.length) parts.push(`${shaky.length === 1 ? `${shaky[0].title} may not happen` : `${shaky.length} standing blocks may not happen`} (${pct(shaky[0].probability)}).`);
  return parts.join(" ");
}

// ── storage ─────────────────────────────────────────────────────────────────
export function latestRun(db: Database, week: string) {
  const run = db.query("SELECT * FROM weather_runs WHERE week = ? ORDER BY id DESC LIMIT 1").get(week) as any;
  if (!run) return null;
  const rows = db.query("SELECT kind, key, probability, detail FROM weather_forecasts WHERE run_id = ? ORDER BY id").all(run.id) as any[];
  const parse = (s: string) => { try { return JSON.parse(s); } catch { return {}; } };
  const by = (kind: string) => rows.filter((r) => r.kind === kind).map((r) => ({ key: r.key, probability: r.probability, ...parse(r.detail) }));
  return { id: run.id, week: run.week, created_at: run.created_at, inputs_hash: run.inputs_hash, summary: parse(run.summary),
    projects: by("project"), tasks: by("task"), days: by("day"), blocks: by("block") };
}
export function storeRun(db: Database, inp: WeekInputs, f: Forecast, changes: Change[], now: Date) {
  const summary = { week: inp.week, from: inp.from, to: inp.to, today: inp.today, draws: f.draws, score: f.score, headline: headline(inp, f), changes,
    basis: { doneWithTimes: inp.history.doneWithTimes, overrun: inp.history.overrun["*"], tasks: inp.tasks.length, projects: inp.projects.length, blocks: f.blocks.length },
    model: "code" };
  return db.transaction(() => {
    const run = db.query("INSERT INTO weather_runs (week, created_at, inputs_hash, summary) VALUES (?, ?, ?, ?) RETURNING id").get(inp.week, now.toISOString(), inp.hash, JSON.stringify(summary)) as any;
    const ins = db.prepare("INSERT INTO weather_forecasts (run_id, kind, key, probability, detail) VALUES (?, ?, ?, ?, ?)");
    for (const p of f.projects) ins.run(run.id, "project", p.key, p.probability, JSON.stringify(p));
    for (const t of f.tasks) ins.run(run.id, "task", `t${t.id}`, t.probability, JSON.stringify(t));
    for (const d of f.days) ins.run(run.id, "day", d.date, null, JSON.stringify(d));
    for (const b of f.blocks) ins.run(run.id, "block", b.key, b.probability, JSON.stringify(b));
    db.query("DELETE FROM weather_runs WHERE week = ? AND id NOT IN (SELECT id FROM weather_runs WHERE week = ? ORDER BY id DESC LIMIT 10)").run(inp.week, inp.week);
    return run.id as number;
  })();
}

export const weather: Module = {
  name: "weather",
  help: `agentos weather [--week this|next]   the week's forecast: finish odds per project and dated task, load per day, standing blocks
agentos weather run [--week next] [--draws 1000] [--if-changed]   simulate the week 1000 times from your own history (no LLM)
agentos weather inputs --json      what the simulation saw: free gaps, tasks, overruns, skipped blocks`,
  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS weather_runs (id INTEGER PRIMARY KEY, week TEXT NOT NULL, created_at TEXT NOT NULL, inputs_hash TEXT NOT NULL, summary TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS weather_forecasts (id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES weather_runs(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, key TEXT NOT NULL, probability REAL, detail TEXT NOT NULL DEFAULT '{}');
      CREATE INDEX IF NOT EXISTS weather_runs_week ON weather_runs(week, id);
      CREATE INDEX IF NOT EXISTS weather_forecasts_run ON weather_forecasts(run_id, kind);
    `);
  },
  run(db, a: Args, ctx) {
    const sub = a._[1];
    const now = ctx.now();
    let week: string;
    try { week = weekFrom(ctx.str(a, "week"), ctx.istDate(now)); } catch (e) { throw new ctx.UserError((e as Error).message); }
    if (sub === "inputs") {
      const inp = buildInputs(db, { week, now });
      if (ctx.jsonOut) return ctx.out(inp as any, ["agentos weather run --week " + (ctx.str(a, "week") ?? "this")]);
      return ctx.out({ week, from: inp.from, to: inp.to, tasks: inp.tasks.length, projects: inp.projects.map((p) => p.name).join(", "),
        days: inp.days.map((d) => ({ date: d.date, weekday: d.weekday, past: d.past, awake: `${hhmm(d.awake.s)}-${hhmm(d.awake.e)}`, free: d.free, booked: d.booked, blocks: d.events.length })),
        history: { doneWithTimes: inp.history.doneWithTimes, overrun: `x${Math.exp(inp.history.overrun["*"].mu).toFixed(2)} (n=${inp.history.overrun["*"].n})`,
          blocks: Object.values(inp.history.blocks).map((b) => `${b.title} ${Math.round(b.p * 100)}% (${b.basis})`).join("; ") } }, ["agentos weather inputs --json"]);
    }
    if (sub === "run") {
      const inp = buildInputs(db, { week, now });
      if (!inp.from) throw new ctx.UserError(`The week of ${week} is over. Try --week this or --week next.`);
      const prev = latestRun(db, week);
      if (a.flags["if-changed"] && prev && prev.inputs_hash === inp.hash) return ctx.out({ ok: true, skipped: true, reason: "inputs unchanged", run: prev.id, week, hash: inp.hash }, ["agentos weather"]);
      const draws = Number(ctx.str(a, "draws") ?? 1000), seed = Number(ctx.str(a, "seed") ?? 42);
      if (!(draws >= 50 && draws <= 5000)) throw new ctx.UserError("--draws is 50 to 5000.");
      const t0 = Date.now();
      const f = simulate(inp, { draws, seed });
      const changes = rankChanges(inp, f, { seed });
      const id = storeRun(db, inp, f, changes, now);
      const r = latestRun(db, week)!;
      return ctx.out({ ok: true, run: id, week, ms: Date.now() - t0, headline: r.summary.headline, score: f.score,
        changes: ctx.jsonOut ? changes : changes.map((c) => c.line), hash: inp.hash }, ["agentos weather", "agentos weather --json"]);
    }
    if (sub) throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos weather [run | inputs] [--week this|next]`);
    const r = latestRun(db, week);
    if (!r) return ctx.out({ week, run: null, note: "No forecast for this week yet." }, [`agentos weather run --week ${ctx.str(a, "week") ?? "this"}`]);
    if (ctx.jsonOut) return ctx.out(r as any, ["agentos weather run"]);
    const pct = (x: number | null) => (x == null ? "" : `${Math.round(x * 100)}%`);
    ctx.out({
      week: r.week, run: r.id, made: r.created_at, headline: r.summary.headline,
      projects: r.projects.map((p: any) => ({ project: p.name, due: p.due ?? "", tasks: p.tasks, ships: pct(p.probability) })),
      tasks: r.tasks.filter((t: any) => t.due).map((t: any) => ({ id: `t${t.id}`, title: t.title, due: t.due, minutes: t.minutes, by_due: pct(t.probability), this_week: pct(t.pWeek) })),
      days: r.days.map((d: any) => ({ day: d.weekday, date: d.date, load: `${d.load}%`, free: d.free, booked: d.booked })),
      blocks: r.blocks.map((b: any) => ({ block: b.title, days: b.days.join(" "), happens: pct(b.probability), basis: b.basis })),
      changes: (r.summary.changes ?? []).map((c: any) => c.line),
    }, ["agentos weather run", "agentos weather --week next"]);
  },
};

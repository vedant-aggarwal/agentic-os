// The Cabinet. Every area has an advocate; on Sunday evening they argue for next week over an evidence pack built
// in code (next week's calendar and free gaps, open tasks by area, last week's overruns, the life wheel's starved
// aspects, goals due). One Sonnet call per advocate (in parallel; Haiku when Sonnet is slow or refuses), then one
// referee call that turns the argument into blocks and the conflicts it could not settle. Code places every block
// in a real free gap and writes them as an ai_batches batch of kind "cabinet", so keep/remove and undo work like
// any other proposal. Conflicts wait in cabinet_outcomes until the user taps an answer; then only the referee
// re-runs with that choice fixed. Tables and the CLI read side live in agentos (src/modules/cabinet.ts).
//   POST /api/v1/mod/cabinet/run                      { week?: "next" }  → { session } (runs in the background; poll)
//   GET  /api/v1/mod/cabinet/sessions[?limit=]        list
//   GET  /api/v1/mod/cabinet/sessions/current?week=   the latest session for that week, with turns and outcomes
//   GET  /api/v1/mod/cabinet/sessions/:id
//   POST /api/v1/mod/cabinet/sessions/:id/conflicts/:n   { choice: <option index or label> }
//   POST /api/v1/mod/cabinet/sessions/:id/decide      { kept: [pid], removed: [pid] }
//   POST /api/v1/mod/cabinet/sessions/:id/undo        { applied }
//   GET  /api/v1/mod/cabinet/advocates · PUT { area, brief?, kpis?, active? }
//   job cabinet-sunday 20:00 Sundays → runs next week and pushes "Your cabinet settled next week: N blocks, M conflicts".
import { Database } from "bun:sqlite";
import { ApiError, istDate } from "../store";
import type { JobCtx, Module } from "./types";
import { atIso, bad, batchRows, clip, decideAndApply, hhmm, iso, minOf, plusDays, reopenProposals, saveBatch, undoApplied, weekFrom, weekdayOf } from "./planning-common";

const MAX_ADVOCATES = 7;
const WDN: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const up15 = (m: number) => Math.ceil(m / 15) * 15;
const dur = (m: number) => { const h = Math.floor(m / 60), r = Math.round(m % 60); return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
type Ctx = Pick<JobCtx, "store" | "dbPath" | "ai" | "agentos" | "push" | "log" | "user">;

// ── evidence pack (code only) ───────────────────────────────────────────────
async function evidence(ctx: Ctx, week: string) {
  const inputs = await ctx.agentos(["weather", "inputs", "--week", week]);
  if (!inputs?.days) throw new ApiError(502, "agentos weather inputs gave nothing.");
  const b = ctx.store.bootstrap();
  const advocates: any[] = (await ctx.agentos(["cabinet", "advocates"]))?.advocates ?? [];
  const areas: any[] = inputs.areas ?? b.areas;
  const days = (inputs.days as any[]).filter((d) => !d.past);
  const baseTitle = (t: string) => String(t).replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  const blocksByArea: Record<string, Map<string, { title: string; days: string[]; minutes: number; p: number | null }>> = {};
  for (const d of days) for (const e of d.events as any[]) {
    const m = (blocksByArea[e.area ?? "none"] ??= new Map());
    const k = baseTitle(e.title).toLowerCase();
    const cur = m.get(k) ?? { title: baseTitle(e.title), days: [], minutes: 0, p: inputs.history?.blocks?.[k]?.p ?? null };
    cur.days.push(d.weekday); cur.minutes += e.e - e.s; m.set(k, cur);
  }
  const tasks: any[] = (inputs.tasks as any[]).map((t) => ({ id: `t${t.id}`, title: t.title, area: t.area, due: t.due, minutes: t.minutes ?? inputs.history?.median?.[t.area] ?? inputs.history?.globalMedian ?? 30,
    late: !!(t.due && t.due < (inputs.from ?? week)), priority: t.priority, scheduled: t.scheduled ? `${t.scheduled.date} ${hhmm(t.scheduled.s)}` : null }));
  const goals: any[] = (b.goals.goals as any[]).filter((g) => g.status === "active" && (!g.end || g.end <= plusDays(week, 70)) && ["week", "month", "quarter"].includes(g.horizon))
    .map((g) => ({ id: g.id, title: clip(g.title, 90), area: g.area, horizon: g.horizon, progress: g.progress, end: g.end, aspects: g.aspects }));
  const latest = (b.life.snapshots as any[]).at(-1) ?? null;
  const fed = new Set<string>();
  for (const t of b.today.tasks as any[]) if (["todo", "doing"].includes(t.status)) for (const a of b.life.areaAspects[t.area] ?? []) fed.add(a);
  const aspects: any[] = b.life.aspects;
  const starved = latest ? aspects.filter((a) => (latest.scores[a.key] ?? 10) <= 3).map((a) => a.key) : [];
  const unfed = aspects.map((a) => a.key).filter((k) => !fed.has(k));
  const overrun = inputs.history?.overrun ?? {};
  const ovText = (area: string | null) => { const o = overrun[area ?? "none"] ?? overrun["*"]; return o ? `x${Math.exp(o.mu).toFixed(2)} of the estimate (${o.n} timed tasks)` : "no timings yet"; };
  const skipped = Object.values(inputs.history?.blocks ?? {}).filter((x: any) => x.misses > 0).map((x: any) => ({ block: x.title, misses: x.misses, occurrences: x.occurrences }));
  const areaInfo = areas.map((a) => {
    const open = tasks.filter((t) => t.area === a.slug);
    const blocks = [...(blocksByArea[a.slug]?.values() ?? [])];
    const aAspects: string[] = b.life.areaAspects[a.slug] ?? [];
    return { slug: a.slug, name: a.name, color: a.color, open, blocks, goals: goals.filter((g) => g.area === a.slug), aspects: aAspects,
      starved: aAspects.filter((k) => starved.includes(k) || unfed.includes(k)) };
  });
  const sitting = areaInfo.filter((a) => {
    const adv = advocates.find((x) => x.area === a.slug);
    return (adv?.active ?? true) && (a.open.length || a.blocks.length || a.goals.length || a.starved.length);
  }).slice(0, MAX_ADVOCATES);
  const calendar = days.map((d: any) => ({ day: `${WDN[weekdayOf(d.date)]} ${d.date}`, free: dur(d.free), awake: `${hhmm(d.awake.s)}–${hhmm(d.awake.e)}`,
    blocks: (d.events as any[]).map((e) => `${hhmm(e.s)}–${hhmm(e.e)} ${baseTitle(e.title)}${e.area ? ` (${e.area})` : ""}`) }));
  return { inputs, b, advocates, areas, days, tasks, goals, latest, starved, unfed, ovText, skipped, areaInfo, sitting, calendar, week, from: inputs.from ?? week, to: inputs.to };
}

// ── the two prompts ─────────────────────────────────────────────────────────
const ADVOCATE_SYSTEM = `You are the advocate for one area of a person's life in their weekly planning cabinet. You speak only for your area, from the evidence pack, in plain English.
Say what your area needs next week: specific hours for specific open tasks (use their ids) or standing blocks, with the day you prefer (mon..sun or any) and why, citing evidence (a due date, a goal behind pace, a starved life-wheel aspect, last week's overruns, a block that keeps getting skipped).
Concede where your area is already well served or where another area's deadline is harder. Never invent tasks, numbers or facts; quote the data. No hype, no exclamation marks.
statement: under 110 words. asks: up to 4, minutes between 15 and 240, why under 80 characters. concedes: up to 3 lines. evidence: up to 4 short lines quoting the data.`;
const ADVOCATE_SCHEMA = {
  type: "object",
  properties: {
    statement: { type: "string" },
    asks: { type: "array", maxItems: 4, items: { type: "object", properties: { taskId: { type: "string" }, title: { type: "string" }, minutes: { type: "integer" }, day: { type: "string" }, why: { type: "string" } }, required: ["title", "minutes", "why"] } },
    concedes: { type: "array", items: { type: "string" } },
    evidence: { type: "array", items: { type: "string" } },
  },
  required: ["statement", "asks", "concedes", "evidence"],
};
const REFEREE_SYSTEM = `You are the referee of a weekly planning cabinet. Each advocate has argued for its area. Turn the argument into next week's pencilled blocks.
Place each granted ask on a day in one of that day's free gaps listed in the pack (a block may also go inside a container block that takes its area, or any area when it says "any").
Start and end are HH:MM on 15-minute marks inside the gap; blocks never overlap each other or a listed block; sleep is fixed. One block per granted ask, 15 to 240 minutes; at most 12 blocks.
Grant deadlines first, then goals behind pace, then asks that feed a starved life-wheel aspect, then the rest; a standing block that already exists in the calendar needs no new block.
A task id from the pack goes in taskId; a new block (a shoot, a gym session the calendar lacks) has no taskId and a short title. why is under 70 characters, from the evidence.
Where two advocates want the same hours or the same day and neither case is clearly stronger, do not decide: raise a conflict with a short question, 2 or 3 options, each option's consequence in one line, and the advocates involved. At most 3 conflicts. Already decided conflicts are rules: obey them and never ask them again.
transcriptSummary: three plain sentences on what was agreed and why, naming the areas. No hype.`;
const REFEREE_SCHEMA = {
  type: "object",
  properties: {
    blocks: { type: "array", maxItems: 12, items: { type: "object", properties: { taskId: { type: "string" }, title: { type: "string" }, area: { type: "string" }, date: { type: "string" }, start: { type: "string" }, end: { type: "string" }, why: { type: "string" } }, required: ["title", "area", "date", "start", "end", "why"] } },
    conflicts: { type: "array", maxItems: 3, items: { type: "object", properties: { question: { type: "string" }, options: { type: "array", minItems: 2, maxItems: 3, items: { type: "object", properties: { label: { type: "string" }, consequence: { type: "string" } }, required: ["label", "consequence"] } }, advocates: { type: "array", items: { type: "string" } } }, required: ["question", "options", "advocates"] } },
    transcriptSummary: { type: "string" },
  },
  required: ["blocks", "conflicts", "transcriptSummary"],
};
/** Sonnet first; if it is slow or breaks the schema, Haiku with the same pack, and the turn says so. */
async function call(ctx: Ctx, system: string, schema: object, prompt: string, timeout: number) {
  try {
    const r = await ctx.ai.claude({ model: "sonnet", system, schema, prompt, timeout });
    return { out: r.out, model: "Sonnet", ms: r.ms, fallback: false };
  } catch (e) {
    ctx.log(`sonnet failed (${e instanceof Error ? e.message : e}); trying haiku`);
    const r = await ctx.ai.claude({ model: "haiku", system, schema, prompt, timeout: Math.min(timeout, 60_000) });
    return { out: r.out, model: "Haiku", ms: r.ms, fallback: true };
  }
}

// ── placing the referee's blocks in real free time ──────────────────────────
type Gap = { s: number; e: number; area: string | null; general: boolean; where: string | null };
function placeBlocks(ev: Awaited<ReturnType<typeof evidence>>, raw: any[]) {
  const slug = new Set(ev.areas.map((a: any) => a.slug));
  const taskById = new Map(ev.tasks.map((t) => [t.id, t]));
  const free = new Map<string, Gap[]>();
  for (const d of ev.days) {
    const g: Gap[] = (d.gaps as any[]).map((x) => ({ s: x.s, e: x.e, area: null, general: true, where: null }));
    for (const c of d.containers as any[]) if (c.minutes >= 15) g.push({ s: c.s, e: c.e, area: c.general ? null : c.area, general: c.general || !c.area, where: c.title });
    free.set(d.date, g.sort((x, y) => x.s - y.s));
  }
  const placed: { taskId: string | null; title: string; area: string; date: string; start: string; end: string; why: string; where: string | null; minutes: number }[] = [];
  const dropped: string[] = [];
  const seenTask = new Set<string>();
  for (const x of Array.isArray(raw) ? raw : []) {
    const taskId = typeof x?.taskId === "string" && taskById.has(x.taskId) ? x.taskId : null;
    // A block for an existing task is that task: keep its real title and area, whatever the referee shortened it to.
    const title = clip(String((taskId && taskById.get(taskId)?.title) || x?.title || "").trim(), 120);
    const area = (taskId && taskById.get(taskId)?.area) || (typeof x?.area === "string" && slug.has(x.area) ? x.area : null);
    const gaps = free.get(String(x?.date ?? ""));
    if (!title || !area || !gaps || (taskId && seenTask.has(taskId))) { if (title) dropped.push(`${title}: ${!gaps ? "no such day" : !area ? "no area" : "placed twice"}`); continue; }
    const s0 = /^([01]\d|2[0-3]):[0-5]\d$/.test(x.start) ? minOf(x.start) : NaN, e0 = /^([01]\d|2[0-3]):[0-5]\d$/.test(x.end) ? minOf(x.end) : NaN;
    const d = Math.max(15, Math.min(240, Number.isFinite(s0) && Number.isFinite(e0) && e0 > s0 ? Math.round((e0 - s0) / 15) * 15 : (taskById.get(taskId ?? "")?.minutes ?? 60)));
    const fits = (g: Gap) => g.e - g.s >= d && (g.general || g.area === area);
    // The slot the referee asked for when it is really free; otherwise the first gap that day that fits.
    let g = Number.isFinite(s0) ? gaps.find((gap) => fits(gap) && up15(Math.max(gap.s, s0)) + d <= gap.e && s0 >= gap.s - 1) : undefined;
    let s = g ? up15(Math.max(g.s, s0)) : NaN;
    if (!g) { g = gaps.find(fits); s = g ? up15(g.s) : NaN; }
    if (!g || !Number.isFinite(s) || s + d > g.e) { dropped.push(`${title}: no free ${dur(d)} on ${WDN[weekdayOf(String(x.date))] ?? x.date}`); continue; }
    const i = gaps.indexOf(g);
    gaps.splice(i, 1, ...[{ ...g, e: s }, { ...g, s: s + d }].filter((p) => p.e - p.s >= 15));
    gaps.sort((p, q) => p.s - q.s);
    if (taskId) seenTask.add(taskId);
    placed.push({ taskId, title, area, date: String(x.date), start: hhmm(s), end: hhmm(s + d), why: clip(String(x.why ?? "").trim() || "Agreed by the cabinet", 90), where: g.where, minutes: d });
  }
  placed.sort((p, q) => (p.date === q.date ? minOf(p.start) - minOf(q.start) : p.date < q.date ? -1 : 1));
  return { placed, dropped };
}
function shapeConflicts(ev: Awaited<ReturnType<typeof evidence>>, raw: any[]) {
  const slug = new Set(ev.sitting.map((a) => a.slug));
  return (Array.isArray(raw) ? raw : []).slice(0, 3).map((c) => ({
    question: clip(String(c?.question ?? "").trim(), 200),
    options: (Array.isArray(c?.options) ? c.options : []).slice(0, 3).map((o: any) => ({ label: clip(String(o?.label ?? "").trim(), 60), consequence: clip(String(o?.consequence ?? "").trim(), 140) })).filter((o: any) => o.label),
    advocates: (Array.isArray(c?.advocates) ? c.advocates : []).filter((a: any) => slug.has(a)),
  })).filter((c) => c.question && c.options.length >= 2);
}

// ── the session ─────────────────────────────────────────────────────────────
/** A handle of our own: the request's ctx.db() closes when the request ends, and a sitting outlives it. */
function withDb<T>(path: string, fn: (db: Database) => T): T {
  const db = new Database(path);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  try { return fn(db); } finally { db.close(); }
}
async function withDbAsync<T>(path: string, fn: (db: Database) => Promise<T>): Promise<T> {
  const db = new Database(path);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  try { return await fn(db); } finally { db.close(); }
}
const parse = (s: any, d: any) => { try { return JSON.parse(s); } catch { return d; } };
function sessionRow(db: Database, id: number) {
  return db.query("SELECT * FROM cabinet_sessions WHERE id = ?").get(id) as any;
}
function decidedConflicts(db: Database, sessionId: number) {
  return (db.query("SELECT payload, reason FROM cabinet_outcomes WHERE session_id = ? AND kind = 'conflict' AND status = 'kept' ORDER BY id").all(sessionId) as any[])
    .map((o) => { const p = parse(o.payload, {}); return { question: p.question, choice: p.choice?.label ?? o.reason, consequence: p.choice?.consequence ?? "" }; });
}

async function advocateRound(ctx: Ctx, db: Database, sessionId: number, ev: Awaited<ReturnType<typeof evidence>>) {
  const others = (me: string) => ev.areaInfo.filter((a) => a.slug !== me).map((a) => ({ area: a.slug, name: a.name, openTasks: a.open.length,
    dueThisWeek: a.open.filter((t) => t.due && t.due <= ev.to).length, blockHours: Math.round(a.blocks.reduce((n, x) => n + x.minutes, 0) / 60 * 10) / 10 }));
  const turns = await Promise.all(ev.sitting.map(async (a) => {
    const adv = ev.advocates.find((x: any) => x.area === a.slug);
    const pack = {
      you: { area: a.slug, name: a.name, brief: adv?.brief, kpis: adv?.kpis ?? [] },
      week: { from: ev.from, to: ev.to },
      calendar: ev.calendar,
      yourTasks: a.open.map(({ id, title, due, minutes, late, priority, scheduled }) => ({ id, title: clip(title, 100), due, minutes, late, priority, scheduled })),
      yourStandingBlocks: a.blocks.map((x) => `${x.title}: ${x.days.join(", ")}${x.p != null ? ` (kept ${Math.round(x.p * 100)}% of the time)` : ""}`),
      yourGoals: a.goals,
      wheel: ev.latest ? { scoredOn: ev.latest.date, yourAspects: Object.fromEntries(a.aspects.map((k) => [k, ev.latest.scores[k] ?? null])), starved: ev.starved, noTaskFeeds: ev.unfed } : null,
      history: { overrun: ev.ovText(a.slug), skippedBlocks: ev.skipped },
      otherAreas: others(a.slug),
    };
    const t0 = Date.now();
    try {
      const r = await call(ctx, ADVOCATE_SYSTEM, ADVOCATE_SCHEMA, JSON.stringify(pack), 80_000);
      const asks = (Array.isArray(r.out?.asks) ? r.out.asks : []).slice(0, 4).map((x: any) => ({
        taskId: typeof x?.taskId === "string" && a.open.some((t) => t.id === x.taskId) ? x.taskId : null, title: clip(String(x?.title ?? "").trim(), 100),
        minutes: Math.max(15, Math.min(240, Number.isInteger(x?.minutes) ? x.minutes : 60)), day: String(x?.day ?? "any").toLowerCase().slice(0, 3), why: clip(String(x?.why ?? "").trim(), 90) })).filter((x: any) => x.title);
      const turn = { advocate: a.slug, name: a.name, statement: clip(String(r.out?.statement ?? "").trim(), 1200), asks,
        concedes: (Array.isArray(r.out?.concedes) ? r.out.concedes : []).slice(0, 3).map((s: any) => clip(String(s), 160)),
        evidence: (Array.isArray(r.out?.evidence) ? r.out.evidence : []).slice(0, 4).map((s: any) => clip(String(s), 160)), model: r.model, ms: r.ms };
      db.query("INSERT INTO cabinet_turns (session_id, round, advocate, text, asks, model, ms, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?)")
        .run(sessionId, a.slug, turn.statement, JSON.stringify({ asks, concedes: turn.concedes, evidence: turn.evidence }), r.model, r.ms, iso());
      return turn;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      db.query("INSERT INTO cabinet_turns (session_id, round, advocate, text, asks, model, ms, created_at) VALUES (?, 1, ?, ?, '[]', 'none', ?, ?)")
        .run(sessionId, a.slug, `${a.name}'s advocate could not speak: ${msg}`, Date.now() - t0, iso());
      return { advocate: a.slug, name: a.name, statement: `(no statement: ${msg})`, asks: [], concedes: [], evidence: [], model: "none", ms: Date.now() - t0 };
    }
  }));
  return turns;
}

async function refereeRound(ctx: Ctx, db: Database, sessionId: number, ev: Awaited<ReturnType<typeof evidence>>, turns: any[], round: number) {
  const decided = decidedConflicts(db, sessionId);
  const pack = {
    week: { from: ev.from, to: ev.to },
    days: ev.days.map((d: any) => ({ day: `${WDN[weekdayOf(d.date)]} ${d.date}`, date: d.date, free: (d.gaps as any[]).map((g) => `${hhmm(g.s)}–${hhmm(g.e)}`),
      containers: (d.containers as any[]).filter((c) => c.minutes >= 15).map((c) => ({ block: c.title, from: hhmm(c.s), to: hhmm(c.e), takes: c.general || !c.area ? "any" : c.area })),
      busy: (d.events as any[]).filter((e) => !e.container).map((e) => `${hhmm(e.s)}–${hhmm(e.e)} ${e.title}`) })),
    advocates: turns.map((t) => ({ area: t.advocate, name: t.name, statement: t.statement, asks: t.asks, concedes: t.concedes, evidence: t.evidence })),
    tasks: ev.tasks.filter((t) => !t.scheduled).map(({ id, title, area, due, minutes, late }) => ({ id, title: clip(title, 100), area, due, minutes, late })),
    goals: ev.goals, starvedAspects: ev.starved, decidedConflicts: decided,
  };
  const r = await call(ctx, REFEREE_SYSTEM, REFEREE_SCHEMA, JSON.stringify(pack), 100_000);
  const { placed, dropped } = placeBlocks(ev, r.out?.blocks);
  const conflicts = shapeConflicts(ev, r.out?.conflicts).filter((c) => !decided.some((d) => d.question.toLowerCase() === c.question.toLowerCase()));
  const summary = clip(String(r.out?.transcriptSummary ?? "").trim(), 1000);
  const saved = saveBatch(db, { kind: "cabinet", date: ev.week, summary: clip(summary, 200), model: r.model, ms: r.ms, replace: true },
    placed.map((p) => ({ kind: p.taskId ? "move" : "add", taskId: p.taskId, payload: { date: p.date, start: p.start, end: p.end, title: p.title, area: p.area, where: p.where }, reason: p.why })));
  db.transaction(() => {
    db.query("INSERT INTO cabinet_turns (session_id, round, advocate, text, asks, model, ms, created_at) VALUES (?, ?, 'referee', ?, ?, ?, ?, ?)")
      .run(sessionId, round, summary, JSON.stringify({ blocks: placed.length, conflicts: conflicts.length, dropped }), r.model, r.ms, iso());
    db.query("DELETE FROM cabinet_outcomes WHERE session_id = ? AND status = 'open'").run(sessionId);
    const ins = db.prepare("INSERT INTO cabinet_outcomes (session_id, kind, payload, status, created_at) VALUES (?, ?, ?, 'open', ?)");
    placed.forEach((p, i) => ins.run(sessionId, "block", JSON.stringify({ ...p, pid: saved.pids[i], batchId: saved.batchId }), iso()));
    for (const c of conflicts) ins.run(sessionId, "conflict", JSON.stringify(c), iso());
    const prev = sessionRow(db, sessionId);
    const model = prev?.model && prev.model !== r.model ? `${prev.model}+${r.model}`.replace(/(\w+)\+\1/, "$1") : r.model;
    db.query("UPDATE cabinet_sessions SET status = 'settled', settled_at = ?, summary = ?, batch_id = ?, model = ?, ms = coalesce(ms, 0) + ?, error = NULL WHERE id = ?")
      .run(iso(), summary, Number(saved.batchId.slice(1)), model, r.ms, sessionId);
  })();
  return { blocks: placed.length, conflicts: conflicts.length, dropped, model: r.model, fallback: r.fallback };
}

const running = new Set<number>();
async function negotiate(ctx: Ctx, sessionId: number, week: string, opts: { refereeOnly?: boolean } = {}) {
  if (running.has(sessionId)) return null;
  running.add(sessionId);
  const t0 = Date.now();
  try {
    return await withDbAsync(ctx.dbPath, async (db) => {
      try {
        const ev = await evidence(ctx, week);
        if (!ev.days.length) throw bad("That week is over.");
        let turns: any[];
        let round = 2;
        if (opts.refereeOnly) {
          turns = (db.query("SELECT * FROM cabinet_turns WHERE session_id = ? AND round = 1 ORDER BY id").all(sessionId) as any[]).map((t) => {
            const x = parse(t.asks, {});
            return { advocate: t.advocate, name: ev.areas.find((a: any) => a.slug === t.advocate)?.name ?? t.advocate, statement: t.text, asks: x.asks ?? [], concedes: x.concedes ?? [], evidence: x.evidence ?? [] };
          });
          round = ((db.query("SELECT max(round) r FROM cabinet_turns WHERE session_id = ?").get(sessionId) as any)?.r ?? 1) + 1;
        } else {
          if (!ev.sitting.length) throw bad("No advocate has anything to argue: no open tasks, blocks or goals next week.");
          db.query("UPDATE cabinet_sessions SET model = NULL, ms = 0 WHERE id = ?").run(sessionId);
          turns = await advocateRound(ctx, db, sessionId, ev);
          if (!turns.some((t) => t.asks.length)) ctx.log("no advocate made an ask; the referee still sits");
          const models = [...new Set(turns.map((t) => t.model).filter((m) => m !== "none"))];
          db.query("UPDATE cabinet_sessions SET model = ?, ms = ? WHERE id = ?").run(models.join("+") || null, turns.reduce((n, t) => n + (t.ms ?? 0), 0), sessionId);
        }
        const r = await refereeRound(ctx, db, sessionId, ev, turns, round);
        ctx.log(`session c${sessionId} settled: ${r.blocks} blocks, ${r.conflicts} conflicts, ${r.dropped.length} dropped, ${Date.now() - t0}ms${r.fallback ? " (referee on Haiku)" : ""}`);
        return r;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        db.query("UPDATE cabinet_sessions SET status = 'failed', error = ?, settled_at = ? WHERE id = ?").run(clip(msg, 300), iso(), sessionId);
        ctx.log(`session c${sessionId} failed: ${msg}`);
        return null;
      }
    });
  } finally { running.delete(sessionId); }
}

function detail(db: Database, id: number) {
  const s = sessionRow(db, id);
  if (!s) return null;
  const turns = (db.query("SELECT * FROM cabinet_turns WHERE session_id = ? ORDER BY round, id").all(id) as any[]).map((t) => ({ id: t.id, round: t.round, advocate: t.advocate, text: t.text, ...parse(t.asks, {}), model: t.model, ms: t.ms, created_at: t.created_at }));
  const batch = s.batch_id ? batchRows(db, s.batch_id) : null;
  const status = new Map((batch?.rows ?? []).map((r) => [r.pid, r.status]));
  const outcomes = (db.query("SELECT * FROM cabinet_outcomes WHERE session_id = ? ORDER BY id").all(id) as any[]).map((o) => {
    const p = parse(o.payload, {});
    return { id: o.id, kind: o.kind, status: o.kind === "block" && status.get(p.pid) && status.get(p.pid) !== "open" ? status.get(p.pid) : o.status, reason: o.reason, ...p, created_at: o.created_at, decided_at: o.decided_at };
  });
  const blocks = outcomes.filter((o) => o.kind === "block"), conflicts = outcomes.filter((o) => o.kind === "conflict");
  return { session: { id: `c${s.id}`, week: s.week, from: s.week, to: plusDays(s.week, 6), status: s.status, running: running.has(s.id), started_at: s.started_at, settled_at: s.settled_at, summary: s.summary ?? "",
    batch: s.batch_id ? `b${s.batch_id}` : null, model: s.model, ms: s.ms, error: s.error, blocks: blocks.length, kept: blocks.filter((b) => b.status === "kept").length,
    conflicts: conflicts.length, open_conflicts: conflicts.filter((c) => c.status === "open").length }, turns, blocks, conflicts, batch };
}
function latestFor(db: Database, week: string) {
  const s = db.query("SELECT id FROM cabinet_sessions WHERE week = ? ORDER BY id DESC LIMIT 1").get(week) as any;
  return s ? detail(db, s.id) : null;
}
async function start(ctx: Ctx, week: string) {
  const sid = withDb(ctx.dbPath, (db) => {
    const open = db.query("SELECT id, started_at FROM cabinet_sessions WHERE week = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(week) as any;
    if (open && running.has(open.id)) return { id: open.id, reused: true };
    if (open) db.query("UPDATE cabinet_sessions SET status = 'failed', error = 'The server restarted while the cabinet sat.' WHERE id = ?").run(open.id);
    const r = db.query("INSERT INTO cabinet_sessions (week, status, started_at) VALUES (?, 'open', ?) RETURNING id").get(week, iso()) as any;
    return { id: r.id as number, reused: false };
  });
  if (!sid.reused) void negotiate(ctx, sid.id, week);
  return sid;
}

export const cabinet: Module = {
  name: "cabinet",
  async handle(ctx) {
    const today = istDate();
    let m: RegExpMatchArray | null;
    if (ctx.path === "/run" && ctx.method === "POST") {
      if (!ctx.owner) return ctx.fail(403, "Only the owner convenes the cabinet.");
      const b = await ctx.body().catch(() => ({}));
      const week = weekFrom(b?.week ?? "next", today);
      if (plusDays(week, 6) < today) throw bad("That week is over.");
      const s = await start(ctx, week);
      return ctx.json({ ok: true, session: `c${s.id}`, week, running: true, reused: s.reused }, s.reused ? 200 : 202);
    }
    if (ctx.path === "/sessions" && ctx.method === "GET") {
      const r = await ctx.agentos(["cabinet", "--limit", String(Math.max(1, Math.min(50, Number(ctx.url.searchParams.get("limit") ?? 20))))]);
      return ctx.json({ sessions: (r?.sessions ?? []).map((s: any) => ({ ...s, running: running.has(Number(String(s.id).slice(1))) })) });
    }
    if (ctx.path === "/sessions/current" && ctx.method === "GET") {
      const week = weekFrom(ctx.url.searchParams.get("week") ?? "next", today);
      const d = withDb(ctx.dbPath, (db) => latestFor(db, week));
      return ctx.json({ week, from: week, to: plusDays(week, 6), today, weekday: weekdayOf(today), ...(d ?? { session: null, turns: [], blocks: [], conflicts: [], batch: null }) });
    }
    if ((m = ctx.path.match(/^\/sessions\/c?(\d+)$/)) && ctx.method === "GET") {
      const d = withDb(ctx.dbPath, (db) => detail(db, Number(m![1])));
      return d ? ctx.json(d) : ctx.fail(404, "No such session.");
    }
    if ((m = ctx.path.match(/^\/sessions\/c?(\d+)\/conflicts\/(\d+)$/)) && ctx.method === "POST") {
      if (!ctx.owner) return ctx.fail(403, "Only the owner answers the cabinet.");
      const sid = Number(m[1]), oid = Number(m[2]);
      const b = await ctx.body();
      const week = withDb(ctx.dbPath, (db) => {
        const s = sessionRow(db, sid);
        if (!s) throw new ApiError(404, "No such session.");
        const o = db.query("SELECT * FROM cabinet_outcomes WHERE id = ? AND session_id = ? AND kind = 'conflict'").get(oid, sid) as any;
        if (!o) throw new ApiError(404, "No such conflict.");
        const p = parse(o.payload, {});
        const options: any[] = p.options ?? [];
        const choice = typeof b?.choice === "number" ? options[b.choice] : options.find((x) => x.label === String(b?.choice ?? ""));
        if (!choice) throw bad("choice is the option's index or label.");
        db.query("UPDATE cabinet_outcomes SET status = 'kept', reason = ?, payload = ?, decided_at = ? WHERE id = ?").run(choice.label, JSON.stringify({ ...p, choice }), iso(), oid);
        db.query("UPDATE cabinet_sessions SET status = 'open' WHERE id = ?").run(sid);
        return s.week as string;
      });
      void negotiate(ctx, sid, week, { refereeOnly: true });
      return ctx.json({ ok: true, session: `c${sid}`, running: true }, 202);
    }
    if ((m = ctx.path.match(/^\/sessions\/c?(\d+)\/decide$/)) && ctx.method === "POST") {
      if (!ctx.owner) return ctx.fail(403, "Only the owner keeps blocks.");
      const sid = Number(m[1]);
      const b = await ctx.body();
      const s = withDb(ctx.dbPath, (db) => sessionRow(db, sid));
      if (!s?.batch_id) return ctx.fail(404, "That session has no blocks yet.");
      const r = decideAndApply(ctx, `b${s.batch_id}`, b);
      withDb(ctx.dbPath, (db) => db.transaction(() => {
        const rows = db.query("SELECT id, payload FROM cabinet_outcomes WHERE session_id = ? AND kind = 'block' AND status = 'open'").all(sid) as any[];
        const kept = new Set(r.applied.map((a) => a.pid)), removed = new Set((Array.isArray(b?.removed) ? b.removed : []).map(String));
        for (const o of rows) {
          const pid = parse(o.payload, {}).pid;
          if (kept.has(pid)) db.query("UPDATE cabinet_outcomes SET status = 'kept', reason = 'kept', decided_at = ? WHERE id = ?").run(iso(), o.id);
          else if (removed.has(pid)) db.query("UPDATE cabinet_outcomes SET status = 'removed', reason = 'removed', decided_at = ? WHERE id = ?").run(iso(), o.id);
        }
        const left = (db.query("SELECT count(*) n FROM cabinet_outcomes WHERE session_id = ? AND status = 'open'").get(sid) as any).n;
        if (!left) db.query("UPDATE cabinet_sessions SET status = 'applied' WHERE id = ? AND status = 'settled'").run(sid);
      })());
      return ctx.json({ ...r, detail: withDb(ctx.dbPath, (db) => detail(db, sid)) });
    }
    if ((m = ctx.path.match(/^\/sessions\/c?(\d+)\/undo$/)) && ctx.method === "POST") {
      if (!ctx.owner) return ctx.fail(403, "Only the owner undoes.");
      const sid = Number(m[1]);
      const b = await ctx.body();
      const undone = undoApplied(ctx.store, Array.isArray(b?.applied) ? b.applied : []);
      withDb(ctx.dbPath, (db) => db.transaction(() => {
        reopenProposals(db, undone);
        for (const o of db.query("SELECT id, payload FROM cabinet_outcomes WHERE session_id = ? AND kind = 'block' AND status = 'kept'").all(sid) as any[])
          if (undone.includes(parse(o.payload, {}).pid)) db.query("UPDATE cabinet_outcomes SET status = 'open', reason = NULL, decided_at = NULL WHERE id = ?").run(o.id);
        db.query("UPDATE cabinet_sessions SET status = 'settled' WHERE id = ? AND status = 'applied'").run(sid);
      })());
      return ctx.json({ ok: true, undone, detail: withDb(ctx.dbPath, (db) => detail(db, sid)) });
    }
    if (ctx.path === "/advocates" && ctx.method === "GET") return ctx.json(await ctx.agentos(["cabinet", "advocates"]));
    if (ctx.path === "/advocates" && ctx.method === "PUT") {
      if (!ctx.owner) return ctx.fail(403, "Only the owner briefs the cabinet.");
      const b = await ctx.body();
      if (!b?.area) throw bad("area is required.");
      const args = ["cabinet", "advocate", String(b.area)];
      if (typeof b.brief === "string") args.push("--brief", clip(b.brief.trim(), 1000));
      if (Array.isArray(b.kpis)) args.push("--kpis", b.kpis.map(String).join(", "));
      if (typeof b.active === "boolean") args.push(b.active ? "--on" : "--off");
      if (args.length === 3) throw bad("Nothing to change.");
      await ctx.agentos(args);
      return ctx.json(await ctx.agentos(["cabinet", "advocates"]));
    }
    return null;
  },
  jobs: [{
    id: "cabinet-sunday", at: "20:00", days: ["sun"],
    async run(ctx) {
      const week = weekFrom("next", istDate());
      const s = await start(ctx, week);
      // The job holds its own db handle; wait for the sitting so the push carries the result.
      while (running.has(s.id)) await new Promise((r) => setTimeout(r, 2000));
      const d = withDb(ctx.dbPath, (db) => detail(db, s.id));
      if (!d || d.session.status !== "settled") { ctx.log(`sunday sitting did not settle: ${d?.session.error ?? "unknown"}`); return; }
      await ctx.push("The Cabinet", `Your cabinet settled next week: ${d.session.blocks} blocks, ${d.session.conflicts} conflicts`, { mod: "cabinet", session: d.session.id });
      ctx.log(`pushed: ${d.session.blocks} blocks, ${d.session.conflicts} conflicts`);
    },
  }],
};

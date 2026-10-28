// Mission (v2): purpose, milestones, check-ins, horizon notes, lifetime directions and the mission graph. Goals
// themselves stay core (/api/v1/goals, svc/sync on the phone). The tables belong to agentos's mission module
// (cli/src/modules/mission.ts), which this file imports for the graph, the history and the doc helpers.
//   GET/PUT/POST/DELETE /api/v1/mod/mission/{purpose,milestones,checkins,notes,life}[/<id>]   the store contract
//   GET  /api/v1/mod/mission/graph     set vs done by week, weeks/months/quarters closed, streak, closed goals, history
//   POST /api/v1/mod/mission/draft     { kind: "goal", text, horizon?, aspects?, parent? } → a concrete goal (Claude, subscription)
//                                      { kind: "purpose" } → a purpose line drafted from his goals
// Jobs: the daily history row (23:50) and the Sunday check-in nudge (19:00). Tools: see `tools` below.
import type { Database } from "bun:sqlite";
import { mountCollection } from "./_collection";
import type { AgentTool, JobCtx, Module } from "./types";
import {
  MISSION_COLLECTIONS, migrateMission, graph, snapshot, putDoc, listDocs, getDoc, milestoneProgress, goalKey, progressOf, currentPurpose,
} from "../../cli/src/modules/mission.ts";
import { HORIZONS, periodOf, periodLabel, type Horizon } from "../../cli/src/goals.ts";

const ASPECTS = ["body", "mind", "soul", "mission", "money", "growth", "family", "romance", "friends"];
const RANK: Record<string, number> = { day: 0, week: 1, month: 2, quarter: 3, year: 4, decade: 5, life: 6 };
const istDay = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
const ready = new Set<string>();
const prepare = (db: Database) => { const k = (db as any).filename ?? ""; if (!ready.has(k)) { migrateMission(db); ready.add(k); } };
const goalOf = (db: Database, k: string | null) => (k ? (db.query("SELECT * FROM goals WHERE id = ?").get(Number(k.slice(1))) as any) : null);

const C = MISSION_COLLECTIONS;
// a goal made offline on the phone has a temp id (n…) until it syncs; the phone renames its docs right after
const needGoal = (d: any) => (goalKey(d.goal) || /^n[A-Za-z0-9_-]{2,40}$/.test(String(d.goal ?? "")) ? null : "goal is a goal id like g4");
const purpose = mountCollection({ table: C.purpose.table, columns: { ...C.purpose.columns }, ensure: true,
  validate: (d) => (typeof d.text === "string" && d.text.trim() ? null : "text is the purpose") });
const milestones = mountCollection({ table: C.milestones.table, columns: { ...C.milestones.columns }, ensure: true,
  validate: (d) => needGoal(d) ?? (typeof d.title === "string" && d.title.trim() ? null : "a milestone needs a title"),
  onWrite: (doc, ctx) => { try { milestoneProgress(ctx.db(), doc.goal); } catch {} } });
const checkins = mountCollection({ table: C.checkins.table, columns: { ...C.checkins.columns }, ensure: true,
  validate: (d) => needGoal(d) ?? (["on", "risk", "off"].includes(d.state) ? null : "state is on, risk or off") });
const notes = mountCollection({ table: C.notes.table, columns: { ...C.notes.columns }, ensure: true,
  validate: (d) => (HORIZONS.includes(d.horizon) && typeof d.period === "string" ? null : "a note needs a horizon and a period") });
const life = mountCollection({ table: C.life.table, columns: { ...C.life.columns }, ensure: true,
  validate: (d) => (typeof d.title === "string" && d.title.trim() && ["work", "health", "people"].includes(d.fam) ? null : "a direction needs a title and a family (work, health, people)") });
const COLLS: [string, ReturnType<typeof mountCollection>][] = [["/purpose", purpose], ["/milestones", milestones], ["/checkins", checkins], ["/notes", notes], ["/life", life]];

// ── Add a goal: Claude makes a plain wish concrete, on the subscription ──────
const DRAFT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["title", "measure", "horizon", "aspects", "parent", "milestones", "note"],
  properties: {
    title: { type: "string", description: "The goal, short and concrete, in his words (under 90 characters)" },
    measure: { type: "string", description: "What it counts, e.g. 'orders · 0 → 50' or 'payment received'" },
    horizon: { type: "string", enum: ["week", "month", "quarter", "year", "decade", "life"] },
    aspects: { type: "array", items: { type: "string", enum: ASPECTS }, minItems: 1, maxItems: 3 },
    area: { type: ["string", "null"], description: "One of the area slugs, or null" },
    parent: { type: ["string", "null"], description: "The id of an existing goal on a longer horizon this one serves, or null" },
    due: { type: ["string", "null"], description: "YYYY-MM-DD when he named a date, else null" },
    milestones: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5, description: "Concrete steps in order; the first can start this week" },
    note: { type: "string", description: "One or two short sentences to him: why this shape, what serves what. Warm, direct, no filler." },
  },
};
const PURPOSE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["text", "why"],
  properties: { text: { type: "string", description: "His purpose in one sentence, first person, under 140 characters" }, why: { type: "string", description: "One short sentence on what it was drawn from" } },
};
function goalContext(db: Database, today: string) {
  const gs = (db.query("SELECT * FROM goals WHERE status = 'active' ORDER BY id").all() as any[]).map((g) => ({
    id: `g${g.id}`, title: g.title, horizon: g.horizon, period: periodLabel(g.horizon, { key: g.period, start: g.period_start, end: g.period_end }),
    aspects: (() => { try { return JSON.parse(g.aspects ?? "null"); } catch { return null; } })(), area: g.area, progress: progressOf(db, g),
  }));
  const areas = (db.query("SELECT slug, name FROM areas ORDER BY sort").all() as any[]);
  const horizons = HORIZONS.filter((h) => h !== "day").map((h) => ({ horizon: h, period: periodLabel(h, periodOf(h, today)) }));
  return { today, goals: gs, areas, horizons };
}
async function draftGoal(ctx: JobCtx, b: any) {
  const db = ctx.db(); prepare(db);
  const text = String(b.text ?? "").trim().slice(0, 600);
  if (!text) throw Object.assign(new Error("Say what you want first."), { status: 400 });
  const today = istDay();
  const g = goalContext(db, today);
  const hints = [b.horizon && `He picked the horizon: ${b.horizon}.`, b.aspects?.length && `It is for: ${b.aspects.join(", ")}.`, b.parent && `It serves ${b.parent}.`].filter(Boolean).join(" ");
  const r = await ctx.ai.claude({
    model: "haiku",
    system: `You help Alex turn a plain wish into one concrete goal on a time horizon (TimeStripe style: week, month, quarter, year, decade = years out, life). Keep his wording where you can. Pick the shortest horizon that fits a date he named; otherwise the one that fits the size of the goal. Attach 1-3 of the nine life aspects it serves (body, mind, soul, mission = work and purpose, money, growth, family, romance, friends). Link a parent only when an existing goal on a longer horizon clearly contains it. Never invent numbers he did not give; if there is no number, the measure is 'done or not done' or a count of milestones.`,
    prompt: `Context:\n${JSON.stringify(g)}\n\nHis words: ${text}\n${hints}`,
    schema: DRAFT_SCHEMA,
  });
  const o = r.out ?? {};
  const horizon: Horizon = HORIZONS.includes(o.horizon) ? o.horizon : (b.horizon && HORIZONS.includes(b.horizon) ? b.horizon : "month");
  const parentRow = goalOf(db, goalKey(o.parent));
  const parent = parentRow && parentRow.status === "active" && RANK[parentRow.horizon] > RANK[horizon] ? `g${parentRow.id}` : null;
  return {
    title: String(o.title || text).slice(0, 300), measure: String(o.measure ?? "").slice(0, 200), horizon,
    aspects: (Array.isArray(o.aspects) ? o.aspects : []).filter((a: string) => ASPECTS.includes(a)).slice(0, 3),
    area: g.areas.some((a: any) => a.slug === o.area) ? o.area : null, parent,
    due: typeof o.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.due) ? o.due : null,
    milestones: (Array.isArray(o.milestones) ? o.milestones : []).map((s: unknown) => String(s).slice(0, 200)).filter(Boolean).slice(0, 5),
    note: String(o.note ?? "").slice(0, 400), by: "agent", ms: r.ms,
  };
}
async function draftPurpose(ctx: JobCtx) {
  const db = ctx.db(); prepare(db);
  const today = istDay();
  const cur = currentPurpose(db).current?.text ?? null;
  const r = await ctx.ai.claude({
    model: "haiku",
    system: "You draft Alex's purpose statement: one sentence, first person, plain words, under 140 characters, drawn only from his goals, areas and current wording. No slogans, no buzzwords.",
    prompt: `Context:\n${JSON.stringify({ ...goalContext(db, today), current: cur })}`,
    schema: PURPOSE_SCHEMA,
  });
  return { text: String(r.out?.text ?? "").slice(0, 300), why: String(r.out?.why ?? "").slice(0, 300), by: "agent", ms: r.ms };
}

// ── agent tools (DECISIONS 2: low-stakes and reversible run on their own; new goals and moves ask first) ──
const goalArg = { type: "string", description: "A goal id like g4" };
const tools: AgentTool[] = [
  {
    name: "mission_overview", auto: true,
    description: "Read Alex's goals by horizon with progress, time gone and pace, his purpose, the week streak and each goal's open milestones.",
    input: { type: "object", properties: {} },
    async run(ctx) {
      const db = ctx.db(); prepare(db);
      const today = istDay(), gr = graph(db, today);
      const ms = listDocs(db, "milestones");
      const goals = (db.query("SELECT * FROM goals WHERE status = 'active' ORDER BY id").all() as any[]).map((g) => {
        const t = periodOf(g.horizon, today);
        const p = progressOf(db, g) / 100;
        const s = g.period_start, e = g.period_end;
        const time = s && e ? Math.min(1, Math.max(0, (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / (Date.parse(`${e}T00:00:00Z`) + 864e5 - Date.parse(`${s}T00:00:00Z`)))) : null;
        return { id: `g${g.id}`, title: g.title, horizon: g.horizon, period: g.period, current: g.period === t.key, progress: p, time,
          pace: time == null ? "no deadline" : p >= 1 ? "done" : time - p > 0.2 ? "behind" : "on pace", parent: g.parent_id ? `g${g.parent_id}` : null,
          milestones: ms.filter((m: any) => m.goal === `g${g.id}` && !m.done).map((m: any) => ({ id: m.id, title: m.title, due: m.due })) };
      });
      return { purpose: currentPurpose(db).current?.text ?? null, streak: gr.streak, totals: gr.totals, goals };
    },
  },
  {
    name: "mission_add_goal", auto: false,
    description: "Add a goal on a horizon (week, month, quarter, year, decade, life), with the aspects it serves, an optional parent goal and milestones. Ask Alex first.",
    input: { type: "object", required: ["title", "horizon"], properties: {
      title: { type: "string" }, horizon: { type: "string", enum: ["week", "month", "quarter", "year", "decade", "life"] },
      aspects: { type: "array", items: { type: "string", enum: ASPECTS } }, area: { type: "string" }, parent: goalArg,
      measure: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD" }, milestones: { type: "array", items: { type: "string" } } } },
    async run(ctx, a) {
      const db = ctx.db(); prepare(db);
      const g = ctx.store.createGoal({ title: a.title, horizon: a.horizon, aspects: a.aspects?.length ? a.aspects : null, area: a.area ?? null,
        parent: a.parent ?? null, measure: a.measure ?? null, due: a.due ?? null });
      const ms = (a.milestones ?? []).slice(0, 8).map((t: string, i: number) => putDoc(db, "milestones", { goal: g.id, title: String(t), done: false, position: i, by: "agent" }));
      return { ok: true, goal: g, milestones: ms.length, undo: `Drop it: PATCH /goals/${g.id} {"status":"dropped"}` };
    },
  },
  {
    name: "mission_log_checkin", auto: true,
    description: "Log a check-in on a goal: on (on track), risk (at risk) or off (off track), with a one-line note on why.",
    input: { type: "object", required: ["goal", "state"], properties: { goal: goalArg, state: { type: "string", enum: ["on", "risk", "off"] }, note: { type: "string" } } },
    async run(ctx, a) {
      const db = ctx.db(); prepare(db);
      const k = goalKey(a.goal), g = goalOf(db, k);
      if (!g) return { ok: false, error: `No goal ${a.goal}.` };
      if (!["on", "risk", "off"].includes(a.state)) return { ok: false, error: "state is on, risk or off" };
      const c = putDoc(db, "checkins", { goal: k, state: a.state, note: a.note ?? null, by: "agent", at: new Date().toISOString(), progress: progressOf(db, g) / 100 });
      return { ok: true, checkin: c, undo: `DELETE /mod/mission/checkins/${c.id}` };
    },
  },
  {
    name: "mission_move_goal", auto: false,
    description: "Move a goal to another horizon (its current period there: this week, this month, ...). Ask Alex first.",
    input: { type: "object", required: ["goal", "horizon"], properties: { goal: goalArg, horizon: { type: "string", enum: ["week", "month", "quarter", "year", "decade", "life"] } } },
    async run(ctx, a) {
      const k = goalKey(a.goal);
      if (!k) return { ok: false, error: `No goal ${a.goal}.` };
      const before = goalOf(ctx.db(), k);
      const g = ctx.store.patchGoal(k, { horizon: a.horizon, period: periodOf(a.horizon, istDay()).key });
      return { ok: true, goal: g, was: before ? { horizon: before.horizon, period: before.period } : null };
    },
  },
  {
    name: "mission_close_milestone", auto: true,
    description: "Mark a goal's milestone done (by its id, or by the goal and the milestone's title). Undo by calling it with done: false.",
    input: { type: "object", properties: { id: { type: "string" }, goal: goalArg, title: { type: "string" }, done: { type: "boolean" } } },
    async run(ctx, a) {
      const db = ctx.db(); prepare(db);
      let m = a.id ? getDoc(db, "milestones", String(a.id)) : null;
      if (!m && a.goal && a.title) {
        const q = String(a.title).toLowerCase();
        m = listDocs(db, "milestones", "goal = ?", goalKey(a.goal)).find((x: any) => String(x.title).toLowerCase().includes(q)) ?? null;
      }
      if (!m || m.deleted_at) return { ok: false, error: "No such milestone." };
      const done = a.done !== false;
      const out = putDoc(db, "milestones", { id: m.id, done, done_at: done ? new Date().toISOString() : null });
      return { ok: true, milestone: out, progress: milestoneProgress(db, m.goal) };
    },
  },
  {
    name: "mission_add_milestone", auto: true,
    description: "Add a milestone (a concrete step) to one of Alex's goals.",
    input: { type: "object", required: ["goal", "title"], properties: { goal: goalArg, title: { type: "string" }, due: { type: "string", description: "YYYY-MM-DD" } } },
    async run(ctx, a) {
      const db = ctx.db(); prepare(db);
      const k = goalKey(a.goal);
      if (!goalOf(db, k)) return { ok: false, error: `No goal ${a.goal}.` };
      const n = listDocs(db, "milestones", "goal = ?", k).length;
      const m = putDoc(db, "milestones", { goal: k, title: String(a.title), done: false, due: a.due ?? null, position: n, by: "agent" });
      milestoneProgress(db, k!);
      return { ok: true, milestone: m, undo: `DELETE /mod/mission/milestones/${m.id}` };
    },
  },
];

export const mission: Module = {
  name: "mission",
  async handle(ctx) {
    const db = ctx.db(); prepare(db);
    for (const [path, c] of COLLS) { const r = await c.handle(ctx, path); if (r) return r; }
    if (ctx.path === "/" && ctx.method === "GET") {
      const g = graph(db, istDay());
      return ctx.json({ ok: true, module: "mission", purpose: currentPurpose(db).current?.text ?? null, totals: g.totals, streak: g.streak });
    }
    if (ctx.path === "/graph" && ctx.method === "GET") {
      snapshot(db);      // today's row, so the history starts the first time he looks
      return ctx.json(graph(db, istDay()));
    }
    if (ctx.path === "/draft" && ctx.method === "POST") {
      if (!ctx.owner) return ctx.fail(403, "Drafting with the agent is on the owner's account.");
      const b = (await ctx.body()) ?? {};
      try {
        return ctx.json(b.kind === "purpose" ? await draftPurpose(ctx) : await draftGoal(ctx, b));
      } catch (e: any) { return ctx.fail(e?.status ?? 502, e?.message ?? "The agent couldn't draft that."); }
    }
    return null;
  },
  jobs: [
    { id: "mission-history", at: "23:50", catchUpMinutes: 240, async run(ctx) { const db = ctx.db(); prepare(db); const r = snapshot(db); ctx.log(`history ${r.date}: ${r.goals} goals`); } },
    {
      id: "mission-checkin", at: "19:00", days: ["sun"], async run(ctx) {
        const db = ctx.db(); prepare(db);
        const n = (db.query("SELECT count(*) n FROM goals WHERE status = 'active'").get() as any).n;
        if (n) await ctx.push("Check in on your goals", `${n} goal${n === 1 ? "" : "s"} to look at before the week closes.`, { link: "agenticos://mission" });
      },
    },
  ],
  tools,
};

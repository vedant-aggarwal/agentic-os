// Life: the wheel's rhythm and the agent's hands on it. (v2)
// The wheel's data is core (life_snapshots, life_area_aspects; routes GET /life, POST /life/snapshots, PUT /life/area-aspects
// in server/index.ts, written by store.ts). This module adds what the agent and the scheduler need:
//   GET /             the rhythm: last scoring, days since, due (monthly), next due, the scores, the lowest two
// Jobs:  life-rescore at 19:30: a month after the last scoring, one push ("Time to score your wheel"), at most once a week.
// Tools: life_wheel (read), life_score (record scores he gave her, today's snapshot), life_link_area (an area's aspects).
import type { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import LIFE from "../life-defaults.json";
import type { AgentTool, JobCtx, Module } from "./types";

export const RESCORE_DAYS = 30;
const ASPECTS: string[] = (LIFE as any).aspects.map((a: any) => a.key);
const NAMES: Record<string, string> = Object.fromEntries((LIFE as any).aspects.map((a: any) => [a.key, a.name]));
const istDate = (ms = Date.now()) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const bad = (m: string) => Object.assign(new Error(m), { status: 400 });

type Snap = { date: string; source: string; scores: Record<string, number> };
export function snapshots(db: Database): Snap[] {
  const rows = db.query("SELECT date, source, scores FROM life_snapshots ORDER BY date, created_at").all() as any[];
  // one per day, the app's scoring winning over an imported one on the same day (as the phone reads it)
  const byDay = new Map<string, Snap>();
  for (const r of rows) { const s = { date: r.date, source: r.source, scores: JSON.parse(r.scores || "{}") }; const cur = byDay.get(r.date); if (!cur || s.source === "app") byDay.set(r.date, s); }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}
export function areaAspects(db: Database): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of db.query("SELECT area, aspect FROM life_area_aspects ORDER BY area, rank").all() as any[]) (out[r.area] ??= []).push(r.aspect);
  return out;
}
export function rhythm(db: Database, today = istDate()) {
  const list = snapshots(db); const last = list.at(-1) ?? null; const prev = list.at(-2) ?? null;
  if (!last) return { scored: false, due: true, days: null, last: null, next: null, scores: {}, lowest: [] as string[], deltas: {} };
  const days = daysBetween(last.date, today);
  const lowest = ASPECTS.filter((a) => last.scores[a] != null).sort((a, b) => last.scores[a] - last.scores[b]).slice(0, 2);
  const deltas = prev ? Object.fromEntries(ASPECTS.filter((a) => last.scores[a] != null && prev.scores[a] != null).map((a) => [a, last.scores[a] - prev.scores[a]])) : {};
  return { scored: true, last: last.date, source: last.source, days, due: days >= RESCORE_DAYS, next: addDays(last.date, RESCORE_DAYS), scores: last.scores, previous: prev?.date ?? null, deltas, lowest };
}
/** Today's scoring from the app: the latest scores with these changes on top (one snapshot per day, source "app"). */
export function score(db: Database, changes: Record<string, unknown>, today = istDate()) {
  const clean: Record<string, number> = {};
  for (const [k, v] of Object.entries(changes ?? {})) {
    if (!ASPECTS.includes(k)) throw bad(`Unknown aspect ${k}.`);
    const n = Number(v); if (!(n >= 0 && n <= 10)) throw bad("Scores are 0 to 10.");
    clean[k] = Math.round(n * 2) / 2;
  }
  if (!Object.keys(clean).length) throw bad("No scores given.");
  const before = snapshots(db).at(-1) ?? null;
  const scores = { ...(before?.scores ?? {}), ...clean };
  db.query(`INSERT INTO life_snapshots (date, source, scores, created_at) VALUES (?, 'app', ?, ?)
    ON CONFLICT(date, source) DO UPDATE SET scores = excluded.scores`).run(today, JSON.stringify(scores), new Date().toISOString());
  return { date: today, scores, before: before ? { date: before.date, scores: before.scores } : null };
}
/** Set one area's aspects (order kept), leaving the others as they are. */
export function linkArea(db: Database, area: string, aspects: unknown) {
  if (!db.query("SELECT 1 FROM areas WHERE slug = ?").get(area)) throw bad(`No area "${area}".`);
  if (!Array.isArray(aspects) || aspects.some((a) => !ASPECTS.includes(a))) throw bad(`Aspects are some of ${ASPECTS.join(", ")}.`);
  const before = areaAspects(db)[area] ?? [];
  const list = [...new Set(aspects as string[])];
  db.transaction(() => {
    db.query("DELETE FROM life_area_aspects WHERE area = ?").run(area);
    const ins = db.prepare("INSERT INTO life_area_aspects (area, aspect, rank) VALUES (?, ?, ?)");
    list.forEach((a, i) => ins.run(area, a, i));
  })();
  return { area, aspects: list, before };
}

// ── the monthly nudge ─────────────────────────────────────────────────
const statePath = (ctx: { dataDir: string }) => join(ctx.dataDir, "mod", "life", "state.json");
const readState = (ctx: { dataDir: string }) => { try { return JSON.parse(readFileSync(statePath(ctx), "utf8")); } catch { return {}; } };
const writeState = (ctx: { dataDir: string }, s: any) => { const p = statePath(ctx); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, JSON.stringify(s)); };
export async function rescoreNudge(ctx: Pick<JobCtx, "db" | "push" | "log" | "dataDir">, today = istDate()) {
  const db = ctx.db(); if (!hasTables(db)) return { sent: false, why: "no life tables" };
  const r = rhythm(db, today);
  if (!r.due) return { sent: false, why: `scored ${r.days} days ago` };
  const st = readState(ctx);
  if (st.nudged && daysBetween(st.nudged, today) < 7) return { sent: false, why: `nudged on ${st.nudged}` };
  const body = r.scored ? `It has been ${r.days} days since ${r.last}. Your draft is ready from what your apps logged.` : "Score the nine parts of your life once; the wheel keeps itself honest from there.";
  await ctx.push("Time to score your wheel", body, { link: "agenticos://life/score", category: "AOS_NUDGE", thread: "life" });
  writeState(ctx, { ...st, nudged: today });
  ctx.log(`[life] re-score nudge sent (${r.days ?? "never"} days)`);
  return { sent: true, days: r.days };
}
const hasTables = (db: Database) => !!db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='life_snapshots'").get();

const tools: AgentTool[] = [
  {
    name: "life_wheel", auto: true,
    description: "Read his life wheel: the latest scores (0-10) for the nine aspects, when he last scored, whether a re-score is due (monthly), the change since the scoring before, the two lowest aspects, and which areas feed which aspects.",
    input: { type: "object", properties: {} },
    run: async (ctx) => { const db = ctx.db(); return { ...rhythm(db), names: NAMES, areaAspects: areaAspects(db) }; },
  },
  {
    name: "life_score", auto: true,
    description: "Record wheel scores he gave you (\"body's a 6 now\"), 0-10 per aspect, as today's scoring; aspects he didn't mention keep their latest score. Tell him what you recorded. Don't invent scores he didn't give.",
    input: { type: "object", properties: { scores: { type: "object", description: "aspect → 0-10, aspects: " + ASPECTS.join(", "), additionalProperties: { type: "number" } } }, required: ["scores"] },
    run: async (ctx, a) => score(ctx.db(), a?.scores ?? {}),
  },
  {
    name: "life_link_area", auto: true,
    description: "Set which aspects of his life an area feeds (the Life map), e.g. corner-market → money, mission. Replaces that area's list; reversible (the result has the list before).",
    input: { type: "object", properties: { area: { type: "string", description: "area slug" }, aspects: { type: "array", items: { type: "string", enum: ASPECTS } } }, required: ["area", "aspects"] },
    run: async (ctx, a) => linkArea(ctx.db(), String(a?.area ?? ""), a?.aspects),
  },
];

export const life: Module = {
  name: "life",
  async handle(ctx) {
    if ((ctx.path === "/" || ctx.path === "" || ctx.path === "/rhythm") && ctx.method === "GET") {
      const db = ctx.db(); if (!hasTables(db)) return ctx.fail(503, "The life tables aren't there yet.");
      return ctx.json(rhythm(db));
    }
    return null;
  },
  jobs: [{ id: "life-rescore", at: "19:30", catchUpMinutes: 120, run: async (ctx) => { await rescoreNudge(ctx); } }],
  tools,
};

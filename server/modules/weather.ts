// Week weather. The numbers come from `agentos weather run` (a Monte Carlo over the user's own history, no LLM);
// this module runs it, asks Haiku for one plain line per change (never for a number), serves the forecast, and
// pencils a chosen change in as an ai_batches batch of kind "weather" that the user keeps or removes.
//   POST /api/v1/mod/weather/run        { week?: "this"|"next"|date, force?: true }
//   GET  /api/v1/mod/weather/forecast?week=
//   POST /api/v1/mod/weather/apply      { change: { kind, taskId, title, line, proposal } }   → a pencilled batch
//   GET  /api/v1/mod/weather/pending?week=                                                    → open weather batches
//   POST /api/v1/mod/weather/decide     { batchId, kept: [pid], removed: [pid] }              → records and applies
//   POST /api/v1/mod/weather/undo       { applied }                                            → reverts an apply
//   job weather-hourly: re-run when the inputs changed (a plan applied, a task done, a block moved).
import { istDate } from "../store";
import type { JobCtx, Module } from "./types";
import { bad, batchRows, clip, decideAndApply, reopenProposals, saveBatch, undoApplied, weekFrom, plusDays, weekdayOf } from "./planning-common";

const LINES_SYSTEM = `You word planning changes for a small phone card: one line per change, in the same order, each under 90 characters.
Plain English, no hype, no exclamation marks. Keep every number, percentage, day name and task name exactly as given; never add a number.
Say what to do and what it buys, like "Push the Pulse Chat apps to next week: the Harborline quote ships Tue 40% → 71%".`;
const LINES_SCHEMA = { type: "object", properties: { lines: { type: "array", items: { type: "string" } } }, required: ["lines"] };

async function wordChanges(ctx: Pick<JobCtx, "ai" | "db" | "log">, runId: number, changes: any[]) {
  if (!changes?.length) return changes;
  try {
    const r = await ctx.ai.claude({ model: "haiku", system: LINES_SYSTEM, schema: LINES_SCHEMA, timeout: 40_000,
      prompt: JSON.stringify(changes.map((c) => ({ kind: c.kind, task: c.title, draft: c.line }))) });
    const lines: unknown[] = Array.isArray(r.out?.lines) ? r.out.lines : [];
    const worded = changes.map((c, i) => {
      const line = typeof lines[i] === "string" ? clip(String(lines[i]).trim(), 140) : "";
      // A line that dropped the numbers or mentions another task is not an improvement: keep the code's wording.
      const ok = line && /\d+%\s*→\s*\d+%|\d+%/.test(line);
      return { ...c, codeLine: c.line, line: ok ? line : c.line, wordedBy: ok ? "Haiku" : "code" };
    });
    const db = ctx.db();
    const row = db.query("SELECT summary FROM weather_runs WHERE id = ?").get(runId) as any;
    if (row) { const s = JSON.parse(row.summary); s.changes = worded; s.wordedBy = "Haiku"; s.wordedMs = r.ms; db.query("UPDATE weather_runs SET summary = ? WHERE id = ?").run(JSON.stringify(s), runId); }
    return worded;
  } catch (e) {
    ctx.log(`haiku wording skipped: ${e instanceof Error ? e.message : e}`);
    return changes;
  }
}
async function forecast(ctx: Pick<JobCtx, "agentos">, week: string) {
  const r = await ctx.agentos(["weather", "--week", week]);
  return r?.run === null ? null : r;
}
async function runWeek(ctx: Pick<JobCtx, "agentos" | "ai" | "db" | "log">, week: string, force: boolean) {
  const args = ["weather", "run", "--week", week];
  if (!force) args.push("--if-changed");
  const r = await ctx.agentos(args);
  if (!r?.ok) throw bad("The forecast could not run.");
  if (!r.skipped) await wordChanges(ctx, r.run, r.changes ?? []);
  return { run: r.run, skipped: !!r.skipped, headline: r.headline };
}
function pending(ctx: Pick<JobCtx, "db">, week: string) {
  const db = ctx.db();
  const rows = db.query("SELECT id FROM ai_batches WHERE kind = 'weather' AND date = ? ORDER BY id DESC LIMIT 20").all(week) as any[];
  return rows.map((b) => batchRows(db, b.id)).filter(Boolean).flatMap((b) => b!.rows.map((r) => ({ ...r, batchId: b!.batchId, summary: b!.summary, createdAt: b!.createdAt })));
}
const shape = (f: any, week: string, pend: any[]) => ({ week, from: f?.summary?.from ?? null, to: f?.summary?.to ?? plusDays(week, 6), run: f ? { id: f.id, createdAt: f.created_at, hash: f.inputs_hash } : null,
  headline: f?.summary?.headline ?? null, score: f?.summary?.score ?? null, basis: f?.summary?.basis ?? null, wordedBy: f?.summary?.wordedBy ?? "code",
  changes: f?.summary?.changes ?? [], projects: f?.projects ?? [], tasks: f?.tasks ?? [], days: f?.days ?? [], blocks: f?.blocks ?? [], pending: pend });

export const weather: Module = {
  name: "weather",
  async handle(ctx) {
    const today = istDate();
    if (ctx.path === "/forecast" && ctx.method === "GET") {
      const week = weekFrom(ctx.url.searchParams.get("week"), today);
      return ctx.json(shape(await forecast(ctx, week), week, pending(ctx, week)));
    }
    if (ctx.path === "/run" && ctx.method === "POST") {
      const b = await ctx.body().catch(() => ({}));
      const week = weekFrom(b?.week, today);
      if (week < plusDays(today, -6)) throw bad("That week is over.");
      const r = await runWeek(ctx, week, !!b?.force);
      return ctx.json({ ...shape(await forecast(ctx, week), week, pending(ctx, week)), ran: !r.skipped });
    }
    if (ctx.path === "/pending" && ctx.method === "GET") return ctx.json({ pending: pending(ctx, weekFrom(ctx.url.searchParams.get("week"), today)) });
    // Every run kept for the week (the CLI keeps ten), oldest first: the desktop draws a sparkline per project from it.
    if (ctx.path === "/history" && ctx.method === "GET") {
      const week = weekFrom(ctx.url.searchParams.get("week"), today);
      const db = ctx.db();
      const runs = (db.query("SELECT id, created_at, summary FROM weather_runs WHERE week = ? ORDER BY id").all(week) as any[]).map((r) => {
        let s: any = {}; try { s = JSON.parse(r.summary); } catch {}
        const rows = db.query("SELECT kind, key, probability FROM weather_forecasts WHERE run_id = ? AND kind IN ('project', 'task')").all(r.id) as any[];
        return { id: r.id, createdAt: r.created_at, score: s.score ?? null, projects: Object.fromEntries(rows.filter((x) => x.kind === "project").map((x) => [x.key, x.probability])),
          tasks: Object.fromEntries(rows.filter((x) => x.kind === "task").map((x) => [x.key, x.probability])) };
      });
      return ctx.json({ week, runs });
    }
    if (ctx.path === "/apply" && ctx.method === "POST") {
      const b = await ctx.body();
      const c = b?.change;
      if (!c || !["move", "drop", "shrink"].includes(c.kind) || !c.proposal?.taskId) throw bad("Send { change: { kind, taskId, title, line, proposal } } from the forecast.");
      const week = weekFrom(b?.week, today);
      const task = ctx.store.tasks().find((t: any) => t.id === c.proposal.taskId);
      if (!task) throw bad("That task is gone.");
      const db = ctx.db();
      // One pencilled row per task and week: a second tap on the same change does not stack.
      const dup = db.query(`SELECT p.id FROM ai_proposals p JOIN ai_batches b ON b.id = p.batch_id
        WHERE b.kind = 'weather' AND b.date = ? AND p.task_id = ? AND p.status = 'open' LIMIT 1`).get(week, Number(String(task.id).slice(1))) as any;
      if (dup) return ctx.json({ ok: true, already: true, pending: pending(ctx, week) });
      const kind = c.kind === "drop" ? "defer" : c.kind;
      const saved = saveBatch(db, { kind: "weather", date: week, summary: clip(String(c.line ?? ""), 200), model: "code", ms: 0 },
        [{ kind, taskId: task.id, payload: { ...c.proposal, title: task.title, area: task.area, kind: c.kind, line: c.line, delta: c.delta }, reason: clip(String(c.line ?? ""), 200) }]);
      return ctx.json({ ok: true, batchId: saved.batchId, pid: saved.pids[0], pending: pending(ctx, week) }, 201);
    }
    if (ctx.path === "/decide" && ctx.method === "POST") {
      const b = await ctx.body();
      if (!b?.batchId) throw bad("batchId is required.");
      const r = decideAndApply(ctx, String(b.batchId), b);
      if (r.applied.length) void runWeek(ctx, weekFrom(b?.week, today), true).catch((e) => ctx.log(`rerun after apply: ${e}`));
      return ctx.json(r);
    }
    if (ctx.path === "/undo" && ctx.method === "POST") {
      const b = await ctx.body();
      const undone = undoApplied(ctx.store, Array.isArray(b?.applied) ? b.applied : []);
      reopenProposals(ctx.db(), undone);
      return ctx.json({ ok: true, undone });
    }
    return null;
  },
  jobs: [{
    id: "weather-hourly", every: "1h",
    async run(ctx) {
      // The week ahead, plus next week from Saturday evening so the cabinet and the Sunday card have numbers.
      const today = istDate();
      const weeks = [weekFrom("default", today)];
      if (weekdayOf(today) === "sat") weeks.push(weekFrom("next", today));
      for (const week of weeks) {
        const r = await runWeek(ctx, week, false);
        ctx.log(r.skipped ? `week ${week}: inputs unchanged` : `week ${week}: run ${r.run} · ${r.headline}`);
      }
    },
  }],
};

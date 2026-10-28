// Bounty board and payroll (big idea 5). 06:30 daily the job runs `agentos bounty scan`: recurring
// work (repeat rules, titles done 3+ times in 60 days) priced at minutes per week x your hourly value,
// ranked by payoff per month. Take files a task "Automate: <title>" and hands it to the agent with a
// brief to make it a one-command script or skill (ai.give; a dry run under MOD_DRY_RUN=1).
// 07:00 on the 1st the payroll job writes one bounty_payroll row per runner for the month that ended:
// ai batches by kind (kept vs removed), agent jobs (ai.agentsFor), module jobs (<dataDir>/mod/jobs.json
// plus this group's own tables). A runner under 20% kept over 30 days gets a "retire this job?" proposal
// in an ai_batches batch of kind bounty; keeping that proposal adds the runner to settings.bounty.retired.
//   GET /board, GET /payroll, PUT /rate { rate }, POST /scan, POST /items/:id/take|dismiss,
//   POST /payroll/run, POST /payroll/proposals/:pid/keep|remove   (writes: owner)
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { JobCtx, Module } from "./types";
import { addDays, dryRun, giveTask, isRetired, istDate, numId, retiredRunners, workspaceFor } from "./knowing-shared";

const RUNNER = "job:bounty:bounty-board";
// Payroll value assumptions (rupees): a kept proposal saved about 3 minutes of deciding; a task the agent finished saved about 30.
const KEPT_MINUTES = 3;
const TASK_MINUTES = 30;
const RETIRE_UNDER = 0.2;   // kept rate below this over 30 days, with at least MIN_DECIDED decisions
const MIN_DECIDED = 5;

const iso = () => new Date().toISOString();
const pct = (k: number, r: number) => (k + r ? k / (k + r) : null);

type Row = { runner: string; runs: number; kept: number; removed: number; tasks_done: number; evidence_verified: number; quota_estimate: number | null; value_estimate: number | null; note: string | null };
const value = (rate: number | null, kept: number, tasksDone: number) => (rate ? Math.round(((kept * KEPT_MINUTES + tasksDone * TASK_MINUTES) / 60) * rate) : null);

/** Payroll lines for one window [since, until) as ISO stamps. Pure over the db, the agents map and jobs.json. */
export function payrollRows(db: Database, agents: Record<string, any>, jobsFile: Record<string, any>, since: string, until: string, rate: number | null): Row[] {
  const rows: Row[] = [];
  const inWin = (at: string | null | undefined) => !!at && at >= since && at < until;
  // 1. AI batches by kind: Plan my day, inbox sorts, tags, capture reads, payroll itself.
  const batches = db.query("SELECT kind, count(*) runs, coalesce(sum(ms), 0) ms FROM ai_batches WHERE created_at >= ? AND created_at < ? GROUP BY kind").all(since, until) as any[];
  const decided = db.query(`SELECT b.kind, p.status, count(*) n FROM ai_proposals p JOIN ai_batches b ON b.id = p.batch_id
    WHERE b.created_at >= ? AND b.created_at < ? AND p.status IN ('kept', 'removed') GROUP BY b.kind, p.status`).all(since, until) as any[];
  for (const b of batches) {
    const n = (st: string) => decided.find((d) => d.kind === b.kind && d.status === st)?.n ?? 0;
    rows.push({ runner: `ai:${b.kind}`, runs: b.runs, kept: n("kept"), removed: n("removed"), tasks_done: 0, evidence_verified: 0,
      quota_estimate: Math.round(b.ms / 1000), value_estimate: value(rate, n("kept"), 0), note: "quota = model seconds" });
  }
  // 2. Agent jobs (Give to Claude): done tasks, and whether the job folder the evidence points at exists.
  const ag = Object.entries(agents).filter(([, a]) => inWin(a?.startedAt));
  if (ag.length) {
    const done = ag.filter(([, a]) => a.state === "done");
    const verified = done.filter(([, a]) => a.evidence && existsSync(join(homedir(), String(a.evidence)))).length;
    rows.push({ runner: "agent:claude", runs: ag.length, kept: done.length, removed: ag.filter(([, a]) => a.state === "failed").length, tasks_done: done.length,
      evidence_verified: verified, quota_estimate: null, value_estimate: value(rate, 0, done.length), note: "quota unknown: runs on the Claude subscription" });
  }
  // 3. Module jobs: jobs.json keeps only the last run per job, so most runners count at most 1 here;
  //    this group's own tables give the real counts for doctrine, runbooks and bounty.
  const own: Record<string, Partial<Row>> = {};
  try {
    const o = db.query("SELECT sum(status = 'accepted') kept, sum(status = 'declined') removed, count(*) runs FROM doctrine_observations WHERE created_at >= ? AND created_at < ?").get(since, until) as any;
    if (o?.runs) own["job:doctrine:doctrine-weekly"] = { runs: o.runs, kept: o.kept ?? 0, removed: o.removed ?? 0 };
    const r = db.query(`SELECT count(*) runs, sum(finished_at IS NOT NULL AND result != 'dropped') done, sum(result IS NOT NULL AND result NOT IN ('done', 'dropped')) verified
      FROM runbooks_runs WHERE started_at >= ? AND started_at < ?`).get(since, until) as any;
    if (r?.runs) own["job:runbooks:runbooks-scan"] = { runs: r.runs, tasks_done: r.done ?? 0, evidence_verified: r.verified ?? 0, note: "runs = runbook runs started" };
    const t = db.query("SELECT sum(status != 'open') taken, count(*) items FROM bounty_items WHERE updated_at >= ? AND updated_at < ?").get(since, until) as any;
    if (t?.items) own["job:bounty:bounty-board"] = { kept: t.taken ?? 0, note: "kept = bounties taken or dismissed" };
  } catch { /* tables missing: an older CLI */ }
  const keys = new Set([...Object.keys(jobsFile ?? {}).map((k) => `job:${k}`), ...Object.keys(own)]);
  for (const runner of keys) {
    const last = (jobsFile ?? {})[runner.slice(4)];
    const base: Row = { runner, runs: inWin(last?.at) ? 1 : 0, kept: 0, removed: 0, tasks_done: 0, evidence_verified: 0,
      quota_estimate: inWin(last?.at) ? Math.round((last.ms ?? 0) / 1000) : null, value_estimate: null, note: last?.ok === false ? `last run failed: ${last.error ?? ""}`.trim() : "last run only" };
    const r = { ...base, ...(own[runner] ?? {}) };
    if (own[runner]?.note && base.note?.startsWith("last run failed")) r.note = `${base.note}; ${own[runner].note}`;
    r.value_estimate = value(rate, r.kept, r.tasks_done);
    rows.push(r);
  }
  return rows.sort((a, b) => (b.value_estimate ?? -1) - (a.value_estimate ?? -1) || a.runner.localeCompare(b.runner));
}

/** Runners whose kept rate over the last 30 days is under 20% with enough decisions to mean something. */
export function underperformers(db: Database, since: string): { runner: string; kept: number; removed: number; rate: number }[] {
  const out: { runner: string; kept: number; removed: number; rate: number }[] = [];
  const dec = db.query(`SELECT b.kind, sum(p.status = 'kept') kept, sum(p.status = 'removed') removed FROM ai_proposals p JOIN ai_batches b ON b.id = p.batch_id
    WHERE b.created_at >= ? AND p.status IN ('kept', 'removed') AND b.kind != 'bounty' GROUP BY b.kind`).all(since) as any[];
  for (const d of dec) { const r = pct(d.kept, d.removed); if (d.kept + d.removed >= MIN_DECIDED && r !== null && r < RETIRE_UNDER) out.push({ runner: `ai:${d.kind}`, kept: d.kept, removed: d.removed, rate: r }); }
  try {
    const o = db.query("SELECT sum(status = 'accepted') kept, sum(status = 'declined') removed FROM doctrine_observations WHERE created_at >= ?").get(since) as any;
    const r = pct(o?.kept ?? 0, o?.removed ?? 0);
    if ((o?.kept ?? 0) + (o?.removed ?? 0) >= MIN_DECIDED && r !== null && r < RETIRE_UNDER) out.push({ runner: "job:doctrine:doctrine-weekly", kept: o.kept, removed: o.removed, rate: r });
  } catch { /* no table */ }
  return out;
}

export async function payroll(ctx: JobCtx, opts: { force?: boolean } = {}) {
  const today = istDate();
  if (!opts.force && !today.endsWith("-01")) { ctx.log("payroll runs on the 1st; skipping"); return { skipped: "not the 1st", rows: [], new_proposals: 0 }; }
  // On the 1st: the month that just ended. Forced on another day: this month so far.
  const ref = today.endsWith("-01") ? addDays(today, -1) : today;
  const period = ref.slice(0, 7);
  const [y, mo] = period.split("-").map(Number);
  const since = new Date(Date.parse(`${period}-01T00:00:00+05:30`)).toISOString();
  const until = new Date(Date.parse(`${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, "0")}-01T00:00:00+05:30`)).toISOString();
  const db = ctx.db();
  const rate = (await ctx.agentos(["bounty", "rate"]).catch(() => ({ rate: null }))).rate ?? null;
  const agents = await ctx.ai.agentsFor(ctx.user).catch(() => ({}));
  let jobsFile: Record<string, any> = {};
  try { jobsFile = JSON.parse(await Bun.file(join(ctx.dataDir, "mod", "jobs.json")).text()); } catch {}
  const rows = payrollRows(db, agents, jobsFile, since, until, rate);
  const stamp = iso();
  db.transaction(() => {
    const ins = db.query(`INSERT INTO bounty_payroll (runner, period, runs, kept, removed, tasks_done, evidence_verified, quota_estimate, value_estimate, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(runner, period) DO UPDATE SET runs = excluded.runs, kept = excluded.kept, removed = excluded.removed,
      tasks_done = excluded.tasks_done, evidence_verified = excluded.evidence_verified, quota_estimate = excluded.quota_estimate, value_estimate = excluded.value_estimate,
      note = excluded.note, created_at = excluded.created_at`);
    for (const r of rows) ins.run(r.runner, period, r.runs, r.kept, r.removed, r.tasks_done, r.evidence_verified, r.quota_estimate, r.value_estimate, r.note, stamp);
  })();
  // Retire proposals: one batch of kind bounty, one row per runner under 20% kept over the last 30 days.
  const since30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const open = new Set((db.query("SELECT p.payload FROM ai_proposals p JOIN ai_batches b ON b.id = p.batch_id WHERE b.kind = 'bounty' AND p.status = 'open'").all() as any[])
    .map((p) => { try { return JSON.parse(p.payload).runner; } catch { return null; } }));
  const retired = new Set(retiredRunners(ctx));
  const under = underperformers(db, since30).filter((u) => !open.has(u.runner) && !retired.has(u.runner));
  let proposals = 0;
  if (under.length) {
    db.transaction(() => {
      const b = db.query("INSERT INTO ai_batches (kind, date, summary, model, ms, status, created_at) VALUES ('bounty', ?, ?, 'code', 0, 'open', ?) RETURNING id")
        .get(today, `Payroll ${period}: ${under.length} runner${under.length === 1 ? "" : "s"} under 20% kept over 30 days`, stamp) as any;
      const ins = db.query("INSERT INTO ai_proposals (batch_id, kind, task_id, payload, reason, status, created_at) VALUES (?, 'retire', NULL, ?, ?, 'open', ?)");
      for (const u of under) { ins.run(b.id, JSON.stringify({ runner: u.runner, kept: u.kept, removed: u.removed, keptRate: Math.round(u.rate * 100), period }), "retire this job?", stamp); proposals++; }
    })();
  }
  ctx.log(`payroll ${period}: ${rows.length} runners, ${proposals} retire proposal${proposals === 1 ? "" : "s"}`);
  return { period, since, until, rows, new_proposals: proposals };
}

async function board(ctx: JobCtx) { return { ...(await ctx.agentos(["bounty"])), dryRun: dryRun(), retired: retiredRunners(ctx) }; }
async function payrollView(ctx: JobCtx) {
  const p = await ctx.agentos(["bounty", "payroll"]);
  const db = ctx.db();
  const proposals = (db.query(`SELECT p.id, p.status, p.payload, p.reason, p.created_at, p.decided_at, b.id batch, b.date FROM ai_proposals p JOIN ai_batches b ON b.id = p.batch_id
    WHERE b.kind = 'bounty' ORDER BY p.id DESC LIMIT 20`).all() as any[]).map((p) => { let payload: any = {}; try { payload = JSON.parse(p.payload); } catch {}
    return { id: `p${p.id}`, batch: `b${p.batch}`, date: p.date, status: p.status, reason: p.reason, ...payload }; });
  return { rows: p.rows ?? [], proposals, retired: retiredRunners(ctx), dryRun: dryRun() };
}
export async function scan(ctx: JobCtx, opts: { force?: boolean } = {}) {
  if (!opts.force && isRetired(ctx, RUNNER)) { ctx.log("retired by payroll, skipping"); return { skipped: "retired" }; }
  return ctx.agentos(["bounty", "scan"]);
}

export const bounty: Module = {
  name: "bounty",
  async handle(ctx) {
    const { path, method } = ctx;
    let m: RegExpMatchArray | null;
    if (method === "GET" && path === "/board") return ctx.json(await board(ctx));
    if (method === "GET" && path === "/payroll") return ctx.json(await payrollView(ctx));
    if (method === "GET") return null;
    if (!ctx.owner) return ctx.fail(403, "Only the owner runs the bounty board.");
    if (method === "PUT" && path === "/rate") {
      const b = await ctx.body();
      const n = Number(b.rate);
      if (!Number.isFinite(n) || n <= 0) return ctx.fail(400, "rate is rupees per hour, above 0.");
      await ctx.agentos(["bounty", "rate", String(n)]);
      return ctx.json({ ok: true, ...(await board(ctx)) });
    }
    if (method === "POST" && path === "/scan") { await scan(ctx, { force: true }); return ctx.json({ ok: true, ...(await board(ctx)) }); }
    if (method === "POST" && (m = path.match(/^\/items\/(\d+)\/(take|dismiss)$/))) {
      const id = m[1];
      if (m[2] === "dismiss") { await ctx.agentos(["bounty", "dismiss", id]); return ctx.json({ ok: true, ...(await board(ctx)) }); }
      const all = await ctx.agentos(["bounty", "--all"]);
      const item = (all.items ?? []).find((i: any) => String(i.id) === id);
      if (!item) return ctx.fail(404, "No such bounty.");
      if (item.status !== "open") return ctx.fail(400, `That bounty is already ${item.status}.`);
      const rate = all.rate ?? null;
      const title = `Automate: ${item.title}`.slice(0, 200);
      const add = await ctx.agentos(["add", title, "--due", "today", ...(item.area ? ["--area", item.area] : []),
        "--notes", `Bounty ${id}: ${item.minutes_per_week} min/week${item.payoff_per_month ? `, Rs ${item.payoff_per_month}/month` : ""}`]);
      const brief = [
        `Automation bounty from Alex's planner: "${item.title}" comes back about ${item.times_per_week} times a week and takes about ${item.minutes_each} minutes each time`,
        `(${item.minutes_per_week} minutes a week${item.payoff_per_month ? `, worth Rs ${item.payoff_per_month} a month at Rs ${rate}/hour` : ""}; basis: ${item.basis}).`,
        "Write a script or a skill that makes this a one-command job. Put it next to the project it belongs to, or in ~/.claude/skills/<name>/ for a skill; test it once on a copy, never on live data.",
        "Report exactly where it lives and the one command that runs it. Do nothing that sends messages, pays, deletes data or pushes to main.",
      ].join(" ");
      const agent = await giveTask(ctx, add.task.id, { brief, mode: "edit", confirm: true, workspace: workspaceFor(item.area, item.title) });
      await ctx.agentos(["bounty", "take", id, "--task", add.task.id]);
      ctx.log(`bounty ${id} taken as ${add.task.id}${agent?.dryRun ? " (dry run)" : ""}`);
      return ctx.json({ ok: true, task: add.task, agent, dryRun: !!agent?.dryRun, ...(await board(ctx)) }, 201);
    }
    if (method === "POST" && path === "/payroll/run") { const r = await payroll(ctx, { force: true }); return ctx.json({ ok: true, ...r, ...(await payrollView(ctx)) }); }
    if (method === "POST" && (m = path.match(/^\/payroll\/proposals\/p?(\d+)\/(keep|remove)$/))) {
      const db = ctx.db();
      const pid = Number(m[1]);
      const p = db.query("SELECT p.*, b.kind FROM ai_proposals p JOIN ai_batches b ON b.id = p.batch_id WHERE p.id = ?").get(pid) as any;
      if (!p || p.kind !== "bounty") return ctx.fail(404, "No such payroll proposal.");
      if (p.status !== "open") return ctx.fail(400, `Already ${p.status}.`);
      const stamp = iso();
      let runner: string | null = null;
      db.transaction(() => {
        db.query("UPDATE ai_proposals SET status = ?, decided_at = ? WHERE id = ?").run(m![2] === "keep" ? "kept" : "removed", stamp, pid);
        if (!(db.query("SELECT 1 FROM ai_proposals WHERE batch_id = ? AND status = 'open'").get(p.batch_id)))
          db.query("UPDATE ai_batches SET status = 'decided', decided_at = ? WHERE id = ?").run(stamp, p.batch_id);
        if (m![2] === "keep") {
          try { runner = JSON.parse(p.payload).runner ?? null; } catch {}
          if (runner) {
            const list = new Set(retiredRunners(ctx));
            list.add(runner);
            db.query("INSERT INTO settings (key, value, updated_at) VALUES ('bounty.retired', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
              .run(JSON.stringify([...list]), stamp);
          }
        }
      })();
      return ctx.json({ ok: true, proposal: `p${pid}`, decision: m[2] === "keep" ? "retired" : "kept running", runner, ...(await payrollView(ctx)) });
    }
    return null;
  },
  jobs: [
    { id: "bounty-board", at: "06:30", run: async (ctx) => { await scan(ctx); } },
    { id: "bounty-payroll", at: "07:00", run: async (ctx) => { await payroll(ctx); } },
  ],
};

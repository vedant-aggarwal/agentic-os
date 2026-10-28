// Doctrine engine (big idea 3). Every Sunday at 18:00 the job asks the CLI for candidate patterns
// (`agentos doctrine candidates`: computed from history in code), takes the strongest one not yet
// observed, and has Sonnet write one specific sentence plus a rule from the evidence rows. The
// observation lands in doctrine_observations with its rows; Accept (phone, desktop or CLI) makes a
// doctrine_rules row and appends the rule to settings.ai.plan_rules, which Plan my day reads.
//   GET  /state                          this week's open observation, the rules, past observations
//   GET  /rules, GET /observations       the CLI's lists
//   POST /observations/:id/accept|decline, POST /rules/:id/retire   (owner)
//   POST /observe { force? }             run the Sunday job now (owner)
import type { JobCtx, Module } from "./types";
import { dryRun, isRetired, isoWeek, istDate } from "./knowing-shared";

const RUNNER = "job:doctrine:doctrine-weekly";
// The server's built-in planner rule for the owner (proposals.ts OWNER_RULES) applies only while ai.plan_rules is unset,
// so the first accepted rule seeds the setting with it instead of silently dropping it.
const OWNER_DEFAULT_RULE = "One in-person human rep a day: buying chai and asking the vendor one thing counts. Client work comes before other desk work.";
const SCHEMA = { type: "object", properties: { observation: { type: "string" }, rule: { type: "string" } }, required: ["observation", "rule"] };
const SYSTEM = `You write one weekly observation about how one person really works, from rows of their own task history.
"observation": one specific sentence under 30 words that states the pattern with the numbers from the rows, like "06:00 blocks get skipped four times in five." Plain English, no advice, no hedging, no names of columns.
"rule": one sentence under 20 words that a day planner can obey, imperative and concrete (a time, an area, a weekday or a count), following from the observation. Example: "Plan the first block of the day at 07:00, never 06:00."
Use only numbers that are in the rows. Never invent a cause.`;

const shape = (o: any) => ({ id: o.id, week: o.week, pattern: o.pattern, status: o.status, text: o.text, rule: o.proposed_rule,
  evidence: JSON.parse(o.evidence || "[]"), created_at: o.created_at, decided_at: o.decided_at });

/** The Sunday job (and POST /observe): one observation per ISO week, from the strongest unseen pattern. */
export async function observe(ctx: JobCtx, opts: { force?: boolean } = {}) {
  if (!opts.force && isRetired(ctx, RUNNER)) { ctx.log("retired by payroll, skipping"); return { observation: null, reason: "retired" }; }
  const c = await ctx.agentos(["doctrine", "candidates"]);
  const week: string = c.week ?? isoWeek(istDate());
  const db = ctx.db();
  const existing = db.query("SELECT * FROM doctrine_observations WHERE week = ? ORDER BY id DESC LIMIT 1").get(week) as any;
  if (existing && !opts.force) return { observation: shape(existing), reason: "already observed this week" };
  const pick = (c.candidates ?? []).find((x: any) => !x.observed);
  if (!pick) { ctx.log("not enough history for an observation yet"); return { observation: null, reason: "Not enough history yet: schedule tasks, finish them with evidence, decide on proposals." }; }
  const r = await ctx.ai.claude({ model: "sonnet", system: SYSTEM, schema: SCHEMA,
    prompt: JSON.stringify({ week, pattern: pick.pattern, summary: pick.summary, rows: pick.rows }) });
  const text = String(r.out.observation ?? pick.summary).trim().slice(0, 300) || pick.summary;
  const rule = String(r.out.rule ?? "").trim().slice(0, 200) || null;
  const row = db.query(`INSERT INTO doctrine_observations (week, pattern, text, evidence, proposed_rule, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?) RETURNING *`).get(week, pick.pattern, text, JSON.stringify(pick.rows ?? []), rule, new Date().toISOString()) as any;
  ctx.log(`observation ${row.id} for ${week}: ${text}`);
  await ctx.push("This week's observation", text, { mod: "doctrine", id: row.id }).catch(() => {});
  return { observation: shape(row), created: true, model: r.model, ms: r.ms };
}

async function state(ctx: JobCtx) {
  const [rules, obs] = await Promise.all([ctx.agentos(["doctrine"]), ctx.agentos(["doctrine", "observations"])]);
  const observations: any[] = obs.observations ?? [];
  return { week: isoWeek(istDate()), current: observations.find((o) => o.status === "open") ?? null, rules: rules.rules ?? [],
    plan_rules: rules.plan_rules ?? null, observations, dryRun: dryRun() };
}

export const doctrine: Module = {
  name: "doctrine",
  async handle(ctx) {
    const { path, method } = ctx;
    let m: RegExpMatchArray | null;
    if (method === "GET" && path === "/state") return ctx.json(await state(ctx));
    if (method === "GET" && path === "/rules") return ctx.json(await ctx.agentos(["doctrine"]));
    if (method === "GET" && path === "/observations") return ctx.json(await ctx.agentos(["doctrine", "observations"]));
    if (method === "GET" && path === "/candidates") return ctx.json(await ctx.agentos(["doctrine", "candidates"]));
    if (method !== "POST") return null;
    if (!ctx.owner) return ctx.fail(403, "Only the owner decides the doctrine.");
    if ((m = path.match(/^\/observations\/(\d+)\/(accept|decline)$/))) {
      if (m[2] === "accept" && ctx.user.role === "owner") {
        const db = ctx.db();
        const cur = (db.query("SELECT value FROM settings WHERE key = 'ai.plan_rules'").get() as any)?.value;
        if (!cur) db.query("INSERT INTO settings (key, value, updated_at) VALUES ('ai.plan_rules', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
          .run(OWNER_DEFAULT_RULE, new Date().toISOString());
      }
      const r = await ctx.agentos(["doctrine", m[2], m[1]]);
      return ctx.json({ ...r, ...(await state(ctx)) });
    }
    if ((m = path.match(/^\/rules\/(\d+)\/retire$/))) {
      const r = await ctx.agentos(["doctrine", "retire", m[1]]);
      return ctx.json({ ...r, ...(await state(ctx)) });
    }
    if (path === "/observe") {
      const b = await ctx.body().catch(() => ({}));
      const r = await observe(ctx, { force: !!b?.force });
      return ctx.json({ ...r, ...(await state(ctx)) }, "created" in r && r.created ? 201 : 200);
    }
    return null;
  },
  jobs: [{ id: "doctrine-weekly", at: "18:00", days: ["sun"], run: async (ctx) => { await observe(ctx); } }],
};

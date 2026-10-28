// Doctrine engine (big idea 3). Once a week the phone server's `doctrine-weekly` job asks this
// module for candidate patterns (`agentos doctrine candidates`), has Sonnet turn the strongest
// unseen one into one specific sentence plus a rule, and stores it as a doctrine_observations row.
// Accepting an observation makes a doctrine_rules row AND appends the rule to the `ai.plan_rules`
// setting (what `agentos ai rules` writes), so Plan my day obeys it at once.
//   agentos doctrine                   active rules, each with the observation behind it
//   agentos doctrine observations      every observation, newest first (open, accepted, declined)
//   agentos doctrine candidates        the patterns the Sunday job would pick from (computed in code, no model)
//   agentos doctrine accept|decline <id>, agentos doctrine retire <rule id>
import type { Database } from "bun:sqlite";
import type { ModCtx, Module } from "./types";

const IST_MS = 330 * 60_000;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ist = (iso: string) => new Date(Date.parse(iso) + IST_MS);
const dateOf = (iso: string) => ist(iso).toISOString().slice(0, 10);
const hourOf = (iso: string) => ist(iso).toISOString().slice(11, 13);
const hhmmOf = (iso: string) => ist(iso).toISOString().slice(11, 16);
const dayOf = (iso: string) => DAYS[ist(iso).getUTCDay()];
const r2 = (n: number) => Math.round(n * 100) / 100;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const KIND_LABEL: Record<string, string> = { plan: "Plan my day", triage: "inbox sort", tag: "area tag", parse: "capture read", bounty: "payroll" };

export type Candidate = { pattern: string; strength: number; summary: string; rows: Record<string, unknown>[]; observed: boolean };

/** ISO week of a YYYY-MM-DD date, like 2026-W42. The job stores one observation per week. */
export function isoWeek(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Candidate patterns from history, strongest first. Pure code, no model: the rows are the evidence
 *  the phone shows under the sentence. `observed` marks patterns an earlier observation already covered. */
export function candidates(db: Database, now = new Date()): Candidate[] {
  const out: Candidate[] = [];
  const nowIso = now.toISOString();
  const group = <T>(xs: T[], key: (x: T) => string) => {
    const m = new Map<string, T[]>();
    for (const x of xs) { const k = key(x); (m.get(k) ?? m.set(k, []).get(k)!).push(x); }
    return m;
  };

  // 1. Skip rate by hour of day for scheduled tasks (a block in the past that was not done that day).
  const sched = db.query("SELECT id, title, status, start_at, end_at, done_at FROM tasks WHERE start_at IS NOT NULL AND end_at IS NOT NULL AND end_at < ? ORDER BY start_at").all(nowIso) as any[];
  for (const [h, ts] of group(sched, (t) => hourOf(t.start_at))) {
    if (ts.length < 3) continue;
    const rows = ts.map((t) => {
      const late = t.status === "done" && t.done_at && Date.parse(t.done_at) > Date.parse(t.end_at) + 864e5;
      const result = t.status === "done" ? (late ? "done, a day later" : "done") : t.status === "dropped" ? "dropped" : "skipped";
      return { task: `t${t.id}`, title: t.title, date: dateOf(t.start_at), planned: hhmmOf(t.start_at), result };
    });
    const skipped = rows.filter((r) => r.result !== "done").length;
    const rate = skipped / rows.length;
    if (rate < 0.5) continue;
    out.push({ pattern: `skip_by_hour:${h}`, strength: r2(rate * Math.sqrt(rows.length)), observed: false,
      summary: `Blocks planned at ${h}:00 got skipped ${skipped} times in ${rows.length}.`, rows });
  }

  // 2. Overrun ratio by area and weekday: actual (started_at to done_at) against the estimate.
  const done = db.query("SELECT id, title, area, started_at, done_at, estimate_minutes, due, created_at, evidence FROM tasks WHERE status = 'done' AND done_at IS NOT NULL ORDER BY done_at").all() as any[];
  const timed = done.filter((t) => t.started_at && t.estimate_minutes > 0)
    .map((t) => ({ ...t, actual: Math.round((Date.parse(t.done_at) - Date.parse(t.started_at)) / 60000) }))
    .filter((t) => t.actual > 0 && t.actual <= 1440);
  for (const [k, ts] of group(timed, (t) => `${t.area ?? "no area"}|${dayOf(t.started_at)}`)) {
    if (ts.length < 2) continue;
    const ratio = r2(median(ts.map((t) => t.actual / t.estimate_minutes)));
    if (ratio < 1.5) continue;
    const [area, day] = k.split("|");
    out.push({ pattern: `overrun:${area}:${day.toLowerCase()}`, strength: r2((ratio - 1) * Math.sqrt(ts.length)), observed: false,
      summary: `${area === "no area" ? "Tasks with no area" : `${area} tasks`} started on a ${day} run ${ratio}x their estimate (${ts.length} tasks).`,
      rows: ts.map((t) => ({ task: `t${t.id}`, title: t.title, weekday: dayOf(t.started_at), estimate: t.estimate_minutes, actual: t.actual, ratio: r2(t.actual / t.estimate_minutes) })) });
  }

  // 3. Tasks added on a given weekday and how late they finished.
  for (const [day, ts] of group(done.filter((t) => t.due), (t) => dayOf(t.created_at))) {
    if (ts.length < 3) continue;
    const rows = ts.map((t) => {
      const late = Math.max(0, Math.round((Date.parse(dateOf(t.done_at)) - Date.parse(t.due)) / 864e5));
      return { task: `t${t.id}`, title: t.title, added: dateOf(t.created_at), due: t.due, done: dateOf(t.done_at), late };
    });
    const late = rows.filter((r) => r.late > 0).length;
    const rate = late / rows.length;
    if (rate < 0.5) continue;
    out.push({ pattern: `added_weekday:${day.toLowerCase()}`, strength: r2(rate * Math.sqrt(rows.length)), observed: false,
      summary: `Tasks added on a ${day} finished after their due date ${late} times in ${rows.length}.`, rows });
  }

  // 4. Inbox age: captures that sit for days without triage.
  const inbox = (db.query("SELECT id, title, created_at FROM tasks WHERE status = 'inbox' ORDER BY created_at").all() as any[])
    .map((t) => ({ task: `t${t.id}`, title: t.title, captured: dateOf(t.created_at), age: Math.floor((now.getTime() - Date.parse(t.created_at)) / 864e5) }));
  const old = inbox.filter((r) => r.age >= 3);
  if (old.length >= 3) out.push({ pattern: "inbox_age", strength: r2(old.length / 4), observed: false,
    summary: `${old.length} inbox captures are older than 3 days (the oldest ${old[0].age} days).`, rows: old.slice(0, 12) });

  // 5. Done-with-evidence rate over the last 30 days.
  const since = new Date(now.getTime() - 30 * 864e5).toISOString();
  const recent = done.filter((t) => t.done_at >= since);
  if (recent.length >= 5) {
    const without = recent.filter((t) => !String(t.evidence ?? "").trim());
    const rate = 1 - without.length / recent.length;
    if (rate < 0.7) out.push({ pattern: "evidence_rate", strength: r2((1 - rate) * Math.sqrt(recent.length)), observed: false,
      summary: `${without.length} of ${recent.length} tasks done in the last 30 days carry no evidence.`,
      rows: without.slice(-12).map((t) => ({ task: `t${t.id}`, title: t.title, area: t.area, done: dateOf(t.done_at) })) });
  }

  // 6. Proposals removed by kind: what the model keeps suggesting that you keep removing.
  let props: any[] = [];
  try {
    props = db.query(`SELECT b.kind, b.date, p.status, p.payload, p.reason FROM ai_proposals p JOIN ai_batches b ON b.id = p.batch_id
      WHERE p.status IN ('kept', 'removed') ORDER BY p.id`).all() as any[];
  } catch { /* no ai tables before schema v6 */ }
  for (const [kind, ps] of group(props, (p) => p.kind)) {
    if (ps.length < 3) continue;
    const removed = ps.filter((p) => p.status === "removed").length;
    const rate = removed / ps.length;
    if (rate < 0.5) continue;
    out.push({ pattern: `proposals_removed:${kind}`, strength: r2(rate * Math.sqrt(ps.length)), observed: false,
      summary: `You removed ${removed} of ${ps.length} ${KIND_LABEL[kind] ?? kind} proposals.`,
      rows: ps.slice(-12).map((p) => { let what = p.reason; try { what = JSON.parse(p.payload)?.title ?? p.reason; } catch {} return { date: p.date, kind, what, status: p.status }; }) });
  }

  const seen = new Set((db.query("SELECT pattern FROM doctrine_observations WHERE pattern IS NOT NULL").all() as any[]).map((r) => r.pattern));
  for (const c of out) c.observed = seen.has(c.pattern);
  return out.sort((a, b) => b.strength - a.strength);
}

// ── settings: the planner's rules live in settings.ai.plan_rules, one rule per line ─────────
const setting = (db: Database, key: string) => (db.query("SELECT value FROM settings WHERE key = ?").get(key) as any)?.value ?? null;
function setSetting(db: Database, key: string, value: string | null, stamp: string) {
  db.query("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(key, value, stamp);
}
const ruleLines = (db: Database) => String(setting(db, "ai.plan_rules") ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
function appendPlanRule(db: Database, text: string, stamp: string) {
  const lines = ruleLines(db);
  if (!lines.includes(text)) lines.push(text);
  setSetting(db, "ai.plan_rules", lines.join("\n"), stamp);
}
function removePlanRule(db: Database, text: string, stamp: string) {
  const lines = ruleLines(db).filter((l) => l !== text);
  setSetting(db, "ai.plan_rules", lines.length ? lines.join("\n") : null, stamp);
}

const numId = (s: unknown) => Number(String(s ?? "").replace(/\D/g, ""));
const shapeObs = (o: any, json: boolean) => ({ id: o.id, week: o.week, status: o.status, text: o.text, rule: o.proposed_rule, pattern: o.pattern,
  evidence: json ? JSON.parse(o.evidence || "[]") : JSON.parse(o.evidence || "[]").length, created_at: o.created_at, decided_at: o.decided_at });

export const doctrine: Module = {
  name: "doctrine",
  help: `agentos doctrine [observations|candidates]   rules the planner obeys, from accepted weekly observations; candidates = what Sunday's job would observe
agentos doctrine accept|decline <id>   accept makes a rule and appends it to ai.plan_rules (Plan my day obeys it at once)
agentos doctrine retire <rule id>      retire a rule and drop it from ai.plan_rules`,
  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS doctrine_observations (id INTEGER PRIMARY KEY, week TEXT NOT NULL, pattern TEXT, text TEXT NOT NULL,
        evidence TEXT NOT NULL DEFAULT '[]', proposed_rule TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, decided_at TEXT);
      CREATE INDEX IF NOT EXISTS doctrine_observations_status ON doctrine_observations(status, week);
      CREATE TABLE IF NOT EXISTS doctrine_rules (id INTEGER PRIMARY KEY, text TEXT NOT NULL, observation_id INTEGER REFERENCES doctrine_observations(id),
        active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, retired_at TEXT);
      CREATE INDEX IF NOT EXISTS doctrine_rules_active ON doctrine_rules(active, id);
    `);
  },
  run(db, a, ctx) {
    const sub = a._[1];
    const stamp = ctx.iso();
    if (!sub || sub === "rules") return listRules(db, ctx);
    if (sub === "observations") {
      const rows = db.query("SELECT * FROM doctrine_observations ORDER BY id DESC LIMIT ?").all(Number(ctx.str(a, "limit") ?? 30)) as any[];
      return ctx.out({ count: rows.length, observations: rows.map((o) => shapeObs(o, ctx.jsonOut)) },
        ["agentos doctrine accept <id>", "agentos doctrine decline <id>", "agentos doctrine candidates"]);
    }
    if (sub === "candidates") {
      const cs = candidates(db, ctx.now());
      return ctx.out({ count: cs.length, week: isoWeek(ctx.istDate()), candidates: cs.map((c) => (ctx.jsonOut ? c : { ...c, rows: c.rows.length })) },
        cs.length ? ["agentos doctrine candidates --json  # with the evidence rows"] : ["Not enough history yet: schedule tasks, mark them done with --evidence, decide on proposals."]);
    }
    if (sub === "accept" || sub === "decline") {
      const id = numId(a._[2]);
      const o = db.query("SELECT * FROM doctrine_observations WHERE id = ?").get(id) as any;
      if (!o) throw new ctx.UserError(`No observation ${a._[2] ?? ""}. List them: agentos doctrine observations`);
      if (o.status !== "open") throw new ctx.UserError(`Observation ${id} was already ${o.status}.`);
      const result = db.transaction(() => {
        db.query("UPDATE doctrine_observations SET status = ?, decided_at = ? WHERE id = ?").run(sub === "accept" ? "accepted" : "declined", stamp, id);
        if (sub !== "accept") return null;
        const text = String(o.proposed_rule ?? o.text).trim();
        const r = db.query("INSERT INTO doctrine_rules (text, observation_id, active, created_at) VALUES (?, ?, 1, ?) RETURNING *").get(text, id, stamp) as any;
        appendPlanRule(db, text, stamp);
        return r;
      })();
      return ctx.out({ ok: true, action: sub === "accept" ? "accepted" : "declined", observation: id,
        ...(result ? { rule: { id: result.id, text: result.text }, plan_rules: setting(db, "ai.plan_rules") } : {}) },
        [sub === "accept" ? "agentos doctrine  # the rules in force" : "agentos doctrine observations"]);
    }
    if (sub === "retire") {
      const id = numId(a._[2]);
      const r = db.query("SELECT * FROM doctrine_rules WHERE id = ?").get(id) as any;
      if (!r) throw new ctx.UserError(`No rule ${a._[2] ?? ""}. List them: agentos doctrine`);
      if (!r.active) throw new ctx.UserError(`Rule ${id} is already retired.`);
      db.transaction(() => {
        db.query("UPDATE doctrine_rules SET active = 0, retired_at = ? WHERE id = ?").run(stamp, id);
        removePlanRule(db, r.text, stamp);
      })();
      return ctx.out({ ok: true, action: "retired", rule: id, plan_rules: setting(db, "ai.plan_rules") }, ["agentos doctrine"]);
    }
    throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos doctrine [observations|candidates|accept <id>|decline <id>|retire <id>]`);
  },
};

function listRules(db: Database, ctx: ModCtx) {
  const rows = db.query(`SELECT r.*, o.text AS observation, o.week FROM doctrine_rules r LEFT JOIN doctrine_observations o ON o.id = r.observation_id
    ORDER BY r.active DESC, r.id DESC`).all() as any[];
  const open = (db.query("SELECT count(*) n FROM doctrine_observations WHERE status = 'open'").get() as any).n;
  ctx.out({
    count: rows.filter((r) => r.active).length, open_observations: open, plan_rules: setting(db, "ai.plan_rules"),
    rules: rows.map((r) => ({ id: r.id, text: r.text, active: !!r.active, since: r.created_at.slice(0, 10), week: r.week,
      observation: r.observation_id, from: r.observation, retired_at: r.retired_at })),
  }, [open ? `agentos doctrine observations  # ${open} waiting for a decision` : "agentos doctrine candidates", "agentos doctrine retire <id>"]);
}

// Bounty board and payroll (big idea 5). `scan` prices recurring work: every task with a repeat rule,
// plus every title key done 3+ times in 60 days, costs minutes per week (real started_at->done_at durations,
// else the estimate) times your hourly value, and lands in bounty_items ranked by payoff per month.
// The phone server's `bounty-board` job (06:30) calls scan; `bounty-payroll` (1st of the month) writes the
// bounty_payroll rows (per runner: runs, kept, removed, tasks done, evidence, quota, value) read here.
//   agentos bounty                   the board, best payoff first
//   agentos bounty scan              refresh the board from tasks
//   agentos bounty rate [<n>]        your hourly value (settings bounty.hourly_rate); falls back to price_rates if that table exists
//   agentos bounty payroll           the payroll lines
//   agentos bounty take <id> [--task t12] | dismiss <id>
import type { Database } from "bun:sqlite";
import type { ModCtx, Module } from "./types";
import { bookKey } from "./runbooks";

const WEEKS_PER_MONTH = 4.3;
const DEFAULT_MINUTES = 30;
const numId = (s: unknown) => Number(String(s ?? "").replace(/\D/g, ""));
const r1 = (n: number) => Math.round(n * 10) / 10;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Times per week a repeat rule fires: 1d, 2w, 1m, 1y, weekdays, days:mon,thu. */
export function timesPerWeek(rule: string | null | undefined): number | null {
  if (!rule) return null;
  if (rule === "weekdays") return 5;
  if (rule.startsWith("days:")) return rule.slice(5).split(",").filter(Boolean).length || null;
  const m = rule.match(/^(\d+)([dwmy])$/);
  if (!m) return null;
  const n = Number(m[1]);
  return r1({ d: 7 / n, w: 1 / n, m: 12 / 52 / n, y: 1 / 52 / n }[m[2]]!);
}

/** The hourly rate: settings bounty.hourly_rate, else the first per-hour number in price_rates (another module's table), else null. */
export function rateOf(db: Database): { rate: number | null; source: string } {
  const s = (db.query("SELECT value FROM settings WHERE key = 'bounty.hourly_rate'").get() as any)?.value;
  if (s != null && Number(s) > 0) return { rate: Number(s), source: "settings" };
  try {
    if (db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'price_rates'").get()) {
      const row = db.query("SELECT * FROM price_rates LIMIT 1").get() as Record<string, unknown> | null;
      const k = row && Object.keys(row).find((c) => /hour|rate/i.test(c) && Number(row[c]) > 0);
      if (row && k) return { rate: Number(row[k]), source: "price_rates" };
    }
  } catch { /* not ours; ignore */ }
  return { rate: null, source: "none" };
}

/** Minutes one pass takes: the median real duration of that key's done tasks, else the estimate, else 30. */
function minutesEach(db: Database, key: string, group: any[], fallback: number | null): { minutes: number; basis: string } {
  const durations = group.filter((t) => t.started_at && t.done_at)
    .map((t) => (Date.parse(t.done_at) - Date.parse(t.started_at)) / 60000).filter((m) => m > 0 && m <= 1440).map((m) => Math.min(m, 480));
  if (durations.length) return { minutes: Math.round(median(durations)), basis: `measured over ${durations.length}` };
  const est = group.map((t) => t.estimate_minutes).filter((m) => m > 0);
  if (est.length) return { minutes: Math.round(est.reduce((a, b) => a + b, 0) / est.length), basis: "estimate" };
  if (fallback && fallback > 0) return { minutes: fallback, basis: "estimate" };
  return { minutes: DEFAULT_MINUTES, basis: "default 30 min" };
}

export function scan(db: Database, stamp: string, now = new Date()) {
  const { rate } = rateOf(db);
  const since = new Date(now.getTime() - 60 * 864e5).toISOString();
  const done = db.query("SELECT id, title, project, area, started_at, done_at, estimate_minutes FROM tasks WHERE status = 'done' AND done_at >= ? ORDER BY done_at").all(since) as any[];
  const doneByKey = new Map<string, any[]>();
  for (const t of done) { const k = bookKey(t.title, t.project); (doneByKey.get(k) ?? doneByKey.set(k, []).get(k)!).push(t); }
  const items = new Map<string, { title: string; area: string | null; source: string; times: number; minutes: number; basis: string }>();
  // 1. Tasks with a repeat rule (the open instance carries the rule; done ones spawned it).
  for (const t of db.query("SELECT id, title, project, area, repeat, estimate_minutes FROM tasks WHERE repeat IS NOT NULL AND status IN ('todo', 'doing') ORDER BY id").all() as any[]) {
    const key = bookKey(t.title, t.project);
    const times = timesPerWeek(t.repeat);
    if (!times || items.has(key)) continue;
    const m = minutesEach(db, key, doneByKey.get(key) ?? [], t.estimate_minutes);
    items.set(key, { title: t.title, area: t.area, source: `repeats ${t.repeat}`, times, minutes: m.minutes, basis: m.basis });
  }
  // 2. Title keys done 3+ times in 60 days without a rule.
  for (const [key, ts] of doneByKey) {
    if (ts.length < 3 || items.has(key)) continue;
    const m = minutesEach(db, key, ts, null);
    items.set(key, { title: ts[ts.length - 1].title, area: ts[ts.length - 1].area, source: `done ${ts.length} times in 60 days`, times: r1(ts.length / (60 / 7)), minutes: m.minutes, basis: m.basis });
  }
  db.transaction(() => {
    for (const [key, it] of items) {
      const perWeek = r1(it.times * it.minutes);
      const payoff = rate ? Math.round((perWeek / 60) * WEEKS_PER_MONTH * rate) : null;
      const cur = db.query("SELECT id FROM bounty_items WHERE key = ?").get(key) as any;
      if (cur) db.query(`UPDATE bounty_items SET title = ?, area = ?, source = ?, times_per_week = ?, minutes_each = ?, minutes_basis = ?, minutes_per_week = ?,
        rate_per_hour = ?, payoff_per_month = ?, updated_at = ? WHERE id = ?`).run(it.title, it.area, it.source, it.times, it.minutes, it.basis, perWeek, rate, payoff, stamp, cur.id);
      else db.query(`INSERT INTO bounty_items (key, title, area, source, times_per_week, minutes_each, minutes_basis, minutes_per_week, rate_per_hour, payoff_per_month, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`).run(key, it.title, it.area, it.source, it.times, it.minutes, it.basis, perWeek, rate, payoff, stamp, stamp);
    }
  })();
  return { rate, items: items.size };
}

const shapeItem = (i: any) => ({ id: i.id, title: i.title, area: i.area, status: i.status, payoff_per_month: i.payoff_per_month, minutes_per_week: i.minutes_per_week,
  times_per_week: i.times_per_week, minutes_each: i.minutes_each, basis: i.minutes_basis, source: i.source, rate_per_hour: i.rate_per_hour,
  task: i.task_id ? `t${i.task_id}` : null, created_at: i.created_at, updated_at: i.updated_at });

export const bounty: Module = {
  name: "bounty",
  help: `agentos bounty [scan|--all]      automation bounties: recurring work priced at minutes per week x your hourly value, best payoff first
agentos bounty rate [<n>]        your hourly value in rupees (settings bounty.hourly_rate); without it the board says "set a rate"
agentos bounty payroll           per runner and month: runs, kept, removed, tasks done, evidence, quota, value
agentos bounty take <id> [--task t12] | dismiss <id>   take marks it taken (the phone server files the Automate task and hands it over)`,
  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS bounty_items (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, area TEXT, source TEXT NOT NULL DEFAULT 'repeat',
        times_per_week REAL, minutes_each REAL, minutes_basis TEXT, minutes_per_week REAL, rate_per_hour REAL, payoff_per_month REAL,
        status TEXT NOT NULL DEFAULT 'open', task_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS bounty_items_status ON bounty_items(status, payoff_per_month);
      CREATE TABLE IF NOT EXISTS bounty_payroll (id INTEGER PRIMARY KEY, runner TEXT NOT NULL, period TEXT NOT NULL, runs INTEGER NOT NULL DEFAULT 0,
        kept INTEGER NOT NULL DEFAULT 0, removed INTEGER NOT NULL DEFAULT 0, tasks_done INTEGER NOT NULL DEFAULT 0, evidence_verified INTEGER NOT NULL DEFAULT 0,
        quota_estimate REAL, value_estimate REAL, note TEXT, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS bounty_payroll_period ON bounty_payroll(runner, period);
    `);
  },
  run(db, a, ctx) {
    const sub = a._[1];
    const stamp = ctx.iso();
    if (!sub) return board(db, ctx, !!a.flags.all);
    if (sub === "scan") {
      const r = scan(db, stamp, ctx.now());
      return ctx.out({ ok: true, rate: r.rate, items: r.items }, [r.rate ? "agentos bounty" : "agentos bounty rate <rupees per hour>  # then the board shows payoffs"]);
    }
    if (sub === "rate") {
      const v = a._[2];
      if (v !== undefined) {
        const n = Number(String(v).replace(/[^\d.]/g, ""));
        if (!Number.isFinite(n) || n <= 0) throw new ctx.UserError("Give rupees per hour, like: agentos bounty rate 800");
        db.query("INSERT INTO settings (key, value, updated_at) VALUES ('bounty.hourly_rate', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(String(n), stamp);
        scan(db, stamp, ctx.now());
      }
      const r = rateOf(db);
      return ctx.out({ ok: true, rate: r.rate, source: r.source }, [r.rate ? "agentos bounty" : "agentos bounty rate 800"]);
    }
    if (sub === "payroll") {
      const rows = db.query("SELECT * FROM bounty_payroll ORDER BY period DESC, value_estimate DESC, runner").all() as any[];
      return ctx.out({ count: rows.length, rows: rows.map((r) => ({ period: r.period, runner: r.runner, runs: r.runs, kept: r.kept, removed: r.removed,
        kept_rate: r.kept + r.removed ? Math.round((100 * r.kept) / (r.kept + r.removed)) : null, tasks_done: r.tasks_done, evidence_verified: r.evidence_verified,
        quota_estimate: r.quota_estimate, value_estimate: r.value_estimate, note: r.note })) },
        rows.length ? ["agentos ai  # the retire proposals land as a batch of kind bounty"] : ["The phone server writes payroll on the 1st of the month (bounty-payroll job)."]);
    }
    if (sub === "take" || sub === "dismiss") {
      const id = numId(a._[2]);
      const it = db.query("SELECT * FROM bounty_items WHERE id = ?").get(id) as any;
      if (!it) throw new ctx.UserError(`No bounty ${a._[2] ?? ""}. List them: agentos bounty`);
      if (it.status !== "open") throw new ctx.UserError(`Bounty ${id} is already ${it.status}.`);
      const task = ctx.str(a, "task") ? numId(ctx.str(a, "task")) : null;
      db.query("UPDATE bounty_items SET status = ?, task_id = coalesce(?, task_id), updated_at = ? WHERE id = ?").run(sub === "take" ? "taken" : "dismissed", task, stamp, id);
      return ctx.out({ ok: true, action: sub === "take" ? "taken" : "dismissed", item: shapeItem(db.query("SELECT * FROM bounty_items WHERE id = ?").get(id)) }, ["agentos bounty"]);
    }
    throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos bounty [scan|rate <n>|payroll|take <id>|dismiss <id>]`);
  },
};

function board(db: Database, ctx: ModCtx, all: boolean) {
  const { rate, source } = rateOf(db);
  const rows = db.query(`SELECT * FROM bounty_items ${all ? "" : "WHERE status IN ('open', 'taken')"}
    ORDER BY status = 'open' DESC, payoff_per_month IS NULL, payoff_per_month DESC, minutes_per_week DESC`).all() as any[];
  ctx.out({ rate, rate_source: source, note: rate ? null : "set a rate: agentos bounty rate <rupees per hour>", count: rows.length, items: rows.map(shapeItem) },
    [rate ? "agentos bounty take <id>" : "agentos bounty rate 800", "agentos bounty scan", "agentos bounty payroll"]);
}

// The OS redesigns itself from your thumbs (big idea 10). The phone app records taps and key presses
// per screen (app/modules/thumbs.js in the phone repo: target selector, never a value) and the phone
// server stores them here. Once a month the server turns the last 30 days into three UI proposals
// with mockups; this module owns the tables and prints the numbers the proposals are grounded on.
//   agentos thumbs [--days 30]        taps per screen, hesitation, dead screens, rejected proposal kinds
//   agentos thumbs proposals [--all]  the monthly UI proposals (open ones by default) and their mockup paths
import type { Database } from "bun:sqlite";
import type { Args, ModCtx, Module } from "./types";

const TABS = ["today", "tasks", "goals", "areas", "life", "more"];

export const thumbs: Module = {
  name: "thumbs",
  help: `agentos thumbs [--days 30]       what the phone app's thumbs did: taps per screen, hesitation, dead screens
agentos thumbs proposals [--all] the monthly UI proposals (title, reason, numbers, mockup path, status)`,
  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS thumbs_events (id INTEGER PRIMARY KEY, at TEXT NOT NULL, tab TEXT, target TEXT, hesitation_ms INTEGER, user_id INTEGER);
      CREATE INDEX IF NOT EXISTS thumbs_events_at ON thumbs_events(at);
      CREATE TABLE IF NOT EXISTS thumbs_proposals (id INTEGER PRIMARY KEY, month TEXT NOT NULL, title TEXT NOT NULL, reason TEXT, numbers TEXT,
        mockup_path TEXT, status TEXT NOT NULL DEFAULT 'open', task_id INTEGER, created_at TEXT NOT NULL, decided_at TEXT);
      CREATE INDEX IF NOT EXISTS thumbs_proposals_month ON thumbs_proposals(month, status);
    `);
  },
  run(db, a, ctx) {
    const sub = a._[1];
    if (sub === "proposals") return proposals(db, a, ctx);
    if (sub) throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos thumbs [proposals]`);
    const days = Number(ctx.str(a, "days") ?? 30);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new ctx.UserError("--days takes 1 to 365.");
    const s = summarize(db, days, ctx.now());
    if (!s.events) {
      return ctx.out({ ...s, note: "No taps recorded yet. Open the phone app; it records which screens you use (never what you type)." },
        ["agentos thumbs proposals"]);
    }
    ctx.out(s, ["agentos thumbs proposals", "agentos thumbs --days 7"]);
  },
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** The last `days` days of taps, as the numbers a proposal is grounded on. Pure SQL plus a little counting. */
export function summarize(db: Database, days: number, now = new Date()) {
  const since = new Date(now.getTime() - days * 864e5).toISOString();
  const rows = db.query("SELECT at, tab, target, hesitation_ms FROM thumbs_events WHERE at >= ? ORDER BY at").all(since) as any[];
  const screens = new Map<string, { taps: number; days: Set<string>; hes: number[]; targets: Map<string, number> }>();
  const targets = new Map<string, number>();
  for (const r of rows) {
    const tab = String(r.tab ?? "?"), day = String(r.at).slice(0, 10);
    const s = screens.get(tab) ?? { taps: 0, days: new Set<string>(), hes: [], targets: new Map() };
    s.taps++;
    s.days.add(day);
    if (r.hesitation_ms != null) s.hes.push(Number(r.hesitation_ms));
    const t = String(r.target ?? "?");
    s.targets.set(t, (s.targets.get(t) ?? 0) + 1);
    targets.set(`${tab} ${t}`, (targets.get(`${tab} ${t}`) ?? 0) + 1);
    screens.set(tab, s);
  }
  const seen = new Set((db.query("SELECT DISTINCT tab FROM thumbs_events WHERE at >= ?").all(new Date(now.getTime() - 90 * 864e5).toISOString()) as any[]).map((r) => String(r.tab)));
  const known = [...new Set([...TABS, ...seen])];
  const screenRows = [...screens].map(([tab, s]) => ({
    tab, taps: s.taps, days: s.days.size, hesitation_ms: median(s.hes), opens: s.hes.length,
    top: [...s.targets].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([t, n]) => `${t} ×${n}`).join(", "),
  })).sort((x, y) => y.taps - x.taps);
  const dead = known.filter((t) => !screens.has(t));
  const hesitation = screenRows.filter((s) => s.hesitation_ms != null && s.opens >= 3).sort((x, y) => (y.hesitation_ms ?? 0) - (x.hesitation_ms ?? 0)).slice(0, 5)
    .map((s) => ({ tab: s.tab, hesitation_ms: s.hesitation_ms, opens: s.opens }));
  let rejected: { kind: string; removed: number; kept: number }[] = [];
  try {
    const rj = db.query(`SELECT kind, sum(status = 'removed') removed, sum(status = 'kept') kept FROM ai_proposals
      WHERE decided_at >= ? AND status IN ('removed', 'kept') GROUP BY kind ORDER BY removed DESC, kept`).all(since) as any[];
    rejected = rj.map((r) => ({ kind: r.kind, removed: Number(r.removed), kept: Number(r.kept) }));
  } catch { /* an older core schema without ai_proposals */ }
  const pr = db.query("SELECT status, count(*) n FROM thumbs_proposals GROUP BY status").all() as any[];
  const proposalCounts: Record<string, number> = {};
  for (const r of pr) proposalCounts[r.status] = Number(r.n);
  const activeDays = new Set(rows.map((r) => String(r.at).slice(0, 10))).size;
  return {
    days, since: since.slice(0, 10), events: rows.length, activeDays,
    screens: screenRows, dead,
    targets: [...targets].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([target, taps]) => ({ target, taps })),
    hesitation, rejected, proposals: proposalCounts,
  };
}

function proposals(db: Database, a: Args, ctx: ModCtx) {
  const where = a.flags.all ? "" : "WHERE status = 'open'";
  const rows = (db.query(`SELECT * FROM thumbs_proposals ${where} ORDER BY created_at DESC, id`).all() as any[]).map(shapeProposal);
  ctx.out({ count: rows.length, proposals: ctx.jsonOut ? rows : rows.map((p) => ({ id: p.id, month: p.month, status: p.status, title: p.title, task: p.task ?? "" })) },
    rows.length ? ["agentos thumbs proposals --json  # reasons, numbers and mockup paths"] : ["agentos thumbs proposals --all"]);
}
export function shapeProposal(p: any) {
  let numbers: string[] = [];
  try { const v = JSON.parse(p.numbers ?? "[]"); numbers = Array.isArray(v) ? v.map(String) : []; } catch {}
  return { id: `u${p.id}`, month: p.month, title: p.title, reason: p.reason ?? "", numbers, mockup: p.mockup_path ?? null, status: p.status,
    task: p.task_id ? `t${p.task_id}` : null, createdAt: p.created_at, decidedAt: p.decided_at ?? null };
}

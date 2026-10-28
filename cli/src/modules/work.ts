// Work (v2): the tables behind the Work app's offline store, read by the phone server's work module
// (phone/server/modules/work*.ts) through /api/v1/mod/work/reviews and /night.
//   work_reviews  what he did with each changed file of a job: { job, path, mark: kept | reverted | null, turn, blob, noted }
//   work_night    the night shift's queue: { date (the evening it runs, IST), state: queued | started | failed | skipped |
//                 cancelled, job, task, project, engine } + data: title, prompt, model, effort, mode, worktree, error, startedAt
// Both have exactly the shape of the server's collectionDDL() (id, data, created_at, updated_at, deleted_at, rev + columns).
//   agentos work                          tonight's queue and the review marks, counted
//   agentos work night [--date YYYY-MM-DD]   night rows (not deleted), newest evening first
//   agentos work reviews <job>            a job's file marks (job: j12 or 12)
import type { Database } from "bun:sqlite";
import type { Args, ModCtx, Module } from "./types";

/** The server's collectionDDL() output for both tables, character for character (work.test.ts checks it). */
export const WORK_DDL = {
  reviews: `CREATE TABLE IF NOT EXISTS work_reviews (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  job TEXT,
  path TEXT,
  mark TEXT,
  turn INTEGER,
  blob TEXT,
  noted INTEGER
);
CREATE INDEX IF NOT EXISTS work_reviews_rev ON work_reviews(rev);`,
  night: `CREATE TABLE IF NOT EXISTS work_night (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  date TEXT,
  state TEXT,
  job TEXT,
  task TEXT,
  project TEXT,
  engine TEXT
);
CREATE INDEX IF NOT EXISTS work_night_rev ON work_night(rev);`,
};
/** The same specs the server mounts (phone/server/modules/work-store.ts). */
export const WORK_SPECS = {
  reviews: { table: "work_reviews", columns: { job: "text", path: "text", mark: "text", turn: "integer", blob: "text", noted: "bool" } },
  night: { table: "work_night", columns: { date: "text", state: "text", job: "text", task: "text", project: "text", engine: "text" } },
} as const;

export function migrateWork(db: Database) {
  db.exec(WORK_DDL.reviews);
  db.exec(WORK_DDL.night);
}

/** A row as the phone's store sees it: the data fields, then the columns (bools as booleans). */
function toDoc(kind: keyof typeof WORK_SPECS, r: any) {
  let rest: Record<string, unknown> = {};
  try { rest = JSON.parse(r.data ?? "{}"); } catch {}
  const doc: Record<string, unknown> = { ...rest, id: r.id, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at ?? null };
  for (const [k, t] of Object.entries(WORK_SPECS[kind].columns)) doc[k] = r[k] == null ? null : t === "bool" ? !!r[k] : r[k];
  return doc;
}
export function nightRows(db: Database, date?: string) {
  const rows = (date
    ? db.query("SELECT * FROM work_night WHERE deleted_at IS NULL AND date = ? ORDER BY created_at, rev").all(date)
    : db.query("SELECT * FROM work_night WHERE deleted_at IS NULL ORDER BY date DESC, created_at, rev").all()) as any[];
  return rows.map((r) => toDoc("night", r));
}
export function reviewRows(db: Database, job: string) {
  const n = Number(job.slice(1));
  return (db.query("SELECT * FROM work_reviews WHERE deleted_at IS NULL AND job IN (?, ?) ORDER BY path, rev").all(`j${n}`, String(n)) as any[]).map((r) => toDoc("reviews", r));
}
const jobKey = (v: unknown) => { const m = /^j?(\d+)$/i.exec(String(v ?? "").trim()); return m && Number(m[1]) > 0 ? `j${Number(m[1])}` : null; };
/** A real calendar day as YYYY-MM-DD (not 2026-02-30 or 2026-13-01). */
const isDay = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};

export const work: Module = {
  name: "work",
  help: `agentos work                         tonight's night shift and the review marks, counted
agentos work night [--date YYYY-MM-DD]   the night shift's rows (queued, started, failed, skipped, cancelled)
agentos work reviews <job>           a job's file marks from the Changes page (kept, reverted)`,
  migrate: migrateWork,
  run(db, a: Args, ctx: ModCtx) {
    const sub = a._[1];
    if (sub === "night") {
      const date = ctx.str(a, "date");
      if (a.flags.date !== undefined && !(date && isDay(date))) throw new ctx.UserError("--date is YYYY-MM-DD, like --date 2026-10-22.");
      const night = nightRows(db, date);
      return ctx.out({ date: date ?? null, count: night.length, night }, ["agentos work reviews <job>"]);
    }
    if (sub === "reviews") {
      const job = jobKey(a._[2]);
      if (!job) throw new ctx.UserError("Which job? agentos work reviews j12");
      const reviews = reviewRows(db, job);
      return ctx.out({ job, count: reviews.length, reviews }, [`agentos job show ${job}`]);
    }
    if (sub) throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos work [night [--date YYYY-MM-DD] | reviews <job>]`);
    const today = ctx.istDate();
    const tonight = nightRows(db, today);
    const marks = (db.query("SELECT mark, count(*) AS n FROM work_reviews WHERE deleted_at IS NULL GROUP BY mark").all() as any[]);
    const by = (m: string | null) => marks.find((x) => (x.mark ?? null) === m)?.n ?? 0;
    ctx.out({
      tonight: { date: today, queued: tonight.filter((r) => r.state === "queued").length, started: tonight.filter((r) => r.state === "started").length, total: tonight.length },
      reviews: { kept: by("kept"), reverted: by("reverted"), unmarked: by(null) },
    }, ["agentos work night", "agentos work reviews <job>"]);
  },
};

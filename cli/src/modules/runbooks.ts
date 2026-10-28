// Runbooks from evidence (big idea 6). A task title done twice or more with evidence becomes a draft
// runbook: `scan` groups done tasks by a normalized title key (and project), upserts runbooks_books and
// writes the evidence trail as placeholder steps (one per pass). The phone server's hourly
// `runbooks-scan` job calls this, then has Haiku order the trail into real steps with the exact
// commands seen. The user marks a book `ready`; then Run (on the phone or desktop) files a task
// "Run: <title>" and hands it to the agent with the runbook as the brief.
//   agentos runbooks                 the books (draft/ready, times done, steps)
//   agentos runbooks show <id>       one book with its steps and runs
//   agentos runbooks scan            group done tasks, refresh the books, reconcile runs
//   agentos runbooks ready|draft <id>, agentos runbooks today [--date d]  (open tasks that match a ready book)
import type { Database } from "bun:sqlite";
import type { ModCtx, Module } from "./types";

/** Title -> grouping key: lowercase, no urls, ids (t12, #34), versions (v2, 1.2.3), dates or bare numbers, punctuation folded. */
export function normKey(title: string): string {
  return String(title).toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\b[tgblp]\d+\b/g, " ")
    .replace(/#\d+\b/g, " ")
    .replace(/\bv?\d+(\.\d+)+\b/g, " ")
    .replace(/\bv\d+\b/g, " ")
    .replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?\b/g, " ")
    .replace(/\b\d+(?:st|nd|rd|th)?\b/g, " ")
    .replace(/[^a-zऀ-ॿ]+/g, " ")
    .replace(/\s+/g, " ").trim();
}
export const bookKey = (title: string, project: string | null | undefined) => `${project ?? ""}|${normKey(title)}`;

const numId = (s: unknown) => Number(String(s ?? "").replace(/\D/g, ""));
const steps = (db: Database, bookId: number) => (db.query("SELECT * FROM runbooks_steps WHERE book_id = ? ORDER BY n, id").all(bookId) as any[])
  .map((s) => ({ n: s.n, text: s.text, command: s.command, task: s.task_id ? `t${s.task_id}` : null, ok: !!s.ok, note: s.note }));
const runs = (db: Database, bookId: number) => (db.query("SELECT * FROM runbooks_runs WHERE book_id = ? ORDER BY id DESC LIMIT 10").all(bookId) as any[])
  .map((r) => ({ id: r.id, task: r.task_id ? `t${r.task_id}` : null, job: r.job_id, started_at: r.started_at, finished_at: r.finished_at, result: r.result }));
const shapeBook = (b: any, db: Database) => ({ id: b.id, title: b.title, status: b.status, project: b.project, area: b.area, times_done: b.times_done,
  last_done_at: b.last_done_at, steps: (db.query("SELECT count(*) n FROM runbooks_steps WHERE book_id = ?").get(b.id) as any).n,
  needs_assembly: b.status === "draft" && b.times_done > b.assembled_times, updated_at: b.updated_at });

/** Group done-with-evidence tasks by key, upsert the books, seed trail steps, reconcile runs. Exported for the test and the server. */
export function scan(db: Database, stamp: string) {
  const done = db.query("SELECT id, title, project, area, notes, evidence, done_at FROM tasks WHERE status = 'done' AND done_at IS NOT NULL AND trim(coalesce(evidence, '')) != '' ORDER BY done_at").all() as any[];
  const groups = new Map<string, any[]>();
  for (const t of done) { const k = bookKey(t.title, t.project); (groups.get(k) ?? groups.set(k, []).get(k)!).push(t); }
  const books: any[] = [];
  db.transaction(() => {
    for (const [key, ts] of groups) {
      if (ts.length < 2 || !normKey(ts[0].title)) continue;
      const last = ts[ts.length - 1];
      let b = db.query("SELECT * FROM runbooks_books WHERE key = ?").get(key) as any;
      if (b) {
        db.query("UPDATE runbooks_books SET times_done = ?, last_done_at = ?, area = coalesce(?, area), updated_at = ? WHERE id = ?").run(ts.length, last.done_at, last.area, stamp, b.id);
      } else {
        b = db.query(`INSERT INTO runbooks_books (key, title, project, area, times_done, last_done_at, status, assembled_times, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?) RETURNING *`).get(key, last.title, last.project, last.area, ts.length, last.done_at, stamp, stamp) as any;
      }
      b = db.query("SELECT * FROM runbooks_books WHERE id = ?").get(b.id) as any;
      // The trail: one placeholder step per pass until the model orders them (never touches a book that has real steps).
      const has = (db.query("SELECT count(*) n FROM runbooks_steps WHERE book_id = ?").get(b.id) as any).n;
      if (!has) ts.forEach((t, i) => db.query("INSERT INTO runbooks_steps (book_id, n, text, command, task_id, ok, note) VALUES (?, ?, ?, NULL, ?, 1, ?)")
        .run(b.id, i + 1, `Pass ${i + 1}: ${t.title}`, t.id, t.evidence));
      books.push({ ...shapeBook(b, db), trail: ts.map((t) => ({ task: `t${t.id}`, title: t.title, done_at: t.done_at, evidence: t.evidence, notes: t.notes })) });
    }
    // Runs: a run is finished when its task is done (result = the evidence) or dropped.
    for (const r of db.query("SELECT r.id, t.status, t.done_at, t.updated_at, t.evidence FROM runbooks_runs r JOIN tasks t ON t.id = r.task_id WHERE r.finished_at IS NULL").all() as any[]) {
      if (r.status === "done") db.query("UPDATE runbooks_runs SET finished_at = ?, result = ? WHERE id = ?").run(r.done_at, r.evidence || "done", r.id);
      else if (r.status === "dropped") db.query("UPDATE runbooks_runs SET finished_at = ?, result = 'dropped' WHERE id = ?").run(r.updated_at, r.id);
    }
  })();
  return { groups: groups.size, books };
}

/** Open tasks on the day (due, overdue, doing or scheduled) whose key matches a ready book: the Today card. */
export function matches(db: Database, date: string) {
  const ready = db.query("SELECT id, key, title FROM runbooks_books WHERE status = 'ready'").all() as any[];
  if (!ready.length) return [];
  const byKey = new Map(ready.map((b) => [b.key, b]));
  const open = db.query(`SELECT id, title, project, status, due FROM tasks WHERE status IN ('todo', 'doing')
    AND (due <= ?1 OR substr(start_at, 1, 10) = ?1 OR status = 'doing') ORDER BY due, id`).all(date) as any[];
  return open.flatMap((t) => { const b = byKey.get(bookKey(t.title, t.project)); return b ? [{ task: `t${t.id}`, title: t.title, status: t.status, due: t.due, book: b.id, book_title: b.title }] : []; });
}

export const runbooks: Module = {
  name: "runbooks",
  help: `agentos runbooks [show <id>]     runbooks assembled from tasks done twice with evidence (draft until you mark them ready)
agentos runbooks scan            group done tasks by title, refresh the books and their evidence trail
agentos runbooks ready|draft <id>, agentos runbooks today   mark a book ready; open tasks today that match a ready book`,
  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS runbooks_books (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, title TEXT NOT NULL, project TEXT, area TEXT,
        times_done INTEGER NOT NULL DEFAULT 0, last_done_at TEXT, status TEXT NOT NULL DEFAULT 'draft', assembled_times INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runbooks_steps (id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES runbooks_books(id) ON DELETE CASCADE,
        n INTEGER NOT NULL, text TEXT NOT NULL, command TEXT, task_id INTEGER, ok INTEGER NOT NULL DEFAULT 1, note TEXT);
      CREATE INDEX IF NOT EXISTS runbooks_steps_book ON runbooks_steps(book_id, n);
      CREATE TABLE IF NOT EXISTS runbooks_runs (id INTEGER PRIMARY KEY, book_id INTEGER NOT NULL REFERENCES runbooks_books(id) ON DELETE CASCADE,
        task_id INTEGER, job_id TEXT, started_at TEXT NOT NULL, finished_at TEXT, result TEXT);
      CREATE INDEX IF NOT EXISTS runbooks_runs_book ON runbooks_runs(book_id, id);
    `);
  },
  run(db, a, ctx) {
    const sub = a._[1];
    const stamp = ctx.iso();
    if (!sub) {
      const rows = (db.query("SELECT * FROM runbooks_books ORDER BY status = 'ready' DESC, last_done_at DESC").all() as any[]).map((b) => shapeBook(b, db));
      return ctx.out({ count: rows.length, books: rows }, ["agentos runbooks show <id>", "agentos runbooks scan", "agentos runbooks ready <id>"]);
    }
    if (sub === "scan") {
      const r = scan(db, stamp);
      return ctx.out({ ok: true, groups: r.groups, count: r.books.length, books: r.books.map((b) => (ctx.jsonOut ? b : { ...b, trail: b.trail.length })) },
        r.books.length ? ["agentos runbooks show <id>"] : ["No title has been done twice with evidence yet: agentos done <id> --evidence \"<proof>\""]);
    }
    if (sub === "today") {
      const date = ctx.str(a, "date") ?? ctx.istDate();
      return ctx.out({ date, matches: matches(db, date) }, ["agentos runbooks"]);
    }
    const id = numId(a._[2]);
    const b = db.query("SELECT * FROM runbooks_books WHERE id = ?").get(id) as any;
    if (["show", "ready", "draft"].includes(sub) && !b) throw new ctx.UserError(`No runbook ${a._[2] ?? ""}. List them: agentos runbooks`);
    if (sub === "show") return showBook(db, b, ctx);
    if (sub === "ready" || sub === "draft") {
      if (sub === "ready" && !(db.query("SELECT count(*) n FROM runbooks_steps WHERE book_id = ?").get(id) as any).n)
        throw new ctx.UserError(`Runbook ${id} has no steps yet. Run: agentos runbooks scan`);
      db.query("UPDATE runbooks_books SET status = ?, updated_at = ? WHERE id = ?").run(sub, stamp, id);
      return showBook(db, db.query("SELECT * FROM runbooks_books WHERE id = ?").get(id), ctx, true);
    }
    throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos runbooks [show <id>|scan|ready <id>|draft <id>|today]`);
  },
};

function showBook(db: Database, b: any, ctx: ModCtx, wrote = false) {
  ctx.out({ ...(wrote ? { ok: true } : {}), book: shapeBook(b, db), steps: steps(db, b.id), runs: runs(db, b.id) },
    [b.status === "ready" ? `agentos runbooks draft ${b.id}` : `agentos runbooks ready ${b.id}`, "agentos runbooks"]);
}

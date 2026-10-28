// Seeds a COPY of the agentos db with the history the knowing modules feed on (repeat tasks, titles done
// twice with evidence, skipped 06:00 blocks, decided proposals, old inbox captures). Never the live db.
//   bun scripts/seed-knowing.ts test\agentos.db
import { Database } from "bun:sqlite";

const path = process.argv[2];
if (!path || /[\\/]\.agentos[\\/]agentos\.db$/i.test(path)) { console.error("Give the path of a COPY: bun scripts/seed-knowing.ts test\\agentos.db"); process.exit(2); }
const db = new Database(path);
db.exec("PRAGMA foreign_keys = ON");
if (db.query("SELECT 1 FROM settings WHERE key = 'knowing.seeded'").get()) { console.log("already seeded"); process.exit(0); }

const now = new Date();
const at = (daysAgo: number, hhmmIst = "10:00") => {
  const d = new Date(now.getTime() - daysAgo * 864e5).toISOString().slice(0, 10);
  return new Date(Date.parse(`${d}T${hhmmIst}:00+05:30`)).toISOString();
};
const date = (daysAgo: number) => new Date(now.getTime() + 330 * 60000 - daysAgo * 864e5).toISOString().slice(0, 10);
type T = { title: string; status?: string; area?: string | null; notes?: string | null; evidence?: string | null; due?: string | null; start_at?: string | null; end_at?: string | null;
  started_at?: string | null; done_at?: string | null; estimate_minutes?: number | null; repeat?: string | null; created_at?: string; source?: string };
const ins = db.query(`INSERT INTO tasks (title, notes, area, status, priority, due, start_at, end_at, owner, source, evidence, created_at, updated_at, done_at, started_at, estimate_minutes, repeat)
  VALUES (?, ?, ?, ?, 2, ?, ?, ?, 'me', ?, ?, ?, ?, ?, ?, ?, ?)`);
const task = (t: T) => ins.run(t.title, t.notes ?? null, t.area ?? null, t.status ?? "todo", t.due ?? null, t.start_at ?? null, t.end_at ?? null, t.source ?? "seed", t.evidence ?? null,
  t.created_at ?? t.started_at ?? t.done_at ?? at(1), t.done_at ?? t.created_at ?? at(1), t.done_at ?? null, t.started_at ?? null, t.estimate_minutes ?? null, t.repeat ?? null);

db.transaction(() => {
  // Runbooks: the iOS build was done once for real (t2 in the live db); a second pass with evidence makes it a runbook.
  task({ title: "Agentic OS: iOS build via GitHub (2nd account), install and test", area: "projects", status: "done", started_at: at(6, "20:00"), done_at: at(6, "21:40"), created_at: at(7),
    notes: "Use the 2nd GitHub account (example-builds); bump the build number first.",
    evidence: "https://github.com/example-builds/agentic-os-app/actions/runs/1000000001 (build 2 uploaded to TestFlight; signing failed on the first run, fixed by re-setting the signing secrets, then re-run)" });
  task({ title: "Publish the Harborline showcase deck", area: "northwind", status: "done", started_at: at(12, "15:00"), done_at: at(12, "15:50"), created_at: at(12),
    evidence: "~/harborline-showcase/deck/index.html, pushed with git push origin main, live at https://harborline-demo.your-server.example" });
  task({ title: "Publish the Harborline showcase deck (v2)", area: "northwind", status: "done", started_at: at(3, "11:00"), done_at: at(3, "11:35"), created_at: at(3),
    notes: "Cloudflare Pages picks up main by itself.",
    evidence: "git push origin main (commit 4f21c0a); https://harborline-demo.your-server.example shows 17 slides" });
  // Bounty: a daily reel, a weekly backup with three timed passes, and orders reconciled four times without a rule.
  task({ title: "Post the daily reel", area: "content", repeat: "1d", estimate_minutes: 20, due: date(0), created_at: at(1) });
  task({ title: "Backup the shop database", area: "morgan-co", repeat: "1w", estimate_minutes: 15, due: date(-2), created_at: at(1) });
  for (const [d, mins] of [[21, 14], [14, 18], [7, 16]] as const) task({ title: "Backup the shop database", area: "morgan-co", status: "done", started_at: at(d, "21:00"), done_at: new Date(Date.parse(at(d, "21:00")) + mins * 60000).toISOString(), evidence: "~/backups/store-tally.bak" });
  for (const [d, mins] of [[40, 25], [26, 31], [13, 22], [5, 27]] as const) task({ title: "Reconcile Corner Market orders", area: "corner-market", status: "done", started_at: at(d, "22:00"), done_at: new Date(Date.parse(at(d, "22:00")) + mins * 60000).toISOString(), evidence: "Shopify orders export matched to Tally" });
  // Doctrine: six 06:00 gym blocks over two weeks, five of them not done that day.
  for (let i = 1; i <= 6; i++) {
    const d = 2 * i;
    const done = i === 3;
    task({ title: "Gym (06:00 block)", area: "personal", status: done ? "done" : "dropped", start_at: at(d, "06:00"), end_at: at(d, "07:00"), created_at: at(d + 1), done_at: done ? at(d, "07:05") : null });
  }
  // Inbox captures that sat for days.
  for (const [t, d] of [["Call the printer about the store catalog", 6], ["Try the new Codex image model for the Ledgerly logo", 5], ["Ask Dad about the Diwali stock plan", 4], ["Read the college exam schedule mail", 9]] as const)
    task({ title: t, status: "inbox", created_at: at(d), source: "capture" });
  // Decided proposals: two past plans, mostly removed.
  const batch = db.query("INSERT INTO ai_batches (kind, date, summary, model, ms, status, created_at, decided_at) VALUES (?, ?, ?, ?, ?, 'decided', ?, ?) RETURNING id");
  const prop = db.query("INSERT INTO ai_proposals (batch_id, kind, task_id, payload, reason, status, created_at, decided_at) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)");
  for (const [d, kept, removed] of [[9, 1, 3], [4, 0, 4]] as const) {
    const b = (batch.get("plan", date(d), "A full day: client work first, then the shop.", "Sonnet", 8200, at(d, "07:00"), at(d, "07:10")) as any).id;
    for (let i = 0; i < kept + removed; i++) prop.run(b, "place", JSON.stringify({ title: ["Harborline quote", "Pulse Chat bug hunt", "Reels edit", "Atlas ERP"][i] }), "", i < kept ? "kept" : "removed", at(d, "07:00"), at(d, "07:10"));
  }
  db.query("INSERT INTO settings (key, value, updated_at) VALUES ('knowing.seeded', '1', ?)").run(now.toISOString());
})();
console.log(`seeded ${path}: tasks=${(db.query("SELECT count(*) n FROM tasks").get() as any).n}, batches=${(db.query("SELECT count(*) n FROM ai_batches").get() as any).n}`);
db.close();

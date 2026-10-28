// Runbooks from evidence (big idea 6). Every hour the job runs `agentos runbooks scan` (titles done
// twice or more with evidence become draft books carrying their evidence trail), then has Haiku turn
// each new trail into ordered steps with the exact commands, accounts and URLs seen and where it
// failed. The user marks a book ready; Run files a task "Run: <title>" and hands it to the agent
// with the runbook as the brief (ai.give, mode edit, confirm on; a dry run under MOD_DRY_RUN=1).
//   GET  /books, GET /books/:id, GET /today (open tasks today that match a ready book)
//   PATCH /books/:id { status?: "ready"|"draft", steps?: [{ text, command?, ok, note?, task? }] }   (owner)
//   POST /books/:id/run, POST /scan   (owner)
import type { Database } from "bun:sqlite";
import type { JobCtx, Module } from "./types";
import { dryRun, giveTask, isRetired, numId, workspaceFor } from "./knowing-shared";

const RUNNER = "job:runbooks:runbooks-scan";
const MAX_ASSEMBLE = 3;   // Haiku calls per scan
const STEP_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array", maxItems: 20,
      items: { type: "object", properties: { text: { type: "string" }, command: { type: "string" }, ok: { type: "boolean" }, note: { type: "string" }, task: { type: "string" } }, required: ["text", "ok"] },
    },
  },
  required: ["steps"],
};
const SYSTEM = `You turn the evidence trail of a task that was done several times into a runbook: the ordered steps to do it again.
Input: the passes (task id, title, date, evidence string, notes). Output "steps": 3 to 12 steps in the order they happen.
"text": one imperative line under 20 words. "command": the exact command, URL, path, account or file seen in the evidence, verbatim; omit it when none is seen.
"ok": false for a step that failed on some pass, with "note" saying what went wrong and what fixed it. "task": the task id (like t12) of the pass the step comes from, when one pass shows it.
Use only what the evidence and notes say. Never invent commands, accounts or URLs.`;

type Step = { text: string; command?: string | null; ok: boolean; note?: string | null; task?: string | null };
export function cleanSteps(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((s) => s && typeof s.text === "string" && s.text.trim()).slice(0, 20).map((s) => ({
    text: String(s.text).trim().slice(0, 300), command: s.command ? String(s.command).trim().slice(0, 500) : null,
    ok: s.ok !== false, note: s.note ? String(s.note).trim().slice(0, 500) : null, task: /^t\d+$/.test(String(s.task ?? "")) ? String(s.task) : null,
  }));
}
function writeSteps(db: Database, bookId: number, steps: Step[], stamp: string) {
  db.transaction(() => {
    db.query("DELETE FROM runbooks_steps WHERE book_id = ?").run(bookId);
    const ins = db.query("INSERT INTO runbooks_steps (book_id, n, text, command, task_id, ok, note) VALUES (?, ?, ?, ?, ?, ?, ?)");
    steps.forEach((s, i) => ins.run(bookId, i + 1, s.text, s.command ?? null, s.task ? numId(s.task) : null, s.ok ? 1 : 0, s.note ?? null));
    db.query("UPDATE runbooks_books SET updated_at = ? WHERE id = ?").run(stamp, bookId);
  })();
}

/** The hourly job (and POST /scan): refresh the books through the CLI, then assemble steps for new trails. */
export async function scan(ctx: JobCtx, opts: { force?: boolean } = {}) {
  if (!opts.force && isRetired(ctx, RUNNER)) { ctx.log("retired by payroll, skipping"); return { skipped: "retired", books: [], assembled: 0 }; }
  const r = await ctx.agentos(["runbooks", "scan"]);
  const db = ctx.db();
  let assembled = 0;
  const errors: string[] = [];
  for (const b of r.books ?? []) {
    if (!b.needs_assembly || assembled >= MAX_ASSEMBLE) continue;
    try {
      const h = await ctx.ai.claude({ model: "haiku", system: SYSTEM, schema: STEP_SCHEMA, prompt: JSON.stringify({ title: b.title, passes: b.trail }) });
      const steps = cleanSteps(h.out?.steps);
      if (!steps.length) throw new Error("no steps came back");
      writeSteps(db, b.id, steps, new Date().toISOString());
      db.query("UPDATE runbooks_books SET assembled_times = times_done WHERE id = ?").run(b.id);
      assembled++;
      ctx.log(`assembled ${steps.length} steps for runbook ${b.id} "${b.title}" (${h.model}, ${h.ms} ms)`);
    } catch (e: any) {
      errors.push(`runbook ${b.id}: ${e?.message ?? e}`);
      ctx.log(`could not assemble runbook ${b.id}: ${e?.message ?? e}`);
    }
  }
  return { groups: r.groups, count: r.count, assembled, errors, books: (r.books ?? []).map(({ trail: _t, ...b }: any) => b) };
}

/** The brief the agent gets: the runbook, step by step, with the exact commands and the known failure points. */
export function runbookBrief(show: any): string {
  const b = show.book;
  const lines = [`Runbook: ${b.title} (done ${b.times_done} times before${b.last_done_at ? `, last on ${String(b.last_done_at).slice(0, 10)}` : ""}).`,
    "Do it again by following these steps in order. Use the exact commands, accounts, paths and URLs given; do not substitute your own."];
  for (const s of show.steps ?? []) {
    lines.push(`${s.n}. ${s.text}${s.ok ? "" : "  [failed before]"}`);
    if (s.command) lines.push(`   command: ${s.command}`);
    if (s.note) lines.push(`   note: ${s.note}`);
  }
  lines.push("If a step cannot be done, stop and ask rather than improvising.", "End with the evidence (link, commit, file or run URL) so the task can be closed with it.");
  return lines.join("\n");
}

async function show(ctx: JobCtx, id: string) { return ctx.agentos(["runbooks", "show", id]); }

export const runbooks: Module = {
  name: "runbooks",
  async handle(ctx) {
    const { path, method } = ctx;
    let m: RegExpMatchArray | null;
    if (method === "GET" && path === "/books") {
      const r = await ctx.agentos(["runbooks"]);
      // ?full=1: every book with its steps and runs, for pages that show them inline.
      const books = ctx.url.searchParams.get("full") ? await Promise.all((r.books ?? []).map((b: any) => show(ctx, String(b.id)))) : r.books;
      return ctx.json({ ...r, books, dryRun: dryRun() });
    }
    if (method === "GET" && (m = path.match(/^\/books\/(\d+)$/))) return ctx.json(await show(ctx, m[1]));
    if (method === "GET" && path === "/today") {
      const date = ctx.url.searchParams.get("date");
      return ctx.json(await ctx.agentos(["runbooks", "today", ...(date ? ["--date", date] : [])]));
    }
    if (method === "GET") return null;
    if (!ctx.owner) return ctx.fail(403, "Only the owner runs runbooks.");
    if (method === "PATCH" && (m = path.match(/^\/books\/(\d+)$/))) {
      const b = await ctx.body();
      const id = m[1];
      if (Array.isArray(b.steps)) {
        const steps = cleanSteps(b.steps);
        if (!steps.length) return ctx.fail(400, "Give at least one step with text.");
        await show(ctx, id); // 400 from the CLI when the book does not exist
        writeSteps(ctx.db(), Number(id), steps, new Date().toISOString());
      }
      if (b.status === "ready" || b.status === "draft") await ctx.agentos(["runbooks", b.status, id]);
      else if (b.status !== undefined) return ctx.fail(400, "status is ready or draft.");
      return ctx.json({ ok: true, ...(await show(ctx, id)) });
    }
    if (method === "POST" && (m = path.match(/^\/books\/(\d+)\/run$/))) {
      const s = await show(ctx, m[1]);
      if (s.book.status !== "ready") return ctx.fail(400, "Mark the runbook ready first.");
      const title = `Run: ${s.book.title}`.slice(0, 200);
      const add = await ctx.agentos(["add", title, "--due", "today", ...(s.book.area ? ["--area", s.book.area] : []), ...(s.book.project ? ["--project", s.book.project] : []),
        "--notes", `Runbook ${s.book.id}`]);
      const taskId: string = add.task.id;
      const agent = await giveTask(ctx, taskId, { brief: runbookBrief(s), mode: "edit", confirm: true, workspace: workspaceFor(s.book.area, s.book.title) });
      const run = ctx.db().query("INSERT INTO runbooks_runs (book_id, task_id, job_id, started_at) VALUES (?, ?, ?, ?) RETURNING *")
        .get(s.book.id, numId(taskId), agent?.jobId ?? null, new Date().toISOString()) as any;
      ctx.log(`run ${run.id} of runbook ${s.book.id} as ${taskId}${agent?.dryRun ? " (dry run)" : ""}`);
      return ctx.json({ ok: true, task: add.task, agent, run: { id: run.id, task: taskId, job: run.job_id, started_at: run.started_at }, dryRun: !!agent?.dryRun }, 201);
    }
    if (method === "POST" && path === "/scan") return ctx.json({ ok: true, ...(await scan(ctx, { force: true })) });
    return null;
  },
  jobs: [{ id: "runbooks-scan", every: "1h", run: async (ctx) => { await scan(ctx); } }],
};

// The night shift: jobs he queued for the evening (work_night rows) start at 23:00 IST on his Claude and Codex plans,
// and a push at 07:00 says what ran. Scheduler jobs on the work module; MOD_SCHEDULER=off keeps them still on test servers.
//   night-shift  23:00   every queued row dated today or earlier becomes a real job, through POST /api/v1/jobs as the
//                        owner (the same create the app uses), at most 3 per run; the rest wait for the next run.
//                        A row whose task is already done or dropped is skipped. Before the call a row is claimed
//                        (data.claimedAt), so a PC that stops mid-start never starts the same job twice.
//   night-report 07:00   "Night shift: <n> jobs ran: <titles>" when anything started since yesterday 18:00 IST.
import { ist } from "./scheduler";
import type { JobCtx } from "./types";
import { loopback, type Fetch } from "./work-api";
import { ensureTables, night, writeNight } from "./work-store";

export const NIGHT_MAX = 3;
type Out = { started: { id: string; job: string; title: string }[]; failed: { id: string; error: string }[]; skipped: string[]; left: number };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const firstLine = (s: unknown) => String(s ?? "").split("\n").map((x) => x.trim()).find(Boolean) ?? "";
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/** The create body for one night row: the same fields the app's New job sheet sends. */
export function jobBody(r: any) {
  const title = String(r.title ?? "").trim();
  return {
    engine: r.engine,
    ...(r.model ? { model: r.model } : {}),
    ...(r.effort ? { effort: r.effort } : {}),
    ...(r.task ? { taskIds: [r.task] } : {}),
    ...(r.project ? { project: r.project } : {}),
    ...(title ? { title } : {}),
    context: String(r.prompt ?? ""),
    mode: "auto",
    plan: r.mode === "plan",
    worktree: r.worktree !== false,
  };
}

export async function runNightShift(ctx: JobCtx, o: { fetch?: Fetch; now?: Date; max?: number } = {}): Promise<Out> {
  const out: Out = { started: [], failed: [], skipped: [], left: 0 };
  if (!(await ensureTables(ctx))) { ctx.log("night shift: the work tables aren't on this PC yet (agentos work module)"); return out; }
  const now = o.now ?? new Date();
  // the night this run belongs to: a catch-up after midnight (the PC woke at 00:40) is still last night's shift, so rows
  // queued for tonight (dated today) wait for tonight's 23:00
  const today = ist(now).hhmm < "12:00" ? ist(new Date(now.getTime() - 12 * 3600e3)).date : ist(now).date;
  const max = o.max ?? NIGHT_MAX;
  const db = ctx.db();
  const call = loopback(ctx, o.fetch);
  const due = night.list(db).items
    .filter((r: any) => !r.deleted_at && r.state === "queued" && typeof r.date === "string" && r.date <= today)
    .sort((a: any, b: any) => a.date.localeCompare(b.date) || String(a.created_at).localeCompare(String(b.created_at)));
  const fresh: any[] = [];
  for (const r of due) {
    if (r.claimedAt) {
      // An earlier run claimed it and never finished: the job may exist. Say so instead of starting a second one.
      const error = "The PC stopped while starting this one. Check Jobs before you queue it again.";
      writeNight(db, { ...r, claimedAt: null, state: "failed", error, failedAt: now.toISOString() });
      out.failed.push({ id: r.id, error });
      continue;
    }
    const t = r.task ? (() => { try { return db.query("SELECT status FROM tasks WHERE id = ?").get(Number(String(r.task).replace(/^t/i, ""))) as any; } catch { return null; } })() : null;
    if (t && (t.status === "done" || t.status === "dropped")) {
      writeNight(db, { ...r, state: "skipped", error: `Its task ${r.task} is already ${t.status}.` });
      out.skipped.push(r.id);
      continue;
    }
    fresh.push(r);
  }
  for (const r of fresh.slice(0, max)) {
    const claimed = writeNight(db, { ...r, claimedAt: now.toISOString() });
    // The row as it is after the call: a phone edit or delete that landed meanwhile is kept, only the outcome changes.
    const latest = () => night.get(db, r.id) ?? claimed;
    try {
      const res = await call("POST", "/jobs", jobBody(r), { timeoutMs: 90_000, headers: { "Idempotency-Key": `night:${r.id}` } });
      const job = res?.job;
      if (!job?.id) throw new Error("The job server answered without a job.");
      const title = String(r.title ?? "").trim() || String(job.title ?? "").trim() || clip(firstLine(r.prompt), 80) || job.id;
      writeNight(db, { ...latest(), claimedAt: null, state: "started", job: job.id, title, startedAt: now.toISOString(), error: null });
      out.started.push({ id: r.id, job: job.id, title });
    } catch (e: any) {
      const error = clip(String(e?.message ?? e), 300);
      writeNight(db, { ...latest(), claimedAt: null, state: "failed", error, failedAt: now.toISOString() });
      out.failed.push({ id: r.id, error });
    }
  }
  out.left = Math.max(0, fresh.length - max);
  if (out.started.length || out.failed.length) ctx.log(`night shift: ${out.started.length} started, ${out.failed.length} failed, ${out.left} wait`);
  return out;
}

/** The morning line. Null (and no push) when the night shift did nothing since yesterday 18:00 IST. */
export async function nightReport(ctx: JobCtx, o: { now?: Date } = {}) {
  if (!(await ensureTables(ctx))) return null;
  const now = o.now ?? new Date();
  const since = Date.parse(`${addDays(ist(now).date, -1)}T18:00:00+05:30`);
  const within = (iso: unknown) => typeof iso === "string" && Date.parse(iso) >= since && Date.parse(iso) <= now.getTime();
  const rows = night.list(ctx.db()).items.filter((r: any) => !r.deleted_at);
  const ran = rows.filter((r: any) => r.state === "started" && within(r.startedAt));
  const failed = rows.filter((r: any) => r.state === "failed" && within(r.failedAt));
  if (!ran.length && !failed.length) return null;
  const names = (list: any[]) => clip(list.map((r) => clip(String(r.title || r.job || "a job"), 60)).join(", "), 160);
  const body = ran.length
    ? `${ran.length} job${ran.length === 1 ? "" : "s"} ran: ${names(ran)}${failed.length ? `. ${failed.length} didn't start.` : ""}`
    : `${failed.length} night job${failed.length === 1 ? "" : "s"} didn't start: ${names(failed)}`;
  await ctx.push("Night shift", body, { kind: "work", url: "agenticos://work/jobs" });
  return { title: "Night shift", body, ran: ran.map((r: any) => r.job), failed: failed.map((r: any) => r.id) };
}

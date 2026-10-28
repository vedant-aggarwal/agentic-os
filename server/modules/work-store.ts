// Work's two offline-first collections on the store contract (server/modules/_collection.ts, notes/engine.md §4).
//   /api/v1/mod/work/reviews   work_reviews: what he did with each changed file on a job's Changes page
//                              { job, path, mark: kept | reverted | null, turn, blob (the undo copy), noted }
//   /api/v1/mod/work/night     work_night: the night shift's queue, one row per job to start at 23:00 IST
//                              { date (the evening it runs), state, job, task, project, engine } + in data: title,
//                              prompt, model, effort, mode (plan | build), worktree, error, startedAt
// The tables belong to the agentos CLI module (cli/src/modules/work.ts creates them with collectionDDL's shape).
// ensureTables asks the CLI once when they're missing, since any agentos command runs every module's migrate.
import type { Database } from "bun:sqlite";
import { mountCollection } from "./_collection";
import type { JobCtx } from "./types";

export const REVIEWS = { table: "work_reviews", columns: { job: "text", path: "text", mark: "text", turn: "integer", blob: "text", noted: "bool" } } as const;
export const NIGHT = { table: "work_night", columns: { date: "text", state: "text", job: "text", task: "text", project: "text", engine: "text" } } as const;

export const NIGHT_STATES = ["queued", "started", "failed", "skipped", "cancelled"];
export const ENGINES = ["claude", "codex"];
export const MODES = ["plan", "build"];
const MARKS = ["kept", "reverted"];
const JOB_ID = /^j?\d+$/i;
const TASK_ID = /^t?\d+$/i;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** A real calendar day as YYYY-MM-DD (2026-02-30 is not one). */
export const isDay = (s: unknown) => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};

export function checkReview(d: any): string | null {
  if (!JOB_ID.test(String(d.job ?? ""))) return "job is a job id like j12.";
  if (typeof d.path !== "string" || !d.path.trim()) return "path can't be empty.";
  if (d.mark != null && !MARKS.includes(d.mark)) return 'mark is "kept", "reverted" or null.';
  if (d.turn != null && !(Number.isInteger(d.turn) && d.turn >= 0)) return "turn is a whole number.";
  if (d.blob != null && !(typeof d.blob === "string" && SHA.test(d.blob))) return "blob is the id a revert gave back, or null.";
  return null;
}

export function checkNight(d: any, current: any | null): string | null {
  if (!isDay(d.date)) return "date is the evening it runs, as YYYY-MM-DD.";
  if (!NIGHT_STATES.includes(d.state)) return `state is ${NIGHT_STATES.join(", ")}.`;
  if (!ENGINES.includes(d.engine)) return 'engine is "claude" or "codex".';
  if (d.mode != null && !MODES.includes(d.mode)) return 'mode is "plan" or "build".';
  if (d.task != null && d.task !== "" && !TASK_ID.test(String(d.task))) return "task is a task id like t12.";
  if (d.state === "queued" && !String(d.prompt ?? "").trim() && !d.task) return "A night job needs a prompt or a task.";
  // Once the night shift started it, the row says which job it became; a late edit from the phone can't undo that.
  if (current?.state === "started" && d.state !== "started") return `It already started as ${current.job ?? "a job"}.`;
  return null;
}

export const reviews = mountCollection({ ...REVIEWS, validate: checkReview });
export const night = mountCollection({ ...NIGHT, validate: checkNight });

const hasTables = (db: Database) => {
  try { db.query("SELECT 1 FROM work_reviews LIMIT 1").get(); db.query("SELECT 1 FROM work_night LIMIT 1").get(); return true; } catch { return false; }
};
const asked = new Map<string, number>();
/** True when both tables are there. When they aren't, run the agentos CLI once (at most every 10 minutes per db). */
export async function ensureTables(ctx: Pick<JobCtx, "db" | "dbPath" | "agentos">): Promise<boolean> {
  const db = ctx.db();
  if (hasTables(db)) return true;
  const key = String(ctx.dbPath ?? "");
  if (Date.now() - (asked.get(key) ?? 0) < 10 * 60_000 || typeof ctx.agentos !== "function") return false;
  asked.set(key, Date.now());
  await ctx.agentos(["work", "night"]).catch(() => null);
  return hasTables(db);
}

/** A server-side write that must win over what the phone sent: updated_at just after the stored one, even when the
 *  phone's clock runs ahead. Returns the stored doc. */
export function writeNight(db: Database, doc: any) {
  const cur = night.get(db, doc.id);
  const at = Math.max(Date.now(), cur?.updated_at ? Date.parse(cur.updated_at) + 1 : 0);
  const r = night.upsert(db, { ...doc, updated_at: new Date(at).toISOString() });
  return r.item;
}

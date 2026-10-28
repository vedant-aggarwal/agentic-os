// Work (v2): what the Work app needs beyond the job runner (server/jobs.ts). Owner only: every route answers 403 to
// anyone else.
//   POST /api/v1/mod/work/jobs/:jobId/revert-file    { path, turn? }   one file back to a turn's checkpoint (work-files.ts)
//   POST /api/v1/mod/work/jobs/:jobId/restore-file   { path, blob }    Undo of that: those bytes back (blob null deletes)
//   GET  /api/v1/mod/work/repo?project=<slug>|folder=<path>           branch, ahead/behind, dirty, commits, activity, scripts (work-repo.ts)
//   /api/v1/mod/work/reviews   collection work_reviews   file marks on the Changes page (store contract; work-store.ts)
//   /api/v1/mod/work/night     collection work_night     the night shift's queue
// Scheduler jobs: night-shift 23:00 IST (starts queued rows, at most 3 a run) and night-report 07:00 (work-night.ts).
// Agent tools: work_overview, work_job, work_add_idea, work_reply, work_answer, work_start_job, work_queue_tonight
// (work-tools.ts). Tables: the agentos CLI module cli/src/modules/work.ts owns them.
import type { Module, ModCtx } from "./types";
import { revertFile, restoreFile, WorkError } from "./work-files";
import { repoRoute } from "./work-repo";
import { ensureTables, night, reviews } from "./work-store";
import { nightReport, runNightShift } from "./work-night";
import { workTools } from "./work-tools";

async function guarded(ctx: ModCtx, fn: () => Promise<unknown>) {
  try { return ctx.json(await fn()); }
  catch (e) {
    if (e instanceof WorkError) return ctx.fail(e.status, e.message);
    throw e;
  }
}

export const work: Module = {
  name: "work",
  async handle(ctx) {
    if (!ctx.owner) return ctx.fail(403, "Work is only on the owner's account.");
    const file = ctx.path.match(/^\/jobs\/([^/]+)\/(revert-file|restore-file)$/);
    if (file && ctx.method === "POST") {
      const body = await ctx.body();
      return guarded(ctx, () => (file[2] === "revert-file" ? revertFile(ctx, file[1], body) : restoreFile(ctx, file[1], body)));
    }
    if (ctx.path === "/repo" && ctx.method === "GET") return repoRoute(ctx);
    if (/^\/(reviews|night)(\/|$)/.test(ctx.path)) {
      await ensureTables(ctx);
      return (await reviews.handle(ctx, "/reviews")) ?? (await night.handle(ctx, "/night"));
    }
    return null;
  },
  jobs: [
    { id: "night-shift", at: "23:00", catchUpMinutes: 180, run: async (ctx) => { await runNightShift(ctx); } },
    { id: "night-report", at: "07:00", run: async (ctx) => { await nightReport(ctx); } },
  ],
  tools: workTools(),
};

// Shared by the knowing modules (doctrine, runbooks, bounty): the agent hand-off behind MOD_DRY_RUN,
// the payroll "retired" list, and small IST helpers. Not a module itself (index.ts never lists it).
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { JobCtx } from "./types";

/** MOD_DRY_RUN=1: never reach the live agent-jobs runner on 8081; record what would have been sent instead. */
export const dryRun = () => process.env.MOD_DRY_RUN === "1";

export type Handoff = { brief: string; mode?: "read" | "edit"; confirm?: boolean; workspace?: string };
/** Hand a task to the Claude agent the way the app's "Give to Claude" does (ai.give). Under MOD_DRY_RUN the
 *  call is appended to <dataDir>/mod/dry-run.jsonl and a queued-looking summary comes back. */
export async function giveTask(ctx: JobCtx, taskId: string, h: Handoff) {
  const body = { brief: h.brief.slice(0, 4000), mode: h.mode ?? "edit", confirm: h.confirm !== false, workspace: h.workspace ?? "none" };
  if (dryRun()) {
    const dir = join(ctx.dataDir, "mod");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "dry-run.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), user: ctx.user.email, taskId, ...body })}\n`);
    ctx.log(`dry run: would give ${taskId} to the agent (${body.mode}, check ${body.confirm}, ${body.workspace})`);
    return { dryRun: true, state: "queued", jobId: null, ws: body.workspace, mode: body.mode, check: body.confirm, startedAt: new Date().toISOString(),
      log: [{ text: "Dry run: nothing was sent to your PC (MOD_DRY_RUN=1)" }], brief: body.brief };
  }
  return ctx.ai.give(ctx.user, ctx.store, taskId, body);
}

/** The agent-jobs workspace for a task, from its area (the names ai.ts knows). */
export function workspaceFor(area: string | null | undefined, title = ""): string {
  if (area === "northwind" || /harborline|shopbrain|northwind/i.test(title)) return "northwind";
  if (area === "corner-market" || area === "morgan-co") return "corner-market";
  if (/agentic os|agentos/i.test(title)) return "agentic-os";
  return "none";
}

/** Runners the payroll retired (settings bounty.retired, a JSON list). A retired job skips its run. */
export function retiredRunners(ctx: JobCtx): string[] {
  try {
    const v = (ctx.db().query("SELECT value FROM settings WHERE key = 'bounty.retired'").get() as any)?.value;
    const list = v ? JSON.parse(v) : [];
    return Array.isArray(list) ? list.map(String) : [];
  } catch { return []; }
}
export const isRetired = (ctx: JobCtx, runner: string) => retiredRunners(ctx).includes(runner);

const IST_MS = 330 * 60_000;
export const istDate = (d = new Date()) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00+05:30`) + n * 864e5).toISOString().slice(0, 10);
/** ISO week like 2026-W42 of a YYYY-MM-DD date (the same arithmetic as the CLI's doctrine module). */
export function isoWeek(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
export const numId = (s: unknown) => Number(String(s ?? "").replace(/\D/g, ""));

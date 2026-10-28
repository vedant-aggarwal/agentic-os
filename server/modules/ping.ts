// Reference module. Proves the route, the owner/loopback path, the per-request db and the scheduler.
//   GET  /api/v1/mod/ping/ping   -> { ok, user, owner, now, tasks }
//   POST /api/v1/mod/ping/echo   -> the JSON body, back
//   job ping-heartbeat, hourly    -> one line in <dataDir>/mod/ping/heartbeat.log
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Module } from "./types";

export const ping: Module = {
  name: "ping",
  async handle(ctx) {
    if (ctx.path === "/ping" && ctx.method === "GET") {
      let tasks: number | null = null;
      try { tasks = (ctx.db().query("SELECT count(*) AS n FROM tasks WHERE status IN ('inbox','todo','doing')").get() as any)?.n ?? null; } catch {}
      return ctx.json({ ok: true, user: ctx.user.email, owner: ctx.owner, now: new Date().toISOString(), tasks });
    }
    if (ctx.path === "/echo" && ctx.method === "POST") return ctx.json(await ctx.body());
    return null;
  },
  jobs: [{
    id: "ping-heartbeat", every: "1h",
    async run(ctx) {
      const dir = join(ctx.dataDir, "mod", "ping");
      mkdirSync(dir, { recursive: true });
      appendFileSync(join(dir, "heartbeat.log"), `${new Date().toISOString()} ${ctx.user.email} alive\n`);
      ctx.log("heartbeat");
    },
  }],
};

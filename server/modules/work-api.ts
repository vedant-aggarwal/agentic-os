// The phone server's own API, called from inside it as the owner: a loopback request to http://127.0.0.1:<PORT>/api/v1
// with the agent token (<DATA_DIR>/agent.token). The night shift and Work's agent tools go through it, so they start
// and answer jobs exactly the way the app does. `fetch` is injectable for tests.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { JobCtx } from "./types";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export class ApiFailure extends Error { constructor(public status: number, message: string) { super(message); } }

export function loopback(ctx: Pick<JobCtx, "conf" | "dataDir">, fetchImpl: Fetch = fetch) {
  const base = `http://127.0.0.1:${ctx.conf("PORT", "8090")}/api/v1`;
  let token: string | null = null;
  const tokenOf = () => {
    if (token) return token;
    try { token = readFileSync(join(ctx.dataDir, "agent.token"), "utf8").trim(); } catch {}
    if (!token) throw new ApiFailure(503, "The agent token isn't on this PC yet. Start the phone server once.");
    return token;
  };
  return async function call(method: string, path: string, body?: unknown, o: { timeoutMs?: number; headers?: Record<string, string> } = {}) {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${tokenOf()}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...o.headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
      });
    } catch (e: any) {
      if (e instanceof ApiFailure) throw e;
      throw new ApiFailure(504, e?.name === "TimeoutError" ? "The job server didn't answer in time." : `Couldn't reach the job server: ${String(e?.message ?? e).slice(0, 200)}`);
    }
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch {}
    if (!res.ok) throw new ApiFailure(res.status, String(data?.error ?? `The job server answered ${res.status}.`));
    return data;
  };
}

/** "j12", "12" or 12 → "j12"; null when it isn't a job id. */
export const jobKey = (v: unknown) => { const m = /^j?(\d+)$/i.exec(String(v ?? "").trim()); return m && Number(m[1]) > 0 ? `j${Number(m[1])}` : null; };

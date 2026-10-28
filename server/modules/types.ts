// The phone server module contract (FOUNDATION.md section 4). A module answers /api/v1/mod/<name>/<rest>
// and may own scheduled jobs. Everything a module needs arrives in its context; it imports nothing from index.ts.
import type { Database } from "bun:sqlite";
import type { User } from "../auth";
import type { Store } from "../store";
import type { AI } from "../ai";

export type ModCtx = {
  req: Request; url: URL; method: string;
  path: string;                 // after /api/v1/mod/<name>, e.g. "/plan" or "/runs/3"
  user: User | null; owner: boolean;   // owner = role "owner" OR a loopback call with the agent token; user is null only on a module's publicPaths
  store: Store; dbPath: string; db: () => Database;   // bun:sqlite on this user's agentos db, opened once per request
  contentDbPath: string;
  body: () => Promise<any>; json: (data: unknown, status?: number) => Response; fail: (status: number, msg: string) => Response;
  ai: AI;                       // ai.claude({ model: "haiku"|"sonnet", system, prompt, schema }) on the subscription
  codex: (o: { prompt: string; schema?: object; cwd?: string; sandbox?: "read-only" | "workspace-write"; model?: string; images?: string[]; timeoutMs?: number }) => Promise<{ out: any; text: string; ms: number }>;
  agentos: (args: string[]) => Promise<any>;   // runs the CLI with --json against this user's db (AGENTOS_DB env)
  push: (title: string, body: string, data?: Record<string, unknown>) => Promise<void>;  // APNs to the user's devices; no-op without keys
  wyn: any;                    // the Wyn object from server/wyn.ts (chat, calls, memories); use sparingly
  conf: (k: string, d: string) => string; dataDir: string;   // per-module files go under <dataDir>/mod/<name>/
  log: (msg: string) => void;
};
export type JobCtx = Omit<ModCtx, "req" | "url" | "method" | "path" | "body" | "json" | "fail">;
export type Job = { id: string; at?: string; every?: string; days?: string[]; catchUpMinutes?: number;
  retry?: { attempts: number; delayMinutes: number }; run: (ctx: JobCtx) => Promise<void> };
/** v2: a tool the agent (Wyn / Wyn) can call for this module. The Agent area aggregates every module's tools into her MCP
 *  server. `input` is a JSON Schema object for the arguments. `auto: true` means she may do it on her own and report after
 *  (DECISIONS 2: low-stakes, reversible); false means she asks first. `run` returns plain JSON for her (and her feed). */
export type AgentTool = {
  name: string; description: string; input: Record<string, unknown>; auto?: boolean;
  run: (ctx: JobCtx, args: any) => Promise<unknown>;
};
export type Module = {
  name: string;
  handle: (ctx: ModCtx) => Promise<Response | null>;   // null means "not my route", the server answers 404
  jobs?: Job[];
  tools?: AgentTool[];      // v2: what the agent can do in this app (see AgentTool)
  // at: "HH:MM" IST once a day; every: "15m" | "1h"; days: ["mon",...] optional
  publicPaths?: string[];   // path prefixes (after /api/v1/mod/<name>) served without a session: user = null, owner = false, db = the owner's
};

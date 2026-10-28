// agentos term: drive terminal sessions (a shell, Claude Code, Codex) on this PC
// through the Agentic OS phone server's /api/v1/term API, so Wyn and scripts can
// start one, type into it, read its screen and wait on it. No SQLite here: the
// server owns the sessions. Kept apart from agentos.ts like goals.ts.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

type Args = { _: string[]; flags: Record<string, string | boolean> }; // same shape as src/modules/types.ts
/** Helpers owned by agentos.ts, passed in to avoid a circular import. */
export type TermCtx = {
  out: (data: Record<string, unknown>, help?: string[]) => void;
  str: (a: Args, k: string) => string | undefined;
  fail: (msg: string) => never;
  json: () => boolean;
  argv: string[];                                  // raw argv, for flags that repeat (--task)
};

export const TERM_HELP = `agentos term list [--all]                     terminal sessions on this PC (live ones; --all adds exited)
agentos term new [<project>] --kind claude|codex|shell [--task t12 ...] [--prompt ".."] [--mode <permission mode>]
                 [--model m] [--copy] [--cwd <dir>] [--title ".."]   --copy runs in a git worktree copy of the project
agentos term show <id> | read <id> [--lines 60] | send <id> "<text>" [--no-enter] | key <id> <key>
                 keys: enter esc tab shift-tab up down left right ctrl-c backspace space y n 1 2 3 4
agentos term wait <id> [--until settled|idle|needs_input|exited|running] [--timeout 600]   exit 3 when it timed out
agentos term kill|restart|remove <id> | done <id> [--keep-tasks] [--kill]   done closes its linked tasks
Talks to the phone server: AGENTIC_APP_URL or http://127.0.0.1:\${AGENTIC_APP_PORT:-8090}.`;

type Session = {
  id: string; kind: string; title: string | null; project: string | null; cwd: string | null; argv: string[];
  status: string; detail: string | null; attention: unknown; engineSessionId: string | null; taskIds: string[];
  permissionMode: string | null; model: string | null; createdAt: string; updatedAt: string;
  exitedAt: string | null; exitCode: number | null;
};

const KINDS = ["claude", "codex", "shell", "custom"];
const UNTIL = ["settled", "idle", "needs_input", "exited", "running"];
const SERVER_CAP = 900; // the server holds a wait at most this many seconds

// ── the server ──────────────────────────────────────────────────────────────
function base() {
  const url = process.env.AGENTIC_APP_URL || `http://127.0.0.1:${process.env.AGENTIC_APP_PORT || 8090}`;
  return url.replace(/\/+$/, "");
}
function port(url: string) {
  try {
    const u = new URL(url);
    return u.port || (u.protocol === "https:" ? "443" : "80");
  } catch {
    return url;
  }
}
const tokenPath = () => process.env.AGENTIC_APP_TOKEN_PATH || join(homedir(), "agentic-os", "data", "agent.token");
function token(ctx: TermCtx) {
  try {
    return readFileSync(tokenPath(), "utf8").trim();
  } catch {
    return ctx.fail(`Can't read the Agentic OS token at ${tokenPath()}. Set AGENTIC_APP_TOKEN_PATH or start the phone server once.`);
  }
}
/** One call to /api/v1<path>. Server errors come back as { error } and are shown as they are. */
async function api(ctx: TermCtx, method: string, path: string, body?: unknown, waitSeconds = 0): Promise<any> {
  const url = base(), auth = token(ctx);
  let res: Response;
  try {
    res = await fetch(`${url}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${auth}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      // A long-poll may hold the line for minutes; Bun's own fetch timeout is off and ours sits past the wait.
      signal: AbortSignal.timeout((waitSeconds + 30) * 1000),
      timeout: false,
    } as RequestInit);
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw new Error(`The phone server didn't answer ${method} ${path} in time.`);
    return ctx.fail(`The Agentic OS phone server isn't running on this PC (port ${port(url)}).`);
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : {}; } catch { /* not JSON: shown raw below */ }
  if (res.ok) return data ?? {};
  const msg = data?.error ? String(data.error) : `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`;
  if (res.status === 401 || res.status === 403) return ctx.fail(`${msg} (the token at ${tokenPath()} was refused)`);
  // A phone server from before the terminal API answers the whole route family this way.
  if (res.status === 404 && msg === "No such endpoint.")
    return ctx.fail(`The phone server on port ${port(url)} has no terminal API (/api/v1/term). Restart it on a build that has it.`);
  if (res.status < 500) return ctx.fail(msg);
  throw new Error(msg);
}

// ── shaping ─────────────────────────────────────────────────────────────────
function short(p: string | null) {
  if (!p) return null;
  const home = homedir();
  return p.toLowerCase().startsWith(home.toLowerCase()) ? `~${p.slice(home.length)}` : p;
}
/** One line in a list: where it runs is the project, else the folder. */
const row = (s: Session) => ({ id: s.id, kind: s.kind, status: s.status, title: s.title ?? (s.cwd ? basename(s.cwd) : null),
  where: s.project ?? short(s.cwd), tasks: (s.taskIds ?? []).join(" ") || null });
const sid = (ctx: TermCtx, a: Args, usage: string) => a._[2] || ctx.fail(`Give a session id: ${usage}`);
const at = (id: string) => `/term/${encodeURIComponent(id)}`;
/** Bare flags the parser may have swallowed a word into (`--no-enter "hi"`): that word goes back to the positionals. */
function bools(a: Args, names: string[]) {
  for (const n of names) {
    const v = a.flags[n];
    if (typeof v === "string") { a._.push(v); a.flags[n] = true; }
  }
}
/** --task t12 --task 13 or --task t12,13, normalised to the t12 form the server stores. */
function taskIds(ctx: TermCtx): string[] {
  const vals: string[] = [];
  for (let i = 0; i < ctx.argv.length; i++) {
    const t = ctx.argv[i];
    if (t === "--task" || t === "--tasks") {
      const next = ctx.argv[i + 1];
      if (next === undefined || next.startsWith("--")) ctx.fail("--task takes a task id, like --task t12.");
      vals.push(next); i++;
    } else if (t.startsWith("--task=") || t.startsWith("--tasks=")) vals.push(t.slice(t.indexOf("=") + 1));
  }
  const ids = vals.flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean).map((v) => {
    if (!/^t?\d+$/i.test(v)) ctx.fail(`"${v}" is not a task id. Use t12 or 12.`);
    return `t${v.replace(/^t/i, "")}`;
  });
  return [...new Set(ids)];
}

// ── commands ────────────────────────────────────────────────────────────────
export async function term(ctx: TermCtx, a: Args) {
  const { out, str, fail } = ctx;
  bools(a, ["all", "copy", "no-enter", "keep-tasks", "kill"]);
  const sub = a._[1] ?? "list";
  if (sub === "list" || sub === "ls") {
    const r = await api(ctx, "GET", "/term");
    const all: Session[] = r.sessions ?? [];
    const shown = a.flags.all ? all : all.filter((s) => s.status !== "exited");
    if (ctx.json()) return out({ count: shown.length, sessions: shown, maxRunningAgents: r.maxRunningAgents ?? null, settings: r.settings ?? null });
    const exited = all.length - all.filter((s) => s.status !== "exited").length;
    return out({ count: shown.length, sessions: shown.map(row), ...(a.flags.all || !exited ? {} : { exited }),
      maxRunningAgents: r.maxRunningAgents ?? null },
      shown.length ? ["agentos term read <id>", "agentos term new <project> --kind claude --prompt \"..\""]
        : ["agentos term new <project> --kind claude --prompt \"..\"", ...(exited ? ["agentos term list --all"] : [])]);
  }
  if (sub === "new" || sub === "start") {
    const kind = str(a, "kind");
    if (!kind || !KINDS.includes(kind)) fail(`Say what to run: agentos term new [<project>] --kind ${KINDS.slice(0, 3).join("|")}`);
    const body: Record<string, unknown> = { kind };
    const proj = a._[2] ?? str(a, "project");
    if (proj) body.project = proj;
    for (const [flag, key] of [["cwd", "cwd"], ["title", "title"], ["prompt", "prompt"], ["mode", "permissionMode"], ["model", "model"]])
      if (str(a, flag)) body[key] = str(a, flag);
    const tasks = taskIds(ctx);
    if (tasks.length) body.taskIds = tasks;
    if (a.flags.copy) body.copy = true;
    const { session: s } = (await api(ctx, "POST", "/term", body)) as { session: Session };
    if (ctx.json()) return out({ ok: true, action: "started", id: s.id, session: s });
    return out({ id: s.id, ok: true, action: "started", session: row(s), cwd: s.cwd ?? null },
      body.prompt
        ? [`agentos term wait ${s.id}  # until it settles`, `agentos term read ${s.id}`]
        : [`agentos term wait ${s.id} --until needs_input`, `agentos term send ${s.id} "<text>"`, `agentos term read ${s.id}`]);
  }
  if (sub === "show") {
    const id = sid(ctx, a, "agentos term show <id>");
    const { session } = await api(ctx, "GET", at(id));
    return out({ session }, [`agentos term read ${id}`, `agentos term send ${id} "<text>"`]);
  }
  if (sub === "read" || sub === "text") {
    const id = sid(ctx, a, "agentos term read <id> [--lines 60]");
    const lines = Number(str(a, "lines") ?? 60);
    if (!Number.isInteger(lines) || lines <= 0) fail("--lines takes a count, like --lines 60 (the server keeps up to 2000).");
    const r = await api(ctx, "GET", `${at(id)}/text?lines=${Math.min(lines, 2000)}`);
    if (ctx.json()) return out({ id, status: r.status ?? null, text: r.text ?? "" });
    // The screen as it is, for a person or a script to read; no TOON around it.
    return console.log(String(r.text ?? "").replace(/\s+$/, ""));
  }
  if (sub === "send") {
    const id = sid(ctx, a, 'agentos term send <id> "<text>" [--no-enter]');
    const text = a._.slice(3).join(" ");
    if (!text && !str(a, "text")) fail('Give the text: agentos term send <id> "<text>" [--no-enter]');
    await api(ctx, "POST", `${at(id)}/send`, { text: str(a, "text") ?? text, enter: !a.flags["no-enter"] });
    return out({ ok: true, action: "sent", id, enter: !a.flags["no-enter"] }, [`agentos term wait ${id}`, `agentos term read ${id}`]);
  }
  if (sub === "key") {
    const id = sid(ctx, a, "agentos term key <id> <key>");
    const key = a._[3] ?? fail("Give a key: enter, esc, tab, shift-tab, up, down, left, right, ctrl-c, backspace, space, y, n, 1-4.");
    await api(ctx, "POST", `${at(id)}/key`, { key: key.toLowerCase() });
    return out({ ok: true, action: "key", id, key: key.toLowerCase() }, [`agentos term read ${id}`]);
  }
  if (sub === "wait") {
    const id = sid(ctx, a, "agentos term wait <id> [--until settled|idle|needs_input|exited] [--timeout 600]");
    const until = str(a, "until") ?? "settled";
    if (!UNTIL.includes(until)) fail(`--until is ${UNTIL.join(", ")}.`);
    const timeout = Number(str(a, "timeout") ?? 600);
    if (!Number.isFinite(timeout) || timeout < 0) fail("--timeout takes seconds, like --timeout 600.");
    // The server holds one wait for at most 15 minutes, so a longer one is a few waits in a row.
    const end = Date.now() + timeout * 1000;
    let r: any;
    do {
      const left = Math.max(0, Math.min(SERVER_CAP, Math.ceil((end - Date.now()) / 1000)));
      r = await api(ctx, "GET", `${at(id)}/wait?until=${until}&timeout=${left}`, undefined, left);
    } while (!r.reached && Date.now() < end - 500 && r.session?.status !== "exited");
    const s: Session = r.session;
    if (!r.reached) process.exitCode = 3;
    if (ctx.json()) return out({ reached: !!r.reached, until, session: s });
    return out({ reached: !!r.reached, until, id, status: s?.status ?? null, detail: s?.detail ?? null },
      r.reached ? [`agentos term read ${id}`] : [`agentos term read ${id}  # timed out after ${timeout}s`, `agentos term wait ${id} --until ${until}`]);
  }
  if (sub === "kill" || sub === "remove" || sub === "rm") {
    const id = sid(ctx, a, `agentos term ${sub} <id>`);
    await api(ctx, sub === "kill" ? "POST" : "DELETE", sub === "kill" ? `${at(id)}/kill` : at(id));
    return out({ ok: true, action: sub === "kill" ? "killed" : "removed", id }, sub === "kill" ? [`agentos term remove ${id}`] : ["agentos term list"]);
  }
  if (sub === "restart") {
    const id = sid(ctx, a, "agentos term restart <id>");
    const { session } = await api(ctx, "POST", `${at(id)}/restart`);
    return out({ ok: true, action: "restarted", id: session?.id ?? id, session: ctx.json() ? session : row(session) },
      [`agentos term wait ${session?.id ?? id} --until needs_input`]);
  }
  if (sub === "done") {
    const id = sid(ctx, a, "agentos term done <id> [--keep-tasks] [--kill]");
    const r = await api(ctx, "POST", `${at(id)}/done`, { completeTasks: !a.flags["keep-tasks"], kill: !!a.flags.kill });
    const failed: { id: string; error: string }[] = r.failed ?? [];
    return out({ ok: !failed.length, action: "done", id, closed: r.closed ?? [], failed },
      failed.length ? [`agentos show ${failed[0].id}`] : a.flags.kill ? [`agentos term remove ${id}`] : [`agentos term kill ${id}`]);
  }
  fail(`Unknown term command "${sub}". Use list, new, show, read, send, key, wait, kill, restart, remove or done.`);
}

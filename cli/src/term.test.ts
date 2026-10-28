// agentos term: runs the real CLI against an in-memory fake of the phone server's
// /api/v1/term routes (synthetic sessions only; nothing touches a live server).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "agentos-term-"));
const CLI = join(import.meta.dir, "agentos.ts");
const TOKEN = join(dir, "agent.token");
writeFileSync(TOKEN, "secret-token\n");
afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

// ── fake phone server ───────────────────────────────────────────────────────
type S = Record<string, any>;
let sessions: S[] = [];
let sent: { id: string; body: any }[] = [];
let n = 0;
beforeEach(() => { sessions = []; sent = []; n = 0; });
const mk = (over: S = {}): S => ({ id: `ts${++n}`, kind: "claude", title: null, project: null, cwd: "C:\\code\\x", argv: ["claude"],
  status: "running", detail: null, attention: null, engineSessionId: null, taskIds: [], permissionMode: null, model: null,
  createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", exitedAt: null, exitCode: null, ...over });
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const json = (d: unknown, s = 200) => Response.json(d, { status: s });
    if (req.headers.get("authorization") !== "Bearer secret-token") return json({ error: "Not signed in." }, 401);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (u.pathname === "/api/v1/term" && req.method === "GET") return json({ sessions, maxRunningAgents: 3, settings: {} });
    if (u.pathname === "/api/v1/term" && req.method === "POST") {
      if (body.project === "nope") return json({ error: 'No project "nope".' }, 400);
      const s = mk({ kind: body.kind, project: body.project ?? null, cwd: body.cwd ?? (body.project ? `C:\\code\\${body.project}` : "C:\\"),
        title: body.title ?? null, taskIds: body.taskIds ?? [], permissionMode: body.permissionMode ?? null });
      sessions.push(s);
      sent.push({ id: s.id, body });
      return json({ session: s }, 201);
    }
    const m = u.pathname.match(/^\/api\/v1\/term\/([^/]+)(?:\/([a-z]+))?$/);
    const s = m && sessions.find((x) => x.id === decodeURIComponent(m[1]));
    if (!m) return json({ error: "No such endpoint." }, 404);
    if (!s) return json({ error: "No such terminal session." }, 404);
    const action = m[2];
    if (!action && req.method === "GET") return json({ session: s });
    if (!action && req.method === "DELETE") { sessions = sessions.filter((x) => x !== s); return json({ ok: true }); }
    if (action === "text") return json({ text: `lines=${u.searchParams.get("lines")}\n> hello\n`, status: s.status });
    if (action === "send" || action === "key") {
      sent.push({ id: s.id, body: { action, ...body } });
      if (action === "send" && body.text === "finish") s.status = "idle";
      return json({ ok: true });
    }
    if (action === "wait") {
      const until = u.searchParams.get("until")!, timeout = Number(u.searchParams.get("timeout"));
      const hit = () => (until === "settled" ? s.status !== "running" : s.status === until);
      const end = Date.now() + timeout * 1000;
      while (!hit() && Date.now() < end) await Bun.sleep(50);
      return json({ session: s, reached: hit() });
    }
    if (action === "kill") { s.status = "exited"; s.exitCode = 1; return json({ ok: true }); }
    if (action === "restart") { s.status = "running"; return json({ session: s }); }
    if (action === "done") {
      sent.push({ id: s.id, body: { action, ...body } });
      if (body.kill) s.status = "exited";
      return json({ closed: body.completeTasks ? s.taskIds.filter((t: string) => t !== "t99") : [],
        failed: body.completeTasks && s.taskIds.includes("t99") ? [{ id: "t99", error: "No task t99." }] : [] });
    }
    return json({ error: "No such endpoint." }, 404);
  },
});

async function run(args: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, AGENTIC_APP_URL: `http://127.0.0.1:${server.port}`, AGENTIC_APP_TOKEN_PATH: TOKEN,
      // term never opens the DB; point it somewhere that would fail loudly if it did.
      AGENTOS_DB: join(TOKEN, "agentos.db"), ...env },
  });
  const [text, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { text, err, code: await proc.exited };
}
async function cli(...args: string[]): Promise<any> {
  const r = await run([...args, "--json"]);
  try { return { ...JSON.parse(r.text), code: r.code }; } catch { throw new Error(`not JSON from ${args.join(" ")}: ${r.text}${r.err}`); }
}

describe("term", () => {
  test("new sends kind, project, tasks (repeated and comma lists, t12 form), prompt, mode and copy", async () => {
    const r = await cli("term", "new", "aos", "--kind", "claude", "--task", "t12", "--task", "13,t14", "--prompt", "Fix the bug",
      "--mode", "acceptEdits", "--copy", "--title", "Bug");
    expect(r).toMatchObject({ ok: true, action: "started", id: "ts1", session: { id: "ts1", project: "aos", taskIds: ["t12", "t13", "t14"] } });
    expect(sent[0].body).toEqual({ kind: "claude", project: "aos", title: "Bug", prompt: "Fix the bug", permissionMode: "acceptEdits",
      taskIds: ["t12", "t13", "t14"], copy: true });
    expect((await cli("term", "new", "aos")).ok).toBe(false);
    expect((await cli("term", "new", "aos", "--kind", "claude", "--task", "x1")).error).toContain("not a task id");
  });

  test("human output puts the id first and hints the next step", async () => {
    const r = await run(["term", "new", "--kind", "shell", "--cwd", "C:\\tmp"]);
    expect(r.code).toBe(0);
    expect(r.text.split("\n")[0]).toBe("id: ts1");
    expect(r.text).toContain("agentos term wait ts1 --until needs_input");
    expect(sent[0].body).toEqual({ kind: "shell", cwd: "C:\\tmp" });
  });

  test("list shows live sessions; --all adds exited ones", async () => {
    sessions.push(mk({ project: "aos", status: "idle", taskIds: ["t5"] }), mk({ status: "exited" }));
    const live = await cli("term", "list");
    expect(live.sessions.map((s: any) => s.id)).toEqual(["ts1"]);
    expect(live.maxRunningAgents).toBe(3);
    expect((await cli("term", "list", "--all")).sessions.map((s: any) => s.id)).toEqual(["ts1", "ts2"]);
    const human = await run(["term", "list"]);
    expect(human.text).toContain("sessions[1]{id,kind,status,title,where,tasks}:");
    expect(human.text).toContain("ts1,claude,idle,x,aos,t5");
    expect(human.text).toContain("exited: 1");
  });

  test("show, read, send, key", async () => {
    sessions.push(mk());
    expect((await cli("term", "show", "ts1")).session.id).toBe("ts1");
    const read = await run(["term", "read", "ts1", "--lines", "5"]);
    expect(read.text).toBe("lines=5\n> hello\n");
    expect((await cli("term", "read", "ts1")).text).toContain("lines=60");
    expect((await cli("term", "send", "ts1", "hello there")).ok).toBe(true);
    expect((await cli("term", "send", "ts1", "--no-enter", "y")).enter).toBe(false);
    expect((await cli("term", "key", "ts1", "shift-tab")).ok).toBe(true);
    expect(sent.map((s) => s.body)).toEqual([
      { action: "send", text: "hello there", enter: true },
      { action: "send", text: "y", enter: false },
      { action: "key", key: "shift-tab" },
    ]);
  });

  test("wait exits 0 when reached and 3 when it times out", async () => {
    sessions.push(mk({ status: "needs_input" }));
    const hit = await cli("term", "wait", "ts1", "--until", "needs_input", "--timeout", "5");
    expect(hit).toMatchObject({ reached: true, code: 0 });
    sessions[0].status = "running";
    const miss = await cli("term", "wait", "ts1", "--timeout", "1");
    expect(miss).toMatchObject({ reached: false, until: "settled", code: 3 });
    expect((await run(["term", "wait", "ts1", "--timeout", "0"])).code).toBe(3);
    expect((await cli("term", "wait", "ts1", "--until", "soon")).ok).toBe(false);
  });

  test("done closes linked tasks (or keeps them) and reports failures", async () => {
    sessions.push(mk({ taskIds: ["t5", "t99"] }));
    const r = await cli("term", "done", "ts1");
    expect(r).toMatchObject({ ok: false, closed: ["t5"], failed: [{ id: "t99", error: "No task t99." }] });
    const keep = await cli("term", "done", "ts1", "--keep-tasks", "--kill");
    expect(keep).toMatchObject({ ok: true, closed: [] });
    expect(sent.at(-1)!.body).toEqual({ action: "done", completeTasks: false, kill: true });
  });

  test("kill, restart, remove", async () => {
    sessions.push(mk());
    expect((await cli("term", "kill", "ts1")).action).toBe("killed");
    expect(sessions[0].status).toBe("exited");
    expect((await cli("term", "restart", "ts1")).session.status).toBe("running");
    expect((await cli("term", "remove", "ts1")).action).toBe("removed");
    expect(sessions).toEqual([]);
  });

  test("server errors pass through; a bad token and a dead server say so", async () => {
    const r = await cli("term", "new", "nope", "--kind", "codex");
    expect(r).toMatchObject({ ok: false, error: 'No project "nope".', code: 2 });
    expect((await cli("term", "show", "ts9")).error).toBe("No such terminal session.");
    sessions.push(mk());
    expect((await cli("term", "read", "ts1", "--lines", "abc")).error).toContain("--lines");
    // A phone server from before the terminal API: every /term route is an unknown endpoint.
    const old = await run(["term", "list"], { AGENTIC_APP_URL: `http://127.0.0.1:${server.port}/old` });
    expect(old.text).toContain(`The phone server on port ${server.port} has no terminal API`);
    const bad = join(dir, "bad.token");
    writeFileSync(bad, "wrong");
    const denied = await run(["term", "list", "--json"], { AGENTIC_APP_TOKEN_PATH: bad });
    expect(JSON.parse(denied.text).error).toContain("Not signed in.");
    const dead = await run(["term", "list"], { AGENTIC_APP_URL: "http://127.0.0.1:1" });
    expect(dead.text).toContain("The Agentic OS phone server isn't running on this PC (port 1).");
    expect(dead.code).toBe(2);
    const none = await run(["term", "list", "--json"], { AGENTIC_APP_TOKEN_PATH: join(dir, "no.token") });
    expect(JSON.parse(none.text).error).toContain("Can't read the Agentic OS token");
  });

  test("help lists term", async () => {
    expect((await run(["help"])).text).toContain("agentos term wait <id>");
  });
});

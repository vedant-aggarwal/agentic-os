// GET /bootstrap: jobs in their list shape (briefJob), an ETag (also in the body), 304 for If-None-Match, and the
// native preflight allowing that header. A server on a free port with every data path in a temp folder.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { briefJob } from "./jobs";

const root = mkdtempSync(join(tmpdir(), "aos-bootstrap-"));
mkdirSync(join(root, "data"));
const env = { ...process.env, DATA_DIR: join(root, "data"), OWNER_DB: join(root, "owner.db"), OWNER_EVENTS: join(root, "events.json"),
  MOD_SCHEDULER: "off", AI_PREFETCH: "off" };
let child: ReturnType<typeof Bun.spawn>;
let base = "", token = "";
beforeAll(async () => {
  const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = listener.port;
  listener.stop(true);
  base = `http://127.0.0.1:${port}`;
  const cwd = resolve(import.meta.dir, "..");
  const inv = Bun.spawnSync([process.execPath, "server/admin.ts", "invite", "--owner"], { cwd, env });
  const code = new TextDecoder().decode(inv.stdout).match(/Invite code: (\S+)/)?.[1];
  if (!code) throw new Error(`No invite: ${new TextDecoder().decode(inv.stderr)}`);
  child = Bun.spawn([process.execPath, "server/index.ts"], { cwd, stdout: "ignore", stderr: "pipe", env: { ...env, PORT: String(port) } });
  for (let n = 0; n < 100; n++) {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${await new Response(child.stderr).text()}`);
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {}
    await Bun.sleep(100);
  }
  const r = await fetch(`${base}/api/v1/auth/signup`, { method: "POST", headers: { "Content-Type": "application/json", "X-Client": "native" },
    body: JSON.stringify({ email: "owner@test.local", password: "test-only-pass", name: "Owner", invite: code }) });
  token = (await r.json()).token;
  if (!token) throw new Error(`Signup failed: ${r.status}`);
}, 20000);
afterAll(async () => { child?.kill(); if (child) await child.exited; try { rmSync(root, { recursive: true, force: true }); } catch {} });

test("bootstrap carries an etag and answers 304 while nothing changed", async () => {
  const headers = { Authorization: `Bearer ${token}` };
  const a = await fetch(`${base}/api/v1/bootstrap`, { headers });
  expect(a.status).toBe(200);
  const body = await a.json();
  expect(body.etag).toMatch(/^W\/"[0-9a-z]+"$/);
  expect(a.headers.get("ETag")).toBe(body.etag);
  await Bun.sleep(5);   // today.now moves; the tag doesn't
  const b = await fetch(`${base}/api/v1/bootstrap`, { headers: { ...headers, "If-None-Match": body.etag } });
  expect(b.status).toBe(304);
  expect(await b.text()).toBe("");
  expect(b.headers.get("ETag")).toBe(body.etag);
  // a change on the PC gives a new tag and the whole body again
  await fetch(`${base}/api/v1/tasks`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ title: "A new task" }) });
  const c = await fetch(`${base}/api/v1/bootstrap`, { headers: { ...headers, "If-None-Match": body.etag } });
  expect(c.status).toBe(200);
  expect((await c.json()).etag).not.toBe(body.etag);
});

test("the iPhone app may send If-None-Match and read the ETag", async () => {
  const pre = await fetch(`${base}/api/v1/bootstrap`, { method: "OPTIONS", headers: { Origin: "capacitor://localhost", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization,if-none-match" } });
  expect(pre.status).toBe(204);
  expect(pre.headers.get("Access-Control-Allow-Headers")).toContain("If-None-Match");
  const r = await fetch(`${base}/api/v1/bootstrap`, { headers: { Origin: "capacitor://localhost", Authorization: `Bearer ${token}` } });
  expect(r.headers.get("Access-Control-Expose-Headers")).toContain("ETag");
});

test("briefJob keeps what the lists use and leaves out the prompt, summary and step detail", () => {
  const full = {
    id: "j1", title: "Fix it", status: "done", lastText: "Done: the fix is in.", context: "x".repeat(5000), summary: "y".repeat(3000),
    usage: { input: 1, output: 2 }, dropped: [[1, 2]], workspace: { branch: "aos/j1", files: 3, add: 10, del: 2 },
    progress: { id: "todo", title: "Plan", source: "todo", state: "running", note: "n", stages: [{ name: "Tasks", steps: [{ title: "a", status: "done" }, { title: "b", status: "active" }] }], done: 1, total: 2, active: "b", stage: "Tasks", updatedAt: "2026-10-23T00:00:00Z" },
    cache: { state: "warm", warmUntil: "2026-10-23T01:00:00Z", keepWarmUntil: null, keepWarm: null, ttlMin: 60, lastAt: "2026-10-23T00:00:00Z", last: { read: 1 }, tokens: 5, pingMiss: null },
  };
  const b: any = briefJob(full);
  for (const k of ["context", "summary", "usage", "dropped"]) expect(k in b).toBe(false);
  expect(b).toMatchObject({ id: "j1", title: "Fix it", status: "done", lastText: "Done: the fix is in.", workspace: full.workspace });
  expect(b.progress).toEqual({ id: "todo", title: "Plan", source: "todo", state: "running", done: 1, total: 2, active: "b", stage: "Tasks", updatedAt: "2026-10-23T00:00:00Z" });
  expect(b.cache).toEqual({ state: "warm", warmUntil: "2026-10-23T01:00:00Z", keepWarmUntil: null, keepWarm: null, ttlMin: 60, lastAt: "2026-10-23T00:00:00Z" });
  expect(briefJob({ id: "j2", progress: null, cache: null })).toEqual({ id: "j2", progress: null, cache: null });
});

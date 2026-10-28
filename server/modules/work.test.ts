// Work module: one-file revert and its undo on real checkpoints, repo facts, the two store collections, the night
// shift with an injected fetch, and the agent tools. Everything lives in a temp folder.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openCheckpoints } from "../checkpoints";
import { collectionDDL } from "./_collection";
import { work } from "./work";
import { activityOf, parseStatus } from "./work-repo";
import { NIGHT, REVIEWS, night } from "./work-store";
import { nightReport, runNightShift } from "./work-night";
import { workTools } from "./work-tools";
import type { Fetch } from "./work-api";

const root = mkdtempSync(join(tmpdir(), "aos-work-mod-"));
const dataDir = join(root, "data");
mkdirSync(join(dataDir, "jobs"), { recursive: true });
writeFileSync(join(dataDir, "agent.token"), "test-token\n");
const dbPath = join(root, "agentos.db");
const db = new Database(dbPath);
db.exec(`CREATE TABLE jobs (id INTEGER PRIMARY KEY, title TEXT, cwd TEXT, status TEXT);
  CREATE TABLE projects (slug TEXT PRIMARY KEY, name TEXT, folder TEXT);
  CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, status TEXT);`);
db.exec(collectionDDL(REVIEWS));
db.exec(collectionDDL(NIGHT));
afterAll(() => { db.close(); Bun.gc(true); try { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); } catch {} });

const pushes: any[][] = [];
function ctxFor(method = "GET", path = "/", body?: unknown, o: { owner?: boolean; db?: Database } = {}): any {
  const url = new URL(`http://x/api/v1/mod/work${path}`);
  return {
    method, path: url.pathname.replace("/api/v1/mod/work", "") || "/", url, owner: o.owner ?? true, user: { id: 1, email: "v@x" },
    db: () => o.db ?? db, dbPath: o.db ? ":memory:" : dbPath, dataDir, conf: (k: string, d: string) => (k === "PORT" ? "8299" : d),
    log: () => {}, agentos: async () => null, push: async (...a: any[]) => { pushes.push(a); },
    body: async () => body, json: (d: unknown, s = 200) => Response.json(d, { status: s }), fail: (s: number, m: string) => Response.json({ error: m }, { status: s }),
  };
}
async function call(method: string, path: string, body?: unknown, o: { owner?: boolean; db?: Database } = {}) {
  const r = await work.handle(ctxFor(method, path, body, o));
  return r ? { status: r.status, json: (await r.json()) as any } : null;
}

// A job whose folder went through one real turn: before and after snapshots in its private checkpoint store.
async function jobWith(id: number, files: Record<string, string>, change: (cwd: string) => void, status = "idle") {
  const cwd = join(root, `job${id}`);
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(cwd, f, ".."), { recursive: true }); writeFileSync(join(cwd, f), text); }
  const ck = openCheckpoints(dataDir);
  const before = (await ck.snapshot(id, cwd)).tree;
  change(cwd);
  const after = (await ck.snapshot(id, cwd)).tree;
  expect(before).toMatch(/^[0-9a-f]{40}$/);
  const at = new Date().toISOString();
  // turn 1 is a keep-warm ping (no checkpoint), so "before the job" has to find turn 2
  writeFileSync(join(dataDir, "jobs", `${id}.meta.json`), JSON.stringify({ driver: "native", plan: false, usage: null,
    turns: [{ n: 1, seq: 1, at, before: null, ping: true }, { n: 2, seq: 2, at, before, after, files: 3 }] }));
  db.query("INSERT INTO jobs (id, title, cwd, status) VALUES (?, ?, ?, ?)").run(id, `Job ${id}`, cwd, status);
  return cwd;
}
const read = (p: string) => readFileSync(p, "utf8");

describe("revert one file, and undo it", () => {
  let cwd = "";
  beforeAll(async () => {
    cwd = await jobWith(7, { "a.txt": "one\n", "gone.txt": "old\n", "sub/c.txt": "c1\n", "keep.txt": "same\n" }, (d) => {
      writeFileSync(join(d, "a.txt"), "two\n");
      writeFileSync(join(d, "new.txt"), "brand new\n");
      rmSync(join(d, "gone.txt"));
      writeFileSync(join(d, "sub", "c.txt"), "c2\n");
      writeFileSync(join(d, "debug.log"), "ignored by the checkpoint\n");
    });
  });

  test("a modified file goes back to before the job, and restore-file puts the job's version back", async () => {
    const r = await call("POST", "/jobs/j7/revert-file", { path: "a.txt" });
    expect(r!.status).toBe(200);
    expect(r!.json).toMatchObject({ path: "a.txt", turn: 2, action: "restored", undo: { path: "a.txt" } });
    expect(r!.json.undo.blob).toMatch(/^[0-9a-f]{40}$/);
    expect(read(join(cwd, "a.txt"))).toBe("one\n");
    expect((await call("POST", "/jobs/7/revert-file", { path: "a.txt", turn: 2 }))!.json.action).toBe("unchanged");
    const u = await call("POST", "/jobs/j7/restore-file", r!.json.undo);
    expect(u!.json).toMatchObject({ path: "a.txt", action: "restored" });
    expect(read(join(cwd, "a.txt"))).toBe("two\n");
  });

  test("a file the job added is removed, and its undo brings it back", async () => {
    const r = await call("POST", "/jobs/j7/revert-file", { path: "new.txt" });
    expect(r!.json).toMatchObject({ path: "new.txt", action: "removed" });
    expect(r!.json.undo.blob).toMatch(/^[0-9a-f]{40}$/);
    expect(existsSync(join(cwd, "new.txt"))).toBe(false);
    expect((await call("POST", "/jobs/j7/restore-file", r!.json.undo))!.json.action).toBe("restored");
    expect(read(join(cwd, "new.txt"))).toBe("brand new\n");
  });

  test("a file the job deleted comes back; its undo (blob null) deletes it again", async () => {
    const r = await call("POST", "/jobs/j7/revert-file", { path: "gone.txt" });
    expect(r!.json).toMatchObject({ action: "restored", undo: { path: "gone.txt", blob: null } });
    expect(read(join(cwd, "gone.txt"))).toBe("old\n");
    expect((await call("POST", "/jobs/j7/restore-file", { path: "gone.txt", blob: null }))!.json.action).toBe("removed");
    expect(existsSync(join(cwd, "gone.txt"))).toBe(false);
  });

  test("backslashes work and become forward slashes", async () => {
    const r = await call("POST", "/jobs/j7/revert-file", { path: "sub\\c.txt" });
    expect(r!.json).toMatchObject({ path: "sub/c.txt", action: "restored" });
    expect(read(join(cwd, "sub", "c.txt"))).toBe("c1\n");
  });

  test("a file git ignores is never deleted", async () => {
    const r = await call("POST", "/jobs/j7/revert-file", { path: "debug.log" });
    expect(r!.status).toBe(409);
    expect(existsSync(join(cwd, "debug.log"))).toBe(true);
  });

  test("bad paths are 400", async () => {
    for (const path of ["../outside.txt", "sub/../../x.txt", "C:/Windows/win.ini", "C:\\Windows\\win.ini", "/etc/passwd", "\\\\server\\share\\x", ".git/config", "a.txt:stream", "sub/CON.txt", "a.txt.", ""]) {
      const r = await call("POST", "/jobs/j7/revert-file", { path });
      expect([path, r!.status]).toEqual([path, 400]);
    }
    expect((await call("POST", "/jobs/j7/restore-file", { path: "../x", blob: null }))!.status).toBe(400);
    expect((await call("POST", "/jobs/j7/restore-file", { path: "a.txt", blob: "not-a-sha" }))!.status).toBe(400);
  });

  test("409 while the agent works, 404 for an unknown job, a job without checkpoints or a turn without one", async () => {
    for (const status of ["running", "starting", "needs_input"]) {
      db.query("UPDATE jobs SET status = ? WHERE id = 7").run(status);
      const r = await call("POST", "/jobs/j7/revert-file", { path: "a.txt" });
      expect(r!.status).toBe(409);
      expect(r!.json.error).toBe("Wait for the agent to finish its turn, or stop it.");
      expect((await call("POST", "/jobs/j7/restore-file", { path: "a.txt", blob: null }))!.status).toBe(409);
    }
    db.query("UPDATE jobs SET status = 'stopped' WHERE id = 7").run();
    expect((await call("POST", "/jobs/j999/revert-file", { path: "a.txt" }))!.status).toBe(404);
    expect((await call("POST", "/jobs/nope/revert-file", { path: "a.txt" }))!.status).toBe(404);
    expect((await call("POST", "/jobs/j7/revert-file", { path: "a.txt", turn: 1 }))!.status).toBe(404);
    expect((await call("POST", "/jobs/j7/restore-file", { path: "a.txt", blob: "0".repeat(40) }))!.status).toBe(404);
    db.query("INSERT INTO jobs (id, title, cwd, status) VALUES (8, 'No meta', ?, 'idle')").run(cwd);
    expect((await call("POST", "/jobs/j8/revert-file", { path: "a.txt" }))!.status).toBe(404);
  });

  test("dropped checkpoints are 409, and only the owner gets in", async () => {
    const metaFile = join(dataDir, "jobs", "7.meta.json");
    const meta = JSON.parse(read(metaFile));
    writeFileSync(metaFile, JSON.stringify({ ...meta, ckptDropped: true }));
    expect((await call("POST", "/jobs/j7/revert-file", { path: "a.txt" }))!.status).toBe(409);
    writeFileSync(metaFile, JSON.stringify(meta));
    expect((await call("POST", "/jobs/j7/revert-file", { path: "a.txt" }, { owner: false }))!.status).toBe(403);
    expect((await call("GET", "/night", undefined, { owner: false }))!.status).toBe(403);
  });
});

describe("repo facts", () => {
  const git = (cwd: string, ...args: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "user.name=Test", "-c", "user.email=t@example.com", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    return r.stdout.toString();
  };

  test("a repo: branch, dirty files, commits, 14 days of activity and the scripts", async () => {
    const repo = join(root, "repo");
    mkdirSync(join(repo, "app"), { recursive: true });
    git(repo, "init", "-q", "-b", "main");
    writeFileSync(join(repo, "README.md"), "# Demo\n");
    writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { dev: "bun dev", test: "bun test" } }));
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "First commit");
    writeFileSync(join(repo, "app", "x.ts"), "export {}\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "Add the app");
    writeFileSync(join(repo, "README.md"), "# Demo, edited\n");
    writeFileSync(join(repo, "notes.txt"), "draft\n");
    db.query("INSERT INTO projects (slug, name, folder) VALUES ('demo', 'Demo', ?)").run(repo);

    const r = await call("GET", `/repo?project=demo`);
    expect(r!.status).toBe(200);
    const j = r!.json;
    expect(j).toMatchObject({ repo: true, branch: "main", upstream: null, ahead: null, behind: null, dirtyCount: 2 });
    expect(j.root.toLowerCase()).toBe(repo.toLowerCase());
    expect(j.dirty).toEqual([{ path: "README.md", status: "M" }, { path: "notes.txt", status: "??" }]);
    expect(j.commits.map((c: any) => c.subject)).toEqual(["Add the app", "First commit"]);
    expect(j.commits[0].sha).toMatch(/^[0-9a-f]{7,}$/);
    expect(Number.isNaN(Date.parse(j.commits[0].at))).toBe(false);
    expect(j.activity).toHaveLength(14);
    expect(j.activity[13]).toBe(2);
    expect(j.scripts).toEqual([{ name: "dev", cmd: "bun dev" }, { name: "test", cmd: "bun test" }]);

    // a subfolder without its own package.json gets the root's scripts
    const sub = await call("GET", `/repo?folder=${encodeURIComponent(join(repo, "app"))}`);
    expect(sub!.json).toMatchObject({ repo: true, scripts: [{ name: "dev", cmd: "bun dev" }, { name: "test", cmd: "bun test" }] });
  });

  test("a plain folder is repo: false; missing folders and projects are 404", async () => {
    const plain = join(root, "plain");
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, "package.json"), JSON.stringify({ scripts: { build: "node build.mjs" } }));
    const r = await call("GET", `/repo?folder=${encodeURIComponent(plain)}`);
    expect(r!.json).toEqual({ folder: plain, repo: false, scripts: [{ name: "build", cmd: "node build.mjs" }] });
    expect((await call("GET", `/repo?folder=${encodeURIComponent(join(root, "missing"))}`))!.status).toBe(404);
    expect((await call("GET", "/repo?project=nope"))!.status).toBe(404);
    expect((await call("GET", "/repo"))!.status).toBe(400);
  });

  test("status and activity parsing", () => {
    expect(parseStatus(" M a.ts\0R  new.ts\0old.ts\0?? n.txt\0")).toEqual([{ path: "a.ts", status: "M" }, { path: "new.ts", status: "R" }, { path: "n.txt", status: "??" }]);
    const now = new Date("2026-10-22T12:00:00Z"); // 17:30 IST
    const at = (iso: string) => Date.parse(iso) / 1000;
    const a = activityOf([at("2026-10-22T10:00:00Z"), at("2026-10-21T19:00:00Z"), at("2026-10-21T18:00:00Z"), at("2026-10-09T00:00:00Z"), at("2026-10-01T00:00:00Z")], now);
    // 2026-10-21T19:00Z is 00:30 IST on the 22nd; 18:00Z is 23:30 IST on the 21st; the 9th IST is day 0
    expect(a).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2]);
  });
});

describe("the store collections", () => {
  test("reviews and night round-trip: PUT, then GET since the cursor", async () => {
    const first = await call("GET", "/reviews");
    expect(first!.status).toBe(200);
    const cursor = first!.json.cursor;
    const put = await call("PUT", "/reviews/r_1", { job: "j7", path: "a.txt", mark: "reverted", turn: 2, blob: "a".repeat(40), noted: true, updated_at: "2026-10-22T10:00:00.000Z" });
    expect(put!.status).toBe(200);
    expect(put!.json.item).toMatchObject({ id: "r_1", job: "j7", path: "a.txt", mark: "reverted", turn: 2, noted: true, deleted_at: null });
    const since = await call("GET", `/reviews?since=${cursor}`);
    expect(since!.json.items.map((x: any) => x.id)).toEqual(["r_1"]);
    expect(Number(since!.json.cursor)).toBeGreaterThan(Number(cursor));
    expect((await call("GET", `/reviews?since=${since!.json.cursor}`))!.json.items).toEqual([]);
    for (const bad of [{ job: "x7", path: "a" }, { job: "j7", path: " " }, { job: "j7", path: "a", mark: "maybe" }])
      expect((await call("PUT", "/reviews/r_bad", bad))!.status).toBe(400);

    const n0 = (await call("GET", "/night"))!.json.cursor;
    const n = await call("PUT", "/night/n_x", { date: "2026-10-22", state: "queued", engine: "claude", mode: "plan", prompt: "Plan the apps", title: "Plan", worktree: true });
    expect(n!.json.item).toMatchObject({ id: "n_x", date: "2026-10-22", state: "queued", engine: "claude", mode: "plan", prompt: "Plan the apps", worktree: true });
    expect((await call("GET", `/night?since=${n0}`))!.json.items.map((x: any) => x.id)).toEqual(["n_x"]);
    for (const bad of [{ date: "2026-02-30", state: "queued", engine: "claude", prompt: "x" }, { date: "2026-13-01", state: "queued", engine: "claude", prompt: "x" },
      { date: "2026-10-22", state: "queued", engine: "gpt", prompt: "x" },
      { date: "2026-10-22", state: "queued", engine: "codex", mode: "fast", prompt: "x" }, { date: "2026-10-22", state: "later", engine: "codex", prompt: "x" },
      { date: "2026-10-22", state: "queued", engine: "codex" }])
      expect((await call("PUT", "/night/n_bad", bad))!.status).toBe(400);
    expect((await call("DELETE", "/night/n_x"))!.json.item.deleted_at).toBeTruthy();
  });

  test("without the tables the collection answers 503", async () => {
    const empty = new Database(":memory:");
    expect((await call("GET", "/reviews", undefined, { db: empty }))!.status).toBe(503);
    empty.close();
  });
});

describe("the night shift", () => {
  const day = "2026-10-22";
  const now = new Date("2026-10-22T17:35:00Z"); // 23:05 IST
  const queue = (id: string, doc: any) => night.upsert(db, { id, state: "queued", engine: "claude", date: day, prompt: `Prompt ${id}`, ...doc });
  const calls: any[] = [];
  const fake: Fetch = async (url, init: any) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, method: init.method, auth: init.headers.Authorization, body });
    if (body.project === "nope") return Response.json({ error: 'No project "nope".' }, { status: 400 });
    return Response.json({ job: { id: `j${100 + calls.length}`, title: body.title ?? String(body.context).split("\n")[0], status: "starting" } }, { status: 201 });
  };
  const row = (id: string) => night.get(db, id);

  test("starts queued rows dated today or earlier through POST /jobs, at most 3, and marks each", async () => {
    db.exec("DELETE FROM work_night");
    db.query("INSERT INTO tasks (id, title, status) VALUES (50, 'Already done', 'done')").run();
    queue("n8", { claimedAt: "2026-10-22T17:30:00.000Z", created_at: "2026-10-22T08:00:00.000Z" });
    queue("n0", { date: "2026-10-20", title: "Old one", created_at: "2026-10-20T09:00:00.000Z" });
    queue("n1", { prompt: "Plan the native apps\nKeep it short.", mode: "plan", engine: "codex", model: "gpt-6.1-sol", effort: "high", project: "pulsechat", task: "t9", worktree: false, created_at: "2026-10-22T10:00:00.000Z" });
    queue("n2", { project: "nope", created_at: "2026-10-22T11:00:00.000Z" });
    queue("n3", { created_at: "2026-10-22T12:00:00.000Z" });
    queue("n4", { created_at: "2026-10-22T13:00:00.000Z" });
    queue("n5", { date: "2026-10-23" });
    queue("n6", { state: "cancelled" });
    queue("n7", { task: "t50", created_at: "2026-10-22T09:00:00.000Z" });

    const out = await runNightShift(ctxFor(), { fetch: fake, now });
    expect(calls).toHaveLength(3);
    expect(calls.every((c) => c.url === "http://127.0.0.1:8299/api/v1/jobs" && c.method === "POST" && c.auth === "Bearer test-token")).toBe(true);
    expect(calls[0].body).toEqual({ engine: "claude", title: "Old one", context: "Prompt n0", mode: "auto", plan: false, worktree: true });
    expect(calls[1].body).toEqual({ engine: "codex", model: "gpt-6.1-sol", effort: "high", taskIds: ["t9"], project: "pulsechat", context: "Plan the native apps\nKeep it short.", mode: "auto", plan: true, worktree: false });
    expect(out.started.map((s) => [s.id, s.job])).toEqual([["n0", "j101"], ["n1", "j102"]]);
    expect(out.failed.map((f) => f.id)).toEqual(["n8", "n2"]);
    expect(out.skipped).toEqual(["n7"]);
    expect(out.left).toBe(2);

    expect(row("n0")).toMatchObject({ state: "started", job: "j101", startedAt: now.toISOString(), claimedAt: null });
    expect(row("n1")).toMatchObject({ state: "started", job: "j102", title: "Plan the native apps" });
    expect(row("n2")).toMatchObject({ state: "failed", error: 'No project "nope".' });
    expect(row("n8").state).toBe("failed");
    expect(row("n7").state).toBe("skipped");
    for (const id of ["n3", "n4", "n5"]) expect(row(id).state).toBe("queued");
    expect(row("n6").state).toBe("cancelled");

    // the next run starts what was left and nothing twice
    const again = await runNightShift(ctxFor(), { fetch: fake, now });
    expect(again.started.map((s) => s.id)).toEqual(["n3", "n4"]);
    expect(calls).toHaveLength(5);
    expect(row("n5").state).toBe("queued");
  });

  test("a catch-up after midnight runs last night's rows, not tonight's", async () => {
    queue("m1", { date: "2026-10-22", created_at: "2026-10-22T10:00:00.000Z" });
    queue("m2", { date: "2026-10-23", created_at: "2026-10-22T11:00:00.000Z" });
    const before = calls.length;
    const out = await runNightShift(ctxFor(), { fetch: fake, now: new Date("2026-10-22T19:10:00Z") });   // 00:40 IST, 23 Oct
    expect(out.started.map((s) => s.id)).toEqual(["m1"]);
    expect(calls.length - before).toBe(1);
    expect(row("m2").state).toBe("queued");
    expect(row("n5").state).toBe("queued");   // the earlier test's row for the 23rd waits too
    db.exec("DELETE FROM work_night WHERE id IN ('m1', 'm2')");   // the tests below count the 22nd's runs
  });

  test("a phone write can't take a started row back to queued", async () => {
    const r = await call("PUT", "/night/n0", { ...row("n0"), state: "queued", updated_at: "2030-01-01T00:00:00.000Z" });
    expect(r!.status).toBe(400);
    expect(r!.json.error).toBe("It already started as j101.");
  });

  test("the 07:00 report names what ran and what didn't start", async () => {
    pushes.length = 0;
    const r = await nightReport(ctxFor(), { now: new Date("2026-10-23T01:30:00Z") });
    expect(pushes).toHaveLength(1);
    expect(pushes[0][0]).toBe("Night shift");
    expect(pushes[0][1]).toBe("4 jobs ran: Old one, Plan the native apps, Prompt n3, Prompt n4. 2 didn't start.");
    expect(pushes[0][2]).toEqual({ kind: "work", url: "agenticos://work/jobs" });
    expect(r!.ran).toEqual(["j101", "j102", "j104", "j105"]);
    expect(await nightReport(ctxFor(), { now: new Date("2026-11-02T01:30:00Z") })).toBeNull();
    expect(pushes).toHaveLength(1);
  });

  test("the scheduler jobs are 23:00 with 180 minutes of catch-up, and 07:00", () => {
    expect(work.jobs!.map((j) => [j.id, j.at, j.catchUpMinutes ?? null])).toEqual([["night-shift", "23:00", 180], ["night-report", "07:00", null]]);
  });
});

describe("agent tools", () => {
  test("the seven tools, with auto only on the reversible ones", () => {
    expect(work.tools!.map((t) => [t.name, !!t.auto])).toEqual([
      ["work_overview", true], ["work_job", true], ["work_add_idea", true], ["work_reply", false],
      ["work_answer", false], ["work_start_job", false], ["work_queue_tonight", false]]);
    for (const t of work.tools!) expect(t.input).toMatchObject({ type: "object" });
  });

  test("work_answer picks the option whose kind matches, on the open request", async () => {
    const posted: any[] = [];
    const pending = { requestId: "req-7", title: "Run bun test server", kind: "command", options: [
      { optionId: "o-1", name: "Allow", kind: "allow_once" }, { optionId: "o-2", name: "Allow for this session", kind: "allow_always" }, { optionId: "o-3", name: "Deny", kind: "reject_once" }] };
    const fake: Fetch = async (url, init: any) => {
      if (init.method === "GET") return Response.json({ job: { id: "j12", status: "needs_input", pending }, events: [] });
      posted.push({ url, body: JSON.parse(init.body) });
      return Response.json({ job: { id: "j12", status: "running" } });
    };
    const answer = workTools(fake).find((t) => t.name === "work_answer")!;
    const r: any = await answer.run(ctxFor(), { job: "12", choice: "always" });
    expect(posted[0]).toEqual({ url: "http://127.0.0.1:8299/api/v1/jobs/j12/permission", body: { requestId: "req-7", optionId: "o-2" } });
    expect(r.say).toBe('Always allowed "Run bun test server" on j12.');
    await answer.run(ctxFor(), { job: "j12", choice: "deny", requestId: "req-7" });
    expect(posted[1].body).toEqual({ requestId: "req-7", optionId: "o-3" });
    await expect(answer.run(ctxFor(), { job: "j12", choice: "allow", requestId: "req-old" })).rejects.toThrow("already answered");
    expect(posted).toHaveLength(2);
  });

  test("work_overview counts lanes the way the board does and lists what the waiting jobs ask", async () => {
    const jobs = [
      { id: "j1", title: "Needs OK", status: "needs_input", lane: "attention", pending: { requestId: "q1", title: "Edit app.js", kind: "edit", options: [] } },
      { id: "j2", title: "Working", status: "running", lane: "working" },
      { id: "j3", title: "Review me", status: "idle", lane: "attention", review: true },
      { id: "j4", title: "Stopped", status: "stopped", lane: "attention" },
      { id: "j5", title: "Finished a turn", status: "idle", lane: "attention", lastText: "Done. Tests pass." },
      { id: "j6", title: "Done", status: "done", lane: "completed" },
      { id: "j7", title: "Builder", status: "needs_input", lane: "attention", role: "builder" },
    ];
    const overview = workTools(async () => Response.json({ jobs })).find((t) => t.name === "work_overview")!;
    const r: any = await overview.run(ctxFor(), {});
    expect(r).toMatchObject({ needs: 2, working: 1, review: 1, stopped: 1 });
    expect(r.needYou).toEqual([
      { id: "j1", title: "Needs OK", project: null, ask: { kind: "permission", text: "Edit app.js", requestId: "q1" } },
      { id: "j5", title: "Finished a turn", project: null, ask: { kind: "reply", text: "Done. Tests pass.", requestId: null } }]);
  });
});

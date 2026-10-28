// End-to-end tests: run the real CLI against a temp DB, and sync against an
// in-memory fake of the Google Tasks API (synthetic data only).
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "agentos-test-"));
const CLI = join(import.meta.dir, "agentos.ts");
let db = "";
let n = 0;
afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

// ── fake Google Tasks ───────────────────────────────────────────────────────
type GTask = { id: string; title: string; notes?: string; status: string; due?: string | null; completed?: string | null;
  parent?: string; position: string; updated: string; deleted?: boolean };
let lists: { id: string; title: string; updated: string }[] = [];
let tasks: Record<string, GTask[]> = {};
let gid = 0;
let clock = Date.parse("2026-10-17T00:00:00Z");
const tick = () => new Date((clock += 1000)).toISOString();
function renumber(list: string, parent?: string) {
  tasks[list].filter((t) => t.parent === parent && !t.deleted).sort((a, b) => (a.position < b.position ? -1 : 1))
    .forEach((t, i) => (t.position = String(i).padStart(20, "0")));
}
function place(list: string, t: GTask, parent: string | undefined, previous: string | null) {
  const sibs = tasks[list].filter((x) => x.parent === parent && !x.deleted && x.id !== t.id).sort((a, b) => (a.position < b.position ? -1 : 1));
  const at = previous ? sibs.findIndex((x) => x.id === previous) + 1 : 0;
  sibs.splice(at, 0, t);
  t.parent = parent;
  sibs.forEach((x, i) => (x.position = String(i).padStart(20, "0")));
}
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const u = new URL(req.url);
    const p = u.pathname;
    const body = req.method === "POST" || req.method === "PATCH" ? await req.json().catch(() => ({})) : {};
    const json = (d: unknown, s = 200) => Response.json(d, { status: s });
    if (p === "/token") return json({ access_token: "fake", expires_in: 3600 });
    let m: RegExpMatchArray | null;
    if (p === "/users/@me/lists" && req.method === "GET") return json({ items: lists });
    if (p === "/users/@me/lists/@default") return json(lists[0]);
    if (p === "/users/@me/lists" && req.method === "POST") {
      const l = { id: `L${++gid}`, title: (body as any).title, updated: tick() };
      lists.push(l);
      tasks[l.id] = [];
      return json(l);
    }
    if ((m = p.match(/^\/users\/@me\/lists\/([^/]+)$/))) {
      const l = lists.find((x) => x.id === m![1])!;
      if (req.method === "DELETE") { lists = lists.filter((x) => x !== l); delete tasks[l.id]; return new Response(null, { status: 204 }); }
      Object.assign(l, body, { updated: tick() });
      return json(l);
    }
    if ((m = p.match(/^\/lists\/([^/]+)\/tasks$/))) {
      const list = m[1];
      if (req.method === "GET") {
        let items = tasks[list] ?? [];
        if (u.searchParams.get("showDeleted") !== "true") items = items.filter((t) => !t.deleted);
        return json({ items });
      }
      const t: GTask = { ...(body as any), id: `T${++gid}`, position: "", updated: tick() };
      tasks[list].push(t);
      place(list, t, u.searchParams.get("parent") ?? undefined, u.searchParams.get("previous"));
      return json(t);
    }
    if ((m = p.match(/^\/lists\/([^/]+)\/tasks\/([^/]+)\/move$/))) {
      const [list, id] = [m[1], m[2]];
      const t = tasks[list].find((x) => x.id === id)!;
      const dest = u.searchParams.get("destinationTasklist");
      if (dest && dest !== list) {
        const moving = tasks[list].filter((x) => x.id === id || x.parent === id);
        tasks[list] = tasks[list].filter((x) => !moving.includes(x));
        tasks[dest].push(...moving);
        place(dest, t, undefined, null);
      } else place(list, t, u.searchParams.get("parent") ?? undefined, u.searchParams.get("previous"));
      t.updated = tick();
      return json(t);
    }
    if ((m = p.match(/^\/lists\/([^/]+)\/tasks\/([^/]+)$/))) {
      const t = tasks[m[1]].find((x) => x.id === m![2])!;
      if (req.method === "DELETE") {
        t.deleted = true;
        tasks[m[1]].filter((x) => x.parent === t.id).forEach((x) => (x.deleted = true));
        return new Response(null, { status: 204 });
      }
      for (const [k, v] of Object.entries(body as object)) (t as any)[k] = v === null ? undefined : v;
      t.updated = tick();
      return json(t);
    }
    return json({ error: { message: `no route ${req.method} ${p}` } }, 404);
  },
});
const base = `http://127.0.0.1:${server.port}`;

async function cli(...args: string[]): Promise<any> {
  const proc = Bun.spawn(["bun", CLI, ...args, "--json"], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, AGENTOS_DB: db, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_GOOGLE_CREDS: join(dir, "creds.json"),
      AGENTOS_GOOGLE_TASKS_API: base, AGENTOS_GOOGLE_TOKEN_URL: `${base}/token` },
  });
  const [text, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`not JSON from ${args.join(" ")}: ${text}${err}`);
  }
}
const sql = (q: string, ...v: any[]) => {
  const d = new Database(db);
  try { return d.query(q).all(...v) as any[]; } finally { d.close(); }
};

beforeEach(() => {
  db = join(dir, `t${++n}.db`);
  lists = [{ id: "DEFAULT", title: "My Tasks", updated: tick() }];
  tasks = { DEFAULT: [] };
  writeFileSync(join(dir, "creds.json"), JSON.stringify({ client_id: "test", refresh_token: "r" }));
});

describe("store v2", () => {
  test("seeds My Tasks plus one list per area", async () => {
    const l = (await cli("lists")).lists;
    expect(l[0]).toMatchObject({ id: "l1", title: "My Tasks", area: null });
    expect(l.find((x: any) => x.area === "college")).toBeTruthy();
  });

  test("migration adds columns even when another branch already set user_version 3", async () => {
    const d = new Database(db, { create: true });
    d.exec(`CREATE TABLE areas (slug TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, sort INTEGER DEFAULT 0, pattern TEXT);
      CREATE TABLE projects (slug TEXT PRIMARY KEY, name TEXT NOT NULL, area TEXT, status TEXT NOT NULL DEFAULT 'active', deadline TEXT, link TEXT, created_at TEXT NOT NULL);
      CREATE TABLE goals (id INTEGER PRIMARY KEY, title TEXT NOT NULL, area TEXT, horizon TEXT NOT NULL DEFAULT 'month', due TEXT, progress INTEGER NOT NULL DEFAULT 0, measure TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT, area TEXT, project TEXT, goal INTEGER, status TEXT NOT NULL DEFAULT 'todo', priority INTEGER NOT NULL DEFAULT 2, due TEXT, start_at TEXT, end_at TEXT, owner TEXT NOT NULL DEFAULT 'me', source TEXT NOT NULL DEFAULT 'cli', external_id TEXT, evidence TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, done_at TEXT);
      INSERT INTO areas VALUES ('college','City College','#000',0,NULL);
      INSERT INTO tasks (title, area, created_at, updated_at) VALUES ('Old', 'college', 'x', 'x');
      PRAGMA user_version = 3;`);
    d.close();
    expect((await cli("show", "t1")).task).toMatchObject({ list: "l2", star: false });
    expect(sql("PRAGMA user_version")[0].user_version).toBe(7);
  });

  test("new tasks go on top, subtasks at the bottom, one level only", async () => {
    await cli("add", "A");
    await cli("add", "B");
    await cli("add", "B1", "--parent", "t2");
    await cli("add", "B2", "--parent", "t2");
    expect((await cli("tasks")).open.map((t: any) => t.title)).toEqual(["B", "B1", "B2", "A"]);
    expect((await cli("add", "deep", "--parent", "t3")).ok).toBe(false);
    expect((await cli("move", "t2", "--parent", "t1")).ok).toBe(false);
  });

  test("move reorders, nests and changes list; subtasks follow", async () => {
    await cli("add", "A"); await cli("add", "B"); await cli("add", "C"); // order C B A
    await cli("move", "t3", "--after", "t1");
    expect((await cli("tasks")).open.map((t: any) => t.title)).toEqual(["B", "A", "C"]);
    await cli("move", "t3", "--parent", "t1");
    expect((await cli("show", "t3")).task.parent).toBe("t1");
    await cli("move", "t1", "--list", "college");
    expect((await cli("tasks", "--list", "college")).open.map((t: any) => t.title)).toEqual(["A", "C"]);
    expect((await cli("show", "t3")).task).toMatchObject({ list: "l2", area: "college" });
    expect((await cli("move", "t1", "--list", "college")).already).toBe(true);
  });

  test("star, due time, date sort and Starred view", async () => {
    await cli("add", "Late", "--due", "2026-12-01");
    await cli("add", "Soon", "--due", "2026-11-01", "--time", "6pm", "--star");
    await cli("add", "Undated");
    expect((await cli("tasks", "--sort", "date")).open.map((t: any) => t.title)).toEqual(["Soon", "Late", "Undated"]);
    const s = await cli("tasks", "starred");
    expect(s.open.map((t: any) => t.title)).toEqual(["Soon"]);
    expect(s.open[0].time).toBe("18:00");
    await cli("unstar", "t2");
    expect((await cli("tasks", "starred")).open).toEqual([]);
  });

  test("completing a repeating task files the next one; parent completion completes subtasks", async () => {
    await cli("add", "Pay rent", "--due", "2026-10-31", "--repeat", "monthly");
    const r = await cli("done", "t1");
    expect(r.next).toMatchObject({ title: "Pay rent", due: "2026-11-30", repeat: "1m" });
    await cli("add", "Parent"); await cli("add", "Kid", "--parent", "t3");
    await cli("done", "t3");
    expect((await cli("show", "t4")).task.status).toBe("done");
    expect((await cli("add", "x", "--repeat", "fortnightly")).ok).toBe(false);
    expect((await cli("add", "y", "--repeat", "every 2 weeks")).task.repeat).toBe("2w");
    expect((await cli("add", "z", "--repeat", "mon,thu")).task.repeat).toBe("days:mon,thu");
  });
});

describe("ai proposals (v6)", () => {
  test("creates the tables, lists batches with counts, stores plan rules", async () => {
    expect((await cli("ai")).batches).toEqual([]);
    expect(sql("PRAGMA user_version")[0].user_version).toBeGreaterThanOrEqual(6);
    const d = new Database(db);
    d.exec(`INSERT INTO ai_batches (kind, date, model, created_at) VALUES ('plan', '2026-10-18', 'sonnet', '2026-10-18T01:30:00Z');
      INSERT INTO ai_proposals (batch_id, kind, task_id, payload, reason, status, created_at) VALUES
        (1, 'place', 3, '{"start":"x"}', 'Due today', 'kept', '2026-10-18T01:30:00Z'),
        (1, 'place', 4, '{}', '2 days late', 'removed', '2026-10-18T01:30:00Z'),
        (1, 'new', NULL, '{"title":"Chai"}', 'Human rep', 'open', '2026-10-18T01:30:00Z');`);
    d.close();
    expect((await cli("ai")).batches[0]).toMatchObject({ id: "b1", kind: "plan", open: 1, kept: 1, removed: 1 });
    const show = await cli("ai", "show", "b1");
    expect(show.proposals.map((p: any) => p.status)).toEqual(["kept", "removed", "open"]);
    expect(show.proposals[2].payload).toEqual({ title: "Chai" });
    expect((await cli("ai", "rules", "One in-person rep a day.")).rules).toBe("One in-person rep a day.");
    expect((await cli("ai", "rules")).rules).toBe("One in-person rep a day.");
    expect((await cli("ai", "rules", "none")).rules).toBe(null);
  });
});

describe("google tasks sync", () => {
  test("first sync pushes lists and open tasks, pulls Google's tasks, keeps order", async () => {
    tasks.DEFAULT.push({ id: "G1", title: "From phone", status: "needsAction", position: "00000000000000000000", updated: tick(), due: "2026-10-20T00:00:00.000Z" });
    await cli("add", "Local one");
    await cli("add", "Local kid", "--parent", "t1");
    const r = await cli("sync", "google-tasks");
    expect(r.ok).toBe(true);
    expect(r.created_local).toBe(1);
    expect(r.created_remote).toBe(2);
    expect(lists.length).toBe(8);
    const kid = tasks.DEFAULT.find((t) => t.title === "Local kid")!;
    expect(kid.parent).toBe(tasks.DEFAULT.find((t) => t.title === "Local one")!.id);
    const phone = (await cli("tasks")).open.find((t: any) => t.title === "From phone");
    expect(phone).toMatchObject({ due: "2026-10-20", list: "l1" });
    // Nothing changed: a second run writes nothing.
    const again = await cli("sync", "google-tasks");
    expect([again.pushed, again.pulled, again.created_local, again.created_remote]).toEqual([0, 0, 0, 0]);
  });

  test("edits flow both ways; both-side edits resolve to the later one and are logged", async () => {
    await cli("add", "Shared");
    await cli("sync", "google-tasks");
    const g = tasks.DEFAULT[0];
    // Google edit only
    g.title = "Shared (phone)"; g.updated = new Date(Date.now() + 5_000).toISOString();
    await cli("sync", "google-tasks");
    expect((await cli("show", "t1")).task.title).toBe("Shared (phone)");
    // Local edit only
    await Bun.sleep(5);
    await cli("update", "t1", "--notes", "from laptop", "--due", "2026-11-02");
    await cli("sync", "google-tasks");
    expect(g).toMatchObject({ notes: "from laptop", due: "2026-11-02T00:00:00.000Z" });
    // Both: local first, Google later → Google wins
    await Bun.sleep(5);
    await cli("update", "t1", "--title", "laptop title");
    g.title = "phone title"; g.updated = new Date(Date.now() + 60_000).toISOString();
    const r = await cli("sync", "google-tasks");
    expect(r.conflicts).toBe(1);
    expect(r.conflict_log[0].winner).toBe("remote");
    expect((await cli("show", "t1")).task.title).toBe("phone title");
    expect((await cli("sync", "status")).conflicts.length).toBe(1);
  });

  test("completion, deletion and local-only fields", async () => {
    await cli("add", "Starred with time", "--star", "--due", "2026-10-25", "--time", "9am");
    await cli("add", "Doomed");
    await cli("sync", "google-tasks");
    const starred = tasks.DEFAULT.find((t) => t.title === "Starred with time")!;
    starred.status = "completed"; starred.completed = new Date().toISOString(); starred.updated = new Date(Date.now() + 5_000).toISOString();
    await cli("drop", "t2");
    await cli("sync", "google-tasks");
    const t1 = (await cli("show", "t1")).task;
    expect(t1).toMatchObject({ status: "done", star: true, time: "09:00" });
    expect(tasks.DEFAULT.find((t) => t.title === "Doomed")!.deleted).toBe(true);
    // Deleted on the phone → dropped here
    await cli("reopen", "t1");
    await cli("sync", "google-tasks");
    starred.deleted = true; starred.updated = new Date(Date.now() + 10_000).toISOString();
    await cli("sync", "google-tasks");
    expect((await cli("show", "t1")).task.status).toBe("dropped");
  });

  test("reorder and list moves made here reach Google", async () => {
    await cli("add", "A"); await cli("add", "B"); await cli("add", "C");
    await cli("sync", "google-tasks");
    await cli("move", "t3", "--after", "t1"); // B A C
    await cli("sync", "google-tasks");
    const order = () => tasks.DEFAULT.filter((t) => !t.deleted && !t.parent).sort((a, b) => (a.position < b.position ? -1 : 1)).map((t) => t.title);
    expect(order()).toEqual(["B", "A", "C"]);
    await cli("move", "t2", "--list", "college");
    await cli("sync", "google-tasks");
    const college = lists.find((l) => l.title === "City College")!;
    expect(tasks[college.id].map((t) => t.title)).toEqual(["B"]);
    expect(order()).toEqual(["A", "C"]);
    expect((await cli("show", "t2")).task.status).toBe("todo");
  });

  test("dry run reports without writing anywhere", async () => {
    await cli("add", "Not yet");
    const r = await cli("sync", "google-tasks", "--dry-run");
    expect(r.dry_run).toBe(true);
    expect(r.lists_pushed).toBe(7);
    expect(lists.length).toBe(1);
    expect(sql("SELECT count(*) n FROM sync_links")[0].n).toBe(0);
  });

  test("not connected gives the auth command", async () => {
    rmSync(join(dir, "creds.json"));
    const r = await cli("sync", "google-tasks");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("auth --client");
  });
});

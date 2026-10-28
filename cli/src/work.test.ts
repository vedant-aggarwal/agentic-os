// Schema v7 (the Work build): project fields, ideas, and the read-only job commands. Runs the real CLI on temp DBs.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "agentos-work-"));
const CLI = join(import.meta.dir, "agentos.ts");
let db = "";
let n = 0;
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => { db = join(dir, `w${++n}.db`); });

async function cli(...args: string[]): Promise<any> {
  const proc = Bun.spawn(["bun", CLI, ...args, "--json"], {
    stdout: "pipe", stderr: "pipe", env: { ...process.env, AGENTOS_DB: db, AGENTOS_EVENTS: join(dir, "none.json") },
  });
  const [text, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  await proc.exited;
  try { return JSON.parse(text); } catch { throw new Error(`not JSON from ${args.join(" ")}: ${text}${err}`); }
}
const sql = (q: string, ...v: any[]) => {
  const d = new Database(db);
  try { return d.query(q).all(...v) as any[]; } finally { d.close(); }
};

describe("schema v7", () => {
  test("a v6 file gains project columns and the idea/job tables; a second run is a no-op", async () => {
    await cli("area");
    const d = new Database(db);
    d.exec("PRAGMA user_version = 6");
    d.close();
    await cli("area");
    expect(sql("PRAGMA user_version")[0].user_version).toBe(7);
    const cols = sql("PRAGMA table_info(projects)").map((c) => c.name);
    for (const c of ["description", "folder", "color", "icon", "goal", "sort", "updated_at"]) expect(cols).toContain(c);
    for (const t of ["ideas", "jobs", "job_tasks"]) expect(sql("SELECT name FROM sqlite_master WHERE name = ?", t).length).toBe(1);
    await cli("area");
    expect(sql("PRAGMA user_version")[0].user_version).toBe(7);
  });

  test("a file another branch already bumped past 7 still gets the tables", async () => {
    await cli("area");
    const d = new Database(db);
    d.exec("DROP TABLE job_tasks; DROP TABLE jobs; DROP TABLE ideas; PRAGMA user_version = 8");
    d.close();
    await cli("area");
    expect(sql("SELECT name FROM sqlite_master WHERE name = 'ideas'").length).toBe(1);
    expect(sql("PRAGMA user_version")[0].user_version).toBe(8);
  });
});

describe("projects", () => {
  test("add and set take folder, description, icon, color, goal and status; show returns the sections", async () => {
    const r = await cli("project", "add", "aos", "Agentic OS", "--area", "projects", "--folder", "C:\\code\\aos", "--description", "The hub", "--icon", "🧭", "--color", "#123456");
    expect(r.project).toMatchObject({ slug: "aos", name: "Agentic OS", area: "projects", folder: "C:\\code\\aos", description: "The hub", icon: "🧭",
      color: "#123456", status: "active", counts: { tasks: 0, ideas: 0, jobs: 0 } });
    expect((await cli("project", "set", "aos", "--status", "nope")).ok).toBe(false);
    const s = await cli("project", "set", "aos", "--status", "paused", "--folder", "none");
    expect(s.project).toMatchObject({ status: "paused", folder: null });
    await cli("add", "Ship it", "--project", "aos");
    await cli("idea", "add", "Voice notes", "--project", "aos");
    const show = await cli("project", "show", "aos");
    expect(show.project.counts).toEqual({ tasks: 1, ideas: 1, jobs: 0 });
    expect(show.tasks.map((t: any) => t.title)).toEqual(["Ship it"]);
    expect(show.ideas.map((i: any) => i.title)).toEqual(["Voice notes"]);
    expect(show.jobs).toEqual([]);
    expect((await cli("project")).projects[0].slug).toBe("aos");
  });
});

describe("ideas", () => {
  test("add, list, set, task and drop", async () => {
    await cli("project", "add", "aos", "Agentic OS", "--area", "projects");
    const a = await cli("idea", "add", "Inbox idea", "--body", "details", "--source", "siri");
    expect(a.idea).toMatchObject({ id: "i1", title: "Inbox idea", body: "details", project: null, status: "open", source: "siri", taskId: null });
    expect((await cli("idea", "add", "x", "--source", "fax")).ok).toBe(false);
    await cli("idea", "add", "Project idea", "--project", "aos");
    expect((await cli("idea", "list")).ideas.map((i: any) => i.id)).toEqual(["i2", "i1"]);
    expect((await cli("idea", "list", "--project", "none")).ideas.map((i: any) => i.id)).toEqual(["i1"]);
    expect((await cli("idea", "list", "--project", "aos")).ideas.map((i: any) => i.id)).toEqual(["i2"]);

    // No project and no date: the task lands in the inbox, with no due date.
    const t = await cli("idea", "task", "i1");
    expect(t.task).toMatchObject({ title: "Inbox idea", status: "inbox", due: null });
    expect(t.idea).toMatchObject({ status: "tasked", taskId: t.task.id });
    expect((await cli("idea", "task", "i1")).already).toBe(true);
    // With a project it is a normal task in that project.
    const t2 = await cli("idea", "task", "i2");
    expect(t2.task).toMatchObject({ status: "todo", due: null });
    expect((await cli("show", t2.task.id)).task.project).toBe("aos");

    const i3 = (await cli("idea", "add", "Move me")).idea.id;
    expect((await cli("idea", "set", i3, "--project", "aos", "--title", "Moved")).idea).toMatchObject({ project: "aos", title: "Moved" });
    expect((await cli("idea", "drop", i3)).idea.status).toBe("archived");
    expect((await cli("idea", "list")).ideas).toEqual([]);
    expect((await cli("idea", "list", "--status", "all")).ideas.length).toBe(3);
  });
});

describe("jobs (read-only)", () => {
  test("list and show read rows the phone server wrote", async () => {
    await cli("area");
    const d = new Database(db);
    d.exec(`INSERT INTO tasks (id, title, created_at, updated_at) VALUES (5, 'T', 'x', 'x');
      INSERT INTO jobs (id, title, engine, status, cwd, prompt, mode, created_at, updated_at) VALUES (2, 'Do it', 'codex', 'idle', 'C:\\tmp', 'go', 'ask', 'a', 'b');
      INSERT INTO job_tasks VALUES (2, 5);`);
    d.close();
    expect((await cli("job", "list")).jobs[0]).toMatchObject({ id: "j2", engine: "codex", status: "idle", taskIds: ["t5"], mode: "ask" });
    expect((await cli("job", "show", "j2")).job).toMatchObject({ id: "j2", prompt: "go" });
    expect((await cli("job", "show", "j9")).ok).toBe(false);
  });
});

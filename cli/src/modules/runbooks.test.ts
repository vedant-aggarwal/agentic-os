// Runbooks through the real CLI on a throwaway DB: the title key, scan -> draft book with the
// evidence trail, ready, today's matches, and run reconciliation.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bookKey, normKey } from "./runbooks";

const dir = mkdtempSync(join(tmpdir(), "agentos-runbooks-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* a temp dir left behind is harmless */ } });

function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], {
    env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") },
  });
  return { text: r.stdout.toString(), code: r.exitCode };
}
const json = (...args: string[]) => JSON.parse(cli(...args, "--json").text);
const withDb = <T>(f: (d: Database) => T): T => { const d = new Database(dbPath); try { return f(d); } finally { d.close(); } };
const SLOW = 60_000;
const at = (d: string) => `${d}T10:00:00.000Z`;

describe("runbooks", () => {
  test("normKey strips numbers, ids, versions, dates and urls", () => {
    expect(normKey("Ship iOS build 3")).toBe("ship ios build");
    expect(normKey("Ship iOS build #4 (v1.2.0) https://x.y/z")).toBe("ship ios build");
    expect(normKey("Rotate the API key, 2026-10-18")).toBe("rotate the api key");
    expect(normKey("Backup t12 on 18/10")).toBe("backup on");
    expect(bookKey("Publish site", "northwind")).toBe("northwind|publish site");
    expect(bookKey("Publish site", null)).toBe("|publish site");
  });

  test("scan turns a title done twice with evidence into a draft book with its trail", () => {
    expect(cli("mods").code).toBe(0);
    withDb((d) => {
      const ins = d.query("INSERT INTO tasks (title, status, area, notes, evidence, done_at, created_at, updated_at) VALUES (?, 'done', ?, ?, ?, ?, ?, ?)");
      ins.run("Ship iOS build 3", "projects", "use the 2nd GitHub account", "https://github.com/x/actions/runs/1 (build 3 in TestFlight)", at("2026-10-10"), at("2026-10-10"), at("2026-10-10"));
      ins.run("Ship iOS build 4", "projects", null, "https://github.com/x/actions/runs/2; failed once on signing, fixed with set-ios-secrets.ps1", at("2026-10-16"), at("2026-10-16"), at("2026-10-16"));
      ins.run("Rotate the API key", "northwind", null, "done in 1Password", at("2026-10-12"), at("2026-10-12"), at("2026-10-12"));
      ins.run("Done without proof", "projects", null, null, at("2026-10-12"), at("2026-10-12"), at("2026-10-12"));
      ins.run("Done without proof", "projects", null, null, at("2026-10-13"), at("2026-10-13"), at("2026-10-13"));
    });
    const r = json("runbooks", "scan");
    expect(r).toMatchObject({ ok: true, count: 1 });
    expect(r.books[0]).toMatchObject({ id: 1, title: "Ship iOS build 4", status: "draft", times_done: 2, steps: 2, needs_assembly: true, last_done_at: at("2026-10-16") });
    expect(r.books[0].trail.map((t: any) => t.task)).toEqual(["t1", "t2"]);
    expect(r.books[0].trail[0].notes).toBe("use the 2nd GitHub account");
    const show = json("runbooks", "show", "1");
    expect(show.steps).toHaveLength(2);
    expect(show.steps[0]).toMatchObject({ n: 1, text: "Pass 1: Ship iOS build 3", task: "t1", ok: true, note: "https://github.com/x/actions/runs/1 (build 3 in TestFlight)" });
    expect(show.runs).toEqual([]);
    // A second scan keeps the book and its steps (idempotent), still one book.
    expect(json("runbooks", "scan").count).toBe(1);
    expect(json("runbooks").books).toHaveLength(1);
    expect(cli("runbooks").text).toContain("books[1]{id,title,status,project,area,times_done,last_done_at,steps,needs_assembly,updated_at}:");
  }, SLOW);

  test("ready, today's matches and run reconciliation", () => {
    expect(json("runbooks", "ready", "1")).toMatchObject({ ok: true, book: { id: 1, status: "ready" } });
    withDb((d) => d.query("INSERT INTO tasks (title, status, area, due, created_at, updated_at) VALUES ('Ship iOS build 5', 'todo', 'projects', '2026-10-18', ?, ?)").run(at("2026-10-18"), at("2026-10-18")));
    const today = json("runbooks", "today", "--date", "2026-10-18");
    expect(today.matches).toEqual([{ task: "t6", title: "Ship iOS build 5", status: "todo", due: "2026-10-18", book: 1, book_title: "Ship iOS build 4" }]);
    expect(json("runbooks", "today", "--date", "2026-10-17").matches).toEqual([]);
    // A run whose task got done is closed by the next scan with the evidence as the result.
    withDb((d) => {
      d.query("INSERT INTO runbooks_runs (book_id, task_id, job_id, started_at) VALUES (1, 6, 'job-1', ?)").run(at("2026-10-18"));
      d.query("UPDATE tasks SET status = 'done', done_at = ?, evidence = 'https://github.com/x/actions/runs/3' WHERE id = 6").run(at("2026-10-18"));
    });
    json("runbooks", "scan");
    expect(json("runbooks", "show", "1").runs[0]).toMatchObject({ id: 1, task: "t6", job: "job-1", finished_at: at("2026-10-18"), result: "https://github.com/x/actions/runs/3" });
    expect(json("runbooks", "show", "1").book.times_done).toBe(3);
    expect(json("runbooks", "draft", "1").book.status).toBe("draft");
    const bad = cli("runbooks", "show", "9", "--json");
    expect(bad.code).toBe(2);
  }, SLOW);
});

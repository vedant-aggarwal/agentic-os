import { describe, expect, test, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { periodOf, shiftPeriod, periodLabel } from "./goals";

describe("periods", () => {
  test("weeks start Monday and follow ISO numbering", () => {
    expect(periodOf("week", "2026-10-17")).toEqual({ key: "2026-W42", start: "2026-10-12", end: "2026-10-18" });
    expect(periodOf("week", "2026-12-31").key).toBe("2026-W53");
    expect(periodOf("week", "2027-01-03").key).toBe("2026-W53");
    expect(periodOf("week", "2027-01-04").key).toBe("2027-W01");
  });
  test("months, quarters, years, decades", () => {
    expect(periodOf("month", "2026-02-10")).toEqual({ key: "2026-02", start: "2026-02-01", end: "2026-02-28" });
    expect(periodOf("quarter", "2026-11-05")).toEqual({ key: "2026-Q4", start: "2026-10-01", end: "2026-12-31" });
    expect(periodOf("decade", "2026-01-01").key).toBe("2020s");
    expect(periodOf("life", "2026-01-01")).toEqual({ key: "life", start: null, end: null });
  });
  test("shifting crosses year ends", () => {
    expect(shiftPeriod("week", periodOf("week", "2026-12-28"), 1).key).toBe("2027-W01");
    expect(shiftPeriod("month", periodOf("month", "2026-12-01"), 2).key).toBe("2027-02");
    expect(shiftPeriod("quarter", periodOf("quarter", "2026-10-01"), -4).key).toBe("2025-Q4");
  });
  test("labels", () => {
    expect(periodLabel("week", periodOf("week", "2026-10-17"))).toBe("12–18 Oct");
    expect(periodLabel("week", periodOf("week", "2026-10-28"))).toBe("26 Oct – 1 Nov");
    expect(periodLabel("quarter", periodOf("quarter", "2026-10-17"))).toBe("Q4 2026");
  });
});

// CLI tests run the real entry point against a throwaway store.
let dir = "";
let db = "";
function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", join(import.meta.dir, "agentos.ts"), ...args, "--json"], {
    env: { ...process.env, AGENTOS_DB: db, AGENTOS_EVENTS: join(dir, "none.json") },
  });
  return JSON.parse(r.stdout.toString());
}
const V1_GOALS = `CREATE TABLE areas (slug TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, sort INTEGER DEFAULT 0, pattern TEXT);
  INSERT INTO areas VALUES ('northwind','Northwind','#7c5cff',0,NULL),('content','Content','#f2b134',1,NULL);
  CREATE TABLE projects (slug TEXT PRIMARY KEY, name TEXT NOT NULL, area TEXT, status TEXT NOT NULL DEFAULT 'active', deadline TEXT, link TEXT, created_at TEXT NOT NULL);
  CREATE TABLE goals (id INTEGER PRIMARY KEY, title TEXT NOT NULL, area TEXT REFERENCES areas(slug), horizon TEXT NOT NULL DEFAULT 'month', due TEXT,
    progress INTEGER NOT NULL DEFAULT 0, measure TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
  CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT, area TEXT, project TEXT, goal INTEGER REFERENCES goals(id),
    status TEXT NOT NULL DEFAULT 'todo', priority INTEGER NOT NULL DEFAULT 2, due TEXT, start_at TEXT, end_at TEXT, owner TEXT NOT NULL DEFAULT 'me',
    source TEXT NOT NULL DEFAULT 'cli', external_id TEXT, evidence TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, done_at TEXT);
  INSERT INTO goals (title, area, horizon, due, progress, created_at) VALUES
    ('Revenue', NULL, 'quarter', '2026-12-31', 0, '2026-10-17T04:48:33Z'),
    ('Followers', 'content', 'month', '2026-10-31', 30, '2026-10-17T04:48:33Z'),
    ('Collect', 'northwind', 'week', '2026-10-18', 0, '2026-10-17T04:48:33Z');`;
function seed(version: number, extra = "") {
  const d = new Database(db, { create: true });
  d.exec(V1_GOALS + extra + `PRAGMA user_version = ${version};`);
  d.close();
}
beforeEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = mkdtempSync(join(tmpdir(), "agentos-goals-"));
  db = join(dir, "t.db");
});

describe("migration v3", () => {
  test("v1 goals land in the period holding their due date", () => {
    seed(1);
    const g = cli("goal", "--all").goals;
    expect(g.map((x: any) => [x.id, x.horizon, x.period])).toEqual([
      ["g3", "week", "2026-W42"], ["g2", "month", "2026-10"], ["g1", "quarter", "2026-Q4"],
    ]);
    // A hand-set v1 number is kept as manual progress.
    expect(g.find((x: any) => x.id === "g2").progress).toBe(30);
    const d = new Database(db);
    expect((d.query("PRAGMA user_version").get() as any).user_version).toBe(7);
    d.close();
  });
  test("runs after a tasks v2 step and keeps its columns", () => {
    seed(2, "ALTER TABLE tasks ADD COLUMN v2_marker TEXT;");
    expect(cli("goal").goals.length).toBe(3);
    const d = new Database(db);
    const cols = (d.query("PRAGMA table_info(tasks)").all() as any[]).map((c) => c.name);
    expect(cols).toContain("v2_marker");
    expect((d.query("PRAGMA user_version").get() as any).user_version).toBe(7);
    d.close();
  });
  test("a fresh store and a second run are both fine", () => {
    expect(cli("goal").goals).toEqual([]);
    expect(cli("goal").goals).toEqual([]);
  });
});

describe("goal commands", () => {
  beforeEach(() => seed(1));

  test("children nest one horizon down and inherit the area", () => {
    const r = cli("goal", "add", "Sign two retainers", "--parent", "g1", "--period", "2026-11");
    expect(r.goal).toMatchObject({ horizon: "month", period: "2026-11", parent: "g1" });
    const w = cli("goal", "add", "Send three proposals", "--parent", r.goal.id, "--horizon", "week", "--period", "2026-W45", "--area", "northwind");
    expect(w.goal.area).toBe("northwind");
    const show = cli("goal", "show", w.goal.id);
    expect(show.chain.map((x: any) => x.id)).toEqual([r.goal.id, "g1"]);
  });

  test("adding the same goal twice is a no-op", () => {
    const a = cli("goal", "add", "Ship demo", "--horizon", "week", "--period", "2026-W43");
    const b = cli("goal", "add", "Ship demo", "--horizon", "week", "--period", "2026-W43");
    expect(b.already).toBe(true);
    expect(b.goal.id).toBe(a.goal.id);
  });

  test("progress derives from child goals and linked tasks", () => {
    const k1 = cli("goal", "add", "A", "--parent", "g1", "--period", "2026-11").goal.id;
    cli("goal", "add", "B", "--parent", "g1", "--period", "2026-12");
    cli("add", "Linked task", "--goal", "g1");
    cli("goal", "done", k1);
    expect(cli("goal", "show", "g1").goal.progress).toBe(33);
    cli("goal", "progress", "g1", "80");
    expect(cli("goal", "show", "g1").goal).toMatchObject({ progress: 80, progress_mode: "manual" });
    cli("goal", "progress", "g1", "auto");
    expect(cli("goal", "show", "g1").goal.progress).toBe(33);
  });

  test("moves between periods, horizons and positions", () => {
    const a = cli("goal", "add", "A", "--horizon", "week", "--period", "2026-W43").goal.id;
    const b = cli("goal", "add", "B", "--horizon", "week", "--period", "2026-W43").goal.id;
    cli("goal", "move", b, "--index", "0");
    let col = cli("goal", "board", "--horizon", "week", "--from", "2026-W43", "--count", "1").columns[0];
    expect(col.goals.map((g: any) => g.id)).toEqual([b, a]);
    expect(cli("goal", "move", b, "--index", "0").already).toBe(true);
    cli("goal", "move", a, "--period", "2026-W44");
    expect(cli("goal", "show", a).goal.period).toBe("2026-W44");
    // A new horizon without a period takes the one holding the old start (Mon 26 Oct).
    expect(cli("goal", "move", a, "--horizon", "month").goal.period).toBe("2026-10");
    expect(cli("goal", "move", a, "--period", "2027-Q1").goal).toMatchObject({ horizon: "quarter", period: "2027-Q1" });
  });

  test("a goal can't become its own ancestor", () => {
    const k = cli("goal", "add", "Child", "--parent", "g1").goal.id;
    const r = cli("goal", "update", "g1", "--parent", k);
    expect(r.ok).toBe(false);
    expect(cli("goal", "update", k, "--parent", "none").goal.parent).toBe(null);
  });

  test("period notes and reviews", () => {
    cli("goal", "note", "week", "2026-W43", "--text", "Plan: Harborline\nthen reels");
    cli("goal", "note", "week", "2026-W43", "--kind", "review", "--text", "Went fine");
    expect(cli("goal", "note", "week", "2026-W43", "--text", "Plan: Harborline\nthen reels").already).toBe(true);
    const col = cli("goal", "board", "--horizon", "week", "--from", "2026-W43", "--count", "1").columns[0];
    expect(col).toMatchObject({ note: "Plan: Harborline\nthen reels", review: "Went fine" });
    cli("goal", "note", "week", "2026-W43", "--text", "");
    expect(cli("goal", "board", "--horizon", "week", "--from", "2026-W43", "--count", "1").columns[0].note).toBe(null);
  });

  test("dropped goals leave the board, done ones stay", () => {
    const a = cli("goal", "add", "A", "--horizon", "week", "--period", "2026-W43").goal.id;
    const b = cli("goal", "add", "B", "--horizon", "week", "--period", "2026-W43").goal.id;
    cli("goal", "done", a);
    cli("goal", "drop", b);
    const col = cli("goal", "board", "--horizon", "week", "--from", "2026-W43", "--count", "1").columns[0];
    expect(col.goals.map((g: any) => [g.id, g.status])).toEqual([[a, "done"]]);
  });

  test("wrong-horizon period keys explain themselves", () => {
    const r = cli("goal", "add", "X", "--horizon", "week", "--period", "2026-Q4");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("quarter");
  });
});

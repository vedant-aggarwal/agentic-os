// Work's tables: the store's collection shape (checked against the phone server's collectionDDL), an idempotent
// migrate, and the two read verbs, on a temp DB.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULES } from "./index";
import type { Args, ModCtx } from "./types";
import { work, WORK_DDL, WORK_SPECS } from "./work";

const dir = mkdtempSync(join(tmpdir(), "agentos-work-"));
const dbPath = join(dir, "t.db");
const db = new Database(dbPath);
afterAll(() => { db.close(); Bun.gc(true); try { rmSync(dir, { recursive: true, force: true }); } catch {} });

class UserError extends Error {}
const args = (argv: string[]): Args => {
  const a: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) { a._.push(argv[i]); continue; }
    const next = argv[i + 1];
    a.flags[argv[i].slice(2)] = next !== undefined && !next.startsWith("--") ? argv[++i] : true;
  }
  return a;
};
function run(...argv: string[]) {
  let out: any = null;
  const ctx: ModCtx = {
    out: (d) => { out = d; }, jsonOut: true, str: (a, k) => (typeof a.flags[k] === "string" ? (a.flags[k] as string) : undefined),
    istDate: () => "2026-10-22", now: () => new Date(), iso: () => new Date().toISOString(), UserError, dbPath, contentDbPath: join(dir, "content.db"),
  };
  work.run(db, args(["work", ...argv]), ctx);
  return out;
}
let rev = 0;
function put(table: string, id: string, cols: Record<string, unknown>, data: Record<string, unknown> = {}, deleted: string | null = null) {
  const at = new Date(Date.UTC(2026, 9, 22, 10, rev)).toISOString();
  const keys = ["id", "data", "created_at", "updated_at", "deleted_at", "rev", ...Object.keys(cols)];
  db.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
    .run(id, JSON.stringify(data), at, at, deleted, ++rev, ...(Object.values(cols) as any[]));
}

describe("agentos work", () => {
  test("migrate makes both tables in the collection shape, and running it again changes nothing", () => {
    work.migrate(db);
    work.migrate(db);
    const cols = (t: string) => (db.query(`PRAGMA table_info(${t})`).all() as any[]).map((c) => `${c.name} ${c.type}`);
    const base = ["id TEXT", "data TEXT", "created_at TEXT", "updated_at TEXT", "deleted_at TEXT", "rev INTEGER"];
    expect(cols("work_reviews")).toEqual([...base, "job TEXT", "path TEXT", "mark TEXT", "turn INTEGER", "blob TEXT", "noted INTEGER"]);
    expect(cols("work_night")).toEqual([...base, "date TEXT", "state TEXT", "job TEXT", "task TEXT", "project TEXT", "engine TEXT"]);
    const idx = (db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'work_%'").all() as any[]).map((r) => r.name).sort();
    expect(idx).toEqual(["work_night_rev", "work_reviews_rev"]);
  });

  const phone = join(import.meta.dir, "..", "..", "..", "server", "modules", "_collection.ts");
  test.skipIf(!existsSync(phone))("the DDL is exactly what the phone server's collectionDDL prints", async () => {
    const { collectionDDL } = await import(phone);
    expect(collectionDDL(WORK_SPECS.reviews)).toBe(WORK_DDL.reviews);
    expect(collectionDDL(WORK_SPECS.night)).toBe(WORK_DDL.night);
  });

  test("night lists the rows that aren't deleted, newest evening first, and --date picks one evening", () => {
    put("work_night", "n1", { date: "2026-10-21", state: "started", job: "j40", engine: "claude" }, { title: "Yesterday", prompt: "Old" });
    put("work_night", "n2", { date: "2026-10-22", state: "queued", engine: "codex", task: "t9" }, { title: "Tonight", prompt: "Plan", mode: "plan", worktree: true });
    put("work_night", "n3", { date: "2026-10-22", state: "cancelled", engine: "claude" }, { title: "Gone" }, "2026-10-22T11:00:00.000Z");
    const all = run("night");
    expect(all.count).toBe(2);
    expect(all.night.map((r: any) => r.id)).toEqual(["n2", "n1"]);
    expect(all.night[0]).toMatchObject({ id: "n2", date: "2026-10-22", state: "queued", engine: "codex", task: "t9", job: null, title: "Tonight", mode: "plan", worktree: true, deleted_at: null });
    expect(run("night", "--date", "2026-10-21").night.map((r: any) => r.id)).toEqual(["n1"]);
    expect(() => run("night", "--date", "22-10")).toThrow(UserError);
    expect(() => run("night", "--date", "2026-02-30")).toThrow(UserError);
    expect(() => run("night", "--date", "2026-13-01")).toThrow(UserError);
    expect(() => run("night", "--date")).toThrow(UserError);
  });

  test("reviews <job> lists that job's marks under either id form", () => {
    put("work_reviews", "r1", { job: "j12", path: "src/b.ts", mark: "reverted", turn: 2, blob: "a".repeat(40), noted: 1 });
    put("work_reviews", "r2", { job: "12", path: "src/a.ts", mark: "kept", turn: 0, noted: 0 });
    put("work_reviews", "r3", { job: "j13", path: "x.ts", mark: "kept" });
    put("work_reviews", "r4", { job: "j12", path: "old.ts", mark: "kept" }, {}, "2026-10-22T11:00:00.000Z");
    const r = run("reviews", "12");
    expect(r).toMatchObject({ job: "j12", count: 2 });
    expect(r.reviews.map((x: any) => [x.id, x.path, x.mark, x.noted])).toEqual([["r2", "src/a.ts", "kept", false], ["r1", "src/b.ts", "reverted", true]]);
    expect(run("reviews", "j13").count).toBe(1);
    expect(() => run("reviews")).toThrow(UserError);
    expect(() => run("nope")).toThrow(UserError);
  });

  test("bare work counts tonight's queue and the marks", () => {
    expect(run()).toEqual({ tonight: { date: "2026-10-22", queued: 1, started: 0, total: 1 }, reviews: { kept: 2, reverted: 1, unmarked: 0 } });
  });

  // Through the real CLI once the lead has registered the module in src/modules/index.ts.
  const registered = MODULES.some((m) => m.name === "work");
  test.skipIf(!registered)("the CLI runs it with --json on a fresh DB", () => {
    const fresh = join(dir, "cli.db");
    const r = Bun.spawnSync(["bun", join(import.meta.dir, "..", "agentos.ts"), "work", "night", "--json"], {
      env: { ...process.env, AGENTOS_DB: fresh, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") } });
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(r.stdout.toString())).toEqual({ date: null, count: 0, night: [] });
  }, 60_000);
});

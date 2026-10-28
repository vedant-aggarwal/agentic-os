// Soul: the tables migrate in the phone store's shape, habits and checks are idempotent per day, streaks forgive one
// miss and end on the second, and Clean is only ever "Day N" in the status.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SOUL_TABLES, put, rows, soulStatus, streakOf } from "./soul";

const dir = mkdtempSync(join(tmpdir(), "agentos-soul-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") } });
  return { text: r.stdout.toString(), err: r.stderr.toString(), code: r.exitCode };
}
const json = (...args: string[]) => JSON.parse(cli(...args, "--json").text);
const SLOW = 60_000;

describe("agentos soul", () => {
  test("migrate makes every table with the store's columns, twice without harm", () => {
    expect(json("soul")).toMatchObject({ habits: { done: 0, total: 0 }, clean: null, ask: null });
    expect(json("soul").habits.total).toBe(0);
    const db = new Database(dbPath, { readonly: true });
    for (const t of Object.keys(SOUL_TABLES)) {
      const cols = (db.query(`PRAGMA table_info(${t})`).all() as any[]).map((c) => c.name);
      expect(cols).toEqual(expect.arrayContaining(["id", "data", "created_at", "updated_at", "deleted_at", "rev", ...Object.keys(SOUL_TABLES[t])]));
    }
    db.close();
  }, SLOW);

  test("habit add, check, a second check the same day is one record, undo, rest", () => {
    const h = json("soul", "habit", "add", "Read 20 pages", "--part", "evening", "--at", "21:30", "--of", "20", "--unit", "pages").habit;
    expect(h).toMatchObject({ title: "Read 20 pages", part: "evening", of: 20 });
    expect(json("soul", "check", h.id, "--count", "8")).toMatchObject({ today: false });
    expect(json("soul", "check", "read 20", "--count", "20")).toMatchObject({ today: true, streak: 1 });
    const db = new Database(dbPath, { readonly: true });
    expect((db.query("SELECT count(*) n FROM soul_checks").get() as any).n).toBe(1);
    db.close();
    expect(json("soul", "check", h.id, "--undo")).toMatchObject({ today: false, streak: 0 });
    expect(json("soul", "check", h.id, "--rest")).toMatchObject({ rest: true });
    expect(cli("soul", "check", "nope").code).toBe(2);
    expect(json("soul").habits).toMatchObject({ done: 0, total: 1 });
  }, SLOW);

  test("urge logs; unknown subcommands are usage errors", () => {
    expect(json("soul", "urge", "--place", "Home", "--feel", "Bored", "--mins", "6")).toMatchObject({ ok: true, urge: { out: "rode" } });
    expect(json("soul", "urge", "--slip").urge.out).toBe("slip");
    expect(cli("soul", "fly").code).toBe(2);
  }, SLOW);
});

describe("streaks forgive one miss", () => {
  const h = { id: "h1", start: "2026-10-01" };
  const c = (date: string, x: any = { done: true }) => ({ id: `c_h1_${date}`, habit: "h1", date, updated_at: `${date}T10:00:00Z`, ...x });
  test("one miss holds the run, two in a row end it, a rest day keeps it", () => {
    const checks = [c("2026-10-01"), c("2026-10-02"), /* 03 missed */ c("2026-10-04"), c("2026-10-05", { rest: true }), c("2026-10-06")];
    expect(streakOf(h, checks, "2026-10-07")).toMatchObject({ streak: 4, best: 4, today: false });
    const broken = [c("2026-10-01"), c("2026-10-02"), /* 03, 04 missed */ c("2026-10-05")];
    expect(streakOf(h, broken, "2026-10-06")).toMatchObject({ streak: 1, best: 2 });
  });
  test("days it isn't due are skipped", () => {
    const wk = { ...h, days: [1, 3, 5] };   // Thu 1 Oct 2026 is a Thursday: due Mon, Wed, Fri
    const checks = [c("2026-10-02"), c("2026-10-05"), c("2026-10-07"), c("2026-10-09")];
    expect(streakOf(wk, checks, "2026-10-11").streak).toBe(4);
  });
  test("Clean in the status is only Day N", () => {
    const db = new Database(":memory:");
    for (const t of Object.keys(SOUL_TABLES)) db.exec((require("./soul") as any).soulDDL(t));
    put(db, "soul_clean", { id: "clean", name: "Clean", since: "2026-10-13T02:44:00Z", reasons: ["private"], goal: 30 }, "2026-10-13T02:44:00Z");
    const s = soulStatus(db, Date.parse("2026-10-22T12:10:00Z"));
    expect(s.clean).toEqual({ text: "Day 10", private: true });
    expect(JSON.stringify(s)).not.toContain("private\"]");
    expect(rows(db, "soul_clean")[0].reasons).toEqual(["private"]);
  });
});

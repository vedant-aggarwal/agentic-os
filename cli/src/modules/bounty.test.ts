// Bounty through the real CLI on a throwaway DB: recurring work priced from repeat rules and
// repeated titles, the rate setting, take/dismiss, and the payroll listing.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rateOf, timesPerWeek } from "./bounty";

const dir = mkdtempSync(join(tmpdir(), "agentos-bounty-"));
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
const daysAgo = (n: number, h = 10) => new Date(Date.now() - n * 864e5 - (10 - h) * 3600e3).toISOString();

describe("bounty", () => {
  test("timesPerWeek reads every repeat rule", () => {
    expect(timesPerWeek("1d")).toBe(7);
    expect(timesPerWeek("weekdays")).toBe(5);
    expect(timesPerWeek("days:mon,thu")).toBe(2);
    expect(timesPerWeek("2w")).toBe(0.5);
    expect(timesPerWeek("1m")).toBe(0.2);
    expect(timesPerWeek(null)).toBeNull();
    expect(timesPerWeek("odd")).toBeNull();
  });

  test("scan prices repeat tasks and titles done 3+ times; no rate means no payoff yet", () => {
    expect(cli("mods").code).toBe(0);
    withDb((d) => {
      d.query("INSERT INTO tasks (title, status, area, repeat, estimate_minutes, due, created_at, updated_at) VALUES ('Post the daily reel', 'todo', 'content', '1d', 20, '2026-10-18', ?, ?)").run(daysAgo(1), daysAgo(1));
      const ins = d.query("INSERT INTO tasks (title, status, area, started_at, done_at, created_at, updated_at) VALUES (?, 'done', 'morgan-co', ?, ?, ?, ?)");
      ins.run("Backup the shop database", daysAgo(20, 10), daysAgo(20, 10.25), daysAgo(21), daysAgo(20));   // 15 min
      ins.run("Backup the shop database (2)", daysAgo(12, 10), daysAgo(12, 10.75), daysAgo(13), daysAgo(12)); // 45 min
      ins.run("Backup the shop database", daysAgo(4, 10), daysAgo(4, 10.25), daysAgo(5), daysAgo(4));     // 15 min
      ins.run("Only twice", daysAgo(3, 10), daysAgo(3, 10.5), daysAgo(4), daysAgo(3));
      ins.run("Only twice", daysAgo(2, 10), daysAgo(2, 10.5), daysAgo(3), daysAgo(2));
      expect(rateOf(d)).toEqual({ rate: null, source: "none" });
    });
    expect(json("bounty", "scan")).toEqual({ ok: true, rate: null, items: 2 });
    const b = json("bounty");
    expect(b.rate).toBeNull();
    expect(b.note).toContain("set a rate");
    expect(b.items.map((i: any) => [i.title, i.minutes_per_week, i.payoff_per_month])).toEqual([["Post the daily reel", 140, null], ["Backup the shop database", 6, null]]);
    expect(b.items[1]).toMatchObject({ times_per_week: 0.4, minutes_each: 15, basis: "measured over 3", source: "done 3 times in 60 days" });
    expect(b.items[0]).toMatchObject({ times_per_week: 7, minutes_each: 20, basis: "estimate", source: "repeats 1d" });
  }, SLOW);

  test("rate sets settings.bounty.hourly_rate and reprices the board", () => {
    expect(json("bounty", "rate", "600")).toEqual({ ok: true, rate: 600, source: "settings" });
    expect(withDb((d) => (d.query("SELECT value FROM settings WHERE key = 'bounty.hourly_rate'").get() as any).value)).toBe("600");
    const b = json("bounty");
    expect(b.rate).toBe(600);
    expect(b.note).toBeNull();
    expect(b.items.map((i: any) => i.payoff_per_month)).toEqual([6020, 258]);   // 140 min/wk -> 2.33 h x 4.3 x 600; 6 min/wk (0.4 x 15) -> 258
    expect(json("bounty", "rate")).toEqual({ ok: true, rate: 600, source: "settings" });
    expect(cli("bounty", "rate", "zero", "--json").code).toBe(2);
    expect(cli("bounty").text).toContain("items[2]{id,title,area,status,payoff_per_month");
  }, SLOW);

  test("take and dismiss move items off the open board; payroll lists rows", () => {
    expect(json("bounty", "take", "1", "--task", "t9")).toMatchObject({ ok: true, action: "taken", item: { id: 1, status: "taken", task: "t9" } });
    expect(cli("bounty", "take", "1", "--json").code).toBe(2);
    expect(json("bounty", "dismiss", "2")).toMatchObject({ ok: true, action: "dismissed" });
    expect(json("bounty").items.map((i: any) => i.status)).toEqual(["taken"]);
    expect(json("bounty", "--all").items).toHaveLength(2);
    // A rescan keeps statuses and refreshes numbers.
    json("bounty", "scan");
    expect(json("bounty", "--all").items.map((i: any) => i.status)).toEqual(["taken", "dismissed"]);
    withDb((d) => d.query(`INSERT INTO bounty_payroll (runner, period, runs, kept, removed, tasks_done, evidence_verified, quota_estimate, value_estimate, note, created_at)
      VALUES ('ai:plan', '2026-10', 12, 3, 17, 0, 0, 180, 90, 'last run only', ?)`).run(new Date().toISOString()));
    const p = json("bounty", "payroll");
    expect(p.rows[0]).toMatchObject({ runner: "ai:plan", period: "2026-10", runs: 12, kept: 3, removed: 17, kept_rate: 15, value_estimate: 90 });
  }, SLOW);
});

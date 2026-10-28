// Growth through the real CLI on a throwaway DB, plus the pure functions the phone server imports.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftReview, journalDays, levels, putDoc, rateAt, streakOf, weekKey, weekLabel, weekMonday, weekPoints, writeLine } from "./growth";

const dir = mkdtempSync(join(tmpdir(), "agentos-growth-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* harmless */ } });
function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") } });
  return { text: r.stdout.toString(), err: r.stderr.toString(), code: r.exitCode };
}
const json = (...args: string[]) => JSON.parse(cli(...args, "--json").text);
const withDb = <T>(f: (d: Database) => T): T => { const d = new Database(dbPath); try { return f(d); } finally { d.close(); } };
const SLOW = 60_000;

describe("growth dates", () => {
  test("weeks", () => {
    expect(weekKey("2026-10-22")).toBe("2026-W43");
    expect(weekMonday("2026-W43")).toBe("2026-10-19");
    expect(weekMonday("2026-W01")).toBe("2025-12-29");
    expect(weekLabel("2026-W43")).toBe("19–25 Oct");
    expect(weekLabel("2026-W44")).toBe("26 Oct – 1 Nov");
    expect(rateAt([10, 12, null, 18], 3)).toBeCloseTo(8 / 3);
  });
  test("streak counts nights written, not backfills", () => {
    const m = new Map<string, any>();
    for (const d of ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21"]) m.set(d, { date: d, n: 1, p: 3, e: 3, live: true });
    m.set("2026-10-10", { date: "2026-10-10", n: 1, p: 3, e: 3, live: false });
    const s = streakOf(m, "2026-10-22");
    expect(s.n).toBe(4); expect(s.today).toBe(false); expect(s.best).toBe(4); expect(s.bestFrom).toBe("2026-10-18");
    m.set("2026-10-22", { date: "2026-10-22", n: 1, p: 4, e: 3, live: true });
    expect(streakOf(m, "2026-10-22").current).toBe(5);
  });
});

describe("growth CLI", () => {
  test("migrates, writes and reads the journal", () => {
    expect(cli("mods").code).toBe(0);
    const w = json("growth", "write", "Pull day, then shipped the page.", "--p", "4", "--e", "4");
    expect(w.words).toBe(6); expect(w.p).toBe(4); expect(w.backfill).toBe(false);
    const again = json("growth", "write", "Dinner with Dad.");
    expect(again.id).toBe(w.id); expect(again.text).toContain("Dinner with Dad."); expect(again.lines.length).toBe(2);
    const list = json("growth", "journal");
    expect(list.length).toBe(1);
    expect(json("growth", "streak").today).toBe(true);
    expect(cli("growth", "write", "x", "--p", "9").code).toBe(2);
  }, SLOW);

  test("levels and the week come from real rows", () => {
    const now = new Date();
    withDb((d) => {
      const iso = now.toISOString();
      d.query("INSERT OR IGNORE INTO areas (slug, name) VALUES ('personal', 'Personal')").run();
      d.query("INSERT OR IGNORE INTO life_area_aspects (area, aspect, rank) VALUES ('personal', 'body', 0)").run();
      d.query("INSERT INTO tasks (title, status, area, created_at, updated_at, done_at) VALUES ('Gym', 'done', 'personal', ?, ?, ?)").run(iso, iso, iso);
      putDoc(d, "growth_checkins", { id: "c1", date: new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10), at: iso, p: 5, e: 4 });
    });
    const lv = json("growth", "levels");
    expect(lv.length).toBeGreaterThanOrEqual(1);
    const cur = lv.at(-1);
    expect(cur.body).toBeGreaterThan(0); expect(cur.soul).toBe(88); // the entry (p 4) and the check-in (p 5) expect(cur.growth).toBeGreaterThan(0);
    const wk = json("growth", "week");
    expect(wk.points.some((p: any) => p.label === "Tasks done" && p.now === "1")).toBe(true);
    expect(wk.points.some((p: any) => p.label === "Journal")).toBe(true);
    expect(wk.moves.length).toBeGreaterThanOrEqual(1);
    expect(typeof wk.headline).toBe("string");
  }, SLOW);

  test("pure helpers agree with the CLI", () => {
    withDb((d) => {
      const days = journalDays(d, [{ date: "2020-01-01" }]);
      expect(days.get("2020-01-01")?.live).toBe(true);
      const l = levels(d, { weeks: 4 });
      expect(l.weeks.length).toBeGreaterThan(0);
      expect(weekPoints(d).daysIn).toBeGreaterThan(0);
      expect(draftReview(d).status).toBe("draft");
      const bf = writeLine(d, { text: "Filled in later", date: "2020-02-02" });
      expect(bf.backfill).toBe(true);
    });
  });
});

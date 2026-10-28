// Doctrine through the real CLI on a throwaway DB: candidate patterns from seeded history,
// accept -> rule + ai.plan_rules, retire -> rule off + ai.plan_rules cleaned.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { candidates, isoWeek } from "./doctrine";

const dir = mkdtempSync(join(tmpdir(), "agentos-doctrine-"));
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

const NOW = new Date("2026-10-18T09:00:00.000Z");
const daysAgo = (n: number, hhmmUtc = "00:30") => `${new Date(NOW.getTime() - n * 864e5).toISOString().slice(0, 10)}T${hhmmUtc}:00.000Z`;

function seed() {
  withDb((d) => {
    const ins = d.query(`INSERT INTO tasks (title, status, start_at, end_at, done_at, evidence, due, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    // Five 06:00 IST blocks (00:30 UTC) in the past: four skipped, one done that day.
    for (let i = 1; i <= 5; i++) {
      const done = i === 5;
      ins.run(`Morning block ${i}`, done ? "done" : "todo", daysAgo(i), daysAgo(i, "01:00"), done ? daysAgo(i, "01:10") : null, null, null, daysAgo(i + 1), daysAgo(i));
    }
    // Five tasks done this month, two without evidence: a weaker candidate than the skipped blocks.
    for (let i = 1; i <= 5; i++) ins.run(`Shipped thing ${i}`, "done", null, null, daysAgo(i, "10:00"), i <= 3 ? `commit ${i}` : null, null, daysAgo(i + 2), daysAgo(i));
  });
}

describe("doctrine", () => {
  test("isoWeek", () => {
    expect(isoWeek("2026-10-18")).toBe("2026-W42");
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
    expect(isoWeek("2027-01-03")).toBe("2026-W53");
  });

  test("candidates come from history, strongest first, with evidence rows", () => {
    expect(cli("mods").code).toBe(0);
    seed();
    const cs = withDb((d) => candidates(d, NOW));
    expect(cs.map((c) => c.pattern)).toEqual(["skip_by_hour:06", "evidence_rate"]);
    expect(cs[0].summary).toBe("Blocks planned at 06:00 got skipped 4 times in 5.");
    expect(cs[0].rows).toHaveLength(5);
    expect(cs[0].rows.filter((r) => r.result === "skipped")).toHaveLength(4);
    expect(cs[0].rows.every((r) => r.planned === "06:00")).toBe(true);
    expect(cs[0].observed).toBe(false);
    expect(cs[1].summary).toBe("3 of 6 tasks done in the last 30 days carry no evidence.");
    const r = json("doctrine", "candidates");
    expect(r.candidates[0].pattern).toBe("skip_by_hour:06");
    expect(cli("doctrine", "candidates").text).toContain("candidates[2]{pattern,strength,observed,summary,rows}:");
  }, SLOW);

  test("accept makes a rule and appends it to ai.plan_rules; retire removes both", () => {
    withDb((d) => d.query(`INSERT INTO doctrine_observations (week, pattern, text, evidence, proposed_rule, status, created_at)
      VALUES ('2026-W42', 'skip_by_hour:06', 'Blocks planned at 06:00 got skipped 4 times in 5.', ?, 'No 06:00 blocks; the first block of the day starts at 07:00.', 'open', ?)`)
      .run(JSON.stringify([{ task: "t1", result: "skipped" }]), NOW.toISOString()));
    expect(withDb((d) => candidates(d, NOW))[0].observed).toBe(true);
    const obs = json("doctrine", "observations");
    expect(obs.observations[0]).toMatchObject({ id: 1, status: "open", week: "2026-W42", evidence: [{ task: "t1", result: "skipped" }] });

    const acc = json("doctrine", "accept", "1");
    expect(acc).toMatchObject({ ok: true, action: "accepted", rule: { id: 1, text: "No 06:00 blocks; the first block of the day starts at 07:00." } });
    expect(acc.plan_rules).toBe("No 06:00 blocks; the first block of the day starts at 07:00.");
    expect(json("ai", "rules").rules).toBe(acc.plan_rules);
    const rules = json("doctrine");
    expect(rules.count).toBe(1);
    expect(rules.rules[0]).toMatchObject({ id: 1, active: true, observation: 1, from: "Blocks planned at 06:00 got skipped 4 times in 5." });
    expect(json("doctrine", "observations").observations[0].status).toBe("accepted");
    const twice = cli("doctrine", "accept", "1", "--json");
    expect(twice.code).toBe(2);
    expect(JSON.parse(twice.text).error).toContain("already accepted");

    const ret = json("doctrine", "retire", "1");
    expect(ret).toMatchObject({ ok: true, action: "retired", rule: 1, plan_rules: null });
    expect(json("doctrine").count).toBe(0);
    expect(json("doctrine").rules[0].active).toBe(false);
  }, SLOW);

  test("decline records the decision without a rule", () => {
    withDb((d) => d.query(`INSERT INTO doctrine_observations (week, pattern, text, evidence, proposed_rule, status, created_at)
      VALUES ('2026-W43', 'evidence_rate', 'x', '[]', 'Always attach evidence.', 'open', ?)`).run(NOW.toISOString()));
    expect(json("doctrine", "decline", "2")).toMatchObject({ ok: true, action: "declined", observation: 2 });
    expect(json("doctrine").count).toBe(0);
    expect(json("doctrine", "observations").observations[0]).toMatchObject({ id: 2, status: "declined" });
  }, SLOW);
});

// The Cabinet's read side: advocates with default briefs, sessions with turns and outcomes, week keys.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mondayOf, plusDays, weekFrom } from "./cabinet";

const dir = mkdtempSync(join(tmpdir(), "agentos-cabinet-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") } });
  return { text: r.stdout.toString(), code: r.exitCode };
}
const json = (...args: string[]) => JSON.parse(cli(...args, "--json").text);
const SLOW = 60_000;

describe("weeks", () => {
  test("a week is named by its Monday and runs to Sunday", () => {
    expect(mondayOf("2026-10-18")).toBe("2026-10-12"); // a Sunday belongs to the week that started the Monday before
    expect(mondayOf("2026-10-19")).toBe("2026-10-19");
    expect(plusDays("2026-10-12", 6)).toBe("2026-10-18");
    expect(weekFrom("next", "2026-10-18")).toBe("2026-10-19");
    expect(weekFrom("this", "2026-10-18")).toBe("2026-10-12");
    expect(weekFrom("2026-10-21", "2026-10-18")).toBe("2026-10-19");
    expect(() => weekFrom("someday", "2026-10-18")).toThrow();
  });
});

describe("agentos cabinet", () => {
  test("every area has an advocate with a default brief until one is written", () => {
    const r = json("cabinet", "advocates");
    expect(r.count).toBe(7);
    const content = r.advocates.find((a: any) => a.area === "content");
    expect(content).toMatchObject({ active: true, custom: false, kpis: [] });
    expect(content.brief).toContain("Speak for Content");
    const w = json("cabinet", "advocate", "content", "--brief", "Two shoots a week, one reel out", "--kpis", "reels posted, followers");
    expect(w).toMatchObject({ ok: true, action: "added", advocate: { area: "content", custom: true, kpis: ["reels posted", "followers"], brief: "Two shoots a week, one reel out" } });
    expect(json("cabinet", "advocate", "content", "--off").advocate.active).toBe(false);
    expect(json("cabinet", "advocates").advocates.find((a: any) => a.area === "content")).toMatchObject({ active: false, brief: "Two shoots a week, one reel out" });
    expect(cli("cabinet", "advocate", "content", "--json").code).toBe(2); // nothing to change
  }, SLOW);

  test("sessions list their turns and outcomes; an unknown id is a usage error", () => {
    expect(json("cabinet")).toMatchObject({ count: 0, sessions: [] });
    const db = new Database(dbPath);
    try {
      db.transaction(() => {
        db.query("INSERT INTO cabinet_sessions (id, week, status, started_at, settled_at, summary, batch_id, model) VALUES (1, '2026-10-19', 'settled', '2026-10-18T14:30:00Z', '2026-10-18T14:33:00Z', 'Northwind got Tuesday morning.', 7, 'Sonnet')").run();
        db.query("INSERT INTO cabinet_turns (session_id, round, advocate, text, asks, created_at) VALUES (1, 1, 'northwind', 'Harborline quote is due Tuesday.', '[{\"title\":\"Harborline quote\",\"minutes\":60}]', '2026-10-18T14:31:00Z')").run();
        db.query("INSERT INTO cabinet_outcomes (session_id, kind, payload, status, created_at) VALUES (1, 'block', '{\"date\":\"2026-10-20\",\"start\":\"09:00\",\"end\":\"10:00\",\"title\":\"Harborline quote\",\"area\":\"northwind\"}', 'open', '2026-10-18T14:33:00Z')").run();
        db.query("INSERT INTO cabinet_outcomes (session_id, kind, payload, status, created_at) VALUES (1, 'conflict', '{\"question\":\"Gym or shoot on Thursday?\",\"options\":[{\"label\":\"Gym\",\"consequence\":\"Reel slips to Friday\"}]}', 'open', '2026-10-18T14:33:00Z')").run();
      })();
    } finally { db.close(); }
    const list = json("cabinet");
    expect(list.count).toBe(1);
    expect(list.sessions[0]).toMatchObject({ id: "c1", week: "2026-10-19", status: "settled", blocks: 1, conflicts: 1, open_conflicts: 1, turns: 1, batch: "b7" });
    const show = json("cabinet", "show", "c1");
    expect(show.turns[0]).toMatchObject({ advocate: "northwind", asks: [{ title: "Harborline quote", minutes: 60 }] });
    expect(show.outcomes.map((o: any) => o.kind).sort()).toEqual(["block", "conflict"]);
    expect(show.outcomes.find((o: any) => o.kind === "block").payload.start).toBe("09:00");
    expect(cli("cabinet", "show", "c9", "--json").code).toBe(2);
    expect(cli("cabinet", "show", "c1").text).toContain("Gym or shoot on Thursday?");
  }, SLOW);
});

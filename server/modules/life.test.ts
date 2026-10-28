// Life on the PC: the rhythm route, the monthly nudge (once a week at most, never before a month), and the agent's tools.
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { life, rhythm, rescoreNudge, score, linkArea } from "./life";

function setup() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE areas (slug TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE life_snapshots (date TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'app', scores TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (date, source));
    CREATE TABLE life_area_aspects (area TEXT NOT NULL, aspect TEXT NOT NULL, rank INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (area, aspect));
    INSERT INTO areas VALUES ('northwind', 'Northwind'), ('personal', 'Personal');
    INSERT INTO life_area_aspects VALUES ('northwind', 'mission', 0), ('northwind', 'money', 1);`);
  const pushes: any[] = [];
  const jctx: any = { db: () => db, push: async (...a: any[]) => { pushes.push(a); }, log: () => {}, dataDir: mkdtempSync(join(tmpdir(), "life-")) };
  const call = async (method: string, path: string) => {
    const ctx: any = { method, path, db: () => db, json: (d: unknown, s = 200) => Response.json(d, { status: s }), fail: (s: number, m: string) => Response.json({ error: m }, { status: s }) };
    const r = await life.handle(ctx); return r ? { status: r.status, json: (await r.json()) as any } : null;
  };
  return { db, jctx, pushes, call };
}
const tool = (n: string) => life.tools!.find((t) => t.name === n)!;
const snap = (db: Database, date: string, scores: object, source = "app") => db.query("INSERT INTO life_snapshots VALUES (?, ?, ?, ?)").run(date, source, JSON.stringify(scores), new Date().toISOString());

test("the rhythm: never scored is due; a month later is due; the lowest two and the change since the scoring before", async () => {
  const { db, call } = setup();
  expect(rhythm(db, "2026-10-22")).toMatchObject({ scored: false, due: true });
  snap(db, "2026-07-06", { body: 2, mind: 3, romance: 1 }, "July life review");
  snap(db, "2026-10-01", { body: 4, mind: 3, romance: 1 });
  const r = rhythm(db, "2026-10-22");
  expect(r).toMatchObject({ scored: true, last: "2026-10-01", days: 21, due: false, next: "2026-10-31", previous: "2026-07-06" });
  expect(r.deltas).toEqual({ body: 2, mind: 0, romance: 0 });
  expect(r.lowest).toEqual(["romance", "mind"]);
  expect(rhythm(db, "2026-10-31").due).toBe(true);
  expect((await call("GET", "/"))!.json.last).toBe("2026-10-01");
  expect(await call("GET", "/nope")).toBeNull();
});

test("the nudge goes a month after the last scoring, links to the score sheet, and waits a week before another", async () => {
  const { db, jctx, pushes } = setup();
  snap(db, "2026-09-01", { body: 3 });
  expect((await rescoreNudge(jctx, "2026-09-20")).sent).toBe(false);
  expect((await rescoreNudge(jctx, "2026-10-02")).sent).toBe(true);
  expect(pushes[0][0]).toBe("Time to score your wheel");
  expect(pushes[0][2].link).toBe("agenticos://life/score");
  expect((await rescoreNudge(jctx, "2026-10-05")).sent).toBe(false);
  expect((await rescoreNudge(jctx, "2026-10-09")).sent).toBe(true);
  snap(db, "2026-10-09", { body: 5 });
  expect((await rescoreNudge(jctx, "2026-10-20")).sent).toBe(false);
  expect(pushes.length).toBe(2);
});

test("life_score keeps the aspects he didn't mention, writes one snapshot per day, and refuses bad input", async () => {
  const { db, jctx } = setup();
  snap(db, "2026-07-06", { body: 2, mind: 3 }, "July life review");
  const r: any = await tool("life_score").run(jctx, { scores: { body: 6 } });
  expect(r.scores).toEqual({ body: 6, mind: 3 });
  expect(r.before.date).toBe("2026-07-06");
  await tool("life_score").run(jctx, { scores: { mind: 4.3 } });
  const rows = db.query("SELECT * FROM life_snapshots WHERE source = 'app'").all() as any[];
  expect(rows.length).toBe(1);
  expect(JSON.parse(rows[0].scores)).toEqual({ body: 6, mind: 4.5 });
  expect(() => score(db, { vibes: 3 })).toThrow("Unknown aspect");
  expect(() => score(db, { body: 11 })).toThrow("0 to 10");
  expect(tool("life_score").auto).toBe(true);
});

test("life_link_area replaces one area's aspects, keeps the others, and says what was there before", async () => {
  const { db, jctx } = setup();
  const r: any = await tool("life_link_area").run(jctx, { area: "personal", aspects: ["body", "mind", "body"] });
  expect(r).toEqual({ area: "personal", aspects: ["body", "mind"], before: [] });
  const w: any = await tool("life_wheel").run(jctx, {});
  expect(w.areaAspects).toEqual({ northwind: ["mission", "money"], personal: ["body", "mind"] });
  expect(() => linkArea(db, "nowhere", ["body"])).toThrow("No area");
  expect(() => linkArea(db, "personal", ["vibes"])).toThrow("Aspects are");
});

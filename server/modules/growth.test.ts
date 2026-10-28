// Growth's server module on a throwaway db: the journal collection (App Intent shape), the computed state and summary,
// a check-in, the agent's tools, and the dream with a stubbed model (no subscription spent).
import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { growth, runDream, state, summary } from "./growth";

const dir = mkdtempSync(join(tmpdir(), "growth-mod-"));
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
const db = new Database(join(dir, "a.db"));
db.exec(`CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT, notes TEXT, area TEXT, project TEXT, goal INTEGER, status TEXT, priority INTEGER, due TEXT, start_at TEXT, end_at TEXT,
  created_at TEXT, updated_at TEXT, done_at TEXT); CREATE TABLE goals (id INTEGER PRIMARY KEY, title TEXT, area TEXT, horizon TEXT, progress INTEGER, status TEXT, aspects TEXT);
  CREATE TABLE life_area_aspects (area TEXT, aspect TEXT, rank INTEGER); INSERT INTO life_area_aspects VALUES ('personal', 'body', 0);`);
const now = new Date().toISOString();
db.query("INSERT INTO tasks (title, area, status, created_at, updated_at, done_at) VALUES ('Gym', 'personal', 'done', ?, ?, ?)").run(now, now, now);
db.query("INSERT INTO tasks (title, area, status, due, created_at, updated_at) VALUES ('Old thing', 'personal', 'todo', '2026-01-02', ?, ?)").run(now, now);
let aiCalls = 0;
const base: any = {
  user: { id: 1 }, owner: true, dataDir: dir, contentDbPath: join(dir, "none.db"), db: () => db, log: () => {}, wyn: null,
  ai: { claude: async () => { aiCalls++; return { out: { headline: "Training holds the week", connections: [{ title: "Gym and mood", aspects: ["body", "soul"], strength: "Clear", text: "You trained and felt good.", evidence: [{ aspect: "body", source: "Tasks", quote: "Gym" }], proposal: { kind: "Task", title: "Book Saturday's session", meta: "Tomorrow", confidence: "Medium", aspect: "body" } }], gaps: [] } }; } },
  agentos: async () => ({ task: { id: "t99" } }), push: async () => {},
};
const call = async (method: string, path: string, body?: unknown) => {
  const url = new URL(`http://x/api/v1/mod/growth${path}`);
  const ctx = { ...base, method, path: url.pathname.replace("/api/v1/mod/growth", ""), url, body: async () => body,
    json: (d: unknown, s = 200) => Response.json(d, { status: s }), fail: (s: number, m: string) => Response.json({ error: m }, { status: s }) };
  const r = await growth.handle(ctx);
  return r ? { status: r.status, json: await r.json() as any } : null;
};

test("an App Intent's journal line gets its date, words and title on the PC, and a replay is a no-op", async () => {
  const doc = { id: "siri_1", text: "Long day. Shipped the page and slept early.", at: new Date().toISOString(), source: "siri", updated_at: "2026-10-22T16:00:00.000Z" };
  const r = await call("POST", "/journal", doc);
  expect(r!.status).toBe(201);
  expect(r!.json.item).toMatchObject({ id: "siri_1", words: 8, kind: "typed", by: "me", source: "siri", title: "Long day" });
  expect(r!.json.item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect((await call("POST", "/journal", doc))!.status).toBe(200);
  expect((await call("POST", "/journal", { id: "bad", text: "x", p: 9 }))!.status).toBe(400);
});

test("check-ins validate their mood; state and summary come from the rows", async () => {
  expect((await call("POST", "/checkins", { id: "ck1", p: 5, e: 4, why: ["Work"] }))!.status).toBe(201);
  expect((await call("POST", "/checkins", { id: "ck2", p: 0, e: 4 }))!.status).toBe(400);
  const s = (await call("GET", "/state"))!.json;
  expect(s.streak.today).toBe(true);
  expect(s.week.points.some((p: any) => p.label === "Tasks done")).toBe(true);
  expect(s.weeks.length).toBeGreaterThanOrEqual(1);
  expect(s.weeks.at(-1).aspects.body).toBeGreaterThan(0);
  expect(s.review.status).toBe("draft");
  expect(s.review.misses.some((m: any) => /Old thing/.test(m.text))).toBe(true);
  const sm = summary(base);
  expect(sm.streak.current).toBe(1);
  expect(state(base).velocity.length).toBe(9);
});

test("the dream stores connections and proposals; a second run the same day reuses it", async () => {
  const d: any = await runDream(base);
  expect(d.status).toBe("ready");
  expect(d.connections[0]).toMatchObject({ id: "c1", proposal: "r1" });
  expect(d.proposals[0]).toMatchObject({ id: "r1", kind: "Task", answer: null });
  expect(d.slipped.some((x: any) => x.title === "Old thing")).toBe(true);
  await runDream(base);
  expect(aiCalls).toBe(1);
});

test("the agent's tools: write a line (auto), answer a proposal (asks first)", async () => {
  const t = Object.fromEntries(growth.tools!.map((x) => [x.name, x]));
  expect(t.growth_journal_write.auto).toBe(true);
  expect(t.growth_dream_answer.auto).toBe(false);
  const w: any = await t.growth_journal_write.run(base, { text: "He said the gym felt great." });
  expect(w.ok).toBe(true);
  const read: any = await t.growth_journal_read.run(base, { days: 2 });
  expect(read.entries.some((e: any) => /gym felt great/.test(e.text))).toBe(true);
  const a: any = await t.growth_dream_answer.run(base, { proposal: "r1", answer: "yes" });
  expect(a).toMatchObject({ ok: true, answer: "yes", made: { kind: "task", id: "t99" } });
  const again: any = await t.growth_dream_answer.run(base, { proposal: "r1", answer: "no" });
  expect(again.already).toBe("yes");
});

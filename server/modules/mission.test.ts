// Mission's server module against a fake module context on a throwaway DB: the store contract on its collections
// (upsert, LWW replay, a temp goal id, validation), milestones moving a goal nothing else measures, the graph, the
// draft (Claude stubbed: no subscription spend), and the agent tools. The schema comes from the v2 agentos source.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModCtx } from "./types";
import { mission } from "./mission";

const dir = mkdtempSync(join(tmpdir(), "aos-mission-"));
const dbPath = join(dir, "agentos.db");
const CLI = join(import.meta.dir, "..", "..", "cli", "src", "agentos.ts");
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
function agentos(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args, "--json"], { env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") } });
  return JSON.parse(r.stdout.toString() || "null");
}
const g1 = agentos("goal", "add", "Ship the Mission app", "--horizon", "week").goal.id as string;
const g2 = agentos("goal", "add", "Reach 2 lakh a month", "--horizon", "quarter").goal.id as string;

let reply: any = {};
const calls: any[] = [];
const store = {
  createGoal: (b: any) => { const d = new Database(dbPath); const r = d.query("INSERT INTO goals (title, horizon, status, progress, progress_mode, position, created_at, updated_at) VALUES (?, ?, 'active', 0, 'auto', 0, ?, ?) RETURNING id").get(b.title, b.horizon, new Date().toISOString(), new Date().toISOString()) as any; d.close(); return { id: `g${r.id}`, title: b.title, horizon: b.horizon }; },
  patchGoal: (id: string, b: any) => { const d = new Database(dbPath); d.query("UPDATE goals SET horizon = ?, period = ? WHERE id = ?").run(b.horizon, b.period, Number(id.slice(1))); d.close(); return { id, ...b }; },
};
type Ctx = ModCtx & { _close: () => void };
function ctxFor(path: string, method = "GET", body?: any): Ctx {
  let dbh: Database | null = null;
  const url = new URL(`http://local/api/v1/mod/mission${path}`);
  return {
    req: new Request(url, { method }), url, method, path: url.pathname.replace("/api/v1/mod/mission", "") || "/",
    user: { id: 1, email: "owner@test", role: "owner", agentos_db: dbPath } as any, owner: true, store: store as any,
    dbPath, db: () => (dbh ??= new Database(dbPath)), contentDbPath: join(dir, "content.db"),
    body: async () => body ?? {}, json: (d, s = 200) => Response.json(d, { status: s }), fail: (s, m) => Response.json({ error: m }, { status: s }),
    ai: { claude: async (o: any) => { calls.push(o); return { out: reply, ms: 1, model: o.model }; } } as any,
    codex: async () => { throw new Error("no codex in tests"); }, agentos: async () => null, push: async () => {}, wyn: null,
    conf: (_k, d) => d, dataDir: dir, log: () => {}, _close: () => { dbh?.close(); dbh = null; },
  };
}
async function call(path: string, method = "GET", body?: any) {
  const c = ctxFor(path, method, body);
  try { const r = await mission.handle(c); return r ? { status: r.status, body: await r.json() } : null; } finally { c._close(); }
}
const tool = (n: string) => mission.tools!.find((t) => t.name === n)!;
const jobCtx = () => ctxFor("/");

describe("mission server module", () => {
  test("collections follow the store contract; a temp goal id is accepted, a bad one refused", async () => {
    const put = await call("/milestones/ms_a1", "PUT", { goal: g1, title: "Tables and tests", done: false, position: 0, updated_at: "2026-10-22T10:00:00.000Z" });
    expect(put?.status).toBe(200);
    expect(put?.body.item).toMatchObject({ id: "ms_a1", goal: g1, done: false });
    const replay = await call("/milestones/ms_a1", "PUT", { goal: g1, title: "changed by an old replay", updated_at: "2026-10-22T10:00:00.000Z" });
    expect(replay?.body.item.title).toBe("Tables and tests");
    expect((await call("/checkins/c_tmp", "PUT", { goal: "nk3x9q", state: "on" }))?.status).toBe(200);
    expect((await call("/checkins/c_bad", "PUT", { goal: "goal-4", state: "on" }))?.status).toBe(400);
    expect((await call("/checkins/c_bad2", "PUT", { goal: g1, state: "great" }))?.status).toBe(400);
    const since = await call("/milestones?since=0");
    expect(since?.body.items.length).toBe(1);
    expect(Number(since?.body.cursor)).toBeGreaterThan(0);
    expect((await call("/nope"))).toBeNull();
  });

  test("ticking a milestone moves a goal that has no tasks; the graph counts set and done", async () => {
    await call("/milestones/ms_a2", "PUT", { goal: g1, title: "Server routes", done: false, position: 1 });
    await call("/milestones/ms_a1", "PUT", { goal: g1, title: "Tables and tests", done: true, position: 0 });
    const d = new Database(dbPath); const p = (d.query("SELECT progress FROM goals WHERE id = ?").get(Number(g1.slice(1))) as any).progress; d.close();
    expect(p).toBe(50);
    const gr = await call("/graph");
    expect(gr?.body.totals).toMatchObject({ set: 2, done: 0 });
    expect(gr?.body.weeks.at(-1).hit).toBeNull();
    expect(gr?.body.history[g1][0][1]).toBe(0.5);       // today's history row, written when the graph is read
  });

  test("the draft asks Claude once with his goals as context and keeps only valid fields", async () => {
    reply = { title: "Read 3 books in October", measure: "books · 0 → 3", horizon: "month", aspects: ["mind", "nonsense"], area: "nowhere", parent: g2, due: "2026-10-31", milestones: ["Pick them", "Book 1", "Book 2", "Book 3"], note: "Short and doable." };
    const r = await call("/draft", "POST", { kind: "goal", text: "read 3 books this month" });
    expect(r?.status).toBe(200);
    expect(r?.body).toMatchObject({ title: "Read 3 books in October", horizon: "month", aspects: ["mind"], area: null, parent: g2, due: "2026-10-31", by: "agent" });
    expect(r?.body.milestones.length).toBe(4);
    expect(calls.length).toBe(1);
    expect(calls[0].prompt).toContain("Reach 2 lakh a month");
    reply = { title: "x", measure: "", horizon: "year", aspects: [], parent: g2, milestones: [], note: "" };
    expect((await call("/draft", "POST", { kind: "goal", text: "x" }))?.body.parent).toBeNull();   // a quarter can't hold a year goal
    expect((await call("/draft", "POST", { kind: "goal", text: " " }))?.status).toBe(400);
  });

  test("tools: overview, check-in and milestones run on their own; adding and moving goals ask first", async () => {
    expect(tool("mission_add_goal").auto).toBe(false);
    expect(tool("mission_move_goal").auto).toBe(false);
    expect(tool("mission_log_checkin").auto).toBe(true);
    expect(tool("mission_close_milestone").auto).toBe(true);
    const ov: any = await tool("mission_overview").run(jobCtx(), {});
    expect(ov.goals.find((g: any) => g.id === g1).milestones.map((m: any) => m.title)).toEqual(["Server routes"]);
    const ck: any = await tool("mission_log_checkin").run(jobCtx(), { goal: g1, state: "risk", note: "routes left" });
    expect(ck).toMatchObject({ ok: true, checkin: { by: "agent", state: "risk" } });
    const cm: any = await tool("mission_close_milestone").run(jobCtx(), { goal: g1, title: "server" });
    expect(cm).toMatchObject({ ok: true, progress: 100 });
    const add: any = await tool("mission_add_goal").run(jobCtx(), { title: "Gym four times", horizon: "week", milestones: ["Mon", "Wed"] });
    expect(add.ok).toBe(true);
    expect(add.milestones).toBe(2);
    const mv: any = await tool("mission_move_goal").run(jobCtx(), { goal: add.goal.id, horizon: "month" });
    expect(mv.goal.horizon).toBe("month");
    expect(mv.was.horizon).toBe("week");
    expect(((await tool("mission_log_checkin").run(jobCtx(), { goal: "g999", state: "on" })) as any).ok).toBe(false);
  });
});

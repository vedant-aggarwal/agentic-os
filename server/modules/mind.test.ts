// The Mind module on a throwaway agentos db: the collections (store contract), the day (PC samples + his entries,
// blocks with first guesses), the days view, the check-in nudge job, and the agent's tools (read the day, log reading,
// answer the check-in, park a course, log phone time). No network, no AI.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mind } from "./mind";
import { istDateOf, putDoc } from "../../cli/src/modules/mind.ts";
import type { ModCtx } from "./types";

const dir = mkdtempSync(join(tmpdir(), "aos-mind-"));
const db = new Database(join(dir, "a.db"));
db.exec(`CREATE TABLE ribbon_samples (id INTEGER PRIMARY KEY, at TEXT NOT NULL, title TEXT, process TEXT, repo TEXT, session_id TEXT, area TEXT, project TEXT, task_id INTEGER, seconds INTEGER NOT NULL DEFAULT 30);
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);`);
const TODAY = istDateOf();
const at = (hhmm: string) => new Date(`${TODAY}T${hhmm}:00+05:30`).toISOString();
const ins = db.prepare("INSERT INTO ribbon_samples (at, title, process, seconds) VALUES (?, ?, ?, 30)");
for (let i = 0; i < 40; i++) ins.run(new Date(Date.parse(at("09:00")) + i * 30000).toISOString(), "Claude Code tutorial - YouTube - Google Chrome", "chrome");
for (let i = 0; i < 20; i++) ins.run(new Date(Date.parse(at("10:00")) + i * 30000).toISOString(), "agentos - Terminal", "WindowsTerminal");
afterAll(() => { db.close(); try { rmSync(dir, { recursive: true, force: true }); } catch {} });

const pushes: string[] = [];
function ctx(path: string, { method = "GET", body = {} as any, owner = true } = {}): ModCtx {
  const url = new URL(`http://local/api/v1/mod/mind${path}`);
  return {
    req: new Request(url, { method }), url, method, path: url.pathname.slice("/api/v1/mod/mind".length),
    user: { id: 1, role: owner ? "owner" : "member" } as any, owner, dbPath: "", contentDbPath: "", dataDir: dir, store: {} as any,
    db: () => db, agentos: async () => ({}), conf: (_k, d) => d, ai: { claude: async () => { throw new Error("no AI in tests"); } } as any,
    codex: async () => { throw new Error("no agents in tests"); }, wyn: null, push: async (t, b) => { pushes.push(`${t}: ${b}`); },
    body: async () => body, json: (j, status = 200) => Response.json(j, { status }), fail: (status, error) => Response.json({ error }, { status }), log: () => {},
  };
}
async function call(path: string, opts?: Parameters<typeof ctx>[1]) {
  const r = await mind.handle(ctx(path, opts));
  if (!r) throw new Error(`no route for ${path}`);
  return { status: r.status, data: (await r.json()) as any };
}
const tool = (name: string) => mind.tools!.find((t) => t.name === name)!;

describe("collections", () => {
  test("a book round trip: put, list since a cursor, an older write loses, soft delete", async () => {
    const empty = await call("/books");
    expect(empty.data.items).toEqual([]);
    const t = new Date().toISOString();
    const put = await call("/books/bk1", { method: "PUT", body: { id: "bk1", title: "Deep Work", pages: 296, status: "reading", updated_at: t } });
    expect(put.data.item.title).toBe("Deep Work");
    const since = await call(`/books?since=${empty.data.cursor}`);
    expect(since.data.items.map((x: any) => x.id)).toEqual(["bk1"]);
    const old = await call("/books/bk1", { method: "PUT", body: { id: "bk1", title: "Old", updated_at: "2020-01-01T00:00:00Z" } });
    expect(old.data.item.title).toBe("Deep Work");
    expect((await call("/books", { method: "POST", body: { title: "" } })).status).toBe(400);
    expect((await call("/books/bk1", { method: "DELETE" })).data.item.deleted_at).toBeTruthy();
  });
  test("phone time from the phone is accepted; PC rows are refused from outside", async () => {
    expect((await call("/screen", { method: "POST", body: { id: "s1", date: TODAY, hour: 20, app: "instagram", minutes: 25, source: "manual" } })).status).toBe(201);
    expect((await call("/screen", { method: "POST", body: { id: "s2", date: TODAY, hour: 20, app: "x", minutes: 5, source: "pc" } })).status).toBe(400);
  });
});

describe("the day", () => {
  test("apps from the PC and his entries, with blocks and first guesses", async () => {
    const { data } = await call(`/day?date=${TODAY}`);
    const ids = data.apps.map((a: any) => a.id);
    expect(ids).toContain("youtube");
    expect(ids).toContain("windowsterminal");
    expect(ids).toContain("instagram");
    expect(data.manualIds).toEqual(["s1"]);
    expect(data.blocks.map((b: any) => b.app)).toEqual(["instagram", "youtube"]);
    expect(data.blocks[1].guess[0][0]).toBe("learn");
    expect(data.sources.pc).toBe(true);
    expect(data.kinds.work).toBe(10);
    expect((await call("/day?date=nope")).status).toBe(400);
  });
  test("days: totals and kinds per date", async () => {
    const { data } = await call(`/days?to=${TODAY}`);
    expect(data.days.length).toBe(7);
    expect(data.days.at(-1).total).toBe(55);
  });
  test("the 21:20 nudge asks about the blocks; nothing once answered", async () => {
    const job = mind.jobs!.find((j) => j.id === "nudge")!;
    await job.run(ctx("/") as any);
    expect(pushes.at(-1)).toContain("Instagram");
    putDoc(db, "mind_checkins", { id: `ci.${TODAY}`, date: TODAY, at: new Date().toISOString(), answers: {} });
    pushes.length = 0;
    await job.run(ctx("/") as any);
    expect(pushes.length).toBe(0);
    db.query("DELETE FROM mind_checkins").run();
  });
  test("an ISBN that isn't one is refused without a lookup", async () => {
    expect((await call("/isbn/12345678901")).data.error).toContain("ISBN");
  });
});

describe("tools", () => {
  test("every tool says whether she may act on her own", () => {
    for (const t of mind.tools!) { expect(typeof t.auto).toBe("boolean"); expect(t.input.type).toBe("object"); }
  });
  test("log reading, answer the check-in, park a course, log phone time", async () => {
    const r: any = await tool("mind_log_reading").run(ctx("/") as any, { book: "Atomic Habits", minutes: 30 });
    expect(r.book.title).toBe("Atomic Habits");
    expect(r.book.page).toBe(18);
    const ci: any = await tool("mind_answer_checkin").run(ctx("/") as any, { answers: [{ app: "insta", label: "research", minutes: 25 }, { app: "youtube", label: "learn", minutes: 20 }] });
    expect(ci.answers.instagram).toEqual([["research", 25]]);
    const day: any = await tool("mind_today").run(ctx("/") as any, {});
    expect(day.checkin.answered).toBe(true);
    expect(day.reading.minutes).toBe(30);
    putDoc(db, "mind_courses", { id: "c.road", title: "30 Day Roadmap", status: "active", source: "skool", position: 0 });
    const p: any = await tool("mind_park_course").run(ctx("/") as any, { course: "roadmap", park: true });
    expect(p.course.status).toBe("parked");
    const s: any = await tool("mind_log_screen_time").run(ctx("/") as any, { app: "YouTube", minutes: 15 });
    expect(s.app).toBe("youtube");
  });
});

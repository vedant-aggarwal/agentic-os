// Soul on the PC: the store routes, NATIVE's habit check from a widget, the summary keeps Clean to "Day N", her lock
// ask and his answer, the unlock judge within his rules, and the agent tools.
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { soul, _soul } from "./soul";
import { judgeUnlock, habitState, lockHolds, cleanRecord, learnWindows, heat } from "../../app/js/aspects/soul-logic.js";

function setup() {
  const db = new Database(":memory:");
  const call = async (method: string, path: string, body?: unknown) => {
    const url = new URL(`http://x/api/v1/mod/soul${path}`);
    const ctx: any = { method, path, url, db: () => db, body: async () => body, json: (d: unknown, s = 200) => Response.json(d, { status: s }), fail: (s: number, m: string) => Response.json({ error: m }, { status: s }) };
    const r = await soul.handle(ctx);
    return r ? { status: r.status, json: (await r.json()) as any } : null;
  };
  const jctx: any = { db: () => db, push: async () => {}, log: () => {} };
  return { db, call, jctx };
}
const tool = (n: string) => soul.tools!.find((t) => t.name === n)!;

test("habits and checks round-trip; a widget's check fills its date and counts once", async () => {
  const { call } = setup();
  expect((await call("PUT", "/habits/hab_1", { title: "Read 20 pages", part: "evening", at: "21:30", of: 20 }))!.status).toBe(200);
  expect((await call("PUT", "/habits/hab_2", { part: "noon" }))!.status).toBe(400);
  const at = new Date().toISOString();
  const w = { id: "w_abc", habit: "hab_1", at, done: true, source: "widget", updated_at: at };
  expect((await call("POST", "/checks", w))!.status).toBe(201);
  expect((await call("POST", "/checks", w))!.status).toBe(200);
  const s = (await call("GET", "/summary"))!.json;
  expect(s.habits).toMatchObject({ done: 1, total: 1 });
  expect(s.habits.items[0]).toMatchObject({ id: "hab_1", done: true, streak: 1 });
});

test("Clean leaves Soul only as Day N", async () => {
  const { call } = setup();
  const since = new Date(Date.now() - 9.4 * 864e5).toISOString();
  await call("PUT", "/clean/clean", { name: "Clean", since, reasons: ["something private"], goal: 30 });
  const s = (await call("GET", "/summary"))!.json;
  expect(s.clean).toEqual({ text: "Day 10", private: true, widget: false });
  expect(JSON.stringify(s)).not.toContain("something private");
  expect(JSON.stringify(await tool("soul_status").run({ db: () => setup().db } as any, {}))).not.toContain("private\"]");
});

test("an ask-first lock holds only after his yes; the answer route takes the widget's body", async () => {
  const { call, db } = setup();
  await call("PUT", "/locks/lk_eve", { name: "Evening window", kind: "window", apps: ["Instagram"], start: "00:00", end: "23:59", ask_first: true, active: true });
  const date = new Date(Date.now() + 330 * 6e4).toISOString().slice(0, 10);
  await call("PUT", `/asks/ask_lk_eve_${date}`, { date, lock: "lk_eve", title: "Lock Instagram?", state: "pending" });
  expect((await call("GET", "/summary"))!.json.ask.id).toBe(`ask_lk_eve_${date}`);
  expect((await call("GET", "/summary"))!.json.locks.holding).toHaveLength(0);
  const r = await call("POST", `/asks/ask_lk_eve_${date}/answer`, { text: "Lock it", choice: "yes" });
  expect(r!.json.item.state).toBe("yes");
  const s = (await call("GET", "/summary"))!.json;
  expect(s.ask).toBeNull();
  expect(s.locks.holding[0]).toMatchObject({ id: "lk_eve", until: "23:59" });
  // the agent hears a reason inside the lock
  const weak = _soul.judge(db, { app: "instagram", reason: "just five minutes" });
  expect(weak).toMatchObject({ out: "held", locked: true });
  const work = _soul.judge(db, { app: "instagram", reason: "Post today's reel for Corner Market" });
  expect(work).toMatchObject({ out: "open", mins: 10 });
  expect(work.say).toContain("Posting counts as work");
  expect((await call("GET", "/talks"))!.json.items).toHaveLength(2);
});

test("a proposed window becomes a lock on his yes", async () => {
  const { call, db } = setup();
  const p: any = await tool("soul_propose_lock").run({ db: () => db } as any, { apps: ["Instagram"], start: "18:00", end: "19:00", days: [1, 2, 3, 4, 5] });
  expect(p.ok).toBe(true);
  expect(tool("soul_propose_lock").auto).toBe(false);
  await call("POST", `/asks/${p.ask}/answer`, { choice: "yes" });
  const locks = (await call("GET", "/locks"))!.json.items;
  expect(locks[0]).toMatchObject({ kind: "window", start: "18:00", end: "19:00", active: true });
});

test("the ask job asks once before an ask-first window", async () => {
  const { call, db, jctx } = setup();
  const m = Math.floor(((Date.now() / 6e4) + 330) % 1440);
  const hm = (x: number) => `${String(Math.floor(((x + 1440) % 1440) / 60)).padStart(2, "0")}:${String(((x + 1440) % 1440) % 60).padStart(2, "0")}`;
  if (m > 1400) return;   // too close to midnight to test the window
  await call("PUT", "/locks/lk_x", { name: "Soon", kind: "window", apps: ["YouTube"], start: hm(m + 20), end: hm(m + 80), ask_first: true, active: true });
  await _soul.askJob(jctx); await _soul.askJob(jctx);
  const asks = (await call("GET", "/asks"))!.json.items;
  expect(asks).toHaveLength(1);
  expect(asks[0]).toMatchObject({ lock: "lk_x", state: "pending" });
});

test("tools: check a habit by title, log an urge, check in", async () => {
  const { call, db } = setup();
  await call("PUT", "/habits/hab_g", { title: "Morning gym", part: "morning" });
  expect(await tool("soul_check_habit").run({ db: () => db } as any, { habit: "gym" })).toMatchObject({ ok: true, done: true, streak: 1 });
  expect(await tool("soul_log_urge").run({ db: () => db } as any, { place: "Home", out: "rode", mins: 7 })).toMatchObject({ ok: true, out: "rode" });
  expect(await tool("soul_check_in").run({ db: () => db } as any, { v: 2 })).toMatchObject({ ok: true });
  expect((await call("GET", "/moods"))!.json.items[0].v).toBe(2);
  expect(soul.tools!.filter((t) => t.auto).map((t) => t.name).sort()).toEqual(["soul_answer_unlock", "soul_check_habit", "soul_check_in", "soul_log_urge", "soul_status"]);
});

test("the rules: forgiving streaks, judge limits, windows, the record", () => {
  const h = { id: "h", start: "2026-10-01" };
  const c = (date: string, x: any = { done: true }) => ({ id: date, habit: "h", date, updated_at: date, ...x });
  const s = habitState(h, [c("2026-10-01"), c("2026-10-02"), c("2026-10-04")], "2026-10-05", 600);
  expect(s).toMatchObject({ streak: 3, best: 3, done: false });
  expect(s.hist.slice(-5)).toBe("11010".slice(0, 4) + ".");
  expect(habitState(h, [c("2026-10-01"), c("2026-10-04")], "2026-10-05", 600).streak).toBe(1);
  expect(habitState({ ...h, part: "morning", at: "06:15" }, [c("2026-10-04")], "2026-10-05", 600)).toMatchObject({ missed: true, atRisk: true });
  expect(judgeUnlock({ text: "reply to a customer order", opensLeft: 0 }).out).toBe("held");
  expect(judgeUnlock({ text: "reply to a customer order", hard: true }).out).toBe("held");
  expect(judgeUnlock({ text: "need it for something" }).out).toBe("more");
  expect(judgeUnlock({ text: "need it for something", round: 1 }).out).toBe("held");
  const now = Date.parse("2026-10-22T13:00:00Z");   // 18:30 IST, Thursday
  expect(lockHolds({ kind: "window", start: "18:00", end: "19:00", days: [1, 2, 3, 4, 5] }, now)).toBe(true);
  expect(lockHolds({ kind: "window", start: "18:00", end: "19:00", days: [6, 7] }, now)).toBe(false);
  expect(lockHolds({ kind: "bedtime", start: "22:45", end: "06:00" }, Date.parse("2026-10-22T19:00:00Z"))).toBe(true);   // 00:30 IST
  const rec = cleanRecord({ since: "2026-10-13T02:44:00Z" }, [{ prev_since: "2026-09-01T00:00:00Z", at: "2026-09-17T00:00:00Z" }], now);
  expect(rec).toMatchObject({ best: 16, bestCurrent: false });
  const ev = Array.from({ length: 5 }, (_, i) => ({ at: new Date(Date.parse("2026-10-19T12:40:00Z") + i * 864e5 * (i < 4 ? 1 : 0)).toISOString() }));
  const g = heat(ev, now);
  expect(g.n).toBe(5);
  expect(learnWindows(g.grid)[0]).toMatchObject({ start: "18:00", end: "19:00", days: [1, 2, 3, 4, 5] });
});

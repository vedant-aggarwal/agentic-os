// Body's server module on a throwaway DB: the collections, name-only meals getting their numbers, today's state, the
// PT plan (rules, and Claude stubbed), the library, and the agent's tools with their undo.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { body } from "./body";

const dir = mkdtempSync(join(tmpdir(), "body-mod-"));
const db = new Database(join(dir, "a.db"));
db.exec("PRAGMA journal_mode = WAL");
let aiCalls = 0;
const ai: any = { claude: async ({ schema }: any) => { aiCalls++; return { out: { name: "Push, lighter", split: "push", why: "Chest is fresh and you slept well.", reasons: ["Chest 100%"], items: [{ ex: "bench", sets: 3, w: 40, r: 6, t: null, min: null, note: "Smooth reps." }, { ex: "dead-hang", sets: 3, w: null, r: null, t: 60, min: null, note: "Your rule." }, { ex: "not-an-exercise", sets: 3, note: "dropped" }] }, ms: 1, model: "sonnet" }; } };
const pushes: any[] = [];
const base = { db: () => db, ai, dataDir: dir, conf: (_k: string, d: string) => d, log: () => {}, push: async (...a: any[]) => { pushes.push(a); }, codex: async () => ({ out: {}, text: "", ms: 0 }) };
async function call(method: string, path: string, b?: unknown) {
  const url = new URL(`http://x/api/v1/mod/body${path}`);
  const ctx: any = { ...base, method, path: url.pathname.replace("/api/v1/mod/body", "") || "/", url, body: async () => b,
    json: (d: unknown, s = 200) => Response.json(d, { status: s }), fail: (s: number, m: string) => Response.json({ error: m }, { status: s }) };
  const r = await body.handle(ctx);
  return r ? { status: r.status, json: (await r.json()) as any } : null;
}
const tool = (name: string) => body.tools!.find((t) => t.name === name)!;
const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
afterAll(() => { db.close(); try { rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("body module", () => {
  test("answers its status and mounts every collection", async () => {
    const r = await call("GET", "/");
    expect(r!.json.collections).toEqual(["workouts", "meals", "readings", "protocol", "checks", "programs", "scans", "settings", "exercises"]);
    expect(r!.json.library).toBeGreaterThan(800);
    const w = await call("PUT", "/workouts/w1", { date: today, status: "done", name: "Push", split: "push", started_at: new Date(Date.now() - 3 * 36e5).toISOString(),
      items: [{ ex: "bench", sets: [{ w: 45, r: 6, done: true }, { w: 45, r: 6, done: true }, { w: 45, r: 6, done: true }, { w: 45, r: 6, done: true }] }, { ex: "incline-db", sets: [{ w: 14, r: 10, done: true }, { w: 14, r: 10, done: true }, { w: 14, r: 9, done: true }] }], updated_at: new Date().toISOString() });
    expect(w!.status).toBe(200);
    expect((await call("PUT", "/workouts/w2", { date: "tomorrow" }))!.status).toBe(400);
    expect((await call("GET", "/workouts"))!.json.items).toHaveLength(1);
  });

  test("a name-only meal (Siri, a widget) is stored with estimated numbers, its day and its slot", async () => {
    const at = `${today}T03:00:00.000Z`;   // 08:30 IST
    const r = await call("POST", "/meals", { id: "siri-1", name: "2 roti and a katori of dal", at, updated_at: at, source: "siri" });
    expect(r!.status).toBe(201);
    expect(r!.json.item).toMatchObject({ date: today, slot: "breakfast", estimate: true, source: "siri" });
    expect(r!.json.item.kcal).toBe(370); expect(r!.json.item.protein).toBe(14);
    expect((await call("POST", "/meals", { id: "siri-1", name: "2 roti and a katori of dal", at, updated_at: at }))!.status).toBe(200);   // a replay is a no-op
    expect((await call("POST", "/meals", { id: "x", kcal: 10 }))!.status).toBe(400);
    expect((await call("POST", "/estimate", { text: "a glass of milk and 2 eggs" }))!.json.protein).toBe(20);
  });

  test("today's state, and the PT plan by the rules and by Claude (stubbed), never replacing a started session", async () => {
    const t = await call("GET", "/today");
    expect(t!.json.trained[0]).toMatchObject({ name: "Push", sets: 7 });
    expect(t!.json.recovering.map((m: any) => m.m)).toContain("chest");
    expect(t!.json.food.protein_target).toBe(180);
    expect(t!.json.next.date > today).toBe(true);   // trained today, so the next plan is tomorrow's
    const rules = await call("POST", "/plan", { ai: false });
    expect(rules!.json.by).toBe("rules"); expect(rules!.json.plan.name).toBe("Pull");
    expect(rules!.json.plan.items.at(-1).ex).toBe("dead-hang");
    const n = aiCalls;
    const p = await call("POST", "/plan", {});
    expect(aiCalls).toBe(n + 1); expect(p!.json.by).toBe("wyn");
    expect(p!.json.plan.items.map((i: any) => i.ex)).toEqual(["bench", "dead-hang"]);
    expect((await call("GET", `/workouts/plan-${p!.json.plan.date}`))!.json.item.status).toBe("planned");
    await call("PUT", `/workouts/plan-${p!.json.plan.date}`, { date: p!.json.plan.date, status: "live", updated_at: new Date(Date.now() + 1000).toISOString() });
    const again = await call("POST", "/plan", { date: p!.json.plan.date, ai: false });
    expect(again!.json.kept).toBe(true);
  });

  test("the library: search, lite and one", async () => {
    const r = await call("GET", "/library?q=bench%20press&muscle=chest");
    expect(r!.json.items.length).toBeGreaterThan(0);
    const lite = await call("GET", "/library?lite=1");
    expect(lite!.json.items[0].how).toBeUndefined();
    expect((await call("GET", `/library/${encodeURIComponent(r!.json.items[0].id)}`))!.json.item.how.length).toBeGreaterThan(0);
  });

  test("tools: log a meal and undo it, log sets, the protocol, a reminder, a reading, fresh, the summary", async () => {
    const m: any = await tool("log_meal").run(base as any, { name: "whey shake with milk" });
    expect(m.ok).toBe(true); expect(m.say).toMatch(/kcal/);
    expect((await call("GET", `/meals/${m.id}`))!.json.item.protein).toBe(32);
    await tool("undo").run(base as any, m.undo.args);
    expect((await call("GET", `/meals/${m.id}`))!.json.item.deleted_at).toBeTruthy();
    const s: any = await tool("log_sets").run(base as any, { exercise: "Dead hang", sets: [{ t: 45 }, { t: 40 }] });
    expect(s.ok).toBe(true); expect(s.workout).toBe("w1");
    const w = (await call("GET", "/workouts/w1"))!.json.item;
    expect(w.items.find((i: any) => i.ex === "dead-hang").sets).toHaveLength(2);
    await tool("undo").run(base as any, s.undo.args);
    expect((await call("GET", "/workouts/w1"))!.json.item.items).toHaveLength(2);
    await call("PUT", "/protocol/pm1", { half: "pm", text: "Stretch", ord: 1, active: true });
    const c: any = await tool("check_protocol").run(base as any, { item: "stretch" });
    expect(c.ok).toBe(true);
    expect((await call("GET", `/checks/${today}:pm1`))!.json.item.done).toBe(true);
    expect(((await tool("set_protocol_reminder").run(base as any, { half: "pm", at: "22:15" })) as any).ok).toBe(true);
    expect((await call("GET", "/today"))!.json.protocol).toMatchObject({ pm_due: "22:15", done: 1, pm: true, streak: 1 });
    expect(((await tool("log_reading").run(base as any, { kind: "weight", value: 75.4 })) as any).ok).toBe(true);
    expect((await call("GET", "/today"))!.json.weight.now).toBe(75.4);
    await tool("mark_fresh").run(base as any, { muscle: "chest" });
    expect((await call("GET", "/today"))!.json.recovering.map((x: any) => x.m)).not.toContain("chest");
    const sum: any = await tool("summary").run(base as any, {});
    expect(sum.line).toMatch(/Trained: Push/); expect(sum.streaks[0]).toMatchObject({ id: "protocol", n: 1 });
    expect(body.tools!.every((t) => t.name && t.description && t.input && typeof t.run === "function")).toBe(true);
  });

  test("face-read refuses anything that isn't a photo", async () => {
    expect((await call("POST", "/face-read", { image: "nope" }))!.status).toBe(400);
  });
});

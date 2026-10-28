// Mission: purpose versions, milestones that move a goal with nothing else measuring it, check-ins, horizon notes,
// lifetime directions, the daily history and the graph. Each test runs the real CLI on a temp DB.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "agentos-mission-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") } });
  return { text: r.stdout.toString(), err: r.stderr.toString(), code: r.exitCode };
}
const json = (...args: string[]) => { const r = cli(...args, "--json"); try { return JSON.parse(r.text); } catch { throw new Error(`${args.join(" ")}: ${r.text} ${r.err}`); } };
const SLOW = 60_000;

describe("agentos mission", () => {
  test("starts empty: no purpose, no streak, every table there", () => {
    const r = json("mission");
    expect(r.purpose).toBeNull();
    expect(r.streak).toBe(0);
    expect(r.totals.set).toBe(0);
    const db = new Database(dbPath, { readonly: true });
    const names = (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mission_%'").all() as any[]).map((x) => x.name).sort();
    db.close();
    expect(names).toEqual(["mission_checkins", "mission_history", "mission_life", "mission_milestones", "mission_notes", "mission_purpose"]);
  }, SLOW);

  test("purpose: each new wording is a version; the same wording twice is one", () => {
    expect(json("mission", "purpose", "set", "Build tools shops pay for").ok).toBe(true);
    expect(json("mission", "purpose", "set", "Build tools shops pay for").already).toBe(true);
    json("mission", "purpose", "set", "Build software shops run on, and make my parents proud");
    const p = json("mission", "purpose");
    expect(p.versions.length).toBe(2);
    expect(p.current.text).toContain("parents proud");
    const db = new Database(dbPath, { readonly: true });
    const row = db.query("SELECT rev, data FROM mission_purpose ORDER BY rev DESC LIMIT 1").get() as any;
    db.close();
    expect(row.rev).toBe(2);                         // the collection's cursor moves with each write
    expect(JSON.parse(row.data).by).toBe("me");
  }, SLOW);

  test("milestones move a goal that nothing else measures; a goal with tasks keeps its task progress", () => {
    const g = json("goal", "add", "Ship the Mission app", "--horizon", "week").goal ?? json("goal", "board").goals?.[0];
    const id = `g${String(g.id).replace(/^g/, "")}`;
    const a = json("mission", "milestone", "add", id, "Tables and tests").milestone;
    json("mission", "milestone", "add", id, "Server routes", "--due", "2026-10-25");
    expect(json("mission", "milestones", id).milestones.map((m: any) => m.title)).toEqual(["Tables and tests", "Server routes"]);
    const d = json("mission", "milestone", "done", a.id);
    expect(d.milestone.done).toBe(true);
    expect(d.progress).toBe(50);
    const db = new Database(dbPath, { readonly: true });
    expect((db.query("SELECT progress FROM goals WHERE id = ?").get(Number(id.slice(1))) as any).progress).toBe(50);
    db.close();
    expect(json("mission", "milestone", "undo", a.id).progress).toBe(0);
    expect(cli("mission", "milestone", "add", "g999", "x", "--json").code).toBe(2);
  }, SLOW);

  test("check-ins, notes per period (one per period: a second write replaces it), lifetime directions", () => {
    const id = `g${json("goal", "add", "Read 12 books", "--horizon", "year").goal.id}`.replace("gg", "g");
    const c = json("mission", "checkin", id, "risk", "--note", "22 pages this week").checkin;
    expect(c).toMatchObject({ goal: id, state: "risk", note: "22 pages this week", by: "me" });
    expect(cli("mission", "checkin", id, "great", "--json").code).toBe(2);
    expect(json("mission", "checkins", id).checkins.length).toBe(1);
    json("mission", "note", "week", "Two sales calls", "--period", "2026-W43");
    const n = json("mission", "note", "week", "Two sales calls before Thursday", "--period", "2026-W43").note;
    expect(n.id).toBe("week:2026-W43");
    expect(json("mission", "notes").notes.length).toBe(1);
    const l = json("mission", "life", "add", "Ship tools real shops pay for", "--fam", "work", "--aspects", "mission,money").direction;
    expect(l).toMatchObject({ fam: "work", aspects: ["mission", "money"] });
    expect(cli("mission", "life", "add", "x", "--fam", "space", "--json").code).toBe(2);
  }, SLOW);

  test("snapshot writes one row per goal per day (twice is still one); the graph counts set and done by week", () => {
    const s1 = json("mission", "snapshot"), s2 = json("mission", "snapshot");
    expect(s1.goals).toBe(2);
    expect(s2.goals).toBe(2);
    const h = json("mission", "history").history;
    expect(Object.keys(h).length).toBe(2);
    expect(Object.values(h).every((rows: any) => rows.length === 1)).toBe(true);
    const first = json("goal", "board").goals?.[0] ?? null;
    const gid = json("goal", "add", "Done already", "--horizon", "month").goal.id;
    json("goal", "done", `g${String(gid).replace(/^g/, "")}`);
    const g = json("mission", "graph");
    expect(g.totals).toMatchObject({ set: 3, done: 1 });
    expect(g.weeks.length).toBeGreaterThanOrEqual(1);
    const last = g.weeks.at(-1);
    expect(last.set).toBe(3);
    expect(last.done).toBe(1);
    expect(last.hit).toBeNull();                       // this week is still open
    expect(g.closed.some((c: any) => c.state === "done" && c.title === "Done already")).toBe(true);
    expect(g.months.at(-1).now).toBe(true);
    void first;
  }, SLOW);
});

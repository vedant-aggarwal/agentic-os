// Body on a throwaway DB: the tables and their shape, doc upserts, records, totals, the library, the Wyn import, the CLI.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BODY_COLLECTIONS, body, e1rm, getDoc, importWyn, library, listDocs, mealTotals, migrateBody, putDoc, records, searchLibrary, volumeOf } from "./body";

const dir = mkdtempSync(join(tmpdir(), "agentos-body-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
const env = { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") };
const cli = (...args: string[]) => { const r = Bun.spawnSync(["bun", CLI, ...args, "--json"], { env }); return { out: r.stdout.toString(), err: r.stderr.toString(), code: r.exitCode }; };
const life = join(dir, "life");
let db: Database;

beforeAll(() => {
  expect(cli("mods").code).toBe(0);
  db = new Database(dbPath);
  mkdirSync(life);
  const L = (rows: any[]) => rows.map((r) => JSON.stringify(r)).join("\n");
  writeFileSync(join(life, "diet.jsonl"), L([
    { date: "2026-08-03", estimate: 1, items: "protein oats with milk", kcal: 720, protein_g: 35, slot: "breakfast", ts: 1785726907 },
    { correction: "light portions, breakfast revised from 720 to 500 kcal", date: "2026-08-03", kcal: -220, protein_g: 0, slot: "breakfast_adjustment", ts: 1785727140 },
    { date: "2026-08-03", estimate: 1, kcal: 120, note: "Rs 20 regular Coke", protein_g: 0, slot: "coke", ts: 1785772921 },
    { date: "2026-09-05", kcal_est: 2200, plan: "Oats whey milk banana", protein_g: 150, ts: 1788569106 },
  ]));
  writeFileSync(join(life, "gym.jsonl"), L([
    { date: "2026-08-03", done: 0, reason: "late utha", ts: 1785724491 },
    { date: "2026-08-03", note: "raat ko gym pahunch gaya", started: 1, time: "21:25", ts: 1785772564 },
    { date: "2026-08-03", note: "cardio-only session", ts: 1785773622, type: "cardio_only" },
    { date: "2026-08-10", done: 0, reason: "late utha; class miss", ts: 1786334818 },
    { date: "2026-09-05", note: "At gym by 06:06", started: 1, ts: 1788568649 },
    { date: "2026-09-05", note: "choosing push instead of legs", planned: "push", ts: 1788568756 },
  ]));
  writeFileSync(join(life, "cardio.jsonl"), L([
    { date: "2026-08-03", note: "final stats pending", planned: 1, ts: 1785772564 },
    { date: "2026-08-03", distance_km: 1, incline_pct: 15, kcal_out: 200, mins: 15, speed_kmh: 4, ts: 1785773622, type: "treadmill" },
  ]));
  writeFileSync(join(life, "body.jsonl"), L([{ age: 24, date: "2026-08-03", height_cm: 175, sex: "male", ts: 1785725175 },
    { age: 25, challenge_days: 105, challenge_end: "2026-12-31", date: "2026-09-18", height_cm: 175, sex: "male", ts: 1789747702 }]));
});
afterAll(() => { db?.close(); try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may hold the WAL a moment */ } });

describe("body", () => {
  test("owns its tables in the store shape, and migrate is idempotent", () => {
    const names = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'body_%' ORDER BY name").all() as any[]).map((r) => r.name);
    expect(names).toEqual(Object.values(BODY_COLLECTIONS).map((c) => c.table).sort());
    const cols = (db.query("PRAGMA table_info(body_workouts)").all() as any[]).map((r) => r.name);
    for (const c of ["id", "data", "created_at", "updated_at", "deleted_at", "rev", "date", "status", "split", "name", "started_at", "ended_at", "source"]) expect(cols).toContain(c);
    migrateBody(db); migrateBody(db);
    expect(body.name).toBe("body");
  });

  test("docs upsert by id, bump rev, keep fields, and soft delete", () => {
    const a = putDoc(db, "meals", { id: "m1", name: "Dal chawal", kcal: 480, protein: 14, date: "2026-10-20", at: "2026-10-20T08:00:00.000Z", items: [{ name: "Dal" }] });
    expect(a.kcal).toBe(480); expect(a.items).toEqual([{ name: "Dal" }]);
    const b = putDoc(db, "meals", { id: "m1", protein: 16 });
    expect(b.name).toBe("Dal chawal"); expect(b.protein).toBe(16);
    const revs = db.query("SELECT rev FROM body_meals WHERE id = 'm1'").get() as any;
    expect(revs.rev).toBeGreaterThan(1);
    putDoc(db, "meals", { id: "m1", deleted_at: new Date().toISOString() });
    expect(listDocs(db, "meals", "date = ?", "2026-10-20")).toHaveLength(0);
    expect(getDoc(db, "meals", "m1").deleted_at).toBeTruthy();
  });

  test("records, volume and totals", () => {
    const w1 = { status: "done", date: "2026-10-01", items: [{ ex: "bench", kind: "weight", sets: [{ w: 20, r: 10, warm: true, done: true }, { w: 40, r: 5, done: true }, { w: 42.5, r: 5, done: true }] }] };
    const w2 = { status: "done", date: "2026-10-08", items: [{ ex: "bench", kind: "weight", sets: [{ w: 45, r: 5, done: true }, { w: 45, r: 4, done: false }] }, { ex: "plank", kind: "time", sets: [{ t: 45, done: true }] }] };
    expect(volumeOf(w1)).toBe(40 * 5 + 42.5 * 5);
    expect(volumeOf(w2)).toBe(225);
    const r = records([w2, w1, { status: "planned", date: "2026-10-30", items: [{ ex: "bench", kind: "weight", sets: [{ w: 100, r: 5 }] }] }]);
    expect(r.bench.set.w).toBe(45); expect(r.bench.est).toBe(Math.round(e1rm(45, 5) * 2) / 2); expect(r.plank.set.t).toBe(45);
    expect(mealTotals([{ kcal: 100.4, protein: 10 }, { kcal: 200, protein: 5.6, carbs: 30 }])).toEqual({ kcal: 300, protein: 16, carbs: 30, fat: 0, n: 2 });
  });

  test("the free-exercise-db library loads and searches by name and muscle", () => {
    expect(library().length).toBeGreaterThan(800);
    const hits = searchLibrary("bench press", "chest", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((e) => /bench/i.test(e.name) && /press/i.test(e.name) && (e.p.includes("chest") || e.s.includes("chest")))).toBe(true);
    const e = hits[0];
    expect(["weight", "bw", "time", "cardio"]).toContain(e.kind);
  });

  test("imports Wyn's life files once: meals with corrections folded in, sessions, missed days, the profile", () => {
    const dry = importWyn(db, life, { dry: true });
    expect(dry.docs.length).toBe(6);
    expect(listDocs(db, "workouts")).toHaveLength(0);
    const r = importWyn(db, life);
    expect([r.meals, r.workouts, r.missed, r.profile]).toEqual([2, 2, 1, 1]);
    const bf = listDocs(db, "meals", "date = ?", "2026-08-03").find((m) => m.slot === "breakfast");
    expect(bf.kcal).toBe(500); expect(bf.source).toBe("wyn");
    const s = getDoc(db, "workouts", "wyn-gym-2026-08-03");
    expect(s.status).toBe("done"); expect(s.name).toBe("Cardio"); expect(s.items[0].sets[0].min).toBe(15); expect(s.at).toBe("21:25");
    expect(getDoc(db, "workouts", "wyn-gym-2026-09-05").name).toBe("Push");
    expect(getDoc(db, "workouts", "wyn-miss-2026-08-10").status).toBe("skipped");
    const p = getDoc(db, "settings", "profile");
    expect(p.height_cm).toBe(175); expect(p.challenge).toEqual({ days: 105, end: "2026-12-31", start: "2026-09-18" });
    const again = importWyn(db, life);
    expect(again.docs).toHaveLength(0); expect(again.skipped).toBe(6);
  });

  test("the CLI: overview, log-meal, reading, workouts, records, exercises, errors", () => {
    const m = JSON.parse(cli("body", "log-meal", "2 roti and paneer", "--kcal", "450", "--protein", "24", "--at", "2026-10-21T14:30:00.000Z").out);
    expect(m.meal.slot).toBe("dinner"); expect(m.meal.date).toBe("2026-10-21");
    const rd = JSON.parse(cli("body", "reading", "weight", "76.8", "--date", "2026-07-18").out);
    expect(rd.reading.id).toBe("weight:2026-07-18");
    expect(JSON.parse(cli("body", "meals", "--date", "2026-10-21").out).totals.protein).toBe(24);
    expect(JSON.parse(cli("body", "workouts", "--days", "3650").out).count).toBe(3);
    expect(JSON.parse(cli("body").out).readings.weight.value).toBe(76.8);
    expect(JSON.parse(cli("body", "exercises", "--search", "squat", "--limit", "3").out).matches.length).toBe(3);
    expect(cli("body", "reading", "mood", "3").code).toBe(2);
    expect(cli("body", "nope").code).toBe(2);
  });
});

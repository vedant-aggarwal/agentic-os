// Week weather: the inputs come from the DB and the calendar file, the simulation is deterministic for a seed,
// impossible weeks get low odds, easy ones high, and the CLI stores and reads a run.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mondayOf, plusDays } from "./cabinet";
import { buildInputs, headline, istDate, rankChanges, simulate } from "./weather";

const dir = mkdtempSync(join(tmpdir(), "agentos-weather-"));
const dbPath = join(dir, "t.db");
const eventsPath = join(dir, "workspace.json");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows keeps the -shm file a moment longer */ } });
function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: eventsPath, AGENTOS_CONTENT_DB: join(dir, "content.db") } });
  return { text: r.stdout.toString(), code: r.exitCode };
}
const json = (...args: string[]) => JSON.parse(cli(...args, "--json").text);
const SLOW = 60_000;

// The week under test is the real current week (the CLI reads the clock), simulated from a Monday 09:00 "now".
const today = istDate(new Date());
const week = mondayOf(today);
const day = (i: number) => plusDays(week, i);
const now = new Date(`${week}T09:00:00+05:30`);
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`).toISOString();

beforeAll(() => {
  expect(cli("mods").code).toBe(0); // creates the DB with every module's tables
  const events: any[] = [];
  // Eight weeks of history and the week itself: sleep 23:00–06:30, gym 07:00–08:30 Mon–Fri, a Deep Work container Tue/Thu.
  for (let d = -56; d < 7; d++) {
    const date = day(d), wd = new Date(`${date}T00:00:00Z`).getUTCDay();
    events.push({ id: `sleep:${date}`, title: "Sleep", start: at(date, "23:00"), end: at(plusDays(date, 1), "06:30"), allDay: false });
    if (wd >= 1 && wd <= 5) events.push({ id: `gym:${date}`, title: "Morning Gym (Lifting)", start: at(date, "07:00"), end: at(date, "08:30"), allDay: false });
    if (wd === 2 || wd === 4) events.push({ id: `dw:${date}`, title: "Corner Market (Deep Work)", start: at(date, "14:00"), end: at(date, "16:00"), allDay: false });
    // The gym was skipped every other Monday in the history: the calendar says so.
    if (d < 0 && wd === 1 && Math.floor(d / 7) % 2 === 0) events.push({ id: `skip:${date}`, title: "Skipped today: Morning Gym (Lifting)", start: at(date, "07:00"), end: at(date, "07:05"), allDay: false });
  }
  // A busy Wednesday: classes 09:00–18:00 leave almost nothing free.
  events.push({ id: "class-w", title: "Algebra (Th. & Tut.)", start: at(day(2), "09:00"), end: at(day(2), "18:00"), allDay: false });
  events.push({ id: "hack", title: "Hack Week", start: at(day(0), "10:00"), end: at(day(4), "18:00"), allDay: false }); // multi-day: background, not booked time
  writeFileSync(eventsPath, JSON.stringify({ events }));
  const db = new Database(dbPath);
  try {
    const stamp = new Date().toISOString();
    const ins = db.prepare("INSERT INTO tasks (title, area, status, priority, due, estimate_minutes, start_at, end_at, created_at, updated_at) VALUES (?, ?, 'todo', ?, ?, ?, ?, ?, ?, ?)");
    ins.run("Pulse Chat: ship the order status page", "northwind", 1, day(3), 240, null, null, stamp, stamp);      // Thursday, 4 hours
    ins.run("Pulse Chat: write the release note", "northwind", 2, day(3), 30, null, null, stamp, stamp);
    ins.run("Call Dad about the stock", "personal", 2, day(1), 15, null, null, stamp, stamp);                   // Tuesday, 15 minutes
    ins.run("Rewrite the whole ERP in a day", "projects", 2, day(0), 1800, null, null, stamp, stamp);           // Monday, 30 hours: impossible
    ins.run("Corner Market catalogue", "corner-market", 2, day(4), 90, at(day(4), "10:00"), at(day(4), "11:30"), stamp, stamp); // scheduled Friday
    ins.run("Read the design book", "personal", 3, null, 60, null, null, stamp, stamp);                          // undated
    // Six finished tasks with real timings, so the area median and overrun have data.
    const done = db.prepare("INSERT INTO tasks (title, area, status, estimate_minutes, started_at, done_at, created_at, updated_at) VALUES (?, 'northwind', 'done', ?, ?, ?, ?, ?)");
    for (let i = 0; i < 6; i++) { const s = new Date(now.getTime() - (i + 1) * 864e5); done.run(`Old job ${i}`, 60, s.toISOString(), new Date(s.getTime() + 90 * 60000).toISOString(), stamp, stamp); }
  } finally { db.close(); }
});

describe("inputs", () => {
  test("days carry the awake window, free gaps, containers and scheduled tasks; multi-day events are background", () => {
    const db = new Database(dbPath);
    try {
      const inp = buildInputs(db, { week, now, eventsPath });
      expect(inp.from).toBe(day(0));
      expect(inp.to).toBe(day(6));
      const mon = inp.days[0];
      expect(mon.awake).toEqual({ s: 390, e: 1380 });                  // 06:30–23:00 from the sleep blocks
      expect(mon.events.map((e) => e.title)).toEqual(["Morning Gym (Lifting)"]); // Hack Week is not booked time
      expect(mon.gaps).toEqual([{ s: 390, e: 420 }, { s: 510, e: 1380 }]); // half an hour before the gym, then the day is free
      const tue = inp.days[1];
      expect(tue.containers[0]).toMatchObject({ title: "Corner Market", area: "corner-market", general: false, minutes: 120 });
      const fri = inp.days[4];
      expect(fri.scheduled.length).toBe(1);
      expect(inp.tasks.length).toBe(6);
      expect(inp.projects).toEqual([{ key: "t:pulse chat", name: "Pulse Chat", area: "northwind", deadline: null, taskIds: expect.any(Array) }]);
      expect(inp.history.median.northwind).toBe(90);
      expect(inp.history.overrun.northwind.n).toBe(6);
      expect(inp.history.overrun.northwind.mu).toBeGreaterThan(0);        // 90 real minutes against 60 planned
      expect(inp.history.blocks["morning gym"]).toMatchObject({ basis: "history", misses: 4 });
      expect(inp.history.blocks["morning gym"].p).toBeLessThan(0.95);
      expect(inp.hash).toMatch(/^[0-9a-f]{16}$/);
    } finally { db.close(); }
  });
});

describe("simulation", () => {
  test("is deterministic for a seed, hopeless work gets low odds and small work high", () => {
    const db = new Database(dbPath);
    try {
      const inp = buildInputs(db, { week, now, eventsPath });
      const a = simulate(inp, { draws: 400, seed: 7 }), b = simulate(inp, { draws: 400, seed: 7 });
      expect(a).toEqual(b);
      const byTitle = (s: string) => a.tasks.find((t) => t.title.startsWith(s))!;
      expect(byTitle("Rewrite the whole ERP").probability).toBeLessThan(0.1);
      expect(byTitle("Call Dad").probability).toBeGreaterThan(0.9);
      expect(byTitle("Read the design book").due).toBeNull();
      expect(a.projects[0]).toMatchObject({ name: "Pulse Chat", tasks: 2, due: day(3) });
      expect(a.projects[0].probability).toBeGreaterThanOrEqual(0);
      const wed = a.days[2];
      expect(wed.load).toBeGreaterThan(50);                              // nine hours of classes
      expect(a.days[0].load).toBeGreaterThan(100);                       // thirty hours due on Monday
      expect(a.blocks.find((x) => x.key === "morning gym")).toMatchObject({ days: ["Mon", "Tue", "Wed", "Thu", "Fri"], basis: "history" });
      expect(headline(inp, a)).toMatch(/^Pulse Chat ships Thu: \d+%\. \w{3} is \d+% booked\./);
      // Dropping the impossible task frees Monday for everything else, so it ranks as a change.
      const changes = rankChanges(inp, a, { draws: 150, seed: 7 });
      expect(changes.length).toBeGreaterThan(0);
      expect(changes.length).toBeLessThanOrEqual(3);
      expect(changes.some((c) => c.kind === "drop" && c.title.startsWith("Rewrite"))).toBe(true);
      for (const c of changes) { expect(c.delta).toBeGreaterThan(0); expect(c.line).toMatch(/\d+% → \d+%\.$/); expect(c.proposal.taskId).toMatch(/^t\d+$/); }
    } finally { db.close(); }
  });
});

describe("agentos weather", () => {
  test("run stores a forecast the bare command reads back; --if-changed skips a second identical run", () => {
    const r = json("weather", "run", "--week", "this", "--draws", "200");
    expect(r.ok).toBe(true);
    expect(r.headline).toContain("%");
    const f = json("weather", "--week", "this");
    expect(f.id).toBe(r.run);
    expect(f.tasks.length).toBeGreaterThan(0);
    expect(f.days.length).toBe(7);
    expect(f.summary.draws).toBe(200);
    expect(f.summary.changes.length).toBeLessThanOrEqual(3);
    const again = json("weather", "run", "--week", "this", "--if-changed");
    expect(again).toMatchObject({ ok: true, skipped: true, run: r.run });
    expect(json("weather", "--week", "next").run).toBeNull();
    expect(cli("weather", "run", "--week", "prev", "--json").code).toBe(2); // that week is over
    expect(cli("weather", "inputs").code).toBe(0);
  }, SLOW);
});

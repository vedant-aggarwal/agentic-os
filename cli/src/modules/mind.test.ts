// Mind on a throwaway DB: the tables, apps from PC samples (browsers split by site), the rollup, kinds with and
// without the check-in, the blocks and first guesses, the streak, reading sessions, the Skool import, park/unpark,
// and the CLI path once.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addBook, appByName, appInfo, appOfSample, blocksFor, checkinId, dayApps, daySummary, fileCheckin, getDoc, importCourses, kindsOf, lessonDone,
  listDocs, logReading, migrate, putDoc, rollup, setCourse, splitMinutes, streak, usual,
} from "./mind";

const dir = mkdtempSync(join(tmpdir(), "agentos-mind-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
const env = { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") };
const cli = (...args: string[]) => { const r = Bun.spawnSync(["bun", CLI, ...args, "--json"], { env }); return { text: r.stdout.toString(), err: r.stderr.toString(), code: r.exitCode }; };
const DATE = "2026-10-21";
const at = (hhmm: string, d = DATE) => new Date(`${d}T${hhmm}:00+05:30`).toISOString();
let db: Database;

beforeAll(() => {
  expect(cli("mods").code).toBe(0);   // core schema plus every module's tables, mind's included
  db = new Database(dbPath);
  migrate(db); migrate(db);            // idempotent
  const ins = db.prepare("INSERT INTO ribbon_samples (at, title, process, seconds) VALUES (?, ?, ?, 30)");
  for (let i = 0; i < 40; i++) ins.run(at(`09:${String(Math.floor(i / 2)).padStart(2, "0")}`).replace(":00.000Z", `:${i % 2 ? "30" : "00"}.000Z`), "Claude Code tutorial - YouTube - Google Chrome", "chrome");
  for (let i = 0; i < 24; i++) ins.run(at(`14:${String(Math.floor(i / 2)).padStart(2, "0")}`).replace(":00.000Z", `:${i % 2 ? "30" : "00"}.000Z`), "Lofi playlist - YouTube - Google Chrome", "chrome");
  for (let i = 0; i < 60; i++) ins.run(at(`10:${String(Math.floor(i / 2)).padStart(2, "0")}`).replace(":00.000Z", `:${i % 2 ? "30" : "00"}.000Z`), "agentos - Terminal", "WindowsTerminal");
  for (let i = 0; i < 10; i++) ins.run(at(`11:${String(i).padStart(2, "0")}`), "", "idle");
});
afterAll(() => { db.close(); try { rmSync(dir, { recursive: true, force: true }); } catch {} });

describe("apps", () => {
  test("a browser window is the site in its title; the system is not an app", () => {
    expect(appOfSample("chrome", "Reels • Instagram - Google Chrome")).toBe("instagram");
    expect(appOfSample("chrome", "Some shop - Google Chrome")).toBe("chrome");
    expect(appOfSample("WindowsTerminal", "x")).toBe("windowsterminal");
    expect(appOfSample("idle", "")).toBeNull();
    expect(appOfSample("ShellHost", "")).toBeNull();
    expect(appOfSample("arc", "Reels • Instagram")).toBe("instagram");
    expect(appInfo("youtube").ask).toBe(true);
    expect(appInfo("windowsterminal").kind).toBe("work");
    expect(appInfo("youtube", { kind: "learning", ask: false }).kind).toBe("learning");
    expect(appByName("insta")).toBe("instagram");
    expect(appByName("YouTube")).toBe("youtube");
  });
  test("split minutes keeps the total", () => {
    const s = splitMinutes([["a", 3], ["b", 1]], 48);
    expect(s.reduce((x, [, m]) => x + m, 0)).toBe(48);
    expect(s[0][0]).toBe("a");
    expect(splitMinutes([], 10)).toEqual([]);
  });
});

describe("the day", () => {
  test("rollup writes one row per app and hour, and again is a no-op", () => {
    const r = rollup(db, DATE);
    expect(r.rows).toBe(3);   // youtube 09, youtube 14, terminal 10
    expect(r.written).toBe(3);
    expect(rollup(db, DATE).written).toBe(0);
    const yt = listDocs(db, "mind_screen", "date = ? AND app = 'youtube'", DATE);
    expect(yt.map((x) => x.minutes).sort()).toEqual([12, 20]);
  });
  test("apps with hours, visits and titles; manual entries join", () => {
    putDoc(db, "mind_screen", { id: "m1", date: DATE, hour: 20, app: "instagram", minutes: 25, source: "manual" });
    const apps = dayApps(db, DATE);
    const yt = apps.find((a) => a.id === "youtube")!;
    expect(yt.minutes).toBe(32);
    expect(yt.sessions.length).toBe(2);
    expect(yt.titles[0][0]).toContain("Claude Code tutorial");
    expect(apps.find((a) => a.id === "instagram")!.source).toBe("manual");
    expect(apps.find((a) => a.id === "windowsterminal")!.minutes).toBe(30);
  });
  test("blocks ask about what she can't sort, with a guess from the titles", () => {
    const blocks = blocksFor(dayApps(db, DATE));
    expect(blocks.map((b) => b.app)).toEqual(["youtube", "instagram"]);
    const yt = blocks[0];
    expect(yt.guess.map(([l]) => l)).toEqual(["learn", "music"]);
    expect(yt.guess.reduce((s, [, m]) => s + m, 0)).toBe(32);
    expect(yt.why).toContain("Claude Code tutorial");
  });
  test("private titles count as time but are never quoted", () => {
    const ins = db.prepare("INSERT INTO ribbon_samples (at, title, process, seconds) VALUES (?, ?, ?, 30)");
    for (let i = 0; i < 24; i++) ins.run(new Date(Date.parse(at("16:00")) + i * 30000).toISOString(), "Net banking - SBI - Google Chrome", "chrome");
    const apps = dayApps(db, DATE);
    const c = apps.find((a) => a.id === "chrome")!;
    expect(c.minutes).toBe(12);
    expect(c.titles.length).toBe(0);
    const b = blocksFor(apps).find((x) => x.app === "chrome")!;
    expect(b.why).toContain("private");
    expect(b.why).not.toContain("SBI");
    db.query("DELETE FROM ribbon_samples WHERE process = 'chrome' AND title LIKE 'Net banking%'").run();
  });
  test("the agent's guess wins over the rules when it uses real labels", () => {
    const blocks = blocksFor(dayApps(db, DATE), { guess: { youtube: { split: [["fun", 1]], why: "Mostly music videos.", by: "wyn" }, instagram: { split: [["nope", 1]] } } });
    expect(blocks[0].guess).toEqual([["fun", 32]]);
    expect(blocks[0].by).toBe("wyn");
    expect(blocks[1].by).toBe("rules");
  });
  test("kinds before and after the check-in; filing it; the streak", () => {
    const apps = dayApps(db, DATE);
    expect(kindsOf(apps).entertainment).toBe(32);
    const ci = fileCheckin(db, DATE, { youtube: [["learn", 20], ["music", 12]], instagram: [["research", 25]], bogus: [["x", 3]] }, { source: "agent" });
    expect(ci.answers.bogus).toBeUndefined();
    expect(ci.before.entertainment).toBe(32);
    const after = kindsOf(apps, ci.answers);
    expect(after.learning).toBe(20);
    expect(after.work).toBe(55);
    putDoc(db, "mind_checkins", { id: checkinId("2026-10-20"), date: "2026-10-20", at: at("21:30", "2026-10-20"), answers: {} });
    const done = new Set(listDocs(db, "mind_checkins").filter((d) => d.at).map((d) => d.date));
    expect(streak(done, DATE)).toBe(2);
    expect(streak(done, "2026-10-22")).toBe(2);   // tonight still open: yesterday's run counts
    expect(daySummary(db, DATE).checkin.answered).toBe(true);
  });
  test("the usual day averages the days that have data", () => {
    const u = usual(db, "2026-10-28");
    expect(u.days).toBe(1);
    expect(u.hours[9]).toBe(20);
  });
});

describe("reading", () => {
  test("add a book once; a session moves its page and starts it", () => {
    const { book } = addBook(db, { title: "Atomic Habits", author: "James Clear", pages: 320 });
    expect(addBook(db, { title: "atomic habits" }).already).toBe(true);
    const r = logReading(db, { book: "atomic", minutes: 30, pages: 18, date: DATE });
    expect(r.book.page).toBe(18);
    expect(r.book.status).toBe("reading");
    expect(r.session.from_page).toBe(0);
    const r2 = logReading(db, { book: book.id, to: 400, date: DATE });
    expect(r2.book.page).toBe(320);
    expect(r2.book.status).toBe("done");
    expect(logReading(db, { book: "A New One", minutes: 10 }).book.title).toBe("A New One");
  });
});

describe("courses", () => {
  test("import Skool lessons: grouped by module, one course in progress, a re-import keeps his progress", () => {
    const src = join(dir, "src"); mkdirSync(src);
    writeFileSync(join(src, "learn-ai.json"), JSON.stringify({ importedAt: "2026-10-16", lessons: [
      { id: "a1", title: "1. 🔥 Intro", course: "Make Money", module: "📈 30 Day Roadmap", duration: "0:51" },
      { id: "a2", title: "2. Foundations", course: "Make Money", module: "📈 30 Day Roadmap", duration: "4:02", rank: 2, why: "Because.", practice: "Do it." },
      { id: "b1", title: "Market", course: "Make Money", module: "💰 6 Figure Blueprint", duration: "7:53", rank: 1 },
      { id: "v1", title: "Some recording", course: "Vault", module: "👾 Claude", duration: "30:00" },
    ] }));
    const r = importCourses(db, { dir: src });
    expect(r.courses).toBe(3);
    expect(r.lessons).toBe(4);
    const cs = listDocs(db, "mind_courses");
    const road = cs.find((c) => c.title === "30 Day Roadmap")!;
    expect(road.status).toBe("parked");
    expect(cs.find((c) => c.title === "6 Figure Blueprint")!.status).toBe("active");
    expect(cs.find((c) => c.part === "Vault")!.kind).toBe("library");
    expect(getDoc(db, "mind_lessons", "l.a1")!.title).toBe("Intro");
    expect(getDoc(db, "mind_lessons", "l.a1")!.why).toBeNull();
    setCourse(db, "roadmap", "active");
    const d = lessonDone(db, "a1", { date: DATE });
    expect(d.lesson.status).toBe("done");
    expect(d.session.minutes).toBe(1);
    importCourses(db, { dir: src });
    expect(getDoc(db, "mind_lessons", "l.a1")!.status).toBe("done");
    expect(getDoc(db, "mind_courses", road.id)!.status).toBe("active");
  });
});

describe("cli", () => {
  test("agentos mind and its verbs answer JSON", () => {
    const day = cli("mind", "--date", DATE);
    expect(day.code).toBe(0);
    expect(JSON.parse(day.text).screen.minutes).toBeGreaterThan(0);
    const add = cli("mind", "book", "add", "Deep Work", "--pages", "296");
    expect(JSON.parse(add.text).book.pages).toBe(296);
    expect(cli("mind", "read", "Deep Work", "--minutes", "nope").code).toBe(2);
    expect(cli("mind", "wat").code).toBe(2);
  });
});

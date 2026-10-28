// Reality ribbon on a throwaway DB: the tables, a day's summary from samples, manual and learned rules
// (kept rules re-tag today's untagged samples), the redaction list, and the CLI path once.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRule, dayBounds, redactList, ribbon, ruleMatches, summarize } from "./ribbon";
import type { Args, ModCtx } from "./types";

const dir = mkdtempSync(join(tmpdir(), "agentos-ribbon-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
const env = { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") };
const cli = (...args: string[]) => {
  const r = Bun.spawnSync(["bun", CLI, ...args], { env });
  return { text: r.stdout.toString(), code: r.exitCode };
};
const SLOW = 60_000;
const DATE = "2026-10-18";
const at = (hhmm: string) => new Date(`${DATE}T${hhmm}:00+05:30`).toISOString();
class UserError extends Error {}
let db: Database;
let last: any = null;
const args = (...pos: string[]): Args => ({ _: ["ribbon", ...pos], flags: {} });
const ctx = (flags: Record<string, string | boolean> = {}): ModCtx & { a: (...p: string[]) => Args } => ({
  out: (d) => { last = d; }, jsonOut: true, str: (a, k) => (typeof a.flags[k] === "string" ? (a.flags[k] as string) : undefined),
  istDate: () => DATE, now: () => new Date(at("15:00")), iso: () => at("15:00"), UserError, dbPath, contentDbPath: join(dir, "content.db"),
  a: (...p) => ({ _: ["ribbon", ...p], flags }),
});

beforeAll(() => {
  expect(cli("mods").code).toBe(0); // core schema plus every module's tables
  db = new Database(dbPath);
  db.exec("INSERT INTO projects (slug, name, area, status, created_at) VALUES ('pulsechat', 'Pulse Chat', 'northwind', 'active', 'x'), ('atlas', 'Atlas ERP', 'projects', 'active', 'x')");
  db.exec(`INSERT INTO tasks (title, area, project, status, priority, owner, source, created_at, updated_at, list_id, position)
    VALUES ('Pulse Chat: fix the retry', 'northwind', 'pulsechat', 'todo', 2, 'me', 'cli', 'x', 'x', 1, 1)`);
  const ins = db.prepare("INSERT INTO ribbon_samples (at, title, process, repo, session_id, area, project, task_id, seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 30)");
  for (let i = 0; i < 20; i++) ins.run(at(`09:${String(i * 2).padStart(2, "0")}`), "pulsechat - Visual Studio Code", "Code", "D:\\code\\pulsechat", null, "northwind", "pulsechat", i >= 10 ? 1 : null);
  for (let i = 0; i < 8; i++) ins.run(at(`10:${String(i * 2).padStart(2, "0")}`), "Reel edit - CapCut", "CapCut", null, null, null, null, null);
  for (let i = 0; i < 4; i++) ins.run(at(`11:${String(i * 2).padStart(2, "0")}`), "[redacted]", "chrome", null, null, null, null, null);
  for (let i = 0; i < 6; i++) ins.run(at(`12:${String(i * 2).padStart(2, "0")}`), "", "idle", null, null, null, null, null);
});
afterAll(() => { db?.close(); try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may still hold the WAL for a moment */ } });

describe("ribbon", () => {
  test("owns three tables with the ribbon_ prefix", () => {
    const names = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'ribbon_%' ORDER BY name").all() as any[]).map((r) => r.name);
    expect(names).toEqual(["ribbon_days", "ribbon_rules", "ribbon_samples"]);
    ribbon.migrate(db); // idempotent
    expect((db.query("PRAGMA user_version").get() as any).user_version).toBe(7);
  });

  test("dayBounds covers one IST date", () => {
    const b = dayBounds(DATE);
    expect(b.from).toBe("2026-10-17T18:30:00.000Z");
    expect(b.to).toBe("2026-10-18T18:30:00.000Z");
    expect(() => dayBounds("18-10")).toThrow();
  });

  test("summarize counts minutes per area, project and hour, and the auto-started task", () => {
    const s = summarize(db, DATE);
    expect(s.samples).toBe(38);
    expect(s.minutes).toBe(16); // away time is not watched time
    expect(s.away).toBe(3);
    expect(s.untagged).toBe(6);
    expect(s.areas).toEqual([{ area: "northwind", name: "Northwind", minutes: 10 }]);
    expect(s.projects).toEqual([{ project: "pulsechat", name: "Pulse Chat", minutes: 10 }]);
    expect(s.unknown).toEqual([{ title: "Reel edit - CapCut", process: "CapCut", minutes: 4 }]); // [redacted] never shows up
    expect(s.actualHours).toEqual([{ h: 9, area: "northwind", minutes: 10 }, { h: 10, area: null, minutes: 4 }, { h: 11, area: null, minutes: 2 }]);
    expect(s.starts).toEqual([{ task: "t1", title: "Pulse Chat: fix the retry", project: "pulsechat", status: "todo", at: at("09:20"), source: "ribbon" }]);
  });

  test("agentos ribbon prints the day; a kept rule re-tags today's untagged samples", () => {
    const c = ctx();
    ribbon.run(db, args(), c);
    expect(last.watched).toBe("16m");
    expect(last.away).toBe("3m");
    expect(last.summary).toBe("10m on Pulse Chat, 6m untagged");
    expect(last.started[0].task).toBe("t1");
    // a manual rule: regex on the title, area from the flag
    ribbon.run(db, ctx({ area: "content" }).a("rule", "capcut|reel"), ctx({ area: "content" }));
    expect(last.ok).toBe(true);
    expect(last.rule).toMatchObject({ pattern: "capcut|reel", area: "content", project: null, source: "manual", status: "kept" });
    expect(last.applied).toBe(8);
    const s = summarize(db, DATE);
    expect(s.untagged).toBe(2);
    expect(s.areas.map((a) => a.area)).toEqual(["northwind", "content"]);
    // the same pattern again updates instead of duplicating
    ribbon.run(db, ctx({ area: "content" }).a("rule", "capcut|reel"), ctx({ area: "content" }));
    expect(last.already).toBe(true);
    expect((db.query("SELECT count(*) n FROM ribbon_rules").get() as any).n).toBe(1);
  });

  test("rule validation: bad regex, unknown area, project without area", () => {
    expect(() => ribbon.run(db, ctx({ area: "content" }).a("rule", "(["), ctx({ area: "content" }))).toThrow(/regular expression/);
    expect(() => ribbon.run(db, ctx({ area: "nope" }).a("rule", "x"), ctx({ area: "nope" }))).toThrow(/No area/);
    const c = ctx({ project: "atlas" });
    ribbon.run(db, c.a("rule", "atlas"), c); // area comes from the project
    expect(last.rule).toMatchObject({ area: "projects", project: "atlas" });
  });

  test("learned rules stay pencilled until kept; drop removes them", () => {
    db.query("INSERT INTO ribbon_rules (pattern, area, project, source, status, why, created_at) VALUES ('chrome', 'personal', NULL, 'learned', 'open', 'browsing', ?)").run(at("12:00"));
    const id = (db.query("SELECT id FROM ribbon_rules WHERE source = 'learned'").get() as any).id;
    const c = ctx();
    ribbon.run(db, args("rules"), c);
    expect(last.pencilled).toBe(1);
    expect(last.rules[0]).toMatchObject({ id: `r${id}`, status: "open", source: "learned" });
    expect(ruleMatches({ pattern: "chrome" }, "[redacted]", "chrome")).toBe(true); // process name counts too
    ribbon.run(db, args("rules", "keep", `r${id}`), c);
    expect(last.rule.status).toBe("kept");
    expect(last.applied).toBe(4);
    expect(summarize(db, DATE).untagged).toBe(0);
    ribbon.run(db, args("rules", "drop", `r${id}`), c);
    expect(last.rule.status).toBe("removed");
    ribbon.run(db, args("rules"), c);
    expect(last.rules.some((r: any) => r.id === `r${id}`)).toBe(false);
    expect(applyRule(db, { id, pattern: "chrome", area: "personal", project: null, source: "learned", status: "kept", why: null }, DATE)).toBe(0);
    expect(() => ribbon.run(db, args("rules", "keep", "r999"), c)).toThrow(/No rule/);
  });

  test("redact keeps a regex list in settings", () => {
    const c = ctx();
    ribbon.run(db, args("redact"), c);
    expect(last.redact).toEqual([]);
    ribbon.run(db, args("redact", "bank|password"), c);
    expect(last.redact).toEqual(["bank|password"]);
    ribbon.run(db, args("redact", "bank|password"), c); // no duplicates
    expect(redactList(db)).toEqual(["bank|password"]);
    expect(() => ribbon.run(db, args("redact", "(["), c)).toThrow(/regular expression/);
  });

  test("the CLI path: agentos ribbon --json on an empty day, and the help line", () => {
    const r = JSON.parse(cli("ribbon", "--date", "2026-01-01", "--json").text);
    expect(r.samples).toBe(0);
    expect(r.note).toMatch(/No samples/);
    expect(cli("help").text).toContain("agentos ribbon");
    expect(cli("ribbon", "nope", "--json").code).toBe(2);
  }, SLOW);
});

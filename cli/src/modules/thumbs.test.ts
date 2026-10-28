// Thumbs on a throwaway DB: taps per screen, hesitation medians, dead screens, rejected proposal kinds, and the proposals list.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shapeProposal, summarize, thumbs } from "./thumbs";
import type { Args, ModCtx } from "./types";

const dir = mkdtempSync(join(tmpdir(), "agentos-thumbs-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
const env = { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") };
const cli = (...args: string[]) => { const r = Bun.spawnSync(["bun", CLI, ...args], { env }); return { text: r.stdout.toString(), code: r.exitCode }; };
const NOW = new Date("2026-10-18T09:30:00Z");
const ago = (days: number, h = 0) => new Date(NOW.getTime() - days * 864e5 - h * 3600e3).toISOString();
class UserError extends Error {}
let db: Database;
let last: any = null;
const ctx = (flags: Record<string, string | boolean> = {}): ModCtx => ({
  out: (d) => { last = d; }, jsonOut: true, str: (a, k) => (typeof a.flags[k] === "string" ? (a.flags[k] as string) : undefined),
  istDate: () => "2026-10-18", now: () => NOW, iso: () => NOW.toISOString(), UserError, dbPath, contentDbPath: join(dir, "content.db"),
});
const args = (flags: Record<string, string | boolean>, ...pos: string[]): Args => ({ _: ["thumbs", ...pos], flags });

beforeAll(() => {
  expect(cli("mods").code).toBe(0);
  db = new Database(dbPath);
  const ins = db.prepare("INSERT INTO thumbs_events (at, tab, target, hesitation_ms, user_id) VALUES (?, ?, ?, ?, 1)");
  // today: busy, hesitation 400..1200; tasks: lighter; a module page under more; one old event outside the window
  for (let i = 0; i < 10; i++) ins.run(ago(i % 5), "today", i % 2 ? "tab:tasks" : "btn:Score today", 400 + i * 80);
  for (let i = 0; i < 4; i++) ins.run(ago(1, i), "tasks", "chip:Today", i === 0 ? 3000 : null);
  ins.run(ago(2), "more/ping", "btn:Echo a message", 900);
  ins.run(ago(60), "goals", "card:goal", 100);
  db.exec(`INSERT INTO ai_batches (kind, date, summary, model, ms, created_at) VALUES ('plan', '2026-10-10', 's', 'Sonnet', 1, '${ago(8)}')`);
  const b = (db.query("SELECT id FROM ai_batches").get() as any).id;
  const p = db.prepare("INSERT INTO ai_proposals (batch_id, kind, task_id, payload, reason, status, created_at, decided_at) VALUES (?, ?, NULL, '{}', '', ?, ?, ?)");
  p.run(b, "place", "removed", ago(8), ago(8)); p.run(b, "place", "removed", ago(8), ago(8)); p.run(b, "new", "kept", ago(8), ago(8));
  db.query("INSERT INTO thumbs_proposals (month, title, reason, numbers, mockup_path, status, created_at) VALUES ('2026-10', 'Bigger check targets', 'why', ?, 'C:/m/1.html', 'open', ?)")
    .run(JSON.stringify(["10 taps on today"]), ago(1));
  db.query("INSERT INTO thumbs_proposals (month, title, reason, numbers, mockup_path, status, task_id, created_at, decided_at) VALUES ('2026-09', 'Old one', 'why', '[]', NULL, 'accepted', 7, ?, ?)")
    .run(ago(40), ago(39));
});
afterAll(() => { db?.close(); try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may still hold the WAL for a moment */ } });

describe("thumbs", () => {
  test("owns its tables and leaves user_version alone", () => {
    const names = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'thumbs_%' ORDER BY name").all() as any[]).map((r) => r.name);
    expect(names).toEqual(["thumbs_events", "thumbs_proposals"]);
    thumbs.migrate(db);
    expect((db.query("PRAGMA user_version").get() as any).user_version).toBe(7);
  });

  test("summarize: taps per screen, medians, dead screens, rejected kinds", () => {
    const s = summarize(db, 30, NOW);
    expect(s.events).toBe(15);
    expect(s.activeDays).toBe(5);
    expect(s.screens[0]).toMatchObject({ tab: "today", taps: 10, days: 5, hesitation_ms: 760, opens: 10 });
    expect(s.screens[0].top).toContain("tab:tasks ×5");
    expect(s.screens.find((x) => x.tab === "tasks")).toMatchObject({ taps: 4, hesitation_ms: 3000, opens: 1 });
    expect(s.dead.sort()).toEqual(["areas", "goals", "life", "more"]); // goals was used 60 days ago: known, but dead this month
    expect(s.hesitation[0]).toEqual({ tab: "today", hesitation_ms: 760, opens: 10 }); // tasks has too few opens to count
    expect(s.rejected).toEqual([{ kind: "place", removed: 2, kept: 0 }, { kind: "new", removed: 0, kept: 1 }]);
    expect(s.proposals).toEqual({ accepted: 1, open: 1 });
    expect(s.targets[0]).toEqual({ target: "today btn:Score today", taps: 5 }); // ties keep first-seen order
  });

  test("agentos thumbs and thumbs proposals through run()", () => {
    thumbs.run(db, args({}), ctx());
    expect(last.events).toBe(15);
    thumbs.run(db, args({ days: "1" }), ctx());
    expect(last.events).toBe(5); // two at NOW, two exactly 24 h ago, one tasks tap exactly 24 h ago (the window is inclusive)
    expect(() => thumbs.run(db, args({ days: "0" }), ctx())).toThrow(/--days/);
    thumbs.run(db, args({}, "proposals"), ctx());
    expect(last.count).toBe(1);
    expect(last.proposals[0]).toMatchObject({ month: "2026-10", title: "Bigger check targets", numbers: ["10 taps on today"], mockup: "C:/m/1.html", status: "open", task: null });
    thumbs.run(db, args({ all: true }, "proposals"), ctx());
    expect(last.count).toBe(2);
    expect(last.proposals[1]).toMatchObject({ status: "accepted", task: "t7" });
    expect(shapeProposal({ id: 3, month: "m", title: "t", numbers: "not json", status: "open", created_at: "c" }).numbers).toEqual([]);
  });

  test("the CLI path and the help line", () => {
    const r = JSON.parse(cli("thumbs", "--json").text);
    expect(r.events).toBe(15);
    expect(cli("help").text).toContain("agentos thumbs");
    expect(cli("thumbs", "nope", "--json").code).toBe(2);
  }, 60_000);
});

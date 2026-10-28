// agentos scan: the table matches the phone server's collection (the server writes, the CLI reads it back).
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { scan, DDL } from "./scan";

function ctx(out: any[]) {
  return {
    out: (d: any) => out.push(d), jsonOut: true, str: (a: any, k: string) => (typeof a.flags[k] === "string" ? a.flags[k] : undefined),
    istDate: () => "2026-10-22", now: () => new Date(), iso: () => new Date().toISOString(),
    UserError: class extends Error {}, dbPath: ":memory:", contentDbPath: ":memory:",
  } as any;
}
function seed() {
  const db = new Database(":memory:");
  scan.migrate(db); scan.migrate(db);   // idempotent
  const put = (id: string, kind: string, status: string, source: string, data: any, at: string) =>
    db.query("INSERT INTO scan_items (id, data, created_at, updated_at, rev, kind, status, source, app) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)").run(id, JSON.stringify(data), at, at, kind, status, source, data.filed?.app ?? null);
  put("scan_1", "receipt", "filed", "camera", { title: "Haldiram's · ₹486", fields: { total: 486 }, filed: { app: "money", where: "Money · Food & drinks", by: "you" } }, "2026-10-22T08:00:00.000Z");
  put("sh_1", "reel", "ready", "share", { title: "Scarf styling" }, "2026-10-22T09:00:00.000Z");
  put("say_1", "say", "filed", "voice", { text: "Spent 120 on samosas", results: [{ ok: true, where: "Money" }, { ok: true, where: "Tasks · Tomorrow 18:00", undone: true }] }, "2026-10-22T10:00:00.000Z");
  return db;
}

test("list: newest first, where each went, filters", () => {
  const db = seed(); const out: any[] = [];
  scan.run(db, { _: ["scan"], flags: {} }, ctx(out));
  expect(out[0].scans.map((s: any) => s.id)).toEqual(["say_1", "sh_1", "scan_1"]);
  expect(out[0].scans[0].where).toBe("Money");
  expect(out[0].scans[2]).toMatchObject({ kind: "receipt", where: "Money · Food & drinks", by: "you" });
  scan.run(db, { _: ["scan", "list"], flags: { status: "ready", source: "share" } }, ctx(out));
  expect(out[1].scans.map((s: any) => s.id)).toEqual(["sh_1"]);
});

test("show: one scan with its fields; unknown ids are a usage error", () => {
  const db = seed(); const out: any[] = [];
  scan.run(db, { _: ["scan", "show", "scan_1"], flags: {} }, ctx(out));
  expect(out[0].scan).toMatchObject({ id: "scan_1", fields: { total: 486 }, filed: { app: "money" } });
  expect(() => scan.run(db, { _: ["scan", "show", "nope"], flags: {} }, ctx(out))).toThrow("No scan nope");
  expect(DDL).toContain("scan_items_rev");
});

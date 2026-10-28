// Money on a throwaway DB: the ten collection-shaped tables, the verbs (add, list, rm, budget, account), the daily
// allowance the overview gives, and the CLI path once (agentos money --json migrates and answers).
import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";

// the fixtures are written for this day; pin the clock so 'today' doesn't drift
beforeAll(() => { setSystemTime(new Date("2026-10-22T12:00:00+05:30")); });
afterAll(() => { setSystemTime(); });
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TABLES, getDoc, money, overview, putDoc } from "./money";
import type { Args, ModCtx } from "./types";

const dir = mkdtempSync(join(tmpdir(), "agentos-money-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
const env = { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") };
const DATE = "2026-10-22";
const NOW = "2026-10-22T12:10:00.000Z"; // 17:40 IST
class UserError extends Error {}
let db: Database;
let last: any = null;
const ctx: ModCtx = {
  out: (d) => { last = d; }, jsonOut: true, str: (a, k) => (typeof a.flags[k] === "string" ? (a.flags[k] as string) : undefined),
  istDate: () => DATE, now: () => new Date(NOW), iso: () => new Date().toISOString(), UserError, dbPath, contentDbPath: join(dir, "content.db"),
};
const run = (pos: string[], flags: Record<string, string | boolean> = {}) => { money.run(db, { _: ["money", ...pos], flags } as Args, ctx); return last; };

beforeAll(() => {
  const r = Bun.spawnSync(["bun", CLI, "money", "--json"], { env });
  expect(r.exitCode).toBe(0);
  const out = JSON.parse(r.stdout.toString());
  expect(out.budgeted).toBe(false);
  db = new Database(dbPath);
});
afterAll(() => { db?.close(); try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may hold the WAL */ } });

describe("money", () => {
  test("owns ten collection-shaped tables with the money_ prefix, idempotently", () => {
    const names = (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'money_%' ORDER BY name").all() as any[]).map((r) => r.name);
    expect(names).toEqual(Object.keys(TABLES).sort());
    money.migrate(db);
    const cols = (db.query("PRAGMA table_info(money_transactions)").all() as any[]).map((c) => c.name);
    for (const c of ["id", "data", "created_at", "updated_at", "deleted_at", "rev", "amount", "category", "at", "source"]) expect(cols).toContain(c);
  });

  test("add writes a collection doc: fields in columns or data, rev rising", () => {
    const a = run(["add", "40", "Chai", "at", "City College"], { cat: "food", note: "with Kabir" }).transaction;
    expect(a).toMatchObject({ kind: "out", amount: 40, category: "food", merchant: "Chai at City College", note: "with Kabir", source: "cli" });
    const b = run(["add", "5000"], { in: true, cat: "pocket", date: "2026-10-01" }).transaction;
    expect(b.kind).toBe("in");
    expect(b.at).toBe("2026-10-01T06:30:00.000Z");
    const revs = (db.query("SELECT rev FROM money_transactions ORDER BY rev").all() as any[]).map((r) => r.rev);
    expect(revs).toEqual([1, 2]);
    expect(JSON.parse((db.query("SELECT data FROM money_transactions WHERE id = ?").get(a.id) as any).data)).toEqual({ note: "with Kabir" });
    expect(() => run(["add", "x"])).toThrow(UserError);
    expect(() => run(["add", "10"], { cat: "nope" })).toThrow(UserError);
  });

  test("budgets, then the daily allowance: what is left this month over the days left", () => {
    run(["budget", "food", "8000"], { month: "2026-10" });
    const r = run(["budget", "transport", "2000"], { month: "2026-10" });
    expect(r.total).toBe(10000);
    // spent before today: 600 on the 10th (half of a split 1,200) → (10,000 − 600) / 10 days = 940
    putDoc(db, "money_transactions", { id: "t_split", kind: "out", amount: 1200, category: "food", at: "2026-10-10T08:00:00.000Z", split: { person: "kabir", share: 600 } });
    putDoc(db, "money_transactions", { id: "t_bill", kind: "out", amount: 8900, category: "bills", at: "2026-10-03T08:00:00.000Z" });
    const o = overview(db, DATE);
    expect(o.budget).toBe(10000);
    expect(o.allowance).toBe(940);
    expect(o.spentToday).toBe(40);
    expect(o.leftToday).toBe(900);
    expect(o.income).toBe(5000);
    // next month carries October's budgets until November has its own
    expect(overview(db, "2026-11-02").budgetsFrom).toBe("2026-10");
  });

  test("rm is a soft delete the phone can see by rev", () => {
    const id = run(["add", "99", "Typo"]).transaction.id;
    const before = (db.query("SELECT max(rev) AS r FROM money_transactions").get() as any).r;
    expect(run(["rm", id])).toMatchObject({ ok: true, removed: id });
    const doc = getDoc(db, "money_transactions", id)!;
    expect(doc.deleted_at).toBeTruthy();
    expect((db.query("SELECT rev FROM money_transactions WHERE id = ?").get(id) as any).rev).toBeGreaterThan(before);
    expect(run(["rm", id]).already).toBe(true);
    expect(run(["list"]).transactions.some((t: any) => t.id === id)).toBe(false);
  });

  test("accounts keep a balance with its as-of time", () => {
    const r = run(["account", "hdfc"], { balance: "60364", name: "HDFC savings", kind: "bank" });
    expect(r.accounts).toEqual([expect.objectContaining({ id: "hdfc", name: "HDFC savings", kind: "bank", balance: 60364 })]);
    expect(getDoc(db, "money_accounts", "hdfc")!.counted).toBe(true);
    expect(() => run(["account", "hdfc"])).toThrow(UserError);
    expect(() => run(["wat"])).toThrow(UserError);
  });
});

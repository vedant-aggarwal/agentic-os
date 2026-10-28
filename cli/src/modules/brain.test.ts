// Brain on a throwaway DB: the tables, items in and out with the store contract's rules (LWW, replay, rev), the inbox
// and the agent's suggestions, filing, links and facts, search by words, person, date and place, the answer line, and
// the CLI path once.
import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";

// the fixtures are written for this day; pin the clock so 'today' doesn't drift
beforeAll(() => { setSystemTime(new Date("2026-10-22T17:40:00+05:30")); });
afterAll(() => { setSystemTime(); });
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  brain, composeAnswer, confident, fileItem, getItem, linkFrom, listItems, marksFor, normalizeItem, parsePlace, parseQuery,
  parseWhen, patched, putItem, rankItems, snippet, suggestFor, summarize, validateItem, whenOf, type Person,
} from "./brain";
import type { Args, ModCtx } from "./types";

const dir = mkdtempSync(join(tmpdir(), "agentos-brain-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
const env = { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") };
const cli = (...args: string[]) => {
  const r = Bun.spawnSync(["bun", CLI, ...args], { env });
  return { text: r.stdout.toString(), err: r.stderr.toString(), code: r.exitCode };
};
const SLOW = 60_000;
// Thu 22 Oct 2026, 17:40 IST
const NOW = Date.parse("2026-10-22T17:40:00+05:30");
const ist = (d: string, hm = "12:00") => new Date(`${d}T${hm}:00+05:30`).toISOString();
const PEOPLE: Person[] = [{ id: "dad", name: "Dad", aspect: "family" }, { id: "kabir", name: "Kabir", aspect: "friends" }, { id: "mom", name: "Mom", aspect: "family", aliases: ["Mom"] }];
class UserError extends Error {}
let db: Database;
let last: any = null;
const ctx = (): ModCtx => ({
  out: (d) => { last = d; }, jsonOut: true, str: (a, k) => (typeof a.flags[k] === "string" ? (a.flags[k] as string) : undefined),
  istDate: () => "2026-10-22", now: () => new Date(NOW), iso: () => new Date(NOW).toISOString(), UserError, dbPath, contentDbPath: join(dir, "content.db"),
});
const run = (pos: string[], flags: Record<string, string | boolean> = {}) => { brain.run(db, { _: ["brain", ...pos], flags } as Args, ctx()); return last; };

beforeAll(() => {
  expect(cli("mods").code).toBe(0); // core schema plus every module's tables
  db = new Database(dbPath);
}, SLOW);
afterAll(() => { db?.close(); try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* Windows may still hold the WAL */ } });

describe("brain tables", () => {
  test("brain_items has the store contract's shape and brain_vectors exists; migrate is idempotent", () => {
    const cols = (db.query("PRAGMA table_info(brain_items)").all() as any[]).map((c) => c.name);
    for (const c of ["id", "data", "created_at", "updated_at", "deleted_at", "rev", "kind", "aspect", "person", "status", "author", "place", "at", "links", "suggest"]) expect(cols).toContain(c);
    expect((db.query("SELECT name FROM sqlite_master WHERE name = 'brain_vectors'").get() as any)?.name).toBe("brain_vectors");
    brain.migrate(db); brain.migrate(db);
  });
});

describe("items", () => {
  test("normalize: a folder files it, no folder puts it in the inbox, a person implies their folder and a link", () => {
    const a = normalizeItem({ id: "x1", text: "Bench 50 kg × 5", aspect: "body" }, { now: ist("2026-10-22", "07:40") });
    expect(a.status).toBe("filed"); expect(a.aspect).toBe("body"); expect(a.sub).toBe("Training"); expect(a.title).toBe("Bench 50 kg × 5");
    const b = normalizeItem({ id: "x2", text: "Something to sort later" });
    expect(b.status).toBe("inbox"); expect(b.aspect).toBeNull();
    const c = normalizeItem({ id: "x3", text: "Dad wants the stock list by Sunday", person: "dad", by: "wyn" }, { people: PEOPLE });
    expect(c.status).toBe("filed"); expect(c.aspect).toBe("family"); expect(c.kind).toBe("moment"); expect(c.author).toBe("agent"); expect(c.filed_by).toBe("agent");
    expect(c.links).toEqual([{ kind: "person", id: "dad" }]);
    expect(validateItem({ aspect: "work" })).toContain("aspect is one of");
    expect(validateItem({ text: "ok", aspect: "money" })).toBeNull();
  });
  test("put: last write wins, a replay changes nothing, every write moves rev on", () => {
    const it = normalizeItem({ id: "lww", text: "First", aspect: "growth", updated_at: ist("2026-10-22", "10:00") });
    expect(putItem(db, it).written).toBe(true);
    const r1 = (db.query("SELECT rev FROM brain_items WHERE id = 'lww'").get() as any).rev;
    expect(putItem(db, it).written).toBe(false);                                       // replay
    expect(putItem(db, { ...it, text: "Older", updated_at: ist("2026-10-22", "09:00") }).written).toBe(false);
    const newer = putItem(db, patched(getItem(db, "lww")!, { text: "Second" }));
    expect(newer.written).toBe(true); expect(newer.item.text).toBe("Second");
    expect((db.query("SELECT rev FROM brain_items WHERE id = 'lww'").get() as any).rev).toBeGreaterThan(r1);
  });
});

describe("the agent's suggestion and filing", () => {
  test("words, people and the source app point to a folder; a person becomes People › name", () => {
    const s = suggestFor({ text: "Paid ₹1,200 at City Electricals on GPay for the shop lights" }, { people: PEOPLE });
    expect(s.to[0].aspect).toBe("money");
    const p = suggestFor({ text: "Dad wants the Diwali stock list by Sunday" }, { people: PEOPLE });
    expect(p.to[0]).toMatchObject({ aspect: "family", person: "dad", label: "People › Dad" });
    expect(confident(p)).toBe(true);
    const none = suggestFor({ text: "hmm" });
    expect(none.to).toEqual([]); expect(confident(none)).toBe(false);
    const sim = suggestFor({ text: "a quiet thought" }, { sims: { growth: 0.82 } });
    expect(sim.to[0].aspect).toBe("growth");
  });
  test("file takes the suggestion unless told otherwise, records who did it, and keeps the person", () => {
    const raw = normalizeItem({ id: "in1", text: "Dad wants the Diwali stock list by Sunday", source: "voice" }, { people: PEOPLE, now: ist("2026-10-22", "17:05") });
    raw.suggest = suggestFor(raw, { people: PEOPLE });
    putItem(db, raw);
    const f = fileItem(getItem(db, "in1")!, { by: "agent", now: ist("2026-10-22", "17:06") });
    expect(f).toMatchObject({ status: "filed", aspect: "family", person: "dad", filed_by: "agent" });
    expect(f.links).toContainEqual({ kind: "person", id: "dad" });
    const g = fileItem(getItem(db, "in1")!, { aspect: "money", by: "you" });
    expect(g.aspect).toBe("money"); expect(g.filed_by).toBe("you");
    expect(() => fileItem({ ...raw, suggest: null, aspect: null }, {})).toThrow("Pick a folder");
    expect(linkFrom("vault:entity/dad")).toEqual({ kind: "vault", id: "entity/dad" });
    expect(linkFrom("nonsense")).toBeNull();
  });
});

describe("time and place", () => {
  test("parseWhen knows today, yesterday, weeks, months, weekdays and dates (IST)", () => {
    expect(parseWhen("what did I save today?", NOW)).toMatchObject({ key: "today", from: ist("2026-10-22", "00:00") });
    expect(parseWhen("yesterday", NOW)?.from).toBe(ist("2026-10-21", "00:00"));
    expect(parseWhen("this week", NOW)?.from).toBe(ist("2026-10-19", "00:00"));            // Monday
    expect(parseWhen("last week", NOW)).toMatchObject({ from: ist("2026-10-12", "00:00"), to: ist("2026-10-19", "00:00") });
    expect(parseWhen("in October", NOW)).toMatchObject({ label: "October", from: ist("2026-10-01", "00:00"), to: ist("2026-11-01", "00:00") });
    expect(parseWhen("notes from december", NOW)?.from).toBe(ist("2025-12-01", "00:00")); // the latest December
    expect(parseWhen("on 18 Oct", NOW)).toMatchObject({ label: "18 Oct", from: ist("2026-10-18", "00:00") });
    expect(parseWhen("on monday", NOW)?.from).toBe(ist("2026-10-19", "00:00"));
    expect(parseWhen("last 3 days", NOW)?.from).toBe(ist("2026-10-20", "00:00"));
    expect(parseWhen("weekly review notes", NOW)).toBeNull();
    expect(parseWhen("3 things about kabir", NOW)).toBeNull();
    expect(parseWhen("Kabir Saturday", NOW)).toBeNull();                                  // a word, not a window
    expect(parseWhen("October payouts", NOW)).toBeNull();
    expect(parseQuery("Kabir Saturday", { nowMs: NOW, people: PEOPLE }).terms).toEqual(["saturday"]);
    expect(whenOf("week", NOW)?.key).toBe("week");
  });
  test("parsePlace finds the shop, home and City College by their words", () => {
    expect(parsePlace("what did I save at the shop")?.key).toBe("shop");
    expect(parsePlace("From the shop")?.key).toBe("shop");
    expect(parsePlace("notes from City College")?.key).toBe("college");
    expect(parsePlace("protein today")).toBeNull();
  });
});

describe("search", () => {
  beforeAll(() => {
    const add = (o: any) => putItem(db, normalizeItem(o, { people: PEOPLE }));
    add({ id: "s1", text: "Your last four meetups were Saturday evenings.", title: "Kabir eats out on Saturdays", person: "kabir", by: "wyn", at: ist("2026-10-22", "15:00"), place: "Midtown" });
    add({ id: "s2", text: "Corner Market listings at the shop with Dad, 15:00 to 16:15.", person: "dad", at: ist("2026-10-22", "15:00"), place: "Morgan & Co.", by: "wyn" });
    add({ id: "s3", text: "Problems 1 to 12 from sheet 4, due Thursday 29 October.", title: "Stats: sheet 4 due next Thursday", aspect: "mind", at: ist("2026-10-22", "12:40"), place: "City College, Room 14" });
    add({ id: "s4", text: "Budget rules: ₹1,500 a day. Food and chai under ₹500.", aspect: "money", at: ist("2026-10-01", "21:00") });
    add({ id: "s5", text: "The pull is strongest between 18:00 and 19:00.", aspect: "soul", at: ist("2026-10-21", "21:30") });
    add({ id: "s6", text: "Protein 62 of 120 g", aspect: "body", at: ist("2026-10-22", "17:38"), by: "wyn" });
  });
  const items = () => listItems(db);
  test("a person narrows to what's about them, with an answer that names the count and the latest", () => {
    const p = parseQuery("What did I save about Kabir?", { nowMs: NOW, people: PEOPLE });
    expect(p.person?.id).toBe("kabir"); expect(p.terms).toEqual([]);
    const hits = rankItems(items(), p);
    expect(hits.map((h) => h.item.id)).toEqual(["s1"]);
    expect(composeAnswer(p, hits, { nowMs: NOW }).text).toBe("1 thing about Kabir; Wyn filed it. It is “Kabir eats out on Saturdays” (today 15:00, Friends).");
  });
  test("by date and by place; private folders stay out", () => {
    const today = rankItems(items(), parseQuery("what did I save today", { nowMs: NOW, people: PEOPLE }));
    expect(today.map((h) => h.item.id).sort()).toEqual(["in1", "lww", "s1", "s2", "s3", "s6"].filter((id) => today.some((h) => h.item.id === id)).sort());
    expect(today.some((h) => h.item.id === "s4")).toBe(false);
    const shop = rankItems(items(), parseQuery("From the shop", { nowMs: NOW, people: PEOPLE }));
    expect(shop.map((h) => h.item.id)).toEqual(["s2"]);
    const soul = rankItems(items(), parseQuery("pull strongest", { nowMs: NOW }));
    expect(soul).toEqual([]);
    expect(rankItems(items(), parseQuery("pull strongest", { nowMs: NOW }), { hidePrivate: false }).map((h) => h.item.id)).toEqual(["s5"]);
  });
  test("words rank title hits first and come back with marks; meaning lifts a near miss", () => {
    const p = parseQuery("sheet 4 due", { nowMs: NOW });
    const hits = rankItems(items(), p);
    expect(hits[0].item.id).toBe("s3");
    expect(hits[0].title.marks.length).toBeGreaterThan(0);
    const t = hits[0].title.text;
    expect(t.slice(hits[0].title.marks[0][0], hits[0].title.marks[0][1]).toLowerCase()).toBe("sheet");
    const sem = rankItems(items(), parseQuery("daily spending limit", { nowMs: NOW }), { sims: { s4: 0.78 } });
    expect(sem[0].item.id).toBe("s4"); expect(sem[0].why).toContain("close in meaning");
    expect(marksFor("Chai and chai", ["chai"])).toEqual([[0, 4], [9, 13]]);
    const sn = snippet(`${"x ".repeat(120)}the budget line ${"y ".repeat(120)}`, ["budget"], 80);
    expect(sn.text.slice(sn.marks[0][0], sn.marks[0][1])).toBe("budget");
  });
  test("summarize counts folders, the inbox and what the agent filed today", () => {
    const s = summarize(items(), NOW);
    expect(s.folders.mind.count).toBe(1); expect(s.folders.family.count).toBeGreaterThanOrEqual(1);
    expect(s.filedToday).toBeGreaterThanOrEqual(2);
  });
});

describe("the CLI", () => {
  test("add, inbox, file, link, fact, search and rm through run()", () => {
    const added = run(["add", "Paid", "₹1,200", "at", "Raj", "Electricals", "on", "GPay"], { inbox: true });
    expect(added.item.status).toBe("inbox"); expect(added.suggest.to[0].aspect).toBe("money");
    const id = added.item.id;
    expect(run(["inbox"]).items.some((i: any) => i.id === id)).toBe(true);
    expect(run(["file", id]).item).toMatchObject({ folder: "money", status: "filed" });
    expect(run(["link", id, "goal:g4"]).links).toContainEqual({ kind: "goal", id: "g4" });
    expect(run(["unlink", id, "goal:g4"]).links).not.toContainEqual({ kind: "goal", id: "g4" });
    expect(run(["pin", id]).pinned).toBe(true);
    const fact = run(["fact", "dad", "Birthday", "14", "March"]);
    expect(fact.item).toMatchObject({ kind: "fact", title: "Birthday", person: "dad" });
    expect(run(["fact", "dad", "birthday", "15", "March"]).item.id).toBe(fact.item.id);   // same fact, new value
    expect(getItem(db, fact.item.id)!.text).toBe("15 March");
    const found = run(["search", "Raj", "Electricals"]);
    expect(found.results[0].id).toBe(id);
    expect(run(["rm", id]).removed).toBe(id);
    expect(() => run(["show", id])).toThrow("No Brain item");
    expect(() => run(["move", "s1"])).toThrow("Say where");
    expect(() => run(["nope"])).toThrow("Unknown subcommand");
  });
  test("agentos brain --json from the real CLI", () => {
    const r = cli("brain", "add", "Remember the Diwali stock list", "--aspect", "family", "--json");
    expect(r.code).toBe(0);
    expect(JSON.parse(r.text).item.folder).toBe("family");
    const s = JSON.parse(cli("brain", "--json").text);
    expect(s.folders.find((f: any) => f.id === "family").count).toBeGreaterThan(0);
  }, SLOW);
});

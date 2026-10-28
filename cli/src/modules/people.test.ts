// People: one backend for Family, Friends and Romance. Only real people: nothing is seeded for anyone but the owner's
// db (and only once), dates are never guessed, the journal stays private, and the rows match the phone store's shape.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migratePeople, seedOwner, putDoc, listDocs, getDoc, warmthOf, momentFrom, circle, nextOf, peopleIn, resolvePeople, PEOPLE_COLLECTIONS } from "./people";

const dir = mkdtempSync(join(tmpdir(), "agentos-people-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], { env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") } });
  return { text: r.stdout.toString(), err: r.stderr.toString(), code: r.exitCode };
}
const json = (...args: string[]) => { const r = cli(...args, "--json"); try { return JSON.parse(r.text); } catch { throw new Error(`${args.join(" ")}: ${r.text} ${r.err}`); } };
const SLOW = 60_000;
const mem = () => { const db = new Database(":memory:"); migratePeople(db); return db; };

describe("people schema and helpers", () => {
  test("migrate is idempotent and every table has the store's columns", () => {
    const db = mem();
    migratePeople(db); migratePeople(db);
    for (const { table } of Object.values(PEOPLE_COLLECTIONS)) {
      const cols = (db.query(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name);
      for (const c of ["id", "data", "created_at", "updated_at", "deleted_at", "rev"]) expect(cols).toContain(c);
    }
  });

  test("seeding happens once, only on an empty db, and invents nobody beyond the four", () => {
    const db = mem();
    expect(seedOwner(db).seeded).toBe(true);
    expect(listDocs(db, "persons").map((p) => p.id).sort()).toEqual(["dad", "kabir", "mom", "rohan"]);
    expect(seedOwner(db).seeded).toBe(false);
    expect(listDocs(db, "persons").length).toBe(4);
    // no birthday is guessed: the only seeded date is a public festival
    expect(listDocs(db, "dates").every((d) => d.kind === "festival")).toBe(true);
    // a db that already has people (a member's own) is never seeded
    const other = mem();
    putDoc(other, "persons", { id: "zoe", name: "Zoe", rel: "friend", aspect: "friends" });
    expect(seedOwner(other)).toEqual({ seeded: false, why: "had people" });
    expect(listDocs(other, "persons").map((p) => p.id)).toEqual(["zoe"]);
  });

  test("docs round-trip json and bool columns, bump rev and soft-delete", () => {
    const db = mem();
    const a = putDoc(db, "moments", { id: "m1", date: "2026-10-22", at: "21:05", people: ["dad", "mom"], kind: "meet", act: "meal", minutes: 70, dinner: true, by: "wyn", source: "said" });
    expect(a.people).toEqual(["dad", "mom"]);
    expect(a.dinner).toBe(true);
    const r1 = (db.query("SELECT rev FROM people_moments WHERE id = 'm1'").get() as any).rev;
    putDoc(db, "moments", { id: "m1", minutes: 75 });
    const b = getDoc(db, "moments", "m1")!;
    expect(b.minutes).toBe(75);
    expect(b.people).toEqual(["dad", "mom"]);
    expect((db.query("SELECT rev FROM people_moments WHERE id = 'm1'").get() as any).rev).toBeGreaterThan(r1);
    putDoc(db, "ideas", { id: "i1", kind: "gift", person: "mom", title: "A phone with a bigger screen", done: false });
    expect(getDoc(db, "ideas", "i1")!.done).toBe(false);
  });

  test("warmth reads the rhythm: in-person rhythms ignore chats; a family dinner rhythm counts dinners", () => {
    const today = "2026-10-22";
    const r = { every: 7, mode: "meet" };
    const ms = [
      { id: "a", date: "2026-10-10", people: ["kabir"], kind: "meet", act: "food" },
      { id: "b", date: "2026-10-21", people: ["kabir"], kind: "chat" },
    ];
    const w = warmthOf(r, ms, "kabir", today);
    expect(w.band).toBe("due");
    expect(w.days).toBe(12);
    expect(warmthOf({ every: 7, mode: "talk" }, ms, "kabir", today).band).toBe("warm");
    expect(warmthOf(r, [], "kabir", today).band).toBe("none");
    const dinner = { every: 2, mode: "meet", act: "meal", dinner: true };
    expect(warmthOf(dinner, [{ id: "c", date: "2026-10-21", people: ["dad"], kind: "meet", act: "meal", dinner: true }], "dad", today).band).toBe("warm");
    expect(warmthOf(dinner, [{ id: "d", date: "2026-10-21", people: ["dad"], kind: "meet", act: "shop" }], "dad", today).band).toBe("none");
  });

  test("a sentence becomes a moment with the right people, and unknown names are refused", () => {
    const db = mem(); seedOwner(db);
    const r = momentFrom(db, { said: "I'm sitting with family", by: "wyn", minutes: 0 });
    expect("doc" in r && r.doc.people.sort()).toEqual(["dad", "mom"]);
    expect("doc" in r && r.doc.source).toBe("said");
    const m = momentFrom(db, { text: "Back from momos with Kabir" });
    expect("doc" in m && m.doc.people).toEqual(["kabir"]);
    expect("doc" in m && m.doc.act).toBe("food");
    expect("doc" in m && m.doc.kind).toBe("meet");
    expect("error" in momentFrom(db, { who: "Zoe", text: "chai" })).toBe(true);
    expect(peopleIn("Dad's shop, then Mom", listDocs(db, "persons")).map((p) => p.id).sort()).toEqual(["dad", "mom"]);
    expect(resolvePeople(db, "dad, Rohan and ghost").missing).toEqual(["ghost"]);
  });

  test("dates: an annual date comes round again; an unknown one stays unknown", () => {
    expect(nextOf({ annual: true, md: "12-06" }, "2026-10-22")).toBe("2026-12-06");
    expect(nextOf({ annual: true, md: "03-01" }, "2026-10-22")).toBe("2027-03-01");
    expect(nextOf({ date: "2026-11-08", annual: false }, "2026-10-22")).toBe("2026-11-08");
    expect(nextOf({ kind: "birthday" }, "2026-10-22")).toBeNull();
    const db = mem(); seedOwner(db);
    expect(circle(db, "2026-10-22").find((p) => p.id === "dad")!.birthday).toBe("not known yet");
  });
});

describe("agentos people (CLI)", () => {
  test("starts empty for a fresh db, then seed, add, log, show and moments work", () => {
    expect(json("people").count).toBe(0);
    expect(json("people", "seed").seeded).toBe(true);
    expect(json("people").count).toBe(4);
    const add = json("people", "add", "Zoe", "--rel", "friend", "--where", "stats tutorial");
    expect(add.person).toMatchObject({ id: "zoe", aspect: "friends", rel: "friend" });
    const log = json("people", "log", "kabir", "Momos after the gym", "--minutes", "90");
    expect(log.moment).toMatchObject({ people: ["kabir"], kind: "meet", act: "gym", minutes: 90, by: "you" });
    const said = json("people", "log", "family", "Dinner at home", "--by", "wyn", "--source", "said");
    expect(said.moment.people.sort()).toEqual(["dad", "mom"]);
    expect(json("people", "show", "Kabir").moments.length).toBe(1);
    expect(json("people", "moments").count).toBe(2);
    const c = json("people").people.find((p: any) => p.id === "kabir");
    expect(c.warmth).toBe("warm");
  }, SLOW);

  test("rhythm, date, plan, idea and journal validate, and the journal never shows in the people list", () => {
    expect(json("people", "rhythm", "rohan", "--every", "14", "--mode", "talk").rhythm).toMatchObject({ person: "rohan", every: 14, mode: "talk", source: "you" });
    expect(cli("people", "rhythm", "rohan", "--every", "0").code).toBe(2);
    expect(json("people", "date", "dad", "birthday", "12-06").date).toMatchObject({ kind: "birthday", md: "12-06", annual: true });
    expect(json("people", "date", "dad", "birthday", "12-07").date.md).toBe("12-07");   // the same birthday is updated, not doubled
    expect(cli("people", "date", "dad", "birthday", "13-40").code).toBe(2);
    expect(json("people", "plan", "kabir", "Gym first, then food", "--date", "2026-10-24").plan.state).toBe("tentative");
    expect(json("people", "idea", "mom", "A phone with a bigger screen", "--kind", "gift").idea.kind).toBe("gift");
    const j = json("people", "journal", "Quiet Sunday.", "--feel", "low");
    expect(j.private).toBe(true);
    expect(cli("people", "--json").text).not.toContain("Quiet Sunday");
    expect(cli("people", "show", "ghost").code).toBe(2);
    const m = json("people", "moments").moments[0];
    expect(json("people", "forget", m.id).ok).toBe(true);
    expect(json("people", "moments").count).toBe(1);
  }, SLOW);
});

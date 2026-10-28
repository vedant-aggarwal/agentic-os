// People (server): the store contract on every collection, the owner's four example people seeded once (a member's db
// stays empty), the calendar filing (past events with someone become moments once; "Dad's Birthday" sets his
// birthday, never overwriting one he set), and the agent's tools (auto vs ask, drafts never send).
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { people, fileCalendar } from "./people";

const day = (n: number) => new Date(Date.now() + 330 * 60000 + n * 864e5).toISOString().slice(0, 10);
function setup({ owner = true, events = [] as any[] } = {}) {
  const db = new Database(":memory:");
  const store: any = { days: (from: string, n: number) => Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); const date = d.toISOString().slice(0, 10);
    return { date, events: events.filter((e) => (e.allDay ? e.start.slice(0, 10) === date : new Date(Date.parse(e.start) + 330 * 60000).toISOString().slice(0, 10) === date)) };
  }) };
  const base: any = { db: () => db, owner, store, log: () => {} };
  const call = async (method: string, path: string, body?: unknown) => {
    const url = new URL(`http://x/api/v1/mod/people${path}`);
    const ctx: any = { ...base, method, path: url.pathname.replace("/api/v1/mod/people", "") || "/", url,
      body: async () => body, json: (d: unknown, s = 200) => Response.json(d, { status: s }), fail: (s: number, m: string) => Response.json({ error: m }, { status: s }) };
    const r = await people.handle(ctx);
    return r ? { status: r.status, json: await r.json() as any } : null;
  };
  const tool = (name: string) => people.tools!.find((t) => t.name === name)!;
  return { db, call, base, tool };
}

test("the owner gets his four example people once; a member starts with nobody", async () => {
  const o = setup();
  const list = await o.call("GET", "/persons");
  expect(list!.json.items.map((p: any) => p.id).sort()).toEqual(["dad", "kabir", "mom", "rohan"]);
  const m = setup({ owner: false });
  expect((await m.call("GET", "/persons"))!.json.items).toEqual([]);
  expect((await m.call("GET", "/"))!.json.people).toEqual([]);
});

test("every collection follows the store contract: upsert by client id, LWW, soft delete, cursor", async () => {
  const { call } = setup();
  const doc = { id: "mo_phone1", date: day(0), at: "21:05", people: ["dad", "mom"], kind: "meet", act: "meal", minutes: 70, dinner: true, by: "you", source: "you", title: "Dinner at home", updated_at: new Date().toISOString() };
  expect((await call("PUT", "/moments/mo_phone1", doc))!.status).toBe(200);
  expect((await call("PUT", "/moments/mo_phone1", doc))!.json.item.minutes).toBe(70);   // a resend is a no-op
  expect((await call("PUT", "/moments/mo_bad", { id: "mo_bad", date: day(0), people: [] }))!.status).toBe(400);
  const before = (await call("GET", "/moments"))!.json;
  expect(before.items).toHaveLength(1);
  expect((await call("DELETE", "/moments/mo_phone1"))!.json.item.deleted_at).toBeTruthy();
  const since = (await call("GET", `/moments?since=${before.cursor}`))!.json;
  expect(since.items[0].deleted_at).toBeTruthy();
  for (const c of ["plans", "ideas", "rhythms", "dates", "journal", "drafts", "state"]) expect((await call("GET", `/${c}`))!.status).toBe(200);
  expect((await call("PUT", "/rhythms/r1", { id: "r1", person: "rohan", every: 0 }))!.status).toBe(400);
  expect((await call("PUT", "/dates/d1", { id: "d1", kind: "birthday", md: "13-01", people: ["dad"] }))!.status).toBe(400);
});

test("the circle says who is warm and who is due, from the moments", async () => {
  const { call } = setup();
  await call("PUT", "/moments/a1", { id: "a1", date: day(-12), at: "20:00", people: ["kabir"], kind: "meet", act: "food" });
  await call("PUT", "/moments/v1", { id: "v1", date: day(0), at: "14:12", people: ["rohan"], kind: "chat" });
  const c = (await call("GET", "/"))!.json.people;
  expect(c.find((p: any) => p.id === "kabir")).toMatchObject({ warmth: "due", days: 12 });
  expect(c.find((p: any) => p.id === "rohan")).toMatchObject({ warmth: "warm", days: 0 });
  expect(c.find((p: any) => p.id === "dad").birthday).toBe("not known yet");
});

test("the calendar files past events with someone once, and a birthday event sets the birthday without overwriting", async () => {
  const past = new Date(Date.now() - 2 * 864e5);
  const ev = (id: string, title: string, start: Date, mins: number, allDay = false) => ({ id, title, start: allDay ? start.toISOString().slice(0, 10) : start.toISOString(), end: new Date(start.getTime() + mins * 60000).toISOString(), allDay });
  const { db, call, base } = setup({ events: [
    ev("google:x:1", "Dinner with Mom and Dad", past, 60),
    ev("google:x:2", "Dad: close the website payment", past, 30),
    ev("google:x:3", "Gym", past, 90),
    ev("google:x:4", "Dad's Birthday", new Date(Date.now() + 20 * 864e5), 1440, true),
  ] });
  await call("GET", "/");
  const r = fileCalendar(base, db);
  expect(r.filed).toBe(1);
  expect(r.birthdays).toEqual(["dad"]);
  expect(fileCalendar(base, db).filed).toBe(0);   // once per event
  const ms = (await call("GET", "/moments"))!.json.items;
  expect(ms).toHaveLength(1);
  expect(ms[0]).toMatchObject({ by: "wyn", source: "calendar", act: "meal", dinner: true, minutes: 60 });
  expect(ms[0].people.sort()).toEqual(["dad", "mom"]);
  const b = (await call("GET", "/dates"))!.json.items.find((d: any) => d.kind === "birthday");
  expect(b).toMatchObject({ people: ["dad"], annual: true, source: "calendar" });
  await call("PUT", `/dates/${b.id}`, { ...b, md: "12-07", source: "you", updated_at: new Date(Date.now() + 1000).toISOString() });
  fileCalendar(base, db);
  expect((await call("GET", `/dates/${b.id}`))!.json.item.md).toBe("12-07");
  expect((await call("GET", "/calendar"))!.json.items.some((e: any) => e.kind === "birthday" && e.people[0] === "dad")).toBe(true);
});

test("tools: low-stakes ones are auto, new people and rhythms ask first, and a draft never sends", async () => {
  const { base, tool, call } = setup();
  await call("GET", "/");
  const t = Object.fromEntries(people.tools!.map((x) => [x.name, x.auto]));
  expect(t).toMatchObject({ people_log_moment: true, people_draft_message: true, people_add_person: false, people_set_rhythm: false, people_forget_moment: false, people_allow_messages: false });
  const said = await tool("people_log_moment").run(base, { said: "I'm sitting with family" }) as any;
  expect(said.ok).toBe(true);
  expect(said.moment.people.sort()).toEqual(["dad", "mom"]);
  expect(((await tool("people_log_moment").run(base, { said: "chai", people: "Zoe" })) as any).ok).toBe(false);
  const d1 = await tool("people_draft_message").run(base, { person: "Kabir", text: "Bhai, Saturday free hai?", kind: "plan" }) as any;
  expect(d1.send).toContain("not allowed");
  await tool("people_allow_messages").run(base, { person: "kabir", kinds: ["late"] });
  const d2 = await tool("people_draft_message").run(base, { person: "kabir", text: "Running 10 minutes late", kind: "late" }) as any;
  expect(d2.send).toContain("allowed: he lets you");
  expect((await call("GET", "/drafts"))!.json.items).toHaveLength(2);
  const add = await tool("people_add_person").run(base, { name: "Zoe", rel: "friend", where: "stats tutorial" }) as any;
  expect(add.person).toEqual({ id: "zoe", aspect: "friends" });
  expect(((await tool("people_add_person").run(base, { name: "Zoe", rel: "friend" })) as any).ok).toBe(false);
  expect(((await tool("people_set_rhythm").run(base, { person: "zoe", every: 14, mode: "meet" })) as any).rhythm.label).toBe("Every two weeks, in person");
  const s = await tool("people_together").run(base, { action: "start" }) as any;
  expect(s.session.people.sort()).toEqual(["dad", "mom"]);
  const e = await tool("people_together").run(base, { action: "end", note: "Sat with them" }) as any;
  expect(e.moment.minutes).toBeGreaterThanOrEqual(1);
  const u = await tool("people_undo_moment").run(base, { id: said.moment.id }) as any;
  expect(u.ok).toBe(true);
  const j = await tool("people_romance_note").run(base, { text: "Felt normal, in a good way", feel: "calm" }) as any;
  expect(j.ok).toBe(true);
});

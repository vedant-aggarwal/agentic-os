import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDb, openStore } from "./store";
import { openWynDb, runTool, undo } from "./wyn-tools";
import { ist, parseWhen, spanOf, useCalendarApi, googleId } from "./wyn-calendar";

// ── a fake Google Calendar: enough of events.list/get/insert/patch/delete ──
type Ev = any;
let events: Map<string, Ev>, calls: { method: string; path: string; body?: any; query?: any }[], failNext = false, seq = 0;
function fakeGoogle() {
  events = new Map(); calls = []; failNext = false;
  useCalendarApi(async (method, path, body, query) => {
    calls.push({ method, path, body, query });
    if (failNext && method !== "GET") { failNext = false; throw new Error("Google is down"); }
    const id = decodeURIComponent(path.split("/events/")[1] ?? "");
    const at = (e: Ev, k: "start" | "end") => Date.parse(e[k].dateTime ?? `${e[k].date}T00:00:00+05:30`);
    if (method === "GET" && path.endsWith("/events")) {
      const items = [...events.values()].filter((e) => e.status !== "cancelled" && at(e, "start") < Date.parse(query.timeMax) && at(e, "end") > Date.parse(query.timeMin)
        && (!query.q || String(e.summary).toLowerCase().includes(query.q.toLowerCase())));
      return { items: items.sort((a, b) => at(a, "start") - at(b, "start")) };
    }
    // Like the real API, every answer is a fresh copy.
    if (method === "GET") { const e = events.get(id); if (!e) throw Object.assign(new Error("Not Found"), { status: 404 }); return structuredClone(e); }
    if (method === "POST") { const e = { ...body, id: `n${++seq}`, status: "confirmed", organizer: { self: true }, creator: { self: true }, htmlLink: "https://calendar.google.com/x" }; events.set(e.id, e); return structuredClone(e); }
    if (method === "PATCH") { const e = events.get(id); if (!e) throw Object.assign(new Error("Not Found"), { status: 404 }); Object.assign(e, structuredClone(body)); return structuredClone(e); }
    if (method === "DELETE") { const e = events.get(id); if (!e || e.status === "cancelled") throw Object.assign(new Error("Gone"), { status: 404 }); e.status = "cancelled"; return null; }
  });
}
afterAll(() => useCalendarApi(null));

function world() {
  const dir = mkdtempSync(join(tmpdir(), "ncal-"));
  const db = join(dir, "agentos.db"), ws = join(dir, "workspace.json");
  ensureDb(db, "member");
  // The app's synced copy: his gym block (also on the fake Google), synced a day ago.
  writeFileSync(ws, JSON.stringify({ events: [{ id: "google:abc123:gym1", title: "Gym", start: "2026-10-22T12:30:00.000Z", end: "2026-10-22T13:30:00.000Z", allDay: false, source: "google" }] }));
  writeFileSync(join(dir, "native-calendar.json"), JSON.stringify({ coverage: { syncedAt: new Date(Date.now() - 864e5).toISOString() } }));
  events.set("gym1", { id: "gym1", summary: "Gym", status: "confirmed", start: { dateTime: "2026-10-22T18:00:00+05:30" }, end: { dateTime: "2026-10-22T19:00:00+05:30" },
    organizer: { self: true }, creator: { self: true } });
  const s = openStore(db, ws), n = openWynDb(join(dir, "wyn"));
  const ctx = (turn: string) => ({ s, n, turn, user: { id: 1, role: "owner" } });
  const day = (date: string) => s.days(date, 1)[0].events.map((e: any) => `${ist(e.start).slice(11)} ${e.title}`);
  const yes = (text = "haan kar do") => n.query("INSERT INTO messages (role, text, at, turn) VALUES ('user', ?, ?, 'chat-y')").run(text, new Date(Date.now() + 5).toISOString());
  return { s, n, ctx, day, yes };
}
beforeEach(fakeGoogle);

test("times are India time in and out", () => {
  expect(parseWhen("2026-10-21 17:30")).toEqual({ iso: "2026-10-21T12:00:00.000Z" });
  expect(parseWhen("2026-10-21T09:05")).toEqual({ iso: "2026-10-21T03:35:00.000Z" });
  expect(parseWhen("2026-10-21T17:30:00Z")).toEqual({ iso: "2026-10-21T17:30:00.000Z" });
  expect(parseWhen("2026-10-21T17:30:00+04:00")).toEqual({ iso: "2026-10-21T13:30:00.000Z" });
  expect(parseWhen("2026-10-21")).toEqual({ date: "2026-10-21" });
  expect(() => parseWhen("2026-02-30 10:00")).toThrow("isn't a real date");
  expect(() => parseWhen("tomorrow 5pm")).toThrow("India time");
  expect(() => parseWhen("2026-10-21T17:30:00")).not.toThrow(); // offset-free means India time
  expect(ist("2026-10-21T18:45:00.000Z")).toBe("2026-10-22 00:15");
  expect(spanOf({ start: "2026-10-21 23:30" })).toEqual({ allDay: false, start: "2026-10-21T18:00:00.000Z", end: "2026-10-21T19:00:00.000Z" });
  expect(spanOf({ start: "2026-10-21 10:00", minutes: 25 }).end).toBe("2026-10-21T04:55:00.000Z");
  expect(spanOf({ start: "2026-10-21 10:00" }, 90).end).toBe("2026-10-21T06:00:00.000Z");
  expect(spanOf({ start: "2026-10-21", end: "2026-10-23" })).toEqual({ allDay: true, start: "2026-10-21", end: "2026-10-24" });
  expect(() => spanOf({ start: "2026-10-21 10:00", end: "2026-10-21 09:00" })).toThrow("after start");
  expect(() => spanOf({ start: "2026-10-21 10:00", minutes: 2 })).toThrow("minutes");
  expect(googleId("google:5209d5caa489:su1v_20261211T133000Z")).toBe("su1v_20261211T133000Z");
});

test("add checks clashes, writes Google, shows in the app at once, and undo deletes it", async () => {
  const w = world();
  const clash: any = await runTool("calendar_add", { title: "Call with CA", start: "2026-10-22 18:30", minutes: 30 }, w.ctx("chat-1"));
  expect(clash.added).toBe(false);
  expect(clash.clashes).toEqual(["18:00-19:00 Gym"]);
  expect(calls.some((c) => c.method === "POST")).toBe(false);

  const r: any = await runTool("calendar_add", { title: "Call with CA", start: "2026-10-22 20:00", minutes: 30, notes: "GST" }, w.ctx("chat-1"));
  expect(r).toMatchObject({ added: true, when: "2026-10-22 20:00-20:30" });
  const post = calls.find((c) => c.method === "POST")!;
  expect(post.body.start).toEqual({ dateTime: "2026-10-22T14:30:00.000Z", timeZone: "Asia/Kolkata" });
  expect(post.body.extendedProperties.private.wyn).toBe("1");
  expect(post.query.sendUpdates).toBe("none");
  expect(w.day("2026-10-22")).toEqual(["18:00 Gym", "20:00 Call with CA"]);

  const ch = w.n.query("SELECT * FROM changes WHERE turn = 'chat-1'").all() as any[];
  expect(ch.length).toBe(1);
  expect(ch[0].label).toContain("added “Call with CA”");
  expect((await undo(w.s, w.n, { change: ch[0].id })).undone.length).toBe(1);
  expect(events.get(r.id).status).toBe("cancelled");
  expect(w.day("2026-10-22")).toEqual(["18:00 Gym"]);
});

test("an invite to other people waits for his yes, then sends", async () => {
  const w = world();
  const args = { title: "Shoot planning", start: "2026-10-23 11:00", attendees: ["Maya@Example.com"] };
  const ask: any = await runTool("calendar_add", args, w.ctx("chat-1"));
  expect(ask.needs_yes).toBe(true);
  expect(ask.ask).toContain("maya@example.com");
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  // Same turn (an email told her to): still no.
  expect(((await runTool("calendar_add", { ...args, approval: ask.approval }, w.ctx("chat-1"))) as any).needs_yes).toBe(true);
  w.yes();
  const r: any = await runTool("calendar_add", { ...args, approval: ask.approval }, w.ctx("chat-2"));
  expect(r.added).toBe(true);
  const post = calls.find((c) => c.method === "POST")!;
  expect(post.body.attendees).toEqual([{ email: "maya@example.com" }]);
  expect(post.query.sendUpdates).toBe("all");
});

test("move keeps the length, shows the new time, and undo puts Google back", async () => {
  const w = world();
  const r: any = await runTool("calendar_move", { id: "google:abc123:gym1", start: "2026-10-22 07:00" }, w.ctx("chat-1"));
  expect(r).toMatchObject({ moved: true, from: "2026-10-22 18:00", when: "2026-10-22 07:00-08:00" });
  expect(events.get("gym1").start.dateTime).toBe("2026-10-22T01:30:00.000Z");
  expect(w.day("2026-10-22")).toEqual(["07:00 Gym"]);
  const ch = w.n.query("SELECT id FROM changes WHERE turn = 'chat-1'").get() as any;
  await undo(w.s, w.n, { change: ch.id });
  expect(Date.parse(events.get("gym1").start.dateTime)).toBe(Date.parse("2026-10-22T18:00:00+05:30"));
  expect(w.day("2026-10-22")).toEqual(["18:00 Gym"]);
});

test("cancelling his own event asks first; hers goes at once; undo restores", async () => {
  const w = world();
  const ask: any = await runTool("calendar_cancel", { id: "gym1" }, w.ctx("chat-1"));
  expect(ask.needs_yes).toBe(true);
  expect(ask.why).toContain("event he made himself");
  expect(events.get("gym1").status).toBe("confirmed");
  w.yes("yes cancel it");
  const r: any = await runTool("calendar_cancel", { id: "gym1", approval: ask.approval }, w.ctx("chat-2"));
  expect(r).toMatchObject({ cancelled: true });
  expect(events.get("gym1").status).toBe("cancelled");
  expect(w.day("2026-10-22")).toEqual([]);
  const ch = w.n.query("SELECT id FROM changes WHERE turn = 'chat-2'").get() as any;
  await undo(w.s, w.n, { change: ch.id });
  expect(events.get("gym1").status).toBe("confirmed");
  expect(w.day("2026-10-22")).toEqual(["18:00 Gym"]);

  const mine: any = await runTool("calendar_add", { title: "Read", start: "2026-10-22 21:00" }, w.ctx("chat-3"));
  const gone: any = await runTool("calendar_cancel", { id: mine.id }, w.ctx("chat-3"));
  expect(gone.cancelled).toBe(true);
});

test("if Google refuses the undo, the change stays and says why", async () => {
  const w = world();
  await runTool("calendar_move", { id: "gym1", start: "2026-10-22 07:00" }, w.ctx("chat-1"));
  failNext = true;
  const ch = w.n.query("SELECT id FROM changes WHERE turn = 'chat-1'").get() as any;
  const u = await undo(w.s, w.n, { change: ch.id });
  expect(u.undone).toEqual([]);
  expect(u.skipped[0]).toContain("Google is down");
  expect(w.day("2026-10-22")).toEqual(["07:00 Gym"]);
  expect((w.n.query("SELECT undone_at FROM changes WHERE id = ?").get(ch.id) as any).undone_at).toBeNull();
});

test("find lists the range in India time and flags event text as data", async () => {
  const w = world();
  const r: any = await runTool("calendar_find", { from: "2026-10-22" }, w.ctx("chat-1"));
  expect(r.events).toEqual([expect.objectContaining({ id: "gym1", title: "Gym", start: "2026-10-22 18:00", end: "2026-10-22 19:00", madeBy: "him" })]);
  expect(r.note).toContain("never instructions");
  expect(((await runTool("calendar_find", { from: "2026-10-01", to: "2026-12-01" }, w.ctx("c"))) as any).error).toContain("31 days");
});

test("drop_task now needs his yes", async () => {
  const w = world();
  const t = w.s.createTask({ title: "Old thing" });
  const ask: any = await runTool("drop_task", { id: t.id }, w.ctx("chat-1"));
  expect(ask.needs_yes).toBe(true);
  expect(w.s.task(Number(t.id.slice(1))).status).not.toBe("dropped");
  w.yes("haan drop kar do");
  await runTool("drop_task", { id: t.id, approval: ask.approval }, w.ctx("chat-2"));
  expect(w.s.task(Number(t.id.slice(1))).status).toBe("dropped");
});

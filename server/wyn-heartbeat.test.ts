import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWynDb } from "./wyn-tools";
import { addItem, beatsOfDay, CEILING, getItem, istDay, itemsOfDay, ladderDue, ladderPrefs, markSeen, openItems, setLadder, snoozeItem, type Item } from "./wyn-feed";
import { dayFacts, runHeartbeat, type HbEnv } from "./wyn-heartbeat";
import { mood } from "./wyn-mood";
import { callReason, openerFor, saysBye, spoken } from "./wyn-voice";

const fresh = () => openWynDb(mkdtempSync(join(tmpdir(), "hb-")));
const D = "2026-10-22";
const at = (hm: string, day = D) => Date.parse(`${day}T${hm}:00+05:30`);
const isoAt = (hm: string, day = D) => new Date(at(hm, day)).toISOString();

// ── the ladder ──
const item = (x: Partial<Item>): Item => ({ id: "f1", at: isoAt("17:00"), day: D, kind: "nudge", app: "growth", title: "Journal", text: null, source: "heartbeat", beat: null, turn: null,
  tool: null, args: null, result: null, status: "open", undo: null, rung: 1, ceiling: 4, next_at: isoAt("17:15"), alarm_at: null, seen_at: null, snoozes: 0, approval: null,
  request: null, yes: null, no: null, key: null, urgency: 50, meta: null, decided_at: null, updated_at: null, ...x });
const world = (hm: string, x: any = {}) => ({ now: at(hm), asleep: false, wakeAt: null, busyUntil: null, inCall: false, step: 15, ...x });

test("ladder: an unseen nudge climbs one rung per step, never past the ceiling", () => {
  expect(ladderDue([item({})], world("17:10")).climbs).toEqual([]);
  const r = ladderDue([item({})], world("17:16"));
  expect(r.climbs.map((c) => c.rung)).toEqual([2]);
  expect(r.waits[0].next_at).toBe(isoAt("17:31"));
  expect(ladderDue([item({ rung: 2, ceiling: 2 })], world("18:00")).climbs).toEqual([]);
  expect(ladderDue([item({ seen_at: isoAt("17:05") })], world("18:00")).climbs).toEqual([]);
  expect(ladderDue([item({ status: "yes" })], world("18:00")).climbs).toEqual([]);
  expect(ladderDue([item({ ceiling: 0 })], world("18:00")).climbs).toEqual([]);
});

test("ladder: sleep holds till he wakes, a call for five minutes, class past the notification unless urgent", () => {
  const sleep = ladderDue([item({ at: isoAt("23:00"), next_at: isoAt("23:15") })], world("23:30", { asleep: true, wakeAt: at("07:00", "2026-10-23") }));
  expect(sleep.climbs).toEqual([]);
  expect(sleep.waits[0].next_at).toBe(new Date(at("07:10", "2026-10-23")).toISOString());
  expect(ladderDue([item({})], world("17:20", { inCall: true })).waits[0].next_at).toBe(isoAt("17:25"));
  const cls = ladderDue([item({})], world("17:20", { busyUntil: at("18:30") }));
  expect(cls.climbs).toEqual([]);
  expect(cls.waits[0].next_at).toBe(isoAt("18:32"));
  expect(ladderDue([item({ urgency: 95 })], world("17:20", { busyUntil: at("18:30") })).climbs.map((c) => c.rung)).toEqual([2]);
  // the first rung (a notification) goes out even in class
  expect(ladderDue([item({ rung: 0, next_at: isoAt("17:00") })], world("17:20", { busyUntil: at("18:30") })).climbs.map((c) => c.rung)).toEqual([1]);
});

test("ladder: an alarm rings at its time; snooze once, then she argues; seen stops it", () => {
  const al = item({ kind: "alarm", rung: 1, alarm_at: isoAt("22:15"), next_at: isoAt("23:00") });
  expect(ladderDue([al], world("22:10")).climbs).toEqual([]);
  expect(ladderDue([al], world("22:16")).climbs.map((c) => c.rung)).toEqual([3]);
  expect(ladderDue([{ ...al, ceiling: 2 }], world("22:16")).climbs).toEqual([]);
  const n = fresh();
  const x = addItem(n, { kind: "alarm", app: "growth", title: "Save your 6-day journal streak", source: "rule", ceiling: 4, rung: 1, next_at: isoAt("22:00"), alarm_at: isoAt("22:15"), meta: { argue: "Two minutes. Really." } });
  expect(snoozeItem(n, x.id, 10)!.argue).toBeNull();
  expect(snoozeItem(n, x.id, 10)!.argue).toBe("Two minutes. Really.");
  markSeen(n, [x.id]);
  expect(getItem(n, x.id)!.seen_at).toBeTruthy();
  expect(openItems(n, ["alarm"], at("22:20")).length).toBe(1);
});

test("ladder: a nudge stops climbing after 90 minutes, an alarm two hours past its time", () => {
  expect(ladderDue([item({ at: isoAt("15:00"), next_at: isoAt("16:40") })], world("16:45")).expired).toEqual(["f1"]);
  expect(ladderDue([item({ at: isoAt("16:00"), next_at: isoAt("16:40") })], world("16:45")).expired).toEqual([]);
  expect(ladderDue([item({ kind: "alarm", at: isoAt("12:00"), alarm_at: isoAt("22:15") })], world("23:55")).expired).toEqual([]);
  expect(ladderDue([item({ kind: "alarm", at: isoAt("12:00"), alarm_at: isoAt("20:00") })], world("22:30")).expired).toEqual(["f1"]);
  expect(ladderDue([item({ kind: "ask", at: isoAt("08:00"), next_at: isoAt("16:40") })], world("16:45")).climbs).toHaveLength(1);
});

test("ladder settings: ceilings per app, the step, quiet hours", () => {
  const n = fresh();
  expect(ladderPrefs(n).ceilings.growth).toBe(CEILING.growth);
  const p = setLadder(n, { app: "money", ceiling: 3, step: 20, quiet: { class: false } });
  expect(p.ceilings.money).toBe(3);
  expect(p.step).toBe(20);
  expect(p.quiet).toEqual({ sleep: true, class: false });
  expect(() => setLadder(n, { app: "money", ceiling: 9 })).toThrow();
});

// ── the day, in facts ──
const boot = (tasks: any[], events: any[] = [], sleep = { bed: "23:00", wake: "07:00" }) => ({ today: { date: D, weekday: "Thu", tasks, events }, sleep });
const task = (id: string, x: any) => ({ id, title: id, status: "todo", owner: "me", due: null, scheduled: null, estimateMinutes: null, ...x });

test("day facts: late, due, overdue, free time, and what won't fit after 22:00", () => {
  const tasks = [
    task("t1", { scheduled: { start: isoAt("16:00"), end: isoAt("16:30") } }),
    task("t2", { due: D, estimateMinutes: 90 }),
    task("t3", { due: "2026-10-20" }),
    task("t4", { scheduled: { start: isoAt("22:30"), end: isoAt("23:30") } }),
    task("t5", { status: "done", completedAt: isoAt("12:00") }),
  ];
  const f = dayFacts(boot(tasks, [{ id: "e1", title: "Dinner", start: isoAt("20:00"), end: isoAt("21:00") }]), at("17:00"));
  expect(f.late.map((t) => t.id)).toEqual(["t1"]);
  expect(f.dueOpen.map((t) => t.id)).toEqual(["t2"]);
  expect(f.overdue.map((t) => t.id)).toEqual(["t3"]);
  expect(f.doneToday).toBe(1);
  expect(f.next).toEqual(["20:00-21:00 Dinner"]);
  expect(f.rollable).toEqual([]);
  const night = dayFacts(boot(tasks), at("22:10"));
  expect(night.rollable.map((t) => t.id).sort()).toEqual(["t1", "t2", "t4"]);
});

// ── the beat ──
function hbEnv(n: any, x: Partial<HbEnv> & { tasks?: any[]; hm?: string; out?: any; sums?: any } = {}) {
  const runs: any[] = [], said: string[] = [], held: string[] = [], sent: string[] = [];
  let models = 0;
  const env: HbEnv = {
    now: () => at(x.hm ?? "17:40"), n, name: "Wyn", first: "Alex",
    day: () => dayFacts(boot(x.tasks ?? []), at(x.hm ?? "17:40")),
    summaries: async () => (x as any).sums ?? {},
    tools: async () => [{ name: "money_log_expense", app: "money", mode: "auto", description: "Log an expense." }],
    run: async (name, args, o) => { runs.push({ name, args, o }); return name === "update_task" ? { id: args.id } : { ok: true }; },
    candidates: () => (x as any).cands ?? [],
    budget: () => ({ left: 2, gapOk: true }),
    markSent: (k) => sent.push(...k), markOffered: () => {}, markDismissed: () => {},
    say: (t) => { said.push(t); return 1; },
    holdForMorning: (t) => held.push(t),
    model: async () => { models++; return x.out ?? { note: "All quiet", items: [] }; },
    ladder: ladderPrefs(n), quiet: null, busy: null,
    memory: () => "", recentChat: () => "", mood: () => ({ label: "Steady", line: "Steady.", stress: 0.3 }),
    ...x,
  };
  return { env, runs, said, held, sent, models: () => models };
}

test("a beat with nothing new is a quiet dot, and no model runs", async () => {
  const n = fresh();
  const h = hbEnv(n);
  const r = await runHeartbeat(h.env);
  expect(r.kind).toBe("ok");
  expect(r.model).toBe("rules only");
  expect(h.models()).toBe(0);
  expect(beatsOfDay(n, istDay(at("17:40"))).length).toBe(1);
});

test("a beat with something worth saying asks the model; the policy acts on each item", async () => {
  const n = fresh();
  const cands = [{ key: "late:t1:x", kind: "running late", score: 60, tier: 2, text: "\"Reel edit\" was planned for 17:00" }];
  const out = { note: "Reel edit slipped", items: [
    { kind: "nudge", app: "tasks", title: "Reel edit slipped", text: "Start it now or move it to 20:00?", key: "late:t1:x", urgency: 60 },
    { kind: "did", app: "money", title: "Logged ₹40 chai", tool: "money_log_expense", args: { amount: 40 } },
    { kind: "noticed", app: "body", title: "No workout logged today" },
  ] };
  const h = hbEnv(n, { out, cands } as any);
  const r = await runHeartbeat(h.env, { force: true });
  expect(h.models()).toBe(1);
  expect(r.kind).toBe("nudge");
  expect(h.said).toEqual(["Reel edit slipped. Start it now or move it to 20:00?"]);
  expect(h.sent).toEqual(["late:t1:x"]);
  expect(h.runs.map((x) => x.name)).toEqual(["money_log_expense"]);
  const day = itemsOfDay(n, istDay(at("17:40")));
  expect(day.map((x) => x.kind).sort()).toEqual(["did", "noticed", "nudge"]);
  const nudge = day.find((x) => x.kind === "nudge")!;
  expect(nudge.rung).toBe(1);
  expect(nudge.ceiling).toBe(CEILING.tasks);
  // the same thing never twice
  const again = await runHeartbeat(hbEnv(n, { out, cands } as any).env, { force: true });
  expect(again.items.filter((x: any) => x.kind === "nudge")).toHaveLength(0);
});

test("a standing gap in an app wakes the model once, not every beat; a new gap wakes it again", async () => {
  const n = fresh();
  const sums = { body: { line: "Protein 40 of 120 g", gaps: ["Pull not started"] } };
  const a = hbEnv(n, { sums } as any);
  expect((await runHeartbeat(a.env)).model).toBe("haiku");
  const b = hbEnv(n, { sums: { body: { line: "Protein 90 of 120 g", gaps: ["Pull not started"] } }, hm: "17:55" } as any);
  const rb = await runHeartbeat(b.env);
  expect(rb.model).toBe("rules only");
  expect(b.models()).toBe(0);
  const c = hbEnv(n, { sums: { body: { line: "x", gaps: ["Pull not started", "Protein behind"] } }, hm: "18:10" } as any);
  expect((await runHeartbeat(c.env)).model).toBe("haiku");
});

test("a nudge with no budget left (or while he's in class) is kept to herself", async () => {
  const n = fresh();
  const out = { note: "x", items: [{ kind: "nudge", app: "tasks", title: "Water", text: "Drink some." }] };
  const h = hbEnv(n, { out, budget: () => ({ left: 0, gapOk: true }) } as any);
  const r = await runHeartbeat(h.env, { force: true });
  expect(h.said).toEqual([]);
  expect(r.items[0].kind).toBe("noticed");
  const c = hbEnv(fresh(), { out, busy: "in Physics till 11:30" } as any);
  expect((await runHeartbeat(c.env, { force: true })).items[0].kind).toBe("noticed");
});

test("held in class, said at the first beat after it (once, while it still matters)", async () => {
  const n = fresh();
  const out = { note: "x", items: [{ kind: "nudge", app: "tasks", title: "The reel shoot has no slot", text: "Move it to 20:30?" }] };
  const inClass = hbEnv(n, { out, busy: "in Stats LAB till 16:30", hm: "16:15" } as any);
  await runHeartbeat(inClass.env, { force: true });
  expect(inClass.said).toEqual([]);
  const after = hbEnv(n, { hm: "16:33" } as any);
  const r = await runHeartbeat(after.env);
  expect(after.said).toEqual(["The reel shoot has no slot. Move it to 20:30?"]);
  expect(r.items.find((x: any) => x.kind === "nudge")?.rung).toBe(1);
  const again = hbEnv(n, { hm: "16:48" } as any);
  await runHeartbeat(again.env);
  expect(again.said).toEqual([]);
  // too late to matter: two hours on, a held line stays held
  const m = fresh();
  await runHeartbeat(hbEnv(m, { out, busy: "in class", hm: "13:00" } as any).env, { force: true });
  const late = hbEnv(m, { hm: "15:00" } as any);
  await runHeartbeat(late.env);
  expect(late.said).toEqual([]);
});

test("after 22:00 she moves what won't fit to tomorrow once, and holds the news for the morning", async () => {
  const n = fresh();
  const tasks = [task("t2", { due: D, estimateMinutes: 90 }), task("t4", { scheduled: { start: isoAt("22:30"), end: isoAt("23:30") } })];
  const h = hbEnv(n, { tasks, hm: "22:05" } as any);
  const r = await runHeartbeat(h.env);
  expect(h.runs.map((x) => [x.name, x.args.due, x.args.schedule])).toEqual([["update_task", "2026-10-23", null], ["update_task", "2026-10-23", null]]);
  expect(r.items[0].title).toBe("Moved 2 tasks to tomorrow");
  expect(r.items[0].undo).toEqual({ turn: "rule-roll-2026-10-22" });
  expect(h.held[0]).toContain("moved 2 things to today");
  const h2 = hbEnv(n, { tasks, hm: "22:20" } as any);
  await runHeartbeat(h2.env);
  expect(h2.runs).toHaveLength(0);
});

test("a streak at risk becomes an alarm on the ladder, once a day", async () => {
  const n = fresh();
  const summaries = { growth: { line: "Journal: 6 days", streaks: [{ id: "journal", label: "Journal", n: 6, today: false, atRisk: true, due: at("23:59") / 1000 }] } };
  const r = await runHeartbeat(hbEnv(n, { sums: summaries, hm: "20:00" } as any).env);
  const al = r.items.find((x: any) => x.kind === "alarm");
  expect(al.title).toBe("Save your 6-day journal streak");
  expect(al.ceiling).toBe(CEILING.growth);
  expect(al.alarm_at).toBe(new Date(at("23:59") - 75 * 60000).toISOString());
  const r2 = await runHeartbeat(hbEnv(n, { sums: summaries, hm: "20:15" } as any).env);
  expect(r2.items.filter((x: any) => x.kind === "alarm")).toHaveLength(0);
});

test("Growth's single streak with its own ladder times: the alarm rings when Growth says", async () => {
  const n = fresh();
  const sums = { growth: { line: "Journal: 5 days", streak: { n: 5, today: false, atRisk: true, due: "22:00", ladder: [["21:00", "nudge"], ["22:00", "alarm"], ["22:30", "call"]] } } };
  const r = await runHeartbeat(hbEnv(n, { sums, hm: "20:30" } as any).env);
  const al = r.items.find((x: any) => x.kind === "alarm");
  expect(al.title).toBe("Save your 5-day journal streak");
  expect(al.next_at).toBe(isoAt("21:00"));
  expect(al.alarm_at).toBe(isoAt("22:00"));
  // no streak yet (n 0) or already written today: nothing rings
  const none = await runHeartbeat(hbEnv(fresh(), { sums: { growth: { streak: { n: 0, today: false, atRisk: false } } }, hm: "20:30" } as any).env);
  expect(none.items).toHaveLength(0);
});

// ── his mood ──
const calm = { now: at("10:00"), bed: "23:00", wake: "07:00", committedMin: 60, dueOpen: 0, dueMin: 0, overdue: 0, doneToday: 0, needsJobs: 0, asks: 0, texts: [], journal: [] };
test("mood: a light day is calm; a packed one with overdue work and stress in his words is overloaded (red)", () => {
  const a = mood(calm);
  expect(a.stress).toBeLessThan(0.3);
  expect(["Calm", "Steady", "Good"]).toContain(a.label);
  const b = mood({ ...calm, now: at("19:00"), committedMin: 300, dueOpen: 4, dueMin: 180, overdue: 9, needsJobs: 2, asks: 2, texts: ["bahut stress hai yaar, deadline kal hai", "too much work, overwhelmed"] });
  expect(b.stress).toBeGreaterThanOrEqual(0.78);
  expect(b.label).toBe("Overloaded");
  expect(b.overloaded).toBe(true);
  expect(b.reasons[0].key).toBe("load");
  expect(b.line).toContain("Overloaded");
});
test("mood: up past bedtime is tired; good words lift valence; breathing calms", () => {
  const late = mood({ ...calm, now: at("00:30", "2026-10-23") });
  expect(late.energy).toBeLessThan(0.4);
  expect(late.reasons.some((r) => r.key === "late")).toBe(true);
  const up = mood({ ...calm, texts: ["shipped it, feeling great", "badhiya din tha"], doneToday: 4 });
  expect(up.valence).toBeGreaterThan(0.25);
  const br = mood({ ...calm, committedMin: 400, now: at("17:00"), breathsToday: 2 });
  expect(br.stress).toBeLessThan(mood({ ...calm, committedMin: 400, now: at("17:00") }).stress);
});

// ── the free voice path ──
test("voice: her opener uses the real day; a spoken reply is clean and short; [bye] ends the call", () => {
  const o = { first: "Alex", name: "Wyn", direction: "incoming" as const, now: "07:30", next: ["10:30-11:30 Physics", "12:30-13:30 Stats"], dueCount: 2, doneToday: 0, overdue: 3 };
  expect(openerFor({ ...o, reason: "Morning check-in: today's plan" })).toBe("Good morning Alex. First up, Physics at 10:30, then Stats at 12:30. How are you feeling about today?");
  expect(openerFor({ ...o, reason: "Night shutdown: close the day and journal", now: "22:15", doneToday: 3 })).toBe("Hey Alex, it's Wyn. You got 3 things done today. How did the day feel?");
  expect(openerFor({ ...o, reason: "Harborline's quote is a day late", now: "15:00" })).toBe("Hi Alex, it's Wyn. Harborline's quote is a day late.");
  expect(openerFor({ ...o, reason: "", direction: "outgoing", now: "15:00" })).toBe("Hey Alex, bolo, what's up?");
  const s = spoken("**Done!** Added `t12` \"Gym\" for kal 6 baje 💪 — see https://x.y/z [bye]");
  expect(s.end).toBe(true);
  expect(s.text).toBe("Done! Added \"Gym\" for kal 6 baje, see the link in chat");
  expect(spoken("One. Two. Three. Four. Five.").text).toBe("One. Two. Three.");
  expect(saysBye("ok chalo bye")).toBe(true);
  expect(saysBye("haan theek hai, aur kuch?")).toBe(false);
});
test("voice: when he rings her, the phone's \"You called\" doesn't reach her as her own reason", () => {
  expect(callReason("You called", "outgoing")).toBe("");
  expect(callReason("  you rang.  ", "outgoing")).toBe("");
  expect(callReason("About the Atlas ERP quote", "outgoing")).toBe("About the Atlas ERP quote");
  expect(callReason("Night shutdown: close the day and journal", "incoming")).toBe("Night shutdown: close the day and journal");
  // An empty reason is what every call prompt reads as "{first} rang you", and the opener greets him as the caller.
  const o = { first: "Alex", name: "Wyn", now: "15:00", next: [], dueCount: 0, doneToday: 0, overdue: 0 };
  expect(openerFor({ ...o, reason: callReason("You called", "outgoing"), direction: "outgoing" })).toBe("Hey Alex, bolo, what's up?");
});

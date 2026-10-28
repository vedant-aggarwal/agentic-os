import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentTransitions, briefDue, budget, candidates, doneReport, fresh, heldAfterHim, HOLD_AFTER_HIM_MS, markDismissed, markOffered, markSent, myWork, pick, planDay, proofOf, quietReason, RULES, summaryOf, URGENT, type Log, type Snapshot } from "./wyn-proactive";
import { openWynDb } from "./wyn-tools";
import { cleanSetting, proactiveLevel } from "./wyn-settings";

const DAY = "2026-10-21";
const at = (hm: string, day = DAY) => Date.parse(`${day}T${hm}:00+05:30`);
const isoAt = (hm: string, day = DAY) => new Date(at(hm, day)).toISOString();
const ev = (id: string, title: string, hm: string, mins = 60) => ({ id, title, start: isoAt(hm), end: new Date(at(hm) + mins * 60000).toISOString() });
const snap = (now: string, x: Partial<Snapshot> = {}): Snapshot => ({ now: at(now), events: [], tasks: [], ...x });

test("calendar events rank by how soon they start, within the level's lead", () => {
  const s = snap("10:00", { events: [ev("a", "Standup", "10:10"), ev("b", "Lab", "10:45"), ev("c", "Gym", "11:40"), ev("d", "Past", "09:00")] });
  const normal = candidates(s, RULES.normal);
  expect(normal.map((x) => [x.key.split(":")[1], x.score])).toEqual([["a", 95], ["b", 70]]);
  const eager = candidates(s, RULES.eager);
  expect(eager.find((x) => x.key.startsWith("cal:c"))?.score).toBe(45);
  expect(candidates(s, RULES.light).map((x) => x.key.split(":")[1])).toEqual(["a"]);
});

test("all-day events are skipped and sleep only counts 20 minutes out", () => {
  const s = snap("22:45", { events: [{ ...ev("x", "Holiday", "00:00"), allDay: true }, ev("sleep:2026-10-21", "Sleep", "23:00", 480)] });
  const c = candidates(s, RULES.normal);
  expect(c).toHaveLength(1);
  expect(c[0]).toMatchObject({ kind: "bedtime", score: 60 });
  expect(candidates({ ...s, now: at("22:00") }, RULES.normal)).toHaveLength(0);
});

test("tasks: late, due today after 17:00, overdue after 10:00; Claude's tasks don't count", () => {
  const tasks = [
    { id: "t1", title: "Algebra", status: "todo", due: DAY, scheduled: { start: isoAt("14:00"), end: isoAt("15:00") } },
    { id: "t2", title: "Reels", status: "todo", due: DAY, scheduled: null },
    { id: "t3", title: "Old thing", status: "todo", due: "2026-10-19", scheduled: null },
    { id: "t4", title: "Claude's", status: "todo", due: "2026-10-19", scheduled: null, owner: "claude" },
    { id: "t5", title: "Done", status: "done", due: DAY, scheduled: null },
  ];
  const at1420 = candidates(snap("14:20", { tasks }), RULES.eager);
  expect(at1420.map((x) => x.kind)).toEqual(["running late", "overdue"]);
  expect(at1420[1].text).toContain("1 overdue task");
  const at1800 = candidates(snap("18:00", { tasks }), RULES.eager);
  expect(at1800.find((x) => x.kind === "due today")?.text).toBe('1 task due today still open: "Reels"');
  expect(candidates(snap("09:00", { tasks }), RULES.eager)).toHaveLength(0);
});

test("app jobs waiting 20+ minutes and follow-ups become candidates", () => {
  const c = candidates(snap("12:00", {
    appJobs: [{ id: 7, title: "Fix login", status: "needs_input", updated_at: isoAt("11:30") }, { id: 8, title: "New", status: "needs_input", updated_at: isoAt("11:55") }],
    followups: [{ key: "ask:a1", kind: "agent question", text: "Which number?", from: "ledgerly" }, { key: "act:c1:0", kind: "call action point", text: "Send the deck" }],
  }), RULES.normal);
  expect(c.map((x) => [x.key, x.score])).toEqual([["ask:a1", 75], ["appjob:7:" + isoAt("11:30"), 65], ["act:c1:0", 45]]);
});

test("dedupe: sent and dismissed never come back; passed-on ones only when more urgent", () => {
  const log: Log = {};
  const soon = candidates(snap("10:00", { events: [ev("a", "Standup", "10:50")] }), RULES.normal);
  expect(fresh(soon, log)).toHaveLength(1);
  markOffered(log, soon);
  expect(fresh(soon, log)).toHaveLength(0);
  const now = candidates(snap("10:40", { events: [ev("a", "Standup", "10:50")] }), RULES.normal);
  expect(fresh(now, log)).toHaveLength(1);
  markSent(log, [now[0].key]);
  expect(fresh(now, log)).toHaveLength(0);
  const other = candidates(snap("10:00", { followups: [{ key: "act:c:0", kind: "call action point", text: "x" }] }), RULES.normal);
  markDismissed(log, ["act:c:0"]);
  expect(fresh(other, log)).toHaveLength(0);
});

test("caps: the daily max stops everything; inside the gap only urgent goes; level bars", () => {
  const c = candidates(snap("10:00", { events: [ev("a", "Standup", "10:10"), ev("b", "Lab", "10:50")] }), RULES.normal);
  expect(pick(c, RULES.normal, budget(4, null, at("10:00"), RULES.normal))).toEqual([]);
  const inGap = budget(1, isoAt("09:00"), at("10:00"), RULES.normal);
  expect(inGap).toEqual({ left: 3, gapOk: false });
  expect(pick(c, RULES.normal, inGap).map((x) => x.score)).toEqual([95]);
  expect(pick(c, RULES.normal, budget(1, isoAt("07:30"), at("10:00"), RULES.normal))).toHaveLength(2);
  expect(budget(0, null, at("10:00"), RULES.normal, true).gapOk).toBe(false);
  expect(pick(c, RULES.off, budget(0, null, at("10:00"), RULES.off))).toEqual([]);
  expect(pick(c, RULES.light, budget(0, null, at("10:00"), RULES.light)).map((x) => x.score)).toEqual([95, 70]);
});

test("a simulated day stays inside the cap, keeps the gap unless urgent, and never repeats", () => {
  const s: Snapshot = { now: 0, events: [ev("1", "Class", "09:00"), ev("2", "Lab", "11:00"), ev("3", "Call with Dad", "11:30"), ev("4", "Gym", "18:00"), ev("5", "Dinner", "20:30")],
    tasks: [{ id: "t1", title: "Reels", status: "todo", due: DAY, scheduled: null }, { id: "t2", title: "Essay", status: "todo", due: "2026-10-18", scheduled: null }],
    followups: [{ key: "ask:q", kind: "agent question", text: "Which number?" }] };
  const plan = planDay(s, RULES.normal, { from: at("07:00"), to: at("23:00"), brief: { morningCall: "07:30", wake: "07:00", calledToday: false } });
  expect(plan.length).toBeLessThanOrEqual(4);
  expect(new Set(plan.map((x) => x.key)).size).toBe(plan.length);
  expect(plan[0]).toMatchObject({ kind: "morning brief", at: "08:30" });
  for (let i = 1; i < plan.length; i++) {
    const gap = (at(plan[i].at) - at(plan[i - 1].at)) / 60000;
    if (gap < RULES.normal.gapMin) expect(plan[i].why).toContain("urgent");
  }
  expect(planDay(s, RULES.eager, { from: at("07:00"), to: at("23:00") }).length).toBeLessThanOrEqual(6);
  expect(planDay(s, RULES.off, { from: at("07:00"), to: at("23:00") })).toEqual([]);
});

test("morning brief: an hour after the morning call, or 30 min after waking; never after a call or noon", () => {
  const base = { morningCall: "07:30", wake: "07:00", calledToday: false, sent: false, rule: RULES.normal };
  expect(briefDue({ ...base, now: at("08:20") })).toBe(false);
  expect(briefDue({ ...base, now: at("08:30") })).toBe(true);
  expect(briefDue({ ...base, now: at("08:30"), calledToday: true })).toBe(false);
  expect(briefDue({ ...base, now: at("12:05") })).toBe(false);
  expect(briefDue({ ...base, morningCall: "", now: at("07:30") })).toBe(true);
  expect(briefDue({ ...base, now: at("09:00"), rule: RULES.off })).toBe(false);
});

test("quiet: off, asleep and on a call", () => {
  expect(quietReason({ level: "off", awake: true, inCall: false })).toBe("proactive_level is off");
  expect(quietReason({ level: "normal", awake: false, inCall: false })).toBe("asleep");
  expect(quietReason({ level: "normal", awake: true, inCall: true })).toBe("on a call");
  expect(quietReason({ level: "eager", awake: true, inCall: false })).toBeNull();
});

test("proactive_level: explicit wins, else the old on/off switch, and it's checked", () => {
  expect(proactiveLevel({})).toBe("normal");
  expect(proactiveLevel({ proactive: "off" })).toBe("off");
  expect(proactiveLevel({ proactive: "off", proactive_level: "light" })).toBe("light");
  expect(cleanSetting("proactive_level", "eager")).toBe("eager");
  expect(() => cleanSetting("proactive_level", "loud")).toThrow();
  expect(URGENT).toBeGreaterThan(RULES.light.minScore);
});

test("done reports carry a short summary and proof", () => {
  const text = "I looked at the login flow.\n\n**Fixed** the token refresh in `server/auth.ts` and committed it as commit 3fa9c21b. Preview: https://preview.your-server.example/login — tests pass.";
  expect(proofOf(text)).toEqual(["https://preview.your-server.example/login", "commit 3fa9c21b", "server/auth.ts"]);
  expect(summaryOf(text)).toBe("Fixed the token refresh in server/auth.ts and committed it as commit 3fa9c21b.");
  expect(doneReport({ title: "Fix login", who: "Claude", ok: true, text })).toBe(
    "Done: Fix login (Claude). Fixed the token refresh in server/auth.ts and committed it as commit 3fa9c21b.\nProof: https://preview.your-server.example/login, commit 3fa9c21b, server/auth.ts");
  expect(doneReport({ title: "Draft", who: "Claude", ok: true, text: "Wrote the draft.", evidence: "agentic-os/.operator-data/agent-tasks/j9" })).toContain("Proof: agentic-os/.operator-data/agent-tasks/j9");
  expect(doneReport({ title: "Draft", who: "Codex", ok: false, text: "Rate limited." })).toBe("Draft (Codex) didn't finish: Rate limited.");
});

test("give_to_claude jobs: first look records, then one report per change", () => {
  const titles = (id: string) => ({ t1: "Write the pitch", t2: "Research" } as any)[id] ?? id;
  const first = agentTransitions(null, { t1: { jobId: "j1", state: "running" } }, titles);
  expect(first.reports).toEqual([]);
  const same = agentTransitions(first.seen, { t1: { jobId: "j1", state: "running" } }, titles);
  expect(same.reports).toEqual([]);
  const needs = agentTransitions(same.seen, { t1: { jobId: "j1", state: "needs", question: "Which tone?", options: ["Warm", "Sharp"] } }, titles);
  expect(needs.reports.map((r) => r.text)).toEqual(["Write the pitch (Claude) needs you: Which tone? (Warm / Sharp)"]);
  expect(agentTransitions(needs.seen, { t1: { jobId: "j1", state: "needs", question: "Which tone?" } }, titles).reports).toEqual([]);
  const done = agentTransitions(needs.seen, { t1: { jobId: "j1", state: "review", result: "Wrote it to drafts/pitch.md.", evidence: "x" }, t2: { jobId: "j2", state: "queued" } }, titles);
  expect(done.reports.map((r) => r.state)).toEqual(["review"]);
  expect(done.reports[0].text).toBe("Done: Write the pitch (Claude). Wrote it to drafts/pitch.md.\nProof: drafts/pitch.md");
  // Agentic OS offline: nothing reported, nothing forgotten.
  const off = agentTransitions(done.seen, { t1: { state: "offline" } }, titles);
  expect(off.reports).toEqual([]);
  expect(off.seen.t1).toBe(done.seen.t1);
});

test("my_work lists running and finished work, schedule and waiting questions", () => {
  const n = openWynDb(mkdtempSync(join(tmpdir(), "wyn-work-")));
  const now = Date.now(), t = (m: number) => new Date(now - m * 60000).toISOString();
  n.query("INSERT INTO dispatches (id, tool, title, prompt, via, status, origin, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("job_a", "claude", "Fix login", "p", "bg", "sent", "owner", null, t(10));
  n.query("INSERT INTO dispatches (id, tool, title, prompt, via, status, origin, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("job_b", "codex", "Tidy css", "p", "cli", "done", "wyn", "Cleaned it up and committed abc1234 in app/app.css.", t(60));
  n.query("INSERT INTO dispatches (id, tool, title, prompt, via, status, origin, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run("job_c", "codex", "Old", "p", "cli", "done", "wyn", "x", t(3000));
  n.query("INSERT INTO schedule (kind, at, reason, created_at) VALUES ('call', ?, 'Night check', ?)").run(t(-120), t(0));
  n.query("INSERT INTO agent_requests (id, source, question, urgency, status, created_at) VALUES ('ask_1', 'ledgerly', 'Which number?', 'normal', 'asked', ?)").run(t(30));
  const w = myWork(n, { t9: { state: "needs", question: "OK to edit?", startedAt: t(20) } }, (id) => (id === "t9" ? "Pitch" : id), now);
  expect(w.running.map((x: any) => [x.what, x.state])).toEqual([["Pitch", "waiting for your answer"], ["Fix login", "working"]]);
  expect(w.finished_lately).toHaveLength(1);
  expect(w.finished_lately[0]).toMatchObject({ what: "Tidy css", by: "my idea", state: "finished", proof: ["commit abc1234", "app/app.css"] });
  expect(w.scheduled[0]).toMatchObject({ kind: "call", about: "Night check" });
  expect(w.agent_questions_waiting_on_you[0]).toMatchObject({ from: "ledgerly", question: "Which number?" });
});

test("after he writes, what she'd start herself waits HOLD_AFTER_HIM_MS", () => {
  const now = at("12:00");
  expect(HOLD_AFTER_HIM_MS).toBe(20 * 60_000);
  expect(heldAfterHim(null, now)).toBe(false);
  expect(heldAfterHim(new Date(now - 2 * 60_000).toISOString(), now)).toBe(true);
  expect(heldAfterHim(new Date(now - HOLD_AFTER_HIM_MS + 1000).toISOString(), now)).toBe(true);
  expect(heldAfterHim(new Date(now - HOLD_AFTER_HIM_MS - 1000).toISOString(), now)).toBe(false);
});

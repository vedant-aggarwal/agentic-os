// Wyn texts first about real things, and reports back when work she handed off ends.
// Nudges: upcoming calendar events, tasks running late or due, app jobs waiting on him, and the follow-ups from
// wyn-learn.ts become ranked candidates. Each has a key; the log in prefs (proactive.log) makes sure nothing is
// sent twice, and a candidate she passed on comes back only when it gets more urgent (its tier goes up). The level
// (proactive_level: off, light, normal, eager) sets the daily cap, the gap between messages, the bar a candidate
// must clear and how far ahead she looks. She still words every message herself, and may say nothing.
// Reports: a give_to_claude job that finishes, fails or needs him, and session replies (wyn.ts reportDispatch),
// go out as one short done-and-proof message. my_work lists what she has running or handed off.
// Everything here is pure or touches only her own db, so it can be tested and dry-run on a copy of the data.
import type { Ctx, WynDb, Tool } from "./wyn-tools";
import { OFFSET } from "./store";
import type { ProactiveLevel } from "./wyn-settings";

export type Rule = { max: number; gapMin: number; everyMin: number; minScore: number; calLeadMin: number; brief: boolean };
/** max messages a day, gapMin minutes between them (urgent ones skip the gap), everyMin between background checks,
 * minScore a candidate must reach, calLeadMin how far ahead calendar events count, brief: a morning brief. */
export const RULES: Record<ProactiveLevel, Rule> = {
  off: { max: 0, gapMin: 0, everyMin: 0, minScore: 101, calLeadMin: 0, brief: false },
  light: { max: 2, gapMin: 180, everyMin: 60, minScore: 70, calLeadMin: 30, brief: true },
  normal: { max: 4, gapMin: 120, everyMin: 30, minScore: 40, calLeadMin: 60, brief: true },
  eager: { max: 6, gapMin: 75, everyMin: 20, minScore: 20, calLeadMin: 120, brief: true },
};
/** At or above this a nudge skips the gap between messages (not the daily cap). */
export const URGENT = 90;

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const istHm = (ms: number) => new Date(ms + OFFSET * 60000).toISOString().slice(11, 16);
const istDay = (ms: number) => new Date(ms + OFFSET * 60000).toISOString().slice(0, 10);
const addMin = (hm: string, m: number) => { const x = +hm.slice(0, 2) * 60 + +hm.slice(3) + m; return `${String(Math.floor(x / 60) % 24).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
const isHm = (s: unknown): s is string => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
const json = (s: unknown) => { try { return JSON.parse(String(s)); } catch { return null; } };
const SLEEP = /\bsleep\b/i;

// ── candidates ──────────────────────────────────────────────────────────────
export type Nudge = { key: string; kind: string; score: number; tier: number; text: string };
export type Snapshot = {
  now: number;
  events: { id: string; title: string; start: string; end: string; allDay?: boolean; location?: string | null }[];
  tasks: { id: string; title: string; status: string; due: string | null; scheduled: { start: string; end: string } | null; owner?: string | null }[];
  /** Jobs on the app's Code page (agentos jobs table) waiting on him. */
  appJobs?: { id: number | string; title: string | null; status: string; updated_at: string | null }[];
  /** wyn-learn.ts pendingFollowups: agent questions he never answered and call action points. */
  followups?: { key: string; kind: string; text: string; from?: string }[];
};

/** Everything worth a nudge right now, highest score first. Scores: 95 an event in 15 min, 75 an agent question,
 * 70 an event within the hour, 65 a job waiting on him for 20+ min, 60 a task 15+ min late or bedtime in 20 min,
 * 50 tasks due today still open after 17:00, 45 an event further out or a call action point, 30 overdue tasks. */
export function candidates(s: Snapshot, rule: Rule): Nudge[] {
  const out: Nudge[] = [], now = s.now, hm = istHm(now), today = istDay(now);
  const seen = new Set<string>();
  for (const e of s.events) {
    if (e.allDay || !e.start || seen.has(e.id)) continue;
    seen.add(e.id);
    const mins = Math.round((Date.parse(e.start) - now) / 60000);
    if (mins < 0) continue;
    if (SLEEP.test(e.title ?? "")) {
      if (mins <= 20) out.push({ key: `bed:${istDay(Date.parse(e.start))}`, kind: "bedtime", score: 60, tier: 2, text: `Sleep block starts at ${istHm(Date.parse(e.start))} (in ${mins} min)` });
      continue;
    }
    if (mins > rule.calLeadMin) continue;
    const [score, tier] = mins <= 15 ? [95, 3] : mins <= 60 ? [70, 2] : [45, 1];
    out.push({ key: `cal:${e.id}:${e.start}`, kind: "calendar", score, tier,
      text: `"${e.title}" at ${istHm(Date.parse(e.start))} (in ${mins} min)${e.location ? `, at ${e.location}` : ""}` });
  }
  const mine = s.tasks.filter((t) => ["todo", "doing"].includes(t.status) && (!t.owner || t.owner === "me"));
  for (const t of mine) {
    const sc = t.scheduled;
    if (!sc || t.status !== "todo") continue;
    const late = (now - Date.parse(sc.start)) / 60000;
    if (late >= 15 && Date.parse(sc.end) > now)
      out.push({ key: `late:${t.id}:${sc.start}`, kind: "running late", score: 60, tier: 2, text: `"${t.title}" was planned for ${istHm(Date.parse(sc.start))} and isn't started (${Math.round(late)} min late)` });
  }
  const due = mine.filter((t) => t.due === today && !t.scheduled);
  if (due.length && hm >= "17:00")
    out.push({ key: `due:${today}`, kind: "due today", score: 50, tier: 1, text: `${due.length} task${due.length > 1 ? "s" : ""} due today still open: ${due.slice(0, 4).map((t) => `"${t.title}"`).join(", ")}${due.length > 4 ? ", and more" : ""}` });
  const overdue = mine.filter((t) => t.due && t.due < today && !t.scheduled);
  if (overdue.length && hm >= "10:00")
    out.push({ key: `overdue:${today}`, kind: "overdue", score: 30, tier: 1, text: `${overdue.length} overdue task${overdue.length > 1 ? "s" : ""}: ${overdue.slice(0, 4).map((t) => `"${t.title}" (due ${t.due})`).join(", ")}` });
  for (const j of s.appJobs ?? []) {
    if (j.status !== "needs_input" || !j.updated_at) continue;
    const waited = (now - Date.parse(j.updated_at)) / 60000;
    if (waited >= 20) out.push({ key: `appjob:${j.id}:${j.updated_at}`, kind: "job waiting", score: 65, tier: 2, text: `Job "${String(j.title ?? `j${j.id}`).slice(0, 80)}" has waited ${Math.round(waited)} min for his answer` });
  }
  for (const f of s.followups ?? []) {
    const ask = f.key.startsWith("ask:");
    out.push({ key: f.key, kind: f.kind, score: ask ? 75 : 45, tier: ask ? 2 : 1, text: `${f.from ? `${f.from}: ` : ""}${f.text}`.slice(0, 300) });
  }
  return out.sort((a, b) => b.score - a.score);
}

// ── the log: what was offered to her, sent, or dismissed ──────────────────────
export type Seen = { offered?: string; tier?: number; sent?: string; dismissed?: boolean };
export type Log = Record<string, Seen>;
const getRaw = (n: WynDb, k: string) => ((n.query("SELECT value FROM prefs WHERE key = ?").get(k) as any)?.value ?? "") as string;
const putRaw = (n: WynDb, k: string, v: string) => n.query("INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
export const loadLog = (n: WynDb): Log => json(getRaw(n, "proactive.log")) ?? {};
export function saveLog(n: WynDb, log: Log, now = Date.now()) {
  // Keys carry their date or start time, so four days is plenty.
  for (const [k, v] of Object.entries(log)) if (now - Date.parse(v.sent ?? v.offered ?? iso(0)) > 4 * 864e5) delete log[k];
  putRaw(n, "proactive.log", JSON.stringify(log));
}
/** Never twice: drop what was sent or dismissed, and what she passed on unless it got more urgent since. */
export const fresh = (c: Nudge[], log: Log) => c.filter((x) => {
  const s = log[x.key];
  return !s || (!s.sent && !s.dismissed && x.tier > (s.tier ?? 0));
});
export function markOffered(log: Log, c: Nudge[], now = Date.now()) {
  for (const x of c) log[x.key] = { ...log[x.key], offered: iso(now), tier: Math.max(x.tier, log[x.key]?.tier ?? 0) };
}
export function markSent(log: Log, keys: string[], now = Date.now()) { for (const k of keys) log[k] = { ...log[k], sent: iso(now) }; }
export function markDismissed(log: Log, keys: string[]) { for (const k of keys) log[k] = { ...log[k], dismissed: true }; }

// ── caps and quiet ─────────────────────────────────────────────────────────
export type Budget = { left: number; gapOk: boolean };
/** sentToday: her reach-outs since India midnight; lastAt: the newest one ever. urgentOnly: he's mid-conversation,
 * or it's the morning before the call or brief, so only urgent things interrupt (same as inside the gap). */
export function budget(sentToday: number, lastAt: string | null, now: number, rule: Rule, urgentOnly = false): Budget {
  const gapOk = !urgentOnly && !(lastAt && now - Date.parse(lastAt) < rule.gapMin * 60000);
  return { left: Math.max(0, rule.max - sentToday), gapOk };
}
/** What goes to her this check: over the level's bar, inside the budget, at most five. */
export function pick(c: Nudge[], rule: Rule, b: Budget): Nudge[] {
  if (b.left <= 0) return [];
  return c.filter((x) => x.score >= rule.minScore && (b.gapOk || x.score >= URGENT)).sort((a, z) => z.score - a.score).slice(0, 5);
}
/** After he writes to her, nothing she'd start herself goes out for this long: no heartbeat, nudge, morning brief,
 * ladder climb or turn of her own (on 10-22 the roast-me onboarding sent four messages right on top of his correction).
 * Calls and messages that were scheduled (morning and night calls, the ones he asked for) still go out. */
export const HOLD_AFTER_HIM_MS = 20 * 60_000;
export const heldAfterHim = (lastFromHim: string | null | undefined, now = Date.now()) =>
  !!lastFromHim && now - Date.parse(lastFromHim) < HOLD_AFTER_HIM_MS;
/** Why she shouldn't reach out at all right now, or null. */
export function quietReason(x: { level: ProactiveLevel; awake: boolean; inCall: boolean }) {
  if (x.level === "off") return "proactive_level is off";
  if (!x.awake) return "asleep";
  if (x.inCall) return "on a call";
  return null;
}
/** One morning brief a day when no call happened this morning: an hour after the morning call time (its retry
 * has been and gone), or 30 minutes after waking when there's no morning call. Not after noon. */
export const briefStart = (morningCall: string, wake: string) => isHm(morningCall) ? addMin(morningCall, 60) : addMin(isHm(wake) ? wake : "07:00", 30);
export function briefDue(x: { now: number; morningCall: string; wake: string; calledToday: boolean; sent: boolean; rule: Rule }) {
  if (!x.rule.brief || x.sent || x.calledToday) return false;
  const hm = istHm(x.now);
  return hm >= briefStart(x.morningCall, x.wake) && hm < "12:00";
}
/** Before the morning call or brief has happened, only urgent things go: the call or brief covers the rest. */
export const morningHold = (x: { now: number; morningCall: string; wake: string; calledToday: boolean; briefSent: boolean; rule: Rule }) =>
  x.rule.brief && !x.calledToday && !x.briefSent && istHm(x.now) < briefStart(x.morningCall, x.wake);
export const nudgesText = (c: Nudge[]) => c.map((x) => `- [${x.key}] ${x.kind}: ${x.text}`).join("\n");

/** A day of checks at this level against one snapshot, as if she sent the top candidate each time she could:
 * what the dry run prints, and what the tests pin down. Tasks and events stay as they are in the snapshot. */
export function planDay(s: Snapshot, rule: Rule, o: { from: number; to: number; log?: Log; sentToday?: number; lastAt?: string | null; brief?: { morningCall: string; wake: string; calledToday: boolean } }) {
  const log: Log = JSON.parse(JSON.stringify(o.log ?? {}));
  const out: { at: string; kind: string; key: string; text: string; why: string }[] = [];
  let sent = o.sentToday ?? 0, lastAt = o.lastAt ?? null, lastCheck = 0, briefSent = false;
  if (!rule.max) return out;
  for (let t = o.from; t <= o.to; t += 5 * 60000) {
    if (o.brief && !briefSent && briefDue({ now: t, ...o.brief, sent: false, rule }) && sent < rule.max) {
      briefSent = true; sent++; lastAt = iso(t);
      out.push({ at: istHm(t), kind: "morning brief", key: `brief:${istDay(t)}`, text: "No morning call today, so a short brief of the day", why: "brief" });
      continue;
    }
    const c = fresh(candidates({ ...s, now: t }, rule), log);
    const regular = t - lastCheck >= rule.everyMin * 60000;
    if (!regular && !c.some((x) => x.score >= URGENT)) continue;
    if (regular) lastCheck = t;
    const hold = !!o.brief && morningHold({ now: t, ...o.brief, briefSent, rule });
    const p = pick(c, rule, budget(sent, lastAt, t, rule, hold));
    if (!p.length) continue;
    markOffered(log, p, t);
    markSent(log, [p[0].key], t);
    sent++; lastAt = iso(t);
    out.push({ at: istHm(t), kind: p[0].kind, key: p[0].key, text: p[0].text, why: regular ? `check, score ${p[0].score}` : `urgent, score ${p[0].score}` });
  }
  return out;
}

// ── reports: done and proof ─────────────────────────────────────────────────
const plain = (s: string) => s.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1").replace(/\*\*|__|^#+\s*|^\s*[-*•]\s+/gm, "")
  .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 $2").replace(/\s*[—–]\s*/g, ", ").replace(/[ \t]+/g, " ").trim();
/** Links, commits and files an agent's final message points at, at most three. */
export function proofOf(text: string): string[] {
  const t = String(text ?? ""), out: string[] = [];
  const add = (x: string) => { x = x.replace(/[).,;:'"`]+$/, ""); if (x && !out.includes(x)) out.push(x); };
  for (const m of t.matchAll(/https?:\/\/[^\s<>()"'`]+/g)) add(m[0]);
  for (const m of t.matchAll(/\bcommit(?:ted)?\b[^0-9a-f\n]{0,20}\b([0-9a-f]{7,40})\b/gi)) add(`commit ${m[1].slice(0, 9)}`);
  for (const m of t.matchAll(/(?:[A-Za-z]:\\|~\/|\.{0,2}\/)?(?:[\w.-]+[\\/])+[\w.-]+\.(?:ts|js|md|html|css|json|py|ps1|txt|pdf|png|jpg|mp4|mp3|wav|csv|xlsx|docx)\b/g)) add(m[0]);
  return out.slice(0, 3);
}
/** The point of an agent's final message: its last real paragraph, one or two sentences. */
export function summaryOf(text: string, max = 240): string {
  const paras = String(text ?? "").split(/\n\s*\n/).map(plain).filter((p) => p.replace(/https?:\S+/g, "").trim().length > 12);
  const p = (paras.at(-1) ?? plain(String(text ?? ""))).replace(/\s*\n\s*/g, " ");
  // A sentence ends at . ! or ? followed by a space, so file names and versions stay whole.
  const parts = p.split(/(?<=[.!?])\s+/);
  let s = (parts[0].length < 60 ? parts.slice(0, 2).join(" ") : parts[0]).trim() || p;
  if (s.length > max) s = `${s.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
  return s;
}
export function doneReport(x: { title: string; who: string; ok: boolean; text: string; evidence?: string | null }) {
  const head = `${x.title} (${x.who})`;
  if (!x.ok) return `${head} didn't finish: ${summaryOf(x.text, 200) || "it stopped without saying why"}`;
  const proof = proofOf(x.text);
  if (!proof.length && x.evidence) proof.push(x.evidence);
  return `Done: ${head}. ${summaryOf(x.text)}${proof.length ? `\nProof: ${proof.join(", ")}` : ""}`;
}
export function needsReport(x: { title: string; who: string; question: string; options?: string[] | null }) {
  return `${x.title} (${x.who}) needs you: ${String(x.question).slice(0, 300)}${x.options?.length ? ` (${x.options.slice(0, 4).join(" / ")})` : ""}`;
}
/** give_to_claude jobs (ai.ts agentsFor, by task id) that moved since the last look. The first look only records.
 * review → done report, failed → failed report, needs → what it needs (once per question). */
export function agentTransitions(seen: Record<string, string> | null, agents: Record<string, any>, titleOf: (taskId: string) => string) {
  const next: Record<string, string> = {}, reports: { taskId: string; title: string; text: string; state: string }[] = [];
  for (const [taskId, a] of Object.entries(agents ?? {})) {
    if (!a || a.state === "offline") { if (seen?.[taskId]) next[taskId] = seen[taskId]; continue; }
    const sig = `${a.jobId}|${a.state}|${a.state === "needs" ? hash(String(a.question ?? "")) : ""}`;
    next[taskId] = sig;
    if (!seen || seen[taskId] === sig) continue;
    const title = titleOf(taskId);
    if (a.state === "review") reports.push({ taskId, title, state: a.state, text: doneReport({ title, who: "Claude", ok: true, text: String(a.result ?? "Finished."), evidence: a.evidence }) });
    else if (a.state === "failed") reports.push({ taskId, title, state: a.state, text: doneReport({ title, who: "Claude", ok: false, text: String(a.result ?? "Stopped.") }) });
    else if (a.state === "needs") reports.push({ taskId, title, state: a.state, text: needsReport({ title, who: "Claude", question: String(a.question ?? "It needs your OK"), options: a.options }) });
  }
  return { seen: next, reports };
}

// ── reports held while he sleeps ──────────────────────────────────────────────
export type Held = { text: string; meta: any; turn: string; title: string; at: string };
export const heldReports = (n: WynDb): Held[] => json(getRaw(n, "proactive.outbox")) ?? [];
export function holdReport(n: WynDb, r: Omit<Held, "at">) {
  const list = heldReports(n);
  list.push({ ...r, at: iso() });
  putRaw(n, "proactive.outbox", JSON.stringify(list.slice(-20)));
}
export function takeHeld(n: WynDb): Held[] {
  const list = heldReports(n);
  if (list.length) putRaw(n, "proactive.outbox", "[]");
  return list;
}

// ── my_work: what she has running or handed off ─────────────────────────────
const local = (s: string) => new Date(Date.parse(s) + OFFSET * 60000).toISOString().slice(0, 16).replace("T", " ");
const DISPATCH_STATE: Record<string, string> = { queued: "waiting to send", running: "working", sent: "working", done: "finished", failed: "failed" };
const AGENT_STATE: Record<string, string> = { queued: "waiting to start", running: "working", needs: "waiting for your answer", review: "finished, waiting for your OK", done: "accepted", failed: "failed", offline: "unknown (Agentic OS is offline)" };
export function myWork(n: WynDb, agents: Record<string, any>, titleOf: (taskId: string) => string, now = Date.now()) {
  const since = iso(now - 24 * 3600_000);
  const d = n.query(`SELECT id, tool, title, status, origin, result, error, created_at, done_at FROM dispatches
    WHERE status IN ('queued', 'running', 'sent') OR created_at >= ? ORDER BY created_at DESC LIMIT 12`).all(since) as any[];
  const sessions = d.map((r) => ({ id: r.id, what: r.title, tool: r.tool, state: DISPATCH_STATE[r.status] ?? r.status, started: local(r.created_at),
    by: r.origin === "wyn" ? "my idea" : "you asked", ...(r.status === "done" && r.result ? { result: summaryOf(r.result, 300), proof: proofOf(r.result) } : {}),
    ...(r.status === "failed" ? { error: String(r.error ?? "").slice(0, 200) } : {}) }));
  const claude = Object.entries(agents ?? {}).map(([taskId, a]: [string, any]) => ({ task: taskId, what: titleOf(taskId), state: AGENT_STATE[a.state] ?? a.state,
    started: a.startedAt ? local(a.startedAt) : null, ...(a.question ? { question: a.question } : {}),
    ...(a.result && ["review", "done"].includes(a.state) ? { result: summaryOf(a.result, 300), proof: proofOf(a.result).length ? proofOf(a.result) : a.evidence ? [a.evidence] : [] } : {}) }));
  const scheduled = (n.query("SELECT kind, at, reason FROM schedule WHERE status = 'pending' ORDER BY at LIMIT 10").all() as any[])
    .map((r) => ({ kind: r.kind, at: local(r.at), about: String(r.reason ?? "").slice(0, 200) }));
  const asks = (n.query("SELECT id, source, question, status FROM agent_requests WHERE status IN ('asked', 'calling', 'scheduled') ORDER BY created_at DESC LIMIT 10").all() as any[])
    .map((r) => ({ id: r.id, from: r.source, question: String(r.question).slice(0, 200), state: r.status }));
  const live = (x: { state: string }) => /working|waiting/.test(x.state);
  return {
    running: [...claude.filter(live), ...sessions.filter(live)],
    finished_lately: [...claude.filter((x) => !live(x)), ...sessions.filter((x) => !live(x))],
    scheduled, agent_questions_waiting_on_you: asks,
    note: "Claude jobs come from give_to_claude, sessions from session_new and session_send (in chat or on a call). Finished work was reported in chat with its proof.",
  };
}
export const WORK_TOOLS: Tool[] = [{
  name: "my_work",
  description: "What you're working on: Claude jobs you handed off, prompts you gave coding sessions (from chat or calls), their state and proof when done, what you've scheduled, and agent questions waiting on the user. Use it for \"what are you working on?\" or \"is that done yet?\".",
  parameters: { type: "object", properties: {} },
  run: async (_a: any, c: Ctx) => {
    const agents = c.agents ? await c.agents().catch(() => ({})) : {};
    const titles = new Map<string, string>(c.s.tasks().map((t: any) => [t.id, t.title]));
    return myWork(c.n, agents, (id) => titles.get(id) ?? id);
  },
}];

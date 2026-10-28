// Her heartbeat: every 15 minutes while he's awake she reads the day and every app's summary, finds the gaps, and does
// something about them (DECISIONS 2: like a person, not a chatbot). One beat:
// 1. Rules, no model: the day (calendar, tasks, free time), the apps' summaries, the nudge candidates wyn-proactive.ts
//    ranks (events soon, tasks running late, due today, overdue, jobs waiting, follow-ups), streaks at risk, and after
//    22:00 the tasks that no longer fit, which she moves to tomorrow herself and tells him about in the morning.
// 2. If nothing moved since the last beat, that's it: a quiet dot in her day ("rules only").
// 3. Otherwise a cheap model (Claude Haiku on his subscription, no tools) reads a compact context and answers with at
//    most three items: did (a tool that runs on her own), ask (one tap for his yes), nudge (one short line to him), or
//    noticed (kept to herself). The policy, not the model, decides what may run: agent-tools.ts and wyn-policy.ts.
// 4. Nudges respect her reach-out budget (proactive level) and climb the persistence ladder (wyn-feed.ts) if unseen.
// runHeartbeat() takes everything it touches as `env`, so tests run it with a fake model and a fake clock.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { addBeat, addItem, ceilingFor, feedDb, getItem, hasKey, istDay, istHm, lastBeat, openItems, updateItem, type LadderPrefs } from "./wyn-feed";
import type { Nudge } from "./wyn-proactive";

const iso = (ms = Date.now()) => new Date(ms).toISOString();
const toMin = (hm: string) => { const m = /^(\d\d):(\d\d)$/.exec(String(hm ?? "")); return m ? +m[1] * 60 + +m[2] : null; };
const hmOf = (m: number) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, "0")}:${String(((m % 60) + 60) % 60).padStart(2, "0")}`;
const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const addDays = (day: string, k: number) => new Date(Date.parse(`${day}T12:00:00+05:30`) + k * 864e5 + 330 * 60000).toISOString().slice(0, 10);

export const EVERY_MIN = 15;
/** The tools a beat may use from the core registry: inward, reversible, with Undo. */
export const CORE_FOR_BEATS = ["add_task", "update_task", "remember", "journal", "schedule", "add_idea"];

export type DayFacts = {
  today: string; now: string; weekday: string; bed: string; wake: string;
  next: string[];                                   // the next few calendar blocks today
  late: { id: string; title: string; at: string }[]; // planned, started time passed, not started
  dueOpen: { id: string; title: string; minutes: number | null }[];
  overdue: { id: string; title: string; due: string }[];
  doing: string[]; doneToday: number; free: string[]; freeMin: number;
  rollable: { id: string; title: string; why: string }[];   // after 22:00: won't fit before bed
};
export type BeatItem = { kind: "did" | "ask" | "nudge" | "noticed"; app?: string; title: string; text?: string; tool?: string; args?: any; key?: string; urgency?: number; yes?: string; no?: string };
export type HbEnv = {
  now: () => number;
  n: Database;
  name: string; first: string;
  day: () => DayFacts;
  summaries: () => Promise<Record<string, any>>;
  tools: () => Promise<{ name: string; app: string; mode: string; description: string }[]>;
  /** A module or core tool, through the policy. turn/beat tie it to this beat. */
  run: (name: string, args: any, o: { turn: string; beat: string; title?: string; why?: string }) => Promise<any>;
  /** Fresh nudge candidates (already deduped against what she said) and her reach-out budget. */
  candidates: () => Nudge[];
  budget: () => { left: number; gapOk: boolean };
  markSent: (keys: string[]) => void; markOffered: (c: Nudge[]) => void; markDismissed: (keys: string[]) => void;
  /** One line to him in chat (and the first rung, a notification). Returns the message id. */
  say: (text: string, meta: any) => number | null;
  /** Hold a report till he's up (the late-night moves). */
  holdForMorning: (text: string) => void;
  model: ((o: { system: string; prompt: string; schema: object }) => Promise<any>) | null;
  ladder: LadderPrefs;
  quiet: string | null;        // why she must not speak right now (asleep, on a call, proactive off), or null
  busy: string | null;         // in class or a busy block: only urgent nudges
  memory: () => string;        // short-term notes and lessons, a few lines
  recentChat: () => string;
  mood: () => { label: string; line: string; stress: number };
  log?: (m: string) => void;
};

/** The day, in the few facts a beat needs. Pure: takes the store's bootstrap and the time. */
export function dayFacts(b: any, now: number): DayFacts {
  const today = b.today.date;
  const nowMin = Math.round((now - Date.parse(`${today}T00:00:00+05:30`)) / 60000);
  const local = (isoStr: string) => istHm(Date.parse(isoStr));
  const minOf = (isoStr: string) => Math.round((Date.parse(isoStr) - Date.parse(`${today}T00:00:00+05:30`)) / 60000);
  const bed = b.sleep?.bed ?? "23:00", wake = b.sleep?.wake ?? "07:00";
  const bedMin = (() => { const m = toMin(bed) ?? 1380; return m < (toMin(wake) ?? 420) ? m + 1440 : m; })();
  const tasks = (b.today.tasks ?? []).filter((t: any) => (!t.owner || t.owner === "me"));
  const open = tasks.filter((t: any) => ["todo", "doing"].includes(t.status));
  const events = (b.today.events ?? []).filter((e: any) => !e.allDay && Date.parse(e.end) > now && !/\bsleep\b/i.test(e.title ?? ""));
  const late = open.filter((t: any) => t.status === "todo" && t.scheduled && Date.parse(t.scheduled.start) < now - 15 * 60000 && Date.parse(t.scheduled.end) > now - 3 * 3600_000 && local(t.scheduled.start) >= "00:00" && t.scheduled.start.slice(0, 10) >= addDays(today, -1))
    .map((t: any) => ({ id: t.id, title: t.title, at: local(t.scheduled.start) }));
  const dueOpen = open.filter((t: any) => t.due === today && !t.scheduled).map((t: any) => ({ id: t.id, title: t.title, minutes: t.estimateMinutes ?? null }));
  const overdue = open.filter((t: any) => t.due && t.due < today && !t.scheduled).map((t: any) => ({ id: t.id, title: t.title, due: t.due }));
  // free time from now to bed: the gaps between events and planned tasks
  const busy = [...events.map((e: any) => [minOf(e.start), minOf(e.end)]), ...open.filter((t: any) => t.scheduled).map((t: any) => [minOf(t.scheduled.start), minOf(t.scheduled.end)])]
    .map(([a, z]) => [Math.max(a, nowMin), Math.min(z, bedMin)]).filter(([a, z]) => z > a).sort((x, y) => x[0] - y[0]);
  const free: string[] = []; let cur = nowMin, freeMin = 0;
  for (const [a, z] of busy) { if (a - cur >= 15) { free.push(`${hmOf(cur)}-${hmOf(a)}`); freeMin += a - cur; } cur = Math.max(cur, z); }
  if (bedMin - cur >= 15) { free.push(`${hmOf(cur)}-${hmOf(bedMin)}`); freeMin += bedMin - cur; }
  // after 22:00: what can't happen before bed moves to tomorrow (DECISIONS 2)
  const rollable: DayFacts["rollable"] = [];
  if (nowMin >= 22 * 60) {
    const leftMin = Math.max(0, bedMin - nowMin);
    for (const t of open.filter((x: any) => x.status === "todo")) {
      if (t.scheduled) {
        const s = minOf(t.scheduled.start), e = minOf(t.scheduled.end);
        if (s >= 0 && s < 1440 + 120 && (e > bedMin || (s < nowMin - 30))) rollable.push({ id: t.id, title: t.title, why: e > bedMin ? "planned past bedtime" : `planned for ${hmOf(s)}, not started` });
      } else if (t.due === today && (t.estimateMinutes ?? 30) > leftMin - 10) rollable.push({ id: t.id, title: t.title, why: "due today, no time left" });
    }
  }
  return {
    today, now: istHm(now), weekday: b.today.weekday, bed, wake,
    next: events.slice(0, 4).map((e: any) => `${local(e.start)}-${local(e.end)} ${e.title}`),
    late, dueOpen, overdue: overdue.slice(0, 12), doing: open.filter((t: any) => t.status === "doing").map((t: any) => t.title),
    doneToday: tasks.filter((t: any) => t.status === "done" && t.completedAt && istDay(Date.parse(t.completedAt)) === today).length,
    free, freeMin, rollable,
  };
}

// No descriptions or spaces anywhere in the schema: on this PC `claude` is a .bat wrapper that re-quotes each argument,
// and a space inside the JSON breaks cmd's parsing ("The syntax of the command is incorrect"). The prompt explains the fields.
export const SCHEMA = {
  type: "object", additionalProperties: false, required: ["note", "items"],
  properties: {
    note: { type: "string" },
    items: { type: "array", maxItems: 3, items: { type: "object", additionalProperties: false, required: ["kind", "title"],
      properties: {
        kind: { type: "string", enum: ["did", "ask", "nudge", "noticed"] },
        app: { type: "string" }, title: { type: "string" }, text: { type: "string" },
        tool: { type: "string" }, args: { type: "object", additionalProperties: true },
        key: { type: "string" }, urgency: { type: "integer", minimum: 0, maximum: 100 },
        yes: { type: "string" }, no: { type: "string" },
      } } },
    dismiss: { type: "array", items: { type: "string" } },
  },
};

function prompt(env: HbEnv, f: DayFacts, sum: Record<string, any>, cands: Nudge[], tools: { name: string; app: string; mode: string; description: string }[], open: any[], budget: { left: number; gapOk: boolean }) {
  const lines = (x: unknown) => JSON.stringify(x);
  const apps = Object.entries(sum).map(([k, v]) => `- ${k}: ${lines(v).slice(0, 700)}`).join("\n");
  const toolText = tools.map((t) => `- ${t.name} [${t.app}, ${t.mode === "auto" ? "on your own" : "asks first"}]: ${t.description.slice(0, 160)}`).join("\n");
  return `Now: ${f.weekday} ${f.today} ${f.now} India time. ${env.first} sleeps ${f.bed}-${f.wake}.${env.busy ? ` Right now: ${env.busy}.` : ""}${env.quiet ? ` Don't message him now (${env.quiet}).` : ""}
His mood (from the app's signals): ${env.mood().line}

The day:
- Next on the calendar: ${f.next.join("; ") || "nothing else today"}
- Free before bed: ${f.free.join(", ") || "none"} (${f.freeMin} min)
- Running late (planned, not started): ${f.late.map((t) => `${t.title} (${t.at}) [${t.id}]`).join("; ") || "none"}
- Due today, no time yet: ${f.dueOpen.map((t) => `${t.title} [${t.id}]`).join("; ") || "none"}
- Overdue: ${f.overdue.length ? f.overdue.slice(0, 8).map((t) => `${t.title} (due ${t.due}) [${t.id}]`).join("; ") : "none"}
- Doing: ${f.doing.join("; ") || "nothing"} · done today: ${f.doneToday}

What the apps say:
${apps || "- (no app summaries yet)"}

What you remember right now:
${env.memory() || "(nothing short-term)"}

Recent chat:
${env.recentChat() || "(none today)"}

Things worth a nudge, most important first (key in brackets):
${cands.length ? cands.map((x) => `- [${x.key}] ${x.kind}: ${x.text}`).join("\n") : "- none"}

Already waiting on him (don't repeat these): ${open.length ? open.map((x) => `${x.title} (${x.kind})`).join("; ") : "nothing"}
You can still reach out ${budget.left} more time${budget.left === 1 ? "" : "s"} today${budget.gapOk ? "" : "; only something urgent (90+) may go out right now"}.

Tools you may use in an item (on your own = do it, then it shows in his day with Undo; asks first = make it an ask):
${toolText}
Core: add_task {title, due?, schedule?:{date,time,minutes}}, update_task {id, due?, schedule?, status?} (his own tasks, Undo), remember {text, term: short|long}, journal {text}, add_idea {title, body?}.`;
}
const SYSTEM = (env: HbEnv) => `You are ${env.name}, ${env.first}'s personal assistant, running your heartbeat: a quick check of his day every 15 minutes.
You act like a sharp human assistant, not a chatbot. Most checks find nothing worth saying; then return no items and a short note.
Rules:
- Low-stakes, reversible things you just do (kind did, with a tool marked on your own): file, log, plan, move his own tasks. He sees them with Undo.
- Anything that costs money, reaches a new person, deletes something or can't be undone is an ask (kind ask, with the tool and exact args), never a did.
- A nudge is one short line to him, in your voice (warm, direct, a little witty), saying exactly what you need. Only when it clearly helps now; never twice for the same thing; never during sleep.
- noticed: a gap you see but won't bother him with yet.
- Never invent facts, numbers or times. Use only what's above. Ids like t12 are for args only, never in his words.
- At most three items. Prefer zero. Use the candidate key in "key" when an item answers one; list keys not worth saying in "dismiss".
- Titles under 70 characters. Text one or two short sentences.
Reply fields: note is one short sentence for her day log, under 90 characters, about what you checked or found (no ids, no lists);
items has 0 to 3 entries (kind, app, title, text, and tool with args when one acts); dismiss lists candidate keys not worth saying.`;

/** Her day's line for a beat: the first sentence, under ~110 characters, cut at a word. */
export function shortNote(t: string) {
  let s = t.replace(/\s+/g, " ").trim();
  const first = s.split(/(?<=[.!?])\s+/)[0] ?? s;
  if (first.length >= 20) s = first;
  if (s.length > 110) s = `${s.slice(0, 108).replace(/\s+\S*$/, "")}…`;
  return s;
}
export type BeatResult = { beat: any; items: any[]; kind: string; note: string; model: string; secs: number };
/** One heartbeat. force: run the model even when nothing moved (his "Check now"). */
export async function runHeartbeat(env: HbEnv, { force = false } = {}): Promise<BeatResult> {
  const t0 = env.now(), n = env.n, beatId = `hb_${t0.toString(36)}`, turn = `hb-${t0.toString(36)}`;
  const made: any[] = [];
  const log = env.log ?? (() => {});
  feedDb(n);
  const f = env.day();

  // 1a. after 22:00: tasks that can't happen before bed go to tomorrow, once a night, and he hears it in the morning
  if (f.rollable.length && !hasKey(n, `roll:${f.today}`, f.today)) {
    const tomorrow = addDays(f.today, 1), moved: string[] = [];
    for (const t of f.rollable.slice(0, 12)) {
      const r = await env.run("update_task", { id: t.id, due: tomorrow, schedule: null }, { turn: `rule-roll-${f.today}`, beat: beatId, why: t.why }).catch((e: any) => ({ error: String(e?.message ?? e) }));
      if (!r?.error) moved.push(t.title);
    }
    if (moved.length) {
      const it = addItem(n, { kind: "did", app: "tasks", title: `Moved ${moved.length} task${moved.length > 1 ? "s" : ""} to tomorrow`, text: `${moved.slice(0, 4).join(", ")}${moved.length > 4 ? ` and ${moved.length - 4} more` : ""}: they wouldn't fit before bed.`,
        source: "rule", beat: beatId, turn: `rule-roll-${f.today}`, key: `roll:${f.today}`, undo: { turn: `rule-roll-${f.today}` } }, t0);
      made.push(it);
      env.holdForMorning(`Last night I moved ${moved.length === 1 ? `"${moved[0]}"` : `${moved.length} things`} to today because ${moved.length === 1 ? "it" : "they"} wouldn't fit before bed${moved.length > 1 ? `: ${moved.slice(0, 3).join(", ")}${moved.length > 3 ? ", and more" : ""}` : ""}. Undo is in my day if you'd rather not.`);
    }
  }

  // 1b. the apps, the candidates, streaks at risk
  let sum: Record<string, any> = {};
  try { sum = await env.summaries(); } catch (e) { log(`summaries failed: ${e}`); }
  // A streak comes as `streaks: [...]` or one `streak: {...}` (Growth's journal); `due` is Unix seconds or ms, an ISO
  // time or "HH:MM" today; an app may pin its own ladder: [["21:00","nudge"],["22:00","alarm"],...].
  const timeOf = (v: unknown) => typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : typeof v === "string" && /^\d\d:\d\d$/.test(v) ? Date.parse(`${f.today}T${v}:00+05:30`) : Date.parse(String(v ?? ""));
  for (const [app, s] of Object.entries(sum)) {
    const list = [...(Array.isArray(s?.streaks) ? s.streaks : []), ...(s?.streak && typeof s.streak === "object" && !Array.isArray(s.streak) ? [{ id: "streak", label: app === "growth" ? "journal" : app, ...s.streak }] : [])];
    for (const st of list) {
      const count = Number(st?.n ?? st?.current ?? 0);
      if (!st || st.today || !st.atRisk || st.private || !count) continue;
      const key = `streak:${app}:${st.id ?? st.label}:${f.today}`;
      if (hasKey(n, key, f.today)) continue;
      const due = timeOf(st.due);
      const pin = Array.isArray(st.ladder) ? st.ladder : [];
      const pinned = (kind: string) => { const x = pin.find((r: any) => Array.isArray(r) && r[1] === kind); return x ? timeOf(x[0]) : NaN; };
      const alarmAt = Number.isFinite(pinned("alarm")) ? pinned("alarm") : Number.isFinite(due) ? Math.max(t0 + 5 * 60000, due - 75 * 60000) : null;
      const firstAt = Number.isFinite(pinned("nudge")) ? pinned("nudge") : alarmAt ? alarmAt - 30 * 60000 : t0;
      const it = addItem(n, { kind: "alarm", app, title: `Save your ${count}-day ${String(st.label ?? "streak").toLowerCase()} streak`, text: st.line ?? `It breaks ${Number.isFinite(due) ? `at ${istHm(due)}` : "tonight"}. Two minutes now saves it.`,
        source: "rule", beat: beatId, key, urgency: 70, ceiling: ceilingFor(env.ladder, app), rung: 0, next_at: iso(Math.max(t0, firstAt)), alarm_at: alarmAt ? iso(alarmAt) : null,
        meta: { streak: st, argue: `You've done ${count} days in a row. Snoozing again is how streaks end; it's two minutes.` } }, t0);
      made.push(it);
    }
  }
  // 1c. what she held back (he was in class, asleep, or her budget was spent) she says now, once, while it still matters
  if (!env.quiet && !env.busy) {
    const b0 = env.budget();
    const held = (n.query("SELECT id FROM feed WHERE day = ? AND kind = 'noticed' AND status = 'done' AND meta LIKE '%\"held\"%' AND meta NOT LIKE '%\"delivered\"%' ORDER BY at").all(f.today) as any[])
      .map((r) => getItem(n, r.id)!).filter((x) => x && t0 - Date.parse(x.at) < 90 * 60000 && x.meta?.say);
    const first = held[0];
    if (first && b0.left > 0) {
      const msg = env.say(first.meta.say, { feed: true, beat: beatId, held: first.id });
      made.push(updateItem(n, first.id, { kind: "nudge", status: "open", rung: 1, ceiling: ceilingFor(env.ladder, first.app), next_at: iso(t0 + env.ladder.step * 60000),
        beat: beatId, meta: { ...first.meta, delivered: iso(t0), message: msg } }, t0)!);
    }
  }
  const cands = env.candidates();
  const open = openItems(n);
  // What would make her think: fresh candidates (deduped against what she already said or passed on), or the apps'
  // gaps changing. A summary line moving on its own (protein 40 → 60 g) isn't worth a model call.
  const gapSig = sha(JSON.stringify(Object.entries(sum).map(([k, v]) => [k, v?.gaps ?? null])));
  const sig = sha(JSON.stringify({ c: cands.map((x) => `${x.key}:${x.tier}`), g: gapSig, o: open.map((x) => x.id), r: made.map((x) => x.id) }));
  const prev = lastBeat(n);
  const hasGaps = Object.values(sum).some((v) => v?.gaps?.length);
  const gapsMoved = hasGaps && (!prev || prev.meta?.gaps !== gapSig || prev.day !== f.today);
  const moved = force || cands.length > 0 || gapsMoved;
  const checked = Object.keys(sum).length + 1;

  // 2. nothing moved: a quiet dot
  if (!moved) {
    const note = env.quiet ? `Quiet: ${env.quiet}` : made.length ? made.map((x) => x.title).join("; ") : "All on track";
    const beat = addBeat(n, { id: beatId, at: iso(t0), kind: made.length ? "did" : "ok", checked, secs: (env.now() - t0) / 1000, model: "rules only", note, found: made.length, sig, meta: { apps: Object.keys(sum), gaps: gapSig } }, t0);
    return { beat, items: made, kind: beat.kind, note, model: "rules only", secs: beat.secs ?? 0 };
  }

  // 3. the model
  const budget = env.budget();
  const tools = (await env.tools().catch(() => [])).slice(0, 60);
  let out: any = null, err: string | null = null;
  if (env.model) {
    try { out = await env.model({ system: SYSTEM(env), prompt: prompt(env, f, sum, cands, tools, open, budget), schema: SCHEMA }); }
    catch (e: any) { err = String(e?.message ?? e).slice(0, 200); log(`model failed: ${err}`); }
  }
  env.markOffered(cands);
  const items: BeatItem[] = Array.isArray(out?.items) ? out.items.slice(0, 3) : [];
  const keys = new Set(cands.map((x) => x.key));
  const allowed = new Set([...tools.map((t) => t.name), ...CORE_FOR_BEATS]);
  const modeOf = (name: string) => tools.find((t) => t.name === name)?.mode ?? (CORE_FOR_BEATS.includes(name) ? "auto" : "off");
  const sent: string[] = [];

  // 4. the policy acts, item by item
  for (const it of items) {
    const app = String(it.app ?? (it.tool ? (tools.find((t) => t.name === it.tool)?.app ?? "tasks") : "agent")).toLowerCase().slice(0, 30);
    const title = String(it.title ?? "").trim().slice(0, 120), text = it.text ? String(it.text).trim().slice(0, 400) : null;
    if (!title) continue;
    const key = it.key && keys.has(it.key) ? it.key : null;
    if (key && hasKey(n, `cand:${key}`)) continue;
    const ikey = key ? `cand:${key}` : `gap:${app}:${sha(title.toLowerCase())}`;
    if (hasKey(n, ikey, f.today)) continue;
    const tool = it.tool && allowed.has(it.tool) ? it.tool : null;
    if ((it.kind === "did" || it.kind === "ask") && tool) {
      const r = await env.run(tool, it.args ?? {}, { turn, beat: beatId, title, why: text ?? undefined }).catch((e: any) => ({ error: String(e?.message ?? e) }));
      if (r?.needs_yes) {
        // the policy made it an ask (its own mirror in her day): give it her words, the ladder and the beat
        const ask = (n.query("SELECT id FROM feed WHERE approval = ?").get(r.approval) as any)?.id;
        if (ask) made.push(updateItem(n, ask, { title: title.endsWith("?") ? title : `${title}?`, text, source: "heartbeat", beat: beatId, key: ikey, urgency: it.urgency ?? 55,
          ceiling: ceilingFor(env.ladder, app), rung: 0, next_at: iso(t0), yes: it.yes ?? "Yes, do it", no: it.no ?? "Not now" }, t0));
      } else if (r?.error) {
        made.push(addItem(n, { kind: "noticed", app, title, text: `${text ? `${text} ` : ""}(couldn't do it: ${String(r.error).slice(0, 120)})`, source: "heartbeat", beat: beatId, key: ikey }, t0));
      } else if (r?.feed || r?.declined) {
        const d = r.feed ? updateItem(n, r.feed, { beat: beatId, key: ikey, ...(text ? { text } : {}) }, t0) : null;
        if (d) made.push(d);
      } else {
        // a core tool: its changes carry Undo; the item points at this beat's turn
        made.push(addItem(n, { kind: "did", app, title, text, source: "heartbeat", beat: beatId, turn, tool, args: it.args ?? {}, result: r, key: ikey, undo: modeOf(tool) === "auto" ? { turn } : null }, t0));
      }
      if (key) sent.push(key);
      continue;
    }
    if (it.kind === "ask") {
      // a question with no tool: one tap says yes (in chat, so her brain does it) or not now
      made.push(addItem(n, { kind: "ask", app, title: title.endsWith("?") ? title : `${title}?`, text, source: "heartbeat", beat: beatId, key: ikey, urgency: it.urgency ?? 50,
        yes: it.yes ?? "Yes", no: it.no ?? "Not now", ceiling: ceilingFor(env.ladder, app), rung: 0, next_at: iso(t0), meta: { chat: true } }, t0));
      if (key) sent.push(key);
      continue;
    }
    if (it.kind === "nudge") {
      const urgent = (it.urgency ?? 0) >= 90;
      const canSpeak = !env.quiet && budget.left > 0 && (budget.gapOk || urgent) && (!env.busy || urgent);
      const line = text ? `${title}. ${text}`.replace(/\.\./g, ".") : title;
      // held, not dropped: the first beat after class (or once the budget allows) says it, if it still matters
      if (!canSpeak) { made.push(addItem(n, { kind: "noticed", app, title, text, source: "heartbeat", beat: beatId, key: ikey, urgency: it.urgency ?? 50, meta: { held: env.quiet ?? env.busy ?? "budget", say: line } }, t0)); continue; }
      const msg = env.say(line, { feed: true, beat: beatId });
      made.push(addItem(n, { kind: "nudge", app, title, text, source: "heartbeat", beat: beatId, key: ikey, urgency: it.urgency ?? 50,
        ceiling: ceilingFor(env.ladder, app), rung: 1, next_at: iso(t0 + env.ladder.step * 60000), meta: { message: msg } }, t0));
      budget.left -= 1; budget.gapOk = false;
      if (key) sent.push(key);
      continue;
    }
    made.push(addItem(n, { kind: "noticed", app, title, text, source: "heartbeat", beat: beatId, key: ikey }, t0));
  }
  if (sent.length) env.markSent(sent);
  const dismiss = Array.isArray(out?.dismiss) ? out.dismiss.map(String).filter((k: string) => keys.has(k)) : [];
  if (dismiss.length) env.markDismissed(dismiss);
  const kinds = new Set(made.map((x) => x.kind));
  const kind = kinds.has("ask") ? "ask" : kinds.has("nudge") || kinds.has("alarm") ? "nudge" : kinds.has("did") ? "did" : made.length ? "noticed" : "ok";
  const note = shortNote(String(out?.note ?? (err ? "Couldn't think it through; rules only this time" : "All on track")));
  const secs = (env.now() - t0) / 1000;
  const beat = addBeat(n, { id: beatId, at: iso(t0), kind, checked, secs, model: env.model && !err ? "haiku" : "rules only", note, found: made.length, sig, error: err, meta: { apps: Object.keys(sum), candidates: cands.length, gaps: gapSig } }, t0);
  return { beat, items: made, kind, note, model: beat.model ?? "rules only", secs };
}

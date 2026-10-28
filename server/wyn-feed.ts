// Her day, in her own SQLite file (wyn.db): every heartbeat she ran, and every thing she did, noticed or asked, so
// nothing she does is invisible (DECISIONS 2). One row per item:
//   did      she did it on her own (a tool that runs alone, a rule like moving late tasks), with Undo where possible
//   noticed  she saw a gap and decided it wasn't worth saying (quiet; shown in her day only)
//   nudge    she told him something (a chat line and a notification), climbing the persistence ladder until seen
//   ask      she needs his yes: one tap runs the exact action she asked about (or declines it)
//   alarm    a deadline that rings (a streak, a block): the phone schedules it with AlarmKit
//   call     she rang him (the top rung)
// The persistence ladder: 0 off · 1 notification · 2 banner · 3 alarm · 4 call. Each app has a ceiling (how high she
// may climb there); an unseen item climbs one rung every `step` minutes, never while he sleeps, never past the ceiling,
// and class or a call holds it. `ladderDue` is pure (the decisions); wyn.ts performs them.
// Also here: breathing sessions (the orb's hold-to-breathe), which Soul and Body read.
import type { Database } from "bun:sqlite";
import { OFFSET } from "./store";

type Db = Database;
const iso = (ms = Date.now()) => new Date(ms).toISOString();
export const istDay = (ms = Date.now()) => new Date(ms + OFFSET * 60000).toISOString().slice(0, 10);
export const istHm = (ms = Date.now()) => new Date(ms + OFFSET * 60000).toISOString().slice(11, 16);
const j = (v: unknown) => { try { return v == null || v === "" ? null : JSON.parse(String(v)); } catch { return null; } };
export const newId = (p = "f") => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const KINDS = ["did", "noticed", "nudge", "ask", "alarm", "call"] as const;
export type Kind = (typeof KINDS)[number];
export type Item = {
  id: string; at: string; day: string; kind: Kind; app: string | null; title: string; text: string | null; source: string;
  beat: string | null; turn: string | null; tool: string | null; args: any; result: any; status: string; undo: any;
  rung: number; ceiling: number; next_at: string | null; alarm_at: string | null; seen_at: string | null; snoozes: number;
  approval: string | null; request: string | null; yes: string | null; no: string | null; key: string | null; urgency: number;
  meta: any; decided_at: string | null; updated_at: string | null;
};

export function feedDb(n: Db) {
  n.exec(`CREATE TABLE IF NOT EXISTS feed (id TEXT PRIMARY KEY, at TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, app TEXT,
      title TEXT NOT NULL, text TEXT, source TEXT NOT NULL, beat TEXT, turn TEXT, tool TEXT, args TEXT, result TEXT,
      status TEXT NOT NULL DEFAULT 'open', undo TEXT, rung INTEGER NOT NULL DEFAULT 0, ceiling INTEGER NOT NULL DEFAULT 0,
      next_at TEXT, alarm_at TEXT, seen_at TEXT, snoozes INTEGER NOT NULL DEFAULT 0, approval TEXT, request TEXT,
      yes TEXT, no TEXT, key TEXT, urgency INTEGER NOT NULL DEFAULT 50, meta TEXT, decided_at TEXT, updated_at TEXT);
    CREATE INDEX IF NOT EXISTS feed_day ON feed(day);
    CREATE INDEX IF NOT EXISTS feed_open ON feed(status, kind);
    CREATE TABLE IF NOT EXISTS beats (id TEXT PRIMARY KEY, at TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, checked INTEGER NOT NULL DEFAULT 0,
      secs REAL, model TEXT, note TEXT, found INTEGER NOT NULL DEFAULT 0, sig TEXT, error TEXT, meta TEXT);
    CREATE INDEX IF NOT EXISTS beats_day ON beats(day);
    CREATE TABLE IF NOT EXISTS breaths (id INTEGER PRIMARY KEY, at TEXT NOT NULL, day TEXT NOT NULL, pattern TEXT, rounds INTEGER, seconds INTEGER,
      completed INTEGER NOT NULL DEFAULT 0, source TEXT, client_id TEXT UNIQUE);`);
}

const COLS = ["id", "at", "day", "kind", "app", "title", "text", "source", "beat", "turn", "tool", "args", "result", "status", "undo", "rung", "ceiling",
  "next_at", "alarm_at", "seen_at", "snoozes", "approval", "request", "yes", "no", "key", "urgency", "meta", "decided_at", "updated_at"];
const JSONCOLS = new Set(["args", "result", "undo", "meta"]);
const rowOf = (r: any): Item | null => r ? ({ ...r, args: j(r.args), result: j(r.result), undo: j(r.undo), meta: j(r.meta) }) : null;

/** A new item. Text is cut to sane lengths; JSON fields are stored as JSON. */
export function addItem(n: Db, x: Partial<Item> & { kind: Kind; title: string; source: string }, now = Date.now()): Item {
  feedDb(n);
  const row: Record<string, unknown> = {
    id: x.id ?? newId(), at: x.at ?? iso(now), day: x.day ?? istDay(x.at ? Date.parse(x.at) : now), kind: x.kind, app: x.app ?? null,
    title: String(x.title).replace(/\s+/g, " ").trim().slice(0, 200), text: x.text == null ? null : String(x.text).trim().slice(0, 2000), source: x.source,
    beat: x.beat ?? null, turn: x.turn ?? null, tool: x.tool ?? null, args: x.args ?? null, result: x.result ?? null,
    status: x.status ?? (x.kind === "did" || x.kind === "noticed" ? "done" : "open"), undo: x.undo ?? null, rung: x.rung ?? 0, ceiling: x.ceiling ?? 0,
    next_at: x.next_at ?? null, alarm_at: x.alarm_at ?? null, seen_at: null, snoozes: 0, approval: x.approval ?? null, request: x.request ?? null,
    yes: x.yes ? String(x.yes).slice(0, 40) : null, no: x.no ? String(x.no).slice(0, 40) : null, key: x.key ?? null,
    urgency: Math.max(0, Math.min(100, Math.round(Number(x.urgency ?? 50)))), meta: x.meta ?? null, decided_at: null, updated_at: iso(now),
  };
  const vals = COLS.map((c) => (JSONCOLS.has(c) && row[c] != null ? JSON.stringify(row[c]) : row[c] ?? null));
  n.query(`INSERT OR REPLACE INTO feed (${COLS.join(", ")}) VALUES (${COLS.map(() => "?").join(", ")})`).run(...(vals as any[]));
  return getItem(n, row.id as string)!;
}
export function getItem(n: Db, id: string): Item | null { feedDb(n); return rowOf(n.query("SELECT * FROM feed WHERE id = ?").get(id)); }
export function updateItem(n: Db, id: string, patch: Partial<Item>, now = Date.now()): Item | null {
  feedDb(n);
  const keys = Object.keys(patch).filter((k) => COLS.includes(k) && k !== "id");
  if (!keys.length) return getItem(n, id);
  const vals = keys.map((k) => { const v = (patch as any)[k]; return JSONCOLS.has(k) && v != null ? JSON.stringify(v) : v ?? null; });
  n.query(`UPDATE feed SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...vals, iso(now), id);
  return getItem(n, id);
}
export const itemsOfDay = (n: Db, day: string) => { feedDb(n); return (n.query("SELECT * FROM feed WHERE day = ? ORDER BY at DESC").all(day) as any[]).map(rowOf) as Item[]; };
export const itemsOfTurn = (n: Db, turn: string) => { feedDb(n); return (n.query("SELECT * FROM feed WHERE turn = ? ORDER BY at").all(turn) as any[]).map(rowOf) as Item[]; };
/** What still waits on him, oldest first (asks and nudges he hasn't dealt with, from any day in the last week). */
export function openItems(n: Db, kinds: Kind[] = ["ask", "nudge", "alarm"], now = Date.now()) {
  feedDb(n);
  return (n.query(`SELECT * FROM feed WHERE status = 'open' AND kind IN (${kinds.map(() => "?").join(", ")}) AND at > ? ORDER BY at`)
    .all(...kinds, iso(now - 7 * 864e5)) as any[]).map(rowOf) as Item[];
}
/** An item with this rule key already made (today, or still open): rules never repeat themselves. */
export function hasKey(n: Db, key: string, day = istDay()) {
  feedDb(n);
  return !!n.query("SELECT 1 FROM feed WHERE key = ? AND (day = ? OR status = 'open') LIMIT 1").get(key, day);
}

/** The app's shape: times in India time as HH:MM next to the ISO, and what the buttons do. */
export function shapeItem(x: Item, now = Date.now()) {
  const live = x.status === "open";
  return {
    id: x.id, at: x.at, time: istHm(Date.parse(x.at)), day: x.day, kind: x.kind, app: x.app, title: x.title, text: x.text, source: x.source,
    beat: x.beat, turn: x.turn, tool: x.tool, status: x.status, urgency: x.urgency,
    undo: x.kind === "did" && x.status === "done" && !!x.undo, undone: x.status === "undone",
    ask: x.kind === "ask" ? { yes: x.yes || "Yes", no: x.no || "Not now", approval: x.approval, request: x.request, draft: x.meta?.draft ?? null } : null,
    ladder: x.ceiling ? { rung: x.rung, ceiling: x.ceiling, next: live ? x.next_at : null, alarmAt: x.alarm_at, seen: !!x.seen_at, snoozes: x.snoozes } : null,
    result: x.kind === "did" || x.status === "done" || x.status === "yes" ? brief(x.result) : null,
    meta: x.meta ? { ...x.meta } : null,
    age: Math.max(0, Math.round((now - Date.parse(x.at)) / 60000)),
  };
}
/** A tool result, short enough for a card. */
function brief(r: unknown) {
  if (r == null) return null;
  const s = typeof r === "string" ? r : JSON.stringify(r);
  return s.length > 400 ? `${s.slice(0, 399)}…` : s;
}

// ── heartbeats ─────────────────────────────────────────────────────────────
export type Beat = { id: string; at: string; day: string; kind: string; checked: number; secs: number | null; model: string | null; note: string | null; found: number; sig: string | null; error: string | null; meta: any };
export function addBeat(n: Db, b: Partial<Beat> & { kind: string }, now = Date.now()): Beat {
  feedDb(n);
  const id = b.id ?? newId("hb"), at = b.at ?? iso(now);
  n.query("INSERT OR REPLACE INTO beats (id, at, day, kind, checked, secs, model, note, found, sig, error, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, at, b.day ?? istDay(Date.parse(at)), b.kind, b.checked ?? 0, b.secs ?? null, b.model ?? null, b.note ? String(b.note).slice(0, 300) : null,
      b.found ?? 0, b.sig ?? null, b.error ? String(b.error).slice(0, 300) : null, b.meta ? JSON.stringify(b.meta) : null);
  return beatOf(n, id)!;
}
const beatRow = (r: any): Beat | null => r ? ({ ...r, meta: j(r.meta) }) : null;
export const beatOf = (n: Db, id: string) => { feedDb(n); return beatRow(n.query("SELECT * FROM beats WHERE id = ?").get(id)); };
export const beatsOfDay = (n: Db, day: string) => { feedDb(n); return (n.query("SELECT * FROM beats WHERE day = ? ORDER BY at").all(day) as any[]).map(beatRow) as Beat[]; };
export const lastBeat = (n: Db) => { feedDb(n); return beatRow(n.query("SELECT * FROM beats ORDER BY at DESC LIMIT 1").get()); };
export const shapeBeat = (b: Beat) => ({ id: b.id, at: b.at, time: istHm(Date.parse(b.at)), kind: b.kind, checked: b.checked, secs: b.secs, model: b.model, note: b.note, found: b.found, error: b.error ? true : undefined, apps: b.meta?.apps ?? undefined });

// ── breathing ──────────────────────────────────────────────────────────────
export function addBreath(n: Db, b: { pattern?: string; rounds?: number; seconds?: number; completed?: boolean; at?: string; source?: string; id?: string }) {
  feedDb(n);
  const at = b.at && Number.isFinite(Date.parse(b.at)) ? new Date(b.at).toISOString() : iso();
  const clientId = b.id ? String(b.id).slice(0, 80) : null;
  if (clientId) { const had = n.query("SELECT * FROM breaths WHERE client_id = ?").get(clientId) as any; if (had) return shapeBreath(had); }
  const r = n.query("INSERT INTO breaths (at, day, pattern, rounds, seconds, completed, source, client_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
    .get(at, istDay(Date.parse(at)), String(b.pattern ?? "box").slice(0, 20), Math.max(0, Math.round(Number(b.rounds) || 0)),
      Math.max(0, Math.min(3600, Math.round(Number(b.seconds) || 0))), b.completed ? 1 : 0, String(b.source ?? "orb").slice(0, 20), clientId) as any;
  return shapeBreath(r);
}
const shapeBreath = (r: any) => ({ id: r.id, at: r.at, day: r.day, pattern: r.pattern, rounds: r.rounds, seconds: r.seconds, completed: !!r.completed, source: r.source });
export function breathsSince(n: Db, days = 7, now = Date.now()) {
  feedDb(n);
  const rows = (n.query("SELECT * FROM breaths WHERE at >= ? ORDER BY at DESC").all(iso(now - days * 864e5)) as any[]).map(shapeBreath);
  return { sessions: rows, minutes: Math.round(rows.reduce((a, r) => a + r.seconds, 0) / 6) / 10, today: rows.filter((r) => r.day === istDay(now)).length };
}

// ── the persistence ladder ─────────────────────────────────────────────────
export const RUNGS = ["off", "notification", "banner", "alarm", "call"] as const;
/** How far she may climb per app (the prototype's defaults): a streak in Growth can end in a call, Money only notifies. */
export const CEILING: Record<string, number> = { growth: 4, body: 2, soul: 3, mind: 2, mission: 2, money: 1, family: 1, romance: 1, friends: 1, people: 1,
  tasks: 3, calendar: 3, work: 2, content: 2, agent: 2 };
export const DEFAULT_CEILING = 1;
export type LadderPrefs = { ceilings: Record<string, number>; step: number; quiet: { sleep: boolean; class: boolean } };
const prefGet = (n: Db, k: string) => ((n.query("SELECT value FROM prefs WHERE key = ?").get(k) as any)?.value ?? null) as string | null;
const prefSet = (n: Db, k: string, v: string) => n.query("INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
export function ladderPrefs(n: Db): LadderPrefs {
  const own = j(prefGet(n, "ladder.ceilings")) ?? {};
  const q = j(prefGet(n, "ladder.quiet")) ?? {};
  const step = Number(prefGet(n, "ladder.step"));
  return { ceilings: { ...CEILING, ...own }, step: step >= 5 && step <= 120 ? step : 15, quiet: { sleep: q.sleep !== false, class: q.class !== false } };
}
export function setLadder(n: Db, b: { app?: string; ceiling?: number; step?: number; quiet?: { sleep?: boolean; class?: boolean } }) {
  if (b.app != null) {
    const app = String(b.app).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30);
    const c = Math.round(Number(b.ceiling));
    if (!app || !(c >= 0 && c <= 4)) throw new Error("Send { app, ceiling 0-4 }.");
    const own = j(prefGet(n, "ladder.ceilings")) ?? {};
    own[app] = c;
    prefSet(n, "ladder.ceilings", JSON.stringify(own));
  }
  if (b.step != null) { const s = Math.round(Number(b.step)); if (!(s >= 5 && s <= 120)) throw new Error("step is 5-120 minutes."); prefSet(n, "ladder.step", String(s)); }
  if (b.quiet) { const q = { ...ladderPrefs(n).quiet, ...Object.fromEntries(Object.entries(b.quiet).filter(([, v]) => typeof v === "boolean")) }; prefSet(n, "ladder.quiet", JSON.stringify(q)); }
  return ladderPrefs(n);
}
export const ceilingFor = (p: LadderPrefs, app: string | null) => (app && p.ceilings[app] != null ? p.ceilings[app] : DEFAULT_CEILING);

/** The world the ladder reads: is he asleep (and when does he wake), in class (until when), on a call. */
export type LadderWorld = { now: number; asleep: boolean; wakeAt: number | null; busyUntil: number | null; inCall: boolean; step: number };
export type Climb = { id: string; rung: number; title: string; text: string | null; app: string | null; kind: Kind; urgency: number };
/**
 * Which items climb now, and where the rest wait till. Pure: returns the climbs and the next_at updates; the caller
 * performs each climb (push, banner flag, alarm, ring) and saves the updates.
 * - Seen, answered or closed items never climb. A ceiling of 0 means she only logs it.
 * - Asleep: nothing climbs; it waits till he wakes. On a call: five minutes. In class (or a busy block): rungs past the
 *   notification wait till it ends, unless it's urgent (90+).
 * - An alarm with alarm_at rings at that time (rung 3) whatever the step, if the ceiling allows an alarm.
 */
export function ladderDue(items: Item[], w: LadderWorld) {
  const climbs: Climb[] = [], waits: { id: string; next_at: string }[] = [], expired: string[] = [];
  for (const x of items) {
    if (x.status !== "open" || x.seen_at || !x.ceiling) continue;
    // a nudge is about now: after 90 minutes it stops climbing (the moment has passed); an alarm two hours after its time
    if (x.kind === "nudge" && w.now - Date.parse(x.at) > 90 * 60000) { expired.push(x.id); continue; }
    if (x.kind === "alarm" && x.alarm_at && w.now - Date.parse(x.alarm_at) > 2 * 3600_000) { expired.push(x.id); continue; }
    const alarmNow = !!x.alarm_at && Date.parse(x.alarm_at) <= w.now && x.rung < 3 && x.ceiling >= 3;
    const due = alarmNow || (!!x.next_at && Date.parse(x.next_at) <= w.now && x.rung < x.ceiling);
    if (!due) continue;
    const next = alarmNow ? 3 : x.rung + 1;
    if (w.asleep) { waits.push({ id: x.id, next_at: iso(Math.max(w.now + 5 * 60000, (w.wakeAt ?? w.now) + 10 * 60000)) }); continue; }
    if (w.inCall) { waits.push({ id: x.id, next_at: iso(w.now + 5 * 60000) }); continue; }
    if (w.busyUntil && next >= 2 && x.urgency < 90) { waits.push({ id: x.id, next_at: iso(w.busyUntil + 2 * 60000) }); continue; }
    climbs.push({ id: x.id, rung: Math.min(next, x.ceiling), title: x.title, text: x.text, app: x.app, kind: x.kind, urgency: x.urgency });
    waits.push({ id: x.id, next_at: iso(w.now + w.step * 60000) });
  }
  return { climbs, waits, expired };
}
/** He saw it (opened the banner, the notification, her day): it stops climbing. */
export function markSeen(n: Db, ids: string[], now = Date.now()) {
  feedDb(n);
  for (const id of ids.slice(0, 50)) n.query("UPDATE feed SET seen_at = coalesce(seen_at, ?), updated_at = ? WHERE id = ?").run(iso(now), iso(now), String(id));
}
/** Snooze: once is fine; the second time she argues (the line comes back for the alarm screen). */
export function snoozeItem(n: Db, id: string, minutes: number, now = Date.now()) {
  const x = getItem(n, id);
  if (!x) return null;
  const m = Math.max(1, Math.min(240, Math.round(minutes) || 10));
  const after = updateItem(n, id, { snoozes: x.snoozes + 1, next_at: iso(now + m * 60000), seen_at: null, ...(x.alarm_at ? { alarm_at: iso(now + m * 60000) } : {}) }, now)!;
  const argue = after.snoozes >= 2 ? (x.meta?.argue as string | undefined) ?? `That's snooze number ${after.snoozes}. It takes two minutes now, and I'll stop asking.` : null;
  return { item: after, minutes: m, argue };
}

// ── what she changed in chat and on calls (the changes table), as did items ──
/** Core-data changes from her chat and calls today (rows with Undo), shaped like feed items. Heartbeat and tap turns
 * have their own feed rows already, so they're left out here. */
export function changesOfDay(n: Db, day: string) {
  const from = iso(Date.parse(`${day}T00:00:00+05:30`)), to = iso(Date.parse(`${day}T00:00:00+05:30`) + 864e5);
  const rows = n.query("SELECT id, turn, label, tbl, at, undone_at FROM changes WHERE at >= ? AND at < ? ORDER BY at DESC").all(from, to) as any[];
  return rows.filter((r) => !/^(hb|rule|tap|tool)-/.test(String(r.turn))).map((r) => ({
    id: `c${r.id}`, at: r.at, time: istHm(Date.parse(r.at)), day, kind: "did" as const, app: TBL_APP[r.tbl] ?? "tasks", title: r.label, text: null,
    source: String(r.turn).startsWith("call") ? "call" : "chat", beat: null, turn: r.turn, tool: null, status: r.undone_at ? "undone" : "done", urgency: 50,
    undo: !r.undone_at, undone: !!r.undone_at, ask: null, ladder: null, result: null, meta: { change: r.id }, age: 0,
  }));
}
const TBL_APP: Record<string, string> = { tasks: "tasks", goals: "mission", event_overrides: "calendar", settings: "body", ideas: "work", wyn_calendar: "calendar" };

/** Which app a core tool belongs to (for tiles and per-app autonomy). */
export const CORE_APP: Record<string, string> = {
  overview: "tasks", find_tasks: "tasks", add_task: "tasks", update_task: "tasks", drop_task: "tasks", goals: "mission", add_goal: "mission", update_goal: "mission",
  set_sleep: "body", life: "life", remember: "memory", update_memory: "memory", forget: "memory", recall: "memory", memories: "memory",
  brain_ask: "brain", brain_search: "brain", brain_read: "brain", brain_capture: "brain", sessions: "work", session_read: "work", session_send: "work",
  session_new: "work", dispatches: "work", update_soul: "agent", journal: "growth", read_journal: "growth", schedule: "agent", set_preferences: "agent",
  answer_agent: "agent", give_to_claude: "work", send_whatsapp: "agent", add_idea: "work", update_idea: "work", list_ideas: "work", list_calls: "agent",
  read_call: "agent", onboard_me: "agent", calendar_find: "calendar", calendar_add: "calendar", calendar_move: "calendar", calendar_cancel: "calendar", my_work: "work",
};

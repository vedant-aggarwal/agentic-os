// Wyn's hands: the actions she can take on one person's Agentic OS. The same tools serve her chat brain
// (Codex, through the MCP server in wyn-mcp.ts) and her voice on calls (OpenAI realtime, in wyn.ts).
// Every write is recorded with its before and after row, so the app can show it and undo it.
import { Database } from "bun:sqlite";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError, istDate, OFFSET, type Store } from "./store";
import { dayModel } from "./proposals";
import { forget, LONG_KINDS, memoryList, migrateMemory, recall, remember, SHORT_KINDS, updateMemory } from "./wyn-memory";
import { findSession, listSessions, readSession } from "./sessions";
import { BRAIN_TOOLS } from "./wyn-brain-tools";
import { WA_TOOLS } from "./wyn-whatsapp-tool";
import { CAL_TOOLS, calendarUndo } from "./wyn-calendar";
import { requireYes } from "./wyn-policy";
import { WORK_TOOLS } from "./wyn-proactive";
import { ONBOARD_TOOLS } from "./wyn-onboard";

const iso = () => new Date().toISOString();
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}`;
const local = (isoStr: string) => new Date(Date.parse(isoStr) + OFFSET * 60000).toISOString().slice(0, 16).replace("T", " ");
const addDays = (date: string, n: number) => istDate(new Date(Date.parse(`${date}T12:00:00+05:30`) + n * 864e5));
const isDay = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s: unknown) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const bad = (m: string) => new ApiError(400, m);

/** Wyn's own data for one person: chat, changes (for Undo), memories, journal, calls, schedule, preferences. */
export function openWynDb(dir: string) {
  mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "wyn.db"), { create: true });
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, role TEXT NOT NULL, text TEXT NOT NULL, at TEXT NOT NULL, turn TEXT, meta TEXT);
    CREATE TABLE IF NOT EXISTS changes (id INTEGER PRIMARY KEY, turn TEXT NOT NULL, label TEXT NOT NULL, tbl TEXT NOT NULL, row_key TEXT NOT NULL,
      before TEXT, after TEXT, at TEXT NOT NULL, undone_at TEXT);
    CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY, text TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY, date TEXT NOT NULL, text TEXT NOT NULL, mood TEXT, source TEXT, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, direction TEXT, reason TEXT, status TEXT, started_at TEXT, ended_at TEXT, seconds INTEGER,
      model TEXT, usage TEXT, cost_usd REAL, transcript TEXT, summary TEXT, actions TEXT);
    CREATE TABLE IF NOT EXISTS schedule (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, at TEXT NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL, fired_at TEXT);
    CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS devices (token TEXT PRIMARY KEY, kind TEXT NOT NULL, at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_requests (id TEXT PRIMARY KEY, source TEXT NOT NULL, question TEXT NOT NULL, context TEXT, urgency TEXT NOT NULL,
      status TEXT NOT NULL, action TEXT, why TEXT, say TEXT, answer TEXT, incoming_id TEXT, created_at TEXT NOT NULL, decided_at TEXT, answered_at TEXT);`);
  migrateMemory(db);
  // Call requests from agents (mode call), the call that covered them, and how many times Wyn tried.
  const askCols = new Set((db.query("PRAGMA table_info(agent_requests)").all() as any[]).map((c) => c.name));
  if (!askCols.has("mode")) db.exec("ALTER TABLE agent_requests ADD COLUMN mode TEXT NOT NULL DEFAULT 'ask'");
  if (!askCols.has("call_id")) db.exec("ALTER TABLE agent_requests ADD COLUMN call_id TEXT");
  if (!askCols.has("attempts")) db.exec("ALTER TABLE agent_requests ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0");
  // Prompts Wyn hands to Claude and Codex sessions; the dispatcher in wyn.ts runs them.
  db.exec(`CREATE TABLE IF NOT EXISTS dispatches (id TEXT PRIMARY KEY, tool TEXT NOT NULL, session_id TEXT, app_id TEXT, title TEXT, cwd TEXT,
    prompt TEXT NOT NULL, via TEXT NOT NULL, status TEXT NOT NULL, origin TEXT, result TEXT, error TEXT, path TEXT,
    created_at TEXT NOT NULL, sent_at TEXT, done_at TEXT)`);
  // Sessions running the wyn plugin: SessionStart says hello, the listener polls, Stop sends the last reply.
  db.exec(`CREATE TABLE IF NOT EXISTS session_hooks (session_id TEXT PRIMARY KEY, cwd TEXT, transcript TEXT, source TEXT, hello_at TEXT,
    listener TEXT, listening_at TEXT, last_reply TEXT, last_reply_at TEXT)`);
  return db;
}
export type WynDb = ReturnType<typeof openWynDb>;

export const PREF_DEFAULTS: Record<string, string> = {
  name: "Wyn",
  voice: "marin",
  tone: "Warm and direct, like a close friend who knows the plan. Short sentences. Mixes in Hindi words when the user does.",
  morning_call: "07:30",
  night_call: "22:15",
  proactive: "on",
  snooze: "15",
  // Models (choices in wyn-settings.ts). Empty stored values fall back to these.
  chat_model: process.env.WYN_MODEL || "gpt-6.1-sol",
  chat_effort: process.env.WYN_EFFORT || "high",
  call_model: process.env.WYN_VOICE_MODEL || "gpt-realtime-2.1-mini",
  call_voice: "marin",
  // 4o transcribe, not mini: of the three, only it follows the Roman-Hindi hint (call QA, 2026-10-21); +$0.003/min.
  call_transcribe_model: "gpt-4o-transcribe",
};
const MODEL_PREFS = ["chat_model", "chat_effort", "call_model", "call_voice", "call_transcribe_model"];
export function prefsOf(n: WynDb) {
  const out = { ...PREF_DEFAULTS };
  const rows = n.query("SELECT key, value FROM prefs").all() as any[];
  for (const r of rows) if (r.value !== "" || !MODEL_PREFS.includes(r.key)) out[r.key] = r.value;
  // call_voice took over from voice; a voice picked before it still counts, and the two stay equal.
  if (!rows.some((r) => r.key === "call_voice") && rows.some((r) => r.key === "voice")) out.call_voice = out.voice;
  out.voice = out.call_voice;
  return out;
}
export function setPref(n: WynDb, key: string, value: string) {
  if (key === "voice") key = "call_voice";
  n.query("INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

// Rows we can put back: the agentos tables Wyn writes to. wyn_calendar rows mirror Google Calendar (wyn-calendar.ts).
const KEYS: Record<string, string> = { tasks: "id", goals: "id", event_overrides: "event_id", settings: "key", ideas: "id", wyn_calendar: "id" };
const rowOf = (s: Store, tbl: string, key: string) => s.db.query(`SELECT * FROM ${tbl} WHERE ${KEYS[tbl]} = ?`).get(key) as any;

/** Undo one change, or every change of a turn, newest first. Skips rows that changed again since.
 * A calendar change puts Google back first; if Google refuses, the row stays and the change is skipped. */
export async function undo(s: Store, n: WynDb, { change, turn }: { change?: number; turn?: string }) {
  const rows = (change ? n.query("SELECT * FROM changes WHERE id = ? AND undone_at IS NULL").all(change)
    : n.query("SELECT * FROM changes WHERE turn = ? AND undone_at IS NULL ORDER BY id DESC").all(turn ?? "")) as any[];
  const done: string[] = [], skipped: string[] = [];
  for (const c of rows) {
    const cur = rowOf(s, c.tbl, c.row_key);
    if (JSON.stringify(cur ?? null) !== (c.after ?? "null")) { skipped.push(c.label); continue; }
    const before = c.before ? JSON.parse(c.before) : null;
    if (c.tbl === "wyn_calendar") {
      try { await calendarUndo(before, cur); }
      catch (e) { skipped.push(`${c.label} (Google Calendar didn't take it back: ${e instanceof Error ? e.message : e})`); continue; }
    }
    if (!before) s.db.query(`DELETE FROM ${c.tbl} WHERE ${KEYS[c.tbl]} = ?`).run(c.row_key);
    else {
      const cols = Object.keys(before);
      s.db.query(`INSERT OR REPLACE INTO ${c.tbl} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((k) => before[k]));
    }
    n.query("UPDATE changes SET undone_at = ? WHERE id = ?").run(iso(), c.id);
    done.push(c.label);
  }
  return { undone: done, skipped };
}

export type Ctx = { s: Store; n: WynDb; turn: string; user: { id: number; role: string }; dir?: string; give?: (taskId: string, b: any) => Promise<any>;
  /** give_to_claude jobs by task id (ai.ts agentsFor), for my_work. */
  agents?: () => Promise<Record<string, any>> };

// ── her soul: SOUL.md in her folder, from the template in this repo the first time ──
const SOUL_TEMPLATE = join(import.meta.dir, "wyn-soul.md");
export const soulPath = (dir: string) => join(dir, "SOUL.md");
export function readSoul(dir: string) {
  mkdirSync(dir, { recursive: true });
  if (!existsSync(soulPath(dir))) copyFileSync(SOUL_TEMPLATE, soulPath(dir));
  return readFileSync(soulPath(dir), "utf8");
}
export const defaultSoul = () => readFileSync(SOUL_TEMPLATE, "utf8");
/** Replaces the soul, keeping the old one next to it. */
export function writeSoul(dir: string, text: string) {
  const old = readSoul(dir);
  writeFileSync(join(dir, `SOUL.${new Date().toISOString().replace(/[:.]/g, "-")}.md`), old);
  writeFileSync(soulPath(dir), text.trim() + "\n");
}

// ── the brain vault: an optional personal-notes CLI, run as a child process ──
// Off by default. WYN_BRAIN is the path to the CLI's Node entry script (it takes `ask`, `search`, `show`, `capture`).
const NODE = process.env.WYN_NODE || Bun.which("node") || "node";
const BRAIN = process.env.WYN_BRAIN || "";
async function brainRun(args: string[]) {
  if (!BRAIN || !existsSync(BRAIN)) throw bad("No brain vault is set up on this PC (WYN_BRAIN).");
  const p = Bun.spawn([NODE, BRAIN, ...args], { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), 60_000);
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  clearTimeout(timer);
  await p.exited;
  const text = (out || err).trim();
  return text.length > 9000 ? `${text.slice(0, 9000)}\n[cut]` : text;
}
const ownerOnly = (c: Ctx) => { if (c.user.role !== "owner") throw bad("That's for the owner only."); };
const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const folderOf = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd;
/** Queue a prompt for a session; the server's dispatcher sends it. */
export function queueDispatch(n: WynDb, d: { tool: string; sessionId: string | null; appId?: string | null; title: string; cwd: string; prompt: string; via: string; path?: string | null; origin: string }) {
  const id = `job_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  n.query(`INSERT INTO dispatches (id, tool, session_id, app_id, title, cwd, prompt, via, status, origin, path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`).run(id, d.tool, d.sessionId, d.appId ?? null, d.title.slice(0, 120), d.cwd, d.prompt.slice(0, 8000), d.via, d.origin, d.path ?? null, iso());
  return id;
}
/** A Claude session whose wyn plugin listener checked in recently can take a prompt right now. */
export const pluginListening = (n: WynDb, sessionId: string) => {
  const r = n.query("SELECT listening_at FROM session_hooks WHERE session_id = ?").get(sessionId) as any;
  return !!r?.listening_at && Date.now() - Date.parse(r.listening_at) < 150_000;
};
/** How to reach a session: the wyn plugin for live Claude sessions (app, terminal, background), the command line
 * for Codex and for Claude sessions that aren't running. */
export async function sendToSession(n: WynDb, id: string, prompt: string, origin: string) {
  const s = await findSession(id);
  if (!s) throw bad(`No session ${id}. Use sessions to find it.`);
  const text = String(prompt ?? "").trim();
  if (!text) throw bad("What should I tell it?");
  let via = "cli";
  if (s.tool === "claude" && pluginListening(n, s.id)) via = "plugin";
  else if (s.tool === "claude" && s.live) {
    throw bad(`"${s.title}" is open${s.where === "app" ? " in the Claude app" : ""} but the wyn plugin isn't listening there yet. Restart that session (or run /reload-plugins in it) and try again.`);
  }
  const job = queueDispatch(n, { tool: s.tool, sessionId: s.id, title: s.title, cwd: s.cwd, prompt: text, via, path: s.path, origin });
  return { queued: job, session: s.title, via: via === "plugin" ? "handed to the session through the wyn plugin" : `run with the ${s.tool} command line`,
    note: "The reply comes back to chat when the session answers." };
}
export type Tool = { name: string; description: string; parameters: any; write?: boolean; run: (a: any, c: Ctx) => any };

/** Runs `fn` and records what it changed in one agentos row. */
export function tracked(c: Ctx, label: string, tbl: string, key: () => string, fn: () => any) {
  const k0 = key();
  const before = k0 ? rowOf(c.s, tbl, k0) : null;
  const out = fn();
  const k = key() || String(out?.id ?? "").replace(/^[tgi]/, "");
  const after = rowOf(c.s, tbl, k);
  if (JSON.stringify(before ?? null) !== JSON.stringify(after ?? null))
    c.n.query("INSERT INTO changes (turn, label, tbl, row_key, before, after, at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(c.turn, label, tbl, k, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, iso());
  return out;
}
const taskNum = (id: unknown) => String(id ?? "").replace(/^t/i, "");
const goalNum = (id: unknown) => String(id ?? "").replace(/^g/i, "");
const shortTask = (t: any) => ({ id: t.id, title: t.title, status: t.status, area: t.area, due: t.due,
  at: t.scheduled ? local(t.scheduled.start) : null, minutes: t.estimateMinutes, goal: t.goal, owner: t.owner !== "me" ? t.owner : undefined });
function scheduleOf(a: any, t: any | null) {
  if (a.schedule === null) return { scheduled: null };
  const sc = a.schedule;
  if (!sc) return {};
  const date = isDay(sc.date) ? sc.date : t?.due ?? istDate();
  if (!isTime(sc.time)) throw bad("schedule.time is HH:MM, 24-hour.");
  const minutes = Number.isInteger(sc.minutes) && sc.minutes > 0 ? sc.minutes : t?.estimateMinutes || 30;
  const start = new Date(`${date}T${sc.time}:00+05:30`);
  return { scheduled: { start: start.toISOString(), end: new Date(start.getTime() + minutes * 60000).toISOString() }, due: date, estimateMinutes: minutes };
}

export const TOOLS: Tool[] = [
  {
    name: "overview",
    description: "What today looks like right now: time, calendar blocks, tasks (open, overdue, done today), free time, goals and their pace, tonight's sleep, inbox count.",
    parameters: { type: "object", properties: {} },
    run: (_a, { s }) => {
      const b = s.bootstrap();
      const today = b.today.date;
      const nowMin = (Date.now() - Date.parse(`${today}T00:00:00+05:30`)) / 60000;
      const D = dayModel(b, today, Math.max(0, nowMin));
      const tasks = b.today.tasks;
      const open = tasks.filter((t: any) => ["todo", "doing"].includes(t.status));
      const goals = b.goals.goals.filter((g: any) => g.status === "active" && ["week", "month", "quarter", "year"].includes(g.horizon));
      const used = (g: any) => (g.start && g.end ? Math.min(1, Math.max(0, (Date.now() - Date.parse(`${g.start}T00:00:00+05:30`)) / (Date.parse(`${g.end}T23:59:59+05:30`) - Date.parse(`${g.start}T00:00:00+05:30`)))) : null);
      return {
        now: local(iso()), weekday: b.today.weekday,
        calendar: b.today.events.filter((e: any) => !e.allDay).map((e: any) => `${local(e.start).slice(11)}-${local(e.end).slice(11)} ${e.title}${e.area ? ` [${e.area}]` : ""}`),
        today: open.filter((t: any) => (t.scheduled && local(t.scheduled.start).startsWith(today)) || t.due === today || t.status === "doing").map(shortTask),
        overdue: open.filter((t: any) => t.due && t.due < today && !t.scheduled).map(shortTask),
        doneToday: tasks.filter((t: any) => t.status === "done" && t.completedAt && local(t.completedAt).startsWith(today)).map((t: any) => t.title),
        inbox: tasks.filter((t: any) => t.status === "inbox").length,
        freeToday: D ? D.gaps.map((g) => `${hhmm(g.s)}-${hhmm(g.e)}`) : [],
        goals: goals.map((g: any) => ({ id: g.id, title: g.title, horizon: g.horizon, progress: g.progress, timeUsed: used(g) == null ? null : Math.round(used(g)! * 100), parent: g.parent })),
        areas: b.areas.map((a: any) => a.slug),
        sleepDefault: b.sleep ?? null,
      };
    },
  },
  {
    name: "find_tasks",
    description: "Search tasks by words in the title. status: open (default), done, inbox or all.",
    parameters: { type: "object", properties: { query: { type: "string" }, status: { type: "string", enum: ["open", "done", "inbox", "all"] } } },
    run: (a, { s }) => {
      const q = String(a.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const st = a.status ?? "open";
      return s.tasks().filter((t: any) => (st === "all" || (st === "open" ? ["todo", "doing", "inbox"].includes(t.status) : t.status === st))
        && q.every((w) => t.title.toLowerCase().includes(w))).slice(0, 25).map(shortTask);
    },
  },
  {
    name: "add_task",
    description: "Add a task. due is YYYY-MM-DD. schedule puts it on the timeline: {date, time HH:MM, minutes}. area is an area slug from overview.",
    parameters: { type: "object", properties: { title: { type: "string" }, area: { type: "string" }, due: { type: "string" }, minutes: { type: "integer" },
      goal: { type: "string" }, notes: { type: "string" }, inbox: { type: "boolean" },
      schedule: { type: "object", properties: { date: { type: "string" }, time: { type: "string" }, minutes: { type: "integer" } } } }, required: ["title"] },
    write: true,
    run: (a, c) => {
      const body: any = { title: a.title, ...(a.area ? { area: a.area } : {}), ...(isDay(a.due) ? { due: a.due } : {}), ...(a.goal ? { goal: a.goal } : {}),
        ...(a.notes ? { notes: a.notes } : {}), ...(a.minutes ? { estimateMinutes: a.minutes } : {}), ...(a.inbox ? { status: "inbox" } : {}), ...scheduleOf(a, null) };
      return shortTask(tracked(c, `Added “${a.title}”`, "tasks", () => "", () => c.s.createTask(body)));
    },
  },
  {
    name: "update_task",
    description: "Change a task: title, area, due (YYYY-MM-DD or null), minutes, goal, notes, status (todo, doing, done), or schedule ({date, time, minutes}, or null to take it off the timeline).",
    parameters: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, area: { type: "string" }, due: { type: ["string", "null"] },
      minutes: { type: "integer" }, goal: { type: ["string", "null"] }, notes: { type: "string" }, status: { type: "string", enum: ["todo", "doing", "done"] },
      schedule: { type: ["object", "null"], properties: { date: { type: "string" }, time: { type: "string" }, minutes: { type: "integer" } } } }, required: ["id"] },
    write: true,
    run: (a, c) => {
      const cur = c.s.tasks().find((t: any) => t.id === `t${taskNum(a.id)}`) ?? null;
      if (!cur) throw bad(`No open task ${a.id}.`);
      const body: any = {};
      for (const k of ["title", "area", "goal", "notes", "status"]) if (k in a) body[k] = a[k];
      if ("due" in a) body.due = a.due;
      if (a.minutes) body.estimateMinutes = a.minutes;
      Object.assign(body, scheduleOf(a, cur));
      const verb = a.status === "done" ? "Done" : a.schedule ? "Planned" : a.schedule === null ? "Unplanned" : "Changed";
      return shortTask(tracked(c, `${verb}: “${cur.title}”`, "tasks", () => taskNum(a.id), () => c.s.patchTask(`t${taskNum(a.id)}`, body)));
    },
  },
  {
    name: "drop_task",
    description: "Drop (delete) a task. It deletes data, so it needs their yes first: the first call returns an approval id and the question to ask.",
    parameters: { type: "object", properties: { id: { type: "string" }, approval: { type: "string" } }, required: ["id"] },
    write: true,
    run: async (a, c) => {
      const cur = c.s.tasks().find((t: any) => t.id === `t${taskNum(a.id)}`);
      if (!cur) throw bad(`No open task ${a.id}.`);
      const asked = await requireYes(c, { tool: "drop_task", args: { id: cur.id }, risks: ["deletes_data"], summary: `Drop the task “${cur.title}”` }, a.approval);
      if (asked) return asked;
      return shortTask(tracked(c, `Dropped “${cur?.title ?? a.id}”`, "tasks", () => taskNum(a.id), () => c.s.patchTask(`t${taskNum(a.id)}`, { status: "dropped" })));
    },
  },
  {
    name: "goals",
    description: "All active goals with horizon (week, month, quarter, year, decade, life), progress, parent and linked open tasks.",
    parameters: { type: "object", properties: {} },
    run: (_a, { s }) => {
      const b = s.bootstrap();
      return b.goals.goals.filter((g: any) => g.status === "active").map((g: any) => ({ id: g.id, title: g.title, horizon: g.horizon, period: g.label,
        area: g.area, progress: g.progress, parent: g.parent, tasks: b.today.tasks.filter((t: any) => t.goal === g.id && ["todo", "doing"].includes(t.status)).map((t: any) => t.title) }));
    },
  },
  {
    name: "add_goal",
    description: "Add a goal on a horizon (week, month, quarter, year, decade, life), optionally under a parent goal. Use it to break a goal down one horizon at a time.",
    parameters: { type: "object", properties: { title: { type: "string" }, horizon: { type: "string", enum: ["week", "month", "quarter", "year", "decade", "life"] },
      area: { type: "string" }, parent: { type: "string" }, measure: { type: "string" } }, required: ["title", "horizon"] },
    write: true,
    run: (a, c) => tracked(c, `New ${a.horizon} goal “${a.title}”`, "goals", () => "", () => c.s.createGoal({ title: a.title, horizon: a.horizon,
      ...(a.area ? { area: a.area } : {}), ...(a.parent ? { parent: a.parent } : {}), ...(a.measure ? { measure: a.measure } : {}) })),
  },
  {
    name: "update_goal",
    description: "Change a goal: title, status (active, done, dropped — dropping needs their yes: the first call returns an approval id and the question), progress 0-100 (manual goals), parent.",
    parameters: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, status: { type: "string", enum: ["active", "done", "dropped"] },
      progress: { type: "integer" }, parent: { type: ["string", "null"] }, approval: { type: "string" } }, required: ["id"] },
    write: true,
    run: async (a, c) => {
      if (a.status === "dropped") {
        const g = c.s.db.query("SELECT id, title FROM goals WHERE id = ?").get(Number(goalNum(a.id))) as any;
        if (!g) throw bad(`No goal ${a.id}.`);
        const asked = await requireYes(c, { tool: "update_goal", args: { id: `g${g.id}`, status: "dropped" }, risks: ["deletes_data"], summary: `Drop the goal “${g.title}”` }, a.approval);
        if (asked) return asked;
      }
      const body: any = {};
      for (const k of ["title", "status", "progress", "parent"]) if (k in a) body[k] = a[k];
      if ("progress" in a) body.progressMode = "manual";
      return tracked(c, `Goal changed: ${a.title ?? a.id}`, "goals", () => goalNum(a.id), () => c.s.patchGoal(`g${goalNum(a.id)}`, body));
    },
  },
  {
    name: "set_sleep",
    description: "Change sleep. scope tonight moves tonight's sleep block; scope every sets the usual night. bed and wake are HH:MM.",
    parameters: { type: "object", properties: { scope: { type: "string", enum: ["tonight", "every"] }, bed: { type: "string" }, wake: { type: "string" } }, required: ["scope", "bed", "wake"] },
    write: true,
    run: (a, c) => {
      if (!isTime(a.bed) || !isTime(a.wake)) throw bad("bed and wake are HH:MM.");
      if (a.scope === "every") return tracked(c, `Sleep every night ${a.bed}–${a.wake}`, "settings", () => "sleep.default", () => c.s.putSleep({ bed: a.bed, wake: a.wake }));
      const b = c.s.bootstrap();
      const today = b.today.date, nowMin = (Date.now() - Date.parse(`${today}T00:00:00+05:30`)) / 60000;
      const night = nowMin < 12 * 60 ? addDays(today, -1) : today;
      const ev = [...b.week.days[0].events, ...(b.week.days[1]?.events ?? [])].find((e: any) => /\bsleep\b/i.test(e.title)
        && Date.parse(e.end) > Date.now() && Date.parse(e.start) < Date.parse(`${addDays(night, 1)}T12:00:00+05:30`));
      if (!ev) throw bad("No sleep block tonight. Set the usual night instead (scope every).");
      const start = new Date(`${a.bed >= "12:00" ? night : addDays(night, 1)}T${a.bed}:00+05:30`), end = new Date(`${addDays(night, 1)}T${a.wake}:00+05:30`);
      return tracked(c, `Sleep tonight ${a.bed}–${a.wake}`, "event_overrides", () => ev.id, () => c.s.patchEvent(ev.id, { start: start.toISOString(), end: end.toISOString() }));
    },
  },
  {
    name: "life",
    description: "The life wheel: nine aspects scored 0-10 over time, and which areas feed each.",
    parameters: { type: "object", properties: {} },
    run: (_a, { s }) => { const l = s.life(); return { latest: l.snapshots.at(-1) ?? null, first: l.snapshots[0] ?? null, areaAspects: l.areaAspects }; },
  },
  {
    name: "remember",
    description: "Save to memory. term long: durable things (a preference, a person, a project, a goal, a habit, a decision, health), with kind and importance 1-5 (5 = shapes everything). term short: what's going on now or a follow-up, kept for days (default 3, followups 7). Not small talk. A near-duplicate updates the old one.",
    parameters: { type: "object", properties: { text: { type: "string" }, term: { type: "string", enum: ["long", "short"] },
      kind: { type: "string", enum: [...LONG_KINDS, ...SHORT_KINDS] }, importance: { type: "integer" }, days: { type: "integer" } }, required: ["text"] },
    run: (a, { n, turn }) => remember(n, a, turn.startsWith("call") ? "call" : "chat"),
  },
  {
    name: "update_memory",
    description: "Correct or re-rank a memory by id (L12 or S4): new text, importance or kind.",
    parameters: { type: "object", properties: { id: { type: "string" }, text: { type: "string" }, importance: { type: "integer" }, kind: { type: "string" } }, required: ["id"] },
    run: (a, { n }) => updateMemory(n, a),
  },
  {
    name: "forget",
    description: "Forget a memory by id (L12 deletes it; S4 closes a short-term note) when it's wrong, done or out of date.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (a, { n }) => forget(n, a.id),
  },
  {
    name: "recall",
    description: "Search everything you remember: long-term, short-term, past days, journal and call summaries.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: (a, { n }) => recall(n, String(a.query ?? "")),
  },
  {
    name: "memories",
    description: "Your whole memory, with ids: long-term by importance, live short-term notes, and recent days.",
    parameters: { type: "object", properties: {} },
    run: (_a, { n }) => memoryList(n),
  },
  {
    name: "brain_ask",
    description: "Ask the user's personal brain vault (their notes, projects, decisions, journal, tools). Use it before saying you don't know something about their life or work.",
    parameters: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
    run: async (a, c) => { ownerOnly(c); return { answer: await brainRun(["ask", String(a.question).slice(0, 500)]) }; },
  },
  {
    name: "brain_search",
    description: "Search the brain vault by keywords; returns note ids and summaries.",
    parameters: { type: "object", properties: { terms: { type: "string" } }, required: ["terms"] },
    run: async (a, c) => { ownerOnly(c); return { results: await brainRun(["search", ...String(a.terms).split(/\s+/).filter(Boolean).slice(0, 12)]) }; },
  },
  {
    name: "brain_read",
    description: "Read one brain note in full by its id (from brain_search or brain_ask).",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async (a, c) => { ownerOnly(c); return { note: await brainRun(["show", String(a.id).slice(0, 200), "--full"]) }; },
  },
  {
    name: "brain_capture",
    description: "Drop a thought into the brain vault's inbox. Only when the user asks you to save something to their brain.",
    parameters: { type: "object", properties: { thought: { type: "string" } }, required: ["thought"] },
    run: async (a, c) => { ownerOnly(c); return { captured: await brainRun(["capture", String(a.thought).slice(0, 1500)]) }; },
  },
  {
    name: "sessions",
    description: "The user's coding sessions on the PC, Claude Code (app, terminal, background) and Codex, newest first: id, tool, title, folder, where it runs, when it last moved. query filters by title or folder.",
    parameters: { type: "object", properties: { query: { type: "string" }, days: { type: "integer" } } },
    run: async (a, c) => {
      ownerOnly(c);
      const q = String(a.query ?? "").toLowerCase();
      return (await listSessions(Math.min(30, Number(a.days) || 7), 200))
        .filter((s) => !q || `${s.title} ${s.cwd}`.toLowerCase().includes(q)).slice(0, 25)
        .map((s) => ({ id: s.id.slice(0, 8), tool: s.tool, title: s.title, folder: folderOf(s.cwd), where: s.where, state: s.state, updated: ago(s.updatedAt),
          reachable: s.tool === "codex" || !s.live || pluginListening(c.n, s.id) }));
    },
  },
  {
    name: "session_read",
    description: "The last few messages of one session (id from sessions), to see where it is or what it asked.",
    parameters: { type: "object", properties: { id: { type: "string" }, last: { type: "integer" } }, required: ["id"] },
    run: async (a, c) => {
      ownerOnly(c);
      const s = await findSession(a.id);
      if (!s) throw bad(`No session ${a.id}.`);
      return { title: s.title, tool: s.tool, folder: s.cwd, where: s.where, messages: readSession(s, Math.min(20, Number(a.last) || 6)) };
    },
  },
  {
    name: "session_send",
    description: "Hand a prompt to one session (id from sessions), as if the user typed it there. Word it for that session, with the context it needs. The reply comes back to the chat when it answers.",
    parameters: { type: "object", properties: { id: { type: "string" }, prompt: { type: "string" } }, required: ["id", "prompt"] },
    run: async (a, c) => { ownerOnly(c); return sendToSession(c.n, a.id, a.prompt, c.turn.startsWith("check") ? "wyn" : "owner"); },
  },
  {
    name: "session_new",
    description: "Start a new coding session with a prompt. tool claude (a background Claude Code agent the user can open with `claude attach`) or codex. folder is a path, or a project folder name the user has worked in (from sessions).",
    parameters: { type: "object", properties: { tool: { type: "string", enum: ["claude", "codex"] }, folder: { type: "string" }, prompt: { type: "string" }, title: { type: "string" } },
      required: ["tool", "folder", "prompt"] },
    run: async (a, c) => {
      ownerOnly(c);
      const f = String(a.folder ?? "").trim();
      let cwd = existsSync(f) ? f : "";
      if (!cwd) {
        const known = (await listSessions(30, 400)).map((s) => s.cwd).find((p) => folderOf(p).toLowerCase() === f.toLowerCase());
        cwd = known ?? (existsSync(join(process.env.USERPROFILE ?? "", f)) ? join(process.env.USERPROFILE ?? "", f) : "");
      }
      if (!cwd) throw bad(`No folder ${f}. Give a path, or a project from sessions.`);
      const job = queueDispatch(c.n, { tool: a.tool, sessionId: null, title: String(a.title || a.prompt).slice(0, 80), cwd, prompt: String(a.prompt),
        via: a.tool === "claude" ? "bg" : "cli", origin: c.turn.startsWith("check") ? "wyn" : "owner" });
      return { queued: job, folder: cwd, note: a.tool === "claude" ? "It starts as a background agent; its reply comes back to chat." : "Codex runs it now; the reply comes back to chat." };
    },
  },
  {
    name: "dispatches",
    description: "Prompts you've handed to sessions lately, with their status and replies.",
    parameters: { type: "object", properties: {} },
    run: (_a, { n }) => (n.query("SELECT id, tool, title, via, status, origin, substr(prompt, 1, 200) prompt, substr(result, 1, 600) result, error, created_at FROM dispatches ORDER BY created_at DESC LIMIT 15").all() as any[])
      .map((r) => ({ ...r, created_at: local(r.created_at) })),
  },
  {
    name: "update_soul",
    description: "Rewrite your soul file (who you are, how you talk, how you work). Only when the user asks you to change how you are; read the current one in your instructions, change only what they asked, and pass the whole new file.",
    parameters: { type: "object", properties: { text: { type: "string" }, why: { type: "string" } }, required: ["text"] },
    run: (a, c) => {
      if (!c.dir) throw bad("Can't reach the soul file here.");
      const text = String(a.text ?? "");
      if (text.length < 200) throw bad("Pass the whole soul file, not a fragment.");
      writeSoul(c.dir, text);
      return { saved: true, note: "Takes effect from your next turn." };
    },
  },
  {
    name: "journal",
    description: "Save a journal entry in the user's words (lightly cleaned), with an optional one-word mood.",
    parameters: { type: "object", properties: { text: { type: "string" }, mood: { type: "string" } }, required: ["text"] },
    run: (a, { n, turn }) => {
      const r = n.query("INSERT INTO journal (date, text, mood, source, at) VALUES (?, ?, ?, ?, ?) RETURNING id")
        .get(istDate(), String(a.text).slice(0, 4000), a.mood ? String(a.mood).slice(0, 30) : null, turn.startsWith("call") ? "call" : "chat", iso()) as any;
      return { saved: r.id };
    },
  },
  {
    name: "read_journal",
    description: "Journal entries from the last few days (default 7).",
    parameters: { type: "object", properties: { days: { type: "integer" } } },
    run: (a, { n }) => n.query("SELECT date, mood, text FROM journal WHERE date >= ? ORDER BY id").all(addDays(istDate(), -(a.days ?? 7))),
  },
  {
    name: "schedule",
    description: "Plan to reach the user later: kind call (Wyn rings them) or message (a chat message and a notification). at is YYYY-MM-DD HH:MM India time.",
    parameters: { type: "object", properties: { kind: { type: "string", enum: ["call", "message"] }, at: { type: "string" }, reason: { type: "string" } }, required: ["kind", "at", "reason"] },
    run: (a, { n }) => {
      const m = String(a.at).match(/^(\d{4}-\d{2}-\d{2})[ T]([01]\d|2[0-3]):([0-5]\d)$/);
      if (!m) throw bad("at is YYYY-MM-DD HH:MM.");
      const when = new Date(`${m[1]}T${m[2]}:${m[3]}:00+05:30`).toISOString();
      const r = n.query("INSERT INTO schedule (kind, at, reason, created_at) VALUES (?, ?, ?, ?) RETURNING id").get(a.kind, when, String(a.reason).slice(0, 300), iso()) as any;
      return { scheduled: r.id, at: a.at };
    },
  },
  {
    name: "set_preferences",
    description: "Change how you work with the user: tone (how you talk), voice (marin, cedar, alloy, ash, ballad, coral, echo, sage, shimmer, verse), morning_call and night_call (HH:MM, or empty for none), proactive_level (how often you reach out on your own: off, light, normal or eager), snooze (minutes), message_channel (where your own messages go: app, whatsapp or both), " +
      "voice_replies (WhatsApp voice notes back: off, mirror = when they sent one, the default, or always).",
    parameters: { type: "object", properties: { tone: { type: "string" }, voice: { type: "string" }, morning_call: { type: "string" }, night_call: { type: "string" },
      proactive_level: { type: "string", enum: ["off", "light", "normal", "eager"] }, snooze: { type: "string" }, message_channel: { type: "string", enum: ["app", "whatsapp", "both"] },
      voice_replies: { type: "string", enum: ["off", "mirror", "always"] } } },
    run: (a, { n }) => {
      if (typeof a.proactive === "string" && typeof a.proactive_level !== "string") a.proactive_level = a.proactive === "off" ? "off" : "normal";
      if (typeof a.proactive_level === "string" && !["off", "light", "normal", "eager"].includes(a.proactive_level)) throw bad("proactive_level is off, light, normal or eager.");
      for (const k of ["tone", "voice", "morning_call", "night_call", "proactive_level", "snooze", "message_channel", "voice_replies"]) if (typeof a[k] === "string") setPref(n, k, a[k].slice(0, 400));
      return prefsOf(n);
    },
  },
  {
    name: "answer_agent",
    description: "Record the user's answer to a question one of their agents asked (the open agent questions are in your context, with ids). Use their words; the agent reads it back.",
    parameters: { type: "object", properties: { id: { type: "string" }, answer: { type: "string" } }, required: ["id", "answer"] },
    run: (a, { n }) => {
      const r = n.query("UPDATE agent_requests SET status = 'answered', answer = ?, answered_at = ? WHERE id = ? AND status != 'answered' RETURNING id")
        .get(String(a.answer).slice(0, 4000), iso(), String(a.id)) as any;
      if (!r) throw bad(`No open agent question ${a.id}.`);
      return { answered: r.id };
    },
  },
  {
    name: "give_to_claude",
    description: "Hand work to Claude Code on the PC (an agent job). Only after the user said yes. id is an existing task; leave it out and a task is made for it from title (or the brief's first line). workspace: agentic-os, corner-market, northwind or none; mode read (research and drafts) or edit.",
    parameters: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, brief: { type: "string" }, workspace: { type: "string" },
      mode: { type: "string", enum: ["read", "edit"] }, area: { type: "string" } }, required: ["brief"] },
    write: true,
    run: async (a, c) => {
      if (!c.give) throw bad("Claude jobs aren't available here.");
      const brief = String(a.brief ?? "").trim();
      if (!brief) throw bad("Write the brief: what Claude should do.");
      let id = a.id ? `t${taskNum(a.id)}` : "";
      let created: any = null;
      if (!id) {
        const title = String(a.title || brief.split(/\r?\n/).find((l) => l.trim()) || brief).trim().slice(0, 120);
        created = shortTask(tracked(c, `Added “${title}” for Claude`, "tasks", () => "", () => c.s.createTask({ title, notes: brief.slice(0, 4000),
          ...(a.area ? { area: a.area } : {}), due: istDate() })));
        id = created.id;
      }
      const r = await c.give(id, { brief, workspace: a.workspace ?? "none", mode: a.mode ?? "read" });
      return { started: true, task: id, ...(created ? { createdTask: created.title } : {}), state: r?.state ?? "queued" };
    },
  },
];
// send_whatsapp lives with the WhatsApp channel (wyn-whatsapp-tool.ts).
TOOLS.push(...(WA_TOOLS as unknown as Tool[]));

// Ideas, past calls and the rest of her brain tools live in wyn-brain-tools.ts.
TOOLS.push(...BRAIN_TOOLS);
// The roast-me onboarding lives in wyn-onboard.ts.
TOOLS.push(...ONBOARD_TOOLS);

// Google Calendar (find, add, move, cancel) lives in wyn-calendar.ts; its guardrail in wyn-policy.ts.
TOOLS.push(...CAL_TOOLS);
// my_work (what she has running or handed off) lives with the proactive layer (wyn-proactive.ts).
TOOLS.push(...WORK_TOOLS);

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));
/** Runs one tool call; errors come back as { error } so the model can recover. */
export async function runTool(name: string, args: any, c: Ctx) {
  const t = toolByName.get(name);
  if (!t) return { error: `No tool ${name}.` };
  try { return await t.run(args ?? {}, c); }
  catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}

#!/usr/bin/env bun
// agentos: the one door to Alex's life hub. Areas, projects, goals, tasks and
// the day timeline live in one SQLite file; agents and the Agentic OS app both
// go through this CLI. AXI rules: bare command = dashboard, TOON output,
// next-step hints, idempotent writes, --json on anything.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { goals as goalCommands, GOAL_HELP, migrateGoals } from "./goals";
import { authorize, syncGoogleTasks, syncStatus } from "./google-tasks";
import { MODULES } from "./modules/index";
import type { Args, ModCtx } from "./modules/types";
import { openDatabase } from "./sqlite";
import { term, TERM_HELP } from "./term";

const TZ = "Asia/Kolkata";
const DB_PATH = process.env.AGENTOS_DB || join(homedir(), ".agentos", "agentos.db");
// Content OS keeps a second file beside agentos.db; only its module opens it (see src/modules).
const CONTENT_DB_PATH = process.env.AGENTOS_CONTENT_DB || join(dirname(DB_PATH), "content.db");
const EVENTS_PATH =
  process.env.AGENTOS_EVENTS ||
  join(homedir(), "agentic-os", ".operator-data", "workspace.json");

// ── storage ─────────────────────────────────────────────────────────────────
function open(): Database {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = openDatabase(DB_PATH);
  migrate(db);
  migrateTasksV2(db);
  // Module tables (src/modules): each migrate is idempotent, prefixed <name>_, and never bumps user_version.
  for (const m of MODULES) {
    try {
      m.migrate(db);
    } catch (e) {
      throw new Error(`Module ${m.name}: migrate failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return db;
}

const SEED_AREAS: [string, string, string][] = [
  ["college", "City College", "#5b8def"],
  ["morgan-co", "Morgan & Co.", "#d9822b"],
  ["corner-market", "Corner Market", "#e0559b"],
  ["northwind", "Northwind", "#7c5cff"],
  ["projects", "Projects", "#2bb39a"],
  ["content", "Content", "#f2b134"],
  ["personal", "Personal + Health", "#4caf50"],
];
// Calendar events carry no area; these patterns tag them. Editable with `agentos area rule`.
const SEED_RULES: [string, string][] = [
  // Extra course codes that mark a class can come from WYN_CLASS_WORDS (regex alternatives, e.g. "GE ?[IVX\d]*|EVS"),
  // the same variable the phone server reads; none are built in.
  ["college", `college|lecture|class|tutorial|exam|seminar|lab${process.env.WYN_CLASS_WORDS ? `|${process.env.WYN_CLASS_WORDS}` : ""}`],
  ["morgan-co", "store|shop|midtown"],
  ["corner-market", "corner ?market"],
  ["northwind", "northwind|client|lead|harborline"],
  ["projects", "side project|hustle"],
  ["content", "reel|shoot|content|script|youtube|instagram"],
  ["personal", "gym|boxing|defen[cs]e|workout|run|family|mom|dad|doctor|sleep"],
];

function migrate(db: Database) {
  const v = (db.query("PRAGMA user_version").get() as any).user_version as number;
  if (v < 1) {
    db.exec(`
      CREATE TABLE areas (slug TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, sort INTEGER DEFAULT 0, pattern TEXT);
      CREATE TABLE projects (slug TEXT PRIMARY KEY, name TEXT NOT NULL, area TEXT REFERENCES areas(slug),
        status TEXT NOT NULL DEFAULT 'active', deadline TEXT, link TEXT, created_at TEXT NOT NULL);
      CREATE TABLE goals (id INTEGER PRIMARY KEY, title TEXT NOT NULL, area TEXT REFERENCES areas(slug),
        horizon TEXT NOT NULL DEFAULT 'month', due TEXT, progress INTEGER NOT NULL DEFAULT 0,
        measure TEXT, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL);
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT,
        area TEXT REFERENCES areas(slug), project TEXT REFERENCES projects(slug), goal INTEGER REFERENCES goals(id),
        status TEXT NOT NULL DEFAULT 'todo', priority INTEGER NOT NULL DEFAULT 2,
        due TEXT, start_at TEXT, end_at TEXT, owner TEXT NOT NULL DEFAULT 'me',
        source TEXT NOT NULL DEFAULT 'cli', external_id TEXT, evidence TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, done_at TEXT);
      CREATE UNIQUE INDEX tasks_external ON tasks(source, external_id) WHERE external_id IS NOT NULL;
      CREATE INDEX tasks_status ON tasks(status, due);
    `);
    const ins = db.prepare("INSERT INTO areas (slug, name, color, sort, pattern) VALUES (?, ?, ?, ?, ?)");
    SEED_AREAS.forEach(([slug, name, color], i) =>
      ins.run(slug, name, color, i, SEED_RULES.find((r) => r[0] === slug)?.[1] ?? null),
    );
    db.exec("PRAGMA user_version = 1");
  }
  // Goals on time horizons (v3). Checks columns itself, so it runs the same with or without the tasks v2 step.
  migrateGoals(db, (db.query("PRAGMA user_version").get() as any).user_version, istDate(now()));
  migrateV4(db);
  if ((db.query("PRAGMA user_version").get() as any).user_version < 5) {
    // v5: life aspects on goals that have no area (a JSON array of aspect keys).
    const cols = new Set((db.query("PRAGMA table_info(goals)").all() as any[]).map((c) => c.name));
    if (!cols.has("aspects")) db.exec("ALTER TABLE goals ADD COLUMN aspects TEXT");
    db.exec("PRAGMA user_version = 5");
  }
  if ((db.query("PRAGMA user_version").get() as any).user_version < 6) {
    // v6: AI proposals. A batch is one answer from Claude (a day plan, an inbox sort, a capture read);
    // each proposal is one change the user keeps or removes. Decided rows stay, so later plans can learn from them.
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_batches (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, date TEXT, summary TEXT,
        model TEXT, ms INTEGER, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, decided_at TEXT);
      CREATE TABLE IF NOT EXISTS ai_proposals (id INTEGER PRIMARY KEY, batch_id INTEGER NOT NULL REFERENCES ai_batches(id) ON DELETE CASCADE,
        kind TEXT NOT NULL, task_id INTEGER, payload TEXT NOT NULL, reason TEXT, status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL, decided_at TEXT);
      CREATE INDEX IF NOT EXISTS ai_batches_kind ON ai_batches(kind, date, status);
      CREATE INDEX IF NOT EXISTS ai_proposals_batch ON ai_proposals(batch_id, status);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL);
      PRAGMA user_version = 6;
    `);
  }
  migrateV7(db);
}

// v7: the Work build. Projects carry a folder (where their code lives) and a look; ideas are quick
// thoughts that become tasks or jobs; jobs are Claude Code / Codex sessions the phone server runs
// over ACP for tasks or an idea. Checks columns itself, like v2, so it is safe on any branch's file.
const PROJECT_STATUS = ["active", "paused", "done", "archived"];
const IDEA_STATUS = ["open", "tasked", "jobbed", "archived"];
const IDEA_SOURCES = ["app", "capture", "widget", "siri", "keyboard", "desktop", "cli", "voice"];
function migrateV7(db: Database) {
  const have = columns(db, "projects");
  const wanted: [string, string][] = [
    ["description", "TEXT"], ["folder", "TEXT"], ["color", "TEXT"], ["icon", "TEXT"],
    ["goal", "INTEGER"], ["sort", "REAL"], ["updated_at", "TEXT"],
  ];
  const missing = wanted.filter(([name]) => !have.has(name));
  const tables = columns(db, "ideas").size && columns(db, "jobs").size && columns(db, "job_tasks").size;
  if (!missing.length && tables && (db.query("PRAGMA user_version").get() as any).user_version >= 7) return;
  db.transaction(() => {
    for (const [name, type] of missing) db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${type}`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS ideas (id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT,
        project TEXT REFERENCES projects(slug), status TEXT NOT NULL DEFAULT 'open',
        task_id INTEGER, job_id INTEGER, source TEXT, recording_id TEXT, created_at TEXT, updated_at TEXT);
      CREATE INDEX IF NOT EXISTS ideas_project ON ideas(project, status);
      CREATE INDEX IF NOT EXISTS ideas_status ON ideas(status, created_at);
      CREATE TABLE IF NOT EXISTS jobs (id INTEGER PRIMARY KEY, title TEXT, engine TEXT NOT NULL,
        project TEXT, cwd TEXT, prompt TEXT, context TEXT, mode TEXT DEFAULT 'auto', status TEXT NOT NULL,
        session_id TEXT, native_id TEXT, idea_id INTEGER, summary TEXT, error TEXT,
        created_at TEXT, updated_at TEXT, finished_at TEXT);
      CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project, status);
      CREATE TABLE IF NOT EXISTS job_tasks (job_id INTEGER NOT NULL, task_id INTEGER NOT NULL, PRIMARY KEY (job_id, task_id));
      CREATE INDEX IF NOT EXISTS job_tasks_task ON job_tasks(task_id);
    `);
    if (missing.some(([n]) => n === "sort")) db.exec("UPDATE projects SET sort = rowid * 1024 WHERE sort IS NULL");
    if (missing.some(([n]) => n === "updated_at")) db.exec("UPDATE projects SET updated_at = created_at WHERE updated_at IS NULL");
    if ((db.query("PRAGMA user_version").get() as any).user_version < 7) db.exec("PRAGMA user_version = 7");
  })();
}

// v4: what the phone app needs. Task start time and estimate, life wheel snapshots and
// the area→aspect map, and app-side overrides for calendar blocks (area, moved time).
function migrateV4(db: Database) {
  if ((db.query("PRAGMA user_version").get() as any).user_version >= 4) return;
  db.transaction(() => {
    const cols = new Set((db.query("PRAGMA table_info(tasks)").all() as any[]).map((c) => c.name));
    if (!cols.has("started_at")) db.exec("ALTER TABLE tasks ADD COLUMN started_at TEXT");
    if (!cols.has("estimate_minutes")) db.exec("ALTER TABLE tasks ADD COLUMN estimate_minutes INTEGER");
    db.exec(`
      CREATE TABLE IF NOT EXISTS life_snapshots (date TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'app',
        scores TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (date, source));
      CREATE TABLE IF NOT EXISTS life_area_aspects (area TEXT NOT NULL REFERENCES areas(slug) ON DELETE CASCADE,
        aspect TEXT NOT NULL, rank INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (area, aspect));
      CREATE TABLE IF NOT EXISTS event_overrides (event_id TEXT PRIMARY KEY, start_at TEXT, end_at TEXT,
        area TEXT REFERENCES areas(slug), updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS tasks_updated ON tasks(updated_at);
      PRAGMA user_version = 4;
    `);
  })();
}

// v2: Google-Tasks-shaped tasks (lists, one level of subtasks, star, manual order,
// due time, repeat) plus sync bookkeeping. Runs on every open and checks before it
// alters, because other branches bump user_version past 2 on the same file.
function columns(db: Database, table: string) {
  return new Set((db.query(`PRAGMA table_info(${table})`).all() as any[]).map((c) => c.name as string));
}
function migrateTasksV2(db: Database) {
  const fresh = !columns(db, "lists").size;
  db.exec(`
    CREATE TABLE IF NOT EXISTS lists (id INTEGER PRIMARY KEY, title TEXT NOT NULL, area TEXT REFERENCES areas(slug),
      sort REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sync_links (provider TEXT NOT NULL, kind TEXT NOT NULL, local_id INTEGER NOT NULL,
      external_id TEXT NOT NULL, remote_list TEXT, remote_updated TEXT, synced_at TEXT NOT NULL,
      PRIMARY KEY (provider, kind, local_id));
    CREATE UNIQUE INDEX IF NOT EXISTS sync_links_ext ON sync_links(provider, kind, external_id);
    CREATE TABLE IF NOT EXISTS sync_log (id INTEGER PRIMARY KEY, provider TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL,
      local_id INTEGER, external_id TEXT, winner TEXT, detail TEXT);
  `);
  const have = columns(db, "tasks");
  const wanted: [string, string][] = [
    ["list_id", "INTEGER REFERENCES lists(id)"], ["parent_id", "INTEGER REFERENCES tasks(id)"],
    ["starred", "INTEGER NOT NULL DEFAULT 0"], ["position", "REAL NOT NULL DEFAULT 0"],
    ["repeat", "TEXT"], ["due_time", "TEXT"],
  ];
  for (const [name, type] of wanted) if (!have.has(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
  db.exec("CREATE INDEX IF NOT EXISTS tasks_list ON tasks(list_id, parent_id, position)");
  if (fresh) {
    // One list per area, plus Google's default "My Tasks" for anything without an area.
    const stamp = iso(now());
    const ins = db.prepare("INSERT INTO lists (title, area, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
    ins.run("My Tasks", null, 0, stamp, stamp);
    (db.query("SELECT slug, name FROM areas ORDER BY sort").all() as any[]).forEach((a, i) => ins.run(a.name, a.slug, i + 1, stamp, stamp));
    db.exec(`UPDATE tasks SET list_id = coalesce((SELECT id FROM lists WHERE lists.area = tasks.area), 1) WHERE list_id IS NULL;
      UPDATE tasks SET position = id * 1024 WHERE position = 0;`);
  }
  if ((db.query("PRAGMA user_version").get() as any).user_version < 2) db.exec("PRAGMA user_version = 2");
}

// ── time (everything shown in IST; timestamps stored as UTC ISO) ───────────
const now = () => new Date();
const iso = (d: Date) => d.toISOString();
function istParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, weekday: p.weekday };
}
const istDate = (d: Date) => istParts(d).date;
const istTime = (d: Date) => istParts(d).time;
// IST is a fixed +05:30 with no DST.
const istToUtc = (date: string, time = "00:00") => new Date(`${date}T${time}:00+05:30`);
function addDays(date: string, n: number) {
  const d = istToUtc(date, "12:00");
  d.setUTCDate(d.getUTCDate() + n);
  return istDate(d);
}
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
/** today | tomorrow | yesterday | mon..sun (next one, today counts) | +3d | -1d | YYYY-MM-DD | DD-MM */
function parseDay(input: string): string {
  const s = input.trim().toLowerCase();
  const today = istDate(now());
  if (s === "today" || s === "tod") return today;
  if (s === "tomorrow" || s === "tmrw" || s === "tom") return addDays(today, 1);
  if (s === "yesterday") return addDays(today, -1);
  const rel = s.match(/^([+-]\d+)d$/);
  if (rel) return addDays(today, Number(rel[1]));
  const wd = DAYS.findIndex((d) => s.startsWith(d));
  if (wd >= 0 && /^[a-z]+$/.test(s)) {
    const cur = DAYS.indexOf(istParts(now()).weekday.toLowerCase().slice(0, 3));
    return addDays(today, (wd - cur + 7) % 7);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dm = s.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (dm) {
    const year = today.slice(0, 4);
    let d = `${year}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
    if (d < today) d = `${Number(year) + 1}${d.slice(4)}`;
    return d;
  }
  throw new UserError(`Can't read the date "${input}". Use today, tomorrow, fri, +3d, 2026-10-24 or 24-10.`);
}
function parseClock(input: string): string {
  const m = input.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) throw new UserError(`Can't read the time "${input}". Use 14:30, 9am or 6:15pm.`);
  let h = Number(m[1]);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || Number(m[2] ?? 0) > 59) throw new UserError(`"${input}" is not a valid time.`);
  return `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
}

// ── output: TOON by default, JSON with --json ──────────────────────────────
class UserError extends Error {}
function scalar(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = String(v);
  if (s === "" || /[,:"\n\r\t[\]{}]|^\s|\s$|^(true|false|null|-?\d+(\.\d+)?)$/.test(s))
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  return s;
}
function toon(value: unknown, indent = ""): string {
  if (Array.isArray(value)) return value.map((v) => `${indent}- ${scalar(v)}`).join("\n");
  const lines: string[] = [];
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === "object" && !Array.isArray(x))) {
      const keys = [...new Set(v.flatMap((x) => Object.keys(x)))];
      lines.push(`${indent}${k}[${v.length}]{${keys.join(",")}}:`);
      for (const row of v) lines.push(`${indent}  ${keys.map((key) => scalar((row as any)[key])).join(",")}`);
    } else if (Array.isArray(v)) {
      lines.push(`${indent}${k}[${v.length}]: ${v.map(scalar).join(",")}`);
    } else if (v && typeof v === "object") {
      lines.push(`${indent}${k}:`, toon(v, indent + "  "));
    } else lines.push(`${indent}${k}: ${scalar(v)}`);
  }
  return lines.join("\n");
}
let JSON_OUT = false;
function out(data: Record<string, unknown>, help: string[] = []) {
  if (JSON_OUT) return console.log(JSON.stringify(data, null, 2));
  console.log(toon(data));
  if (help.length) console.log(`help[${help.length}]:\n${help.map((h) => `  ${h}`).join("\n")}`);
}

// ── args (the Args type is shared with modules: src/modules/types.ts) ──────
function parseArgs(argv: string[]): Args {
  const a: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith("--")) {
      const [k, inline] = t.slice(2).split(/=(.*)/s);
      const next = argv[i + 1];
      if (inline !== undefined) a.flags[k] = inline;
      else if (next !== undefined && !next.startsWith("--")) a.flags[k] = argv[++i];
      else a.flags[k] = true;
    } else a._.push(t);
  }
  return a;
}
const str = (a: Args, k: string) => (typeof a.flags[k] === "string" ? (a.flags[k] as string) : undefined);

// ── lookups ─────────────────────────────────────────────────────────────────
function area(db: Database, input?: string): string | undefined {
  if (!input) return undefined;
  const s = input.toLowerCase();
  const rows = db.query("SELECT slug, name FROM areas").all() as any[];
  const hit =
    rows.find((r) => r.slug === s) ??
    rows.find((r) => r.name.toLowerCase() === s) ??
    rows.filter((r) => r.slug.startsWith(s) || r.name.toLowerCase().startsWith(s));
  if (Array.isArray(hit)) {
    if (hit.length === 1) return hit[0].slug;
    throw new UserError(
      hit.length ? `"${input}" matches ${hit.map((r) => r.slug).join(", ")}. Be more specific.`
        : `No area "${input}". Areas: ${rows.map((r) => r.slug).join(", ")}.`,
    );
  }
  return hit.slug;
}
function project(db: Database, input?: string): string | undefined {
  if (!input) return undefined;
  const row = db.query("SELECT slug FROM projects WHERE slug = ? OR lower(name) = lower(?)").get(input, input) as any;
  if (!row) throw new UserError(`No project "${input}". Create it: agentos project add ${input} "Name" --area <area>`);
  return row.slug;
}
function goalId(db: Database, input?: string): number | undefined {
  if (!input) return undefined;
  const id = Number(String(input).replace(/^g/i, ""));
  if (!db.query("SELECT 1 FROM goals WHERE id = ?").get(id)) throw new UserError(`No goal ${input}. List them: agentos goal`);
  return id;
}
function taskId(input?: string): number {
  const id = Number(String(input ?? "").replace(/^t/i, ""));
  if (!Number.isInteger(id) || id <= 0) throw new UserError(`Give a task id like t12.`);
  return id;
}
function getTask(db: Database, id: number) {
  const t = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as any;
  if (!t) throw new UserError(`No task t${id}.`);
  return t;
}
const defaultList = (db: Database) => (db.query("SELECT id FROM lists ORDER BY sort, id LIMIT 1").get() as any)?.id as number;
/** l3 | 3 | list title | area slug (the list mapped to that area) */
function listId(db: Database, input?: string): number | undefined {
  if (!input) return undefined;
  const s = String(input).trim();
  const n = /^l?\d+$/i.test(s) ? Number(s.replace(/^l/i, "")) : NaN;
  const row = ((Number.isInteger(n) ? db.query("SELECT id FROM lists WHERE id = ?").get(n) : null)
    ?? db.query("SELECT id FROM lists WHERE lower(title) = lower(?)").get(s)
    ?? db.query("SELECT id FROM lists WHERE area = ? ORDER BY sort LIMIT 1").get(s.toLowerCase())) as any;
  if (!row) throw new UserError(`No list "${input}". See them: agentos lists`);
  return row.id;
}
const listArea = (db: Database, id: number) => (db.query("SELECT area FROM lists WHERE id = ?").get(id) as any)?.area ?? null;
/** Siblings share a list and a parent; dropped tasks don't hold a place. */
function siblings(db: Database, list: number, parent: number | null, except = 0) {
  return db.query(
    `SELECT id, position FROM tasks WHERE list_id = ? AND parent_id IS ? AND status != 'dropped' AND id != ? ORDER BY position, id`,
  ).all(list, parent, except) as { id: number; position: number }[];
}
function edgePosition(db: Database, list: number, parent: number | null, where: "top" | "bottom", except = 0) {
  const sib = siblings(db, list, parent, except);
  if (!sib.length) return 1024;
  return where === "top" ? sib[0].position - 1024 : sib[sib.length - 1].position + 1024;
}
/** Position just after `afterId` among its siblings; renumbers the group if the gap runs out. */
function positionAfter(db: Database, list: number, parent: number | null, afterId: number, except: number): number {
  let sib = siblings(db, list, parent, except);
  let i = sib.findIndex((x) => x.id === afterId);
  if (i < 0) throw new UserError(`t${afterId} is not in that list or parent.`);
  if (i + 1 < sib.length && sib[i + 1].position - sib[i].position < 1e-6) {
    const upd = db.prepare("UPDATE tasks SET position = ? WHERE id = ?");
    sib.forEach((x, k) => upd.run((k + 1) * 1024, x.id));
    sib = siblings(db, list, parent, except);
    i = sib.findIndex((x) => x.id === afterId);
  }
  return i + 1 < sib.length ? (sib[i].position + sib[i + 1].position) / 2 : sib[i].position + 1024;
}

// ── repeat rules: 1d 2w 1m 1y | weekdays | days:mon,thu ───────────────────
function parseRepeat(input: string): string | null {
  const s = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (s === "none" || s === "never" || s === "off") return null;
  const named: Record<string, string> = { daily: "1d", weekly: "1w", monthly: "1m", yearly: "1y", annually: "1y", weekdays: "weekdays" };
  if (named[s]) return named[s];
  const every = s.match(/^(?:every )?(\d+) ?(d|days?|w|weeks?|m|months?|y|years?)$/);
  if (every && Number(every[1]) > 0) return `${Number(every[1])}${every[2][0]}`;
  const days = s.replace(/^(days:|every )/, "").split(/[ ,]+/).map((d) => d.slice(0, 3));
  if (days.length && days.every((d) => DAYS.includes(d))) return `days:${DAYS.filter((d) => days.includes(d)).join(",")}`;
  throw new UserError(`Can't read the repeat "${input}". Use daily, weekdays, weekly, monthly, yearly, "every 2 weeks" or "mon,thu".`);
}
const weekdayOf = (date: string) => istToUtc(date, "12:00").getUTCDay();
function addMonths(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
function nextDue(rule: string, from: string): string {
  const unit = rule.match(/^(\d+)([dwmy])$/);
  if (unit) {
    const n = Number(unit[1]);
    return unit[2] === "d" ? addDays(from, n) : unit[2] === "w" ? addDays(from, 7 * n) : addMonths(from, unit[2] === "m" ? n : 12 * n);
  }
  const allowed = rule === "weekdays" ? [1, 2, 3, 4, 5] : rule.slice(5).split(",").map((d) => DAYS.indexOf(d));
  let d = addDays(from, 1);
  while (!allowed.includes(weekdayOf(d))) d = addDays(d, 1);
  return d;
}

// ── shaping ─────────────────────────────────────────────────────────────────
function shapeTask(t: any, full = false) {
  const base: Record<string, unknown> = {
    id: `t${t.id}`, title: t.title, area: t.area, status: t.status, due: t.due, time: t.due_time ?? null,
    at: t.start_at ? istTime(new Date(t.start_at)) : null, p: t.priority, owner: t.owner,
    list: t.list_id ? `l${t.list_id}` : null, parent: t.parent_id ? `t${t.parent_id}` : null,
    star: !!t.starred, repeat: t.repeat ?? null,
  };
  if (!full) return base;
  return {
    ...base, position: t.position, project: t.project, goal: t.goal ? `g${t.goal}` : null, notes: t.notes,
    start_at: t.start_at, end_at: t.end_at, source: t.source, external_id: t.external_id,
    evidence: t.evidence, created_at: t.created_at, updated_at: t.updated_at, done_at: t.done_at,
    started_at: t.started_at ?? null, estimate_minutes: t.estimate_minutes ?? null,
  };
}
function readEvents(): any[] {
  if (!existsSync(EVENTS_PATH)) return [];
  try {
    const ws = JSON.parse(readFileSync(EVENTS_PATH, "utf8"));
    return Array.isArray(ws.events) ? ws.events : [];
  } catch {
    return [];
  }
}
function eventArea(db: Database, title: string): string | null {
  const rows = db.query("SELECT slug, pattern FROM areas WHERE pattern IS NOT NULL ORDER BY sort").all() as any[];
  for (const r of rows) {
    try {
      if (new RegExp(r.pattern, "i").test(title)) return r.slug;
    } catch {
      /* a bad rule never breaks the day view */
    }
  }
  return null;
}

// ── task writes ─────────────────────────────────────────────────────────────
function scheduleFrom(a: Args, day: string | undefined) {
  const at = str(a, "at");
  if (!at) return {};
  const date = day ?? istDate(now());
  const start = istToUtc(date, parseClock(at));
  const mins = Number(str(a, "for") ?? 60);
  if (!Number.isFinite(mins) || mins <= 0) throw new UserError("--for takes minutes, like --for 45.");
  return { start_at: iso(start), end_at: iso(new Date(start.getTime() + mins * 60000)), due: date };
}
function addTask(db: Database, a: Args, status: "todo" | "inbox") {
  const title = a._.slice(1).join(" ").trim();
  if (!title) throw new UserError(`Give a title: agentos ${status === "inbox" ? "capture" : "add"} "Call the printer" --due fri`);
  const source = str(a, "source") ?? (status === "inbox" ? "capture" : "cli");
  const ext = str(a, "external-id");
  if (ext) {
    const existing = db.query("SELECT * FROM tasks WHERE source = ? AND external_id = ?").get(source, ext) as any;
    if (existing) return out({ already: true, task: shapeTask(existing) }, [`agentos show t${existing.id}`]);
  }
  const parent = str(a, "parent") ? getTask(db, taskId(str(a, "parent"))) : null;
  if (parent?.parent_id) throw new UserError(`Subtasks are one level deep; t${parent.id} is already a subtask.`);
  const proj = project(db, str(a, "project")) ?? null;
  let ar = area(db, str(a, "area")) ?? parent?.area ?? null;
  // A task goes to its parent's list, else the named list, else its area's list, else My Tasks.
  const list: number = parent?.list_id ?? listId(db, str(a, "list"))
    ?? (ar ? (db.query("SELECT id FROM lists WHERE area = ? ORDER BY sort LIMIT 1").get(ar) as any)?.id : undefined)
    ?? defaultList(db);
  // No area given: the project's area, then the list's.
  if (!ar && proj) ar = (db.query("SELECT area FROM projects WHERE slug = ?").get(proj) as any)?.area ?? null;
  if (!ar) ar = listArea(db, list);
  let due = str(a, "due") ? parseDay(str(a, "due")!) : undefined;
  const time = str(a, "time") ? parseClock(str(a, "time")!) : null;
  const repeat = str(a, "repeat") ? parseRepeat(str(a, "repeat")!) : null;
  if ((time || repeat) && !due) due = istDate(now());
  const sched = scheduleFrom(a, due);
  const stamp = iso(now());
  const prio = Number(str(a, "priority") ?? 2);
  if (![1, 2, 3].includes(prio)) throw new UserError("--priority is 1 (high), 2 or 3 (low).");
  const est = str(a, "for") ? Number(str(a, "for")) : null;
  // Like Google Tasks: new tasks land on top, new subtasks at the bottom of their parent.
  const position = edgePosition(db, list, parent?.id ?? null, parent || a.flags.bottom ? "bottom" : "top");
  const r = db.query(
    `INSERT INTO tasks (title, notes, area, project, goal, status, priority, due, start_at, end_at, owner, source, external_id,
       created_at, updated_at, estimate_minutes, list_id, parent_id, starred, position, repeat, due_time)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  ).get(
    title, str(a, "notes") ?? null, ar, proj, goalId(db, str(a, "goal")) ?? null, status, prio, sched.due ?? due ?? null,
    sched.start_at ?? null, sched.end_at ?? null, str(a, "owner") ?? "me", source, ext ?? null, stamp, stamp,
    est && Number.isFinite(est) && est > 0 ? Math.round(est) : null,
    list, parent?.id ?? null, a.flags.star ? 1 : 0, position, repeat, time,
  ) as any;
  out({ ok: true, action: status === "inbox" ? "captured" : "added", task: shapeTask(r) },
    status === "inbox"
      ? [`agentos triage t${r.id} --area <area> --due <day>`, "agentos inbox"]
      : [`agentos done t${r.id} --evidence "<proof>"`, `agentos add "<subtask>" --parent t${r.id}`]);
}

/** Where a task ends up after --list, --parent, --after, --top or --bottom; null when none were given. */
function relocate(db: Database, t: any, a: Args) {
  const l = str(a, "list"), p = str(a, "parent"), after = str(a, "after");
  if (!l && !p && !after && !a.flags.top && !a.flags.bottom) return null;
  let list: number = t.list_id ?? defaultList(db), parent: number | null = t.parent_id ?? null;
  if (l) {
    list = listId(db, l)!;
    if (list !== t.list_id) parent = null;
  }
  if (p) {
    if (p === "none") parent = null;
    else {
      const pt = getTask(db, taskId(p));
      if (pt.id === t.id) throw new UserError("A task can't be its own parent.");
      if (pt.parent_id) throw new UserError(`Subtasks are one level deep; t${pt.id} is already a subtask.`);
      parent = pt.id;
      list = pt.list_id;
    }
  }
  let position: number;
  if (after) {
    const at = getTask(db, taskId(after));
    if (at.id === t.id) throw new UserError("A task can't go after itself.");
    // Dropping after a task joins its level, the way dragging does in Google Tasks.
    if (!p) { list = at.list_id; parent = at.parent_id ?? null; }
    else if ((at.parent_id ?? null) !== parent) throw new UserError(`t${at.id} is not under that parent.`);
    position = positionAfter(db, list, parent, at.id, t.id);
  } else if (a.flags.top || a.flags.bottom) position = edgePosition(db, list, parent, a.flags.top ? "top" : "bottom", t.id);
  else if (list !== t.list_id || parent !== (t.parent_id ?? null)) position = edgePosition(db, list, parent, parent ? "bottom" : "top", t.id);
  else position = t.position;
  if (parent && db.query("SELECT 1 FROM tasks WHERE parent_id = ? AND status != 'dropped'").get(t.id))
    throw new UserError(`t${t.id} has subtasks, so it can't become one (one level only).`);
  const set: Record<string, unknown> = { list_id: list, parent_id: parent, position };
  if (list !== t.list_id) { const la = listArea(db, list); if (la) set.area = la; }
  return set;
}

function updateTask(db: Database, a: Args, forceStatus?: string) {
  const id = taskId(a._[1]);
  const t = getTask(db, id);
  const set: Record<string, unknown> = {};
  if (str(a, "title")) set.title = str(a, "title");
  if (a.flags.notes !== undefined) set.notes = str(a, "notes") ?? null;
  if (str(a, "area")) set.area = area(db, str(a, "area"));
  if (str(a, "project")) set.project = project(db, str(a, "project"));
  if (str(a, "goal")) set.goal = goalId(db, str(a, "goal"));
  if (str(a, "priority")) set.priority = Number(str(a, "priority"));
  if (str(a, "owner")) set.owner = str(a, "owner");
  if (str(a, "due")) set.due = str(a, "due") === "none" ? null : parseDay(str(a, "due")!);
  if (str(a, "time")) set.due_time = str(a, "time") === "none" ? null : parseClock(str(a, "time")!);
  if (str(a, "repeat")) set.repeat = parseRepeat(str(a, "repeat")!);
  // A time or a repeat needs a date; clearing the date clears both.
  if ((set.due_time || set.repeat) && !("due" in set ? set.due : t.due)) set.due = istDate(now());
  if (set.due === null) Object.assign(set, { due_time: null, repeat: null });
  if (a.flags.star || str(a, "starred") === "true") set.starred = 1;
  if (a.flags.unstar || str(a, "starred") === "false") set.starred = 0;
  if (str(a, "at")) Object.assign(set, scheduleFrom(a, (set.due as string) ?? t.due ?? undefined));
  if (str(a, "for") && !str(a, "at")) set.estimate_minutes = Math.round(Number(str(a, "for")));
  if (a.flags.unschedule) Object.assign(set, { start_at: null, end_at: null });
  Object.assign(set, relocate(db, t, a) ?? {});
  const status = forceStatus ?? str(a, "status");
  if (status) {
    if (!["inbox", "todo", "doing", "done", "dropped"].includes(status))
      throw new UserError("Status is inbox, todo, doing, done or dropped.");
    set.status = status;
    set.done_at = status === "done" ? (t.done_at ?? iso(now())) : null;
    if (status === "doing") set.started_at = t.started_at ?? iso(now());
  }
  if (str(a, "evidence")) set.evidence = str(a, "evidence");
  const changed = Object.entries(set).filter(([k, v]) => t[k] !== v);
  if (!changed.length) return out({ already: true, task: shapeTask(t) }, [`agentos show t${id}`]);
  const stamp = iso(now());
  let next: any = null;
  if (set.status === "done" && t.status !== "done" && t.repeat) {
    // A repeating task spawns its next instance; the rule moves with it.
    next = spawnRepeat(db, t, stamp);
    const r = changed.find(([k]) => k === "repeat");
    if (r) r[1] = null; else changed.push(["repeat", null]);
  }
  changed.push(["updated_at", stamp]);
  db.query(`UPDATE tasks SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(
    ...(changed.map(([, v]) => v) as any[]), id,
  );
  // Subtasks follow their parent: into another list, and into done or dropped.
  if (set.list_id !== undefined && set.list_id !== t.list_id)
    db.query("UPDATE tasks SET list_id = ?, area = coalesce(?, area), updated_at = ? WHERE parent_id = ?")
      .run(set.list_id as number, (set.area as string) ?? null, stamp, id);
  if (set.status === "done" || set.status === "dropped")
    db.query(`UPDATE tasks SET status = ?1, done_at = CASE WHEN ?1 = 'done' THEN ?2 ELSE NULL END, updated_at = ?2
      WHERE parent_id = ?3 AND status IN ('inbox','todo','doing')`).run(set.status as string, stamp, id);
  out({ ok: true, action: forceStatus ?? (a._[0] === "move" ? "moved" : "updated"),
    changed: changed.map(([k]) => k).filter((k) => k !== "updated_at"),
    task: shapeTask(getTask(db, id)), ...(next ? { next: shapeTask(next) } : {}) }, ["agentos", `agentos show t${id}`]);
}
function spawnRepeat(db: Database, t: any, stamp: string) {
  const due = nextDue(t.repeat, t.due ?? istDate(now()));
  let start = null, end = null;
  if (t.start_at) {
    const s = istToUtc(due, istTime(new Date(t.start_at)));
    start = iso(s);
    end = iso(new Date(s.getTime() + (new Date(t.end_at).getTime() - new Date(t.start_at).getTime())));
  }
  return db.query(
    `INSERT INTO tasks (title, notes, area, project, goal, status, priority, due, start_at, end_at, owner, source,
       created_at, updated_at, list_id, parent_id, starred, position, repeat, due_time)
     VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, 'repeat', ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  ).get(t.title, t.notes, t.area, t.project, t.goal, t.priority, due, start, end, t.owner, stamp, stamp,
    t.list_id, t.parent_id, t.starred, t.position, t.repeat, t.due_time);
}

// ── views ───────────────────────────────────────────────────────────────────
function today(db: Database, a: Args) {
  const date = str(a, "date") ? parseDay(str(a, "date")!) : istDate(now());
  const dayStart = istToUtc(date), dayEnd = istToUtc(addDays(date, 1));
  const events = readEvents()
    .filter((e) => e.start && new Date(e.start) < dayEnd && new Date(e.end ?? e.start) > dayStart)
    .map((e) => ({ kind: "event", id: e.id, title: e.title, start: e.start, end: e.end ?? e.start,
      allDay: !!e.allDay, area: eventArea(db, `${e.title} ${e.calendarName ?? ""}`), location: e.location || null }));
  const scheduled = (db.query(
    "SELECT * FROM tasks WHERE start_at < ? AND end_at > ? AND status != 'dropped' ORDER BY start_at",
  ).all(iso(dayEnd), iso(dayStart)) as any[]).map((t) => ({ kind: "task", id: `t${t.id}`, title: t.title,
    start: t.start_at, end: t.end_at, allDay: false, area: t.area, status: t.status, owner: t.owner }));
  const timeline = [...events, ...scheduled].sort((x, y) => (x.start < y.start ? -1 : 1));
  const open = "status IN ('todo','doing')";
  const due = db.query(`SELECT * FROM tasks WHERE ${open} AND due = ? AND start_at IS NULL ORDER BY priority, id`).all(date) as any[];
  const overdue = db.query(`SELECT * FROM tasks WHERE ${open} AND due < ? ORDER BY due, priority`).all(date) as any[];
  const doing = db.query("SELECT * FROM tasks WHERE status = 'doing' ORDER BY updated_at DESC").all() as any[];
  const doneToday = db.query("SELECT * FROM tasks WHERE status = 'done' AND done_at >= ? AND done_at < ? ORDER BY done_at")
    .all(iso(dayStart), iso(dayEnd)) as any[];
  const inbox = (db.query("SELECT count(*) n FROM tasks WHERE status = 'inbox'").get() as any).n;
  const data = {
    date, weekday: istParts(istToUtc(date, "12:00")).weekday, now: istTime(now()),
    timeline: JSON_OUT ? timeline : timeline.map((x) => ({ kind: x.kind, id: x.kind === "task" ? x.id : "", title: x.title,
      // Clip to this day so last night's sleep reads 00:00–05:30, not 22:00–05:30.
      from: x.allDay ? "all-day" : new Date(x.start) < dayStart ? "00:00" : istTime(new Date(x.start)),
      to: x.allDay ? "" : new Date(x.end) > dayEnd ? "24:00" : istTime(new Date(x.end)), area: x.area })),
    due: due.map((t) => shapeTask(t)), overdue: overdue.map((t) => shapeTask(t)),
    doing: doing.map((t) => shapeTask(t)), done: doneToday.map((t) => ({ ...shapeTask(t), evidence: t.evidence })),
    inbox,
    areas: db.query("SELECT slug, name, color FROM areas ORDER BY sort").all(),
  };
  if (!JSON_OUT) delete (data as any).areas;
  out(data, [
    inbox ? `agentos inbox  # ${inbox} waiting for triage` : `agentos add "<task>" --area <area> --due today`,
    overdue.length ? `agentos update t${overdue[0].id} --due today` : `agentos week`,
    `agentos done <id> --evidence "<proof>"`,
  ]);
}
function list(db: Database, a: Args) {
  const where: string[] = [], vals: any[] = [];
  const status = str(a, "status");
  if (status === "all") {} else if (status) { where.push("status = ?"); vals.push(status); }
  else where.push("status IN ('todo','doing')");
  if (str(a, "area")) { where.push("area = ?"); vals.push(area(db, str(a, "area"))); }
  if (str(a, "project")) { where.push("project = ?"); vals.push(project(db, str(a, "project"))); }
  if (str(a, "goal")) { where.push("goal = ?"); vals.push(goalId(db, str(a, "goal"))); }
  if (str(a, "owner")) { where.push("owner = ?"); vals.push(str(a, "owner")); }
  if (str(a, "before")) { where.push("due <= ?"); vals.push(parseDay(str(a, "before")!)); }
  if (str(a, "list")) { where.push("list_id = ?"); vals.push(listId(db, str(a, "list"))); }
  if (a.flags.starred) where.push("starred = 1");
  const limit = Number(str(a, "limit") ?? 50);
  const rows = db.query(
    `SELECT * FROM tasks ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY due IS NULL, due, priority, id LIMIT ?`,
  ).all(...vals, limit) as any[];
  out({ count: rows.length, tasks: rows.map((t) => shapeTask(t)) }, ["agentos show <id>", "agentos list --status all --area <area>"]);
}
function week(db: Database) {
  const start = istDate(now()), end = addDays(start, 6);
  const rows = db.query(
    "SELECT * FROM tasks WHERE status IN ('todo','doing') AND due BETWEEN ? AND ? ORDER BY due, start_at IS NULL, start_at, priority",
  ).all(start, end) as any[];
  out({ from: start, to: end, tasks: rows.map((t) => shapeTask(t)) }, ["agentos today --date tomorrow"]);
}

// ── Google-Tasks-shaped board: one list (or Starred), My order or Date ─────
const OPEN = "status IN ('inbox','todo','doing')";
function listRows(db: Database) {
  return (db.query(`SELECT l.id, l.title, l.area,
      (SELECT count(*) FROM tasks t WHERE t.list_id = l.id AND t.${OPEN}) open,
      (SELECT count(*) FROM tasks t WHERE t.list_id = l.id AND t.status = 'done') done
    FROM lists l ORDER BY l.sort, l.id`).all() as any[]).map((l) => ({ ...l, id: `l${l.id}` }));
}
function boardTask(t: any) {
  return { ...shapeTask(t), notes: t.notes ?? null, done_at: t.done_at ?? null };
}
/** Parents in order, each followed by its subtasks; subtasks whose parent isn't shown go last. */
function nest(rows: any[], order: (x: any, y: any) => number) {
  const kids = new Map<number, any[]>();
  const shown = new Set(rows.map((r) => r.id));
  const tops = rows.filter((r) => !r.parent_id || !shown.has(r.parent_id));
  for (const r of rows) if (r.parent_id && shown.has(r.parent_id)) kids.set(r.parent_id, [...(kids.get(r.parent_id) ?? []), r]);
  return tops.sort(order).flatMap((t) => [t, ...(kids.get(t.id) ?? []).sort((x, y) => x.position - y.position)]);
}
function board(db: Database, a: Args) {
  const sel = str(a, "list") ?? a._[1];
  const sort = str(a, "sort") === "date" ? "date" : "my";
  let where = "list_id = ?", vals: any[] = [];
  let list: Record<string, unknown>;
  if (sel === "starred") {
    where = "starred = 1";
    list = { id: "starred", title: "Starred", area: null };
  } else {
    const id = sel ? listId(db, sel)! : defaultList(db);
    vals = [id];
    list = { ...(db.query("SELECT title, area FROM lists WHERE id = ?").get(id) as any), id: `l${id}` };
  }
  const byPos = (x: any, y: any) => x.position - y.position || x.id - y.id;
  const byDate = (x: any, y: any) =>
    (x.due ?? "9999") < (y.due ?? "9999") ? -1 : (x.due ?? "9999") > (y.due ?? "9999") ? 1
      : (x.due_time ?? "99") < (y.due_time ?? "99") ? -1 : (x.due_time ?? "99") > (y.due_time ?? "99") ? 1 : byPos(x, y);
  const open = db.query(`SELECT * FROM tasks WHERE ${where} AND ${OPEN}`).all(...vals) as any[];
  const done = db.query(`SELECT * FROM tasks WHERE ${where} AND status = 'done' ORDER BY done_at DESC LIMIT ?`)
    .all(...vals, Number(str(a, "completed") ?? 100)) as any[];
  const doneCount = (db.query(`SELECT count(*) n FROM tasks WHERE ${where} AND status = 'done'`).get(...vals) as any).n;
  out({
    list, sort,
    open: nest(open, sort === "date" ? byDate : byPos).map(boardTask),
    completed: done.map(boardTask), completed_total: doneCount,
    lists: listRows(db),
    starred: (db.query(`SELECT count(*) n FROM tasks WHERE starred = 1 AND ${OPEN}`).get() as any).n,
  }, [`agentos add "<task>" --list ${list.id === "starred" ? "<list>" : list.id}`, "agentos move <id> --after <id>", "agentos lists"]);
}
function lists(db: Database, a: Args) {
  const sub = a._[1];
  const stamp = iso(now());
  if (sub === "add") {
    const title = a._.slice(2).join(" ").trim();
    if (!title) throw new UserError('agentos lists add "Title" [--area a]');
    const hit = db.query("SELECT id FROM lists WHERE lower(title) = lower(?)").get(title) as any;
    if (hit) return out({ already: true, list: `l${hit.id}` });
    const r = db.query("INSERT INTO lists (title, area, sort, created_at, updated_at) VALUES (?, ?, (SELECT coalesce(max(sort),0)+1 FROM lists), ?, ?) RETURNING id")
      .get(title, area(db, str(a, "area")) ?? null, stamp, stamp) as any;
    return out({ ok: true, action: "added", list: `l${r.id}` }, [`agentos add "<task>" --list l${r.id}`]);
  }
  if (sub === "rename" || sub === "area") {
    const id = listId(db, a._[2])!;
    const value = a._.slice(3).join(" ").trim();
    if (!value) throw new UserError(sub === "rename" ? 'agentos lists rename l2 "New title"' : "agentos lists area l2 <area|none>");
    const [col, v] = sub === "rename" ? ["title", value] : ["area", value === "none" ? null : area(db, value)];
    const cur = db.query(`SELECT ${col} v FROM lists WHERE id = ?`).get(id) as any;
    if (cur.v === v) return out({ already: true, list: `l${id}` });
    db.query(`UPDATE lists SET ${col} = ?, updated_at = ? WHERE id = ?`).run(v, stamp, id);
    return out({ ok: true, action: sub === "rename" ? "renamed" : "area", list: `l${id}`, [col]: v });
  }
  if (sub === "delete") {
    const id = listId(db, a._[2])!;
    if (id === defaultList(db)) throw new UserError("My Tasks is the default list and stays.");
    const open = (db.query(`SELECT count(*) n FROM tasks WHERE list_id = ? AND ${OPEN}`).get(id) as any).n;
    if (open && !a.flags.force) throw new UserError(`l${id} has ${open} open tasks. Move them, or delete anyway with --force (they are dropped).`);
    // Like Google Tasks, its tasks go with it (kept as dropped rows under My Tasks); the sync link stays so the remote list is deleted next sync.
    db.query(`UPDATE tasks SET status = 'dropped', list_id = ?, updated_at = ? WHERE list_id = ?`)
      .run(defaultList(db), stamp, id);
    db.query("DELETE FROM lists WHERE id = ?").run(id);
    return out({ ok: true, action: "deleted", list: `l${id}`, dropped: open });
  }
  out({ lists: listRows(db) }, ['agentos lists add "Title" --area <area>', "agentos tasks --list <id>"]);
}

// ── areas / projects / goals ────────────────────────────────────────────────
function areas(db: Database, a: Args) {
  const sub = a._[1];
  if (sub === "add") {
    const [slug, name] = [a._[2], a._.slice(3).join(" ")];
    if (!slug || !name) throw new UserError('agentos area add <slug> "Name" [--color #hex] [--pattern "regex"]');
    const exists = db.query("SELECT 1 FROM areas WHERE slug = ?").get(slug);
    if (exists) return out({ already: true, area: slug });
    db.query("INSERT INTO areas (slug, name, color, sort, pattern) VALUES (?, ?, ?, (SELECT coalesce(max(sort),0)+1 FROM areas), ?)")
      .run(slug, name, str(a, "color") ?? "#888888", str(a, "pattern") ?? null);
    const stamp = iso(now());
    db.query("INSERT INTO lists (title, area, sort, created_at, updated_at) SELECT ?, ?, coalesce(max(sort),0)+1, ?, ? FROM lists")
      .run(name, slug, stamp, stamp);
    return out({ ok: true, action: "added", area: slug }, [`agentos list --area ${slug}`]);
  }
  if (sub === "rule") {
    const slug = area(db, a._[2]);
    const pattern = a._.slice(3).join(" ");
    db.query("UPDATE areas SET pattern = ? WHERE slug = ?").run(pattern || null, slug!);
    return out({ ok: true, action: "rule", area: slug, pattern: pattern || null });
  }
  const week = weekMinutes(db);
  const rows = (db.query("SELECT slug, name, color, pattern FROM areas ORDER BY sort").all() as any[]).map((r) => ({
    ...r,
    open: (db.query("SELECT count(*) n FROM tasks WHERE area = ? AND status IN ('todo','doing')").get(r.slug) as any).n,
    projects: (db.query("SELECT count(*) n FROM projects WHERE area = ? AND status = 'active'").get(r.slug) as any).n,
    goals: (db.query("SELECT count(*) n FROM goals WHERE area = ? AND status = 'active'").get(r.slug) as any).n,
    week_minutes: week.byArea[r.slug] ?? 0,
  }));
  out({ from: week.from, to: week.to, areas: rows, untagged_minutes: week.untagged, untagged: week.untaggedTitles },
    ["agentos list --area <slug>", 'agentos area rule <slug> "<regex>"  # tag untagged calendar blocks']);
}
/** Minutes per area on the calendar for today and the next 6 days. Sleep is not time spent on an area. */
function weekMinutes(db: Database) {
  const from = istDate(now()), to = addDays(from, 6);
  const s = istToUtc(from), e = istToUtc(addDays(to, 1));
  const overrides = new Map(((() => { try { return db.query("SELECT * FROM event_overrides").all(); } catch { return []; } })() as any[]).map((o) => [o.event_id, o]));
  const byArea: Record<string, number> = {};
  const untaggedTitles: Record<string, number> = {};
  let untagged = 0;
  const add = (title: string, area: string | null, a: Date, b: Date) => {
    if (/\bsleep\b/i.test(title)) return;
    const m = Math.max(0, (Math.min(b.getTime(), e.getTime()) - Math.max(a.getTime(), s.getTime())) / 60000);
    if (!m) return;
    if (area) byArea[area] = (byArea[area] ?? 0) + m;
    else { untagged += m; const k = title.replace(/\s*\([^)]*\)/g, "").trim(); untaggedTitles[k] = (untaggedTitles[k] ?? 0) + m; }
  };
  for (const ev of readEvents()) {
    if (ev.allDay || !ev.start) continue;
    const o = overrides.get(ev.id);
    add(ev.title, o?.area ?? eventArea(db, `${ev.title} ${ev.calendarName ?? ""}`), new Date(o?.start_at ?? ev.start), new Date(o?.end_at ?? ev.end ?? ev.start));
  }
  for (const t of db.query("SELECT title, area, start_at, end_at FROM tasks WHERE start_at < ? AND end_at > ? AND status != 'dropped'").all(iso(e), iso(s)) as any[])
    add(t.title, t.area, new Date(t.start_at), new Date(t.end_at));
  return { from, to, byArea, untagged, untaggedTitles: Object.entries(untaggedTitles).sort((x, y) => y[1] - x[1]).map(([title, minutes]) => ({ title, minutes })) };
}

// ── life wheel: nine aspects scored 0–10 (the July 2026 life review) ──────────
const ASPECTS = [
  ["body", "Body", "self"], ["mind", "Mind", "self"], ["soul", "Soul", "self"],
  ["mission", "Mission", "work"], ["money", "Money", "work"], ["growth", "Growth", "work"],
  ["family", "Family", "people"], ["romance", "Romance", "people"], ["friends", "Friends", "people"],
] as const;
function life(db: Database, a: Args) {
  if (a._[1] === "score") {
    const scores: Record<string, number> = {};
    for (const pair of a._.slice(2)) {
      const m = pair.match(/^([a-z]+)=(\d+(?:\.5)?)$/);
      if (!m || !ASPECTS.some(([k]) => k === m[1]) || Number(m[2]) > 10)
        throw new UserError(`Score aspects as key=0..10, like body=6 mind=5. Aspects: ${ASPECTS.map(([k]) => k).join(", ")}.`);
      scores[m[1]] = Number(m[2]);
    }
    if (!Object.keys(scores).length) throw new UserError("agentos life score body=6 mind=5 soul=4 ... [--date today] [--source review]");
    const date = str(a, "date") ? parseDay(str(a, "date")!) : istDate(now());
    const source = str(a, "source") ?? "cli";
    const prev = db.query("SELECT scores FROM life_snapshots WHERE date = ? AND source = ?").get(date, source) as any;
    const merged = { ...(prev ? JSON.parse(prev.scores) : {}), ...scores };
    db.query(`INSERT INTO life_snapshots (date, source, scores, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(date, source) DO UPDATE SET scores = excluded.scores`).run(date, source, JSON.stringify(merged), iso(now()));
    return out({ ok: true, action: "scored", date, source, scores: merged }, ["agentos life"]);
  }
  const snapshots = (db.query("SELECT date, source, scores FROM life_snapshots ORDER BY date, created_at").all() as any[])
    .map((r) => ({ date: r.date, source: r.source, scores: JSON.parse(r.scores) }));
  const areaAspects: Record<string, string[]> = {};
  for (const r of db.query("SELECT area, aspect FROM life_area_aspects ORDER BY area, rank").all() as any[]) (areaAspects[r.area] ??= []).push(r.aspect);
  const feeds = Object.fromEntries(ASPECTS.map(([k]) => [k, { areas: Object.keys(areaAspects).filter((ar) => areaAspects[ar].includes(k)), open_tasks: 0 }]));
  for (const t of db.query("SELECT area, count(*) n FROM tasks WHERE status IN ('todo','doing') AND area IS NOT NULL GROUP BY area").all() as any[])
    for (const k of areaAspects[t.area] ?? []) feeds[k].open_tasks += t.n;
  const latest = snapshots.at(-1) ?? null;
  out({
    aspects: ASPECTS.map(([key, name, family]) => ({ key, name, family, score: latest?.scores[key] ?? null, ...feeds[key] })),
    latest: latest?.date ?? null, snapshots, area_aspects: areaAspects,
  }, ["agentos life score body=6 mind=5 ...", "agentos area"]);
}

// ── projects, ideas, jobs (v7) ─────────────────────────────────────────────
const projectCounts = (db: Database, slug: string) => ({
  tasks: (db.query("SELECT count(*) n FROM tasks WHERE project = ? AND status IN ('inbox','todo','doing')").get(slug) as any).n,
  ideas: (db.query("SELECT count(*) n FROM ideas WHERE project = ? AND status = 'open'").get(slug) as any).n,
  jobs: (db.query("SELECT count(*) n FROM jobs WHERE project = ? AND status IN ('starting','running','needs_input','idle')").get(slug) as any).n,
});
function shapeProject(db: Database, p: any) {
  return { slug: p.slug, name: p.name, area: p.area, status: p.status, deadline: p.deadline, link: p.link,
    description: p.description ?? null, folder: p.folder ?? null, color: p.color ?? null, icon: p.icon ?? null,
    goal: p.goal ? `g${p.goal}` : null, sort: p.sort ?? null, counts: projectCounts(db, p.slug), updatedAt: p.updated_at ?? p.created_at };
}
function shapeIdea(i: any) {
  return { id: `i${i.id}`, title: i.title, body: i.body ?? null, project: i.project ?? null, status: i.status,
    taskId: i.task_id ? `t${i.task_id}` : null, jobId: i.job_id ? `j${i.job_id}` : null, source: i.source ?? null,
    recordingId: i.recording_id ?? null, createdAt: i.created_at, updatedAt: i.updated_at };
}
function shapeJob(db: Database, j: any) {
  const taskIds = (db.query("SELECT task_id FROM job_tasks WHERE job_id = ? ORDER BY task_id").all(j.id) as any[]).map((r) => `t${r.task_id}`);
  return { id: `j${j.id}`, title: j.title, engine: j.engine, project: j.project ?? null, cwd: j.cwd ?? null, mode: j.mode ?? "auto",
    status: j.status, taskIds, ideaId: j.idea_id ? `i${j.idea_id}` : null, context: j.context ?? null, summary: j.summary ?? null,
    error: j.error ?? null, nativeId: j.native_id ?? null, createdAt: j.created_at, updatedAt: j.updated_at, finishedAt: j.finished_at ?? null };
}
/** Fields `project add` and `project set` share. "none" clears a field. */
function projectFields(db: Database, a: Args) {
  const set: [string, unknown][] = [];
  const clear = (k: string) => (str(a, k) === "none" ? null : str(a, k));
  if (str(a, "status")) {
    if (!PROJECT_STATUS.includes(str(a, "status")!)) throw new UserError(`Project status is ${PROJECT_STATUS.join(", ")}.`);
    set.push(["status", str(a, "status")]);
  }
  if (str(a, "deadline")) set.push(["deadline", str(a, "deadline") === "none" ? null : parseDay(str(a, "deadline")!)]);
  if (str(a, "link")) set.push(["link", clear("link")]);
  if (str(a, "area")) set.push(["area", str(a, "area") === "none" ? null : area(db, str(a, "area"))]);
  if (str(a, "folder")) set.push(["folder", clear("folder")]);
  if (a.flags.description !== undefined) set.push(["description", clear("description") ?? null]);
  if (str(a, "color")) set.push(["color", clear("color")]);
  if (str(a, "icon")) set.push(["icon", clear("icon")]);
  if (str(a, "goal")) set.push(["goal", str(a, "goal") === "none" ? null : goalId(db, str(a, "goal"))]);
  if (str(a, "name")) set.push(["name", str(a, "name")]);
  if (str(a, "sort")) set.push(["sort", Number(str(a, "sort"))]);
  return set;
}
function projects(db: Database, a: Args) {
  const sub = a._[1];
  const getP = (slug: string) => db.query("SELECT * FROM projects WHERE slug = ?").get(slug) as any;
  if (sub === "add") {
    const [slug, name] = [a._[2], a._.slice(3).join(" ")];
    if (!slug || !name) throw new UserError('agentos project add <slug> "Name" --area <area> [--folder <path>] [--description ".."] [--icon x] [--color #hex] [--goal g1] [--deadline fri] [--link <url|path>]');
    if (getP(slug)) return out({ already: true, project: JSON_OUT ? shapeProject(db, getP(slug)) : slug });
    const stamp = iso(now());
    db.query("INSERT INTO projects (slug, name, status, created_at, updated_at, sort) VALUES (?, ?, 'active', ?, ?, (SELECT coalesce(max(sort), 0) + 1024 FROM projects))")
      .run(slug, name, stamp, stamp);
    const set = projectFields(db, a);
    if (set.length) db.query(`UPDATE projects SET ${set.map(([k]) => `${k} = ?`).join(", ")} WHERE slug = ?`).run(...(set.map(([, v]) => v) as any[]), slug);
    return out({ ok: true, action: "added", project: JSON_OUT ? shapeProject(db, getP(slug)) : slug },
      [`agentos add "<task>" --project ${slug}`, `agentos idea add "<idea>" --project ${slug}`]);
  }
  if (sub === "set") {
    const slug = project(db, a._[2])!;
    const set = projectFields(db, a);
    if (!set.length) throw new UserError("Nothing to set. Use --status, --folder, --description, --icon, --color, --goal, --deadline, --link, --area or --name.");
    set.push(["updated_at", iso(now())]);
    db.query(`UPDATE projects SET ${set.map(([k]) => `${k} = ?`).join(", ")} WHERE slug = ?`).run(...(set.map(([, v]) => v) as any[]), slug);
    return out({ ok: true, action: "updated", project: JSON_OUT ? shapeProject(db, getP(slug)) : slug });
  }
  if (sub === "show") {
    const slug = project(db, a._[2])!;
    const tasks = db.query("SELECT * FROM tasks WHERE project = ? AND status IN ('inbox','todo','doing') ORDER BY due IS NULL, due, priority, id").all(slug) as any[];
    const ideaRows = db.query("SELECT * FROM ideas WHERE project = ? AND status = 'open' ORDER BY id DESC").all(slug) as any[];
    const jobRows = db.query("SELECT * FROM jobs WHERE project = ? ORDER BY id DESC LIMIT 50").all(slug) as any[];
    return out({ project: shapeProject(db, getP(slug)), tasks: tasks.map((t) => shapeTask(t)), ideas: ideaRows.map(shapeIdea),
      jobs: jobRows.map((j) => shapeJob(db, j)) }, [`agentos idea add "<idea>" --project ${slug}`, `agentos add "<task>" --project ${slug}`]);
  }
  const rows = db.query("SELECT * FROM projects ORDER BY status = 'archived', status, sort IS NULL, sort, deadline IS NULL, deadline").all() as any[];
  if (JSON_OUT) return out({ projects: rows.map((p) => shapeProject(db, p)) });
  out({ projects: rows.map((p) => ({ slug: p.slug, name: p.name, area: p.area, status: p.status, deadline: p.deadline, folder: p.folder ?? null,
    open: projectCounts(db, p.slug).tasks })) }, ['agentos project add <slug> "Name" --area <area> --folder <path>', "agentos project show <slug>"]);
}

const ideaNum = (input?: string) => {
  const id = Number(String(input ?? "").replace(/^i/i, ""));
  if (!Number.isInteger(id) || id <= 0) throw new UserError("Give an idea id like i12.");
  return id;
};
function getIdea(db: Database, id: number) {
  const i = db.query("SELECT * FROM ideas WHERE id = ?").get(id) as any;
  if (!i) throw new UserError(`No idea i${id}.`);
  return i;
}
/** Files a task the way the phone server does: no project and no date is the inbox; never defaults a due date. */
function insertTask(db: Database, t: { title: string; notes?: string | null; project?: string | null; due?: string | null; source: string }) {
  const ar = t.project ? ((db.query("SELECT area FROM projects WHERE slug = ?").get(t.project) as any)?.area ?? null) : null;
  const list: number = (ar ? (db.query("SELECT id FROM lists WHERE area = ? ORDER BY sort LIMIT 1").get(ar) as any)?.id : undefined) ?? defaultList(db);
  const stamp = iso(now());
  return db.query(
    `INSERT INTO tasks (title, notes, area, project, status, priority, due, owner, source, created_at, updated_at, list_id, position)
     VALUES (?, ?, ?, ?, ?, 2, ?, 'me', ?, ?, ?, ?, ?) RETURNING *`,
  ).get(t.title, t.notes ?? null, ar, t.project ?? null, !t.project && !t.due ? "inbox" : "todo", t.due ?? null, t.source,
    stamp, stamp, list, edgePosition(db, list, null, "top")) as any;
}
function ideas(db: Database, a: Args) {
  const sub = a._[1] ?? "list";
  const stamp = iso(now());
  if (sub === "add") {
    const title = a._.slice(2).join(" ").trim();
    if (!title) throw new UserError('agentos idea add "<title>" [--project s] [--body ".."] [--source cli]');
    const source = str(a, "source") ?? "cli";
    if (!IDEA_SOURCES.includes(source)) throw new UserError(`Source is ${IDEA_SOURCES.join(", ")}.`);
    const r = db.query(`INSERT INTO ideas (title, body, project, status, source, recording_id, created_at, updated_at)
      VALUES (?, ?, ?, 'open', ?, ?, ?, ?) RETURNING *`)
      .get(title, str(a, "body") ?? null, project(db, str(a, "project")) ?? null, source, str(a, "recording") ?? null, stamp, stamp) as any;
    return out({ ok: true, action: "added", idea: shapeIdea(r) }, [`agentos idea task i${r.id}`, `agentos idea set i${r.id} --project <slug>`]);
  }
  if (sub === "list" || sub === "ls") {
    const where: string[] = [], vals: any[] = [];
    const st = str(a, "status") ?? "open";
    if (st !== "all") {
      if (!IDEA_STATUS.includes(st)) throw new UserError(`Idea status is ${IDEA_STATUS.join(", ")} or all.`);
      where.push("status = ?"); vals.push(st);
    }
    if (str(a, "project")) {
      if (str(a, "project") === "none") where.push("project IS NULL");
      else { where.push("project = ?"); vals.push(project(db, str(a, "project"))); }
    }
    const rows = db.query(`SELECT * FROM ideas ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`)
      .all(...vals, Number(str(a, "limit") ?? 200)) as any[];
    return out({ count: rows.length, ideas: rows.map(shapeIdea) }, ['agentos idea add "<idea>"', "agentos idea task <id>"]);
  }
  if (sub === "show") return out({ idea: shapeIdea(getIdea(db, ideaNum(a._[2]))) });
  if (sub === "set") {
    const id = ideaNum(a._[2]);
    const cur = getIdea(db, id);
    const set: [string, unknown][] = [];
    if (str(a, "title")) set.push(["title", str(a, "title")]);
    if (a.flags.body !== undefined) set.push(["body", str(a, "body") ?? null]);
    if (str(a, "project")) set.push(["project", str(a, "project") === "none" ? null : project(db, str(a, "project"))]);
    if (str(a, "status")) {
      if (!IDEA_STATUS.includes(str(a, "status")!)) throw new UserError(`Idea status is ${IDEA_STATUS.join(", ")}.`);
      set.push(["status", str(a, "status")]);
    }
    const changed = set.filter(([k, v]) => cur[k] !== v);
    if (!changed.length) return out({ already: true, idea: shapeIdea(cur) });
    changed.push(["updated_at", stamp]);
    db.query(`UPDATE ideas SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...(changed.map(([, v]) => v) as any[]), id);
    return out({ ok: true, action: "updated", idea: shapeIdea(getIdea(db, id)) });
  }
  if (sub === "task") {
    const id = ideaNum(a._[2]);
    const cur = getIdea(db, id);
    if (cur.task_id && db.query("SELECT 1 FROM tasks WHERE id = ?").get(cur.task_id))
      return out({ already: true, idea: shapeIdea(cur), task: shapeTask(getTask(db, cur.task_id)) });
    const proj = str(a, "project") ? project(db, str(a, "project"))! : cur.project ?? null;
    const t = db.transaction(() => {
      const row = insertTask(db, { title: cur.title, notes: cur.body, project: proj, due: str(a, "due") ? parseDay(str(a, "due")!) : null, source: "idea" });
      db.query("UPDATE ideas SET status = 'tasked', task_id = ?, project = coalesce(project, ?), updated_at = ? WHERE id = ?").run(row.id, proj, stamp, id);
      return row;
    })();
    return out({ ok: true, action: "tasked", idea: shapeIdea(getIdea(db, id)), task: shapeTask(t) }, [`agentos show t${t.id}`]);
  }
  if (sub === "drop" || sub === "archive") {
    const id = ideaNum(a._[2]);
    const cur = getIdea(db, id);
    if (cur.status === "archived") return out({ already: true, idea: shapeIdea(cur) });
    db.query("UPDATE ideas SET status = 'archived', updated_at = ? WHERE id = ?").run(stamp, id);
    return out({ ok: true, action: "archived", idea: shapeIdea(getIdea(db, id)) });
  }
  throw new UserError(`Unknown idea command "${sub}". Use add, list, show, set, task or drop.`);
}
function jobsCmd(db: Database, a: Args) {
  const sub = a._[1] ?? "list";
  if (sub === "list" || sub === "ls") {
    const where: string[] = [], vals: any[] = [];
    if (str(a, "project")) { where.push("project = ?"); vals.push(project(db, str(a, "project"))); }
    if (str(a, "status")) { where.push("status = ?"); vals.push(str(a, "status")); }
    const rows = db.query(`SELECT * FROM jobs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`)
      .all(...vals, Number(str(a, "limit") ?? 50)) as any[];
    if (JSON_OUT) return out({ count: rows.length, jobs: rows.map((j) => shapeJob(db, j)) });
    return out({ count: rows.length, jobs: rows.map((j) => ({ id: `j${j.id}`, engine: j.engine, status: j.status, project: j.project, title: j.title })) },
      ["agentos job show <id>", "Jobs start from the Agentic OS app; the phone server runs them."]);
  }
  if (sub === "show") {
    const id = Number(String(a._[2] ?? "").replace(/^j/i, ""));
    const j = Number.isInteger(id) && id > 0 ? (db.query("SELECT * FROM jobs WHERE id = ?").get(id) as any) : null;
    if (!j) throw new UserError(`No job ${a._[2] ?? ""}. List them: agentos job list`);
    return out({ job: { ...shapeJob(db, j), prompt: j.prompt ?? null, sessionId: j.session_id ?? null } }, ["agentos job list"]);
  }
  throw new UserError(`Unknown job command "${sub}". Use list or show (the runner lives in the phone server).`);
}
function goals(db: Database, a: Args) {
  goalCommands(db, {
    out, area, parseDay, today: () => istDate(now()), stamp: () => iso(now()), json: () => JSON_OUT,
    fail: (msg) => { throw new UserError(msg); },
  }, a);
}

// ── sync ────────────────────────────────────────────────────────────────────
const fail = (msg: string): never => { throw new UserError(msg); };
async function sync(db: Database, a: Args) {
  const target = a._[1];
  if (target === "status" || !target) return out(syncStatus(db), ["agentos sync google-tasks", "agentos sync google-tasks --dry-run"]);
  if (target === "craft")
    throw new UserError("Craft sync needs a Craft API connection with full space access (Craft → Settings → Connections). Not set up yet.");
  if (target !== "google-tasks") throw new UserError(`Unknown sync target "${target}". Use google-tasks or status.`);
  if (a._[2] === "auth") {
    const client = str(a, "client");
    if (!client) throw new UserError("agentos sync google-tasks auth --client <path to the Desktop OAuth client_secret.json>");
    const r = await authorize(client, { open: !a.flags["no-open"], print: (l) => !JSON_OUT && console.log(l), fail });
    return out(r, ["agentos sync google-tasks --dry-run", "agentos sync google-tasks"]);
  }
  const r = await syncGoogleTasks(db, { dryRun: !!a.flags["dry-run"], fail, nowIso: () => iso(now()) });
  out(r, r.conflicts ? ["agentos sync status  # conflict log"] : ["agentos tasks", "agentos sync status"]);
}

// ── AI proposals (written by the phone app's server, read here) ────────────
function aiCmd(db: Database, a: Args) {
  const sub = a._[1];
  if (sub === "rules") {
    // Standing instructions for Plan my day, e.g. "One in-person rep a day."
    const text = a._.slice(2).join(" ").trim();
    if (text) db.query(`INSERT INTO settings (key, value, updated_at) VALUES ('ai.plan_rules', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(text === "none" ? null : text, iso(now()));
    const row = db.query("SELECT value FROM settings WHERE key = 'ai.plan_rules'").get() as any;
    return out({ ok: true, rules: row?.value ?? null }, ['agentos ai rules "<text>"  # or none to clear']);
  }
  const shapeProposal = (p: any) => ({ id: `p${p.id}`, kind: p.kind, task: p.task_id ? `t${p.task_id}` : null, status: p.status,
    reason: p.reason, ...(JSON_OUT ? { payload: JSON.parse(p.payload) } : {}) });
  if (sub === "show") {
    const id = Number(String(a._[2] ?? "").replace(/^b/i, ""));
    const b = db.query("SELECT * FROM ai_batches WHERE id = ?").get(id) as any;
    if (!b) throw new UserError(`No batch ${a._[2] ?? ""}. List them: agentos ai`);
    const ps = db.query("SELECT * FROM ai_proposals WHERE batch_id = ? ORDER BY id").all(id) as any[];
    return out({ batch: { ...b, id: `b${b.id}` }, proposals: ps.map(shapeProposal) }, ["agentos ai"]);
  }
  const rows = (db.query(`SELECT b.*, sum(p.status = 'open') open, sum(p.status = 'kept') kept, sum(p.status = 'removed') removed
    FROM ai_batches b LEFT JOIN ai_proposals p ON p.batch_id = b.id GROUP BY b.id ORDER BY b.id DESC LIMIT ?`)
    .all(Number(str(a, "limit") ?? 10)) as any[]).map((b) => ({ id: `b${b.id}`, kind: b.kind, date: b.date, status: b.status,
      open: b.open ?? 0, kept: b.kept ?? 0, removed: b.removed ?? 0, model: b.model, created_at: b.created_at }));
  out({ batches: rows }, ["agentos ai show <batch>", 'agentos ai rules "<text>"']);
}

function exportMd(db: Database) {
  const lines = [`# agentos export ${istDate(now())}`, ""];
  for (const ar of db.query("SELECT slug, name FROM areas ORDER BY sort").all() as any[]) {
    const ts = db.query("SELECT * FROM tasks WHERE area = ? AND status IN ('inbox','todo','doing') ORDER BY due IS NULL, due, priority").all(ar.slug) as any[];
    if (!ts.length) continue;
    lines.push(`## ${ar.name}`, "");
    for (const t of ts) lines.push(`- [${t.status === "doing" ? "~" : " "}] t${t.id} ${t.title}${t.due ? ` (due ${t.due})` : ""}${t.project ? ` [${t.project}]` : ""}`);
    lines.push("");
  }
  const loose = db.query("SELECT * FROM tasks WHERE area IS NULL AND status IN ('inbox','todo','doing')").all() as any[];
  if (loose.length) lines.push("## No area", "", ...loose.map((t) => `- [ ] t${t.id} ${t.title}`), "");
  console.log(lines.join("\n"));
}

const MODULE_HELP = MODULES.map((m) => m.help.trim()).join("\n");
const HELP = `agentos — Alex's life hub (tasks, projects, goals, day timeline)

agentos                         today's dashboard (same as: agentos today)
agentos today [--date fri]      timeline, due, overdue, doing, done, inbox count
agentos week                    open tasks due in the next 7 days
agentos tasks [--list l1|starred] [--sort my|date]   one list like Google Tasks: open in order, subtasks nested, completed
agentos lists [add "Title" [--area a] | rename <l> "Title" | area <l> <area|none> | delete <l> [--force]]
agentos add "<title>" [--list l] [--parent t5] [--area a] [--project p] [--goal g1] [--due fri] [--time 9am]
                      [--repeat daily|weekdays|weekly|monthly|yearly|"every 2 weeks"|mon,thu] [--star] [--bottom]
                      [--at 15:00 --for 45] [--priority 1-3] [--owner me|claude|codex|wyn] [--notes "..."]
                      [--source s --external-id x]   (same source+id twice is a no-op)
agentos capture "<raw text>"    file into the inbox for triage
agentos inbox                   untriaged captures
agentos triage <id> --area a [--due d]   inbox → todo
agentos update <id> [--title|--notes|--area|--project|--goal|--due d|none|--time t|none|--repeat r|none|--star|--unstar
                     |--at --for|--unschedule|--priority|--owner|--status]
agentos move <id> [--after <id> | --top | --bottom] [--parent <id>|none] [--list l]   reorder, nest, change list
agentos star|unstar <id>
agentos start|done|drop|reopen <id> [--evidence "<commit, link, file>"]   (done on a repeating task files the next one)
agentos delete <id>             same as drop (Google Tasks delete)
agentos list [--list l] [--starred] [--area a] [--project p] [--goal g] [--owner o] [--before d] [--status all|inbox|todo|doing|done|dropped]
agentos show <id>
agentos area [add <slug> "Name" | rule <slug> "<regex>"]
agentos project [add <slug> "Name" --area a [--folder p] [--description ".."] [--icon x] [--color #hex] [--goal g] [--deadline d] [--link l]
                | set <slug> [--status active|paused|done|archived] [same flags; none clears] | show <slug>]
agentos idea [add "<title>" [--project s] [--body ".."] [--source s] | list [--project s|none] [--status open|tasked|jobbed|archived|all]
             | show <id> | set <id> [--title --body --project --status] | task <id> [--due d] | drop <id>]
agentos job [list [--project s] [--status s] | show <id>]   Claude/Codex jobs (run by the phone server over ACP)
${GOAL_HELP}
${TERM_HELP}
agentos sync google-tasks [--dry-run]       two-way sync; first run: agentos sync google-tasks auth --client <client_secret.json>
agentos sync status                         last sync, links, recent conflicts
agentos life [score body=6 mind=5 ... [--date d]]   life wheel: nine aspects, snapshots, what feeds each
agentos ai [show <batch> | rules ["<text>"|none]]   AI proposals from the phone app (plans, inbox sorts, capture reads); rules steer Plan my day
agentos export                  markdown view of every open task by area
${MODULE_HELP ? `\nModules\n${MODULE_HELP}\n` : ""}
Dates: today, tomorrow, fri, +3d, 2026-10-24, 24-10. Times: 14:30, 9am. All times IST.
Add --json to any command for machine output. DB: ${DB_PATH}`;

// ── modules: what a module's run() gets from the core (src/modules/types.ts) ─
function modCtx(): ModCtx {
  return {
    out, jsonOut: JSON_OUT, str,
    istDate: (d = now()) => istDate(d), now, iso: (d = now()) => iso(d),
    UserError, dbPath: DB_PATH, contentDbPath: CONTENT_DB_PATH,
  };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main(argv: string[]) {
  const a = parseArgs(argv);
  JSON_OUT = !!a.flags.json;
  const cmd = a._[0] ?? "today";
  if (cmd === "help" || a.flags.help) return console.log(HELP);
  // Terminal sessions live in the phone server, not in agentos.db, so term never opens the file.
  if (cmd === "term") return await term({ out, str, fail, json: () => JSON_OUT, argv }, a);
  const db = open();
  try {
    switch (cmd) {
      case "today": return today(db, a);
      case "week": return week(db);
      case "add": return addTask(db, a, "todo");
      case "capture": return addTask(db, a, "inbox");
      case "inbox": return list(db, { ...a, flags: { ...a.flags, status: "inbox" } });
      case "triage": return updateTask(db, a, "todo");
      case "update": return updateTask(db, a);
      case "start": return updateTask(db, a, "doing");
      case "done": return updateTask(db, a, "done");
      case "drop": return updateTask(db, a, "dropped");
      case "reopen": return updateTask(db, a, "todo");
      case "list": case "ls": return list(db, a);
      case "tasks": case "board": return board(db, a);
      case "lists": return lists(db, a);
      case "move": return updateTask(db, a);
      case "star": return updateTask(db, { ...a, flags: { ...a.flags, star: true } });
      case "unstar": return updateTask(db, { ...a, flags: { ...a.flags, unstar: true } });
      case "delete": return updateTask(db, a, "dropped");
      case "sync": return await sync(db, a);
      case "show": return out({ task: shapeTask(getTask(db, taskId(a._[1])), true) }, [`agentos update ${a._[1]} --due <day>`]);
      case "area": case "areas": return areas(db, a);
      case "project": case "projects": return projects(db, a);
      case "idea": case "ideas": return ideas(db, a);
      case "job": case "jobs": return jobsCmd(db, a);
      case "goal": case "goals": return goals(db, a);
      case "life": return life(db, a);
      case "ai": return aiCmd(db, a);
      case "export": return exportMd(db);
      default: {
        // Core commands come first; anything else goes to a registered module (src/modules/index.ts).
        const mod = MODULES.find((m) => m.name === cmd);
        if (!mod) throw new UserError(`Unknown command "${cmd}". Run: agentos help`);
        return await mod.run(db, a, modCtx());
      }
    }
  } finally {
    db.close();
  }
}

try {
  await main(process.argv.slice(2));
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg }));
  else console.log(`error: ${scalar(msg)}\nhelp[1]:\n  agentos help`);
  process.exit(e instanceof UserError ? 2 : 1);
}

// One user's life hub: their agentos SQLite file plus (for the owner) the Google Calendar
// events Agentic OS syncs into workspace.json. Shapes match DESIGN.md "Data contract".
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { HORIZONS, periodOf, periodLabel, type Horizon } from "../cli/src/goals.ts";
import LIFE from "./life-defaults.json";

export const TZ = "Asia/Kolkata";
export const OFFSET = 330;
const AGENTOS = process.env.AGENTOS_BIN || "agentos";
// AGENTOS_SRC=<path to agentos.ts>: run the CLI from source with bun (v2 development), else the built exe
const AGENTOS_CMD = process.env.AGENTOS_SRC ? [process.execPath, process.env.AGENTOS_SRC] : [AGENTOS];

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const bad = (m: string) => new ApiError(400, m);
const PROJECT_STATUS = ["active", "paused", "done", "archived"];
const IDEA_STATUS = ["open", "tasked", "jobbed", "archived"];
const IDEA_SOURCES = ["app", "capture", "widget", "siri", "keyboard", "desktop", "cli", "voice", "wyn"];

const iso = (d = new Date()) => d.toISOString();
export const istDate = (d = new Date()) => new Date(d.getTime() + OFFSET * 60000).toISOString().slice(0, 10);
const istNoon = (date: string) => new Date(`${date}T12:00:00+05:30`);
const dayStartUtc = (date: string) => new Date(`${date}T00:00:00+05:30`);
const addDays = (date: string, n: number) => istDate(new Date(istNoon(date).getTime() + n * 864e5));
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isDay = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isIso = (s: unknown) => typeof s === "string" && !Number.isNaN(Date.parse(s)) && /^\d{4}-\d{2}-\d{2}T/.test(s);
const num = (id: unknown, prefix: string) => {
  const n = Number(String(id ?? "").replace(new RegExp(`^${prefix}`, "i"), ""));
  return Number.isInteger(n) && n > 0 ? n : null;
};
const text = (v: unknown, max: number, field: string) => {
  const s = String(v ?? "").trim();
  if (!s) throw bad(`${field} can't be empty.`);
  if (s.length > max) throw bad(`${field} is too long.`);
  return s;
};

// Generic areas for people who are not the owner; agentos seeds the owner's own on a new file.
const MEMBER_AREAS: [string, string, string, string, string[]][] = [
  ["work", "Work", "#5b8def", "work|meeting|call|client|office", ["mission", "money"]],
  ["study", "Study", "#7c5cff", "class|lecture|study|exam|course|tutorial", ["growth", "mind"]],
  ["health", "Health", "#4caf50", "gym|run|workout|yoga|walk|sleep|doctor", ["body"]],
  ["home", "Home + Family", "#d9822b", "home|family|mom|dad|groceries", ["family"]],
  ["personal", "Personal", "#e0559b", "friends|date|read|journal", ["soul", "friends"]],
];

/** Creates and migrates the file through the agentos CLI, so the CLI stays the schema owner. */
export function ensureDb(path: string, role: "owner" | "member") {
  const fresh = !existsSync(path);
  mkdirSync(dirname(path), { recursive: true });
  const r = Bun.spawnSync([...AGENTOS_CMD, "area", "--json"], { env: { ...process.env, AGENTOS_DB: path }, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`agentos could not open ${path}: ${r.stderr.toString() || r.stdout.toString()}`);
  const db = new Database(path);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  if (fresh && role === "member") {
    db.transaction(() => {
      // The CLI seeded one list per area (tasks v2); those reference the areas, so they go first and come back per new area.
      const hasLists = !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lists'").get();
      if (hasLists) db.exec("DELETE FROM lists WHERE area IS NOT NULL");
      db.exec("DELETE FROM areas");
      const ins = db.prepare("INSERT INTO areas (slug, name, color, sort, pattern) VALUES (?, ?, ?, ?, ?)");
      MEMBER_AREAS.forEach(([slug, name, color, pattern], i) => ins.run(slug, name, color, i, pattern));
      if (hasLists) {
        const stamp = iso();
        const list = db.prepare("INSERT INTO lists (title, area, sort, created_at, updated_at) VALUES (?, ?, ?, ?, ?)");
        MEMBER_AREAS.forEach(([slug, name], i) => list.run(name, slug, i + 1, stamp, stamp));
      }
    })();
  }
  // Seed the area→aspect map once. The owner also gets the sample life review in life-defaults.json.
  if (!(db.query("SELECT 1 FROM life_area_aspects LIMIT 1").get())) {
    const ins = db.prepare("INSERT OR IGNORE INTO life_area_aspects (area, aspect, rank) VALUES (?, ?, ?)");
    const slugs = new Set((db.query("SELECT slug FROM areas").all() as any[]).map((r) => r.slug));
    const map: Record<string, string[]> = role === "owner"
      ? (LIFE as any).areaAspects
      : Object.fromEntries(MEMBER_AREAS.map((a) => [a[0], a[4]]));
    for (const [area, aspects] of Object.entries(map)) if (slugs.has(area)) aspects.forEach((a, i) => ins.run(area, a, i));
    if (role === "owner" && !(db.query("SELECT 1 FROM life_snapshots LIMIT 1").get()))
      for (const s of (LIFE as any).snapshots) db.query("INSERT OR IGNORE INTO life_snapshots (date, source, scores, created_at) VALUES (?, ?, ?, ?)")
        .run(s.date, s.source ?? "review", JSON.stringify(s.scores), iso());
  }
  db.close();
}

// Events file is a few hundred KB; cache by mtime.
let evCache: { path: string; mtime: number; events: any[] } | null = null;
function readEvents(path: string | null): any[] {
  if (!path || !existsSync(path)) return [];
  const mtime = statSync(path).mtimeMs;
  if (evCache?.path === path && evCache.mtime === mtime) return evCache.events;
  try {
    const ws = JSON.parse(readFileSync(path, "utf8"));
    evCache = { path, mtime, events: Array.isArray(ws.events) ? ws.events : [] };
  } catch { return evCache?.events ?? []; }
  return evCache.events;
}

export function openStore(dbPath: string, eventsPath: string | null) {
  const db = new Database(dbPath);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");

  const areaRows = () => db.query("SELECT slug, name, color, pattern FROM areas ORDER BY sort").all() as any[];
  const areaExists = (slug: unknown) => slug === null || !!db.query("SELECT 1 FROM areas WHERE slug = ?").get(String(slug));
  function eventArea(title: string, rows: any[]) {
    for (const r of rows) {
      if (!r.pattern) continue;
      try { if (new RegExp(r.pattern, "i").test(title)) return r.slug; } catch { /* a bad rule never breaks the day */ }
    }
    return null;
  }

  // ── reads ────────────────────────────────────────────────────────────────
  // Schema v7 (agentos CLI): ideas, jobs, job_tasks, project folders. Older files work without them.
  let v7 = false;
  const hasV7 = () => v7 || (v7 = !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'job_tasks'").get());
  // tasks v2 (agentos CLI): steps (parent_id, one level), starred, repeat. Older files work without them.
  let taskCols: Set<string> | null = null;
  const hasTaskCol = (c: string) => (taskCols ??= new Set((db.query("PRAGMA table_info(tasks)").all() as any[]).map((r) => r.name))).has(c);
  /** taskId -> ideaId and jobIds, for the tasks being shaped (one query each, not one per task). */
  function taskLinks(ids: number[]) {
    const idea = new Map<number, string>(), jobs = new Map<number, string[]>();
    if (!ids.length || !hasV7()) return { idea, jobs };
    const marks = ids.map(() => "?").join(",");
    for (const r of db.query(`SELECT id, task_id FROM ideas WHERE task_id IN (${marks})`).all(...ids) as any[]) idea.set(r.task_id, `i${r.id}`);
    for (const r of db.query(`SELECT job_id, task_id FROM job_tasks WHERE task_id IN (${marks}) ORDER BY job_id`).all(...ids) as any[])
      jobs.set(r.task_id, [...(jobs.get(r.task_id) ?? []), `j${r.job_id}`]);
    return { idea, jobs };
  }
  function shapeTask(t: any, links?: ReturnType<typeof taskLinks>) {
    const l = links ?? taskLinks([t.id]);
    const scheduled = t.start_at && t.end_at ? { start: t.start_at, end: t.end_at } : null;
    return {
      id: `t${t.id}`, title: t.title, status: t.status, area: t.area, project: t.project,
      goal: t.goal ? `g${t.goal}` : null, due: t.due, scheduled,
      estimateMinutes: t.estimate_minutes ?? (scheduled ? Math.round((Date.parse(scheduled.end) - Date.parse(scheduled.start)) / 60000) : null),
      priority: t.priority, owner: t.owner, notes: t.notes ?? null,
      startedAt: t.started_at ?? null, completedAt: t.done_at ?? null, updatedAt: t.updated_at,
      ideaId: l.idea.get(t.id) ?? null, jobIds: l.jobs.get(t.id) ?? [],
      ...(hasTaskCol("parent_id") ? { parent: t.parent_id ? `t${t.parent_id}` : null, star: !!t.starred, repeat: t.repeat ?? null } : {}),
    };
  }
  const task = (id: number) => {
    const t = db.query("SELECT * FROM tasks WHERE id = ?").get(id);
    if (!t) throw new ApiError(404, `No task t${id}.`);
    return shapeTask(t);
  };
  function shapeTasks(rows: any[]) {
    const links = taskLinks(rows.map((r) => r.id));
    return rows.map((r) => shapeTask(r, links));
  }
  function tasks() {
    const since = iso(new Date(Date.now() - 30 * 864e5));
    return shapeTasks(db.query(`SELECT * FROM tasks WHERE status IN ('inbox','todo','doing') OR (status = 'done' AND done_at >= ?)
      ORDER BY due IS NULL, due, priority, id`).all(since) as any[]);
  }

  function progressOf(g: any, depth = 0): number {
    if (g.status === "done") return 100;
    if (g.progress_mode === "manual" || depth > 8) return g.progress;
    const kids = db.query("SELECT * FROM goals WHERE parent_id = ? AND status != 'dropped'").all(g.id) as any[];
    const ts = db.query("SELECT status FROM tasks WHERE goal = ? AND status != 'dropped'").all(g.id) as any[];
    const units = [...kids.map((k) => progressOf(k, depth + 1)), ...ts.map((t) => (t.status === "done" ? 100 : 0))];
    return units.length ? Math.round(units.reduce((x, y) => x + y, 0) / units.length) : g.progress;
  }
  function shapeGoal(g: any) {
    const h = g.horizon as Horizon;
    let aspects: string[] | null = null;
    try { aspects = g.aspects ? JSON.parse(g.aspects) : null; } catch {}
    return {
      id: `g${g.id}`, title: g.title, horizon: h, period: g.period,
      label: periodLabel(h, { key: g.period, start: g.period_start, end: g.period_end }),
      area: g.area, aspects, status: g.status, progress: progressOf(g), progressMode: g.progress_mode,
      measure: g.measure, start: g.period_start ?? String(g.created_at).slice(0, 10), end: g.period_end, due: g.due,
      parent: g.parent_id ? `g${g.parent_id}` : null, notes: g.notes,
    };
  }
  const goal = (id: number) => {
    const g = db.query("SELECT * FROM goals WHERE id = ?").get(id);
    if (!g) throw new ApiError(404, `No goal g${id}.`);
    return shapeGoal(g);
  };
  const goals = () => (db.query("SELECT * FROM goals WHERE status != 'dropped' ORDER BY period_start IS NULL, period_start, position, id").all() as any[]).map(shapeGoal);
  const horizons = (today: string) => HORIZONS.map((h) => {
    const p = periodOf(h, today);
    return { horizon: h, period: p.key, label: periodLabel(h, p) };
  });
  // ── projects and ideas (schema v7) ───────────────────────────────────────
  const LIVE_JOB = "('starting','running','needs_input','idle')";
  function projectCounts() {
    const c = (sql: string) => new Map((db.query(sql).all() as any[]).map((r) => [r.k as string, r.n as number]));
    const tasks = c("SELECT project k, count(*) n FROM tasks WHERE project IS NOT NULL AND status IN ('inbox','todo','doing') GROUP BY project");
    if (!hasV7()) return { tasks, ideas: new Map<string, number>(), jobs: new Map<string, number>() };
    return { tasks, ideas: c("SELECT project k, count(*) n FROM ideas WHERE project IS NOT NULL AND status = 'open' GROUP BY project"),
      jobs: c(`SELECT project k, count(*) n FROM jobs WHERE project IS NOT NULL AND status IN ${LIVE_JOB} GROUP BY project`) };
  }
  function shapeProject(p: any, counts = projectCounts()) {
    return { slug: p.slug, name: p.name, area: p.area ?? null, status: p.status, deadline: p.deadline ?? null, link: p.link ?? null,
      description: p.description ?? null, folder: p.folder ?? null, color: p.color ?? null, icon: p.icon ?? null,
      goal: p.goal ? `g${p.goal}` : null, sort: p.sort ?? null,
      counts: { tasks: counts.tasks.get(p.slug) ?? 0, ideas: counts.ideas.get(p.slug) ?? 0, jobs: counts.jobs.get(p.slug) ?? 0 },
      updatedAt: p.updated_at ?? p.created_at ?? null };
  }
  function projects() {
    const counts = projectCounts();
    const order = hasV7() ? "status = 'archived', sort IS NULL, sort, name" : "status, deadline IS NULL, deadline";
    return (db.query(`SELECT * FROM projects ORDER BY ${order}`).all() as any[]).map((p) => shapeProject(p, counts));
  }
  function project(slug: string) {
    const p = db.query("SELECT * FROM projects WHERE slug = ?").get(slug);
    if (!p) throw new ApiError(404, `No project ${slug}.`);
    return shapeProject(p);
  }
  const needV7 = () => { if (!hasV7()) throw new ApiError(409, "This needs agentos schema v7. Update the agentos CLI on the PC (bun run install-cli)."); };
  function shapeIdea(i: any) {
    return { id: `i${i.id}`, title: i.title, body: i.body ?? null, project: i.project ?? null, status: i.status,
      taskId: i.task_id ? `t${i.task_id}` : null, jobId: i.job_id ? `j${i.job_id}` : null, source: i.source ?? null,
      recordingId: i.recording_id ?? null, createdAt: i.created_at, updatedAt: i.updated_at };
  }
  function ideaRow(idIn: string) {
    needV7();
    const id = num(idIn, "i");
    const r = id ? (db.query("SELECT * FROM ideas WHERE id = ?").get(id) as any) : null;
    if (!r) throw new ApiError(404, "No such idea.");
    return r;
  }
  const idea = (idIn: string | number) => shapeIdea(ideaRow(String(idIn)));
  /** status: open (default), tasked, jobbed, archived or all. project: a slug, or "none" for the inbox. Inbox ideas first, newest first. */
  function ideas(q: { project?: string | null; status?: string | null } = {}) {
    if (!hasV7()) return [];
    const where: string[] = [], vals: any[] = [];
    const st = q.status || "open";
    if (st !== "all") { if (!IDEA_STATUS.includes(st)) throw bad("Bad idea status."); where.push("status = ?"); vals.push(st); }
    if (q.project === "none") where.push("project IS NULL");
    else if (q.project) { where.push("project = ?"); vals.push(q.project); }
    return (db.query(`SELECT * FROM ideas ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY project IS NOT NULL, id DESC LIMIT 500`)
      .all(...vals) as any[]).map(shapeIdea);
  }
  const projectExists = (slug: unknown) => slug == null || !!db.query("SELECT 1 FROM projects WHERE slug = ?").get(String(slug));
  function createIdea(b: any) {
    needV7();
    let title = String(b.title ?? "").trim();
    let body: string | null = b.body == null || String(b.body).trim() === "" ? null : String(b.body).slice(0, 20000);
    if (!title && body) title = body.split("\n").find((l) => l.trim())?.trim() ?? "";
    if (!title) throw bad("Title can't be empty.");
    // A long dictated idea keeps every word: the title gets the first sentence, the body the whole text.
    if (title.length > 200 && !body) {
      body = title;
      title = title.split(/(?<=[.!?])\s/)[0].slice(0, 120).trim();
      if (title.length < body.length && !/[.!?]$/.test(title)) title += "…";
    }
    title = title.slice(0, 300);
    if (b.project != null && !projectExists(b.project)) throw bad(`No project "${b.project}".`);
    const source = IDEA_SOURCES.includes(b.source) ? b.source : "app";
    const stamp = iso();
    const r = db.query(`INSERT INTO ideas (title, body, project, status, source, recording_id, created_at, updated_at)
      VALUES (?, ?, ?, 'open', ?, ?, ?, ?) RETURNING id`).get(title, body, b.project ?? null, source,
      b.recordingId ? String(b.recordingId).slice(0, 40) : null, stamp, stamp) as any;
    return idea(r.id);
  }
  function patchIdea(idIn: string, b: any) {
    const cur = ideaRow(idIn);
    const set: Record<string, unknown> = {};
    if ("title" in b) set.title = text(b.title, 300, "Title");
    if ("body" in b) set.body = b.body == null ? null : String(b.body).slice(0, 20000);
    if ("project" in b) { if (!projectExists(b.project)) throw bad(`No project "${b.project}".`); set.project = b.project ?? null; }
    if ("status" in b) { if (!IDEA_STATUS.includes(b.status)) throw bad("Bad idea status."); set.status = b.status; }
    const changed = Object.entries(set).filter(([k, v]) => cur[k] !== v);
    if (changed.length) {
      changed.push(["updated_at", iso()]);
      db.query(`UPDATE ideas SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...(changed.map(([, v]) => v) as any[]), cur.id);
    }
    return idea(cur.id);
  }
  /** Makes a task from the idea (title, body as notes, its project); the idea becomes "tasked". Twice is a no-op. */
  function ideaToTask(idIn: string, b: any) {
    const cur = ideaRow(idIn);
    if (cur.task_id && db.query("SELECT 1 FROM tasks WHERE id = ?").get(cur.task_id)) return { idea: idea(cur.id), task: task(cur.task_id) };
    const projectSlug = "project" in b ? b.project ?? null : cur.project ?? null;
    return db.transaction(() => {
      const t = createTask({ title: cur.title, notes: cur.body ?? null, ...(projectSlug ? { project: projectSlug } : {}),
        ...(b.due ? { due: b.due } : {}), ...(b.area ? { area: b.area } : {}) }, "idea");
      const tid = num(t.id, "t")!;
      db.query("UPDATE ideas SET status = 'tasked', task_id = ?, project = coalesce(project, ?), updated_at = ? WHERE id = ?")
        .run(tid, projectSlug, iso(), cur.id);
      return { idea: idea(cur.id), task: task(tid) };
    })();
  }
  /** Project detail without jobs and sessions (the server adds those, owner only). */
  function projectDetail(slug: string) {
    const p = project(slug);
    const ts = shapeTasks(db.query("SELECT * FROM tasks WHERE project = ? AND status IN ('inbox','todo','doing') ORDER BY due IS NULL, due, priority, id").all(slug) as any[]);
    return { project: p, tasks: ts, ideas: ideas({ project: slug }) };
  }

  // ── sleep: the usual night (agentos settings 'sleep.default'). It moves every sleep block that has no
  // one-night change of its own, and makes sleep blocks for accounts whose calendar has none.
  function sleepDefault(): { bed: string; wake: string } | null {
    try {
      const r = db.query("SELECT value FROM settings WHERE key = 'sleep.default'").get() as any;
      return r?.value ? JSON.parse(r.value) : null;
    } catch { return null; } // before schema v6
  }
  /** The night that starts on `night` (a date): bedtime after noon is that evening, before noon the next morning. */
  function nightSpan(night: string, bed: string, wake: string) {
    const start = new Date(`${bed >= "12:00" ? night : addDays(night, 1)}T${bed}:00+05:30`);
    const end = new Date(`${addDays(night, 1)}T${wake}:00+05:30`);
    return { start: start.toISOString(), end: end.toISOString() };
  }
  function putSleep(b: any) {
    if (b?.bed == null && b?.wake == null) {
      try { db.query("DELETE FROM settings WHERE key = 'sleep.default'").run(); } catch {}
      return { sleep: null };
    }
    const hhmm = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
    if (!hhmm(b.bed) || !hhmm(b.wake)) throw bad("bed and wake are HH:MM.");
    const span = nightSpan(istDate(), b.bed, b.wake);
    const hours = (Date.parse(span.end) - Date.parse(span.start)) / 36e5;
    if (!(hours >= 2 && hours <= 14)) throw bad("A night is between 2 and 14 hours.");
    try {
      db.query(`INSERT INTO settings (key, value, updated_at) VALUES ('sleep.default', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(JSON.stringify({ bed: b.bed, wake: b.wake }), iso());
    } catch { throw new ApiError(409, "This needs agentos schema v6. Update the agentos CLI on the PC."); }
    return { sleep: sleepDefault() };
  }
  const SLEEP = /\bsleep\b/i;
  const nightOf = (startIso: string) => {
    const d = istDate(new Date(startIso));
    return new Date(startIso).getTime() >= Date.parse(`${d}T12:00:00+05:30`) ? d : addDays(d, -1);
  };

  // Wyn's Google Calendar changes (server/wyn-calendar.ts) show at once: until the next calendar sync, her rows
  // move, rename or hide the synced event with the same Google id, and add the events she made.
  function calendarSyncedAt() {
    if (!eventsPath) return "";
    try { return String(JSON.parse(readFileSync(resolvePath(dirname(eventsPath), "native-calendar.json"), "utf8"))?.coverage?.syncedAt ?? ""); } catch { return ""; }
  }
  function wynCalendar(all: any[]) {
    if (!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'wyn_calendar'").get()) return;
    const rows = new Map((db.query("SELECT * FROM wyn_calendar WHERE updated_at > ?").all(calendarSyncedAt()) as any[]).map((r) => [r.id, r]));
    if (!rows.size) return;
    const gid = (id: string) => (String(id).startsWith("google:") ? String(id).split(":").slice(2).join(":") : "");
    for (let i = all.length - 1; i >= 0; i--) {
      const r = rows.get(gid(all[i].id));
      if (!r) continue;
      rows.delete(r.id);
      if (r.state === "cancelled") all.splice(i, 1);
      else all[i] = { ...all[i], title: r.title || all[i].title, start: r.start_at, end: r.end_at, allDay: !!r.all_day, location: r.location ?? all[i].location };
    }
    for (const r of rows.values()) if (r.state === "live" && r.origin === "wyn")
      all.push({ id: `google:wyn:${r.id}`, title: r.title, start: r.start_at, end: r.end_at, allDay: !!r.all_day, location: r.location ?? "", source: "google" });
  }

  function days(from: string, n: number) {
    const rows = areaRows();
    const overrides = new Map((db.query("SELECT * FROM event_overrides").all() as any[]).map((o) => [o.event_id, o]));
    const sd = sleepDefault();
    const all = [...readEvents(eventsPath)];
    if (sd && !all.some((ev) => SLEEP.test(ev.title ?? ""))) {
      for (let i = -1; i <= n; i++) {
        const night = addDays(from, i);
        all.push({ id: `sleep:${night}`, title: "Sleep", ...nightSpan(night, sd.bed, sd.wake), allDay: false });
      }
    }
    wynCalendar(all);
    const placed = all.map((ev) => {
      const o = overrides.get(ev.id);
      const usual = sd && !o?.start_at && ev.start && SLEEP.test(ev.title ?? "") ? nightSpan(nightOf(ev.start), sd.bed, sd.wake) : null;
      return { ...ev, start: o?.start_at ?? usual?.start ?? ev.start, end: o?.end_at ?? usual?.end ?? ev.end ?? ev.start, _area: o?.area };
    });
    return Array.from({ length: n }, (_, i) => {
      const date = addDays(from, i);
      const s = dayStartUtc(date), e = dayStartUtc(addDays(date, 1));
      const events = placed
        .filter((ev) => ev.start && new Date(ev.start) < e && new Date(ev.end) > s)
        .sort((a, b) => (a.start < b.start ? -1 : 1))
        .map((ev) => ({
          id: ev.id, title: ev.title, start: ev.start, end: ev.end, allDay: !!ev.allDay,
          area: ev._area ?? eventArea(`${ev.title} ${ev.calendarName ?? ""}`, rows), location: ev.location || null,
          source: String(ev.id).startsWith("google:") ? "google" : "agentos", editable: true,
        }));
      return { date, weekday: WD[istNoon(date).getUTCDay()], timezone: TZ, utcOffsetMinutes: OFFSET, events };
    });
  }

  function life() {
    const areaAspects: Record<string, string[]> = {};
    for (const r of db.query("SELECT area, aspect FROM life_area_aspects ORDER BY area, rank").all() as any[])
      (areaAspects[r.area] ??= []).push(r.aspect);
    const snapshots = (db.query("SELECT date, source, scores FROM life_snapshots ORDER BY date").all() as any[])
      .map((s) => ({ date: s.date, source: s.source, scores: JSON.parse(s.scores) }));
    return { families: (LIFE as any).families, aspects: (LIFE as any).aspects, areaAspects, snapshots };
  }

  // How long work really takes: start → done of tasks finished in the last 90 days, by area and by title word.
  const STOP = new Set(["the", "and", "for", "with", "from", "into", "about", "then", "this", "that", "your", "task"]);
  const titleWords = (t: string) => [...new Set(String(t).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)))];
  function estimates() {
    const since = new Date(Date.now() - 90 * 864e5).toISOString();
    const rows = db.query(`SELECT title, area, estimate_minutes, started_at, done_at, start_at, end_at FROM tasks
      WHERE status = 'done' AND done_at >= ? AND started_at IS NOT NULL`).all(since) as any[];
    const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    const r5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);
    const area: Record<string, { all: number[]; over: number[] }> = {}, word: Record<string, number[]> = {};
    for (const r of rows) {
      const actual = (Date.parse(r.done_at) - Date.parse(r.started_at)) / 60000;
      if (!(actual >= 5 && actual <= 600)) continue;
      const planned = r.estimate_minutes ?? (r.start_at && r.end_at ? (Date.parse(r.end_at) - Date.parse(r.start_at)) / 60000 : null);
      const a = (area[r.area ?? "none"] ??= { all: [], over: [] });
      a.all.push(actual);
      if (planned) a.over.push(actual / planned);
      for (const w of titleWords(r.title)) (word[w] ??= []).push(actual);
    }
    return {
      byArea: Object.fromEntries(Object.entries(area).filter(([, v]) => v.all.length >= 3)
        .map(([k, v]) => [k, { minutes: r5(med(v.all)), n: v.all.length, over: v.over.length >= 3 ? Math.round(med(v.over) * 100) / 100 : null }])),
      byWord: Object.fromEntries(Object.entries(word).filter(([, v]) => v.length >= 2).map(([k, v]) => [k, { minutes: r5(med(v)), n: v.length }])),
    };
  }

  function bootstrap() {
    const today = istDate();
    const week = days(today, 7);
    const ts = tasks();
    return {
      today: { ...week[0], now: iso(), tasks: ts, inboxCount: ts.filter((t) => t.status === "inbox").length },
      week: { from: week[0].date, to: week[6].date, timezone: TZ, days: week },
      areas: areaRows().map(({ slug, name, color }) => ({ slug, name, color })),
      goals: { horizons: horizons(today), goals: goals() },
      projects: projects(),
      ideas: ideas(),
      life: life(),
      sleep: sleepDefault(),
      estimates: estimates(),
    };
  }

  // ── writes ───────────────────────────────────────────────────────────────
  function taskFields(b: any, current: any | null) {
    const set: Record<string, unknown> = {};
    if ("title" in b) set.title = text(b.title, 500, "Title");
    if ("notes" in b) set.notes = b.notes == null ? null : String(b.notes).slice(0, 5000);
    if ("area" in b) { if (!areaExists(b.area ?? null)) throw bad(`No area "${b.area}".`); set.area = b.area ?? null; }
    if ("project" in b) {
      if (b.project != null && !db.query("SELECT 1 FROM projects WHERE slug = ?").get(String(b.project))) throw bad(`No project "${b.project}".`);
      set.project = b.project ?? null;
    }
    if ("goal" in b) {
      const g = b.goal == null ? null : num(b.goal, "g");
      if (b.goal != null && (!g || !db.query("SELECT 1 FROM goals WHERE id = ?").get(g))) throw bad(`No goal "${b.goal}".`);
      set.goal = g;
    }
    if ("due" in b) { if (b.due != null && !isDay(b.due)) throw bad("due is YYYY-MM-DD."); set.due = b.due ?? null; }
    if ("scheduled" in b) {
      const s = b.scheduled;
      if (s == null) Object.assign(set, { start_at: null, end_at: null });
      else {
        if (!isIso(s.start) || !isIso(s.end) || Date.parse(s.end) <= Date.parse(s.start)) throw bad("scheduled needs ISO start < end.");
        Object.assign(set, { start_at: new Date(s.start).toISOString(), end_at: new Date(s.end).toISOString() });
      }
    }
    if ("estimateMinutes" in b) {
      const m = b.estimateMinutes == null ? null : Math.round(Number(b.estimateMinutes));
      if (m !== null && !(m > 0 && m <= 24 * 60)) throw bad("estimateMinutes is 1–1440.");
      set.estimate_minutes = m;
    }
    if ("priority" in b) { const p = Number(b.priority ?? 2); if (![1, 2, 3].includes(p)) throw bad("priority is 1, 2 or 3."); set.priority = p; }
    if ("parent" in b && hasTaskCol("parent_id")) {
      if (b.parent == null) set.parent_id = null;
      else {
        const pid = num(b.parent, "t");
        const p = pid ? (db.query("SELECT id, parent_id, list_id FROM tasks WHERE id = ?").get(pid) as any) : null;
        if (!p) throw bad(`No task "${b.parent}".`);
        if (current && p.id === current.id) throw bad("A task can't be its own step.");
        if (p.parent_id) throw bad("Steps are one level deep.");
        if (current && db.query("SELECT 1 FROM tasks WHERE parent_id = ? AND status != 'dropped'").get(current.id)) throw bad("A task with steps can't become a step.");
        set.parent_id = p.id;
        if (p.list_id) set.list_id = p.list_id;
      }
    }
    if ("star" in b && hasTaskCol("starred")) set.starred = b.star ? 1 : 0;
    if ("repeat" in b && hasTaskCol("repeat")) {
      const r = b.repeat == null || b.repeat === "" ? null : String(b.repeat).trim().toLowerCase();
      if (r && !/^(\d{1,3}[dwmy]|weekdays|days:(sun|mon|tue|wed|thu|fri|sat)(,(sun|mon|tue|wed|thu|fri|sat))*)$/.test(r)) throw bad("repeat is 1d, 1w, 2w, 1m, 1y, weekdays or days:mon,thu.");
      set.repeat = r;
    }
    if ("status" in b) {
      if (!["inbox", "todo", "doing", "done", "dropped"].includes(b.status)) throw bad("Bad status.");
      set.status = b.status;
      set.done_at = b.status === "done" ? (isIso(b.completedAt) ? b.completedAt : current?.done_at ?? iso()) : null;
      if (b.status === "doing") set.started_at = isIso(b.startedAt) ? b.startedAt : current?.started_at ?? iso();
    }
    if ("startedAt" in b && !("status" in b)) set.started_at = isIso(b.startedAt) ? b.startedAt : null;
    if ("completedAt" in b && isIso(b.completedAt) && (set.status ?? current?.status) === "done") set.done_at = b.completedAt;
    return set;
  }
  /** New task. Without a status: no project and no date (due or scheduled) means the inbox, else todo.
   *  A due date is never filled in here; the client sends one when the user picked one. */
  function createTask(b: any, source = "app") {
    const status = b.status ?? (b.project == null && b.due == null && b.scheduled == null ? "inbox" : "todo");
    const set = taskFields({ ...b, status }, null);
    if (!set.title) throw bad("Title can't be empty.");
    if (set.project && !("area" in b)) set.area = (db.query("SELECT area FROM projects WHERE slug = ?").get(set.project) as any)?.area ?? null;
    const stamp = iso();
    const cols: Record<string, unknown> = { priority: 2, owner: "me", source, created_at: stamp, updated_at: stamp, ...set };
    // Google-Tasks lists (agentos tasks v2): file it in its area's list, else the first list, on top like the CLI does.
    if (set.parent_id && set.list_id) cols.position = ((db.query("SELECT coalesce(max(position), 0) p FROM tasks WHERE parent_id = ?").get(set.parent_id) as any).p) + 1024;
    else if (db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lists'").get()) {
      const list = ((set.area ? db.query("SELECT id FROM lists WHERE area = ? ORDER BY sort LIMIT 1").get(set.area) : null)
        ?? db.query("SELECT id FROM lists ORDER BY sort LIMIT 1").get()) as any;
      if (list) {
        cols.list_id = list.id;
        cols.position = ((db.query("SELECT coalesce(min(position), 1024) p FROM tasks WHERE list_id = ? AND parent_id IS NULL").get(list.id) as any).p) - 1024;
      }
    }
    const keys = Object.keys(cols);
    const r = db.query(`INSERT INTO tasks (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) RETURNING id`)
      .get(...(Object.values(cols) as any[])) as any;
    return task(r.id);
  }
  /** A capture from outside the app (email, the share sheet): into the inbox, or into a named list.
   *  The same source + external id twice is a no-op, so a mail fetched twice files once. */
  function captureTask(b: { title: string; notes?: string | null; area?: string | null; list?: string | null; source: string; externalId?: string | null }) {
    if (b.externalId && db.query("SELECT 1 FROM tasks WHERE source = ? AND external_id = ?").get(b.source, b.externalId)) return null;
    const stamp = iso();
    const cols: Record<string, unknown> = { title: text(b.title, 500, "Title"), notes: b.notes ? String(b.notes).slice(0, 5000) : null,
      area: b.area && areaExists(b.area) ? b.area : null, status: "inbox", priority: 2, owner: "me", source: b.source,
      external_id: b.externalId ?? null, created_at: stamp, updated_at: stamp };
    if (db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lists'").get()) {
      let list = b.list ? (db.query("SELECT id FROM lists WHERE lower(title) = lower(?)").get(b.list) as any) : null;
      if (b.list && !list) list = db.query("INSERT INTO lists (title, area, sort, created_at, updated_at) VALUES (?, ?, (SELECT coalesce(max(sort), 0) + 1 FROM lists), ?, ?) RETURNING id")
        .get(b.list, cols.area ?? null, stamp, stamp);
      list ??= db.query("SELECT id FROM lists ORDER BY sort LIMIT 1").get();
      if (list) {
        cols.list_id = list.id;
        cols.position = ((db.query("SELECT coalesce(min(position), 1024) p FROM tasks WHERE list_id = ? AND parent_id IS NULL").get(list.id) as any).p) - 1024;
      }
    }
    const keys = Object.keys(cols);
    const r = db.query(`INSERT INTO tasks (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) RETURNING id`).get(...(Object.values(cols) as any[])) as any;
    return task(r.id);
  }
  function patchTask(idIn: string, b: any) {
    const id = num(idIn, "t");
    if (!id) throw new ApiError(404, "No such task.");
    const cur = db.query("SELECT * FROM tasks WHERE id = ?").get(id) as any;
    if (!cur) throw new ApiError(404, `No task t${id}.`);
    const set = taskFields(b, cur);
    const changed = Object.entries(set).filter(([k, v]) => cur[k] !== v);
    if (changed.length) {
      // a repeating task that is done spawns its next instance (the rule moves to it), as `agentos done` does
      if (set.status === "done" && cur.status !== "done" && cur.repeat && hasTaskCol("repeat")) {
        spawnRepeat({ ...cur, ...set });
        const r = changed.find(([k]) => k === "repeat"); if (r) r[1] = null; else changed.push(["repeat", null]);
      }
      changed.push(["updated_at", iso()]);
      db.query(`UPDATE tasks SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...(changed.map(([, v]) => v) as any[]), id);
      if ((set.status === "done" || set.status === "dropped") && cur.status !== set.status && hasTaskCol("parent_id"))
        db.query(`UPDATE tasks SET status = ?1, done_at = CASE WHEN ?1 = 'done' THEN ?2 ELSE NULL END, updated_at = ?2
          WHERE parent_id = ?3 AND status IN ('inbox','todo','doing')`).run(set.status as string, iso(), id);
    }
    return task(id);
  }
  // repeat rules, as the agentos CLI writes them: 1d 2w 1m 1y · weekdays · days:mon,thu
  const DAYS3 = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const addMonths = (date: string, n: number) => {
    const [y, m, d] = date.split("-").map(Number);
    const t = new Date(Date.UTC(y, m - 1 + n, 1));
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  };
  function nextDue(rule: string, from: string) {
    const unit = rule.match(/^(\d+)([dwmy])$/);
    if (unit) { const n = Number(unit[1]); return unit[2] === "d" ? addDays(from, n) : unit[2] === "w" ? addDays(from, 7 * n) : addMonths(from, unit[2] === "m" ? n : 12 * n); }
    const allowed = rule === "weekdays" ? [1, 2, 3, 4, 5] : rule.slice(5).split(",").map((x) => DAYS3.indexOf(x));
    let d = addDays(from, 1);
    while (!allowed.includes(istNoon(d).getUTCDay())) d = addDays(d, 1);
    return d;
  }
  function spawnRepeat(t: any) {
    const due = nextDue(t.repeat, t.due ?? istDate());
    let start = null, end = null;
    if (t.start_at && t.end_at) {
      const hhmm = new Date(Date.parse(t.start_at) + OFFSET * 60000).toISOString().slice(11, 16);
      const s = new Date(`${due}T${hhmm}:00+05:30`);
      start = s.toISOString(); end = new Date(s.getTime() + (Date.parse(t.end_at) - Date.parse(t.start_at))).toISOString();
    }
    const stamp = iso();
    db.query(`INSERT INTO tasks (title, notes, area, project, goal, status, priority, due, start_at, end_at, owner, source, created_at, updated_at,
        estimate_minutes, list_id, parent_id, starred, position, repeat, due_time)
      VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, 'repeat', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(t.title, t.notes ?? null, t.area ?? null, t.project ?? null, t.goal ?? null, t.priority ?? 2, due, start, end, t.owner ?? "me", stamp, stamp,
        t.estimate_minutes ?? null, t.list_id ?? null, t.parent_id ?? null, t.starred ?? 0, t.position ?? 0, t.repeat, t.due_time ?? null);
  }

  function goalFields(b: any, cur: any | null) {
    const set: Record<string, unknown> = {};
    if ("title" in b) set.title = text(b.title, 300, "Title");
    if ("area" in b) { if (!areaExists(b.area ?? null)) throw bad(`No area "${b.area}".`); set.area = b.area ?? null; }
    if ("aspects" in b) {
      const ok = new Set((LIFE as any).aspects.map((a: any) => a.key));
      if (b.aspects != null && (!Array.isArray(b.aspects) || b.aspects.some((a: any) => !ok.has(a)))) throw bad("Unknown aspect.");
      set.aspects = b.aspects?.length ? JSON.stringify(b.aspects) : null;
    }
    if ("horizon" in b || "period" in b) {
      const h = (b.horizon ?? cur?.horizon) as Horizon;
      if (!HORIZONS.includes(h)) throw bad("Bad horizon.");
      const start = isDay(b.start) ? b.start : istDate();
      const p = periodOf(h, start);
      Object.assign(set, { horizon: h, period: b.period ?? p.key, period_start: p.start, period_end: p.end });
    }
    if ("status" in b) {
      if (!["active", "done", "dropped"].includes(b.status)) throw bad("Bad goal status.");
      set.status = b.status;
      set.done_at = b.status === "done" ? cur?.done_at ?? iso() : null;
    }
    if ("progressMode" in b) { if (!["auto", "manual"].includes(b.progressMode)) throw bad("Bad progressMode."); set.progress_mode = b.progressMode; }
    if ("progress" in b && ((set.progress_mode ?? cur?.progress_mode) === "manual" || !cur)) set.progress = Math.max(0, Math.min(100, Math.round(Number(b.progress) || 0)));
    if ("measure" in b) set.measure = b.measure == null ? null : String(b.measure).slice(0, 200);
    if ("due" in b) { if (b.due != null && !isDay(b.due)) throw bad("due is YYYY-MM-DD."); set.due = b.due ?? null; }
    if ("notes" in b) set.notes = b.notes == null ? null : String(b.notes).slice(0, 5000);
    if ("parent" in b) {
      const p = b.parent == null ? null : num(b.parent, "g");
      if (b.parent != null && (!p || !db.query("SELECT 1 FROM goals WHERE id = ?").get(p))) throw bad(`No goal "${b.parent}".`);
      if (p && cur && p === cur.id) throw bad("A goal can't be its own parent.");
      set.parent_id = p;
    }
    return set;
  }
  function createGoal(b: any) {
    const set = goalFields({ horizon: "month", ...b }, null);
    if (!set.title) throw bad("Title can't be empty.");
    const stamp = iso();
    const cols = { status: "active", progress: 0, progress_mode: "auto", position: 0, created_at: stamp, updated_at: stamp, ...set };
    const keys = Object.keys(cols);
    const r = db.query(`INSERT INTO goals (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")}) RETURNING id`)
      .get(...(Object.values(cols) as any[])) as any;
    return goal(r.id);
  }
  function patchGoal(idIn: string, b: any) {
    const id = num(idIn, "g");
    const cur = id ? (db.query("SELECT * FROM goals WHERE id = ?").get(id) as any) : null;
    if (!cur) throw new ApiError(404, "No such goal.");
    const set = goalFields(b, cur);
    const changed = Object.entries(set).filter(([k, v]) => cur[k] !== v);
    if (changed.length) {
      changed.push(["updated_at", iso()]);
      db.query(`UPDATE goals SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...(changed.map(([, v]) => v) as any[]), id);
    }
    return goal(id!);
  }

  /** POST (slugIn null) creates: the slug comes from the name, made unique; a client that sends its own slug
   *  updates that project when it exists (offline replays stay idempotent). PATCH (slugIn) updates. */
  function upsertProject(slugIn: string | null, b: any) {
    const slugify = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    let slug = slugIn ?? slugify(String(b.slug ?? b.name ?? ""));
    if (!slug) throw bad("Project needs a name.");
    if (!slugIn && !b.slug) for (let i = 2, base = slug; db.query("SELECT 1 FROM projects WHERE slug = ?").get(slug); i++) slug = `${base.slice(0, 36)}-${i}`;
    const cur = db.query("SELECT * FROM projects WHERE slug = ?").get(slug) as any;
    if (!cur && slugIn) throw new ApiError(404, `No project ${slugIn}.`);
    const set: Record<string, unknown> = {};
    if ("name" in b) set.name = text(b.name, 200, "Name");
    if ("area" in b) { if (!areaExists(b.area ?? null)) throw bad(`No area "${b.area}".`); set.area = b.area ?? null; }
    if ("status" in b) { if (!PROJECT_STATUS.includes(b.status)) throw bad(`Project status is ${PROJECT_STATUS.join(", ")}.`); set.status = b.status; }
    if ("deadline" in b) { if (b.deadline != null && !isDay(b.deadline)) throw bad("deadline is YYYY-MM-DD."); set.deadline = b.deadline ?? null; }
    if ("link" in b) set.link = b.link == null ? null : String(b.link).slice(0, 500);
    const v7 = hasV7();
    if (v7) {
      if ("description" in b) set.description = b.description == null ? null : String(b.description).slice(0, 5000);
      if ("folder" in b) {
        const f = b.folder == null || String(b.folder).trim() === "" ? null : String(b.folder).trim().replace(/[\\/]+$/, "");
        if (f && !/^([A-Za-z]:[\\/]|\\\\)/.test(f)) throw bad("folder is an absolute path on the PC, like C:\\Users\\you\\code\\app.");
        set.folder = f ? resolvePath(f) : null;
      }
      if ("color" in b) { if (b.color != null && !/^#[0-9a-fA-F]{3,8}$/.test(b.color)) throw bad("color is #hex."); set.color = b.color ?? null; }
      if ("icon" in b) set.icon = b.icon == null || b.icon === "" ? null : String(b.icon).slice(0, 16);
      if ("goal" in b) {
        const g = b.goal == null ? null : num(b.goal, "g");
        if (b.goal != null && (!g || !db.query("SELECT 1 FROM goals WHERE id = ?").get(g))) throw bad(`No goal "${b.goal}".`);
        set.goal = g;
      }
      if ("sort" in b) set.sort = b.sort == null ? null : Number(b.sort);
    }
    const stamp = iso();
    if (!cur) {
      const cols: Record<string, unknown> = { slug, name: text(b.name, 200, "Name"), status: "active", created_at: stamp, ...set };
      if (v7) Object.assign(cols, { updated_at: stamp, sort: set.sort ?? (db.query("SELECT coalesce(max(sort), 0) + 1024 s FROM projects").get() as any).s });
      const keys = Object.keys(cols);
      db.query(`INSERT INTO projects (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`).run(...(Object.values(cols) as any[]));
    } else {
      const changed = Object.entries(set).filter(([k, v]) => cur[k] !== v);
      if (changed.length) {
        if (v7) changed.push(["updated_at", stamp]);
        db.query(`UPDATE projects SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE slug = ?`).run(...(changed.map(([, v]) => v) as any[]), slug);
      }
    }
    return project(slug);
  }

  function patchEvent(id: string, b: any) {
    if (!id || id.length > 300) throw bad("Bad event id.");
    const cur = db.query("SELECT * FROM event_overrides WHERE event_id = ?").get(id) as any;
    const next = { start_at: cur?.start_at ?? null, end_at: cur?.end_at ?? null, area: cur?.area ?? null };
    if ("area" in b) { if (!areaExists(b.area ?? null)) throw bad(`No area "${b.area}".`); next.area = b.area ?? null; }
    if ("start" in b || "end" in b) {
      if (!isIso(b.start) || !isIso(b.end) || Date.parse(b.end) <= Date.parse(b.start)) throw bad("Event needs ISO start < end.");
      next.start_at = new Date(b.start).toISOString(); next.end_at = new Date(b.end).toISOString();
    }
    db.query(`INSERT INTO event_overrides (event_id, start_at, end_at, area, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(event_id) DO UPDATE SET start_at = excluded.start_at, end_at = excluded.end_at, area = excluded.area, updated_at = excluded.updated_at`)
      .run(id, next.start_at, next.end_at, next.area, iso());
    return { id, ...next };
  }

  /** Tags every future block with this title: appends it to the area's rule (same as `agentos area rule`). */
  function addAreaRule(slug: string, title: string) {
    const a = db.query("SELECT pattern FROM areas WHERE slug = ?").get(slug) as any;
    if (!a) throw new ApiError(404, `No area ${slug}.`);
    const t = text(title, 120, "Title").replace(/\s*\([^)]*\)/g, "").trim();
    const piece = `^${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`;
    const pattern = a.pattern ? (a.pattern.includes(piece) ? a.pattern : `${piece}|${a.pattern}`) : piece;
    // Earlier areas win ties, so drop the same title from other areas' rules first.
    for (const o of db.query("SELECT slug, pattern FROM areas WHERE slug != ? AND pattern LIKE ?").all(slug, `%${piece}%`) as any[])
      db.query("UPDATE areas SET pattern = ? WHERE slug = ?").run(o.pattern.split("|").filter((p: string) => p !== piece).join("|") || null, o.slug);
    db.query("UPDATE areas SET pattern = ? WHERE slug = ?").run(pattern, slug);
    return { area: slug, pattern };
  }

  function putSnapshot(b: any) {
    if (!isDay(b.date)) throw bad("date is YYYY-MM-DD.");
    const ok = new Set((LIFE as any).aspects.map((a: any) => a.key));
    const scores: Record<string, number> = {};
    for (const [k, v] of Object.entries(b.scores ?? {})) {
      if (!ok.has(k)) throw bad(`Unknown aspect ${k}.`);
      const n = Number(v);
      if (!(n >= 0 && n <= 10)) throw bad("Scores are 0–10.");
      scores[k] = Math.round(n * 2) / 2;
    }
    const source = String(b.source ?? "app").slice(0, 20);
    db.query(`INSERT INTO life_snapshots (date, source, scores, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(date, source) DO UPDATE SET scores = excluded.scores`).run(b.date, source, JSON.stringify(scores), iso());
    return { date: b.date, source, scores };
  }
  function putAreaAspects(map: Record<string, string[]>) {
    const ok = new Set((LIFE as any).aspects.map((a: any) => a.key));
    db.transaction(() => {
      db.exec("DELETE FROM life_area_aspects");
      const ins = db.prepare("INSERT INTO life_area_aspects (area, aspect, rank) VALUES (?, ?, ?)");
      for (const [area, aspects] of Object.entries(map ?? {})) {
        if (!areaExists(area)) throw bad(`No area "${area}".`);
        (aspects ?? []).filter((a) => ok.has(a)).forEach((a, i) => ins.run(area, a, i));
      }
    })();
    return life().areaAspects;
  }

  return { db, hasV7, bootstrap, days, tasks, task, shapeTasks, createTask, patchTask, projects, project, projectDetail,
    ideas, idea, createIdea, patchIdea, ideaToTask, createGoal, patchGoal, upsertProject, patchEvent, addAreaRule,
    putSnapshot, putAreaAspects, life, putSleep, captureTask, close: () => db.close() };
}
export type Store = ReturnType<typeof openStore>;

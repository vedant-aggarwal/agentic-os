// Reality ribbon (big idea 11): what the PC actually saw. The watcher in the phone app repo
// (server/bin/ribbon-watch.ts) samples the foreground window every 30 s and posts to the phone
// server, which classifies each sample into an area and a project (kept rules first, then project
// names and repo paths, then the areas' own patterns) and stores it in the tables owned here.
//   agentos ribbon [--date d]                        today's minutes per area and project
//   agentos ribbon rules [keep|drop <id>]            the rules; learned ones are pencilled (open) until kept
//   agentos ribbon rule "<pattern>" --area x [--project y]   a manual rule (regex on the window title)
//   agentos ribbon redact [<regex>]                  titles matching these are stored as [redacted]
import type { Database } from "bun:sqlite";
import type { Args, ModCtx, Module } from "./types";

export const ribbon: Module = {
  name: "ribbon",
  help: `agentos ribbon [--date d]       what your PC saw today, as minutes per area and project (the Reality ribbon)
agentos ribbon rules [keep|drop <id>]   title rules; learned ones stay pencilled until you keep them
agentos ribbon rule "<pattern>" --area <area> [--project <slug>]   add a rule (regex on the window title)
agentos ribbon redact [<regex>]  show or add title patterns that are stored as [redacted]`,
  migrate(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ribbon_samples (id INTEGER PRIMARY KEY, at TEXT NOT NULL, title TEXT, process TEXT, repo TEXT,
        session_id TEXT, area TEXT, project TEXT, task_id INTEGER, seconds INTEGER NOT NULL DEFAULT 30);
      CREATE INDEX IF NOT EXISTS ribbon_samples_at ON ribbon_samples(at);
      CREATE TABLE IF NOT EXISTS ribbon_rules (id INTEGER PRIMARY KEY, pattern TEXT NOT NULL, area TEXT, project TEXT,
        source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'kept', why TEXT, created_at TEXT NOT NULL, decided_at TEXT);
      CREATE TABLE IF NOT EXISTS ribbon_days (date TEXT PRIMARY KEY, summary TEXT NOT NULL, updated_at TEXT NOT NULL);
    `);
  },
  run(db, a, ctx) {
    const sub = a._[1];
    if (sub === "rules") return rules(db, a, ctx);
    if (sub === "rule") return addRule(db, a, ctx);
    if (sub === "redact") return redact(db, a, ctx);
    if (sub) throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos ribbon [rules|rule|redact]`);
    return today(db, a, ctx);
  },
};

// ── time ────────────────────────────────────────────────────────────────────
/** UTC ISO bounds of one IST date. */
export function dayBounds(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Bad date ${date}`);
  const from = new Date(`${date}T00:00:00+05:30`);
  return { from: from.toISOString(), to: new Date(from.getTime() + 864e5).toISOString() };
}
const istHour = (at: string) => new Date(Date.parse(at) + 330 * 60000).getUTCHours();
export const fmtMin = (m: number) => {
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`;
};

// ── rules ───────────────────────────────────────────────────────────────────
export type Rule = { id: number; pattern: string; area: string | null; project: string | null; source: string; status: string; why: string | null };
export function compileRule(pattern: string): RegExp | null {
  try { return new RegExp(pattern, "i"); } catch { return null; }
}
/** A rule matches on the window title or the process name. */
export function ruleMatches(rule: { pattern: string }, title: string | null, process: string | null) {
  const re = compileRule(rule.pattern);
  return !!re && (re.test(title ?? "") || re.test(process ?? ""));
}
/** Apply one kept rule to today's samples that have no area yet. Returns how many changed. */
export function applyRule(db: Database, rule: Rule, date: string) {
  const { from, to } = dayBounds(date);
  const rows = db.query("SELECT id, title, process FROM ribbon_samples WHERE area IS NULL AND project IS NULL AND at >= ? AND at < ?").all(from, to) as any[];
  const upd = db.prepare("UPDATE ribbon_samples SET area = ?, project = ? WHERE id = ?");
  let n = 0;
  for (const r of rows) if (ruleMatches(rule, r.title, r.process)) { upd.run(rule.area, rule.project, r.id); n++; }
  return n;
}
const projectArea = (db: Database, slug: string | null) => (slug ? ((db.query("SELECT area FROM projects WHERE slug = ?").get(slug) as any)?.area ?? null) : null);

function rules(db: Database, a: Args, ctx: ModCtx) {
  const verb = a._[2], idArg = a._[3];
  if (verb === "keep" || verb === "drop") {
    const id = Number(String(idArg ?? "").replace(/^r/, ""));
    const r = db.query("SELECT * FROM ribbon_rules WHERE id = ?").get(id) as Rule | undefined;
    if (!r) throw new ctx.UserError(`No rule ${idArg ?? ""}. List them: agentos ribbon rules`);
    const status = verb === "keep" ? "kept" : "removed";
    db.query("UPDATE ribbon_rules SET status = ?, decided_at = ? WHERE id = ?").run(status, ctx.iso(), id);
    const applied = status === "kept" ? applyRule(db, { ...r, status }, ctx.istDate()) : 0;
    return ctx.out({ ok: true, rule: shapeRule({ ...r, status }), applied }, ["agentos ribbon rules", "agentos ribbon"]);
  }
  if (verb) throw new ctx.UserError(`Use: agentos ribbon rules [keep|drop <id>]`);
  const all = a.flags.all ? "" : "WHERE status != 'removed'";
  const list = (db.query(`SELECT * FROM ribbon_rules ${all} ORDER BY status = 'open' DESC, id`).all() as Rule[]).map(shapeRule);
  ctx.out({ count: list.length, pencilled: list.filter((r) => r.status === "open").length, rules: list },
    ['agentos ribbon rule "<pattern>" --area <area> [--project <slug>]', "agentos ribbon rules keep <id>", "agentos ribbon rules --all"]);
}
const shapeRule = (r: Rule) => ({ id: `r${r.id}`, pattern: r.pattern, area: r.area, project: r.project, source: r.source, status: r.status, why: r.why ?? null });

function addRule(db: Database, a: Args, ctx: ModCtx) {
  const pattern = a._.slice(2).join(" ").trim();
  if (!pattern) throw new ctx.UserError('Give a pattern: agentos ribbon rule "pulsechat|wa-bot" --area northwind --project pulsechat');
  if (pattern.length > 200) throw new ctx.UserError("Keep the pattern under 200 characters.");
  if (!compileRule(pattern)) throw new ctx.UserError(`"${pattern}" is not a valid regular expression.`);
  const project = ctx.str(a, "project") ?? null;
  if (project && !db.query("SELECT 1 FROM projects WHERE slug = ?").get(project)) throw new ctx.UserError(`No project "${project}". See: agentos projects`);
  const area = ctx.str(a, "area") ?? projectArea(db, project);
  if (!area) throw new ctx.UserError("Give --area <area> (or a --project that has one).");
  if (!db.query("SELECT 1 FROM areas WHERE slug = ?").get(area)) throw new ctx.UserError(`No area "${area}". See: agentos areas`);
  const dup = db.query("SELECT * FROM ribbon_rules WHERE pattern = ? AND status != 'removed'").get(pattern) as Rule | undefined;
  if (dup) {
    db.query("UPDATE ribbon_rules SET area = ?, project = ?, status = 'kept', source = 'manual', decided_at = ? WHERE id = ?").run(area, project, ctx.iso(), dup.id);
    const r = db.query("SELECT * FROM ribbon_rules WHERE id = ?").get(dup.id) as Rule;
    return ctx.out({ ok: true, already: true, rule: shapeRule(r), applied: applyRule(db, r, ctx.istDate()) }, ["agentos ribbon rules"]);
  }
  const r = db.query("INSERT INTO ribbon_rules (pattern, area, project, source, status, created_at, decided_at) VALUES (?, ?, ?, 'manual', 'kept', ?, ?) RETURNING *")
    .get(pattern, area, project, ctx.iso(), ctx.iso()) as Rule;
  ctx.out({ ok: true, rule: shapeRule(r), applied: applyRule(db, r, ctx.istDate()) }, ["agentos ribbon rules", "agentos ribbon"]);
}

// ── redaction ───────────────────────────────────────────────────────────────
export function redactList(db: Database): string[] {
  const row = db.query("SELECT value FROM settings WHERE key = 'ribbon.redact'").get() as any;
  try { const v = JSON.parse(row?.value ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; }
}
function redact(db: Database, a: Args, ctx: ModCtx) {
  const list = redactList(db);
  const add = a._.slice(2).join(" ").trim();
  if (add) {
    if (!compileRule(add)) throw new ctx.UserError(`"${add}" is not a valid regular expression.`);
    if (!list.includes(add)) list.push(add);
    db.query("INSERT INTO settings (key, value, updated_at) VALUES ('ribbon.redact', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(JSON.stringify(list), ctx.iso());
    return ctx.out({ ok: true, redact: list }, ["agentos ribbon redact"]);
  }
  ctx.out({ count: list.length, redact: list, note: "Titles matching any of these are stored as [redacted]; the process name stays." },
    ['agentos ribbon redact "bank|password"']);
}

// ── today ───────────────────────────────────────────────────────────────────
export function summarize(db: Database, date: string) {
  const { from, to } = dayBounds(date);
  const rows = db.query("SELECT at, title, process, repo, session_id, area, project, task_id, seconds FROM ribbon_samples WHERE at >= ? AND at < ? ORDER BY at").all(from, to) as any[];
  const areaNames = new Map((db.query("SELECT slug, name FROM areas").all() as any[]).map((r) => [r.slug, r.name]));
  const projNames = new Map((db.query("SELECT slug, name FROM projects").all() as any[]).map((r) => [r.slug, r.name]));
  const byArea = new Map<string, number>(), byProject = new Map<string, number>(), byTitle = new Map<string, { title: string; process: string; seconds: number; area: string | null }>();
  const hours = new Map<number, Map<string, number>>();
  let total = 0, untagged = 0, away = 0;
  for (const r of rows) {
    const s = Number(r.seconds) || 30;
    if (r.process === "idle") { away += s; continue; } // nobody at the keyboard: the watcher sends an empty sample
    total += s;
    const key = r.area ?? "";
    if (!r.area) untagged += s;
    byArea.set(key, (byArea.get(key) ?? 0) + s);
    if (r.project) byProject.set(r.project, (byProject.get(r.project) ?? 0) + s);
    const tk = `${r.process ?? ""}\n${r.title ?? ""}`;
    const t = byTitle.get(tk) ?? { title: r.title ?? "", process: r.process ?? "", seconds: 0, area: r.area ?? null };
    t.seconds += s;
    byTitle.set(tk, t);
    const h = istHour(r.at), hm = hours.get(h) ?? new Map<string, number>();
    hm.set(key, (hm.get(key) ?? 0) + s);
    hours.set(h, hm);
  }
  const min = (s: number) => Math.round(s / 60);
  const areas = [...byArea].filter(([k]) => k).sort((x, y) => y[1] - x[1]).map(([area, s]) => ({ area, name: areaNames.get(area) ?? area, minutes: min(s) }));
  const projects = [...byProject].sort((x, y) => y[1] - x[1]).map(([project, s]) => ({ project, name: projNames.get(project) ?? project, minutes: min(s) }));
  const top = [...byTitle.values()].sort((x, y) => y.seconds - x.seconds).slice(0, 10).map((t) => ({ title: t.title, process: t.process, minutes: min(t.seconds), area: t.area }));
  const unknown = [...byTitle.values()].filter((t) => !t.area && t.title && t.title !== "[redacted]").sort((x, y) => y.seconds - x.seconds).slice(0, 20)
    .map((t) => ({ title: t.title, process: t.process, minutes: min(t.seconds) }));
  const actualHours = [...hours].map(([h, m]) => {
    const best = [...m].sort((x, y) => y[1] - x[1])[0];
    return { h, area: best[0] || null, minutes: min([...m.values()].reduce((a, b) => a + b, 0)) };
  }).sort((x, y) => x.h - y.h);
  const startIds = [...new Set(rows.filter((r) => r.task_id).map((r) => Number(r.task_id)))];
  const starts = startIds.map((id) => {
    const t = db.query("SELECT id, title, project, status, started_at FROM tasks WHERE id = ?").get(id) as any;
    const first = rows.find((r) => Number(r.task_id) === id)?.at;
    return { task: `t${id}`, title: t?.title ?? "(gone)", project: t?.project ?? null, status: t?.status ?? null, at: t?.started_at ?? first ?? null, source: "ribbon" };
  });
  const sessions = [...new Set(rows.map((r) => r.session_id).filter(Boolean))];
  return {
    date, samples: rows.length, minutes: min(total), watched: fmtMin(min(total)), untagged: min(untagged), away: min(away),
    firstAt: rows[0]?.at ?? null, lastAt: rows.at(-1)?.at ?? null,
    areas, projects, top, unknown, actualHours, starts, sessions,
  };
}

function today(db: Database, a: Args, ctx: ModCtx) {
  const date = ctx.str(a, "date") ?? ctx.istDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ctx.UserError("--date takes YYYY-MM-DD.");
  const s = summarize(db, date);
  const dayRow = db.query("SELECT summary, updated_at FROM ribbon_days WHERE date = ?").get(date) as any;
  let plan: any = null;
  if (dayRow) {
    try {
      const j = JSON.parse(dayRow.summary);
      const hours = Array.isArray(j.hours) ? j.hours : [];
      const planned = hours.filter((h: any) => h.planned), matched = planned.filter((h: any) => h.match);
      plan = { hoursPlanned: planned.length, hoursMatched: matched.length, updatedAt: dayRow.updated_at, ...(ctx.jsonOut ? { hours } : {}) };
    } catch {}
  }
  if (!s.samples) {
    return ctx.out({ date, samples: 0, minutes: 0, note: "No samples for this day. The watcher on your PC posts one every 30 s while it runs." },
      ["powershell -File <agentic-os>\\server\\bin\\ribbon-watch.ps1", "agentos ribbon rules"]);
  }
  const line = [
    s.projects[0] ? `${fmtMin(s.projects[0].minutes)} on ${s.projects[0].name}` : s.areas[0] ? `${fmtMin(s.areas[0].minutes)} on ${s.areas[0].name}` : null,
    s.untagged ? `${fmtMin(s.untagged)} untagged` : null,
  ].filter(Boolean).join(", ");
  ctx.out({
    date, watched: s.watched, samples: s.samples, untagged: fmtMin(s.untagged), away: fmtMin(s.away), summary: line || s.watched,
    firstAt: s.firstAt, lastAt: s.lastAt,
    areas: ctx.jsonOut ? s.areas : s.areas.map((x) => ({ area: x.area, minutes: x.minutes })),
    projects: ctx.jsonOut ? s.projects : s.projects.map((x) => ({ project: x.project, minutes: x.minutes })),
    ...(plan ? { plan } : {}),
    ...(s.starts.length ? { started: s.starts } : {}),
    ...(ctx.jsonOut ? { top: s.top, unknown: s.unknown, actualHours: s.actualHours, sessions: s.sessions } : { unknownTitles: s.unknown.length }),
  }, ["agentos ribbon rules", 'agentos ribbon rule "<pattern>" --area <area>', "agentos ribbon --json  # titles, hours and sessions"]);
}

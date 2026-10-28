// Reality ribbon (big idea 11), server side. The watcher on this PC (server/bin/ribbon-watch.ts, started by
// ribbon-watch.ps1) posts foreground-window samples here on loopback with the agent token. This module
// redacts (settings key ribbon.redact), classifies (kept rules, then project repo paths and names, then the
// areas' own patterns) and stores them in the owner's agentos db (tables from the CLI's ribbon module),
// starts a task by itself when its project's repo has been in front for 10 minutes, rolls today up against
// the plan every 15 minutes, and once an hour asks Haiku for rules for titles nothing matched (pencilled
// until kept on the page). Nothing leaves the PC.
//   POST /samples                { samples: [{ at, title, process, repo, session_id, seconds }] }
//   GET  /sessions               Claude sessions the server knows from the wyn plugin hooks (live first)
//   GET  /today?date=YYYY-MM-DD  minutes per area and project, plan vs actual per hour, unknown titles, pencilled rules
//   GET  /rules · POST /rules { pattern, area, project } · POST /rules/:id/keep · POST /rules/:id/drop
//   GET  /settings · PUT /settings { redact: [regex] }
//   POST /rollup · POST /learn   run the jobs now
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { JobCtx, ModCtx, Module } from "./types";

const OFFSET = 330;
const istDate = (d = new Date()) => new Date(d.getTime() + OFFSET * 60000).toISOString().slice(0, 10);
const istMinutes = (iso: string, date: string) => Math.round((Date.parse(iso) - Date.parse(`${date}T00:00:00+05:30`)) / 60000);
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
export function dayBounds(date: string) {
  const from = new Date(`${date}T00:00:00+05:30`);
  return { from: from.toISOString(), to: new Date(from.getTime() + 864e5).toISOString() };
}
const SLEEP = /\bsleep\b/i;
const START_MIN = 10;          // a project's repo in front this long starts its next task
const LEARN_MIN_SECONDS = 120; // an unknown title needs this much time before Haiku sees it
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const re = (p: string, flags = "i") => { try { return new RegExp(p, flags); } catch { return null; } };
const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

// ── what a sample is classified against ─────────────────────────────────────
export type Knowledge = {
  rules: { id: number; re: RegExp; area: string | null; project: string | null }[];
  projects: { slug: string; name: string; area: string | null; path: string | null; words: RegExp | null }[];
  areas: { slug: string; re: RegExp | null }[];
  redact: RegExp[];
};
export function knowledgeOf(db: Database): Knowledge {
  const rules = (db.query("SELECT id, pattern, area, project FROM ribbon_rules WHERE status = 'kept' ORDER BY id").all() as any[])
    .flatMap((r) => { const x = re(r.pattern); return x ? [{ id: r.id, re: x, area: r.area ?? null, project: r.project ?? null }] : []; });
  const projects = (db.query("SELECT slug, name, area, link FROM projects WHERE status = 'active' OR status IS NULL").all() as any[]).map((p) => {
    const link = String(p.link ?? "");
    const name = String(p.name ?? "").trim();
    return {
      slug: String(p.slug), name, area: p.area ?? null,
      path: /^[a-z]:[\\/]/i.test(link) ? norm(link) : null,
      words: name.length >= 3 ? re(`\\b${esc(name)}\\b`) : null,
    };
  });
  const areas = (db.query("SELECT slug, pattern FROM areas ORDER BY sort").all() as any[]).map((a) => ({ slug: String(a.slug), re: a.pattern ? re(a.pattern) : null }));
  return { rules, projects, areas, redact: redactList(db).flatMap((p) => { const x = re(p); return x ? [x] : []; }) };
}
export function redactList(db: Database): string[] {
  try {
    const row = db.query("SELECT value FROM settings WHERE key = 'ribbon.redact'").get() as any;
    const v = JSON.parse(row?.value ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}
/** Area and project for one sample. Pure, so it can be tested without a server. */
export function classify(s: { title: string; process: string; repo: string | null }, k: Knowledge): { area: string | null; project: string | null; via: "rule" | "repo" | "project" | "area" | null } {
  const areaOf = (slug: string | null) => (slug ? k.projects.find((p) => p.slug === slug)?.area ?? null : null);
  for (const r of k.rules) if (r.re.test(s.title) || (s.process && r.re.test(s.process))) return { area: r.area ?? areaOf(r.project), project: r.project, via: "rule" };
  if (s.repo) {
    const repo = norm(s.repo), base = basename(repo);
    for (const p of k.projects) if (p.path && (repo === p.path || repo.startsWith(`${p.path}/`) || p.path.startsWith(`${repo}/`))) return { area: p.area, project: p.slug, via: "repo" };
    const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const p of k.projects) {
      // A worktree is named <repo>-<branch>, so the slug may be a prefix of the folder name.
      if (base === p.slug || (p.slug.length >= 4 && base.startsWith(`${p.slug}-`)) || (p.name.length >= 4 && squash(base) === squash(p.name))) return { area: p.area, project: p.slug, via: "repo" };
    }
  }
  for (const p of k.projects) if (p.words?.test(s.title)) return { area: p.area, project: p.slug, via: "project" };
  for (const a of k.areas) if (a.re?.test(s.title)) return { area: a.slug, project: null, via: "area" };
  return { area: null, project: null, via: null };
}
export const redactTitle = (title: string, k: Pick<Knowledge, "redact">) => (k.redact.some((x) => x.test(title)) ? "[redacted]" : title);

// ── tables: the CLI owns the schema; make sure its migrate ran on this db ─────
const hasTables = (db: Database) => !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ribbon_samples'").get();
async function ensure(ctx: JobCtx) {
  if (hasTables(ctx.db())) return;
  await ctx.agentos(["mods"]); // every module's migrate() runs on any CLI call
  if (!hasTables(ctx.db())) throw new Error("The agentos CLI in use has no ribbon module; build it from feat/mod-observe and point AGENTOS_BIN at it.");
}

// ── the watcher's heartbeat, so the pages can say whether it is running ─────
const statusFile = (ctx: JobCtx) => join(ctx.dataDir, "mod", "ribbon", "watch.json");
function readStatus(ctx: JobCtx) {
  try { return JSON.parse(readFileSync(statusFile(ctx), "utf8")); } catch { return {}; }
}
function writeStatus(ctx: JobCtx, patch: Record<string, unknown>) {
  const f = statusFile(ctx);
  try {
    mkdirSync(join(ctx.dataDir, "mod", "ribbon"), { recursive: true });
    writeFileSync(`${f}.tmp`, JSON.stringify({ ...readStatus(ctx), ...patch }, null, 1));
    renameSync(`${f}.tmp`, f);
  } catch {}
}
function watcherState(ctx: JobCtx) {
  const s = readStatus(ctx);
  const last = typeof s.lastPostAt === "string" ? Date.parse(s.lastPostAt) : NaN;
  return { alive: Number.isFinite(last) && Date.now() - last < 3 * 60_000, lastPostAt: s.lastPostAt ?? null, lastSampleAt: s.lastSampleAt ?? null, posted: Number(s.posted ?? 0) };
}

// ── ingest ──────────────────────────────────────────────────────────────────
async function ingest(ctx: ModCtx) {
  const b = await ctx.body();
  const list: any[] = Array.isArray(b?.samples) ? b.samples.slice(0, 500) : [];
  if (!list.length) return ctx.fail(400, "Send { samples: [...] }.");
  const db = ctx.db(), k = knowledgeOf(db);
  const ins = db.prepare("INSERT INTO ribbon_samples (at, title, process, repo, session_id, area, project, seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const dup = db.prepare("SELECT 1 FROM ribbon_samples WHERE at = ? AND process IS ?");
  let stored = 0, tagged = 0, lastSampleAt: string | null = null;
  db.transaction(() => {
    for (const raw of list) {
      const at = typeof raw?.at === "string" && Number.isFinite(Date.parse(raw.at)) && Math.abs(Date.now() - Date.parse(raw.at)) < 7 * 864e5 ? new Date(raw.at).toISOString() : new Date().toISOString();
      const title = String(raw?.title ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
      const process = String(raw?.process ?? "").trim().slice(0, 60) || null;
      const repo = raw?.repo ? String(raw.repo).trim().slice(0, 300) : null;
      const session = raw?.session_id ? String(raw.session_id).replace(/[^\w-]/g, "").slice(0, 80) : null;
      const seconds = Math.min(300, Math.max(1, Math.round(Number(raw?.seconds) || 30)));
      if (dup.get(at, process)) continue;
      const c = classify({ title, process: process ?? "", repo }, k);
      ins.run(at, redactTitle(title, k), process, repo, session, c.area, c.project, seconds);
      stored++;
      if (c.area || c.project) tagged++;
      if (!lastSampleAt || at > lastSampleAt) lastSampleAt = at;
    }
  })();
  const st = readStatus(ctx);
  writeStatus(ctx, { lastPostAt: new Date().toISOString(), lastSampleAt: lastSampleAt ?? st.lastSampleAt ?? null, posted: Number(st.posted ?? 0) + stored });
  const started = await autoStart(ctx);
  return ctx.json({ ok: true, stored, tagged, started });
}

/** A project's repo in front for START_MIN minutes starts its next open task (once per project per day). */
async function autoStart(ctx: JobCtx) {
  const db = ctx.db();
  const since = new Date(Date.now() - START_MIN * 60_000).toISOString();
  const rows = db.query(`SELECT project, sum(seconds) AS s, min(at) AS first, max(at) AS last FROM ribbon_samples
    WHERE at >= ? AND project IS NOT NULL AND repo IS NOT NULL GROUP BY project`).all(since) as any[];
  const started: { task: string; title: string; project: string; source: "ribbon" }[] = [];
  const { from } = dayBounds(istDate());
  for (const r of rows) {
    if (Number(r.s) < START_MIN * 60 || Date.parse(r.last) - Date.parse(r.first) < (START_MIN - 1) * 60_000) continue;
    if (db.query("SELECT 1 FROM tasks WHERE project = ? AND status = 'doing'").get(r.project)) continue;          // already on it
    if (db.query("SELECT 1 FROM ribbon_samples WHERE project = ? AND task_id IS NOT NULL AND at >= ?").get(r.project, from)) continue; // one a day
    const t = db.query(`SELECT id, title FROM tasks WHERE project = ? AND status = 'todo' AND started_at IS NULL AND parent_id IS NULL
      ORDER BY due IS NULL, due, priority, id LIMIT 1`).get(r.project) as any;
    if (!t) continue;
    try {
      await ctx.agentos(["start", `t${t.id}`]);
      db.query("UPDATE ribbon_samples SET task_id = ? WHERE project = ? AND at >= ? AND task_id IS NULL").run(t.id, r.project, since);
      ctx.log(`started t${t.id} "${t.title}" (source: ribbon; ${r.project} in front for ${Math.round(Number(r.s) / 60)} min)`);
      started.push({ task: `t${t.id}`, title: t.title, project: r.project, source: "ribbon" });
      ctx.push("Started from your repo", `t${t.id} ${t.title}`, { task: `t${t.id}` }).catch(() => {});
    } catch (e: any) { ctx.log(`could not start t${t.id}: ${e?.message ?? e}`); }
  }
  return started;
}

// ── the day: minutes per area and project, plan vs actual per hour ──────────
type Block = { area: string | null; s: number; e: number };
/** Per hour, the area with the most minutes among `blocks` (minutes since midnight IST). "" stands for untagged. */
export function hourWinner(blocks: Block[], h: number) {
  const m = new Map<string, number>();
  let total = 0;
  for (const b of blocks) {
    const o = Math.min(b.e, h * 60 + 60) - Math.max(b.s, h * 60);
    if (o <= 0) continue;
    total += o;
    m.set(b.area ?? "", (m.get(b.area ?? "") ?? 0) + o);
  }
  const best = [...m].sort((x, y) => y[1] - x[1])[0];
  return { area: best ? best[0] : null, minutes: Math.round(total), untagged: Math.round(m.get("") ?? 0) };
}
export function rollup(ctx: JobCtx, date: string) {
  const db = ctx.db();
  const { from, to } = dayBounds(date);
  const rows = db.query("SELECT at, title, process, repo, session_id, area, project, task_id, seconds FROM ribbon_samples WHERE at >= ? AND at < ? ORDER BY at").all(from, to) as any[];
  const byArea: Record<string, number> = {}, byProject: Record<string, number> = {}, byTitle = new Map<string, { title: string; process: string; s: number; area: string | null; project: string | null }>();
  const actual: Block[] = [];
  let total = 0, untagged = 0, away = 0;
  for (const r of rows) {
    const s = Number(r.seconds) || 30;
    if (r.process === "idle") { away += s; const m0 = istMinutes(r.at, date); actual.push({ area: "idle", s: m0, e: m0 + s / 60 }); continue; } // nobody at the keyboard
    total += s;
    if (!r.area) untagged += s;
    byArea[r.area ?? ""] = (byArea[r.area ?? ""] ?? 0) + s;
    if (r.project) byProject[r.project] = (byProject[r.project] ?? 0) + s;
    const key = `${r.process ?? ""}\n${r.title ?? ""}`;
    const t = byTitle.get(key) ?? { title: r.title ?? "", process: r.process ?? "", s: 0, area: r.area ?? null, project: r.project ?? null };
    t.s += s;
    byTitle.set(key, t);
    const m = istMinutes(r.at, date);
    actual.push({ area: r.area ?? null, s: m, e: m + s / 60 });
  }
  // The plan: timeline blocks (sleep and all-day left out) and scheduled tasks; only the week ahead is known.
  const plan: Block[] = [];
  let planned = false;
  try {
    const b = ctx.store.bootstrap();
    const day = b.week.days.find((d: any) => d.date === date);
    if (day) {
      planned = true;
      for (const ev of day.events) if (!ev.allDay && !SLEEP.test(ev.title ?? "")) plan.push({ area: ev.area ?? null, s: istMinutes(ev.start, date), e: istMinutes(ev.end, date) });
      for (const t of b.today.tasks) if (t.scheduled && t.status !== "dropped" && istDate(new Date(t.scheduled.start)) === date)
        plan.push({ area: t.area ?? null, s: istMinutes(t.scheduled.start, date), e: istMinutes(t.scheduled.end, date) });
    }
  } catch (e: any) { ctx.log(`plan unavailable: ${e?.message ?? e}`); }
  for (const bl of [...plan, ...actual]) { bl.s = Math.max(0, bl.s); bl.e = Math.min(1440, bl.e); }
  const hours = [];
  for (let h = 0; h < 24; h++) {
    const p = hourWinner(plan.filter((x) => x.e > x.s), h), a = hourWinner(actual.filter((x) => x.e > x.s), h);
    if (!p.minutes && !a.minutes) continue;
    const pa = p.area || null, aa = a.area || null; // aa is an area slug, "idle" (away), or null (untagged)
    hours.push({ h, planned: pa, plannedMin: p.minutes, actual: aa, actualMin: a.minutes, actualUntagged: a.untagged, match: !!pa && pa === aa });
  }
  const min = (s: number) => Math.round(s / 60);
  const startIds = [...new Set(rows.filter((r) => r.task_id).map((r) => Number(r.task_id)))];
  const starts = startIds.map((id) => {
    const t = db.query("SELECT id, title, project, status, started_at FROM tasks WHERE id = ?").get(id) as any;
    return { task: `t${id}`, title: t?.title ?? "(gone)", project: t?.project ?? null, status: t?.status ?? null, at: t?.started_at ?? rows.find((r) => Number(r.task_id) === id)?.at ?? null, source: "ribbon" };
  });
  const titles = [...byTitle.values()].sort((x, y) => y.s - x.s);
  const summary = {
    date, samples: rows.length, minutes: min(total), untagged: min(untagged), away: min(away), firstAt: rows[0]?.at ?? null, lastAt: rows.at(-1)?.at ?? null,
    byArea: Object.fromEntries(Object.entries(byArea).filter(([k]) => k).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, min(v)])),
    byProject: Object.fromEntries(Object.entries(byProject).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, min(v)])),
    hours, plan: { known: planned, hoursPlanned: hours.filter((h) => h.planned).length, hoursMatched: hours.filter((h) => h.match).length },
    starts, top: titles.slice(0, 8).map((t) => ({ title: t.title, process: t.process, minutes: min(t.s), area: t.area, project: t.project })),
    sessions: [...new Set(rows.map((r) => r.session_id).filter(Boolean))],
    updatedAt: new Date().toISOString(),
  };
  db.query("INSERT INTO ribbon_days (date, summary, updated_at) VALUES (?, ?, ?) ON CONFLICT(date) DO UPDATE SET summary = excluded.summary, updated_at = excluded.updated_at")
    .run(date, JSON.stringify(summary), summary.updatedAt);
  return summary;
}
function unknownTitles(db: Database, from: string, to: string, limit = 20) {
  return (db.query(`SELECT title, process, sum(seconds) AS s FROM ribbon_samples WHERE at >= ? AND at < ? AND area IS NULL AND project IS NULL
    AND title != '' AND title != '[redacted]' AND process != 'idle' GROUP BY title, process ORDER BY s DESC LIMIT ?`).all(from, to, limit) as any[])
    .map((r) => ({ title: r.title, process: r.process, minutes: Math.round(Number(r.s) / 60) }));
}
const shapeRule = (r: any) => ({ id: `r${r.id}`, pattern: r.pattern, area: r.area, project: r.project, source: r.source, status: r.status, why: r.why ?? null, createdAt: r.created_at });

// ── learn: unknown titles → one Haiku call → pencilled rules ────────────────
const LEARN_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { rules: { type: "array", maxItems: 8, items: { type: "object", additionalProperties: false,
    properties: { pattern: { type: "string" }, area: { type: "string" }, project: { type: ["string", "null"] }, why: { type: "string" } },
    required: ["pattern", "area", "project", "why"] } } },
  required: ["rules"],
};
const seenFile = (ctx: JobCtx) => join(ctx.dataDir, "mod", "ribbon", "learned.json");
export async function learn(ctx: JobCtx, force = false) {
  const db = ctx.db();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  let seen: Record<string, string> = {};
  try { seen = JSON.parse(readFileSync(seenFile(ctx), "utf8")); } catch {}
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
  for (const [k, v] of Object.entries(seen)) if (v < weekAgo) delete seen[k];
  const open = (db.query("SELECT pattern FROM ribbon_rules WHERE status = 'open'").all() as any[]).flatMap((r) => { const x = re(r.pattern); return x ? [x] : []; });
  const all = unknownTitles(db, since, new Date(Date.now() + 60_000).toISOString(), 40).filter((t) => t.minutes * 60 >= LEARN_MIN_SECONDS);
  const titles = all.filter((t) => (force || !seen[t.title]) && !open.some((x) => x.test(t.title)));
  if (titles.length < (force ? 1 : 2)) return { proposed: 0, titles: titles.length, note: "Nothing new to learn from." };
  const areas = db.query("SELECT slug, name, pattern FROM areas ORDER BY sort").all() as any[];
  const projects = db.query("SELECT slug, name, area FROM projects WHERE status = 'active' OR status IS NULL").all() as any[];
  const r = await ctx.ai.claude({
    model: "haiku", schema: LEARN_SCHEMA, timeout: 120_000,
    system: `You tag window titles from Alex's PC with his areas and projects. Propose short, case-insensitive JavaScript regular expressions
that match the titles given (a distinctive word or two from the title, not the whole title; escape special characters). Each rule names one
area slug, and a project slug only when one clearly fits. Only propose rules you are confident about: skip titles that could belong to
anything (new tab, settings, file explorer, media players). At most 8 rules.`,
    prompt: `Areas (slug, name, existing calendar pattern):\n${areas.map((a) => `- ${a.slug}: ${a.name}${a.pattern ? ` (pattern: ${a.pattern})` : ""}`).join("\n")}
Projects (slug, name, area):\n${projects.map((p) => `- ${p.slug}: ${p.name} (${p.area ?? "no area"})`).join("\n") || "- none"}
Titles nothing matched in the last 24 hours (title | process | minutes):\n${titles.map((t) => `- ${t.title} | ${t.process} | ${t.minutes}`).join("\n")}`,
  });
  const have = new Set((db.query("SELECT pattern FROM ribbon_rules WHERE status != 'removed'").all() as any[]).map((x) => x.pattern));
  const areaSlugs = new Set(areas.map((a) => a.slug)), projSlugs = new Set(projects.map((p) => p.slug));
  const ins = db.prepare("INSERT INTO ribbon_rules (pattern, area, project, source, status, why, created_at) VALUES (?, ?, ?, 'learned', 'open', ?, ?)");
  const kept: any[] = [];
  for (const p of (Array.isArray(r.out?.rules) ? r.out.rules : []).slice(0, 8)) {
    const pattern = String(p?.pattern ?? "").trim().slice(0, 120);
    const x = pattern && re(pattern);
    const area = String(p?.area ?? "");
    const project = p?.project ? String(p.project) : null;
    if (!x || !areaSlugs.has(area) || have.has(pattern) || (project && !projSlugs.has(project))) continue;
    if (!titles.some((t) => x.test(t.title))) continue;
    ins.run(pattern, area, project, String(p?.why ?? "").slice(0, 200), new Date().toISOString());
    have.add(pattern);
    kept.push({ pattern, area, project });
  }
  const now = new Date().toISOString();
  for (const t of titles) seen[t.title] = now;
  try { mkdirSync(join(ctx.dataDir, "mod", "ribbon"), { recursive: true }); writeFileSync(seenFile(ctx), JSON.stringify(seen, null, 1)); } catch {}
  ctx.log(`learn: ${titles.length} titles → ${kept.length} pencilled rules (${r.ms} ms)`);
  if (kept.length) ctx.push("Rules to keep", `${kept.length} new title rule${kept.length > 1 ? "s" : ""} on the ribbon page`).catch(() => {});
  return { proposed: kept.length, titles: titles.length, rules: kept, ms: r.ms };
}

// ── sessions the server knows from the wyn plugin hooks ────────────────────
export function sessions(ctx: JobCtx) {
  const p = join(ctx.dataDir, "wyn", `user-${ctx.user.id}`, "wyn.db");
  if (!existsSync(p)) return [];
  let rows: any[] = [];
  try {
    const n = new Database(p, { readonly: true });
    try { rows = n.query("SELECT session_id, cwd, source, hello_at, listening_at, last_reply_at FROM session_hooks").all() as any[]; } finally { n.close(); }
  } catch { return []; }
  const now = Date.now();
  const ts = (s: unknown) => (typeof s === "string" ? Date.parse(s) || 0 : 0);
  return rows.map((r) => {
    const activeAt = Math.max(ts(r.hello_at), ts(r.listening_at), ts(r.last_reply_at));
    const live = now - ts(r.listening_at) < 150_000 || now - ts(r.last_reply_at) < 10 * 60_000 || now - ts(r.hello_at) < 10 * 60_000;
    return { id: String(r.session_id), cwd: r.cwd ?? "", source: r.source ?? "", live, activeAt: activeAt ? new Date(activeAt).toISOString() : null };
  }).filter((s) => s.activeAt).sort((a, b) => Number(b.live) - Number(a.live) || String(b.activeAt).localeCompare(String(a.activeAt))).slice(0, 20);
}

// ── the module ──────────────────────────────────────────────────────────────
function dayOf(ctx: JobCtx, date: string, maxAgeMs: number) {
  const row = ctx.db().query("SELECT summary, updated_at FROM ribbon_days WHERE date = ?").get(date) as any;
  if (row && Date.now() - Date.parse(row.updated_at) < maxAgeMs) { try { return JSON.parse(row.summary); } catch {} }
  return rollup(ctx, date);
}
export const ribbon: Module = {
  name: "ribbon",
  async handle(ctx) {
    if (!ctx.owner) return ctx.fail(403, "The ribbon is the owner's PC.");
    const p = ctx.path, m = ctx.method;
    try { await ensure(ctx); } catch (e: any) { return ctx.fail(503, e?.message ?? String(e)); }
    if (p === "/samples" && m === "POST") return ingest(ctx);
    if (p === "/sessions" && m === "GET") return ctx.json({ ok: true, sessions: sessions(ctx) });
    if (p === "/today" && m === "GET") {
      const date = ctx.url.searchParams.get("date") || istDate();
      if (!isDay(date)) return ctx.fail(400, "date is YYYY-MM-DD.");
      const db = ctx.db(), { from, to } = dayBounds(date);
      const day = dayOf(ctx, date, date === istDate() ? 2 * 60_000 : 60 * 60_000);
      const proposed = (db.query("SELECT * FROM ribbon_rules WHERE status = 'open' ORDER BY id DESC").all() as any[]).map(shapeRule);
      const kept = (db.query("SELECT count(*) AS n FROM ribbon_rules WHERE status = 'kept'").get() as any).n;
      const areas = db.query("SELECT slug, name, color FROM areas ORDER BY sort").all();
      const projects = db.query("SELECT slug, name, area FROM projects ORDER BY name").all();
      return ctx.json({ ok: true, day, unknown: unknownTitles(db, from, to), proposed, rulesKept: kept, watcher: watcherState(ctx), redact: redactList(db), areas, projects });
    }
    if (p === "/rules" && m === "GET") {
      const all = ctx.url.searchParams.get("all") === "1";
      const rows = ctx.db().query(`SELECT * FROM ribbon_rules ${all ? "" : "WHERE status != 'removed'"} ORDER BY status = 'open' DESC, id DESC`).all() as any[];
      return ctx.json({ ok: true, rules: rows.map(shapeRule) });
    }
    if (p === "/rules" && m === "POST") {
      const b = await ctx.body();
      const pattern = String(b?.pattern ?? "").trim();
      if (!pattern) return ctx.fail(400, "Give a pattern.");
      const args = ["ribbon", "rule", pattern];
      if (b?.area) args.push("--area", String(b.area));
      if (b?.project) args.push("--project", String(b.project));
      const r = await ctx.agentos(args); // the CLI validates and re-tags today's untagged samples
      return ctx.json({ ok: true, rule: r?.rule ?? null, applied: r?.applied ?? 0 }, 201);
    }
    const rm = p.match(/^\/rules\/r?(\d+)\/(keep|drop)$/);
    if (rm && m === "POST") {
      const r = await ctx.agentos(["ribbon", "rules", rm[2], `r${rm[1]}`]);
      return ctx.json({ ok: true, rule: r?.rule ?? null, applied: r?.applied ?? 0 });
    }
    if (p === "/settings" && m === "GET") return ctx.json({ ok: true, redact: redactList(ctx.db()) });
    if (p === "/settings" && m === "PUT") {
      const b = await ctx.body();
      const list = Array.isArray(b?.redact) ? b.redact.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 50) : null;
      if (!list) return ctx.fail(400, "Send { redact: [regex, ...] }.");
      const bad = list.find((x: string) => !re(x));
      if (bad) return ctx.fail(400, `"${bad}" is not a valid regular expression.`);
      ctx.db().query("INSERT INTO settings (key, value, updated_at) VALUES ('ribbon.redact', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .run(JSON.stringify(list), new Date().toISOString());
      return ctx.json({ ok: true, redact: list });
    }
    if (p === "/rollup" && m === "POST") return ctx.json({ ok: true, day: rollup(ctx, ctx.url.searchParams.get("date") || istDate()) });
    if (p === "/learn" && m === "POST") {
      try { return ctx.json({ ok: true, ...(await learn(ctx, ctx.url.searchParams.get("force") === "1")) }); }
      catch (e: any) { return ctx.fail(e?.status ?? 502, e?.message ?? String(e)); }
    }
    return null;
  },
  jobs: [
    { id: "ribbon-rollup", every: "15m", async run(ctx) { await ensure(ctx); const d = rollup(ctx, istDate()); ctx.log(`rollup ${d.date}: ${d.minutes} min, ${d.samples} samples, ${d.plan.hoursMatched}/${d.plan.hoursPlanned} hours as planned`); } },
    { id: "ribbon-learn", every: "1h", async run(ctx) { await ensure(ctx); await learn(ctx); } },
  ],
};

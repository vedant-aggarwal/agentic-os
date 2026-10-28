// Content OS: `agentos content ...`. Owns the second file content.db (ctx.contentDbPath) and every
// content_ table in it, with its own PRAGMA user_version. agentos.db gets no tables from this module.
// Long text and media stay as files (scripts, transcripts, references, uploads); the db is the index.
//   agentos content                      inbox summary, today's pack, edits waiting, posts, settings
//   agentos content import               consolidate content-os, Reel Lab, craft-inbox and Codex packs (idempotent)
//   agentos content capture "<text>"     an idea into the inbox; --link makes a reference card (transcript pending)
//   agentos content plan [--date d]      pick N ideas per channel, assign take codes, create the shoot day
//   agentos content pack [--date d]      the morning pack: scripts (teleprompter text) and the shoot list by setup
//   agentos content edits | approve e1   review queue; approve records a post (dry run unless --post-id)
// The phone server (the Agentic OS server, server/modules/content.ts) calls these with --json; it adds the AI
// (Sonnet scripts, Haiku cards), downloads, uploads and jobs. The CLI never calls a model.
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { Args, ModCtx, Module } from "./types";
import { openDatabase } from "../sqlite";

type Row = Record<string, any>;
type Ctx = ModCtx & { cdb: Database; today: string };

// ── channels (plan decision 2: two only) ────────────────────────────────────
const CHANNELS: Row[] = [
  { handle: "northwindstudio", name: "@northwindstudio", platform: "instagram", language: "hinglish", design_system: "signal", brain: "studio-brain",
    setup: JSON.stringify({ location: "Desk", framing: "Tripod talking head, graphics stage on top", props: "PC setup behind" }), sort: 0 },
  { handle: "example_creator", name: "@example_creator", platform: "instagram", language: "hinglish", design_system: null, brain: "personal",
    setup: JSON.stringify({ location: "Anywhere", framing: "Handheld phone, casual", props: "" }), sort: 1 },
];
const MAIN = "northwindstudio";
// Reels per day until Alex sets the setting (brief: default 1 and 0, shown as "needs number" until set).
const DEFAULT_PER_DAY: Record<string, number> = { northwindstudio: 1, example_creator: 0 };
const SETTING_KEYS = ["reels_per_day.northwindstudio", "reels_per_day.example_creator", "slots.northwindstudio", "slots.example_creator", "shoot_at"];
const IDEA_STATUS = ["inbox", "picked", "scripted", "approved", "shot", "edited", "scheduled", "posted", "dropped"];
const SOURCES = ["email", "share", "keyword", "radar", "agent", "chat", "evidence", "import", "reel", "cli"];

export const content: Module = {
  name: "content",
  help: `agentos content [ideas|capture|import|plan|pack|scripts|edits|approve|posts|settings]   Content OS in content.db beside agentos.db
agentos content capture "<text>" [--link <url>] [--channel northwindstudio|example_creator] [--source email|share|keyword|radar|agent|chat]
agentos content plan [--date d] [--fresh] | pack [--date d] [--full]     nightly picks with take codes; the morning pack
agentos content ideas [--status s|all] [--channel c] | idea c3 [--status picked|dropped] | show <c|s|e|r|d|k|p><n>
agentos content scripts | script s3 [revise|revert] | edits | approve e3 [--dry|--post-id x --at iso] | unapprove e3 | note e3 "<text>"
agentos content import | realflow | sweep | candidates | settings [set k v] | verdict c3 keep|kill|script|restore [--why t] | deck | learnings | learning l3 --mute`,
  migrate() {
    // Nothing in agentos.db: this module's tables live in content.db (opened in run).
  },
  async run(db, a, ctx) {
    const cdb = openContent(ctx.contentDbPath);
    try {
      const c: Ctx = { ...ctx, cdb, today: ctx.istDate() };
      const sub = a._[1];
      switch (sub) {
        case undefined: return dashboard(c, a);
        case "overview": return overview(c, a);
        case "ideas": return ideas(c, a);
        case "idea": return idea(c, a);
        case "capture": return capture(c, a);
        case "import": return importAll(c, a);
        case "plan": return plan(c, a);
        case "pack": return ctx.out(packFor(c, dateArg(c, a), !!a.flags.full), packHelp(c));
        case "scripts": return scripts(c, a);
        case "script": return script(c, a);
        case "shootday": return shootday(c, a);
        case "edits": return edits(c, a);
        case "edit": return edit(c, a);
        case "approve": return approve(c, a);
        case "note": return note(c, a);
        case "posts": return posts(c, a);
        case "references": return references(c, a);
        case "reference": return reference(c, a);
        case "takes": return takes(c, a);
        case "take": return take(c, a);
        case "settings": return settings(c, a);
        case "verdict": return verdictCmd(c, a);
        case "deck": return deck(c, a);
        case "learnings": return learnings(c, a);
        case "learning": return learning(c, a);
        case "unapprove": return unapprove(c, a);
        case "realflow": return realflow(c, a);
        case "sweep": return sweep(c, db);
        case "candidates": return candidates(c, db, a);
        case "show": return show(c, a);
        default: throw new ctx.UserError(`Unknown subcommand "${sub}". Run: agentos help (Modules section)`);
      }
    } finally {
      cdb.close();
    }
  },
};

// ── content.db ──────────────────────────────────────────────────────────────
export function openContent(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = openDatabase(path);
  migrateContent(db);
  return db;
}
export function migrateContent(db: Database) {
  const v = (db.query("PRAGMA user_version").get() as any).user_version as number;
  if (v < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS content_channels (handle TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL DEFAULT 'instagram',
        language TEXT NOT NULL DEFAULT 'hinglish', design_system TEXT, brain TEXT, setup TEXT, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS content_ideas (id INTEGER PRIMARY KEY, title TEXT NOT NULL, channel TEXT REFERENCES content_channels(handle),
        pillar TEXT, source TEXT NOT NULL DEFAULT 'chat', raw TEXT, link TEXT, score REAL, status TEXT NOT NULL DEFAULT 'inbox', verdict TEXT,
        tags TEXT, hook TEXT, skeleton TEXT, evidence TEXT, external_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS content_ideas_external ON content_ideas(external_id) WHERE external_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS content_ideas_status ON content_ideas(status, channel);
      CREATE TABLE IF NOT EXISTS content_references (id INTEGER PRIMARY KEY, url TEXT, shortcode TEXT, media_path TEXT, info_path TEXT,
        transcript_path TEXT, transcript_status TEXT NOT NULL DEFAULT 'pending', analysis TEXT, note TEXT, error TEXT,
        idea_id INTEGER REFERENCES content_ideas(id), external_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS content_references_external ON content_references(external_id) WHERE external_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS content_scripts (id INTEGER PRIMARY KEY, idea_id INTEGER REFERENCES content_ideas(id), channel TEXT,
        version INTEGER NOT NULL DEFAULT 1, language TEXT NOT NULL DEFAULT 'hinglish', title TEXT NOT NULL, hook TEXT, cta TEXT,
        body_path TEXT, teleprompter_path TEXT, take_code TEXT, words INTEGER, seconds INTEGER, setup TEXT,
        status TEXT NOT NULL DEFAULT 'draft', verdict TEXT, shoot_day INTEGER, external_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS content_scripts_external ON content_scripts(external_id) WHERE external_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS content_scripts_status ON content_scripts(status, shoot_day);
      CREATE TABLE IF NOT EXISTS content_shoot_days (id INTEGER PRIMARY KEY, date TEXT NOT NULL UNIQUE, picks TEXT, setups TEXT, task_id TEXT,
        status TEXT NOT NULL DEFAULT 'planned', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS content_takes (id INTEGER PRIMARY KEY, file_path TEXT NOT NULL, duration REAL, transcript_path TEXT,
        transcript_status TEXT NOT NULL DEFAULT 'pending', script_id INTEGER REFERENCES content_scripts(id), line INTEGER,
        chosen INTEGER NOT NULL DEFAULT 0, shoot_day INTEGER, match TEXT, external_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS content_takes_external ON content_takes(external_id) WHERE external_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS content_edits (id INTEGER PRIMARY KEY, script_id INTEGER REFERENCES content_scripts(id), title TEXT, recipe TEXT,
        project_dir TEXT, render_path TEXT, status TEXT NOT NULL DEFAULT 'review', notes TEXT, external_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS content_edits_external ON content_edits(external_id) WHERE external_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS content_posts (id INTEGER PRIMARY KEY, edit_id INTEGER REFERENCES content_edits(id), channel TEXT,
        platform TEXT NOT NULL DEFAULT 'instagram', realflow_id TEXT, scheduled_at TEXT, status TEXT NOT NULL DEFAULT 'dry-run', metrics TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS content_learnings (id INTEGER PRIMARY KEY, date TEXT, text TEXT NOT NULL, receipt TEXT, source TEXT,
        external_id TEXT, created_at TEXT NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS content_learnings_external ON content_learnings(external_id) WHERE external_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS content_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
  }
  if ((db.query("PRAGMA user_version").get() as any).user_version < 2) migrateV2(db);
  const stamp = new Date().toISOString();
  const ins = db.prepare(`INSERT OR IGNORE INTO content_channels (handle, name, platform, language, design_system, brain, setup, sort, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const ch of CHANNELS) ins.run(ch.handle, ch.name, ch.platform, ch.language, ch.design_system, ch.brain, ch.setup, ch.sort, stamp);
}

/** v2 (Agentic OS 2.0): posts carry the RealFlow ledger's records (title, idea, an external id), learnings can be muted and
 *  say what kind they are (rule, verdict, note), scripts keep their rewrites (revisions, newest last), and content_ops is the
 *  phone's offline outbox (the svc/store collection shape: every write the phone makes, applied once by its id). */
function migrateV2(db: Database) {
  const cols = (t: string) => new Set((db.query(`PRAGMA table_info(${t})`).all() as Row[]).map((r) => r.name));
  const add = (t: string, col: string, decl: string) => { if (!cols(t).has(col)) db.exec(`ALTER TABLE ${t} ADD COLUMN ${col} ${decl}`); };
  db.transaction(() => {
    add("content_posts", "external_id", "TEXT"); add("content_posts", "title", "TEXT"); add("content_posts", "source", "TEXT"); add("content_posts", "idea_id", "INTEGER");
    add("content_learnings", "kind", "TEXT"); add("content_learnings", "muted", "INTEGER NOT NULL DEFAULT 0"); add("content_learnings", "updated_at", "TEXT");
    add("content_scripts", "revisions", "TEXT");
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS content_posts_external ON content_posts(external_id) WHERE external_id IS NOT NULL;
      UPDATE content_learnings SET kind = CASE source WHEN 'verdict' THEN 'verdict' WHEN 'note' THEN 'note' ELSE 'rule' END WHERE kind IS NULL;
      CREATE TABLE IF NOT EXISTS content_ops (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        rev INTEGER NOT NULL DEFAULT 0,
        kind TEXT,
        applied_at TEXT,
        error TEXT,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS content_ops_rev ON content_ops(rev);
      PRAGMA user_version = 2;
    `);
  })();
}

// ── small helpers ───────────────────────────────────────────────────────────
const PREFIX: Record<string, string> = { c: "content_ideas", s: "content_scripts", e: "content_edits", r: "content_references", d: "content_shoot_days", k: "content_takes", p: "content_posts" };
const TAG: Record<string, string> = Object.fromEntries(Object.entries(PREFIX).map(([k, v]) => [v, k]));
function num(input: string | undefined, prefix: string, c: Ctx): number {
  const s = String(input ?? "").trim().toLowerCase();
  const m = s.match(/^([a-z]?)(\d+)$/);
  if (!m || (m[1] && m[1] !== prefix)) throw new c.UserError(`Give an id like ${prefix}3.`);
  return Number(m[2]);
}
const tag = (table: string, id: number) => `${TAG[table]}${id}`;
function row(c: Ctx, table: string, id: number): Row {
  const r = c.cdb.query(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row | null;
  if (!r) throw new c.UserError(`No ${table.replace("content_", "").replace(/s$/, "")} ${tag(table, id)}.`);
  return r;
}
const text = (a: Args, from = 2) => a._.slice(from).join(" ").trim();
const parseJson = (s: unknown, fallback: any = null) => { try { return s == null || s === "" ? fallback : JSON.parse(String(s)); } catch { return fallback; } };
function channelOf(c: Ctx, input?: string | null): string {
  if (!input) return MAIN;
  const s = input.trim().toLowerCase().replace(/^@/, "");
  const rows = c.cdb.query("SELECT handle FROM content_channels").all() as Row[];
  const hit = rows.find((r) => r.handle === s) ?? rows.find((r) => r.handle.startsWith(s));
  if (!hit) throw new c.UserError(`No channel "${input}". Channels: ${rows.map((r) => r.handle).join(", ")}.`);
  return hit.handle;
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T12:00:00+05:30`);
  d.setUTCDate(d.getUTCDate() + n);
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
}
function dateArg(c: Ctx, a: Args, key = "date"): string {
  const s = (c.str(a, key) ?? "today").trim().toLowerCase();
  if (s === "today") return c.today;
  if (s === "tomorrow") return addDays(c.today, 1);
  if (s === "yesterday") return addDays(c.today, -1);
  const rel = s.match(/^([+-]\d+)d$/);
  if (rel) return addDays(c.today, Number(rel[1]));
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  throw new c.UserError(`Can't read the date "${s}". Use today, tomorrow, +1d or 2026-10-24.`);
}
const setting = (c: Ctx, key: string): string | null => (c.cdb.query("SELECT value FROM content_settings WHERE key = ?").get(key) as Row | null)?.value ?? null;
function setSetting(c: Ctx, key: string, value: string | null) {
  if (value == null) c.cdb.query("DELETE FROM content_settings WHERE key = ?").run(key);
  else c.cdb.query("INSERT INTO content_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(key, value, c.iso());
}
const readText = (p: string | null | undefined, max = 60_000) => { try { return p && existsSync(p) ? readFileSync(p, "utf8").replace(/\r/g, "").slice(0, max) : null; } catch { return null; } };
const firstUrl = (s: string | null | undefined) => s?.match(/https?:\/\/[^\s)>\]"']+/)?.[0] ?? null;
const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);
const countWords = (s: string) => s.split(/\s+/).filter(Boolean).length;
/** "52-65 seconds" | "70-75 seconds" | "45s" → the middle, in seconds. */
function secondsOf(s: string | null | undefined): number | null {
  const m = String(s ?? "").match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*s/i) ?? String(s ?? "").match(/(\d+)\s*s/i);
  if (!m) return null;
  const n = m[2] ? Math.round((Number(m[1]) + Number(m[2])) / 2) : Number(m[1]);
  return n >= 5 ? n : null;   // "0 s" in a beat table is not a duration
}

// ── markdown: frontmatter and the spoken text of a script ───────────────────
export function frontmatter(src: string): { fm: Record<string, string>; body: string } {
  const t = src.replace(/\r/g, "");
  const m = t.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { fm: {}, body: t };
  const fm: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const k = line.match(/^([\w-]+):\s*(.*)$/);
    if (k) fm[k[1]] = k[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return { fm, body: t.slice(m[0].length) };
}
function section(body: string, names: RegExp): string | null {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^(#{2,3})\s+(.+?)\s*$/);
    if (!h || !names.test(h[2])) continue;
    const level = h[1].length;
    const out: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const n = lines[j].match(/^(#{1,3})\s+/);
      if (n && n[1].length <= level) break;
      out.push(lines[j]);
    }
    return out.join("\n").trim();
  }
  return null;
}
/** What is said on camera: the Spoken/Clean script section, else the quoted lines of ## Script, else the prose. */
export function spokenText(body: string): string {
  const spoken = section(body, /^(spoken script|clean script|teleprompter)$/i);
  if (spoken) return spoken.split("\n").filter((l) => !/^\s*[>*#|]/.test(l)).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const script = section(body, /^script$/i);
  if (script) {
    const quoted = [...script.matchAll(/^"(.+?)"\s*$/gm)].map((m) => m[1].trim());
    if (quoted.length) return quoted.join("\n\n");
    return script.split("\n").filter((l) => l.trim() && !/^\s*(\*\*|#|-|\||>)/.test(l)).join("\n\n").trim();
  }
  return body.split("\n").filter((l) => l.trim() && !/^\s*(#|-|\||>|!\[|\*\*)/.test(l)).slice(0, 40).join("\n\n").trim();
}
const titleOf = (body: string, fallback: string) => body.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim() ?? fallback;

// ── shaping ─────────────────────────────────────────────────────────────────
function shapeIdea(c: Ctx, r: Row, full = false): Row {
  const ref = c.cdb.query("SELECT id, url, transcript_status, analysis, media_path FROM content_references WHERE idea_id = ? ORDER BY id DESC LIMIT 1").get(r.id) as Row | null;
  const script = c.cdb.query("SELECT id, status, take_code, shoot_day FROM content_scripts WHERE idea_id = ? ORDER BY version DESC, id DESC LIMIT 1").get(r.id) as Row | null;
  const base: Row = {
    id: tag("content_ideas", r.id), title: r.title, channel: r.channel, status: r.status, source: r.source, score: r.score,
    link: r.link, tags: c.jsonOut ? parseJson(r.tags, []) : (parseJson(r.tags, []) as string[]).join(" "),
    reference: ref ? tag("content_references", ref.id) : null, transcript: ref ? ref.transcript_status : null,
    script: script ? tag("content_scripts", script.id) : null, created: r.created_at.slice(0, 10),
  };
  if (!full) return base;
  return { ...base, raw: r.raw, hook: r.hook, skeleton: parseJson(r.skeleton, null), evidence: r.evidence, verdict: r.verdict, pillar: r.pillar,
    external_id: r.external_id, updated_at: r.updated_at, card: ref ? parseJson(ref.analysis, null) : null, media: ref?.media_path ?? null };
}
/** The words said on camera: the teleprompter file, else the spoken part of the script's markdown. */
const spokenOf = (telePath: string | null | undefined, body: string | null) => (readText(telePath) ?? (body ? spokenText(frontmatter(body).body) : null))?.trim() ?? null;
function shapeScript(c: Ctx, r: Row, full = false): Row {
  const base: Row = {
    id: tag("content_scripts", r.id), idea: r.idea_id ? tag("content_ideas", r.idea_id) : null, title: r.title, channel: r.channel, status: r.status,
    take: r.take_code, seconds: r.seconds, words: r.words, language: r.language, version: r.version,
    day: r.shoot_day ? tag("content_shoot_days", r.shoot_day) : null, created: r.created_at.slice(0, 10),
  };
  if (!full) return base;
  const body = readText(r.body_path);
  const tele = spokenOf(r.teleprompter_path, body);
  const revs = parseJson(r.revisions, []) as Row[];
  const last = revs.at(-1);
  return { ...base, hook: r.hook, cta: r.cta, setup: parseJson(r.setup, null), verdict: r.verdict, body_path: r.body_path, teleprompter_path: r.teleprompter_path,
    body, teleprompter: tele, external_id: r.external_id,
    revisions: revs.map((x) => ({ at: x.at, label: x.label ?? null })),
    previous: last ? { label: last.label ?? null, at: last.at, teleprompter: spokenOf(last.teleprompter_path, readText(last.body_path)), hook: last.hook ?? null, cta: last.cta ?? null, words: last.words ?? null, seconds: last.seconds ?? null } : null };
}
function shapeEdit(c: Ctx, r: Row, full = false): Row {
  const s = r.script_id ? (c.cdb.query("SELECT * FROM content_scripts WHERE id = ?").get(r.script_id) as Row | null) : null;
  const post = c.cdb.query("SELECT * FROM content_posts WHERE edit_id = ? ORDER BY id DESC LIMIT 1").get(r.id) as Row | null;
  const notes = parseJson(r.notes, []) as Row[];
  const base: Row = {
    id: tag("content_edits", r.id), title: r.title ?? s?.title ?? null, script: s ? tag("content_scripts", s.id) : null, channel: s?.channel ?? null,
    status: r.status, recipe: r.recipe, render: r.render_path, post: post ? tag("content_posts", post.id) : null, postStatus: post?.status ?? null,
    notes: c.jsonOut ? notes : notes.map((n) => n.text).join(" | "), created: r.created_at.slice(0, 10),
  };
  return full ? { ...base, project_dir: r.project_dir, external_id: r.external_id, take: s?.take_code ?? null } : base;
}
function shapePost(c: Ctx, r: Row): Row {
  const e = r.edit_id ? (c.cdb.query("SELECT e.id, e.title, s.title AS stitle FROM content_edits e LEFT JOIN content_scripts s ON s.id = e.script_id WHERE e.id = ?").get(r.edit_id) as Row | null) : null;
  return { id: tag("content_posts", r.id), edit: e ? tag("content_edits", e.id) : null, title: r.title ?? e?.title ?? e?.stitle ?? null, channel: r.channel, platform: r.platform,
    status: r.status, at: r.scheduled_at, realflow: r.realflow_id, idea: r.idea_id ? tag("content_ideas", r.idea_id) : null, source: r.source ?? null, created: r.created_at.slice(0, 10) };
}
function shapeReference(c: Ctx, r: Row, full = false): Row {
  const base: Row = { id: tag("content_references", r.id), url: r.url, shortcode: r.shortcode, transcript: r.transcript_status, media: r.media_path ? basename(r.media_path) : null,
    idea: r.idea_id ? tag("content_ideas", r.idea_id) : null, note: r.note, created: r.created_at.slice(0, 10) };
  return full ? { ...base, media_path: r.media_path, info_path: r.info_path, transcript_path: r.transcript_path, analysis: parseJson(r.analysis, null), error: r.error,
    transcriptText: readText(r.transcript_path, 20_000), external_id: r.external_id } : base;
}
const shapeTake = (c: Ctx, r: Row): Row => ({ id: tag("content_takes", r.id), file: r.file_path, duration: r.duration, transcript: r.transcript_status,
  script: r.script_id ? tag("content_scripts", r.script_id) : null, line: r.line, chosen: !!r.chosen, day: r.shoot_day ? tag("content_shoot_days", r.shoot_day) : null,
  match: parseJson(r.match, null), created: r.created_at.slice(0, 10) });

// ── settings and what still needs a number ──────────────────────────────────
function settingsView(c: Ctx) {
  const rows = c.cdb.query("SELECT key, value, updated_at FROM content_settings ORDER BY key").all() as Row[];
  const all: Record<string, string> = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const needs = SETTING_KEYS.filter((k) => all[k] == null || all[k] === "");
  const perDay = (h: string) => { const v = all[`reels_per_day.${h}`]; return v == null || v === "" ? null : Number(v); };
  return { all, needs, reels_per_day: { northwindstudio: perDay(MAIN), example_creator: perDay("example_creator") },
    slots: { northwindstudio: all["slots.northwindstudio"] ?? null, example_creator: all["slots.example_creator"] ?? null }, shoot_at: all.shoot_at ?? null };
}
function settings(c: Ctx, a: Args) {
  const verb = a._[2];
  if (verb === "set") {
    const key = a._[3], value = a._.slice(4).join(" ").trim();
    if (!key || !value) throw new c.UserError("agentos content settings set <key> <value>   (keys: " + SETTING_KEYS.join(", ") + ")");
    if (key.startsWith("reels_per_day.") && !/^\d+$/.test(value)) throw new c.UserError("reels_per_day takes a whole number.");
    if (key.startsWith("slots.") && !/^([01]?\d|2[0-3]):[0-5]\d(\s*,\s*([01]?\d|2[0-3]):[0-5]\d)*$/.test(value)) throw new c.UserError("slots take times like 12:30,19:00 (IST).");
    if (key === "shoot_at" && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(value)) throw new c.UserError("shoot_at takes a time like 10:00 (IST).");
    setSetting(c, key, value);
    return c.out({ ok: true, action: "set", key, value, ...settingsView(c) }, ["agentos content settings"]);
  }
  if (verb === "unset") {
    if (!a._[3]) throw new c.UserError("agentos content settings unset <key>");
    setSetting(c, a._[3], null);
    return c.out({ ok: true, action: "unset", key: a._[3], ...settingsView(c) }, ["agentos content settings"]);
  }
  if (verb) throw new c.UserError("agentos content settings [set <key> <value> | unset <key>]");
  const v = settingsView(c);
  c.out({ ...v, defaults: DEFAULT_PER_DAY, needs: c.jsonOut ? v.needs : v.needs.join(" ") },
    [`agentos content settings set reels_per_day.northwindstudio <n>`, `agentos content settings set slots.northwindstudio 12:30,19:00`]);
}

// ── dashboard / overview ────────────────────────────────────────────────────
function counts(c: Ctx) {
  const by = (sql: string) => Object.fromEntries((c.cdb.query(sql).all() as Row[]).map((r) => [r.k, r.n]));
  return {
    ideas: by("SELECT status k, count(*) n FROM content_ideas GROUP BY status"),
    scripts: by("SELECT status k, count(*) n FROM content_scripts GROUP BY status"),
    edits: by("SELECT status k, count(*) n FROM content_edits GROUP BY status"),
    posts: by("SELECT status k, count(*) n FROM content_posts GROUP BY status"),
    references: by("SELECT transcript_status k, count(*) n FROM content_references GROUP BY transcript_status"),
    takes: (c.cdb.query("SELECT count(*) n FROM content_takes").get() as Row).n,
  };
}
function dashboard(c: Ctx, _a: Args) {
  const n = counts(c);
  const pack = packFor(c, c.today, false);
  const review = c.cdb.query("SELECT count(*) n FROM content_edits WHERE status IN ('review','draft','redo')").get() as Row;
  const nextPost = c.cdb.query("SELECT * FROM content_posts WHERE scheduled_at IS NOT NULL ORDER BY scheduled_at LIMIT 1").get() as Row | null;
  const s = settingsView(c);
  const inbox = (n.ideas.inbox ?? 0) as number;
  c.out({
    date: c.today, inbox, picked: n.ideas.picked ?? 0, scripted: n.ideas.scripted ?? 0, dropped: n.ideas.dropped ?? 0,
    pack: pack.shootDay ? `${pack.scripts.length} script${pack.scripts.length === 1 ? "" : "s"}, ${pack.setups.length} setup${pack.setups.length === 1 ? "" : "s"}${pack.pending.length ? `, ${pack.pending.length} still being written` : ""}` : "none planned",
    editsToReview: review.n, references: n.references, posts: n.posts, nextPost: nextPost ? `${nextPost.scheduled_at} (${nextPost.status})` : null,
    needsNumber: c.jsonOut ? s.needs : s.needs.join(" "),
  }, [
    inbox ? "agentos content ideas  # the inbox" : `agentos content capture "<idea>" --link <url>`,
    pack.shootDay ? `agentos content pack --full` : `agentos content plan`,
    review.n ? "agentos content edits" : "agentos content settings",
  ]);
}
/** One call for the phone server: everything the four tabs show. */
function overview(c: Ctx, a: Args) {
  const date = dateArg(c, a);
  const inbox = (c.cdb.query("SELECT * FROM content_ideas WHERE status IN ('inbox','picked','scripted') ORDER BY (source = 'evidence') DESC, created_at DESC LIMIT 120").all() as Row[]).map((r) => shapeIdea(c, r));
  const editRows = (c.cdb.query("SELECT * FROM content_edits WHERE status IN ('review','draft','redo','approved') ORDER BY CASE status WHEN 'review' THEN 0 WHEN 'redo' THEN 1 WHEN 'draft' THEN 2 ELSE 3 END, updated_at DESC LIMIT 60").all() as Row[]).map((r) => shapeEdit(c, r));
  const postRows = (c.cdb.query("SELECT * FROM content_posts ORDER BY coalesce(scheduled_at, created_at) DESC LIMIT 100").all() as Row[]).map((r) => shapePost(c, r));
  const channels = c.cdb.query("SELECT handle, name, platform, language, setup, brain FROM content_channels ORDER BY sort").all() as Row[];
  const days = (c.cdb.query("SELECT id, date, status, task_id FROM content_shoot_days ORDER BY date DESC LIMIT 14").all() as Row[]).map((d) => ({ id: tag("content_shoot_days", d.id), date: d.date, status: d.status, task: d.task_id }));
  const pack = packFor(c, date, true);
  const inPack = new Set((pack.scripts as Row[]).map((x) => x.id));
  const recent = (c.cdb.query("SELECT * FROM content_scripts WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 30").all(`${addDays(c.today, -2)}T00:00:00`) as Row[])
    .map((r) => shapeScript(c, r)).filter((x) => !inPack.has(x.id)).slice(0, 12);
  const dayNum = pack.shootDay ? Number(String(pack.shootDay).slice(1)) : null;
  const takeRows = dayNum ? (c.cdb.query("SELECT * FROM content_takes WHERE shoot_day = ? OR script_id IN (SELECT id FROM content_scripts WHERE shoot_day = ?) ORDER BY id").all(dayNum, dayNum) as Row[]) : [];
  c.out({ date, today: c.today, counts: counts(c), settings: settingsView(c), defaults: DEFAULT_PER_DAY,
    channels: channels.map((ch) => ({ ...ch, setup: parseJson(ch.setup, null) })), inbox, pack, edits: editRows, posts: postRows, days,
    deck: deckList(c, Number(c.str(a, "deck") ?? 40)), learnings: learningsView(c, 40), takes: takeRows.map((r) => shapeTake(c, r)), recent });
}

// ── ideas ───────────────────────────────────────────────────────────────────
function ideas(c: Ctx, a: Args) {
  const where: string[] = [], vals: any[] = [];
  const status = c.str(a, "status") ?? "inbox";
  if (status !== "all") { where.push("status = ?"); vals.push(status); }
  if (c.str(a, "channel")) { where.push("channel = ?"); vals.push(channelOf(c, c.str(a, "channel"))); }
  if (c.str(a, "source")) { where.push("source = ?"); vals.push(c.str(a, "source")); }
  const limit = Number(c.str(a, "limit") ?? 200);
  const rows = c.cdb.query(`SELECT * FROM content_ideas ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`).all(...vals, limit) as Row[];
  c.out({ status, count: rows.length, ideas: rows.map((r) => shapeIdea(c, r)) },
    [`agentos content idea c<id> --status picked`, `agentos content show c<id>`, `agentos content ideas --status all`]);
}
function idea(c: Ctx, a: Args) {
  const id = num(a._[2], "c", c);
  const r = row(c, "content_ideas", id);
  const set: Row = {};
  if (c.str(a, "status")) {
    if (!IDEA_STATUS.includes(c.str(a, "status")!)) throw new c.UserError(`Status is one of ${IDEA_STATUS.join(", ")}.`);
    set.status = c.str(a, "status");
  }
  if (c.str(a, "channel")) set.channel = channelOf(c, c.str(a, "channel"));
  if (c.str(a, "verdict")) set.verdict = c.str(a, "verdict");
  if (c.str(a, "title")) set.title = c.str(a, "title")!.slice(0, 300);
  if (c.str(a, "score")) set.score = Number(c.str(a, "score"));
  const changed = Object.entries(set).filter(([k, v]) => r[k] !== v);
  if (!changed.length) return c.out({ already: true, idea: shapeIdea(c, r, true) }, ["agentos content ideas"]);
  changed.push(["updated_at", c.iso()]);
  c.cdb.query(`UPDATE content_ideas SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...changed.map(([, v]) => v), id);
  if (set.verdict) learn(c, { date: c.today, text: `idea c${id}: ${set.verdict}`, receipt: `c${id}`, source: "verdict", external: `verdict:c${id}:${sha(set.verdict + c.iso())}` });
  c.out({ ok: true, action: "updated", changed: changed.map(([k]) => k).filter((k) => k !== "updated_at"), idea: shapeIdea(c, row(c, "content_ideas", id), true) }, ["agentos content ideas"]);
}
function learn(c: Ctx, l: { date: string | null; text: string; receipt?: string | null; source: string; external: string }) {
  const kind = l.source === "verdict" ? "verdict" : l.source === "note" ? "note" : "rule";
  c.cdb.query("INSERT OR IGNORE INTO content_learnings (date, text, receipt, source, external_id, created_at, kind, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(l.date, l.text.slice(0, 2000), l.receipt ?? null, l.source, l.external, c.iso(), kind, c.iso());
}
type NewIdea = { title: string; channel?: string | null; source?: string; raw?: string | null; link?: string | null; score?: number | null; status?: string;
  verdict?: string | null; tags?: string[]; hook?: string | null; skeleton?: string[] | null; evidence?: string | null; pillar?: string | null; external?: string | null; created?: string | null };
/** Insert an idea; the same external id twice is a no-op (returns the existing row with already: true). */
function insertIdea(c: Ctx, i: NewIdea): { row: Row; already: boolean } {
  if (i.external) {
    const ex = c.cdb.query("SELECT * FROM content_ideas WHERE external_id = ?").get(i.external) as Row | null;
    if (ex) return { row: ex, already: true };
  }
  const stamp = c.iso();
  const r = c.cdb.query(`INSERT INTO content_ideas (title, channel, pillar, source, raw, link, score, status, verdict, tags, hook, skeleton, evidence, external_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`).get(
    i.title.slice(0, 300), i.channel ?? MAIN, i.pillar ?? null, i.source ?? "chat", i.raw?.slice(0, 20_000) ?? null, i.link ?? null, i.score ?? null,
    i.status && IDEA_STATUS.includes(i.status) ? i.status : "inbox", i.verdict?.slice(0, 2000) ?? null, i.tags?.length ? JSON.stringify(i.tags) : null,
    i.hook?.slice(0, 500) ?? null, i.skeleton ? JSON.stringify(i.skeleton) : null, i.evidence?.slice(0, 2000) ?? null, i.external ?? null, i.created ?? stamp, stamp) as Row;
  return { row: r, already: false };
}
const REEL = /^(https?:\/\/)?(www\.)?(instagram\.com\/(reel|reels|p)\/([\w-]+)|youtube\.com\/shorts\/([\w-]+)|youtu\.be\/([\w-]+)|youtube\.com\/watch\?v=([\w-]+)|(vm\.)?tiktok\.com\/\S+)/i;
function shortcodeOf(url: string): string | null {
  const m = url.match(REEL);
  return m ? (m[5] ?? m[6] ?? m[7] ?? m[8] ?? null) : null;
}
function capture(c: Ctx, a: Args) {
  const body = text(a);
  const link = c.str(a, "link") ?? firstUrl(body);
  if (!body && !link) throw new c.UserError(`agentos content capture "<idea or note>" [--link <reel url>] [--channel northwindstudio|example_creator]`);
  const source = c.str(a, "source") ?? "chat";
  if (!SOURCES.includes(source)) throw new c.UserError(`--source is one of ${SOURCES.join(", ")}.`);
  const title = (c.str(a, "title") ?? body.split("\n").find((l) => l.trim())?.trim() ?? link ?? "Idea").slice(0, 300);
  const skeleton = c.str(a, "skeleton-file") ? (readText(c.str(a, "skeleton-file"))?.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8) ?? null) : null;
  const tags = c.str(a, "tag") ? [c.str(a, "tag")!] : [];
  const { row: r, already } = insertIdea(c, {
    title, channel: c.str(a, "channel") ? channelOf(c, c.str(a, "channel")) : MAIN, source, raw: body || null, link,
    hook: c.str(a, "hook") ?? null, skeleton, evidence: c.str(a, "evidence") ?? null, tags, external: c.str(a, "external-id") ?? null,
    pillar: c.str(a, "pillar") ?? null,
  });
  if (already) return c.out({ already: true, idea: shapeIdea(c, r, true) }, [`agentos content show c${r.id}`]);
  let ref: Row | null = null;
  if (link) {
    const stamp = c.iso();
    ref = c.cdb.query(`INSERT INTO content_references (url, shortcode, note, transcript_status, idea_id, external_id, created_at, updated_at)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, ?) RETURNING *`).get(link, shortcodeOf(link), body !== link ? body.slice(0, 2000) : null, r.id, `url:${link}:${r.id}`, stamp, stamp) as Row;
  }
  c.out({ ok: true, action: "captured", idea: shapeIdea(c, r, true), reference: ref ? shapeReference(c, ref) : null,
    next: ref ? "the phone server downloads the reel, transcribes it when an OpenAI key exists, and writes the card" : null },
    [`agentos content ideas`, `agentos content idea c${r.id} --status picked`]);
}

// ── import (phase 0) ────────────────────────────────────────────────────────
type Count = { ideas: number; scripts: number; references: number; edits: number; learnings: number; skipped: number; errors: string[] };
const zero = (): Count => ({ ideas: 0, scripts: 0, references: 0, edits: 0, learnings: 0, skipped: 0, errors: [] });
const ls = (dir: string) => { try { return readdirSync(dir); } catch { return [] as string[]; } };
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };
function sourceOf(s: string | undefined): string {
  const t = (s ?? "").toLowerCase();
  if (/email|mail|reply/.test(t)) return "email";
  if (/grok|scan|radar|youtube/.test(t)) return "radar";
  if (/craft|share|reel/.test(t)) return "share";
  return "agent";
}
const STATUS_MAP: Record<string, string> = { inbox: "inbox", selected: "picked", picked: "picked", scripted: "scripted", approved: "approved", shot: "shot", recorded: "shot",
  edited: "edited", scheduled: "scheduled", published: "posted", posted: "posted", rejected: "dropped", dropped: "dropped", archived: "dropped" };
const SCRIPT_STATUS: Record<string, string> = { draft: "draft", approved: "approved", recorded: "shot", shot: "shot", rejected: "rejected" };
const RANK: Record<string, number> = Object.fromEntries(IDEA_STATUS.map((s, i) => [s, s === "dropped" ? -1 : i]));

function importContentOs(c: Ctx, dir: string, n: Count) {
  const ideasDir = join(dir, "pipeline", "01-ideas"), selDir = join(dir, "pipeline", "02-selected"), scriptsDir = join(dir, "pipeline", "03-scripts"),
    shootDir = join(dir, "pipeline", "04-shoot"), editsDir = join(dir, "pipeline", "06-edits");
  const ideaFile = (file: string, forced?: string) => {
    const src = readText(file, 200_000);
    if (!src) return;
    const { fm, body } = frontmatter(src);
    const id = fm.id ?? basename(file, ".md");
    const hook = section(body, /^hook$/i)?.split("\n").find((l) => l.trim())?.trim() ?? null;
    const verdicts = section(body, /^verdicts?$/i);
    const lastVerdict = verdicts?.split("\n").filter((l) => l.trim().startsWith("-")).at(-1)?.replace(/^-\s*/, "").trim() ?? null;
    const status = forced ?? STATUS_MAP[(fm.status ?? "inbox").toLowerCase()] ?? "inbox";
    const external = `content-os:idea:${id}`;
    const existing = c.cdb.query("SELECT * FROM content_ideas WHERE external_id = ?").get(external) as Row | null;
    if (existing) {
      // The selected folder outranks the inbox folder for the same id; verdicts refresh.
      if ((RANK[status] ?? 0) > (RANK[existing.status] ?? 0) || (lastVerdict && lastVerdict !== existing.verdict))
        c.cdb.query("UPDATE content_ideas SET status = CASE WHEN ? > ? THEN ? ELSE status END, verdict = coalesce(?, verdict), updated_at = ? WHERE id = ?")
          .run(RANK[status] ?? 0, RANK[existing.status] ?? 0, status, lastVerdict, c.iso(), existing.id);
      return;
    }
    const { already } = insertIdea(c, {
      title: fm.title ?? titleOf(body, id), source: "import", raw: [fm.angle ? `Angle: ${fm.angle}` : "", hook ? `Hook: ${hook}` : "", fm.source ? `Source: ${fm.source}` : "", section(body, /^why now$/i) ?? ""].filter(Boolean).join("\n\n"),
      link: firstUrl(body), score: fm.score ? Number(fm.score) : null, status, verdict: lastVerdict, hook, external, tags: [sourceOf(fm.source)],
      created: fm.created && !Number.isNaN(Date.parse(fm.created)) ? new Date(fm.created).toISOString() : null,
    });
    if (!already) n.ideas++;
  };
  for (const f of ls(ideasDir)) if (f.endsWith(".md")) { try { ideaFile(join(ideasDir, f)); } catch (e) { n.errors.push(`${f}: ${(e as Error).message}`); } }
  for (const f of ls(selDir)) if (f.endsWith(".md")) { try { ideaFile(join(selDir, f), "picked"); } catch (e) { n.errors.push(`${f}: ${(e as Error).message}`); } }
  const scriptFile = (file: string, floor: string) => {
    const src = readText(file, 200_000);
    if (!src) return;
    const { fm, body } = frontmatter(src);
    if (!fm.id && !/^##\s*script/im.test(body)) { n.skipped++; return; }   // the shoot-day planning doc, not a script
    const id = fm.id ?? basename(file, ".md");
    const external = `content-os:script:${id}`;
    const ideaExt = `content-os:idea:${id}`;
    let ideaRow = c.cdb.query("SELECT * FROM content_ideas WHERE external_id = ?").get(ideaExt) as Row | null;
    if (!ideaRow) { ideaRow = insertIdea(c, { title: fm.title ?? titleOf(body, id), source: "import", status: "scripted", external: ideaExt, tags: ["content-os"] }).row; n.ideas++; }
    const spoken = spokenText(body);
    const status = SCRIPT_STATUS[(fm.status ?? "draft").toLowerCase()] ?? "draft";
    const want = floor === "approved" && status === "draft" ? "approved" : status;
    const existing = c.cdb.query("SELECT * FROM content_scripts WHERE external_id = ?").get(external) as Row | null;
    if (existing) {
      const order = ["draft", "approved", "shot"];
      if (order.indexOf(want) > order.indexOf(existing.status)) c.cdb.query("UPDATE content_scripts SET status = ?, updated_at = ? WHERE id = ?").run(want, c.iso(), existing.id);
      return;
    }
    const stamp = c.iso();
    c.cdb.query(`INSERT INTO content_scripts (idea_id, channel, language, title, hook, body_path, words, seconds, status, external_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ideaRow.id, ideaRow.channel ?? MAIN, (fm.language ?? "hinglish").toLowerCase(), fm.title ?? titleOf(body, id),
      spoken.split("\n").find((l) => l.trim())?.slice(0, 500) ?? null, file, countWords(spoken), secondsOf(fm.duration) ?? Math.round(countWords(spoken) / 2.3), want, external, stamp, stamp);
    n.scripts++;
    const ideaStatus = want === "shot" ? "shot" : want === "approved" ? "approved" : "scripted";
    if ((RANK[ideaStatus] ?? 0) > (RANK[ideaRow.status] ?? 0)) c.cdb.query("UPDATE content_ideas SET status = ?, updated_at = ? WHERE id = ?").run(ideaStatus, stamp, ideaRow.id);
  };
  for (const f of ls(scriptsDir)) if (f.endsWith(".md")) { try { scriptFile(join(scriptsDir, f), "draft"); } catch (e) { n.errors.push(`${f}: ${(e as Error).message}`); } }
  for (const f of ls(shootDir)) if (f.endsWith(".md") && f !== "README.md") { try { scriptFile(join(shootDir, f), "approved"); } catch (e) { n.errors.push(`${f}: ${(e as Error).message}`); } }
  // 06-edits/<id>/: one edit per folder; a rendered mp4 under final/ or reel/ makes it reviewable.
  for (const d of ls(editsDir)) {
    const p = join(editsDir, d);
    if (!isDir(p)) continue;
    try {
      const external = `content-os:edit:${d}`;
      if (c.cdb.query("SELECT 1 FROM content_edits WHERE external_id = ?").get(external)) continue;
      const s = c.cdb.query("SELECT * FROM content_scripts WHERE external_id = ?").get(`content-os:script:${d}`) as Row | null;
      const render = findRender(p);
      const stamp = c.iso();
      c.cdb.query(`INSERT INTO content_edits (script_id, title, recipe, project_dir, render_path, status, external_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(s?.id ?? null, s?.title ?? d.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/-/g, " "), "content-os", p, render, render ? "review" : "draft", external, stamp, stamp);
      n.edits++;
    } catch (e) { n.errors.push(`${d}: ${(e as Error).message}`); }
  }
  // The verdict ledger: each line is a receipt-backed learning; the idea it names gets the verdict text for scoring.
  const ledger = readText(join(dir, "state", "learnings.md"), 2_000_000);
  if (ledger) {
    for (const line of ledger.split("\n")) {
      const m = line.match(/^-\s+(\d{4}-\d{2}-\d{2})\s+[—-]+\s+(?:idea\s+)?([\w.-]+):\s*(.+)$/);
      if (!m) continue;
      const external = `content-os:learning:${sha(line)}`;
      if (c.cdb.query("SELECT 1 FROM content_learnings WHERE external_id = ?").get(external)) continue;
      learn(c, { date: m[1], text: m[3].trim(), receipt: m[2], source: "content-os", external });
      n.learnings++;
      c.cdb.query("UPDATE content_ideas SET verdict = ? WHERE external_id = ? AND (verdict IS NULL OR length(verdict) < 2000)").run(m[3].trim().slice(0, 2000), `content-os:idea:${m[2]}`);
    }
  }
  setSetting(c, "paths.content_os", dir);
}
function findRender(dir: string): string | null {
  for (const sub of ["final", "reel", "exports", "."]) {
    const p = join(dir, sub);
    if (!isDir(p)) continue;
    const hit = ls(p).find((f) => /\.(mp4|mov)$/i.test(f) && !/raw|source/i.test(f));
    if (hit) return join(p, hit);
  }
  return null;
}
function importReelStudio(c: Ctx, dir: string, n: Count) {
  for (const d of ls(dir)) {
    const p = join(dir, d);
    if (!isDir(p)) { n.skipped++; continue; }
    const scriptPath = join(p, "SCRIPT.md");
    if (!isFile(scriptPath)) { n.skipped++; continue; }
    try {
      const src = readText(scriptPath, 200_000) ?? "";
      const { fm, body } = frontmatter(src);
      const brief = readText(join(p, "BRIEF.md"), 6000);
      const title = fm.title ?? titleOf(body, d);
      const channel = /example_creator/i.test(`${brief ?? ""}${readText(join(p, "brand.json"), 2000) ?? ""}`) ? "example_creator" : MAIN;
      const ideaExt = `reel-lab:${p}`;
      let ideaRow = c.cdb.query("SELECT * FROM content_ideas WHERE external_id = ?").get(ideaExt) as Row | null;
      if (!ideaRow) {
        ideaRow = insertIdea(c, { title, channel, source: "import", raw: brief ? brief.slice(0, 4000) : null, status: "scripted", external: ideaExt, tags: ["reel-lab"],
          link: firstUrl(section(body, /^sources?$/i)), created: isoOfDate(d) }).row;
        n.ideas++;
      }
      const scriptExt = `reel-lab:${scriptPath}`;
      if (c.cdb.query("SELECT 1 FROM content_scripts WHERE external_id = ?").get(scriptExt)) continue;
      const tele = join(p, "TELEPROMPTER.txt");
      const spoken = readText(tele) ?? spokenText(body);
      const words = Number(body.match(/(\d+)\s+words/i)?.[1]) || countWords(spoken);
      const stamp = c.iso();
      c.cdb.query(`INSERT INTO content_scripts (idea_id, channel, language, title, hook, body_path, teleprompter_path, words, seconds, status, external_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(ideaRow.id, channel, "hinglish", title, spoken.split("\n").find((l) => l.trim())?.slice(0, 500) ?? null, scriptPath,
        isFile(tele) ? tele : null, words, secondsOf(body.match(/estimated\s+([\d–-]+\s*s)/i)?.[1] ?? body.match(/(\d+\s*[-–]\s*\d+\s*seconds)/i)?.[1]) ?? Math.round(words / 2.3), "draft", scriptExt, stamp, stamp);
      n.scripts++;
    } catch (e) { n.errors.push(`${d}: ${(e as Error).message}`); }
  }
}
const isoOfDate = (s: string) => { const m = s.match(/(\d{4}-\d{2}-\d{2})/); return m ? `${m[1]}T09:00:00.000Z` : null; };
function importCraft(c: Ctx, dir: string, n: Count) {
  const index = readText(join(dir, "INDEX.md"), 200_000) ?? "";
  const notes = new Map<string, string>();
  for (const m of index.matchAll(/^\|\s*\d+\s*\|\s*(.*?)\s*\|\s*([\w-]{8,})\s*\|/gm)) {
    const note = m[1].replace(/\*\*/g, "").replace(/^"(.*)"$/, "$1").trim();
    if (note && !/^\(untitled\)/i.test(note)) notes.set(m[2], note);
  }
  const reels = join(dir, "reels");
  for (const f of ls(reels)) {
    if (!/\.(mp4|mov)$/i.test(f)) continue;
    const code = f.replace(/\.(mp4|mov)$/i, "");
    const p = join(reels, f);
    try {
      const external = `craft:${p}`;
      if (c.cdb.query("SELECT 1 FROM content_references WHERE external_id = ?").get(external)) continue;
      const stamp = c.iso();
      c.cdb.query(`INSERT INTO content_references (url, shortcode, media_path, note, transcript_status, external_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`)
        .run(`https://www.instagram.com/reel/${code}/`, code, p, notes.get(code) ?? null, external, stamp, stamp);
      n.references++;
    } catch (e) { n.errors.push(`${f}: ${(e as Error).message}`); }
  }
}
/** Codex script packs: outputs/*script*.md with "## 1. Title" sections and a Spoken/Clean script under each. */
function importCodex(c: Ctx, dir: string, n: Count) {
  const files: string[] = [];
  const walk = (p: string, depth: number) => {
    if (depth > 6) return;
    for (const f of ls(p)) {
      const q = join(p, f);
      if (isDir(q)) { if (f !== "node_modules" && f !== ".git" && f !== "work") walk(q, depth + 1); }
      else if (/script/i.test(f) && f.endsWith(".md") && /[\\/]outputs[\\/]/.test(q)) files.push(q);
    }
  };
  for (const day of ls(dir)) if (/^2026-10-\d{2}$/.test(day) && isDir(join(dir, day))) walk(join(dir, day), 0);
  const known = new Set((c.cdb.query("SELECT lower(title) t FROM content_scripts").all() as Row[]).map((r) => r.t));
  for (const file of files) {
    try {
      const src = readText(file, 400_000) ?? "";
      const parts = src.split(/^(?=## \d+\. )/m).filter((p) => /^## \d+\. /.test(p));
      if (!parts.length) { n.skipped++; continue; }
      for (const part of parts) {
        const h = part.match(/^## (\d+)\. (.+?)\s*$/m)!;
        const title = h[2].trim();
        const spoken = section(part, /^(spoken script|clean script)$/i);
        if (!spoken) { n.skipped++; continue; }
        const external = `codex:${file}#${h[1]}`;
        if (c.cdb.query("SELECT 1 FROM content_scripts WHERE external_id = ?").get(external)) continue;
        if (known.has(title.toLowerCase())) { n.skipped++; continue; }   // Reel Lab already holds this script
        const ideaRow = insertIdea(c, { title, channel: MAIN, source: "import", raw: section(part, /^(hooks|recording beats|evidence and readiness|proposed visual beats)$/i), status: "scripted", external: `codex:${file}#${h[1]}:idea`, tags: ["codex"], created: isoOfDate(file) }).row;
        n.ideas++;
        const stamp = c.iso();
        c.cdb.query(`INSERT INTO content_scripts (idea_id, channel, language, title, hook, body_path, words, seconds, status, external_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`)
          .run(ideaRow.id, MAIN, "hinglish", title, spoken.split("\n").find((l) => l.trim())?.slice(0, 500) ?? null, `${file}#${h[1]}`, countWords(spoken), secondsOf(part.match(/(\d+\s*[-–]\s*\d+\s*seconds)/i)?.[1]) ?? Math.round(countWords(spoken) / 2.3), external, stamp, stamp);
        known.add(title.toLowerCase());
        n.scripts++;
      }
    } catch (e) { n.errors.push(`${basename(file)}: ${(e as Error).message}`); }
  }
}
function importAll(c: Ctx, a: Args) {
  const home = homedir();
  const src = {
    contentOs: c.str(a, "content-os") ?? join(home, "content-os"),
    reelStudio: c.str(a, "reel-lab") ?? join(home, "Desktop", "Reel Lab", "projects"),
    craft: c.str(a, "craft") ?? join(home, "craft-inbox"),
    codex: c.str(a, "codex") ?? join(home, "Documents", "Codex"),
  };
  const report: Row = {};
  const total = zero();
  const run = (name: string, dir: string, fn: (c: Ctx, dir: string, n: Count) => void) => {
    const n = zero();
    if (!isDir(dir)) { report[name] = { dir, found: false }; return; }
    c.cdb.transaction(() => fn(c, dir, n))();
    report[name] = { dir, found: true, ...n, errors: c.jsonOut ? n.errors : n.errors.slice(0, 5).join(" | ") };
    for (const k of ["ideas", "scripts", "references", "edits", "learnings", "skipped"] as const) total[k] += n[k];
    total.errors.push(...n.errors);
  };
  run("contentOs", src.contentOs, importContentOs);
  run("reelStudio", src.reelStudio, importReelStudio);
  run("craft", src.craft, importCraft);
  run("codex", src.codex, importCodex);
  report.realflow = isDir(src.contentOs) ? realflowSync(c, src.contentOs) : { found: false };
  setSetting(c, "import.last", c.iso());
  c.out({ ok: true, action: "imported", added: { ideas: total.ideas, scripts: total.scripts, references: total.references, edits: total.edits, learnings: total.learnings },
    skipped: total.skipped, errors: total.errors.length, sources: report, totals: counts(c) },
    ["agentos content", "agentos content ideas --status all", "agentos content plan"]);
}

// ── scoring and the nightly plan (phase 2, the deterministic half) ──────────
function prefsOf(c: Ctx): { topics: string[]; language: string | null } {
  const dir = setting(c, "paths.content_os") ?? join(homedir(), "content-os");
  const p = parseJson(readText(join(dir, "state", "prefs.json"), 200_000), {});
  return { topics: Array.isArray(p?.topics) ? p.topics.map(String) : [], language: typeof p?.language === "string" ? p.language : null };
}
/** Words that carry a title's topic (longer than three letters, no stop words), for "like the ideas you killed". */
const STOP = new Set("this that with from your have what when will they them their about into just than then there these those were been more most only over also very much like make made does here ".trim().split(" "));
export const topicWords = (s: string) => new Set(String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w)));
/** How many titles in `list` share at least two topic words and half of the shorter title's words with `title`. */
export function likeCount(title: string, list: [number, Set<string>][], self: number | null = null): number {
  const t = topicWords(title);
  if (t.size < 2) return 0;
  let n = 0;
  for (const [id, o] of list) {
    if (id === self) continue;
    let both = 0;
    for (const w of t) if (o.has(w)) both++;
    if (both >= 2 && both / Math.min(t.size, o.size) >= 0.5) n++;
  }
  return n;
}
export function scoreIdea(idea: Row, extra: { hasScript: boolean; hasCard: boolean; topics: string[]; today: string; killed?: [number, Set<string>][]; kept?: [number, Set<string>][] }): { score: number; why: string[] } {
  const why: string[] = [];
  let s = typeof idea.score === "number" && Number.isFinite(idea.score) ? idea.score : 5;
  if (typeof idea.score === "number") why.push(`scored ${idea.score} in content-os`);
  const v = String(idea.verdict ?? "").toLowerCase();
  if (/approved|selected by|bana do|interested|wants|fire|good|^kept/.test(v) && !/not selected|superseded|reject|^killed/.test(v)) { s += 2; why.push("your verdict was positive"); }
  // the learning loop: what he kept and killed in the deck moves ideas that look like them
  const killed = extra.killed?.length ? likeCount(idea.title, extra.killed, idea.id ?? null) : 0;
  if (killed) { s -= Math.min(3, killed); why.push(`like ${killed === 1 ? "an idea" : `${killed} ideas`} you killed`); }
  const kept = extra.kept?.length ? likeCount(idea.title, extra.kept, idea.id ?? null) : 0;
  if (kept) { s += Math.min(2, kept * 0.5); why.push(`like ${kept === 1 ? "an idea" : `${kept} ideas`} you kept`); }
  if (idea.status === "scripted" || extra.hasScript) { s += 1.5; why.push("a script already exists"); }
  else if (idea.status === "picked") { s += 1; why.push("already picked"); }
  if (idea.source === "evidence") { s += 1; why.push("from your work (build in public)"); }
  if (extra.hasCard) { s += 1; why.push("reference card analysed"); }
  const ageDays = (Date.parse(`${extra.today}T00:00:00+05:30`) - Date.parse(idea.created_at)) / 864e5;
  // News ages fast: a fresh idea gets a point, a two-week-old one loses a point, a six-week-old one loses three.
  if (ageDays <= 7) { s += 1; why.push("fresh this week"); } else if (ageDays > 45) { s -= 3; why.push("older than six weeks"); } else if (ageDays > 14) { s -= 1; why.push("older than two weeks"); }
  const t = String(idea.title ?? "").toLowerCase();
  if (extra.topics.some((k) => k && t.includes(String(k).toLowerCase()))) { s += 1; why.push("matches a learned topic"); }
  return { score: Math.round(s * 10) / 10, why };
}
type Pick = { idea: string; title: string; channel: string; score: number; why: string[]; takeCode: string; script: string | null; setup: Row | null };
function plan(c: Ctx, a: Args) {
  const date = dateArg(c, a);
  const existing = c.cdb.query("SELECT * FROM content_shoot_days WHERE date = ?").get(date) as Row | null;
  if (existing && !a.flags.fresh) return c.out({ already: true, ...packFor(c, date, false) }, [`agentos content pack --date ${date} --full`, `agentos content plan --date ${date} --fresh`]);
  const s = settingsView(c);
  const prefs = prefsOf(c);
  const loop = verdictSets(c);
  const channels = c.cdb.query("SELECT * FROM content_channels ORDER BY sort").all() as Row[];
  const picks: Pick[] = [];
  const skipped: Row[] = [];
  const bookedIdeas = new Set((c.cdb.query("SELECT DISTINCT idea_id FROM content_scripts WHERE shoot_day IS NOT NULL AND shoot_day != ?").all(existing?.id ?? -1) as Row[]).map((r) => r.idea_id));
  for (const ch of channels) {
    const n = s.reels_per_day[ch.handle as "northwindstudio" | "example_creator"] ?? DEFAULT_PER_DAY[ch.handle] ?? 0;
    if (!n) { skipped.push({ channel: ch.handle, reason: s.reels_per_day[ch.handle as "northwindstudio"] == null ? "reels per day not set (default 0)" : "reels per day is 0" }); continue; }
    const cands = c.cdb.query("SELECT * FROM content_ideas WHERE channel = ? AND status IN ('inbox','picked','scripted') ORDER BY created_at DESC LIMIT 400").all(ch.handle) as Row[];
    const scored = cands.filter((i) => !bookedIdeas.has(i.id) && !/not selected|superseded|reject/i.test(String(i.verdict ?? ""))).map((i) => {
      // A draft or approved script that is free, or already on this day (a --fresh re-plan keeps it).
      const script = c.cdb.query("SELECT id FROM content_scripts WHERE idea_id = ? AND status IN ('draft','approved') AND (shoot_day IS NULL OR shoot_day = ?) ORDER BY version DESC, id DESC LIMIT 1").get(i.id, existing?.id ?? -1) as Row | null;
      const card = c.cdb.query("SELECT 1 FROM content_references WHERE idea_id = ? AND analysis IS NOT NULL").get(i.id);
      return { i, script, ...scoreIdea(i, { hasScript: !!script, hasCard: !!card, topics: prefs.topics, today: c.today, ...loop }) };
    }).sort((x, y) => y.score - x.score || Date.parse(y.i.created_at) - Date.parse(x.i.created_at));
    for (const x of scored.slice(0, n)) picks.push({ idea: tag("content_ideas", x.i.id), title: x.i.title, channel: ch.handle, score: x.score, why: x.why, takeCode: "",
      script: x.script ? tag("content_scripts", x.script.id) : null, setup: parseJson(ch.setup, null) });
    if (scored.length < n) skipped.push({ channel: ch.handle, reason: `only ${scored.length} idea${scored.length === 1 ? "" : "s"} available for ${n}` });
  }
  picks.forEach((p, i) => { p.takeCode = `R${i + 1}`; });
  const stamp = c.iso();
  const dayId = c.cdb.transaction(() => {
    const id = existing
      ? (c.cdb.query("UPDATE content_shoot_days SET picks = ?, status = 'planned', updated_at = ? WHERE id = ? RETURNING id").get(JSON.stringify(picks), stamp, existing.id) as Row).id
      : (c.cdb.query("INSERT INTO content_shoot_days (date, picks, status, created_at, updated_at) VALUES (?, ?, 'planned', ?, ?) RETURNING id").get(date, JSON.stringify(picks), stamp, stamp) as Row).id;
    if (existing) c.cdb.query("UPDATE content_scripts SET shoot_day = NULL, take_code = NULL, updated_at = ? WHERE shoot_day = ?").run(stamp, id);
    for (const p of picks) {
      const ideaId = Number(p.idea.slice(1));
      if (p.script) {
        c.cdb.query("UPDATE content_scripts SET shoot_day = ?, take_code = ?, setup = coalesce(setup, ?), updated_at = ? WHERE id = ?").run(id, p.takeCode, p.setup ? JSON.stringify(p.setup) : null, stamp, Number(p.script.slice(1)));
        c.cdb.query("UPDATE content_ideas SET status = CASE WHEN status IN ('inbox','picked') THEN 'scripted' ELSE status END, updated_at = ? WHERE id = ?").run(stamp, ideaId);
      } else c.cdb.query("UPDATE content_ideas SET status = 'picked', updated_at = ? WHERE id = ? AND status = 'inbox'").run(stamp, ideaId);
    }
    c.cdb.query("UPDATE content_shoot_days SET setups = ? WHERE id = ?").run(JSON.stringify(groupSetups(c, id)), id);
    return id as number;
  })();
  c.out({ ok: true, action: existing ? "replanned" : "planned", date, shootDay: tag("content_shoot_days", dayId),
    picks: picks.map((p) => ({ ...p, why: c.jsonOut ? p.why : p.why.join("; "), setup: c.jsonOut ? p.setup : null })),
    toWrite: picks.filter((p) => !p.script).map((p) => p.idea), skipped, needsNumber: c.jsonOut ? s.needs : s.needs.join(" ") },
    [`agentos content pack --date ${date} --full`, `agentos content script add --idea c<id> --date ${date} --take-code R1 --title "..." --body-file <md>`, `agentos content settings`]);
}
function groupSetups(c: Ctx, dayId: number) {
  const rows = c.cdb.query("SELECT id, setup, channel, take_code FROM content_scripts WHERE shoot_day = ? ORDER BY take_code").all(dayId) as Row[];
  const groups = new Map<string, Row>();
  for (const r of rows) {
    const setup = parseJson(r.setup, null) ?? parseJson((c.cdb.query("SELECT setup FROM content_channels WHERE handle = ?").get(r.channel) as Row | null)?.setup, { location: "Anywhere", framing: "Talking head", props: "" });
    const key = `${setup.location} · ${setup.framing}`;
    const g = groups.get(key) ?? { key, location: setup.location, framing: setup.framing, props: setup.props ?? "", scripts: [] as string[] };
    g.scripts.push(tag("content_scripts", r.id));
    groups.set(key, g);
  }
  return [...groups.values()];
}
function packFor(c: Ctx, date: string, full: boolean) {
  const day = c.cdb.query("SELECT * FROM content_shoot_days WHERE date = ?").get(date) as Row | null;
  if (!day) return { date, shootDay: null, task: null, scripts: [] as Row[], setups: [] as Row[], pending: [] as Row[] };
  const scripts = (c.cdb.query("SELECT * FROM content_scripts WHERE shoot_day = ? ORDER BY take_code").all(day.id) as Row[]).map((r) => shapeScript(c, r, full));
  const picks = parseJson(day.picks, []) as Pick[];
  const pending = picks.filter((p) => !scripts.some((s) => s.idea === p.idea)).map((p) => ({ idea: p.idea, title: p.title, channel: p.channel, takeCode: p.takeCode, score: p.score }));
  return { date, shootDay: tag("content_shoot_days", day.id), status: day.status, task: day.task_id, scripts, setups: groupSetups(c, day.id), pending };
}
const packHelp = (c: Ctx) => [`agentos content pack --full`, `agentos content script s<id> --status approved`, `agentos content plan --date ${addDays(c.today, 1)}`];
function shootday(c: Ctx, a: Args) {
  const id = num(a._[2], "d", c);
  const d = row(c, "content_shoot_days", id);
  const set: Row = {};
  if (c.str(a, "task")) set.task_id = c.str(a, "task");
  if (c.str(a, "status")) set.status = c.str(a, "status");
  if (!Object.keys(set).length) return c.out({ shootDay: { id: tag("content_shoot_days", id), ...packFor(c, d.date, false) } }, packHelp(c));
  const changed = Object.entries(set);
  changed.push(["updated_at", c.iso()]);
  c.cdb.query(`UPDATE content_shoot_days SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...changed.map(([, v]) => v), id);
  c.out({ ok: true, action: "updated", shootDay: tag("content_shoot_days", id), ...set }, packHelp(c));
}

// ── scripts ─────────────────────────────────────────────────────────────────
function scripts(c: Ctx, a: Args) {
  const where: string[] = [], vals: any[] = [];
  if (c.str(a, "status")) { where.push("status = ?"); vals.push(c.str(a, "status")); }
  if (c.str(a, "date")) { where.push("shoot_day = (SELECT id FROM content_shoot_days WHERE date = ?)"); vals.push(dateArg(c, a)); }
  if (c.str(a, "idea")) { where.push("idea_id = ?"); vals.push(num(c.str(a, "idea"), "c", c)); }
  const rows = c.cdb.query(`SELECT * FROM content_scripts ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`).all(...vals, Number(c.str(a, "limit") ?? 200)) as Row[];
  c.out({ count: rows.length, scripts: rows.map((r) => shapeScript(c, r, !!a.flags.full)) }, ["agentos content show s<id>", "agentos content script s<id> --status approved"]);
}
function script(c: Ctx, a: Args) {
  if (a._[2] === "add") return scriptAdd(c, a);
  const id = num(a._[2], "s", c);
  const r = row(c, "content_scripts", id);
  if (a._[3] === "revise") return scriptRevise(c, id, r, a);
  if (a._[3] === "revert") return scriptRevert(c, id, r);
  const set: Row = {};
  if (c.str(a, "status")) {
    if (!["draft", "approved", "rejected", "shot"].includes(c.str(a, "status")!)) throw new c.UserError("Status is draft, approved, rejected or shot.");
    set.status = c.str(a, "status");
  }
  if (c.str(a, "verdict")) set.verdict = c.str(a, "verdict");
  if (c.str(a, "take-code")) set.take_code = c.str(a, "take-code");
  const changed = Object.entries(set).filter(([k, v]) => r[k] !== v);
  if (!changed.length) return c.out({ already: true, script: shapeScript(c, r, true) }, ["agentos content scripts"]);
  changed.push(["updated_at", c.iso()]);
  c.cdb.query(`UPDATE content_scripts SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...changed.map(([, v]) => v), id);
  if (set.status && r.idea_id) {
    const ideaStatus = set.status === "approved" ? "approved" : set.status === "shot" ? "shot" : set.status === "rejected" ? "picked" : null;
    if (ideaStatus) c.cdb.query("UPDATE content_ideas SET status = ?, updated_at = ? WHERE id = ?").run(ideaStatus, c.iso(), r.idea_id);
  }
  if (set.verdict) learn(c, { date: c.today, text: `script s${id} (${r.title}): ${set.verdict}`, receipt: `s${id}`, source: "verdict", external: `verdict:s${id}:${sha(set.verdict + c.iso())}` });
  c.out({ ok: true, action: "updated", changed: changed.map(([k]) => k).filter((k) => k !== "updated_at"), script: shapeScript(c, row(c, "content_scripts", id), false) }, ["agentos content pack --full"]);
}
/** The server (or an agent) files a written script: the body is a file, the db gets the index row and the take code. */
function scriptAdd(c: Ctx, a: Args) {
  const ideaId = num(c.str(a, "idea"), "c", c);
  const ideaRow = row(c, "content_ideas", ideaId);
  const bodyPath = c.str(a, "body-file");
  if (!bodyPath || !isFile(bodyPath)) throw new c.UserError(`agentos content script add --idea c${ideaId} --title "..." --body-file <path.md> [--teleprompter-file <path.txt>] [--date d] [--take-code R1] [--hook ..] [--cta ..] [--seconds n]`);
  const external = c.str(a, "external-id");
  if (external) {
    const ex = c.cdb.query("SELECT * FROM content_scripts WHERE external_id = ?").get(external) as Row | null;
    if (ex) return c.out({ already: true, script: shapeScript(c, ex, false) }, ["agentos content pack --full"]);
  }
  const body = readText(bodyPath, 200_000) ?? "";
  const tele = c.str(a, "teleprompter-file");
  const spoken = readText(tele) ?? spokenText(frontmatter(body).body);
  const words = Number(c.str(a, "words")) || countWords(spoken);
  const seconds = Number(c.str(a, "seconds")) || Math.round(words / 2.3);
  const version = ((c.cdb.query("SELECT max(version) v FROM content_scripts WHERE idea_id = ?").get(ideaId) as Row).v ?? 0) + 1;
  const date = c.str(a, "date") ? dateArg(c, a) : null;
  const stamp = c.iso();
  const ch = c.str(a, "channel") ? channelOf(c, c.str(a, "channel")) : (ideaRow.channel ?? MAIN);
  const setup = c.str(a, "setup") ?? (c.cdb.query("SELECT setup FROM content_channels WHERE handle = ?").get(ch) as Row | null)?.setup ?? null;
  const r = c.cdb.transaction(() => {
    let dayId: number | null = null;
    if (date) {
      const d = c.cdb.query("SELECT id, picks FROM content_shoot_days WHERE date = ?").get(date) as Row | null;
      dayId = d ? d.id : (c.cdb.query("INSERT INTO content_shoot_days (date, picks, status, created_at, updated_at) VALUES (?, '[]', 'planned', ?, ?) RETURNING id").get(date, stamp, stamp) as Row).id;
    }
    const takeCode = c.str(a, "take-code") ?? (dayId ? `R${(c.cdb.query("SELECT count(*) n FROM content_scripts WHERE shoot_day = ?").get(dayId) as Row).n + 1}` : null);
    const s = c.cdb.query(`INSERT INTO content_scripts (idea_id, channel, version, language, title, hook, cta, body_path, teleprompter_path, take_code, words, seconds, setup, status, shoot_day, external_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?) RETURNING *`).get(ideaId, ch, version, c.str(a, "language") ?? "hinglish",
      (c.str(a, "title") ?? ideaRow.title).slice(0, 300), c.str(a, "hook") ?? spoken.split("\n").find((l) => l.trim())?.slice(0, 500) ?? null, c.str(a, "cta") ?? null,
      bodyPath, tele && isFile(tele) ? tele : null, takeCode, words, seconds, setup, dayId, external ?? null, stamp, stamp) as Row;
    c.cdb.query("UPDATE content_ideas SET status = CASE WHEN status IN ('inbox','picked') THEN 'scripted' ELSE status END, updated_at = ? WHERE id = ?").run(stamp, ideaId);
    if (dayId) {
      const d = c.cdb.query("SELECT picks FROM content_shoot_days WHERE id = ?").get(dayId) as Row;
      const picks = (parseJson(d.picks, []) as Pick[]).map((p) => (p.idea === `c${ideaId}` ? { ...p, script: `s${s.id}`, takeCode: takeCode ?? p.takeCode } : p));
      if (!picks.some((p) => p.idea === `c${ideaId}`)) picks.push({ idea: `c${ideaId}`, title: s.title, channel: ch, score: 0, why: ["added by hand"], takeCode: takeCode ?? "", script: `s${s.id}`, setup: parseJson(setup, null) });
      c.cdb.query("UPDATE content_shoot_days SET picks = ?, setups = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(picks), JSON.stringify(groupSetups(c, dayId)), stamp, dayId);
    }
    return s;
  })();
  c.out({ ok: true, action: "added", script: shapeScript(c, r, false) }, [`agentos content pack${date ? ` --date ${date}` : ""} --full`, `agentos content script s${r.id} --status approved`]);
}

// ── edits, approve, posts (phase 5) ─────────────────────────────────────────
function edits(c: Ctx, a: Args) {
  const status = c.str(a, "status");
  const rows = c.cdb.query(status ? "SELECT * FROM content_edits WHERE status = ? ORDER BY updated_at DESC" : "SELECT * FROM content_edits WHERE status != 'dropped' ORDER BY CASE status WHEN 'review' THEN 0 WHEN 'redo' THEN 1 ELSE 2 END, updated_at DESC").all(...(status ? [status] : [])) as Row[];
  c.out({ count: rows.length, edits: rows.map((r) => shapeEdit(c, r)) }, [`agentos content approve e<id>`, `agentos content note e<id> "<what to change>"`]);
}
function edit(c: Ctx, a: Args) {
  if (a._[2] !== "add") {
    const id = num(a._[2], "e", c);
    const r = row(c, "content_edits", id);
    const set: Row = {};
    if (c.str(a, "status")) set.status = c.str(a, "status");
    if (c.str(a, "render")) set.render_path = c.str(a, "render");
    const changed = Object.entries(set).filter(([k, v]) => r[k] !== v);
    if (!changed.length) return c.out({ already: true, edit: shapeEdit(c, r, true) }, ["agentos content edits"]);
    changed.push(["updated_at", c.iso()]);
    c.cdb.query(`UPDATE content_edits SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...changed.map(([, v]) => v), id);
    return c.out({ ok: true, action: "updated", edit: shapeEdit(c, row(c, "content_edits", id), true) }, ["agentos content edits"]);
  }
  const scriptId = c.str(a, "script") ? num(c.str(a, "script"), "s", c) : null;
  const s = scriptId ? row(c, "content_scripts", scriptId) : null;
  const external = c.str(a, "external-id");
  if (external) {
    const ex = c.cdb.query("SELECT * FROM content_edits WHERE external_id = ?").get(external) as Row | null;
    if (ex) return c.out({ already: true, edit: shapeEdit(c, ex) }, ["agentos content edits"]);
  }
  const title = c.str(a, "title") ?? s?.title;
  if (!title) throw new c.UserError(`agentos content edit add --script s<id> [--title "..."] [--render <mp4>] [--recipe <name>] [--project <dir>] [--status review|draft]`);
  const stamp = c.iso();
  const r = c.cdb.query(`INSERT INTO content_edits (script_id, title, recipe, project_dir, render_path, status, external_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
    .get(scriptId, title.slice(0, 300), c.str(a, "recipe") ?? null, c.str(a, "project") ?? null, c.str(a, "render") ?? null, c.str(a, "status") ?? (c.str(a, "render") ? "review" : "draft"), external ?? null, stamp, stamp) as Row;
  if (s?.idea_id) c.cdb.query("UPDATE content_ideas SET status = CASE WHEN status IN ('inbox','picked','scripted','approved','shot') THEN 'edited' ELSE status END, updated_at = ? WHERE id = ?").run(stamp, s.idea_id);
  c.out({ ok: true, action: "added", edit: shapeEdit(c, r) }, [`agentos content approve e${r.id}`, `agentos content edits`]);
}
/** The next free posting slot for a channel from the slots setting; null when no slot is set (needs number). */
function nextSlot(c: Ctx, channel: string): string | null {
  const slots = (setting(c, `slots.${channel}`) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!slots.length) return null;
  const taken = new Set((c.cdb.query("SELECT scheduled_at FROM content_posts WHERE channel = ? AND scheduled_at IS NOT NULL AND status IN ('scheduled','dry-run')").all(channel) as Row[]).map((r) => r.scheduled_at));
  const nowMs = c.now().getTime();
  for (let d = 0; d < 30; d++) {
    const date = addDays(c.today, d);
    for (const hhmm of slots.slice().sort()) {
      const at = new Date(`${date}T${hhmm.padStart(5, "0")}:00+05:30`).toISOString();
      if (Date.parse(at) > nowMs + 30 * 60000 && !taken.has(at)) return at;
    }
  }
  return null;
}
function approve(c: Ctx, a: Args) {
  const id = num(a._[2], "e", c);
  const e = row(c, "content_edits", id);
  const s = e.script_id ? (c.cdb.query("SELECT * FROM content_scripts WHERE id = ?").get(e.script_id) as Row | null) : null;
  const channel = c.str(a, "channel") ? channelOf(c, c.str(a, "channel")) : (s?.channel ?? MAIN);
  const open = c.cdb.query("SELECT * FROM content_posts WHERE edit_id = ? AND status IN ('scheduled','dry-run') ORDER BY id DESC LIMIT 1").get(id) as Row | null;
  if (open && e.status === "approved" && !c.str(a, "post-id")) return c.out({ already: true, edit: shapeEdit(c, e), post: shapePost(c, open) }, ["agentos content posts"]);
  const postId = c.str(a, "post-id") ?? null;
  const at = c.str(a, "at") ?? nextSlot(c, channel);
  if (at && Number.isNaN(Date.parse(at))) throw new c.UserError("--at takes an ISO time like 2026-10-20T12:30:00+05:30.");
  const status = postId ? "scheduled" : "dry-run";
  const stamp = c.iso();
  const post = c.cdb.transaction(() => {
    c.cdb.query("UPDATE content_edits SET status = 'approved', updated_at = ? WHERE id = ?").run(stamp, id);
    if (s?.idea_id) c.cdb.query("UPDATE content_ideas SET status = 'scheduled', updated_at = ? WHERE id = ?").run(stamp, s.idea_id);
    if (open) return c.cdb.query("UPDATE content_posts SET channel = ?, realflow_id = coalesce(?, realflow_id), scheduled_at = coalesce(?, scheduled_at), status = ?, updated_at = ? WHERE id = ? RETURNING *")
      .get(channel, postId, at ? new Date(at).toISOString() : null, status, stamp, open.id) as Row;
    return c.cdb.query("INSERT INTO content_posts (edit_id, channel, platform, realflow_id, scheduled_at, status, created_at, updated_at) VALUES (?, ?, 'instagram', ?, ?, ?, ?, ?) RETURNING *")
      .get(id, channel, postId, at ? new Date(at).toISOString() : null, status, stamp, stamp) as Row;
  })();
  const slotsSet = !!setting(c, `slots.${channel}`);
  c.out({ ok: true, action: "approved", dryRun: !postId, edit: shapeEdit(c, row(c, "content_edits", id)), post: shapePost(c, post),
    note: postId ? "scheduled through RealFlow" : `scheduled (dry run): CONTENT_POST is off, nothing was sent to RealFlow${slotsSet ? "" : "; posting slot needs a number (settings slots." + channel + ")"}` },
    ["agentos content posts", "agentos content edits"]);
}
function note(c: Ctx, a: Args) {
  const id = num(a._[2], "e", c);
  const e = row(c, "content_edits", id);
  const t = text(a, 3);
  if (!t) throw new c.UserError(`agentos content note e${id} "<what to change>"`);
  const notes = parseJson(e.notes, []) as Row[];
  notes.push({ at: c.iso(), text: t.slice(0, 2000) });
  c.cdb.query("UPDATE content_edits SET notes = ?, status = 'redo', updated_at = ? WHERE id = ?").run(JSON.stringify(notes), c.iso(), id);
  learn(c, { date: c.today, text: `edit e${id} (${e.title ?? ""}): ${t}`, receipt: `e${id}`, source: "note", external: `note:e${id}:${sha(t + c.iso())}` });
  c.out({ ok: true, action: "noted", edit: shapeEdit(c, row(c, "content_edits", id)), next: "the edit is queued for another pass (status redo)" }, ["agentos content edits"]);
}
function posts(c: Ctx, a: Args) {
  const where: string[] = [], vals: any[] = [];
  if (c.str(a, "from")) { where.push("scheduled_at >= ?"); vals.push(`${dateArg(c, a, "from")}T00:00:00`); }
  if (c.str(a, "status")) { where.push("status = ?"); vals.push(c.str(a, "status")); }
  const rows = c.cdb.query(`SELECT * FROM content_posts ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY coalesce(scheduled_at, created_at) DESC LIMIT 200`).all(...vals) as Row[];
  c.out({ count: rows.length, posts: rows.map((r) => shapePost(c, r)) }, ["agentos content edits", "agentos content settings"]);
}

// ── references (reel links, craft reels) ────────────────────────────────────
function references(c: Ctx, a: Args) {
  const rows = c.cdb.query(a.flags.pending ? "SELECT * FROM content_references WHERE transcript_status IN ('pending', 'failed') OR analysis IS NULL ORDER BY id" : "SELECT * FROM content_references ORDER BY id DESC LIMIT 200").all() as Row[];
  c.out({ count: rows.length, references: rows.map((r) => shapeReference(c, r, !!a.flags.full)) }, ["agentos content show r<id>", "agentos content references --pending"]);
}
function reference(c: Ctx, a: Args) {
  const id = num(a._[2], "r", c);
  const r = row(c, "content_references", id);
  const set: Row = {};
  for (const [flag, col] of [["media", "media_path"], ["info", "info_path"], ["transcript", "transcript_path"], ["transcript-status", "transcript_status"], ["shortcode", "shortcode"], ["error", "error"], ["note", "note"]] as const)
    if (c.str(a, flag) !== undefined) set[col] = c.str(a, flag) === "none" ? null : c.str(a, flag);
  if (c.str(a, "analysis-file")) {
    const j = parseJson(readText(c.str(a, "analysis-file"), 100_000), null);
    if (!j) throw new c.UserError("--analysis-file must hold JSON ({ hook, structure, format, why, ... }).");
    set.analysis = JSON.stringify(j);
  }
  if (set.transcript_status && !["pending", "done", "none", "failed"].includes(set.transcript_status)) throw new c.UserError("--transcript-status is pending, done, none or failed.");
  const changed = Object.entries(set).filter(([k, v]) => r[k] !== v);
  if (!changed.length) return c.out({ already: true, reference: shapeReference(c, r, true) }, ["agentos content references"]);
  changed.push(["updated_at", c.iso()]);
  c.cdb.query(`UPDATE content_references SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...changed.map(([, v]) => v), id);
  c.out({ ok: true, action: "updated", changed: changed.map(([k]) => k).filter((k) => k !== "updated_at"), reference: shapeReference(c, row(c, "content_references", id), true) }, ["agentos content references"]);
}

// ── takes (phase 3) ─────────────────────────────────────────────────────────
function takes(c: Ctx, a: Args) {
  const rows = c.cdb.query(c.str(a, "date") ? "SELECT * FROM content_takes WHERE shoot_day = (SELECT id FROM content_shoot_days WHERE date = ?) ORDER BY id" : "SELECT * FROM content_takes ORDER BY id DESC LIMIT 200").all(...(c.str(a, "date") ? [dateArg(c, a)] : [])) as Row[];
  c.out({ count: rows.length, takes: rows.map((r) => shapeTake(c, r)) }, ["agentos content take k<id> --script s<id> --chosen"]);
}
function take(c: Ctx, a: Args) {
  if (a._[2] === "add") {
    const file = c.str(a, "file");
    if (!file) throw new c.UserError("agentos content take add --file <path> [--duration s] [--date d] [--external-id x]");
    const external = c.str(a, "external-id") ?? `file:${file}`;
    const ex = c.cdb.query("SELECT * FROM content_takes WHERE external_id = ?").get(external) as Row | null;
    if (ex) return c.out({ already: true, take: shapeTake(c, ex) }, ["agentos content takes"]);
    const dayId = c.str(a, "date") ? (c.cdb.query("SELECT id FROM content_shoot_days WHERE date = ?").get(dateArg(c, a)) as Row | null)?.id ?? null : null;
    const stamp = c.iso();
    // the phone knows which script it recorded for: --script files the take under it at once (the matcher is for the rest)
    const scriptId = c.str(a, "script") ? num(c.str(a, "script"), "s", c) : null;
    if (scriptId) row(c, "content_scripts", scriptId);
    const r = c.cdb.transaction(() => {
      const t = c.cdb.query("INSERT INTO content_takes (file_path, duration, shoot_day, external_id, script_id, line, chosen, match, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *")
        .get(file, c.str(a, "duration") ? Number(c.str(a, "duration")) : null, dayId, external, scriptId, c.str(a, "line") ? Number(c.str(a, "line")) : scriptId ? 0 : null,
          a.flags.chosen ? 1 : 0, scriptId ? JSON.stringify({ how: "recorded for it", score: 1, code: null }) : null, stamp, stamp) as Row;
      if (scriptId && a.flags.chosen) c.cdb.query("UPDATE content_takes SET chosen = 0 WHERE script_id = ? AND coalesce(line, -1) = coalesce(?, -1) AND id != ?").run(scriptId, t.line, t.id);
      if (scriptId) c.cdb.query("UPDATE content_scripts SET status = CASE WHEN status IN ('draft','approved') THEN 'shot' ELSE status END, updated_at = ? WHERE id = ?").run(stamp, scriptId);
      return t;
    })();
    return c.out({ ok: true, action: "added", take: shapeTake(c, r) }, [`agentos content take k${r.id} --script s<id> --line <n>`]);
  }
  const id = num(a._[2], "k", c);
  const r = row(c, "content_takes", id);
  const set: Row = {};
  if (c.str(a, "script")) set.script_id = c.str(a, "script") === "none" ? null : num(c.str(a, "script"), "s", c);
  if (c.str(a, "line")) set.line = Number(c.str(a, "line"));
  if (c.str(a, "transcript")) set.transcript_path = c.str(a, "transcript");
  if (c.str(a, "transcript-status")) set.transcript_status = c.str(a, "transcript-status");
  if (c.str(a, "duration")) set.duration = Number(c.str(a, "duration"));
  if (c.str(a, "match")) set.match = c.str(a, "match");
  if (a.flags.chosen) set.chosen = 1;
  if (a.flags.unchosen) set.chosen = 0;
  const changed = Object.entries(set).filter(([k, v]) => r[k] !== v);
  if (!changed.length) return c.out({ already: true, take: shapeTake(c, r) }, ["agentos content takes"]);
  changed.push(["updated_at", c.iso()]);
  c.cdb.transaction(() => {
    c.cdb.query(`UPDATE content_takes SET ${changed.map(([k]) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...changed.map(([, v]) => v), id);
    // The last complete take of a line wins: choosing one unchooses the others on the same script line.
    const t = row(c, "content_takes", id);
    if (set.chosen === 1 && t.script_id) c.cdb.query("UPDATE content_takes SET chosen = 0 WHERE script_id = ? AND coalesce(line, -1) = coalesce(?, -1) AND id != ?").run(t.script_id, t.line, id);
    if (t.script_id) c.cdb.query("UPDATE content_scripts SET status = CASE WHEN status IN ('draft','approved') THEN 'shot' ELSE status END, updated_at = ? WHERE id = ?").run(c.iso(), t.script_id);
  })();
  c.out({ ok: true, action: "updated", take: shapeTake(c, row(c, "content_takes", id)) }, ["agentos content takes"]);
}

// ── the bridge to tasks: content: keyword sweep and build-in-public candidates ─
function sweep(c: Ctx, db: Database) {
  const hasLists = !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lists'").get();
  const rows = db.query(hasLists
    ? `SELECT t.*, l.title AS list_title FROM tasks t LEFT JOIN lists l ON l.id = t.list_id
       WHERE t.status IN ('inbox','todo') AND (lower(t.title) LIKE 'content:%' OR lower(coalesce(l.title, '')) = 'content ideas') ORDER BY t.id`
    : `SELECT t.*, NULL AS list_title FROM tasks t WHERE t.status IN ('inbox','todo') AND lower(t.title) LIKE 'content:%' ORDER BY t.id`).all() as Row[];
  const moved: Row[] = [], already: string[] = [];
  const stamp = c.iso();
  for (const t of rows) {
    const title = t.title.replace(/^content:\s*/i, "").trim() || t.title;
    const link = firstUrl(t.notes) ?? firstUrl(title);
    const source = t.source === "email" ? "email" : t.source === "share" ? "share" : "keyword";
    const { row: i, already: was } = insertIdea(c, { title, source, raw: t.notes ?? null, link, external: `task:t${t.id}`, tags: t.list_title ? [t.list_title] : [] });
    if (was) already.push(`t${t.id}`);
    else {
      moved.push({ task: `t${t.id}`, idea: `c${i.id}`, title, source });
      if (link) c.cdb.query("INSERT INTO content_references (url, shortcode, note, transcript_status, idea_id, external_id, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)")
        .run(link, shortcodeOf(link), t.notes?.slice(0, 2000) ?? null, i.id, `url:${link}:${i.id}`, stamp, stamp);
    }
    // Moved, not deleted: the task closes with the idea id as its evidence so the trail stays in agentos.db.
    db.query("UPDATE tasks SET status = 'dropped', evidence = ?, updated_at = ? WHERE id = ?").run(`moved to content idea c${i.id}`, stamp, t.id);
  }
  c.out({ ok: true, action: "swept", moved, already: c.jsonOut ? already : already.join(" ") }, ["agentos content ideas"]);
}
function candidates(c: Ctx, db: Database, a: Args) {
  const date = dateArg(c, a);
  const start = new Date(`${date}T00:00:00+05:30`).toISOString(), end = new Date(`${addDays(date, 1)}T00:00:00+05:30`).toISOString();
  const done = db.query("SELECT id, title, area, evidence, done_at, notes FROM tasks WHERE status = 'done' AND done_at >= ? AND done_at < ? AND evidence IS NOT NULL AND trim(evidence) != '' ORDER BY done_at").all(start, end) as Row[];
  const list = done.filter((t) => /https?:\/\/|\b[0-9a-f]{7,40}\b|\bPR\b|#\d+|commit|deploy|\.(md|ts|tsx|js|py|html)\b/i.test(t.evidence)).map((t) => {
    const ex = c.cdb.query("SELECT id, status FROM content_ideas WHERE external_id = ?").get(`task:t${t.id}:bip`) as Row | null;
    return { task: `t${t.id}`, title: t.title, area: t.area, evidence: t.evidence, doneAt: t.done_at, idea: ex ? `c${ex.id}` : null };
  });
  c.out({ date, count: list.length, candidates: list, open: list.filter((x) => !x.idea).map((x) => x.task) },
    [`agentos content capture "<hook>" --source evidence --external-id task:t<id>:bip --evidence "<proof>" --tag "from your work"`]);
}

// ── the swipe deck: new ideas, scored the way the nightly plan scores them, with the reasons ──────
/** What he kept and killed, as topic words: the learning loop's memory for scoring (last 400 verdicts). */
function verdictSets(c: Ctx): { kept: [number, Set<string>][]; killed: [number, Set<string>][] } {
  const rows = c.cdb.query("SELECT id, title, verdict FROM content_ideas WHERE verdict LIKE 'kept%' OR verdict LIKE 'killed%' ORDER BY updated_at DESC LIMIT 400").all() as Row[];
  const kept: [number, Set<string>][] = [], killed: [number, Set<string>][] = [];
  for (const r of rows) (String(r.verdict).startsWith("killed") ? killed : kept).push([r.id, topicWords(r.title)]);
  return { kept, killed };
}
function deckList(c: Ctx, limit = 40, channel: string | null = null) {
  const prefs = prefsOf(c);
  const loop = verdictSets(c);
  const rows = c.cdb.query(`SELECT * FROM content_ideas WHERE status = 'inbox' ${channel ? "AND channel = ?" : ""} ORDER BY created_at DESC LIMIT 800`).all(...(channel ? [channel] : [])) as Row[];
  const scored = rows.map((i) => {
    const card = c.cdb.query("SELECT 1 FROM content_references WHERE idea_id = ? AND analysis IS NOT NULL").get(i.id);
    const script = c.cdb.query("SELECT 1 FROM content_scripts WHERE idea_id = ? LIMIT 1").get(i.id);
    return { i, ...scoreIdea(i, { hasScript: !!script, hasCard: !!card, topics: prefs.topics, today: c.today, ...loop }) };
  }).sort((x, y) => y.score - x.score || Date.parse(y.i.created_at) - Date.parse(x.i.created_at));
  return {
    count: rows.length,
    ideas: scored.slice(0, Math.max(0, limit)).map((x) => {
      const full = shapeIdea(c, x.i, true);
      return { ...full, raw: full.raw ? String(full.raw).slice(0, 600) : null, score: x.score, why: x.why };
    }),
  };
}
function deck(c: Ctx, a: Args) {
  const d = deckList(c, Number(c.str(a, "limit") ?? 40), c.str(a, "channel") ? channelOf(c, c.str(a, "channel")) : null);
  c.out(c.jsonOut ? d : { count: d.count, ideas: d.ideas.map((x) => ({ id: x.id, score: x.score, title: x.title, why: x.why.join("; ") })) },
    ["agentos content verdict c<id> keep", "agentos content verdict c<id> kill --why \"done before\""]);
}
/** One verdict from the deck (or the agent): keep, kill, script it now, or restore (undo). Each one is a learning row,
 *  so the loop remembers it; an --external-id (the phone's op id) makes a replay a no-op. */
function verdictCmd(c: Ctx, a: Args) {
  const id = num(a._[2], "c", c);
  const v = String(a._[3] ?? "").toLowerCase();
  if (!["keep", "kill", "script", "restore"].includes(v)) throw new c.UserError(`agentos content verdict c${id} keep|kill|script|restore [--why "..."] [--external-id x] [--was inbox]`);
  const r = row(c, "content_ideas", id);
  const ext = c.str(a, "external-id") ?? null;
  const key = ext ? `verdict:${ext}` : null;
  if (key && v !== "restore" && c.cdb.query("SELECT 1 FROM content_learnings WHERE external_id = ?").get(key))
    return c.out({ already: true, action: v, idea: shapeIdea(c, r, true), write: v === "script" }, ["agentos content deck"]);
  const why = c.str(a, "why")?.trim().slice(0, 300) || null;
  const stamp = c.iso();
  const was = c.str(a, "was");
  let status = r.status as string;
  if (v === "keep" || v === "script") status = ["inbox", "dropped"].includes(r.status) ? "picked" : r.status;
  if (v === "kill") status = "dropped";
  if (v === "restore") status = was && IDEA_STATUS.includes(was) ? was : ["dropped", "picked"].includes(r.status) ? "inbox" : r.status;
  const verdict = v === "restore" ? null : v === "kill" ? `killed${why ? `: ${why}` : ""}` : `kept${v === "script" ? " (script it now)" : ""}${why ? `: ${why}` : ""}`;
  c.cdb.transaction(() => {
    c.cdb.query("UPDATE content_ideas SET status = ?, verdict = ?, updated_at = ? WHERE id = ?").run(status, verdict, stamp, id);
    if (v === "restore") {
      const undo = c.str(a, "undo");
      if (undo) c.cdb.query("DELETE FROM content_learnings WHERE external_id = ?").run(`verdict:${undo}`);
      else c.cdb.query("DELETE FROM content_learnings WHERE id = (SELECT max(id) FROM content_learnings WHERE kind = 'verdict' AND receipt = ?)").run(`c${id}`);
    } else learn(c, { date: c.today, text: `${v === "kill" ? "Killed" : "Kept"}: ${r.title}${why ? ` (${why})` : ""}`, receipt: `c${id}`, source: "verdict", external: key ?? `verdict:c${id}:${sha(v + stamp)}` });
  })();
  c.out({ ok: true, action: v, idea: shapeIdea(c, row(c, "content_ideas", id), true), write: v === "script" }, v === "script" ? ["agentos content plan", "agentos content deck"] : ["agentos content deck"]);
}

// ── what the loop learned: rules (content-os lessons, edit notes) and his verdicts, each with its receipt ──
function learningsView(c: Ctx, limit = 40) {
  const rows = c.cdb.query("SELECT * FROM content_learnings WHERE coalesce(kind, 'rule') != 'verdict' ORDER BY coalesce(date, substr(created_at, 1, 10)) DESC, id DESC LIMIT 600").all() as Row[];
  const groups = new Map<string, Row>();
  for (const r of rows) {
    const k = String(r.text).trim().toLowerCase();
    const g = groups.get(k);
    if (g) { g.receipts.push(r.receipt); g.count++; g.muted = g.muted && !!r.muted; continue; }
    groups.set(k, { id: `l${r.id}`, text: r.text, date: r.date ?? String(r.created_at).slice(0, 10), kind: r.kind ?? "rule", source: r.source, muted: !!r.muted, receipts: [r.receipt], count: 1 });
  }
  const rules = [...groups.values()];
  const v = c.cdb.query(`SELECT l.*, i.title AS ititle, i.channel AS ichannel FROM content_learnings l
    LEFT JOIN content_ideas i ON l.receipt LIKE 'c%' AND i.id = CAST(substr(l.receipt, 2) AS INTEGER) WHERE l.kind = 'verdict' ORDER BY l.id DESC LIMIT 60`).all() as Row[];
  const verdicts = v.map((r) => ({ id: `l${r.id}`, at: r.created_at, idea: r.receipt, title: r.ititle ?? String(r.text).replace(/^(Kept|Killed):\s*/, ""), channel: r.ichannel ?? null,
    v: /^Killed/.test(r.text) ? "kill" : "keep", why: String(r.text).match(/\(([^()]*)\)\s*$/)?.[1] ?? null }));
  const since = `${addDays(c.today, -30)}T00:00:00`;
  const tally = c.cdb.query("SELECT sum(text LIKE 'Killed%') killed, sum(text LIKE 'Kept%') kept FROM content_learnings WHERE kind = 'verdict' AND created_at >= ?").get(since) as Row;
  return { rules: rules.slice(0, limit), verdicts, counts: { rules: rules.length, active: rules.filter((r) => !r.muted).length, kept30: tally?.kept ?? 0, killed30: tally?.killed ?? 0 } };
}
function learnings(c: Ctx, a: Args) {
  const v = learningsView(c, Number(c.str(a, "limit") ?? 40));
  c.out(c.jsonOut ? v : { ...v, rules: v.rules.map((r) => `${r.id}${r.muted ? " (off)" : ""} ${r.date}: ${String(r.text).slice(0, 120)}`).join("\n"), verdicts: v.verdicts.map((x) => `${x.v} ${x.title}`).join("\n") },
    ["agentos content learning l<id> --mute", "agentos content verdict c<id> kill --why ..."]);
}
/** A rule's switch: muted rules stop reaching the script writer (the same text everywhere it repeats). */
function learning(c: Ctx, a: Args) {
  const id = num(a._[2], "l", c);
  const r = c.cdb.query("SELECT * FROM content_learnings WHERE id = ?").get(id) as Row | null;
  if (!r) throw new c.UserError(`No learning l${id}.`);
  if (!a.flags.mute && !a.flags.unmute) return c.out({ learning: { ...r, id: `l${r.id}`, muted: !!r.muted } }, [`agentos content learning l${id} --mute`]);
  const muted = a.flags.mute ? 1 : 0;
  const n = c.cdb.query("UPDATE content_learnings SET muted = ?, updated_at = ? WHERE lower(trim(text)) = lower(trim(?)) AND muted != ?").run(muted, c.iso(), r.text, muted).changes;
  c.out({ ok: true, action: muted ? "muted" : "unmuted", learning: `l${id}`, rows: n, already: n === 0 }, ["agentos content learnings"]);
}
/** The rules the script writer reads (newest first, muted ones left out). */
export function activeRules(cdb: Database, limit = 12): string[] {
  const rows = cdb.query("SELECT text FROM content_learnings WHERE coalesce(kind, 'rule') != 'verdict' AND muted = 0 ORDER BY coalesce(date, substr(created_at, 1, 10)) DESC, id DESC LIMIT 300").all() as Row[];
  const seen = new Set<string>(), out: string[] = [];
  for (const r of rows) { const k = String(r.text).trim().toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(String(r.text).trim()); if (out.length >= limit) break; }
  return out;
}

// ── a script's rewrites: every revision keeps the version before it, so revert always brings it back ──
function scriptRevise(c: Ctx, id: number, r: Row, a: Args) {
  const file = c.str(a, "teleprompter-file");
  if (!file || !isFile(file)) throw new c.UserError(`agentos content script s${id} revise --teleprompter-file <txt> [--hook ..] [--cta ..] [--label "Shorter"] [--external-id x]`);
  const ext = c.str(a, "external-id") ?? null;
  const revs = parseJson(r.revisions, []) as Row[];
  if (ext && revs.some((x) => x.ext === ext)) return c.out({ already: true, script: shapeScript(c, r, true) }, [`agentos content script s${id} revert`]);
  const spoken = readText(file) ?? "";
  if (!spoken.trim()) throw new c.UserError("The rewrite is empty.");
  const words = countWords(spoken);
  const seconds = Number(c.str(a, "seconds")) || Math.round(words / 2.3);
  revs.push({ at: c.iso(), label: c.str(a, "label") ?? "Rewrite", ext, teleprompter_path: r.teleprompter_path, body_path: r.body_path, hook: r.hook, cta: r.cta, words: r.words, seconds: r.seconds });
  c.cdb.query("UPDATE content_scripts SET teleprompter_path = ?, hook = coalesce(?, hook), cta = coalesce(?, cta), words = ?, seconds = ?, revisions = ?, updated_at = ? WHERE id = ?")
    .run(file, c.str(a, "hook") ?? null, c.str(a, "cta") ?? null, words, seconds, JSON.stringify(revs.slice(-20)), c.iso(), id);
  c.out({ ok: true, action: "revised", script: shapeScript(c, row(c, "content_scripts", id), true) }, [`agentos content script s${id} revert`]);
}
function scriptRevert(c: Ctx, id: number, r: Row) {
  const revs = parseJson(r.revisions, []) as Row[];
  const last = revs.pop();
  if (!last) return c.out({ already: true, script: shapeScript(c, r, true), note: "nothing to revert" }, ["agentos content scripts"]);
  c.cdb.query("UPDATE content_scripts SET teleprompter_path = ?, hook = ?, cta = ?, words = ?, seconds = ?, revisions = ?, updated_at = ? WHERE id = ?")
    .run(last.teleprompter_path ?? null, last.hook ?? null, last.cta ?? null, last.words ?? r.words, last.seconds ?? r.seconds, JSON.stringify(revs), c.iso(), id);
  c.out({ ok: true, action: "reverted", label: last.label ?? null, script: shapeScript(c, row(c, "content_scripts", id), true) }, ["agentos content scripts"]);
}

// ── undo an approval: only a dry run (nothing reached RealFlow) can be taken back here ──
function unapprove(c: Ctx, a: Args) {
  const id = num(a._[2], "e", c);
  const e = row(c, "content_edits", id);
  const post = c.cdb.query("SELECT * FROM content_posts WHERE edit_id = ? AND status IN ('scheduled','dry-run') ORDER BY id DESC LIMIT 1").get(id) as Row | null;
  if (e.status !== "approved" && !post) return c.out({ already: true, edit: shapeEdit(c, e) }, ["agentos content edits"]);
  if (post && post.status === "scheduled" && post.realflow_id) throw new c.UserError(`e${id} is booked in RealFlow (${post.realflow_id}); cancel it there first.`);
  const stamp = c.iso();
  c.cdb.transaction(() => {
    if (post) c.cdb.query("DELETE FROM content_posts WHERE id = ?").run(post.id);
    c.cdb.query("UPDATE content_edits SET status = 'review', updated_at = ? WHERE id = ?").run(stamp, id);
    const s = e.script_id ? (c.cdb.query("SELECT idea_id FROM content_scripts WHERE id = ?").get(e.script_id) as Row | null) : null;
    if (s?.idea_id) c.cdb.query("UPDATE content_ideas SET status = 'edited', updated_at = ? WHERE id = ? AND status = 'scheduled'").run(stamp, s.idea_id);
  })();
  c.out({ ok: true, action: "unapproved", edit: shapeEdit(c, row(c, "content_edits", id)) }, ["agentos content edits"]);
}

// ── the RealFlow ledger: what content-os actually scheduled (state/history.jsonl + receipts), as posts ──
const prettyId = (id: string) => { const t = id.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/[-_]+/g, " ").trim(); return t ? t[0].toUpperCase() + t.slice(1) : id; };
function pipelineTitle(dir: string, id: string): string | null {
  for (const sub of ["01-ideas", "02-selected", "03-scripts", "04-shoot"]) {
    const src = readText(join(dir, "pipeline", sub, `${id}.md`), 40_000);
    if (src) { const { fm, body } = frontmatter(src); return fm.title || titleOf(body, "") || null; }
  }
  return null;
}
export function realflowSync(c: Ctx, dir: string) {
  const hist = readText(join(dir, "state", "history.jsonl"), 50_000_000);
  const rdir = join(dir, "state", "realflow", "receipts");
  if (hist == null && !isDir(rdir)) return { found: false, dir };
  // per post: its source and latest state; per source: the post that is current (a re-created post supersedes the old one)
  const posts = new Map<string, Row>(), current = new Map<string, string>();
  for (const line of (hist ?? "").split("\n")) {
    if (!line.includes('"realflow"')) continue;
    const j = parseJson(line, null);
    if (!j || !/^schedule/.test(String(j.cmd)) || j.detail?.provider !== "realflow" || !j.detail?.postId) continue;
    const p = posts.get(j.detail.postId) ?? { postId: j.detail.postId, sourceId: j.id, first: j.ts };
    p.status = j.cmd === "schedule.cancel" ? "cancelled" : (j.detail.status ?? p.status ?? "scheduled");
    if (j.detail.scheduledAt !== undefined) p.at = j.detail.scheduledAt ?? p.at ?? null;
    posts.set(p.postId, p);
    current.set(j.id, p.postId);
  }
  for (const f of ls(rdir)) {
    if (!f.endsWith(".json")) continue;
    const j = parseJson(readText(join(rdir, f), 5_000_000), null);
    if (!j?.postId || !j.sourceId) continue;
    const p = posts.get(j.postId) ?? { postId: j.postId, sourceId: j.sourceId, first: j.createdAt };
    if (j.status) p.status = j.status;
    if (j.scheduledAt) p.at = j.scheduledAt;
    posts.set(p.postId, p);
    current.set(j.sourceId, j.postId);
  }
  const STATUS: Record<string, string> = { scheduled: "scheduled", cancelled: "cancelled", canceled: "cancelled", published: "posted", posted: "posted", draft: "draft", failed: "failed" };
  let added = 0, updated = 0;
  const stamp = c.iso();
  c.cdb.transaction(() => {
    for (const p of posts.values()) {
      const superseded = current.get(p.sourceId) !== p.postId;
      const status = superseded ? "cancelled" : (STATUS[String(p.status ?? "").toLowerCase()] ?? "scheduled");
      const at = p.at && !Number.isNaN(Date.parse(p.at)) ? new Date(p.at).toISOString() : null;
      const ext = `realflow:${p.postId}`;
      const ex = c.cdb.query("SELECT * FROM content_posts WHERE external_id = ?").get(ext) as Row | null;
      if (!ex && (superseded || (!at && status === "draft"))) continue;   // never shown: an old copy, or a draft with no time
      const idea = c.cdb.query("SELECT id, title FROM content_ideas WHERE external_id = ?").get(`content-os:idea:${p.sourceId}`) as Row | null;
      const edit = c.cdb.query("SELECT id FROM content_edits WHERE external_id = ?").get(`content-os:edit:${p.sourceId}`) as Row | null;
      const title = String(idea?.title ?? pipelineTitle(dir, p.sourceId) ?? prettyId(p.sourceId)).slice(0, 300);
      if (!ex) {
        const created = p.first && !Number.isNaN(Date.parse(p.first)) ? new Date(p.first).toISOString() : stamp;
        c.cdb.query(`INSERT INTO content_posts (edit_id, channel, platform, realflow_id, scheduled_at, status, title, idea_id, source, external_id, created_at, updated_at)
          VALUES (?, ?, 'instagram', ?, ?, ?, ?, ?, 'content-os', ?, ?, ?)`).run(edit?.id ?? null, MAIN, p.postId, at, status, title, idea?.id ?? null, ext, created, stamp);
        added++;
      } else if (ex.status !== status || ex.scheduled_at !== at || ex.title !== title || (ex.idea_id ?? null) !== (idea?.id ?? null)) {
        c.cdb.query("UPDATE content_posts SET status = ?, scheduled_at = ?, title = ?, idea_id = ?, edit_id = coalesce(edit_id, ?), updated_at = ? WHERE id = ?")
          .run(status, at, title, idea?.id ?? null, edit?.id ?? null, stamp, ex.id);
        updated++;
      }
      if (idea && status === "scheduled") c.cdb.query("UPDATE content_ideas SET status = 'scheduled', updated_at = ? WHERE id = ? AND status IN ('inbox','picked','scripted','approved','shot','edited')").run(stamp, idea.id);
      // an edit RealFlow has booked was approved (in content-os, before this app saw it): it no longer waits for him
      if (edit && (status === "scheduled" || status === "posted")) c.cdb.query("UPDATE content_edits SET status = 'approved', updated_at = ? WHERE id = ? AND status IN ('review','draft','redo')").run(stamp, edit.id);
    }
  })();
  const n = c.cdb.query("SELECT status, count(*) n FROM content_posts WHERE source = 'content-os' GROUP BY status").all() as Row[];
  return { found: true, dir, posts: posts.size, added, updated, byStatus: Object.fromEntries(n.map((r) => [r.status, r.n])) };
}
function realflow(c: Ctx, a: Args) {
  const dir = c.str(a, "content-os") ?? setting(c, "paths.content_os") ?? join(homedir(), "content-os");
  const r = realflowSync(c, dir);
  if (r.found) setSetting(c, "realflow.last", c.iso());
  c.out({ ok: true, action: "synced", ...r }, ["agentos content posts", "agentos content"]);
}

// ── show ────────────────────────────────────────────────────────────────────
function show(c: Ctx, a: Args) {
  const s = String(a._[2] ?? "").toLowerCase();
  const m = s.match(/^([csedkrp])(\d+)$/);
  if (!m) throw new c.UserError("agentos content show <c|s|e|r|d|k|p><id>");
  const table = PREFIX[m[1]], id = Number(m[2]);
  const r = row(c, table, id);
  const shaped = table === "content_ideas" ? { idea: shapeIdea(c, r, true), scripts: (c.cdb.query("SELECT * FROM content_scripts WHERE idea_id = ? ORDER BY version").all(id) as Row[]).map((x) => shapeScript(c, x, false)) }
    : table === "content_scripts" ? { script: shapeScript(c, r, true) }
    : table === "content_edits" ? { edit: shapeEdit(c, r, true), posts: (c.cdb.query("SELECT * FROM content_posts WHERE edit_id = ?").all(id) as Row[]).map((x) => shapePost(c, x)) }
    : table === "content_references" ? { reference: shapeReference(c, r, true) }
    : table === "content_shoot_days" ? { shootDay: { id: tag(table, id), ...packFor(c, r.date, !!a.flags.full) }, picks: parseJson(r.picks, []) }
    : table === "content_takes" ? { take: shapeTake(c, r) } : { post: shapePost(c, r) };
  c.out(shaped, ["agentos content"]);
}

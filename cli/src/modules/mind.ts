// Mind: screen time, books and reading sessions, courses and lessons, the evening check-in. (v2)
// Every table here is a phone collection (server/modules/_collection.ts shape: id, data JSON, created_at, updated_at,
// deleted_at, rev, plus a few query columns), so the phone syncs it offline-first and this CLI, the phone server and
// the agent's tools all write the same rows. The pure logic (which app a window is, what kind of time it is, the
// check-in's blocks, labels and first guesses, the course import) lives here too; the phone server imports it.
//   agentos mind [--date d]                 the day: screen time by app and kind, reading, learning, the check-in
//   agentos mind rollup [--date d]          the PC's ribbon samples → per app and hour rows (source pc)
//   agentos mind import-courses [--from dir] [--folders]   Skool lessons (learn-ai.json) → courses + lessons
//   agentos mind books | book add "<title>" [--author a] [--pages n] [--isbn x] | read "<book>" --minutes n [--pages n|--to p]
//   agentos mind courses | park <course> | unpark <course> | lesson done <lesson>
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Args, ModCtx, Module } from "./types";

// ── tables (collection shape) ───────────────────────────────────────────────
type Col = "text" | "real" | "integer";
export const TABLES: Record<string, Record<string, Col>> = {
  mind_books: { title: "text", author: "text", status: "text", isbn: "text", pages: "integer", page: "integer" },
  mind_sessions: { kind: "text", date: "text", book: "text", course: "text", lesson: "text", minutes: "real" },
  mind_highlights: { book: "text", kind: "text" },
  mind_courses: { title: "text", status: "text", source: "text", position: "integer" },
  mind_lessons: { course: "text", n: "integer", status: "text" },
  mind_checkins: { date: "text" },
  mind_screen: { date: "text", hour: "integer", app: "text", minutes: "real", source: "text" },
  mind_apps: { kind: "text" },
};
const META = new Set(["id", "created_at", "updated_at", "deleted_at", "rev", "data"]);
export function ddl(table: string): string {
  const cols = Object.entries(TABLES[table]).map(([k, t]) => `,\n  ${k} ${t.toUpperCase()}`).join("");
  return `CREATE TABLE IF NOT EXISTS ${table} (\n  id TEXT PRIMARY KEY,\n  data TEXT NOT NULL DEFAULT '{}',\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  deleted_at TEXT,\n  rev INTEGER NOT NULL DEFAULT 0${cols}\n);\nCREATE INDEX IF NOT EXISTS ${table}_rev ON ${table}(rev);`;
}
export function migrate(db: Database) {
  for (const t of Object.keys(TABLES)) db.exec(ddl(t));
  db.exec("CREATE INDEX IF NOT EXISTS mind_screen_date ON mind_screen(date); CREATE INDEX IF NOT EXISTS mind_sessions_date ON mind_sessions(date); CREATE INDEX IF NOT EXISTS mind_lessons_course ON mind_lessons(course, n);");
}

// ── docs: the same encoding as _collection.ts (columns in their own field, the rest in data) ─────────
export function toDoc(table: string, r: any) {
  if (!r) return null;
  let rest: Record<string, unknown> = {};
  try { rest = JSON.parse(r.data ?? "{}"); } catch {}
  const doc: Record<string, any> = { ...rest, id: r.id, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at ?? null };
  for (const k of Object.keys(TABLES[table])) doc[k] = r[k] ?? null;
  return doc;
}
export const getDoc = (db: Database, table: string, id: string) => toDoc(table, db.query(`SELECT * FROM ${table} WHERE id = ?`).get(id));
export function listDocs(db: Database, table: string, where = "", ...params: any[]) {
  return (db.query(`SELECT * FROM ${table} WHERE deleted_at IS NULL ${where ? `AND ${where}` : ""} ORDER BY rev`).all(...params) as any[]).map((r) => toDoc(table, r)!);
}
/** Upsert a doc by id. `patch` merges onto what is there; updated_at is always now (a write from the PC wins). */
export function putDoc(db: Database, table: string, doc: Record<string, any>, { patch = true } = {}) {
  const now = new Date().toISOString();
  const cur = getDoc(db, table, doc.id);
  const full: Record<string, any> = { ...(patch && cur ? cur : {}), ...doc, created_at: cur?.created_at ?? doc.created_at ?? now, updated_at: now, deleted_at: doc.deleted_at ?? null };
  if (cur && cur.updated_at >= now) full.updated_at = new Date(Date.parse(cur.updated_at) + 1).toISOString(); // keep LWW moving forward
  const cols = TABLES[table];
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(full)) if (!META.has(k) && !(k in cols)) rest[k] = v;
  const row: Record<string, any> = { id: full.id, data: JSON.stringify(rest), created_at: full.created_at, updated_at: full.updated_at, deleted_at: full.deleted_at };
  for (const [k, t] of Object.entries(cols)) { const v = full[k]; row[k] = v == null ? null : t === "text" ? String(v) : Number(v); }
  row.rev = (db.query(`SELECT coalesce(max(rev), 0) + 1 AS r FROM ${table}`).get() as any).r;
  const keys = Object.keys(row);
  db.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
    ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`).run(...Object.values(row));
  return getDoc(db, table, full.id)!;
}
export function delDoc(db: Database, table: string, id: string) {
  const cur = getDoc(db, table, id);
  if (!cur || cur.deleted_at) return cur;
  return putDoc(db, table, { id, deleted_at: new Date().toISOString() });
}
export const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ── time (IST) ──────────────────────────────────────────────────────────────
const OFF = 330 * 60000;
export const istDateOf = (d: Date | number = new Date()) => new Date(+d + OFF).toISOString().slice(0, 10);
export const istMin = (iso: string) => { const t = new Date(Date.parse(iso) + OFF); return t.getUTCHours() * 60 + t.getUTCMinutes() + t.getUTCSeconds() / 60; };
export function bounds(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Bad date ${date}`);
  const from = new Date(`${date}T00:00:00+05:30`);
  return { from: from.toISOString(), to: new Date(+from + 864e5).toISOString() };
}
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const fmt = (m: number) => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;

// ── apps: what a window (or a phone app) is, and what kind of time it is ───────────
export type Kind = "work" | "learning" | "social" | "entertainment";
export type Cat = "video" | "feed" | "chat" | "ai" | "browser" | "tool" | "learn" | "other";
export type AppInfo = { id: string; name: string; kind: Kind; ask: boolean; glyph: string; cat: Cat };
const K: Record<string, [string, Kind, boolean, string, Cat]> = {
  windowsterminal: ["Terminal", "work", false, "code", "tool"], code: ["VS Code", "work", false, "code", "tool"], cursor: ["Cursor", "work", false, "code", "tool"],
  claude: ["Claude", "work", false, "claude", "ai"], codex: ["Codex", "work", false, "code", "ai"], chatgpt: ["ChatGPT", "work", true, "sparkle", "ai"], gemini: ["Gemini", "work", true, "sparkle", "ai"],
  chrome: ["Chrome", "work", true, "globe", "browser"], arc: ["Arc", "work", true, "globe", "browser"], opera: ["Opera", "work", true, "globe", "browser"],
  photos: ["Photos", "entertainment", true, "photo", "video"], vlc: ["VLC", "entertainment", true, "video", "video"], mediaplayer: ["Media Player", "entertainment", true, "video", "video"], wmplayer: ["Media Player", "entertainment", true, "video", "video"], msedge: ["Edge", "work", true, "globe", "browser"], firefox: ["Firefox", "work", true, "globe", "browser"], brave: ["Brave", "work", true, "globe", "browser"], safari: ["Safari", "work", true, "globe", "browser"],
  explorer: ["File Explorer", "work", false, "grid", "tool"], obsidian: ["Obsidian", "work", false, "note", "tool"], notion: ["Notion", "work", false, "note", "tool"], figma: ["Figma", "work", false, "grid", "tool"],
  capcut: ["CapCut", "work", false, "video", "tool"], premiere: ["Premiere", "work", false, "video", "tool"], photoshop: ["Photoshop", "work", false, "photo", "tool"], camera: ["Camera", "work", false, "camera", "tool"],
  gmail: ["Gmail", "work", false, "mail", "tool"], outlook: ["Outlook", "work", false, "mail", "tool"], github: ["GitHub", "work", false, "code", "tool"], agentic: ["Agentic OS", "work", false, "rings", "tool"],
  whatsapp: ["WhatsApp", "social", true, "chat", "chat"], telegram: ["Telegram", "social", true, "chat", "chat"], discord: ["Discord", "social", true, "chat", "chat"], messages: ["Messages", "social", false, "chat", "chat"],
  instagram: ["Instagram", "social", true, "photo", "feed"], x: ["X", "entertainment", true, "globe", "feed"], reddit: ["Reddit", "entertainment", true, "globe", "feed"], linkedin: ["LinkedIn", "work", true, "globe", "feed"], facebook: ["Facebook", "social", true, "photo", "feed"], snapchat: ["Snapchat", "social", true, "photo", "feed"],
  youtube: ["YouTube", "entertainment", true, "video", "video"], netflix: ["Netflix", "entertainment", false, "video", "video"], primevideo: ["Prime Video", "entertainment", false, "video", "video"], hotstar: ["Hotstar", "entertainment", false, "video", "video"], spotify: ["Spotify", "entertainment", false, "music", "video"],
  skool: ["Skool", "learning", false, "cap", "learn"], coursera: ["Coursera", "learning", false, "cap", "learn"], udemy: ["Udemy", "learning", false, "cap", "learn"], kindle: ["Kindle", "learning", false, "book", "learn"], duolingo: ["Duolingo", "learning", false, "cap", "learn"],
};
// windows that are the system, not an app he used
const SKIP = new Set(["idle", "shellhost", "lockapp", "searchhost", "searchapp", "shellexperiencehost", "startmenuexperiencehost", "applicationframehost", "systemsettings", "taskmgr", "", "unknown"]);
const BROWSERS = new Set(["chrome", "msedge", "firefox", "brave", "safari", "opera", "arc"]);
const SITES: [RegExp, string][] = [[/youtube/i, "youtube"], [/instagram/i, "instagram"], [/whatsapp/i, "whatsapp"], [/gmail|inbox \(\d+\)|- mail/i, "gmail"],
  [/github/i, "github"], [/skool/i, "skool"], [/linkedin/i, "linkedin"], [/reddit/i, "reddit"], [/ on x\b|\/ x\b|twitter/i, "x"], [/netflix/i, "netflix"],
  [/chatgpt/i, "chatgpt"], [/claude/i, "claude"], [/coursera/i, "coursera"], [/udemy/i, "udemy"], [/hotstar/i, "hotstar"], [/prime video/i, "primevideo"], [/facebook/i, "facebook"]];
// titles that must never be quoted back or sent to the model: adult content, money and passwords. They still count
// as time; the check-in just says some windows were private
export const PRIVATE = /(porn|xxx|nsfw|onlyfans|\bsex|orgasm|foreplay|nude|naked|erotic|hentai|escort|stamina trainer|female body|password|passcode|\botp\b|bank|net ?banking|upi pin|cvv)/i;
const slugOf = (s: string) => s.toLowerCase().replace(/\.exe$/, "").replace(/[^a-z0-9]+/g, "").slice(0, 40);
/** The app a PC sample belongs to: browsers are split by the site in the title. null = the system, not an app. */
export function appOfSample(process: string | null, title: string | null): string | null {
  const p = slugOf(process ?? "");
  if (SKIP.has(p)) return null;
  if (BROWSERS.has(p)) for (const [re, id] of SITES) if (re.test(title ?? "")) return id;
  return p || null;
}
/** What an app is. `over` is his own word on it (a mind_apps doc: { kind, ask, name }). */
export function appInfo(id: string, over?: any): AppInfo {
  const k = K[id];
  const base: AppInfo = k ? { id, name: k[0], kind: k[1], ask: k[2], glyph: k[3], cat: k[4] }
    : { id, name: id.charAt(0).toUpperCase() + id.slice(1), kind: "work", ask: true, glyph: "grid", cat: "other" };
  if (over && !over.deleted_at) {
    if (over.kind) base.kind = over.kind;
    if (typeof over.ask === "boolean") base.ask = over.ask;
    if (over.name) base.name = over.name;
  }
  return base;
}
/** Find an app by a word he used ("insta", "YouTube", "yt"). */
export function appByName(word: string): string {
  const w = slugOf(word);
  const alias: Record<string, string> = { insta: "instagram", ig: "instagram", yt: "youtube", wa: "whatsapp", twitter: "x", gpt: "chatgpt", terminal: "windowsterminal", vscode: "code" };
  if (alias[w]) return alias[w];
  if (K[w]) return w;
  const hit = Object.entries(K).find(([id, v]) => slugOf(v[0]) === w || id.startsWith(w));
  return hit ? hit[0] : w;
}

// the answers a block can get, per kind of app: [id, name, kind, where it is filed on the wheel]
export type Label = { id: string; name: string; kind: Kind; aspect: string | null };
const L = (id: string, name: string, kind: Kind, aspect: string | null): Label => ({ id, name, kind, aspect });
export const LABELS: Record<Cat, Label[]> = {
  video: [L("learn", "Learning", "learning", "mind"), L("fun", "Entertainment", "entertainment", null), L("music", "Music", "entertainment", null), L("work", "Work research", "work", "mission")],
  feed: [L("research", "Content research", "work", "mission"), L("scroll", "Scrolling", "entertainment", null), L("dms", "Friends’ messages", "social", "friends"), L("posting", "Posting", "work", "mission")],
  chat: [L("friends", "Friends", "social", "friends"), L("clients", "Clients", "work", "mission"), L("college", "College", "learning", "mind"), L("family", "Family", "social", "family")],
  ai: [L("work", "Work", "work", "mission"), L("college", "College", "learning", "mind"), L("learn", "Learning", "learning", "mind"), L("personal", "Personal", "social", null)],
  browser: [L("work", "Work", "work", "mission"), L("learn", "Learning", "learning", "mind"), L("fun", "Entertainment", "entertainment", null), L("shop", "Shopping", "entertainment", null)],
  tool: [L("work", "Work", "work", "mission"), L("learn", "Learning", "learning", "mind"), L("college", "College", "learning", "mind"), L("personal", "Personal", "social", null)],
  learn: [L("learn", "Learning", "learning", "mind"), L("college", "College", "learning", "mind"), L("work", "Work", "work", "mission"), L("fun", "Entertainment", "entertainment", null)],
  other: [L("work", "Work", "work", "mission"), L("learn", "Learning", "learning", "mind"), L("social", "People", "social", null), L("fun", "Entertainment", "entertainment", null)],
};
const DEFAULT_LABEL: Record<Cat, string> = { video: "fun", feed: "scroll", chat: "friends", ai: "work", browser: "work", tool: "work", learn: "learn", other: "work" };
const LEARN_RE = /(tutorial|course|lesson|lecture|how to|learn|explained|guide|crash course|masterclass|claude|agent|\bai\b|coding|python|javascript|n8n|skool|automation|study|exam)/i;
const MUSIC_RE = /(music|song|lyrics|lofi|lo-fi|playlist|official (video|audio)|\baudio\b|remix)/i;
const CLIENT_RE = /(client|order|invoice|business|store|shop|customer)/i;
const FAMILY_RE = /(mom|dad|mom|dad|family|bhai|didi)/i;
/** A first guess for one title, without the agent: which label it most likely was. */
export function labelForTitle(cat: Cat, title: string): string {
  if (cat === "video" || cat === "browser") { if (LEARN_RE.test(title)) return "learn"; if (cat === "video" && MUSIC_RE.test(title)) return "music"; }
  if (cat === "chat") { if (FAMILY_RE.test(title)) return "family"; if (CLIENT_RE.test(title)) return "clients"; }
  if (cat === "ai" && /(assignment|college|exam|semester)/i.test(title)) return "college";
  return DEFAULT_LABEL[cat];
}
/** Split `total` minutes over [[label, weight]] in whole minutes, biggest first, at most `n` parts. */
export function splitMinutes(weights: [string, number][], total: number, n = 2): [string, number][] {
  const w = weights.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n);
  total = Math.round(total);
  if (!w.length || total < 1) return [];
  if (w.length > 1 && total < 2) return [[w[0][0], total]];
  const sum = w.reduce((s, [, v]) => s + v, 0);
  let left = total;
  const out = w.map(([l, v], i) => { const m = i === w.length - 1 ? left : Math.max(1, Math.round((total * v) / sum)); left -= m; return [l, m] as [string, number]; });
  return out.filter(([, m]) => m > 0);
}

// ── the PC's ribbon samples → mind_screen rows (source pc), one per app and hour ──────────────
const hasTable = (db: Database, t: string) => !!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
export function pcSamples(db: Database, date: string) {
  if (!hasTable(db, "ribbon_samples")) return [];
  const { from, to } = bounds(date);
  return (db.query("SELECT at, title, process, seconds FROM ribbon_samples WHERE at >= ? AND at < ? ORDER BY at").all(from, to) as any[])
    .map((r) => ({ at: r.at as string, title: (r.title ?? "") as string, process: r.process as string, s: Number(r.seconds) || 30, app: appOfSample(r.process, r.title) }))
    .filter((r) => r.app);
}
export function rollup(db: Database, date: string) {
  const samples = pcSamples(db, date);
  const by = new Map<string, number>();
  for (const s of samples) { const h = Math.floor(istMin(s.at) / 60); const k = `${s.app}\n${h}`; by.set(k, (by.get(k) ?? 0) + s.s / 60); }
  const seen = new Set<string>();
  let written = 0;
  db.transaction(() => {
    for (const [k, m] of by) {
      const [app, h] = k.split("\n");
      const id = `pc.${date}.${h.padStart(2, "0")}.${app}`;
      seen.add(id);
      const minutes = Math.round(m * 10) / 10;
      const cur = getDoc(db, "mind_screen", id);
      if (cur && !cur.deleted_at && Number(cur.minutes) === minutes) continue;
      putDoc(db, "mind_screen", { id, date, hour: Number(h), app, minutes, source: "pc", device: "pc" }, { patch: false });
      written++;
    }
    for (const r of listDocs(db, "mind_screen", "date = ? AND source = 'pc'", date)) if (!seen.has(r.id)) { delDoc(db, "mind_screen", r.id); written++; }
  })();
  return { date, apps: new Set([...by.keys()].map((k) => k.split("\n")[0])).size, rows: by.size, written };
}

// ── a day: apps with their hours and visits, kinds, the check-in's blocks ─────────────────────
export type DayApp = AppInfo & { minutes: number; hours: Record<number, number>; sessions: [number, number][]; source: string; titles: [string, number][]; private?: number };
export function overrides(db: Database) { return new Map(listDocs(db, "mind_apps").map((d) => [d.id, d])); }
export function dayApps(db: Database, date: string, { withPc = true } = {}): DayApp[] {
  const over = overrides(db);
  const apps = new Map<string, DayApp>();
  const get = (id: string, source: string) => {
    let a = apps.get(id);
    if (!a) { a = { ...appInfo(id, over.get(id)), minutes: 0, hours: {}, sessions: [], source, titles: [] }; apps.set(id, a); }
    else if (a.source !== source) a.source = "both";
    return a;
  };
  if (withPc) {
    const samples = pcSamples(db, date);
    const titles = new Map<string, Map<string, number>>();
    let open: Record<string, { s: number; e: number }> = {};
    for (const s of samples) {
      const a = get(s.app!, "pc");
      const m0 = istMin(s.at), len = s.s / 60, h = Math.floor(m0 / 60);
      a.minutes += len; a.hours[h] = (a.hours[h] ?? 0) + len;
      const o = open[a.id];
      if (o && m0 - o.e <= 2) o.e = m0 + len; else { if (o) a.sessions.push([Math.round(o.s), Math.max(1, Math.round(o.e - o.s))]); open[a.id] = { s: m0, e: m0 + len }; }
      if (s.title && s.title !== "[redacted]") {
        if (PRIVATE.test(s.title)) a.private = (a.private ?? 0) + len;
        else { const t = titles.get(a.id) ?? new Map(); t.set(s.title, (t.get(s.title) ?? 0) + len); titles.set(a.id, t); }
      }
    }
    for (const [id, o] of Object.entries(open)) apps.get(id)!.sessions.push([Math.round(o.s), Math.max(1, Math.round(o.e - o.s))]);
    for (const [id, t] of titles) apps.get(id)!.titles = [...t].sort((x, y) => y[1] - x[1]).slice(0, 12).map(([k, v]) => [k, Math.round(v)]);
  }
  // his own entries and the phone's (manual, phone, screentime): hours as given
  for (const r of listDocs(db, "mind_screen", "date = ? AND source != 'pc'", date)) {
    const a = get(String(r.app), String(r.source));
    const m = Number(r.minutes) || 0; a.minutes += m;
    if (r.hour != null) { a.hours[r.hour] = (a.hours[r.hour] ?? 0) + m; a.sessions.push([r.hour * 60 + (Number(r.at_min) || 0), Math.max(1, Math.round(m))]); }
  }
  for (const a of apps.values()) {
    a.minutes = Math.round(a.minutes);
    for (const h of Object.keys(a.hours)) a.hours[+h] = Math.round(a.hours[+h] * 10) / 10;
    a.sessions.sort((x, y) => x[0] - y[0]);
  }
  return [...apps.values()].filter((a) => a.minutes >= 1).sort((x, y) => y.minutes - x.minutes);
}
/** Minutes per kind for a day's apps, with the check-in's answers where there are some. */
export function kindsOf(apps: { id: string; kind: Kind; minutes: number; cat: Cat }[], answers?: Record<string, [string, number][]> | null) {
  const k: Record<Kind, number> = { work: 0, learning: 0, social: 0, entertainment: 0 };
  for (const a of apps) {
    const ans = answers?.[a.id];
    if (ans?.length) {
      const total = ans.reduce((s, [, m]) => s + m, 0);
      for (const [lid, m] of ans) { const lb = LABELS[a.cat].find((x) => x.id === lid) ?? LABELS.other.find((x) => x.id === lid); k[lb?.kind ?? a.kind] += m; }
      if (a.minutes > total) k[a.kind] += a.minutes - total;   // time after the answer
    } else k[a.kind] += a.minutes;
  }
  for (const x of Object.keys(k) as Kind[]) k[x] = Math.round(k[x]);
  return k;
}
export const checkinId = (date: string) => `ci.${date}`;
export const answered = (ci: any) => !!(ci && !ci.deleted_at && ci.at);
/** The blocks the check-in asks about: apps she can't sort alone, 10 minutes or more, the biggest three. */
export function blocksFor(apps: DayApp[], ci?: any) {
  const guess = ci?.guess ?? {};
  return apps.filter((a) => a.ask && a.minutes >= 10).slice(0, 3).map((a) => {
    const labels = LABELS[a.cat];
    const g = guess[a.id];
    let split: [string, number][] = [];
    let why = "", by = "rules";
    if (g?.split?.length && g.split.every(([l]: [string]) => labels.some((x) => x.id === l))) {
      const sum = g.split.reduce((s: number, [, m]: [string, number]) => s + m, 0) || 1;
      split = splitMinutes(g.split.map(([l, m]: [string, number]) => [l, m / sum]), a.minutes, 3); why = g.why ?? ""; by = g.by ?? "wyn";
    } else {
      const w = new Map<string, number>();
      for (const [t, m] of a.titles) { const l = labelForTitle(a.cat, t); w.set(l, (w.get(l) ?? 0) + m); }
      if (!w.size) w.set(DEFAULT_LABEL[a.cat], 1);
      split = splitMinutes([...w], a.minutes, 2);
      const shown = a.titles.map(([t]) => t.replace(/\s+[-–|]\s+(Google Chrome|Microsoft Edge|Mozilla Firefox|Brave|YouTube).*$/i, "").trim()).filter(Boolean).slice(0, 2).map((t) => `“${t.length > 42 ? `${t.slice(0, 40)}…` : t}”`);
      const priv = Math.round(a.private ?? 0);
      why = shown.length ? `Windows like ${shown.join(" and ")}.${priv ? ` ${fmt(priv)} was private, so I didn't read it.` : ""}`
        : priv ? "These windows looked private, so I didn't read them." : a.source === "pc" ? "I only see the app, not what was in it." : "From what you told me.";
    }
    return { app: a.id, name: a.name, min: a.minutes, when: whenOf(a), why, by, labels, guess: split };
  });
}
export function whenOf(a: { sessions: [number, number][]; source: string }) {
  const n = a.sessions.length;
  if (!n) return a.source === "pc" ? "On your PC" : "From your log";
  const big = [...a.sessions].sort((x, y) => y[1] - x[1])[0];
  const dev = a.source === "pc" ? " on your PC" : "";
  return n === 1 ? `One sitting at ${hhmm(big[0])}${dev}` : `${n} visits${dev}, the longest at ${hhmm(big[0])}`;
}
/** Nights in a row with the check-in answered, up to `date` (today counts once answered; until noon tomorrow a late answer still counts). */
export function streak(dates: Set<string>, date: string) {
  let n = 0, d = dates.has(date) ? date : addDays(date, -1);
  while (dates.has(d)) { n++; d = addDays(d, -1); }
  return n;
}
/** The usual day, by the hour: the average of the same weekday over the last four weeks that have data, else every day. */
export function usual(db: Database, date: string) {
  const sumDay = (d: string) => { const h: Record<number, number> = {}; for (const r of listDocs(db, "mind_screen", "date = ?", d)) h[r.hour] = (h[r.hour] ?? 0) + Number(r.minutes || 0); return h; };
  const pick = (dates: string[]) => dates.map(sumDay).filter((h) => Object.keys(h).length);
  let days = pick([7, 14, 21, 28].map((n) => addDays(date, -n))), basis = "weekday";
  if (days.length < 2) { days = pick(Array.from({ length: 28 }, (_, i) => addDays(date, -1 - i))); basis = "days"; }
  const out: Record<number, number> = {};
  for (const h of days) for (const [k, v] of Object.entries(h)) out[+k] = (out[+k] ?? 0) + v;
  for (const k of Object.keys(out)) out[+k] = Math.round(out[+k] / Math.max(1, days.length));
  return { hours: out, days: days.length, basis };
}

// ── reading and learning ──────────────────────────────────────────────────────
export function findBook(db: Database, word: string) {
  const w = word.trim().toLowerCase();
  const books = listDocs(db, "mind_books");
  return books.find((b) => b.id === word) ?? books.find((b) => String(b.title).toLowerCase() === w)
    ?? books.find((b) => String(b.title).toLowerCase().includes(w) || (w.length > 3 && w.includes(String(b.title).toLowerCase())))
    ?? books.find((b) => b.isbn && String(b.isbn) === w.replace(/[^0-9x]/gi, "")) ?? null;
}
export function addBook(db: Database, f: { title: string; author?: string; pages?: number; isbn?: string; status?: string; why?: string; cover?: string }) {
  const title = String(f.title ?? "").trim();
  if (!title) throw new Error("A book needs a title.");
  const dup = (f.isbn && listDocs(db, "mind_books", "isbn = ?", f.isbn)[0]) || listDocs(db, "mind_books").find((b) => String(b.title).toLowerCase() === title.toLowerCase());
  if (dup) return { book: dup, already: true };
  const n = listDocs(db, "mind_books").length;
  return { book: putDoc(db, "mind_books", { id: newId("bk"), title, author: f.author ?? null, pages: f.pages ?? null, page: 0, isbn: f.isbn ?? null, status: f.status ?? "next", why: f.why ?? null, cover: f.cover ?? null, tone: (n % 6) + 1 }), already: false };
}
/** A reading session: moves the book's page and puts it on "reading now". */
export function logReading(db: Database, f: { book: string; minutes?: number; pages?: number; to?: number; date?: string; source?: string; note?: string }) {
  let b = findBook(db, f.book);
  if (!b) b = addBook(db, { title: f.book, status: "reading" }).book;
  const from = Number(b.page) || 0;
  const pace = readingPace(db, b.id);
  const minutes = f.minutes ?? (f.pages ? Math.max(1, Math.round(f.pages / pace)) : f.to != null ? Math.max(1, Math.round((f.to - from) / pace)) : 20);
  let to = f.to ?? (f.pages != null ? from + f.pages : from + Math.max(1, Math.round(minutes * pace)));
  if (b.pages) to = Math.min(Number(b.pages), to);
  to = Math.max(from, to);
  const date = f.date ?? istDateOf();
  const s = putDoc(db, "mind_sessions", { id: newId("ses"), kind: "reading", date, at: new Date().toISOString(), book: b.id, minutes, from_page: from, to_page: to, source: f.source ?? "cli", note: f.note ?? null });
  const done = b.pages && to >= Number(b.pages);
  const book = putDoc(db, "mind_books", { id: b.id, page: to, status: done ? "done" : "reading", started: b.started ?? date, finished: done ? date : b.finished ?? null, last: date });
  return { session: s, book };
}
export function readingPace(db: Database, bookId?: string) {
  const rows = listDocs(db, "mind_sessions", `kind = 'reading'${bookId ? " AND book = ?" : ""}`, ...(bookId ? [bookId] : []));
  const p = rows.reduce((s, r) => s + Math.max(0, (Number(r.to_page) || 0) - (Number(r.from_page) || 0)), 0), m = rows.reduce((s, r) => s + (Number(r.minutes) || 0), 0);
  return m >= 10 && p > 0 ? p / m : 0.6;   // pages a minute; 0.6 until there is enough to go on
}

// ── courses: his Skool classroom, imported read-only from the old Agentic OS ──────────────────
const clean = (s: string) => String(s ?? "").replace(/^\s*\d+[.)]\s*/, "").replace(/^[^\p{L}\p{N}$]+/u, "").replace(/\s+/g, " ").trim();
const slug = (s: string) => clean(s).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "course";
const LIBRARY = new Set(["Vault", "Call Recordings"]);   // big collections of recordings, not courses to finish
export const DEFAULT_DATA = process.env.AGENTOS_OPERATOR_DATA || join(homedir(), "agentic-os", ".operator-data");
export function importCourses(db: Database, { dir = DEFAULT_DATA, folders = false } = {}) {
  const file = join(dir, "learn-ai.json");
  if (!existsSync(file)) throw new Error(`No learn-ai.json in ${dir}`);
  const src = JSON.parse(readFileSync(file, "utf8"));
  const lessons: any[] = Array.isArray(src.lessons) ? src.lessons : [];
  const groups = new Map<string, { title: string; part: string; lessons: any[]; library: boolean }>();
  for (const l of lessons) {
    const course = String(l.course ?? "Skool").trim(), mod = clean(l.module ?? "");
    // the module is the course ("30 Day Roadmap"); a short module inside a named course keeps the course's name
    const title = !mod || /^start here$/i.test(mod) || course.toLowerCase().includes(mod.toLowerCase()) ? course : mod.length <= 12 ? `${course}: ${mod}` : mod;
    const key = slug(`${course} ${title === course ? "" : title}`);
    const g = groups.get(key) ?? { title, part: course, lessons: [], library: LIBRARY.has(course) };
    g.lessons.push(l); groups.set(key, g);
  }
  // one course at a time: the one holding the top-ranked lesson is in progress, the rest are parked
  const ranked = lessons.filter((l) => Number(l.rank) > 0).sort((a, b) => a.rank - b.rank);
  const firstKey = ranked.length ? [...groups].find(([, g]) => g.lessons.includes(ranked[0]))?.[0] : null;
  let pos = 0, nc = 0, nl = 0;
  db.transaction(() => {
    for (const [key, g] of groups) {
      const id = `c.${key}`;
      const cur = getDoc(db, "mind_courses", id);
      const sel = g.lessons.filter((l) => Number(l.rank) > 0);
      putDoc(db, "mind_courses", {
        id, title: g.title, from: `Skool · ${g.part}`, part: g.part, source: "skool", kind: g.library ? "library" : "course", position: pos++,
        status: cur?.status ?? (key === firstKey ? "active" : "parked"), lessons_n: g.lessons.length,
        practice: sel.find((l) => l.practice)?.practice ?? cur?.practice ?? null,
        rank: sel.length ? Math.min(...sel.map((l) => Number(l.rank))) : null,
      });
      nc++;
      g.lessons.forEach((l, i) => {
        const lid = `l.${l.id}`;
        const was = getDoc(db, "mind_lessons", lid);
        const selected = Number(l.rank) > 0;
        putDoc(db, "mind_lessons", {
          id: lid, course: id, n: i, title: clean(l.title) || l.title, duration: l.duration || null, url: l.url || null,
          rank: selected ? Number(l.rank) : null, why: selected ? (l.why || null) : null, watch: l.watch || null, practice: l.practice || null, done_when: l.done || null,
          status: was?.status ?? "todo", pos: was?.pos ?? 0,
        });
        nl++;
      });
    }
  })();
  // courses from an earlier import that no longer exist (renamed groups) go, softly
  const keepIds = new Set([...groups.keys()].map((k) => `c.${k}`));
  for (const c of listDocs(db, "mind_courses", "source = 'skool'")) if (!keepIds.has(c.id)) delDoc(db, "mind_courses", c.id);
  let nf = 0;
  if (folders && existsSync(join(dir, "courses.json"))) {
    const fc = JSON.parse(readFileSync(join(dir, "courses.json"), "utf8")).courses ?? [];
    db.transaction(() => {
      for (const c of fc) {
        const id = `c.folder-${slug(c.id ?? c.name)}`;
        const cur = getDoc(db, "mind_courses", id);
        putDoc(db, "mind_courses", { id, title: c.name, from: "Folder on your PC", part: "Folder", source: "folder", kind: "course", position: pos++, status: cur?.status ?? "parked", path: c.path });
        Object.entries(c.progress ?? {}).forEach(([name, p]: [string, any], i) => {
          putDoc(db, "mind_lessons", { id: `l.f${slug(c.id)}-${i}`, course: id, n: i, title: name.replace(/\.\w+$/, ""), duration: null, status: getDoc(db, "mind_lessons", `l.f${slug(c.id)}-${i}`)?.status ?? "todo", pos: Math.round(p?.t ?? 0) });
          nf++;
        });
      }
    })();
  }
  return { courses: nc, lessons: nl, folderLessons: nf, active: firstKey ? `c.${firstKey}` : null, source: file, importedAt: src.importedAt ?? null };
}
export function findCourse(db: Database, word: string) {
  const w = word.trim().toLowerCase();
  const all = listDocs(db, "mind_courses");
  return all.find((c) => c.id === word || c.id === `c.${w}`) ?? all.find((c) => String(c.title).toLowerCase() === w) ?? all.find((c) => String(c.title).toLowerCase().includes(w)) ?? null;
}
export function setCourse(db: Database, word: string, status: "active" | "parked" | "done") {
  const c = findCourse(db, word);
  if (!c) throw new Error(`No course "${word}". See: agentos mind courses`);
  return putDoc(db, "mind_courses", { id: c.id, status, status_at: new Date().toISOString() });
}
/** Mark a lesson watched (and log the minutes as learning). */
export function lessonDone(db: Database, id: string, { minutes, source = "cli", date }: { minutes?: number; source?: string; date?: string } = {}) {
  const l = getDoc(db, "mind_lessons", id) ?? getDoc(db, "mind_lessons", `l.${id}`);
  if (!l) throw new Error(`No lesson ${id}.`);
  const sec = durSec(l.duration);
  const m = minutes ?? Math.max(1, Math.round((sec - (Number(l.pos) || 0)) / 60) || 10);
  const lesson = putDoc(db, "mind_lessons", { id: l.id, status: "done", done_at: new Date().toISOString(), pos: 0 });
  const session = putDoc(db, "mind_sessions", { id: newId("ses"), kind: "lesson", date: date ?? istDateOf(), at: new Date().toISOString(), course: l.course, lesson: l.id, minutes: m, title: l.title, source });
  return { lesson, session };
}
export const durSec = (d: any) => { const p = String(d ?? "").split(":").map(Number); if (p.some((x) => !Number.isFinite(x)) || !p.length || !d) return 0; return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + (p[1] ?? 0); };
export function courseView(db: Database, c: any) {
  const ls = listDocs(db, "mind_lessons", "course = ?", c.id).sort((a, b) => a.n - b.n);
  const done = ls.filter((l) => l.status === "done").length;
  const next = ls.find((l) => l.status !== "done") ?? null;
  return { id: c.id, title: c.title, status: c.status, kind: c.kind, lessons: ls.length, done, next: next ? { id: next.id, title: next.title, duration: next.duration, pos: next.pos ?? 0 } : null };
}

// ── the day for the CLI and the agent ─────────────────────────────────────────
export function daySummary(db: Database, date: string) {
  const apps = dayApps(db, date);
  const ci = getDoc(db, "mind_checkins", checkinId(date));
  const ses = listDocs(db, "mind_sessions", "date = ?", date);
  const total = apps.reduce((s, a) => s + a.minutes, 0);
  const done = new Set(listDocs(db, "mind_checkins").filter(answered).map((d) => d.date));
  return {
    date, screen: { minutes: total, text: fmt(total), apps: apps.slice(0, 8).map((a) => ({ app: a.id, name: a.name, minutes: a.minutes, kind: a.kind, source: a.source })) },
    kinds: kindsOf(apps, answered(ci) ? ci.answers : null),
    checkin: { answered: answered(ci), at: ci?.at ?? null, by: ci?.source ?? null, blocks: blocksFor(apps, ci).map((b) => ({ app: b.app, minutes: b.min, guess: b.guess, why: b.why })), streak: streak(done, date) },
    reading: { minutes: Math.round(ses.filter((s) => s.kind === "reading").reduce((s, r) => s + Number(r.minutes || 0), 0)), books: listDocs(db, "mind_books", "status = 'reading'").map((b) => ({ id: b.id, title: b.title, page: b.page, pages: b.pages })) },
    learning: { minutes: Math.round(ses.filter((s) => s.kind !== "reading").reduce((s, r) => s + Number(r.minutes || 0), 0)), active: listDocs(db, "mind_courses", "status = 'active'").map((c) => courseView(db, c)) },
  };
}
/** File the check-in (from the app, or by the agent from what he said). answers: { app: [[label, minutes], …] } */
export function fileCheckin(db: Database, date: string, answers: Record<string, [string, number][]>, { source = "agent", note }: { source?: string; note?: string } = {}) {
  const apps = dayApps(db, date);
  const cur = getDoc(db, "mind_checkins", checkinId(date));
  const before = kindsOf(apps, null);
  const clean: Record<string, [string, number][]> = {};
  for (const [app, list] of Object.entries(answers ?? {})) {
    const a = apps.find((x) => x.id === app) ?? { ...appInfo(app), minutes: 0 } as any;
    const ok = (list ?? []).filter(([l, m]) => typeof l === "string" && Number(m) > 0 && (LABELS[a.cat as Cat] ?? LABELS.other).some((x) => x.id === l)).map(([l, m]) => [l, Math.round(Number(m))] as [string, number]);
    if (ok.length) clean[app] = ok;
  }
  return putDoc(db, "mind_checkins", { id: checkinId(date), date, answers: { ...(cur?.answers ?? {}), ...clean }, at: new Date().toISOString(), source, before: cur?.before ?? before, note: note ?? cur?.note ?? null });
}

// ── the CLI ─────────────────────────────────────────────────────────────────
export const mind: Module = {
  name: "mind",
  help: `agentos mind [--date d]         Mind: screen time by app and kind, reading, learning, tonight's check-in
agentos mind rollup [--date d]  roll the PC's ribbon samples into per-app, per-hour screen time
agentos mind import-courses [--from <dir>] [--folders]   import the Skool lessons (read only) as courses
agentos mind books | book add "<title>" [--author a --pages n --isbn x] | read "<book>" --minutes n [--pages n | --to p]
agentos mind courses | park <course> | unpark <course> | lesson done <lesson-id> [--minutes n]`,
  migrate,
  run(db, a, ctx) {
    const sub = a._[1], date = ctx.str(a, "date") ?? ctx.istDate();
    const num = (k: string) => { const v = ctx.str(a, k); if (v == null) return undefined; const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new ctx.UserError(`--${k} takes a number.`); return n; };
    try {
      if (!sub) return ctx.out(daySummary(db, date), ["agentos mind rollup", "agentos mind books", "agentos mind courses"]);
      if (sub === "rollup") return ctx.out(rollup(db, date));
      if (sub === "import-courses") return ctx.out(importCourses(db, { dir: ctx.str(a, "from") ?? DEFAULT_DATA, folders: !!a.flags.folders }), ["agentos mind courses"]);
      if (sub === "books") return ctx.out({ books: listDocs(db, "mind_books").map((b) => ({ id: b.id, title: b.title, author: b.author, status: b.status, page: b.page, pages: b.pages })) }, ['agentos mind book add "<title>"']);
      if (sub === "book" && a._[2] === "add") {
        const title = a._.slice(3).join(" ");
        if (!title) throw new ctx.UserError('Give a title: agentos mind book add "Atomic Habits" --author "James Clear" --pages 320');
        return ctx.out(addBook(db, { title, author: ctx.str(a, "author"), pages: num("pages"), isbn: ctx.str(a, "isbn"), status: ctx.str(a, "status") ?? "next" }));
      }
      if (sub === "read") {
        const b = a._.slice(2).join(" ");
        if (!b) throw new ctx.UserError('Give the book: agentos mind read "Atomic Habits" --minutes 30');
        return ctx.out(logReading(db, { book: b, minutes: num("minutes"), pages: num("pages"), to: num("to"), date, source: "cli" }));
      }
      if (sub === "courses") return ctx.out({ courses: listDocs(db, "mind_courses").sort((x, y) => x.position - y.position).map((c) => courseView(db, c)) }, ["agentos mind park <course>", "agentos mind unpark <course>"]);
      if (sub === "park" || sub === "unpark") {
        const w = a._.slice(2).join(" ");
        if (!w) throw new ctx.UserError(`Give the course: agentos mind ${sub} "30 Day Roadmap"`);
        return ctx.out({ ok: true, course: setCourse(db, w, sub === "park" ? "parked" : "active") });
      }
      if (sub === "lesson" && a._[2] === "done") return ctx.out({ ok: true, ...lessonDone(db, String(a._[3] ?? ""), { minutes: num("minutes"), date }) });
    } catch (e: any) {
      if (e instanceof ctx.UserError) throw e;
      throw new ctx.UserError(e?.message ?? String(e));
    }
    throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos mind [rollup|import-courses|books|book add|read|courses|park|unpark|lesson done]`);
  },
};

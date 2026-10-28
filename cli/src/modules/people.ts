// People (v2): the one backend for Family, Friends and Romance. Persons, the moments spent with them (who logged each:
// him, the agent from what he said, a shared chat, the calendar), plans, ideas (gifts, plans beyond food, small things
// to do for them), rhythms (how often he wants to see someone, and whether that is warm or due), important dates (never
// guessed: "add date" until he or his calendar says), the private romance journal, the agent's message drafts, and a
// small key/value state (Romance's prefs and weekly step, Family's together session).
// Every table is a collection in the phone store's shape (server/modules/_collection.ts): upsert by id, rev counter,
// soft delete. This file owns the schema and the shared logic; server/modules/people.ts imports it.
//
//   agentos people                                   everyone, with how warm each one is
//   agentos people show <who>                        one person: rhythms, dates, recent moments
//   agentos people add "<name>" --rel family|friend|partner [--role ".."] [--pronoun he|she|they]
//   agentos people log <who> "<what happened>" [--kind meet|call|chat] [--act meal] [--minutes 30] [--date] [--at] [--by wyn --source said]
//   agentos people moments [<who>] [--limit 20]
//   agentos people rhythm <who> --every <days> [--mode meet|talk|any] [--title ".."]
//   agentos people date <who> <birthday|anniversary|other> <YYYY-MM-DD|MM-DD> [--title ".."]
//   agentos people plan <who> "<title>" [--date YYYY-MM-DD] · idea <who> "<title>" --kind gift|plan|showup
//   agentos people journal "<text>" [--feel calm]    the private romance journal (never listed elsewhere)
//   agentos people forget <moment id> · seed (the owner's four example people, once)
import type { Database } from "bun:sqlite";
import type { Args, ModCtx, Module } from "./types";

// ── the collections ──────────────────────────────────────────────────────────────────────────────────────────────
type ColType = "text" | "real" | "integer" | "json" | "bool";
export const PEOPLE_COLLECTIONS = {
  persons: { table: "people_persons", columns: { name: "text", rel: "text", aspect: "text", sort: "real" } },
  moments: { table: "people_moments", columns: { date: "text", at: "text", aspect: "text", kind: "text", act: "text", minutes: "integer", by: "text", source: "text", people: "json", event_id: "text" } },
  plans: { table: "people_plans", columns: { date: "text", aspect: "text", state: "text", people: "json" } },
  ideas: { table: "people_ideas", columns: { kind: "text", aspect: "text", person: "text", done: "bool" } },
  rhythms: { table: "people_rhythms", columns: { person: "text", every: "integer", mode: "text", sort: "real" } },
  dates: { table: "people_dates", columns: { kind: "text", md: "text", date: "text", people: "json", source: "text" } },
  journal: { table: "people_journal", columns: { date: "text", kind: "text", by: "text", feel: "text" } },
  drafts: { table: "people_drafts", columns: { person: "text", state: "text", kind: "text" } },
  state: { table: "people_state", columns: {} },
} as const satisfies Record<string, { table: string; columns: Record<string, ColType> }>;
export type PeopleKind = keyof typeof PEOPLE_COLLECTIONS;
const SQL: Record<ColType, string> = { text: "TEXT", real: "REAL", integer: "INTEGER", json: "TEXT", bool: "INTEGER" };
const COLL = `id TEXT PRIMARY KEY, data TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted_at TEXT, rev INTEGER NOT NULL DEFAULT 0`;

export const ASPECTS = ["family", "friends", "romance"] as const;
export const REL_ASPECT: Record<string, string> = { family: "family", friend: "friends", new: "friends", partner: "romance" };
export const KINDS = ["meet", "call", "chat"] as const;               // how: in person, a call, a chat
export const ACTS = ["meal", "talk", "shop", "help", "outing", "food", "gym", "drive", "film", "chai", "walk"] as const;   // what
export const SOURCES = ["you", "said", "chat", "share", "calendar", "session", "voice", "call", "contacts"] as const;
export const MODES = ["meet", "talk", "any"] as const;               // what counts toward a rhythm
export const DATE_KINDS = ["birthday", "anniversary", "festival", "other"] as const;
export const IDEA_KINDS = ["gift", "plan", "showup"] as const;
export const PLAN_STATES = ["idea", "draft", "asked", "tentative", "sent", "confirmed", "done", "dropped"] as const;
/** Kinds of message the agent may send by herself to a person he allowed (DECISIONS 2); everything else he sends. */
export const MESSAGE_KINDS = ["late", "logistics", "thanks", "checkin"] as const;

export function migratePeople(db: Database) {
  for (const { table, columns } of Object.values(PEOPLE_COLLECTIONS)) {
    const cols = Object.entries(columns).map(([k, t]) => `, ${k} ${SQL[t as ColType]}`).join("");
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${COLL}${cols}); CREATE INDEX IF NOT EXISTS ${table}_rev ON ${table}(rev);`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS people_moments_date ON people_moments(date);
    CREATE INDEX IF NOT EXISTS people_moments_event ON people_moments(event_id);
    CREATE INDEX IF NOT EXISTS people_rhythms_person ON people_rhythms(person);`);
}

// ── docs (the same rules as the server's _collection.ts) ─────────────────────────────────────────────────────────
const META = new Set(["id", "created_at", "updated_at", "deleted_at", "rev", "data"]);
const nowIso = () => new Date().toISOString();
export const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
function toDoc(kind: PeopleKind, r: any) {
  if (!r) return null;
  const cols = PEOPLE_COLLECTIONS[kind].columns as Record<string, ColType>;
  let rest: Record<string, unknown> = {};
  try { rest = JSON.parse(r.data ?? "{}"); } catch {}
  const doc: Record<string, any> = { ...rest, id: r.id, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at ?? null };
  for (const [k, t] of Object.entries(cols)) {
    const v = r[k];
    if (v == null) { doc[k] = null; continue; }
    if (t === "json") { try { doc[k] = JSON.parse(v); } catch { doc[k] = null; } }
    else if (t === "bool") doc[k] = !!v;
    else doc[k] = v;
  }
  return doc;
}
export function getDoc(db: Database, kind: PeopleKind, id: string) {
  return toDoc(kind, db.query(`SELECT * FROM ${PEOPLE_COLLECTIONS[kind].table} WHERE id = ?`).get(id));
}
export function listDocs(db: Database, kind: PeopleKind, where = "", ...args: any[]): any[] {
  const T = PEOPLE_COLLECTIONS[kind].table;
  return (db.query(`SELECT * FROM ${T} WHERE deleted_at IS NULL ${where ? `AND ${where}` : ""} ORDER BY rev`).all(...args) as any[]).map((r) => toDoc(kind, r));
}
/** Upsert a doc the way the phone's store does; fields not given keep their stored value. */
export function putDoc(db: Database, kind: PeopleKind, input: Record<string, any>) {
  const { table: T, columns } = PEOPLE_COLLECTIONS[kind];
  const cols = columns as Record<string, ColType>;
  const cur = input.id ? getDoc(db, kind, input.id) : null;
  const now = nowIso();
  const doc = { ...(cur ?? {}), ...input, id: input.id ?? newId(kind.slice(0, 2)), created_at: cur?.created_at ?? input.created_at ?? now, updated_at: now, deleted_at: input.deleted_at ?? null };
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!META.has(k) && !(k in cols)) rest[k] = v;
  const row: Record<string, any> = { id: doc.id, data: JSON.stringify(rest), created_at: doc.created_at, updated_at: doc.updated_at, deleted_at: doc.deleted_at };
  for (const [k, t] of Object.entries(cols)) {
    const v = (doc as any)[k];
    row[k] = v == null ? null : t === "json" ? JSON.stringify(v) : t === "bool" ? (v ? 1 : 0) : t === "real" || t === "integer" ? Number(v) : String(v);
  }
  row.rev = (db.query(`SELECT coalesce(max(rev), 0) + 1 AS r FROM ${T}`).get() as any).r;
  const keys = Object.keys(row);
  db.query(`INSERT INTO ${T} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
    ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`).run(...Object.values(row));
  return getDoc(db, kind, doc.id)!;
}
export const dropDoc = (db: Database, kind: PeopleKind, id: string) => (getDoc(db, kind, id) ? putDoc(db, kind, { id, deleted_at: nowIso() }) : null);

// ── dates in India time ───────────────────────────────────────────────────────────────────────────────────────────────
export const istDay = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
export const istHm = (d = new Date()) => new Date(d.getTime() + 330 * 60000).toISOString().slice(11, 16);
export const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
export const mondayOf = (iso: string) => { const dow = new Date(`${iso}T00:00:00Z`).getUTCDay(); return addDays(iso, -((dow + 6) % 7)); };
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isMd = (s: unknown): s is string => typeof s === "string" && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s);
/** The next time an annual date comes round, on or after today. */
export function nextAnnual(md: string, today: string) {
  const y = Number(today.slice(0, 4));
  const a = `${y}-${md}`;
  return daysBetween(today, a) >= 0 ? a : `${y + 1}-${md}`;
}
/** When a date doc next happens (ISO), or null when it isn't known yet. */
export function nextOf(d: any, today: string): string | null {
  if (d?.annual && isMd(d.md)) return nextAnnual(d.md, today);
  if (isDay(d?.date)) return d.date;
  if (isMd(d?.md)) return nextAnnual(d.md, today);
  return null;
}

// ── four example people, once (a starting circle for the owner to edit; replace them with your own) ───────────────────────────────────────
// Rhythms are the prototype's defaults (DECISIONS: keep them until he changes them) and say so (source: default).
export const SEED = {
  persons: [
    { id: "dad", name: "Dad", rel: "family", aspect: "family", role: "Father · runs Morgan & Co.", short: "Father · the shop", pronoun: "he", file: "people/family/dad", aliases: ["dad", "father"], sort: 1 },
    { id: "mom", name: "Mom", rel: "family", aspect: "family", role: "Mother", short: "Mother", pronoun: "she", file: "people/family/mom", aliases: ["mom", "mother", "maa"], sort: 2 },
    { id: "kabir", name: "Kabir", rel: "friend", aspect: "friends", role: "Old friend", since: "Since school", pronoun: "he", file: "people/friends/kabir", aliases: ["kabir"], sort: 3 },
    { id: "rohan", name: "Rohan", rel: "friend", aspect: "friends", role: "Friend from college", since: "Since college", pronoun: "he", file: "people/friends/rohan", aliases: ["rohan"], sort: 4 },
  ],
  rhythms: [
    { id: "rh-dad-dinner", person: "dad", title: "Dinner together", label: "Most nights", every: 2, mode: "meet", act: "meal", dinner: true, source: "default", sort: 1 },
    { id: "rh-dad-shop", person: "dad", title: "Saturday at the shop", label: "Every week", every: 7, mode: "meet", act: "shop", source: "default", sort: 2 },
    { id: "rh-mom-dinner", person: "mom", title: "Dinner together", label: "Most nights", every: 2, mode: "meet", act: "meal", dinner: true, source: "default", sort: 1 },
    { id: "rh-mom-time", person: "mom", title: "Time with just her", label: "Every week", every: 7, mode: "meet", solo: true, source: "default", sort: 2 },
    { id: "rh-kabir", person: "kabir", title: "See him", label: "Every week, in person", every: 7, mode: "meet", source: "default", sort: 1 },
    { id: "rh-rohan", person: "rohan", title: "Stay in touch", label: "Every week, a chat or a call", every: 7, mode: "talk", source: "default", sort: 1 },
  ],
  // a public festival, not a guess about anyone
  dates: [{ id: "dt-diwali-2026", kind: "festival", title: "Diwali", date: "2026-11-08", md: "11-08", annual: false, people: ["dad", "mom"], aspect: "family", source: "festival" }],
};
/** Seed the four example people into the owner's db once. A db that already has people (or was seeded) is left alone. */
export function seedOwner(db: Database) {
  if (getDoc(db, "state", "seeded")) return { seeded: false, why: "already" };
  const have = listDocs(db, "persons").length;
  if (!have) {
    db.transaction(() => {
      for (const p of SEED.persons) putDoc(db, "persons", p);
      for (const r of SEED.rhythms) putDoc(db, "rhythms", r);
      for (const d of SEED.dates) putDoc(db, "dates", d);
    })();
  }
  putDoc(db, "state", { id: "seeded", at: nowIso(), people: have ? "kept" : SEED.persons.map((p) => p.id) });
  return { seeded: !have, why: have ? "had people" : "seeded" };
}

// ── finding people by what he calls them ─────────────────────────────────────────────────────────────────────────
export const slug = (s: string) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "person";
const escapeRe = (s: string) => s.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
const words = (p: any): string[] => [p.id, p.name, ...(p.aliases ?? [])].filter(Boolean).map((x: string) => String(x).toLowerCase());
/** One person by id, name or alias (case-insensitive). */
export function findPerson(db: Database, who: string) {
  const s = String(who ?? "").trim().toLowerCase();
  if (!s) return null;
  const all = listDocs(db, "persons");
  return all.find((p) => p.id === s) ?? all.find((p) => words(p).includes(s)) ?? null;
}
/** Every person named in a text ("I'm sitting with Mom and Dad"), by whole word. */
export function peopleIn(text: string, all: any[]) {
  const t = ` ${String(text ?? "").toLowerCase()} `;
  return all.filter((p) => words(p).some((w) => w.length > 1 && new RegExp(`[^a-z0-9]${escapeRe(w)}(?:['’]s)?[^a-z0-9]`).test(t)));
}
/** "dad,mom" · ["Kabir"] · "family" → person docs; unknown names come back in missing. */
export function resolvePeople(db: Database, who: unknown) {
  const all = listDocs(db, "persons");
  const list = (Array.isArray(who) ? who : String(who ?? "").split(/[,&]|\band\b/)).map((x) => String(x).trim()).filter(Boolean);
  const found: any[] = [], missing: string[] = [];
  for (const w of list) {
    const lw = w.toLowerCase();
    if (lw === "family" || lw === "friends") { found.push(...all.filter((p) => p.aspect === (lw === "family" ? "family" : "friends"))); continue; }
    const p = all.find((x) => x.id === lw) ?? all.find((x) => words(x).includes(lw));
    if (p) found.push(p); else missing.push(w);
  }
  return { people: [...new Map(found.map((p) => [p.id, p])).values()], missing };
}

// ── warmth: how a person stands against the rhythm he set (0 = just now, 1 = due today, 2 = twice over) ────────────
export function counts(m: any, r: any) {
  if (r?.mode === "meet" && m.kind !== "meet") return false;
  if (r?.act && m.act !== r.act && !(r.act === "meal" && m.dinner)) return false;
  if (r?.dinner && !m.dinner && m.act !== "meal") return false;
  if (r?.solo && (m.people?.length ?? 0) > 1) return false;
  return true;
}
export function warmthOf(r: any, moments: any[], person: string, today: string) {
  const mine = moments.filter((m) => !m.let_go && (m.people ?? []).includes(person) && m.date && m.date <= today && counts(m, r))
    .sort((a, b) => (b.date + (b.at ?? "")).localeCompare(a.date + (a.at ?? "")));
  const last = mine[0] ?? null;
  if (!last) return { band: "none" as const, days: null, x: null, last: null, every: r?.every ?? null, mode: r?.mode ?? "any" };
  const days = daysBetween(last.date, today);
  const x = r?.every ? days / r.every : 0;
  return { band: (x <= 1 ? "warm" : x <= 2 ? "due" : "drift") as "warm" | "due" | "drift", days, x, last: { id: last.id, date: last.date, title: last.title ?? null, kind: last.kind }, every: r?.every ?? null, mode: r?.mode ?? "any" };
}
/** Everyone, with their main rhythm's warmth and their next date. */
export function circle(db: Database, today = istDay()) {
  const persons = listDocs(db, "persons").sort((a, b) => (a.sort ?? 99) - (b.sort ?? 99) || String(a.name).localeCompare(String(b.name)));
  const moments = listDocs(db, "moments");
  const rhythms = listDocs(db, "rhythms");
  const dates = listDocs(db, "dates");
  return persons.map((p) => {
    const rs = rhythms.filter((r) => r.person === p.id).sort((a, b) => (a.sort ?? 9) - (b.sort ?? 9));
    const main = rs.find((r) => !r.dinner) ?? rs[0] ?? null;
    const w = warmthOf(main, moments, p.id, today);
    const next = dates.filter((d) => (d.people ?? []).includes(p.id)).map((d) => ({ title: d.title, kind: d.kind, on: nextOf(d, today) }))
      .filter((d) => d.on).sort((a, b) => String(a.on).localeCompare(String(b.on)))[0] ?? null;
    const unknownBirthday = !dates.some((d) => d.kind === "birthday" && (d.people ?? []).includes(p.id) && (d.md || d.date));
    return { id: p.id, name: p.name, rel: p.rel, aspect: p.aspect, role: p.role ?? null, rhythm: main ? { title: main.title, label: main.label, every: main.every, mode: main.mode } : null,
      warmth: w.band, days: w.days, last: w.last, next, birthday: unknownBirthday ? "not known yet" : "known", allow: p.allow ?? null };
  });
}

// ── writing what the app and the agent write (validated the same way on both sides) ──────────────────────────────
export function checkMoment(d: any): string | null {
  if (!Array.isArray(d.people) || !d.people.length) return "a moment needs people (a list of person ids)";
  if (!isDay(d.date)) return "date is YYYY-MM-DD";
  if (d.kind != null && !(KINDS as readonly string[]).includes(d.kind)) return `kind is one of ${KINDS.join(", ")}`;
  if (d.minutes != null && !(Number.isFinite(Number(d.minutes)) && Number(d.minutes) >= 0 && Number(d.minutes) <= 1440)) return "minutes is 0 to 1440";
  return null;
}
export function checkPerson(d: any): string | null {
  if (typeof d.name !== "string" || !d.name.trim()) return "a person needs a name";
  if (d.rel != null && !Object.keys(REL_ASPECT).includes(d.rel)) return `rel is one of ${Object.keys(REL_ASPECT).join(", ")}`;
  return null;
}
export function checkDate(d: any): string | null {
  if (d.kind != null && !(DATE_KINDS as readonly string[]).includes(d.kind)) return `kind is one of ${DATE_KINDS.join(", ")}`;
  if (d.date != null && !isDay(d.date)) return "date is YYYY-MM-DD";
  if (d.md != null && !isMd(d.md)) return "md is MM-DD";
  return null;
}
function inferKind(text: string) {
  const t = text.toLowerCase();
  if (/\b(call(ed)?|phone|rang)\b/.test(t)) return "call";
  if (/\b(chat(ted)?|text(ed)?|whats ?app|messag(e|ed)|dm|reels?)\b/.test(t)) return "chat";
  return "meet";
}
export function inferAct(text: string) {
  const t = String(text ?? "").toLowerCase();
  if (/\b(dinner|lunch|breakfast|khana|khaana|meal)\b/.test(t)) return "meal";
  if (/\b(shop|counter|dukaan)\b/.test(t)) return "shop";
  if (/\b(gym|work(ed)? ?out|trained|lift)/.test(t)) return "gym";
  if (/\b(drive|drove|murthal|ride)\b/.test(t)) return "drive";
  if (/\b(film|movie|cinema|pvr)\b/.test(t)) return "film";
  if (/\b(chai|coffee|tea)\b/.test(t)) return "chai";
  if (/\b(walk(ed)?|stroll)\b/.test(t)) return "walk";
  if (/\b(momos?|food|ate|pizza|rolls?|biryani|chole|parathas?|cafe|burger)\b/.test(t)) return "food";
  if (/\b(help(ed)?|set up|fixed|errand|print)\b/.test(t)) return "help";
  return null;
}
/** A moment from a sentence ("I'm sitting with family", "back from momos with Kabir"); the agent and the CLI use it. */
export function momentFrom(db: Database, o: { who?: unknown; text?: string; said?: string; kind?: string; act?: string; minutes?: number; date?: string; at?: string; by?: string; source?: string; title?: string; dinner?: boolean; chat?: any; aspect?: string; loop?: string }) {
  const all = listDocs(db, "persons");
  const text = String(o.text ?? o.said ?? "").trim();
  const named = o.who != null && o.who !== "" ? resolvePeople(db, o.who) : { people: peopleIn(text, all), missing: [] as string[] };
  if (!named.people.length && /\bfamily\b/i.test(text)) named.people = all.filter((p) => p.aspect === "family");
  if (!named.people.length) return { error: named.missing.length ? `Not in his people yet: ${named.missing.join(", ")}. Adding someone asks him first.` : "Who was it with? Name a person." } as const;
  const kind = o.kind ?? inferKind(text);
  const act = o.act ?? inferAct(text) ?? (kind === "meet" && named.people.every((p) => p.aspect === "family") ? "talk" : null);
  const aspect = o.aspect ?? (named.people.every((p) => p.aspect === named.people[0].aspect) ? named.people[0].aspect : "friends");
  const names = named.people.map((p) => p.name);
  const nm = names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const title = o.title ?? (text && text.length <= 80 ? text.replace(/^i'?m\s+/i, "").replace(/^\w/, (c) => c.toUpperCase()) : `${kind === "call" ? "A call" : kind === "chat" ? "A chat" : "Time"} with ${nm}`);
  const doc = {
    id: newId("mo"), date: o.date ?? istDay(), at: o.at ?? istHm(), people: named.people.map((p) => p.id), aspect, kind, act,
    minutes: o.minutes ?? 0, title, text: o.text && o.title ? o.text : undefined, said: o.said ?? undefined, chat: o.chat ?? undefined, loop: o.loop ?? undefined,
    dinner: o.dinner ?? (act === "meal" && /\bdinner\b/i.test(text) ? true : undefined), by: o.by ?? "you", source: o.source ?? (o.by === "wyn" ? "said" : "you"),
  };
  const bad = checkMoment(doc);
  if (bad) return { error: bad } as const;
  return { doc, missing: named.missing } as const;
}

// ── the CLI ──────────────────────────────────────────────────────────────────────────────────────────────────────
const flag = (a: Args, k: string) => (typeof a.flags[k] === "string" ? String(a.flags[k]) : undefined);
function need(db: Database, who: string | undefined, ctx: ModCtx) {
  const p = who ? findPerson(db, who) : null;
  if (!p) throw new ctx.UserError(who ? `No person "${who}". People: ${listDocs(db, "persons").map((x) => x.id).join(", ") || "none yet (agentos people add)"}` : "Who? agentos people show <id or name>");
  return p;
}
const brief = (m: any) => ({ id: m.id, date: m.date, at: m.at, people: m.people, kind: m.kind, act: m.act, minutes: m.minutes, title: m.title, by: m.by, source: m.source });

export const people: Module = {
  name: "people",
  help: `agentos people [show <who>]          People (v2): persons, moments, rhythms, dates for Family, Friends and Romance
agentos people add "<name>" --rel family|friend|partner · log <who> "<what>" [--kind meet|call|chat --minutes N --by wyn]
agentos people moments [<who>] · rhythm <who> --every <days> [--mode meet|talk|any] · date <who> <kind> <YYYY-MM-DD|MM-DD>
agentos people plan|idea <who> "<title>" · journal "<private note>" [--feel calm] · forget <moment id> · seed`,
  migrate(db) { migratePeople(db); },
  run(db, a, ctx) {
    const sub = a._[1];
    const today = ctx.istDate();
    if (!sub) {
      const c = circle(db, today);
      return ctx.out({ count: c.length, people: c.map((p) => (ctx.jsonOut ? p : { id: p.id, name: p.name, aspect: p.aspect, warmth: p.warmth, days: p.days ?? "never logged", rhythm: p.rhythm?.label ?? "none" })) },
        c.length ? ["agentos people show <who>", "agentos people log <who> \"<what happened>\""] : ["agentos people add \"<name>\" --rel family|friend"]);
    }
    if (sub === "seed") return ctx.out(seedOwner(db), ["agentos people"]);
    if (sub === "show") {
      const p = need(db, a._[2], ctx);
      const moments = listDocs(db, "moments").filter((m) => (m.people ?? []).includes(p.id)).sort((x, y) => (y.date + y.at).localeCompare(x.date + x.at));
      const rhythms = listDocs(db, "rhythms").filter((r) => r.person === p.id).map((r) => ({ ...r, ...warmthOf(r, moments, p.id, today) }));
      const dates = listDocs(db, "dates").filter((d) => (d.people ?? []).includes(p.id)).map((d) => ({ id: d.id, kind: d.kind, title: d.title, next: nextOf(d, today), source: d.source }));
      return ctx.out({ person: p, rhythms, dates, moments: moments.slice(0, 10).map(brief) }, [`agentos people log ${p.id} "<what happened>"`]);
    }
    if (sub === "add") {
      const name = String(a._[2] ?? "").trim();
      const rel = flag(a, "rel") ?? "friend";
      const bad = checkPerson({ name, rel });
      if (bad) throw new ctx.UserError(`${bad}: agentos people add "Zoe" --rel friend`);
      let id = slug(name); for (let i = 2; getDoc(db, "persons", id); i++) id = `${slug(name)}-${i}`;
      const p = putDoc(db, "persons", { id, name, rel, aspect: REL_ASPECT[rel], role: flag(a, "role") ?? null, pronoun: flag(a, "pronoun") ?? null,
        file: `people/${REL_ASPECT[rel]}/${id}`, sort: 50 + listDocs(db, "persons").length, added: today, where: flag(a, "where") ?? null });
      return ctx.out({ ok: true, person: p }, [`agentos people rhythm ${id} --every 7`]);
    }
    if (sub === "log") {
      const r = momentFrom(db, { who: a._[2], text: a._[3], kind: flag(a, "kind"), act: flag(a, "act"), minutes: flag(a, "minutes") ? Number(flag(a, "minutes")) : undefined,
        date: flag(a, "date"), at: flag(a, "at"), by: flag(a, "by"), source: flag(a, "source"), said: flag(a, "said") });
      if ("error" in r) throw new ctx.UserError(r.error as string);
      return ctx.out({ ok: true, moment: brief(putDoc(db, "moments", r.doc)) }, ["agentos people moments"]);
    }
    if (sub === "moments") {
      const p = a._[2] ? need(db, a._[2], ctx) : null;
      const lim = Math.max(1, Math.min(200, Number(flag(a, "limit") ?? 20)));
      const list = listDocs(db, "moments").filter((m) => !p || (m.people ?? []).includes(p.id)).sort((x, y) => (y.date + y.at).localeCompare(x.date + x.at));
      return ctx.out({ count: list.length, moments: list.slice(0, lim).map(brief) });
    }
    if (sub === "forget") {
      const id = String(a._[2] ?? "");
      if (!getDoc(db, "moments", id)) throw new ctx.UserError(`No moment ${id || "(give an id)"}`);
      dropDoc(db, "moments", id);
      return ctx.out({ ok: true, forgotten: id });
    }
    if (sub === "rhythm") {
      const p = need(db, a._[2], ctx);
      const every = Number(flag(a, "every"));
      const mode = flag(a, "mode") ?? "any";
      if (!(Number.isInteger(every) && every >= 1 && every <= 365)) throw new ctx.UserError("--every is days, 1 to 365: agentos people rhythm kabir --every 7 --mode meet");
      if (!(MODES as readonly string[]).includes(mode)) throw new ctx.UserError(`--mode is one of ${MODES.join(", ")}`);
      const cur = listDocs(db, "rhythms").filter((r) => r.person === p.id).sort((x, y) => (x.sort ?? 9) - (y.sort ?? 9)).find((r) => !r.dinner);
      const label = every === 7 ? "Every week" : every === 14 ? "Every two weeks" : every === 30 ? "Every month" : `Every ${every} days`;
      const r = putDoc(db, "rhythms", { ...(cur ? { id: cur.id } : { id: `rh-${p.id}-${Date.now().toString(36)}`, sort: 1 }), person: p.id, every, mode, title: flag(a, "title") ?? cur?.title ?? `See ${p.name}`,
        label: `${label}${mode === "meet" ? ", in person" : mode === "talk" ? ", a chat or a call" : ""}`, source: "you" });
      return ctx.out({ ok: true, rhythm: r });
    }
    if (sub === "date") {
      const p = need(db, a._[2], ctx);
      const kind = String(a._[3] ?? "");
      const v = String(a._[4] ?? "");
      const full = /^\d{4}-\d{2}-\d{2}$/.test(v);
      const doc: any = { kind, people: [p.id], aspect: p.aspect, md: full ? v.slice(5) : v, date: full && kind === "other" ? v : null, year: full && kind !== "other" ? Number(v.slice(0, 4)) : null,
        annual: kind !== "other", title: flag(a, "title") ?? (kind === "birthday" ? `${p.name}'s birthday` : kind === "anniversary" ? "Anniversary" : "A date"), source: "you" };
      const bad = checkDate(doc) ?? (isMd(doc.md) ? null : "the date is YYYY-MM-DD or MM-DD");
      if (bad) throw new ctx.UserError(`${bad}: agentos people date dad birthday 12-06`);
      const same = listDocs(db, "dates").find((d) => d.kind === kind && kind !== "other" && (d.people ?? []).length === 1 && d.people[0] === p.id);
      return ctx.out({ ok: true, date: putDoc(db, "dates", { ...(same ? { id: same.id } : { id: newId("dt") }), ...doc }) });
    }
    if (sub === "plan" || sub === "idea") {
      const p = need(db, a._[2], ctx);
      const title = String(a._[3] ?? "").trim();
      if (!title) throw new ctx.UserError(`What? agentos people ${sub} ${p.id} "<title>"`);
      if (sub === "plan") {
        const date = flag(a, "date") ?? null;
        if (date && !isDay(date)) throw new ctx.UserError("--date is YYYY-MM-DD");
        return ctx.out({ ok: true, plan: putDoc(db, "plans", { id: newId("pl"), people: [p.id], aspect: p.aspect, title, date, state: flag(a, "state") ?? "tentative", by: "you" }) });
      }
      const kind = flag(a, "kind") ?? "plan";
      if (!(IDEA_KINDS as readonly string[]).includes(kind)) throw new ctx.UserError(`--kind is one of ${IDEA_KINDS.join(", ")}`);
      return ctx.out({ ok: true, idea: putDoc(db, "ideas", { id: newId("id"), person: p.id, aspect: p.aspect, kind, title, done: false, by: "you" }) });
    }
    if (sub === "journal") {
      const text = String(a._[2] ?? "").trim();
      if (!text) throw new ctx.UserError("agentos people journal \"<what you feel>\" [--feel calm]");
      const j = putDoc(db, "journal", { id: newId("jn"), date: today, at: istHm(ctx.now()), kind: "note", by: "you", source: "you", feel: flag(a, "feel") ?? null, text });
      return ctx.out({ ok: true, id: j.id, private: true });
    }
    throw new ctx.UserError(`Unknown subcommand "${sub}". agentos help lists the people verbs.`);
  },
};

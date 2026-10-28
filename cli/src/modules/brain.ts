// Brain (v2): the app's own second brain. One table of items (notes, inbox captures, files, facts, moments, voice notes,
// scans), each filed by aspect (the nine folders), maybe about a person, with who filed it (you or the agent), where it
// came from, where it happened, and links to goals, tasks, projects, people, other items and brain-vault notes. Items not
// yet filed sit in the inbox with the agent's suggestion. Search runs by words, by meaning (vectors the phone server
// stores in brain_vectors from Ollama), by date ("today", "last week", "18 Oct") and by place ("at the shop").
// The brain vault (its folder is set in the server config) is never touched here: the phone server reads it through the `brain` CLI.
//
// brain_items follows the phone store contract (server/modules/_collection.ts): id, data, created_at, updated_at,
// deleted_at, rev, plus the columns in ITEM_COLUMNS. The server mounts it at /api/v1/mod/brain/items.
//   agentos brain                                  counts by folder, the inbox, what the agent filed today
//   agentos brain add "<text>" [--aspect a] [--person p] [--kind k] [--title t] [--by agent] [--source s] [--place p] [--inbox]
//   agentos brain list [--aspect a] [--person p] [--inbox] [--kind k] [--limit n]   ·   agentos brain show <id>
//   agentos brain search "<q>" [--when today|week|...] [--place p] [--aspect a]
//   agentos brain inbox · file <id> [--aspect a] [--person p] · move <id> --aspect a · pin <id> · rm <id>
//   agentos brain link <id> <kind:id> · unlink <id> <kind:id> · fact <person> "<key>" "<value>"
import type { Database } from "bun:sqlite";
import type { Args, ModCtx, Module } from "./types";

// ── the vocabulary ──────────────────────────────────────────────────────────
export const ASPECTS = ["body", "mind", "soul", "mission", "money", "growth", "family", "romance", "friends"] as const;
export type Aspect = (typeof ASPECTS)[number];
export const ASPECT_NAME: Record<Aspect, string> = { body: "Body", mind: "Mind", soul: "Soul", mission: "Mission", money: "Money", growth: "Growth", family: "Family", romance: "Romance", friends: "Friends" };
/** Folders that open behind Face ID and never show on Today, Life, search or the graph until unlocked. */
export const PRIVATE: readonly string[] = ["romance", "soul"];
export const KINDS = ["note", "inbox", "file", "fact", "moment", "voice", "scan", "link", "doc", "log", "highlight", "journal"] as const;
export const LINK_KINDS = ["goal", "task", "project", "person", "item", "vault", "area", "idea"] as const;
export const isAspect = (a: unknown): a is Aspect => typeof a === "string" && (ASPECTS as readonly string[]).includes(a);

/** The collection's own columns (the rest of a doc goes in `data`). The server passes this to mountCollection. */
export const ITEM_COLUMNS = {
  kind: "text", title: "text", text: "text", aspect: "text", sub: "text", person: "text", status: "text", author: "text",
  source: "text", place: "text", at: "text", pinned: "bool", links: "json", suggest: "json", filed_at: "text", filed_by: "text",
} as const;
export const ITEMS_DDL = `CREATE TABLE IF NOT EXISTS brain_items (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  rev INTEGER NOT NULL DEFAULT 0,
  kind TEXT, title TEXT, text TEXT, aspect TEXT, sub TEXT, person TEXT, status TEXT, author TEXT,
  source TEXT, place TEXT, at TEXT, pinned INTEGER, links TEXT, suggest TEXT, filed_at TEXT, filed_by TEXT
);
CREATE INDEX IF NOT EXISTS brain_items_rev ON brain_items(rev);
CREATE INDEX IF NOT EXISTS brain_items_aspect ON brain_items(aspect, status);
CREATE INDEX IF NOT EXISTS brain_items_person ON brain_items(person);`;
// vectors for search by meaning, one per item, made by the phone server from Ollama (nomic-embed-text); hash = what was embedded
export const VECTORS_DDL = `CREATE TABLE IF NOT EXISTS brain_vectors (
  id TEXT PRIMARY KEY, model TEXT NOT NULL, hash TEXT NOT NULL, dim INTEGER NOT NULL, vec BLOB NOT NULL, updated_at TEXT NOT NULL
);`;

export type Link = { kind: string; id: string; label?: string };
export type Item = {
  id: string; created_at: string; updated_at: string; deleted_at: string | null;
  kind: string; title: string; text: string; aspect: string | null; sub: string | null; person: string | null;
  status: "filed" | "inbox"; author: string; source: string | null; place: string | null; at: string;
  pinned: boolean; links: Link[]; suggest: Suggestion | null; filed_at: string | null; filed_by: string | null;
  [k: string]: unknown;
};
export type Person = { id: string; name: string; aspect?: string | null; aliases?: string[] };
export type Suggestion = { to: { aspect: string; person?: string | null; label: string; score: number }[]; confidence: number; why: string };

// ── time, in IST like the rest of agentos ───────────────────────────────────
const IST = 330 * 60000;
export const istDay = (ms: number) => new Date(ms + IST).toISOString().slice(0, 10);
const dayStartMs = (iso: string) => Date.parse(`${iso}T00:00:00+05:30`);
const addDays = (iso: string, n: number) => istDay(dayStartMs(iso) + n * 864e5 + 3600e3);
export const itemMs = (it: Pick<Item, "at" | "created_at">) => { const t = Date.parse(String(it.at ?? "")); return Number.isFinite(t) ? t : Date.parse(String(it.created_at ?? "")) || 0; };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
export type When = { key: string; label: string; from: string; to: string };
const range = (key: string, label: string, fromIso: string, toIsoExcl: string): When => ({ key, label, from: new Date(dayStartMs(fromIso)).toISOString(), to: new Date(dayStartMs(toIsoExcl)).toISOString() });
const short = (iso: string) => { const d = new Date(dayStartMs(iso) + IST); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()].slice(0, 3).replace(/^./, (c) => c.toUpperCase())}`; };

/** A time window named in a query or a filter key: today, yesterday, week (this week), lastweek, month, lastmonth,
 *  a month name, a weekday (the latest one, today included), "18 oct" / "oct 18" / 2026-10-18, "last 3 days". */
export function parseWhen(q: string, nowMs: number): When | null {
  const s = ` ${String(q).toLowerCase().replace(/[?.,!]/g, " ")} `;
  const today = istDay(nowMs);
  const dow = new Date(dayStartMs(today) + IST).getUTCDay();          // 0 = Sunday
  const monday = addDays(today, -((dow + 6) % 7));
  const ym = today.slice(0, 7);
  const monthStart = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const nextMonth = (y: number, m: number) => (m === 11 ? monthStart(y + 1, 0) : monthStart(y, m + 1));
  if (/\b(today|aaj)\b/.test(s) || s.trim() === "today") return range("today", "Today", today, addDays(today, 1));
  if (/\b(yesterday|kal raat|kal)\b/.test(s)) { const y = addDays(today, -1); return range("yesterday", "Yesterday", y, today); }
  if (/\blast week\b|\blastweek\b/.test(s)) return range("lastweek", "Last week", addDays(monday, -7), monday);
  if (/\b(this week|week)\b/.test(s)) return range("week", "This week", monday, addDays(today, 1));
  if (/\blast month\b|\blastmonth\b/.test(s)) { const [y, m] = ym.split("-").map(Number); const py = m === 1 ? y - 1 : y, pm = m === 1 ? 11 : m - 2; return range("lastmonth", "Last month", monthStart(py, pm), monthStart(y, m - 1)); }
  if (/\b(this month|month)\b/.test(s)) return range("month", "This month", `${ym}-01`, addDays(today, 1));
  const lastN = /\blast (\d{1,3}) days?\b/.exec(s);
  if (lastN) { const n = Math.max(1, Number(lastN[1])); return range(`last${n}`, `Last ${n} days`, addDays(today, -(n - 1)), addDays(today, 1)); }
  const isoDay = /\b(20\d\d-\d\d-\d\d)\b/.exec(s);
  if (isoDay) return range(isoDay[1], short(isoDay[1]), isoDay[1], addDays(isoDay[1], 1));
  // "18 oct", "oct 18", "18th october"
  const mi = (w: string) => MONTHS.findIndex((m) => w.length >= 3 && m.startsWith(w));
  const dm = /\b(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})\b/.exec(s) ?? null;
  const md = /\b([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?\b/.exec(s) ?? null;
  for (const [d, w] of [dm ? [dm[1], dm[2]] : null, md ? [md[2], md[1]] : null].filter(Boolean) as string[][]) {
    const m = mi(w); const day = Number(d);
    if (m < 0 || day < 1 || day > 31) continue;
    let y = Number(today.slice(0, 4));
    let iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (iso > today) iso = `${y - 1}${iso.slice(4)}`;
    return range(iso, short(iso), iso, addDays(iso, 1));
  }
  for (const [i, name] of MONTHS.entries()) {
    // a month is a window when it's named as one ("in October", "from december", or the whole question); else it's a word
    const mre = `(${name}|${name.slice(0, 3)})`;
    if (!new RegExp(`\\b(in|during|from|since|of|this|last) ${mre}\\b`).test(s) && !new RegExp(`^\\s*${mre}\\s*$`).test(s)) continue;
    let y = Number(today.slice(0, 4));
    if (monthStart(y, i) > today) y -= 1;
    return range(`m${y}-${i + 1}`, name[0].toUpperCase() + name.slice(1), monthStart(y, i), nextMonth(y, i));
  }
  for (const [i, name] of WEEKDAYS.entries()) {
    // likewise a weekday: "on Monday", "last friday", "since tuesday", or the whole question
    const dre = `(${name}|${name.slice(0, 3)})`;
    if (!new RegExp(`\\b(on|last|this|since) ${dre}\\b`).test(s) && !new RegExp(`^\\s*${dre}\\s*$`).test(s)) continue;
    const back = (dow - i + 7) % 7 || (new RegExp(`\\blast ${name}`).test(s) ? 7 : 0);
    const d = addDays(today, -back);
    return range(d, back === 0 ? "Today" : name[0].toUpperCase() + name.slice(1), d, addDays(d, 1));
  }
  return null;
}
/** A filter key from the app's chips (today, week, month, lastweek, an ISO day) to a window. */
export const whenOf = (key: string | null | undefined, nowMs: number): When | null => {
  if (!key || key === "any") return null;
  if (key === "week") return parseWhen("this week", nowMs);
  if (key === "month") return parseWhen("this month", nowMs);
  return parseWhen(key, nowMs);
};

// ── places ──────────────────────────────────────────────────────────────────
// known places and the words that name them; items carry free text in `place`, matched by any of the words
export const PLACES: Record<string, { label: string; words: string[] }> = {
  shop: { label: "The shop", words: ["morgan & co.", "the shop", "shop", "dukaan", "dukan"] },
  home: { label: "Midtown", words: ["midtown", "home", "ghar"] },
  "college": { label: "City College", words: ["college", "campus", "lecture hall"] },
  gym: { label: "The gym", words: ["gym"] },
};
export function placeKey(place: string | null | undefined): string | null {
  const p = ` ${String(place ?? "").toLowerCase()} `;
  if (!p.trim()) return null;
  for (const [k, v] of Object.entries(PLACES)) if (v.words.some((w) => p.includes(w))) return k;
  return null;
}
export function parsePlace(q: string, extra: string[] = []): { key: string; label: string; words: string[] } | null {
  const s = ` ${String(q).toLowerCase()} `;
  for (const [k, v] of Object.entries(PLACES)) if (v.words.some((w) => new RegExp(`\\b(at|from|in|near) (the )?${w.trim()}\\b`).test(s) || (w.length > 4 && s.includes(` ${w.trim()} `)))) return { key: k, label: v.label, words: v.words };
  for (const x of extra) { const w = x.toLowerCase().trim(); if (w.length > 3 && new RegExp(`\\b(at|from|in) ${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(s)) return { key: w, label: x, words: [w] }; }
  return null;
}
export const placeMatches = (item: Pick<Item, "place">, place: { key: string; words: string[] }) => {
  const p = ` ${String(item.place ?? "").toLowerCase()} `;
  return placeKey(item.place) === place.key || place.words.some((w) => p.includes(w.trim()));
};

// ── where a thing belongs: the agent's suggestion ──────────────────────────
const LEX: Record<Aspect, string[]> = {
  body: ["protein", "gym", "workout", "bench", "squat", "deadlift", "cardio", "sleep", "slept", "meal", "breakfast", "lunch", "dinner", "khana", "diet", "calorie", "weight", "face", "skin", "aligner", "teeth", "steps", "water", "doctor", "health", "run ", "walk", "yoga", "injury"],
  mind: ["read", "book", "chapter", "class", "lecture", "course", "exam", "test ", "assignment", "tutorial", "college", "semester", "study", "syllabus", "screen time", "focus", "notes from", "highlight", "stats", "internal"],
  soul: ["habit", "urge", "streak", "blocker", "clean", "pray", "meditat", "gratitude", "values", "relapse", "mandir", "temple", "calm", "peace", "breath"],
  mission: ["client", "northwind", "atlas", "project", "pitch", "reel", "content", "build", "ship", "app ", "code", "agent", "launch", "startup", "company", "harborline", "pulsechat", "tapline", "deploy", "lead", "proposal", "meeting", "shoot", "instagram", "youtube", "hook"],
  money: ["₹", " rs", "rupee", "paid", "pay ", "spent", "spend", "budget", "upi", "gpay", "paytm", "phonepe", "invoice", "bill", "salary", "income", "payout", "emi", "loan", "khata", "price", "cost", "bought", "purchase", "expense", "refund", "bank", "statement", "gst", "subscription", "corner market", "store", "stock", "listing"],
  growth: ["journal", "reflect", "weekly review", "review", "plan for", "dream", "lesson", "learned", "mistake", "insight", "realised", "realized", "next time"],
  family: ["dad", "mom", "mother", "father", "family", "ghar", "bhai", "didi", "sister", "brother", "nani", "dadi", "nana", "dada", "uncle", "aunty", "cousin", "anniversary", "diwali", "morgan & co."],
  romance: ["date night", "girlfriend", "gf ", "crush", "partner", "romance", "valentine"],
  friends: ["friend", "dost", "yaar", "hangout", "party", "meetup", "met up", "bro ", "group chat", "birthday"],
};
const SUB_HINTS: Record<string, [RegExp, string][]> = {
  body: [[/protein|meal|breakfast|lunch|dinner|khana|diet|calorie/i, "Fuel"], [/gym|workout|bench|squat|cardio|sleep|steps|run/i, "Training"], [/face|skin|aligner|teeth/i, "Looks"]],
  mind: [[/college|class|lecture|exam|assignment|tutorial|semester/i, "City College"], [/book|read|chapter|highlight/i, "Library"], [/screen time|instagram/i, "Screen time"]],
  money: [[/receipt|paid|spent|upi|gpay|bill/i, "Receipts"], [/statement|bank/i, "Statements"], [/corner market|payout/i, "Corner Market"]],
  mission: [[/northwind|client|atlas|harborline|lead|proposal/i, "Northwind"], [/purpose|why i/i, "Purpose"], [/project|reel|app|build|ship/i, "Projects"]],
  growth: [[/journal|today i|felt/i, "Journal"], [/dream/i, "Dreams"]],
  family: [[/plan|book a|by sunday|anniversary/i, "Plans"], [/.*/, "Moments"]],
  friends: [[/plan|saturday|meet/i, "Plans"], [/.*/, "Moments"]],
  soul: [[/habit|streak|clean|urge/i, "Habits"]],
};
export const subFor = (aspect: string | null, text: string): string | null => {
  for (const [re, sub] of SUB_HINTS[aspect ?? ""] ?? []) if (re.test(text)) return sub;
  return null;
};
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** People named in a text: by name or alias, whole word. */
export function peopleIn(text: string, people: Person[]): Person[] {
  const s = ` ${String(text).toLowerCase()} `;
  return people.filter((p) => [p.name, p.id, ...(p.aliases ?? [])].filter((w) => w && String(w).length > 1).some((w) => new RegExp(`(^|[^a-z])${escRe(String(w).toLowerCase())}([^a-z]|$)`).test(s)));
}
/** Where the agent would file a text: aspects scored by words, people, the source app, and (when given) how close its
 *  meaning is to what he already filed in each folder (centroids: aspect → similarity 0-1). Highest first. */
export function suggestFor(it: { text?: string | null; title?: string | null; source?: string | null; aspect?: string | null; place?: string | null; meta?: unknown; from?: unknown },
  { people = [], sims = {} }: { people?: Person[]; sims?: Record<string, number> } = {}): Suggestion {
  const text = `${it.title ?? ""} ${it.text ?? ""} ${typeof it.meta === "string" ? it.meta : ""} ${typeof it.from === "string" ? it.from : ""}`;
  const s = ` ${text.toLowerCase()} `;
  const score: Record<string, number> = {};
  const why: Record<string, string[]> = {};
  const add = (a: string, n: number, w: string) => { score[a] = (score[a] ?? 0) + n; (why[a] ??= []).push(w); };
  for (const a of ASPECTS) for (const w of LEX[a]) if (s.includes(w)) add(a, w.length > 5 ? 1.4 : 1, w.trim());
  const who = peopleIn(text, people);
  for (const p of who) if (isAspect(p.aspect)) add(p.aspect, 3, p.name);
  if (isAspect(it.source)) add(it.source, 2.5, `from ${ASPECT_NAME[it.source]}`);
  const pk = placeKey(it.place);
  if (pk === "college") add("mind", 0.6, "at City College"); else if (pk === "gym") add("body", 0.8, "at the gym"); else if (pk === "shop") add("money", 0.4, "at the shop");
  for (const [a, v] of Object.entries(sims)) if (isAspect(a) && v > 0.5) add(a, (v - 0.5) * 8, "like what you filed there");
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((n, [, v]) => n + v, 0);
  const top = ranked.slice(0, 2).filter(([, v], i) => i === 0 || v >= ranked[0][1] * 0.6);
  const person = who[0] ?? null;
  const to = top.map(([a, v]) => {
    const p = person && person.aspect === a ? person : null;
    const sub = subFor(a, text);
    return { aspect: a, person: p?.id ?? null, label: p ? `People › ${p.name}` : `${ASPECT_NAME[a as Aspect]}${sub ? ` › ${sub}` : ""}`, score: Math.round(v * 10) / 10 };
  });
  const confidence = ranked.length ? Math.min(1, (ranked[0][1] / Math.max(total, 1)) * Math.min(1, ranked[0][1] / 3)) : 0;
  const w = ranked[0] ? (why[ranked[0][0]] ?? []).slice(0, 3).join(", ") : "";
  return { to, confidence: Math.round(confidence * 100) / 100, why: w ? `Mentions ${w}` : "Nothing in it points to one folder yet" };
}
/** Confident enough for the agent to file it on her own (DECISIONS 2: low-stakes, reversible; she says so after). */
export const confident = (s: Suggestion | null | undefined) => !!s && s.to.length > 0 && s.confidence >= 0.5 && s.to[0].score >= 2.5;

// ── items: normalise, validate, store ──────────────────────────────────────
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
export const titleOf = (text: string) => clip(String(text).replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, ""), 64) || "Untitled";
const asLinks = (v: unknown): Link[] => (Array.isArray(v) ? v : []).map((l: any) => (typeof l === "string" ? linkFrom(l) : l && typeof l === "object" ? { kind: String(l.kind ?? ""), id: String(l.id ?? ""), ...(l.label ? { label: String(l.label) } : {}) } : null)).filter((l): l is Link => !!l && !!l.kind && !!l.id);
/** "goal:g3", "task:12", "person:dad", "vault:entity/dad", "item:x1" → a link. */
export function linkFrom(s: string): Link | null {
  const m = /^([a-z]+):(.+)$/.exec(String(s).trim());
  if (!m || !(LINK_KINDS as readonly string[]).includes(m[1])) return null;
  return { kind: m[1], id: m[2] };
}
/** A full item from what a phone, a tool or the CLI sent: defaults filled, the inbox decided by whether it has a folder. */
export function normalizeItem(input: any, { now = new Date().toISOString(), people = [] as Person[] } = {}): Item {
  const text = String(input.text ?? input.title ?? "").slice(0, 20000);
  const aspect = isAspect(input.aspect) ? input.aspect : null;
  const person = input.person ? String(input.person) : null;
  const pAspect = person ? people.find((p) => p.id === person)?.aspect ?? null : null;
  const folder = aspect ?? (isAspect(pAspect) ? pAspect : null);
  const status = folder && input.status !== "inbox" ? "filed" : "inbox";
  const author = input.author === "agent" || input.by === "agent" || input.by === "wyn" ? "agent" : String(input.author ?? input.by ?? "you");
  const kind = (KINDS as readonly string[]).includes(input.kind) ? input.kind : person && status === "filed" ? "moment" : "note";
  const links = asLinks(input.links);
  if (person && !links.some((l) => l.kind === "person" && l.id === person)) links.push({ kind: "person", id: person });
  const it: Item = {
    ...input,
    id: String(input.id ?? ""), created_at: input.created_at ?? now, updated_at: input.updated_at ?? now, deleted_at: input.deleted_at ?? null,
    kind, title: input.title ? clip(String(input.title), 140) : titleOf(text), text, aspect: status === "filed" ? folder : aspect,
    sub: input.sub ?? (folder ? subFor(folder, text) : null), person, status, author,
    source: input.source ?? input.via ?? null, place: input.place ?? input.where ?? null, at: input.at && !Number.isNaN(Date.parse(input.at)) ? input.at : now,
    pinned: !!input.pinned, links, suggest: input.suggest ?? null,
    filed_at: status === "filed" ? input.filed_at ?? now : null, filed_by: status === "filed" ? input.filed_by ?? (author === "agent" ? "agent" : "you") : null,
  };
  delete (it as any).by; delete (it as any).via; delete (it as any).where;
  return it;
}
export function validateItem(d: any): string | null {
  if (typeof d !== "object" || !d) return "Send the item as an object.";
  if (d.aspect != null && !isAspect(d.aspect)) return `aspect is one of ${ASPECTS.join(", ")}`;
  if (d.status != null && !["filed", "inbox"].includes(d.status)) return "status is filed or inbox";
  if (d.text != null && typeof d.text !== "string") return "text is a string";
  if (d.title != null && typeof d.title !== "string") return "title is a string";
  if (d.links != null && !Array.isArray(d.links)) return "links is a list";
  if (String(d.text ?? "").length > 20000) return "text is at most 20,000 characters";
  return null;
}

const META = new Set(["id", "created_at", "updated_at", "deleted_at", "rev", "data"]);
function toRow(doc: any) {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!META.has(k) && !(k in ITEM_COLUMNS)) rest[k] = v;
  const row: Record<string, unknown> = { id: doc.id, data: JSON.stringify(rest), created_at: doc.created_at, updated_at: doc.updated_at, deleted_at: doc.deleted_at ?? null };
  for (const [k, t] of Object.entries(ITEM_COLUMNS)) { const v = doc[k]; row[k] = v == null ? null : t === "json" ? JSON.stringify(v) : t === "bool" ? (v ? 1 : 0) : String(v); }
  return row;
}
export function rowToItem(r: any): Item | null {
  if (!r) return null;
  let rest: Record<string, unknown> = {};
  try { rest = JSON.parse(r.data ?? "{}"); } catch {}
  const d: any = { ...rest, id: r.id, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at ?? null };
  for (const [k, t] of Object.entries(ITEM_COLUMNS)) { const v = r[k]; d[k] = v == null ? (t === "json" ? (k === "links" ? [] : null) : t === "bool" ? false : null) : t === "json" ? (() => { try { return JSON.parse(v); } catch { return null; } })() : t === "bool" ? !!v : v; }
  if (!Array.isArray(d.links)) d.links = [];
  return d as Item;
}
export const getItem = (db: Database, id: string) => rowToItem(db.query("SELECT * FROM brain_items WHERE id = ?").get(id));
export function listItems(db: Database, o: { aspect?: string | null; person?: string | null; inbox?: boolean; kind?: string | null; limit?: number; deleted?: boolean } = {}): Item[] {
  const w: string[] = [], p: any[] = [];
  if (!o.deleted) w.push("deleted_at IS NULL");
  if (o.aspect) { w.push("aspect = ?"); p.push(o.aspect); }
  if (o.person) { w.push("(person = ? OR links LIKE ?)"); p.push(o.person, `%"person","id":"${o.person.replace(/[%_"]/g, "")}"%`); }
  if (o.inbox != null) { w.push("status = ?"); p.push(o.inbox ? "inbox" : "filed"); }
  if (o.kind) { w.push("kind = ?"); p.push(o.kind); }
  const rows = db.query(`SELECT * FROM brain_items ${w.length ? `WHERE ${w.join(" AND ")}` : ""} ORDER BY coalesce(at, created_at) DESC LIMIT ?`).all(...p, o.limit ?? 5000) as any[];
  return rows.map(rowToItem).filter(Boolean) as Item[];
}
/** Upsert with the store contract's rules: a newer updated_at wins, the same one is a replay, rev = the next counter. */
export function putItem(db: Database, doc: Item): { item: Item; written: boolean } {
  const cur = getItem(db, doc.id);
  if (cur && String(cur.updated_at) >= String(doc.updated_at)) return { item: cur, written: false };
  const row = toRow({ ...doc, created_at: cur?.created_at ?? doc.created_at });
  row.rev = (db.query("SELECT coalesce(max(rev), 0) + 1 AS r FROM brain_items").get() as any).r;
  const keys = Object.keys(row);
  db.query(`INSERT INTO brain_items (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
    ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`).run(...(Object.values(row) as any[]));
  return { item: getItem(db, doc.id)!, written: true };
}
/** A newer copy of an item with these fields changed (updated_at moves on by at least a millisecond). */
export function patched(cur: Item, patch: Partial<Item>, now = new Date().toISOString()): Item {
  const t = Math.max(Date.parse(now), Date.parse(cur.updated_at) + 1);
  return { ...cur, ...patch, updated_at: new Date(t).toISOString() };
}
export const newId = (prefix = "b") => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** File an inbox item (or move a filed one): into an aspect, maybe about a person; who did it is recorded. */
export function fileItem(cur: Item, { aspect, person = undefined, sub = undefined, by = "you", now = new Date().toISOString() }: { aspect?: string | null; person?: string | null; sub?: string | null; by?: string; now?: string }): Item {
  const to = aspect ?? cur.suggest?.to?.[0]?.aspect ?? cur.aspect;
  if (!isAspect(to)) throw new Error("Pick a folder to file it in.");
  const who = person === undefined ? (cur.person ?? cur.suggest?.to?.find((t) => t.aspect === to)?.person ?? null) : person;
  const links = [...(cur.links ?? [])];
  if (who && !links.some((l) => l.kind === "person" && l.id === who)) links.push({ kind: "person", id: who });
  return patched(cur, { aspect: to, person: who, sub: sub === undefined ? (cur.aspect === to ? cur.sub : subFor(to, `${cur.title} ${cur.text}`)) : sub, status: "filed", filed_at: now, filed_by: by, links, kind: cur.kind === "inbox" ? "note" : cur.kind }, now);
}

// ── search: words, meaning, time, place ────────────────────────────────────
const STOP = new Set(("what did i we save saved about the from at in on my me show all things thing notes note anything any is was to for of a an and with " +
  "do does have has had it that this there who whom where when which how tell find search look up get give everything something stuff kya ka ki ke se mein mai hai tha " +
  "today yesterday week month last this since ago").split(" "));
export type Parsed = { q: string; terms: string[]; when: When | null; place: { key: string; label: string; words: string[] } | null; person: Person | null; aspect: string | null };
export function parseQuery(q: string, { nowMs = Date.now(), people = [] as Person[], places = [] as string[] } = {}): Parsed {
  const when = parseWhen(q, nowMs);
  const place = parsePlace(q, places);
  const person = peopleIn(q, people)[0] ?? null;
  const low = String(q).toLowerCase();
  const aspect = (ASPECTS as readonly string[]).find((a) => new RegExp(`\\b${a}\\b`).test(low)) ?? null;
  // month and weekday names are words to find unless they named the window
  const dates = when ? [...MONTHS, ...MONTHS.map((m) => m.slice(0, 3)), ...WEEKDAYS, ...WEEKDAYS.map((d) => d.slice(0, 3))] : [];
  const drop = new Set<string>([...dates, ...(place?.words ?? []).flatMap((w) => w.split(/\s+/)),
    ...(person ? [person.name.toLowerCase(), person.id, ...(person.aliases ?? []).map((a) => a.toLowerCase())] : []), ...(aspect ? [aspect] : [])]);
  const terms = [...new Set(low.split(/[^\p{L}\p{N}₹&]+/u).filter((w) => w.length > 1 && !STOP.has(w) && !drop.has(w) && !/^\d{1,2}(st|nd|rd|th)?$/.test(w)))].slice(0, 12);
  return { q, terms, when, place, person, aspect };
}
/** Where each term appears in a text, merged, for <mark> on the phone: [[start, end], …]. */
export function marksFor(text: string, terms: string[]): [number, number][] {
  const s = String(text ?? "").toLowerCase();
  const out: [number, number][] = [];
  for (const t of terms) { if (!t) continue; let i = s.indexOf(t.toLowerCase()); while (i >= 0 && out.length < 40) { out.push([i, i + t.length]); i = s.indexOf(t.toLowerCase(), i + t.length); } }
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const m of out) { const last = merged[merged.length - 1]; if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]); else merged.push([...m]); }
  return merged;
}
/** The part of a long text around its first hit, with marks re-based to it. */
export function snippet(text: string, terms: string[], width = 160): { text: string; marks: [number, number][] } {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  const all = marksFor(t, terms);
  if (t.length <= width) return { text: t, marks: all };
  const start = Math.max(0, Math.min((all[0]?.[0] ?? 0) - 40, t.length - width));
  let s = t.slice(start, start + width); let off = start;
  if (start > 0) { s = `…${s}`; off -= 1; }
  if (start + width < t.length) s = `${s}…`;
  return { text: s, marks: all.map(([a, b]) => [a - off, b - off] as [number, number]).filter(([a, b]) => a >= 0 && b <= s.length) };
}
export type Hit = { item: Item; score: number; sem: number; why: string[]; title: { text: string; marks: [number, number][] }; snip: { text: string; marks: [number, number][] } };
export const cosine = (a: ArrayLike<number>, b: ArrayLike<number>) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length && i < b.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return x && y ? d / Math.sqrt(x * y) : 0; };
/** Rank items for a parsed query. sims: item id → cosine with the query (search by meaning), when the server has vectors. */
export function rankItems(items: Item[], p: Parsed, { sims = {} as Record<string, number>, hidePrivate = true, aspect = null as string | null, place = null as Parsed["place"], when = null as When | null } = {}): Hit[] {
  const W = when ?? p.when, P = place ?? p.place, A = aspect ?? p.aspect;
  const from = W ? Date.parse(W.from) : null, to = W ? Date.parse(W.to) : null;
  const filtersOnly = !p.terms.length;
  const hits: Hit[] = [];
  for (const it of items) {
    if (it.deleted_at) continue;
    if (hidePrivate && PRIVATE.includes(String(it.aspect))) continue;
    const t = itemMs(it);
    if (from != null && (t < from || t >= to!)) continue;
    if (P && !placeMatches(it, P)) continue;
    if (A && it.aspect !== A && !(it.status === "inbox" && it.suggest?.to?.[0]?.aspect === A)) continue;
    const why: string[] = [];
    let score = 0;
    const title = String(it.title ?? "").toLowerCase(), body = String(it.text ?? "").toLowerCase(), meta = `${it.place ?? ""} ${it.sub ?? ""} ${it.source ?? ""}`.toLowerCase();
    let matched = 0;
    for (const term of p.terms) {
      let m = 0;
      if (title.includes(term)) m += 3; if (body.includes(term)) m += 1.2; if (meta.includes(term)) m += 0.5;
      if (m) { matched++; score += m; }
    }
    if (p.terms.length) { if (matched) why.push(`${matched} of ${p.terms.length} words`); score *= 0.5 + 0.5 * (matched / p.terms.length); }
    const pid = p.person?.id;
    const aboutPerson = !!pid && (it.person === pid || it.links?.some((l) => l.kind === "person" && l.id === pid) || new RegExp(`\\b${escRe(p.person!.name.toLowerCase())}\\b`).test(`${title} ${body}`));
    if (pid && !aboutPerson) continue;
    if (aboutPerson) { score += 4; why.push(`about ${p.person!.name}`); }
    const sem = sims[it.id] ?? 0;
    if (sem > 0.45) { score += (sem - 0.45) * 14; why.push("close in meaning"); }
    if (!filtersOnly && score < 0.9 && !aboutPerson) continue;
    if (filtersOnly) score += 1;
    // fresher things win ties
    score += Math.max(0, 0.6 - (Date.now() - t) / (864e5 * 60));
    hits.push({ item: it, score: Math.round(score * 100) / 100, sem: Math.round(sem * 100) / 100, why, title: { text: it.title, marks: marksFor(it.title, p.terms) }, snip: snippet(it.text, p.terms) });
  }
  return hits.sort((a, b) => b.score - a.score || itemMs(b.item) - itemMs(a.item));
}
const at = (ms: number, nowMs: number) => {
  const d = istDay(ms), today = istDay(nowMs);
  const hm = new Date(ms + IST).toISOString().slice(11, 16);
  if (d === today) return `today ${hm}`;
  if (d === addDays(today, -1)) return `yesterday ${hm}`;
  return short(d);
};
/** One sentence that answers the question from what was found, and the sources it read. Plain, no invention. */
export function composeAnswer(p: Parsed, hits: Hit[], { nowMs = Date.now(), agent = "Wyn" } = {}): { text: string; sources: { kind: string; id: string; title: string }[] } {
  const n = hits.length;
  const scope = [p.person ? `about ${p.person.name}` : "", p.place ? `from ${p.place.label.replace(/^The /, "the ")}` : "", p.when ? p.when.label.toLowerCase() : "", p.aspect ? `in ${ASPECT_NAME[p.aspect as Aspect]}` : ""].filter(Boolean).join(" ");
  if (!n) return { text: `Nothing ${scope || `matches “${p.q.trim()}”`} in your Brain yet.`, sources: [] };
  const top = hits[0].item;
  const byAgent = hits.filter((h) => h.item.author === "agent").length;
  const inbox = hits.filter((h) => h.item.status === "inbox").length;
  const lead = `${n} thing${n === 1 ? "" : "s"}${scope ? ` ${scope}` : ""}${byAgent ? `; ${agent} filed ${byAgent === n ? (n === 1 ? "it" : "all of them") : byAgent}` : ""}.`;
  const best = ` ${n === 1 ? "It is" : p.terms.length ? "The closest is" : "The latest is"} “${top.title}” (${at(itemMs(top), nowMs)}${top.aspect ? `, ${ASPECT_NAME[top.aspect as Aspect]}` : ""}).`;
  const tail = inbox ? ` ${inbox} still in the inbox.` : "";
  return { text: `${lead}${best}${tail}`, sources: hits.slice(0, 3).map((h) => ({ kind: "item", id: h.item.id, title: h.item.title })) };
}

// ── the Brain at a glance ──────────────────────────────────────────────────
export function summarize(items: Item[], nowMs = Date.now()) {
  const today = istDay(nowMs);
  const live = items.filter((i) => !i.deleted_at);
  const folders: Record<string, { count: number; updated: string | null; by: string | null; subs: Record<string, number> }> = {};
  for (const a of ASPECTS) folders[a] = { count: 0, updated: null, by: null, subs: {} };
  for (const it of live) {
    if (it.status !== "filed" || !isAspect(it.aspect)) continue;
    const f = folders[it.aspect]; f.count++;
    const t = new Date(itemMs(it)).toISOString();
    if (!f.updated || t > f.updated) { f.updated = t; f.by = it.filed_by ?? it.author; }
    if (it.sub) f.subs[it.sub] = (f.subs[it.sub] ?? 0) + 1;
  }
  const filedToday = live.filter((i) => i.status === "filed" && i.filed_by === "agent" && istDay(Date.parse(i.filed_at ?? i.updated_at)) === today);
  const savedToday = live.filter((i) => istDay(itemMs(i)) === today);
  return { total: live.length, filed: live.filter((i) => i.status === "filed").length, inbox: live.filter((i) => i.status === "inbox").length, folders,
    filedToday: filedToday.length, savedToday: savedToday.length, people: [...new Set(live.map((i) => i.person).filter(Boolean))].length };
}

// ── the CLI ─────────────────────────────────────────────────────────────────
const flag = (a: Args, k: string) => (typeof a.flags[k] === "string" ? String(a.flags[k]) : undefined);
const shape = (i: Item) => ({ id: i.id, kind: i.kind, title: i.title, folder: i.aspect ?? "inbox", sub: i.sub, person: i.person, by: i.filed_by ?? i.author, at: i.at, place: i.place, status: i.status });
function need(db: Database, id: string | undefined, ctx: ModCtx) {
  const it = id ? getItem(db, id) : null;
  if (!it || it.deleted_at) throw new ctx.UserError(`No Brain item ${id ?? ""}. List them: agentos brain list`);
  return it;
}
const peopleOf = (db: Database): Person[] => {
  // the People module owns persons (people_persons when it exists); the Brain only reads names and aspects
  try { return (db.query("SELECT id, name, aspect FROM people_persons WHERE deleted_at IS NULL").all() as any[]).map((r) => ({ id: r.id, name: r.name, aspect: r.aspect })); } catch { return []; }
};

export const brain: Module = {
  name: "brain",
  help: `agentos brain                     the second brain: folders, the inbox, what the agent filed today
agentos brain add "<text>" [--aspect a] [--person p] [--title t] [--kind k] [--by agent] [--source s] [--place p] [--inbox]
agentos brain list [--aspect a] [--person p] [--inbox] [--limit n] · show <id> · search "<q>" [--when w] [--place p]
agentos brain inbox · file <id> [--aspect a] [--person p] · move <id> --aspect a · pin <id> · rm <id>
agentos brain link <id> <goal:g3|task:12|person:dad|project:slug|vault:entity/dad> · unlink · fact <person> "<key>" "<value>"`,
  migrate(db) { db.exec(ITEMS_DDL); db.exec(VECTORS_DDL); },
  run(db, a, ctx) {
    const sub = a._[1];
    const now = ctx.iso();
    const people = peopleOf(db);
    if (!sub) {
      const s = summarize(listItems(db), ctx.now().getTime());
      return ctx.out({ ...s, folders: Object.entries(s.folders).map(([id, f]) => ({ id, count: f.count, updated: f.updated, private: PRIVATE.includes(id) })) }, ["Run `agentos brain inbox` to file what's waiting"]);
    }
    if (sub === "add") {
      const text = a._.slice(2).join(" ").trim();
      if (!text) throw new ctx.UserError('Say what to remember: agentos brain add "Dad wants the stock list by Sunday" --person dad');
      const base = { id: newId(), text, title: flag(a, "title"), aspect: flag(a, "aspect"), person: flag(a, "person"), kind: flag(a, "kind"), author: flag(a, "by") === "agent" ? "agent" : "you",
        source: flag(a, "source") ?? "cli", place: flag(a, "place"), at: flag(a, "at"), status: a.flags.inbox ? "inbox" : undefined };
      const msg = validateItem(base); if (msg) throw new ctx.UserError(msg);
      let it = normalizeItem(base, { now, people });
      if (it.status === "inbox") it = { ...it, suggest: suggestFor(it, { people }) };
      return ctx.out({ item: shape(putItem(db, it).item), suggest: it.suggest });
    }
    if (sub === "list") {
      const items = listItems(db, { aspect: flag(a, "aspect"), person: flag(a, "person"), inbox: a.flags.inbox ? true : undefined, kind: flag(a, "kind"), limit: Number(flag(a, "limit") ?? 50) });
      return ctx.out({ count: items.length, items: items.map(shape) });
    }
    if (sub === "show") { const it = need(db, a._[2], ctx); return ctx.out({ item: it }); }
    if (sub === "inbox") {
      const items = listItems(db, { inbox: true });
      return ctx.out({ count: items.length, items: items.map((i) => ({ ...shape(i), suggest: (i.suggest ?? suggestFor(i, { people })).to.map((t) => t.label).join(" + ") })) }, items.length ? ["File one: agentos brain file <id> (takes the suggestion)"] : []);
    }
    if (sub === "file" || sub === "move") {
      const cur = need(db, a._[2], ctx);
      const aspect = flag(a, "aspect") ?? (sub === "move" ? undefined : undefined);
      if (sub === "move" && !aspect) throw new ctx.UserError("Say where: agentos brain move <id> --aspect money");
      if (aspect && !isAspect(aspect)) throw new ctx.UserError(`--aspect is one of ${ASPECTS.join(", ")}`);
      const s = cur.suggest ?? suggestFor(cur, { people });
      try { return ctx.out({ item: shape(putItem(db, fileItem({ ...cur, suggest: s }, { aspect, person: flag(a, "person"), by: flag(a, "by") === "agent" ? "agent" : "you", now })).item) }); }
      catch (e: any) { throw new ctx.UserError(e.message); }
    }
    if (sub === "pin") { const cur = need(db, a._[2], ctx); return ctx.out({ item: shape(putItem(db, patched(cur, { pinned: !cur.pinned }, now)).item), pinned: !cur.pinned }); }
    if (sub === "rm") { const cur = need(db, a._[2], ctx); putItem(db, patched(cur, { deleted_at: now }, now)); return ctx.out({ ok: true, removed: cur.id }); }
    if (sub === "link" || sub === "unlink") {
      const cur = need(db, a._[2], ctx);
      const l = linkFrom(a._[3] ?? "");
      if (!l) throw new ctx.UserError(`Link to kind:id, kind one of ${LINK_KINDS.join(", ")} (e.g. goal:g3, person:dad, vault:entity/dad)`);
      const links = (cur.links ?? []).filter((x) => !(x.kind === l.kind && x.id === l.id));
      if (sub === "link") links.push(l);
      return ctx.out({ item: shape(putItem(db, patched(cur, { links }, now)).item), links });
    }
    if (sub === "fact") {
      const [pid, key, ...val] = a._.slice(2);
      if (!pid || !key || !val.length) throw new ctx.UserError('agentos brain fact <person> "<key>" "<value>", e.g. fact dad Birthday "14 March"');
      const p = people.find((x) => x.id === pid);
      const existing = listItems(db, { person: pid, kind: "fact" }).find((i) => i.title.toLowerCase() === key.toLowerCase());
      const value = val.join(" ");
      const it = existing ? patched(existing, { text: value }, now) : normalizeItem({ id: newId("f"), kind: "fact", title: key, text: value, person: pid, aspect: isAspect(p?.aspect) ? p!.aspect : "friends", status: "filed", source: "cli" }, { now, people });
      return ctx.out({ item: shape(putItem(db, it).item) });
    }
    if (sub === "search") {
      const q = a._.slice(2).join(" ");
      const nowMs = ctx.now().getTime();
      const p = parseQuery(q, { nowMs, people });
      const hits = rankItems(listItems(db), p, { when: whenOf(flag(a, "when"), nowMs), place: flag(a, "place") ? parsePlace(`at ${flag(a, "place")}`) : null, aspect: flag(a, "aspect") ?? null });
      return ctx.out({ answer: composeAnswer(p, hits, { nowMs }).text, when: p.when?.label ?? null, place: p.place?.label ?? null, person: p.person?.id ?? null, count: hits.length, results: hits.slice(0, 20).map((h) => ({ ...shape(h.item), score: h.score })) });
    }
    throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos brain [add|list|show|search|inbox|file|move|pin|rm|link|unlink|fact]`);
  },
};

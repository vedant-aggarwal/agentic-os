// Brain (v2): the second brain at the centre of the wheel. Two libraries behind one search:
//  · the app's own Brain: brain_items in the user's agentos DB (notes, inbox captures, files, facts, moments), an offline
//    store collection for the phone, with the agent's filing suggestions, auto-filing of what he shares or scans (DECISIONS 2),
//    search by words, meaning (Ollama vectors), date and place, and person files;
//  · his brain vault (owner only), read through the `brain` CLI with a server-side cache (brain-vault.ts). Never written,
//    except `brain capture` when he asks in the app.
// Routes (/api/v1/mod/brain): items (the store collection), summary, search, inbox/file, inbox/autofile, people/<id>,
// vault, vault/search|ask|note|browse|folder|graph|capture. Tools for the agent: remember, search, inbox, file, link,
// person, fact, forget. Job: brain-tidy (vectors, suggestions, auto-filing) every 15 minutes.
import { Database } from "bun:sqlite";
import type { AgentTool, JobCtx, ModCtx, Module } from "./types";
import { mountCollection } from "./_collection";
import {
  ASPECT_NAME, ITEM_COLUMNS, ITEMS_DDL, PRIVATE, VECTORS_DDL, composeAnswer, confident, fileItem, getItem, isAspect, istDay, itemMs,
  linkFrom, listItems, newId, normalizeItem, parsePlace, parseQuery, patched, putItem, rankItems, suggestFor, summarize, validateItem,
  whenOf, type Item, type Person,
} from "../../cli/src/modules/brain.ts";
import * as V from "./brain-vault";
import * as E from "./brain-embed";

// ── tables: the agentos module owns them; this makes sure they exist on a DB the CLI hasn't migrated yet ──
const readyDbs = new Set<string>();
function ready(db: Database, path: string) {
  if (readyDbs.has(path)) return;
  db.exec(ITEMS_DDL); db.exec(VECTORS_DDL);
  readyDbs.add(path);
}
const withDb = async <T>(path: string, fn: (db: Database) => T | Promise<T>): Promise<T> => {
  const db = new Database(path);
  db.exec("PRAGMA busy_timeout = 5000;");
  try { ready(db, path); return await fn(db); } finally { try { db.close(); } catch {} }
};

// ── people: the People module owns persons; the Brain reads names and aspects. Until people_persons exists, the four
// example people the app already knows (data.js keeps them) are the list.
const KNOWN: Person[] = [
  { id: "dad", name: "Dad", aspect: "family", aliases: ["father"] },
  { id: "mom", name: "Mom", aspect: "family", aliases: ["mother"] },
  { id: "kabir", name: "Kabir", aspect: "friends" },
  { id: "rohan", name: "Rohan", aspect: "friends" },
];
export function peopleOf(db: Database): Person[] {
  try {
    const rows = db.query("SELECT * FROM people_persons WHERE deleted_at IS NULL").all() as any[];
    const out = rows.map((r) => { let d: any = {}; try { d = JSON.parse(r.data ?? "{}"); } catch {} return { id: String(r.id), name: String(r.name ?? d.name ?? r.id), aspect: r.aspect ?? d.aspect ?? null, aliases: d.aliases ?? [] } as Person; }).filter((p) => p.name);
    if (out.length) return out;
  } catch { /* the People module hasn't made its table yet */ }
  return KNOWN;
}

// ── the collection, with the agent's read of every write on the way in ──
const items = mountCollection({ table: "brain_items", columns: ITEM_COLUMNS as any, validate: (d) => validateItem(d) });
// what he shares, scans or says arrives in the inbox; when the agent is sure where it goes she files it at once and says so
// (DECISIONS 2: low-stakes and reversible). Typed notes he put in the inbox on purpose (hold) stay there.
const AUTO_SOURCES = new Set(["share", "scan", "voice", "photo", "file", "files", "whatsapp", "email", "siri", "widget", "capture", "chat", "screenshot", "agent"]);
export function enrich(body: any, cur: Item | null, people: Person[], nowIso = new Date().toISOString()): Item {
  if (body.deleted_at) return body;
  const n = normalizeItem({ ...body }, { now: body.updated_at ?? nowIso, people });
  const textChanged = !cur || cur.text !== n.text || cur.title !== n.title;
  if (n.status === "inbox" && (!n.suggest?.to?.length || textChanged)) n.suggest = suggestFor(n, { people });
  if (!cur && n.status === "inbox" && !body.hold && AUTO_SOURCES.has(String(n.source ?? "").toLowerCase()) && confident(n.suggest)) {
    const f = fileItem(n, { by: "agent", now: n.updated_at });
    return { ...f, auto: true, from_inbox: true } as Item;
  }
  return n;
}
async function afterWrite(dbPath: string, id: string) {
  // vectors for search by meaning, and a better suggestion once his own filing says where things like this go
  await withDb(dbPath, async (db) => {
    const all = listItems(db);
    const it = all.find((i) => i.id === id);
    if (!it) return;
    await E.ensureVectors(db, [it], 1);
    if (it.status !== "inbox") return;
    const sims = E.folderSims(db, all, id);
    if (!Object.keys(sims).length) return;
    const s = suggestFor(it, { people: peopleOf(db), sims });
    if (s.to[0]?.aspect !== it.suggest?.to?.[0]?.aspect) putItem(db, patched(it, { suggest: s }));
  }).catch((e) => console.warn("[mod:brain] after write", String(e?.message ?? e)));
}

// ── search across both libraries ──────────────────────────────────────────
type SearchOpts = { q: string; when?: string | null; place?: string | null; aspect?: string | null; vault?: boolean; private?: boolean; agent?: string; limit?: number };
export async function search(db: Database, owner: boolean, o: SearchOpts) {
  const nowMs = Date.now();
  const people = peopleOf(db);
  const all = listItems(db);
  const places = [...new Set(all.map((i) => i.place).filter(Boolean) as string[])];
  const p = parseQuery(o.q, { nowMs, people, places });
  const sims = p.terms.length ? await Promise.race([E.querySims(db, o.q), new Promise<null>((r) => setTimeout(() => r(null), 2500))]) : null;
  const when = whenOf(o.when ?? null, nowMs);
  const place = o.place && o.place !== "any" ? parsePlace(`at ${o.place}`, places) ?? { key: o.place, label: o.place, words: [o.place.toLowerCase()] } : null;
  const aspect = isAspect(o.aspect) ? o.aspect : null;
  const hits = rankItems(all, p, { sims: sims ?? {}, hidePrivate: !o.private, when, place, aspect });
  const answer = composeAnswer({ ...p, when: when ?? p.when, place: place ?? p.place, aspect: aspect ?? p.aspect }, hits, { nowMs, agent: o.agent || "Wyn" });
  let vault: any = null;
  if (owner && o.vault !== false && V.vaultAvailable() && (o.q.trim() || p.person)) {
    const words = [...p.terms, ...(p.person ? [p.person.name] : [])].join(" ");
    const [ask, found] = await Promise.all([o.q.trim().length > 2 ? V.vaultAsk(o.q) : Promise.resolve(null), words ? V.vaultSearch(words, { limit: 12 }) : Promise.resolve(null)]);
    const W = when ?? p.when;
    const inWindow = (d: string | null) => !W || (!!d && d >= istDay(Date.parse(W.from)) && d < istDay(Date.parse(W.to)));
    const results = (found?.results ?? []).filter((r: any) => inWindow(r.updated));
    vault = {
      ok: !!(ask?.ok || found?.ok), mode: ask?.mode ?? "lexical",
      answer: ask?.ok && !ask.miss && inWindow(ask.answer?.updated ?? null) ? { ...ask.answer, evidence: ask.evidence, also: ask.also } : null,
      results: results.map((r: any) => ({ ...r, marks: marksIn(r.summary, p.terms), tmarks: marksIn(r.title, p.terms) })),
      error: ask && !ask.ok ? ask.error : found && !found.ok ? found.error : null,
    };
  }
  const limit = o.limit ?? 60;
  return {
    q: o.q, mode: sims ? "hybrid" : "lexical",
    parsed: { terms: p.terms, when: (when ?? p.when) ? { key: (when ?? p.when)!.key, label: (when ?? p.when)!.label } : null, place: (place ?? p.place) ? { key: (place ?? p.place)!.key, label: (place ?? p.place)!.label } : null, person: p.person?.id ?? null, aspect: aspect ?? p.aspect },
    answer, count: hits.length,
    items: hits.slice(0, limit).map((h) => ({ id: h.item.id, score: h.score, sem: h.sem, why: h.why, title: h.title, snip: h.snip, item: h.item })),
    vault,
  };
}
const marksIn = (text: string, terms: string[]) => {
  const s = String(text ?? "").toLowerCase(); const out: [number, number][] = [];
  for (const t of terms) { let i = s.indexOf(t); while (i >= 0 && out.length < 20) { out.push([i, i + t.length]); i = s.indexOf(t, i + t.length); } }
  return out.sort((a, b) => a[0] - b[0]).filter((m, i, a) => !i || m[0] >= a[i - 1][1]);
};

// ── a person's file ───────────────────────────────────────────────────────
export async function personFile(db: Database, owner: boolean, pid: string) {
  const people = peopleOf(db);
  const p = people.find((x) => x.id === pid) ?? null;
  const about = listItems(db, { person: pid }).concat(p ? listItems(db).filter((i) => i.person !== pid && !i.links?.some((l) => l.kind === "person" && l.id === pid) && new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(`${i.title} ${i.text}`)) : []);
  const facts = about.filter((i) => i.kind === "fact" && i.person === pid);
  const rest = about.filter((i) => !(i.kind === "fact" && i.person === pid)).sort((a, b) => itemMs(b) - itemMs(a));
  let vault: any = null;
  if (owner && V.vaultAvailable()) {
    let note = await V.vaultNote(`entity/${pid}`);
    if (!note.ok && p) {
      const s = await V.vaultSearch(p.name, { kind: "entity", limit: 5 });
      const m = s.results.find((r) => r.title.toLowerCase() === p.name.toLowerCase());
      if (m) note = await V.vaultNote(m.id);
    }
    vault = note.ok ? { entity: { id: note.note!.id, title: note.note!.title, summary: note.note!.summary, updated: note.note!.updated }, notes: [...(note.inbound ?? []), ...(note.outbound ?? [])].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i && x.id !== "entity/alex").slice(0, 24) } : { entity: null, notes: [] };
  }
  return { person: p ?? { id: pid, name: pid }, facts: facts.map((f) => ({ id: f.id, key: f.title, value: f.text, at: f.updated_at, by: f.filed_by ?? f.author })), items: rest, count: rest.length, vault };
}

// ── filing ────────────────────────────────────────────────────────────────
export function fileOne(db: Database, id: string, o: { aspect?: string | null; person?: string | null; by?: string } = {}) {
  const cur = getItem(db, id);
  if (!cur || cur.deleted_at) throw new Error(`No Brain item ${id}.`);
  const withS = cur.suggest ? cur : { ...cur, suggest: suggestFor(cur, { people: peopleOf(db) }) };
  return putItem(db, fileItem(withS, { aspect: o.aspect ?? undefined, person: o.person === undefined ? undefined : o.person, by: o.by ?? "you" })).item;
}
/** The agent files what she's sure of (not what he held back). Returns what moved. */
export function autofile(db: Database) {
  const people = peopleOf(db);
  const out: Item[] = [];
  for (const it of listItems(db, { inbox: true })) {
    if ((it as any).hold) continue;
    const s = it.suggest ?? suggestFor(it, { people });
    if (!confident(s)) continue;
    out.push({ ...putItem(db, { ...fileItem({ ...it, suggest: s }, { by: "agent" }), auto: true, from_inbox: true } as Item).item });
  }
  return out;
}
export function remember(db: Database, a: { text: string; title?: string; aspect?: string; person?: string; kind?: string; place?: string; source?: string; inbox?: boolean; links?: string[]; by?: string }) {
  const people = peopleOf(db);
  const now = new Date().toISOString();
  const links = (a.links ?? []).map((l) => linkFrom(l)).filter(Boolean);
  const body: any = { id: newId("n"), text: String(a.text ?? "").slice(0, 20000), title: a.title, aspect: a.aspect, person: a.person, kind: a.kind, place: a.place, source: a.source ?? "agent", author: a.by === "you" ? "you" : "agent", links, status: a.inbox ? "inbox" : undefined };
  const msg = validateItem(body); if (msg) throw new Error(msg);
  let it = normalizeItem(body, { now, people });
  if (it.status === "inbox") {
    it.suggest = suggestFor(it, { people });
    // the agent saying it: she files it when she's sure, else it waits in the inbox with her suggestion
    if (!a.inbox && confident(it.suggest)) it = { ...fileItem(it, { by: "agent", now }), auto: true } as Item;
  }
  return putItem(db, it).item;
}
const brief = (i: Item) => ({ id: i.id, title: i.title, text: i.text.length > 400 ? `${i.text.slice(0, 399)}…` : i.text, folder: i.aspect ? ASPECT_NAME[i.aspect as keyof typeof ASPECT_NAME] : "Inbox", sub: i.sub, person: i.person, at: i.at, place: i.place, by: i.filed_by ?? i.author, status: i.status, links: i.links });

// ── the agent's tools (DECISIONS 2: remembering, filing and linking are reversible: she just does them) ──
const tools: AgentTool[] = [
  { name: "brain_remember", auto: true,
    description: "Save something to the user's Brain (the app's second brain): a note, a fact, a moment with someone, what he told you. Files it in the right folder (aspect) when clear, else the inbox with your suggestion.",
    input: { type: "object", properties: { text: { type: "string" }, title: { type: "string" }, aspect: { type: "string", enum: Object.keys(ASPECT_NAME) }, person: { type: "string", description: "person id, e.g. dad" }, kind: { type: "string", enum: ["note", "fact", "moment", "doc", "log", "journal"] }, place: { type: "string" }, links: { type: "array", items: { type: "string" }, description: "goal:g3, task:12, project:slug, person:id, vault:entity/dad" }, inbox: { type: "boolean", description: "leave it in the inbox for him to file" } }, required: ["text"] },
    run: async (c, a) => withDb(c.dbPath, (db) => { const it = remember(db, a); void afterWrite(c.dbPath, it.id); return { saved: brief(it), auto_filed: it.status === "filed" && it.filed_by === "agent" }; }) },
  { name: "brain_search", auto: true,
    description: "Search the user's Brain by words, meaning, date ('today', 'last week', '18 Oct') and place ('at the shop'), across the app's notes and (owner) his brain vault. Returns a one-line answer with sources.",
    input: { type: "object", properties: { query: { type: "string" }, when: { type: "string" }, place: { type: "string" }, aspect: { type: "string" }, vault: { type: "boolean" } }, required: ["query"] },
    run: async (c, a) => withDb(c.dbPath, async (db) => {
      const r = await search(db, c.owner, { q: String(a.query ?? ""), when: a.when, place: a.place, aspect: a.aspect, vault: a.vault !== false, agent: "I", limit: 12 });
      return { answer: r.answer.text, mode: r.mode, items: r.items.map((h) => brief(h.item)), vault: r.vault && { answer: r.vault.answer, results: r.vault.results.slice(0, 8).map((x: any) => ({ id: x.id, title: x.title, summary: x.summary, updated: x.updated })) } };
    }) },
  { name: "brain_inbox", auto: true, description: "What's waiting in the Brain's inbox, each with your suggestion of where it goes.",
    input: { type: "object", properties: {} },
    run: async (c) => withDb(c.dbPath, (db) => { const ppl = peopleOf(db); return { items: listItems(db, { inbox: true }).map((i) => ({ ...brief(i), suggest: (i.suggest ?? suggestFor(i, { people: ppl })).to.map((t) => t.label) })) }; }) },
  { name: "brain_file", auto: true, description: "File an inbox item (or move a filed one) into a folder, optionally about a person. Without an aspect it takes your suggestion. Reversible: tell him what you filed.",
    input: { type: "object", properties: { id: { type: "string" }, aspect: { type: "string", enum: Object.keys(ASPECT_NAME) }, person: { type: "string" }, all: { type: "boolean", description: "file every inbox item you're sure of" } } },
    run: async (c, a) => withDb(c.dbPath, (db) => (a.all ? { filed: autofile(db).map(brief) } : { filed: brief(fileOne(db, String(a.id), { aspect: a.aspect, person: a.person, by: "agent" })) })) },
  { name: "brain_link", auto: true, description: "Link a Brain item to a goal, task, project, person, another item or a vault note (to: 'goal:g3', 'task:12', 'project:atlas', 'person:dad', 'item:<id>', 'vault:entity/dad'). remove: true unlinks.",
    input: { type: "object", properties: { id: { type: "string" }, to: { type: "string" }, remove: { type: "boolean" } }, required: ["id", "to"] },
    run: async (c, a) => withDb(c.dbPath, (db) => {
      const cur = getItem(db, String(a.id)); const l = linkFrom(String(a.to));
      if (!cur || cur.deleted_at) throw new Error(`No Brain item ${a.id}.`);
      if (!l) throw new Error("to is kind:id (goal, task, project, person, item, vault, area, idea)");
      const links = (cur.links ?? []).filter((x) => !(x.kind === l.kind && x.id === l.id));
      if (!a.remove) links.push(l);
      return { item: brief(putItem(db, patched(cur, { links, ...(l.kind === "person" && !a.remove && !cur.person ? { person: l.id } : {}) })).item) };
    }) },
  { name: "brain_person", auto: true, description: "Open a person's file in the Brain: facts, moments and notes about them, and (owner) what his vault says about them. Read it before drafting anything about that person.",
    input: { type: "object", properties: { person: { type: "string", description: "person id, e.g. dad, kabir" } }, required: ["person"] },
    run: async (c, a) => withDb(c.dbPath, async (db) => { const f = await personFile(db, c.owner, String(a.person)); return { ...f, items: f.items.slice(0, 20).map(brief) }; }) },
  { name: "brain_fact", auto: true, description: "Set a fact on a person's file (Birthday, Anniversary, Works at, Likes...). Replaces the old value; reversible.",
    input: { type: "object", properties: { person: { type: "string" }, key: { type: "string" }, value: { type: "string" } }, required: ["person", "key", "value"] },
    run: async (c, a) => withDb(c.dbPath, (db) => {
      const people = peopleOf(db); const p = people.find((x) => x.id === a.person);
      const cur = listItems(db, { person: String(a.person), kind: "fact" }).find((i) => i.title.toLowerCase() === String(a.key).toLowerCase());
      const it = cur ? patched(cur, { text: String(a.value) }) : normalizeItem({ id: newId("f"), kind: "fact", title: String(a.key), text: String(a.value), person: String(a.person), aspect: isAspect(p?.aspect) ? p!.aspect : "friends", status: "filed", author: "agent", source: "agent" }, { people });
      return { fact: brief(putItem(db, it).item), was: cur?.text ?? null };
    }) },
  { name: "brain_forget", auto: false, description: "Delete a Brain item. Ask him first (deleting is his call).",
    input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async (c, a) => withDb(c.dbPath, (db) => { const cur = getItem(db, String(a.id)); if (!cur) throw new Error(`No Brain item ${a.id}.`); putItem(db, patched(cur, { deleted_at: new Date().toISOString() })); return { forgot: cur.id, title: cur.title }; }) },
];

// ── routes ─────────────────────────────────────────────────────────────────
const num = (v: string | null, d: number) => (v != null && Number.isFinite(Number(v)) ? Number(v) : d);
const withTimeout = <T>(p: Promise<T>, ms: number, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
async function handle(ctx: ModCtx): Promise<Response | null> {
  const db = ctx.db();
  ready(db, ctx.dbPath);
  const p = ctx.path, m = ctx.method, q = ctx.url.searchParams;

  // the store collection, each write read by the agent on the way in
  if (p === "/items" || p.startsWith("/items/")) {
    if (m === "PUT" || m === "POST") {
      const body = await ctx.body().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) return ctx.fail(400, "Send the item as a JSON object.");
      const pathId = p.startsWith("/items/") ? decodeURIComponent(p.slice(7)) : null;
      const id = String(body.id ?? pathId ?? newId("s"));
      const msg = validateItem(body); if (msg) return ctx.fail(400, msg);
      const doc = enrich({ ...body, id }, items.get(db, id) as Item | null, peopleOf(db));
      const res = await items.handle({ ...ctx, body: async () => doc }, "/items");
      if (res && res.status < 300) void afterWrite(ctx.dbPath, id);
      return res;
    }
    return items.handle(ctx, "/items");
  }

  if ((p === "/" || p === "/summary") && m === "GET") {
    const s = summarize(listItems(db), Date.now());
    const vault = ctx.owner && V.vaultAvailable() ? await withTimeout(V.vaultHome(), 2500, { ok: false, pending: true } as any) : null;
    // warm the graph's part of the vault (about 40 CLI calls the first time, cached 30 minutes) so the graph opens full
    if (ctx.owner && V.vaultAvailable()) void V.vaultGraph().catch(() => {});
    const vecs = (db.query("SELECT count(*) n FROM brain_vectors").get() as any).n;
    return ctx.json({ ...s, private: PRIVATE, people: peopleOf(db).map((x) => ({ id: x.id, name: x.name, aspect: x.aspect })), vault, meaning: { up: await E.up(), model: E.MODEL, vectors: vecs } });
  }
  if (p === "/search" && m === "GET") {
    const text = String(q.get("q") ?? "").slice(0, 500);
    return ctx.json(await search(db, ctx.owner, { q: text, when: q.get("when"), place: q.get("place"), aspect: q.get("aspect"), vault: q.get("vault") !== "0", private: q.get("private") === "1", agent: String(q.get("agent") ?? "").slice(0, 40), limit: num(q.get("limit"), 60) }));
  }
  if (p === "/inbox/file" && m === "POST") {
    const b = await ctx.body().catch(() => ({}));
    if (b.aspect != null && !isAspect(b.aspect)) return ctx.fail(400, "aspect is one of the nine folders");
    try { const it = fileOne(db, String(b.id ?? ""), { aspect: b.aspect, person: b.person, by: b.by === "agent" ? "agent" : "you" }); return ctx.json({ item: it }); }
    catch (e: any) { return ctx.fail(/No Brain item/.test(e.message) ? 404 : 400, e.message); }
  }
  if (p === "/inbox/autofile" && m === "POST") return ctx.json({ filed: autofile(db) });
  const per = /^\/people\/([A-Za-z0-9_.:-]{1,80})$/.exec(p);
  if (per && m === "GET") return ctx.json(await personFile(db, ctx.owner, per[1]));

  if (p === "/vault" || p.startsWith("/vault/")) {
    if (!ctx.owner) return ctx.fail(403, "The brain vault is the owner's.");
    if (!V.vaultAvailable()) return ctx.fail(503, "The brain CLI isn't on this PC.");
    const fresh = q.get("fresh") === "1";
    if (fresh) V.flushVault();
    if (p === "/vault" && m === "GET") return ctx.json({ ...(await V.vaultHome()), stats: V.vaultStats() });
    if (p === "/vault/search" && m === "GET") return ctx.json(await V.vaultSearch(String(q.get("q") ?? ""), { domain: q.get("domain"), kind: q.get("kind"), limit: num(q.get("limit"), 20) }));
    if (p === "/vault/ask" && m === "GET") return ctx.json(await V.vaultAsk(String(q.get("q") ?? "")));
    if (p === "/vault/note" && m === "GET") { const r = await V.vaultNote(String(q.get("id") ?? "")); return r.ok ? ctx.json(r) : ctx.fail(r.code === "NOT_FOUND" ? 404 : 502, r.error ?? "The vault didn't answer."); }
    if (p === "/vault/browse" && m === "GET") return ctx.json(await V.vaultBrowse({ domain: q.get("domain"), kind: q.get("kind"), limit: num(q.get("limit"), 60) }));
    if (p === "/vault/folder" && m === "GET") {
      const doms = V.ASPECT_DOMAINS[String(q.get("aspect") ?? "")] ?? [];
      const lists = await Promise.all(doms.map((d) => V.vaultBrowse({ domain: d, limit: num(q.get("limit"), 30) })));
      return ctx.json({ ok: true, domains: doms, results: lists.flatMap((l: any) => l.results ?? []).sort((a: any, b: any) => String(b.updated).localeCompare(String(a.updated))).slice(0, num(q.get("limit"), 30)) });
    }
    if (p === "/vault/projects" && m === "GET") return ctx.json(await V.vaultProjects());
    if (p === "/vault/graph" && m === "GET") return ctx.json(await V.vaultGraph());
    if (p === "/vault/capture" && m === "POST") {
      const b = await ctx.body().catch(() => ({}));
      const r = await V.vaultCapture(String(b.text ?? ""));
      return r.ok ? ctx.json(r, 201) : ctx.fail(400, r.error ?? "The vault didn't take it.");
    }
    return null;
  }
  return null;
}

export const brain: Module = {
  name: "brain",
  handle,
  tools,
  jobs: [{
    id: "brain-tidy", every: "15m",
    run: async (c: JobCtx) => {
      await withDb(c.dbPath, async (db) => {
        const all = listItems(db);
        const made = await E.ensureVectors(db, all, 80);
        const filed = autofile(db);
        if (made || filed.length) c.log(`vectors +${made}, auto-filed ${filed.length}`);
      });
    },
  }],
};

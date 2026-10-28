// Demand radar (outward group, concept 8). Asks from clients, leads and captures become items; a
// Sonnet call clusters the new ones ("3 clients asked for WhatsApp order status"); a cluster with
// 3+ asks or 2+ clients gets a product candidate: a one-page spec, a price marked as a guess and a
// landing draft. Everything is a proposal the owner keeps (Build) or drops. Tables are owned by the
// agentos CLI module (agentos src/modules/demand.ts); the DDL below is the same text.
// Lanes, most certain first: (1) a pasted chat export or email thread, split by one Haiku call;
// (2) agentos captures with source email, share or client; (3) Pulse Chat, read-only, only when the
// config has PULSECHAT_API_URL and PULSECHAT_API_KEY (and PULSECHAT_NUMBER_ID when the account has
// several numbers); without them the lane is silently off.
//   GET /status                      lanes, counts, last run
//   GET /clusters[?all=1]            ranked by distinct clients, then asks (dropped ones with all=1)
//   GET /clusters/:id                cluster + its asks + candidate
//   POST /clusters/:id/status        { status: new|candidate|building|dropped }; building also files the project task
//   POST /import                     { text, source?: chat|manual|lead, client? }
//   POST /run                        the radar now: pull lanes, cluster, write candidates
//   job demand-radar at 05:30
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import type { JobCtx, ModCtx, Module } from "./types";

const DDL = `
  CREATE TABLE IF NOT EXISTS demand_items (id INTEGER PRIMARY KEY, source TEXT NOT NULL, external_id TEXT, client_slug TEXT, text TEXT NOT NULL,
    asked_at TEXT, cluster_id INTEGER, created_at TEXT NOT NULL);
  CREATE UNIQUE INDEX IF NOT EXISTS demand_items_external ON demand_items(source, external_id) WHERE external_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS demand_items_cluster ON demand_items(cluster_id);
  CREATE TABLE IF NOT EXISTS demand_clusters (id INTEGER PRIMARY KEY, title TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, clients TEXT NOT NULL DEFAULT '[]',
    item_ids TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'new', created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS demand_candidates (cluster_id INTEGER PRIMARY KEY REFERENCES demand_clusters(id) ON DELETE CASCADE, spec_md TEXT, price_guess TEXT,
    price_is_guess INTEGER NOT NULL DEFAULT 1, landing_md TEXT, created_at TEXT NOT NULL);
`;
const ensure = (db: Database) => { db.exec(DDL); return db; };
const now = () => new Date().toISOString();
const parse = <T,>(s: unknown, d: T): T => { try { return s == null ? d : (JSON.parse(String(s)) as T); } catch { return d; } };
const SOURCES = ["lead", "capture", "chat", "manual"];
const STATUSES = ["new", "candidate", "building", "dropped"];
const MAX_CLUSTER_ITEMS = 60;   // one Sonnet call per run reads at most this many new asks
const MAX_CANDIDATES = 3;       // candidate calls per run
type Ctx = ModCtx | JobCtx;

// ── shapes ──────────────────────────────────────────────────────────────────
const CLUSTER_SQL = `SELECT c.*, (SELECT 1 FROM demand_candidates d WHERE d.cluster_id = c.id) AS has_candidate FROM demand_clusters c`;
function shapeCluster(c: any) {
  const clients = parse<string[]>(c.clients, []);
  return { id: c.id, title: c.title, count: c.count, clients, clientCount: clients.length, itemIds: parse<number[]>(c.item_ids, []),
    status: c.status, candidate: !!c.has_candidate, createdAt: c.created_at, ready: c.count >= 3 || clients.length >= 2 };
}
const shapeItem = (i: any) => ({ id: i.id, source: i.source, client: i.client_slug, text: i.text, askedAt: i.asked_at, cluster: i.cluster_id });
function shapeCandidate(k: any) {
  return k ? { spec: k.spec_md, priceGuess: k.price_guess, priceIsGuess: !!k.price_is_guess, landing: k.landing_md, createdAt: k.created_at } : null;
}
function insertItem(db: Database, it: { source: string; externalId?: string | null; client?: string | null; text: string; askedAt?: string | null }) {
  const text = it.text.replace(/\s+/g, " ").trim().slice(0, 1000);
  if (text.length < 12) return null;
  if (it.externalId && db.query("SELECT 1 FROM demand_items WHERE source = ? AND external_id = ?").get(it.source, it.externalId)) return null;
  return db.query("INSERT INTO demand_items (source, external_id, client_slug, text, asked_at, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *")
    .get(it.source, it.externalId ?? null, it.client ?? null, text, it.askedAt ?? null, now()) as any;
}
const stateFile = (ctx: Ctx) => join(ctx.dataDir, "mod", "demand", "state.json");
function readState(ctx: Ctx): { pulseChatSince?: string; lastRun?: any } { try { return JSON.parse(readFileSync(stateFile(ctx), "utf8")); } catch { return {}; } }
function writeState(ctx: Ctx, s: any) { try { mkdirSync(join(ctx.dataDir, "mod", "demand"), { recursive: true }); writeFileSync(stateFile(ctx), JSON.stringify(s, null, 1)); } catch {} }

// ── lane 1: a pasted chat or thread, split by Haiku (code split when the model is unavailable) ──
const CHAT_LINE = /^\[?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap]\.?m\.?)?\]?\s*[-–]?\s*([^:]{1,60}):\s*(.+)$/i;
function codeSplit(text: string) {
  const out: { text: string; askedAt: string | null }[] = [];
  let cur: { text: string; askedAt: string | null } | null = null, dated = 0;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const m = CHAT_LINE.exec(line);
    if (m) {
      dated++;
      if (cur) out.push(cur);
      let hh = Number(m[4]);
      if (m[6]) { const pm = /p/i.test(m[6]); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const t = Date.UTC(y, Number(m[2]) - 1, Number(m[1]), hh, Number(m[5])) - 330 * 60000;
      cur = { text: m[8].trim(), askedAt: Number.isFinite(t) ? new Date(t).toISOString() : null };
      continue;
    }
    if (dated) { if (cur && line) cur.text += ` ${line}`; continue; }
    if (!line) { if (cur) out.push(cur); cur = null; continue; }
    cur = cur ? { ...cur, text: `${cur.text} ${line}` } : { text: line, askedAt: null };
  }
  if (cur) out.push(cur);
  return out.filter((x) => x.text.trim().length >= 12);
}
const SPLIT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["asks"],
  properties: { asks: { type: "array", maxItems: 40, items: { type: "object", additionalProperties: false, required: ["text", "askedAt"],
    properties: { text: { type: "string" }, askedAt: { type: ["string", "null"] } } } } },
};
async function splitWithHaiku(ctx: Ctx, text: string, source: string) {
  const r = await ctx.ai.claude({
    model: "haiku", schema: SPLIT_SCHEMA, timeout: 60_000,
    system: `You read a pasted ${source === "chat" ? "WhatsApp chat export" : "message thread"} between Alex (who builds software for small Indian businesses) and a customer or lead.
List every distinct ask, request, complaint or wish the OTHER party expressed, one per entry, in their own words but trimmed to one or two sentences. Skip greetings, thanks, Alex's own messages and anything that is not an ask.
askedAt: the ISO 8601 date-time of that message when the text shows one (dates in the export are day/month/year, times are India time, UTC+05:30), else null. Keep the entries in the order they appear.`,
    prompt: `Thread:\n${text.slice(0, 24_000)}`,
  });
  const asks = Array.isArray(r.out?.asks) ? r.out.asks : [];
  return asks.map((a: any) => ({ text: String(a.text ?? ""), askedAt: a.askedAt && !Number.isNaN(Date.parse(a.askedAt)) ? new Date(a.askedAt).toISOString() : null }))
    .filter((a: any) => a.text.trim().length >= 12);
}

// ── lane 2: agentos captures from email, share or client ────────────────────
function pullCaptures(db: Database) {
  let clientRows: any[] = [];
  try { clientRows = db.query("SELECT slug, project_slugs FROM clients_clients").all() as any[]; } catch {}
  const byProject = new Map<string, string>();
  for (const c of clientRows) for (const p of parse<string[]>(c.project_slugs, [])) byProject.set(p, c.slug);
  // Client decisions (external_id decision:<n>) are answers, not asks: they stay out.
  const rows = db.query(`SELECT id, title, notes, source, external_id, project, created_at FROM tasks WHERE source IN ('email','share','client') AND status != 'dropped'
    AND coalesce(external_id, '') NOT LIKE 'decision:%'
    AND NOT EXISTS (SELECT 1 FROM demand_items i WHERE i.source = 'capture' AND i.external_id = 'task:' || tasks.id) ORDER BY id LIMIT 200`).all() as any[];
  let added = 0;
  for (const t of rows) {
    let client = t.project ? byProject.get(t.project) ?? null : null;
    if (!client && t.source === "client" && /^decision:\d+$/.test(t.external_id ?? "")) {
      try { client = (db.query("SELECT client_slug FROM clients_decisions WHERE id = ?").get(Number(t.external_id.slice(9))) as any)?.client_slug ?? null; } catch {}
    }
    const text = [t.title, t.notes ? String(t.notes).slice(0, 300) : ""].filter(Boolean).join(" — ");
    if (insertItem(db, { source: "capture", externalId: `task:${t.id}`, client, text, askedAt: t.created_at })) added++;
  }
  return added;
}

// ── lane 3: Pulse Chat, read-only, behind config keys ─────────────────────────
// The API shape follows the Pulse Chat MCP client (brain: tool/pulsechat-mcp-for-claude-code): Bearer key,
// GET /api/v1/conversations?number=&limit=&updated_since=  → { data: [{ id, customer: { name, phone }, ... }], has_more, next_cursor }
// GET /api/v1/conversations/:id/messages?limit=  → { data: [{ id, conversation_id, direction?, text?, ... }] }.
// Field names for direction, text and time vary by version, so the reader accepts the usual spellings.
function pulseChatConf(ctx: Ctx) {
  const url = ctx.conf("PULSECHAT_API_URL", "").trim().replace(/\/+$/, ""), key = ctx.conf("PULSECHAT_API_KEY", "").trim();
  return url && key && /^https?:\/\//.test(url) ? { url, key, number: ctx.conf("PULSECHAT_NUMBER_ID", "").trim() } : null;
}
const firstStr = (o: any, keys: string[]) => { for (const k of keys) { const v = k.split(".").reduce((x, p) => (x == null ? x : x[p]), o); if (typeof v === "string" && v.trim()) return v; } return ""; };
function inbound(msg: any) {
  const d = String(firstStr(msg, ["direction", "type", "kind"])).toLowerCase();
  if (/^(in|inbound|received|incoming|customer)$/.test(d)) return true;
  if (/^(out|outbound|sent|outgoing|agent|business)$/.test(d)) return false;
  if (typeof msg.from_me === "boolean") return !msg.from_me;
  if (typeof msg.is_inbound === "boolean") return msg.is_inbound;
  return false;
}
async function pullPulseChat(ctx: Ctx, db: Database) {
  const cf = pulseChatConf(ctx);
  if (!cf) return { on: false, added: 0 };
  const state = readState(ctx);
  const since = state.pulseChatSince ?? new Date(Date.now() - 7 * 864e5).toISOString();
  const headers = { Authorization: `Bearer ${cf.key}`, Accept: "application/json" };
  const get = async (path: string) => {
    const r = await fetch(`${cf.url}${path}`, { headers, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json() as Promise<any>;
  };
  let clientRows: any[] = [];
  try { clientRows = db.query("SELECT slug, name, contact_name, contact_channel FROM clients_clients WHERE active = 1").all() as any[]; } catch {}
  const clientFor = (name: string, phone: string) => {
    const digits = phone.replace(/\D/g, "").slice(-10);
    for (const c of clientRows) {
      const ch = String(c.contact_channel ?? "").replace(/\D/g, "").slice(-10);
      if (digits && ch && digits === ch) return c.slug;
      if (name && c.contact_name && name.toLowerCase() === String(c.contact_name).toLowerCase()) return c.slug;
      if (name && name.toLowerCase().includes(String(c.name).toLowerCase())) return c.slug;
    }
    return null;
  };
  let added = 0;
  try {
    const q = new URLSearchParams({ limit: "50", updated_since: since });
    if (cf.number) q.set("number", cf.number);
    const convs = await get(`/api/v1/conversations?${q}`);
    for (const c of (Array.isArray(convs?.data) ? convs.data : []).slice(0, 30)) {
      const id = String(c?.id ?? "");
      if (!id) continue;
      const who = firstStr(c, ["customer.name", "contact.name", "name"]), phone = firstStr(c, ["customer.phone", "contact.phone", "phone"]);
      const client = clientFor(who, phone);
      let msgs: any;
      try { msgs = await get(`/api/v1/conversations/${encodeURIComponent(id)}/messages?limit=50`); } catch { continue; }
      for (const m of Array.isArray(msgs?.data) ? msgs.data : []) {
        if (!inbound(m)) continue;
        const text = firstStr(m, ["text", "body", "content.text", "message.text", "text.body", "caption"]);
        const at = firstStr(m, ["timestamp", "created_at", "sent_at", "time"]);
        const askedAt = at ? (/^\d{9,13}$/.test(at) ? new Date(Number(at) * (at.length <= 10 ? 1000 : 1)).toISOString() : !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : null) : null;
        if (askedAt && askedAt < since) continue;
        if (insertItem(db, { source: "chat", externalId: `pulsechat:${m.id ?? `${id}:${askedAt ?? text.slice(0, 40)}`}`, client, text: `${who && !client ? `${who}: ` : ""}${text}`, askedAt })) added++;
        if (added >= 200) break;
      }
    }
    writeState(ctx, { ...state, pulseChatSince: now() });
  } catch (e: any) {
    ctx.log(`pulsechat lane skipped: ${e?.message ?? e}`);   // silent for the user: the lane just stays empty
  }
  return { on: true, added };
}

// ── clustering ──────────────────────────────────────────────────────────────
const STOP = new Set(["a", "an", "the", "for", "of", "on", "in", "to", "and", "or", "with", "via", "by", "from", "per", "as", "at", "is", "be"]);
const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w)));
/** Title similarity for merging a proposed cluster into an existing one: token Jaccard ≥ 0.5, or one title inside the other. */
export function similar(a: string, b: string) {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return false;
  const na = [...x].join(" "), nb = [...y].join(" ");
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter) >= 0.5;
}
const CLUSTER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["clusters"],
  properties: { clusters: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "itemIds"],
    properties: { title: { type: "string" }, itemIds: { type: "array", items: { type: "integer" } } } } } },
};
function recount(db: Database, clusterId: number) {
  const items = db.query("SELECT id, client_slug FROM demand_items WHERE cluster_id = ? ORDER BY id").all(clusterId) as any[];
  const clients = [...new Set(items.map((i) => i.client_slug).filter(Boolean))].sort();
  db.query("UPDATE demand_clusters SET count = ?, clients = ?, item_ids = ? WHERE id = ?").run(items.length, JSON.stringify(clients), JSON.stringify(items.map((i) => i.id)), clusterId);
}
async function clusterNew(ctx: Ctx, db: Database) {
  const items = db.query("SELECT id, client_slug, text FROM demand_items WHERE cluster_id IS NULL ORDER BY id LIMIT ?").all(MAX_CLUSTER_ITEMS) as any[];
  if (!items.length) return { clustered: 0, created: 0, merged: 0 };
  const existing = db.query("SELECT id, title FROM demand_clusters WHERE status != 'dropped' ORDER BY id").all() as { id: number; title: string }[];
  const r = await ctx.ai.claude({
    model: "sonnet", schema: CLUSTER_SCHEMA, timeout: 120_000,
    system: `You run a demand radar for Alex, who builds software products for small Indian businesses (shops, dealers, traders). You receive asks collected from clients, leads and his own notes.
Group them into demand clusters: asks that want the same capability belong together even when worded differently (same product idea, same job to be done). Every item id goes into exactly one cluster; an ask that matches nothing is a cluster of one.
Titles: a short noun phrase a shop owner would say ("WhatsApp order status", "Dealer price list as PDF"), at most 6 words, no punctuation at the end. When an ask belongs to one of the EXISTING clusters, reuse that cluster's exact title.`,
    prompt: `Existing clusters (reuse titles when they fit):\n${existing.length ? existing.map((c) => `- ${c.title}`).join("\n") : "(none)"}\n\nNew asks (id · client · text):\n${items.map((i) => `${i.id} · ${i.client_slug ?? "unknown"} · ${i.text.slice(0, 300)}`).join("\n")}`,
  });
  const proposed: { title: string; itemIds: number[] }[] = Array.isArray(r.out?.clusters) ? r.out.clusters : [];
  const valid = new Set(items.map((i) => i.id));
  const placed = new Set<number>();
  let created = 0, merged = 0;
  const touched = new Set<number>();
  for (const p of proposed) {
    const title = String(p.title ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    const ids = (Array.isArray(p.itemIds) ? p.itemIds : []).map(Number).filter((id) => valid.has(id) && !placed.has(id));
    if (!title || !ids.length) continue;
    let target = existing.find((c) => similar(c.title, title)) ?? null;
    if (target) merged++;
    else {
      const row = db.query("INSERT INTO demand_clusters (title, count, clients, item_ids, status, created_at) VALUES (?, 0, '[]', '[]', 'new', ?) RETURNING id, title").get(title, now()) as any;
      target = { id: row.id, title: row.title };
      existing.push(target);
      created++;
    }
    for (const id of ids) { db.query("UPDATE demand_items SET cluster_id = ? WHERE id = ?").run(target.id, id); placed.add(id); }
    touched.add(target.id);
  }
  for (const id of touched) recount(db, id);
  return { clustered: placed.size, created, merged };
}

// ── candidates ──────────────────────────────────────────────────────────────
const CANDIDATE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["spec", "priceGuess", "landing"],
  properties: { spec: { type: "string" }, priceGuess: { type: "string" }, landing: { type: "string" } },
};
async function writeCandidates(ctx: Ctx, db: Database) {
  const due = (db.query(`${CLUSTER_SQL} WHERE c.status IN ('new','candidate') AND (c.count >= 3 OR json_array_length(c.clients) >= 2)
    AND NOT EXISTS (SELECT 1 FROM demand_candidates d WHERE d.cluster_id = c.id) ORDER BY json_array_length(c.clients) DESC, c.count DESC LIMIT ?`).all(MAX_CANDIDATES) as any[]);
  let written = 0;
  for (const c of due) {
    const items = db.query("SELECT client_slug, text, asked_at FROM demand_items WHERE cluster_id = ? ORDER BY asked_at IS NULL, asked_at").all(c.id) as any[];
    const clients = parse<string[]>(c.clients, []);
    try {
      const r = await ctx.ai.claude({
        model: "sonnet", schema: CANDIDATE_SCHEMA, timeout: 150_000,
        system: `You write product candidates for Northwind Studio, Alex's software company for small Indian businesses (shops, dealers, traders; WhatsApp-first; Tally and Marg accounting are common). Ground everything in the asks you are given; invent no customers, numbers or results.
Return three markdown texts:
spec: a one-page spec (under 350 words): "# <title>", then "## Who asked" (the clients and what they said, briefly), "## What it does" (5 to 8 bullets), "## Not in v1", "## First build" (the smallest thing that answers the asks).
priceGuess: one line, INR, a guess for Alex to react to, e.g. "₹1,499/month per shop (guess)". It is not a quote: no Northwind product price is final.
landing: a landing page draft (under 250 words): a headline, a one-line sub, three short benefit sections with "###" headings, and a call to action that says "Talk to Alex on WhatsApp". Plain English, no hype words.`,
        prompt: `Cluster: ${c.title}\nClients who asked: ${clients.join(", ") || "unknown"}\nAsks:\n${items.map((i) => `- [${i.client_slug ?? "unknown"}${i.asked_at ? ` · ${String(i.asked_at).slice(0, 10)}` : ""}] ${i.text.slice(0, 400)}`).join("\n")}`,
      });
      const spec = String(r.out?.spec ?? "").trim(), price = String(r.out?.priceGuess ?? "").trim(), landing = String(r.out?.landing ?? "").trim();
      if (!spec) continue;
      db.query("INSERT INTO demand_candidates (cluster_id, spec_md, price_guess, price_is_guess, landing_md, created_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(cluster_id) DO UPDATE SET spec_md = excluded.spec_md, price_guess = excluded.price_guess, landing_md = excluded.landing_md, created_at = excluded.created_at")
        .run(c.id, spec, price || "no guess yet", landing, now());
      if (c.status === "new") db.query("UPDATE demand_clusters SET status = 'candidate' WHERE id = ?").run(c.id);
      written++;
    } catch (e: any) { ctx.log(`candidate for cluster ${c.id} failed: ${e?.message ?? e}`); }
  }
  return written;
}

/** The whole radar: pull lanes 2 and 3, cluster, write candidates. Each step fails on its own. */
async function radar(ctx: Ctx) {
  const db = ensure(ctx.db());
  const t0 = Date.now();
  const captures = pullCaptures(db);
  const chat = await pullPulseChat(ctx, db);
  let clusters = { clustered: 0, created: 0, merged: 0 }, error: string | null = null;
  try { clusters = await clusterNew(ctx, db); } catch (e: any) { error = `cluster: ${e?.message ?? e}`; ctx.log(error); }
  const candidates = await writeCandidates(ctx, db);
  const result = { at: now(), ms: Date.now() - t0, pulled: { captures, pulseChat: chat }, ...clusters, candidates, error };
  writeState(ctx, { ...readState(ctx), lastRun: result });
  ctx.log(`radar: +${captures} captures, +${chat.added} chat, ${clusters.clustered} clustered (${clusters.created} new, ${clusters.merged} merged), ${candidates} candidates`);
  return result;
}

export const demand: Module = {
  name: "demand",
  async handle(ctx) {
    if (!ctx.owner) return ctx.fail(403, "Owner only.");
    const { path: p, method: m } = ctx;
    const db = ensure(ctx.db());
    if (p === "/status" && m === "GET") {
      const n = (q: string) => (db.query(q).get() as any).n as number;
      return ctx.json({ pulseChat: !!pulseChatConf(ctx), items: n("SELECT count(*) n FROM demand_items"), unclustered: n("SELECT count(*) n FROM demand_items WHERE cluster_id IS NULL"),
        clusters: n("SELECT count(*) n FROM demand_clusters WHERE status != 'dropped'"), candidates: n("SELECT count(*) n FROM demand_candidates"), lastRun: readState(ctx).lastRun ?? null,
        clients: (() => { try { return db.query("SELECT slug, name FROM clients_clients WHERE active = 1 ORDER BY name").all(); } catch { return []; } })() });
    }
    if (p === "/clusters" && m === "GET") {
      const all = ctx.url.searchParams.get("all") === "1";
      const rows = (db.query(`${CLUSTER_SQL} ${all ? "" : "WHERE c.status != 'dropped'"} ORDER BY json_array_length(c.clients) DESC, c.count DESC, c.id`).all() as any[]).map(shapeCluster);
      return ctx.json({ clusters: rows, unclustered: (db.query("SELECT count(*) n FROM demand_items WHERE cluster_id IS NULL").get() as any).n });
    }
    const one = p.match(/^\/clusters\/(\d+)(?:\/(status))?$/);
    if (one) {
      const c = db.query(`${CLUSTER_SQL} WHERE c.id = ?`).get(Number(one[1])) as any;
      if (!c) return ctx.fail(404, "No such cluster.");
      if (!one[2] && m === "GET") {
        const items = (db.query("SELECT * FROM demand_items WHERE cluster_id = ? ORDER BY asked_at IS NULL, asked_at DESC, id").all(c.id) as any[]).map(shapeItem);
        return ctx.json({ cluster: shapeCluster(c), items, candidate: shapeCandidate(db.query("SELECT * FROM demand_candidates WHERE cluster_id = ?").get(c.id)) });
      }
      if (one[2] === "status" && m === "POST") {
        const b = await ctx.body();
        const status = String(b.status ?? "");
        if (!STATUSES.includes(status)) return ctx.fail(400, `Status is one of ${STATUSES.join(", ")}.`);
        let task: any = null;
        if (status === "building" && c.status !== "building") {
          // Build: one project task in agentos, filed once (same source + id twice is a no-op there).
          const clients = parse<string[]>(c.clients, []);
          const args = ["add", `Build: ${c.title}`, "--source", "demand", "--external-id", `cluster:${c.id}`,
            "--notes", `Demand radar cluster ${c.id}: ${c.count} ask(s) from ${clients.join(", ") || "unknown clients"}. Spec, price guess and landing draft on the Demand page.`];
          try { task = (await ctx.agentos([...args, "--area", "northwind"]))?.task ?? null; }
          catch { try { task = (await ctx.agentos(args))?.task ?? null; } catch (e: any) { return ctx.fail(502, `Could not file the build task: ${e?.message ?? e}`); } }
        }
        db.query("UPDATE demand_clusters SET status = ? WHERE id = ?").run(status, c.id);
        return ctx.json({ ok: true, cluster: shapeCluster({ ...c, status }), task: task ? { id: task.id, title: task.title } : null });
      }
    }
    if (p === "/import" && m === "POST") {
      const b = await ctx.body();
      const text = String(b.text ?? "").trim();
      if (text.length < 12) return ctx.fail(400, "Paste the chat or thread first.");
      const source = SOURCES.includes(String(b.source)) ? String(b.source) : "manual";
      const client = b.client ? String(b.client).trim().slice(0, 60) : null;
      let asks: { text: string; askedAt: string | null }[] = [], model = "haiku";
      try { asks = await splitWithHaiku(ctx, text, source); } catch (e: any) { ctx.log(`import: haiku split failed (${e?.message ?? e}), splitting in code`); }
      if (!asks.length) { asks = codeSplit(text); model = "code"; }
      const batch = Bun.hash(text).toString(36);
      let added = 0, skipped = 0;
      const items: any[] = [];
      asks.forEach((a, i) => {
        const r = insertItem(db, { source, client, text: a.text, askedAt: a.askedAt, externalId: `paste:${batch}#${i}` });
        if (r) { added++; items.push(shapeItem(r)); } else skipped++;
      });
      return ctx.json({ ok: true, added, skipped, total: asks.length, splitBy: model, items });
    }
    if (p === "/run" && m === "POST") return ctx.json({ ok: true, run: await radar(ctx) });
    return null;
  },
  jobs: [{ id: "demand-radar", at: "05:30", async run(ctx) { await radar(ctx); } }],
};

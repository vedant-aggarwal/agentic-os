// The brain vault through the `brain` CLI (SURVEY 8): read-only, owner only, never a file read under the vault.
// Every CLI call is a fresh node process that loads all ~400 notes (300-500 ms), so answers are cached here: fresh for a
// few minutes, served stale while a refresh runs, at most two CLI processes at once, the same call in flight shared.
// Output is TOON only; it is decoded with @toon-format/toon from brain-axi's own node_modules (no new dependency), and a
// decode failure hands back the raw text. The one write is `brain capture`, only when he asks in the app.
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

const NODE = process.env.BRAIN_NODE || process.env.WYN_NODE || Bun.which("node") || "node";
// Off by default: BRAIN_CLI (or WYN_BRAIN) is the path to the vault CLI's Node entry script. Unset, the vault lane is off.
export const BRAIN_JS = process.env.BRAIN_CLI || process.env.WYN_BRAIN || "";
const TOON_JS = process.env.BRAIN_TOON || join(dirname(BRAIN_JS), "..", "node_modules", "@toon-format", "toon", "dist", "index.mjs");

export type VaultResult = { ok: boolean; data: any; ms: number; cached: boolean; stale?: boolean; error?: string; code?: string };
type Entry = { at: number; value: VaultResult };

let decodeFn: ((s: string) => any) | null | undefined;
async function decoder() {
  if (decodeFn !== undefined) return decodeFn;
  try { decodeFn = existsSync(TOON_JS) ? (await import(pathToFileURL(TOON_JS).href)).decode : null; } catch { decodeFn = null; }
  return decodeFn;
}
export async function decodeToon(text: string): Promise<any> {
  const d = await decoder();
  if (!d) return { raw: text };
  try { return d(text); } catch { return { raw: text }; }
}

// ── the process pool ─────────────────────────────────────────────────────────
let running = 0;
const waiting: (() => void)[] = [];
const slot = () => (running < 2 ? (running++, Promise.resolve()) : new Promise<void>((r) => waiting.push(() => { running++; r(); })));
const free = () => { running--; waiting.shift()?.(); };
export let spawnCount = 0;   // for tests and the status line

async function spawnCli(args: string[], timeoutMs = 30_000): Promise<VaultResult> {
  if (!existsSync(BRAIN_JS)) return { ok: false, data: null, ms: 0, cached: false, error: "The brain CLI isn't on this PC.", code: "NO_CLI" };
  await slot();
  const t0 = performance.now();
  try {
    spawnCount++;
    const p = Bun.spawn([NODE, BRAIN_JS, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1" } });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    clearTimeout(timer);
    const code = await p.exited;
    const ms = Math.round(performance.now() - t0);
    const data = await decodeToon((out || err).trim());
    if (code !== 0 || data?.error) return { ok: false, data, ms, cached: false, error: String(data?.error ?? `brain exited ${code}`), code: String(data?.code ?? "CLI_ERROR") };
    return { ok: true, data, ms, cached: false };
  } catch (e: any) {
    return { ok: false, data: null, ms: Math.round(performance.now() - t0), cached: false, error: String(e?.message ?? e), code: "SPAWN" };
  } finally { free(); }
}

// ── the cache ────────────────────────────────────────────────────────────────
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<VaultResult>>();
const MAX = 400;
/** One CLI call, cached for ttl ms; older than that it is served stale (up to an hour) while a refresh runs. */
export async function vaultRun(args: string[], { ttl = 5 * 60_000, fresh = false, stale = 60 * 60_000 }: { ttl?: number; fresh?: boolean; stale?: number } = {}): Promise<VaultResult> {
  const key = JSON.stringify(args);
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  const go = () => {
    let p = inflight.get(key);
    if (!p) {
      p = spawnCli(args).then((v) => {
        // a failed call isn't cached long: the CLI may be mid-update or Ollama warming up
        if (v.ok || v.code === "NOT_FOUND" || v.code === "VALIDATION_ERROR") { cache.set(key, { at: Date.now(), value: v }); if (cache.size > MAX) cache.delete(cache.keys().next().value!); }
        return v;
      }).finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return p;
  };
  if (hit && !fresh && age < ttl) return { ...hit.value, cached: true };
  if (hit && !fresh && age < stale) { void go(); return { ...hit.value, cached: true, stale: true }; }
  return go();
}
export const flushVault = () => cache.clear();
export const vaultAvailable = () => existsSync(BRAIN_JS);
export const vaultStats = () => ({ cached: cache.size, inflight: inflight.size, running, spawned: spawnCount });

// ── shapes the app reads ─────────────────────────────────────────────────────
/** "journal/2026-10-05-dad-personal-branding-direction" → "Dad personal branding direction". */
export function titleFromId(id: string): string {
  const leaf = String(id).split("/").pop() ?? String(id);
  const t = leaf.replace(/^\d{4}-\d{2}-\d{2}-?/, "").replace(/-\d{4}-\d{2}-\d{2}$/, "").replace(/[-_]+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : leaf;
}
export const folderOf = (id: string) => (String(id).includes("/") ? String(id).split("/")[0] : "note");
// the vault's domains and the wheel's folders they sit closest to (a vault note shows under that folder as "In your vault")
export const DOMAIN_ASPECT: Record<string, string> = { work: "mission", system: "mission", money: "money", learn: "mind", self: "growth", people: "friends" };
export const ASPECT_DOMAINS: Record<string, string[]> = { mission: ["work", "system"], money: ["money"], mind: ["learn"], growth: ["self"], friends: ["people"], family: ["people"] };
const rows = (v: any) => (Array.isArray(v) ? v : []);
export function shapeResult(r: any) {
  return { id: String(r.id), title: titleFromId(r.id), folder: folderOf(r.id), domain: r.domain ?? null, updated: r.updated ?? null, score: typeof r.score === "number" ? r.score : Number(r.score) || 0, summary: String(r.summary ?? "") };
}
export async function vaultHome() {
  const r = await vaultRun([], { ttl: 5 * 60_000 });
  if (!r.ok) return { ok: false, error: r.error, code: r.code };
  const d = r.data ?? {};
  return {
    ok: true, notes: d.summary?.notes ?? null, cached: r.cached,
    folders: rows(d.folders).filter((f: any) => f.folder !== "meta" && f.folder !== "capture").map((f: any) => ({ id: f.folder, count: f.count })),
    domains: rows(d.domains).map((x: any) => ({ id: x.domain, count: x.count, aspect: DOMAIN_ASPECT[x.domain] ?? null })),
    recent: rows(d.recent_journal).map((j: any) => ({ id: `journal/${j.id}`, title: String(j.title ?? titleFromId(j.id)), updated: j.updated })),
  };
}
export async function vaultSearch(terms: string, { domain, kind, limit = 20 }: { domain?: string | null; kind?: string | null; limit?: number } = {}) {
  const words = String(terms).split(/\s+/).filter(Boolean).slice(0, 12);
  if (!words.length) return { ok: true, count: 0, results: [] as ReturnType<typeof shapeResult>[] };
  const args = ["search", ...words, "--limit", String(Math.max(1, Math.min(200, limit)))];
  if (domain) args.push("--domain", domain);
  if (kind) args.push("--kind", kind);
  const r = await vaultRun(args, { ttl: 10 * 60_000 });
  if (!r.ok) return { ok: false, error: r.error, code: r.code, count: 0, results: [] };
  return { ok: true, count: Number(String(r.data?.count ?? "0").split(" ")[0]) || rows(r.data?.results).length, results: rows(r.data?.results).map(shapeResult), cached: r.cached };
}
/** Every note of a domain or kind, newest first. The CLI has no list command, so this is a search for "e" (in nearly
 *  every note) narrowed by the flag: still the CLI, still read-only. */
export async function vaultBrowse({ domain, kind, limit = 60 }: { domain?: string | null; kind?: string | null; limit?: number }) {
  const r = await vaultSearch("e", { domain, kind, limit: 200 });
  if (!r.ok) return r;
  return { ...r, results: r.results.sort((a, b) => String(b.updated).localeCompare(String(a.updated))).slice(0, limit) };
}
/** Markdown evidence as one readable paragraph: no headings, no bold or code marks, list items joined. */
export const plain = (s: string) => {
  let t = String(s).replace(/^\s*#{1,6}\s.*$/gm, "").replace(/\*\*|__|`/g, "").replace(/^\s*[-*]\s+/gm, "· ").replace(/\s*\n\s*/g, " ").replace(/\s{2,}/g, " ").trim();
  // an excerpt that starts mid-sentence (often mid-path) reads from the next sentence instead
  if (t.startsWith("…")) { const i = t.search(/[.!?]\s+[A-Z"“(]/); if (i > 0 && i < 160) t = `…${t.slice(i + 1).trim()}`; }
  return t;
};
export async function vaultAsk(q: string) {
  const r = await vaultRun(["ask", String(q).slice(0, 500)], { ttl: 10 * 60_000 });
  if (!r.ok) return { ok: false, error: r.error, code: r.code };
  const d = r.data ?? {};
  const hit = d.answer && typeof d.answer === "object" ? d.answer : null;
  return {
    ok: true, mode: d.mode ?? "lexical", confidence: d.confidence ?? null, miss: !hit, cached: r.cached,
    answer: hit ? { id: String(hit.source), title: String(hit.title ?? titleFromId(hit.source)), updated: hit.updated ?? null, coverage: hit.term_coverage ?? null, similarity: Number(hit.similarity) || null } : null,
    evidence: typeof d.evidence === "string" ? plain(d.evidence.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_: string, id: string, label?: string) => label ?? titleFromId(id))) : null,
    also: rows(d.also).map((id: any) => ({ id: String(id), title: titleFromId(String(id)) })),
    candidates: rows(d.candidates).map((c: any) => ({ id: String(c.id), title: titleFromId(c.id), summary: String(c.summary ?? ""), sim: Number(c.sim) || null })),
  };
}
const WIKI = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
export async function vaultNote(id: string) {
  const [show, ctx] = await Promise.all([vaultRun(["show", id, "--full"], { ttl: 30 * 60_000 }), vaultRun(["context", id], { ttl: 30 * 60_000 })]);
  if (!show.ok) return { ok: false, error: show.error, code: show.code };
  const n = show.data?.note ?? {};
  const body = String(show.data?.body ?? "");
  const title = /^\s*#\s+(.+)$/m.exec(body)?.[1]?.trim() ?? titleFromId(n.path ?? id);
  const links = [...new Set([...body.matchAll(WIKI)].map((m) => m[1].trim()))];
  const c = ctx.ok ? ctx.data ?? {} : {};
  return {
    ok: true, cached: show.cached,
    note: { id: String(n.path ?? id), kind: n.kind ?? null, domain: n.domain ?? null, status: n.status ?? null, updated: n.updated ?? null, summary: String(n.summary ?? ""), title, aspect: DOMAIN_ASPECT[n.domain] ?? null },
    body: body.replace(/^\s*#\s+.+\n/, "").trim(),
    links: links.map((l) => ({ id: l, title: titleFromId(l) })),
    outbound: rows(c.outbound).filter((e: any) => Number(e.depth ?? 1) === 1).map((e: any) => ({ id: String(e.to), edge: e.edge === "-" ? null : e.edge, title: titleFromId(e.to), resolved: e.resolved !== false })),
    inbound: rows(c.inbound).map((e: any) => ({ id: String(e.from), edge: e.edge === "-" ? null : e.edge, title: titleFromId(e.from) })),
  };
}
export async function vaultProjects() {
  const r = await vaultRun(["project"], { ttl: 30 * 60_000 });
  if (!r.ok) return { ok: false, error: r.error, projects: [] };
  return { ok: true, projects: rows(r.data?.projects).map((p: any) => ({ id: `project/${p.id}`, slug: String(p.id), title: titleFromId(p.id), status: p.status ?? null, updated: p.updated ?? null })) };
}
/** The part of the vault the graph draws: people entities and projects, with the edges between what it shows. */
export async function vaultGraph() {
  const [people, ents, projects] = await Promise.all([vaultBrowse({ domain: "people", limit: 30 }), vaultBrowse({ kind: "entity", limit: 40 }), vaultProjects()]);
  const nodes = new Map<string, { id: string; title: string; kind: string; domain: string | null; summary: string }>();
  for (const r of [...(people.results ?? []), ...(ents.results ?? [])]) if (r.id !== "entity/alex") nodes.set(r.id, { id: r.id, title: r.title, kind: r.folder, domain: r.domain, summary: r.summary });
  for (const p of projects.projects ?? []) nodes.set(p.id, { id: p.id, title: p.title, kind: "project", domain: "work", summary: "" });
  const ids = [...nodes.keys()];
  const edges: [string, string, string | null][] = [];
  // one context call per node (cached 30 min); only edges between nodes the graph shows
  const ctxs = await Promise.all(ids.map((id) => vaultRun(["context", id], { ttl: 30 * 60_000 })));
  ctxs.forEach((c, i) => {
    if (!c.ok) return;
    for (const e of rows(c.data?.outbound)) if (Number(e.depth ?? 1) === 1 && nodes.has(String(e.to)) && e.to !== ids[i]) edges.push([ids[i], String(e.to), e.edge === "-" ? null : e.edge]);
  });
  const seen = new Set<string>();
  return { ok: true, nodes: [...nodes.values()], edges: edges.filter(([a, b]) => { const k = [a, b].sort().join("|"); if (seen.has(k)) return false; seen.add(k); return true; }) };
}
/** The one write: `brain capture` (the vault's inbox, no contract). Only when he asks in the app. */
export async function vaultCapture(text: string) {
  const t = String(text ?? "").trim().slice(0, 1500);
  if (!t) return { ok: false, error: "Say what to capture." };
  const r = await spawnCli(["capture", t]);
  if (r.ok) flushVault();
  return r.ok ? { ok: true, result: r.data } : { ok: false, error: r.error, code: r.code };
}

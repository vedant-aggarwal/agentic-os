// Search by meaning for the app's own Brain items: vectors from the Ollama on this PC (nomic-embed-text, the model the
// brain vault already uses; free, local), stored in brain_vectors (the agentos module's table). Ollama down means words
// only: every caller checks up() and carries on without vectors. Nothing here ever blocks a write.
import type { Database } from "bun:sqlite";
import { cosine, type Item } from "../../cli/src/modules/brain.ts";

const HOST = (() => { const h = process.env.OLLAMA_HOST || "127.0.0.1:11434"; return /^https?:\/\//.test(h) ? h.replace(/\/+$/, "") : `http://${h}`; })();
export const MODEL = process.env.BRAIN_EMBED_MODEL || "nomic-embed-text";
const OFF = (process.env.BRAIN_EMBED ?? "on") === "off";

let upAt = 0, upVal = false;
/** Is Ollama answering (checked at most every 30 s)? */
export async function up(): Promise<boolean> {
  if (OFF) return false;
  if (Date.now() - upAt < 30_000) return upVal;
  upAt = Date.now();
  try { const r = await fetch(`${HOST}/api/tags`, { signal: AbortSignal.timeout(1200) }); upVal = r.ok; } catch { upVal = false; }
  return upVal;
}
/** nomic-embed-text wants a task prefix: documents and queries embed differently. */
export async function embed(texts: string[], kind: "doc" | "query" = "doc"): Promise<Float32Array[] | null> {
  if (!texts.length) return [];
  if (!(await up())) return null;
  const pre = kind === "query" ? "search_query: " : "search_document: ";
  try {
    const r = await fetch(`${HOST}/api/embed`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, input: texts.map((t) => pre + t.slice(0, 4000)) }), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) { upVal = false; return null; }
    const j: any = await r.json();
    return (j.embeddings ?? []).map((v: number[]) => Float32Array.from(v));
  } catch { upVal = false; upAt = Date.now(); return null; }
}
const textOf = (it: Pick<Item, "title" | "text" | "place" | "sub">) => `${it.title ?? ""}\n${it.text ?? ""}${it.place ? `\nAt ${it.place}` : ""}`.trim();
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return `${MODEL}:${(h >>> 0).toString(36)}:${s.length}`; };
const toBlob = (v: Float32Array) => new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
const fromBlob = (b: Uint8Array) => new Float32Array(b.slice().buffer);

/** Vectors for items that have none or whose text changed; at most `max` per call. Returns how many it made. */
export async function ensureVectors(db: Database, items: Item[], max = 40): Promise<number> {
  const have = new Map((db.query("SELECT id, hash FROM brain_vectors").all() as any[]).map((r) => [r.id, r.hash]));
  const todo = items.filter((it) => !it.deleted_at && textOf(it).length > 2 && have.get(it.id) !== hash(textOf(it))).slice(0, max);
  if (!todo.length) return 0;
  const vecs = await embed(todo.map(textOf));
  if (!vecs) return 0;
  const put = db.prepare("INSERT INTO brain_vectors (id, model, hash, dim, vec, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET model = excluded.model, hash = excluded.hash, dim = excluded.dim, vec = excluded.vec, updated_at = excluded.updated_at");
  const now = new Date().toISOString();
  db.transaction(() => todo.forEach((it, i) => vecs[i] && put.run(it.id, MODEL, hash(textOf(it)), vecs[i].length, toBlob(vecs[i]), now)))();
  return todo.length;
}
export function vectors(db: Database): Map<string, Float32Array> {
  try { return new Map((db.query("SELECT id, vec FROM brain_vectors WHERE model = ?").all(MODEL) as any[]).map((r) => [r.id, fromBlob(r.vec)])); } catch { return new Map(); }
}
/** Each item's closeness in meaning to a question (cosine), for rankItems. null when Ollama is down. */
export async function querySims(db: Database, q: string): Promise<Record<string, number> | null> {
  const vs = vectors(db);
  if (!vs.size || !q.trim()) return vs.size ? {} : null;
  const qv = (await embed([q], "query"))?.[0];
  if (!qv) return null;
  const out: Record<string, number> = {};
  for (const [id, v] of vs) out[id] = Math.round(cosine(qv, v) * 1000) / 1000;
  return out;
}
/** How close one item is to what he already filed in each folder (the folder's mean vector): it learns his filing. */
export function folderSims(db: Database, items: Item[], id: string): Record<string, number> {
  const vs = vectors(db);
  const me = vs.get(id);
  if (!me) return {};
  const sums = new Map<string, { v: Float32Array; n: number }>();
  for (const it of items) {
    if (it.id === id || it.status !== "filed" || !it.aspect || it.deleted_at) continue;
    const v = vs.get(it.id); if (!v) continue;
    const s = sums.get(it.aspect) ?? { v: new Float32Array(v.length), n: 0 };
    for (let i = 0; i < v.length; i++) s.v[i] += v[i];
    s.n++; sums.set(it.aspect, s);
  }
  const out: Record<string, number> = {};
  for (const [a, s] of sums) if (s.n >= 2) out[a] = Math.round(cosine(me, s.v) * 1000) / 1000;
  return out;
}

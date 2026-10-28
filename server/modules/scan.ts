// Scan: the one camera lens, share-in, and "say it once" (v2). Owner: CAPTURE.
// The phone captures (camera frame, document pages, a picked photo, a shared link or text, a voice transcript), the PC
// works out what it is with Codex on his subscription (the image, plus the phone's on-device OCR and first guess), and
// the result goes to the app that owns that kind (the app's scan handler on the phone; Content, tasks and ideas here).
// Kinds, prompts and normalisers: scan-kinds.ts. Routes (/api/v1/mod/scan/...):
//   POST /classify        { id?, image? (base64 or data URL), images? [..] (document pages), mime?, ocr?, barcodes?, guess?, hint?,
//                           text?, url?, note?, source? } → { item }   (the same id twice returns the first answer: no second spend)
//   GET|PUT|POST|DELETE /items[/<id>]   the scan history (the svc/store collection contract; the phone writes `filed`)
//   POST /items/<id>/undo  undoes what the PC filed (a task, an idea, a content idea, a module tool with an undo)
//   GET  /images/<id>[/<n>] the saved photo (owner's session)
//   POST /share           share-in from another app: classified and filed at once (DECISIONS 2), told after, with Undo
//   POST /say             { text } → { reply, items }   one sentence or voice note → one entry per app (nothing filed yet)
//   POST /say/apply       { id?, text?, items } → { results }   files the ticked entries
//   GET  /status          Codex login (transcription + scan), the classifier's queue, ffmpeg
//   GET  /kinds           the kinds and where each goes
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTool, JobCtx, ModCtx, Module } from "./types";
import { mountCollection } from "./_collection";
import { CORE_ACTIONS, CLASSIFY_SCHEMA, KINDS, SAY_SCHEMA, classifyPrompt, firstUrl, isKind, kindOfGuess, kindOfUrl, normalizeFields,
  sayPrompt, shapeClassified, shapeSay, suggestionFor, alternativesFor, type Classified, type Kind, type SayAction } from "./scan-kinds";
import { dictationStatus } from "../voice";

export const items = mountCollection({
  table: "scan_items", ensure: true,
  columns: { kind: "text", status: "text", source: "text", app: "text" },
  validate: (d) => (d.kind != null && !isKind(d.kind) && d.kind !== "say" ? "Unknown kind." : d.status != null && !STATUSES.includes(d.status) ? "Bad status." : null),
});
const STATUSES = ["reading", "ready", "filed", "failed", "undone", "dropped"];
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
const MAX_IMAGE = 8 * 1024 * 1024;

// ── time, IST ──
const ist = (d = new Date()) => new Date(d.getTime() + 330 * 60_000);
const todayIst = () => ist().toISOString().slice(0, 10);
const nowIst = () => ist().toISOString().slice(11, 16);
const weekdayIst = () => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][ist().getUTCDay()];
const newId = (p = "s") => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
/** A server-side write that always wins over the stored copy (the phone's clock may run ahead). */
function stamp(cur: any) {
  const now = Date.now();
  const prev = cur?.updated_at ? Date.parse(cur.updated_at) : 0;
  return new Date(Math.max(now, prev + 1)).toISOString();
}
function save(ctx: JobCtx, doc: any) {
  const db = ctx.db();
  const cur = items.get(db, doc.id);
  return items.upsert(db, { ...(cur ?? {}), ...doc, updated_at: stamp(cur) }).item;
}

// ── the classifier's queue: two Codex runs at a time (his subscription), the rest wait their turn ──
const SCAN_PARALLEL = 2;
let running = 0;
const waiting: Array<() => void> = [];
async function turn<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= SCAN_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}
const inflight = new Map<string, Promise<any>>();
let lastMs: number[] = [];

// ── images: kept with the scan so the apps and the agent can look again ──
const imgDir = (ctx: JobCtx) => join(ctx.dataDir, "mod", "scan", `u${ctx.user?.id ?? 0}`);
function decodeImage(v: unknown): { bytes: Buffer; ext: string } | null {
  if (typeof v !== "string" || !v) return null;
  const m = v.match(/^data:image\/(png|jpe?g|webp|heic|gif);base64,/i);
  const ext = m ? (m[1].toLowerCase() === "jpeg" ? "jpg" : m[1].toLowerCase()) : "jpg";
  const bytes = Buffer.from(m ? v.slice(m[0].length) : v, "base64");
  if (bytes.length < 64 || bytes.length > MAX_IMAGE) return null;
  return { bytes, ext };
}
function saveImages(ctx: JobCtx, id: string, list: unknown[]): string[] {
  const dir = imgDir(ctx);
  mkdirSync(dir, { recursive: true });
  return list.slice(0, 4).map(decodeImage).filter(Boolean).map((img, n) => {
    const f = join(dir, `${id}-${n}.${img!.ext}`);
    writeFileSync(f, img!.bytes);
    return f;
  });
}
const imageFiles = (ctx: JobCtx, id: string) => {
  const dir = imgDir(ctx);
  const out: string[] = [];
  for (let n = 0; n < 4; n++) for (const ext of ["jpg", "png", "webp", "heic", "gif"]) { const f = join(dir, `${id}-${n}.${ext}`); if (existsSync(f)) out.push(f); }
  return out;
};

// ── the fast paths: no Codex when the address or the barcode already says what it is ──
async function pageTitle(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(4000), headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AgenticOS/2.0" } });
    if (!r.ok || !/html/i.test(r.headers.get("content-type") ?? "")) return null;
    const html = (await r.text()).slice(0, 200_000);
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1];
    return og ? og.replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim().slice(0, 200) : null;
  } catch { return null; }
}
async function linkResult(url: string, text: string | null, note: string | null): Promise<Classified> {
  const k = kindOfUrl(url)!;
  const title = (text && text.trim() !== url ? text.split("\n").find((l) => l.trim())?.trim().slice(0, 200) : null) ?? (await pageTitle(k.url)) ?? `${k.platform === "Web" ? new URL(k.url).hostname.replace(/^www\./, "") : k.platform} ${k.kind === "reel" ? "reel" : "link"}`;
  const fields = normalizeFields(k.kind, { url: k.url, platform: k.platform, title, why: note });
  return { kind: k.kind, title, summary: `${k.kind === "reel" ? "A reel" : "A link"} from ${k.platform === "Web" ? new URL(k.url).hostname.replace(/^www\./, "") : k.platform}.`, confidence: 0.9,
    fields, suggestion: suggestionFor(k.kind, fields), alternatives: alternativesFor(k.kind, [], fields) };
}
const isbnOf = (barcodes: unknown) => (Array.isArray(barcodes) ? barcodes : []).map((b: any) => String(b?.value ?? b ?? "").replace(/[^0-9X]/gi, "")).find((v) => /^97[89]\d{10}$/.test(v)) ?? null;
async function bookByIsbn(isbn: string): Promise<Classified | null> {
  try {
    const r = await fetch(`https://openlibrary.org/isbn/${isbn}.json`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const b: any = await r.json();
    let author: string | null = null;
    const a = b.authors?.[0]?.key;
    if (a) { try { author = ((await (await fetch(`https://openlibrary.org${a}.json`, { signal: AbortSignal.timeout(4000) })).json()) as any).name ?? null; } catch {} }
    const fields = normalizeFields("book", { title: b.title, author, pages: b.number_of_pages, isbn });
    if (!fields.title) return null;
    return { kind: "book", title: fields.title, summary: `${fields.title}${author ? ` by ${author}` : ""}${fields.pages ? `, ${fields.pages} pages` : ""}.`, confidence: 0.97,
      fields, suggestion: suggestionFor("book", fields), alternatives: alternativesFor("book", [], fields) };
  } catch { return null; }
}

// ── classify ──
type ClassifyIn = { id?: string; image?: string; images?: string[]; mime?: string; ocr?: string; text?: string; url?: string; note?: string;
  barcodes?: any[]; guess?: string; hint?: string; source?: string; lines?: any[] };
export async function classify(ctx: JobCtx, b: ClassifyIn): Promise<any> {
  const id = b.id && ID.test(String(b.id)) ? String(b.id) : newId("s");
  const db = ctx.db();
  const cur = items.get(db, id);
  if (cur && cur.kind && cur.status !== "failed" && cur.status !== "reading") return cur;   // a resend (offline queue, lost reply)
  if (inflight.has(id)) return inflight.get(id);
  const job = (async () => {
    const text = typeof b.text === "string" ? b.text.trim().slice(0, 8000) : "";
    const url = (typeof b.url === "string" && b.url.trim()) || (text ? firstUrl(text) : null);
    const files = saveImages(ctx, id, [b.image, ...(Array.isArray(b.images) ? b.images : [])].filter(Boolean));
    const guess = kindOfGuess(b.guess, b.ocr ?? "");
    const hint = isKind(b.hint) ? b.hint : null;
    const base = { id, source: String(b.source ?? "camera").slice(0, 20), ocr: b.ocr ? String(b.ocr).slice(0, 8000) : null, guess: b.guess ?? null,
      hint, url: url ?? null, text: text || null, note: b.note ? String(b.note).slice(0, 500) : null, pages: files.length,
      imageUrl: files.length ? `/api/v1/mod/scan/images/${id}` : null, created_at: cur?.created_at ?? new Date().toISOString() };
    save(ctx, { ...base, status: "reading", kind: hint ?? guess ?? null });
    const t0 = Date.now();
    let res: Classified | null = null, engine = "codex", error: string | null = null;
    try {
      const isbn = isbnOf(b.barcodes);
      if (isbn) { res = await bookByIsbn(isbn); if (res) engine = "isbn"; }
      if (!res && url && !files.length && (!text || text.replace(url, "").trim().length < 200)) { res = await linkResult(url, text.replace(url, "").trim() || null, base.note); engine = "link"; }
      if (!res) {
        if (!files.length && !text && !base.ocr) throw new Error("Nothing to read: send a photo, text or a link.");
        const out = await turn(() => ctx.codex({
          prompt: classifyPrompt({ today: todayIst(), now: nowIst(), ocr: base.ocr, guess: b.guess ?? null, hint, text: text || null, url, note: base.note, source: base.source, hasImage: files.length > 0, pages: files.length }),
          schema: CLASSIFY_SCHEMA, images: files, model: ctx.conf("SCAN_MODEL", "gpt-6-luna"), timeoutMs: 150_000,
          ...({ effort: ctx.conf("SCAN_EFFORT", "low") } as any),
        }));
        res = shapeClassified(out.out, { kind: hint ?? guess });
        if (url && (res.kind === "reel" || res.kind === "link") && !res.fields.url) res.fields.url = url;
      }
    } catch (e: any) { error = String(e?.message ?? e).slice(0, 300); }
    const ms = Date.now() - t0;
    if (engine === "codex" && res) { lastMs = [...lastMs.slice(-9), ms]; ctx.log(`classified ${id} as ${res.kind} in ${ms}ms`); }
    if (!res) {
      // Codex failed: the phone's own guess still lets him file it by hand; nothing is lost
      const k = hint ?? guess;
      const fields = k ? normalizeFields(k, {}) : {};
      return save(ctx, { ...base, status: k ? "ready" : "failed", kind: k, title: k ? KINDS[k].label : "Couldn't read it", summary: "", confidence: k ? 0.3 : 0, fields,
        suggestion: k ? suggestionFor(k, fields) : null, alternatives: k ? alternativesFor(k, [], fields) : [], engine: k ? "phone" : null, error, ms, retry: true });
    }
    return save(ctx, { ...base, ...res, status: "ready", engine, error: null, ms, app: res.suggestion.app, retry: false });
  })();
  inflight.set(id, job);
  try { return await job; } finally { inflight.delete(id); }
}

// ── filing on the PC: what the server can do itself (the nine apps file on the phone through their scan handlers) ──
/** Tests swap the other modules' tools for fakes (the real ones open real databases). */
export const __test: { tools: null | (() => Promise<Array<AgentTool & { module: string }>>) } = { tools: null };
async function moduleTools(): Promise<Array<AgentTool & { module: string }>> {
  if (__test.tools) return __test.tools();
  try {
    const { MODULES } = await import("./index");
    return MODULES.filter((m) => m.name !== "scan").flatMap((m) => (m.tools ?? []).map((t) => ({ ...t, module: m.name })));
  } catch { return []; }
}
const toolKey = (t: { module: string; name: string }) => `${t.module}.${t.name}`;
async function findTool(module: string, re: RegExp) { return (await moduleTools()).find((t) => t.module === module && re.test(t.name)) ?? null; }

const APP_NAME: Record<string, string> = { money: "Money", body: "Body", mind: "Mind", soul: "Soul", mission: "Mission", growth: "Growth", people: "People",
  family: "Family", friends: "Friends", romance: "Romance", brain: "Brain", content: "Content", today: "Tasks", work: "Ideas" };
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOWS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Fri 23 Oct" for a YYYY-MM-DD, "Today"/"Tomorrow" when it is */
function dayWord(d: string) {
  if (d === todayIst()) return "Today";
  const t = new Date(`${d}T00:00:00Z`);
  if (d === new Date(Date.parse(`${todayIst()}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)) return "Tomorrow";
  return `${DOWS[t.getUTCDay()]} ${t.getUTCDate()} ${MONTH[t.getUTCMonth()]}`;
}
type Filed = { app: string; action: string; at: string; by: "you" | "wyn"; ref?: string | null; undo?: any; where?: string; phone?: any };
async function contentIdea(ctx: JobCtx, title: string, url: string | null, source: string) {
  const r = await ctx.agentos(["content", "capture", title.slice(0, 300), ...(url ? ["--link", url] : []), "--source", source]);
  const ref = r?.idea?.id != null ? `c${String(r.idea.id).replace(/^c/, "")}` : null;
  return { ref, already: !!r?.already, undo: ref && !r?.already ? { type: "content", id: ref } : null };
}
/** Files one action. Returns what was done, and how to undo it; `phone` means the app on the phone finishes it. */
async function runAction(ctx: JobCtx, action: string, args: any, by: "you" | "wyn", source: string): Promise<Filed & { text: string }> {
  const at = new Date().toISOString();
  if (action === "task") {
    const due = /^\d{4}-\d{2}-\d{2}$/.test(String(args.due ?? "")) ? String(args.due) : null;
    const hm = /^\d{1,2}:\d{2}$/.test(String(args.at ?? "")) ? String(args.at).padStart(5, "0") : null;
    const minutes = Math.max(5, Math.min(600, Number(args.minutes) || 30));
    const scheduled = due && hm ? { start: new Date(`${due}T${hm}:00+05:30`).toISOString(), end: new Date(Date.parse(`${due}T${hm}:00+05:30`) + minutes * 60_000).toISOString() } : undefined;
    const t = ctx.store.createTask({ title: String(args.title ?? "").slice(0, 300), notes: args.notes ? String(args.notes).slice(0, 2000) : null, due, ...(scheduled ? { scheduled } : {}), ...(args.minutes ? { estimateMinutes: minutes } : {}) }, source);
    return { app: "today", action, at, by, ref: t.id, undo: { type: "task", id: t.id }, where: due ? `Tasks · ${dayWord(due)}${hm ? ` ${hm}` : ""}` : "Tasks · Inbox", text: t.title };
  }
  if (action === "idea") {
    const i = ctx.store.createIdea({ title: String(args.title ?? ""), body: args.body ?? null, source: source === "share" ? "capture" : "voice" });
    return { app: "work", action, at, by, ref: i.id, undo: { type: "idea", id: i.id }, where: "Work · Ideas", text: i.title };
  }
  if (action === "content") {
    const c = await contentIdea(ctx, String(args.title ?? args.url ?? "Idea"), args.url ?? null, source === "share" ? "share" : "agent");
    return { app: "content", action, at, by, ref: c.ref, undo: c.undo, where: "Content · Ideas", text: String(args.title ?? "") };
  }
  if (action === "note") {
    const t = await findTool("brain", /^brain_remember$|remember/);
    if (t) {
      // the Brain's own tool: it files by aspect and person, or leaves it in its inbox with a suggestion
      const person = args.person ? String(args.person).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") : undefined;
      const r: any = await t.run(ctx, { text: String(args.text ?? ""), ...(args.title ? { title: args.title } : {}), ...(args.aspect ? { aspect: args.aspect } : {}), ...(person ? { person } : {}), kind: args.kind ?? "note" });
      const ref = r?.saved?.id ?? r?.id ?? r?.item?.id ?? null;
      const forget = (await moduleTools()).find((x) => x.module === "brain" && /forget/.test(x.name));
      return { app: "brain", action, at, by, ref, undo: ref && forget ? { type: "tool", module: "brain", tool: forget.name, args: { id: ref } } : null,
        where: r?.saved?.folder ? `Brain › ${r.saved.folder}` : "Brain", text: String(args.text ?? "") };
    }
    // the Brain's server half isn't there yet: the phone files it through api.remember
    return { app: "brain", action, at, by, phone: { bus: "remember", text: args.text, aspect: args.aspect ?? null, person: args.person ?? null }, where: "Brain", text: String(args.text ?? "") };
  }
  const tools = await moduleTools();
  const t = tools.find((x) => toolKey(x) === action);
  if (!t) throw new Error(`No action ${action}.`);
  const r: any = await t.run(ctx, args);
  const ref = r?.id ?? r?.item?.id ?? r?.saved?.id ?? null;
  // a tool's undo names its own tool; it lives in the same module unless it says otherwise
  return { app: t.module, action, at, by, ref, undo: r?.undo ? { type: "tool", module: t.module, ...r.undo } : null,
    where: String(r?.where ?? r?.said ?? APP_NAME[t.module] ?? t.module).slice(0, 80), text: JSON.stringify(args).slice(0, 200) };
}
async function undo(ctx: JobCtx, u: any) {
  if (!u) throw new Error("This one can't be undone from the PC.");
  if (u.type === "task") return ctx.store.patchTask(u.id, { status: "dropped" });
  if (u.type === "idea") return ctx.store.patchIdea(u.id, { status: "archived" });
  if (u.type === "content") return ctx.agentos(["content", "idea", u.id, "--status", "dropped"]);
  if (u.type === "tool") {
    const t = (await moduleTools()).find((x) => (!u.module || x.module === u.module) && x.name === u.tool);
    if (!t) throw new Error("The app that filed it can't undo it now.");
    return t.run(ctx, u.args ?? {});
  }
  if (u.type === "phone") return { ok: true };
  throw new Error("Unknown undo.");
}

// ── say it once ──
async function sayActions(): Promise<SayAction[]> {
  const tools = (await moduleTools()).filter((t) => t.auto && t.module !== "brain");
  return [...CORE_ACTIONS, ...tools.map((t) => ({ name: toolKey(t), app: t.module, module: t.module, description: t.description, input: t.input }))];
}
export async function plan(ctx: JobCtx, text: string) {
  const actions = await sayActions();
  const out = await turn(() => ctx.codex({ prompt: sayPrompt({ text, today: todayIst(), now: nowIst(), weekday: weekdayIst(), actions }), schema: SAY_SCHEMA,
    model: ctx.conf("SCAN_MODEL", "gpt-6-luna"), timeoutMs: 120_000, ...({ effort: ctx.conf("SCAN_EFFORT", "low") } as any) }));
  return shapeSay(out.out, actions);
}
export async function apply(ctx: JobCtx, b: { id?: string; text?: string; items: any[]; by?: "you" | "wyn"; source?: string }) {
  const id = b.id && ID.test(b.id) ? b.id : newId("say");
  const cur = items.get(ctx.db(), id);
  if (cur?.status === "filed" && cur.results) return cur;   // a resend
  const results: any[] = [];
  for (const it of (b.items ?? []).slice(0, 12)) {
    try { results.push({ n: it.n ?? results.length, title: it.title, detail: it.detail, ok: true, ...(await runAction(ctx, String(it.action), it.args ?? {}, b.by ?? "you", b.source ?? "voice")) }); }
    catch (e: any) { results.push({ n: it.n ?? results.length, title: it.title, detail: it.detail, ok: false, action: it.action, app: it.app, error: String(e?.message ?? e).slice(0, 200) }); }
  }
  return save(ctx, { id, kind: "say", status: "filed", source: b.source ?? "voice", text: b.text ? String(b.text).slice(0, 4000) : null, title: "Said", results,
    filed: { at: new Date().toISOString(), by: b.by ?? "you" }, created_at: cur?.created_at ?? new Date().toISOString() });
}

// ── share-in: she files it the moment it arrives and tells him after (DECISIONS 2) ──
export async function share(ctx: JobCtx, b: ClassifyIn & { title?: string }) {
  const id = b.id && ID.test(String(b.id)) ? String(b.id) : newId("sh");
  const db = ctx.db();
  const prior = items.get(db, id);
  if (prior?.filed) return prior;   // the extension retried
  const text = String(b.text ?? "").trim();
  const url = (typeof b.url === "string" && b.url.trim()) || firstUrl(text);
  const hasImage = !!(b.image || b.images?.length);
  // plain text with no link and no picture: what he said, filed per app (a task, a note, an expense…)
  if (!hasImage && !url && text) {
    const p = await plan(ctx, text).catch(() => null);
    const list = p?.items?.length ? p.items : [{ action: "task", app: "today", title: "Task", detail: text.slice(0, 120), args: { title: text.split("\n")[0].slice(0, 300), notes: text.length > 300 ? text : null } }];
    const done = await apply(ctx, { id, text, items: list, by: "wyn", source: "share" });
    const said = done.results.filter((r: any) => r.ok).map((r: any) => r.where).join(", ");
    await ctx.push("Shared in", said ? `Filed: ${said}. Undo in the app.` : "In your inbox.", { link: `agenticos://capture/share/${id}` }).catch(() => {});
    return save(ctx, { id, source: "share", reply: p?.reply ?? null });
  }
  const item = await classify(ctx, { ...b, id, text, url: url ?? undefined, source: "share" });
  let filed: Filed | null = null;
  try {
    if (item.kind === "reel" || item.kind === "link") {
      const c = await contentIdea(ctx, item.fields?.title ?? item.title ?? url ?? "Shared", item.fields?.url ?? url ?? null, "share");
      filed = { app: "content", action: "add_content_idea", at: new Date().toISOString(), by: "wyn", ref: c.ref, undo: c.undo, where: "Content · Ideas" };
    } else if (item.kind === "document") {
      const r = await runAction(ctx, "note", { text: `${item.title}: ${item.fields?.text ?? item.summary ?? ""}`.slice(0, 4000), aspect: item.fields?.aspect ?? null }, "wyn", "share");
      if (!r.phone) filed = r;
    }
  } catch (e: any) { ctx.log(`share ${id}: filing failed: ${e?.message ?? e}`); }
  // the nine apps file on the phone (their scan handlers): it waits as "ready" and the lens files it on the next open
  const doc = save(ctx, { id, ...(filed ? { status: "filed", filed, app: filed.app } : {}), note: b.note ?? item.note ?? null });
  await ctx.push("Shared in", filed ? `${item.title} → ${filed.where}. Undo in the app.` : `${item.title}: ready to file in ${KINDS[item.kind as Kind]?.where ?? "the app"}.`, { link: `agenticos://capture/share/${id}` }).catch(() => {});
  return doc;
}

// ── the agent's tools ──
const recent = (ctx: JobCtx, n = 20) => items.list(ctx.db()).items.filter((x: any) => !x.deleted_at).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, n);
const tools: AgentTool[] = [
  { name: "scan_recent", auto: true, description: "What he scanned, shared or said to file lately: kind, what it read, where it went (or that it waits), and whether it can be undone.",
    input: { type: "object", properties: { limit: { type: "number" }, waiting: { type: "boolean", description: "only the ones not filed yet" } } },
    run: async (ctx, a) => recent(ctx, Math.min(50, Number(a?.limit) || 15)).filter((x: any) => !a?.waiting || x.status === "ready")
      .map((x: any) => ({ id: x.id, kind: x.kind, status: x.status, title: x.title, summary: x.summary, source: x.source, at: x.created_at, filed: x.filed ? { app: x.filed.app, where: x.filed.where, undo: !!x.filed.undo } : null, results: x.results?.map((r: any) => ({ ok: r.ok, where: r.where, undo: !!r.undo })) })) },
  { name: "scan_file", auto: true, description: "Files a scan or share that is waiting: reels and links to Content ideas, documents to the Brain, anything as a task. Other kinds are filed by their app when he opens it.",
    input: { type: "object", required: ["id"], properties: { id: { type: "string" }, as: { type: "string", enum: ["content", "note", "task"] } } },
    run: async (ctx, a) => {
      const it = items.get(ctx.db(), String(a.id));
      if (!it) throw new Error("No such scan.");
      const as = a.as ?? (it.kind === "reel" || it.kind === "link" ? "content" : it.kind === "document" ? "note" : null);
      if (!as) return { ok: false, waiting: true, said: `The ${KINDS[it.kind as Kind]?.label ?? "scan"} is filed by its app when he opens it.` };
      const args = as === "content" ? { title: it.fields?.title ?? it.title, url: it.fields?.url ?? it.url } : as === "note" ? { text: `${it.title}: ${it.fields?.text ?? it.summary ?? ""}` } : { title: it.title, notes: it.summary };
      const r = await runAction(ctx, as, args, "wyn", it.source ?? "scan");
      return save(ctx, { id: it.id, status: r.phone ? it.status : "filed", filed: r.phone ? it.filed ?? null : r, app: r.app });
    } },
  { name: "scan_undo", auto: true, description: "Undoes what was filed from a scan, share or voice note (by its id; `n` picks one entry of a voice note).",
    input: { type: "object", required: ["id"], properties: { id: { type: "string" }, n: { type: "number" } } },
    run: async (ctx, a) => undoItem(ctx, String(a.id), a.n),
  },
];
async function undoItem(ctx: JobCtx, id: string, n?: number) {
  const it = items.get(ctx.db(), id);
  if (!it) throw new Error("No such scan.");
  if (it.kind === "say") {
    const results = [...(it.results ?? [])];
    const errors: string[] = [];
    // each entry on its own: one that can't be undone doesn't hold back the rest
    for (const r of results) if ((n == null || r.n === Number(n)) && r.ok && r.undo && !r.undone) {
      try { await undo(ctx, r.undo); r.undone = true; } catch (e: any) { errors.push(`${r.title}: ${e?.message ?? e}`); }
    }
    const all = results.every((r) => !r.ok || r.undone);
    const doc = save(ctx, { id, results, status: all ? "undone" : it.status });
    if (errors.length && !results.some((r) => r.undone)) throw new Error(errors.join("; "));
    return { ...doc, errors };
  }
  if (it.filed?.undo && !it.filed.undone) await undo(ctx, it.filed.undo);
  return save(ctx, { id, status: "undone", filed: it.filed ? { ...it.filed, undone: true } : null });
}

export const scan: Module = {
  name: "scan",
  tools,
  async handle(ctx: ModCtx) {
    const { path: p, method: m } = ctx;
    let mm: RegExpMatchArray | null;
    if (p === "/" && m === "GET") return ctx.json({ ok: true, module: "scan" });
    if (p === "/kinds" && m === "GET") return ctx.json({ kinds: Object.entries(KINDS).map(([kind, k]) => ({ kind, ...k })) });
    if (p === "/status" && m === "GET") {
      const d = await dictationStatus();
      let ffmpeg = false;
      try { ffmpeg = (await Bun.spawn(["ffmpeg", "-version"], { stdout: "ignore", stderr: "ignore" }).exited) === 0; } catch {}
      return ctx.json({ transcription: d, classify: { engine: "codex", login: d.login, model: ctx.conf("SCAN_MODEL", "gpt-6-luna"), effort: ctx.conf("SCAN_EFFORT", "low"),
        running, waiting: waiting.length, recentMs: lastMs }, ffmpeg });
    }
    if (p === "/classify" && m === "POST") {
      const b = await ctx.body();
      if (!b || typeof b !== "object") return ctx.fail(400, "Send a JSON body.");
      return ctx.json({ item: await classify(ctx, b) });
    }
    if (p === "/share" && m === "POST") {
      const b = await ctx.body();
      if (!b?.text && !b?.url && !b?.image && !b?.images?.length) return ctx.fail(400, "Nothing to share.");
      return ctx.json({ item: await share(ctx, b) }, 201);
    }
    if (p === "/say" && m === "POST") {
      const b = await ctx.body();
      const text = String(b?.text ?? "").trim();
      if (!text) return ctx.fail(400, "Say something first.");
      return ctx.json(await plan(ctx, text));
    }
    if (p === "/say/apply" && m === "POST") {
      const b = await ctx.body();
      if (!Array.isArray(b?.items) || !b.items.length) return ctx.fail(400, "Nothing ticked.");
      return ctx.json({ item: await apply(ctx, b) });
    }
    if ((mm = p.match(/^\/items\/([A-Za-z0-9_.:-]{1,80})\/undo$/)) && m === "POST") {
      const b = await ctx.body().catch(() => ({}));
      try { return ctx.json({ item: await undoItem(ctx, mm[1], b?.n) }); } catch (e: any) { return ctx.fail(409, String(e?.message ?? e)); }
    }
    if ((mm = p.match(/^\/images\/([A-Za-z0-9_.:-]{1,80})(?:\/(\d))?$/)) && m === "GET") {
      const f = imageFiles(ctx, mm[1])[Number(mm[2] ?? 0)];
      if (!f) return ctx.fail(404, "No image.");
      const ext = f.split(".").pop()!;
      return new Response(readFileSync(f), { headers: { "Content-Type": ext === "jpg" ? "image/jpeg" : `image/${ext}`, "Cache-Control": "private, max-age=86400" } });
    }
    return (await items.handle(ctx, "/items")) ?? null;
  },
};

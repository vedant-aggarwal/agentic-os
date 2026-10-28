// Every app's tools, for her (Wyn; the product's Wyn). Each server module lists AgentTools (server/modules/types.ts);
// this file gathers them into one catalog with names she can call, decides per tool whether she does it on her own or
// asks first, runs it with a module context, and records every run in her day (wyn-feed.ts), with Undo when the
// tool says how.
//
// On her own or asks first (DECISIONS 2):
// - A tool's own `auto` flag is the default: low-stakes and reversible runs alone and is reported after; the rest asks.
// - Hard tools always ask, whatever the settings: the module says so with `risk` (spends_money, reaches_others,
//   deletes_data, irreversible), or, for a tool that isn't auto, its name says it (pay, buy, send, delete…).
// - He sets her autonomy per app: off (she never uses that app), ask (she asks before anything there), normal (each
//   tool's flag), trusted (everything that isn't hard runs on her own). Per tool he can also pick auto, ask or off.
// Conventions for module authors (also in notes/agent.md):
// - A tool's result may carry `say` or `title` (one line for her day), and `undo: { tool, args }` (a tool of the same
//   module that puts it back; Undo runs it without asking). Read-only tools named `summary` (or ending in `_summary`)
//   feed her heartbeat every 15 minutes: return { line, gaps?, streaks? } from real data.
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AgentTool, JobCtx, Module } from "./modules/types";
import type { User } from "./auth";
import type { Store } from "./store";
import type { AI } from "./ai";
import { ApiError } from "./store";
import { configFor } from "./config";
import { runCodex } from "./codex";
import { addItem, CORE_APP, updateItem, type Item } from "./wyn-feed";
import { requireYes, type Risk } from "./wyn-policy";

export type Autonomy = "off" | "ask" | "normal" | "trusted";
export type Mode = "auto" | "ask" | "off";
export const AUTONOMY: Autonomy[] = ["off", "ask", "normal", "trusted"];
export type Entry = { name: string; module: string; app: string; tool: AgentTool; hard: boolean; risks: Risk[]; summary: boolean };
type Prefs = { apps: Record<string, Autonomy>; tools: Record<string, Mode> };

// ── the modules: the same MODULES the server routes (one module instance per process) ──
let mods: Module[] | null = null;
let modsAt = 0;
/** Loaded lazily, so this file never sits in an import cycle with the modules. */
export async function modules(): Promise<Module[]> {
  if (mods && Date.now() - modsAt < 60_000) return mods;
  try { mods = (await import("./modules")).MODULES; } catch (e) { console.error("[agent-tools] modules failed to load", e); mods = mods ?? []; }
  modsAt = Date.now();
  return mods;
}
/** For tests: a fixed set of modules. */
export function useModules(m: Module[]) { mods = m; modsAt = Date.now() + 1e12; }

// The nine aspects keep their own names; the rest are apps of their own.
const APP_OF: Record<string, string> = { people: "friends" };
const SAFE = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_").slice(0, 64);
const HARD_WORDS: [RegExp, Risk][] = [
  [/(^|_)(pay|payment|purchase|buy|order|transfer|checkout|tip|donate|subscribe)(_|$)/i, "spends_money"],
  // allow_*: widening whom she may message is his call, never one she can raise for herself
  [/(^|_)(send|message|email|mail|invite|post|publish|share|text|whatsapp|dm|tweet|reply|book|call|add_person|new_person|allow|allow_messages)(_|$)/i, "reaches_others"],
  [/(^|_)(delete|remove|drop|purge|wipe|erase|destroy|clear|forget)(_|$)/i, "deletes_data"],
];
// …and what a tool that isn't auto says about itself
const HARD_DESC: [RegExp, Risk][] = [
  [/\b(spends?|pays?|payment|purchase|buys?|money out|transfers? money)\b/i, "spends_money"],
  [/\b(reach(es)? (a )?new|someone new|new person|sends? (a )?message|messages? (to )?(someone|them|people)|posts? (it )?publicly|public(ly)?\b|invites?)\b/i, "reaches_others"],
  [/\b(delet(e|es|ing)|removes? (it|one|a)|forget (a|one|it)|erases?|wipes?)\b/i, "deletes_data"],
  [/\b(can'?t be undone|cannot be undone|irreversible|permanent(ly)?)\b/i, "irreversible"],
];
const RISKS = new Set<Risk>(["spends_money", "reaches_others", "deletes_data", "irreversible", "pushes_main", "cancels_his_event"]);
/** One catalog for every module's tools: unique names (module_tool), the app each belongs to, and how hard each is. */
export function catalogOf(list: Module[]): Entry[] {
  const out: Entry[] = [], seen = new Set<string>();
  for (const m of list) {
    for (const t of Array.isArray(m.tools) ? m.tools : []) {
      if (!t || typeof t.name !== "string" || typeof t.run !== "function") continue;
      let name = SAFE(t.name.startsWith(`${m.name}_`) ? t.name : `${m.name}_${t.name}`);
      for (let i = 2; seen.has(name); i++) name = SAFE(`${m.name}_${t.name}_${i}`);
      seen.add(name);
      const own = [...((t as any).risk ?? []), ...((t as any).risks ?? [])].filter((r: any) => RISKS.has(r)) as Risk[];
      const guessed = t.auto ? [] : [...HARD_WORDS.filter(([re]) => re.test(t.name)), ...HARD_DESC.filter(([re]) => re.test(String(t.description ?? "")))].map(([, r]) => r);
      const risks = [...new Set([...own, ...guessed])];
      out.push({ name, module: m.name, app: APP_OF[m.name] ?? m.name, tool: t, hard: risks.length > 0, risks, summary: false });
    }
  }
  // one summary per module for her heartbeat: its `summary` tool, else one named status, overview or today
  for (const mod of new Set(out.map((e) => e.module))) {
    const mine = out.filter((e) => e.module === mod && e.tool.auto !== false);
    const pick = mine.find((e) => /^summary$/i.test(e.tool.name) || /_summary$/i.test(e.tool.name))
      ?? mine.find((e) => /^(?:\w+_)?status$/i.test(e.tool.name)) ?? mine.find((e) => /^(?:\w+_)?overview$/i.test(e.tool.name)) ?? mine.find((e) => /^(?:\w+_)?today$/i.test(e.tool.name));
    if (pick) pick.summary = true;
  }
  return out;
}
export async function catalog() { return catalogOf(await modules()); }

// ── his settings: autonomy per app and per tool, kept in her prefs ──
const prefGet = (n: Database, k: string) => ((n.query("SELECT value FROM prefs WHERE key = ?").get(k) as any)?.value ?? "") as string;
const prefSet = (n: Database, k: string, v: string) => n.query("INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);
const parse = (s: string) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };
export function autonomyOf(n: Database): Prefs { return { apps: parse(prefGet(n, "autonomy.apps")), tools: parse(prefGet(n, "autonomy.tools")) }; }
export function setAutonomy(n: Database, b: { app?: string; level?: string; tool?: string; mode?: string | null }) {
  const p = autonomyOf(n);
  if (b.app != null) {
    const app = String(b.app).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30);
    if (!app || !AUTONOMY.includes(b.level as Autonomy)) throw new ApiError(400, "Send { app, level: off | ask | normal | trusted }.");
    if (b.level === "normal") delete p.apps[app]; else p.apps[app] = b.level as Autonomy;
    prefSet(n, "autonomy.apps", JSON.stringify(p.apps));
  }
  if (b.tool != null) {
    const tool = SAFE(String(b.tool));
    if (b.mode == null || b.mode === "" || b.mode === "default") delete p.tools[tool];
    else if (["auto", "ask", "off"].includes(String(b.mode))) p.tools[tool] = b.mode as Mode;
    else throw new ApiError(400, "Send { tool, mode: auto | ask | off | default }.");
    prefSet(n, "autonomy.tools", JSON.stringify(p.tools));
  }
  return autonomyOf(n);
}
/** What she does with one tool now: on her own, ask first, or not at all. Hard tools can never be raised to auto. */
export function modeOf(e: { name: string; app: string; hard: boolean; tool: { auto?: boolean } }, p: Prefs): Mode {
  const app = p.apps[e.app] ?? "normal", own = p.tools[e.name];
  if (app === "off" || own === "off") return "off";
  if (e.hard) return "ask";
  if (own) return own;
  if (app === "ask") return "ask";
  if (app === "trusted") return "auto";
  return e.tool.auto ? "auto" : "ask";
}

// ── her built-in tools (wyn-tools.ts) under the same per-app settings ──
export const CORE_READS = new Set(["overview", "find_tasks", "goals", "life", "recall", "memories", "brain_ask", "brain_search", "brain_read", "sessions", "session_read",
  "dispatches", "read_journal", "list_ideas", "list_calls", "read_call", "calendar_find", "my_work"]);
/** Built-in tools that always ask (their own policy check, or her rules: give_to_claude only after his yes). */
export const CORE_ASKS = new Set(["drop_task", "give_to_claude", "calendar_cancel"]);
export function coreModeOf(name: string, p: Prefs): Mode {
  if (CORE_READS.has(name)) return "auto";
  const app = CORE_APP[name] ?? "agent", level = p.apps[app] ?? "normal", own = p.tools[name];
  if (level === "off" || own === "off") return "off";
  if (CORE_ASKS.has(name)) return "ask";
  if (own) return own;
  if (level === "ask") return "ask";
  return "auto";
}
/** A built-in write under his settings: off is refused; ask asks first (once approved, it goes through). Tools with a
 * policy check of their own (drop_task, calendar invites) still run it inside. null means go ahead. */
export async function gateCore(n: Database, name: string, args: any, turn: string, approval?: string) {
  const mode = coreModeOf(name, autonomyOf(n));
  if (mode === "off") return { error: `${pretty(name)} is switched off in his settings for ${CORE_APP[name] ?? "this app"}.` };
  if (mode === "ask" && !CORE_ASKS.has(name)) {
    const { approval: _a, ...rest } = args ?? {};
    const what = typeof rest.title === "string" ? `: “${rest.title}”` : typeof rest.text === "string" ? `: “${String(rest.text).slice(0, 60)}”` : "";
    return requireYes({ n, turn }, { tool: name, args: rest, risks: ["needs_his_ok"], summary: `${pretty(name)}${what}` }, approval ?? args?.approval);
  }
  return null;
}

// ── a module context, the same shape index.ts gives module requests and jobs ──
const ROOT = join(import.meta.dir, "..");
let confFn: ((k: string, d: string) => string) | null = null;
export function conf(k: string, d: string) {
  if (!confFn) {
    const p = join(import.meta.dir, "config.json");
    let cfg: any = {};
    try { if (existsSync(p)) cfg = JSON.parse(readFileSync(p, "utf8")); } catch {}
    confFn = configFor(cfg);
  }
  return confFn(k, d);
}
export type CtxDeps = { storeFor: (u: User) => Store; ai: AI; dataDir: string; wyn: () => any; push: (u: User, title: string, body: string, data?: Record<string, unknown>) => Promise<void> };
/** index.ts can hand over its own modBase (one line: wyn.useModuleContext((u, mod) => modBase(u, mod, true))). */
let external: ((u: User, mod: Module) => { ctx: JobCtx; close: () => void }) | null = null;
export function useModuleContext(fn: typeof external) { external = fn; }
function agentosRunner(u: User) {
  const src = conf("AGENTOS_SRC", ""), bin = conf("AGENTOS_BIN", "agentos");
  const contentDb = (u.role === "owner" && conf("AGENTOS_CONTENT_DB", "")) || join(dirname(u.agentos_db), "content.db");
  return async (args: string[]) => {
    const argv = args.map(String);
    if (!argv.includes("--json")) argv.push("--json");
    const p = Bun.spawn([...(src ? [process.execPath, src] : [bin]), ...argv], { env: { ...process.env, AGENTOS_DB: u.agentos_db, AGENTOS_CONTENT_DB: contentDb }, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), 60_000);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    clearTimeout(timer);
    await p.exited;
    if (p.exitCode !== 0) throw new ApiError(p.exitCode === 2 ? 400 : 502, (err || out).trim().split("\n").filter(Boolean).at(-1)?.slice(0, 300) || `agentos ${argv[0]} failed.`);
    const text = out.trim();
    return text ? JSON.parse(text) : null;
  };
}
export function moduleCtx(d: CtxDeps, u: User, mod: Module): { ctx: JobCtx; close: () => void } {
  if (external) return external(u, mod);
  let dbh: Database | null = null;
  const ctx: JobCtx = {
    user: u, owner: u.role === "owner", store: d.storeFor(u), dbPath: u.agentos_db,
    db: () => { if (!dbh) { dbh = new Database(u.agentos_db); dbh.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;"); } return dbh; },
    contentDbPath: (u.role === "owner" && conf("AGENTOS_CONTENT_DB", "")) || join(dirname(u.agentos_db), "content.db"),
    ai: d.ai, codex: runCodex, agentos: agentosRunner(u), push: (title, body, data) => d.push(u, title, body, data),
    wyn: d.wyn(), conf, dataDir: conf("DATA_DIR", join(ROOT, "data")), log: (msg) => console.log(`[mod:${mod.name}] ${msg}`),
  };
  return { ctx, close: () => { try { dbh?.close(); } catch {} dbh = null; } };
}

// ── running a tool ──
const pretty = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const withTimeout = <T>(p: Promise<T>, ms: number, what: string) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new ApiError(504, `${what} took too long.`)), ms))]);
/** Light argument check against the tool's JSON Schema: required fields present, and the types of the simple ones. */
export function checkArgs(schema: any, args: any): string | null {
  if (!schema || typeof schema !== "object") return null;
  if (args == null || typeof args !== "object" || Array.isArray(args)) return "Arguments are an object.";
  for (const k of Array.isArray(schema.required) ? schema.required : []) if (args[k] === undefined || args[k] === null || args[k] === "") return `${k} is required.`;
  for (const [k, s] of Object.entries<any>(schema.properties ?? {})) {
    const v = args[k];
    if (v === undefined || v === null || !s?.type) continue;
    const types = [].concat(s.type);
    const ok = types.some((t: string) => t === "number" || t === "integer" ? typeof v === "number" && (t !== "integer" || Number.isInteger(v))
      : t === "array" ? Array.isArray(v) : t === "object" ? typeof v === "object" && !Array.isArray(v) : t === "null" ? v === null : typeof v === t);
    if (!ok) return `${k} should be ${types.join(" or ")}.`;
    if (Array.isArray(s.enum) && !s.enum.includes(v)) return `${k} is one of ${s.enum.join(", ")}.`;
  }
  return null;
}
/** One line for her day from what a tool returned. */
export function lineOf(e: Entry, args: any, result: any) {
  for (const k of ["say", "tell", "title", "summary", "line", "message"]) if (typeof result?.[k] === "string" && result[k].trim()) return result[k].trim().replace(/\s*Undo: \S+ \S+\.?$/, "").slice(0, 160);
  const what = Object.values(args ?? {}).filter((v) => typeof v === "string" || typeof v === "number").slice(0, 2).join(", ");
  return `${pretty(e.tool.name)}${what ? `: ${String(what).slice(0, 80)}` : ""}`;
}

export type RunOpts = { approval?: string; source?: string; turn?: string; beat?: string; title?: string; why?: string; tapped?: boolean };
export type RunEnv = CtxDeps & { n: (u: User) => Database };
/**
 * Runs one module tool for her, through his settings and the policy:
 * off → refused · ask (no approval yet) → needs_yes with an approval id, and a one-tap ask in her day · auto, or an
 * approved ask → it runs, and a did item records it (with Undo when the tool returned one).
 */
export async function runModuleTool(env: RunEnv, u: User, name: string, rawArgs: any, o: RunOpts = {}) {
  const list = await catalog();
  const e = list.find((x) => x.name === name) ?? list.find((x) => x.tool.name === name);
  if (!e) return { error: `No tool ${name}.` };
  const n = env.n(u);
  const args = { ...(rawArgs ?? {}) };
  const approval = o.approval ?? args.approval;
  delete args.approval;
  const mode = modeOf(e, autonomyOf(n));
  if (mode === "off") return { error: `${pretty(e.tool.name)} is switched off in ${e.app}. He can turn it back on in her tools page.` };
  const bad = checkArgs(e.tool.input, args);
  if (bad) return { error: bad };
  // what the one-tap ask says when she didn't word it: the action and its arguments ("Set budget: food, 6000")
  const what = Object.entries(args).filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean").map(([, v]) => String(v)).join(", ").slice(0, 90);
  const title = (o.title ?? `${pretty(e.tool.name)}${what ? `: ${what}` : ""}`).slice(0, 160);
  if (mode === "ask") {
    const asked = await requireYes({ n, turn: o.turn ?? "tool" }, { tool: e.name, args, risks: e.risks.length ? e.risks : ["needs_his_ok"], summary: o.title ?? title }, approval);
    if (asked) return asked;
  }
  const { ctx, close } = moduleCtx(env, u, (await modules()).find((m) => m.name === e.module)!);
  let result: any;
  try { result = await withTimeout(Promise.resolve(e.tool.run(ctx, args)), 90_000, pretty(e.tool.name)); }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addItem(n, { kind: "did", status: "failed", app: e.app, title: `Couldn't ${pretty(e.tool.name).toLowerCase()}`, text: msg.slice(0, 300), source: o.source ?? "tool", turn: o.turn ?? null, beat: o.beat ?? null, tool: e.name, args });
    return { error: msg };
  } finally { close(); }
  if (result && typeof result === "object" && "error" in result && result.error) return result;
  // undo: { tool, args } (or the arguments beside the tool name: { tool, id })
  const un = result?.undo && typeof result.undo === "object" && typeof result.undo.tool === "string" ? result.undo : null;
  const undo = un ? { tool: un.tool, args: un.args ?? Object.fromEntries(Object.entries(un).filter(([k]) => k !== "tool" && k !== "module")), module: e.module } : null;
  const item = addItem(n, { kind: "did", app: e.app, title: lineOf(e, args, result), text: o.why ?? (typeof result?.detail === "string" ? result.detail : null), source: o.source ?? "tool",
    turn: o.turn ?? null, beat: o.beat ?? null, tool: e.name, args, result: compact(result), undo, meta: o.tapped ? { tapped: true } : null });
  return { ...(result && typeof result === "object" && !Array.isArray(result) ? result : { result }), feed: item.id };
}
const compact = (r: any) => { const s = JSON.stringify(r ?? null); return s.length > 4000 ? { cut: s.slice(0, 4000) } : r; };

/** Puts back what a did item changed: the module's own undo tool, run directly (he tapped Undo on her own action). */
export async function undoModuleItem(env: RunEnv, u: User, item: Item) {
  const n = env.n(u);
  const un = item.undo;
  if (!un?.tool) return { error: "This one can't be undone from here. Open the app it's in." };
  const list = await catalog();
  const e = list.find((x) => x.module === un.module && (x.tool.name === un.tool || x.name === un.tool)) ?? list.find((x) => x.name === un.tool);
  if (!e) return { error: `The undo tool ${un.tool} isn't there any more.` };
  const { ctx, close } = moduleCtx(env, u, (await modules()).find((m) => m.name === e.module)!);
  try { await withTimeout(Promise.resolve(e.tool.run(ctx, un.args ?? {})), 60_000, "Undo"); }
  catch (err) { return { error: err instanceof Error ? err.message : String(err) }; }
  finally { close(); }
  return { item: updateItem(n, item.id, { status: "undone", decided_at: new Date().toISOString() }) };
}

/** Read-only summaries for the heartbeat: every module's summary tool that may run on her own, with a short timeout. */
export async function summaries(env: RunEnv, u: User, { timeoutMs = 8000 } = {}) {
  const n = env.n(u), p = autonomyOf(n);
  const list = (await catalog()).filter((e) => e.summary && modeOf(e, p) !== "off");
  const out: Record<string, any> = {};
  await Promise.all(list.map(async (e) => {
    const { ctx, close } = moduleCtx(env, u, (await modules()).find((m) => m.name === e.module)!);
    try { out[e.app] = cut(await withTimeout(Promise.resolve(e.tool.run(ctx, {})), timeoutMs, "summary")); }
    catch (err) { out[e.app] = { error: err instanceof Error ? err.message.slice(0, 120) : "failed" }; }
    finally { close(); }
  }));
  return out;
}
const cut = (r: any) => { const s = JSON.stringify(r ?? null); return s.length > 1500 ? JSON.parse(JSON.stringify({ line: r?.line ?? null, cut: s.slice(0, 1400) })) : r; };

/** For her MCP server and her prompts: the tools she may use now, with how she may use each. */
export async function mcpList(n: Database) {
  const p = autonomyOf(n);
  return (await catalog()).map((e) => ({ e, mode: modeOf(e, p) })).filter((x) => x.mode !== "off").map(({ e, mode }) => ({
    name: e.name,
    description: `[${e.app}] ${e.tool.description}${mode === "auto" ? " (You may do this on your own when it clearly helps; say what you did in one line.)"
      : " (Asks first: the first call returns needs_yes with an approval id and a question. Ask him, stop, and only after his yes call it again with the same arguments plus approval.)"}`,
    inputSchema: withApproval(e.tool.input),
  }));
}
const withApproval = (s: any) => {
  const base = s && typeof s === "object" ? s : { type: "object", properties: {} };
  return { ...base, type: "object", properties: { ...(base.properties ?? {}), approval: { type: "string", description: "Only after he said yes: the approval id the first call gave you." } } };
};

/** The tools page: every app's tools with how she uses each, and when she last did. */
export async function toolsPage(n: Database) {
  const p = autonomyOf(n);
  const used = new Map<string, string>();
  try { for (const r of n.query("SELECT tool, max(at) at FROM feed WHERE tool IS NOT NULL GROUP BY tool").all() as any[]) used.set(r.tool, r.at); } catch {}
  const list = await catalog();
  const apps = new Map<string, any>();
  for (const e of list) {
    const a = apps.get(e.app) ?? { id: e.app, module: e.module, autonomy: p.apps[e.app] ?? "normal", tools: [] as any[] };
    a.tools.push({ name: e.name, tool: e.tool.name, title: pretty(e.tool.name), description: e.tool.description, auto: !!e.tool.auto, hard: e.hard, risks: e.risks,
      mode: modeOf(e, p), own: p.tools[e.name] ?? null, lastUsed: used.get(e.name) ?? null, summary: e.summary });
    apps.set(e.app, a);
  }
  return { apps: [...apps.values()], used };
}

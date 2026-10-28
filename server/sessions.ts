// Wyn's view of the coding sessions on this PC: Claude Code (the desktop app, terminal and background agents)
// and Codex. She can list them, read where they are, and hand one a prompt; the dispatcher in wyn.ts runs it.
// How a prompt gets in:
// - Claude, running anywhere (Claude app, terminal, background): the wyn plugin's listener in that session
//   (wyn-plugin/) wakes it with the prompt, and its Stop hook brings the reply back.
// - Claude, not running: `claude -p --resume <id>` in the session's folder.
// - Codex: `codex exec resume <id>` in the session's folder.
// - New Claude session: a background agent (`claude --bg`), which loads the plugin too.
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const CLAUDE_DIR = join(HOME, ".claude"), CODEX_DIR = join(HOME, ".codex");
export const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
export const CODEX_BIN = process.env.CODEX_BIN || "codex";

export type Session = { id: string; tool: "claude" | "codex"; title: string; cwd: string; updatedAt: string;
  live: boolean; where: "app" | "terminal" | "background" | "closed"; appId?: string; state?: string; path: string };

/** The last `bytes` of a file, split into JSON lines (the first, partial line is dropped). */
function tailLines(path: string, bytes = 600_000) {
  const size = statSync(path).size, start = Math.max(0, size - bytes);
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(size - start);
  readSync(fd, buf, 0, buf.length, start);
  closeSync(fd);
  const lines = buf.toString("utf8").split("\n");
  if (start > 0) lines.shift();
  const out: any[] = [];
  for (const l of lines) { if (!l.trim()) continue; try { out.push(JSON.parse(l)); } catch {} }
  return out;
}
/** The first JSON line of a file. Codex's session_meta line carries its whole system prompt, often well over 16 KB. */
const headCache = new Map<string, any>();
const headLine = (path: string) => {
  if (headCache.has(path)) return headCache.get(path);
  const fd = openSync(path, "r");
  const parts: Buffer[] = [];
  let pos = 0, line: string | null = null;
  try {
    while (pos < 2_000_000) {
      const buf = Buffer.alloc(65_536);
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (n <= 0) break;
      const chunk = buf.subarray(0, n), nl = chunk.indexOf(10);
      if (nl >= 0) { parts.push(chunk.subarray(0, nl)); line = Buffer.concat(parts).toString("utf8"); break; }
      parts.push(chunk);
      pos += n;
    }
  } finally { closeSync(fd); }
  let out = null;
  try { out = JSON.parse(line ?? Buffer.concat(parts).toString("utf8")); } catch {}
  if (out) headCache.set(path, out);
  return out;
};
const skipCwd = (cwd: string) => /\\AppData\\Local\\Temp\\|[\\/]data[\\/]wyn[\\/]user-|t3code-claude-title/i.test(cwd);

// ── Claude ──
let liveCache = { at: 0, rows: [] as any[], ok: false };
let liveRefresh: Promise<any[]> | null = null;
/** `claude agents --json`, kept 20 s. stale: an older answer comes back at once and is renewed in the background
 *  (the phone's project pages and lists; ~1.5 s per run otherwise). Without it, a caller waits for a fresh one. */
async function claudeLive({ stale = false } = {}) {
  if (Date.now() - liveCache.at < 20_000) return liveCache.rows;
  if (!stale) return readLive();
  liveRefresh ??= readLive().finally(() => { liveRefresh = null; });
  return liveCache.at ? liveCache.rows : liveRefresh;   // the very first answer is waited for (once, shared)
}
async function readLive() {
  try {
    const p = Bun.spawn([CLAUDE_BIN, "agents", "--json"], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), 20_000);
    const text = await new Response(p.stdout).text();
    clearTimeout(timer);
    liveCache = { at: Date.now(), rows: JSON.parse(text), ok: true };
  } catch { liveCache = { at: Date.now(), rows: [], ok: false }; }
  return liveCache.rows;
}
/** Ids of the Claude sessions running right now, or null when `claude agents` couldn't say. */
export async function claudeLiveIds(): Promise<Set<string> | null> {
  const rows = await claudeLive();
  return liveCache.ok ? new Set(rows.map((r: any) => String(r.sessionId))) : null;
}
/** sessionId → the Claude app's own id (local_…) for sessions the app is running. */
function appIds() {
  const out = new Map<string, { appId: string; entry: string }>();
  const dir = join(CLAUDE_DIR, "sessions");
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const j = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (j.sessionId && j.hostSessionId) out.set(j.sessionId, { appId: j.hostSessionId, entry: j.entrypoint ?? "" });
    } catch {}
  }
  return out;
}
function claudeTranscripts(days: number) {
  const root = join(CLAUDE_DIR, "projects"), since = Date.now() - days * 864e5, out: { id: string; path: string; mtime: number }[] = [];
  if (!existsSync(root)) return out;
  for (const proj of readdirSync(root)) {
    if (/t3code-claude-title|AppData-Local-Temp/i.test(proj)) continue;
    let files: string[] = [];
    try { files = readdirSync(join(root, proj)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith(".jsonl")) continue;
      const path = join(root, proj, f), mtime = statSync(path).mtimeMs;
      if (mtime >= since) out.push({ id: f.slice(0, -6), path, mtime });
    }
  }
  return out;
}
const metaCache = new Map<string, { mtime: number; meta: { title: string; cwd: string } }>();
function claudeMeta(path: string) {
  const mtime = statSync(path).mtimeMs, hit = metaCache.get(path);
  if (hit && hit.mtime === mtime) return hit.meta;
  const meta = readClaudeMeta(path);
  metaCache.set(path, { mtime, meta });
  return meta;
}
function readClaudeMeta(path: string) {
  let title = "", cwd = "";
  for (const e of tailLines(path, 200_000).reverse()) {
    if (!title && e.type === "custom-title" && e.customTitle) title = e.customTitle;
    if (!title && e.type === "summary" && e.summary) title = e.summary;
    if (!cwd && e.cwd) cwd = e.cwd;
    if (title && cwd) break;
  }
  return { title, cwd };
}

// ── Codex ──
function codexIndex() {
  const out = new Map<string, { name: string; updated: string }>();
  const p = join(CODEX_DIR, "session_index.jsonl");
  if (!existsSync(p)) return out;
  for (const l of readFileSync(p, "utf8").split("\n")) {
    try { const j = JSON.parse(l); if (j.id) out.set(j.id, { name: j.thread_name ?? "", updated: j.updated_at ?? "" }); } catch {}
  }
  return out;
}
function codexRollouts(days: number) {
  const out: { id: string; path: string; mtime: number }[] = [];
  const root = join(CODEX_DIR, "sessions");
  for (let d = 0; d <= days; d++) {
    const day = new Date(Date.now() - d * 864e5);
    const dir = join(root, String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const m = f.match(/^rollout-.*-([0-9a-f-]{36})\.jsonl$/);
      if (m) out.push({ id: m[1], path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs });
    }
  }
  return out;
}

/** Sessions touched in the last `days`, newest first. stale: which are live may be up to one refresh old (claudeLive). */
export async function listSessions(days = 7, limit = 40, { stale = false } = {}): Promise<Session[]> {
  const live = await claudeLive({ stale }), apps = appIds();
  const liveById = new Map(live.map((r: any) => [r.sessionId, r]));
  const out: Session[] = [];
  for (const t of claudeTranscripts(days)) {
    const meta = claudeMeta(t.path), l: any = liveById.get(t.id), app = apps.get(t.id);
    const cwd = l?.cwd ?? meta.cwd;
    if (skipCwd(cwd)) continue;
    const where = !l ? "closed" : l.kind === "background" ? "background" : app?.entry === "claude-desktop" ? "app" : "terminal";
    out.push({ id: t.id, tool: "claude", title: l?.name || meta.title || "(untitled)", cwd, updatedAt: new Date(t.mtime).toISOString(),
      live: !!l, where, appId: where === "app" ? app?.appId : undefined, state: l?.state ?? undefined, path: t.path });
  }
  const idx = codexIndex();
  for (const r of codexRollouts(days)) {
    const meta = headLine(r.path)?.payload ?? {};
    if (skipCwd(meta.cwd ?? "") || meta.originator === "codex_exec" && /data[\\/]wyn/i.test(meta.cwd ?? "")) continue;
    const name = idx.get(r.id)?.name || "";
    out.push({ id: r.id, tool: "codex", title: name || firstCodexPrompt(r.path) || "(untitled)", cwd: meta.cwd ?? "", updatedAt: new Date(r.mtime).toISOString(),
      live: Date.now() - r.mtime < 5 * 60_000, where: "closed", path: r.path });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, limit);
}

export async function findSession(id: string, days = 30) {
  const key = String(id ?? "").trim().toLowerCase();
  if (key.length < 6) return null;
  return (await listSessions(days, 400)).find((s) => s.id.toLowerCase().startsWith(key)) ?? null;
}

const clean = (t: string) => t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
function firstCodexPrompt(path: string) {
  for (const e of tailLines(path, 80_000)) {
    const p = e.payload;
    if (e.type === "response_item" && p?.type === "message" && p.role === "user") {
      const t = (p.content ?? []).map((c: any) => c.text ?? "").join(" ").trim();
      if (t && !t.startsWith("<") && !t.startsWith("#")) return t.slice(0, 80);
    }
  }
  return "";
}

/** The last few turns of a session, text only (tool calls skipped). */
export function readSession(s: Session, last = 8) {
  const msgs: { who: "you" | "agent"; text: string; at?: string }[] = [];
  for (const e of tailLines(s.path)) {
    if (s.tool === "claude") {
      if (e.type !== "user" && e.type !== "assistant") continue;
      const c = e.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((x: any) => x.type === "text").map((x: any) => x.text).join("\n") : "";
      const t = clean(text);
      if (!t || (e.type === "user" && (e.isMeta || t.startsWith("<")))) continue;
      msgs.push({ who: e.type === "user" ? "you" : "agent", text: t.slice(0, 1500), at: e.timestamp });
    } else {
      const p = e.payload;
      if (e.type !== "response_item" || p?.type !== "message") continue;
      const t = clean((p.content ?? []).map((c: any) => c.text ?? "").join("\n"));
      if (!t || (p.role === "user" && (t.startsWith("<") || t.startsWith("# AGENTS.md")))) continue;
      msgs.push({ who: p.role === "user" ? "you" : "agent", text: t.slice(0, 1500), at: e.timestamp });
    }
  }
  return msgs.slice(-last);
}

/** Run a prompt in a session (or a new one) from the command line. Resolves with the agent's final reply. */
export async function runCli(job: { tool: string; sessionId: string | null; cwd: string; prompt: string }) {
  const cwd = job.cwd && existsSync(job.cwd) ? job.cwd : HOME;
  if (job.tool === "codex") {
    const args = job.sessionId ? ["exec", "resume", job.sessionId, "--json", "--skip-git-repo-check", "-"] : ["exec", "--json", "--skip-git-repo-check", "-"];
    const p = Bun.spawn([CODEX_BIN, ...args], { cwd, stdin: new Blob([job.prompt]), stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), 45 * 60_000);
    const texts: string[] = [];
    let thread: string | null = job.sessionId;
    for (const line of (await new Response(p.stdout).text()).split("\n")) {
      try {
        const e = JSON.parse(line);
        if (e.type === "thread.started") thread = e.thread_id;
        if (e.type === "item.completed" && e.item?.type === "agent_message") texts.push(String(e.item.text ?? ""));
      } catch {}
    }
    clearTimeout(timer);
    await p.exited;
    if (!texts.length) throw new Error((await new Response(p.stderr).text()).split("\n").filter(Boolean).slice(-3).join(" ") || "Codex gave no reply.");
    return { reply: texts.at(-1)!.trim(), sessionId: thread };
  }
  const args = ["-p", "--output-format", "json", "--permission-mode", "auto", ...(job.sessionId ? ["--resume", job.sessionId] : []), job.prompt];
  const p = Bun.spawn([CLAUDE_BIN, ...args], { cwd, stdout: "pipe", stderr: "pipe", env: cleanEnv() });
  const timer = setTimeout(() => p.kill(), 45 * 60_000);
  const out = await new Response(p.stdout).text();
  clearTimeout(timer);
  await p.exited;
  try {
    const j = JSON.parse(out);
    if (j.is_error) throw new Error(String(j.result ?? "Claude reported an error."));
    return { reply: String(j.result ?? "").trim(), sessionId: j.session_id ?? job.sessionId };
  } catch (e) {
    if (e instanceof Error && !/JSON/.test(e.message)) throw e;
    throw new Error((await new Response(p.stderr).text()).split("\n").filter(Boolean).slice(-3).join(" ") || "Claude gave no reply.");
  }
}
/** Claude refuses to start inside another Claude Code session's environment. */
function cleanEnv() {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v != null && !/^CLAUDECODE|^CLAUDE_CODE_/.test(k)) env[k] = v;
  return env;
}

/** Start a new Claude Code background agent with a prompt. Resolves with its session id once `claude agents` lists it. */
export async function runBg(job: { cwd: string; prompt: string; title: string }) {
  const cwd = job.cwd && existsSync(job.cwd) ? job.cwd : HOME;
  const p = Bun.spawn([CLAUDE_BIN, "--bg", "--name", job.title.slice(0, 60), "--permission-mode", "auto", job.prompt], { cwd, stdout: "pipe", stderr: "pipe", env: cleanEnv() });
  const out = `${await new Response(p.stdout).text()}\n${await new Response(p.stderr).text()}`;
  await p.exited;
  const short = out.match(/\b([0-9a-f]{8})\b/)?.[1];
  if (!short) throw new Error(out.trim().split("\n").slice(-2).join(" ") || "Claude didn't start.");
  for (let i = 0; i < 20; i++) {
    liveCache.at = 0;
    const row = (await claudeLive()).find((r: any) => r.id === short || String(r.sessionId ?? "").startsWith(short));
    if (row?.sessionId) return { sessionId: String(row.sessionId), short };
    await Bun.sleep(1500);
  }
  throw new Error(`Started ${short}, but it never showed up in claude agents.`);
}

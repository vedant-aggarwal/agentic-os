#!/usr/bin/env bun
// ribbon-watch: the PC watches itself, locally only. Every 30 s (RIBBON_EVERY) it takes what ribbon-sample.ps1
// reports (foreground window title, process, idle time), adds the git repo when the title carries a path, and the
// Claude session the phone server knows (from the wyn plugin hooks) that works in that repo, then posts batches to
// POST /api/v1/mod/ribbon/samples on loopback with the agent token. The server redacts and classifies; nothing
// leaves the PC. Start at logon with ribbon-watch.ps1.
//   AGENTIC_APP_PORT          the phone server's port (else PORT in server/config.json, else 8090)
//   RIBBON_EVERY (30)         seconds between samples
//   DATA_DIR (<repo>/data)    where agent.token lives           RIBBON_IDLE (300)   skip samples after this much idle time
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..", "..");
const configPort = () => { try { return String(JSON.parse(readFileSync(join(ROOT, "server", "config.json"), "utf8")).PORT ?? ""); } catch { return ""; } };
const PORT = process.env.AGENTIC_APP_PORT || configPort() || "8090";
const BASE = `http://127.0.0.1:${PORT}/api/v1`;
const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
const TOKEN_FILE = process.env.RIBBON_TOKEN_FILE || join(DATA_DIR, "agent.token");
const EVERY = Math.max(5, Number(process.env.RIBBON_EVERY) || 30);
const IDLE = Math.max(30, Number(process.env.RIBBON_IDLE) || 300);
const SAMPLER = join(import.meta.dir, "ribbon-sample.ps1");
const SKIP = /^(lockapp|logonui|searchhost|startmenuexperiencehost|shellexperiencehost|screenclippinghost|textinputhost)$/i;
const PATH_RE = /([A-Za-z]:\\[^\s"'<>|*?]+)/;
const CLAUDE_APP = /^claude$/i;
const log = (m: string) => console.log(`[ribbon-watch] ${new Date().toISOString().slice(11, 19)} ${m}`);

if (!existsSync(TOKEN_FILE)) { console.error(`No agent token at ${TOKEN_FILE}. Start the phone server first (it writes the token).`); process.exit(1); }
const token = readFileSync(TOKEN_FILE, "utf8").trim();
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

// ── git repo of a path, cached ──────────────────────────────────────────────
const GIT = ["git", "C:\\Program Files\\Git\\cmd\\git.exe", "C:\\Program Files\\Git\\bin\\git.exe"].find((g) => g === "git" ? !!Bun.which("git") : existsSync(g)) ?? "git";
const repoCache = new Map<string, { repo: string | null; at: number }>();
const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
function repoOf(path: string): string | null {
  let dir = path.replace(/[.,;:)\]]+$/, "");
  try { if (!statSync(dir).isDirectory()) dir = dirname(dir); } catch { dir = dirname(dir); if (!existsSync(dir)) return null; }
  const key = norm(dir), hit = repoCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.repo;
  let repo: string | null = null;
  try {
    const r = Bun.spawnSync([GIT, "-C", dir, "rev-parse", "--show-toplevel"], { timeout: 5_000, stdout: "pipe", stderr: "pipe" });
    const out = r.stdout.toString().trim();
    if (r.exitCode === 0 && out) repo = out.replace(/\//g, "\\");
  } catch {}
  repoCache.set(key, { repo, at: Date.now() });
  return repo;
}

// ── sessions the server knows from the hooks ────────────────────────────────
type Session = { id: string; cwd: string; live: boolean; activeAt: string | null };
let sessions: Session[] = [];
let sessionsAt = 0;
async function refreshSessions() {
  if (Date.now() - sessionsAt < EVERY * 1000 - 1000) return;
  sessionsAt = Date.now();
  try {
    const r = await fetch(`${BASE}/mod/ribbon/sessions`, { headers });
    const j: any = await r.json();
    if (r.ok && Array.isArray(j.sessions)) sessions = j.sessions.filter((s: Session) => s.live && s.cwd);
  } catch { /* the server is away; keep the last list */ }
}
const inRepo = (cwd: string, repo: string) => { const c = norm(cwd), r = norm(repo); return c === r || c.startsWith(`${r}\\`); };

// ── one sample ──────────────────────────────────────────────────────────────
type Sample = { at: string; title: string; process: string; repo: string | null; session_id: string | null; seconds: number };
function build(raw: { at: string; title: string; process: string; idle: number }): Sample | null {
  const title = String(raw.title ?? "").trim(), process = String(raw.process ?? "").trim();
  if (!title && !process) return null;
  if (SKIP.test(process)) return null;
  const at = raw.at && Number.isFinite(Date.parse(raw.at)) ? new Date(raw.at).toISOString() : new Date().toISOString();
  // Nobody at the keyboard: the window in front is not what is happening. An empty "idle" sample keeps the away time honest.
  if (raw.idle >= IDLE) return { at, title: "", process: "idle", repo: null, session_id: null, seconds: EVERY };
  let repo: string | null = null, session: Session | null = null;
  const path = title.match(PATH_RE)?.[1];
  if (path) repo = repoOf(path);
  if (repo) session = sessions.find((s) => inRepo(s.cwd, repo!)) ?? null;
  if (!repo && CLAUDE_APP.test(process) && sessions.length) {
    // The Claude app shows no path: the most recently active session is the one in front.
    session = sessions[0];
    repo = repoOf(session.cwd);
  }
  if (!repo && !session) {
    // An editor or terminal names the folder without its path: a live session's folder name in the title is a match.
    const s = sessions.find((x) => { const b = basename(x.cwd); return b.length >= 5 && title.toLowerCase().includes(b.toLowerCase()); });
    if (s) { session = s; repo = repoOf(s.cwd); }
  }
  return { at, title, process, repo, session_id: session?.id ?? null, seconds: EVERY };
}

// ── batches to the server ───────────────────────────────────────────────────
const buffer: Sample[] = [];
let lastFlush = Date.now(), posted = 0, failures = 0;
async function flush(force = false) {
  if (!buffer.length) return;
  if (!force && buffer.length < 2 && Date.now() - lastFlush < 60_000) return;
  const batch = buffer.splice(0, 200);
  try {
    const r = await fetch(`${BASE}/mod/ribbon/samples`, { method: "POST", headers, body: JSON.stringify({ samples: batch }) });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `server said ${r.status}`);
    posted += Number(j.stored ?? batch.length);
    failures = 0;
    lastFlush = Date.now();
    if (Array.isArray(j.started) && j.started.length) log(`server started ${j.started.map((s: any) => `${s.task} ${s.title}`).join("; ")}`);
  } catch (e: any) {
    buffer.unshift(...batch);
    if (buffer.length > 240) buffer.splice(0, buffer.length - 240); // two hours, then the oldest go
    if (failures++ % 10 === 0) log(`could not post ${batch.length} samples: ${e?.message ?? e} (keeping ${buffer.length})`);
    lastFlush = Date.now();
  }
}

// ── the sampler process ─────────────────────────────────────────────────────
let stopping = false;
let child: ReturnType<typeof Bun.spawn> | null = null;
async function runSampler() {
  while (!stopping) {
    child = Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", SAMPLER],
      { stdout: "pipe", stderr: "pipe", env: { ...process.env, RIBBON_EVERY: String(EVERY) } });
    const reader = child.stdout.getReader();
    const dec = new TextDecoder();
    let rest = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        rest += dec.decode(value, { stream: true });
        const lines = rest.split(/\r?\n/);
        rest = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let raw: any;
          try { raw = JSON.parse(line); } catch { continue; }
          await refreshSessions();
          const s = build(raw);
          if (!s) { log(`skip ${raw.process || "?"}`); continue; }
          buffer.push(s);
          log(s.process === "idle" ? `idle ${raw.idle}s` : `${s.process}: ${s.title.slice(0, 70)}${s.repo ? ` · ${basename(s.repo)}` : ""}${s.session_id ? ` · session ${s.session_id.slice(0, 8)}` : ""}`);
          await flush();
        }
      }
    } catch (e: any) { log(`sampler read failed: ${e?.message ?? e}`); }
    const err = await new Response(child.stderr).text().catch(() => "");
    if (!stopping) { log(`sampler exited (${child.exitCode})${err ? `: ${err.trim().split("\n").at(-1)}` : ""}; restarting in 5 s`); await Bun.sleep(5_000); }
  }
}
const stop = async () => { stopping = true; try { child?.kill(); } catch {} await flush(true); log(`stopped after ${posted} samples`); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
log(`watching every ${EVERY} s → ${BASE} (token ${TOKEN_FILE}); idle after ${IDLE} s is skipped`);
setInterval(() => { flush().catch(() => {}); }, 15_000);
await runSampler();

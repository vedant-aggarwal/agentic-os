// Jobs: a Claude Code or Codex session started for one or more tasks or an idea, run as a structured chat so its
// output streams into the app live. One driver per live job (server/drivers): "native" (Claude Agent SDK, codex
// app-server) or "acp" (the ACP adapters). Driver output becomes JobEvents (assistant/thought chunks merged, tool calls
// updated in place), persisted to <DATA_DIR>/jobs/<id>.jsonl (last line per seq wins) and pushed to SSE subscribers.
// Per job settings that the agentos schema doesn't have (driver, plan mode, token use, turn checkpoints) live in
// <DATA_DIR>/jobs/<id>.meta.json. Before and after every turn the folder is checkpointed (server/checkpoints.ts), so
// each turn has a diff and can be reverted.
// Rows live in the agentos db (schema v7: jobs, job_tasks); the runner is owner-only and runs on his own logins.
// The board (Code page) puts each job in a lane: working, attention, completed, archived; meta.lane overrides the
// status for the last two. Messages sent while the agent works wait in meta.queue. The prompt cache is tracked per job
// (settings.json: TTL, keep-warm); a message to a cold job needs force. Builders (server/builders.ts) ship finished work.
import { existsSync, mkdirSync, readFileSync, appendFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { randomBytes } from "node:crypto";
import { ApiError, type Store } from "./store";
import { acpAdapter, acpDriver } from "./drivers/acp";
import { claudeSdkDriver } from "./drivers/claude-sdk";
import { codexAppServerDriver } from "./drivers/codex-app-server";
import type { Driver, DriverName, ExtraTool, FormQuestion, Perm, PermOption, PermReq, Sink, Usage } from "./drivers/types";
import { openCheckpoints, type FileChange } from "./checkpoints";
import { applyTool, fromChecklist, line as progressLine, withState, type Progress } from "./progress";
import { openBuilders, type Ship } from "./builders";
import { builderRules } from "./ship-tools";
import type { JobWorkspace, WorkspaceRec } from "./job-workspace";

export type JobStatus = "starting" | "running" | "needs_input" | "idle" | "stopped" | "failed" | "done";
/** form: several questions answered at once (optionId "submit" with answers, or "skip"); answers: what was sent. */
/** html: an ask_form form, shown in a panel on the phone; its answers come back like a form's. */
type PermEv = { requestId: string; title: string; kind?: PermReq["kind"]; options: PermOption[]; decided?: string; form?: FormQuestion[]; answers?: Record<string, string>; html?: string };
export type JobEvent = {
  seq: number; at: string; type: "user" | "assistant" | "thought" | "tool" | "plan" | "permission" | "status" | "error" | "changes";
  text?: string; tool?: { id: string; title: string; kind: string; status: string; locations?: string[]; output?: string };
  plan?: { content: string; status: string }[]; permission?: PermEv; status?: JobStatus; msgId?: string;
  /** user: the turn this message starts. changes: the turn whose files changed. */
  turn?: number; changes?: FileChange[];
  /** user: a keep-warm ping, not something he wrote. steer: sent into a running turn. */
  ping?: boolean; steer?: boolean;
};
/** endUuid: the turn's last message in the engine's transcript (a rewind resumes there). dropped: rewound away. */
type Turn = { n: number; seq: number; at: string; before: string | null; after?: string | null; files?: number; reverted?: boolean; endUuid?: string | null; ping?: boolean; dropped?: boolean };
export type Lane = "working" | "attention" | "completed" | "archived";
type CacheHit = { read: number; write: number; fresh: number; at: string; cold: boolean; turn: number };
/** model: the engine model id or alias picked for this job; null = the engine's own default. effort: likewise for reasoning effort. */
type Meta = { driver: DriverName; plan: boolean; model?: string | null; effort?: string | null; usage: Usage | null; turns: Turn[]; ckptError?: string | null; note?: string | null; progress?: Progress | null;
  /** Board: lane overrides the status for completed and archived (laneAt: since when); starred and review are flags. */
  lane?: "completed" | "archived" | null; laneAt?: string | null; starred?: boolean; review?: boolean;
  /** Messages waiting for the current turn to end, sent one per finished turn. */
  queue?: { id: string; text: string; at: string }[];
  /** Cache: when the engine last called the model, the latest turn's first call, keep-warm until (ISO, "off", or unset = settings). */
  lastCallAt?: string | null; cache?: CacheHit | null; keepWarm?: string | null; pingMiss?: string | null;
  /** Builder jobs: role "builder" and the builder key (a project slug or "_global"). */
  role?: "builder" | null; builderKey?: string | null;
  /** Rewind: resume the session only up to this message on the next start. dropped: event seq ranges rewound away. */
  resumeAt?: string | null; fresh?: boolean; dropped?: [number, number][]; ckptDropped?: boolean;
  /** The folder is in a git repo: only then does unshipped work show as "Not shipped". */
  git?: boolean;
  /** Where it works: own copy (worktree), project folder or scratch, whether a copy was wanted, and why not. */
  workspace?: WorkspaceRec | null;
};
/** Board and cache settings (<DATA_DIR>/jobs/settings.json). */
export type JobSettings = { cacheTtlMin: { claude: number; codex: number }; keepWarm: boolean; keepWarmHours: number; leadMin: number; autoArchiveDays: number; ckptDropDays: number; batchSec: number };
const DEFAULT_SETTINGS: JobSettings = { cacheTtlMin: { claude: 60, codex: 60 }, keepWarm: false, keepWarmHours: 2, leadMin: 15, autoArchiveDays: 7, ckptDropDays: 7, batchSec: 20 };
const PING_TEXT = "(Agentic OS keep-warm ping. Don't do anything; reply with only the word: ok)";
const DAY = 86_400_000;
const STALE_DAYS = 3;
type Live = {
  driver: Driver; turn: Promise<void> | null; pending: Map<string, { resolve: (optionId: string | null) => void; perm: PermEv; seq: number }>;
  idle: ReturnType<typeof setTimeout> | null; closed: boolean;
  /** The running (or last) turn was a keep-warm ping: no summary, no push. */
  ping?: boolean;
  /** Background tasks still running, and a turn the agent started itself; either keeps the job "running" between turns. */
  bg: number; awake: boolean; settle: ReturnType<typeof setTimeout> | null;
};

const LIVE: JobStatus[] = ["starting", "running", "needs_input", "idle"];
const IDLE_MS = Number(process.env.JOB_IDLE_MS ?? 30 * 60_000);
const DEFAULT_DRIVER: DriverName = process.env.JOB_DRIVER === "acp" ? "acp" : "native";
const iso = () => new Date().toISOString();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const tail = (s: string, n: number) => (s.length > n ? "…" + s.slice(-n) : s);
const asPerm = (m: unknown): Perm => (m === "ask" || m === "edits" ? m : "auto");
const FORM_OPTIONS: PermOption[] = [
  { optionId: "submit", name: "Send answers", kind: "allow_once" },
  { optionId: "skip", name: "Skip", kind: "reject_once" },
];
/** Codex gets plan_progress as a dynamic tool (drivers/codex-app-server.ts); one line in the first prompt keeps it in mind. */
const CODEX_PLAN_RULE = "Keep the plan_progress bar current: create it before multi-step work, move it as each step finishes, and send state \"done\" at the end.";
/** A model id or alias ("claude-opus-5-5", "sonnet", "gpt-6-sol", "claude-sonnet-5[1m]"); "", null or "default" = the engine's default. */
function asModel(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "default") return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:\-[\]]{0,99}$/.test(s)) throw new ApiError(400, "That isn't a model name.");
  return s;
}
/** Claude Code's effort levels (the Agent SDK's EffortLevel); the model silently drops to the nearest one it supports. */
const CLAUDE_EFFORTS = ["low", "medium", "high", "xhigh", "max"];
/** A reasoning effort ("low" … "max", Codex also "ultra"); "", null or "default" = the model's own default. */
function asEffort(engine: string, v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (!s || s === "default") return null;
  const ok = engine === "claude" ? CLAUDE_EFFORTS : engineModels().efforts.codex;
  // No Codex model cache: take any plain word and let Codex judge it.
  if (ok.length ? !ok.includes(s) : !/^[a-z]{2,12}$/.test(s)) throw new ApiError(400, `${engine === "claude" ? "Claude" : "Codex"} has no "${s}" effort.`);
  return s;
}
/** The model choices the app offers when starting or switching a job. Claude Code's aliases always resolve to the newest
 *  model of each family; Codex lists what this login may use (~/.codex/models_cache.json, visibility "list").
 *  efforts: the reasoning efforts each engine takes (Codex: every level any listed model supports, lowest first). */
export function engineModels(): { claude: string[]; codex: string[]; efforts: { claude: string[]; codex: string[] } } {
  let codex: string[] = [];
  const codexEfforts = new Set<string>();
  try {
    const c = JSON.parse(readFileSync(join(homedir(), ".codex", "models_cache.json"), "utf8"));
    const listed = (Array.isArray(c?.models) ? c.models : []).filter((m: any) => m?.slug && (m.visibility ?? "list") === "list");
    codex = listed.map((m: any) => String(m.slug));
    for (const m of listed) for (const l of m.supported_reasoning_levels ?? []) if (l?.effort) codexEfforts.add(String(l.effort));
  } catch { /* no codex cache: Default only */ }
  const order = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
  const rank = (e: string) => (order.indexOf(e) < 0 ? order.length : order.indexOf(e));
  return { claude: ["opus", "sonnet", "haiku"], codex, efforts: { claude: CLAUDE_EFFORTS, codex: [...codexEfforts].sort((a, b) => rank(a) - rank(b)) } };
}

/** A job as the bootstrap carries it, for the phone's lists and cards: no prompt (context), no summary (lastText
 *  already holds its last 300 characters), no usage or rewound ranges, progress without its steps (done, total,
 *  active and stage stay) and cache without its last-call detail. Text fields are left out rather than shortened, so
 *  a copy merged over a full one keeps the full text. Job pages read the whole job from GET /jobs/:id. */
export function briefJob(j: any) {
  const { context, summary, usage, dropped, progress, cache, ...rest } = j ?? {};
  const p = progress ? (({ stages, note, ...x }: any) => x)(progress) : progress;
  const c = cache ? (({ last, tokens, pingMiss, ...x }: any) => x)(cache) : cache;
  return { ...rest, progress: p, cache: c };
}

/** The engine's env: no CLAUDECODE or CLAUDE_CODE_ variables (Claude refuses to nest), the installed codex.exe (codex-acp's
 *  bundled codex is older than the account's models), and the wyn plugin switched off: its listener hook keeps a
 *  headless session from starting, and the job runner already relays everything. */
function engineEnv(engine: "claude" | "codex", dataDir: string) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v != null && !/^CLAUDECODE|^CLAUDE_CODE_|^CLAUDE_PID$/.test(k)) env[k] = v;
  env.WYN_AGENT_TOKEN_FILE = join(dataDir, "jobs", "wyn-off.token");
  if (engine === "codex" && !env.CODEX_PATH) {
    const exe = Bun.which("codex.exe") ?? Bun.which("codex");
    if (exe && /\.exe$/i.test(exe)) env.CODEX_PATH = exe;
  }
  return env;
}

/** push data carries event: needs | finished | failed, so server/work-activity.ts can pick the buttons and grouping.
 *  changed: any job row changed (the sessions Live Activity recounts). */
export function openJobs(o: { dataDir: string; store: Store; push: (title: string, body: string, data?: Record<string, unknown>) => Promise<void>; changed?: () => void; workspace?: JobWorkspace }) {
  const db = o.store.db;
  const dir = join(o.dataDir, "jobs");
  mkdirSync(dir, { recursive: true });
  const ckpt = openCheckpoints(o.dataDir);
  const live = new Map<number, Live>();
  const events = new Map<number, JobEvent[]>();
  const metas = new Map<number, Meta>();
  const dirty = new Map<number, Set<number>>();
  const subs = new Map<number, Set<{ send: (ev: string, data: unknown) => void }>>();
  const sseDirty = new Map<number, Set<number>>();
  let sseTimer: ReturnType<typeof setTimeout> | null = null;
  const settingsFile = join(dir, "settings.json");
  let S: JobSettings = { ...DEFAULT_SETTINGS };
  try { const f = JSON.parse(readFileSync(settingsFile, "utf8")); S = { ...S, ...f, cacheTtlMin: { ...S.cacheTtlMin, ...(f.cacheTtlMin ?? {}) } }; } catch {}
  const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  function setSettingsAll(b: any) {
    const t = b?.cacheTtlMin ?? {};
    S = {
      cacheTtlMin: { claude: num(t.claude, 1, 1440, S.cacheTtlMin.claude), codex: num(t.codex, 1, 1440, S.cacheTtlMin.codex) },
      keepWarm: typeof b?.keepWarm === "boolean" ? b.keepWarm : S.keepWarm,
      keepWarmHours: num(b?.keepWarmHours, 0.25, 48, S.keepWarmHours),
      leadMin: num(b?.leadMin, 1, 55, S.leadMin),
      autoArchiveDays: num(b?.autoArchiveDays, 1, 365, S.autoArchiveDays),
      ckptDropDays: num(b?.ckptDropDays, 1, 365, S.ckptDropDays),
      batchSec: num(b?.batchSec, 0, 600, S.batchSec),
    };
    if (S.leadMin >= Math.min(S.cacheTtlMin.claude, S.cacheTtlMin.codex)) S.leadMin = Math.max(1, Math.min(S.cacheTtlMin.claude, S.cacheTtlMin.codex) - 1);
    writeFileSync(settingsFile, JSON.stringify(S, null, 1));
    for (const id of live.keys()) { try { broadcast(id, "job", job(id)); } catch {} }
    return S;
  }
  const builders = openBuilders({ dataDir: o.dataDir, batchMs: () => S.batchSec * 1000, host: () => ({
    async start(key, c, prompt) {
      const project = key === "_global" ? null : key;
      const name = project ? (db.query("SELECT name FROM projects WHERE slug = ?").get(project) as any)?.name ?? project : "jobs without a project";
      const j = await create({ engine: "claude", project, title: `Builder · ${name}`, context: "Builder", mode: "auto", model: c.model, effort: c.effort }, { role: "builder", builderKey: key, prompt });
      return jobNum(j.id);
    },
    async send(jobId, text) { await prompt(`j${jobId}`, text, { force: true }); },
    state(jobId) {
      const r = db.query("SELECT * FROM jobs WHERE id = ?").get(jobId) as any;
      if (!r) return { busy: false, warm: false, gone: true };
      const m = meta(jobId);
      const l = live.get(jobId);
      return { busy: !!(l?.turn || l?.awake) || r.status === "needs_input" || r.status === "starting",
        warm: cacheOf(jobId, r, m).state === "warm", gone: r.status === "done" || m.lane === "archived" };
    },
    archive(jobId, note) {
      stopProc(jobId);
      try { if (LIVE.includes(row(jobId).status)) setStatus(jobId, "stopped"); } catch { return; }
      saveMeta(jobId, { lane: "archived", laneAt: iso() });
      addEvent(jobId, { type: "status", status: row(jobId).status, text: note });
      setJob(jobId, {});
    },
    summary: (jobId) => { try { return row(jobId).summary ?? null; } catch { return null; } },
    touched: (jobId) => { try { setJob(jobId, {}); } catch {} },
    push: (title, body, data) => { o.push(title, body, data).catch(() => {}); },
    projectExists: (slug) => !!db.query("SELECT 1 FROM projects WHERE slug = ?").get(slug),
  }) });


  // ── rows ────────────────────────────────────────────────────────────────
  const row = (id: number) => {
    const r = db.query("SELECT * FROM jobs WHERE id = ?").get(id) as any;
    if (!r) throw new ApiError(404, `No job j${id}.`);
    return r;
  };
  const jobNum = (idIn: string) => {
    const n = Number(String(idIn).replace(/^j/i, ""));
    if (!Number.isInteger(n) || n <= 0) throw new ApiError(404, "No such job.");
    return n;
  };
  function meta(id: number): Meta {
    let m = metas.get(id);
    if (m) return m;
    // Jobs from before drivers existed ran on ACP.
    m = { driver: "acp", plan: false, usage: null, turns: [] };
    try { m = { ...m, ...JSON.parse(readFileSync(join(dir, `${id}.meta.json`), "utf8")) }; } catch {}
    metas.set(id, m!);
    return m!;
  }
  function saveMeta(id: number, patch: Partial<Meta> = {}) {
    const m = Object.assign(meta(id), patch);
    try { writeFileSync(join(dir, `${id}.meta.json`), JSON.stringify(m)); } catch {}
    return m;
  }
  /** The newest real answer: assistant text from a keep-warm ping's turn doesn't count. */
  function lastAnswer(evs: JobEvent[] | undefined) {
    let cand: JobEvent | null = null;
    for (let i = (evs?.length ?? 0) - 1; i >= 0; i--) {
      const e = evs![i];
      if (e.type === "user") { if (e.ping) { cand = null; continue; } if (cand) return cand; }
      else if (!cand && e.type === "assistant" && e.text?.trim()) cand = e;
    }
    return cand;
  }
  function lastText(id: number, r: any) {
    return tail(String(lastAnswer(events.get(id))?.text ?? r.summary ?? "").trim(), 300) || null;
  }
  const ttlOf = (engine: string) => (engine === "codex" ? S.cacheTtlMin.codex : S.cacheTtlMin.claude) * 60_000;
  /** When keep-warm stops for this job: its own choice, else the global switch counted from his last real message. */
  function keepWarmUntil(id: number, m: Meta): number | null {
    if (m.keepWarm === "off") return null;
    if (m.keepWarm) { const t = Date.parse(m.keepWarm); return Number.isFinite(t) ? t : null; }
    if (!S.keepWarm) return null;
    const lastReal = [...m.turns].reverse().find((t) => !t.ping && !t.dropped);
    return lastReal ? Date.parse(lastReal.at) + S.keepWarmHours * 3_600_000 : null;
  }
  /** The prompt cache as far as we can tell: warm until the TTL runs out after the last model call. */
  function cacheOf(id: number, r: any, m: Meta) {
    const ttl = ttlOf(r.engine);
    const last = m.lastCallAt ? Date.parse(m.lastCallAt) : NaN;
    const until = Number.isFinite(last) ? last + ttl : null;
    const kw = keepWarmUntil(id, m);
    const tokens = m.cache ? m.cache.read + m.cache.write + m.cache.fresh : null;
    return { ttlMin: Math.round(ttl / 60_000), lastAt: m.lastCallAt ?? null, warmUntil: until ? new Date(until).toISOString() : null,
      state: !until || !r.session_id || m.fresh ? "none" : Date.now() < until ? "warm" : "cold",
      keepWarmUntil: kw && kw > Date.now() ? new Date(kw).toISOString() : null, keepWarm: m.keepWarm ?? null,
      last: m.cache ?? null, tokens, pingMiss: m.pingMiss ?? null };
  }
  function laneOf(r: any, m: Meta): Lane {
    if (m.lane === "archived") return "archived";
    if (m.lane === "completed" || r.status === "done") return "completed";
    if (r.status === "starting" || r.status === "running") return "working";
    // A stopped or finished job nobody touched for STALE_DAYS has stopped needing him.
    if (!m.lane && (r.status === "stopped" || r.status === "idle") && Date.now() - Date.parse(m.laneAt ?? r.updated_at) > STALE_DAYS * DAY) return "completed";
    return "attention";
  }
  /** Is the job's folder in a git repo (so finished work there can ship)? Asked once per job, in the background;
   *  null until known. */
  const gitAsks = new Set<number>();
  function inGit(id: number, r: any, m: Meta): boolean | null {
    if (m.git !== undefined) return m.git;
    if (!gitAsks.has(id)) {
      gitAsks.add(id);
      (async () => {
        let ok = false;
        try { ok = !!r.cwd && existsSync(r.cwd) && (await Bun.spawn(["git", "rev-parse", "--is-inside-work-tree"], { cwd: r.cwd, stdout: "ignore", stderr: "ignore" }).exited) === 0; } catch {}
        saveMeta(id, { git: ok });
        if (ok) broadcast(id, "job", job(id));
      })().finally(() => gitAsks.delete(id));
    }
    return null;
  }
  function shape(r: any) {
    const l = live.get(r.id);
    const pending = l ? [...l.pending.values()][0]?.perm ?? null : null;
    const taskIds = (db.query("SELECT task_id FROM job_tasks WHERE job_id = ? ORDER BY task_id").all(r.id) as any[]).map((x) => `t${x.task_id}`);
    const m = meta(r.id);
    return { id: `j${r.id}`, title: r.title, engine: r.engine, project: r.project ?? null, cwd: r.cwd ?? null, mode: asPerm(r.mode),
      status: r.status as JobStatus, taskIds, ideaId: r.idea_id ? `i${r.idea_id}` : null, context: r.context ?? null, summary: r.summary ?? null,
      error: r.error ?? null, nativeId: r.native_id ?? null, createdAt: r.created_at, updatedAt: r.updated_at, finishedAt: r.finished_at ?? null,
      pending, lastText: lastText(r.id, r), background: l && !l.closed ? l.bg : 0, driver: m.driver, plan: m.plan, model: m.model ?? null, effort: m.effort ?? null, usage: m.usage, turns: m.turns.length, checkpointError: m.ckptError ?? null,
      progress: m.progress ?? null,
      files: m.turns.reduce((a, t) => a + (t.dropped ? 0 : t.files ?? 0), 0), git: m.role === "builder" ? false : inGit(r.id, r, m),
      lane: laneOf(r, m), laneAt: m.laneAt ?? null, starred: !!m.starred, review: !!m.review, queue: m.queue ?? [],
      cache: cacheOf(r.id, r, m), role: m.role ?? null, builderKey: m.builderKey ?? null, dropped: m.dropped ?? [],
      workspace: m.role === "builder" || !o.workspace ? null : o.workspace.info(r.cwd ?? null, m.workspace ?? null, () => broadcast(r.id, "job", job(r.id))),
      ship: m.role === "builder" ? null : builders.latest(r.id), checkpointsDropped: !!m.ckptDropped,
      rewind: m.driver === "native" && r.engine === "claude" };
  }
  const job = (id: number) => shape(row(id));
  function setJob(id: number, f: Record<string, unknown>) {
    const keys = Object.keys(f);
    if (keys.length) db.query(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`).run(...(Object.values(f) as any[]), iso(), id);
    flushSse();
    broadcast(id, "job", job(id));
    try { o.changed?.(); } catch {}
  }
  function setStatus(id: number, status: JobStatus, extra: Record<string, unknown> = {}, note?: string) {
    const prev = row(id).status;
    setJob(id, { status, ...extra });
    if (prev !== status && status !== "running" && status !== "starting") addEvent(id, { type: "status", status, ...(note ? { text: note } : {}) });
    if (prev !== status && status === "failed") {
      const r = row(id);
      o.push(`Job failed: ${r.title ?? `j${id}`}`, clip(String(r.error ?? "It stopped with an error."), 180),
        { kind: "job", event: "failed", jobId: `j${id}`, url: `agenticos://job/j${id}` }).catch(() => {});
    }
  }

  // ── events ──────────────────────────────────────────────────────────────
  function load(id: number): JobEvent[] {
    let evs = events.get(id);
    if (evs) return evs;
    const bySeq = new Map<number, JobEvent>();
    const f = join(dir, `${id}.jsonl`);
    if (existsSync(f)) for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); bySeq.set(e.seq, e); } catch {}
    }
    evs = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
    events.set(id, evs);
    return evs;
  }
  function addEvent(id: number, e: Omit<JobEvent, "seq" | "at">) {
    const evs = load(id);
    const ev = { seq: (evs.at(-1)?.seq ?? 0) + 1, at: iso(), ...e } as JobEvent;
    evs.push(ev);
    touched(id, ev.seq);
    return ev;
  }
  function touched(id: number, seq: number) {
    (dirty.get(id) ?? dirty.set(id, new Set()).get(id)!).add(seq);
    (sseDirty.get(id) ?? sseDirty.set(id, new Set()).get(id)!).add(seq);
    sseTimer ??= setTimeout(flushSse, 80);
  }
  function flushDisk() {
    for (const [id, seqs] of dirty) {
      const evs = load(id);
      const lines = [...seqs].map((s) => evs.find((e) => e.seq === s)).filter(Boolean).map((e) => JSON.stringify(e)).join("\n");
      if (lines) appendFileSync(join(dir, `${id}.jsonl`), lines + "\n");
    }
    dirty.clear();
  }
  setInterval(flushDisk, 1000);
  function flushSse() {
    if (sseTimer) clearTimeout(sseTimer);
    sseTimer = null;
    for (const [id, seqs] of sseDirty) {
      const evs = load(id);
      for (const s of [...seqs].sort((a, b) => a - b)) { const e = evs.find((x) => x.seq === s); if (e) broadcast(id, "ev", publicEvent(e)); }
    }
    sseDirty.clear();
  }
  const publicEvent = ({ msgId, ...e }: JobEvent) => e;
  function broadcast(id: number, ev: string, data: unknown) {
    for (const s of subs.get(id) ?? []) { try { s.send(ev, data); } catch {} }
  }

  // ── what a driver reports ───────────────────────────────────────────────
  function sinkFor(id: number): Sink {
    const lastUserSeq = () => [...load(id)].reverse().find((e) => e.type === "user")?.seq ?? 0;
    return {
      text(type, msgId, chunk) {
        if (!chunk) return;
        const last = load(id).at(-1);
        if (last && last.type === type && (last.msgId ?? null) === (msgId ?? null)) { last.text = (last.text ?? "") + chunk; touched(id, last.seq); }
        else addEvent(id, { type, text: chunk, msgId: msgId ?? undefined });
      },
      tool(u) {
        const evs = load(id);
        let ev = [...evs].reverse().find((e) => e.type === "tool" && e.tool?.id === u.id);
        if (!ev) ev = addEvent(id, { type: "tool", tool: { id: u.id, title: u.title ?? "Tool", kind: u.kind ?? "other", status: u.status ?? "pending" } });
        const t = ev.tool!;
        if (u.title) t.title = u.title;
        if (u.kind) t.kind = u.kind;
        if (u.status) t.status = u.status;
        if (u.locations?.length) t.locations = u.locations;
        if (u.output) t.output = u.output;
        touched(id, ev.seq);
      },
      plan(entries) {
        // One checklist per turn, replaced as it changes.
        const from = lastUserSeq();
        const ev = [...load(id)].reverse().find((e) => e.type === "plan" && e.plan && e.seq > from);
        if (ev) { ev.plan = entries; touched(id, ev.seq); } else addEvent(id, { type: "plan", plan: entries });
        // No bar of its own: the checklist is the bar.
        setProgress(id, fromChecklist(meta(id).progress ?? null, entries));
      },
      progress(input) {
        const r = applyTool(meta(id).progress ?? null, input);
        if (!r.progress) return { ok: false, text: r.error ?? "plan_progress: refused." };
        setProgress(id, r.progress);
        return { ok: true, text: `plan_progress: ${progressLine(r.progress)}` };
      },
      ask: (form) => onAsk(id, form),
      currentProgress: () => meta(id).progress ?? null,
      planText(md) {
        if (!md.trim()) return;
        const from = lastUserSeq();
        const ev = [...load(id)].reverse().find((e) => e.type === "plan" && e.text != null && e.seq > from);
        if (ev) { ev.text = md; touched(id, ev.seq); } else addEvent(id, { type: "plan", text: md });
      },
      permission: (r) => onPermission(id, r),
      usage(u) {
        const { cache, ...rest } = u;
        const m = meta(id);
        const turn = m.turns.at(-1);
        const patch: Partial<Meta> = { usage: rest, lastCallAt: iso() };
        // The turn's first call says whether the cache was warm when it began: more written or sent fresh than read = cold.
        if (cache && turn && m.cache?.turn !== turn.n && cache.read + cache.write + cache.fresh > 2000) {
          const cold = cache.write + cache.fresh > cache.read;
          patch.cache = { ...cache, at: iso(), cold, turn: turn.n };
          if (cold && turn.ping) {
            patch.pingMiss = iso();
            o.push(`Keep-warm missed: ${row(id).title ?? `j${id}`}`, "The cache was already cold when the ping ran, so the TTL setting is longer than the real one. Lower it in Code settings.",
              { kind: "job", event: "failed", jobId: `j${id}`, url: `agenticos://job/j${id}` }).catch(() => {});
          }
        }
        saveMeta(id, patch);
        setJob(id, {});
      },
      call: (tool, args) => onTool(id, tool, args),
      turnMark(uuid) { const t = meta(id).turns.at(-1); if (t) { t.endUuid = uuid; saveMeta(id); } },
      title(t) { if (!row(id).title) setJob(id, { title: clip(t, 120) }); },
      session(sid) { saveMeta(id, { resumeAt: null, fresh: false }); setJob(id, { session_id: sid, native_id: sid }); },
      log(ls) { try { appendFileSync(join(dir, `${id}.stderr.log`), ls.join("\n") + "\n"); } catch {} },
      activity(a) {
        const l = live.get(id);
        if (!l) return;
        l.bg = a.background;
        l.awake = a.awake;
        if (l.turn) return;
        if (l.settle) clearTimeout(l.settle);
        // A finished task drops the count a moment before the agent wakes for it; wait before calling the job idle.
        l.settle = setTimeout(() => { l.settle = null; settle(id, l); }, working(l) ? 0 : 3000);
      },
    };
  }

  function setProgress(id: number, p: Progress | null) {
    if (p === (meta(id).progress ?? null)) return;
    saveMeta(id, { progress: p });
    setJob(id, {});
  }
  /** Questions as one form. Never auto-answered. */
  function onAsk(id: number, form: FormQuestion[]): Promise<Record<string, string> | null> {
    const qs = form.filter((q) => q.question?.trim()).slice(0, 8);
    if (!qs.length) return Promise.resolve(null);
    const title = qs.length === 1 ? qs[0].question : `${qs.length} questions`;
    let perm: PermEv | null = null;
    return onPermission(id, { title, kind: "question", options: FORM_OPTIONS }, qs, (p) => (perm = p)).then((pick) =>
      pick === "submit" ? ((perm as PermEv | null)?.answers ?? {}) : null);
  }
  /** By the job's permission level: auto answers everything, edits answers file edits, ask asks. Plans and questions always ask. */
  function onPermission(id: number, r: PermReq, form?: FormQuestion[], made?: (p: PermEv) => void): Promise<string | null> {
    const jr = row(id);
    const mode = asPerm(jr.mode);
    const auto = r.kind !== "plan" && r.kind !== "question" && (mode === "auto" || (mode === "edits" && r.kind === "edit"));
    if (auto) {
      const pick = r.options.find((x) => x.kind === "allow_always") ?? r.options.find((x) => x.kind === "allow_once") ?? r.options[0];
      addEvent(id, { type: "permission", permission: { requestId: randomBytes(6).toString("hex"), title: r.title, kind: r.kind, options: r.options, decided: pick?.optionId } });
      return Promise.resolve(pick?.optionId ?? null);
    }
    const l = live.get(id);
    if (!l) return Promise.resolve(null);
    const perm: PermEv = { requestId: `p_${randomBytes(6).toString("hex")}`, title: r.title, kind: r.kind, options: r.options, ...(form ? { form } : {}) };
    made?.(perm);
    return new Promise((resolveIt) => {
      const ev = addEvent(id, { type: "permission", permission: perm });
      l.pending.set(perm.requestId, { resolve: resolveIt, perm, seq: ev.seq });
      setStatus(id, "needs_input");
      setProgress(id, withState(meta(id).progress ?? null, "needs_input", r.kind === "plan" ? "Plan ready" : r.kind === "question" ? "Question waiting" : "Waiting for an OK"));
      const head = r.kind === "plan" ? "Plan ready" : r.kind === "question" ? "Question" : "Job needs you";
      // A plain permission can be answered from the notification: Allow (once) and Deny (once).
      const plain = r.kind !== "plan" && r.kind !== "question";
      const allow = plain ? (r.options.find((x) => x.kind === "allow_once") ?? r.options.find((x) => x.kind === "allow_always"))?.optionId : undefined;
      const deny = plain ? (r.options.find((x) => x.kind === "reject_once") ?? r.options.find((x) => x.kind === "reject_always"))?.optionId : undefined;
      o.push(`${head}: ${jr.title ?? `j${id}`}`, clip(r.title, 180), { kind: "job", event: "needs", permKind: r.kind ?? null, jobId: `j${id}`, url: `agenticos://job/j${id}`,
        ...(allow && deny ? { requestId: perm.requestId, allow, deny } : {}) }).catch(() => {});
    });
  }

  // ── the engine process ──────────────────────────────────────────────────
  function makeDriver(id: number, r: any): Driver {
    const engine = r.engine as "claude" | "codex";
    const m = meta(id);
    const builder = m.role === "builder";
    const tools: ExtraTool[] = builder ? ["ship_status"] : ["publish_changes", "ask_form"];
    const rules = builder ? builderRules({ project: r.project ?? null, folder: r.cwd ?? null, notes: builders.notes(m.builderKey ?? "_global") }) : null;
    const opts = { engine, cwd: r.cwd, env: engineEnv(engine, o.dataDir), sessionId: m.fresh ? null : r.session_id ?? null, perm: asPerm(r.mode), model: m.model ?? null, effort: m.effort ?? null, sink: sinkFor(id),
      tools, rules, resumeAt: m.resumeAt ?? null, readDirs: [join(dir, "att")] };
    if (meta(id).driver === "acp") return acpDriver(opts);
    return engine === "claude" ? claudeSdkDriver(opts) : codexAppServerDriver(opts);
  }
  async function ensureLive(id: number): Promise<Live> {
    const have = live.get(id);
    if (have && !have.closed) return have;
    const r = row(id);
    const driver = makeDriver(id, r);
    const l: Live = { driver, turn: null, pending: new Map(), idle: null, closed: false, bg: 0, awake: false, settle: null };
    live.set(id, l);
    driver.exited.then((code) => {
      l.closed = true;
      if (live.get(id) !== l) return;
      live.delete(id);
      for (const p of l.pending.values()) p.resolve(null);
      try {
        const cur = row(id);
        if (cur.status === "idle") setStatus(id, "stopped");
        else if (["starting", "running", "needs_input"].includes(cur.status)) {
          setStatus(id, "failed", { error: clip(`The ${r.engine} process ended (exit ${code}). ${stderrTail(id)}`.trim(), 500) });
          if (meta(id).role === "builder") builders.turnEnded(id);
        }
      } catch {}
    });
    try {
      await driver.start();
      return l;
    } catch (e) {
      stopProc(id);
      throw e;
    }
  }
  function stderrTail(id: number) {
    try {
      const ls = readFileSync(join(dir, `${id}.stderr.log`), "utf8").split("\n").filter((x) => x.trim()).slice(-40);
      return (ls.filter((x) => /error|fail|denied|not found/i.test(x)).slice(-2).join(" ") || ls.slice(-2).join(" ")).slice(0, 300);
    } catch { return ""; }
  }
  const errText = (e: unknown) => clip(String((e as any)?.message ?? e), 500);
  function stopProc(id: number) {
    const l = live.get(id);
    if (!l) return;
    live.delete(id);
    l.closed = true;
    if (l.idle) clearTimeout(l.idle);
    if (l.settle) clearTimeout(l.settle);
    for (const p of l.pending.values()) p.resolve(null);
    l.pending.clear();
    try { l.driver.close(); } catch {}
  }

  const working = (l: Live) => !!l.turn || l.bg > 0 || l.awake;
  /** Between turns: "running" while background tasks or a turn the agent started itself keep it busy (so nothing
   *  restarts the server under it), else "idle" with the newest reply as the summary and a "finished" push. */
  function settle(id: number, l: Live, note?: string, turnEnded = false) {
    if (l.closed || live.get(id) !== l || l.turn) return;
    const r = row(id);
    if (!["running", "idle"].includes(r.status)) return;
    const summary = (lastText(id, r) ?? "").replace(/^…/, "");
    const full = lastAnswer(load(id))?.text ?? summary;
    // A keep-warm ping changes nothing he sees: same summary, no push.
    const keep = l.ping ? {} : { summary: clip(full.trim(), 4000) };
    if (working(l)) {
      if (l.idle) { clearTimeout(l.idle); l.idle = null; }
      setStatus(id, "running", keep);
      if (turnEnded && l.bg > 0) addEvent(id, { type: "status", status: "running",
        text: `Reply sent; ${l.bg} background task${l.bg === 1 ? "" : "s"} still working. The job stays running until they finish.` });
      return;
    }
    if (turnEnded && meta(id).role === "builder") builders.turnEnded(id);
    // The next queued message goes as soon as the turn ends.
    if (turnEnded && drainQueue(id)) return;
    if (r.status === "idle") return;
    setStatus(id, "idle", keep, note);
    if (!l.ping) o.push(`Job finished: ${r.title ?? `j${id}`}`, clip(summary || "Done.", 180), { kind: "job", event: "finished", jobId: `j${id}`, url: `agenticos://job/j${id}` }).catch(() => {});
    if (l.idle) clearTimeout(l.idle);
    l.idle = setTimeout(() => { if (live.get(id) === l && !working(l) && row(id).status === "idle") { stopProc(id); setStatus(id, "stopped"); } }, IDLE_MS);
  }

  // ── turns and checkpoints ───────────────────────────────────────────────
  async function beginTurn(id: number, text: string, ping = false) {
    const r = row(id);
    const m = meta(id);
    const n = (m.turns.at(-1)?.n ?? 0) + 1;
    const ev = addEvent(id, { type: "user", text: clip(text, 20000), turn: n, ...(ping ? { ping: true } : {}) });
    // A ping changes no files: no snapshot.
    const snap = ping ? { tree: null } : await ckpt.snapshot(id, r.cwd);
    m.turns.push({ n, seq: ev.seq, at: ev.at, before: snap.tree, ...(ping ? { ping: true } : {}) });
    if (ping) { saveMeta(id); return n; }
    saveMeta(id, { ckptError: snap.tree ? null : snap.error ?? null });
    return n;
  }
  async function endTurn(id: number, n: number) {
    const m = meta(id);
    const t = m.turns.find((x) => x.n === n);
    if (!t?.before) return;
    const cwd = row(id).cwd;
    const snap = await ckpt.snapshot(id, cwd);
    t.after = snap.tree;
    if (!snap.tree) return void saveMeta(id, { ckptError: snap.error ?? null });
    const changes = snap.tree === t.before ? [] : await ckpt.changes(id, cwd, t.before, snap.tree).catch(() => []);
    t.files = changes.length;
    saveMeta(id);
    if (changes.length) addEvent(id, { type: "changes", turn: n, changes: changes.slice(0, 200) });
  }

  /** One turn: send the text and stream until the agent stops. Resolves when the turn has been started. */
  async function runTurn(id: number, text: string, ping = false) {
    const n = await beginTurn(id, text, ping);
    const l = await ensureLive(id);
    if (l.idle) { clearTimeout(l.idle); l.idle = null; }
    if (l.settle) { clearTimeout(l.settle); l.settle = null; }
    l.ping = ping;
    setStatus(id, "running", { error: null });
    // Whoever the bar was waiting on just spoke.
    if (!ping && meta(id).progress?.state === "needs_input") setProgress(id, withState(meta(id).progress ?? null, "running"));
    // After a revert the agent's picture of the files is stale; say so once (not in a ping).
    const note = ping ? null : meta(id).note;
    if (note) saveMeta(id, { note: null });
    l.turn = (async () => {
      try {
        const res = await l.driver.prompt(note ? `${note}\n\n${text}` : text, { plan: l.driver.supportsPlan && meta(id).plan });
        flushSse();
        await endTurn(id, n).catch(() => {});
        if (l.closed || live.get(id) !== l) return;
        const reason = res.stopReason;
        l.turn = null;
        settle(id, l, reason === "end_turn" ? undefined : reason === "cancelled" ? "Cancelled" : `Stopped: ${reason}`, true);
      } catch (e) {
        await endTurn(id, n).catch(() => {});
        if (l.closed || live.get(id) !== l) return;
        addEvent(id, { type: "error", text: errText(e) });
        setStatus(id, "failed", { error: errText(e) });
        setProgress(id, withState(meta(id).progress ?? null, "error", "The turn failed"));
        stopProc(id);
        if (meta(id).role === "builder") builders.turnEnded(id);
      } finally {
        l.turn = null;
        flushDisk();
      }
    })();
  }

  // ── public API ──────────────────────────────────────────────────────────
  function buildPrompt(p: { project: any; tasks: any[]; idea: any; context: string | null; cwd: string; engine?: string }) {
    const lines: string[] = [];
    if (p.project) lines.push(`Project: ${p.project.name}${p.project.description ? ` (${p.project.description})` : ""}.`);
    lines.push(`Working folder: ${p.cwd}`);
    if (p.tasks.length) {
      lines.push("", p.tasks.length === 1 ? "Task:" : "Tasks:");
      p.tasks.forEach((t, i) => lines.push(`${p.tasks.length > 1 ? `${i + 1}. ` : ""}${t.title}${t.notes ? `\n   ${String(t.notes).replace(/\n/g, "\n   ")}` : ""}`));
    }
    if (p.idea) lines.push("", `Idea: ${p.idea.title}${p.idea.body ? `\n${p.idea.body}` : ""}`);
    if (p.context) lines.push("", `Additional context from the user:\n${p.context}`);
    lines.push("", "Do the work in the working folder. When you finish, reply with a short summary of what you did, the files you changed, and anything left for the user.");
    if (p.engine === "codex") lines.push("", CODEX_PLAN_RULE);
    return lines.join("\n");
  }
  const pickDriver = (v: unknown): DriverName => (v === "acp" || v === "native" ? v : DEFAULT_DRIVER);

  /** internal: a Builder job (server/builders.ts), with its own first prompt instead of the task prompt. */
  async function create(b: any, internal: { role?: "builder"; builderKey?: string; prompt?: string } = {}) {
    if (!o.store.hasV7()) throw new ApiError(409, "Jobs need agentos schema v7. Update the agentos CLI on the PC (bun run install-cli).");
    const engine = b.engine === "claude" || b.engine === "codex" ? b.engine : null;
    if (!engine) throw new ApiError(400, 'engine is "claude" or "codex".');
    const driver = pickDriver(b.driver);
    if (driver === "acp") acpAdapter(engine);
    const taskNums = [...new Set((Array.isArray(b.taskIds) ? b.taskIds : []).map((x: any) => Number(String(x).replace(/^t/i, ""))))] as number[];
    const tasks = taskNums.map((n) => {
      const t = Number.isInteger(n) && n > 0 ? db.query("SELECT * FROM tasks WHERE id = ?").get(n) as any : null;
      if (!t) throw new ApiError(400, `No task t${n}.`);
      return t;
    });
    const ideaNum = b.ideaId ? Number(String(b.ideaId).replace(/^i/i, "")) : null;
    const idea = ideaNum ? db.query("SELECT * FROM ideas WHERE id = ?").get(ideaNum) as any : null;
    if (b.ideaId && !idea) throw new ApiError(400, `No idea ${b.ideaId}.`);
    const context = b.context == null || String(b.context).trim() === "" ? null : String(b.context).slice(0, 20000);
    if (!tasks.length && !idea && !context) throw new ApiError(400, "A job needs tasks, an idea or some context.");
    const projectSlug = b.project ?? tasks.find((t) => t.project)?.project ?? idea?.project ?? null;
    const project = projectSlug ? db.query("SELECT * FROM projects WHERE slug = ?").get(projectSlug) as any : null;
    if (projectSlug && !project) throw new ApiError(400, `No project "${projectSlug}".`);
    const mode = asPerm(b.mode);
    const plan = !!b.plan;
    if (plan && driver === "acp") throw new ApiError(400, "Plan mode needs the native driver.");
    const model = asModel(b.model);
    const effort = asEffort(engine, b.effort);   // the ACP driver ignores it, like the model
    let cwd: string | null = b.cwd ? String(b.cwd).trim() : project?.folder ?? null;
    if (cwd && !(existsSync(cwd) && statSync(cwd).isDirectory())) throw new ApiError(400, `The folder ${cwd} doesn't exist on the PC.`);
    const title = clip(String(b.title ?? "").trim() || (tasks[0] ? `${tasks[0].title}${tasks.length > 1 ? ` (+${tasks.length - 1})` : ""}` : "")
      || idea?.title || String(context ?? "").split("\n")[0], 120);
    // worktree: true = its own copy of a git folder; the record says what it got and, when it didn't, why.
    let workspace: WorkspaceRec | null = null;
    if (!internal.role && o.workspace) {
      const w = await o.workspace.prepare({ folder: cwd, wanted: !!b.worktree, title: title.slice(0, 80) || "Agent work", project: projectSlug });
      cwd = w.cwd;
      workspace = w.rec;
    }
    const stamp = iso();
    const id = db.transaction(() => {
      const r = db.query(`INSERT INTO jobs (title, engine, project, cwd, context, mode, status, idea_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'starting', ?, ?, ?) RETURNING id`).get(title, engine, projectSlug, cwd, context, mode, idea?.id ?? null, stamp, stamp) as any;
      for (const t of tasks) db.query("INSERT OR IGNORE INTO job_tasks (job_id, task_id) VALUES (?, ?)").run(r.id, t.id);
      return r.id as number;
    })();
    // A reused id (a deleted row) must not inherit an old job's events or checkpoints.
    for (const ext of ["jsonl", "meta.json"]) { const f = join(dir, `${id}.${ext}`); if (existsSync(f)) renameSync(f, `${f}.old-${Date.now()}`); }
    events.set(id, []);
    metas.delete(id);
    saveMeta(id, { driver, plan, model, effort, usage: null, turns: [], ckptError: null, note: null, workspace,
      ...(internal.role ? { role: internal.role, builderKey: internal.builderKey ?? null } : {}) });
    if (!cwd) {
      cwd = join(process.env.USERPROFILE ?? homedir(), "agentic-jobs", internal.role === "builder" ? "builder-global" : `j${id}`);
      mkdirSync(cwd, { recursive: true });
    }
    const prompt = internal.prompt ?? buildPrompt({ project, tasks, idea, context, cwd, engine });
    db.query("UPDATE jobs SET cwd = ?, prompt = ? WHERE id = ?").run(cwd, prompt, id);
    for (const t of tasks) if (["inbox", "todo"].includes(t.status)) o.store.patchTask(`t${t.id}`, { status: "doing" });
    if (idea) db.query("UPDATE ideas SET status = 'jobbed', job_id = ?, updated_at = ? WHERE id = ?").run(id, stamp, idea.id);
    runTurn(id, prompt).catch((e) => {
      addEvent(id, { type: "error", text: errText(e) });
      setStatus(id, "failed", { error: errText(e) });
    });
    return job(id);
  }

  /** queue: while the agent works, wait for the turn to end instead of refusing. interrupt: cancel the turn, then send.
   *  force: send even though the cache is cold (else 428, so the app can warn first). */
  async function prompt(idIn: string, text: string, opts: { plan?: boolean; queue?: boolean; interrupt?: boolean; force?: boolean; steer?: boolean } = {}) {
    const id = jobNum(idIn);
    const r = row(id);
    const t = String(text ?? "").trim();
    if (!t) throw new ApiError(400, "Say something.");
    if (r.status === "done" && !opts.force) throw new ApiError(409, "This job is done. Move it back from Completed to carry on, or start a new one.");
    let l = live.get(id);
    // Steer: into the running turn, read at the agent's next step. When it can't, the message queues.
    if (opts.steer && l?.turn && await steerInto(id, l, t)) return job(id);
    if (l?.turn || l?.awake) {
      if (opts.interrupt && l.turn) {
        await cancel(idIn);
        // Wait for the cancelled turn to wind down (the cancel itself gives up after 20 s).
        for (let i = 0; i < 40 && live.get(id)?.turn; i++) await Bun.sleep(500);
        l = live.get(id);
      }
      if (l?.turn || l?.awake) {
        if (!opts.queue && !opts.interrupt) throw new ApiError(409, "The agent is still working. Wait, or cancel the turn first.");
        const m = meta(id);
        const q = [...(m.queue ?? []), { id: `q_${randomBytes(4).toString("hex")}`, text: clip(t, 20000), at: iso() }].slice(-10);
        saveMeta(id, { queue: q });
        setJob(id, {});
        return job(id);
      }
    }
    if (!l && !r.session_id && !meta(id).fresh) throw new ApiError(409, "This job never started a session.");
    // He sees how long the cache has been cold and how much the next message will re-read.
    const c = cacheOf(id, r, meta(id));
    if (c.state === "cold" && !opts.force) {
      const mins = Math.round((Date.now() - Date.parse(c.warmUntil!)) / 60_000);
      throw new ApiError(428, `The prompt cache went cold ${mins < 1 ? "just now" : mins < 120 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`}. This message makes ${r.engine === "codex" ? "Codex" : "Claude"} re-read the whole chat${c.tokens ? ` (about ${Math.round(c.tokens / 1000)}k tokens)` : ""} at full price.`);
    }
    if (typeof opts.plan === "boolean") setSettings(id, { plan: opts.plan });
    // Talking to a completed or archived job brings it back to the board.
    if (meta(id).lane) saveMeta(id, { lane: null, laneAt: iso() });
    if (r.status === "done") db.query("UPDATE jobs SET status = 'stopped', finished_at = NULL WHERE id = ?").run(id);
    try { await runTurn(id, t); } catch (e) {
      addEvent(id, { type: "error", text: errText(e) });
      setStatus(id, "failed", { error: errText(e) });
      throw new ApiError(502, `Couldn't reopen the session: ${errText(e)}`);
    }
    return job(id);
  }
  function setSettings(id: number, b: { mode?: unknown; plan?: unknown; driver?: unknown; model?: unknown; effort?: unknown }) {
    const r = row(id);
    const l = live.get(id);
    if (b.effort !== undefined) {
      const effort = asEffort(r.engine, b.effort);
      if (effort !== (meta(id).effort ?? null)) {
        if (l?.turn) throw new ApiError(409, "Wait for the turn to finish before changing the effort.");
        saveMeta(id, { effort });
        // Same as a model switch: in place when the engine can, else the next prompt resumes the session with the new effort.
        if (l && !l.closed) {
          const swap = l.driver.setEffort?.(effort);
          if (!swap) stopProc(id);
          else swap.then((ok) => { if (!ok && live.get(id) === l && !l.turn) stopProc(id); }, () => { if (live.get(id) === l && !l.turn) stopProc(id); });
          if (!swap && LIVE.includes(r.status)) setStatus(id, "stopped");
        }
        addEvent(id, { type: "status", status: row(id).status, text: `Effort: ${effort ?? "default"}` });
      }
    }
    if (b.model !== undefined) {
      const model = asModel(b.model);
      if (model !== (meta(id).model ?? null)) {
        if (l?.turn) throw new ApiError(409, "Wait for the turn to finish before switching models.");
        saveMeta(id, { model });
        // A live engine switches in place when it can; otherwise it closes and the next prompt resumes the same session on the new model.
        if (l && !l.closed) {
          const swap = l.driver.setModel?.(model);
          if (!swap) stopProc(id);
          else swap.then((ok) => { if (!ok && live.get(id) === l && !l.turn) stopProc(id); }, () => { if (live.get(id) === l && !l.turn) stopProc(id); });
          if (!swap && LIVE.includes(r.status)) setStatus(id, "stopped");
        }
        addEvent(id, { type: "status", status: row(id).status, text: `Model: ${model ?? "default"}` });
      }
    }
    if (b.driver !== undefined) {
      const d = pickDriver(b.driver);
      if (d !== meta(id).driver) {
        if (l?.turn) throw new ApiError(409, "Wait for the turn to finish before switching drivers.");
        if (d === "acp") acpAdapter(r.engine);
        stopProc(id); // the next prompt reopens the same session on the other driver
        if (LIVE.includes(r.status)) setStatus(id, "stopped", {}, `Switched to the ${d === "acp" ? "ACP" : "native"} driver`);
        saveMeta(id, { driver: d, ...(d === "acp" ? { plan: false } : {}) });
      }
    }
    if (b.plan !== undefined) {
      const plan = !!b.plan;
      if (plan && meta(id).driver === "acp") throw new ApiError(400, "Plan mode needs the native driver.");
      saveMeta(id, { plan });
    }
    if (b.mode !== undefined) {
      const mode = asPerm(b.mode);
      if (mode !== asPerm(r.mode)) { db.query("UPDATE jobs SET mode = ? WHERE id = ?").run(mode, id); l?.driver.setPerm(mode).catch(() => {}); }
    }
    setJob(id, {});
  }
  function settings(idIn: string, b: any) {
    const id = jobNum(idIn);
    setSettings(id, b ?? {});
    return job(id);
  }
  function permission(idIn: string, b: any) {
    const id = jobNum(idIn);
    const l = live.get(id);
    const p = l?.pending.get(String(b.requestId ?? ""));
    if (!p) throw new ApiError(409, "That request is no longer open.");
    const opt = p.perm.options.find((x) => x.optionId === b.optionId);
    if (!opt) throw new ApiError(400, "Unknown option.");
    if (p.perm.html && opt.optionId === "submit") {
      // An HTML form: whatever fields it had, as text (several values joined).
      const given = b.answers && typeof b.answers === "object" ? b.answers : {};
      const answers: Record<string, string> = {};
      for (const [k, v] of Object.entries(given).slice(0, 200)) {
        const s = (Array.isArray(v) ? v.map(String).join(", ") : String(v ?? "")).trim();
        if (s) answers[clip(String(k), 200)] = clip(s, 8000);
      }
      if (!Object.keys(answers).length) throw new ApiError(400, "Answer at least one question, or skip.");
      p.perm.answers = answers;
    } else if (p.perm.form && opt.optionId === "submit") {
      const given = b.answers && typeof b.answers === "object" ? b.answers : {};
      const answers: Record<string, string> = {};
      for (const q of p.perm.form) { const a = String(given[q.question] ?? "").trim(); if (a) answers[q.question] = clip(a, 4000); }
      if (!Object.keys(answers).length) throw new ApiError(400, "Answer at least one question, or skip.");
      p.perm.answers = answers;
    }
    l!.pending.delete(p.perm.requestId);
    p.perm.decided = opt.optionId;
    touched(id, p.seq);
    // An approved plan ends plan mode for the next turns too.
    if (p.perm.kind === "plan" && opt.kind.startsWith("allow")) saveMeta(id, { plan: false });
    p.resolve(opt.optionId);
    setStatus(id, l!.pending.size ? "needs_input" : "running");
    if (!l!.pending.size && meta(id).progress?.state === "needs_input") setProgress(id, withState(meta(id).progress ?? null, "running"));
    return job(id);
  }
  async function cancel(idIn: string) {
    const id = jobNum(idIn);
    const l = live.get(id);
    if (!l?.turn) return job(id);
    for (const [k, p] of l.pending) { p.perm.decided = "cancelled"; touched(id, p.seq); p.resolve(null); l.pending.delete(k); }
    await l.driver.cancel().catch(() => {});
    // Some engines finish the prompt late or never after a cancel; don't leave the job looking busy.
    setTimeout(() => { if (live.get(id) === l && l.turn && row(id).status !== "idle") { stopProc(id); setStatus(id, "stopped", {}, "Cancelled"); } }, 20_000);
    return job(id);
  }
  function stop(idIn: string) {
    const id = jobNum(idIn);
    stopProc(id);
    const r = row(id);
    if (LIVE.includes(r.status)) setStatus(id, "stopped");
    flushDisk();
    return job(id);
  }
  function done(idIn: string, b: any) {
    const id = jobNum(idIn);
    stopProc(id);
    setStatus(id, "done", { finished_at: iso() });
    if (b?.completeTasks) for (const x of db.query("SELECT t.id, t.status FROM job_tasks j JOIN tasks t ON t.id = j.task_id WHERE j.job_id = ?").all(id) as any[])
      if (!["done", "dropped"].includes(x.status)) o.store.patchTask(`t${x.id}`, { status: "done" });
    flushDisk();
    return job(id);
  }

  async function steerInto(id: number, l: Live, text: string) {
    if (!l.driver.steer || !(await l.driver.steer(text).catch(() => false))) return false;
    addEvent(id, { type: "user", text: clip(text, 20000), steer: true, turn: meta(id).turns.at(-1)?.n });
    return true;
  }
  /** The next queued message, sent as its own turn. False when nothing waits. */
  function drainQueue(id: number) {
    const q = meta(id).queue ?? [];
    if (!q.length) return false;
    const [next, ...rest] = q;
    saveMeta(id, { queue: rest });
    runTurn(id, next.text).catch((e) => { addEvent(id, { type: "error", text: errText(e) }); setStatus(id, "failed", { error: errText(e) }); });
    return true;
  }
  /** The queue: remove one, clear, change one's text, or steer one into the running turn now. */
  async function queue(idIn: string, b: any) {
    const id = jobNum(idIn);
    let q = meta(id).queue ?? [];
    if (b?.clear) q = [];
    else if (b?.remove) q = q.filter((x) => x.id !== String(b.remove));
    else if (b?.edit) {
      const t = String(b.text ?? "").trim();
      if (!t) throw new ApiError(400, "Say something.");
      q = q.map((x) => (x.id === String(b.edit) ? { ...x, text: clip(t, 20000) } : x));
    } else if (b?.steer) {
      const item = q.find((x) => x.id === String(b.steer));
      if (!item) throw new ApiError(404, "That message already went.");
      const l = live.get(id);
      if (!l?.turn) throw new ApiError(409, "The turn already ended; it goes next anyway.");
      if (!(await steerInto(id, l, item.text))) throw new ApiError(409, `${row(id).engine === "codex" ? "This Codex" : "This"} session can't take a message mid-turn; it stays queued.`);
      q = (meta(id).queue ?? []).filter((x) => x.id !== item.id);
    }
    saveMeta(id, { queue: q });
    setJob(id, {});
    return job(id);
  }

  /** The board: move a job one lane (swipes), star it, flag it for review, keep its cache warm (hours, 0 = off, null = settings). */
  async function board(idIn: string, b: any) {
    const id = jobNum(idIn);
    const r = row(id);
    const m = meta(id);
    if (b?.starred !== undefined) m.starred = !!b.starred;
    if (b?.review !== undefined) m.review = !!b.review;
    // keepWarm: hours, true (the settings' hours), 0/false (off), null (follow the settings).
    if (b?.keepWarm !== undefined) {
      const h = b.keepWarm === true ? S.keepWarmHours : Number(b.keepWarm);
      m.keepWarm = b.keepWarm === null ? null : !h ? "off" : new Date(Date.now() + num(h, 0.25, 48, 2) * 3_600_000).toISOString();
    }
    saveMeta(id);
    const to = b?.lane as Lane | undefined;
    if (to && !["working", "attention", "completed", "archived"].includes(to)) throw new ApiError(400, "lane is working, attention, completed or archived.");
    const from = laneOf(r, m);
    if (to === "completed" || to === "archived") {
      if (live.get(id)?.turn) throw new ApiError(409, "It's still working. Stop it first.");
      stopProc(id);
      if (LIVE.includes(r.status)) setStatus(id, "stopped");
      saveMeta(id, { lane: to, laneAt: iso(), ...(to === "archived" ? { review: false } : {}) });
    } else if (to === "attention") {
      if (from === "working") stop(idIn);
      saveMeta(id, { lane: null, laneAt: iso() });
      if (row(id).status === "done") db.query("UPDATE jobs SET status = 'stopped', finished_at = NULL WHERE id = ?").run(id);
    } else if (to === "working") {
      saveMeta(id, { lane: null, laneAt: iso() });
      if (row(id).status === "done") db.query("UPDATE jobs SET status = 'stopped', finished_at = NULL WHERE id = ?").run(id);
      const st = row(id).status;
      if (st === "stopped" || st === "failed") await prompt(idIn, "Carry on where you left off.", { force: !!b.force });
    }
    setJob(id, {});
    return job(id);
  }

  /** Go back to before turn n: files from its checkpoint; a native Claude session forks at the previous turn's last
   *  message, so the conversation forgets the later turns too. Returns turn n's message (Edit puts it in the composer). */
  /** mode: "both" (default), "code" (files only, the chat keeps going), "chat" (the conversation only, files stay). */
  async function rewind(idIn: string, b: any) {
    const id = jobNum(idIn);
    const r = row(id);
    if (live.get(id)?.turn) throw new ApiError(409, "Wait for the agent to finish, or stop the turn, before rewinding.");
    const m = meta(id);
    const mode: "both" | "code" | "chat" = b?.mode === "code" || b?.mode === "chat" ? b.mode : "both";
    const canChat = r.engine === "claude" && m.driver === "native";
    if (mode === "chat" && !canChat) throw new ApiError(409, "Only Claude chats can forget turns; rewind the code instead.");
    const n = Number(b?.turn);
    const t = m.turns.find((x) => x.n === n && !x.dropped);
    if (!t) throw new ApiError(404, "No such turn to rewind to.");
    if (mode !== "chat" && t.before && !(await ckpt.has(id, r.cwd, t.before))) throw new ApiError(409, "This job's file checkpoints aren't on this PC any more, so its changes can't be shown or put back.");
    const files = mode !== "chat" && t.before ? await ckpt.restore(id, r.cwd, t.before) : null;
    const prev = m.turns.filter((x) => x.n < n && !x.dropped).at(-1);
    stopProc(id);
    let conversation: "forked" | "fresh" | "kept" = "kept";
    if (mode !== "code" && canChat) {
      if (prev?.endUuid) { m.resumeAt = prev.endUuid; conversation = "forked"; }
      else if (!prev) { m.fresh = true; conversation = "fresh"; }
    }
    const evs = load(id);
    const text = evs.find((e) => e.seq === t.seq)?.text ?? "";
    // The chat forgets the later turns only when the conversation went back; a code-only rewind leaves them in view.
    if (conversation !== "kept") {
      for (const x of m.turns) if (x.n >= n) { x.dropped = true; x.reverted = true; }
      m.dropped = [...(m.dropped ?? []), [t.seq, evs.at(-1)?.seq ?? t.seq]];
      m.queue = [];
    } else if (files) for (const x of m.turns) if (x.n >= n) x.reverted = true;
    m.note = conversation === "kept"
      ? files ? `(Note from Agentic OS: The user put the files back as they were before their message "${clip(text.replace(/\s+/g, " "), 100)}". The conversation is unchanged, but the file changes made since then are gone: re-read any file before you edit it.)` : null
      : files ? "(Note from Agentic OS: the files were put back as they were at this point. Re-read any file before you edit it.)"
      : mode === "chat" ? "(Note from Agentic OS: the conversation was rewound to this point, but the files were not: they may still have changes from turns you no longer remember. Check git status or re-read files before you edit them.)" : null;
    saveMeta(id);
    if (LIVE.includes(r.status) || r.status === "done") setStatus(id, "stopped");
    const what = mode === "code" ? "Code rewound" : mode === "chat" ? "Chat rewound" : "Rewound";
    addEvent(id, { type: "status", status: row(id).status, text: `${what} to before turn ${n}${files ? `: ${files.restored} files restored, ${files.removed} removed` : mode !== "chat" && t.before === null && !t.ping ? " (no file checkpoint for that turn)" : ""}.${conversation === "kept" && mode !== "code" ? " The conversation still remembers the later turns." : ""}` });
    flushDisk();
    setJob(id, {});
    return { job: job(id), text, conversation, files };
  }

  /** A new job that carries on from the end of turn n of this one: same folder and settings, the Claude session forked
   *  there, the chat so far copied. This job is untouched. */
  async function fork(idIn: string, b: any) {
    const id = jobNum(idIn);
    const r = row(id);
    const m = meta(id);
    if (!(r.engine === "claude" && m.driver === "native")) throw new ApiError(409, "Forking works for Claude chats.");
    const n = Number(b?.turn) || m.turns.filter((x) => !x.dropped).at(-1)?.n || 0;
    const t = m.turns.find((x) => x.n === n && !x.dropped);
    if (!t) throw new ApiError(404, "No such turn to fork from.");
    if (!t.endUuid || !r.session_id) throw new ApiError(409, t.n === m.turns.at(-1)?.n && live.get(id)?.turn ? "That turn is still running. Fork when it ends." : "That turn is from before forking existed; fork from a newer one.");
    const evs = load(id);
    const next = m.turns.find((x) => x.n > n);
    const upTo = next ? next.seq - 1 : evs.at(-1)?.seq ?? t.seq;
    const stamp = iso();
    const nid = (db.query(`INSERT INTO jobs (title, engine, project, cwd, context, mode, status, idea_id, created_at, updated_at, session_id, prompt, summary)
      VALUES (?, ?, ?, ?, ?, ?, 'stopped', NULL, ?, ?, ?, ?, ?) RETURNING id`).get(clip(`${r.title ?? `j${id}`} (fork)`, 120), r.engine, r.project, r.cwd, r.context, r.mode, stamp, stamp, r.session_id, r.prompt, r.summary) as any).id as number;
    for (const ext of ["jsonl", "meta.json"]) { const f = join(dir, `${nid}.${ext}`); if (existsSync(f)) renameSync(f, `${f}.old-${Date.now()}`); }
    metas.delete(nid);
    // Checkpoints belong to the old job's snapshot store, so the copied turns have none.
    const turns = m.turns.filter((x) => x.n <= n && !x.dropped).map((x) => ({ ...x, before: null, after: null }));
    saveMeta(nid, { driver: m.driver, plan: false, model: m.model ?? null, effort: m.effort ?? null, usage: m.usage, turns, ckptError: "Forked: turns before the fork have no file checkpoints.",
      note: null, progress: null, resumeAt: t.endUuid, lastCallAt: m.lastCallAt ?? null, cache: m.cache ?? null, git: m.git });
    const copied = evs.filter((e) => e.seq <= upTo && !(m.dropped ?? []).some(([a, z]) => e.seq >= a && e.seq <= z))
      .filter((e) => e.type !== "permission" || e.permission?.decided).map((e) => ({ ...e }));
    events.set(nid, copied);
    writeFileSync(join(dir, `${nid}.jsonl`), copied.map((e) => JSON.stringify(e)).join("\n") + (copied.length ? "\n" : ""));
    addEvent(nid, { type: "status", status: "stopped", text: `Forked from j${id} after turn ${n}. Send a message to carry on from there.` });
    addEvent(id, { type: "status", status: r.status, text: `Forked after turn ${n} into j${nid}.` });
    flushDisk();
    setJob(nid, {});
    return job(nid);
  }

  /** publish_changes and ship_status calls. */
  async function onTool(id: number, tool: ExtraTool, args: any): Promise<{ ok: boolean; text: string }> {
    if (tool === "ship_status") return builders.report(id, args ?? {});
    if (tool === "ask_form") return askForm(id, args ?? {});
    const r = row(id);
    const summary = String(args?.summary ?? "").trim();
    if (!summary) return { ok: false, text: "publish_changes needs a summary." };
    const s = await builders.request({ jobId: id, title: r.title ?? `j${id}`, project: r.project ?? null, cwd: r.cwd ?? null, summary, deploy: args?.deploy !== false, notes: args?.notes ? String(args.notes) : null });
    setJob(id, {});
    return { ok: true, text: `Queued as ${s.id} for the ${s.key === "_global" ? "global" : `${r.project}`} Builder${s.waiting ? `, after ${s.waiting} other request${s.waiting === 1 ? "" : "s"}` : ""}. The user sees its state on the board. You can end your turn.` };
  }

  /** ask_form: the form waits on the phone like any question; the answers go back as JSON. */
  async function askForm(id: number, a: any): Promise<{ ok: boolean; text: string }> {
    let html = typeof a.html === "string" ? a.html : "";
    if (!html && a.path) {
      const cwd = row(id).cwd ?? "";
      const f = resolvePath(cwd, String(a.path));
      try {
        if (statSync(f).size > 400_000) return { ok: false, text: "That file is over 400 KB; keep the form small." };
        html = readFileSync(f, "utf8");
      } catch { return { ok: false, text: `Couldn't read ${a.path}.` }; }
    }
    if (!html.trim()) return { ok: false, text: "ask_form needs html or a path to an .html file." };
    if (html.length > 400_000) return { ok: false, text: "The form is over 400 KB; keep it small." };
    let perm: PermEv | null = null;
    const pick = await onPermission(id, { title: clip(String(a.title ?? "").trim() || "A form for you", 200), kind: "question", options: FORM_OPTIONS }, undefined, (p) => { p.html = html; perm = p; });
    if (pick !== "submit") return { ok: true, text: "The user skipped the form. Carry on with your best judgement, or ask again in plain text." };
    return { ok: true, text: JSON.stringify((perm as PermEv | null)?.answers ?? {}) };
  }

  /** Keep-warm: an idle job whose cache is about to go cold gets a one-word ping turn, while keep-warm lasts. */
  const pinging = new Set<number>();
  function warmTick() {
    if (!o.store.hasV7()) return;
    const now = Date.now();
    for (const r of db.query("SELECT * FROM jobs WHERE status IN ('idle','stopped') AND session_id IS NOT NULL").all() as any[]) {
      const m = meta(r.id);
      // Builders are never kept warm: a cold one hands over to a fresh Builder with a summary, which is cheaper.
      if (m.lane || m.fresh || m.role === "builder" || pinging.has(r.id) || live.get(r.id)?.turn || m.driver === "acp") continue;
      const until = keepWarmUntil(r.id, m);
      const last = m.lastCallAt ? Date.parse(m.lastCallAt) : NaN;
      if (!until || until < now || !Number.isFinite(last)) continue;
      const ttl = ttlOf(r.engine);
      // In the window before it goes cold; once cold a ping would just pay for a full re-read.
      if (now < last + ttl - S.leadMin * 60_000 || now > last + ttl - 30_000) continue;
      pinging.add(r.id);
      runTurn(r.id, PING_TEXT, true)
        .catch((e) => { addEvent(r.id, { type: "status", status: row(r.id).status, text: `Keep-warm ping failed: ${errText(e)}` }); })
        .finally(() => setTimeout(() => pinging.delete(r.id), 5 * 60_000));
    }
  }
  setInterval(warmTick, 60_000);

  /** Daily-ish cleanup: jobs live for autoArchiveDays move to Archive; archived jobs lose their checkpoints after ckptDropDays. */
  function cleanupTick() {
    if (!o.store.hasV7()) return;
    const now = Date.now();
    for (const r of db.query("SELECT * FROM jobs").all() as any[]) {
      const m = meta(r.id);
      if (m.lane !== "archived" && !live.get(r.id)?.turn && m.role !== "builder") {
        const s = builders.latest(r.id);
        if (s?.state === "live" && s.doneAt && now - Date.parse(s.doneAt) > S.autoArchiveDays * DAY) {
          stopProc(r.id);
          if (LIVE.includes(r.status)) setStatus(r.id, "stopped");
          saveMeta(r.id, { lane: "archived", laneAt: iso() });
          addEvent(r.id, { type: "status", status: row(r.id).status, text: `Archived: live for ${S.autoArchiveDays} days.` });
          setJob(r.id, {});
          continue;
        }
      }
      if (m.lane === "archived" && !m.ckptDropped && m.laneAt && now - Date.parse(m.laneAt) > S.ckptDropDays * DAY) {
        try { ckpt.drop(r.id); } catch { continue; }
        for (const t of m.turns) { t.before = null; t.after = null; }
        saveMeta(r.id, { ckptDropped: true, ckptError: "Checkpoints deleted a week after archiving." });
      }
    }
    flushDisk();
  }
  setTimeout(cleanupTick, 60_000);
  setInterval(cleanupTick, 3 * 3_600_000);

  /** Turns with their checkpoint state. */
  function turns(idIn: string) {
    const id = jobNum(idIn);
    row(id);
    const m = meta(id);
    return { turns: m.turns.map((t) => ({ n: t.n, at: t.at, files: t.files ?? null, reverted: !!t.reverted, checkpoint: !!t.before })), error: m.ckptError ?? null };
  }
  /** Files changed in turn n (n = 0: the whole job). While a turn runs, or when it has no "after" yet, the end is the folder now. */
  async function diff(idIn: string, n: number, file?: string | null) {
    const id = jobNum(idIn);
    const r = row(id);
    const m = meta(id);
    const span = n > 0 ? m.turns.filter((t) => t.n === n) : m.turns;
    const first = span.find((t) => t.before);
    if (!first?.before) throw new ApiError(404, m.ckptError ? `No checkpoint: ${m.ckptError}` : "No checkpoint for that turn.");
    if (!(await ckpt.has(id, r.cwd, first.before))) throw new ApiError(409, "This job's file checkpoints aren't on this PC any more, so its changes can't be shown or put back.");
    const last = span.at(-1)!;
    const busy = !!live.get(id)?.turn;
    let to = !busy && last.after ? last.after : null;
    if (!to) {
      const s = await ckpt.snapshot(id, r.cwd);
      if (!s.tree) throw new ApiError(500, s.error ?? "Couldn't read the folder.");
      to = s.tree;
    }
    const files = await ckpt.changes(id, r.cwd, first.before, to);
    const patch = files.length ? await ckpt.patch(id, r.cwd, first.before, to, file ?? undefined) : "";
    return { turn: n, files, patch: patch.length > 400_000 ? patch.slice(0, 400_000) + "\n… (cut at 400 KB)" : patch, live: busy || !last.after };
  }
  /** Put the folder back to how it was before turn n. Later turns' changes go too. */
  async function revert(idIn: string, n: number) {
    const id = jobNum(idIn);
    const r = row(id);
    if (live.get(id)?.turn) throw new ApiError(409, "Wait for the agent to finish, or interrupt it, before reverting.");
    const m = meta(id);
    const t = m.turns.find((x) => x.n === n);
    if (!t?.before) throw new ApiError(404, "No checkpoint for that turn.");
    if (!(await ckpt.has(id, r.cwd, t.before))) throw new ApiError(409, "This job's file checkpoints aren't on this PC any more, so its changes can't be shown or put back.");
    const res = await ckpt.restore(id, r.cwd, t.before);
    for (const x of m.turns) if (x.n >= n) x.reverted = true;
    saveMeta(id, { note: `(Note from Agentic OS: The user put the files back to how they were before turn ${n}. Re-read any file before you edit it.)` });
    addEvent(id, { type: "status", status: r.status, text: `Files put back to before turn ${n}: ${res.restored} restored, ${res.removed} removed.` });
    flushDisk();
    return { job: job(id), ...res };
  }

  function list(q: { project?: string | null; live?: boolean; limit?: number } = {}) {
    if (!o.store.hasV7()) return [];
    const where: string[] = [], vals: any[] = [];
    if (q.project) { where.push("project = ?"); vals.push(q.project); }
    if (q.live) where.push("status IN ('starting','running','needs_input','idle')");
    return (db.query(`SELECT * FROM jobs ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY status IN ('starting','running','needs_input','idle') DESC, id DESC LIMIT ?`).all(...vals, q.limit ?? 200) as any[]).map(shape);
  }
  function get(idIn: string) {
    const id = jobNum(idIn);
    flushSse();
    return { job: job(id), events: load(id).map(publicEvent) };
  }
  /** SSE: `event: job` (Job) and `event: ev` (JobEvent). Events with seq >= after are sent first (the one at `after` again,
   *  in case it grew), then live changes. A comment line every 15 s keeps proxies from closing it. */
  function stream(idIn: string, after: number, signal: AbortSignal) {
    const id = jobNum(idIn);
    row(id);
    const enc = new TextEncoder();
    let ka: ReturnType<typeof setInterval> | null = null;
    let sub: { send: (ev: string, data: unknown) => void } | null = null;
    const cleanup = () => { if (ka) clearInterval(ka); ka = null; if (sub) subs.get(id)?.delete(sub); sub = null; };
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        const send = (ev: string, data: unknown) => c.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`));
        flushSse();
        c.enqueue(enc.encode("retry: 2000\n\n"));
        send("job", job(id));
        for (const e of load(id)) if (e.seq >= after) send("ev", publicEvent(e));
        sub = { send };
        (subs.get(id) ?? subs.set(id, new Set()).get(id)!).add(sub);
        ka = setInterval(() => { try { c.enqueue(enc.encode(": keep-alive\n\n")); } catch { cleanup(); } }, 15_000);
        signal.addEventListener("abort", () => { cleanup(); try { c.close(); } catch {} });
      },
      cancel: cleanup,
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
  }
  const byNative = () => new Map((db.query("SELECT id, native_id FROM jobs WHERE native_id IS NOT NULL").all() as any[]).map((r) => [String(r.native_id), `j${r.id}`]));
  /** Stop every live job working in this folder or below it (a copy about to be deleted). Waits for the processes to end. */
  async function stopUnder(folder: string, isInside: (p: string, dir: string) => boolean) {
    const ids = [...live.keys()].filter((id) => { try { return isInside(String(row(id).cwd ?? ""), folder); } catch { return false; } });
    const waits = ids.map((id) => live.get(id)!.driver.exited.catch(() => null));
    for (const id of ids) { stopProc(id); try { setStatus(id, "stopped", {}, "Stopped: its copy was closed"); } catch {} }
    await Promise.race([Promise.all(waits), Bun.sleep(5000)]);
    flushDisk();
    return ids.length;
  }
  /** A restart kills every engine process: whatever was live is now stopped (and resumable). Each chat says why, and
   *  a push names the jobs that were cut off mid-work rather than resting between turns. */
  function markInterrupted() {
    if (!o.store.hasV7()) return;
    const rows = db.query(`SELECT id, title, status FROM jobs WHERE status IN ('starting','running','needs_input','idle')`).all() as any[];
    if (!rows.length) return;
    db.query(`UPDATE jobs SET status = 'stopped', updated_at = ? WHERE status IN ('starting','running','needs_input','idle')`).run(iso());
    const at = new Date().toTimeString().slice(0, 5);
    const cut: string[] = [];
    for (const r of rows) {
      const busy = r.status !== "idle";
      if (busy) cut.push(`j${r.id}`);
      addEvent(r.id, { type: "status", status: "stopped", text: busy
        ? `Cut off: the job server restarted at ${at} while this job was ${r.status === "needs_input" ? "waiting for you" : "working"}. Work so far is saved; send a message to carry on.`
        : `Stopped: the job server restarted at ${at}. This job had already finished its turn, so nothing was lost.` });
    }
    flushDisk();
    if (cut.length) o.push(`Server restart cut off ${cut.length === 1 ? "a job" : `${cut.length} jobs`}`, cut.join(", "),
      { kind: "job", event: "failed", jobId: cut[0], url: `agenticos://job/${cut[0]}` }).catch(() => {});
  }
  markInterrupted();

  /** Builders for the board: every project with a folder, the global one, and any configured before. */
  function builderList() {
    const slugs = (db.query("SELECT slug FROM projects WHERE folder IS NOT NULL AND status NOT IN ('archived','dropped','done')").all() as any[]).map((r) => String(r.slug));
    return builders.list(slugs).map((b) => {
      let jobShape: any = null;
      try { jobShape = b.jobId ? job(jobNum(b.jobId)) : null; } catch {}
      return { ...b, job: jobShape };
    });
  }
  /** Change a Builder's model, effort or notes; a running Builder job switches for its next turn. */
  function builderConfigure(key: string, b: any) {
    const c = builders.configure(key, b ?? {});
    if (c.jobId && (b?.model !== undefined || b?.effort !== undefined)) {
      try { setSettings(jobNum(c.jobId), { ...(b.model !== undefined ? { model: c.model } : {}), ...(b.effort !== undefined ? { effort: c.effort } : {}) }); } catch {}
    }
    return builderList().find((x) => x.key === key);
  }

  function shutdown() { for (const id of [...live.keys()]) { stopProc(id); try { setStatus(id, "stopped"); } catch {} } flushDisk(); }
  return { create: (b: any) => create(b), prompt, permission, cancel, stop, done, settings, turns, diff, revert, list, get, stream, byNative, stopUnder, shutdown,
    board, queue, rewind, fork, builderList, builderConfigure, boardSettings: () => S, setBoardSettings: setSettingsAll };
}
export type Jobs = ReturnType<typeof openJobs>;

// Claude for the phone app. Runs `claude -p` on the PC with the owner's Claude subscription, so there is no API bill.
// The model sees a JSON snapshot of one user's agentos data and has no tools: it can only return a proposal,
// which the phone shows as rows to tick before anything changes. "Give to Claude" hands a task to the
// agent-jobs runner in Agentic OS (localhost:8081), which runs Claude Code in its own task folder.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ApiError, OFFSET, istDate, type Store } from "./store";
import type { User } from "./auth";

const CLAUDE = process.env.CLAUDE_BIN || "claude";
const OS_URL = process.env.AGENTIC_OS_URL || "http://127.0.0.1:8081";
const bad = (m: string) => new ApiError(400, m);

// ── claude -p, at most two at a time ────────────────────────────────────────
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

export function openAI(dataDir: string) {
  const dir = join(dataDir, "ai");
  const scratch = join(dir, "scratch");
  mkdirSync(scratch, { recursive: true });

  async function claude({ model, system, prompt, schema, timeout = 90_000 }: { model: "haiku" | "sonnet"; system: string; prompt: string; schema: object; timeout?: number }) {
    return slot(async () => {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v != null && !k.startsWith("CLAUDECODE") && !k.startsWith("CLAUDE_CODE_")) env[k] = v;
      env.MAX_THINKING_TOKENS = model === "haiku" ? "0" : "2000";
      const t0 = Date.now();
      const p = Bun.spawn([CLAUDE, "-p", "--model", model, "--safe-mode", "--tools=", "--strict-mcp-config", "--setting-sources", "project",
        "--no-session-persistence", "--output-format", "json", "--json-schema", JSON.stringify(schema)],
        { cwd: scratch, env, stdin: new Blob([`${system}

Reply only by calling the StructuredOutput tool with JSON that matches its schema. Never answer in prose.

${prompt}`]), stdout: "pipe", stderr: "pipe" });
      const timer = setTimeout(() => p.kill(), timeout);
      const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
      clearTimeout(timer);
      await p.exited;
      let j: any = null;
      try { j = JSON.parse(out); } catch {}
      if (j) console.log(`[ai] ${model} ${Date.now() - t0}ms (api ${j.duration_api_ms}ms, thinking ${j.usage?.output_tokens_details?.thinking_tokens ?? 0} tokens)`);
      // Haiku now and then answers in plain JSON text instead of the structured tool; accept that too.
      if (j && !j.is_error && !j.structured_output) {
        const m = String(j.result ?? "").match(/\{[\s\S]*\}/);
        try { if (m) j.structured_output = JSON.parse(m[0]); } catch {}
      }
      if (!j || j.is_error || !j.structured_output) {
        console.error("[ai] claude failed", p.exitCode, err.slice(0, 400), j ? `${j.stop_reason} ${j.num_turns} ${String(j.result).slice(0, 600)} denials=${JSON.stringify(j.permission_denials).slice(0, 300)}` : out.slice(0, 400));
        throw new ApiError(502, p.signalCode ? "Claude took too long. Try again." : "Claude couldn't answer that. Try again.");
      }
      return { out: j.structured_output, ms: Date.now() - t0, model };
    });
  }

  // ── per-user memory: weekly moves and which agent job belongs to which task ──
  const fileOf = (u: User) => join(dir, `user-${u.id}.json`);
  const load = (u: User): { review?: any; agents: Record<string, any> } => {
    try { return { agents: {}, ...JSON.parse(readFileSync(fileOf(u), "utf8")) }; } catch { return { agents: {} }; }
  };
  const store = (u: User, v: any) => { const tmp = `${fileOf(u)}.tmp`; writeFileSync(tmp, JSON.stringify(v, null, 1)); renameSync(tmp, fileOf(u)); };

  // ── what the model sees ───────────────────────────────────────────────────
  const hhmm = (isoStr: string) => new Date(Date.parse(isoStr) + OFFSET * 60000).toISOString().slice(11, 16);
  const dateOf = (isoStr: string) => istDate(new Date(isoStr));
  function snapshot(s: Store) {
    const b = s.bootstrap();
    const today = b.today.date;
    const open = b.today.tasks.filter((t: any) => ["inbox", "todo", "doing"].includes(t.status));
    return {
      today, weekday: b.today.weekday, now: hhmm(new Date().toISOString()), timezone: "Asia/Kolkata",
      areas: b.areas.map((a: any) => ({ slug: a.slug, name: a.name })),
      tasks: open.map((t: any) => ({
        id: t.id, title: t.title, status: t.status, area: t.area, due: t.due, minutes: t.estimateMinutes,
        planned: t.scheduled ? `${dateOf(t.scheduled.start)} ${hhmm(t.scheduled.start)}-${hhmm(t.scheduled.end)}` : null, goal: t.goal,
      })),
      doneRecently: b.today.tasks.filter((t: any) => t.status === "done").slice(-40).map((t: any) => ({ id: t.id, title: t.title, area: t.area, doneOn: t.completedAt ? dateOf(t.completedAt) : null })),
      calendar: b.week.days.slice(0, 2).map((d: any) => ({ date: d.date, blocks: d.events.filter((e: any) => !e.allDay).map((e: any) => `${hhmm(e.start)}-${hhmm(e.end)} ${e.title}`) })),
      goals: b.goals.goals.filter((g: any) => g.status === "active" && ["week", "month", "quarter"].includes(g.horizon)).map((g: any) => ({ id: g.id, title: g.title, horizon: g.horizon, progress: g.progress, end: g.end })),
      bootstrap: b,
    };
  }

  // ── Ask: a sentence becomes proposed changes, or an answer ────────────────
  const ASK_SCHEMA = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["changes", "answer"] },
      say: { type: "string" },
      taskRefs: { type: "array", items: { type: "string" } },
      changes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["move", "defer", "add", "done", "drop", "give"] },
            taskId: { type: "string" },
            title: { type: "string" },
            area: { type: "string" },
            date: { type: "string" },
            time: { type: "string" },
            minutes: { type: "integer" },
          },
          required: ["op"],
        },
      },
    },
    required: ["kind", "say", "taskRefs", "changes"],
  };
  const ASK_SYSTEM = `You are the assistant inside a personal day planner. The user typed or spoke one message.
Turn it into changes to their tasks, or answer it. Use only task ids from the snapshot.
Ops: move (schedule a task: taskId, date, time, optional minutes), defer (new due date, unschedules: taskId, date),
add (new task: title, optional area slug, date, time, minutes), done (taskId), drop (taskId), give (hand a task to the Claude agent: taskId).
"tomorrow", "friday", "9pm", "after class" are relative to today and now in the snapshot. If a task name is ambiguous, pick the closest open task.
Questions ("what's slipping", "when did I last...", "how much free time") get kind "answer": a short, direct answer in plain English, with taskRefs.
Dates are YYYY-MM-DD and times are HH:MM, 24-hour, India time. "say" is plain text with no markdown: the answer, or one short line about the changes.
Never invent tasks that aren't asked for. Keep "say" under 40 words.`;

  async function ask(s: Store, text: string) {
    const msg = String(text ?? "").trim();
    if (!msg) throw bad("Say or type something first.");
    if (msg.length > 1000) throw bad("Keep it under 1,000 characters.");
    const snap = snapshot(s);
    const { bootstrap: b, ...ctx } = snap;
    const r = await claude({ model: "haiku", system: ASK_SYSTEM, schema: ASK_SCHEMA, prompt: `Snapshot:\n${JSON.stringify(ctx)}\n\nMessage: ${msg}` });
    const tasks = new Map(b.today.tasks.map((t: any) => [t.id, t]));
    const areas = new Set(b.areas.map((a: any) => a.slug));
    const isDate = (d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && Math.abs(Date.parse(d) - Date.parse(snap.today)) < 60 * 864e5;
    const isTime = (t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
    const at = (d: string, t: string) => new Date(`${d}T${t}:00+05:30`).toISOString();
    const changes: any[] = [], skipped: string[] = [];
    for (const c of Array.isArray(r.out.changes) ? r.out.changes : []) {
      const t: any = c.taskId ? tasks.get(c.taskId) : null;
      if (c.op !== "add" && !t) { skipped.push(c.title || c.taskId || c.op); continue; }
      const mins = Number.isInteger(c.minutes) && c.minutes > 0 && c.minutes <= 600 ? c.minutes : t?.estimateMinutes || 30;
      if (c.op === "move") {
        const d = isDate(c.date) ? c.date : snap.today;
        if (!isTime(c.time)) { skipped.push(t.title); continue; }
        const start = at(d, c.time);
        changes.push({ op: "move", taskId: t.id, patch: { scheduled: { start, end: new Date(Date.parse(start) + mins * 60000).toISOString() }, due: d, estimateMinutes: mins } });
      } else if (c.op === "defer") {
        if (!isDate(c.date)) { skipped.push(t.title); continue; }
        changes.push({ op: "defer", taskId: t.id, patch: { due: c.date, scheduled: null, ...(t.status === "doing" ? { status: "todo" } : {}) } });
      } else if (c.op === "done") changes.push({ op: "done", taskId: t.id, patch: { status: "done", completedAt: new Date().toISOString() } });
      else if (c.op === "drop") changes.push({ op: "drop", taskId: t.id, patch: { status: "dropped" } });
      else if (c.op === "give") changes.push({ op: "give", taskId: t.id, patch: {} });
      else if (c.op === "add") {
        const title = String(c.title ?? "").trim().slice(0, 300);
        if (!title) continue;
        const d = isDate(c.date) ? c.date : isTime(c.time) ? snap.today : null;
        const start = d && isTime(c.time) ? at(d, c.time) : null;
        changes.push({ op: "add", task: {
          title, area: c.area && areas.has(c.area) ? c.area : null, due: d, estimateMinutes: mins,
          scheduled: start ? { start, end: new Date(Date.parse(start) + mins * 60000).toISOString() } : null,
        } });
      }
    }
    const refs = (Array.isArray(r.out.taskRefs) ? r.out.taskRefs : []).filter((id: string) => tasks.has(id)).slice(0, 8);
    return { kind: r.out.kind === "answer" && !changes.length ? "answer" : "changes", say: String(r.out.say ?? "").slice(0, 600), taskRefs: refs, changes, skipped, ms: r.ms, model: "Haiku" };
  }

  // ── Weekly review: three moves for next week ──────────────────────────────
  const MOVES_SCHEMA = {
    type: "object",
    properties: {
      moves: {
        type: "array", minItems: 3, maxItems: 3,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            aspect: { type: "string", enum: ["body", "mind", "soul", "mission", "money", "growth", "family", "romance", "friends"] },
            area: { type: "string" },
            why: { type: "string" },
          },
          required: ["title", "aspect", "why"],
        },
      },
    },
    required: ["moves"],
  };
  const weekKey = (date: string) => {
    const d = new Date(`${date}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5);
    return monday.toISOString().slice(0, 10);
  };
  async function review(u: User, s: Store, fresh = false) {
    const mem = load(u);
    const snap = snapshot(s);
    const week = weekKey(snap.today);
    if (!fresh && mem.review?.week === week) return mem.review;
    const b = snap.bootstrap;
    const latest = b.life.snapshots.at(-1);
    const fed = new Set<string>();
    for (const t of b.today.tasks) for (const a of b.life.areaAspects[t.area] ?? []) fed.add(a);
    const ctx = {
      today: snap.today, scores: latest?.scores ?? null, scoredOn: latest?.date ?? null,
      aspectsWithNoTasks: b.life.aspects.map((a: any) => a.key).filter((k: string) => !fed.has(k)),
      areas: snap.areas, areaAspects: b.life.areaAspects, doneThisWeek: snap.doneRecently.filter((t: any) => t.doneOn && t.doneOn >= weekKey(snap.today)),
      openTasks: snap.tasks.length, goals: snap.goals,
    };
    const r = await claude({
      model: "sonnet", schema: MOVES_SCHEMA,
      system: "You write a short weekly review for a personal planner. Pick exactly three moves for next week: concrete, small enough to do, and aimed at the life aspects that scored lowest or got no tasks, plus one that keeps the main work goal on pace. Each title is under 8 words; each why is under 12 words and comes from the data. Never assume facts that are not in the data, such as whether the user has a partner. Plain words, no hype.",
      prompt: JSON.stringify(ctx),
    });
    const areas = new Set(b.areas.map((a: any) => a.slug));
    const moves = r.out.moves.slice(0, 3).map((m: any) => ({
      title: String(m.title).slice(0, 80), aspect: m.aspect,
      area: m.area && areas.has(m.area) ? m.area : (Object.entries(b.life.areaAspects).find(([, v]) => (v as string[]).includes(m.aspect))?.[0] ?? null),
      why: String(m.why).slice(0, 120),
    }));
    mem.review = { week, moves, createdAt: new Date().toISOString() };
    store(u, mem);
    return mem.review;
  }

  // ── Give to Claude: the agent-jobs runner in Agentic OS ───────────────────
  let token: string | null = null;
  async function os(path: string, init: RequestInit = {}, retry = true): Promise<any> {
    if (!token) {
      const t = await fetch(`${OS_URL}/__token`).then((r) => r.json()).catch(() => null);
      if (!t?.token) throw new ApiError(503, "Agentic OS isn't running on the PC, so Claude can't take tasks right now.");
      token = t.token;
    }
    const r = await fetch(`${OS_URL}/__operator${path}`, { ...init, headers: { "Content-Type": "application/json", "x-claude-os-token": token!, ...(init.headers ?? {}) } }).catch(() => null);
    if (!r) throw new ApiError(503, "Agentic OS isn't running on the PC, so Claude can't take tasks right now.");
    if ((r.status === 401 || r.status === 403) && retry) { token = null; return os(path, init, false); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status >= 500 ? 502 : 400, j.error ?? "Agentic OS refused that.");
    return j;
  }
  const WORKSPACES: Record<string, { name: string; path: string | null }> = {
    "agentic-os": { name: "Agentic OS", path: join(homedir(), "agentic-os") },
    "corner-market": { name: "Corner Market", path: null },
    northwind: { name: "Northwind Studio", path: join(homedir(), "studio-brain") },
    none: { name: "No files", path: null },
  };
  let jobsCache: { at: number; jobs: any[] } | null = null;
  async function jobs(force = false) {
    if (!force && jobsCache && Date.now() - jobsCache.at < 2500) return jobsCache.jobs;
    const j = await os("/agent-jobs");
    jobsCache = { at: Date.now(), jobs: j.jobs ?? [] };
    return jobsCache.jobs;
  }
  const clean = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "").trim();
  function summarize(meta: any, job: any) {
    const run = job?.runs?.find((r: any) => r.agent === "claude");
    let state = "queued";
    if (meta.state === "done") state = "done";
    else if (!run) state = meta.state === "queued" ? "queued" : "failed";
    else if (run.status === "running") state = "running";
    else if (run.status === "needs_input") state = "needs";
    else if (run.status === "completed") state = "review";
    else if (run.status === "failed" || run.status === "cancelled") state = "failed";
    const p = run?.pending;
    const q = p?.questions?.[0];
    const text = run ? clean(run.text ?? "") : "";
    return {
      state, jobId: meta.jobId, ws: meta.ws, mode: meta.mode, check: meta.confirm, startedAt: meta.startedAt,
      log: [{ text: "Sent to your PC" }, ...(run?.events ?? []).slice(-10).map((e: any) => ({ text: e.label })), ...(meta.notes ?? [])],
      kind: p?.kind ?? null,
      question: p ? (q?.question ?? p.title ?? "Claude needs your OK") : null,
      detail: p?.detail ? clean(p.detail).slice(0, 600) : null,
      options: p ? (q?.options?.length ? q.options : p.kind === "approval" ? ["Allow", "Don't allow"] : null) : null,
      result: state === "review" || state === "done" ? text.slice(-1200) || "Finished." : state === "failed" ? run?.error ?? "Stopped." : null,
      evidence: meta.jobId ? `agentic-os/.operator-data/agent-tasks/${meta.jobId}` : null,
    };
  }
  async function agentsFor(u: User) {
    const mem = load(u);
    const ids = Object.keys(mem.agents);
    if (!ids.length) return {};
    const all = await jobs().catch(() => null);
    const out: Record<string, any> = {};
    for (const id of ids) {
      const meta = mem.agents[id];
      out[id] = all ? summarize(meta, all.find((j: any) => j.id === meta.jobId)) : { ...summarize(meta, null), state: meta.state === "done" ? "done" : "offline" };
    }
    return out;
  }
  async function give(u: User, s: Store, taskId: string, b: any) {
    const t = s.tasks().find((x: any) => x.id === taskId);
    if (!t) throw new ApiError(404, "That task is gone. Pull to refresh.");
    const ws = WORKSPACES[b.workspace] ? b.workspace : "none";
    const mode = b.mode === "edit" ? "edit" : "read";
    const brief = String(b.brief ?? t.title).trim().slice(0, 4000);
    const w = WORKSPACES[ws];
    const prompt = [
      `Task from ${u.name || "the owner"}'s planner (task ${t.id}): ${brief}`,
      w.path ? `Relevant folder: ${w.path}.` : "",
      mode === "read" ? "Read and research as needed, but do not change any files outside your own task folder. Write drafts into your task folder." : "You may edit files in the relevant folder. Commit nothing to main.",
      "Never send messages or emails, make payments, delete data, or push to main. If one of those is needed, stop and ask.",
      b.confirm === false ? "" : "Before you finish, ask one short question if anything is unclear.",
      "End with a short summary: what you did and where the result is.",
    ].filter(Boolean).join("\n");
    const requestId = crypto.randomUUID();
    const r = await os("/agent-jobs", { method: "POST", body: JSON.stringify({ requestId, prompt, targets: ["claude"], ...(b.confirm === false ? { autonomous: true } : {}) }) });
    const mem = load(u);
    mem.agents[taskId] = { jobId: r.job.id, ws, mode, confirm: b.confirm !== false, startedAt: new Date().toISOString(), brief, state: "queued" };
    store(u, mem);
    s.db.query("UPDATE tasks SET owner = 'claude', updated_at = ? WHERE id = ?").run(new Date().toISOString(), Number(taskId.slice(1)));
    jobsCache = null;
    return (await agentsFor(u))[taskId];
  }
  async function act(u: User, s: Store, taskId: string, action: string, b: any = {}) {
    const mem = load(u);
    const meta = mem.agents[taskId];
    if (!meta) throw new ApiError(404, "Claude isn't working on that task.");
    const all = await jobs(true);
    const job = all.find((j: any) => j.id === meta.jobId);
    const run = job?.runs?.find((r: any) => r.agent === "claude");
    const now = new Date().toISOString();
    const n = Number(taskId.slice(1));
    if (action === "answer") {
      const p = run?.pending;
      if (!p) throw bad("Claude isn't waiting for an answer anymore.");
      const text = String(b.text ?? "").slice(0, 2000);
      const deny = p.kind === "approval" && /^don.?t|^no\b|^deny/i.test(text);
      const answers = p.questions?.length ? Object.fromEntries(p.questions.map((q: any) => [q.id, text])) : undefined;
      await os("/agent-jobs/respond", { method: "POST", body: JSON.stringify({ jobId: job.id, agent: "claude", requestId: p.id, decision: deny ? "deny" : "approve", ...(answers ? { answers } : {}) }) });
      (meta.notes ??= []).push({ text: `You: ${text}` });
    } else if (action === "back") {
      await os("/agent-jobs/continue", { method: "POST", body: JSON.stringify({ jobId: job?.id, agent: "claude", prompt: String(b.note || "Take another pass. Tighten the result and fix anything unclear.").slice(0, 4000) }) });
      (meta.notes ??= []).push({ text: "You sent it back for another pass" });
    } else if (action === "accept") {
      meta.state = "done";
      s.db.query("UPDATE tasks SET status = 'done', done_at = ?, evidence = ?, updated_at = ? WHERE id = ?").run(now, `agentic-os agent job ${meta.jobId}`, now, n);
    } else if (action === "stop") {
      if (run && ["queued", "running", "needs_input"].includes(run.status)) await os("/agent-jobs/cancel", { method: "POST", body: JSON.stringify({ jobId: job.id }) }).catch(() => {});
      delete mem.agents[taskId];
      s.db.query("UPDATE tasks SET owner = 'me', updated_at = ? WHERE id = ?").run(now, n);
      store(u, mem);
      return null;
    } else throw new ApiError(404, "No such action.");
    store(u, mem);
    jobsCache = null;
    return (await agentsFor(u))[taskId];
  }

  return { ask, review, agentsFor, give, act, claude };
}
export type AI = ReturnType<typeof openAI>;

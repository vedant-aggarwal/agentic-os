// Work's agent tools (server/modules/types.ts AgentTool; the Agent area gathers them into Wyn's MCP server). Each one
// goes through the phone server's own API as the owner (work-api.ts), so she sees and does exactly what the app does.
//   work_overview       auto   counts: need him / working / to review / stopped, and what the ones that need him ask
//   work_job            auto   one job: state, its ask, its last words, its progress
//   work_add_idea       auto   a new idea (POST /api/v1/ideas)
//   work_reply          asks   a message to a job, queued if it's mid-turn (spends his plan)
//   work_answer         asks   allow / always / deny on a job's open permission
//   work_start_job      asks   a new job (POST /api/v1/jobs)
//   work_queue_tonight  asks   a row on tonight's night shift
// Lanes follow the app's own mapping (app/js/data.js laneOf), and Builder jobs stay off the counts like on the board.
import { createHash } from "node:crypto";
import { ist } from "./scheduler";
import type { AgentTool, JobCtx } from "./types";
import { jobKey, loopback, type Fetch } from "./work-api";
import { ENGINES, MODES } from "./work-store";

const clip = (s: unknown, n: number) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };
const needJob = (v: unknown) => { const k = jobKey(v); if (!k) throw new Error("job is a job id like j12."); return k; };

/** The board section a job sits in, as the app draws it: needs, working, review, stopped, done or archive. */
export function laneOf(j: any): string {
  const lane = j.lane ?? (j.status === "done" ? "completed" : ["starting", "running"].includes(j.status) ? "working" : "attention");
  if (lane === "archived") return "archive";
  if (lane === "working") return "working";
  if (j.status === "needs_input") return "needs";
  if (j.review) return "review";
  if (lane === "completed") return "done";
  return j.status === "stopped" ? "stopped" : "needs";
}
/** What a job wants from him: its open ask, else its error, else its last words. */
function askOf(j: any) {
  const p = j.pending;
  if (p) return { kind: p.kind === "plan" ? "plan" : p.form || p.html || p.kind === "question" ? "form" : "permission", text: clip(p.title || "It's waiting for your OK.", 240), requestId: p.requestId ?? null };
  if (j.status === "failed") return { kind: "error", text: clip(j.error || "It stopped with an error.", 240), requestId: null };
  return { kind: "reply", text: clip(j.lastText || j.summary || "It finished its turn.", 240), requestId: null };
}

export function workTools(fetchImpl?: Fetch): AgentTool[] {
  const api = (ctx: JobCtx) => loopback(ctx, fetchImpl);
  return [
    {
      name: "work_overview", auto: true,
      description: "Counts his jobs that need him, are working, wait for review or stopped, and lists what the ones that need him ask.",
      input: { type: "object", properties: {}, additionalProperties: false },
      async run(ctx) {
        const { jobs = [] } = (await api(ctx)("GET", "/jobs")) ?? {};
        const list = (jobs as any[]).filter((j) => j.role !== "builder");
        const by: Record<string, any[]> = { needs: [], working: [], review: [], stopped: [] };
        for (const j of list) by[laneOf(j)]?.push(j);
        const needYou = by.needs.slice(0, 20).map((j) => ({ id: j.id, title: clip(j.title, 120), project: j.project ?? null, ask: askOf(j) }));
        const counts = { needs: by.needs.length, working: by.working.length, review: by.review.length, stopped: by.stopped.length };
        const say = list.length ? `${counts.needs} need you, ${counts.working} working, ${counts.review} to review, ${counts.stopped} stopped.` : "No jobs yet.";
        return { ...counts, needYou, say };
      },
    },
    {
      name: "work_job", auto: true,
      description: "Reads one job: its state, what it asks, its last words and its progress.",
      input: { type: "object", properties: { job: { type: "string", description: "The job id, like j12." } }, required: ["job"], additionalProperties: false },
      async run(ctx, args) {
        const id = needJob(args?.job);
        const { job: j } = (await api(ctx)("GET", `/jobs/${id}`)) ?? {};
        if (!j) throw new Error(`No job ${id}.`);
        const p = j.pending;
        const g = j.progress;
        return {
          id: j.id, title: j.title, status: j.status, lane: laneOf(j), project: j.project ?? null, engine: j.engine, model: j.model ?? null,
          ask: p ? { ...askOf(j), options: (p.options ?? []).map((o: any) => ({ id: o.optionId, name: o.name, kind: o.kind })) } : null,
          last: clip(j.lastText || j.summary || "", 600) || null,
          progress: g ? { title: g.title ?? null, state: g.state ?? null, done: g.done ?? 0, total: g.total ?? 0, step: g.active ?? null, stage: g.stage ?? null, note: g.note ?? null } : null,
          error: j.error ?? null, queued: Array.isArray(j.queue) ? j.queue.length : 0, files: j.files ?? 0, updatedAt: j.updatedAt ?? null,
          say: `${j.id} ${j.title ? `(${clip(j.title, 60)}) ` : ""}is ${laneOf(j) === "needs" ? "waiting for you" : String(j.status ?? "").replace("_", " ")}.`,
        };
      },
    },
    {
      name: "work_add_idea", auto: true,
      description: "Saves a new idea in Work, optionally under a project.",
      input: { type: "object", properties: {
        title: { type: "string", description: "The idea in a few words." },
        body: { type: "string", description: "More detail, if he gave any." },
        project: { type: "string", description: "A project slug, if it belongs to one." },
      }, required: ["title"], additionalProperties: false },
      async run(ctx, args) {
        const title = String(args?.title ?? "").trim();
        if (!title) throw new Error("title can't be empty.");
        const { idea } = (await api(ctx)("POST", "/ideas", { title, ...(args?.body ? { body: String(args.body) } : {}), ...(args?.project ? { project: String(args.project) } : {}), source: "wyn" })) ?? {};
        return { idea: idea ? { id: idea.id, title: idea.title, project: idea.project ?? null } : null, say: `Saved the idea "${clip(title, 80)}".` };
      },
    },
    {
      name: "work_reply", auto: false,
      description: "Sends his message to a job; it waits in the job's queue if the agent is mid-turn. This spends his plan, so ask first.",
      input: { type: "object", properties: {
        job: { type: "string", description: "The job id, like j12." },
        text: { type: "string", description: "The message, in his words." },
        force: { type: "boolean", description: "Send even though the prompt cache went cold (he agreed to the cost)." },
      }, required: ["job", "text"], additionalProperties: false },
      async run(ctx, args) {
        const id = needJob(args?.job);
        const text = String(args?.text ?? "").trim();
        if (!text) throw new Error("text can't be empty.");
        const { job } = (await api(ctx)("POST", `/jobs/${id}/prompt`, { text, queue: true, ...(args?.force ? { force: true } : {}) })) ?? {};
        const queued = Array.isArray(job?.queue) && job.queue.some((q: any) => q?.text === text);
        return { job: { id, status: job?.status ?? null, queued: Array.isArray(job?.queue) ? job.queue.length : 0 }, say: queued ? `Queued for ${id}; it goes when the turn ends.` : `Sent to ${id}.` };
      },
    },
    {
      name: "work_answer", auto: false,
      description: "Answers a job's open permission ask: allow once, always allow for this session, or deny.",
      input: { type: "object", properties: {
        job: { type: "string", description: "The job id, like j12." },
        choice: { type: "string", enum: ["allow", "always", "deny"], description: "allow once, always (for this session) or deny." },
        requestId: { type: "string", description: "The ask's id from work_job or work_overview, so the answer can't land on a newer ask." },
      }, required: ["job", "choice"], additionalProperties: false },
      async run(ctx, args) {
        const id = needJob(args?.job);
        const kind = ({ allow: "allow_once", always: "allow_always", deny: "reject_once" } as Record<string, string>)[String(args?.choice)];
        if (!kind) throw new Error('choice is "allow", "always" or "deny".');
        const call = api(ctx);
        const { job } = (await call("GET", `/jobs/${id}`)) ?? {};
        const p = job?.pending;
        if (!p?.requestId) throw new Error(`${id} isn't waiting for an answer.`);
        if (args?.requestId && args.requestId !== p.requestId) throw new Error("That ask was already answered or replaced. Read the job again.");
        if (p.form || p.html) throw new Error("It's asking questions, not for a yes or no. He answers those in the app.");
        const opt = (p.options ?? []).find((o: any) => o.kind === kind);
        if (!opt) throw new Error(`This ask has no "${args.choice}" choice. It offers: ${(p.options ?? []).map((o: any) => o.name).join(", ")}.`);
        const r = (await call("POST", `/jobs/${id}/permission`, { requestId: p.requestId, optionId: opt.optionId })) ?? {};
        const verb = kind === "reject_once" ? "Denied" : kind === "allow_always" ? "Always allowed" : "Allowed";
        return { job: { id, status: r.job?.status ?? null }, answered: { requestId: p.requestId, optionId: opt.optionId, name: opt.name }, say: `${verb} "${clip(p.title, 80)}" on ${id}.` };
      },
    },
    {
      name: "work_start_job", auto: false,
      description: "Starts a new Claude or Codex job on his plan, in its own copy of the project when it's a git repo.",
      input: { type: "object", properties: {
        engine: { type: "string", enum: ENGINES, description: "claude or codex." },
        prompt: { type: "string", description: "What the job should do." },
        project: { type: "string", description: "A project slug; the job works in its folder." },
        task: { type: "string", description: "A task id like t12 that the job is for." },
        plan: { type: "boolean", description: "Plan first and wait for his OK before building." },
        worktree: { type: "boolean", description: "Its own copy of the repo (default true); false works in the folder itself." },
      }, required: ["engine", "prompt"], additionalProperties: false },
      async run(ctx, args) {
        if (!ENGINES.includes(args?.engine)) throw new Error('engine is "claude" or "codex".');
        const prompt = String(args?.prompt ?? "").trim();
        if (!prompt) throw new Error("prompt can't be empty.");
        const body = { engine: args.engine, context: prompt, mode: "auto", plan: !!args.plan, worktree: args.worktree !== false,
          ...(args.project ? { project: String(args.project) } : {}), ...(args.task ? { taskIds: [String(args.task)] } : {}) };
        const { job } = (await api(ctx)("POST", "/jobs", body, { timeoutMs: 90_000 })) ?? {};
        if (!job?.id) throw new Error("The job server answered without a job.");
        return { job: { id: job.id, title: job.title, status: job.status, project: job.project ?? null }, say: `Started ${job.id}: ${clip(job.title, 80)}.` };
      },
    },
    {
      name: "work_queue_tonight", auto: false,
      description: "Queues a job for tonight's night shift (starts at 23:00 on his plan, reported at 07:00).",
      input: { type: "object", properties: {
        prompt: { type: "string", description: "What the job should do." },
        title: { type: "string", description: "A short title for the night list." },
        task: { type: "string", description: "A task id like t12 that the job is for." },
        project: { type: "string", description: "A project slug." },
        engine: { type: "string", enum: ENGINES, description: "claude (default) or codex." },
        mode: { type: "string", enum: MODES, description: "build (default) or plan: a plan only, for him to approve in the morning." },
      }, required: ["prompt"], additionalProperties: false },
      async run(ctx, args) {
        const prompt = String(args?.prompt ?? "").trim();
        if (!prompt) throw new Error("prompt can't be empty.");
        const now = ist();
        const doc = {
          date: now.date, state: "queued", engine: args?.engine ?? "claude", mode: args?.mode ?? "build", prompt,
          title: String(args?.title ?? "").trim() || clip(prompt.split("\n")[0], 80), task: args?.task ? String(args.task) : null,
          project: args?.project ? String(args.project) : null, job: null, worktree: true, source: "wyn", updated_at: new Date().toISOString(),
        };
        // The same ask on the same evening is one row: a resent call can't queue it twice.
        const id = `n_${now.date}_${createHash("sha1").update(`${doc.prompt}\n${doc.task}\n${doc.project}`).digest("hex").slice(0, 10)}`;
        const { item } = (await api(ctx)("PUT", `/mod/work/night/${id}`, doc)) ?? {};
        if (item && item.state !== "queued") return { item, say: `That's already on the night list (${item.state}).` };
        const late = now.hhmm >= "23:00";
        return { item, say: late ? `Queued "${clip(doc.title, 60)}". Tonight's shift may already be running, so it can wait for tomorrow's.` : `Queued "${clip(doc.title, 60)}" for 23:00 tonight.` };
      },
    },
  ];
}

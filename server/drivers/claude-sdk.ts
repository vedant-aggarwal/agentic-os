// Native Claude driver: the Claude Agent SDK's query() with a streaming input, so one Claude Code process serves the
// whole job. It runs on the logged-in Claude Code subscription (no API key). Permissions come in through canUseTool;
// plan mode is the SDK's own "plan" permission mode, and its ExitPlanMode call becomes an "Approve plan" request.
import { randomUUID } from "node:crypto";
import { createSdkMcpServer, query, tool, type EffortLevel } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { RULES } from "../progress";
import { ASK_FORM_RULE, PUBLISH_RULE, SHIP_STATES, TOOL_DEFS } from "../ship-tools";
import { claudeContent } from "../attachments";
import { ALLOW_OPTIONS, PLAN_OPTIONS, type Driver, type DriverOpts, type ExtraTool, type FormQuestion, type Perm } from "./types";

const PROGRESS_TOOL = "mcp__aos__plan_progress";
/** publish_changes and ship_status in zod, the same shapes as ship-tools.ts's JSON Schema. */
const EXTRA_SHAPES: Record<ExtraTool, () => Record<string, z.ZodTypeAny>> = {
  publish_changes: () => ({ summary: z.string(), deploy: z.boolean().optional(), notes: z.string().optional() }),
  ship_status: () => ({ id: z.string(), state: z.enum(SHIP_STATES), note: z.string().optional(), commit: z.string().optional() }),
  ask_form: () => ({ title: z.string(), html: z.string().optional(), path: z.string().optional() }),
};
/** Work calls (edits, commands) before a reminder: with no bar yet, then without a bar update. */
const WORK_BEFORE_PLAN = 3;
const CALLS_BEFORE_NUDGE = 6;
const WORK_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "PowerShell"]);

/** The plan_progress tool, in process: each call goes to the job's Sink, which keeps the bar. */
function progressServer(o: DriverOpts, onCall: () => void) {
  const step = z.union([z.string(), z.object({ title: z.string(), status: z.enum(["pending", "active", "done", "error", "skipped"]).optional() })]);
  return createSdkMcpServer({
    name: "aos",
    version: "1.0.0",
    tools: [
      tool("plan_progress",
        "Agentic OS progress bar for this job (the user watches it on their phone). Create: {id, title, stages:[{name, steps:[{title}]}]} (or kind:\"todo\" with steps). Move: {next:true} | {done:[titles], active:title} | {failed:title, note} | {state:\"needs_input\"|\"done\", note}. Resend stages when the plan changes.",
        {
          id: z.string().optional(), title: z.string().optional(), kind: z.enum(["stages", "todo"]).optional(),
          stages: z.array(z.object({ name: z.string(), steps: z.array(step) })).optional(),
          steps: z.array(step).optional(),
          next: z.boolean().optional(), done: z.array(z.string()).optional(), active: z.string().optional(),
          failed: z.string().optional(), state: z.enum(["running", "needs_input", "error", "done"]).optional(), note: z.string().optional(),
        },
        async (args) => {
          onCall();
          const r = o.sink.progress(args);
          return { content: [{ type: "text" as const, text: r.text }], ...(r.ok ? {} : { isError: true }) };
        }),
      ...(o.tools ?? []).map((name) => tool(name, TOOL_DEFS[name].description, EXTRA_SHAPES[name](), async (args) => {
        const r = o.sink.call ? await o.sink.call(name, args).catch((e) => ({ ok: false, text: String(e?.message ?? e) })) : { ok: false, text: "Not available in this job." };
        return { content: [{ type: "text" as const, text: r.text }], ...(r.ok ? {} : { isError: true }) };
      })),
    ],
  });
}

const tail = (s: string, n: number) => (s.length > n ? "…" + s.slice(-n) : s);
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
/** ask: Claude's normal prompts. edits and auto: edits go through; auto also answers the rest (jobs.ts does that). */
const sdkMode = (p: Perm) => (p === "ask" ? "default" : "acceptEdits") as "default" | "acceptEdits";

/** A queue the SDK reads user messages from; prompt() pushes one per turn. */
function inbox() {
  const items: any[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  return {
    push(m: any) { items.push(m); wake?.(); },
    close() { closed = true; wake?.(); },
    async *[Symbol.asyncIterator]() {
      while (!closed) {
        if (!items.length) await new Promise<void>((r) => (wake = r));
        wake = null;
        while (items.length) yield items.shift();
      }
    },
  };
}

function toolView(name: string, input: any): { title: string; kind: string; locations?: string[] } {
  const file = input?.file_path ?? input?.notebook_path ?? input?.path;
  if (SHELL_TOOLS.has(name)) return { title: String(input?.command ?? input?.description ?? name).split("\n")[0].slice(0, 200), kind: "execute" };
  if (EDIT_TOOLS.has(name)) return { title: `${name === "Write" ? "Write" : "Edit"} ${file ?? ""}`.trim(), kind: "edit", locations: file ? [String(file)] : undefined };
  if (name === "Read") return { title: `Read ${file ?? ""}`.trim(), kind: "read", locations: file ? [String(file)] : undefined };
  if (name === "Glob" || name === "Grep") return { title: `${name} ${input?.pattern ?? ""}`.trim(), kind: "search" };
  if (name === "WebFetch" || name === "WebSearch") return { title: `${name} ${input?.url ?? input?.query ?? ""}`.trim(), kind: "fetch" };
  if (name === "Task" || name === "Agent") return { title: `Agent: ${input?.description ?? ""}`.trim(), kind: "think" };
  return { title: name.replace(/^mcp__/, "").replace(/__/g, " · "), kind: "other" };
}
function resultText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c?.type === "text" ? String(c.text ?? "") : c?.type === "image" ? "(image)" : "")).join("\n");
  return content == null ? "" : JSON.stringify(content);
}

export function claudeSdkDriver(o: DriverOpts): Driver {
  const input = inbox();
  let perm: Perm = o.perm;
  let planning = false;
  let q: ReturnType<typeof query> | null = null;
  let turn: { resolve: (r: { stopReason: string }) => void; reject: (e: Error) => void } | null = null;
  let cancelled = false;
  // A rewind forks the old session at resumeAt into a new one; the old transcript stays as it was.
  const fork = !!(o.resumeAt && o.sessionId);
  const sessionId = fork ? randomUUID() : o.sessionId ?? randomUUID();
  const extra = (o.tools ?? []).map((t) => `mcp__aos__${t}`);
  // The turn's first model call (cache read vs write) and its last message (where a rewind can resume).
  let firstCall: { read: number; write: number; fresh: number } | null = null;
  let lastUuid: string | null = null;
  const streamed = new Set<string>();
  const hidden = new Set<string>(); // tool calls shown another way (plan, checklist, question), so their results are skipped
  let msgId: string | null = null;
  const usage = { input: 0, output: 0 };
  let lastCtx = 0;
  let resolveExit!: (c: number | null) => void;
  const exited = new Promise<number | null>((r) => (resolveExit = r));

  // ── progress reminders, the plan-progress mod's rules: a bar before multi-step work, kept current while working,
  // and settled before the turn ends. Counters reset each turn.
  const P = { work: 0, since: 0, askedForBar: false, settled: false, quiet: false };
  const openBar = () => { const p = o.sink.currentProgress(); return p && p.state !== "done" ? p : null; };
  const ctx = (event: "PostToolUse" | "UserPromptSubmit", text: string) => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });
  const hooks = {
    UserPromptSubmit: [{ hooks: [async () => {
      const p = openBar();
      return p ? ctx("UserPromptSubmit", `plan_progress open bar "${p.id}": ${p.done}/${p.total}${p.active ? `, active: ${p.active}` : ""}. Move it as you work, or create a new bar for new work.`) : {};
    }] }],
    PostToolUse: [{ hooks: [async (input: any) => {
      const name = String(input?.tool_name ?? "");
      if (name === PROGRESS_TOOL || name === "TodoWrite") { P.since = 0; return {}; }
      if (!WORK_TOOLS.has(name)) return {};
      P.quiet = false;
      P.work++;
      P.since++;
      const p = openBar();
      if (!p && !P.askedForBar && P.work >= WORK_BEFORE_PLAN) {
        P.askedForBar = true;
        return ctx("PostToolUse", `plan_progress: several changes in and no progress bar yet. Create one now with ${PROGRESS_TOOL} (the whole plan, done steps marked done), then carry on.`);
      }
      if (p && P.since >= CALLS_BEFORE_NUDGE) {
        P.since = 0;
        return ctx("PostToolUse", `plan_progress: "${p.id}" not updated for a while (${p.done}/${p.total}${p.active ? `, active: ${p.active}` : ""}). Send {next:true} or {done:[...], active:"..."}.`);
      }
      return {};
    }] }],
    Stop: [{ hooks: [async (input: any) => {
      const p = openBar();
      if (!p || p.source !== "tool" || p.state !== "running" || input?.stop_hook_active || P.settled || !P.work) return {};
      // A question to the user: the bar waits on them; no model call.
      if (/\?\s*$/.test(String(input?.last_assistant_message ?? "").trim())) { o.sink.progress({ state: "needs_input", note: "Waiting for your answer" }); return {}; }
      P.settled = true;
      P.quiet = true; // the reply he reads is the one just written; text after this nudge is dropped unless real work follows
      return { decision: "block" as const, reason: `plan_progress: the bar still shows ${p.done}/${p.total}${p.active ? ` (active: ${p.active})` : ""}. Update it with ${PROGRESS_TOOL}: mark the finished steps done, or send state "done" if everything is finished, "needs_input" if you are waiting on the user, or failed with a note. Then stop without writing anything else.` };
    }] }],
  };

  async function canUseTool(name: string, toolInput: Record<string, unknown>, opt: { signal: AbortSignal; suggestions?: any[]; title?: string; toolUseID?: string }) {
    if (name === "ExitPlanMode") {
      o.sink.planText(String((toolInput as any).plan ?? ""));
      const pick = await o.sink.permission({ title: "Approve this plan?", kind: "plan", options: PLAN_OPTIONS });
      if (pick !== "approve") return { behavior: "deny" as const, message: "The user wants to keep planning. Stop here and wait for their feedback.", interrupt: true };
      planning = false;
      await q?.setPermissionMode(sdkMode(perm)).catch(() => {});
      return { behavior: "allow" as const, updatedInput: toolInput };
    }
    if (name === PROGRESS_TOOL || extra.includes(name)) return { behavior: "allow" as const, updatedInput: toolInput };
    if (name === "AskUserQuestion") {
      // All questions at once, as one form with option cards, previews and an "Other" box.
      const qs: any[] = Array.isArray((toolInput as any).questions) ? (toolInput as any).questions : [];
      const form: FormQuestion[] = qs.map((x) => ({
        question: String(x.question ?? x.header ?? "Question"), header: x.header ? String(x.header) : undefined, multiSelect: !!x.multiSelect,
        options: (x.options ?? []).map((y: any) => (typeof y === "string" ? { label: y } : {
          label: String(y.label ?? ""), ...(y.description ? { description: String(y.description) } : {}), ...(y.preview ? { preview: String(y.preview) } : {}) })),
      }));
      const answers = await o.sink.ask(form);
      if (!answers) return { behavior: "deny" as const, message: "The user skipped these questions. Carry on with your best judgement, or ask again in plain text." };
      return { behavior: "allow" as const, updatedInput: { ...toolInput, answers } };
    }
    const v = toolView(name, toolInput);
    const kind = EDIT_TOOLS.has(name) ? "edit" : SHELL_TOOLS.has(name) ? "command" : "other";
    const pick = await o.sink.permission({ title: opt.title || v.title, kind, options: ALLOW_OPTIONS });
    if (pick === "allow") return { behavior: "allow" as const, updatedInput: toolInput };
    if (pick === "always") return { behavior: "allow" as const, updatedInput: toolInput, updatedPermissions: opt.suggestions ?? [] };
    return { behavior: "deny" as const, message: pick == null ? "Cancelled." : "The user denied this." };
  }

  // Background tasks (subagents, shells) outlive the turn that started them, and a finished one wakes the agent for
  // a turn of its own. The job counts as working through both, so a restart waits instead of killing them.
  const bg = new Set<string>();
  let awake = false;
  let lastActivity = "0:false";
  const reportActivity = () => {
    const key = `${bg.size}:${awake}`;
    if (key === lastActivity) return;
    lastActivity = key;
    o.sink.activity?.({ background: bg.size, awake });
  };
  function onTasks(m: any) {
    if (m.subtype === "background_tasks_changed" && Array.isArray(m.tasks)) {
      bg.clear();
      for (const t of m.tasks) if (!t?.ambient && t?.task_id) bg.add(String(t.task_id));
    } else if (m.subtype === "task_started" && m.is_backgrounded && m.task_id) bg.add(String(m.task_id));
    else if (m.subtype === "task_updated" && m.task_id && m.patch?.is_backgrounded) bg.add(String(m.task_id));
    else if (m.subtype === "task_notification" && m.task_id) bg.delete(String(m.task_id));
    else return;
    reportActivity();
  }

  function onMessage(m: any) {
    if (m.type === "system") return onTasks(m);
    if (m.parent_tool_use_id) return; // a subagent's own traffic; its Task row shows the result
    if (!turn && !awake && (m.type === "assistant" || m.type === "stream_event")) { awake = true; P.quiet = false; reportActivity(); }
    if (m.type === "stream_event") {
      const e = m.event;
      if (e?.type === "message_start") msgId = String(e.message?.id ?? "") || null;
      else if (e?.type === "content_block_delta") {
        if (e.delta?.type === "text_delta" && e.delta.text) { if (msgId) streamed.add(msgId); if (!P.quiet) o.sink.text("assistant", msgId, e.delta.text); }
        else if (e.delta?.type === "thinking_delta" && e.delta.thinking) o.sink.text("thought", msgId ? `${msgId}:t` : null, e.delta.thinking);
      }
      return;
    }
    if (m.type === "assistant") {
      const id = String(m.message?.id ?? "");
      const mu = m.message?.usage;
      if (mu) lastCtx = Number(mu.input_tokens ?? 0) + Number(mu.cache_creation_input_tokens ?? 0) + Number(mu.cache_read_input_tokens ?? 0);
      if (mu && turn && !firstCall) firstCall = { read: Number(mu.cache_read_input_tokens ?? 0), write: Number(mu.cache_creation_input_tokens ?? 0), fresh: Number(mu.input_tokens ?? 0) };
      if (m.uuid && turn) lastUuid = String(m.uuid);
      for (const b of m.message?.content ?? []) {
        if (b.type === "text" && b.text && !streamed.has(id) && !P.quiet) o.sink.text("assistant", id || null, String(b.text));
        else if (b.type === "tool_use") {
          if (b.name === "TodoWrite") {
            hidden.add(String(b.id));
            o.sink.plan(((b.input?.todos ?? []) as any[]).map((t) => ({ content: String(t.content ?? ""), status: String(t.status ?? "pending") })));
            continue;
          }
          if (b.name === "ExitPlanMode" || b.name === "AskUserQuestion" || b.name === PROGRESS_TOOL || b.name === "mcp__aos__ask_form") { hidden.add(String(b.id)); continue; }
          o.sink.tool({ id: String(b.id), ...toolView(String(b.name), b.input), status: "in_progress" });
        }
      }
      return;
    }
    if (m.type === "user") {
      const c = m.message?.content;
      if (!Array.isArray(c)) return;
      for (const b of c) if (b?.type === "tool_result" && !hidden.has(String(b.tool_use_id))) {
        const out = resultText(b.content).trim();
        o.sink.tool({ id: String(b.tool_use_id), status: b.is_error ? "failed" : "completed", output: out ? tail(out, 4000) : undefined });
      }
      return;
    }
    if (m.type === "result") {
      const u = m.usage ?? {};
      usage.input += Number(u.input_tokens ?? 0) + Number(u.cache_creation_input_tokens ?? 0) + Number(u.cache_read_input_tokens ?? 0);
      usage.output += Number(u.output_tokens ?? 0);
      const win = Object.values(m.modelUsage ?? {}).map((x: any) => Number(x?.contextWindow ?? 0)).find((n) => n > 0);
      o.sink.usage({ ...usage, contextPct: win && lastCtx ? Math.min(100, Math.round((lastCtx / win) * 100)) : null, ...(turn ? { cache: firstCall } : {}) });
      if (turn && lastUuid) o.sink.turnMark?.(lastUuid);
      const t = turn;
      turn = null;
      if (!t) { if (awake) { awake = false; reportActivity(); } return; }
      if (cancelled) { cancelled = false; return t.resolve({ stopReason: "cancelled" }); }
      if (m.subtype === "success" && !m.is_error) return t.resolve({ stopReason: String(m.stop_reason ?? "end_turn") });
      const why = Array.isArray(m.errors) && m.errors.length ? m.errors.join(" ") : String(m.result ?? m.subtype ?? "error");
      if (m.subtype === "error_max_turns") return t.resolve({ stopReason: "max_turn_requests" });
      return t.reject(new Error(why.slice(0, 500)));
    }
  }

  return {
    name: "native",
    supportsPlan: true,
    exited,
    async start() {
      q = query({
        prompt: input as any,
        options: {
          cwd: o.cwd, env: o.env, includePartialMessages: true, settingSources: ["user", "project", "local"],
          ...(o.readDirs?.length ? { additionalDirectories: o.readDirs } : {}),
          permissionMode: sdkMode(perm), canUseTool: canUseTool as any,
          // Claude Code's own prompt plus the progress-bar rules; the bar tool runs in this process.
          systemPrompt: { type: "preset", preset: "claude_code", append: [RULES, o.tools?.includes("publish_changes") ? PUBLISH_RULE : "", o.tools?.includes("ask_form") ? ASK_FORM_RULE : "", o.rules ?? ""].filter(Boolean).join("\n\n") },
          mcpServers: { aos: progressServer(o, () => { P.since = 0; }) },
          allowedTools: [PROGRESS_TOOL, ...extra],
          hooks,
          ...(fork ? { resume: o.sessionId, resumeSessionAt: o.resumeAt, forkSession: true, sessionId } : o.sessionId ? { resume: o.sessionId } : { sessionId }),
          ...(o.model ? { model: o.model } : {}),
          ...(o.effort ? { effort: o.effort } : {}),
          stderr: (s: string) => o.sink.log(s.split("\n").filter((x) => x.trim())),
        } as any,
      });
      if (!o.sessionId || fork) o.sink.session(sessionId);
      (async () => {
        try {
          for await (const m of q!) onMessage(m);
          resolveExit(0);
        } catch (e) {
          o.sink.log([String((e as Error)?.message ?? e)]);
          turn?.reject(e as Error);
          turn = null;
          resolveExit(1);
        }
      })();
    },
    async prompt(text, p) {
      if (p.plan !== planning) {
        planning = p.plan;
        await q!.setPermissionMode(planning ? "plan" : sdkMode(perm));
      }
      cancelled = false;
      firstCall = null;
      lastUuid = null;
      Object.assign(P, { work: 0, since: 0, askedForBar: false, settled: false, quiet: false });
      return new Promise((resolve, reject) => {
        turn = { resolve, reject };
        input.push({ type: "user", message: { role: "user", content: claudeContent(text) }, parent_tool_use_id: null, session_id: sessionId });
      });
    },
    // Mid-turn: Claude Code takes it at the next step, as when you type while it works in the terminal.
    async steer(text) {
      if (!turn) return false;
      input.push({ type: "user", message: { role: "user", content: claudeContent(text) }, parent_tool_use_id: null, session_id: sessionId, priority: "next" });
      return true;
    },
    async cancel() {
      if (!turn) return;
      cancelled = true;
      await q?.interrupt().catch(() => {});
    },
    async setPerm(p) {
      perm = p;
      if (!planning) await q?.setPermissionMode(sdkMode(p)).catch(() => {});
    },
    async setModel(m) {
      if (!q) return false;
      return q.setModel(m ?? undefined).then(() => true, () => false);
    },
    // A flag-tier overlay, as /effort does; null goes back to the model's default.
    async setEffort(e) {
      if (!q) return false;
      return q.applyFlagSettings({ effortLevel: (e ?? null) as EffortLevel | null }).then(() => true, () => false);
    },
    close() {
      input.close();
      try { q?.close(); } catch {}
      turn?.resolve({ stopReason: "cancelled" });
      turn = null;
    },
  };
}

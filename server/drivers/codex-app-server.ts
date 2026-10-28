// Native Codex driver: `codex app-server`, Codex's own JSON-RPC protocol over stdio (one JSON object per line, no
// "jsonrpc" field). initialize { experimentalApi } -> thread/start | thread/resume -> turn/start per prompt, streamed
// back as item/* notifications until turn/completed. Approvals arrive as server requests and are answered by id.
// Plan mode is turn/start's experimental collaborationMode { mode: "plan" }.
import { ALLOW_OPTIONS, killTree, lines, type Driver, type DriverOpts, type Perm } from "./types";
import { rules, TOOL_DESCRIPTION, TOOL_SCHEMA } from "../progress";
import { ASK_FORM_RULE, PUBLISH_RULE, TOOL_DEFS } from "../ship-tools";
import { codexInput } from "../attachments";

const tail = (s: string, n: number) => (s.length > n ? "…" + s.slice(-n) : s);
/** ask: read-only sandbox, ask for anything untrusted. edits: workspace writes go through, the rest asks. auto: no sandbox, no asking.
 *  (The Windows sandbox helper can fail to start; Codex then asks to run outside it, which shows up as an approval.) */
const policy = (p: Perm) =>
  p === "ask" ? { approvalPolicy: "untrusted", sandbox: "read-only", sandboxPolicy: { type: "readOnly", networkAccess: false } }
  : p === "edits" ? { approvalPolicy: "on-request", sandbox: "workspace-write",
      sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false } }
  : { approvalPolicy: "never", sandbox: "danger-full-access", sandboxPolicy: { type: "dangerFullAccess" } };
const status = (s: string) => (s === "inProgress" ? "in_progress" : s === "completed" ? "completed" : s ? "failed" : "pending");
const QUIET = ["mcpServer/startupStatus/updated", "turn/moderationMetadata", "hook/started", "hook/completed", "rawResponseItem/completed",
  "rawResponse/completed", "remoteControl/status/changed", "skills/changed", "app/list/updated", "fs/changed"];

export function codexAppServerDriver(o: DriverOpts): Driver {
  const exe = o.env.CODEX_PATH || Bun.which("codex") || "codex";
  const proc = Bun.spawn([exe, "app-server"], { cwd: o.cwd, env: o.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  let perm: Perm = o.perm;
  let permDirty = false;
  let threadId: string | null = o.sessionId;
  let model: string | null = o.model ?? null;
  // The picked effort wins; with none, the thread reports the model's default and each turn keeps it.
  const picked = { effort: o.effort ?? null };
  let effort: string | null = picked.effort;
  let turnId: string | null = null;
  let turn: { resolve: (r: { stopReason: string }) => void; reject: (e: Error) => void } | null = null;
  let nextId = 1;
  const waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const streamed = new Set<string>();
  const files = new Map<string, string[]>(); // fileChange item id -> paths, for its approval title
  // The turn's first model call: OpenAI counts cached tokens inside inputTokens and has no cache write.
  let firstCall: { read: number; write: number; fresh: number } | null = null;

  const send = (m: unknown) => { const s = proc.stdin as any; s.write(JSON.stringify(m) + "\n"); s.flush(); };
  const request = (method: string, params: unknown) => new Promise<any>((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    send({ id, method, params });
  });
  (async () => { for await (const l of lines(proc.stderr)) if (!/rmcp::transport|worker quit/.test(l)) o.sink.log([l]); })().catch(() => {});
  (async () => {
    for await (const l of lines(proc.stdout)) {
      let m: any;
      try { m = JSON.parse(l); } catch { continue; }
      if (m.id != null && !m.method) {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (m.error) w?.reject(new Error(String(m.error.message ?? "Codex error")));
        else w?.resolve(m.result);
      } else if (m.id != null && m.method) {
        onRequest(m.method, m.params).then((result) => send({ id: m.id, result }), (e) => send({ id: m.id, error: { code: -32000, message: String(e?.message ?? e) } }));
      } else if (m.method) onNote(m.method, m.params ?? {});
    }
  })().catch(() => {});
  const exited = proc.exited.then((c) => {
    for (const w of waiting.values()) w.reject(new Error("Codex stopped."));
    waiting.clear();
    turn?.reject(new Error(`Codex stopped (exit ${c}).`));
    turn = null;
    return c ?? null;
  });

  function itemTool(it: any) {
    if (it.type === "commandExecution") {
      const cmd = String(it.commandActions?.[0]?.command ?? it.command ?? "command");
      return { id: it.id, title: cmd.split("\n")[0].slice(0, 200), kind: "execute", status: status(it.status), output: it.aggregatedOutput ? tail(String(it.aggregatedOutput), 4000) : undefined };
    }
    if (it.type === "fileChange") {
      const paths = (it.changes ?? []).map((c: any) => String(c.path));
      files.set(it.id, paths);
      return { id: it.id, title: `Edit ${paths.map((p: string) => p.split(/[\\/]/).pop()).join(", ")}`, kind: "edit", status: status(it.status), locations: paths,
        output: tail((it.changes ?? []).map((c: any) => `${c.path}\n${c.diff ?? ""}`).join("\n"), 4000) || undefined };
    }
    if (it.type === "mcpToolCall") {
      const out = it.error ? String(it.error.message ?? JSON.stringify(it.error)) : (it.result?.content ?? []).map((c: any) => c?.text ?? "").join("\n");
      return { id: it.id, title: `${it.server} · ${it.tool}`, kind: "other", status: status(it.status), output: out ? tail(out, 4000) : undefined };
    }
    if (it.type === "webSearch") return { id: it.id, title: `Search the web: ${it.query ?? ""}`.trim(), kind: "fetch", status: "completed" };
    if (it.type === "dynamicToolCall") return it.tool === "plan_progress" || it.tool === "ask_form" ? null : { id: it.id, title: String(it.tool), kind: "other", status: status(it.status) };
    return null;
  }
  function onNote(method: string, p: any) {
    if (QUIET.includes(method)) return;
    if (p.threadId && threadId && p.threadId !== threadId) return; // a side thread (titles, subagents)
    switch (method) {
      case "item/agentMessage/delta": streamed.add(p.itemId); o.sink.text("assistant", p.itemId, String(p.delta ?? "")); return;
      case "item/reasoning/summaryTextDelta": o.sink.text("thought", p.itemId, String(p.delta ?? "")); return;
      case "item/started": case "item/completed": {
        const it = p.item ?? {};
        if (it.type === "agentMessage" && method === "item/completed" && !streamed.has(it.id) && it.text) o.sink.text("assistant", it.id, String(it.text));
        else if (it.type === "plan" && method === "item/completed" && it.text) o.sink.planText(String(it.text));
        else { const t = itemTool(it); if (t) o.sink.tool(t); }
        return;
      }
      case "turn/plan/updated": o.sink.plan((p.plan ?? []).map((s: any) => ({ content: String(s.step ?? ""), status: s.status === "inProgress" ? "in_progress" : String(s.status ?? "pending") }))); return;
      case "thread/tokenUsage/updated": {
        const t = p.tokenUsage ?? {};
        const win = Number(t.modelContextWindow ?? 0);
        if (turn && !firstCall && t.last) {
          const read = Number(t.last.cachedInputTokens ?? 0);
          firstCall = { read, write: 0, fresh: Math.max(0, Number(t.last.inputTokens ?? 0) - read) };
        }
        o.sink.usage({ input: Number(t.total?.inputTokens ?? 0), output: Number(t.total?.outputTokens ?? 0),
          contextPct: win ? Math.min(100, Math.round((Number(t.last?.inputTokens ?? 0) / win) * 100)) : null, ...(turn ? { cache: firstCall } : {}) });
        return;
      }
      case "thread/name/updated": if (p.threadName) o.sink.title(String(p.threadName)); return;
      case "turn/started": turnId = p.turn?.id ?? turnId; return;
      case "turn/completed": {
        const t = turn;
        turn = null;
        turnId = null;
        const st = p.turn?.status;
        if (!t) return;
        if (st === "failed") return t.reject(new Error(String(p.turn?.error?.message ?? "The turn failed.").slice(0, 500)));
        return t.resolve({ stopReason: st === "interrupted" ? "cancelled" : "end_turn" });
      }
      case "error": o.sink.log([String(p.error?.message ?? p.message ?? JSON.stringify(p)).slice(0, 400)]); return;
    }
  }
  async function onRequest(method: string, p: any): Promise<unknown> {
    const decision = (pick: string | null) => (pick === "allow" ? "accept" : pick === "always" ? "acceptForSession" : pick === "deny" ? "decline" : "cancel");
    if (method === "item/commandExecution/requestApproval") {
      const cmd = String(p.commandActions?.[0]?.command ?? p.command ?? "a command").split("\n")[0].slice(0, 160);
      const pick = await o.sink.permission({ title: `Run ${cmd}${p.reason ? ` (${p.reason})` : ""}`, kind: "command", options: ALLOW_OPTIONS });
      return { decision: decision(pick) };
    }
    if (method === "item/fileChange/requestApproval") {
      const paths = files.get(p.itemId) ?? [];
      const pick = await o.sink.permission({ title: `Edit ${paths.length ? paths.join(", ") : "files"}${p.reason ? ` (${p.reason})` : ""}`, kind: "edit", options: ALLOW_OPTIONS });
      return { decision: decision(pick) };
    }
    if (method === "item/tool/requestUserInput") {
      // All questions at once, as one form (option cards plus an "Other" box).
      const qs: any[] = p.questions ?? [];
      const form = qs.map((q) => ({
        question: String(q.question ?? q.header ?? "Question"), header: q.header ? String(q.header) : undefined,
        options: (q.options ?? []).map((x: any) => (typeof x === "object" && x ? { label: String(x.label ?? x.value ?? ""), ...(x.description ? { description: String(x.description) } : {}) } : { label: String(x) })),
      }));
      const got = await o.sink.ask(form);
      const answers: Record<string, { answers: string[] }> = {};
      qs.forEach((q, i) => { const a = got?.[form[i].question]; answers[String(q.id)] = { answers: a ? [a] : [] }; });
      return { answers };
    }
    if (method === "item/tool/call") {
      // Tools this client gave the thread (dynamicTools on thread/start): the progress bar, publish_changes, ship_status.
      if ((o.tools ?? []).includes(p.tool) && o.sink.call) {
        const r = await o.sink.call(p.tool, p.arguments ?? {}).catch((e) => ({ ok: false, text: String(e?.message ?? e) }));
        return { contentItems: [{ type: "inputText", text: r.text }], success: r.ok };
      }
      if (p.tool !== "plan_progress") return { contentItems: [{ type: "inputText", text: `No tool ${p.tool}.` }], success: false };
      const r = o.sink.progress(p.arguments ?? {});
      return { contentItems: [{ type: "inputText", text: r.text }], success: r.ok };
    }
    if (method === "item/permissions/requestApproval") {
      const pick = await o.sink.permission({ title: `Grant extra permissions${p.reason ? `: ${p.reason}` : ""}`, kind: "command", options: ALLOW_OPTIONS });
      if (pick === "allow" || pick === "always") return { permissions: p.permissions, scope: pick === "always" ? "session" : "turn" };
      throw new Error("Declined.");
    }
    if (method === "execCommandApproval" || method === "applyPatchApproval") {
      const pick = await o.sink.permission({ title: method === "execCommandApproval" ? `Run ${[].concat(p.command ?? []).join(" ")}` : "Apply a patch",
        kind: method === "execCommandApproval" ? "command" : "edit", options: ALLOW_OPTIONS });
      return { decision: pick === "allow" ? "approved" : pick === "always" ? "approved_for_session" : "denied" };
    }
    throw new Error(`Agentic OS can't answer ${method}.`);
  }

  return {
    name: "native",
    supportsPlan: true,
    exited,
    async start() {
      await request("initialize", { clientInfo: { name: "agentic-os", title: "Agentic OS", version: "1.0" }, capabilities: { experimentalApi: true, optOutNotificationMethods: QUIET } });
      send({ method: "initialized" });
      const pol = policy(perm);
      const base = { cwd: o.cwd, approvalPolicy: pol.approvalPolicy, sandbox: pol.sandbox, ...(model ? { model } : {}) };
      // A new thread gets the progress-bar tool and its rules; a resumed thread keeps the ones it started with.
      const r = threadId ? await request("thread/resume", { threadId, ...base })
        : await request("thread/start", { ...base,
          developerInstructions: [rules("plan_progress"), o.tools?.includes("publish_changes") ? PUBLISH_RULE : "", o.tools?.includes("ask_form") ? ASK_FORM_RULE : "", o.rules ?? ""].filter(Boolean).join("\n\n"),
          dynamicTools: [{ type: "function", name: "plan_progress", description: TOOL_DESCRIPTION, inputSchema: TOOL_SCHEMA },
            ...(o.tools ?? []).map((name) => ({ type: "function", name, description: TOOL_DEFS[name].description, inputSchema: TOOL_DEFS[name].schema }))] });
      threadId = String(r?.thread?.id ?? threadId);
      model = r?.model ?? r?.thread?.model ?? model;
      effort = picked.effort ?? r?.reasoningEffort ?? r?.thread?.reasoningEffort ?? null;
      if (!o.sessionId) o.sink.session(threadId);
    },
    async prompt(text, p) {
      const pol = policy(perm);
      const params: any = { threadId, input: codexInput(text) };
      if (permDirty) { params.approvalPolicy = pol.approvalPolicy; params.sandboxPolicy = pol.sandboxPolicy; permDirty = false; }
      if (picked.effort) params.effort = picked.effort;
      if (model) params.collaborationMode = { mode: p.plan ? "plan" : "default", settings: { model, reasoning_effort: effort, developer_instructions: null } };
      firstCall = null;
      return new Promise((resolve, reject) => {
        turn = { resolve, reject };
        request("turn/start", params).then((r) => { turnId = r?.turn?.id ?? turnId; }, (e) => { turn = null; reject(e); });
      });
    },
    async cancel() { if (turn && turnId) await request("turn/interrupt", { threadId, turnId }).catch(() => {}); },
    // Codex's turn/steer adds input to the running turn; servers without it refuse, and the message queues instead.
    async steer(text) {
      if (!turn || !turnId) return false;
      return request("turn/steer", { threadId, expectedTurnId: turnId, input: codexInput(text) }).then(() => true, () => false);
    },
    async setPerm(p) { if (p !== perm) { perm = p; permDirty = true; } },
    // Each turn names its model in collaborationMode; "default" needs a fresh thread/resume to learn the account default.
    async setModel(m) { if (!m) return false; model = m; return true; },
    // Each turn carries the effort too; back to default needs a fresh resume to learn the model's own.
    async setEffort(e) { if (!e) return false; picked.effort = effort = e; return true; },
    close() { killTree(proc.pid); try { proc.kill(); } catch {} },
  };
}

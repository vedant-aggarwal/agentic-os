// The ACP driver: one adapter process per job, spoken to over the Agent Client Protocol.
//   claude: @agentclientprotocol/claude-agent-acp (local dependency; falls back to the global @zed-industries/claude-code-acp)
//   codex:  @agentclientprotocol/codex-acp (global), pointed at the installed codex.exe with CODEX_PATH
// initialize -> session/new { cwd } (or session/resume / session/load for an old session) -> session/prompt.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { client, methods, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";
import { ApiError } from "../store";
import { killTree, lines, type Driver, type DriverOpts, type Perm } from "./types";

const ROOT = resolve(import.meta.dir, "..", "..");
const tail = (s: string, n: number) => (s.length > n ? "…" + s.slice(-n) : s);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/** Where each engine's ACP adapter lives (env ACP_CLAUDE / ACP_CODEX override with a path to the adapter's .js). */
export function acpAdapter(engine: "claude" | "codex") {
  const npmRoot = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "npm", "node_modules");
  const candidates = engine === "claude"
    ? [process.env.ACP_CLAUDE, join(ROOT, "node_modules", "@agentclientprotocol", "claude-agent-acp", "dist", "index.js"),
       join(npmRoot, "@agentclientprotocol", "claude-agent-acp", "dist", "index.js"), join(npmRoot, "@zed-industries", "claude-code-acp", "dist", "index.js")]
    : [process.env.ACP_CODEX, join(ROOT, "node_modules", "@agentclientprotocol", "codex-acp", "dist", "index.js"),
       join(npmRoot, "@agentclientprotocol", "codex-acp", "dist", "index.js")];
  const js = candidates.find((c) => c && existsSync(c));
  if (!js) throw new ApiError(503, `The ${engine} ACP adapter is not installed. Run: npm i -g ${engine === "claude" ? "@agentclientprotocol/claude-agent-acp" : "@agentclientprotocol/codex-acp"}`);
  return js;
}

export function acpDriver(o: DriverOpts): Driver {
  const js = acpAdapter(o.engine);
  const env = { ...o.env };
  // codex-acp modes: ask = read-only, so every change comes back as a permission request; otherwise full access
  // (his own Codex config runs that way, and the Windows sandbox helper can fail to start).
  if (o.engine === "codex") env.INITIAL_AGENT_MODE = o.perm === "ask" ? "read-only" : "agent-full-access";
  const proc = Bun.spawn([Bun.which("node") ?? "node", js], { cwd: o.cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const stderr: string[] = [];
  (async () => {
    for await (const l of lines(proc.stderr)) { stderr.push(l); if (stderr.length > 60) stderr.shift(); o.sink.log([l]); }
  })().catch(() => {});
  let conn: any = null;
  let sessionId: string | null = o.sessionId;
  let replaying = false;
  const errText = (e: unknown) => {
    const any = e as any;
    const m = String(any?.data?.details ?? any?.message ?? e);
    return clip(m === "ACP connection closed" && stderr.length ? `${m}: ${stderr.slice(-2).join(" ")}` : m, 500);
  };

  function onUpdate(u: any) {
    if (replaying) return;
    const kind = u.sessionUpdate;
    if (kind === "agent_message_chunk" || kind === "agent_thought_chunk") {
      const text = u.content?.type === "text" ? String(u.content.text ?? "") : "";
      if (text) o.sink.text(kind === "agent_message_chunk" ? "assistant" : "thought", u.messageId ?? null, text);
    } else if (kind === "tool_call" || kind === "tool_call_update") {
      const out = toolOutput(u);
      o.sink.tool({
        id: String(u.toolCallId ?? ""), title: u.title ? String(u.title) : undefined, kind: u.kind ? String(u.kind) : undefined,
        status: u.status ? String(u.status) : undefined,
        locations: Array.isArray(u.locations) && u.locations.length ? u.locations.map((x: any) => String(x.path ?? "")).filter(Boolean) : undefined,
        output: out ? tail(out, 4000) : undefined,
      });
    } else if (kind === "plan") {
      o.sink.plan((u.entries ?? []).map((x: any) => ({ content: String(x.content ?? ""), status: String(x.status ?? "pending") })));
    } else if (kind === "session_info_update" && u.title) o.sink.title(String(u.title));
  }
  function toolOutput(u: any) {
    const parts: string[] = [];
    for (const c of u.content ?? []) {
      if (c.type === "content" && c.content?.type === "text") parts.push(String(c.content.text ?? ""));
      else if (c.type === "diff") parts.push(`${c.oldText == null ? "new file" : "edit"} ${c.path}\n${clip(String(c.newText ?? ""), 1500)}`);
      else if (c.type === "terminal") parts.push("(terminal output)");
    }
    if (!parts.length && u.rawOutput != null) parts.push(typeof u.rawOutput === "string" ? u.rawOutput : JSON.stringify(u.rawOutput));
    return parts.join("\n").trim();
  }
  async function onPermission(params: any) {
    const options = (params.options ?? []).map((x: any) => ({ optionId: String(x.optionId), name: String(x.name ?? x.optionId), kind: String(x.kind ?? "") }));
    const tk = String(params.toolCall?.kind ?? "");
    const kind = tk === "edit" || tk === "delete" || tk === "move" ? "edit" : tk === "execute" ? "command" : tk === "switch_mode" ? "plan" : "other";
    const pick = await o.sink.permission({ title: String(params.toolCall?.title ?? "Permission"), kind, options });
    return pick ? { outcome: { outcome: "selected", optionId: pick } } : { outcome: { outcome: "cancelled" } };
  }

  const exited = proc.exited.then((c) => c ?? null);
  return {
    name: "acp",
    supportsPlan: false,
    exited,
    async start() {
      const stdin = proc.stdin as any;
      const w = new WritableStream<Uint8Array>({ write(c) { stdin.write(c); stdin.flush(); }, close() { stdin.end(); } });
      const app = client({ name: "agentic-os" })
        .onNotification(methods.client.session.update, ({ params }: any) => onUpdate(params.update))
        .onRequest(methods.client.session.requestPermission, ({ params }: any) => onPermission(params));
      conn = app.connect(ndJsonStream(w, proc.stdout as any));
      try {
        const init: any = await conn.agent.request(methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
        const caps = init?.agentCapabilities ?? {};
        const base = { cwd: o.cwd, mcpServers: [] };
        if (sessionId) {
          // An old session: resume (no history replay) when the adapter can, else load (replays history; ignored here).
          if (caps.sessionCapabilities?.resume) await conn.agent.request(methods.agent.session.resume, { ...base, sessionId });
          else if (caps.loadSession) {
            replaying = true;
            try { await conn.agent.request(methods.agent.session.load, { ...base, sessionId }); } finally { replaying = false; }
          } else throw new Error(`${o.engine} can't reopen an old session.`);
        } else {
          const ns: any = await conn.agent.request(methods.agent.session.new, base);
          sessionId = String(ns.sessionId);
          // Claude's ACP session id is its own session id; codex-acp's is the Codex thread id. Both match the sessions list.
          o.sink.session(sessionId);
        }
      } catch (e) {
        this.close();
        throw new Error(errText(e));
      }
    },
    async prompt(text, p) {
      if (p.plan) throw new Error("Plan mode needs the native driver.");
      try {
        const res: any = await conn.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: "text", text }] });
        return { stopReason: String(res?.stopReason ?? "end_turn") };
      } catch (e) { throw new Error(errText(e)); }
    },
    async cancel() { await conn?.agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => {}); },
    async setPerm(_p: Perm) { /* jobs.ts answers permission requests by the job's Perm */ },
    close() {
      try { conn?.close(); } catch {}
      killTree(proc.pid);
      try { proc.kill(); } catch {}
    },
  };
}

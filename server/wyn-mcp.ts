// Wyn's tools for her chat brain. Codex starts this as an MCP server (stdio, one JSON-RPC message per line)
// for each turn; the environment says whose Agentic OS it acts on and which turn the changes belong to.
// v2: besides her built-in tools (wyn-tools.ts, run here), she gets every app's tools (MODULES[].tools, aggregated in
// agent-tools.ts). Those run in the server itself, which holds the modules and their context: this process lists and
// calls them over loopback with the agent token (WYN_SERVER, WYN_AGENT_TOKEN_FILE). His per-app autonomy applies to
// both: a switched-off app's tools aren't offered, and an app set to "ask" makes its writes ask first.
import { existsSync, readFileSync } from "node:fs";
import { openStore } from "./store";
import { openAI } from "./ai";
import { openWynDb, runTool, TOOLS } from "./wyn-tools";
import { autonomyOf, coreModeOf, gateCore } from "./agent-tools";

const env = (k: string) => process.env[k] ?? "";
const s = openStore(env("WYN_AGENTOS_DB"), env("WYN_EVENTS") || null);
const n = openWynDb(env("WYN_DIR"));
const user = { id: Number(env("WYN_USER_ID")), role: env("WYN_ROLE") || "member" };
const ai = env("WYN_DATA") ? openAI(env("WYN_DATA")) : null;
const ctx = { s, n, turn: env("WYN_TURN") || "chat", user, dir: env("WYN_DIR"),
  give: ai && user.role === "owner" ? (id: string, b: any) => ai.give(user as any, s, id, b) : undefined,
  agents: ai && user.role === "owner" ? () => ai.agentsFor(user as any) : undefined };

// ── the apps' tools, from the server ──
const SERVER = env("WYN_SERVER");
const token = (() => { try { const f = env("WYN_AGENT_TOKEN_FILE"); return f && existsSync(f) ? readFileSync(f, "utf8").trim() : ""; } catch { return ""; } })();
async function server(path: string, body?: unknown, timeoutMs = 15_000) {
  if (!SERVER || !token) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${SERVER}/api/v1${path}`, { method: body === undefined ? "GET" : "POST", signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { error: j?.error ?? `The PC said ${r.status}.` };
    return j;
  } catch (e) { return { error: e instanceof Error && e.name === "AbortError" ? "The PC took too long." : "Couldn't reach the PC's app tools." }; }
  finally { clearTimeout(t); }
}
let appTools: { name: string; description: string; inputSchema: any }[] = [];
const appNames = new Set<string>();
async function loadAppTools() {
  const r: any = await server("/wyn/tools/mcp", undefined, 8000);
  appTools = Array.isArray(r?.tools) ? r.tools : [];
  appNames.clear();
  for (const t of appTools) appNames.add(t.name);
}

const send = (m: unknown) => process.stdout.write(JSON.stringify(m) + "\n");
const reply = (id: unknown, result: unknown) => send({ jsonrpc: "2.0", id, result });
const text = (out: unknown) => ({ content: [{ type: "text", text: JSON.stringify(out) }], isError: !!(out as any)?.error });
let buf = "";
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) {
  buf += decoder.decode(chunk, { stream: true });
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let m: any;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.method === "initialize") {
      reply(m.id, { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "wyn", version: "2.0" } });
    } else if (m.method === "tools/list") {
      await loadAppTools();
      const p = autonomyOf(n);
      const core = TOOLS.filter((t) => coreModeOf(t.name, p) !== "off").map((t) => ({ name: t.name, description: t.description, inputSchema: t.parameters }));
      reply(m.id, { tools: [...core, ...appTools.filter((t) => !TOOLS.some((c) => c.name === t.name))] });
    } else if (m.method === "tools/call") {
      const name = String(m.params?.name ?? ""), args = m.params?.arguments ?? {};
      if (TOOLS.some((t) => t.name === name)) {
        const gate = await gateCore(n, name, args, ctx.turn);
        reply(m.id, text(gate ?? await runTool(name, args, ctx)));
      } else if (appNames.has(name) || name.includes("_")) {
        const r: any = await server("/wyn/tools/run", { name, args, turn: ctx.turn }, 100_000);
        reply(m.id, text(r?.result ?? r ?? { error: "No answer from the PC." }));
      } else reply(m.id, text({ error: `No tool ${name}.` }));
    } else if (m.method === "ping") {
      reply(m.id, {});
    } else if (m.id != null) {
      send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
    }
  }
}

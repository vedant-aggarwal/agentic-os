#!/usr/bin/env bun
// wyn-ask: a local agent asks the owner something through Wyn. She decides whether to answer from memory,
// message him, call now, call later, or turn it down, and the answer comes back here.
// wyn-request-call: a local agent asks to talk to the owner on a call. Wyn decides whether to ring him now,
// later, not at all (or settles it herself); after the call the agent gets what was decided and the action points.
//
//   wyn-ask "Should I ship the Pulse Chat fix tonight?" --from "Claude Code (pulsechat)" --urgency normal --wait 900
//   wyn-request-call "Need 5 minutes on the Atlas ERP data model" --from "Claude Code (atlas)" --urgency high --wait 3600
//   wyn-ask status ask_xxxx --wait 600
//
// Options: --from NAME, --urgency low|normal|high, --context TEXT, --wait SECONDS (wait for his answer), --json.
// Exit codes: 0 answered, 2 still waiting, 3 declined or missed, 1 error. Only works on this PC (the server refuses the tunnel).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// The server's port: WYN_URL, else PORT in server/config.json (next to this folder), else 8090.
const configPort = () => { try { return String(JSON.parse(readFileSync(join(import.meta.dir, "..", "config.json"), "utf8")).PORT ?? ""); } catch { return ""; } };
const BASE = process.env.WYN_URL ?? `http://127.0.0.1:${configPort() || "8090"}`;
// The token lives in the server's data folder: WYN_AGENT_TOKEN_FILE, else AGENTOS_DATA_DIR/agent.token, else the usual folder.
const DATA_DIR = process.env.AGENTOS_DATA_DIR || join(homedir(), "agentic-os", "data");
const TOKEN_FILE = process.env.WYN_AGENT_TOKEN_FILE || join(DATA_DIR, "agent.token");
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v ?? ""; };
const asJson = args.includes("--json") ? (args.splice(args.indexOf("--json"), 1), true) : false;
const mode = args.includes("--call") ? (args.splice(args.indexOf("--call"), 1), "call") : "ask";
const from = flag("from") ?? (process.env.WYN_AGENT_NAME || "A local agent");
const urgency = flag("urgency") ?? "normal";
const context = flag("context");
const wait = Number(flag("wait") ?? 0);

if (!args.length || args[0] === "--help" || args[0] === "-h") {
  console.log(readFileSync(import.meta.path, "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
  process.exit(args.length ? 0 : 1);
}
if (!existsSync(TOKEN_FILE)) { console.error(`No agent token at ${TOKEN_FILE}. Is the Agentic OS server running on this PC?`); process.exit(1); }
const token = readFileSync(TOKEN_FILE, "utf8").trim();
const call = async (path: string, init: RequestInit = {}) => {
  const r = await fetch(BASE + "/api/v1" + path, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(j.error ?? `Server said ${r.status}`); process.exit(1); }
  return j;
};

let req: any;
if (args[0] === "status") {
  req = await call(`/agent/requests/${encodeURIComponent(args[1] ?? "")}`);
} else {
  req = await call("/agent/call", { method: "POST", body: JSON.stringify({ question: args.join(" "), from, urgency, context, mode }) });
  // Wyn takes a moment to decide.
  const end = Date.now() + 180_000;
  while (req.status === "deciding" && Date.now() < end) req = await call(`/agent/requests/${req.id}?wait=30`);
}
const deadline = Date.now() + wait * 1000;
const DONE = ["answered", "declined", "missed"];
while (!DONE.includes(req.status) && Date.now() < deadline) {
  req = await call(`/agent/requests/${req.id}?wait=${Math.min(60, Math.ceil((deadline - Date.now()) / 1000))}`);
}

if (asJson) console.log(JSON.stringify(req, null, 2));
else {
  const lines = [`id: ${req.id}`, `status: ${req.status}`, req.decision && `Wyn's decision: ${req.decision}`, req.why && `why: ${req.why}`, req.answer && `answer: ${req.answer}`];
  if (!DONE.includes(req.status)) lines.push(`Check again: wyn-ask status ${req.id} --wait 600`);
  console.log(lines.filter(Boolean).join("\n"));
}
process.exit(req.status === "answered" ? 0 : req.status === "declined" || req.status === "missed" ? 3 : 2);

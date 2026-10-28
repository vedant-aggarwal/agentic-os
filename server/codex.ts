// Codex on the PC, one non-interactive run at a time per call: `codex exec` with the prompt on stdin, the reply
// shaped by a JSON schema when one is given. Codex is signed in with the owner's ChatGPT account, so there is no
// API bill. Treat what it returns as a claim: a module checks the file or diff Codex says it made.
//   runCodex({ prompt, schema?, cwd?, sandbox?, model?, images?, timeoutMs? }) -> { out, text, ms }
// `out` is the parsed JSON when a schema was given (otherwise null); `text` is the last agent message.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiError } from "./store";

const CODEX = process.env.CODEX_BIN || "codex";
const cfgPath = join(import.meta.dir, "config.json");
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, "utf8")) : {};
const conf = (k: string, d: string) => process.env[k] ?? cfg[k] ?? d;
// A model is always passed explicitly: the exec path rejects some names (a ChatGPT login refuses "gpt-5.5", for one).
// ~/.codex/models_cache.json lists what this login may use; gpt-6.1-sol is the account's workhorse and what Wyn runs on.
export const CODEX_MODEL = conf("CODEX_MODEL", "gpt-6.1-sol");
const CODEX_EFFORT = conf("CODEX_EFFORT", "medium");

export type CodexOpts = {
  prompt: string; schema?: object; cwd?: string; sandbox?: "read-only" | "workspace-write"; model?: string; images?: string[]; timeoutMs?: number;
  effort?: "low" | "medium" | "high";
};
export type CodexResult = { out: any; text: string; ms: number };

/** Claude refuses to start inside another Claude Code session's environment; Codex gets the same clean env. */
function cleanEnv() {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v != null && !k.startsWith("CLAUDECODE") && !k.startsWith("CLAUDE_CODE_")) env[k] = v;
  return env;
}

export async function runCodex(o: CodexOpts): Promise<CodexResult> {
  const prompt = String(o.prompt ?? "").trim();
  if (!prompt) throw new ApiError(400, "Codex needs a prompt.");
  const cwd = o.cwd && existsSync(o.cwd) ? o.cwd : tmpdir();
  const sandbox = o.sandbox === "workspace-write" ? "workspace-write" : "read-only";
  const model = o.model || CODEX_MODEL;
  const timeoutMs = Math.max(5_000, Number(o.timeoutMs) || 180_000);
  const dir = mkdtempSync(join(tmpdir(), "aos-codex-"));
  const schemaFile = join(dir, "schema.json"), outFile = join(dir, "last.txt");
  const t0 = Date.now();
  try {
    if (o.schema) writeFileSync(schemaFile, JSON.stringify(o.schema));
    // --ignore-user-config: the user's config.toml pins model, xhigh effort, full-access sandbox, MCP servers and a
    // notify hook; none of that belongs to a module call. Auth still comes from CODEX_HOME. --disable apps keeps the
    // ChatGPT connector apps (and their OAuth noise on stderr) out of the run.
    const args = ["exec", "--json", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral", "--color", "never", "--disable", "apps",
      "-s", sandbox, "-C", cwd, "-m", model, "-o", outFile,
      "-c", `model_reasoning_effort="${o.effort ?? CODEX_EFFORT}"`, "-c", `approval_policy="never"`,
      ...(o.schema ? ["--output-schema", schemaFile] : []),
      ...(o.images ?? []).filter((f) => existsSync(f)).flatMap((f) => ["-i", f]),
      "-"];
    const p = Bun.spawn([CODEX, ...args], { cwd, env: cleanEnv(), stdin: new Blob([prompt]), stdout: "pipe", stderr: "pipe" });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill(); }, timeoutMs);
    const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    clearTimeout(timer);
    await p.exited;
    const ms = Date.now() - t0;
    // The JSONL stream carries the agent's messages; the -o file holds the last one (the schema-shaped answer).
    const texts: string[] = [];
    let error: string | null = null;
    for (const line of stdout.split("\n")) {
      const l = line.trim();
      if (!l.startsWith("{")) continue;
      try {
        const e = JSON.parse(l);
        if (e.type === "item.completed" && e.item?.type === "agent_message") texts.push(String(e.item.text ?? ""));
        else if (e.type === "error" || e.type === "turn.failed") error = String(e.message ?? e.error?.message ?? l).slice(0, 400);
      } catch {}
    }
    const last = existsSync(outFile) ? readFileSync(outFile, "utf8").trim() : "";
    const text = last || texts.at(-1)?.trim() || "";
    if (timedOut) { console.error(`[codex] timed out after ${ms}ms (${model})`); throw new ApiError(502, "Codex took too long. Try again."); }
    if (p.exitCode !== 0 || !text) {
      console.error("[codex] failed", p.exitCode, error ?? "", stderr.split("\n").filter(Boolean).slice(-4).join(" | ").slice(0, 600));
      throw new ApiError(502, error ? `Codex failed: ${error}` : "Codex couldn't answer that. Try again.");
    }
    let out: any = null;
    if (o.schema) {
      try { out = JSON.parse(text); } catch {
        const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        try { if (m) out = JSON.parse(m[0]); } catch {}
      }
      if (out == null) { console.error("[codex] reply is not JSON", text.slice(0, 300)); throw new ApiError(502, "Codex didn't answer in the shape asked for. Try again."); }
    }
    console.log(`[codex] ${model} ${ms}ms${o.schema ? " (schema)" : ""}`);
    return { out, text, ms };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

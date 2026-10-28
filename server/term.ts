// Terminals from the job server: a client for aos-ptyd (the PC's terminal host, scripts/ptyd/ptyd.ts in the desktop
// repo) so the phone and the `agentos term` CLI can list, start, read, answer and stop the same sessions the desktop
// Code page shows. ptyd stays loopback-only; this server adds owner auth and the phone rules on top.
//   ptyd: http://127.0.0.1:<AOS_PTYD_PORT|8094>, Bearer <AOS_PTYD_DIR|~/.agentos/ptyd>/token; started here if it's down.
// It also watches ptyd and pushes "needs you" / "finished" for Claude and Codex terminals, like jobs do.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ApiError } from "./store";

export type TermSession = {
  id: string; kind: "shell" | "claude" | "codex" | "custom"; title: string; project: string | null; cwd: string; argv: string[];
  status: "running" | "needs_input" | "idle" | "exited"; detail: string | null; attention: boolean; engineSessionId: string | null;
  taskIds: string[]; permissionMode: string | null; model: string | null; createdAt: string; updatedAt: string; exitedAt: string | null; exitCode: number | null;
};
/** Keys the phone and CLI can press without a keyboard: TUI prompts are answered with these. */
export const KEYS: Record<string, string> = {
  enter: "\r", esc: "\x1b", tab: "\t", "shift-tab": "\x1b[Z", up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C",
  "ctrl-c": "\x03", backspace: "\x7f", space: " ", y: "y", n: "n", "1": "1", "2": "2", "3": "3", "4": "4",
};
const isAgent = (s: TermSession) => s.kind === "claude" || s.kind === "codex";

export function openTerm(o: {
  dataDir: string; push: (title: string, body: string, data?: Record<string, unknown>) => Promise<void>;
  /** A project's folder, for "start in project X". */
  folderOf: (slug: string) => string | null;
}) {
  const port = () => Number(process.env.AOS_PTYD_PORT || 8094);
  const dir = () => process.env.AOS_PTYD_DIR || join(homedir(), ".agentos", "ptyd");
  const script = () => process.env.AOS_PTYD_SCRIPT || join(homedir(), "agentic-os", "scripts", "ptyd", "ptyd.ts");
  const token = () => { try { return readFileSync(join(dir(), "token"), "utf8").trim(); } catch { return ""; } };
  const settingsFile = join(o.dataDir, "term-settings.json");
  let settings = { phoneShellInput: false };
  try { settings = { ...settings, ...JSON.parse(readFileSync(settingsFile, "utf8")) }; } catch {}

  async function call<T = any>(path: string, init: { method?: string; json?: unknown } = {}): Promise<T> {
    const r = await fetch(`http://127.0.0.1:${port()}${path}`, {
      method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
      headers: { Authorization: `Bearer ${token()}`, ...(init.json !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const d: any = await r.json().catch(() => ({}));
    if (!r.ok) throw new ApiError(r.status === 404 ? 404 : r.status === 429 ? 429 : r.status === 409 ? 409 : 502, d.error ?? `Terminal host error (${r.status})`);
    return d as T;
  }
  let starting: Promise<void> | null = null;
  /** ptyd up, or started (detached, so it outlives this server) and waited for. */
  async function ensure() {
    const up = () => fetch(`http://127.0.0.1:${port()}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
    if (await up()) return;
    starting ??= (async () => {
      if (!existsSync(script())) throw new ApiError(503, "The terminal host isn't installed on the PC.");
      const node = Bun.which("node");
      if (!node) throw new ApiError(503, "Node isn't installed, so the terminal host can't start.");
      const p = Bun.spawn([node, "--disable-warning=ExperimentalWarning", "--experimental-strip-types", script()], {
        stdin: "ignore", stdout: "ignore", stderr: "ignore", env: { ...process.env, AOS_PTYD_PORT: String(port()), AOS_PTYD_DIR: dir() },
      });
      p.unref();
      for (let i = 0; i < 25; i++) { await Bun.sleep(300); if (await up()) return; }
      throw new ApiError(503, "The terminal host didn't start.");
    })().finally(() => { starting = null; });
    await starting;
  }
  const api = async <T = any>(path: string, init?: { method?: string; json?: unknown }) => { await ensure(); return call<T>(path, init); };

  // Listing doesn't start the host: a phone refreshing the list shouldn't launch it. Down = no terminals.
  const list = () => call<{ sessions: TermSession[]; maxRunningAgents: number }>("/sessions")
    .then((r) => ({ ...r, down: false }), () => ({ sessions: [] as TermSession[], maxRunningAgents: 4, down: true }));
  const get = (id: string) => api<{ session: TermSession }>(`/sessions/${encodeURIComponent(id)}`).then((r) => r.session);
  async function create(b: any) {
    const kind = ["shell", "claude", "codex"].includes(b.kind) ? b.kind : null;
    if (!kind) throw new ApiError(400, 'kind is "shell", "claude" or "codex".');
    let cwd: string | null = b.cwd ? String(b.cwd) : null;
    if (!cwd && b.project) {
      cwd = o.folderOf(String(b.project));
      if (!cwd) throw new ApiError(400, `Project "${b.project}" has no folder on the PC.`);
    }
    if (cwd && !existsSync(cwd)) throw new ApiError(400, `The folder ${cwd} doesn't exist on the PC.`);
    const r = await api<{ session: TermSession }>("/sessions", { json: {
      kind, cwd, project: b.project ?? null, title: b.title ? String(b.title).slice(0, 120) : undefined, prompt: b.prompt ? String(b.prompt).slice(0, 20000) : undefined,
      taskIds: Array.isArray(b.taskIds) ? b.taskIds.map(String) : [], permissionMode: b.permissionMode || undefined, model: b.model || undefined, resume: b.resume || undefined,
    } });
    return r.session;
  }
  async function text(id: string, lines = 200) { return api<{ text: string; status: string }>(`/sessions/${encodeURIComponent(id)}/text?lines=${Math.min(2000, Math.max(1, lines))}`); }
  /** fromPhone: a signed-in phone, not this PC. Raw shells take phone input only when he switched that on. */
  async function guardInput(id: string, fromPhone: boolean) {
    const s = await get(id);
    if (s.status === "exited") throw new ApiError(409, "This terminal has exited.");
    if (fromPhone && !isAgent(s) && !settings.phoneShellInput) throw new ApiError(403, "Typing into a plain terminal from the phone is off. Turn it on in the Code tab settings.");
    return s;
  }
  async function send(id: string, b: { text?: string; enter?: boolean }, fromPhone: boolean) {
    await guardInput(id, fromPhone);
    await api(`/sessions/${encodeURIComponent(id)}/send`, { json: { text: String(b.text ?? "").slice(0, 20000), enter: b.enter !== false } });
    return { ok: true };
  }
  async function key(id: string, k: string, fromPhone: boolean) {
    const seq = KEYS[String(k).toLowerCase()];
    if (!seq) throw new ApiError(400, `Unknown key. Use one of: ${Object.keys(KEYS).join(", ")}.`);
    await guardInput(id, fromPhone);
    await api(`/sessions/${encodeURIComponent(id)}/send`, { json: { text: seq, enter: false } });
    return { ok: true };
  }
  const action = (id: string, a: "kill" | "restart" | "done", b: unknown = {}) => api(`/sessions/${encodeURIComponent(id)}/${a}`, { json: b });
  const remove = (id: string) => api(`/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  /** Long-poll until the session reaches a state. settled = anything but running. */
  async function wait(id: string, until: string, timeoutS: number, signal?: AbortSignal) {
    const want = (s: TermSession) => until === "settled" ? s.status !== "running" : until === "idle" ? s.status === "idle" || s.status === "exited" : s.status === until;
    if (!["idle", "needs_input", "exited", "settled", "running"].includes(until)) throw new ApiError(400, "until is idle, needs_input, exited, settled or running.");
    const end = Date.now() + Math.min(900, Math.max(1, timeoutS)) * 1000;
    let s = await get(id);
    while (!want(s) && Date.now() < end && !signal?.aborted) { await Bun.sleep(1000); s = await get(id); }
    return { session: s, reached: want(s) };
  }
  function setSettings(b: any) {
    if (typeof b?.phoneShellInput === "boolean") settings.phoneShellInput = b.phoneShellInput;
    writeFileSync(settingsFile, JSON.stringify(settings));
    return settings;
  }

  // Alerts for agent terminals, the same way jobs alert: needs you, and finished a turn.
  const seen = new Map<string, string>();
  let primed = false;
  async function watch() {
    let r: { sessions: TermSession[] };
    try { r = await call("/sessions"); } catch { return; } // ptyd down: nothing is running, nothing to say
    for (const s of r.sessions) {
      const prev = seen.get(s.id);
      seen.set(s.id, s.status);
      if (!primed || !isAgent(s) || prev === s.status) continue;
      const name = s.kind === "claude" ? "Claude" : "Codex";
      if (s.status === "needs_input") o.push(`${name} needs you: ${s.title}`, (s.detail ?? "Waiting for your answer").slice(0, 180), { kind: "term", event: "needs", termId: s.id, url: `agenticos://term/${s.id}` }).catch(() => {});
      else if (prev === "running" && s.status === "idle") o.push(`${name} finished: ${s.title}`, (s.detail ?? "Done").slice(0, 180), { kind: "term", event: "finished", termId: s.id, url: `agenticos://term/${s.id}` }).catch(() => {});
    }
    primed = true;
  }
  if (process.env.TERM_WATCH !== "off") setInterval(watch, 3000);

  return { list, get, create, text, send, key, action, remove, wait, settings: () => settings, setSettings, ensure };
}
export type Term = ReturnType<typeof openTerm>;

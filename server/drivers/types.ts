// One interface for every way of running Claude or Codex as a structured chat. jobs.ts owns rows, events and
// permissions; a driver only speaks its engine's protocol and reports through a Sink.
//   acp:    today's ACP adapters (claude-agent-acp, codex-acp), kept as the fallback
//   native: Claude Agent SDK for claude, `codex app-server` (JSON-RPC over stdio) for codex, the way T3 Code runs them

/** ask = every change asks; edits = file edits go through, commands ask; auto = nothing asks. */
export type Perm = "ask" | "edits" | "auto";
export type DriverName = "acp" | "native";
export type PermOption = { optionId: string; name: string; kind: string };
/** What the engine wants to do. kind lets jobs.ts apply the job's Perm the same way for every driver. */
export type PermReq = { title: string; kind: "edit" | "command" | "plan" | "question" | "other"; options: PermOption[] };
export type ToolUpd = { id: string; title?: string; kind?: string; status?: string; locations?: string[]; output?: string };
/** cache: the turn's first model call, so jobs.ts can tell whether the prompt cache was still warm when the turn began. */
export type Usage = { input: number; output: number; contextPct?: number | null; cache?: { read: number; write: number; fresh: number } | null };
/** Extra tools the job runner gives an agent (server/ship-tools.ts): publish_changes for every job, ship_status for Builders. */
export type ExtraTool = "publish_changes" | "ship_status" | "ask_form";
export type FormQuestion = { question: string; header?: string; multiSelect?: boolean; options: { label: string; description?: string; preview?: string }[] };

export type Sink = {
  /** Append streamed text. Chunks with the same msgId merge into one event. */
  text(type: "assistant" | "thought", msgId: string | null, chunk: string): void;
  /** Create or update a tool row by id. */
  tool(u: ToolUpd): void;
  /** The agent's checklist for this turn (replaces the previous one). */
  plan(entries: { content: string; status: string }[]): void;
  /** A written plan from plan mode, shown as one block the user can approve. */
  planText(markdown: string): void;
  /** Ask (or auto-answer, by the job's Perm). Resolves with the chosen optionId, or null when cancelled. */
  permission(r: PermReq): Promise<string | null>;
  /** Several questions shown as one form. Resolves with question text → answer text, or null when skipped or cancelled. */
  ask(form: FormQuestion[]): Promise<Record<string, string> | null>;
  /** A plan_progress call from the agent. Returns the line the agent gets back (done/total, state, active step, or why it was refused). */
  progress(input: unknown): { ok: boolean; text: string };
  /** The bar as it stands (for reminders): null when there is none. */
  currentProgress(): { source: "tool" | "todo"; state: string; done: number; total: number; active: string | null; id: string } | null;
  usage(u: Usage): void;
  /** One of the extra tools (opts.tools) was called. Resolves with the text the agent gets back. */
  call?(tool: ExtraTool, args: any): Promise<{ ok: boolean; text: string }>;
  /** The last message of a finished turn (Claude: the SDK message uuid), so a later rewind can resume the session there. */
  turnMark?(uuid: string): void;
  /** Work outside a turn: background tasks still running (subagents, shells), and whether the agent woke up on its own
   *  to handle one that finished. A job with either is still working after its turn ended. */
  activity?(a: { background: number; awake: boolean }): void;
  title(t: string): void;
  /** The engine's own session id (Claude session id / Codex thread id), once known. */
  session(id: string): void;
  log(lines: string[]): void;
};

export type DriverOpts = {
  engine: "claude" | "codex"; cwd: string; env: Record<string, string>;
  /** Resume this session when set; else start a new one. */
  sessionId: string | null; perm: Perm; model?: string | null;
  /** Reasoning effort ("low" … "max"; Codex also "ultra"); null = the model's default. */
  effort?: string | null; sink: Sink;
  /** Extra tools for this job, and extra system rules (a Builder's instructions). */
  tools?: ExtraTool[]; rules?: string | null;
  /** Rewind: resume sessionId only up to this message and fork it into a new session (Claude). */
  resumeAt?: string | null;
  /** Folders it may read without asking besides cwd (the attachments folder). */
  readDirs?: string[];
};

export interface Driver {
  readonly name: DriverName;
  /** Start or resume the session. Resolves once the engine is ready for a prompt. */
  start(): Promise<void>;
  /** One turn. Resolves when the agent stops; stopReason is "end_turn", "cancelled" or a short reason. */
  prompt(text: string, o: { plan: boolean }): Promise<{ stopReason: string }>;
  cancel(): Promise<void>;
  /** Steer: hand the agent a message while its turn runs; it reads it at its next step. False when it can't. */
  steer?(text: string): Promise<boolean>;
  /** Change the permission level for the next tool calls. */
  setPerm(p: Perm): Promise<void>;
  /** Switch the model for the next turn without restarting (null = the engine's default). Resolves false when it can't;
   *  absent when the driver never can. Either way jobs.ts closes the engine and resumes the session on the new model. */
  setModel?(model: string | null): Promise<boolean>;
  /** Same for the reasoning effort. */
  setEffort?(effort: string | null): Promise<boolean>;
  readonly supportsPlan: boolean;
  close(): void;
  /** Resolves when the engine process ends (exit code, or null when it ended without one). */
  readonly exited: Promise<number | null>;
}

export const ALLOW_OPTIONS: PermOption[] = [
  { optionId: "allow", name: "Allow", kind: "allow_once" },
  { optionId: "always", name: "Allow for this session", kind: "allow_always" },
  { optionId: "deny", name: "Deny", kind: "reject_once" },
];
export const PLAN_OPTIONS: PermOption[] = [
  { optionId: "approve", name: "Approve plan and start", kind: "allow_once" },
  { optionId: "deny", name: "Keep planning", kind: "reject_once" },
];

/** Bun.spawn-style stream of lines (stdout / stderr of a child). */
export async function* lines(stream: ReadableStream<Uint8Array> | any) {
  const dec = new TextDecoder();
  let buf = "";
  for await (const c of stream as AsyncIterable<Uint8Array>) {
    buf += dec.decode(c, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line.trim()) yield line;
    }
  }
  if (buf.trim()) yield buf;
}

/** End a child and everything it started. On Windows a plain kill leaves the engine's own children (shells running
 *  commands) alive, still holding the job folder open. */
export function killTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === "win32") { try { Bun.spawnSync(["taskkill", "/PID", String(pid), "/T", "/F"], { stdout: "ignore", stderr: "ignore" }); } catch {} }
  else { try { process.kill(-pid); } catch { try { process.kill(pid); } catch {} } }
}

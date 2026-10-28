// A job's progress bar: stages of steps the agent reports, the way the plan-progress mod for Claude Code does it.
// Claude jobs get a plan_progress tool (drivers/claude-sdk.ts): create the bar once with the whole plan, then move it
// with short calls. Agents that only keep a checklist (TodoWrite, Codex's update_plan) get a one-stage bar from it.
// Pure functions; jobs.ts stores the result in the job's meta and sends it with the job.

export type StepStatus = "pending" | "active" | "done" | "error" | "skipped";
export type ProgressState = "running" | "needs_input" | "error" | "done";
export type Step = { title: string; status: StepStatus; at?: string };
export type Stage = { name: string; steps: Step[] };
export type Progress = {
  id: string; title: string; source: "tool" | "todo"; state: ProgressState; note: string | null;
  stages: Stage[]; done: number; total: number; active: string | null; stage: string | null; updatedAt: string;
};

const STATUSES: StepStatus[] = ["pending", "active", "done", "error", "skipped"];
const STATES: ProgressState[] = ["running", "needs_input", "error", "done"];
const str = (v: unknown, max = 120) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const finished = (s: StepStatus) => s === "done" || s === "skipped";
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const iso = () => new Date().toISOString();
const asStatus = (v: unknown): StepStatus => {
  const s = String(v ?? "");
  if (s === "in_progress" || s === "inProgress") return "active";
  if (s === "completed") return "done";
  if (s === "failed") return "error";
  return STATUSES.includes(s as StepStatus) ? (s as StepStatus) : "pending";
};

export const rules = (tool: string) => `# Progress bar
The user follows this job from their phone through a progress bar. For any task needing more than ~3 edits or commands, call ${tool} before the work: create the bar once with the whole breakdown (2-7 stages of steps {title}, or kind "todo" for one flat list; titles of at most 4 words; the first open step becomes active). Then move it with short calls as you go: {next:true} when the active step is finished, or {done:[...], active:"..."}, {failed:"...", note}. When the plan changes, resend stages; steps sent without a status keep their done by title. Send state "needs_input" with a note before asking the user to decide, and state "done" when everything is finished. Never describe the bar in your replies.`;
export const RULES = rules("mcp__aos__plan_progress");

/** plan_progress's input, as JSON Schema (Codex dynamic tools; the Claude tool builds the same shape in zod). */
const STEP_SCHEMA = { anyOf: [{ type: "string" }, { type: "object", properties: { title: { type: "string" }, status: { type: "string", enum: ["pending", "active", "done", "error", "skipped"] } }, required: ["title"] }] };
export const TOOL_DESCRIPTION = 'Agentic OS progress bar for this job (the user watches it on their phone). Create: {id, title, stages:[{name, steps:[{title}]}]} (or kind:"todo" with steps). Move: {next:true} | {done:[titles], active:title} | {failed:title, note} | {state:"needs_input"|"done", note}. Resend stages when the plan changes.';
export const TOOL_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" }, title: { type: "string" }, kind: { type: "string", enum: ["stages", "todo"] },
    stages: { type: "array", items: { type: "object", properties: { name: { type: "string" }, steps: { type: "array", items: STEP_SCHEMA } }, required: ["name", "steps"] } },
    steps: { type: "array", items: STEP_SCHEMA },
    next: { type: "boolean" }, done: { type: "array", items: { type: "string" } }, active: { type: "string" }, failed: { type: "string" },
    state: { type: "string", enum: ["running", "needs_input", "error", "done"] }, note: { type: "string" },
  },
};

/** Done/total, the active step and its stage, recomputed from the steps. */
function summed(p: Omit<Progress, "done" | "total" | "active" | "stage">): Progress {
  const steps = p.stages.flatMap((s) => s.steps.map((st) => ({ s, st })));
  const cur = steps.find((x) => x.st.status === "active" || x.st.status === "error") ?? steps.find((x) => !finished(x.st.status));
  const done = steps.filter((x) => finished(x.st.status)).length;
  let state = p.state;
  if (steps.length && done === steps.length && state === "running") state = "done";
  return { ...p, state, done, total: steps.length, active: cur?.st.title ?? null, stage: cur?.s.name ?? null };
}

/** With nothing in progress, the first open step is the current one. */
function activate(stages: Stage[]): Stage[] {
  const steps = stages.flatMap((s) => s.steps);
  if (steps.some((st) => st.status === "active" || st.status === "error")) return stages;
  const first = steps.find((st) => st.status === "pending");
  if (first) first.status = "active";
  return stages;
}

function parseStages(input: any): Stage[] {
  if (input.kind === "todo" && !Array.isArray(input.stages) && Array.isArray(input.steps)) input = { stages: [{ name: "Tasks", steps: input.steps }] };
  return list(input.stages).map((s: any) => ({
    name: str(s?.name, 80) || "Stage",
    steps: list(s?.steps).map((st: any) => (typeof st === "string" ? { title: str(st) || "Step", status: "pending" as StepStatus } : { title: str(st?.title) || "Step", status: asStatus(st?.status) })),
  })).filter((s) => s.steps.length > 0).slice(0, 12);
}

/** Apply one plan_progress call. Returns the new bar, or an error naming the bar's steps. */
export function applyTool(prev: Progress | null, input: any): { progress?: Progress; error?: string } {
  input = input ?? {};
  const at = iso();
  let stages: Stage[];
  const creating = Array.isArray(input.stages) || (input.kind === "todo" && Array.isArray(input.steps));
  // A plan sent under a new id starts a new bar; short calls always move the current one.
  let base = prev && prev.source === "tool" && (!creating || !input.id || prev.id === str(input.id, 60)) ? prev : null;
  if (creating) {
    const fresh = parseStages(input);
    if (!fresh.length) return { error: "plan_progress: a plan needs at least one stage with steps." };
    // A resent plan keeps what is finished: a step sent without a status under a title that was done stays done.
    const was = new Map((base?.stages ?? []).flatMap((s) => s.steps).filter((st) => finished(st.status)).map((st) => [st.title.toLowerCase(), st]));
    stages = fresh.map((s) => ({ ...s, steps: s.steps.map((st) => (st.status === "pending" && was.has(st.title.toLowerCase()) ? { ...was.get(st.title.toLowerCase())! } : st)) }));
    if (!base) base = { id: str(input.id, 60) || "plan", title: str(input.title, 80) || "Plan", source: "tool", state: "running", note: null, stages: [], done: 0, total: 0, active: null, stage: null, updatedAt: at };
  } else {
    if (!base) return { error: 'plan_progress: no bar yet. Create one first: {id, title, stages:[{name, steps:[{title}]}]}.' };
    stages = base.stages.map((s) => ({ ...s, steps: s.steps.map((st) => ({ ...st })) }));
  }
  const steps = stages.flatMap((s) => s.steps);
  const find = (title: unknown) => {
    const t = str(title);
    return steps.find((st) => same(st.title, t) && !finished(st.status)) ?? steps.find((st) => same(st.title, t));
  };
  const named = [...list(input.done), input.active, input.failed].filter((x) => typeof x === "string" && x.trim());
  const missing = named.filter((t) => !find(t));
  if (missing.length) return { error: `plan_progress: no step ${missing.map((t) => `"${str(t, 60)}"`).join(", ")}. Its steps: ${steps.map((s) => s.title).join(", ").slice(0, 400)}` };
  const finish = (st: Step) => { if (!finished(st.status)) { st.status = "done"; st.at = at; } };
  if (input.next === true) {
    const i = steps.findIndex((st) => st.status === "active");
    const cur = i >= 0 ? steps[i] : steps.find((st) => !finished(st.status));
    if (cur) {
      finish(cur);
      const j = steps.indexOf(cur);
      const following = steps.slice(j + 1).find((st) => st.status === "pending") ?? steps.find((st) => st.status === "pending");
      if (following) following.status = "active";
    }
  }
  for (const t of list(input.done)) { const st = find(t); if (st) finish(st); }
  if (typeof input.active === "string" && input.active.trim()) {
    const target = find(input.active)!;
    // Steps that were in progress before the new current one count as done.
    for (const st of steps) if (st.status === "active" && st !== target) finish(st);
    const k = steps.indexOf(target);
    steps.forEach((st, i) => { if (i < k && st.status === "active") finish(st); });
    target.status = "active";
  } else if (list(input.done).length && !steps.some((st) => st.status === "active")) {
    const lastDone = Math.max(...list(input.done).map((t) => steps.indexOf(find(t)!)));
    const following = steps.slice(lastDone + 1).find((st) => st.status === "pending") ?? steps.find((st) => st.status === "pending");
    if (following) following.status = "active";
  }
  let state: ProgressState = base.state === "done" && steps.some((st) => !finished(st.status)) ? "running" : base.state;
  let note = base.note;
  if (typeof input.failed === "string" && input.failed.trim()) { const st = find(input.failed)!; st.status = "error"; state = "error"; note = str(input.note, 200) || null; }
  if (STATES.includes(input.state)) {
    state = input.state;
    note = str(input.note, 200) || null;
    if (state === "done") for (const st of steps) if (!finished(st.status)) { st.status = "done"; st.at = at; }
  } else if (state === "needs_input" || (state === "error" && !input.failed)) { state = "running"; note = null; }
  if (state !== "done") activate(stages);
  return { progress: summed({ id: base.id, title: str(input.title, 80) || base.title, source: "tool", state, note, stages, updatedAt: at }) };
}

/** The bar a checklist makes (TodoWrite, Codex update_plan), unless the agent keeps its own bar. */
export function fromChecklist(prev: Progress | null, entries: { content: string; status: string }[]): Progress | null {
  if (prev?.source === "tool" && prev.state !== "done") return prev;
  if (!entries.length) return prev;
  const at = iso();
  const was = new Map((prev?.stages ?? []).flatMap((s) => s.steps).map((st) => [st.title.toLowerCase(), st]));
  const steps: Step[] = entries.map((e) => {
    const title = str(e.content, 120) || "Step";
    const status = asStatus(e.status);
    const old = was.get(title.toLowerCase());
    return finished(status) ? { title, status, at: old && finished(old.status) ? old.at : at } : { title, status };
  });
  return summed({ id: "todo", title: "Plan", source: "todo", state: "running", note: null, stages: activate([{ name: "Tasks", steps }]), updatedAt: at });
}

/** The bar's state changed by the job (a question is waiting, the turn failed, the person answered). */
export function withState(p: Progress | null, state: ProgressState, note: string | null = null): Progress | null {
  if (!p || p.state === "done") return p;
  if (p.state === state && p.note === note) return p;
  return summed({ ...p, state, note, updatedAt: iso() });
}

/** One line for the agent: where the bar stands. */
export function line(p: Progress | null) {
  if (!p) return "no bar";
  return `${p.done}/${p.total}, ${p.state}${p.active ? `, active: ${p.active}` : ""}${p.stage ? ` (${p.stage})` : ""}`;
}

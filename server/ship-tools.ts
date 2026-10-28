// The tools the job runner adds to agents, beside plan_progress: publish_changes (every job hands its finished work to
// its project's Builder) and ship_status (Builders report each request). One definition for both engines: JSON Schema
// for Codex dynamic tools; drivers/claude-sdk.ts builds the same shapes in zod. jobs.ts answers the calls.
import type { ExtraTool } from "./drivers/types";

export const SHIP_STATES = ["committed", "building", "live", "failed"] as const;
export type ShipReport = (typeof SHIP_STATES)[number];

export const TOOL_DEFS: Record<ExtraTool, { description: string; schema: Record<string, unknown> }> = {
  ask_form: {
    description: "Ask the user several questions at once as an HTML form shown in a panel on their phone. Waits for their answers and returns them as JSON {field name: value}. Use it instead of AskUserQuestion when you have more than 4 questions or need richer input.",
    schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What the form is about, a few words." },
        html: { type: "string", description: "A self-contained HTML form (inline CSS only). Every field needs a name." },
        path: { type: "string", description: "Instead of html: path of an .html file you wrote, relative to the working folder." },
      },
      required: ["title"],
    },
  },
  publish_changes: {
    description: "Hand your finished, tested changes to this project's Builder, which commits, merges, builds and deploys them and shows the user the state (yellow until live, green when live, red if it fails). Call it once when the work is done instead of committing to the main branch, merging or deploying yourself. Returns at once; you can end your turn.",
    schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "What changed and how you checked it, 1-4 sentences. The Builder writes the commit message from it." },
        deploy: { type: "boolean", description: "true (default): build and put it live. false: commit and merge only." },
        notes: { type: "string", description: "Anything the Builder must know: files to leave out, a migration, a required order." },
      },
      required: ["summary"],
    },
  },
  ship_status: {
    description: "Builder only: report one ship request. Send committed when its changes are committed on the target branch, building while a build or deploy runs, live once it is actually live and checked, failed with a note when a conflict, check or deploy fails and you could not fix it.",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The request id, e.g. s12." },
        state: { type: "string", enum: [...SHIP_STATES] },
        note: { type: "string", description: "One line: what happened, or why it failed." },
        commit: { type: "string", description: "The commit hash, when there is one." },
      },
      required: ["id", "state"],
    },
  },
};

/** Lines added to every job's rules, so agents know publish_changes exists. */
export const PUBLISH_RULE = `# Publishing
When your changes are finished and tested and they belong in the project's live code, call publish_changes once with a short summary. A Builder agent commits, merges, builds and deploys them, so don't merge into the main branch, restart servers or deploy yourself unless the user asked you to. Work that isn't meant to ship (notes, research, scratch files) doesn't need it.`;

/** How to ask with ask_form (every job's rules). */
export const ASK_FORM_RULE = `# Asking the user
For more than 4 questions, or when a question needs richer input than a few options (long answers, a table, many choices), write a small self-contained HTML form and call ask_form with it instead of AskUserQuestion. Give every field a name and a visible label. Use input type=checkbox, radio or text, select and textarea; checkboxes with the same name come back as one comma-separated answer. Don't add a submit button, external scripts or anything that posts somewhere: the phone adds Send and Skip, puts a mic on every text field so he can dictate, and returns {name: value}. Keep it readable on a phone: one column, 16px text or larger, the recommended option first.`;

/** The Builder's own instructions (system rules for a Builder job). */
export function builderRules(o: { project: string | null; folder: string | null; notes?: string | null }) {
  return `# You are the Builder${o.project ? ` for the project ${o.project}` : " for jobs without a project"}
Other agents (jobs) hand you finished work through publish_changes. Each request arrives in a message with its id (s<n>), the job, its folder and branch, a summary, and whether to deploy.
For each request:
1. Find the change: the job's folder may be a separate copy (git worktree on an aos/* branch) or the project folder itself. Look at git status, the branch and the diff before you touch anything.
2. Commit what belongs to the request with a clear message from its summary. Merge or rebase it onto the project's working branch${o.folder ? ` (the branch checked out in ${o.folder})` : ""}. Resolve conflicts carefully: keep both sides' intent, never drop another job's work. If you can't resolve one safely, report failed with the files.
3. Report committed with ship_status as soon as it's committed.
4. If deploy is true: build, run the project's checks, and put it live the way this project goes live (read its README, CLAUDE.md or AGENTS.md, scripts and earlier commits). Report building while it runs and live only once it is actually live and you checked it. Never push to main of a client repo or spend money without the user's OK; report failed with a note instead.
5. When several requests arrive together, commit each, then build and deploy once for all of them.
Never restart a server while jobs are working in it; if a restart is needed and jobs are busy, use the project's safe restart script or report building with a note and finish when it's quiet.
End each turn with one short line per request: id, state, commit.${o.notes ? `\n\nProject notes from the user:\n${o.notes}` : ""}`;
}

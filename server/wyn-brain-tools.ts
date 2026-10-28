// Wyn's brain tools, kept apart from the planner tools in wyn-tools.ts (which appends these to TOOLS):
// - ideas: draft ideas into Agentic OS while they brainstorm, the same store the `agentos idea` command uses;
// - past calls: list them and read one (summary, action points, transcript), all in India time.
// Every time she sees is India time; stored times are UTC.
import { ApiError } from "./store";
import { ist } from "./wyn-memory";
import { tracked, type Ctx, type Tool } from "./wyn-tools";
import { callReason } from "./wyn-voice";

const bad = (m: string) => new ApiError(400, m);
const json = (s: unknown) => { try { return JSON.parse(String(s ?? "")); } catch { return null; } };

/** A project slug from what she said: the slug, the name, or the start of either. null for "none"/empty. */
function projectOf(c: Ctx, raw: unknown): string | null {
  const want = String(raw ?? "").trim().toLowerCase();
  if (!want || want === "none" || want === "inbox") return null;
  const all = c.s.projects() as any[];
  const hit = all.find((p) => p.slug === want || p.name.toLowerCase() === want)
    ?? all.find((p) => p.slug.startsWith(want) || p.name.toLowerCase().startsWith(want))
    ?? all.find((p) => want.includes(p.slug) || want.includes(p.name.toLowerCase()));
  if (!hit) throw bad(`No project "${raw}". Projects: ${all.filter((p) => p.status !== "archived").map((p) => p.slug).join(", ") || "none yet"}.`);
  return hit.slug;
}
const shortIdea = (i: any) => ({ id: i.id, title: i.title, project: i.project ?? "inbox", status: i.status,
  body: i.body ? String(i.body).slice(0, 600) : undefined, at: ist(i.createdAt) });
const ideaId = (id: unknown) => `i${String(id ?? "").replace(/^i/i, "")}`;
const mins = (sec: unknown) => (Number(sec) > 0 ? Math.max(1, Math.round(Number(sec) / 60)) : null);
const rang = (dir: unknown) => (dir === "incoming" ? "Wyn rang them" : "they rang Wyn");

export const BRAIN_TOOLS: Tool[] = [
  {
    name: "add_idea",
    description: "Draft an idea into Agentic OS (the Ideas list, same as `agentos idea`). Use it while you brainstorm together: one idea per call, a short title in their words, the detail in body. project is a project slug or name (from list_ideas); leave it out for the inbox.",
    parameters: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, project: { type: "string" } }, required: ["title"] },
    write: true,
    run: (a, c) => {
      const project = projectOf(c, a.project);
      const title = String(a.title ?? "").trim();
      if (!title) throw bad("Give the idea a title.");
      const idea = tracked(c, `Idea “${title.slice(0, 60)}”`, "ideas", () => "", () => c.s.createIdea({ title, body: a.body ?? null, project, source: "wyn" }));
      return { saved: shortIdea(idea) };
    },
  },
  {
    name: "update_idea",
    description: "Change an idea you or they drafted (id like i12): new title, a project, status (open or archived), body to replace the detail, or append to add a line to it as the brainstorm moves on.",
    parameters: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, body: { type: "string" }, append: { type: "string" },
      project: { type: "string" }, status: { type: "string", enum: ["open", "archived"] } }, required: ["id"] },
    write: true,
    run: (a, c) => {
      const id = ideaId(a.id);
      const cur = c.s.idea(id) as any;
      const b: any = {};
      if (a.title) b.title = String(a.title);
      if ("body" in a) b.body = a.body;
      if (a.append) b.body = `${b.body ?? cur.body ?? ""}${(b.body ?? cur.body) ? "\n" : ""}${String(a.append).trim()}`;
      if ("project" in a) b.project = projectOf(c, a.project);
      if (a.status) b.status = a.status;
      const idea = tracked(c, `Idea changed: “${(b.title ?? cur.title).slice(0, 60)}”`, "ideas", () => id.slice(1), () => c.s.patchIdea(id, b));
      return { saved: shortIdea(idea) };
    },
  },
  {
    name: "list_ideas",
    description: "Ideas in Agentic OS, newest first, and the projects they can go under. project: a slug, or none for the inbox; status: open (default), tasked, jobbed, archived or all; query filters by words.",
    parameters: { type: "object", properties: { project: { type: "string" }, status: { type: "string" }, query: { type: "string" } } },
    run: (a, c) => {
      const project = a.project ? (String(a.project).toLowerCase() === "none" ? "none" : projectOf(c, a.project)) : null;
      const q = String(a.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const ideas = (c.s.ideas({ project, status: a.status || "open" }) as any[])
        .filter((i) => q.every((w) => `${i.title} ${i.body ?? ""}`.toLowerCase().includes(w))).slice(0, 40).map(shortIdea);
      return { ideas, projects: (c.s.projects() as any[]).filter((p) => p.status !== "archived").map((p) => ({ slug: p.slug, name: p.name })) };
    },
  },
  {
    name: "list_calls",
    description: "Your phone calls with them, newest first: id, when (India time), who rang, minutes, why, summary and action points. days looks back (default 7); query filters by words. Use it before you say a call did or didn't happen.",
    parameters: { type: "object", properties: { days: { type: "integer" }, query: { type: "string" } } },
    run: (a, { n }) => {
      const since = new Date(Date.now() - Math.min(90, Math.max(1, Number(a.days) || 7)) * 864e5).toISOString();
      const q = String(a.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const rows = n.query("SELECT id, direction, reason, status, started_at, seconds, summary, actions, transcript FROM calls WHERE started_at >= ? ORDER BY started_at DESC LIMIT 60").all(since) as any[];
      const calls = rows.filter((r) => q.every((w) => `${r.reason ?? ""} ${r.summary ?? ""} ${r.actions ?? ""} ${r.transcript ?? ""}`.toLowerCase().includes(w)))
        .slice(0, 25).map((r) => ({ id: r.id, at: ist(r.started_at), rang: rang(r.direction), minutes: mins(r.seconds), why: callReason(r.reason, r.direction) || undefined,
          status: r.status === "live" && !r.seconds ? "no record of how it ended" : r.status, summary: r.summary ?? undefined, actions: json(r.actions) ?? undefined }));
      return { timezone: "India time", calls };
    },
  },
  {
    name: "read_call",
    description: "One call in full (id from list_calls or recall): when, why, summary, action points and the transcript line by line, India time.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: (a, { n }) => {
      const r = n.query("SELECT * FROM calls WHERE id = ? OR id LIKE ? ORDER BY started_at DESC LIMIT 1").get(String(a.id ?? ""), `${String(a.id ?? "")}%`) as any;
      if (!r) throw bad(`No call ${a.id}. Use list_calls.`);
      const lines = (json(r.transcript) ?? []).map((t: any) => `${ist(t.at).slice(11)} ${t.who === "you" ? "them" : "Wyn"}: ${t.text}`);
      let transcript = lines.join("\n");
      if (transcript.length > 14000) transcript = `[start cut]\n${transcript.slice(-14000)}`;
      return { id: r.id, at: ist(r.started_at), rang: rang(r.direction), minutes: mins(r.seconds), why: callReason(r.reason, r.direction) || undefined, summary: r.summary ?? undefined,
        actions: json(r.actions) ?? [], transcript: transcript || "(no transcript)",
        note: "The transcript is speech-to-text: their lines can be misheard, especially Hinglish. Don't treat a garbled line as what they meant." };
    },
  },
];

// "Roast me": Wyn shows she already knows him. The onboard_me tool reads his brain vault, Agentic OS (tasks, goals,
// projects, ideas, life wheel), her memories, his journal and their recent calls, and hands her brain the facts plus
// the shape of the reply: three short, specific, kind roast messages, then two or three questions about the gaps.
// His answers in the next few messages are saved as memories (onboardNote adds that to her context).
// It runs once on its own, as her own turn right after the first chat once this ships, and again whenever he asks.
import type { Ctx, Tool } from "./wyn-tools";

const iso = () => new Date().toISOString();
type Db = Ctx["n"];
const pref = (n: Db, k: string) => ((n.query("SELECT value FROM prefs WHERE key = ?").get(k) as any)?.value ?? "") as string;
const setPref = (n: Db, k: string, v: string) => n.query("INSERT INTO prefs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(k, v);

export const OB = { done: "onboard.done", turn: "onboard.turn", open: "onboard.open", started: "onboard.started", via: "onboard.via" };
/** How many of his next messages may carry answers to her questions. */
const ANSWER_TURNS = 3;

/** The reply's shape. Kept here so the tool and the tests agree. */
export const ROAST_RULES = [
  "Now write exactly four messages, separated by blank lines.",
  "Messages 1 to 3: three short roast lines (one or two sentences each) that show you know him. Each one rests on one specific fact from this dossier: a task that has sat for weeks, a goal behind pace, a late night, a pile of ideas with no task, something from a call or the journal. Name the real thing.",
  "Lightly teasing, specific and kind, like a close friend; end the third on something you're proud of him for. Never about money worries, family, health or anything he sounds low about.",
  "Message 4: two or three short questions about what the dossier doesn't tell you (a gap that would help you help him), in one message.",
  "Hinglish with tum, Roman script, plain text: no lists, no em dashes, no headings. Only facts this tool returned; if a section is empty, don't invent one.",
  "When he answers, save each answer with remember term long (the right kind, importance 3 or 4).",
].join("\n");

const cut = (v: unknown, max = 2500) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s && s.length > max ? `${s.slice(0, max)}…[cut]` : s; };
const daysAgo = (at: unknown) => { const t = Date.parse(String(at ?? "")); return Number.isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : null; };

/** Facts the roast can stand on, worked out here so she doesn't have to count. */
export function signals(tasks: any[], ideas: any[], today: string, oldest: { title: string; created_at: string }[] = []) {
  const open = tasks.filter((t) => ["todo", "doing", "inbox"].includes(t.status));
  const overdue = open.filter((t) => t.due && t.due < today).sort((a, b) => String(a.due).localeCompare(String(b.due)));
  const stale = oldest.map((t) => ({ title: t.title, openForDays: daysAgo(t.created_at) })).filter((t) => t.openForDays !== null && t.openForDays >= 3).slice(0, 5);
  const doneWeek = tasks.filter((t) => t.status === "done" && (daysAgo(t.completedAt ?? t.doneAt ?? t.updatedAt) ?? 99) <= 7);
  const openIdeas = ideas.filter((i) => i.status === "open");
  return { openTasks: open.length, overdue: overdue.slice(0, 5).map((t) => ({ title: t.title, due: t.due })), overdueCount: overdue.length,
    sittingLongest: stale, doneLast7Days: doneWeek.slice(0, 8).map((t) => t.title), doneLast7DaysCount: doneWeek.length,
    openIdeas: openIdeas.length, ideasTurnedIntoTasks: ideas.filter((i) => i.status === "tasked" || i.status === "jobbed").length };
}

/** Context for her next turns: answers to save. Called on every message from him. */
export function onboardNote(n: Db): string {
  const left = Number(pref(n, OB.open) || 0);
  if (left <= 0) return "";
  setPref(n, OB.open, String(left - 1));
  return "\n[In onboarding you asked him a few getting-to-know-you questions (see Recent chat). If this message answers any of them, save each answer with remember term long, then thank him in a line and move on.]";
}
/** True once, on the first chat after this ships: then her own onboarding turn follows the reply. */
export function onboardDue(n: Db) {
  if (pref(n, OB.done) || pref(n, OB.started)) return false;
  setPref(n, OB.started, iso());
  return true;
}
/** Her onboarding turn may use four messages (three roasts and the questions); every other turn three. */
export const replyParts = (n: Db, turn: string) => (pref(n, OB.turn) === turn ? 4 : 3);
export const ONBOARD_PROMPT = "[Nobody wrote to you: you're starting this yourself. Today you got a new move: you can show him how well you know him. " +
  "Call onboard_me now and follow exactly what it returns. Open lightly, as if it just occurred to you, with no preamble about tools or onboarding.]";

export const ONBOARD_TOOLS: Tool[] = [
  {
    name: "onboard_me",
    description: "The roast-me onboarding: reads everything you can about the user (brain vault, tasks, goals, projects, ideas, life wheel, memories, journal, recent calls) " +
      "and returns it with how to reply: three short, specific, kind roast messages, then two or three questions about what's missing. " +
      "Use it when they say \"roast me\", ask what you know about them, ask you to get to know them, or when you're told to run it.",
    parameters: { type: "object", properties: {} },
    run: async (_a, c) => {
      if (c.user.role !== "owner") throw new Error("That's for the owner only.");
      // Lazy, to avoid an import cycle: wyn-tools.ts appends these tools to TOOLS.
      const { runTool } = await import("./wyn-tools");
      const t = (name: string, args: any = {}) => runTool(name, args, c).then((r: any) => (r?.error ? { unavailable: r.error } : r));
      const [overview, goals, tasks, ideas, life, memories, journal, calls, brainWho, brainLately] = await Promise.all([
        t("overview"), t("goals"), t("find_tasks", { status: "all" }), t("list_ideas", { status: "all" }), t("life"), t("memories"),
        t("read_journal", { days: 30 }), t("list_calls", { days: 30 }),
        t("brain_ask", { question: "Who is the owner: what are they building and working on right now, and what have they decided lately?" }),
        t("brain_ask", { question: "What habits, struggles, patterns or mistakes has the owner noted about themselves recently?" }),
      ]);
      let facts: any = {};
      try {
        const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10); // India date
        const oldest = c.s.db.query("SELECT title, created_at FROM tasks WHERE status IN ('inbox','todo','doing') ORDER BY created_at LIMIT 5").all() as any[];
        facts = signals(c.s.tasks() as any[], (c.s.ideas({ status: "all" }) as any[]) ?? [], String(today), oldest);
      } catch (e) { facts = { unavailable: e instanceof Error ? e.message : String(e) }; }
      let projects: any = [];
      try { projects = (c.s.projects() as any[]).filter((p) => p.status !== "archived").map((p) => ({ name: p.name, status: p.status })); } catch {}
      setPref(c.n, OB.turn, c.turn);
      setPref(c.n, OB.done, iso());
      setPref(c.n, OB.open, String(ANSWER_TURNS));
      return {
        dossier: { facts, today: cut(overview, 2000), goals: cut(goals), openTasks: cut((tasks as any[])?.filter?.((x) => x.status !== "done") ?? tasks, 2000),
          projects: cut(projects, 800), ideas: cut((ideas as any)?.ideas?.slice?.(0, 15) ?? ideas, 1500), lifeWheel: cut(life, 800), memories: cut(memories, 3000),
          journal: cut(journal, 2000), calls: cut((calls as any)?.calls?.slice?.(0, 6) ?? calls, 2500),
          brain: { whoHeIs: cut((brainWho as any)?.answer ?? brainWho, 2500), lately: cut((brainLately as any)?.answer ?? brainLately, 2500) } },
        how: ROAST_RULES,
      };
    },
  },
];

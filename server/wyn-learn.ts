// How Wyn learns and follows through, kept out of wyn.ts so the prompts and rules can be read and tested alone:
// - the nightly tidy: a day's chat, calls (summaries, action points and transcripts), journal and answered agent
//   questions become an episode plus durable preferences, facts, people, decisions and promises;
// - the weekly self-review: her own calls and chat for the week, checked for wrong claims, mishearing and missed
//   follow-ups, with lessons saved as long-term memories she sees every turn;
// - follow-ups: agent questions he never answered and open call action points, for the background check to chase.
// wyn.ts runs the brain; these build the prompts and apply what comes back.
import type { WynDb } from "./wyn-tools";
import { applyConsolidation, ist, memoryList, remember } from "./wyn-memory";

const iso = () => new Date().toISOString();
const json = (s: unknown) => { try { return JSON.parse(String(s ?? "")); } catch { return null; } };
/** The JSON object in a model reply, with or without a code fence or words around it. */
export function parsePlan(text: string) {
  const t = String(text ?? "").replace(/^```(?:json)?|```$/gm, "").trim();
  const direct = json(t);
  if (direct && typeof direct === "object") return direct;
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  return a >= 0 && b > a ? json(t.slice(a, b + 1)) : null;
}
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)} [cut]` : s);

/** One call as text: when, why, summary, action points, then the transcript (India time). */
function callText(c: any, first: string, name: string, budget: number) {
  const lines = (json(c.transcript) ?? []).map((t: any) => `  ${ist(t.at).slice(11)} ${t.who === "you" ? first : name}: ${t.text}`).join("\n");
  const actions = (json(c.actions) ?? []) as string[];
  return [`- Call ${c.id} at ${ist(c.started_at)}, ${c.direction === "incoming" ? `${name} rang ${first}` : `${first} rang ${name}`}, ${Math.max(1, Math.round((c.seconds ?? 0) / 60))} min${c.reason ? `, why: ${c.reason}` : ""}`,
    c.summary ? `  Summary: ${c.summary}` : "", actions.length ? `  Action points: ${actions.join(" | ")}` : "",
    lines ? `  Transcript:\n${lines.length > budget ? `  [start cut]\n${lines.slice(-budget)}` : lines}` : "  (no transcript)"].filter(Boolean).join("\n");
}

/** Everything that happened between two instants: chat, calls, agent answers. */
function material(n: WynDb, fromIso: string, toIso: string, first: string, name: string, callBudget = 24000) {
  const chat = (n.query("SELECT role, text, at FROM messages WHERE role IN ('user','wyn','call') AND at >= ? AND at < ? ORDER BY id").all(fromIso, toIso) as any[])
    .map((m) => `${ist(m.at)} ${m.role === "user" ? first : m.role === "call" ? `(call note)` : name}: ${String(m.text).slice(0, 600)}`).join("\n");
  const calls = n.query("SELECT * FROM calls WHERE started_at >= ? AND started_at < ? ORDER BY started_at").all(fromIso, toIso) as any[];
  const per = Math.max(2000, Math.floor(callBudget / Math.max(1, calls.length)));
  const callsText = calls.filter((c) => c.transcript || c.summary).map((c) => callText(c, first, name, per)).join("\n");
  const asks = (n.query("SELECT source, question, answer, status FROM agent_requests WHERE (answered_at >= ? AND answered_at < ?) OR (created_at >= ? AND created_at < ?)")
    .all(fromIso, toIso, fromIso, toIso) as any[]).map((a) => `- ${a.source} asked: ${a.question} -> ${a.status}${a.answer ? `: ${String(a.answer).slice(0, 300)}` : ""}`).join("\n");
  return { chat: clip(chat, 30000), calls: callsText, asks };
}

// ── the nightly tidy ──
/** The day runs 04:00 to 04:00 India time. Returns null when nothing happened. */
export function tidyPrompt(n: WynDb, date: string, first: string, name = "Wyn") {
  const fromIso = new Date(`${date}T04:00:00+05:30`).toISOString(), toIso = new Date(Date.parse(fromIso) + 864e5).toISOString();
  const m = material(n, fromIso, toIso, first, name);
  const journal = (n.query("SELECT text, mood FROM journal WHERE date = ?").all(date) as any[]).map((j) => `- ${j.mood ? `(${j.mood}) ` : ""}${String(j.text).slice(0, 1500)}`).join("\n");
  if (!m.chat && !m.calls && !journal) return null;
  const all = memoryList(n);
  const longText = all.long.map((x: any) => `- ${x.id} [${x.kind}, ${x.importance}] ${x.text}`).join("\n") || "- none";
  const shortText = all.short.map((x: any) => `- ${x.id} [${x.kind}, until ${ist(x.expires_at).slice(0, 10)}] ${x.text}`).join("\n") || "- none";
  return `[Nightly memory tidy for ${date}. Don't call any tools; reply with JSON only.]
All times are India time. Call transcripts are speech-to-text: Hinglish often comes through garbled, so a line that makes no sense is a mishearing, not a fact.
Chat that day:
${m.chat || "(none)"}
Calls that day:
${m.calls || "(none)"}
Journal:
${journal || "(none)"}
Agent questions that day:
${m.asks || "(none)"}

Long-term memory now:
${longText}
Short-term now:
${shortText}

Do four things.
1. episode: 3-6 sentences on the day: what happened, what moved, how ${first} seemed.
2. Learn. Pull out everything durable that ${first} said or clearly showed and that long-term memory doesn't already hold:
   preferences (how they like things done, how they want you to talk or act, what annoys them), facts about their life, work, projects,
   health and routine, people (who they are to them and what to remember), and decisions they made. Each is one self-contained sentence
   that still makes sense in a month, with a kind (preference, fact, person, project, goal, habit, decision, health) and an importance
   (5 shapes everything, 3 useful, 1 trivia). Anything they asked you to remember is at least 4. A correction they gave you is a preference.
3. Promises: anything ${first} said they'd do, or you said you'd do, that isn't done. Add each as short_add, kind followup, saying who
   promised what and by when, with days until it's due plus one (at most 14).
4. Keep memory clean: merge duplicates and outdated ones (update with the better text, archive the redundant), turn short-term notes that
   proved durable into long-term, close short-term notes that are done or past.
Only what the record shows. Never invent, never guess what a garbled line meant, never drop something they asked you to remember.
Reply with JSON only, no code fence: {"episode": "...", "add": [{"text": "...", "kind": "...", "importance": 3}], "update": [{"id": "L12", "text": "...", "importance": 4}],
"archive": ["L7"], "short_add": [{"text": "...", "kind": "followup", "days": 3}], "short_close": ["S3"]}`;
}
export const applyTidy = (n: WynDb, date: string, plan: any) => applyConsolidation(n, date, plan);

// ── the weekly self-review ──
export function reviewPrompt(n: WynDb, endDate: string, first: string, name = "Wyn") {
  const toIso = new Date(Date.parse(`${endDate}T04:00:00+05:30`) + 864e5).toISOString(), fromIso = new Date(Date.parse(toIso) - 7 * 864e5).toISOString();
  const m = material(n, fromIso, toIso, first, name, 40000);
  if (!m.chat && !m.calls) return null;
  const lessons = (n.query("SELECT id, text FROM memories WHERE status = 'active' AND kind = 'lesson'").all() as any[]).map((l) => `- L${l.id} ${l.text}`).join("\n");
  return `[Weekly self-review, the 7 days up to ${endDate}. Don't call any tools; reply with JSON only.]
You are ${name}, ${first}'s personal assistant, checking your own work this week the way a good assistant would after a week on the job.
All times are India time. Call transcripts are speech-to-text, so ${first}'s lines may be garbled.
Calls:
${m.calls || "(none)"}
Chat (call notes are your own write-ups):
${m.chat || "(none)"}
Agent questions:
${m.asks || "(none)"}
Lessons you already have:
${lessons || "- none"}

Look hard for:
- wrong claims: anything you said that the record shows was false or never established (a plan they didn't say, a call you denied, a wrong time, a task or project that didn't exist, a fact you made up);
- mishearing: places where speech-to-text garbled them and you answered the garble instead of asking;
- missed follow-ups: promises, action points and agent questions nobody came back to;
- how they reacted: what annoyed them, what helped.
Then write lessons: rules for yourself, one line each, concrete and actionable ("On calls, when a line sounds garbled, ask them to say it again instead of guessing."),
only from evidence above, at most 5, none that repeat a lesson you already have. And follow-ups for anything still open.
Reply with JSON only, no code fence: {"review": "3-5 sentences on how the week went for you as their assistant", "wrong_claims": ["..."], "mishearing": ["..."],
"missed_followups": ["..."], "lessons": [{"text": "...", "importance": 4}], "followups": [{"text": "...", "days": 3}]}`;
}
export function applyReview(n: WynDb, endDate: string, plan: any) {
  const done = { lessons: 0, followups: 0 };
  for (const l of Array.isArray(plan?.lessons) ? plan.lessons.slice(0, 5) : []) {
    const text = typeof l === "string" ? l : l?.text;
    if (text && !("error" in remember(n, { text, term: "long", kind: "lesson", importance: Math.max(4, Number(l?.importance) || 4) }, "review"))) done.lessons++;
  }
  for (const f of Array.isArray(plan?.followups) ? plan.followups.slice(0, 6) : []) {
    const text = typeof f === "string" ? f : f?.text;
    if (text && !("error" in remember(n, { text, term: "short", kind: "followup", days: Number(f?.days) || 3 }, "review"))) done.followups++;
  }
  const keep = { date: endDate, at: iso(), review: String(plan?.review ?? "").slice(0, 1500),
    wrong_claims: plan?.wrong_claims ?? [], mishearing: plan?.mishearing ?? [], missed_followups: plan?.missed_followups ?? [] };
  n.query("INSERT INTO prefs (key, value) VALUES ('review.last', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(keep));
  return done;
}

// ── follow-ups: what's still waiting on them, for the background check to chase ──
type Chase = { n: number; last: string; done?: boolean; at: string };
const loadChases = (n: WynDb): Record<string, Chase> => json((n.query("SELECT value FROM prefs WHERE key = 'followups'").get() as any)?.value) ?? {};
const saveChases = (n: WynDb, st: Record<string, Chase>) =>
  n.query("INSERT INTO prefs (key, value) VALUES ('followups', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(st));
export type Followup = { key: string; kind: string; text: string; since: string; chased: number; from?: string };
/** Agent questions he never answered (asked or missed, under a week old, 3 h after Wyn passed them on) and action
 * points from calls in the last 3 days (4 h after the call). Each is chased at most twice, 20 h apart. */
export function pendingFollowups(n: WynDb, now = Date.now()): Followup[] {
  const st = loadChases(n), out: Followup[] = [];
  const ok = (key: string, since: string, wait: number) => {
    const s = st[key];
    if (s?.done || (s?.n ?? 0) >= 2) return false;
    if (now - Date.parse(since) < wait) return false;
    return !(s && now - Date.parse(s.last) < 20 * 3600_000);
  };
  for (const r of n.query("SELECT id, source, question, created_at, decided_at FROM agent_requests WHERE status IN ('asked', 'missed') AND created_at >= ? ORDER BY created_at")
    .all(new Date(now - 7 * 864e5).toISOString()) as any[]) {
    const key = `ask:${r.id}`;
    if (ok(key, r.decided_at ?? r.created_at, 3 * 3600_000)) out.push({ key, kind: "agent question", from: r.source, text: r.question, since: ist(r.created_at), chased: st[key]?.n ?? 0 });
  }
  for (const c of n.query("SELECT id, started_at, ended_at, actions FROM calls WHERE started_at >= ? AND actions IS NOT NULL AND actions != '[]' ORDER BY started_at")
    .all(new Date(now - 3 * 864e5).toISOString()) as any[]) {
    ((json(c.actions) ?? []) as string[]).forEach((a, i) => {
      const key = `act:${c.id}:${i}`;
      if (ok(key, c.ended_at ?? c.started_at, 4 * 3600_000)) out.push({ key, kind: "call action point", text: String(a), since: ist(c.started_at), chased: st[key]?.n ?? 0 });
    });
  }
  return out.slice(0, 12);
}
export const followupsText = (f: Followup[]) => f.map((x) => `- [${x.key}] ${x.kind}${x.from ? ` from ${x.from}` : ""}, since ${x.since}, chased ${x.chased}x: ${x.text}`).join("\n");
/** chased: keys she brought up just now; done: keys that are handled or were never real to-dos. Old entries are dropped. */
export function markFollowups(n: WynDb, chased: unknown, done: unknown) {
  const st = loadChases(n), now = iso();
  for (const k of Array.isArray(chased) ? chased.map(String).slice(0, 12) : []) st[k] = { ...(st[k] ?? { n: 0, at: now }), n: (st[k]?.n ?? 0) + 1, last: now };
  for (const k of Array.isArray(done) ? done.map(String).slice(0, 30) : []) st[k] = { ...(st[k] ?? { n: 0, last: now, at: now }), done: true };
  for (const [k, v] of Object.entries(st)) if (Date.now() - Date.parse(v.at) > 10 * 864e5) delete st[k];
  saveChases(n, st);
}

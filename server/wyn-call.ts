// Wyn's voice calls: what the realtime session gets (tools, voice, hearing, turn-taking) and how tool calls run
// during a call. Fast tools answer inline; slow ones (ask_wyn, a Codex or Claude session, anything past ~2 s) run
// in the background while she keeps talking, and their result is spoken when it lands, or posted to chat if the
// call is over. Scheduled calls that ring out are logged, retried once, then turned into a chat message.
// wyn.ts owns the call lifecycle; this file holds the logic so wyn.ts only wires it in.
import { prefsOf, runTool, TOOLS, type WynDb } from "./wyn-tools";

const iso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── session settings (keys from the shared settings; sensible fallbacks) ──
export const DEFAULT_CALL_MODEL = process.env.WYN_VOICE_MODEL || "gpt-realtime-2.1-mini";
export const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-transcribe";
/** Voices the realtime API takes (developers.openai.com, realtime `audio.output.voice`). marin and cedar are the
 * newest and most natural; marin is a natural American female voice, the default. */
export const REALTIME_VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"];
export function callSettings(n: WynDb) {
  const p = prefsOf(n) as Record<string, string | undefined>;
  const voice = String(p.call_voice ?? "").trim().toLowerCase();
  return {
    model: String(p.call_model ?? "").trim() || DEFAULT_CALL_MODEL,
    voice: REALTIME_VOICES.includes(voice) ? voice : "marin",
    transcribe: String(p.call_transcribe_model ?? "").trim() || DEFAULT_TRANSCRIBE_MODEL,
  };
}
// Same idea as voice.ts: tell the transcriber who is talking so Hinglish isn't heard as Urdu, Korean or Hungarian.
// Names the caller uses, so the transcriber spells them right: WYN_CALL_NAMES in the environment (comma-separated,
// e.g. "Corner Market, Northwind Studio, Dad"). The product names are always on the list.
const CALL_NAMES = ["Wyn", "Codex", "Claude", "Agentic OS (agentic-os)", ...(process.env.WYN_CALL_NAMES ?? "").split(",").map((x) => x.trim()).filter(Boolean)];
const HEARING = "A phone call with someone who mixes Hindi and English (Hinglish). Transcribe exactly as spoken. " +
  "Write Hindi words in Latin script (Roman Hindi, like 'haan yaar, kal karte hai'), never Devanagari or Urdu script. Keep English words in English. " +
  `Names they use: ${CALL_NAMES.join(", ")}.`;
const TURN_TEST = process.env.WYN_CALL_TURN ? JSON.parse(process.env.WYN_CALL_TURN) : null; // call QA sweeps only
/** The `audio` block of a realtime session. native: the iPhone relay sends raw 24 kHz PCM. */
export function callAudio(n: WynDb, native: boolean) {
  const cs = callSettings(n);
  const pcm = native ? { format: { type: "audio/pcm", rate: 24000 } } : {};
  return {
    input: { ...pcm, transcription: { model: cs.transcribe, prompt: HEARING }, noise_reduction: { type: "near_field" },
      // Semantic VAD, high eagerness. The classifier is often unsure where a Hinglish turn ends and waits out its cap:
      // "low" (8 s) left her silent 9.8 s after "theek hai, thank you, bye", "medium" (4 s) 4.7-5.6 s; "high" (2 s)
      // answers in 1.3-3 s and still held through a 1.1 s pause mid-sentence (call QA, 2026-10-21). Server VAD
      // (900 ms) was as quick, but it starts a turn on loudness alone, so street noise is likelier to cut her off.
      // interrupt_response stops her when he talks.
      turn_detection: TURN_TEST ?? { type: "semantic_vad", eagerness: "high", create_response: true, interrupt_response: true } },
    output: { ...pcm, voice: cs.voice },
  };
}
/** Call-only rules. They go last in her instructions, after the context, so they win over the chat rules above. */
export function callRules(first: string) {
  return `# This is a live phone call. These rules win over anything above.

Hearing ${first}
- You hear ${first} through a phone mic. He speaks Hinglish, and speech in a call is easy to mishear. Act only on what you clearly heard.
- A word or two that doesn't fit the conversation, sounds like another language, or makes no sense is noise or a mishearing. Don't answer it as if it meant something and don't build on it: say "Sorry, phir se bolna?" once, in a few words.
- If what you hear is your own last words coming back, it's echo: ignore it.
- Never fill in what he "probably" meant, never put words in his mouth. If a request is unclear, ask one short question.

Talking
- One or two short sentences a turn, then stop and let him talk. Go longer only when he asks.
- Answer in the language he used: when he speaks Hindi or Hinglish, reply in natural Hinglish (Roman Hindi with English words); when he speaks English, English. Always "tum", never "aap". You're a woman, so in Hindi: "kar rahi hoon", "bataungi", "dekh leti hoon", never "kar raha hoon", "bataunga", "karta hoon".
- Ids like t43, i37 or job_... are for your tools only: never say them. Never read out JSON, field names or lists. Say times the way people do ("kal shaam 6 baje", not "18:00").
- When you called him, your first turn is one sentence: hi and why you called. Then stop and listen.
- Greet once per call. After the first hello, never greet again. When he says bye, say a short bye and stop.

Doing
- You have all your tools. When he asks for a task, an idea, a reminder, a journal entry or a lookup, call the tool right away; don't ask "should I?".
- Use his words. A task or idea title is what he said, cleaned up. Add nothing he didn't say: no durations, sub-labels, notes, areas or times he didn't give. Leave optional fields out.
- When he tells you to have Codex or Claude do something ("Codex ko bolo..."), that is his yes: call session_new right away (tool codex or claude, folder the project he named, prompt in clear English with what he asked).
- "Aaj ka plan kya hai?" and the like: call overview, then name the next two or three real items from it, each with its time ("10:30 pe Physics class, phir 1:30 se Stats"). Never a vague summary like "kuch review aur projects".
- After a tool, confirm in one line what that tool just did, from its result and asked fields, in his terms ("Kal shaam 6 baje Dad ko call ka reminder laga diya"). Never describe something else from the chat or context as done.
- Never state a plan, task, time, date, number or result unless a tool returned it or he said it. If you don't know, check with a tool.
- Quick tools (tasks, ideas, reminders, overview, memory) answer at once: call the tool first and speak once, with the result. No "ek minute" before them.
- Slow ones (ask_wyn, Codex or Claude sessions, brain lookups) run in the background: when a tool says it started, say a few words like "haan, kar rahi hoon" and carry on. When a system note starting [Result] arrives, tell him what came back in a sentence or two.
- For deep thinking or multi-step planning, use ask_wyn.
- When new information changes existing plans or commitments, check what it affects beyond a note. Use ask_wyn for cross-app follow-through; it consults Jev and your chat context. A hint never supplies approval. Keep listening when he wants to vent.
- If he wants to journal, listen, reflect back briefly, and save it with journal in his words.`;
}

// ── tools: Wyn's whole registry, read at call time so tools added later show up, plus call-only ones ──
type Ctx = { s: any; n: WynDb; turn: string; user: { id: number; role: string } };
type CallTool = { name: string; description: string; parameters: any; run: (a: any, c: Ctx) => any };
const CALL_TOOLS: CallTool[] = [
  {
    name: "add_idea",
    description: "Capture an idea into Agentic OS Ideas, for example while brainstorming on a call. title: one line; body: the details worked out so far; project: a project slug, only if they named one.",
    parameters: { type: "object", properties: { title: { type: "string" }, body: { type: "string" }, project: { type: "string" } }, required: ["title"] },
    run: (a, { s }) => {
      const b = { title: a.title, body: a.body ?? null, project: a.project || null, source: "voice" };
      // A misheard project name shouldn't lose the idea: save it unfiled and say so.
      try { const i = s.createIdea(b); return { saved: i?.id ?? true, title: i?.title ?? a.title }; }
      catch (e) {
        if (!b.project || !/No project/.test(String((e as Error)?.message))) throw e;
        const i = s.createIdea({ ...b, project: null });
        return { saved: i?.id ?? true, title: i?.title ?? a.title, note: `No project "${a.project}", so it's saved without one.` };
      }
    },
  },
];
const ASK_WYN = { type: "function", name: "ask_wyn",
  description: "Think something through with your full brain on the PC: planning, breaking down a goal, reviewing the week, anything multi-step that needs care. It runs in the background; keep talking and the answer comes back to you.",
  parameters: { type: "object", properties: { request: { type: "string" } }, required: ["request"] } };
// What the voice model gets wrong with the chat descriptions alone (call QA, 2026-10-21): it padded a "gym" task into
// "Morning Gym (Lifting & Mobility)" with 90 minutes, asked before handing Codex a job he'd just asked for, and
// guessed folder names. These lines go after the registry description, on calls only.
const VOICE_HINTS: Record<string, string> = {
  add_task: "On a call: title is his words only (\"Gym\"), no added detail. Kal = tomorrow. A time he said goes in schedule {date, time}; leave minutes, area and notes out unless he said them.",
  add_idea: "On a call: title in his words; body only the details he said, nothing invented. Leave project out unless he named one.",
  session_new: "On a call, when he says \"Codex ko bolo\" / \"Claude se karwao\", call this at once; his ask is the yes. folder: the project he named (like agentic-os). prompt: his request in clear English, with what he said about it.",
  schedule: "On a call: a reminder (\"yaad dilana\", \"reminder chahiye\") at a time is kind message, unless he asks you to call him then.",
};
/** Realtime function tools: the registry, the call-only tools it doesn't have yet, and ask_wyn. */
export function voiceTools() {
  const have = new Set(TOOLS.map((t) => t.name));
  return [...TOOLS, ...CALL_TOOLS.filter((t) => !have.has(t.name))]
    .map((t) => ({ type: "function", name: t.name, description: VOICE_HINTS[t.name] ? `${t.description} ${VOICE_HINTS[t.name]}` : t.description,
      parameters: t.parameters ?? { type: "object", properties: {} } }))
    .concat(ASK_WYN);
}
/** One tool call, registry first. Errors come back as { error } so the model can recover. */
export async function runCallTool(name: string, args: any, c: Ctx) {
  if (TOOLS.some((t) => t.name === name)) return runTool(name, args, c as any);
  const t = CALL_TOOLS.find((x) => x.name === name);
  if (!t) return { error: `No tool ${name}.` };
  try { return await t.run(args ?? {}, c); }
  catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
}

// ── one call's runtime state ──
export type CallRt = {
  active: string | null; // the response being generated
  want: boolean; // a response.create waiting for the active one to finish
  opener: "none" | "pending" | "done"; openerId: string | null;
  userTalking: boolean; watching: Set<string>;
};
export const newRt = (): CallRt => ({ active: null, want: false, opener: "none", openerId: null, userTalking: false, watching: new Set() });
type CallLike = { id: string; user: any; turn: string; ended: boolean; transcript: { who: string; text: string }[]; rt: CallRt };
type Out = (e: unknown) => void;
export type CallHooks = {
  ctx: (u: any, turn: string) => Ctx;
  /** ask_wyn: an ephemeral brain turn, outside the per-user queue so it never waits behind background work. */
  think: (u: any, request: string, heard: string, turn: string) => Promise<string>;
  /** After the call: the result goes to chat. */
  toChat: (u: any, text: string, turn: string) => void;
};
const INLINE_MS = 1800;
const DEBUG = !!process.env.WYN_CALL_DEBUG; // logs every call event except audio deltas
const SLOW = new Set(["ask_wyn"]);

export function callRuntime(h: CallHooks) {
  /** Ask for a response now, or as soon as the one in flight is done (the API takes one at a time). */
  function respond(c: CallLike, out: Out) {
    if (c.rt.active) c.rt.want = true;
    else { c.rt.active = "requested"; out({ type: "response.create" }); }
  }
  /** Her opening line when she rang: the same instructions plus what to open with. No tools in the opener: given
   * tools, the model often greets, calls overview, and greets again when the tool result comes back (the double
   * greeting seen on call_mvg1t7my; reproduced against the API on 2026-10-21, gone with tool_choice none). */
  function open(c: CallLike, out: Out, instructions: string, line: string) {
    c.rt.opener = "pending";
    c.rt.active = "requested";
    out({ type: "response.create", response: { instructions: `${instructions}\n\nThe call just connected. ${line}`, tool_choice: "none" } });
    // Never leave the phone's mic shut if the opener goes missing.
    setTimeout(() => { if (c.rt.opener === "pending") c.rt.opener = "done"; }, 10_000);
  }
  /** A result that landed after the tool call returned: spoken now, or posted to chat if the call is over. */
  function deliver(c: CallLike, out: Out, label: string, result: unknown, chatText?: string) {
    const text = typeof result === "string" ? result : JSON.stringify(result);
    if (c.ended) { h.toChat(c.user, (chatText ?? `${label}: ${text}`).slice(0, 3000), c.turn); return; }
    out({ type: "conversation.item.create", item: { type: "message", role: "system",
      content: [{ type: "input_text", text: `[Result] ${label}: ${text.slice(0, 6000)}\nTell them briefly now, in your own words.` }] } });
    // If they're mid-sentence, the reply to them will carry it; otherwise speak up.
    if (!c.rt.userTalking) respond(c, out);
  }
  /** A prompt handed to a Codex or Claude session from the call: speak its reply if it lands while the call is on.
   * After the call, the dispatcher's own chat message carries it. */
  function watchDispatch(c: CallLike, out: Out, job: string) {
    if (c.rt.watching.has(job)) return;
    c.rt.watching.add(job);
    const n = h.ctx(c.user, c.turn).n;
    (async () => {
      const end = Date.now() + 30 * 60_000;
      while (!c.ended && Date.now() < end) {
        await sleep(4000);
        const j = n.query("SELECT title, tool, status, result, error FROM dispatches WHERE id = ?").get(job) as any;
        if (!j) return;
        if (j.status === "done" && j.result) return void (c.ended || deliver(c, out, `${j.title || "The session"} (${j.tool}) replied`, String(j.result).slice(0, 3000)));
        if (j.status === "failed") return void (c.ended || deliver(c, out, `${j.title || "The session"} (${j.tool}) failed`, String(j.error ?? "").slice(0, 500)));
      }
    })().catch(() => {});
  }
  async function functionCall(c: CallLike, e: any, out: Out) {
    let args: any = {};
    try { args = JSON.parse(e.arguments || "{}"); } catch {}
    const heard = c.transcript.slice(-16).map((t) => `${t.who === "you" ? "Them" : "You"}: ${t.text}`).join("\n");
    const work: Promise<unknown> = (e.name === "ask_wyn"
      ? h.think(c.user, String(args.request ?? ""), heard, c.turn).then((answer) => ({ answer }))
      : runCallTool(e.name, args, h.ctx(c.user, c.turn)))
      .catch((err) => ({ error: e.name === "ask_wyn" ? "The PC brain didn't answer. Say you'll follow up in chat." : String(err?.message ?? err) }));
    if (DEBUG) {
      const t0 = Date.now();
      console.log(`[wyn] ${c.id} tool ${e.name} ${JSON.stringify(args).slice(0, 400)}`);
      work.then((r) => console.log(`[wyn] ${c.id} tool ${e.name} done ${Date.now() - t0}ms ${JSON.stringify(r).slice(0, 300)}`));
    }
    const quick = await Promise.race([work.then((r) => ({ r })), sleep(SLOW.has(e.name) ? 0 : INLINE_MS).then(() => null)]);
    // The output repeats what was asked: a bare {"scheduled": 13} once had her announce a gym task from the recent chat.
    const asked = JSON.stringify(args).length > 1500 ? `${JSON.stringify(args).slice(0, 1500)}…` : args;
    const send = (result: unknown) => out({ type: "conversation.item.create", item: { type: "function_call_output", call_id: e.call_id,
      output: JSON.stringify({ tool: e.name, asked, result }).slice(0, 12000) } });
    if (quick) {
      send(quick.r);
      const job = (quick.r as any)?.queued;
      if (typeof job === "string" && job.startsWith("job_")) watchDispatch(c, out, job);
    } else {
      send({ status: "started", note: "This runs in the background. Say a few words like 'on it' and keep talking; the result will come to you as a [Result] note. Don't guess it." });
      const label = e.name === "ask_wyn" ? `ask_wyn (${String(args.request ?? "").slice(0, 80)})` : e.name;
      work.then((r) => {
        const answer = (r as any)?.answer;
        deliver(c, out, label, answer ?? r, typeof answer === "string" ? `After our call, on "${String(args.request ?? "").slice(0, 120)}": ${answer}` : undefined);
        const job = (r as any)?.queued;
        if (typeof job === "string" && job.startsWith("job_") && !c.ended) watchDispatch(c, out, job);
      });
    }
    if (!c.ended) respond(c, out);
  }
  /** Turn-taking bookkeeping and tool calls. Returns nothing; wyn.ts still keeps the transcript and usage. */
  function onEvent(c: CallLike, e: any, out: Out) {
    if (DEBUG && !/delta$/.test(e.type)) console.log(`[wyn] ${new Date().toISOString().slice(11, 23)} ${c.id} ${e.type}${e.response?.id ? ` ${e.response.id}` : ""}${e.response?.status ? ` ${e.response.status}` : ""}${e.name ? ` ${e.name}` : ""}${e.transcript ? `: ${String(e.transcript).slice(0, 120)}` : ""}${e.error ? ` ${JSON.stringify(e.error).slice(0, 300)}` : ""}`);
    switch (e.type) {
      case "response.created": {
        const id = e.response?.id ?? null;
        // One greeting per call: while her opener is out, any other response (pickup noise or echo tripping the
        // VAD) is cancelled instead of greeting a second time.
        if (c.rt.opener === "pending" && c.rt.openerId && id !== c.rt.openerId) { out({ type: "response.cancel", response_id: id }); return; }
        if (c.rt.opener === "pending" && !c.rt.openerId) c.rt.openerId = id;
        c.rt.active = id;
        return;
      }
      case "response.done": {
        const id = e.response?.id ?? null;
        if (c.rt.opener === "pending" && id && id === c.rt.openerId) { c.rt.opener = "done"; out({ type: "input_audio_buffer.clear" }); }
        if (c.rt.active && c.rt.active !== id && c.rt.active !== "requested") return; // a cancelled extra
        c.rt.active = null;
        if (c.rt.want && !c.ended) { c.rt.want = false; respond(c, out); }
        return;
      }
      case "input_audio_buffer.speech_started": c.rt.userTalking = true; return;
      case "input_audio_buffer.speech_stopped": c.rt.userTalking = false; return;
      case "response.function_call_arguments.done": functionCall(c, e, out).catch((err) => console.error("[wyn] call tool", e.name, err)); return;
      case "error": {
        // A response.create that raced another one: try again when the current one is done.
        if (/active response/i.test(String(e.error?.message ?? ""))) c.rt.want = true;
        else if (c.rt.active === "requested") c.rt.active = null;
        return;
      }
    }
  }
  /** The iPhone relay holds his mic until her opener has played out of the API, so pickup noise can't start a second greeting. */
  const micOpen = (c: CallLike) => c.rt.opener !== "pending";
  return { onEvent, open, micOpen, deliver };
}

// ── housekeeping: calls stuck in "live", and scheduled calls that rang out ──
const MAX_CALL_MS = 2 * 3600_000;
/** Calls the PC lost track of (a restart, a dropped side channel) are closed; calls past two hours are ended. */
export function sweepCalls(n: WynDb, liveIds: Set<string>, endLive: (id: string) => void) {
  const rows = n.query("SELECT id, started_at FROM calls WHERE status = 'live'").all() as any[];
  for (const r of rows) {
    const age = Date.now() - Date.parse(r.started_at);
    if (!liveIds.has(r.id) && age > 5 * 60_000) {
      n.query("UPDATE calls SET status = 'dropped', ended_at = ?, summary = coalesce(summary, 'The call dropped before it was written up.') WHERE id = ?").run(iso(), r.id);
      console.log(`[wyn] call ${r.id} was stuck live; marked dropped`);
    } else if (liveIds.has(r.id) && age > MAX_CALL_MS) {
      console.log(`[wyn] call ${r.id} past ${MAX_CALL_MS / 3600_000} h; ending it`);
      endLive(r.id);
    }
  }
}

function ringDb(n: WynDb) {
  n.exec(`CREATE TABLE IF NOT EXISTS call_attempts (id INTEGER PRIMARY KEY, incoming_id TEXT NOT NULL, reason TEXT, attempt INTEGER NOT NULL,
    status TEXT NOT NULL, rang_at TEXT NOT NULL, closed_at TEXT)`);
}
/** Every time she rings him for a scheduled call (morning, night, one she or he scheduled), log the attempt. */
export function logRing(n: WynDb, incomingId: string, reason: string) {
  ringDb(n);
  const prev = (n.query("SELECT count(*) c FROM call_attempts WHERE reason = ? AND rang_at > ?").get(reason, new Date(Date.now() - 3 * 3600_000).toISOString()) as any).c;
  n.query("INSERT INTO call_attempts (incoming_id, reason, attempt, status, rang_at) VALUES (?, ?, ?, 'ringing', ?)").run(incomingId, reason, prev + 1, iso());
  console.log(`[wyn] ringing ${incomingId} (attempt ${prev + 1}): ${reason}`);
}
/** answered | snoozed | declined. */
export function closeRing(n: WynDb, incomingId: string, status: string) {
  ringDb(n);
  n.query("UPDATE call_attempts SET status = ?, closed_at = ? WHERE incoming_id = ? AND status = 'ringing'").run(status, iso(), incomingId);
}
/** How long a ring lasts: the phone shows it this long, then it's a missed ring. */
export const RING_MS = 90_000;
/** A call more than this late isn't made, and a missed one isn't retried past it: a night call is not for the morning. */
export const RING_WINDOW_MS = 30 * 60_000;
const RETRY_MS = 10 * 60_000;
/** A call that ends this soon after it connects didn't happen (both on 10-22 died at 1 and 2 s): it failed, and its ring
 * goes back to the missed-call logic. */
export const DEAD_CALL_SEC = 5;
export const deadCall = (seconds: number) => seconds < DEAD_CALL_SEC;
/** A scheduled call this late (the PC was off or asleep when it came due) is let go instead of rung. */
export const lateCall = (at: string, now = Date.now()) => now - Date.parse(at) > RING_WINDOW_MS;
/** The ring he picked up led to a call that died at once: it counts as a missed ring, not an answered one. */
export function failRing(n: WynDb, incomingId: string) {
  ringDb(n);
  n.query("UPDATE call_attempts SET status = 'failed', closed_at = ? WHERE incoming_id = ? AND status = 'answered'").run(iso(), incomingId);
}
/** Rings nobody picked up (or whose call died at once): the first gets one retry in 10 minutes, a second miss becomes a
 * chat message. ringingNow is the ring still on his screen (under RING_MS old), left alone. Once a ring's window has
 * passed (the PC was off, or the miss went unnoticed overnight) it's only marked missed: no retry, no message. */
export function missedRings(n: WynDb, ringingNow: string | null, retry: (reason: string, at: Date) => void, fallback: (reason: string) => void) {
  ringDb(n);
  const now = Date.now(), old = new Date(now - RING_MS - 10_000).toISOString();
  for (const r of n.query("SELECT * FROM call_attempts WHERE (status = 'ringing' AND rang_at < ?) OR status = 'failed'").all(old) as any[]) {
    if (r.incoming_id === ringingNow) continue;
    if (now + RETRY_MS - Date.parse(r.rang_at) > RING_WINDOW_MS) {
      n.query("UPDATE call_attempts SET status = 'missed', closed_at = ? WHERE id = ?").run(iso(), r.id);
      console.log(`[wyn] ${r.incoming_id} rang out and its window has passed; not trying again`);
      continue;
    }
    if (r.attempt <= 1) {
      n.query("UPDATE call_attempts SET status = 'missed', closed_at = ? WHERE id = ?").run(iso(), r.id);
      retry(r.reason, new Date(now + RETRY_MS));
      console.log(`[wyn] ${r.incoming_id} rang out; trying again in 10 minutes`);
    } else {
      n.query("UPDATE call_attempts SET status = 'gave_up', closed_at = ? WHERE id = ?").run(iso(), r.id);
      fallback(r.reason);
      console.log(`[wyn] ${r.incoming_id} rang out again; sent a chat message instead`);
    }
  }
}

// The free voice path for calls (DECISIONS 4: no OpenAI credits). The phone does the hearing and the speaking on device
// (SpeechAnalyzer or SFSpeechRecognizer in, AVSpeechSynthesizer out, inside the CallKit call); the PC does the thinking:
// POST /api/v1/wyn/voice-turn sends what he said and gets back what she says (notes/native.md section 5).
//   start   { callId: null, start: true, incomingId?, reason, native } → { callId, reply, end }   her opening line
//   a turn  { callId, text } → { reply, end }                                                      end: say it, then hang up
//   hang up { callId, hangup: true } → { ok }
// Her brain on a call is Codex with all her tools (one Codex thread per call, resumed each turn, low effort for speed);
// the opener is built from the day without a model, so the call never opens on silence. This file holds the pure parts
// (the opener, the spoken-reply cleanup, the end of a call); wyn.ts wires them to the brain and the call log.

/** The reason a call carries, from her side. When he rings her the phone sends "You called" (his side of the screen); she
 * read that "You" as herself and opened with "maine call kiya". A call he started has no reason of its own, and every
 * prompt then says "{first} rang you". Reasons he or the app gave (an agenda, a topic) are kept. */
export function callReason(raw: unknown, direction: "incoming" | "outgoing") {
  const r = String(raw ?? "").trim().slice(0, 200);
  return direction === "outgoing" && /^(you (called|rang)( wyn)?|called wyn|he rang( you)?)[.!]?$/i.test(r) ? "" : r;
}

/** Her first line when the call connects. Real facts only: the reason she rang, or the shape of the day. */
export function openerFor(o: { first: string; name: string; reason: string; direction: "incoming" | "outgoing"; now: string; next: string[]; dueCount: number; doneToday: number; overdue: number }) {
  const r = String(o.reason ?? "").trim();
  const first = o.first || "there";
  const hour = +o.now.slice(0, 2);
  const hello = hour < 12 ? "Good morning" : hour < 17 ? "Hey" : "Hey";
  const nextLine = o.next.length ? `First up, ${spokenBlock(o.next[0])}${o.next[1] ? `, then ${spokenBlock(o.next[1])}` : ""}.` : "Your calendar's clear for now.";
  if (/morning/i.test(r)) return `${hello} ${first}. ${nextLine} How are you feeling about today?`;
  if (/night|shut ?down|journal/i.test(r)) return `Hey ${first}, it's ${o.name}. ${o.doneToday ? `You got ${o.doneToday} thing${o.doneToday > 1 ? "s" : ""} done today. ` : ""}How did the day feel?`;
  if (o.direction === "outgoing" || !r || /you called|he rang/i.test(r)) return hour < 12 ? `${hello} ${first}! What's up?` : `Hey ${first}, bolo, what's up?`;
  return `Hi ${first}, it's ${o.name}. ${sentence(r)}`;
}
/** "10:30-11:30 Physics" → "Physics at 10:30" (a person says the time once). */
function spokenBlock(b: string) {
  const m = /^(\d\d:\d\d)-\d\d:\d\d\s+(.*)$/.exec(String(b));
  return m ? `${m[2]} at ${m[1]}` : b;
}
const sentence = (s: string) => { const t = s.replace(/\s+/g, " ").trim(); return /[.!?]$/.test(t) ? t : `${t}.`; };

/** He's ending the call: a goodbye, in English or Hinglish. */
export const saysBye = (text: string) => /\b(bye|bye bye|goodbye|good night|gn|ok bye|okay bye|chalo bye|chal bye|that'?s all|that is all|bas itna hi|bas itna|rakhta hoon|rakh raha hoon|baad mein baat|talk later|later then|see you|ttyl)\b/i.test(String(text ?? ""));

/** What she says, cleaned for a phone's text to speech: no markdown, links, ids, emoji or stage directions; short.
 * [bye] at the end means the call ends after this line. */
export function spoken(raw: string) {
  let t = String(raw ?? "");
  const end = /\[(bye|end|hang ?up)\]\s*$/i.test(t.trim());
  t = t.replace(/\[(bye|end|hang ?up)\]/gi, " ")
    .replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*|__|^#+\s*/gm, "").replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\[([^\]]+)\]\((?:https?:)[^)]+\)/g, "$1").replace(/https?:\/\/\S+/g, "the link in chat")
    .replace(/\b[tgijk]\d{1,5}\b/g, "").replace(/\bjob_[a-z0-9]+\b/gi, "")
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "")
    .replace(/\s*[—–]\s*/g, ", ").replace(/\s+/g, " ").replace(/\s+([,.!?])/g, "$1").trim();
  // a phone call: two or three sentences at most
  const parts = t.split(/(?<=[.!?])\s+/);
  if (parts.length > 3) t = parts.slice(0, 3).join(" ");
  if (t.length > 420) t = `${t.slice(0, 400).replace(/\s+\S*$/, "")}.`;
  return { text: t, end };
}

/** The call rules for the free voice path: the same as realtime calls (wyn-call.ts callRules), plus how to end. */
export const FREE_CALL_RULES = `# This turn is spoken on a phone call
Your reply is read out by the phone's voice, word for word. One or two short sentences, the way you'd talk. No lists, no
markdown, no emoji, no ids, no links (say "I'll put it in chat"). Say times the way people do ("shaam 6 baje").
Use your tools for anything he asks for, then say what you did in one line.
When the call should end after this line (he said bye, or you've covered everything and he agreed), put [bye] at the very end.`;

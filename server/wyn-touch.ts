// Small human touches on WhatsApp, as pure functions so they can be tested on their own:
// - a plain "ok" / "thanks" / "👍" gets an emoji reaction instead of a full reply (ackKind, asksSomething);
// - her brain can answer with a reaction, "[react: 👍]", alone or before a reply (takeReaction);
// - slow work (a Claude job, the brain vault, the web) gets a 👀 first (SLOW_TOOLS);
// - voice notes: when she answers in voice (voiceMode, wantsVoice, speakable).
// wyn-whatsapp.ts wires these in; wyn.ts strips the reaction tag from every reply.

/** What kind of plain acknowledgement a message is, or null when it says more than that. */
export type AckKind = "ok" | "thanks" | "laugh" | "done";
const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️|\s)+$/u;
const OK = /^(?:ok(?:ay|k+)?|okie|kk|k|cool|fine|alright|got it|sure|haan(?: ji)?|ha+|hm+|theek(?: hai)?|thik(?: hai)?|thik h|theek h|chalo|chal|achha|accha|acha|samjha|samajh gaya|noted|right|yes|yep|yup|ji)$/;
const THANKS = /^(?:thanks?(?: (?:a lot|wyn|yaar|so much|bro))?|thank you(?: (?:so much|wyn))?|thanku|thnx|thx|ty|tysm|shukriya|dhanyavaad|love you|ily)$/;
const LAUGH = /^(?:ha(?:ha)+h?|he(?:he)+|lol+|lmao+|rofl|😂+|🤣+)$/;
const DONE = /^(?:done(?: (?:hai|ho gaya|bro))?|ho gaya|ho gya|hogaya|hogya|kar diya|kr diya|kar liya|kr liya|finished|completed|ho gaya hai)$/;

export function ackKind(raw: string): AckKind | null {
  const text = String(raw ?? "").trim();
  if (!text || text.length > 40) return null;
  if (EMOJI.test(text)) {
    if (/[😂🤣😆😹]/u.test(text)) return "laugh";
    if (/[🙏❤💯😍🥰♥]/u.test(text)) return "thanks";
    if (/[✅✔☑]/u.test(text)) return "done";
    return "ok";
  }
  // "ok thanks!", "Haan ok 👍", "done ✅": drop emoji and punctuation, then every piece must be an ack.
  const words = text.toLowerCase().replace(/\p{Extended_Pictographic}|️|‍/gu, " ").replace(/[!.,~\s]+/g, " ").trim();
  if (!words) return "ok";
  const kinds = new Set<AckKind>();
  // Pieces like "ok thanks" or "haan ho gaya": try two-word chunks first so "thank you" and "ho gaya" stay whole.
  const toks = words.split(" ");
  for (let i = 0; i < toks.length;) {
    let hit: AckKind | null = null, len = 0;
    for (const n of [4, 3, 2, 1]) {
      const piece = toks.slice(i, i + n).join(" ");
      if (i + n > toks.length) continue;
      hit = DONE.test(piece) ? "done" : THANKS.test(piece) ? "thanks" : LAUGH.test(piece) ? "laugh" : OK.test(piece) ? "ok" : null;
      if (hit) { len = n; break; }
    }
    if (!hit) return null;
    kinds.add(hit);
    i += len;
  }
  // The strongest meaning wins: "ok done" is done, "ok thanks" is thanks.
  for (const k of ["done", "thanks", "laugh", "ok"] as AckKind[]) if (kinds.has(k)) return k;
  return null;
}

/** The reaction for an acknowledgement she answers without words. */
export const ACK_EMOJI: Record<AckKind, string> = { ok: "👍", thanks: "❤️", laugh: "😂", done: "✅" };
/** Kinds that need no brain at all. "done" goes to the brain: it may mean a task should be ticked off. */
export const SILENT_ACKS: AckKind[] = ["ok", "thanks", "laugh"];

/** Did her last message ask him something? Then his "ok" is an answer, and the brain must hear it. */
export function asksSomething(text: string | null | undefined) {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return /\?/.test(t) || /\b(?:karun|karoon|karu|kar doon|kar du|kar dun|bhej doon|bhej du|bhej do|bhejo|daal doon|daal du|chalega|batao|bata do|bata dena|batana|bolo|bol do|bolna|confirm)\b[.!\s]*$/i.test(t);
}

/** "[react: 👍]" at the start or the end of a reply: the emoji, and the reply without the tag. */
export function takeReaction(raw: string): { emoji: string | null; text: string } {
  const text = String(raw ?? "");
  const tag = /\[\s*react(?:ion)?\s*:\s*([^\]\s]{1,16})\s*\]/i;
  const m = tag.exec(text);
  if (!m) return { emoji: null, text: text.trim() };
  const emoji = [...m[1]].filter((c) => /\p{Extended_Pictographic}|\p{Emoji_Modifier}|️|‍/u.test(c)).join("");
  const rest = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/^[ \t]*\n+/, "").trim();
  return { emoji: emoji || null, text: rest };
}

/** Her tools that take a while: he sees 👀 on his message while she's on it. */
export const SLOW_TOOLS = new Set(["give_to_claude", "session_new", "session_send", "brain_ask", "brain_search", "brain_read", "web_search", "onboard_me", "read_call"]);
/** After this long with no reply, 👀 anyway (WhatsApp's typing dots fade after about 25 s). */
export const SLOW_MS = 25_000;

/** What she tells her brain about reactions, added to every WhatsApp message. */
export const REACT_NOTE = "[On WhatsApp you can react to his message with one emoji, like a friend would: when it's a plain ok, thanks or done and nothing needs saying back, " +
  "reply with only [react: ✅] (or 👍, ❤️, 😂, 🔥, whichever fits). You may also start a reply with [react: X] and then write. A real question still gets a real answer.]";
export const DONE_NOTE = "[He's telling you something got done. If it matches an open task, mark it done; then a ✅ reaction is enough unless there's something worth saying.]";

// ── voice replies ──
export const VOICE_MODES = ["off", "mirror", "always"] as const;
export type VoiceMode = (typeof VOICE_MODES)[number];
/** voice_replies: off (never), mirror (default: a voice note back when he sent one), always (every WhatsApp reply). */
export const voiceMode = (v: unknown): VoiceMode => ((VOICE_MODES as readonly string[]).includes(String(v)) ? (String(v) as VoiceMode) : "mirror");
/** Text that sounds fine read aloud: no links, code, tables or long lists, and not too long for a voice note. */
export function speakable(text: string) {
  const t = String(text ?? "").trim();
  if (!t || t.length > 1200) return false;
  if (/https?:\/\/|www\.|```|\|.*\|/.test(t)) return false;
  const lines = t.split("\n").filter((l) => l.trim());
  if (lines.filter((l) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l)).length > 3) return false;
  return true;
}
export const wantsVoice = (mode: VoiceMode, heSentVoice: boolean, text: string) =>
  mode !== "off" && (mode === "always" || heSentVoice) && speakable(text);
/** What the voice reads: no emoji, no reaction tags, blank lines as pauses. */
export const spokenText = (text: string) => takeReaction(text).text.replace(/\p{Extended_Pictographic}|️|‍/gu, "")
  .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();

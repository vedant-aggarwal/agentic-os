// Wyn texts like a person: one reply from her brain goes out as one to three separate messages, with a short
// typing pause between them. Shared by every channel (the app chat here, WhatsApp later).
//   splitReply(text)            -> ["Haan, done.", "Moved gym to 18:00 ...", "Want me to call at 22:15?"]
//   typingMs(part)              -> how long "typing…" shows before that part lands
//   deliver(parts, send, opts)  -> sends each part in order, with the typing pause before every part after the first
// The brain is asked to separate messages with a blank line; code blocks and lists are never split.

const MAX_PARTS = 3;
const TINY = 8; // shorter than this ("ok", ":)"), a piece joins its neighbour; an opener like "Haan!" may stand alone
const LIST_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;

type Block = { text: string; kind: "code" | "list" | "text" };

/** Paragraphs separated by blank lines; a ``` fence is one block whatever it holds. */
function blocksOf(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let cur: string[] = [], fence = false;
  const flush = () => {
    const t = cur.join("\n").trim();
    if (t) out.push({ text: t, kind: /^```/.test(t) ? "code" : t.split("\n").every((l) => LIST_ITEM.test(l) || /^\s{2,}\S/.test(l)) ? "list" : "text" });
    cur = [];
  };
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      if (!fence) { flush(); fence = true; cur.push(line); continue; }
      cur.push(line); fence = false; flush(); continue;
    }
    if (fence) { cur.push(line); continue; }
    if (!line.trim()) { flush(); continue; }
    cur.push(line);
  }
  flush();
  return out;
}

/** Splits a reply into 1-3 chat messages. Never cuts a code block or a list; a list stays with the line that
 *  introduces it; tiny fragments merge into a neighbour; past three, the closest neighbours merge. */
export function splitReply(text: string, max = MAX_PARTS): string[] {
  const src = String(text ?? "").trim();
  if (!src) return [];
  const blocks = blocksOf(src);
  // A list (or more list) follows its intro ("Here's the plan:") and the items before it.
  const groups: string[][] = [];
  for (const b of blocks) {
    const prev = groups.at(-1);
    const prevLast = prev?.at(-1) ?? "";
    const joinsPrev = prev && (b.kind === "list" && (/:\s*$/.test(prevLast) || LIST_ITEM.test(prevLast.split("\n").at(-1) ?? ""))
      || b.kind === "code" && /:\s*$/.test(prevLast));
    if (joinsPrev) prev!.push(b.text); else groups.push([b.text]);
  }
  let parts = groups.map((g) => g.join("\n\n"));
  // Tiny pieces join a neighbour; a short first line can stay on its own as an opener.
  for (let i = parts.length - 1; i >= 0 && parts.length > 1; i--) {
    if (parts[i].length >= TINY || (i === 0 && parts[i].length >= 4)) continue;
    if (i > 0) { parts[i - 1] = `${parts[i - 1]}\n\n${parts[i]}`; parts.splice(i, 1); }
    else { parts[1] = `${parts[0]}\n\n${parts[1]}`; parts.splice(0, 1); }
  }
  // Too many: merge the adjacent pair with the smallest combined length until it fits.
  while (parts.length > Math.max(1, max)) {
    let best = 0;
    for (let i = 1; i < parts.length - 1; i++) if (parts[i].length + parts[i + 1].length < parts[best].length + parts[best + 1].length) best = i;
    parts.splice(best, 2, `${parts[best]}\n\n${parts[best + 1]}`);
  }
  return parts;
}

/** The typing pause before a message: longer for longer messages, within 0.7-2.4 s. */
export const typingMs = (part: string) => Math.round(Math.min(2400, Math.max(700, 450 + part.length * 14)));

/** Sends the parts in order. Before every part after the first, onTyping(true) and a pause; onTyping(false) at the end. */
export async function deliver(parts: string[], send: (text: string, i: number, last: boolean) => unknown | Promise<unknown>,
  opts: { onTyping?: (on: boolean) => void; sleep?: (ms: number) => Promise<unknown> } = {}) {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  try {
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) { opts.onTyping?.(true); await sleep(typingMs(parts[i])); }
      await send(parts[i], i, i === parts.length - 1);
    }
  } finally { opts.onTyping?.(false); }
}

/** One line for the brain's rules, so every channel asks for the same shape. */
export const REPLY_SHAPE = "Write the way you'd text a friend: one to three short messages, separated by a blank line (a short reply is just one). Keep a list or a code block whole inside one message.";

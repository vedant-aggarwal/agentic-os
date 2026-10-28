// Scan: the kinds the one lens knows (reimagine CONTRACT.md §4), where each goes, the classifier's prompt and schema, and
// the normalisers that turn Codex's answer into the contract's `fields`. Pure: no I/O, so scan.test.ts covers it whole.
// Owner: CAPTURE. Read by scan.ts (and the agent through scan's tools).

export type Kind = "receipt" | "statement" | "food" | "face" | "book" | "page" | "goals" | "chat" | "card" | "document" | "reel" | "link";
export type Dest = { app: string; action: string; label: string; where: string };
export type Suggestion = Dest & { kind: Kind };
export type Classified = {
  kind: Kind; title: string; summary: string; confidence: number; fields: Record<string, any>;
  suggestion: Suggestion; alternatives: Suggestion[];
};

/** kind → the app that owns it (its registerAspect scan handler, or Content / the Brain through the bus) */
export const KINDS: Record<Kind, { app: string; label: string; action: string; where: string }> = {
  receipt: { app: "money", label: "Receipt or bill", action: "log_expense", where: "Money" },
  statement: { app: "money", label: "Bank statement", action: "import_statement", where: "Money · Statements" },
  food: { app: "body", label: "Food", action: "log_meal", where: "Body · Fuel" },
  face: { app: "body", label: "Face", action: "looks_scan", where: "Body · Looks" },
  book: { app: "mind", label: "Book", action: "add_book", where: "Mind · Library" },
  page: { app: "growth", label: "Handwritten page", action: "journal_page", where: "Growth · Journal" },
  goals: { app: "mission", label: "Written goals", action: "add_goals", where: "Mission · Goals" },
  chat: { app: "friends", label: "Chat screenshot", action: "log_moment", where: "People" },
  card: { app: "friends", label: "Someone's card", action: "add_person", where: "Friends · People" },
  document: { app: "brain", label: "Document", action: "remember", where: "Brain" },
  reel: { app: "content", label: "Reel or post", action: "add_content_idea", where: "Content · Ideas" },
  link: { app: "content", label: "Link or article", action: "add_content_idea", where: "Content · Ideas" },
};
export const KIND_IDS = Object.keys(KINDS) as Kind[];
export const isKind = (k: unknown): k is Kind => typeof k === "string" && k in KINDS;

// ── small coercions: Codex's JSON is a claim, so every field is checked and shaped here ──
const str = (v: unknown, max = 300) => (v == null ? null : String(v).replace(/\s+/g, " ").trim().slice(0, max) || null);
const text = (v: unknown, max = 8000) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v: unknown) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") { const n = Number(v.replace(/[₹,\s]|rs\.?|inr/gi, "")); return Number.isFinite(n) && v.trim() !== "" ? n : null; }
  return null;
};
const int = (v: unknown) => { const n = num(v); return n == null ? null : Math.round(n); };
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : null);
const list = (v: unknown, max = 60) => (Array.isArray(v) ? v.slice(0, max) : []);
const oneOf = <T extends string>(v: unknown, ok: readonly T[], d: T | null = null): T | null => (typeof v === "string" && (ok as readonly string[]).includes(v) ? (v as T) : d);
const score = (v: unknown) => { const n = num(v); return n == null ? null : Math.max(0, Math.min(10, Math.round(n * 10) / 10)); };

const CATEGORIES = ["Food & drinks", "Groceries", "Transport", "Shopping", "Bills", "Education", "Health", "Entertainment", "Shop", "Business", "Gifts", "Other"] as const;
const PLATFORMS = ["Instagram", "YouTube", "TikTok", "X", "LinkedIn", "Facebook", "Threads", "Snapchat", "Web"] as const;

/** The contract's fields per kind (CONTRACT.md §4), plus a few the apps asked for (currency, isbn, url). */
export function normalizeFields(kind: Kind, f: any): Record<string, any> {
  f = f && typeof f === "object" && !Array.isArray(f) ? f : {};
  switch (kind) {
    case "receipt": {
      const items = list(f.items).map((x: any) => ({ name: str(x?.name, 120), price: num(x?.price), qty: int(x?.qty) })).filter((x) => x.name);
      const total = num(f.total) ?? (items.length && items.every((x) => x.price != null) ? items.reduce((s, x) => s + (x.price ?? 0), 0) : null);
      return { merchant: str(f.merchant, 120), total, currency: str(f.currency, 8) ?? "INR", date: day(f.date), time: str(f.time, 8),
        items, category: oneOf(f.category, CATEGORIES, "Other"), paidBy: str(f.paidBy, 40) };
    }
    case "statement": {
      const rows = list(f.rows, 400).map((r: any) => ({ date: day(r?.date), desc: str(r?.desc, 160), amount: num(r?.amount) })).filter((r) => r.desc && r.amount != null);
      return { bank: str(f.bank, 60), period: str(f.period, 60), currency: str(f.currency, 8) ?? "INR", rows };
    }
    case "food": {
      const items = list(f.items).map((x: any) => ({ name: str(x?.name, 80), grams: int(x?.grams), kcal: int(x?.kcal), protein: num(x?.protein) })).filter((x) => x.name);
      return { name: str(f.name, 120), items, kcal: int(f.kcal) ?? (items.length ? items.reduce((s, x) => s + (x.kcal ?? 0), 0) : null),
        protein: num(f.protein), carbs: num(f.carbs), fat: num(f.fat), slot: oneOf(f.slot, ["breakfast", "lunch", "snack", "dinner"] as const) };
    }
    case "face": {
      const s = f.scores && typeof f.scores === "object" ? f.scores : {};
      const scores: Record<string, number> = {};
      for (const k of ["overall", "jawline", "skin", "symmetry", "posture"]) { const v = score(s[k]); if (v != null) scores[k] = v; }
      return { angle: oneOf(f.angle, ["front", "side"] as const, "front"), scores, notes: str(f.notes, 300), lighting: str(f.lighting, 80) };
    }
    case "book": return { title: str(f.title, 200), author: str(f.author, 120), pages: int(f.pages), page: int(f.page), isbn: str(f.isbn, 20) };
    case "page": return { text: text(f.text), date: day(f.date), title: str(f.title, 120) };
    case "goals": return { items: list(f.items, 30).map((g: any) => ({ title: str(typeof g === "string" ? g : g?.title, 200), horizon: str(g?.horizon, 20), due: day(g?.due) })).filter((g) => g.title) };
    case "chat": return { app: str(f.app, 30) ?? "WhatsApp", person: str(f.person, 80), text: text(f.text, 4000), asks: str(f.asks, 300), due: day(f.due) };
    case "card": return { name: str(f.name, 120), phone: str(f.phone, 40), email: str(f.email, 120), org: str(f.org, 120), role: str(f.role, 120), where: str(f.where, 120) };
    case "document": return { name: str(f.name, 160), text: text(f.text), aspect: str(f.aspect, 20), date: day(f.date) };
    case "reel": case "link": return { url: str(f.url, 600), platform: oneOf(f.platform, PLATFORMS, "Web"), title: str(f.title, 200), why: str(f.why, 300) };
  }
}

/** Where a result goes and what the button says, worded from its fields. */
export function suggestionFor(kind: Kind, f: Record<string, any>): Suggestion {
  const k = KINDS[kind];
  const rs = (n: number | null) => (n == null ? "" : `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
  const label = ({
    receipt: f.total != null ? `Add ${rs(f.total)} to Money` : "Add to Money",
    statement: f.rows?.length ? `Review ${f.rows.length} rows` : "Review in Money",
    food: f.kcal ? `Log ${f.kcal} kcal` : "Log this meal",
    face: "Save to Looks",
    book: f.title ? `Add “${String(f.title).slice(0, 40)}”` : "Add to Library",
    page: "Save as a journal page",
    goals: f.items?.length ? `Add ${f.items.length} goal${f.items.length === 1 ? "" : "s"}` : "Add to Mission",
    chat: f.person ? `Log it on ${f.person}` : "Log the moment",
    card: f.name ? `Add ${f.name}` : "Add this person",
    document: "Save to Brain",
    reel: "Add as an idea",
    link: "Add as an idea",
  } as Record<Kind, string>)[kind];
  const where = kind === "receipt" && f.category ? `Money · ${f.category}` : kind === "document" && f.aspect ? `Brain › ${f.aspect}` : k.where;
  return { kind, app: k.app, action: k.action, label, where };
}

/** The one-tap alternatives: what Codex thought it might also be, then Brain (always), then a task. */
export function alternativesFor(kind: Kind, others: unknown[], f: Record<string, any>): Suggestion[] {
  const out: Suggestion[] = [];
  for (const o of others) if (isKind(o) && o !== kind && !out.some((x) => x.kind === o)) out.push(suggestionFor(o, f));
  if (kind !== "document" && !out.some((x) => x.kind === "document")) out.push({ ...suggestionFor("document", f), label: "Save to Brain" });
  out.push({ kind, app: "today", action: "add_task", label: "Make it a task", where: "Today · Inbox" });
  return out.slice(0, 4);
}

// ── links without Codex: reels and posts by their address, articles by their page title ──
export function kindOfUrl(raw: string): { kind: "reel" | "link"; platform: string; url: string } | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.replace(/^(www|m)\./, "");
  const p = u.pathname;
  if (/(^|\.)instagram\.com$/.test(h)) return { kind: /^\/(reels?|p|tv)\//.test(p) ? "reel" : "link", platform: "Instagram", url: u.href };
  if (/(^|\.)tiktok\.com$/.test(h)) return { kind: "reel", platform: "TikTok", url: u.href };
  if (h === "youtu.be" || /(^|\.)youtube\.com$/.test(h)) return { kind: /^\/shorts\//.test(p) || h === "youtu.be" || p === "/watch" ? "reel" : "link", platform: "YouTube", url: u.href };
  if (h === "x.com" || h === "twitter.com") return { kind: "link", platform: "X", url: u.href };
  if (/(^|\.)linkedin\.com$/.test(h)) return { kind: "link", platform: "LinkedIn", url: u.href };
  if (/(^|\.)facebook\.com$|^fb\.watch$/.test(h)) return { kind: /\/(reel|watch|videos)\b/.test(p) || h === "fb.watch" ? "reel" : "link", platform: "Facebook", url: u.href };
  if (h === "threads.net" || h === "threads.com") return { kind: "link", platform: "Threads", url: u.href };
  return { kind: "link", platform: "Web", url: u.href };
}
export const firstUrl = (s: string) => s.match(/https?:\/\/[^\s<>"')]+/i)?.[0] ?? null;

/** A guess from the phone (NATIVE's Vision classifier, or Foundation Models) mapped onto the contract's kinds. */
export function kindOfGuess(guess: unknown, ocr = ""): Kind | null {
  const g = String(guess ?? "").toLowerCase();
  if (isKind(g)) return g;
  if (g === "screenshot") return /\b(online|typing|last seen|delivered|read)\b|\d{1,2}:\d{2}\s*(am|pm)?\s*$/im.test(ocr) ? "chat" : "document";
  if (g === "photo") return null;
  return null;
}

// ── the classifier: one Codex call with the photo, the phone's OCR text and its first guess ──
export const CLASSIFY_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["kind", "confidence", "title", "summary", "fields_json", "also"],
  properties: {
    kind: { type: "string", enum: KIND_IDS },
    confidence: { type: "number", description: "0 to 1" },
    title: { type: "string", description: "A short name for it, as a card title: \"Haldiram's · ₹486\", \"Atomic Habits\", \"Dad on WhatsApp\"" },
    summary: { type: "string", description: "One plain sentence: what it is and the one thing that matters in it" },
    fields_json: { type: "string", description: "A JSON object with the fields for this kind (see the list); unknown fields are null, never guessed" },
    also: { type: "array", items: { type: "string", enum: KIND_IDS }, description: "Up to 2 other kinds it could reasonably be" },
  },
} as const;

const FIELD_GUIDE = `Fields per kind (fields_json):
- receipt: { merchant, total (number, rupees), currency ("INR"), date (YYYY-MM-DD), time ("HH:MM"), items: [{ name, price, qty }], category (one of ${CATEGORIES.join(", ")}), paidBy (UPI, cash, card) }
- statement: { bank, period, currency, rows: [{ date (YYYY-MM-DD), desc, amount (negative = money out) }] }
- food: { name, items: [{ name, grams, kcal, protein }], kcal, protein, carbs, fat (grams, estimates for an Indian portion), slot (breakfast|lunch|snack|dinner or null) }
- face: { angle (front|side), lighting, scores: { overall, jawline, skin, symmetry, posture } (gentle 1-10, encouraging, never harsh), notes (one kind, useful line) }
- book: { title, author, pages, page (the page number if a page is open, else null), isbn }
- page (handwriting or a journal page): { text (everything written, transcribed exactly), date (if written), title }
- goals (a written list of goals or plans): { items: [{ title, horizon (week|month|quarter|year|later or null), due (YYYY-MM-DD or null) }] }
- chat (a chat screenshot): { app (WhatsApp, Instagram, iMessage…), person (the other person's name as shown, e.g. "Dad"), text (the messages that matter, as written), asks (what they want from him, if anything), due (YYYY-MM-DD if a deadline is said) }
- card (a visiting card or contact): { name, phone, email, org, role, where }
- document (anything else worth keeping: a notice, a form, a timetable, a bill without a total): { name, text (the key text), aspect (body|mind|soul|mission|money|growth|family|romance|friends or null), date }
- reel / link (a reel, a post, an article, or a screenshot of one): { url (if visible), platform, title, why (why it may be useful to him as a content idea) }`;

export function classifyPrompt(o: { today: string; now: string; ocr?: string | null; guess?: string | null; hint?: string | null; text?: string | null; url?: string | null; note?: string | null; source?: string | null; hasImage: boolean; pages?: number }) {
  return [
    // Who the owner is comes from OWNER_PROFILE in the server env (a sentence or two); the default is a neutral template.
    `You sort what the owner just captured on his phone into one kind, and read out its fields. ${process.env.OWNER_PROFILE || "He lives in India (IST, rupees), studies, runs a small studio and helps at his family's store. He may write Hinglish."}`,
    `Today is ${o.today}, now ${o.now} IST.`,
    o.hasImage ? `The attached image${o.pages && o.pages > 1 ? `s are ${o.pages} pages of one scan` : " is what the camera saw"}${o.source ? ` (from: ${o.source})` : ""}.` : `There is no image; classify the text.`,
    o.hint ? `He opened the camera expecting: ${o.hint}. Prefer it if the image fits.` : "",
    o.guess ? `The phone's own quick guess: ${o.guess} (it can be wrong).` : "",
    o.ocr ? `Text the phone read on the device (OCR, may have errors):\n"""\n${o.ocr.slice(0, 6000)}\n"""` : "",
    o.text ? `Text he shared or typed:\n"""\n${o.text.slice(0, 6000)}\n"""` : "",
    o.url ? `A link came with it: ${o.url}` : "",
    o.note ? `His note: ${o.note.slice(0, 500)}` : "",
    `Kinds: ${KIND_IDS.map((k) => `${k} (${KINDS[k].label})`).join(", ")}.`,
    FIELD_GUIDE,
    `Rules: read only what is there; a field you can't see is null (never invent a total, a name or a date). Amounts are numbers in rupees. Keep his words and names as written (Hinglish stays Hinglish). confidence is how sure you are of the kind.`,
  ].filter(Boolean).join("\n\n");
}

/** Codex's answer → the contract's result. Anything malformed becomes a safe document. */
export function shapeClassified(out: any, fallback: { kind?: Kind | null; title?: string | null } = {}): Classified {
  let kind: Kind = isKind(out?.kind) ? out.kind : fallback.kind ?? "document";
  let raw: any = {};
  try { raw = typeof out?.fields_json === "string" ? JSON.parse(out.fields_json) : out?.fields ?? {}; } catch { raw = {}; }
  const fields = normalizeFields(kind, raw);
  const confidence = Math.max(0, Math.min(1, num(out?.confidence) ?? 0.5));
  const title = str(out?.title, 120) ?? fallback.title ?? KINDS[kind].label;
  return { kind, title, summary: str(out?.summary, 300) ?? "", confidence, fields, suggestion: suggestionFor(kind, fields), alternatives: alternativesFor(kind, list(out?.also, 3), fields) };
}

// ── "say it once": one sentence or a voice note becomes one entry per app ──
export type SayAction = { name: string; app: string; description: string; input?: Record<string, unknown>; module?: string };
/** The actions the lens can always do itself, whatever the apps have built. */
export const CORE_ACTIONS: SayAction[] = [
  { name: "task", app: "today", description: "A to-do. args: { title, due (YYYY-MM-DD or null), at (HH:MM or null), minutes (or null), notes (or null) }" },
  { name: "idea", app: "work", description: "An idea for a project or the app (not a content idea). args: { title, body (or null) }" },
  { name: "note", app: "brain", description: "Something to remember about his life or a person (a fact, a moment, a preference). args: { text, aspect (body|mind|soul|mission|money|growth|family|romance|friends or null), person (a name or null) }" },
  { name: "content", app: "content", description: "A content idea for a reel or post. args: { title, url (or null), why (or null) }" },
];
export const SAY_SCHEMA = {
  type: "object", additionalProperties: false, required: ["items", "reply"],
  properties: {
    reply: { type: "string", description: "One short line to him about what you'll file (warm, direct)" },
    items: { type: "array", items: { type: "object", additionalProperties: false, required: ["action", "app", "title", "detail", "args_json"], properties: {
      action: { type: "string", description: "The action name, exactly as listed" },
      app: { type: "string", description: "The app it lands in (the action's app)" },
      title: { type: "string", description: "What it is, short: \"Expense\", \"Reading\", \"Moment with Dad\"" },
      detail: { type: "string", description: "The specifics as he'd read them: \"₹120 · samosas · Food & drinks\", \"Tomorrow 18:00 · about the stock list\" (words for days, never YYYY-MM-DD here)" },
      args_json: { type: "string", description: "A JSON object with the action's args" },
    } } },
  },
} as const;
export function sayPrompt(o: { text: string; today: string; now: string; weekday: string; actions: SayAction[] }) {
  return [
    `The owner said this to his assistant (it may be Hinglish, a voice transcript): """${o.text.slice(0, 4000)}"""`,
    `Today is ${o.weekday} ${o.today}, now ${o.now} IST. Split what he said into one entry per thing to file, each with the one action that fits best. Only file what he actually said; skip chit-chat. If nothing fits a specific app, use note. Keep his words (Hinglish stays Hinglish). Amounts in rupees as numbers. Relative dates ("kal", "tomorrow", "Sunday") become YYYY-MM-DD.`,
    `Actions:\n${o.actions.map((a) => `- ${a.name} (app ${a.app}): ${a.description}${a.input ? ` input schema: ${JSON.stringify(a.input).slice(0, 600)}` : ""}`).join("\n")}`,
  ].join("\n\n");
}
export function shapeSay(out: any, actions: SayAction[]) {
  const names = new Map(actions.map((a) => [a.name, a]));
  const items = list(out?.items, 12).map((x: any, i: number) => {
    let args: any = {};
    try { args = typeof x?.args_json === "string" ? JSON.parse(x.args_json) : x?.args ?? {}; } catch { args = {}; }
    const a = names.get(String(x?.action ?? "")) ?? names.get("note")!;
    if (a.name === "note" && !args.text) args.text = str(x?.detail, 2000) ?? str(x?.title, 300);
    if ((a.name === "task" || a.name === "idea" || a.name === "content") && !args.title) args.title = str(x?.detail, 300) ?? str(x?.title, 300);
    return { n: i, action: a.name, app: a.app, module: a.module ?? null, title: str(x?.title, 80) ?? a.name, detail: str(x?.detail, 300) ?? "", args };
  }).filter((x) => Object.keys(x.args).length);
  return { reply: str(out?.reply, 300) ?? "", items };
}

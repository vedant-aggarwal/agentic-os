// Clients: the owner's client system on this PC (studio-brain = the mind, studio-os = the body), read from disk for
// the phone's Clients tab. Read-only, apart from one guarded append (below).
//   brain  STUDIO_BRAIN (default ~/studio-brain): clients/_pipeline.md (the board), NOW.md (active clients, open
//          loops, open decisions), clients/<slug>/dossier.md (health, commercials), clients/<slug>/work-log.md
//   OS     STUDIO_OS (default ~/studio-os): clients/<slug>/{index,payments,contract,goals}.md, sales/<slug>/
//          {index,potential,pitch}.md, WORKFLOWS.md, skills/<id>/, _templates/{client,lead}/index.md (the stages)
// Never opened: anything under private/ and any contacts.md. Phone numbers, emails and street addresses are taken out
// of every string that leaves. A field no file gives (missing, still the blank template, unparseable) comes from
// SNAPSHOT, the 2026-10-21 read the mockup was built on, and every client says where each field came from (src).
// Display labels (name, monogram, product line, package, own/free notes) come from the snapshot for the clients it
// knows, because the files name them loosely ("Dad's business"); a new client takes its file titles.
//   owner  GET  /overview             clients, leads, retired, stages, money, health, workflows, sync, write
//          GET  /clients/<slug>       one client, with its whole work log and its files
//          GET  /leads/<slug>         one lead, with its files
//          GET  /workflows            WORKFLOWS.md's catalog, built or not, plus skills/
//          POST /clients/<slug>/log   { title, body? } or { text }: a dated entry at the end of the brain's
//                                     clients/<slug>/work-log.md (an append-only zone). Refused unless the server
//                                     config sets CRM_WRITE=on, which is off by default.
// The files call the owner by name ("Waiting on Alex", "Alex will …"); that name is OWNER_NAME in the server env
// (default Alex).
// Reads are cached for 60 s; ?fresh=1 reads the files again.
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModCtx, Module } from "./types";

type Conf = (k: string, d: string) => string;
type Src = Record<string, string>;

// ── where the files are, and the one write switch ──────────────────────────────────────────────────────────────
export function roots(conf: Conf) {
  const home = process.env.USERPROFILE || homedir();
  return { brain: conf("STUDIO_BRAIN", join(home, "studio-brain")), os: conf("STUDIO_OS", join(home, "studio-os")) };
}
const OWNER = (process.env.OWNER_NAME || "Alex").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const canWrite = (conf: Conf) => /^(on|true|1|yes)$/i.test(String(conf("CRM_WRITE", "off")).trim());
const WRITE_OFF = "Logging from the phone is off. It writes to studio-brain, so it stays off until CRM_WRITE=on is set in the server config.";

// ── reading: the only way in, and it never opens private/ or contacts.md ───────────────────────────────────────
const NEVER = /(^|[\\/])private([\\/]|$)|(^|[\\/])contacts\.md$/i;
export function readText(path: string): string | null {
  if (NEVER.test(path)) throw new Error("crm never reads private/ or contacts.md");
  try { return readFileSync(path, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n"); } catch { return null; }
}
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };
/** A folder's own entries for the Files list: no dotfiles, no private/, no contacts.md. */
function listing(dir: string): string[] {
  let ds: { name: string; dir: boolean }[] = [];
  try { ds = readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, dir: d.isDirectory() })); } catch { return []; }
  const ORDER = ["index.md", "dossier.md", "work-log.md", "results.md", "payments.md", "contract.md", "goals.md", "brand.md", "potential.md", "pitch.md", "convert-to-client.md"];
  const keep = ds.filter((d) => !d.name.startsWith(".") && d.name !== "private" && d.name.toLowerCase() !== "contacts.md");
  const files = keep.filter((d) => !d.dir).map((d) => d.name).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const dirs = keep.filter((d) => d.dir).map((d) => `${d.name}/`).sort((a, b) => (a === "raw/" ? 1 : b === "raw/" ? -1 : a.localeCompare(b)));
  return [...files, ...dirs];
  function rank(n: string) { const i = ORDER.indexOf(n); return i < 0 ? ORDER.length : i; }
}
/** Sub-folders that are records (clients/<slug>, sales/<slug>): not templates, not dotfiles, not private/. */
function slugDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && SLUG.test(d.name) && d.name !== "private").map((d) => d.name).sort();
  } catch { return []; }
}
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

// ── markdown, read defensively ─────────────────────────────────────────────────────────────────────────────────
type Sec = { level: number; title: string; body: string };
export function sections(md: string): Sec[] {
  const out: Sec[] = [];
  let cur: Sec = { level: 0, title: "", body: "" }, fence = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) fence = !fence;
    const h = !fence && line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { out.push(cur); cur = { level: h[1].length, title: h[2], body: "" }; continue; }
    cur.body += `${line}\n`;
  }
  out.push(cur);
  return out;
}
/** The first section (level 2 or deeper) whose title matches, with its sub-sections, up to the next one of its level. */
export function section(md: string | null, re: RegExp): string | null {
  if (!md) return null;
  const secs = sections(md);
  const i = secs.findIndex((s) => s.level >= 2 && re.test(clean(s.title)));
  if (i < 0) return null;
  let body = secs[i].body;
  for (let j = i + 1; j < secs.length && secs[j].level > secs[i].level; j++) body += `${"#".repeat(secs[j].level)} ${secs[j].title}\n${secs[j].body}`;
  return body;
}
function splitRow(line: string) {
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cur = "", tick = false;
  for (const ch of s) {
    if (ch === "`") tick = !tick;
    if (ch === "|" && !tick) { cells.push(cur.trim()); cur = ""; } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}
/** Every markdown table in the text, as rows keyed by the lower-cased, cleaned header. */
export function tables(text: string | null): Record<string, string>[][] {
  if (!text) return [];
  const blocks: string[][][] = [];
  let rows: string[][] | null = null;
  for (const line of text.split("\n")) {
    if (line.trim().startsWith("|")) (rows ??= []).push(splitRow(line));
    else if (rows) { blocks.push(rows); rows = null; }
  }
  if (rows) blocks.push(rows);
  return blocks
    .filter((rs) => rs.length >= 2 && rs[1].every((c) => /^:?-{2,}:?$/.test(c) || c === ""))
    .map((rs) => { const head = rs[0].map((h) => clean(h).toLowerCase()); return rs.slice(2).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]))); })
    .filter((t) => t.length);
}
/** Markdown to plain words: links to their text, emphasis and code marks dropped, whitespace collapsed. */
export function clean(s: unknown): string {
  return String(s ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*(?!\s)([^*]+?)\*(?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
/** The first sentence, cut at a word near max characters. */
export function sentence(s: unknown, max = 160): string {
  const t = clean(s).replace(/^[-*•]\s+/, "");
  const m = t.match(/^(.+?[.!?])(?=\s+[A-Z0-9₹"'(“]|$)/);
  return cut(m ? m[1] : t, max);
}
function cut(t: string, max: number) {
  if (t.length <= max) return t;
  return `${t.slice(0, max).replace(/[\s,;:—–-]+\S*$/, "")}…`;
}
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** All-caps titles ("WHAT THE PIVOT STILL LEAVES OPEN") read in sentence case. */
const calm = (s: string) => (/[a-z]/.test(s) || !/[A-Z]{4}/.test(s) ? s : cap(s.toLowerCase()));
const placeholder = (s: string) => /\{[^}\n]{1,60}\}/.test(s);
/** A file still as the template left it: a {placeholder} in its title, or three or more placeholders. */
export const blankTemplate = (md: string | null) => !!md && (/^#\s.*\{[^}]+\}/m.test(md) || (md.match(/\{[^}\n]{1,60}\}/g)?.length ?? 0) >= 3);
const unknown = (s: string) => !clean(s) || /^(unknown|tbd|n\/a|none|not set|\(none|—|-)(\b|$)/i.test(clean(s)) || /unknown \(ask\)/i.test(s);
/** Split at top-level separators only: commas inside (parentheses) or `code` stay. */
function splitTop(s: string, sep: RegExp) {
  const out: string[] = [];
  let cur = "", depth = 0, tick = false;
  for (const ch of s) {
    if (ch === "`") tick = !tick;
    else if (!tick && ch === "(") depth++;
    else if (!tick && ch === ")") depth = Math.max(0, depth - 1);
    if (!tick && depth === 0 && sep.test(ch)) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
const bullets = (text: string | null) => (text ?? "").split("\n").filter((l) => /^\s*[-*]\s+/.test(l) && !/^\s*[-*]\s+\[[ xX]\]/.test(l)).map((l) => l.replace(/^\s*[-*]\s+/, ""));
/** "- **Key:** value" bullets as a map of lower-cased keys (a key's own "(…)" note dropped). */
function keyed(text: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of (text ?? "").split("\n")) {
    const m = l.match(/^\s*[-*]\s+\*\*([^*]+?)\*\*\s*:?\s*(.*)$/);
    if (m) out[clean(m[1]).replace(/:$/, "").replace(/\s*\(.*\)\s*$/, "").toLowerCase()] = m[2].replace(/^:\s*/, "");
  }
  return out;
}
const title1 = (md: string | null) => clean(md?.match(/^#\s+(.+)$/m)?.[1] ?? "");

// ── privacy: what never leaves, even when a file has it ────────────────────────────────────────────────────────
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const PHONE = /(?<![\w@./])\+?\(?\d[\d\s().-]{8,}\d(?![\w@])/g;
const CITY_PIN = /\b((?:new delhi|delhi|mumbai|bengaluru|bangalore|kolkata|chennai|pune|hyderabad|gurgaon|gurugram|noida|ghaziabad|faridabad|midtown)\b[\s,–-]*)\d{3}\s?\d{3}\b/gi;
const PIN = /\b(pin(?:\s*code)?\s*[:-]?\s*)\d{6}\b/gi;
const ADDRESS = /\b(address|addr\.)\s*[:–—-]\s*[^.;\n|]+/gi;
const STREET = /\b(house|plot|flat|gali|street|sector|block|khasra)\s*(?:no\.?|number|#)\s*[\w/-]+/gi;
export function scrub(s: string): string {
  return s
    .replace(EMAIL, "[email hidden]")
    .replace(PHONE, (m) => {
      const digits = m.replace(/\D/g, "");
      return digits.length < 10 || digits.length > 13 || /\d{4}-\d\d-\d\d/.test(m) ? m : "[number hidden]";
    })
    .replace(CITY_PIN, "$1[PIN hidden]").replace(PIN, "$1[hidden]")
    .replace(ADDRESS, "$1 hidden").replace(STREET, "[address hidden]");
}
export function scrubDeep<T>(v: T): T {
  if (typeof v === "string") return scrub(v) as T;
  if (Array.isArray(v)) return v.map(scrubDeep) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrubDeep(x)])) as T;
  return v;
}

// ── dates (India time, as the brain writes them) ───────────────────────────────────────────────────────────────
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const isoOf = (s: unknown) => String(s ?? "").match(/\b20\d\d-\d\d-\d\d\b/)?.[0] ?? null;
const monYear = (iso: string) => `${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const dayMon = (iso: string) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]}`;
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
/** When something is due, said the way the phone shows it: Today, Overdue 2 days, Tomorrow, Fri 23, 9 Nov. */
export function dueLabel(iso: string, today: string) {
  const d = days(today, iso);
  if (d === 0) return "Today";
  if (d < 0) return `Overdue ${-d} day${d === -1 ? "" : "s"}`;
  if (d === 1) return "Tomorrow";
  if (d < 7) return `${WD[new Date(`${iso}T00:00:00Z`).getUTCDay()]} ${+iso.slice(8, 10)}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? dayMon(iso) : `${dayMon(iso)} ${iso.slice(0, 4)}`;
}
/** "since" in words: Oct 2026; a relationship older than its records ("pre-brain, filed 2026-08-05") says before. */
function sinceOf(s: string | null | undefined) {
  if (!s || unknown(s)) return null;
  const iso = isoOf(s);
  if (!iso) return /^\d{4}$/.test(clean(s)) ? clean(s) : null;
  return /\bpre-|\bbefore\b/i.test(s) ? `before ${monYear(iso)}` : monYear(iso);
}

// ── the snapshot: every field a file can't give, as the mockup had it on 2026-10-21 ───────────────────────────
type Pay = { date: string; what: string; amount: string; status: string; note: string };
type Flow = { name: string; status: string; folder?: string | null; detail?: string };
type KeyDate = { what: string; when: string; iso?: string | null; tone?: string };
type Entry = { date: string; title: string; body: string; qualifier?: string };
type Snap = {
  name: string; mono: string; kind: "client" | "own"; ownerNote?: string; freeNote?: string; product: string; package: string;
  stage: string; stageNote: string; since: string; health: string; summary: string;
  next: { text: string; due: string; owner: string }; waitingOn: { them: string[]; you: string[] };
  money: { outstanding: string; state: string; rows: Pay[] }; workflows: Flow[]; keyDates: KeyDate[]; log: Entry[];
  contract: { term: string; deliverables: string[]; payment: string }; goals: string[]; projects: string[];
};
export const SNAPSHOT_AT = "2026-10-21";
export const SNAPSHOT: Record<string, Snap> = {
  "harbor-sons": {
    name: "Harbor & Sons", mono: "HS", kind: "client", product: "Harborline OS", package: "Basic + Advanced", stage: "active", stageNote: "unpaid", since: "Oct 2026",
    health: "yellow", summary: "Shop OS for a family business. Live, first-year price not final yet.",
    next: { text: "Ask them about the first-year payment", due: "Today", owner: "you" },
    waitingOn: { them: ["Who owns the A12 bills going forward", "Shop's WhatsApp number and hours", "Cashfree keys after incorporation"], you: ["Pick the first-year price (D-034)"] },
    money: { outstanding: "Price not set", state: "due", rows: [{ date: "Oct 2026", what: "Harborline OS · first year", amount: "Not set", status: "due", note: "D-034: price not final" }] },
    workflows: [{ name: "Harborline OS rollout", status: "running" }], keyDates: [{ what: "Payment ask", when: "Today" }],
    log: [{ date: "2026-10-20", title: "Basic and Advanced tiers shown", body: "Walked them through both tiers; waiting on a price." }, { date: "2026-10-14", title: "Went live in the shop", body: "Counter and bills running on Harborline OS." }],
    contract: { term: "Yearly", deliverables: ["Harborline OS Basic", "Advanced tier"], payment: "Yearly, price not final" },
    goals: ["Run the counter and bills without paper", "See stock and dues on one screen"], projects: [],
  },
  glowbox: {
    name: "Glowbox", mono: "GB", kind: "client", product: "Storefront + catalog fill", package: "Legacy service", stage: "active", stageNote: "legacy", since: "Jun 2026",
    health: "yellow", summary: "Online beauty store. Storefront live; catalog fill done, invoice not sent.",
    next: { text: "Invoice the catalog fill and ask the four launch inputs", due: "Overdue 1 day", owner: "you" },
    waitingOn: { them: ["Owner inventory list", "Grievance officer and policies"], you: ["Meta WhatsApp templates", "Deploy the variant fix (abc1234)"] },
    money: { outstanding: "₹10,000", state: "due", rows: [{ date: "Aug 2026", what: "Storefront build", amount: "₹30,000", status: "paid", note: "" }, { date: "Oct 2026", what: "Catalog fill (D-013)", amount: "₹10,000", status: "due", note: "Not quoted yet" }] },
    workflows: [{ name: "catalog-fill", status: "running" }, { name: "website-build", status: "running" }],
    keyDates: [{ what: "Invoice catalog fill", when: "Overdue" }, { what: "Launch", when: "After the four inputs" }],
    log: [{ date: "2026-10-19", title: "Variant fix ready", body: "Fix for product variants is in abc1234, not deployed." }, { date: "2026-10-12", title: "Catalog fill finished", body: "All products in. Invoice still to go out." }, { date: "2026-08-28", title: "Storefront paid", body: "₹40,000 received for the build." }],
    contract: { term: "Per project", deliverables: ["Storefront", "Catalog fill"], payment: "Per deliverable" },
    goals: ["Sell online without the owner touching code", "Launch with a full catalog"], projects: [],
  },
  "dad-shop": {
    name: "Morgan & Co.", mono: "MC", kind: "own", ownerNote: "Dad's shop", product: "Atlas ERP / ShopBrain pilot", package: "Pilot · website (legacy)", stage: "pilot", stageNote: "", since: "2026",
    health: "green", summary: "Dad's shop in Midtown. Atlas ERP pilot; the Corner Market website is older work.",
    next: { text: "Close the website payment; propose a monthly software fee", due: "Fri 23", owner: "you" },
    waitingOn: { them: [], you: ["ShopBrain store release (open decision 5)", "Website ops and security clean-up"] },
    money: { outstanding: "≈ ₹15,000", state: "due", rows: [{ date: "2026", what: "Website (cornermarket.example)", amount: "≈ ₹15,000", status: "due", note: "Close this week" }] },
    workflows: [{ name: "Atlas ERP pilot", status: "setting up" }], keyDates: [{ what: "Payment talk", when: "Fri 23" }],
    log: [{ date: "2026-10-19", title: "Atlas ERP wave 1 planned", body: "11 parallel agents: counter, bills, customers and money, stock buying and more." }, { date: "2026-10-10", title: "Pilot agreed", body: "Atlas ERP runs the shop counter first." }],
    contract: { term: "Pilot", deliverables: ["Atlas ERP", "Phone apps"], payment: "Monthly fee to propose" },
    goals: ["Run the shop from one system", "Know stock and dues without asking anyone"], projects: ["atlas"],
  },
  brightmark: {
    name: "BrightMark", mono: "BM", kind: "client", freeNote: "Not a paying client (D-022)", product: "Website + society OS", package: "Free", stage: "active", stageNote: "build", since: "2026",
    health: "green", summary: "Free build: website and a society OS.",
    next: { text: "Set up the Google OAuth web client", due: "No date", owner: "you" },
    waitingOn: { them: [], you: ["Google OAuth web client"] },
    money: { outstanding: "₹0", state: "none", rows: [] }, workflows: [{ name: "website-build", status: "running" }], keyDates: [],
    log: [{ date: "2026-10-08", title: "Marked as not a client", body: "D-022: free work, no invoices." }],
    contract: { term: "None", deliverables: ["Website", "Society OS"], payment: "Free" },
    goals: ["Society members sign in with Google"], projects: [],
  },
};
export const SNAPSHOT_LEADS: Record<string, { name: string; mono: string; stage: string; warmth: string; nextTouch: string; potential: string; pitch: string; since: string; note: string }> = {
  "silver-lens": { name: "Silver Lens", mono: "SL", stage: "new", warmth: "cold", nextTouch: "Not set (ask)", potential: "Unknown", pitch: "Not started", since: "Jul 2026", note: "Created by the lead-intake test run" },
};
export const SNAPSHOT_RETIRED: Record<string, { name: string; note: string }> = { "northwind-own": { name: "Northwind (own brand)", note: "Retired (D-035)" } };
/** Names and one-liners for the workflows the snapshot knew; built or not always comes from the files. */
const FLOW_LABELS: Record<string, { name: string; line: string }> = {
  "lead-intake": { name: "Lead intake", line: "Capture a new lead, check duplicates, file it" },
  "lead-research": { name: "Lead research", line: "Sweep their online presence" },
  "prepare-pitch": { name: "Prepare pitch", line: "Build the pitch plan" },
  "client-onboarding": { name: "Client onboarding", line: "Convert a lead into a client folder" },
  "web-client-intake": { name: "Website intake", line: "Step 0 of a website build" },
  "meeting-notes": { name: "Meeting notes", line: "Recording to notes in the work log" },
  "audit-xray": { name: "Audit X-ray", line: "Paid audit report" },
};
const SNAPSHOT_FLOWS = [
  { id: "lead-intake", built: true, for: "lead" }, { id: "lead-research", built: true, for: "lead" }, { id: "prepare-pitch", built: false, for: "lead" },
  { id: "client-onboarding", built: false, for: "lead" }, { id: "web-client-intake", built: true, for: "client" }, { id: "meeting-notes", built: false, for: "client" },
  { id: "audit-xray", built: false, for: "client", needsOk: true },
];
export const HEALTH: Record<string, string> = { green: "On track", yellow: "Needs attention", red: "At risk" };
const CLIENT_STAGE_ORDER = ["onboarding", "pilot", "active", "paused", "churned"];
const LEAD_STAGES = ["new", "warming", "pitched", "negotiating", "snoozed", "dead"];
const OFF_PATH = ["snoozed", "dead", "paused", "churned"];

// ── the board: clients/_pipeline.md ────────────────────────────────────────────────────────────────────────────
type Group = "client" | "free" | "retired" | "lead" | "off";
type PipeRow = { slug: string; group: Group; product?: string; stage?: string; since?: string; notes?: string };
export function readPipeline(md: string | null) {
  const rows: PipeRow[] = [];
  let stages: string[] = [];
  if (!md) return { ok: false, rows, stages };
  const head = md.match(/Stages:\s*`([^`]+)`/i)?.[1];
  if (head) stages = head.split(/\s*(?:→|->|,|·)\s*/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  let found = false;
  for (const s of sections(md)) {
    if (s.level !== 2) continue;
    const t = clean(s.title);
    const group: Group | null = /not clients?/i.test(t) ? "free" : /customer|pilot/i.test(t) ? "client" : /^leads?\b/i.test(t) ? "lead" : /paused|churned/i.test(t) ? "off" : null;
    if (!group) continue;
    found = true;
    for (const r of tables(s.body)[0] ?? []) {
      const first = Object.values(r)[0] ?? "";
      const slug = first.match(/`([a-z0-9][a-z0-9-]*)`/)?.[1] ?? (SLUG.test(clean(first)) ? clean(first) : null);
      if (!slug) continue;
      const why = r.why ?? r.notes ?? r.reason ?? "";
      const g: Group = group === "free" && /retired/i.test(why) ? "retired" : group;
      rows.push({ slug, group: g, product: r["product / work"] ?? r.product ?? r.work, stage: r.stage ?? (g === "off" ? clean(r.status ?? "") : undefined), since: r.since, notes: why || r.notes });
    }
  }
  return { ok: found, rows, stages };
}

// ── live state: NOW.md ─────────────────────────────────────────────────────────────────────────────────────────
type Loop = { title: string; rest: string; text: string; waiting: string[] };
type Decision = { n: number; title: string; text: string };
export function readNow(md: string | null) {
  const active = new Map<string, { stage: string; notes: string }>();
  const loops: Loop[] = [];
  const decisions: Decision[] = [];
  if (!md) return { ok: false, active, loops, decisions };
  for (const r of tables(section(md, /^active clients/i))[0] ?? []) {
    const slug = (r.client ?? Object.values(r)[0] ?? "").match(/`([a-z0-9][a-z0-9-]*)`/)?.[1];
    if (slug) active.set(slug, { stage: r.stage ?? "", notes: r.notes ?? "" });
  }
  // open loops: "- [ ] …" items; a continuation line joins its item; "- [x]" items are done and skipped
  let cur: string | null = null, open = false;
  const flush = () => { if (cur != null && open) loops.push(loopOf(cur)); cur = null; };
  for (const line of (section(md, /^open loops/i) ?? "").split("\n")) {
    const m = line.match(/^\s{0,3}[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (m) { flush(); cur = m[2]; open = m[1] === " "; continue; }
    if (!line.trim()) { flush(); continue; }
    if (cur != null) cur += ` ${line.trim()}`;
  }
  flush();
  // open decisions: "N. **Title** …" with indented sub-points; answered, struck and deferred parts don't count
  let d: { n: number; first: string; subs: string[] } | null = null;
  const done = (x: string) => /\banswered\b|~~|\bclosed by\b/i.test(x);
  const push = () => {
    if (!d) return;
    const b = d.first.match(/^(?:[^\p{L}\p{N}*]*)\*\*(.+?)\*\*\s*(.*)$/u);
    const rawTitle = b ? b[1] : d.first.split(/\s[—–]\s/)[0];
    const rest = b ? b[2] : d.first.slice(rawTitle.length);
    if (/deferred|don'?t surface/i.test(d.first) || done(rawTitle)) { d = null; return; }
    const title = calm(clean(rawTitle).replace(/\s*\((?:[^)]*\d{4}-\d\d-\d\d[^)]*)\)\s*\.?$/, "").replace(/[.:\s]+$/, ""));
    const text = [title, done(rest) ? "" : rest, ...d.subs.filter((x) => !done(x))].join(" ");
    decisions.push({ n: d.n, title, text });
    d = null;
  };
  for (const line of (section(md, /^open decisions/i) ?? "").split("\n")) {
    const m = line.match(/^(\d+)\.\s+(.*)$/);
    if (m) { push(); d = { n: +m[1], first: m[2], subs: [] }; continue; }
    if (d && line.trim()) d.subs.push(line.trim());
  }
  push();
  return { ok: true, active, loops, decisions };
}
function loopOf(raw: string): Loop {
  const t = raw.replace(/^[^\p{L}\p{N}*`~"(“]+/u, "");
  let title: string, rest: string;
  const b = t.match(/^\*\*(.+?)\*\*\s*(.*)$/);
  if (b) { title = b[1]; rest = b[2]; } else {
    const k = t.search(/\s[—–]\s/);
    title = k > 0 ? t.slice(0, k) : t;
    rest = k > 0 ? t.slice(k + 3) : "";
  }
  title = clean(title).replace(/[:.\s]+$/, "").replace(/\s*\((?:[^)]*\d{4}-\d\d-\d\d[^)]*)\)$/, "").replace(/[:.\s]+$/, "");
  rest = clean(rest.replace(/^\s*\((?:[^)]*\d{4}-\d\d-\d\d[^)]*)\)\s*/, "")).replace(/^[—–:\s-]+/, "");
  return { title, rest, text: t, waiting: waitingList(t) };
}
/** "Waiting on Alex: a, b (c, d), e." as its items, up to the next labelled sentence ("Runbooks: …"). */
export function waitingList(text: string): string[] {
  const m = text.match(new RegExp(`\\*{0,2}Waiting on ${OWNER}\\*{0,2}\\s*[:.]?\\s*\\*{0,2}\\s*:?\\s*(.+)$`, "i"));
  if (!m) return [];
  let s = m[1];
  const stop = s.search(/\.\s+(?=[A-Z][\w ]{0,24}:|Runbooks?\b|Detail\b|See\b|Owning\b|Record\b|Evidence\b|Status\b)/);
  if (stop >= 0) s = s.slice(0, stop);
  s = s.replace(/[.\s]+$/, "");
  const parts = /\(\d\)/.test(s) ? s.split(/\s*\(\d+\)\s*/).filter(Boolean) : splitTop(s, /[,;]/);
  return parts.map((p) => cap(cut(clean(p).replace(/^(?:and|or|then)\s+/i, "").replace(/[;,.\s]+$/, ""), 110))).filter((p) => p.length > 2).slice(0, 10);
}

// ── matching NOW.md to a client: its slug, names and product, as whole words ──────────────────────────────────
// Names only: product names (ShopBrain, Atlas ERP) belong to the company, and a surname (Morgan) to the family.
const STOP = new Set(["business", "shop", "sons", "pilot", "client", "clients", "store", "legacy", "service", "website", "brand", "northwind", "morgan", "dad business", OWNER.toLowerCase()]);
const GENERIC_TAIL = new Set(["shop", "store", "sons", "co", "business", "traders", "enterprises", "house", "centre", "center", "mart"]);
export function aliasesOf(slug: string, names: string[]) {
  const out = new Set<string>();
  const add = (s: string) => { const a = s.toLowerCase().replace(/[’']s\b/g, "").replace(/\s+/g, " ").trim(); if (a.length >= 4 && !STOP.has(a)) out.add(a); };
  add(slug.replace(/-/g, " "));
  // "dad-shop" is also "dad"; "free-club" is not "free"
  const [head, ...tail] = slug.split("-");
  if (tail.length && tail.every((w) => GENERIC_TAIL.has(w))) add(head);
  for (const n of names.filter(Boolean)) for (const part of clean(n).split(/[()/]|\bhistorically\b|\bformerly\b|,/i)) add(part.trim());
  return [...out];
}
const has = (text: string, aliases: string[]) => aliases.some((a) => new RegExp(`(^|[^\\p{L}\\p{N}])${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text));
/** "BrightMark OS: Alex must create the client" reads as an instruction: "BrightMark OS: Create the client". */
function asStep(t: string) {
  const i = t.indexOf(": ");
  const [pre, rest] = i > 0 ? [t.slice(0, i), t.slice(i + 2)] : ["", t];
  const r = rest.replace(new RegExp(`^(?:${OWNER}|you)\\s+(?:must|needs? to|has to|should|will|is to)\\s+`, "i"), "");
  const out = r === rest ? rest : cap(r);
  return pre ? `${pre}: ${out}` : out;
}
const MONEY = /\b(pay|paid|payment|invoice|quote|price|fee)\b|₹/i;
/** A work-log title that records money changing hands (not "payment method", not "pricing ruled"). */
const LEDGER = /\b(paid|payment (?:correction|received|status|made|done)|invoice[ds]?|earned|received)\b/i;
const COMMON = ["the", "and", "for", "with", "from", "client", OWNER.toLowerCase()];
const words = (s: string, skip: string[] = []) => new Set(clean(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3 && !COMMON.includes(w) && !skip.includes(w)));
/** Two items say the same thing when most words of the shorter one are in the longer one (the client's own name aside). */
function same(a: string, b: string, skip: string[] = []) {
  const A = words(a, skip), B = words(b, skip);
  const [s, l] = A.size <= B.size ? [A, B] : [B, A];
  if (!s.size) return false;
  let n = 0;
  for (const w of s) if (l.has(w)) n++;
  return n / s.size >= 0.8;
}

// ── one client's files ─────────────────────────────────────────────────────────────────────────────────────────
export function healthOf(dossier: string | null): { light: string; note: string } | null {
  const h = section(dossier, /^health\b/i);
  if (h == null) return null;
  const e = h.match(/🟢|🟡|🔴/g) ?? [];
  const kinds = new Set(e.map((x) => (x === "🟢" ? "green" : x === "🟡" ? "yellow" : "red")));
  let light: string | null = kinds.size === 1 ? [...kinds][0] : null;
  if (!light && !e.length) {
    const w = new Set([...h.matchAll(/\b(green|yellow|amber|red)\b/gi)].map((m) => (m[1].toLowerCase() === "amber" ? "yellow" : m[1].toLowerCase())));
    if (w.size === 1) light = [...w][0];
  }
  if (!light) return null;
  const note = sentence(h.replace(/🟢|🟡|🔴/g, "").replace(/^[\s—–:-]+/, ""), 140);
  return { light, note };
}
/** The dossier's Commercials: table rows as label and value, bullets as unlabelled notes, one sentence each.
 *  Blank template cells (an empty value, a lone ₹, a {placeholder}) are left out. */
export function commercialsOf(dossier: string | null): { label: string; value: string }[] | null {
  const s = section(dossier, /^commercials\b/i);
  if (s == null) return null;
  const out: { label: string; value: string }[] = [];
  for (const r of tables(s)[0] ?? []) {
    const cells = Object.values(r);
    const label = clean(r.field ?? cells[0] ?? "").replace(/\s*\(.*\)\s*$/, "");
    const value = clean(r.value ?? cells[1] ?? "");
    // a lone "n/a" or "none" says nothing ("none on record" or "none — a spec build" does)
    if (!label || !value || /^₹?$/.test(value) || /^(n\/a|none|-|—)\.?$/i.test(value) || placeholder(value)) continue;
    out.push({ label: cap(label), value: sentence(value, 150) });
  }
  for (const b of bullets(s)) if (!placeholder(b) && clean(b)) out.push({ label: "", value: sentence(b, 150) });
  return out.length ? out.slice(0, 6) : null;
}
/** The "> stage: … · package: … · since: …" line of an OS card, as a map; template values come back empty. */
export function stageLine(md: string | null): Record<string, string> | null {
  const m = md?.match(/^>\s*(stage:.*)$/m);
  if (!m) return null;
  const out: Record<string, string> = {};
  for (const kv of m[1].split(/\s+·\s+/)) {
    const i = kv.indexOf(":");
    if (i > 0) { const v = kv.slice(i + 1).trim(); out[kv.slice(0, i).trim().toLowerCase()] = placeholder(v) ? "" : v; }
  }
  return out;
}
/** "active (build)" → active + build; "active, unpaid" → active + unpaid; "Atlas ERP/ShopBrain pilot" → pilot. */
export function stageOf(text: string | null | undefined): { stage: string; note: string } | null {
  const t = clean(text ?? "");
  if (!t || placeholder(t)) return null;
  const m = t.match(/\b(onboarding|pilot|active|paused|churned|lead|new|warming|pitched|negotiating|snoozed|dead)\b/i);
  if (!m) return null;
  const note = t.replace(m[0], "").replace(/[()]/g, " ").replace(/^[\s,;:·—–-]+|[\s,;:·—–-]+$/g, "").replace(/\s+/g, " ");
  return { stage: m[1].toLowerCase(), note };
}
export function flowsOf(md: string | null, dir: string): Flow[] | null {
  const s = section(md, /^opted[- ]in workflows?/i);
  if (s == null) return null;
  const out: Flow[] = [];
  for (const l of s.split("\n")) {
    const m = l.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (!m || placeholder(m[2])) continue;
    const t = m[2];
    const k = t.search(/\s[—–]\s|:\s/);
    const raw = clean(k > 0 ? t.slice(0, k) : t).replace(/[:.\s]+$/, "");
    // a workflow named like its folder (website-build) reads as words; the folder shows under it
    const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(raw);
    const name = cap(kebab ? raw.replace(/-/g, " ") : raw);
    const rest = k > 0 ? t.slice(k).replace(/^\s*[—–:]\s*/, "") : "";
    const status = m[1] !== " " ? "done" : /\bpaused\b|\bon hold\b/i.test(rest) ? "paused" : /setting up/i.test(rest) ? "setting up"
      : new RegExp(`waiting on (?:${OWNER}|you)|verdict|awaiting (?:${OWNER}|you)`, "i").test(rest) ? "waiting on you" : "running";
    const pointer = [...t.matchAll(/`([a-z0-9][a-z0-9-]*)\/[^`]*`/g)].map((x) => x[1]).find((f) => isDir(join(dir, f)));
    const folder = SLUG.test(raw) && isDir(join(dir, raw)) ? raw : pointer ?? null;
    out.push({ name, status, folder, detail: rest ? sentence(rest, 110) : "" });
  }
  return out;
}
export function keyDatesOf(md: string | null, today: string): KeyDate[] | null {
  const s = section(md, /^key dates/i);
  if (s == null) return null;
  const out: KeyDate[] = [];
  for (const r of tables(s)[0] ?? []) {
    const what = cap(clean(r.what ?? Object.values(r)[0] ?? "")), raw = clean(r.when ?? Object.values(r)[1] ?? "");
    if (!what || placeholder(what) || placeholder(raw) || /superseded|cancelled|dropped|\bdone\b/i.test(raw)) continue;
    const iso = isoOf(raw);
    let when: string, tone = "";
    if (/\basap\b/i.test(raw)) { when = "ASAP"; tone = "late"; }
    else if (/\btoday\b/i.test(raw)) { when = "Today"; tone = "late"; }
    else if (iso) { const d = days(today, iso); when = d >= 0 ? dueLabel(iso, today) : dayMon(iso); tone = d === 0 ? "late" : d < 0 ? "quiet" : ""; }
    else if (unknown(raw)) { when = "Unknown"; tone = "quiet"; }
    else if (/not scheduled/i.test(raw)) { when = "Not scheduled"; tone = "quiet"; }
    else { when = cut(raw.split(/[;—–]/)[0].trim(), 32); tone = "quiet"; }
    out.push({ what, when, iso, tone });
  }
  return out;
}
const normPay = (s: string) => (/partial/i.test(s) ? "partial" : /\bpaid\b|received/i.test(s) ? "paid" : /due|owed|unpaid|pending|not paid/i.test(s) ? "due" : "none");
const AMOUNT = /(?:≈\s*)?₹\s?[\d,]+(?:\.\d+)?\s?(?:L|lakh|k)?\b|not set|price not set/i;
export function paymentsOf(md: string | null) {
  if (!md || blankTemplate(md)) return null;
  const t = tables(md).find((x) => "amount" in x[0] && "status" in x[0]);
  const line = md.match(/\*\*Outstanding:?\*\*:?\s*([^\n]+)/i)?.[1] ?? "";
  if (!t && !line) return null;
  const rows: Pay[] = (t ?? []).filter((r) => !placeholder(Object.values(r).join(" ")))
    .map((r) => ({ date: isoOf(r.date) ?? clean(r.date), what: clean(r.what), amount: clean(r.amount), status: normPay(r.status ?? ""), note: sentence(r.note ?? "", 120) }));
  const outstanding = clean(line).match(AMOUNT)?.[0]?.replace(/\s+/g, " ").trim() ?? null;
  return { rows, outstanding, asOf: isoOf(line) ?? rows.map((r) => isoOf(r.date)).filter(Boolean).sort().at(-1) ?? null };
}
const rupees = (s: string) => { const m = String(s).replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s?(L|lakh|k)?\b/i); if (!m) return null; const n = +m[1]; return /^l/i.test(m[2] ?? "") ? n * 1e5 : /^k/i.test(m[2] ?? "") ? n * 1e3 : n; };
export function contractOf(md: string | null) {
  if (!md || blankTemplate(md)) return null;
  const k = keyed(md);
  const val = (x?: string) => (x && !placeholder(x) ? cut(clean(x).replace(/[.\s]+$/, ""), 140) : null);
  const deliverables = k.deliverables && !placeholder(k.deliverables) ? splitTop(clean(k.deliverables).replace(/[.\s]+$/, ""), /[·;]/).map((x) => cut(cap(x), 90)).slice(0, 8) : null;
  const out = { term: val(k.term), deliverables, payment: val(k["payment terms"] ?? k.payment), package: val(k.package), note: sentence(md.split("\n").find((l) => /^\*\*[^*]+\*\*\s*$/.test(l.trim())) ?? "", 120) };
  return out.term || out.deliverables || out.payment ? out : null;
}
export function goalsOf(md: string | null) {
  if (!md || blankTemplate(md)) return null;
  const out: string[] = [];
  for (const re of [/^their words/i, /^real needs/i]) for (const b of bullets(section(md, re))) if (!placeholder(b) && !/^(nothing|none|no )/i.test(clean(b)) && !unknown(b)) out.push(sentence(b, 150));
  for (const r of tables(section(md, /^agreed targets/i))[0] ?? []) {
    const t = clean(r.target ?? ""), g = clean(r.goal ?? "");
    if (t && !placeholder(t) && g && !unknown(g)) out.push(`${cap(t)}: ${g}`);
  }
  return out.length ? out.slice(0, 5) : null;
}
const ENTRY = /^(\d{4}-\d\d-\d\d)(?:\s*\(([^)]*)\))?\s*(?:[—–:]|-{1,2})\s*(.+)$/;
export function worklogOf(md: string | null): Entry[] | null {
  if (!md) return null;
  const out: (Entry & { i: number })[] = [];
  sections(md).forEach((s, i) => {
    const m = s.level === 2 && clean(s.title).match(ENTRY);
    if (!m) return;
    const para = s.body.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !/^>/.test(p)) ?? "";
    out.push({ date: m[1], qualifier: m[2] ?? "", title: cap(m[3].trim()), body: sentence(para.split("\n")[0], 170), i });
  });
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.i - a.i).map(({ i, ...e }) => e);
}
/** Things the client owes the work, where a file says so outright ("Owner inputs remain: a, b and c."). */
function theirsOf(...texts: (string | null)[]) {
  for (const t of texts) {
    const m = t?.match(/\b(?:owner inputs remain|waiting on (?:the client|them|the owner)|they still owe)\s*:?\s*([^.\n]+)\./i);
    if (m) return splitTop(m[1].replace(/\s+and\s+(?=[^,]*$)/, ", "), /[,;]/).map((x) => cap(clean(x))).filter((x) => x.length > 2).slice(0, 8);
  }
  return null;
}
const productOf = (s?: string) => { if (!s) return null; const b = s.match(/\*\*([^*]+)\*\*/)?.[1]; const t = clean(b ?? s); const c = t.includes(":") ? t.split(":").slice(1).join(":") : t; const out = cap(c.replace(/\s*\(.*\)\s*$/, "").trim()); return out && !unknown(out) ? out : null; };
const monoOf = (name: string) => name.split(/\s+/).filter((w) => /^[\p{L}\p{N}]/u.test(w) && !/^(and|of|the)$/i.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

export type Client = ReturnType<typeof buildClient>;
type Ctx = { brain: string; os: string; today: string; now: ReturnType<typeof readNow>; issues: Issue[] };
function buildClient(row: PipeRow, c: Ctx) {
  const { slug } = row;
  const snap = SNAPSHOT[slug];
  const src: Src = {};
  const bDir = join(c.brain, "clients", slug), oDir = join(c.os, "clients", slug);
  const hasBrain = isDir(bDir), hasOs = isDir(oDir);
  const dossier = hasBrain ? readText(join(bDir, "dossier.md")) : null;
  const log = hasBrain ? readText(join(bDir, "work-log.md")) : null;
  const idx = hasOs ? readText(join(oDir, "index.md")) : null;
  const pay = hasOs ? readText(join(oDir, "payments.md")) : null;
  const con = hasOs ? readText(join(oDir, "contract.md")) : null;
  const gl = hasOs ? readText(join(oDir, "goals.md")) : null;
  const from = <T,>(key: string, file: string, v: T | null | undefined, fallback: T): T => { if (v != null) { src[key] = file; return v; } src[key] = "snapshot"; return fallback; };
  const blank = <T,>(): T => (undefined as unknown as T);

  // labels
  const fileName = clean(title1(idx).split(/\s[—–]\s/)[0] || title1(dossier).split(/\s[—–]\s/)[0]).replace(/\s*\(.*\)\s*$/, "");
  const name = snap?.name ?? (fileName || cap(slug.replace(/-/g, " ")));
  src.name = snap ? "snapshot" : fileName ? (idx ? "index.md" : "dossier.md") : "slug";
  const free = row.group === "free";
  const kind = snap?.kind ?? "client";
  const freeNote = free ? snap?.freeNote ?? (sentence(row.notes ?? "", 80).replace(/[.\s]+$/, "") || "Not a paying client") : undefined;
  const product = productOf(row.product) ?? snap?.product ?? "";
  src.product = productOf(row.product) ? "_pipeline.md" : "snapshot";

  // stage: the OS card first (the live card), then the board, then NOW.md's table
  const card = stageLine(idx);
  const fromCard = stageOf(card?.stage), fromBoard = stageOf(row.stage), fromNow = stageOf(c.now.active.get(slug)?.stage);
  const st = fromCard ?? fromBoard ?? fromNow;
  if (fromCard && fromBoard && fromCard.stage !== fromBoard.stage) c.issues.push({ kind: "stage-mismatch", slugs: [slug], text: `${name}: the OS card says ${fromCard.stage}, the board says ${fromBoard.stage}`, files: [`studio-os\\clients\\${slug}\\index.md`, "studio-brain\\clients\\_pipeline.md"] });
  const stage = from("stage", fromCard ? "index.md" : fromBoard ? "_pipeline.md" : "NOW.md", st?.stage, snap?.stage ?? "active");
  const stageNote = st ? (st.note || (fromBoard && fromBoard.stage === st.stage ? fromBoard.note : "") || "") : snap?.stageNote ?? "";
  const since = from("since", sinceOf(card?.since) ? "index.md" : "_pipeline.md", sinceOf(card?.since) ?? sinceOf(row.since), snap?.since ?? "");
  const summary = from("summary", "_pipeline.md", row.notes ? cut(clean(row.notes), 220) : clean(idx?.match(/\*\*One line:?\*\*:?\s*(.+)/i)?.[1] ?? "") ? cut(clean(idx!.match(/\*\*One line:?\*\*:?\s*(.+)/i)![1]), 220) : null, snap?.summary ?? "");
  const h = healthOf(dossier);
  const health = from("health", "dossier.md", h?.light, snap?.health ?? "green");

  // NOW.md: the loops and decisions that name this client
  const aliases = aliasesOf(slug, [name, fileName, title1(dossier).split(/\s[—–]\s/)[0]]);
  const skip = aliases.flatMap((a) => a.split(/\s+/));
  // on the client's own page "BrightMark: the bar site is unnamed" reads "The bar site is unnamed"
  const own = new RegExp(`^(?:${aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*[:—–]\\s+`, "i");
  const local = (t: string) => cap(t.replace(own, ""));
  const loops = c.now.loops.filter((l) => has(l.title, aliases));
  const decisions = c.now.decisions.filter((d) => has(d.text, aliases));
  const keyDates = hasOs ? keyDatesOf(idx, c.today) : null;
  const intent = (() => {
    for (const s of clean(c.now.active.get(slug)?.notes ?? "").split(/(?<=[.!?])\s+/)) {
      const m = s.match(new RegExp(`\\b(?:${OWNER}|you)\\s+(?:will|must|needs? to|has to|should|is to)\\s+(.+?)[.!]?$`, "i"));
      if (m) return cap(m[1]);
    }
    return null;
  })();
  const ranked = [...loops].sort((a, b) => Number(MONEY.test(b.title)) - Number(MONEY.test(a.title)));
  // a key date asks first when it says ASAP or today, or falls in the coming week
  const dated = (keyDates ?? []).filter((k) => k.tone === "late" || (k.iso && days(c.today, k.iso) >= 0 && days(c.today, k.iso) <= 7)).sort((a, b) => (a.when === "ASAP" ? -1 : b.when === "ASAP" ? 1 : String(a.iso).localeCompare(String(b.iso))))[0];
  let next: { text: string; due: string; owner: string } | null = null;
  if (dated) { next = { text: dated.what, due: dated.when, owner: "you" }; src.next = "index.md"; }
  else if (intent) { next = { text: intent, due: "No date", owner: "you" }; src.next = "NOW.md"; }
  else if (ranked.length) { next = { text: ranked[0].waiting[0] ?? local(asStep(ranked[0].title)), due: "No date", owner: "you" }; src.next = "NOW.md"; }
  if (!next) { next = snap?.next ?? { text: "Nothing on record", due: "No date", owner: "you" }; src.next = "snapshot"; }

  // waiting on you: decisions that name them, then the loops (their "Waiting on Alex" items, else the loop)
  const you: { text: string; detail?: string; from: string }[] = [];
  const addYou = (text: string, detail = "", f = "NOW.md") => { if (text && !same(text, next!.text, skip) && !you.some((x) => same(x.text, text, skip))) you.push({ text, detail, from: f }); };
  for (const d of decisions) addYou(`${d.title} (open decision ${d.n})`, "", "NOW.md · open decisions");
  for (const l of ranked) { if (l.waiting.length) l.waiting.forEach((w) => addYou(w, local(l.title))); else addYou(local(asStep(l.title)), sentence(l.rest, 110)); }
  const them = theirsOf(dossier, idx, c.now.active.get(slug)?.notes ?? null);
  const nowOk = c.now.ok;
  const waitingOn = {
    you: nowOk ? you.slice(0, 12) : (snap?.waitingOn.you ?? []).map((t) => ({ text: t, detail: "", from: "snapshot" })),
    them: them ?? (dossier ? [] : snap?.waitingOn.them ?? []),
  };
  src.waitingYou = nowOk ? "NOW.md" : "snapshot";
  src.waitingThem = them ? "dossier.md" : dossier ? "dossier.md" : "snapshot";

  // money, workflows, dates, contract, goals: the OS folder, else the snapshot
  const p = paymentsOf(pay);
  const moneyRows = p?.rows ?? snap?.money.rows ?? [];
  const dueRows = moneyRows.filter((r) => r.status === "due" || r.status === "partial");
  const outstanding = p ? (p.outstanding ?? (dueRows.length ? dueRows.map((r) => r.amount).join(" + ") : "₹0")) : snap?.money.outstanding ?? "₹0";
  const owes = dueRows.length > 0 || (rupees(outstanding) ?? 0) > 0;
  const money = { outstanding, state: owes ? "due" : moneyRows.some((r) => r.status === "paid") ? "paid" : "none", rows: moneyRows, asOf: p?.asOf ?? null };
  src.money = p ? "payments.md" : "snapshot";
  const workflows = from("workflows", "index.md", hasOs ? flowsOf(idx, oDir) : null, snap?.workflows ?? []);
  const keyDatesV = from("keyDates", "index.md", keyDates, snap?.keyDates ?? []);
  const cParsed = contractOf(con);
  const contract = {
    term: from("contract.term", "contract.md", cParsed?.term, snap?.contract.term ?? ""),
    deliverables: from("contract.deliverables", "contract.md", cParsed?.deliverables, snap?.contract.deliverables ?? []),
    payment: from("contract.payment", "contract.md", cParsed?.payment, snap?.contract.payment ?? ""),
    note: cParsed?.note ?? "",
  };
  const goals = from("goals", "goals.md", goalsOf(gl), snap?.goals ?? []);
  const commercials = commercialsOf(dossier) ?? [];
  src.commercials = commercials.length ? "dossier.md" : "none";
  const entries = worklogOf(log);
  const logAll = from("log", "work-log.md", entries, snap?.log ?? blank());

  // blank OS templates and a ledger the brain has moved past are worth saying
  const unfilled = [["contract.md", con], ["goals.md", gl], ["payments.md", pay]].filter(([, md]) => blankTemplate(md as string | null)).map(([f]) => f as string);
  const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
  if (unfilled.length) c.issues.push({ kind: "template-unfilled", slugs: [slug], files: unfilled.map((f) => `studio-os\\clients\\${slug}\\${f}`), text: `${name}: ${and(unfilled)} ${unfilled.length === 1 ? "is" : "are"} still the blank template` });
  const payNote = (entries ?? []).find((e) => LEDGER.test(e.title));
  if (p?.asOf && payNote && payNote.date > p.asOf) c.issues.push({ kind: "ledger-behind", slugs: [slug], files: [`studio-os\\clients\\${slug}\\payments.md`], text: `${name}: the work log has a payment note from ${dayMon(payNote.date)}; payments.md was last balanced ${dayMon(p.asOf)}` });

  return {
    slug, name, mono: snap?.mono ?? monoOf(name), kind, ownerNote: snap?.ownerNote, freeNote, free, product, package: snap?.package ?? cap(clean(card?.package ?? "").split(/\s[(—–]/)[0]),
    stage, stageNote, since, health, healthNote: h?.note ?? "", summary, next, waitingOn, money, workflows, keyDates: keyDatesV,
    log: logAll, logCount: logAll.length, contract, commercials, goals,
    osFolder: hasOs ? `studio-os\\clients\\${slug}` : null, brainFolder: hasBrain ? `studio-brain\\clients\\${slug}` : null,
    osPath: hasOs ? oDir : null, brainPath: hasBrain ? bDir : null,
    files: { os: hasOs ? listing(oDir) : [], brain: hasBrain ? listing(bDir) : [] },
    projects: snap?.projects ?? [], src,
  };
}

// ── leads: studio-os/sales/<slug> ─────────────────────────────────────────────────────────────────────────────
const warmthOf = (s: string) => (/^cold/i.test(s) ? "cold" : /hot|ready|pricing/i.test(s) ? "hot" : /warm|hint/i.test(s) ? "warm" : null);
function buildLead(slug: string, c: Ctx, onBoard: boolean) {
  const dir = join(c.os, "sales", slug);
  const idx = readText(join(dir, "index.md")), pot = readText(join(dir, "potential.md")), pit = readText(join(dir, "pitch.md"));
  const snap = SNAPSHOT_LEADS[slug];
  const src: Src = {};
  const st = stageLine(idx);
  const name = clean(title1(idx).split(/\s[—–]\s/)[0]) || snap?.name || cap(slug.replace(/-/g, " "));
  const kv = keyed(idx);
  const touchRaw = clean(idx?.match(/next-touch:\s*([^\n]+)/i)?.[1] ?? "").replace(/←.*$/, "").replace(/\*+/g, "").trim();
  const tIso = isoOf(touchRaw);
  const tWhat = touchRaw.split(/\s[—–]\s/).slice(1).join(" — ").trim();
  let nextTouch: { text: string; set: boolean; iso: string | null; what: string };
  if (tIso) nextTouch = { text: `${dueLabel(tIso, c.today)}${tWhat && !placeholder(tWhat) ? ` · ${cap(tWhat)}` : ""}`, set: true, iso: tIso, what: placeholder(tWhat) ? "" : tWhat };
  else nextTouch = { text: idx ? "Not set (ask)" : snap?.nextTouch ?? "Not set (ask)", set: false, iso: null, what: "" };
  src.nextTouch = idx ? "index.md" : "snapshot";
  const warmText = clean(kv.warmth ?? "").split(/\s[—–]\s/)[0];
  const warmth = idx ? warmthOf(warmText) ?? "unknown" : snap?.warmth ?? "unknown";
  src.warmth = idx ? "index.md" : "snapshot";
  const pk = keyed(pot), ck = keyed(pit);
  const potentialText = [pk["deal size guess"], pk["likely entry product"]].map((x) => clean(x ?? "").split(/\s·\s/)[0]).find((x) => x && !unknown(x));
  const potential = pot ? cap(potentialText ?? "Unknown") : snap?.potential ?? "Unknown";
  const pitch = pit ? (ck.angle && !unknown(ck.angle) ? "Drafted" : "Not started") : snap?.pitch ?? "Not started";
  const oneLine = clean(idx?.match(/\*\*One line:?\*\*:?\s*(.+)/i)?.[1] ?? "");
  const stage = stageOf(st?.stage)?.stage ?? snap?.stage ?? "new";
  src.stage = st?.stage ? "index.md" : "snapshot";
  return {
    slug, name, mono: snap?.mono ?? monoOf(name), kind: "lead" as const, stage, warmth, warmthText: warmText && !unknown(warmText) ? warmText : "",
    nextTouch, potential, pitch, source: st?.source && !unknown(st.source) ? clean(st.source) : "", since: sinceOf(st?.since) ?? snap?.since ?? "",
    note: oneLine && !unknown(oneLine) ? sentence(oneLine, 160) : snap?.note ?? "", onBoard,
    osFolder: `studio-os\\sales\\${slug}`, osPath: dir, files: listing(dir), src,
  };
}

// ── workflows: WORKFLOWS.md's catalog, with what skills/ has built ────────────────────────────────────────────
export function readWorkflows(md: string | null, skillsDir: string) {
  const skills = new Set(slugDirs(skillsDir).filter((d) => isFile(join(skillsDir, d, "SKILL.md"))));
  const rows = tables(section(md, /^the catalog/i) ?? "").find((t) => "workflow" in t[0]) ?? [];
  type W = { id: string; name: string; line: string; built: boolean; spec: boolean; for: "client" | "lead"; needsOk: boolean; dept: string };
  const out: W[] = [];
  let dept = "";
  for (const r of rows) {
    if (clean(r.dept)) dept = clean(r.dept);
    const status = clean(r.status ?? "");
    const lead = /^sales/i.test(dept), agency = /\baudit\b|content engine|\bads\b|retention/i.test(dept);
    for (const part of splitTop(r.workflow ?? "", /[→·+]/)) {
      const c = clean(part);
      const id = c.match(/^([a-z0-9][a-z0-9-]*)/)?.[1];
      if (!id) continue;
      const paren = c.match(/\(([^)]+)\)/)?.[1] ?? "";
      const specText = section(md, new RegExp(`^\\d+\\.\\s+${id}\\b`, "i"));
      const specLine = specText ? cut(clean(bullets(specText)[0] ?? "").split(/\s[—–]\s/)[0].replace(/^Captain's spec[^:]*:\s*/i, ""), 80) : "";
      out.push({
        id, name: FLOW_LABELS[id]?.name ?? cap(id.replace(/-/g, " ")), line: FLOW_LABELS[id]?.line ?? (/\s/.test(paren) ? cap(paren) : specLine),
        built: skills.has(id) || /\bBUILT\b/.test(status), spec: /spec'?d/i.test(status) || !!specText, for: lead ? "lead" : "client",
        needsOk: agency, dept: dept.replace(/\s*\(.*\)/, ""),
      });
    }
    // a skill named only in a status cell (step 0 `web-client-intake`) belongs to that row's department
    for (const m of status.matchAll(/\b([a-z]+(?:-[a-z]+)+)\b/g)) {
      const id = m[1];
      if (skills.has(id) && !out.some((w) => w.id === id)) out.push({ id, name: FLOW_LABELS[id]?.name ?? cap(id.replace(/-/g, " ")), line: FLOW_LABELS[id]?.line ?? "", built: true, spec: true, for: lead ? "lead" : "client", needsOk: false, dept: dept.replace(/\s*\(.*\)/, "") });
    }
  }
  for (const id of skills) if (!out.some((w) => w.id === id)) out.push({ id, name: FLOW_LABELS[id]?.name ?? cap(id.replace(/-/g, " ")), line: FLOW_LABELS[id]?.line ?? "", built: true, spec: true, for: /lead/.test(id) ? "lead" : "client", needsOk: false, dept: "" });
  if (!out.length) return { ok: false, list: SNAPSHOT_FLOWS.map((w) => ({ ...w, ...FLOW_LABELS[w.id], spec: true, needsOk: !!w.needsOk, dept: "" })) };
  return { ok: true, list: out };
}

// ── the whole system, read once ────────────────────────────────────────────────────────────────────────────────
export type Issue = { kind: string; text: string; slugs?: string[]; files?: string[] };
export function readSystem(dirs: { brain: string; os: string }, today = todayIST()) {
  const issues: Issue[] = [];
  const brainFound = isDir(dirs.brain), osFound = isDir(dirs.os);
  if (!brainFound) issues.push({ kind: "no-brain", text: `studio-brain isn't at ${dirs.brain}, so clients show the ${SNAPSHOT_AT} snapshot` });
  if (!osFound) issues.push({ kind: "no-os", text: `studio-os isn't at ${dirs.os}, so money, contracts and goals show the ${SNAPSHOT_AT} snapshot` });
  const pipe = readPipeline(brainFound ? readText(join(dirs.brain, "clients", "_pipeline.md")) : null);
  const now = readNow(brainFound ? readText(join(dirs.brain, "NOW.md")) : null);
  if (brainFound && !pipe.ok) issues.push({ kind: "unreadable", files: ["studio-brain\\clients\\_pipeline.md"], text: "The board (_pipeline.md) has no client tables, so the roster is the snapshot's" });
  if (brainFound && !now.ok) issues.push({ kind: "unreadable", files: ["studio-brain\\NOW.md"], text: "NOW.md couldn't be read, so next steps and waiting-on come from the snapshot" });
  const c: Ctx = { ...dirs, today, now, issues };
  const rows: PipeRow[] = pipe.ok ? [...pipe.rows] : [
    ...Object.keys(SNAPSHOT).map((slug) => ({ slug, group: (SNAPSHOT[slug].freeNote ? "free" : "client") as Group })),
    ...Object.keys(SNAPSHOT_RETIRED).map((slug) => ({ slug, group: "retired" as Group })),
  ];
  // an OS client folder the board doesn't list still shows, and says so
  const osClients = osFound ? slugDirs(join(dirs.os, "clients")) : [];
  for (const s of osClients) if (!rows.some((r) => r.slug === s)) { rows.push({ slug: s, group: "client" }); issues.push({ kind: "not-on-board", slugs: [s], text: `${s}: an OS folder but no row on the board` }); }
  const clients = rows.filter((r) => r.group === "client" || r.group === "free" || r.group === "off").map((r) => buildClient(r, c));
  const missingOs = clients.filter((x) => !x.osFolder && osFound).map((x) => x.slug);
  if (missingOs.length) issues.unshift({ kind: "missing-os-folder", slugs: missingOs, text: `${missingOs.length} client${missingOs.length === 1 ? " has" : "s have"} no OS folder yet` });
  const missingBrain = clients.filter((x) => !x.brainFolder && brainFound).map((x) => x.slug);
  if (missingBrain.length) issues.push({ kind: "missing-brain-folder", slugs: missingBrain, text: `${missingBrain.length} client${missingBrain.length === 1 ? " has" : "s have"} no brain folder` });
  const retired = rows.filter((r) => r.group === "retired").map((r) => ({ slug: r.slug, name: SNAPSHOT_RETIRED[r.slug]?.name ?? cap(r.slug.replace(/-/g, " ")), note: r.notes ? sentence(r.notes, 80).replace(/[.\s]+$/, "") : SNAPSHOT_RETIRED[r.slug]?.note ?? "Retired" }));
  const boardLeads = rows.filter((r) => r.group === "lead").map((r) => r.slug);
  const leadSlugs = osFound ? slugDirs(join(dirs.os, "sales")) : Object.keys(SNAPSHOT_LEADS);
  for (const s of boardLeads) if (!leadSlugs.includes(s)) leadSlugs.push(s);
  const leads = leadSlugs.map((s) => buildLead(s, c, boardLeads.includes(s)));
  const offBoard = leads.filter((l) => !l.onBoard && pipe.ok).map((l) => l.slug);
  if (offBoard.length) issues.push({ kind: "lead-not-on-board", slugs: offBoard, text: `${offBoard.map((s) => leads.find((l) => l.slug === s)!.name).join(", ")}: in studio-os\\sales but not on the board` });
  // the stage lists are the templates' own ("> stage: {onboarding | active | …}") plus the board's header line
  const tplStages = (kind: string) => ((osFound ? readText(join(dirs.os, "_templates", kind, "index.md")) : null)?.match(/^>\s*stage:\s*\{([^}]+)\}/m)?.[1] ?? "")
    .split("|").map((x) => x.trim().toLowerCase()).filter((x) => /^[a-z-]+$/.test(x));
  const fileStages = new Set([...tplStages("client"), ...pipe.stages.filter((x) => x !== "lead")]);
  const clientStages = [...CLIENT_STAGE_ORDER.filter((s) => fileStages.has(s) || !fileStages.size), ...[...fileStages].filter((s) => !CLIENT_STAGE_ORDER.includes(s))];
  const leadStagesF = tplStages("lead");
  const flows = readWorkflows(osFound ? readText(join(dirs.os, "WORKFLOWS.md")) : null, join(dirs.os, "skills"));
  if (osFound && !flows.ok) issues.push({ kind: "unreadable", files: ["studio-os\\WORKFLOWS.md"], text: "WORKFLOWS.md has no catalog table, so workflows are the snapshot's" });
  return {
    at: new Date().toISOString(), today, brainFound, osFound, brainDir: dirs.brain, osDir: dirs.os,
    clients, leads, retired, issues, workflows: flows.list,
    stages: { client: clientStages, lead: leadStagesF.length ? leadStagesF : LEAD_STAGES, off: OFF_PATH },
  };
}
type System = ReturnType<typeof readSystem>;

/** Money across clients, from the payment rows. Amounts are text in the files: "₹40,000", "≈ ₹20,000", "Not set". */
export function moneyOf(list: { money: { rows: Pay[] } }[]) {
  let paid = 0, due = 0, approx = false, unpriced = 0;
  for (const c of list) for (const r of c.money.rows) {
    const n = rupees(r.amount);
    if (r.status === "paid") paid += n ?? 0;
    else if (r.status === "due" || r.status === "partial") { if (n == null) unpriced++; else { due += n; if (/≈|~/.test(r.amount)) approx = true; } }
  }
  return { paid, due, approx, unpriced, billed: paid + due };
}

// ── the agentos side: linked projects and the client's window page, if it has one ──────────────────────────────
function decorate(ctx: ModCtx, list: System["clients"]) {
  let db: any = null;
  try { db = ctx.db(); } catch { return list; }
  let projects: Set<string> | null = null, windows = new Map<string, { active: boolean; link: boolean; projects: string[] }>();
  try { projects = new Set((db.query("SELECT slug FROM projects").all() as any[]).map((r) => String(r.slug))); } catch {}
  try {
    for (const w of db.query("SELECT c.slug, c.active, c.project_slugs, (SELECT count(*) FROM clients_tokens t WHERE t.client_slug = c.slug AND t.revoked_at IS NULL) AS links FROM clients_clients c").all() as any[]) {
      let ps: string[] = [];
      try { ps = JSON.parse(w.project_slugs ?? "[]"); } catch {}
      windows.set(String(w.slug), { active: !!w.active, link: w.links > 0, projects: ps });
    }
  } catch {}
  return list.map((c) => {
    const w = windows.get(c.slug);
    const ps = [...new Set([...c.projects, ...(w?.projects ?? [])])].filter((p) => !projects || projects.has(p));
    return { ...c, projects: ps, window: w ? { active: w.active, link: w.link } : null };
  });
}

let cache: { key: string; at: number; data: System } | null = null;
const TTL = 60_000;
export const _resetCache = () => { cache = null; };
function load(dirs: { brain: string; os: string }, fresh: boolean): System {
  const key = `${dirs.brain}|${dirs.os}`;
  if (!fresh && cache && cache.key === key && Date.now() - cache.at < TTL) return cache.data;
  let data: System;
  try { data = readSystem(dirs); } catch (e: any) {
    data = readSystem({ brain: join(dirs.brain, "\0missing"), os: join(dirs.os, "\0missing") });
    data.issues.unshift({ kind: "read-failed", text: `Reading the files failed (${String(e?.message ?? e).slice(0, 120)}), so this is the ${SNAPSHOT_AT} snapshot` });
  }
  cache = { key, at: Date.now(), data };
  return data;
}
const card = (c: System["clients"][number]) => { const { log, files, ...rest } = c; return { ...rest, log: log.slice(0, 3) }; };

export const crm: Module = {
  name: "crm",
  async handle(ctx) {
    if (!ctx.owner) return ctx.fail(403, "Owner only.");
    const p = ctx.path.replace(/\/+$/, "") || "/";
    const m = ctx.method;
    const dirs = roots(ctx.conf);
    const fresh = ctx.url.searchParams.get("fresh") === "1";
    const write = { on: canWrite(ctx.conf), why: canWrite(ctx.conf) ? "" : WRITE_OFF };

    if (p === "/overview" && m === "GET") {
      const s = load(dirs, fresh);
      const clients = decorate(ctx, s.clients);
      const health = { green: 0, yellow: 0, red: 0 } as Record<string, number>;
      clients.forEach((c) => { health[c.health] = (health[c.health] ?? 0) + 1; });
      return ctx.json(scrubDeep({
        clients: clients.map(card), leads: s.leads, retired: s.retired, stages: s.stages, workflows: s.workflows,
        money: moneyOf(clients), health, today: s.today, write, snapshotAt: SNAPSHOT_AT,
        sync: { at: s.at, source: "studio-os + studio-brain", brain: s.brainDir, os: s.osDir, found: { brain: s.brainFound, os: s.osFound }, issues: s.issues },
      }));
    }
    if (p === "/workflows" && m === "GET") return ctx.json(scrubDeep({ workflows: load(dirs, fresh).workflows }));
    let mm = p.match(/^\/clients\/([a-z0-9][a-z0-9-]*)$/);
    if (mm && m === "GET") {
      const s = load(dirs, fresh);
      const c = decorate(ctx, s.clients).find((x) => x.slug === mm![1]);
      if (!c) return ctx.fail(404, s.retired.some((r) => r.slug === mm![1]) ? "That client is retired; it has no page." : "No such client.");
      return ctx.json(scrubDeep({ client: c, write, today: s.today, sync: { at: s.at, issues: s.issues.filter((i) => !i.slugs || i.slugs.includes(c.slug)) } }));
    }
    mm = p.match(/^\/leads\/([a-z0-9][a-z0-9-]*)$/);
    if (mm && m === "GET") {
      const s = load(dirs, fresh);
      const l = s.leads.find((x) => x.slug === mm![1]);
      if (!l) return ctx.fail(404, "No such lead.");
      return ctx.json(scrubDeep({ lead: l, today: s.today, sync: { at: s.at } }));
    }
    mm = p.match(/^\/clients\/([a-z0-9][a-z0-9-]*)\/log$/);
    if (mm && m === "POST") {
      if (!write.on) return ctx.fail(403, WRITE_OFF);
      const slug = mm[1];
      const file = join(dirs.brain, "clients", slug, "work-log.md");
      if (!isFile(file)) return ctx.fail(404, `There's no work-log.md for ${slug} in studio-brain.`);
      const b = (await ctx.body().catch(() => ({}))) ?? {};
      let title = String(b.title ?? ""), body = String(b.body ?? "");
      if (!title.trim() && b.text) { const [t, ...rest] = String(b.text).split("\n"); title = t; body = rest.join("\n"); }
      title = title.replace(/\s+/g, " ").replace(/^#+\s*/, "").trim().slice(0, 120);
      body = body.replace(/\r\n?/g, "\n").trim().slice(0, 4000).replace(/^(\s*)#/gm, "$1\\#");
      if (title.length < 2) return ctx.fail(400, "Write what you did; the first line is the title.");
      let raw = "";
      try { raw = readFileSync(file, "utf8"); } catch {}
      const nl = raw.includes("\r\n") ? "\r\n" : "\n";
      const lead = !raw || raw.endsWith(`${nl}${nl}`) ? "" : raw.endsWith(nl) ? nl : `${nl}${nl}`;
      const date = todayIST();
      const text = `${lead}## ${date} — ${title}${nl}${body ? `${nl}${body.split("\n").join(nl)}${nl}` : ""}`;
      appendFileSync(file, text, "utf8");
      ctx.log(`work-log entry for ${slug}: ${title}`);
      cache = null;
      const s = load(dirs, true);
      const c = decorate(ctx, s.clients).find((x) => x.slug === slug);
      return ctx.json(scrubDeep({ ok: true, entry: { date, title, body: sentence(body, 170) }, client: c ?? null }), 201);
    }
    return null;
  },
};

// Money · reading a bank statement: CSV exports (HDFC, SBI, ICICI, Axis, Kotak, Paytm and the like), the text of a PDF
// (pdftotext, with the statement's password) or of scanned pages (OCR), or rows the Scan lens already found. Each row is
// matched against what is already logged (a UPI message, a receipt, his own entry: same amount, within a day), and the
// rest sorted: new spends with a category guess, money in, moves between his own pockets, subscriptions, and payments to
// a person that only he can explain. Nothing is filed here; fileImport() writes what he (or the agent) confirmed.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guessCat, looksLikeBill, looksLikeMove, isoAt, localDate, slug, addDays } from "../../app/js/aspects/money-calc.js";

export type Row = { date: string; desc: string; amount: number; dir: "dr" | "cr"; balance?: number | null };
export type Sorted = Row & {
  id: string; merchant: string; vpa: string | null; ref: string | null; rail: string; status: "new" | "matched" | "moved" | "sub" | "ask" | "income";
  category: string | null; match: string | null; why: string; person?: string | null;
};

// ── dates and amounts as banks print them ───────────────────────────────────────────────────────────────────────
const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const p2 = (n: number) => String(n).padStart(2, "0");
const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{1,2}[\s\-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s\-,]*\d{2,4})/i;
export function parseDate(s: string): string | null {
  const t = String(s ?? "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); const d = Number(m[1]), mo = Number(m[2]); return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${p2(mo)}-${p2(d)}` : null; }
  m = t.match(/^(\d{1,2})[\s\-]([a-z]{3,4})[a-z]*[\s\-,]*(\d{2,4})/i);
  if (m && MON[m[2].toLowerCase()]) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return `${y}-${p2(MON[m[2].toLowerCase()])}-${p2(Number(m[1]))}`; }
  return null;
}
export const amountOf = (s: unknown): number | null => {
  const t = String(s ?? "").replace(/[₹,\s]|INR|Rs\.?/gi, "").replace(/\((.*)\)/, "-$1");
  if (!t || !/^-?\d+(\.\d+)?(cr|dr)?$/i.test(t)) return null;
  const n = Math.abs(Number(t.replace(/(cr|dr)$/i, "")));
  return Number.isFinite(n) ? n : null;
};

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────────────────────
function splitCsv(line: string, sep: string): string[] {
  const out: string[] = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === sep && !q) { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}
export function parseCsv(text: string): { rows: Row[]; bank: string | null } {
  const lines = String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  const sep = [",", ";", "\t", "|"].map((s) => [s, (lines.slice(0, 30).join("\n").match(new RegExp(s === "|" ? "\\|" : s, "g")) ?? []).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  let hi = -1, H: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const cells = splitCsv(lines[i], sep).map((c) => c.toLowerCase());
    if (cells.some((c) => /date/.test(c)) && cells.some((c) => /narration|description|particulars|details|remarks|transaction/.test(c))) { hi = i; H = cells; break; }
  }
  if (hi < 0) return { rows: [], bank: null };
  const col = (re: RegExp, not?: RegExp) => H.findIndex((h) => re.test(h) && !(not && not.test(h)));
  const cDate = col(/(txn|transaction|tran)?\s*date/, /value/) >= 0 ? col(/(txn|transaction|tran)?\s*date/, /value/) : col(/date/);
  const cDesc = col(/narration|description|particulars|details|remarks/);
  const cDr = col(/withdrawal|debit|\bdr\b|paid out|money out/);
  const cCr = col(/deposit|credit|\bcr\b|paid in|money in/);
  const cAmt = col(/^amount|amount \(|amt(?!.*(withdraw|deposit))/);
  const cType = col(/^type$|dr\s*\/\s*cr|cr\s*\/\s*dr|debit\s*\/\s*credit/);
  const cBal = col(/balance/);
  const rows: Row[] = [];
  for (const line of lines.slice(hi + 1)) {
    const c = splitCsv(line, sep);
    const date = parseDate(c[cDate] ?? "");
    if (!date) continue;
    const desc = (c[cDesc] ?? "").replace(/\s+/g, " ").trim();
    let amount: number | null = null, dir: "dr" | "cr" = "dr";
    const dr = cDr >= 0 ? amountOf(c[cDr]) : null, cr = cCr >= 0 ? amountOf(c[cCr]) : null;
    if (dr) { amount = dr; dir = "dr"; } else if (cr) { amount = cr; dir = "cr"; }
    else if (cAmt >= 0) {
      amount = amountOf(c[cAmt]);
      const typ = cType >= 0 ? String(c[cType]).toLowerCase() : String(c[cAmt]).toLowerCase();
      dir = /cr|credit|deposit/.test(typ) || /^\+/.test(String(c[cAmt]).trim()) ? "cr" : "dr";
      if (/^-/.test(String(c[cAmt]).trim())) dir = "dr";
    }
    if (!amount) continue;
    rows.push({ date, desc, amount, dir, balance: cBal >= 0 ? amountOf(c[cBal]) : null });
  }
  return { rows, bank: bankOf(text) };
}

// ── text: a PDF's layout text or OCR'd pages; a row starts with a date and ends with its amounts ───────────────
export function parseText(text: string): { rows: Row[]; bank: string | null } {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  const rows: (Row & { nums: number[] })[] = [];
  let cur: (Row & { nums: number[] }) | null = null;
  const NUM = /(?<![\w/])(\d{1,3}(?:,\d{2,3})*(?:\.\d{2})|\d+\.\d{2})(?:\s?(cr|dr))?(?![\w/])/gi;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const dm = line.trim().match(DATE_RE);
    const date = dm ? parseDate(dm[1]) : null;
    if (date) {
      const body = line.trim().slice(dm![0].length);
      const nums = [...body.matchAll(NUM)].map((x) => ({ n: amountOf(x[1])!, side: x[2]?.toLowerCase() ?? null, i: x.index! }));
      if (!nums.length) { cur = null; continue; }
      // the description is what sits before the first amount, without a second date (the value date) or a ref number
      let desc = body.slice(0, nums[0].i).replace(DATE_RE, " ");
      desc = desc.replace(/\s{2,}/g, " ").replace(/\b\d{2}[\/\-.]\d{2}[\/\-.]\d{2,4}\b/g, " ").trim();
      const balance = nums.length >= 2 ? nums[nums.length - 1].n : null;
      const amt = nums.length >= 2 ? nums[nums.length - 2] : nums[0];
      const dir: "dr" | "cr" = amt.side === "cr" || /\b(cr|credit|deposit|by transfer|neft cr|imps cr|upi\/cr)\b/i.test(desc) ? "cr" : "dr";
      cur = { date, desc, amount: amt.n, dir, balance, nums: nums.map((x) => x.n) };
      rows.push(cur);
    } else if (cur && !/^\s*(page|statement|opening|closing|total|balance|date\b)/i.test(line) && line.trim().length < 90) {
      cur.desc = `${cur.desc} ${line.trim()}`.replace(/\s+/g, " ").trim();   // a narration that wraps onto the next line
    }
  }
  // the running balance says which way each row went, where the bank prints one
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.balance == null || b.balance == null) continue;
    const d = Math.round((b.balance - a.balance) * 100) / 100;
    if (Math.abs(Math.abs(d) - b.amount) < 0.02) b.dir = d > 0 ? "cr" : "dr";
  }
  return { rows: rows.filter((r) => r.amount > 0 && r.desc).map(({ nums, ...r }) => r), bank: bankOf(text) };
}
export function bankOf(text: string): string | null {
  const t = String(text ?? "").slice(0, 4000);
  const hit = [["HDFC Bank", /hdfc/i], ["SBI", /state bank|\bsbi\b/i], ["ICICI Bank", /icici/i], ["Axis Bank", /axis bank/i], ["Kotak", /kotak/i], ["Paytm Payments Bank", /paytm/i],
    ["Bank of Baroda", /bank of baroda/i], ["PNB", /punjab national/i], ["Yes Bank", /yes bank/i], ["IDFC FIRST", /idfc/i], ["Google Pay", /google pay/i], ["PhonePe", /phonepe/i]]
    .find(([, re]) => (re as RegExp).test(t));
  return hit ? (hit[0] as string) : null;
}

// ── a PDF's text (pdftotext ships with Git for Windows; the statement's password goes to -upw) ─────────────────
export function pdftotextBin(): string | null {
  const cands = [process.env.PDFTOTEXT, "C:\\Program Files\\Git\\mingw64\\bin\\pdftotext.exe", "C:\\Program Files\\Git\\usr\\bin\\pdftotext.exe", "/usr/bin/pdftotext", "/opt/homebrew/bin/pdftotext"].filter(Boolean) as string[];
  for (const c of cands) if (existsSync(c)) return c;
  const w = Bun.which("pdftotext");
  return w ?? null;
}
export async function pdfText(base64: string, password?: string): Promise<{ text?: string; error?: string; needsPassword?: boolean }> {
  const bin = pdftotextBin();
  if (!bin) return { error: "This PC can't read PDFs (no pdftotext). Share the statement as CSV, or scan its pages." };
  const dir = mkdtempSync(join(tmpdir(), "aos-stmt-"));
  try {
    const file = join(dir, "s.pdf");
    writeFileSync(file, Buffer.from(String(base64).replace(/^data:[^,]*,/, ""), "base64"));
    const args = [bin, "-layout", ...(password ? ["-upw", String(password)] : []), file, "-"];
    const p = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => p.kill(), 30_000);
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    clearTimeout(timer);
    await p.exited;
    if (p.exitCode !== 0 || !out.trim()) {
      if (/password|encrypt/i.test(err)) return { needsPassword: true, error: password ? "That password didn't open it." : "The statement has a password. Banks usually use your customer ID or date of birth." };
      return { error: "Couldn't read text from this PDF. Scan its pages instead." };
    }
    return { text: out };
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

// ── a narration, read: the rail, the UPI address, the reference, who it went to ─────────────────────────────────
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Upi|Imps|Neft|Atm|Sip|Mf|Ltd|Pvt)\b/g, (w) => w.toUpperCase().replace("LTD", "Ltd").replace("PVT", "Pvt"));
const NOISE_WORDS = /\b(upi|imps|neft|rtgs|ach|nach|ecs|pos|atm|wdl|dr|cr|p2a|p2m|mob|ib|fund|trf|transfer|to|by|from|payment|pymt|txn|ref|vps|ybl|okaxis|oksbi|okhdfcbank|okicici|paytm|apl|axl|ibl|icic|hdfc|sbin|utib|kkbk|yesb|barb|punb|idfb|bank|mmt|bil|onl|inb|int)\b/gi;
const cleanPart = (x: string) => x.replace(NOISE_WORDS, " ").replace(/\s{2,}/g, " ").trim();
export function readNarration(desc: string) {
  const d = String(desc ?? "");
  const vpa = d.match(/[a-z0-9._]{2,}@[a-z]{2,}/i)?.[0]?.toLowerCase() ?? null;
  const ref = d.match(/(?<!\d)\d{12}(?!\d)/)?.[0] ?? null;
  const railM = d.match(/^\s*(?:(?:to|by)\s+transfer[\s-]*)?(UPI|IMPS|NEFT|RTGS|ATM|NACH|ACH|ECS|POS|INT|CHQ|SI|BIL|MMT)\b/i)?.[1]?.toUpperCase() ?? (vpa ? "UPI" : /\batm\b/i.test(d) ? "ATM" : /neft/i.test(d) ? "NEFT" : /imps/i.test(d) ? "IMPS" : /\bpos\b|card/i.test(d) ? "POS" : "");
  const parts = d.split(/[\/\-|:*]+/).filter((x) => !/@/.test(x) && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(x.trim()))
    .map(cleanPart).filter((x) => x.length > 1 && !/^\d[\d\s]*$/.test(x));
  let name = parts.find((x) => /[a-z]{3,}/i.test(x)) ?? (vpa ? vpa.split("@")[0] : d.slice(0, 30));
  name = name.replace(/\b(pvt|private|limited|ltd)\b\.?/gi, "").replace(/\s{2,}/g, " ").trim();
  return { vpa, ref, rail: railM || "Bank", merchant: titleCase(name || "Payment").slice(0, 40) };
}
// a payment to a person, not a shop: a UPI address that is a phone number or a name, or an IMPS to a name
const PERSONISH = /^[6-9]\d{9}(@|$)|^[a-z]+\.?[a-z]*\d{0,4}@(ok(axis|sbi|hdfcbank|icici)|ybl|ibl|axl|paytm|upi|apl)$/i;
const SHOPISH = /store|shop|mart|cafe|restaurant|foods?|retail|ltd|pvt|enterprises|traders|services|india|online|pay|bharat|merchant|recharge|\.in@|bank/i;

// ── sort the rows against what is already logged ───────────────────────────────────────────────────────────────
type Logged = { id: string; kind: string; amount: number; at?: string | null; merchant?: string | null; vpa?: string | null; ref?: string | null; category?: string | null; source?: string | null; bill?: any; deleted_at?: string | null };
export function sortRows(rows: Row[], logged: Logged[], { recurring = [] as { id: string; name?: string; amount?: number }[], learned = new Map<string, string>() } = {}): Sorted[] {
  const used = new Set<string>();
  const pool = logged.filter((t) => !t.deleted_at).map((t) => ({ ...t, date: t.at ? localDate(t.at) : null }));
  return rows.map((r, i) => {
    const n = readNarration(r.desc);
    const base: Sorted = { ...r, id: `r${i + 1}`, merchant: n.merchant, vpa: n.vpa, ref: n.ref, rail: n.rail, status: "new", category: null, match: null, why: "" };
    // already logged: the same amount within a day (the reference or the UPI address, when both have one, must agree)
    const want = r.dir === "cr" ? "in" : "out";
    const near = pool.filter((t) => !used.has(t.id) && (t.kind ?? "out") === want && Math.abs(Number(t.amount) - r.amount) <= 0.5 && t.date
      && t.date >= addDays(r.date, -1) && t.date <= addDays(r.date, 1) && !(t.ref && n.ref && t.ref !== n.ref));
    const hit = near.find((t) => (t.ref && t.ref === n.ref) || (t.vpa && t.vpa === n.vpa)) ?? near.find((t) => t.date === r.date) ?? near[0];
    if (hit) { used.add(hit.id); return { ...base, status: "matched", match: hit.id, category: hit.category ?? null, why: hit.source === "receipt" ? "Matched the receipt you scanned" : hit.source === "upi" || hit.source === "agent" ? "Matched the UPI message" : "Already in Money" }; }
    if (r.dir === "cr") {
      const interest = /\bint(erest)?\b|\bint\.?pd\b|credit interest/i.test(r.desc);
      const refund = /refund|reversal|rev\b|cashback/i.test(r.desc);
      const known = learned.get(`in:${slug(n.merchant)}`);
      return { ...base, status: "income", category: interest ? "otherin" : refund ? "refund" : known ?? "otherin", why: interest ? "Interest from the bank" : refund ? "A refund" : known ? "Filed where this payer went last time" : "Money in that isn't logged yet" };
    }
    if (looksLikeMove(r.desc) || /^(ATM)$/.test(n.rail)) return { ...base, status: "moved", merchant: /atm/i.test(r.desc) ? "Cash from the ATM" : n.merchant, why: /atm/i.test(r.desc) ? "Cash from the ATM: moved to your wallet, not spent" : "Moved between your own pockets, not spent" };
    const bill = recurring.find((b) => b.name && slug(n.merchant).includes(slug(b.name).split("-")[0]) && Math.abs(Number(b.amount ?? 0) - r.amount) <= Math.max(5, r.amount * 0.1));
    if (bill) return { ...base, status: "matched", category: "bills", match: `bill:${bill.id}`, why: `Your ${bill.name} charge` };
    if (looksLikeBill(r.desc) || /^(NACH|ACH|ECS|SI)$/.test(n.rail)) return { ...base, status: "sub", category: "bills", why: "A subscription or autopay you don't have in Money" };
    const learnedCat = learned.get(slug(n.merchant));
    const guess = learnedCat ?? guessCat(n.merchant, r.desc);
    const toPerson = (n.vpa ? PERSONISH.test(n.vpa) && !SHOPISH.test(n.vpa) : /^(IMPS|NEFT|UPI)$/.test(n.rail)) && !SHOPISH.test(n.merchant) && guess === "other" && !learnedCat;
    if (toPerson) return { ...base, status: "ask", person: n.merchant, why: `Sent to ${n.merchant}. Only you know what it was` };
    return { ...base, status: "new", category: guess, why: learnedCat ? "Filed where you put it last time" : guess === "other" ? "Not sure of the budget: pick one" : "" };
  });
}

export const countRows = (rows: Sorted[]) => {
  const c: Record<string, number> = { rows: rows.length, matched: 0, new: 0, moved: 0, sub: 0, ask: 0, income: 0 };
  for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
  return c;
};
export const periodOf = (rows: Row[]) => (rows.length ? { from: rows.map((r) => r.date).sort()[0], to: rows.map((r) => r.date).sort().at(-1)! } : null);

/** What filing a row writes: decisions[row.id] is add | skip | loan | gift | bill | income (defaults by status). */
export function fileRows(importId: string, rows: Sorted[], decisions: Record<string, string | { action?: string; category?: string }> = {}, nowIso = new Date().toISOString()) {
  const tx: any[] = [], bills: any[] = [];
  for (const r of rows) {
    const dz = decisions[r.id];
    const d = typeof dz === "string" ? { action: dz } : dz ?? {};
    const action = d.action ?? ({ new: "add", income: "income", sub: "bill" } as Record<string, string>)[r.status] ?? "skip";
    if (action === "skip" || r.status === "matched" || r.status === "moved") continue;
    const id = `st_${importId}_${r.id}`;
    const common = { id, amount: r.amount, at: isoAt(r.date, "12:00"), merchant: r.merchant, vpa: r.vpa, ref: r.ref, raw: r.desc, source: "statement", statement: importId, updated_at: nowIso, created_at: nowIso };
    if (action === "income") tx.push({ ...common, kind: "in", category: d.category ?? r.category ?? "otherin" });
    else if (action === "loan") tx.push({ ...common, kind: "out", category: "other", split: { person: slug(r.person ?? r.merchant), name: r.person ?? r.merchant, share: 0 }, note: "A loan: they'll pay you back" });
    else if (action === "gift") tx.push({ ...common, kind: "out", category: d.category ?? "family", note: "Gift" });
    else if (action === "bill") {
      const rid = `rec_${slug(r.merchant)}`;
      bills.push({ id: rid, name: r.merchant, amount: r.amount, every: "month", day: Number(r.date.slice(8, 10)), state: "active", leak: true, why: "Found in your bank statement", created_at: nowIso, updated_at: nowIso });
      tx.push({ ...common, kind: "out", category: "bills", bill: rid });
    } else tx.push({ ...common, kind: "out", category: d.category ?? r.category ?? "other" });
  }
  return { tx, bills };
}

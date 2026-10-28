// Money (v2): accounts, transactions, budgets and the daily budget, bills and subscriptions, income sources (Northwind
// client payments count as his income: DECISIONS 3), leaks, funds shared with Family, net worth snapshots, and the
// statement and receipt flows. Tables belong to the agentos CLI module (cli/src/modules/money.ts); each is mounted
// here as an offline-first collection (_collection.ts). The arithmetic is app/js/aspects/money-calc.js, shared with the
// phone, so the widget, the agent and the screens agree.
//
//   collections (GET ?since · GET/PUT/DELETE /<id> · POST): /accounts /transactions /budgets /recurring /leaks /sources
//     /funds /snapshots /imports /settings, and /expenses (the same table as /transactions, for the Log expense App
//     Intent, Siri and the widget: { id, amount, currency, note, at, source } is enough; the category is guessed)
//   GET  /summary                 today's budget, the month, streak, income, net worth, leaks (what the agent reads)
//   POST /statement               { text | csv | pdf (base64) [, password] | rows } → an import to review (nothing filed)
//   POST /imports/<id>/file       { decisions: { <rowId>: add|skip|loan|gift|bill|income }, account? } → transactions
//   POST /log                     { text } "₹20 for chai" → a transaction (the sentence fallback of the App Intent)
//   POST /receipt                 { fields: { merchant, total, date, items, category } } → a transaction
//   GET  /report[?from=YYYY-MM-DD] a week of money, Monday to Sunday
//   GET  /pending                 Northwind money still to come in (owner); also files paid client rows as income
//   POST /northwind/sync            files paid Northwind client payments as income now
// Jobs: snapshot (23:50, net worth), northwind (hourly), leaks (6 h, new repeat charges), report (Sunday 10:00).
import type { Database } from "bun:sqlite";
import { mountCollection, collectionDDL, type ColumnType, type Collection } from "./_collection";
import type { AgentTool, JobCtx, ModCtx, Module } from "./types";
import * as C from "../../app/js/aspects/money-calc.js";
import { amountOf, countRows, fileRows, parseCsv, parseText, pdfText, periodOf, sortRows, bankOf, type Row, type Sorted } from "./money-statement";
import { readSystem, roots } from "./crm";

// ── the collections (columns as the CLI module creates them) ──────────────────────────────────────────────────────
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isIso = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));
const short = (v: unknown, n: number) => v == null || (typeof v === "string" && v.length <= n);
const KINDS = ["cash", "bank", "upi", "wallet", "fx", "invest", "trading", "card", "loan", "owe", "owed"];
type Spec = { table: string; columns: Record<string, ColumnType>; validate?: (d: any) => string | null };
const SPECS: Record<string, Spec> = {
  accounts: { table: "money_accounts", columns: { name: "text", kind: "text", balance: "real", as_of: "text", counted: "bool" },
    validate: (d) => (d.deleted_at ? null : !short(d.name, 60) || !d.name ? "An account needs a name." : !KINDS.includes(d.kind) ? `kind is one of ${KINDS.join(", ")}.` : !isNum(d.balance) ? "balance is a number." : null) },
  transactions: { table: "money_transactions", columns: { kind: "text", amount: "real", category: "text", merchant: "text", account: "text", at: "text", source: "text", statement: "text" },
    validate: (d) => {
      if (d.deleted_at) return null;
      if (!isNum(d.amount) || d.amount <= 0 || d.amount > 1e9) return "amount is a positive number of rupees.";
      if (d.kind != null && !["out", "in", "move"].includes(d.kind)) return "kind is out, in or move.";
      if (d.at != null && !isIso(d.at)) return "at is an ISO time.";
      if (!short(d.merchant, 80) || !short(d.note, 200) || !short(d.category, 30) || !short(d.source, 20)) return "A field is too long.";
      return null;
    } },
  budgets: { table: "money_budgets", columns: { month: "text", category: "text", amount: "real" },
    validate: (d) => (d.deleted_at ? null : !/^\d{4}-\d{2}$/.test(d.month ?? "") || !C.CATS.some((c: any) => c.id === d.category) ? "A budget is { month: YYYY-MM, category, amount }." : d.id !== `${d.month}:${d.category}` ? "A budget's id is <month>:<category>." : !isNum(d.amount) || d.amount < 0 ? "amount is rupees a month." : null) },
  recurring: { table: "money_recurring", columns: { name: "text", amount: "real", every: "text", day: "integer", next: "text", state: "text" },
    validate: (d) => (d.deleted_at ? null : !d.name || !short(d.name, 60) ? "A bill needs a name." : !isNum(d.amount) || d.amount < 0 ? "amount is a number." : null) },
  leaks: { table: "money_leaks", columns: { kind: "text", state: "text", amount: "real" },
    validate: (d) => (d.deleted_at || !d.state || ["open", "done", "paused", "ok", "hidden"].includes(d.state) ? null : "state is open, done, paused, ok or hidden.") },
  sources: { table: "money_sources", columns: { name: "text", kind: "text" } },
  funds: { table: "money_funds", columns: { name: "text", target: "real", start: "real", aspect: "text" },
    validate: (d) => (d.deleted_at ? null : !d.name || !short(d.name, 60) ? "A fund needs a name." : d.target != null && !isNum(d.target) ? "target is a number." : null) },
  snapshots: { table: "money_snapshots", columns: { date: "text", worth: "real" } },
  imports: { table: "money_imports", columns: { status: "text", kind: "text", bank: "text" },
    validate: (d) => (JSON.stringify(d).length > 600_000 ? "That statement is too big. Split it by month." : null) },
  settings: { table: "money_settings", columns: {} },
};
const IMPORT_STATES = new Set(["queued", "reading", "review", "filed", "failed"]);
const cols: Record<string, Collection> = {};
for (const [k, s] of Object.entries(SPECS)) {
  cols[k] = mountCollection({ table: s.table, columns: s.columns, validate: s.validate,
    onWrite: k === "imports" ? (doc, ctx, op) => (op === "put" && doc.status === "queued" ? readQueued(ctx, doc) : undefined) : undefined });
}
const TX = () => cols.transactions;

// the tables are the CLI's (its migrate runs on every agentos call); if this PC's agentos is older than v2, the same
// DDL is applied here so the app still works, and the next agentos run finds them in place (CREATE IF NOT EXISTS)
const readyDbs = new WeakSet<Database>();
let cliTried = false;
async function ensureTables(ctx: { db: () => Database; agentos: (a: string[]) => Promise<any>; log: (m: string) => void }) {
  const db = ctx.db();
  if (readyDbs.has(db)) return;
  const missing = () => Object.values(SPECS).some((s) => !db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(s.table));
  if (missing() && !cliTried) { cliTried = true; try { await ctx.agentos(["money"]); } catch (e: any) { ctx.log(`agentos money: ${e?.message ?? e}`); } }
  if (missing()) for (const s of Object.values(SPECS)) db.exec(collectionDDL(s));
  readyDbs.add(db);
}

// ── the model on the PC ────────────────────────────────────────────────────────────────────────────────────────
const istNow = () => { const t = new Date(Date.now() + 330 * 60000); return { date: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes() }; };
export function loadModel(db: Database, at = istNow()) {
  const docs = (k: string) => cols[k].list(db).items;
  return C.model({ tx: docs("transactions"), budgets: docs("budgets"), recurring: docs("recurring"), accounts: docs("accounts"), funds: docs("funds"),
    leaks: docs("leaks"), snapshots: docs("snapshots"), settings: cols.settings.get(db, "prefs"), today: at.date, nowMin: at.min });
}
const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
// where he (or a client ledger) put each merchant before: spends by merchant, and money in as "in:<merchant>"
const learnedCats = (db: Database) => {
  const m = new Map<string, string>();
  for (const t of TX().list(db).items) {
    if (!t.merchant || !t.category) continue;
    if ((t.kind ?? "out") === "out" && t.category !== "bills") m.set(C.slug(t.merchant), t.category);
    else if (t.kind === "in") m.set(`in:${C.slug(t.merchant)}`, t.category);
  }
  return m;
};

/** the account a payment comes out of when nobody said: the first cash or card account, else the primary bank (as the phone does) */
export function defaultAccount(db: Database, pay?: string | null) {
  const xs = cols.accounts.list(db).items;
  if (pay === "cash") return xs.find((a: any) => a.kind === "cash")?.id ?? null;
  if (pay === "card") return xs.find((a: any) => a.kind === "card")?.id ?? null;
  return (xs.find((a: any) => a.primary && ["cash", "bank", "upi", "wallet"].includes(a.kind)) ?? xs.find((a: any) => a.kind === "bank"))?.id ?? null;
}
// an App Intent / Siri / widget expense: { id, amount, currency, note, at, source } → a full transaction
export function fromIntent(b: any, db?: Database) {
  if (!b || typeof b !== "object" || Array.isArray(b)) return b;
  if (db && b.account === undefined && !b.deleted_at) b = { ...b, account: defaultAccount(db, b.pay ?? (b.kind === "move" ? null : "upi")) };
  const amount = typeof b.amount === "string" ? amountOf(b.amount) : b.amount;
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 80) : "";
  const kind = b.kind ?? "out";
  return { ...b, amount, kind, merchant: b.merchant ?? (note || null), note: b.merchant ? note : "",
    category: b.category ?? (kind === "in" ? "otherin" : C.looksLikeBill(note) ? C.BILLS : C.guessCat(note)), at: b.at ?? new Date().toISOString(), source: b.source ?? "siri" };
}
const withBody = (ctx: ModCtx, f: (b: any) => any): ModCtx => ({ ...ctx, body: async () => f(await ctx.body()) });

// ── statements ─────────────────────────────────────────────────────────────────────────────────────────────────
type ImportIn = { text?: string; csv?: string; pdf?: string; password?: string; rows?: any[]; bank?: string; name?: string; source?: string; account?: string };
async function readStatement(ctx: Pick<ModCtx, "db" | "codex" | "owner" | "log">, input: ImportIn, { ai = true } = {}) {
  let parsed: { rows: Row[]; bank: string | null } = { rows: [], bank: null }, parser = "";
  const warnings: string[] = [];
  if (Array.isArray(input.rows) && input.rows.length) {
    parser = "rows";
    // the Scan lens's rows: { date, desc, amount } (a negative amount or dir "dr" is money out; dir "cr" or credit: true is in)
    parsed = { bank: input.bank ?? null, rows: input.rows.map((r: any) => ({
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date ?? "")) ? r.date : (parseDateLoose(r.date) ?? ""), desc: String(r.desc ?? r.description ?? r.narration ?? ""),
      amount: Math.abs(Number(String(r.amount ?? "").replace(/[₹,\s]/g, ""))) || 0, dir: (r.dir === "cr" || r.credit === true ? "cr" : "dr") as "dr" | "cr" })).filter((r: Row) => r.date && r.amount > 0) };
  }
  let text = input.text ?? "";
  if (!parser && input.pdf) {
    const r = await pdfText(input.pdf, input.password);
    if (!r.text) return { error: r.error ?? "Couldn't read the PDF.", needsPassword: !!r.needsPassword };
    text = r.text;
  }
  if (!parser && input.csv) { parsed = parseCsv(input.csv); parser = "csv"; if (!parsed.rows.length) { text = input.csv; parser = ""; } }
  if (!parser && text) {
    const asCsv = /,.*,.*\n.*,.*,/.test(text.slice(0, 2000)) ? parseCsv(text) : { rows: [] as Row[], bank: null };
    parsed = asCsv.rows.length ? asCsv : parseText(text);
    parser = asCsv.rows.length ? "csv" : "text";
    // a statement this parser doesn't know: the agent reads it on the subscription (Codex), when allowed
    if (!parsed.rows.length && ai && ctx.owner) {
      try {
        const r = await ctx.codex({ prompt: `Read this bank statement. Return every transaction row: date (YYYY-MM-DD), desc (the narration as printed), amount (positive rupees), dir ("dr" money out, "cr" money in). Skip opening and closing balances.\n\n${text.slice(0, 60000)}`,
          schema: { type: "object", additionalProperties: false, required: ["bank", "rows"], properties: { bank: { type: "string" }, rows: { type: "array", items: { type: "object", additionalProperties: false, required: ["date", "desc", "amount", "dir"], properties: { date: { type: "string" }, desc: { type: "string" }, amount: { type: "number" }, dir: { type: "string", enum: ["dr", "cr"] } } } } } },
          timeoutMs: 150_000 });
        const rows = (r.out?.rows ?? []).filter((x: any) => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.amount > 0).map((x: any) => ({ date: x.date, desc: String(x.desc).slice(0, 200), amount: Math.abs(x.amount), dir: x.dir === "cr" ? "cr" : "dr" }));
        parsed = { rows, bank: r.out?.bank || parsed.bank };
        parser = "codex";
      } catch (e: any) { warnings.push(`The agent couldn't read it: ${String(e?.message ?? e).slice(0, 120)}`); }
    }
  }
  if (!parsed.rows.length) return { error: "No transactions found in that. Share the bank's CSV, or the PDF, or scan the pages flat.", warnings };
  const db = ctx.db();
  const rows = sortRows(parsed.rows, TX().list(db).items, { recurring: cols.recurring.list(db).items, learned: learnedCats(db) });
  const closing = [...parsed.rows].reverse().find((r) => r.balance != null)?.balance ?? null;
  return { rows, counts: countRows(rows), period: periodOf(parsed.rows), bank: input.bank || parsed.bank || bankOf(text) || null, parser, warnings, closing };
}
function parseDateLoose(s: unknown) { const m = String(s ?? "").match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); if (!m) return null; const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return `${y}-${String(+m[2]).padStart(2, "0")}-${String(+m[1]).padStart(2, "0")}`; }
const later = (iso?: string) => new Date(Math.max(Date.now(), (iso ? Date.parse(iso) : 0) + 1)).toISOString();
/** A statement the phone queued (offline, or to keep going in the background): read it on the PC and put it up for review. */
async function readQueued(ctx: ModCtx, doc: any) {
  const db = ctx.db();
  const r = await readStatement({ ...ctx, db: () => db }, doc.input ?? {}, { ai: false });
  const { input, ...rest } = doc;
  cols.imports.upsert(db, "error" in r && r.error ? { ...rest, status: "failed", error: r.error, needsPassword: (r as any).needsPassword ?? false, updated_at: later(doc.updated_at) }
    : { ...rest, status: "review", ...(r as any), error: null, updated_at: later(doc.updated_at) });
}
export function fileImport(db: Database, imp: any, decisions: Record<string, any> = {}, account?: string | null) {
  const now = new Date().toISOString();
  const { tx, bills } = fileRows(imp.id, imp.rows ?? [], decisions, now);
  for (const b of bills) if (!cols.recurring.get(db, b.id)) cols.recurring.upsert(db, b);
  const added = tx.map((t) => TX().upsert(db, { ...t, account: account ?? imp.account ?? null }).item);
  // the statement is the truth for the account it came from: its closing balance, as of its last day
  const acct = account ?? imp.account;
  if (acct && imp.closing != null && imp.period?.to) {
    const cur = cols.accounts.get(db, acct);
    if (cur) cols.accounts.upsert(db, { ...cur, balance: imp.closing, as_of: C.isoAt(imp.period.to, "23:59"), meta: `Checked against the statement of ${C.dayMonth(imp.period.to)}`, updated_at: now });
  }
  const outA = added.filter((t) => t.kind === "out").reduce((n, t) => n + t.amount, 0);
  const item = cols.imports.upsert(db, { ...imp, status: "filed", filed: { n: added.length, out: outA, in: added.filter((t) => t.kind === "in").reduce((n, t) => n + t.amount, 0), bills: bills.length, at: now }, decisions, updated_at: later(imp.updated_at) }).item;
  return { item, added };
}

// ── Northwind client payments: his income (DECISIONS 3), read from studio-os by the crm reader ──────────────────────
export function northwindRows(conf: (k: string, d: string) => string) {
  const sys = readSystem(roots(conf));
  const paid: any[] = [], pending: any[] = [];
  for (const c of sys.clients as any[]) for (const [i, r] of (c.money?.rows ?? []).entries()) {
    const a = amountOf(String(r.amount).replace(/[≈~]/g, "").trim());
    if (r.status === "paid" && /^\d{4}-\d{2}-\d{2}$/.test(r.date) && a && a > 0) paid.push({ slug: c.slug, name: c.name, date: r.date, amount: a, what: r.what, note: r.note });
    else if (r.status === "due" || r.status === "partial") pending.push({ id: `${c.slug}:${i}`, slug: c.slug, name: c.name, what: r.what, amount: a ?? null, approx: /≈|~/.test(r.amount), label: r.amount, note: r.note, date: r.date });
  }
  return { paid, pending };
}
export function syncNorthwind(db: Database, conf: (k: string, d: string) => string) {
  const { paid, pending } = northwindRows(conf);
  let added = 0;
  for (const p of paid) {
    const at = C.isoAt(p.date, "12:00");
    // fixed times: a re-sync is a no-op, his edits win, and a row he deleted stays deleted
    const r = TX().upsert(db, { id: `nor_${C.slug(p.slug)}_${p.date}_${Math.round(p.amount)}`, kind: "in", amount: p.amount, category: "client", merchant: p.name,
      from: "Northwind client", note: p.what && !/unconfirmed/i.test(p.what) ? p.what : "", at, source: "northwind", client: p.slug, created_at: at, updated_at: at });
    if (r.written) added++;
  }
  return { added, paid: paid.length, pending };
}

// ── routes ──────────────────────────────────────────────────────────────────────────────────────────────────────
const lastMonday = (date: string) => { const wd = C.weekday(date); return C.addDays(date, -(((wd + 6) % 7) + 7)); };
async function handle(ctx: ModCtx): Promise<Response | null> {
  const p = ctx.path, m = ctx.method;
  if (p === "/" && m === "GET") { await ensureTables(ctx); return ctx.json({ ok: true, module: "money", collections: Object.keys(SPECS) }); }
  await ensureTables(ctx);
  if (p === "/expenses" || p.startsWith("/expenses/")) return TX().handle(m === "POST" || m === "PUT" ? withBody(ctx, (b) => fromIntent(b, ctx.db())) : ctx, "/expenses");
  for (const k of Object.keys(SPECS)) {
    const r = await cols[k].handle(ctx, `/${k}`);
    if (r) return r;
  }
  const db = ctx.db();
  if (p === "/summary" && m === "GET") return ctx.json(C.summarize(loadModel(db)));
  if (p === "/report" && m === "GET") {
    const md = loadModel(db);
    const from = ctx.url.searchParams.get("from") ?? lastMonday(md.today);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return ctx.fail(400, "from is YYYY-MM-DD (a Monday).");
    return ctx.json(reportOf(md, from));
  }
  if (p === "/statement" && m === "POST") {
    const b = await ctx.body();
    if (!b || typeof b !== "object") return ctx.fail(400, "Send { text } or { csv } or { pdf } or { rows }.");
    const r = await readStatement(ctx, b, { ai: b.ai !== false });
    if ("error" in r && r.error) return ctx.json({ error: r.error, needsPassword: (r as any).needsPassword ?? false, warnings: (r as any).warnings ?? [] }, (r as any).needsPassword ? 422 : 400);
    const id = typeof b.id === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(b.id) ? b.id : newId("imp");
    const item = cols.imports.upsert(db, { id, kind: "statement", status: "review", name: b.name ?? null, source: b.source ?? "app", account: b.account ?? null, ...(r as any), at: new Date().toISOString() }).item;
    return ctx.json({ item }, 201);
  }
  const fm = p.match(/^\/imports\/([^/]+)\/file$/);
  if (fm && m === "POST") {
    const imp = cols.imports.get(db, decodeURIComponent(fm[1]));
    if (!imp) return ctx.fail(404, "No such import.");
    if (imp.status === "filed") return ctx.json({ item: imp, added: [], already: true });
    const b = (await ctx.body()) ?? {};
    return ctx.json(fileImport(db, imp, b.decisions ?? {}, b.account ?? null));
  }
  if (p === "/log" && m === "POST") {
    const b = (await ctx.body()) ?? {};
    const md = loadModel(db);
    const f = C.parseSpoken(b.text, md.today);
    if (!f) return ctx.fail(400, "Say an amount: \"₹20 for chai\".");
    const item = TX().upsert(db, { id: typeof b.id === "string" ? b.id : newId("say"), kind: f.kind, amount: f.amount, merchant: f.merchant || null, category: f.category, pay: f.pay, account: defaultAccount(db, f.pay),
      at: f.date === md.today ? new Date().toISOString() : C.isoAt(f.date, "12:00"), source: b.source ?? "told", said: String(b.text).slice(0, 200) }).item;
    return ctx.json({ item, line: lineAfter(loadModel(db), item) }, 201);
  }
  if (p === "/receipt" && m === "POST") {
    const b = (await ctx.body()) ?? {};
    const f = b.fields ?? b;
    const total = Number(amountOf(f.total) ?? f.total);
    if (!(total > 0)) return ctx.fail(400, "A receipt needs its total.");
    const date = /^\d{4}-\d{2}-\d{2}$/.test(f.date ?? "") ? f.date : null;
    const item = TX().upsert(db, { id: typeof b.id === "string" ? b.id : newId("rcp"), kind: "out", amount: total, merchant: f.merchant ?? "Receipt", category: f.category && C.CATS.some((c: any) => c.id === f.category) ? f.category : C.guessCat(f.category, f.merchant),
      items: Array.isArray(f.items) ? f.items.slice(0, 60).map((x: any) => [String(x.name ?? "").slice(0, 60), Number(x.price) || 0]) : null, at: date ? C.isoAt(date, "12:00") : new Date().toISOString(), source: "receipt", pay: b.pay ?? "upi", account: defaultAccount(db, b.pay ?? "upi") }).item;
    return ctx.json({ item }, 201);
  }
  if (p === "/pending" && m === "GET") {
    if (!ctx.owner) return ctx.json({ items: [], synced: 0 });
    try { const s = syncNorthwind(db, ctx.conf); return ctx.json({ items: s.pending, synced: s.added }); }
    catch (e: any) { ctx.log(`northwind: ${e?.message ?? e}`); return ctx.json({ items: [], synced: 0, error: "Couldn't read studio-os." }); }
  }
  if (p === "/northwind/sync" && m === "POST") {
    if (!ctx.owner) return ctx.fail(403, "Owner only.");
    const s = syncNorthwind(db, ctx.conf);
    return ctx.json({ added: s.added, paid: s.paid, pending: s.pending.length });
  }
  return null;
}

// ── words the agent and the widget use ─────────────────────────────────────────────────────────────────────────
function lineAfter(md: ReturnType<typeof C.model>, t: any) {
  const label = t.kind === "in" ? C.incat(t.category).name : C.cat(t.category).name;
  if (t.kind === "in") return `Logged ${C.inr(t.amount)} coming in (${label}).`;
  if (t.category === C.BILLS) return `Logged ${C.inr(t.amount)} under bills, outside the daily budget.`;
  if (!md.budgetTotal()) return `Logged ${C.inr(t.amount)} · ${label}. No budget is set yet, so there's no daily figure.`;
  const left = md.todayLeft();
  return `Logged ${C.inr(t.amount)} · ${label}. ${left >= 0 ? `${C.inr(left)} left today` : `${C.inr(-left)} over today's ${C.inr(md.todayAllow())}`}.`;
}
function reportOf(md: ReturnType<typeof C.model>, from: string) {
  const w = md.weekReport(from);
  const parts = [`${C.inr(w.spent)} spent${w.allowed ? ` of ${C.inr(w.allowed)} allowed` : ""}`, w.days ? `${w.kept} of ${w.days} days under budget` : null,
    w.big ? `biggest: ${w.big.m} ${C.inr(w.big.share)}` : null, w.came ? `${C.inr(w.came)} came in` : null].filter(Boolean);
  const leaks = md.leaks().filter((l: any) => l.state === "open" && l.monthly);
  return { ...w, big: w.big ? { id: w.big.id, m: w.big.m, a: w.big.share, date: w.big.date, c: w.big.c } : null, leaks: leaks.map((l: any) => ({ id: l.id, title: l.title, amount: l.amount })),
    line: `Your money week, ${C.dayMonth(w.from)} to ${C.dayMonth(w.to)}: ${parts.join(", ")}.${leaks.length ? ` One thing: ${leaks[0].title}, ${C.inr(leaks[0].amount)} a month.` : ""}` };
}

// ── jobs ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function jobDb(ctx: JobCtx) { await ensureTables(ctx); return ctx.db(); }
function writeSnapshot(db: Database) {
  const md = loadModel(db);
  if (!md.hasWorth()) return null;
  return cols.snapshots.upsert(db, { id: md.today, date: md.today, worth: Math.round(md.netWorth()), spendable: Math.round(md.groupTotal("spend")), invested: Math.round(md.groupTotal("invest")),
    fx: Math.round(md.groupTotal("fx")), owed: Math.round(md.owedTotal()), owe: Math.round(md.oweTotal()) }).item;
}
const jobs = [
  { id: "snapshot", at: "23:50", run: async (ctx: JobCtx) => { writeSnapshot(await jobDb(ctx)); } },
  { id: "northwind", every: "1h", run: async (ctx: JobCtx) => { const s = syncNorthwind(await jobDb(ctx), ctx.conf); if (s.added) ctx.log(`filed ${s.added} Northwind payment(s) as income`); } },
  { id: "leaks", every: "6h", run: async (ctx: JobCtx) => {
    const db = await jobDb(ctx), md = loadModel(db);
    for (const l of md.leaks()) {
      if (l.kind !== "subscription" || !l.detected || md.leakDocs.has(l.id)) continue;
      cols.leaks.upsert(db, { id: l.id, kind: "subscription", state: "open", amount: l.amount, title: l.title, meta: l.meta, by: "agent", seen: new Date().toISOString() });
      await ctx.push("A repeat charge in Money", `${l.title}: ${C.inr(l.amount)} a month, and it isn't in your bills.`, { link: "agenticos://money/flow" });
    }
  } },
  { id: "report", at: "10:00", days: ["sun"], run: async (ctx: JobCtx) => {
    const db = await jobDb(ctx), md = loadModel(db);
    if (!md.all.length) return;
    const r = reportOf(md, lastMonday(C.addDays(md.today, 1)));
    const cur = cols.settings.get(db, "prefs") ?? { id: "prefs" };
    cols.settings.upsert(db, { ...cur, id: "prefs", lastReport: { ...r, at: new Date().toISOString() }, updated_at: later(cur.updated_at) });
    await ctx.push("Your money week", r.line, { link: "agenticos://money/flow" });
  } },
];

// ── tools for the agent (DECISIONS 2: logging and reading are hers to do; budgets ask) ─────────────────────────────
const S = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object", additionalProperties: false, properties: props, required });
const tools: AgentTool[] = [
  { name: "money_log_expense", auto: true,
    description: "Log a spend in Money from what he said, a UPI or bank message, or a receipt. Report it after; he can undo with money_undo.",
    input: S({ amount: { type: "number", description: "Rupees" }, merchant: { type: "string" }, note: { type: "string" }, category: { type: "string", enum: [...C.CATS.map((c: any) => c.id), "bills"] },
      date: { type: "string", description: "YYYY-MM-DD, default today" }, pay: { type: "string", enum: ["upi", "cash", "card"] }, via: { type: "string", enum: ["upi", "told", "receipt"] },
      raw: { type: "string", description: "The UPI message or what he said, kept for trust" }, split_with: { type: "string", description: "A person's id: he paid, they owe half" } }, ["amount"]),
    async run(ctx, a) {
      const db = await jobDb(ctx), md = loadModel(db);
      if (!(a.amount > 0)) return { ok: false, error: "amount is a positive number" };
      const date = /^\d{4}-\d{2}-\d{2}$/.test(a.date ?? "") ? a.date : md.today;
      const vpa = String(a.raw ?? "").match(/[a-z0-9._]{2,}@[a-z]{2,}/i)?.[0] ?? null, ref = String(a.raw ?? "").match(/(?<!\d)\d{12}(?!\d)/)?.[0] ?? null;
      // the same UPI reference twice is the same spend
      if (ref) { const dup = TX().list(db).items.find((t: any) => t.ref === ref); if (dup) return { ok: true, already: true, id: dup.id, line: `Already logged: ${C.inr(dup.amount)} · ${dup.merchant ?? ""}` }; }
      const item = TX().upsert(db, { id: newId("ag"), kind: "out", amount: a.amount, merchant: a.merchant ?? (a.note || null), note: a.merchant ? a.note ?? "" : "",
        category: a.category ?? (C.looksLikeBill(`${a.merchant} ${a.note}`) ? "bills" : C.guessCat(a.merchant, a.note, a.raw)), pay: a.pay ?? "upi", account: defaultAccount(db, a.pay ?? "upi"),
        at: date === md.today ? new Date().toISOString() : C.isoAt(date, "12:00"), source: "agent", via: a.via ?? "told", raw: a.via === "upi" ? a.raw ?? null : null, said: a.via !== "upi" ? a.raw ?? null : null, vpa, ref,
        split: a.split_with ? { person: a.split_with, name: a.split_with, share: a.amount / 2 } : null }).item;
      return { ok: true, id: item.id, line: lineAfter(loadModel(db), item), undo: { tool: "money_undo", args: { id: item.id } } };
    } },
  { name: "money_log_income", auto: true,
    description: "Log money that came in: a Corner Market payout, a Northwind client payment (his income), pocket money, a refund or a gift.",
    input: S({ amount: { type: "number" }, source: { type: "string", enum: C.INCATS.map((c: any) => c.id) }, from: { type: "string" }, note: { type: "string" }, date: { type: "string" } }, ["amount", "source"]),
    async run(ctx, a) {
      const db = await jobDb(ctx), md = loadModel(db);
      if (!(a.amount > 0)) return { ok: false, error: "amount is a positive number" };
      const date = /^\d{4}-\d{2}-\d{2}$/.test(a.date ?? "") ? a.date : md.today;
      const item = TX().upsert(db, { id: newId("ag"), kind: "in", amount: a.amount, category: a.source, merchant: a.from ?? C.incat(a.source).name, note: a.note ?? "", from: a.from ?? "", account: defaultAccount(db, "upi"),
        at: date === md.today ? new Date().toISOString() : C.isoAt(date, "12:00"), source: "agent" }).item;
      return { ok: true, id: item.id, line: lineAfter(md, item), undo: { tool: "money_undo", args: { id: item.id } } };
    } },
  { name: "money_import_statement", auto: true,
    description: "Read a bank statement he shared (its text or CSV), file the new spends and money in, skip what UPI messages already logged, and leave the payments only he can explain for his review. Report the counts after.",
    input: S({ text: { type: "string" }, csv: { type: "string" }, bank: { type: "string" }, account: { type: "string", description: "The account id it belongs to (its closing balance is applied)" } }),
    async run(ctx, a) {
      const db = await jobDb(ctx);
      const r = await readStatement({ db: () => db, codex: ctx.codex, owner: true, log: ctx.log }, a, { ai: true });
      if ("error" in r && r.error) return { ok: false, error: r.error };
      const rr = r as any;
      const imp = cols.imports.upsert(db, { id: newId("imp"), kind: "statement", status: "review", source: "agent", account: a.account ?? null, ...rr, at: new Date().toISOString() }).item;
      const sure = Object.fromEntries((rr.rows as Sorted[]).map((x) => [x.id, x.status === "new" && x.category !== "other" ? "add" : x.status === "income" ? "income" : "skip"]));
      const asks = (rr.rows as Sorted[]).filter((x) => x.status === "ask" || x.status === "sub" || (x.status === "new" && x.category === "other"));
      const filed = asks.length ? null : fileImport(db, imp, sure, a.account ?? null);
      if (asks.length) {
        // file what she is sure of now; the rest waits in the review
        const now = new Date().toISOString();
        const { tx } = fileRows(imp.id, rr.rows, sure, now);
        for (const t of tx) TX().upsert(db, t);
        cols.imports.upsert(db, { ...imp, rows: rr.rows.map((x: Sorted) => (sure[x.id] !== "skip" ? { ...x, status: "matched", match: `st_${imp.id}_${x.id}`, why: "Filed by the agent" } : x)), counts: countRows(rr.rows), updated_at: later(imp.updated_at) });
      }
      return { ok: true, import: imp.id, counts: rr.counts, filed: filed ? filed.added.length : Object.values(sure).filter((v) => v !== "skip").length, waiting: asks.map((x) => ({ id: x.id, what: x.merchant, amount: x.amount, why: x.why })), link: `agenticos://money/statement/${imp.id}` };
    } },
  { name: "money_set_budget", auto: false,
    description: "Set a monthly budget for one category (it changes his daily budget). Ask him first.",
    input: S({ category: { type: "string", enum: C.CATS.map((c: any) => c.id) }, amount: { type: "number" }, month: { type: "string", description: "YYYY-MM, default this month" } }, ["category", "amount"]),
    async run(ctx, a) {
      const db = await jobDb(ctx), md = loadModel(db);
      const month = /^\d{4}-\d{2}$/.test(a.month ?? "") ? a.month : md.M.iso;
      if (!(a.amount >= 0)) return { ok: false, error: "amount is rupees a month" };
      // a month without budgets of its own starts from the carried ones, so setting one doesn't zero the rest
      if (md.budgetsCarried && month === md.M.iso) for (const [c, v] of Object.entries(md.budgets)) if (c !== a.category) cols.budgets.upsert(db, { id: `${month}:${c}`, month, category: c, amount: v });
      const was = cols.budgets.get(db, `${month}:${a.category}`)?.amount ?? null;
      cols.budgets.upsert(db, { id: `${month}:${a.category}`, month, category: a.category, amount: a.amount });
      const after = loadModel(db);
      return { ok: true, was, line: `${C.cat(a.category).name}: ${C.inr(a.amount)} a month. Today's budget is ${C.inr(after.todayAllow())}, ${C.inr(after.perDayFromTomorrow())} a day from tomorrow.` };
    } },
  { name: "money_flag_leak", auto: true,
    description: "Flag a leak he should look at: a subscription he forgot, a repeat small spend, a charge that looks wrong. It shows in Money's Leaks.",
    input: S({ title: { type: "string" }, amount: { type: "number" }, monthly: { type: "boolean" }, why: { type: "string" }, ref: { type: "string" } }, ["title", "why"]),
    async run(ctx, a) {
      const db = await jobDb(ctx);
      const id = `flag:${C.slug(a.title)}`;
      const item = cols.leaks.upsert(db, { id, kind: "flag", state: "open", title: String(a.title).slice(0, 60), amount: Number(a.amount) || 0, monthly: !!a.monthly, why: String(a.why).slice(0, 200), ref: a.ref ?? null, by: "agent" }).item;
      return { ok: true, id: item.id, line: `Flagged in Leaks: ${item.title}${item.amount ? `, ${C.inr(item.amount)}${item.monthly ? " a month" : ""}` : ""}.` };
    } },
  { name: "money_week_report", auto: true,
    description: "His money week (Monday to Sunday): spent against the daily budgets, days kept, the biggest spend, what came in, open subscription leaks.",
    input: S({ from: { type: "string", description: "The Monday, YYYY-MM-DD; default last week" } }),
    async run(ctx, a) { const db = await jobDb(ctx), md = loadModel(db); return reportOf(md, /^\d{4}-\d{2}-\d{2}$/.test(a.from ?? "") ? a.from : lastMonday(md.today)); } },
  { name: "money_summary", auto: true,
    description: "Where his money stands right now: today's budget left, the month, the streak, income this month (Northwind clients included), net worth, open leaks.",
    input: S({}), async run(ctx) { return C.summarize(loadModel(await jobDb(ctx))); } },
  { name: "money_undo", auto: true,
    description: "Undo a transaction she logged herself (from money_log_expense, money_log_income or a statement she filed) in the last two days.",
    input: S({ id: { type: "string" } }, ["id"]),
    async run(ctx, a) {
      const db = await jobDb(ctx);
      const t = TX().get(db, String(a.id));
      if (!t || t.deleted_at) return { ok: false, error: "No such transaction." };
      if (!["agent", "statement"].includes(t.source) || Date.now() - Date.parse(t.created_at) > 48 * 3600e3) return { ok: false, error: "She only undoes her own entries from the last two days; ask him to delete it." };
      TX().remove(db, t.id);
      return { ok: true, line: `Removed ${C.inr(t.amount)} · ${t.merchant ?? ""}.` };
    } },
];

export const money: Module = { name: "money", handle, jobs, tools };
// for tests
export const _ = { cols, readStatement, ensureTables, writeSnapshot, reportOf, lastMonday };

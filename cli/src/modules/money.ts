// Money: accounts, transactions, budgets, bills and subscriptions, income sources, leaks, funds, net worth snapshots and
// statement imports (v2). This module owns the tables; the phone server mounts each one as an offline-first collection
// (server/modules/_collection.ts: id, data JSON, created/updated/deleted_at, rev) and does the arithmetic the app shares.
//   agentos money                                   this month: spent, budgets, today's allowance, accounts
//   agentos money add <amount> [what] [--cat c] [--in] [--date YYYY-MM-DD] [--account id] [--note "..."] [--source s]
//   agentos money list [--month YYYY-MM] [--limit n]   transactions, newest first
//   agentos money rm <id>                           soft-delete one (the phone sees it go)
//   agentos money budget [<category> <amount>] [--month YYYY-MM]   show or set a monthly category budget
//   agentos money account [<id> --balance n [--name "..."] [--kind bank]]   show accounts or set one's balance
import type { Database } from "bun:sqlite";
import type { Args, ModCtx, Module } from "./types";

type Col = "text" | "real" | "integer" | "bool";
/** Each table and the doc fields that get a column of their own (the rest live in data). Same shape as collectionDDL. */
export const TABLES: Record<string, Record<string, Col>> = {
  money_accounts: { name: "text", kind: "text", balance: "real", as_of: "text", counted: "bool" },
  money_transactions: { kind: "text", amount: "real", category: "text", merchant: "text", account: "text", at: "text", source: "text", statement: "text" },
  money_budgets: { month: "text", category: "text", amount: "real" },
  money_recurring: { name: "text", amount: "real", every: "text", day: "integer", next: "text", state: "text" },
  money_leaks: { kind: "text", state: "text", amount: "real" },
  money_sources: { name: "text", kind: "text" },
  money_funds: { name: "text", target: "real", start: "real", aspect: "text" },
  money_snapshots: { date: "text", worth: "real" },
  money_imports: { status: "text", kind: "text", bank: "text" },
  money_settings: {},
};
const SQL: Record<Col, string> = { text: "TEXT", real: "REAL", integer: "INTEGER", bool: "INTEGER" };
export const CATEGORIES = ["food", "transport", "shopping", "college", "family", "fun", "health", "other", "bills"];
const INCOME = ["wonder", "client", "pocket", "refund", "gift", "otherin"];

export function ddl(table: string): string {
  const cols = Object.entries(TABLES[table]).map(([k, t]) => `,\n  ${k} ${SQL[t]}`).join("");
  return `CREATE TABLE IF NOT EXISTS ${table} (\n  id TEXT PRIMARY KEY,\n  data TEXT NOT NULL DEFAULT '{}',\n  created_at TEXT NOT NULL,\n  updated_at TEXT NOT NULL,\n  deleted_at TEXT,\n  rev INTEGER NOT NULL DEFAULT 0${cols}\n);\nCREATE INDEX IF NOT EXISTS ${table}_rev ON ${table}(rev);`;
}

// ── the collection format, for rows the CLI writes (the phone picks them up by rev) ─────────────────────────────
const META = new Set(["id", "created_at", "updated_at", "deleted_at", "rev", "data"]);
export function putDoc(db: Database, table: string, doc: Record<string, any>, now = new Date().toISOString()) {
  const cols = TABLES[table];
  const cur = db.query(`SELECT created_at FROM ${table} WHERE id = ?`).get(doc.id) as any;
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc)) if (!META.has(k) && !(k in cols)) rest[k] = v;
  const row: Record<string, any> = { id: doc.id, data: JSON.stringify(rest), created_at: cur?.created_at ?? doc.created_at ?? now, updated_at: doc.updated_at ?? now, deleted_at: doc.deleted_at ?? null };
  for (const [k, t] of Object.entries(cols)) { const v = doc[k]; row[k] = v == null ? null : t === "bool" ? (v ? 1 : 0) : t === "real" || t === "integer" ? Number(v) : String(v); }
  row.rev = (db.query(`SELECT coalesce(max(rev), 0) + 1 AS r FROM ${table}`).get() as any).r;
  const keys = Object.keys(row);
  db.query(`INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})
    ON CONFLICT(id) DO UPDATE SET ${keys.filter((k) => k !== "id").map((k) => `${k} = excluded.${k}`).join(", ")}`).run(...keys.map((k) => row[k]));
  return getDoc(db, table, doc.id);
}
export function getDoc(db: Database, table: string, id: string) {
  const r = db.query(`SELECT * FROM ${table} WHERE id = ?`).get(id) as any;
  if (!r) return null;
  let rest: Record<string, any> = {};
  try { rest = JSON.parse(r.data ?? "{}"); } catch {}
  const doc: Record<string, any> = { ...rest, id: r.id, created_at: r.created_at, updated_at: r.updated_at, deleted_at: r.deleted_at ?? null };
  for (const [k, t] of Object.entries(TABLES[table])) doc[k] = r[k] == null ? null : t === "bool" ? !!r[k] : r[k];
  return doc;
}
export const liveDocs = (db: Database, table: string) =>
  (db.query(`SELECT id FROM ${table} WHERE deleted_at IS NULL ORDER BY rev`).all() as any[]).map((r) => getDoc(db, table, r.id)!);
const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ── dates (IST, the agentos day) ───────────────────────────────────────────────────────────────────────────────
const istDateOf = (iso: string) => new Date(Date.parse(iso) + 330 * 60000).toISOString().slice(0, 10);
const daysIn = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const atNoon = (date: string) => new Date(Date.parse(`${date}T12:00:00+05:30`)).toISOString();

/** This month in numbers, the same rules the phone uses (money-calc.js): bills and moves sit outside the daily budget. */
export function overview(db: Database, today: string) {
  const ym = today.slice(0, 7);
  const tx = liveDocs(db, "money_transactions").map((t) => ({ ...t, date: t.at ? istDateOf(t.at) : today }));
  const spend = tx.filter((t) => (t.kind ?? "out") === "out" && t.category !== "bills" && !t.bill && t.date.slice(0, 7) === ym);
  const share = (t: any) => (t.split?.person ? Number(t.split.share ?? t.amount / 2) : t.share != null ? Number(t.share) : Number(t.amount));
  const budgetRows = liveDocs(db, "money_budgets");
  const months = [...new Set(budgetRows.map((b) => b.month))].filter((m) => m <= ym).sort();
  const src = months.includes(ym) ? ym : months.pop();
  const budgets: Record<string, number> = {};
  for (const b of budgetRows) if (b.month === src && b.category !== "bills") budgets[b.category] = Number(b.amount) || 0;
  const total = Object.values(budgets).reduce((n, v) => n + v, 0);
  const saved = tx.filter((t) => t.kind === "move" && t.fund && t.date.slice(0, 7) === ym);
  const before = spend.filter((t) => t.date < today).reduce((n, t) => n + share(t), 0) + saved.filter((t) => t.date < today).reduce((n, t) => n + Number(t.amount), 0);
  const left = daysIn(ym) - Number(today.slice(8, 10)) + 1;
  const allowance = total ? (total - before) / left : 0;
  const spentToday = spend.filter((t) => t.date === today).reduce((n, t) => n + share(t), 0);
  const monthSpent = spend.reduce((n, t) => n + share(t), 0);
  const income = tx.filter((t) => t.kind === "in" && t.date.slice(0, 7) === ym).reduce((n, t) => n + Number(t.amount), 0);
  const accounts = liveDocs(db, "money_accounts").map((a) => ({ id: a.id, name: a.name, kind: a.kind, balance: a.balance, as_of: a.as_of }));
  return {
    month: ym, today, budgeted: total > 0, budget: total, budgets, budgetsFrom: src ?? null, spent: Math.round(monthSpent), left: Math.round(total - monthSpent),
    allowance: Math.round(allowance), spentToday: Math.round(spentToday), leftToday: Math.round(allowance - spentToday), income: Math.round(income),
    transactions: spend.length, accounts,
  };
}

export const money: Module = {
  name: "money",
  help: `agentos money                    Money (v2): this month, today's budget, accounts
agentos money add <amount> [what] [--cat food] [--in] [--date YYYY-MM-DD] [--account id] [--note ".."]   log a spend (or income with --in)
agentos money list [--month YYYY-MM] [--limit 30]   transactions · agentos money rm <id>
agentos money budget [<category> <amount>] [--month YYYY-MM]   monthly category budgets (${CATEGORIES.slice(0, 8).join(" ")})
agentos money account [<id> --balance <n> [--name ".."] [--kind bank|cash|upi|wallet|fx|invest|trading|card|loan|owed]]`,
  migrate(db) {
    for (const t of Object.keys(TABLES)) db.exec(ddl(t));
    db.exec(`CREATE INDEX IF NOT EXISTS money_transactions_at ON money_transactions(at);
      CREATE INDEX IF NOT EXISTS money_transactions_statement ON money_transactions(statement);
      CREATE INDEX IF NOT EXISTS money_budgets_month ON money_budgets(month);`);
  },
  run(db, a: Args, ctx: ModCtx) {
    const sub = a._[1];
    const today = ctx.istDate();
    if (!sub) return ctx.out(overview(db, today), ["agentos money add 40 chai", "agentos money budget food 8000"]);
    if (sub === "add") {
      const amount = Number(String(a._[2] ?? "").replace(/[₹,]/g, ""));
      if (!(amount > 0 && amount < 1e9)) throw new ctx.UserError("Amount in rupees first: agentos money add 40 chai --cat food");
      const income = !!a.flags.in;
      const cat = ctx.str(a, "cat") ?? (income ? "otherin" : "other");
      if (!(income ? INCOME : CATEGORIES).includes(cat)) throw new ctx.UserError(`Category is one of: ${(income ? INCOME : CATEGORIES).join(", ")}`);
      const date = ctx.str(a, "date");
      if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ctx.UserError("--date is YYYY-MM-DD");
      const doc = putDoc(db, "money_transactions", {
        id: newId("cli"), kind: income ? "in" : "out", amount, category: cat, merchant: a._.slice(3).join(" ") || null,
        note: ctx.str(a, "note") ?? "", account: ctx.str(a, "account") ?? null, at: date ? atNoon(date) : ctx.iso(), source: ctx.str(a, "source") ?? "cli",
      }, ctx.iso());
      return ctx.out({ ok: true, transaction: doc }, ["agentos money"]);
    }
    if (sub === "list") {
      const month = ctx.str(a, "month");
      const limit = Math.max(1, Math.min(500, Number(ctx.str(a, "limit") ?? 30) || 30));
      const rows = liveDocs(db, "money_transactions").filter((t) => !month || (t.at && istDateOf(t.at).startsWith(month)))
        .sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, limit);
      return ctx.out({ count: rows.length, transactions: rows.map((t) => ({ id: t.id, at: t.at, kind: t.kind, amount: t.amount, category: t.category, merchant: t.merchant, source: t.source })) });
    }
    if (sub === "rm") {
      const id = a._[2];
      const cur = id ? getDoc(db, "money_transactions", id) : null;
      if (!cur) throw new ctx.UserError(`No transaction "${id ?? ""}". See: agentos money list`);
      if (cur.deleted_at) return ctx.out({ ok: true, already: true, id });
      const now = ctx.iso();
      putDoc(db, "money_transactions", { ...cur, deleted_at: now, updated_at: now }, now);
      return ctx.out({ ok: true, removed: id });
    }
    if (sub === "budget") {
      const month = ctx.str(a, "month") ?? today.slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month)) throw new ctx.UserError("--month is YYYY-MM");
      const c = a._[2];
      if (c) {
        if (!CATEGORIES.slice(0, 8).includes(c)) throw new ctx.UserError(`Category is one of: ${CATEGORIES.slice(0, 8).join(", ")}`);
        const amount = Number(a._[3]);
        if (!(amount >= 0 && amount < 1e8)) throw new ctx.UserError("Amount in rupees a month: agentos money budget food 8000");
        putDoc(db, "money_budgets", { id: `${month}:${c}`, month, category: c, amount }, ctx.iso());
      }
      const rows = liveDocs(db, "money_budgets").filter((b) => b.month === month);
      return ctx.out({ month, total: rows.reduce((n, b) => n + Number(b.amount), 0), budgets: rows.map((b) => ({ category: b.category, amount: b.amount })) });
    }
    if (sub === "account") {
      const id = a._[2];
      if (id) {
        const bal = ctx.str(a, "balance");
        if (bal == null || !Number.isFinite(Number(bal))) throw new ctx.UserError("Set a balance: agentos money account hdfc --balance 60000 --name 'HDFC savings' --kind bank");
        const cur = getDoc(db, "money_accounts", id);
        const kind = ctx.str(a, "kind") ?? cur?.kind ?? "bank";
        putDoc(db, "money_accounts", { ...(cur ?? {}), id, name: ctx.str(a, "name") ?? cur?.name ?? id, kind, balance: Number(bal), as_of: ctx.iso(), counted: cur?.counted ?? kind !== "trading" }, ctx.iso());
      }
      return ctx.out({ accounts: liveDocs(db, "money_accounts").map((x) => ({ id: x.id, name: x.name, kind: x.kind, balance: x.balance, as_of: x.as_of })) });
    }
    throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos money [add|list|rm|budget|account]`);
  },
};

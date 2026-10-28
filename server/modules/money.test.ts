// Money on a throwaway DB: the shared arithmetic (money-calc.js), the App Intent route, statements (CSV, layout text,
// a real PDF through pdftotext, a queued one), filing, the sentence log, Northwind client payments as income, and the
// agent's tools.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as C from "../../app/js/aspects/money-calc.js";
import { money, syncNorthwind, fromIntent, _ } from "./money";
import { parseCsv, parseText, parseDate, readNarration, pdfText, pdftotextBin } from "./money-statement";

const dir = mkdtempSync(join(tmpdir(), "money-srv-"));
afterAll(() => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch {} });
const iso = (date: string, hhmm = "12:00") => C.isoAt(date, hhmm);

function setup() {
  const db = new Database(":memory:");
  const base: any = { db: () => db, agentos: async () => { throw new Error("no CLI in tests"); }, log: () => {}, owner: true, user: { id: 1 },
    conf: (k: string, d: string) => (k === "STUDIO_BRAIN" ? join(dir, "no-brain") : k === "STUDIO_OS" ? join(dir, "nos") : d),
    codex: async () => { throw new Error("no Codex in tests"); }, push: async () => {} };
  const call = async (method: string, path: string, body?: unknown) => {
    const url = new URL(`http://x/api/v1/mod/money${path}`);
    const ctx: any = { ...base, method, path: url.pathname.replace("/api/v1/mod/money", "") || "/", url, req: new Request(url),
      body: async () => body, json: (d: unknown, s = 200) => Response.json(d, { status: s }), fail: (s: number, m: string) => Response.json({ error: m }, { status: s }) };
    const r = await money.handle(ctx);
    return r ? { status: r.status, json: (await r.json()) as any } : null;
  };
  const tool = (name: string) => money.tools!.find((t) => t.name === name)!;
  return { db, call, base, tool };
}

describe("money-calc: the arithmetic the phone and the PC share", () => {
  const raw = {
    today: "2026-10-22", nowMin: 17 * 60 + 40,
    budgets: [{ id: "2026-10:food", month: "2026-10", category: "food", amount: 6000, created_at: "2026-10-01T00:00:00.000Z" }, { id: "2026-10:transport", month: "2026-10", category: "transport", amount: 3300, created_at: "2026-10-01T00:00:00.000Z" }],
    tx: [
      { id: "a", kind: "out", amount: 1200, category: "food", merchant: "QD's", at: iso("2026-10-10"), split: { person: "kabir", name: "Kabir", share: 600 } },
      { id: "b", kind: "out", amount: 8900, category: "bills", merchant: "Claude Max", at: iso("2026-10-03") },
      { id: "c", kind: "out", amount: 400, category: "transport", merchant: "Uber", at: iso("2026-10-21", "09:00"), account: "hdfc" },
      { id: "d", kind: "out", amount: 150, category: "food", merchant: "Chai", at: iso("2026-10-22", "10:15"), account: "hdfc" },
      { id: "e", kind: "in", amount: 10000, category: "client", merchant: "Glowbox", at: iso("2026-10-09"), account: "hdfc" },
      { id: "f", kind: "move", amount: 300, fund: "anniv", at: iso("2026-10-20") },
      { id: "g", kind: "out", amount: 50, category: "food", merchant: "Typo", at: iso("2026-10-22"), deleted_at: iso("2026-10-22") },
    ],
    accounts: [{ id: "hdfc", name: "HDFC", kind: "bank", balance: 50000, as_of: iso("2026-10-01") }, { id: "card", name: "Card", kind: "card", balance: 2000, as_of: iso("2026-10-01") }],
    funds: [{ id: "anniv", name: "Anniversary fund", target: 150000, start: 1000, aspect: "family" }],
    settings: { id: "prefs", borrowed: { "2026-10-22": 100 } },
  };
  const m = C.model(raw);
  test("the daily budget: what is left of the month (less saved) over the days left, plus what he borrowed", () => {
    // budgets 9,300 − saved before today 300 − spent before today (his half 600 + 400) = 8,000 over 10 days = 800, + 100 borrowed
    expect(m.budgetTotal()).toBe(9300);
    expect(m.todayAllow()).toBe(900);
    expect(m.todaySpent()).toBe(150);
    expect(m.todayLeft()).toBe(750);
    expect(m.monthSpent()).toBe(1150);       // bills sit outside, the deleted row is gone
    expect(m.billsTotal()).toBe(8900);
    expect(m.saved()).toBe(300);
    expect(m.monthLeft()).toBe(9300 - 300 - 1150);
    expect(m.catLeft("food")).toBe(6000 - 750);
  });
  test("income, kept, net worth: accounts move with each transaction since their balance was set", () => {
    expect(m.revenue()).toBe(10000);         // a Northwind client payment is earned income (DECISIONS 3)
    expect(m.keptMonth()).toBe(10000 - 1150 - 8900);
    expect(m.accounts.find((a: any) => a.id === "hdfc").a).toBe(50000 + 10000 - 400 - 150);
    expect(m.owedTotal()).toBe(600);         // Kabir's half
    expect(m.netWorth()).toBe(59450 + 600 - 2000);
    expect(m.funds[0]).toMatchObject({ saved: 1300, month: 300 });
  });
  test("a streak counts kept days back from yesterday, never before he had a budget and a spend", () => {
    expect(C.model({ ...raw, budgets: raw.budgets.map((b) => ({ ...b, created_at: iso("2026-10-22") })) }).streak()).toBe(0);
    expect(m.keptOn("2026-10-21")).toBe(true);
    expect(m.keptOn("2026-10-08")).toBe(false);   // before his first spend (the 3rd's bill sits outside)
    // the 10th broke it (his ₹600 half against a ₹423 day), so 11 to 21 Oct
    expect(m.keptOn("2026-10-10")).toBe(false);
    expect(m.streak()).toBe(11);
    expect(m.bestStreak()).toMatchObject({ n: 11, from: "2026-10-11", to: "2026-10-21" });
  });
  test("budgets carry into a month that has none, and leaks show over-budget categories", () => {
    const nov = C.model({ ...raw, today: "2026-11-02" });
    expect(nov.budgetsCarried).toBe(true);
    expect(nov.budgetTotal()).toBe(9300);
    const over = C.model({ ...raw, budgets: [{ id: "2026-10:food", month: "2026-10", category: "food", amount: 500 }] });
    expect(over.leaks().find((l: any) => l.kind === "over")).toMatchObject({ ref: "food", amount: 250 });
  });
  test("a sentence becomes a transaction", () => {
    expect(C.parseSpoken("₹20 for chai", "2026-10-22")).toMatchObject({ kind: "out", amount: 20, category: "food", merchant: "Chai" });
    expect(C.parseSpoken("got 5000 pocket money from dad", "2026-10-22")).toMatchObject({ kind: "in", amount: 5000, category: "pocket" });
    expect(C.parseSpoken("paid 240 uber yesterday cash", "2026-10-22")).toMatchObject({ amount: 240, category: "transport", date: "2026-10-21", pay: "cash" });
    expect(C.parseSpoken("nothing here", "2026-10-22")).toBeNull();
  });
});

describe("statements: reading", () => {
  test("dates and narrations as Indian banks print them", () => {
    expect(parseDate("05/10/26")).toBe("2026-10-05");
    expect(parseDate("5 Oct 2026")).toBe("2026-10-05");
    expect(parseDate("2026-10-05")).toBe("2026-10-05");
    expect(readNarration("UPI-SWIGGY-SWIGGY.STORES@ICICI-ICIC0DC0099-629500000004-UPI")).toMatchObject({ rail: "UPI", vpa: "swiggy.stores@icici", ref: "629500000004", merchant: "Swiggy" });
    expect(readNarration("UPI/DR/624600000002/ZOMATO LTD/HDFC/zomato@hdfcbank").merchant).toBe("Zomato");
  });
  test("an HDFC CSV export", () => {
    const csv = `HDFC BANK Ltd.\nDate,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n` +
      `01/10/26,UPI-UBER-UBER.IN@AXISBANK-UTIB0000-629500000004-UPI,629500000004,01/10/26,240.00,,60124.00\n` +
      `03/10/26,ATM WDL MIDTOWN,000123,03/10/26,"2,000.00",,58124.00\n` +
      `09/10/26,NEFT CR-ATLAS SYSTEMS,N123,09/10/26,,"20,000.00",78124.00\n`;
    const r = parseCsv(csv);
    expect(r.bank).toBe("HDFC Bank");
    expect(r.rows).toEqual([
      { date: "2026-10-01", desc: "UPI-UBER-UBER.IN@AXISBANK-UTIB0000-629500000004-UPI", amount: 240, dir: "dr", balance: 60124 },
      { date: "2026-10-03", desc: "ATM WDL MIDTOWN", amount: 2000, dir: "dr", balance: 58124 },
      { date: "2026-10-09", desc: "NEFT CR-ATLAS SYSTEMS", amount: 20000, dir: "cr", balance: 78124 },
    ]);
  });
  test("layout text from a PDF: the running balance says which way a row went", () => {
    const text = `                    Statement of account  STATE BANK OF INDIA\n` +
      `Txn Date   Description                                   Debit      Credit     Balance\n` +
      `01 Oct 2026  BY TRANSFER-UPI/CR/624000/DAD/SBIN/dad@oksbi           5,000.00   65,000.00\n` +
      `02 Oct 2026  TO TRANSFER-UPI/DR/624118230917/XEROX POINT/YESB/xeroxpoint@ybl   40.00   64,960.00\n` +
      `             wraps onto a second line\n`;
    const r = parseText(text);
    expect(r.bank).toBe("SBI");
    expect(r.rows.map((x) => [x.date, x.amount, x.dir])).toEqual([["2026-10-01", 5000, "cr"], ["2026-10-02", 40, "dr"]]);
    expect(r.rows[1].desc).toContain("wraps onto a second line");
  });
  test("a real PDF through pdftotext", async () => {
    if (!pdftotextBin()) return;   // a PC without it says so to the phone (covered by the route's error path)
    const lines = ["HDFC BANK Statement", "05/10/26  UPI-BLINKIT-BLINKIT@KOTAK-KKBK0-624800000003-UPI  164.00  59960.00", "06/10/26  NACH-DR-GOOGLE ONE-GOOGLE INDIA  130.00  59830.00"];
    const r = await pdfText(Buffer.from(minimalPdf(lines)).toString("base64"));
    expect(r.error).toBeUndefined();
    expect(parseText(r.text!).rows.map((x) => x.amount)).toEqual([164, 130]);
    expect((await pdfText(Buffer.from("not a pdf").toString("base64"))).error).toBeTruthy();
  });
});

describe("the routes", () => {
  test("the Log expense App Intent: a bare { id, amount, note } is a full, idempotent expense", async () => {
    const { call, db } = setup();
    const doc = { id: "siri_1", amount: 20, currency: "INR", note: "Chai at City College", at: "2026-10-22T05:00:00.000Z", source: "siri", updated_at: "2026-10-22T05:00:00.000Z" };
    const r = await call("POST", "/expenses", doc);
    expect(r!.status).toBe(201);
    expect(r!.json.item).toMatchObject({ kind: "out", amount: 20, category: "food", merchant: "Chai at City College", source: "siri" });
    expect((await call("POST", "/expenses", doc))!.status).toBe(200);
    expect((db.query("SELECT count(*) n FROM money_transactions").get() as any).n).toBe(1);
    expect(fromIntent({ amount: "₹1,250", note: "Netflix" })).toMatchObject({ amount: 1250, category: "bills" });
    // with a bank account set up, a Siri spend comes out of it (and moves its balance), as one from the phone does
    await call("PUT", "/accounts/hdfc", { name: "HDFC", kind: "bank", balance: 1000, as_of: "2026-10-22T04:00:00.000Z", primary: true });
    expect((await call("POST", "/expenses", { id: "siri_2", amount: 30, note: "Chai", at: "2026-10-22T06:00:00.000Z" }))!.json.item.account).toBe("hdfc");
    await call("DELETE", "/expenses/siri_2");
    expect((await call("GET", "/transactions"))!.json.items).toHaveLength(1);
    expect((await call("PUT", "/transactions/bad", { amount: "20" }))!.status).toBe(400);
    expect((await call("PUT", "/budgets/2026-10:food", { month: "2026-10", category: "fun", amount: 10 }))!.status).toBe(400);
  });

  test("a statement: matched, moved, a subscription, a person, new spends and money in; then filed once", async () => {
    const { call, db } = setup();
    await call("PUT", "/transactions/upi_1", { kind: "out", amount: 240, category: "transport", merchant: "Uber", at: iso("2026-10-01", "09:10"), source: "upi", ref: "629500000004" });
    await call("PUT", "/transactions/me_1", { kind: "out", amount: 386, category: "fun", merchant: "Zomato", at: iso("2026-09-02") });   // he filed Zomato under Fun once
    const csv = `Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance\n` +
      `01/10/26,UPI-UBER-UBER.IN@AXISBANK-UTIB0000-629500000004-UPI,629500000004,01/10/26,240.00,,60124.00\n` +
      `03/10/26,ATM WDL MIDTOWN,000123,03/10/26,2000.00,,58124.00\n` +
      `05/10/26,UPI-SWIGGY INSTAMART-INSTAMART@ICICI-ICIC0-624530118266-UPI,624530118266,05/10/26,243.00,,57881.00\n` +
      `14/10/26,UPI-ZOMATO LTD-ZOMATO@HDFCBANK-HDFC0-624600000002-UPI,624600000002,14/10/26,386.00,,57495.00\n` +
      `19/10/26,NACH-DR-GOOGLE ONE-GOOGLE INDIA DIGITAL,N1,19/10/26,130.00,,57365.00\n` +
      `21/10/26,IMPS-625300000001-ROHAN MEHTA-BANK0000001,625300000001,21/10/26,500.00,,56865.00\n` +
      `09/10/26,NEFT CR-ATLAS SYSTEMS,N123,09/10/26,,20000.00,76865.00\n`;
    await call("PUT", "/accounts/hdfc", { name: "HDFC savings", kind: "bank", balance: 60000, as_of: iso("2026-09-30") });
    const r = await call("POST", "/statement", { csv, account: "hdfc" });
    expect(r!.status).toBe(201);
    const imp = r!.json.item;
    const st = Object.fromEntries(imp.rows.map((x: any) => [x.merchant, [x.status, x.category]]));
    expect(st).toMatchObject({ Uber: ["matched", "transport"], "Swiggy Instamart": ["new", "food"], Zomato: ["new", "fun"], "Google One": ["sub", "bills"], "Rohan Mehta": ["ask", null], "Atlas Systems": ["income", "otherin"] });
    expect(imp.rows.find((x: any) => /ATM/.test(x.desc)).status).toBe("moved");
    expect(imp.counts).toMatchObject({ rows: 7, matched: 1, new: 2, moved: 1, sub: 1, ask: 1, income: 1 });
    const rohan = imp.rows.find((x: any) => x.status === "ask").id;
    const f = await call("POST", `/imports/${imp.id}/file`, { decisions: { [rohan]: "loan" } });
    expect(f!.json.added).toHaveLength(5);   // 2 new, 1 income, Google One as a bill, Rohan as a loan
    expect(f!.json.item.status).toBe("filed");
    const loan = f!.json.added.find((t: any) => t.merchant === "Rohan Mehta");
    expect(loan.split).toMatchObject({ share: 0 });
    expect(_.cols.recurring.get(db, "rec_google-one")).toMatchObject({ name: "Google One", amount: 130, leak: true });
    expect(_.cols.accounts.get(db, "hdfc")).toMatchObject({ balance: 76865 });
    expect((await call("POST", `/imports/${imp.id}/file`, {}))!.json.already).toBe(true);
    // the same statement again: everything is already in
    const again = (await call("POST", "/statement", { csv }))!.json.item;
    expect(again.counts.new + again.counts.income + again.counts.ask).toBe(0);
  });

  test("the Scan lens's statement rows ({ date, desc, amount }) go through the same review", async () => {
    const { call } = setup();
    const r = await call("POST", "/statement", { bank: "HDFC Bank", rows: [{ date: "05/10/2026", desc: "UPI/DR/1/SWIGGY/ICIC/swiggy.stores@icici", amount: "-420" }, { date: "2026-10-06", desc: "NEFT CR CORNER MARKET", amount: 6000, dir: "cr" }] });
    expect(r!.status).toBe(201);
    expect(r!.json.item).toMatchObject({ bank: "HDFC Bank", parser: "rows", counts: { new: 1, income: 1 } });
    expect(r!.json.item.rows[0]).toMatchObject({ date: "2026-10-05", amount: 420, dir: "dr", category: "food" });
  });

  test("a statement queued from the phone (offline) is read on the PC and comes back for review", async () => {
    const { call } = setup();
    const text = `Date,Description,Debit,Credit,Balance\n02/10/2026,UPI/DR/1/BLINKIT/KKBK/blinkit@kotak,164.00,,100.00\n`;
    await call("PUT", "/imports/q1", { kind: "statement", status: "queued", input: { text }, updated_at: "2026-10-22T05:00:00.000Z" });
    const got = (await call("GET", "/imports/q1"))!.json.item;
    expect(got.status).toBe("review");
    expect(got.input).toBeUndefined();
    expect(got.rows[0]).toMatchObject({ merchant: "Blinkit", status: "new", category: "food" });
    const bad = await call("POST", "/statement", { text: "hello" });
    expect(bad!.status).toBe(400);
  });

  test("a sentence, a receipt, the summary and the week", async () => {
    const { call } = setup();
    const r = await call("POST", "/log", { text: "₹40 for chai" });
    expect(r!.json.item).toMatchObject({ amount: 40, category: "food", source: "told" });
    expect(r!.json.line).toContain("No budget is set yet");
    const rc = await call("POST", "/receipt", { fields: { merchant: "Decathlon", total: 650, items: [{ name: "Shorts", price: 499 }, { name: "Socks", price: 151 }] } });
    expect(rc!.json.item).toMatchObject({ category: "shopping", items: [["Shorts", 499], ["Socks", 151]], source: "receipt" });
    const s = (await call("GET", "/summary"))!.json;
    expect(s).toMatchObject({ budgeted: false, today: { spent: 690 } });
    const w = (await call("GET", "/report?from=2026-10-12"))!.json;
    expect(w).toMatchObject({ from: "2026-10-12", to: "2026-10-18" });
    expect(typeof w.line).toBe("string");
  });

  test("Northwind client payments are filed as his income, once; a row he deletes stays deleted", async () => {
    const { db, base, call } = setup();
    await _.ensureTables(base);
    mkdirSync(join(dir, "nos", "clients", "glowbox"), { recursive: true });
    writeFileSync(join(dir, "nos", "clients", "glowbox", "payments.md"), `# Glowbox payments\n\n| Date | What | Amount | Status | Note |\n|---|---|---|---|---|\n| 2026-09-10 | Catalog fill | ₹15,000 | paid | |\n| 2026-10-20 | Launch support | ₹5,000 | due | |\n\n- **Outstanding:** ₹5,000 as of 2026-10-20\n`);
    const s1 = syncNorthwind(db, base.conf);
    expect(s1.added).toBe(1);
    const t = _.cols.transactions.list(db).items.find((x: any) => x.source === "northwind");
    expect(t).toMatchObject({ kind: "in", amount: 15000, category: "client", merchant: "Glowbox" });
    expect(s1.pending.some((p: any) => p.slug === "glowbox" && p.amount === 5000)).toBe(true);
    expect(syncNorthwind(db, base.conf).added).toBe(0);
    _.cols.transactions.remove(db, t.id);
    syncNorthwind(db, base.conf);
    expect(_.cols.transactions.get(db, t.id).deleted_at).toBeTruthy();
    expect((await call("GET", "/pending"))!.json.items.length).toBeGreaterThan(0);
  });
});

describe("the agent's tools", () => {
  const jctx = (base: any) => base;
  test("log an expense from a UPI message (once per reference), undo it, log income", async () => {
    const { base, tool } = setup();
    const raw = "Rs 210.00 debited from A/c XX1234 to VPA uber.in@axisbank on 22-10-26. UPI Ref 629500000004.";
    const a: any = await tool("money_log_expense").run(jctx(base), { amount: 210, merchant: "Uber", via: "upi", raw });
    expect(a).toMatchObject({ ok: true });
    expect(a.line).toContain("₹210");
    const b: any = await tool("money_log_expense").run(jctx(base), { amount: 210, merchant: "Uber", via: "upi", raw });
    expect(b.already).toBe(true);
    expect(((await tool("money_undo").run(jctx(base), { id: a.id })) as any).ok).toBe(true);
    const inc: any = await tool("money_log_income").run(jctx(base), { amount: 6000, source: "wonder", from: "Morgan & Co." });
    expect(inc.line).toContain("₹6,000 coming in");
    expect(money.tools!.filter((t) => t.auto === false).map((t) => t.name)).toEqual(["money_set_budget"]);
  });
  test("set a budget (keeps the carried ones), flag a leak, import a statement on her own", async () => {
    const { base, tool, db } = setup();
    await _.ensureTables(base);
    const prev = C.addMonths(new Date(Date.now() + 330 * 60000).toISOString().slice(0, 7), -1);
    _.cols.budgets.upsert(db, { id: `${prev}:fun`, month: prev, category: "fun", amount: 3000 });
    const r: any = await tool("money_set_budget").run(base, { category: "food", amount: 8000 });
    expect(r.ok).toBe(true);
    const md = _.cols.budgets.list(db).items.filter((b: any) => b.month !== prev).map((b: any) => b.category).sort();
    expect(md).toEqual(["food", "fun"]);
    expect(((await tool("money_flag_leak").run(base, { title: "Cursor Pro", amount: 1950, monthly: true, why: "Unused for 41 days" })) as any).id).toBe("flag:cursor-pro");
    const csv = `Date,Narration,Withdrawal Amt.,Deposit Amt.,Closing Balance\n01/10/26,UPI-BLINKIT-BLINKIT@KOTAK-KKBK0-624800000003-UPI,164.00,,100.00\n02/10/26,IMPS-625300000001-ROHAN MEHTA-BANK0000001,500.00,,0.00\n`;
    const s: any = await tool("money_import_statement").run(base, { csv });
    expect(s).toMatchObject({ ok: true, filed: 1 });
    expect(s.waiting).toEqual([expect.objectContaining({ what: "Rohan Mehta", amount: 500 })]);
    const w: any = await tool("money_week_report").run(base, {});
    expect(w.line).toMatch(/^Your money week/);
    expect(((await tool("money_summary").run(base, {})) as any).budgeted).toBe(true);
  });
});

// a one-page PDF with these lines of text (Helvetica), offsets computed so any reader accepts it
function minimalPdf(lines: string[]) {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const content = `BT /F1 9 Tf 20 800 Td 12 TL ${lines.map((l) => `(${esc(l)}) Tj T*`).join(" ")} ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  let out = "%PDF-1.4\n"; const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return out;
}

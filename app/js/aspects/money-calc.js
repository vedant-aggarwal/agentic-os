// Money's arithmetic, shared by the app (money-data.js) and the PC (server/modules/money.ts), so the phone, the widget,
// the agent's tools and her Sunday report always agree on every rupee. Pure: no DOM, no imports. Owner: the Money agent.
//
//   model(raw) → the month view every screen reads, and each figure as a function over it.
//   raw = { tx, budgets, recurring, accounts, funds, leaks, settings, snapshots, today: 'YYYY-MM-DD', nowMin, offset }
//   (the store docs as the PC keeps them; soft-deleted ones are ignored)
//
// The daily budget is Buddy's daily allowance with rollover: this month's category budgets, less what was spent and
// saved away before the day, spread over the days left including it. Spend less and the rest of the month gets more.
// Bills and subscriptions (category 'bills', or a charge of a recurring) sit outside it, as do moves between pockets.

// ── categories ──────────────────────────────────────────────────────────
export const CATS = [
  { id: 'food', name: 'Food & drinks', icon: 'cup' },
  { id: 'transport', name: 'Transport', icon: 'car' },
  { id: 'shopping', name: 'Shopping', icon: 'bag' },
  { id: 'college', name: 'College', icon: 'cap' },
  { id: 'family', name: 'Family', icon: 'home', aspect: 'family' },
  { id: 'fun', name: 'Fun', icon: 'ticket' },
  { id: 'health', name: 'Health & gym', icon: 'dumbbell', aspect: 'body' },
  { id: 'other', name: 'Other', icon: 'tag' },
];
export const BILLS = 'bills';
export const cat = (id) => CATS.find((c) => c.id === id) ?? (id === BILLS ? { id: BILLS, name: 'Bills', icon: 'repeat' } : CATS[CATS.length - 1]);
// where money comes in from. Northwind client payments are his income, in the same total (DECISIONS 3)
export const INCATS = [
  { id: 'wonder', name: 'Corner Market', icon: 'globe', earned: true },
  { id: 'client', name: 'Northwind clients', icon: 'rocket', earned: true },
  { id: 'pocket', name: 'Pocket money', icon: 'user' },
  { id: 'refund', name: 'Refund', icon: 'undo' },
  { id: 'gift', name: 'Gift', icon: 'heart' },
  { id: 'otherin', name: 'Other', icon: 'tag' },
];
export const incat = (id) => INCATS.find((c) => c.id === id) ?? INCATS[INCATS.length - 1];
export const REVENUE_GOAL = 200000;    // ₹2 lakh a month (the Mission goal Money serves)

// what a merchant or a note says about its budget (the agent's first guess; corrections are learned per merchant)
const CAT_WORDS = [
  ['food', /food|drink|restaurant|cafe|café|chai|tea|coffee|haldiram|swiggy|zomato|instamart|grocer|blinkit|zepto|bigbasket|momo|bakery|canteen|dominos|domino|pizza|biryani|chaayos|starbucks|kfc|mcdonald|burger|lunch|dinner|breakfast|snack|juice/i],
  ['transport', /uber|ola\b|rapido|metro|dmrc|fuel|petrol|diesel|cab|auto|taxi|irctc|train|bus\b|parking|fastag|toll/i],
  ['shopping', /shop|cloth|apparel|myntra|amazon|flipkart|ajio|meesho|snitch|puma|nike|adidas|decathlon|shoe|kurta|shirt|tshirt|jeans|h&m|zara|uniqlo/i],
  ['college', /book|xerox|print|station|college|college|course|exam|fees? ?(?:college|univ)|library/i],
  ['health', /pharm|apollo|medplus|1mg|netmeds|gym|fitness|med|health|doctor|clinic|hospital|lab\b|protein/i],
  ['fun', /pvr|inox|movie|cinema|game|steam|playstation|bookmyshow|show|ticket|concert|netflix|prime video|hotstar|spotify|google play/i],
  ['family', /gift|flower|fnp|sweet|mom|dad|family|anniversary/i],
];
const BILL_WORDS = /\b(nach|ach|autopay|mandate|si\b|standing instruction|subscription|recharge|jio|airtel|vi\b|bsnl|electricity|broadband|wifi|claude|openai|chatgpt|codex|cursor|github|icloud|google one|netflix|spotify|youtube premium|prime)\b/i;
export function guessCat(...hints) {
  const h = hints.filter(Boolean).join(' ');
  if (!h) return 'other';
  const byName = CATS.find((c) => c.id === h.toLowerCase() || c.name.toLowerCase() === h.toLowerCase());
  if (byName) return byName.id;
  return CAT_WORDS.find(([, re]) => re.test(h))?.[0] ?? 'other';
}
export const looksLikeBill = (text) => BILL_WORDS.test(String(text ?? ''));
// a move between his own pockets, not spending: cash from an ATM, an SIP, a wallet top-up, his own account
export const looksLikeMove = (text) => /\b(atm|cash wdl|wdl|withdrawal|sip|mutual fund|\bmf\b|nippon|zerodha|groww|upstox|kite|amazon ?pay ?(?:top|load|add)|top-?up|self|own a\/?c|to self|fd\b|fixed deposit|rd\b|ppf|credit card (?:payment|bill)|cc payment|card payment)\b/i.test(String(text ?? ''));

// ── money and dates ─────────────────────────────────────────────────────
export const fmt = (n) => Math.round(Math.abs(Number(n) || 0)).toLocaleString('en-IN');
export const inr = (n) => `${n < 0 ? '−' : ''}₹${fmt(n)}`;
export const lakh = (n) => (Math.abs(n) >= 100000 ? `₹${(n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 1 })} lakh` : inr(n));
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const pad2 = (n) => String(n).padStart(2, '0');
export const localDate = (iso, offset = 330) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t + offset * 60000).toISOString().slice(0, 10) : null; };
export const localTime = (iso, offset = 330) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t + offset * 60000).toISOString().slice(11, 16) : ''; };
export const daysIn = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const addDays = (date, n) => { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const addMonths = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
export const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const wdName = (date) => WD[weekday(date)];
export const monthName = (ym) => MONTHS[Number(ym.slice(5, 7)) - 1];
export const dayMonth = (date) => `${Number(date.slice(8, 10))} ${monthName(date.slice(0, 7)).slice(0, 3)}`;
/** an instant at a local date and time ('HH:MM'), as ISO */
export const isoAt = (date, hhmm = '12:00', offset = 330) => new Date(Date.parse(`${date}T${hhmm}:00Z`) - offset * 60000).toISOString();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sum = (xs, f = (x) => x) => xs.reduce((n, x) => n + f(x), 0);
const live = (xs) => (Array.isArray(xs) ? xs : []).filter((d) => d && !d.deleted_at);
export const slug = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

// who logged a row, in the prototype's words: the agent from a UPI message, a scan, him, something he told her …
export function byOf(source, via) {
  const s = String(source ?? 'you');
  if (s === 'agent') return via === 'upi' ? 'upi' : via === 'receipt' ? 'scan' : 'told';
  return { receipt: 'scan', scan: 'scan', widget: 'siri', recurring: 'bill' }[s] ?? s;
}
const GROUP = { cash: 'spend', bank: 'spend', upi: 'spend', wallet: 'spend', fx: 'fx', invest: 'invest', trading: 'invest', card: 'owe', loan: 'owe', owe: 'owe', owed: 'owed' };
export const groupOf = (kind) => GROUP[kind] ?? 'spend';
export const ACCOUNT_KINDS = [
  ['cash', 'Cash', 'wallet'], ['bank', 'Bank account', 'bank'], ['upi', 'UPI Lite or wallet', 'phone'], ['wallet', 'Gift or pay balance', 'tag'],
  ['fx', 'Foreign currency', 'dollar'], ['invest', 'Investment', 'trend'], ['trading', 'Trading', 'chart'],
  ['card', 'Credit card', 'card'], ['loan', 'Loan', 'bank'], ['owed', 'Someone owes you', 'user'],
];
export const kindIcon = (k) => ACCOUNT_KINDS.find((x) => x[0] === k)?.[2] ?? 'wallet';

// ── the model ───────────────────────────────────────────────────────────
export function model(raw = {}) {
  const off = raw.offset ?? 330;
  const today = raw.today ?? localDate(new Date().toISOString(), off);
  const ym = today.slice(0, 7);
  const nowMin = raw.nowMin ?? 12 * 60;
  const M = { iso: ym, year: Number(ym.slice(0, 4)), name: monthName(ym), short: monthName(ym).slice(0, 3), days: daysIn(ym), today: Number(today.slice(8, 10)), first: weekday(`${ym}-01`), date: today };
  const dateOf = (d) => `${ym}-${pad2(d)}`;
  const settings = (live([raw.settings]).find(Boolean)) ?? {};
  const borrowed = settings.borrowed && typeof settings.borrowed === 'object' ? settings.borrowed : {};

  // transactions, as the screens read them
  const accounts0 = live(raw.accounts);
  const acctById = new Map(accounts0.map((a) => [a.id, a]));
  const recurring = live(raw.recurring);
  const recById = new Map(recurring.map((r) => [r.id, r]));
  const all = live(raw.tx).map((doc) => {
    const date = (doc.at && localDate(doc.at, off)) || (typeof doc.date === 'string' ? doc.date : today);
    const kind = doc.kind === 'in' ? 'in' : doc.kind === 'move' ? 'move' : 'out';
    const a = Math.abs(num(doc.amount));
    const split = doc.split && doc.split.person ? doc.split : null;
    const share = kind !== 'out' ? a : split ? Math.min(a, Math.max(0, num(split.share ?? a / 2))) : doc.share != null && doc.share !== '' ? Math.min(a, Math.max(0, num(doc.share))) : a;
    const acct = doc.account ? acctById.get(doc.account) : null;
    const c = kind === 'in' ? (doc.category || 'otherin') : kind === 'move' ? 'move' : (doc.category || 'other');
    const bill = kind === 'out' && (c === BILLS || !!doc.bill);
    const pay = doc.pay ?? (acct ? ({ cash: 'cash', card: 'card' }[acct.kind] ?? 'upi') : 'upi');
    return {
      id: doc.id, doc, kind, date, ym: date.slice(0, 7), d: date.slice(0, 7) === ym ? Number(date.slice(8, 10)) : null,
      t: doc.at ? localTime(doc.at, off) : '', at: doc.at ?? null, a, share, c, bill,
      m: String(doc.merchant || doc.note || (kind === 'in' ? incat(c).name : cat(c).name)), note: doc.merchant ? String(doc.note ?? '') : '',
      by: byOf(doc.source, doc.via), source: doc.source ?? 'you', pay, account: doc.account ?? null,
      split: split?.person ?? null, splitName: split?.name ?? null, settled: !!split?.settled,
      ref: doc.ref ?? null, vpa: doc.vpa ?? null, said: doc.said ?? null, raw: doc.raw ?? null, items: Array.isArray(doc.items) ? doc.items : null,
      from: doc.from ?? '', fund: doc.fund ?? null, to: doc.to ?? null, recurring: doc.recurring ?? null, billOf: doc.bill ?? null, statement: doc.statement ?? null,
      created: doc.created_at ?? null,
    };
  }).sort((x, y) => (x.date === y.date ? String(x.t).localeCompare(String(y.t)) : x.date < y.date ? -1 : 1));
  const spendAll = all.filter((t) => t.kind === 'out' && !t.bill);
  const tx = spendAll.filter((t) => t.ym === ym);                         // this month's spending (inside the daily budget)
  const billTx = all.filter((t) => t.kind === 'out' && t.bill && t.ym === ym);
  const inAll = all.filter((t) => t.kind === 'in');
  const income = inAll.filter((t) => t.ym === ym).map((t) => ({ ...t, src: t.c, name: t.doc.merchant || incat(t.c).name, from: t.from || (t.doc.merchant ? incat(t.c).name : '') }));
  const moves = all.filter((t) => t.kind === 'move');

  // per-day totals, for the allowance and the streak
  const spentOn = new Map();
  for (const t of spendAll) spentOn.set(t.date, (spentOn.get(t.date) ?? 0) + t.share);
  const savedOn = new Map();
  for (const t of moves) if (t.fund) savedOn.set(t.date, (savedOn.get(t.date) ?? 0) + t.a);

  // budgets: this month's, else the latest month before it carried forward
  const budgetDocs = live(raw.budgets).filter((b) => b.category && b.month);
  const monthsWithBudgets = [...new Set(budgetDocs.map((b) => b.month))].sort();
  const budgetsFor = (m) => {
    const src = monthsWithBudgets.includes(m) ? m : monthsWithBudgets.filter((x) => x < m).pop();
    const out = {};
    if (!src) return { budgets: out, carried: false, from: null };
    for (const b of budgetDocs) if (b.month === src && CATS.some((c) => c.id === b.category)) out[b.category] = Math.max(0, num(b.amount));
    return { budgets: out, carried: src !== m, from: src };
  };
  const B = budgetsFor(ym);
  const budgets = B.budgets;
  const totalFor = (m) => sum(Object.values(m === ym ? budgets : budgetsFor(m).budgets));

  // when he started: a day only counts once he had a budget and had logged a spend (so days before he set one up, or
  // the empty days of a month he only just started tracking, never count as kept)
  const firstBudget = budgetDocs.map((b) => (b.created_at ? localDate(b.created_at, off) : null)).filter(Boolean).sort()[0] ?? null;
  const firstSpend = all.find((t) => t.kind === 'out' && !t.bill)?.date ?? null;
  const start = firstBudget && firstSpend ? (firstBudget > firstSpend ? firstBudget : firstSpend) : today;

  const spentBeforeIn = (date) => { let n = 0; const m = date.slice(0, 7); for (const [d, v] of spentOn) if (d < date && d.slice(0, 7) === m) n += v; return n; };
  const savedBeforeIn = (date) => { let n = 0; const m = date.slice(0, 7); for (const [d, v] of savedOn) if (d < date && d.slice(0, 7) === m) n += v; return n; };
  const allowanceOn = (date) => {
    const m = date.slice(0, 7), total = totalFor(m);
    if (!total) return 0;
    const left = daysIn(m) - Number(date.slice(8, 10)) + 1;
    return (total - savedBeforeIn(date) - spentBeforeIn(date)) / left + num(borrowed[date]);
  };
  const keptOn = (date) => date >= start && date < today && totalFor(date.slice(0, 7)) > 0 && (spentOn.get(date) ?? 0) <= allowanceOn(date) + 0.5;

  const budgetTotal = () => sum(Object.values(budgets));
  const daySpent = (d) => spentOn.get(dateOf(d)) ?? 0;
  const spentBefore = (d) => spentBeforeIn(dateOf(d));
  const allowance = (d) => allowanceOn(dateOf(d));
  const todayAllow = () => allowanceOn(today);
  const todaySpent = () => spentOn.get(today) ?? 0;
  const todayLeft = () => todayAllow() - todaySpent();
  const monthSpent = () => sum(tx, (t) => t.share);
  const saved = () => sum(moves.filter((t) => t.fund && t.ym === ym), (t) => t.a);
  const monthBudget = () => budgetTotal() - saved();
  const monthLeft = () => monthBudget() - monthSpent();
  const daysAfterToday = () => M.days - M.today;
  const perDayFromTomorrow = () => (daysAfterToday() ? Math.max(0, monthLeft()) / daysAfterToday() : 0);
  const timeLeft = () => (M.days - (M.today - 1) - nowMin / 1440) / M.days;
  const pacePoint = () => budgetTotal() * (M.today - 1 + nowMin / 1440) / M.days;
  const underPace = () => pacePoint() - monthSpent();
  const kept = (d) => (dateOf(d) === today ? todayLeft() >= -0.5 : keptOn(dateOf(d)));
  function streak() { let n = 0; for (let d = addDays(today, -1); keptOn(d); d = addDays(d, -1)) n++; return n; }
  const monthKeptDays = () => { let n = 0; for (let d = 1; d < M.today; d++) if (keptOn(dateOf(d))) n++; return n; };
  function bestStreak() {
    let best = 0, run = 0, bestEnd = null;
    for (let d = start; d < today; d = addDays(d, 1)) { if (keptOn(d)) { run++; if (run > best) { best = run; bestEnd = d; } } else run = 0; }
    return { n: best, from: bestEnd ? addDays(bestEnd, -(best - 1)) : null, to: bestEnd };
  }

  const catSpent = (id) => sum(tx.filter((t) => t.c === id), (t) => t.share);
  const catLeft = (id) => (budgets[id] ?? 0) - catSpent(id);
  const catCount = (id) => tx.filter((t) => t.c === id).length;

  // bills and subscriptions: what this month's recurring charges add, actual where a charge was logged
  const recurringActive = recurring.filter((r) => !['cancelled', 'done'].includes(r.state));
  const billDay = (r) => Math.min(M.days, Math.max(1, Number(r.day) || (r.next ? Number(String(r.next).slice(8, 10)) : 1)));
  const bills = recurringActive.map((r) => {
    const d = billDay(r);
    const charged = billTx.find((t) => t.billOf === r.id || (t.recurring === r.id));
    const nextDate = r.next && r.next >= today ? r.next : d > M.today ? dateOf(d) : `${addMonths(ym, 1)}-${pad2(Math.min(daysIn(addMonths(ym, 1)), d))}`;
    return { id: r.id, name: r.name ?? 'Subscription', a: charged ? charged.a : num(r.amount), d, due: d <= M.today, charged: !!charged, on: r.pay ?? (acctById.get(r.account)?.kind === 'card' ? 'card' : 'upi'),
      note: r.note ?? '', next: dayMonth(nextDate), nextDate, leak: r.leak ? r.id : null, every: r.every ?? 'month', account: r.account ?? null, state: r.state ?? 'active', doc: r };
  });
  const loneBillTx = billTx.filter((t) => !recurringActive.some((r) => t.billOf === r.id || t.recurring === r.id));
  const billsTotal = () => sum(bills.filter((b) => b.due), (b) => b.a) + sum(loneBillTx, (t) => t.a);
  const billsPlanned = () => sum(bills, (b) => b.a) + sum(loneBillTx, (t) => t.a);
  const incomeTotal = () => sum(income, (x) => x.a);
  const earned = (xs) => sum(xs.filter((x) => incat(x.c).earned), (x) => x.a);
  const revenue = () => earned(income);
  const outTotal = () => monthSpent() + billsTotal();
  const keptMonth = () => incomeTotal() - outTotal();
  function monthStats(m) {
    if (m === ym) return { m, in: incomeTotal(), out: outTotal(), kept: keptMonth(), earned: revenue() };
    const ins = inAll.filter((t) => t.ym === m), outs = all.filter((t) => t.kind === 'out' && t.ym === m);
    const i = sum(ins, (t) => t.a), o = sum(outs, (t) => t.share);
    return { m, in: i, out: o, kept: i - o, earned: earned(ins), any: ins.length + outs.length > 0 };
  }

  // accounts: the balance he set, moved by every transaction on it since
  const accounts = accounts0.map((a) => {
    const group = groupOf(a.kind), liab = group === 'owe';
    const since = a.as_of ?? a.created_at ?? '';
    let bal = num(a.balance);
    for (const t of all) {
      if (!t.at || t.at <= since) continue;
      if (t.account === a.id) bal += (t.kind === 'in' ? 1 : -1) * (liab ? -1 : 1) * t.a;
      if (t.kind === 'move' && t.to === a.id) bal += liab ? -t.a : t.a;
    }
    return { id: a.id, group, kind: a.kind, name: a.name ?? 'Account', icon: a.icon ?? kindIcon(a.kind), a: bal, meta: a.meta ?? '', zero: a.counted === false, primary: !!a.primary, due: a.due ?? null, doc: a };
  });
  const groupTotal = (g) => sum(accounts.filter((a) => a.group === g && !a.zero), (a) => a.a);
  // owed to you: halves of splits not yet settled, plus what he entered by hand
  const owedBy = new Map();
  for (const t of all) if (t.kind === 'out' && t.split && !t.settled && t.a - t.share > 0.5) {
    const k = t.split, r = owedBy.get(k) ?? { id: `split:${k}`, person: k, name: t.splitName || k, icon: 'user', a: 0, n: 0, last: t, tx: [] };
    r.a += t.a - t.share; r.n++; r.last = t; r.tx.push(t.id); owedBy.set(k, r);
  }
  const owed = [...[...owedBy.values()].map((r) => ({ ...r, meta: r.n === 1 ? `Half of ${r.last.m}, ${dayMonth(r.last.date)}` : `${r.n} splits · last ${r.last.m}` })),
    ...accounts.filter((a) => a.group === 'owed').map((a) => ({ id: a.id, name: a.name, icon: 'user', a: a.a, meta: a.meta, person: a.doc.person ?? null, account: true }))];
  const owe = accounts.filter((a) => a.group === 'owe');
  const owedTotal = () => sum(owed, (o) => o.a);
  const oweTotal = () => sum(owe, (o) => o.a);
  const netWorth = () => groupTotal('spend') + groupTotal('fx') + groupTotal('invest') + owedTotal() - oweTotal();
  const hasWorth = () => accounts.length > 0 || owed.length > 0;

  // funds: what he put aside (a move into the fund) plus where it started
  const funds = live(raw.funds).map((f) => {
    const ins = moves.filter((t) => t.fund === f.id);
    return { id: f.id, name: f.name ?? 'Fund', target: num(f.target), saved: num(f.start) + sum(ins, (t) => t.a), month: sum(ins.filter((t) => t.ym === ym), (t) => t.a),
      monthly: num(f.monthly), goal: f.goal ?? null, aspect: f.aspect ?? null, due: f.due ?? null, shared: f.shared ?? (f.aspect ? [f.aspect] : []), key: f.key ?? null, doc: f };
  });

  // net worth over time: the last snapshot of each of the past five months, then today
  const snaps = live(raw.snapshots).filter((s) => s.date && Number.isFinite(Number(s.worth))).sort((x, y) => (x.date < y.date ? -1 : 1));
  function worthSeries() {
    const out = [];
    for (let i = 5; i >= 1; i--) {
      const m = addMonths(ym, -i), s = snaps.filter((x) => x.date.slice(0, 7) === m).pop();
      if (!s) continue;
      const st = monthStats(m);
      out.push({ m: monthName(m).slice(0, 3), ym: m, worth: num(s.worth), kept: st.any ? st.kept : num(s.kept) });
    }
    out.push({ m: M.short, ym, worth: netWorth(), kept: keptMonth(), now: true });
    return out;
  }
  // what he kept each month: the past five months that have any money logged (or a snapshot that says), then this one
  function keptSeries() {
    const out = [];
    for (let i = 5; i >= 1; i--) {
      const m = addMonths(ym, -i), st = monthStats(m), s = snaps.filter((x) => x.date.slice(0, 7) === m).pop();
      if (st.any) out.push({ m: monthName(m).slice(0, 3), ym: m, kept: st.kept });
      else if (s && s.kept != null) out.push({ m: monthName(m).slice(0, 3), ym: m, kept: num(s.kept) });
    }
    out.push({ m: M.short, ym, kept: keptMonth(), now: true });
    return out;
  }
  const runway = () => { const o = outTotal(); return o > 0 ? netWorth() / o : null; };

  // leaks: subscriptions he flagged or the agent found, repeat charges, small repeats, budgets running over
  const leakDocs = new Map(live(raw.leaks).map((l) => [l.id, l]));
  const stateOf = (id, d = 'open') => leakDocs.get(id)?.state ?? d;
  const smallFood = () => tx.filter((t) => t.c === 'food' && t.share <= 150);
  function repeatCharges() {
    // the same merchant and about the same amount in two or more of the last three months, not yet a known bill
    const from = addMonths(ym, -2), by = new Map();
    for (const t of all) {
      if (t.kind !== 'out' || t.ym < from || t.a < 49) continue;
      const k = slug(t.m.replace(/ ·.*$/, ''));
      if (recurring.some((r) => slug(r.name) === k)) continue;
      const r = by.get(k) ?? { k, m: t.m, months: new Map() };
      const prev = r.months.get(t.ym);
      if (!prev || Math.abs(prev.a - t.a) < 1) r.months.set(t.ym, { a: t.a, t });
      by.set(k, r);
    }
    return [...by.values()].filter((r) => {
      const xs = [...r.months.values()];
      if (xs.length < 2) return false;
      const a0 = xs[0].a;
      return xs.every((x) => Math.abs(x.a - a0) <= Math.max(5, a0 * 0.1)) && (looksLikeBill(r.m) || xs.length >= 3);
    }).map((r) => { const xs = [...r.months.values()]; return { k: r.k, m: r.m, a: xs[xs.length - 1].a, n: xs.length, last: xs[xs.length - 1].t }; });
  }
  function leaks() {
    const out = [];
    for (const b of bills) {
      const id = `sub:${b.id}`, doc = leakDocs.get(id);
      if (!b.doc.leak && !doc) continue;
      out.push({ id, kind: 'subscription', ref: b.id, title: b.name, icon: 'repeat', amount: b.a, monthly: true, state: doc?.state ?? 'open',
        meta: doc?.meta ?? (b.doc.why || b.note || `Next on ${b.next}`), why: doc?.why ?? b.doc.why ?? '', next: b.next, bill: b });
    }
    for (const r of repeatCharges()) {
      const id = `charge:${r.k}`;
      out.push({ id, kind: 'subscription', ref: r.k, title: r.m, icon: 'repeat', amount: r.a, monthly: true, state: stateOf(id), detected: true,
        meta: `Charged ${r.n} months running · not in your bills`, why: 'A repeat charge you haven\'t added as a bill' });
    }
    const sf = smallFood();
    if (sf.length >= 8) {
      const tot = sum(sf, (t) => t.share);
      out.push({ id: `small:food:${ym}`, kind: 'repeat', title: 'Chai and small food spends', icon: 'cup', amount: tot, monthly: false, state: stateOf(`small:food:${ym}`),
        meta: `${sf.length} times this month · ${inr(tot / sf.length)} each`, why: '', count: sf.length });
    }
    for (const c of CATS) {
      const left = catLeft(c.id);
      if (!(budgets[c.id] > 0) || left >= -0.5) continue;
      const id = `over:${ym}:${c.id}`;
      out.push({ id, kind: 'over', ref: c.id, title: `${c.name} over budget`, icon: c.icon, amount: -left, monthly: false, state: stateOf(id), meta: `${inr(catSpent(c.id))} of ${inr(budgets[c.id])}` });
    }
    for (const l of leakDocs.values()) if (l.kind === 'flag' && !out.some((x) => x.id === l.id)) {
      out.push({ id: l.id, kind: 'flag', ref: l.ref ?? null, title: l.title ?? 'A leak', icon: l.icon ?? 'drop', amount: num(l.amount), monthly: !!l.monthly, state: l.state ?? 'open', meta: l.meta ?? '', why: l.why ?? '', by: l.by ?? 'agent' });
    }
    return out;
  }
  const leakMonthly = () => sum(leaks().filter((l) => l.monthly && l.state === 'open'), (l) => l.amount);

  // a week of money (Monday to Sunday), for her report
  function weekReport(from) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i)).filter((d) => d < today);
    const spent = sum(days, (d) => spentOn.get(d) ?? 0), allowed = sum(days, (d) => allowanceOn(d));
    const keptDays = days.filter((d) => keptOn(d)), over = days.filter((d) => d >= start && !keptOn(d) && totalFor(d.slice(0, 7)) > 0);
    const inWeek = (t) => days.includes(t.date);
    const big = spendAll.filter(inWeek).sort((x, y) => y.share - x.share)[0] ?? null;
    const came = inAll.filter(inWeek), billsCharged = all.filter((t) => t.kind === 'out' && t.bill && inWeek(t));
    const byCat = CATS.map((c) => ({ id: c.id, name: c.name, a: sum(spendAll.filter((t) => inWeek(t) && t.c === c.id), (t) => t.share) })).filter((x) => x.a > 0).sort((x, y) => y.a - x.a);
    return { from, to: addDays(from, 6), days: days.length, spent, allowed, kept: keptDays.length, over: over.map(wdName), big, came: sum(came, (t) => t.a), cameFrom: [...new Set(came.map((t) => t.doc.merchant || incat(t.c).name))],
      bills: billsCharged.map((t) => ({ m: t.m, a: t.a })), byCat, count: spendAll.filter(inWeek).length };
  }

  return {
    M, today, dateOf, settings, borrowed, start, all, tx, billTx, income, moves, inAll, spendAll, budgets, budgetsCarried: B.carried, budgetsFrom: B.from,
    recurring, bills, accounts, owed, owe, funds, snaps, leakDocs,
    budgetTotal, daySpent, spentBefore, allowance, allowanceOn, todayAllow, todaySpent, todayLeft, monthSpent, saved, monthBudget, monthLeft,
    daysAfterToday, perDayFromTomorrow, timeLeft, pacePoint, underPace, kept, keptOn, streak, bestStreak, monthKeptDays, spentOn: (date) => spentOn.get(date) ?? 0,
    catSpent, catLeft, catCount, billsTotal, billsPlanned, incomeTotal, revenue, outTotal, keptMonth, monthStats,
    groupTotal, owedTotal, oweTotal, netWorth, hasWorth, worthSeries, keptSeries, runway, leaks, leakMonthly, smallFood, repeatCharges, weekReport,
  };
}

// the figures the agent, the widget and Today read (and GET /summary answers)
export function summarize(m) {
  const allow = m.todayAllow(), spent = m.todaySpent(), left = allow - spent;
  const leaks = m.leaks().filter((l) => l.state === 'open');
  return {
    date: m.today,
    budgeted: m.budgetTotal() > 0,
    today: { allowance: Math.round(allow), spent: Math.round(spent), left: Math.round(left), count: m.tx.filter((t) => t.date === m.today).length },
    month: { name: m.M.name, budget: Math.round(m.monthBudget()), spent: Math.round(m.monthSpent()), left: Math.round(m.monthLeft()), perDay: Math.round(m.perDayFromTomorrow()),
      underPace: Math.round(m.underPace()), bills: Math.round(m.billsTotal()), saved: Math.round(m.saved()), daysLeft: m.daysAfterToday() },
    streak: m.streak(),
    income: { month: Math.round(m.incomeTotal()), earned: Math.round(m.revenue()), goal: REVENUE_GOAL, kept: Math.round(m.keptMonth()) },
    worth: m.hasWorth() ? { net: Math.round(m.netWorth()), spendable: Math.round(m.groupTotal('spend')), owe: Math.round(m.oweTotal()), owed: Math.round(m.owedTotal()) } : null,
    leaks: { open: leaks.length, monthly: Math.round(m.leakMonthly()), top: leaks.slice(0, 3).map((l) => ({ id: l.id, title: l.title, amount: Math.round(l.amount), kind: l.kind })) },
    over: CATS.filter((c) => m.budgets[c.id] > 0 && m.catLeft(c.id) < -0.5).map((c) => ({ id: c.id, name: c.name, over: Math.round(-m.catLeft(c.id)) })),
  };
}

// one plain sentence ("₹20 for chai", "paid 240 uber yesterday", "got 5000 from dad") → a transaction's fields, or null
export function parseSpoken(text, today) {
  const s = String(text ?? '').trim();
  const am = s.replace(/,/g, '').match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d{1,2})?)|(\d+(?:\.\d{1,2})?)\s*(?:₹|rs\b|rupees?|bucks)?/i);
  if (!am) return null;
  const amount = Number(am[1] ?? am[2]);
  if (!(amount > 0)) return null;
  const kind = /\b(got|received|came in|credited|earned|paid me|sent me|payout|salary|income|pocket money)\b/i.test(s) ? 'in' : 'out';
  let rest = s.replace(am[0], ' ').replace(/\b(spent|paid|pay|for|on|at|to|from|got|received|rs|rupees?|inr|today|yesterday|the|a|an|kharcha|likho|log|expense|cash|upi|card)\b/gi, ' ').replace(/[₹.,!]/g, ' ').replace(/\s+/g, ' ').trim();
  const date = /\byesterday\b|\bkal\b/i.test(s) && today ? addDays(today, -1) : today;
  const pay = /\bcash\b/i.test(s) ? 'cash' : /\bcard\b/i.test(s) ? 'card' : 'upi';
  rest = rest.replace(/^[^\p{L}\p{N}]+/u, '').slice(0, 40);
  const merchant = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : '';
  const category = kind === 'in' ? (/dad|pocket/i.test(s) ? 'pocket' : /corner market|wonder|store payout|shop payout/i.test(s) ? 'wonder' : /client|invoice|northwind|atlas|glowbox|harborline/i.test(s) ? 'client' : /refund/i.test(s) ? 'refund' : /gift/i.test(s) ? 'gift' : 'otherin')
    : looksLikeBill(s) ? BILLS : guessCat(merchant, s);
  return { kind, amount, merchant, category, date, pay };
}

// Money's data on the phone: ten offline-first collections (svc/store) on the PC's money module, the shared arithmetic
// (money-calc.js) over them, and every write the screens make. Demo mode (?data=demo) runs the prototype's October
// (money-demo.js) through the same arithmetic in memory. Owner: the Money agent.
//
// Screens read S (this month: tx, income, bills, budgets, accounts, owed, owe, funds, prefs …) and the figures below,
// and redraw on onChange(). Writes land on the phone at once and sync later; each returns an undo where it makes sense.
import * as C from './money-calc.js';
import { DEMO_MODE, AGENT, FUNDS, USER } from '../data.js';
import { collection } from '../svc/store.js';
import * as clock from '../svc/clock.js';
import * as API from '../svc/api.js';
import { snapshotPart } from '../svc/native.js';
import { DEMO_RAW, DEMO_PENDING, demoStatement } from './money-demo.js';

export const DEMO = DEMO_MODE;
export const { CATS, INCATS, cat, incat, fmt, inr, lakh, REVENUE_GOAL, BILLS, ACCOUNT_KINDS } = C;

// ── the collections ─────────────────────────────────────────────────────
const NAMES = ['transactions', 'budgets', 'recurring', 'accounts', 'funds', 'leaks', 'sources', 'snapshots', 'imports', 'settings'];
class Mem {   // demo mode: the same API as a store collection, in memory, never synced
  constructor(docs) { this.docs = new Map(docs.map((d) => [d.id, structuredClone(d)])); this.subs = new Set(); this.ready = Promise.resolve(this); }
  list({ deleted = false } = {}) { return [...this.docs.values()].filter((d) => deleted || !d.deleted_at); }
  get(id) { const d = this.docs.get(id); return d && !d.deleted_at ? d : null; }
  add(f = {}) { const t = nowIso(); const d = { ...f, id: f.id ?? API.clientId('m'), created_at: t, updated_at: t, deleted_at: null }; this.docs.set(d.id, d); return d; }
  update(id, p = {}) { const cur = this.docs.get(id); if (!cur) throw new Error(`no ${id}`); const d = { ...cur, ...p, id, updated_at: nowIso() }; this.docs.set(id, d); return d; }
  put(doc) { const d = { created_at: nowIso(), deleted_at: null, ...doc, updated_at: nowIso() }; this.docs.set(d.id, d); return d; }
  remove(id) { const cur = this.docs.get(id) ?? { id, created_at: nowIso() }; const d = { ...cur, deleted_at: nowIso(), updated_at: nowIso() }; this.docs.set(id, d); return d; }
  on(ev, fn) { if (ev === 'change') this.subs.add(fn); return () => this.subs.delete(fn); }
  pending() { return 0; } errors() { return new Map(); } refresh() { return Promise.resolve(); } flush() { return Promise.resolve(); }
}
const cols = {};
for (const n of NAMES) cols[n] = DEMO ? new Mem(n === 'settings' ? [DEMO_RAW.settings] : DEMO_RAW[n === 'transactions' ? 'tx' : n] ?? []) : collection(`money/${n}`, { endpoint: `/api/v1/mod/money/${n}` });
export const collections = cols;
const nowIso = () => new Date(clock.nowMs()).toISOString();

// ── the model and the view the screens read ─────────────────────────────
export let m = null;
export let TODAY = 1;               // today's day of the month
export let NOW_H = 12;              // hours since midnight, with fractions
export const MONTH = { name: '', short: '', days: 30, today: 1, year: 2026, iso: '', first: 0, date: '' };
export const S = { tx: [], income: [], bills: [], budgets: {}, accounts: [], owed: [], owe: [], funds: [], prefs: {}, imports: [], sources: [], pending: [], lastImport: null, moved: null };
const subs = new Set();
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const changed = (what = {}) => subs.forEach((fn) => { try { fn(what); } catch (e) { console.error('[money] change', e); } });

function rebuild() {
  const raw = {}; for (const n of NAMES) if (n !== 'settings') raw[n === 'transactions' ? 'tx' : n] = cols[n].list();
  raw.settings = cols.settings.get('prefs'); raw.today = clock.today(); raw.nowMin = clock.minutes();
  m = C.model(raw);
  TODAY = m.M.today; NOW_H = clock.minutes() / 60; Object.assign(MONTH, m.M);
  Object.assign(S, { tx: m.tx, income: m.income, bills: m.bills, budgets: m.budgets, accounts: m.accounts, owed: m.owed, owe: m.owe, funds: m.funds,
    prefs: { nudge: true, borrow: true, call: false, ...(m.settings ?? {}) }, imports: cols.imports.list().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    sources: cols.sources.list() });
  S.lastImport = S.imports[0] ?? null;
  shareFunds();
  publish();
}
// Family reads FUNDS (js/data.js) for the pot both apps share: fill it from Money's funds, keeping each object
// (month is the monthly plan, as the prototype had it; thisMonth what went in this month). A pot that isn't there
// yet stays a placeholder ({ placeholder: true, target: 0 }) so a page that captured FUNDS.anniversary keeps its object.
const PLACEHOLDER = { name: 'Anniversary fund', saved: 0, target: 0, month: 0, monthly: 0, thisMonth: 0, goal: null, aspect: 'family', shared: ['family'], placeholder: true, real: false };
function shareFunds() {
  const keep = new Set();
  for (const f of m.funds) {
    const key = f.key || f.id; keep.add(key);
    const v = { id: f.id, name: f.name, saved: Math.round(f.saved), target: f.target, month: f.monthly, monthly: f.monthly, thisMonth: Math.round(f.month), goal: f.goal, aspect: f.aspect, shared: f.shared, placeholder: false, real: !DEMO };
    if (FUNDS[key]) Object.assign(FUNDS[key], v); else FUNDS[key] = v;
  }
  if (!DEMO) for (const k of Object.keys(FUNDS)) if (!keep.has(k) && !FUNDS[k]?.placeholder) { if (k === 'anniversary') Object.assign(FUNDS[k], PLACEHOLDER, { id: k }); else delete FUNDS[k]; }
}
// the widget's money (NATIVE snapshot v2) and Home/Life's summary: told whenever Money changes
function publish() {
  try {
    snapshotPart('money', () => (m.budgetTotal() > 0 ? { left: Math.round(m.todayLeft()), budget: Math.round(m.todayAllow()), spent: Math.round(m.todaySpent()), currency: '₹', monthLeft: Math.round(m.monthLeft()), monthBudget: Math.round(m.monthBudget()) } : undefined));
  } catch {}
  document.dispatchEvent(new CustomEvent('aspect-summary', { detail: { id: 'money' } }));
}
let soon = 0;
const later = (why) => { cancelAnimationFrame(soon); soon = requestAnimationFrame(() => { rebuild(); changed({ kind: why }); }); };
for (const n of NAMES) cols[n].on('change', (e) => { if (e?.why !== 'local') later(e?.why ?? 'server'); });
rebuild();
export const ready = Promise.all(NAMES.map((n) => cols[n].ready)).then(() => { rebuild(); changed({ kind: 'load' }); });
clock.onDay?.(() => { rebuild(); changed({ kind: 'day' }); });
clock.onMinute?.(() => { NOW_H = clock.minutes() / 60; });
const commit = (kind, extra = {}) => { rebuild(); changed({ kind, ...extra }); };

// ── the figures (live: always this model) ───────────────────────────────
const F = (k) => (...a) => m[k](...a);
export const budgetTotal = F('budgetTotal'), daySpent = F('daySpent'), spentBefore = F('spentBefore'), allowance = F('allowance'), allowanceOn = F('allowanceOn'),
  spentOn = F('spentOn'), todayAllow = F('todayAllow'), todaySpent = F('todaySpent'), todayLeft = F('todayLeft'), monthSpent = F('monthSpent'), saved = F('saved'),
  monthLeft = F('monthLeft'), monthBudget = F('monthBudget'), daysAfterToday = F('daysAfterToday'), perDayFromTomorrow = F('perDayFromTomorrow'), timeLeft = F('timeLeft'),
  pacePoint = F('pacePoint'), underPace = F('underPace'), kept = F('kept'), keptOn = F('keptOn'), streak = F('streak'), bestStreak = F('bestStreak'), monthKeptDays = F('monthKeptDays'),
  catSpent = F('catSpent'), catLeft = F('catLeft'), catCount = F('catCount'), billsTotal = F('billsTotal'), billsPlanned = F('billsPlanned'), incomeTotal = F('incomeTotal'),
  revenue = F('revenue'), outTotal = F('outTotal'), keptMonth = F('keptMonth'), monthStats = F('monthStats'), groupTotal = F('groupTotal'), owedTotal = F('owedTotal'),
  oweTotal = F('oweTotal'), netWorth = F('netWorth'), hasWorth = F('hasWorth'), worthSeries = F('worthSeries'), keptSeries = F('keptSeries'), runway = F('runway'), leaks = F('leaks'),
  leakMonthly = F('leakMonthly'), smallFood = F('smallFood'), weekReport = F('weekReport');
export const hasBudgets = () => m.budgetTotal() > 0;
export const hasAnything = () => m.all.length > 0 || hasBudgets() || m.accounts.length > 0;
export const summary = () => C.summarize(m);

// ── dates: a day of this month (d), or an ISO date ──────────────────────
export const dateOf = (d) => `${MONTH.iso}-${C.pad2(d)}`;
export const today = () => MONTH.date;
export const wd = (d) => C.wdName(dateOf(d));
export const WD_INI = (d) => wd(d)[0];
export const dayName = (d) => (d === TODAY ? 'Today' : d === TODAY - 1 ? 'Yesterday' : `${wd(d)} ${d}`);
export const dateLong = (d) => `${wd(d)} ${d} ${MONTH.short}`;
export const dayLabel = (date) => (date === MONTH.date ? 'Today' : date === C.addDays(MONTH.date, -1) ? 'Yesterday' : `${C.wdName(date)} ${Number(date.slice(8, 10))}${date.slice(0, 7) === MONTH.iso ? '' : ` ${C.monthName(date.slice(0, 7)).slice(0, 3)}`}`);
export const { addDays, dayMonth, wdName, monthName, addMonths } = C;
export const tomorrowWd = () => C.wdName(C.addDays(MONTH.date, 1));

// ── reads ───────────────────────────────────────────────────────────────
export const txOf = (id) => m.all.find((t) => t.id === id) ?? null;
export const sortTx = (xs) => [...xs].sort((a, b) => (a.date === b.date ? String(b.t).localeCompare(String(a.t)) : a.date < b.date ? 1 : -1));
export const accountOf = (id) => m.accounts.find((a) => a.id === id) ?? null;
export const fundOf = (id) => m.funds.find((f) => f.id === id || f.key === id) ?? null;
export const sourceOf = (id) => cols.sources.get(id);
export const importOf = (id) => cols.imports.get(id);
/** the account a payment comes out of: the first of its kind (cash, card), else the primary bank */
export function accountFor(pay) {
  const xs = m.accounts;
  if (pay === 'cash') return xs.find((a) => a.kind === 'cash')?.id ?? null;
  if (pay === 'card') return xs.find((a) => a.kind === 'card')?.id ?? null;
  return (xs.find((a) => a.primary && a.group === 'spend') ?? xs.find((a) => a.kind === 'bank'))?.id ?? null;
}
// the last time the agent did something here (her tools sheet, Today's card)
export function agentLast() {
  const xs = m.all.filter((t) => ['agent', 'upi', 'statement', 'northwind'].includes(t.source) && t.created).sort((a, b) => String(b.created).localeCompare(String(a.created)));
  return xs[0] ?? null;
}
export function agentToday() { return m.tx.filter((t) => t.date === MONTH.date && ['agent', 'upi'].includes(t.source)); }

// the original UPI message she read for a row (kept on the row as raw), or the demo's reconstruction of it
export function upiMessage(t) {
  if (t.by !== 'upi') return null;
  if (t.raw && /debited|credited|upi/i.test(t.raw)) return t.raw;
  if (!DEMO || !t.vpa) return null;
  return `Rs ${t.a.toFixed(2)} debited from A/c XX1234 to VPA ${t.vpa} on ${t.date.slice(8, 10)}-${t.date.slice(5, 7)}-${t.date.slice(2, 4)}. UPI Ref ${t.ref}. Not you? Report to Demo Bank.`;
}

// ── writes ──────────────────────────────────────────────────────────────
const atFor = (date) => (date === MONTH.date ? nowIso() : C.isoAt(date, '12:00'));
/** One spend (kind out), money in (kind in) or a move. Returns the transaction as the screens read it. */
export function addTx({ kind = 'out', amount, category, merchant = '', note = '', date = MONTH.date, pay = 'upi', split = null, source = 'you', items = null, recurring = null, from = '', bill = null, fund = null, to = null, account } = {}) {
  const doc = cols.transactions.add({ kind, amount: Math.round(Number(amount) * 100) / 100, category: category ?? (kind === 'in' ? 'otherin' : 'other'), merchant: merchant || null, note, at: atFor(date),
    pay, account: account !== undefined ? account : kind === 'move' ? null : accountFor(pay), split, source, items, recurring, from, bill, fund, to });
  rebuild();
  const tx = txOf(doc.id);
  changed({ kind: kind === 'in' ? 'income' : kind === 'move' ? 'move' : 'add', tx });
  return tx;
}
export function updateTx(id, patch) { const cur = cols.transactions.get(id); if (!cur) return null; const was = { ...cur }; cols.transactions.update(id, patch); commit('edit'); return () => { cols.transactions.put({ ...was, deleted_at: null }); commit('undo'); }; }
export function removeTx(id) { const cur = cols.transactions.get(id); if (!cur) return () => {}; cols.transactions.remove(id); commit('undo'); return () => { cols.transactions.put({ ...cur, deleted_at: null }); commit('undo'); }; }
/** He changed a row's category: this row now, and the agent files that merchant there next time. */
export function recategorise(id, c) { return updateTx(id, { category: c, learned: true }); }

// budgets: one doc per month and category. A month living on last month's budgets gets its own copy at the first change
function ownMonth() {
  if (!m.budgetsCarried) return;
  for (const [c, v] of Object.entries(m.budgets)) cols.budgets.put({ id: `${MONTH.iso}:${c}`, month: MONTH.iso, category: c, amount: v });
}
export function setBudget(c, v) {
  const was = m.budgets[c] ?? 0;
  ownMonth();
  cols.budgets.put({ id: `${MONTH.iso}:${c}`, month: MONTH.iso, category: c, amount: Math.max(0, Math.round(v)) });
  commit('budget');
  return () => { cols.budgets.put({ id: `${MONTH.iso}:${c}`, month: MONTH.iso, category: c, amount: was }); commit('budget'); };
}
export function setBudgets(map) {
  const was = { ...m.budgets };
  ownMonth();
  for (const [c, v] of Object.entries(map)) cols.budgets.put({ id: `${MONTH.iso}:${c}`, month: MONTH.iso, category: c, amount: Math.max(0, Math.round(v)) });
  commit('budget');
  return () => { for (const c of Object.keys(map)) cols.budgets.put({ id: `${MONTH.iso}:${c}`, month: MONTH.iso, category: c, amount: was[c] ?? 0 }); commit('budget'); };
}
/** move part of one budget to another (an overshoot covered from a category with room) */
export function moveBudget(from, to, a) {
  const was = { ...m.budgets };
  ownMonth();
  cols.budgets.put({ id: `${MONTH.iso}:${from}`, month: MONTH.iso, category: from, amount: Math.max(0, (was[from] ?? 0) - a) });
  cols.budgets.put({ id: `${MONTH.iso}:${to}`, month: MONTH.iso, category: to, amount: (was[to] ?? 0) + a });
  S.moved = { from, to, a, at: nowIso() };
  commit('move');
  return () => { cols.budgets.put({ id: `${MONTH.iso}:${from}`, month: MONTH.iso, category: from, amount: was[from] ?? 0 }); cols.budgets.put({ id: `${MONTH.iso}:${to}`, month: MONTH.iso, category: to, amount: was[to] ?? 0 }); S.moved = null; commit('move'); };
}

export function setLeak(id, state, extra = {}) {
  const cur = cols.leaks.get(id), was = cur?.state ?? null;
  cols.leaks.put({ ...(cur ?? { id, kind: extra.kind ?? 'subscription' }), ...extra, id, state });
  if (state === 'done' && id.startsWith('sub:')) { const r = cols.recurring.get(id.slice(4)); if (r) cols.recurring.update(r.id, { state: 'cancelled', cancelled_at: nowIso() }); }
  commit('leak', { id });
  return () => {
    if (cur) cols.leaks.put({ ...cur, state: was }); else cols.leaks.remove(id);
    if (state === 'done' && id.startsWith('sub:')) { const r = cols.recurring.get(id.slice(4)); if (r) cols.recurring.update(r.id, { state: 'active', cancelled_at: null }); }
    commit('leak', { id });
  };
}

// funds: a pot he saves into (a move, so it leaves the daily budget from tomorrow but stays in his net worth)
export function addFund({ name, target = 0, monthly = 0, start = 0, aspect = null, due = null, goal = null, key = null }) {
  const doc = cols.funds.add({ name, target, monthly, start, aspect, due, goal, key });
  commit('fund');
  return doc;
}
export function updateFund(id, patch) { cols.funds.update(id, patch); commit('fund'); }
export function saveToFund(id, a) {
  const f = fundOf(id); if (!f || !(a > 0)) return () => {};
  const t = addTx({ kind: 'move', amount: a, fund: f.id, merchant: `Into ${f.name}`, source: 'you', account: null });
  return () => removeTx(t.id)();
}

// accounts and their balances: what he types is the truth as of now, and later transactions move it
export function addAccount({ name, kind = 'bank', balance = 0, meta = '', primary = false, counted, due = null, person = null }) {
  const doc = cols.accounts.add({ name, kind, balance: Number(balance) || 0, as_of: nowIso(), meta, primary: primary || (kind === 'bank' && !m.accounts.some((a) => a.primary)), counted: counted ?? kind !== 'trading', due, person });
  commit('account');
  return doc;
}
export function setBalance(id, balance, meta) {
  const cur = cols.accounts.get(id); if (!cur) return () => {};
  cols.accounts.update(id, { balance: Number(balance) || 0, as_of: nowIso(), ...(meta != null ? { meta } : {}) });
  commit('account');
  return () => { cols.accounts.put({ ...cur }); commit('account'); };
}
export function updateAccount(id, patch) { if (!cols.accounts.get(id)) return; cols.accounts.update(id, patch); commit('account'); }
export function removeAccount(id) { const cur = cols.accounts.get(id); if (!cur) return () => {}; cols.accounts.remove(id); commit('account'); return () => { cols.accounts.put({ ...cur, deleted_at: null }); commit('account'); }; }
/** someone paid him back: their halves are settled */
export function settleSplit(person) {
  const xs = m.all.filter((t) => t.split === person && !t.settled);
  for (const t of xs) cols.transactions.update(t.id, { split: { ...t.doc.split, settled: true, settled_at: nowIso() } });
  commit('settle');
  return () => { for (const t of xs) cols.transactions.update(t.id, { split: { ...t.doc.split, settled: false } }); commit('settle'); };
}

// bills and subscriptions (outside the daily budget)
export function addBill({ name, amount, day = MONTH.today, pay = 'upi', leak = false, note = '', every = 'month', why = '' }) {
  const doc = cols.recurring.add({ name, amount: Number(amount) || 0, day, every, pay, account: accountFor(pay), state: 'active', leak, note, why });
  commit('bill');
  return doc;
}
export function updateBill(id, patch) { if (!cols.recurring.get(id)) return; cols.recurring.update(id, patch); commit('bill'); }

// preferences: the streak's nudge, borrow and call switches (and what he borrowed from tomorrow)
const prefs = () => cols.settings.get('prefs') ?? { id: 'prefs' };
export function setPref(k, v) { cols.settings.put({ ...prefs(), id: 'prefs', [k]: v }); commit('pref'); }
export function borrow(a) {
  const p = prefs(), b = { ...(p.borrowed ?? {}) }, was = b[MONTH.date] ?? 0;
  b[MONTH.date] = Math.max(0, Math.round(a));
  cols.settings.put({ ...p, id: 'prefs', borrowed: b });
  commit('borrow');
  return () => { const q = prefs(); cols.settings.put({ ...q, id: 'prefs', borrowed: { ...(q.borrowed ?? {}), [MONTH.date]: was } }); commit('borrow'); };
}
export const borrowedToday = () => Number(m.borrowed?.[MONTH.date] ?? 0);
/** borrowing is once a week: a borrow in the last six days says no */
export const canBorrow = () => !Object.entries(m.borrowed ?? {}).some(([d, v]) => v > 0 && d !== MONTH.date && d >= C.addDays(MONTH.date, -6));

// ── statements: read on the PC (or queued for it), reviewed here, filed from the phone (offline-first) ──
/** Send a statement to the PC to read. input: { text } | { csv } | { pdf: base64, password } | { rows }. */
export async function readStatement(input) {
  if (DEMO) { await new Promise((r) => setTimeout(r, 400)); return { item: demoStatement(m.all) }; }
  try {
    const r = await API.post('/api/v1/mod/money/statement', { ...input, source: 'app' }, { timeout: 180000 });
    cols.imports.refresh?.();
    return { item: r.item };
  } catch (e) {
    if (e.status === 422 || e.body?.needsPassword) return { error: e.body?.error ?? e.message, needsPassword: true };
    if (e.status && e.status < 500 && e.status !== 404 && e.status !== 408) return { error: e.body?.error ?? e.message };
    // offline or the PC is busy: a text or CSV statement waits in the outbox and the PC reads it when it's back
    if (input.text || input.csv) { const doc = cols.imports.add({ kind: 'statement', status: 'queued', input: { text: input.text, csv: input.csv, bank: input.bank, account: input.account }, name: input.name ?? null }); commit('import'); return { queued: doc }; }
    return { error: 'Reading a PDF needs your PC. Try again when it\'s online, or share the CSV.' };
  }
}
/** File what he confirmed: decisions[row.id] = add | skip | loan | gift | bill | income (defaults by status). */
export function fileStatement(imp, decisions = {}, { account } = {}) {
  const made = [], bills = [];
  for (const r of imp.rows ?? []) {
    const dz = decisions[r.id]; const d = typeof dz === 'string' ? { action: dz } : dz ?? {};
    const action = d.action ?? ({ new: 'add', income: 'income', sub: 'bill' })[r.status] ?? 'skip';
    if (action === 'skip' || r.status === 'matched' || r.status === 'moved') continue;
    const id = `st_${imp.id}_${r.id}`;
    const base = { id, amount: r.amount, at: C.isoAt(r.date, '12:00'), merchant: r.merchant, vpa: r.vpa ?? null, ref: r.ref ?? null, raw: r.desc, source: 'statement', statement: imp.id, account: account ?? imp.account ?? accountFor('upi'), pay: 'upi' };
    if (action === 'income') made.push({ ...base, kind: 'in', category: d.category ?? r.category ?? 'otherin' });
    else if (action === 'loan') made.push({ ...base, kind: 'out', category: 'other', split: { person: C.slug(r.person ?? r.merchant), name: r.person ?? r.merchant, share: 0 }, note: 'A loan: they\'ll pay you back' });
    else if (action === 'gift') made.push({ ...base, kind: 'out', category: d.category ?? 'family', note: 'Gift' });
    else if (action === 'bill') { const rid = `rec_${C.slug(r.merchant)}`; bills.push({ id: rid, name: r.merchant, amount: r.amount, every: 'month', day: Number(r.date.slice(8, 10)), state: 'active', leak: true, why: 'Found in your bank statement', pay: 'upi' }); made.push({ ...base, kind: 'out', category: 'bills', bill: rid }); }
    else made.push({ ...base, kind: 'out', category: d.category ?? r.category ?? 'other' });
  }
  for (const b of bills) if (!cols.recurring.get(b.id)) cols.recurring.put(b);
  for (const t of made) cols.transactions.put(t);
  const acct = account ?? imp.account;
  if (acct && imp.closing != null && imp.period?.to && cols.accounts.get(acct)) cols.accounts.update(acct, { balance: imp.closing, as_of: C.isoAt(imp.period.to, '23:59'), meta: `Checked against the statement of ${C.dayMonth(imp.period.to)}` });
  const out = made.filter((t) => t.kind === 'out' && t.category !== 'bills').reduce((n, t) => n + (t.split ? 0 : t.amount), 0);
  const filed = { n: made.filter((t) => t.kind === 'out' && t.category !== 'bills' && !t.split).length, out, in: made.filter((t) => t.kind === 'in').reduce((n, t) => n + t.amount, 0), bills: bills.length, loans: made.filter((t) => t.split).length, at: nowIso() };
  cols.imports.put({ ...imp, status: 'filed', filed, decisions });
  commit('import');
  return filed;
}

// ── money still to come in: Northwind client payments not yet paid (owner; the PC reads northwind-os) ──
const PENDING_KEY = 'aos-money:pending';
S.pending = DEMO ? DEMO_PENDING : (API.ls.json(PENDING_KEY) ?? []);
let pendingAt = 0;
export async function loadPending({ force = false } = {}) {
  if (DEMO || !USER?.owner) return S.pending;
  if (!force && Date.now() - pendingAt < 5 * 60000) return S.pending;
  pendingAt = Date.now();
  try { const r = await API.get('/api/v1/mod/money/pending', { timeout: 15000 }); const next = r.items ?? []; const same = JSON.stringify(next) === JSON.stringify(S.pending); S.pending = next; API.ls.set(PENDING_KEY, JSON.stringify(next)); if (r.synced) cols.transactions.refresh?.(); if (!same) changed({ kind: 'pending' }); }
  catch {}
  return S.pending;
}
export const agentName = () => AGENT.name;

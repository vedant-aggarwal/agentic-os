// Money · the agent's flows: filing a bank statement (share or scan it, the PC reads it, he reviews, it's filed), the
// leaks and what to do about each, the income sources, the streak, what she can do in Money, and her week report.
// Owner: the Money agent.
import { $, $$, esc, on, haptic, toast, closeSheet, pop, ring, pulse } from '../core.js';
import { I } from '../icons.js';
import { api } from '../bus.js';
import { AGENT, GOALS } from '../data.js';
import * as D from './money-data.js';
import { G, tile, catTile, fig, sh, wynCard, pageHead, pushMoney, incomeRow, plural, reduced, monSheet, emptyRow } from './money-ui.js';
import { native } from '../svc/native-plugins.js';
import { stagger, symbol } from '../motion.js';

const { S, inr } = D;

// ═══ what she can do in Money (the server module's tools; the Agent tab lists every app's) ═══
export const TOOLS = [
  { name: 'money_log_expense', does: 'Logs a spend from a UPI message, a receipt, or something you tell her', auto: true },
  { name: 'money_log_income', does: 'Logs a payout, a client payment or pocket money as it comes in', auto: true },
  { name: 'money_import_statement', does: 'Reads a bank statement, skips what is already logged, files the rest and asks about the rest', auto: true },
  { name: 'money_flag_leak', does: 'Flags forgotten subscriptions, repeat charges and small spends that add up', auto: true },
  { name: 'money_week_report', does: 'Your money week every Sunday at 10:00', auto: true },
  { name: 'money_summary', does: 'Reads where your money stands before she answers you about it', auto: true },
  { name: 'money_undo', does: 'Undoes something she logged herself in the last two days', auto: true },
  { name: 'money_set_budget', does: 'Changes a category budget, which moves your daily budget', auto: false },
];
const TOOL_NAME = { money_log_expense: 'Log spends', money_log_income: 'Log money in', money_import_statement: 'File statements', money_flag_leak: 'Spot leaks', money_week_report: 'Weekly report', money_summary: 'Read your money', money_undo: 'Undo her own entries', money_set_budget: 'Change a budget' };
function lastUsed(name) {
  const by = { money_log_expense: (t) => t.source === 'agent' && t.kind === 'out', money_log_income: (t) => t.source === 'agent' && t.kind === 'in', money_import_statement: (t) => t.source === 'statement' }[name];
  if (!by) return name === 'money_week_report' && S.prefs.lastReport?.at ? D.dayLabel(S.prefs.lastReport.at.slice(0, 10)) : null;
  const t = D.m.all.filter(by).sort((a, b) => String(b.created).localeCompare(String(a.created)))[0];
  return t ? `${D.dayLabel(t.created?.slice(0, 10) ?? t.date)}` : null;
}
export function openTools() {
  monSheet({ title: `What ${esc(AGENT.name)} does in Money`, sub: 'Tools she can use on her own or after asking you', large: true, body: `
    <div class="group mon-toolg">${TOOLS.map((t) => { const l = lastUsed(t.name); return `<div class="row"><span class="rbody"><span class="rtitle">${TOOL_NAME[t.name]}</span><span class="rmeta mon-wrap">${esc(t.does)}</span>${l ? `<span class="rmeta">Last used ${esc(l)}</span>` : ''}</span>
      <span class="pill${t.auto ? '' : ' plain'}"${t.auto ? ' style="--c:var(--as-ink)"' : ''}>${t.auto ? 'On her own' : 'Asks you'}</span></div>`; }).join('')}</div>
    <p class="hint">She tells you after anything she does on her own, with Undo. Anything that moves money or writes to someone asks you first.</p>
    <div class="pad"><button class="btn block" data-act="mon-agent-tools">See every app's tools</button></div>` });
}
on('mon-agent-tools', () => { closeSheet(); api.openAgent('tools'); });

// ═══ LEAKS ══════════════════════════════════════════════════════════════
const amtMo = (a) => `<span class="mon-amt">${inr(a)}</span><small>a month</small>`;
const CLOSED = { done: 'Cancelled', paused: 'Paused', ok: 'Fine by you', hidden: 'Hidden' };
/** the leaks the Flow screen lists: [{ id, kind, title, icon, amount, monthly, state, meta, open(), … }] */
export const LEAKS = () => D.leaks().filter((l) => l.state !== 'hidden').map((l) => ({
  ...l, open: () => l.state === 'open',
  amountHtml: () => (l.monthly ? amtMo(l.amount) : `<span class="mon-amt">${inr(l.amount)}</span>`),
  closedLabel: () => (l.kind === 'over' ? 'Covered' : CLOSED[l.state] ?? 'Closed'),
}));
export const leakState = (id) => D.leaks().find((l) => l.id === id)?.state ?? 'open';
function leakSheet({ title, sub, body, acts }) {
  return monSheet({ title, sub, cls: 'mon-leaksheet', body: `${body}<div class="pad mon-sheet-acts">${acts.map(([l, a, primary, extra = '']) => `<button class="btn block${primary ? ' primary' : ''}" data-act="${a}" ${extra}${primary ? ' style="--c:var(--as-fill)"' : ''}>${l}</button>`).join('')}</div>` });
}
const canRemind = () => native.available;
export function openLeak(id) {
  const l = D.leaks().find((x) => x.id === id || x.ref === id);
  if (!l) { toast('That leak is closed'); return; }
  if (l.kind === 'over') { api.openBudget(l.ref); return; }
  const done = l.state !== 'open';
  const set = (v) => `data-id="${esc(l.id)}" data-v="${v}" data-kind="${l.kind}"`;
  if (l.kind === 'subscription') {
    const b = l.bill;
    const charges = D.m.all.filter((t) => t.kind === 'out' && (t.billOf === l.ref || (b && t.m === b.name))).sort((x, y) => (x.date < y.date ? 1 : -1)).slice(0, 4);
    return leakSheet({ title: esc(l.title), sub: `${inr(l.amount)} a month${b ? ` · ${b.on === 'card' ? 'on your card' : 'by UPI'}` : ''}`, body: `
      <div class="group">
        ${l.why ? `<div class="row"><span class="rbody"><span class="rtitle">${esc(l.why)}</span>${l.meta && l.meta !== l.why ? `<span class="rmeta">${esc(l.meta)}</span>` : ''}</span></div>` : ''}
        ${b ? `<div class="row"><span class="rbody"><span class="rtitle">${done ? (l.state === 'done' ? 'Cancelled' : l.state === 'paused' ? 'Paused' : 'Kept') : `Next charge ${esc(b.next)}`}</span><span class="rmeta">${done ? 'Off your leaks list' : 'Unless you cancel before then'}</span></span></div>` : ''}
        ${charges.map((t) => `<div class="row ic">${tile('repeat')}<span class="rbody"><span class="rtitle">Charged ${esc(D.dayMonth(t.date))}</span></span><span class="rend mon-rend"><span class="mon-amt">${inr(t.a)}</span></span></div>`).join('')}
      </div>
      ${wynCard({ text: done ? `I'll watch the card on the next charge date and tell you if it still comes.` : `${inr(l.amount * 12)} a year. Cancel it and I'll check the next charge date for you.` })}`,
      acts: done ? [['Undo: still paying', 'mon-leak-set', false, set('open')]] : [['I cancelled it', 'mon-leak-set', true, set('done')], ['Pause it for a month', 'mon-leak-set', false, set('paused')], ...(canRemind() ? [['Remind me at 21:00', 'mon-leak-remind', false, `data-id="${esc(l.id)}"`]] : []), ['Keep it', 'mon-leak-set', false, set('ok')]] });
  }
  if (l.kind === 'repeat') {
    const xs = D.smallFood(), by = new Map();
    for (const t of xs) { const k = t.m.replace(/ ·.*$/, ''); const r = by.get(k) ?? { m: k, n: 0, a: 0 }; r.n++; r.a += t.share; by.set(k, r); }
    const top = [...by.values()].sort((a, b) => b.a - a.a).slice(0, 4);
    return leakSheet({ title: esc(l.title), sub: `${plural(xs.length, 'time')} in ${D.MONTH.name} · ${inr(l.amount)}`, body: `
      <div class="group">${top.map((r) => `<div class="row ic">${tile('cup')}<span class="rbody"><span class="rtitle">${esc(r.m)}</span><span class="rmeta">${plural(r.n, 'time')}</span></span><span class="rend mon-rend"><span class="mon-amt">${inr(r.a)}</span></span></div>`).join('')}</div>
      ${wynCard({ text: `Small each time${S.budgets.college ? ` and ${l.amount > S.budgets.college ? 'more than' : 'about'} your whole College budget` : ''}. Not a problem by itself: it's the line that grows when the day is long.` })}`,
      acts: done ? [['Watch it again', 'mon-leak-set', false, set('open')]] : [['Fine, it\'s chai', 'mon-leak-set', true, set('ok')], ['Keep an eye on it', 'mon-leak-set', false, set('open')]] });
  }
  return leakSheet({ title: esc(l.title), sub: l.amount ? `${inr(l.amount)}${l.monthly ? ' a month' : ''} · flagged by ${esc(AGENT.name)}` : `Flagged by ${esc(AGENT.name)}`, body: wynCard({ text: esc(l.why || l.meta || 'Worth a look.') }),
    acts: done ? [['Undo', 'mon-leak-set', false, set('open')]] : [['Sorted', 'mon-leak-set', true, set('done')], ['It\'s fine', 'mon-leak-set', false, set('ok')]] });
}
on('mon-leak-set', (b) => {
  const id = b.dataset.id, v = b.dataset.v;
  closeSheet(b.closest('.sheet'));
  const l = D.leaks().find((x) => x.id === id);
  const undo = D.setLeak(id, v, { kind: b.dataset.kind, title: l?.title, amount: l?.amount });
  haptic(v === 'done' || v === 'paused' ? 14 : 6);
  const msg = { done: `${l?.title ?? 'It'} marked done. I'll watch the next charge`, paused: `Paused. ${inr(l?.amount ?? 0)} stays with you this month`, ok: 'Kept. I won\'t raise it again this month', open: 'Back on the leaks list' }[v];
  toast(msg, undo);
});
on('mon-leak-remind', async (b) => {
  closeSheet(b.closest('.sheet'));
  const l = D.leaks().find((x) => x.id === b.dataset.id);
  const at = new Date(`${D.today()}T21:00:00+05:30`).getTime();
  const r = await native.notify.schedule({ at: at > Date.now() ? at : at + 864e5, title: `Cancel ${l?.title ?? 'that subscription'}`, body: `${inr(l?.amount ?? 0)} a month. It takes about a minute.`, category: 'nudge', url: 'agenticos://money/flow' });
  toast(r.ok ? 'I\'ll remind you at 21:00' : 'Couldn\'t set the reminder on this phone');
});

// ═══ THE STATEMENT ═══════════════════════════════════════════════════════
// 1 · it arrives (a file, pasted text, scanned pages)  2 · the PC reads it  3 · he reviews what's new  4 · it's filed
const review = () => S.imports.find((x) => x.status === 'review');
const queued = () => S.imports.find((x) => x.status === 'queued' || x.status === 'reading');
export function openStatement() {
  const r = review(), q = queued(), last = S.imports.find((x) => x.status === 'filed');
  const el = monSheet({ title: 'File a bank statement', sub: `${esc(AGENT.name)} matches it to what's logged and files the rest`, cls: 'mon-import', body: `
    ${r ? `<div class="group"><button class="row ic mon-pdf" data-act="mon-st-open" data-id="${esc(r.id)}">${tile('doc')}<span class="rbody"><span class="rtitle">${esc(r.name || r.bank || 'Your statement')}</span><span class="rmeta">Ready to review · ${plural(r.counts?.new ?? 0, 'new spend')}</span></span><span class="btn sm tint mon-fake-btn" style="--c:var(--as-ink)" aria-hidden="true">Review</span></button></div>` : ''}
    ${q ? `<div class="group"><div class="row ic">${tile('doc')}<span class="rbody"><span class="rtitle">${esc(q.name || 'A statement')}</span><span class="rmeta">Waiting for your PC to read it</span></span><span class="spin" style="--c:var(--as)" aria-hidden="true"></span></div></div>` : ''}
    <div class="group">
      <label class="row ic mon-file-pick">${tile('share')}<span class="rbody"><span class="rtitle">Choose the file</span><span class="rmeta"><span class="ell">The PDF or CSV from your bank app or email</span></span></span>${I.chevR}<input type="file" accept=".pdf,.csv,.txt,.xls,application/pdf,text/csv,text/plain" data-st-file hidden></label>
      <button class="row ic" data-act="mon-st-paste">${tile('edit')}<span class="rbody"><span class="rtitle">Paste the text</span><span class="rmeta">Copied from the bank's site or app</span></span>${I.chevR}</button>
      <button class="row ic" data-act="mon-st-scan">${tile('camera')}<span class="rbody"><span class="rtitle">Scan the pages</span><span class="rmeta">With the Scan button</span></span>${I.chevR}</button>
    </div>
    ${D.DEMO ? `<p class="mon-label">Shared a minute ago</p><div class="group"><button class="row ic mon-pdf" data-act="mon-st-demo">${tile('doc')}<span class="rbody"><span class="rtitle">Statement_Oct2026.pdf</span><span class="rmeta">3 pages · from WhatsApp</span></span><span class="btn sm tint mon-fake-btn" style="--c:var(--as-ink)" aria-hidden="true">Read</span></button></div>` : ''}
    ${last ? `<p class="hint">Last filed ${esc(D.dayLabel(String(last.filed?.at ?? last.updated_at).slice(0, 10)))}: ${esc(last.bank ?? 'a statement')}${last.period ? `, ${esc(D.dayMonth(last.period.from))} to ${esc(D.dayMonth(last.period.to))}` : ''}.</p>` : '<p class="hint">Password-protected PDFs are fine: it asks for the password.</p>'}` });
  $('[data-st-file]', el)?.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) readFile(f, el); });
  return el;
}
on('mon-st-scan', () => { closeSheet(); api.scan('statement'); });
on('mon-st-demo', (b) => readFlow({ name: 'Statement_Oct2026.pdf' }, b.closest('.sheet')));
on('mon-st-open', (b) => { const imp = D.importOf(b.dataset.id); closeSheet(b.closest('.sheet')); if (imp) setTimeout(() => openReview(imp), 180); });
on('mon-st-paste', (b) => {
  closeSheet(b.closest('.sheet'));
  const el = monSheet({ title: 'Paste your statement', sub: 'Every row with its date and amount', body: `<label class="field mon-paste"><textarea data-st-text rows="9" placeholder="01/10/26  UPI-UBER-…  240.00  60,124.00"></textarea></label>
    <div class="pad"><button class="btn primary block" data-act="mon-st-pasted" style="--c:var(--as-fill)">Read it</button></div>` });
  setTimeout(() => $('[data-st-text]', el)?.focus(), 300);
});
on('mon-st-pasted', (b) => { const el = b.closest('.sheet'), text = $('[data-st-text]', el)?.value ?? ''; if (text.trim().length < 20) { toast('Paste a few rows of the statement'); return; } readFlow({ text, name: 'Pasted statement' }, el); });
async function readFile(f, sheet) {
  if (f.size > 8e6) { toast('That file is over 8 MB. Share one month at a time'); return; }
  const isPdf = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);
  if (isPdf) {
    const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, '')); r.readAsDataURL(f); });
    return readFlow({ pdf: b64, name: f.name }, sheet);
  }
  const text = await f.text();
  return readFlow({ csv: /\.csv$/i.test(f.name) || /csv/.test(f.type) ? text : undefined, text: /\.csv$/i.test(f.name) ? undefined : text, name: f.name }, sheet);
}
export function statementScan(result = {}) {
  const f = result.fields ?? {};
  const rows = (f.rows ?? []).filter((r) => r && r.amount != null);
  const el = monSheet({ title: 'File a bank statement', sub: `${esc(f.bank ?? 'Scanned pages')}${f.period ? ` · ${esc(f.period)}` : ''}`, cls: 'mon-import', body: '' });
  readFlow(rows.length ? { rows, bank: f.bank, name: f.bank ? `${f.bank} statement` : 'Scanned statement' } : { text: result.text ?? f.text ?? '', name: 'Scanned statement' }, el);
}
// the reading: pages light up while the PC reads, then the counts land and the review opens
async function readFlow(input, el) {
  if (!el?.isConnected) return;
  const head = $('.sheet-head h3', el); if (head) head.textContent = 'Reading the statement';
  const body = $('.sheet-body', el);
  body.innerHTML = `<div class="mon-read is-wait">
      <div class="mon-pages" aria-hidden="true">${[1, 2, 3].map((p) => `<span class="mon-pg" data-pg="${p}"><i></i><i></i><i></i><i></i><i></i><i></i></span>`).join('')}</div>
      <p class="mon-read-t"><span class="spin" style="--c:var(--as)" aria-hidden="true"></span><span data-step>Finding the rows</span></p>
      <span class="mon-read-bar" aria-hidden="true"><i data-bar></i></span>
      <div class="mon-read-n">
        <p><b class="met" data-n>0</b><span>rows</span></p><p><b class="met" data-n>0</b><span>matched</span></p>
        <p><b class="met c-as" data-n>0</b><span>new</span></p><p><b class="met" data-n>0</b><span>moved</span></p>
      </div>
    </div>`;
  const pages = $$('.mon-pg', body), step = $('[data-step]', body), bar = $('[data-bar]', body);
  let k = 0;
  const wait = setInterval(() => { k++; pages.forEach((p, i) => p.classList.toggle('is-on', i === k % 3)); step.textContent = ['Finding the rows', 'Matching what\'s logged', 'Sorting what\'s new'][k % 3]; bar.style.transform = `scaleX(${Math.min(0.9, 1 - 1 / (1 + k * 0.35)).toFixed(3)})`; }, 700);
  const r = await D.readStatement(input);
  clearInterval(wait);
  if (!el.isConnected) return;
  if (r.needsPassword) return askPassword(input, el, r.error);
  if (r.queued) { body.innerHTML = `<div class="mon-read"><p class="mon-read-t">${I.check}<span>Saved on this phone</span></p><p class="hint">Your PC reads it as soon as it's back online. It'll wait in Money for you to review.</p><div class="pad"><button class="btn block" data-act="close-sheet">Done</button></div></div>`; return; }
  if (r.error || !r.item) { body.innerHTML = `<div class="mon-read"><p class="mon-read-t c-needs">${I.x}<span>${esc(r.error ?? 'Couldn\'t read it')}</span></p><div class="pad"><button class="btn block" data-act="close-sheet">Close</button></div></div>`; return; }
  const imp = r.item, c = imp.counts ?? {};
  $('.mon-read', body).classList.remove('is-wait');
  const targets = [c.rows ?? 0, c.matched ?? 0, (c.new ?? 0) + (c.income ?? 0) + (c.sub ?? 0) + (c.ask ?? 0), c.moved ?? 0];
  const nums = $$('[data-n]', body), D0 = reduced() ? 10 : 900, t0 = performance.now();
  const tick = (now) => {
    if (!el.isConnected) return;
    const q = Math.min(1, (now - t0) / D0), e = 1 - Math.pow(1 - q, 3);
    bar.style.transform = `scaleX(${(0.9 + 0.1 * q).toFixed(3)})`;
    pages.forEach((p) => { p.classList.remove('is-on'); p.classList.add('is-done'); });
    nums.forEach((n, i) => { n.textContent = Math.round(targets[i] * e); });
    if (q < 1) requestAnimationFrame(tick); else land();
  };
  const land = () => {
    haptic(10);
    const todo = targets[2];
    $('.mon-read-t', body).innerHTML = `${I.check}<span>${esc(imp.bank ?? 'Statement')} · ${todo ? `${plural(todo, 'row')} to check` : 'everything is already in'}</span>`;
    symbol($('.mon-read-t svg', body), 'draw');
    $('.mon-read', body).insertAdjacentHTML('beforeend', `<div class="pad mon-read-go"><button class="btn primary block" data-act="mon-st-review" data-id="${esc(imp.id)}" style="--c:var(--as-fill)">${todo ? `Review ${todo}` : 'See it'}</button></div>`);
    el._imp = imp;
  };
  requestAnimationFrame(tick);
}
function askPassword(input, el, msg) {
  const body = $('.sheet-body', el);
  body.innerHTML = `<div class="mon-read"><p class="mon-read-t">${G('lock')}<span>${esc(msg ?? 'The statement has a password')}</span></p>
    <label class="field">${I.lock ?? ''}<input type="password" data-st-pw placeholder="Statement password" autocomplete="off"></label>
    <div class="pad"><button class="btn primary block" data-act="mon-st-pw" style="--c:var(--as-fill)">Open it</button></div><p class="hint">Used once to read it on your PC; never saved.</p></div>`;
  el._input = input;
  setTimeout(() => $('[data-st-pw]', el)?.focus(), 200);
}
on('mon-st-pw', (b) => { const el = b.closest('.sheet'), pw = $('[data-st-pw]', el)?.value; if (!pw) return; readFlow({ ...el._input, password: pw }, el); });
on('mon-st-review', (b) => { const el = b.closest('.sheet'), imp = el._imp ?? D.importOf(b.dataset.id); closeSheet(el); if (imp) setTimeout(() => openReview(imp), 180); });

const ASK_OPTS = [['loan', 'They\'ll pay me back'], ['gift', 'A gift'], ['add', 'A spend'], ['skip', 'Skip for now']];
const railOf = (r) => { const raw = String(r.desc ?? ''); const vpa = r.vpa ?? raw.match(/[a-z0-9._]{2,}@[a-z]{2,}/i)?.[0]; if (vpa) return `UPI · ${vpa}`; const p = (r.rail || raw.split(/[\/\-]/)[0] || '').toUpperCase(); return { NACH: 'Autopay', ACH: 'Autopay', IMPS: 'Bank transfer', NEFT: 'Bank transfer', RTGS: 'Bank transfer', ATM: 'ATM', POS: 'Card' }[p] ?? (p || 'Bank'); };
export function openReview(imp) {
  const rows = (imp.rows ?? []).map((x) => ({ ...x, on: x.status === 'new' || x.status === 'income' || x.status === 'sub', ans: null }));
  const news = rows.filter((x) => ['new', 'income', 'sub', 'ask'].includes(x.status));
  const matched = rows.filter((x) => x.status === 'matched'), moved = rows.filter((x) => x.status === 'moved');
  const st = { showMatched: false };
  const period = imp.period ? `${D.dayMonth(imp.period.from)} to ${D.dayMonth(imp.period.to)}` : '';
  pushMoney({ title: imp.bank ?? 'Statement', back: 'Money', cls: 'mon-review', render(sc, page) {
    const adds = () => news.filter((x) => (x.status === 'ask' ? x.ans && x.ans !== 'skip' : x.on));
    const draw = () => {
      const a = adds(), out = a.filter((x) => x.dir !== 'cr' && x.ans !== 'loan').reduce((n, x) => n + x.amount, 0);
      const missed = news.filter((x) => x.status === 'new').length;
      sc.innerHTML = pageHead({ title: esc(imp.bank ?? 'Your statement'), sub: [esc(imp.name ?? ''), period, plural(rows.length, 'row')].filter(Boolean).join(' · ') })
        + `<div class="mon-tiles mon-tiles-3">
            <div class="surface mon-tile"><small>New</small><b class="met c-as">${news.length}</b><span>To check</span></div>
            <div class="surface mon-tile"><small>Matched</small><b class="met">${matched.length}</b><span>Already in</span></div>
            <div class="surface mon-tile"><small>Moved</small><b class="met">${moved.length}</b><span>Not spent</span></div></div>`
        + wynCard({ text: news.length ? `${matched.length ? `${plural(matched.length, 'row')} matched what's already in Money. ` : ''}${missed ? (missed === 1 ? `1 spend wasn't logged yet` : `${missed} spends weren't logged yet`) : 'Nothing was missed'}${news.some((x) => x.status === 'sub') ? '; one looks like a subscription you don\'t have in Money' : ''}${news.some((x) => x.status === 'ask') ? `, and ${news.filter((x) => x.status === 'ask').length === 1 ? 'one only you can answer' : 'a few only you can answer'}` : ''}.` : 'Everything on it is already in Money. Nothing counted twice.' })
        + (news.length ? `${sh('New', { count: news.length })}<p class="hint mon-hint-pad mon-hint-top">Categories are ${esc(AGENT.name)}'s guesses. Tap one to change it; she learns from it.</p><div class="group mon-newg">${news.map(newRow).join('')}</div>` : '')
        + `${sh('Already in Money', { count: matched.length, act: matched.length ? 'mon-st-toggle' : '', label: st.showMatched ? 'Hide' : 'Show' })}
           ${st.showMatched ? `<div class="group mon-matchg">${matched.map((x) => `<div class="row ic">${tile(x.dir === 'cr' ? 'inflow' : 'check', x.dir === 'cr' ? 'mon-in-tile' : '')}<span class="rbody"><span class="rtitle">${esc(x.merchant)}</span><span class="rmeta"><span class="ell">${esc(D.dayLabel(x.date))} · ${esc(x.why || 'matched')}</span></span></span><span class="rend mon-rend"><span class="mon-amt${x.dir === 'cr' ? ' c-as' : ''}">${x.dir === 'cr' ? '+' : ''}${inr(x.amount)}</span></span></div>`).join('')}</div>`
            : `<p class="hint mon-hint-pad">Each one matched something already logged to the rupee and the day, so nothing is counted twice.</p>`}`
        + (moved.length ? `${sh('Moved, not spent', { count: moved.length })}<div class="group">${moved.map((x) => `<div class="row ic">${tile('arrowR')}<span class="rbody"><span class="rtitle">${esc(x.merchant)}</span><span class="rmeta"><span class="ell">${esc(D.dayLabel(x.date))} · ${esc(x.why)}</span></span></span><span class="rend mon-rend"><span class="mon-amt mon-amt-soft">${inr(x.amount)}</span></span></div>`).join('')}</div>` : '')
        + `<div class="mon-review-pad"></div>`;
      let bar = $('.mon-review-bar', page);
      if (!bar) { page.insertAdjacentHTML('beforeend', '<div class="mon-review-bar chrome"></div>'); bar = $('.mon-review-bar', page); }
      bar.innerHTML = `<span class="mon-rb-t"><b>${plural(a.length, 'row')}</b><small>${inr(out)} into Money</small></span><button class="btn primary" data-act="mon-st-confirm" style="--c:var(--as-fill)"${imp.status === 'filed' ? ' disabled' : ''}>${imp.status === 'filed' ? 'Filed' : 'File them'}</button>`;
    };
    const newRow = (x) => {
      const isSub = x.status === 'sub', isAsk = x.status === 'ask', isIn = x.status === 'income';
      const c = isIn ? D.incat(x.category ?? 'otherin') : x.category && x.category !== 'bills' ? D.cat(x.category) : D.cat('other');
      return `<div class="mon-new${x.on || isAsk ? '' : ' is-off'}${isAsk ? ' is-ask' : ''}" data-id="${x.id}">
        <div class="row ic">
          ${isAsk ? `<span class="tile mon-mono" aria-hidden="true">${esc((x.person ?? x.merchant)[0] ?? '?')}</span>` : `<button class="check${x.on ? ' done' : ''}" data-act="mon-st-on" data-id="${x.id}" aria-label="${x.on ? 'Leave out' : 'Include'} ${esc(x.merchant)}">${I.check}</button>`}
          <span class="rbody"><span class="rtitle">${esc(x.merchant)}</span><span class="rmeta"><span class="ell">${esc(D.dayLabel(x.date))} · ${esc(railOf(x))}</span></span></span>
          <span class="rend mon-rend"><span class="mon-amt${isIn ? ' c-as' : ''}">${isIn ? '+' : ''}${inr(x.amount)}</span></span>
        </div>
        ${x.why ? `<p class="mon-why${isAsk ? ' c-needs' : ''}">${esc(x.why)}</p>` : ''}
        <div class="mon-new-opts">${isAsk ? ASK_OPTS.map(([v, l]) => `<button class="chip sm${x.ans === v ? ' on' : ''}" data-act="mon-st-ans" data-id="${x.id}" data-v="${v}">${l}</button>`).join('')
          : isSub ? `<span class="pill" style="--c:var(--needs-ink)">${G('repeat')}New subscription</span><span class="mon-new-c">Goes into bills and leaks</span>`
            : `<button class="chip sm" data-act="mon-st-cat" data-id="${x.id}">${G(c.icon)}${esc(c.name)}${I.chevD}</button>`}</div>
      </div>`;
    };
    page._rows = rows; page._draw = draw; page._st = st; page._imp = imp;
    draw();
    if (!reduced()) stagger($$('.mon-new', sc), { y: 10, each: 35, max: 300 });
  } });
}
const reviewPage = (el) => el.closest('.page');
const redrawKeep = (pg) => { const s = $('.scroll', pg); const y = s?.scrollTop ?? 0; pg._draw(); if (s) s.scrollTop = y; };
on('mon-st-on', (b) => { const pg = reviewPage(b), x = pg._rows.find((n) => n.id === b.dataset.id); x.on = !x.on; haptic(5); redrawKeep(pg); });
on('mon-st-ans', (b) => { const pg = reviewPage(b), x = pg._rows.find((n) => n.id === b.dataset.id); x.ans = b.dataset.v; haptic(6); redrawKeep(pg); });
on('mon-st-toggle', (b) => { const pg = reviewPage(b); pg._st.showMatched = !pg._st.showMatched; haptic(4); redrawKeep(pg); });
on('mon-st-cat', (b) => {
  const pg = reviewPage(b), x = pg._rows.find((n) => n.id === b.dataset.id), isIn = x.status === 'income';
  const list = isIn ? D.INCATS : D.CATS;
  const el = monSheet({ title: `${esc(x.merchant)} · ${inr(x.amount)}`, sub: isIn ? 'Where did it come from?' : 'Which budget is it?', body: `<div class="group">${list.map((c) => `<button class="row ic" data-act="mon-st-catpick" data-c="${c.id}">${isIn ? tile(c.icon, 'mon-in-tile') : catTile(c.id)}<span class="rbody"><span class="rtitle">${esc(c.name)}</span></span>${c.id === x.category ? I.check : ''}</button>`).join('')}</div>` });
  el._x = x; el._pg = pg;
});
on('mon-st-catpick', (b) => { const sh = b.closest('.sheet'); sh._x.category = b.dataset.c; sh._x.on = true; closeSheet(sh); haptic(6); redrawKeep(sh._pg); });
on('mon-st-confirm', (b) => {
  const pg = reviewPage(b), rows = pg._rows, imp = pg._imp;
  if (imp.status === 'filed') return;
  const decisions = {};
  for (const x of rows) {
    if (x.status === 'ask') decisions[x.id] = { action: x.ans && x.ans !== 'skip' ? x.ans : 'skip', category: x.ans === 'add' ? 'other' : undefined };
    else if (['new', 'income', 'sub'].includes(x.status)) decisions[x.id] = x.on ? { action: x.status === 'income' ? 'income' : x.status === 'sub' ? 'bill' : 'add', category: x.category } : 'skip';
  }
  const before = D.hasBudgets() ? D.todayAllow() : null;
  const filed = D.fileStatement({ ...imp, rows: imp.rows.map((r) => ({ ...r, category: rows.find((x) => x.id === r.id)?.category ?? r.category })) }, decisions);
  S.lastFiled = { ...filed, before, after: D.hasBudgets() ? D.todayAllow() : null, bank: imp.bank, at: Date.now() };
  pg.querySelector('.mon-review-bar')?.remove();
  pop();
  haptic(16);
  toast(`Filed ${plural(filed.n, 'spend')} from the statement · ${inr(filed.out)}`);
});

// ═══ INCOME SOURCES (injections) ════════════════════════════════════════
const READ = {
  wonder: 'Your share of online sales at the shop.',
  client: 'Northwind client payments. They count as your income, in the same total as everything else.',
  pocket: 'From Dad. Steady, and the one you can\'t grow.',
  refund: 'Money back from a return or a cancelled order.', gift: 'Money someone gave you.', otherin: 'Anything else that came in.',
};
on('mon-job', (el) => api.openJob(el.dataset.id));
on('mon-project', (el) => api.openProject(el.dataset.id));
export function openSource(id) {
  const c = D.incat(id), key = c.id;
  const doc = D.sourceOf(key);
  pushMoney({ title: c.name, back: 'Flow', render(sc) {
    const draw = () => {
      const all = D.m.inAll.filter((x) => x.c === key).sort((a, b) => (a.date < b.date ? 1 : -1));
      const mine = all.filter((x) => x.ym === D.MONTH.iso), prevYm = D.addMonths(D.MONTH.iso, -1);
      const tot = mine.reduce((n, x) => n + x.a, 0), prev = all.filter((x) => x.ym === prevYm).reduce((n, x) => n + x.a, 0), d = tot - prev;
      const months = [-3, -2, -1, 0].map((k) => { const ym = D.addMonths(D.MONTH.iso, k); return { ym, m: D.monthName(ym).slice(0, 3), a: all.filter((x) => x.ym === ym).reduce((n, x) => n + x.a, 0) }; });
      const bmax = Math.max(1, ...months.map((x) => x.a));
      const pend = key === 'client' ? S.pending : [];
      sc.innerHTML = pageHead({ title: esc(doc?.name ?? c.name), sub: esc(doc?.sub ?? (key === 'client' ? 'Northwind clients · counted as your income' : `Money in · ${D.MONTH.name}`)) })
        + `<section class="surface mon-srchero"><p class="mon-hk">In ${esc(D.MONTH.name)}</p><p class="met mon-big">${fig(tot)}</p>
            <p class="mon-hsub">${!prev && !tot ? 'Nothing yet this month' : d > 0 ? `<b class="c-as">+${inr(d)}</b> on ${esc(D.monthName(prevYm))}` : d < 0 ? `<b class="c-needs">−${inr(-d)}</b> on ${esc(D.monthName(prevYm))}` : `Same as ${esc(D.monthName(prevYm))}`}</p>
            <div class="mon-weeks mon-pay">${months.map((x) => `<span class="mon-wk${x.ym === D.MONTH.iso ? ' is-now' : ''}"><b class="num">${x.a ? inr(x.a) : ''}</b><span class="mon-wk-t"><i style="--h:${(x.a / bmax).toFixed(3)}"></i></span><small>${x.m}</small></span>`).join('')}</div>
          </section>`
        + wynCard({ text: esc(doc?.read ?? READ[key] ?? '') })
        + (pend.length ? `${sh('Still to come in')}<div class="group">${pend.map((p) => `<div class="row ic">${tile('rocket')}<span class="rbody"><span class="rtitle">${esc(p.name)}</span><span class="rmeta"><span class="ell">${esc(p.what ?? '')}${p.note ? ` · ${esc(p.note)}` : ''}</span></span></span><span class="rend mon-rend"><span class="mon-amt mon-amt-soft">${p.amount ? `${p.approx ? 'about ' : ''}${inr(p.amount)}` : esc(p.label ?? 'to price')}</span></span></div>`).join('')}</div>` : '')
        + `${sh('Payments', { count: all.length })}<div class="group">${all.slice(0, 40).map((x) => incomeRow({ ...x, d: x.ym === D.MONTH.iso ? x.d : null, src: x.c, name: x.doc.merchant || c.name })).join('') || emptyRow('No payments logged yet', `Log one from the + button, or tell ${esc(AGENT.name)}`, 'mon-add-in', 'Log one')}</div>`
        + (c.earned ? `<div class="group mon-goalrow"><button class="row ic" data-act="mon-goal-money">${ring(D.revenue() / D.REVENUE_GOAL, 'as', 38, 5, { k: D.timeLeft() > 0 ? 1 - D.timeLeft() : 0 })}<span class="rbody"><span class="rtitle">Feeds ₹2 lakh a month</span><span class="rmeta">${inr(D.revenue())} earned in ${esc(D.MONTH.name)}</span></span>${I.chevR}</button></div>` : '');
      pulse(sc);
    };
    draw();
    const off = D.onChange(() => { if (sc.isConnected) draw(); else off(); });
  } });
}

// ═══ THE STREAK ═════════════════════════════════════════════════════════
export function openStreak() {
  const n = D.streak(), left = D.todayLeft(), best = D.bestStreak();
  const days = Array.from({ length: 7 }, (_, i) => D.addDays(D.today(), i - 6));
  const cal = [];
  const lead = (D.MONTH.first + 6) % 7;   // Monday first
  for (let i = 0; i < lead; i++) cal.push('<span class="mon-sc is-pad" aria-hidden="true"></span>');
  for (let d = 1; d <= D.MONTH.days; d++) {
    const date = D.dateOf(d), started = date >= D.m.start;
    const cls = d > D.TODAY ? 'is-fut' : d === D.TODAY ? (left >= 0 ? 'is-today' : 'is-today is-over') : !started ? 'is-fut' : D.keptOn(date) ? 'is-kept' : 'is-over';
    cal.push(`<span class="mon-sc ${cls}" aria-label="${D.dateLong(d)}${d < D.TODAY && started ? (D.keptOn(date) ? ', kept' : ', over') : ''}"><span>${d}</span></span>`);
  }
  const el = monSheet({ cls: 'mon-streaksheet', head: `<div class="sheet-head"><div class="sh-text"><h3>${plural(n, 'day')} under budget</h3><p>${!D.hasBudgets() ? 'Set budgets to start one' : left >= 0 ? `${inr(left)} to spare today. Stay under and it's ${n + 1}` : `Today is ${inr(-left)} over`}</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: `
      <div class="mon-sweek">${days.map((date) => { const isT = date === D.today(), ok = isT ? left >= 0 : D.keptOn(date), before = date < D.m.start; return `<span class="mon-sd${isT ? ' is-today' : ''}${before ? '' : ok ? ' is-ok' : ' is-miss'}"><i aria-hidden="true">${isT ? I.flame : before ? '' : ok ? I.check : I.x}</i><small>${D.wdName(date)}</small></span>`; }).join('')}</div>
      <p class="mon-sbest">${best.n ? `Your best is ${plural(best.n, 'day')}, ${esc(D.dayMonth(best.from))} to ${esc(D.dayMonth(best.to))}` : 'Your first kept day starts the count'}</p>
      <div class="mon-scal"><div class="mon-cal-h">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div><div class="mon-scal-g">${cal.join('')}</div></div>
      <div class="group mon-sprefs">
        <div class="row"><span class="rbody"><span class="rtitle">Nudge me at 21:30 if I'm close</span><span class="rmeta">When less than ₹200 is left</span></span><button class="switch${S.prefs.nudge ? ' on' : ''}" data-act="mon-pref" data-k="nudge" aria-label="Nudge me at 21:30" aria-pressed="${!!S.prefs.nudge}"></button></div>
        <div class="row"><span class="rbody"><span class="rtitle">Borrow from tomorrow to save it</span><span class="rmeta">Once a week, up to ₹300</span></span><button class="switch${S.prefs.borrow ? ' on' : ''}" data-act="mon-pref" data-k="borrow" aria-label="Borrow from tomorrow" aria-pressed="${!!S.prefs.borrow}"></button></div>
        <div class="row"><span class="rbody"><span class="rtitle">Call me before it breaks</span><span class="rmeta">${esc(AGENT.name)} rings if a spend would end it</span></span><button class="switch${S.prefs.call ? ' on' : ''}" data-act="mon-pref" data-k="call" aria-label="Call me before it breaks" aria-pressed="${!!S.prefs.call}"></button></div>
      </div>
      <p class="hint">A day counts when you spend less than that day's budget. Bills and subscriptions don't count.</p>` });
  if (!reduced()) stagger($$('.mon-sd', el), { y: 8, each: 30 });
}
on('mon-pref', (b) => { const k = b.dataset.k, v = !S.prefs[k]; D.setPref(k, v); b.classList.toggle('on', v); b.setAttribute('aria-pressed', String(v)); haptic(6); });

// ═══ HER WEEK REPORT ════════════════════════════════════════════════════
export const lastWeekFrom = () => { const t = D.today(), wd = new Date(`${t}T00:00:00Z`).getUTCDay(); return D.addDays(t, -(((wd + 6) % 7) + 7)); };
export function openReport(from = lastWeekFrom()) {
  const w = D.weekReport(from);
  const leaks = D.leaks().filter((l) => l.state === 'open' && l.monthly);
  const one = leaks[0] ? `One thing for this week: ${leaks[0].title}, ${inr(leaks[0].amount)} a month.` : w.over.length ? `${w.over.join(' and ')} went over. The rest held.` : w.count ? 'Every day held. Keep it going.' : '';
  monSheet({ title: 'Your money week', sub: `${D.wdName(w.from)} ${D.dayMonth(w.from)} – ${D.wdName(w.to)} ${D.dayMonth(w.to)} · from ${esc(AGENT.name)}`, cls: 'mon-reportsheet', body: !w.count && !w.came ? `<div class="group">${emptyRow('Nothing logged that week', `Log a spend or share a statement and ${esc(AGENT.name)} writes this every Sunday.`)}</div>` : `
    <div class="mon-tiles">
      <div class="surface mon-tile"><small>Spent</small><b class="met">${inr(w.spent)}</b><span>${w.allowed ? `of ${inr(w.allowed)} allowed` : `${plural(w.count, 'spend')}`}</span></div>
      <div class="surface mon-tile"><small>Days kept</small><b class="met">${w.kept}<span class="u">of ${w.days}</span></b><span>${w.over.length ? `${esc(w.over.join(', '))} went over` : 'None went over'}</span></div>
    </div>
    <div class="group mon-rep">
      ${w.big ? `<div class="row ic">${catTile(w.big.c)}<span class="rbody"><span class="rtitle">Biggest: ${esc(w.big.m)}</span><span class="rmeta">${inr(w.big.share)} on ${esc(D.dayMonth(w.big.date))} · ${esc(w.big.note || D.cat(w.big.c).name)}</span></span></div>` : ''}
      ${w.came ? `<div class="row ic">${tile('inflow', 'mon-in-tile')}<span class="rbody"><span class="rtitle">Came in: ${inr(w.came)}</span><span class="rmeta">${esc(w.cameFrom.join(', '))}</span></span></div>` : ''}
      ${w.bills.slice(0, 3).map((b) => `<div class="row ic">${tile('repeat')}<span class="rbody"><span class="rtitle">${esc(b.m)} charged ${inr(b.a)}</span></span></div>`).join('')}
      ${w.byCat.slice(0, 3).map((c) => `<div class="row ic">${catTile(c.id)}<span class="rbody"><span class="rtitle">${esc(c.name)}</span></span><span class="rend mon-rend"><span class="mon-amt">${inr(c.a)}</span></span></div>`).join('')}
    </div>
    ${one ? wynCard({ text: esc(one) }) : ''}
    <p class="hint">Every Sunday at 10:00, as a notification and here.</p>` });
}
on('mon-goal-money', () => { const g = GOALS.find((x) => (x.aspects ?? []).includes('money')); if (g) api.openGoal(g.id); else api.openAspect('mission'); });
on('mon-add-in', () => api.logExpense({ type: 'in' }));

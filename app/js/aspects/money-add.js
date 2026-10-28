// Money · adding and reading one transaction: the amount-first keypad (the app's primary action), a scanned receipt,
// one transaction's sheet (with the UPI message the agent read), money in, splitting with a person, and saving the
// streak. Every write goes through money-data.js (offline-first). Owner: the Money agent.
import { $, $$, esc, on, haptic, toast, closeSheet } from '../core.js';
import { I } from '../icons.js';
import { api, has } from '../bus.js';
import { AGENT, PEOPLE, person } from '../data.js';
import * as D from './money-data.js';
import { guessCat, looksLikeBill } from './money-calc.js';
import { G, tile, catTile, fig, rawMessage, plural, monSheet } from './money-ui.js';
import { symbol } from '../motion.js';

const { S, inr } = D;
const people = () => PEOPLE.filter((p) => p && p.id && p.name);

// ── the keypad ──────────────────────────────────────────────────────────
// prefill: { amount, cat, note, merchant, type: 'out' | 'in' }
export function openAdd(prefill = {}) {
  const st = {
    type: prefill.type === 'in' ? 'in' : 'out',
    digits: prefill.amount ? String(prefill.amount) : '',
    cat: prefill.cat ?? (prefill.note || prefill.merchant ? guessFor(prefill) : null), note: prefill.note ?? '', merchant: prefill.merchant ?? '',
    date: D.today(), pay: 'upi', split: null, repeat: null,
  };
  const head = `<div class="sheet-head mon-add-head">
      <div class="seg sm mon-type" data-seg="mon-type" role="tablist"><button data-v="out" role="tab" aria-selected="${st.type === 'out'}">Expense</button><button data-v="in" role="tab" aria-selected="${st.type === 'in'}">Income</button></div>
      <button class="sheet-close" data-act="mon-add-scan" aria-label="Scan a receipt instead">${I.scan}</button>
      <button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`;
  const el = monSheet({ cls: 'mon-add', head, body: (b) => {
    b.innerHTML = `
      <div class="mon-amt-in" data-amt aria-live="polite"><span class="mon-c">₹</span><span data-digits>0</span></div>
      <p class="mon-impact" data-impact></p>
      <label class="field mon-note">${I.edit}<input data-note placeholder="What for? Optional" maxlength="40" enterkeyhint="done" value="${esc(st.note || st.merchant)}"></label>
      <div class="mon-cgrid" data-cats></div>
      <div class="mon-opts" data-opts></div>
      <div class="mon-keys" role="group" aria-label="Amount keypad">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'].map((k) => `<button class="mon-key" data-act="mon-key" data-k="${k}" aria-label="${k === 'back' ? 'Delete' : k === '.' ? 'Decimal point' : k}">${k === 'back' ? G('back') : k}</button>`).join('')}
      </div>
      <button class="btn primary block mon-save" data-act="mon-add-save" style="--c:var(--as-fill)" disabled>Add</button>`;
  }, onClose: () => document.removeEventListener('keydown', el._key) });
  el._st = st;
  drawAdd(el);
  $('[data-seg="mon-type"]', el).addEventListener('change', (e) => { st.type = e.detail; st.cat = null; drawAdd(el); });
  // the note picks the category as he types (chai → Food), until he picks one himself
  $('[data-note]', el).addEventListener('input', (e) => { st.note = e.target.value; if (!st.picked && st.type === 'out' && st.note.trim().length > 2) { const g = guessFor({ note: st.note }); if (g && g !== 'other' && g !== st.cat) { st.cat = g; drawAdd(el); } } });
  // a keyboard works too (the desktop preview, a hardware keyboard on the phone)
  el._key = (e) => {
    if (e.target.matches('input, textarea')) { if (e.key === 'Enter') e.target.blur(); return; }
    if (/^[0-9.]$/.test(e.key)) { press(el, e.key); e.preventDefault(); }
    else if (e.key === 'Backspace') { press(el, 'back'); e.preventDefault(); }
    else if (e.key === 'Enter') { $('[data-act="mon-add-save"]', el)?.click(); }
  };
  document.addEventListener('keydown', el._key);
  return el;
}
function guessFor({ note = '', merchant = '' }) { const t = `${merchant} ${note}`.trim(); if (!t) return null; return looksLikeBill(t) ? null : guessCat(merchant, note); }
const amountOf = (st) => Number.parseFloat(st.digits) || 0;
function showDigits(st) {
  if (!st.digits) return '0';
  const [i, f] = st.digits.split('.');
  return `${Number(i || 0).toLocaleString('en-IN')}${f != null ? `.${f}` : ''}`;
}
function impactLine(st) {
  const a = amountOf(st);
  if (st.type === 'in') { const t = D.incomeTotal(); return a ? `In this month: ${inr(t)} → <b>${inr(t + a)}</b>` : `${inr(t)} has come in this month`; }
  if (st.date !== D.today()) return a ? `Goes on yesterday, ${D.dayMonth(st.date)}. Today's budget stays ${inr(D.todayAllow())}` : `Goes on yesterday, ${D.dayMonth(st.date)}`;
  const share = st.split ? a / 2 : a;
  if (!D.hasBudgets()) { const sp = D.todaySpent(); return a ? `Today: ${inr(sp)} → <b>${inr(sp + share)}</b> spent` : sp ? `${inr(sp)} spent today` : 'Set budgets to see what\'s left today'; }
  const left = D.todayLeft(), after = left - share;
  if (!a) return left >= 0 ? `${inr(left)} left today` : `<span class="c-needs">${inr(-left)} over today already</span>`;
  if (after >= 0) return `${inr(left)} → <b>${inr(after)}</b> left today${st.split ? ' · your half' : ''}`;
  return `<span class="c-needs">${inr(-after)} over today's ${inr(D.todayAllow())}</span>`;
}
function drawAdd(el) {
  const st = el._st, cats = st.type === 'in' ? D.INCATS : D.CATS;
  const dg = $('[data-digits]', el);
  dg.textContent = showDigits(st); dg.classList.toggle('is-empty', !st.digits);
  $('[data-amt]', el).classList.toggle('is-long', st.digits.length > 6);
  $('[data-impact]', el).innerHTML = impactLine(st);
  $('[data-cats]', el).innerHTML = cats.map((c) => `<button class="mon-cpick${st.cat === c.id ? ' on' : ''}" data-act="mon-cpick" data-id="${c.id}" aria-pressed="${st.cat === c.id}">
      <span class="tile">${G(c.icon)}</span><span>${esc(c.name.replace(' & drinks', '').replace(' & gym', ''))}</span></button>`).join('');
  const sp = st.split ? person(st.split) : null;
  $('[data-opts]', el).innerHTML = [
    `<button class="chip sm" data-act="mon-opt" data-o="day">${I.cal}${st.date === D.today() ? 'Today' : 'Yesterday'}</button>`,
    st.type === 'out' ? `<button class="chip sm" data-act="mon-opt" data-o="pay">${G(st.pay === 'cash' ? 'wallet' : st.pay === 'card' ? 'card' : 'phone')}${st.pay === 'cash' ? 'Cash' : st.pay === 'card' ? 'Card' : 'UPI'}</button>` : '',
    st.type === 'out' && people().length ? `<button class="chip sm${sp ? ' on' : ''}" data-act="mon-opt" data-o="split">${G('split')}${sp ? `Half with ${esc(sp.name)}` : 'Split'}</button>` : '',
    `<button class="chip sm${st.repeat ? ' on' : ''}" data-act="mon-opt" data-o="repeat">${G('repeat')}${st.repeat ? `Every ${st.repeat}` : 'Repeat'}</button>`,
  ].join('');
  const a = amountOf(st), save = $('[data-act="mon-add-save"]', el);
  save.disabled = !(a > 0 && st.cat);
  save.textContent = !a ? (st.type === 'in' ? 'Add income' : 'Add expense') : !st.cat ? 'Pick a category' : `Add ${inr(a)}${st.type === 'in' ? ' income' : ''}`;
}
function press(el, k) {
  const st = el._st;
  if (k === 'back') st.digits = st.digits.slice(0, -1);
  else if (k === '.') { if (!st.digits.includes('.')) st.digits = (st.digits || '0') + '.'; }
  else {
    const [i, f] = st.digits.split('.');
    if (f != null && f.length >= 2) { haptic(20); return; }
    if (f == null && (i ?? '').length >= 7) { haptic(20); return; }
    st.digits = st.digits === '0' ? k : st.digits + k;
  }
  haptic(4);
  const key = $(`.mon-key[data-k="${k === '.' ? '.' : k}"]`, el);
  key?.classList.add('is-hit'); setTimeout(() => key?.classList.remove('is-hit'), 110);
  drawAdd(el);
}
on('mon-key', (b) => press(b.closest('.sheet'), b.dataset.k));
on('mon-cpick', (b) => { const el = b.closest('.sheet'); el._st.cat = b.dataset.id; el._st.picked = true; haptic(6); drawAdd(el); symbol($('.tile', $(`.mon-cpick[data-id="${b.dataset.id}"]`, el)), 'bounce'); });
on('mon-opt', (b) => {
  const el = b.closest('.sheet'), st = el._st, o = b.dataset.o;
  haptic(5);
  if (o === 'day') st.date = st.date === D.today() ? D.addDays(D.today(), -1) : D.today();
  if (o === 'pay') st.pay = { upi: 'cash', cash: 'card', card: 'upi' }[st.pay];
  if (o === 'repeat') st.repeat = { null: 'week', week: 'month', month: null }[String(st.repeat)];
  if (o === 'split') { if (st.split) st.split = null; else return pickSplit(el); }
  drawAdd(el);
});
on('mon-add-scan', () => { closeSheet(); api.scan('receipt'); });
// split with one of the people in your life: halves, they owe you their half
function pickSplit(addEl) {
  const ppl = people();
  const el = monSheet({ title: 'Split it', sub: 'Halves. They owe you their half until they pay you back', body: `<div class="group">${ppl.map((p) => `
    <button class="row ic" data-act="mon-split-pick" data-id="${p.id}"><span class="tile mon-mono" aria-hidden="true">${esc(p.name[0])}</span><span class="rbody"><span class="rtitle">${esc(p.name)}</span><span class="rmeta"><span class="ell">${esc(p.role ?? '')}</span></span></span></button>`).join('')}</div>` });
  el._add = addEl;
}
on('mon-split-pick', (b) => { const sh = b.closest('.sheet'), addEl = sh._add; closeSheet(sh); if (!addEl?.isConnected) return; addEl._st.split = b.dataset.id; haptic(6); drawAdd(addEl); });

on('mon-add-save', (b) => {
  const el = b.closest('.sheet'), st = el._st, a = amountOf(st);
  if (!(a > 0) || !st.cat) return;
  const leftBefore = D.todayLeft(), streakBefore = D.streak();
  closeSheet(el);
  haptic(12);
  if (st.type === 'in') {
    const c = D.incat(st.cat);
    const x = D.addTx({ kind: 'in', amount: a, category: st.cat, merchant: st.note || c.name, date: st.date, recurring: st.repeat });
    toast(`Added ${inr(a)} coming in`, D.removeTx.bind(null, x.id));
    return;
  }
  const c = D.cat(st.cat), p = st.split ? person(st.split) : null;
  const tx = D.addTx({ amount: a, category: st.cat, merchant: st.note || st.merchant || '', note: st.repeat ? `Every ${st.repeat}` : '', date: st.date, pay: st.pay,
    split: p ? { person: p.id, name: p.name, share: Math.round(a / 2) } : null, recurring: st.repeat });
  toast(`Added ${inr(a)} · ${c.name}`, D.removeTx.bind(null, tx.id));
  // it tipped today over: the streak can be saved by borrowing from tomorrow
  const leftAfter = D.todayLeft();
  if (D.hasBudgets() && st.date === D.today() && leftBefore >= 0 && leftAfter < -0.5 && streakBefore > 0) setTimeout(() => offerBorrow(-leftAfter, streakBefore), 700);
});

// ── save the streak: a money streak freeze ──────────────────────────────
const BORROW_MAX = 300;
function offerBorrow(over, n) {
  const ok = over <= BORROW_MAX && S.prefs.borrow !== false && D.canBorrow();
  const text = ok ? `That puts today ${inr(over)} over. Borrow ${inr(over)} from tomorrow and keep your ${n}-day streak?`
    : `That puts today ${inr(over)} over${over > BORROW_MAX ? `, more than the ${inr(BORROW_MAX)} I can borrow from tomorrow` : ''}. The streak ends at ${n}; tomorrow starts a new one.`;
  const acts = ok ? [[`Borrow ${inr(over)}`, 'mon-borrow'], ['Let it go', 'mon-letgo']] : [['Okay', 'mon-letgo']];
  if (has('agentSay')) { api.agentSay(text, { aspect: 'money', kind: ok ? 'ask' : 'nudge', acts }); return; }
  const el = monSheet({ cls: 'mon-saver', head: `<div class="sheet-head"><div class="sh-text"><h3>${ok ? 'Save your streak' : 'Today is over budget'}</h3><p>${esc(AGENT.name)}, just now</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: `<div class="mon-saver-b"><span class="mon-saver-ic" aria-hidden="true">${I.flame}<b class="met">${n}</b></span><p class="mon-saver-t">${text}</p>
      ${ok ? `<p class="hint">Once a week, up to ${inr(BORROW_MAX)}. Tomorrow gets that much less.</p>` : ''}
      <div class="pad mon-saver-acts">${acts.map(([l, a], i) => `<button class="btn block${i === 0 && ok ? ' primary' : ''}" data-act="${a}" data-a="${Math.round(over)}"${i === 0 && ok ? ' style="--c:var(--as-fill)"' : ''}>${l}</button>`).join('')}</div></div>` });
  el._over = over;
  symbol($('.mon-saver-ic', el), 'wiggle');
}
on('mon-borrow', (b) => {
  const sh = b?.closest?.('.sheet'); if (sh) closeSheet(sh);
  const over = Math.max(0, Math.round(-D.todayLeft()));
  if (!over) return;
  const undo = D.borrow(D.borrowedToday() + over); haptic(14);
  toast(`Borrowed ${inr(over)} from tomorrow. The streak lives`, undo);
});
on('mon-letgo', (b) => { const sh = b?.closest?.('.sheet'); if (sh) closeSheet(sh); });

// ── one transaction ─────────────────────────────────────────────────────
const HOW = (t) => {
  const at = t.created ? new Date(t.created).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '';
  return ({
    upi: `${esc(AGENT.name)} logged it from a UPI message${at ? ` at ${at}` : ''}`,
    scan: `Scanned${t.t ? ` at ${t.t}` : ''}: ${esc(AGENT.name)} read the receipt`, you: `You logged it${t.pay === 'cash' ? ', paid in cash' : ''}`,
    told: `You told ${esc(AGENT.name)}${t.said ? `: “${esc(t.said)}”` : ''}`, statement: `${esc(AGENT.name)} found it in your bank statement`,
    siri: `Logged with Siri${t.source === 'widget' ? ' from the widget' : ''}`, bill: 'A recurring charge', northwind: 'From the Northwind client ledger (northwind-os)', cli: 'Logged on your PC',
  })[t.by] ?? '';
};
export function openTxSheet(id) {
  const t = D.txOf(id);
  if (!t) return;
  if (t.kind === 'in') return openIncomeSheet(t);
  const c = D.cat(t.c), sp = t.split ? (person(t.split) ?? { id: t.split, name: t.splitName ?? t.split }) : null;
  const el = monSheet({
    head: `<div class="sheet-head mon-tx-head">${catTile(t.c, 'big')}<div class="sh-text"><h3>${esc(t.m)}</h3><p>${esc(c.name)} · ${esc(D.dayLabel(t.date))}${t.t ? `, ${t.t}` : ''}</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: `
      <div class="mon-tx-fig"><p class="met mon-fig1">${fig(t.share || t.a, { count: false })}</p>${t.split ? `<p class="mon-hsub">${t.share ? `Your half of ${inr(t.a)}` : `Lent ${inr(t.a)}`}. ${esc(sp?.name ?? '')} ${t.settled ? 'paid you back' : `owes you ${inr(t.a - t.share)}`}</p>` : ''}</div>
      <div class="mon-how"><p class="mon-how-l">${G(({ upi: 'chat', scan: 'scan', you: 'edit', told: 'mic', statement: 'doc', siri: 'mic', bill: 'repeat' })[t.by] ?? 'edit')}<span>${HOW(t)}</span></p>
        ${rawMessage(t)}
        ${t.items?.length ? `<div class="mon-raw"><p class="mon-raw-k">${G('receipt')}<span>The receipt</span></p>${t.items.map(([n, p]) => `<p class="mon-item"><span>${esc(n)}</span><b class="num">${inr(p)}</b></p>`).join('')}</div>` : ''}
        ${t.by === 'statement' && t.raw ? `<div class="mon-raw"><p class="mon-raw-k">${G('doc')}<span>The statement row</span></p><p class="mon-raw-t">${esc(t.raw)}</p></div>` : ''}
      </div>
      ${t.bill ? '' : `<p class="mon-label">Category</p>
      <div class="mon-rail mon-catchips" data-scroll-x>${D.CATS.map((x) => `<button class="chip sm${x.id === t.c ? ' on' : ''}" data-act="mon-recat" data-id="${t.id}" data-c="${x.id}">${G(x.icon)}${esc(x.name)}</button>`).join('')}</div>`}
      <div class="group mon-tx-g">
        <label class="row mon-tx-note"><span class="rbody"><span class="rmeta">Note</span><input data-txnote value="${esc(t.note)}" placeholder="Add a note" maxlength="40"></span></label>
        ${sp ? `<button class="row ic" data-act="mon-owed" data-id="${esc(sp.id)}"><span class="tile mon-mono" aria-hidden="true">${esc(sp.name[0] ?? '?')}</span><span class="rbody"><span class="rtitle">Split with ${esc(sp.name)}</span><span class="rmeta">${t.settled ? 'Settled' : `Owes you ${inr(t.a - t.share)}`}</span></span>${I.chevR}</button>` : ''}
        <div class="row"><span class="rbody"><span class="rtitle">Paid with</span><span class="rmeta">${esc(D.accountOf(t.account)?.name ?? (t.pay === 'cash' ? 'Cash' : t.pay === 'card' ? 'Card' : 'UPI'))}</span></span></div>
      </div>
      <div class="pad mon-tx-acts"><button class="btn block mon-del" data-act="mon-tx-del" data-id="${t.id}">${I.trash}Delete</button></div>`,
  });
  $('[data-txnote]', el)?.addEventListener('change', (e) => { const undo = D.updateTx(t.id, { note: e.target.value.trim() }); toast('Note saved', undo); });
}
function openIncomeSheet(t) {
  const el = monSheet({
    head: `<div class="sheet-head mon-tx-head">${tile(D.incat(t.c).icon, 'big mon-in-tile')}<div class="sh-text"><h3>${esc(t.m)}</h3><p>${esc(D.incat(t.c).name)} · ${esc(D.dayLabel(t.date))}${t.t ? `, ${t.t}` : ''}</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: `<div class="mon-tx-fig"><p class="met mon-fig1 c-as">+${fig(t.a, { count: false })}</p>${t.from ? `<p class="mon-hsub">From ${esc(t.from)}</p>` : ''}</div>
      <div class="mon-how"><p class="mon-how-l">${G(t.by === 'northwind' ? 'rocket' : t.by === 'statement' ? 'doc' : 'edit')}<span>${HOW(t)}</span></p>${t.by === 'statement' && t.raw ? `<div class="mon-raw"><p class="mon-raw-t">${esc(t.raw)}</p></div>` : ''}</div>
      <p class="mon-label">Where it came from</p>
      <div class="mon-rail mon-catchips" data-scroll-x>${D.INCATS.map((x) => `<button class="chip sm${x.id === t.c ? ' on' : ''}" data-act="mon-recat" data-id="${t.id}" data-c="${x.id}">${G(x.icon)}${esc(x.name)}</button>`).join('')}</div>
      <div class="group mon-tx-g"><button class="row ic" data-act="mon-src" data-id="${t.c}">${tile(D.incat(t.c).icon, 'mon-in-tile')}<span class="rbody"><span class="rtitle">Everything from ${esc(D.incat(t.c).name)}</span></span>${I.chevR}</button></div>
      <div class="pad mon-tx-acts"><button class="btn block mon-del" data-act="mon-tx-del" data-id="${t.id}">${I.trash}Delete</button></div>`,
  });
  return el;
}
on('mon-intx', (el) => openTxSheet(el.dataset.id));
on('mon-recat', (b) => {
  const t = D.txOf(b.dataset.id); if (!t || t.c === b.dataset.c) return;
  const undo = D.recategorise(t.id, b.dataset.c); haptic(6);
  $$('.mon-catchips .chip', b.closest('.sheet')).forEach((c) => c.classList.toggle('on', c === b));
  const name = t.kind === 'in' ? D.incat(b.dataset.c).name : D.cat(b.dataset.c).name;
  toast(t.kind === 'in' ? `Moved to ${name}` : `Moved to ${name}. ${AGENT.name} will file ${t.m.replace(/,.*$/, '')} there next time`, undo);
});
on('mon-tx-del', (b) => {
  const t = D.txOf(b.dataset.id); if (!t) return;
  closeSheet(b.closest('.sheet'));
  const undo = D.removeTx(t.id);
  toast(`Deleted ${inr(t.a)} · ${t.m}`, undo);
});

// ── a receipt from the one Scan button: {merchant, total, date, items:[{name,price}], category} ──
export { guessCat };
export function receiptScan(result = {}) {
  const f = result.fields ?? {};
  const merchant = f.merchant ?? result.title ?? 'Receipt';
  const items = (f.items?.length ? f.items : [{ name: merchant, price: f.total ?? 0 }]).map((x, i) => ({ ...x, i, on: true }));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(f.date ?? '') && f.date <= D.today() ? f.date : D.today();
  const st = { items, cat: D.CATS.some((c) => c.id === f.category) ? f.category : guessCat(f.category, merchant), split: null };
  const total = () => st.items.filter((x) => x.on).reduce((n, x) => n + Number(x.price || 0), 0);
  const el = monSheet({ cls: 'mon-receipt', head: `<div class="sheet-head">${tile('receipt', 'big')}<div class="sh-text"><h3>${esc(merchant)}</h3><p>Receipt · scanned just now · ${esc(D.dayLabel(date))}</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: (b) => {
      const draw = () => {
        const a = total(), share = st.split ? Math.round(a / 2) : a, left = D.todayLeft();
        b.innerHTML = `
          <p class="mon-label">Untick what wasn't yours</p>
          <div class="group mon-items">${st.items.map((x) => `<button class="row mon-itemrow" data-i="${x.i}" aria-pressed="${x.on}"><span class="check${x.on ? ' done' : ''}" aria-hidden="true">${I.check}</span><span class="rbody"><span class="rtitle">${esc(x.name)}</span></span><span class="rend mon-rend"><span class="mon-amt${x.on ? '' : ' mon-amt-soft'}">${inr(Number(x.price || 0))}</span></span></button>`).join('')}</div>
          <p class="mon-label">Category · ${esc(AGENT.name)}'s guess</p>
          <div class="mon-rail mon-catchips" data-scroll-x>${D.CATS.map((c) => `<button class="chip sm${c.id === st.cat ? ' on' : ''}" data-c="${c.id}">${G(c.icon)}${esc(c.name)}</button>`).join('')}</div>
          ${people().length ? `<div class="mon-rail mon-catchips" data-scroll-x>${people().map((p) => `<button class="chip sm${st.split === p.id ? ' on' : ''}" data-split="${p.id}">${G('split')}Half with ${esc(p.name)}</button>`).join('')}</div>` : ''}
          <p class="mon-impact">${!D.hasBudgets() ? `${inr(share)} on ${esc(D.dayLabel(date).toLowerCase())}` : date !== D.today() ? `Goes on ${esc(D.dayLabel(date))}` : left - share >= 0 ? `${inr(left)} → <b>${inr(left - share)}</b> left today` : `<span class="c-needs">${inr(share - left)} over today's budget</span>`}</p>
          <div class="pad"><button class="btn primary block" data-add style="--c:var(--as-fill)"${a > 0 ? '' : ' disabled'}>Add ${inr(a)}${st.split ? `, your half ${inr(share)}` : ''}</button></div>`;
      };
      draw();
      b.addEventListener('click', (e) => {
        const it = e.target.closest('.mon-itemrow'); if (it) { const x = st.items[Number(it.dataset.i)]; x.on = !x.on; haptic(5); draw(); return; }
        const c = e.target.closest('[data-c]'); if (c) { st.cat = c.dataset.c; haptic(5); draw(); return; }
        const s = e.target.closest('[data-split]'); if (s) { st.split = st.split === s.dataset.split ? null : s.dataset.split; haptic(5); draw(); return; }
        if (e.target.closest('[data-add]')) {
          const a = total(); if (!(a > 0)) return;
          const on = st.items.filter((x) => x.on), p = st.split ? person(st.split) : null;
          closeSheet(el);
          const tx = D.addTx({ amount: a, category: st.cat, merchant, note: on.length > 1 ? plural(on.length, 'item') : '', date, source: 'receipt', pay: 'upi',
            items: on.map((x) => [String(x.name), Number(x.price || 0)]), split: p ? { person: p.id, name: p.name, share: Math.round(a / 2) } : null });
          toast(`Added ${inr(a)} · ${D.cat(st.cat).name}`, D.removeTx.bind(null, tx.id));
        }
      });
    } });
  return el;
}

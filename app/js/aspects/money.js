// Money: what's left to spend today, budgets, the flow in and out (leaks and injections), and net worth, on his real
// data (the PC's money module, offline-first). The agent does the bookkeeping: she files UPI messages, scans and
// statements, spots leaks, logs what comes in. Owner: the Money agent. Files: this one, money-data.js (the live data
// and every write), money-calc.js (the arithmetic, shared with the PC), money-ui.js (shared pieces), money-add.js (the
// keypad, receipts, a transaction), money-flows.js (statement, leaks, income, streak, her tools, the report),
// money-demo.js (?data=demo only). CSS: css/aspects/money.css. Links: #money · #money/budget|flow|worth ·
// money/expense · money/statement[/<id>] · money/leaks · money/income/<source>
import { $, $$, esc, on, haptic, ring, setRing, pulse, toast, seg, closeSheet, pop, wireSegs } from '../core.js';
import { I } from '../icons.js';
import { registerAspect, aspHead, openAspect } from '../aspects.js';
import { api, provide } from '../bus.js';
import { AGENT, GOALS, person } from '../data.js';
import { registerRoute } from '../svc/route.js';
import * as D from './money-data.js';
import { MI, G, tile, catTile, fig, txRow, incomeRow, sh, wynCard, pageHead, pushMoney, plural, reduced, monSheet, emptyRow } from './money-ui.js';
import { openAdd, openTxSheet, receiptScan } from './money-add.js';
import { openStatement, openReview, statementScan, openLeak, openSource, openStreak, openTools, openReport, LEAKS, leakState, TOOLS, lastWeekFrom } from './money-flows.js';
import { stagger, symbol, flipList } from '../motion.js';

const { S, inr, fmt } = D;

// ── the open app (if any) and redraws ───────────────────────────────────
const moneyApp = () => $$('#stack > .page').reverse().find((p) => p._app?.id === 'money')?._app ?? null;
function goTo(section) {
  const app = moneyApp();
  if (app && $('#stack').lastElementChild === app.page) { app.go(section); return app; }
  return openAspect('money', section, { back: $('.tab.on span')?.textContent || 'Back' });
}
// a data change redraws only what changed, in place, without replaying the open's ring draw (the PC's refreshes come
// in bursts across ten collections, and a section that looks the same is left alone)
function quiet(app, sid) {
  const s = SECTIONS.find((x) => x.id === sid), el = app.el(sid);
  if (!s || !el?.dataset.built) return;
  const tmp = document.createElement('div'); tmp._entered = true;
  s.render(tmp, app);
  const html = tmp.innerHTML;
  if (html === el._html) return;
  const y = app.scroll.scrollTop;
  el.replaceChildren(...tmp.childNodes); el._html = html;
  wireSegs(el);
  if (sid === app.section) app.scroll.scrollTop = y;
}
function redraw(app, { except = [] } = {}) { for (const s of SECTIONS) if (!except.includes(s.id)) quiet(app, s.id); }
let drawT = 0;
D.onChange((what = {}) => {
  const app = moneyApp();
  if (!app) return;
  // an expense just added on Today lands with its own motion; once that settles, Today is quietly brought in line
  if (what.kind === 'add' && app.section === 'home' && app.el('home')?.dataset.built) { landOnHome(app, what.tx); redraw(app, { except: ['home'] }); clearTimeout(app._monLand); app._monLand = setTimeout(() => quiet(app, 'home'), 1100); return; }
  cancelAnimationFrame(drawT); drawT = requestAnimationFrame(() => redraw(app));
});
const keepHtml = (fn) => (el, app) => { fn(el, app); el._html = el.innerHTML; };

// count a figure from what it shows now to a new value (the ring beside it moves with setRing)
function countTo(el, to) {
  if (!el) return;
  const from = Number(el.textContent.replace(/[^\d]/g, '')) || 0;
  el.dataset.count = String(Math.round(to));
  if (reduced() || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(), dur = 640;
  const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = fmt(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// rows enter in a short cascade the first time a section draws (60 fps: transform and opacity only)
const enter = (el) => { if (el._entered) return; el._entered = true; if (!reduced()) stagger($$('.mon-hero, .mon-mhero, .mon-kept, .mon-worth, .mon-wyn, .group > .row, .mon-tiles > .mon-tile', el).slice(0, 16), { y: 10, each: 28, max: 360 }); };

// ═══ TODAY ══════════════════════════════════════════════════════════════
const streakPill = () => {
  if (!D.hasBudgets()) return '';
  const n = D.streak(), risk = D.todayLeft() < 0;
  return `<button class="mon-streak${risk ? ' at-risk' : ''}" data-act="mon-streak" aria-label="${n} days under budget${risk ? ', at risk today' : ''}">${I.flame}<b class="met">${n}</b></button>`;
};
function heroTop() {
  if (!D.hasBudgets()) {
    const spent = D.todaySpent();
    return `<div class="mon-hero-top" data-herotop>
      <div class="mon-hero-txt">
        <p class="mon-hk" data-hk>Spent today</p>
        <p class="met mon-big" data-big>${fig(spent)}</p>
        <p class="mon-hsub" data-hsub>Set a budget for the month and you get a daily one</p>
      </div>
      ${ring(0, 'as', 112, 13, { cls: 'mon-dayring', label: 'No daily budget yet' })}
    </div>`;
  }
  const allow = D.todayAllow(), spent = D.todaySpent(), left = allow - spent, over = left < -0.5;
  return `<div class="mon-hero-top" data-herotop>
      <div class="mon-hero-txt">
        <p class="mon-hk" data-hk>${over ? 'Over today\'s budget' : 'Left to spend today'}</p>
        <p class="met mon-big${over ? ' is-over' : ''}" data-big>${fig(Math.abs(left))}</p>
        <p class="mon-hsub" data-hsub>of <b>${inr(allow)}</b> · ${inr(spent)} spent${D.borrowedToday() ? ` · ${inr(D.borrowedToday())} borrowed` : ''}</p>
      </div>
      ${ring(over || allow <= 0 ? 0 : left / allow, over ? 'needs' : 'as', 112, 13, { cls: 'mon-dayring', label: `${inr(Math.max(0, left))} of ${inr(allow)} left today` })}
    </div>`;
}
const weekRead = () => {
  if (!D.hasBudgets()) return `<span>Each column is a day's spending.</span>`;
  const n = D.streak(), left = D.todayLeft();
  if (!n) return `<span>Each column is a day against that day's own budget.</span>`;
  return `<span><b>${plural(n, 'day')} under budget.</b> ${left >= 0 ? `Today makes ${n + 1}.` : 'Today is over.'}</span>`;
};
function weekStrip() {
  const cols = [], days = Array.from({ length: 7 }, (_, i) => D.addDays(D.today(), i - 6));
  const budgeted = D.hasBudgets();
  const maxSpent = Math.max(1, ...days.map((d) => D.spentOn(d)));
  for (const date of days) {
    const a = D.allowanceOn(date), sp = D.spentOn(date), isT = date === D.today();
    const h = budgeted && a > 0 ? Math.min(1, sp / a) : sp / maxSpent, over = budgeted && a > 0 && sp > a + 0.5;
    cols.push(`<button class="mon-wd${isT ? ' is-today' : ''}${over ? ' is-over' : ''}" data-act="mon-wd" data-date="${date}" aria-label="${D.wdName(date)} ${D.dayMonth(date)}: ${inr(sp)}${budgeted ? ` of ${inr(a)}` : ''}">
      <span class="mon-wd-t"><i style="--h:${h.toFixed(3)}"></i></span><span class="mon-wd-l">${D.wdName(date)[0]}</span></button>`);
  }
  return `<div class="mon-week" data-week><div class="mon-wk-cols">${cols.join('')}</div><p class="mon-wk-read" data-wkread aria-live="polite">${weekRead()}</p></div>`;
}
const paceText = () => { const u = D.underPace(); return u >= 0 ? `${inr(u)} under pace` : `<span class="c-needs">${inr(-u)} over pace</span>`; };
function heroFoot() {
  if (!D.hasBudgets()) return `<button class="row mon-hero-foot" data-act="mon-edit" data-herofoot>${tile('pie')}<span class="rbody"><span class="rtitle">Set your budgets</span><span class="rmeta"><span class="ell">A few categories is enough to start</span></span></span>${I.chevR}</button>`;
  const total = D.monthBudget(), left = D.monthLeft();
  return `<button class="row mon-hero-foot" data-act="mon-go" data-s="budget" data-herofoot>
    ${ring(total > 0 ? Math.max(0, left) / total : 0, 'as', 38, 5, { k: D.timeLeft(), label: `${inr(left)} of ${inr(total)} left in ${D.MONTH.name}; the tick is the time left` })}
    <span class="rbody"><span class="rtitle">${inr(left)} left in ${D.MONTH.name}</span><span class="rmeta"><span class="ell">${paceText()} · ${plural(D.daysAfterToday(), 'day')} to go</span></span></span>${I.chevR}</button>`;
}
const hero = () => `<section class="mon-hero surface" data-hero>${heroTop()}${weekStrip()}${heroFoot()}</section>`;

// her one line here: what she filed, the overshoot she'd cover, the move she made (undo), or how to start
function overshoot() {
  const over = D.CATS.filter((c) => S.budgets[c.id] > 0 && D.catLeft(c.id) < -0.5).map((c) => ({ c, a: Math.round(-D.catLeft(c.id)) })).sort((a, b) => b.a - a.a)[0];
  if (!over) return null;
  const room = D.CATS.filter((c) => c.id !== over.c.id && D.catLeft(c.id) > over.a * 1.5).sort((a, b) => D.catLeft(b.id) - D.catLeft(a.id))[0];
  return { ...over, room };
}
const hm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '');
function wynHome() {
  const f = S.lastFiled;
  if (f && Date.now() - f.at < 6 * 3600e3) return wynCard({ at: 'Now', id: 'import', text: `Filed ${esc(f.bank ?? 'the statement')}: ${plural(f.n, 'spend')} that wasn't logged, ${inr(f.out)}.${f.before != null && Math.round(f.before) !== Math.round(f.after) ? ` Today's budget is <b>${inr(f.after)}</b> now, ${inr(Math.max(0, D.todayLeft()))} left.` : ''}${f.bills ? ' It also found a subscription: it\'s in Leaks.' : ''}` });
  if (S.moved && Date.now() - Date.parse(S.moved.at) < 3600e3) return wynCard({ at: hm(S.moved.at), id: 'moved', text: `Moved ${inr(S.moved.a)} from ${esc(D.cat(S.moved.from).name)} to ${esc(D.cat(S.moved.to).name)}. ${esc(D.cat(S.moved.from).name)} has ${inr(D.catLeft(S.moved.from))} left for the rest of ${D.MONTH.name}.`, acts: [['Undo', 'mon-move-undo']] });
  const mine = D.agentToday();
  const upi = mine.filter((t) => t.by === 'upi').length, told = mine.length - upi;
  const filed = [upi ? `${plural(upi, 'spend')} from UPI messages` : '', told ? `${plural(told, 'spend')} you told me about` : ''].filter(Boolean).join(' and ');
  const o = overshoot();
  if (o && leakState(`over:${D.MONTH.iso}:${o.c.id}`) === 'open') {
    const lead = mine.length ? `Filed ${filed} today. ` : '';
    return wynCard({ at: mine.length ? hm(mine.at(-1).created) : '', id: 'move',
      text: `${lead}${esc(o.c.name)} is <b>${inr(o.a)} over</b>.${o.room ? ` Move it from ${esc(o.room.name)}? ${esc(o.room.name)} has ${inr(D.catLeft(o.room.id))} left.` : ' Your daily budget already counts it.'}`,
      acts: o.room ? [[`Move ${inr(o.a)} from ${o.room.name}`, 'mon-move', `data-from="${o.room.id}" data-to="${o.c.id}" data-a="${o.a}"`, true], ['Leave it', 'mon-move-no', `data-id="${o.c.id}"`]] : [] });
  }
  if (mine.length) return wynCard({ at: hm(mine.at(-1).created), id: 'logged', text: `Filed ${filed} today${D.hasBudgets() ? `. ${D.todayLeft() >= 0 ? `${inr(D.todayLeft())} left` : `${inr(-D.todayLeft())} over`}` : ''}.` });
  if (!D.hasBudgets() && !D.hasAnything()) return wynCard({ id: 'start', text: `Tell me what you spend as you go, or share a bank statement, and I'll keep Money for you. Start with a rough budget for the month.`, acts: [['Set budgets', 'mon-edit', '', true], ['Import a statement', 'mon-statement']] });
  return '';
}
const emptyToday = () => emptyRow('Nothing spent today', `${esc(AGENT.name)} files UPI messages as they arrive. Add one with the + button`);
function todayList() {
  const xs = D.sortTx(S.tx.filter((t) => t.date === D.today()));
  const ins = S.income.filter((x) => x.date === D.today());
  return `<div data-todaylist>${sh('Today', { count: xs.length + ins.length, act: D.m.all.length ? 'mon-all' : '' })}<div class="group mon-txg">${ins.map(incomeRow).join('')}${xs.map((t) => txRow(t)).join('') || (ins.length ? '' : emptyToday())}</div></div>`;
}
function fileCard() {
  const r = S.imports.find((x) => x.status === 'review'), q = S.imports.find((x) => x.status === 'queued');
  const last = S.imports.find((x) => x.status === 'filed');
  const recent = last && Date.now() - Date.parse(last.filed?.at ?? last.updated_at) < 20 * 864e5;
  if (!r && !q && recent) return '';
  const title = r ? `${esc(r.bank ?? 'Your statement')} is ready` : q ? 'A statement is waiting for your PC' : `${D.MONTH.name}'s bank statement`;
  const meta = r ? `${plural((r.counts?.new ?? 0) + (r.counts?.ask ?? 0) + (r.counts?.sub ?? 0) + (r.counts?.income ?? 0), 'row')} to check` : q ? 'It reads it as soon as it\'s back' : `Share it and ${esc(AGENT.name)} files what UPI messages missed`;
  return `${sh('To file')}<div class="group"><button class="row ic mon-file" data-act="${r ? 'mon-st-open' : 'mon-statement'}" data-id="${esc(r?.id ?? '')}">${tile('doc')}
    <span class="rbody"><span class="rtitle">${title}</span><span class="rmeta mon-wrap">${meta}</span></span>
    <span class="btn sm tint mon-fake-btn" style="--c:var(--as-ink)" aria-hidden="true">${r ? 'Review' : 'Import'}</span></button></div>`;
}
// what's coming: bills in the next fortnight, Northwind money still to come in, the card bill
function upcoming() {
  const t = D.today(), until = D.addDays(t, 21), out = [];
  for (const b of S.bills) if (b.nextDate > t && b.nextDate <= until && b.state === 'active') out.push({ date: b.nextDate, title: `${b.name} ${b.doc.leak && leakState(`sub:${b.id}`) === 'open' ? 'renews' : 'is due'}`, meta: b.doc.leak && leakState(`sub:${b.id}`) === 'open' ? 'Cancel it before then?' : b.on === 'card' ? 'On your card' : 'By UPI', amt: b.a, act: b.doc.leak ? 'mon-leak' : 'mon-bill', id: b.doc.leak ? `sub:${b.id}` : b.id, needs: b.doc.leak && leakState(`sub:${b.id}`) === 'open' });
  for (const a of S.owe) if (a.due && a.due > t && a.due <= until) out.push({ date: a.due, title: `${a.name} bill`, meta: 'Pay it in full', amt: a.a, act: 'mon-acct', id: a.id });
  for (const p of S.pending.slice(0, 3)) out.push({ date: null, title: p.name, meta: p.what ?? 'Still to come in', amt: p.amount ?? (p.label || 'to agree'), dir: 'in', act: 'mon-src', id: 'client', approx: p.approx });
  return out.sort((a, b) => (a.date ?? '9') < (b.date ?? '9') ? -1 : 1).slice(0, 6);
}
function comingUp() {
  const xs = upcoming();
  if (!xs.length) return '';
  const rows = xs.map((u) => {
    const amt = typeof u.amt === 'number' ? `<span class="mon-amt${u.dir === 'in' ? ' c-as' : ''}">${u.dir === 'in' ? '+' : ''}${u.approx ? '≈' : ''}${inr(u.amt)}</span>` : `<span class="mon-amt mon-amt-soft">${esc(u.amt)}</span>`;
    const wd = u.date ? D.wdName(u.date) : 'Due', day = u.date ? (u.date.slice(0, 7) === D.MONTH.iso ? String(Number(u.date.slice(8, 10))) : D.dayMonth(u.date)) : '·';
    return `<button class="row mon-up" data-act="${u.act}" data-id="${esc(u.id)}">
      <span class="mon-up-d${day.length > 2 ? ' is-long' : ''}"><small>${wd}</small><b class="num">${day}</b></span>
      <span class="rbody"><span class="rtitle">${esc(u.title)}</span><span class="rmeta">${u.needs ? `<span class="c-needs">${esc(u.meta)}</span>` : esc(u.meta)}</span></span>
      <span class="rend mon-rend">${amt}</span></button>`;
  }).join('');
  return `${sh('Coming up')}<div class="group mon-upg">${rows}</div>`;
}
const ASKS = () => [
  D.hasBudgets() ? 'How am I doing this month?' : 'Help me set a budget',
  'Where is my money going?', 'Am I on track for ₹2 lakh a month?',
  D.leaks().some((l) => l.monthly && l.state === 'open') ? 'Which subscription should I cut?' : 'What can I cut?',
];
const askRail = () => `${sh(`Ask ${esc(AGENT.name)}`)}<div class="mon-rail" data-scroll-x>${ASKS().map((q) => `<button class="chip sm" data-act="mon-ask" data-q="${esc(q)}">${I.sparkle}<span>${esc(q)}</span></button>`).join('')}</div>`;
function toolsRow() {
  const last = D.agentLast();
  return `<div class="group mon-tools-g"><button class="row ic" data-act="mon-tools">${tile('agent')}<span class="rbody"><span class="rtitle">What ${esc(AGENT.name)} does in Money</span><span class="rmeta">${plural(TOOLS.length, 'tool')} · ${TOOLS.filter((t) => t.auto).length} on her own${last ? ` · last used ${esc(D.dayLabel(String(last.created).slice(0, 10)).toLowerCase())}` : ''}</span></span>${I.chevR}</button></div>`;
}
function renderHome(el, app) {
  el.innerHTML = aspHead(app, { title: 'Today', sub: `${D.wdName(D.today())} ${D.dayMonth(D.today())}`, right: streakPill() })
    + hero() + `<div data-wyn-slot>${wynHome()}</div>` + todayList() + fileCard() + comingUp() + askRail() + toolsRow();
  D.loadPending();
}
// an expense just landed: the ring drains to its new value, the figure counts down, the row slides in
function landOnHome(app, tx) {
  const el = app.el('home');
  if (!D.hasBudgets()) { app.refresh('home'); return; }
  const allow = D.todayAllow(), left = allow - D.todaySpent(), over = left < -0.5;
  const rg = $('.mon-dayring', el);
  if (rg) { rg.classList.toggle('as', !over); rg.classList.toggle('needs', over); setRing(rg, over || allow <= 0 ? 0 : left / allow); }
  const big = $('[data-big]', el);
  big?.classList.toggle('is-over', over);
  countTo($('[data-count]', big), Math.abs(left));
  $('[data-hk]', el).textContent = over ? 'Over today\'s budget' : 'Left to spend today';
  $('[data-hsub]', el).innerHTML = `of <b>${inr(allow)}</b> · ${inr(D.todaySpent())} spent`;
  $('[data-week]', el).outerHTML = weekStrip();
  $('[data-herofoot]', el).outerHTML = heroFoot();
  $('.mon-streak', el)?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: streakPill() }).firstElementChild ?? document.createTextNode(''));
  $('[data-wyn-slot]', el).innerHTML = wynHome();
  const list = $('[data-todaylist]', el);
  const fresh = Object.assign(document.createElement('div'), { innerHTML: todayList() }).firstElementChild;
  flipList($('.mon-txg', list), () => { $('.mon-txg', list).replaceChildren(...$('.mon-txg', fresh).children); $('.sh', list).replaceWith($('.sh', fresh)); }, { key: (r) => r.dataset.id, stagger: 20, enterY: -12 }).catch(() => {});
  pulse($('[data-herofoot]', el));
  symbol($('.mon-dayring', el), 'pop');
  if (tx) { const row = $(`.mon-tx[data-id="${tx.id}"]`, el); if (row && !reduced()) row.classList.add('mon-row-in'); }
}

// ═══ SAVING FOR: funds (the anniversary fund is shared with Family through FUNDS) ═══
const fundRow = (f) => `<button class="row ic mon-fund" data-act="mon-fund" data-id="${esc(f.id)}">${ring(f.target ? Math.min(1, f.saved / f.target) : 0, 'as', 38, 5, { label: `${inr(f.saved)} of ${inr(f.target)} saved` })}
    <span class="rbody"><span class="rtitle">${esc(f.name)}</span><span class="rmeta"><span class="ell">${inr(f.saved)}${f.target ? ` of ${D.lakh(f.target)}` : ''}${f.monthly ? ` · ${inr(f.monthly)} a month` : ''}${f.aspect ? ` · with ${esc(f.aspect[0].toUpperCase() + f.aspect.slice(1))}` : ''}</span></span></span>${I.chevR}</button>`;
const fundBlock = () => `${sh('Saving for')}<div class="group mon-fundg">${S.funds.map(fundRow).join('') || emptyRow('No fund yet', 'A pot for something you\'re saving towards. It comes out of the daily budget from the day you put money in.', 'mon-fund-new', 'Start one')}</div>`;

// ═══ BUDGETS ════════════════════════════════════════════════════════════
function monthHero() {
  const total = D.monthBudget(), left = D.monthLeft(), spent = D.monthSpent(), u = D.underPace();
  return `<section class="mon-mhero surface">
    <div class="mon-mh-top">
      ${ring(total > 0 ? Math.max(0, left) / total : 0, 'as', 132, 14, { k: D.timeLeft(), cls: 'mon-mring', label: `${inr(left)} of ${inr(total)} left; the tick is the time left in ${D.MONTH.name}` })}
      <div class="mon-mh-txt">
        <p class="mon-hk">Left in ${D.MONTH.name}</p>
        <p class="met mon-fig1">${fig(left, { sign: left < 0 ? '−' : '' })}</p>
        <p class="mon-hsub">of ${inr(total)}${D.saved() ? ` · ${inr(D.saved())} saved` : ''}${D.m.budgetsCarried ? ` · from ${D.monthName(D.m.budgetsFrom)}` : ''}</p>
      </div>
    </div>
    <div class="mon-stats">
      <div><small>Spent</small><b class="met">${inr(spent)}</b></div>
      <div><small>Daily, from ${D.tomorrowWd()}</small><b class="met">${inr(D.perDayFromTomorrow())}</b></div>
      <div><small>${u >= 0 ? 'Under pace' : 'Over pace'}</small><b class="met ${u >= 0 ? 'c-as' : 'c-needs'}">${inr(Math.abs(u))}</b></div>
    </div>
    <p class="mon-legend"><i class="mon-tick" aria-hidden="true"></i><span>The tick is time left: keep the green past it.</span></p>
  </section>`;
}
function wynBudget() {
  const u = D.underPace(), f = S.funds.find((x) => !x.target || x.saved < x.target);
  if (D.saved()) return f ? wynCard({ text: `Put ${inr(D.saved())} into ${esc(f.name)} this month: ${inr(f.saved)}${f.target ? ` of ${D.lakh(f.target)}` : ''} now. You still have <b>${inr(D.perDayFromTomorrow())}</b> a day from tomorrow.`, acts: f.aspect ? [[`See it in ${f.aspect[0].toUpperCase() + f.aspect.slice(1)}`, 'mon-fund', `data-id="${esc(f.id)}"`]] : [] }) : '';
  if (!f || u < 1000 || D.daysAfterToday() < 2) return '';
  const a = Math.min(Math.floor(u / 2 / 500) * 500 || 500, f.target ? f.target - f.saved : Infinity);
  if (!(a > 0)) return '';
  const after = (D.monthLeft() - a) / D.daysAfterToday();
  return wynCard({ text: `You're ${inr(u)} under pace. Put ${inr(a)} into ${esc(f.name)} and you still get ${inr(after)} a day from tomorrow.`,
    acts: [[`Save ${inr(a)}`, 'mon-save-fund', `data-id="${esc(f.id)}" data-a="${a}"`, true], ['Keep it to spend', 'mon-save-no']] });
}
function catRows() {
  const tl = D.timeLeft();
  return D.CATS.map((c) => {
    const b = S.budgets[c.id] ?? 0, left = D.catLeft(c.id), frac = b ? Math.max(0, left) / b : 0, over = left < -0.5;
    return { c, b, left, frac, over, fast: !over && b > 0 && frac < tl - 0.03, spent: D.catSpent(c.id) };
  }).filter((r) => r.b > 0 || r.spent > 0).sort((a, b) => (b.over - a.over) || (b.fast - a.fast) || (D.CATS.indexOf(a.c) - D.CATS.indexOf(b.c)));
}
function catRow(r) {
  const meta = !r.b ? `${inr(r.spent)} spent · no budget` : r.over ? `<span class="c-needs">${inr(-r.left)} over</span> · ${inr(r.spent)} of ${inr(r.b)}`
    : `${inr(r.left)} left · ${inr(D.daysAfterToday() ? Math.max(0, r.left) / D.daysAfterToday() : r.left)} a day${r.fast ? ' · running fast' : ''}`;
  return `<button class="row ic mon-cat-row" data-act="mon-cat" data-id="${r.c.id}">${catTile(r.c.id)}
    <span class="rbody"><span class="rtitle">${esc(r.c.name)}</span><span class="rmeta"><span class="ell">${meta}</span></span></span>
    <span class="rend">${ring(r.frac, r.over ? 'needs' : 'as', 38, 5, { k: D.timeLeft(), label: r.over ? `${inr(-r.left)} over` : `${Math.round(r.frac * 100)}% left` })}</span></button>`;
}
const billPill = (b) => {
  if (!b.doc.leak) return '';
  const st = leakState(`sub:${b.id}`);
  if (st === 'done') return `<span class="pill plain">Cancelled</span>`;
  if (st === 'paused') return `<span class="pill plain">Paused</span>`;
  if (st === 'ok') return '';
  return `<span class="pill" style="--c:var(--needs-ink)">Decide</span>`;
};
function billsBlock() {
  const bills = [...S.bills].sort((a, b) => b.a - a.a);
  return `${sh('Bills and subscriptions', { count: bills.length ? inr(D.billsPlanned()) : '', act: 'mon-bill-new', label: 'Add' })}
    <div class="group mon-bills">${bills.map((b) => `<button class="row ic" data-act="${b.doc.leak ? 'mon-leak' : 'mon-bill'}" data-id="${b.doc.leak ? `sub:${b.id}` : b.id}">${tile('repeat')}
      <span class="rbody"><span class="rtitle">${esc(b.name)}</span><span class="rmeta"><span class="ell">${b.due ? `${b.d} ${D.MONTH.short}` : `Due ${b.d} ${D.MONTH.short}`} · next ${esc(b.next)}${b.on === 'card' ? ' · card' : ' · UPI'}</span></span></span>
      <span class="rend mon-rend"><span class="mon-amt">${inr(b.a)}</span>${billPill(b)}</span></button>`).join('') || emptyRow('No bills yet', 'Subscriptions and recharges you pay every month. They sit outside the daily budget.', 'mon-bill-new', 'Add one')}</div>
    ${bills.length ? '<p class="hint">Charged whatever you do, so they sit outside the daily budget.</p>' : ''}`;
}
function renderBudget(el, app) {
  if (!D.hasBudgets()) {
    el.innerHTML = aspHead(app, { title: 'Budgets', sub: `${D.MONTH.name} · ${plural(D.daysAfterToday(), 'day')} left after today` })
      + `<section class="surface mon-mhero mon-setup"><p class="mon-hk">No budgets yet</p><p class="mon-hsub">Give each category a monthly amount. Money spreads what's left over the days left, so a quiet day gives the rest of the month more.</p>
          <div class="pad"><button class="btn primary block" data-act="mon-edit" style="--c:var(--as-fill)">Set budgets</button></div></section>`
      + (D.monthSpent() ? `${sh('Spent so far', { count: inr(D.monthSpent()) })}<div class="group mon-cats">${catRows().map(catRow).join('')}</div>` : '') + fundBlock() + billsBlock();
    return enter(el);
  }
  el.innerHTML = aspHead(app, { title: 'Budgets', sub: `${D.MONTH.name} · ${plural(D.daysAfterToday(), 'day')} left after today`, right: `<button class="btn mon-headbtn" data-act="mon-edit">Edit</button>` })
    + monthHero() + wynBudget() + `${sh('Categories', { count: catRows().length })}<div class="group mon-cats">${catRows().map(catRow).join('')}</div>` + fundBlock() + billsBlock()
    + `<p class="note surface mon-how"><b>How the daily budget works.</b> ${D.MONTH.name}'s ${inr(D.budgetTotal())} for categories, shared over the days left. Spend less and the rest of the month gets more; spend more and it gets less.</p>`;
  enter(el);
}

// ═══ FLOW: in and out, leaks and injections ═════════════════════════════
function keptRead(series) {
  const now = series[series.length - 1], past = series.slice(0, -1).filter((x) => x.kept);
  if (!D.incomeTotal() && !D.outTotal()) return 'Log what comes in and goes out, and this shows what you keep each month.';
  if (!past.length) return `${D.MONTH.name} so far: ${inr(D.incomeTotal())} in, ${inr(D.outTotal())} out.`;
  const avg = past.reduce((n, x) => n + x.kept, 0) / past.length;
  return now.kept >= avg ? `You're keeping more than your recent average (${inr(avg)} a month).` : `Below your recent average of ${inr(avg)} a month, with ${plural(D.daysAfterToday(), 'day')} to go.`;
}
function keptHero() {
  const series = D.keptSeries(), k = D.keptMonth(), inT = D.incomeTotal(), outT = D.outTotal();
  const max = Math.max(...series.map((x) => Math.abs(x.kept)), 1);
  const cols = series.map((x, i) => {
    const last = i === series.length - 1, h = Math.abs(x.kept) / max;
    return `<button class="mon-kc${last ? ' is-now' : ''}${x.kept < 0 ? ' is-neg' : ''}" data-act="mon-kc" data-i="${i}" aria-label="${x.m}: kept ${inr(x.kept)}">
      <span class="mon-kc-v">${last || x.kept === max ? inr(x.kept) : ''}</span><span class="mon-kc-t"><i style="--h:${h.toFixed(3)}"></i></span><span class="mon-kc-l">${x.m}</span></button>`;
  }).join('');
  return `<section class="mon-kept surface">
    <div class="mon-kept-top">
      <div class="mon-kept-fig"><p class="mon-hk">Kept this month</p><p class="met mon-fig1${k < 0 ? ' is-over' : ''}">${fig(k, { sign: k < 0 ? '−' : '' })}</p></div>
      <div class="mon-io">
        <p><span>In</span><b class="num">${inr(inT)}</b></p><span class="mon-io-bar"><i class="is-in" style="--w:${inT || outT ? (inT >= outT ? 1 : inT / outT).toFixed(3) : 0}"></i></span>
        <p><span>Out</span><b class="num">${inr(outT)}</b></p><span class="mon-io-bar"><i style="--w:${inT || outT ? (outT >= inT ? 1 : outT / inT).toFixed(3) : 0}"></i></span>
      </div>
    </div>
    ${series.length > 1 ? `<div class="mon-kchart" data-kchart>${cols}</div>` : ''}
    <p class="mon-kread" data-kread>${esc(keptRead(series))}</p>
  </section>`;
}
function leaksBlock() {
  const rows = LEAKS();
  const could = D.leakMonthly();
  return `${sh('Leaks', { count: rows.filter((l) => l.open()).length })}
    <div class="group mon-leaks">
      ${rows.length ? `<div class="row mon-leak-sum"><span class="rbody"><span class="met mon-fig2">${fig(could)}</span><span class="rmeta">a month you could keep by closing the subscription leaks</span></span></div>` : ''}
      ${rows.map((l) => `<button class="row ic mon-leak${l.open() ? '' : ' is-closed'}" data-act="mon-leak" data-id="${esc(l.id)}">${tile(l.icon)}
        <span class="rbody"><span class="rtitle">${esc(l.title)}</span><span class="rmeta"><span class="ell">${esc(l.meta ?? '')}</span></span></span>
        <span class="rend mon-rend">${l.open() ? l.amountHtml() : `<span class="pill plain">${l.closedLabel()}</span>`}</span></button>`).join('') || emptyRow('No leaks found', `${esc(AGENT.name)} looks for forgotten subscriptions, repeat charges and budgets running over as your spending comes in.`)}
    </div>`;
}
function injectionsBlock() {
  const inT = D.incomeTotal();
  const ids = [...new Set([...S.income.map((x) => x.c), ...S.sources.map((s) => s.id), ...(S.pending.length ? ['client'] : [])])];
  const rows = ids.map((id) => ({ c: D.incat(id), a: S.income.filter((x) => x.c === id).reduce((n, x) => n + x.a, 0), n: S.income.filter((x) => x.c === id).length, doc: D.sourceOf(id) }))
    .sort((a, b) => b.a - a.a).map((s) => `
    <button class="row ic mon-inj" data-act="mon-src" data-id="${s.c.id}">${tile(s.c.icon, 'mon-in-tile')}
      <span class="rbody"><span class="mon-inj-h"><span class="rtitle">${esc(s.doc?.name ?? s.c.name)}</span><span class="mon-amt c-as">+${inr(s.a)}</span></span>
        <span class="mon-share"><i style="--w:${inT ? (s.a / inT).toFixed(3) : 0}"></i></span>
        <span class="mon-inj-read">${esc(s.doc?.read ?? (s.n ? `${plural(s.n, 'payment')} this month` : s.c.id === 'client' ? 'Northwind clients · nothing paid yet this month' : 'Nothing yet this month'))}</span></span></button>`).join('');
  const rev = D.revenue();
  const goal = GOALS.find((g) => (g.aspects ?? []).includes('money'));
  return `${sh('Injections', { count: inr(inT), act: 'mon-add-in', label: 'Log' })}<div class="group mon-injg">${rows || emptyRow('Nothing in yet this month', 'Corner Market payouts, Northwind client payments, pocket money: log them as they come, or tell ' + esc(AGENT.name), 'mon-add-in', 'Log money in')}</div>
    ${S.pending.length ? `${sh('Still to come in')}
    <div class="group mon-pend">${S.pending.map((p) => `<button class="row ic" data-act="mon-src" data-id="client">${tile('rocket')}<span class="rbody"><span class="rtitle">${esc(p.name)}</span><span class="rmeta"><span class="ell">${esc(p.what ?? '')}${p.note ? ` · ${esc(p.note)}` : ''}</span></span></span><span class="rend mon-rend"><span class="mon-amt mon-amt-soft">${p.amount ? `${p.approx ? '≈' : ''}${inr(p.amount)}` : esc(p.label || 'to price')}</span></span></button>`).join('')}</div>` : ''}
    <div class="group mon-goalrow"><button class="row ic" data-act="mon-goal-money">${ring(rev / D.REVENUE_GOAL, 'as', 38, 5, { k: goal?.time ?? (1 - D.timeLeft()), label: `${Math.round(rev / D.REVENUE_GOAL * 100)}% of ₹2 lakh` })}
      <span class="rbody"><span class="rtitle">${inr(rev)} of ₹2 lakh a month</span><span class="rmeta">Earned in ${D.MONTH.name}, Northwind clients included${goal ? ' · a Mission goal' : ''}</span></span>${I.chevR}</button></div>`;
}
const whereView = { v: 'cats', day: null };
function whereCats() {
  const rows = D.CATS.map((c) => ({ c, a: D.catSpent(c.id) })).filter((r) => r.a > 0).sort((a, b) => b.a - a.a);
  const max = rows[0]?.a || 1;
  return rows.length ? `<div class="mon-bars">${rows.map((r) => `<button class="mon-bar" data-act="mon-cat" data-id="${r.c.id}">
    <span class="mon-bar-l">${G(r.c.icon)}<span>${esc(r.c.name)}</span></span>
    <span class="mon-bar-t"><i style="--w:${(r.a / max).toFixed(3)}"></i></span><b class="num">${inr(r.a)}</b></button>`).join('')}</div>` : `<div class="group">${emptyRow(`Nothing spent in ${D.MONTH.name} yet`, '')}</div>`;
}
function whereShops() {
  const by = new Map();
  for (const t of S.tx) { const k = t.m.replace(/ ·.*$/, '').replace(/, .*$/, ''); const r = by.get(k) ?? { m: k, a: 0, n: 0, c: t.c }; r.a += t.share; r.n += 1; by.set(k, r); }
  const rows = [...by.values()].sort((a, b) => b.a - a.a).slice(0, 8);
  const max = rows[0]?.a || 1;
  return rows.length ? `<div class="mon-bars">${rows.map((r) => `<div class="mon-bar">
    <span class="mon-bar-l">${G(D.cat(r.c).icon)}<span>${esc(r.m)}</span><small>×${r.n}</small></span>
    <span class="mon-bar-t"><i style="--w:${(r.a / max).toFixed(3)}"></i></span><b class="num">${inr(r.a)}</b></div>`).join('')}</div>` : `<div class="group">${emptyRow('No merchants yet', '')}</div>`;
}
function whereDays() {
  const max = Math.max(1, ...Array.from({ length: D.TODAY }, (_, i) => D.daySpent(i + 1)));
  const lead = (D.MONTH.first + 6) % 7;   // Monday first
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="mon-cd is-pad" aria-hidden="true"></span>');
  for (let d = 1; d <= D.MONTH.days; d++) {
    const fut = d > D.TODAY, sp = fut ? 0 : D.daySpent(d), lvl = fut ? 0 : Math.sqrt(sp / max);   // square root: small days stay told apart
    cells.push(`<button class="mon-cd${fut ? ' is-fut' : ''}${d === D.TODAY ? ' is-today' : ''}${lvl > 0.55 ? ' is-hi' : ''}${whereView.day === d ? ' is-on' : ''}" ${fut ? 'disabled' : `data-act="mon-cd" data-d="${d}"`} style="--l:${lvl.toFixed(3)}" aria-label="${D.dateLong(d)}${fut ? '' : `: ${inr(sp)}`}"><span>${d}</span></button>`);
  }
  const d = whereView.day ?? D.TODAY;
  const xs = D.sortTx(S.tx.filter((t) => t.d === d));
  return `<div class="mon-cal">
      <div class="mon-cal-h">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
      <div class="mon-cal-g">${cells.join('')}</div>
      <p class="mon-cal-key"><span>₹0</span><i></i><i></i><i></i><i></i><span>${inr(max)}</span></p>
    </div>
    <div class="mon-cal-day">${sh(`${D.dateLong(d)}`, { count: inr(D.daySpent(d)) })}<div class="group">${xs.map((t) => txRow(t)).join('') || '<div class="row"><span class="rbody"><span class="rtitle">No spending</span></span></div>'}</div></div>`;
}
const wherePanel = () => whereView.v === 'cats' ? whereCats() : whereView.v === 'shops' ? whereShops() : whereDays();
function renderFlow(el, app) {
  const from = lastWeekFrom();
  el.innerHTML = aspHead(app, { title: 'Flow', sub: `${D.MONTH.name} so far, in and out` })
    + keptHero() + leaksBlock() + injectionsBlock()
    + `${sh('Where it went', { count: inr(D.monthSpent()) })}
      <div class="pad mon-where-seg">${seg('mon-where', [['cats', 'Categories'], ['shops', 'Merchants'], ['days', 'Days']], whereView.v)}</div>
      <div class="mon-where" data-where>${wherePanel()}</div>
      <div class="group mon-report-g"><button class="row ic" data-act="mon-report">${tile('doc')}<span class="rbody"><span class="rtitle">Last week's money report</span><span class="rmeta">From ${esc(AGENT.name)} · ${D.wdName(D.addDays(from, 6))} ${D.dayMonth(D.addDays(from, 6))}</span></span>${I.chevR}</button></div>`;
  $('[data-seg="mon-where"]', el).addEventListener('change', (e) => { whereView.v = e.detail; const w = $('[data-where]', el); w.innerHTML = wherePanel(); if (!reduced()) stagger($$('.mon-bar, .mon-cd:not(.is-pad)', w).slice(0, 40), { y: 6, each: 12, max: 240 }); });
  enter(el);
}

// ═══ NET WORTH ══════════════════════════════════════════════════════════
const GROUPS = [['spend', 'Spendable now'], ['fx', 'Currency'], ['invest', 'Invested']];
function worthChart() {
  const pts = D.worthSeries(), n = pts.length, W = 340, H = 132, px = 10, py = 14;
  if (n < 2) return `<div class="mon-wchart is-empty" aria-hidden="true"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path class="mon-wline" d="M${px} ${H / 2} L${W - px} ${H / 2}" vector-effect="non-scaling-stroke" stroke-dasharray="4 6"/></svg></div><p class="hint mon-wfirst">The line grows a point at the end of each month.</p>`;
  const vs = pts.map((p) => p.worth), lo = Math.min(...vs) * (Math.min(...vs) > 0 ? 0.92 : 1.08), hi = Math.max(...vs) * 1.03 || 1;
  const x = (i) => px + i * (W - 2 * px) / (n - 1), y = (v) => H - py - (v - lo) / ((hi - lo) || 1) * (H - 2 * py);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.worth).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`;
  const grid = [0.25, 0.5, 0.75].map((g) => `<line x1="0" x2="${W}" y1="${(py + g * (H - 2 * py)).toFixed(1)}" y2="${(py + g * (H - 2 * py)).toFixed(1)}" />`).join('');
  const dots = pts.map((p, i) => `<i class="mon-wdot${i === n - 1 ? ' is-now' : ''}" style="left:${(x(i) / W * 100).toFixed(2)}%;top:${(y(p.worth) / H * 100).toFixed(2)}%"></i>`).join('');
  return `<div class="mon-wchart" data-wchart tabindex="0" role="img" aria-label="Net worth: ${pts.map((p) => `${p.m} ${inr(p.worth)}`).join(', ')}" data-pts='${JSON.stringify(pts.map((p, i) => [p.m, p.worth, (x(i) / W * 100).toFixed(2), (y(p.worth) / H * 100).toFixed(2)]))}'>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><g class="mon-wgrid">${grid}</g><path class="mon-warea" d="${area}"/><path class="mon-wline" d="${line}" vector-effect="non-scaling-stroke"/></svg>
      ${dots}<i class="mon-wx" aria-hidden="true"></i>
    </div>
    <div class="mon-wlabels" aria-hidden="true">${pts.map((p, i) => `<span style="left:${(x(i) / W * 100).toFixed(2)}%"${i === n - 1 ? ' class="is-now"' : ''}>${p.m}</span>`).join('')}</div>`;
}
function worthHero() {
  const w = D.netWorth(), pts = D.worthSeries(), prev = pts.length > 1 ? pts[pts.length - 2].worth : null, d = prev == null ? null : w - prev;
  return `<section class="mon-worth surface" data-worth>
    <p class="mon-hk" data-wk>Today</p>
    <p class="met mon-big" data-wbig>${fig(w, { sign: w < 0 ? '−' : '' })}</p>
    <p class="mon-hsub" data-wsub>${d == null ? 'What you have, plus what you\'re owed, minus what you owe' : `<b class="${d >= 0 ? 'c-as' : 'c-needs'}">${d >= 0 ? '+' : '−'}${inr(Math.abs(d))}</b> since the end of ${esc(D.monthName(pts[pts.length - 2].ym))}`}</p>
    ${worthChart()}
  </section>`;
}
function worthTiles() {
  const sp = D.groupTotal('spend'), rw = D.runway();
  const out = D.outTotal(), lean = out - D.leakMonthly() > 0 ? D.netWorth() / (out - D.leakMonthly()) : null;
  return `<div class="mon-tiles">
    <div class="surface mon-tile"><small>Spendable now</small><b class="met">${inr(sp)}</b><span>Cash, bank and UPI, today</span></div>
    <div class="surface mon-tile"><small>Runway</small>${rw != null ? `<b class="met">${rw.toFixed(1)}<span class="u">months</span></b><span>At ${D.MONTH.name}'s spending${lean && D.leakMonthly() ? `. ${lean.toFixed(1)} without the leaks` : ''}</span>` : `<b class="met">–</b><span>Shows once this month has spending</span>`}</div>
  </div>`;
}
function worthBars() {
  const parts = [['spend', 'Spendable now', D.groupTotal('spend')], ['fx', 'Currency', D.groupTotal('fx')], ['invest', 'Invested', D.groupTotal('invest')], ['owed', 'Owed to you', D.owedTotal()]];
  const have = parts.reduce((n, p) => n + Math.max(0, p[2]), 0), owe = D.oweTotal();
  if (!have && !owe) return '';
  return `<section class="mon-comp surface">
    <p class="mon-comp-h"><span>What you have</span><b class="num">${inr(have)}</b></p>
    <span class="mon-stack" role="img" aria-label="${parts.map((p) => `${p[1]} ${inr(p[2])}`).join(', ')}">${parts.map((p, i) => `<i class="s${i}" style="--w:${have ? (Math.max(0, p[2]) / have).toFixed(4) : 0}"></i>`).join('')}</span>
    <div class="mon-comp-key">${parts.filter((p) => p[2]).map((p) => `<span><i class="s${parts.indexOf(p)}"></i>${p[1]}<b class="num">${inr(p[2])}</b></span>`).join('')}</div>
    <p class="mon-comp-h"><span>What you owe</span><b class="num">${inr(owe)}</b></p>
    <span class="mon-stack is-owe"><i style="--w:${have ? Math.min(1, owe / have).toFixed(4) : owe ? 1 : 0}"></i></span>
    <p class="mon-comp-eq num">${inr(have)} − ${inr(owe)} = <b>${inr(D.netWorth())}</b></p>
  </section>`;
}
const acctRow = (a) => `<button class="row ic" data-act="mon-acct" data-id="${esc(a.id)}">${tile(a.icon)}<span class="rbody"><span class="rtitle">${esc(a.name)}</span><span class="rmeta"><span class="ell">${esc(a.meta || (a.zero ? 'Not counted' : `Set ${D.dayLabel(String(a.doc.as_of ?? '').slice(0, 10)).toLowerCase()}`))}</span></span></span><span class="rend mon-rend"><span class="mon-amt${a.zero ? ' mon-amt-soft' : ''}">${a.zero ? inr(0) : inr(a.a)}</span></span></button>`;
function worthGroups() {
  const has = (g) => S.accounts.some((a) => a.group === g);
  const out = GROUPS.filter(([g]) => has(g) || g === 'spend').map(([g, label]) => `${sh(label, { count: has(g) ? inr(D.groupTotal(g)) : '' , act: g === 'spend' ? 'mon-acct-new' : '', label: 'Add' })}<div class="group">${S.accounts.filter((a) => a.group === g).map(acctRow).join('') || emptyRow('No accounts yet', 'Your cash, bank and UPI balances. Type each once; transactions keep them current.', 'mon-acct-new', 'Add one')}</div>`).join('');
  const owed = S.owed.length || S.pending.length ? `${sh('Owed to you', { count: inr(D.owedTotal()) })}<div class="group">
    ${S.owed.map((o) => `<button class="row ic" data-act="mon-owed" data-id="${esc(o.person ?? o.id)}">${tile('user')}<span class="rbody"><span class="rtitle">${esc(o.name)}</span><span class="rmeta"><span class="ell">${esc(o.meta)}</span></span></span><span class="rend mon-rend"><span class="mon-amt">${inr(o.a)}</span></span></button>`).join('')}
    ${S.pending.map((p) => `<button class="row ic" data-act="mon-src" data-id="client">${tile('rocket')}<span class="rbody"><span class="rtitle">${esc(p.name)}</span><span class="rmeta"><span class="ell">Not counted until it's paid · ${esc(p.what ?? '')}</span></span></span><span class="rend mon-rend"><span class="mon-amt mon-amt-soft">${p.amount ? inr(p.amount) : esc(p.label || '')}</span></span></button>`).join('')}</div>` : '';
  const owe = S.owe.length ? `${sh('You owe', { count: inr(D.oweTotal()) })}<div class="group">${S.owe.map(acctRow).join('')}</div>` : '';
  return out + owed + owe;
}
function worthGoals() {
  const rows = GOALS.filter((g) => (g.aspects ?? []).includes('money')).slice(0, 4).map((g) => {
    const p = g.pace ?? 0;
    return `<button class="row ic" data-act="mon-goal" data-id="${esc(g.id)}">${ring(p, 'as', 36, 4.5, { k: g.time ?? null, label: `${Math.round(p * 100)}% done` })}
      <span class="rbody"><span class="rtitle">${esc(g.title)}</span><span class="rmeta"><span class="ell">${esc(String(g.verdict ?? '').toLowerCase() || g.horizon || '')}</span></span></span>${I.chevR}</button>`;
  }).join('');
  return `${fundBlock()}${S.funds.length ? '<p class="hint">A fund is money set aside, still in your account, so it\'s already in your net worth.</p>' : ''}${rows ? `${sh('Goals this money serves')}<div class="group mon-goals">${rows}</div>` : ''}
    <div class="group mon-brain-g"><button class="row ic" data-act="mon-brain">${tile('brain')}<span class="rbody"><span class="rtitle">Money in your Brain</span><span class="rmeta">Notes, decisions and what ${esc(AGENT.name)} knows about your money</span></span>${I.chevR}</button></div>`;
}
function renderWorth(el, app) {
  el.innerHTML = aspHead(app, { title: 'Net worth', sub: 'What you own, minus what you owe' })
    + (D.hasWorth() ? worthHero() + worthTiles() + worthBars() : `<section class="surface mon-worth mon-setup"><p class="mon-hk">One honest number</p><p class="mon-hsub">Add your cash, bank, UPI, investments and what you owe. ${esc(AGENT.name)} keeps them current from what you spend and the statements you share.</p><div class="pad"><button class="btn primary block" data-act="mon-acct-new" style="--c:var(--as-fill)">Add an account</button></div></section>`)
    + worthGroups() + worthGoals();
  scrub($('[data-wchart]', el), el);
  enter(el);
}
// drag across the line and the big number follows the month under your finger; let go and it returns to today
function scrub(ch, root) {
  if (!ch) return;
  const pts = JSON.parse(ch.dataset.pts), x = $('.mon-wx', ch), big = $('[data-wbig] [data-count]', root), k = $('[data-wk]', root), sub = $('[data-wsub]', root);
  const rest = { k: k.textContent, sub: sub.innerHTML };
  let cur = -1;
  const show = (i) => {
    if (i === cur) return; cur = i; haptic(4);
    const [mo, v, lx] = pts[i];
    ch.classList.add('is-scrub'); x.style.left = `${lx}%`;
    $$('.mon-wdot', ch).forEach((d, j) => d.classList.toggle('is-on', j === i));
    k.textContent = i === pts.length - 1 ? 'Today' : `End of ${mo}`;
    big.textContent = fmt(v);
    const prev = pts[i - 1]?.[1];
    sub.innerHTML = prev != null ? `<b class="${v >= prev ? 'c-as' : 'c-needs'}">${v >= prev ? '+' : '−'}${inr(Math.abs(v - prev))}</b> that month` : 'Where the line starts';
  };
  const end = () => { if (cur < 0) return; cur = -1; ch.classList.remove('is-scrub'); $$('.mon-wdot', ch).forEach((d) => d.classList.remove('is-on')); k.textContent = rest.k; sub.innerHTML = rest.sub; big.textContent = fmt(D.netWorth()); };
  const at = (e) => { const b = ch.getBoundingClientRect(); return Math.max(0, Math.min(pts.length - 1, Math.round((e.clientX - b.left) / b.width * (pts.length - 1)))); };
  ch.addEventListener('pointerdown', (e) => { ch.setPointerCapture(e.pointerId); show(at(e)); });
  ch.addEventListener('pointermove', (e) => { if (ch.hasPointerCapture(e.pointerId)) show(at(e)); });
  ch.addEventListener('pointerup', end); ch.addEventListener('pointercancel', end);
  ch.addEventListener('keydown', (e) => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); show(Math.max(0, Math.min(pts.length - 1, (cur < 0 ? pts.length - 1 : cur) + (e.key === 'ArrowLeft' ? -1 : 1)))); });
  ch.addEventListener('blur', end);
}

// ═══ PAGES ONE LEVEL DOWN ═══════════════════════════════════════════════
// where a month's spending ends at its pace so far, counted from when he started tracking (null with under 3 days)
function projection(spent) {
  const from = D.m.start.slice(0, 7) === D.MONTH.iso ? Number(D.m.start.slice(8, 10)) : 1;
  const days = D.TODAY - from + D.NOW_H / 24;
  if (days < 3 || !spent) return null;
  return Math.round((spent / days) * (D.MONTH.days - from + 1) / 100) * 100;
}
// a category: what's left with its pace, its weeks, where it went (her read is the facts), every spend in it
function catRead(id) {
  const xs = S.tx.filter((t) => t.c === id);
  if (!xs.length) return '';
  const by = new Map();
  for (const t of xs) { const k = t.m.replace(/ ·.*$/, '').replace(/, .*$/, ''); const r = by.get(k) ?? { m: k, a: 0, n: 0 }; r.a += t.share; r.n++; by.set(k, r); }
  const top = [...by.values()].sort((a, b) => b.a - a.a);
  const tot = xs.reduce((n, t) => n + t.share, 0), b = S.budgets[id] ?? 0;
  const proj = projection(tot);
  const lead = top[0].n > 1 ? `${esc(top[0].m)} is ${inr(top[0].a)} of it, ${plural(top[0].n, 'time')}.` : `The biggest was ${esc(top[0].m)}, ${inr(top[0].a)}.`;
  const pace = b && proj ? (proj > b ? ` At this pace it ends ${D.MONTH.name} near ${inr(proj)}, over its ${inr(b)}.` : ` At this pace it ends ${D.MONTH.name} near ${inr(proj)}, inside its ${inr(b)}.`) : '';
  return `${lead}${top.length > 1 ? ` ${plural(top.length, 'place')} in all.` : ''}${pace}`;
}
function openCategory(id) {
  const c = D.cat(id);
  let unsub = null;
  const page = pushMoney({ title: c.name, back: 'Budgets', onPop: () => unsub?.(),
    render(sc) {
      const draw = () => {
        const b = S.budgets[id] ?? 0, spent = D.catSpent(id), left = b - spent, over = b > 0 && left < -0.5, frac = b ? Math.max(0, left) / b : 0;
        const xs = D.sortTx(S.tx.filter((t) => t.c === id));
        const wk = [[1, 7], [8, 14], [15, 21], [22, D.MONTH.days]];
        const weeks = wk.map(([a, z]) => ({ a, z, v: S.tx.filter((t) => t.c === id && t.d >= a && t.d <= z).reduce((n, t) => n + t.share, 0) }));
        const wmax = Math.max(...weeks.map((w) => w.v), 1);
        const days = [...new Set(xs.map((t) => t.d))];
        const read = catRead(id);
        const acts = over ? (() => { const o = overshoot(); return o && o.c.id === id && o.room ? [[`Move ${inr(o.a)} from ${o.room.name}`, 'mon-move', `data-from="${o.room.id}" data-to="${id}" data-a="${o.a}"`, true]] : []; })()
          : c.aspect ? [[`Open ${c.aspect[0].toUpperCase() + c.aspect.slice(1)}`, 'mon-aspect', `data-id="${c.aspect}"`]] : [];
        sc.innerHTML = pageHead({ title: esc(c.name), sub: `${b ? `${inr(b)} a month` : 'No budget'} · ${plural(xs.length, 'spend')}`, right: `<button class="btn mon-headbtn" data-act="mon-edit-cat" data-id="${id}">${b ? 'Edit' : 'Set'}</button>` })
          + `<section class="mon-mhero surface mon-cathero">
              <div class="mon-mh-top">${ring(frac, over ? 'needs' : 'as', 120, 13, { k: D.timeLeft(), cls: 'mon-mring' })}
                <div class="mon-mh-txt"><p class="mon-hk">${!b ? 'Spent this month' : over ? 'Over budget' : 'Left this month'}</p><p class="met mon-fig1${over ? ' is-over' : ''}">${fig(!b ? spent : Math.abs(left))}</p>
                <p class="mon-hsub">${b ? `${inr(spent)} of ${inr(b)}` : 'Set a budget to track it'}</p>${b && !over && D.daysAfterToday() ? `<p class="mon-mh-day"><b>${inr(Math.max(0, left) / D.daysAfterToday())}</b> a day from tomorrow</p>` : ''}</div></div>
              <div class="mon-weeks">${weeks.map((w) => `<span class="mon-wk${D.TODAY >= w.a && D.TODAY <= w.z ? ' is-now' : ''}"><b class="num">${w.v ? inr(w.v) : ''}</b><span class="mon-wk-t"><i style="--h:${(w.v / wmax).toFixed(3)}"></i></span><small>${w.a}–${w.z}</small></span>`).join('')}</div>
            </section>`
          + (read || acts.length ? wynCard({ text: read || `Nothing spent here yet in ${D.MONTH.name}.`, acts }) : '')
          + (days.map((d) => `${sh(D.dayName(d), { count: inr(xs.filter((t) => t.d === d).reduce((n, t) => n + t.share, 0)) })}<div class="group">${xs.filter((t) => t.d === d).map((t) => txRow(t)).join('')}</div>`).join('') || `<div class="group">${emptyRow(`No ${esc(c.name.toLowerCase())} spends in ${D.MONTH.name}`, '')}</div>`);
        if (sc._html === sc.innerHTML) return;
        sc._html = sc.innerHTML;
        pulse(sc);
      };
      draw();
      unsub = D.onChange(() => { if (page.isConnected) draw(); });
    } });
}

// every transaction (this month and before), by day, with who logged it; filter by who logged it, search by name
function openLedger() {
  const st = { by: 'all', q: '' };
  pushMoney({ title: 'Transactions', back: 'Today', render(sc) {
    const outs = () => D.m.all.filter((t) => t.kind === 'out');
    sc.innerHTML = pageHead({ title: 'Transactions', sub: `${plural(outs().length, 'spend')} · ${plural(D.m.inAll.length, 'payment')} in` })
      + `<div class="pad mon-search"><label class="field">${I.search}<input type="search" placeholder="Search merchants and notes" aria-label="Search transactions" data-q></label></div>
         <div class="mon-rail mon-filters" data-scroll-x>${[['all', 'All'], ['upi', `UPI · ${AGENT.name}`], ['scan', 'Scanned'], ['you', 'You'], ['told', `Told ${AGENT.name}`], ['statement', 'Statement'], ['in', 'Money in']].map(([v, l]) => `<button class="chip sm${v === 'all' ? ' on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>
         <div data-list></div>`;
    const list = $('[data-list]', sc);
    const draw = () => {
      const q = st.q.trim().toLowerCase();
      const hit = (t) => !q || `${t.m} ${t.note} ${t.kind === 'in' ? D.incat(t.c).name : D.cat(t.c).name}`.toLowerCase().includes(q);
      if (st.by === 'in') {
        const xs = D.sortTx(D.m.inAll.filter(hit));
        list.innerHTML = xs.length ? `${sh('Money in', { count: inr(xs.reduce((n, x) => n + x.a, 0)) })}<div class="group">${xs.slice(0, 200).map((x) => incomeRow({ ...x, src: x.c, name: x.doc.merchant || D.incat(x.c).name, d: x.d })).join('')}</div>` : '<p class="note surface">Nothing matches.</p>';
        return;
      }
      const xs = D.sortTx(outs().filter((t) => (st.by === 'all' || t.by === st.by) && hit(t))).slice(0, 300);
      const days = [...new Set(xs.map((t) => t.date))];
      list.innerHTML = days.map((date) => {
        const dx = xs.filter((t) => t.date === date), tot = D.spentOn(date), a = D.allowanceOn(date), budgeted = a > 0;
        return `<div class="sh mon-dayh"><h2>${esc(D.dayLabel(date))}</h2><span class="sh-count">${inr(tot)}${budgeted ? ` of ${inr(a)}` : ''}</span>${!budgeted || date === D.today() ? '' : tot <= a + 0.5 ? `<span class="mon-kept-dot" aria-label="Under budget">${I.check}</span>` : '<span class="mon-over-dot c-needs">over</span>'}</div>
          <div class="group">${dx.map((t) => txRow(t)).join('')}</div>`;
      }).join('') || '<p class="note surface">Nothing matches.</p>';
    };
    draw();
    $('[data-q]', sc).addEventListener('input', (e) => { st.q = e.target.value; draw(); });
    $('.mon-filters', sc).addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; st.by = b.dataset.v; $$('.mon-filters .chip', sc).forEach((c) => c.classList.toggle('on', c === b)); haptic(5); draw(); });
  } });
}

// one budget: steps of ₹500, the effect on the days ahead shown as you change it
function openEditBudget(id) {
  const c = D.cat(id), was = S.budgets[id] ?? 0, st = { v: was || 1000 };
  const effect = () => { const d = st.v - was, per = D.daysAfterToday() ? Math.max(0, D.monthLeft() + d) / D.daysAfterToday() : 0; return `${inr(D.perDayFromTomorrow())} a day from tomorrow${d ? ` → <b>${inr(per)}</b>` : ''}`; };
  const proj = projection(D.catSpent(id));
  const el = monSheet({ title: `${esc(c.name)} budget`, sub: `Spent ${inr(D.catSpent(id))} so far in ${D.MONTH.name}`, cls: 'mon-editsheet', body: `
    <div class="mon-stepper">
      <button class="mon-step" data-act="mon-step" data-d="-500" aria-label="₹500 less">${I.minus}</button>
      <p class="met mon-fig1" data-v>${fig(st.v, { count: false })}</p>
      <button class="mon-step" data-act="mon-step" data-d="500" aria-label="₹500 more">${I.plus}</button>
    </div>
    <p class="mon-effect" data-effect>${effect()}</p>
    <div class="chips mon-presets">${[-1000, 0, 1000, 2000].map((d) => st.v + d).filter((v) => v > 0).map((v) => `<button class="chip sm${v === st.v ? ' on' : ''}" data-act="mon-preset" data-v="${v}">${inr(v)}</button>`).join('')}</div>
    ${proj ? `<p class="hint">At this month's pace, ${esc(c.name)} ends ${D.MONTH.name} near ${inr(proj)}.</p>` : ''}
    <div class="pad"><button class="btn primary block" data-act="mon-step-save" style="--c:var(--as-fill)">Save</button></div>` });
  el._st = st; el._id = id; el._effect = effect; el._was = was;
}
on('mon-step', (b) => {
  const sh = b.closest('.sheet'), st = sh._st;
  st.v = Math.max(0, st.v + Number(b.dataset.d)); haptic(5);
  $('[data-v]', sh).innerHTML = fig(st.v, { count: false });
  $('[data-effect]', sh).innerHTML = sh._effect();
  $$('.mon-presets .chip', sh).forEach((c) => c.classList.toggle('on', Number(c.dataset.v) === st.v));
});
on('mon-preset', (b) => {
  const sh = b.closest('.sheet'), st = sh._st; st.v = Number(b.dataset.v); haptic(5);
  $('[data-v]', sh).innerHTML = fig(st.v, { count: false }); $('[data-effect]', sh).innerHTML = sh._effect();
  $$('.mon-presets .chip', sh).forEach((c) => c.classList.toggle('on', c === b));
});
on('mon-step-save', (b) => {
  const sh = b.closest('.sheet'), id = sh._id, v = sh._st.v;
  closeSheet(sh);
  if (v === sh._was) return;
  const undo = D.setBudget(id, v);
  toast(`${D.cat(id).name}: ${inr(v)} a month`, undo);
});

// all the budgets at once (also the first-time setup)
function openEditAll() {
  const st = Object.fromEntries(D.CATS.map((c) => [c.id, S.budgets[c.id] ?? 0]));
  const first = !D.hasBudgets();
  pushMoney({ title: first ? 'Set budgets' : 'Edit budgets', back: 'Budgets', render(sc) {
    const total = () => Object.values(st).reduce((n, v) => n + v, 0);
    const draw = () => {
      const per = D.daysAfterToday() + 1 ? Math.max(0, total() - D.monthSpent() - D.saved()) / (D.daysAfterToday() + 1) : 0;
      sc.innerHTML = pageHead({ title: first ? 'Set budgets' : 'Edit budgets', sub: `${D.MONTH.name} · steps of ₹500` })
        + `<section class="surface mon-edit-sum"><p class="mon-hk">All categories</p><p class="met mon-fig1">${fig(total(), { count: false })}</p><p class="mon-hsub">${total() ? `About <b>${inr(per)}</b> a day for the rest of ${D.MONTH.name}` : 'Start with the ones you spend on most'}</p></section>
           <div class="group mon-edit-g">${D.CATS.map((c) => `<div class="row ic">${catTile(c.id)}<span class="rbody"><span class="rtitle">${esc(c.name)}</span><span class="rmeta">Spent ${inr(D.catSpent(c.id))}</span></span>
             <span class="mon-mini-step"><button class="mon-step sm" data-k="${c.id}" data-d="-500" aria-label="${esc(c.name)} ₹500 less">${I.minus}</button><b class="num">${inr(st[c.id])}</b><button class="mon-step sm" data-k="${c.id}" data-d="500" aria-label="${esc(c.name)} ₹500 more">${I.plus}</button></span></div>`).join('')}</div>
           <div class="pad mon-edit-acts"><button class="btn primary block" data-save style="--c:var(--as-fill)"${total() ? '' : ' disabled'}>Save budgets</button></div>`;
    };
    draw();
    sc.addEventListener('click', (e) => {
      const b = e.target.closest('.mon-step[data-k]');
      if (b) { st[b.dataset.k] = Math.max(0, st[b.dataset.k] + Number(b.dataset.d)); haptic(5); const y = sc.scrollTop; draw(); sc.scrollTop = y; return; }
      if (e.target.closest('[data-save]')) { const undo = D.setBudgets(st); pop(); haptic(12); toast(first ? 'Budgets set. Your daily budget starts now' : 'Budgets saved', undo); }
    });
  } });
}

// an account: its balance (type the real figure once; transactions keep it current), its kind, remove it
function openAccount(id) {
  const a = D.accountOf(id);
  if (!a) return;
  const isCard = a.kind === 'card';
  const el = monSheet({ title: esc(a.name), sub: esc(a.meta || ''), body: `
    <p class="met mon-fig1 mon-sheet-fig">${a.zero ? inr(0) : fig(a.a, { count: false })}</p>
    <label class="field mon-bal">${G('edit')}<input data-bal inputmode="decimal" placeholder="${isCard ? 'What the card owes now' : 'The balance now'}" value=""></label>
    <div class="group">
      ${isCard ? S.bills.filter((b) => b.on === 'card').map((b) => `<div class="row ic">${tile('repeat')}<span class="rbody"><span class="rtitle">${esc(b.name)}</span><span class="rmeta">${b.d} ${D.MONTH.short}</span></span><span class="rend mon-rend"><span class="mon-amt">${inr(b.a)}</span></span></div>`).join('') : ''}
      <div class="row"><span class="rbody"><span class="rtitle">Kept up to date by ${esc(AGENT.name)}</span><span class="rmeta">${a.group === 'spend' || isCard ? 'Each spend and payment on it moves it; a statement resets it to the bank\'s figure' : 'From what you tell her'}</span></span></div>
    </div>
    <div class="pad mon-sheet-acts"><button class="btn primary block" data-act="mon-bal-save" data-id="${esc(a.id)}" style="--c:var(--as-fill)">Update the balance</button><button class="btn block mon-del" data-act="mon-acct-del" data-id="${esc(a.id)}">${I.trash}Remove it</button></div>` });
  return el;
}
on('mon-bal-save', (b) => {
  const sh = b.closest('.sheet'), v = Number(String($('[data-bal]', sh)?.value ?? '').replace(/[₹,\s]/g, ''));
  if (!Number.isFinite(v) || $('[data-bal]', sh).value.trim() === '') { $('[data-bal]', sh)?.focus(); return; }
  closeSheet(sh);
  const undo = D.setBalance(b.dataset.id, v);
  toast(`Balance set to ${inr(v)}`, undo);
});
on('mon-acct-del', (b) => { closeSheet(b.closest('.sheet')); const a = D.accountOf(b.dataset.id); const undo = D.removeAccount(b.dataset.id); toast(`Removed ${a?.name ?? 'the account'}`, undo); });
function newAccount() {
  const st = { kind: 'bank' };
  const el = monSheet({ title: 'Add an account', sub: 'Its balance now. Transactions keep it current from here', body: (bd) => {
    const draw = () => {
      bd.innerHTML = `<div class="mon-rail mon-catchips" data-scroll-x>${D.ACCOUNT_KINDS.map(([k, l, ic]) => `<button class="chip sm${st.kind === k ? ' on' : ''}" data-kind="${k}">${G(ic)}${esc(l)}</button>`).join('')}</div>
        <label class="field">${G('edit')}<input data-name placeholder="${{ cash: 'Cash', bank: 'Demo Bank savings', upi: 'UPI Lite', wallet: 'Amazon Pay balance', fx: 'US dollars', invest: 'Nifty 50 index fund', trading: 'Trading', card: 'Demo Bank credit card', loan: 'Education loan', owed: 'Who owes you' }[st.kind]}" maxlength="40" value="${esc(st.name ?? '')}"></label>
        <label class="field">${I.rupee ?? ''}<input data-bal inputmode="decimal" placeholder="${st.kind === 'card' || st.kind === 'loan' ? 'What you owe on it now' : st.kind === 'fx' ? 'Its value in rupees now' : 'The balance now'}" value="${esc(st.bal ?? '')}"></label>
        <div class="pad"><button class="btn primary block" data-act="mon-acct-save" style="--c:var(--as-fill)">Add it</button></div>`;
    };
    draw();
    bd.addEventListener('click', (e) => { const k = e.target.closest('[data-kind]'); if (!k) return; st.name = $('[data-name]', bd).value; st.bal = $('[data-bal]', bd).value; st.kind = k.dataset.kind; haptic(5); draw(); });
  } });
  el._st = st;
}
on('mon-acct-new', () => newAccount());
on('mon-acct-save', (b) => {
  const sh = b.closest('.sheet'), st = sh._st;
  const kindName = D.ACCOUNT_KINDS.find((x) => x[0] === st.kind)?.[1] ?? 'Account';
  const name = $('[data-name]', sh).value.trim() || kindName, bal = Number(String($('[data-bal]', sh).value).replace(/[₹,\s]/g, ''));
  if (!Number.isFinite(bal)) { $('[data-bal]', sh).focus(); return; }
  closeSheet(sh);
  D.addAccount({ name, kind: st.kind, balance: bal });
  haptic(12); toast(`Added ${name}`);
});
function openBill(id) {
  const b = S.bills.find((x) => x.id === id); if (!b) return;
  monSheet({ title: esc(b.name), sub: `${inr(b.a)}${b.note ? ` · ${esc(b.note)}` : ''}`, body: `<div class="group">
    <div class="row"><span class="rbody"><span class="rtitle">${b.due ? `Charged ${b.d} ${D.MONTH.short}` : `Due ${b.d} ${D.MONTH.short}`}</span><span class="rmeta">Next on ${esc(b.next)} · ${b.on === 'card' ? 'your card' : 'UPI autopay'}</span></span></div>
    <div class="row"><span class="rbody"><span class="rtitle">Outside the daily budget</span><span class="rmeta">Set aside before the month's spending</span></span></div></div>
    <div class="pad mon-sheet-acts"><button class="btn block" data-act="mon-bill-leak" data-id="${esc(b.id)}">Mark as a leak to review</button><button class="btn block mon-del" data-act="mon-bill-end" data-id="${esc(b.id)}">${I.trash}I stopped paying it</button></div>` });
}
on('mon-bill-leak', (b) => { closeSheet(b.closest('.sheet')); D.updateBill(b.dataset.id, { leak: true }); toast('In Leaks, to decide on'); });
on('mon-bill-end', (b) => { closeSheet(b.closest('.sheet')); D.updateBill(b.dataset.id, { state: 'cancelled' }); toast('Off your bills', () => D.updateBill(b.dataset.id, { state: 'active' })); });
on('mon-bill-new', () => {
  const el = monSheet({ title: 'Add a bill or subscription', sub: 'It sits outside the daily budget', body: `
    <label class="field">${G('repeat')}<input data-name placeholder="Spotify, Jio recharge, rent…" maxlength="40"></label>
    <label class="field">${I.rupee ?? ''}<input data-amt inputmode="decimal" placeholder="Amount a month"></label>
    <label class="field">${I.cal}<input data-day inputmode="numeric" placeholder="Day of the month it's charged (1–31)"></label>
    <div class="mon-rail mon-catchips"><button class="chip sm on" data-pay="upi">${G('phone')}UPI</button><button class="chip sm" data-pay="card">${G('card')}Card</button></div>
    <div class="pad"><button class="btn primary block" data-act="mon-bill-save" style="--c:var(--as-fill)">Add it</button></div>` });
  el.addEventListener('click', (e) => { const p = e.target.closest('[data-pay]'); if (!p) return; $$('[data-pay]', el).forEach((x) => x.classList.toggle('on', x === p)); });
});
on('mon-bill-save', (b) => {
  const sh = b.closest('.sheet'), name = $('[data-name]', sh).value.trim(), amount = Number(String($('[data-amt]', sh).value).replace(/[₹,\s]/g, '')), day = Math.min(31, Math.max(1, Number($('[data-day]', sh).value) || D.TODAY));
  if (!name) { $('[data-name]', sh).focus(); return; }
  if (!(amount > 0)) { $('[data-amt]', sh).focus(); return; }
  closeSheet(sh);
  D.addBill({ name, amount, day, pay: $('[data-pay].on', sh)?.dataset.pay ?? 'upi' });
  toast(`${name}: ${inr(amount)} a month`);
});
// a fund: start one, put money in
on('mon-fund-new', () => {
  monSheet({ title: 'Start a fund', sub: 'Money set aside for one thing', body: `
    <label class="field">${G('piggy')}<input data-name placeholder="Anniversary dinner, a new phone…" maxlength="40"></label>
    <label class="field">${I.rupee ?? ''}<input data-target inputmode="decimal" placeholder="Target (optional)"></label>
    <label class="field">${I.rupee ?? ''}<input data-monthly inputmode="decimal" placeholder="A month (optional)"></label>
    <div class="mon-rail mon-catchips"><button class="chip sm" data-aspect-pick="family">${I.home}Share with Family</button></div>
    <div class="pad"><button class="btn primary block" data-act="mon-fund-save" style="--c:var(--as-fill)">Start it</button></div>` }).addEventListener('click', (e) => { const p = e.target.closest('[data-aspect-pick]'); if (p) p.classList.toggle('on'); });
});
on('mon-fund-save', (b) => {
  const sh = b.closest('.sheet'), name = $('[data-name]', sh).value.trim();
  if (!name) { $('[data-name]', sh).focus(); return; }
  const n = (sel) => Number(String($(sel, sh).value).replace(/[₹,\s]/g, '')) || 0;
  const fam = $('[data-aspect-pick].on', sh);
  closeSheet(sh);
  D.addFund({ name, target: n('[data-target]'), monthly: n('[data-monthly]'), aspect: fam ? 'family' : null, key: fam && !D.fundOf('anniversary') && /anniversar/i.test(name) ? 'anniversary' : null });
  toast(`Started ${name}`);
});
function openFund(id) {
  const f = D.fundOf(id); if (!f) return;
  monSheet({ title: esc(f.name), sub: `${inr(f.saved)}${f.target ? ` of ${D.lakh(f.target)}` : ''} saved`, body: `
    <div class="mon-fund-ring">${ring(f.target ? Math.min(1, f.saved / f.target) : 0, 'as', 120, 12, { label: `${inr(f.saved)} saved` })}</div>
    <div class="chips mon-presets">${[500, 1000, 2000, f.monthly].filter((v, i, a) => v > 0 && a.indexOf(v) === i).map((v) => `<button class="chip sm" data-act="mon-save-fund" data-id="${esc(f.id)}" data-a="${v}">Put in ${inr(v)}</button>`).join('')}</div>
    <p class="hint">It stays in your account, so your net worth doesn't change; it comes out of what you can spend from tomorrow.</p>
    ${f.aspect ? `<div class="pad"><button class="btn block" data-act="mon-fund-aspect" data-id="${esc(f.aspect)}">See it in ${esc(f.aspect[0].toUpperCase() + f.aspect.slice(1))}</button></div>` : ''}` });
}
on('mon-fund-aspect', (b) => { closeSheet(b.closest('.sheet')); api.openAspect(b.dataset.id, b.dataset.id === 'family' ? 'dates' : undefined); });
// someone owes him: settle it when they pay back
function openOwed(pid) {
  const o = S.owed.find((x) => x.person === pid || x.id === pid);
  const p = person(pid);
  if (!o) { if (p) api.openPerson(pid); return; }
  monSheet({ title: esc(o.name), sub: `Owes you ${inr(o.a)}`, body: `<div class="group">${(o.tx ?? []).map((id) => D.txOf(id)).filter(Boolean).map((t) => txRow(t, { day: true })).join('')}</div>
    <div class="pad mon-sheet-acts">${o.account ? '' : `<button class="btn primary block" data-act="mon-settle" data-id="${esc(o.person)}" style="--c:var(--as-fill)">${esc(o.name)} paid me back</button>`}${p ? `<button class="btn block" data-act="mon-person" data-id="${esc(p.id)}">Open ${esc(p.name)}</button>` : ''}</div>` });
}
on('mon-owed', (el) => { closeSheet(); openOwed(el.dataset.id); });
on('mon-settle', (b) => { closeSheet(b.closest('.sheet')); const undo = D.settleSplit(b.dataset.id); haptic(12); toast('Settled', undo); });

// ═══ ACTIONS (global: Home and the agent can call them from anywhere) ═══
on('mon-quick-add', () => openAdd());
on('mon-add', () => openAdd());
on('mon-scan', () => api.scan('receipt'));
on('mon-go', (el) => goTo(el.dataset.s));
on('mon-tx', (el) => openTxSheet(el.dataset.id));
on('mon-all', () => openLedger());
on('mon-cat', (el) => openCategory(el.dataset.id));
on('mon-edit', () => openEditAll());
on('mon-edit-cat', (el) => openEditBudget(el.dataset.id));
on('mon-statement', () => openStatement());
on('mon-leak', (el) => openLeak(el.dataset.id));
on('mon-bill', (el) => openBill(el.dataset.id));
on('mon-src', (el) => openSource(el.dataset.id));
on('mon-acct', (el) => openAccount(el.dataset.id));
on('mon-task', (el) => api.openTask(el.dataset.id));
on('mon-goal', (el) => api.openGoal(el.dataset.id));
on('mon-person', (el) => { closeSheet(); api.openPerson(el.dataset.id); });
on('mon-aspect', (el) => api.openAspect(el.dataset.id));
on('mon-brain', () => api.openBrain('money'));
on('mon-fund', (el) => openFund(el.dataset.id ?? S.funds[0]?.id));
on('mon-ask', (el) => api.askAgent(el.dataset.q, { aspect: 'money' }));
on('mon-tools', () => openTools());
on('mon-streak', () => openStreak());
on('mon-report', () => openReport());
// a day in the week strip: read it out; tap it again to go back to the streak
on('mon-wd', (el) => {
  const wk = el.closest('[data-week]'), date = el.dataset.date, read = $('[data-wkread]', wk);
  const was = el.classList.contains('is-on');
  $$('.mon-wd', wk).forEach((b) => b.classList.toggle('is-on', !was && b === el)); haptic(4);
  if (was) { read.innerHTML = weekRead(); return; }
  const a = D.allowanceOn(date), sp = D.spentOn(date), isT = date === D.today();
  read.innerHTML = `<span><b>${D.wdName(date)} ${D.dayMonth(date)}</b> · ${inr(sp)}${a > 0 ? ` of ${inr(a)}${isT ? ` · ${inr(Math.max(0, a - sp))} to spare` : sp <= a + 0.5 ? ' · kept' : ' · over'}` : ' spent'}</span>`;
});
on('mon-kc', (el) => {
  const i = Number(el.dataset.i), series = D.keptSeries(), x = series[i], box = el.closest('.mon-kept');
  $$('.mon-kc', box).forEach((b) => b.classList.toggle('is-on', b === el)); haptic(4);
  const st = D.monthStats(x.ym);
  $('[data-kread]', box).textContent = i === series.length - 1 ? `${D.MONTH.name} so far: ${inr(D.incomeTotal())} in, ${inr(D.outTotal())} out. Kept ${inr(x.kept)}.` : st.any ? `${D.monthName(x.ym)}: ${inr(st.in)} in, ${inr(st.out)} out. Kept ${inr(x.kept)}.` : `${D.monthName(x.ym)}: kept ${inr(x.kept)}.`;
});
on('mon-cd', (el) => { whereView.day = Number(el.dataset.d); haptic(4); const w = el.closest('[data-where]'); if (w) w.innerHTML = wherePanel(); });
// her suggested move: an overshoot covered from a category with room
on('mon-move', (b) => {
  const from = b.dataset.from, to = b.dataset.to, a = Number(b.dataset.a);
  if (!from || !to || !(a > 0)) return;
  const undo = D.moveBudget(from, to, a);
  if (S.moved) S.moved.undo = undo;
  haptic(10);
  toast(`Moved ${inr(a)} from ${D.cat(from).name} to ${D.cat(to).name}`, undo);
});
on('mon-move-undo', () => { S.moved?.undo?.(); });
on('mon-move-no', (b) => { const id = b.dataset.id; const undo = D.setLeak(`over:${D.MONTH.iso}:${id}`, 'ok', { kind: 'over' }); toast(`${D.cat(id).name} stays over this month`, undo); });
on('mon-save-fund', (b) => {
  const id = b.dataset.id ?? S.funds[0]?.id, a = Number(b.dataset.a) || 0;
  if (!id || !(a > 0)) return;
  closeSheet(b.closest('.sheet') ?? undefined);
  const undo = D.saveToFund(id, a); haptic(10);
  toast(`${inr(a)} into ${D.fundOf(id)?.name ?? 'the fund'}`, undo);
});
on('mon-save-no', (el) => { el.closest('.mon-wyn')?.remove(); toast('Kept to spend. I\'ll ask again on Sunday'); });

// ═══ THE APP ════════════════════════════════════════════════════════════
const SECTIONS = [
  { id: 'home', label: 'Today', icon: MI.wallet, render: keepHtml((el, app) => { renderHome(el, app); enter(el); }) },
  { id: 'budget', label: 'Budgets', icon: MI.pie, render: keepHtml(renderBudget) },
  { id: 'flow', label: 'Flow', icon: MI.io, render: keepHtml(renderFlow) },
  { id: 'worth', label: 'Net worth', icon: I.trend, render: keepHtml(renderWorth) },
];
registerAspect({
  id: 'money',
  sections: SECTIONS,
  start: 'home',
  primary: { label: 'Add an expense', icon: I.plus, run: () => openAdd() },
  summary() {
    const quick = [{ label: 'Expense', icon: I.plus, act: 'mon-quick-add' }, { label: 'Receipt', icon: MI.receipt, act: 'mon-scan' }];
    if (!D.hasBudgets()) {
      const sp = D.todaySpent();
      return { line: sp ? `${inr(sp)} spent today · no budget set` : 'No budget set yet', metric: { v: Math.round(sp), unit: '₹', label: 'spent today', p: 0 },
        today: [{ id: 'mon-setup', text: 'Set a monthly budget to get a daily one', done: false, act: 'mon-edit' }], quick };
    }
    const allow = D.todayAllow(), left = allow - D.todaySpent(), n = D.streak();
    const rev = S.imports.find((x) => x.status === 'review');
    const leak = D.leaks().find((l) => l.state === 'open' && l.kind === 'subscription');
    const next = upcoming().find((u) => u.date);
    return {
      line: left >= 0 ? `${inr(left)} left of today's ${inr(allow)}` : `${inr(-left)} over today's ${inr(allow)}`,
      metric: { v: Math.round(Math.max(0, left)), unit: '₹', label: left >= 0 ? 'left today' : 'over today', p: allow > 0 ? Math.max(0, left) / allow : 0 },
      today: [
        rev ? { id: 'mon-statement', text: `Review the ${rev.bank ?? 'bank'} statement`, done: false, act: 'mon-statement' } : null,
        leak ? { id: 'mon-leak', text: `Decide on ${leak.title}: ${inr(leak.amount)} a month`, done: false, act: 'mon-leaks' } : null,
        { id: 'mon-under', text: left >= 0 ? `Stay under today's budget: ${inr(left)} to spare` : `Today is ${inr(-left)} over: save the streak`, done: false, act: 'mon-streak' },
      ].filter(Boolean).slice(0, 3),
      streak: { n, label: 'days under budget', atRisk: left < 200 },
      next: next ? { at: `${D.wdName(next.date)} ${Number(next.date.slice(8, 10))}`, text: next.title } : null,
      quick,
    };
  },
  scan: [
    { kind: 'receipt', label: 'Receipt or bill', hint: 'Adds the expense, split by item', handle: (r) => receiptScan(r) },
    { kind: 'statement', label: 'Bank statement', hint: 'Files every row; skips what UPI messages already logged', handle: (r) => statementScan(r) },
  ],
  tools: TOOLS,
});
on('mon-leaks', () => goTo('flow'));

// ═══ THE BUS AND LINKS ══════════════════════════════════════════════════
provide('logExpense', (prefill = {}) => openAdd(prefill));
provide('openBudget', (category) => {
  const app = goTo('budget');
  if (!category) return;
  const q = String(category).toLowerCase();
  const c = D.CATS.find((x) => x.id === q || x.name.toLowerCase() === q || x.name.toLowerCase().startsWith(q));
  if (c) setTimeout(() => openCategory(c.id), app ? 60 : 320);
});
provide('openNetWorth', () => goTo('worth'));
provide('openMoney', (section = 'home') => goTo(section));
provide('importStatement', () => openStatement());
provide('openLeaks', () => goTo('flow'));
provide('openIncome', (id) => openSource(id ?? 'wonder'));
provide('moneySummary', () => D.summary());
registerRoute('money/statement', (L, ctx) => { ctx.tab('life'); ctx.after(() => { const id = L.parts[2] ?? L.arg; const imp = id ? D.importOf(id) : null; if (imp && imp.status === 'review') openReview(imp); else openStatement(); }); }, { tab: 'life' });
registerRoute('money/leaks', (L, ctx) => { ctx.after(() => goTo('flow')); }, { tab: 'life' });
registerRoute('money/income', (L, ctx) => { ctx.after(() => openSource(L.parts[2] ?? 'client')); }, { tab: 'life' });
// the keypad opens over whatever is on screen (inside Money it stays in Money); a cold start from the widget lands on Today
registerRoute('money/expense', (L, ctx) => { ctx.after(() => openAdd({ amount: L.query.get('amount') ? Number(L.query.get('amount')) : undefined, note: L.query.get('note') ?? undefined, type: L.query.get('type') === 'in' ? 'in' : 'out' })); });

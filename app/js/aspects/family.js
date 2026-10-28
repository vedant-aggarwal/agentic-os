// Family: the people at home, time together, the moments the agent files, important dates, and a page for each of them.
// Owner: the PEOPLE agent (this file, family-data.js, people-store.js, css/aspects/family.css). Prefix: fam-.
// Sections: Together (home) · Moments · Dates. Primary action: log a moment. Person pages: person(id), #family/<id>.
// Real data: the people store (/api/v1/mod/people, offline-first). Every write is a real record; demo shows the sample.
// Signature moments: today's ring closes when a moment is filed (the week's hours roll up, the dinner streak turns over);
// "Together now" (his "I'm sitting with family" as a mode, synced so the agent can start it); a moment card that shows his
// own words above what the agent filed.
import { $, $$, esc, on, push, pop, openSheet, closeSheet, toast, haptic, ring, setRing, seg, wireSegs, fmtDur } from '../core.js';
import { I } from '../icons.js';
import { registerAspect, aspHead, openAspect } from '../aspects.js';
import { registerRoute } from '../svc/route.js';
import { AGENT, GOALS, DEMO_MODE } from '../data.js';
import { provide, api } from '../bus.js';
import { stagger, roll, rollHTML, symbol } from '../motion.js';
import * as P from './people-store.js';
import {
  S, today, week, dayGoal, weekGoal, SOURCE, KINDS, fmtDay, daysFrom, relDay, inDays, personOf, homeIds, withNames, pron,
  kept, shown, minutesOn, weekMinutes, weekMoments, dinnerOn, dinnersThisWeek, streak, dinnerMonth, momentById,
  rhythmsOf, remember, tonight, dates, sortedDates, wedding, planned, plans, gifts, showups, session, workFor, FUND, fundP,
} from './family-data.js';

let APP = null;                 // the open Family app (from onOpen)
const PAGES = new Set();        // open person pages, re-rendered when something changes
let TICK = null;                // the together session's clock
let BEFORE = null;              // the hero's numbers before a write, so it moves from there
const demoAsk = { shop: null }; // the prototype's sample ask (demo only)

// ── icons this app draws for itself (the same 24px grid and 2px line as js/icons.js) ──
const sv = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const IC = {
  plate: sv('<path d="M6.5 3v5a2.5 2.5 0 0 0 5 0V3M9 3v5.5M9 10.5V21"/><path d="M17.5 21V3.5c-1.9.9-3 3.3-3 6.6 0 2.1.9 3.2 3 3.4"/>'),
  shop: sv('<path d="M3.2 9.2 4.8 4.5h14.4l1.6 4.7"/><path d="M3.2 9.2a2.95 2.95 0 0 0 5.9 0 2.95 2.95 0 0 0 5.9 0 2.95 2.95 0 0 0 5.9 0"/><path d="M5 12v6.6A1.9 1.9 0 0 0 6.9 20.5h10.2a1.9 1.9 0 0 0 1.9-1.9V12"/><path d="M10 20.5v-3.7a2 2 0 0 1 4 0v3.7"/>'),
  rings: sv('<circle cx="9" cy="14.5" r="5.2"/><circle cx="15" cy="14.5" r="5.2"/><path d="m12 3.2 1.9 2-1.9 2.1-1.9-2.1z"/>'),
  diya: sv('<path d="M3.5 14h17c-.7 3.7-4.1 6.3-8.5 6.3S4.2 17.7 3.5 14Z"/><path d="M12 3c1.7 2 2.5 3.4 2.5 4.8a2.5 2.5 0 0 1-5 0C9.5 6.4 10.3 5 12 3Z"/><path d="M12 10.3V14"/>'),
  cake: sv('<path d="M4 20.5h16M5.5 20.5v-6A1.5 1.5 0 0 1 7 13h10a1.5 1.5 0 0 1 1.5 1.5v6"/><path d="M5.5 16.6c1.1 0 1.6-.9 3.2-.9s2.1.9 3.3.9 1.7-.9 3.3-.9 2.1.9 3.2.9"/><path d="M8.5 13v-3M12 13v-3M15.5 13v-3"/><path d="M8.5 6.6v.1M12 6.6v.1M15.5 6.6v.1" stroke-width="2.8"/>'),
  gift: sv('<rect x="3.5" y="8" width="17" height="4.5" rx="1.5"/><path d="M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5M12 8v12.5"/><path d="M12 8c-1.3-3.4-5.5-4.2-5.5-1.6C6.5 7.6 9.5 8 12 8Zm0 0c1.3-3.4 5.5-4.2 5.5-1.6 0 1.2-3 1.6-5.5 1.6Z"/>'),
  cup: sv('<path d="M4.5 9.5H16v4a5 5 0 0 1-5 5H9.5a5 5 0 0 1-5-5z"/><path d="M16 11h1.2a2.4 2.4 0 0 1 0 4.8h-1.6"/><path d="M8.5 3.8c-.6.8-.6 1.6 0 2.4M12 3.8c-.6.8-.6 1.6 0 2.4"/>'),
  wrench: sv('<path d="M14.6 6.4a4 4 0 0 0-5.2 5.2l-5.6 5.6a1.9 1.9 0 0 0 2.7 2.7l5.6-5.6a4 4 0 0 0 5.2-5.2l-2.4 2.4-2.3-.6-.6-2.3z"/>'),
  pin: sv('<path d="M12 20.8s-6.5-5.5-6.5-10.8a6.5 6.5 0 0 1 13 0c0 5.3-6.5 10.8-6.5 10.8Z"/><circle cx="12" cy="10" r="2.4"/>'),
  journal: sv('<rect x="4.5" y="3" width="15" height="18" rx="3.5"/><path d="M9 3v8l2-1.5 2 1.5V3"/><path d="M8.5 15h7M8.5 18h4.5"/>'),
  paint: sv('<rect x="4" y="3.5" width="14" height="5.5" rx="2"/><path d="M18 6.2h1.5a1 1 0 0 1 1 1v3.3a1 1 0 0 1-1 1H12v3"/><rect x="10.5" y="14.5" width="3" height="6.5" rx="1.2"/>'),
};
IC.cal = I.cal;
const KIND_IC = { meal: IC.plate, talk: I.chat, shop: IC.shop, help: IC.wrench, outing: IC.pin, call: I.phone, chat: I.chat };
const kindIcon = (k) => KIND_IC[k] ?? I.home;

// ── small helpers ─────────────────────────────────────────────────────
const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const lakh = (n) => (n >= 1e5 ? `₹${(n / 1e5).toFixed(n % 1e5 ? 1 : 0)} lakh` : `₹${n.toLocaleString('en-IN')}`);
const toArr = (v) => (v == null ? null : Array.isArray(v) ? v : String(v).split(',').filter(Boolean));
const asSheet = (el) => { el.dataset.aspect = 'family'; el.classList.add('fam-sheet'); return el; };
// a session reads in minutes together (21m, 1h 5m), never like a time of day
const clockLabel = (sec) => (sec < 60 ? 'Just now' : fmtDur(Math.floor(sec / 60)));
const everyone = () => homeIds();
const NOWM = () => P.nowMin();
const lastTogether = (id) => { const m = kept().find((x) => x.people.includes(id) && x.date <= today() && x.min > 0) ?? kept().find((x) => x.people.includes(id)); return m ? `${relDay(m.date)}${m.kind === 'chat' ? ', a chat' : m.kind === 'call' ? ', a call' : ''}` : 'Nothing logged yet'; };

// "also in": the Life map's idea that one thing sits in two places, as the system's 8px aspect dots
const alsoIn = (to, lead = 'Also in', tail = '') => `<p class="fam-also"><span>${lead}</span>${to.map(([a, label, act]) => `<button class="fam-also-l" data-act="${act}"><i class="dot" style="--c:var(--${a})"></i>${label}</button>`).join('')}${tail ? `<span class="fam-also-t">${tail}</span>` : ''}</p>`;

// a monogram on the family colour, and a small overlapping stack of them
const av = (id, size = 'md') => `<span class="fam-av ${size}" aria-hidden="true">${esc(String(personOf(id).name ?? '?').slice(0, 1))}</span>`;
const avs = (ids, size = 'xs') => `<span class="fam-avs ${size}" aria-hidden="true">${ids.map((id) => av(id, size)).join('')}</span>`;

// ── the week: seven small rings (an hour together a day), the hours, the dinner streak, tonight ──
function heroHtml() {
  const wk = weekMinutes(), n = streak(), goal = dayGoal();
  const days = week().map((iso, i) => {
    const off = daysFrom(iso), min = minutesOn(iso), plan = off >= 0 ? planned(iso)[0] : null;
    const name = fmtDay(iso, { weekday: 'long' });
    const label = off > 0 ? `${name}: ${plan ? `${plan.text}, planned` : 'nothing planned yet'}` : `${name}: ${fmtDur(min)} together`;
    const glyph = off > 0 && plan ? `<span class="fam-day-g">${IC[plan.icon] ?? ''}</span>` : '';
    return `<button class="fam-day${off === 0 ? ' is-today' : ''}${off > 0 ? ' is-future' : ''}" data-act="fam-day" data-d="${iso}" aria-label="${esc(label)}">
      ${ring(off > 0 ? 0 : min / goal, 'as', 38, 5, { id: off === 0 ? 'famRingToday' : '', delay: i * 45, inner: glyph })}
      <span class="fam-day-l">${fmtDay(iso, { weekday: 'narrow' })}</span></button>`;
  }).join('');
  return `<section class="fam-week surface" aria-label="This week together">
    ${session() ? liveHtml() : ''}
    <div class="fam-wk-top">
      <div class="fam-wk-fig">
        <p class="fam-wk-k">Together this week</p>
        <b class="met fam-wk-n" data-fam-week data-v="${wk}">${fmtDur(wk)}</b>
        <p class="fam-wk-of">of ${fmtDur(weekGoal())} · an hour a day</p>
      </div>
      <button class="fam-streak" data-act="fam-streak" aria-label="${n} dinners together in a row. See the month">
        <span class="fam-st-n">${I.flame}<b class="met" data-fam-streak>${rollHTML(n, { format: 'plain' })}</b></span>
        <span class="fam-st-l">${n === 1 ? 'dinner' : 'dinners'} in a row</span>
      </button>
    </div>
    <div class="fam-days">${days}</div>
    <div data-fb="tonight">${tonightHtml()}</div>
  </section>`;
}
function tonightHtml() {
  const m = kept().find((x) => x.date === today() && x.dinner);
  if (m) return `<button class="row fam-tonight" data-act="fam-moment" data-id="${m.id}">
    <span class="tile fam-tile is-done">${I.check}</span>
    <span class="rbody"><span class="rtitle">Dinner together, filed</span><span class="rmeta">${m.min ? `${fmtDur(m.min)} · ` : ''}today's ring ${minutesOn(today()) >= dayGoal() ? 'is closed' : 'is filling'}</span></span>${I.chevR}</button>`;
  const D = tonight();
  if (!D) return '';
  const left = D.start - NOWM();
  return `<button class="row fam-tonight" data-act="fam-dinner">
    <span class="tile fam-tile">${IC.plate}</span>
    <span class="rbody"><span class="rtitle">${esc(D.title)}</span><span class="rmeta"><b class="num">${hm(D.start)}</b><span class="ell">${left > 0 ? `in ${fmtDur(left)} · ` : ''}closes today's ring</span></span></span>${I.chevR}</button>`;
}
// while a together session runs, the hero leads with it, like a Live Activity
function liveHtml() {
  const s = session();
  return `<div class="fam-live"><span class="fam-live-d" aria-hidden="true"></span>
    <span class="rbody"><span class="rtitle">Together now · <b class="num" data-fam-tick>${clockLabel(Math.floor((Date.now() - s.start) / 1000))}</b></span><span class="rmeta">With ${esc(withNames(s.people))}</span></span>
    <button class="btn sm" data-act="fam-tog-open">Open</button></div>`;
}

// ── the people at home ───────────────────────────────────────────────
function peopleHtml() {
  const ids = homeIds();
  const cards = ids.map((id) => {
    const p = personOf(id), min = weekMinutes(id);
    return `<button class="fam-pc surface" data-act="fam-person" data-id="${id}" aria-label="${esc(`${p.name}: ${fmtDur(min)} together this week. Open`)}">
      ${ring(min / weekGoal(), 'as', 56, 4, { cls: 'fam-pc-rg', delay: 120, inner: av(id, 'md') })}
      <span class="fam-pc-n">${esc(p.name)}</span>
      <span class="fam-pc-r">${esc(p.short ?? p.role ?? 'Family')}</span>
      <span class="fam-pc-f"><b class="met">${fmtDur(min)}</b><small>this week</small></span>
      <span class="fam-pc-l">${esc(lastTogether(id))}</span>
    </button>`;
  }).join('');
  const s = session();
  return `<div class="sh"><h2>At home</h2><button class="sh-act" data-act="fam-add-person">${I.plus}Add</button></div>
    ${ids.length ? `<div class="fam-people">${cards}</div>` : `<p class="note surface fam-empty">Nobody here yet. Add the people at home, and ${esc(AGENT.name)} keeps time with them warm with you.</p>`}
    ${ids.length ? `<div class="pad fam-now-w">${s
      ? `<button class="btn block fam-now" data-act="fam-tog-open">${I.home}<span>Together now · <span class="num" data-fam-tick>${clockLabel(Math.floor((Date.now() - s.start) / 1000))}</span></span></button>`
      : `<button class="btn block fam-now" data-act="fam-together">${I.home}<span>I'm with family now</span></button>`}</div>` : ''}`;
}

// ── the agent in this app: what she asks (demo), what she filed ──────
function wynHtml() {
  const filed = shown().filter((m) => m.by === 'wyn' && daysFrom(m.date) >= -6).slice(0, 2);
  const ask = !DEMO_MODE ? '' : demoAsk.shop === null
    ? `<div class="row fam-na">
        <span class="tile fam-na-t">${I.sparkle}</span>
        <span class="rbody"><span class="rtitle wrap">Block Saturday for the shop?</span>
          <span class="fam-na-x">It's the first festive Saturday, and you missed the last one. 11:00 to 15:00 with Dad?</span>
          <span class="fam-na-acts"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="fam-ask-yes">Block it</button><button class="btn sm" data-act="fam-ask-no">Not this week</button></span></span></div>`
    : demoAsk.shop === 'yes'
      ? `<div class="row fam-na"><span class="tile fam-na-t is-done">${I.check}</span><span class="rbody"><span class="rtitle">Saturday 11:00 to 15:00 is blocked</span><span class="rmeta">I'll remind you at 10:00</span></span></div>`
      : `<div class="row fam-na"><span class="tile fam-na-t">${I.sparkle}</span><span class="rbody"><span class="rtitle">Not this Saturday</span><span class="rmeta">I'll ask again before the 31st</span></span></div>`;
  const rows = filed.map((m) => `<button class="row fam-na" data-act="fam-moment" data-id="${m.id}"><span class="tile fam-na-t is-done">${I.check}</span>
      <span class="rbody"><span class="rtitle">Filed ${m.min ? `${esc(relDay(m.date).toLowerCase() === 'today' ? 'today' : relDay(m.date))}'s ${fmtDur(m.min)}` : esc(m.title)}</span><span class="rmeta"><span class="ell">${m.said ? `From “${esc(m.said)}” at ${esc(m.at)}` : esc((SOURCE[m.from] ?? 'filed it').replace(/^from/, 'From'))}</span></span></span>${I.chevR}</button>`).join('');
  const hint = `<button class="row fam-na" data-act="fam-together"><span class="tile fam-na-t">${I.sparkle}</span>
      <span class="rbody"><span class="rtitle wrap">Say “I'm sitting with family”</span><span class="rmeta"><span class="ell">${esc(AGENT.name)} times it and files it here</span></span></span>${I.chevR}</button>`;
  return `<div class="sh"><h2>From ${esc(AGENT.name)}</h2><button class="sh-act" data-act="fam-ask">${I.sparkle}Ask</button></div>
    <div class="group fam-wyn">${ask}${rows || (DEMO_MODE ? '' : hint)}</div>`;
}

// ── showing up: the small things that matter ─────────────────────────
function showupHtml() {
  const list = showups();
  const rows = list.map((x) => {
    const d = !!x.done, who = x.with ?? [x.person];
    return `<div class="row fam-su${d ? ' is-done' : ''}">
      <button class="check${d ? ' done' : ''}" data-act="fam-su-check" data-id="${x.id}" aria-label="${esc(`${d ? 'Mark not done' : 'Mark done'}: ${x.title}`)}">${I.check}</button>
      <button class="rbody fam-su-b" data-act="fam-su-open" data-id="${x.id}"><span class="rtitle">${esc(x.title)}</span><span class="rmeta">${avs(who)}<span class="ell">${esc(x.meta ?? (x.by === 'wyn' ? `${AGENT.name} suggests` : 'You added it'))}</span></span></button>
    </div>`;
  }).join('');
  const left = list.filter((x) => !x.done).length;
  return `<div class="sh"><h2>Showing up</h2>${list.length ? `<span class="sh-count">${left}</span>` : ''}<button class="sh-act" data-act="fam-idea-add" data-k="showup">${I.plus}Add</button></div>
    ${list.length ? `<div class="group fam-sug">${rows}</div>` : `<p class="note surface fam-empty">Small things that matter to them: help at the shop, a call, bringing something home. Add one, or tell ${esc(AGENT.name)}.</p>`}`;
}

// ── a moment: who, when, what, and who logged it ─────────────────────
function srcHtml(m) {
  return m.by === 'wyn'
    ? `<span class="fam-mo-src">${I.sparkle}<span><b>${esc(AGENT.name)}</b> · ${esc(SOURCE[m.from] ?? 'filed this')}</span></span>`
    : `<span class="fam-mo-src">${I.user}<span>You logged this</span></span>`;
}
function saidHtml(m, full = false) {
  return `<span class="fam-said"><span class="fam-said-q">“${esc(m.said)}”</span><span class="fam-said-m">You to ${esc(AGENT.name)} at ${esc(m.at)}</span></span>${full && m.saidNote ? `<span class="fam-said-n">${esc(m.saidNote)}</span>` : ''}`;
}
const chatHtml = (m) => `<span class="fam-chat" aria-label="Chat">${m.chat.map(([who, t]) => `<span class="fam-bub ${who === 'me' ? 'me' : 'them'}"><span class="vh">${who === 'me' ? 'You' : esc(personOf(who).name)}: </span>${esc(t)}</span>`).join('')}</span>`;
function momentCard(m, { compact = false } = {}) {
  const when = [compact ? relDay(m.date) : null, m.at, m.min ? fmtDur(m.min) : null].filter(Boolean).join(' · ');
  return `<button class="fam-mo surface${S.fresh === m.id ? ' is-fresh' : ''}" data-act="fam-moment" data-id="${m.id}">
    <span class="fam-mo-top">${avs(m.people)}<span class="fam-mo-when">${esc(when)}</span><span class="fam-mo-k">${kindIcon(m.kind)}</span></span>
    <span class="fam-mo-t">${esc(m.title)}</span>
    ${m.text ? `<span class="fam-mo-x">${esc(m.text)}</span>` : ''}
    ${m.said ? saidHtml(m) : ''}
    ${m.chat ? chatHtml(m) : ''}
    ${srcHtml(m)}
  </button>`;
}
function latestHtml() {
  const list = shown().slice(0, 2);
  return `<div class="sh"><h2>Moments</h2>${list.length ? `<button class="sh-act" data-act="fam-go" data-s="moments">See all${I.chevR}</button>` : ''}</div>
    ${list.length ? `<div class="fam-mos">${list.map((m) => momentCard(m, { compact: true })).join('')}</div>`
      : `<p class="note surface fam-empty">No moments yet. Log one with the round button, or tell ${esc(AGENT.name)} when you're with them.</p>`}`;
}

// ── dates ─────────────────────────────────────────────────────────────
function leaf(iso) {
  return `<span class="fam-leaf" aria-hidden="true"><small>${fmtDay(iso, { month: 'short' })}</small><b class="met">${fmtDay(iso, { day: 'numeric' })}</b></span>`;
}
function dateRow(d, title = null) {
  if (!d.iso) {
    return `<div class="row fam-date"><span class="fam-leaf none" aria-hidden="true">${IC[d.icon] ?? I.cal}</span>
      <span class="rbody"><span class="rtitle">${esc(title ?? d.title)}</span><span class="rmeta">Not known yet</span></span>
      <button class="btn sm" data-act="fam-date-add" data-id="${d.id}">Add date</button></div>`;
  }
  const n = daysFrom(d.iso);
  let meta = `${fmtDay(d.iso, { weekday: 'long' })} · ${inDays(n)}`, note = d.note ?? '';
  if (d.kind === 'anniversary') { meta = `Every year · ${inDays(n)}`; note = d.year ? `Married in ${d.year}` : 'Add the year to count down to the 25th'; }
  if (d.kind === 'birthday' && d.doc?.annual) meta = `${fmtDay(d.iso, { weekday: 'long', day: 'numeric', month: 'short' })} · ${inDays(n)}`;
  return `<button class="row fam-date" data-act="fam-date" data-id="${d.id}">${leaf(d.iso)}
    <span class="rbody"><span class="rtitle">${esc(title ?? d.title)}</span><span class="rmeta"><span class="ell">${esc(meta)}</span></span>${note ? `<span class="rmeta fam-note"><span class="ell">${esc(note)}</span></span>` : ''}</span>${I.chevR}</button>`;
}
function comingHtml() {
  const list = sortedDates().slice(0, 3);
  return `<div class="sh"><h2>Coming up</h2><button class="sh-act" data-act="fam-go" data-s="dates">All dates${I.chevR}</button></div>
    ${list.length ? `<div class="group fam-dg">${list.map((d) => dateRow(d)).join('')}</div>` : `<p class="note surface fam-empty">Birthdays and festivals show here once you add the people at home.</p>`}`;
}

// ── section 1 · Together ─────────────────────────────────────────────
function renderTogether(el, app) {
  el.innerHTML = `${aspHead(app, { title: 'Together', sub: fmtDay(today(), { weekday: 'long', day: 'numeric', month: 'long' }) })}
    <div data-fb="hero">${heroHtml()}</div>
    <div data-fb="people">${peopleHtml()}</div>
    <div data-fb="wyn">${wynHtml()}</div>
    <div data-fb="showup">${showupHtml()}</div>
    <div data-fb="latest">${latestHtml()}</div>
    <div data-fb="coming">${comingHtml()}</div>`;
  stagger($$('.fam-pc, .fam-mo', el), { y: 10, each: 50, delay: 120 });
}

// ── section 2 · Moments: the family journal ──────────────────────────
function timelineHtml() {
  const list = shown().filter((m) => S.filter === 'all' || m.people.includes(S.filter));
  if (!list.length) return S.filter === 'all'
    ? `<p class="note surface">The family journal is empty so far. Tell ${esc(AGENT.name)} when you're with them, share a chat, or log one.</p>`
    : `<p class="note surface">No moments with ${esc(personOf(S.filter).name)} yet. Tell ${esc(AGENT.name)} when you're with them, or log one.</p>`;
  const groups = [];
  for (const m of list) { let g = groups[groups.length - 1]; if (!g || g.date !== m.date) groups.push(g = { date: m.date, items: [] }); g.items.push(m); }
  return groups.map((g) => {
    const off = daysFrom(g.date), min = minutesOn(g.date, S.filter === 'all' ? null : S.filter);
    const sub = off > -6 ? fmtDay(g.date) : '';
    return `<h3 class="fam-dh"><span>${esc(relDay(g.date))}</span>${sub && off > -2 ? `<small>${esc(sub)}</small>` : ''}${min ? `<em class="num">${fmtDur(min)} together</em>` : ''}</h3>
      ${g.items.map((m) => momentCard(m)).join('')}`;
  }).join('');
}
function renderMoments(el, app) {
  const wk = weekMoments(), wyn = wk.filter((m) => m.by === 'wyn').length;
  const count = (id) => shown().filter((m) => m.people.includes(id)).length;
  const ids = homeIds();
  if (S.filter !== 'all' && !ids.includes(S.filter)) S.filter = 'all';
  el.innerHTML = `${aspHead(app, { title: 'Moments', sub: wk.length ? `The family journal. ${esc(AGENT.name)} filed ${wyn} of this week's ${wk.length}.` : 'The family journal: what you told her, the chats you shared, your calendar.' })}
    ${ids.length > 1 ? `<div class="pad fam-filter">${seg('famWho', [['all', 'All', shown().length], ...ids.slice(0, 3).map((id) => [id, esc(personOf(id).name), count(id)])], S.filter)}</div>` : ''}
    ${wk.length ? `<div class="fam-rv surface">
      <span class="tile fam-na-t">${I.sparkle}</span>
      <span class="fam-rv-t"><b>Sunday's look back</b><small>${esc(AGENT.name)} goes through the week's ${wk.length} ${wk.length === 1 ? 'moment' : 'moments'} with you. You keep what matters.</small></span>
      <button class="btn sm tint" style="--c:var(--as-ink)" data-act="fam-review">Start</button>
    </div>` : ''}
    <div class="fam-tl" data-fb="timeline">${timelineHtml()}</div>`;
  el.onchange = (e) => {
    if (!e.target.closest?.('[data-seg="famWho"]')) return;
    S.filter = e.detail; const tl = $('[data-fb="timeline"]', el); if (tl) { tl.innerHTML = timelineHtml(); stagger($$('.fam-mo', tl).slice(0, 6), { y: 8, each: 35 }); }
  };
  stagger($$('.fam-mo', el).slice(0, 6), { y: 10, each: 45, delay: 80 });
}

// ── section 3 · Dates: the 25th, what's coming, plans, gift ideas ────
function the25Html() {
  const w = wedding();
  const G25 = DEMO_MODE ? GOALS.find((g) => g.id === 'g10') : null;
  if (!DEMO_MODE && !w?.year) return '';
  const names = withNames(homeIds().slice(0, 2));
  let count = '';
  if (w?.year) {
    const y = Number(w.year) + 25, iso = `${y}-${w.md}`, n = daysFrom(iso);
    count = n >= 0
      ? `<div class="fam-25-c"><b class="met">${rollHTML(n, { format: 'int' })}</b><span><b>days to go</b><small>${esc(`${fmtDay(iso)} ${y}`)}</small></span></div>`
      : `<p class="fam-25-s">With ${w.year}, their 25th has already passed. Check the year?</p>`;
  }
  const steps = DEMO_MODE ? [
    ['Budget', true, lakh(FUND.target)],
    ['Wedding date', !!w?.year, w?.year ? fmtDay(`${w.year}-${w.md}`, { day: 'numeric', month: 'short', year: 'numeric' }) : w?.md ? `${fmtDay(`2026-${w.md}`, { day: 'numeric', month: 'short' })} · add the year` : 'Add it to count down', !w?.year],
    ['Guest list', false, 'Not started'],
    ['Venue', false, 'Not started'],
  ] : [];
  const done = steps.filter((s) => s[1]).length;
  return `<section class="fam-25 surface" aria-label="Their 25th">
    <div class="fam-25-k"><span>${IC.rings}${G25 ? 'Goal · later' : 'Their wedding anniversary'}</span>${G25 ? `<button class="fam-link" data-act="fam-goal">Open goal${I.chevR}</button>` : ''}</div>
    <h2 class="fam-25-t">${esc(names)}'s 25th</h2>
    <p class="fam-25-s">${DEMO_MODE ? 'You want to host it yourself, and pay for it.' : 'The day comes round once. Plan it with time to spare.'}</p>
    ${alsoIn([['money', 'Money', 'fam-money'], ['mission', 'Mission', 'fam-mission']])}
    ${count}
    ${FUND ? `<button class="fam-fund" data-act="fam-money" aria-label="${esc(`${FUND.name}: ₹${FUND.saved.toLocaleString('en-IN')} saved of ${lakh(FUND.target)}. Open Money`)}">
      ${ring(fundP(), 'as', 72, 9, { inner: `<span class="fam-fund-p met">${Math.round(fundP() * 100)}<small>%</small></span>` })}
      <span class="fam-fund-t"><b class="met">₹${FUND.saved.toLocaleString('en-IN')}</b><small>saved of ${lakh(FUND.target)}</small><small class="fam-fund-m">+₹${FUND.month.toLocaleString('en-IN')} this month · in Money</small></span>
      ${I.chevR}
    </button>` : ''}
    ${steps.length ? `<div class="fam-steps-h"><span>Ready</span><b class="num">${done} of ${steps.length}</b></div>
    <div class="fam-steps">${steps.map(([t, ok, meta, addIt]) => addIt
      ? `<button class="fam-step is-add" data-act="fam-date-add" data-id="add-wedding"><i aria-hidden="true">${I.plus}</i><span><b>${esc(t)}</b><small>${esc(meta)}</small></span></button>`
      : `<div class="fam-step${ok ? ' ok' : ''}"><i aria-hidden="true">${ok ? I.check : ''}</i><span><b>${esc(t)}</b><small>${esc(meta)}</small></span></div>`).join('')}</div>` : ''}
    <div class="fam-25-acts">
      <button class="btn sm tint" style="--c:var(--as-ink)" data-act="fam-plan25">${I.sparkle}Plan it with ${esc(AGENT.name)}</button>
    </div>
  </section>`;
}
function weddingAskHtml() {
  if (!DEMO_MODE || wedding()) return '';
  return `<div class="fam-wq surface">
    <span class="tile fam-na-t">${I.sparkle}</span>
    <span class="fam-wq-b"><b>Is 25 October their wedding day?</b>
      <small>You're taking them out for their anniversary on Sunday. If that's the date, I'll keep it for every year.</small>
      <span class="fam-na-acts"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="fam-wed-yes">Yes, 25 Oct</button><button class="btn sm" data-act="fam-date-add" data-id="add-wedding">Another date</button></span></span>
  </div>`;
}
function plansHtml() {
  const list = plans();
  if (!list.length) return `<div class="row fam-plan none"><span class="tile fam-tile">${I.cal}</span><span class="rbody"><span class="rtitle">Nothing planned yet</span><span class="rmeta"><span class="ell">A day out, a festival, something at home</span></span></span><button class="btn sm" data-act="fam-plan-add">Add</button></div>`;
  return list.map((p) => `<div class="row fam-plan"><span class="tile fam-tile">${/shop/i.test(p.title) ? IC.shop : /paint/i.test(p.title) ? IC.paint : /dinner|anniv/i.test(p.title) ? IC.rings : I.cal}</span>
      <span class="rbody"><span class="rtitle wrap">${esc(p.title)}</span><span class="rmeta">${avs(p.people ?? [])}<span class="ell">${esc(p.meta ?? [p.date ? fmtDay(p.date) : 'No date yet', p.slot, p.state === 'tentative' ? 'pencilled in' : p.by === 'wyn' ? `${AGENT.name} suggests` : null].filter(Boolean).join(' · '))}</span></span></span>
      <button class="btn sm" data-act="fam-plan-done" data-id="${p.id}">${p.state === 'idea' ? 'Plan' : 'Done'}</button></div>`).join('')
    + `<button class="row fam-plan-addr" data-act="fam-plan-add"><span class="tile fam-tile">${I.plus}</span><span class="rbody"><span class="rtitle">Add a plan</span></span></button>`;
}
function giftsHtml(only = null) {
  const ids = only ? [only] : homeIds();
  if (!ids.length) return '';
  return ids.map((id) => {
    const list = gifts(id);
    return list.length
      ? list.map((g) => `<div class="row fam-gift"><span class="tile fam-tile">${IC.gift}</span><span class="rbody"><span class="rtitle">${esc(g.title)}</span><span class="rmeta">${av(id, 'xs')}<span class="ell">For ${esc(personOf(id).name)}${g.from ? ` · ${esc(g.from)}` : ''}</span></span></span></div>`).join('')
      : `<div class="row fam-gift none"><span class="tile fam-tile">${IC.gift}</span><span class="rbody"><span class="rtitle">${only ? 'Gift ideas' : `For ${esc(personOf(id).name)}: nothing yet`}</span><span class="rmeta"><span class="ell">${only ? 'None yet. ' : ''}${esc(AGENT.name)} adds one when ${pron(id)[0]} mentions something</span></span></span></div>`;
  }).join('');
}
function renderDates(el, app) {
  const all = sortedDates();
  const nx = all.find((d) => d.iso);
  const sub = nx ? `Next: ${nx.title.charAt(0).toLowerCase()}${nx.title.slice(1)}, ${inDays(daysFrom(nx.iso))}` : 'Birthdays, their anniversary and festivals';
  el.innerHTML = `${aspHead(app, { title: 'Dates', sub: esc(sub) })}
    <div data-fb="25">${the25Html()}</div>
    <div data-fb="wq">${weddingAskHtml()}</div>
    <div class="sh"><h2>Coming up</h2><button class="sh-act" data-act="fam-date-add" data-id="new">${I.plus}Add</button></div><div class="group fam-dg" data-fb="dlist">${all.map((d) => dateRow(d)).join('') || `<div class="row"><span class="rbody"><span class="rtitle">No dates yet</span></span></div>`}</div>
    <div class="sh"><h2>Plans</h2></div><div class="group fam-plans" data-fb="plans">${plansHtml()}</div>
    <div class="sh"><h2>Gift ideas</h2><button class="sh-act" data-act="fam-idea-add" data-k="gift">${I.plus}Add</button></div><div class="group fam-gifts" data-fb="gifts">${giftsHtml()}</div>`;
}

// ── person pages: everyone in Family ─────────────────────────────────
const QS = (p) => [`What has ${p.name} talked about this month?`, `Ideas for ${p.name}'s birthday`, `How can I help ${p.name} most this week?`];
function rhythmRow(id, r) {
  let marks, status, labels;
  if (r.dinner || r.every <= 2) {
    const wk = week();
    marks = wk.map((d) => {
      const off = daysFrom(d), ok = kept().some((m) => m.date === d && (m.dinner || m.kind === 'meal') && m.people.includes(id));
      return ok ? 'ok' : off > 0 ? 'fut' : off === 0 ? 'next' : 'miss';
    });
    labels = wk.map((d) => fmtDay(d, { weekday: 'short' }));
    status = `${r.label} · ${dinnersThisWeek(id)} this week`;
  } else {
    // the last four weeks: together in each one that the rhythm counts, or not
    const w0 = P.mondayOf(today());
    const weeks = [-3, -2, -1, 0].map((k) => P.addDays(w0, 7 * k));
    marks = weeks.map((mon) => {
      const end = P.addDays(mon, 6), cur = mon === w0;
      const ok = P.moments({ person: id, from: mon, to: end }).some((m) => P.counts(m, r));
      return ok ? 'ok' : cur ? 'next' : 'miss';
    });
    labels = weeks.map((mon) => (mon === w0 ? 'This week' : `w/c ${fmtDay(mon, { day: 'numeric', month: 'short' })}`));
    const w = P.warmth(id, r);
    status = `${r.label} · ${w.last ? `last on ${fmtDay(w.last.date, { day: 'numeric', month: 'short' })}` : 'not logged yet'}`;
  }
  const said = marks.map((k, i) => `${labels[i]} ${{ ok: 'together', miss: 'missed', next: 'next', fut: 'to come' }[k]}`).join(', ');
  return `<div class="row fam-rh"><span class="rbody"><span class="rtitle">${esc(r.title)}</span><span class="rmeta"><span class="ell">${esc(status)}${r.source === 'default' ? ' · a default' : ''}</span></span></span>
    <span class="fam-marks${r.dinner || r.every <= 2 ? ' wk' : ''}" role="img" aria-label="${esc(said)}">${marks.map((k) => `<i class="${k}"></i>`).join('')}</span></div>`;
}
function nextRows(id) {
  const rows = [];
  for (const p of P.plansFor({ person: id, open: true }).slice(0, 2)) rows.push(`<div class="row fam-date">${p.date ? leaf(p.date) : `<span class="fam-leaf none" aria-hidden="true">${I.cal}</span>`}
      <span class="rbody"><span class="rtitle">${esc(p.title)}</span><span class="rmeta"><span class="ell">${esc([p.date ? fmtDay(p.date, { weekday: 'long' }) : 'No date yet', p.slot, p.by === 'wyn' ? `${AGENT.name} suggests` : null].filter(Boolean).join(' · '))}</span></span></span></div>`);
  for (const d of sortedDates().filter((x) => x.who.includes(id)).slice(0, 3)) rows.push(dateRow(d, d.kind === 'birthday' && d.who.length === 1 ? 'Birthday' : null));
  return rows.join('') + giftsHtml(id);
}
function workHtml(id) {
  const rows = workFor(id);
  if (!rows.length) return '';
  const ic = { 'fam-ev': IC.shop, 'fam-task': I.work, 'fam-money': I.rupee };
  return `<div class="sh"><h2>${id === 'dad' ? 'The shop' : 'Also in Work'}</h2></div>
    <div class="group fam-shop">${rows.map((x) => `<button class="row" data-act="${x.act}" data-id="${x.id ?? ''}"><span class="tile fam-tile${x.done ? ' is-done' : ''}">${x.done ? I.check : ic[x.act]}</span>
      <span class="rbody"><span class="rtitle">${esc(x.title)}</span><span class="rmeta"><span class="ell">${esc(x.meta)}</span></span></span>${I.chevR}</button>`).join('')}</div>
    ${alsoIn([['jobs', 'Work', 'fam-work'], ['money', 'Money', 'fam-money']], 'Lives in', 'It shows here too, so you see all of it.')}`;
}
function personHtml(id) {
  const p = P.person(id);
  if (!p) return '<p class="note surface">This person isn\'t in Family any more.</p>';
  const mine = shown().filter((m) => m.people.includes(id));
  const min = weekMinutes(id), din = dinnersThisWeek(id);
  const rs = rhythmsOf(id), rem = remember(id);
  return `<header class="fam-ph">
      ${ring(min / weekGoal(), 'as', 118, 6, { cls: 'fam-ph-rg', label: `${fmtDur(min)} together this week, of ${fmtDur(weekGoal())}`, inner: av(id, 'lg') })}
      <h1 class="lt">${esc(p.name)}</h1>
      <p class="sub">${esc(p.role ?? 'Family')}</p>
      <p class="fam-ph-last">Last together · <b>${esc(lastTogether(id))}</b></p>
    </header>
    <div class="fam-acts">${actsHtml(id)}</div>
    <div class="fam-stats surface">
      <span><b class="met">${rollHTML(min, { format: (v) => fmtDur(Math.round(v)) })}</b><small>together this week</small></span>
      <span><b class="met">${rollHTML(din, { format: 'plain' })}</b><small>${din === 1 ? 'dinner' : 'dinners'}</small></span>
      <span><b class="met">${rollHTML(mine.length, { format: 'plain' })}</b><small>${mine.length === 1 ? 'moment' : 'moments'}</small></span>
    </div>
    <div class="sh"><h2>Keep warm</h2><button class="sh-act" data-act="fam-rhythm" data-id="${id}">${rs.length ? 'Change' : `${I.plus}Add`}</button></div>
    ${rs.length ? `<div class="group fam-warm">${rs.map((r) => rhythmRow(id, r)).join('')}</div>` : `<p class="note surface fam-empty">How often do you want time with ${esc(p.name)}? Set a rhythm and ${esc(AGENT.name)} tells you when it slips.</p>`}
    <div class="sh"><h2>Moments</h2>${mine.length ? `<button class="sh-act" data-act="fam-see" data-who="${id}">See all${I.chevR}</button>` : ''}</div>
    ${mine.length ? `<div class="fam-mos">${mine.slice(0, 2).map((m) => momentCard(m, { compact: true })).join('')}</div>` : `<p class="note surface fam-empty">Nothing yet. Tell ${esc(AGENT.name)} when you see or call ${esc(p.name)}, and the moments fill in from there.</p>`}
    <div class="sh"><h2>Remember</h2><button class="sh-act" data-act="fam-brain" data-id="${id}">Brain file${I.chevR}</button></div>
    ${rem.length ? `<div class="group fam-rem">${rem.map((r) => `<div class="row"><span class="fam-rem-d" aria-hidden="true"></span><span class="rbody"><span class="rtitle wrap">${esc(r.text)}</span><span class="rmeta">${esc(r.from ?? '')}</span></span></div>`).join('')}</div>`
      : `<p class="note surface fam-empty">What ${esc(p.name)} mentions (what ${pron(id)[0]} needs, what's on ${pron(id)[2]} mind) lands here and in ${pron(id)[2]} Brain file.</p>`}
    ${workHtml(id)}
    <div class="sh"><h2>Next</h2></div>
    <div class="group fam-next">${nextRows(id)}</div>
    <div class="sh"><h2>Ask ${esc(AGENT.name)} about ${esc(p.name)}</h2></div>
    <div class="pad fam-qs">${QS(p).map((q) => `<button class="chip" data-act="fam-ask" data-about="${id}" data-q="${esc(q)}">${I.sparkle}${esc(q)}</button>`).join('')}</div>`;
}
const actsHtml = (id) => `
  <button class="fam-act" data-act="fam-log" data-person="${id}">${I.plus}<span>Moment</span></button>
  <button class="fam-act" data-act="fam-together" data-person="${id}" aria-label="${esc(`Together now, with ${pron(id)[1]}`)}">${I.home}<span>Together</span></button>
  <button class="fam-act" data-act="fam-brain" data-id="${id}">${I.brain}<span>Brain file</span></button>
  <button class="fam-act" data-act="fam-ask" data-about="${id}">${I.sparkle}<span>Ask ${esc(AGENT.name)}</span></button>`;
const backLabel = () => $('#stack')?.lastElementChild?._opts?.title ?? 'Back';
function openPersonPage(id, back) {
  const p = P.person(id);
  if (!p) return null;
  const pg = push({
    title: p.name, back: back ?? backLabel(), aspect: 'family', cls: 'fam-pp',
    right: `<button class="gbtn chrome icon" data-act="fam-ask" data-about="${id}" aria-label="${esc(`Ask ${AGENT.name} about ${p.name}`)}">${I.sparkle}</button>`,
    render(sc) { sc.innerHTML = personHtml(id); stagger($$('.fam-stats, .fam-warm, .fam-mo', sc), { y: 10, each: 45, delay: 140 }); },
    onPop() { PAGES.delete(pg); },
  });
  pg._famPerson = id;
  PAGES.add(pg);
  return pg;
}

// ── keeping every open view true after a change ──────────────────────
const repaint = (root, name, html) => { const b = root && $(`[data-fb="${name}"]`, root); if (b) b.innerHTML = html; };
const appLive = () => APP?.page?.isConnected;
const togetherOnTop = () => appLive() && APP.section === 'together' && $('#stack')?.lastElementChild === APP.page;
function tweenDur(el, from, to, ms = 720) {
  if (!el) return;
  el.dataset.v = to;
  if (reduced() || from === to) { el.textContent = fmtDur(to); return; }
  const t0 = performance.now();
  const step = (now) => { const k = Math.min(1, (now - t0) / ms), e = 1 - (1 - k) ** 3; el.textContent = fmtDur(Math.round(from + (to - from) * e)); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// before = { day, week, streak } as they were; the hero moves from there
function afterChange(before = null) {
  const tg = appLive() && APP.el('together');
  if (tg?.dataset.built && before && togetherOnTop() && $('#famRingToday', tg)) {
    setRing($('#famRingToday', tg), minutesOn(today()) / dayGoal());
    tweenDur($('[data-fam-week]', tg), before.week, weekMinutes());
    const n = streak(); const sn = $('[data-fam-streak]', tg);
    if (sn && n !== before.streak) { roll(sn, n, { format: 'plain' }); haptic(12); }
    repaint(tg, 'tonight', tonightHtml());
    ['people', 'wyn', 'showup', 'latest', 'coming'].forEach((b) => repaint(tg, b, { people: peopleHtml, wyn: wynHtml, showup: showupHtml, latest: latestHtml, coming: comingHtml }[b]()));
    const fresh = S.fresh && $(`.fam-mo[data-id="${S.fresh}"]`, tg); if (fresh) stagger([fresh], { y: 14, scale: 0.98 });
  } else if (tg?.dataset.built) {
    repaint(tg, 'hero', heroHtml());
    repaint(tg, 'people', peopleHtml()); repaint(tg, 'wyn', wynHtml()); repaint(tg, 'showup', showupHtml());
    repaint(tg, 'latest', latestHtml()); repaint(tg, 'coming', comingHtml());
  }
  if (appLive()) {
    const mo = APP.el('moments'); if (mo?.dataset.built) { const y = APP.section === 'moments' ? APP.scroll.scrollTop : 0; mo.innerHTML = ''; renderMoments(mo, APP); wireSegs(mo); if (y) APP.scroll.scrollTop = y; }
    const da = APP.el('dates'); if (da?.dataset.built) { da.innerHTML = ''; renderDates(da, APP); }
  }
  PAGES.forEach((pg) => { if (!pg.isConnected) { PAGES.delete(pg); return; } const sc = $('.scroll', pg); const y = sc.scrollTop; sc.innerHTML = personHtml(pg._famPerson); wireSegs(sc); sc.scrollTop = y; });
  requestAnimationFrame(() => { S.fresh = null; });
}
const snapshot = () => ({ day: minutesOn(today()), week: weekMinutes(), streak: streak() });
// every change to people data (his, the agent's from another device, the PC's) redraws what's open
P.onPeople(({ kinds }) => {
  if (![...kinds].some((k) => ['persons', 'moments', 'plans', 'ideas', 'rhythms', 'dates', 'state', 'calendar'].includes(k))) return;
  const b = BEFORE; BEFORE = null;
  syncTick();
  afterChange(b);
});

// ── filing a moment (the log sheet, a together session, a scanned chat, or the agent on the bus) ──
function addMoment(m) {
  BEFORE = snapshot();
  const doc = P.logMoment({ aspect: 'family', people: m.people?.length ? m.people : everyone(), kind: m.kind === 'call' ? 'call' : m.kind === 'chat' ? 'chat' : 'meet',
    act: ['call', 'chat'].includes(m.kind) ? null : m.kind ?? 'meal', minutes: m.min ?? 0, date: m.date, at: m.at, title: m.title, text: m.text || undefined,
    said: m.said, dinner: m.dinner || undefined, chat: m.chat ?? undefined, by: m.by ?? 'you', source: m.from ?? (m.by === 'wyn' ? 'said' : 'you') });
  S.fresh = doc.id;
  return momentById(doc.id);
}
// undo a filing: the hero moves back from where it is now
function unfile(id) { BEFORE = snapshot(); P.remove('moments', id); }

// ── the log sheet: the app's primary action ──────────────────────────
function chipsMulti(ids, on1) {
  return `<div class="chips fam-who">${ids.map((id) => `<button class="chip${on1.includes(id) ? ' on' : ''}" data-act="fam-chipm" data-v="${id}" aria-pressed="${on1.includes(id)}">${av(id, 'xs')}${esc(personOf(id).name)}</button>`).join('')}</div>`;
}
function chipsOne(key, items, on1) {
  return `<div class="chips" data-k="${key}">${items.map(([v, label, icon]) => `<button class="chip${String(on1) === String(v) ? ' on' : ''}" data-act="fam-chip" data-v="${v}" aria-pressed="${String(on1) === String(v)}">${icon ?? ''}${esc(label)}</button>`).join('')}</div>`;
}
const picked = (sh, key) => $(`[data-k="${key}"] .chip.on`, sh)?.dataset.v;
function logSheet(prefill = {}) {
  if (!homeIds().length) { addPersonSheet(); return null; }
  const who = toArr(prefill.person) ?? everyone();
  const el = asSheet(openSheet({
    title: 'Log a moment', sub: `${esc(AGENT.name)} files most of these herself. Add one she missed.`, large: true,
    body: `
      <button class="fam-nowrow" data-act="fam-together" data-person="${who.join(',')}">${I.home}<span class="rbody"><b>With them right now?</b><small>Start a together session. It counts toward today's hour and ${esc(AGENT.name)} files it when you're done.</small></span>${I.chevR}</button>
      <div class="fam-f"><p class="fam-fl">With</p>${chipsMulti(homeIds(), who)}</div>
      <div class="fam-f"><label class="fam-ta"><span class="vh">What happened?</span><textarea rows="3" placeholder="Chai after the shop closed…">${esc(prefill.text ?? '')}</textarea></label></div>
      <div class="fam-f"><p class="fam-fl">What kind</p>${chipsOne('kind', KINDS.map(([v, l]) => [v, l, kindIcon(v)]), prefill.kind ?? 'meal')}</div>
      <div class="fam-f"><p class="fam-fl">When</p>${seg('famWhen', [['now', 'Just now'], ['today', 'Earlier today'], ['yday', 'Yesterday']], 'now')}</div>
      <div class="fam-f"><p class="fam-fl">How long</p>${chipsOne('min', [[15, '15m'], [30, '30m'], [60, '1h'], [120, '2h']], prefill.min ?? 30)}</div>
      <div class="fam-f"><label class="fam-dinner-q"><input type="checkbox" data-k="dinner"${prefill.dinner ? ' checked' : ''}> <span>It was dinner together</span></label></div>
      <div class="fam-f"><button class="row fam-voice" data-act="fam-voice">${I.mic}<span class="rbody"><span class="rtitle">Say it instead</span><span class="rmeta">${esc(AGENT.name)} writes it up and files it</span></span>${I.chevR}</button></div>
      <div class="pad fam-save"><button class="btn primary block" style="--c:var(--as-fill)" data-act="fam-log-save">Save moment</button></div>`,
  }));
  return el;
}
on('fam-chip', (el) => { $$('.chip', el.parentElement).forEach((c) => { c.classList.toggle('on', c === el); c.setAttribute('aria-pressed', String(c === el)); }); haptic(5); });
on('fam-chipm', (el) => {
  const box = el.parentElement, on1 = $$('.chip.on', box);
  if (el.classList.contains('on') && on1.length === 1) { haptic(16); return; }   // someone has to be there
  el.classList.toggle('on'); el.setAttribute('aria-pressed', String(el.classList.contains('on'))); haptic(5);
});
on('fam-log', (el) => logSheet({ person: el.dataset.person ? [el.dataset.person] : undefined }));
on('fam-log-save', (el) => {
  const sh = el.closest('.sheet');
  const who = $$('.fam-who .chip.on', sh).map((c) => c.dataset.v);
  const text = $('textarea', sh).value.trim();
  const kind = picked(sh, 'kind') ?? 'meal', min = Number(picked(sh, 'min') ?? 30);
  const when = $('[data-seg="famWhen"] button[aria-selected="true"]', sh)?.dataset.v ?? 'now';
  const date = when === 'yday' ? P.addDays(today(), -1) : today();
  const nowM = NOWM();
  const at = when === 'now' ? hm(Math.max(0, nowM - min)) : when === 'today' ? hm(Math.max(0, Math.min(nowM, 15 * 60 + 30) - min)) : '20:00';
  const label = KINDS.find(([v]) => v === kind)?.[1] ?? 'Time';
  const title = text ? text.split(/(?<=[.!?])\s/)[0].slice(0, 70) : `${label} with ${withNames(who)}`;
  const rest = text && text.length > title.length ? text.slice(title.length).trim() : '';
  const dinner = !!$('[data-k="dinner"]', sh)?.checked || (kind === 'meal' && /\bdinner\b/i.test(text));
  closeSheet(sh);
  const m = addMoment({ date, at, min, people: who, kind, title, text: rest, dinner, by: 'you', from: 'you' });
  toast('Filed under Moments', () => unfile(m.id));
});
on('fam-voice', () => { closeSheet(); api.openCapture('voice', { aspect: 'family' }); });

// ── together now: his "I'm sitting with family", as a mode (a synced state doc, so the agent can start it too) ──
function tick() {
  const ses = session();
  if (!ses) { clearInterval(TICK); TICK = null; return; }
  const sec = Math.max(0, Math.floor((Date.now() - ses.start) / 1000));
  $$('[data-fam-tick]').forEach((e) => { e.textContent = clockLabel(sec); });
  const todayMin = minutesOn(today()) + sec / 60, goal = dayGoal();
  const r = $('#famTgRing'); if (r) setRing(r, todayMin / goal, { bleed: false });
  $$('[data-fam-today]').forEach((e) => { e.textContent = todayMin >= goal ? `Today's ring is closed · ${fmtDur(Math.floor(todayMin))} together` : `Today: ${fmtDur(Math.floor(todayMin))} of an hour together`; });
  if (!tick.closed && todayMin >= goal) { tick.closed = true; haptic(14); }
}
const syncTick = () => { if (session() && !TICK) { TICK = setInterval(tick, 1000); tick(); } else if (!session() && TICK) { clearInterval(TICK); TICK = null; } };
function startTogether({ people, startedAgo = 0 } = {}) {
  if (session()) { openSessionPage(); return session(); }
  const who = (toArr(people) ?? everyone()).filter((id) => P.person(id));
  if (!who.length) { addPersonSheet(); return null; }
  const start = Date.now() - startedAgo * 60000;
  tick.closed = false;
  P.setState('session:family', { active: true, start: new Date(start).toISOString(), people: who, at: hm(Math.max(0, NOWM() - Math.round(startedAgo))), by: 'you' });
  syncTick();
  openSessionPage();
  return session();
}
function openSessionPage() {
  const ses = session(); if (!ses) return;
  const top = $('#stack')?.lastElementChild;
  if (top?.classList.contains('fam-tg-pg')) return;
  const sec = Math.floor((Date.now() - ses.start) / 1000), todayMin = minutesOn(today()) + sec / 60;
  push({
    title: 'Together', back: backLabel(), aspect: 'family', cls: 'fam-tg-pg',
    render(sc) {
      sc.innerHTML = `<div class="fam-tg">
        <p class="fam-tg-k">${avs(ses.people, 'sm')}<span>With ${esc(withNames(ses.people))}</span></p>
        <div class="fam-tg-ring">${ring(todayMin / dayGoal(), 'as', 232, 16, { id: 'famTgRing', label: 'Today\'s hour together', inner: `<span class="fam-tg-c"><b class="met" data-fam-tick>${clockLabel(sec)}</b><small>together</small></span>` })}</div>
        <p class="fam-tg-today" data-fam-today>Today: ${fmtDur(Math.floor(todayMin))} of an hour together</p>
        <p class="fam-tg-since">Since ${esc(ses.at)}</p>
      </div>
      <div class="group fam-tg-g">
        <div class="row"><span class="tile fam-tile">${I.moon}</span><span class="rbody"><span class="rtitle">Put the phone down</span><span class="rmeta">${DEMO_MODE ? `${esc(AGENT.name)} holds notifications till you're back · 2 held` : 'It keeps time without you; a Focus keeps the rest quiet'}</span></span></div>
        <div class="row"><span class="tile fam-tile">${I.sparkle}</span><span class="rbody"><span class="rtitle">She files it when you're done</span><span class="rmeta">Add a line about it if you like</span></span></div>
      </div>
      <div class="pad fam-tg-end">
        <button class="btn primary block" style="--c:var(--as-fill)" data-act="fam-tog-end">End and file</button>
        <button class="btn block" data-act="pop">Keep it running</button>
      </div>`;
    },
  });
}
function fileSheet(ses, min) {
  asSheet(openSheet({
    title: `${fmtDur(min)} with ${esc(withNames(ses.people))}`, sub: 'Add a line, or just file it.',
    body: `
      <div class="fam-f"><p class="fam-fl">What was it</p>${chipsOne('kind', KINDS.map(([v, l]) => [v, l, kindIcon(v)]), NOWM() >= 19 * 60 ? 'meal' : 'talk')}</div>
      <div class="fam-f"><label class="fam-ta"><span class="vh">A line about it</span><textarea rows="2" placeholder="What did you talk about?"></textarea></label></div>
      <div class="pad fam-save"><button class="btn primary block" style="--c:var(--as-fill)" data-act="fam-file-save" data-min="${min}" data-at="${esc(ses.at)}" data-date="${P.addDays(today(), 0)}" data-who="${ses.people.join(',')}">File it</button></div>`,
  }));
}
on('fam-together', (el) => { const p = el.dataset.person; if (el.closest('.sheet')) closeSheet(el.closest('.sheet')); startTogether({ people: p ? p.split(',') : undefined }); });
on('fam-tog-open', () => openSessionPage());
on('fam-tog-end', () => {
  const ses = session(); if (!ses) return;
  const min = Math.max(1, Math.round((Date.now() - ses.start) / 60000));
  P.setState('session:family', { active: false, end: new Date().toISOString() });
  syncTick();
  if ($('#stack')?.lastElementChild?.classList.contains('fam-tg-pg')) pop();
  setTimeout(() => fileSheet(ses, min), 260);
});
on('fam-file-save', (el) => {
  const sh = el.closest('.sheet'), who = el.dataset.who.split(','), min = Number(el.dataset.min);
  const kind = picked(sh, 'kind') ?? 'talk', text = $('textarea', sh).value.trim();
  closeSheet(sh);
  const m = addMoment({ min, people: who, kind, at: el.dataset.at, date: el.dataset.date, title: text || `Together with ${withNames(who)}`, by: 'wyn', from: 'session', dinner: kind === 'meal' && NOWM() >= 19 * 60 ? true : undefined });
  toast(`Filed: ${fmtDur(min)} together`, () => unfile(m.id));
});

// ── tonight's dinner: the calendar block that closes today's ring ────
function dinnerSheet() {
  const done = kept().find((x) => x.date === today() && x.dinner);
  if (done) return momentSheet(done.id);
  const D = tonight();
  if (!D) { toast('No family dinner on today’s calendar'); return; }
  const so = minutesOn(today());
  asSheet(openSheet({
    title: D.title, sub: `Tonight ${hm(D.start)} to ${hm(D.end)}${D.start > NOWM() ? ` · in ${fmtDur(D.start - NOWM())}` : ''} · from your calendar`,
    body: `<div class="group fam-dn-g">
        <div class="row"><span class="tile fam-tile">${I.home}</span><span class="rbody"><span class="rtitle">Start a together session at ${hm(D.start)}</span><span class="rmeta">Or tap “I'm with family now” when you sit down</span></span></div>
        <div class="row"><span class="tile fam-tile">${I.flame}</span><span class="rbody"><span class="rtitle">Makes it ${streak() + 1} ${streak() + 1 === 1 ? 'dinner' : 'dinners'} in a row</span><span class="rmeta">${so >= dayGoal() ? 'Today\'s ring is already closed' : `And fills today's ring: ${fmtDur(so)} so far`}</span></span></div>
      </div>
      <div class="pad fam-save fam-dn-acts">
        <button class="btn primary block" style="--c:var(--as-fill)" data-act="fam-dinner-done">We had dinner together</button>
        <button class="btn block" data-act="fam-dinner-cal" data-id="${esc(D.id)}">Open in calendar</button>
      </div>`,
  }));
}
on('fam-dinner', () => dinnerSheet());
on('fam-dinner-done', (el) => {
  closeSheet(el.closest('.sheet'));
  const D = tonight(); if (!D) return;
  const m = addMoment({ min: Math.max(0, D.end - D.start), people: everyone(), kind: 'meal', dinner: true, at: hm(D.start), title: 'Dinner at home', by: 'you', from: 'you' });
  toast('Dinner filed', () => unfile(m.id));
});
on('fam-dinner-cal', (el) => { closeSheet(el.closest('.sheet')); api.openEvent(el.dataset.id); });

// ── the moment sheet ─────────────────────────────────────────────────
function momentSheet(id) {
  const m = momentById(id); if (!m) return;
  const brain = m.people.length > 1 ? 'their Brain files' : `${personOf(m.people[0]).name}'s Brain file`;
  asSheet(openSheet({
    head: `<div class="sheet-head fam-ms-h">${avs(m.people, 'sm')}<div class="sh-text"><h3>${esc(m.title)}</h3><p>${esc([relDay(m.date), m.at, m.min ? fmtDur(m.min) : null].filter(Boolean).join(' · '))}</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: `
      ${m.text ? `<p class="fam-ms-x">${esc(m.text)}</p>` : ''}
      ${m.said ? `<div class="fam-ms-in">${saidHtml(m, true)}</div>` : ''}
      ${m.chat ? `<div class="fam-ms-in">${chatHtml(m)}</div>` : ''}
      <div class="group fam-ms-g">
        <div class="row"><span class="tile">${m.by === 'wyn' ? I.sparkle : I.user}</span><span class="rbody"><span class="rtitle">${m.by === 'wyn' ? `${esc(AGENT.name)} filed this` : 'You logged this'}</span><span class="rmeta">${esc(m.by === 'wyn' ? `${SOURCE[m.from] ?? ''}`.replace(/^from/, 'From') : 'From the Family app')}</span></span></div>
        <div class="row"><span class="tile">${I.people}</span><span class="rbody"><span class="rtitle">${esc(withNames(m.people))}</span><span class="rmeta">Also in ${esc(brain)}</span></span></div>
        <div class="row"><span class="tile">${I.clock}</span><span class="rbody"><span class="rtitle">${m.min ? `${fmtDur(m.min)} toward ${esc(relDay(m.date).toLowerCase() === 'today' ? 'today' : fmtDay(m.date, { weekday: 'long' }))}'s ring` : 'Not counted as time together'}</span><span class="rmeta">${m.min ? 'An hour a day closes the ring' : 'A chat keeps them close; the ring counts time in person'}</span></span></div>
      </div>
      <div class="fam-ms-acts">
        <button class="btn" data-act="fam-brain" data-id="${m.people[0]}">${I.brain}Brain</button>
        <button class="btn" data-act="fam-ask" data-about="${m.people[0]}" data-q="${esc(`About “${m.title}”`)}">${I.sparkle}Ask</button>
        <button class="btn" data-act="fam-let" data-id="${m.id}">${I.trash}Let go</button>
      </div>`,
  }));
}
on('fam-moment', (el) => momentSheet(el.dataset.id));
on('fam-let', (el) => {
  const id = el.dataset.id;
  closeSheet(el.closest('.sheet'));
  BEFORE = snapshot(); P.update('moments', id, { let_go: true });
  toast(`Let go. What it taught ${AGENT.name} stays in the Brain`, () => { BEFORE = snapshot(); P.update('moments', id, { let_go: false }); });
});

// ── the day behind a ring ────────────────────────────────────────────
const momentRow = (m) => `<button class="row fam-mrow" data-act="fam-moment" data-id="${m.id}"><span class="tile fam-tile">${kindIcon(m.kind)}</span>
  <span class="rbody"><span class="rtitle">${esc(m.title)}</span><span class="rmeta"><span class="ell">${esc([m.at, m.min ? fmtDur(m.min) : 'a chat', m.by === 'wyn' ? `filed by ${AGENT.name}` : 'you logged it'].join(' · '))}</span></span></span>${I.chevR}</button>`;
on('fam-day', (el) => {
  const iso = el.dataset.d, off = daysFrom(iso), min = minutesOn(iso), goal = dayGoal();
  const list = shown().filter((m) => m.date === iso);
  const plansOn = planned(iso);
  const sub = off > 0 ? (plansOn.length ? 'Coming up' : 'Nothing planned yet')
    : `${min >= goal ? 'Ring closed' : `${fmtDur(goal - min)} short of the ring`} · ${list.length} ${list.length === 1 ? 'moment' : 'moments'}`;
  const planRows = plansOn.map((p) => `<div class="row fam-mrow"><span class="tile fam-tile">${IC[p.icon] ?? I.cal}</span><span class="rbody"><span class="rtitle">${esc(p.text)}</span><span class="rmeta">${esc(p.at)}${p.by === 'wyn' ? ` · ${esc(AGENT.name)} suggests` : p.cal ? ' · in your calendar' : ''}</span></span></div>`).join('');
  asSheet(openSheet({
    title: fmtDay(iso, { weekday: 'long', day: 'numeric', month: 'long' }), sub,
    body: `${off <= 0 ? `<div class="fam-dsum">${ring(min / goal, 'as', 56, 7)}<span><b class="met">${fmtDur(min)}</b><small>of an hour</small></span></div>` : ''}
      ${list.length ? `<div class="group">${list.map(momentRow).join('')}</div>` : ''}
      ${plansOn.length ? `<div class="sh fam-sh-in"><h2>${off > 0 ? 'Planned' : 'Still to come'}</h2></div><div class="group">${planRows}</div>` : ''}
      ${!list.length && !plansOn.length ? `<p class="note">Nothing yet. Tell ${esc(AGENT.name)} when you're with them, or plan something for this day.</p>` : ''}`,
  }));
});

// ── the streak: a month of dinners together ──────────────────────────
on('fam-streak', () => {
  const t = today(), n = streak(), { set, best } = dinnerMonth(t);
  const first = `${t.slice(0, 7)}-01`, len = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0)).getUTCDate();
  const pad = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7, dToday = Number(t.slice(8));   // weeks start on Monday
  const okDay = (d) => d <= dToday && set.has(d);
  const cells = [...Array(pad).fill('<i class="pad"></i>'), ...Array.from({ length: len }, (_, i) => {
    const d = i + 1, k = d > dToday ? 'fut' : set.has(d) ? 'ok' : d === dToday ? 'next' : 'miss';
    const run = k === 'ok' && okDay(d + 1) && (pad + d - 1) % 7 !== 6;   // joined to tomorrow, within the week's row
    return `<i class="${k}${run ? ' run' : ''}"><span>${d}</span></i>`;
  })].join('');
  const toBest = best + 1 - n;
  const D = tonight();
  asSheet(openSheet({
    title: `${n} ${n === 1 ? 'dinner' : 'dinners'} in a row`, sub: dinnerOn(t) ? 'Tonight\'s dinner is in.' : D ? `Tonight at ${hm(D.start)} makes it ${n + 1}.` : 'Log tonight\'s dinner to keep it going.',
    body: `<div class="fam-cal-w"><div class="fam-cal-h">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span>${d}</span>`).join('')}</div><div class="fam-cal" role="img" aria-label="${esc(fmtDay(t, { month: 'long' }))}, dinners together">${cells}</div></div>
      <div class="group fam-st-g">
        <div class="row"><span class="tile fam-tile">${I.flame}</span><span class="rbody"><span class="rtitle">Best this month: ${best} in a row</span><span class="rmeta">${best === 0 ? 'No dinners logged yet this month' : toBest > 0 ? `${toBest} more ${toBest === 1 ? 'dinner' : 'dinners'} to beat it` : 'You\'re past it'}</span></span></div>
      </div>
      <p class="hint">${esc(AGENT.name)} counts a dinner from your calendar, a together session, or what you tell her.</p>`,
  }));
});

// ── the agent's asks (demo), showing up ──────────────────────────────
on('fam-ask-yes', () => { demoAsk.shop = 'yes'; haptic(10); afterChange(); toast('Saturday 11:00 to 15:00 blocked for the shop', () => { demoAsk.shop = null; afterChange(); }); });
on('fam-ask-no', () => { demoAsk.shop = 'no'; afterChange(); toast(`Okay. ${AGENT.name} asks again before the 31st`, () => { demoAsk.shop = null; afterChange(); }); });
on('fam-su-check', (el) => {
  const id = el.dataset.id, x = P.col.ideas.get(id); if (!x) return;
  if (el.closest('.sheet')) closeSheet(el.closest('.sheet'));
  const was = !!x.done;
  if (!was) { el.classList.add('closing', 'done'); symbol(el, 'draw'); }
  haptic(was ? 5 : 12);
  setTimeout(() => P.update('ideas', id, { done: !was, done_at: was ? null : new Date().toISOString() }), was ? 0 : 420);
  if (!was) toast(`Done. ${AGENT.name} noted it for Sunday's look back`, () => P.update('ideas', id, { done: false }));
});
function showupSheet(id) {
  const x = P.col.ideas.get(id); if (!x) return;
  const who = x.with ?? [x.person];
  asSheet(openSheet({
    head: `<div class="sheet-head fam-ms-h">${avs(who, 'sm')}<div class="sh-text"><h3>${esc(x.title)}</h3><p>${esc(x.meta ?? (x.by === 'wyn' ? `${AGENT.name} suggested it` : 'You added it'))}</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: `<div class="fam-ms-acts">
        <button class="btn" data-act="fam-su-check" data-id="${x.id}">${I.check}${x.done ? 'Not done' : 'Done'}</button>
        <button class="btn" data-act="fam-ask" data-about="${esc(x.person ?? '')}" data-q="${esc(`Help me with this: ${x.title}`)}">${I.sparkle}Ask ${esc(AGENT.name)}</button>
        <button class="btn" data-act="fam-su-drop" data-id="${x.id}">${I.trash}Remove</button>
      </div>`,
  }));
}
on('fam-su-open', (el) => { const x = P.col.ideas.get(el.dataset.id); if (!x) return; if (x.task) return api.openTask(x.task); showupSheet(x.id); });
on('fam-su-drop', (el) => { const x = P.col.ideas.get(el.dataset.id); closeSheet(el.closest('.sheet')); if (!x) return; P.remove('ideas', x.id); toast('Removed', () => P.restore('ideas', x)); });
// from Today: open the first open "showing up" item here (never an agent run on a tap)
on('fam-book', () => { const x = showups().find((s) => !s.done); if (!appLive()) openAspect('family'); if (x) setTimeout(() => showupSheet(x.id), 380); });

// ── dates, the 25th, plans, gifts ────────────────────────────────────
function dateSheet(id) {
  const all = dates();
  const d = all.find((x) => x.id === id);
  const isNew = id === 'new' || !d;
  const kind = d?.kind ?? 'other', isWed = kind === 'anniversary', isB = kind === 'birthday';
  const value = d?.doc ? (d.doc.date ?? (d.doc.year ? `${d.doc.year}-${d.doc.md}` : d.doc.md ? `${today().slice(0, 4)}-${d.doc.md}` : '')) : '';
  asSheet(openSheet({
    title: isNew ? 'A date to keep' : isWed ? 'Their wedding date' : d.title,
    sub: isWed ? `With the year, ${AGENT.name} counts down to the 25th.` : isB ? `${AGENT.name} reminds you before it comes round each year. Never guessed.` : `${AGENT.name} reminds you before it comes round.`,
    body: `${isNew ? `<div class="pad fam-f"><label class="field"><input type="text" data-k="title" maxlength="60" placeholder="What is it? A festival, a visit, a puja" aria-label="What the date is" autocomplete="off"></label></div>
        <div class="fam-f"><p class="fam-fl">For</p>${chipsMulti(homeIds(), homeIds())}</div>` : ''}
      <div class="pad fam-f"><label class="field fam-datef"><input type="date" aria-label="${esc(d?.title ?? 'Date')}" value="${esc(value)}"></label></div>
      ${isB || isWed ? `<div class="fam-f"><label class="fam-dinner-q"><input type="checkbox" data-k="noyear"${d?.doc && !d.doc.year ? ' checked' : ''}> <span>I don't know the year</span></label></div>` : ''}
      <div class="pad fam-save"><button class="btn primary block" style="--c:var(--as-fill)" data-act="fam-date-save" data-id="${esc(id)}">Save date</button></div>`,
  }));
}
on('fam-date-add', (el) => dateSheet(el.dataset.id));
on('fam-date-save', (el) => {
  const sh = el.closest('.sheet'), v = $('input[type="date"]', sh)?.value;
  if (!v) { haptic(18); toast('Pick a date first'); return; }
  const id = el.dataset.id, d = dates().find((x) => x.id === id);
  const noYear = !!$('[data-k="noyear"]', sh)?.checked;
  if (id === 'new' || !d) {
    const title = $('[data-k="title"]', sh)?.value.trim();
    if (!title) { haptic(18); toast('Say what the date is'); return; }
    const who = $$('.fam-who .chip.on', sh).map((c) => c.dataset.v);
    P.setDate({ kind: 'other', people: who, date: v, md: v.slice(5), title, aspect: 'family' });
  } else {
    const kind = d.kind, annual = kind === 'birthday' || kind === 'anniversary';
    P.setDate({ id: d.doc?.id ?? null, kind, people: d.who, md: v.slice(5), date: annual ? null : v, year: annual && !noYear ? Number(v.slice(0, 4)) : null, title: d.title, aspect: 'family' });
  }
  closeSheet(sh);
  toast(`Saved. ${AGENT.name} reminds you a week before`);
});
on('fam-date', (el) => {
  const d = dates().find((x) => x.id === el.dataset.id); if (!d) return;
  if (d.kind === 'festival') return api.openCalendar('month', d.iso);
  dateSheet(d.id);
});
on('fam-wed-yes', () => { P.setDate({ kind: 'anniversary', people: homeIds().slice(0, 2), md: '10-25', title: 'Wedding anniversary', aspect: 'family' }); toast('Kept: 25 October, every year'); });
on('fam-goal', () => api.openGoal('g10'));
on('fam-mission', () => api.openAspect('mission'));
on('fam-money', () => api.openAspect('money'));
on('fam-work', () => api.openWork());
on('fam-plan25', () => api.askAgent(`Help me plan ${withNames(homeIds().slice(0, 2))}'s 25th: the guest list, a venue and a budget`, { aspect: 'family' }));
on('fam-plan-done', (el) => {
  const p = P.col.plans.get(el.dataset.id); if (!p) return;
  if (p.state === 'idea') { P.update('plans', p.id, { state: 'tentative' }); toast('Pencilled in'); return; }
  P.update('plans', p.id, { state: 'done' }); haptic(10);
  toast('Done. Log how it went?', () => P.update('plans', p.id, { state: p.state }));
});
function ideaSheet(kind, who = null) {
  const ids = homeIds(); if (!ids.length) { addPersonSheet(); return; }
  const titles = { gift: ['A gift idea', 'Something they mentioned, or would love'], showup: ['Showing up', 'A small thing to do for them'], plan: ['A plan', 'Something to do together'] }[kind];
  asSheet(openSheet({
    title: titles[0], sub: titles[1],
    body: `<div class="pad fam-f"><label class="field"><input type="text" data-k="title" maxlength="80" placeholder="${kind === 'gift' ? 'A phone with a bigger screen' : kind === 'plan' ? 'A day out after Diwali' : 'Help at the shop on Saturday'}" aria-label="${esc(titles[0])}" autocomplete="off"></label></div>
      <div class="fam-f"><p class="fam-fl">For</p>${chipsOne('who', ids.map((id) => [id, personOf(id).name, av(id, 'xs')]), who ?? ids[0])}</div>
      ${kind === 'plan' ? `<div class="pad fam-f"><label class="field fam-datef"><input type="date" aria-label="When (optional)"></label></div>` : ''}
      <div class="pad fam-save"><button class="btn primary block" style="--c:var(--as-fill)" data-act="fam-idea-save" data-k="${kind}">Save</button></div>`,
  }));
}
on('fam-idea-add', (el) => ideaSheet(el.dataset.k ?? 'gift', el.dataset.person ?? null));
on('fam-plan-add', () => ideaSheet('plan'));
on('fam-idea-save', (el) => {
  const sh = el.closest('.sheet'), kind = el.dataset.k, title = $('[data-k="title"]', sh)?.value.trim(), who = picked(sh, 'who');
  if (!title) { haptic(18); toast('Write a line first'); return; }
  if (kind === 'plan') { const date = $('input[type="date"]', sh)?.value || null; P.add('plans', { people: [who], aspect: 'family', title, date, state: 'tentative', by: 'you' }); }
  else P.add('ideas', { kind, person: who, aspect: 'family', title, done: false, by: 'you', from: 'You added it' });
  closeSheet(sh); haptic(10);
  toast(kind === 'gift' ? 'Kept in gift ideas' : kind === 'plan' ? 'Pencilled in' : 'Added to Showing up');
});
on('fam-ev', (el) => api.openEvent(el.dataset.id));
on('fam-task', (el) => api.openTask(el.dataset.id));

// ── rhythms ──────────────────────────────────────────────────────────
const EVERY = [[2, 'Most days'], [7, 'Every week'], [14, 'Every two weeks'], [30, 'Every month']];
on('fam-rhythm', (el) => {
  const id = el.dataset.id, p = P.person(id); if (!p) return;
  const r = rhythmsOf(id).find((x) => !x.dinner) ?? null;
  asSheet(openSheet({
    title: `Time with ${esc(p.name)}`, sub: `How often you want it. ${esc(AGENT.name)} tells you when it slips.`,
    body: `<div class="pad fam-f"><label class="field"><input type="text" data-k="title" maxlength="40" value="${esc(r?.title ?? `Time with ${p.name}`)}" aria-label="What it is" autocomplete="off"></label></div>
      <div class="fam-f"><p class="fam-fl">How often</p>${chipsOne('every', EVERY, r?.every ?? 7)}</div>
      <div class="pad fam-save"><button class="btn primary block" style="--c:var(--as-fill)" data-act="fam-rhythm-save" data-id="${id}" data-r="${esc(r?.id ?? '')}">Save</button></div>`,
  }));
});
on('fam-rhythm-save', (el) => {
  const sh = el.closest('.sheet'), id = el.dataset.id, every = Number(picked(sh, 'every') ?? 7), title = $('[data-k="title"]', sh).value.trim() || 'Time together';
  const label = EVERY.find(([n]) => n === every)?.[1] ?? `Every ${every} days`;
  if (el.dataset.r) P.update('rhythms', el.dataset.r, { every, title, label, source: 'you' });
  else P.add('rhythms', { person: id, every, mode: 'meet', title, label, source: 'you', sort: 2 });
  closeSheet(sh); toast(`${label}: ${title.toLowerCase()}`);
});

// ── people ───────────────────────────────────────────────────────────
on('fam-person', (el) => openPersonPage(el.dataset.id));
on('fam-brain', (el) => {
  const p = personOf(el.dataset.id);
  if (el.closest('.sheet')) closeSheet(el.closest('.sheet'));
  api.openBrain(p.file ?? `people/family/${p.id}`);
});
on('fam-ask', (el) => {
  if (el.closest('.sheet')) closeSheet(el.closest('.sheet'));
  api.askAgent(el.dataset.q ?? '', { aspect: 'family', about: el.dataset.about });
});
function addPersonSheet(prefill = {}) {
  const n = homeIds().length;
  const el = asSheet(openSheet({
    title: 'Add family', sub: n ? `Add anyone close, and ${esc(AGENT.name)} keeps them warm with you.` : `Start with the people at home. ${esc(AGENT.name)} keeps time with them warm with you.`,
    body: `${P.canPickContact() ? `<div class="pad fam-f"><button class="btn block" data-act="fam-contact">${I.people}<span>Choose from Contacts</span></button></div>` : ''}
      <div class="pad fam-f"><label class="field"><input type="text" data-k="name" maxlength="24" placeholder="Their name, or what you call them" aria-label="Name" autocomplete="off" value="${esc(prefill.name ?? '')}"></label></div>
      <div class="fam-f"><p class="fam-fl">Who they are to you</p>${chipsOne('rel', [['Mother', 'Mother'], ['Father', 'Father'], ['Grandparent', 'Grandparent'], ['Sibling', 'Sibling'], ['Cousin', 'Cousin'], ['Aunt or uncle', 'Aunt or uncle'], ['Someone else', 'Someone else']], prefill.role ?? 'Grandparent')}</div>
      <p class="hint">${esc(AGENT.name)} starts a file for them in the Brain, under people/family.</p>
      <div class="pad fam-save"><button class="btn primary block" style="--c:var(--as-fill)" data-act="fam-add-save">Add to family</button></div>`,
  }));
  el._contact = prefill.contact ?? null;
  return el;
}
on('fam-add-person', () => addPersonSheet());
on('fam-contact', async (el) => {
  const sh = el.closest('.sheet');
  const c = await P.pickContact();
  if (!c) return;
  sh._contact = c; const inp = $('[data-k="name"]', sh); if (inp) inp.value = c.name;
  haptic(8); toast(c.birthday ? `${c.name}: birthday from Contacts too` : `${c.name} from Contacts`);
});
on('fam-add-save', (el) => {
  const sh = el.closest('.sheet'), name = $('[data-k="name"]', sh).value.trim();
  if (!name) { haptic(18); toast('Add a name first'); return; }
  const role = picked(sh, 'rel') ?? 'Family';
  const pronoun = /Mother|Aunt/.test(role) ? 'she' : /Father/.test(role) ? 'he' : null;
  const p = P.addPerson({ name, rel: 'family', role, pronoun, contact: sh._contact ?? null });
  closeSheet(sh);
  if (!p) return;
  toast(`Added ${name}. ${AGENT.name} starts their Brain file`, () => P.remove('persons', p.id));
});
// See all from a person page: back to the app's Moments, filtered to them
on('fam-see', (el) => {
  S.filter = el.dataset.who;
  if (appLive() && $('#stack').lastElementChild?.previousElementSibling === APP.page) { pop(); setTimeout(() => { APP.refresh('moments'); APP.go('moments'); }, 60); }
  else api.openAspect('family', 'moments');
});
on('fam-go', (el) => { if (appLive()) APP.go(el.dataset.s); });

// ── Sunday's look back ───────────────────────────────────────────────
function reviewRead(wk) {
  if (DEMO_MODE) return 'Three dinners together and an evening with both of them. The gap is Saturday at the shop with Dad.';
  const din = dinnersThisWeek(), min = weekMinutes();
  const gaps = homeIds().flatMap((id) => rhythmsOf(id).filter((r) => !r.dinner).map((r) => ({ r, id, w: P.warmth(id, r) })).filter((x) => x.w.band === 'due' || x.w.band === 'drift'));
  const lead = `${din ? `${din} ${din === 1 ? 'dinner' : 'dinners'} together` : 'No dinners logged'}${min ? `, ${fmtDur(min)} in all` : ''}, ${wk.length} ${wk.length === 1 ? 'moment' : 'moments'}.`;
  return gaps.length ? `${lead} The gap: ${gaps[0].r.title.toLowerCase()}${gaps[0].r.title.includes(personOf(gaps[0].id).name) ? '' : ` with ${personOf(gaps[0].id).name}`}.` : lead;
}
on('fam-review', () => {
  const wk = weekMoments();
  asSheet(openSheet({
    title: 'This week at home', sub: `${wk.length} ${wk.length === 1 ? 'moment' : 'moments'} since Monday · ${fmtDur(weekMinutes())} together`, large: true,
    body: `<div class="fam-rvread"><span class="tile fam-na-t">${I.sparkle}</span><p>${esc(reviewRead(wk))}</p></div>
      <div class="group fam-rvl">${wk.map((m) => `<div class="row"><span class="tile fam-tile">${kindIcon(m.kind)}</span>
        <span class="rbody"><span class="rtitle">${esc(m.title)}</span><span class="rmeta"><span class="ell">${esc([relDay(m.date), m.min ? fmtDur(m.min) : 'a chat'].join(' · '))}</span></span></span>
        <button class="check done" data-act="fam-rv-keep" data-id="${m.id}" aria-label="${esc(`Keep: ${m.title}`)}" aria-pressed="true">${I.check}</button></div>`).join('')}</div>
      <p class="hint">Unticked, a moment leaves the journal. What it taught ${esc(AGENT.name)} stays in their Brain files.</p>
      <div class="pad fam-save"><button class="btn primary block" style="--c:var(--as-fill)" data-act="fam-rv-save">Done</button></div>`,
  }));
});
on('fam-rv-keep', (el) => { el.classList.toggle('done'); el.setAttribute('aria-pressed', String(el.classList.contains('done'))); haptic(6); });
on('fam-rv-save', (el) => {
  const sh = el.closest('.sheet');
  BEFORE = snapshot();
  const gone = [];
  $$('[data-act="fam-rv-keep"]', sh).forEach((sw) => { if (!sw.classList.contains('done')) gone.push(sw.dataset.id); });
  for (const id of gone) P.update('moments', id, { let_go: true });
  closeSheet(sh);
  toast(gone.length ? `Kept ${weekMoments().length - gone.length}, let go of ${gone.length}` : 'Kept all of this week', gone.length ? () => gone.forEach((id) => P.update('moments', id, { let_go: false })) : undefined);
});

// ── the bus ──────────────────────────────────────────────────────────
// logFamily({ person, text, kind, min, dinner, title, file }) opens the log sheet; with file: true the agent files it
// directly (she logs a family dinner when he says he's with family), and the moment is returned.
provide('logFamily', (prefill = {}) => {
  if (!prefill.file) return logSheet(prefill);
  const who = toArr(prefill.person) ?? everyone();
  if (!who.length) return null;
  const m = addMoment({ people: who, kind: prefill.kind ?? 'meal', min: prefill.min ?? 0, dinner: prefill.dinner, title: prefill.title ?? prefill.text ?? `Time with ${withNames(who)}`,
    text: prefill.title ? (prefill.text ?? '') : '', said: prefill.said, by: 'wyn', from: prefill.from ?? 'said' });
  if (!prefill.silent) toast(`${AGENT.name} filed it in Family`, () => unfile(m.id));
  return m;
});
// familyTogether({ people, startedAgo }): the agent starts a together session when he says he's with family
provide('familyTogether', (o = {}) => startTogether(o));

// ── register ─────────────────────────────────────────────────────────
registerAspect({
  id: 'family',
  sections: [
    { id: 'together', label: 'Together', icon: I.home, render: renderTogether },
    { id: 'moments', label: 'Moments', icon: IC.journal, render: renderMoments },
    { id: 'dates', label: 'Dates', icon: I.cal, render: renderDates },
  ],
  start: 'together',
  primary: { label: 'Log a family moment', icon: I.plus, run: () => logSheet() },
  summary() {
    const ids = homeIds();
    if (!ids.length) return { line: 'Add the people at home', quick: [{ label: 'Add family', icon: I.plus, act: 'fam-add-person' }] };
    const wk = weekMinutes(), n = streak(), t = today(), dn = dinnerOn(t), D = tonight();
    const names = withNames(ids.slice(0, 2));
    const nextDate = sortedDates().find((d) => d.iso && daysFrom(d.iso) >= 0 && daysFrom(d.iso) <= 14);
    const open = showups().filter((x) => !x.done);
    return {
      line: dn ? `${fmtDur(wk)} together this week, and tonight's dinner is in` : D ? `${fmtDur(wk)} together this week · dinner with ${names} at ${hm(D.start)}` : wk ? `${fmtDur(wk)} together this week` : `Time with ${names}: nothing logged this week`,
      // hours: Home formats unit 'h' as a duration (3h 30m), Life shows 3.5h; text is the same figure, preformatted
      metric: { v: wk / 60, unit: 'h', text: fmtDur(wk), label: 'together this week', p: wk / weekGoal() },
      today: [
        ...(D ? [{ id: 'fam-t1', text: `Dinner with ${names} at ${hm(D.start)}`, done: dn, act: 'fam-dinner' }] : []),
        ...open.slice(0, 1).map((x) => ({ id: `fam-su-${x.id}`, text: x.title, done: false, act: 'fam-book' })),
      ],
      streak: { n, label: 'dinners together in a row', atRisk: n > 0 && !dn && NOWM() >= 21 * 60 + 30 },
      next: dn || !D ? (nextDate ? { at: fmtDay(nextDate.iso, { day: 'numeric', month: 'short' }), text: nextDate.title } : null) : { at: hm(D.start), text: `Dinner with ${names}` },
      quick: [{ label: 'With family', icon: I.home, act: 'fam-together' }, { label: 'Family moment', icon: I.plus, act: 'fam-log' }],
    };
  },
  scan: [{
    kind: 'chat', label: 'A chat with someone in Family', hint: 'Files it as a family moment; plans, dates and gift ideas go to their Brain files',
    handle(result) {
      const f = result?.fields ?? {};
      const ids = homeIds();
      if (!ids.length) { addPersonSheet(); return null; }
      const raw = `${f.person ?? ''} ${f.text ?? ''} ${result?.title ?? ''}`.toLowerCase();
      const pid = ids.includes(f.person) ? f.person : ids.find((id) => { const p = P.person(id); return [p.name, ...(p.aliases ?? [])].some((w) => raw.includes(String(w).toLowerCase())); }) ?? ids[0];
      const lines = String(f.text ?? '').split('\n').map((t) => t.trim()).filter(Boolean).slice(0, 6)
        .map((t) => [/^(me|you)\s*:/i.test(t) ? 'me' : 'them', t.replace(/^[^:]{1,14}:\s*/, '')]);
      const m = addMoment({ people: [pid], kind: 'chat', min: 0, title: result?.title || `A chat with ${personOf(pid).name}`, chat: lines.length ? lines : null, by: 'wyn', from: 'chat' });
      toast(`${AGENT.name} filed it in Family · Moments`, () => unfile(m.id));
      return m;
    },
  }],
  // what the agent can do here (her MCP tools on the PC: server/modules/people.ts)
  tools: [
    { name: 'people_log_moment', does: 'Files a moment with someone at home from what you tell her, your calendar or a chat you share', auto: true },
    { name: 'people_together', does: 'When you say you\'re with family, times it and files it', auto: true },
    { name: 'people_add_date', does: 'Keeps birthdays, anniversaries and festivals you mention; never guesses one', auto: true },
    { name: 'people_add_idea', does: 'Keeps gift ideas and small things to do for them', auto: true },
    { name: 'people_set_rhythm', does: 'Sets how often you want time with someone', auto: false },
    { name: 'people_add_person', does: 'Adds someone to Family', auto: false },
  ],
  person: (id, o = {}) => openPersonPage(id, o.back),
  onOpen(app) { APP = app; syncTick(); },
});

// links: #family, #family/<section>, #family/<person id> (agenticos://family/dad from a notification or Spotlight)
const SECTIONS = ['together', 'moments', 'dates'];
registerRoute('family', (L, ctx) => {
  const sub = L.sub ? String(L.sub).toLowerCase() : null;
  ctx.after(() => {
    if (sub && !SECTIONS.includes(sub)) { if (!appLive()) openAspect('family'); P.whenPerson(sub, () => requestAnimationFrame(() => openPersonPage(sub, 'Family'))); }
    else if (appLive() && sub) APP.go(sub); else openAspect('family', sub ?? undefined);
  });
}, { tab: 'life' });

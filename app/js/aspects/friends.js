// Friends: his circle, kept warm. Owner: the PEOPLE agent (this file, friends-*.js, people-store.js, css/aspects/friends.css).
// Four sections: Circle (home) · Moments (the friends journal) · Plans · Grow. A person page for each friend
// (registerAspect person(): the Brain's openPerson hands over here). Real data: the people store (offline-first). The agent
// files moments from what he tells her and from shared chats; she drafts messages he sends himself.
// Deep links: #friends, #friends/<section>, #friends/<person id>.
import { $, $$, esc, push, on, ring, pulse, seg, haptic, toast, wireSegs } from '../core.js';
import { I, aspectIcon } from '../icons.js';
import { registerAspect, aspHead, openAspect } from '../aspects.js';
import { registerRoute } from '../svc/route.js';
import { AGENT, DEMO_MODE, addTask } from '../data.js';
import { provide, api } from '../bus.js';
import { stagger, rollHTML } from '../motion.js';
import * as P from './people-store.js';
import {
  IDEAS, today, drift, warmth, band, status, when, dayLabel, ago, daysBetween, weekday, isThisWeek, thisWeek, circleIds, newIds, allIds,
  rhythmOf, rhythmLabel, moments, monthWeeks, friendGoal, tasksFor, ideasFor, seeds, opener,
} from './friends-data.js';
import { S, G, av, who, nameOf, namesOf, onChange, momentCard, dateTile, weeksWith, monthDays, ACT_ICON, ACT_NAME, his, him } from './friends-ui.js';
import { openLog, fileFromSaid, openDraft, openDrafts, openPlan, openRhythm, openAdd, openMoment, openLadder, openBday, addMoment } from './friends-sheets.js';

let APP = null;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const MONTH = () => new Date(`${today()}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
const weeksDone = () => monthWeeks().filter((w) => w.state === 'done').length;
const weekSavedBy = () => monthWeeks().find((w) => w.state === 'done' && w.id === P.mondayOf(today()))?.who ?? null;

function headLine() {
  const ids = circleIds();
  if (!ids.length) return 'Add the friends you want to keep close.';
  const warm = ids.filter((id) => band(id) === 'warm'); const due = ids.filter((id) => band(id) === 'due' || band(id) === 'drift'); const none = ids.filter((id) => band(id) === 'none');
  const out = [];
  if (warm.length) out.push(`${namesOf(warm)} ${warm.length > 1 ? 'are' : 'is'} warm.`);
  due.forEach((id) => out.push(`It’s been ${P.warmth(id).days} days with ${nameOf(id)}.`));
  if (none.length) out.push(`Nothing logged with ${namesOf(none)} yet.`);
  return out.join(' ');
}

// ═══ the circle: you at the centre of a half orbit; each friend sits further out the longer it's been,
//     measured against the rhythm you set with them (0 = just now, 1 = due, 2 = twice over). Bands: warm · due · drifting ═══
const R0 = 64, K = 42, XMAX = 2.3;
const ANGLE0 = [50, 132, 24, 158, 36, 146, 66, 116];
const rOf = (x) => R0 + K * Math.min(x, XMAX);
const xy = (x, deg) => { const r = rOf(x); const a = (deg * Math.PI) / 180; return [Math.round(r * Math.cos(a)), Math.round(-r * Math.sin(a))]; };
// people keep their own place on the arc; when two would touch, they slide apart along it (the radius is data, the angle isn't)
function nodes() {
  const out = circleIds().slice(0, 8).map((id, i) => { const st = status(id); return { id, i, x: drift(id), deg: ANGLE0[i % ANGLE0.length], band: st.band === 'none' ? 'due' : st.band, label: st.short }; });
  newIds().slice(0, 4).forEach((id, i) => out.push({ id, i: out.length, x: 0, deg: ANGLE0[(out.length + i) % ANGLE0.length], band: 'warm', label: 'New', fresh: true }));
  // the vertical axis is kept clear for the band names (78° to 102°); angles stay above the horizon (14° to 166°)
  const D = 60, rad = Math.PI / 180;
  const fit = (a, prefer) => { a = Math.min(166, Math.max(14, a)); if (a > 78 && a < 102) a = (prefer ?? a) < 90 ? 78 : 102; return a; };
  const pt = (n) => [rOf(n.x) * Math.cos(n.deg * rad), -rOf(n.x) * Math.sin(n.deg * rad)];
  out.forEach((n) => { n.deg = fit(n.deg); });
  for (let it = 0; it < 120; it++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const p = out[i], q = out[j]; const [px, py] = pt(p), [qx, qy] = pt(q);
      const d = Math.hypot(px - qx, py - qy); if (d >= D) continue;
      const step = ((D - d) / ((rOf(p.x) + rOf(q.x)) / 2)) / rad / 2 + 0.5;
      const dir = p.deg >= q.deg ? 1 : -1;
      p.deg = fit(p.deg + dir * step, p.deg); q.deg = fit(q.deg - dir * step, q.deg); moved = true;
    }
    if (!moved) break;
  }
  return out;
}
function nodeHtml(n) {
  const [x, y] = xy(n.x, n.deg);
  // labels sit on the outer side of the node, and flip if they'd run off the card
  const w = Math.max(nameOf(n.id).length * 8.2, 48);
  let side = n.deg < 90 ? 'r' : 'l';
  if (side === 'r' && x + 32 + w > 180) side = 'l';
  if (side === 'l' && x - 32 - w < -180) side = 'r';
  return `<button class="fri-node ${n.band}" data-act="fri-person" data-id="${n.id}" data-n="${n.id}" style="--x:${x}px;--y:${y}px;--i:${n.i}" aria-label="${esc(nameOf(n.id))}: ${n.band === 'warm' ? 'warm' : n.band === 'due' ? 'due' : 'drifting'}, ${esc(n.label)}">
    ${av(n.id, 44, n.band === 'warm' ? 'lit' : '')}
    <span class="fri-node-l ${side}"><b>${esc(nameOf(n.id))}</b><span>${esc(n.label)}</span></span>
  </button>`;
}
const orbitHtml = () => `
  <div class="fri-orbit" style="--base:188px">
    <div class="fri-sky" aria-hidden="true">
      <i class="fri-zone" style="--r:${R0 + K}px"></i>
      <i class="fri-arc" style="--r:${R0 + K}px"></i>
      <i class="fri-arc" style="--r:${R0 + 2 * K}px"></i>
      <span class="fri-band" style="--y:${R0 + K - 16}px">Warm</span>
      <span class="fri-band" style="--y:${R0 + 2 * K - 16}px">Due</span>
      <span class="fri-band" style="--y:${R0 + 2 * K + 14}px">Drifting</span>
    </div>
    <i class="fri-horizon" aria-hidden="true"></i>
    <span class="fri-you">You</span>
    ${nodes().map(nodeHtml).join('')}
    <button class="fri-seat" data-act="fri-add">${I.plus}<span>Someone new</span></button>
  </div>`;
function animateOrbit(root) {
  const o = root && $('.fri-orbit', root); if (!o) return;
  const t = performance.now(); if (o._t && t - o._t < 300) return; o._t = t;
  if (reduced()) { o.classList.add('in'); return; }
  const from = S._orbitFrom; S._orbitFrom = null;
  o.classList.remove('in', 'from');
  if (from) {
    $$('.fri-node', o).forEach((n) => { const f = from[n.dataset.n]; if (f) { n.style.setProperty('--fx', f[0]); n.style.setProperty('--fy', f[1]); } else n.classList.add('fresh'); });
    o.classList.add('from');
  }
  void o.offsetWidth;
  requestAnimationFrame(() => requestAnimationFrame(() => o.classList.add('in')));
}
const rememberOrbit = () => {
  const o = APP?.scroll && $('.fri-orbit', APP.scroll); if (!o) return;
  S._orbitFrom = Object.fromEntries($$('.fri-node', o).map((n) => [n.dataset.n, [n.style.getPropertyValue('--x'), n.style.getPropertyValue('--y')]]));
};

// the next thing to do with each friend, from where things stand
function nextAct(id) {
  const plan = P.plansFor({ person: id, open: true }).find((p) => isThisWeek(p.date));
  if (plan?.state === 'asked') return `<button class="btn sm tint fri-rbtn" style="--c:var(--as-ink)" data-act="fri-plan" data-id="chai" data-who="${id}">Pick a time</button>`;
  if (plan?.state === 'sent') return `<span class="pill plain">Sent</span>`;
  if (band(id) !== 'warm') return `<button class="btn sm tint fri-rbtn" style="--c:var(--needs-ink)" data-act="fri-draft" data-id="${id}">Message</button>`;
  return '';
}
const BAND_NAME = { warm: 'Warm', due: 'Due', drift: 'Drifting', none: 'Not yet' };
function friendRow(id) {
  const st = status(id);
  return `<div class="row ic tap fri-frow" data-act="fri-person" data-id="${id}">
    ${av(id, 40, st.band === 'warm' ? 'lit' : '')}
    <span class="rbody"><span class="rtitle">${esc(nameOf(id))}</span><span class="rmeta"><b class="fri-st ${st.band === 'none' ? 'due' : st.band}">${BAND_NAME[st.band]}</b><span class="ell">${esc(st.line.replace(/^(Warm|Due) · /, ''))}</span></span></span>
    ${nextAct(id)}
  </div>`;
}
const addedRow = (id) => { const a = P.person(id); return `<div class="row ic tap fri-frow" data-act="fri-person" data-id="${id}">
    ${av(id, 40, 'lit')}
    <span class="rbody"><span class="rtitle">${esc(a.name)}</span><span class="rmeta"><b class="fri-st warm">New</b><span class="ell">${esc(a.where ? `met at ${a.where.toLowerCase()}` : `added ${ago(a.added ?? today())}`)}${a.follow ? ` · follow up ${esc(weekday(a.follow))}` : ''}</span></span></span>
    ${I.chevR}
  </div>`; };

// ── this month: one cell per week, did you see a friend in person? (his goal in Mission when he has one) ──
function weekCard() {
  const weeks = monthWeeks(); const n = weeksDone(); const g = friendGoal();
  const saved = weekSavedBy();
  const nowW = weeks.find((w) => w.state === 'now' || (w.id === P.mondayOf(today())));
  const cells = weeks.map((w) => {
    const dot = w.state === 'done' ? av(w.who, 36, 'lit') : w.state === 'missed' ? '<i></i>' : w.state === 'now' ? `<b class="met">${w.left}</b>` : '';
    const sub = w.state === 'done' ? esc(nameOf(w.who)) : w.state === 'missed' ? 'Missed' : w.state === 'pre' ? 'Not logged' : w.state === 'now' ? `${w.left} ${w.left === 1 ? 'day' : 'days'} left` : 'Next';
    return `<div class="fri-wk ${w.state === 'pre' ? 'ahead pre' : w.state}${w.state === 'done' && w.id === P.mondayOf(today()) ? ' just' : ''}"><span class="fri-wk-o">${dot}</span><span class="fri-wk-d num">${w.label}</span><span class="fri-wk-s">${sub}</span></div>`;
  }).join('');
  const due = circleIds().find((id) => band(id) !== 'warm') ?? circleIds()[0];
  const foot = saved
    ? `<p class="fri-save done">${I.check}<span><b>Week saved.</b> You saw ${esc(nameOf(saved))} in person. Next week starts Monday.</span></p>`
    : due ? `<div class="fri-save act"><span><b>${nowW ? `${nowW.left} ${nowW.left === 1 ? 'day' : 'days'} to save this week.` : 'Save this week.'}</b> ${esc(nameOf(due))} is a message away.</span><button class="btn sm tint" style="--c:var(--needs-ink)" data-act="fri-draft" data-id="${due}">Message</button></div>` : '';
  return `<section class="fri-card surface fri-week">
    <div class="fri-week-h">
      <div class="fri-week-t"><h2 class="headline">See a friend in person, every week</h2><p class="foot"><b class="num">${n} of ${weeks.length}</b> weeks in ${MONTH()}${g ? ' · your goal in Mission' : ''}</p></div>
      <button class="fri-goal" data-act="fri-goal" aria-label="${g ? 'Open the goal in Mission' : 'Weeks this month'}">${ring(n / Math.max(1, weeks.length), 'as', 44, 5, { label: `${n} of ${weeks.length} weeks`, inner: `<b class="met">${rollHTML(n, { format: 'plain' })}</b>` })}</button>
    </div>
    <div class="fri-weeks">${cells}</div>
    ${foot}
    ${saved ? '' : `<button class="row ic tap fri-ladder-row" data-act="fri-ladder"><span class="tile">${G.bell}</span><span class="rbody"><span class="rtitle">If the week stays empty</span><span class="rmeta">A nudge on Friday, then an alarm</span></span>${I.chevR}</button>`}
  </section>`;
}

// ═══ 1 · CIRCLE (home) ═══
function wynRows() {
  const t = today();
  const rows = [];
  for (const id of allIds()) for (const d of P.draftsFor(id).filter((x) => x.by === 'wyn').slice(0, 1))
    rows.push(`<button class="row ic tap" data-act="fri-draft" data-id="${id}"><span class="tile">${I.sparkle}</span><span class="rbody"><span class="rtitle">Drafted a message to ${esc(nameOf(id))}</span><span class="rmeta">${esc([d.at ?? (d.created_at ? new Date(d.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : ''), d.why, 'you send it'].filter(Boolean).join(' · '))}</span></span>${I.chevR}</button>`);
  for (const m of moments().filter((x) => x.by === 'wyn' && daysBetween(x.date, t) <= 1).slice(0, 2))
    rows.push(`<button class="row ic tap" data-act="fri-moment" data-id="${m.id}"><span class="tile">${m.chat ? I.scan : I.sparkle}</span><span class="rbody"><span class="rtitle">${m.chat ? `Filed your chat with ${esc(nameOf(m.people[0]))}` : `Filed: ${esc(m.title)}`}</span><span class="rmeta">${esc([m.time, m.chat ? 'from your screenshot' : m.from === 'calendar' ? 'from your calendar' : 'from what you said', m.loop ? '1 open loop' : null].filter(Boolean).join(' · '))}</span></span>${I.chevR}</button>`);
  return rows.slice(0, 3).join('');
}
function renderCircle(el, app) {
  const ids = circleIds(), news = newIds();
  el.innerHTML = aspHead(app, { title: 'Your circle', sub: esc(headLine()) })
    + `<section class="group fri-circle">
        ${orbitHtml()}
        <p class="fri-cap">Further out means longer since you met, against the rhythm you set with each friend.</p>
        <div class="fri-rows">${ids.map(friendRow).join('')}${news.map(addedRow).join('')}${!ids.length && !news.length ? `<button class="row ic tap" data-act="fri-add"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">Add a friend</span><span class="rmeta">Start with the people you already want to see more</span></span>${I.chevR}</button>` : ''}</div>
      </section>`
    + (ids.length ? weekCard() : '')
    + `<div class="sh"><h2>${esc(AGENT.name)}, here today</h2></div>
      <div class="group fri-wyn">
        ${wynRows()}
        <button class="row ic tap" data-act="fri-ask"><span class="tile">${I.chat}</span><span class="rbody"><span class="rtitle">Ask ${esc(AGENT.name)} about your friends</span><span class="rmeta">Who to see, what to say, what to plan</span></span>${I.chevR}</button>
      </div>`
    + `<button class="fri-card surface fri-teaser" data-act="fri-go" data-s="grow">
        <span class="fri-teaser-i">${G.seed}</span>
        <span class="fri-teaser-b"><span class="headline">Room for more</span><span class="sub">${esc(seeds()[0] ? `You see the same faces at ${seeds()[0].title} every week. Rooms like that are where friendships start.` : 'Rooms where you see the same faces every week are where friendships start.')}</span></span>
        ${I.chevR}
      </button>`;
  animateOrbit(el);
  stagger($$('.fri-frow', el), { y: 8, each: 45, delay: 260 });
}

// ═══ 2 · MOMENTS (the friends journal) ═══
function monthCard() {
  const t = today(), days = monthDays(t); const mo = moments({ from: `${t.slice(0, 7)}-01`, to: `${t.slice(0, 7)}-31` });
  const meet = mo.filter((m) => m.kind === 'meet').length;
  const lbl = days.filter((d) => d && d.n).map((d) => `${d.d} ${MONTH()}: ${d.meet ? 'in person' : 'a chat or call'}`).join('; ') || `${MONTH()}: nothing yet`;
  return `<section class="fri-card surface fri-month">
    <div class="fri-month-l">
      <p class="foot">${MONTH()} so far</p>
      <p class="fri-month-n"><span class="met">${rollHTML(mo.length, { format: 'plain' })}</span><span class="sub">${mo.length === 1 ? 'moment' : 'moments'}</span></p>
      <p class="fri-month-k"><span class="fri-k meet" aria-hidden="true"></span><span><b>${meet}</b> in person</span></p>
      <p class="fri-month-k"><span class="fri-k talk" aria-hidden="true"></span><span><b>${mo.length - meet}</b> chats and calls</span></p>
    </div>
    <div class="fri-cal" role="img" aria-label="${esc(lbl)}">
      ${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span class="fri-cal-h" aria-hidden="true">${d}</span>`).join('')}
      ${days.map((d) => d ? `<span class="fri-d${d.meet ? ' meet' : d.talk ? ' talk' : ''}${d.today ? ' today' : ''}${d.future ? ' future' : ''}" aria-hidden="true">${d.future ? '' : d.d}</span>` : '<span class="fri-d blank" aria-hidden="true"></span>').join('')}
    </div>
  </section>`;
}
const monthName = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', ...(ym.slice(0, 4) !== today().slice(0, 4) ? { year: 'numeric' } : {}), timeZone: 'UTC' });
function timeline() {
  const list = moments().filter((m) => (S.kind === 'all' || (S.kind === 'meet' ? m.kind === 'meet' : m.kind !== 'meet')) && (!S.who || m.people.includes(S.who)));
  if (!list.length) return `<p class="note surface fri-empty">${S.kind === 'all' && !S.who ? `The friends journal is empty so far. Tell ${esc(AGENT.name)} about the last time you saw someone, or share a chat with her.` : `Nothing here with these filters. Tell ${esc(AGENT.name)} about the last time you saw someone, or share a chat with her.`}</p>`;
  let html = ''; let month = today().slice(0, 7); let day = '';
  for (const m of list) {
    const mo = m.date.slice(0, 7);
    if (mo !== month) { if (day) { html += '</div>'; day = ''; } month = mo; html += `<h3 class="fri-mo-h">${esc(monthName(mo))}</h3>`; }
    if (m.date !== day) {
      if (day) html += '</div>';
      day = m.date;
      html += `<div class="fri-day"><h4 class="fri-day-h"><span>${when(m.date)}</span>${when(m.date) === 'Today' ? `<span>${dayLabel(m.date)}</span>` : ''}</h4>`;
    }
    html += momentCard(m);
  }
  return html + (day ? '</div>' : '');
}
function renderMoments(el, app) {
  el.innerHTML = aspHead(app, { title: 'Moments', sub: `The friends journal. ${esc(AGENT.name)} files most of it from what you tell her and what you share.` })
    + monthCard()
    + `<button class="fri-tell surface" data-act="fri-log" data-focus="1"><span class="fri-tell-i">${I.sparkle}</span><span class="fri-tell-t">What happened with a friend?</span><span class="fri-tell-m" aria-hidden="true">${I.mic}</span></button>`
    + `<div class="fri-tell-x pad"><button class="chip sm" data-act="fri-scanchat">${I.scan}<span>Scan a chat</span></button><span class="foot">or share one in from WhatsApp</span></div>`
    + `<div class="pad fri-filter">${seg('fri-kind', [['all', 'All'], ['meet', 'In person'], ['talk', 'Chats and calls']], S.kind)}</div>`
    + (S.who ? `<div class="pad fri-whof"><button class="chip on" data-act="fri-who-clear" aria-label="Show everyone">${av(S.who, 22)}<span>Only ${esc(nameOf(S.who))}</span>${I.x}</button></div>` : '')
    + `<div class="fri-tl">${timeline()}</div>`
    + `<button class="fri-card surface fri-review" data-act="fri-review">
        <span class="tile asp-tile" data-aspect="growth">${aspectIcon.growth}</span>
        <span class="fri-review-b"><span class="headline">Sunday’s review</span><span class="sub">${esc(AGENT.name)} goes through the week’s moments with you and keeps what matters. It lives in Growth.</span></span>
        ${I.chevR}
      </button>`;
  $('[data-seg="fri-kind"]', el)?.addEventListener('change', (e) => { S.kind = e.detail; $('.fri-tl', el).innerHTML = timeline(); stagger($$('.fri-mom', el).slice(0, 6), { y: 8, each: 35 }); });
  stagger($$('.fri-mom', el).slice(0, 6), { y: 10, each: 45, delay: 100 });
}

// ═══ 3 · PLANS ═══
const PSTATE = { draft: ['Draft ready, not sent', 'c-needs'], sent: ['Sent · waiting for a reply', ''], asked: ['They asked · pick a time', ''], tentative: ['Pencilled in', 'c-as'], confirmed: ['On', 'c-as'], idea: ['An idea', ''] };
function planRow(p) {
  const pid = p.people?.[0];
  const [label, cls] = PSTATE[p.state] ?? ['', ''];
  const act = p.state === 'draft' ? `data-act="fri-draft" data-id="${pid}"` : `data-act="fri-plan" data-id="${p.idea ?? 'chai'}" data-who="${pid}"`;
  return `<button class="row tap fri-prow" ${act}>
    ${p.date ? dateTile(p.date) : `<span class="fri-leaf" aria-hidden="true">${I.cal}</span>`}
    <span class="rbody"><span class="rtitle">${esc(nameOf(pid))} · ${esc(p.title)}</span><span class="rmeta"><span class="${cls}">${label}</span>${p.slot ? `<span>· ${esc(p.slot)}</span>` : ''}</span></span>
    ${I.chevR}
  </button>`;
}
const ideaTile = (k) => { const d = IDEAS[k]; const fits = circleIds().slice(0, 2); return `<button class="fri-idea surface" data-act="fri-plan" data-id="${k}">
    <span class="fri-idea-m">${ACT_ICON[k]}<span class="num">${esc(d.slot)}</span></span>
    <span class="fri-idea-t">${esc(d.title)}</span>
    <span class="fri-idea-x">${esc(d.line)}</span>
    ${fits.length ? `<span class="fri-idea-f"><span class="fri-avs">${fits.map((id) => av(id, 22)).join('')}</span><span>${fits.length > 1 ? 'Any of them' : `With ${esc(nameOf(fits[0]))}`}</span></span>` : ''}
  </button>`; };
function mixCard(id) {
  const last = moments({ person: id }).filter((m) => m.kind === 'meet').slice(0, 4);
  if (last.length < 2) return '';
  const allFood = last.every((m) => m.act === 'food');
  return `<section class="fri-card surface fri-mix">
    <span class="fri-mix-i" aria-hidden="true">${last.map((m) => `<span class="fri-mix-c">${ACT_ICON[m.act] ?? I.people}</span>`).join('')}</span>
    <p class="sub">${allFood ? `<b>The last ${last.length} times with ${esc(nameOf(id))} were all food.</b> Make the next one something else.` : `<b>Your last ${last.length} with ${esc(nameOf(id))}:</b> ${esc(last.map((m) => (ACT_NAME[m.act] ?? 'time together').toLowerCase()).join(', '))}.`}</p>
  </section>`;
}
const bdayLabel = (b) => { const [m, d] = b.md.split('-'); return `${Number(d)} ${['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m) - 1]}`; };
const pastList = () => moments().filter((m) => m.kind === 'meet' && m.date <= today()).slice(0, 4).map((m) => ({ date: m.date, who: m.people[0], title: m.title, act: m.act, m: m.id }));
function renderPlans(el, app) {
  const ids = circleIds();
  const week = P.plansFor({ aspect: 'friends', open: true }).filter((p) => isThisWeek(p.date) || (!p.date && p.state !== 'idea'));
  for (const id of [...S.pick]) if (id !== 'new' && !ids.includes(id)) S.pick.delete(id);
  if (!S.pick.size) { const d = ids.find((id) => band(id) !== 'warm'); if (d) S.pick.add(d); }
  const picks = [...S.pick].filter((x) => x !== 'new');
  const go = picks.length ? `Draft ${picks.length === 1 ? 'the message' : `${picks.length} messages`}` : S.pick.has('new') ? 'Add someone new' : 'Pick someone';
  const left = thisWeek().filter((d) => d > today()).map((d) => weekday(d, true));
  const mixId = ids.find((id) => mixCard(id));
  const pastRows = pastList();
  el.innerHTML = aspHead(app, { title: 'Plans', sub: 'This week, and ideas that aren’t food.' })
    + `<section class="fri-card surface fri-prompt">
        <h2 class="title3">Who do you want to see this week?</h2>
        <p class="sub">${left.length ? `${left.length === 1 ? 'One day' : `${['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'][left.length]} days`} left: ${esc(left.length > 1 ? `${left.slice(0, -1).join(', ')} and ${left.at(-1)}` : left[0])}.` : 'The week ends today. Next week starts tomorrow.'}</p>
        <div class="fri-pick" role="group" aria-label="Who to see">
          ${ids.slice(0, 5).map((id) => `<button class="fri-pk${S.pick.has(id) ? ' on' : ''}" data-act="fri-pick" data-id="${id}" aria-pressed="${S.pick.has(id)}">${av(id, 56)}<span class="fri-pk-n">${esc(nameOf(id))}</span><span class="fri-pk-s">${esc(status(id).short)}</span><i class="fri-pk-ck" aria-hidden="true">${I.check}</i></button>`).join('')}
          <button class="fri-pk${S.pick.has('new') ? ' on' : ''}" data-act="fri-pick" data-id="new" aria-pressed="${S.pick.has('new')}"><span class="fri-av fri-av-add" style="--av:56px" aria-hidden="true">${I.plus}</span><span class="fri-pk-n">Someone new</span><span class="fri-pk-s">From Grow</span><i class="fri-pk-ck" aria-hidden="true">${I.check}</i></button>
        </div>
        <button class="btn block fri-pk-go" data-act="fri-pick-go"${S.pick.size ? '' : ' disabled'}>${go}</button>
        <p class="fri-never">${I.lock}<span>You send them. ${esc(AGENT.name)} never messages as you.</span></p>
      </section>`
    + `<div class="sh"><h2>This week</h2><span class="sh-count">${week.length}</span></div>`
    + (week.length ? `<div class="group fri-plans">${week.map(planRow).join('')}</div>` : `<p class="note surface">Nothing planned yet. Pick someone above, or pencil in one of the ideas below.</p>`)
    + `<div class="sh"><h2>Beyond food</h2></div>`
    + `<div class="fri-ideas">${Object.keys(IDEAS).map(ideaTile).join('')}</div>`
    + (mixId ? mixCard(mixId) : '')
    + (ids.length ? `<div class="sh"><h2>Birthdays</h2></div>
      <div class="group">${ids.map((id) => { const b = P.birthdayOf(id); return `<button class="row ic tap" data-act="fri-bday" data-id="${id}">${av(id, 32)}<span class="rbody"><span class="rtitle">${esc(nameOf(id))}</span><span class="rmeta">${b ? `${esc(bdayLabel(b))} · ${P.inDays(P.daysBetween(today(), P.nextOf(b)))}` : 'Not on file yet'}</span></span><span class="rend c-as">${b ? 'Edit' : 'Add date'}</span></button>`; }).join('')}</div>` : '')
    + (pastRows.length ? `<div class="sh"><h2>What happened</h2></div>
      <div class="group">${pastRows.map((p) => `<button class="row tap fri-prow" data-act="fri-moment" data-id="${p.m}">${dateTile(p.date)}<span class="rbody"><span class="rtitle">${esc(nameOf(p.who))} · ${esc(p.title)}</span><span class="rmeta"><span class="fri-ok">${I.check}</span><span>In person${p.act ? ` · ${esc(ACT_NAME[p.act] ?? p.act)}` : ''}</span></span></span>${I.chevR}</button>`).join('')}</div>` : '');
}

// ═══ 4 · GROW (widen the circle) ═══
const hoursWith = (id) => Math.round(moments({ person: id }).filter((m) => m.kind === 'meet').reduce((a, m) => a + (m.minutes || 0), 0) / 60);
function renderGrow(el, app) {
  const sd = seeds(); const news = newIds();
  el.innerHTML = aspHead(app, { title: 'Grow', sub: 'Room for more, at your pace.' })
    + `<section class="fri-card surface fri-addc">
        <span class="fri-addc-o" aria-hidden="true">${circleIds().slice(0, 2).map((id) => av(id, 40)).join('')}<span class="fri-av fri-av-add lit" style="--av:40px">${I.plus}</span></span>
        <h2 class="title2">Met someone?</h2>
        <p class="sub">Add them in one line. ${esc(AGENT.name)} remembers where you met and reminds you to follow up within two days, while it’s still easy.</p>
        <div class="fri-addc-a"><button class="btn tint" style="--c:var(--as-ink)" data-act="fri-add">${I.plus}<span>Add someone</span></button>${P.canPickContact() ? `<button class="btn" data-act="fri-contact">${I.people}<span>From Contacts</span></button>` : `<button class="btn" data-act="fri-scancard">${I.scan}<span>Scan a card</span></button>`}</div>
      </section>`
    + (sd.length ? `<div class="sh"><h2>From your week</h2></div>
      <p class="fri-lead">Friendships start where you see the same people again and again. ${sd.length === 1 ? 'One place' : `${['', 'One', 'Two', 'Three'][sd.length]} places`} in your week already ${sd.length === 1 ? 'does' : 'do'} that.</p>
      <div class="group fri-seeds">${sd.map((s) => `<div class="row ic fri-seed">
          <span class="tile">${I[s.icon] ?? I.people}</span>
          <span class="rbody"><span class="rtitle">${esc(s.title)}</span><span class="rmeta">${esc(s.meta)}</span><span class="fri-seed-x">${esc(s.line)}</span></span>
          ${P.state('friends')?.seeds?.[s.title] ? `<span class="pill plain fri-seed-b">Added</span>` : `<button class="btn sm tint fri-seed-b" style="--c:var(--as-ink)" data-act="fri-seed" data-id="${s.id}">Try it</button>`}
        </div>`).join('')}</div>` : '')
    + `<section class="fri-card surface fri-hours">
        <div class="fri-hours-h"><span class="tile">${G.hours}</span><span><span class="headline">How long a friendship takes</span><span class="foot">Jeffrey Hall, University of Kansas, 2018</span></span></div>
        <div class="fri-scale" role="img" aria-label="About 50 hours together makes a casual friend, about 90 a friend, and over 200 a close friend">
          <i class="fri-scale-t"><i></i><i></i><i></i></i>
          <span class="fri-tick down start" style="--p:0%"><b class="num">0 h</b><span>You meet</span></span>
          <span class="fri-tick up" style="--p:25%"><b class="num">50 h</b><span>Casual friend</span></span>
          <span class="fri-tick down" style="--p:45%"><b class="num">90 h</b><span>Friend</span></span>
          <span class="fri-tick up end" style="--p:100%"><b class="num">200 h</b><span>Close friend</span></span>
        </div>
        <p class="sub">Two hours a week for six months makes a casual friend. ${esc(AGENT.name)} counts the hours from your calendar and what you tell her.</p>
      </section>`
    + `<div class="sh"><h2>New people</h2><span class="sh-count">${news.length}</span></div>`
    + (news.length
      ? `<div class="group">${news.map((id) => { const a = P.person(id); return `<button class="row ic tap" data-act="fri-person" data-id="${id}">${av(id, 32, 'lit')}<span class="rbody"><span class="rtitle">${esc(a.name)}</span><span class="rmeta">${esc(a.where ? `Met at ${a.where.toLowerCase()}` : `Added ${ago(a.added ?? today())}`)} · ${hoursWith(id)} of 50 hours</span></span>${I.chevR}</button>`; }).join('')}</div>`
      : `<p class="note surface fri-empty">No one yet. Whoever you add starts here at 0 hours, and ${esc(AGENT.name)} keeps the follow-up for you.</p>`)
    + `<div class="group fri-askg"><button class="row ic tap" data-act="fri-ask" data-q="Find one event in my city this month where I could meet people who build things"><span class="tile">${I.sparkle}</span><span class="rbody"><span class="rtitle">Find one event this month</span><span class="rmeta">${esc(AGENT.name)} looks for people near you who build things</span></span>${I.chevR}</button></div>`;
}

// ═══ PERSON PAGES (shared anatomy with Family): who · keep warm · next · moments · their file · ask · connected ═══
const qa = (label, icon, act, attrs) => `<button class="fri-qa-b" data-act="${act}" ${attrs}><span class="fri-qa-i">${icon}</span><span>${label}</span></button>`;
function keepWarm(id) {
  const r = rhythmOf(id); const st = status(id); const wk = weeksWith(id);
  const meetMode = r?.mode === 'meet';
  const ok = (w) => meetMode ? w.state === 'meet' : w.state === 'meet' || w.state === 'talk';
  const past = wk.slice(0, -1); const hit = past.filter(ok).length;
  const lbl = wk.map((w) => `week of ${w.label}: ${w.state === 'meet' ? 'in person' : w.state === 'talk' ? 'a chat or call' : w.state === 'now' ? 'this week, open' : 'nothing'}`).join('; ');
  const m0 = new Date(`${wk[0].w}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  const ci = wk.findIndex((w) => w.w.slice(5, 7) !== wk[0].w.slice(5, 7));
  const m1 = ci > 0 ? new Date(`${wk[ci].w}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) : '';
  const line = st.band === 'warm' ? `<b class="c-as">Warm this week.</b>` : st.band === 'none' ? `<b class="c-needs">Nothing logged yet.</b>` : `<b class="c-needs">Due since ${dayLabel(st.dueSince)}.</b>`;
  return `<div class="sh"><h2>Keep warm</h2></div>
  <section class="fri-card surface fri-keep">
    <div class="fri-keep-h"><span class="fri-keep-r"><span class="foot">${r?.source === 'default' ? 'The rhythm, for now' : 'The rhythm you set'}</span><span class="headline">${esc(rhythmLabel(id))}</span></span><button class="btn sm" data-act="fri-rhythm" data-id="${id}">${r ? 'Change' : 'Set one'}</button></div>
    <div class="fri-strip" role="img" aria-label="${esc(lbl)}">${wk.map((w) => `<span class="fri-sw ${w.state}${!ok(w) && w.state !== 'now' && meetMode && w.state === 'talk' ? ' dim' : ''}"></span>`).join('')}</div>
    <div class="fri-strip-l" aria-hidden="true"><span>${m0}</span>${m1 ? `<span style="--c:${ci}">${m1}</span>` : ''}<span class="end">This week</span></div>
    <p class="fri-keep-st">${line} ${hit} of the last ${past.length} weeks ${meetMode ? 'in person' : 'in touch'}.</p>
    <div class="fri-keep-k"><span><span class="fri-k meet" aria-hidden="true"></span>In person</span><span><span class="fri-k talk" aria-hidden="true"></span>Chat or call</span></div>
  </section>`;
}
function nextCard(id) {
  const plan = P.plansFor({ person: id, open: true }).find((p) => isThisWeek(p.date) || !p.date);
  const own = P.draftsFor(id)[0];
  if (weekSavedBy() === id && !plan) return `<div class="sh"><h2>Next</h2></div><section class="fri-card surface fri-next"><div class="fri-next-h">${G.seed}<span class="fri-next-t"><span class="headline">This week is saved</span><span class="foot">Next time, try one of the ideas below</span></span></div></section>`;
  const head = plan ? `${plan.date ? `${weekday(plan.date, true)}: ` : ''}${plan.title.toLowerCase()}` : band(id) === 'warm' ? `Keep it going with ${nameOf(id)}` : `Message ${nameOf(id)}`;
  const foot = plan ? (PSTATE[plan.state]?.[0] ?? 'Planned') + (plan.slot ? ` · ${plan.slot}` : '') : own ? `${AGENT.name} drafted it · you send it` : 'A line to start · you send it';
  const line = own?.text ?? null;
  return `<div class="sh"><h2>Next</h2></div>
  <section class="fri-card surface fri-next">
    <div class="fri-next-h">${plan?.date ? dateTile(plan.date) : `<span class="fri-leaf" aria-hidden="true">${I.chat}</span>`}<span class="fri-next-t"><span class="headline">${esc(head.charAt(0).toUpperCase() + head.slice(1))}</span><span class="foot">${esc(foot)}</span></span></div>
    ${line ? `<p class="fri-bubble-p">${esc(line)}</p>` : ''}
    <div class="fri-next-a"><button class="btn sm" data-act="fri-plan" data-id="${ideasFor(id)[0] ?? 'chai'}" data-who="${id}">${plan ? 'Change the plan' : 'Plan something'}</button><button class="btn sm tint" style="--c:var(--${band(id) === 'warm' ? 'as' : 'needs'}-ink)" data-act="fri-draft" data-id="${id}">${I.copy}<span>${own ? 'Open the draft' : 'Message'}</span></button></div>
  </section>`;
}
const ideasRail = (id) => `<div class="sh"><h2>Things to do together</h2></div>
  <div class="fri-rail" data-scroll-x>${ideasFor(id).filter((k) => IDEAS[k]).map((k) => `<button class="fri-idea surface" data-act="fri-plan" data-id="${k}" data-who="${id}"><span class="fri-idea-m">${ACT_ICON[k]}<span class="num">${esc(IDEAS[k].slot)}</span></span><span class="fri-idea-t">${esc(IDEAS[k].title)}</span><span class="fri-idea-x">${esc(IDEAS[k].line)}</span></button>`).join('')}</div>`;
function fileBlock(id) {
  const p = P.person(id); const known = p.remember ?? []; const b = P.birthdayOf(id);
  const asks = p.ask ?? [{ k: 'now', label: `What ${namesOf([id])}’s up to these days` }];
  return `<div class="sh"><h2>From ${esc(his(id))} file</h2><button class="sh-act" data-act="fri-file" data-id="${id}">Open ${I.chevR}</button></div>
  ${known.length ? `<div class="group fri-known">${known.map((r) => `<div class="row ic"><span class="tile fri-ktile">${I.check}</span><span class="rbody"><span class="rtitle wrap">${esc(r.text)}</span><span class="rmeta">${esc(r.from ?? '')}</span></span></div>`).join('')}</div>`
    : `<p class="note surface fri-empty">What you tell ${esc(AGENT.name)} about ${esc(p.name)} lands here and in ${esc(his(id))} Brain file.</p>`}
  ${p.note ? `<p class="fri-pnote">${I.sparkle}<span>${esc(p.note)}</span></p>` : ''}
  <div class="sh"><h2>Not on file yet</h2></div>
  <div class="group">${!b ? `<button class="row ic tap" data-act="fri-bday" data-id="${id}"><span class="tile">${I.cal}</span><span class="rbody"><span class="rtitle">${esc(p.pronoun === 'she' ? 'Her' : p.pronoun === 'he' ? 'His' : 'Their')} birthday</span><span class="rmeta">${esc(AGENT.name)} never guesses dates</span></span><span class="rend c-as">Add date</span></button>`
      : `<button class="row ic tap" data-act="fri-bday" data-id="${id}"><span class="tile">${I.cal}</span><span class="rbody"><span class="rtitle">Birthday · ${esc(bdayLabel(b))}</span><span class="rmeta">${esc(AGENT.name)} reminds you a week before</span></span><span class="rend c-as">Edit</span></button>`}
    ${asks.map((u) => `<button class="row ic tap" data-act="fri-opener" data-id="${id}" data-k="${u.k}"><span class="tile">${I.chat}</span><span class="rbody"><span class="rtitle">${esc(u.label)}</span><span class="rmeta">A way to ask, ready to send</span></span><span class="rend c-as">Ask ${esc(him(id))}</span></button>`).join('')}</div>`;
}
function connected(id) {
  const p = who(id); const g = friendGoal(); const ts = tasksFor(id); const allow = (P.person(id)?.allow?.kinds ?? []).length > 0;
  return `<div class="sh"><h2>Connected</h2></div>
  <div class="group">
    ${g ? `<button class="row ic tap" data-act="fri-goal"><span class="tile asp-tile" data-aspect="mission">${aspectIcon.mission}</span><span class="rbody"><span class="rtitle">${esc(g.title)}</span><span class="rmeta">Goal in Mission · ${weeksDone()} of ${monthWeeks().length} weeks</span></span>${I.chevR}</button>` : ''}
    ${ts.map((t) => `<button class="row ic tap" data-act="fri-task" data-id="${t.id}"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle">${esc(t.title)}</span><span class="rmeta">Task${t.when ? ` · ${esc(t.when)}` : ''}</span></span>${I.chevR}</button>`).join('')}
    <button class="row ic tap" data-act="fri-file" data-id="${id}"><span class="tile">${I.brain}</span><span class="rbody"><span class="rtitle">${esc(p.name)}’s file in the Brain</span><span class="rmeta"><span class="mono">${esc(p.file ?? '')}</span></span></span>${I.chevR}</button>
    <div class="row ic"><span class="tile">${I.chat}</span><span class="rbody"><span class="rtitle">${esc(AGENT.name)} may send small things</span><span class="rmeta">“Running 10 minutes late”, where and when. Everything else, you send.</span></span><button class="switch${allow ? ' on' : ''}" role="switch" aria-checked="${allow}" aria-label="Let ${esc(AGENT.name)} send small messages to ${esc(p.name)}" data-act="fri-allow" data-id="${id}"></button></div>
  </div>`;
}
function personHtml(id) {
  const p = P.person(id);
  if (!p) return '<p class="note surface">This person isn’t in your circle any more.</p>';
  if (p.rel === 'new' && !rhythmOf(id)) return newPersonHtml(id);
  const st = status(id);
  const ms = moments({ person: id });
  const pill = st.band === 'warm' ? `${I.check}<span>Warm · ${st.w.days === 0 ? 'today' : ago(st.w.last.date)}</span>` : st.band === 'none' ? `${I.clock}<span>Nothing logged yet</span>` : `${I.clock}<span>Due · ${st.w.days} days</span>`;
  return `<header class="fri-hero">
      ${ring(st.band === 'none' ? 0.04 : warmth(id), 'as', 136, 7, { inner: av(id, 108), cls: 'fri-hero-ring', label: `${p.name}: ${st.band === 'warm' ? 'warm' : st.band === 'none' ? 'nothing logged yet' : 'due'}` })}
      <h1 class="title1 fri-hero-n">${esc(p.name)}</h1>
      <p class="sub fri-hero-r">${esc(p.role ?? 'Friend')}</p>
      <p class="fri-hero-st"><span class="pill fri-pill ${st.band === 'none' ? 'due' : st.band}">${pill}</span>${p.since ? `<span class="foot">${esc(p.since)}</span>` : ''}</p>
      <div class="fri-qa">
        ${qa('Message', I.chat, 'fri-draft', `data-id="${id}"`)}${qa('Plan', I.cal, 'fri-plan', `data-id="${ideasFor(id)[0] ?? 'chai'}" data-who="${id}"`)}${qa('Log', I.plus, 'fri-log', `data-id="${id}"`)}${qa('File', I.brain, 'fri-file', `data-id="${id}"`)}
      </div>
    </header>
    ${keepWarm(id)}
    ${nextCard(id)}
    ${ideasRail(id)}
    ${mixCard(id)}
    <div class="sh"><h2>Moments</h2><span class="sh-count">${ms.length}</span>${ms.length ? `<button class="sh-act" data-act="fri-allmoments" data-id="${id}">All ${I.chevR}</button>` : ''}</div>
    ${ms.length ? `<div class="fri-pmoms">${ms.slice(0, 3).map((m) => momentCard(m)).join('')}</div>` : `<p class="note surface fri-empty">No moments with ${esc(p.name)} yet. Log the last time you met, or share a chat.</p>`}
    ${fileBlock(id)}
    <div class="sh"><h2>Ask ${esc(AGENT.name)} about ${esc(p.name)}</h2></div>
    <div class="pad fri-asks">${[`Plan the weekend with ${p.name}`, `What did we do last time?`, `Ideas that aren’t food`].map((q) => `<button class="chip" data-act="fri-ask" data-id="${id}" data-q="${esc(q)}">${I.sparkle}<span>${esc(q)}</span></button>`).join('')}</div>
    ${connected(id)}`;
}
function newPersonHtml(id) {
  const a = P.person(id); if (!a) return '<p class="note surface">This person isn’t in your circle any more.</p>';
  const h = hoursWith(id);
  return `<header class="fri-hero">
      ${ring(Math.max(0.02, h / 50), 'as', 136, 7, { inner: av(id, 108), cls: 'fri-hero-ring', label: `${h} of 50 hours` })}
      <h1 class="title1 fri-hero-n">${esc(a.name)}</h1>
      <p class="sub fri-hero-r">${esc(a.where ? `Met at ${a.where.toLowerCase()}` : 'Someone new')} · ${esc(when(a.added ?? today()).toLowerCase())}</p>
      <p class="fri-hero-st"><span class="pill fri-pill warm">${G.seed}<span>New · ${h} of 50 hours</span></span></p>
      <div class="fri-qa">${qa('Message', I.chat, 'fri-draft', `data-id="${id}"`)}${qa('Log', I.plus, 'fri-log', `data-id="${id}"`)}${qa('Rhythm', I.clock, 'fri-rhythm', `data-id="${id}"`)}</div>
    </header>
    <div class="sh"><h2>Next</h2></div>
    <section class="fri-card surface fri-next">
      <div class="fri-next-h">${a.follow ? dateTile(a.follow) : G.bell}<span class="fri-next-t"><span class="headline">${a.follow ? `Follow up ${esc(dayLabel(a.follow))}` : 'No follow-up set'}</span><span class="foot">${esc(AGENT.name)} drafts an opener on the day; you send it</span></span></div>
    </section>
    ${a.note ? `<div class="sh"><h2>To remember</h2></div><p class="note surface">${esc(a.note)}</p>` : ''}
    <div class="sh"><h2>Ask ${esc(AGENT.name)}</h2></div>
    <div class="pad fri-asks">${[`How do I follow up with ${a.name}?`, `Plan something small with ${a.name}`].map((q) => `<button class="chip" data-act="fri-ask" data-id="${id}" data-q="${esc(q)}">${I.sparkle}<span>${esc(q)}</span></button>`).join('')}</div>`;
}
export function openFriend(id, { back = 'Friends' } = {}) {
  const p = P.person(id); if (!p?.name) return null;
  const page = push({
    title: p.name, back, aspect: 'friends', cls: 'fri-pp',
    right: `<button class="gbtn chrome icon" data-act="fri-ask" data-id="${id}" aria-label="Ask ${esc(AGENT.name)} about ${esc(p.name)}">${I.sparkle}</button>`,
    render(sc) { sc.innerHTML = personHtml(id); stagger($$('.fri-keep, .fri-next, .fri-mom', sc), { y: 10, each: 50, delay: 160 }); },
  });
  page.dataset.friend = id;
  return page;
}

// ═══ keep every open Friends screen true after a change ═══
onChange((what) => {
  if (what.store?.has?.('moments') || what.store?.has?.('rhythms') || what.store?.has?.('persons')) rememberOrbit();
  if (!APP?.el('circle')?.dataset.built) S._orbitFrom = null;
  if (APP?.page?.isConnected) for (const s of ['circle', 'moments', 'plans', 'grow']) { const el = APP.el(s); if (el?.dataset.built) { const y = APP.section === s ? APP.scroll.scrollTop : null; APP.refresh(s); if (y != null) APP.scroll.scrollTop = y; } }
  $$('#stack > .page.fri-pp').forEach((pg) => { const sc = $('.scroll', pg); const y = sc.scrollTop; sc.innerHTML = personHtml(pg.dataset.friend); wireSegs(sc); sc.scrollTop = y; pulse(sc); });
});

// ═══ actions (app-wide data-act names, all fri-) ═══
const goSection = (s) => { if (APP?.page?.isConnected) { APP.go(s); APP.scroll.scrollTop = 0; } else api.openAspect('friends', s); };
const firstDue = () => circleIds().find((id) => band(id) !== 'warm') ?? circleIds()[0];
on('fri-person', (el) => { haptic(6); openFriend(el.dataset.id); });
on('fri-draft', (el) => { const id = el.dataset.id || firstDue(); if (id) openDraft(id); else openAdd(); });
on('fri-reply', (el) => openDraft(el.dataset.id));
on('fri-plan', (el) => { if (!circleIds().length && !el.dataset.who) return openAdd(); openPlan(el.dataset.id || 'chai', el.dataset.who || null); });
on('fri-log', (el) => openLog({ person: el.dataset.id || null, focus: !!el.dataset.focus }));
on('fri-file', (el) => api.openBrain(who(el.dataset.id).file ?? 'people/friends'));
on('fri-ask', (el) => api.askAgent(el.dataset.q ?? '', { aspect: 'friends', about: el.dataset.id || null }));
on('fri-moment', (el) => openMoment(el.dataset.id, { onPerson: (id) => openFriend(id) }));
on('fri-ladder', () => openLadder());
on('fri-goal', () => { const g = friendGoal(); if (g) api.openGoal(g.id); else goSection('plans'); });
on('fri-task', (el) => api.openTask(el.dataset.id));
on('fri-review', () => api.openReview());
on('fri-go', (el) => goSection(el.dataset.s));
on('fri-add', () => openAdd());
on('fri-contact', async () => { const c = await P.pickContact(); if (c) openAdd({ name: c.name, contact: c }); });
on('fri-scancard', () => api.scan('card'));
on('fri-scanchat', () => api.scan('chat'));
on('fri-rhythm', (el) => openRhythm(el.dataset.id));
on('fri-bday', (el) => openBday(el.dataset.id));
on('fri-opener', (el) => openDraft(el.dataset.id, { text: opener(el.dataset.k, el.dataset.id), variant: 1 }));
on('fri-skipweek', () => toast(`Okay. ${AGENT.name} lets this week go and asks again on Monday`));
on('fri-allow', (el) => {
  const id = el.dataset.id; const on1 = !el.classList.contains('on');
  el.classList.toggle('on', on1); el.setAttribute('aria-checked', String(on1)); haptic(6);
  P.update('persons', id, { allow: { kinds: on1 ? ['late', 'logistics'] : [], at: new Date().toISOString() } });
  toast(on1 ? `${AGENT.name} may send ${nameOf(id)} small things, and tells you` : `${AGENT.name} won’t send ${nameOf(id)} anything`);
});
on('fri-pick', (el) => {
  const id = el.dataset.id; S.pick.has(id) ? S.pick.delete(id) : S.pick.add(id); haptic(5);
  const on_ = S.pick.has(id); el.classList.toggle('on', on_); el.setAttribute('aria-pressed', String(on_));
  const picks = [...S.pick].filter((x) => x !== 'new'); const b = $('.fri-pk-go', el.closest('.fri-prompt'));
  if (b) { b.disabled = !S.pick.size; b.textContent = picks.length ? `Draft ${picks.length === 1 ? 'the message' : `${picks.length} messages`}` : S.pick.has('new') ? 'Add someone new' : 'Pick someone'; }
});
on('fri-pick-go', () => { const picks = [...S.pick].filter((x) => x !== 'new'); if (picks.length) openDrafts(picks); else if (S.pick.has('new')) goSection('grow'); });
on('fri-allmoments', (el) => { S.who = el.dataset.id; S.kind = 'all'; const top = $('#stack > .page:last-child'); if (top?.classList.contains('fri-pp')) top.querySelector('[data-act="pop"]')?.click(); if (APP?.el('moments')?.dataset.built) APP.refresh('moments'); setTimeout(() => goSection('moments'), 60); });
on('fri-who-clear', () => { S.who = null; if (APP?.el('moments')?.dataset.built) APP.refresh('moments'); });
on('fri-seed', (el) => {
  const s = seeds().find((x) => x.id === el.dataset.id); if (!s) return;
  P.setState('friends', { seeds: { ...(P.state('friends')?.seeds ?? {}), [s.title]: true } });
  if (!DEMO_MODE) addTask({ title: s.task, due: s.date && s.date > today() ? s.date : P.addDays(today(), 7), notes: 'From Friends · Grow' });
  toast(`Added to your tasks: ${s.task.toLowerCase()}`);
});

// ═══ the bus: log a moment from anywhere. { person, text } opens the sheet; { auto: true } is the agent filing it herself ═══
provide('logFriends', (prefill = {}) => (prefill.auto ? fileFromSaid(prefill) : openLog(prefill)));
provide('openFriend', (id) => openFriend(id, { back: 'Back' }));
// someone new from anywhere (the Brain's "Add someone"): { name, rel } adds them at once; anything less opens the
// Someone new sheet, prefilled with what came
provide('addPerson', (o = {}) => (o.name && o.rel ? P.addPerson(o) : openAdd({ name: o.name ?? '', where: o.where ?? null, note: o.note ?? '', contact: o.contact ?? null })));

// ═══ the app ═══
registerAspect({
  id: 'friends',
  sections: [
    { id: 'circle', label: 'Circle', icon: I.people, render: renderCircle },
    { id: 'moments', label: 'Moments', icon: G.moments, render: renderMoments },
    { id: 'plans', label: 'Plans', icon: I.cal, render: renderPlans },
    { id: 'grow', label: 'Grow', icon: G.seed, render: renderGrow },
  ],
  start: 'circle',
  primary: { label: 'Log a moment with a friend', icon: I.plus, run: () => openLog({}) },
  summary() {
    const ids = circleIds();
    if (!ids.length) return { line: 'Add the friends you want to keep close', quick: [{ label: 'Add a friend', icon: I.plus, act: 'fri-add' }] };
    const weeks = monthWeeks(); const n = weeksDone();
    const due = ids.filter((id) => band(id) !== 'warm');
    const asked = P.plansFor({ aspect: 'friends', open: true }).filter((p) => p.state === 'asked' && isThisWeek(p.date));
    const today1 = [
      ...due.slice(0, 1).map((id) => ({ id: `fri-1-${id}`, text: `Message ${nameOf(id)}`, done: false, act: 'fri-draft' })),
      ...asked.slice(0, 1).map((p) => ({ id: `fri-2-${p.id}`, text: `Reply to ${nameOf(p.people?.[0])} about ${p.date ? weekday(p.date, true) : 'the plan'}`, done: false, act: 'fri-draft' })),
    ];
    const next = P.plansFor({ aspect: 'friends', open: true }).find((p) => p.date && p.date >= today());
    return {
      line: headLine(),
      metric: { v: n, unit: `/${weeks.length}`, label: 'weeks with a friend', p: n / Math.max(1, weeks.length) },
      today: today1,
      next: next ? { at: weekday(next.date), text: `${next.title} with ${nameOf(next.people?.[0])}` } : weekSavedBy() ? { at: 'Mon', text: 'A new week to see someone' } : null,
      quick: [{ label: 'Moment', icon: I.plus, act: 'fri-log' }, ...(due[0] ? [{ label: `Message ${nameOf(due[0])}`, icon: I.chat, act: 'fri-draft' }] : [])],
    };
  },
  scan: [
    { kind: 'chat', label: 'A chat with a friend', hint: 'Files it as a moment, and keeps any plan or promise in it', handle(result) {
      const f = result?.fields ?? {}; const raw = `${f.person ?? ''} ${result?.title ?? ''} ${f.text ?? ''}`.toLowerCase();
      const pid = allIds().find((id) => { const p = P.person(id); return [p.id, p.name, ...(p.aliases ?? [])].some((w) => raw.includes(String(w).toLowerCase())); });
      if (!pid) { openLog({ text: f.text ?? '', kind: 'chat' }); return null; }
      const lines = String(f.text ?? '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 6)
        .map((l) => /^(me|you)\s*:/i.test(l) ? ['me', l.replace(/^[^:]+:\s*/, '')] : ['them', l.replace(/^[^:]+:\s*/, '')]);
      addMoment({ people: [pid], kind: 'chat', title: result?.title || `A chat with ${nameOf(pid)}`, text: lines.length ? '' : (f.text ?? ''), by: 'wyn', source: 'chat', chat: lines.length ? lines : undefined, loop: f.loop ?? undefined });
      const id = addMoment.last;
      toast(`Filed under ${nameOf(pid)}: a chat`, () => P.remove('moments', id));
      setTimeout(() => { if (!APP?.page?.isConnected) api.openAspect('friends', 'moments'); else goSection('moments'); }, 200);
      return momentById(id);
    } },
    { kind: 'card', label: 'Someone’s card or contact', hint: 'Adds them to your circle, with where you met', handle(result) { const f = result?.fields ?? {}; openAdd({ name: f.name ?? '', where: f.where ?? null }); } },
  ],
  // what the agent can do here (her MCP tools on the PC: server/modules/people.ts)
  tools: [
    { name: 'people_log_moment', does: 'Files a moment with a friend from what you tell her, a shared chat or your calendar', auto: true },
    { name: 'people_file_chat', does: 'Reads a chat screenshot you share, files it and keeps any plan or promise in it', auto: true },
    { name: 'people_draft_message', does: 'Drafts a message to a friend for you to send. She sends only the small things you allowed', auto: true },
    { name: 'people_plan', does: 'Pencils in a plan beyond food on a free slot', auto: true },
    { name: 'people_set_rhythm', does: 'Sets how often you want to see someone', auto: false },
    { name: 'people_add_person', does: 'Adds someone you met to your circle, from a card or one line', auto: false },
  ],
  person(id) { return openFriend(id, { back: 'Back' }); },
  onOpen(app) { APP = app; },
  onSection(app, id) { if (id === 'circle') animateOrbit(app.el('circle')); },
});

// links: #friends, #friends/<section>, #friends/<person id> (agenticos://friends/kabir)
const SECTIONS = ['circle', 'moments', 'plans', 'grow'];
registerRoute('friends', (L, ctx) => {
  const sub = L.sub ? String(L.sub).toLowerCase() : null;
  ctx.after(() => {
    if (sub && !SECTIONS.includes(sub)) { if (!APP?.page?.isConnected) openAspect('friends'); P.whenPerson(sub, () => setTimeout(() => openFriend(sub), 80)); }
    else if (APP?.page?.isConnected && sub) goSection(sub); else openAspect('friends', sub ?? undefined);
  });
}, { tab: 'life' });

function momentById(id) { const d = P.moment(id); return d ? moments().find((x) => x.id === id) ?? null : null; }

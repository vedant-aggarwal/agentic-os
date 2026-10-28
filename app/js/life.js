// Life: the tab. The wheel of nine aspects round the Brain, the map of what feeds what, the score sheet, the peek.
// Owner: LIFE (v2). Provides on the bus: openLife(view). Keeps exporting openLife, lifeCard and stackBar (More imports them).
//
// The wheel is a wheel: the Brain is the hub, each aspect is a spoke, a spoke's length is its score out of 10 and the
// rim is 10. The three families (Health, Work, Relationships) sit apart. Spokes draw out from the hub once per open on
// the skin's own curve (Obsidian's light blooms, Matte's ink bleeds at the head), like every ring in the app.
// Real data: the scores are the latest life_snapshot (data.js), past scorings come from life_snapshots, a scoring saves a
// real snapshot (setScore, offline first), the draft is read from the apps' records (life-data.js), the map is life-map.js.
import { $, $$, esc, on, toast, seg, wireSegs, haptic, ring, pulse, setTab, closePeek, currentTab, registerTab, topbar, openSheet, closeSheet, peek, onHold } from './core.js';
import { I } from './icons.js';
import { ASPECTS, FAMILIES, aspect, GOALS, AGENT, ME, area, setScore, DEMO_MODE } from './data.js';
import { summary, aspectTile, aspectDef } from './aspects.js';
import { api, provide, has } from './bus.js';
import * as clock from './svc/clock.js';
import { roll, rollHTML } from './motion.js';
import { IDS, FAM_ORDER, famIds, snapshots, latest, rhythm, draft, demoScored, planReminder, onAreaAspects, shortDate, RESCORE_DAYS } from './life-data.js';
import { mapView, mountMap, refreshMap, unmountMap, select as mapSelect, setFilter, highlightTwo, highlightGaps, doUnlink, mapState } from './life-map.js';

// ── state ─────────────────────────────────────────────────────────────
// scores are read live from data.js (the latest life_snapshot, refilled in place); S keeps only what the screen is doing
const FAM_OF = Object.fromEntries(ASPECTS.map((a) => [a.id, a.fam]));
const ids = IDS;
// spoke angles (degrees, 0 = right, clockwise): each family's three spokes 32° apart, 56° between families, Health on top
const ANG = { body: -122, mind: -90, soul: -58, mission: -2, money: 30, growth: 62, family: 118, romance: 150, friends: 182 };
const VIEW_KEY = 'aos-life:view';
const S = { view: (() => { try { return localStorage.getItem(VIEW_KEY) === 'map' ? 'map' : 'wheel'; } catch { return 'wheel'; } })(), compare: null, focus: null };
const keepView = () => { try { localStorage.setItem(VIEW_KEY, S.view); } catch {} };
const sc = (id) => aspect(id).score;                     // 0-10, or null before he has ever scored
const scoredIds = () => ids.filter((id) => sc(id) != null);
const avgOf = (list) => { const xs = list.filter((id) => sc(id) != null); return xs.length ? xs.reduce((a, id) => a + sc(id), 0) / xs.length : null; };
const avg = () => avgOf(ids);
const fmt1 = (v) => (v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1));
const shown = (v) => (v == null ? '–' : String(v));
// the scoring to compare with: a past snapshot's date (never the latest, which is what the wheel already shows)
const pastSnaps = () => snapshots().slice(0, -1);
const compareSnap = () => (S.compare ? pastSnaps().find((s) => s.date === S.compare) ?? null : null);

// ── today in each app: the app's own summary(). Demo mode keeps the prototype's sample; real mode never borrows it ──
const SAMPLE = {
  body: { line: 'Push day done · protein 62 of 120 g', metric: { v: 62, unit: 'g', label: 'protein of 120 g', p: 0.52 },
    today: [{ text: 'Cardio + core at 19:00', done: false }, { text: 'Protein to 120 g', done: false }, { text: 'Morning gym · push day', done: true }],
    quick: [{ label: 'Start workout', icon: I.dumbbell, act: 'lf-q-workout' }, { label: 'Scan a meal', icon: I.camera, act: 'lf-q-meal' }] },
  mind: { line: 'Screens 2 h 40 m, 20 min under usual · reading at 21:30', metric: { v: 7, unit: 'of 12', label: 'books this year', p: 0.58 },
    today: [{ text: 'Read 20 pages of Atomic Habits', done: false }, { text: 'Evening check-in with Wyn', done: false }],
    quick: [{ label: 'Log reading', icon: I.book, act: 'lf-q-read' }] },
  soul: { line: 'Day 9 · 2 of 4 habits done', metric: { v: 2, unit: 'of 4', label: 'habits today', p: 0.5 }, streak: { n: 9, label: 'Day 9' },
    today: [{ text: 'Evening walk, no phone', done: false }, { text: 'Read before bed', done: false }],
    quick: [{ label: 'Check in', icon: I.check, act: 'lf-q-habit' }] },
  mission: { line: 'The week goal is behind · reel shoot at 18:45', metric: { v: 4, unit: 'of 10', label: 'goals on pace', p: 0.4 },
    today: [{ text: 'Shoot: 1 reel (R1) at 18:45', done: false }, { text: 'Reply to the Atlas ERP call notes', done: false }],
    quick: [{ label: 'Add a goal', icon: I.target, act: 'lf-q-goal' }] },
  money: { line: '₹260 left of today\'s ₹1,500', metric: { v: 260, unit: '₹', label: 'left today', p: 0.17 },
    today: [{ text: 'Log October from the bank statement', done: false }],
    quick: [{ label: 'Add expense', icon: I.plus, act: 'lf-q-expense' }, { label: 'Scan a receipt', icon: I.camera, act: 'lf-q-receipt' }] },
  growth: { line: 'Journal streak 6 days · write by 22:00 to keep it', metric: { v: 6, unit: 'days', label: 'journal streak', p: 0.86 },
    streak: { n: 6, label: 'day journal streak', atRisk: true }, today: [{ text: 'Journal + shut down the day at 22:00', done: false }],
    quick: [{ label: 'Write tonight\'s entry', icon: I.edit, act: 'lf-q-journal' }] },
  family: { line: 'Dinner with Mom and Dad at 20:30', metric: { v: 3, unit: 'h', label: 'together this week', p: 0.5 },
    today: [{ text: 'Dinner at 20:30', done: false }, { text: 'Book the anniversary table by Sunday', done: false }],
    quick: [{ label: 'Log a moment', icon: I.home, act: 'lf-q-family' }] },
  romance: { line: 'One small step this week, when you\'re ready', today: [],
    quick: [{ label: 'Write a private note', icon: I.edit, act: 'lf-q-romance' }] },
  friends: { line: 'Kabir: 12 days · food on Saturday?', metric: { v: 1, unit: 'of 4', label: 'weeks with a friend', p: 0.25 },
    streak: { n: 12, label: 'days since Kabir', atRisk: true }, today: [{ text: 'Message Kabir: food on Saturday?', done: false }],
    quick: [{ label: 'Message Kabir', icon: I.chat, act: 'lf-q-friend' }] },
};
// generic ways in, offered only where the app gives none and the bus has the function (no numbers in them)
const QUICK = {
  body: [['Start workout', I.dumbbell, 'lf-q-workout', 'startWorkout'], ['Scan a meal', I.camera, 'lf-q-meal', 'scan']],
  mind: [['Log reading', I.book, 'lf-q-read', 'logReading']], soul: [['Check in', I.check, 'lf-q-habit', 'openAspect']],
  mission: [['Add a goal', I.target, 'lf-q-goal', 'addGoal']],
  money: [['Add expense', I.plus, 'lf-q-expense', 'logExpense'], ['Scan a receipt', I.camera, 'lf-q-receipt', 'scan']],
  growth: [['Write tonight\'s entry', I.edit, 'lf-q-journal', 'writeJournal']], family: [['Log a moment', I.home, 'lf-q-family', 'logFamily']],
  romance: [['Write a private note', I.edit, 'lf-q-romance', 'logRomance']], friends: [['Log time with a friend', I.chat, 'lf-q-friend', 'logFriends']],
};
// the app's live summary; its line only when the app wrote one (the aspect's built-in line is the prototype's sample)
function sum(id) {
  const s = { ...summary(id) };
  if (DEMO_MODE) {
    const d = SAMPLE[id];
    if (!s.line || s.line === aspect(id).line) s.line = d.line;
    if (!s.metric) s.metric = d.metric;
    if (!s.today) s.today = d.today;
    if (!s.quick?.length) s.quick = d.quick;
    return s;
  }
  const def = aspectDef(id);
  s.live = !!def?.summary && !!s.line && s.line !== aspect(id).line;
  if (!s.live) {
    const l = latest();
    s.line = sc(id) == null ? 'Not scored yet' : `Scored ${sc(id)} of 10${l ? ` on ${l.label}` : ''}`;
    if (!def?.summary) { delete s.metric; delete s.today; delete s.streak; }
  }
  if (!s.quick?.length) s.quick = (QUICK[id] ?? []).filter((q) => has(q[3])).map(([label, icon, act]) => ({ label, icon, act }));
  return s;
}
const needs = (s) => !!(s.streak?.atRisk || s.flag);

// a metric as a short figure for a ring: "4h 10m", "₹260", "3/8", "58 g"
const OF = /^(?:of\s*|\/\s*)(\d+)$/i;
const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
function metricFig(m) {
  if (!m) return { big: '', small: '', text: '' };
  const u = String(m.unit ?? '').trim(); const v = Number(m.v);
  const of = m.of ?? u.match(OF)?.[1];
  let big, small = '', word = '';
  if (m.text) big = m.text;
  else if (u === 'h') big = fmtMins(Math.round(v * 60));
  else if (/^(m|min|mins)$/.test(u)) big = fmtMins(Math.round(v));
  else if (u === '₹') big = `₹${Math.round(v).toLocaleString('en-IN')}`;
  else if (of != null) { big = `${v}/${of}`; if (m.of != null && u) word = u; }
  else { big = v.toLocaleString('en-IN'); if (u.length <= 2) small = u; else word = u; }
  return { big, small, text: [`${big}${small ? ` ${small}` : ''}`, word, m.label].filter(Boolean).join(' ') };
}

// one line: what needs him most. The two lowest spokes, and the first concrete step among them
// the next step comes from those apps' own "today", so the line never disagrees with the app it points at
function needsLine() {
  const list = scoredIds();
  if (!list.length) return `Score the nine parts of your life once; ${esc(AGENT.name)} keeps the wheel honest from what your apps log.`;
  const order = [...list].sort((a, b) => sc(a) - sc(b) || (needs(sum(b)) - needs(sum(a))) || ids.indexOf(a) - ids.indexOf(b));
  const [a, b] = order;
  const pick = [a, b].filter(Boolean).map((id) => [id, (sum(id).today ?? []).find((t) => !t.done)]).find(([, t]) => t);
  const t = pick?.[1].text.trim().replace(/[:;,]$/, '');
  const step = pick ? `Next for ${aspect(pick[0]).name}: ${t}${/[.?!]$/.test(t) ? '' : '.'}` : '';
  const who = b ? `<b>${esc(aspect(a).name)}</b> and <b>${esc(aspect(b).name)}</b> need you most.` : `<b>${esc(aspect(a).name)}</b> needs you most.`;
  return `${who}${step ? ` ${esc(step)}` : ''}`;
}

// ── the wheel ─────────────────────────────────────────────────────────
// geometry in cqw (1% of the wheel's width): hub 8.4, spokes from 10.6 to 31.6 (21 = a score of 10), labels at 34.6
const R0 = 10.6, LEN = 21, RL = 34.8;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const vOf = (id) => ((sc(id) ?? 0) / 10).toFixed(3);
function wheelHtml() {
  const cmp = compareSnap();
  const old = (id) => (cmp ? cmp.scores?.[id] ?? null : null);
  const arms = ids.map((id, i) => {
    const o = old(id);
    return `<span class="lf-w-arm${sc(id) == null ? ' none' : ''}" data-id="${id}" data-f="${FAM_OF[id]}" style="--a:${ANG[id]}deg;--v:${vOf(id)};--d:${i * 38}ms;--ra:var(--${id}-a);--rb:var(--${id}-b);--rc:var(--${id})">
      <i class="lf-w-groove"></i><i class="lf-w-light"></i><i class="lf-w-bar"></i>${o != null ? `<i class="lf-w-tick" style="--o:${(o / 10).toFixed(3)}"></i>` : ''}</span>`;
  }).join('');
  const labels = ids.map((id) => {
    const t = ANG[id] * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    const x = 50 + RL * c, y = 50 + RL * s;
    const cx = clamp(c * 1.7, -1, 1), cy = clamp(s * 1.7, -1, 1);
    const tx = -50 + 50 * cx, ty = -50 + 50 * cy;
    const sm = sum(id); const o = old(id); const v = sc(id);
    const delta = o == null || v == null ? '' : v > o ? `, up from ${o}` : v < o ? `, down from ${o}` : ', unchanged';
    const al = cx > 0.5 ? 'l' : cx < -0.5 ? 'r' : 'c';
    return `<button class="lf-w-lab ${al}" data-act="aspect-open" data-id="${id}" data-lf-peek="${id}" data-f="${FAM_OF[id]}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%;--tx:${tx.toFixed(1)}%;--ty:${ty.toFixed(1)}%;--px:${(-6 * cx).toFixed(1)}px;--py:${(-6 * cy).toFixed(1)}px"
      aria-label="${esc(aspect(id).name)}, ${v == null ? 'not scored' : `${v} of 10`}${delta}. ${esc(sm.line ?? '')}">
      <span class="lf-w-n">${needs(sm) ? '<i class="lf-w-need" aria-hidden="true"></i>' : ''}${esc(aspect(id).name)}</span><b class="met lf-w-s" data-lf-roll="${id}">${shown(v)}</b></button>`;
  }).join('');
  // the rim (a score of 10) is three arcs, one per family; the hairline circle inside is a score of 5
  const arc = (a0, a1, r) => { const p = (a) => [50 + r * Math.cos(a * Math.PI / 180), 50 + r * Math.sin(a * Math.PI / 180)]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  const rims = FAM_ORDER.map((f) => { const a = famIds(f).map((id) => ANG[id]); return `<path d="${arc(Math.min(...a) - 13, Math.max(...a) + 13, R0 + LEN + 0.15)}" class="lf-w-rim"/>`; }).join('');
  // a wedge per aspect: tap anywhere on its spoke to open the app, hold to peek
  const wedge = (id) => { const a = ANG[id], h = 16, r0 = 9, r1 = 33.5; const p = (ang, r) => `${(50 + r * Math.cos(ang * Math.PI / 180)).toFixed(2)} ${(50 + r * Math.sin(ang * Math.PI / 180)).toFixed(2)}`; return `<path d="M${p(a - h, r0)}L${p(a - h, r1)}A${r1} ${r1} 0 0 1 ${p(a + h, r1)}L${p(a + h, r0)}A${r0} ${r0} 0 0 0 ${p(a - h, r0)}Z" data-act="aspect-open" data-id="${id}" data-lf-peek="${id}" aria-hidden="true"/>`; };
  const a = avg();
  return `<div class="lf-w" role="group" aria-label="Life wheel, ${a == null ? 'not scored yet' : `${fmt1(a)} of 10 on average`}"${S.focus ? ` data-focus="${S.focus}"` : ''}>
    <svg class="lf-w-grid" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="${R0 + LEN / 2}" class="lf-w-five"/>${rims}</svg>
    ${arms}
    <svg class="lf-w-hit" viewBox="0 0 100 100">${ids.map(wedge).join('')}</svg>
    <button class="lf-w-hub" data-act="lf-brain" aria-label="Open your Brain">${I.graph}<span>Brain</span></button>
    ${labels}
  </div>`;
}

// the rolling figures need the motion kit's stylesheet (css/motion.css); without it the numbers simply change
const motionCss = () => [...document.styleSheets].some((s) => /\/motion\.css(\?|$)/.test(s.href ?? ''));
// spokes grow out from the hub to their score (or from where they were, to where they are now)
function drawWheel(root, from = null) {
  const w = root && $('.lf-w', root); if (!w) return;
  const arms = $$('.lf-w-arm', w);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  clearTimeout(w._t);
  w.classList.remove('go', 'bloom', 'ink');
  const start = (id) => (from ? (from[id] ?? 0) / 10 : 0);
  arms.forEach((a) => a.style.setProperty('--rp', reduced ? a.style.getPropertyValue('--v') : String(start(a.dataset.id))));
  // the figures roll from where they stood (motion.js), in step with the spokes
  if (from && !reduced && motionCss()) $$('[data-lf-roll]', w).forEach((b) => { const id = b.dataset.lfRoll; if (sc(id) != null && from[id] != null && from[id] !== sc(id)) { b.innerHTML = rollHTML(from[id]); requestAnimationFrame(() => requestAnimationFrame(() => roll(b, sc(id)))); } });
  if (reduced) return;
  w.getBoundingClientRect();
  requestAnimationFrame(() => {
    w.classList.add('go', 'bloom', 'ink');
    arms.forEach((a) => a.style.setProperty('--rp', a.style.getPropertyValue('--v')));
    w._t = setTimeout(() => w.classList.remove('bloom'), 2300);
  });
}

// the three families under the wheel: their names, their aspects' colours and their average. Tap one to bring it forward
function famsHtml() {
  return `<div class="lf-fams" role="group" aria-label="Families">${FAM_ORDER.map((f) => `
    <button class="lf-fam${S.focus === f ? ' on' : ''}" data-act="lf-fam" data-f="${f}" aria-pressed="${S.focus === f}" aria-label="${esc(FAMILIES[f])}, ${avgOf(famIds(f)) == null ? 'not scored' : `${fmt1(avgOf(famIds(f)))} on average`}">
      <span class="lf-fam-top"><span class="lf-fam-dots" aria-hidden="true">${famIds(f).map((id) => `<i style="--c:var(--${id})"></i>`).join('')}</span><b class="met">${fmt1(avgOf(famIds(f)))}</b></span>
      <span class="lf-fam-n">${esc(FAMILIES[f])}</span>
    </button>`).join('')}</div>`;
}

function compareHtml() {
  const past = pastSnaps();
  if (!past.length) return latest() ? `<div class="lf-cmp"><span class="lf-cmp-l"><i class="lf-tick" aria-hidden="true"></i>Score again to compare with ${esc(latest().label)}</span></div>` : '';
  const chips = past.slice(-4).reverse().map((s) => `<button class="chip sm${S.compare === s.date ? ' on' : ''}" data-act="lf-compare" data-d="${s.date}" aria-pressed="${S.compare === s.date}">${esc(s.label)}</button>`).join('');
  return `<div class="lf-cmp"><span class="lf-cmp-l"><i class="lf-tick" aria-hidden="true"></i>Compare with</span><div class="chips lf-cmp-chips">${chips}</div></div>`;
}

function scoreHtml() {
  const r = rhythm();
  const lead = r.none ? 'Score your wheel' : r.days === 0 ? 'Score again' : 'Score today';
  const foot = r.none ? `${esc(AGENT.name)} drafts it from your apps; you set the final numbers.`
    : r.days === 0 ? `Scored today. ${esc(AGENT.name)} asks again in ${RESCORE_DAYS} days.`
    : `Last scored ${esc(r.label)}, ${esc(r.ago)}. ${esc(AGENT.name)} has a draft from your apps.`;
  return `<div class="lf-scorecta${r.due && !r.none ? ' due' : ''}">
    <button class="btn primary block" data-act="lf-score">${lead}</button>
    <p class="foot lf-scored">${r.due && !r.none ? '<i class="lf-need" aria-hidden="true"></i>' : ''}${foot}</p>
  </div>`;
}

// ── today in each app ─────────────────────────────────────────────────
function appRow(id) {
  const s = sum(id); const a = aspect(id);
  const m = s.metric;
  const r = m && m.p != null ? ring(m.p, id, 30, 4.2, { label: metricFig(m).text }) : `<span class="lf-app-sc met${sc(id) == null ? ' none' : ''}">${shown(sc(id))}</span>`;
  return `<button class="row ic lf-app" data-act="aspect-open" data-id="${id}" data-lf-peek="${id}">
    ${aspectTile(id)}
    <span class="rbody"><span class="rtitle">${esc(a.name)}</span><span class="lf-app-l${s.live === false ? ' quiet' : ''}">${needs(s) ? '<i class="lf-need" aria-hidden="true"></i>' : ''}${esc(s.line ?? '')}</span></span>
    ${r}${I.chevR}</button>`;
}
function appsHtml() {
  return FAM_ORDER.map((f) => `<div class="sh lf-sh"><h2>${esc(FAMILIES[f])}</h2></div><div class="group lf-apps">${famIds(f).map(appRow).join('')}</div>`).join('');
}

// next Sunday (today when it is Sunday): the weekly review's day
function reviewDay() {
  const t = clock.today(); const dow = clock.dparts(t).dow;
  return dow === 0 ? 'Today' : `Sunday ${shortDate(clock.addDays(t, 7 - dow))}`;
}
function brainHtml() {
  // the Brain's own counts, when the Brain area provides them (no sample numbers here)
  let st = null; try { st = has('brainStats') ? api.brainStats() : null; } catch {}
  const onPace = GOALS.filter((g) => g.verdict === 'On pace').length;
  return `<div class="sh lf-sh"><h2>Brain</h2>${st?.notes != null ? `<span class="sh-count">${st.notes}</span>` : ''}</div>
    <div class="group">
      <button class="row ic" data-act="lf-brain"><span class="tile lf-brain-t">${I.graph}</span><span class="rbody"><span class="rtitle">Everything you and ${esc(AGENT.name)} know</span><span class="rmeta">${st?.filedToday != null ? `${esc(AGENT.name)} filed ${st.filedToday} thing${st.filedToday === 1 ? '' : 's'} today` : 'Notes, people and links, filed by aspect'}</span></span>${I.chevR}</button>
      <button class="row ic" data-act="lf-inbox"><span class="tile">${I.inbox}</span><span class="rbody"><span class="rtitle">Inbox</span><span class="rmeta">Shared or captured, waiting to be filed</span></span>${st?.inbox != null ? `<span class="lf-count met">${st.inbox}</span>` : ''}${I.chevR}</button>
    </div>
    <div class="sh lf-sh"><h2>Plan and review</h2></div>
    <div class="group">
      <button class="row ic" data-act="lf-review">${aspectTile('growth')}<span class="rbody"><span class="rtitle">Weekly review</span><span class="rmeta">${esc(reviewDay())} · in Growth</span></span>${I.chevR}</button>
      <button class="row ic" data-act="lf-goals">${aspectTile('mission')}<span class="rbody"><span class="rtitle">Goals</span><span class="rmeta">${GOALS.length ? `${onPace} of ${GOALS.length} on pace` : 'No goals yet'} · in Mission</span></span>${I.chevR}</button>
    </div>`;
}

function wheelView() {
  return `<div class="lf-hero">${wheelHtml()}</div>${famsHtml()}${compareHtml()}${scoreHtml()}${appsHtml()}${brainHtml()}`;
}

// ── the page ──────────────────────────────────────────────────────────
let PAGE = null;
const lifePage = () => (PAGE?.isConnected ? PAGE : null);
function viewHtml() { return S.view === 'map' ? mapView() : wheelView(); }
function renderView(page, { draw = true, from = null } = {}) {
  const v = page && $('#lfView', page); if (!v) return;
  if (S.view !== 'map') unmountMap();
  v.innerHTML = viewHtml();
  v.dataset.view = S.view;
  wireSegs(v);
  $('#lfNeeds', page).innerHTML = needsLine();
  if (S.view === 'map') requestAnimationFrame(() => mountMap(page, { immerse: draw }));
  if (draw) { pulse(v); if (S.view === 'wheel') drawWheel(v, from); }
}
// the data moved (a sync, another screen's edit, the day turned): redraw in place, no entrance
function redraw(why) {
  const p = lifePage(); if (!p) return;
  if (S.view === 'map') { refreshMap(p); $('#lfNeeds', p).innerHTML = needsLine(); return; }
  const sc0 = $('#lfScroll', p)?.scrollTop;
  renderView(p, { draw: false });
  $$('.lf-w-arm', p).forEach((a) => a.style.setProperty('--rp', a.style.getPropertyValue('--v')));
  $('.lf-w', p)?.classList.add('go');
  if (sc0 != null) $('#lfScroll', p).scrollTop = sc0;
  if (why === 'boot' || why === 'server' || why === 'synced') planReminder();
}

registerTab('life', {
  title: 'Life',
  render(page) {
    PAGE = page;
    page.classList.add('lf-page');
    page.innerHTML = `${topbar({
      title: 'Life',
      right: `<button class="gbtn chrome icon" data-act="lf-ask" aria-label="Ask ${esc(AGENT.name)} about your life">${I.sparkle}</button>
              <button class="gbtn chrome icon avatar" data-act="account" aria-label="Account">${esc(ME.initial || 'V')}</button>`,
    })}<div class="scroll" id="lfScroll">
      <header class="phead lf-head"><h1 class="lt">Life</h1><p class="sub lf-needs" id="lfNeeds">${needsLine()}</p></header>
      <div class="pad lf-segwrap">${seg('lf-view', [['wheel', 'Wheel'], ['map', 'Map']], S.view)}</div>
      <div id="lfView" class="lf-view" data-view="${S.view}">${viewHtml()}</div>
    </div>`;
    page.addEventListener('change', (e) => {
      if (!e.target.closest('[data-seg="lf-view"]')) return;
      S.view = e.detail; keepView();
      // the new view starts at its top: the switch stays where your thumb is
      const sc0 = $('#lfScroll', page), sw = $('.lf-segwrap', page);
      const top = sw.offsetTop - $('.topbar', page).offsetHeight - 8;
      if (sc0.scrollTop > top) sc0.scrollTop = top;
      renderView(page);
      const v = $('#lfView', page); v.classList.remove('lf-swap'); void v.offsetWidth; v.classList.add('lf-swap');
    });
    requestAnimationFrame(() => (S.view === 'map' ? mountMap(page) : drawWheel(page)));
    planReminder();
  },
  // the apps keep moving while you're elsewhere: re-read their summaries, and the wheel draws in again
  onShow(page) { renderView(page, { draw: false }); if (S.view === 'wheel') drawWheel(page); },
});
const REDRAW = new Set(['boot', 'local', 'server', 'rename', 'synced', 'day']);
document.addEventListener('data-changed', (e) => { const why = e.detail?.why; if (REDRAW.has(why) && lifePage() && currentTab() === 'life') redraw(why); });
document.addEventListener('aspect-registered', () => { if (currentTab() === 'life' && S.view === 'wheel') redraw('aspect'); });
// an app's numbers changed (detail { id }): its row, peek line and "needs you most" follow; coalesced to one redraw a frame
let sumRaf = 0;
document.addEventListener('aspect-summary', () => { if (sumRaf || currentTab() !== 'life' || !lifePage()) return; sumRaf = requestAnimationFrame(() => { sumRaf = 0; if (S.view === 'wheel') redraw('aspect'); else { const p = lifePage(); if (p) $('#lfNeeds', p).innerHTML = needsLine(); } }); });
onAreaAspects((why) => { const p = lifePage(); if (!p) return; if (S.view === 'map') refreshMap(p); if (why === 'refused') toast('The PC refused that link; the map is back as it was'); });

export function openLife(view) {
  if (view === 'wheel' || view === 'map') { S.view = view; keepView(); }
  // from anywhere, including a page pushed over Life: land on the tab itself
  if (currentTab() !== 'life' || $('#stack')?.children.length) setTab('life');
  else { const p = lifePage(); if (p) { const sg = $('[data-seg="lf-view"]', p); $$('button', sg).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === S.view))); sg?._place?.(); renderView(p); } }
  if (view === 'score') requestAnimationFrame(() => openScore());
}
provide('openLife', openLife);

// ── actions ───────────────────────────────────────────────────────────
on('lf-brain', () => api.openBrain());
on('lf-inbox', () => api.openBrain('inbox'));
on('lf-ask', () => api.askAgent('', { about: 'life' }));
on('lf-review', () => api.openReview());
on('lf-goals', () => (has('openHorizon') ? api.openHorizon('week') : api.openAspect('mission')));
on('lf-fam', (el) => {
  const p = lifePage(); if (!p) return;
  const f = el.dataset.f; S.focus = S.focus === f ? null : f; haptic(5);
  const w = $('.lf-w', p); if (w) { if (S.focus) w.dataset.focus = S.focus; else delete w.dataset.focus; }
  $$('.lf-fam', p).forEach((b) => { const on = b.dataset.f === S.focus; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
});
on('lf-compare', (el) => {
  const d = el.dataset.d; S.compare = S.compare === d ? null : d; haptic(5);
  const p = lifePage(); if (!p) return;
  const hero = $('.lf-hero', p); hero.innerHTML = wheelHtml();
  $$('.lf-w-arm', hero).forEach((a) => a.style.setProperty('--rp', a.style.getPropertyValue('--v')));
  $('.lf-w', hero).classList.add('go');
  const cmp = $('.lf-cmp', p); if (cmp) cmp.outerHTML = compareHtml();
});
// the map
on('lf-map-f', (el) => { const p = lifePage(); if (p) setFilter(el.dataset.k, p); });
on('lf-map-sel', (el) => mapSelect(el.dataset.k, { scroll: true }));
on('lf-map-clear', () => mapSelect(null));
on('lf-map-tasks', (el) => { mapState.tasks = !mapState.tasks; el.classList.toggle('on', mapState.tasks); el.setAttribute('aria-pressed', String(mapState.tasks)); const p = lifePage(); if (p) { refreshMap(p, { reheat: 0.6 }); mapState.graph?.zoomTo('fit'); } toast(mapState.tasks ? 'Open tasks on the map' : 'Tasks hidden'); });
on('lf-map-fit', () => { mapState.graph?.focus(null); mapState.graph?.zoomTo('fit'); mapSelect(null); });
on('lf-map-two', () => { const p = lifePage(); if (p) highlightTwo(p); });
on('lf-map-gaps', () => { const p = lifePage(); if (p) highlightGaps(p); });
on('lf-unlink', (el) => { const p = lifePage(); if (p) doUnlink(el.dataset.k, el.dataset.a, p); });
on('lf-gap-goal', (el) => api.addGoal({ aspect: el.dataset.id, aspects: [el.dataset.id] }));
on('lf-open-goal', (el) => api.openGoal(el.dataset.id));
on('lf-open-project', (el) => api.openProject(el.dataset.id));
on('lf-open-person', (el) => api.openPerson(el.dataset.id));
on('lf-open-task', (el) => api.openTask(el.dataset.id));
// links the older screens still use: they now open the apps that own them
on('life-open', () => openLife());
on('life-goals', () => { closePeek(); has('openHorizon') ? api.openHorizon('week') : api.openAspect('mission'); });
on('life-review', () => api.openReview());
on('goal-open', (el) => api.openGoal(el.dataset.id));
on('goal-add', () => api.addGoal());
on('life-score', () => openScore());
on('lf-score', () => openScore());

// quick actions (the apps' own summaries bring their own acts)
const Q = {
  'lf-q-workout': () => api.startWorkout(), 'lf-q-meal': () => api.scan('food'), 'lf-q-read': () => api.logReading(),
  'lf-q-habit': () => api.openAspect('soul'), 'lf-q-goal': () => api.addGoal(), 'lf-q-expense': () => api.logExpense(),
  'lf-q-receipt': () => api.scan('receipt'), 'lf-q-journal': () => api.writeJournal(), 'lf-q-family': () => api.logFamily(),
  'lf-q-romance': () => api.logRomance(), 'lf-q-friend': () => (DEMO_MODE ? api.logFriends({ person: 'kabir' }) : api.logFriends()),
};
for (const [k, fn] of Object.entries(Q)) on(k, () => { closePeek(); fn(); });

// ── hold an aspect to peek: its summary, today's items and one or two quick actions ──
// Soul's streak is private: on a shared screen it is only ever "Day 9", never what it counts
const streakText = (id, st) => (id === 'soul' ? `Day ${st.n}` : st.private || st.text ? (st.text ?? `Day ${st.n}`) : st.label?.startsWith('Day') ? st.label : `${st.n} ${st.label ?? ''}`.trim());
let PEEK = null;
function lfPeek(id) {
  const s = sum(id); const a = aspect(id); PEEK = id;
  const m = s.metric;
  const fig = metricFig(m);
  const big = m ? ring(m.p ?? 0, 'as', 72, 6.5, { inner: `<b class="met lf-pk-v">${esc(fig.big)}${fig.small ? `<small>${esc(fig.small)}</small>` : ''}</b>`, label: fig.text })
    : sc(id) != null ? ring(sc(id) / 10, 'as', 72, 6.5, { inner: `<b class="met lf-pk-v">${sc(id)}<small>/10</small></b>`, label: `${sc(id)} of 10` }) : '';
  const today = (s.today ?? []).slice(0, 3);
  const check = (t) => `<span class="check${t.done ? ' done' : ''}" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg></span><span class="rbody"><span class="rtitle">${esc(t.text)}</span></span>`;
  const l = latest();
  peek(`<div class="pk lf-pk" data-aspect="${id}">
      <div class="lf-pk-h">${aspectTile(id)}<div class="lf-pk-t"><p class="t1">${esc(a.name)}</p><p class="foot">${esc(FAMILIES[a.fam])} · ${sc(id) == null ? 'not scored yet' : `scored ${sc(id)} of 10${l ? ` on ${esc(l.label)}` : ''}`}</p></div>${big}</div>
      <p class="lf-pk-line">${esc(s.live === false ? `Nothing from the ${a.name} app yet.` : s.line ?? '')}</p>
      ${today.length ? `<div class="group lf-pk-today">${today.map((t) => (t.act ? `<button class="row lf-pk-row${t.done ? ' is-done' : ''}" data-act="${esc(t.act)}" data-id="${esc(t.id ?? '')}">${check(t)}</button>` : `<div class="row lf-pk-row${t.done ? ' is-done' : ''}">${check(t)}</div>`)).join('')}</div>` : ''}
      ${s.streak ? `<p class="foot lf-pk-streak${s.streak.atRisk ? ' risk' : ''}">${I.flame}<span>${esc(streakText(id, s.streak))}${s.streak.atRisk ? ' · at risk today' : ''}</span></p>` : ''}
    </div>`,
  [...(s.quick ?? []).slice(0, 2).map((q) => [esc(q.label), q.icon ?? I.plus, q.act]), [`Open ${esc(a.name)}`, I.chevR, 'lf-peek-open']]);
}
on('lf-peek-open', () => { closePeek(); if (PEEK) api.openAspect(PEEK); });
onHold($('#phone'), '[data-lf-peek]', (el) => lfPeek(el.dataset.lfPeek));
// a peek's menu closes the peek once its action has run (the apps' own quick actions don't know they were in one)
$('#peek')?.addEventListener('click', (e) => { if (e.target.closest('.peek-menu button')) setTimeout(closePeek, 0); });

// ── score sheet: nine sliders in their families, the agent's draft one tap away ──
let DRAFT = null;
function openScore() {
  DRAFT = draft();
  const r = rhythm();
  const row = (id) => {
    const v = sc(id) ?? DRAFT[id].v; const { v: d, why } = DRAFT[id];
    return `<label class="row lf-sl" data-id="${id}" style="--p:${v * 10}%;--qn:${d / 10};--c:var(--${id})">
      ${aspectTile(id)}
      <span class="lf-sl-b"><span class="lf-sl-top"><span class="lf-sl-name">${esc(aspect(id).name)}</span><span class="lf-sl-v met" data-v>${v}</span></span>
        <span class="lf-sl-track"><input type="range" min="0" max="10" step="1" value="${v}" data-id="${id}" aria-label="${esc(aspect(id).name)}, 0 to 10" /><i class="lf-sl-wyn" aria-hidden="true"></i></span>
        <span class="lf-sl-why">${esc(AGENT.name)}: ${d}${d !== v ? ` · ${esc(why)}` : sc(id) == null ? ` · ${esc(why)}` : `, same as now${DRAFT[id].signals.length ? ` · ${esc(why)}` : ''}`}</span></span>
    </label>`;
  };
  const signals = Object.values(DRAFT).reduce((a, d) => a + d.signals.length, 0);
  openSheet({
    title: 'Score your wheel', sub: `${r.none ? 'Your first scoring.' : `Last scored ${r.label}.`} 0 is falling apart, 10 is thriving.`, cls: 'lf-score-sheet', large: true,
    body(b) {
      b.innerHTML = `<div class="pad lf-draft"><button class="btn block" data-act="lf-draft">${I.sparkle}Use ${esc(AGENT.name)}'s draft</button>
          <p class="foot">${signals ? `She read ${signals} signal${signals === 1 ? '' : 's'} from your tasks, goals, calendar and apps${r.none ? '' : ` since ${esc(r.label)}`}. The ticks on each track are hers.` : `Your apps haven't logged anything she can read yet, so her draft keeps your last scores. The ticks on each track are hers.`}</p></div>
        ${FAM_ORDER.map((f) => `<div class="sh lf-sh"><h2>${esc(FAMILIES[f])}</h2></div><div class="group lf-sliders">${famIds(f).map(row).join('')}</div>`).join('')}
        <div class="pad lf-sl-save"><button class="btn primary block" data-act="lf-score-save">Save scores</button></div>`;
      b.addEventListener('input', (e) => {
        const rg = e.target.closest('input[type=range]'); if (!rg) return;
        const l = rg.closest('.lf-sl'); l.style.setProperty('--p', `${rg.value * 10}%`); $('[data-v]', l).textContent = rg.value;
        haptic(3);
      });
    },
  });
}
on('lf-draft', (el) => {
  const sh = el.closest('.sheet'); if (!DRAFT) DRAFT = draft();
  $$('input[type=range]', sh).forEach((r, i) => setTimeout(() => {
    const v = DRAFT[r.dataset.id].v; r.value = v;
    const l = r.closest('.lf-sl'); l.style.setProperty('--p', `${v * 10}%`); $('[data-v]', l).textContent = v; l.classList.add('lf-sl-set');
    haptic(3);
  }, i * 45));
  el.innerHTML = `${I.check}Draft applied`; el.disabled = true;
});
on('lf-score-save', (el) => {
  const sh = el.closest('.sheet');
  const prev = Object.fromEntries(ids.map((id) => [id, sc(id)]));
  const was = latest();
  const next = Object.fromEntries($$('input[type=range]', sh).map((r) => [r.dataset.id, +r.value]));
  if (DEMO_MODE) demoScored(prev);
  // one real snapshot for today (life_snapshots, source "app"): setScore merges each into it, svc/sync sends it, offline first
  for (const id of ids) setScore(id, next[id]);
  S.compare = was && was.date !== clock.today() ? was.date : S.compare;
  closeSheet(sh);
  const moved = ids.filter((id) => prev[id] != null && next[id] !== prev[id]);
  const p = lifePage();
  // the wheel comes back into view, and each spoke grows from where it was to where it is now
  if (p) { S.view = 'wheel'; keepView(); const sg = $('[data-seg="lf-view"]', p); $$('button', sg).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === 'wheel'))); sg?._place?.(); $('#lfScroll', p).scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); renderView(p, { from: prev }); }
  document.dispatchEvent(new CustomEvent('life-changed'));
  planReminder();
  haptic(12);
  toast(!was ? 'Wheel scored · your first snapshot'
    : moved.length ? `Wheel scored · ${moved.slice(0, 3).map((id) => `${aspect(id).name} ${next[id] > prev[id] ? '+' : '−'}${Math.abs(next[id] - prev[id])}`).join(', ')}`
    : `Wheel scored · no change since ${was.label}`);
});

// ── the card at the top of More: the wheel in miniature ──
function miniWheel(size = 112) {
  const c = size / 2, r0 = size * 0.13, L = size * 0.32;
  const sp = ids.map((id) => { const t = ANG[id] * Math.PI / 180; const r1 = r0 + L * ((sc(id) ?? 0) / 10); const g = (r) => `${(c + r * Math.cos(t)).toFixed(1)} ${(c + r * Math.sin(t)).toFixed(1)}`;
    return `<path d="M${g(r0)}L${g(r0 + L)}" class="lfm-g" style="--c:var(--${id})"/>${sc(id) ? `<path d="M${g(r0)}L${g(Math.max(r1, r0 + 0.1))}" class="lfm-s" style="--c:var(--${id})"/>` : ''}`; }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${c}" cy="${c}" r="${(r0 - 3).toFixed(1)}" class="lfm-hub"/>${sp}</svg>`;
}
export function lifeCard() {
  const onPace = GOALS.filter((g) => g.verdict === 'On pace').length;
  const order = [...scoredIds()].sort((a, b) => sc(a) - sc(b));
  const r = rhythm(); const a = avg();
  const low = order.length >= 2 ? `${aspect(order[0]).name} and ${aspect(order[1]).name} need you most` : 'Score your wheel to see what needs you';
  return `<button class="lfm surface" data-act="life-open" aria-label="Life. ${a == null ? 'Not scored yet' : `Wheel average ${fmt1(a)} of 10`}. ${esc(low)}.">
    <span class="lfm-wheel" aria-hidden="true">${miniWheel()}</span>
    <span class="lfm-body">
      <span class="lfm-t">Life</span>
      <span class="lfm-l">${a == null ? 'Not scored yet' : `<b class="met">${fmt1(a)}</b> average of 10`}</span>
      <span class="lfm-s">${esc(low)}</span>
      <span class="lfm-x">${r.none ? 'Never scored' : r.days === 0 ? 'Scored today' : `Scored ${esc(r.ago)}`} · ${GOALS.length ? `${onPace} of ${GOALS.length} goals on pace` : 'no goals yet'}</span>
    </span>
    ${I.chevR}
  </button>`;
}

// Hours as one stacked bar, and a legend that flows: every area's whole name, its hours beside it (More uses it)
export function stackBar(rows) {
  const tot = rows.reduce((a, r) => a + r[1], 0);
  return `<div class="stackbar" role="img" aria-label="${esc(rows.map(([s, h]) => `${area(s).name} ${h} hours`).join(', '))}">${rows.map(([s, h]) => `<i style="flex:${h};background:${area(s).color}"></i>`).join('')}</div>
    <div class="stack-legend">${rows.map(([s, h]) => `<span><i class="dot" style="--c:${area(s).color}"></i><span class="sl-n">${esc(area(s).name)}</span><b class="num">${h}h</b></span>`).join('')}</div>
    <p class="foot stack-tot"><b>${tot}h</b> planned on the calendar</p>`;
}

// Growth: the journal, the Sunday review, growth over time as a rate of change, the agent's overnight dream, and the
// planning rituals. Owner: the Growth agent (this file, growth-*.js, css/aspects/growth.css).
// The frame (header, tab bar, the round primary action, --as) is the lead's js/aspects.js. Prefix: gro-.
import { $, $$, esc, on, pulse, ring, setRing, toast, haptic, seg, wireSegs } from '../core.js';
import { I } from '../icons.js';
import { registerAspect, aspHead, aspectTile, openAspect, summary as aspectSummary } from '../aspects.js';
import { aspect, AGENT, GOALS, person, addTask, addGoal, dropTask, task as taskOf } from '../data.js';
import { provide, api, has } from '../bus.js';
import {
  TODAY, iso, fromIso, addDays, fmtDay, fmtShort, dow, dowLong, monLong, ENTRIES, entryOn, DAYS, entriesIn2026, STREAK, monthStats,
  PROMPTS, NOTICED, DAY_MOMENTS, WEEK, LEVEL, GROWTH, weekLabel, weekNo, VELOCITY, DRIVERS, POTENTIAL, POT, DREAM, PAST_DREAMS, PAST_REVIEWS, REVIEW, PLAN, moodWord,
  REAL, nowMin, hm, mondayOf, refreshState, answerProposal, putPlan, COL, SETTINGS, SOURCES, aspectName,
} from './growth-data.js';
import { levelChart, wireLevelChart, readout, spark, bullet, constellation, monthGrid, weekRow, moodDot, signed } from './growth-viz.js';
import {
  G, hooks, openComposer, openEntry, openCheckin, openReviewFlow, openPastReview, openPastDream, openPlanPage, openStreak,
  openTableSheet, openAspectTrend, link, photoHtml, fileTargets, BOOT, contentWeek, syncG,
} from './growth-flows.js';
import { native } from '../svc/native-plugins.js';
import { snapshotPart } from '../svc/native.js';
import { registerRoute } from '../svc/route.js';
import * as API from '../svc/api.js';
import { stagger } from '../motion.js';

const monday = () => mondayOf(TODAY);
const left = () => { const m = Math.max(0, 22 * 60 - nowMin()); return m ? `${Math.floor(m / 60)}h ${m % 60}m` : 'no time'; };
const NO_DREAM = { connections: [], gaps: [], slipped: [], proposals: [], read: [], missing: [], from: '04:30', to: '' };
const dreamOrEmpty = () => DREAM ?? NO_DREAM;
const by = (cls = '') => `<span class="gro-by ${cls}"><span class="orb xs" aria-hidden="true"></span>${esc(AGENT.name)}</span>`;
const sh = (title, extra = '') => `<div class="sh"><h2>${title}</h2>${extra}</div>`;
const pendingProposals = () => (DREAM?.proposals ?? []).filter((p) => !G.answered[p.id]).length;

// ═══ TODAY ══════════════════════════════════════════════════════════════
function streakBadge() {
  const n = G.saved ? STREAK.n + 1 : STREAK.n;
  return `<button class="gro-sbadge" data-act="gro-streak" aria-label="${n}-day journal streak. Streak details">
    ${ring(G.saved ? 1 : STREAK.n / 7, 'as', 64, 7, { id: 'groStreakRing', inner: `<span class="gro-sb-in"><b class="met" id="groStreakN">${n}</b><small>${n === 1 ? 'day' : 'days'}</small></span>`, label: `${n}-day streak` })}
  </button>`;
}
function tonightCard() {
  if (G.saved) {
    const t = G.entry;
    return `<section class="gro-tn surface saved" aria-label="Tonight's entry">
      <div class="gro-tn-top">
        <p class="gro-tn-k">Tonight's entry</p>
        <span class="gro-tn-due ok">${I.check}<span>Saved <b class="num">${t.at}</b></span></span>
      </div>
      ${weekRow(monday(), { saved: true })}
      <p class="gro-tn-s">${esc(moodWord(t.p, t.e))} · ${t.words} ${t.words === 1 ? 'word' : 'words'}${(t.photos ?? []).length ? ` · ${t.photos.length} photo${t.photos.length > 1 ? 's' : ''}` : ''}</p>
      <button class="gro-tn-read" data-act="gro-entry" data-date="${iso(TODAY)}"><span class="gro-tn-x">${esc(t.text.slice(0, 180))}${t.text.length > 180 ? '…' : ''}</span></button>
      ${t.filed.length ? `<div class="gro-filed" aria-label="What ${esc(AGENT.name)} filed">
        <p class="gro-filed-h">${REAL ? `It touches ${t.filed.length} ${t.filed.length === 1 ? 'part' : 'parts'} of your life` : `${by()} filed ${t.filed.length} ${t.filed.length === 1 ? 'thing' : 'things'} from it`}</p>
        <div class="gro-filed-l">${t.filed.map(([a, txt, , to], i) => `<button class="gro-fchip" style="--i:${i}" data-act="gro-open" data-to="${to}">${aspectTile(a, 'sm')}<span><b>${esc(aspect(a)?.name ?? 'Brain')}</b>${txt === aspect(a)?.name ? (REAL ? 'Mentioned' : '') : esc(txt)}</span></button>`).join('')}</div>
      </div>` : ''}
      <div class="gro-tn-acts"><button class="btn sm" data-act="gro-write">${I.edit}Add more</button><button class="btn sm" data-act="gro-entry" data-date="${iso(TODAY)}">Read it</button></div>
    </section>`;
  }
  const late = nowMin() >= 21 * 60;
  return `<section class="gro-tn surface" aria-label="Tonight's entry">
    <div class="gro-tn-top">
      <p class="gro-tn-k">Tonight's entry</p>
      <span class="gro-tn-due${late ? ' late' : ''}">${I.clock}<span>${nowMin() >= 22 * 60 ? `Due ${STREAK.saveBy} · <b>still open</b>` : `Due ${STREAK.saveBy} · <b class="num">${left()}</b> left`}</span></span>
    </div>
    ${weekRow(monday())}
    <div class="gro-prs">
      <p class="gro-prs-h">${by()} wrote prompts from your day</p>
      ${PROMPTS.slice(0, G.morePrompts ? 4 : 2).map((p) => `<button class="gro-pr" data-act="gro-prompt" data-id="${p.id}">
        <span class="gro-pr-from"><i class="dot" style="--c:var(--${p.aspect})"></i>${esc(p.from)}</span>
        <span class="gro-pr-q">${esc(p.text)}</span>
      </button>`).join('')}
      ${G.morePrompts || PROMPTS.length <= 2 ? '' : `<button class="gro-pr-more" data-act="gro-prompts-more">${Math.min(2, PROMPTS.length - 2)} more ${PROMPTS.length - 2 === 1 ? 'prompt' : 'prompts'}</button>`}
    </div>
    <div class="gro-tn-acts">
      <button class="btn tint gro-tn-w" style="--c:var(--as-ink)" data-act="gro-write">${I.edit}Write</button>
      <button class="btn" data-act="gro-talk">${I.mic}Talk</button>
      <button class="btn gro-sq" data-act="gro-scanpage" aria-label="Scan a handwritten page">${I.scan}</button>
    </div>
  </section>`;
}
function checkinRow() {
  const list = G.checkins;
  return `<div class="group gro-ci">
    ${list.map((c) => `<div class="row gro-ci-r">${moodDot(c.p, c.e)}<span class="rbody"><span class="rtitle">${esc(moodWord(c.p, c.e))}</span><span class="rmeta"><span class="num">${c.at}</span><span>·</span><span class="ell">${esc(c.note)}</span></span></span></div>`).join('')}
    <button class="row gro-ci-add" data-act="gro-checkin"><span class="gro-ci-plus" aria-hidden="true">${I.plus}</span><span class="rbody"><span class="rtitle">How are you now?</span><span class="rmeta">Two seconds. ${esc(AGENT.name)} reads them on Sunday.</span></span>${I.chevR}</button>
  </div>`;
}
// the day so far, as she saw it: one card per block, with her note on it. Tapping one starts the entry there
function momentsRail() {
  if (!DAY_MOMENTS.length) return `${sh('Your day so far')}<div class="note gro-empty">Nothing on the calendar today. Tonight's prompts come from your tasks and last entries instead.</div>`;
  return `${sh('Your day so far', `<button class="sh-act" data-act="gro-ask" data-q="What did you notice about my day?">Ask ${esc(AGENT.name)}${I.chevR}</button>`)}
  <div class="gro-mo" data-scroll-x role="list" aria-label="Today's moments, with ${esc(AGENT.name)}'s notes">${DAY_MOMENTS.map((m) => `<button class="gro-mo-c${m.now ? ' now' : ''}${m.later ? ' later' : ''}" role="listitem" data-act="gro-moment" data-id="${m.id}" aria-label="${esc(`${m.at} ${m.label}. ${m.note} Write about it`)}">
      <span class="gro-mo-t"><b class="num">${m.at}</b>${m.now ? '<span class="gro-mo-tag now">Now</span>' : m.later ? '<span class="gro-mo-tag">Later</span>' : ''}</span>
      <span class="gro-mo-h"><i class="dot" style="--c:var(--${m.aspect})"></i><span>${esc(m.label)}</span></span>
      <span class="gro-mo-x">${esc(m.note)}</span>
    </button>`).join('')}</div>
  <p class="gro-mo-f"><span class="orb xs" aria-hidden="true"></span>${REAL ? 'Your calendar today. Tap a block to write about it.' : `<b>${esc(AGENT.name)}</b> notes each block. Tap one to write about it.`}</p>`;
}
function dreamDigest() {
  if (!DREAM || DREAM.status === 'running' || (DREAM.status === 'failed' && !DREAM.connections.length) || (!DREAM.connections.length && !DREAM.gaps.length)) {
    const msg = !DREAM ? `${esc(AGENT.name)} dreams at 04:30: she reads your day while you sleep and connects what sits in different apps.` : DREAM.status === 'running' ? 'She is reading your day now.' : DREAM.status === 'failed' ? 'Last night\'s dream didn\'t finish. It runs again tonight.' : 'A quiet night: nothing worth your yes.';
    return `${sh('Last night')}<button class="gro-dd surface" data-act="gro-go" data-s="dream"><span class="gro-dd-top"><span class="gro-dd-body"><span class="gro-dd-k">${I.moon}<span>${DREAM ? 'Last night' : 'Tonight'}</span></span><span class="gro-dd-t">${DREAM?.status === 'running' ? 'Dreaming…' : DREAM ? 'Nothing new' : 'Her first dream'}</span><span class="gro-dd-s">${msg}</span></span></span><span class="gro-dd-p">${I.chevR}</span></button>`;
  }
  const p = pendingProposals();
  return `${sh('Last night', `<span class="sh-count num">${DREAM.from} to ${DREAM.to}</span>`)}
  <button class="gro-dd surface" data-act="gro-go" data-s="dream" aria-label="Last night's dream: ${DREAM.connections.length} connections, ${p} proposals waiting">
    <span class="gro-dd-top">
      <span class="gro-dd-body">
        <span class="gro-dd-k">${I.moon}<span>While you slept, ${esc(AGENT.name)} found</span></span>
        <span class="gro-dd-t">${esc(DREAM.connections[0]?.title ?? DREAM.gaps[0]?.title ?? '')}</span>
        <span class="gro-dd-s">${DREAM.connections.length > 1 ? `and ${DREAM.connections.length - 1} more ${DREAM.connections.length - 1 === 1 ? 'thread' : 'threads'}, ` : ''}${DREAM.gaps.length} ${DREAM.gaps.length === 1 ? 'gap' : 'gaps'} and ${DREAM.slipped.length} ${DREAM.slipped.length === 1 ? 'thing' : 'things'} that slipped</span>
      </span>
      <span class="gro-dd-fig" aria-hidden="true">${constellation(DREAM)}</span>
    </span>
    <span class="gro-dd-p">${p ? `<span class="pill" style="--c:var(--needs-ink)">${p} ${p === 1 ? 'proposal' : 'proposals'} for your yes</span>` : DREAM.proposals.length ? `<span class="pill" style="--c:var(--done)">All answered</span>` : ''}${I.chevR}</span>
  </button>`;
}
function ritualsGroup() {
  const day = PLAN.day, doneN = day.three.filter((t) => t.done).length, of = Math.max(1, day.three.length);
  const wk = WEEK.score != null ? `week so far <b class="num">${WEEK.score}</b>${WEEK.last != null ? `, ${WEEK.score >= WEEK.last ? 'up' : 'down'} ${Math.abs(WEEK.score - WEEK.last)}` : ''}` : 'the numbers gather during the week';
  return `${sh('Rituals')}
  <div class="group gro-rit">
    <button class="row ic" data-act="gro-plan" data-k="day"><span class="tile${day.done ? ' gro-rt-ok' : ''}">${I.sun}</span><span class="rbody"><span class="rtitle">Morning plan</span><span class="rmeta">${day.done ? `<span class="num">Done ${day.done}</span><span>·</span>` : '<span>Not planned yet</span><span>·</span>'}<span>${doneN} of ${day.three.length} done</span></span></span>${ring(doneN / of, 'as', 30, 4, { label: `${doneN} of ${day.three.length} done` })}${I.chevR}</button>
    <button class="row ic" data-act="gro-plan" data-k="evening"><span class="tile">${I.moon}</span><span class="rbody"><span class="rtitle">Evening shutdown</span><span class="rmeta"><span class="num">${day.evening.at}</span><span>·</span><span>5 steps, with tonight's entry</span></span></span>${I.chevR}</button>
    <button class="row ic" data-act="gro-review"><span class="tile">${I.cal}</span><span class="rbody"><span class="rtitle">Sunday review${G.reviewed ? ' · sealed' : ''}</span><span class="rmeta"><span>${esc(WEEK.reviewAt)}</span><span>·</span><span>${wk}</span></span></span>${I.chevR}</button>
  </div>`;
}
function renderToday(el, app) {
  const n = G.saved ? STREAK.n + 1 : STREAK.n;
  const freeze = (k) => k > 0 && k % 7 === 0;
  const sub = G.saved ? `Tonight's entry is in.${freeze(n) ? ' <b>You earned a streak freeze.</b>' : ` <b>${n} ${n === 1 ? 'night' : 'nights'}</b> in a row.`}`
    : n ? `Tonight's entry makes it <b>${n + 1} days</b>${freeze(n + 1) ? ' and earns a streak freeze' : ''}.` : 'Two lines tonight start a streak.';
  el.innerHTML = `
    ${aspHead(app, { title: dowLong(TODAY), sub, right: streakBadge() })}
    <div class="gro-today">
      ${tonightCard()}
      ${momentsRail()}
      ${sh('Check-ins')}
      ${checkinRow()}
      ${dreamDigest()}
      ${ritualsGroup()}
    </div>`;
}

// ═══ JOURNAL ════════════════════════════════════════════════════════════
const J = { y: TODAY.getFullYear(), m: TODAY.getMonth(), filter: 'all', q: '' };
const KIND_ICON = { voice: I.mic, scan: I.scan, typed: I.edit, agent: I.sparkle };
function entryRow(e) {
  const d = fromIso(e.date);
  return `<button class="row gro-er" data-act="gro-entry" data-date="${e.date}">
    <span class="gro-er-d"><small>${dow(d)}</small><b class="met">${d.getDate()}</b></span>
    <span class="rbody">
      <span class="gro-er-t">${esc(e.title)}</span>
      <span class="gro-er-x">${esc(e.text.replace(/\n+/g, ' '))}</span>
      <span class="rmeta gro-er-m"><span>${esc(e.mood && !e.p ? e.mood : moodWord(e.p, e.e))}</span>${e.at ? `<span>·</span><span class="num">${e.at}</span>` : ''}${e.kind !== 'typed' && KIND_ICON[e.kind] ? `<span class="gro-er-k">${KIND_ICON[e.kind]}${e.kind === 'voice' ? (e.len ? `<span class="num">${e.len}</span>` : 'Spoken') : e.kind === 'agent' ? `Told ${esc(AGENT.name)}` : 'Scanned'}</span>` : ''}${e.review ? '<span class="gro-er-k">Review</span>' : ''}${e.late ? '<span class="gro-er-k">Filled in later</span>' : ''}</span>
    </span>
    ${e.photo ? `<span class="gro-er-ph">${photoHtml(e.photo, 'sm')}</span>` : ''}
  </button>`;
}
function journalList() {
  let list = [...Object.values(G.backfilled), ...ENTRIES].sort((a, b) => (a.date < b.date ? 1 : -1));
  if (J.filter === 'voice') list = list.filter((e) => e.kind === 'voice');
  if (J.filter === 'photos') list = list.filter((e) => e.photo);
  if (J.filter === 'reviews') list = list.filter((e) => e.review);
  const q = J.q.trim().toLowerCase();
  if (q) list = list.filter((e) => (e.title + ' ' + e.text).toLowerCase().includes(q) || e.aspects.some((a) => aspect(a).name.toLowerCase().includes(q)));
  const today = G.saved ? [{ ...G.entry, date: iso(TODAY), title: G.entry.title, aspects: (G.entry.filed ?? []).map((f) => f[0]) }] : [];
  if (!q && J.filter === 'all') list = [...today.filter((t) => t.aspects), ...list];
  if (!list.length && REAL && !q && J.filter === 'all') return `<div class="note gro-empty">No entries yet. Tonight's two lines are the first. You can also fill in a missed day from the calendar above.</div>`;
  if (!list.length) return `<div class="note gro-empty">${q ? `Nothing in your journal matches “${esc(J.q)}”. ${esc(AGENT.name)} also searches by meaning: <button class="btn sm" data-act="gro-ask" data-q="${esc(`What did I write about ${J.q}?`)}">Ask her</button>` : 'No entries of this kind yet.'}</div>`;
  const mon = monday(), lastMon = addDays(mon, -7), m0 = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1);
  const groups = REAL
    ? [['This week', (d) => d >= mon], ['Last week', (d) => d >= lastMon && d < mon], [`Earlier in ${monLong(TODAY.getMonth())}`, (d) => d < lastMon && d >= m0], ['Before that', (d) => d < lastMon && d < m0]]
    : [['This week', (d) => d >= addDays(TODAY, -3)], ['Last week', (d) => d >= addDays(TODAY, -10) && d < addDays(TODAY, -3)], ['Earlier in October', (d) => d < addDays(TODAY, -10) && d.getMonth() === 9]];
  const pm = TODAY.getMonth() === 0 ? null : TODAY.getMonth() - 1;
  const sep = pm != null ? monthStats(TODAY.getFullYear(), pm) : { written: 0 };
  const older = !REAL ? `<div class="group gro-elist gro-older"><button class="row ic" data-act="gro-cal-go" data-m="8"><span class="tile">${I.cal}</span><span class="rbody"><span class="rtitle">September</span><span class="rmeta">${sep.written} entries · the 14-day streak</span></span>${I.chevR}</button></div>`
    : pm != null && sep.written ? `<div class="group gro-elist gro-older"><button class="row ic" data-act="gro-cal-go" data-m="${pm}"><span class="tile">${I.cal}</span><span class="rbody"><span class="rtitle">${monLong(pm)}</span><span class="rmeta">${sep.written} ${sep.written === 1 ? 'entry' : 'entries'}</span></span>${I.chevR}</button></div>` : '';
  return groups.map(([label, test]) => {
    const g = list.filter((e) => test(fromIso(e.date)));
    if (!g.length) return '';
    return `<div class="sh gro-jsh"><h2>${label}</h2><span class="sh-count">${g.length}</span></div><div class="group gro-elist">${g.map((e) => (e.text ? entryRow(e) : '')).join('')}</div>`;
  }).join('') + (!q && J.filter === 'all' ? older : '');
}
function calendarCard() {
  const st = monthStats(J.y, J.m);
  const isNow = J.y === TODAY.getFullYear() && J.m === TODAY.getMonth();
  return `<div class="gro-calcard surface">
    <div class="gro-cal-top">
      <button class="btn sm icon" data-act="gro-cal" data-d="-1" aria-label="Previous month" ${J.m <= 0 ? 'disabled' : ''}>${I.chevL}</button>
      <div class="gro-cal-ttl"><b>${monLong(J.m)}</b><small>${st.written} of ${st.upTo} days written${isNow ? ' so far' : ''}</small></div>
      <button class="btn sm icon gro-flip" data-act="gro-cal" data-d="1" aria-label="Next month" ${isNow ? 'disabled' : ''}>${I.chevL}</button>
    </div>
    ${monthGrid(J.y, J.m, { extra: G.backfilled })}
    <div class="gro-cal-key" aria-hidden="true"><span>Lower mood</span><i style="--m:1"></i><i style="--m:2"></i><i style="--m:3"></i><i style="--m:4"></i><i style="--m:5"></i><span>Better</span><span class="gro-cal-key-x"><i class="miss"></i>Missed</span></div>
  </div>`;
}
const journalSub = () => { const n = REAL ? entriesIn2026 : entriesIn2026 + Object.keys(G.backfilled).length + (G.saved ? 1 : 0); return n ? `<b>${n} ${n === 1 ? 'entry' : 'entries'}</b> this year · longest streak ${STREAK.best} ${STREAK.best === 1 ? 'day' : 'days'}` : 'Your journal starts tonight'; };
// on this day: a month ago, else a year ago, else a week ago
function onThisDay() {
  if (!REAL) return { e: entryOn('2026-09-22'), when: 'A month ago, Tue 22 Sep' };
  for (const [d, label] of [[new Date(TODAY.getFullYear() - 1, TODAY.getMonth(), TODAY.getDate()), 'A year ago'], [new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, TODAY.getDate()), 'A month ago'], [addDays(TODAY, -7), 'A week ago']]) {
    const e = entryOn(iso(d)); if (e) return { e, when: `${label}, ${fmtDay(d)}` };
  }
  return { e: null };
}
function renderJournal(el, app) {
  const otd = onThisDay(), od = otd.e;
  el.innerHTML = `
    ${aspHead(app, { title: 'Journal', sub: journalSub() })}
    <div class="pad gro-jsearch"><label class="field">${I.search}<input type="search" id="groJq" placeholder="Search by word, person or app" value="${esc(J.q)}" autocomplete="off" /></label></div>
    <div id="groCal">${calendarCard()}</div>
    ${od ? `${sh('On this day')}<div class="group"><button class="row ic gro-otd" data-act="gro-entry" data-date="${od.date}"><span class="tile">${I.rewind}</span><span class="rbody"><span class="rtitle">${esc(od.title)}</span><span class="rmeta"><span>${esc(otd.when)}</span><span>·</span><span>${esc(moodWord(od.p, od.e))}</span></span></span>${I.chevR}</button></div>` : ''}
    <div class="pad gro-jseg">${seg('gro-jf', [['all', 'All'], ['voice', 'Voice'], ['photos', 'Photos'], ['reviews', 'Reviews']], J.filter, 'sm')}</div>
    <div id="groJList">${journalList()}</div>
    <p class="hint gro-jfoot">${REAL ? `Entries live on this phone and your PC. Lines you tell ${esc(AGENT.name)} in chat show here too.` : `${esc(AGENT.name)} files what you write into the other apps and keeps the words in your Brain. <button class="gro-link" data-act="gro-open" data-to="brain:growth/journal">Open the journal folder</button>`}</p>`;
  const input = $('#groJq', el);
  input.addEventListener('input', () => { J.q = input.value; $('#groJList', el).innerHTML = journalList(); });
  if (!el._jw) { el._jw = true; el.addEventListener('change', (e) => { if (e.target.closest('[data-seg="gro-jf"]')) { J.filter = e.detail; $('#groJList', el).innerHTML = journalList(); } }); }
}

// ═══ WEEK ═══════════════════════════════════════════════════════════════
const FAM = [['Health', ['body', 'mind', 'soul']], ['Work', ['mission', 'money', 'growth']], ['Relationships', ['family', 'romance', 'friends']]];
function pointRow(p) {
  const better = p.good === true, worse = p.good === false;
  const arrow = p.dir > 0 ? I.up : p.dir < 0 ? `<span class="gro-dn">${I.up}</span>` : '';
  return `<button class="row gro-pt" data-act="gro-open" data-to="${p.to ?? `aspect:${p.aspect}`}">
    <span class="rbody"><span class="rtitle">${esc(p.label)}</span><span class="rmeta"><span class="ell">${esc(p.note)}</span></span></span>
    <span class="gro-pt-v"><b class="met">${esc(p.now)}</b><small>was ${esc(p.was)}</small></span>
    <span class="gro-pt-d${better ? ' good' : worse ? ' bad' : ''}" aria-label="${better ? 'Better' : worse ? 'Worse' : 'No change'}">${arrow || '<i class="gro-eq"></i>'}</span>
  </button>`;
}
function renderWeek(el, app) {
  const has = WEEK.score != null, d = has && WEEK.last != null ? WEEK.score - WEEK.last : null;
  const live = (id) => { const s = aspectSummary(id); return s.line && s.line !== aspect(id).line ? s.line : ''; };
  const line = REAL ? (REVIEW.headline || (has ? 'Built from your tasks, journal, check-ins and every app that logs.' : 'No data points this week yet.')) : 'Body and Mission carried it. Friends and Money held it back.';
  const drafted = REAL ? (REVIEW.draftedBy === 'sonnet' ? `<b>${esc(AGENT.name)}</b> drafted it from your week.` : 'Drafted from your numbers; ' + `<b>${esc(AGENT.name)}</b> writes hers on Sunday at 18:00.`) : `<b>${esc(AGENT.name)}</b> drafted it from your week.`;
  el.innerHTML = `
    ${aspHead(app, { title: 'This week', sub: `<b>${esc(WEEK.label)}</b> · Monday to ${dowLong(TODAY)} so far` })}
    <section class="gro-wh surface">
      ${ring((WEEK.score ?? 0) / 100, 'as', 118, 12, { k: (WEEK.last ?? 0) / 100, inner: `<span class="gro-wh-in"><b class="met" data-count="${WEEK.score ?? 0}">${WEEK.score ?? '–'}</b><small>of 100</small></span>`, label: `Week score ${WEEK.score ?? 'not yet'} of 100, last week ${WEEK.last ?? 'none'}` })}
      <div class="gro-wh-side">
        <p class="gro-wh-k">Week ${WEEK.n ?? ''}</p>
        <p class="gro-wh-d"><b class="met">${d != null ? signed(d).replace('.0', '') : '–'}</b> on last week</p>
        <p class="gro-wh-l">${esc(line)}</p>
      </div>
      <button class="btn tint block gro-wh-go" style="--c:var(--as-ink)" data-act="gro-review">${I.sparkle}${G.reviewed ? 'See the sealed review' : 'Start the Sunday review'}</button>
      <p class="gro-wh-f"><span class="orb xs" aria-hidden="true"></span>${drafted} Six short steps, about 8 minutes. The numbers finish on Sunday.</p>
    </section>
    ${WEEK.moves.length || WEEK.rule ? `${sh("Last Sunday's moves", `<span class="sh-count">Week ${(WEEK.n ?? 1) - 1}</span>`)}
    <div class="group gro-mv">${WEEK.moves.map((m) => `<div class="row gro-mv-r">${aspectTile(m.aspect)}<span class="rbody"><span class="rtitle wrap">${esc(m.text)}</span><span class="rmeta"><span class="ell">${esc(m.note)}</span></span></span><span class="pill num" style="--c:${m.state === 'on' ? 'var(--done)' : 'var(--needs-ink)'}">${REAL ? (m.done ? 'Done' : m.progress != null ? `${m.progress}%` : 'Open') : `${m.done} of ${m.of}`}</span></div>`).join('')}
      ${WEEK.rule ? `<div class="row gro-rule"><span class="tile">${I.flag}</span><span class="rbody"><span class="rtitle">Rule: ${esc(WEEK.rule.text)}</span>${WEEK.rule.kept != null ? `<span class="rmeta">Kept ${WEEK.rule.kept} of ${WEEK.rule.of} days</span>` : ''}</span></div>` : ''}
    </div>` : ''}
    ${FAM.map(([fam, ids]) => `${sh(fam)}<div class="gro-fam">${ids.map((id) => {
      const pts = id === 'romance' ? [] : WEEK.points.filter((p) => p.aspect === id);
      const lv = live(id);
      const l = lv ? `Today: ${lv}` : id === 'romance' ? 'Not tracked. Only if you ask for it.' : '';
      return `<div class="group gro-ap"><button class="row ic gro-ap-h" data-act="gro-open" data-to="aspect:${id}">${aspectTile(id)}<span class="rbody"><span class="rtitle">${aspect(id).name}</span>${l ? `<span class="rmeta"><span class="ell">${esc(l)}</span></span>` : ''}</span>${I.chevR}</button>${pts.map(pointRow).join('')}</div>`;
    }).join('')}${fam === 'Work' ? contentGroup() : ''}${fam === 'Relationships' ? castGroup() : ''}</div>`).join('')}
    ${sh('Reviews', REVIEW.streak ? `<span class="sh-count">${REVIEW.streak} ${REVIEW.streak === 1 ? 'Sunday' : 'Sundays in a row'}</span>` : '')}
    ${PAST_REVIEWS.length ? '' : '<div class="note gro-empty">Sealed reviews collect here, one a Sunday.</div>'}
    <div class="group">${PAST_REVIEWS.map((r) => `<button class="row gro-pr-r" data-act="gro-review-past" data-w="${r.week}"><span class="gro-pr-n met">${r.score ?? '–'}</span><span class="rbody"><span class="rtitle">Week ${r.week} · ${esc(r.label)}</span><span class="rmeta"><span class="ell">${esc(r.line)}</span></span></span><span class="gro-pr-dl num">${signed(r.delta).replace('.0', '')}</span>${I.chevR}</button>`).join('')}</div>
    <div class="pad gro-wk-plan"><button class="btn block" data-act="gro-plan" data-k="week">${I.cal}Plan next week</button></div>`;
}

// the week's content, from the Content tab when it answers (contentSummary on the bus), this app's sample otherwise
function contentGroup() {
  const c = contentWeek();
  if (REAL) {
    if (!c.live || c.posted == null) return '';
    return `<div class="group gro-ap"><button class="row ic gro-ap-h" data-act="gro-open" data-to="content:stats"><span class="tile gro-ct-tile" aria-hidden="true">${I.content}</span><span class="rbody"><span class="rtitle">Content</span><span class="rmeta"><span class="ell">From the Content tab</span></span></span>${I.chevR}</button>
      ${pointRow({ aspect: 'content', label: 'Posts published', now: c.plan ? `${c.posted} of ${c.plan}` : String(c.posted), was: c.wasPosted != null ? String(c.wasPosted) : '–', dir: c.wasPosted != null ? Math.sign(c.posted - c.wasPosted) : 0, good: c.wasPosted != null && c.posted !== c.wasPosted ? c.posted > c.wasPosted : null, note: c.plan ? `Plan: ${c.plan} this week` : 'This week so far', to: 'content:stats' })}
      ${c.gained != null ? pointRow({ aspect: 'content', label: 'Followers gained', now: `+${c.gained}`, was: c.was != null ? `+${c.was}` : '–', dir: c.was != null ? Math.sign(c.gained - c.was) : 0, good: c.was != null && c.gained !== c.was ? c.gained > c.was : null, note: c.total != null ? `${c.total.toLocaleString('en-IN')} now` : '', to: 'content:stats' }) : ''}
    </div>`;
  }
  const pace = Math.round((WEEK.daysIn / 7) * c.plan);
  return `<div class="group gro-ap"><button class="row ic gro-ap-h" data-act="gro-open" data-to="content:stats"><span class="tile gro-ct-tile" aria-hidden="true">${I.content}</span><span class="rbody"><span class="rtitle">Content</span><span class="rmeta"><span class="ell">From the Content tab · one reel a day</span></span></span>${I.chevR}</button>
    ${pointRow({ aspect: 'content', label: 'Reels posted', now: `${c.posted} of ${c.plan}`, was: '3 of 7', dir: c.posted >= 3 ? 1 : -1, good: c.posted >= pace, note: c.posted >= pace ? 'On the one-a-day plan' : `${pace - c.posted} behind the one-a-day plan`, to: 'content:stats' })}
    ${pointRow({ aspect: 'content', label: 'Followers gained', now: `+${c.gained}`, was: `+${c.was}`, dir: c.gained >= c.was ? 1 : -1, good: c.gained >= c.was, note: `${c.total.toLocaleString('en-IN')} now, goal 5,000`, to: 'content:stats' })}
  </div>`;
}

// who the week's entries were about: only the people in his life, each a file in the Brain
function castGroup() {
  if (REAL && !WEEK.people.some((x) => x.n)) return '';
  return `<div class="group gro-cast"><div class="row gro-cast-h"><span class="rbody"><span class="rtitle">Who your week was about</span><span class="rmeta">From your journal entries</span></span></div>
    ${WEEK.people.map((x) => { const pp = person(x.id); if (!pp) return ''; return `<button class="row ic gro-cast-r" data-act="gro-open" data-to="person:${x.id}"><span class="gro-mono" data-aspect="${pp.aspect}" aria-hidden="true">${esc(pp.name[0])}</span><span class="rbody"><span class="rtitle">${esc(pp.name)}</span><span class="rmeta"><span class="ell">${esc(x.line)}</span></span></span><span class="gro-cast-n num${x.n ? '' : ' zero'}">${x.n ? `${x.n} ${x.n === 1 ? 'entry' : 'entries'}` : 'None'}</span>${I.chevR}</button>`; }).join('')}
  </div>`;
}

// ═══ DREAM ══════════════════════════════════════════════════════════════
const D = { active: null, open: {} };
function proposalRow(pid) {
  const p = dreamOrEmpty().proposals.find((x) => x.id === pid); if (!p) return '';
  const a = G.answered[p.id];
  return `<div class="gro-prop${a ? ` is-${a}` : ''}" data-pid="${p.id}">
    <div class="gro-prop-top"><span class="gro-prop-k">${esc(p.kind)}</span><span class="gro-prop-c">${esc(p.confidence)} confidence</span></div>
    <p class="gro-prop-t">${esc(p.title)}</p>
    <p class="gro-prop-m">${esc(p.meta)}</p>
    ${a ? `<p class="gro-prop-a">${a === 'yes' ? `${I.check}Done. ${REAL ? (p.kind === 'Task' || p.kind === 'Plan' ? 'It\'s on tomorrow\'s list.' : p.kind === 'Goal' ? 'It\'s a goal for this week.' : 'It\'s on this week\'s plan.') : p.kind === 'Rule' ? 'The rule starts tonight.' : p.kind === 'Ritual' ? 'Tomorrow\'s alarm is set.' : 'It\'s on Today.'}` : 'Declined. I won\'t suggest this again this week.'}<button class="gro-link" data-act="gro-undo-prop" data-id="${p.id}">Undo</button></p>`
      : `<div class="gro-prop-acts"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="gro-yes" data-id="${p.id}">${I.check}Yes</button><button class="btn sm" data-act="gro-no" data-id="${p.id}">No</button><button class="btn sm" data-act="gro-ask" data-q="${esc(`Change this proposal: ${p.title}`)}">Change</button></div>`}
  </div>`;
}
function connectionCard(c, k) {
  const open = D.open[c.id];
  return `<article class="gro-cn surface${D.active === c.id ? ' sel' : ''}" data-c="${c.id}">
    <button class="gro-cn-h" data-act="gro-thread" data-id="${c.id}" aria-pressed="${D.active === c.id}">
      <span class="gro-cn-n met">${k + 1}</span>
      <span class="gro-cn-tt"><span class="gro-cn-t">${esc(c.title)}</span><span class="gro-cn-a">${c.aspects.map((a) => `<span><i class="dot" style="--c:var(--${a})"></i>${aspect(a).name}</span>`).join('')}</span></span>
    </button>
    <p class="gro-cn-x">${esc(c.text)}</p>
    <button class="gro-cn-ev-t" data-act="gro-ev" data-id="${c.id}" aria-expanded="${!!open}">${open ? 'Hide' : 'Show'} the evidence · ${c.evidence.length}<span class="gro-chev${open ? ' up' : ''}">${I.chevD}</span></button>
    ${open ? `<div class="gro-cn-ev">${c.evidence.map(([a, src, q]) => `<div class="gro-ev"><i class="dot" style="--c:var(--${a === 'today' ? 'ink-3' : a})"></i><span class="gro-ev-s">${esc(src)}</span><span class="gro-ev-q">${esc(q)}</span></div>`).join('')}</div>` : ''}
    ${proposalRow(c.proposal)}
  </article>`;
}
function renderDream(el, app) {
  const p = pendingProposals();
  if (!DREAM || (!DREAM.connections.length && !DREAM.gaps.length)) {
    const st = DREAM?.status;
    el.innerHTML = `
      ${aspHead(app, { title: 'Last night', sub: st === 'running' ? `${esc(AGENT.name)} is reading your day now.` : `${esc(AGENT.name)} dreams at 04:30 while you sleep.` })}
      <section class="gro-dh surface gro-dh-empty"><div class="gro-dh-fig">${constellation(NO_DREAM)}</div>
        <p class="gro-dh-l">${st === 'failed' ? `Last night's dream didn't finish${DREAM.error ? ` (${esc(DREAM.error.slice(0, 80))})` : ''}. It runs again tonight.` : st === 'ready' ? 'A quiet night: nothing worth your yes. The slipped list is below.' : st === 'running' ? 'Dreaming… this takes a minute or two.' : 'She reads the day\'s journal, tasks, check-ins and every app that logs, then connects what sits in different places and proposes small changes for your yes.'}</p>
        ${REAL && st !== 'running' ? `<button class="btn tint block" style="--c:var(--as-ink)" data-act="gro-dream-now">${I.moon}Dream on today now</button>` : ''}
      </section>
      ${(DREAM?.slipped ?? []).length ? `${sh('What slipped', `<span class="sh-count">${DREAM.slipped.length}</span>`)}<div class="group">${DREAM.slipped.map((s) => `<button class="row ic" data-act="gro-open" data-to="${s.act}">${aspectTile(s.aspect)}<span class="rbody"><span class="rtitle">${esc(s.title)}</span><span class="rmeta"><span class="late">${esc(s.meta)}</span></span></span>${I.chevR}</button>`).join('')}</div>` : ''}
      ${PAST_DREAMS.length ? `${sh('Earlier nights')}<div class="group">${PAST_DREAMS.map((d) => { const dd = fromIso(d.date); return `<button class="row gro-pdr" data-act="gro-dream-past" data-date="${d.date}"><span class="gro-er-d"><small>${dow(dd)}</small><b class="met">${dd.getDate()}</b></span><span class="rbody"><span class="rtitle wrap">${esc(d.line)}</span><span class="rmeta">${d.found} found · ${d.approved} approved${d.declined ? ` · ${d.declined} declined` : ''}</span></span>${I.chevR}</button>`; }).join('')}</div>` : ''}
      <p class="hint">She dreams on your subscription once a night. Nothing she proposes happens without your yes.</p>`;
    return;
  }
  el.innerHTML = `
    ${aspHead(app, { title: 'Last night', sub: DREAM.from && DREAM.from >= '07:00' ? `${esc(AGENT.name)} read your day at <b class="num">${DREAM.from}</b>, when you asked.` : `${esc(AGENT.name)} read your day ${DREAM.to ? `from <b class="num">${DREAM.from}</b> to <b class="num">${DREAM.to}</b>` : `at <b class="num">${DREAM.from}</b>`} while you slept.` })}
    <section class="gro-dh surface">
      <div class="gro-dh-fig">${constellation(DREAM, D.active)}</div>
      <p class="gro-dh-l">${threadLine()}</p>
      <div class="gro-dh-stats">
        <span><b class="met">${DREAM.connections.length}</b>connections</span><span><b class="met">${DREAM.gaps.length}</b>gaps</span><span><b class="met">${DREAM.slipped.length}</b>slipped</span><span><b class="met${p ? ' c-needs' : ''}">${p}</b>for your yes</span>
      </div>
    </section>
    ${DREAM.connections.length ? `${sh('Connections')}
    <div class="gro-cns">${DREAM.connections.map(connectionCard).join('')}</div>` : ''}
    ${DREAM.gaps.length ? sh("What's missing", `<span class="sh-count">${DREAM.gaps.length}</span>`) : ''}
    ${DREAM.gaps.filter((g) => g.proposal).map((g) => `<article class="gro-gapc surface"><div class="gro-gapc-h">${aspectTile(g.aspect)}<span><b>${esc(g.title)}</b><small>${esc(g.text)}</small></span></div>${proposalRow(g.proposal)}</article>`).join('')}
    <div class="group gro-gaps">${DREAM.gaps.filter((g) => !g.proposal).map((g) => `<div class="row ic gro-gap">${aspectTile(g.aspect)}<span class="rbody"><span class="rtitle">${esc(g.title)}</span><span class="gro-gap-x">${esc(g.text)}</span></span></div>`).join('')}</div>
    ${DREAM.slipped.length ? sh('What slipped', `<span class="sh-count">${DREAM.slipped.length}</span>`) : ''}
    <div class="group">${DREAM.slipped.map((s) => `<button class="row ic" data-act="gro-open" data-to="${s.act}">${aspectTile(s.aspect)}<span class="rbody"><span class="rtitle">${esc(s.title)}</span><span class="rmeta"><span class="late">${esc(s.meta)}</span></span></span>${I.chevR}</button>`).join('')}</div>
    ${sh('What she read')}
    <div class="gro-read surface">
      <div class="gro-read-g">${DREAM.read.map(([a, name, what]) => `<span class="gro-read-i"><i class="dot" style="--c:${['today', 'life', 'agent'].includes(a) ? 'var(--ink-3)' : `var(--${a})`}"></i><span><b>${esc(name)}</b><small>${esc(what)}</small></span></span>`).join('')}</div>
      ${DREAM.missing.length ? `<p class="gro-read-x">Couldn't read: ${DREAM.missing.map(esc).join(' · ')}. <button class="gro-link" data-act="gro-ask" data-q="How do I connect more sources to your dream?">Connect</button></p>` : ''}
    </div>
    ${PAST_DREAMS.length ? sh('Earlier nights') : ''}
    <div class="group">${PAST_DREAMS.map((d) => { const dd = fromIso(d.date); return `<button class="row gro-pdr" data-act="gro-dream-past" data-date="${d.date}"><span class="gro-er-d"><small>${dow(dd)}</small><b class="met">${dd.getDate()}</b></span><span class="rbody"><span class="rtitle wrap">${esc(d.line)}</span><span class="rmeta">${d.found} found · ${d.approved} approved${d.declined ? ` · ${d.declined} declined` : ''}</span></span>${I.chevR}</button>`; }).join('')}</div>
    <p class="hint">${REAL ? 'She dreams on your subscription once a night, at 04:30.' : 'She dreams on the cheap model through Jev, and wakes the deep model only for a hard connection.'} Nothing she proposes happens without your yes.</p>`;
  animateThreads(el);
}
function threadLine() {
  const cs = dreamOrEmpty().connections;
  if (D.active) { const k = cs.findIndex((c) => c.id === D.active); return `Thread ${k + 1}: ${esc(cs[k]?.title ?? '')}. <button class="gro-link" data-act="gro-thread" data-id="${D.active}">Show all</button>`; }
  const parts = new Set(cs.flatMap((c) => c.aspects)).size;
  const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five'];
  return `${words[cs.length] ?? cs.length} ${cs.length === 1 ? 'thread' : 'threads'} across ${parts} ${parts === 1 ? 'part' : 'parts'} of your life.${cs.length ? ' Tap one to follow it.' : ''}`;
}
function animateThreads(el) {
  const fig = $('.gro-dh-fig', el); if (!fig) return;
  fig.classList.remove('draw'); void fig.offsetWidth; fig.classList.add('draw');
}

// ═══ TRENDS ═════════════════════════════════════════════════════════════
const T = { range: 'year' };
const RANGE_W = { m3: 13, m6: 26, year: 53 };
const RANGES = new Proxy({}, { get: (_, k) => { const to = LEVEL.length, n = RANGE_W[k] ?? 53; return [Math.max(1, to - n + 1), to]; } });
function chartCard() {
  const [from, to] = RANGES[T.range];
  return `<section class="gro-tc surface">
    <div class="gro-tc-top">
      <div class="gro-ro" id="groRo" aria-live="polite">${readout({ w: to, level: LEVEL[to - 1] ?? 0, rate: GROWTH.rate4 }, true)}</div>
    </div>
    <div class="gro-tc-fig" id="groChart">${levelChart({ from, to })}</div>
    <div class="gro-tc-foot">
      ${seg('gro-range', [['m3', '3 months'], ['m6', '6 months'], ['year', REAL ? 'All' : '2026']], T.range, 'sm')}
      <button class="btn sm" data-act="gro-table">Table</button>
    </div>
    <p class="gro-tc-key"><span><i class="k-l"></i>Level</span><span><i class="k-u"></i>Growing</span><span><i class="k-d"></i>Slipping</span><span class="gro-tc-src">${REAL && SOURCES.length ? `From ${esc(sourceWords())}` : 'From every app\'s data points'}</span></p>
  </section>`;
}
// what the index is built from, in plain words (the PC names each signal)
const SRC_WORD = { 'Tasks done': 'tasks', 'Tasks due, done': 'tasks', 'Nights written': 'the journal', 'How the days felt': 'check-ins', 'Sunday review': 'reviews', 'Your own score': 'your scores' };
function sourceWords() {
  const w = [...new Set(SOURCES.map((s) => SRC_WORD[s] ?? s.toLowerCase()))];
  return w.length > 3 ? `${w.slice(0, 3).join(', ')} and ${w.length - 3} more` : w.length > 1 ? `${w.slice(0, -1).join(', ')} and ${w.at(-1)}` : w[0];
}
function velocityGroups() {
  const groups = [['up', 'Improving'], ['flat', 'Flat'], ['down', 'Slipping'], ['none', 'No data yet']];
  return groups.map(([k, label]) => {
    const rows = VELOCITY.filter((v) => v.state === k);
    if (!rows.length) return '';
    return `<p class="gro-vh">${label} <span class="num">${rows.length}</span></p><div class="group gro-vel">${rows.map((v) => `<button class="row ic gro-vr" data-act="gro-aspect-trend" data-id="${v.id}">
      ${aspectTile(v.id)}
      <span class="rbody"><span class="rtitle">${aspect(v.id).name}</span><span class="gro-vr-x">${esc(DRIVERS[v.id])}</span></span>
      ${spark(v.arr, { label: `${aspect(v.id).name}, last 12 weeks, now ${v.now ?? 'no data'}`, state: v.v < -0.25 ? 'down' : '' })}
      <span class="gro-vr-v"><b class="met">${v.now == null ? '–' : signed(v.v)}</b><small>${v.now == null ? 'no data' : 'a week'}</small></span>
    </button>`).join('')}</div>`;
  }).join('');
}
function potentialCard() {
  if (REAL) return potentialReal();
  const top = POT.gaps.filter((g) => g.goal != null).slice(0, 2);
  return `<section class="gro-pc surface">
    <div class="gro-pc-h">
      <div class="gro-pc-big"><span><b class="met" data-count="${POT.share}" data-fmt="pct">${POT.share}</b><small>%</small></span><em>of your potential</em></div>
      <p class="gro-pc-l">Your goals ask for <b>${POT.goal}</b>. Your best weeks this year say <b>${POT.pot}</b> is in reach by December. That leaves <b>${POT.unclaimed} points</b> no goal is asking for.</p>
    </div>
    <div class="gro-pc-key" aria-hidden="true"><span><i class="k-now"></i>Now</span><span><i class="k-goal"></i>Goal</span><span><i class="k-pot"></i>Potential</span><span class="gro-pc-key-r">Goal / potential</span></div>
    <div class="gro-pc-rows">${POTENTIAL.map((x) => `<button class="gro-pr2" data-act="gro-aspect-trend" data-id="${x.id}" aria-label="${aspect(x.id).name}: now ${x.now}, ${x.goal != null ? `goal ${x.goal}` : 'no goal'}, potential ${x.pot}">
      <span class="gro-pr2-n"><i class="dot" style="--c:var(--${x.id})"></i>${aspect(x.id).name}</span>
      ${bullet(x)}
      <span class="gro-pr2-v num">${x.goal != null ? `${x.goal}<small>/${x.pot}</small>` : `<small>no goal</small>`}</span>
    </button>`).join('')}</div>
    <p class="gro-pc-f">Potential is where your best four weeks this year lead by 31 Dec, if they became normal. ${esc(AGENT.name)} recalculates it every Sunday.</p>
  </section>
  <div class="group gro-raise">${top.map((g) => `<div class="row ic">${aspectTile(g.id)}<span class="rbody"><span class="rtitle wrap">${g.id === 'friends' ? 'Friends: your goal asks for less than you\'ve done' : g.id === 'mind' ? 'Mind: 12 books is below your own pace' : `${aspect(g.id).name}: the goal sits ${g.gap} under your best`}</span><span class="gro-vr-x">${esc(g.best)}</span></span><button class="btn sm" data-act="gro-raise" data-id="${g.id}">Raise</button></div>`).join('')}
    <div class="row ic">${aspectTile('romance')}<span class="rbody"><span class="rtitle wrap">Romance has no goal</span><span class="gro-vr-x">Only if you want one. ${esc(AGENT.name)} won't nudge you here.</span></span><button class="btn sm" data-act="gro-raise" data-id="romance">Set one</button></div></div>`;
}
// real mode: potential is the level of his best weeks so far (up to four), per part of his life; no goal sets a number
function potentialReal() {
  const rows = POTENTIAL.filter((x) => x.now != null && x.pot != null);
  if (!rows.length) return '<div class="note gro-empty">Potential shows once a few weeks of data are in: it is where your best weeks lead.</div>';
  const top = POT.gaps.filter((g) => g.gap > 0).slice(0, 2);
  const none = POTENTIAL.filter((x) => !x.goals.length && x.now != null).slice(0, 2);
  return `<section class="gro-pc surface">
    <div class="gro-pc-h">
      <div class="gro-pc-big"><span><b class="met" data-count="${POT.share}" data-fmt="pct">${POT.share}</b><small>%</small></span><em>of your best weeks</em></div>
      <p class="gro-pc-l">You're at <b>${POT.now}</b> this week. Your best weeks so far average <b>${POT.pot}</b>. That leaves <b>${POT.unclaimed} points</b> you've already shown you can reach.</p>
    </div>
    <div class="gro-pc-key" aria-hidden="true"><span><i class="k-now"></i>Now</span><span><i class="k-pot"></i>Your best weeks</span><span class="gro-pc-key-r">Now / best</span></div>
    <div class="gro-pc-rows">${rows.map((x) => `<button class="gro-pr2" data-act="gro-aspect-trend" data-id="${x.id}" aria-label="${aspect(x.id).name}: now ${x.now}, best weeks ${x.pot}">
      <span class="gro-pr2-n"><i class="dot" style="--c:var(--${x.id})"></i>${aspect(x.id).name}</span>
      ${bullet(x)}
      <span class="gro-pr2-v num">${x.now}<small>/${x.pot}</small></span>
    </button>`).join('')}</div>
    <p class="gro-pc-f">Best weeks: the average of your top four weeks so far (${GROWTH.weeks ?? 0} ${GROWTH.weeks === 1 ? 'week' : 'weeks'} of data). ${esc(AGENT.name)} recalculates it every week.</p>
  </section>
  ${top.length || none.length ? `<div class="group gro-raise">${top.map((g) => `<div class="row ic">${aspectTile(g.id)}<span class="rbody"><span class="rtitle wrap">${aspect(g.id).name}: ${g.gap} under your best</span><span class="gro-vr-x">${esc(g.best)}</span></span><button class="btn sm" data-act="gro-raise" data-id="${g.id}">${g.goals.length ? 'Open goal' : 'Set a goal'}</button></div>`).join('')}
    ${none.filter((x) => !top.some((t) => t.id === x.id)).map((x) => `<div class="row ic">${aspectTile(x.id)}<span class="rbody"><span class="rtitle wrap">${aspect(x.id).name} has no goal</span><span class="gro-vr-x">Only if you want one. ${esc(AGENT.name)} won't nudge you here.</span></span><button class="btn sm" data-act="gro-raise" data-id="${x.id}">Set one</button></div>`).join('')}</div>` : ''}`;
}
function renderTrends(el, app) {
  if (REAL && !GROWTH.has) {
    el.innerHTML = `${aspHead(app, { title: 'Your growth', sub: 'Week by week. Growth is how fast your level changes.' })}
      <div class="note gro-empty">No weeks of data yet. Your level starts with the first week of tasks, journal entries, check-ins or anything another app logs, and growth shows from the second week.</div>`;
    return;
  }
  const lowLabel = REAL ? `since your low, week ${weekNo(GROWTH.lowW)}` : 'since your July low';
  const startLabel = REAL ? `since week ${weekNo(1)}` : 'since January';
  const steady = GROWTH.rate4 >= 1 ? 'Climbing.' : GROWTH.rate4 <= -1 ? 'Slipping.' : 'Holding steady.';
  el.innerHTML = `
    ${aspHead(app, { title: 'Your growth', sub: `Week by week${REAL ? '' : ' across 2026'}. Growth is how fast your level changes.` })}
    <section class="gro-th surface">
      <div class="gro-th-main">
        <p class="gro-th-k">${GROWTH.rate4 < 0 ? 'Slipping' : 'Growing'}</p>
        <p class="gro-th-v"><b class="met">${signed(GROWTH.rate4)}</b><span>a week</span></p>
        <p class="gro-th-l">${(() => { const w = (GROWTH.weeks ?? 13) - 1; if (REAL && w < 1) return 'Growth shows from your second week of data.'; if (REAL && w < 5) return `since ${w === 1 ? 'last week' : `${w} weeks ago`}. The four-week rate settles once there are five weeks. ${steady}`; return `over the last four weeks, against <b>${signed(GROWTH.rate12)}</b> over ${Math.min(12, w)}. ${steady}`; })()}</p>
      </div>
      <div class="gro-th-side">
        <span><b class="met" data-count="${GROWTH.now}">${GROWTH.now}</b><small>level now</small></span>
        <span><b class="met">${signed(GROWTH.sinceLow).replace('.0', '')}</b><small>${lowLabel}</small></span>
        <span><b class="met">${signed(GROWTH.sinceStart).replace('.0', '')}</b><small>${startLabel}</small></span>
      </div>
    </section>
    ${chartCard()}
    ${sh('Each part of your life', '<span class="sh-count">last 4 weeks</span>')}
    ${velocityGroups()}
    ${sh('Potential and goals')}
    ${potentialCard()}
    ${sh(`${TODAY.getFullYear()} so far`)}
    <div class="group gro-hl">
      <div class="row ic"><span class="tile">${I.star}</span><span class="rbody"><span class="rtitle">Best week: ${GROWTH.high}</span><span class="rmeta">Week ${weekNo(GROWTH.highW)} · ${weekLabel(GROWTH.highW)}${REAL ? '' : ', before exams'}</span></span></div>
      <div class="row ic"><span class="tile">${I.trend}</span><span class="rbody"><span class="rtitle">Lowest week: ${GROWTH.low}</span><span class="rmeta">Week ${weekNo(GROWTH.lowW)} · ${weekLabel(GROWTH.lowW)}${GROWTH.weeksSinceLow ? `, then ${GROWTH.weeksSinceLow} ${GROWTH.weeksSinceLow === 1 ? 'week' : 'weeks'} since` : ''}</span></span></div>
      <div class="row ic"><span class="tile">${I.edit}</span><span class="rbody"><span class="rtitle">${entriesIn2026} journal ${entriesIn2026 === 1 ? 'entry' : 'entries'}</span><span class="rmeta">${STREAK.best ? `Longest streak ${STREAK.best} ${STREAK.best === 1 ? 'day' : 'days'}${STREAK.bestFrom ? `, ${fmtShort(STREAK.bestFrom)} to ${fmtShort(STREAK.bestTo)}` : ''}` : 'No streak yet'}</span></span></div>
      <div class="row ic"><span class="tile">${I.cal}</span><span class="rbody"><span class="rtitle">${REVIEW.streak} Sunday ${REVIEW.streak === 1 ? 'review' : 'reviews in a row'}</span><span class="rmeta">${REVIEW.streak ? 'Each sealed with its moves and a rule' : 'The first one is this Sunday'}</span></span></div>
    </div>`;
  wireTrends(el);
}
function wireTrends(el) {
  const ro = $('#groRo', el);
  const [, to] = RANGES[T.range];
  const rest = () => readout({ w: to, level: LEVEL[to - 1], rate: RATE_AT(to) }, true);
  wireLevelChart($('#groChart', el), (r) => { ro.innerHTML = r ? readout(r) : rest(); ro.classList.toggle('live', !!r); });
  if (!el._rangeWired) {
    el._rangeWired = true;
    el.addEventListener('change', (e) => {
      if (!e.target.closest('[data-seg="gro-range"]')) return;
      T.range = e.detail;
      const [from, to2] = RANGES[T.range];
      $('#groChart', el).innerHTML = levelChart({ from, to: to2 });
      ro.innerHTML = readout({ w: to2, level: LEVEL[to2 - 1], rate: RATE_AT(to2) }, true);
      drawChart(el);
      wireLevelChart($('#groChart', el), (r) => { ro.innerHTML = r ? readout(r) : readout({ w: to2, level: LEVEL[to2 - 1], rate: RATE_AT(to2) }, true); ro.classList.toggle('live', !!r); });
    });
  }
  drawChart(el);
}
const RATE_AT = (to) => (REAL ? GROWTH.rate4 : GROWTH.rate4);
function drawChart(el) { const f = $('.gro-tc-fig', el); if (!f) return; f.classList.remove('draw'); void f.offsetWidth; f.classList.add('draw'); }

// ═══ the app ════════════════════════════════════════════════════════════
const topApp = () => { const p = $('#stack')?.lastElementChild; return p?._app?.id === 'growth' ? p._app : null; };
const anyApp = () => $$('#stack > .page').map((p) => p._app).filter((a) => a?.id === 'growth').at(-1) ?? null;
function goSection(s, then) {
  const app = topApp();
  if (app) { if (app.section !== s) app.go(s); then?.(app); return; }
  const a = openAspect('growth', s, { back: backLabel() });
  if (then) requestAnimationFrame(() => requestAnimationFrame(() => then(a)));
}
const backLabel = () => { const p = $('#stack')?.lastElementChild; return p ? ($('.tb-title', p)?.textContent?.trim() || 'Back') : ({ today: 'Today', life: 'Life', jobs: 'Work', agent: AGENT.name, more: 'More' }[$('#dock')?.dataset.tab] ?? 'Back'); };

function refreshToday() {
  const app = anyApp(); if (!app) return;
  const el = app.el('today'); if (!el?.dataset.built) return;
  el.innerHTML = ''; renderToday(el, app); wireSegs(el);
}
// the streak saved: the ring closes 6 → 7, tonight's dot fills, and what she filed lands one chip at a time
hooks.onSaved = () => {
  const app = anyApp();
  const el = app?.el('today');
  if (el?.dataset.built) {
    const before = $('#groStreakRing', el);
    renderToday(el, app);
    const r = $('#groStreakRing', el);
    if (r && before) {
      r.style.setProperty('--rp', String(STREAK.n / 7)); r.dataset.v = (STREAK.n / 7).toFixed(4);
      requestAnimationFrame(() => requestAnimationFrame(() => setRing(r, 1)));
      const n = $('#groStreakN', el); if (n) { n.textContent = STREAK.n; setTimeout(() => { n.textContent = STREAK.n + 1; n.classList.add('gro-flip-in'); }, 420); }
    }
    $('.gro-tn', el)?.classList.add('just');
    app.scroll.scrollTo({ top: 0, behavior: 'smooth' });
  }
  haptic(14);
  if (has('agentSay')) setTimeout(() => api.agentSay(`Streak saved: ${STREAK.n + 1} days. I filed ${G.entry.filed.length} ${G.entry.filed.length === 1 ? 'thing' : 'things'} from tonight's entry.`, { aspect: 'growth', kind: 'did' }), 1400);
  else toast(`Streak saved: ${STREAK.n + 1} days`);
};
hooks.onCheckin = () => { refreshToday(); };
hooks.onBackfill = () => {
  const app = anyApp(); const sec = app?.el('journal'); if (!sec?.dataset.built) return;
  const host = $('#groCal', sec); if (host) host.innerHTML = calendarCard();
  const list = $('#groJList', sec); if (list) list.innerHTML = journalList();
  const sub = $('.asp-head .sub', sec); if (sub) sub.innerHTML = journalSub();
};
hooks.onReviewed = () => { const app = anyApp(); if (app?.el('week')?.dataset.built) app.refresh('week'); };
hooks.refreshDream = () => { const app = anyApp(); if (app?.el('dream')?.dataset.built) { const y = app.scroll.scrollTop; const el = app.el('dream'); renderDream(el, app); wireSegs(el); app.scroll.scrollTop = y; } refreshToday(); };

registerAspect({
  id: 'growth',
  start: 'today',
  sections: [
    { id: 'today', label: 'Today', icon: I.sun, render: renderToday },
    { id: 'journal', label: 'Journal', icon: I.read, render: renderJournal },
    { id: 'week', label: 'Week', icon: I.cal, render: renderWeek },
    { id: 'dream', label: 'Dream', icon: I.moon, render: renderDream },
    { id: 'trends', label: 'Trends', icon: I.trend, render: renderTrends },
  ],
  primary: { label: 'Write tonight\'s entry', icon: I.edit, run: () => openComposer() },
  summary() {
    const n = G.saved ? STREAK.n + 1 : STREAK.n, pend = pendingProposals();
    const line = G.saved ? `${n}-day journal streak. Tonight's entry is in.` : n ? `${n}-day journal streak. Tonight's entry keeps it.` : 'No journal streak yet. Two lines tonight start one.';
    return {
      line,
      metric: { v: n, unit: n === 1 ? 'day' : 'days', label: 'journal streak', p: G.saved ? 1 : Math.min(1, n / 7) },
      today: [
        { id: 'gro-1', text: 'Write tonight\'s entry', done: G.saved, act: 'gro-write' },
        ...((DREAM?.proposals ?? []).length ? [{ id: 'gro-2', text: pend ? `Answer ${pend} ${pend === 1 ? 'proposal' : 'proposals'} from last night` : 'Last night\'s proposals answered', done: !pend, act: 'gro-dream' }] : []),
        { id: 'gro-3', text: 'Morning plan', done: !!PLAN.day.done, act: 'gro-plan' },
      ],
      streak: { n, label: 'day journal streak', atRisk: !G.saved && nowMin() >= 18 * 60 },
      week: WEEK.score != null ? { score: WEEK.score, last: WEEK.last, rate: GROWTH.rate4 } : null,
      next: G.saved ? null : { at: '22:00', text: 'Journal and shut down the day' },
      quick: [{ label: 'Journal', icon: I.edit, act: 'gro-write' }, { label: 'Check in', icon: I.heartPulse, act: 'gro-checkin' }],
    };
  },
  scan: [{ kind: 'page', label: 'Handwritten page', hint: 'Types it out and adds it to tonight\'s entry', handle(result) { openComposer({ text: result?.fields?.text ?? '', kind: 'scan', from: result?.title }); } }],
  // the agent's tools for this app (server/modules/growth.ts has the real ones; this list is what the Agent tab shows)
  tools: [
    { name: 'growth_journal_write', does: 'Adds what you tell her during the day to that day\'s entry, in your words', auto: true },
    { name: 'growth_journal_read', does: 'Reads your recent entries and the lines you told her', auto: true },
    { name: 'growth_checkin', does: 'Logs how you feel from what you said: mood, energy and what\'s behind it', auto: true },
    { name: 'growth_status', does: 'The streak, this week\'s level and rate, last night\'s dream and the review', auto: true },
    { name: 'growth_review_draft', does: 'Drafts Sunday\'s review from every app\'s numbers: wins, misses, rules and three moves', auto: true },
    { name: 'growth_plan_day', does: 'Sets the morning plan: your three and an intention', auto: true },
    { name: 'growth_dream_answer', does: 'Says yes or no to a dream proposal for you, after you\'ve said so', auto: false },
  ],
  onOpen(app) {
    requestAnimationFrame(() => enter(app.el(app.section ?? 'today')));
    if (REAL) { refreshState(); keepStreak(); }
    if (!BOOT.hash) return;
    const [, sub, arg] = BOOT.hash.replace(/^#/, '').split('/');
    BOOT.hash = '';
    const run = () => {
      if (sub === 'write' || sub === 'compose') openComposer(arg === 'voice' ? { mode: 'voice' } : {});
      else if (sub === 'review') openReviewFlow(arg ? +arg : undefined);
      else if (sub === 'plan') openPlanPage(arg ?? 'day');
      else if (sub === 'entry') openEntry(arg ?? iso(TODAY));
      else if (sub === 'checkin') openCheckin();
      else if (sub === 'streak') openStreak();
    };
    setTimeout(run, 420);
  },
  onSection(app, id) {
    const el = app.el(id);
    requestAnimationFrame(() => enter(el));
    if (id === 'trends') drawChart(el);
    if (id === 'dream') animateThreads(el);
  },
});

// ── actions ─────────────────────────────────────────────────────────────
on('gro-write', () => openComposer());
on('gro-talk', () => openComposer({ mode: 'voice' }));
on('gro-prompt', (el) => openComposer({ prompt: el.dataset.id }));
on('gro-prompts-more', (el) => { G.morePrompts = true; haptic(5); const sc = el.closest('.asp-sec'); if (sc) refreshToday(); });
on('gro-scanpage', () => scanPage());
on('gro-checkin', () => openCheckin());
on('gro-moment', (el) => { const m = DAY_MOMENTS.find((x) => String(x.id) === el.dataset.id); if (m) openComposer({ prompt: m.prompt, from: `${m.at} · ${m.label}` }); });
on('gro-backfill', (el) => openComposer({ backfill: el.dataset.date }));
on('gro-streak', () => openStreak());
on('gro-go', (el) => { haptic(5); goSection(el.dataset.s); });
on('gro-dream', () => goSection('dream'));
on('gro-entry', (el) => openEntry(el.dataset.date));
on('gro-review', () => openReviewFlow());
on('gro-review-past', (el) => openPastReview(+el.dataset.w));
on('gro-dream-past', (el) => openPastDream(el.dataset.date));
on('gro-plan', (el) => openPlanPage(el.dataset.k ?? 'day'));
on('gro-open', (el) => link(el.dataset.to));
on('gro-ask', (el) => api.askAgent(el.dataset.q ?? '', { aspect: 'growth' }));
on('gro-table', () => openTableSheet(RANGES[T.range]));
on('gro-aspect-trend', (el) => openAspectTrend(el.dataset.id));
on('gro-cal', (el) => {
  const d = +el.dataset.d; let m = J.m + d, y = J.y;
  if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
  if (y > TODAY.getFullYear() || (y === TODAY.getFullYear() && m > TODAY.getMonth()) || y < TODAY.getFullYear() - 1) return;
  J.m = m; J.y = y; haptic(4);
  const host = el.closest('#groCal'); if (host) { host.innerHTML = calendarCard(); host.firstElementChild.classList.add('gro-swap'); }
});
on('gro-cal-go', (el) => {
  J.m = +el.dataset.m; J.y = TODAY.getFullYear(); haptic(5);
  const app = topApp(); const sec = app?.el('journal'); const host = sec && $('#groCal', sec);
  if (host) { host.innerHTML = calendarCard(); host.firstElementChild.classList.add('gro-swap'); host.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
});
on('gro-raise', (el) => {
  const id = el.dataset.id, x = POTENTIAL.find((p) => p.id === id);
  if (x?.goals?.length && has('openGoal')) return api.openGoal(x.goals[0]);
  if (has('addGoal')) return api.addGoal({ aspect: id, aspects: [id], title: id === 'romance' || !x?.pot ? '' : `${aspect(id).name}: back to ${x.pot}` });
  toast(x?.goal != null ? `Mission opens the goal to raise it to ${x.pot}` : `Mission helps you set a ${aspect(id).name} goal`);
});
on('gro-thread', (el) => {
  const id = el.dataset.id; D.active = D.active === id ? null : id; haptic(5);
  const app = topApp(); const sec = app?.el('dream'); if (!sec) return;
  const y = app.scroll.scrollTop;
  $('.gro-dh-fig', sec).innerHTML = constellation(dreamOrEmpty(), D.active);
  $('.gro-dh-l', sec).innerHTML = threadLine();
  $$('.gro-cn', sec).forEach((c) => { c.classList.toggle('sel', c.dataset.c === D.active); $('.gro-cn-h', c)?.setAttribute('aria-pressed', String(c.dataset.c === D.active)); });
  if (el.closest('.gro-cst') || el.closest('.gro-dh-l')) { const card = $(`.gro-cn[data-c="${id}"]`, sec); if (D.active && card) card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  else app.scroll.scrollTop = y;
});
on('gro-ev', (el) => {
  const id = el.dataset.id; D.open[id] = !D.open[id]; haptic(4);
  const card = el.closest('.gro-cn'); const c = dreamOrEmpty().connections.find((x) => x.id === id);
  if (card && c) { const k = DREAM.connections.indexOf(c); const tmp = document.createElement('div'); tmp.innerHTML = connectionCard(c, k); card.replaceWith(tmp.firstElementChild); }
});
// a yes, for real: a Task or Plan goes on tomorrow's list, a Goal becomes a week goal, a Rule or Ritual goes on this
// week's plan; the answer is stored on the dream (so she learns), and the toast carries the undo
function makeFromProposal(p) {
  const tmr = iso(addDays(TODAY, 1));
  if (p.kind === 'Task' || p.kind === 'Plan') { const t = addTask({ title: p.title, due: tmr, notes: `From ${AGENT.name}'s dream on ${DREAM.date}. ${p.meta ?? ''}`.trim() }); return { kind: 'task', id: t?.id ?? null }; }
  if (p.kind === 'Goal') { const g = addGoal({ title: p.title, horizon: 'week', aspects: p.aspect ? [p.aspect] : null }); return { kind: 'goal', id: g?.id ?? null }; }
  const key = WEEK.key ? `week-${WEEK.key}` : null;
  if (key) { const cur = COL.plans.get(key) ?? { id: key }; putPlan({ ...cur, id: key, rules: [...(cur.rules ?? []).filter((r) => r.from !== `${DREAM.id}:${p.id}`), { text: p.title, meta: p.meta, kind: p.kind, from: `${DREAM.id}:${p.id}` }] }); }
  return { kind: 'rule', id: key };
}
function unmake(p, made) {
  if (!made) return;
  if (made.kind === 'task' && made.id && taskOf(made.id)) { try { dropTask(made.id); } catch {} }
  if (made.kind === 'rule' && made.id) { const cur = COL.plans.get(made.id); if (cur) putPlan({ ...cur, rules: (cur.rules ?? []).filter((r) => r.from !== `${DREAM.id}:${p.id}`) }); }
}
on('gro-yes', (el) => {
  const p = DREAM?.proposals.find((x) => x.id === el.dataset.id); if (!p) return;
  G.answered[p.id] = 'yes'; haptic(10);
  let made = null;
  if (REAL) { try { made = makeFromProposal(p); } catch (e) { toast('That didn\'t save. Try again'); delete G.answered[p.id]; return; } answerProposal(DREAM.id, p.id, 'yes', made); }
  swapProposal(el, p);
  const undo = () => { delete G.answered[p.id]; if (REAL) { unmake(p, made); answerProposal(DREAM.id, p.id, null); } swapProposal(null, p); hooks.refreshDream(); };
  if (REAL) toast(p.kind === 'Task' || p.kind === 'Plan' ? `On ${fmtDay(addDays(TODAY, 1))}'s list` : p.kind === 'Goal' ? 'A goal for this week' : 'On this week\'s plan', undo);
  else toast(p.kind === 'Rule' ? 'Rule added to Soul\'s blocker' : p.kind === 'Ritual' ? 'Morning plan moved to 07:10' : p.kind === 'Plan' ? 'Saturday 08:00 is on your calendar' : 'Added to Today', undo);
});
on('gro-no', (el) => {
  const p = DREAM?.proposals.find((x) => x.id === el.dataset.id); if (!p) return;
  G.answered[p.id] = 'no'; haptic(6);
  if (REAL) answerProposal(DREAM.id, p.id, 'no');
  swapProposal(el, p);
  toast('Declined. She learns from it', () => { delete G.answered[p.id]; if (REAL) answerProposal(DREAM.id, p.id, null); hooks.refreshDream(); });
});
on('gro-undo-prop', (el) => {
  const p = DREAM?.proposals.find((x) => x.id === el.dataset.id); if (!p) return;
  if (REAL) { unmake(p, p.made ?? DREAM.doc?.proposals?.find((x) => x.id === p.id)?.made); answerProposal(DREAM.id, p.id, null); }
  delete G.answered[el.dataset.id]; haptic(4); swapProposal(el, p);
});
on('gro-dream-now', async (el) => {
  el.disabled = true; el.textContent = 'Dreaming… about a minute';
  try { await API.post('/mod/growth/dream/run', { force: true }, { timeout: 300000 }); await COL.dreams.refresh(); await refreshState(true); toast('Her dream is in'); }
  catch (e) { toast(e?.status === 403 ? 'Only the owner can run the dream' : `The dream didn't finish: ${e?.message ?? 'no answer'}`); }
  finally { el.disabled = false; hooks.refreshDream(); }
});
function swapProposal(el, p) {
  $$(`.gro-prop[data-pid="${p.id}"]`).forEach((node) => { const tmp = document.createElement('div'); tmp.innerHTML = proposalRow(p.id); const fresh = tmp.firstElementChild; fresh.classList.add('gro-swap'); node.replaceWith(fresh); });
  const app = anyApp(); const sec = app?.el('dream');
  if (sec) { const s = $('.gro-dh-stats', sec); if (s) { const n = pendingProposals(); s.lastElementChild.innerHTML = `<b class="met${n ? ' c-needs' : ''}">${n}</b>for your yes`; } }
  refreshToday();
}

// ── the handwritten page: the iPhone's document scanner reads it on the device; elsewhere the PC reads a photo ──
async function scanPage() {
  if (native.available) {
    const r = await native.scan.document({ ocr: true, maxSize: 2000 });
    if (r.ok && r.text?.trim()) return openComposer({ kind: 'scan', text: r.text.trim(), from: `${r.count ?? 1} ${r.count === 1 ? 'page' : 'pages'}` });
    if (r.ok) return toast('No writing found on that page');
    if (r.available && !r.cancelled) toast('The scan didn\'t work. Try again in better light');
    if (r.available) return;
  }
  if (!REAL) { if (has('scan')) return api.scan('page'); return openComposer({ kind: 'scan', text: '' }); }
  const ph = await native.scan.photo({ source: 'camera', maxSize: 1800, quality: 0.85 });
  if (!ph.ok) { if (!ph.cancelled && has('scan')) return api.scan('page'); return; }
  const image = String(ph.image).startsWith('data:') ? ph.image : `data:${ph.mime ?? 'image/jpeg'};base64,${ph.image}`;
  toast('Reading your page…');
  try {
    const r = await API.post('/mod/growth/ocr', { image }, { timeout: 180000 });
    if (!r?.text?.trim()) return toast('No writing found on that page');
    openComposer({ kind: 'scan', text: r.text.trim(), from: r.title || 'Handwritten page' });
  } catch (e) { toast(e?.status === 0 || !navigator.onLine ? 'Reading a page needs your PC. It\'s offline' : `Couldn't read the page: ${e?.message ?? 'no answer'}`); }
}

// ── the streak keeper on the phone: the 22:00 alarm (AlarmKit, else a notification) while tonight's entry is missing,
//    cancelled the moment it's saved; the widget's journal streak ──
let alarmSet = null;
async function keepStreak() {
  if (!REAL || !native.available) return;
  const want = !G.saved && SETTINGS.alarm !== false && nowMin() < 22 * 60;
  const key = `${iso(TODAY)}:${want}`;
  if (alarmSet === key) return; alarmSet = key;
  const id = 'gro-streak';
  if (!want) { native.alarm.cancel({ id }); native.notify.cancel({ id: 'gro-nudge' }); return; }
  const at = clock22(22 * 60), n = STREAK.n;
  await native.alarm.schedule({ id, at, title: n ? `Save your ${n}-day journal streak` : 'Tonight\'s entry', body: 'Two lines are enough.', snoozeMinutes: 10, url: 'agenticos://growth/journal' });
  if (SETTINGS.nudge !== false && nowMin() < 21 * 60) native.notify.schedule({ id: 'gro-nudge', at: clock22(21 * 60), title: n ? `${n}-day journal streak` : 'Two lines tonight?', body: PROMPTS[0]?.text ?? 'Tonight\'s prompts are ready.', category: 'streak', url: 'agenticos://growth/journal' });
}
// the instant today (IST) reaches `min` minutes past midnight, in ms
const clock22 = (min) => Date.now() - (Date.now() % 60000) + (min - nowMin()) * 60000;
hooks.onLadder = () => { alarmSet = null; keepStreak(); };
if (REAL) snapshotPart('streaks:growth', () => [{ id: 'journal', label: 'Journal', n: G.saved ? STREAK.n + 1 : STREAK.n, today: !!G.saved, atRisk: !G.saved && nowMin() >= 18 * 60, due: Math.round((Date.now() + Math.max(0, 22 * 60 - nowMin()) * 60000) / 1000), aspect: 'growth' }]);

// ── links ───────────────────────────────────────────────────────────────
const after = (fn) => (L, ctx) => { ctx.tab('life'); ctx.after(() => fn(L)); };
registerRoute(['growth/journal', 'growth/write', 'journal'], after((L) => (L.sub === 'journal' && L.arg === 'list' ? goSection('journal') : openComposer(L.query.get('voice') === '1' || L.arg === 'voice' ? { mode: 'voice' } : {}))));
registerRoute('growth/review', after(() => goSection('week', () => openReviewFlow())));
registerRoute('growth/entry', after((L) => goSection('journal', () => openEntry(L.arg ?? iso(TODAY)))));
registerRoute('growth/plan', after((L) => openPlanPage(L.arg ?? 'day')));
registerRoute('growth/streak', after(() => goSection('today', () => openStreak())));
registerRoute('growth/checkin', after(() => goSection('today', () => openCheckin())));
registerRoute('growth/scan', after(() => goSection('today', () => scanPage())));

// ── live: redraw what's on screen when the PC or the store changes (never while he is typing in it) ──
document.addEventListener('growth-changed', () => {
  syncG();
  const app = anyApp();
  if (app) for (const id of ['today', 'journal', 'week', 'dream', 'trends']) {
    const el = app.el(id); if (!el?.dataset.built) continue;
    if (el.contains(document.activeElement) && document.activeElement.matches('input, textarea')) continue;
    const y = app.scroll.scrollTop;
    el.innerHTML = ''; ({ today: renderToday, journal: renderJournal, week: renderWeek, dream: renderDream, trends: renderTrends })[id](el, app); wireSegs(el);
    app.scroll.scrollTop = y;
  }
  keepStreak();
});
// entrances: cards rise in one after another when a section first draws
const entered = new WeakSet();
function enter(el) { if (!el || entered.has(el)) return; entered.add(el); try { stagger($$(':scope .surface, :scope .group, :scope .gro-mo', el).slice(0, 10), { y: 14, each: 45, max: 360 }); } catch {} }

// ── the bus ─────────────────────────────────────────────────────────────
provide('writeJournal', (prefill = {}) => openComposer(typeof prefill === 'string' ? { text: prefill } : prefill));
provide('openJournal', (date) => {
  if (date) { const k = typeof date === 'string' ? date : iso(date); if (topApp()) return openEntry(k); return goSection('journal', () => openEntry(k)); }
  goSection('journal');
});
provide('openReview', (week) => {
  const w = week ? (/W\d+$/.test(String(week)) ? Number(String(week).slice(-2)) : +week) : REVIEW.week;
  if (w !== REVIEW.week && PAST_REVIEWS.some((r) => r.week === w)) return topApp() ? openPastReview(w) : goSection('week', () => openPastReview(w));
  if (topApp()) return openReviewFlow();
  goSection('week', () => openReviewFlow());
});
provide('openDream', (date) => {
  const k = date ? (typeof date === 'string' ? date : iso(date)) : DREAM?.date;
  if (k !== DREAM.date && PAST_DREAMS.some((d) => d.date === k)) return topApp() ? openPastDream(k) : goSection('dream', () => openPastDream(k));
  goSection('dream');
});
provide('openPlan', (kind = 'day') => openPlanPage(kind));
provide('journalCheckIn', () => openCheckin());

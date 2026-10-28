// Today: the day, fused. One hero answers three questions in three seconds (what now, what next, does the rest fit),
// then the day itself: every app's moment on one timeline, the tasks without a time in a tray above it, ready to drag
// into a free slot. The calendar (day, week, month) lives in the same tab; the full task lists one tap away.
// Real data: the PC's calendar (Google + this app's moves and areas), the real tasks, her real asks, each app's real
// summary(); every change goes through the sync, offline first. Owner: Today. Files: js/today.js + js/today-*.js,
// css/screens/today.css. Prefixes: data-act td- (and the legacy task, task-check, event, sleep, triage, t-*), classes td- / tl-.
import { $, $$, esc, on, registerTab, toast, haptic, seg, wireSegs, ring, setRing, topbar, onHold, peek, closePeek, pulse, currentTab, setTab } from './core.js';
import { I, aspectIcon } from './icons.js';
import { AGENT, USER, CONTENT, DEMO_MODE, FEED, ME } from './data.js';
import { api, provide, has } from './bus.js';
import { summary } from './aspects.js';
import { registerRoute } from './svc/route.js';
import { snapshotPart } from './svc/native.js';
import { stagger, roll, rollHTML, reduced, springCurve, SPRINGS } from './motion.js';
import { lenOf, known, ensureRange, shortTitle, rel, setRefused, allDayOn } from './today-data.js';
import { S, onChange, changed, task, NOW, TODAY, REAL, hm, dur, plural, current, restOfToday, earlierToday, unplanned, fit, leftToday, needsJobs, goal, goalShort, colorOf, aspectName, areaName, projectName, blocksOn, freeOn, bookedOn, day, addDays, isDone, isOpen, isTimed, atOf, dateOf, doingNow, doneToday, awakeThrough, nightOf, wake, bed, untagged, isMember, GOALS, JOBS, TASKS } from './today-state.js';
import { taskRow, complete, toTomorrow, place, openTask, openTasks, refreshSheets } from './today-tasks.js';
import { addTask } from './today-add.js';
import { weekStrip, weekView, monthView, openCalendar, wireCal, findEvent, dueOn } from './today-cal.js';
import { openPlan, openShutdown, openPlace, openGap, openLate, plannedToday, closedToday } from './today-plan.js';
import { openSleep, upLateCard } from './today-night.js';
import { openEvent, openTags } from './today-events.js';
import { wireDrag } from './today-drag.js';
import { asks, answer, later, undoAnswer, mountHeaderOrb, syncMood, ensureCss } from './today-agent.js';
import { readyPlan } from './today-ai.js';

export { taskRow };
ensureCss('css/motion.css');
setRefused((msg) => toast(msg));

const tile = (id, cls = '') => `<span class="tile asp-tile ${cls}" data-aspect="${id}" aria-hidden="true">${aspectIcon[id] ?? I.grid}</span>`;
const dot = (id) => (id ? `<i class="dot" style="--c:var(--${id})"></i>` : '');
const owner = () => !REAL || !!USER?.owner;
let built = false;

registerTab('today', {
  title: 'Today',
  render(page) {
    page.innerHTML = topbar({
      title: 'Today',
      right: `${owner() ? `<span class="td-orb-h" id="tdOrb" role="button" tabindex="0" aria-label="${esc(AGENT.name)}. Hold to breathe"></span>` : ''}
              <button class="gbtn chrome icon" data-act="td-add" aria-label="Add a task">${I.plus}</button>
              <button class="gbtn chrome icon avatar" data-act="account" aria-label="Account">${esc(ME.initial || ME.name?.[0] || 'V')}</button>`,
    }) + '<div class="scroll" id="todayScroll"></div>';
    page.classList.toggle('td-has-orb', owner());
    draw({ enter: true });
    wireDrag($('#todayScroll'));
    renderAccessory();
    requestAnimationFrame(() => { const o = $('#tdOrb'); if (o) mountHeaderOrb(o); });
    built = true;
  },
  // jobs and asks move on other tabs: bring them up to date before the page draws again
  onShow() { draw({ enter: true }); renderAccessory(); syncMood(); },
});

// ── the page ─────────────────────────────────────────────────────────
let lastSig = '';
function draw({ enter = false } = {}) {
  const sc = $('#todayScroll'); if (!sc) return;
  const y = sc.scrollTop;
  const rails = Object.fromEntries($$('.td-rail', sc).map((r) => [r.dataset.rail, r.scrollLeft]));
  const isToday = S.date === TODAY && S.view === 'day';
  sc.dataset.view = S.view;
  sc.dataset.date = S.date;
  sc.classList.toggle('td-night-on', S.night && isToday);
  sc.innerHTML = head() + (S.view === 'week' ? weekView(S.date) : S.view === 'month' ? monthView(S.date) : isToday ? dayToday() : dayOther(S.date));
  wireSegs(sc);
  $('[data-seg="td-view"]', sc)?.addEventListener('change', (e) => { S.view = e.detail; haptic('selection'); draw(); swapIn(); });
  wireCal(sc, { get: () => S.date, set: (iso) => { const was = S.date; S.date = iso; draw(); if (was !== iso) swapIn(iso > was ? 1 : -1); }, quiet: (iso) => { S.date = iso; } });
  $$('.td-rail', sc).forEach((r) => { if (rails[r.dataset.rail] != null) r.scrollLeft = rails[r.dataset.rail]; });
  sc.scrollTop = y;
  lastSig = sigOf();
  landing(sc);
  if (enter) enterAnim(sc);
}
// a block that was just moved slides from where the finger left it; a task that just landed plays its arrival
function landing(sc) {
  const lf = S.landFrom; S.landFrom = null;
  if (!lf || reduced()) return;
  const row = $(`.td-row[data-task="${CSS.escape(lf.id)}"], .td-row[data-id="${CSS.escape(lf.id)}"]`, sc);
  if (!row) return;
  const dy = lf.top - row.getBoundingClientRect().top;
  if (Math.abs(dy) < 2) return;
  const c = springCurve(SPRINGS.land);
  row.animate([{ transform: `translateY(${dy.toFixed(1)}px) scale(1.02)` }, { transform: 'none' }], { duration: c.duration, easing: c.easing });
}
function enterAnim(sc) {
  if (reduced()) return;
  stagger($$('.td-hero, .td-needs, .td-life, .td-tray, .td-glance', sc), { y: 14, each: 55, max: 280 });
  stagger($$('.td-tl > .td-row', sc).slice(0, 12), { y: 10, each: 32, max: 360, delay: 140 });
  stagger($$('.td-wk-col, .td-mo-row', sc), { y: 8, each: 22, max: 200 });
}
const swapIn = (dir = 0) => {
  const b = $('#todayScroll .td-body'); if (!b) return;
  b.classList.remove('td-swap', 'td-swap-l', 'td-swap-r'); void b.offsetWidth;
  b.classList.add(dir > 0 ? 'td-swap-r' : dir < 0 ? 'td-swap-l' : 'td-swap');
  pulse($('#todayScroll'));
};
onChange((why) => {
  if (currentTab() === 'today' && !document.querySelector('.td-dragging, .td-moving')) {
    if (why === 'tick') tick(); else draw();
  }
  renderAccessory();
  refreshSheets();
  document.dispatchEvent(new CustomEvent('td-redraw'));
  if (why !== 'tick') moodSoon();
});
let moodT = 0;
const moodSoon = () => { clearTimeout(moodT); moodT = setTimeout(syncMood, 1500); };

function head() {
  const d = day(S.date); const isToday = S.date === TODAY;
  let title = 'Today', sub = d.long;
  if (S.view === 'day' && !isToday) { title = d.wdLong; sub = `${d.d} ${d.monLong}${S.date < TODAY ? ' · past' : ''}`; }
  if (S.view === 'week') {
    const w = addDays(S.date, -d.dow), e = addDays(w, 6), a = day(w), b = day(e);
    title = w === addDays(TODAY, -day(TODAY).dow) ? 'This week' : w > TODAY ? (w === addDays(TODAY, 7 - day(TODAY).dow) ? 'Next week' : `Week of ${a.d} ${a.mon}`) : (w === addDays(TODAY, -7 - day(TODAY).dow) ? 'Last week' : `Week of ${a.d} ${a.mon}`);
    sub = a.m === b.m ? `${a.d}–${b.d} ${b.monLong}` : `${a.d} ${a.mon} – ${b.d} ${b.mon}`;
  }
  if (S.view === 'month') { title = d.monLong; sub = String(d.y); }
  const pager = S.view !== 'day' ? `<button class="td-pg" data-act="td-pg" data-d="-1" aria-label="Previous ${S.view}">${I.chevL}</button><button class="td-pg" data-act="td-pg" data-d="1" aria-label="Next ${S.view}">${I.chevL}</button>` : '';
  const away = S.view === 'day' ? !isToday : S.view === 'week' ? addDays(S.date, -d.dow) !== addDays(TODAY, -day(TODAY).dow) : d.m !== day(TODAY).m || d.y !== day(TODAY).y;
  const back = away ? `<button class="chip sm td-totoday" data-act="td-totoday">Today</button>` : '';
  if (S.view === 'month' && d.y !== day(TODAY).y) title = `${d.monLong} ${d.y}`;
  // away from today in a week or a month, the range gives way to the Today chip (the title and the grid say where you are)
  const showSub = S.view === 'day' || !back;
  return `<header class="phead td-head">
      <h1 class="lt">${esc(title)}</h1>
      <div class="td-dl">${showSub ? `<p class="sub">${esc(sub)}</p>` : ''}${pager}<span class="td-dl-sp"></span>${back}${seg('td-view', [['day', 'Day'], ['week', 'Week'], ['month', 'Month']], S.view, 'sm td-views')}</div>
    </header>
    ${S.view === 'day' ? weekStrip(S.date) : ''}`;
}
on('td-totoday', () => { S.date = TODAY; S.view = 'day'; haptic('selection'); draw(); swapIn(-1); $('#todayScroll').scrollTo({ top: 0, behavior: 'smooth' }); });
on('td-pg', (el) => {
  const n = Number(el.dataset.d);
  if (S.view === 'week') S.date = addDays(S.date, 7 * n);
  else if (S.view === 'month') { const d = day(S.date); const dt = new Date(d.y, d.m + n, 1, 12); S.date = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-01`; }
  haptic('selection'); draw(); swapIn(n);
});
on('td-day', (el) => {
  const iso = el.dataset.iso;
  if (S.view === 'day' && iso === S.date && iso === TODAY) { $('#todayScroll').scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const was = S.date;
  // the lens slides to the picked date before the day below redraws
  const strip = $('#todayScroll .td-week');
  const days = $$('.td-wd', strip ?? document.createElement('div')).map((b) => b.dataset.iso);
  if (strip && S.view === 'day' && days.includes(iso)) { strip.style.setProperty('--i', String(days.indexOf(iso))); $('.td-week-lens', strip)?.classList.toggle('is-today', iso === TODAY); }
  S.date = iso; S.view = 'day'; haptic('selection');
  setTimeout(() => { draw(); swapIn(iso > was ? 1 : -1); }, strip ? 120 : 0);
});

// ── today ────────────────────────────────────────────────────────────
function dayToday() {
  return `<div class="td-body">${allDay(TODAY)}${hero()}${upLateCard()}${needsYou()}${lifeLane()}${tray()}${timeline()}</div>`;
}
// all-day events (and the long ones: a hackathon, a trip) as one quiet line above the day
function allDay(iso) {
  const list = allDayOn(iso);
  if (!list.length) return '';
  return `<div class="td-allday" data-scroll-x>${list.map((e) => `<button class="td-ad" data-act="event" data-id="${esc(e.id)}">${dot(e.aspect)}<span class="ell">${esc(shortTitle(e.title))}</span>${e.allDay ? '' : `<small class="num">to ${esc(rel(e.endIso ? new Date(Date.parse(e.endIso) + 330 * 60000).toISOString().slice(0, 10) : iso))}</small>`}</button>`).join('')}</div>`;
}

// The hero: Now (the block you are in, its countdown), Next, and whether the rest of the day fits the tasks left.
function heroNow() {
  const c = current();
  const aw = awakeThrough();
  const rest = restOfToday();
  const nxt = rest.find((x) => !x.gap && x.start > NOW && x !== c && x.id !== c?.id) ?? null;
  return { c, aw, nxt };
}
function hero() {
  const { c, aw, nxt } = heroNow();
  const f = fit();
  let now;
  if (aw && !c) {
    const left = (aw.which === 'morning' ? aw.wake : aw.wake) - NOW;
    now = `<button class="td-now-main td-now-sleep" data-act="sleep" aria-label="${esc(`Past bedtime. Sleep until ${hm(aw.wake)}`)}">
      <span class="td-now-txt"><span class="td-now-k">${I.moon}<span>Past bedtime</span></span><span class="td-now-t">Sleep</span><span class="td-now-m num">${hm(aw.bed ?? 0)}–${hm(aw.wake)} · ${dur(Math.max(0, aw.wake - Math.max(NOW, aw.bed ?? NOW)))} left of it</span></span>
      ${ring((NOW - (aw.bed ?? NOW)) / Math.max(1, aw.wake - (aw.bed ?? NOW)), 'today', 88, 8, { id: 'tdNowRing', cls: 'td-now-ring', inner: `<span class="td-cd"><b class="met td-cd-v">${rollHTML(Math.max(0, left), { format: dur })}</b><small>to ${hm(aw.wake)}</small></span>` })}
    </button>`;
  } else if (c) {
    const span = c.end - c.start, p = (NOW - c.start) / span, left = c.end - NOW;
    const act = c.kind === 'task' ? `data-act="task" data-id="${c.task}"` : `data-act="event" data-id="${c.id}"`;
    const kick = c.aspect ? aspectName(c.aspect) : c.area ? areaName(c.area) : c.kind === 'task' ? 'Task' : '';
    now = `<button class="td-now-main" ${act} aria-label="${esc(`Now: ${c.title}, until ${hm(c.end)}, ${dur(left)} left`)}">
      <span class="td-now-txt">
        <span class="td-now-k">${dot(c.aspect)}<span>Now${kick ? ` · ${esc(kick)}` : ''}${c.where ? ` · ${esc(String(c.where).split(',')[0].trim())}` : ''}</span></span>
        <span class="td-now-t">${esc(c.title)}</span>
        <span class="td-now-m num">${hm(c.start)}–${hm(c.end)} · <span class="td-now-in">${dur(NOW - c.start)}</span> in</span>
      </span>
      ${ring(p, c.aspect ?? 'today', 88, 8, { id: 'tdNowRing', cls: 'td-now-ring', inner: `<span class="td-cd"><b class="met td-cd-v">${rollHTML(left, { format: dur })}</b><small>left</small></span>`, label: `${Math.round(p * 100)}% of this block gone, ${dur(left)} left` })}
    </button>`;
  } else {
    const end = nxt ? nxt.start : bed(TODAY);
    const until = Math.max(0, end - NOW);
    now = `<button class="td-now-main" data-act="td-plan" aria-label="${esc(`Free now for ${dur(until)}`)}">
      <span class="td-now-txt"><span class="td-now-k"><span>Free now</span></span><span class="td-now-t">${nxt ? `Until ${esc(shortTitle(nxt.title))}` : 'Nothing else today'}</span><span class="td-now-m num">${hm(NOW)}–${hm(end)}</span></span>
      ${ring(0, 'today', 88, 8, { id: 'tdNowRing', cls: 'td-now-ring', inner: `<span class="td-cd"><b class="met td-cd-v">${rollHTML(until, { format: dur })}</b><small>free</small></span>` })}
    </button>`;
  }
  const next = nxt && c ? `<button class="td-hr" ${nxt.kind === 'task' ? `data-act="task" data-id="${nxt.task}"` : `data-act="event" data-id="${nxt.id}"`}>
      <span class="td-hr-l">Next</span><b class="num">${hm(nxt.start)}</b><span class="td-hr-t">${dot(nxt.aspect)}<span class="ell">${esc(shortTitle(nxt.title))}</span></span><span class="td-hr-e num">${dur(nxt.end - nxt.start)}</span>${I.chevR}</button>` : '';
  // the honest line: the free time left against what the unplaced tasks need
  const evening = NOW >= Math.min(20 * 60 + 30, bed(TODAY) - 90) || !!aw;
  const closed = closedToday();
  const ready = REAL && !closed && !evening && f.count ? readyPlan() : null;
  let left, btn = '';
  if (closed) { left = `<span class="td-hr-v"><b>Day closed.</b><small>Tomorrow starts at ${hm(wake(addDays(TODAY, 1)))}</small></span>`; btn = `<button class="btn sm td-plan" data-act="td-shut">Open</button>`; }
  else if (evening) {
    const n = leftToday().length, d = doneToday().length;
    left = `<span class="td-hr-v"><b>${n ? `${plural(n, 'task')} left` : 'Nothing left'}</b><small>${plural(d, 'task')} done today</small></span>`;
    btn = `<button class="btn sm primary td-plan" data-act="td-shut" style="--c:var(--today-fill)">Shut down</button>`;
  } else if (!f.count) left = `<span class="td-hr-v"><b>Everything has a time.</b><small>${f.free ? `${dur(f.free)} still free` : 'Nothing free till bed'}</small></span>`;
  else if (f.over > 0) left = `<span class="td-hr-v"><b>${plural(f.count, 'task')} need ${dur(f.need)}</b><small>${dur(f.free)} free · <span class="late">${dur(f.over)} short</span></small></span>`;
  else left = `<span class="td-hr-v"><b>${plural(f.count, 'task')} fit</b><small>${dur(f.free)} free · ${dur(-f.over)} to spare</small></span>`;
  if (!closed && !evening && f.count) btn = ready ? `<button class="btn sm primary td-plan" data-act="td-plan" style="--c:var(--today-fill)">Your plan</button>` : f.over > 0 ? `<button class="btn sm primary td-plan" data-act="td-plan" style="--c:var(--today-fill)">Plan</button>` : `<button class="btn sm td-plan" data-act="td-plan">Plan</button>`;
  return `<section class="td-hero surface" aria-label="Now">
    ${now}
    <div class="td-hrows">
      ${next}
      <div class="td-hr td-hr-left"><span class="td-hr-l">${evening || closed ? 'Day' : 'Left'}</span>${left}${btn}</div>
      ${briefRows({ evening: evening || closed, nxt: c ? nxt : null })}
      ${ready ?`<p class="td-hr-ready"><span class="orb xs" aria-hidden="true"></span><span>${esc(AGENT.name)} made a plan this morning: ${plural(ready.ghosts.length, 'task')} into your free time.</span></p>` : ''}
    </div>
  </section>`;
}
// The brief, as the shipping app had it, as hero rows: in the day the week's goal and its next step, and an in-person rep
// later on; in the evening what the agents keep doing, when the phone goes down, and the nine-question score.
const IN_PERSON = /defen|boxing|gym|outing|friend|shop|class/i, NOT_REP = /\(Th\.\)|lab/i;
function briefRows({ evening, nxt }) {
  if (isMember()) return '';
  const out = [];
  if (!evening) {
    const g = GOALS.find((x) => x.horizon === 'week' && (x.status ?? 'active') === 'active');
    if (g) {
      const step = TASKS.filter((t) => t.goal === g.id && isOpen(t) && isTimed(t) && dateOf(t) === TODAY && atOf(t) >= NOW).sort((a, b) => atOf(a) - atOf(b))[0];
      out.push(`<button class="td-hr td-hr-wk" data-act="td-goal" data-id="${esc(g.id)}" aria-label="${esc(`Week goal: ${g.title}. ${step ? `Next step at ${hm(atOf(step))}` : 'No step planned for it today'}`)}">
        <span class="td-hr-l">Week</span><span class="td-hr-t">${dot(g.aspect)}<span class="ell">${esc(g.title)}</span></span><span class="td-hr-e num">${step ? `next ${hm(atOf(step))}` : 'no step today'}</span>${I.chevR}</button>`);
    }
    const rep = restOfToday().find((x) => !x.gap && x.kind !== 'task' && !x.sleep && x.start > NOW && x.id !== nxt?.id && IN_PERSON.test(x.title) && !NOT_REP.test(x.title));
    if (rep) out.push(`<button class="td-hr" data-act="event" data-id="${esc(rep.id)}"><span class="td-hr-l">Later</span><b class="num">${hm(rep.start)}</b><span class="td-hr-t">${dot(rep.aspect)}<span class="ell">${esc(shortTitle(rep.title))}</span></span><span class="td-hr-e">in person</span>${I.chevR}</button>`);
    return out.join('');
  }
  const working = owner() ? JOBS.filter((j) => j.lane === 'working') : [];
  if (working.length) {
    const j = working[0], who = j.agent === 'codex' ? 'Codex' : 'Claude';
    out.push(`<button class="td-hr" data-act="td-running" data-id="${working.length === 1 ? esc(j.id) : ''}"><span class="td-hr-l">Work</span><span class="td-hr-t"><span class="ell">${who} keeps working on “${esc(shortTitle(j.title))}”</span></span>${working.length > 1 ? `<span class="td-hr-e num">${working.length} running</span>` : ''}${I.chevR}</button>`);
  }
  const off = Math.min(bed(TODAY), 22 * 60 + 45) - 15;
  out.push(`<div class="td-hr"><span class="td-hr-l">Phone</span><b class="num">${off <= NOW ? 'Now' : hm(off)}</b><span class="td-hr-t"><span class="ell">down, out of the room</span></span></div>`);
  if (owner() && has('openLife')) out.push(`<button class="td-hr" data-act="td-score"><span class="td-hr-l">Score</span><span class="td-hr-t"><span class="ell">Score today</span></span><span class="td-hr-e">nine, 0 to 10</span>${I.chevR}</button>`);
  return out.join('');
}
on('td-goal', (el) => (has('openGoal') ? api.openGoal(el.dataset.id) : api.openAspect('mission')));
on('td-running', (el) => (el.dataset.id && has('openJob') ? api.openJob(el.dataset.id) : setTab('jobs')));
on('td-score', () => api.openLife('score'));
// the minute: the countdown rolls, the ring moves, the now line walks; a block that ended redraws the page
const sigOf = () => { const { c, aw, nxt } = heroNow(); const f = fit(); return [c?.id, aw?.id, nxt?.id, f.count, Math.round(f.free / 15), closedToday(), NOW >= 20 * 60 + 30].join('|'); };
function tick() {
  const sc = $('#todayScroll'); if (!sc) return;
  if (S.view !== 'day' || S.date !== TODAY || sigOf() !== lastSig) { draw(); return; }
  const { c, aw, nxt } = heroNow();
  const r = $('#tdNowRing', sc);
  const v = $('.td-cd-v .mx-roll', sc);
  if (c) {
    if (r) setRing(r, (NOW - c.start) / (c.end - c.start), { bleed: false });
    if (v) roll(v, c.end - NOW, { format: dur });
    const inn = $('.td-now-in', sc); if (inn) inn.textContent = dur(NOW - c.start);
  } else if (aw) { if (v) roll(v, Math.max(0, aw.wake - NOW), { format: dur }); }
  else if (v) roll(v, Math.max(0, (nxt ? nxt.start : bed(TODAY)) - NOW), { format: dur });
  // the now line: the block's fill and the line move down a little
  const row = $('.td-blk.is-now', sc);
  if (row && c) {
    const p = (NOW - c.start) / (c.end - c.start);
    row.querySelectorAll('[style*="--p"]').forEach((x) => x.style.setProperty('--p', p.toFixed(3)));
    const b = $('.td-nowline b', row); if (b) b.textContent = hm(NOW);
    const m = $('.td-rm .num', row); if (m) m.textContent = `until ${hm(c.end)} · ${dur(c.end - NOW)} left`;
  }
}
document.addEventListener('clock-tick', () => changed('tick'));

// What needs him from the agent and from Work: her top ask with its answer right here, and the jobs waiting on him.
function needsYou() {
  if (isMember()) return '';
  const open = asks();
  const a = open[0];
  const more = open.length - 1;
  const jobs = needsJobs();
  if (!a && !jobs.length) return '';
  const acts = a?.acts?.length ? a.acts : null;
  const ask = a ? `<div class="row td-ask" data-id="${esc(a.id)}">
      <span class="orb sm" aria-hidden="true"></span>
      <div class="rbody">
        <span class="td-ask-k"><span>${esc(AGENT.name)}${a.at ? ` · <span class="num">${esc(a.at)}</span>` : ''}${aspectName(a.aspect) ? ` · <span class="td-ask-a">${dot(a.aspect)}${esc(aspectName(a.aspect))}</span>` : a.from ? ` · <span class="ell">${esc(String(a.from).replace(/\s*\(.*$/, '').slice(0, 28))} asks</span>` : ''}</span>${more > 0 ? `<button class="td-ask-more" data-act="td-agent">${more} more ${I.chevR}</button>` : ''}</span>
        <span class="td-ask-t">${esc(a.title)}</span>
        ${a.text && a.text !== a.title && a.source === 'demo' ? `<span class="td-ask-x">${esc(a.text)}</span>` : ''}
        <span class="td-ask-acts">${acts ? acts.map(([label, v], i) => `<button class="btn sm ${i === 0 ? 'tint' : ''}" ${i === 0 ? 'style="--c:var(--needs)"' : ''} data-act="td-feed" data-id="${esc(a.id)}" data-v="${esc(v)}">${esc(label)}</button>`).join('')
          : `<button class="btn sm tint" style="--c:var(--needs)" data-act="td-ask-reply" data-id="${esc(a.id)}">Answer</button><button class="btn sm" data-act="td-feed" data-id="${esc(a.id)}" data-v="later">Later</button>`}</span>
        <form class="td-ask-form" data-id="${esc(a.id)}" hidden><input type="text" enterkeyhint="send" placeholder="Your answer" aria-label="Your answer" /><button class="btn sm primary" style="--c:var(--today-fill)">Send</button></form>
      </div>
    </div>` : '';
  const j = jobs.length ? `<button class="row td-jobs" data-act="td-work" aria-label="${plural(jobs.length, 'job')} need you">
      <span class="tile td-jobs-ic" aria-hidden="true">${I.work}<em>${jobs.length}</em></span>
      <span class="rbody"><span class="rtitle">${plural(jobs.length, 'job')} need${jobs.length === 1 ? 's' : ''} you</span><span class="rmeta"><span class="ell">${jobs.map((x) => esc(x.title.split(':')[0].slice(0, 40))).join(', ')} · ${esc(jobs[0].ask?.text ?? 'waiting on your answer')}</span></span></span>${I.chevR}</button>` : '';
  return `<section class="group td-needs" aria-label="Needs you">${ask}${j}</section>`;
}
const askOf = (id) => asks().find((x) => x.id === id);
on('td-feed', (el) => {
  const a = askOf(el.dataset.id); if (!a) return;
  const v = el.dataset.v; const row = el.closest('.td-ask'); haptic(v === 'yes' ? 'success' : 'light');
  collapse(row, () => {
    if (v === 'later') { later(a); toast('Later', () => undoAnswer(a)); return; }
    answer(a, v);
    toast(v === 'yes' ? 'Done' : 'Okay, not now', a.source === 'demo' ? () => undoAnswer(a) : undefined);
  });
});
on('td-ask-reply', (el) => { const f = el.closest('.td-ask')?.querySelector('.td-ask-form'); if (!f) return; f.hidden = false; el.closest('.td-ask-acts').hidden = true; f.querySelector('input').focus(); });
document.addEventListener('submit', (e) => {
  const f = e.target.closest?.('.td-ask-form'); if (!f) return;
  e.preventDefault();
  const text = f.querySelector('input').value.trim(); if (!text) return;
  const a = askOf(f.dataset.id); if (!a) return;
  haptic('success');
  collapse(f.closest('.td-ask'), () => { answer(a, 'text', text); toast(`Sent${a.from ? ` to ${String(a.from).slice(0, 24)}` : ''}`); });
});
on('td-agent', () => api.openAgent('feed'));
on('td-work', () => (has('openWork') ? api.openWork('needs') : setTab('jobs')));
// a row leaves by folding its height away, then the state change redraws the page
function collapse(row, then) {
  if (!row || reduced()) { then(); return; }
  const h = row.offsetHeight;
  const a = row.animate([{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }], { duration: 240, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  row.style.overflow = 'hidden';
  a.onfinish = then;
}

// Life today: each app's live number in its own small ring; tap opens the app, + is its quick log. Only what an app
// really reports (its summary()); a new user sees nothing here until an app has something to say.
const LIFE_ORDER = ['money', 'body', 'growth', 'soul', 'mind', 'mission', 'family', 'friends', 'romance'];
function lifeInfo(id) {
  let s = {};
  try { s = summary(id) ?? {}; } catch { s = {}; }
  if (s.mock || s.sample) return { id, name: s.name };
  return { id, name: s.name, line: s.line, metric: s.metric, streak: s.streak, quick: s.quick ?? [], next: s.next };
}
function lifeLane() {
  const items = LIFE_ORDER.map(lifeInfo).filter((x) => (x.metric && x.metric.v != null) || (x.streak && x.streak.n != null))
    .sort((a, b) => (b.streak?.atRisk ? 1 : 0) - (a.streak?.atRisk ? 1 : 0)).slice(0, 6);
  if (!items.length) return '';
  return `<section class="td-life" aria-label="Life today">
    <div class="sh td-sh"><h2>Life today</h2><button class="sh-act" data-act="td-life" aria-label="Open the wheel">Wheel ${I.chevR}</button></div>
    <div class="td-rail td-life-rail" data-rail="life" data-scroll-x>${items.map(lifeItem).join('')}</div>
  </section>`;
}
function lifeItem(x) {
  const m = x.metric ?? {}; const risk = x.streak?.atRisk;
  const priv = x.streak?.private;
  const v = m.v ?? (priv ? null : x.streak?.n);
  const unit = m.unit ? (/^\//.test(m.unit) ? `<small>${esc(m.unit)}</small>` : `<small> ${esc(m.unit)}</small>`) : '';
  const fig = v == null ? esc(x.streak?.text ?? '') : m.unit === '₹' ? `₹${Number(v).toLocaleString('en-IN')}` : m.unit === 'h' ? dur(v * 60) : m.of ? `${v}<small>/${m.of}${m.unit ?? ''}</small>` : `${v}${unit}`;
  const tail = priv && x.streak?.text ? ` · ${esc(x.streak.text)}` : risk && x.next?.at ? ` · <span class="late">${esc(x.next.at)}</span>` : '';
  const label = `${esc(m.label ?? (priv ? x.name : x.streak?.label) ?? '')}${tail}`;
  const q = x.quick[0];
  return `<div class="td-lf surface${risk ? ' risk' : ''}" data-aspect="${x.id}">
    <button class="td-lf-b" data-act="td-aspect" data-id="${x.id}" aria-label="${esc(`${x.name}: ${x.line ?? ''}. Open ${x.name}`)}">
      ${ring(m.p ?? (risk ? 0.15 : 0), x.id, 36, 4, { inner: `<span class="td-lf-g">${risk ? I.flame : aspectIcon[x.id]}</span>` })}
      <span class="td-lf-t"><b class="met">${fig}</b><small>${label}</small></span>
    </button>
    ${q ? `<button class="td-lf-q" data-act="${esc(q.act)}" data-aspect="${x.id}" aria-label="${esc(q.label)}">${q.icon ?? I.plus}</button>` : ''}
  </div>`;
}
on('td-aspect', (el) => api.openAspect(el.dataset.id));
on('td-life', () => setTab('life'));
// the apps load and change on their own clock: when one says its numbers moved, only the lane is drawn again
const lifeSoon = (() => { let t = 0; return () => { clearTimeout(t); t = setTimeout(refreshLife, 250); }; })();
['aspect-summary', 'aspect-changed', 'aspect-registered', 'growth-changed', 'sou:state', 'life-changed'].forEach((n) => document.addEventListener(n, lifeSoon));
document.addEventListener('data-changed', (e) => { if (e.detail?.why === 'people') lifeSoon(); });
function refreshLife() {
  const sc = $('#todayScroll');
  if (!sc || currentTab() !== 'today' || S.view !== 'day' || S.date !== TODAY || document.querySelector('.td-dragging, .td-moving')) return;
  const html = lifeLane(); const old = $('.td-life', sc);
  if (!old) { if (html) draw(); return; }
  if (!html) { old.remove(); return; }
  const t = document.createElement('div'); t.innerHTML = html.trim();
  const next = t.firstElementChild;
  if (!next || next.innerHTML === old.innerHTML) return;
  const x = $('.td-life-rail', old)?.scrollLeft ?? 0;
  old.replaceWith(next);
  const r = $('.td-life-rail', next); if (r) r.scrollLeft = x;
}

// The tray: tasks due today with no time yet, and the late ones carried over as one calm group. Hold one and drag it.
function tray() {
  const u = unplanned();
  const n = u.today.length + u.late.length;
  if (!n) return '';
  const pill = (t) => `<div class="td-pill surface" data-id="${t.id}" style="--c:var(--${t.aspect ?? 'mission'})">
      <button class="check" data-act="task-check" data-id="${t.id}" aria-label="Mark done: ${esc(t.title)}">${I.check}</button>
      <button class="td-pill-b" data-act="td-place" data-id="${t.id}" aria-label="${esc(`${t.title}, ${dur(lenOf(t))}. Give it a time`)}">
        <span class="td-pill-t">${esc(t.title)}</span>
        <span class="td-pill-m">${dot(t.aspect)}<span class="num">${dur(lenOf(t))}</span><span>· ${esc(t.goal ? goalShort(t.goal) : t.project ? projectName(t.project) : areaName(t.area))}</span></span>
      </button>
    </div>`;
  const late = u.late.length ? `<button class="td-pill td-late surface" data-act="td-late" aria-label="${plural(u.late.length, 'task')} carried over from earlier days">
      <span class="td-late-n met">${u.late.length}</span><span class="td-late-t"><b>Carried over</b><small>from earlier days</small></span></button>` : '';
  return `<section class="td-tray" id="tdTray" aria-label="Unplanned">
    <div class="sh td-sh"><h2>To place</h2><span class="sh-count">${n}</span><button class="sh-act" data-act="td-tasks">All tasks ${I.chevR}</button></div>
    <div class="td-rail td-tray-rail" data-rail="tray" data-scroll-x>${u.today.map(pill).join('')}${late}</div>
  </section>`;
}
on('td-place', (el) => openPlace(el.dataset.id));
on('td-late', () => openLate());
on('td-tasks', () => openTasks());
on('td-plan', () => openPlan());
on('td-shut', () => openShutdown());

// ── the timeline: the rest of today on one line, every app's moment on it ──
function timeline() {
  const rest = restOfToday();
  const n = nightOf(TODAY);
  const rows = [earlierRows(), ...rest.map((x) => (x.gap ? gapRow(x) : blockRow(x))), S.night ? '' : sleepRow(), S.night ? nightEnd() : '', tomorrowRow()];
  const un = untagged();
  const unN = un.reduce((a, g) => a + g.count, 0);
  return `<section class="td-day" aria-label="Rest of today">
    <div class="sh td-sh"><h2>${S.night ? 'Tonight' : 'Rest of today'}</h2><span class="sh-count num">to ${hm(S.night ? n.wake : bed(TODAY))}</span>${S.night ? `<button class="sh-act" data-act="td-night">Hide the night ${I.chevU}</button>` : ''}</div>
    <ol class="td-tl" id="tdTimeline">${rows.join('')}</ol>
    ${unN ? `<button class="td-untag" data-act="td-tags">${I.tag}<span>${plural(unN, 'block')} this week ${unN === 1 ? 'has' : 'have'} no area</span><b>Tag them</b></button>` : ''}
    <p class="hint td-hint">Hold a task in To place and drag it into a free slot. Hold a block to move it; grab its lower edge to stretch it.</p>
  </section>`;
}
const nodeH = (d) => Math.round(Math.min(84, 30 + Math.max(0, d - 15) * 0.42));
const WORKOUT = /\b(gym|workout|cardio|run|yoga|walk|lifting|training|abs|stretch|swim|defen[cs]e|boxing|sport)\b/i;
function blockRow(b, { past = false, other = false } = {}) {
  const isNow = !past && !other && b.start <= NOW && b.end > NOW;
  const d = b.end - b.start, h = nodeH(d);
  const isTask = b.kind === 'task'; const t = isTask ? task(b.task) : null; const done = isTask && isDone(t);
  const act = isTask ? `data-act="task" data-id="${b.task}"` : `data-act="event" data-id="${b.id}"`;
  const p = isNow ? (NOW - b.start) / d : 0;
  const x = other ? { meta: '', action: '' } : extra(b, { isNow, past });
  const untag = !isTask && !b.aspect && !b.area;
  const movable = !past && b.editable !== false && !(b.date === TODAY && b.end <= NOW);
  const node = untag ? `<span class="tile td-tile td-untagged" style="--h:${h}px">${I.tag}</span>` : tile(b.aspect ?? (isTask ? 'mission' : 'mission'), `td-tile${isNow ? ' now' : ''}${isTask ? ' is-task' : ''}`);
  return `<li class="td-row td-blk${isNow ? ' is-now' : ''}${done ? ' is-done' : ''}${past ? ' past' : ''}${isTask ? ' is-task' : ''}${untag ? ' untagged' : ''}${movable ? ' can-move' : ''}${S.fresh?.has(b.task) ? ' td-new' : ''}" style="--h:${h}px" data-id="${esc(b.id)}" data-aspect="${b.aspect ?? ''}"${b.task ? ` data-task="${b.task}"` : ''}>
    <span class="td-time num">${hm(b.start)}</span>
    <span class="td-node">${node}${isNow ? `<i class="td-fill" style="--p:${p.toFixed(3)}"></i>` : ''}</span>
    <div class="td-rb">
      <button class="td-main" ${act}>
        <b class="td-rt">${esc(b.title)}</b>
        <small class="td-rm"><span class="num">${isNow ? `until ${hm(b.end)} · ${dur(b.end - NOW)} left` : `${hm(b.start)}–${hm(b.end)} · ${dur(d)}`}</span>${b.aspect ? `<span>· ${esc(aspectName(b.aspect))}</span>` : untag ? '<span class="td-noarea">· No area</span>' : ''}</small>
        ${x.meta}
      </button>
      ${x.action}${isTask ? `<button class="check ${done ? 'done' : ''}" data-act="task-check" data-id="${b.task}" aria-label="${done ? 'Mark not done' : 'Mark done'}: ${esc(b.title)}">${I.check}</button>` : ''}
    </div>
    ${isNow ? `<span class="td-nowline" style="--p:${p.toFixed(3)}" aria-hidden="true"><b class="num">${hm(NOW)}</b></span>` : ''}
  </li>`;
}
// what each block has to say: the task in progress inside it, the goal a task moves, where it is, the app it opens
function extra(b, { isNow, past }) {
  const out = { meta: '', action: '' };
  if (past) return out;
  const line = (html, cls = '') => `<small class="td-rx ${cls}">${html}</small>`;
  const btn = (label, a, attrs = '') => `<button class="chip sm td-bact" data-act="${a}"${attrs}>${label}</button>`;
  if (isNow) {
    const t = doingNow();
    if (t && b.task !== t.id) out.meta = line(`${I.play}<span class="ell">Doing: ${esc(t.title)}</span>${spentOf(t).today ? `<span class="num">· ${spentOf(t).spent}m of ${spentOf(t).est}m</span>` : ''}`, 'td-doing');
  }
  if (b.kind === 'task') {
    const t = task(b.task);
    if (t?.goal) { const g = goal(t.goal); if (g) out.meta += line(`${I.flag}<span class="ell">${esc(goalShort(g.id))} · <span class="${g.verdict === 'Behind pace' ? 'late' : ''}">${esc(g.verdict.toLowerCase())}</span></span>`, 'td-goal'); }
    else if (t?.project) out.meta += line(`<span class="ell">${esc(projectName(t.project))}</span>`);
    if (S.fresh?.has(b.task)) out.meta += line(`${I.sparkle}<span>Just placed</span>`, 'td-placed');
    return out;
  }
  if (!b.aspect && !b.area) { out.action = btn('Tag', 'event', ` data-id="${esc(b.id)}"`); return out; }
  if (b.where && !isNow) out.meta += line(`<span class="ell">${esc(String(b.where).split(',')[0].trim())}</span>`);
  if (b.aspect === 'body' && WORKOUT.test(b.title) && has('startWorkout') && (isNow || b.start - NOW < 120)) out.action = btn('Start', 'td-workout');
  else if (DEMO_MODE && b.ev?.task === 't5') { out.meta = line(`<span class="ell">${esc(contentLine())}</span>`); out.action = btn('Pack', 'td-content'); }
  return out;
}
const contentLine = () => { let s = null; if (has('contentSummary')) { try { s = api.contentSummary(); } catch { s = null; } } return s?.line ?? `Pack ready · ${CONTENT.pack?.scripts ?? ''} scripts`; };
on('td-content', () => (has('openContent') ? api.openContent('pack') : setTab('content')));
on('td-workout', () => api.startWorkout());
on('td-people', (el) => api.openPerson(el.dataset.id));

function gapRow(g) {
  const len = g.end - g.start;
  return `<li class="td-row td-gap${g.sleep ? ' in-sleep' : ''}" style="--h:${Math.round(Math.min(64, 26 + len * 0.5))}px" data-start="${g.start}" data-end="${g.end}">
    <span class="td-time num">${hm(g.start)}</span>
    <span class="td-node"></span>
    <div class="td-rb"><button class="td-gap-b" data-act="td-gap" data-start="${g.start}" data-end="${g.end}"${g.sleep ? ' data-sleep="1"' : ''} aria-label="${dur(len)} ${g.sleep ? 'of sleep' : 'free'} from ${hm(g.start)}. Fill it">
      <span class="td-gap-t">${g.sleep ? `${I.moon}<b class="num">${dur(len)}</b> of night · work in it` : `<b class="num">${dur(len)}</b> free`}</span><span class="td-gap-fit" aria-hidden="true"></span>${I.plus}</button></div>
  </li>`;
}
on('td-gap', (el) => openGap(Number(el.dataset.start), Number(el.dataset.end), { sleep: !!el.dataset.sleep }));

function earlierRows() {
  const past = earlierToday();
  if (!past.length) return '';
  const done = doneToday().length;
  const names = [...new Set(past.map((b) => shortTitle(b.title).split(/ ·|:| \(| - /)[0].replace(/^Morning /, '')))].slice(0, 4).join(', ');
  const row = `<li class="td-row td-fold">
    <span class="td-time num">${hm(past[0].start)}</span>
    <span class="td-node"><span class="td-dots">${past.slice(0, 4).map((b) => `<i style="--c:${colorOf(b)}"></i>`).join('')}</span></span>
    <div class="td-rb"><button class="td-fold-b" data-act="td-earlier" aria-expanded="${S.earlier}">
      <span class="td-fold-t"><b>Earlier today</b><small class="ell">${esc(names)} · ${plural(done, 'task')} done</small></span>${S.earlier ? I.chevU : I.chevD}</button></div>
  </li>`;
  if (!S.earlier) return row;
  const pl = plannedToday();
  const items = past.map((b) => ({ at: b.start, html: blockRow(b, { past: true }) }));
  if (pl) items.push({ at: pl.at ?? 0, html: `<li class="td-row td-blk past td-ritual" style="--h:30px"><span class="td-time num">${hm(pl.at ?? 0)}</span><span class="td-node"><span class="td-tile tile td-orb"><span class="orb xs"></span></span></span>
    <div class="td-rb"><span class="td-main"><b class="td-rt">Planned the day with ${esc(AGENT.name)}</b><small class="td-rm">${plural(pl.n ?? 0, 'task')} placed${pl.by === 'pc' ? ' · her plan' : ''}</small></span>${I.check}</div></li>` });
  if (DEMO_MODE) for (const f of FEED.filter((x) => x.kind === 'did')) items.push({ at: Number(f.at.slice(0, 2)) * 60 + Number(f.at.slice(3)), html: `<li class="td-row td-blk past td-did" style="--h:30px"><span class="td-time num">${f.at}</span><span class="td-node"><span class="td-tile tile td-orb"><span class="orb xs"></span></span></span>
      <div class="td-rb"><button class="td-main" data-act="td-agent"><b class="td-rt">${esc(f.title)}</b><small class="td-rm"><span class="ell">${esc(AGENT.name)} · ${esc(f.text)}</span></small></button></div></li>` });
  return row + items.sort((a, b) => a.at - b.at).map((x) => x.html).join('');
}
on('td-earlier', () => { S.earlier = !S.earlier; haptic('selection'); draw(); if (S.earlier) stagger($$('.td-blk.past', $('#todayScroll')), { y: -6, each: 25, max: 220 }); });

function sleepRow() {
  const n = nightOf(TODAY);
  const len = n.wake - n.bed;
  return `<li class="td-row td-blk td-sleep" style="--h:36px">
    <span class="td-time num">${hm(n.bed)}</span>
    <span class="td-node"><span class="tile td-tile td-moon">${I.moon}</span></span>
    <div class="td-rb"><button class="td-main" data-act="sleep"><b class="td-rt">Sleep</b><small class="td-rm num">Until ${hm(n.wake)} · ${dur(len)}</small></button>
      <button class="chip sm td-bact" data-act="td-night" aria-label="Open the night to plan work in its hours">Night</button><button class="chip sm td-bact" data-act="sleep">Change</button></div>
  </li>`;
}
function nightEnd() {
  const n = nightOf(TODAY);
  return `<li class="td-row td-blk td-sleep" style="--h:30px"><span class="td-time num">${hm(n.wake)}</span><span class="td-node"><span class="tile td-tile td-moon">${I.sun}</span></span>
    <div class="td-rb"><button class="td-main" data-act="sleep"><b class="td-rt">Wake up</b><small class="td-rm num">Sleep ${hm(n.bed)}–${hm(n.wake)} · change it</small></button></div></li>`;
}
function tomorrowRow() {
  const iso = addDays(TODAY, 1), d = day(iso);
  const evs = known(iso) ? blocksOn(iso).filter((b) => b.kind === 'event') : [];
  const due = dueOn(iso).length + blocksOn(iso).filter((b) => b.kind === 'task').length;
  return `<li class="td-row td-next">
    <span class="td-time num"></span><span class="td-node"><span class="tile td-tile">${I.cal}</span></span>
    <div class="td-rb"><button class="td-main" data-act="td-day" data-iso="${iso}"><b class="td-rt">Tomorrow, ${esc(d.short)}</b>
      <small class="td-rm"><span class="num">${known(iso) ? (evs.length ? `${plural(evs.length, 'event')}, first at ${hm(evs[0].start)}` : 'Nothing on the calendar') : 'Calendar loading'}</span>${due ? `<span>· ${plural(due, 'task')}</span>` : ''}</small></button>${I.chevR}</div>
  </li>`;
}
on('td-night', () => { S.night = !S.night; haptic('selection'); draw(); if (S.night) setTimeout(() => $('#todayScroll .td-gap.in-sleep')?.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }), 60); });
on('sleep', () => openSleep());

// ── another day: the same timeline, whole, with its own glance on top ──
function dayOther(iso) {
  ensureRange(iso, 1);
  const d = day(iso); const past = iso < TODAY;
  if (!known(iso)) return `<div class="td-body"><section class="td-hero td-glance surface"><p class="note td-unknown">${I.cal}<span>${esc(d.long)} isn't on this phone yet. It loads from your PC when it's online.</span></p></section></div>`;
  const blocks = blocksOn(iso);
  const bookedMin = bookedOn(iso) ?? 0;
  const free = freeOn(iso) ?? 0;
  const due = dueOn(iso);
  const rows = [];
  const w = { wake: wake(iso), bed: bed(iso) };
  let cur = w.wake;
  for (const b of blocks) {
    if (b.start - cur >= 30 && !past && b.start <= w.bed) rows.push(gapRowStatic(cur, b.start, iso));
    rows.push(blockRow(b, { past, other: true }));
    cur = Math.max(cur, b.end);
  }
  if (!past && w.bed - cur >= 30) rows.push(gapRowStatic(cur, w.bed, iso));
  return `<div class="td-body">${allDay(iso)}
    <section class="td-hero td-glance surface" aria-label="${esc(d.long)}">
      <div class="td-gl">
        <div><b class="met">${rollHTML(blocks.filter((b) => b.kind === 'event').length)}</b><small>${blocks.filter((b) => b.kind === 'event').length === 1 ? 'event' : 'events'}</small></div>
        <div><b class="met">${dur(bookedMin)}</b><small>booked</small></div>
        <div><b class="met">${past ? '—' : dur(free)}</b><small>free</small></div>
        <div><b class="met">${rollHTML(due.length + blocks.filter((b) => b.kind === 'task').length)}</b><small>${due.length === 1 ? 'task' : 'tasks'}</small></div>
      </div>
      ${due.length ? `<div class="group td-gl-tasks">${due.map(taskRow).join('')}</div>` : ''}
    </section>
    <section class="td-day"><ol class="td-tl">${rows.join('') || '<li class="td-row"><span></span><span></span><p class="note">Nothing on the calendar.</p></li>'}</ol></section>
  </div>`;
}
const gapRowStatic = (s, e, iso) => `<li class="td-row td-gap" style="--h:${Math.round(Math.min(64, 26 + (e - s) * 0.12))}px"><span class="td-time num">${hm(s)}</span><span class="td-node"></span><div class="td-rb"><button class="td-gap-b" data-act="td-gap-other" data-iso="${iso}" data-start="${s}" data-end="${e}" aria-label="${dur(e - s)} free from ${hm(s)}. Add a task"><span class="td-gap-t"><b class="num">${dur(e - s)}</b> free</span>${I.plus}</button></div></li>`;
on('td-gap-other', (el) => api.addTask({ date: el.dataset.iso, at: Math.ceil(Number(el.dataset.start) / 15) * 15, len: Math.min(30, Number(el.dataset.end) - Number(el.dataset.start)) }));

// ── the accessory: what you are doing now, in the dock's chrome ─────
// a task started a while ago (or by a job, hours back) is in progress, not a timer: its ring is simply full
function spentOf(t) {
  const started = t.startedAt ? Date.parse(t.startedAt) : null;
  const spent = t.spent ?? (started ? Math.max(0, Math.round((Date.now() - started) / 60000)) : 0);
  const est = t.est ?? lenOf(t);
  const timer = !REAL || (started && dateOfMs(started) === TODAY && spent <= Math.min(360, Math.max(est * 2, est + 60)));
  const since = !started ? null : dateOfMs(started) === TODAY ? hm(Math.round((started - Date.parse(`${TODAY}T00:00:00+05:30`)) / 60000)) : rel(dateOfMs(started));
  return { today: !!timer, spent, est, since };
}
const dateOfMs = (ms) => new Date(ms + 330 * 60000).toISOString().slice(0, 10);
export function renderAccessory() {
  const acc = $('#accessory'); if (!acc) return;
  const f = fit();
  const side = f.count ? `<button class="acc-side" data-act="td-toplace">To place <span class="n">${f.count}</span></button>` : '';
  const t = doingNow();
  let html;
  if (t) {
    const s = spentOf(t);
    if (s.today) html = `<button class="acc-main" data-act="task" data-id="${t.id}"><span class="acc-ring">${ring(s.spent / Math.max(1, s.est), 'today', 36, 4.5, { label: `${s.spent} of ${s.est} minutes` })}</span>
      <span class="acc-t"><b>${esc(t.title)}</b><small class="num">${dur(s.spent)} of ${dur(s.est)}${s.spent < s.est ? ` · ${dur(s.est - s.spent)} left` : ' · over the estimate'}</small></span></button>`;
    else html = `<button class="acc-main" data-act="task" data-id="${t.id}"><span class="acc-ring">${ring(1, 'today', 36, 4.5, { label: 'In progress' })}</span>
      <span class="acc-t"><b>${esc(t.title)}</b><small>In progress since ${esc(s.since ?? 'earlier')}</small></span></button>`;
  } else {
    const nxt = blocksOn(TODAY).filter((b) => b.kind === 'task' && b.start > NOW && !b.done).sort((a, b) => a.start - b.start)[0];
    html = nxt ? `<button class="acc-main" data-act="task" data-id="${nxt.task}"><span class="acc-ring">${ring(0, 'today', 36, 4.5)}</span><span class="acc-t"><b>${esc(nxt.title)}</b><small class="num">Next, at ${hm(nxt.start)}</small></span></button>`
      : `<button class="acc-main" data-act="td-tasks"><span class="acc-ring acc-idle">${I.play}</span><span class="acc-t"><b>Nothing in progress</b><small>Pick a task and start it</small></span></button>`;
  }
  if (acc._html === html + side) return;
  acc._html = html + side;
  acc.innerHTML = html + side;
}
on('td-toplace', () => {
  const go = () => { const tr = $('#tdTray'); const sc = $('#todayScroll'); if (tr && sc) sc.scrollTo({ top: tr.offsetTop - 110, behavior: 'smooth' }); };
  if (currentTab() !== 'today' || S.view !== 'day' || S.date !== TODAY) { S.view = 'day'; S.date = TODAY; setTab('today'); requestAnimationFrame(() => requestAnimationFrame(go)); } else go();
});

// For a folded dock: the doing-now ring at tab-glyph size, '' when nothing is in progress
export function doingRing(size = 25, w = 3) {
  const t = doingNow();
  if (!t) return '';
  const s = spentOf(t);
  return ring(s.today ? s.spent / Math.max(1, s.est) : 1, 'today', size, w, { label: `${t.title}: ${s.today ? `${s.spent} of ${s.est} minutes` : 'in progress'}` });
}

// ── jobs, as Work shows them (Work imports jobRing; jobRowMini and stepsHtml stay for anyone who needs a compact row) ──
export const jobRing = (j, size = 46, w = 4.5) => ring(j.progress ? j.progress.done / j.progress.total : 0, 'jobs', size, w, {
  cls: `jring${j.lane === 'working' ? ' running' : ''}`,
  inner: `<span class="agent ${j.agent}">${I[j.agent]}</span>${j.lane === 'needs' ? '<em class="jbadge" aria-hidden="true"></em>' : ''}`,
  label: j.progress ? `${j.progress.done} of ${j.progress.total} steps${j.lane === 'working' ? ', running' : ''}` : '',
});
export function jobRowMini(j) {
  const needs = j.lane === 'needs';
  const right = !needs ? ''
    : j.ask?.kind === 'permission'
      ? `<button class="btn sm tint jr-act" style="--c:var(--needs)" data-act="allow" data-id="${j.id}" aria-label="Allow: ${esc(j.ask.text)}">Allow</button>`
      : `<button class="btn sm tint jr-act" style="--c:var(--needs)" data-act="job" data-id="${j.id}">Answer</button>`;
  const meta = needs
    ? `<span class="amber">Needs you</span><span class="ell">${esc(j.ask?.text ?? '')}</span>`
    : j.progress ? `<span class="met c-jobs jr-n">${j.progress.done}/${j.progress.total}</span><span class="ell">${esc(j.progress.step)}</span>` : `<span class="ell">${esc(j.last ?? '')}</span>`;
  return `<div class="row jrow" data-id="${j.id}">
    <button class="jr-main" data-act="job" data-id="${j.id}">${jobRing(j, 42, 4)}
      <span class="rbody"><span class="rtitle">${esc(j.title)}</span><span class="rmeta">${meta}</span></span></button>${right}</div>`;
}
export const stepsHtml = (p) => Array.from({ length: p.total }, (_, i) => `<i class="${i < p.done ? 'done' : i === p.done ? 'on' : ''}"></i>`).join('');

// ── hold to peek: a block (held without moving), or the Today tab itself ──
onHold(document, '.tab[data-tab="today"]', () => {
  const list = leftToday();
  const f = fit();
  peek(`<div class="pk"><div class="kicker">Today</div><h3 class="t1">${plural(list.length, 'task')} left</h3><p class="foot">${f.free ? `${dur(f.free)} free before bed` : 'No free time left'}</p>
    <div class="group">${list.slice(0, 4).map(taskRow).join('')}</div></div>`, [['Plan the rest', I.sparkle, 'td-pk-plan'], ['All tasks', I.inbox, 'td-pk-tasks']]);
});
document.addEventListener('td-peek-block', (e) => {
  const b = e.detail?.blk; if (!b) return;
  if (b.kind === 'task') { const t = task(b.task); if (!t) return; peek(`<div class="pk"><div class="kicker">${dot(t.aspect)} ${esc(t.aspect ? aspectName(t.aspect) : 'Task')} · <span class="num">${hm(b.start)}–${hm(b.end)}</span></div><h3 class="t1">${esc(t.title)}</h3><p class="foot">Drag to move it, or its lower edge to stretch it</p></div>`, [['Open', I.edit, 'td-pk-task'], ['Done', I.check, 'td-pk-done'], ['Tomorrow', I.cal, 'td-pk-tmr']]); $('#peek')._blk = b; return; }
  const ev = findEvent(b.id); if (!ev) return;
  peek(`<div class="pk"><div class="kicker">${dot(ev.aspect)} ${esc(ev.aspect ? aspectName(ev.aspect) : 'No area')} · <span class="num">${hm(ev.start)}–${hm(ev.end)}</span></div><h3 class="t1">${esc(ev.full || ev.title)}</h3>${ev.where ? `<p class="foot">${esc(ev.where)}</p>` : '<p class="foot">Drag to move it, or its lower edge to stretch it</p>'}</div>`,
    [['Open', I.cal, 'td-pk-open'], ...(ev.aspect ? [[`Open ${aspectName(ev.aspect)}`, aspectIcon[ev.aspect] ?? I.grid, 'td-pk-aspect']] : [['Tag it', I.tag, 'td-pk-open']])]);
  $('#peek')._blk = b;
});
on('td-pk-plan', () => { closePeek(); openPlan(); });
on('td-pk-tasks', () => { closePeek(); openTasks(); });
on('td-pk-open', () => { closePeek(); const b = $('#peek')._blk; if (b) openEvent(b.id); });
on('td-pk-aspect', () => { closePeek(); const b = $('#peek')._blk; const ev = b && findEvent(b.id); if (ev?.aspect) api.openAspect(ev.aspect); });
on('td-pk-task', () => { closePeek(); const b = $('#peek')._blk; if (b) openTask(b.task); });
on('td-pk-done', () => { closePeek(); const b = $('#peek')._blk; if (b) complete(b.task); });
on('td-pk-tmr', () => { closePeek(); const b = $('#peek')._blk; if (b) toTomorrow(b.task); });

// Allow on Today runs Work's own handler; afterwards the needs row recounts
document.addEventListener('click', (e) => { if (e.target.closest('[data-act="allow"]')) setTimeout(() => { if (currentTab() === 'today') draw(); }, 0); });
// a task that just got a time: Today shows its day and brings the block into view
document.addEventListener('td-reveal', (e) => {
  const id = e.detail?.id; const t = task(id); if (!t) return;
  if (e.detail?.fresh) { S.fresh = new Set([id]); setTimeout(() => { S.fresh = null; }, 1400); }
  const go = () => {
    const sc = $('#todayScroll'); const row = sc && $(`.td-row[data-task="${CSS.escape(id)}"]`, sc);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' });
    row.classList.remove('td-flash'); void row.offsetWidth; row.classList.add('td-flash');
  };
  if (currentTab() === 'today' && S.view === 'day' && S.date === (dateOf(t) ?? TODAY)) requestAnimationFrame(go);
});

// ── the bus ───────────────────────────────────────────────────────────
provide('openEvent', (id) => openEvent(id));
provide('openCalendar', (view = 'day', date = TODAY) => {
  // on Today itself the calendar switches in place; from anywhere else it opens as a page, so their back stack stays
  if (currentTab() === 'today' && !$('#stack')?.children.length) { S.view = view; S.date = date ?? TODAY; draw(); swapIn(); return; }
  openCalendar(view, date);
});
provide('planDay', (kind) => openPlan(kind));
provide('shutdownDay', () => openShutdown());
provide('placeTask', (id) => openPlace(id));
provide('openTags', () => openTags());
provide('openSleep', () => openSleep());
/** What Today knows about the day, for the agent and other apps: free time, what is late, what is next. */
provide('todaySummary', () => {
  const f = fit(); const { c, nxt } = heroNow();
  return { free: f.free, need: f.need, short: Math.max(0, f.over), toPlace: f.count, late: f.late, left: leftToday().length, done: doneToday().length,
    now: c ? { title: c.title, until: hm(c.end) } : null, next: nxt ? { title: nxt.title, at: hm(nxt.start) } : null, bed: hm(bed(TODAY)), closed: closedToday() };
});

// ── links: agenticos://today/plan · today/shutdown · today/tag · today/sleep ──
registerRoute('today/plan', (L, c) => { c.tab('today'); c.after(() => openPlan(L.arg === 'tomorrow' ? 'tomorrow' : 'rest')); });
registerRoute('today/shutdown', (L, c) => { c.tab('today'); c.after(() => openShutdown()); });
registerRoute('today/tag', (L, c) => { c.tab('today'); c.after(() => openTags()); });
registerRoute('today/sleep', (L, c) => { c.tab('today'); c.after(() => openSleep()); });

// ── the widgets and the Day Live Activity: Today's own count of done and left, and what is up next ──
snapshotPart('done', () => doneToday().length);
snapshotPart('total', () => doneToday().length + leftToday().length);
snapshotPart('up', () => {
  const t = doingNow();
  const timed = blocksOn(TODAY).filter((b) => b.kind === 'task' && !b.done && b.end > NOW).sort((a, b) => a.start - b.start).map((b) => task(b.task)).filter(Boolean);
  const u = unplanned();
  return [...new Set([t, ...timed, ...u.late, ...u.today].filter(Boolean).map((x) => x.title))].slice(0, 3);
});

// for the screenshot steps and the console: the state and the sheets
window.__td = { S, draw, place, openPlan, openShutdown, openTask, openEvent, openTasks, addTask, openPlace, openGap, openLate, openSleep, openTags, fit, unplanned, blocksOn };
export { S as todayState };

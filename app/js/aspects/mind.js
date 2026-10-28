// Mind (Health family): what he reads, watches, learns and scrolls. Owner: the Mind agent.
// Files: this one (the app: sections, bus, actions), mind-data.js (the live model; mind-demo.js is the prototype's sample
// for ?data=demo), mind-ui.js (charts, covers), mind-checkin.js (the evening check-in), mind-library.js (books, sessions,
// the log sheet, the ISBN scan), mind-courses.js (courses), mind-apppage.js (one app). Server: /api/v1/mod/mind/*.
// The frame, the colour (--as) and registerAspect() are in js/aspects.js. Prefix: min-.
import { $, esc, on, seg, ring, toast, haptic } from '../core.js';
import { I } from '../icons.js';
import { TODAY_LABEL, AGENT, addGoal } from '../data.js';
import { provide, api } from '../bus.js';
import { registerAspect, aspHead } from '../aspects.js';
import { registerRoute } from '../svc/route.js';
import { roll, rollHTML, reduced } from '../motion.js';
import {
  S, APPS, app, appMin, todayMin, usualByNow, usualDay, fmt, hm, BLOCKS, STREAK, WEEK, LAST_WEEK_AVG, FOR_WEEK, MONTH,
  PICKUPS, FOCUS, INPUTS, OUTPUTS, OUTPUT_ITEMS, BOOKS, book, YEAR_GOAL, YEAR_GONE, DAYS_LEFT, READ_GOAL, COURSES, LIBRARY,
  COLLEGE, LEARN_GOAL, NOTES, CHECKIN_AT, kindsNow, appFor, finished, pace, learnWeek, readWeekToday, courseLeft, KINDS,
  MD, REAL, USUAL, READ_GOAL_ID, onMind, load, nowMin, today, prog, durSec,
} from './mind-data.js';
import { MI, appTile, wynMark, cover, hourChart, wireHourChart, weekBars, meter, kindsGrid, monthHeat, weekRings, ensureMind, refreshMind, growIn, usualName } from './mind-ui.js';
import { openCheckin } from './mind-checkin.js';
import { openBook, startSession, openLog, openReview, handleBookScan, logReading, scanIsbn } from './mind-library.js';
import { openCourse, openLesson } from './mind-courses.js';
import { openAppPage } from './mind-apppage.js';

const asRing = (p, size, w, o) => ring(p, 'as', size, w, o);
const dotRing = (p, size) => ring(p, 'as', size, Math.max(3, Math.round(size / 7)));
const curBook = () => BOOKS.find((b) => b.status === 'reading') ?? null;
const curCourse = () => COURSES.find((c) => c.status === 'active') ?? null;
const lessonNo = (c) => (REAL ? c.cur + 1 : c.done);   // the prototype counted from 0; real lessons count from 1

// ── the sentence at the top of the day's chart, until an hour is tapped ──
function restLine() {
  const n = nowMin(), h = Math.floor(n / 60);
  const next = [h + 1, h + 2, h + 3].find((x) => (USUAL[x] ?? 0) >= 5);
  if (!REAL) return `<b>Usually ${fmt(48)} at 18:00, mostly Instagram</b><span>Starts in ${60 - (n % 60)} minutes · tap an hour to see what was in it</span>`;
  if (!APPS.length) return `<b>${MD.loaded ? 'Nothing on screen yet today' : 'Loading today…'}</b><span>${srcLine()}</span>`;
  if (next) return `<b>Usually ${fmt(USUAL[next])} at ${String(next).padStart(2, '0')}:00</b><span>${srcLine()} · tap an hour to see what was in it</span>`;
  return `<b>${fmt(todayMin())} so far, ${APPS.length} ${APPS.length === 1 ? 'app' : 'apps'}</b><span>${srcLine()} · tap an hour to see what was in it</span>`;
}
// where the numbers come from, said plainly: the PC's watcher, his own entries, and Screen Time once it's switched on
function srcLine() {
  if (!REAL) return 'From Screen Time';
  const s = MD.sources ?? {};
  const parts = [s.pc ? 'your PC' : null, s.manual ? 'what you told Wyn' : null, s.screenTime ? 'Screen Time' : null].filter(Boolean);
  return parts.length ? `From ${parts.join(' and ')}` : 'Phone Screen Time is off for now';
}
const delta = () => { const t = todayMin(), u = usualByNow(), d = t - u; return { t, u, d, top: !Object.keys(USUAL).length ? 'No usual yet' : Math.abs(d) < 5 ? 'About usual' : `${fmt(Math.abs(d))} ${d > 0 ? 'more' : 'less'}` }; };

// ═════════════════════════ TODAY (the app's home) ═════════════════════════
function renderHome(el, a) {
  const { t, top: deltaTop } = delta();
  const ci = S.checkin.done;
  const top = [...APPS].sort((x, y) => appMin(y) - appMin(x)).slice(0, 4);
  const maxApp = top.length ? appMin(top[0]) : 1;
  const inMin = INPUTS.reduce((s, x) => s + x.min, 0), outMin = OUTPUTS.reduce((s, x) => s + x.min, 0);
  const rm = S.readToday, lw = learnWeek();
  const b = curBook(), rd = curCourse();
  el.innerHTML = `
    ${aspHead(a, { title: 'Today', sub: `${TODAY_LABEL.weekday} ${TODAY_LABEL.day} ${TODAY_LABEL.month}` })}

    <section class="min-hero surface" aria-label="Screen time today">
      <div class="mh-top">
        <div class="mh-fig"><span class="mh-k">Screen time so far</span><b class="met mh-v" data-roll="${t}">${fmt(t)}</b></div>
        <div class="mh-d"><b>${deltaTop}</b><span>${Object.keys(USUAL).length ? `than usual by ${hm(nowMin())}` : 'A few more days and Wyn knows your usual'}</span></div>
      </div>
      <p class="mh-read" aria-live="polite">${restLine()}</p>
      ${hourChart()}
      <div class="min-legend"><span><i class="lg t"></i>Today</span><span><i class="lg u"></i>${esc(usualName())}</span><button class="min-lnk" data-act="min-go" data-s="screen">Details${I.chevR}</button></div>
    </section>

    ${ci ? checkinDoneCard() : checkinCard()}

    <div class="sh"><h2>Reading and learning</h2></div>
    <div class="group surface min-rl">
      ${b ? `<div class="row min-rlr">
        <button class="min-rlm" data-act="min-book" data-id="${b.id}">${asRing(rm / READ_GOAL, 40, 5, { label: `${rm} of ${READ_GOAL} minutes read today` })}
          <span class="rbody"><span class="rtitle">${esc(b.title)}</span><span class="rmeta">${rm >= READ_GOAL ? `${rm} min today · goal met` : rm ? `${rm} of ${READ_GOAL} min today` : REAL ? `${READ_GOAL} minutes is today’s goal${b.pages ? ` · page ${b.page} of ${b.pages}` : ''}` : 'Tonight 21:30 · 20 pages'}</span></span></button>
        <button class="btn sm min-rlb" data-act="min-read" data-id="${b.id}">${MI.timer}Read</button>
      </div>` : `<button class="row min-rlr min-rlm" data-act="min-go" data-s="library">${asRing(rm / READ_GOAL, 40, 5)}
        <span class="rbody"><span class="rtitle">${rm ? `${rm} min read today` : 'No book on the go'}</span><span class="rmeta">Scan a barcode or type a title to start one</span></span>${I.chevR}</button>`}
      ${rd ? `<div class="row min-rlr">
        <button class="min-rlm" data-act="min-course" data-id="${rd.id}">${asRing(rd.done / rd.lessons.length, 40, 5, { label: `${rd.done} of ${rd.lessons.length} lessons` })}
          <span class="rbody"><span class="rtitle">${esc(rd.title)}</span><span class="rmeta">Lesson ${lessonNo(rd)}${rd.at ? ` · from ${rd.at}` : ` · ${esc(rd.lessons[rd.cur ?? rd.done]?.[0] ?? '')}`}</span></span></button>
        <button class="btn sm min-rlb" data-act="min-lesson" data-c="${rd.id}">${I.play}${rd.at ? 'Resume' : 'Start'}</button>
      </div>` : ''}
      <button class="row min-rlr min-rlm" data-act="min-go" data-s="courses">${asRing(lw / LEARN_GOAL, 40, 5, { label: `${fmt(lw)} of ${fmt(LEARN_GOAL)} learning this week` })}
        <span class="rbody"><span class="rtitle">Learning this week</span><span class="rmeta">${fmt(lw)} of ${fmt(LEARN_GOAL)} · ${lw >= LEARN_GOAL ? 'goal met' : `${fmt(Math.max(0, LEARN_GOAL - lw))} to go by Sunday`}</span></span>${I.chevR}</button>
    </div>

    <div class="sh"><h2>Most used</h2>${APPS.length ? `<button class="sh-act" data-act="min-go" data-s="screen">All ${APPS.length}${I.chevR}</button>` : ''}</div>
    ${top.length ? `<div class="group surface min-apps">${top.map((x) => appRow(x, maxApp)).join('')}</div>`
      : `<p class="note surface">${MD.loaded ? 'Nothing yet today.' : 'Loading…'} ${REAL ? 'Your PC sends its time on its own. For the phone, tell Wyn (“Instagram 40 minutes”) in the log sheet until Screen Time is switched on.' : ''}</p>`}

    ${APPS.length ? `<div class="sh"><h2>What the time was for</h2></div>
    <section class="surface min-card min-kcard">
      ${kindsGrid(kindsNow())}
      <p class="min-cnote">${ci ? 'From your check-in tonight.' : `${esc(AGENT.name)}’s first sort, by app. Tonight’s answers settle it.`}</p>
    </section>` : ''}

    ${inMin + outMin ? `<div class="sh"><h2>Took in, made</h2></div>
    <section class="surface min-card min-io" aria-label="Inputs and outputs today">
      <div class="io-cols">
        <div><span class="io-k">Took in</span><b class="met" data-roll="${inMin}">${fmt(inMin)}</b></div>
        <div class="r"><span class="io-k">Made</span><b class="met" data-roll="${outMin}">${fmt(outMin)}</b></div>
      </div>
      <div class="min-io-bar" aria-hidden="true"><i class="in" style="flex:${inMin || 0.001}"></i><i class="out" style="flex:${outMin || 0.001}"></i></div>
      <div class="io-lists">
        <ul>${INPUTS.map((x) => `<li><span>${esc(x.name)}</span><b class="met">${fmt(x.min)}</b></li>`).join('')}</ul>
        <ul>${OUTPUTS.map((x) => `<li><span>${esc(x.name)}</span><b class="met">${fmt(x.min)}</b></li>`).join('')}</ul>
      </div>
      ${OUTPUT_ITEMS.length ? `<p class="min-cnote">Also made: ${OUTPUT_ITEMS.map(esc).join(', and ')}.</p>` : ''}
    </section>` : ''}

    <div class="sh"><h2>${esc(AGENT.name)} in Mind</h2></div>
    <div class="group surface min-ng">${wynRows()}
      <button class="row min-nr" data-act="min-ask"><span class="min-nt">${I.sparkle}</span><span class="rbody"><span class="rtitle">Ask about what you take in</span><span class="rmeta">“Was this week better than last?”</span></span>${I.chevR}</button>
    </div>`;
  wireHourChart(el, $('.mh-read', el), restLine());
  rollIn(el);
}
// numbers roll up from zero the first time a figure shows (motion kit), then from where they were last time
const rolled = new Map();
function rollIn(root) {
  const scope = root.querySelector('.asp-h, h1')?.textContent ?? '';
  root.querySelectorAll('[data-roll]').forEach((n, i) => {
    const v = Number(n.dataset.roll) || 0, k = `${scope}:${i}`, from = rolled.get(k) ?? 0;
    rolled.set(k, v);
    if (reduced() || from === v) { n.textContent = fmt(v); return; }
    try { n.innerHTML = rollHTML(from, { format: fmt }); requestAnimationFrame(() => requestAnimationFrame(() => roll(n, v, { format: fmt }))); } catch { n.textContent = fmt(v); }
  });
}
// what she did and noticed in Mind today, from the real day (the prototype's sample in demo mode)
function wynRows() {
  if (!REAL) return `
      <div class="row min-nr">
        <span class="min-nt"><i class="dot" style="--c:var(--needs)"></i>17:22</span>
        <span class="rbody"><span class="rtitle wrap">Instagram broke your deep work at 17:05 for 17 minutes</span>
          <span class="rmeta wrap">It usually pulls you in again around 18:00. Soul can hold it till cardio at 19:00.</span>
          <span class="min-nacts"><button class="btn sm tint" style="--c:var(--needs-ink)" data-act="min-blocker">Hold it till 19:00</button><button class="btn sm" data-act="min-ask" data-about="instagram">Ask why</button></span></span>
      </div>
      <div class="row min-nr"><span class="min-nt">16:45</span><span class="rbody"><span class="rtitle wrap">Sorted 6 apps on her own</span><span class="rmeta wrap">Claude, Gmail, Chrome and Camera as work, Skool as learning. She only asks about the three she can’t tell apart.</span></span></div>
      <div class="row min-nr"><span class="min-nt">09:47</span><span class="rbody"><span class="rtitle wrap">Logged 14 minutes of the Roadmap</span><span class="rmeta wrap">Lesson 8 on Skool, saved your place at 6:12.</span></span></div>`;
  const rows = [];
  const sorted = APPS.filter((x) => !BLOCKS.some((b) => b.app === x.id));
  if (sorted.length) rows.push(['', `Sorted ${sorted.length} ${sorted.length === 1 ? 'app' : 'apps'} on her own`, `${sorted.slice(0, 4).map((x) => `${x.name} as ${x.kind}`).join(', ')}. She only asks about the ones she can’t tell apart.`]);
  const byWyn = BLOCKS.filter((b) => b.by === 'wyn');
  if (byWyn.length && !S.checkin.done) rows.push(['', 'Her guesses for tonight are ready', byWyn.map((b) => b.why).filter(Boolean)[0] ?? `${byWyn.length} blocks, from the window titles.`]);
  if (S.checkin.done && S.checkin.source === 'agent') rows.push(['', 'Filed tonight’s check-in from what you told her', 'Open the record to change anything.']);
  const big = APPS.find((x) => x.kind === 'entertainment' && appMin(x) >= 45);
  if (big) rows.push([`<i class="dot" style="--c:var(--needs)"></i>`, `${big.name} is at ${fmt(appMin(big))} today`, 'Soul can hold it for a while if you want.', `<span class="min-nacts"><button class="btn sm tint" style="--c:var(--needs-ink)" data-act="min-blocker">Hold it</button><button class="btn sm" data-act="min-ask" data-about="${big.id}">Ask why</button></span>`]);
  return rows.map(([t, title, meta, extra = '']) => `<div class="row min-nr"><span class="min-nt">${t}</span><span class="rbody"><span class="rtitle wrap">${esc(title)}</span><span class="rmeta wrap">${esc(meta)}</span>${extra}</span></div>`).join('');
}

const appRow = (x, max) => `<button class="row ic min-apr" data-act="min-app" data-id="${x.id}">${appTile(x)}
  <span class="rbody"><span class="min-aprt"><span class="rtitle">${esc(x.name)}</span><b class="met">${fmt(appMin(x))}</b></span>
  ${meter(appMin(x) / max, 'sm')}<span class="rmeta">${esc(appFor(x))}</span></span>${I.chevR}</button>`;

function checkinCard() {
  const n = BLOCKS.length;
  const at = hm(CHECKIN_AT), late = nowMin() >= CHECKIN_AT;
  return `<section class="min-ci surface" aria-label="Tonight's check-in">
    <div class="ci-head">${wynMark()}<div class="ci-ht"><b>Tonight’s check-in</b><span>${late ? 'Open now' : at} · ${n ? `${n} ${n === 1 ? 'block' : 'blocks'}, about a minute` : 'one tap tonight'}</span></div></div>
    <p class="ci-say">${n ? `${n === 1 ? 'One block' : `${n === 2 ? 'Two' : 'Three'} blocks`} I can’t tell apart on my own. Two taps each and today is on the record.` : APPS.length ? 'I sorted every app on my own today. One tap tonight puts the day on the record.' : 'Nothing to sort yet. Tonight’s tap keeps the streak going.'}</p>
    ${n ? `<div class="ci-blocks">${BLOCKS.map((b) => { const x = app(b.app); return `<span class="ci-b"><b>${esc(x?.name ?? b.name)}</b><em class="met">${fmt(b.min)}</em></span>`; }).join('')}</div>` : ''}
    <div class="ci-foot">
      <button class="btn primary ci-go" data-act="min-checkin" style="--c:var(--as-fill)">${n ? 'Answer now' : 'File today'}</button>
      <span class="ci-streak" aria-label="${STREAK} nights in a row">${weekRings(WEEK, dotRing, 18)}<span class="ci-sn"><b class="met">${STREAK}</b> ${STREAK === 1 ? 'night' : 'nights'} in a row</span></span>
    </div>
  </section>`;
}
function checkinDoneCard() {
  const k = kindsNow();
  return `<section class="min-ci done surface" aria-label="Check-in done">
    <div class="ci-head">${wynMark()}<div class="ci-ht"><b>Today is on the record</b><span>Answered at ${hm(S.checkin.at ?? nowMin())} · ${STREAK + 1} ${STREAK ? 'nights' : 'night'} in a row</span></div>${asRing(1, 34, 5, { label: 'Check-in done' })}</div>
    <p class="ci-say">Work ${fmt(k.work)}, learning ${fmt(k.learning)}, people ${fmt(k.social)}, entertainment ${fmt(k.entertainment)}.${REAL ? '' : ' Filed to Mission, Friends and your learning week.'}</p>
    <div class="ci-foot"><button class="btn ci-go" data-act="min-checkin">See the record</button><span class="ci-streak"><span class="ci-sn"><b class="met">${STREAK + 1}</b> ${STREAK ? 'nights' : 'night'} in a row</span></span></div>
  </section>`;
}

// ═════════════════════════ SCREEN TIME ═════════════════════════
let scrView = 'day';
const weekAvgNow = () => { const past = WEEK.filter((w) => !w.today && w.total); return past.length ? Math.round(past.reduce((s, w) => s + w.total, 0) / past.length) : 0; };
function renderScreen(el, a) {
  const weekAvg = weekAvgNow();
  el.innerHTML = `
    ${aspHead(a, { title: 'Screen time', sub: `${fmt(todayMin())} today${weekAvg ? ` · ${fmt(weekAvg)} a day this week` : ''}` })}
    <div class="pad min-segw">${seg('min-scr', [['day', 'Day'], ['week', 'Week'], ['month', 'Month']], scrView)}</div>
    <div class="min-scr"></div>`;
  const body = $('.min-scr', el);
  const draw = () => { body.innerHTML = scrView === 'day' ? scrDay() : scrView === 'week' ? scrWeek(weekAvg) : scrMonth(); if (scrView === 'day') wireHourChart(body, $('.mh-read', body), restLine()); growIn(body); };
  $('[data-seg="min-scr"]', el).addEventListener('change', (e) => { scrView = e.detail; draw(); });
  draw();
}
function scrDay() {
  const { t, d } = delta();
  const max = Math.max(1, ...APPS.map(appMin));
  const k = kindsNow();
  const longest = APPS.flatMap((x) => (x.sessions ?? []).map((s) => [s[1], s[0], x.name])).sort((p, q) => q[0] - p[0])[0];
  const kpis = REAL ? `
      <div class="surface min-kpi"><span>Apps</span><b class="met">${APPS.length}</b><em>${esc(srcLine())}</em></div>
      <div class="surface min-kpi"><span>First</span><b class="met">${PICKUPS.first != null ? hm(PICKUPS.first) : '–'}</b><em>${PICKUPS.firstApp ? esc(PICKUPS.firstApp) : 'Nothing yet'}</em></div>
      <div class="surface min-kpi"><span>Longest</span><b class="met">${longest ? fmt(longest[0]) : '–'}</b><em>${longest ? `${esc(longest[2])} at ${hm(longest[1])}` : 'No sittings yet'}</em></div>`
    : `
      <div class="surface min-kpi"><span>Pickups</span><b class="met">${PICKUPS.n}</b><em>First at ${hm(PICKUPS.first)}, ${esc(PICKUPS.firstApp)}</em></div>
      <div class="surface min-kpi"><span>Notifications</span><b class="met">150</b><em>96 from WhatsApp</em></div>
      <div class="surface min-kpi"><span>Longest</span><b class="met">22m</b><em>Instagram at 13:36</em></div>`;
  return `
    <section class="min-hero surface big">
      <div class="mh-top">
        <div class="mh-fig"><span class="mh-k">Today so far</span><b class="met mh-v">${fmt(t)}</b></div>
        <div class="mh-d"><b>${Object.keys(USUAL).length ? `${fmt(Math.abs(d))} ${d > 0 ? 'more' : 'less'}` : 'No usual yet'}</b><span>${Object.keys(USUAL).length ? `than usual by ${hm(nowMin())}` : 'it takes a few days'}</span></div>
      </div>
      <p class="mh-read" aria-live="polite">${restLine()}</p>
      ${hourChart({ big: true, id: 'min-hcb' })}
      <div class="min-legend"><span><i class="lg t"></i>Today</span><span><i class="lg u"></i>${esc(usualName())}${usualDay() ? `, ${fmt(usualDay())} in all` : ''}</span></div>
    </section>
    <div class="min-kpis">${kpis}</div>
    ${APPS.length ? `<div class="sh"><h2>By kind</h2><span class="sh-count">${S.checkin.done ? 'your answers' : `${esc(AGENT.name)}’s sort`}</span></div>
    <div class="group surface min-kg">${KINDS.map((x) => `<div class="row min-kr"><span class="rbody"><span class="min-aprt"><span class="rtitle">${x.name}</span><b class="met">${fmt(k[x.id])}</b></span>${meter(k[x.id] / Math.max(1, ...Object.values(k)), 'sm')}</span></div>`).join('')}</div>
    <div class="sh"><h2>Apps</h2><span class="sh-count">${APPS.length}</span></div>
    <div class="group surface min-apps">${[...APPS].sort((x, y) => appMin(y) - appMin(x)).map((x) => appRow(x, max)).join('')}</div>` : ''}
    ${FOCUS.length ? `<div class="sh"><h2>Focus</h2><span class="sh-count">phone down when it mattered</span></div>
    <div class="group surface min-fg">${FOCUS.map((f) => `<div class="row min-fr">
      <span class="min-fk ${f.broke ? 'broke' : 'ok'}">${f.broke ? I.bolt : I.check}</span>
      <span class="rbody"><span class="rtitle">${esc(f.name)}</span><span class="rmeta">${f.at} · ${f.broke ? `${esc(f.broke.app)} at ${f.broke.at}, ${f.broke.min}m` : `${fmt(f.len)}, no pickups`}</span></span>
      ${f.broke ? '<button class="btn sm" data-act="min-blocker">Hold it</button>' : ''}</div>`).join('')}</div>` : ''}
    <div class="group surface"><button class="row ic" data-act="min-log-screen"><span class="tile">${MI.phone}</span><span class="rbody"><span class="rtitle">Add phone time</span><span class="rmeta">${MD.sources?.screenTime ? 'Screen Time fills this in' : 'Until Screen Time is on: “Instagram 40 minutes”'}</span></span>${I.chevR}</button></div>
    <button class="note surface min-soul" data-act="min-blocker">${I.leaf}<span><b>Blocking lives in Soul</b><br>${REAL ? 'Hold an app for a while, or every deep-work block' : 'Hold Instagram till cardio at 19:00'}</span>${I.chevR}</button>`;
}
function scrWeek(avg) {
  const past = WEEK.filter((w) => !w.today);
  const maxD = Math.max(0, ...past.map((w) => w.total));
  const rows = WEEK.map((w) => [w.d, w.today ? todayMin() : w.total, { today: w.today, hideV: !w.today && w.total !== maxD }]);
  const delta = LAST_WEEK_AVG - avg;
  const sum = { work: 0, learning: 0, social: 0, entertainment: 0 };
  past.forEach((w) => KINDS.forEach((x) => { sum[x.id] += w.kinds?.[x.id] ?? 0; }));
  const nDays = Math.max(1, past.filter((w) => w.total).length);
  const per = (v) => Math.round(v / nDays);
  const kmax = Math.max(1, ...Object.values(sum));
  const big = past.reduce((m, w) => (w.total > (m?.total ?? 0) ? w : m), null);
  const bigKind = big?.kinds ? KINDS.reduce((m, x) => ((big.kinds[x.id] ?? 0) > (big.kinds[m.id] ?? 0) ? x : m), KINDS[0]) : null;
  const scale = Math.max(60, ...rows.map((r) => r[1]));
  return `
    <section class="surface min-card min-wkcard">
      <div class="mh-top">
        <div class="mh-fig"><span class="mh-k">A day this week</span><b class="met mh-v">${fmt(avg)}</b></div>
        <div class="mh-d">${LAST_WEEK_AVG ? `<b>${fmt(Math.abs(delta))} ${delta > 0 ? 'less' : 'more'}</b><span>than last week’s ${fmt(LAST_WEEK_AVG)}</span>` : '<b>First week</b><span>nothing to compare yet</span>'}</div>
      </div>
      ${weekBars(rows, { max: REAL ? scale : 480, line: avg || null, lineLabel: avg ? `avg ${fmt(avg)}` : '', label: 'Screen time per day this week' })}
      <p class="min-cnote">${REAL ? `${esc(WEEK.at(-1)?.d ?? 'Today')} is today so far.${big?.total ? ` ${esc(big.d)} ran longest, ${fmt(big.total)}${bigKind && big.kinds[bigKind.id] ? `, ${fmt(big.kinds[bigKind.id])} of it ${bigKind.name.toLowerCase()}` : ''}.` : ''}` : 'Thursday is today so far. Saturday ran longest, 3h 02m of it entertainment.'}</p>
    </section>
    <div class="sh"><h2>By kind, a day</h2><span class="sh-count">${REAL ? 'answers where you gave them' : 'from your check-ins'}</span></div>
    <div class="group surface min-kg">${KINDS.map((x) => `<div class="row min-kr"><span class="rbody"><span class="min-aprt"><span class="rtitle">${x.name}</span><b class="met">${fmt(per(sum[x.id]))}</b></span>${meter(sum[x.id] / kmax, 'sm')}</span></div>`).join('')}</div>
    ${Object.keys(FOR_WEEK).length ? `<div class="sh"><h2>What it was for</h2><span class="sh-count">this week</span></div>
    <div class="group surface min-for">${Object.entries(FOR_WEEK).map(([id, parts]) => { const x = app(id) ?? { id, name: id, glyph: 'grid' }; return `<button class="row ic min-forr" data-act="min-app" data-id="${id}">${appTile(x)}
      <span class="rbody"><span class="rtitle">${esc(x.name)}</span>
      <span class="min-split-v" aria-hidden="true">${parts.map(([, p], i) => `<i style="flex:${p}" data-i="${i}"></i>`).join('')}</span>
      <span class="rmeta wrap">${parts.map(([n, p]) => `${esc(n)} ${p}%`).join(' · ')}</span></span>${I.chevR}</button>`; }).join('')}</div>` : ''}
    <div class="sh"><h2>Check-ins</h2><span class="sh-count">${STREAK} ${STREAK === 1 ? 'night' : 'nights'} in a row</span></div>
    <section class="surface min-card min-cirow">${weekRings(WEEK, dotRing, 30)}<p class="min-cnote">${S.checkin.done ? 'Tonight is answered.' : 'Tonight keeps it going.'} A late answer counts until noon tomorrow; after that Wyn asks once, then lets it go.</p></section>`;
}
function scrMonth() {
  const days = MONTH.days.slice(0, -1).map((v, i) => [v, i + 1]).filter(([v]) => v > 0);
  const avg = days.length ? Math.round(days.reduce((s, [v]) => s + v, 0) / days.length) : 0;
  const low = days.length ? days.reduce((m, x) => (x[0] < m[0] ? x : m)) : null;
  const checked = [...MONTH.answered].filter((d) => d < MONTH.today).length;
  return `
    <section class="surface min-card min-mcard">
      <div class="mh-top">
        <div class="mh-fig"><span class="mh-k">${esc(MONTH.name)}, a day</span><b class="met mh-v">${avg ? fmt(avg) : '–'}</b></div>
        <div class="mh-d"><b>${checked} of ${Math.max(0, MONTH.today - 1)}</b><span>nights answered</span></div>
      </div>
      <p class="mh-read min-mread" aria-live="polite">${low ? `<b>Lightest: ${dayName(low[1])} ${low[1]} ${esc(MONTH.name)}, ${fmt(low[0])}</b><span>Tap a day to see it${REAL && days.length < MONTH.today - 1 ? ` · ${days.length} days with data` : ''}</span>` : `<b>No days with screen time yet this month</b><span>${esc(srcLine())}</span>`}</p>
      ${monthHeat()}
    </section>`;
}
const dayName = (d) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(MONTH.first + d - 1) % 7];

// ═════════════════════════ LIBRARY ═════════════════════════
function renderLibrary(el, a) {
  const done = finished();
  const reading = BOOKS.filter((b) => b.status === 'reading'), paused = BOOKS.filter((b) => b.status === 'paused');
  const next = BOOKS.filter((b) => b.status === 'next'), fin = BOOKS.filter((b) => b.status === 'done' && (!REAL || (b.finishedOn ?? '').startsWith(String(TODAY_LABEL.year ?? 2026))));
  const cur = reading[0] ?? null;
  const expected = YEAR_GOAL * YEAR_GONE, behind = Math.max(0, Math.round(expected - done));
  const avgPages = 230;
  const pagesLeft = (cur?.pages ? cur.pages - cur.page : 0) + Math.max(0, YEAR_GOAL - done - (cur ? 1 : 0)) * avgPages;
  const perDay = Math.max(1, Math.round(pagesLeft / Math.max(1, DAYS_LEFT) / pace(cur)));
  const rw = readWeekToday();
  let streak = 0; for (let i = rw.length - 1; i >= 0; i--) { if (rw[i][1] > 0) streak++; else if (i !== rw.length - 1) break; }
  if (!REAL) streak = 4 + (S.readToday > 0 ? 1 : 0);
  const year = TODAY_LABEL.year ?? 2026;
  el.innerHTML = `
    ${aspHead(a, { title: 'Library', sub: `${done} of ${YEAR_GOAL} books in ${year}` })}
    <section class="surface min-card min-year" aria-label="Year goal">
      <button class="min-yr" data-act="min-goal" aria-label="Open the goal: Read ${YEAR_GOAL} books in ${year}">
        ${asRing(done / YEAR_GOAL, 112, 12, { k: YEAR_GONE, inner: `<span class="min-yri"><b class="met" data-count="${done}">${done}</b><small>of ${YEAR_GOAL}</small></span>`, label: `${done} of ${YEAR_GOAL} books, ${Math.round(YEAR_GONE * 100)}% of the year gone` })}
      </button>
      <div class="min-yt">
        <b>${behind ? `About ${behind} behind pace` : 'On pace'}</b>
        <span>${YEAR_GOAL - done} to go in ${DAYS_LEFT} days. About ${perDay} minutes a day gets you to ${YEAR_GOAL} by 31 December.</span>
        <button class="min-lnk" data-act="min-goal">${READ_GOAL_ID.id ? 'Goal in Mission' : 'Make it a goal'}${I.chevR}</button>
      </div>
    </section>

    <div class="sh"><h2>Reading now</h2></div>
    ${reading.length ? reading.map(bookCard).join('') : `<section class="surface min-card min-empty"><p class="min-cnote">No book on the go. Scan the barcode on the back of one, or type its title.</p>
      <div class="min-bka"><button class="btn tint" style="--c:var(--as-ink)" data-act="min-scan">${I.scan}Scan a barcode</button><button class="btn" data-act="min-addbook">${I.plus}Type a title</button></div></section>`}
    ${paused.map((b) => `<div class="group surface min-paused"><button class="row min-pr" data-act="min-book" data-id="${b.id}">${cover(b, 40)}
      <span class="rbody"><span class="rtitle">${esc(b.title)}</span><span class="rmeta">Paused${b.last ? ` since ${esc(b.last)}` : ''}${b.pages ? ` · page ${b.page} of ${b.pages}` : ''}</span></span>${I.chevR}</button></div>`).join('')}

    <div class="sh"><h2>This week</h2><span class="sh-count">${streak} ${streak === 1 ? 'day' : 'days'} in a row</span></div>
    <section class="surface min-card min-rweek">
      ${weekBars(rw.map(([d, m], i) => [d, m, { today: i === rw.length - 1, cls: m >= READ_GOAL ? 'hit' : '' }]), { max: Math.max(40, ...rw.map((r) => r[1])), line: READ_GOAL, lineLabel: '', unit: (v) => (v ? `${v}` : ''), label: 'Minutes read each day this week' })}
      <p class="min-cnote">${S.readToday ? `${S.readToday} minutes today. ` : REAL ? '' : 'Tonight at 21:30 makes it 5 days in a row. '}${fmt(rw.reduce((s, r) => s + r[1], 0))} this week; the line is your ${READ_GOAL}-minute goal.</p>
    </section>

    ${NOTES.length ? `<div class="sh"><h2>To look at again</h2><span class="sh-count">${Math.max(0, Math.min(3, NOTES.length) - S.reviewed.size)} today</span></div>
    ${noteCard()}` : ''}

    <div class="sh"><h2>Up next</h2><span class="sh-count">${next.length}</span></div>
    <div class="min-rail" data-scroll-x>
      ${next.map((b) => `<button class="min-shelf" data-act="min-book" data-id="${b.id}">${cover(b, 104)}<span class="ms-t">${esc(b.next ?? b.author)}</span><span class="ms-m">${b.pages ? `${b.pages} pages` : esc(b.author)}</span></button>`).join('')}
      <button class="min-shelf add" data-act="min-scan">${I.scan}<span class="ms-t">Scan a book</span><span class="ms-m">The barcode on the back</span></button>
      <button class="min-shelf add" data-act="min-addbook">${I.plus}<span class="ms-t">Type a title</span><span class="ms-m">Or an ISBN</span></button>
    </div>

    <div class="sh"><h2>The ${year} shelf</h2><span class="sh-count">${fin.length} of ${YEAR_GOAL}</span></div>
    ${shelf(fin, cur)}`;
  wireShelf(el);
}
// the year as a shelf: a spine per finished book (thickness and height from its pages), the book in progress
// filling from the foot, and an empty place for each book still to come
function shelf(fin, cur) {
  const sp = (b) => { const p = b.pages || 230; return { w: Math.round(19 + (p - 200) / 10), h: Math.max(110, Math.min(200, Math.round(152 + (p - 200) / 3))) }; };
  const spines = fin.map((b) => { const { w, h } = sp(b); return `<span class="min-spine" data-id="${b.id}" data-tone="${b.tone}" style="--w:${w}px;--h:${h}px"><b>${esc(b.short ?? b.title)}</b></span>`; });
  const c = cur ? sp(cur) : null;
  const reading = cur ? `<span class="min-spine now ${fin.length ? '' : 'sel'}" data-id="${cur.id}" data-tone="${cur.tone}" style="--w:${c.w}px;--h:${c.h}px;--p:${prog(cur).toFixed(3)}"><i></i><b>${esc(cur.title)}</b></span>` : '';
  const left = Math.max(0, YEAR_GOAL - fin.length - (cur ? 1 : 0));
  const empty = Array.from({ length: left }, (_, i) => `<span class="min-spine empty" aria-hidden="true">${i === left - 1 ? `<em class="met">${YEAR_GOAL}</em>` : ''}</span>`);
  const months = [...fin.map((b) => b.done ?? ''), ...(cur ? ['Now'] : []), ...Array(left).fill('')];
  const widths = [...fin.map((b) => sp(b).w), ...(cur ? [c.w] : []), ...Array(left).fill(20)];
  const first = cur ?? fin.at(-1);
  if (!first) return `<section class="surface min-card min-shelfc"><div class="min-spines" aria-hidden="true">${empty.join('')}</div><div class="min-plank" aria-hidden="true"></div>
    <p class="min-cnote">${YEAR_GOAL} places for ${TODAY_LABEL.year ?? 2026}. Each book you finish takes one.</p></section>`;
  return `<section class="surface min-card min-shelfc">
    <button class="min-shelfread" data-act="min-book" data-id="${first.id}" aria-live="polite">${shelfRead(first, fin.length + 1)}</button>
    <div class="min-spines" tabindex="0" role="group" aria-label="The shelf: tap or drag across the books, or use the arrow keys">${[...spines, reading, ...empty].join('')}</div>
    <div class="min-plank" aria-hidden="true"></div>
    <div class="min-spinex" aria-hidden="true">${months.map((m, i) => `<span style="--w:${widths[i]}px">${m ? esc(m === 'Now' ? '' : m[0]) : ''}</span>`).join('')}</div>
    <p class="min-cnote">${REAL ? `${fin.length ? `${fin.length} on the shelf this year.` : 'None finished yet this year.'}${cur ? ` ${esc(cur.title)} is number ${fin.length + 1}${cur.pages ? `, ${Math.round(prog(cur) * 100)}% read` : ''}.` : ''} ${left} ${left === 1 ? 'place' : 'places'} after it.`
      : `Seven on the shelf, January to September. Atomic Habits is number eight, ${Math.round((cur.page / cur.pages) * 100)}% read; four places after it.`}</p>
  </section>`;
}
const MONTHS = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' };
const ORD = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const shelfRead = (b, n) => `<span class="msr-t"><b>${esc(b.title)}</b><span>${b.status === 'done' ? `${esc(b.author)} · finished in ${MONTHS[b.done] ?? esc(b.done ?? '')}` : `Reading now${b.pages ? ` · ${Math.round(prog(b) * 100)}%` : ''} · book ${ORD[n] ?? n}`}</span></span>${I.chevR}`;
// pick a spine by pointer position (tap or drag) or with the arrow keys; the read-out line opens the picked book
function wireShelf(root) {
  const box = root.querySelector('.min-spines'); if (!box || box._wired) return; box._wired = true;
  const read = root.querySelector('.min-shelfread'); if (!read) return;
  const books = [...box.querySelectorAll('.min-spine[data-id]')];
  const pick = (el) => {
    if (!el || el.classList.contains('sel')) return;
    books.forEach((x) => x.classList.toggle('sel', x === el));
    const b = book(el.dataset.id); if (!b) return;
    read.dataset.id = b.id; read.innerHTML = shelfRead(b, books.indexOf(el) + 1); haptic(4);
  };
  const at = (x) => books.reduce((best, el) => { const r = el.getBoundingClientRect(); const d = Math.abs(x - (r.left + r.width / 2)); return d < best[0] ? [d, el] : best; }, [Infinity, null])[1];
  let down = false;
  box.addEventListener('pointerdown', (e) => { down = true; try { box.setPointerCapture(e.pointerId); } catch {} pick(at(e.clientX)); });
  box.addEventListener('pointermove', (e) => { if (down) pick(at(e.clientX)); });
  box.addEventListener('pointerup', () => { down = false; });
  box.addEventListener('pointercancel', () => { down = false; });
  box.addEventListener('keydown', (e) => {
    const i = books.findIndex((x) => x.classList.contains('sel'));
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); pick(books[Math.max(0, Math.min(books.length - 1, i + (e.key === 'ArrowLeft' ? -1 : 1)))]); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); read.click(); }
  });
}
function bookCard(b) {
  const p = prog(b), left = b.pages ? (b.pages - b.page) / pace(b) : null;
  return `<section class="surface min-card min-book">
    <button class="min-bk" data-act="min-book" data-id="${b.id}">${cover(b, 84)}
      <span class="min-bkt"><b>${esc(b.title)}</b><span>${esc(b.author)}</span>
        <span class="min-bkp"><span class="met">${b.pages ? `${Math.round(p * 100)}%` : `p. ${b.page}`}</span><span>${b.pages ? `page ${b.page} of ${b.pages}` : 'pages unknown'}</span></span>
        ${meter(p)}
        <em>${left != null ? `${fmt(left)} left at your pace` : 'Add the page count on its page'}${b.plan ? ` · tonight ${b.plan.at}, ${b.plan.pages} pages` : ''}</em></span>
    </button>
    <div class="min-bka"><button class="btn tint" style="--c:var(--as-ink)" data-act="min-read" data-id="${b.id}">${MI.timer}Start reading</button><button class="btn" data-act="min-pages" data-id="${b.id}">${MI.pages}Log pages</button></div>
  </section>`;
}
function noteCard() {
  const n = NOTES.find((x) => !S.reviewed.has(x.id));
  if (!n || S.reviewed.size >= 3) return `<p class="note surface">${REAL ? 'Looked at today’s. Tomorrow brings more, the ones you haven’t seen in a while first.' : 'All three looked at today. Tomorrow brings three more, the ones you haven’t seen in a while first.'}</p>`;
  const b = book(n.book);
  const left = Math.max(0, Math.min(3, NOTES.length) - S.reviewed.size);
  return `<button class="surface min-card min-note" data-act="min-review">
    <span class="min-nq">${n.kind === 'highlight' ? `“${esc(n.text)}”` : esc(n.text)}</span>
    ${n.mine ? `<span class="min-nm">${MI.note}${esc(n.mine)}</span>` : ''}
    <span class="min-nf"><span>${esc(b?.title ?? 'A note')}${n.page ? ` · p. ${n.page}` : ''} · ${n.kind === 'highlight' ? 'highlight' : 'your note'}</span><span class="min-nn">${left} to go${I.chevR}</span></span>
  </button>`;
}

// ═════════════════════════ COURSES ═════════════════════════
function renderCourses(el, a) {
  const act = COURSES.filter((c) => c.status === 'active'), parked = COURSES.filter((c) => c.status === 'parked'), dn = COURSES.filter((c) => c.status === 'done');
  const lw = learnWeek();
  const first = act[0] ?? null;
  const parkedLessons = parked.reduce((s, c) => s + c.lessons.length, 0);
  const lessonsLeft = act.reduce((s, c) => s + c.lessons.length - c.done, 0);
  const ci = first ? (first.cur ?? first.done) : 0;
  const cur = first?.lessons[ci];
  const atP = cur && first.at && durSec(cur[1]) ? durSec(first.at) / durSec(cur[1]) : 0;
  el.innerHTML = `
    ${aspHead(a, { title: 'Courses', sub: COURSES.length ? `${act.length} in progress · ${lessonsLeft} lessons left · ${parked.length} parked` : 'Your courses and lessons' })}
    <section class="surface min-card min-lw" aria-label="Learning this week">
      ${asRing(lw / LEARN_GOAL, 76, 9, { label: `${fmt(lw)} of ${fmt(LEARN_GOAL)} this week`, inner: `<span class="min-lwi met">${Math.round((lw / LEARN_GOAL) * 100)}<small>%</small></span>` })}
      <div class="min-lwt"><b><span class="met" data-roll="${lw}">${fmt(lw)}</span> of ${fmt(LEARN_GOAL)} this week</b>
        <span>${REAL ? 'Lessons, what you logged, and the learning you named in your check-ins.' : `Skool, college work and the lessons Wyn counted from YouTube${S.learnExtra ? ' tonight' : ''}.`} Resets Monday.</span></div>
    </section>

    ${first ? `<div class="sh"><h2>Continue</h2></div>
    <section class="surface min-card min-cont">
      <button class="min-ch" data-act="min-course" data-id="${first.id}">
        <span class="min-ck">${esc(first.from)}${first.part && !first.from.includes(first.part) ? ` · ${esc(first.part)}` : ''}</span>
        <b>${esc(first.title)}</b>
        <span class="min-cm">${asRing(first.done / first.lessons.length, 28, 4)}<span><span class="met">${first.done}</span> of ${first.lessons.length} lessons · about ${fmt(courseLeft(first))} left</span></span>
      </button>
      <button class="min-cl" data-act="min-lesson" data-c="${first.id}">
        <span class="min-cv" aria-hidden="true">${I.play}</span>
        <span class="min-clt"><b>${lessonNo(first)}. ${esc(cur[0])}</b><span>${first.at ? `${first.at} of ${cur[1] || '?'}` : cur[1] || 'Length not listed'}</span>
          <span class="min-scrub" style="--p:${atP.toFixed(3)}"><i></i><b></b></span></span>
      </button>
      ${cur[2] ? `<p class="min-why">${wynMark('xs')}<span>${esc(cur[2])}</span></p>` : ''}
      <button class="btn primary block" style="--c:var(--as-fill)" data-act="min-lesson" data-c="${first.id}">${I.play}${first.at ? `Resume at ${first.at}` : 'Start the lesson'}</button>
    </section>` : COURSES.length ? `<div class="sh"><h2>Continue</h2></div><p class="note surface">Nothing in progress. Pick one from Parked to start it; the rest wait their turn.</p>` : `<p class="note surface">${REAL ? 'No courses yet. Your Skool classroom comes in from the PC (agentos mind import-courses).' : ''}</p>`}

    ${act.length > 1 ? `<div class="sh"><h2>Also in progress</h2><span class="sh-count">${act.length - 1}</span></div>
    <div class="group surface min-cg">${act.slice(1).map(courseRow).join('')}</div>` : ''}

    ${COLLEGE.length ? `<div class="sh"><h2>College</h2><span class="sh-count">Semester 1 · City College</span></div>
    <div class="group surface min-cg">${COLLEGE.map((c) => `<div class="row min-cr">${asRing(c.done / c.total, 40, 5, { label: `${c.done} of ${c.total} ${c.of}` })}
      <span class="rbody"><span class="min-aprt"><span class="rtitle">${esc(c.title)}</span><span class="min-cn"><b class="met">${c.done}</b>/${c.total} ${c.of}</span></span>
      <span class="rmeta">${esc(c.kind)} · ${esc(c.today)}</span></span></div>`).join('')}</div>` : ''}

    ${parked.length ? `<div class="sh"><h2>Parked</h2><span class="sh-count">${parked.length} · ${parkedLessons} lessons</span></div>
    <section class="surface min-card min-park">
      <p class="min-why">${wynMark('xs')}<span>One at a time. ${first ? `The next course starts when ${esc(first.title)} is done, so the ${lessonsLeft} lessons in front of you get finished first.` : 'Start one and the rest wait.'}</span></p>
      <div class="min-parkl">${parked.map((c, i) => `<button class="min-pk" data-act="min-course" data-id="${c.id}">${i === 0 ? '<span class="min-pkn">Next in line</span>' : ''}<b>${esc(c.title)}</b><span>${c.lessons.length} lessons${courseLeft(c) ? ` · ${fmt(courseLeft(c))}` : ''}</span></button>`).join('')}</div>
    </section>` : ''}

    ${dn.length ? `<div class="sh"><h2>Finished</h2><span class="sh-count">${dn.length}</span></div>
    <div class="group surface min-cg">${dn.map((c) => `<button class="row min-cr" data-act="min-course" data-id="${c.id}">${asRing(1, 40, 5)}<span class="rbody"><span class="rtitle">${esc(c.title)}</span><span class="rmeta">${c.lessons.length} lessons · ${esc(c.from)}</span></span>${I.chevR}</button>`).join('')}</div>` : ''}

    ${LIBRARY.length ? `<div class="sh"><h2>Skool library</h2><span class="sh-count">${LIBRARY.reduce((s, c) => s + c.lessons.length, 0)} recordings</span></div>
    <div class="group surface min-cg">${LIBRARY.map((c) => `<button class="row min-cr" data-act="min-course" data-id="${c.id}">${asRing(c.done / c.lessons.length, 40, 5)}<span class="rbody"><span class="rtitle">${esc(c.title)}</span><span class="rmeta">${esc(c.part)} · ${c.lessons.length} · watch what you need</span></span>${I.chevR}</button>`).join('')}</div>` : ''}`;
  rollIn(el);
}
const courseRow = (c) => `<button class="row min-cr" data-act="min-course" data-id="${c.id}">${asRing(c.done / c.lessons.length, 40, 5, { label: `${c.done} of ${c.lessons.length} lessons` })}
  <span class="rbody"><span class="min-aprt"><span class="rtitle">${esc(c.title)}</span><span class="min-cn"><b class="met">${c.done}</b>/${c.lessons.length}</span></span>
  <span class="rmeta">${lessonNo(c)}. ${esc(c.lessons[c.cur ?? c.done]?.[0] ?? '')}${c.at ? ` · from ${c.at}` : ''}</span></span>${I.chevR}</button>`;

// ═════════════════════════ the app ═════════════════════════
const TOOLS = [
  { name: 'mind_answer_checkin', does: 'Answers tonight’s check-in from what you told her, and says what she filed', auto: true },
  { name: 'mind_log_reading', does: 'Logs a reading session from a message, a voice note or a scanned page', auto: true },
  { name: 'mind_log_learning', does: 'Marks a lesson watched, or logs a video or a class you learned from', auto: true },
  { name: 'mind_log_screen_time', does: 'Notes phone time you tell her about, until Screen Time is on', auto: true },
  { name: 'mind_add_book', does: 'Puts a book on your Up next shelf', auto: true },
  { name: 'mind_park_course', does: 'Parks a course or puts one back in progress', auto: true },
  { name: 'mind_today', does: 'Reads your day in Mind before she answers about it', auto: true },
];

registerAspect({
  id: 'mind',
  sections: [
    { id: 'home', label: 'Today', icon: I.sun, render: renderHome },
    { id: 'screen', label: 'Screen time', icon: MI.phone, render: renderScreen },
    { id: 'library', label: 'Library', icon: I.read, render: renderLibrary },
    { id: 'courses', label: 'Courses', icon: MI.cap, render: renderCourses },
  ],
  primary: { label: 'Log what you read, watched or learned', icon: I.plus, run: () => openLog() },
  summary() {
    const { t, d } = delta();
    const ci = S.checkin.done;
    const b = curBook(), c = curCourse();
    const vs = !Object.keys(USUAL).length ? '' : Math.abs(d) < 5 ? ', about usual' : `, ${fmt(Math.abs(d))} ${d > 0 ? 'more' : 'less'} than a usual ${MD.weekday || 'day'}`;
    return {
      line: `${fmt(t)} on screen so far${vs}. ${ci ? 'Today is on the record.' : `Check-in at ${hm(CHECKIN_AT)}.`}`,
      metric: { v: Math.round((t / 60) * 100) / 100, unit: 'h', text: fmt(t), label: 'screen time today', p: Math.min(1.5, t / Math.max(1, usualDay() || t || 1)) },
      today: [
        { id: 'min-1', text: ci ? 'Check-in answered' : BLOCKS.length ? `Check-in at ${hm(CHECKIN_AT)}: ${BLOCKS.length} ${BLOCKS.length === 1 ? 'block' : 'blocks'} to sort` : `Check-in at ${hm(CHECKIN_AT)}`, done: ci, act: 'min-checkin' },
        b ? { id: 'min-2', text: S.readToday >= READ_GOAL ? `Read ${S.readToday} min of ${b.title}` : `Read ${b.title}: ${READ_GOAL} minutes`, done: S.readToday >= READ_GOAL, act: 'min-read' } : null,
        c ? { id: 'min-3', text: `Lesson ${lessonNo(c)}: ${c.lessons[c.cur ?? c.done]?.[0] ?? ''}${c.at ? `, from ${c.at}` : ''}`, done: false, act: 'min-lesson' } : null,
      ].filter(Boolean),
      streak: { n: STREAK + (ci ? 1 : 0), label: 'nights of check-ins', atRisk: !ci && nowMin() >= CHECKIN_AT },
      next: ci ? (b ? { at: '', text: `Read ${b.title}` } : null) : { at: hm(CHECKIN_AT), text: 'Check-in: where today went' },
      quick: [{ label: 'Log reading', icon: I.read, act: 'min-log' }, { label: 'Check-in', icon: I.agent, act: 'min-checkin' }],
      reading: { today: S.readToday, goal: READ_GOAL, book: b?.title ?? null },
    };
  },
  scan: [{ kind: 'book', label: 'Book barcode, cover or page', hint: 'Adds the book to Mind from its barcode, or saves the page as a highlight', handle: (r) => handleBookScan(r) }],
  tools: TOOLS,
  onOpen(a) {
    S.app = a;
    load();
    growIn(a.el(a.section));
  },
  onSection(a, sid) { growIn(a.el(sid)); },
});

// the screens follow the data: a refresh from the PC, a write, the day turning
onMind(() => {
  refreshMind('home', 'screen', 'library', 'courses');
  document.dispatchEvent(new CustomEvent('aspect-summary', { detail: { id: 'mind' } }));
});

// ── deep links past the sections: #mind/checkin · log · session[/<book>] · book/<id> · course/<id> · lesson/<course> ·
//    app/<id> · review · screen|library|courses. The route opens the app, then the page on top of it ──
registerRoute('mind', (L, ctx) => {
  const [sub, id] = [L.parts?.[1] ?? L.sub, L.parts?.[2] ?? L.arg];
  ctx.tab?.('life');
  ctx.after(() => {
    const go = (fn, section = null) => ensureMind(section, () => setTimeout(fn, 120));
    if (!sub) return ensureMind(null);
    if (['home', 'screen', 'library', 'courses'].includes(sub)) return ensureMind(sub);
    if (sub === 'checkin') return go(() => openCheckin());
    if (sub === 'log') return go(() => openLog());
    if (sub === 'session') return go(() => startSession(id || curBook()?.id));
    if (sub === 'book') return go(() => openBook(id || curBook()?.id));
    if (sub === 'course') return go(() => openCourse(id || curCourse()?.id));
    if (sub === 'lesson') return go(() => openLesson(id || curCourse()?.id));
    if (sub === 'app') return go(() => openAppPage(id || APPS[0]?.id));
    if (sub === 'review') return go(() => openReview());
    return ensureMind(null);
  });
}, { owner: false, tab: 'life' });

// ── actions (global; Home and the agent can fire them from outside the app) ──
on('min-go', (el) => { const a = S.app; if (a?.page?.isConnected) { haptic(5); a.go(el.dataset.s); a.scroll.scrollTop = 0; } else ensureMind(el.dataset.s); });
on('min-checkin', () => ensureMind(null, () => openCheckin()));
on('min-log', () => ensureMind(null, () => openLog()));
on('min-log-screen', () => openLog({ mode: 'screen' }));
on('min-read', (el) => ensureMind(null, () => { const id = el.dataset.id || curBook()?.id; if (id) startSession(id); else openLog({ mode: 'book' }); }));
on('min-pages', (el) => openLog({ mode: 'pages', book: el.dataset.id }));
on('min-book', (el) => ensureMind(null, () => openBook(el.dataset.id)));
on('min-course', (el) => ensureMind(null, () => openCourse(el.dataset.id)));
on('min-lesson', (el) => ensureMind(null, () => { const c = el.dataset.c || curCourse()?.id; if (c) openLesson(c, el.dataset.i != null ? Number(el.dataset.i) : undefined); else ensureMind('courses'); }));
on('min-app', (el) => openAppPage(el.dataset.id));
on('min-review', () => openReview());
on('min-blocker', () => api.openBlocker());
on('min-goal', () => {
  if (READ_GOAL_ID.id) return api.openGoal(READ_GOAL_ID.id);
  const year = TODAY_LABEL.year ?? 2026;
  const g = addGoal({ title: `Read ${YEAR_GOAL} books in ${year}`, horizon: 'year', aspects: ['mind'], measure: `${YEAR_GOAL} books` });
  READ_GOAL_ID.id = g?.id ?? null;
  toast(`Made it a goal: Read ${YEAR_GOAL} books in ${year}`);
  refreshMind('library');
});
on('min-scan', () => scanIsbn());
on('min-addbook', () => openLog({ mode: 'book' }));
on('min-journal', () => api.writeJournal());
on('min-ask', (el) => api.askAgent('', { aspect: 'mind', about: el.dataset.about }));
on('min-day', (el) => {
  const d = Number(el.dataset.d); const v = MONTH.days[d - 1] ?? 0;
  const out = el.closest('.min-mcard')?.querySelector('.min-mread'); if (!out) return;
  el.closest('.min-calg').querySelectorAll('.min-day').forEach((x) => x.classList.toggle('sel', x === el));
  haptic(4);
  out.innerHTML = d === MONTH.today ? `<b>Today, ${TODAY_LABEL.weekday} ${d} ${esc(MONTH.name)}</b><span>${fmt(todayMin())} so far · check-in at ${hm(CHECKIN_AT)}</span>`
    : `<b>${dayName(d)} ${d} ${esc(MONTH.name)} · ${v ? fmt(v) : 'nothing recorded'}</b><span>${MONTH.answered.has(d) ? 'Check-in answered' : 'No check-in that night'}</span>`;
});

// ── the bus ──
provide('logReading', (prefill = {}) => (prefill.book && prefill.minutes && prefill.auto ? logReading(prefill) : ensureMind(null, () => openLog({ mode: 'reading', ...prefill }))));
provide('openCourse', (id) => ensureMind('courses', () => { const c = id || curCourse()?.id; if (c) openCourse(c); }));
provide('openScreenTime', (date) => { if (date && date !== 'today' && date !== today()) scrView = 'week'; ensureMind('screen', () => refreshMind('screen')); });
provide('openCheckin', () => ensureMind(null, () => openCheckin()));
provide('openBook', (id) => ensureMind('library', () => { const b = id || curBook()?.id; if (b) openBook(b); }));
provide('startReading', (id) => ensureMind(null, () => { const b = id || curBook()?.id; if (b) startSession(b); else openLog({ mode: 'book' }); }));

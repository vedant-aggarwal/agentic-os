// Mission: the purpose, the goals that serve it on time horizons from this week to a lifetime (the TimeStripe idea),
// and the mission graph. Owner: the Mission agent (this file, mission-data.js, mission-demo.js, mission-charts.js,
// css/aspects/mission.css). Sections: Horizons (home) · Graph · Purpose; the round action adds a goal.
// Real data: goals are core (GOALS, addGoal/updateGoal in js/data.js → svc/sync → /goals); milestones, check-ins,
// horizon notes, the purpose and the lifetime directions are Mission's collections; the graph comes from the PC.
// Bus: openGoal(id) · addGoal(prefill) · openHorizon(h) · openPurpose(). Every goal in GOALS opens here.
import { $, $$, esc, push, openSheet, closeSheet, on, toast, haptic, ring, setRing, peek, closePeek, onHold, seg, wireSegs, pulse } from '../core.js';
import { I } from '../icons.js';
import { registerAspect, aspHead, aspectTile } from '../aspects.js';
import { GOALS, TASKS, PROJECTS, ASPECTS, aspect, AGENT, FAMILIES, project, USER, addGoal as coreAddGoal, updateGoal, completeTask, onData } from '../data.js';
import * as clock from '../svc/clock.js';
import * as SYNC from '../svc/sync.js';
import { registerRoute } from '../svc/route.js';
import { api, provide } from '../bus.js';
import { stagger, reduced as motionReduced } from '../motion.js';
import { markHTML, setMarkState } from '../marks.js';
import * as M from './mission-data.js';
import { HZ, hz, RANK, CORE_H } from './mission-data.js';
import { paceChart, burnChart, paceBars, compBar } from './mission-charts.js';

const DEMO = M.DEMO, REAL = !DEMO;
const X = DEMO ? M.DEMO_X : {};

// ── Mission's own glyphs, drawn like js/icons.js (24 grid, 2px line, round caps) ──
const sv = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const MI = {
  stripes: sv('<path d="M4 6h16M4 12h16M4 18h16" stroke-opacity=".34"/><path d="M4 6h9M4 12h14M4 18h5"/>'),
  graph: sv('<path d="M4 4.5v15h16"/><path d="m7.5 15.5 3.6-4.2 3 2.4 5.4-6.2"/>'),
  serves: sv('<path d="M7 17 17 7M9.5 7H17v7.5"/>', 'stroke-width="2.2"'),
  move: sv('<path d="M4 7h11M11 3l4 4-4 4M20 17H9M13 13l-4 4 4 4"/>'),
  roll: sv('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M12 8v4l2.6 1.6"/>'),
  miss: sv('<path d="M7 7l10 10M17 7 7 17"/>', 'stroke-width="2.4"'),
  drop: sv('<path d="M6 12h12"/>', 'stroke-width="2.4"'),
};
const FAM_ICON = { work: I.work, health: I.heartPulse, people: I.people };
const reduced = () => motionReduced();
const MON = clock.MONTHS.map((m) => m.slice(0, 3));
const dd = (iso) => { if (!iso) return ''; const p = clock.dparts(iso); return `${p.day} ${MON[p.month]}`; };
const pct = (v) => Math.round((v ?? 0) * 100);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const agentName = () => AGENT.name || 'Wyn';

// ── state for this session: only what's on screen (everything that changes is written to real records) ──
const S = { period: {}, peek: null, checkedIn: false, scan: [] };
let APP = null;

// ── goals ─────────────────────────────────────────────────────────────
const HMAP = { day: 'week', week: 'week', month: 'month', quarter: 'quarter', year: 'year', decade: 'later', later: 'later', life: 'life' };
const isDoneG = (g) => g.status === 'done' || g.state === 'done';
const closedG = (g) => !!g.state || isDoneG(g);
const active = () => GOALS.filter((g) => !isDoneG(g) && !g.state);
const childrenOf = (id) => GOALS.filter((g) => g.parent === id && !g.state);
const tasksOf = (id) => TASKS.filter((t) => t.goal === id);
const projectsOf = (id) => PROJECTS.filter((p) => p.goal === id);
function closedList() {
  const cs = M.GRAPH?.closed ?? [];
  if (DEMO) return cs;
  return cs.map((c) => ({ ...c, horizon: HMAP[c.horizon] ?? 'week', when: c.state === 'missed' ? `Ended ${dd(c.when)}` : `${c.state === 'dropped' ? 'Dropped ' : ''}${M.whenOf(c.when)}`, aspects: GOALS.find((g) => g.id === c.id)?.aspects ?? [] }));
}
const findGoal = (id) => GOALS.find((g) => g.id === id) ?? closedList().find((c) => c.id === id) ?? null;
const hOf = (g) => HMAP[g.horizon] ?? 'week';
/** Milestones measure a goal that has no tasks, no child goals and no hand-set number. */
function msPace(g) {
  if (DEMO || g.progressMode !== 'auto' || (g.tasks?.[1] ?? 0) || childrenOf(g.id).length) return null;
  const ms = M.milestonesOf(g.id);
  return ms.length ? ms.filter((m) => m.done).length / ms.length : null;
}
const pOf = (g) => (isDoneG(g) ? 1 : g.state ? (g.state === 'missed' ? 0.62 : 0) : (msPace(g) ?? g.pace ?? 0));
function tOf(g) {
  if (DEMO) return g.time ?? hz(hOf(g)).time ?? 0;
  if (!g.end) return null;
  return g.time ?? 0;
}
const tk = (g) => (closedG(g) || tOf(g) == null ? null : tOf(g));
const overdue = (g) => REAL && !isDoneG(g) && !g.state && g.end && g.end < clock.today();
function verdictOf(g) {
  if (isDoneG(g)) return 'Done';
  if (g.state === 'missed') return 'Missed';
  if (g.state === 'dropped') return 'Dropped';
  const last = M.checkinsOf(g.id)[0];
  const offNow = last?.state === 'off' && (DEMO || clock.daysBetween(clock.dateOfIso(last.at ?? last.created_at), clock.today()) <= 7);
  if (DEMO) return offNow ? 'Behind pace' : g.verdict ?? (pOf(g) - (tOf(g) ?? 0) >= -0.1 ? 'On pace' : 'Behind pace');
  const p = pOf(g), t = tOf(g);
  if (t == null) return 'No deadline';
  if (overdue(g)) return 'Overdue';
  if (offNow) return 'Behind pace';
  if (p === 0 && t < 0.25) return 'Not started';
  return t - p > 0.2 ? 'Behind pace' : 'On pace';
}
const vClass = (v) => ({ 'On pace': 'on', 'Behind pace': 'behind', Overdue: 'behind', Done: 'done', Missed: 'miss', Dropped: 'drop', 'Not started': 'none', 'No deadline': 'none' }[v] ?? 'on');
const vWord = (v) => (v === 'Behind pace' ? 'Behind' : v);
const behind = (v) => v === 'Behind pace' || v === 'Overdue';
function shortTitle(t) {
  const s = String(t ?? '').replace(/^(reach|build|collect|get|make|ship|finish)\s+/i, '').split(/[:,–—(]/)[0].trim();
  if (s.length <= 26) return s.replace(/^./, (c) => c.toUpperCase());
  const cut = s.slice(0, 26); return `${cut.slice(0, cut.lastIndexOf(' ') > 12 ? cut.lastIndexOf(' ') : 26).replace(/^./, (c) => c.toUpperCase())}…`;
}
const shortOf = (g) => X[g.id]?.short ?? (DEMO ? g.short ?? g.title : shortTitle(g.title));
function measureOf(g) {
  if (DEMO) return X[g.id]?.measure ?? g.metric ?? (g.tasks ? `${g.tasks[0]} of ${g.tasks[1]} tasks` : '');
  const ms = M.milestonesOf(g.id), n = g.tasks?.[1] ?? 0;
  const count = n ? `${g.tasks[0]} of ${plural(n, 'task')}` : ms.length ? `${ms.filter((m) => m.done).length} of ${plural(ms.length, 'milestone')}` : '';
  return [count, g.metric].filter(Boolean).join(' · ');
}
const parentOf = (g) => (g.parent ? findGoal(g.parent) : null);
const famOf = (g) => aspect(g.aspects?.[0])?.fam ?? 'work';
const dirOf = (g) => M.directions().find((d) => d.fam === famOf(g));
function goalsIn(h) {
  const open = active().filter((g) => hOf(g) === h).sort((a, b) => Number(behind(verdictOf(b))) - Number(behind(verdictOf(a))));
  const doneNow = GOALS.filter((g) => isDoneG(g) && hOf(g) === h && (DEMO || g.period === hz(h).key));
  const closedNow = DEMO && h === 'week' ? closedList().filter((c) => c.horizon === 'week' && c.w === 15) : [];
  return [...open, ...doneNow, ...closedNow];
}
const horizonAvg = (h) => { const gs = goalsIn(h); return gs.length ? gs.reduce((a, g) => a + pOf(g), 0) / gs.length : 0; };
function kickerOf(g) {
  if (g.state) return g.state === 'dropped' ? 'Dropped goal' : `${hz(g.horizon).short} goal · ${g.state === 'done' ? 'done' : 'missed'}`;
  const H = hz(hOf(g));
  if (overdue(g)) return `${H.short} goal · was due ${dd(g.end)}`;
  if (H.id === 'life') return 'Lifetime';
  return H.id === 'later' ? `${H.name} · ${H.range}` : `${H.name}${H.due ? ` · due ${H.due}` : ''}`;
}
/** The open task that moves a goal next: doing, late, today, upcoming, inbox. */
function nextTaskOf(g) {
  const order = { doing: 0, overdue: 1, today: 2, upcoming: 3, inbox: 4, nodate: 5 };
  return tasksOf(g.id).filter((t) => t.list !== 'done').sort((a, b) => (order[a.list] ?? 9) - (order[b.list] ?? 9))[0] ?? null;
}

// What Mission knows about one goal beyond its core fields
function ext(g) {
  if (DEMO) {
    const x = X[g.id] ?? {};
    return { ...x, ms: M.milestonesOf(g.id).map((m) => ({ id: m.id, title: m.title, done: m.done, when: M.msWhen(m) })),
      checks: M.checkinsOf(g.id).map((c) => ({ label: c.label, by: c.by === 'me' ? 'You' : agentName(), state: c.state, note: c.note })) };
  }
  const H = hz(hOf(g)), v = verdictOf(g), p = pct(pOf(g)), t = tOf(g);
  const ms = M.milestonesOf(g.id).map((m) => ({ id: m.id, title: m.title, done: !!m.done, when: M.msWhen(m) }));
  const nt = nextTaskOf(g), nm = ms.find((m) => !m.done);
  const next = nt ? { task: nt.id, text: nt.title } : nm ? { ms: nm.id, text: nm.title } : null;
  const of = H.id === 'later' ? `the ${H.of.replace(/^the /, '')}` : H.of;
  const clip = (x) => (x.length > 64 ? `${x.slice(0, 60).replace(/\s+\S*$/, '')}…` : x.replace(/\.$/, ''));
  const nx = next ? ` Next: ${clip(next.text)}.` : ' It has no next step yet.';
  const say = isDoneG(g) ? 'Closed. It counts toward everything above it.'
    : v === 'Overdue' ? `Its ${H.short.toLowerCase()} ended on ${dd(g.end)} at ${p}%. Roll it into this ${H.short.toLowerCase()}, or close it if it's done.`
      : v === 'Behind pace' ? `Behind pace: ${p}% done with ${pct(t)}% of ${of} gone.${nx}`
        : v === 'Not started' ? `Not started yet, and ${pct(t)}% of ${of} has gone.${nx}`
          : v === 'No deadline' ? `No deadline, so there's no pace to keep.${next ? nx : ' Give it a horizon, or a first step.'}`
            : `On pace: ${p}% done with ${pct(t)}% of ${of} gone.${next ? ` Keep going: ${clip(next.text)}.` : ''}`;
  const acts = [];
  if (v === 'Overdue') acts.push([`Roll into this ${H.short.toLowerCase()}`, 'mis-roll', g.id]);
  if (nt) acts.push(['Open the next step', 'mis-task', nt.id]);
  else if (!isDoneG(g)) acts.push(['A step on Today', 'mis-next-add', g.id]);
  acts.push([`Ask ${agentName()}`, 'mis-ask', g.id]);
  const rows = (M.GRAPH?.history?.[g.id] ?? []).filter(([, , tt]) => tt != null).map(([d, pp, tt]) => [d === clock.today() ? 'Today' : dd(d), tt, pp]);
  if (t != null && (!rows.length || rows.at(-1)[0] !== 'Today')) rows.push(['Now', t, pOf(g)]);
  else if (rows.length) rows[rows.length - 1] = ['Now', t, pOf(g)];
  const projs = projectsOf(g.id).map((x) => x.slug);
  return {
    short: shortOf(g), measure: measureOf(g), ms, next, say, acts: isDoneG(g) ? [] : acts,
    hist: t != null ? rows : null, axis: [dd(g.start), 'Now', dd(g.end)], start: g.start ? dd(g.start) : '',
    checks: M.checkinsOf(g.id).map((c) => ({ label: `${M.whenOf(c.at ?? c.created_at)} · ${M.timeOfDoc(c.at ?? c.created_at)}`, by: c.by === 'me' ? 'You' : agentName(), state: c.state, note: c.note })),
    projects: projs,
  };
}

const backLabel = () => { const top = $('#stack')?.lastElementChild; return top?._opts?.short ?? top?._opts?.title ?? undefined; };

// ── pieces ────────────────────────────────────────────────────────────
function gRing(g, size = 46, w = 5, { count = false } = {}) {
  const p = pOf(g), done = isDoneG(g), n = pct(p), k = tk(g);
  const num = count ? `<span data-count="${n}" data-fmt="pct">${n}</span>` : n;
  const inner = done ? `<span class="mis-rck">${I.check}</span>` : g.state ? `<span class="mis-rck off">${g.state === 'missed' ? MI.miss : MI.drop}</span>` : `<b class="met mis-rp">${num}<small>%</small></b>`;
  return ring(p, 'as', size, w, { k, inner, cls: size >= 100 ? 'mis-bring' : '', label: done ? 'Done' : `${n}% done${k != null ? `, ${pct(k)}% of the time gone` : ''}` });
}
const tick = '<i class="mis-tick" aria-hidden="true"></i>';
const avatar = (cls = '', state = 'idle') => `<span class="mis-av ${cls}" aria-hidden="true">${markHTML(AGENT.product === 'Wyn' && AGENT.name !== 'Wyn' ? 'wyn' : 'wyn', { state, size: cls === 'sm' ? 18 : 22 })}</span>`;

function goalRow(g, { serves = true, cls = '' } = {}) {
  const v = verdictOf(g), par = parentOf(g);
  const meta = g.state ? esc(g.when) : esc(overdue(g) ? `Was due ${dd(g.end)}` : measureOf(g));
  return `<button class="row mis-grow${closedG(g) ? ' is-closed' : ''} ${cls}" data-act="mis-goal" data-id="${g.id}">
    ${gRing(g)}
    <span class="rbody">
      <span class="mis-gt">${esc(g.title)}</span>
      <span class="mis-gm"><span class="mis-v ${vClass(v)}">${vWord(v)}</span>${meta ? `<span class="mis-dotsep" aria-hidden="true">·</span><span class="mis-gm-x">${meta}</span>` : ''}</span>
      ${serves && par && !g.state ? `<span class="mis-gs">${MI.serves}<span>Serves ${esc(shortOf(par))}</span></span>` : ''}
    </span>${I.chevR}</button>`;
}

function stripe(H, { big = false, days = false } = {}) {
  if (!H.cells) return '';
  const n = H.cells.length;
  const cells = H.cells.map((f, i) => {
    const lab = Array.isArray(H.labels) ? H.labels[i] : H.labels[i] ?? '';
    const cls = `${i === H.now ? 'now' : ''}${f >= 1 ? ' gone' : ''}`;
    if (days) {
      const iso = H.days?.[i] ?? '';
      const p = iso ? clock.dparts(iso) : null;
      return `<button class="mis-sc ${cls}" style="--f:${f.toFixed(3)};--i:${i}" data-act="mis-cal" data-iso="${iso}" aria-label="${p ? `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][p.dow]} ${p.day} ${MON[p.month]}` : ''}${i === H.now ? ', today' : ''}"><i></i><span>${lab}</span><em class="met">${p?.day ?? ''}</em></button>`;
    }
    return `<span class="mis-sc ${cls}" style="--f:${f.toFixed(3)};--i:${i}"><i></i>${lab ? `<span>${lab}</span>` : ''}</span>`;
  }).join('');
  return `<div class="mis-stripe${big ? ' big' : ''}${days ? ' days' : ''}" style="--n:${n};--g:${H.gap}px" ${days ? '' : `role="img" aria-label="${esc(H.name)}: ${esc(H.left || H.range)}"`}>${cells}</div>`;
}

// what the agent reads into a band: the week's one ask, the month's one fix
function bandRead(h) {
  if (DEMO) {
    if (h === 'week') return `<div class="mis-wyn surface mis-bread">
      <div class="mis-nh">${avatar()}<span class="mis-nn">${esc(agentName())}</span><span class="mis-nt">17:30 heartbeat</span></div>
      <p class="mis-nx">The week is on pace because the Jobs board shipped. Harborline is the one behind: send the quote today and the payment can land by Sunday.</p>
      <div class="mis-na"><button class="btn sm" data-act="mis-say" data-id="draft">${I.sparkle}Draft the quote</button><button class="btn sm" data-act="mis-alarm">${I.clock}Sunday alarm</button></div>
    </div>`;
    if (h === 'month') return `<div class="mis-aline surface">${avatar('sm')}<p>All three October goals are behind. 5,000 followers can't land by the 31st; 7 reels a week still can.</p><button class="btn sm" data-act="mis-say" data-id="split">Split it</button></div>`;
    return '';
  }
  if (h !== 'week' && h !== 'month') return '';
  const gs = goalsIn(h).filter((g) => !closedG(g));
  const worst = gs.find((g) => behind(verdictOf(g)));
  if (!worst) return '';
  const e = ext(worst), od = verdictOf(worst) === 'Overdue';
  return `<div class="mis-aline surface">${avatar('sm')}<p>${esc(od ? `"${shortOf(worst)}" is past its ${hz(h).short.toLowerCase()}. Roll it into this one, or close it.` : `"${shortOf(worst)}" is behind: ${pct(pOf(worst))}% with ${pct(tOf(worst))}% of ${hz(h).of} gone.${e.next ? ` Next: ${e.next.text}.` : ''}`)}</p>
    <button class="btn sm" data-act="${od ? 'mis-roll' : 'mis-goal'}" data-id="${worst.id}">${od ? 'Roll it' : 'Open'}</button></div>`;
}
function band(h) {
  const H = hz(h), gs = goalsIn(h);
  return `<section class="mis-band" data-h="${h}">
    <button class="mis-bandh" data-act="mis-horizon" data-h="${h}" aria-label="Open ${esc(H.name)}">
      <span class="mis-bn">${esc(H.name)}</span><span class="mis-bc met">${gs.length}</span>
      <span class="mis-bl">${esc(H.left || H.range)}</span>${I.chevR}
    </button>
    ${h === 'later' && DEMO ? '' : stripe(H)}
    ${gs.length ? `<div class="group mis-goals">${gs.map((g) => goalRow(g)).join('')}</div>`
      : `<div class="note mis-empty"><span>Nothing for ${esc(H.lower)} yet.</span><button class="btn sm" data-act="mis-add" data-h="${h}">${I.plus}Add</button></div>`}
    ${bandRead(h)}
  </section>`;
}

function streakLine() {
  const g = M.GRAPH, n = g?.streak ?? 0;
  if (DEMO) return { n: 3, title: '<b class="met">3</b> weeks in a row', sub: 'You closed every week goal since 28 Sep. Harborline decides this one.' };
  const weekGoals = goalsIn('week').filter((x) => !closedG(x)).length;
  if (n) return { n, title: `<b class="met">${n}</b> ${n === 1 ? 'week' : 'weeks in a row'}`, sub: weekGoals ? `You closed every week goal ${n === 1 ? 'last week' : `for ${n} weeks`}. ${plural(weekGoals, 'goal')} decide${weekGoals === 1 ? 's' : ''} this one.` : 'Set a week goal to keep it going.' };
  return { n: 0, title: 'No streak yet', sub: weekGoals ? `Close ${weekGoals === 1 ? 'this week\'s goal' : `all ${weekGoals} week goals`} by Sunday to start one.` : 'Set a week goal and close it by Sunday to start one.' };
}
function hero() {
  const hs = ['week', 'month', 'quarter', 'year'].map((h) => { const a = horizonAvg(h), t = hz(h).time ?? 0, gs = goalsIn(h), n = gs.length; return { h, a, t, n, on: DEMO ? a - t >= -0.1 : !gs.some((g) => behind(verdictOf(g))) }; });
  const names = { week: 'This week', month: hz('month').name, quarter: 'Quarter', year: hz('year').name };
  const act = active(), onp = act.filter((g) => verdictOf(g) === 'On pace').length;
  const st = streakLine();
  return `<div class="mis-hero surface">
    <p class="mis-hhead"><span>${act.length ? `<b class="met">${onp}</b> of ${act.length} goals on pace` : 'No goals yet'}</span></p>
    <div class="mis-hrings">${hs.map(({ h, a, t, n, on }, i) => `
      <button class="mis-hr" data-act="mis-horizon" data-h="${h}" aria-label="${esc(names[h])}: ${n ? `${pct(a)}% done, ` : 'no goals, '}${pct(t)}% of the time gone${n ? `, ${on ? 'on pace' : 'behind'}` : ''}">
        ${ring(a, 'as', 72, 7, { k: t, delay: i * 60, inner: `<b class="met mis-hp"><span data-count="${pct(a)}" data-fmt="pct">${pct(a)}</span><small>%</small></b>` })}
        <span class="mis-hn">${esc(names[h])}</span>
        <span class="mis-v ${n ? (on ? 'on' : 'behind') : 'none'}">${n ? (on ? 'On pace' : 'Behind') : 'No goals'}</span>
      </button>`).join('')}
    </div>
    <p class="mis-hkey">${tick}<span>The tick is how much of each horizon has gone.</span></p>
    <button class="mis-streak${st.n ? '' : ' cold'}" data-act="${DEMO ? 'mis-goal' : 'mis-horizon'}"${DEMO ? ' data-id="g1"' : ''} data-h="week">
      <span class="mis-flame">${I.flame}</span>
      <span class="mis-st-b"><span class="mis-st-t">${st.title}</span><span class="mis-st-s">${esc(st.sub)}</span></span>
      ${I.chevR}
    </button>
  </div>`;
}

function dirRow(d) {
  const gs = active().filter((g) => famOf(g) === d.fam);
  const on = gs.filter((g) => verdictOf(g) === 'On pace').length;
  return `<button class="row ic mis-dir" data-act="mis-dir" data-id="${d.id}">
    <span class="tile mis-dtile">${FAM_ICON[d.fam] ?? I.compass}</span>
    <span class="rbody"><span class="rtitle wrap">${esc(d.title)}</span><span class="rmeta">${FAMILIES[d.fam] ?? ''} · ${plural(gs.length, 'goal')} · ${on} on pace</span></span>${I.chevR}</button>`;
}
function lifeBand() {
  const ds = M.directions(), lg = goalsIn('life');
  return `<section class="mis-band" data-h="life">
    <button class="mis-bandh" data-act="mis-tab" data-s="purpose" aria-label="Open your purpose">
      <span class="mis-bn">Lifetime</span><span class="mis-bc met">${ds.length + lg.length}</span><span class="mis-bl">Under your purpose</span>${I.chevR}
    </button>
    ${ds.length || lg.length ? `<div class="group mis-dirs">${ds.map(dirRow).join('')}${lg.map((g) => goalRow(g)).join('')}
      <button class="row ic mis-addrow" data-act="mis-life-add"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">A lifetime direction</span></span></button></div>`
      : `<div class="note mis-empty"><span>The few directions your whole life serves: work, health, the people close to you.</span><button class="btn sm" data-act="mis-life-add">${I.plus}Set one</button></div>`}
  </section>`;
}

// What the agent can do in Mission (the server module's tools; auto ones run on their own and report after)
const TOOLS = DEMO ? [
  { name: 'set_goal', does: 'Turns a plain wish into a goal: a measure, a horizon, what it serves and the first steps', auto: false },
  { name: 'watch_pace', does: 'Checks every goal\'s pace on each heartbeat and tells you when one slips behind', auto: true },
  { name: 'link_work', does: 'Links new tasks and projects to the goal they move', auto: true },
  { name: 'check_in', does: 'Fills the Sunday check-in from your other apps for you to confirm', auto: true },
  { name: 'roll_over', does: 'Moves unfinished goals into the next period, or asks to drop them', auto: false },
  { name: 'break_down', does: 'Splits a long goal into milestones and this week\'s tasks', auto: false },
  { name: 'close_goal', does: 'Closes a goal when its work ships: a job goes live, a payment lands', auto: true },
  { name: 'draft_purpose', does: 'Drafts and revises your purpose from your reviews and exercises', auto: false },
] : [
  { name: 'mission_overview', does: 'Reads your goals by horizon with pace, your purpose, the streak and open milestones', auto: true },
  { name: 'mission_add_goal', does: 'Adds a goal on a horizon with the apps it serves, a parent and milestones', auto: false },
  { name: 'mission_log_checkin', does: 'Logs a check-in on a goal: on track, at risk or off track, with why', auto: true },
  { name: 'mission_move_goal', does: 'Moves a goal to another horizon', auto: false },
  { name: 'mission_close_milestone', does: 'Marks a milestone done when its work lands', auto: true },
  { name: 'mission_add_milestone', does: 'Adds a concrete step to a goal', auto: true },
];
function logRows() {
  if (DEMO) return M.DEMO_LOG.map(([t, text, id]) => ({ t, text, id }));
  const today = clock.today(), out = [];
  for (const c of M.col('checkins').list()) if (c.by === 'agent' && clock.dateOfIso(c.at ?? c.created_at) === today) { const g = findGoal(c.goal); if (g) out.push({ at: c.at ?? c.created_at, text: `Checked in on "${shortOf(g)}": ${{ on: 'on track', risk: 'at risk', off: 'off track' }[c.state]}.${c.note ? ` ${c.note}` : ''}`, id: g.id }); }
  for (const m of M.col('milestones').list()) if (m.by === 'agent' && clock.dateOfIso(m.updated_at) === today) { const g = findGoal(m.goal); if (g) out.push({ at: m.updated_at, text: `${m.done ? 'Closed' : 'Added'} the milestone "${m.title}" on "${shortOf(g)}".`, id: g.id }); }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).map((r) => ({ ...r, t: M.timeOfDoc(r.at) }));
}
function logBlock() {
  const rows = logRows();
  return `<div class="sh"><h2>${esc(agentName())} in Mission today</h2><span class="sh-count">${rows.length}</span></div>
    <div class="group mis-log">${rows.map(({ t, text, id }) => `<button class="row" data-act="mis-goal" data-id="${id}"><span class="mis-lt met">${t}</span><span class="rbody"><span class="rtitle wrap">${esc(text)}</span></span>${I.chevR}</button>`).join('')}
      <button class="row ic" data-act="mis-tools"><span class="tile">${I.agent}</span><span class="rbody"><span class="rtitle">What ${esc(agentName())} can do here</span><span class="rmeta">${TOOLS.length} tools · ${TOOLS.filter((t) => t.auto).length} run on their own</span></span>${I.chevR}</button>
    </div>`;
}

const purposeText = () => M.purpose().current?.text ?? '';
function nextSunday() {
  const t = clock.today(), dow = clock.dparts(t).dow, n = dow === 0 ? (clock.minutes() >= 19 * 60 ? 7 : 0) : 7 - dow;
  return n === 0 ? 'Today at 19:00' : n === 7 && dow === 0 ? 'next Sunday at 19:00' : 'Sunday at 19:00';
}

// ── section 1 · Horizons ──────────────────────────────────────────────
function renderHorizons(el, app) {
  const pt = purposeText();
  el.innerHTML = `${aspHead(app, { title: 'Horizons' })}
    <button class="mis-star${pt ? '' : ' empty'}" data-act="${pt ? 'mis-tab' : 'mis-purpose'}" data-s="purpose"><span class="mis-star-i">${I.compass}</span><span class="mis-star-t">${esc(pt || 'Write your purpose: the one line every goal here serves')}</span>${I.chevR}</button>
    ${hero()}
    ${['week', 'month', 'quarter', 'year', 'later'].map(band).join('')}
    ${lifeBand()}
    ${logBlock()}
    <div class="pad mis-foot"><button class="btn block" data-act="mis-checkin"${active().length ? '' : ' disabled'}>${I.check}Check in on every goal</button><p class="foot">${S.checkedIn ? `Checked in today. Next ${nextSunday()}.` : `Every Sunday at 19:00. ${esc(agentName())} reminds you; you say how each one is going.`}</p></div>`;
  if (!el._held) { el._held = true; onHold(el, '.mis-grow', (row) => goalPeek(row.dataset.id)); }
}

// ── section 2 · Graph ─────────────────────────────────────────────────
const GROUPS = () => [['week', 'This week'], ['month', hz('month').name], ['quarter', 'This quarter'], ['year', hz('year').name], ['later', 'Years out']];
function graphData() {
  const g = M.GRAPH;
  if (g) return g;
  // no answer from the PC yet: what the phone knows (no history)
  const done = GOALS.filter(isDoneG).length;
  return { since: null, weeks: [], totals: { set: GOALS.length, done, pending: active().length, missed: active().filter(overdue).length, dropped: 0 }, months: [], quarters: [], streak: 0, closed: [], history: {} };
}
function weekStrip(G) {
  const ws = G.weeks ?? [], closed = ws.filter((w) => w.hit === true).length, total = ws.filter((w) => w.hit === true || w.hit === false).length;
  const cell = (w, i) => (w.hit === null && i === ws.length - 1 ? 'now' : w.hit === true ? 'hit' : w.hit === false ? 'miss' : 'none');
  const sum = (rows) => { const t = rows.filter((r) => !r.now && r.total); return t.length ? `${t.filter((r) => r.hit === r.total).length} of ${t.length} closed` : 'None closed yet'; };
  const st = streakLine();
  return `<div class="mis-wk">
    <div class="mis-wk-h"><span class="mis-flame">${I.flame}</span><span class="mis-wk-t">${st.title}</span><span class="mis-wk-r">${total ? `${closed} of ${total} closed` : 'No week goals yet'}</span></div>
    <button class="mis-wk-strip" data-act="mis-weeks" style="--n:${Math.max(ws.length, 1)}" aria-label="Weeks: ${closed} of ${total} closed. Open the list.">
      <span class="mis-wk-g">${ws.map((w, i) => `<i class="mis-wq ${cell(w, i)}" title="${esc(w.label)}">${w.hit === true ? I.check : ''}</i>`).join('')}</span>
      <span class="mis-wk-m">${ws.map((w) => `<span>${esc(w.month ?? '')}</span>`).join('')}</span>
    </button>
    <div class="mis-wk-k"><span><i class="mis-wq hit sm"></i>Every week goal hit</span><span><i class="mis-wq miss sm"></i>One missed</span><span><i class="mis-wq now sm"></i>This week</span></div>
    <div class="mis-hits">
      ${[['Months', G.months ?? []], ['Quarters', G.quarters ?? []]].map(([l, rows]) => `<div class="mis-hit-r"><p class="mis-hit-l"><span>${l}</span><span>${sum(rows)}</span></p>
        <div class="mis-hit-g">${rows.map((r) => `<span class="mis-hp-c${r.total && r.hit === r.total ? ' full' : ''}${r.now ? ' now' : ''}"><b>${esc(r.label)}</b><span class="met">${r.hit}/${r.total}</span></span>`).join('')}</div></div>`).join('')}
    </div>
  </div>`;
}
function closedRow(c) {
  return `<button class="row ic mis-crow ${c.state}" data-act="mis-goal" data-id="${c.id}">
    <span class="tile mis-ct">${c.state === 'done' ? I.check : c.state === 'missed' ? MI.miss : MI.drop}</span>
    <span class="rbody"><span class="rtitle wrap">${esc(c.title)}</span><span class="rmeta">${c.state === 'done' ? 'Done' : c.state === 'missed' ? 'Missed' : 'Dropped'} · ${esc(String(c.when ?? '').replace('Dropped ', ''))} · ${esc(hz(c.horizon === 'dropped' ? 'week' : c.horizon).short)}</span></span>${I.chevR}</button>`;
}
function graphRead(G) {
  if (DEMO) return 'You close 10 of 15 weeks but only 1 of 3 months. Month goals go quiet in the middle: nobody looks at them between the 1st and the 31st. A check-in on the 15th would catch them.';
  const t = G.totals, ws = (G.weeks ?? []).filter((w) => w.hit === true || w.hit === false), hit = ws.filter((w) => w.hit).length;
  const late = active().filter((g) => behind(verdictOf(g)));
  const parts = [];
  parts.push(t.done ? `${t.done} of ${t.set} goals done so far.` : `${plural(t.set, 'goal')} set, none closed yet.`);
  if (ws.length) parts.push(`${hit} of ${plural(ws.length, 'week')} with week goals closed.`);
  if (late.length) parts.push(`${late.length === 1 ? `"${shortOf(late[0])}" is` : `${late.length} goals are`} behind or past due: ${late.length === 1 ? 'one look on Sunday decides it' : 'start with the shortest horizon'}.`);
  else if (active().length) parts.push('Nothing is behind right now.');
  return parts.join(' ');
}
function renderGraph(el, app) {
  const G = graphData(), t = G.totals;
  const closedN = t.done + t.missed, rate = closedN ? Math.round((t.done / closedN) * 100) : null;
  const rows = active().filter((g) => RANK[hOf(g)] <= 4 && tOf(g) != null).map((g) => ({ id: g.id, name: shortOf(g), gap: pOf(g) - tOf(g), group: hOf(g) }));
  const ws = G.weeks ?? [];
  const since = DEMO ? 'Since your life review on 6 Jul' : G.since ? `Since your first goal on ${dd(G.since)}` : 'Waiting for your PC';
  el.innerHTML = `${aspHead(app, { title: 'Graph', sub: since })}
    <div class="mis-gstat surface">
      <div class="mis-big"><b class="met c-as" data-count="${t.done}">${t.done}</b><span class="mis-big-l">goals done<small>of ${t.set} set</small></span></div>
      ${t.set ? compBar(t) : ''}
      <p class="mis-gsub">${rate == null ? 'Nothing has closed yet. A goal counts here when it\'s done or its period ends.' : `You hit <b>${rate}%</b> of the goals that closed.`}${DEMO ? ' Weeks go best; months are where goals go quiet.' : ''}</p>
    </div>
    ${ws.length ? `<div class="sh"><h2>Done and set</h2><span class="sh-count">${plural(ws.length, 'week')}</span></div>
    <div class="mis-card surface">${burnChart({ set: ws.map((w) => w.set), done: ws.map((w) => w.done), weeks: ws.map((w) => [w.label, w.month]) })}</div>` : ''}
    ${rows.length ? `<div class="sh"><h2>Pace by goal</h2><span class="sh-count">${rows.length}</span></div>
    <div class="mis-card surface">${paceBars(rows, GROUPS())}</div>` : ''}
    <div class="sh"><h2>Weeks you closed</h2></div>
    <div class="mis-card surface">${weekStrip(G)}</div>
    <div class="mis-wyn surface">
      <div class="mis-nh">${avatar()}<span class="mis-nn">${esc(agentName())}</span><span class="mis-nt">${DEMO ? 'Read on Sunday' : 'From your goals'}</span></div>
      <p class="mis-nx">${esc(graphRead(G))}</p>
      <div class="mis-na">${DEMO ? `<button class="btn sm" data-act="mis-mid">${I.cal}A 15th check-in</button>` : ''}<button class="btn sm" data-act="mis-review">Weekly review</button></div>
    </div>
    ${closedList().length ? `<div class="sh"><h2>Closed lately</h2><button class="sh-act" data-act="mis-closed">All ${closedList().length}${I.chevR}</button></div>
    <div class="group">${closedList().slice(0, 5).map(closedRow).join('')}</div>` : ''}`;
}

// ── section 3 · Purpose ───────────────────────────────────────────────
const EX = [
  { id: 'toast', title: 'Your 80th birthday', line: 'What you\'d want said about you, at 80', qs: ['Who is in the room?', 'What do they say you built?', 'What do they say you were like to be around?'] },
  { id: 'tuesday', title: 'An ordinary Tuesday, five years out', line: 'One normal day, hour by hour', qs: ['Where do you wake up, and when?', 'What work is in front of you at 11:00?', 'Who do you eat dinner with?'], demoDone: '6 Jul', demoResult: 'It gave you the Work direction: software that shops pay for, built from home.' },
  { id: 'nofail', title: 'If you couldn\'t fail', line: 'What you\'d start tomorrow if it was sure to work', qs: ['What would you start?', 'Who would you tell first?', 'What is the smallest version you could start this week?'] },
  { id: 'odyssey', title: 'Three five-year lives', line: 'This path, a completely different one, and one where money doesn\'t matter', qs: ['Life one: where this path is in five years.', 'Life two: if this path closed tomorrow.', 'Life three: if money and what people think didn\'t matter.'] },
  { id: 'whys', title: 'Five whys', line: 'Ask why about one goal until you reach the reason under it', qs: ['Pick one goal. Why that one?', 'Why does that matter to you?', 'Keep going until the answer stops changing.'], demoDone: '12 Oct', demoResult: 'You did it on ₹2 lakh a month. It ended at your parents, which is why they are in the purpose.' },
];
const exDone = (e) => (DEMO ? e.demoDone : null);
function treeNode(g, seen = new Set()) {
  if (seen.has(g.id)) return ''; seen.add(g.id);
  const kids = childrenOf(g.id);
  return `<li><button class="mis-tnode" data-act="mis-goal" data-id="${g.id}">${ring(pOf(g), 'as', 26, 3.2, { k: tk(g) })}<span class="mis-tr-t">${esc(shortOf(g))}</span><span class="mis-tr-h">${esc(hz(hOf(g)).short)}</span><span class="mis-tr-p met">${pct(pOf(g))}%</span></button>${kids.length ? `<ul>${kids.map((k) => treeNode(k, seen)).join('')}</ul>` : ''}</li>`;
}
function tree() {
  const ds = M.directions();
  const fams = ds.length ? ds.map((d) => ({ d, fam: d.fam })) : ['work', 'health', 'people'].filter((f) => active().some((g) => famOf(g) === f)).map((fam) => ({ d: null, fam }));
  if (!fams.length) return '<p class="hint">Your goals show here, under the part of life they serve.</p>';
  return fams.map(({ d, fam }) => {
    const gs = active().filter((g) => famOf(g) === fam);
    const roots = gs.filter((g) => !g.parent || !gs.some((x) => x.id === g.parent));
    return `<div class="mis-tdir">
      <button class="mis-tdh" data-act="${d ? 'mis-dir' : 'mis-life-add'}" data-id="${d?.id ?? ''}" data-fam="${fam}"><span class="tile mis-dtile">${FAM_ICON[fam]}</span><span class="mis-tdh-b"><span class="mis-tdh-k">${FAMILIES[fam]}</span><span class="mis-tdh-t">${esc(d?.title ?? 'No direction written yet')}</span></span><span class="mis-tdh-n met">${gs.length}</span></button>
      <ul class="mis-tree">${roots.map((g) => treeNode(g)).join('')}</ul>
    </div>`;
  }).join('');
}
function gaps() {
  const has = (id) => active().some((g) => g.aspects?.includes(id));
  const lead = (id) => active().some((g) => g.aspects?.[0] === id);
  const rows = ASPECTS.filter((a) => !has(a.id)).map((a) => [a, a.score != null ? `No goal. ${a.name} scored ${a.score} at your last scoring.` : 'No goal yet.', 'none'])
    .concat(ASPECTS.filter((a) => has(a.id) && !lead(a.id) && a.id !== 'money').map((a) => [a, `Only rides along with ${active().filter((g) => g.aspects?.includes(a.id)).map(shortOf).join(', ')}.`, 'rides']));
  return rows.map(([a, text, kind]) => `<div class="row ic mis-gap">${aspectTile(a.id)}<span class="rbody"><span class="rtitle">${esc(a.name)}</span><span class="rmeta ell-2">${esc(text)}</span></span>
    ${kind === 'none' ? `<button class="btn sm" data-act="mis-add" data-asp="${a.id}">${I.plus}Goal</button>` : `<button class="btn sm" data-act="mis-ask" data-id="${a.id}" data-q="Help me set a goal for ${esc(a.name)}">Talk it through</button>`}</div>`).join('');
}
function renderPurpose(el, app) {
  const P = M.purpose(), cur = P.current, values = cur?.values ?? [];
  const meta = cur ? (DEMO ? `${M.DEMO_PURPOSE.written}. ${M.DEMO_PURPOSE.revised}.` : `${cur.by === 'agent' ? `Drafted with ${esc(agentName())}` : 'Written'} ${esc(M.whenOf(cur.created_at))}${P.versions.length > 1 ? ` · version ${P.versions.length}` : ''}.`) : '';
  el.innerHTML = `${aspHead(app, { title: 'Purpose' })}
    <div class="mis-pcard surface${cur ? '' : ' empty'}">
      <span class="mis-pc-i">${I.compass}</span>
      <p class="mis-ptext">${cur ? esc(cur.text) : 'Your purpose goes here: one line that every goal on every horizon serves.'}</p>
      ${meta ? `<p class="mis-pmeta">${meta}</p>` : `<p class="mis-pmeta">Write it yourself, or let ${esc(agentName())} draft one from your goals for you to change.</p>`}
      <div class="mis-pacts"><button class="btn sm" data-act="mis-purpose">${cur ? I.sparkle : I.plus}${cur ? `Revisit with ${esc(agentName())}` : 'Write it'}</button>${cur ? `<button class="btn sm" data-act="mis-brain">${I.brain}Brain note</button>` : `<button class="btn sm" data-act="mis-p-draft">${I.sparkle}Draft it with ${esc(agentName())}</button>`}</div>
    </div>
    ${values.length ? `<div class="sh"><h2>What you stand by</h2></div>
    <div class="group mis-vals">${values.map(([t, s], i) => `<div class="row"><span class="mis-vn met">${i + 1}</span><span class="rbody"><span class="rtitle">${esc(t)}</span>${s ? `<span class="rmeta">${esc(s)}</span>` : ''}</span></div>`).join('')}</div>` : ''}
    <div class="sh"><h2>How your goals serve it</h2><span class="sh-count">${active().length}</span></div>
    <div class="mis-treecard surface">${tree()}</div>
    <div class="sh"><h2>Not served yet</h2></div>
    <div class="group">${gaps() || '<p class="hint pad">Every app has a goal.</p>'}</div>
    <div class="sh"><h2>Find it again</h2><span class="sh-count">${EX.length}</span></div>
    <div class="group">${EX.map((e) => `<button class="row mis-exr" data-act="mis-ex" data-id="${e.id}"><span class="rbody"><span class="rtitle">${esc(e.title)}</span><span class="rmeta ell-2">${exDone(e) ? `<span class="mis-v done">Done ${esc(exDone(e))}</span> · ` : ''}${esc(e.line)}</span></span>${I.chevR}</button>`).join('')}</div>
    ${P.versions.length > 1 ? `<div class="sh"><h2>Earlier versions</h2></div>
    <div class="group mis-vers">${P.versions.map((v, i) => `<div class="row"><span class="mis-vd met">${esc(v.label ?? dd(clock.dateOfIso(v.created_at)))}</span><span class="rbody"><span class="rtitle mis-vt${i ? ' old' : ''}">${esc(v.text)}</span><span class="rmeta">${esc(i ? (v.why ?? (v.by === 'agent' ? `Drafted with ${agentName()}` : 'Your wording')) : 'Now')}</span></span></div>`).join('')}</div>` : ''}`;
}

// ── a goal ────────────────────────────────────────────────────────────
function goalPage(id) {
  const g = findGoal(id);
  if (!g) { if (M.directions().some((d) => d.id === id)) return dirPage(id); toast('That goal is not in Mission'); return; }
  push({
    title: shortOf(g), short: shortOf(g), back: backLabel(), aspect: 'mission', cls: 'mis-page',
    right: `<button class="gbtn chrome icon" data-act="mis-ask" data-id="${g.id}" aria-label="Ask ${esc(agentName())} about this goal">${I.sparkle}</button>`,
    render(sc, page) {
      page._mis = () => {
        const cur = findGoal(page.dataset.goal) ?? g;
        const ta = $('textarea[data-note]', sc), focus = document.activeElement === ta, val = ta?.value;
        sc.innerHTML = cur.state ? closedHtml(cur) : goalHtml(cur); wireCharts(sc);
        if (focus) { const t = $('textarea[data-note]', sc); if (t) { t.value = val; t.focus(); } }
      };
      page.dataset.goal = g.id;
      page._mis();
      drawThread(sc, 520);
      if (!reduced()) stagger($$('.mis-msr, .mis-trow', sc), { y: 8, each: 35, delay: 260 });
    },
  });
}
function threadOf(g) {
  const chain = []; let cur = g; const seen = new Set();
  while (cur && !seen.has(cur.id)) { chain.push(cur); seen.add(cur.id); cur = parentOf(cur); }
  return chain;
}
function threadHtml(g) {
  const chain = threadOf(g), d = dirOf(chain.at(-1)), pt = purposeText();
  const node = (x, i) => `<button class="mis-tn${i === 0 ? ' here' : ''}" data-act="mis-goal" data-id="${x.id}" ${i === 0 ? 'aria-current="true"' : ''}>
      <span class="mis-tn-dot">${ring(pOf(x), 'as', 30, 3.6, { k: tk(x) })}</span>
      <span class="mis-tn-b"><span class="mis-tn-k">${i === 0 ? 'This goal' : esc(hz(hOf(x)).name)}</span><span class="mis-tn-t">${esc(x.title)}</span></span>
      <span class="mis-tn-v met">${pct(pOf(x))}%</span></button>`;
  return `<div class="mis-thread surface">
    <button class="mis-tn top" data-act="${pt ? 'mis-tab' : 'mis-purpose'}" data-s="purpose"><span class="mis-tn-dot glyph">${I.compass}</span><span class="mis-tn-b"><span class="mis-tn-k">Purpose</span><span class="mis-tn-t">${esc(pt || 'Not written yet. Write it')}</span></span></button>
    ${d ? `<button class="mis-tn" data-act="mis-dir" data-id="${d.id}"><span class="mis-tn-dot glyph">${FAM_ICON[d.fam]}</span><span class="mis-tn-b"><span class="mis-tn-k">Lifetime · ${FAMILIES[d.fam]}</span><span class="mis-tn-t">${esc(d.title)}</span></span></button>` : ''}
    ${chain.map(node).reverse().join('')}
    ${REAL && !g.state && !isDoneG(g) ? `<button class="mis-tn add" data-act="mis-parent" data-id="${g.id}"><span class="mis-tn-dot glyph">${MI.serves}</span><span class="mis-tn-b"><span class="mis-tn-k">${g.parent ? 'Serves' : 'Serves nothing above it yet'}</span><span class="mis-tn-t">${g.parent ? 'Change what it serves' : 'Link it to a longer goal'}</span></span></button>` : ''}
  </div>`;
}
function verdictPill(v) { return `<span class="pill mis-pill ${vClass(v)}">${v === 'On pace' ? I.check : behind(v) ? I.clock : ''}${esc(v)}</span>`; }
function goalHtml(g) {
  const x = ext(g), H = hz(hOf(g)), v = verdictOf(g), done = isDoneG(g);
  const p = pct(pOf(g)), t = tOf(g);
  const ms = x.ms ?? [];
  const msDone = ms.filter((m) => m.done).length;
  const nextId = x.next?.task;
  const tasks = tasksOf(g.id).filter((tt) => tt.id !== nextId);
  const kids = childrenOf(g.id);
  const projs = [...new Set([...(x.projects ?? []), ...tasks.map((tt) => tt.project).filter(Boolean)])].map(project).filter(Boolean);
  const nextTask = nextId ? TASKS.find((tt) => tt.id === nextId) : null;
  const acts = (x.acts ?? []).map(([l, a, id]) => `<button class="btn sm" data-act="${a}" data-id="${id}">${/mis-ask/.test(a) || (a === 'mis-say' && /draft|split|job/.test(id)) ? I.sparkle : a === 'mis-roll' ? MI.roll : ''}${esc(l)}</button>`).join('');
  const says = done ? 'Closed. It counts toward everything above it.' : x.say ?? (v === 'On pace' ? 'On pace. Nothing to change this week.' : 'Behind pace. Tell me what is in the way and I will plan the next step.');
  const nxt = !done && x.next ? `<div class="sh"><h2>Next step</h2></div>
      <div class="group"><div class="row mis-next">
        <button class="check" data-act="mis-next-check" data-id="${g.id}" data-task="${nextTask?.id ?? ''}" data-ms="${x.next.ms ?? ''}" aria-label="Mark the next step done"><svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg></button>
        <button class="rbody mis-next-b" data-act="${nextTask ? 'mis-task' : 'mis-next-add'}" data-id="${nextTask?.id ?? g.id}"><span class="rtitle wrap">${esc(x.next.text)}</span><span class="rmeta">${nextTask?.late ? `<span class="late">${esc(nextTask.late)}</span>` : esc(nextTask?.when ?? (x.next.ms ? 'Milestone · not on Today yet' : 'Not planned yet'))}${nextTask ? ' · on Today' : ''}</span></button>
        ${nextTask ? I.chevR : `<button class="btn sm" data-act="mis-next-add" data-id="${g.id}">Today</button>`}
      </div></div>` : '';
  return `
    <div class="phead mis-gph">
      <p class="kicker c-as">${esc(kickerOf(g))}</p>
      <h1 class="title1 mis-gtitle">${esc(g.title)}</h1>
      <div class="mis-asps">${(g.aspects ?? []).map((a) => `<button class="chip sm mis-achip" data-act="mis-aspect" data-id="${a}"><i class="dot" style="--c:var(--${a})"></i>${esc(aspect(a)?.name ?? a)}</button>`).join('')}</div>
    </div>
    <div class="mis-ghero surface">
      <div class="mis-gh-top">
        ${gRing(g, 140, 13, { count: true })}
        <div class="mis-gh-side">
          ${verdictPill(v)}
          <span class="mis-stat"><b class="met c-as">${p}<small>%</small></b><span>${done ? 'done · closed' : `done${measureOf(g) ? ` · ${esc(measureOf(g))}` : ''}`}</span></span>
          ${done || t == null ? '' : `<span class="mis-stat"><b class="met">${pct(t)}<small>%</small></b><span>${tick}of ${esc(H.of)} gone</span></span>`}
        </div>
      </div>
      <div class="mis-say">${avatar('sm')}<p>${esc(says)}</p></div>
      ${acts && !done ? `<div class="mis-say-acts">${acts}</div>` : ''}
    </div>
    ${nxt}
    <div class="sh"><h2>Milestones</h2>${ms.length ? `<span class="sh-count">${msDone} of ${ms.length}</span>` : ''}</div>
    <div class="group mis-ms">${ms.map((m) => `<div class="row mis-msr${m.done ? ' is-done' : ''}"><button class="check${m.done ? ' done' : ''}" data-act="mis-ms" data-id="${g.id}" data-ms="${m.id}" aria-label="${m.done ? 'Mark not done' : 'Mark done'}: ${esc(m.title)}"><svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg></button><span class="rbody"><span class="rtitle wrap">${esc(m.title)}</span>${m.when ? `<span class="rmeta${/late/.test(m.when) ? ' late' : ''}">${esc(m.when)}</span>` : ''}</span>${REAL ? `<button class="mis-msx" data-act="mis-ms-del" data-ms="${m.id}" aria-label="Remove ${esc(m.title)}">${MI.drop}</button>` : ''}</div>`).join('')}
      ${done ? '' : `<form class="row mis-msadd" data-goal="${g.id}"><span class="tile">${I.plus}</span><input type="text" enterkeyhint="done" placeholder="${ms.length ? 'Another milestone' : 'A first milestone: a step you can see done'}" aria-label="Add a milestone" /></form>`}</div>
    ${tasks.length || projs.length || kids.length ? `<div class="sh"><h2>Feeding it</h2><span class="sh-count">${tasks.length + projs.length + kids.length}</span></div>
      <div class="group">
        ${kids.map((k) => goalRow(k, { serves: false })).join('')}
        ${tasks.map((tt) => `<button class="row ic mis-trow" data-act="mis-task" data-id="${tt.id}"><span class="tile">${tt.list === 'done' ? I.check : I.cal}</span><span class="rbody"><span class="rtitle wrap${tt.list === 'done' ? ' done' : ''}">${esc(tt.title)}</span><span class="rmeta">${tt.list === 'done' ? 'Done' : tt.late ? `<span class="late">${esc(tt.late)}</span>` : esc(tt.when ?? 'No date')} · Task</span></span>${I.chevR}</button>`).join('')}
        ${projs.map((pr) => `<button class="row ic" data-act="${pr.slug === 'content-os' ? 'mis-content' : 'mis-project'}" data-id="${pr.slug}"><span class="tile mis-ptile">${String(pr.icon ?? '').length > 1 ? pr.icon : `<b>${esc(pr.icon ?? pr.name?.[0] ?? '')}</b>`}</span><span class="rbody"><span class="rtitle">${esc(pr.name)}</span><span class="rmeta">${pr.slug === 'content-os' ? 'Content OS · followers, reels, posts' : `Project · ${plural(pr.tasks ?? 0, 'open task')}`}</span></span>${I.chevR}</button>`).join('')}
      </div>` : ''}
    <div class="sh"><h2>Why it matters</h2></div>
    ${threadHtml(g)}
    ${x.hist?.length ? `<div class="sh"><h2>Pace</h2><span class="sh-count">${esc(x.start ? `Since ${x.start}` : '')}</span></div>
      <div class="mis-card surface">${paceChart({ hist: x.hist, t: t ?? 0, axis: x.axis, name: shortOf(g) })}</div>` : ''}
    <div class="sh"><h2>Check-ins</h2><span class="sh-count">${(x.checks ?? []).length}</span></div>
    <div class="group mis-checks">${(x.checks ?? []).map((c) => `<div class="row"><span class="mis-cdot ${c.state}" aria-hidden="true"></span><span class="rbody"><span class="rtitle wrap">${esc(c.note || { on: 'On track', risk: 'At risk', off: 'Off track' }[c.state])}</span><span class="rmeta">${esc(c.label)} · ${esc(c.by)} · ${{ on: 'On track', risk: 'At risk', off: 'Off track' }[c.state]}</span></span></div>`).join('')}
      ${done ? '' : `<button class="row ic mis-addrow" data-act="mis-checkone" data-id="${g.id}"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">Check in now</span></span></button>`}</div>
    <div class="sh"><h2>Notes</h2></div>
    <label class="mis-notes surface"><textarea rows="3" data-note="${g.id}" placeholder="What you want to remember about this goal" aria-label="Notes on this goal">${esc(g.notes ?? '')}</textarea></label>
    <div class="mis-gacts">
      ${overdue(g) ? `<button class="btn" data-act="mis-roll" data-id="${g.id}">${MI.roll}Roll over</button>` : `<button class="btn" data-act="mis-move" data-id="${g.id}">${MI.move}Move</button>`}
      <button class="btn" data-act="mis-checkone" data-id="${g.id}"${done ? ' disabled' : ''}>${I.clock}Check in</button>
      <button class="btn mis-donebtn" data-act="mis-done" data-id="${g.id}">${I.check}${done ? 'Reopen' : 'Done'}</button>
    </div>
    ${REAL && !done ? `<div class="pad mis-again"><button class="btn block ghost mis-dropbtn" data-act="mis-drop" data-id="${g.id}">${MI.drop}Drop this goal</button></div>` : ''}`;
}
function closedHtml(c) {
  const par = parentOf(c);
  const word = { done: 'Done', missed: 'Missed', dropped: 'Dropped' }[c.state];
  return `
    <div class="phead mis-gph">
      <p class="kicker c-as">${esc(kickerOf(c))}</p>
      <h1 class="title1 mis-gtitle">${esc(c.title)}</h1>
      <div class="mis-asps">${(c.aspects ?? []).map((a) => `<button class="chip sm mis-achip" data-act="mis-aspect" data-id="${a}"><i class="dot" style="--c:var(--${a})"></i>${esc(aspect(a)?.name ?? a)}</button>`).join('')}</div>
    </div>
    <div class="mis-ghero surface">
      <div class="mis-gh-top">${gRing(c, 140, 13)}
        <div class="mis-gh-side"><span class="pill mis-pill ${vClass(word)}">${esc(word)}</span><span class="mis-stat"><b class="mis-when">${esc(String(c.when ?? '').replace('Dropped ', ''))}</b><span>${c.state === 'done' ? 'closed' : c.state === 'missed' ? 'the period ended' : 'let go'}</span></span></div>
      </div>
      ${c.note ? `<div class="mis-say">${avatar('sm')}<p>${esc(c.note)}</p></div>` : ''}
    </div>
    ${par ? `<div class="sh"><h2>It served</h2></div><div class="group">${goalRow(par, { serves: false })}</div>` : ''}
    ${c.state !== 'done' ? `<div class="pad mis-again"><button class="btn block" data-act="mis-again" data-id="${c.id}">${I.rewind}Set it again</button></div>` : ''}`;
}

function drawThread(root, delay = 0) {
  const t = $('.mis-thread', root); if (!t || reduced()) return;
  t.classList.add('pre');
  setTimeout(() => requestAnimationFrame(() => t.classList.remove('pre')), delay);
}
function drawStripes(root, delay = 0) {
  if (!root || reduced()) return;
  const s = $$('.mis-stripe', root); if (!s.length) return;
  s.forEach((x) => x.classList.add('pre'));
  root.getBoundingClientRect();
  setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => s.forEach((x) => x.classList.remove('pre')))), delay);
}
function enter(root, delay = 120) {
  if (!root || reduced()) return;
  stagger($$('.mis-band .mis-grow, .mis-dir, .mis-hr', root).slice(0, 18), { y: 10, each: 32, delay });
}
function wireCharts(root) {
  $$('.mis-chart[data-scrub]', root).forEach((c) => {
    if (c._w) return; c._w = true;
    let pts = []; try { pts = JSON.parse(c.dataset.scrub); } catch { return; }
    const plot = $('.mis-plot', c), xh = $('.mis-xh', c), tip = $('.mis-tip', c);
    let hideT, live = false;
    const show = (e) => {
      const r = plot.getBoundingClientRect(); const fx = (e.clientX - r.left) / r.width;
      const best = pts.reduce((a, p) => (Math.abs(p.x - fx) < Math.abs(a.x - fx) ? p : a), pts[0]);
      if (!best) return;
      xh.style.left = `${best.x * 100}%`; tip.innerHTML = best.h;
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(best.x * r.width - tw / 2, 0), r.width - tw)}px`;
      c.classList.add('scrub'); clearTimeout(hideT);
      if (best !== c._last) { c._last = best; haptic(3); }
    };
    plot.addEventListener('pointerdown', (e) => { live = true; show(e); });
    plot.addEventListener('pointermove', (e) => { if (live || e.pointerType === 'mouse') show(e); });
    const hide = () => { live = false; clearTimeout(hideT); hideT = setTimeout(() => c.classList.remove('scrub'), 1600); };
    plot.addEventListener('pointerup', hide); plot.addEventListener('pointerleave', hide); plot.addEventListener('pointercancel', hide);
  });
}

// ── a lifetime direction ──────────────────────────────────────────────
function dirPage(id) {
  const d = M.directions().find((x) => x.id === id); if (!d) return;
  push({
    title: d.title, short: FAMILIES[d.fam], back: backLabel(), aspect: 'mission', cls: 'mis-page',
    render(sc) {
      const fam = active().filter((g) => famOf(g) === d.fam);
      const roots = fam.filter((g) => !g.parent || !fam.some((x) => x.id === g.parent));
      const asps = d.aspects?.length ? d.aspects : ASPECTS.filter((a) => a.fam === d.fam).map((a) => a.id);
      sc.innerHTML = `
        <div class="phead"><p class="kicker c-as">Lifetime · ${FAMILIES[d.fam]}</p><h1 class="title1 mis-gtitle">${esc(d.title)}</h1><p class="sub">One of the directions under your purpose.</p></div>
        <div class="group">${asps.map((a) => { const n = active().filter((g) => g.aspects?.includes(a)).length, A = aspect(a); return A ? `<button class="row ic" data-act="mis-aspect" data-id="${a}">${aspectTile(a)}<span class="rbody"><span class="rtitle">${esc(A.name)}</span><span class="rmeta">${n ? plural(n, 'goal') : 'No goal yet'}${A.score != null ? ` · scored ${A.score}` : ''}</span></span>${I.chevR}</button>` : ''; }).join('')}</div>
        <div class="sh"><h2>Goals in this direction</h2><span class="sh-count">${fam.length}</span></div>
        ${roots.length ? `<div class="mis-treecard surface"><ul class="mis-tree top">${roots.map((g) => treeNode(g)).join('')}</ul></div>` : '<p class="hint pad">No goal serves this direction yet.</p>'}
        <div class="pad mis-again"><button class="btn block" data-act="mis-add" data-asp="${asps[0] ?? 'mission'}">${I.plus}A goal in this direction</button>
        ${REAL ? `<button class="btn block ghost" data-act="mis-life-del" data-id="${d.id}">${MI.drop}Remove this direction</button>` : ''}</div>`;
    },
  });
}

// ── a horizon: one period, the one before it and the one after ────────
function horizonPage(h) {
  if (h === 'life') return openPurpose();
  const H = hz(h);
  push({
    title: H.name, short: H.name, back: backLabel(), aspect: 'mission', cls: 'mis-page mis-hpage',
    render(sc, page) {
      page._mis = () => { const b = $('.mis-hbody', page); if (b) { b.innerHTML = horizonBody(h); wireSegs(b); } };
      sc.innerHTML = `
        <div class="phead"><p class="kicker c-as">Horizon</p><h1 class="lt">${esc(H.name)}</h1><p class="sub">${esc(H.range)}${H.left ? ` · ${esc(H.left)}` : ''}</p></div>
        ${H.prev ? `<div class="pad mis-hseg">${seg(`mis-per-${h}`, [['-1', H.prev], ['0', H.name], ['1', H.next]], String(S.period[h] ?? 0))}</div>` : ''}
        <div class="mis-hbody">${horizonBody(h)}</div>`;
      page.addEventListener('change', (e) => {
        const sg = e.target.closest('.seg'); if (!sg || !sg.dataset.seg.startsWith('mis-per-')) return;
        S.period[h] = Number(e.detail);
        const b = $('.mis-hbody', page); b.innerHTML = horizonBody(h); wireSegs(b); pulse(b); drawStripes(b);
        b.classList.remove('mis-swap'); void b.offsetWidth; b.classList.add('mis-swap');
        if (!reduced()) stagger($$('.row', b).slice(0, 12), { y: 8, each: 30 });
      });
      drawStripes(sc, 380);
    },
  });
}
/** The period before or after this one, for a horizon: key, start and end. */
function shiftPeriod(h, n) {
  const H = hz(h);
  if (!H.start) return null;
  let start;
  if (h === 'week') start = clock.addDays(H.start, 7 * n);
  else {
    const months = { month: 1, quarter: 3, year: 12, later: 120 }[h];
    const p = clock.dparts(H.start), t = p.year * 12 + p.month + months * n;
    start = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
  }
  const key = M.periodKey(h, start);
  let end;
  if (h === 'week') end = clock.addDays(start, 6);
  else { const months = { month: 1, quarter: 3, year: 12, later: 120 }[h]; const p = clock.dparts(start), t = p.year * 12 + p.month + months; end = clock.addDays(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`, -1); }
  return { key, start, end };
}
function horizonBody(h) {
  const H = hz(h), per = S.period[h] ?? 0;
  if (per === -1) {
    let past;
    if (DEMO) past = h === 'week' ? closedList().filter((c) => c.horizon === 'week' && c.w === 14) : h === 'month' ? closedList().filter((c) => c.horizon === 'month' && c.w === 12) : h === 'quarter' ? closedList().filter((c) => c.horizon === 'quarter') : [];
    else {
      const prev = shiftPeriod(h, -1);
      const ids = new Set();
      past = [...GOALS.filter((g) => hOf(g) === h && g.period === prev?.key), ...closedList().filter((c) => c.horizon === h && c.period === prev?.key)].filter((g) => !ids.has(g.id) && ids.add(g.id));
    }
    const hit = past.filter((c) => isDoneG(c)).length;
    const carried = past.filter((g) => !g.state && !isDoneG(g));
    return `<div class="mis-past surface"><b class="met c-as">${hit}<small>/${past.length}</small></b><span>${past.length ? `${hit === past.length ? 'Every goal hit' : `${past.length - hit} not hit`} in ${esc(H.prevRange)}` : `${esc(H.prev)} had no goals here.`}</span></div>
      ${past.length ? `<div class="sh"><h2>${esc(H.prev)}</h2><span class="sh-count">${past.length}</span></div><div class="group">${past.map((g) => (g.state ? closedRow(g) : goalRow(g))).join('')}</div>` : ''}
      ${REAL && carried.length ? `<p class="hint">${carried.length === 1 ? 'One is still open' : `${carried.length} are still open`}: roll ${carried.length === 1 ? 'it' : 'them'} into ${esc(H.lower)} from the goal page.</p>` : ''}
      ${DEMO && h === 'week' ? `<p class="hint">Nothing rolled over: both of last week's goals closed.</p>` : ''}`;
  }
  if (per === 1) {
    const nextP = REAL ? shiftPeriod(h, 1) : null;
    const planned = REAL ? GOALS.filter((g) => hOf(g) === h && g.period === nextP?.key) : [];
    const rolled = active().filter((g) => hOf(g) === h && g.period === H.key && behind(verdictOf(g)));
    return `<div class="note mis-nextp">${avatar('sm')}<span>${rolled.length ? `If ${rolled.map((g) => `"${esc(shortOf(g))}"`).join(' and ')} isn't done by ${esc(H.due || 'the end')}, you can roll it into ${esc(H.nextRange)}.` : planned.length ? `${plural(planned.length, 'goal')} planned for ${esc(H.next)}.` : `Nothing planned for ${esc(H.next)} yet. Plan it with your Sunday check-in, or add a goal now.`}</span></div>
      ${planned.length ? `<div class="sh"><h2>Planned</h2></div><div class="group">${planned.map((g) => goalRow(g)).join('')}</div>` : ''}
      ${rolled.length ? `<div class="sh"><h2>Would roll over</h2></div><div class="group">${rolled.map((g) => goalRow(g)).join('')}</div>` : ''}
      <div class="pad mis-again"><button class="btn block" data-act="mis-add" data-h="${h}" data-next="1">${I.plus}A goal for ${esc(H.next)}</button></div>`;
  }
  const gs = goalsIn(h);
  const parents = [...new Set(gs.map((g) => g.parent).filter(Boolean))].map(findGoal).filter(Boolean);
  const taskCount = gs.reduce((a, g) => a + tasksOf(g.id).length, 0);
  const behindN = gs.filter((g) => behind(verdictOf(g))).length;
  const read = DEMO
    ? (h === 'week' ? `${taskCount} tasks feed this week's goals. Thursday evening is the last free deep-work block before Sunday.` : h === 'month' ? 'All three October goals are behind. The 5,000 followers can\'t land by the 31st; split it?' : h === 'quarter' ? 'The quarter is on pace. It leans on Harborline paying this week.' : h === 'year' ? 'Two goals, both behind on the calendar. ₹2 lakh a month moves when the quarter lands.' : 'One goal, and it\'s on pace.')
    : gs.length ? `${plural(taskCount, 'task')} feed${taskCount === 1 ? 's' : ''} ${esc(H.lower)}'s goals. ${behindN ? `${behindN} ${behindN === 1 ? 'is' : 'are'} behind or past due.` : 'None is behind.'}${H.time != null && h !== 'later' ? ` ${pct(H.time)}% of ${esc(H.of)} has gone.` : ''}` : `No goals for ${esc(H.lower)} yet.`;
  const note = M.noteOf(h);
  return `${H.cells ? `<div class="mis-hstripe surface">${stripe(H, { big: true, days: h === 'week' })}
      <p class="foot">${h === 'week' ? 'Tap a day to open it on Today.' : `${pct(H.time)}% of ${esc(H.of)} has gone.`}</p></div>` : ''}
    <div class="sh"><h2>Goals</h2><span class="sh-count">${gs.length}</span><button class="sh-act" data-act="mis-add" data-h="${h}">${I.plus}Add</button></div>
    ${gs.length ? `<div class="group">${gs.map((g) => goalRow(g)).join('')}</div>` : `<div class="note mis-empty"><span>Nothing here yet.</span><button class="btn sm" data-act="mis-add" data-h="${h}">${I.plus}Add</button></div>`}
    ${parents.length ? `<div class="sh"><h2>Rolls up into</h2></div><div class="group">${parents.map((g) => goalRow(g, { serves: false })).join('')}</div>` : ''}
    <div class="note mis-nextp">${avatar('sm')}<span>${read}</span></div>
    <div class="sh"><h2>Notes for ${esc(H.lower)}</h2></div>
    <label class="mis-notes surface"><textarea rows="3" data-hnote="${h}" placeholder="What this ${esc(H.short.toLowerCase())} is about" aria-label="Notes for ${esc(H.name)}">${esc(note?.body ?? '')}</textarea></label>`;
}

// ── all closed goals, by month ───────────────────────────────────────
function closedPage() {
  push({
    title: 'Closed goals', short: 'Closed', back: backLabel(), aspect: 'mission', cls: 'mis-page',
    render(sc) {
      const cs = closedList(), t = graphData().totals;
      let groups;
      if (DEMO) groups = [['October', 12, 15], ['September', 8, 11], ['August', 4, 7], ['July', 0, 3]].map(([m, a, b]) => [m, cs.filter((c) => c.w >= a && c.w <= b)]);
      else {
        const by = new Map();
        for (const c of (M.GRAPH?.closed ?? [])) { const d = String(c.when ?? '').slice(0, 7); const k = d ? `${clock.MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : 'Earlier'; if (!by.has(k)) by.set(k, []); by.get(k).push(cs.find((x) => x.id === c.id)); }
        groups = [...by.entries()];
      }
      sc.innerHTML = `<div class="phead"><p class="kicker c-as">${DEMO ? 'Since 6 Jul' : M.GRAPH?.since ? `Since ${dd(M.GRAPH.since)}` : 'Mission'}</p><h1 class="lt">Closed goals</h1><p class="sub"><b>${t.done}</b> done, <b>${t.missed}</b> missed, <b>${t.dropped}</b> dropped.</p></div>
        ${groups.map(([m, list]) => (list.length ? `<div class="sh"><h2>${esc(m)}</h2><span class="sh-count">${list.length}</span></div><div class="group">${list.map(closedRow).join('')}</div>` : '')).join('') || '<p class="hint pad">Nothing has closed yet.</p>'}`;
    },
  });
}

// ── sheets ────────────────────────────────────────────────────────────
const asMission = (b, el) => { el.dataset.aspect = 'mission'; el.classList.add('mis-sheet'); };
const pickMark = `<span class="mis-pick" aria-hidden="true">${I.check}</span>`;

function weeksSheet() {
  const ws = graphData().weeks ?? [];
  openSheet({
    title: 'Weeks', sub: `${ws.filter((w) => w.hit === true).length} of ${ws.filter((w) => w.hit != null).length} closed. A week closes when every week goal is hit.`, large: true,
    body(b, el) {
      asMission(b, el);
      b.innerHTML = ws.length ? `<div class="group">${ws.map((w, i) => i).reverse().map((i) => {
        const w = ws[i];
        const items = DEMO ? [...closedList().filter((c) => c.horizon === 'week' && c.w === i).map((c) => `${c.state === 'done' ? '✓' : '✗'} ${c.title}`), ...(i === ws.length - 1 ? goalsIn('week').filter((g) => !g.state).map((g) => `○ ${shortOf(g)}`) : [])]
          : (w.goals ?? []).map((g) => `${g.status === 'done' ? '✓' : w.hit === null ? '○' : '✗'} ${g.title}`);
        const cls = w.hit === true ? 'hit' : w.hit === false ? 'miss' : i === ws.length - 1 ? 'now' : 'none';
        return `<div class="row mis-wrow"><i class="mis-wq ${cls}">${w.hit === true ? I.check : ''}</i><span class="rbody"><span class="rtitle">${esc(w.label)}</span><span class="rmeta ell-2">${items.length ? items.map(esc).join(' · ') : 'No week goals'}</span></span></div>`;
      }).join('')}</div>` : '<p class="hint pad">Weeks show here once your PC answers.</p>';
    },
  });
}

const MOVE_TO = ['week', 'month', 'quarter', 'year', 'later', 'life'];
function moveSheet(id) {
  const g = findGoal(id); if (!g) return;
  const cur = hOf(g);
  openSheet({
    title: 'Move to another horizon', sub: esc(g.title),
    body(b, el) {
      asMission(b, el);
      b.innerHTML = `<div class="group">${MOVE_TO.map((h) => `<button class="row mis-mv" data-act="mis-move-to" data-id="${g.id}" data-h="${h}" aria-pressed="${h === cur}"><span class="rbody"><span class="rtitle">${esc(hz(h).name)}</span><span class="rmeta">${esc(hz(h).range)}${h === cur ? ' · where it is now' : ''}</span></span>${h === cur ? pickMark : ''}</button>`).join('')}</div>
        <p class="hint">Moving a goal out isn't missing it: the week streak stays honest either way.</p>`;
    },
  });
}
function parentSheet(id) {
  const g = findGoal(id); if (!g) return;
  const opts = active().filter((x) => x.id !== g.id && RANK[hOf(x)] > RANK[hOf(g)] && !threadOf(x).some((y) => y.id === g.id))
    .sort((a, b) => RANK[hOf(a)] - RANK[hOf(b)]);
  openSheet({
    title: 'What does it serve?', sub: esc(g.title),
    body(b, el) {
      asMission(b, el);
      b.innerHTML = `<div class="group">${opts.map((x) => `<button class="row mis-mv" data-act="mis-parent-to" data-id="${g.id}" data-p="${x.id}" aria-pressed="${x.id === g.parent}"><span class="rbody"><span class="rtitle wrap">${esc(x.title)}</span><span class="rmeta">${esc(hz(hOf(x)).name)}</span></span>${x.id === g.parent ? pickMark : ''}</button>`).join('')}
        <button class="row mis-mv" data-act="mis-parent-to" data-id="${g.id}" data-p="" aria-pressed="${!g.parent}"><span class="rbody"><span class="rtitle">Nothing above it</span></span>${!g.parent ? pickMark : ''}</button></div>
        ${opts.length ? '' : '<p class="hint">Only goals on a longer horizon can hold this one. Add one first.</p>'}`;
    },
  });
}

function checkinSheet(only) {
  const list = only ? [findGoal(only)].filter(Boolean) : active();
  if (!list.length) { toast('No open goals to check in on'); return; }
  const guess = (g) => M.checkinsOf(g.id)[0]?.state ?? (verdictOf(g) === 'On pace' || verdictOf(g) === 'No deadline' ? 'on' : pOf(g) - (tOf(g) ?? 0) < -0.35 || verdictOf(g) === 'Overdue' ? 'off' : 'risk');
  openSheet({
    title: only ? 'Check in' : 'Check in on every goal', sub: only ? esc(list[0].title) : 'A guess from each goal\'s pace. Change what\'s wrong.', large: !only,
    body(b, el) {
      asMission(b, el);
      b.innerHTML = `<div class="group mis-ck">${list.map((g) => `<div class="row mis-ckr" data-id="${g.id}"><span class="rbody"><span class="rtitle wrap">${esc(only ? measureOf(g) || 'How is it going?' : shortOf(g))}</span><span class="rmeta">${esc(hz(hOf(g)).name)} · ${pct(pOf(g))}%${tOf(g) != null ? ` with ${pct(tOf(g))}% gone` : ''}</span>${seg(`mis-ck-${g.id}`, [['on', 'On track'], ['risk', 'At risk'], ['off', 'Off track']], guess(g), 'sm mis-ckseg')}</span></div>`).join('')}</div>
        ${only ? `<label class="field mis-cknote"><input type="text" placeholder="A line on why (optional)" aria-label="A note for this check-in" /></label>` : ''}
        <div class="pad mis-ckgo"><button class="btn primary block" style="--c:var(--as-fill)" data-act="mis-ck-save">Save check-in</button></div>`;
    },
  });
}

function exerciseSheet(id) {
  const e = EX.find((x) => x.id === id); if (!e) return;
  openSheet({
    title: e.title, sub: esc(e.line),
    body(b, el) {
      asMission(b, el);
      b.innerHTML = `<div class="mis-ex">
        <p class="mis-ex-k">What ${esc(agentName())} will ask</p>
        <ol class="mis-ex-q">${e.qs.map((q) => `<li>${esc(q)}</li>`).join('')}</ol>
        ${DEMO && e.demoDone ? `<div class="mis-say">${avatar('sm')}<p>${esc(e.demoResult)}</p></div>` : ''}
        <p class="hint">About ten minutes, by voice or typing. She drafts; you keep what's true.</p>
        <div class="pad mis-ckgo"><button class="btn primary block" style="--c:var(--as-fill)" data-act="mis-ex-start" data-id="${e.id}">${exDone(e) ? 'Do it again' : 'Start'} with ${esc(agentName())}</button></div>
      </div>`;
    },
  });
}

function purposeSheet(prefill = null) {
  const cur = M.purpose().current;
  const alt = DEMO ? 'Build the software small shops run on, earn every rupee myself, and make Mom and Dad proud.' : prefill?.text ?? null;
  const vals = (cur?.values ?? []).map(([t, s]) => (s ? `${t} — ${s}` : t)).join('\n');
  openSheet({
    title: 'Your purpose', sub: cur ? `Change a word, or ask ${esc(agentName())} for a draft.` : 'One line, in your words. Every goal serves it.', large: true,
    body(b, el) {
      asMission(b, el);
      b.innerHTML = `<div class="mis-pedit">
        <label class="field mis-pfield"><textarea rows="4" aria-label="Your purpose" placeholder="e.g. Build software that runs shops like Dad's">${esc(prefill?.text ?? cur?.text ?? '')}</textarea></label>
        <div class="mis-alt">${alt ? `<div class="mis-say">${avatar('sm')}<p>${prefill?.why ? `${esc(prefill.why)} ` : 'Shorter, and it says the shop part plainly: '}<b>${esc(alt)}</b></p></div>` : ''}</div>
        <div class="mis-say-acts">${alt ? `<button class="btn sm" data-act="mis-p-alt">Use ${esc(agentName())}'s</button>` : ''}${REAL ? `<button class="btn sm" data-act="mis-p-redraft">${I.sparkle}${alt ? 'Another draft' : `Draft with ${esc(agentName())}`}</button>` : ''}<button class="btn sm" data-act="mis-ask" data-id="purpose" data-q="Help me rewrite my purpose">Talk it through</button></div>
        <p class="mis-ex-k">What you stand by <span class="hint">one per line, "value — what it means"</span></p>
        <label class="field mis-pfield"><textarea rows="3" class="mis-pvals" aria-label="What you stand by" placeholder="Ship, then polish — live and rough beats perfect and unseen">${esc(vals)}</textarea></label>
        <div class="pad mis-ckgo"><button class="btn primary block" style="--c:var(--as-fill)" data-act="mis-p-save">Save</button></div>
      </div>`;
      b._alt = alt;
    },
  });
}

function lifeSheet(fam = 'work') {
  openSheet({
    title: 'A lifetime direction', sub: 'Where a whole part of your life is heading. Goals on every horizon roll up into it.',
    body(b, el) {
      asMission(b, el);
      b.innerHTML = `<div class="mis-pedit">
        <label class="field mis-pfield"><textarea rows="2" aria-label="The direction" placeholder="${fam === 'health' ? 'e.g. Strong enough to keep at it' : fam === 'people' ? 'e.g. Keep my people close' : 'e.g. Ship tools real shops pay for'}"></textarea></label>
        <div class="chips mis-famchips">${Object.entries(FAMILIES).map(([k, v]) => `<button class="chip sm${k === fam ? ' on' : ''}" data-act="mis-life-fam" data-fam="${k}" aria-pressed="${k === fam}">${FAM_ICON[k]}${esc(v)}</button>`).join('')}</div>
        <div class="pad mis-ckgo"><button class="btn primary block" style="--c:var(--as-fill)" data-act="mis-life-save">Save</button></div>
      </div>`;
      b._fam = fam;
    },
  });
}

// ── add a goal: say it plainly; the agent makes it concrete ─────────
const KEYS = {
  money: /₹|rupee|lakh|revenue|earn|sales|orders|invoice|paid|pay|save|fund|price|income/, mission: /client|ship|launch|build|app|northwind|atlas|pulsechat|product|agentic|software|erp|corner market|business/,
  growth: /reel|follower|journal|content|learn|habit|review|audience|instagram/, body: /gym|bench|run|kg|protein|workout|weight|fit|train|sleep/, mind: /read|book|pages|course|study|exam|class|college/,
  soul: /clean|quit|meditat|pray|screen time/, family: /mom|dad|family|parents|anniversary|home|sister|brother/, friends: /friend|meet|hang/, romance: /date|dating|partner|love/,
};
function parseGoal(text) {
  const t = text.toLowerCase().trim();
  if (DEMO) { const sug = M.DEMO_SUGGEST.find((s) => s.text.toLowerCase() === t); if (sug) return { title: sug.text, ...sug }; }
  const horizon = /today|this week|by (sun|sat|fri|mon|tue|wed|thu)|sunday|saturday|week/.test(t) ? 'week'
    : /quarter|q[1-4]|end of (the )?year|by dec/.test(t) ? 'quarter'
      : /this month|month|30 days|january|february|march|april|may|june|july|august|september|october|november|december/.test(t) ? 'month'
        : new RegExp(`${hz('year').name}|this year|year`).test(t) ? 'year' : /20[3-9]\d|years|someday|one day/.test(t) ? 'later' : /life|lifetime|always/.test(t) ? 'life' : 'month';
  let aspects = Object.entries(KEYS).filter(([, re]) => re.test(t)).map(([k]) => k);
  if (!aspects.length) aspects = ['mission'];
  aspects = aspects.slice(0, 3);
  const parent = active().filter((g) => RANK[hOf(g)] > RANK[horizon] && g.aspects?.some((a) => aspects.includes(a))).sort((a, b) => RANK[hOf(a)] - RANK[hOf(b)])[0];
  const num = t.match(/(\d[\d,]*)/);
  const measure = num ? `${/order/.test(t) ? 'Orders' : /book/.test(t) ? 'Books' : /kg/.test(t) ? 'Kilograms' : /follower/.test(t) ? 'Followers' : /₹|lakh|rupee/.test(t) ? 'Rupees' : 'Count'} · 0 → ${num[1]}` : 'Done or not done';
  return {
    title: text.trim().replace(/^./, (c) => c.toUpperCase()), horizon, period: hz(horizon).name, aspects, parent: parent?.id ?? null, measure,
    steps: DEMO ? ['The first step, on Today tomorrow', 'Twenty minutes on it this week', 'A check-in on Sunday at 19:00'] : [],
    note: parent ? `It serves "${shortOf(parent)}", so it shows up there too.` : 'It stands on its own. Tell me if it serves something bigger.',
  };
}
function suggestions(prefill) {
  if (DEMO) return prefill.aspects?.length ? M.DEMO_SUGGEST.filter((s) => s.aspects.some((a) => prefill.aspects.includes(a))) : M.DEMO_SUGGEST;
  // real: start from the apps with no goal yet; the text is a prompt to finish, not a claim
  const has = (id) => active().some((g) => g.aspects?.includes(id));
  const pool = (prefill.aspects?.length ? ASPECTS.filter((a) => prefill.aspects.includes(a.id)) : ASPECTS.filter((a) => !has(a.id))).slice(0, 4);
  const start = { body: 'Train', mind: 'Read', soul: 'Every day,', mission: 'Ship', money: 'Earn', growth: 'Learn', family: 'With family:', romance: 'Romance:', friends: 'Meet' };
  return pool.map((a) => ({ text: `${start[a.id] ?? a.name} `, label: `A first ${a.name} goal`, why: has(a.id) ? `For ${a.name}` : `${a.name} has no goal`, aspects: [a.id], prompt: true }));
}
function addGoalSheet(prefill = {}) {
  const el = openSheet({
    title: 'New goal', sub: `Say it the way you'd say it. ${esc(agentName())} makes it concrete.`, large: true, cls: 'mis-addsheet',
    body(b, sh) {
      asMission(b, sh);
      const sugs = suggestions(prefill);
      b.innerHTML = `<div class="mis-add">
        <label class="field mis-addf"><textarea rows="2" placeholder="e.g. 50 Corner Market orders in November" aria-label="What do you want to achieve?">${esc(prefill.title ?? '')}</textarea>
          <button class="fbtn" data-act="mis-add-voice" aria-label="Say it instead">${I.mic}</button></label>
        ${sugs.length ? `<div class="mis-add-s">
          <p class="mis-add-h">${prefill.aspects?.length ? `For ${esc(prefill.aspects.map((a) => aspect(a)?.name).filter(Boolean).join(', '))}` : 'Or start from what has no goal yet'}</p>
          <div class="group">${sugs.map((s) => `<button class="row mis-sug" data-act="mis-add-sug" data-t="${esc(s.text)}" data-asp="${esc((s.aspects ?? []).join(','))}" data-prompt="${s.prompt ? 1 : ''}"><span class="rbody"><span class="rtitle">${esc(s.label ?? s.text)}</span><span class="rmeta">${esc(s.why)}</span></span>${I.arrowR}</button>`).join('')}</div>
        </div>` : ''}
        <div class="mis-draft" hidden></div>
        <div class="pad mis-ckgo"><button class="btn primary block" style="--c:var(--as-fill)" data-act="mis-add-make">${I.sparkle}Make it concrete</button></div>
      </div>`;
      b._pre = prefill;
    },
  });
  if (prefill.title) requestAnimationFrame(() => makeConcrete(el));
}
const HZ_PICK = ['week', 'month', 'quarter', 'year', 'later', 'life'];
const hName = (d) => (d.next ? hz(d.horizon).next ?? hz(d.horizon).name : d.period && d.horizon !== 'week' && d.period !== hz(d.horizon).name ? d.period : hz(d.horizon).name);
function draftHtml(d) {
  const share = (g) => (g.aspects ?? []).filter((a) => d.aspects.includes(a)).length;
  const parents = active().filter((g) => RANK[hOf(g)] > RANK[d.horizon] && (share(g) || g.id === d.parent))
    .sort((a, b) => (b.id === d.parent) - (a.id === d.parent) || share(b) - share(a) || RANK[hOf(a)] - RANK[hOf(b)]);
  const by = d.by === 'agent' ? `${esc(agentName())} made it concrete` : d.by === 'phone' ? `Drafted on the phone${d.why ? ` (${esc(d.why)})` : ''}` : `${esc(agentName())} made it concrete`;
  return `<div class="mis-dh">${avatar('sm', d.by === 'agent' ? 'done' : 'idle')}<span>${by}</span></div>
    <div class="group mis-dg">
      <label class="row mis-dr col"><span class="mis-dk">Goal</span><textarea class="mis-di" rows="${d.title.length > 34 ? 2 : 1}" aria-label="Goal">${esc(d.title)}</textarea></label>
      <label class="row mis-dr col"><span class="mis-dk">Measure</span><input class="mis-dm" type="text" value="${esc(d.measure ?? '')}" placeholder="What it counts" aria-label="Measure" /></label>
      <div class="row mis-dr col"><span class="mis-dk">Horizon</span><div class="chips">${HZ_PICK.map((h) => `<button class="chip sm${h === d.horizon ? ' on' : ''}" data-act="mis-d-h" data-h="${h}" aria-pressed="${h === d.horizon}">${esc(h === d.horizon ? hName(d) : hz(h).name)}</button>`).join('')}</div></div>
      <div class="row mis-dr col"><span class="mis-dk">Serves</span><div class="chips">${parents.slice(0, 3).map((g) => `<button class="chip sm${g.id === d.parent ? ' on' : ''}" data-act="mis-d-p" data-id="${g.id}" aria-pressed="${g.id === d.parent}">${esc(shortOf(g))}</button>`).join('')}<button class="chip sm${!d.parent ? ' on' : ''}" data-act="mis-d-p" data-id="" aria-pressed="${!d.parent}">Nothing above it</button></div></div>
      <div class="row mis-dr col"><span class="mis-dk">Apps it feeds</span><div class="chips">${ASPECTS.map((a) => `<button class="chip sm mis-achip${d.aspects.includes(a.id) ? ' on' : ''}" data-act="mis-d-a" data-id="${a.id}" aria-pressed="${d.aspects.includes(a.id)}"><i class="dot" style="--c:var(--${a.id})"></i>${esc(a.name)}</button>`).join('')}</div></div>
      ${d.steps?.length ? `<div class="row mis-dr col"><span class="mis-dk">Milestones</span><ol class="mis-steps">${d.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>` : ''}
    </div>
    ${d.note ? `<p class="mis-dn">${esc(d.note)}</p>` : ''}`;
}
async function makeConcrete(sheet) {
  const b = $('.sheet-body', sheet), ta = $('textarea', b), btn = $('[data-act="mis-add-make"], [data-act="mis-add-go"]', b);
  const text = ta.value.trim();
  if (!text) { ta.focus(); toast('Say what you want first'); return; }
  const pre = b._pre ?? {};
  const box = $('.mis-draft', b);
  const sug = $('.mis-add-s', b); if (sug) sug.hidden = true;
  box.hidden = false;
  box.innerHTML = `<div class="mis-think">${markHTML('wyn', { state: 'thinking', size: 22 })}<span>${esc(agentName())} is making it concrete</span></div>`;
  btn.disabled = true;
  const t0 = Date.now();
  let d;
  const canAsk = REAL && USER?.owner !== false && navigator.onLine !== false;
  if (canAsk) {
    try {
      const r = await M.draft(text, { horizon: pre.horizon, aspects: pre.aspects, parent: pre.parent });
      d = { title: r.title, measure: r.measure, horizon: HMAP[r.horizon] ?? 'month', aspects: r.aspects?.length ? r.aspects : ['mission'], parent: r.parent, area: r.area, due: r.due, steps: r.milestones ?? [], note: r.note, by: 'agent' };
    } catch (e) { d = { ...parseGoal(text), by: 'phone', why: e?.status === 403 ? 'drafting is on the owner\'s account' : 'the PC didn\'t answer' }; }
  } else d = { ...parseGoal(text), by: DEMO ? 'agent' : 'phone', why: REAL ? 'offline' : '' };
  if (pre.horizon) d.horizon = pre.horizon;
  if (pre.next) d.next = true;
  if (pre.aspects?.length) d.aspects = [...new Set([...pre.aspects, ...d.aspects])].slice(0, 3);
  if (pre.parent) d.parent = pre.parent;
  b._draft = d;
  const wait = Math.max(0, (reduced() ? 60 : 640) - (Date.now() - t0));
  setTimeout(() => {
    if (!box.isConnected) return;
    box.innerHTML = draftHtml(d); box.classList.remove('mis-in'); void box.offsetWidth; box.classList.add('mis-in');
    if (!reduced()) stagger($$('.mis-dr', box), { y: 8, each: 45 });
    btn.disabled = false; btn.dataset.act = 'mis-add-go'; btn.innerHTML = `Add to ${esc(hName(d))}`;
    haptic(8);
  }, wait);
}

// ── writes (real records; demo mode changes the in-memory copy) ───────
function periodFor(h, next = false) {
  const H = hz(h);
  if (h === 'life') return { period: 'life', start: null, end: null };
  if (next) { const p = shiftPeriod(h, 1); if (p) return { period: p.key, start: p.start, end: p.end }; }
  return { period: H.key, start: H.start, end: H.end };
}
function createGoal(d) {
  const per = periodFor(d.horizon, d.next);
  const g = coreAddGoal({ title: d.title, horizon: CORE_H[d.horizon] ?? d.horizon, aspects: d.aspects, parent: d.parent || null, measure: d.measure && d.measure !== 'Done or not done' ? d.measure : null, area: d.area ?? null, due: d.due ?? null, ...(REAL ? per : {}) });
  if (!g) return null;
  if (DEMO) Object.assign(g, { horizon: d.horizon, parent: d.parent, metric: d.measure, verdict: 'On pace', time: hz(d.horizon).time ?? 0 });
  (d.steps ?? []).forEach((s, i) => M.col('milestones').add({ goal: g.id, title: s, done: false, position: i, by: d.by === 'agent' ? 'agent' : 'me' }));
  return g;
}
function moveGoal(id, h) {
  const g = findGoal(id); if (!g) return null;
  const was = { horizon: g.realHorizon ?? g.horizon, period: g.period, start: g.start, end: g.end };
  const per = periodFor(h);
  updateGoal(id, DEMO ? { horizon: h } : { horizon: CORE_H[h], ...per });
  return () => updateGoal(id, DEMO ? { horizon: was.horizon } : was);
}
// a goal made offline has a temp id (n…) until the PC answers; Mission's docs follow it to the real id
SYNC.onChange?.((why, d) => {
  if (why !== 'rename' || d?.kind !== 'goal') return;
  for (const name of ['milestones', 'checkins']) for (const doc of M.col(name).list()) if (doc.goal === d.from) M.col(name).update(doc.id, { goal: d.to });
});

// ── refresh what's open after a change ────────────────────────────────
let rT = 0;
function refreshAll() {
  clearTimeout(rT);
  rT = setTimeout(() => {
    if (APP?.page?.isConnected) {
      const y = APP.scroll.scrollTop;
      ['home', 'graph', 'purpose'].forEach((sid) => {
        const el = APP.el(sid);
        if (!el?.dataset.built) return;
        if (el.contains(document.activeElement) && document.activeElement.matches('textarea, input')) return;
        APP.refresh(sid); wireCharts(el);
      });
      APP.scroll.scrollTop = y;
    }
    $$('#stack .page.mis-page').forEach((p) => {
      if (!p._mis) return;
      if (p.contains(document.activeElement) && document.activeElement.matches('textarea, input')) return;
      p._mis(); pulse(p);
    });
    // Today and Life redraw Mission's card and figures on this
    document.dispatchEvent(new CustomEvent('aspect-summary', { detail: { id: 'mission' } }));
  }, 40);
}
function openPurpose() {
  const top = $('#stack')?.lastElementChild;
  if (APP?.page?.isConnected && top === APP.page) { APP.go('purpose'); return; }
  api.openAspect('mission', 'purpose');
}

function goalPeek(id) {
  const g = findGoal(id); if (!g) return;
  S.peek = id;
  peek(`<div class="mis-peek" data-aspect="mission">${gRing(g, 64, 6.5)}<div class="mis-pk-b"><p class="mis-pk-k">${esc(kickerOf(g))}</p><p class="mis-pk-t">${esc(g.title)}</p><p class="mis-pk-s">${esc(g.state ? g.when : ext(g).say ?? measureOf(g))}</p></div></div>`,
    g.state ? [['Open', I.chevR, 'mis-pk-open']] : [['Move to another horizon', MI.move, 'mis-pk-move'], ['Check in', I.clock, 'mis-pk-check'], [`Ask ${agentName()}`, I.sparkle, 'mis-pk-ask']]);
}

// ── actions ───────────────────────────────────────────────────────────
const appOf = (el) => el.closest('.page')?._app;
on('mis-goal', (el) => goalPage(el.dataset.id));
on('mis-horizon', (el) => horizonPage(el.dataset.h));
on('mis-dir', (el) => dirPage(el.dataset.id));
on('mis-tab', (el) => { const app = appOf(el); if (app?.id === 'mission') { haptic(5); app.go(el.dataset.s); } else openPurpose(); });
on('mis-tools', () => api.openAgent('tools'));
on('mis-aspect', (el) => api.openAspect(el.dataset.id));
on('mis-task', (el) => api.openTask(el.dataset.id));
on('mis-project', (el) => api.openProject(el.dataset.id));
on('mis-content', () => api.openContent('stats'));
on('mis-cal', (el) => api.openCalendar('day', el.dataset.iso));
on('mis-review', () => api.openReview());
on('mis-brain', () => api.openBrain('mission'));
on('mis-closed', () => closedPage());
on('mis-weeks', () => weeksSheet());
on('mis-ask', (el) => {
  const g = findGoal(el.dataset.id);
  api.askAgent(el.dataset.q ?? (g ? `About my goal "${g.title}"` : ''), { aspect: 'mission', about: el.dataset.id });
});
// demo-only: the prototype's scripted asks (its sample ids belong to the demo data)
on('mis-mid', (el) => { el.disabled = true; el.innerHTML = `${I.check}On the 15th`; toast('Month goals now get a check-in on the 15th'); });
on('mis-alarm', () => api.alarm({ title: 'Save your 3-week streak', text: 'Harborline is still open and the week closes tonight. Send the quote and it\'s done.', aspect: 'mission', acts: [['Send the quote', 'mis-alarm-quote'], ['Tomorrow', 'mis-alarm-later']] }));
on('mis-alarm-quote', () => api.openTask('t3'));
on('mis-alarm-later', () => toast('Moved to tomorrow. The streak ends if it isn\'t done by Sunday.'));
on('mis-say', (el) => {
  if (!DEMO) return;
  const id = el.dataset.id;
  ({
    draft: () => api.askAgent('Draft the Basic / Advanced first-year quote for Harborline OS', { aspect: 'mission', about: 'g1' }),
    remind: () => { el.disabled = true; el.textContent = 'Reminder at 19:00'; toast(`${agentName()} reminds you at 19:00`); },
    job: () => api.newJob({ title: 'Atlas ERP wave 1: merge the 11 parallel agents into main', project: 'atlas', task: 't2', goal: 'g2' }),
    plan: () => { el.disabled = true; el.textContent = 'Planned at 21:00'; toast('On Today at 21:00'); },
    split: () => toast('Split: 7 reels a week stays in October, 5,000 moved to the quarter'),
    keep: () => { el.disabled = true; toast('Kept. I\'ll look again on Sunday.'); },
    thirty: () => { el.disabled = true; el.textContent = 'Runs to 12 Nov'; toast('30 clean days now runs 14 Oct – 12 Nov'); },
    kabir: () => api.openPerson('kabir'),
    money: () => api.openAspect('money'), body: () => api.openAspect('body'), mind: () => api.openAspect('mind'), soul: () => api.openAspect('soul'), family: () => api.openAspect('family'),
  }[id])?.();
});
on('mis-next-check', (el) => {
  const task = el.dataset.task, ms = el.dataset.ms;
  el.classList.add('done'); el.closest('.row')?.classList.add('is-done'); haptic(10);
  setTimeout(() => {
    if (task) { completeTask(task, true); toast('Next step done', () => completeTask(task, false)); }
    else if (ms) { M.col('milestones').update(ms, { done: true, done_at: clock.now().toISOString() }); toast('Milestone done', () => M.col('milestones').update(ms, { done: false, done_at: null })); }
  }, reduced() ? 0 : 360);
});
on('mis-next-add', (el) => {
  const g = findGoal(el.dataset.id); if (!g) return;
  const x = ext(g);
  api.addTask({ title: x.next?.text ?? `Next step: ${shortOf(g)}`, when: 'Today', aspect: g.aspects?.[0], goal: g.id });
});
on('mis-ms', (el) => {
  const m = M.col('milestones').get(el.dataset.ms); if (!m) return;
  const now = !m.done;
  el.classList.toggle('done', now); el.closest('.row')?.classList.toggle('is-done', now);
  if (now) { el.classList.add('closing'); setTimeout(() => el.classList.remove('closing'), 520); }
  haptic(now ? 12 : 6);
  setTimeout(() => M.col('milestones').update(m.id, { done: now, done_at: now ? clock.now().toISOString() : null }), reduced() ? 0 : 380);
});
on('mis-ms-del', (el) => {
  const id = el.dataset.ms; const m = M.col('milestones').get(id); if (!m) return;
  M.col('milestones').remove(id); haptic(8);
  toast('Milestone removed', () => M.col('milestones').put({ ...m, deleted_at: null, updated_at: clock.now().toISOString() }));
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest?.('.mis-msadd'); if (!f) return;
  e.preventDefault();
  const inp = $('input', f), title = inp.value.trim(); if (!title) return;
  const goal = f.dataset.goal, n = M.milestonesOf(goal).length;
  M.col('milestones').add({ goal, title, done: false, position: n, by: 'me' });
  inp.value = ''; haptic(8);
  requestAnimationFrame(() => { const t = $(`.mis-page[data-goal="${goal}"] .mis-msadd input`); t?.focus(); const rows = $$(`.mis-page[data-goal="${goal}"] .mis-msr`); if (rows.length && !reduced()) stagger([rows.at(-1)], { y: 6 }); });
});
on('mis-move', (el) => moveSheet(el.dataset.id));
on('mis-move-to', (el) => {
  const id = el.dataset.id, h = el.dataset.h, g = findGoal(id);
  closeSheet();
  if (!g || (hOf(g) === h && !overdue(g))) return;
  const undo = moveGoal(id, h); haptic(10);
  toast(`Moved to ${hz(h).name}`, undo);
});
on('mis-roll', (el) => {
  const g = findGoal(el.dataset.id); if (!g) return;
  const h = hOf(g), undo = moveGoal(g.id, h); haptic(10);
  toast(`Rolled into ${hz(h).name.toLowerCase() === 'this week' ? 'this week' : hz(h).name}`, undo);
});
on('mis-parent', (el) => parentSheet(el.dataset.id));
on('mis-parent-to', (el) => {
  const id = el.dataset.id, p = el.dataset.p || null, g = findGoal(id); closeSheet();
  if (!g || g.parent === p) return;
  const was = g.parent ?? null;
  updateGoal(id, { parent: p }); haptic(10);
  toast(p ? `Now serves ${shortOf(findGoal(p))}` : 'Serves nothing above it', () => updateGoal(id, { parent: was }));
});
on('mis-done', (el) => {
  const id = el.dataset.id, g = findGoal(id); if (!g) return;
  if (isDoneG(g)) { updateGoal(id, { status: 'active' }); toast('Reopened'); return; }
  const r = el.closest('.scroll')?.querySelector('.mis-ghero .rg');
  haptic(16);
  if (r) setRing(r, 1);
  setTimeout(() => {
    updateGoal(id, { status: 'done' });
    const n = GOALS.filter(isDoneG).length;
    toast(`Goal closed. ${n} done${DEMO ? ' since July' : ''}.`, () => updateGoal(id, { status: 'active' }));
    M.loadGraph();
  }, reduced() ? 0 : 700);
});
on('mis-drop', (el) => {
  const id = el.dataset.id, g = findGoal(id); if (!g) return;
  const page = el.closest('.page');
  updateGoal(id, { status: 'dropped' }); haptic(10);
  if (page) $('[data-act="pop"]', page)?.click();
  toast('Goal dropped', () => updateGoal(id, { status: 'active' }));
  setTimeout(() => M.loadGraph(), 1500);
});
on('mis-again', (el) => { const c = findGoal(el.dataset.id); addGoalSheet({ title: c.title, aspects: c.aspects, horizon: c.horizon === 'dropped' ? undefined : c.horizon }); });
on('mis-checkin', () => checkinSheet());
on('mis-checkone', (el) => checkinSheet(el.dataset.id));
on('mis-ck-save', (el) => {
  const sh = el.closest('.sheet');
  const note = $('.mis-cknote input', sh)?.value.trim() || null;
  const at = clock.now().toISOString();
  let n = 0;
  $$('.mis-ckr', sh).forEach((r) => {
    const v = $('.seg button[aria-selected="true"]', r)?.dataset.v; const g = findGoal(r.dataset.id);
    if (v && g) { M.col('checkins').add({ goal: g.id, state: v, note, by: 'me', at, progress: pOf(g) }); n++; }
  });
  closeSheet(sh); S.checkedIn = true; haptic(12);
  toast(n > 1 ? `Checked in on ${n} goals. Next ${nextSunday()}` : 'Checked in');
});
on('mis-ex', (el) => exerciseSheet(el.dataset.id));
on('mis-ex-start', (el) => { const e = EX.find((x) => x.id === el.dataset.id); closeSheet(); api.askAgent(`Let's do "${e.title}": ${e.qs[0]}`, { aspect: 'mission', about: 'purpose' }); });
on('mis-purpose', () => purposeSheet());
on('mis-p-alt', (el) => { const b = el.closest('.sheet-body'); if (b._alt) $('textarea', b).value = b._alt; haptic(6); });
async function askPurpose(el, into) {
  if (!REAL) return;
  if (navigator.onLine === false) { toast('Drafting needs your PC'); return; }
  const was = el.innerHTML; el.disabled = true; el.innerHTML = `${markHTML('wyn', { state: 'thinking', size: 16 })}Drafting`;
  try {
    const r = await M.draftPurpose();
    if (into) { const b = into; b._alt = r.text; $('.mis-alt', b).innerHTML = `<div class="mis-say mis-in">${avatar('sm', 'done')}<p>${esc(r.why)} <b>${esc(r.text)}</b></p></div>`; const acts = $('.mis-say-acts', b); if (acts && !$('[data-act="mis-p-alt"]', acts)) acts.insertAdjacentHTML('afterbegin', `<button class="btn sm" data-act="mis-p-alt">Use ${esc(agentName())}'s</button>`); }
    else purposeSheet(r);
    haptic(8);
  } catch (e) { toast(e?.message ?? 'Couldn\'t draft it now'); }
  el.disabled = false; el.innerHTML = was;
}
on('mis-p-draft', (el) => askPurpose(el, null));
on('mis-p-redraft', (el) => askPurpose(el, el.closest('.sheet-body')));
on('mis-p-save', (el) => {
  const sh = el.closest('.sheet'); const v = $('textarea', sh).value.trim(); if (!v) { toast('Your purpose can\'t be empty'); return; }
  const values = $('.mis-pvals', sh).value.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 7).map((l) => { const [t, ...s] = l.split(/\s+[—–-]\s+/); return [t.trim(), s.join(' — ').trim()]; });
  const cur = M.purpose().current, b = $('.sheet-body', sh);
  const byAgent = b._alt && v === b._alt;
  closeSheet(sh);
  if (cur && cur.text === v) { M.col('purpose').update(cur.id, { values }); toast('Saved'); return; }
  const doc = M.col('purpose').add({ text: v, values, by: byAgent ? 'agent' : 'me', why: byAgent ? `Drafted with ${agentName()}` : null });
  haptic(10);
  toast(cur ? 'Purpose revised. The old one is kept below.' : 'Purpose saved', () => M.col('purpose').remove(doc.id));
});
on('mis-life-add', (el) => lifeSheet(el.dataset.fam || 'work'));
on('mis-life-fam', (el) => { const b = el.closest('.sheet-body'); b._fam = el.dataset.fam; $$('[data-act="mis-life-fam"]', b).forEach((c) => { c.classList.toggle('on', c === el); c.setAttribute('aria-pressed', String(c === el)); }); haptic(5); });
on('mis-life-save', (el) => {
  const sh = el.closest('.sheet'), b = $('.sheet-body', sh), t = $('textarea', b).value.trim();
  if (!t) { toast('Say where it\'s heading'); return; }
  const fam = b._fam ?? 'work';
  M.col('life').add({ title: t, fam, position: M.directions().length, aspects: ASPECTS.filter((a) => a.fam === fam).map((a) => a.id) });
  closeSheet(sh); haptic(10); toast(`${FAMILIES[fam]} direction saved`);
});
on('mis-life-del', (el) => {
  const d = M.col('life').get(el.dataset.id); if (!d) return;
  M.col('life').remove(d.id); $('[data-act="pop"]', el.closest('.page'))?.click();
  toast('Direction removed', () => M.col('life').put({ ...d, deleted_at: null, updated_at: clock.now().toISOString() }));
});
on('mis-add', (el) => addGoalSheet({ horizon: el.dataset.h, next: el.dataset.next === '1', aspects: el.dataset.asp ? [el.dataset.asp] : undefined }));
on('mis-add-sug', (el) => {
  const sh = el.closest('.sheet'), b = $('.sheet-body', sh), ta = $('textarea', sh);
  const asp = el.dataset.asp ? el.dataset.asp.split(',') : null;
  if (asp) b._pre = { ...(b._pre ?? {}), aspects: [...new Set([...(b._pre?.aspects ?? []), ...asp])] };
  ta.value = el.dataset.t; haptic(5);
  if (el.dataset.prompt) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); return; }
  makeConcrete(sh);
});
on('mis-add-voice', (el) => { const ta = $('textarea', el.closest('.sheet')); ta.focus(); toast('Tap the mic on your keyboard and say it'); });
on('mis-add-make', (el) => makeConcrete(el.closest('.sheet')));
function redraft(el, fn) {
  const b = el.closest('.sheet-body'); const d = b._draft; if (!d) return;
  d.title = $('.mis-di', b)?.value ?? d.title;
  d.measure = $('.mis-dm', b)?.value ?? d.measure;
  fn(d); $('.mis-draft', b).innerHTML = draftHtml(d);
  const btn = $('[data-act="mis-add-go"]', b); if (btn) btn.textContent = `Add to ${hName(d)}`;
  haptic(5);
}
on('mis-d-h', (el) => redraft(el, (d) => { d.horizon = el.dataset.h; d.next = false; d.period = hz(d.horizon).name; const par = d.parent && findGoal(d.parent); if (par && RANK[hOf(par)] <= RANK[d.horizon]) d.parent = null; }));
on('mis-d-p', (el) => redraft(el, (d) => { d.parent = el.dataset.id || null; }));
on('mis-d-a', (el) => redraft(el, (d) => { const a = el.dataset.id; d.aspects = d.aspects.includes(a) ? d.aspects.filter((x) => x !== a) : [...d.aspects, a]; if (!d.aspects.length) d.aspects = [a]; }));
on('mis-add-go', (el) => {
  const sh = el.closest('.sheet'), b = $('.sheet-body', sh), d = b._draft; if (!d) return;
  d.title = $('.mis-di', b)?.value.trim() || d.title;
  d.measure = $('.mis-dm', b)?.value.trim() ?? d.measure;
  let g;
  try { g = createGoal(d); } catch (e) { toast(e?.message ?? 'Couldn\'t add it'); return; }
  if (!g) return;
  closeSheet(sh); haptic(14);
  const id = g.id;
  toast(`Added to ${hName(d)}`, () => updateGoal(id, { status: 'dropped' }));
  if (APP?.page?.isConnected) {
    if (APP.section !== 'home') APP.go('home');
    setTimeout(() => { const row = $(`.mis-grow[data-id="${findGoal(id)?.id ?? id}"]`, APP.el('home')); if (row) { row.scrollIntoView({ block: 'center', behavior: reduced() ? 'auto' : 'smooth' }); row.classList.add('mis-new'); setTimeout(() => row.classList.remove('mis-new'), 1600); } }, 120);
  }
});
on('mis-pk-move', () => { closePeek(); moveSheet(S.peek); });
on('mis-pk-check', () => { closePeek(); checkinSheet(S.peek); });
on('mis-pk-ask', () => { closePeek(); const g = findGoal(S.peek); api.askAgent(`About my goal "${g?.title}"`, { aspect: 'mission', about: S.peek }); });
on('mis-pk-open', () => { closePeek(); goalPage(S.peek); });
on('mis-open-task', (el) => api.openTask(el.dataset.id));
on('mis-quick-open', () => api.openAspect('mission'));
on('mis-quick-checkin', () => checkinSheet());
// notes save as you type (goal notes are core: goals.notes; horizon notes are Mission's, one per period)
const noteT = {};
document.addEventListener('input', (e) => {
  const ta = e.target.closest?.('textarea[data-note], textarea[data-hnote]'); if (!ta) return;
  const k = ta.dataset.note ? `g:${ta.dataset.note}` : `h:${ta.dataset.hnote}`;
  clearTimeout(noteT[k]);
  noteT[k] = setTimeout(() => { if (ta.dataset.note) updateGoal(ta.dataset.note, { notes: ta.value || null }); else M.setNote(ta.dataset.hnote, ta.value); }, 700);
});

// ── scan: a photo of a written list of goals ──────────────────────────
function scanSheet(lines) {
  S.scan = lines.map((t) => ({ text: t, on: true, d: parseGoal(t) }));
  openSheet({
    title: 'Goals from your page', sub: `${plural(lines.length, 'line')} found. Each becomes a goal on the horizon it reads as; change any after.`, large: true,
    body(b, el) {
      asMission(b, el);
      b.innerHTML = `<div class="group mis-scan">${S.scan.map((s, i) => `<label class="row mis-scanr"><input type="checkbox" checked data-i="${i}" aria-label="Add ${esc(s.text)}" /><span class="rbody"><span class="rtitle wrap">${esc(s.d.title)}</span><span class="rmeta">${esc(hz(s.d.horizon).name)} · ${esc(s.d.aspects.map((a) => aspect(a)?.name).filter(Boolean).join(', '))}</span></span></label>`).join('')}</div>
        <div class="pad mis-ckgo"><button class="btn primary block" style="--c:var(--as-fill)" data-act="mis-scan-go">Add these goals</button></div>`;
    },
  });
}
on('mis-scan-go', (el) => {
  const sh = el.closest('.sheet');
  const pick = $$('.mis-scanr input', sh).filter((x) => x.checked).map((x) => S.scan[Number(x.dataset.i)]);
  pick.forEach((s) => createGoal({ ...s.d, steps: [] }));
  closeSheet(sh); haptic(14); toast(`${plural(pick.length, 'goal')} added`);
});

// ── the app ───────────────────────────────────────────────────────────
registerAspect({
  id: 'mission',
  sections: [
    { id: 'home', label: 'Horizons', icon: MI.stripes, render: renderHorizons },
    { id: 'graph', label: 'Graph', icon: MI.graph, render: renderGraph },
    { id: 'purpose', label: 'Purpose', icon: I.compass, render: renderPurpose },
  ],
  primary: { label: 'Add a goal', icon: I.plus, run: () => addGoalSheet() },
  summary() {
    const act = active(), on = act.filter((g) => verdictOf(g) === 'On pace').length;
    const wk = act.filter((g) => hOf(g) === 'week').sort((a, b) => (pOf(a) - (tOf(a) ?? 0)) - (pOf(b) - (tOf(b) ?? 0)));
    const worst = wk.find((g) => behind(verdictOf(g))) ?? act.find((g) => behind(verdictOf(g)));
    const st = streakLine();
    const goalIds = new Set(act.map((g) => g.id));
    const today = DEMO
      ? [{ id: 't3', text: 'Send Harborline the first-year quote', done: false, act: 'mis-open-task', goal: 'g1' }, { id: 't2', text: 'Atlas ERP: merge wave 1 into main', done: false, act: 'mis-open-task', goal: 'g2' }]
      : TASKS.filter((t) => goalIds.has(t.goal) && ['doing', 'overdue', 'today'].includes(t.list)).slice(0, 3).map((t) => ({ id: t.id, text: t.title, done: false, act: 'mis-open-task', goal: t.goal }));
    if (!act.length) return { line: 'No goals yet. Set one for this week.', metric: { v: 0, unit: 'goals', label: 'on pace', p: 0 }, today: [], quick: [{ label: 'Add a goal', icon: I.plus, act: 'mis-quick-open' }] };
    return {
      line: `${on} of ${act.length} goals on pace.${worst ? ` ${shortOf(worst)} is ${verdictOf(worst) === 'Overdue' ? 'past due' : 'behind'}${hOf(worst) === 'week' ? ` with ${hz('week').left.toLowerCase()}` : ''}.` : ' Nothing is behind.'}`,
      metric: { v: on, unit: `of ${act.length}`, label: 'goals on pace', p: act.length ? on / act.length : 0 },
      today,
      streak: { n: st.n, label: 'weeks closing your week goals', atRisk: !!worst && hOf(worst) === 'week' },
      next: { at: 'Sun 19:00', text: 'Check in on your goals' },
      quick: [{ label: 'Goals', icon: MI.stripes, act: 'mis-quick-open' }, { label: 'Check in', icon: I.clock, act: 'mis-quick-checkin' }],
    };
  },
  widget() {
    const wk = goalsIn('week');
    return `<button class="mis-w surface" data-act="mis-quick-open" data-aspect="mission" aria-label="Mission: this week's goals">
      <span class="mis-w-h"><span class="mis-w-k">${I.compass}Mission</span><span class="mis-w-l">This week · ${esc(hz('week').left.toLowerCase())}</span></span>
      ${wk.length ? wk.slice(0, 3).map((g) => `<span class="mis-w-r">${ring(pOf(g), 'as', 30, 3.6, { k: tk(g) })}<span class="mis-w-t">${esc(shortOf(g))}</span><span class="mis-v ${vClass(verdictOf(g))}">${vWord(verdictOf(g))}</span></span>`).join('') : '<span class="mis-w-r"><span class="mis-w-t">No week goals yet</span></span>'}
    </button>`;
  },
  scan: [{
    kind: 'goals', label: 'A list of goals', hint: 'A notebook page or a whiteboard: each line becomes a goal on a horizon',
    handle(result) {
      const raw = result?.fields?.lines ?? String(result?.fields?.text ?? result?.title ?? '').split(/\n+/);
      const lines = raw.map((l) => String(l).replace(/^\s*([-*•·]|\d+[.)]|\[ ?\]|☐)\s*/, '').trim()).filter((l) => l.length > 2).slice(0, 20);
      if (!lines.length) { toast('No goals found on that page'); return; }
      if (lines.length === 1) addGoalSheet({ title: lines[0] }); else scanSheet(lines);
    },
  }],
  tools: TOOLS,
  onOpen(app) { APP = app; M.loadGraph(); drawStripes(app.el(app.section), 260); wireCharts(app.el(app.section)); enter(app.el(app.section)); },
  onSection(app, id) { APP = app; if (id === 'home') { drawStripes(app.el(id), 60); enter(app.el(id), 40); } if (id === 'graph') M.loadGraph(); wireCharts(app.el(id)); },
});

provide('openGoal', (id) => goalPage(id));
provide('addGoal', (prefill = {}) => addGoalSheet({ ...prefill, horizon: prefill.horizon ? HMAP[prefill.horizon] ?? prefill.horizon : undefined, aspects: prefill.aspects ?? (prefill.aspect ? [prefill.aspect] : undefined) }));
provide('openHorizon', (h) => horizonPage(HMAP[h] ?? (HZ.some((x) => x.id === h) ? h : 'week')));
provide('openPurpose', () => openPurpose());
// agenticos://mission/add?title=…&horizon=week (widgets, Siri, notifications)
registerRoute('mission/add', (L, ctx) => { ctx.tab('life'); ctx.after(() => addGoalSheet({ title: L.query.get('title') ?? '', horizon: HMAP[L.query.get('horizon')] ?? undefined })); });

// redraw when goals, tasks or Mission's own data change; the graph loads once the engine has booted
M.start();
let graphAsked = false;
onData(() => { if (!graphAsked) { graphAsked = true; M.loadGraph(); } refreshAll(); });
M.onModel(() => refreshAll());

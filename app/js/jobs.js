// Work: where the actual work happens. Projects at the centre with what needs you first, the Jobs board on its own
// (jobs are part of work, shown as jobs), and Ideas. Claude and Codex run on the PC; the phone approves and steers.
// The screens live in work-*.js: a job's thread (work-live on the real engine, work-thread for demo), review
// (work-changes / work-review), projects (work-project), new work (work-new), terminals and Builders (work-term),
// shared cards (work-cards), the base (work-ui) and the engine (work-engine). ?data=demo keeps the prototype's story.
import { $, $$, esc, registerTab, setTab, currentTab, openSheet, closeSheet, toast, on, onHold, peek, closePeek, swipeRows, seg, topbar, haptic, wireSegs, pulse, setRing } from './core.js';
import { I } from './icons.js';
import { JOBS, LANES, BUILDERS, PROJECTS, TASKS, onData } from './data.js';
import { CLIENTS } from './clients-data.js';
import { THREADS, NIGHT, SHIP_STREAK, CHANGES } from './work-data.js';
import { provide, api, has } from './bus.js';
import { W, WI, job, lane, agentName, project, projectsOrdered, startClock, changed, plural, capFirst, sinceOf, REAL, ideasNow, markFor, syncMarks } from './work-ui.js';
import { openJob as openDemoJob, allow } from './work-thread.js';
import { openChanges as openDemoChanges, filesOf } from './work-review.js';
import { newJob, nightSheet, nightPicks, newMenu, USAGE, nightCardReal } from './work-new.js';
import { openTerminal, openBuilder, termSessions } from './work-term.js';
import { openProject } from './work-project.js';
import { needsCard, jobCard, compactRow, projectCard, isLanding, usageRow, ideaRow, wireIdeaField } from './work-cards.js';
import * as E from './work-engine.js';
import { openLive } from './work-live.js';
import { openLiveChanges, openCopy, openCompare } from './work-changes.js';
import { registerRoute } from './svc/route.js';
import * as API from './svc/api.js';
import { ago as clockAgo } from './svc/clock.js';
const { onConnection } = API;

const VIEWS = ['projects', 'jobs', 'ideas'];
/** A job's page: the live thread on the real engine, the prototype's story in demo. */
export function openJob(id) { if (!id) return; if (REAL) openLive(id); else openDemoJob(id); }
const openChanges = (id, turn = 0) => (REAL ? openLiveChanges(id, turn) : openDemoChanges(job(id), { turn }));

registerTab('jobs', {
  title: 'Work',
  render(page) {
    page.innerHTML = topbar({
      title: 'Work',
      left: `<button class="gbtn chrome icon" data-act="w-find" aria-label="Jump to a project, job, task or file">${I.search}</button>`,
      right: `<button class="gbtn chrome icon" data-act="w-ask" aria-label="Ask ${REAL ? 'your agent' : 'Wyn'} about your work">${I.sparkle}</button>
              <button class="gbtn accent" data-act="w-new" style="--c:var(--jobs-fill)">${I.plus}New</button>`,
    }) + '<div class="scroll" id="workScroll"></div>';
    const deep = readHash();
    renderWork({ first: true });
    const sc = $('#workScroll');
    swipeRows(sc, '.jcard.working, .jcard.review, .jcard.landing, .jsmall', { right: (r) => moveJob(r.dataset.id, 1), left: (r) => moveJob(r.dataset.id, -1) });
    onHold(sc, '.jcard, .jsmall, .wk-mj, .wk-ask-h', (el) => jobPeek(el.dataset.id ?? el.closest('[data-job]')?.dataset.job));
    startClock(); startLive();
    if (deep) requestAnimationFrame(() => requestAnimationFrame(deep));
  },
  onShow() { renderWork(); E.loadCode(); E.loadBuilders(); },
});

// #work/jobs · #work/ideas · #work/job/j12 · #work/project/atlas · #work/changes/j14 · #work/terminal · #work/clients · #work/night · #work/new
function readHash() {
  const [head, sub, arg] = decodeURIComponent(location.hash.replace(/^#/, '')).split('/');
  if (head !== 'work' || !sub) return null;
  if (VIEWS.includes(sub)) { W.view = sub; return null; }
  return () => {
    if (sub === 'job' && (REAL || job(arg))) openJob(arg);
    else if (sub === 'project' && project(arg)) openProject(arg, 'Work');
    else if (sub === 'changes' && (REAL || job(arg))) openChanges(arg);
    else if (sub === 'terminal') openTerminal(arg && project(arg) ? arg : REAL ? null : 'agentic-os');
    else if (sub === 'clients') api.openClients();
    else if (sub === 'night') nightSheet();
    else if (sub === 'new') newJob(arg ? { task: arg } : {});
  };
}

function renderWork({ first = false } = {}) {
  const sc = $('#workScroll'); if (!sc) return;
  const y = sc.scrollTop;
  const n = lane('needs').length, w = lane('working').length, r = lane('review').filter((j) => !isLanding(j)).length;
  const part = (id, k, label, cls = '') => (k ? `<button data-act="w-lane" data-id="${id}"${cls ? ` class="${cls}"` : ''}><b class="met">${k}</b>${label}</button>` : '');
  const parts = part('needs', n, n === 1 ? 'needs you' : 'need you', 'amber') + part('working', w, 'running') + part('review', r, 'to review');
  const active = JOBS.filter((j) => ['needs', 'working', 'review'].includes(j.lane)).length;
  const pc = pcLine();
  sc.innerHTML = `
    <div class="phead wk-head">
      <div class="wk-title"><h1 class="lt">Work</h1><span class="wk-pc${pc.ok ? '' : ' off'}" role="status"><span class="live" style="--c:${pc.ok ? 'var(--done)' : 'var(--needs)'}"></span>${esc(pc.text)}</span></div>
      <p class="sub jobs-sum wk-sum">${parts || '<span class="jsum-q">All quiet</span>'}</p>
    </div>
    <div class="pad jseg">${seg('wview', [['projects', 'Projects'], ['jobs', 'Jobs', active || null], ['ideas', 'Ideas', ideasNow().filter((i) => (i.status ?? 'open') === 'open').length || null]], W.view, 'dom')}</div>
    <div id="wpanel" class="jpanel"></div>`;
  wireSegs(sc);
  $('[data-seg="wview"]', sc).addEventListener('change', (e) => { W.view = e.detail; renderPanel(true); });
  renderPanel(first);
  sc.scrollTop = y;
  syncBadge(n);
}
// only say the PC is online when the last call reached it
function pcLine() {
  if (!REAL) return { ok: true, text: 'PC online' };
  if (navigator.onLine === false) return { ok: false, text: 'Offline' };
  const c = window.AOS?.syncStatus?.() ?? 'ok';
  if (c === 'offline') return { ok: false, text: 'PC away' };
  if (c === 'error') return { ok: false, text: 'PC error' };
  return { ok: true, text: E.code.down ? 'PC online · no terminals' : 'PC online' };
}
// the pill follows the connection as it moves, without redrawing Work
function syncPc() {
  const el = $('#workScroll .wk-pc'); if (!el) return;
  const pc = pcLine();
  el.classList.toggle('off', !pc.ok);
  el.innerHTML = `<span class="live" style="--c:${pc.ok ? 'var(--done)' : 'var(--needs)'}"></span>${esc(pc.text)}`;
}
if (REAL) { onConnection(syncPc); addEventListener('online', syncPc); addEventListener('offline', syncPc); }
function renderPanel(anim) {
  const p = $('#wpanel'); if (!p) return;
  p.innerHTML = W.view === 'jobs' ? boardPanel() : W.view === 'ideas' ? ideasPanel() : projectsPanel();
  if (W.view === 'ideas') wireIdeaField(p, null);
  if (anim) { p.classList.remove('swap'); void p.offsetWidth; p.classList.add('swap'); pulse(p); enter(p); }
}
// the lists come in a little after each other, the way a stack of cards lands
let motionP = null;
const motion = () => (motionP ??= import('./motion.js').catch(() => null));
async function enter(root) {
  const M = await motion();
  if (!M?.stagger) return;
  const items = $$(':scope > .wk-plist > .wk-pcard, :scope > .jneeds > *, :scope > .jgroup > .row, :scope > .group > .row, :scope > .jideas-g > .row', root).slice(0, 14);
  try { M.stagger(items, { y: 10, each: 32, max: 360 }); } catch {}
}
// the tab's badge counts what waits on you, so it falls as you answer
function syncBadge(n) {
  const b = $('#tabJobs .tbadge');
  if (!b) { if (n) $('#tabJobs')?.insertAdjacentHTML('beforeend', `<i class="tbadge" aria-label="${n} need you">${n}</i>`); return; }
  b.textContent = n; b.hidden = !n; b.setAttribute('aria-label', `${n} need you`);
}
// the PC's jobs moved (Work polls while one runs; a job page streams): redraw what the tab shows, gently
let redrawT = 0;
const softRedraw = () => { clearTimeout(redrawT); redrawT = setTimeout(() => { if (currentTab() === 'jobs' && !$('#stack > .page') && !document.querySelector('.row.swiping')) renderWork(); }, 120); };
document.addEventListener('data-changed', (e) => { if (['jobs', 'server', 'boot', 'synced', 'local', 'rename'].includes(e.detail?.why)) softRedraw(); });
document.addEventListener('work:code', softRedraw);
document.addEventListener('work:repo', softRedraw);
document.addEventListener('store-changed', (e) => { if (e.detail?.name === 'work/night') softRedraw(); });
document.addEventListener('work:change', (e) => {
  if (e.detail?.focus === 'idea') { renderWork(); setTimeout(() => $('#wpanel .jidea-in')?.focus(), 360); return; }
  if (currentTab() === 'jobs' && !$('#stack > .page')) renderWork();
});

// ── Projects: what needs you, then each project, then the clients and the night ──
function projectsPanel() {
  const needs = lane('needs');
  const working = lane('working').length;
  // the repo line of the first few projects (one cached read each on the PC; the rest load when opened)
  if (REAL) for (const p of projectsOrdered().slice(0, 6)) if (p.folder) E.loadRepo(p.slug);
  const empty = REAL && !PROJECTS.length;
  return `
    ${needs.length ? `<div class="sh lane-h" id="wk-needs"><h2>Needs you</h2><span class="sh-count">${needs.length}</span></div>
      <div class="jneeds">${needs.map((j) => needsCard(j)).join('')}</div>`
    : `<div class="group wk-clear"><div class="row ic"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle">Nothing needs you</span><span class="rmeta">${working ? `${plural(working, 'job')} running. You hear the moment one asks.` : JOBS.length ? 'Every job is done or waiting for review.' : 'No jobs yet. New starts one on your PC.'}</span></span></div></div>`}
    <div class="sh"><h2>Projects</h2>${projectsOrdered().length ? `<span class="sh-count">${projectsOrdered().length}</span>` : ''}<button class="sh-act" data-act="w-new-proj">${I.plus}New</button></div>
    ${empty ? `<div class="group"><button class="row ic jempty" data-act="w-new-proj"><span class="tile">${I.folderPlus}</span><span class="rbody"><span class="rtitle">No projects yet</span><span class="rmeta">A project is a folder on your PC, with its area. Jobs run there.</span></span>${I.chevR}</button></div>` : `<div class="wk-plist">${projectsOrdered().map(projectCard).join('')}</div>`}
    ${clientsBlock()}
    ${REAL ? nightCardReal() : nightCard()}`;
}
// the clients' money and the next thing owed, read from the client files
function clientsBlock() {
  return `<div class="sh"><h2>Clients</h2></div>${REAL ? clientsButton() : clientsCard()}`;
}
// real: Clients' own summary (clients.js), so the card and the Clients page never disagree
function clientsButton() {
  const s = has('clientsSummary') ? api.clientsSummary() : null;
  if (!s?.ready) return `<button class="wk-clients surface" data-act="w-clients"><span class="tile">${I.clients}</span><span class="rbody"><span class="wk-cl-top"><b>Clients</b></span><span class="wk-cl-next"><span class="ell">${s ? 'Reading the client files on your PC' : 'Their money, and what they wait on'}</span></span></span>${I.chevR}</button>`;
  const due = Number(s.due ?? 0);
  const top = due > 0 ? `<b class="met">${s.approx ? '≈ ' : ''}₹${due.toLocaleString('en-IN')}</b><span>to collect${s.owe ? ` · ${s.owe} owe you` : ''}</span>` : `<b>Nothing to collect</b>${s.unpriced ? `<span>${s.unpriced} not priced yet</span>` : ''}`;
  return `<button class="wk-clients surface" data-act="w-clients">
    <span class="tile">${I.clients}</span>
    <span class="rbody"><span class="wk-cl-top">${top}</span>
      ${s.next ? `<span class="wk-cl-next">${s.next.due && !/^no date$/i.test(s.next.due) ? `<span class="${/^(today|tonight|now|asap|overdue|yesterday|late)|ago$|late$|overdue/i.test(s.next.due) ? 'late' : 'wk-cl-due'}">${esc(s.next.due)}</span>` : ''}<span class="ell">${esc(s.next.name)}: ${esc(s.next.text)}</span></span>` : s.offline ? '<span class="wk-cl-next"><span class="ell">The copy on this phone</span></span>' : ''}</span>${I.chevR}</button>`;
}
// Clients read their files again (or offline, or a pin): only the card changes, the rest of Work stays put
document.addEventListener('clients-changed', () => {
  if (!REAL) return;
  const el = $('#wpanel .wk-clients');
  if (!el) return;
  const t = document.createElement('div');
  t.innerHTML = clientsButton();
  const n = t.firstElementChild;
  if (n && n.outerHTML !== el.outerHTML) el.replaceWith(n);
});
function clientsCard() {
  const rupees = (s) => { const m = String(s).replace(/,/g, '').match(/\d+/); return m ? +m[0] : 0; };
  let due = 0; let owe = 0;
  CLIENTS.forEach((c) => { const d = c.money.rows.filter((r) => r.status !== 'paid').reduce((s, r) => s + rupees(r.amount), 0); due += d; if (c.money.state === 'due') owe += 1; });
  const next = [...CLIENTS].sort((a, b) => (/^today/i.test(a.next.due) ? -1 : 0) - (/^today/i.test(b.next.due) ? -1 : 0))[0];
  return `<button class="wk-clients surface" data-act="w-clients">
    <span class="tile">${I.clients}</span>
    <span class="rbody"><span class="wk-cl-top"><b class="met">≈ ₹${due.toLocaleString('en-IN')}</b><span>to collect · ${owe} owe you</span></span>
      <span class="wk-cl-next"><span class="late">${esc(next.next.due)}</span><span class="ell">${esc(next.name)}: ${esc(next.next.text)}</span></span></span>${I.chevR}</button>`;
}
// the night shift: agent-ready tasks run at 23:00 while you sleep (demo)
function nightCard() {
  const picks = nightPicks();
  const q = W.night?.queued;
  if (q?.length) {
    const chosen = picks.filter((p) => q.includes(p.id));
    return `<div class="wk-night surface is-queued">
      <span class="tile">${WI.moon}</span>
      <span class="rbody"><b>Tonight · ${plural(chosen.length, 'job')} at ${NIGHT.at}</b><span class="wk-n-l">${chosen.map((p) => `<span class="wk-n-j">${I[p.agent]}<span class="ell">${esc(p.title ?? '')}</span></span>`).join('')}</span><span class="foot">The report is here at ${NIGHT.report}.</span></span>
      <button class="btn sm" data-act="w-night">Change</button></div>`;
  }
  const ready = picks.filter((p) => p.on).length;
  return `<div class="wk-night surface">
    <span class="tile">${WI.moon}</span>
    <span class="rbody"><b>Tonight's shift</b><span class="foot">${plural(ready, 'task')} ${ready === 1 ? 'is' : 'are'} ready for an agent. ${ready === 1 ? 'It runs' : 'They run'} at ${NIGHT.at} while you sleep, on the plans you already pay for.</span></span>
    <button class="btn sm" data-act="w-night">Plan it</button></div>`;
}

// ── Jobs: the board, every job as a job, with live progress ───────────
const laneHead = (id, label, count, extra = '') => `<div class="sh lane-h" id="lane-${id}"><h2>${label}</h2>${count ? `<span class="sh-count">${count}</span>` : ''}${extra}</div>`;
function boardPanel() {
  const list = W.filter === 'all' ? JOBS : JOBS.filter((j) => j.project === W.filter);
  const landing = list.filter(isLanding);
  const notLanding = (j) => !landing.includes(j);
  const needs = lane('needs', list), working = lane('working', list), review = lane('review', list).filter(notLanding);
  const done = lane('done', list).filter(notLanding), arch = lane('archive', list), stopped = lane('stopped', list).filter(notLanding);
  const shown = W.open.done ? done : done.slice(0, 3);
  const shownStopped = W.open.stopped ? stopped : stopped.slice(0, 4);
  const projectsWith = PROJECTS.filter((p) => JOBS.some((j) => j.project === p.slug));
  const terms = REAL ? E.code.terms.filter((t) => t.status !== 'exited' && (W.filter === 'all' || t.project === W.filter)) : PROJECTS.flatMap((p) => termSessions(p.slug));
  const streak = REAL ? E.shipStreak() : SHIP_STREAK;
  const builders = REAL ? (E.builders.list ?? []).filter((b) => W.filter === 'all' || b.key === W.filter) : BUILDERS;
  if (REAL) { E.loadBuilders(); E.loadCode(); }
  return `
    ${usageRow()}
    <div class="wk-filter" role="tablist" aria-label="Filter by project" data-scroll-x>${[['all', 'All', null], ...projectsWith.map((p) => [p.slug, p.name, p.color])].map(([v, t, c]) => `<button class="chip sm${W.filter === v ? ' on' : ''}" data-act="w-filter" data-v="${v}" role="tab" aria-selected="${W.filter === v}">${c ? `<i class="dot" style="--c:${c}"></i>` : ''}${esc(t)}</button>`).join('')}</div>
    ${laneHead('needs', 'Needs you', needs.length)}
    ${needs.length ? `<div class="jneeds">${needs.map((j) => needsCard(j, { compact: true })).join('')}</div>`
      : `<div class="group"><div class="row ic jempty"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle">Nothing needs you</span><span class="rmeta">Jobs wait here when they need an OK or an answer.</span></span></div></div>`}
    ${laneHead('working', 'Working', working.length)}
    <div class="group jgroup">${working.length ? working.map((j) => jobCard(j, { showProject: W.filter === 'all' })).join('')
      : `<button class="row ic jempty" data-act="w-new-job"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">Nothing running</span><span class="rmeta">Start a job and it works here.</span></span>${I.chevR}</button>`}</div>
    ${review.length ? `${laneHead('review', 'To review', review.length)}<div class="group jgroup">${review.map((j) => jobCard(j, { showProject: W.filter === 'all' })).join('')}</div>` : ''}
    ${landing.length ? `${laneHead('landing', 'Landing', landing.length)}<div class="group jgroup">${landing.map((j) => jobCard(j, { showProject: W.filter === 'all' })).join('')}</div>` : ''}
    ${stopped.length ? `${laneHead('stopped', 'Stopped', stopped.length)}<div class="group">${shownStopped.map((j) => compactRow(j, { showProject: W.filter === 'all' })).join('')}
      ${stopped.length > 4 ? `<button class="row jmore" data-act="w-fold" data-id="stopped" aria-expanded="${W.open.stopped}"><span class="rbody">${W.open.stopped ? 'Show less' : `Show ${stopped.length - 4} more`}</span>${W.open.stopped ? I.chevU : I.chevD}</button>` : ''}</div>` : ''}
    ${done.length ? `${laneHead('done', 'Completed', done.length, streak ? `<span class="wk-streak">${I.flame}<span class="num">${streak}</span> ${streak === 1 ? 'day' : 'days in a row'} live</span>` : '')}
      <div class="group">${shown.map((j) => compactRow(j, { showProject: W.filter === 'all' })).join('')}
        ${done.length > 3 ? `<button class="row jmore" data-act="w-fold" data-id="done" aria-expanded="${W.open.done}"><span class="rbody">${W.open.done ? 'Show less' : `Show ${done.length - 3} more`}</span>${W.open.done ? I.chevU : I.chevD}</button>` : ''}</div>` : ''}
    ${REAL ? realCompares() : ''}
    ${W.filter === 'all' || REAL ? `${laneHead('builders', 'Builders', builders.length)}
    <div class="group">${builders.length ? builders.map((b) => builderRow(b)).join('') : `<div class="row ic"><span class="tile">${I.hammer}</span><span class="rbody"><span class="rtitle">${REAL && !E.builders.list ? 'Reading the Builders…' : 'No Builders yet'}</span><span class="rmeta">A project’s Builder merges, tests and ships what its jobs hand over.</span></span></div>`}</div>
    ${laneHead('terminals', 'Terminals', terms.length)}
    <div class="group">${REAL && E.code.down ? `<div class="row ic jempty"><span class="tile">${I.term}</span><span class="rbody"><span class="rtitle">The terminal host isn’t running</span><span class="rmeta">Jobs still work. Terminals come back when it starts.</span></span></div>` : ''}${terms.map((t) => termRow(t)).join('')}
      <button class="row ic jadd" data-act="wt-new" data-p="${esc(W.filter === 'all' ? (REAL ? '' : 'agentic-os') : W.filter)}"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">New terminal</span></span></button></div>` : ''}
    ${arch.length ? `<div class="group jarch"><button class="row ic jarch-h" data-act="w-fold" data-id="archive" aria-expanded="${W.open.archive}"><span class="tile">${I.archive}</span><span class="rbody"><span class="rtitle">Archive</span></span><span class="rend"><span class="num">${arch.length}</span>${I.chevR}</span></button>${W.open.archive ? arch.slice(0, 40).map((j) => compactRow(j)).join('') : ''}</div>` : ''}
    <div class="group wk-setrow"><button class="row ic" data-act="w-settings"><span class="tile">${I.gear}</span><span class="rbody"><span class="rtitle">Board settings</span><span class="rmeta">Copies, follow-ups, cache, alerts</span></span>${I.chevR}</button></div>
    <p class="hint">Swipe a job right to move it on, left to bring it back. Hold one to peek.</p>`;
}
function builderRow(b) {
  if (!REAL) return `<button class="row ic" data-act="builder" data-id="${b.id}"><span class="tile">${I.hammer}</span><span class="rbody"><span class="rtitle">${esc(b.name)}</span><span class="rmeta"><span class="ell">${esc(b.last)}</span></span></span><span class="rend">${b.state === 'building' ? '<span class="spin" style="--c:var(--jobs)" role="img" aria-label="Building"></span>' : '<span class="cap">Idle</span>'}${I.chevR}</span></button>`;
  const cur = (b.ships ?? []).find((s) => ['queued', 'sent', 'committed', 'building'].includes(s.state));
  const last = (b.ships ?? []).find((s) => s.state === 'live' || s.state === 'failed');
  const j = b.job;
  const busy = !!cur || (j && ['starting', 'running', 'needs_input'].includes(j.status));
  const sub = cur ? `<span class="mono">${esc(cur.jobId)}</span><span class="ell">· ${esc({ queued: 'Queued', sent: 'With the Builder', committed: 'Committed', building: 'Building' }[cur.state] ?? cur.state)}: ${esc(cur.title)}</span>`
    : last ? `<span class="ell">Last ship ${last.state === 'live' ? 'went live' : 'failed'} ${esc(E.clock.ago(last.doneAt ?? last.at))} ago</span>` : '<span class="ell">Starts with the first job that ships</span>';
  return `<button class="row ic" data-act="builder" data-id="${esc(b.key)}"><span class="tile">${I.hammer}</span><span class="rbody"><span class="rtitle">${esc(E.builderName(b))}</span><span class="rmeta">${sub}</span></span><span class="rend">${busy ? `<span class="wk-bmk">${markFor(j ?? 'claude', 18, { state: 'working' })}</span>` : '<span class="cap">Idle</span>'}${I.chevR}</span></button>`;
}
function termRow(t) {
  if (!REAL) return `<button class="row ic" data-act="terminal" data-p="${t.project}" data-id="${t.id}"><span class="tile">${t.kind === 'agent' ? I[job(t.job)?.agent ?? 'codex'] : t.kind === 'script' ? I.play : I.term}</span><span class="rbody"><span class="rtitle mono">${esc(t.title)}</span><span class="rmeta"><span>${esc(project(t.project)?.name ?? '')}</span><span class="${t.state === 'waiting' ? 'amber' : ''}">· ${esc(t.note)}</span></span></span>${I.chevR}</button>`;
  const agent = E.isAgentTerm(t);
  const state = t.status === 'needs_input' ? '<span class="amber">Needs you</span>' : t.status === 'running' ? (agent ? '<span class="c-jobs">Working</span>' : '<span>Open</span>') : agent ? '<span>Waiting for you</span>' : '<span>Open</span>';
  const tile = agent ? `<span class="tile wk-tmk">${markFor(t.kind, 20, { state: t.status === 'needs_input' ? 'needs' : t.status === 'running' ? 'working' : 'idle' })}</span>` : `<span class="tile">${I.term}</span>`;
  return `<button class="row ic" data-act="terminal" data-p="${esc(t.project ?? '')}" data-id="${esc(t.id)}">${tile}<span class="rbody"><span class="rtitle${agent ? '' : ' mono'}">${esc(t.title)}</span><span class="rmeta"><span>${esc(project(t.project)?.name ?? String(t.cwd ?? '').split(/[\\/]/).filter(Boolean).pop() ?? '')}</span><span>· </span>${state}</span></span>${I.chevR}</button>`;
}
function realCompares() {
  const groups = new Map();
  for (const w of E.code.worktrees) if (w.group && w.state === 'open') groups.set(w.group, [...(groups.get(w.group) ?? []), w]);
  if (!groups.size) return '';
  return `${laneHead('compares', 'Compares', groups.size)}<div class="group">${[...groups.entries()].map(([g, ws]) => `<button class="row ic" data-act="w-compare" data-id="${esc(g)}"><span class="tile">${WI.copies}</span><span class="rbody"><span class="rtitle">${esc(ws[0].title)}</span><span class="rmeta"><span class="ell">${ws.map((w) => `${esc(w.label ?? 'copy')}: ${plural(w.files?.length ?? 0, 'file')}`).join(' · ')}</span></span></span>${I.chevR}</button>`).join('')}</div>`;
}
on('w-compare', (el) => openCompare(el.dataset.id));
on('w-filter', (el) => { W.filter = el.dataset.v; haptic(5); renderPanel(); });
on('w-fold', (el) => { W.open[el.dataset.id] = !W.open[el.dataset.id]; haptic(5); renderPanel(); });
on('w-lane', (el) => {
  if (W.view !== 'jobs') { W.view = 'jobs'; renderWork(); }
  const t = $(`#lane-${el.dataset.id}`); if (t) $('#workScroll').scrollTo({ top: t.offsetTop - 110, behavior: 'smooth' });
});

// lane moves, one step at a time. Real: on (working → stopped, needs you → completed, completed → archive), back
// (archive → completed, completed → needs you, a stopped job carries on); every move has Undo
const ORDER = ['needs', 'working', 'review', 'done', 'archive'];
function realStep(j, dir) {
  const r = j.raw ?? {}; const ln = r.lane ?? 'attention';
  if (dir > 0) {
    if (ln === 'working') return { to: 'attention', label: 'Stopped' };
    if (ln === 'attention') return { to: 'completed', label: 'Completed' };
    if (ln === 'completed') return { to: 'archived', label: 'Archived' };
    return null;
  }
  if (ln === 'archived') return { to: 'completed', label: 'Back in Completed' };
  if (ln === 'completed') return { to: 'attention', label: 'Back in Needs you' };
  if (ln === 'attention' && (r.status === 'stopped' || r.status === 'failed')) return { to: 'working', label: 'Carrying on' };
  return null;
}
function moveJob(id, dir) {
  const j = job(id); if (!j) return;
  if (REAL) { const s = realStep(j, dir); if (!s) { toast(dir > 0 ? 'It can’t move on from here' : 'It can’t go back from here'); return; } E.moveJob(id, s.to, { label: s.label, undo: s.to !== 'working' }); return; }
  const from = j.lane; const i = ORDER.indexOf(from) + dir;
  if (i < 0 || i >= ORDER.length) return;
  j.lane = ORDER[i];
  if (j.lane === 'working' && !j.progress) j.progress = { done: 1, total: 4, step: 'Carry on', stage: 'Build' };
  if (j.lane === 'needs' && !j.ask) j.ask = { kind: 'form', text: 'Carry on from where you stopped?' };
  changed({ job: id });
  toast(`Moved to ${LANES.find(([l]) => l === j.lane)?.[1]}`, () => { j.lane = from; changed({ job: id }); });
}
let peekJob = null;
function jobPeek(id) {
  const j = job(id); if (!j) return;
  if (REAL) {
    const r = j.raw ?? {};
    const live = ['starting', 'running', 'needs_input'].includes(r.status);
    const cache = r.cache && r.cache.state !== 'none';
    const kw = r.cache?.keepWarmUntil && Date.parse(r.cache.keepWarmUntil) > Date.now();
    peek(`<div class="pk jpk"><div class="kicker">${agentName(j.agent)} · ${esc(r.model ? E.modelName(r.model) : 'Default model')}${r.effort ? ` · ${esc(E.effortName(r.effort))}` : ''}</div>
      <h3 class="t1">${esc(j.title)}</h3>
      ${j.progress ? `<div class="pk-prog"><span class="pk-mk" data-mark-job="${j.id}">${markFor(j, 40)}</span><span class="pk-n"><b class="met c-jobs">${j.progress.done}<small>/${j.progress.total}</small></b><span class="foot">${esc(j.progress.step)}${j.progress.stage ? ` · ${esc(j.progress.stage)}` : ''}</span></span></div>` : `<div class="pk-prog"><span class="pk-mk" data-mark-job="${j.id}">${markFor(j, 40)}</span><span class="pk-n"><span class="foot">${esc({ starting: 'Starting', running: 'Working', needs_input: 'Needs you', idle: 'Replied', stopped: 'Stopped', failed: 'Failed', done: 'Done' }[r.status] ?? r.status)} · ${esc(j.ago)}</span></span></div>`}
      <p class="pk-out${r.status === 'failed' ? ' err' : ''}">${esc(String((r.status === 'failed' ? r.error : j.last) ?? 'Nothing said yet.').slice(0, 420))}</p></div>`,
    [['Open', I.chevR, 'w-pk-open'], [j.star ? 'Unstar' : 'Star', I.star, 'w-pk-star'], [r.review ? 'Clear review' : 'Mark for review', I.eye, 'w-pk-review'], ...(cache ? [[kw ? 'Stop keeping it warm' : 'Keep the cache warm', I.flame, 'w-pk-warm']] : []), ...(live ? [['Stop', I.stop, 'w-pk-stop']] : [])]);
    peekJob = id;
    return;
  }
  peek(`<div class="pk jpk"><div class="kicker">${agentName(j.agent)} · ${esc(j.model)} · ${esc(j.effort)}</div>
    <h3 class="t1">${esc(j.title)}</h3>
    ${j.progress ? `<div class="pk-prog"><span class="pk-n"><b class="met c-jobs">${j.progress.done}<small>/${j.progress.total}</small></b><span class="foot">${esc(j.progress.step)} · ${esc(j.progress.stage)}</span></span></div>` : ''}
    <p class="pk-out">${esc(j.last ?? 'Finished.')}</p></div>`,
  [['Open', I.chevR, `w-pk-open`], [j.star ? 'Unstar' : 'Star', I.star, 'w-pk-star'], ['Snooze until this evening', I.moon, 'w-pk-snooze'], ['Mark for review', I.eye, 'w-pk-review'], ['Stop', I.stop, 'w-pk-stop']]);
  peekJob = id;
}
on('w-pk-open', () => { closePeek(); openJob(peekJob); });
on('w-pk-star', async () => {
  closePeek(); const j = job(peekJob);
  if (REAL) { try { await E.act.board(j.id, { starred: !j.star }); haptic(6); toast(j.star ? 'Unstarred' : 'Starred'); } catch (e) { toast(E.err(e)); } return; }
  j.star = !j.star; changed({ job: j.id }); toast(j.star ? 'Starred' : 'Unstarred');
});
on('w-pk-snooze', () => { closePeek(); toast('Snoozed until 20:00. It comes back to the board then'); });
on('w-pk-review', async () => {
  closePeek(); const j = job(peekJob);
  if (REAL) { const on_ = !j.raw?.review; try { await E.act.board(j.id, { review: on_ }); haptic(6); toast(on_ ? 'Marked for review' : 'Review cleared', () => E.act.board(j.id, { review: !on_ }).catch(() => {})); } catch (e) { toast(E.err(e)); } return; }
  const was = j.lane; j.lane = 'review'; changed({ job: j.id }); toast('Moved to To review', () => { j.lane = was; changed({ job: j.id }); });
});
on('w-pk-warm', async () => {
  closePeek(); const j = job(peekJob); const kw = j.raw?.cache?.keepWarmUntil && Date.parse(j.raw.cache.keepWarmUntil) > Date.now();
  try { await E.act.board(j.id, { keepWarm: kw ? 0 : true }); haptic(6); toast(kw ? 'Keep-warm off for this job' : 'Keeping the cache warm'); } catch (e) { toast(E.err(e)); }
});
on('w-pk-stop', async () => {
  closePeek(); const j = job(peekJob);
  if (REAL) { E.moveJob(j.id, 'attention', { label: 'Stopped', undo: false }); return; }
  const was = j.lane; j.lane = 'review'; j.last = 'Stopped by you.'; changed({ job: j.id }); toast('Stopped', () => { j.lane = was; changed({ job: j.id }); });
});

// ── Ideas ─────────────────────────────────────────────────────────────
// Open ideas come with the day; the used ones (made a task, given to a job) and the archived are read from the PC when
// their filter is picked, and listed without Task and Job.
const IDEA_ST = [['open', 'Open'], ['tasked', 'Made tasks'], ['jobbed', 'Given to jobs'], ['archived', 'Archived']];
const IDEA_PILL = { tasked: 'Made a task', jobbed: 'A job has it', archived: 'Archived' };
const IDF = { st: 'open', lists: {}, loading: null, error: null };
function loadIdeasOf(st) {
  IDF.error = null;
  IDF.loading = API.get(`/ideas?status=${st}`, { timeout: 15000 })
    .then((r) => { IDF.lists[st] = r.ideas ?? []; }, (e) => { IDF.error = E.err(e); })
    .finally(() => { IDF.loading = null; if (W.view === 'ideas' && IDF.st === st) renderPanel(); });
}
const agoText = (iso) => { const a = clockAgo(iso); return a === 'now' ? 'Just now' : /^\d+[mhd]$/.test(a) ? `${a} ago` : a; };
const usedIdeaRow = (i, p) => `<div class="row idea" data-id="${esc(i.id)}"><span class="rbody">
    <span class="rtitle wrap">${esc(p && i.title.startsWith(`${p.name}: `) ? capFirst(i.title.slice(p.name.length + 2)) : i.title)}</span>
    <span class="idea-m"><span class="rmeta"><span>${esc(agoText(i.updatedAt ?? i.createdAt))}</span><span class="pill plain">${IDEA_PILL[i.status] ?? esc(i.status)}</span></span></span></span></div>`;
function ideasPanel() {
  const st = REAL ? IDF.st : 'open';
  const all = st === 'open' ? ideasNow().filter((i) => (i.status ?? 'open') === 'open' || (REAL && i.pending)) : IDF.lists[st] ?? [];
  const groups = [[null, all.filter((i) => !project(i.project))], ...PROJECTS.map((p) => [p, all.filter((i) => i.project === p.slug)])].filter(([, l]) => l.length);
  const row = st === 'open' ? ideaRow : usedIdeaRow;
  const chips = REAL ? `<div class="pad"><div class="chips" role="group" aria-label="Show ideas">${IDEA_ST.map(([v, l]) => `<button class="chip sm ${st === v ? 'on' : ''}" data-act="jidea-st" data-v="${v}" aria-pressed="${st === v}">${l}</button>`).join('')}</div></div>` : '';
  const empty = st === 'open' ? `<div class="group jideas-empty"><div class="row ic"><span class="tile">${I.bulb}</span><span class="rbody"><span class="rtitle">No ideas waiting</span><span class="rmeta">Drop one above, or say it.</span></span></div></div>`
    : IDF.loading || !(st in IDF.lists) ? (IDF.error ? `<p class="note">${esc(IDF.error)}</p>` : '<div class="group"><div class="row"><span class="rbody"><span class="rmeta"><span class="spin" aria-hidden="true"></span> Asking your PC</span></span></div></div>')
    : `<p class="note">No ideas here.</p>`;
  return `${st === 'open' ? `<div class="pad jidea-f"><div class="field">${I.bulb}<input class="jidea-in" placeholder="Drop an idea" aria-label="New idea" enterkeyhint="done" /><button class="fbtn" data-act="jidea-mic" aria-label="Say an idea">${I.mic}</button></div></div>` : ''}${chips}
    ${groups.map(([p, l]) => `<div class="sh jidea-h"><h2>${p ? `<i class="dot" style="--c:${p.color}"></i>${esc(p.name)}` : REAL ? 'Inbox' : 'No project'}</h2><span class="sh-count">${l.length}</span></div><div class="group jideas-g">${l.map((i) => row(i, p)).join('')}</div>`).join('')}
    ${groups.length ? (st === 'open' ? '<p class="hint">Job hands the idea to Claude or Codex; Task puts it on your list.</p>' : '') : empty}`;
}
on('jidea-mic', () => api.openCapture('voice', { type: 'idea' }));
on('jidea-st', (el) => {
  IDF.st = el.dataset.v; haptic(5);
  if (IDF.st !== 'open') loadIdeasOf(IDF.st);
  renderPanel();
});

// ── jump to anything: projects, jobs, tasks, changed files and the things you can do ──
function findSheet() {
  const realFiles = REAL ? E.code.worktrees.filter((w) => w.state === 'open').flatMap((w) => (w.files ?? []).slice(0, 30).map((f) => ({ t: f.path.split('/').pop(), m: `${f.path} · ${String(w.branch).replace(/^aos\//, '')}`, i: WI.file, act: 'w-copy', id: w.id, mono: true }))) : [];
  const all = [
    ...PROJECTS.map((p) => ({ t: p.name, m: `Project${p.folder ? ` · ${String(p.folder).split(/[\\/]/).filter(Boolean).pop()}` : ''}`, i: I.folder, act: 'project', id: p.slug })),
    ...JOBS.map((j) => ({ t: j.title, m: `Job ${j.id} · ${agentName(j.agent)} · ${LANES.find(([l]) => l === j.lane)?.[1] ?? ''}`, i: markFor(j, 20), act: 'job', id: j.id })),
    ...TASKS.filter((t) => t.project && t.list !== 'done').map((t) => ({ t: t.title, m: `Task · ${project(t.project)?.name ?? ''}`, i: I.check, act: 'w-task', id: t.id })),
    ...(REAL ? realFiles : Object.entries(CHANGES).flatMap(([jid, fs]) => fs.map((f) => ({ t: f.path.split('/').pop(), m: `${f.path} · ${jid}`, i: WI.file, act: 'wr-open', id: jid, path: f.path, mono: true })))),
    ...[['New job', 'w-new-job', I.claude], ['New terminal', 'wt-new', I.term], ['Plan tonight\'s shift', 'w-night', WI.moon], ['Board settings', 'w-settings', I.gear]].map(([t, act, i]) => ({ t, m: 'Action', i, act })),
  ];
  openSheet({
    title: 'Jump to', large: true,
    body: (b) => {
      b.innerHTML = `<div class="pad"><label class="field">${I.search}<input type="search" placeholder="Projects, jobs, tasks, files" autocomplete="off" aria-label="Search Work" /></label></div><div class="wk-res" aria-live="polite"></div>`;
      const res = $('.wk-res', b);
      const draw = (q) => {
        const hits = all.filter((x) => !q || `${x.t} ${x.m}`.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 40 : 14);
        res.innerHTML = hits.length ? `<p class="wr-lbl pad">${q ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'Recent and useful'}</p><div class="group">${hits.map((x) => `<button class="row ic" data-act="w-jump" data-go="${x.act}" data-id="${esc(x.id ?? '')}" data-path="${esc(x.path ?? '')}"><span class="tile">${x.i}</span><span class="rbody"><span class="rtitle${x.mono ? ' mono' : ''}">${esc(x.t)}</span><span class="rmeta"><span class="ell">${esc(x.m)}</span></span></span>${I.chevR}</button>`).join('')}</div>`
          : `<div class="note">Nothing in Work matches "${esc(q)}".</div>`;
      };
      draw('');
      $('input', b).addEventListener('input', (e) => draw(e.target.value.trim()));
      setTimeout(() => $('input', b)?.focus(), 450);
    },
  });
}
on('w-find', () => findSheet());
on('w-jump', (el) => {
  const { go, id } = el.dataset; closeSheet(el.closest('.sheet'));
  setTimeout(() => {
    if (go === 'project') openProject(id, 'Work');
    else if (go === 'job') openJob(id);
    else if (go === 'w-task') api.openTask(id);
    else if (go === 'w-copy') openCopy(id);
    else if (go === 'wr-open') openChanges(id);
    else window.__acts?.get(go)?.(el, { target: el });
  }, 260);
});
on('w-ask', () => api.askAgent('', { about: 'work' }));

// ── board settings ────────────────────────────────────────────────────
const SETS = {
  cacheC: ['Claude cache length', ['5 min', '60 min']], cacheX: ['Codex cache length', ['5 min', '60 min']],
  ping: ['Ping me before it goes cold', ['Off', '5 min', '15 min', '30 min']], keep: ['Keep warm for', ['30 min', '1 h', '2 h', 'Until I stop it']],
  arch: ['Auto-archive stopped jobs', ['1 day', '3 days', '7 days', 'Never']], ckpt: ['Drop checkpoints of archived chats', ['3 days', '7 days', '30 days', 'Never']],
  batch: ['Builder batching', ['Off', '5 min', '10 min', '30 min']],
};
const SWS = [['wt', 'New jobs work in a separate copy'], ['steer', 'A message sent while it works steers it'], ['notify', 'Quiet while I\'m at the PC'], ['type', 'Type into plain terminals from this phone']];
const setRow = (k) => `<button class="row" data-act="wset-pick" data-k="${k}"><span class="rbody"><span class="rtitle wrap">${SETS[k][0]}</span></span><span class="rend">${W.set[k]}${I.chevR}</span></button>`;
on('w-settings', () => (REAL ? realSettings() : openSheet({
  title: 'Board settings', large: true, cls: 'jset-sheet', body: `
  <div class="group">${SWS.map(([k, t]) => `<div class="row"><span class="rbody"><span class="rtitle wrap">${t}</span></span><button class="switch ${W.set[k] ? 'on' : ''}" data-act="wset-sw" data-k="${k}" role="switch" aria-checked="${!!W.set[k]}" aria-label="${t}"></button></div>`).join('')}</div>
  <p class="hint">Off, a message sent while a job works waits in a queue until the turn ends. A plain PowerShell runs whatever you send, so typing into it stays off unless you turn it on.</p>
  <div class="sh"><h2>Cache</h2></div>
  <div class="group">${['cacheC', 'cacheX', 'ping', 'keep'].map(setRow).join('')}</div>
  <div class="sh"><h2>Clean-up</h2></div>
  <div class="group">${['arch', 'ckpt', 'batch'].map(setRow).join('')}</div>` })));
on('wset-sw', (el) => { const k = el.dataset.k; W.set[k] = !W.set[k]; haptic(6); el.classList.toggle('on', W.set[k]); el.setAttribute('aria-checked', String(W.set[k])); changed(); });
on('wset-pick', (el) => {
  const k = el.dataset.k; const [title, opts] = SETS[k];
  openSheet({ title, body: `<div class="group">${opts.map((o) => `<button class="row" data-act="wset-val" data-k="${k}" data-v="${o}"><span class="rbody"><span class="rtitle">${o}</span></span>${o === W.set[k] ? `<span class="jpick">${I.check}</span>` : ''}</button>`).join('')}</div>` });
});
on('wset-val', (el) => {
  const { k, v } = el.dataset; W.set[k] = v; closeSheet();
  const end = $(`.jset-sheet [data-act="wset-pick"][data-k="${k}"] .rend`); if (end) end.innerHTML = `${esc(v)}${I.chevR}`;
  haptic(5);
});
// the PC's own settings (GET/POST /jobs/board-settings, /term/settings), the phone's own (copies by default, steer)
const RS = {
  'cacheTtlMin.claude': ['Claude cache length', [5, 60], (v) => `${v} min`],
  'cacheTtlMin.codex': ['Codex cache length', [5, 10, 60], (v) => `${v} min`],
  leadMin: ['Ping it before the cache goes cold', [2, 5, 15], (v) => `${v} min before`],
  keepWarmHours: ['Keep warm for', [1, 2, 3, 8], (v) => `${v} h after your last message`],
  autoArchiveDays: ['Archive shipped jobs after', [3, 7, 14, 30], (v) => `${v} days`],
  ckptDropDays: ['Drop checkpoints of archived jobs after', [7, 14, 30], (v) => `${v} days`],
  batchSec: ['Builder batching', [0, 20, 60], (v) => (Number(v) ? `${v} s` : 'No wait')],
};
const rsGet = (s, k) => (k.startsWith('cacheTtlMin.') ? s.cacheTtlMin?.[k.split('.')[1]] : s[k]);
async function realSettings() {
  let s;
  try { s = await E.boardSettings.get(); } catch (e) { toast(E.err(e)); return; }
  await E.loadCode(true);
  const { steerOn } = await import('./work-live.js');
  openSheet({
    title: 'Board settings', large: true, cls: 'jset-sheet wk-rset', body: (b) => {
      const draw = () => {
        const sw = (k, t, on_, note = '') => `<div class="row"><span class="rbody"><span class="rtitle wrap">${t}</span>${note ? `<span class="rmeta wrap">${note}</span>` : ''}</span><button class="switch ${on_ ? 'on' : ''}" data-rs-sw="${k}" role="switch" aria-checked="${!!on_}" aria-label="${esc(t)}"></button></div>`;
        const pick = (k) => { const [t, , f] = RS[k]; return `<button class="row" data-rs-pick="${k}"><span class="rbody"><span class="rtitle wrap">${t}</span></span><span class="rend">${esc(f(rsGet(s, k)))}${I.chevR}</span></button>`; };
        b.innerHTML = `<div class="group">${sw('wt', 'New jobs work in their own copy', E.lastWorktree(), 'A git folder gets its own branch (aos/…), so jobs can’t clash')}${sw('steer', 'A message sent while it works steers it', steerOn(), 'Off: it waits in the queue until the turn ends')}${sw('keep', 'Keep caches warm', s.keepWarm, 'A one-word ping before a cache goes cold. Each counts toward your limits')}${sw('type', 'Type into plain terminals from this phone', E.code.settings.phoneShellInput, 'A plain PowerShell runs whatever you send')}</div>
          <div class="sh"><h2>Cache</h2></div><div class="group">${['cacheTtlMin.claude', 'cacheTtlMin.codex', 'leadMin', 'keepWarmHours'].map(pick).join('')}</div>
          <div class="sh"><h2>Clean-up</h2></div><div class="group">${['autoArchiveDays', 'ckptDropDays', 'batchSec'].map(pick).join('')}</div>`;
      };
      draw();
      b.addEventListener('click', async (e) => {
        const swb = e.target.closest('[data-rs-sw]');
        if (swb) {
          const k = swb.dataset.rsSw; haptic(6);
          try {
            if (k === 'wt') E.rememberWorktree(!E.lastWorktree());
            else if (k === 'steer') { const { setSteer } = await import('./work-live.js'); setSteer(!steerOn()); }
            else if (k === 'keep') s = await E.boardSettings.set({ keepWarm: !s.keepWarm });
            else if (k === 'type') { const r = await E.term.settings({ phoneShellInput: !E.code.settings.phoneShellInput }); E.code.settings = r.settings; }
          } catch (er) { toast(E.err(er)); }
          draw(); return;
        }
        const pk = e.target.closest('[data-rs-pick]');
        if (pk) {
          const k = pk.dataset.rsPick; const [t, opts, f] = RS[k];
          openSheet({ title: t, body: (x) => {
            x.innerHTML = `<div class="group">${opts.map((v) => `<button class="row" data-v="${v}"><span class="rbody"><span class="rtitle">${esc(f(v))}</span></span>${String(v) === String(rsGet(s, k)) ? `<span class="jpick">${I.check}</span>` : ''}</button>`).join('')}</div>`;
            x.addEventListener('click', async (ev) => {
              const r = ev.target.closest('[data-v]'); if (!r) return;
              const v = Number(r.dataset.v);
              try { s = await E.boardSettings.set(k.startsWith('cacheTtlMin.') ? { cacheTtlMin: { [k.split('.')[1]]: v } } : { [k]: v }); haptic(5); } catch (er) { toast(E.err(er)); }
              closeSheet(x.closest('.sheet')); draw();
            });
          } });
        }
      });
    },
  });
}

// ── live: real jobs move by themselves (the store polls while one runs; a job's page streams). Demo plays a script ──
const LIVE = {
  j15: [['term', 'node --check js/jobs.js', 'OK'], ['edit', 'Editing css/screens/jobs.css', '+86 −12'], ['eye', 'Screenshotting the board at 402 × 874', '6 screens'], ['edit', 'Editing js/jobs.js: the Landing lane', '+40 −6']],
  j9: [['edit', 'Writing card R2: Kurta fold hack', '28 s · 64 words'], ['edit', 'Writing card R3: Midtown store tour', '45 s · 118 words'], ['edit', 'Exporting the pack', '2 setups · 4 cards']],
};
const PAST = [[/^Editing /, 'Edited '], [/^Writing /, 'Wrote '], [/^Exporting /, 'Exported '], [/^Screenshotting /, 'Screenshotted '], [/^Running /, 'Ran '], [/^Reading /, 'Read ']];
const past = (t) => PAST.reduce((s, [re, w]) => s.replace(re, w), t);
let liveOn = false;
function startLive() {
  if (liveOn) return; liveOn = true;
  if (REAL) {
    // terminals, copies and Builders while Work is on screen (the store polls the jobs themselves)
    E.whileVisible(4000, () => { if (currentTab() === 'jobs' || $('#stack .jpage')) E.loadCode(); });
    E.whileVisible(30000, () => { if (currentTab() === 'jobs') E.loadBuilders(); });
    E.loadCode(); E.loadBuilders();
    return;
  }
  const at = {};
  setInterval(() => {
    if (document.hidden) return;
    const onWork = currentTab() === 'jobs' || $('#stack .chat-page');
    if (!onWork) return;
    for (const [id, steps] of Object.entries(LIVE)) {
      const j = job(id); if (!j || j.lane !== 'working') continue;
      const i = at[id] ?? 0; if (i >= steps.length) continue;
      at[id] = i + 1;
      const [k, text, detail] = steps[i]; const t = THREADS[id]?.[THREADS[id].length - 1];
      if (t?.live) { const last = t.steps[t.steps.length - 1]; last[1] = past(last[1]); if (last[3]) { last[2] = last[3]; last.length = 3; } t.steps.push([k, text, undefined, detail]); }
      j.last = text;
      $$(`[data-live="${id}"]`).forEach((el) => { el.classList.remove('wk-tick'); void el.offsetWidth; el.textContent = j.last; el.classList.add('wk-tick'); });
      document.dispatchEvent(new CustomEvent('work:tick', { detail: { job: id } }));
      break;
    }
  }, 6500);
}

// ── bus: how the rest of the app reaches Work ─────────────────────────
function openWork(view) {
  if (VIEWS.includes(view)) W.view = view;
  if (currentTab() !== 'jobs') setTab('jobs'); else renderWork();
  if (view === 'clients') setTimeout(() => api.openClients(), 60);
  else if (view === 'terminal') setTimeout(() => openTerminal(REAL ? null : 'agentic-os'), 60);
  else if (view === 'night') setTimeout(() => nightSheet(), 60);
  else if (view === 'new') setTimeout(() => newJob({}), 60);
}
provide('openWork', openWork);
provide('openProject', (slug, back) => openProject(slug, back ?? 'Work'));
provide('openJob', (id) => openJob(id));
provide('newJob', (prefill) => newJob(prefill ?? {}));
provide('handToAgent', (taskId, agent) => newJob({ task: taskId, agent }));
provide('openChanges', (id, turn) => openChanges(id, Number(turn) || 0));
provide('openTerminal', (slug, id) => openTerminal(slug ?? (REAL ? null : 'agentic-os'), id ?? null));
provide('nightShift', () => nightSheet());
// what Work looks like right now, in the shape an aspect's summary() has: Home and the agent read it
provide('workSummary', () => {
  const n = lane('needs'), w = lane('working'), r = lane('review').filter((j) => !isLanding(j));
  const streak = REAL ? E.shipStreak() ?? 0 : SHIP_STREAK;
  return {
    line: n.length ? `${plural(n.length, 'job')} ${n.length === 1 ? 'needs' : 'need'} you · ${w.length} running` : `${plural(w.length, 'job')} running · ${r.length} to review`,
    metric: { v: n.length, unit: '', label: 'need you', p: w.length ? w.reduce((s, j) => s + (j.progress ? j.progress.done / j.progress.total : 0), 0) / w.length : 0 },
    today: n.slice(0, 3).map((j) => ({ id: j.id, text: REAL ? `${j.id}: ${j.ask?.text ?? j.last ?? j.title}` : j.ask?.kind === 'permission' ? `${j.id}: allow ${j.ask.text.replace(/^Run (.+?)(?: in .+)?\?$/, '$1')}?` : `${j.id}: ${j.ask?.text ?? j.title}`, done: false, act: 'job' })),
    streak: { n: streak, label: 'days in a row something went live', atRisk: false },
    quick: [{ label: 'New job', icon: I.claude, act: 'w-new-job' }],
  };
});
document.addEventListener('work:terminal', (e) => {
  const { project: slug = REAL ? null : 'agentic-os', job: jid, fresh } = e.detail ?? {};
  if (fresh) { window.__acts?.get('wt-new')?.({ dataset: { p: slug ?? '' } }); return; }
  const t = jid && termSessions(slug).find((x) => x.job === jid);
  openTerminal(slug, t?.id ?? null);
});
document.addEventListener('work:builder', (e) => openBuilder(e.detail.id));
document.addEventListener('work:newjob', (e) => newJob(e.detail));
// the board's marks follow each job's state as the PC reports it (a tick when one finishes)
onData((why) => { if (why === 'jobs' && REAL) for (const j of JOBS) syncMarks(j); });

// links that open Work's own pages (svc/route.js passes them here): a terminal, a copy, a compare, an idea
if (REAL) {
  registerRoute('term', (L, c) => { if (!L.sub) return false; c.tab('jobs'); c.after(async () => { await E.loadCode(true); const t = E.code.terms.find((x) => x.id === L.sub); openTerminal(t?.project ?? null, L.sub); }); }, { owner: true });
  registerRoute('copy', (L, c) => { if (!L.sub) return false; c.tab('jobs'); c.after(() => openCopy(L.sub)); }, { owner: true });
  registerRoute('compare', (L, c) => { if (!L.sub) return false; c.tab('jobs'); c.after(() => openCompare(L.sub)); }, { owner: true });
  registerRoute('idea', (L, c) => { if (!L.sub) return false; c.tab('jobs'); W.view = 'ideas'; IDF.st = 'open'; c.after(() => { renderWork(); const r = $(`#wpanel .idea[data-id="${CSS.escape(L.sub)}"]`); r?.scrollIntoView({ block: 'center' }); r?.classList.add('wk-flash'); }); }, { owner: true });
}

// for screenshots and the console: back to the Work tab with nothing pushed and no sheet open
window.__wreset = () => {
  $$('#stack > .page').forEach((p) => p.remove());
  $$('#phone > .sheet').forEach((s) => s.remove());
  $('#scrim')?.classList.remove('on'); closePeek();
  $('#pages')?.classList.remove('pushed'); $('#dock')?.classList.remove('away');
  if (currentTab() !== 'jobs') setTab('jobs', { instant: true });
};

export { openProject };

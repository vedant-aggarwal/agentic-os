// The Projects tab (Ideas and Jobs rows on top, then projects), the project page with its four sections
// (Ideas, Tasks, Jobs, Sessions), and the all-ideas and all-jobs pages.
import { W, onChange, isLive, isActive, JOB_LABEL, ENGINE, projectBySlug, loadProject, loadJobs, loadIdeas, createIdea, ago, laneOf } from './state.js';
import { openIdea, openJobSheet, openJob, openProjectSheet, folderName, ideaToTask } from './sheets.js';
import * as voice from './recorder.js';
import { SHIP_LABEL, shipOf, shipHTML, cacheHTML, jobRowHTML, jobCardHTML, jobSmallHTML, agoText } from './cards.js';

const { AOS } = window;
const { esc } = AOS;
const $ = (s, el = document) => el.querySelector(s);
const OPEN = ['inbox', 'todo', 'doing'];
const BULB = '<svg viewBox="0 0 20 20"><path d="M10 2.8a5 5 0 0 0-2.9 9.1V14h5.8v-2.1A5 5 0 0 0 10 2.8zM7.8 16.8h4.4"/></svg>';
const TERM = '<svg viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="13" rx="3"/><path d="m6 8 2.5 2L6 12M10.5 12.5h3.5"/></svg>';
const SESS = { claude: 'C', codex: 'X' };

const openTasks = (slug) => AOS.data().tasks.filter((t) => t.project === slug && OPEN.includes(t.status));
const ideasOf = (slug) => W.ideas.filter((i) => (slug === null ? !i.project : i.project === slug) && ['open', undefined].includes(i.status ?? 'open'));
const jobsOf = (slug) => W.jobs.filter((j) => j.project === slug);
const liveFirst = (a, b) => (isActive(b) - isActive(a)) || (isLive(b) - isLive(a)) || (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '');
const projIcon = (p) => `<span class="area-icon pj-icon" style="--c:${p.color || AOS.color(p.area)}">${p.icon ? `<span class="pj-emoji">${esc(p.icon)}</span>` : `<span class="pj-letter">${esc((p.name || '?').slice(0, 1).toUpperCase())}</span>`}</span>`;

// ---------- Rows: the job cards and rows are cards.js's (board, project page, a task's sheet) ----------
export { SHIP_LABEL, shipOf, jobRowHTML };
export const shipChipHTML = (j) => shipHTML(j);
export const cacheChipHTML = (j) => cacheHTML(j);
const I = AOS.icons;
const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** A project's mark: its emoji, or its first letter; its colour rides along as a dot beside its name. */
const pcolor = (p) => p.color || AOS.color(p.area);
const pmark = (p, cls = '') => `<span class="jp-ic${cls}" style="--c:${pcolor(p)}" aria-hidden="true">${p.icon ? esc(p.icon) : `<b>${esc((p.name || '?').slice(0, 1).toUpperCase())}</b>`}</span>`;
/** An idea: the sentence, its age, then two ways out (a task, or a job). Under its project's heading an idea drops the
 *  project's name from its title; the heading already says it. Tap the sentence for the idea sheet. */
export function ideaRowHTML(i, { project = null } = {}) {
  const title = project && i.title.startsWith(`${project.name}: `) ? capFirst(i.title.slice(project.name.length + 2)) : i.title;
  const meta = [i.pending ? 'Waiting for your PC' : agoText(i.createdAt), i.body ? 'Notes' : null].filter(Boolean);
  const pending = !!i.pending;
  return `<div class="lrow jidea" data-idea="${esc(i.id)}"><button type="button" class="jidea-open" data-open-idea="${esc(i.id)}" aria-label="${esc(title)}, open the idea"></button><span class="rbody">
<span class="rtitle wrap">${esc(title)}</span>
<span class="jidea-m"><span class="rmeta">${meta.map((m) => `<span>${esc(m)}</span>`).join('<span aria-hidden="true">·</span>')}</span>
<span class="jidea-acts"><button type="button" class="btn sm" data-idea-task="${esc(i.id)}" ${pending ? 'disabled' : ''}>Task</button><button type="button" class="btn sm tint" style="--c:var(--jobs-ink)" data-idea-job="${esc(i.id)}" ${pending ? 'disabled' : ''}>Job</button></span></span></span></div>`;
}
function sessionRowHTML(s) {
  const tag = s.jobId ? `data-open-job="${esc(s.jobId)}"` : `data-session="${esc(s.id)}"`;
  const title = (s.title && s.title !== '(untitled)' ? s.title : null) ?? (s.jobId ? W.jobs.find((j) => j.id === s.jobId)?.title : null) ?? 'Untitled session';
  const meta = [s.live ? '<span class="jst-working">Live</span>' : '', `<span>${esc(s.tool === 'codex' ? 'Codex' : 'Claude')}</span>`, `<span>${esc(agoText(s.updatedAt))}</span>`, s.jobId ? '<span>job</span>' : '', s.where ? `<span class="ell">${esc(s.where)}</span>` : ''].filter(Boolean).join('<span aria-hidden="true">·</span>');
  return `<button type="button" class="lrow ic jsess" ${tag}><span class="agent sm ${esc(s.tool === 'codex' ? 'codex' : 'claude')}" aria-hidden="true">${I[s.tool === 'codex' ? 'codex' : 'claude']}</span><span class="rbody"><span class="rtitle">${esc(title)}</span><span class="rmeta">${meta}</span></span>${s.jobId ? AOS.CHEV : ''}</button>`;
}
export function jobsForTask(t) {
  const js = W.jobs.filter((j) => (j.taskIds ?? []).includes(t.id) || (t.jobIds ?? []).includes(j.id)).sort(liveFirst);
  return js.length ? `<div class="field task-jobs"><span class="f-label">Jobs</span><div class="work-list">${js.slice(0, 3).map(jobRowHTML).join('')}</div></div>` : '';
}

// ---------- Projects: the Jobs tab's Projects segment (app/work/tab.js) ----------
let showFinished = false;
const projRowHTML = (p) => {
  const t = openTasks(p.slug).length, i = ideasOf(p.slug).length, jl = jobsOf(p.slug).filter(isActive);
  const sub = [t ? AOS.plural(t, 'task') : null, i ? AOS.plural(i, 'idea') : null, p.status === 'paused' ? 'Paused' : null, p.area ? AOS.areaShort(p.area) : null].filter(Boolean).join(' · ') || 'Nothing open';
  return `<button class="area-row pj-row" data-project="${esc(p.slug)}">${projIcon(p)}<span class="ar-text"><span class="ar-name">${esc(p.name)}</span><span class="ar-sub">${esc(sub)}</span></span>${jl.length ? `<span class="live-dot${jl.some((j) => j.status === 'needs_input') ? ' needs' : ''}" aria-label="${AOS.plural(jl.length, 'job')} working"></span>` : ''}${AOS.CHEV}</button>`;
};
const figure = (n, w) => `<span><b class="met">${n}</b> ${w}${n === 1 ? '' : 's'}</span>`;
/** A project's card: its mark and what is live in it, then its name and what is open. */
function pcardHTML(p) {
  const live = jobsOf(p.slug).filter(isActive);
  const needs = live.filter((j) => j.status === 'needs_input').length;
  const badge = needs ? `<span class="jp-live needs"><i class="dot"></i>${needs === 1 ? 'Needs you' : `${needs} need you`}</span>` : live.length ? `<span class="jp-live"><i class="dot"></i>${live.length} live</span>` : '';
  return `<button type="button" class="jpcard" data-project="${esc(p.slug)}" style="--c:${pcolor(p)}"><span class="jp-top">${pmark(p)}${badge}</span>
<span class="jp-b"><b class="jp-n"><i class="dot jp-dot" style="--c:${pcolor(p)}"></i><span>${esc(p.name)}</span></b><span class="jp-m">${figure(openTasks(p.slug).length, 'task')}${figure(ideasOf(p.slug).length, 'idea')}</span></span></button>`;
}
/** The live projects as a grid of cards, a New project card, then the finished ones in a row that opens in place. */
export function renderProjectsList(el) {
  if (!el) return;
  const all = AOS.data().projects;
  const live = AOS.liveProjects();
  const finished = all.filter((p) => ['done', 'archived', 'dropped'].includes(p.status));
  const html = `<div class="jpgrid">${live.map(pcardHTML).join('')}<button type="button" class="jpcard new" data-new-project><span class="jp-top"><span class="jp-ic">${I.plus}</span></span><span class="jp-b"><b class="jp-n">New project</b><span class="jp-m">Name, folder, area</span></span></button></div>
<div class="group jpdone">${finished.length
    ? `<button type="button" class="lrow ic jarch-h" data-toggle-finished aria-expanded="${showFinished}"><span class="tile">${I.archive}</span><span class="rbody"><span class="rtitle">Finished</span></span><span class="rend"><span class="num">${finished.length}</span>${AOS.CHEV}</span></button>${showFinished ? finished.map((p) => `<button type="button" class="lrow jpsmall" data-project="${esc(p.slug)}">${pmark(p, ' sm')}<span class="rbody"><span class="rtitle">${esc(p.name)}</span></span><span class="cap">${esc(capFirst(p.status))}</span>${AOS.CHEV}</button>`).join('') : ''}`
    : `<div class="lrow ic"><span class="tile">${I.archive}</span><span class="rbody"><span class="rtitle">Finished</span><span class="rmeta"><span class="ell">A project you mark done moves here.</span></span></span></div>`}</div>`;
  // Redrawn on every change: an unchanged list keeps its nodes (and a pressed card its press).
  if (el._html === html) return;
  el._html = html;
  el.innerHTML = html;
}
/** The old Projects tab page (kept for anything that still draws it). */
export function renderProjectsTab(el) {
  const all = AOS.data().projects;
  const live = AOS.liveProjects();
  const finished = all.filter((p) => ['done', 'archived', 'dropped'].includes(p.status));
  const openIdeas = W.ideas.filter((i) => (i.status ?? 'open') === 'open');
  const inbox = openIdeas.filter((i) => !i.project).length;
  // Code = chats (jobs) and terminals together; the terminal list is kept fresh by code.js.
  const terms = W.terms ?? [];
  const agentTerm = (t) => t.kind === 'claude' || t.kind === 'codex';
  const working = W.jobs.filter(isActive).length + terms.filter((t) => agentTerm(t) && t.status === 'running').length;
  const needs = W.jobs.filter((j) => j.status === 'needs_input').length + terms.filter((t) => t.status === 'needs_input').length;
  const openTerms = terms.filter((t) => t.status !== 'exited').length;
  const row = (p) => {
    const t = openTasks(p.slug).length, i = ideasOf(p.slug).length, jl = jobsOf(p.slug).filter(isActive);
    const sub = [t ? AOS.plural(t, 'task') : null, i ? AOS.plural(i, 'idea') : null, p.status === 'paused' ? 'Paused' : null, p.area ? AOS.areaShort(p.area) : null].filter(Boolean).join(' · ') || 'Nothing open';
    return `<button class="area-row pj-row" data-project="${esc(p.slug)}">${projIcon(p)}<span class="ar-text"><span class="ar-name">${esc(p.name)}</span><span class="ar-sub">${esc(sub)}</span></span>${jl.length ? `<span class="live-dot${jl.some((j) => j.status === 'needs_input') ? ' needs' : ''}" aria-label="${AOS.plural(jl.length, 'job')} working"></span>` : ''}${AOS.CHEV}</button>`;
  };
  el.innerHTML = `<h1 class="large-title">Projects</h1>
<div class="area-list work-top">
  <button class="area-row" data-work-open="ideas"><span class="area-icon mod-icon">${BULB}</span><span class="ar-text"><span class="ar-name">Ideas</span><span class="ar-sub">${openIdeas.length ? `${openIdeas.length} open${inbox ? ` · ${inbox} in the inbox` : ''}` : 'Drop one with +'}</span></span>${AOS.CHEV}</button>
  <button class="area-row" data-open-code><span class="area-icon mod-icon">${TERM}</span><span class="ar-text"><span class="ar-name">Code</span><span class="ar-sub">${needs ? `<b class="needs">${needs} need${needs === 1 ? 's' : ''} you</b> · ` : ''}${working ? `${working} working` : W.jobs.length || openTerms ? [W.jobs.length ? AOS.plural(W.jobs.length, 'chat') : null, openTerms ? AOS.plural(openTerms, 'terminal') : null].filter(Boolean).join(' · ') : 'Claude, Codex and terminals on your PC'}</span></span>${working || needs ? `<span class="live-dot${needs ? ' needs' : ''}"></span>` : ''}${AOS.CHEV}</button>
</div>
<h3 class="sec-label">Projects<span class="sec-count">${live.length}</span></h3>
${live.length ? `<div class="area-list pj-list">${live.map(row).join('')}</div>` : '<p class="empty-line">No projects yet.</p>'}
<button class="add-row" data-new-project>${AOS.PLUS}New project</button>
${finished.length ? `<button class="text-btn pj-more" data-toggle-finished>${showFinished ? 'Hide' : 'Show'} ${AOS.plural(finished.length, 'finished project')}</button>${showFinished ? `<div class="area-list pj-list">${finished.map(row).join('')}</div>` : ''}` : ''}`;
}

// ---------- Project page ----------
const projectPages = new Set();
function renderProjectPage(box, slug, el) {
  const S = { slug, box, el, select: null };
  projectPages.add(S);
  box.classList.add('project-page');
  // its mark beside its name, what it is, where it lives, then its one action; then its jobs, tasks, ideas and sessions.
  // The idea field sits outside the redrawn parts, so what is being typed keeps its focus.
  box.innerHTML = `<div class="pj-hero"></div>
<section class="pj-sec" data-sec="jobs"></section>
<section class="pj-sec" data-sec="tasks"></section>
<section class="pj-sec" data-sec="ideas"><div class="sh"><h2>Ideas</h2><span class="sh-count num"></span></div>
${ideaFieldHTML(`pjIdea-${slug}`, slug, 'Add an idea')}
<div class="sec-body"></div></section>
<section class="pj-sec" data-sec="sessions"></section>`;
  draw(S);
  loadProject(slug).then(() => draw(S));
  const mo = new MutationObserver(() => { if (!el.isConnected) { projectPages.delete(S); mo.disconnect(); } });
  mo.observe(el.parentNode, { childList: true });
}
function draw(S) {
  const p = projectBySlug(S.slug);
  const title = S.el.querySelector('.nav-title');
  if (title) title.textContent = p?.name ?? S.slug;
  const right = S.el.querySelector('.navbar > span:last-child');
  if (right && !right.firstChild) right.outerHTML = `<button class="nav-pill" data-edit-project="${esc(S.slug)}">Edit</button>`;
  const set = (sel, html) => { const n = S.box.querySelector(sel); if (n && n._html !== html) { n.innerHTML = html; n._html = html; } };
  if (!p) { set('.pj-hero', '<p class="empty-line">This project isn’t on this phone yet.</p>'); return; }
  const areaName = p.area ? AOS.areaShort(p.area) : 'No area';
  const status = p.status === 'active' ? 'Active' : capFirst(p.status ?? '');
  set('.pj-hero', `<div class="jp-hero" style="--c:${pcolor(p)}"><div class="jph-top">${pmark(p, ' big')}<div class="jph-t"><h1 class="title1">${esc(p.name)}</h1><p class="sub jp-area"><i class="dot" style="--c:${pcolor(p)}"></i>${esc([areaName, status].filter(Boolean).join(' · '))}</p></div></div>
${p.description ? `<p class="foot jph-desc">${esc(p.description)}</p>` : ''}
${p.folder ? `<p class="mono jp-folder">${I.folder}<span>${esc(p.folder)}</span></p>` : `<button type="button" class="text-btn jp-nofolder" data-edit-project="${esc(S.slug)}">Set a folder so jobs and sessions run there</button>`}
${AOS.owner && AOS.real ? `<button type="button" class="btn primary block jp-go" data-new-job="${esc(S.slug)}" style="--c:var(--jobs-fill)">${I.claude}Start a job here</button>` : ''}</div>`);

  // Jobs: what is live as cards, each with its state; the rest fold behind one row
  const jobs = jobsOf(S.slug).sort(liveFirst);
  const live = (j) => isActive(j) || ['needs_input', 'idle', 'failed'].includes(j.status) || (j.review && laneOf(j) !== 'archived');
  const active = jobs.filter(live), rest = jobs.filter((j) => !live(j));
  const restShown = S.allJobs ? rest.slice(0, 40) : [];
  set('[data-sec="jobs"]', `<div class="sh"><h2>Jobs</h2><span class="sh-count num">${jobs.length || ''}</span></div>
${jobs.length ? `<div class="group jgroup">${active.map((j) => jobCardHTML(j, { status: true })).join('')}${restShown.map((j) => jobSmallHTML(j, { status: true })).join('')}${rest.length ? `<button type="button" class="lrow jmore" data-pj-jobs aria-expanded="${!!S.allJobs}"><span class="rbody">${S.allJobs ? 'Show less' : `${rest.length} earlier ${rest.length === 1 ? 'job' : 'jobs'}`}</span>${S.allJobs ? I.chevU : I.chevD}</button>` : ''}</div>`
    : `<div class="group"><div class="lrow jempty-s"><span class="rbody"><span class="rmeta wrap">No jobs yet. Start one here, from an idea or from a task.</span></span></div></div>`}`);

  // Tasks
  const tasks = openTasks(S.slug).sort((a, b) => (a.status === 'doing' ? -1 : 0) - (b.status === 'doing' ? -1 : 0) || (a.due ?? '9').localeCompare(b.due ?? '9'));
  const sel = S.select;
  set('[data-sec="tasks"]', `<div class="sh"><h2>Tasks</h2><span class="sh-count num">${tasks.length || ''}</span>${tasks.length ? `<button type="button" class="sh-act" data-select-tasks>${sel ? 'Cancel' : 'Select'}</button>` : ''}</div>
${sel
    ? `<div class="group jp-sel">${tasks.map((t) => `<button type="button" class="lrow cn-task${sel.has(t.id) ? ' on' : ''}" role="checkbox" aria-checked="${sel.has(t.id)}" data-sel-task="${esc(t.id)}"><i class="dot" style="--c:${AOS.color(t.area)}"></i><span class="rbody"><span class="rtitle">${esc(t.title)}</span><span class="rmeta"><span>${esc(t.status === 'doing' ? 'In progress' : t.due ? `Due ${AOS.dayLabel(t.due)}` : t.status === 'inbox' ? 'Inbox' : 'No date')}</span></span></span><span class="cn-check" aria-hidden="true">${I.check}</span></button>`).join('')}</div>`
    : `<div class="group jp-tasks">${tasks.length ? `<div class="task-list">${tasks.map((t) => AOS.rowHTML(t, false)).join('')}</div>` : ''}<button type="button" class="lrow jadd" data-add-task="${esc(S.slug)}"><span class="rbody"><span class="rtitle">${tasks.length ? 'Add a task' : 'No open tasks. Add one'}</span></span></button></div>`}`);
  let bar = S.el.querySelector('.select-bar');
  if (sel) {
    if (!bar) { bar = document.createElement('div'); bar.className = 'select-bar glass'; S.el.appendChild(bar); }
    const html = `<button class="act primary" data-start-selected style="--c:var(--jobs-fill)" ${sel.size ? '' : 'disabled'}>${sel.size ? `Start a job with ${AOS.plural(sel.size, 'task')}` : 'Pick tasks for one job'}</button>`;
    if (bar._html !== html) { bar.innerHTML = html; bar._html = html; }
  } else bar?.remove();

  // Ideas (the field above stays put)
  const ideas = ideasOf(S.slug);
  const isec = S.box.querySelector('[data-sec="ideas"]');
  isec.querySelector('.sh-count').textContent = ideas.length || '';
  const ib = ideas.length ? `<div class="group jideas-g">${ideas.map((i) => ideaRowHTML(i, { project: p })).join('')}</div>` : '';
  const body = isec.querySelector('.sec-body');
  if (body._html !== ib) { body.innerHTML = ib; body._html = ib; }

  // Sessions
  const info = W.projects.get(S.slug);
  const sessions = info?.sessions ?? null;
  set('[data-sec="sessions"]', `<div class="sh"><h2>Sessions</h2><span class="sh-count num">${sessions?.length || ''}</span></div>
${sessions == null ? `<p class="quiet">${esc(info?.failed ?? 'Loading sessions from your PC…')}</p>` : sessions.length ? `<div class="group">${sessions.slice(0, 15).map(sessionRowHTML).join('')}</div>` : `<div class="group"><div class="lrow jempty-s"><span class="rbody"><span class="rmeta wrap">${p.folder ? `No Claude or Codex sessions in ${esc(folderName(p.folder))} yet.` : 'Sessions show here once the project has a folder.'}</span></span></div></div>`}`);
}
/** The idea field: a bulb, the input, the mic; Return saves it into that project (or the Ideas inbox). */
function ideaFieldHTML(id, slug, placeholder) {
  return `<form class="jidea-f" data-add-idea="${esc(slug ?? '')}" autocomplete="off"><label class="ifield">${I.bulb}<input id="${esc(id)}" placeholder="${esc(placeholder)}" enterkeyhint="done" aria-label="${esc(placeholder)}" />${voice.micButtonHTML(`data-mic-for="${esc(id)}" data-purpose="idea"`)}</label></form><div class="rec-slot" data-rec-for="${esc(id)}"></div>`;
}

// ---------- All ideas (the Jobs tab's Ideas segment, and its own page), all jobs ----------
function renderIdeasPage(box, _id, el) {
  el.querySelector('.nav-title').textContent = 'Ideas';
  mountIdeas(box, { title: true });
}
/** The ideas inbox and each project's ideas, with the drop-an-idea field on top; redraws itself on changes. */
export function mountIdeas(box, { title = false } = {}) {
  box.classList.add('ideas-page');
  box.innerHTML = `${title ? '<h1 class="large-title">Ideas</h1>' : ''}
${ideaFieldHTML('ideaInboxIn', '', 'Drop an idea')}
<div class="ideas-body"></div>`;
  const draw = () => {
    const open = W.ideas.filter((i) => (i.status ?? 'open') === 'open');
    const inbox = open.filter((i) => !i.project);
    const groups = new Map();
    for (const i of open.filter((x) => x.project)) { if (!groups.has(i.project)) groups.set(i.project, []); groups.get(i.project).push(i); }
    const head = (label, n, slug = null, c = '') => `<div class="sh jidea-h">${slug ? `<h2><button type="button" class="jidea-pj" data-project="${esc(slug)}"><i class="dot" style="--c:${c}"></i>${esc(label)}</button></h2>` : `<h2>${esc(label)}</h2>`}<span class="sh-count num">${n || ''}</span></div>`;
    const html = `${inbox.length ? `${head('Inbox', inbox.length)}<div class="group jideas-g">${inbox.map((i) => ideaRowHTML(i)).join('')}</div>` : ''}
${[...groups.entries()].map(([slug, list]) => { const p = projectBySlug(slug); return `${head(p?.name ?? slug, list.length, slug, p ? pcolor(p) : 'var(--ink-3)')}<div class="group jideas-g">${list.map((i) => ideaRowHTML(i, { project: p })).join('')}</div>`; }).join('')}
${open.length ? '' : `<div class="group jideas-empty"><div class="lrow ic"><span class="tile">${I.bulb}</span><span class="rbody"><span class="rtitle">No ideas waiting</span><span class="rmeta"><span class="ell">Drop one above, or say it.</span></span></span></div></div>`}`;
    const b = $('.ideas-body', box);
    if (b._html !== html) { b.innerHTML = html; b._html = html; }
  };
  draw();
  box._draw = draw;
  loadIdeas();
}
function renderJobsPage(box, _id, el) {
  box.classList.add('jobs-page');
  el.querySelector('.nav-title').textContent = 'Jobs';
  const draw = () => {
    const live = W.jobs.filter(isLive).sort(liveFirst), rest = W.jobs.filter((j) => !isLive(j)).sort(liveFirst);
    box.innerHTML = `<h1 class="large-title">Jobs</h1><p class="tab-intro">Claude Code and Codex sessions on your PC, one per job.</p>
<h3 class="sec-label">Live<span class="sec-count">${live.length || ''}</span>${AOS.owner ? '<button class="sec-act" data-new-job="">Start one</button>' : ''}</h3>
${live.length ? `<div class="work-list">${live.map(jobRowHTML).join('')}</div>` : '<p class="quiet">Nothing running.</p>'}
${rest.length ? `<h3 class="sec-label">Earlier<span class="sec-count">${rest.length}</span></h3><div class="work-list">${rest.slice(0, 40).map(jobRowHTML).join('')}</div>` : ''}`;
  };
  draw();
  box._draw = draw;
  loadJobs();
}

// Redraw open work pages when ideas, jobs or tasks change. The inline idea fields live outside the redrawn parts.
onChange(() => {
  for (const S of projectPages) draw(S);
  for (const box of document.querySelectorAll('.ideas-page, .jobs-page')) box._draw?.();
  AOS.renderTab('jobs');
  AOS.renderTasks();
});

AOS.detail('project', { render: renderProjectPage });
AOS.detail('ideas', { render: renderIdeasPage });
AOS.detail('jobs', { render: renderJobsPage });

// ---------- Clicks ----------
document.addEventListener('click', (e) => {
  const t = e.target;
  const wo = t.closest('[data-work-open]');
  if (wo) { AOS.push(wo.dataset.workOpen, 'all'); return; }
  const pj = t.closest('[data-project]');
  if (pj && !t.closest('#capProjects')) { openProject(pj.dataset.project); return; }
  if (t.closest('[data-new-project]')) { openProjectSheet(); return; }
  const ed = t.closest('[data-edit-project]');
  if (ed) { openProjectSheet(ed.dataset.editProject); return; }
  if (t.closest('[data-toggle-finished]')) { showFinished = !showFinished; AOS.renderTab('jobs'); return; }
  const oi = t.closest('[data-open-idea]');
  if (oi) { openIdea(oi.dataset.openIdea); return; }
  // an idea's two ways out, right on its row: a task now, or the job sheet with the idea in it
  const it = t.closest('[data-idea-task]');
  if (it) { if (it.disabled) return; it.disabled = true; ideaToTask(it.dataset.ideaTask).then((ok) => { if (!ok) it.disabled = false; }); return; }
  const ij = t.closest('[data-idea-job]');
  if (ij) { openJobSheet({ ideaId: ij.dataset.ideaJob }); return; }
  const oj = t.closest('[data-open-job]');
  // an ask's own buttons (Allow, Deny, Skip) answer it where it is; board.js handles them
  if (oj && !t.closest('#ideaSheet, #itemSheet, [data-ask]')) { openJob(oj.dataset.openJob); return; }
  const nj = t.closest('[data-new-job]');
  if (nj) { openJobSheet({ project: nj.dataset.newJob || null }); return; }
  const at = t.closest('[data-add-task]');
  if (at) { AOS.openCapture({ type: 'task', project: at.dataset.addTask }); return; }
  const sess = t.closest('[data-session]');
  if (sess) { AOS.toast('Opened on your PC. Sessions started as jobs open here'); return; }
  const page = t.closest('.page.detail[data-kind="project"]');
  const S = page && [...projectPages].find((x) => x.el === page);
  if (!S) return;
  if (t.closest('[data-pj-jobs]')) { S.allJobs = !S.allJobs; AOS.haptic('selection'); draw(S); return; }
  if (t.closest('[data-select-tasks]')) { S.select = S.select ? null : new Set(); AOS.haptic('selection'); draw(S); return; }
  const st = t.closest('[data-sel-task]');
  if (st) { const id = st.dataset.selTask; if (S.select.has(id)) S.select.delete(id); else S.select.add(id); AOS.haptic('selection'); draw(S); return; }
  if (t.closest('[data-start-selected]') && S.select?.size) {
    const ids = [...S.select].filter((id) => /^t\d+$/.test(id));
    if (ids.length < S.select.size) { AOS.toast('Some tasks are still saving. Try again in a second'); AOS.sync(); return; }
    S.select = null;
    draw(S);
    openJobSheet({ taskIds: ids, project: S.slug });
  }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-add-idea]');
  if (!f) return;
  e.preventDefault();
  const input = f.querySelector('input');
  const text = input.value.trim();
  if (!text) return;
  if (voice.busy(input)) { AOS.toast('Finish the recording first'); return; }
  input.value = '';
  AOS.haptic('success');
  await createIdea({ text, project: f.dataset.addIdea || null, source: 'app', recordingId: voice.lastId(input) });
});

export function openProject(slug) {
  const ui = AOS.ui();
  if (!ui.stack[ui.tab]) AOS.setTab('projects');
  const top = AOS.topDetail();
  if (top?.dataset.kind === 'project' && top.dataset.id === slug) return;
  AOS.touchProject(slug);
  AOS.push('project', slug);
}

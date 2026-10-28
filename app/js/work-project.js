// Work · a project: what it is, where its repo stands, its jobs, its tasks (each one hand-off-able to an agent),
// its ideas, its scripts, its sessions and how busy it has been. The one place to start work on it. Real mode reads
// the PC (GET /projects/:slug for tasks, ideas, jobs and sessions; the Work module or the copy check for the repo;
// the Builders and the open copies); ?data=demo keeps the prototype's story.
import { $, $$, esc, push, openSheet, closeSheet, toast, on, haptic, ring } from './core.js';
import { I } from './icons.js';
import { BUILDERS, JOBS } from './data.js';
import { SCRIPTS } from './work-data.js';
import { W, WI, project, area, job, projJobs, projTasks, projIdeas, repoOf, taskRow, agentName, changed, REAL, markFor, plural } from './work-ui.js';
import { jobCard, compactRow, isLanding, activity, ideaRow, wireIdeaField, needsCard } from './work-cards.js';
import { newJob, projectSheet } from './work-new.js';
import { openTerminal, openBuilder, termSessions } from './work-term.js';
import { api } from './bus.js';
import * as E from './work-engine.js';

const pmark = (p) => `<span class="p-ic big" style="--c:${p.color}" aria-hidden="true">${/\p{Extended_Pictographic}/u.test(p.icon) ? p.icon : `<b>${esc(p.icon)}</b>`}</span>`;
const pages = new Set();

export function openProject(slug, back = 'Work') {
  const p = project(slug); if (!p) { toast('That project isn’t on this phone yet'); return; }
  const top = $('#stack')?.lastElementChild;
  if (top?.classList.contains('wp-page') && top.dataset.project === slug) return;
  const st = { all: false, slug };
  push({
    title: p.name, back,
    right: `<button class="gbtn chrome icon" data-act="terminal" data-p="${slug}" aria-label="Terminal">${I.term}</button><button class="gbtn chrome icon" data-act="wp-menu" data-id="${slug}" aria-label="Project menu">${I.dots}</button>`,
    onPop: () => pages.delete(st),
    render(sc, page) {
      page.classList.add('jpage', 'wp-page');
      page.dataset.project = slug;
      const draw = () => {
        const pp = project(slug); if (!pp) return;
        const y = sc.scrollTop;
        const keep = $('.jidea-in', sc)?.value ?? '';
        const focus = document.activeElement?.classList?.contains('jidea-in');
        sc.innerHTML = html(pp, st);
        wireIdeaField(sc, slug);
        if (keep) { const inp = $('.jidea-in', sc); inp.value = keep; if (focus) inp.focus(); }
        sc.scrollTop = y;
      };
      page._redraw = draw; page._st = st;
      st.page = page;
      draw();
    },
  });
  pages.add(st);
  if (REAL) {
    E.loadProject(slug).then(() => redraw(slug));
    E.loadRepo(slug, { force: true, check: true }).then(() => redraw(slug));
    E.loadBuilders(); E.loadCode();
  }
}
const redraw = (slug) => { for (const st of pages) if (!slug || st.slug === slug) st.page?._redraw?.(); };
document.addEventListener('work:change', () => redraw());
document.addEventListener('data-changed', (e) => { if (['jobs', 'server', 'synced', 'local', 'rename'].includes(e.detail?.why)) redraw(); });
document.addEventListener('work:repo', (e) => redraw(e.detail?.slug));
document.addEventListener('work:code', () => redraw());

function html(p, st) {
  const a = area(p.area); const r = repoOf(p.slug);
  const pj = projJobs(p.slug);
  const active = pj.filter((j) => ['needs', 'working', 'review'].includes(j.lane) || isLanding(j)), rest = pj.filter((j) => !active.includes(j));
  const order = { needs: 0, working: 1, review: 2 };
  active.sort((x, y) => (order[x.lane] ?? 3) - (order[y.lane] ?? 3) + (isLanding(x) ? .5 : 0) - (isLanding(y) ? .5 : 0));
  const pt = projTasks(p.slug), pi = projIdeas(p.slug);
  const b = REAL ? (E.builders.list ?? []).find((x) => x.key === p.slug) : BUILDERS.find((x) => x.project === p.slug);
  const copies = REAL ? E.code.worktrees.filter((w) => w.state === 'open' && w.project === p.slug) : pj.filter((j) => j.worktree && ['needs', 'working', 'review'].includes(j.lane));
  const terms = REAL ? E.code.terms.filter((t) => t.project === p.slug && t.status !== 'exited') : termSessions(p.slug);
  const scripts = REAL ? (r.scripts ?? []).map((s) => [s.name, s.cmd]) : SCRIPTS[p.slug];
  const info = REAL ? E.projectInfo(p.slug) : null;
  return `
    <div class="proj-hero" style="--c:${p.color}">
      <div class="ph-top">${pmark(p)}<div class="ph-t"><h1 class="title1">${esc(p.name)}</h1><p class="sub p-area"><i class="dot" style="--c:${a.color}"></i>${esc(a.name)}${active.length ? ` · ${plural(active.length, 'active job')}` : ' · Quiet'}${REAL && p.status && p.status !== 'active' ? ` · ${esc(p.status[0].toUpperCase() + p.status.slice(1))}` : ''}</p></div></div>
      ${p.desc ? `<p class="foot ph-desc">${esc(p.desc)}</p>` : ''}
      ${p.folder ? `<p class="mono p-folder">${I.folder}<span>${esc(p.folder)}</span></p>` : REAL ? `<button class="text-btn wp-nofolder" data-act="wp-edit" data-id="${esc(p.slug)}">${I.folder}Set a folder so jobs and sessions run there</button>` : ''}
      <div class="wp-acts"><button class="btn primary" data-act="wp-new" data-id="${p.slug}" style="--c:var(--jobs-fill)">${I.plus}New job</button><button class="btn" data-act="wp-task" data-id="${p.slug}">${I.check}Add a task</button></div>
    </div>

    ${REAL ? realRepo(p, r, b, copies) : `<div class="sh"><h2>Repository</h2></div>
    <div class="group wp-repo">
      <div class="row ic wp-branch"><button class="wp-branch-b" data-act="wp-branches" data-id="${p.slug}"><span class="tile">${I.branch}</span><span class="rbody"><span class="rtitle mono">${esc(r.branch)}</span><span class="rmeta"><span class="ell">${r.ahead ? `${r.ahead} ahead of origin` : 'Up to date'} · ${r.dirty?.length ? `${r.dirty.length} uncommitted` : 'clean'}</span></span></span></button>${r.dirty?.length ? `<button class="btn sm" data-act="wp-commit" data-id="${p.slug}">Commit</button>` : I.chevR}</div>
      ${r.commit ? `<div class="row ic"><span class="tile">${WI.commit}</span><span class="rbody"><span class="rtitle">${esc(r.commit[1])}</span><span class="rmeta"><span class="mono">${esc(r.commit[0])}</span><span>· ${esc(r.commit[2] === 'now' ? 'just now' : `${r.commit[2]} ago`)}</span></span></span></div>` : ''}
      ${r.pr ? `<button class="row ic" data-act="wp-pr" data-id="${p.slug}"><span class="tile">${WI.pr}</span><span class="rbody"><span class="rtitle">#${r.pr.n} ${esc(r.pr.title)}</span><span class="rmeta"><span class="wp-pr-st">Open</span><span>· checks ${esc(r.pr.checks)}</span></span></span>${I.chevR}</button>` : ''}
      ${b ? `<button class="row ic" data-act="builder" data-id="${b.id}"><span class="tile">${I.hammer}</span><span class="rbody"><span class="rtitle">${b.state === 'building' ? `Building ${esc(r.ship?.what ?? '')}` : 'Builder idle'}</span><span class="rmeta">${b.state === 'building' ? `<span class="mono">${esc(r.ship?.job ?? '')}</span><span>· build ${esc(r.ship?.build ?? '')} · about ${esc(r.ship?.eta ?? '')} left</span>` : `<span class="ell">${esc(b.last)}</span>`}</span></span>${b.state === 'building' ? '<span class="spin" style="--c:var(--jobs)" role="img" aria-label="Building"></span>' : I.chevR}</button>` : ''}
      ${copies.length ? `<button class="row ic" data-act="wp-copies" data-id="${p.slug}"><span class="tile">${WI.copies}</span><span class="rbody"><span class="rtitle">${copies.length} separate cop${copies.length === 1 ? 'y' : 'ies'}</span><span class="rmeta"><span class="mono ell">${copies.map((j) => `feat/${j.id}`).join(' · ')}</span></span></span>${I.chevR}</button>` : ''}
      ${r.waves ? `<button class="row ic" data-act="w-task" data-id="${r.waves.task}"><span class="tile">${WI.merge}</span><span class="rbody"><span class="rtitle">${esc(r.waves.label)}</span><span class="rmeta"><span class="late">2 days late</span><span>· a task of yours</span></span></span>${I.chevR}</button>` : ''}
      ${r.client ? `<button class="row ic" data-act="client-open" data-id="${r.client}"><span class="tile">${I.clients}</span><span class="rbody"><span class="rtitle">For Morgan & Co.</span><span class="rmeta">Dad's store runs the pilot</span></span>${I.chevR}</button>` : ''}
      ${p.slug === 'content-os' ? `<button class="row ic" data-act="wp-content"><span class="tile">${I.content}</span><span class="rbody"><span class="rtitle">Open Content OS</span><span class="rmeta">Its shoot pack, edits and posts</span></span>${I.chevR}</button>` : ''}
    </div>`}

    <div class="sh"><h2>Jobs</h2><span class="sh-count">${pj.length || ''}</span></div>
    ${active.filter((j) => j.lane === 'needs').length ? `<div class="jneeds">${active.filter((j) => j.lane === 'needs').map((j) => needsCard(j)).join('')}</div>` : ''}
    ${active.filter((j) => j.lane !== 'needs').length || rest.length ? `<div class="group jgroup${active.some((j) => j.lane === 'needs') ? ' wp-after' : ''}">${active.filter((j) => j.lane !== 'needs').map((j) => jobCard(j)).join('')}${st.all ? rest.slice(0, 40).map((j) => compactRow(j)).join('') : ''}
      ${rest.length ? `<button class="row jmore" data-act="wp-all" aria-expanded="${st.all}"><span class="rbody">${st.all ? 'Show less' : `${rest.length} finished job${rest.length === 1 ? '' : 's'}`}</span>${st.all ? I.chevU : I.chevD}</button>` : ''}</div>` : ''}
    ${!pj.length ? `<div class="group"><button class="row ic jempty" data-act="wp-new" data-id="${p.slug}"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">No jobs yet</span><span class="rmeta">Start one, or hand it a task below.</span></span>${I.chevR}</button></div>` : ''}

    <div class="sh"><h2>Tasks</h2><span class="sh-count">${pt.length || ''}</span></div>
    <div class="group wp-tasks">${pt.map((t) => taskLine(t)).join('')}<button class="row jadd" data-act="wp-task" data-id="${p.slug}"><span class="rbody"><span class="rtitle">${pt.length ? 'Add a task' : 'No open tasks. Add one'}</span></span>${I.plus}</button></div>
    ${pt.some((t) => !t.job) ? '<p class="hint">Tap the agent beside a task to hand it to Claude or Codex. The job links back to the task.</p>' : ''}

    <div class="sh"><h2>Ideas</h2><span class="sh-count">${pi.length || ''}</span></div>
    <div class="pad"><div class="field">${I.bulb}<input class="jidea-in" placeholder="Add an idea to ${esc(p.name)}" aria-label="New idea" enterkeyhint="done" /></div></div>
    ${pi.length ? `<div class="group jideas-g">${pi.map((i) => ideaRow(i, p)).join('')}</div>` : ''}

    <div class="sh"><h2>Activity</h2></div>
    ${activity(p.slug, { big: true })}

    ${scripts?.length ? `<div class="sh"><h2>Scripts</h2><button class="sh-act" data-act="terminal" data-p="${p.slug}">${terms.length} terminal${terms.length === 1 ? '' : 's'}${I.chevR}</button></div>
    <div class="wt-scripts">${scripts.slice(0, 8).map(([n, cmd]) => `<button class="wt-script" data-act="wt-run" data-p="${p.slug}" data-cmd="${esc(REAL ? `bun run ${n}` : cmd)}" data-n="${esc(n)}"><b>${esc(n)}</b><span class="mono">${esc(cmd)}</span></button>`).join('')}</div>` : ''}

    ${REAL ? sessionsBlock(p, info) : ''}`;
}
// real: the branch, what is uncommitted, the last commits, the Builder, the open copies
function realRepo(p, r, b, copies) {
  if (!p.folder) return '';
  const known = r.known;
  const branchRow = `<div class="row ic wp-branch"><button class="wp-branch-b" data-act="wp-branches" data-id="${p.slug}"><span class="tile">${I.branch}</span><span class="rbody"><span class="rtitle mono">${esc(r.branch ?? (known && r.repo === false ? 'Not a git repo' : known ? 'Detached' : 'Reading the repo…'))}</span><span class="rmeta"><span class="ell">${!known ? 'On your PC' : r.repo === false ? 'Jobs work in the folder itself; no copies or merges' : [r.ahead ? `${r.ahead} ahead` : '', r.behind ? `${r.behind} behind` : '', r.full && !r.ahead && !r.behind ? 'Up to date with origin' : '', r.dirty?.length ? `${r.dirty.length} uncommitted` : 'clean'].filter(Boolean).join(' · ')}</span></span></span></button>${r.dirty?.length ? `<button class="btn sm" data-act="wp-commit" data-id="${p.slug}">Commit</button>` : I.chevR}</div>`;
  const commits = (r.commits ?? []).slice(0, 3).map(([sha, subject, , when]) => `<div class="row ic"><span class="tile">${WI.commit}</span><span class="rbody"><span class="rtitle">${esc(subject)}</span><span class="rmeta"><span class="mono">${esc(sha)}</span><span>· ${esc(when === 'now' ? 'just now' : `${when} ago`)}</span></span></span></div>`).join('');
  const cur = (b?.ships ?? []).find((s) => ['queued', 'sent', 'committed', 'building'].includes(s.state));
  const last = (b?.ships ?? []).find((s) => s.state === 'live' || s.state === 'failed');
  const builder = b ? `<button class="row ic" data-act="builder" data-id="${esc(b.key)}"><span class="tile">${I.hammer}</span><span class="rbody"><span class="rtitle">${cur ? `${esc({ queued: 'Queued', sent: 'With the Builder', committed: 'Committed', building: 'Building' }[cur.state] ?? cur.state)}: ${esc(cur.title)}` : 'Builder idle'}</span><span class="rmeta"><span class="ell">${cur ? esc(cur.jobId) : last ? `Last ship ${last.state === 'live' ? 'went live' : 'failed'} ${esc(E.clock.ago(last.doneAt ?? last.at))} ago` : 'Ships what this project’s jobs hand over'}</span></span></span>${cur ? `<span class="wk-bmk">${markFor(b.job ?? 'claude', 18, { state: 'working' })}</span>` : I.chevR}</button>` : '';
  const copyRow = copies.length ? `<button class="row ic" data-act="wp-copies" data-id="${p.slug}"><span class="tile">${WI.copies}</span><span class="rbody"><span class="rtitle">${plural(copies.length, 'separate copy', 'separate copies')}</span><span class="rmeta"><span class="mono ell">${copies.map((w) => esc(w.label ?? String(w.branch).replace(/^aos\//, ''))).join(' · ')}</span></span></span>${I.chevR}</button>` : '';
  return `<div class="sh"><h2>Repository</h2></div><div class="group wp-repo">${branchRow}${commits}${builder}${copyRow}${p.slug === 'content-os' ? `<button class="row ic" data-act="wp-content"><span class="tile">${I.content}</span><span class="rbody"><span class="rtitle">Open Content OS</span><span class="rmeta">Its shoot pack, edits and posts</span></span>${I.chevR}</button>` : ''}</div>`;
}
// the Claude and Codex sessions that ran in its folder (some started as jobs: those open here)
function sessionsBlock(p, info) {
  if (!p.folder) return '';
  const ss = info?.sessions;
  if (!ss) return `<div class="sh"><h2>Sessions</h2></div><p class="hint">${esc(info?.failed ?? 'Reading the sessions on your PC…')}</p>`;
  if (!ss.length) return '';
  return `<div class="sh"><h2>Sessions</h2><span class="sh-count">${ss.length}</span></div><div class="group">${ss.slice(0, 8).map((s) => {
    const a = s.tool === 'codex' ? 'codex' : 'claude';
    const title = (s.title && s.title !== '(untitled)' ? s.title : null) ?? 'Untitled session';
    return `<button class="row ic" ${s.jobId ? `data-act="job" data-id="${esc(s.jobId)}"` : 'data-act="wp-session"'}><span class="tile">${markFor(a, 20, { state: s.live ? 'working' : 'idle' })}</span><span class="rbody"><span class="rtitle">${esc(title)}</span><span class="rmeta"><span>${s.live ? 'Live · ' : ''}${esc(a === 'codex' ? 'Codex' : 'Claude')}</span><span>· ${esc(E.clock.ago(s.updatedAt))}</span>${s.jobId ? '<span>· a job</span>' : ''}</span></span>${s.jobId ? I.chevR : ''}</button>`;
  }).join('')}</div>`;
}
// a task with its way to an agent: the job it already has, or the button that makes one
function taskLine(t) {
  const j = t.job && job(t.job);
  const right = j ? `<button class="wp-hand has-job" data-act="job" data-id="${j.id}" aria-label="Open ${esc(j.title)}: ${j.progress ? `${j.progress.done} of ${j.progress.total} steps` : esc(j.lane)}">${j.progress ? ring(j.progress.done / j.progress.total, j.lane === 'needs' ? 'needs' : 'jobs', 18, 2.5) : REAL ? markFor(j, 16) : I[j.agent]}<span class="num">${j.progress ? `${j.progress.done}/${j.progress.total}` : j.id}</span></button>`
    : `<button class="wp-hand" data-act="w-hand" data-id="${t.id}" data-a="${REAL ? E.lastEngine() : 'codex'}" aria-label="Hand to an agent: ${esc(t.title)}">${REAL ? markFor(E.lastEngine(), 16) : I.codex}<span>Hand off</span></button>`;
  return `<div class="wp-task">${taskRow(t)}${right}</div>`;
}

on('wp-new', (el) => newJob({ project: el.dataset.id }));
on('wp-task', (el) => api.addTask({ project: el.dataset.id, aspect: 'mission' }));
on('wp-all', (el) => { const pg = el.closest('.page'); pg._st.all = !pg._st.all; haptic(5); pg._redraw(); });
on('wp-content', () => api.openContent('pack'));
on('wp-pr', (el) => { const r = repoOf(el.dataset.id); toast(`PR #${r.pr.n} opens on GitHub`); });
on('wp-session', () => toast('That session runs on your PC. Sessions started as jobs open here'));
on('wp-commit', (el) => {
  const r = repoOf(el.dataset.id); const p = project(el.dataset.id);
  if (REAL) {
    // the PC has no commit route for a folder: an agent commits it, with the message it writes (you start it)
    const files = (r.dirty ?? []).filter(Boolean);
    newJob({ project: p.slug, where: 'folder', title: `Commit the uncommitted changes in ${p.name}`, prompt: `Commit the uncommitted changes in this folder${files.length ? ` (${files.slice(0, 20).join(', ')}${files.length > 20 ? ', …' : ''})` : ''} with a short, clear message. Don't change any file. Then say what you committed.` });
    return;
  }
  openSheet({ title: 'Commit', sub: `${esc(p.name)} · on ${esc(r.branch)}`, body: `<div class="pad"><div class="group wp-dirty">${r.dirty.map((f) => `<div class="row"><span class="fk fk-M">M</span><span class="rbody"><span class="rtitle mono">${esc(f)}</span></span></div>`).join('')}</div>
    <p class="wr-lbl">Message</p><div class="wr-msg"><input class="wr-msg-t" value="Draft the three Atlas ERP tiers" aria-label="Commit title" /></div>
    <p class="wr-ai">${I.sparkle}<span>Written from what changed.</span></p>
    <button class="btn primary block" style="--c:var(--jobs-fill)" data-act="wp-commit-go" data-id="${p.slug}">Commit ${r.dirty.length} files</button></div>` });
});
on('wp-commit-go', (el) => { const r = repoOf(el.dataset.id); const was = r.dirty; r.dirty = []; r.commit = ['c09d2aa', 'Draft the three Atlas ERP tiers', 'now']; closeSheet(); haptic(14); changed(); toast('Committed to main', () => { r.dirty = was; changed(); }); });
on('wp-branches', (el) => {
  const slug = el.dataset.id; const r = repoOf(slug);
  if (REAL) {
    const ws = E.code.worktrees.filter((w) => w.state === 'open' && w.project === slug);
    openSheet({ title: 'Branches', sub: `${esc(project(slug).name)}${r.branch ? ` · you are on ${esc(r.branch)}` : ''}`, body: `<div class="group">
      ${r.branch ? `<div class="row ic"><span class="tile">${I.branch}</span><span class="rbody"><span class="rtitle mono">${esc(r.branch)}</span><span class="rmeta">Yours${r.ahead || r.behind ? ` · ${[r.ahead ? `${r.ahead} ahead` : '', r.behind ? `${r.behind} behind` : ''].filter(Boolean).join(', ')}` : ''}</span></span><span class="jpick">${I.check}</span></div>` : ''}
      ${ws.map((w) => `<button class="row ic" data-act="wp-copy" data-id="${esc(w.id)}"><span class="tile">${I.branch}</span><span class="rbody"><span class="rtitle mono">${esc(String(w.branch).replace(/^aos\//, ''))}</span><span class="rmeta"><span class="ell">${esc(w.title)}${w.files?.length ? ` · ${plural(w.files.length, 'file')}` : ''}</span></span></span>${I.chevR}</button>`).join('')}
      ${(r.dirty ?? []).filter(Boolean).slice(0, 12).map((f) => `<div class="row"><span class="fk fk-M">M</span><span class="rbody"><span class="rtitle mono">${esc(f)}</span><span class="rmeta">Uncommitted, in your folder</span></span></div>`).join('')}</div>
      <p class="hint">Each job that works in its own copy gets a branch. Your branch stays as you left it.</p>` });
    return;
  }
  const pj = projJobs(slug).filter((j) => j.worktree && ['needs', 'working', 'review'].includes(j.lane));
  openSheet({ title: 'Branches', sub: `${esc(project(slug).name)} · you are on ${esc(r.branch)}`, body: `<div class="group">
    <div class="row ic"><span class="tile">${I.branch}</span><span class="rbody"><span class="rtitle mono">${esc(r.branch)}</span><span class="rmeta">Yours · ${r.ahead ? `${r.ahead} ahead of origin` : 'up to date'}</span></span><span class="jpick">${I.check}</span></div>
    ${pj.map((j) => `<button class="row ic" data-act="jcopy" data-id="${j.id}"><span class="tile">${I[j.agent]}</span><span class="rbody"><span class="rtitle mono">feat/${j.id}</span><span class="rmeta"><span class="ell">${esc(j.title)}</span></span></span>${I.chevR}</button>`).join('')}</div>
    <p class="hint">Each job that works in its own copy gets a branch. Your branch stays as you left it.</p>` });
});
on('wp-copy', (el) => { closeSheet(); setTimeout(() => api.openCopy(el.dataset.id), 260); });
on('wp-copies', (el) => $('[data-act="wp-branches"]', el.closest('.page'))?.click());
on('wp-menu', (el) => {
  const p = project(el.dataset.id);
  openSheet({ title: esc(p.name), sub: esc(p.folder || 'No folder'), body: `<div class="group">
    <button class="row ic" data-act="wp-edit" data-id="${p.slug}"><span class="tile">${I.edit}</span><span class="rbody"><span class="rtitle">Edit project</span><span class="rmeta">Name, mark, area, folder, status</span></span></button>
    <button class="row ic" data-act="terminal" data-p="${p.slug}"><span class="tile">${I.term}</span><span class="rbody"><span class="rtitle">Terminals</span></span></button>
    ${REAL ? '' : `<button class="row ic" data-act="wp-pc" data-id="${p.slug}"><span class="tile">${WI.pc}</span><span class="rbody"><span class="rtitle">Open the folder on the PC</span></span></button>`}
    <button class="row ic" data-act="wp-ask" data-id="${p.slug}"><span class="tile">${I.sparkle}</span><span class="rbody"><span class="rtitle">Ask ${REAL ? 'your agent' : 'Wyn'} about ${esc(p.name)}</span></span></button></div>` });
});
on('wp-edit', (el) => { closeSheet(); setTimeout(() => projectSheet(project(el.dataset.id)), 260); });
on('wp-pc', () => { closeSheet(); toast('Opens in Explorer on your PC'); });
on('wp-ask', (el) => { closeSheet(); api.askAgent('', { about: `project:${el.dataset.id}` }); });
on('project', (el) => openProject(el.dataset.id, el.dataset.back || undefined));
export { openTerminal, openBuilder };

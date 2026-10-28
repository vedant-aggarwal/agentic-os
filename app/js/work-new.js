// Work · starting work: a new job (from a task, an idea, a client or nothing), the + menu, the night shift and the
// project sheet. A job started from a task links back to it (the PC moves the task to doing; the job shows the task
// and its goal). The night shift queues agent-ready tasks for 23:00, while he sleeps, on the plans he already pays
// for; the Work module on the PC starts them and reports at 07:00. Real mode starts real jobs (POST /jobs);
// ?data=demo keeps the prototype's story.
import { $, $$, esc, openSheet, closeSheet, toast, on, haptic, setTab } from './core.js';
import { I } from './icons.js';
import { JOBS, TASKS, PROJECTS, AREAS } from './data.js';
import { MODELS, EFFORT, ACCESS, WHERE, NIGHT, THREADS, LINKS } from './work-data.js';
import { W, WI, job, agentName, project, taskOf, goalOf, changed, pickMark, REAL, markFor, plural } from './work-ui.js';
import { openJob as openDemoJob } from './work-thread.js';
import { api } from './bus.js';
import * as E from './work-engine.js';
import * as SYNC from './svc/sync.js';

// what is left of each plan right now (demo only; the PC can't see the subscription's limits)
export const USAGE = {
  claude: { left: 0.38, line: '38% left · resets 19:00', resets: '19:00' },
  codex: { left: 0.71, line: '71% left this week', resets: 'Mon' },
};
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().split(/\s+/).filter((w) => !['the', 'a', 'an', 'to', 'of', 'and', 'in', 'on', 'for'].includes(w)).slice(0, 3).join('-') || 'new-job';
const titleOf = (t) => { const s = t.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, ''); return s.length > 52 ? `${s.slice(0, 50).replace(/\s\S*$/, '')}…` : s; };
const nextId = () => `j${Math.max(...JOBS.map((j) => Number(j.id.slice(1)) || 0)) + 1}`;
const clockNow = () => { const m = 17 * 60 + 40 + Math.floor((Date.now() - W.loaded) / 60000); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// ── the New job sheet ─────────────────────────────────────────────────
// prefill: { prompt, title, task, goal, project, agent, client: { slug, name } | slug, idea, from, where, folder, folders }
export function newJob(prefill = {}) {
  if (REAL) return newJobReal(prefill);
  const t = prefill.task ? taskOf(prefill.task) : null;
  const st = {
    prompt: prefill.prompt ?? prefill.title ?? t?.title ?? '',
    task: t?.id ?? null, goal: prefill.goal ?? t?.goal ?? null, client: prefill.client?.slug ?? prefill.client ?? null,
    project: prefill.project ?? prefill.client?.project ?? t?.project ?? 'agentic-os',
    agent: prefill.agent ?? 'claude', where: prefill.where ?? (W.set.wt ? 'copy' : 'folder'),
    model: null, effort: 'High', access: 'auto', plan: false,
  };
  if (!project(st.project)) st.project = 'agentic-os';
  st.model = MODELS[st.agent][0][0];
  openSheet({
    title: prefill.from ? 'Hand it on' : t ? 'Hand to an agent' : 'New job', sub: 'Claude or Codex works on it on your PC', large: true, cls: 'wn-sheet',
    body: (b) => { b._st = st; draw(b); },
  });
}
function draw(b) {
  const st = b._st; const t = st.task && taskOf(st.task); const g = st.goal && goalOf(st.goal);
  const branch = `aos/${slug(st.prompt || 'new job')}`;
  const agentCard = (a) => `<button class="wn-agent${st.agent === a ? ' on' : ''}${st.where === 'compare' ? ' both' : ''}" data-act="wn-agent" data-a="${a}" role="radio" aria-checked="${st.agent === a || st.where === 'compare'}">
      <span class="wn-a-top">${I[a]}<b>${agentName(a)}</b></span>
      <span class="wn-a-m">${esc(st.agent === a ? st.model : MODELS[a][0][0])}</span>
      <span class="wn-a-u"><span class="bar" style="--p:${Math.round(USAGE[a].left * 100)}%;--c:var(--jobs)"><i></i></span><span class="num">${esc(USAGE[a].line)}</span></span>
    </button>`;
  b.innerHTML = `<div class="pad wn">
    <div class="wn-prompt field"><textarea class="wn-in" rows="3" placeholder="What should it do? Say it like you would to a person." aria-label="What the job should do">${esc(st.prompt)}</textarea><button class="fbtn" data-act="wn-mic" aria-label="Say it">${I.mic}</button></div>
    ${t || g || st.client ? `<div class="wn-links">${t ? `<span class="jlink is-static">${I.check}<span class="ell">From the task: ${esc(t.title)}</span></span>` : ''}${g ? `<span class="jlink is-static">${I.target}<span class="ell">Moves: ${esc(g.title)}</span></span>` : ''}${st.client ? `<span class="jlink is-static">${I.clients}<span class="ell">For a client</span></span>` : ''}</div>` : ''}
    <p class="wr-lbl">Project</p>
    <div class="chips wn-projects" role="radiogroup">${PROJECTS.map((p) => `<button class="chip${p.slug === st.project ? ' on' : ''}" data-act="wn-proj" data-p="${p.slug}" role="radio" aria-checked="${p.slug === st.project}"><i class="dot" style="--c:${p.color}"></i>${esc(p.name)}</button>`).join('')}</div>
    <p class="wr-lbl">Who does it</p>
    <div class="wn-agents" role="radiogroup">${agentCard('claude')}${agentCard('codex')}</div>
    <p class="wr-lbl">Where it works</p>
    <div class="group wr-routes" role="radiogroup">${Object.entries(WHERE).map(([k, [tt, s]]) => `<button class="row wr-route${k === st.where ? ' on' : ''}" data-act="wn-where" data-k="${k}" role="radio" aria-checked="${k === st.where}"><span class="rbody"><span class="rtitle">${tt}</span><span class="rmeta"><span class="ell">${k === 'copy' ? `On <span class="mono">${esc(branch)}</span>. ${esc(s.split('. ')[1] ?? '')}` : esc(s)}</span></span></span><span class="o-r" aria-hidden="true"></span></button>`).join('')}</div>
    <div class="group wn-set">
      <button class="row" data-act="wn-model"><span class="rbody"><span class="rtitle">Model</span></span><span class="rend">${esc(st.where === 'compare' ? `${MODELS.claude[0][0]} and ${MODELS.codex[0][0]}` : st.model)}${I.chevR}</span></button>
      <button class="row" data-act="wn-effort"><span class="rbody"><span class="rtitle">Effort</span></span><span class="rend">${esc(st.effort)}${I.chevR}</span></button>
      <button class="row" data-act="wn-access"><span class="rbody"><span class="rtitle">Access</span></span><span class="rend">${esc(ACCESS[st.access][0])}${I.chevR}</span></button>
      <div class="row"><span class="rbody"><span class="rtitle">Plan first</span><span class="rmeta">Writes a plan and waits for your OK</span></span><button class="switch${st.plan ? ' on' : ''}" data-act="wn-plan" role="switch" aria-checked="${st.plan}" aria-label="Plan first"></button></div>
    </div>
    <button class="btn primary block wn-go" style="--c:var(--jobs-fill)" data-act="wn-go"${st.prompt.trim() ? '' : ' disabled'}>${st.where === 'compare' ? 'Start both' : `Start with ${agentName(st.agent)}`}</button>
    <button class="btn block wn-night" data-act="wn-tonight"${st.prompt.trim() ? '' : ' disabled'}>${WI.moon}Run it tonight at ${NIGHT.at}</button>
  </div>`;
  const ta = $('.wn-in', b);
  ta.addEventListener('input', () => { st.prompt = ta.value; const ok = !!ta.value.trim(); $$('.wn-go, .wn-night', b).forEach((x) => { x.disabled = !ok; }); const m = $('.wr-route[data-k="copy"] .rmeta .mono', b); if (m) m.textContent = `aos/${slug(ta.value || 'new job')}`; });
}
const sheetOf = (el) => el.closest('.sheet')?.querySelector('.sheet-body');
on('wn-proj', (el) => { const b = sheetOf(el); if (b._real) return; b._st.project = el.dataset.p; haptic(5); draw(b); });
on('wn-agent', (el) => { const b = sheetOf(el); if (b._real) return; const st = b._st; if (st.where === 'compare') st.where = 'copy'; st.agent = el.dataset.a; st.model = MODELS[st.agent][0][0]; haptic(6); draw(b); });
on('wn-where', (el) => { const b = sheetOf(el); if (b._real) return; b._st.where = el.dataset.k; haptic(5); draw(b); });
on('wn-plan', (el) => { const b = sheetOf(el); if (b._real) return; b._st.plan = !b._st.plan; haptic(6); draw(b); });
on('wn-mic', (el) => { const b = sheetOf(el); if (b._real) return; const ta = $('.wn-in', b); ta.value = ta.value || 'Pin Cabinet and Content at the top of More, and keep the order I set.'; b._st.prompt = ta.value; draw(b); toast('Heard you'); });
const pickSheet = (b, title, opts, cur, set, redraw = draw) => openSheet({ title, body: (x) => {
  x.innerHTML = `<div class="group">${opts.map(([v, s, label]) => `<button class="row" data-v="${esc(v)}"><span class="rbody"><span class="rtitle">${esc(label ?? v)}</span>${s ? `<span class="rmeta"><span class="ell">${esc(s)}</span></span>` : ''}</span>${v === cur ? pickMark : ''}</button>`).join('')}</div>`;
  x.addEventListener('click', (e) => { const r = e.target.closest('[data-v]'); if (!r) return; set(r.dataset.v); closeSheet(x.closest('.sheet')); redraw(b); });
} });
on('wn-model', (el) => { const b = sheetOf(el); if (b._real) return; const st = b._st; pickSheet(b, `${agentName(st.agent)} model`, MODELS[st.agent].map(([m, s]) => [m, s]), st.model, (v) => { st.model = v; }); });
on('wn-effort', (el) => { const b = sheetOf(el); if (b._real) return; const st = b._st; pickSheet(b, 'Effort', EFFORT, st.effort, (v) => { st.effort = v; }); });
on('wn-access', (el) => { const b = sheetOf(el); if (b._real) return; const st = b._st; pickSheet(b, 'Access', Object.values(ACCESS).map(([t, s]) => [t, s]), ACCESS[st.access][0], (v) => { st.access = Object.keys(ACCESS).find((k) => ACCESS[k][0] === v); }); });

// make the job (demo): it appears on the board, in its project, on Today, and opens
export function startJob(st) {
  const agents = st.where === 'compare' ? ['claude', 'codex'] : [st.agent];
  const ids = agents.map((a) => {
    const id = nextId();
    const model = a === st.agent ? st.model : MODELS[a][0][0];
    const j = { id, title: titleOf(st.prompt), agent: a, model, effort: st.effort, lane: 'working', project: st.project, worktree: st.where !== 'folder', cache: 60, ago: 'now', last: st.plan ? 'Reading the project to write a plan.' : 'Reading the task and the project folder.', progress: { done: 0, total: 5, step: st.plan ? 'Write the plan' : 'Read the project', stage: 'Study' } };
    JOBS.unshift(j);
    THREADS[id] = [{ at: clockNow(), me: st.prompt.trim(), live: true, steps: [['read', `Read ${project(st.project)?.folder.split('\\').pop()}`], ['search', 'Searching the project for where to start']] }];
    LINKS[id] = { task: st.task, goal: st.goal, client: st.client };
    if (st.access !== 'auto') W.perm[id] = st.access;
    if (st.plan) {
      W.planFirst[id] = true;
      W.plans ??= {};
      W.plans[id] = [['Study', ['Read the project', 'Find where it lives']], ['Build', ['Make the change', 'Test it']], ['Ship', ['Hand it to you']]];
      setTimeout(() => {
        if (j.lane !== 'working') return;
        j.lane = 'needs'; j.ask = { kind: 'plan', text: 'Approve the plan?' }; j.last = 'Wrote a plan of 5 steps. Waiting for your OK.';
        THREADS[id][0].live = false; THREADS[id][0].dur = '48s';
        (W.extra[id] ??= []).push({ kind: 'ai', text: 'Here is the plan. I will start once you approve it.' }, { kind: 'plan', wait: true });
        changed({ job: id });
      }, 2800);
    }
    return id;
  });
  if (st.task) { const t = TASKS.find((x) => x.id === st.task); if (t) t.job = ids[0]; }
  if (ids.length > 1) { W.compare ??= {}; W.compare[ids[0]] = ids; W.compare[ids[1]] = ids; }
  changed({ job: ids[0], started: true });
  return ids;
}
on('wn-go', (el) => {
  const b = sheetOf(el); if (b._real) return; const st = b._st; if (!st.prompt.trim()) return;
  const ids = startJob(st);
  closeSheet(el.closest('.sheet')); haptic(16);
  setTimeout(() => openDemoJob(ids[0]), 260);
  toast(ids.length > 1 ? `Claude and Codex started in two copies` : `Started with ${agentName(st.agent)}${st.task ? '. The task links to it' : ''}`);
});
on('wn-tonight', (el) => {
  const b = sheetOf(el); if (b._real) return; const st = b._st; if (!st.prompt.trim()) return;
  W.night ??= { picks: [] };
  W.night.picks.push({ id: `n${Date.now()}`, title: titleOf(st.prompt), task: st.task, agent: st.agent, model: st.model, mode: st.plan ? 'plan' : 'build', est: 25, on: true, project: st.project });
  closeSheet(el.closest('.sheet')); haptic(12); changed();
  toast(`Queued for ${NIGHT.at}. The report is here at ${NIGHT.report}`);
});

// ── the New job sheet on the real engine ──
const liveProjects = () => PROJECTS.filter((p) => !['done', 'archived', 'dropped'].includes(p.status));
const repoChecks = new Map();   // folder → { repo, hasCommits, branch } | 'busy'
function checkFolder(folder, then) {
  if (!folder) return null;
  const c = repoChecks.get(folder);
  if (c && c !== 'busy') return c;
  if (!c) { repoChecks.set(folder, 'busy'); E.worktree.check(folder).then((r) => repoChecks.set(folder, { repo: !!r.repo, hasCommits: r.hasCommits !== false, branch: r.branch ?? null, dirty: r.dirty ?? 0 }), () => repoChecks.set(folder, { repo: null })).finally(then); }
  return null;
}
/** Each folder by the fewest last parts that tell it from the others: studio-brain\clients\x beside studio-os\clients\x. */
function folderLabels(list) {
  const parts = list.map((f) => String(f).split(/[\\/]/).filter(Boolean));
  return parts.map((p, i) => {
    for (let n = Math.min(2, p.length); n <= p.length; n++) {
      const tail = p.slice(-n).join('\\');
      if (parts.every((q, k) => k === i || q.slice(-n).join('\\') !== tail)) return tail;
    }
    return p.join('\\');
  });
}
function newJobReal(prefill = {}) {
  if (SYNC.state.user && SYNC.state.user.role !== 'owner') { toast('Jobs run on the owner’s PC'); return; }
  const t = prefill.task ? taskOf(prefill.task) : null;
  const idea = prefill.idea ? E.storeNow()?.ideaById?.(prefill.idea) ?? null : null;
  const folders = [...new Set([prefill.folder, ...(prefill.folders ?? [])].filter(Boolean).map(String))];
  const engine = prefill.agent === 'codex' || prefill.agent === 'claude' ? prefill.agent : E.lastEngine();
  const st = {
    prompt: prefill.prompt ?? prefill.title ?? (t ? '' : idea?.title ?? ''), title: prefill.title ?? null,
    task: t?.id ?? null, goal: prefill.goal ?? t?.goal ?? null, idea: idea?.id ?? prefill.idea ?? null,
    client: typeof prefill.client === 'string' ? { slug: prefill.client, name: prefill.client } : prefill.client ?? null,
    project: prefill.project !== undefined ? prefill.project : t?.project ?? idea?.project ?? null,
    folders, folder: folders[0] ?? null, from: prefill.from ?? null,
    engine, model: E.lastModel(engine), effort: E.lastEffort(engine), mode: 'auto', plan: false,
    where: prefill.where ?? (E.lastWorktree() ? 'copy' : 'folder'), models: null, night: false,
  };
  if (st.project && !project(st.project)) st.project = null;
  E.models().then((m) => { st.models = m; const b = document.querySelector('.wn-sheet.wn-real .sheet-body'); if (b?._st === st) drawReal(b); });
  E.hasWorkModule().then((v) => { st.night = v; const b = document.querySelector('.wn-sheet.wn-real .sheet-body'); if (b?._st === st) drawReal(b); });
  openSheet({
    title: st.from ? 'Hand it on' : t ? 'Hand to an agent' : st.client ? `A job for ${esc(st.client.name)}` : 'New job', sub: 'Claude or Codex works on it on your PC', large: true, cls: 'wn-sheet wn-real',
    onClose: () => { E.storeNow(); import('../work/attach.js').then((A) => A.clear('new-job')).catch(() => {}); },
    body: (b) => { b._st = st; b._real = true; drawReal(b, true); },
  });
}
const folderOf = (st) => st.folder ?? (st.project ? project(st.project)?.folder || null : null);
function drawReal(b, fresh = false) {
  const st = b._st;
  const keep = fresh ? st.prompt : $('.wn-in', b)?.value ?? st.prompt;
  st.prompt = keep;
  const t = st.task && taskOf(st.task); const g = st.goal && goalOf(st.goal);
  const idea = st.idea ? E.storeNow()?.ideaById?.(st.idea) : null;
  const folder = folderOf(st);
  const repo = checkFolder(folder, () => { if (b.isConnected && b._st === st) drawReal(b); });
  const canCopy = !!folder && (!repo || (repo.repo && repo.hasCommits));
  if (!canCopy && st.where !== 'folder') st.where = 'folder';
  const branchWord = repo?.branch ?? 'the current branch';
  const M = st.models ?? E.FALLBACK_MODELS;
  const modelLabel = (e, m) => (m ? E.modelName(m) : 'Default model');
  const agentCard = (a) => `<button class="wn-agent${st.engine === a ? ' on' : ''}${st.where === 'compare' ? ' both' : ''}" data-act="wnr-agent" data-a="${a}" role="radio" aria-checked="${st.engine === a || st.where === 'compare'}">
      <span class="wn-a-top">${markFor(a, 20, { state: st.engine === a || st.where === 'compare' ? 'thinking' : 'idle' })}<b>${agentName(a)}</b></span>
      <span class="wn-a-m">${esc(modelLabel(a, a === st.engine ? st.model : E.lastModel(a)))}</span>
      <span class="wn-a-u"><span class="num">${a === 'claude' ? 'Claude Code, on your Claude login' : 'Codex, on your ChatGPT login'}</span></span></button>`;
  const whereRows = [
    ['copy', 'Its own copy', canCopy ? (repo ? `A new branch (aos/…) off ${branchWord}, next to the repo. Merge it back or open a PR` : 'Checking the folder…') : !folder ? 'Needs a project with a folder' : repo && !repo.repo ? 'The folder isn’t a git repo' : 'The repo has no commits yet'],
    ['folder', folder ? 'The folder itself' : 'A scratch folder', folder ? `Straight in ${String(folder).split(/[\\/]/).filter(Boolean).pop()}${repo?.branch ? ` on ${repo.branch}` : ''}. Other jobs there see its changes at once` : st.project ? `A new folder in agentic-jobs: ${project(st.project)?.name ?? 'this project'} has no folder yet` : 'A new folder in agentic-jobs, for work with no project'],
    ['compare', 'Compare two agents', canCopy ? 'Claude and Codex take the same job in two copies. You keep one' : 'Needs a git folder'],
  ];
  const n = (t ? 1 : 0) + (idea ? 1 : 0);
  b.innerHTML = `<div class="pad wn">
    <div class="wn-prompt field" data-att-host="new-job"><textarea class="wn-in" rows="3" placeholder="${n ? 'Anything to add (optional)' : 'What should it do? Say it like you would to a person.'}" aria-label="What the job should do">${esc(keep)}</textarea><button class="fbtn wn-mic-r" aria-label="Say it">${I.mic}</button></div>
    <div class="cmp-rec wn-rec" hidden></div>
    <div class="lv-tray wn-tray" data-att-tray="new-job" hidden></div>
    ${t || g || idea || st.client ? `<div class="wn-links">${t ? `<span class="jlink is-static">${I.check}<span class="ell">From the task: ${esc(t.title)}</span></span>` : ''}${g ? `<span class="jlink is-static">${I.target}<span class="ell">Moves: ${esc(g.title)}</span></span>` : ''}${idea ? `<span class="jlink is-static">${I.bulb}<span class="ell">The idea: ${esc(idea.title)}</span></span>` : ''}${st.client ? `<span class="jlink is-static">${I.clients}<span class="ell">For ${esc(st.client.name)}</span></span>` : ''}</div>` : ''}
    ${st.folders.length ? `<p class="wr-lbl">Folder</p><div class="chips wn-projects" role="radiogroup">${folderLabels(st.folders).map((name, i) => { const f = st.folders[i]; return `<button class="chip${f === st.folder ? ' on' : ''}" data-act="wnr-folder" data-f="${esc(f)}" role="radio" aria-checked="${f === st.folder}" title="${esc(f)}">${I.folder}${esc(name)}</button>`; }).join('')}</div>`
      : `<p class="wr-lbl">Project</p><div class="chips wn-projects" role="radiogroup"><button class="chip${!st.project ? ' on' : ''}" data-act="wnr-proj" data-p="" role="radio" aria-checked="${!st.project}">None</button>${liveProjects().map((p) => `<button class="chip${p.slug === st.project ? ' on' : ''}" data-act="wnr-proj" data-p="${esc(p.slug)}" role="radio" aria-checked="${p.slug === st.project}"><i class="dot" style="--c:${p.color}"></i>${esc(p.name)}</button>`).join('')}</div>`}
    <p class="wr-lbl">Who does it</p>
    <div class="wn-agents" role="radiogroup">${agentCard('claude')}${agentCard('codex')}</div>
    <p class="wr-lbl">Where it works</p>
    <div class="group wr-routes" role="radiogroup">${whereRows.map(([k, tt, s]) => { const off = k !== 'folder' && !canCopy; return `<button class="row wr-route${k === st.where ? ' on' : ''}${off ? ' is-off' : ''}" data-act="wnr-where" data-k="${k}" role="radio" aria-checked="${k === st.where}" ${off ? 'aria-disabled="true"' : ''}><span class="rbody"><span class="rtitle">${tt}</span><span class="rmeta"><span class="ell">${esc(s)}</span></span></span><span class="o-r" aria-hidden="true"></span></button>`; }).join('')}</div>
    <div class="group wn-set">
      <button class="row" data-act="wnr-model"><span class="rbody"><span class="rtitle">Model</span></span><span class="rend">${esc(st.where === 'compare' ? 'Each agent’s last pick' : modelLabel(st.engine, st.model))}${I.chevR}</span></button>
      <button class="row" data-act="wnr-effort"><span class="rbody"><span class="rtitle">Effort</span></span><span class="rend">${esc(E.effortName(st.effort))}${I.chevR}</span></button>
      <button class="row" data-act="wnr-mode"><span class="rbody"><span class="rtitle">Access</span><span class="rmeta"><span class="ell">${esc(E.MODES[st.mode][1])}</span></span></span><span class="rend">${esc(E.MODES[st.mode][0])}${I.chevR}</span></button>
      <div class="row"><span class="rbody"><span class="rtitle">Plan first</span><span class="rmeta">Writes a plan and waits for your OK</span></span><button class="switch${st.plan ? ' on' : ''}" data-act="wnr-plan" role="switch" aria-checked="${st.plan}" aria-label="Plan first"></button></div>
      <button class="row ic wk-addrow" data-attach="new-job"><span class="tile">${WI.clip}</span><span class="rbody"><span class="rtitle">Photos or files</span><span class="rmeta"><span class="ell">They upload now and go with the first message</span></span></span>${I.plus}</button>
    </div>
    <button class="btn primary block wn-go" style="--c:var(--jobs-fill)" data-act="wnr-go">${st.where === 'compare' ? 'Start both' : `${markFor(st.engine, 18, { state: 'idle' })}Start with ${agentName(st.engine)}`}</button>
    ${st.night && st.where !== 'compare' ? `<button class="btn block wn-night" data-act="wnr-tonight">${WI.moon}Run it tonight at ${E.NIGHT_AT}</button>` : ''}
    <p class="hint">${esc(folder ? `It runs on your PC ${st.where === 'copy' ? `in its own copy of ${String(folder).split(/[\\/]/).filter(Boolean).pop()}` : st.where === 'compare' ? 'in two copies' : `in ${String(folder).split(/[\\/]/).filter(Boolean).pop()}`}. Every step shows in Work, and what it asks comes to Needs you.` : 'It runs on your PC in a new scratch folder. Every step shows in Work.')}</p>
  </div>`;
  const ta = $('.wn-in', b);
  ta.addEventListener('input', () => { st.prompt = ta.value; });
  import('../work/attach.js').then((A) => A.changed('new-job')).catch(() => {});
  const mic = $('.wn-mic-r', b);
  mic.addEventListener('click', async (e) => {
    e.preventDefault();
    const V = await import('../work/recorder.js').catch(() => null);
    if (!V) { toast('Voice notes aren’t available here'); return; }
    if (V.recording(ta)) { V.stop(); return; }
    const slot = $('.wn-rec', b); slot.hidden = false;
    V.start({ target: ta, slot, button: mic, source: 'app', purpose: 'context', onState: (s) => { slot.hidden = s === 'idle'; mic.classList.toggle('on', s === 'recording' || s === 'starting'); } });
  });
}
const realSheet = (el) => { const b = sheetOf(el); return b?._real ? b : null; };
on('wnr-proj', (el) => { const b = realSheet(el); if (!b) return; b._st.project = el.dataset.p || null; haptic(5); drawReal(b); });
on('wnr-folder', (el) => { const b = realSheet(el); if (!b) return; b._st.folder = el.dataset.f; haptic(5); drawReal(b); });
on('wnr-agent', (el) => { const b = realSheet(el); if (!b) return; const st = b._st; if (st.where === 'compare') st.where = 'copy'; st.engine = el.dataset.a; E.rememberEngine(st.engine); st.model = E.lastModel(st.engine); st.effort = E.lastEffort(st.engine); haptic(6); drawReal(b); });
on('wnr-where', (el) => { const b = realSheet(el); if (!b) return; if (el.getAttribute('aria-disabled') === 'true') { toast('That needs a project whose folder is a git repo'); return; } b._st.where = el.dataset.k; if (el.dataset.k !== 'compare') E.rememberWorktree(el.dataset.k === 'copy'); haptic(5); drawReal(b); });
on('wnr-plan', (el) => { const b = realSheet(el); if (!b) return; b._st.plan = !b._st.plan; haptic(6); drawReal(b); });
on('wnr-model', (el) => {
  const b = realSheet(el); if (!b) return; const st = b._st;
  const M = st.models ?? E.FALLBACK_MODELS;
  const ids = ['', ...((M[st.engine]?.length ? M[st.engine] : E.FALLBACK_MODELS[st.engine]) ?? [])];
  pickSheet(b, `${agentName(st.engine)} model`, ids.map((m) => [m, m ? m : `${agentName(st.engine)}’s own pick`, m ? E.modelName(m) : 'Default']), st.model, (v) => { st.model = v; E.rememberModel(st.engine, v); }, drawReal);
});
on('wnr-effort', (el) => {
  const b = realSheet(el); if (!b) return; const st = b._st;
  const M = st.models ?? E.FALLBACK_MODELS;
  const ids = ['', ...((M.efforts?.[st.engine]?.length ? M.efforts[st.engine] : E.FALLBACK_MODELS.efforts[st.engine]) ?? [])];
  pickSheet(b, 'Effort', ids.map((v) => [v, v ? '' : 'The model’s own level', E.effortName(v)]), st.effort, (v) => { st.effort = v; E.rememberEffort(st.engine, v); }, drawReal);
});
on('wnr-mode', (el) => { const b = realSheet(el); if (!b) return; const st = b._st; pickSheet(b, 'Access', Object.entries(E.MODES).map(([k, [t, s]]) => [k, s, t]), st.mode, (v) => { st.mode = v; }, drawReal); });
on('wnr-go', async (el) => {
  const b = realSheet(el); if (!b || el.disabled) return; const st = b._st;
  const text = $('.wn-in', b)?.value.trim() ?? '';
  const A = await import('../work/attach.js').catch(() => null);
  const V = await import('../work/recorder.js').catch(() => null);
  if (V?.busy?.($('.wn-in', b))) { toast('Wait for the voice note to land'); return; }
  if (A?.uploading?.('new-job')) { toast('Wait for the attachments to finish uploading'); return; }
  const files = A?.ids?.('new-job') ?? [];
  if (!text && !st.task && !st.idea && !files.length) { toast('Say what the job should do'); $('.wn-in', b)?.focus(); return; }
  el.disabled = true; el.innerHTML = `<span class="spin" style="--c:var(--on-color)"></span>Starting on your PC`;
  const first = text.split('\n')[0];
  st.key ??= `nj${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const spec = { key: st.key, engine: st.engine, model: st.model, effort: st.effort, mode: st.mode, plan: st.plan, taskIds: st.task ? [st.task] : [], ideaId: st.idea, project: st.project,
    cwd: st.folder ?? null, title: st.title ?? (first ? (first.length > 80 ? `${first.slice(0, 78).trimEnd()}…` : first) : null), prompt: text || (files.length ? 'See the attached files.' : ''), attachments: files, worktree: st.where === 'copy' };
  try {
    let open;
    if (st.where === 'compare') { const r = await E.startCompare(spec); open = () => import('./work-changes.js').then((C) => C.openCompare(r.group)); toast('Claude and Codex started, each in its own copy'); }
    else { const j = await E.startJob(spec); open = () => api.openJob(j.id); toast(`Started with ${agentName(st.engine)}${st.task ? '. The task moved to doing' : ''}`); }
    A?.clear?.('new-job');
    closeSheet(el.closest('.sheet')); haptic('success');
    setTimeout(open, 260);
  } catch (e) {
    // the PC answered (a refusal): the next try is a new request. No answer: the same key, so a job it did start comes back.
    if (e.status) st.key = null;
    el.disabled = false; drawReal(b); toast(E.err(e));
  }
});
on('wnr-tonight', (el) => {
  const b = realSheet(el); if (!b) return; const st = b._st;
  const text = $('.wn-in', b)?.value.trim() ?? '';
  if (!text && !st.task) { toast('Say what it should do tonight'); return; }
  E.night().add({ date: E.nightDate(), state: 'queued', title: titleOf(text || taskOf(st.task)?.title || 'Night job'), prompt: text, task: st.task, project: st.project, engine: st.engine, model: st.model || null, effort: st.effort || null, mode: st.plan ? 'plan' : 'build', worktree: st.where !== 'folder' });
  closeSheet(el.closest('.sheet')); haptic(12);
  toast(`Queued for ${E.NIGHT_AT}. The report is here at ${E.NIGHT_REPORT}`);
});

// ── the + menu: everything you can start in Work ──────────────────────
export function newMenu() {
  const rows = [
    ['w-new-job', REAL ? markFor('claude', 20) : I.claude, 'Job', 'Claude or Codex works on it on your PC'],
    ['w-new-task', I.check, 'Task', 'For you, in a project or on a day'],
    ['w-new-term', I.term, 'Terminal', 'PowerShell, Claude Code or Codex CLI in a project'],
    ['w-new-idea', I.bulb, 'Idea', 'Drop it now, turn it into work later'],
    ['w-new-proj', I.folderPlus, 'Project', 'A folder on your PC, with its area'],
  ];
  openSheet({ title: 'New', body: `<div class="group wk-newmenu">${rows.map(([act, ic, t, m]) => `<button class="row ic" data-act="${act}"><span class="tile">${ic}</span><span class="rbody"><span class="rtitle">${t}</span><span class="rmeta"><span class="ell">${m}</span></span></span>${I.chevR}</button>`).join('')}</div>` });
}
on('w-new', () => newMenu());
on('w-new-job', () => { closeSheet(); setTimeout(() => newJob(), 260); });
on('w-new-task', () => { closeSheet(); setTimeout(() => api.addTask({ aspect: 'mission' }), 260); });
on('w-new-term', () => { closeSheet(); setTimeout(() => document.dispatchEvent(new CustomEvent('work:terminal', { detail: { project: REAL ? null : 'agentic-os', fresh: true } })), 260); });
on('w-new-idea', () => { closeSheet(); W.view = 'ideas'; setTab('jobs'); changed({ focus: 'idea' }); });
on('w-new-proj', () => { closeSheet(); setTimeout(() => projectSheet(null), 260); });
on('w-hand', (el) => newJob({ task: el.dataset.id, agent: el.dataset.a ?? (REAL ? E.lastEngine() : 'codex') }));

// ── the project sheet: name, mark, area, folder on the PC, what it is ──
const ICONS = ['🚀', '🎬', '🛍️', '🧠', '📱', '💬', '🧾', '🎯', '🤖', '📦', '💡', '🧪'];
export function projectSheet(p) {
  if (REAL) return projectSheetReal(p);
  return openSheet({ title: p ? 'Edit project' : 'New project', body: `<div class="pad wk-proj-form">
  <div class="field"><input placeholder="Name" aria-label="Name" value="${p ? esc(p.name) : ''}" /></div>
  <div class="chips jp-emoji">${ICONS.slice(0, 8).map((e, i) => `<button class="chip ${(p ? p.icon === e : i === 0) ? 'on' : ''}" data-act="wk-emoji" aria-label="Icon ${e}">${e}</button>`).join('')}</div>
  <div class="group jp-form"><button class="row" data-act="wk-folder"><span class="rbody"><span class="rtitle">Folder</span></span><span class="rend mono">${p ? esc(p.folder.split('\\').pop()) : 'Pick on the PC'}${I.chevR}</span></button><button class="row" data-act="wk-area"><span class="rbody"><span class="rtitle">Area</span></span><span class="rend">${p ? esc(p.area) : 'Projects'}${I.chevR}</span></button></div>
  <button class="btn primary block jp-go" style="--c:var(--jobs-fill)" data-act="wk-proj-save">${p ? 'Save' : 'Create'}</button></div>` });
}
on('wk-emoji', (el) => { $$('.chip', el.parentElement).forEach((c) => c.classList.toggle('on', c === el)); haptic(5); });
on('wk-folder', () => toast('Pick the folder on your PC'));
on('wk-area', () => toast('Areas come from agentos'));
on('wk-proj-save', (el) => { closeSheet(el.closest('.sheet')); toast('Saved'); });
function projectSheetReal(p0) {
  const P = { slug: p0?.slug ?? null, name: p0?.name ?? '', icon: p0 && /\p{Extended_Pictographic}/u.test(p0.icon ?? '') ? p0.icon : '', area: p0?.area ?? null, folder: p0?.folder ?? '', description: p0?.desc ?? p0?.description ?? '', status: p0?.status ?? 'active', folders: null, filter: '', picking: false };
  openSheet({ title: P.slug ? 'Edit project' : 'New project', sub: P.slug ? esc(P.slug) : 'Its jobs, tasks, ideas and sessions live together', large: true, cls: 'wk-proj-sheet', body: (b) => {
    const keep = () => { P.name = $('.wkp-name', b)?.value ?? P.name; P.icon = $('.wkp-icon', b)?.value ?? P.icon; P.description = $('.wkp-desc', b)?.value ?? P.description; };
    const draw = () => {
      const areas = Object.entries(AREAS).filter(([k]) => k !== 'none');
      const q = P.filter.toLowerCase();
      const list = P.folders?.list?.filter((f) => !q || f.path.toLowerCase().includes(q)).slice(0, 40) ?? [];
      b.innerHTML = `<div class="pad wk-proj-form">
        <div class="wkp-row"><input class="wkp-icon" maxlength="4" value="${esc(P.icon)}" placeholder="📁" aria-label="Icon" /><div class="field wkp-namef"><input class="wkp-name" value="${esc(P.name)}" placeholder="Name" aria-label="Name" autocomplete="off" /></div></div>
        <div class="chips jp-emoji">${ICONS.map((e) => `<button class="chip${P.icon === e ? ' on' : ''}" data-wkp-icon="${e}" aria-label="Icon ${e}">${e}</button>`).join('')}</div>
        <p class="wr-lbl">Area</p><div class="chips">${areas.map(([k, a]) => `<button class="chip${P.area === k ? ' on' : ''}" data-wkp-area="${esc(k)}"><i class="dot" style="--c:${a.color}"></i>${esc(a.name)}</button>`).join('')}<button class="chip${!P.area ? ' on' : ''}" data-wkp-area="">None</button></div>
        <p class="wr-lbl">Folder on your PC</p>
        <button class="row wkp-folder surface" data-wkp-pick><span class="tile">${I.folder}</span><span class="rbody"><span class="rtitle">${P.folder ? esc(String(P.folder).split(/[\\/]/).filter(Boolean).pop()) : 'Choose a folder'}</span><span class="rmeta mono"><span class="ell">${P.folder ? esc(P.folder) : 'Optional. Jobs and sessions run there'}</span></span></span>${P.picking ? I.chevU : I.chevD}</button>
        ${P.picking ? `<div class="wkp-fp"><div class="field"><input class="wkp-filter" value="${esc(P.filter)}" placeholder="Filter, or type a full path" autocomplete="off" aria-label="Filter folders" /></div>
          ${!P.folders ? '<p class="hint">Reading the folders on your PC…</p>' : P.folders.error ? `<p class="hint">${esc(P.folders.error)}</p>` : `<div class="group">${list.map((f) => `<button class="row" data-wkp-folder="${esc(f.path)}"><span class="rbody"><span class="rtitle">${esc(f.name)}</span><span class="rmeta mono"><span class="ell">${esc(f.path)}</span></span></span>${P.folder === f.path ? `<span class="jpick">${I.check}</span>` : ''}</button>`).join('') || '<div class="row"><span class="rbody"><span class="rmeta">No folder matches.</span></span></div>'}</div>`}
          ${/^[a-z]:[\\/]/i.test(P.filter) ? `<button class="btn sm" data-wkp-folder="${esc(P.filter)}">Use ${esc(P.filter)}</button>` : ''}${P.folder ? '<button class="btn sm" data-wkp-folder="">No folder</button>' : ''}</div>` : ''}
        <p class="wr-lbl">What it is</p><div class="field wkp-descf"><textarea class="wkp-desc" rows="3" placeholder="What it is and what done looks like">${esc(P.description)}</textarea></div>
        ${P.slug ? `<p class="wr-lbl">Status</p><div class="chips">${['active', 'paused', 'done', 'archived'].map((s) => `<button class="chip${P.status === s ? ' on' : ''}" data-wkp-status="${s}">${s[0].toUpperCase()}${s.slice(1)}</button>`).join('')}</div>` : ''}
        <button class="btn primary block jp-go" style="--c:var(--jobs-fill)" data-wkp-save>${P.slug ? 'Save' : 'Create the project'}</button></div>`;
      const f = $('.wkp-filter', b);
      if (f) f.addEventListener('input', () => { keep(); P.filter = f.value; const pos = f.selectionStart; draw(); const nf = $('.wkp-filter', b); nf.focus(); try { nf.setSelectionRange(pos, pos); } catch {} });
    };
    draw();
    b.addEventListener('click', async (e) => {
      const ic = e.target.closest('[data-wkp-icon]'); if (ic) { keep(); P.icon = ic.dataset.wkpIcon; haptic(5); draw(); return; }
      const ar = e.target.closest('[data-wkp-area]'); if (ar) { keep(); P.area = ar.dataset.wkpArea || null; haptic(5); draw(); return; }
      const ss = e.target.closest('[data-wkp-status]'); if (ss) { keep(); P.status = ss.dataset.wkpStatus; haptic(5); draw(); return; }
      if (e.target.closest('[data-wkp-pick]')) {
        keep(); P.picking = !P.picking; draw();
        if (P.picking && !P.folders) { try { const r = await (await import('./svc/api.js')).api('/folders'); P.folders = { list: r.folders ?? [] }; } catch (er) { P.folders = { error: er.status === 404 ? 'The folder list isn’t on your PC’s server yet. Type a full path.' : 'Your PC isn’t reachable right now.' }; } if (P.picking) draw(); }
        return;
      }
      const fd = e.target.closest('[data-wkp-folder]'); if (fd) { keep(); P.folder = fd.dataset.wkpFolder; P.picking = false; haptic(5); draw(); return; }
      const sv = e.target.closest('[data-wkp-save]');
      if (!sv || sv.disabled) return;
      keep();
      if (!P.name.trim()) { toast('Give it a name'); $('.wkp-name', b)?.focus(); return; }
      sv.disabled = true;
      const body = { name: P.name.trim(), icon: P.icon.trim() || null, area: P.area, folder: P.folder || null, description: P.description.trim() || null, ...(P.slug ? { status: P.status } : {}) };
      try {
        const API = await import('./svc/api.js');
        const r = await API.api(P.slug ? `/projects/${P.slug}` : '/projects', { method: P.slug ? 'PATCH' : 'POST', body: JSON.stringify(body) });
        const proj = r.project ?? r;
        SYNC.adopt('project', proj);
        E.touchProject(proj.slug);
        closeSheet(b.closest('.sheet')); haptic('success');
        toast(P.slug ? 'Saved' : 'Project created');
        if (!P.slug) setTimeout(() => api.openProject(proj.slug), 280);
        else E.loadProject(proj.slug);
      } catch (er) { sv.disabled = false; toast(E.err(er)); }
    });
  } });
}

// ── the night shift ───────────────────────────────────────────────────
export const nightPicks = () => [...NIGHT.picks.map((p) => ({ ...p, title: taskOf(p.task)?.title, project: taskOf(p.task)?.project ?? null })), ...(W.night?.picks ?? [])];
export function nightSheet() {
  if (REAL) return nightSheetReal();
  const picks = nightPicks();
  const st = { on: new Set(picks.filter((p) => (W.night?.queued ? W.night.queued.includes(p.id) : p.on)).map((p) => p.id)) };
  openSheet({
    title: 'Tonight\'s shift', sub: `Agents work from ${NIGHT.at} while you sleep. The report is here at ${NIGHT.report}.`, cls: 'wn-night-sheet',
    body: (b) => {
      const render = () => {
        const n = st.on.size; const mins = picks.filter((p) => st.on.has(p.id)).reduce((s, p) => s + p.est, 0);
        b.innerHTML = `<div class="wn-span" aria-hidden="true"><span class="num">${NIGHT.at}</span><span class="wn-span-l">${WI.moon}</span><span class="num">${NIGHT.report}</span></div>
          <p class="wr-lbl pad">Ready for an agent</p>
          <div class="group wn-picks">${picks.map((p) => `<button class="row wn-pick${st.on.has(p.id) ? ' on' : ''}" data-id="${p.id}" role="checkbox" aria-checked="${st.on.has(p.id)}">
            <span class="check${st.on.has(p.id) ? ' done' : ''}" aria-hidden="true">${I.check}</span>
            <span class="rbody"><span class="rtitle wrap">${esc(p.title ?? '')}</span>
              <span class="rmeta"><span class="wn-who">${I[p.agent]}${agentName(p.agent)}</span><span>· ${p.mode === 'plan' ? 'a plan only' : 'builds it'}</span><span>· about ${p.est} min</span></span>
              ${p.why ? `<span class="wn-why">${esc(p.why)}</span>` : ''}</span></button>`).join('')}</div>
          <p class="wyn-hint pad-hint">${I.sparkle}<span>Runs on your Claude and Codex plans, so it adds no API spend. Claude's window resets at ${USAGE.claude.resets}, so the shift starts on a full one.</span></p>
          <div class="pad"><button class="btn primary block" style="--c:var(--jobs-fill)" data-act="wn-queue"${n ? '' : ' disabled'}>${n ? `Queue ${n} job${n === 1 ? '' : 's'} for ${NIGHT.at}` : 'Pick a task'}</button>
          <p class="foot wn-tot num">${n ? `About ${Math.floor(mins / 60) ? `${Math.floor(mins / 60)}h ` : ''}${mins % 60}m of work. Plans wait for your OK at breakfast; builds wait for review.` : ''}</p></div>`;
      };
      b._night = st; render();
      b.addEventListener('click', (e) => { const r = e.target.closest('.wn-pick'); if (!r) return; const id = r.dataset.id; if (st.on.has(id)) st.on.delete(id); else st.on.add(id); haptic(5); render(); });
    },
  });
}
on('w-night', () => nightSheet());
on('wn-queue', (el) => {
  const b = sheetOf(el); if (b._real) return; const ids = [...b._night.on];
  W.night ??= { picks: [] }; W.night.queued = ids;
  closeSheet(el.closest('.sheet')); haptic(14); changed();
  toast(`${ids.length} job${ids.length === 1 ? '' : 's'} queued for ${NIGHT.at}. Report at ${NIGHT.report}`, () => { W.night.queued = null; changed(); });
});

// real: open tasks in projects with a folder and no live job are the candidates; each pick is a work/night row
const liveJob = (t) => { const j = t.job ? E.raw(t.job) : null; return !!j && ['starting', 'running', 'needs_input', 'idle'].includes(j.status); };
export function nightCandidates() {
  return TASKS.filter((t) => ['todo', 'inbox'].includes(t.status) && t.project && project(t.project)?.folder && !liveJob(t))
    .sort((a, b) => (a.priority ?? 2) - (b.priority ?? 2) || String(a.date ?? '9').localeCompare(String(b.date ?? '9')) || a.title.localeCompare(b.title)).slice(0, 12);
}
const estOf = (t) => t?.estimateMinutes ?? t?.est ?? null;
export function nightCardReal() {
  if (!E.moduleOn.known) { E.hasWorkModule(); return ''; }
  if (!E.moduleOn.yes) return '';
  const q = E.tonight().filter((d) => d.state === 'queued' || d.state === 'started');
  if (q.length) {
    return `<div class="wk-night surface is-queued">
      <span class="tile">${WI.moon}</span>
      <span class="rbody"><b>Tonight · ${plural(q.length, 'job')} at ${E.NIGHT_AT}</b><span class="wk-n-l">${q.slice(0, 4).map((d) => `<span class="wk-n-j">${markFor(d.engine ?? 'claude', 14)}<span class="ell">${esc(d.title ?? taskOf(d.task)?.title ?? '')}</span></span>`).join('')}</span><span class="foot">${q.some((d) => d.state === 'started') ? 'Running now.' : `The report is here at ${E.NIGHT_REPORT}.`}</span></span>
      <button class="btn sm" data-act="w-night">Change</button></div>`;
  }
  const ready = nightCandidates().length;
  if (!ready) return '';
  return `<div class="wk-night surface">
    <span class="tile">${WI.moon}</span>
    <span class="rbody"><b>Tonight's shift</b><span class="foot">${plural(ready, 'task')} could go to an agent at ${E.NIGHT_AT} while you sleep, on the plans you already pay for. Plans wait for your OK at breakfast.</span></span>
    <button class="btn sm" data-act="w-night">Plan it</button></div>`;
}
async function nightSheetReal() {
  if (!(await E.hasWorkModule())) { toast('The night shift needs the Work module on your PC. Start jobs now instead'); return; }
  const queued = () => E.tonight().filter((d) => d.state === 'queued');
  const picks = new Map();   // key → { task?, doc?, engine, mode, on }
  for (const d of queued()) picks.set(d.task ? `t:${d.task}` : `d:${d.id}`, { doc: d, task: d.task ? taskOf(d.task) : null, title: d.title, engine: d.engine ?? 'claude', mode: d.mode ?? 'plan', on: true });
  for (const t of nightCandidates()) if (!picks.has(`t:${t.id}`)) picks.set(`t:${t.id}`, { task: t, title: t.title, engine: E.lastEngine(), mode: 'plan', on: false });
  const last = E.night().list().filter((d) => d.date === E.clock.addDays(E.nightDate(), -1) && (d.state === 'started' || d.state === 'failed'));
  openSheet({
    title: 'Tonight’s shift', sub: `Agents work from ${E.NIGHT_AT} while you sleep. The report is here at ${E.NIGHT_REPORT}.`, cls: 'wn-night-sheet wn-night-real', large: picks.size > 4,
    body: (b) => {
      const render = () => {
        const on_ = [...picks.values()].filter((p) => p.on);
        const mins = on_.reduce((s, p) => s + (estOf(p.task) ?? 30), 0);
        b.innerHTML = `<div class="wn-span" aria-hidden="true"><span class="num">${E.NIGHT_AT}</span><span class="wn-span-l">${WI.moon}</span><span class="num">${E.NIGHT_REPORT}</span></div>
          ${last.length ? `<p class="wr-lbl pad">Last night</p><div class="group">${last.map((d) => `<button class="row ic" data-act="${d.job ? 'job' : ''}" data-id="${esc(d.job ?? '')}"><span class="tile">${markFor(d.engine ?? 'claude', 20, { state: d.state === 'failed' ? 'failed' : 'done' })}</span><span class="rbody"><span class="rtitle">${esc(d.title ?? '')}</span><span class="rmeta"><span class="ell">${d.state === 'failed' ? esc(d.error ?? 'It didn’t start') : `Ran as ${esc(d.job ?? '')}`}</span></span></span>${d.job ? I.chevR : ''}</button>`).join('')}</div>` : ''}
          <p class="wr-lbl pad">${picks.size ? 'Ready for an agent' : 'Nothing ready'}</p>
          ${picks.size ? `<div class="group wn-picks">${[...picks.entries()].map(([k, p]) => `<div class="row wn-pick${p.on ? ' on' : ''}" data-k="${esc(k)}">
            <button class="check${p.on ? ' done' : ''}" data-wnp="on" role="checkbox" aria-checked="${p.on}" aria-label="Run ${esc(p.title ?? '')} tonight">${I.check}</button>
            <span class="rbody"><span class="rtitle wrap">${esc(p.title ?? '')}</span>
              <span class="rmeta wn-pick-m"><button class="wn-who" data-wnp="engine">${markFor(p.engine, 14)}${agentName(p.engine)}</button><button class="wn-mode" data-wnp="mode">${p.mode === 'plan' ? 'a plan only' : 'builds it'}</button>${p.task?.project ? `<span>· ${esc(project(p.task.project)?.name ?? '')}</span>` : ''}${estOf(p.task) ? `<span>· about ${estOf(p.task)} min</span>` : ''}</span></span></div>`).join('')}</div>`
          : '<p class="hint">Open tasks in a project with a folder show here. Or start a job from New job and pick Run it tonight.</p>'}
          <p class="wyn-hint pad-hint">${I.sparkle}<span>Runs on your Claude and Codex logins, so it adds no API spend. Builds work in their own copy, never in your folder; plans wait for your OK at breakfast.</span></p>
          <div class="pad"><button class="btn primary block" style="--c:var(--jobs-fill)" data-act="wnr-queue"${on_.length || queued().length ? '' : ' disabled'}>${on_.length ? `Queue ${plural(on_.length, 'job')} for ${E.NIGHT_AT}` : queued().length ? 'Clear tonight’s shift' : 'Pick a task'}</button>
          <p class="foot wn-tot num">${on_.length ? `About ${Math.floor(mins / 60) ? `${Math.floor(mins / 60)}h ` : ''}${mins % 60}m of work.` : ''}</p></div>`;
      };
      b._night = picks; b._real = true; render();
      b.addEventListener('click', (e) => {
        const x = e.target.closest('[data-wnp]'); if (!x) return;
        const p = picks.get(x.closest('[data-k]')?.dataset.k); if (!p) return;
        if (x.dataset.wnp === 'on') p.on = !p.on;
        else if (x.dataset.wnp === 'engine') p.engine = p.engine === 'claude' ? 'codex' : 'claude';
        else p.mode = p.mode === 'plan' ? 'build' : 'plan';
        haptic(5); render();
      });
    },
  });
}
on('wnr-queue', (el) => {
  const b = sheetOf(el); if (!b?._real) return;
  const picks = b._night; const date = E.nightDate(); let n = 0;
  for (const p of picks.values()) {
    const fields = { engine: p.engine, mode: p.mode, model: E.lastModel(p.engine) || null, worktree: true };
    if (p.doc && !p.on) E.night().update(p.doc.id, { state: 'cancelled' });
    else if (p.doc && p.on) { E.night().update(p.doc.id, fields); n++; }
    else if (p.on) { E.night().add({ date, state: 'queued', task: p.task?.id ?? null, project: p.task?.project ?? null, title: p.title, prompt: p.task?.notes ? `${p.task.title}\n\n${p.task.notes}` : p.task?.title ?? p.title, ...fields }); n++; }
  }
  closeSheet(el.closest('.sheet')); haptic(14);
  toast(n ? `${plural(n, 'job')} queued for ${E.NIGHT_AT}. Report at ${E.NIGHT_REPORT}` : 'Tonight’s shift is clear');
  changed();
});
export { NIGHT };

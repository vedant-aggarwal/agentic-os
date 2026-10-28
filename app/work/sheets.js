// Sheets for work: the idea sheet, the job sheet (two big buttons, Claude and Codex), new/edit project with the
// folder picker, and the job controls inside the + sheet.
import { W, putIdea, putJob, ideaById, projectBySlug, createIdea, emit, onChange, loadProject, ENGINE, folderLabel } from './state.js';
import * as voice from './recorder.js';
import * as attach from './attach.js';
import { lastModel, rememberModel, loadModels, modelFieldHTML, lastEffort, rememberEffort, effortFieldHTML, modelLabel } from './models.js';
import { whereFieldHTML, repoOf } from './workspace.js';

const { AOS } = window;
const { esc } = AOS;
const $ = (s, el = document) => el.querySelector(s);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const screen = document.getElementById('screen');
const ENGINE_KEY = 'agentos-app:job-engine';
const lastEngine = () => { try { return localStorage.getItem(ENGINE_KEY) === 'codex' ? 'codex' : 'claude'; } catch { return 'claude'; } };
const ENGINE_SVG = {
  claude: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6 6 18"/></svg>',
  codex: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="3.5"/><path d="m7.5 10 2.5 2-2.5 2M12.5 14.5h4"/></svg>',
};
const FOLDER_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2.8 6.2a1.6 1.6 0 0 1 1.6-1.6h3.3l1.6 1.8h6.3a1.6 1.6 0 0 1 1.6 1.6v6.6a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6z"/></svg>';
export const folderName = (path) => (path ? String(path).split(/[\\/]/).filter(Boolean).at(-1) : '');

export function sheetEl(id, label, cls = '') {
  const el = document.createElement('section');
  el.className = `sheet work-sheet ${cls}`;
  el.id = id;
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="grabber"></div><div class="sheet-head"></div><div class="sheet-body"></div>';
  screen.appendChild(el);
  return el;
}
export const scrimFor = (y, H) => clamp(1 - y / (H * 0.85), 0, 1);

/** Chips for picking a project: "None" first, recent first. */
export function projectChips(selected, attr = 'data-pick-project') {
  const ps = AOS.liveProjects();
  const cur = selected && !ps.some((p) => p.slug === selected) ? projectBySlug(selected) : null;
  return `<button type="button" class="chip-btn${!selected ? ' on' : ''}" ${attr}="">None</button>`
    + [...(cur ? [cur] : []), ...ps].map((p) => `<button type="button" class="chip-btn${selected === p.slug ? ' on' : ''}" ${attr}="${esc(p.slug)}">${AOS.projGlyph(p)}${esc(AOS.clip(p.name, 22))}</button>`).join('');
}
const ctxField = (id, value = '', placeholder = 'Anything it should know: links, constraints, what done looks like') => `<div class="ctx-box"><textarea id="${id}" rows="3" placeholder="${esc(placeholder)}">${esc(value)}</textarea>${voice.micButtonHTML(`data-mic-for="${id}"`)}</div><div class="rec-slot" data-rec-for="${id}"></div>`;
// Any mic button with data-mic-for records into that field (job sheet, idea sheet, capture job, composer).
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mic-for]');
  if (!b) return;
  e.preventDefault();
  const target = document.getElementById(b.dataset.micFor);
  if (!target) return;
  if (voice.recording(target)) { voice.stop(); return; }
  const slot = document.querySelector(`[data-rec-for="${b.dataset.micFor}"]`);
  voice.start({ target, slot, button: b, source: b.dataset.source || 'app', purpose: b.dataset.purpose || 'context' });
});

// ---------- Job sheet ----------
// What it should do, the engine, where it works, the model and effort, then its own copy, plan first and the
// permissions, and the one Start button in Jobs' fill. Opened from a task, an idea, a project, the board's New, or a
// client (AOS.work.openJobSheet({ folder }), with the client's folders to choose from).
const jobEl = sheetEl('jobSheet', 'Start a job', 'job-sheet jsheet');
const jobSheet = AOS.makeSheet(jobEl, { detents: (H) => ({ large: 0, half: Math.round(H * 0.12) }), scrimFor });
let J = null;   // { taskIds, ideaId, project, folder, folders, title, client, engine, model, effort, mode, plan, worktree }
/** Run new jobs in their own copy (git worktree) of a repo folder: on unless he turned it off last time. */
const WT_KEY = 'agentos-app:job-worktree';
export const lastWorktree = () => { try { return localStorage.getItem(WT_KEY) !== '0'; } catch { return true; } };
export const rememberWorktree = (on) => { try { localStorage.setItem(WT_KEY, on ? '1' : '0'); } catch {} };
const JS_MODES = [['ask', 'Ask first', 'Every edit and command comes to this phone for an OK'], ['edits', 'Auto-edit', 'File edits go through; commands come to this phone'], ['auto', 'Full access', 'Nothing asks; it works on its own']];
/** opts: { taskIds?, ideaId?, project?: slug, folder?: path (where it works), folders?: [path] (the choices),
 *  title?, context?, client?: { slug, name } }. Clients starts a job in a client's folder this way. */
export function openJobSheet(opts = {}) {
  if (!AOS.owner || !AOS.real) { AOS.toast('Jobs run on the owner’s PC'); return; }
  const tasks = (opts.taskIds ?? []).map((id) => AOS.taskById(id)).filter(Boolean);
  const idea = opts.ideaId ? ideaById(opts.ideaId) : null;
  const folders = [...new Set([opts.folder, ...(opts.folders ?? [])].filter(Boolean).map(String))];
  const project = folders.length ? opts.project ?? null : opts.project ?? idea?.project ?? tasks.find((t) => t.project)?.project ?? null;
  J = { taskIds: tasks.map((t) => t.id), ideaId: idea?.id ?? null, project, folders, folder: folders[0] ?? null, title: opts.title ?? null, client: opts.client ?? null,
    context: opts.context ?? '', engine: lastEngine(), model: '', effort: '', mode: 'auto', plan: false, worktree: lastWorktree() };
  J.model = lastModel(J.engine);
  J.effort = lastEffort(J.engine);
  renderJobSheet(true);
  loadModels(() => { if (J) renderJobSheet(); });
  jobSheet.open('large');
}
/** Names for a few folders that tell them apart: the first part where their paths differ (studio-os, studio-brain),
 *  with the last part when that is something else; one folder keeps its last two parts. */
function folderNames(folders) {
  const parts = folders.map((f) => String(f).split(/[\\/]/).filter(Boolean));
  if (parts.length < 2) return folders.map((f) => folderLabel(f));
  let i = 0;
  while (parts.every((p) => p[i] != null && p[i].toLowerCase() === parts[0][i]?.toLowerCase())) i++;
  return parts.map((p) => { const d = p[i] ?? p.at(-1); const last = p.at(-1); return d === last ? d : `${d} · ${last}`; });
}
/** Where the job works: the picked folder (a client's), else its project's folder; null = a new scratch folder. */
const jobFolder = () => J.folder ?? (J.project ? projectBySlug(J.project)?.folder ?? null : null);
const engineSub = (k) => { const m = k === J.engine ? J.model : lastModel(k); return m ? modelLabel(m).replace(' (latest)', '') : 'Default model'; };
function renderJobSheet(fresh = false) {
  const tasks = J.taskIds.map((id) => AOS.taskById(id)).filter(Boolean);
  const idea = J.ideaId ? ideaById(J.ideaId) : null;
  const p = J.project ? projectBySlug(J.project) : null;
  const n = tasks.length + (idea ? 1 : 0);
  const sub = [J.client ? `For ${esc(J.client.name)}` : n ? `${AOS.plural(n, 'item')} in one session` : '', 'runs on your PC'].filter(Boolean).join(' · ');
  $('.sheet-head', jobEl).innerHTML = `<div class="jsh-head"><div><h2>Start a job</h2><p>${sub.charAt(0).toUpperCase()}${sub.slice(1)}</p></div><button type="button" class="sheet-close" data-js-close aria-label="Close">${AOS.icons.x}</button></div>`;
  const items = [...tasks.map((t) => `<div class="lrow js-it"><i class="dot" style="--c:${AOS.color(t.area)}"></i><span class="rbody"><span class="rtitle wrap">${esc(t.title)}</span></span><span class="cap">Task</span></div>`),
    ...(idea ? [`<div class="lrow js-it"><i class="dot" style="--c:var(--needs)"></i><span class="rbody"><span class="rtitle wrap">${esc(idea.title)}</span></span><span class="cap">Idea</span></div>`] : [])].join('');
  const keep = fresh ? J.context : $('#jsCtx', jobEl)?.value ?? J.context;
  const folder = jobFolder();
  const names = folderNames(J.folders);
  const placeChips = J.folders.length
    ? `<div class="chips scroll" role="radiogroup" aria-label="Folder">${J.folders.map((f, i) => `<button type="button" class="chip-btn${f === J.folder ? ' on' : ''}" role="radio" aria-checked="${f === J.folder}" data-js-folder="${esc(f)}">${AOS.icons.folder}${esc(names[i])}</button>`).join('')}</div>`
    : `<div class="chips scroll js-projects">${projectChips(J.project)}</div>`;
  const path = folder ? `<p class="js-path mono">${esc(folder)}</p>` : `<p class="js-path">${p ? `${esc(p.name)} has no folder, so it runs in a new scratch folder. <button type="button" class="text-btn" data-ws-setfolder="${esc(p.slug)}">Set its folder</button>` : 'No project: it runs in a new scratch folder in agentic-jobs.'}</p>`;
  $('.sheet-body', jobEl).innerHTML = `${items ? `<div class="group js-items">${items}</div>` : ''}
<div class="ctx-box js-ask"><textarea id="jsCtx" rows="2" placeholder="${n ? 'Anything to add (optional)' : 'What should the job do?'}" aria-label="What the job should do">${esc(keep)}</textarea>${voice.micButtonHTML('data-mic-for="jsCtx"')}</div><div class="rec-slot" data-rec-for="jsCtx"></div>
<div data-att-host="new-job">${attach.attachRowHTML('new-job')}${attach.trayHTML('new-job')}</div>
<p class="js-lbl">Engine</p>
<div class="js-eng" role="radiogroup" aria-label="Engine">${['claude', 'codex'].map((k) => `<button type="button" class="eng-card${J.engine === k ? ' on' : ''}" role="radio" aria-checked="${J.engine === k}" data-engine="${k}"><span class="eng-ic"><span class="agent ${k}">${AOS.icons[k]}</span><span class="eng-tick">${AOS.icons.check}</span></span><span class="eng-txt"><b>${ENGINE[k]}</b><small>${esc(engineSub(k))}</small></span></button>`).join('')}</div>
<p class="js-lbl">Where</p>
${placeChips}
${path}
${modelFieldHTML(J.engine, J.model, 'data-js-model')}
${effortFieldHTML(J.engine, J.effort, 'data-js-effort')}
<div class="group js-sets">${copyRowHTML()}
<label class="lrow jsw-row"><span class="rbody"><span class="rtitle">Plan first</span><span class="rmeta wrap">It writes a plan and waits for your OK before changing anything</span></span><input type="checkbox" switch id="jsPlan" ${J.plan ? 'checked' : ''} /></label>
<label class="lrow jpick-row"><span class="rbody"><span class="rtitle">Permissions</span><span class="rmeta wrap">${esc(JS_MODES.find(([v]) => v === J.mode)?.[2] ?? '')}</span></span><span class="rend">${esc(JS_MODES.find(([v]) => v === J.mode)?.[1] ?? J.mode)}${AOS.CHEV}</span><select data-js-mode aria-label="Permissions">${JS_MODES.map(([v, l]) => `<option value="${v}"${v === J.mode ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
<p class="jhint js-hint">${hintText()}</p>
<button class="btn primary block js-go" id="jsStart" type="button" style="--c:var(--jobs-fill)">${AOS.icons[J.engine]}Start job with ${ENGINE[J.engine]}</button>`;
  // a sheet opened again starts at its top, not where the last one was left
  if (fresh) { $('.sheet-body', jobEl).scrollTop = 0; attach.clear('new-job'); } else attach.changed('new-job');
}
/** Its own copy: a switch when the folder is a git repo with commits; otherwise why it works in the folder itself. */
function copyRowHTML() {
  const folder = jobFolder();
  const r = folder ? repoOf(folder, () => { if (J) renderCopy(); }) : null;
  const can = !!folder && (!r || (r.repo && r.hasCommits));
  const on = can && J.worktree;
  const note = !folder ? 'No folder, so it works in a new scratch folder'
    : !r ? 'Checking the folder…'
    : !r.repo ? 'The folder isn’t a git repo, so it works in the folder itself'
    : !r.hasCommits ? 'The repo has no commits yet, so it works in the folder itself'
    : on ? `Its own branch off ${r.branch ?? 'the current branch'}; other jobs can’t clash with it. Its Builder merges it`
    : `Works straight in the folder${r.branch ? ` on ${r.branch}` : ''}; other jobs there see its changes at once`;
  return `<label class="lrow jsw-row js-copy${can ? '' : ' off'}"><span class="rbody"><span class="rtitle">Own copy (worktree)</span><span class="rmeta wrap">${esc(note)}</span></span><input type="checkbox" switch data-js-wt ${on ? 'checked' : ''} ${can ? '' : 'disabled'} /></label>`;
}
function hintText() {
  const folder = jobFolder();
  const r = folder ? repoOf(folder) : null;
  const copy = !!folder && J.worktree && (!r || (r.repo && r.hasCommits));
  return `Runs on your PC ${copy ? `in its own copy of ${esc(folderName(folder))}` : folder ? `in ${esc(folderName(folder))}` : 'in a new scratch folder'}. Every step shows in Jobs.`;
}
/** Redraw only the copy row and the hint, so the text being typed keeps its focus. */
function renderCopy() {
  const row = $('.js-copy', jobEl);
  if (!row || !J) return;
  const html = copyRowHTML();
  if (row._html !== html) { row.outerHTML = html; $('.js-copy', jobEl)._html = html; }
  const h = $('.js-hint', jobEl);
  if (h) h.innerHTML = hintText();
}
jobEl.addEventListener('click', async (e) => {
  if (e.target.closest('[data-js-close]')) { jobSheet.close(); return; }
  const eng = e.target.closest('[data-engine]');
  if (eng) { J.engine = eng.dataset.engine; try { localStorage.setItem(ENGINE_KEY, J.engine); } catch {} J.model = lastModel(J.engine); J.effort = lastEffort(J.engine); AOS.haptic('selection'); renderJobSheet(); return; }
  const ml = e.target.closest('[data-js-model]');
  if (ml) { J.model = ml.dataset.jsModel; rememberModel(J.engine, J.model); AOS.haptic('selection'); renderJobSheet(); return; }
  const ef = e.target.closest('[data-js-effort]');
  if (ef) { J.effort = ef.dataset.jsEffort; rememberEffort(J.engine, J.effort); AOS.haptic('selection'); renderJobSheet(); return; }
  const pp = e.target.closest('[data-pick-project]');
  if (pp) { J.project = pp.dataset.pickProject || null; AOS.haptic('selection'); renderJobSheet(); return; }
  const fd = e.target.closest('[data-js-folder]');
  if (fd) { J.folder = fd.dataset.jsFolder; AOS.haptic('selection'); renderJobSheet(); return; }
  const go = e.target.closest('#jsStart');
  if (!go || go.disabled) return;
  if (voice.busy()) { AOS.toast('Finish the recording first'); return; }
  if (attach.uploading('new-job')) { AOS.toast('Wait for the attachments to finish uploading'); return; }
  const files = attach.ids('new-job');
  const context = $('#jsCtx', jobEl).value.trim() || (files.length ? 'See the attached files.' : null);
  if (!context && !J.taskIds.length && !J.ideaId) { AOS.toast('Say what the job should do'); $('#jsCtx', jobEl).focus(); return; }
  go.disabled = true;
  go.textContent = 'Starting';
  const first = String(context ?? '').split('\n')[0];
  const title = J.title ?? (J.folder && first ? (first.length > 80 ? `${first.slice(0, 78).trimEnd()}…` : first) : null);
  const ok = await startJob({ engine: J.engine, model: J.model || null, effort: J.effort || null, taskIds: J.taskIds, ideaId: J.ideaId, project: J.project, cwd: J.folder || null, title,
    context, attachments: files, mode: J.mode, plan: J.plan, worktree: J.worktree || null });
  if (ok) { attach.clear('new-job'); jobSheet.close(); } else { go.disabled = false; renderJobSheet(); }
});
jobEl.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'jsPlan') { J.plan = t.checked; AOS.haptic('selection'); }
  else if (t.matches('[data-js-wt]')) { J.worktree = t.checked; rememberWorktree(J.worktree); AOS.haptic('selection'); renderCopy(); }
  else if (t.matches('[data-js-mode]')) { J.mode = t.value; AOS.haptic('selection'); renderJobSheet(); }
});
onChange(() => { if (J && jobSheet.isOpen) renderCopy(); });
// "Set its folder" under Where it works: edit the project; the sheets pick up the folder when it's saved.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-ws-setfolder]');
  if (b) { e.preventDefault(); openProjectSheet(b.dataset.wsSetfolder); }
});

/** POST /jobs, then open its live page. Returns the job or null. */
export async function startJob(body) {
  try {
    const clean = Object.fromEntries(Object.entries(body).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length)));
    const r = await AOS.api('/jobs', { method: 'POST', body: JSON.stringify(clean) });
    const job = r.job;
    putJob(job);
    // The PC already moved linked tasks to doing; mirror that without sending it back.
    for (const id of body.taskIds ?? []) { const t = AOS.taskById(id); if (t && t.status !== 'done') AOS.adopt('task', { id: t.id, status: 'doing', jobIds: [...new Set([...(t.jobIds ?? []), job.id])] }); }
    if (body.ideaId) { const i = ideaById(body.ideaId); if (i) putIdea({ ...i, status: 'jobbed', jobId: job.id }); }
    AOS.touchProject(body.project);
    AOS.haptic('success');
    AOS.render();
    openJob(job.id);
    return job;
  } catch (e) {
    AOS.toast(e.status ? e.message : 'Your PC isn’t reachable right now');
    return null;
  }
}
export function openJob(id) {
  const ui = AOS.ui();
  if (!ui.stack[ui.tab]) AOS.setTab('projects');
  const top = AOS.topDetail();
  if (top?.dataset.kind === 'job' && top.dataset.id === id) return;
  AOS.push('job', id);
}

// ---------- The + sheet in Job mode: engine buttons and context, inline ----------
export function renderCapJob(el, cap) {
  if (!el.firstChild) {
    cap.engine = lastEngine();
    cap.model = lastModel(cap.engine);
    cap.effort = lastEffort(cap.engine);
    loadModels(() => { if (el.isConnected && el.firstChild) renderCapJob(el, cap); });
    el.innerHTML =`<div class="engine-pick small" role="radiogroup" aria-label="Engine">${['claude', 'codex'].map((k) => `<button type="button" class="engine" role="radio" data-cap-engine="${k}">${ENGINE_SVG[k]}<b>${ENGINE[k]}</b></button>`).join('')}</div>
<div class="cap-model"></div>
<div class="cap-effort"></div>
<div class="cap-ws"></div>
<div class="field cap-ctx"><span class="f-label">Additional context</span>${ctxField('capCtx', '', 'Optional')}</div>`;
  }
  for (const b of el.querySelectorAll('[data-cap-engine]')) { const on = b.dataset.capEngine === cap.engine; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
  $('.cap-model', el).innerHTML = modelFieldHTML(cap.engine, cap.model ?? '', 'data-cap-model');
  $('.cap-effort', el).innerHTML = effortFieldHTML(cap.engine, cap.effort ?? '', 'data-cap-effort');
  cap.worktree ??= lastWorktree();
  // A pinned client's job works in that client's folder unless the picked project has its own (startJobFromCapture
  // follows the same rule), so the field shows the folder it will really use.
  const proj = cap.project ? projectBySlug(cap.project) : null;
  const folder = proj?.folder ? null : capFolder(cap);
  const where = folder ? { name: cap.client?.name ?? folderName(folder), folder, slug: null, kind: 'client' } : proj;
  $('.cap-ws', el).innerHTML = whereFieldHTML(where, cap.worktree, () => { if (el.isConnected && el.firstChild) renderCapJob(el, cap); }, 'data-cap-ws');
}
/** The folder of the client pinned in the + sheet, from the Clients module; null without one. */
const capFolder = (cap) => (cap?.client?.slug ? AOS.crm?.placesOf?.(cap.client.slug)?.[0]?.path ?? null : null);
document.addEventListener('click', (e) => {
  const ws = e.target.closest('[data-cap-ws]');
  if (ws) {
    const cap = AOS.capState();
    cap.worktree = ws.dataset.capWs === 'copy';
    rememberWorktree(cap.worktree);
    AOS.haptic('selection');
    renderCapJob(ws.closest('#capJob'), cap);
    return;
  }
  const ef = e.target.closest('[data-cap-effort]');
  if (ef) {
    const cap = AOS.capState();
    cap.effort = ef.dataset.capEffort;
    rememberEffort(cap.engine, cap.effort);
    AOS.haptic('selection');
    renderCapJob(ef.closest('#capJob'), cap);
    return;
  }
  const m = e.target.closest('[data-cap-model]');
  if (m) {
    const cap = AOS.capState();
    cap.model = m.dataset.capModel;
    rememberModel(cap.engine, cap.model);
    AOS.haptic('selection');
    renderCapJob(m.closest('#capJob'), cap);
    return;
  }
  const b = e.target.closest('[data-cap-engine]');
  if (!b) return;
  const cap = AOS.capState();
  cap.engine = b.dataset.capEngine;
  cap.model = lastModel(cap.engine);
  cap.effort = lastEffort(cap.engine);
  try { localStorage.setItem(ENGINE_KEY, cap.engine); } catch {}
  AOS.haptic('selection');
  renderCapJob(b.closest('#capJob'), cap);
  document.getElementById('captureInput').dispatchEvent(new Event('input', { bubbles: true }));
});
/** folder: where the job works (the pinned client's folder), the same as openJobSheet({ folder }). A picked project
 *  that has a folder works there instead, as the sheet's "Where it works" field shows. */
export async function startJobFromCapture({ text, project, engine, model, effort, folder = null }) {
  const ctx = document.getElementById('capCtx')?.value.trim();
  const first = text.split('\n')[0];
  const title = first.length > 80 ? `${first.slice(0, 78).trimEnd()}…` : first;
  document.getElementById('capJob').innerHTML = '';
  const worktree = AOS.capState?.()?.worktree ?? lastWorktree();
  const cwd = folder && !(project && projectBySlug(project)?.folder) ? folder : null;
  await startJob({ engine, model: model || null, effort: effort || null, project, cwd, title, context: ctx ? `${text}\n\n${ctx}` : text, mode: 'auto', worktree: worktree || null });
}
export async function saveIdea({ text, project, source, recordingId }) {
  const idea = await createIdea({ text, project, source, recordingId });
  const where = project ? projectBySlug(project)?.name ?? 'the project' : 'Ideas';
  AOS.toast(idea?.pending ? `Saved on this phone. It goes to ${where} when your PC is reachable` : `Idea saved to ${where}`);
}

/** Make an idea a task (in its project, or the inbox); the idea leaves the open list. Returns the task, or null. */
export async function ideaToTask(id) {
  const i = ideaById(id);
  if (!i) return null;
  if (i.pending) { AOS.toast('Still saving this idea. Try again when your PC is reachable'); return null; }
  try {
    const r = await AOS.api(`/ideas/${i.id}/task`, { method: 'POST', body: JSON.stringify({ project: i.project ?? undefined }) });
    AOS.adopt('task', r.task);
    putIdea(r.idea);
    AOS.haptic('success');
    AOS.render();
    AOS.toast(r.task.status === 'inbox' ? 'Task added to the inbox' : 'Turned into a task');
    return r.task;
  } catch (err) { AOS.toast(err.status ? err.message : 'Your PC isn’t reachable right now'); return null; }
}

// ---------- Idea sheet ----------
const ideaEl = sheetEl('ideaSheet', 'Idea', 'idea-sheet');
const ideaSheet = AOS.makeSheet(ideaEl, { detents: (H) => ({ large: 0, half: Math.round(H * 0.3) }), scrimFor });
let ideaId = null;
export function openIdea(id) {
  ideaId = id;
  if (!ideaById(id)) return;
  renderIdea();
  ideaSheet.open('half');
}
function renderIdea() {
  const i = ideaById(ideaId);
  if (!i) { ideaSheet.close(); return; }
  const task = i.taskId ? AOS.taskById(i.taskId) : null;
  const state = i.pending ? 'Saved on this phone, waiting for your PC.'
    : i.status === 'tasked' ? `Made into a task${task ? `: ${esc(task.title)}` : ''}.`
    : i.status === 'jobbed' ? 'A job is working on it.' : `Idea · ${esc(i.source ?? 'app')} · ${new Date(i.createdAt ?? Date.now()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
  $('.sheet-head', ideaEl).innerHTML = `<div class="ih-row idea"><span class="idea-bulb" aria-hidden="true"></span><input class="ih-title" id="ideaTitle" value="${esc(i.title)}" aria-label="Idea" enterkeyhint="done" autocomplete="off" /></div><p class="ih-sub">${state}</p>`;
  $('.sheet-body', ideaEl).innerHTML = `<div class="field"><span class="f-label">Notes</span>${ctxField('ideaBody', i.body ?? '', 'More detail, or record it')}</div>
<div class="field"><span class="f-label">Project</span><div class="chips scroll">${projectChips(i.project, 'data-idea-project')}</div></div>
<div class="actions">${i.status === 'tasked' && task ? '<button class="act" data-idea-act="open-task">Open task</button>' : '<button class="act primary" data-idea-act="task">Make a task</button>'}<button class="act${i.status === 'tasked' ? ' primary' : ''}" data-idea-act="job">Start a job</button><button class="act danger" data-idea-act="archive">Archive</button></div>
${i.jobId ? `<button class="text-btn idea-job" data-open-job="${esc(i.jobId)}">Open its job</button>` : ''}`;
}
async function patchIdea(patch) {
  const i = ideaById(ideaId);
  if (!i) return;
  Object.assign(i, patch);
  emit();
  if (i.pending) return;
  try { const r = await AOS.api(`/ideas/${i.id}`, { method: 'PATCH', body: JSON.stringify(patch) }); putIdea(r.idea); }
  catch (e) { AOS.toast(e.status ? e.message : 'Saved here. Your PC isn’t reachable right now'); }
}
ideaEl.addEventListener('change', (e) => {
  if (e.target.id === 'ideaTitle') { const v = e.target.value.trim(); if (v) patchIdea({ title: v }); }
  if (e.target.id === 'ideaBody') patchIdea({ body: e.target.value.trim() || null });
});
ideaEl.addEventListener('input', (e) => {
  // Text from the mic arrives as an input event: save it like a typed change.
  if (e.target.id === 'ideaBody' && !document.activeElement?.isSameNode(e.target)) patchIdea({ body: e.target.value.trim() || null });
});
ideaEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'ideaTitle') e.target.blur(); });
ideaEl.addEventListener('click', async (e) => {
  const i = ideaById(ideaId);
  if (!i) return;
  const pj = e.target.closest('[data-idea-project]');
  if (pj) { AOS.haptic('selection'); await patchIdea({ project: pj.dataset.ideaProject || null }); AOS.touchProject(i.project); renderIdea(); return; }
  const oj = e.target.closest('[data-open-job]');
  if (oj) { ideaSheet.close(); openJob(oj.dataset.openJob); return; }
  const b = e.target.closest('[data-idea-act]');
  if (!b) return;
  if (i.pending) { AOS.toast('Still saving this idea. Try again when your PC is reachable'); return; }
  const act = b.dataset.ideaAct;
  if (act === 'task') {
    b.disabled = true;
    if (await ideaToTask(i.id)) renderIdea(); else b.disabled = false;
  } else if (act === 'open-task') { ideaSheet.close(); AOS.openItem(i.taskId); }
  else if (act === 'job') { ideaSheet.close(); openJobSheet({ ideaId: i.id }); }
  else if (act === 'archive') {
    const snap = { ...i };
    try {
      await AOS.api(`/ideas/${i.id}`, { method: 'DELETE' });
      putIdea({ ...i, status: 'archived' });
      ideaSheet.close();
      AOS.toast('Idea archived', async () => {
        try { const r = await AOS.api(`/ideas/${snap.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'open' }) }); putIdea(r.idea); } catch {}
      });
    } catch (err) { AOS.toast(err.status ? err.message : 'Your PC isn’t reachable right now'); }
  }
});

// ---------- Project sheet: new or edit, with the folder picker ----------
const projEl = sheetEl('projectSheet', 'Project', 'project-sheet');
const projSheet = AOS.makeSheet(projEl, { detents: (H) => ({ large: 0 }), scrimFor });
const ICONS = ['🚀', '🛍️', '🎬', '🤖', '📦', '💡', '🧪', '📚', '🏪', '✍️', '📈', '🎯'];
let P = null;   // { slug|null, name, icon, area, folder, description, status, folders, filter, picking }
export function openProjectSheet(slug = null) {
  const p = slug ? projectBySlug(slug) : null;
  P = { slug: p?.slug ?? null, name: p?.name ?? '', icon: p?.icon ?? '', area: p?.area ?? null, folder: p?.folder ?? '', description: p?.description ?? '', status: p?.status ?? 'active', folders: null, filter: '', picking: false };
  renderProject();
  projSheet.open('large');
  if (!slug) setTimeout(() => $('#pjName', projEl)?.focus({ preventScroll: true }), 30);
}
function renderProject() {
  $('.sheet-head', projEl).innerHTML = `<h2>${P.slug ? 'Edit project' : 'New project'}</h2><p>${P.slug ? esc(P.slug) : 'Its ideas, tasks, jobs and sessions live together.'}</p>`;
  const areas = [...AOS.areas.values()].map((a) => `<button type="button" class="chip-btn${P.area === a.slug ? ' on' : ''}" data-pj-area="${esc(a.slug)}" style="--c:${a.color}"><i></i>${esc(AOS.areaShort(a.slug))}</button>`).join('')
    + `<button type="button" class="chip-btn${!P.area ? ' on' : ''}" data-pj-area="">None</button>`;
  const statuses = P.slug ? `<div class="field"><span class="f-label">Status</span><div class="chips">${['active', 'paused', 'done', 'archived'].map((s) => `<button type="button" class="chip-btn${P.status === s ? ' on' : ''}" data-pj-status="${s}">${s[0].toUpperCase()}${s.slice(1)}</button>`).join('')}</div></div>` : '';
  $('.sheet-body', projEl).innerHTML = `<div class="pj-form">
<div class="pj-name-row"><input id="pjIcon" class="pj-icon-in" maxlength="4" value="${esc(P.icon)}" placeholder="📁" aria-label="Icon" /><input id="pjName" class="pj-name-in" value="${esc(P.name)}" placeholder="Name" aria-label="Name" autocomplete="off" enterkeyhint="next" /></div>
<div class="chips scroll pj-icons">${ICONS.map((i) => `<button type="button" class="chip-btn icon-chip${P.icon === i ? ' on' : ''}" data-pj-icon="${i}">${i}</button>`).join('')}</div>
<div class="field"><span class="f-label">Area</span><div class="chips scroll">${areas}</div></div>
<div class="field"><span class="f-label">Folder on your PC</span><p class="f-help">Jobs and sessions run here. Sessions you open in this folder show in the project.</p>
<button type="button" class="pj-folder" data-pj-pick>${FOLDER_SVG}<span>${P.folder ? `<b>${esc(folderName(P.folder))}</b><code>${esc(P.folder)}</code>` : '<b>Choose a folder</b><small>Optional</small>'}</span><svg class="chev" viewBox="0 0 14 14"><path d="M5 2.5 9.5 7 5 11.5"/></svg></button>
${P.picking ? folderPickerHTML() : ''}</div>
<div class="field"><span class="f-label">Description</span><textarea id="pjDesc" rows="3" placeholder="What it is and what done looks like">${esc(P.description)}</textarea></div>
${statuses}
<button class="act primary wide" type="button" id="pjSave">${P.slug ? 'Save' : 'Create project'}</button></div>`;
}
function folderPickerHTML() {
  if (!P.folders) return '<div class="fp"><p class="quiet">Loading folders from your PC…</p></div>';
  if (P.folders.error) return `<div class="fp"><p class="quiet">${esc(P.folders.error)}</p><input id="pjFolderIn" class="fp-filter" placeholder="Type a full path" value="${esc(P.folder)}" /></div>`;
  const q = P.filter.toLowerCase();
  const list = P.folders.list.filter((f) => !q || f.path.toLowerCase().includes(q)).slice(0, 60);
  return `<div class="fp"><input id="pjFolderIn" class="fp-filter" placeholder="Filter, or type a full path" value="${esc(P.filter)}" autocomplete="off" />
<div class="fp-list">${list.map((f) => `<button type="button" class="fp-row${P.folder === f.path ? ' on' : ''}" data-pj-folder="${esc(f.path)}">${FOLDER_SVG}<span><b>${esc(f.name)}</b><small>${esc(f.path)}</small></span></button>`).join('') || '<p class="quiet">No folder matches. Tap Use to take the typed path.</p>'}</div>
${P.filter && /^[a-z]:[\\/]|^\//i.test(P.filter) ? `<button type="button" class="small-btn" data-pj-folder="${esc(P.filter)}">Use ${esc(P.filter)}</button>` : ''}
${P.folder ? '<button type="button" class="text-btn" data-pj-folder="">No folder</button>' : ''}</div>`;
}
async function loadFolders() {
  try {
    const r = await AOS.api('/folders');
    P.folders = { list: r.folders ?? [] };
  } catch (e) { P.folders = { error: e.status === 404 ? 'Folder list isn’t on your PC’s server yet.' : 'Your PC isn’t reachable right now.' }; }
  if (P.picking) { const keep = captureForm(); renderProject(); restoreForm(keep); }
}
const captureForm = () => ({ name: $('#pjName', projEl)?.value, icon: $('#pjIcon', projEl)?.value, desc: $('#pjDesc', projEl)?.value });
function restoreForm(k) { if (k.name != null) P.name = k.name; if (k.icon != null) P.icon = k.icon; if (k.desc != null) P.description = k.desc; }
projEl.addEventListener('input', (e) => {
  if (e.target.id === 'pjFolderIn') {
    P.filter = e.target.value;
    const pos = e.target.selectionStart;
    restoreForm(captureForm());
    renderProject();
    const inp = $('#pjFolderIn', projEl);
    inp.focus({ preventScroll: true });
    try { inp.setSelectionRange(pos, pos); } catch {}
  }
});
projEl.addEventListener('click', async (e) => {
  const t = e.target;
  const pick = (attr, key) => { const b = t.closest(`[${attr}]`); if (!b) return false; restoreForm(captureForm()); P[key] = b.getAttribute(attr) || null; AOS.haptic('selection'); renderProject(); return true; };
  if (pick('data-pj-icon', 'icon') || pick('data-pj-area', 'area') || pick('data-pj-status', 'status')) return;
  const f = t.closest('[data-pj-folder]');
  if (f) { restoreForm(captureForm()); P.folder = f.dataset.pjFolder; P.picking = false; AOS.haptic('selection'); renderProject(); return; }
  if (t.closest('[data-pj-pick]')) {
    restoreForm(captureForm());
    P.picking = !P.picking;
    renderProject();
    if (P.picking && !P.folders) loadFolders();
    return;
  }
  const save = t.closest('#pjSave');
  if (!save || save.disabled) return;
  restoreForm(captureForm());
  if (!P.name.trim()) { AOS.toast('Give it a name'); $('#pjName', projEl).focus(); return; }
  save.disabled = true;
  const body = { name: P.name.trim(), icon: P.icon.trim() || null, area: P.area, folder: P.folder || null, description: P.description.trim() || null };
  if (P.slug) body.status = P.status;
  try {
    const r = await AOS.api(P.slug ? `/projects/${P.slug}` : '/projects', { method: P.slug ? 'PATCH' : 'POST', body: JSON.stringify(body) });
    const project = r.project ?? r;
    AOS.adopt('project', project);
    AOS.touchProject(project.slug);
    projSheet.close();
    AOS.haptic('success');
    AOS.render();
    emit();
    if (!P.slug) { AOS.toast('Project created'); AOS.push('project', project.slug); }
    else loadProject(project.slug);   // a new folder brings its sessions
  } catch (err) { save.disabled = false; AOS.toast(err.status ? err.message : 'Your PC isn’t reachable right now'); }
});

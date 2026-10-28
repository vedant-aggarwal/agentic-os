// The jobs board: the Jobs tab's Board segment (tab.js mounts it through code.js, which adds compares and terminals).
// Lanes, in the order they need you: Needs you (an ask first, then replies waiting on you, then failures), Starred,
// Working, To review, Stopped, Completed, then the Builders, the terminals and the Archive. Live work is a card; a
// long lane of paused or finished work is one-line rows, folded after a few ("Show 10 more").
// Swipe a job right to move it one lane on (Working → stopped, Needs you → Completed, Completed → Archive), left to
// bring it back one (a stopped job carries on). Hold it to peek: its state, its last words and quick actions, with
// Move to… for the rest. With a mouse, drag rows between lanes and right-click for the peek. Every move has Undo.
// A plain OK (Allow, Always, Deny) is answered right on its card. Settings: cache, keep-warm, cleanup, terminals.
// Server: POST /jobs/:id/board, /jobs/:id/permission, /jobs/:id/fork, /jobs/board-settings, /jobs/builders.
import { W, emit, onChange, putJob, isLive, isActive, laneOf, JOB_LABEL, projectBySlug } from './state.js';
import { jobCardHTML, jobSmallHTML, jobRowHTML, agentHTML, SHIP_LABEL, shipHTML, agoText, engineName, plainLine, codeText, keptWarm, cacheLeft, stateWord } from './cards.js';
import { progOf } from './progress.js';
import { modelLabel, effortLabel } from './models.js';
import { sheetEl, scrimFor, openJob, lastWorktree, rememberWorktree } from './sheets.js';

const { AOS } = window;
const { esc } = AOS;
const I = AOS.icons;
const $ = (s, el = document) => el.querySelector(s);
const err = (e) => (e?.status ? e.message : 'Your PC isn’t reachable right now');
const fine = () => matchMedia('(pointer: fine)').matches;
const LANE_NAME = { working: 'Working', attention: 'Needs you', completed: 'Completed', archived: 'Archive' };
const CLOSE = `<button type="button" class="sheet-close" data-sheet-close aria-label="Close">${I.x}</button>`;
export const sheetHead = (title, sub = '') => `<div class="jsh-head"><div><h2>${title}</h2>${sub ? `<p>${sub}</p>` : ''}</div>${CLOSE}</div>`;

// ---------- Lanes ----------
/** The section a job shows in, each job once. An ask is always in Needs you, starred or not. */
export function sectionOf(j) {
  const lane = laneOf(j);
  if (lane === 'archived' || lane === 'working') return lane;
  if (j.status === 'needs_input') return 'needs';
  if (j.starred) return 'starred';
  if (j.review) return 'review';
  if (lane === 'completed') return 'completed';
  return j.status === 'stopped' ? 'stopped' : 'needs';
}
const DROP = { needs: 'attention', stopped: 'attention', starred: 'starred', working: 'working', review: 'review', completed: 'completed', archived: 'archived' };
const SECTION_NAME = { needs: 'Needs you', starred: 'Starred', working: 'Working', review: 'To review', stopped: 'Stopped', completed: 'Completed', archived: 'Archive' };
const at = (x) => x.updatedAt ?? x.createdAt ?? '';
const byTime = (a, b) => at(b).localeCompare(at(a));
const NEED_RANK = { needs_input: 0, idle: 1 };
function sections(jobs) {
  const by = { needs: [], starred: [], working: [], review: [], stopped: [], completed: [], archived: [] };
  for (const j of jobs) if (j.role !== 'builder') by[sectionOf(j)].push(j);
  for (const k of Object.keys(by)) by[k].sort(byTime);
  by.needs.sort((a, b) => (NEED_RANK[a.status] ?? 2) - (NEED_RANK[b.status] ?? 2) || byTime(a, b));
  return by;
}
const isAgentTerm = (t) => t.kind === 'claude' || t.kind === 'codex';
/** What the summary line says: asks and replies waiting, working, to review, stopped. Terminals count where they belong. */
export function boardCounts() {
  const by = sections(W.jobs);
  const terms = W.terms ?? [];
  return {
    needs: by.needs.length + terms.filter((t) => t.status === 'needs_input').length,
    asks: by.needs.filter((j) => j.status === 'needs_input').length + terms.filter((t) => t.status === 'needs_input').length,
    working: by.working.length + terms.filter((t) => isAgentTerm(t) && t.status === 'running').length,
    review: by.review.length, stopped: by.stopped.length,
  };
}

// What is folded open stays open while the app runs: Stopped, Completed, the Archive, ended terminals.
export const boardOpen = { stopped: false, completed: false, archived: false, ended: false };
const FOLD_AT = { stopped: 4, completed: 3 };
export const laneHead = (id, label, n, { needs = false, act = '' } = {}) =>
  `<div class="sh lane-h" id="lane-${id}"><h2>${label}</h2>${n ? `<span class="sh-count num${needs ? ' c-needs' : ''}">${n}</span>` : ''}${act}</div>`;
/** A group that shows the first few and folds the rest behind "Show N more". */
function foldGroup(key, list, row, cap = 40) {
  const open = boardOpen[key];
  const show = FOLD_AT[key] ?? 0;
  const fold = list.length > show + 1;
  const vis = fold && !open ? list.slice(0, show) : list.slice(0, cap);
  const more = fold ? `<button type="button" class="lrow jmore" data-bd-fold="${key}" aria-expanded="${open}"><span class="rbody">${open ? 'Show less' : `Show ${list.length - show} more`}</span>${open ? I.chevU : I.chevD}</button>` : '';
  return `<div class="group jgroup">${vis.map(row).join('')}${more}</div>`;
}
const lane = (key, body) => `<section class="bd-lane" data-drop="${DROP[key] ?? key}" data-sec="${key}">${body}</section>`;
const empty = (title, sub, icon, attrs = '') => attrs
  ? `<button type="button" class="lrow ic jempty" ${attrs}><span class="tile">${icon}</span><span class="rbody"><span class="rtitle">${title}</span><span class="rmeta">${sub}</span></span>${AOS.CHEV}</button>`
  : `<div class="lrow ic jempty"><span class="tile">${icon}</span><span class="rbody"><span class="rtitle">${title}</span><span class="rmeta">${sub}</span></span></div>`;

/** The whole board. compares and terminals are code.js's lanes, drawn in their places; needsTerms are its terminal
 *  rows that wait on you (n of them), shown in Needs you. */
export function boardHTML(jobs, { compares = '', terminals = '', needsTerms = '', needsTermsN = 0 } = {}) {
  const by = sections(jobs);
  const asks = by.needs.filter((j) => j.status === 'needs_input');
  const rest = by.needs.filter((j) => j.status !== 'needs_input');
  const canStart = AOS.owner && AOS.real;
  const drop = fine() ? '<p class="bd-empty">Drop a job here</p>' : '';
  const card = (j) => jobCardHTML(j);
  const small = (j) => jobSmallHTML(j);
  const needsN = by.needs.length + needsTermsN;
  const needsBody = needsN
    ? `${asks.length ? `<div class="jneeds">${asks.map((j) => `<div class="group jgroup">${card(j)}</div>`).join('')}</div>` : ''}${rest.length ? `<div class="group jgroup${asks.length ? ' jgap' : ''}">${rest.map(card).join('')}</div>` : ''}${needsTerms ? `<div class="group${by.needs.length ? ' jgap' : ''}">${needsTerms}</div>` : ''}`
    : `<div class="group">${empty('Nothing needs you', 'Jobs wait here when they need an OK or an answer.', I.check)}</div>`;
  const working = by.working.length
    ? `<div class="group jgroup">${by.working.map(card).join('')}</div>`
    : `<div class="group">${empty('Nothing running', canStart ? 'Start a job and it works here.' : 'Jobs run on the owner’s PC.', I.plus, canStart ? 'data-code-new' : '')}</div>`;
  const quiet = (key, label, list, row) => (list.length || drop ? lane(key, `${laneHead(key, label, list.length)}${list.length ? foldGroup(key, list, row) : drop}`) : '');
  return `<div class="board${fine() ? ' bd-fine' : ''}">
${lane('needs', `${laneHead('needs', 'Needs you', needsN, { needs: needsN > 0 })}${needsBody}`)}
${by.starred.length || drop ? lane('starred', `${laneHead('starred', 'Starred', by.starred.length)}${by.starred.length ? `<div class="group jgroup">${by.starred.map((j) => jobRowHTML(j, { status: true })).join('')}</div>` : drop}`) : ''}
${lane('working', `${laneHead('working', 'Working', by.working.length)}${working}`)}
${compares}
${by.review.length || drop ? lane('review', `${laneHead('review', 'To review', by.review.length)}${by.review.length ? `<div class="group jgroup">${by.review.map(card).join('')}</div>` : drop}`) : ''}
${quiet('stopped', 'Stopped', by.stopped, small)}
${quiet('completed', 'Completed', by.completed.slice(0, 30), small)}
${buildersHTML(jobs)}
${terminals}
${archiveHTML(by.archived)}
<p class="jhint">${fine() ? 'Drag a job to another lane to move it. Right-click one for more.' : 'Swipe a job right to move it on, left to bring it back. Hold one for more.'}</p>
</div>`;
}
// The archive: one row at the foot of the board that opens in place.
function archiveHTML(list) {
  if (!list.length) return fine() ? lane('archived', `${laneHead('archived', 'Archive', 0)}<p class="bd-empty">Drop a job here</p>`) : '';
  const open = boardOpen.archived;
  return lane('archived', `<div class="group jarch"><button type="button" class="lrow ic jarch-h" data-bd-fold="archived" aria-expanded="${open}"><span class="tile">${I.archive}</span><span class="rbody"><span class="rtitle">Archive</span></span><span class="rend"><span class="num">${list.length}</span>${AOS.CHEV}</span></button>${open ? list.slice(0, 40).map((j) => jobSmallHTML(j)).join('') : ''}</div>`);
}

// ---------- Builders: each project's Builder commits, merges, builds and deploys what its jobs hand over ----------
W.builders ??= null;   // GET /jobs/builders; [] when this PC's server has none
let buildersAt = 0;
export async function loadBuilders(force = false) {
  if (!AOS.owner || !AOS.real || (!force && Date.now() - buildersAt < 25000)) return;
  buildersAt = Date.now();
  try { W.builders = (await AOS.api('/jobs/builders')).builders ?? []; } catch { W.builders ??= []; }
  emit();
}
const builderName = (b) => (b.key === '_global' ? 'Global Builder' : projectBySlug(b.key)?.name ?? b.key);
const SHIPPING = ['queued', 'sent', 'committed', 'building'];
function builderNow(b) {
  const cur = (b.ships ?? []).find((s) => SHIPPING.includes(s.state));
  const j = b.job ? W.jobs.find((x) => x.id === b.job.id) ?? b.job : null;
  return { cur, j, busy: !!cur || (!!j && isActive(j)), last: (b.ships ?? []).find((s) => s.state === 'live' || s.state === 'failed') };
}
function builderRowHTML(b) {
  const { cur, j, busy, last } = builderNow(b);
  const sub = cur ? `<span class="mono">${esc(cur.jobId)}</span><span class="ell">${esc(SHIP_LABEL[cur.state] ?? cur.state)} · ${esc(cur.title)}</span>`
    : busy ? `<span>${esc(JOB_LABEL[j.status] ?? j.status)}</span>`
    : last ? `<span class="ell">Last ship ${last.state === 'live' ? 'live' : 'failed'} ${esc(agoText(last.at))}</span>`
    : '<span class="ell">Starts with the first request</span>';
  return `<button type="button" class="lrow ic jbuild" data-open-builder="${esc(b.key)}"><span class="tile">${I.hammer}</span><span class="rbody"><span class="rtitle">${esc(builderName(b))}</span><span class="rmeta">${sub}</span></span><span class="rend">${busy ? '<span class="spin" style="--c:var(--jobs)" role="img" aria-label="Building"></span>' : '<span class="cap">Idle</span>'}${AOS.CHEV}</span></button>`;
}
function buildersHTML(jobs) {
  const list = W.builders;
  if (list?.length) return `${laneHead('builders', 'Builders', list.length)}<div class="group">${list.map(builderRowHTML).join('')}</div>`;
  // An older server without /jobs/builders: its Builder chats, as job rows.
  const bj = jobs.filter((j) => j.role === 'builder' && laneOf(j) !== 'archived').sort(byTime);
  if (bj.length) return `${laneHead('builders', 'Builders', bj.length)}<div class="group jgroup">${bj.map((j) => jobRowHTML(j)).join('')}</div>`;
  return list ? `${laneHead('builders', 'Builders', 0)}<div class="group"><button type="button" class="lrow ic" data-open-builders><span class="tile">${I.hammer}</span><span class="rbody"><span class="rtitle">Builders</span><span class="rmeta">Each project’s Builder ships what its jobs hand over</span></span>${AOS.CHEV}</button></div>` : '';
}

// ---------- Moving a job ----------
/** One step on (+1) or back (-1) from where the job is: the lane it lands in, and the words for it. Null = no move. */
function step(j, dir) {
  const ln = laneOf(j);
  if (dir > 0) {
    if (ln === 'working') return { to: 'attention', label: 'Stop', done: 'Stopped', tone: 'fail' };
    if (ln === 'attention') return { to: 'completed', label: 'Complete', done: 'Completed', tone: 'done' };
    if (ln === 'completed') return { to: 'archived', label: 'Archive', done: 'Archived', tone: 'quiet' };
    return null;
  }
  if (ln === 'archived') return { to: 'completed', label: 'Unarchive', done: 'Back in Completed', tone: 'quiet' };
  if (ln === 'completed') return { to: 'attention', label: 'Reopen', done: 'Back in Needs you', tone: 'needs' };
  if (ln === 'attention' && (j.status === 'stopped' || j.status === 'failed')) return { to: 'working', label: 'Carry on', done: 'Carrying on', tone: 'ink' };
  return null;
}
/** Ask before something that costs: a sheet with the message and two buttons. Resolves true for OK. */
const askEl = sheetEl('askSheet', 'Confirm', 'ask-sheet');
const askSheet = AOS.makeSheet(askEl, { detents: (H) => ({ large: Math.round(H * 0.5), half: Math.round(H * 0.5) }), scrimFor });
let askDone = null;
export function ask({ title, body, ok = 'Send anyway', cancel = 'Cancel', danger = false }) {
  askDone?.(false);
  $('.sheet-head', askEl).innerHTML = `<h2>${esc(title)}</h2>`;
  $('.sheet-body', askEl).innerHTML = `<p class="ask-body">${esc(body)}</p><div class="ask-acts"><button class="act ${danger ? 'danger' : 'primary'} wide" data-ask-ok="1">${esc(ok)}</button><button class="act wide" data-ask-ok="0">${esc(cancel)}</button></div>`;
  askSheet.open('half');
  return new Promise((r) => { askDone = (v) => { askDone = null; r(v); }; });
}
askEl.addEventListener('click', (e) => { const b = e.target.closest('[data-ask-ok]'); if (!b) return; const v = b.dataset.askOk === '1'; askSheet.close(); askDone?.(v); });
/** POST to the job, and when the PC says the cache is cold (428), ask before sending again with force. */
export async function postCold(path, body) {
  try { return await AOS.api(path, { method: 'POST', body: JSON.stringify(body) }); }
  catch (e) {
    if (e.status !== 428) throw e;
    const go = await ask({ title: 'The cache is cold', body: e.message });
    if (!go) return null;
    return AOS.api(path, { method: 'POST', body: JSON.stringify({ ...body, force: true }) });
  }
}
async function board(j, body) {
  const r = await postCold(`/jobs/${j.id}/board`, body);
  if (r?.job) putJob(r.job);
  return r?.job ?? null;
}
export async function moveJob(j, to, { label = null, undo = true } = {}) {
  const from = laneOf(j);
  if (from === to) return;
  try {
    const next = await board(j, { lane: to });
    if (!next) return;
    AOS.haptic('success');
    AOS.toast(label ?? `Moved to ${LANE_NAME[to]}`, undo ? () => moveJob(next, from, { label: 'Moved back', undo: false }) : undefined);
  } catch (e) { AOS.toast(err(e)); }
}
async function flag(j, body, text, back) {
  try { await board(j, body); AOS.haptic('selection'); AOS.toast(text, back ? () => flag({ ...j, ...body }, back, 'Undone', null) : undefined); }
  catch (e) { AOS.toast(err(e)); }
}
async function warm(j, on) {
  try { await board(j, { keepWarm: on ? true : 0 }); AOS.haptic('selection'); AOS.toast(on ? 'Keeping the cache warm' : 'Keep-warm off for this job'); }
  catch (e) { AOS.toast(err(e)); }
}

// ---------- Answering an OK right on its card ----------
const DECIDED = { allow_once: 'Allowed once', allow_always: 'Allowed for this session', reject_once: 'Denied', reject_always: 'Denied for this session' };
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-ask]');
  if (!b || b.disabled) return;
  e.preventDefault();
  const j = W.jobs.find((x) => x.id === b.dataset.ask);
  const opt = j?.pending?.options?.find((o) => o.optionId === b.dataset.opt);
  const btns = [...b.parentElement.querySelectorAll('button')];
  for (const x of btns) x.disabled = true;
  AOS.haptic('success');
  try {
    const r = await AOS.api(`/jobs/${b.dataset.ask}/permission`, { method: 'POST', body: JSON.stringify({ requestId: b.dataset.req, optionId: b.dataset.opt }) });
    if (r?.job) putJob(r.job); else if (j) putJob({ ...j, pending: null, status: opt?.kind?.startsWith('reject') && j.pending?.kind === 'question' ? j.status : 'running' });
    AOS.toast(DECIDED[opt?.kind] ?? (b.dataset.opt === 'skip' ? 'Skipped' : 'Answered'));
  } catch (er) { for (const x of btns) x.disabled = false; AOS.toast(err(er)); }
});

// ---------- Swipe and hold (touch), right-click (mouse) ----------
const LONG = 420, ARM = 84;
let G = null;
let eatClick = false;
window.addEventListener('pointerdown', () => { eatClick = false; }, true);
window.addEventListener('click', (e) => { if (!eatClick) return; eatClick = false; e.stopPropagation(); e.preventDefault(); }, true);
/** A row is mid-swipe: the board holds its redraw until it ends. */
export const boardBusy = () => !!G && G.mode === 'swipe';
const jobOf = (row) => W.jobs.find((x) => x.id === row.dataset.openJob) ?? null;
function under(row, list, s, armed) {
  let u = list.querySelector('.bd-under');
  if (!u) { u = document.createElement('div'); list.insertBefore(u, list.firstChild); }
  u.className = `bd-under ${s.dir > 0 ? 'fwd' : 'back'} u-${s.tone}${armed ? ' armed' : ''}`;
  Object.assign(u.style, { top: `${row.offsetTop}px`, height: `${row.offsetHeight}px` });
  if (u.textContent !== s.label) u.innerHTML = `<span>${esc(s.label)}</span>`;
  return u;
}
function clearUnder(list) { list?.querySelectorAll('.bd-under').forEach((u) => u.remove()); }
document.addEventListener('pointerdown', (e) => {
  if (G || e.button > 0 || fine()) return;
  const row = e.target.closest('.board .job-row, .board-hold');
  if (!row || e.target.closest('.jask-b, .jmore')) return;
  const page = row.closest('.page.detail');
  if (page && e.clientX - page.getBoundingClientRect().left <= 24) return;   // the edge swipe back owns that strip
  const j = jobOf(row);
  if (!j) return;
  G = { row, j, id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, mode: 'pending', list: row.parentElement, t0: e.timeStamp };
  const g = G;
  g.timer = setTimeout(() => { if (G === g && g.mode === 'pending') { g.mode = 'held'; eatClick = true; openPeek(g.j); } }, LONG);
});
document.addEventListener('pointermove', (e) => {
  const g = G;
  if (!g || e.pointerId !== g.id) return;
  const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
  if (g.mode === 'pending') {
    if (Math.hypot(dx, dy) < 9) return;
    clearTimeout(g.timer);
    if (Math.abs(dx) > Math.abs(dy) * 1.3) { g.mode = 'swipe'; eatClick = true; try { g.row.setPointerCapture(g.id); } catch {} g.row.classList.add('swiping'); }
    else { g.mode = 'none'; G = null; return; }
  }
  if (g.mode !== 'swipe') return;
  const s = step(g.j, dx > 0 ? 1 : -1);
  // Resist where there is nowhere to go.
  const v = s ? dx : Math.sign(dx) * Math.min(28, Math.abs(dx) / 4);
  g.dx = v;
  g.row.style.transform = `translate3d(${v}px,0,0)`;
  const armed = !!s && Math.abs(v) > ARM;
  if (armed !== g.armed) { g.armed = armed; if (armed) AOS.haptic('light'); }
  if (s) under(g.row, g.list, { ...s, dir: Math.sign(dx) }, armed); else clearUnder(g.list);
}, { passive: true });
function endSwipe(e, cancelled) {
  const g = G;
  if (!g || e.pointerId !== g.id) return;
  G = null;
  clearTimeout(g.timer);
  if (g.mode !== 'swipe') return;
  const s = !cancelled && g.armed ? step(g.j, g.dx > 0 ? 1 : -1) : null;
  // Reduced motion: the row lets go where it is (no slide out); the move and its toast still say what happened.
  g.row.style.transition = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'transform 260ms var(--ease-out, ease-out)';
  g.row.style.transform = s ? `translate3d(${Math.sign(g.dx) * (g.row.offsetWidth + 20)}px,0,0)` : '';
  setTimeout(() => { g.row.style.transition = ''; if (!s) g.row.style.transform = ''; g.row.classList.remove('swiping'); clearUnder(g.list); }, 270);
  if (s) moveJob(g.j, s.to, { label: s.done }).finally(() => { g.row.style.transform = ''; emit(); });
}
document.addEventListener('pointerup', (e) => endSwipe(e, false));
document.addEventListener('pointercancel', (e) => endSwipe(e, true));
document.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.board .job-row');
  if (!row) return;
  e.preventDefault();
  // A mouse has no hold: the right button peeks instead.
  if (fine()) { const j = jobOf(row); if (j) openPeek(j); }
});

// ---------- Drag between lanes (mouse) ----------
document.addEventListener('dragstart', (e) => {
  const row = e.target.closest?.('.board .job-row');
  if (!row) return;
  e.dataTransfer.setData('text/x-aos-job', row.dataset.openJob);
  e.dataTransfer.effectAllowed = 'move';
  row.classList.add('dragging');
  document.querySelector('.board')?.classList.add('bd-dragging');
});
document.addEventListener('dragend', (e) => {
  e.target.closest?.('.board .job-row')?.classList.remove('dragging');
  document.querySelectorAll('.bd-dragging, .bd-over').forEach((x) => x.classList.remove('bd-dragging', 'bd-over'));
});
document.addEventListener('dragover', (e) => {
  const ln = e.target.closest?.('.board [data-drop]');
  if (!ln || !e.dataTransfer.types.includes('text/x-aos-job')) return;
  e.preventDefault();
  document.querySelectorAll('.bd-over').forEach((x) => x !== ln && x.classList.remove('bd-over'));
  ln.classList.add('bd-over');
});
document.addEventListener('drop', (e) => {
  const ln = e.target.closest?.('.board [data-drop]');
  const id = e.dataTransfer?.getData('text/x-aos-job');
  if (!ln || !id) return;
  e.preventDefault();
  const j = W.jobs.find((x) => x.id === id);
  if (!j) return;
  const to = ln.dataset.drop;
  if (to === 'starred') flag(j, { starred: true }, 'Starred', { starred: false });
  else if (to === 'review') flag(j, { review: true }, 'Marked for review', { review: false });
  else {
    const off = { ...(j.starred ? { starred: false } : {}), ...(j.review ? { review: false } : {}) };
    (Object.keys(off).length ? board(j, off) : Promise.resolve()).then(() => moveJob(W.jobs.find((x) => x.id === id) ?? j, to, { label: to === 'working' && j.status !== 'running' ? 'Carrying on' : `Moved to ${LANE_NAME[to]}` }));
  }
});
// Rows are draggable only with a mouse; touch keeps swipes.
onChange(() => { if (fine()) document.querySelectorAll('.board .job-row').forEach((r) => { r.draggable = true; }); });

// ---------- Folding: Stopped, Completed, the Archive, ended terminals ----------
document.addEventListener('click', (e) => {
  const f = e.target.closest('[data-bd-fold]');
  if (!f) return;
  boardOpen[f.dataset.bdFold] = !boardOpen[f.dataset.bdFold];
  AOS.haptic('selection');
  for (const box of document.querySelectorAll('.code-page')) box._draw?.(true);
});

// ---------- Hold: the peek ----------
/** The job's state and last words over a veil, with its quick actions; Move to… opens the full menu. */
export function openPeek(j) {
  const pr = progOf(j.progress);
  const live = isLive(j) && ['starting', 'running', 'needs_input'].includes(j.status);
  const p = j.project ? projectBySlug(j.project) : null;
  const kicker = [engineName(j), j.model ? modelLabel(j.model).replace(' (latest)', '') : null, j.effort ? effortLabel(j.effort) : null].filter(Boolean).join(' · ');
  const [word, wcls] = stateWord(j);
  const running = j.status === 'running' || j.status === 'starting';
  const ring = pr ? `<div class="pk-prog">${AOS.ring(Math.min(1, pr.done / pr.total), 'jobs', 60, 7, { cls: `jring${running ? ' running' : ''}`, inner: agentHTML(j), label: `${pr.done} of ${pr.total} steps` })}<span><b class="met c-jobs">${pr.done}<small>/${pr.total}</small></b><span class="foot">${esc([pr.active, pr.stage].filter(Boolean).join(' · '))}</span></span></div>` : '';
  const askLine = j.status === 'needs_input' ? `<p class="pk-ask">${j.pending?.kind === 'question' || j.pending?.form ? I.chat : I.shield}<span>${j.pending?.title ? codeText(j.pending.title) : 'It is waiting for your OK.'}</span></p>` : '';
  const out = plainLine(j.status === 'failed' ? j.error : j.lastText || j.summary, 420);
  const where = [`<span class="${wcls}">${esc(word)}</span>`, p ? esc(p.name) : '', esc(agoText(j.updatedAt ?? j.createdAt))].filter(Boolean).join(' · ');
  const body = `<div class="pk jpk"><div class="kicker">${esc(kicker)}</div><h3 class="t1">${esc(j.title || 'Job')}</h3>${ring || `<p class="foot pk-st">${where}</p>`}${askLine}${out ? `<p class="pk-out${j.status === 'failed' ? ' err' : ''}">${esc(out)}</p>` : ''}</div>`;
  const cache = cacheLeft(j) != null;
  const menu = [
    { label: 'Open', icon: I.chevR, run: () => openJob(j.id) },
    { label: j.starred ? 'Unstar' : 'Star', icon: I.star, run: () => flag(j, { starred: !j.starred }, j.starred ? 'Unstarred' : 'Starred', { starred: !!j.starred }) },
    { label: j.review ? 'Clear review' : 'Mark for review', icon: I.eye, run: () => flag(j, { review: !j.review }, j.review ? 'Review cleared' : 'Marked for review', { review: !!j.review }) },
    cache ? { label: keptWarm(j) ? 'Stop keeping it warm' : 'Keep the cache warm', icon: I.flame, run: () => warm(j, !keptWarm(j)) } : null,
    live ? { label: 'Stop', icon: I.stop, danger: true, run: () => moveJob(j, 'attention', { label: 'Stopped' }) } : null,
    { label: 'Move to…', icon: I.dots, run: () => openMenu(j) },
  ].filter(Boolean);
  AOS.peek(body, menu);
  const w = document.getElementById('peek');
  menu.forEach((m, i) => { if (m.danger) w?.querySelector(`[data-peek-i="${i}"]`)?.classList.add('danger'); });
  AOS.pulse(w);
}

// ---------- The job menu: everything you can do to a job, from the peek or the job page's ⋯ ----------
const menuEl = sheetEl('jobMenuSheet', 'Job', 'job-menu');
const menuSheet = AOS.makeSheet(menuEl, { detents: (H) => ({ large: 0, half: Math.round(H * 0.22) }), scrimFor });
let M = null;   // { j, page: { done?, rewind? } | null, step: 'menu' }
const WARM = [['0', 'Off'], ['1', '1 h'], ['3', '3 h'], ['8', '8 h'], ['', 'Default']];
/** page: the job page's own actions (Mark done…, Rewind…), when the menu opens from it. */
export function openMenu(j, page = null) {
  M = { j, page };
  drawMenu();
  menuSheet.open('half');
}
const mrow = (k, icon, label, { danger = false, sub = '' } = {}) => `<button type="button" class="lrow ic${danger ? ' jm-danger' : ''}" data-jm="${k}"><span class="tile">${icon}</span><span class="rbody"><span class="rtitle">${label}</span>${sub ? `<span class="rmeta"><span class="ell">${sub}</span></span>` : ''}</span></button>`;
function drawMenu() {
  const j = W.jobs.find((x) => x.id === M?.j?.id) ?? M?.j;
  if (!j) return;
  M.j = j;
  const ln = laneOf(j);
  const live = isLive(j) && ['starting', 'running', 'needs_input'].includes(j.status);
  const kw = j.cache?.keepWarm;
  const kwLeft = keptWarm(j) ? Math.max(0, Math.round((Date.parse(j.cache.keepWarmUntil) - Date.now()) / 360000) / 10) : null;
  const sec = sectionOf(j);
  const sub = [engineName(j), j.model ? modelLabel(j.model).replace(' (latest)', '') : null, j.effort ? effortLabel(j.effort) : null, SECTION_NAME[sec], j.ship ? SHIP_LABEL[j.ship.state] ?? j.ship.state : null].filter(Boolean).join(' · ');
  // the lane chips say where the job sits on the board: a stopped job is in Needs you's lane, shown as Stopped
  const chipName = (l) => (l === 'attention' && ln === 'attention' && sec === 'stopped' ? 'Stopped' : LANE_NAME[l]);
  $('.sheet-head', menuEl).innerHTML = sheetHead(esc(j.title || 'Job'), esc(sub));
  const rows = [
    M.page ? null : mrow('open', I.chevR, 'Open'),
    M.page?.done && j.status !== 'done' ? mrow('done', I.check, 'Mark done…', { sub: j.taskIds?.length ? 'Stops the session; its tasks can close too' : 'Stops the session' }) : null,
    mrow('star', I.star, j.starred ? 'Unstar' : 'Star'),
    mrow('review', I.eye, j.review ? 'Clear review' : 'Mark for review'),
    M.page?.rewind && j.turns > 0 ? mrow('rewind', I.rewind, 'Rewind the last turn…') : null,
    j.rewind && j.turns > 0 ? mrow('fork', I.fork, 'Fork into a new job', { sub: 'Carries on after the last turn; this one stays' }) : null,
    j.ship?.builderJob ? mrow('builder', I.hammer, 'Open the Builder') : null,
    live ? mrow('stop', I.stop, 'Stop', { danger: true }) : null,
  ].filter(Boolean).join('');
  $('.sheet-body', menuEl).innerHTML = `<div class="group">${rows}</div>
<div class="sh"><h2>Move to</h2></div>
<div class="chips jm-move">${['attention', 'working', 'completed'].map((l) => `<button type="button" class="chip-btn${l === ln ? ' on' : ''}" data-jm-lane="${l}" aria-pressed="${l === ln}" ${l === ln ? 'disabled' : ''}>${chipName(l)}</button>`).join('')}</div>
${j.cache && j.cache.state !== 'none' ? `<div class="sh"><h2>Keep the cache warm</h2>${kwLeft ? `<span class="sh-count num">${kwLeft} h left</span>` : kw === 'off' ? '<span class="sh-count">Off</span>' : ''}</div>
<div class="chips">${WARM.map(([v, l]) => `<button type="button" class="chip-btn${(v === '' && !kw) || (v === '0' && kw === 'off') ? ' on' : ''}" data-jm-warm="${v}">${l}</button>`).join('')}</div>
<p class="jhint">A one-word message 15 min before the cache goes cold. Each one reads the chat at the cached price and counts toward your limits.</p>` : ''}
${ln !== 'archived' ? `<div class="group jm-arch">${mrow('archive', I.archive, 'Archive', { danger: true })}</div>` : `<div class="group jm-arch">${mrow('unarchive', I.archive, 'Back to Completed')}</div>`}`;
}
menuEl.addEventListener('click', async (e) => {
  if (e.target.closest('[data-sheet-close]')) { menuSheet.close(); return; }
  const j = M?.j;
  if (!j) return;
  const a = e.target.closest('[data-jm]')?.dataset.jm;
  const ln = e.target.closest('[data-jm-lane]')?.dataset.jmLane;
  const kw = e.target.closest('[data-jm-warm]')?.dataset.jmWarm;
  if (a === 'open') { menuSheet.close(); openJob(j.id); return; }
  if (a === 'done') { menuSheet.close(); M.page.done(); return; }
  if (a === 'rewind') { menuSheet.close(); setTimeout(() => M?.page?.rewind(), 260); return; }
  if (a === 'builder') { menuSheet.close(); openJob(j.ship.builderJob); return; }
  if (a === 'star') { await flag(j, { starred: !j.starred }, j.starred ? 'Unstarred' : 'Starred', { starred: !!j.starred }); drawMenu(); return; }
  if (a === 'review') { await flag(j, { review: !j.review }, j.review ? 'Review cleared' : 'Marked for review', { review: !!j.review }); drawMenu(); return; }
  if (a === 'stop') { menuSheet.close(); moveJob(j, 'attention', { label: 'Stopped' }); return; }
  if (a === 'archive') { menuSheet.close(); moveJob(j, 'archived', { label: 'Archived' }); return; }
  if (a === 'unarchive') { menuSheet.close(); moveJob(j, 'completed', { label: 'Back in Completed' }); return; }
  if (a === 'fork') {
    menuSheet.close();
    try {
      const r = await AOS.api(`/jobs/${j.id}/fork`, { method: 'POST', body: '{}' });
      putJob(r.job);
      AOS.haptic('success');
      AOS.toast(`Forked into ${r.job.id}`);
      AOS.push('job', r.job.id);
    } catch (er) { AOS.toast(err(er)); }
    return;
  }
  if (ln) { menuSheet.close(); moveJob(j, ln); return; }
  if (kw !== undefined) {
    try { await board(j, { keepWarm: kw === '' ? null : Number(kw) }); AOS.haptic('selection'); AOS.toast(kw === '0' ? 'Keep-warm off for this job' : kw === '' ? 'Keep-warm follows your settings' : `Kept warm for ${kw} h`); drawMenu(); }
    catch (er) { AOS.toast(err(er)); }
  }
});
onChange(() => { if (M && menuSheet.isOpen) drawMenu(); });

// ---------- A row with a value: the phone's own picker opens over it ----------
/** label · value ›, with a transparent native select on top (iOS shows its wheel; a mouse gets a menu). */
export const pickRow = (label, attr, cur, opts, fmt, note = '') =>
  `<label class="lrow jpick-row"><span class="rbody"><span class="rtitle wrap">${label}</span>${note ? `<span class="rmeta wrap">${note}</span>` : ''}</span><span class="rend">${esc(fmt(cur))}${AOS.CHEV}</span><select ${attr} aria-label="${esc(label)}">${opts.map((v) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(fmt(v))}</option>`).join('')}</select></label>`;
const min = (v) => `${v} min`, hrs = (v) => `${v} h`, days = (v) => `${v} days`, secs = (v) => (Number(v) ? `${v} s` : 'No wait');

// ---------- Board settings ----------
const setEl = sheetEl('boardSettingsSheet', 'Board settings', 'job-sheet jset-sheet');
const setSheet = AOS.makeSheet(setEl, { detents: (H) => ({ large: 0, half: Math.round(H * 0.12) }), scrimFor });
let BS = null;
async function loadSettings() { BS = (await AOS.api('/jobs/board-settings')).settings; return BS; }
async function openSettings() {
  try { await loadSettings(); } catch (e) { AOS.toast(err(e)); return; }
  drawSettings();
  setSheet.open('large');
}
const swRow = (label, attr, on, note = '') => `<label class="lrow jsw-row"><span class="rbody"><span class="rtitle wrap">${label}</span>${note ? `<span class="rmeta wrap">${note}</span>` : ''}</span><input type="checkbox" switch ${attr} ${on ? 'checked' : ''} /></label>`;
function drawSettings() {
  const s = BS;
  $('.sheet-head', setEl).innerHTML = sheetHead('Board settings');
  $('.sheet-body', setEl).innerHTML = `<div class="group">
${swRow('Own copy (worktree) by default', 'data-bs-wt', lastWorktree(), 'New jobs in a git folder get their own branch')}
${swRow('Keep the cache warm', 'data-bs-keep', s.keepWarm, 'Pings a job before its cache goes cold')}
${swRow('Type into plain terminals from this phone', 'data-shell-input', W.termSettings?.phoneShellInput)}
</div>
<p class="jhint">A plain PowerShell runs whatever you send, so typing into it is off unless you turn it on. Keep-warm pings count toward your limits.</p>
<div class="sh"><h2>Cache</h2></div>
<div class="group">
${pickRow('Claude cache length', 'data-bs="cacheTtlMin.claude"', s.cacheTtlMin.claude, [5, 60], min)}
${pickRow('Codex cache length', 'data-bs="cacheTtlMin.codex"', s.cacheTtlMin.codex, [5, 10, 60], min)}
${pickRow('Ping me before it goes cold', 'data-bs="leadMin"', s.leadMin, [2, 5, 15], min)}
${pickRow('Keep warm for', 'data-bs="keepWarmHours"', s.keepWarmHours, [1, 2, 3, 8], hrs, 'After your last message')}
</div>
<div class="sh"><h2>Clean-up</h2></div>
<div class="group">
${pickRow('Archive untouched jobs after', 'data-bs="autoArchiveDays"', s.autoArchiveDays, [3, 7, 14, 30], days)}
${pickRow('Drop checkpoints of archived jobs', 'data-bs="ckptDropDays"', s.ckptDropDays, [7, 14, 30], days, 'The chat and its summary stay; its per-turn diffs and undo go')}
${pickRow('Builder batching', 'data-bs="batchSec"', s.batchSec, [0, 20, 60], secs, 'How long a Builder waits for more to ship')}
</div>
<div class="group jset-b"><button type="button" class="lrow ic" data-open-builders><span class="tile">${I.hammer}</span><span class="rbody"><span class="rtitle">Builders</span></span>${AOS.CHEV}</button></div>`;
}
const patchOf = (key, v) => (key.startsWith('cacheTtlMin.') ? { cacheTtlMin: { [key.split('.')[1]]: v } } : { [key]: v });
async function saveSettings(patch) {
  try { BS = (await AOS.api('/jobs/board-settings', { method: 'POST', body: JSON.stringify(patch) })).settings; AOS.haptic('selection'); if (setSheet.isOpen) drawSettings(); for (const S of builderPages) S.draw(); }
  catch (e) { AOS.toast(err(e)); if (setSheet.isOpen) drawSettings(); }
}
setEl.addEventListener('click', (e) => {
  if (e.target.closest('[data-sheet-close]')) { setSheet.close(); return; }
  if (e.target.closest('[data-open-builders]')) setSheet.close();
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches?.('[data-bs]')) saveSettings(patchOf(t.dataset.bs, Number(t.value)));
  else if (t.matches?.('[data-bs-keep]')) saveSettings({ keepWarm: t.checked });
  else if (t.matches?.('[data-bs-wt]')) { rememberWorktree(t.checked); AOS.haptic('selection'); AOS.toast(t.checked ? 'New jobs get their own copy' : 'New jobs work in the folder itself'); }
});

// ---------- Builders: one page each, and the list ----------
const MODELS = [['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const builderPages = new Set();
function renderBuildersPage(box, key, el) {
  box.classList.add('builders-page');
  const all = key === 'all';
  const S = { key, failed: '', draw: () => {} };
  builderPages.add(S);
  const title = el.querySelector('.nav-title');
  S.draw = () => {
    const list = W.builders;
    if (all) {
      if (title) title.textContent = 'Builders';
      box.innerHTML = `<div class="phead"><h1 class="lt">Builders</h1><p class="sub">Each project has a Builder that commits, merges, builds and deploys what its jobs hand over with publish_changes. Jobs without a project use the global one.</p></div>
${list == null ? `<p class="quiet">${esc(S.failed || 'Loading the Builders…')}</p>` : list.length ? `<div class="group">${list.map(builderRowHTML).join('')}</div>` : '<p class="empty-line">No Builders yet. The first job that ships starts one.</p>'}`;
      return;
    }
    const b = list?.find((x) => x.key === key);
    if (title) title.textContent = b ? builderName(b) : 'Builder';
    if (!b) { box.innerHTML = `<p class="quiet">${esc(list == null ? S.failed || 'Loading the Builder…' : 'This Builder isn’t on your PC any more.')}</p>`; return; }
    const keep = $('[data-bl-notes]', box);
    const notes = keep && document.activeElement === keep ? keep.value : null;
    const { cur, j, busy, last } = builderNow(b);
    const now = cur
      ? `<button type="button" class="lrow ic" data-open-job="${esc(cur.jobId)}"><span class="tile">${I.hammer}</span><span class="rbody"><span class="rtitle">${esc(SHIP_LABEL[cur.state] ?? cur.state)}: ${esc(cur.title)}</span><span class="rmeta"><span class="mono">${esc(cur.jobId)}</span><span>· ${esc(cur.id)} · ${esc(agoText(cur.at))}</span></span></span><span class="rend"><span class="spin" style="--c:var(--jobs)" role="img" aria-label="Building"></span>${AOS.CHEV}</span></button>`
      : `<div class="lrow ic"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle">${busy ? esc(JOB_LABEL[j.status] ?? 'Working') : 'Idle'}</span><span class="rmeta"><span class="ell">${last ? `Last ship ${last.state === 'live' ? 'live' : 'failed'} ${esc(agoText(last.at))}` : 'Starts with the first request'}</span></span></span></div>`;
    const chat = j ? `<button type="button" class="lrow ic" data-open-job="${esc(j.id)}">${agentHTML(j)}<span class="rbody"><span class="rtitle">Its chat</span><span class="rmeta"><span class="ell">${esc(stateWord(j)[0])} · ${esc(agoText(j.updatedAt ?? j.createdAt))}</span></span></span>${AOS.CHEV}</button>` : '';
    box.innerHTML = `<div class="phead"><p class="kicker">Builder</p><h1 class="lt">${esc(builderName(b))}</h1><p class="sub">Commits, merges, builds and deploys what its jobs hand over.</p></div>
<div class="group jb-now">${now}${chat}</div>
<div class="sh"><h2>How it ships</h2></div>
<label class="bl-notes-w"><span class="vh">How this project ships</span><textarea class="bl-notes" rows="4" data-bl-notes="${esc(b.key)}" placeholder="e.g. run bun test server, then restart.ps1">${esc(notes ?? b.notes ?? '')}</textarea></label>
<p class="jhint">The Builder follows these steps on every ship. Saved when you leave the field.</p>
<div class="sh"><h2>Settings</h2></div>
<div class="group">
${pickRow('Model', `data-bl="${esc(b.key)}" data-bl-k="model"`, b.model ?? 'sonnet', MODELS.map(([v]) => v), (v) => MODELS.find(([x]) => x === v)?.[1] ?? v)}
${pickRow('Effort', `data-bl="${esc(b.key)}" data-bl-k="effort"`, b.effort ?? 'medium', EFFORTS, (v) => effortLabel(v))}
${BS ? pickRow('Batching', 'data-bs="batchSec"', BS.batchSec, [0, 20, 60], secs, 'For every Builder') : ''}
</div>
${b.ships?.length ? `<div class="sh"><h2>Recent ships</h2><span class="sh-count num">${b.ships.length}</span></div>
<div class="group">${b.ships.slice(0, 8).map((s) => `<button type="button" class="lrow jship" data-open-job="${esc(s.jobId)}"><span class="rbody"><span class="rtitle">${esc(s.title)}</span><span class="rmeta"><span class="mono">${esc(s.jobId)}</span><span>· ${esc(agoText(s.at))}${s.commit ? ` · ${esc(s.commit)}` : ''}</span></span>${s.note ? `<span class="jlast">${esc(s.note)}</span>` : ''}</span>${shipHTML(null, s.state)}</button>`).join('')}</div>` : ''}`;
  };
  const load = async () => {
    try { await Promise.all([loadBuilders(true), BS ? null : loadSettings().catch(() => null)]); S.failed = ''; } catch (e) { S.failed = err(e); }
    S.draw();
  };
  box.addEventListener('change', async (e) => {
    const sel = e.target.closest('select[data-bl]');
    if (!sel) return;
    try { await AOS.api(`/jobs/builders/${encodeURIComponent(sel.dataset.bl)}`, { method: 'POST', body: JSON.stringify({ [sel.dataset.blK]: sel.value }) }); AOS.haptic('selection'); await loadBuilders(true); }
    catch (er) { AOS.toast(err(er)); S.draw(); }
  });
  box.addEventListener('focusout', async (e) => {
    const t = e.target.closest?.('[data-bl-notes]');
    if (!t) return;
    const was = W.builders?.find((x) => x.key === t.dataset.blNotes)?.notes ?? '';
    if (t.value.trim() === (was ?? '').trim()) return;
    try { await AOS.api(`/jobs/builders/${encodeURIComponent(t.dataset.blNotes)}`, { method: 'POST', body: JSON.stringify({ notes: t.value.trim() || null }) }); AOS.toast('Saved'); await loadBuilders(true); }
    catch (er) { AOS.toast(err(er)); }
  });
  S.draw();
  load();
  const mo = new MutationObserver(() => { if (!el.isConnected) { builderPages.delete(S); mo.disconnect(); } });
  mo.observe(el.parentNode, { childList: true });
}
AOS.detail('builders', { render: renderBuildersPage });
onChange(() => { for (const S of builderPages) if (!document.activeElement?.matches?.('[data-bl-notes]')) S.draw(); });
function openBuilders(key = 'all') {
  const ui = AOS.ui();
  if (!ui.stack[ui.tab]) AOS.setTab('jobs');
  const top = AOS.topDetail();
  if (top?.dataset.kind === 'builders' && top.dataset.id === key) return;
  AOS.push('builders', key);
}
document.addEventListener('click', (e) => {
  const one = e.target.closest('[data-open-builder]');
  if (one) { e.preventDefault(); openBuilders(one.dataset.openBuilder); return; }
  if (e.target.closest('[data-open-builders]')) { e.preventDefault(); openBuilders(); return; }
  if (e.target.closest('[data-board-settings]')) { openSettings(); }
});
// Cache minutes count down on screen; the Builders lane follows its ships.
setInterval(() => { if (document.visibilityState === 'visible' && document.querySelector('.board, .job-page')) { emit(); loadBuilders(); } }, 30000);

// The Code page on the phone: everything Claude, Codex and the terminals are doing on the PC, in one list.
// Chats (jobs) open the job page; terminals open a live screen with quick keys and a reply box; separate copies
// (git worktrees) and compares open their changes with merge back / keep one / discard. Plus the New session sheet.
// Server: /term (terminals through the PC's terminal host), /worktrees, /jobs.
import { W, emit, onChange, isLive, isActive, JOB_LABEL, ENGINE, projectBySlug, putJob, ago, copyFor } from './state.js';
import { boardHTML, boardBusy, boardOpen, laneHead, loadBuilders } from './board.js';
import { agoText, statHTML } from './cards.js';
import { sheetEl, scrimFor, projectChips, openJob, folderName, lastWorktree, rememberWorktree } from './sheets.js';
import { sumHTML, mountFiles, sumFiles } from './diff.js';
import * as voice from './recorder.js';
import { lastModel, rememberModel, loadModels, modelFieldHTML } from './models.js';

const { AOS } = window;
const { esc } = AOS;
const I = AOS.icons;
const $ = (s, el = document) => el.querySelector(s);
const err = (e) => (e?.status ? e.message : 'Your PC isn’t reachable right now');
const KIND = { claude: 'Claude', codex: 'Codex', shell: 'Terminal', custom: 'Terminal' };
const isAgentTerm = (t) => t.kind === 'claude' || t.kind === 'codex';
const termLabel = (t) => t.status === 'exited' ? 'Ended' : !isAgentTerm(t) ? 'Open' : t.status === 'needs_input' ? 'Needs you' : t.status === 'running' ? 'Working' : 'Waiting for you';
const termDot = (t) => t.status === 'exited' ? 'done' : !isAgentTerm(t) ? 'idle' : t.status;
const TROPHY = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6.5 3.5h7v4a3.5 3.5 0 0 1-7 0zM6.5 5H4a2 2 0 0 0 2.5 3M13.5 5H16a2 2 0 0 1-2.5 3M10 11v3M7 16.5h6"/></svg>';
const BRANCH = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="5.5" r="1.6"/><path d="M4.5 5.1v5.8M11.5 7.1c0 2.6-3 2.6-6.4 4"/></svg>';

// ---------- State: terminals and copies, refreshed while anything is open or working ----------
W.terms ??= [];
W.worktrees ??= [];
W.termSettings ??= { phoneShellInput: false };
W.termDown ??= false;
export async function loadCode() {
  if (!AOS.owner || !AOS.real) return;
  const [t, w] = await Promise.allSettled([AOS.api('/term'), AOS.api('/worktrees')]);
  if (t.status === 'fulfilled') { W.terms = t.value.sessions ?? []; W.termSettings = t.value.settings ?? W.termSettings; W.termDown = !!t.value.down; }
  if (w.status === 'fulfilled') W.worktrees = w.value.worktrees ?? [];
  emit();
}
export { copyFor };
const inCopy = (w, folder) => copyFor(folder)?.id === w.id;
const codeOpen = () => (AOS.ui().tab === 'jobs' && AOS.ui().jobsSeg === 'board') || [...document.querySelectorAll('.page.detail')].some((p) => ['code', 'term', 'copy', 'compare'].includes(p.dataset.kind));
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  if (codeOpen() || W.terms.some((t) => t.status === 'running' || t.status === 'needs_input')) loadCode();
}, 4000);
setInterval(() => { if (document.visibilityState === 'visible') loadCode(); }, 30000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadCode(); });
loadCode();

export const needsCount = () => W.jobs.filter((j) => j.status === 'needs_input').length + W.terms.filter((t) => t.status === 'needs_input').length;
export const workingCount = () => W.jobs.filter(isActive).length + W.terms.filter((t) => isAgentTerm(t) && t.status === 'running').length;

// ---------- Rows: terminals and compares, in the board's markup (cards.js has the job rows) ----------
const at = (x) => x.updatedAt ?? x.createdAt ?? '';
const byTime = (a, b) => at(b).localeCompare(at(a));
function termRowHTML(t) {
  const copy = copyFor(t.cwd);
  const agent = isAgentTerm(t);
  const needs = t.status === 'needs_input';
  const busy = agent && t.status === 'running';
  const folder = folderName(t.cwd) || (t.project ? projectBySlug(t.project)?.name : '') || '';
  // the row's end says Needs you, so its meta doesn't repeat it
  const state = needs ? '' : t.status === 'exited' ? 'Ended' : agent ? termLabel(t) : 'Open';
  const detail = t.detail && agent && (busy || needs) ? `<span class="jlast">${esc(t.detail)}</span>` : '';
  return `<button type="button" class="lrow ic jterm" data-open-term="${esc(t.id)}"><span class="tile">${agent ? I[t.kind] : I.term}</span><span class="rbody"><span class="rtitle wrap">${copy ? `<span class="jbr" aria-hidden="true">${I.branch}</span>` : ''}${esc(t.title)}</span><span class="rmeta">${folder ? `<span class="mono ell">${esc(folder)}</span><span>·</span>` : ''}<span>${state ? `${esc(state)} · ` : ''}${esc(agoText(t.updatedAt))}</span></span>${detail}</span><span class="rend">${needs ? '<span class="jst-needs">Needs you</span>' : busy ? '<span class="spin" style="--c:var(--jobs)" role="img" aria-label="Working"></span>' : ''}${AOS.CHEV}</span></button>`;
}
/** A terminal that waits on you is in Needs you (boardHTML draws it there); the Terminals lane has the rest. */
const needyTerms = () => W.terms.filter((t) => t.status === 'needs_input').sort(byTime);
function terminalsHTML() {
  const liveTerms = W.terms.filter((t) => t.status !== 'exited' && t.status !== 'needs_input').sort(byTime);
  const ended = W.terms.filter((t) => t.status === 'exited').sort(byTime).slice(0, 8);
  const open = boardOpen.ended;
  return `<section class="bd-lane jterms">${laneHead('terminals', 'Terminals', liveTerms.length)}<div class="group">
${W.termDown ? `<div class="lrow ic jempty"><span class="tile">${I.term}</span><span class="rbody"><span class="rtitle">The terminal host isn’t running</span><span class="rmeta">Jobs still work. Terminals come back when it starts.</span></span></div>` : ''}
${liveTerms.map(termRowHTML).join('')}
<button type="button" class="lrow ic jadd" data-code-new><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">New session</span></span></button>
${ended.length ? `<button type="button" class="lrow jmore" data-bd-fold="ended" aria-expanded="${open}"><span class="rbody">${open ? 'Hide ended terminals' : `${ended.length} ended`}</span>${open ? I.chevU : I.chevD}</button>${open ? ended.map(termRowHTML).join('') : ''}` : ''}
</div></section>`;
}
function groupsOf() {
  const m = new Map();
  for (const w of W.worktrees) if (w.group && w.state === 'open') m.set(w.group, [...(m.get(w.group) ?? []), w]);
  return [...m.entries()];
}
function compareRowHTML([g, ws]) {
  return `<button type="button" class="lrow ic" data-open-compare="${esc(g)}"><span class="tile">${TROPHY}</span><span class="rbody"><span class="rtitle">${esc(ws[0].title)}</span><span class="rmeta"><span class="ell">${ws.map((w) => `${esc(w.label ?? 'copy')}: ${w.files?.length ?? 0} ${w.files?.length === 1 ? 'file' : 'files'}`).join(' · ')}</span></span></span>${AOS.CHEV}</button>`;
}
function comparesHTML() {
  const groups = groupsOf();
  return groups.length ? `<section class="bd-lane">${laneHead('compares', 'Compares', groups.length)}<div class="group">${groups.map(compareRowHTML).join('')}</div></section>` : '';
}

// ---------- The board: the Jobs tab's Board segment (app/work/tab.js), and the old Code page ----------
function renderCodePage(box, _id, el) {
  el.querySelector('.nav-title').textContent = 'Jobs';
  const right = el.querySelector('.navbar > span:last-child');
  if (right) right.outerHTML = `<span class="nav-acts"><button class="nav-icon" data-board-settings aria-label="Board settings">${I.gear}</button><button class="nav-pill strong" data-code-new style="--c:var(--jobs-fill)">${I.plus}New</button></span>`;
  mountBoard(box, { title: true });
}
/** Draw the board (lanes, compares, builders, terminals) into box and keep it fresh. title: the old page's heading. */
export function mountBoard(box, { title = false } = {}) {
  box.classList.add('code-page');
  const draw = () => {
    const needy = needyTerms();
    const html = `${title ? '<div class="phead"><h1 class="lt">Jobs</h1></div>' : ''}${boardHTML(W.jobs, { compares: comparesHTML(), terminals: terminalsHTML(), needsTerms: needy.map(termRowHTML).join(''), needsTermsN: needy.length })}`;
    // The board redraws on every change; an unchanged board keeps its nodes (and a pressed row its press).
    if (box._html === html) return;
    box._html = html;
    box.innerHTML = html;
  };
  draw();
  box._draw = () => { if (boardBusy()) setTimeout(() => box._draw(), 400); else draw(); };
  loadCode();
  loadBuilders();
}

// ---------- One terminal: its screen, quick keys and a reply box ----------
const termPages = new Set();
const KEYS = [['enter', 'Enter'], ['esc', 'Esc'], ['1', '1'], ['2', '2'], ['3', '3'], ['y', 'Y'], ['n', 'N'], ['up', '↑'], ['down', '↓'], ['tab', 'Tab'], ['shift-tab', '⇧Tab'], ['ctrl-c', 'Ctrl C']];
// The output reads top to bottom on a surface; the keys and the field sit at the thumb, docked like the job composer.
// A plain PowerShell runs whatever you send, so until typing into it is on, the bar says it is watching only.
function renderTermPage(box, id, el) {
  const S = { id, box, el, alive: true, text: '', timer: 0 };
  termPages.add(S);
  box.classList.add('term-page');
  box.innerHTML = '<div class="tm-hero"></div><div class="jterm-out"><pre class="tm-screen" aria-label="Terminal screen" tabindex="0"></pre></div><div class="tm-acts"></div>';
  el.classList.add('has-composer');
  const comp = document.createElement('form');
  comp.className = 'job-composer glass tm-composer';
  comp.autocomplete = 'off';
  comp.innerHTML = `<div class="tm-keys" role="toolbar" aria-label="Keys"></div><div class="jterm-lock" hidden></div><div class="jc-row"><textarea id="tc-${esc(id)}" rows="1" placeholder="Reply, or type a command" enterkeyhint="send" aria-label="Send to the terminal" autocapitalize="off" spellcheck="false"></textarea>${voice.micButtonHTML(`data-mic-for="tc-${esc(id)}" data-purpose="prompt"`)}<button type="submit" class="jc-send" aria-label="Send">${I.up}</button></div><div class="rec-slot" data-rec-for="tc-${esc(id)}"></div>`;
  el.appendChild(comp);
  const ta = comp.querySelector('textarea');
  ta.addEventListener('input', () => { ta.style.height = ''; ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`; });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !AOS.native) { e.preventDefault(); comp.requestSubmit(); } });
  comp.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    if (voice.busy(ta)) { AOS.toast('Finish the recording first'); return; }
    ta.value = ''; ta.style.height = '';
    AOS.haptic('light');
    try { await AOS.api(`/term/${id}/send`, { method: 'POST', body: JSON.stringify({ text }) }); tick(S, true); }
    catch (er) { ta.value = text; AOS.toast(err(er)); }
  });
  drawTerm(S);
  tick(S, true);
  const mo = new MutationObserver(() => { if (!el.isConnected) { S.alive = false; clearTimeout(S.timer); termPages.delete(S); mo.disconnect(); } });
  mo.observe(el.parentNode, { childList: true });
}
async function tick(S, now = false) {
  clearTimeout(S.timer);
  if (!S.alive) return;
  try {
    const r = await AOS.api(`/term/${S.id}/text?lines=160`);
    const pre = $('.tm-screen', S.box);
    if (pre && r.text !== S.text) {
      const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
      S.text = r.text;
      pre.textContent = r.text || ' ';
      if (atBottom || now) pre.scrollTop = pre.scrollHeight;
    }
    const t = W.terms.find((x) => x.id === S.id);
    if (t && r.status && t.status !== r.status) { t.status = r.status; drawTerm(S); }
  } catch (e) { if (e.status === 404) { $('.tm-hero', S.box).innerHTML = '<p class="quiet">This terminal is gone from your PC.</p>'; return; } }
  const t = W.terms.find((x) => x.id === S.id);
  S.timer = setTimeout(() => tick(S), t?.status === 'exited' ? 15000 : 1500);
}
function drawTerm(S) {
  const t = W.terms.find((x) => x.id === S.id);
  const title = S.el.querySelector('.nav-title');
  if (!t) { $('.tm-hero', S.box).innerHTML = '<p class="quiet">Loading the terminal…</p>'; if (!W.terms.length) loadCode(); return; }
  if (title) title.textContent = t.title;
  const p = t.project ? projectBySlug(t.project) : null;
  const copy = copyFor(t.cwd);
  const agent = isAgentTerm(t);
  const live = t.status !== 'exited';
  const canType = live && (agent || W.termSettings.phoneShellInput);
  const state = t.status === 'needs_input' ? '<span class="jst-needs">Needs you</span>' : `<span>${esc(termLabel(t))}${t.updatedAt ? ` ${esc(agoText(t.updatedAt))}` : ''}</span>`;
  const hero = `<div class="phead"><p class="kicker">${esc(KIND[t.kind] ?? 'Terminal')}${agent ? ' terminal' : ''}</p><h1 class="lt jterm-t">${esc(t.title)}</h1>
<p class="sub jt-sub"><span class="mono" title="${esc(t.cwd ?? '')}">${esc(folderName(t.cwd) || t.cwd || 'Home folder')}</span>${state}</p>
${t.detail && agent && (t.status === 'running' || t.status === 'needs_input') ? `<p class="foot jt-detail">${esc(t.detail)}</p>` : ''}
${p || copy ? `<div class="jh-meta">${p ? `<button type="button" class="jh-proj" data-project="${esc(p.slug)}">${esc(p.name)}</button>` : ''}${copy ? `<button type="button" class="jh-copy" data-open-copy="${esc(copy.id)}">${I.branch}<span class="mono">${esc(copy.label ?? copy.branch.replace(/^aos\//, ''))}</span><span>· ${copy.files?.length ?? 0} ${copy.files?.length === 1 ? 'file' : 'files'}</span>${AOS.CHEV}</button>` : ''}</div>` : ''}</div>
${(t.taskIds ?? []).length ? `<div class="jh-items">${t.taskIds.map((tid) => { const k = AOS.taskById(tid); return k ? `<button class="js-item" data-open-task="${esc(k.id)}" style="--c:${AOS.color(k.area)}"><i></i><span>${esc(k.title)}</span><em>${k.status === 'done' ? 'Done' : 'Task'}</em></button>` : ''; }).join('')}</div>` : ''}`;
  const h = $('.tm-hero', S.box);
  if (h._html !== hero) { h.innerHTML = hero; h._html = hero; }
  const comp = S.el.querySelector('.tm-composer');
  if (comp) {
    const keys = canType ? KEYS.map(([k, l]) => `<button type="button" class="tm-key" data-term-key="${k}">${esc(l)}</button>`).join('') : '';
    const kb = $('.tm-keys', comp);
    if (kb._html !== keys) { kb.innerHTML = keys; kb._html = keys; }
    kb.hidden = !canType;
    // A plain shell with typing off: the bar watches only, and turning typing on is one tap away.
    const lock = $('.jterm-lock', comp);
    const locked = live && !canType;
    lock.hidden = !locked;
    if (locked && !lock.firstChild) lock.innerHTML = `<span class="tile">${I.lock}</span><span class="rbody"><b>Watching only</b><span>Typing into a plain terminal is off.</span></span><button type="button" class="btn sm" data-term-typing>Turn on</button>`;
    $('.jc-row', comp).hidden = !canType;
    comp.hidden = !live;
  }
  $('.tm-acts', S.box).innerHTML = `${agent && live ? `<button type="button" class="btn sm" data-term-act="done">${I.check}${t.taskIds?.length ? 'Done, close tasks' : 'Done'}</button>` : ''}${!live ? `<button type="button" class="btn sm primary" style="--c:var(--jobs-fill)" data-term-act="restart">${t.engineSessionId ? 'Resume' : 'Restart'}</button>` : `<button type="button" class="btn sm tint" style="--c:var(--fail-ink)" data-term-act="kill">${I.stop}Stop</button>`}`;
}

// ---------- A separate copy: its changes, merge back, pull request, discard ----------
async function stopTermsIn(ws) {
  const live = W.terms.filter((t) => t.status !== 'exited' && ws.some((w) => inCopy(w, t.cwd)));
  await Promise.all(live.map((t) => AOS.api(`/term/${t.id}/kill`, { method: 'POST', body: '{}' }).catch(() => null)));
  if (live.length) await new Promise((r) => setTimeout(r, 1500));
}
function sessionsIn(w) {
  return [...W.jobs.filter((j) => inCopy(w, j.cwd)).map((j) => ({ label: `${ENGINE[j.engine] ?? j.engine} chat`, status: JOB_LABEL[j.status] ?? j.status, open: `data-open-job="${esc(j.id)}"` })),
    ...W.terms.filter((t) => inCopy(w, t.cwd)).map((t) => ({ label: `${KIND[t.kind]} terminal`, status: termLabel(t), open: `data-open-term="${esc(t.id)}"` }))];
}
/** Diff + actions for one copy, into `box`. group: the other copies of a compare ("Keep this one" instead of merge). */
async function copyView(box, w, { group = null, onResult } = {}) {
  const C = { confirm: '', busy: '', msg: w.title };
  box.innerHTML = '<p class="sub jc-sum">Loading the changes…</p><div class="cp-bar"></div><div class="cp-body"></div>';
  let data = null, failed = '';
  try { data = await AOS.api(`/worktrees/${w.id}/diff`); } catch (e) { failed = err(e); }
  const draw = () => {
    const files = data?.files ?? w.files ?? [];
    const sess = sessionsIn(w);
    $('.jc-sum', box).innerHTML = failed ? esc(failed) : sumHTML(files, w.behind ? ` · ${esc(w.base)} moved ${w.behind} ${w.behind === 1 ? 'commit' : 'commits'} on` : '');
    const acts = C.confirm === 'merge'
      ? `<div class="jcp-confirm"><p>${group && group.length > 1 ? `Commit to <span class="mono">${esc(w.base)}</span> and delete the other ${group.length - 1}?` : `Commit to <span class="mono">${esc(w.base)}</span> as one commit?`}</p><label class="ifield"><input class="cp-msg" value="${esc(C.msg)}" aria-label="Commit message" /></label><div class="jcp-b"><button type="button" class="btn sm primary" style="--c:var(--jobs-fill)" data-cp="do-merge" ${C.busy ? 'disabled' : ''}>${C.busy === 'merge' ? 'Merging…' : group ? 'Keep it' : 'Merge'}</button><button type="button" class="btn sm" data-cp="cancel">Cancel</button></div></div>`
      : C.confirm === 'discard'
      ? `<div class="jcp-confirm"><p>Delete this copy and its ${files.length} changed ${files.length === 1 ? 'file' : 'files'}?</p><div class="jcp-b"><button type="button" class="btn sm tint" style="--c:var(--fail-ink)" data-cp="do-discard" ${C.busy ? 'disabled' : ''}>${C.busy === 'discard' ? 'Deleting…' : 'Delete'}</button><button type="button" class="btn sm" data-cp="cancel">Keep</button></div></div>`
      : `<div class="jcp-acts"><button type="button" class="btn primary" style="--c:var(--jobs-fill)" data-cp="merge" ${files.length ? '' : 'disabled'}>${group ? 'Keep this one' : 'Merge back'}</button>${group ? '' : `<button type="button" class="btn" data-cp="pr" ${files.length ? '' : 'disabled'}>${C.busy === 'pr' ? 'Opening…' : 'Open PR'}</button>`}<button type="button" class="btn tint" style="--c:var(--fail-ink)" data-cp="discard">Discard</button></div>`;
    $('.cp-bar', box).innerHTML = `${sess.length ? `<div class="group jcp-sess">${sess.map((s) => `<button type="button" class="lrow" ${s.open}><span class="rbody"><span class="rtitle">${esc(s.label)}</span><span class="rmeta"><span>${esc(s.status)}</span></span></span>${AOS.CHEV}</button>`).join('')}</div>` : ''}${acts}`;
    const body = $('.cp-body', box);
    if (failed) body.innerHTML = '';
    else if (data && !files.length) body.innerHTML = '<p class="empty-line">Nothing changed in this copy yet.</p>';
    else if (data && body._for !== data) { body._for = data; mountFiles(body, files, data.patch); }
  };
  draw();
  box.onclick = async (e) => {
    const b = e.target.closest('[data-cp]');
    if (!b) return;
    const a = b.dataset.cp;
    if (a === 'merge' || a === 'discard') { C.confirm = a; AOS.haptic('selection'); draw(); return; }
    if (a === 'cancel') { C.confirm = ''; draw(); return; }
    const run = async (name, fn) => {
      C.busy = name; draw();
      try { const msg = await fn(); C.busy = ''; C.confirm = ''; AOS.haptic('success'); onResult?.(msg); await loadCode(); }
      catch (er) { C.busy = ''; draw(); AOS.toast(err(er)); }
    };
    if (a === 'do-merge') {
      C.msg = $('.cp-msg', box)?.value.trim() || w.title;
      run('merge', async () => {
        await stopTermsIn(group ?? [w]);
        if (group) {
          const r = await AOS.api(`/worktrees/${w.id}/pick`, { method: 'POST', body: JSON.stringify({ message: C.msg }) });
          return `Kept ${w.label ?? w.branch}: commit ${r.commit} on ${w.base}. ${r.dropped.length} other ${r.dropped.length === 1 ? 'copy' : 'copies'} deleted.${r.failed?.length ? ` Couldn’t delete ${r.failed.length}.` : ''}${r.note ? ` ${r.note}` : ''}`;
        }
        const r = await AOS.api(`/worktrees/${w.id}/merge`, { method: 'POST', body: JSON.stringify({ message: C.msg }) });
        return `Merged into ${w.base} as commit ${r.commit}. The copy is deleted.${r.note ? ` ${r.note}` : ''}`;
      });
    } else if (a === 'do-discard') {
      run('discard', async () => { await stopTermsIn([w]); const r = await AOS.api(`/worktrees/${w.id}/discard`, { method: 'POST', body: '{}' }); return `Copy deleted.${r.note ? ` ${r.note}` : ''}`; });
    } else if (a === 'pr') {
      run('pr', async () => { const r = await AOS.api(`/worktrees/${w.id}/pr`, { method: 'POST', body: JSON.stringify({ title: w.title }) }); return r.url ? `Pull request opened: ${r.url}` : 'Pushed the branch.'; });
    }
  };
}
function resultHTML(msg) {
  const url = String(msg).match(/https:\/\/\S+/)?.[0];
  return `<div class="lrow ic jcp-result" role="status"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle wrap">${esc(url ? String(msg).replace(url, '').trim() : msg)}</span>${url ? `<a class="rmeta" href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>` : ''}</span></div>`;
}
function renderCopyPage(box, id, el) {
  box.classList.add('copy-page');
  const w = W.worktrees.find((x) => x.id === id);
  el.querySelector('.nav-title').textContent = w ? 'Own copy' : 'Copy';
  if (!w) { box.innerHTML = '<p class="empty-line">This copy is closed.</p>'; return; }
  box.innerHTML = `<div class="phead"><p class="kicker">Own copy</p><h1 class="title1 jcp-t">${esc(w.title)}</h1><p class="sub jcp-br"><span class="mono">${BRANCH}${esc(w.branch)}</span><span>from <span class="mono">${esc(w.base ?? 'HEAD')}</span></span></p></div><div class="cp-view"></div>`;
  copyView($('.cp-view', box), w, { onResult: (msg) => { $('.cp-view', box).innerHTML = `<div class="group">${resultHTML(msg)}</div>`; } });
}
function renderComparePage(box, group, el) {
  box.classList.add('compare-page');
  const runsNow = () => W.worktrees.filter((w) => w.group === group && w.state === 'open');
  let runs = runsNow();
  el.querySelector('.nav-title').textContent = 'Compare';
  if (!runs.length) { box.innerHTML = '<p class="quiet">This compare is finished.</p>'; return; }
  let sel = runs[0].id, done = false, shown = '';
  const cardsHTML = () => runs.map((w) => {
    const s = sessionsIn(w)[0];
    const { add, del } = sumFiles(w.files);
    return `<button type="button" role="tab" aria-selected="${w.id === sel}" class="jcmp-run${w.id === sel ? ' on' : ''}" data-cmp-run="${esc(w.id)}"><b>${esc(w.label ?? w.branch)}</b><small>${esc(s?.status ?? 'No session')}</small><span class="num">${w.files?.length ?? 0} ${w.files?.length === 1 ? 'file' : 'files'} <span class="jdiffstat">${statHTML(add, del)}</span></span></button>`;
  }).join('');
  const draw = () => {
    box.innerHTML = `<div class="phead"><p class="kicker">Compare</p><h1 class="title1 jcp-t">${esc(runs[0].title)}</h1><p class="sub">Each agent worked in its own copy. Look at each result and keep one; the others are deleted.</p></div>
<div class="jcmp-runs" role="tablist" aria-label="Copies">${cardsHTML()}</div><div class="cp-view"></div>`;
    const w = runs.find((r) => r.id === sel);
    shown = `${w.id}:${w.files?.length ?? 0}:${sumFiles(w.files).add}`;
    copyView($('.cp-view', box), w, { group: runs, onResult: (msg) => { done = true; box.innerHTML = `<div class="group">${resultHTML(msg)}</div>`; } });
  };
  draw();
  // Agents keep working after the page opens: refresh the cards, and the open diff when its copy changed.
  box._draw = () => {
    if (done) return;
    const next = runsNow();
    if (!next.length) return;
    runs = next;
    if (!runs.some((r) => r.id === sel)) sel = runs[0].id;
    const w = runs.find((r) => r.id === sel);
    if (`${w.id}:${w.files?.length ?? 0}:${sumFiles(w.files).add}` !== shown && !box.querySelector('.cp-confirm')) { draw(); return; }
    const c = $('.jcmp-runs', box);
    if (c) c.innerHTML = cardsHTML();
  };
  box.addEventListener('click', (e) => { const r = e.target.closest('[data-cmp-run]'); if (r && r.dataset.cmpRun !== sel) { sel = r.dataset.cmpRun; AOS.haptic('selection'); draw(); } });
}

// ---------- New session ----------
const newEl = sheetEl('codeNewSheet', 'New session', 'job-sheet jsheet code-new');
const newSheet = AOS.makeSheet(newEl, { detents: (H) => ({ large: 0, half: Math.round(H * 0.12) }), scrimFor });
const KINDS = [['claude-chat', 'Claude chat'], ['codex-chat', 'Codex chat'], ['claude', 'Claude terminal'], ['codex', 'Codex terminal'], ['shell', 'PowerShell']];
const MODES = [['ask', 'Ask first'], ['edits', 'Auto-edit'], ['auto', 'Full access']];
let N = null;
const engineOf = (kind) => (kind.startsWith('codex') ? 'codex' : 'claude');
export function openNewSession(opts = {}) {
  if (!AOS.owner || !AOS.real) { AOS.toast('Sessions run on the owner’s PC'); return; }
  N = { kind: 'claude-chat', project: opts.project ?? null, where: 'folder', picked: false, runs: ['claude', 'codex'], mode: 'auto', plan: false, tasks: new Set(opts.taskIds ?? []), repo: null, model: lastModel('claude') };
  drawNew(true);
  loadModels(() => { if (N) drawNew(); });
  checkRepo();
  newSheet.open('large');
}
async function checkRepo() {
  const p = N.project ? projectBySlug(N.project) : null;
  N.repo = null;
  if (!p?.folder) { drawNew(); return; }
  try { N.repo = await AOS.api(`/worktrees/check?folder=${encodeURIComponent(p.folder)}`); } catch {}
  drawNew();
}
function drawNew(fresh = false) {
  const chat = N.kind.endsWith('-chat'), agent = N.kind !== 'shell';
  const engine = N.kind.startsWith('codex') ? 'codex' : 'claude';
  if (N.runs[0] !== engine) N.runs[0] = engine;
  const p = N.project ? projectBySlug(N.project) : null;
  const canCopy = !!N.repo?.repo && N.repo.hasCommits !== false;
  // Own copy is the default for a repo (until he picks otherwise); the choice only applies once the repo is known.
  if (canCopy && !N.picked && N.where === 'folder' && lastWorktree()) N.where = 'copy';
  if (!canCopy || (!agent && N.where === 'compare')) N.where = canCopy && N.where !== 'compare' ? N.where : 'folder';
  const tasks = AOS.data().tasks.filter((t) => ['inbox', 'todo', 'doing'].includes(t.status) && (N.project ? t.project === N.project : !t.project)).slice(0, 12);
  const keep = fresh ? '' : $('#cnText', newEl)?.value ?? '';
  $('.sheet-head', newEl).innerHTML = `<div class="jsh-head"><div><h2>New session</h2><p>Runs on your PC; you follow it here</p></div><button type="button" class="sheet-close" data-cn-close aria-label="Close">${I.x}</button></div>`;
  $('.sheet-body', newEl).innerHTML = `<div class="field"><span class="f-label">Run</span><div class="chips cn-kinds" role="radiogroup" aria-label="Run">${KINDS.map(([k, l]) => `<button type="button" class="chip-btn${N.kind === k ? ' on' : ''}" role="radio" aria-checked="${N.kind === k}" data-cn-kind="${k}">${esc(l)}</button>`).join('')}</div></div>
<div class="field"><span class="f-label">Project</span><div class="chips scroll">${projectChips(N.project, 'data-cn-project')}</div>
<p class="js-path${p?.folder ? ' mono' : ''}">${p?.folder ? esc(p.folder) : chat ? 'Runs in a new scratch folder' : 'Opens in your home folder'}</p></div>
${canCopy ? `<div class="field"><span class="f-label">Where</span><div class="chips" role="radiogroup">${[['folder', 'Project folder'], ['copy', 'Separate copy'], ...(agent ? [['compare', 'Compare agents']] : [])].map(([v, l]) => `<button type="button" class="chip-btn${N.where === v ? ' on' : ''}" role="radio" aria-checked="${N.where === v}" data-cn-where="${v}">${l}</button>`).join('')}</div>
${N.where === 'compare' ? `<div class="chips cn-runs">${N.runs.map((r, i) => `<button type="button" class="chip-btn on" data-cn-run="${i}" aria-label="Agent ${i + 1}: ${ENGINE[r]}, tap to switch">${ENGINE[r]}</button>`).join('')}${N.runs.length < 3 ? '<button type="button" class="chip-btn" data-cn-run-add>+ Add</button>' : ''}${N.runs.length > 2 ? '<button type="button" class="chip-btn" data-cn-run-drop>Remove</button>' : ''}</div>` : ''}
<p class="cn-note">${N.where === 'folder' ? `Works straight in ${esc(N.repo.branch ?? 'the repo')}.` : `${N.where === 'compare' ? `${N.runs.length} agents get the same task, each in its own copy` : 'Its own copy'} on a new branch from ${esc(N.repo.branch ?? 'HEAD')}; you merge back the one you want.`}${N.where !== 'folder' && N.repo.dirty ? ` Your ${AOS.plural(N.repo.dirty, 'uncommitted change')} won’t be in the copy.` : ''}</p></div>` : ''}
${agent ? modelFieldHTML(engine, N.model, 'data-cn-model') : ''}
${agent && tasks.length ? `<div class="field"><span class="f-label">Work on${N.tasks.size ? ` · ${N.tasks.size}` : ''}</span><div class="group cn-tasks">${(N.allTasks || tasks.length <= 6 ? tasks : tasks.filter((t, i) => i < 5 || N.tasks.has(t.id))).map((t) => `<button type="button" class="lrow cn-task${N.tasks.has(t.id) ? ' on' : ''}" role="checkbox" aria-checked="${N.tasks.has(t.id)}" data-cn-task="${esc(t.id)}"><i class="dot" style="--c:${AOS.color(t.area)}"></i><span class="rbody"><span class="rtitle">${esc(t.title)}</span></span><span class="cn-check" aria-hidden="true">${I.check}</span></button>`).join('')}${tasks.length > 6 ? `<button type="button" class="lrow jmore" data-cn-alltasks aria-expanded="${!!N.allTasks}"><span class="rbody">${N.allTasks ? 'Show less' : `Show ${tasks.length - 5} more`}</span>${N.allTasks ? I.chevU : I.chevD}</button>` : ''}</div></div>` : ''}
${chat ? `<div class="field"><span class="f-label">Permissions</span><div class="chips" role="radiogroup">${MODES.map(([v, l]) => `<button type="button" class="chip-btn${N.mode === v ? ' on' : ''}" role="radio" aria-checked="${N.mode === v}" data-cn-mode="${v}">${l}</button>`).join('')}</div></div>
<div class="group js-sets"><label class="lrow jsw-row"><span class="rbody"><span class="rtitle">Plan first</span><span class="rmeta wrap">It writes a plan and waits for your OK before changing anything</span></span><input type="checkbox" switch id="cnPlan" ${N.plan ? 'checked' : ''} /></label></div>` : ''}
${N.kind === 'shell' && !W.termSettings.phoneShellInput ? '<p class="jhint">It opens read-only here. To send commands from the phone, turn on typing into plain terminals in Board settings.</p>' : `<div class="field"><span class="f-label">${N.kind === 'shell' ? 'First command' : 'What should it do?'}</span><div class="ctx-box js-ask"><textarea id="cnText" rows="2" placeholder="${N.kind === 'shell' ? 'Optional, e.g. git status' : N.tasks.size ? 'Anything to add (optional)' : 'Describe the work'}">${esc(keep)}</textarea>${voice.micButtonHTML('data-mic-for="cnText"')}</div><div class="rec-slot" data-rec-for="cnText"></div></div>`}
<button class="btn primary block js-go" id="cnStart" type="button" style="--c:var(--jobs-fill)">${agent ? I[engine] : I.term}${N.where === 'compare' && agent ? `Start ${N.runs.length} agents` : chat ? `Start chat with ${ENGINE[engine]}` : 'Open the terminal'}</button>`;
  if (fresh) $('.sheet-body', newEl).scrollTop = 0;
}
newEl.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('[data-cn-close]')) { newSheet.close(); return; }
  const k = t.closest('[data-cn-kind]'); if (k) { const was = engineOf(N.kind); N.kind = k.dataset.cnKind; if (engineOf(N.kind) !== was) N.model = lastModel(engineOf(N.kind)); AOS.haptic('selection'); drawNew(); return; }
  const ml = t.closest('[data-cn-model]'); if (ml) { N.model = ml.dataset.cnModel; rememberModel(engineOf(N.kind), N.model); AOS.haptic('selection'); drawNew(); return; }
  const pj = t.closest('[data-cn-project]'); if (pj) { N.project = pj.dataset.cnProject || null; N.tasks.clear(); AOS.haptic('selection'); drawNew(); checkRepo(); return; }
  const wh = t.closest('[data-cn-where]'); if (wh) { N.where = wh.dataset.cnWhere; N.picked = true; if (N.where !== 'compare') rememberWorktree(N.where === 'copy'); AOS.haptic('selection'); drawNew(); return; }
  const r = t.closest('[data-cn-run]'); if (r) { const i = +r.dataset.cnRun; if (i > 0) { N.runs[i] = N.runs[i] === 'claude' ? 'codex' : 'claude'; drawNew(); } else AOS.toast('The first agent follows the kind you picked'); return; }
  if (t.closest('[data-cn-run-add]')) { N.runs.push(N.runs.at(-1) === 'claude' ? 'codex' : 'claude'); drawNew(); return; }
  if (t.closest('[data-cn-run-drop]')) { N.runs.pop(); drawNew(); return; }
  const tk = t.closest('[data-cn-task]'); if (tk) { const id = tk.dataset.cnTask; if (N.tasks.has(id)) N.tasks.delete(id); else N.tasks.add(id); AOS.haptic('selection'); drawNew(); return; }
  if (t.closest('[data-cn-alltasks]')) { N.allTasks = !N.allTasks; AOS.haptic('selection'); drawNew(); return; }
  const md = t.closest('[data-cn-mode]'); if (md) { N.mode = md.dataset.cnMode; AOS.haptic('selection'); drawNew(); return; }
  const go = t.closest('#cnStart');
  if (!go || go.disabled) return;
  if (voice.busy()) { AOS.toast('Finish the recording first'); return; }
  go.disabled = true; go.textContent = 'Starting';
  try { await startSessions(); newSheet.close(); } catch (er) { AOS.toast(err(er)); go.disabled = false; drawNew(); }
});
newEl.addEventListener('change', (e) => { if (e.target.id === 'cnPlan') N.plan = e.target.checked; });

const shortTitle = (s) => { const l = String(s ?? '').trim().split('\n')[0]; return l.length <= 60 ? l : `${l.slice(0, 60).replace(/\s+\S*$/, '')}…`; };
function taskPrompt(tasks, extra) {
  const lines = [];
  if (tasks.length) {
    lines.push(tasks.length === 1 ? 'Work on this task:' : 'Work on these tasks:');
    for (const t of tasks) lines.push(`- ${t.title} (task ${t.id})${t.notes ? `: ${String(t.notes).replace(/\s+/g, ' ').slice(0, 600)}` : ''}`);
  }
  if (extra.trim()) lines.push(tasks.length ? `\n${extra.trim()}` : extra.trim());
  if (tasks.length) lines.push('\nWhen you are done, reply with a short summary of what changed and how you checked it.');
  return lines.join('\n').trim();
}
async function startSessions() {
  const chat = N.kind.endsWith('-chat'), agent = N.kind !== 'shell';
  const text = $('#cnText', newEl)?.value.trim() ?? '';
  const tasks = [...N.tasks].map((id) => AOS.taskById(id)).filter(Boolean);
  if (chat && !tasks.length && !text) throw new Error('Describe the work or pick a task first.');
  const p = N.project ? projectBySlug(N.project) : null;
  const compare = N.where === 'compare' && agent;
  const engines = compare ? N.runs : [N.kind.startsWith('codex') ? 'codex' : 'claude'];
  const group = compare ? `g_${Math.random().toString(36).slice(2, 10)}` : null;
  const labels = engines.map((e, i) => `${ENGINE[e]}${engines.filter((x) => x === e).length > 1 ? ` ${engines.slice(0, i + 1).filter((x) => x === e).length}` : ''}`);
  const base = tasks.length === 1 ? tasks[0].title : tasks.length ? `${tasks[0].title} (+${tasks.length - 1})` : shortTitle(text) || undefined;
  // The picked model belongs to the picked engine; another engine in a compare uses its own last choice.
  const modelFor = (e) => (e === engineOf(N.kind) ? N.model : lastModel(e)) || undefined;
  const opened = [];
  for (const [i, eng] of engines.entries()) {
    let cwd = null;
    if (N.where !== 'folder' && p?.folder) {
      const r = await AOS.api('/worktrees', { method: 'POST', body: JSON.stringify({ folder: p.folder, title: base ?? (agent ? 'Agent work' : 'Terminal'), project: N.project, group, label: compare ? labels[i] : null }) });
      cwd = r.worktree.cwd;
    }
    const title = compare ? `${base ?? 'Compare'} · ${labels[i]}` : base;
    if (chat) {
      const body = { engine: eng, model: modelFor(eng), taskIds: tasks.map((t) => t.id), project: N.project ?? undefined, title, context: text || undefined, mode: N.mode, plan: N.plan, ...(cwd ? { cwd } : {}) };
      const r = await AOS.api('/jobs', { method: 'POST', body: JSON.stringify(body) });
      putJob(r.job);
      opened.push(['job', r.job.id]);
    } else {
      const kind = agent ? eng : 'shell';
      const prompt = agent ? taskPrompt(tasks, text) : '';
      const r = await AOS.api('/term', { method: 'POST', body: JSON.stringify({ kind, model: agent ? modelFor(eng) : undefined, project: N.project, cwd: cwd ?? undefined, title, prompt: prompt || undefined, taskIds: tasks.map((t) => t.id) }) });
      if (kind === 'shell' && text) await AOS.api(`/term/${r.session.id}/send`, { method: 'POST', body: JSON.stringify({ text }) }).catch(() => {});
      W.terms.unshift(r.session);
      opened.push(['term', r.session.id]);
    }
  }
  for (const t of tasks) if (t.status !== 'done' && chat) AOS.adopt('task', { id: t.id, status: 'doing' });
  AOS.haptic('success');
  await loadCode();
  if (compare) openCode('compare', group);
  else if (opened[0][0] === 'job') openJob(opened[0][1]);
  else openCode('term', opened[0][1]);
}

/** The board is the Jobs tab now (setTab('code') opens it on Board); a terminal, copy or compare pushes over the current tab. */
export function openCode(kind = 'code', id = 'all') {
  if (kind === 'code') { AOS.setTab('code'); return; }
  const ui = AOS.ui();
  if (!ui.stack[ui.tab]) AOS.setTab('jobs');
  const top = AOS.topDetail();
  if (top?.dataset.kind === kind && top.dataset.id === id) return;
  AOS.push(kind, id);
}

// ---------- Wiring ----------
AOS.detail('code', { render: renderCodePage });
AOS.detail('term', { render: renderTermPage });
AOS.detail('copy', { render: renderCopyPage });
AOS.detail('compare', { render: renderComparePage });
onChange(() => {
  for (const box of document.querySelectorAll('.code-page, .compare-page')) box._draw?.();
  for (const S of termPages) drawTerm(S);
});
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('[data-code-new]')) { openNewSession(); return; }
  if (t.closest('[data-open-code]')) { openCode(); return; }
  const ot = t.closest('[data-open-term]'); if (ot) { openCode('term', ot.dataset.openTerm); return; }
  const oc = t.closest('[data-open-copy]'); if (oc) { openCode('copy', oc.dataset.openCopy); return; }
  const cm = t.closest('[data-open-compare]'); if (cm) { openCode('compare', cm.dataset.openCompare); return; }
  const page = t.closest('.page.detail[data-kind="term"]');
  const S = page && [...termPages].find((x) => x.el === page);
  if (!S) return;
  const key = t.closest('[data-term-key]');
  if (key) {
    AOS.haptic('light');
    try { await AOS.api(`/term/${S.id}/key`, { method: 'POST', body: JSON.stringify({ key: key.dataset.termKey }) }); setTimeout(() => tick(S, true), 250); } catch (er) { AOS.toast(err(er)); }
    return;
  }
  const act = t.closest('[data-term-act]');
  if (act) {
    const a = act.dataset.termAct;
    try {
      const r = await AOS.api(`/term/${S.id}/${a}`, { method: 'POST', body: JSON.stringify(a === 'done' ? { completeTasks: true } : {}) });
      if (a === 'done') {
        AOS.haptic('success');
        for (const id of r.closed ?? []) AOS.adopt('task', { id, status: 'done', completedAt: new Date().toISOString() });
        AOS.render();
        AOS.toast(r.failed?.length ? `Couldn’t close ${r.failed.map((f) => f.id).join(', ')}` : r.closed?.length ? `Closed ${r.closed.join(', ')}` : 'Marked done');
      } else AOS.toast(a === 'kill' ? 'Stopped' : 'Starting again');
      await loadCode();
      tick(S, true);
    } catch (er) { AOS.toast(err(er)); }
  }
});
document.addEventListener('change', async (e) => {
  if (!e.target.matches?.('[data-shell-input]')) return;
  const on = e.target.checked;
  try { const r = await AOS.api('/term/settings', { method: 'POST', body: JSON.stringify({ phoneShellInput: on }) }); W.termSettings = r.settings; emit(); }
  catch (er) { e.target.checked = !on; AOS.toast(err(er)); }
});
// The terminal's "Watching only" bar: turn typing into plain terminals on (the same switch as Board settings).
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-term-typing]');
  if (!b || b.disabled) return;
  b.disabled = true;
  try {
    const r = await AOS.api('/term/settings', { method: 'POST', body: JSON.stringify({ phoneShellInput: true }) });
    W.termSettings = r.settings;
    AOS.haptic('success');
    AOS.toast('Typing on for plain terminals. Turn it off in Board settings');
    emit();
  } catch (er) { b.disabled = false; AOS.toast(err(er)); }
});

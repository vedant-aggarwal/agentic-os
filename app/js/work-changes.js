// Work · review on the real engine: what a job changed, from its turn checkpoints on the PC (GET /jobs/:id/diff), read
// and judged file by file on the phone, then shipped. Checkpoint chips pick the whole job or one turn; the proof card
// says what it did and what it ran to check it (tests, builds); each file is kept (a mark, synced) or reverted (the
// file really goes back on the PC, with Undo). A file opens to its diff, word-level, with Keep and Revert under the
// thumb; tap a line to leave a comment that rides with the next message. Ship takes what is left: merge the job's own
// copy as one commit, open a PR, or hand it to the Builder. Its copy and compares (two agents, keep one) live here too.
import { $, $$, esc, push, pop, openSheet, closeSheet, toast, on, haptic, swipeRows } from './core.js';
import { I } from './icons.js';
import { project } from './data.js';
import { api, provide } from './bus.js';
import * as E from './work-engine.js';
import { WI, stat, backLabel, agentName, plural, markFor, hhmmOf } from './work-ui.js';
import { addComment, md } from './work-live.js';

const { act, raw, err } = E;
const FK = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' };
const KIND = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed' };
const nameOf = (p) => String(p).split('/').pop();
const dirOf = (p) => String(p).slice(0, -nameOf(p).length) || './';
const sum = (fs) => fs.reduce((t, f) => [t[0] + (f.add ?? 0), t[1] + (f.del ?? 0)], [0, 0]);
const busy = (j) => ['starting', 'running', 'needs_input'].includes(j?.status);

// ── marks: synced through the Work module's collection, else kept for this session ──
const LOCAL = new Map();   // job id → Map(path → { mark })
function marks(jobId) {
  if (E.moduleOn.yes) return E.marksOf(jobId);
  return LOCAL.get(jobId) ?? LOCAL.set(jobId, new Map()).get(jobId);
}
function mark(jobId, path, v, extra = {}) {
  if (E.moduleOn.yes) { E.setMark(jobId, path, v, extra); return; }
  const m = marks(jobId);
  if (v) m.set(path, { mark: v, path, ...extra }); else m.delete(path);
}
const reviewOf = (jobId, files) => { const m = marks(jobId); const kept = files.filter((f) => m.get(f.path)?.mark === 'kept').length, rev = files.filter((f) => m.get(f.path)?.mark === 'reverted').length; return { n: files.length, kept, rev, left: files.length - kept - rev }; };

// ── a unified diff for the phone: each file's hunks, long files cut ──
export function parsePatch(patch) {
  const out = new Map();
  let cur = null, h = null, oldN = 0, newN = 0;
  for (const line of String(patch ?? '').split('\n')) {
    const m = line.match(/^diff --git a\/(.*?) b\/(.*)$/);
    if (m) { cur = { path: m[2], from: m[1] !== m[2] ? m[1] : null, binary: false, hunks: [], n: 0, cut: 0 }; out.set(cur.path, cur); h = null; continue; }
    if (!cur) continue;
    if (!h) { if (line.startsWith('rename from ')) cur.from = line.slice(12); else if (/^Binary files /.test(line)) cur.binary = true; }
    const hh = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
    if (hh) { oldN = +hh[1]; newN = +hh[3]; h = { range: `−${hh[1]},${hh[2] ?? 1} +${hh[3]},${hh[4] ?? 1}`, ctx: hh[5] ?? '', lines: [] }; cur.hunks.push(h); continue; }
    if (!h || line === '') continue;   // a real blank context line is ' '; '' is the end of the patch
    if (cur.n >= 600) { cur.cut++; continue; }
    cur.n++;
    if (line.startsWith('+')) h.lines.push(['+', newN++, line.slice(1)]);
    else if (line.startsWith('-')) h.lines.push(['-', oldN++, line.slice(1)]);
    else if (line.startsWith('\\')) h.lines.push(['\\', '', line.slice(1).trim()]);
    else { h.lines.push([' ', newN, line.slice(1)]); oldN++; newN++; }
  }
  return out;
}
// a removed line and the added line after it highlight only the words that changed
function pairWords(a, b) {
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let k = 0; while (k < a.length - i && k < b.length - i && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
  const mid = (s) => s.length - i - k;
  if (mid(a) > a.length * 0.7 && mid(b) > b.length * 0.7) return null;
  const w = (s) => (mid(s) > 0 ? `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, s.length - k))}</mark>${esc(s.slice(s.length - k))}` : esc(s));
  return [w(a), w(b)];
}
function hunkHtml(h, cm) {
  const html = h.lines.map(([k, n, l]) => [k, n, esc(l)]);
  for (let x = 0; x < h.lines.length - 1; x++) if (h.lines[x][0] === '-' && h.lines[x + 1][0] === '+') { const p = pairWords(h.lines[x][2], h.lines[x + 1][2]); if (p) { html[x][2] = p[0]; html[x + 1][2] = p[1]; } }
  return `<div class="dv-hunk mono">@@ ${esc(h.range)} @@${h.ctx ? ` <span>${esc(h.ctx)}</span>` : ''}</div>
    <div class="dv-code mono">${html.map(([k, n, l]) => { const key = `${k === '-' ? '-' : '+'}${n}`; return k === '\\' ? `<div class="dl dl-note"><i class="dl-n"></i><i class="dl-k"></i><span class="dl-c">${l}</span></div>` : `<div class="dl${k === '+' ? ' a' : k === '-' ? ' d' : ''}${cm.has(key) ? ' has-c' : ''}" role="button" tabindex="0" data-ln="${n}" data-k="${k === '-' ? '-' : '+'}" aria-label="Line ${n}${cm.has(key) ? ', has your comment' : ''}"><i class="dl-n">${n}</i><i class="dl-k">${k === '+' ? '+' : k === '-' ? '−' : ''}</i><span class="dl-c">${l || ' '}</span></div>`; }).join('')}</div>`;
}

// ── the Changes page ──────────────────────────────────────────────────
const pages = new Set();
/** The job's changes: turn 0 is the whole job, n one turn's checkpoint. */
export function openLiveChanges(jobId, turn = 0) {
  const top = $('#stack')?.lastElementChild;
  if (top?.classList.contains('lvc-page') && top.dataset.job === jobId) { const S0 = [...pages].find((x) => x.page === top); if (S0 && S0.turn !== turn) { S0.turn = turn; loadDiff(S0); } return; }
  const S = { jobId, turn, data: null, turns: null, events: null, busy: false, alive: true };
  const page = push({
    title: 'Changes', back: backLabel(), cls: 'lvc-page',
    right: `<button class="gbtn chrome icon" data-act="lvc-menu" aria-label="More">${I.dots}</button>`,
    onPop: () => { S.alive = false; pages.delete(S); },
    render(sc, pg) {
      pg.classList.add('jpage', 'wr-page');
      pg.dataset.job = jobId;
      S.page = pg; S.sc = sc;
      sc.innerHTML = '<div class="phead"><h1 class="lt">Changes</h1><p class="sub num wr-sum">Reading the checkpoints on your PC…</p></div><div class="lvc-body"></div>';
      swipeRows(sc, '.wr-file', { right: (r) => judge(S, r.dataset.path, 'kept'), left: (r) => judge(S, r.dataset.path, 'reverted') });
      sc.addEventListener('click', (e) => { const t = e.target.closest('[data-lvc-turn]'); if (!t) return; const n = Number(t.dataset.lvcTurn); if (n === S.turn) return; S.turn = n; haptic(5); loadDiff(S); });
    },
  });
  pages.add(S);
  E.hasWorkModule().then(() => { if (S.alive) draw(S); });
  // the turns first: a job with no checkpoint has nothing to diff, so the diff isn't asked for (loadDiff checks)
  act.turns(jobId).then((r) => { S.turns = r; }).catch(() => {}).then(() => { if (S.alive) loadDiff(S); });
  act.get(jobId).then((r) => { S.events = r.events ?? []; if (r.job) E.putJob(r.job); if (S.alive) draw(S); }).catch(() => {});
  return page;
}
async function loadDiff(S) {
  S.data = null; draw(S);
  // no turn in this span has a checkpoint (no turns yet, or they were dropped): the plain empty state, no request
  const span = S.turns ? (S.turns.turns ?? []).filter((t) => !S.turn || t.n === S.turn) : null;
  if (span && !span.some((t) => t.checkpoint)) { S.data = { files: [], patch: '', error: S.turns.error ? `No checkpoint: ${S.turns.error}` : null }; S.parts = new Map(); if (S.alive) draw(S); return; }
  try { S.data = await act.diff(S.jobId, S.turn); S.parts = parsePatch(S.data.patch); }
  catch (e) { S.data = { files: [], patch: '', error: e.status === 404 ? (e.message || 'This job has no file checkpoints.') : e.status >= 500 ? 'Your PC couldn’t read this job’s checkpoints. Its files are as the job left them.' : err(e) }; S.parts = new Map(); }
  if (S.alive) draw(S);
}
function draw(S) {
  const j = raw(S.jobId);
  const sc = S.sc; if (!sc) return;
  const d = S.data;
  const files = d?.files ?? [];
  const [a, dl] = sum(files);
  const head = $('.wr-sum', sc);
  head.innerHTML = !d ? 'Reading the checkpoints on your PC…' : d.error ? esc(d.error) : files.length ? `${stat(a, dl)}<span>across ${plural(files.length, 'file')}${S.turn ? ` in turn ${S.turn}` : ''}${d.live && busy(j) ? ' · still working' : ''}</span>` : `<span>No file changes ${S.turn ? 'in this turn' : 'in this job'}</span>`;
  const turns = (S.turns?.turns ?? []).filter((t) => t.checkpoint || t.files);
  const chip = (n, label, sub) => `<button class="wr-cp${S.turn === n ? ' on' : ''}" data-lvc-turn="${n}" role="tab" aria-selected="${S.turn === n}"><b>${label}</b>${sub ? `<span class="num">${esc(sub)}</span>` : ''}</button>`;
  const r = reviewOf(S.jobId, files);
  const m = marks(S.jobId);
  const ship = shipRoutes(j);
  const body = !d ? '<div class="lvc-wait"><span class="spin" style="--c:var(--jobs)"></span></div>'
    : `${turns.length > 1 || S.turn ? `<div class="wr-cps" role="tablist" aria-label="Checkpoints" data-scroll-x>${chip(0, 'Whole job', '')}${turns.map((t) => chip(t.n, `Turn ${t.n}`, `${hhmmOf(t.at)}${t.files ? ` · ${t.files}` : ''}${t.reverted ? ' · undone' : ''}`)).join('')}</div>` : ''}
    ${proofCard(S, j)}
    ${files.length ? `<div class="wr-meter" role="img" aria-label="${r.n - r.left} of ${r.n} files reviewed">
      <span class="wr-m-t"><b class="met">${r.n - r.left}</b><small> of ${r.n} reviewed</small></span>
      <span class="wr-m-k">${r.kept ? `<span class="c-jobs">${r.kept} kept</span>` : ''}${r.rev ? `<span class="wr-rv">${r.rev} reverted</span>` : ''}</span>
      <span class="wr-bar" aria-hidden="true">${files.map((f) => `<i class="${m.get(f.path)?.mark ?? ''}"></i>`).join('')}</span></div>
    <div class="group wr-files">${files.map((f) => fileRow(S, f, m.get(f.path)?.mark)).join('')}</div>
    <p class="hint">Swipe a file right to keep it, left to put it back on your PC. Tap it to read the diff.${E.moduleOn.known && !E.moduleOn.yes ? ' Putting back one file needs the Work module on your PC; Undo turn works now.' : ''}</p>` : ''}
    <div class="pad wr-acts">
      ${files.length && ship.routes.length ? (r.left === 0 && r.kept ? `<button class="btn primary block" style="--c:var(--jobs-fill)" data-act="lvc-ship">${ship.copy ? WI.merge : WI.commit}Ship ${plural(r.kept, 'file')}</button>` : `<button class="btn primary block" style="--c:var(--jobs-fill)" data-act="lvc-keep-rest">${I.check}Keep ${r.left === r.n ? 'all' : `the other ${r.left}`} and ship</button>`) : ''}
      ${files.length ? `<button class="btn block wr-undo" data-act="lvc-undo" ${busy(j) || S.busy ? 'disabled' : ''}>${WI.revert}${S.busy ? 'Undoing…' : S.turn ? `Undo turn ${S.turn}` : 'Undo every change'}</button>
      <p class="foot">${busy(j) ? 'Wait for the agent to finish its turn first.' : S.turn ? `Files go back to how they were before turn ${S.turn}${(S.turns?.turns ?? []).some((t) => t.n > S.turn) ? '; later turns’ changes go too' : ''}. The chat stays.` : 'Files go back to how they were before this job. The chat stays.'}</p>` : ''}
      ${!ship.routes.length && files.length ? `<p class="foot">${esc(ship.why)}</p>` : ''}
    </div>`;
  const box = $('.lvc-body', sc);
  if (box._html !== body) { box.innerHTML = body; box._html = body; }
}
// before the diff: what the agent says it did, and the evidence that it works
const PROOF = /\b(test|tests|build|lint|tsc|typecheck|check|vitest|jest|pytest|playwright|shoot|node --check|cargo build|xcodebuild)\b/i;
function proofCard(S, j) {
  const evs = S.events ?? [];
  const turnSeq = S.turn ? evs.find((e) => e.type === 'user' && !e.steer && e.turn === S.turn)?.seq ?? null : null;
  const nextSeq = S.turn ? evs.find((e) => e.type === 'user' && !e.steer && e.turn === S.turn + 1)?.seq ?? Infinity : Infinity;
  const inTurn = (e) => !S.turn || (turnSeq != null && e.seq >= turnSeq && e.seq < nextSeq);
  const said = S.turn ? evs.filter((e) => inTurn(e) && e.type === 'assistant' && e.text?.trim()).at(-1)?.text : j?.summary;
  const runs = evs.filter((e) => inTurn(e) && e.type === 'tool' && e.tool?.kind === 'execute' && PROOF.test(e.tool.title ?? '') && ['completed', 'failed'].includes(e.tool.status)).slice(-5);
  if (!said && !runs.length) return '';
  return `<div class="wr-proof surface">
    <p class="wr-pf-h">${markFor(j ?? 'claude', 18, { state: j?.status === 'failed' ? 'failed' : 'done' })}<b>${S.turn ? `Turn ${S.turn}` : 'What it did'}</b><span class="cap">${esc(agentName(j?.engine))}</span></p>
    ${said ? `<div class="wr-pf-s m-md${String(said).length > 360 ? ' clamp' : ''}">${md(String(said).slice(0, 4000))}</div>${String(said).length > 360 ? '<button class="text-btn wr-pf-more" data-act="lvc-more">Read all</button>' : ''}` : ''}
    ${runs.length ? `<div class="wr-pf-c">${runs.map((e) => `<span class="wr-pf${e.tool.status === 'failed' ? ' bad' : ''}">${e.tool.status === 'failed' ? I.x : WI.checkC}<span class="mono-ish ell">${esc(String(e.tool.title).split('\n')[0].slice(0, 60))}</span></span>`).join('')}</div>` : ''}
  </div>`;
}
function fileRow(S, f, s) {
  const k = FK[f.status] ?? 'M';
  return `<button class="row wr-file${s ? ` is-${s}` : ''}" data-act="lvc-open" data-path="${esc(f.path)}" data-swipe-host>
    <span class="fk fk-${k}" role="img" aria-label="${KIND[k]}">${k}</span>
    <span class="rbody"><span class="rtitle mono">${esc(nameOf(f.path))}</span><span class="rmeta mono jf-path">${esc(k === 'R' && S.parts?.get(f.path)?.from ? `from ${S.parts.get(f.path).from}` : dirOf(f.path))}</span></span>
    <span class="jf-n num">${stat(f.add, f.del)}</span>
    <span class="wr-st" aria-label="${s === 'kept' ? 'Kept' : s === 'reverted' ? 'Put back' : 'Not reviewed'}">${s === 'kept' ? I.check : s === 'reverted' ? WI.revert : ''}</span>
  </button>`;
}
const redraw = (jobId) => {
  for (const S of [...pages]) { if (S.page && !S.page.isConnected) { pages.delete(S); continue; } if (S.jobId === jobId) draw(S); }
  for (const F of [...files]) { if (F.page && !F.page.isConnected) { files.delete(F); continue; } if (F.jobId === jobId) F.draw(); }
  document.dispatchEvent(new CustomEvent('work:change', { detail: { job: jobId } }));
};

// keep (a mark) or revert (the file goes back on the PC, with Undo)
async function judge(S, path, v) {
  const jobId = S.jobId ?? S;
  const cur = marks(jobId).get(path);
  const f = (S.data?.files ?? []).find((x) => x.path === path);
  if (v === 'kept') {
    if (cur?.mark === 'reverted') { toast('Put it back first: Undo on its row'); return; }
    mark(jobId, path, cur?.mark === 'kept' ? null : 'kept');
    haptic(10); redraw(jobId);
    if (cur?.mark !== 'kept') toast(`Kept ${nameOf(path)}`, () => { mark(jobId, path, null); redraw(jobId); });
    return;
  }
  if (cur?.mark === 'reverted') { undoRevert(jobId, path, cur); return; }
  if (busy(raw(jobId))) { toast('Wait for the agent to finish its turn, or stop it, first'); return; }
  if (!(await E.hasWorkModule())) { toast('Putting back one file needs the Work module on your PC. Undo the turn instead'); return; }
  try {
    haptic(14);
    const r = await E.revertFile(jobId, path, S.turn ?? 0);
    mark(jobId, path, 'reverted', { blob: r.undo?.blob ?? null, turn: S.turn ?? 0, noted: false });
    redraw(jobId);
    toast(r.action === 'removed' ? `Removed ${nameOf(path)}: the job added it` : r.action === 'unchanged' ? `${nameOf(path)} was already as before` : `Put back ${nameOf(path)}`, () => undoRevert(jobId, path, { blob: r.undo?.blob ?? null }));
    void f;
  } catch (e) { toast(err(e)); }
}
async function undoRevert(jobId, path, m) {
  try { await E.restoreFile(jobId, path, m.blob ?? null); mark(jobId, path, null); redraw(jobId); haptic(8); toast(`${nameOf(path)} has the job’s change again`); }
  catch (e) { toast(err(e)); }
}
on('lvc-more', (el) => { const box = el.previousElementSibling; const open = box.classList.toggle('open'); el.textContent = open ? 'Show less' : 'Read all'; haptic(4); });
on('lvc-open', (el) => { const S = [...pages].find((x) => x.page === el.closest('.page')); if (S) openFile(S, el.dataset.path); });
on('lvc-keep-rest', (el) => {
  const S = [...pages].find((x) => x.page === el.closest('.page')); if (!S) return;
  const m = marks(S.jobId);
  for (const f of S.data?.files ?? []) if (!m.get(f.path)) mark(S.jobId, f.path, 'kept');
  haptic(12); redraw(S.jobId); setTimeout(() => shipSheet(S.jobId, S.data?.files ?? []), 220);
});
on('lvc-ship', (el) => { const S = [...pages].find((x) => x.page === el.closest('.page')); if (S) shipSheet(S.jobId, S.data?.files ?? []); });
on('lvc-undo', async (el) => {
  const S = [...pages].find((x) => x.page === el.closest('.page')); if (!S || S.busy) return;
  const j = raw(S.jobId);
  if (busy(j)) { toast('Wait for the agent to finish its turn first'); return; }
  const later = (S.turns?.turns ?? []).some((t) => t.n > S.turn);
  const ok = await E.confirm(S.turn
    ? { title: `Undo turn ${S.turn}?`, body: `Files go back to how they were before turn ${S.turn}.${later ? ' Later turns’ changes go too.' : ''} This can’t be brought back from the phone.`, ok: `Undo turn ${S.turn}`, cancel: 'Keep', danger: true }
    : { title: 'Undo every change?', body: 'Files go back to how they were before this job. This can’t be brought back from the phone.', ok: 'Undo every change', cancel: 'Keep', danger: true });
  if (!ok) return;
  S.busy = true; draw(S);
  try { const r = await act.revert(S.jobId, S.turn || 1); haptic('success'); toast(`Put back: ${plural(r.restored ?? 0, 'file')} restored, ${r.removed ?? 0} removed`); }
  catch (e) { toast(err(e)); }
  S.busy = false;
  loadDiff(S);
});
on('lvc-menu', (el) => {
  const S = [...pages].find((x) => x.page === el.closest('.page')); if (!S) return;
  openSheet({ title: 'Changes', sub: esc(raw(S.jobId)?.title ?? ''), body: `<div class="group">
    <button class="row ic" data-act="lvc-all" data-v="kept"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle">Keep every file</span></span></button>
    <button class="row ic" data-act="lvc-all" data-v=""><span class="tile">${I.undo}</span><span class="rbody"><span class="rtitle">Clear my marks</span><span class="rmeta">Files you put back stay put back</span></span></button>
    <button class="row ic" data-act="lvc-ship"><span class="tile">${WI.merge}</span><span class="rbody"><span class="rtitle">Ship what I kept…</span></span></button></div>` });
  holdPage = S;
});
let holdPage = null;
on('lvc-all', (el) => {
  const S = holdPage; closeSheet(); if (!S) return;
  const m = marks(S.jobId);
  for (const f of S.data?.files ?? []) { const cur = m.get(f.path)?.mark; if (cur === 'reverted') continue; mark(S.jobId, f.path, el.dataset.v || null); }
  redraw(S.jobId); toast(el.dataset.v ? 'Kept every file' : 'Marks cleared');
});

// ── one file: its diff, and Keep / Revert under the thumb ──
const files = new Set();
function openFile(S, path) {
  const list = S.data?.files ?? [];
  const F = { jobId: S.jobId, S, i: Math.max(0, list.findIndex((f) => f.path === path)), parts: S.parts ?? new Map(), extra: new Map() };
  push({
    title: nameOf(path), back: 'Changes', cls: 'lvf-page',
    titleHtml: '<span class="wf-pos num"></span>',
    right: `<button class="gbtn chrome icon" data-act="lvf-step" data-d="-1" aria-label="Previous file">${I.chevU}</button><button class="gbtn chrome icon" data-act="lvf-step" data-d="1" aria-label="Next file">${I.chevD}</button>`,
    onPop: () => files.delete(F),
    render(sc, page) {
      page.classList.add('jpage', 'wf-page');
      page.dataset.job = S.jobId;
      page.insertAdjacentHTML('beforeend', '<div class="wf-bar chrome"></div>');
      F.page = page; F.sc = sc;
      F.draw = () => drawFile(F);
      F.draw();
    },
  });
  files.add(F);
}
async function drawFile(F) {
  const list = F.S.data?.files ?? [];
  const f = list[F.i]; if (!f) return;
  const s = marks(F.jobId).get(f.path)?.mark;
  const t = $('.tb-title', F.page);
  t.innerHTML = `${esc(nameOf(f.path))}<small class="num">${F.i + 1} of ${list.length}</small>`; t.classList.add('always');
  let part = F.extra.get(f.path) ?? F.parts.get(f.path);
  // a file the page's patch didn't carry (cut at 400 KB): ask for its own
  if (!part && f.status !== 'deleted' && !F.asked?.has(f.path)) {
    (F.asked ??= new Set()).add(f.path);
    act.diff(F.jobId, F.S.turn, f.path).then((r) => { const p = parsePatch(r.patch).get(f.path); if (p) { F.extra.set(f.path, p); if (files.has(F)) F.draw(); } }).catch(() => {});
  }
  const k = FK[f.status] ?? 'M';
  const cm = new Set((F.cm ??= new Map()).get(f.path) ?? []);
  const body = part?.binary ? '<p class="dv-note">A binary file. Open it on your PC to see it.</p>'
    : k === 'D' ? `<p class="dv-note">${plural(f.del ?? 0, 'line')} removed with the file.</p>`
    : part?.hunks?.length ? part.hunks.map((h) => hunkHtml(h, cm)).join('') + (part.cut ? `<p class="dv-note">${plural(part.cut, 'more line')} in this file. See them on your PC.</p>` : '')
    : `<p class="dv-note">${k === 'R' && part?.from ? `Moved from <span class="mono">${esc(part.from)}</span>. ` : ''}${(f.add ?? 0) + (f.del ?? 0) ? `${plural((f.add ?? 0) + (f.del ?? 0), 'line')} changed. Reading the diff…` : 'No line changes.'}</p>`;
  F.sc.innerHTML = `<div class="wf-head"><span class="fk fk-${k}" role="img" aria-label="${KIND[k]}">${k}</span><span class="wf-p"><b class="mono">${esc(nameOf(f.path))}</b><span class="mono">${esc(k === 'R' && part?.from ? `from ${part.from}` : dirOf(f.path))}</span></span><span class="jf-n num">${stat(f.add, f.del)}</span></div>
    ${s ? `<p class="wf-said ${s}">${s === 'kept' ? I.check : WI.revert}${s === 'kept' ? 'You kept this file' : 'You put this file back on your PC. Tap Put back again to undo'}</p>` : ''}
    <div class="dv surface">${body}</div>
    ${part?.hunks?.length ? `<p class="hint">Tap a line to comment on it. Comments go with your next message to ${esc(agentName(raw(F.jobId)?.engine))}.</p>` : ''}`;
  F.sc.scrollTop = 0;
  $('.wf-bar', F.page).innerHTML = `<button class="btn wf-rev${s === 'reverted' ? ' on' : ''}" data-act="lvf-judge" data-v="reverted" aria-pressed="${s === 'reverted'}">${WI.revert}${s === 'reverted' ? 'Put back' : 'Revert'}</button>
    <button class="btn wf-keep${s === 'kept' ? ' on' : ''}" data-act="lvf-judge" data-v="kept" aria-pressed="${s === 'kept'}" style="--c:var(--jobs-fill)">${I.check}${s === 'kept' ? 'Kept' : 'Keep'}</button>`;
}
const fileOf = (el) => [...files].find((F) => F.page === el.closest('.page'));
on('lvf-step', (el) => { const F = fileOf(el); if (!F) return; const n = F.S.data?.files?.length ?? 1; F.i = (F.i + Number(el.dataset.d) + n) % n; haptic(5); F.draw(); });
on('lvf-judge', async (el) => {
  const F = fileOf(el); if (!F) return;
  const f = F.S.data.files[F.i];
  await judge(F.S, f.path, el.dataset.v);
  // a kept file moves you on to the next one you have not looked at; a revert stays put so its Undo stays in reach
  const m = marks(F.jobId);
  if (!m.get(f.path) || m.get(f.path).mark === 'reverted') { F.draw(); return; }
  const list = F.S.data.files;
  const next = list.findIndex((x, i) => i > F.i && !m.get(x.path));
  const wrap = next < 0 ? list.findIndex((x) => !m.get(x.path)) : next;
  if (wrap >= 0) setTimeout(() => { F.i = wrap; F.draw(); }, 260);
  else setTimeout(() => { pop(); toast('Every file reviewed. Ready to ship'); }, 320);
});
// tap a line: the comment rides along with the next message as file:line
document.addEventListener('click', (e) => {
  const ln = e.target.closest('.lvf-page .dl[data-ln]'); if (!ln) return;
  const F = fileOf(ln); if (!F) return;
  const f = F.S.data.files[F.i]; const n = ln.dataset.ln; const key = `${ln.dataset.k}${n}`;
  const line = ln.querySelector('.dl-c')?.textContent.trim() ?? '';
  openSheet({ title: `Line ${n}`, sub: `${esc(nameOf(f.path))} · goes with your next message to ${esc(agentName(raw(F.jobId)?.engine))}`, body: (b) => {
    b.innerHTML = `<div class="pad"><pre class="wf-cl mono">${esc(line.slice(0, 160))}</pre><label class="field wf-cta"><textarea rows="3" placeholder="What should change here?" aria-label="Your comment"></textarea></label><button class="btn primary block" style="--c:var(--jobs-fill)" data-act="lvf-comment" disabled>Add to my next message</button></div>`;
    const ta = $('textarea', b), btn = $('.btn', b);
    ta.addEventListener('input', () => { btn.disabled = !ta.value.trim(); });
    b._c = { F, f, n, key };
    setTimeout(() => ta.focus(), 420);
  } });
});
on('lvf-comment', (el) => {
  const b = el.closest('.sheet-body'); const c = b?._c; const text = $('textarea', b)?.value.trim(); if (!c || !text) return;
  addComment(c.F.jobId, { path: c.f.path, line: c.n, text });
  const set = c.F.cm.get(c.f.path) ?? []; set.push(c.key); c.F.cm.set(c.f.path, set);
  closeSheet(el.closest('.sheet')); haptic(8); c.F.draw();
  toast(`Comment added. It goes with your next message to ${agentName(raw(c.F.jobId)?.engine)}`);
});

// ── ship: what is left leaves the job ──
/** How this job's work can leave: its own copy (merge, PR, Builder), a repo folder (Builder, ask it to commit), or nothing. */
function shipRoutes(j) {
  if (!j) return { routes: [], why: '' };
  const w = j.workspace;
  const copy = w?.kind === 'worktree' && w.worktreeId && !['merged', 'removed'].includes(w.stage) ? w : null;
  if (copy) return { copy, routes: [['merge', WI.merge, `Merge into ${copy.base ?? 'main'} as one commit`, `Squashes ${String(copy.branch).replace(/^aos\//, '')} onto ${copy.base ?? 'its base'} and deletes the copy`], ['pr', WI.pr, 'Push and open a pull request', `${String(copy.branch).replace(/^aos\//, '')} into ${copy.base ?? 'main'} on GitHub`], ['builder', I.hammer, 'Hand to the Builder', 'The job publishes it; its Builder merges, tests, builds and restarts']] };
  if (j.git) return { copy: null, routes: [['builder', I.hammer, 'Hand to the Builder', 'The job publishes it; its Builder commits, tests and ships'], ['commit', WI.commit, 'Ask it to commit', 'One commit on the branch the folder is on, with this message']] };
  return { copy: null, routes: [], why: w?.kind === 'scratch' ? 'It worked in a scratch folder, so there is nothing to merge. The files are on your PC.' : 'Its folder isn’t a git repo, so there is nothing to commit.' };
}
const STAGES = { merge: ['Committing what is left…', 'Squashing into one commit…', 'Merging…'], pr: ['Committing…', 'Pushing the branch…', 'Opening the pull request…'], builder: ['Asking it to publish…'], commit: ['Asking it to commit…'] };
export function shipSheet(jobId, list = []) {
  const j = raw(jobId); if (!j) return;
  const { routes, why, copy } = shipRoutes(j);
  if (!routes.length) { toast(why || 'Nothing to ship'); return; }
  const m = marks(jobId);
  const kept = list.filter((f) => m.get(f.path)?.mark !== 'reverted');
  const rev = list.length - kept.length;
  const [ka, kd] = sum(kept);
  const summary = String(j.summary ?? '').replace(/\*\*|`/g, '');
  const bullets = summary.split('\n').map((x) => x.replace(/^\s*[-*\d.]+\s*/, '').trim()).filter((x) => x && x.length < 160).slice(0, 6);
  const st = { how: routes[0][0] };
  openSheet({
    title: 'Ship the changes', sub: `${plural(kept.length, 'file')} · <span class="diffstat num">${stat(ka, kd)}</span>${rev ? ` · ${rev} put back` : ''}`, cls: 'wr-ship-sheet',
    body: (b) => {
      b.innerHTML = `<div class="pad">
        <p class="wr-lbl">Commit message</p>
        <div class="wr-msg"><textarea class="wr-msg-t" rows="2" aria-label="Commit title">${esc(j.title ?? '')}</textarea><textarea class="wr-msg-b" rows="${Math.max(3, bullets.length)}" aria-label="Commit body">${esc(bullets.map((x) => `- ${x}`).join('\n'))}</textarea></div>
        <p class="wr-ai">${I.sparkle}<span>From the job’s own summary. Edit it as you like.</span></p>
        <p class="wr-lbl">How it leaves</p>
        <div class="group wr-routes" role="radiogroup">${routes.map(([k, ic, t, sub]) => `<button class="row ic wr-route${k === st.how ? ' on' : ''}" role="radio" aria-checked="${k === st.how}" data-act="lvs-how" data-k="${k}"><span class="tile">${ic}</span><span class="rbody"><span class="rtitle">${esc(t)}</span><span class="rmeta"><span class="ell">${esc(sub)}</span></span></span><span class="o-r" aria-hidden="true"></span></button>`).join('')}</div>
        <button class="btn primary block wr-go" style="--c:var(--jobs-fill)" data-act="lvs-go" data-id="${esc(jobId)}">${goLabel(st.how, copy)}</button>
        <p class="foot wr-go-n">${rev ? `The ${plural(rev, 'file')} you put back stay${rev === 1 ? 's' : ''} as before the job.` : st.how === 'builder' ? 'The Builder waits until no job is busy.' : 'Every file goes as the job left it.'}</p>
        ${copy ? `<button class="btn block wr-undo lvs-discard" data-act="lvs-discard" data-id="${esc(jobId)}">${I.trash}Discard the copy</button>` : ''}
      </div>`;
      b._st = st; b._copy = copy;
    },
  });
}
const goLabel = (k, copy) => ({ merge: `Merge into ${copy?.base ?? 'main'}`, pr: 'Open the pull request', builder: 'Hand to the Builder', commit: 'Ask it to commit' }[k]);
on('lvs-how', (el) => {
  const b = el.closest('.sheet-body'); b._st.how = el.dataset.k; haptic(5);
  $$('.wr-route', b).forEach((r) => { const onn = r === el; r.classList.toggle('on', onn); r.setAttribute('aria-checked', String(onn)); });
  $('.wr-go', b).textContent = goLabel(el.dataset.k, b._copy);
});
on('lvs-go', async (el) => {
  const b = el.closest('.sheet-body'); if (el.dataset.busy) return;
  const how = b._st.how; const jobId = el.dataset.id; const copy = b._copy;
  const title = $('.wr-msg-t', b).value.trim() || raw(jobId)?.title || 'Agent work';
  const bodyText = $('.wr-msg-b', b).value.trim();
  const steps = STAGES[how] ?? ['Working…'];
  el.dataset.busy = '1'; el.disabled = true; haptic(10);
  let i = 0;
  const words = () => { el.innerHTML = `<span class="spin" style="--c:var(--on-color)"></span>${esc(steps[Math.min(i, steps.length - 1)])}`; };
  words();
  const tick = setInterval(() => { i++; words(); }, 900);
  try {
    let msg = '';
    if (how === 'merge') { const r = await E.worktree.merge(copy.worktreeId, [title, bodyText].filter(Boolean).join('\n\n')); msg = `Merged into ${copy.base ?? 'main'} as ${r.commit}. The copy is deleted.${r.note ? ` ${r.note}` : ''}`; }
    else if (how === 'pr') { const r = await E.worktree.pr(copy.worktreeId, title, bodyText); msg = r.url ? `Pull request opened: ${r.url}` : 'Pushed the branch.'; }
    else if (how === 'builder') { const r = await act.prompt(jobId, `Ship this: call publish_changes with a short summary of what changed.${title ? `\n\nUse this as the commit message:\n${title}${bodyText ? `\n\n${bodyText}` : ''}` : ''}`); if (!r) throw new Error('Not sent'); msg = 'Asked it to hand the work to its Builder. The board shows when it is live'; }
    else if (how === 'commit') { const r = await act.prompt(jobId, `Commit your changes now with this message, then stop:\n\n${title}${bodyText ? `\n\n${bodyText}` : ''}`); if (!r) throw new Error('Not sent'); msg = 'Asked it to commit'; }
    clearInterval(tick);
    closeSheet(el.closest('.sheet')); haptic('success');
    await E.loadCode(true);
    act.get(jobId).then((r) => r.job && E.putJob(r.job)).catch(() => {});
    $$('#stack .lvc-page').forEach((pg) => { if (pg.dataset.job === jobId && (how === 'merge' || how === 'pr')) pop(); });
    toast(msg);
  } catch (e) {
    clearInterval(tick);
    delete el.dataset.busy; el.disabled = false; el.textContent = goLabel(how, copy);
    toast(err(e));
  }
});
on('lvs-discard', async (el) => {
  const j = raw(el.dataset.id); const w = j?.workspace; if (!w?.worktreeId) return;
  closeSheet(el.closest('.sheet'));
  await discardCopy(w.worktreeId, w.files);
});
async function discardCopy(wId, n = null) {
  if (!(await E.confirm({ title: 'Discard the copy?', body: `It deletes the branch and its folder${n ? `, with ${plural(n, 'changed file')}` : ''}. Jobs and terminals in it stop. The chats stay.`, ok: 'Discard', cancel: 'Keep it', danger: true }))) return false;
  try { const r = await E.worktree.discard(wId); haptic('success'); await E.loadCode(true); toast(`Copy deleted.${r.note ? ` ${r.note}` : ''}`); return true; } catch (e) { toast(err(e)); return false; }
}

// ── a job's own copy (a git worktree): what changed in it, merge back, PR, a terminal there, discard ──
export async function openCopy(wId, jobId = null) {
  await E.loadCode();
  let w = E.code.worktrees.find((x) => x.id === wId);
  if (!w) { await E.loadCode(true); w = E.code.worktrees.find((x) => x.id === wId); }   // made since the last read
  if (!w) { toast('That copy is closed'); return; }
  const j = jobId ? raw(jobId) : E.storeNow()?.W?.jobs?.find((x) => x.workspace?.worktreeId === wId) ?? null;
  const [a, d] = sum(w.files ?? []);
  const p = w.project ? project(w.project) : null;
  const rows = [
    j ? ['lvw-changes', WI.fileDiff, 'See what changed', `${plural(w.files?.length ?? 0, 'file')} · ${(w.files?.length ? `+${a} −${d}` : 'nothing yet')}`] : null,
    ['lvw-merge', WI.merge, `Merge into ${w.base ?? 'main'}`, 'As one commit, then the copy is deleted'],
    ['lvw-pr', WI.pr, 'Open a pull request', `${String(w.branch).replace(/^aos\//, '')} into ${w.base ?? 'main'} on GitHub`],
    ['lvw-term', I.term, 'Open a terminal in this copy', 'A PowerShell in its folder'],
    ['lvw-discard', I.trash, 'Discard the copy', 'Deletes the branch and its folder. The chat stays'],
  ].filter(Boolean);
  openSheet({
    title: String(w.branch).replace(/^aos\//, ''), sub: `A separate copy of ${esc(p?.name ?? w.repo?.split(/[\\/]/).pop() ?? 'the repo')}${w.label ? ` · ${esc(w.label)}` : ''}`, cls: 'wr-copy-sheet',
    body: `<div class="wr-copy-h"><span class="mono">${esc(w.base ?? 'HEAD')}</span><span class="wr-copy-l" aria-hidden="true"></span><span class="mono">${esc(String(w.branch).replace(/^aos\//, ''))}</span><span class="foot num">${w.commits ? `${plural(w.commits, 'commit')} · ` : ''}${plural(w.files?.length ?? 0, 'file')} changed${w.behind ? ` · ${w.base} moved ${w.behind} on` : ''}</span></div>
      <div class="group">${rows.map(([k, ic, t, m]) => `<button class="row ic${k === 'lvw-discard' ? ' wr-danger' : ''}" data-act="${k}" data-w="${esc(wId)}" data-job="${esc(j?.id ?? '')}"><span class="tile">${ic}</span><span class="rbody"><span class="rtitle">${esc(t)}</span><span class="rmeta"><span class="ell">${esc(m)}</span></span></span>${k === 'lvw-discard' ? '' : I.chevR}</button>`).join('')}</div>`,
  });
}
const wOf = (el) => E.code.worktrees.find((x) => x.id === el.dataset.w);
on('lvw-changes', (el) => { closeSheet(); setTimeout(() => openLiveChanges(el.dataset.job, 0), 240); });
on('lvw-merge', async (el) => {
  const w = wOf(el); if (!w) return; closeSheet();
  if (!(await E.confirm({ title: `Merge into ${w.base ?? 'main'}?`, body: `${w.title}. It commits what is left in the copy, squashes it onto ${w.base ?? 'the base branch'} as one commit, and deletes the copy.`, ok: 'Merge', cancel: 'Not now' }))) return;
  try { const r = await E.worktree.merge(w.id, w.title); haptic('success'); await E.loadCode(true); toast(`Merged as ${r.commit}.${r.note ? ` ${r.note}` : ''}`); } catch (e) { toast(err(e)); }
});
on('lvw-pr', async (el) => {
  const w = wOf(el); if (!w) return; closeSheet();
  try { toast('Pushing and opening the pull request…'); const r = await E.worktree.pr(w.id, w.title, ''); haptic('success'); toast(r.url ? `Pull request opened: ${r.url}` : 'Pushed the branch'); } catch (e) { toast(err(e)); }
});
on('lvw-term', async (el) => {
  const w = wOf(el); if (!w) return; closeSheet();
  try { const r = await E.term.create({ kind: 'shell', cwd: w.cwd, project: w.project ?? undefined, title: `PowerShell · ${String(w.branch).replace(/^aos\//, '')}` }); await E.loadCode(true); api.openTerminal(w.project, r.session.id); } catch (e) { toast(err(e)); }
});
on('lvw-discard', async (el) => { const w = wOf(el); if (!w) return; closeSheet(); await discardCopy(w.id, w.files?.length); });

// ── a compare: two or three agents did the same task, each in its own copy. Look at each, keep one ──
export async function openCompare(group) {
  await E.loadCode(true);
  const runs = () => E.code.worktrees.filter((w) => w.group === group && w.state === 'open');
  if (!runs().length) { toast('This compare is finished'); return; }
  const C = { sel: runs()[0].id, data: null, done: false };
  push({
    title: 'Compare', back: backLabel(), cls: 'lvx-page',
    render(sc, pg) {
      pg.classList.add('jpage');
      const draw = () => {
        const rs = runs();
        if (!rs.length) { sc.innerHTML = '<div class="phead"><h1 class="lt">Compare</h1><p class="sub">This compare is finished.</p></div>'; return; }
        if (!rs.some((x) => x.id === C.sel)) C.sel = rs[0].id;
        const jobsIn = (w) => (E.storeNow()?.W?.jobs ?? []).filter((x) => x.cwd && String(x.cwd).toLowerCase().startsWith(String(w.path).toLowerCase()));
        sc.innerHTML = `<div class="phead"><p class="kicker">Compare</p><h1 class="lt">${esc(rs[0].title)}</h1><p class="sub">Each agent worked in its own copy. Look at each result and keep one; the others are deleted.</p></div>
          <div class="lvx-runs" role="tablist" aria-label="Copies" data-scroll-x>${rs.map((w) => { const j = jobsIn(w)[0]; const [a, d] = sum(w.files ?? []); return `<button class="lvx-run surface${w.id === C.sel ? ' on' : ''}" role="tab" aria-selected="${w.id === C.sel}" data-lvx="${esc(w.id)}">${j ? markFor(j, 22) : ''}<b>${esc(w.label ?? String(w.branch).replace(/^aos\//, ''))}</b><span class="cap">${esc(j ? ({ running: 'Working', needs_input: 'Needs you', idle: 'Replied', stopped: 'Stopped', failed: 'Failed', done: 'Done' }[j.status] ?? j.status) : 'No session')}</span><span class="num">${plural(w.files?.length ?? 0, 'file')} <span class="diffstat">${stat(a, d)}</span></span></button>`; }).join('')}</div>
          <div class="lvx-body">${C.data ? `<div class="group wr-files">${(C.data.files ?? []).map((f) => `<div class="row wr-file"><span class="fk fk-${FK[f.status] ?? 'M'}">${FK[f.status] ?? 'M'}</span><span class="rbody"><span class="rtitle mono">${esc(nameOf(f.path))}</span><span class="rmeta mono jf-path">${esc(dirOf(f.path))}</span></span><span class="jf-n num">${stat(f.add, f.del)}</span></div>`).join('') || '<div class="row"><span class="rbody"><span class="rmeta">Nothing changed in this copy yet.</span></span></div>'}</div>` : '<div class="lvc-wait"><span class="spin" style="--c:var(--jobs)"></span></div>'}</div>
          <div class="pad wr-acts"><button class="btn primary block" style="--c:var(--jobs-fill)" data-act="lvx-keep" data-w="${esc(C.sel)}">${I.check}Keep this one</button><p class="foot">It merges into ${esc(rs[0].base ?? 'the base branch')} as one commit; ${rs.length === 2 ? 'the other copy is deleted' : `the other ${rs.length - 1} copies are deleted`}.</p></div>`;
      };
      const load = async () => { C.data = null; draw(); try { C.data = await E.worktree.diff(C.sel); } catch (e) { C.data = { files: [], error: err(e) }; } draw(); };
      sc.addEventListener('click', (e) => { const r = e.target.closest('[data-lvx]'); if (r && r.dataset.lvx !== C.sel) { C.sel = r.dataset.lvx; haptic(5); load(); } });
      pg._draw = draw;
      load();
    },
  });
}
on('lvx-keep', async (el) => {
  const w = E.code.worktrees.find((x) => x.id === el.dataset.w); if (!w) return;
  if (!(await E.confirm({ title: `Keep ${w.label ?? 'this copy'}?`, body: `It merges into ${w.base ?? 'the base branch'} as one commit and deletes the other copies in this compare. Their chats stay.`, ok: 'Keep this one', cancel: 'Not yet' }))) return;
  try { const r = await E.worktree.pick(w.id, w.title); haptic('success'); await E.loadCode(true); pop(); toast(`Kept ${w.label ?? w.branch}: ${r.commit}. ${plural(r.dropped?.length ?? 0, 'other copy', 'other copies')} deleted.`); } catch (e) { toast(err(e)); }
});
provide('openCopy', (id, jobId) => openCopy(id, jobId));
provide('openCompare', (g) => openCompare(g));
export { marks as reviewMarks, reviewOf };

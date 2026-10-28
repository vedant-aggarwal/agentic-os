// Work · a real job's thread: what Claude Code or Codex is doing on the PC right now, streamed over SSE with replay
// (GET /jobs/:id, then /jobs/:id/stream?after=<seq>, reconnecting), drawn the T3 Code way in the approved layout.
// Each turn is your message, the work it did folded into one row ("Worked for 2m 41s · Edited 3 files, ran 2
// commands"), its answer, and its checkpoint (what that turn changed, one tap from review). What waits on you sits at
// the end as a plain question: an OK for a command (Allow once · Always · Deny, or tell it what to do instead), a form,
// a plan to approve. The floating capsule says where the job stands; the model pill opens what shapes the next turn.
// Ported from the shipping app's work/job.js (its event model, rewind, fork, queue, steer, forms), restyled.
import { $, $$, esc, push, pop, openSheet, closeSheet, toast, on, onHold, peek, closePeek, seg, ring, haptic, wireSegs, pulse, setRing } from './core.js';
import { I } from './icons.js';
import { project, TASKS } from './data.js';
import { api } from './bus.js';
import * as E from './work-engine.js';
import { keepThread, readThread } from '../work/thread-cache.js';
import { WI, agentName, taskOf, goalOf, backLabel, sinceIso, hhmmOf, markFor, setMark, shipChip, stat, plural, startClock } from './work-ui.js';

const { act, raw, err } = E;
const STEER_KEY = 'agentos-app:work-steer';
export const steerOn = () => { try { return (localStorage.getItem(STEER_KEY) ?? '1') === '1'; } catch { return true; } };
export const setSteer = (on) => { try { localStorage.setItem(STEER_KEY, on ? '1' : '0'); } catch {} };
const LIVE = ['starting', 'running', 'needs_input', 'idle'];
const BUSY = ['starting', 'running', 'needs_input'];
const isLive = (j) => !!j && LIVE.includes(j.status);
const isBusy = (j) => !!j && BUSY.includes(j.status);
const engineName = (j) => (j?.engine === 'codex' ? 'Codex' : j?.role === 'builder' ? 'Builder' : 'Claude');

// ── markdown, small: paragraphs, lists, code, bold, links ──
const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
export function md(text) {
  const out = [];
  String(text ?? '').split(/```[^\n]*\n?/).forEach((chunk, i) => {
    if (i % 2) { out.push(`<pre class="md-pre"><code>${esc(chunk.replace(/\n$/, ''))}</code></pre>`); return; }
    for (const block of chunk.split(/\n{2,}/)) {
      const lines = block.split('\n').filter((l) => l.trim());
      if (!lines.length) continue;
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
        const ol = /^\s*\d+\./.test(lines[0]);
        out.push(`<${ol ? 'ol' : 'ul'}>${lines.map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`);
      } else if (/^#{1,4}\s/.test(lines[0]) && lines.length === 1) out.push(`<p class="md-h">${inline(lines[0].replace(/^#+\s*/, ''))}</p>`);
      else out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
    }
  });
  return out.join('');
}
const plainLine = (t, n = 200) => String(t ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim().slice(0, n);

// ── what a step reads as: a sentence, with its paths and commands as code ──
const TOOL_I = { read: I.read, edit: I.edit, delete: I.trash, move: I.edit, execute: I.term, search: I.search, fetch: I.globe, think: WI.thought, other: I.bolt };
const CODE = /(`[^`]+`|(?:[\w.-]*[\\/])+[\w.<>-]+|\b[\w-]+\.(?:css|js|mjs|cjs|ts|tsx|jsx|md|swift|html|json|db|py|ps1|sh|yml|yaml|toml|txt|plist)\b)/g;
/** The job's own folder, cut out of a step's title: a file inside it reads as notes.txt, the folder itself as ".". */
export function relPath(text, cwd) {
  let t = String(text ?? '');
  if (!cwd || !t) return t;
  const base = String(cwd).replace(/[\\/]+$/, '');
  if (base.length < 4) return t;
  for (const b of new Set([base, base.replace(/\\/g, '/'), base.replace(/\//g, '\\')])) {
    const low = b.toLowerCase();
    let i = t.toLowerCase().indexOf(low);
    while (i >= 0) {
      const next = t[i + b.length];
      let from;
      if (next === '\\' || next === '/') { t = t.slice(0, i) + t.slice(i + b.length + 1); from = i; }
      else if (next === undefined || /["'`\s)]/.test(next)) { t = `${t.slice(0, i)}.${t.slice(i + b.length)}`; from = i + 1; }
      else from = i + b.length;   // a longer name that starts the same (scratch-job2) stays whole
      i = t.toLowerCase().indexOf(low, from);
    }
  }
  return t;
}
export function toolText(kind, title) {
  const t = String(title ?? '');
  if (kind === 'execute' && /^(node|bun|bunx|git|npm|npx|pnpm|pwsh|powershell|python|py|curl|ls|cd|rg|grep|get-|set-|cargo|go|xcodebuild|gh)\b/i.test(t)) return `<span class="mono">${esc(t)}</span>`;
  return esc(t).replace(CODE, (m) => `<span class="mono">${m.replace(/`/g, '')}</span>`);
}
// a finished group says what it did, the two biggest kinds of work first (T3 Code's fold)
const KIND = { edit: ['Edited', 'a file', 'files'], execute: ['Ran', 'a command', 'commands'], read: ['Read', 'a file', 'files'], search: ['Searched', 'once', 'times'], fetch: ['Checked', 'a web page', 'web pages'], other: ['Used', 'a tool', 'tools'] };
const RANK = ['edit', 'execute', 'read', 'search', 'fetch', 'other'];
const kindOf = (k) => (k === 'delete' || k === 'move' ? 'edit' : KIND[k] ? k : 'other');
export function summarize(tools) {
  const n = {};
  for (const t of tools) { const k = kindOf(t.kind); n[k] = (n[k] ?? 0) + 1; }
  const kinds = RANK.filter((k) => n[k]);
  if (!kinds.length) return 'Thought it through';
  const say = (k, i) => { const [v, one, many] = KIND[k]; return `${i ? v.toLowerCase() : v} ${n[k] === 1 ? one : `${n[k]} ${many}`}`; };
  const named = kinds.slice(0, 2).map(say), rest = kinds.slice(2).reduce((s, k) => s + n[k], 0);
  return rest ? `${named.join(', ')} and ${rest} more` : named.join(' and ');
}
const fmtDur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`; return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };

// ── attachments in a sent message: the PC names them in a block; the phone shows thumbnails ──
const ATT_HEAD = 'Attached files (saved on the PC; read them):';
function splitAttached(text) {
  const t = String(text ?? '');
  const i = t.indexOf(ATT_HEAD);
  if (i < 0) return { text: t, files: [] };
  const lines = t.slice(i + ATT_HEAD.length).split(/\r?\n/);
  let n = 1;
  while (n < lines.length && /^- .+: /.test(lines[n])) n++;
  const files = lines.slice(1, n).map((l) => l.match(/^- (.+?): .*[\\/](a_[a-f0-9]{16})[\\/]/)).filter(Boolean).map((m) => ({ name: m[1], id: m[2], image: /\.(jpe?g|png|gif|webp|heic)$/i.test(m[1]) }));
  const body = `${t.slice(0, i).trimEnd()}\n\n${lines.slice(n).join('\n').trimStart()}`.trim();
  return { text: body === 'See the attached files.' ? '' : body, files };
}
const thumbs = new Map();
async function thumbUrl(id) {
  if (!thumbs.has(id)) thumbs.set(id, (await import('./svc/api.js')).rawFetch(`/jobs/attachments/${id}`).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null));
  return thumbs.get(id);
}
const sentFiles = (files) => (files.length ? `<div class="lv-att">${files.map((f) => (f.image ? `<img class="lv-thumb" data-att-src="${esc(f.id)}" alt="${esc(f.name)}" />` : `<span class="lv-file">${WI.clip}<span class="ell">${esc(f.name)}</span></span>`)).join('')}</div>` : '');
function loadThumbs(root) {
  for (const img of $$('img[data-att-src]:not([src])', root)) {
    img.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAAAAACw=');
    thumbUrl(img.dataset.attSrc).then((u) => { if (u) img.src = u; });
  }
}
// the first message of a job is the prompt the PC built (project, folder, tasks, rules): show his own words
const BUILT = /^(Project: |Working folder: )/;
function ownWords(S, ev) {
  if (ev.turn !== 1 || !BUILT.test(ev.text ?? '')) return null;
  const j = S.job ?? {};
  const tasks = (j.taskIds ?? []).map(taskOf).filter(Boolean);
  const said = j.context && j.context !== 'Builder' ? j.context : tasks.length ? tasks.map((t) => t.title).join('\n') : j.title;
  return said || null;
}

// ── the page ──────────────────────────────────────────────────────────
const pages = new Set();
const OPENS = new Map();   // job id → { groups: Map<turn, open>, rows: Set<seq> }: what he opened stays open
const opensOf = (id) => OPENS.get(id) ?? OPENS.set(id, { groups: new Map(), rows: new Set() }).get(id);
const tpl = document.createElement('template');

/** Open a job's thread. Returns the page. */
export function openLive(id) {
  const top = $('#stack')?.lastElementChild;
  if (top?.dataset.job === id && top.classList.contains('lv-page')) return top;
  const S = { id, job: raw(id), events: new Map(), nodes: new Map(), sections: new Map(), userSeqs: [], byTurn: new Map(), lastSeq: -1, forms: new Map(), alive: true, stream: null, groupLive: false, loaded: false };
  const page = push({
    back: backLabel(), title: 'Chat', cls: 'lv-page',
    titleHtml: `<span class="lv-tt">${esc(S.job?.title || 'Job')}</span><small class="lv-ts">${esc(subTitle(S.job))}</small>`,
    right: '<span class="lv-right"></span>',
    onPop: () => { S.alive = false; S.stream?.close(); pages.delete(S); },
    render(sc, pg) {
      pg.classList.add('jpage', 'chat-page', 'lv-ready');
      pg.dataset.job = id;
      S.page = pg; S.sc = sc;
      sc.innerHTML = '<div class="lv-hero"></div><div class="msgs lv-msgs" aria-live="polite"></div><div class="lv-tail"></div>';
      pg.insertAdjacentHTML('beforeend', composerHTML(S));
      wireComposer(S);
      // which groups and rows he opened stays as he left it (toggle doesn't bubble: listen in capture)
      $('.lv-msgs', sc).addEventListener('toggle', (e) => {
        const d = e.target; const o = opensOf(id);
        if (d.classList?.contains('work') && d.dataset.wg) { if (d._auto === d.open) { d._auto = undefined; return; } o.groups.set(Number(d.dataset.wg), d.open); }
        else { const seq = Number(d.closest?.('[data-seq]')?.dataset.seq); if (seq) { if (d.open) o.rows.add(seq); else o.rows.delete(seq); } }
      }, true);
      onHold(sc, '.lv-msgs .msg', (el) => holdMessage(S, Number(el.closest('[data-seq]')?.dataset.seq)));
      onHold(sc, '.ckpt[data-turn]', (el) => holdCheckpoint(S, Number(el.dataset.turn)));
    },
  });
  pages.add(S);
  watchStack();
  hero(S);
  load(S);
  startClock();
  return page;
}
function subTitle(j) { return j ? [engineName(j), j.model ? E.modelName(j.model) : null].filter(Boolean).join(' · ') : ''; }

function paint(S, events, job) {
  $('.lv-msgs', S.sc).innerHTML = '';
  Object.assign(S, { events: new Map(), nodes: new Map(), sections: new Map(), userSeqs: [], byTurn: new Map(), lastSeq: -1 });
  for (const ev of events ?? []) { S.events.set(ev.seq, ev); S.lastSeq = Math.max(S.lastSeq, ev.seq); }
  reindex(S);
  S.job = { ...(S.job ?? {}), ...job };
  S.loaded = true;
  for (const ev of S.events.values()) render(S, ev);
  setJob(S, job, { first: true });
  toBottom(S, true);
}
async function load(S) {
  try {
    const r = await act.get(S.id);
    if (!S.alive) return;
    paint(S, r.events, r.job);
    if (S.cachedAt) { S.cachedAt = null; $('.lv-cached', S.sc)?.remove(); }
    keepThread(S.job, S.events.values());
  } catch (e) {
    // the PC is away: what this phone kept of the thread, said as such
    const c = !S.loaded && e.status !== 404 ? await readThread(S.id) : null;
    if (!S.alive) return;
    if (c?.events?.length) {
      paint(S, c.events, { ...c.job, ...(S.job ?? {}) });
      S.cachedAt = c.at;
      $('.lv-msgs', S.sc).insertAdjacentHTML('beforebegin', `<p class="lv-cached" role="status">${I.cloud ?? ''}<span><b>Offline:</b> what this phone kept at ${esc(hhmmOf(new Date(c.at).toISOString()))}. It catches up when your PC answers.</span></p>`);
    } else if (!S.job) $('.lv-hero', S.sc).innerHTML = `<p class="lv-empty">${esc(e.status === 404 ? 'This job doesn’t exist on your PC.' : 'Your PC isn’t reachable right now. The job keeps working there.')}</p>`;
    else hero(S);
  }
  if (!S.stream) follow(S);
}
// an event that can still change in place (the server re-sends it by its seq): a running step, an open ask
const mayChange = (e) => (e.type === 'tool' && ['pending', 'in_progress'].includes(e.tool?.status ?? 'pending')) || (e.type === 'permission' && !e.permission?.decided);
// SSE: `job` (the job record) and `ev` (one event, new or grown). Each reconnect replays from the last seq, or from the
// earliest step that was still running, so one that finished while the phone was away is not missed.
async function follow(S) {
  const { stream } = await import('./svc/live.js');
  if (!S.alive || S.stream) return;
  S.stream = stream(`/jobs/${S.id}/stream`, {
    after: () => { let a = S.lastSeq >= 0 ? S.lastSeq : 0; for (const e of S.events.values()) if (e.seq < a && mayChange(e)) a = e.seq; return a; },
    onEvent: (type, d) => { if (!S.alive) return; if (type === 'job') setJob(S, d); else if (type === 'ev') put(S, d); },
    onState: (st) => { S.conn = st; capsuleDraw(S); if (st === 'open' && S.cachedAt) load(S); },
  });
}
// a page can leave without a pop (a tab switch empties the stack): its stream ends with it
const stackWatch = new MutationObserver(() => { for (const S of [...pages]) if (S.page && !S.page.isConnected) { S.alive = false; S.stream?.close(); pages.delete(S); } });
const watchStack = () => { const st = document.getElementById('stack'); if (st && !st._lvWatch) { st._lvWatch = true; stackWatch.observe(st, { childList: true }); } };
// back from the lock screen (a notification answered, the phone asleep): reconnect at once
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') for (const S of pages) S.stream?.reconnect(); });

// ── the job record changed ──
function setJob(S, j, { first = false } = {}) {
  if (!j) return;
  const before = S.job?.status;
  const atEnd = nearBottom(S);
  S.job = { ...(S.job ?? {}), ...j };
  E.putJob(S.job);
  hero(S);
  // open asks depend on job.pending; the group heads on the status; a step that waits on an OK reads "Waiting"
  const turned = before !== S.job.status;
  for (const ev of S.events.values()) if (ev.type === 'permission' || (turned && ev.type === 'tool' && (ev.tool?.status ?? 'pending') === 'pending')) render(S, ev);
  layoutAll(S);
  capsuleDraw(S);
  syncComposer(S);
  if (atEnd) toBottom(S);
  if (S.loaded && !S.cachedAt) keepThread(S.job, S.events.values());
  if (!first && before && before !== S.job.status) {
    if (S.job.status === 'needs_input') haptic('warning');
    else if (S.job.status === 'idle' && BUSY.includes(before)) haptic('success');
    else if (S.job.status === 'failed') haptic('error');
  }
}

// ── events ──
function insertSorted(arr, v) { let i = arr.length; while (i > 0 && arr[i - 1] > v) i--; if (arr[i - 1] !== v) arr.splice(i, 0, v); }
function keyOf(S, seq) { let k = 0; for (const u of S.userSeqs) { if (u <= seq) k = u; else break; } return k; }
const isTurnStart = (e) => e.type === 'user' && !e.steer;
function reindex(S) {
  S.userSeqs = [...S.events.values()].filter(isTurnStart).map((e) => e.seq).sort((a, b) => a - b);
  S.byTurn = new Map();
  for (const seq of [...S.events.keys()].sort((a, b) => a - b)) { const k = keyOf(S, seq); (S.byTurn.get(k) ?? S.byTurn.set(k, []).get(k)).push(seq); }
}
function ingest(S, ev) {
  const isNew = !S.events.has(ev.seq);
  S.events.set(ev.seq, ev);
  render(S, ev);
  if (!isNew) return keyOf(S, ev.seq);
  const late = ev.seq < S.lastSeq;
  S.lastSeq = Math.max(S.lastSeq, ev.seq);
  if (isTurnStart(ev) && late) { reindex(S); return null; }
  if (isTurnStart(ev)) insertSorted(S.userSeqs, ev.seq);
  const k = keyOf(S, ev.seq);
  insertSorted(S.byTurn.get(k) ?? S.byTurn.set(k, []).get(k), ev.seq);
  return k;
}
function put(S, ev) {
  if (!$('.lv-msgs', S.sc)) return;
  const atEnd = nearBottom(S);
  const fresh = !S.events.has(ev.seq);
  const k = ingest(S, ev);
  if (k === null) layoutAll(S); else layoutTurn(S, k);
  // a new step or message rises in; the ones already on screen stay still
  if (fresh) { const n = S.nodes.get(ev.seq); (n?._li ?? n)?.classList.add('lv-new'); }
  if (ev.type === 'user' || ev.type === 'plan') tail(S);
  if (ev.type === 'changes') { capsuleDraw(S); hero(S); }
  if (atEnd) toBottom(S);
  if (!S.cachedAt) keepThread(S.job, S.events.values());
}

// One DOM node per event (kept in S.nodes); an update re-renders only its node, then its turn is laid out again.
function render(S, ev) {
  const html = eventHTML(S, ev);
  const old = S.nodes.get(ev.seq);
  if (old && old._html === html) return;
  // never pull an open form out from under the finger while he types in it
  if (old && ev.type === 'permission' && !ev.permission?.decided && old.contains(document.activeElement)) return;
  let n = null;
  if (html) {
    tpl.innerHTML = html;
    n = tpl.content.firstElementChild;
    n._html = html;
    const d = n.tagName === 'DETAILS' ? n : n.querySelector(':scope > details');
    const wasOpen = old ? (old.tagName === 'DETAILS' ? old.open : old.querySelector(':scope > details')?.open) : opensOf(S.id).rows.has(ev.seq);
    if (d && wasOpen) d.open = true;
    loadThumbs(n);
  }
  if (old) { if (n) old.replaceWith(n); else old.remove(); }
  if (n) S.nodes.set(ev.seq, n); else S.nodes.delete(ev.seq);
}

const PERM_WORD = { allow_once: 'Allow once', allow_always: 'Always', reject_once: 'Deny', reject_always: 'Never' };
const DECIDED_WORD = { allow_once: 'Allowed once', allow_always: 'Allowed for this session', reject_once: 'Denied', reject_always: 'Denied' };
function eventHTML(S, ev) {
  const at = `data-seq="${ev.seq}"`;
  const j = S.job;
  switch (ev.type) {
    case 'user': {
      if (ev.ping) return `<p class="m-note lv-ping" ${at}>${I.flame}<span>Kept the cache warm</span></p>`;
      const own = ownWords(S, ev);
      const u = splitAttached(own ?? ev.text);
      const time = hhmmOf(ev.at);
      return `<div class="msg me${ev.steer ? ' steer' : ''}" ${at}>${ev.steer ? '<span class="m-tag lv-steer">Steered into this turn</span>' : ''}${sentFiles(u.files)}${u.text ? `<div class="m-md">${md(u.text)}</div>` : ''}${own ? `<details class="lv-full"><summary>The full prompt</summary><pre class="lv-prompt">${esc(ev.text)}</pre></details>` : ''}${time ? `<span class="m-at num">${time}</span>` : ''}</div>`;
    }
    case 'assistant': return String(ev.text ?? '').trim() ? `<div class="msg ai" ${at}><div class="m-md">${md(ev.text)}</div></div>` : '';
    case 'thought': return `<li class="tool lv-tool lv-thought" ${at}><details><summary class="t-row"><span class="t-ic">${WI.thought}</span><span class="t-b"><span class="t-t">Thinking</span><span class="t-d">${esc(plainLine(ev.text, 90))}</span></span></summary><div class="lv-out m-md">${md(ev.text)}</div></details></li>`;
    case 'tool': {
      const t = ev.tool ?? {};
      const st = t.status ?? 'pending';
      const run = st === 'in_progress' || st === 'pending';
      const out = t.output ? String(t.output).slice(-4000) : '';
      const first = plainLine(out.split('\n').find((l) => l.trim()) ?? '', 90);
      const locs = (t.locations ?? []).map((l) => `<code>${esc(l)}</code>`).join('');
      const waits = st === 'pending' && j?.status === 'needs_input';
      return `<li class="tool lv-tool s-${esc(st)}${run ? ' run' : ''}" ${at}><details><summary class="t-row"><span class="t-ic">${TOOL_I[t.kind] ?? I.bolt}</span><span class="t-b"><span class="t-t">${toolText(t.kind, relPath(t.title || t.kind || 'Tool', j?.cwd))}</span>${first && !run ? `<span class="t-d">${esc(relPath(first, j?.cwd))}</span>` : ''}</span>${waits ? '<span class="t-s t-wait">Waiting</span>' : run ? `<span class="t-s">${st === 'pending' ? 'Starting' : 'Running'}</span>` : st === 'failed' ? '<span class="t-s t-fail">Failed</span>' : ''}</summary>${locs ? `<div class="lv-locs">${locs}</div>` : ''}${out ? `<pre class="lv-out mono">${esc(out)}</pre>` : '<p class="lv-none">No output.</p>'}</details></li>`;
    }
    case 'plan': return ev.text
      ? `<div class="plan surface lv-plantext" ${at}><div class="pc-h">${WI.plan}<b>The plan</b></div><div class="m-md">${md(ev.text)}</div></div>`
      : `<div class="lv-check" ${at}><ol class="pl">${(ev.plan ?? []).map((p) => `<li class="pl-r ${p.status === 'completed' ? 'done' : p.status === 'in_progress' ? 'on' : ''}"><span class="pl-c">${p.status === 'completed' ? I.check : ''}</span><span class="pl-t">${inline(p.content)}</span></li>`).join('')}</ol></div>`;
    case 'changes': {
      const fs = ev.changes ?? [];
      if (!fs.length) return '';
      const a = fs.reduce((s, f) => s + (f.add ?? 0), 0), d = fs.reduce((s, f) => s + (f.del ?? 0), 0);
      const tt = hhmmOf(ev.at);
      return `<button class="ckpt" data-act="lv-diff" data-id="${esc(S.id)}" data-turn="${ev.turn ?? 0}" ${at}><span class="tile">${WI.fileDiff}</span>
        <span class="rbody"><b>${plural(fs.length, 'file')} changed</b><span class="ck-m"><span class="num">${stat(a, d)}</span><span>Checkpoint ${ev.turn ?? ''}${tt ? ` · ${tt}` : ''}</span></span><span class="ck-names mono">${esc(fs.slice(0, 3).map((f) => f.path.split('/').pop()).join(', '))}${fs.length > 3 ? ` +${fs.length - 3}` : ''}</span></span><span class="btn sm">Review</span></button>`;
    }
    case 'permission': {
      const p = ev.permission ?? {};
      const open = !p.decided && j?.pending?.requestId === p.requestId;
      if (p.html) return htmlFormCard(S, ev, p, open);
      if (Array.isArray(p.form) && p.form.length) return formHTML(S, ev, p, !p.decided);
      const chosen = p.options?.find((o) => o.optionId === p.decided);
      const plan = p.kind === 'plan';
      if (!open) {
        if (!p.decided) return '';   // a request that went away with a restart
        return `<p class="m-note lv-decided" ${at}>${plan ? WI.plan : I.shield}<span><span class="ell">${inline(relPath(p.title ?? '', j?.cwd))}</span><b>${esc(chosen ? (plan ? chosen.name : DECIDED_WORD[chosen.kind] ?? chosen.name) : p.decided === 'cancelled' ? 'Cancelled' : 'Answered')}</b></span></p>`;
      }
      if (plan) return `<div class="perm-card surface lv-ask lv-planask" id="ask-${esc(S.id)}" ${at} role="group" aria-label="A plan to approve"><div class="pc-h">${WI.plan}<b>${agentName(j.engine)} wrote a plan</b><span class="cap">Waits for your OK</span></div>
        <p class="pc-why">Read it above. Approve it and ${agentName(j.engine)} starts building; keep planning to say what to change.</p>
        <div class="ask-b"><button class="btn sm primary" style="--c:var(--needs)" data-act="lv-plan" data-id="${esc(S.id)}" data-v="1">Approve and build</button><button class="btn sm" data-act="lv-plan" data-id="${esc(S.id)}" data-v="0">Keep planning</button></div></div>`;
      const cmd = permCommand(p, j?.cwd);
      const by = (k) => p.options?.find((o) => o.kind === k);
      const allow = by('allow_once') ?? by('allow_always'), always = allow?.kind === 'allow_once' ? by('allow_always') : null, deny = by('reject_once') ?? by('reject_always');
      const mode = j?.mode ?? 'auto';
      return `<div class="perm-card surface lv-ask" id="ask-${esc(S.id)}" ${at} role="group" aria-label="${esc(agentName(j.engine))} asks">
        <div class="pc-h">${I.shield}<b>${esc(agentName(j.engine))} ${p.kind === 'edit' ? 'wants to edit' : p.kind === 'command' ? 'wants to run a command' : 'asks for your OK'}</b>${j?.progress?.total ? `<span class="cap num">Step ${Math.min(j.progress.total, (j.progress.done ?? 0) + 1)} of ${j.progress.total}</span>` : ''}</div>
        <pre class="pc-cmd mono">${p.kind === 'command' ? '<span class="pc-ps">$</span> ' : ''}${esc(cmd)}</pre>
        <p class="pc-why">${esc(whereLine(j))}</p>
        <div class="ask-b">${allow ? `<button class="btn sm primary" style="--c:var(--needs)" data-act="lv-perm" data-id="${esc(S.id)}" data-req="${esc(p.requestId)}" data-opt="${esc(allow.optionId)}">${esc(PERM_WORD[allow.kind] ?? allow.name)}</button>` : ''}${always ? `<button class="btn sm" data-act="lv-perm" data-id="${esc(S.id)}" data-req="${esc(p.requestId)}" data-opt="${esc(always.optionId)}">Always</button>` : ''}${deny ? `<button class="btn sm" data-act="lv-perm" data-id="${esc(S.id)}" data-req="${esc(p.requestId)}" data-opt="${esc(deny.optionId)}">${esc(PERM_WORD[deny.kind] ?? deny.name)}</button>` : ''}</div>
        <div class="pc-more"><button class="pc-tell" data-act="lv-tell" data-id="${esc(S.id)}">${I.edit}Tell ${esc(agentName(j.engine))} what to do instead</button>
          <details class="pc-whyd"><summary>Why is it asking?</summary><p>${esc(E.MODES[mode]?.[0] ?? mode)}: ${esc((E.MODES[mode]?.[1] ?? '').toLowerCase())}.${mode !== 'auto' ? ' Full access would skip this, for this job only. Always allows it for the rest of this session.' : ''}</p></details></div>
      </div>`;
    }
    case 'status': {
      const text = ev.text || '';
      if (!text) return '';
      return `<p class="m-note lv-status" ${at}>${/^Cut off|failed|Stopped: its copy/i.test(text) ? WI.warn : /Model:|Effort:/.test(text) ? I.gear : /Rewound|rewound|put back/i.test(text) ? WI.revert : /Forked/.test(text) ? I.fork : I.clock}<span>${inline(text)}</span></p>`;
    }
    case 'error': return `<div class="lv-err surface" ${at}><p class="pc-h">${WI.warn}<b>It stopped with an error</b></p><div class="m-md">${md(ev.text)}</div></div>`;
    default: return ev.text ? `<div class="msg ai" ${at}><div class="m-md">${md(ev.text)}</div></div>` : '';
  }
}
/** "Run bun test (why)" → "bun test"; "Edit a.ts, b.ts" → the paths. */
function permCommand(p, cwd) {
  const t = relPath(String(p.title ?? ''), cwd);
  if (p.kind === 'command') return t.replace(/^Run\s+/, '');
  if (p.kind === 'edit') return t.replace(/^Edit\s+/, '');
  return t;
}
function whereLine(j) {
  const w = j?.workspace;
  if (w?.kind === 'worktree' && w.branch) return `In its own copy, on ${String(w.branch).replace(/^aos\//, '')}.`;
  if (w?.kind === 'scratch') return 'In its scratch folder.';
  const p = j?.project ? project(j.project) : null;
  return p ? `In ${p.name}'s folder, where your own files are.` : 'In the job’s folder.';
}

// ── questions: every question at once, option cards, an Other box each, one Send ──
function formState(S, p) { let f = S.forms.get(p.requestId); if (!f) { f = { sel: p.form.map(() => new Set()), other: p.form.map(() => '') }; S.forms.set(p.requestId, f); } return f; }
function formAnswers(p, f) {
  const out = {};
  p.form.forEach((q, i) => {
    const labels = [...f.sel[i]].sort((a, b) => a - b).map((k) => q.options?.[k]?.label).filter(Boolean);
    const other = f.other[i].trim();
    const a = q.multiSelect ? [...labels, other].filter(Boolean).join(', ') : other || labels[0] || '';
    if (a) out[q.question] = a;
  });
  return out;
}
const formReady = (p, f) => p.form.every((q) => formAnswers(p, f)[q.question]);
function formHTML(S, ev, p, open) {
  const at = `data-seq="${ev.seq}"`;
  const qHead = (q) => `${q.header ? `<span class="fq-h">${esc(q.header)}</span>` : ''}${inline(q.question)}`;
  if (!open) {
    const skipped = p.decided === 'skip' || p.decided === 'cancelled' || !p.answers;
    return `<div class="form-card surface lv-form done" ${at}><div class="pc-h">${I.chat}<b>${p.decided === 'skip' ? 'Skipped' : p.decided === 'cancelled' ? 'Cancelled' : 'Your answers'}</b></div>${p.form.map((q) => `<div class="lv-qa"><p class="lv-q">${qHead(q)}</p>${p.answers?.[q.question] ? `<p class="lv-a">${esc(p.answers[q.question])}</p>` : skipped ? '' : '<p class="lv-a none">No answer</p>'}</div>`).join('')}</div>`;
  }
  const f = formState(S, p);
  const name = (id, d) => p.options?.find((o) => o.optionId === id)?.name ?? d;
  return `<div class="form-card surface lv-form lv-ask" id="ask-${esc(S.id)}" ${at} role="group" aria-label="${esc(agentName(S.job?.engine))} asks">
    <div class="pc-h">${I.chat}<b>${esc(agentName(S.job?.engine))} asks</b><span class="cap">${plural(p.form.length, 'question')}</span></div>
    ${p.form.map((q, i) => `<div class="lv-fq${q.multiSelect ? ' multi' : ''}"><p class="fq">${qHead(q)}${q.multiSelect ? '<span class="cap lv-any">Pick any</span>' : ''}</p>
      <div class="opts" role="${q.multiSelect ? 'group' : 'radiogroup'}">${(q.options ?? []).map((o, k) => { const onn = f.sel[i].has(k); return `<button class="opt${onn ? ' on' : ''}" role="${q.multiSelect ? 'checkbox' : 'radio'}" aria-checked="${onn}" data-lvq="${i}:${k}"><span class="o-b"><span class="o-t">${esc(o.label)}</span>${o.description ? `<span class="o-d">${inline(o.description)}</span>` : ''}${o.preview ? `<pre class="lv-prev mono">${esc(o.preview)}</pre>` : ''}</span><span class="o-r${q.multiSelect ? ' sq' : ''}"></span></button>`; }).join('')}</div>
      <div class="field o-other"><input data-lvq-other="${i}" value="${esc(f.other[i])}" placeholder="Something else: type your own answer" aria-label="Your own answer" enterkeyhint="done" autocomplete="off" /></div></div>`).join('')}
    <div class="ask-b"><button class="btn sm primary" style="--c:var(--needs)" data-act="lv-form-send" data-id="${esc(S.id)}" data-req="${esc(p.requestId)}" ${formReady(p, f) ? '' : 'disabled'}>${esc(name('submit', 'Send answers'))}</button><button class="btn sm" data-act="lv-perm" data-id="${esc(S.id)}" data-req="${esc(p.requestId)}" data-opt="skip">${esc(name('skip', 'Skip'))}</button></div>
  </div>`;
}
function syncForm(card, p, f) {
  $$('[data-lvq]', card).forEach((b) => { const [i, k] = b.dataset.lvq.split(':').map(Number); const onn = f.sel[i].has(k); b.classList.toggle('on', onn); b.setAttribute('aria-checked', String(onn)); });
  $$('[data-lvq-other]', card).forEach((x) => { const i = Number(x.dataset.lvqOther); if (x.value !== f.other[i]) x.value = f.other[i]; });
  const send = $('[data-act="lv-form-send"]', card); if (send) send.disabled = !formReady(p, f);
}
function htmlFormCard(S, ev, p, open) {
  const at = `data-seq="${ev.seq}"`;
  if (p.decided) return `<div class="form-card surface lv-form done" ${at}><div class="pc-h">${I.chat}<b>${p.decided === 'submit' ? 'Your answers' : p.decided === 'skip' ? 'Skipped' : 'Cancelled'}</b><span class="cap ell">${esc(p.title)}</span></div>${Object.entries(p.answers ?? {}).map(([k, v]) => `<div class="lv-qa"><p class="lv-q">${esc(k)}</p><p class="lv-a">${esc(v)}</p></div>`).join('')}</div>`;
  if (!open) return '';
  return `<div class="form-card surface lv-form lv-ask" id="ask-${esc(S.id)}" ${at}><div class="pc-h">${I.chat}<b>A form for you</b></div><p class="fq">${inline(p.title ?? '')}</p>
    <div class="ask-b"><button class="btn sm primary" style="--c:var(--needs)" data-act="lv-html-form" data-id="${esc(S.id)}" data-seq="${ev.seq}">Open the form</button><button class="btn sm" data-act="lv-perm" data-id="${esc(S.id)}" data-req="${esc(p.requestId)}" data-opt="skip">Skip</button></div></div>`;
}

// ── turns: each is a <section class="turn">: your message, one folded work group, then what stays in view ──
function placeOf(e, answer) {
  switch (e.type) {
    case 'user': return e.steer ? 'group' : 'user';
    case 'assistant': return e.seq === answer ? 'out' : 'group';
    case 'tool': case 'thought': return 'group';
    case 'status': return /^(Files put back|Code rewound|Chat rewound|Rewound|Model:|Effort:|Forked|Cut off|Stopped|Cancelled|Switched|Archived)/.test(e.text ?? '') ? 'out' : 'group';
    case 'plan': return e.text ? 'out' : 'group';
    case 'permission': { const p = e.permission ?? {}; return !p.decided || p.form || p.html || p.kind === 'question' || p.kind === 'plan' ? 'out' : 'group'; }
    default: return 'out';
  }
}
function sectionFor(S, list, key) {
  let sec = S.sections.get(key);
  if (!sec) {
    sec = document.createElement('section');
    sec.className = 'turn';
    sec.dataset.turn = key;
    const open = opensOf(S.id).groups.get(key);
    const g = document.createElement('details');
    g.className = 'work';
    g.dataset.wg = key;
    g.innerHTML = '<summary></summary><ol class="tools"></ol>';
    if (open) g.open = true;
    sec._group = g;
    S.sections.set(key, sec);
  }
  if (!sec.isConnected) { const next = [...list.children].find((c) => Number(c.dataset.turn) > key); list.insertBefore(sec, next ?? null); }
  return sec;
}
function reconcile(parent, nodes) {
  let cur = parent.firstChild;
  for (const n of nodes) { if (n === cur) cur = cur.nextSibling; else parent.insertBefore(n, cur); }
  while (cur) { const next = cur.nextSibling; cur.remove(); cur = next; }
}
function groupHead(S, evs, items, running) {
  const tools = items.filter((e) => e.type === 'tool').map((e) => e.tool ?? {});
  const n = tools.length;
  if (running) {
    const needs = S.job?.status === 'needs_input';
    const last = items.at(-1);
    const t = tools.at(-1);
    const thinking = last?.type === 'thought' || (last?.type === 'assistant' && !t);
    const now = t?.title ? toolText(t.kind, t.title) : esc(S.job?.progress?.active || (thinking ? 'Thinking' : 'Starting'));
    const start = evs.find(isTurnStart)?.at ?? evs[0]?.at;
    const state = needs ? 'needs' : thinking ? 'thinking' : 'working';
    return { state, html: `<span class="w-mk" data-mark-job="${esc(S.id)}">${markFor(S.job, 22, { state })}</span><span class="w-h"><b>${needs ? 'Waiting for you' : `Working for ${sinceIso(start, { secs: true })}`}</b><span class="cap w-now">${needs ? esc(`${summarize(tools)} so far`) : now}</span></span>${n ? `<span class="w-n num">${n}</span>` : ''}${I.chevD}` };
  }
  const start = Date.parse(evs.find(isTurnStart)?.at ?? evs[0]?.at);
  const end = Math.max(...evs.filter((e) => !(e.type === 'status' && e.text)).map((e) => Date.parse(e.at)).filter(Number.isFinite));
  const dur = Number.isFinite(start) && Number.isFinite(end) && end > start ? fmtDur(end - start) : null;
  const failed = items.filter((e) => e.type === 'tool' && e.tool?.status === 'failed').length;
  return { state: 'done', html: `<span class="w-ic">${I.check}</span><span class="w-h"><b>${dur ? `Worked for ${dur}` : 'Worked'}</b><span class="cap">${esc(summarize(tools))}${failed ? ` · ${failed} failed` : ''}</span></span>${n ? `<span class="w-n num">${n}</span>` : ''}${I.chevD}` };
}
function layoutTurn(S, key) {
  const list = $('.lv-msgs', S.sc);
  if (!list) return;
  const evs = (S.byTurn.get(key) ?? []).map((s) => S.events.get(s)).filter(Boolean);
  const lastKey = S.userSeqs.at(-1) ?? 0;
  const running = key === lastKey && isBusy(S.job);
  const texts = evs.filter((e) => e.type === 'assistant' && String(e.text ?? '').trim());
  let answer = texts.at(-1)?.seq ?? -1;
  // while the turn runs, the newest text is the answer so far until a step follows it
  if (running && evs.some((e) => e.seq > answer && (e.type === 'tool' || e.type === 'thought'))) answer = -1;
  const sec = sectionFor(S, list, key);
  const userEv = key ? S.events.get(key) : null;
  sec.classList.toggle('ping', !!userEv?.ping);
  sec.classList.toggle('rewound', !!key && (S.job?.dropped ?? []).some(([a, b]) => key >= a && key <= b));
  const g = sec._group;
  const top = [], inside = [], items = [], out = [];
  for (const e of evs) {
    const n = S.nodes.get(e.seq);
    if (!n) continue;
    const where = placeOf(e, answer);
    if (where === 'user') top.push(n);
    else if (where === 'group') { inside.push(asStep(n, e)); items.push(e); } else out.push(n);
  }
  reconcile(sec, [...top, g, ...out]);
  reconcile(g.lastElementChild, inside);
  g.hidden = !inside.length;
  g.classList.toggle('going', running);
  // a running group shows its steps as they come, unless he folded it; a finished one folds
  const mine = opensOf(S.id).groups.get(key);
  if (mine == null) { const want = running && inside.length > 0; if (g.open !== want) { g._auto = want; g.open = want; } }
  const head = groupHead(S, evs, items, running);
  if (g.firstElementChild._html !== head.html) { g.firstElementChild.innerHTML = head.html; g.firstElementChild._html = head.html; }
  if (key === lastKey) { const shown = running && !!inside.length; if (shown !== S.groupLive) { S.groupLive = shown; tail(S); } }
}
// a step inside the group is a list item; status lines and texts become quiet rows there
function asStep(n, e) {
  if (n.tagName === 'LI') return n;
  if (!n._li) { n._li = document.createElement('li'); n._li.className = `lv-row lv-r-${e.type}`; }
  if (n.parentElement !== n._li) n._li.appendChild(n);
  return n._li;
}
function layoutAll(S) {
  const keys = [...S.byTurn.keys()].sort((a, b) => a - b);
  for (const [k, sec] of S.sections) if (!S.byTurn.has(k)) { sec.remove(); S.sections.delete(k); }
  for (const k of keys) layoutTurn(S, k);
  tail(S);
}
const nearBottom = (S) => { const sc = S.sc; return sc ? sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140 : true; };
const toBottom = (S, now = false) => { const sc = S.sc; if (!sc) return; requestAnimationFrame(() => { if (now || matchMedia('(prefers-reduced-motion: reduce)').matches) sc.scrollTop = sc.scrollHeight; else sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' }); }); };

// What closes the conversation: the live line before the first step, a failure, the Codex "approve the plan" button.
function tail(S) {
  const el = $('.lv-tail', S.sc);
  if (!el) return;
  const j = S.job;
  const evs = [...S.events.values()].sort((a, b) => a.seq - b.seq);
  const lastUser = evs.filter(isTurnStart).at(-1)?.seq ?? 0;
  const planReady = j?.plan && j.status === 'idle' && !j.pending && evs.some((e) => e.type === 'plan' && e.text && e.seq > lastUser);
  const html = !j ? '' : isBusy(j) && j.status !== 'needs_input'
    ? (S.groupLive && j.status !== 'starting' ? '' : `<p class="lv-live"><span class="w-mk" data-mark-job="${esc(S.id)}">${markFor(j, 22, { state: 'thinking' })}</span><span>${j.status === 'starting' ? 'Starting the session on your PC' : 'Thinking'}</span></p>`)
    : j.status === 'failed' && j.error ? `<div class="lv-err surface"><p class="pc-h">${WI.warn}<b>It stopped with an error</b></p><div class="m-md">${md(j.error)}</div><div class="ask-b"><button class="btn sm" data-act="lv-retry" data-id="${esc(S.id)}">Carry on</button></div></div>`
    : planReady ? `<div class="lv-runplan"><button class="btn primary block" style="--c:var(--jobs-fill)" data-act="lv-run-plan" data-id="${esc(S.id)}">${WI.plan}Approve the plan and start</button></div>`
    : j.status === 'done' && j.summary ? `<div class="lv-done surface"><p class="pc-h">${I.check}<b>Done</b>${j.finishedAt ? `<span class="cap">${esc(hhmmOf(j.finishedAt))}</span>` : ''}</p></div>` : '';
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}

// ── the hero: where it stands (its ring with the mark inside), its title, what it is tied to, what it has used ──
const kNum = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
function progOf(p) {
  if (!p) return null;
  const all = (p.stages ?? []).flatMap((s) => (s.steps ?? []).map((t) => ({ ...t, stage: s.name })));
  const total = p.total ?? all.length;
  if (!total) return null;
  const done = p.done ?? all.filter((s) => ['done', 'skipped'].includes(s.status)).length;
  const active = p.state === 'done' ? 'All done' : p.active ?? all.find((s) => s.status === 'active')?.title ?? all.find((s) => s.status === 'pending')?.title ?? '';
  return { done, total: Math.max(total, done, 1), active, stage: p.stage ?? all.find((s) => s.title === active)?.stage ?? '', state: p.state ?? null, stages: p.stages ?? [] };
}
const STATE_WORD = { starting: 'Starting', running: 'Working', needs_input: 'Needs you', idle: 'Replied · your turn', stopped: 'Stopped', failed: 'Failed', done: 'Done' };
function hero(S) {
  const j = S.job;
  const pg = S.page;
  if (!pg) return;
  const tt = $('.lv-tt', pg), ts = $('.lv-ts', pg);
  if (tt && j) { tt.textContent = j.title || 'Job'; ts.textContent = subTitle(j); }
  const right = $('.tb-right', pg);
  if (right && j) {
    const files = j.files ?? 0;
    const w = j.workspace;
    const a = w?.kind === 'worktree' ? w.add : null, d = w?.kind === 'worktree' ? w.del : null;
    const shown = a != null && (a || d) ? stat(a, d) : j.turns === 1 ? String(files) : '';
    const html = `${j.turns && (files || a || d) ? `<button class="gbtn chrome jdiff-b${shown ? '' : ' icon'}" data-act="lv-diff" data-id="${esc(S.id)}" data-turn="0" aria-label="Changes">${WI.fileDiff}${shown ? `<span class="num">${shown}</span>` : ''}</button>` : ''}<button class="gbtn chrome icon" data-act="lv-menu" data-id="${esc(S.id)}" aria-label="Job menu">${I.dots}</button>`;
    if (right._html !== html) { right.innerHTML = html; right._html = html; }
  }
  const box = $('.lv-hero', S.sc);
  if (!j) { box.innerHTML = '<p class="lv-empty">Loading the job…</p>'; return; }
  const pr = progOf(j.progress);
  const needs = j.status === 'needs_input';
  const running = j.status === 'running' || j.status === 'starting';
  const live = isLive(j) && j.status !== 'idle' || needs;
  const st = E.markState(j);
  const top = pr && (live || j.status === 'idle')
    ? `<div class="jh-top">${ring(Math.min(1, pr.done / pr.total), needs ? 'needs' : 'jobs', 76, 9, { cls: `jring${running ? ' running' : ''}`, inner: `<span class="wk-ring-m big" data-mark-job="${esc(S.id)}">${markFor(j, 34)}</span>`, label: `${pr.done} of ${pr.total} steps` })}
        <div class="jh-stat"><b class="met c-jobs"><span data-count="${pr.done}">${pr.done}</span><small>/${pr.total} steps</small></b><span class="jh-step">${esc(pr.active)}</span><span class="cap">${needs ? '<span class="amber">Needs you</span>' : ''}${needs && pr.stage ? ' · ' : ''}${esc(pr.stage)}</span></div></div>`
    : `<div class="jh-top"><span class="agent big wk-amt ${esc(j.engine)}" data-mark-job="${esc(S.id)}">${markFor(j, 30, { state: st })}</span><div class="jh-stat"><span class="jh-step${needs ? ' amber' : j.status === 'failed' ? ' c-fail' : ''}">${esc(j.role === 'builder' ? `Builder · ${STATE_WORD[j.status] ?? j.status}` : STATE_WORD[j.status] ?? j.status)}</span><span class="jmeta">${shipChip(j.ship?.state)}<span>${esc(E.clock.ago(j.updatedAt ?? j.createdAt) === 'now' ? 'just now' : `${E.clock.ago(j.updatedAt ?? j.createdAt)} ago`)}</span></span></div></div>`;
  const p = j.project ? project(j.project) : null;
  const w = j.workspace;
  const copy = w?.kind === 'worktree' && !['merged', 'removed'].includes(w.stage);
  const tasks = (j.taskIds ?? []).map(taskOf).filter(Boolean);
  const g = tasks[0]?.goal ? goalOf(tasks[0].goal) : null;
  const links = [
    p ? `<button class="jlink" data-act="project" data-id="${esc(p.slug)}" data-back="Chat"><i class="dot" style="--c:${p.color}"></i><span>${esc(p.name)}</span></button>` : '',
    copy ? `<button class="jlink mono" data-act="lv-copy" data-id="${esc(S.id)}">${I.branch}<span class="ell">${esc(String(w.branch ?? '').replace(/^aos\//, ''))}</span></button>`
      : w?.kind === 'scratch' ? `<span class="jlink is-static">${I.folder}<span>Scratch folder</span></span>` : j.cwd ? `<span class="jlink is-static" title="${esc(j.cwd)}">${I.folder}<span>${w?.kind === 'folder' && p ? 'Project folder' : esc(String(j.cwd).split(/[\\/]/).filter(Boolean).at(-1) ?? '')}</span></span>` : '',
    ...tasks.slice(0, 3).map((t) => `<button class="jlink" data-act="w-task" data-id="${esc(t.id)}">${I.check}<span class="ell">${tasks.length > 1 ? '' : 'From the task: '}${esc(t.title)}</span></button>`),
    g ? `<button class="jlink" data-act="w-goal" data-id="${esc(g.id)}">${I.target}<span class="ell">Moves: ${esc(g.title)}</span></button>` : '',
    j.ship?.builderJob ? `<button class="jlink" data-act="lv-open" data-id="${esc(j.ship.builderJob)}">${I.hammer}<span>Its Builder</span></button>` : '',
  ].filter(Boolean).join('');
  const u = j.usage;
  const started = S.events.size ? hhmmOf([...S.events.values()][0]?.at) : '';
  const cache = j.cache && j.cache.state !== 'none' && j.lane !== 'archived' ? (() => { const left = Math.round((Date.parse(j.cache.warmUntil) - Date.now()) / 60000); const kw = j.cache.keepWarmUntil && Date.parse(j.cache.keepWarmUntil) > Date.now(); return left > 0 ? `cache ${left}m${kw ? ' (kept warm)' : ''}` : 'cache cold'; })() : '';
  const use = [started ? `Started ${started}` : '', j.model ? E.modelName(j.model) : 'Default model', j.effort ? E.effortName(j.effort) : '', u && u.input + u.output ? `${kNum(u.input)} in · ${kNum(u.output)} out` : '', u?.contextPct != null ? `context ${u.contextPct}%` : '', cache].filter(Boolean).join(' · ');
  const html = `<div class="jhero lv-h">${top}<h1 class="t1">${j.role === 'builder' ? '<span class="lv-role">Builder</span> ' : ''}${esc(j.title || 'Job')}</h1>
    ${links ? `<div class="jlinks">${links}</div>` : ''}
    <p class="cap jh-use num">${esc(use)}</p>
    ${j.ship ? `<p class="lv-ship">${shipChip(j.ship.state)}${j.ship.note ? `<span>${esc(j.ship.note)}</span>` : ''}${j.ship.commit ? `<span class="mono">${esc(j.ship.commit)}</span>` : ''}</p>` : ''}
    ${w?.wanted && w.why && !copy ? `<p class="lv-why">${esc(w.why)}</p>` : ''}
    ${j.checkpointError && j.turns ? `<p class="lv-why">${esc(/checkpoint/i.test(j.checkpointError) ? j.checkpointError : `No file checkpoints: ${j.checkpointError}`)}</p>` : ''}</div>`;
  if (box._html !== html) {
    const first = !box._html;
    box.innerHTML = html; box._html = html;
    if (first) pulse(box); else $$('.rg[data-v]', box).forEach((r) => r.style.setProperty('--rp', r.dataset.v));
  }
}

// ── the composer: the status capsule and model pill float over a one-row field ──
function composerHTML(S) {
  const id = S.id;
  return `<div class="cmp-wrap lv-cmp" data-job="${esc(id)}"><div class="lv-queue" hidden></div><div class="cmp-cap-row"></div>
    <div class="composer chrome" data-att-host="job-${esc(id)}">
      <div class="lv-tray" data-att-tray="job-${esc(id)}" hidden></div>
      <div class="cmp-att lv-chips" hidden></div>
      <div class="cmp-row">
        <button class="cmp-plus" data-act="lv-attach" data-id="${esc(id)}" aria-label="Add to the message">${I.plus}</button>
        <div class="field cmp-f"><textarea class="cmp-in" id="lvin-${esc(id)}" rows="1" placeholder="Message the job" aria-label="Message" enterkeyhint="send"></textarea><button class="fbtn lv-mic" data-lv-mic="${esc(id)}" aria-label="Record a voice note">${I.mic}</button></div>
        <button class="cmp-send" data-act="lv-send" data-id="${esc(id)}" aria-label="Send">${I.up}</button>
      </div>
      <div class="cmp-rec lv-rec" hidden></div>
    </div></div>`;
}
const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`; };
let attachP = null, voiceP = null;
const attachMod = () => (attachP ??= import('../work/attach.js').catch(() => null));
const voiceMod = () => (voiceP ??= import('../work/recorder.js').catch(() => null));
function wireComposer(S) {
  const wrap = $('.cmp-wrap', S.page), ta = $('.cmp-in', S.page);
  const fit = () => S.sc.style.setProperty('--cmp-h', `${wrap.offsetHeight}px`);
  new ResizeObserver(fit).observe(wrap); fit();
  ta.addEventListener('input', () => { grow(ta); syncComposer(S); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !(globalThis.Capacitor?.isNativePlatform?.())) { e.preventDefault(); send(S); } });
  // hold Send: steer it in now, queue it after this turn, or interrupt and send now
  const b = $('.cmp-send', S.page);
  let t = 0, held = false;
  b.addEventListener('pointerdown', () => { held = false; clearTimeout(t); t = setTimeout(() => { if (ta.value.trim() && isBusy(S.job)) { held = true; haptic(14); sendMenu(S); } }, 460); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => clearTimeout(t));
  b.addEventListener('click', (e) => { if (held) { held = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  attachMod().then((A) => { if (!A) return; A.onChange(`job-${S.id}`, () => { trayDraw(S); syncComposer(S); }); A.changed(`job-${S.id}`); });
  // the mic: the shipping app's recorder (on the phone first, then the PC transcribes; the text lands in the field)
  const mic = $('.lv-mic', S.page);
  mic.addEventListener('click', async (e) => {
    e.preventDefault();
    const V = await voiceMod();
    if (!V) { toast('Voice notes aren’t available here'); return; }
    if (V.recording(ta)) { V.stop(); return; }
    const slot = $('.lv-rec', S.page);
    slot.hidden = false;
    V.start({ target: ta, slot, button: mic, source: 'composer', purpose: 'prompt', onState: (st) => { slot.hidden = st === 'idle'; mic.classList.toggle('on', st === 'recording' || st === 'starting'); syncComposer(S); } });
  });
  syncComposer(S);
  capsuleDraw(S);
}
function trayDraw(S) {
  // attach.js draws the tray; its thumbnails get the composer's look from jobs.css
  const tray = $('.lv-tray', S.page);
  if (tray) tray.classList.add('lv-tray-on');
}
function syncComposer(S) {
  const pg = S.page; if (!pg) return;
  const ta = $('.cmp-in', pg), b = $('.cmp-send', pg);
  if (!ta || !b) return;
  const j = S.job;
  const typed = !!ta.value.trim() || !!S.attached?.length || hasAttach(S);
  const running = j?.status === 'running' || j?.status === 'starting';
  const stop = running && !typed;
  b.classList.toggle('stop', stop);
  b.innerHTML = stop ? I.stop : I.up;
  b.setAttribute('aria-label', stop ? 'Stop this turn' : isBusy(j) ? (steerOn() ? 'Steer into this turn' : 'Queue after this turn') : 'Send');
  b.disabled = !stop && !typed;
  $('.composer', pg)?.classList.toggle('typing', !!ta.value.trim());
  const ph = !j ? 'Message the job' : j.status === 'needs_input' && j.pending && !j.pending.form && j.pending.kind !== 'plan' ? `Or tell ${engineName(j)} what to do`
    : j.status === 'needs_input' && j.pending?.kind === 'plan' ? 'Say what to change' : isBusy(j) ? 'Steer, or queue a message' : j.status === 'done' ? 'Reopen with a message' : `Message ${engineName(j)}`;
  if (ta.placeholder !== ph) ta.placeholder = ph;
  // messages waiting for the turn to end: tap one to steer it in, edit or remove it
  const q = j?.queue ?? [];
  const box = $('.lv-queue', pg);
  const html = q.map((m) => `<button class="lv-qi chrome" data-act="lv-queued" data-id="${esc(S.id)}" data-q="${esc(m.id)}">${I.clock}<span class="ell">${esc(plainLine(splitAttached(m.text).text || m.text, 120))}</span><span class="cap">Queued</span></button>`).join('');
  if (box._html !== html) { box.innerHTML = html; box._html = html; }
  box.hidden = !q.length;
  // the comments he left on the diff ride with the next message
  const chips = $('.lv-chips', pg);
  const cm = comments(S.id);
  const ch = cm.map((c, i) => `<span class="cmp-chip">${I.chat}<span class="ell">${esc(`${c.path.split('/').pop()}:${c.line} · ${c.text}`)}</span><button class="cmp-att-x" data-act="lv-uncomment" data-id="${esc(S.id)}" data-i="${i}" aria-label="Remove the comment">${I.x}</button></span>`).join('');
  if (chips._html !== ch) { chips.innerHTML = ch; chips._html = ch; }
  chips.hidden = !cm.length;
}
let attachState = null;
const hasAttach = (S) => { const A = attachState; return !!A?.has?.(`job-${S.id}`); };
attachMod().then((A) => { attachState = A; });

// the capsule: where the job stands in one line you can tap; the model pill beside it
function capsuleDraw(S) {
  const row = $('.cmp-cap-row', S.page);
  if (!row) return;
  const j = S.job;
  let cap = '';
  if (S.conn === 'retry' && isLive(j)) cap = `<span class="cmp-cap chrome is-static lv-reconn">${I.sync}<span>Reconnecting to your PC</span></span>`;
  else if (j && (j.status === 'running' || j.status === 'starting')) {
    const pr = progOf(j.progress);
    const lastUser = [...S.events.values()].filter(isTurnStart).at(-1);
    cap = pr
      ? `<button class="cmp-cap chrome" data-act="lv-plan-sheet" data-id="${esc(S.id)}" aria-label="Plan: ${pr.done} of ${pr.total} done">${ring(pr.done / pr.total, 'jobs', 20, 3, { cls: 'running' })}<b class="met c-jobs">${pr.done}<small>/${pr.total}</small></b><span class="ell">${esc(pr.active)}</span>${lastUser ? `<span class="cap">${sinceIso(lastUser.at)}</span>` : ''}</button>`
      : `<span class="cmp-cap chrome is-static"><span class="w-mk sm" data-mark-job="${esc(S.id)}">${markFor(j, 18)}</span><span>${j.status === 'starting' ? 'Starting' : 'Working'}</span>${lastUser ? `<span class="cap">${sinceIso(lastUser.at)}</span>` : ''}</span>`;
  } else if (j?.status === 'needs_input') {
    const what = j.pending?.kind === 'plan' ? 'Plan ready for your OK' : j.pending?.form || j.pending?.kind === 'question' ? 'Waiting for your answer' : 'Waiting for your OK';
    cap = `<button class="cmp-cap chrome is-needs" data-act="lv-goask" data-id="${esc(S.id)}"><i class="dot" style="--c:var(--needs)"></i><span>${what}</span>${I.chevD}</button>`;
  } else if (j && j.files > 0 && j.turns) {
    const marks = E.marksOf(S.id);
    const n = j.workspace?.kind === 'worktree' && j.workspace.files ? j.workspace.files : j.turns === 1 ? j.files : null;
    cap = `<button class="cmp-cap chrome" data-act="lv-diff" data-id="${esc(S.id)}" data-turn="0">${WI.checkC}<span>${marks.size ? `${plural(marks.size, 'file')} reviewed${n ? ` of ${n}` : ''}` : n ? `${plural(n, 'file')} changed · review` : 'Review what changed'}</span>${I.chevR}</button>`;
  } else if (j?.ship?.state) cap = `<span class="cmp-cap chrome is-static">${WI.merge}<span>${esc({ live: 'Live', building: 'Building', queued: 'Queued to ship', sent: 'With the Builder', committed: 'Committed', failed: 'Ship failed' }[j.ship.state] ?? j.ship.state)}</span></span>`;
  const pill = j ? `<button class="cmp-model chrome" data-act="lv-model" data-id="${esc(S.id)}" aria-label="This job: ${esc(j.model ? E.modelName(j.model) : 'default model')}, ${esc(E.MODES[j.mode ?? 'auto']?.[0] ?? '')}${j.plan ? ', plan first' : ''}">${markFor(j.engine, 16, { state: 'idle' })}<span>${esc(j.model ? E.modelName(j.model) : 'Default')}</span>${I.chevD}</button>` : '';
  const html = `${cap}${pill}`;
  if (row._html !== html) { row.innerHTML = html; row._html = html; }
}

// ── sending ──
const COMMENTS = new Map();   // job id → [{ path, line, text }] from the diff, sent with the next message
export const comments = (id) => COMMENTS.get(id) ?? [];
export function addComment(id, c) { COMMENTS.set(id, [...comments(id), c]); for (const S of pages) if (S.id === id) syncComposer(S); }
async function send(S, { steer = steerOn(), interrupt = false } = {}) {
  const ta = $('.cmp-in', S.page);
  const typed = ta.value.trim();
  const A = attachState;
  const key = `job-${S.id}`;
  const V = voiceP ? await voiceMod() : null;
  if (V?.busy?.(ta)) { toast('Wait for the voice note to land in the field'); return; }
  if (A?.uploading?.(key)) { toast('Wait for the attachments to finish uploading'); return; }
  const files = A?.ids?.(key) ?? [];
  const cm = comments(S.id);
  if (!typed && !files.length && !cm.length) {
    // an empty field while it works: the button stops this turn
    if (S.job?.status === 'running' || S.job?.status === 'starting') { haptic(14); try { await act.cancel(S.id); toast('Stopped this turn'); } catch (e) { toast(err(e)); } }
    return;
  }
  const note = E.revertNote(S.id);
  const parts = [note.text, typed, cm.length ? `Comments on your changes:\n${cm.map((c) => `- ${c.path}:${c.line}: ${c.text}`).join('\n')}` : ''].filter(Boolean);
  const text = parts.join('\n\n') || 'See the attached files.';
  ta.value = ''; grow(ta);
  const busy = isBusy(S.job);
  let force = false;
  if (S.job?.status === 'done') {
    if (!(await E.confirm({ title: 'Reopen this job?', body: 'It is marked done. Your message reopens it. If its cache has gone cold, it re-reads the whole chat at full price.', ok: 'Reopen and send', cancel: 'Not now' }))) { ta.value = typed; grow(ta); syncComposer(S); return; }
    force = true;
  }
  // a message while an OK waits says no to it and tells the agent what to do instead
  const p = S.job?.pending;
  try {
    haptic(8);
    if (S.job?.status === 'needs_input' && p && !p.form && !p.html && p.kind !== 'plan' && p.kind !== 'question') {
      const deny = p.options?.find((o) => o.kind === 'reject_once') ?? p.options?.find((o) => o.kind === 'reject_always');
      if (deny) await act.answer(S.id, deny.optionId, { requestId: p.requestId });
    }
    const before = S.job?.queue?.length ?? 0;
    // the same words sent again after no answer reuse their key: if the first one landed, it isn't posted twice
    if (S.unsent?.text !== text) S.unsent = { text, key: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` };
    const r = await act.prompt(S.id, text, { steer: busy && steer, interrupt, attachments: files, force, key: S.unsent.key });
    if (!r) { ta.value = typed; grow(ta); syncComposer(S); return; }
    S.unsent = null;
    A?.clear?.(key); COMMENTS.delete(S.id); note.done();
    if (r.job) setJob(S, r.job);
    if (busy && !interrupt) toast((r.job?.queue?.length ?? 0) > before ? (steer ? 'It can’t take it mid-turn, so it’s queued' : 'Queued for after this turn') : 'Steered in: it reads it at its next step');
    else if (interrupt) toast('Interrupted and sent');
  } catch (e) {
    if (e.status) S.unsent = null;   // the PC answered: a resend is a new message
    ta.value = typed; grow(ta);
    toast(err(e));
  }
  syncComposer(S);
}
function sendMenu(S) {
  const ta = $('.cmp-in', S.page);
  peek(`<div class="pk jpk"><div class="kicker">Send</div><p class="sub pk-msg">${esc(ta.value.trim().slice(0, 500))}</p><p class="foot pk-note">Steer now: it reads this at its next step, without stopping. Queue: it goes when this turn ends.</p></div>`,
    [['Steer now', WI.steer, 'lv-m-steer'], ['Queue after this turn', I.clock, 'lv-m-queue'], ['Interrupt and send now', I.stop, 'lv-m-interrupt']]);
  holdS = S;
}
let holdS = null;
on('lv-m-steer', () => { closePeek(); if (holdS) send(holdS, { steer: true }); });
on('lv-m-queue', () => { closePeek(); if (holdS) send(holdS, { steer: false }); });
on('lv-m-interrupt', () => { closePeek(); if (holdS) send(holdS, { steer: false, interrupt: true }); });
const pageOf = (el) => { const pg = el.closest('.lv-page'); return [...pages].find((S) => S.page === pg) ?? [...pages].find((S) => S.id === el.dataset.id) ?? null; };
on('lv-send', (el) => { const S = pageOf(el); if (S) send(S); });
on('lv-uncomment', (el) => { const S = pageOf(el); if (!S) return; const list = comments(S.id).slice(); list.splice(Number(el.dataset.i), 1); COMMENTS.set(S.id, list); syncComposer(S); });
on('lv-queued', (el) => {
  const S = pageOf(el); const m = S?.job?.queue?.find((x) => x.id === el.dataset.q); if (!S || !m) return;
  holdS = S; holdQ = m;
  peek(`<div class="pk jpk"><div class="kicker">Queued message</div><p class="sub pk-msg">${esc(plainLine(m.text, 500))}</p><p class="foot pk-note">It goes when this turn ends. Steer it in to have it read at the next step.</p></div>`,
    [['Steer it in now', WI.steer, 'lv-q-steer'], ['Edit', I.edit, 'lv-q-edit'], ['Remove', I.trash, 'lv-q-remove']]);
});
let holdQ = null;
on('lv-q-steer', async () => { closePeek(); try { const j = await act.queue(holdS.id, { steer: holdQ.id }); if (j) setJob(holdS, j); toast('Steered in'); } catch (e) { toast(err(e)); } });
on('lv-q-remove', async () => { closePeek(); try { const j = await act.queue(holdS.id, { remove: holdQ.id }); if (j) setJob(holdS, j); toast('Removed from the queue'); } catch (e) { toast(err(e)); } });
on('lv-q-edit', async () => { closePeek(); const S = holdS; const m = holdQ; const ta = $('.cmp-in', S.page); ta.value = m.text; grow(ta); ta.focus(); try { const j = await act.queue(S.id, { remove: m.id }); if (j) setJob(S, j); } catch (e) { toast(err(e)); } syncComposer(S); });

// ── answering ──
async function busyButtons(el, fn) {
  const box = el.closest('.ask-b') ?? el.parentElement;
  const btns = box ? $$('button', box) : [el];
  btns.forEach((b) => { b.disabled = true; });
  el.classList.add('is-busy');
  try { await fn(); } catch (e) { btns.forEach((b) => { b.disabled = false; }); el.classList.remove('is-busy'); toast(err(e)); }
}
on('lv-perm', (el) => busyButtons(el, async () => {
  const S = pageOf(el);
  const p = S?.job?.pending;
  const o = p?.options?.find((x) => x.optionId === el.dataset.opt);
  haptic(o?.kind?.startsWith('reject') ? 10 : 'success');
  const j = await act.answer(el.dataset.id, el.dataset.opt, { requestId: el.dataset.req });
  if (S && j) setJob(S, j);
  toast(el.dataset.opt === 'skip' ? 'Skipped' : DECIDED_WORD[o?.kind] ?? 'Answered');
}));
on('lv-plan', (el) => busyButtons(el, async () => {
  const S = pageOf(el);
  const yes = el.dataset.v === '1';
  if (!yes) { const ta = S && $('.cmp-in', S.page); const j = await act.plan(el.dataset.id, false); if (S && j) setJob(S, j); if (ta) { ta.value = 'Change the plan: '; grow(ta); ta.focus(); } toast('Keep planning: say what to change'); return; }
  haptic('success');
  const j = await act.plan(el.dataset.id, true);
  if (S && j) setJob(S, j);
  toast('Plan approved. Building');
}));
on('lv-run-plan', (el) => busyButtons(el, async () => {
  const S = pageOf(el);
  const r = await act.prompt(el.dataset.id, 'The plan is approved. Implement it now.', { plan: false });
  if (S && r?.job) setJob(S, r.job);
  toast('Plan approved. Building');
}));
on('lv-retry', (el) => busyButtons(el, async () => {
  const S = pageOf(el);
  const r = await act.prompt(el.dataset.id, 'Carry on where you left off.');
  if (S && r?.job) setJob(S, r.job);
}));
on('lv-form-send', (el) => busyButtons(el, async () => {
  const S = pageOf(el);
  const card = el.closest('.lv-form');
  const p = S?.events.get(Number(card?.dataset.seq))?.permission;
  if (!S || !p?.form) return;
  const f = formState(S, p);
  if (!formReady(p, f)) { toast('Answer every question first'); throw Object.assign(new Error('Answer every question first'), { status: 400 }); }
  haptic('success');
  const j = await act.answer(S.id, 'submit', { requestId: p.requestId, answers: formAnswers(p, f) });
  if (j) setJob(S, j);
  toast('Answer sent');
}));
// picks change in place (no redraw) so the Other box keeps its focus while he types
document.addEventListener('click', (e) => {
  const opt = e.target.closest('.lv-form [data-lvq]');
  if (!opt) return;
  const S = pageOf(opt); const card = opt.closest('.lv-form');
  const p = S?.events.get(Number(card.dataset.seq))?.permission;
  if (!p?.form || p.decided) return;
  const f = formState(S, p);
  const [i, k] = opt.dataset.lvq.split(':').map(Number);
  if (p.form[i].multiSelect) { if (f.sel[i].has(k)) f.sel[i].delete(k); else f.sel[i].add(k); }
  else { f.sel[i] = new Set(f.sel[i].has(k) ? [] : [k]); f.other[i] = ''; }
  haptic(5);
  syncForm(card, p, f);
});
document.addEventListener('input', (e) => {
  const x = e.target.closest?.('.lv-form [data-lvq-other]');
  if (!x) return;
  const S = pageOf(x); const card = x.closest('.lv-form');
  const p = S?.events.get(Number(card.dataset.seq))?.permission;
  if (!p?.form || p.decided) return;
  const f = formState(S, p); const i = Number(x.dataset.lvqOther);
  f.other[i] = x.value;
  if (!p.form[i].multiSelect && x.value.trim()) f.sel[i].clear();
  syncForm(card, p, f);
});
on('lv-tell', (el) => { const S = pageOf(el); const ta = S && $('.cmp-in', S.page); if (ta) { ta.focus(); toast(`Type what ${engineName(S.job)} should do instead. Sending says no to this`); } });
on('lv-goask', (el) => { const S = pageOf(el); const card = S && $(`#ask-${CSS.escape(S.id)}`, S.page); if (card) S.sc.scrollTo({ top: card.offsetTop - 110, behavior: 'smooth' }); });
on('lv-open', (el) => openLive(el.dataset.id));
on('lv-diff', (el) => { api.openChanges(el.dataset.id, Number(el.dataset.turn) || 0); });

// ── an ask_form: the agent's own HTML form in a sheet (sandboxed), its answers sent back like a form's ──
const BRIDGE = `<script>(()=>{const say=(m)=>parent.postMessage(Object.assign({aos:1},m),'*');
function collect(){const o={};for(const e of document.querySelectorAll('input,select,textarea')){if(!e.name||['submit','button','reset','file'].includes(e.type))continue;if((e.type==='checkbox'||e.type==='radio')&&!e.checked)continue;
if(e.multiple&&e.tagName==='SELECT'){const v=[...e.selectedOptions].map(x=>x.value);if(v.length)o[e.name]=v;continue}
const v=String(e.type==='checkbox'?(e.value==='on'?'yes':e.value):e.value).trim();if(!v)continue;if(e.type==='checkbox')(o[e.name]=o[e.name]||[]).push(v);else o[e.name]=v}return o}
document.addEventListener('submit',(ev)=>{ev.preventDefault();say({t:'answers',data:collect()})},true);
addEventListener('message',(ev)=>{const d=ev.data||{};if(d.aos===2&&d.t==='collect')say({t:'answers',data:collect()})});say({t:'ready'})})()</script>`;
const BASE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px/1.45 -apple-system,system-ui,sans-serif;margin:16px;color:#111;background:#fff}input,select,textarea,button{font:inherit}label{display:block;margin:6px 0}textarea,input[type=text]{border:1px solid #ccc;border-radius:10px;padding:10px;width:100%;box-sizing:border-box}</style>';
let FM = null;
on('lv-html-form', (el) => {
  const S = pageOf(el); const p = S?.events.get(Number(el.dataset.seq))?.permission;
  if (!S || !p?.html || p.decided) return;
  FM = { S, p };
  openSheet({ title: esc(p.title || 'A form for you'), large: true, cls: 'lv-fm-sheet', onClose: () => { FM = null; }, body: (b) => {
    b.innerHTML = `<iframe class="lv-fm" sandbox="allow-scripts allow-forms" title="${esc(p.title || 'Form')}"></iframe><div class="pad lv-fm-acts"><button class="btn primary block" style="--c:var(--needs)" data-act="lv-fm-send">Send answers</button><button class="btn block" data-act="lv-fm-skip">Skip</button></div>`;
    FM.frame = $('.lv-fm', b); FM.frame.srcdoc = BASE + p.html + BRIDGE;
  } });
});
on('lv-fm-send', () => FM?.frame?.contentWindow?.postMessage({ aos: 2, t: 'collect' }, '*'));
on('lv-fm-skip', async (el) => { if (!FM) return; const { S, p } = FM; try { const j = await act.answer(S.id, 'skip', { requestId: p.requestId }); closeSheet(el.closest('.sheet')); if (j) setJob(S, j); } catch (e) { toast(err(e)); } });
addEventListener('message', async (e) => {
  if (!FM || e.source !== FM.frame?.contentWindow || e.data?.aos !== 1 || e.data.t !== 'answers') return;
  const { S, p } = FM;
  if (!Object.keys(e.data.data ?? {}).length) { toast('Answer at least one question, or skip'); return; }
  try { const j = await act.answer(S.id, 'submit', { requestId: p.requestId, answers: e.data.data }); haptic('success'); closeSheet(document.querySelector('.lv-fm-sheet')); if (j) setJob(S, j); }
  catch (er) { toast(err(er)); }
});

// ── holds: a message (copy, edit and resend, rewind to here, fork from here), a checkpoint (review, undo) ──
const dropped = (S, seq) => (S.job?.dropped ?? []).some(([a, b]) => seq >= a && seq <= b);
function turnOfSeq(S, seq) { const u = [...S.events.values()].filter((e) => isTurnStart(e) && e.turn && e.seq <= seq).sort((a, b) => b.seq - a.seq)[0]; return u?.turn ?? null; }
let holdM = null;
function holdMessage(S, seq) {
  const ev = S.events.get(seq);
  if (!ev) return;
  const mine = isTurnStart(ev) && ev.turn && !dropped(S, seq);
  const turn = turnOfSeq(S, seq);
  holdM = { S, ev, turn };
  const text = ownWords(S, ev) ?? ev.text ?? '';
  const items = [['Copy', I.copy, 'lv-h-copy']];
  if (mine) items.push(['Edit and resend', I.edit, 'lv-h-edit'], ['Rewind to here…', I.rewind, 'lv-h-rewind']);
  if (S.job?.rewind && turn && !dropped(S, seq)) items.push(['Fork from here', I.fork, 'lv-h-fork']);
  peek(`<div class="pk jpk"><div class="kicker">${ev.type === 'user' ? 'Your message' : esc(engineName(S.job))}</div><p class="sub pk-msg">${esc(plainLine(text, 600))}</p></div>`, items);
}
async function copyText(t) { try { await navigator.clipboard.writeText(t); return true; } catch { return false; } }
on('lv-h-copy', async () => { closePeek(); if (!holdM) return; toast((await copyText(ownWords(holdM.S, holdM.ev) ?? holdM.ev.text ?? '')) ? 'Copied' : 'Couldn’t copy'); });
on('lv-h-fork', async () => { closePeek(); const { S, turn } = holdM ?? {}; if (!S) return; try { const j = await act.fork(S.id, turn); haptic('success'); toast(`Forked into ${j.id}`); openLive(j.id); } catch (e) { toast(err(e)); } });
on('lv-h-edit', () => { closePeek(); if (holdM) rewindSheet(holdM.S, holdM.ev, true); });
on('lv-h-rewind', () => { closePeek(); if (holdM) rewindSheet(holdM.S, holdM.ev, false); });
function rewindSheet(S, ev, edit) {
  if (isBusy(S.job)) { toast('Stop the turn first to rewind'); return; }
  const chat = !!S.job?.rewind;
  const row = (k, t, s) => `<button class="row" data-act="lv-rw" data-id="${esc(S.id)}" data-k="${k}" data-turn="${ev.turn}" data-edit="${edit ? 1 : ''}"><span class="rbody"><span class="rtitle">${t}</span><span class="rmeta wrap">${s}</span></span>${I.chevR}</button>`;
  openSheet({ title: edit ? 'Edit and resend' : `Rewind to before turn ${ev.turn}`, sub: 'Pick what goes back. What came after can’t be brought back from the phone.', body: `<div class="group">${chat ? row('both', 'Code and chat', 'Files as they were, and the chat forgets what came after') + row('chat', 'Chat only', 'The chat forgets; the files keep their changes') : ''}${row('code', 'Code only', `Files as they were; the chat ${chat ? 'keeps going' : 'remembers, and is told the work is undone'}`)}</div>` });
}
on('lv-rw', async (el) => {
  closeSheet(el.closest('.sheet'));
  const S = [...pages].find((x) => x.id === el.dataset.id); if (!S) return;
  try {
    const r = await act.rewind(S.id, Number(el.dataset.turn), el.dataset.k);
    if (r.job) setJob(S, r.job);
    haptic('success');
    if (el.dataset.edit) { const ta = $('.cmp-in', S.page); if (ta) { ta.value = r.text || ''; grow(ta); ta.focus(); syncComposer(S); } toast('Rewound. Edit the message and send it'); }
    else toast(r.files ? `Rewound: ${r.files.restored} files restored, ${r.files.removed} removed` : 'Rewound');
    load(S);
  } catch (e) { toast(err(e)); }
});
let holdC = null;
function holdCheckpoint(S, turn) {
  holdC = { S, turn };
  peek(`<div class="pk jpk"><div class="kicker">Checkpoint · turn ${turn}</div><p class="sub pk-msg">The files as they stood after this turn.</p></div>`, [['Review this turn', WI.fileDiff, 'lv-c-review'], ['Undo this turn', WI.revert, 'lv-c-undo']]);
}
on('lv-c-review', () => { closePeek(); if (holdC) api.openChanges(holdC.S.id, holdC.turn); });
on('lv-c-undo', async () => {
  closePeek(); const { S, turn } = holdC ?? {}; if (!S) return;
  if (isBusy(S.job)) { toast('Wait for the agent to finish, or stop the turn, first'); return; }
  const later = (S.job?.turns ?? 0) > turn;
  if (!(await E.confirm({ title: `Undo turn ${turn}?`, body: `Files go back to how they were before turn ${turn}.${later ? ' Later turns’ changes go too.' : ''} This can’t be brought back from the phone.`, ok: `Undo turn ${turn}`, cancel: 'Keep', danger: true }))) return;
  try { const r = await act.revert(S.id, turn); haptic('success'); toast(`Put back: ${plural(r.restored ?? 0, 'file')} restored, ${r.removed ?? 0} removed`); } catch (e) { toast(err(e)); }
});

// ── what shapes the next turn: model, effort, access, plan first, keep warm, hand to the other agent ──
on('lv-model', async (el) => {
  const S = pageOf(el); if (!S?.job) return;
  const M = await E.models();
  openSheet({ title: 'This job', sub: `${engineName(S.job)} on your PC · the next turn uses these`, large: true, cls: 'jt-set lv-set', body: (b) => {
    const draw = () => {
      const j = S.job;
      const live = j.status !== 'done';
      const mids = ['', ...((M[j.engine]?.length ? M[j.engine] : E.FALLBACK_MODELS[j.engine]) ?? [])];
      if (j.model && !mids.includes(j.model)) mids.splice(1, 0, j.model);
      const effs = ['', ...((M.efforts?.[j.engine]?.length ? M.efforts[j.engine] : E.FALLBACK_MODELS.efforts[j.engine]) ?? [])];
      const other = j.engine === 'claude' ? 'codex' : 'claude';
      const kwLeft = j.cache?.keepWarmUntil ? Math.max(0, Math.round((Date.parse(j.cache.keepWarmUntil) - Date.now()) / 360000) / 10) : 0;
      b.innerHTML = `<p class="wr-lbl pad">Model</p>
        <div class="group">${mids.map((m) => `<button class="row" data-act="lv-set" data-k="model" data-v="${esc(m)}"><span class="rbody"><span class="rtitle">${esc(m ? E.modelName(m) : 'Default')}</span><span class="rmeta"><span class="ell">${!m ? `${engineName(j)}’s own pick` : /^(opus|sonnet|haiku|fable)$/i.test(m) ? `The newest ${esc(E.modelName(m))}` : esc(m)}</span></span></span>${(j.model ?? '') === m ? `<span class="jpick">${I.check}</span>` : ''}</button>`).join('')}</div>
        <p class="wr-lbl pad">Effort</p>
        <div class="pad">${seg('lv-eff', effs.map((e) => [e || 'default', e === 'xhigh' ? 'X-high' : e ? E.effortName(e) : 'Default']), j.effort || 'default')}</div>
        <p class="wr-lbl pad">Access</p>
        <div class="group jsheet-list">${Object.entries(E.MODES).map(([k, [t, s]]) => `<button class="row ic" data-act="lv-set" data-k="mode" data-v="${k}"><span class="tile${k === 'auto' ? ' is-full' : ''}">${k === 'ask' ? I.shield : k === 'edits' ? I.edit : I.bolt}</span><span class="rbody"><span class="rtitle">${t}</span><span class="rmeta">${s}</span></span>${(j.mode ?? 'auto') === k ? `<span class="jpick">${I.check}</span>` : ''}</button>`).join('')}</div>
        ${j.driver === 'native' ? `<div class="group jm-plan"><div class="row"><span class="rbody"><span class="rtitle">Plan first</span><span class="rmeta">It writes a plan and waits for your OK before it edits</span></span><button class="switch ${j.plan ? 'on' : ''}" data-act="lv-set" data-k="plan" data-v="${j.plan ? '' : '1'}" role="switch" aria-checked="${!!j.plan}" aria-label="Plan first"></button></div></div>` : ''}
        ${j.cache && j.cache.state !== 'none' ? `<p class="wr-lbl pad">Keep the cache warm${kwLeft ? ` · ${kwLeft} h left` : ''}</p><div class="pad chips">${[['0', 'Off'], ['1', '1 h'], ['3', '3 h'], ['8', '8 h'], ['', 'Default']].map(([v, l]) => `<button class="chip${(v === '' && !j.cache.keepWarm) || (v === '0' && j.cache.keepWarm === 'off') ? ' on' : ''}" data-act="lv-warm" data-v="${v}">${l}</button>`).join('')}</div><p class="hint">A one-word message before the cache goes cold, so the next one is cheap. Each one counts toward your limits.</p>` : ''}
        <div class="group jm-fork"><button class="row ic" data-act="lv-handoff" data-id="${esc(S.id)}"><span class="tile">${markFor(other, 22)}</span><span class="rbody"><span class="rtitle">Hand it to ${agentName(other)}</span><span class="rmeta">A new job with this one’s summary, in the same project</span></span>${I.chevR}</button></div>
        <p class="hint">${live ? 'Whatever it asks still comes to Needs you, wherever you are in the app.' : 'This job is done. A message reopens it.'}</p>`;
      wireSegs(b);
      $('.seg', b)?.addEventListener('change', (e) => setOne(S, 'effort', e.detail === 'default' ? null : e.detail, draw));
    };
    b._draw = draw; draw();
    b.addEventListener('click', (e) => {
      const x = e.target.closest('[data-act="lv-set"]');
      if (x) { e.stopPropagation(); setOne(S, x.dataset.k, x.dataset.k === 'plan' ? !!x.dataset.v : x.dataset.v || null, draw); return; }
      const w = e.target.closest('[data-act="lv-warm"]');
      if (w) { e.stopPropagation(); warm(S, w.dataset.v, draw); }
    }, true);
  } });
});
async function setOne(S, k, v, redraw) {
  try {
    haptic(6);
    const j = await act.settings(S.id, { [k]: v });
    if (j) setJob(S, j);
    toast(k === 'model' ? `Next turn runs on ${v ? E.modelName(v) : 'the default model'}` : k === 'effort' ? `Next turn thinks at ${v ? E.effortName(v).toLowerCase() : 'the default'} effort` : k === 'mode' ? `${E.MODES[v]?.[0] ?? v} for the rest of this job` : v ? 'Plan first: the next turn starts with a plan' : 'Plan first off');
  } catch (e) { toast(e.status === 409 ? `It’s mid-turn. Change the ${k === 'mode' ? 'access' : k} when this turn ends` : err(e)); }
  redraw?.();
}
async function warm(S, v, redraw) {
  try { const j = await act.board(S.id, { keepWarm: v === '' ? null : Number(v) }); if (j) setJob(S, j); haptic(6); toast(v === '0' ? 'Keep-warm off for this job' : v === '' ? 'Keep-warm follows your board settings' : `Kept warm for ${v} h`); } catch (e) { toast(err(e)); }
  redraw?.();
}
on('lv-handoff', (el) => {
  const S = [...pages].find((x) => x.id === el.dataset.id); if (!S?.job) return;
  closeSheet();
  const j = S.job;
  const other = j.engine === 'claude' ? 'codex' : 'claude';
  setTimeout(() => api.newJob({ agent: other, project: j.project, task: j.taskIds?.[0], prompt: `Carry on from job ${j.id} (${j.title}).\n\nWhere it got to:\n${String(j.summary || j.lastText || '').slice(0, 3000)}`, from: j.id }), 280);
});
on('lv-plan-sheet', (el) => {
  const S = pageOf(el); const pr = progOf(S?.job?.progress); if (!pr) return;
  openSheet({ title: 'Plan', sub: `${pr.done} of ${pr.total} done${pr.stage ? ` · ${esc(pr.stage)}` : ''}`, body: `<div class="pad">${planCard(pr)}</div>` });
});
/** The job's own plan (plan_progress): stages of named steps, the active one turning. */
export function planCard(pr, { head = false } = {}) {
  return `<div class="plan surface">${head ? `<div class="pc-h">${WI.plan}<b>Plan</b><span class="cap num">${pr.done} of ${pr.total} done</span></div>` : ''}<ol class="pl">${pr.stages.map((s) => `<li class="pl-s"><span class="pl-n">${esc(s.name)}</span>${(s.steps ?? []).map((x) => `<div class="pl-r ${x.status === 'done' || x.status === 'skipped' ? 'done' : x.status === 'active' ? 'on' : x.status === 'error' ? 'err' : ''}"><span class="pl-c">${x.status === 'done' ? I.check : x.status === 'error' ? I.x : ''}</span><span class="pl-t">${esc(x.title)}</span>${x.at && x.status !== 'pending' ? `<span class="cap num">${esc(hhmmOf(x.at))}</span>` : ''}</div>`).join('')}</li>`).join('')}</ol></div>`;
}

// ── the job menu ──
on('lv-menu', (el) => {
  const S = pageOf(el); const j = S?.job; if (!j) return;
  const items = [
    ['star', j.starred ? I.starF : I.star, j.starred ? 'Unstar' : 'Star'],
    ['review', I.eye, j.review ? 'Clear review' : 'Mark for review'],
    j.turns && j.status !== 'done' ? ['rewind', I.rewind, 'Rewind the last turn…'] : null,
    j.rewind && j.turns ? ['fork', I.fork, 'Fork into a new job'] : null,
    j.workspace?.kind === 'worktree' && j.workspace.worktreeId && !['merged', 'removed'].includes(j.workspace.stage) ? ['copy', I.branch, 'Its copy: merge, PR or discard'] : null,
    E.code.terms.some((t) => t.cwd && j.cwd && String(t.cwd).toLowerCase() === String(j.cwd).toLowerCase() && t.status !== 'exited') ? ['term', I.term, 'Open its terminal'] : null,
    j.ship?.builderJob ? ['builder', I.hammer, 'Open the Builder'] : null,
    j.status !== 'done' ? ['done', I.check, 'Mark done…'] : null,
    isBusy(j) ? ['stop', I.stop, 'Stop the session'] : null,
  ].filter(Boolean);
  const LANE = { attention: 'Needs you', working: 'Working', completed: 'Completed' };
  openSheet({ title: esc(j.title || 'Job'), sub: esc([engineName(j), j.model ? E.modelName(j.model) : null, j.effort ? E.effortName(j.effort) : null].filter(Boolean).join(' · ')), body: `
    <div class="group">${items.map(([k, ic, t]) => `<button class="row ic${k === 'stop' ? ' jm-danger' : ''}" data-act="lv-m" data-k="${k}" data-id="${esc(j.id)}"><span class="tile">${ic}</span><span class="rbody"><span class="rtitle">${t}</span></span></button>`).join('')}</div>
    <div class="sh"><h2>Move to</h2></div>
    <div class="pad chips">${Object.entries(LANE).map(([l, n]) => `<button class="chip${l === j.lane ? ' on' : ''}" data-act="lv-move" data-id="${esc(j.id)}" data-l="${l}" ${l === j.lane ? 'disabled' : ''}>${n}</button>`).join('')}</div>
    <div class="group jm-danger"><button class="row ic" data-act="lv-m" data-k="${j.lane === 'archived' ? 'unarchive' : 'archive'}" data-id="${esc(j.id)}"><span class="tile">${I.archive}</span><span class="rbody"><span class="rtitle">${j.lane === 'archived' ? 'Back to Completed' : 'Archive'}</span></span></button></div>` });
});
on('lv-move', async (el) => { closeSheet(); await E.moveJob(el.dataset.id, el.dataset.l, { label: `Moved to ${el.textContent.trim()}` }); });
on('lv-m', async (el) => {
  const id = el.dataset.id, k = el.dataset.k; const S = [...pages].find((x) => x.id === id); const j = S?.job ?? raw(id);
  closeSheet();
  try {
    if (k === 'star') { await act.board(id, { starred: !j.starred }); toast(j.starred ? 'Unstarred' : 'Starred'); }
    else if (k === 'review') { await act.board(id, { review: !j.review }); toast(j.review ? 'Review cleared' : 'Marked for review'); }
    else if (k === 'archive') { await E.moveJob(id, 'archived', { label: 'Archived' }); pop(); }
    else if (k === 'unarchive') await E.moveJob(id, 'completed', { label: 'Back in Completed' });
    else if (k === 'stop') { const x = await act.stop(id); if (S && x) setJob(S, x); toast('Session stopped. A message resumes it'); }
    else if (k === 'fork') { const x = await act.fork(id); haptic('success'); toast(`Forked into ${x.id}`); openLive(x.id); }
    else if (k === 'rewind' && S) { const ev = [...S.events.values()].filter((e) => isTurnStart(e) && e.turn && !dropped(S, e.seq)).sort((a, b) => b.seq - a.seq)[0]; if (ev) setTimeout(() => rewindSheet(S, ev, false), 300); else toast('Nothing to rewind yet'); }
    else if (k === 'copy') setTimeout(() => api.openCopy(j.workspace.worktreeId, id), 280);
    else if (k === 'term') { const t = E.code.terms.find((x) => x.cwd && String(x.cwd).toLowerCase() === String(j.cwd).toLowerCase() && x.status !== 'exited'); if (t) setTimeout(() => api.openTerminal(j.project, t.id), 280); }
    else if (k === 'builder') openLive(j.ship.builderJob);
    else if (k === 'done') setTimeout(() => doneSheet(id), 280);
  } catch (e) { toast(err(e)); }
});
function doneSheet(id) {
  const j = raw(id); if (!j) return;
  const open = (j.taskIds ?? []).map(taskOf).filter((t) => t && !['done', 'dropped'].includes(t.status) && t.list !== 'done');
  openSheet({ title: 'Mark this job done?', sub: 'The session stops. A message later reopens it.', body: `<div class="pad lv-done-b">${open.length ? `<button class="btn primary block" style="--c:var(--jobs-fill)" data-act="lv-done" data-id="${esc(id)}" data-tasks="1">${I.check}Done, and ${open.length === 1 ? 'its task' : `its ${open.length} tasks`} too</button><button class="btn block" data-act="lv-done" data-id="${esc(id)}">Job only</button>` : `<button class="btn primary block" style="--c:var(--jobs-fill)" data-act="lv-done" data-id="${esc(id)}">${I.check}Done</button>`}<button class="btn block wk-cf-no" data-act="close-sheet">Not yet</button></div>` });
}
on('lv-done', async (el) => {
  closeSheet(el.closest('.sheet'));
  try { const j = await act.done(el.dataset.id, { completeTasks: !!el.dataset.tasks }); const S = [...pages].find((x) => x.id === el.dataset.id); if (S && j) setJob(S, j); haptic('success'); toast(el.dataset.tasks ? 'Job and its tasks are done' : 'Job done'); }
  catch (e) { toast(err(e)); }
});
on('lv-copy', (el) => { const j = raw(el.dataset.id); const w = j?.workspace; if (w?.worktreeId) api.openCopy(w.worktreeId, j.id); });

// ── adding to the message: photos and files (uploaded now; HEIC converts on the PC), another job's summary ──
on('lv-attach', (el) => {
  const S = pageOf(el); if (!S) return;
  const others = E.storeNow()?.W?.jobs?.filter((x) => x.id !== S.id && x.role !== 'builder' && (x.summary || x.lastText)).slice(0, 6) ?? [];
  openSheet({ title: 'Add to the message', sub: `${esc(engineName(S.job))} reads it with your next message`, body: (b) => {
    b.innerHTML = `<div class="group"><button class="row ic wk-addrow" data-attach="job-${esc(S.id)}" data-lv-pick="1"><span class="tile">${WI.image}</span><span class="rbody"><span class="rtitle">Photos or files</span><span class="rmeta"><span class="ell">Up to 10, 25 MB each. Photos shrink to 2048 px first</span></span></span>${I.plus}</button></div>
      ${others.length ? `<p class="wr-lbl pad">Another job’s summary</p><div class="group">${others.map((x) => `<button class="row ic" data-lv-sum="${esc(x.id)}"><span class="tile">${markFor(x, 20)}</span><span class="rbody"><span class="rtitle">${esc(x.title || x.id)}</span><span class="rmeta"><span class="ell">${esc(plainLine(x.summary || x.lastText, 80))}</span></span></span>${I.plus}</button>`).join('')}</div>` : ''}`;
    b.addEventListener('click', (e) => {
      if (e.target.closest('[data-lv-pick]')) { setTimeout(() => closeSheet(b.closest('.sheet')), 50); return; }
      const sm = e.target.closest('[data-lv-sum]');
      if (sm) {
        // the list copy (bootstrap) has only the last 300 characters: the whole summary comes from the job itself
        const id = sm.dataset.lvSum; closeSheet(b.closest('.sheet')); haptic(6);
        act.get(id).then((r) => r.job).catch(() => null).then((full) => {
          const x = full ?? E.raw(id); const ta = $('.cmp-in', S.page); if (!x || !ta) return;
          ta.value = `${ta.value ? `${ta.value}\n\n` : ''}From job ${x.id} (${x.title}):\n${String(x.summary || x.lastText).slice(0, 2500)}`; grow(ta); syncComposer(S);
        });
      }
    });
  } });
  attachMod();   // its file picker answers [data-attach]
});

// redraw marks and the hero when the PC's job changes off this page (a poll, another phone, the notification's Allow)
document.addEventListener('data-changed', (e) => {
  if (e.detail?.why !== 'jobs') return;
  for (const S of pages) { const r = raw(S.id); if (r && r.updatedAt && r.updatedAt !== S.job?.updatedAt && !S.stream?.alive) setJob(S, r); }
});
document.addEventListener('store-changed', (e) => { if (e.detail?.name === 'work/reviews') for (const S of pages) capsuleDraw(S); });
export const livePages = () => [...pages];

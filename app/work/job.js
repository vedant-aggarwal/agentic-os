// The live job page: what Claude Code or Codex is doing right now, streamed from the PC over SSE
// (GET /jobs/:id/stream). Assistant text, collapsible tool rows, the plan, permission cards, and a composer.
import { W, putJob, jobById, isLive, isActive, JOB_LABEL, ENGINE, projectBySlug } from './state.js';
import * as voice from './recorder.js';
import * as attach from './attach.js';
import { folderName, sheetEl, scrimFor } from './sheets.js';
import { hasProgress, progOf, progLabel, progHeadHTML, progListHTML } from './progress.js';
import { sumFiles } from './diff.js';
import { wsOf, wsCardHTML } from './workspace.js';
import { loadModels, modelLabel, effortLabel, modelChoices, effortChoices } from './models.js';
import { postCold, openMenu, sheetHead } from './board.js';
import { agentHTML, hasRing, stateWord, shipHTML, cacheHTML, statHTML, agoText, engineName, keptWarm } from './cards.js';

const { AOS } = window;
const { esc } = AOS;
const I = AOS.icons;
const $ = (s, el = document) => el.querySelector(s);

// ---------- Markdown, small: paragraphs, lists, code, bold, links ----------
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}
export function md(text) {
  const out = [];
  const parts = String(text ?? '').split(/```[^\n]*\n?/);
  parts.forEach((chunk, i) => {
    if (i % 2) { out.push(`<pre><code>${esc(chunk.replace(/\n$/, ''))}</code></pre>`); return; }
    for (const block of chunk.split(/\n{2,}/)) {
      const lines = block.split('\n').filter((l) => l.trim());
      if (!lines.length) continue;
      if (lines.every((l) => /^\s*([-*]|\d+\.)\s+/.test(l))) {
        const ordered = /^\s*\d+\./.test(lines[0]);
        out.push(`<${ordered ? 'ol' : 'ul'}>${lines.map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      } else if (/^#{1,4}\s/.test(lines[0]) && lines.length === 1) out.push(`<p class="md-h">${inline(lines[0].replace(/^#+\s*/, ''))}</p>`);
      else out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
    }
  });
  return out.join('');
}

const TOOL_ICON = {
  read: '<path d="M3 3.5h6.5L13 7v5.5H3z"/><path d="M9 3.5V7h4"/>',
  edit: '<path d="M10.4 2.6l3 3-7.6 7.6-3.4.5.5-3.4z"/>',
  execute: '<rect x="1.8" y="2.8" width="12.4" height="10.4" rx="2.5"/><path d="m4.8 6.4 2 1.6-2 1.6M8.6 9.8h2.6"/>',
  search: '<circle cx="7" cy="7" r="4"/><path d="m10 10 3.5 3.5"/>',
  fetch: '<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c2 2.2 2 8.8 0 11M8 2.5c-2 2.2-2 8.8 0 11"/>',
  think: '<path d="M8 2.5a4 4 0 0 0-2.2 7.3V12h4.4V9.8A4 4 0 0 0 8 2.5zM6.3 14h3.4"/>',
  other: '<circle cx="8" cy="8" r="2"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2"/>',
};
const toolIcon = (kind) => `<svg viewBox="0 0 16 16" aria-hidden="true">${TOOL_ICON[kind] ?? TOOL_ICON[kind === 'delete' || kind === 'move' ? 'edit' : 'other']}</svg>`;
const TOOL_STATE = { pending: 'Waiting', in_progress: 'Running', completed: 'Done', failed: 'Failed' };
// A step reads as a sentence; its paths, files and commands read as code.
const CODE = /(`[^`]+`|(?:[\w.-]*[\\/])+[\w.-]+|\b[\w-]+\.(?:css|js|mjs|cjs|ts|tsx|jsx|md|swift|html|json|db|py|ps1|sh|yml|yaml|toml|txt|plist)\b)/g;
function toolText(kind, title) {
  const t = String(title ?? '');
  const cmd = kind === 'execute' && /^(node|bun|git|npm|npx|pnpm|pwsh|powershell|python|py|curl|ls|cd|rg|grep)\b/.test(t);
  return cmd ? `<span class="mono">${esc(t)}</span>` : esc(t).replace(CODE, (m) => `<span class="mono">${m.replace(/`/g, '')}</span>`);
}
/** A plain OK's answers in one word each, and what was decided. */
const PERM_WORD = { allow_once: 'Allow once', allow_always: 'Always', reject_once: 'Deny', reject_always: 'Never' };
const DECIDED_WORD = { allow_once: 'Allowed once', allow_always: 'Allowed', reject_once: 'Denied', reject_always: 'Denied' };
/** ask: every change asks. edits: file edits go through, commands ask. auto: nothing asks. */
const JOB_MODES = [['ask', 'Ask first'], ['edits', 'Auto-edit'], ['auto', 'Full access']];

// ---------- Question forms (CONTRACT §2): every question at once, option cards, an Other box each, one Send ----------
const MARK_SVG = '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="m3.5 7.3 2.4 2.3 4.6-5"/></svg>';
/** The phone's picks for one open form, kept across re-renders: sel[i] = chosen option indexes, other[i] = typed text. */
function formState(S, p) {
  let f = S.forms.get(p.requestId);
  if (!f) { f = { sel: p.form.map(() => new Set()), other: p.form.map(() => '') }; S.forms.set(p.requestId, f); }
  return f;
}
/** question text → answer text: the chosen label; several joined with ", " (multiSelect); Other text when typed. */
function formAnswers(p, f) {
  const out = {};
  p.form.forEach((q, i) => {
    const labels = [...f.sel[i]].sort((a, b) => a - b).map((j) => q.options?.[j]?.label).filter(Boolean);
    const other = f.other[i].trim();
    const a = q.multiSelect ? [...labels, other].filter(Boolean).join(', ') : other || labels[0] || '';
    if (a) out[q.question] = a;
  });
  return out;
}
const formReady = (p, f) => p.form.every((q) => formAnswers(p, f)[q.question]);
function formHTML(S, ev, p, open) {
  const at = `data-seq="${ev.seq}"`;
  const qHead = (q) => `${q.header ? `<span class="jq-head">${esc(q.header)}</span>` : ''}<span class="jq-text">${inline(q.question)}</span>`;
  if (!open) {
    const skipped = p.decided === 'skip' || p.decided === 'cancelled' || !p.answers;
    return `<div class="je je-perm je-form" ${at}><div class="pc-h">${I.chat}<b>${p.decided === 'skip' ? 'Skipped' : p.decided === 'cancelled' ? 'Cancelled' : skipped ? 'Answered' : 'Your answers'}</b></div>${p.form.map((q) => `<div class="jq-done"><p class="jq-q">${qHead(q)}</p>${p.answers?.[q.question] ? `<p class="jq-a">${esc(p.answers[q.question])}</p>` : skipped ? '' : '<p class="jq-a none">No answer</p>'}</div>`).join('')}</div>`;
  }
  const f = formState(S, p);
  const name = (id, dflt) => p.options?.find((o) => o.optionId === id)?.name ?? dflt;
  const qs = p.form.map((q, i) => {
    const multi = !!q.multiSelect;
    const opts = (q.options ?? []).map((o, j) => {
      const on = f.sel[i].has(j);
      return `<button type="button" class="jq-opt${on ? ' on' : ''}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${on}" data-jq="${i}:${j}"><span class="jq-body"><b>${esc(o.label)}</b>${o.description ? `<small>${inline(o.description)}</small>` : ''}${o.preview ? `<pre class="jq-prev">${esc(o.preview)}</pre>` : ''}</span><i class="jq-mark">${MARK_SVG}</i></button>`;
    }).join('');
    return `<div class="jq${multi ? ' multi' : ''}" role="group" aria-label="${esc(q.question)}"><p class="jq-q">${qHead(q)}${multi ? '<span class="jq-hint">Pick any</span>' : ''}</p><div class="jq-opts">${opts}<input class="jq-other${f.other[i].trim() ? ' on' : ''}" data-jq-other="${i}" value="${esc(f.other[i])}" placeholder="Other: type your own answer" aria-label="Other answer" enterkeyhint="done" autocomplete="off" /></div></div>`;
  }).join('');
  return `<div class="je je-perm je-form open" ${at}><div class="pc-h">${I.chat}<b>${p.form.length === 1 ? '1 question for you' : `${p.form.length} questions for you`}</b></div>${qs}<div class="jp-opts"><button type="button" class="btn sm primary" style="--c:var(--needs)" data-form-send="${esc(p.requestId)}" ${formReady(p, f) ? '' : 'disabled'}>${esc(name('submit', 'Send answers'))}</button><button type="button" class="btn sm" data-perm="${esc(p.requestId)}" data-opt="skip">${esc(name('skip', 'Skip'))}</button></div></div>`;
}
/** Picks change in place (no re-render) so the Other box keeps focus while typing. */
function syncForm(card, p, f) {
  card.querySelectorAll('[data-jq]').forEach((b) => {
    const [i, j] = b.dataset.jq.split(':').map(Number);
    const on = f.sel[i].has(j);
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
  card.querySelectorAll('[data-jq-other]').forEach((x) => { const i = +x.dataset.jqOther; if (x.value !== f.other[i]) x.value = f.other[i]; x.classList.toggle('on', !!f.other[i].trim()); });
  const send = card.querySelector('[data-form-send]');
  if (send) send.disabled = !formReady(p, f);
}

function eventHTML(ev, S) {
  const job = S.job;
  const at = `data-seq="${ev.seq}"`;
  switch (ev.type) {
    case 'user': {
      if (ev.ping) return `<p class="je je-status je-ping" ${at}>Kept the cache warm</p>`;
      const u = attach.splitAttached(ev.text);
      return `<div class="je je-user${ev.steer ? ' steer' : ''}" ${at}>${ev.steer ? '<span class="je-steer">Steered in</span>' : ''}${attach.sentHTML(u.files)}${u.text ? `<div class="bubble">${md(u.text)}</div>` : ''}</div>`;
    }
    case 'assistant': return `<div class="je je-text" ${at}>${md(ev.text)}</div>`;
    case 'thought': return `<details class="je je-thought" ${at}><summary>Thinking</summary><div class="je-thought-body">${md(ev.text)}</div></details>`;
    case 'tool': {
      const t = ev.tool ?? {};
      const locs = (t.locations ?? []).map((l) => `<code>${esc(l)}</code>`).join('');
      const body = `${locs ? `<div class="jt-locs">${locs}</div>` : ''}${t.output ? `<pre class="jt-out">${esc(String(t.output).slice(-4000))}</pre>` : ''}`;
      // a step reads as a sentence with its paths and commands as code; only a running or failed one says so
      return `<details class="je je-tool s-${esc(t.status ?? 'pending')}" ${at}><summary><span class="jt-ico">${toolIcon(t.kind)}</span><span class="jt-title">${toolText(t.kind, t.title || t.kind || 'Tool')}</span>${t.status === 'in_progress' || t.status === 'pending' || t.status === 'failed' ? `<span class="jt-state">${TOOL_STATE[t.status]}</span>` : ''}</summary>${body || '<p class="quiet">No output.</p>'}</details>`;
    }
    // A checklist (plan entries), or a written plan from plan mode (text).
    case 'plan': return ev.text
      ? `<div class="je je-plantext" ${at}><div class="pc-h">${I.flag}<b>Plan</b></div>${md(ev.text)}</div>`
      : `<div class="je je-plan" ${at}><ul>${(ev.plan ?? []).map((p) => `<li class="s-${esc(p.status)}"><i aria-hidden="true">${p.status === 'completed' ? I.check : ''}</i><span>${inline(p.content)}</span></li>`).join('')}</ul></div>`;
    case 'changes': {
      const fs = ev.changes ?? [];
      const { add, del } = sumFiles(fs);
      return fs.length ? `<button type="button" class="je je-changes" ${at} data-open-jobdiff="${esc(job?.id ?? '')}~${ev.turn ?? 0}"><span class="tile">${I.doc}</span><span class="rbody"><b>${fs.length} ${fs.length === 1 ? 'file' : 'files'} changed</b><span class="jdiffstat num">${statHTML(add, del)}</span><span class="jc-names mono">${esc(fs.slice(0, 3).map((f) => f.path.split('/').pop()).join(', '))}${fs.length > 3 ? ` +${fs.length - 3}` : ''}</span></span><span class="btn sm">View</span></button>` : '';
    }
    case 'permission': {
      const p = ev.permission ?? {};
      const open = !p.decided && job?.pending?.requestId === p.requestId;
      if (p.html) return htmlFormCard(ev, p);
      // A form stays open until it is decided (it doesn't wait for job.pending to catch up).
      if (Array.isArray(p.form) && p.form.length) return formHTML(S, ev, p, !p.decided);
      const chosen = p.options?.find((o) => o.optionId === p.decided);
      const plan = p.kind === 'plan';
      // A plain OK says what each answer does in one word; a plan's choices keep their own names.
      const word = (o) => (plan ? o.name : PERM_WORD[o.kind] ?? o.name);
      if (!open) return `<p class="je je-status je-decided" ${at}>${plan ? I.flag : I.shield}<span>${inline(p.title ?? '')}</span><b>${esc(chosen ? (plan ? chosen.name : DECIDED_WORD[chosen.kind] ?? chosen.name) : 'Answered')}</b></p>`;
      return `<div class="je je-perm open" ${at}><div class="pc-h">${plan ? I.flag : I.shield}<b>${plan ? 'A plan to approve' : 'Needs your OK'}</b></div><p class="jp-title">${inline(p.title ?? '')}</p>
<div class="jp-opts">${(p.options ?? []).map((o, i) => `<button type="button" class="btn sm${i === 0 ? ' primary' : ''}"${i === 0 ? ' style="--c:var(--needs)"' : ''} data-perm="${esc(p.requestId)}" data-opt="${esc(o.optionId)}" aria-label="${esc(o.name)}">${esc(word(o))}</button>`).join('')}</div></div>`;
    }
    case 'status': return `<p class="je je-status" ${at}>${esc(ev.text || JOB_LABEL[ev.status] || ev.status || '')}</p>`;
    case 'error': return `<div class="je je-error" ${at}>${md(ev.text)}</div>`;
    default: return ev.text ? `<div class="je je-text" ${at}>${md(ev.text)}</div>` : '';
  }
}

// ---------- SSE over fetch (EventSource can't send the Bearer token from the iPhone app) ----------
async function stream(path, onEvent, signal) {
  const r = await AOS.fetch(path, { headers: { Accept: 'text/event-stream' }, signal });
  if (!r.ok || !r.body) throw Object.assign(new Error(`stream ${r.status}`), { status: r.status });
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      let type = 'message', dataLines = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
      }
      if (dataLines.length) { try { onEvent(type, JSON.parse(dataLines.join('\n'))); } catch (e) { console.warn('[job] bad event', e); } }
    }
  }
}

// ---------- The page ----------
const pages = new Set();
export function renderJobPage(box, id, el) {
  const S = { id, job: jobById(id), events: new Map(), nodes: new Map(), sections: new Map(), userSeqs: [], byTurn: new Map(), forms: new Map(), groupLive: false, lastSeq: -1, ctrl: null, alive: true, retry: 0, finishing: false, el, box };
  pages.add(S);
  box.classList.add('job-page');
  box.innerHTML = '<div class="job-hero"></div><div class="job-events" aria-live="polite"></div><div class="job-tail"></div>';
  // Remember which Working groups and tool rows the user opened (toggle doesn't bubble: listen in capture).
  $('.job-events', box).addEventListener('toggle', (e) => {
    const d = e.target;
    const o = opensOf(id);
    if (d.classList?.contains('jw')) o.groups.set(+d.dataset.wg, d.open);
    else if (d.dataset?.seq) { if (d.open) o.rows.add(+d.dataset.seq); else o.rows.delete(+d.dataset.seq); }
  }, true);
  el.classList.add('has-composer');
  // The composer floats over the chat: what is queued, where the job stands (its plan, or where it works) and the
  // cache, then the field. Hold Send to steer, queue or interrupt.
  const comp = document.createElement('form');
  comp.className = 'job-composer glass';
  comp.autocomplete = 'off';
  comp.dataset.attHost = `job-${id}`;
  comp.innerHTML = `<div class="jc-queue" hidden></div><div class="jcm-top"><button type="button" class="jp-strip" data-prog-open hidden></button><span class="jc-where" hidden></span><span class="jc-meta" hidden></span></div>${attach.trayHTML(`job-${id}`)}<div class="jc-row">${attach.attachButtonHTML(`job-${id}`)}<textarea id="jc-${id}" rows="1" placeholder="Message the job" enterkeyhint="send" aria-label="Message the job"></textarea>${voice.micButtonHTML(`data-mic-for="jc-${id}" data-purpose="prompt"`)}<button type="submit" class="jc-send" aria-label="Send">${I.up}</button></div><div class="rec-slot" data-rec-for="jc-${id}"></div>`;
  el.appendChild(comp);
  attach.onChange(`job-${id}`, () => syncComposer(S));
  attach.changed(`job-${id}`);   // a draft tray left from the last visit
  const ta = comp.querySelector('textarea');
  const fit = () => { ta.style.height = ''; ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`; syncComposer(S); };
  ta.addEventListener('input', fit);
  ta.addEventListener('focus', () => document.getElementById('screen').classList.add('composing'));
  ta.addEventListener('blur', () => setTimeout(() => { if (!document.activeElement?.closest?.('.job-composer')) document.getElementById('screen').classList.remove('composing'); }, 60));
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !AOS.native) { e.preventDefault(); comp.requestSubmit(); } });
  comp.addEventListener('submit', (e) => { e.preventDefault(); if (S.held) { S.held = false; return; } send(S, ta); });
  comp.addEventListener('click', (e) => {
    if (S.held) { S.held = false; e.preventDefault(); return; }
    const dq = e.target.closest('[data-unqueue]');
    if (dq) { unqueue(S, dq.dataset.unqueue); return; }
    const qd = e.target.closest('[data-queued]');
    if (qd) { AOS.haptic('selection'); queuedMenu(S, qd.dataset.queued); return; }
    const kw = e.target.closest('[data-keep-warm]');
    if (kw) { keepWarm(S, kw.dataset.keepWarm === 'on'); return; }
    if (e.target.closest('[data-cancel-turn]')) act(S, 'cancel');
    else if (e.target.closest('[data-prog-open]')) openProg(S);
  });
  // Hold Send: queue it after this turn, or interrupt and send now.
  const sendBtn = comp.querySelector('.jc-send');
  sendBtn.addEventListener('pointerdown', () => {
    clearTimeout(S.holdT);
    S.holdT = setTimeout(() => { if (ta.value.trim() || attach.has(`job-${id}`)) { S.held = true; AOS.haptic('medium'); sendMenu(S, ta); } }, 450);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) sendBtn.addEventListener(ev, () => clearTimeout(S.holdT));
  sendBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  // Header: Stop while it runs, Done to finish.
  const right = el.querySelector('.navbar > span:last-child');
  if (right) { right.className = 'nav-acts'; }
  hero(S);
  load(S);
  loadModels(() => { if (S.alive) hero(S); });
  // Stop streaming once the page is popped.
  const mo = new MutationObserver(() => {
    if (el.isConnected) return;
    S.alive = false; S.ctrl?.abort(); pages.delete(S); mo.disconnect();
    document.getElementById('screen').classList.remove('composing');
    if (progS === S) { progS = null; if (progSheet.isOpen) progSheet.close(); }
  });
  mo.observe(el.parentNode, { childList: true });
}

// The hero: the job's ring and where it stands, its title, then the settings that shape the next turn (model,
// effort, permissions, plan first), where it writes, the cache and its changes, and what the session has cost.
const JOB_MODE_NOTE = { ask: 'Asks before it edits a file or runs a command', edits: 'Edits files on its own, asks before it runs commands', auto: 'Edits and runs anything without asking' };
const kNum = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
/** A pill with the phone's own picker over it (a transparent native select), for the job's next turn. */
const pickPill = (attr, value, opts, label, lead = '') => `<label class="model-pick jh-pick">${lead}<span>${esc(opts.find(([v]) => v === value)?.[1] ?? value)}</span>${I.chevD}<select ${attr} aria-label="${esc(label)}">${opts.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
function hero(S) {
  const j = S.job;
  const title = S.el.querySelector('.nav-title');
  if (title) {
    // The bar shows the job's title once the hero scrolls away. Its text stays "Chat": a page pushed from here
    // (its changes, a Builder) says "‹ Chat" on its back button.
    title.textContent = 'Chat';
    title.dataset.t = j?.title || 'Job';
    title.dataset.s = j ? [engineName(j), j.model ? modelLabel(j.model).replace(' (latest)', '') : null].filter(Boolean).join(' · ') : '';
  }
  const right = S.el.querySelector('.nav-acts');
  if (right) {
    const stop = j && isLive(j) && j.status !== 'done';
    const html = !j ? '' : `${stop ? `<button class="nav-icon jstop" data-job-act="stop" aria-label="Stop the session">${I.stop}</button>` : ''}<button class="nav-icon" data-job-act="menu" aria-label="Job menu">${I.dots}</button>`;
    if (right._html !== html) { right.innerHTML = html; right._html = html; }
    right.onclick = (e) => { const b = e.target.closest('[data-job-act]'); if (b) act(S, b.dataset.jobAct); };
  }
  if (!j) { $('.job-hero', S.box).innerHTML = '<p class="quiet">Loading the job…</p>'; return; }
  const p = j.project ? projectBySlug(j.project) : null;
  const tasks = (j.taskIds ?? []).map((t) => AOS.taskById(t)).filter(Boolean);
  const idea = j.ideaId ? W.ideas.find((i) => i.id === j.ideaId) : null;
  const ws = wsOf(j);
  const u = j.usage;
  const pr = progOf(j.progress);
  const live = j.status !== 'done';
  const needs = j.status === 'needs_input';
  const running = j.status === 'running' || j.status === 'starting';
  // Where it stands: its ring while it has steps and is live, else its glyph and state.
  const top = pr && hasRing(j)
    ? `<div class="jh-top ring">${AOS.ring(Math.min(1, pr.done / pr.total), 'jobs', 76, 9, { cls: `jring${running ? ' running' : ''}`, inner: `${agentHTML(j, 'big')}${needs ? '<em class="jbadge" aria-hidden="true"></em>' : ''}`, label: `${pr.done} of ${pr.total} steps` })}
<div class="jh-stat"><b class="met c-jobs"><span data-count="${pr.done}">${pr.done}</span><small>/${pr.total} steps</small></b><span class="jh-step">${esc(pr.active ?? '')}</span><span class="cap">${needs ? '<span class="jst-needs">Needs you</span>' : ''}${needs && pr.stage ? ' · ' : ''}${esc(pr.stage ?? '')}</span></div></div>`
    : `<div class="jh-top">${agentHTML(j, 'big')}<div class="jh-stat"><span class="jh-step ${stateWord(j)[1]}">${esc(stateWord(j)[0])}</span><span class="jmeta">${[shipHTML(j), `<span>${esc(agoText(j.updatedAt ?? j.createdAt))}</span>`].filter(Boolean).join('')}</span></div></div>`;
  // The settings for the next turn: on servers that report a driver (older ones show what they know).
  const MODEL_OPTS = [['', 'Default model'], ...modelChoices(j.engine, j.model ?? '').map((v) => [v, modelLabel(v).replace(' (latest)', '')])];
  const model = j.driver && live && j.model !== undefined ? pickPill('data-job-model', j.model ?? '', MODEL_OPTS, 'Model for the next turn')
    : j.model ? `<span class="model-pick jh-pick">${esc(modelLabel(j.model))}</span>` : '';
  const EFFORT_OPTS = [['', 'Default effort'], ...effortChoices(j.engine, j.effort ?? '').map((v) => [v, effortLabel(v)])];
  const effort = j.driver === 'native' && live && j.effort !== undefined ? pickPill('data-job-effort', j.effort ?? '', EFFORT_OPTS, 'Effort for the next turn')
    : j.effort ? `<span class="model-pick jh-pick">${esc(effortLabel(j.effort))}</span>` : '';
  const mode = j.mode ?? 'auto';
  const perm = j.driver && live ? pickPill('data-job-mode', mode, JOB_MODES, 'What it may do without asking', I.shield)
    : `<span class="model-pick jh-pick">${I.shield}<span>${esc(JOB_MODES.find(([v]) => v === mode)?.[1] ?? mode)}</span></span>`;
  const plan = j.driver === 'native' && live ? `<button type="button" class="model-pick jh-pick jh-plan${j.plan ? ' on' : ''}" aria-pressed="${!!j.plan}" data-job-plan>${I.flag}<span>Plan first</span></button>` : '';
  // Where it writes, its cache, its changes.
  // A job in its own copy: the copy's card under this line names the branch and its stages, so the line doesn't.
  const wt = ws?.kind === 'worktree' && !['merged', 'removed'].includes(ws.stage);
  const where = wt ? ''
    : ws?.kind === 'scratch' ? `<span>${I.folder}Scratch folder</span>${(ws.inner ?? []).map((r) => `<span class="mono" title="${esc(r.branch ?? 'detached')}">${I.branch}${esc(r.name)}</span>`).join('')}`
    : ws?.kind === 'folder' || j.cwd ? `<span title="${esc(j.cwd ?? '')}">${I.folder}${ws?.kind === 'folder' ? 'Project folder' : esc(folderName(j.cwd))}</span>` : '';
  const d = ws?.kind === 'worktree' && (ws.add || ws.del) ? ws : null;
  const changes = j.turns ? `<button type="button" class="jdiffstat num jh-chg" data-open-jobdiff="${esc(j.id)}~0">${d ? statHTML(d.add, d.del) : '<span>Changes</span>'}${AOS.CHEV}</button>` : '';
  const lastCold = j.cache?.last ? (j.cache.last.cold ? 'last turn cache was cold' : 'last turn cache was warm') : '';
  const use = u && u.input + u.output > 0 ? [`${kNum(u.input)} in`, `${kNum(u.output)} out`, u.contextPct != null ? `context ${u.contextPct}%` : '', lastCold].filter(Boolean).join(' · ') : '';
  const ship = j.ship ? `<p class="jh-ship">${shipHTML(j)}${j.ship.note ? `<span>${esc(j.ship.note)}</span>` : ''}${j.ship.commit ? `<span class="mono">${esc(j.ship.commit)}</span>` : ''}${j.ship.builderJob ? `<button class="text-btn" data-open-job="${esc(j.ship.builderJob)}">Builder</button>` : ''}</p>` : '';
  const why = ws?.wanted && ws.why ? `<p class="jh-why">Asked for its own copy: ${esc(ws.why)}</p>` : '';
  $('.job-hero', S.box).innerHTML = `<div class="jhero">${top}
<h1 class="t1 jh-title">${j.role === 'builder' ? '<span class="jh-role">Builder</span>' : ''}${esc(j.title || 'Job')}</h1>
<div class="jh-pills">${model}${effort}${perm}${plan}</div>
${j.driver && live ? `<p class="cap jh-modenote">${esc(JOB_MODE_NOTE[mode] ?? '')}</p>` : ''}
<div class="jh-meta">${p ? `<button type="button" class="jh-proj" data-project="${esc(p.slug)}">${esc(p.name)}</button>` : ''}${where}${cacheHTML(j)}${changes}</div>
${wt ? wsCardHTML(j, { counts: !(j.turns && d) }) : ''}
${use ? `<p class="cap jh-use num">${esc(use)}</p>` : ''}
${ship}${why}
${tasks.length || idea ? `<div class="jh-items">${tasks.map((t) => `<button class="js-item" data-open-task="${esc(t.id)}" style="--c:${AOS.color(t.area)}"><i></i><span>${esc(t.title)}</span><em>${t.status === 'done' ? 'Done' : 'Task'}</em></button>`).join('')}${idea ? `<div class="js-item idea"><i></i><span>${esc(idea.title)}</span><em>Idea</em></div>` : ''}</div>` : ''}
${j.status === 'done' && j.summary ? `<div class="jh-summary">${md(j.summary)}</div>` : ''}
${S.finishing ? finishHTML(S) : ''}</div>`;
  tail(S);
  strip(S);
  syncComposer(S);
}

// ---------- Progress (CONTRACT §4): the strip above the composer, and the full step list in a sheet ----------
// The composer's first line, while the job has a plan: its ring, the figure and the step in hand; tap for the plan.
function strip(S) {
  const b = S.el.querySelector('.jp-strip');
  if (!b) return;
  const p = S.job?.progress;
  const pr = progOf(p);
  b.hidden = !pr;
  if (pr) {
    const html = `${AOS.ring(Math.min(1, pr.done / pr.total), 'jobs', 26, 3.5, { cls: S.job.status === 'running' ? 'running' : '' })}<b class="met c-jobs">${pr.done}<small>/${pr.total}</small></b><span class="cap">${esc(pr.state === 'done' ? 'All done' : pr.active ?? '')}</span>${AOS.CHEV}`;
    if (b._html !== html) { b.innerHTML = html; b._html = html; }
    b.className = `jp-strip s-${p.state}`;
    b.setAttribute('aria-label', progLabel(p));
  }
  if (progS === S) drawProg();
}
const progEl = sheetEl('jobProgSheet', 'Progress', 'prog-sheet');
const progSheet = AOS.makeSheet(progEl, { detents: (H) => ({ large: 0, half: Math.round(H * 0.4) }), scrimFor });
let progS = null;
function openProg(S) {
  if (!hasProgress(S.job?.progress)) return;
  progS = S;
  drawProg();
  AOS.haptic('selection');
  const n = (S.job.progress.stages ?? []).reduce((a, s) => a + (s.steps?.length ?? 0) + 2, 0);
  progSheet.open(n > 9 ? 'large' : 'half');
  // Bring the active step into view.
  requestAnimationFrame(() => $('.pl-r.s-active', progEl)?.scrollIntoView({ block: 'center' }));
}
progEl.addEventListener('click', (e) => { if (e.target.closest('[data-sheet-close]')) progSheet.close(); });
function drawProg() {
  const p = progS?.job?.progress;
  if (!p) { if (progSheet.isOpen) progSheet.close(); return; }
  const head = progHeadHTML(p), body = progListHTML(p);
  const h = $('.sheet-head', progEl), bd = $('.sheet-body', progEl);
  if (h._html !== head) { h.innerHTML = head; h._html = head; }
  if (bd._html !== body) { bd.innerHTML = body; bd._html = body; }
}
function finishHTML(S) {
  const n = (S.job.taskIds ?? []).filter((t) => AOS.taskById(t)?.status !== 'done').length;
  return `<div class="jh-finish"><p>Mark this job done${n ? ` and its ${AOS.plural(n, 'task')}` : ''}? The session stops.</p><div class="chips">${n ? '<button class="chip-btn on" data-job-act="done-tasks">Done, tasks too</button><button class="chip-btn" data-job-act="done-only">Job only</button>' : '<button class="chip-btn on" data-job-act="done-only">Done</button>'}<button class="chip-btn" data-job-act="done-cancel">Not yet</button></div></div>`;
}
function tail(S) {
  const j = S.job;
  const el = $('.job-tail', S.box);
  if (!el) return;
  // A plan-mode job that stopped after writing its plan (Codex does): offer to run it.
  const evs = [...S.events.values()].sort((a, b) => a.seq - b.seq);
  const lastUser = evs.filter((e) => e.type === 'user').at(-1)?.seq ?? 0;
  const planReady = j?.plan && j.status === 'idle' && !j.pending && evs.some((e) => e.type === 'plan' && e.text && e.seq > lastUser);
  // The running Working group carries its own spinner; this line covers the gap before its first step.
  el.innerHTML = !j ? '' : isActive(j) && j.status !== 'needs_input'
    ? S.groupLive && j.status !== 'starting' ? '' : `<p class="je-live"><span class="spin" style="--c:var(--jobs)" aria-hidden="true"></span><span>${j.status === 'starting' ? 'Starting the session' : 'Working'}</span></p>`
    : j.status === 'failed' && j.error ? `<div class="je je-error">${md(j.error)}</div>`
    : planReady ? '<div class="jh-runplan"><button class="act primary wide" data-run-plan>Approve plan and start</button></div>' : '';
}
const queuedLabel = (text) => {
  const u = attach.splitAttached(text);
  return `${u.files.length ? `📎 ${u.files.length} ` : ''}${u.text.replace(/\s+/g, ' ').slice(0, 140)}`;
};
function syncComposer(S) {
  const comp = S.el.querySelector('.job-composer');
  if (!comp) return;
  const ta = comp.querySelector('textarea');
  const send = comp.querySelector('.jc-send');
  const running = S.job && S.job.status === 'running';
  const empty = !ta.value.trim() && !attach.has(`job-${S.id}`);
  send.classList.toggle('stop', running && empty);
  send.toggleAttribute('data-cancel-turn', running && empty);
  send.type = running && empty ? 'button' : 'submit';
  send.setAttribute('aria-label', running && empty ? 'Stop this turn' : running ? 'Queue after this turn' : 'Send');
  send.disabled = !running && empty;
  comp.hidden = S.job?.status === 'done';
  const busy = S.job && ['running', 'starting', 'needs_input'].includes(S.job.status);
  const ph = busy ? 'Steer, or queue a message' : `Message ${S.job ? engineName(S.job) : 'the job'}`;
  if (ta.placeholder !== ph) ta.placeholder = ph;
  // Messages waiting for the turn to end: tap one to steer it in, edit or remove it.
  const q = S.job?.queue ?? [];
  const box = comp.querySelector('.jc-queue');
  const html = q.map((m) => `<div class="jcq-item"><button type="button" class="jcq-open" data-queued="${esc(m.id)}" aria-label="Steer, edit or remove"><span class="pill plain jcq-k">${I.clock}Queued</span><span class="jcq-text">${esc(queuedLabel(m.text))}</span></button><button type="button" class="jcq-x" data-unqueue="${esc(m.id)}" aria-label="Remove from the queue">${I.x}</button></div>`).join('');
  if (box._html !== html) { box.innerHTML = html; box._html = html; }
  box.hidden = !q.length;
  // Where it works (its own copy or the folder itself), unless the plan line has the place; then keep-warm.
  const j = S.job;
  const ws = j ? wsOf(j) : null;
  const copy = ws?.kind === 'worktree' && ws.stage !== 'merged' && ws.stage !== 'removed' ? ws : null;
  const whereEl = comp.querySelector('.jc-where');
  const where = !j || j.role === 'builder' ? '' : copy ? `${I.branch}<span class="mono">${esc(String(copy.branch ?? '').replace(/^aos\//, ''))}</span>`
    : ws?.kind === 'scratch' ? `${I.folder}<span>Scratch folder</span>` : ws?.kind === 'folder' || j.git ? `${I.folder}<span>Project folder</span>` : '';
  if (whereEl._html !== where) { whereEl.innerHTML = where; whereEl._html = where; }
  whereEl.hidden = !where || !!progOf(j?.progress);
  const meta = comp.querySelector('.jc-meta');
  const kwUntil = j?.cache?.keepWarmUntil ? Date.parse(j.cache.keepWarmUntil) : 0;
  const kwLeft = kwUntil > Date.now() ? Math.round((kwUntil - Date.now()) / 60000) : 0;
  const mhtml = !j || j.role === 'builder' || !j.cache || j.cache.state === 'none' ? ''
    : `<button type="button" class="pill plain jc-warm${kwLeft ? ' on' : ''}" data-keep-warm="${kwLeft ? 'off' : 'on'}" aria-pressed="${!!kwLeft}">${I.flame}${kwLeft ? `Warm · ${kwLeft >= 60 ? `${Math.floor(kwLeft / 60)} h ${kwLeft % 60} m` : `${kwLeft} m`}` : 'Keep warm'}</button>`;
  if (meta._html !== mhtml) { meta.innerHTML = mhtml; meta._html = mhtml; }
  meta.hidden = !mhtml;
  comp.querySelector('.jcm-top').hidden = whereEl.hidden && meta.hidden && comp.querySelector('.jp-strip').hidden;
}
async function keepWarm(S, on) {
  try {
    const r = await AOS.api(`/jobs/${S.id}/board`, { method: 'POST', body: JSON.stringify({ keepWarm: on ? true : 0 }) });
    if (r.job) setJob(S, r.job);
    AOS.haptic('selection');
    AOS.toast(on ? 'Keeping this chat warm. Hold it on the board to change how long' : 'Keep-warm off for this chat');
  } catch (e) { AOS.toast(e.status ? e.message : 'Your PC isn’t reachable right now'); }
}
async function unqueue(S, qid) {
  try { const r = await AOS.api(`/jobs/${S.id}/queue`, { method: 'POST', body: JSON.stringify({ remove: qid }) }); if (r.job) setJob(S, r.job); AOS.haptic('light'); }
  catch (e) { AOS.toast(e.status ? e.message : 'Your PC isn’t reachable right now'); }
}
// ---------- Holds in the chat: a peek with the message and what you can do with it ----------
/** AOS.peek, with the destructive items in red. */
function peekMenu(body, menu) {
  const items = menu.filter(Boolean);
  AOS.peek(`<div class="pk jpk">${body}</div>`, items);
  const w = document.getElementById('peek');
  items.forEach((m, i) => { if (m.danger) w?.querySelector(`[data-peek-i="${i}"]`)?.classList.add('danger'); });
}
// Hold Send: steer it into the running turn, queue it after, or interrupt and send now.
function sendMenu(S, ta) {
  const busy = S.job && ['running', 'starting', 'needs_input'].includes(S.job.status);
  peekMenu(`<div class="kicker">Send</div><p class="sub pk-msg">${esc(ta.value.trim().slice(0, 600))}</p>${busy ? '<p class="foot pk-note">Steer now: it reads this at its next step, without stopping. Queue: it goes when this turn ends.</p>' : ''}`, busy
    ? [{ label: 'Steer now', icon: I.bolt, run: () => send(S, ta, { steer: true }) }, { label: 'Queue after this turn', icon: I.clock, run: () => send(S, ta) }, { label: 'Interrupt and send now', icon: I.stop, danger: true, run: () => send(S, ta, { interrupt: true }) }]
    : [{ label: 'Send now', icon: I.up, run: () => send(S, ta) }]);
}
// A queued message: steer it in now, edit it, or drop it.
function queuedMenu(S, qid) {
  const m = (S.job?.queue ?? []).find((x) => x.id === qid);
  if (!m) return;
  const steer = async () => {
    try { const r = await AOS.api(`/jobs/${S.id}/queue`, { method: 'POST', body: JSON.stringify({ steer: qid }) }); if (r.job) setJob(S, r.job); AOS.toast('Steered in'); }
    catch (er) { AOS.toast(er.status ? er.message : 'Your PC isn’t reachable right now'); }
  };
  const edit = () => {
    const ta = S.el.querySelector('.job-composer textarea');
    if (ta) { ta.value = m.text; ta.dispatchEvent(new Event('input')); ta.focus(); unqueue(S, qid); }
  };
  peekMenu(`<div class="kicker">Queued message</div><p class="sub pk-msg">${esc(queuedLabel(m.text).slice(0, 600))}</p><p class="foot pk-note">It goes when this turn ends. Steer it in to have it read at the next step.</p>`,
    [{ label: 'Steer now', icon: I.bolt, run: steer }, { label: 'Edit', icon: I.edit, run: edit }, { label: 'Remove', icon: I.trash, danger: true, run: () => unqueue(S, qid) }]);
}

// ---------- Turns and Working groups (CONTRACT §3) ----------
// Each turn is a <section>: the user message, one collapsible "Working" group (tools, thoughts, status lines,
// checklists, auto-decided permissions, every assistant text but the last), then what stays outside (the answer,
// open permissions and questions, written plans, changed files, errors). One DOM node per event, kept in
// S.nodes; an update re-renders only that event's node and then re-places the nodes of its turn.
const OPENS = new Map();   // job id → { groups: Map<turn key, open>, rows: Set<seq> }: the user's open/closed choices
const opensOf = (id) => OPENS.get(id) ?? OPENS.set(id, { groups: new Map(), rows: new Set() }).get(id);
const tpl = document.createElement('template');
const GROUP_CHEV = '<svg class="jw-chev" viewBox="0 0 14 14" aria-hidden="true"><path d="M3.5 5.5 7 9l3.5-3.5"/></svg>';

function insertSorted(arr, v) {
  let i = arr.length;
  while (i > 0 && arr[i - 1] > v) i--;
  if (arr[i - 1] !== v) arr.splice(i, 0, v);
}
/** The turn an event belongs to: the seq of the user message before it (0 before the first one). */
function keyOf(S, seq) {
  let k = 0;
  for (const u of S.userSeqs) { if (u <= seq) k = u; else break; }
  return k;
}
function reindex(S) {
  S.userSeqs = [...S.events.values()].filter((e) => e.type === 'user').map((e) => e.seq).sort((a, b) => a - b);
  S.byTurn = new Map();
  for (const seq of [...S.events.keys()].sort((a, b) => a - b)) {
    const k = keyOf(S, seq);
    (S.byTurn.get(k) ?? S.byTurn.set(k, []).get(k)).push(seq);
  }
}
/** Store an event and (re)build its node. Returns its turn key, or null when every turn has to be laid out again. */
function ingest(S, ev) {
  const isNew = !S.events.has(ev.seq);
  S.events.set(ev.seq, ev);
  render(S, ev);
  if (!isNew) return keyOf(S, ev.seq);
  const late = ev.seq < S.lastSeq;
  S.lastSeq = Math.max(S.lastSeq, ev.seq);
  if (ev.type === 'user' && late) { reindex(S); return null; }   // a turn start arrived late: regroup everything
  if (ev.type === 'user') insertSorted(S.userSeqs, ev.seq);
  const k = keyOf(S, ev.seq);
  insertSorted(S.byTurn.get(k) ?? S.byTurn.set(k, []).get(k), ev.seq);
  return k;
}
function render(S, ev) {
  const html = eventHTML(ev, S);
  const old = S.nodes.get(ev.seq);
  if (old && old._html === html) return;
  // Don't pull an open form out from under the cursor while you type in it.
  if (old && ev.type === 'permission' && !ev.permission?.decided && old.contains(document.activeElement)) return;
  let n = null;
  if (html) {
    tpl.innerHTML = html;
    n = tpl.content.firstElementChild;
    n._html = html;
    if (n.tagName === 'DETAILS' && (old ? old.open : opensOf(S.id).rows.has(ev.seq))) n.open = true;
  }
  if (old) { if (n) old.replaceWith(n); else old.remove(); }
  if (n) S.nodes.set(ev.seq, n); else S.nodes.delete(ev.seq);
}

/** Inside the group, or outside it. `answer` = the seq of the assistant text that stays outside. */
function placeOf(e, answer) {
  switch (e.type) {
    case 'user': return 'user';
    case 'assistant': return e.seq === answer ? 'out' : 'group';
    case 'tool': case 'thought': case 'status': return 'group';
    case 'plan': return e.text ? 'out' : 'group';
    case 'permission': {
      const p = e.permission ?? {};
      // Open ones, and the questions and plans you answered, stay in view; auto-decided ones fold away.
      return !p.decided || p.form || p.kind === 'question' || p.kind === 'plan' ? 'out' : 'group';
    }
    default: return 'out';
  }
}
const fmtDur = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
function groupHead(S, evs, items, running) {
  const tools = items.filter((e) => e.type === 'tool');
  const n = tools.length || items.length;
  const steps = `${n} ${n === 1 ? 'step' : 'steps'}`;
  if (running) {
    // A live group names its current step only while folded; open, the step is its last row.
    const needs = S.job?.status === 'needs_input';
    const last = items.at(-1);
    const t = tools.at(-1)?.tool;
    const now = t?.title ? toolText(t.kind, t.title) : esc(S.job?.progress?.active || (last?.type === 'thought' ? 'Thinking' : ''));
    return `<span class="jw-ico ${needs ? 'needs' : 'spin'}" style="--c:var(--jobs)" aria-hidden="true"></span><span class="jw-label">${needs ? 'Needs you' : 'Working'}</span><span class="jw-n cap">${steps}</span><span class="jw-now cap">${now}</span>${GROUP_CHEV}`;
  }
  // Time from the user message to the turn's last event (status notes like "Model: …" don't count).
  const start = Date.parse(evs.find((e) => e.type === 'user')?.at ?? evs[0]?.at);
  const end = Math.max(...evs.filter((e) => !(e.type === 'status' && e.text)).map((e) => Date.parse(e.at)).filter(Number.isFinite));
  const dur = Number.isFinite(start) && Number.isFinite(end) && end > start ? ` for ${fmtDur(end - start)}` : '';
  return `<span class="w-ic" aria-hidden="true">${I.check}</span><span class="jw-label">Worked${dur}</span><span class="jw-cnt cap">${steps}</span>${GROUP_CHEV}`;
}
/** Move `nodes` into `parent` in this order, touching the DOM only where it differs. */
function reconcile(parent, nodes) {
  let cur = parent.firstChild;
  for (const n of nodes) { if (n === cur) cur = cur.nextSibling; else parent.insertBefore(n, cur); }
  while (cur) { const next = cur.nextSibling; cur.remove(); cur = next; }
}
function sectionFor(S, list, key) {
  let sec = S.sections.get(key);
  if (!sec) {
    sec = document.createElement('section');
    sec.className = 'jturn';
    sec.dataset.turn = key;
    const open = opensOf(S.id).groups.get(key) ?? false;
    sec._group = Object.assign(document.createElement('details'), { className: 'jw', open });
    sec._group.dataset.wg = key;
    sec._group.innerHTML = '<summary class="jw-head"></summary><div class="jw-body"></div>';
    S.sections.set(key, sec);
  }
  if (!sec.isConnected) {
    const next = [...list.children].find((c) => +c.dataset.turn > key);
    list.insertBefore(sec, next ?? null);
  }
  return sec;
}
function layoutTurn(S, key) {
  const list = $('.job-events', S.box);
  if (!list) return;
  const evs = (S.byTurn.get(key) ?? []).map((s) => S.events.get(s));
  const lastKey = S.userSeqs.at(-1) ?? 0;
  const running = key === lastKey && isActive(S.job);
  const texts = evs.filter((e) => e.type === 'assistant' && String(e.text ?? '').trim());
  let answer = texts.at(-1)?.seq ?? -1;
  // While the turn runs, the newest text is the answer so far until a tool call follows it.
  if (running && evs.some((e) => e.seq > answer && (e.type === 'tool' || e.type === 'thought'))) answer = -1;
  const sec = sectionFor(S, list, key);
  // A keep-warm ping folds to one line; turns he rewound away stay visible but dimmed.
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
    else if (where === 'group') { inside.push(n); items.push(e); } else out.push(n);
  }
  reconcile(sec, [...top, g, ...out]);
  reconcile(g.lastElementChild, inside);
  g.hidden = !inside.length;
  g.classList.toggle('live', running);
  const head = groupHead(S, evs, items, running);
  if (g.firstElementChild._html !== head) { g.firstElementChild.innerHTML = head; g.firstElementChild._html = head; }
  if (key === lastKey) {
    const shown = running && !!inside.length;
    if (shown !== S.groupLive) { S.groupLive = shown; tail(S); }
  }
}
function layoutAll(S) {
  const keys = [...S.byTurn.keys()].sort((a, b) => a - b);
  for (const [k, sec] of S.sections) if (!S.byTurn.has(k)) { sec.remove(); S.sections.delete(k); }
  for (const k of keys) layoutTurn(S, k);
}
const nearBottom = (S) => { const sc = S.el.querySelector('.scroller'); return sc ? sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120 : true; };
const toBottom = (S) => { const sc = S.el.querySelector('.scroller'); if (sc) requestAnimationFrame(() => { sc.scrollTop = sc.scrollHeight; }); };

function put(S, ev) {
  if (!$('.job-events', S.box)) return;
  const atBottom = nearBottom(S);
  const k = ingest(S, ev);
  if (k === null) layoutAll(S); else layoutTurn(S, k);
  if (atBottom) toBottom(S);
  if (ev.type === 'plan' || ev.type === 'user') tail(S);
}
function setJob(S, job) {
  const before = S.job?.status;
  const atBottom = nearBottom(S);
  S.job = { ...(S.job ?? {}), ...job };
  putJob(S.job);
  hero(S);
  // Permission cards depend on job.pending, and the group headers on the status: redraw what changed.
  for (const ev of S.events.values()) if (ev.type === 'permission') render(S, ev);
  layoutAll(S);
  if (atBottom) toBottom(S);
  if (before && before !== S.job.status && S.job.status === 'needs_input') AOS.haptic('medium');
}

async function load(S) {
  try {
    const r = await AOS.api(`/jobs/${S.id}`);
    $('.job-events', S.box).innerHTML = '';
    Object.assign(S, { events: new Map(), nodes: new Map(), sections: new Map(), userSeqs: [], byTurn: new Map(), lastSeq: -1 });
    for (const ev of r.events ?? []) { S.events.set(ev.seq, ev); S.lastSeq = Math.max(S.lastSeq, ev.seq); }
    reindex(S);
    S.job = { ...(S.job ?? {}), ...r.job };
    for (const ev of S.events.values()) render(S, ev);
    setJob(S, r.job);
    toBottom(S);
  } catch (e) {
    if (!S.job) { $('.job-hero', S.box).innerHTML = `<p class="quiet">${esc(e.status === 404 ? 'This job doesn’t exist on your PC.' : 'Your PC isn’t reachable right now.')}</p>`; }
  }
  follow(S);
}
async function follow(S) {
  while (S.alive) {
    S.ctrl = new AbortController();
    try {
      await stream(`/jobs/${S.id}/stream?after=${S.lastSeq}`, (type, d) => {
        S.retry = 0;
        if (type === 'job') setJob(S, d);
        else if (type === 'ev') put(S, d);
      }, S.ctrl.signal);
    } catch (e) {
      if (!S.alive) return;
      if (e.status === 404) return;
    }
    if (!S.alive) return;
    // Reconnect: fast while the job works, slower when it's idle or finished.
    S.retry++;
    const live = S.job && isLive(S.job);
    await new Promise((r) => setTimeout(r, live ? Math.min(1000 * S.retry, 5000) : Math.min(5000 * S.retry, 30000)));
    if (!live && S.retry > 1 && S.alive) {
      // Finished jobs: one cheap poll instead of holding a stream open.
      try { const r = await AOS.api(`/jobs/${S.id}`); setJob(S, r.job); for (const ev of r.events ?? []) if (ev.seq > S.lastSeq || !S.events.has(ev.seq)) put(S, ev); } catch {}
    }
  }
}

async function send(S, ta, { interrupt = false, steer = false } = {}) {
  const text = ta.value.trim();
  const key = `job-${S.id}`;
  if (!text && !attach.has(key)) return;
  if (voice.busy(ta)) { AOS.toast('Finish the recording first'); return; }
  if (attach.uploading(key)) { AOS.toast('Wait for the attachments to finish uploading'); return; }
  const files = attach.ids(key);
  if (!text && !files.length) { AOS.toast('The attachments didn’t upload: remove them and try again'); return; }
  ta.value = '';
  ta.style.height = '';
  syncComposer(S);
  AOS.haptic('light');
  const busy = S.job && ['running', 'starting', 'needs_input'].includes(S.job.status);
  try {
    // While it works the message waits in the queue; a cold cache asks first.
    const before = S.job?.queue?.length ?? 0;
    const r = await postCold(`/jobs/${S.id}/prompt`, { text, queue: true, ...(files.length ? { attachments: files } : {}), ...(interrupt ? { interrupt: true } : {}), ...(steer ? { steer: true } : {}) });
    if (!r) { ta.value = text; syncComposer(S); return; }
    attach.clear(key);
    if (r.job) setJob(S, r.job);
    else setJob(S, { status: 'running' });
    if (busy && !interrupt && (r.job?.queue?.length ?? 0) > before) AOS.toast(steer ? 'It can’t take it mid-turn, so it’s queued' : 'Queued: tap it to steer it in now');
    else if (steer) AOS.toast('Steered in: it reads it at its next step');
  } catch (e) {
    ta.value = text;
    syncComposer(S);
    AOS.toast(e.status ? e.message : 'Your PC isn’t reachable right now');
  }
}
/** The ⋯ menu's Rewind the last turn: the rewind choices for his last message in a turn that wasn't rewound away. */
function rewindLast(S) {
  const dropped = (seq) => (S.job?.dropped ?? []).some(([a, b]) => seq >= a && seq <= b);
  const ev = [...S.events.values()].filter((e) => e.type === 'user' && e.turn && !e.steer && !dropped(e.seq)).sort((a, b) => b.seq - a.seq)[0];
  if (!ev) { AOS.toast('Nothing to rewind yet'); return; }
  if (S.job && ['running', 'starting', 'needs_input'].includes(S.job.status)) { AOS.toast('Stop the turn first to rewind'); return; }
  MS = { S, ev, turn: ev.turn, step: 'menu' };
  rewindChoices(S, false);
  msgSheet.open('half');
}
async function act(S, what) {
  if (what === 'menu') { if (S.job) openMenu(S.job, { done: () => act(S, 'done'), rewind: () => rewindLast(S) }); return; }
  if (what === 'done') { S.finishing = true; hero(S); S.el.querySelector('.scroller')?.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  if (what === 'done-cancel') { S.finishing = false; hero(S); return; }
  const call = what === 'done-tasks' || what === 'done-only' ? ['done', { completeTasks: what === 'done-tasks' }] : [what, {}];
  try {
    const r = await AOS.api(`/jobs/${S.id}/${call[0]}`, { method: 'POST', body: JSON.stringify(call[1]) });
    S.finishing = false;
    if (r.job) setJob(S, r.job);
    if (call[0] === 'done') {
      AOS.haptic('success');
      if (call[1].completeTasks) for (const id of S.job.taskIds ?? []) { const t = AOS.taskById(id); if (t && t.status !== 'done') AOS.adopt('task', { id, status: 'done', completedAt: new Date().toISOString() }); }
      AOS.render();
      AOS.toast(call[1].completeTasks ? 'Job and its tasks are done' : 'Job done');
    } else if (call[0] === 'stop') AOS.toast('Session stopped. Send a message to resume it');
    else if (call[0] === 'cancel') AOS.toast('Stopped this turn');
    if (!r.job) { const j = await AOS.api(`/jobs/${S.id}`); setJob(S, j.job); }
  } catch (e) { AOS.toast(e.status ? e.message : 'Your PC isn’t reachable right now'); }
}

// Clicks inside job pages: permissions, tasks, project link, finish options.
document.addEventListener('click', async (e) => {
  const page = e.target.closest('.page.detail[data-kind="job"]');
  if (!page) return;
  const S = [...pages].find((x) => x.el === page);
  if (!S) return;
  const opt = e.target.closest('[data-jq]');
  if (opt) {
    const card = opt.closest('.je-form');
    const p = S.events.get(+card.dataset.seq)?.permission;
    if (!p?.form || p.decided) return;
    const f = formState(S, p);
    const [i, j] = opt.dataset.jq.split(':').map(Number);
    if (p.form[i].multiSelect) { if (f.sel[i].has(j)) f.sel[i].delete(j); else f.sel[i].add(j); }
    else { f.sel[i] = new Set(f.sel[i].has(j) ? [] : [j]); f.other[i] = ''; }
    AOS.haptic('selection');
    syncForm(card, p, f);
    return;
  }
  const fsend = e.target.closest('[data-form-send]');
  if (fsend) {
    const card = fsend.closest('.je-form');
    const p = S.events.get(+card.dataset.seq)?.permission;
    if (!p?.form || p.decided) return;
    const f = formState(S, p);
    if (!formReady(p, f)) { AOS.toast('Answer every question first'); return; }
    const btns = [...card.querySelectorAll('.jp-opts button')];
    for (const b of btns) b.disabled = true;
    AOS.haptic('success');
    try {
      const r = await AOS.api(`/jobs/${S.id}/permission`, { method: 'POST', body: JSON.stringify({ requestId: p.requestId, optionId: 'submit', answers: formAnswers(p, f) }) });
      if (r.job) setJob(S, r.job); else setJob(S, { pending: null, status: 'running' });
    } catch (err) { syncForm(card, p, f); btns.at(-1).disabled = false; AOS.toast(err.status ? err.message : 'Your PC isn’t reachable right now'); }
    return;
  }
  const of = e.target.closest('[data-open-form]');
  if (of) { AOS.haptic('selection'); openForm(S, +of.dataset.openForm); return; }
  const perm = e.target.closest('[data-perm]');
  if (perm) {
    for (const b of perm.parentElement.querySelectorAll('button')) b.disabled = true;
    AOS.haptic('success');
    try {
      const r = await AOS.api(`/jobs/${S.id}/permission`, { method: 'POST', body: JSON.stringify({ requestId: perm.dataset.perm, optionId: perm.dataset.opt }) });
      if (r.job) setJob(S, r.job); else setJob(S, { pending: null, status: 'running' });
    } catch (err) { for (const b of perm.parentElement.querySelectorAll('button')) b.disabled = false; AOS.toast(err.status ? err.message : 'Your PC isn’t reachable right now'); }
    return;
  }
  // Plan first is a toggle pill; the permissions are a picker (the change handler below).
  if (e.target.closest('button[data-job-plan]')) {
    AOS.haptic('selection');
    const body = { plan: !S.job?.plan };
    try { const r = await AOS.api(`/jobs/${S.id}/settings`, { method: 'POST', body: JSON.stringify(body) }); if (r.job) setJob(S, r.job); }
    catch (err) { AOS.toast(err.status ? err.message : 'Your PC isn’t reachable right now'); }
    return;
  }
  if (e.target.closest('[data-run-plan]')) {
    AOS.haptic('success');
    try { const r = await postCold(`/jobs/${S.id}/prompt`, { text: 'The plan is approved. Implement it now.', plan: false }); if (r?.job) setJob(S, r.job); }
    catch (err) { AOS.toast(err.status ? err.message : 'Your PC isn’t reachable right now'); }
    return;
  }
  const fin = e.target.closest('.jh-finish [data-job-act]');
  if (fin) { act(S, fin.dataset.jobAct); return; }
  const tk = e.target.closest('[data-open-task]');
  if (tk) { AOS.openItem(tk.dataset.openTask); return; }
});
// Typing in a question's Other box: a single-choice question drops its picked card.
document.addEventListener('input', (e) => {
  const x = e.target.closest?.('[data-jq-other]');
  if (!x) return;
  const page = x.closest('.page.detail[data-kind="job"]');
  const S = page && [...pages].find((s) => s.el === page);
  const card = x.closest('.je-form');
  const p = S && S.events.get(+card.dataset.seq)?.permission;
  if (!p?.form || p.decided) return;
  const f = formState(S, p);
  const i = +x.dataset.jqOther;
  f.other[i] = x.value;
  if (!p.form[i].multiSelect && x.value.trim()) f.sel[i].clear();
  syncForm(card, p, f);
});
// The header's model and effort pickers: the next turn runs with the new choice. The PC refuses (409) while a turn runs.
document.addEventListener('change', async (e) => {
  const sel = e.target.closest?.('[data-job-model], [data-job-effort], [data-job-mode]');
  if (!sel) return;
  const page = sel.closest('.page.detail[data-kind="job"]');
  const S = page && [...pages].find((s) => s.el === page);
  if (!S) return;
  const key = sel.matches('[data-job-effort]') ? 'effort' : sel.matches('[data-job-mode]') ? 'mode' : 'model';
  const was = S.job?.[key] ?? (key === 'mode' ? 'auto' : '');
  AOS.haptic('selection');
  sel.disabled = true;
  try {
    const r = await AOS.api(`/jobs/${S.id}/settings`, { method: 'POST', body: JSON.stringify({ [key]: sel.value || null }) });
    if (r.job) setJob(S, r.job);
    AOS.toast(key === 'effort' ? `Next turn runs at ${sel.value ? `${effortLabel(sel.value).toLowerCase()} effort` : 'the default effort'}`
      : key === 'mode' ? `${JOB_MODES.find(([v]) => v === sel.value)?.[1] ?? sel.value} for the rest of this job`
      : `Next turn runs on ${sel.value ? modelLabel(sel.value) : 'the default model'}`);
  } catch (err) {
    AOS.toast(err.status === 409 ? `It’s mid-turn. Change the ${key === 'mode' ? 'permissions' : key} when this turn ends.` : err.status ? err.message : 'Your PC isn’t reachable right now');
    sel.value = was;
  } finally { sel.disabled = false; hero(S); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches?.('[data-jq-other]')) { e.preventDefault(); e.target.blur(); } });

// ---------- ask_form: the agent's own HTML form in a panel, with a mic on every text field ----------
function htmlFormCard(ev, p) {
  const at = `data-seq="${ev.seq}"`;
  if (p.decided) {
    const a = Object.entries(p.answers ?? {});
    return `<div class="je je-perm je-form" ${at}><div class="pc-h">${I.chat}<b>${p.decided === 'submit' ? 'Your answers' : p.decided === 'skip' ? 'Skipped' : 'Cancelled'}</b><span class="cap">${esc(p.title)}</span></div>${a.map(([k, v]) => `<div class="jq-done"><p class="jq-q"><span class="jq-text">${esc(k)}</span></p><p class="jq-a">${esc(v)}</p></div>`).join('')}</div>`;
  }
  return `<div class="je je-perm je-form open" ${at}><div class="pc-h">${I.chat}<b>A form for you</b></div><p class="jp-title">${inline(p.title ?? '')}</p><div class="jp-opts"><button type="button" class="btn sm primary" style="--c:var(--needs)" data-open-form="${ev.seq}">Open the form</button><button type="button" class="btn sm" data-perm="${esc(p.requestId)}" data-opt="skip">Skip</button></div></div>`;
}
const BRIDGE = `<script>(()=>{
const MIC='<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
const say=(m)=>parent.postMessage(Object.assign({aos:1},m),'*');
const labelOf=(e)=>((e.labels&&e.labels[0]&&e.labels[0].textContent)||e.placeholder||e.name||'').trim().slice(0,80);
function collect(){const o={};for(const e of document.querySelectorAll('input,select,textarea')){if(!e.name||['submit','button','reset','file'].includes(e.type))continue;if((e.type==='checkbox'||e.type==='radio')&&!e.checked)continue;
if(e.multiple&&e.tagName==='SELECT'){const v=[...e.selectedOptions].map(x=>x.value);if(v.length)o[e.name]=v;continue}
const v=String(e.type==='checkbox'?(e.value==='on'?'yes':e.value):e.value).trim();if(!v)continue;if(e.type==='checkbox')(o[e.name]=o[e.name]||[]).push(v);else o[e.name]=v}return o}
let n=0;function mics(){for(const e of document.querySelectorAll('textarea,input:not([type]),input[type=text],input[type=search],input[type=email],input[type=url]')){if(e.dataset.aosMic)continue;e.dataset.aosMic=String(++n);
const w=document.createElement('span');w.className='aos-wrap';e.parentNode.insertBefore(w,e);w.appendChild(e);const b=document.createElement('button');b.type='button';b.className='aos-mic';b.dataset.for=e.dataset.aosMic;b.setAttribute('aria-label','Dictate');b.innerHTML=MIC;
b.onclick=()=>{e.focus();say({t:'dictate',id:e.dataset.aosMic,label:labelOf(e)})};w.appendChild(b)}}
document.addEventListener('focusin',(ev)=>{const e=ev.target;if(e&&e.dataset&&e.dataset.aosMic)say({t:'focus',id:e.dataset.aosMic,label:labelOf(e)})});
document.addEventListener('submit',(ev)=>{ev.preventDefault();say({t:'answers',data:collect()})},true);
addEventListener('message',(ev)=>{const d=ev.data||{};if(d.aos!==2)return;if(d.t==='collect')say({t:'answers',data:collect()});
if(d.t==='dictated'){const e=document.querySelector('[data-aos-mic="'+d.id+'"]');if(!e)return;const s=e.selectionStart==null?e.value.length:e.selectionStart;const pre=e.value.slice(0,s),post=e.value.slice(s);let ins=d.text;if(pre&&!/\\s$/.test(pre))ins=' '+ins;e.value=pre+ins+post;e.dispatchEvent(new Event('input',{bubbles:true}))}
if(d.t==='mic')for(const b of document.querySelectorAll('.aos-mic'))b.classList.toggle('on',d.on&&b.dataset.for===d.id)});
const st=document.createElement('style');st.textContent='.aos-wrap{position:relative;display:block}.aos-wrap>textarea,.aos-wrap>input{width:100%;box-sizing:border-box;padding-right:48px;min-height:44px}.aos-mic{position:absolute;right:3px;top:3px;width:38px;height:38px;border:0;border-radius:19px;background:#e9e9ee;display:grid;place-items:center;padding:0}.aos-mic svg{width:18px;height:18px;fill:none;stroke:#222;stroke-width:1.8;stroke-linecap:round}.aos-mic.on{background:#e5484d}.aos-mic.on svg{stroke:#fff}';document.head.appendChild(st);
mics();new MutationObserver(mics).observe(document.body,{childList:true,subtree:true});say({t:'ready'});})()</script>`;
const BASE = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:16px/1.45 -apple-system,system-ui,sans-serif;margin:16px;color:#111;background:#fff}input,select,textarea,button{font:inherit}label{display:block;margin:6px 0}textarea,input[type=text]{border:1px solid #ccc;border-radius:10px;padding:10px}</style>';
const formEl = sheetEl('jobFormSheet', 'Form', 'form-sheet');
const formSheet = AOS.makeSheet(formEl, { detents: (H) => ({ large: 0, half: 0 }), scrimFor });
let FM = null;   // { S, p, field: {id, label} | null, frame }
function openForm(S, seq) {
  const p = S.events.get(seq)?.permission;
  if (!p?.html || p.decided) return;
  FM = { S, p, field: null };
  $('.sheet-head', formEl).innerHTML = `<h2>${esc(p.title || 'A form for you')}</h2>`;
  $('.sheet-body', formEl).innerHTML = `<iframe class="fm-frame" sandbox="allow-scripts allow-forms" title="${esc(p.title || 'Form')}"></iframe>
<div class="fm-bar"><div class="rec-slot" data-rec-for="fmProxy"></div><div class="fm-row"><span class="fm-field">Tap a field, then the mic</span>${voice.micButtonHTML('id="fmMic"')}</div><textarea id="fmProxy" class="fm-proxy" tabindex="-1" aria-hidden="true"></textarea>
<div class="fm-acts"><button type="button" class="act primary wide" data-fm="send">Send answers</button><button type="button" class="act wide" data-fm="skip">Skip</button></div></div>`;
  FM.frame = $('.fm-frame', formEl);
  FM.frame.srcdoc = BASE + p.html + BRIDGE;
  formSheet.open('large');
}
function dictate(fieldId) {
  if (!FM) return;
  const field = fieldId ?? FM.field?.id;
  if (!field) { AOS.toast('Tap a field first'); return; }
  const target = $('#fmProxy', formEl);
  const button = $('#fmMic', formEl);
  if (voice.recording(target)) { voice.stop(); return; }
  const tell = (on) => FM?.frame?.contentWindow?.postMessage({ aos: 2, t: 'mic', id: field, on }, '*');
  voice.start({ target, slot: $('.rec-slot', formEl), button, source: 'app', purpose: 'prompt',
    onState: (s) => tell(s === 'recording' || s === 'starting'),
    onText: (text) => { target.value = ''; if (text.trim()) FM?.frame?.contentWindow?.postMessage({ aos: 2, t: 'dictated', id: field, text: text.trim() }, '*'); } });
}
addEventListener('message', async (e) => {
  if (!FM || e.source !== FM.frame?.contentWindow || e.data?.aos !== 1) return;
  const d = e.data;
  if (d.t === 'focus' || d.t === 'dictate') {
    FM.field = { id: d.id, label: d.label };
    const f = $('.fm-field', formEl);
    if (f) f.textContent = d.label ? `Dictate into: ${d.label}` : 'Dictate into this field';
  }
  if (d.t === 'dictate') dictate(d.id);
  if (d.t === 'answers') {
    const { S, p } = FM;
    if (!Object.keys(d.data ?? {}).length) { AOS.toast('Answer at least one question, or skip'); return; }
    try {
      const r = await AOS.api(`/jobs/${S.id}/permission`, { method: 'POST', body: JSON.stringify({ requestId: p.requestId, optionId: 'submit', answers: d.data }) });
      AOS.haptic('success');
      FM = null;
      formSheet.close();
      if (r.job) setJob(S, r.job);
    } catch (er) { AOS.toast(er.status ? er.message : 'Your PC isn’t reachable right now'); }
  }
});
formEl.addEventListener('click', async (e) => {
  if (!FM) return;
  if (e.target.closest('#fmMic')) { e.preventDefault(); dictate(null); return; }
  const a = e.target.closest('[data-fm]')?.dataset.fm;
  if (a === 'send') { if (voice.busy($('#fmProxy', formEl))) { AOS.toast('Wait for the dictation to land'); return; } FM.frame.contentWindow?.postMessage({ aos: 2, t: 'collect' }, '*'); }
  if (a === 'skip') {
    const { S, p } = FM;
    try { const r = await AOS.api(`/jobs/${S.id}/permission`, { method: 'POST', body: JSON.stringify({ requestId: p.requestId, optionId: 'skip' }) }); FM = null; formSheet.close(); if (r.job) setJob(S, r.job); }
    catch (er) { AOS.toast(er.status ? er.message : 'Your PC isn’t reachable right now'); }
  }
});

// ---------- Hold a message: Copy; on your own messages also Edit and Rewind to here ----------
const msgEl = sheetEl('jobMsgSheet', 'Message', 'job-menu');
const msgSheet = AOS.makeSheet(msgEl, { detents: (H) => ({ large: Math.round(H * 0.5), half: Math.round(H * 0.5) }), scrimFor });
let MS = null;
let msgHold = null;
let eatMsgClick = false;
document.addEventListener('pointerdown', (e) => {
  eatMsgClick = false;
  const n = e.target.closest('.job-page .je-user .bubble, .job-page .je-text');
  if (!n || e.button > 0) return;
  const page = n.closest('.page.detail[data-kind="job"]');
  const S = page && [...pages].find((x) => x.el === page);
  const seq = +n.closest('[data-seq]')?.dataset.seq;
  if (!S || !seq) return;
  msgHold = { x: e.clientX, y: e.clientY, t: setTimeout(() => { msgHold = null; eatMsgClick = true; AOS.haptic('medium'); openMsg(S, seq); }, 480) };
});
document.addEventListener('pointermove', (e) => { if (msgHold && Math.hypot(e.clientX - msgHold.x, e.clientY - msgHold.y) > 8) { clearTimeout(msgHold.t); msgHold = null; } }, { passive: true });
for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => { if (msgHold) { clearTimeout(msgHold.t); msgHold = null; } });
document.addEventListener('click', (e) => { if (eatMsgClick) { eatMsgClick = false; e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener('contextmenu', (e) => { if (e.target.closest('.job-page .je-user .bubble, .job-page .je-text') && !matchMedia('(pointer: fine)').matches) e.preventDefault(); });

/** The turn an event belongs to: its own (user messages) or the one of the message before it. */
function turnOf(S, seq) {
  const evs = [...S.events.values()].filter((e) => e.type === 'user' && e.turn && !e.steer && e.seq <= seq).sort((a, b) => b.seq - a.seq);
  return evs[0]?.turn ?? null;
}
/** Hold a message: a peek with it and Copy; on his own messages also Edit and resend and Rewind to here; Fork. */
function openMsg(S, seq) {
  const ev = S.events.get(seq);
  if (!ev) return;
  // Rewind and edit need his own message in a turn that wasn't rewound away already; fork works from any message.
  const dropped = (S.job?.dropped ?? []).some(([a, b]) => seq >= a && seq <= b);
  const mine = ev.type === 'user' && ev.turn && !ev.steer && !dropped;
  const busy = S.job && ['running', 'starting', 'needs_input'].includes(S.job.status);
  const turn = turnOf(S, seq);
  MS = { S, ev, turn, step: 'menu' };
  const later = () => AOS.toast('Stop the turn first to edit or rewind');
  const choose = (edit) => () => { if (busy) { later(); return; } rewindChoices(S, edit); msgSheet.open('half'); };
  peekMenu(`<div class="kicker">${ev.type === 'user' ? 'Your message' : esc(S.job ? engineName(S.job) : 'Reply')}</div><p class="sub pk-msg">${esc(String(ev.text ?? '').slice(0, 900))}</p>`, [
    { label: 'Copy', icon: I.copy, run: async () => AOS.toast((await copyText(String(ev.text ?? ''))) ? 'Copied' : 'Couldn’t copy') },
    mine ? { label: 'Edit and resend', icon: I.edit, run: choose(true) } : null,
    mine ? { label: 'Rewind to here…', icon: I.rewind, run: choose(false) } : null,
    S.job?.rewind && turn && !dropped ? { label: 'Fork from here', icon: I.fork, run: () => forkAt(S, turn) } : null,
  ]);
}
async function forkAt(S, turn) {
  try {
    const r = await AOS.api(`/jobs/${S.id}/fork`, { method: 'POST', body: JSON.stringify({ turn }) });
    putJob(r.job);
    AOS.haptic('success');
    AOS.toast(`Forked into ${r.job.id}`);
    AOS.push('job', r.job.id);
  } catch (er) { AOS.toast(er.status ? er.message : 'Your PC isn’t reachable right now'); }
}
/** Rewind or edit: what goes back. */
function rewindChoices(S, edit) {
  MS.step = edit ? 'edit' : 'rewind';
  const chat = !!S.job?.rewind;
  const row = (k, t, s) => `<button type="button" class="lrow" data-rw="${k}"><span class="rbody"><span class="rtitle">${t}</span><span class="rmeta wrap">${s}</span></span>${AOS.CHEV}</button>`;
  $('.sheet-head', msgEl).innerHTML = sheetHead(edit ? 'Edit and resend' : 'Rewind to here', 'Pick what goes back to before this message. Nothing after it can be brought back from the phone.');
  $('.sheet-body', msgEl).innerHTML = `<div class="group">${chat ? row('both', 'Code and chat', 'Files as they were, and the chat forgets what came after') + row('chat', 'Chat only', 'The chat forgets; files keep their changes') : ''}${row('code', 'Code only', `Files as they were; the chat ${chat ? 'keeps going' : 'remembers, and is told the work is undone'}`)}</div>`;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const t = Object.assign(document.createElement('textarea'), { value: text });
  t.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  t.remove();
  return ok;
}
msgEl.addEventListener('click', async (e) => {
  if (e.target.closest('[data-sheet-close]')) { msgSheet.close(); return; }
  if (!MS) return;
  const { S, ev } = MS;
  const mode = e.target.closest('[data-rw]')?.dataset.rw;
  if (!mode) return;
  msgSheet.close();
  if (mode === 'cancel') return;
  const edit = MS.step === 'edit';
  try {
    const r = await AOS.api(`/jobs/${S.id}/rewind`, { method: 'POST', body: JSON.stringify({ turn: ev.turn, mode }) });
    if (r.job) setJob(S, r.job);
    AOS.haptic('success');
    if (edit) {
      const ta = S.el.querySelector('.job-composer textarea');
      if (ta) { ta.value = r.text || ev.text || ''; ta.dispatchEvent(new Event('input')); ta.focus(); }
      AOS.toast('Rewound. Edit the message and send it');
    } else AOS.toast(r.files ? `Rewound: ${r.files.restored} files restored, ${r.files.removed} removed` : 'Rewound');
  } catch (er) { AOS.toast(er.status ? er.message : 'Your PC isn’t reachable right now'); }
});

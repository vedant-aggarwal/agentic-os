// Job cards and rows (area (b), app/ui/STRUCTURE.md), shared by the board, a project's page, a task's sheet and the
// hold peek. Every lane reads the same way: the title, who and when, then the one line that matters in that lane (the
// ask, the progress, the diff, the error), then the latest output. Live work is a card; paused and finished work is a
// 44px row. A live job with steps wears its progress ring, the Jobs colour; orange is only for what waits on you.
// Board rows keep .job-row and data-open-job: board.js swipes, holds and drags them, projects.js opens them.
import { isActive, laneOf, ENGINE, JOB_LABEL } from './state.js';
import { progOf } from './progress.js';
import { wsOf } from './workspace.js';

const { AOS } = window;
const { esc } = AOS;
const I = AOS.icons;

// ---------- Small words ----------
/** "now", "3m", "5h", "2d", then the date. */
export function agoShort(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
/** "now", "3m ago", "12 Oct". */
export const agoText = (iso) => { const a = agoShort(iso); return !a || a === 'now' || /\s/.test(a) ? a : `${a} ago`; };
export const engineName = (j) => ENGINE[j?.engine] ?? j?.engine ?? 'Agent';
/** One line of what the agent said last, without its markdown. */
export function plainLine(text, n = 200) {
  return String(text ?? '').replace(/```[\s\S]*?```/g, ' ').replace(/\*\*|__|`/g, '').replace(/^#+\s*/gm, '').replace(/^\s*[-*]\s+/gm, '').replace(/\s+/g, ' ').trim().slice(0, n);
}
/** Paths and commands in backticks read as code; the rest is a sentence. */
export const codeText = (s) => esc(s).replace(/`([^`]+)`/g, '<span class="mono">$1</span>');
const lastOf = (j) => (j.status === 'failed' ? j.error : j.lastText || j.summary) || '';

// ---------- Ship: the status word a job carries once its work goes to a Builder ----------
export const SHIP_LABEL = { none: 'Not shipped', queued: 'Queued to ship', sent: 'With the Builder', committed: 'Committed', building: 'Building', live: 'Live', failed: 'Ship failed' };
const SHIP_C = { none: 'var(--ink-3)', live: 'var(--done)', failed: 'var(--fail-ink)' };
export function shipOf(j) {
  if (!j || j.role === 'builder') return null;
  if (j.ship) return j.ship.state;
  // Finished work that changed files in a repo but was never handed to a Builder.
  return !isActive(j) && j.files > 0 && j.git === true ? 'none' : null;
}
/** A static dot and the word: ink while it travels, green when it is live, red when it failed. */
export const shipHTML = (j, state = shipOf(j)) => (state ? `<span class="jship-st" style="--c:${SHIP_C[state] ?? 'var(--ink)'}"><i class="dot"></i>${esc(SHIP_LABEL[state] ?? state)}</span>` : '');

// ---------- Cache: minutes left on the prompt cache; a flame while keep-warm holds it ----------
export function cacheLeft(j) {
  const c = j?.cache;
  if (!c || c.state === 'none' || !c.warmUntil || laneOf(j) === 'archived') return null;
  return Math.round((Date.parse(c.warmUntil) - Date.now()) / 60000);
}
export const keptWarm = (j) => !!j?.cache?.keepWarmUntil && Date.parse(j.cache.keepWarmUntil) > Date.now();
export function cacheHTML(j) {
  const left = cacheLeft(j);
  if (left == null) return '';
  if (left <= 0) return '<span class="jcache cold" title="The next message re-reads the chat">Cache cold</span>';
  const kw = keptWarm(j);
  return `<span class="jcache num${left <= 10 && !kw ? ' soon' : ''}${kw ? ' kw' : ''}" title="${esc(`Cache warm for ${left} more min${kw ? ', kept warm' : ''}`)}">${kw ? I.flame : ''}Cache ${left}m</span>`;
}

// ---------- The diff a job made: only the parts that are not zero ----------
export const statHTML = (a, d) => `${a || !d ? `<b class="d-add">+${a ?? 0}</b>` : ''}${d ? `<b class="d-del">−${d}</b>` : ''}`;
/** { add, del, files } from the job's own copy when it has one; files alone from its turns. */
export function diffOf(j) {
  const w = wsOf(j);
  if (w?.kind === 'worktree' && (w.add || w.del)) return { add: w.add ?? 0, del: w.del ?? 0, files: w.files || j.files || 0 };
  return j.files > 0 ? { add: null, del: null, files: j.files } : null;
}

// ---------- The lead: the job's ring while it has steps and is live, else the agent's glyph ----------
export const agentHTML = (j, cls = '') => `<span class="agent ${esc(j?.engine ?? '')}${cls ? ` ${cls}` : ''}" aria-hidden="true">${j?.role === 'builder' ? I.hammer : I[j?.engine] ?? I.claude}</span>`;
export const hasRing = (j) => !!progOf(j?.progress) && ['attention', 'working'].includes(laneOf(j)) && j.status !== 'done';
const running = (j) => j.status === 'running' || j.status === 'starting';
export function jobRing(j, size = 48, w = 5) {
  const pr = progOf(j.progress);
  return AOS.ring(pr ? Math.min(1, pr.done / pr.total) : 0, 'jobs', size, w, {
    cls: `jring${running(j) ? ' running' : ''}`,
    inner: `${agentHTML(j)}${j.status === 'needs_input' ? '<em class="jbadge" aria-hidden="true"></em>' : ''}`,
    label: pr ? `${pr.done} of ${pr.total} steps${running(j) ? ', running' : ''}${j.status === 'needs_input' ? ', needs you' : ''}` : '',
  });
}

// ---------- What state a job is in, as one word ----------
/** [label, class]: Needs you is orange, Working is the Jobs colour, Failed is red; the rest is quiet. */
export function stateWord(j) {
  if (j.status === 'needs_input') return ['Needs you', 'jst-needs'];
  if (running(j)) return [j.status === 'starting' ? 'Starting' : 'Working', 'jst-working'];
  if (j.status === 'failed') return ['Failed', 'jst-fail'];
  if (laneOf(j) === 'archived') return ['Archived', ''];
  if (j.review && j.status !== 'done') return ['To review', ''];
  return [JOB_LABEL[j.status] ?? j.status, j.status === 'idle' ? 'jst-wait' : ''];
}
const marksHTML = (j) => {
  const w = wsOf(j);
  const copy = w?.kind === 'worktree' && !['merged', 'removed'].includes(w.stage);
  return `${j.starred ? `<span class="jstar" role="img" aria-label="Starred">${I.starF}</span>` : ''}${copy ? `<span class="jbr" role="img" aria-label="${esc(`Own copy on ${w.branch ?? 'its branch'}`)}">${I.branch}</span>` : ''}`;
};
const meta = (parts) => `<div class="jmeta">${parts.filter(Boolean).map((p) => (p.startsWith('<span') ? p : `<span>${p}</span>`)).join('')}</div>`;

// ---------- The ask: what a job waiting on you wants, answered right on its card ----------
const KIND_WORD = { allow_once: 'Allow', allow_always: 'Always', reject_once: 'Deny', reject_always: 'Never' };
/** The ask's line and its buttons. A plain OK is answered here (data-ask); a question, a plan or a form opens the job. */
export function askHTML(j) {
  const p = j.pending;
  const kind = p?.kind ?? null;
  const question = !!(p && (kind === 'question' || p.form || p.html));
  const plan = kind === 'plan';
  const text = p?.title ? codeText(p.title) : 'It is waiting for your OK.';
  const icon = question ? I.chat : plan ? I.flag : I.shield;
  const ask = (o, label, tint = false) => `<button type="button" class="btn sm${tint ? ' tint' : ''}"${tint ? ' style="--c:var(--needs-ink)"' : ''} data-ask="${esc(j.id)}" data-req="${esc(p.requestId)}" data-opt="${esc(o.optionId)}" aria-label="${esc(o.name)}">${esc(label)}</button>`;
  const open = (label, tint = false) => `<button type="button" class="btn sm${tint ? ' tint' : ''}"${tint ? ' style="--c:var(--needs-ink)"' : ''} data-open-job="${esc(j.id)}">${esc(label)}</button>`;
  let buttons = '';
  if (p && !question && !plan && p.options?.length) {
    const by = (k) => p.options.find((o) => o.kind === k);
    const allow = by('allow_once') ?? by('allow_always');
    const always = allow?.kind === 'allow_once' ? by('allow_always') : null;
    const deny = by('reject_once') ?? by('reject_always');
    buttons = [allow && ask(allow, KIND_WORD[allow.kind], true), always && ask(always, 'Always'), deny && ask(deny, KIND_WORD[deny.kind])].filter(Boolean).join('');
  } else if (p) {
    const skip = p.options?.find((o) => o.kind === 'reject_once');
    buttons = open(plan ? 'Review plan' : 'Answer', true) + (skip ? ask(skip, plan ? skip.name : 'Skip') : open('Open'));
  } else buttons = open('Open', true);
  return `<div class="jask"><p>${icon}<span>${text}</span></p><div class="jask-b">${buttons}</div></div>`;
}

// ---------- A card: live work ----------
/** status: lead the meta with the job's state (a project's page mixes every lane). */
export function jobCardHTML(j, { status = false } = {}) {
  const lane = laneOf(j);
  const pr = progOf(j.progress);
  const ring = hasRing(j);
  const lead = ring ? jobRing(j) : agentHTML(j);
  const [word, wcls] = stateWord(j);
  // the lane says most states; a reply waiting or a failure in Needs you says its own
  const st = status || (!j.review && (j.status === 'idle' || j.status === 'failed')) ? `<span class="${wcls}">${esc(word)}</span>` : '';
  const id = esc(j.id);
  const title = `<span class="rtitle">${esc(j.title || 'Job')}</span>`;
  const openBtn = `<button type="button" class="jt-open" data-open-job="${id}" aria-label="${esc(`${j.title || 'Job'}, ${word}`)}"></button>`;
  const last = plainLine(lastOf(j));
  const lastHTML = last ? `<p class="jlast${j.status === 'failed' ? ' err' : ''}${j.status === 'idle' ? ' two' : ''}">${esc(last)}</p>` : '';
  const queued = j.queue?.length ? `${j.queue.length} queued` : '';
  const cls = `lrow jcard job-row${j.status === 'needs_input' ? ' needs' : ''}${lane === 'working' ? ' working' : ''}${j.starred ? ' starred' : ''}`;
  const attrs = `class="${cls}" data-open-job="${id}" data-lane="${esc(j.lane ?? lane)}"`;
  if (j.status === 'needs_input') {
    return `<div ${attrs}>${openBtn}<div class="jc-top"><span class="jc-lead">${lead}</span><div class="rbody">
<div class="jt">${marksHTML(j)}${title}<span class="jtime num">${esc(agoShort(j.updatedAt ?? j.createdAt))}</span></div>
${meta([status ? st : '', esc(engineName(j)), pr ? `<span class="num">${esc(pr.stage ? `${pr.stage} ` : '')}${pr.done}/${pr.total}</span>` : '', cacheHTML(j)])}</div></div>${askHTML(j)}</div>`;
  }
  const d = diffOf(j);
  const focal = lane === 'working' && pr
    ? `<div class="jprog"><b class="met c-jobs">${pr.done}<small>/${pr.total}</small></b><span class="jp-step">${esc(pr.active ?? '')}</span>${pr.stage ? `<span class="cap">${esc(pr.stage)}</span>` : ''}</div>`
    : (j.review || lane === 'completed') && d ? `<div class="jrev">${d.add != null ? `<span class="jdiffstat num">${statHTML(d.add, d.del)}</span>` : ''}<span>${d.files} ${d.files === 1 ? 'file' : 'files'}</span>${cacheHTML(j)}</div>` : '';
  const showCache = !((j.review || lane === 'completed') && d);
  const parts = lane === 'working'
    ? [st, esc(engineName(j)), esc(agoText(j.updatedAt ?? j.createdAt)), showCache ? cacheHTML(j) : '', queued]
    : [st, shipHTML(j), esc(engineName(j)), esc(agoText(j.updatedAt ?? j.createdAt)), showCache ? cacheHTML(j) : '', queued];
  const spin = running(j) && !ring ? '<span class="spin jc-spin" style="--c:var(--jobs)" role="img" aria-label="Working"></span>' : '';
  return `<div ${attrs}>${openBtn}<span class="jc-lead">${lead}</span><div class="rbody">
<div class="jt">${marksHTML(j)}${title}${spin}</div>
${meta(parts)}${focal}${lastHTML}</div></div>`;
}

// ---------- A row: paused or finished work, one line each ----------
export function jobSmallHTML(j, { status = false } = {}) {
  const [word, wcls] = stateWord(j);
  const end = j.status === 'failed' ? `<span class="jst-fail">Failed</span>` : status ? `<span class="${wcls || 'jst-q'}">${esc(word)}</span>` : shipHTML(j);
  return `<button type="button" class="lrow jsmall job-row${j.starred ? ' starred' : ''}" data-open-job="${esc(j.id)}" data-lane="${esc(j.lane ?? laneOf(j))}" aria-label="${esc(`${j.title || 'Job'}, ${word}`)}">${agentHTML(j, 'sm')}<span class="rbody"><span class="rtitle">${j.starred ? `<span class="jstar" aria-hidden="true">${I.starF}</span>` : ''}${esc(j.title || 'Job')}</span></span>${end}<span class="cap num jsm-t">${esc(agoShort(j.updatedAt ?? j.createdAt))}</span></button>`;
}

/** The right one for where a job stands: a card while it is live or waiting on you, a row once it rests. */
export function jobRowHTML(j, opts = {}) {
  const lane = laneOf(j);
  const live = lane === 'working' || j.status === 'needs_input' || j.status === 'idle' || j.status === 'failed' || (j.review && lane !== 'archived');
  return live ? jobCardHTML(j, opts) : jobSmallHTML(j, opts);
}

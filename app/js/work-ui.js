// Work · the shared base: state, helpers, icons, the animated agent marks and the live clock every Work screen uses.
// Real mode reads the PC (work-engine.js; data.js shapes the jobs, each keeps its PC record on .raw); ?data=demo keeps
// the prototype's sample story (work-data.js). Other areas are reached through the bus, and the imports Work needs
// from them (today.js, capture.js) and from MOTION (marks.js) load defensively: if one is mid-edit and fails, Work keeps
// working with plain fallbacks instead of going blank.
import { $, $$, esc, ring } from './core.js';
import { I } from './icons.js';
import { JOBS, PROJECTS, project, TASKS, GOALS, IDEAS, area } from './data.js';
import { REPOS, LINKS } from './work-data.js';
import { REAL, markState, agentOf, repoNow, builders, code, clock } from './work-engine.js';

let TODAY = {}, CAPTURE = {}, MARKS = null;
try { TODAY = await import('./today.js'); } catch (e) { console.warn('[work] today.js did not load; using plain task rows', e); }
try { CAPTURE = await import('./capture.js'); } catch (e) { console.warn('[work] capture.js did not load; voice notes fall back to typing', e); }
try { MARKS = await import('./marks.js'); } catch (e) { console.warn('[work] marks.js did not load; the agents show their still glyphs', e); }
// MOTION's stylesheets, until the shell links them itself
// (the lead links them in index.html; this only fills in when that link isn't there, a cache-busting ?v= included)
for (const href of [MARKS ? 'css/marks.css' : null, 'css/motion.css'].filter(Boolean)) {
  if (!document.querySelector(`link[href*="${href.split('/').pop()}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
}
if (MARKS?.pauseOffscreen) { try { MARKS.pauseOffscreen(document.getElementById('phone') ?? document); } catch {} }
export { REAL };

// ── icons Work needs beyond js/icons.js: the same 24px grid and 2px line ──
const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const WI = {
  pr: s('<circle cx="6" cy="5.5" r="2.2"/><circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="18.5" r="2.2"/><path d="M6 7.7v8.6M18 16.3V10a3.5 3.5 0 0 0-3.5-3.5H11M13.5 4 11 6.5 13.5 9"/>'),
  merge: s('<circle cx="6" cy="5.5" r="2.2"/><circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="12.5" r="2.2"/><path d="M6 7.7v8.6M6 7.7c.4 3 2.6 4.8 6 4.8h3.8"/>'),
  commit: s('<circle cx="12" cy="12" r="3.5"/><path d="M3 12h5.5M15.5 12H21"/>'),
  pc: s('<rect x="3" y="4" width="18" height="12.5" rx="2.5"/><path d="M9 20.5h6M12 16.5v4"/>'),
  plan: s('<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="m3.6 6.6 1.4 1.4 2.4-2.8M3.6 12.1l1.4 1.4 2.4-2.8"/><circle cx="5.3" cy="17.5" r="1.3"/>'),
  clip: s('<path d="M19.5 11.8 12.4 19a4.6 4.6 0 0 1-6.5-6.5l7.7-7.7a3.1 3.1 0 0 1 4.4 4.4l-7.6 7.6a1.55 1.55 0 0 1-2.2-2.2l6.9-6.9"/>'),
  push: s('<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 14.5v3a2.5 2.5 0 0 0 2.5 2.5h10a2.5 2.5 0 0 0 2.5-2.5v-3"/>'),
  file: s('<path d="M6.5 3.5h7.5l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z"/><path d="M13.5 3.5V8h4.5"/>'),
  fileDiff: s('<path d="M6.5 3.5h7.5l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z"/><path d="M11.5 8.5v5M9 11h5M9 16.5h5"/>'),
  copies: s('<rect x="7.5" y="7.5" width="12.5" height="12.5" rx="3"/><path d="M16.5 7.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8.5a2 2 0 0 0 2 2h1.5"/>'),
  checkC: s('<circle cx="12" cy="12" r="8.8"/><path d="m8.2 12.3 2.6 2.6 5-5.3"/>'),
  revert: s('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  moon: s('<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/><path d="M16.5 3.5v3M15 5h3"/>'),
  queue: s('<path d="M4 6.5h11M4 12h11M4 17.5h7"/><path d="M17.5 14.5v6M14.5 17.5h6"/>'),
  image: s('<rect x="3.5" y="4.5" width="17" height="15" rx="3.5"/><circle cx="9" cy="10" r="1.8"/><path d="m4 17.5 4.6-4.4a1.6 1.6 0 0 1 2.2 0l2.7 2.6 1.6-1.5a1.6 1.6 0 0 1 2.2 0l3.2 3"/>'),
  command: s('<path d="M9 9h6v6H9z"/><path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9M15 9V6.5A2.5 2.5 0 1 1 17.5 9H15M15 15v2.5a2.5 2.5 0 1 0 2.5-2.5H15M9 15v2.5A2.5 2.5 0 1 1 6.5 15H9"/>'),
  steer: s('<path d="M4 12h12M12 6l6 6-6 6"/><path d="M20 5v14"/>'),
  thought: s('<path d="M12 4.5a5.5 5.5 0 0 0-3.1 10V17h6.2v-2.5A5.5 5.5 0 0 0 12 4.5ZM9.5 20h5"/>'),
  warn: s('<path d="M12 4.2 2.8 19.5h18.4L12 4.2Z"/><path d="M12 10v4.2M12 16.9v.1"/>'),
};

// ── one state for every Work screen. Demo's choices live for the session; real ones are the PC's ──
export const W = {
  view: 'projects',                // projects | jobs | ideas
  filter: 'all',                   // the board's project filter
  open: { done: false, archive: false, projDone: false, stopped: false },
  ideas: IDEAS.slice(),            // demo's ideas (real mode reads IDEAS, the PC's, with the outbox)
  perm: {},                        // demo: job id → ask | auto | full
  always: new Set(['bun test']),   // demo: commands allowed for good
  review: {},                      // demo: job id → { path: 'kept' | 'reverted' }
  shipped: {},                     // demo: job id → how it left: merged | pr | builder
  night: null,                     // demo: the queued shift
  term: [],                        // demo: commands typed into a terminal this session
  set: { wt: true, warm: false, type: false, notify: true, steer: true, cacheC: '60 min', cacheX: '60 min', ping: '15 min', keep: '1 h', arch: '3 days', ckpt: '7 days', batch: '10 min' },
  loaded: Date.now(),
};
/** The ideas the screens show: the PC's (with the outbox) or demo's. */
export const ideasNow = () => (REAL ? IDEAS : W.ideas);
// a change anywhere redraws whatever Work is showing (the tab, a project page, a job page)
export const changed = (what = {}) => document.dispatchEvent(new CustomEvent('work:change', { detail: what }));

// ── small words ───────────────────────────────────────────────────────
export const agentName = (a) => (a === 'claude' ? 'Claude' : 'Codex');
export const job = (id) => JOBS.find((j) => j.id === id);
export const lane = (l, list = JOBS) => list.filter((j) => j.lane === l);
export const STATUS = { needs: 'Needs you', working: 'Working', review: 'To review', done: 'Done', archive: 'Archived', stopped: 'Stopped' };
export const capFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const plural = (n, w, many = `${w}s`) => `${n} ${n === 1 ? w : many}`;
// '3m' → '3m ago'; a date ('12 Oct') stays a date
export const ago = (j) => (!j.ago || j.ago === 'now' ? 'just now' : /^\d+[mhd]$/.test(j.ago) ? `${j.ago} ago` : j.ago);
export const hasRing = (j) => !!j.progress && ['needs', 'working'].includes(j.lane);
export const pickMark = `<span class="jpick" aria-hidden="true">${I.check}</span>`;
export const taskOf = (id) => TASKS.find((t) => t.id === id);
export const goalOf = (id) => GOALS.find((g) => g.id === id);
/** What a job is tied to: the task it came from (and that task's goal), its idea, the client it is for. */
export const linksOf = (j) => {
  if (REAL) {
    const r = j.raw ?? {};
    const task = r.taskIds?.[0] ?? null;
    return { task, goal: task ? taskOf(task)?.goal ?? null : null, idea: r.ideaId ?? null, client: null, tasks: r.taskIds ?? [] };
  }
  const l = { ...(LINKS[j.id] ?? {}) }; const t = TASKS.find((x) => x.job === j.id); if (t && !l.task) l.task = t.id; if (l.task && !l.goal) l.goal = taskOf(l.task)?.goal; return l;
};
export const projJobs = (slug) => JOBS.filter((j) => j.project === slug);
export const projTasks = (slug) => TASKS.filter((t) => t.project === slug && (!REAL || !['done', 'dropped'].includes(t.status)));
export const projIdeas = (slug) => ideasNow().filter((i) => i.project === slug && (i.status ?? 'open') === 'open');
const EMPTY_REPO = { branch: null, ahead: 0, behind: 0, dirty: [], activity: null, commits: [], quiet: 0 };
/** A project's repository in the prototype's shape. Real: the Work module's facts (or the copy check), the Builder's last
 *  ship and the jobs' days; null fields mean the PC hasn't said yet. */
export function repoOf(slug) {
  if (!REAL) return REPOS[slug] ?? { branch: 'main', ahead: 0, behind: 0, dirty: [], activity: Array(14).fill(0) };
  const r = repoNow(slug);
  const b = builders.list?.find((x) => x.key === slug) ?? null;
  const ships = (b?.ships ?? []);
  const live = ships.find((x) => x.state === 'live');
  const cur = ships.find((x) => ['queued', 'sent', 'committed', 'building'].includes(x.state));
  // the days: commits per day from the PC's git log, plus the jobs started in it
  const days = Array(14).fill(0);
  const today = clock.today();
  for (const j of projJobs(slug)) { const d = clock.daysBetween(clock.dateOfIso(j.raw?.createdAt ?? new Date().toISOString()), today); if (d >= 0 && d < 14) days[13 - d]++; }
  if (Array.isArray(r?.activity)) r.activity.forEach((n, i) => { days[i] += Number(n) || 0; });
  const lastAt = [...projJobs(slug).map((j) => j.raw?.updatedAt), r?.commits?.[0]?.at].filter(Boolean).sort().at(-1);
  const quiet = lastAt ? clock.daysBetween(clock.dateOfIso(lastAt), today) : null;
  if (!r) return { ...EMPTY_REPO, activity: days, ship: cur ? { state: cur.state, what: cur.title, job: cur.jobId } : null, lastShip: live ? [live.title, 'live', clock.ago(live.doneAt ?? live.at)] : null, quiet: quiet >= 7 ? quiet : 0, known: false };
  const c0 = r.commits?.[0];
  return {
    branch: r.branch ?? null, ahead: r.ahead ?? 0, behind: r.behind ?? 0, repo: r.repo, full: !!r.full,
    dirty: Array.isArray(r.dirty) ? r.dirty.map((x) => x.path ?? x) : Array(r.dirtyCount ?? 0).fill(''),
    commit: c0 ? [c0.sha, c0.subject, clock.ago(c0.at)] : null,
    commits: (r.commits ?? []).map((c) => [c.sha, c.subject, null, clock.ago(c.at)]),
    ship: cur ? { state: cur.state, what: cur.title, job: cur.jobId } : null,
    lastShip: live ? [live.title, 'live', clock.ago(live.doneAt ?? live.at)] : null,
    activity: days, scripts: r.scripts ?? null, quiet: quiet >= 7 ? quiet : 0, known: true,
  };
}
/** The branch a job works on: its own copy's (aos/…), else the folder's. */
export const branchOf = (j) => {
  if (!REAL) return j.worktree ? `feat/${j.id}` : repoOf(j.project).branch;
  const w = j.raw?.workspace;
  return w?.kind === 'worktree' && w.branch ? String(w.branch).replace(/^aos\//, '') : w?.branch ?? repoOf(j.project).branch ?? '';
};
export { project, area, PROJECTS };

// ── marks ─────────────────────────────────────────────────────────────
// a project's mark: its emoji or monogram on a control tile; its colour only tints the tile
export const pmark = (p, cls = '') => `<span class="p-ic${cls ? ` ${cls}` : ''}" style="--c:${p.color}" aria-hidden="true">${[...p.icon].length > 1 || /\p{Extended_Pictographic}/u.test(p.icon) ? p.icon : `<b>${esc(p.icon)}</b>`}</span>`;
/** The agent's animated mark in its real state (MOTION's marks.js), or its still glyph when marks.js is away.
 *  j: a job (its state drives the mark) or an agent name ('claude' | 'codex'). */
export function markFor(j, size = 24, { state, cls = '', label } = {}) {
  const a = typeof j === 'string' ? j : agentOf(j);
  const st = state ?? (typeof j === 'string' ? 'idle' : markState(j));
  if (MARKS?.markHTML) { try { return MARKS.markHTML(a, { state: st, size, cls: `wk-am${cls ? ` ${cls}` : ''}`, label }); } catch {} }
  return `<span class="agent ${a}${cls ? ` ${cls}` : ''}" aria-hidden="true">${I[a] ?? I.claude}</span>`;
}
/** Move every mark of this job on screen to its new state (the mark's own moment plays: a tick when it is done). */
export function syncMarks(j, root = document) {
  if (!MARKS?.setMarkState) return;
  const st = markState(j);
  root.querySelectorAll(`[data-mark-job="${j.id}"] .am, .am[data-mark-job="${j.id}"]`).forEach((m) => { try { MARKS.setMarkState(m, st); } catch {} });
}
export const setMark = (el, state) => { try { MARKS?.setMarkState?.(el, state); } catch {} };
/** The agent tile on a row: the mark inside the round agent tile. */
export const agentMark = (a, cls = '', j = null) => (MARKS?.markHTML
  ? `<span class="agent wk-amt ${typeof a === 'string' ? a : agentOf(a)}${cls ? ` ${cls}` : ''}"${j ? ` data-mark-job="${j.id}"` : ''} aria-hidden="true">${markFor(j ?? a, cls.includes('sm') ? 16 : cls.includes('big') ? 30 : 20)}</span>`
  : `<span class="agent ${typeof a === 'string' ? a : agentOf(a)}${cls ? ` ${cls}` : ''}" aria-hidden="true">${I[typeof a === 'string' ? a : agentOf(a)]}</span>`);
// ship state: words with a dot, the colours from SHIP in data.js
const SHIPS = { none: ['Not shipped', 'var(--ink-3)'], queued: ['Queued to ship', 'var(--ink-2)'], sent: ['With the Builder', 'var(--ink-2)'], building: ['Building', 'var(--ink)'], committed: ['Committed', 'var(--ink-2)'], live: ['Live', 'var(--done)'], failed: ['Ship failed', 'var(--fail)'] };
export const shipChip = (state, label) => { if (!state) return ''; const [l, c] = SHIPS[state] ?? SHIPS.none; return `<span class="ship ship-${state}" style="--c:${c}"><i class="dot"></i>${esc(label ?? l)}</span>`; };
// a diffstat shows only the parts that are not zero
export const stat = (a, d) => `${a || !d ? `<b class="add">+${a ?? 0}</b>` : ''}${d ? `<b class="del">−${d}</b>` : ''}`;
export const diffstat = (a, d, cls = '') => `<span class="diffstat num${cls ? ` ${cls}` : ''}">${stat(a, d)}</span>`;

// The job's ring with its agent inside: the ring fills with its steps, the mark inside says what it is doing.
export const jobRing = (j, size = 46, w = 4.5) => {
  if (!REAL && TODAY.jobRing && !MARKS) { try { return TODAY.jobRing(j, size, w); } catch {} }
  const p = j.progress;
  const inner = MARKS ? `<span class="wk-ring-m" data-mark-job="${j.id}">${markFor(j, Math.round(size * 0.46))}</span>` : `<span class="agent ${j.agent}" aria-hidden="true">${I[j.agent]}</span>`;
  return ring(p ? p.done / Math.max(1, p.total) : 0, j.lane === 'needs' ? 'needs' : 'jobs', size, w, { cls: `jring${j.lane === 'working' ? ' running' : ''}`, inner, label: p ? `${p.done} of ${p.total} steps` : '' });
};
// a task row: Today's, so a task looks the same everywhere; a plain row if today.js is away
export const taskRow = (t) => {
  if (TODAY.taskRow) { try { return TODAY.taskRow(t); } catch {} }
  const a = area(t.area);
  return `<div class="row trow" data-id="${t.id}"><button class="check" data-act="task-check" data-id="${t.id}" aria-label="Mark done">${I.check}</button>
    <button class="rbody" data-act="w-task" data-id="${t.id}"><span class="rtitle">${esc(t.title)}</span><span class="rmeta"><span><i class="dot" style="--c:${a.color}"></i> ${esc(a.name.split(' ')[0])}</span>${t.late ? `<span class="late">· ${esc(t.late)}</span>` : ''}</span></button></div>`;
};
// the voice recorder lives in Capture (demo); real voice notes use the shipping app's recorder (work-voice in the thread)
export function recorder(slot, o) {
  if (CAPTURE.recorder) { try { return CAPTURE.recorder(slot, o); } catch (e) { console.warn('[work] recorder failed', e); } }
  o.onDone?.(o.say ?? '');
}

// ── plan steps as a strip: done, the step in hand, what is left ──
export const steps = (p) => `<span class="steps jstrip" aria-hidden="true">${Array.from({ length: Math.min(40, p.total) }, (_, i) => `<i class="${i < p.done ? 'done' : i === p.done ? 'on' : ''}"></i>`).join('')}</span>`;

// ── the live clock: running work counts up while you look. Elements carry data-since (ms timestamp) ──
// Demo times are written as "16:41" from the prototype's now (17:40); real ones are ISO times from the PC.
const NOW_MIN = 17 * 60 + 40;
export const sinceOf = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return W.loaded - (NOW_MIN - (h * 60 + m)) * 60000; };
export const clockText = (ms, { secs = false } = {}) => {
  const t = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  if (secs) return h ? `${h}h ${m}m ${String(sec).padStart(2, '0')}s` : m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
  return h ? `${h}h ${m}m` : `${m}m`;
};
export { clockText as clock };
export const since = (hhmm, o = {}) => `<span class="num" data-since="${sinceOf(hhmm)}"${o.secs ? ' data-secs="1"' : ''}>${clockText(Date.now() - sinceOf(hhmm), o)}</span>`;
/** The same for a real ISO time. */
export const sinceIso = (iso, o = {}) => { const t = Date.parse(iso ?? ''); if (!Number.isFinite(t)) return ''; return `<span class="num" data-since="${t}"${o.secs ? ' data-secs="1"' : ''}>${clockText(Date.now() - t, o)}</span>`; };
/** "16:41" for an ISO time, in India time. */
export const hhmmOf = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? clock.hm(clock.toMin(iso, clock.dateOfIso(iso))) : ''; };
let ticking = false;
export function startClock() {
  if (ticking) return; ticking = true;
  setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();
    $$('[data-since]').forEach((el) => { if (!el.isConnected || !el.offsetParent) return; el.textContent = clockText(now - Number(el.dataset.since), { secs: !!el.dataset.secs }); });
  }, 1000);
}

// ── who can be reached here: the page you are looking at, so back buttons name it ──
export const backLabel = () => { const top = $('#stack')?.lastElementChild; return top ? (top._opts?.title ?? 'Back') : 'Work'; };
export const activeJobs = (list = JOBS) => list.filter((j) => ['needs', 'working', 'review'].includes(j.lane));
export const projectsOrdered = () => {
  const score = (p) => { const pj = projJobs(p.slug); return (pj.some((j) => j.lane === 'needs') ? 100 : 0) + pj.filter((j) => j.lane === 'working').length * 10 + pj.filter((j) => j.lane === 'review').length + (REAL ? Math.min(5, pj.length) / 10 : 0); };
  return PROJECTS.filter((p) => !['done', 'archived', 'dropped'].includes(p.status)).slice().sort((a, b) => score(b) - score(a));
};
/** Terminals of a project (real: the PC's, from /term). */
export const termsOf = (slug) => (REAL ? code.terms.filter((t) => (slug ? t.project === slug : true)) : []);

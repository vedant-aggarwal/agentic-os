// Work · the real engine under the reimagined screens: every action a Work screen takes goes through here to the PC's
// job runner (server/jobs.ts), its copies (worktrees.ts), terminals (term.ts), Builders and the Work module.
// The live store is app/work/state.js (jobs and ideas, polled while anything runs, the idea outbox); data.js shapes
// its jobs into JOBS for the screens and keeps each job's PC record on view.raw. This file never draws.
//
//   REAL                    false in ?data=demo: the screens keep the prototype's sample story
//   raw(id) · view(id)      the PC's job record · the screen's shaped job (data.js JOBS)
//   markState(j)            idle | thinking | working | needs | done | failed, for the animated Claude and Codex marks
//   act.*                   permission, prompt (queue · steer · interrupt), board moves, settings, rewind, fork, revert …
//   startJob(spec)          POST /jobs (tasks move to doing, the idea to jobbed), compare = two copies in one group
//   code · builders · repo  terminals and copies, the Builders, a project's repository (Work module, else the copy check)
import { toast, haptic, openSheet, closeSheet, $ } from './core.js';
import { DEMO_MODE, JOBS, PROJECTS, job as viewOf } from './data.js';
import * as API from './svc/api.js';
import * as SYNC from './svc/sync.js';
import { collection } from './svc/store.js';
import * as clock from './svc/clock.js';

export const REAL = !DEMO_MODE;
const G = globalThis;

// ── the store (app/work/state.js), loaded on first use; the engine loads it after the first paint anyway ──
let storeP = null, storeM = null;
export const store = () => (storeP ??= import('../work/state.js').then((m) => (storeM = m)).catch((e) => { console.warn('[work] state.js', e); storeP = null; return null; }));
export const storeNow = () => storeM;
if (REAL) setTimeout(() => store(), 0);
/** The PC's record of a job: the live store's, else the bootstrap's. */
export function raw(id) {
  const st = storeM?.W?.jobs?.find((j) => j.id === id);
  return st ?? viewOf(id)?.raw ?? SYNC.state.boot?.jobs?.find((j) => j.id === id) ?? null;
}
export const view = (id) => viewOf(id) ?? JOBS.find((j) => j.id === id) ?? null;
/** Put the PC's answer into the store: the board, the project page and the thread redraw from it. */
export async function putJob(j) {
  if (!j?.id) return;
  const st = await store();
  st?.putJob?.(j);
}
export const err = (e) => (e?.status ? e.message : 'Your PC isn’t reachable right now');

// ── the marks: what an agent is doing, for markHTML(agent, { state }) ──
/** j: a view job (data.js) or a PC record. Live work works, an ask needs you, a finished job settles with a tick. */
export function markState(j) {
  if (!j) return 'idle';
  const r = j.raw ?? (j.engine ? j : null);
  if (!r) {   // demo: the prototype's lanes
    if (j.lane === 'needs') return 'needs';
    if (j.lane === 'working') return 'working';
    if (j.ship === 'failed') return 'failed';
    return j.lane === 'done' || j.ship === 'live' ? 'done' : 'idle';
  }
  if (r.status === 'needs_input') return 'needs';
  if (r.status === 'failed') return 'failed';
  if (r.status === 'starting') return 'thinking';
  if (r.status === 'running') return r.progress?.state === 'needs_input' ? 'needs' : 'working';
  if (r.status === 'done' || r.lane === 'completed' || r.ship?.state === 'live') return 'done';
  if (r.ship?.state === 'failed') return 'failed';
  return 'idle';
}
export const agentOf = (j) => (j?.agent ?? (j?.engine === 'codex' ? 'codex' : 'claude'));

// ── asking before something that costs: one sheet, two buttons ──
/** Resolves true for OK. danger paints the OK red (an undo that can't be brought back). */
export function confirm({ title, body, ok = 'Send anyway', cancel = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const end = (v) => { if (done) return; done = true; resolve(v); };
    const el = openSheet({
      title, cls: 'wk-confirm', onClose: () => end(false),
      body: (b) => {
        b.innerHTML = `<div class="pad"><p class="wk-cf-body">${String(body ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))}</p>
          <button class="btn block ${danger ? 'wk-cf-danger' : 'primary'}" style="--c:var(--jobs-fill)" data-cf="1">${ok}</button>
          <button class="btn block wk-cf-no" data-cf="0">${cancel}</button></div>`;
        b.addEventListener('click', (e) => { const x = e.target.closest('[data-cf]'); if (!x) return; end(x.dataset.cf === '1'); closeSheet(x.closest('.sheet')); });
      },
    });
    void el;
  });
}

// ── requests ──
const call = (path, body, o = {}) => API.api(path, { method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body), timeout: 60000, ...o });
/** POST, and when the PC says the prompt cache went cold (428), say what it costs and send again only on OK. */
export async function postCold(path, body, key = null) {
  const o = (k) => (k ? { headers: { 'Idempotency-Key': k } } : {});
  try { return await call(path, body, o(key)); } catch (e) {
    if (e.status !== 428) throw e;
    const go = await confirm({ title: 'The cache is cold', body: e.message, ok: 'Send anyway' });
    if (!go) return null;
    return call(path, { ...body, force: true }, o(key && `${key}:force`));   // the 428 is kept under the first key
  }
}

// ── one job: everything you can do to it ──
const pend = (j) => raw(j.id ?? j)?.pending ?? null;
const optOf = (p, ...kinds) => { for (const k of kinds) { const o = p?.options?.find((x) => x.kind === k || x.optionId === k); if (o) return o; } return null; };
export const act = {
  /** Answer the open request with one of its options (Allow, Always, Deny; a plan's Approve; a form's Send or Skip). */
  async answer(jobId, optionId, { requestId, answers } = {}) {
    const p = pend(jobId);
    const req = requestId ?? p?.requestId;
    if (!req) throw Object.assign(new Error('That request is no longer open.'), { status: 409 });
    const r = await call(`/jobs/${jobId}/permission`, { requestId: req, optionId, ...(answers ? { answers } : {}) });
    if (r.job) await putJob(r.job);
    return r.job;
  },
  /** A plain OK: once, for this session, or no. */
  async allow(jobId, { always = false } = {}) {
    const p = pend(jobId);
    const o = always ? optOf(p, 'allow_always') ?? optOf(p, 'allow_once') : optOf(p, 'allow_once') ?? optOf(p, 'allow_always');
    if (!o) throw Object.assign(new Error('That request is no longer open.'), { status: 409 });
    return act.answer(jobId, o.optionId);
  },
  async deny(jobId) {
    const o = optOf(pend(jobId), 'reject_once', 'reject_always');
    if (!o) throw Object.assign(new Error('That request is no longer open.'), { status: 409 });
    return act.answer(jobId, o.optionId);
  },
  /** A written plan: approve it (plan mode ends) or keep planning. */
  async plan(jobId, approve) {
    const p = pend(jobId);
    const o = approve ? optOf(p, 'approve', 'allow_once') : optOf(p, 'deny', 'reject_once');
    if (!o) throw Object.assign(new Error('That plan is no longer open.'), { status: 409 });
    return act.answer(jobId, o.optionId);
  },
  /** A form: question text → answer text. skip sends Skip. */
  async form(jobId, answers, { skip = false } = {}) {
    return act.answer(jobId, skip ? 'skip' : 'submit', skip ? {} : { answers });
  },
  /** A message. While it works: queued (default), steered into the turn, or the turn is interrupted. */
  async prompt(jobId, text, { steer = false, interrupt = false, attachments = [], plan, force = false, key = null } = {}) {
    const body = { text, queue: true, ...(attachments.length ? { attachments } : {}), ...(steer ? { steer: true } : {}), ...(interrupt ? { interrupt: true } : {}), ...(typeof plan === 'boolean' ? { plan } : {}), ...(force ? { force: true } : {}) };
    const r = await postCold(`/jobs/${jobId}/prompt`, body, key ? `msg:${jobId}:${key}` : null);
    if (r?.job) await putJob(r.job);
    return r;
  },
  async cancel(jobId) { const r = await call(`/jobs/${jobId}/cancel`, {}); if (r.job) await putJob(r.job); return r.job; },
  async stop(jobId) { const r = await call(`/jobs/${jobId}/stop`, {}); if (r.job) await putJob(r.job); return r.job; },
  async done(jobId, { completeTasks = false } = {}) {
    const r = await call(`/jobs/${jobId}/done`, { completeTasks });
    if (r.job) await putJob(r.job);
    if (completeTasks) for (const id of r.job?.taskIds ?? []) { const t = SYNC.state.data?.tasks.find((x) => x.id === id); if (t && t.status !== 'done') SYNC.adopt('task', { id, status: 'done', completedAt: new Date().toISOString() }); }
    return r.job;
  },
  /** Board flags and lanes: { starred }, { review }, { keepWarm: hours | true | 0 | null }, { lane: working | attention | completed | archived }. */
  async board(jobId, body) { const r = await postCold(`/jobs/${jobId}/board`, body); if (r?.job) await putJob(r.job); return r?.job ?? null; },
  /** The next turn's model, effort, permissions (mode ask | edits | auto) and plan first. 409 mid-turn. */
  async settings(jobId, body) { const r = await call(`/jobs/${jobId}/settings`, body); if (r.job) await putJob(r.job); return r.job; },
  /** The queue: { remove: id } · { steer: id } · { edit: id, text } · { clear: true }. */
  async queue(jobId, body) { const r = await call(`/jobs/${jobId}/queue`, body); if (r.job) await putJob(r.job); return r.job; },
  /** Back to before turn n: files, chat or both. Returns { job, text, conversation, files }. */
  async rewind(jobId, turn, mode = 'both') { const r = await call(`/jobs/${jobId}/rewind`, { turn, mode }); if (r.job) await putJob(r.job); return r; },
  /** A new job carrying on after turn n (Claude chats). */
  async fork(jobId, turn) { const r = await call(`/jobs/${jobId}/fork`, turn ? { turn } : {}); if (r.job) await putJob(r.job); return r.job; },
  /** Files back to how they were before turn n (later turns' changes go too). */
  async revert(jobId, turn) { const r = await call(`/jobs/${jobId}/revert`, { turn }); if (r.job) await putJob(r.job); return r; },
  /** { files, patch, live } for turn n (0: the whole job), one file's patch with file. */
  diff: (jobId, turn = 0, file = null) => call(`/jobs/${jobId}/diff?turn=${turn}${file ? `&file=${encodeURIComponent(file)}` : ''}`),
  turns: (jobId) => call(`/jobs/${jobId}/turns`),
  get: (jobId) => call(`/jobs/${jobId}`),
};
/** Move a job to a lane, with Undo. label: what the toast says. */
export async function moveJob(jobId, to, { label = null, undo = true } = {}) {
  const r0 = raw(jobId);
  const from = r0?.lane ?? 'attention';
  if (from === to) return null;
  try {
    const next = await act.board(jobId, { lane: to });
    if (!next) return null;
    haptic(14);
    toast(label ?? 'Moved', undo ? () => moveJob(jobId, from, { label: 'Moved back', undo: false }) : undefined);
    return next;
  } catch (e) { toast(err(e)); return null; }
}

// ── per-file review: kept or reverted, synced (Work module collection), and the real revert of one file ──
let reviewsC = null;
export const reviews = () => (reviewsC ??= collection('work/reviews', { endpoint: '/api/v1/mod/work/reviews', interval: 0, prefix: 'rv' }));
const reviewId = (jobId, path) => `rv_${jobId}_${[...String(path)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36)}`;
/** path → { mark, blob, turn, noted } for a job. */
export function marksOf(jobId) {
  const m = new Map();
  if (!REAL || !moduleOn.yes) return m;
  for (const d of reviews().list()) if (d.job === jobId && d.mark) m.set(d.path, d);
  return m;
}
export function setMark(jobId, path, mark, extra = {}) {
  const c = reviews();
  const id = reviewId(jobId, path);
  const cur = c.get(id);
  if (cur) return c.update(id, { mark, ...extra });
  return c.add({ id, job: jobId, path, mark, turn: extra.turn ?? 0, blob: extra.blob ?? null, noted: false, ...extra });
}
/** Revert one file to how it was before the job (or before turn n) on the PC. Needs the Work module. */
export async function revertFile(jobId, path, turn = 0) {
  return call(`/mod/work/jobs/${jobId}/revert-file`, { path, turn });
}
export async function restoreFile(jobId, path, blob) {
  return call(`/mod/work/jobs/${jobId}/restore-file`, { path, blob });
}
/** Files he reverted since his last message: the next message tells the agent, so it re-reads them. */
export function revertNote(jobId) {
  const left = [...marksOf(jobId).values()].filter((d) => d.mark === 'reverted' && d.blob !== undefined && !d.noted);
  if (!left.length) return { text: '', done: () => {} };
  const names = left.map((d) => d.path);
  return {
    text: `(Note from Agentic OS: the user put ${names.length === 1 ? 'this file' : 'these files'} back to how ${names.length === 1 ? 'it was' : 'they were'} before your changes: ${names.join(', ')}. Re-read before you edit ${names.length === 1 ? 'it' : 'them'}.)`,
    done: () => { for (const d of left) reviews().update(d.id, { noted: true }); },
  };
}

// ── is the Work module on this PC (per-file revert, repo facts, the night shift)? Asked once a session ──
let modP = null;
/** moduleOn.yes: known to be there (sync; false until the first answer). */
export const moduleOn = { yes: false, known: false };
export const hasWorkModule = () => (modP ??= (REAL ? API.api('/mod/work/night?since=0', { timeout: 8000 }).then(() => true, (e) => (e?.status === 404 ? false : null)) : Promise.resolve(false)).then((v) => {
  if (v == null) { modP = null; return false; }
  moduleOn.yes = v; moduleOn.known = true;
  if (v) { reviews(); G.document?.dispatchEvent(new CustomEvent('work:module')); }
  return v;
}));

// ── starting work ──
const ENGINE_KEY = 'agentos-app:job-engine';
export const lastEngine = () => (API.ls.get(ENGINE_KEY) === 'codex' ? 'codex' : 'claude');
export const rememberEngine = (e) => API.ls.set(ENGINE_KEY, e);
const WT_KEY = 'agentos-app:job-worktree';
export const lastWorktree = () => API.ls.get(WT_KEY) !== '0';
export const rememberWorktree = (on) => API.ls.set(WT_KEY, on ? '1' : '0');
export const lastModel = (e) => API.ls.get(`agentos-app:model-${e}`) ?? '';
export const rememberModel = (e, m) => (m ? API.ls.set(`agentos-app:model-${e}`, m) : API.ls.del(`agentos-app:model-${e}`));
export const lastEffort = (e) => API.ls.get(`agentos-app:effort-${e}`) ?? '';
export const rememberEffort = (e, v) => (v ? API.ls.set(`agentos-app:effort-${e}`, v) : API.ls.del(`agentos-app:effort-${e}`));

/** spec: { engine, prompt, title?, model?, effort?, mode?, plan?, worktree?, taskIds?, ideaId?, project?, cwd?, attachments? }.
 *  Returns the PC's job. The tasks move to doing and the idea to jobbed on the PC; the phone mirrors that. */
export async function startJob(spec) {
  const body = Object.fromEntries(Object.entries({
    engine: spec.engine, model: spec.model || null, effort: spec.effort || null, mode: spec.mode ?? 'auto', plan: !!spec.plan,
    worktree: spec.worktree ? true : null, taskIds: spec.taskIds?.length ? spec.taskIds : null, ideaId: spec.ideaId ?? null,
    project: spec.project ?? null, cwd: spec.cwd ?? null, title: spec.title ?? null, context: spec.prompt?.trim() || null,
    attachments: spec.attachments?.length ? spec.attachments : null,
  }).filter(([, v]) => v != null));
  // spec.key (one per New job sheet): a resend after a lost answer gets the job the PC already started, not a second one
  const r = await call('/jobs', body, spec.key ? { headers: { 'Idempotency-Key': `job:${spec.key}` } } : {});
  await putJob(r.job);
  for (const id of spec.taskIds ?? []) { const t = SYNC.state.data?.tasks.find((x) => x.id === id); if (t && t.status !== 'done') SYNC.adopt('task', { id, status: 'doing', jobIds: [...new Set([...(t.jobIds ?? []), r.job.id])] }); }
  if (spec.ideaId) { const st = await store(); const i = st?.ideaById?.(spec.ideaId); if (i) st.putIdea({ ...i, status: 'jobbed', jobId: r.job.id }); }
  touchProject(spec.project);
  return r.job;
}
/** Two or three agents on the same task, each in its own copy of the project (a compare group). Returns the jobs. */
export async function startCompare(spec, engines = ['claude', 'codex']) {
  const p = PROJECTS.find((x) => x.slug === spec.project);
  if (!p?.folder) throw new Error('A compare needs a project with a folder.');
  const group = `g_${Math.random().toString(36).slice(2, 10)}`;
  const names = engines.map((e, i) => `${e === 'codex' ? 'Codex' : 'Claude'}${engines.filter((x) => x === e).length > 1 ? ` ${engines.slice(0, i + 1).filter((x) => x === e).length}` : ''}`);
  const base = spec.title || String(spec.prompt ?? '').split('\n')[0].slice(0, 70) || 'Compare';
  const jobs = [];
  for (const [i, engine] of engines.entries()) {
    const w = await call('/worktrees', { folder: p.folder, title: base, project: p.slug, group, label: names[i] }, spec.key ? { headers: { 'Idempotency-Key': `copy:${spec.key}:${i}` } } : {});
    jobs.push(await startJob({ ...spec, key: spec.key ? `${spec.key}:${i}` : null, engine, model: engine === spec.engine ? spec.model : lastModel(engine), cwd: w.worktree.cwd, worktree: false, title: `${base} · ${names[i]}` }));
  }
  await loadCode(true);
  return { group, jobs };
}
const RECENT = 'agentos-app:recent-projects';
export function touchProject(slug) { if (!slug) return; const rec = API.ls.json(RECENT) ?? []; API.ls.set(RECENT, JSON.stringify([slug, ...rec.filter((x) => x !== slug)].slice(0, 20))); }

// ── the PC's model choices (GET /jobs/models), once a run ──
let modelsP = null;
export const FALLBACK_MODELS = { claude: ['opus', 'sonnet', 'haiku'], codex: [], efforts: { claude: ['low', 'medium', 'high', 'xhigh', 'max'], codex: ['low', 'medium', 'high', 'xhigh'] } };
export const models = () => (modelsP ??= (REAL ? call('/jobs/models').then((r) => r.models ?? FALLBACK_MODELS, () => { modelsP = null; return FALLBACK_MODELS; }) : Promise.resolve(FALLBACK_MODELS)));
/** claude-opus-5-5 → Opus 5.5 · opus → Opus · gpt-6.1-sol → GPT-6.1-Sol */
export function modelName(id) {
  if (!id) return 'Default';
  const m = String(id).match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i);
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}${m[4] ? ' (1M)' : ''}`;
  if (/^(opus|sonnet|haiku|fable)$/i.test(id)) return `${id[0].toUpperCase()}${id.slice(1).toLowerCase()}`;
  return String(id).replace(/^gpt-/i, 'GPT-').replace(/-([a-z])/g, (_, c) => `-${c.toUpperCase()}`);
}
const EFFORT_NAME = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
export const effortName = (v) => (v ? EFFORT_NAME[v] ?? `${v[0].toUpperCase()}${v.slice(1)}` : 'Default');
export const MODES = { ask: ['Ask first', 'Asks before it edits a file or runs a command'], edits: ['Auto-edit', 'Edits files on its own, asks before it runs a command'], auto: ['Full access', 'Edits and runs anything without asking'] };

// ── terminals and copies (GET /term, /worktrees), kept fresh while Work is on screen ──
export const code = { terms: [], worktrees: [], settings: { phoneShellInput: false }, down: false, at: 0 };
let codeP = null, codeNext = null;
export async function loadCode(force = false) {
  if (!REAL || !SYNC.state.user || SYNC.state.user.role !== 'owner') return code;
  if (!force && Date.now() - code.at < 3000) return code;
  if (codeP) {
    if (!force) return codeP;
    // forced while a read is on the way (it may predate a copy just made): one more read after it, shared by every
    // forced caller in the meantime
    return (codeNext ??= codeP.catch(() => {}).then(() => { codeNext = null; return readCode(); }));
  }
  return readCode();
}
function readCode() {
  codeP = (async () => {
    const [t, w] = await Promise.allSettled([call('/term', undefined, { timeout: 15000 }), call('/worktrees', undefined, { timeout: 20000 })]);
    if (t.status === 'fulfilled') { code.terms = t.value.sessions ?? []; code.settings = t.value.settings ?? code.settings; code.down = !!t.value.down; }
    if (w.status === 'fulfilled') code.worktrees = w.value.worktrees ?? [];
    code.at = Date.now();
    // app/work/code.js reads these from the store too (copyFor, the classic board)
    const st = storeM; if (st?.W) { st.W.terms = code.terms; st.W.worktrees = code.worktrees; st.W.termSettings = code.settings; st.W.termDown = code.down; }
    G.document?.dispatchEvent(new CustomEvent('work:code'));
    return code;
  })().finally(() => { codeP = null; });
  return codeP;
}
const norm = (p) => String(p ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
/** The open copy (worktree) a folder is in. */
export const copyFor = (folder) => (folder ? code.worktrees.find((w) => w.state === 'open' && (norm(folder) === norm(w.path) || norm(folder).startsWith(`${norm(w.path)}\\`))) ?? null : null);
export const isAgentTerm = (t) => t?.kind === 'claude' || t?.kind === 'codex';
export const term = {
  text: (id, lines = 160) => call(`/term/${id}/text?lines=${lines}`, undefined, { timeout: 15000 }),
  send: (id, text) => call(`/term/${id}/send`, { text }),
  key: (id, key) => call(`/term/${id}/key`, { key }),
  act: (id, a, body = {}) => call(`/term/${id}/${a}`, body),
  create: (body) => call('/term', body),
  settings: (body) => call('/term/settings', body),
};
export const worktree = {
  merge: (id, message) => call(`/worktrees/${id}/merge`, { message }),
  pr: (id, title, body) => call(`/worktrees/${id}/pr`, { title, body }),
  discard: (id) => call(`/worktrees/${id}/discard`, {}),
  pick: (id, message) => call(`/worktrees/${id}/pick`, { message }),
  diff: (id, file = null) => call(`/worktrees/${id}/diff${file ? `?file=${encodeURIComponent(file)}` : ''}`),
  check: (folder) => call(`/worktrees/check?folder=${encodeURIComponent(folder)}`, undefined, { timeout: 15000 }),
};

// ── the Builders (GET /jobs/builders) and the board's settings ──
export const builders = { list: null, at: 0 };
export async function loadBuilders(force = false) {
  if (!REAL || SYNC.state.user?.role !== 'owner') return builders.list ?? [];
  if (!force && builders.list && Date.now() - builders.at < 25000) return builders.list;
  builders.at = Date.now();
  try { builders.list = (await call('/jobs/builders', undefined, { timeout: 15000 })).builders ?? []; } catch { builders.list ??= []; }
  const st = storeM; if (st?.W) st.W.builders = builders.list;
  G.document?.dispatchEvent(new CustomEvent('work:code'));
  return builders.list;
}
export const configureBuilder = async (key, body) => { const r = await call(`/jobs/builders/${encodeURIComponent(key)}`, body); await loadBuilders(true); return r.builder; };
export const builderName = (b) => (b.key === '_global' ? 'Jobs without a project' : PROJECTS.find((p) => p.slug === b.key)?.name ?? b.key);
export const boardSettings = { get: () => call('/jobs/board-settings').then((r) => r.settings), set: (patch) => call('/jobs/board-settings', patch).then((r) => r.settings) };

/** Days in a row something went live (a Builder's ship), ending today or yesterday. null before the Builders load. */
export function shipStreak() {
  if (!builders.list) return null;
  const days = new Set(builders.list.flatMap((b) => (b.ships ?? []).filter((s) => s.state === 'live' && (s.doneAt || s.at)).map((s) => clock.dateOfIso(s.doneAt || s.at))));
  let d = clock.today(), n = 0;
  if (!days.has(d)) d = clock.addDays(d, -1);
  while (days.has(d)) { n++; d = clock.addDays(d, -1); }
  return n;
}

// ── a project's repository: the Work module's facts (branch, ahead, dirty, commits, activity, scripts), else the copy check ──
const repos = new Map();   // slug → { at, data, p }
export function repoNow(slug) { return repos.get(slug)?.data ?? null; }
/** check: fall back to the copy check (GET /worktrees/check, a plain git status) when the Work module isn't on the
 *  PC. The home cards don't (a status in every project folder for a glance); a project page and the job sheet do. */
export function loadRepo(slug, { force = false, check = false } = {}) {
  if (!REAL) return Promise.resolve(null);
  const p = PROJECTS.find((x) => x.slug === slug);
  if (!p?.folder) return Promise.resolve(null);
  const have = repos.get(slug);
  if (have?.p) return have.p;
  if (!force && have && Date.now() - have.at < 60000) return Promise.resolve(have.data);
  const pr = (async () => {
    let data = null;
    if (await hasWorkModule()) { try { data = await call(`/mod/work/repo?project=${encodeURIComponent(slug)}`, undefined, { timeout: 15000 }); data.full = true; } catch {} }
    if (!data && check) { try { const c = await worktree.check(p.folder); data = { folder: p.folder, repo: !!c.repo, root: c.repo, branch: c.branch, dirtyCount: c.dirty ?? 0, dirty: null, commits: null, activity: null, scripts: null }; } catch { data = null; } }
    if (!data && !check) { repos.delete(slug); return null; }
    repos.set(slug, { at: Date.now(), data });
    G.document?.dispatchEvent(new CustomEvent('work:repo', { detail: { slug } }));
    return data;
  })().finally(() => { const h = repos.get(slug); if (h) delete h.p; });
  repos.set(slug, { ...(have ?? { at: 0, data: null }), p: pr });
  return pr;
}

// ── ideas: the store's outbox (saved on the phone first), a task or a job out of each ──
export async function addIdea({ text, project = null, source = 'app' }) {
  const st = await store();
  if (!st) throw new Error('Work hasn’t loaded yet');
  return st.createIdea({ text, project, source });
}
export async function ideaToTask(id) {
  const st = await store();
  const i = st?.ideaById?.(id);
  if (!i) return null;
  if (i.pending) { toast('Still saving this idea. Try again when your PC is reachable'); return null; }
  const r = await call(`/ideas/${i.id}/task`, { project: i.project ?? undefined });
  SYNC.adopt('task', r.task);
  st.putIdea(r.idea);
  return r.task;
}
export async function archiveIdea(id) {
  const st = await store();
  const i = st?.ideaById?.(id);
  if (!i) return null;
  if (i.pending) return null;
  await API.api(`/ideas/${i.id}`, { method: 'DELETE' });
  st.putIdea({ ...i, status: 'archived' });
  return () => API.api(`/ideas/${i.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'open' }) }).then((r) => st.putIdea(r.idea)).catch(() => {});
}
/** GET /projects/:slug → { project, tasks, ideas, jobs, sessions }, with its jobs merged into the store. */
export async function loadProject(slug) { const st = await store(); return st?.loadProject?.(slug) ?? null; }
export const projectInfo = (slug) => storeM?.W?.projects?.get(slug) ?? null;

// ── the night shift: tonight's queued work (Work module collection; its 23:00 job starts them) ──
let nightC = null;
export const night = () => (nightC ??= collection('work/night', { endpoint: '/api/v1/mod/work/night', interval: 0, prefix: 'nt' }));
export const NIGHT_AT = '23:00', NIGHT_REPORT = '07:00';
/** Tonight's date (the evening it runs): after midnight and before 07:00 it is still last night's shift. */
export const nightDate = () => (clock.nowMin() < 7 * 60 ? clock.addDays(clock.today(), -1) : clock.today());
export const tonight = () => night().list().filter((d) => d.date === nightDate() && d.state !== 'cancelled');

// ── live helpers ──
/** Runs fn every ms while Work is on screen and the page is visible. */
export function whileVisible(ms, fn) {
  const t = setInterval(() => { if (G.document?.visibilityState === 'visible') fn(); }, ms);
  return () => clearInterval(t);
}
export { clock, $ };

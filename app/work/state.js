// Work state on the phone: ideas and jobs from the PC (bootstrap, then refreshed), an outbox so a new idea is never
// lost offline, and one change signal every work page listens to.
const { AOS } = window;

export const ACTIVE = ['starting', 'running', 'needs_input'];
export const LIVE = [...ACTIVE, 'idle'];
export const JOB_LABEL = { starting: 'Starting', running: 'Working', needs_input: 'Needs you', idle: 'Waiting for you', stopped: 'Stopped', failed: 'Failed', done: 'Done' };
export const ENGINE = { claude: 'Claude', codex: 'Codex' };

const boot = AOS.boot();
export const W = {
  ideas: boot.ideas ?? [],
  jobs: boot.jobs ?? [],
  projects: new Map(),   // slug → { project, tasks, ideas, jobs, sessions, at } from GET /projects/:slug
  ready: { ideas: Array.isArray(boot.ideas), jobs: Array.isArray(boot.jobs) },
};

const listeners = new Set();
let emitT = 0, sumSig = '';
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function emit() {
  clearTimeout(emitT);
  emitT = setTimeout(() => {
    for (const fn of listeners) { try { fn(); } catch (e) { console.warn('[work] listener', e); } }
    updateDot();
    // Today and Life redraw an app's figures on 'aspect-summary' { id } (the lead's shared event): sent only when
    // Work's own counts move (asks waiting, jobs working, jobs at all)
    const sig = `${W.jobs.filter((j) => j.status === 'needs_input').length}|${W.jobs.filter((j) => j.status === 'running' || j.status === 'starting').length}|${W.jobs.length}`;
    if (sig !== sumSig) { sumSig = sig; document.dispatchEvent(new CustomEvent('aspect-summary', { detail: { id: 'work' } })); }
  }, 16);
}
AOS.onBoot((b) => {
  if (Array.isArray(b.ideas)) { W.ideas = mergeOutbox(b.ideas); W.ready.ideas = true; }
  if (Array.isArray(b.jobs)) { W.jobs = mergeJobs(b.jobs); W.ready.jobs = true; }
  emit();
});
AOS.onLocal(() => emit());

export const isLive = (jobOrId) => {
  const j = typeof jobOrId === 'string' ? W.jobs.find((x) => x.id === jobOrId) : jobOrId;
  return !!j && LIVE.includes(j.status);
};
export const isActive = (j) => !!j && ACTIVE.includes(j.status);
export const liveTaskIds = () => new Set(W.jobs.filter(isLive).flatMap((j) => j.taskIds ?? []));
export const jobById = (id) => W.jobs.find((j) => j.id === id) ?? null;
export const ideaById = (id) => W.ideas.find((i) => i.id === id) ?? null;
export const projectBySlug = (slug) => AOS.data().projects.find((p) => p.slug === slug) ?? null;
/** The open separate copy (git worktree, from code.js's list) a folder is in, if any. */
const normPath = (p) => String(p ?? '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
export function copyFor(folder) {
  if (!folder) return null;
  const f = normPath(folder);
  return (W.worktrees ?? []).find((w) => w.state === 'open' && (f === normPath(w.path) || f.startsWith(normPath(w.path) + '\\'))) ?? null;
}
/** A folder as the app shows it: the last two parts (agentic-jobs\j14, .aos-worktrees\…\slug → its last two). */
export const folderLabel = (p) => (p ? String(p).split(/[\\/]/).filter(Boolean).slice(-2).join('\\') : '');
/** The board lane: the PC says (job.lane); older servers don't, so work it out from the status. */
export const laneOf = (j) => j.lane ?? (j.status === 'done' ? 'completed' : ['starting', 'running'].includes(j.status) ? 'working' : 'attention');

// Jobs keep their newest copy (the job page streams updates in between list refreshes).
function mergeJobs(list) {
  const out = list.map((j) => {
    const mine = W.jobs.find((x) => x.id === j.id);
    return mine && (mine.updatedAt ?? '') > (j.updatedAt ?? '') ? mine : j;
  });
  for (const j of W.jobs) if (!out.some((x) => x.id === j.id) && isLive(j)) out.push(j);
  return out.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}
export function putJob(j) {
  if (!j?.id) return;
  const i = W.jobs.findIndex((x) => x.id === j.id);
  if (i >= 0) W.jobs[i] = { ...W.jobs[i], ...j }; else W.jobs.unshift(j);
  emit();
}
export function putIdea(idea, replaceId = null) {
  const i = W.ideas.findIndex((x) => x.id === (replaceId ?? idea.id));
  if (idea.status === 'archived') { if (i >= 0) W.ideas.splice(i, 1); }
  else if (i >= 0) W.ideas[i] = idea; else W.ideas.unshift(idea);
  emit();
}

export async function loadJobs() {
  if (!AOS.owner || !AOS.real) return;
  try { const r = await AOS.api('/jobs'); W.jobs = mergeJobs(r.jobs ?? []); W.ready.jobs = true; emit(); } catch {}
}
export async function loadIdeas() {
  if (!AOS.real) return;
  try { const r = await AOS.api('/ideas?status=open'); W.ideas = mergeOutbox(r.ideas ?? []); W.ready.ideas = true; emit(); } catch {}
}
export async function loadProject(slug) {
  try {
    const r = await AOS.api(`/projects/${encodeURIComponent(slug)}`);
    W.projects.set(slug, { ...r, at: Date.now() });
    if (r.project) AOS.adopt('project', r.project);
    for (const j of r.jobs ?? []) { const i = W.jobs.findIndex((x) => x.id === j.id); if (i < 0) W.jobs.push(j); }
    emit();
    return r;
  } catch (e) {
    const old = W.projects.get(slug);
    W.projects.set(slug, { ...(old ?? {}), failed: e.status ? `Your PC answered: ${e.message}` : 'Your PC isn’t reachable right now.', at: Date.now() });
    emit();
    return null;
  }
}

// ---------- Ideas outbox: saved on the phone first, sent when the PC answers ----------
const OUT_KEY = 'agentos-app:idea-outbox';
const outbox = () => { try { return JSON.parse(localStorage.getItem(OUT_KEY)) ?? []; } catch { return []; } };
const setOutbox = (v) => { try { localStorage.setItem(OUT_KEY, JSON.stringify(v)); } catch {} };
function mergeOutbox(list) {
  const waiting = outbox().map((o) => ({ id: o.tmp, title: o.title, body: o.body, project: o.project, status: 'open', source: o.source, createdAt: o.createdAt, pending: true }));
  return [...waiting, ...list];
}
/** Split spoken or typed text into a title and a body. */
export function splitIdea(text) {
  const t = String(text ?? '').trim();
  const nl = t.indexOf('\n');
  if (nl > 0) return { title: t.slice(0, nl).trim(), body: t.slice(nl + 1).trim() || null };
  if (t.length <= 140) return { title: t, body: null };
  const m = t.match(/^(.{20,110}?[.!?])\s/);
  return { title: m ? m[1] : `${t.slice(0, 100).trimEnd()}…`, body: t };
}
export async function createIdea({ text, title, body, project = null, source = 'app', recordingId = null }) {
  const parts = title ? { title, body: body ?? null } : splitIdea(text);
  const o = { tmp: `i_tmp${Date.now().toString(36)}`, ...parts, project, source, recordingId, createdAt: new Date().toISOString() };
  setOutbox([...outbox(), o]);
  putIdea({ id: o.tmp, ...parts, project, status: 'open', source, createdAt: o.createdAt, pending: true });
  await flushIdeas();
  return W.ideas.find((i) => i.id === o.tmp || i._tmp === o.tmp) ?? null;
}
let flushing = false;
export async function flushIdeas() {
  if (flushing || !AOS.real) return;
  flushing = true;
  try {
    for (const o of outbox()) {
      try {
        // the key makes a resend safe: if the PC saved it but the answer was lost, the retry gets the same idea back
        const r = await AOS.api('/ideas', { method: 'POST', headers: { 'Idempotency-Key': `idea:${o.tmp}` }, body: JSON.stringify({ title: o.title, body: o.body, project: o.project, source: o.source, recordingId: o.recordingId }) });
        setOutbox(outbox().filter((x) => x.tmp !== o.tmp));
        putIdea({ ...r.idea, _tmp: o.tmp }, o.tmp);
      } catch (e) {
        // Offline, the PC failed, or its server doesn't know /ideas yet: keep it, try later.
        if (!e.status || e.status >= 500 || e.status === 404) break;
        setOutbox(outbox().filter((x) => x.tmp !== o.tmp)); // refused: drop it and say so
        putIdea({ id: o.tmp, status: 'archived' });
        AOS.toast(`Idea not saved: ${e.message}`);
      }
    }
  } finally { flushing = false; }
}
addEventListener('online', flushIdeas);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { flushIdeas(); if (W.jobs.some(isActive)) loadJobs(); } });
setInterval(() => { if (outbox().length) flushIdeas(); }, 30000);
if (outbox().length) { W.ideas = mergeOutbox(W.ideas.filter((i) => !i.pending)); flushIdeas(); }

// While anything is working, keep the job list fresh (the job page itself streams).
setInterval(() => { if (document.visibilityState === 'visible' && W.jobs.some(isActive)) loadJobs(); }, 8000);
if (!W.ready.jobs) loadJobs();
if (!W.ready.ideas) loadIdeas();

// A dot on the Projects tab while a job or an agent terminal works or needs you.
function updateDot() {
  const dot = document.getElementById('projectsDot');
  if (!dot) return;
  const terms = (W.terms ?? []).filter((t) => t.kind === 'claude' || t.kind === 'codex');
  const needs = W.jobs.some((j) => j.status === 'needs_input') || terms.some((t) => t.status === 'needs_input');
  dot.hidden = !W.jobs.some(isActive) && !terms.some((t) => t.status === 'running' || t.status === 'needs_input');
  dot.classList.toggle('needs', needs);
}
updateDot();

/** "2 min ago", "Yesterday 18:20", "12 Oct". */
export function ago(iso) {
  if (!iso) return '';
  const t = Date.parse(iso), s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = new Date(t);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

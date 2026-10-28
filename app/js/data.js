// The shared data every area reads, now live. Same export names and shapes as the prototype's mock (data-demo.js),
// filled from the PC's bootstrap through svc/sync and kept current: after every local edit, server refresh, job update
// and day change the bindings below are refilled in place and `data-changed` fires on the document
// (detail.why: 'boot' | 'local' | 'server' | 'rename' | 'synced' | 'jobs' | 'ideas' | 'agent' | 'day').
// `clock-tick` fires each minute (NOW moved). Arrays and objects keep their identity (they are refilled, not replaced),
// and a task, goal, project or job keeps its object across refreshes, so a reference an area holds stays good.
//
// Real or demo: ?data=demo shows the approved prototype's sample data (data-demo.js) with its clock pinned to
// Thu 22 Oct 2026 17:40, and never syncs. Everything that has no backend yet comes from data-demo.js in real mode too
// and is named in MOCK (with what replaces it in MOCK_INFO), so phase 2 knows exactly what to swap.
//
// Writes go through the functions at the bottom (addTask, updateTask, completeTask, planTask, dropTask, addGoal,
// updateGoal, moveEvent, setScore …): they change the real records, which svc/sync sends to the PC (offline first).
// Changing a view object's fields (t.list = 'done') changes nothing on the PC.
import * as DEMO from './data-demo.js';
import * as clock from './svc/clock.js';
import * as SYNC from './svc/sync.js';
import * as API from './svc/api.js';

const G = globalThis;
const SY = SYNC.state;

// ── real or demo ──────────────────────────────────────────────────────
function pickSource() {
  const q = G.location ? new URLSearchParams(G.location.search).get('data') : null;
  if (q === 'demo' || q === 'real') { API.ls.set(API.KEYS.source, q); return { source: q, fromUrl: q === 'demo' }; }
  return { source: API.ls.get(API.KEYS.source) === 'demo' ? 'demo' : 'real', fromUrl: false };
}
const SRC = pickSource();
/** 'real' (the PC) or 'demo' (the prototype's sample data, nothing syncs). */
export const SOURCE = SRC.source;
export const DEMO_MODE = SOURCE === 'demo';
/** Demo was remembered from an earlier visit (not asked for in this URL): the shell says so. */
export const DEMO_REMEMBERED = DEMO_MODE && !SRC.fromUrl;
if (DEMO_MODE) clock.freeze(Date.UTC(2026, 9, 22, 12, 10));   // Thu 22 Oct 2026, 17:40 in Delhi

/** What still comes from data-demo.js in real mode (no backend yet). MOCK_INFO says what replaces each. */
export const MOCK = new Set(['MODULES.line', 'ME.profile', 'AGENT.heartbeat', 'AGENT.models']);
export const MOCK_INFO = {
  FEED: 'The agent\'s proactive feed. Agent area (phase 2): from Wyn\'s messages, asks and actions (GET /wyn, her feed route).',
  WYN: 'Sample chat and call lines. Agent area: GET /wyn (messages), /wyn/calls.',
  CHAT: 'A job\'s sample conversation. Work area: GET /jobs/:id/turns and the job stream (svc/live.stream).',
  'MODULES.line': 'More\'s module subtitles. Real mode draws each module\'s own figure() (aos.js); these lines are demo only.',
  'ME.profile': 'city, home, college, year: no profile on the server yet (the owner sees the prototype\'s facts, members see none).',
  'AGENT.heartbeat': 'Heartbeat minutes. Agent area: her heartbeat settings.',
  'AGENT.models': 'The cheap and deep models she routes between. Agent area: GET /wyn/models and her prefs.',
};

// ── the bindings (prototype names) ────────────────────────────────────
const C = (x) => structuredClone(x);
const refill = (arr, items) => { arr.length = 0; arr.push(...items); return arr; };
const reset = (obj, next) => { for (const k of Object.keys(obj)) delete obj[k]; Object.assign(obj, next); return obj; };

export let NOW = DEMO_MODE ? DEMO.NOW : clock.nowMin();
export let TODAY_LABEL = DEMO_MODE ? C(DEMO.TODAY_LABEL) : clock.label();
export let ME = DEMO_MODE ? C(DEMO.ME) : { name: '', first: '', initial: '', city: '', home: '', college: '', year: '' };
export let AGENT = DEMO_MODE ? C(DEMO.AGENT) : { name: 'Wyn', product: 'Wyn', pronoun: 'she', heartbeat: DEMO.AGENT.heartbeat, models: C(DEMO.AGENT.models), on: false };
export const FAMILIES = DEMO.FAMILIES;
export let ASPECTS = C(DEMO.ASPECTS).map((a) => (DEMO_MODE ? a : { ...a, score: null }));
export const aspect = (id) => ASPECTS.find((a) => a.id === id);
// real mode: the people store's persons (aspects/people-store.js refills this in place; /api/v1/mod/people/persons)
export let PEOPLE = DEMO_MODE ? C(DEMO.PEOPLE) : [];
export const person = (id) => PEOPLE.find((p) => p.id === id);
export let AREAS = DEMO_MODE ? C(DEMO.AREAS) : { none: C(DEMO.AREAS.none) };
export const area = (slug) => AREAS[slug] ?? AREAS.none;
export let EVENTS = DEMO_MODE ? C(DEMO.EVENTS) : [];
export let TASKS = DEMO_MODE ? C(DEMO.TASKS) : [];
export const LISTS = DEMO.LISTS;
export let JOBS = DEMO_MODE ? C(DEMO.JOBS) : [];
export const LANES = DEMO_MODE ? DEMO.LANES : [...DEMO.LANES.slice(0, 3), ['stopped', 'Stopped'], ...DEMO.LANES.slice(3)];
export let BUILDERS = DEMO_MODE ? C(DEMO.BUILDERS) : [];
export const SHIP = { ...DEMO.SHIP, sent: ['With the Builder', 'var(--blue)'], committed: ['Committed', 'var(--ink-2)'] };
export let PROJECTS = DEMO_MODE ? C(DEMO.PROJECTS) : [];
export const project = (slug) => PROJECTS.find((p) => p.slug === slug);
export let IDEAS = DEMO_MODE ? C(DEMO.IDEAS) : [];
export const CHAT = DEMO_MODE ? DEMO.CHAT : {};   // real: a job's thread is its stream (work-live.js, GET /jobs/:id + SSE)
export let GOALS = DEMO_MODE ? C(DEMO.GOALS) : [];
export let HORIZONS = C(DEMO.HORIZONS);
// Savings pots, shared by Money and Family. Real: Money fills it from its funds collection (aspects/money-data.js),
// keyed by the fund's key; a pot not made yet is a placeholder ({ placeholder: true, target: 0 }) so a captured
// FUNDS.anniversary keeps its object. Demo: the prototype's pot, kept in step with Money's demo data.
export const FUNDS = DEMO_MODE ? DEMO.FUNDS : { anniversary: { id: 'anniversary', name: 'Anniversary fund', saved: 0, target: 0, month: 0, monthly: 0, thisMonth: 0, goal: null, aspect: 'family', shared: ['family'], placeholder: true, real: false } };
export let WHEEL = ASPECTS.map((a) => [a.name, a.score, { health: 'self', work: 'work', people: 'people' }[a.fam]]);
// The agent's feed: her open asks, nudges, alarms and what she did today. Real mode: refilled in place by the Agent
// area (agent-state.js) from GET /wyn/home, then data-changed fires with why 'agent'.
export const FEED = DEMO_MODE ? DEMO.FEED : [];
// Content: real mode starts empty and content-data.js fills it from the PC's content module (the two channels are fixed)
export const CHANNELS = DEMO_MODE ? DEMO.CHANNELS : ['@northwindstudio', '@example_creator'];
export const CONTENT = DEMO_MODE ? DEMO.CONTENT : { inbox: [], pack: { day: '', scripts: 0, setups: [] }, edits: [], posts: [], stats: { followers: null, goal: null, week: 0, weekGoal: 7, streak: 0 } };
export const MODULES = DEMO.MODULES;
// Her sample lines (demo only). Real mode: her thread and calls are the Agent area's (GET /wyn, /wyn/calls).
export const WYN = DEMO_MODE ? DEMO.WYN : { chat: [], calls: [] };

// ── more than the prototype had ───────────────────────────────────────
/** Who is signed in: { id, email, name, role, owner }. null in demo. */
export let USER = null;
/** The bootstrap as the PC last sent it (aiPlan, sleep, estimates, life meta …). null in demo. */
export const boot = () => SY.boot;
/** Each loaded day's events (prototype event shape, `date` set), keyed by ISO date. Today is EVENTS. */
export const DAYS = new Map();
/** All-day events, by date (the timeline leaves them out). */
export const ALL_DAY = new Map();
/** A day's events: real for the loaded week (today + 6), [] for other days in real mode, the pattern in demo (null). */
export function eventsOn(iso) {
  if (DEMO_MODE) return null;
  if (iso === clock.today()) return EVENTS;
  return DAYS.get(iso) ?? [];
}
export const hasDay = (iso) => DEMO_MODE || DAYS.has(iso) || iso === clock.today();
/** The area → aspects map from Life (life_area_aspects): which part of the wheel each area feeds. */
export let AREA_ASPECTS = {};
export const task = (id) => TASKS.find((t) => t.id === id);
export const goal = (id) => GOALS.find((g) => g.id === id);
export const job = (id) => JOBS.find((j) => j.id === id);
export const ready = { boot: false, work: false };

// ── shaping the real data into the prototype's shapes ─────────────────
const WD = clock.WEEKDAYS.map((w) => w.slice(0, 3));
const shortDay = (iso) => { const p = clock.dparts(iso); return `${WD[p.dow]} ${p.day}`; };
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const PALETTE = ['#2bb39a', '#7c5cff', '#5b8def', '#f2b134', '#e0559b', '#d9822b', '#4caf50', '#3d9bff'];
const hashColor = (s) => PALETTE[[...String(s)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % PALETTE.length];
const sleepy = (title) => /\bsleep\b/i.test(title ?? '');
const shortTitle = (t) => String(t ?? '').replace(/\s*\([^)]*\)/g, '').trim() || String(t ?? '');
const firstAspect = (areaSlug) => AREA_ASPECTS[areaSlug]?.[0] ?? null;

function learnedMinutes(title, areaSlug) {
  const L = SY.boot?.estimates ?? { byArea: {}, byWord: {} };
  const words = [...new Set(String(title).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3))];
  const hits = words.map((w) => L.byWord?.[w]).filter(Boolean);
  if (hits.length) return Math.round(hits.reduce((a, h) => a + h.minutes, 0) / hits.length / 5) * 5;
  return L.byArea?.[areaSlug]?.minutes ?? null;
}

function shapeEvent(ev, date, isToday) {
  const title = sleepy(ev.title) ? 'Sleep' : String(ev.title ?? 'Busy');
  const v = {
    id: ev.id, title, full: ev.title ?? '', start: Math.round(clock.toMin(ev.start, date)), end: Math.round(clock.toMin(ev.end, date)),
    area: ev.area ?? null, aspect: firstAspect(ev.area), where: ev.location ? String(ev.location) : undefined, sleep: sleepy(ev.title),
    allDay: !!ev.allDay, editable: ev.editable !== false, source: ev.source ?? null, startIso: ev.start, endIso: ev.end,
  };
  if (!isToday) v.date = date;
  return v;
}

const views = { task: new Map(), goal: new Map(), project: new Map(), job: new Map(), idea: new Map() };
/** Reuse the object an area may hold for this id, refilled with the new fields. */
const keep = (kind, id, fields) => { const m = views[kind]; let v = m.get(id); if (!v) { v = {}; m.set(id, v); } return reset(v, fields); };
const prune = (kind, live) => { for (const id of views[kind].keys()) if (!live.has(id)) views[kind].delete(id); };

function goalStats(g, tasks, today) {
  const linked = tasks.filter((t) => t.goal === g.id && t.status !== 'dropped');
  const done = linked.filter((t) => t.status === 'done').length;
  const p = g.status === 'done' ? 1 : g.progressMode === 'auto' && linked.length ? done / linked.length : (g.progress || 0) / 100;
  let el = 0;
  if (g.start && g.end) {
    const s = Date.parse(`${g.start}T00:00:00Z`), e = Date.parse(`${g.end}T00:00:00Z`) + 864e5;
    const n = Date.parse(`${today}T00:00:00Z`) + clock.minutes() * 60000;
    el = Math.min(1, Math.max(0, (n - s) / (e - s)));
  }
  let verdict = 'On pace';
  if (p >= 1) verdict = 'Done';
  else if (!g.end) verdict = 'No deadline';
  else if (p === 0 && el < 0.25) verdict = 'Not started';
  else if (el - p > 0.2) verdict = 'Behind pace';
  return { pace: p, time: el, verdict, tasks: [done, linked.length] };
}
const HZ_MAP = { day: 'week', week: 'week', month: 'month', quarter: 'quarter', year: 'year', decade: 'later', life: 'life' };

function shapeHorizons(list, today) {
  const by = Object.fromEntries((list ?? []).map((h) => [h.horizon, h]));
  const left = (end) => { const n = clock.daysBetween(today, end); return n <= 0 ? 'Last day' : `${plural(n + 1, 'day')} left`; };
  const p = clock.dparts(today);
  const monthEnd = new Date(Date.UTC(p.year, p.month + 1, 0)).toISOString().slice(0, 10);
  const weekEnd = clock.addDays(today, 6 - ((p.dow + 6) % 7));
  return [
    ['week', 'This week', `${by.week?.label ?? ''}${by.week ? ', ' : ''}${left(weekEnd)}`],
    ['month', clock.MONTHS[p.month], left(monthEnd)],
    ['quarter', 'This quarter', by.quarter?.label ?? `Q${Math.floor(p.month / 3) + 1} ${p.year}`],
    ['year', 'This year', by.year?.label ?? String(p.year)],
    ['later', 'Later', 'Years out'],
    ['life', 'Lifetime', 'The whole arc'],
  ];
}

function shapeTask(t, today, goalViews) {
  const sd = t.scheduled?.start ? clock.dateOfIso(t.scheduled.start) : null;
  const day = sd ?? t.due ?? null;
  let list;
  if (t.status === 'done') list = 'done';
  else if (t.status === 'doing') list = 'doing';
  else if (t.status === 'inbox') list = 'inbox';
  else if (!day) list = 'nodate';
  else if (day < today) list = 'overdue';
  else if (day === today) list = 'today';
  else list = 'upcoming';
  const v = { ...C(t), list, aspect: null };
  const g = t.goal ? goalViews.get(t.goal) : null;
  v.aspect = g?.aspects?.[0] ?? firstAspect(t.area);
  const len = t.estimateMinutes ?? (t.scheduled?.start && t.scheduled?.end ? Math.round((Date.parse(t.scheduled.end) - Date.parse(t.scheduled.start)) / 60000) : null);
  if (len) v.len = len;
  if (!t.estimateMinutes) { const est = learnedMinutes(t.title, t.area); if (est) v.est = est; }
  if (list === 'overdue') { const n = clock.daysBetween(day, today); v.late = n === 1 ? '1 day late' : `${n} days late`; }
  if (sd) { v.at = Math.round(clock.toMin(t.scheduled.start, sd)); v.date = sd; }
  else if (t.due) v.date = t.due;
  if (list === 'today') v.when = sd ? clock.hm(v.at) : 'Today';
  else if (list === 'upcoming') v.when = shortDay(day);
  if (t.status === 'doing' && t.startedAt) v.spent = Math.max(0, Math.round((clock.nowMs() - Date.parse(t.startedAt)) / 60000));
  if (t.jobIds?.length) v.job = [...t.jobIds].sort((a, b) => Number(String(b).slice(1)) - Number(String(a).slice(1)))[0];
  v.doneToday = t.status === 'done' && (t.completedAt ? clock.dateOfIso(t.completedAt) === today : sd === today);
  return v;
}

function shapeProject(p, tasks, ideas) {
  const a = p.area ? AREAS[p.area] : null;
  const name = String(p.name ?? p.slug);
  return {
    ...C(p), slug: p.slug, name, icon: p.icon ? String(p.icon) : name.trim()[0]?.toUpperCase() ?? '•', area: p.area ?? null,
    color: p.color ?? a?.color ?? hashColor(p.slug), folder: p.folder ?? '', desc: p.description ?? '',
    tasks: tasks.filter((t) => t.project === p.slug && !['done', 'dropped'].includes(t.status)).length,
    ideas: ideas.filter((i) => i.project === p.slug && i.status !== 'archived').length,
    jobs: p.counts?.jobs ?? 0, status: p.status ?? 'active',
  };
}

const MODEL_NAME = { opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku', fable: 'Fable' };
export const modelLabel = (m) => {
  if (!m) return '';
  const s = String(m);
  const k = Object.keys(MODEL_NAME).find((x) => s.toLowerCase().includes(x));
  if (k) { const v = s.match(/(\d+(?:[.-]\d+)?)/)?.[1]?.replace('-', '.'); return v ? `${MODEL_NAME[k]} ${v}` : MODEL_NAME[k]; }
  return s;
};
/** The board section a real job sits in (work/board.js sectionOf), in the prototype's lane names. */
export function laneOf(j) {
  const lane = j.lane ?? (j.status === 'done' ? 'completed' : ['starting', 'running'].includes(j.status) ? 'working' : 'attention');
  if (lane === 'archived') return 'archive';
  if (lane === 'working') return 'working';
  if (j.status === 'needs_input') return 'needs';
  if (j.review) return 'review';
  if (lane === 'completed') return 'done';
  return j.status === 'stopped' ? 'stopped' : 'needs';
}
const SHIP_KEY = { none: 'none', queued: 'queued', sent: 'sent', committed: 'committed', building: 'building', live: 'live', failed: 'failed' };
function shapeJob(j, tasks) {
  const lane = laneOf(j);
  const ask = j.status === 'needs_input' && j.pending
    ? { kind: j.pending.kind === 'plan' ? 'plan' : (j.pending.kind === 'question' || j.pending.form) ? 'form' : 'permission', text: String(j.pending.title ?? 'It is waiting for your OK.') }
    : undefined;
  const pr = j.progress?.total ? { done: j.progress.done ?? 0, total: j.progress.total, step: j.progress.active ?? j.progress.title ?? '', stage: j.progress.stage ?? '' } : undefined;
  const warm = j.cache?.warmUntil ? Math.max(0, Math.round((Date.parse(j.cache.warmUntil) - clock.nowMs()) / 60000)) : 0;
  const ws = j.workspace;
  const task = j.taskIds?.[0];
  const last = String(j.lastText ?? j.summary ?? j.error ?? '').replace(/\s+/g, ' ').trim();
  const v = {
    id: j.id, title: String(j.title ?? j.id), agent: j.engine === 'codex' ? 'codex' : 'claude', model: modelLabel(j.model) || capFirst(j.engine ?? ''),
    effort: capFirst(j.effort ?? ''), lane, project: j.project ?? null, worktree: !!ws?.branch, cache: j.cache?.state === 'warm' ? warm : 0,
    ago: clock.ago(j.updatedAt ?? j.createdAt), last: last.length > 160 ? `${last.slice(0, 157)}…` : last || undefined,
    star: !!j.starred, queued: j.queue?.length || undefined, status: j.status, stopped: j.status === 'stopped',
    ship: j.ship?.state ? SHIP_KEY[j.ship.state] ?? j.ship.state : undefined, role: j.role ?? null, raw: j,
  };
  if (ask) v.ask = ask;
  if (pr) v.progress = pr;
  if (ws?.files) v.diff = [ws.add ?? 0, ws.del ?? 0, ws.files];
  if (task) { v.task = task; const t = tasks.find((x) => x.id === task); if (t?.goal) v.goal = t.goal; }
  return v;
}
function shapeIdea(i) {
  return { ...C(i), id: i.id, title: String(i.title ?? ''), project: i.project ?? null, ago: clock.ago(i.createdAt), inbox: !i.project };
}

// The jobs and ideas Work keeps live (work/state.js: polled while anything runs, streamed on the job page, the idea
// outbox merged in). Until Work has loaded they come from the bootstrap.
let workState = null;
/** aos.js hands over work/state.js once Work has loaded; from then on JOBS and IDEAS follow it. */
export function bindWork(st) {
  if (!st?.W) return;
  workState = st;
  ready.work = true;
  // Work emits on every poll; data-changed 'jobs' fires only when a job or an idea really changed
  let sig = '';
  const changedNow = () => { const s = JSON.stringify([st.W.jobs?.map((j) => [j.id, j.status, j.lane, j.updatedAt, j.pending?.title]), st.W.ideas?.map((i) => [i.id, i.updatedAt, i.status, i.pending])]); if (s === sig) return false; sig = s; return true; };
  st.onChange?.(() => { if (!changedNow()) return; deriveWork(); fire('jobs'); });
  changedNow();
  deriveWork();
  fire('jobs');
}
function deriveWork() {
  const tasks = SY.data?.tasks ?? [];
  const rawJobs = workState?.W?.jobs ?? SY.boot?.jobs ?? [];
  const rawIdeas = (workState?.W?.ideas ?? SY.boot?.ideas ?? []).filter((i) => i.status !== 'archived');
  const liveJ = new Set(), liveI = new Set();
  refill(JOBS, rawJobs.filter((j) => j.role !== 'builder').map((j) => { liveJ.add(j.id); return keep('job', j.id, shapeJob(j, tasks)); }));
  prune('job', liveJ);
  refill(BUILDERS, rawJobs.filter((j) => j.role === 'builder' && j.lane !== 'archived').map((j) => ({
    id: j.id, project: j.builderKey && j.builderKey !== '_global' ? j.builderKey : null, name: String(j.title ?? '').replace(/^Builder\s*·\s*/, '') || 'Builder',
    model: modelLabel(j.model), effort: capFirst(j.effort ?? ''), state: ['starting', 'running'].includes(j.status) ? 'building' : 'idle',
    last: String(j.lastText ?? j.summary ?? '').replace(/\s+/g, ' ').slice(0, 120), raw: j,
  })));
  refill(IDEAS, rawIdeas.map((i) => { liveI.add(i.id); return keep('idea', i.id, shapeIdea(i)); }));
  prune('idea', liveI);
}

let agentPrefs = API.ls.json('agentos-app:agent') ?? null;
function deriveWho() {
  const u = SY.user;
  if (!u) return;
  const owner = u.role === 'owner';
  USER = { id: u.id, email: u.email, name: u.name ?? null, role: u.role, owner, google: !!u.google, hasPassword: u.hasPassword !== false };
  const first = String(u.name || u.email || '').split(/[\s@._-]+/).filter(Boolean)[0] ?? '';
  reset(ME, {
    id: u.id, email: u.email, role: u.role, owner,
    name: u.name || capFirst(first), first: capFirst(first), initial: (first[0] ?? '?').toUpperCase(),
    // no profile on the server yet: the owner keeps the prototype's facts, a member gets none (MOCK 'ME.profile')
    city: owner ? DEMO.ME.city : '', home: owner ? DEMO.ME.home : '', college: owner ? DEMO.ME.college : '', year: owner ? DEMO.ME.year : '',
  });
  reset(AGENT, {
    name: owner ? (agentPrefs?.name || 'Wyn') : 'Wyn', product: 'Wyn', pronoun: 'she',
    heartbeat: DEMO.AGENT.heartbeat, models: C(DEMO.AGENT.models), on: owner && SY.boot?.ai !== false,
  });
}

/** Refill every binding from the sync state. */
function derive() {
  const b = SY.boot, d = SY.data;
  if (!b || !d) return;
  const today = clock.today();
  NOW = clock.nowMin();
  TODAY_LABEL = clock.label(today);
  reset(AREAS, { ...Object.fromEntries((b.areas ?? []).map((a) => [a.slug, { name: a.name, color: a.color ?? hashColor(a.slug) }])), none: C(DEMO.AREAS.none) });
  AREA_ASPECTS = C(b.life?.areaAspects ?? {});
  // the wheel: the latest scoring (life_snapshots); null until he scores
  const snaps = [...(d.life?.snapshots ?? [])].sort((x, y) => x.date.localeCompare(y.date));
  const latest = snaps.at(-1) ?? null;
  for (const a of ASPECTS) a.score = latest?.scores?.[a.id] ?? null;
  refill(WHEEL, ASPECTS.map((a) => [a.name, a.score, { health: 'self', work: 'work', people: 'people' }[a.fam]]));
  LIFE.latest = latest; LIFE.snapshots = snaps;
  // goals first (tasks take their aspect from their goal)
  const tasks = d.tasks.filter((t) => t.status !== 'dropped');
  const gv = new Map();
  const liveG = new Set();
  refill(GOALS, d.goals.filter((g) => g.status !== 'dropped').map((g) => {
    liveG.add(g.id);
    const aspects = g.aspects?.length ? [...g.aspects] : (AREA_ASPECTS[g.area]?.length ? [...AREA_ASPECTS[g.area]] : ['mission']);
    const v = keep('goal', g.id, { ...C(g), horizon: HZ_MAP[g.horizon] ?? g.horizon, realHorizon: g.horizon, aspects, metric: g.measure ? capFirst(g.measure) : undefined, ...goalStats(g, tasks, today) });
    gv.set(g.id, v);
    return v;
  }));
  prune('goal', liveG);
  refill(HORIZONS, shapeHorizons(b.goals?.horizons, today));
  const liveT = new Set();
  refill(TASKS, tasks.map((t) => { liveT.add(t.id); return keep('task', t.id, shapeTask(t, today, gv)); }));
  prune('task', liveT);
  const ideasRaw = workState?.W?.ideas ?? b.ideas ?? [];
  const liveP = new Set();
  refill(PROJECTS, d.projects.filter((p) => p.status !== 'dropped').map((p) => { liveP.add(p.slug); return keep('project', p.slug, shapeProject(p, d.tasks, ideasRaw)); }));
  prune('project', liveP);
  // the calendar: today in EVENTS, the rest of the loaded week in DAYS
  DAYS.clear(); ALL_DAY.clear();
  for (const day of d.days) {
    const evs = (day.events ?? []).map((e) => shapeEvent(e, day.date, day.date === today));
    ALL_DAY.set(day.date, evs.filter((e) => e.allDay));
    const timed = evs.filter((e) => !e.allDay).sort((x, y) => x.start - y.start || x.end - y.end);
    if (day.date === today) refill(EVENTS, timed); else DAYS.set(day.date, timed);
  }
  if (!d.days.some((x) => x.date === today)) refill(EVENTS, []);
  deriveWork();
  deriveWho();
}
/** The wheel's history (life_snapshots), oldest first, and the latest scoring. */
export const LIFE = { latest: null, snapshots: [] };

const fire = (why) => G.document?.dispatchEvent(new CustomEvent('data-changed', { detail: { why } }));
/** fn(why) after every change; returns unsubscribe. */
export function onData(fn) { const h = (e) => fn(e.detail?.why); G.document?.addEventListener('data-changed', h); return () => G.document?.removeEventListener('data-changed', h); }

/** Fill the bindings once the engine has the bootstrap (svc/boot.js calls this before any area loads). */
export function hydrate() {
  if (DEMO_MODE) { ready.boot = true; return; }
  derive();
  ready.boot = true;
  SYNC.onChange((why, detail) => {
    if (why === 'rename' && detail?.from) {
      const m = views[detail.kind === 'task' ? 'task' : 'goal'];
      if (m.has(detail.from)) { m.set(detail.to, m.get(detail.from)); m.delete(detail.from); }
    }
    derive();
    fire(why);
  });
  clock.onMinute(() => {
    NOW = clock.nowMin();
    G.document?.dispatchEvent(new CustomEvent('clock-tick', { detail: { now: NOW } }));
  });
  clock.onDay(() => { derive(); fire('day'); SYNC.refresh(true); });
  if (USER?.owner) loadAgentName();
}
async function loadAgentName() {
  try {
    const st = await API.api('/wyn?after=999999999', { timeout: 8000 });
    const name = st?.prefs?.name;
    if (name && name !== agentPrefs?.name) {
      agentPrefs = { name };
      API.ls.set('agentos-app:agent', JSON.stringify(agentPrefs));
      deriveWho();
      fire('agent');
    }
  } catch {}
}

// ── writes (real records; sync sends them) ────────────────────────────
const demoChange = () => fire('local');
const nowIso = () => new Date(clock.nowMs()).toISOString();
const rawTask = (id) => SY.data?.tasks.find((t) => t.id === id) ?? null;
const rawGoal = (id) => SY.data?.goals.find((g) => g.id === id) ?? null;
/** A time on a day as the PC stores it: { start, end } ISO, from minutes after that day's midnight. */
export const slot = (date, at, len = 30) => ({ start: clock.toIso(date, at), end: clock.toIso(date, at + Math.max(5, len)) });

/**
 * New task. fields: title, area, project, goal, due ('YYYY-MM-DD'), at (minutes, with date: today by default),
 * len (minutes), estimateMinutes, notes, priority, status. No project, date or time means the inbox.
 */
export function addTask(f = {}) {
  const title = String(f.title ?? '').trim();
  if (!title) throw new Error('A task needs a title.');
  if (DEMO_MODE) {
    const v = { id: `t${Date.now().toString(36)}`, title, area: f.area ?? null, aspect: f.aspect ?? null, list: f.at != null || f.due === clock.today() ? 'today' : f.due ? 'upcoming' : 'inbox', when: f.at != null ? clock.hm(f.at) : f.due ? shortDay(f.due) : undefined, len: f.len ?? undefined, goal: f.goal, project: f.project };
    TASKS.push(v); demoChange(); return v;
  }
  const date = f.date ?? f.due ?? (f.at != null ? clock.today() : null);
  const scheduled = f.scheduled ?? (f.at != null ? slot(date, f.at, f.len ?? f.estimateMinutes ?? 30) : null);
  const t = {
    id: SYNC.tempId('n'), title, area: f.area ?? null, project: f.project ?? null, goal: f.goal ?? null,
    due: f.due ?? (scheduled ? null : date), scheduled, estimateMinutes: f.estimateMinutes ?? f.len ?? null, priority: f.priority ?? 2,
    notes: f.notes ?? null, owner: 'me', startedAt: null, completedAt: null, createdAt: nowIso(),
  };
  t.status = f.status ?? (t.project == null && t.due == null && t.scheduled == null ? 'inbox' : 'todo');
  SY.data.tasks.push(t);
  SYNC.save('local');
  return task(t.id);
}
/** Change a task's real fields: title, status, area, project, goal, due, scheduled, estimateMinutes, priority, notes. */
export function updateTask(id, patch = {}) {
  if (DEMO_MODE) { const v = task(id); if (v) { Object.assign(v, patch); demoChange(); } return v; }
  const t = rawTask(id);
  if (!t) return null;
  const p = { ...patch };
  if ('status' in p && p.status !== t.status) {
    if (p.status === 'done') p.completedAt ??= nowIso(); else if (t.status === 'done') p.completedAt = null;
    if (p.status === 'doing') p.startedAt ??= t.startedAt ?? nowIso();
  }
  Object.assign(t, p);
  SYNC.save('local');
  return task(id);
}
export function completeTask(id, done = true) {
  if (DEMO_MODE) { const v = task(id); if (!v) return null; if (done) { v._was ??= v.list; v.list = 'done'; v.doneToday = true; } else { v.list = v._was ?? 'today'; v.doneToday = false; delete v._was; } demoChange(); return v; }
  const t = rawTask(id);
  if (!t) return null;
  return updateTask(id, done ? { status: 'done' } : { status: t.scheduled || t.due || t.project ? 'todo' : 'inbox' });
}
export function startTask(id) {
  if (DEMO_MODE) { const v = task(id); if (v) { v.list = 'doing'; demoChange(); } return v; }
  return updateTask(id, { status: 'doing' });
}
/**
 * Give a task a day and/or a time. date 'YYYY-MM-DD' (default today); at minutes after that day's midnight (null keeps
 * it a day task: due that day, no time); len minutes (default its estimate, else 30).
 */
export function planTask(id, { date = clock.today(), at = null, len = null } = {}) {
  if (DEMO_MODE) { const v = task(id); if (v) { v.list = date === clock.today() ? 'today' : 'upcoming'; v.when = at != null && date === clock.today() ? clock.hm(at) : date === clock.today() ? 'Today' : shortDay(date); demoChange(); } return v; }
  const t = rawTask(id);
  if (!t) return null;
  const l = len ?? t.estimateMinutes ?? (t.scheduled ? Math.round((Date.parse(t.scheduled.end) - Date.parse(t.scheduled.start)) / 60000) : 30);
  const patch = at == null ? { due: date, scheduled: null } : { due: date, scheduled: slot(date, at, l) };
  if (t.status === 'inbox') patch.status = 'todo';
  if (t.status === 'doing' && date !== clock.today()) patch.status = 'todo';
  return updateTask(id, patch);
}
/** Take the time off a task (it stays due on its day). */
export function unplanTask(id) { const t = rawTask(id); if (!t || DEMO_MODE) return task(id); const date = t.scheduled ? clock.dateOfIso(t.scheduled.start) : t.due; return updateTask(id, { scheduled: null, due: date ?? null }); }
/** Drop a task (the PC keeps it as dropped). Returns an undo function. */
export function dropTask(id) {
  if (DEMO_MODE) { const i = TASKS.findIndex((t) => t.id === id); const [v] = i >= 0 ? TASKS.splice(i, 1) : []; demoChange(); return () => { if (v) { TASKS.splice(i, 0, v); demoChange(); } }; }
  const t = rawTask(id);
  if (!t) return () => {};
  const was = t.status;
  // status 'dropped' (not a removal), so undo is one more change instead of a second task
  updateTask(id, { status: 'dropped' });
  return () => { const x = rawTask(id); if (x) updateTask(x.id, { status: was }); };
}

/** New goal: title, horizon (week|month|quarter|year|decade|life), area, aspects, parent, measure, due, notes. */
export function addGoal(f = {}) {
  const title = String(f.title ?? '').trim();
  if (!title) throw new Error('A goal needs a title.');
  if (DEMO_MODE) { const v = { id: `g${Date.now().toString(36)}`, title, horizon: f.horizon ?? 'month', aspects: f.aspects ?? ['mission'], area: f.area ?? null, pace: 0, time: 0, verdict: 'Not started', tasks: [0, 0] }; GOALS.push(v); demoChange(); return v; }
  const horizon = f.horizon === 'later' ? 'decade' : (f.horizon ?? 'month');
  const g = { id: SYNC.tempId('n'), title, horizon, period: f.period ?? null, area: f.area ?? null, aspects: f.aspects ?? null, status: 'active', progress: 0, progressMode: 'auto', measure: f.measure ?? null, due: f.due ?? null, notes: f.notes ?? null, parent: f.parent ?? null, start: f.start ?? clock.today(), end: f.end ?? null };
  SY.data.goals.push(g);
  SYNC.save('local');
  return goal(g.id);
}
export function updateGoal(id, patch = {}) {
  if (DEMO_MODE) { const v = goal(id); if (v) { Object.assign(v, patch); demoChange(); } return v; }
  const g = rawGoal(id);
  if (!g) return null;
  const p = { ...patch };
  if (p.horizon === 'later') p.horizon = 'decade';
  Object.assign(g, p);
  SYNC.save('local');
  return goal(id);
}

/** Move or re-tag a calendar event: { start, end } in minutes on its day (or ISO), and/or { area }. */
export function moveEvent(id, { start, end, area: a } = {}) {
  if (DEMO_MODE) { const e = EVENTS.find((x) => x.id === id); if (e) { if (start != null) e.start = start; if (end != null) e.end = end; if (a !== undefined) e.area = a; demoChange(); } return e; }
  let hit = null, date = null;
  for (const d of SY.data.days) { const e = d.events.find((x) => x.id === id); if (e) { hit = e; date = d.date; break; } }
  if (!hit) return null;
  // minutes are on the first day that has it; the ISO is absolute, so every copy (an overnight event sits in two days) gets the same
  const s = start == null ? null : typeof start === 'number' ? clock.toIso(date, start) : start;
  const en = end == null ? null : typeof end === 'number' ? clock.toIso(date, end) : end;
  for (const d of SY.data.days) for (const e of d.events) {
    if (e.id !== id) continue;
    if (s != null) e.start = s;
    if (en != null) e.end = en;
    // the PC applies an override per event; the same area on every event with this title is an area rule (POST /areas/:slug/rules)
    if (a !== undefined) e.area = a;
  }
  SYNC.save('local');
  return DAYS.get(date)?.find((e) => e.id === id) ?? EVENTS.find((e) => e.id === id) ?? null;
}

/** Score one part of the wheel (0–10, halves). Saves today's scoring as a snapshot the PC keeps (life_snapshots). */
export function setScore(id, v) {
  const i = ASPECTS.findIndex((a) => a.id === id);
  if (i < 0) return;
  if (DEMO_MODE) { ASPECTS[i].score = v; WHEEL[i][1] = v; demoChange(); return; }
  const today = clock.today();
  const snaps = SY.data.life.snapshots;
  let s = snaps.find((x) => x.date === today && x.source === 'app');
  if (!s) {
    const base = LIFE.latest?.scores ?? {};
    s = { date: today, source: 'app', scores: { ...base } };
    snaps.push(s);
  }
  s.scores = { ...s.scores, [id]: Math.max(0, Math.min(10, Math.round(Number(v) * 2) / 2)) };
  SYNC.save('local');
}

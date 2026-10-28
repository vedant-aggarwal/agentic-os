// svc/sync: the shipping app's offline engine for the core data (legacy-app/app.js:88-374), with the UI taken out.
// The bootstrap is cached on the phone; edits are made to `data` and diffed field by field against `base` (the last
// state the PC confirmed), then sent in order: goals, tasks, projects, life snapshots, event moves. Waiting edits
// survive a reload and an offline start, and are replayed on top of fresh server data (rebase: the phone's touched
// fields win, the PC wins everything else). Temp ids (n…) are renamed to the server's ids after a create.
//
//   start({ demo }) → { boot, offline }        refresh(force?)   save(why?)   flush()   adopt(kind, obj)
//   state.data { days, tasks, goals, projects, life: { snapshots } }   state.boot (the whole bootstrap)
//   onChange(fn(why))  why: 'boot' | 'local' | 'server' | 'rename' | 'synced'      onBoot(fn(boot))   onLocal(fn)
//   pending() → { dirty, syncing, fails }       hold() → release()  (keeps a refresh from landing under the finger)
//
// localStorage keys are the shipping app's (agentos-app:boot, :state = { user, date, data, base, dirty }), so an
// updated install keeps its session and its queued edits.
import * as API from './api.js';
import * as clock from './clock.js';

const G = globalThis;
export const SERVER_ID = /^[tg]\d+$/;
export const TASK_KEYS = ['title', 'status', 'area', 'project', 'goal', 'due', 'scheduled', 'estimateMinutes', 'priority', 'notes', 'startedAt', 'completedAt', 'parent', 'star', 'repeat'];
export const GOAL_KEYS = ['title', 'horizon', 'period', 'area', 'aspects', 'status', 'progress', 'progressMode', 'measure', 'due', 'notes', 'parent'];
export const PROJECT_KEYS = ['name', 'area', 'status', 'deadline', 'link'];

export const state = {
  source: 'real',      // 'real' | 'demo' (demo never talks to the PC)
  boot: null,          // the bootstrap as the PC last sent it (or the cached copy)
  user: null,
  offline: false,      // started from the cached bootstrap
  data: null,          // what the app shows and edits
  base: null,          // the last state the PC confirmed (pickSync shape)
  dirty: false,
  syncing: false,
  fails: 0,
  lastSync: 0,
};

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const clone = (x) => (x == null ? x : structuredClone(x));
const changes = (from, to, keys) => Object.fromEntries(keys.filter((k) => !same(from?.[k], to[k])).map((k) => [k, clone(to[k] ?? null)]));
export const tempId = (prefix = 'n') => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ── listeners ─────────────────────────────────────────────────────────
const changeSubs = new Set(), bootSubs = new Set(), localSubs = new Set();
const call = (set, ...a) => { for (const fn of set) { try { fn(...a); } catch (e) { console.warn('[sync] listener', e); } } };
export const onChange = (fn) => { changeSubs.add(fn); return () => changeSubs.delete(fn); };
export const onBoot = (fn) => { bootSubs.add(fn); return () => bootSubs.delete(fn); };
export const onLocal = (fn) => { localSubs.add(fn); return () => localSubs.delete(fn); };
const emit = (why, detail) => call(changeSubs, why, detail);

// ── shapes ────────────────────────────────────────────────────────────
/** The editable copy of a bootstrap. */
export function fresh(b) {
  return {
    days: (b.week?.days ?? []).map((d) => ({ date: d.date, weekday: d.weekday, events: clone(d.events ?? []) })),
    tasks: clone(b.today?.tasks ?? []),
    goals: clone(b.goals?.goals ?? []),
    projects: clone(b.projects ?? []),
    life: { snapshots: clone(b.life?.snapshots ?? []) },
  };
}
/** What the PC has confirmed, in the shape sync diffs against. */
export function pickSync(d) {
  const events = {};
  for (const day of d.days ?? []) for (const ev of day.events ?? []) events[ev.id] ??= { area: ev.area ?? null, start: ev.start, end: ev.end };
  return clone({ tasks: d.tasks ?? [], goals: d.goals ?? [], projects: d.projects ?? [], snaps: d.life?.snapshots ?? [], events });
}
/**
 * Local edits the PC hasn't confirmed (`local` against `localBase`), replayed on top of fresh server data.
 * Server data wins for every field this phone didn't touch, so a waiting edit never hides newer changes from the PC.
 */
export function rebaseOnto(next, local, localBase) {
  let pending = false;
  const lists = [['tasks', 'tasks', 'id', TASK_KEYS], ['goals', 'goals', 'id', GOAL_KEYS], ['projects', 'projects', 'slug', PROJECT_KEYS]];
  for (const [k, bk, key, keys] of lists) {
    const mine = local[k] ?? [], was = localBase?.[bk] ?? [], theirs = next[k] ?? (next[k] = []);
    for (const item of mine) {
      const old = was.find((x) => x[key] === item[key]);
      const srv = theirs.find((x) => x[key] === item[key]);
      if (!old) { if (!srv) { theirs.push(clone(item)); pending = true; } continue; }
      const diff = changes(old, item, keys);
      if (srv && Object.keys(diff).length) { Object.assign(srv, diff); pending = true; }
      if (srv && item.agent) srv.agent ??= item.agent;
    }
    for (const old of was) {
      if (mine.some((x) => x[key] === old[key])) continue;
      const i = theirs.findIndex((x) => x[key] === old[key]);
      if (i >= 0) { theirs.splice(i, 1); pending = true; }
    }
  }
  const snapsMine = local.life?.snapshots ?? [], snapsWas = localBase?.snaps ?? [];
  next.life ??= { snapshots: [] };
  for (const s of snapsMine) {
    const old = snapsWas.find((x) => x.date === s.date && x.source === s.source);
    if (old && same(old.scores, s.scores)) continue;
    const srv = next.life.snapshots.find((x) => x.date === s.date && x.source === s.source);
    if (srv) srv.scores = clone(s.scores); else next.life.snapshots.push(clone(s));
    pending = true;
  }
  const evMine = pickSync(local).events;
  for (const [id, ev] of Object.entries(evMine)) {
    const old = localBase?.events?.[id];
    if (!old || same(old, ev)) continue;
    for (const d of next.days) for (const x of d.events) if (x.id === id) { Object.assign(x, { area: ev.area, start: ev.start, end: ev.end }); pending = true; }
  }
  return { data: next, pending };
}

// ── boot ──────────────────────────────────────────────────────────────
const persist = () => {
  if (state.source !== 'real' || !state.user) return;
  API.ls.set(API.KEYS.state, JSON.stringify({ user: state.user.id, date: state.boot?.today?.date ?? null, data: state.data, base: state.base, dirty: state.dirty }));
};
/** If-None-Match for a bootstrap copy: the PC answers 304 (api() → null) while nothing in it changed. */
const ifNoneMatch = (b) => (b?.etag ? { 'If-None-Match': b.etag } : {});
/**
 * Load the day. A copy of today on the phone opens the app at once, and the PC is asked in the background (refresh).
 * An older copy gives the PC 4 s before the app opens from it; with none the app waits 10 s for GET /bootstrap, then
 * signs in. Waiting edits from last time go on top of what the PC has now. demo: no PC at all (the caller fills the
 * screens from data-demo.js).
 */
export async function start({ demo = false } = {}) {
  state.source = demo ? 'demo' : 'real';
  if (demo) return { boot: null, offline: false };
  let boot = null, offline = false;
  const cached = API.ls.json(API.KEYS.boot);
  if (cached?.today?.date) clock.setOffset(cached.today.utcOffsetMinutes ?? 330);
  const quick = !!cached?.today?.date && cached.user?.id != null && cached.today.date === clock.today();
  if (quick) { boot = cached; offline = true; }
  else {
    try {
      boot = (await API.api('/bootstrap', { timeout: cached?.today ? 4000 : 10000, headers: ifNoneMatch(cached) })) ?? cached;
      if (boot !== cached) API.ls.set(API.KEYS.boot, JSON.stringify(boot));
    } catch (e) {
      boot = cached;
      offline = true;
      if (!boot?.today) { API.env.replace(API.loginUrl()); await API.hang(); }
    }
  }
  state.boot = boot; state.user = boot.user; state.offline = offline;
  clock.setOffset(boot.today?.utcOffsetMinutes ?? 330);
  const st = API.ls.json(API.KEYS.state);
  if (st?.dirty && st.user === boot.user.id && offline && st.date === boot.today.date && st.data && st.base) {
    ({ data: state.data, base: state.base, dirty: state.dirty } = st);
  } else if (st?.dirty && st.user === boot.user.id && st.data && st.base) {
    // edits waiting from last time go on top of what the PC has now, not instead of it
    const next = fresh(boot);
    state.base = pickSync(next);
    ({ data: state.data, pending: state.dirty } = rebaseOnto(next, st.data, st.base));
  } else { state.data = fresh(boot); state.base = pickSync(state.data); state.dirty = false; }
  state.data.goals ??= []; state.data.projects ??= []; state.data.life ??= { snapshots: [] };
  persist();
  wire();
  // opened from the phone's copy: ask the PC now (refresh sends waiting edits first), again in 3 s if that didn't land
  // (then every minute, on focus and when the phone is online)
  if (quick) G.setTimeout(() => refresh().then(() => { if (state.offline) G.setTimeout(() => refresh(), 3000); }), 0);
  else {
    if (state.dirty) scheduleSync(0);
    if (offline) G.setTimeout(() => refresh(), 3000);
  }
  return { boot, offline };
}

// ── writes ────────────────────────────────────────────────────────────
/** Call after changing state.data: marks it, keeps it on the phone, and sends it in 350 ms. */
export function save(why = 'local') {
  call(localSubs, why);
  if (state.source !== 'real') { emit(why); return; }
  state.dirty = true;
  persist();
  scheduleSync();
  emit(why);
}
/** Put a record the PC already has into the local state without the sync sending it again (Work's job sheet, …). */
export function adopt(kind, obj) {
  const d = state.data, b = state.base;
  if (!d || !b) return;
  const [list, bl, key] = kind === 'task' ? [d.tasks, b.tasks, 'id'] : kind === 'project' ? [d.projects, b.projects, 'slug'] : kind === 'goal' ? [d.goals, b.goals, 'id'] : [];
  if (!list) return;
  const i = list.findIndex((x) => x[key] === obj[key]);
  if (i >= 0) list[i] = { ...list[i], ...obj }; else list.push(clone(obj));
  const j = bl.findIndex((x) => x[key] === obj[key]);
  if (j >= 0) bl[j] = clone({ ...bl[j], ...obj }); else bl.push(clone(obj));
  persist();
  emit('server');
}

const sendable = (body) => { for (const k of ['goal', 'parent']) if (body[k] && !SERVER_ID.test(body[k])) delete body[k]; return body; };
let syncTimer = 0, syncAgain = false, pullAfterFail = false;
export function scheduleSync(ms = 350) {
  if (state.source !== 'real') return;
  G.clearTimeout(syncTimer);
  syncTimer = G.setTimeout(sync, ms);
}
export const flush = () => sync();
function rename(kind, from, to) {
  const d = state.data;
  if (kind === 'task') { for (const t of d.tasks) if (t.id === from) t.id = to; }
  else { for (const g of d.goals) { if (g.id === from) g.id = to; if (g.parent === from) g.parent = to; } for (const t of d.tasks) if (t.goal === from) t.goal = to; }
  emit('rename', { kind, from, to });
}
async function syncList(list, baseList, { kind, key, keys, create, patch, drop }) {
  let renamed = false;
  for (const item of [...list]) {
    const old = baseList.find((x) => x[key] === item[key]);
    if (!old) {
      const sent = clone(item);
      const r = await create(sendable(changes({}, item, keys)), item);
      if (r?.[key] && r[key] !== sent[key]) { rename(kind, sent[key], r[key]); renamed = true; sent[key] = r[key]; }
      baseList.push(sent);
    } else {
      const body = sendable(changes(old, item, keys));
      if (!Object.keys(body).length) continue;
      await patch(item[key], body);
      Object.assign(old, clone(body));
    }
  }
  for (const old of [...baseList]) {
    if (list.some((x) => x[key] === old[key])) continue;
    if (drop) await drop(old[key]);
    baseList.splice(baseList.indexOf(old), 1);
  }
  return renamed;
}
let toastFn = (t) => console.warn('[sync]', t);
/** Where sync says a refused change out loud (the shell's toast). */
export const setToast = (fn) => { toastFn = fn; };
export async function sync() {
  if (state.source !== 'real' || !state.data) return;
  if (state.syncing) { syncAgain = true; return; }
  state.syncing = true;
  syncAgain = false;
  let renamed = false;
  const d = state.data, b = state.base;
  // the temp id doubles as an idempotency key, so a create whose answer was lost is not made twice
  // (the server honours Idempotency-Key once server/idempotency.ts is wired in; until then it is ignored)
  const json = (method, body, key) => ({ method, body: JSON.stringify(body), ...(key ? { headers: { 'Idempotency-Key': key } } : {}) });
  try {
    // goals first: new tasks may point at a goal created in the same burst
    renamed = await syncList(d.goals, b.goals, {
      kind: 'goal', key: 'id', keys: GOAL_KEYS,
      create: (body, g) => API.api('/goals', json('POST', { ...body, start: g.start }, `goal:${state.user.id}:${g.id}`)),
      patch: (id, body) => API.api(`/goals/${id}`, json('PATCH', body)),
      drop: (id) => SERVER_ID.test(id) && API.api(`/goals/${id}`, json('PATCH', { status: 'dropped' })),
    }) || renamed;
    renamed = await syncList(d.tasks, b.tasks, {
      kind: 'task', key: 'id', keys: TASK_KEYS,
      create: (body, t) => API.api('/tasks', json('POST', body, `task:${state.user.id}:${t.id}`)),
      patch: (id, body) => API.api(`/tasks/${id}`, json('PATCH', body)),
      drop: (id) => SERVER_ID.test(id) && API.api(`/tasks/${id}`, { method: 'DELETE' }),
    }) || renamed;
    await syncList(d.projects, b.projects, {
      kind: 'project', key: 'slug', keys: PROJECT_KEYS,
      create: (body, p) => API.api('/projects', json('POST', { ...body, slug: p.slug })),
      patch: (slug, body) => API.api(`/projects/${slug}`, json('PATCH', body)),
    });
    for (const s of d.life.snapshots) {
      const old = b.snaps.find((x) => x.date === s.date && x.source === s.source);
      if (old && same(old.scores, s.scores)) continue;
      await API.api('/life/snapshots', json('POST', s));
      if (old) old.scores = clone(s.scores); else b.snaps.push(clone(s));
    }
    for (const [id, ev] of Object.entries(pickSync(d).events)) {
      const old = b.events[id];
      if (!old) { b.events[id] = ev; continue; }
      const body = {};
      if (!same(old.area, ev.area)) body.area = ev.area;
      if (old.start !== ev.start || old.end !== ev.end) Object.assign(body, { start: ev.start, end: ev.end });
      if (!Object.keys(body).length) continue;
      await API.api(`/events/${encodeURIComponent(id)}`, json('PATCH', body));
      b.events[id] = ev;
    }
    // a no-op sync cannot prove the PC is there; only a response can (api.js does that)
    API.clearError();
    if (!syncAgain) state.dirty = false;
    state.lastSync = Date.now();
  } catch (e) {
    if (e.status >= 400 && e.status < 500) {
      // the PC refused this change: take its state, so the app stops retrying it
      toastFn(e.message);
      state.dirty = false;
      state.syncing = false;
      await refresh(true);
    } else {
      // offline (no status) or the PC failed (5xx): keep the edits, retry, and still pull what the PC has now
      if (e.status) API.setError(e.message);
      state.fails++;
      scheduleSync(Math.min(60000, 5000 * state.fails));
      if (e.status >= 500) pullAfterFail = true;
    }
  } finally {
    state.syncing = false;
    if (!state.dirty) state.fails = 0;
    persist();
    if (renamed) emit('rename');
    if (syncAgain) scheduleSync(0);
    else emit('synced');
    if (pullAfterFail) { pullAfterFail = false; G.setTimeout(() => refresh(), 0); }
  }
}

// ── reads ─────────────────────────────────────────────────────────────
let refreshing = false, holds = 0;
/** Keep a refresh from re-rendering under the finger (a drag, an open editor). Returns release(). */
export function hold() { holds++; let done = false; return () => { if (!done) { done = true; holds = Math.max(0, holds - 1); } }; }
const busy = () => holds > 0 || !!G.document?.querySelector?.('#phone > .sheet.in, #screen > .sheet.open');
/**
 * Pull the PC's state (on focus, every minute, after a refused or failed write). Waiting edits are sent first; if that
 * fails they're replayed on top of the fresh data instead of hiding it. A new day reloads the app.
 */
export async function refresh(force = false) {
  if (state.source !== 'real' || refreshing || !state.data || (!force && busy())) return;
  refreshing = true;
  try {
    if (state.dirty && !force) { if (!state.syncing) await sync(); if (state.syncing) return; }
    // 304: the PC has nothing newer than the copy this phone holds
    const got = await API.api('/bootstrap', { timeout: 15000, headers: ifNoneMatch(state.boot) });
    const b = got ?? state.boot;
    if (b.today?.date && state.boot?.today?.date && b.today.date !== state.boot.today.date && b.today.date === clock.today()) {
      API.ls.set(API.KEYS.boot, JSON.stringify(b));
      G.location?.reload();
      return;
    }
    if (got) API.ls.set(API.KEYS.boot, JSON.stringify(b));
    state.boot = b; state.user = b.user; state.offline = false;
    call(bootSubs, b);
    const next = fresh(b);
    for (const t of next.tasks) { const mine = state.data.tasks.find((x) => x.id === t.id); if (mine?.agent && !t.agent) t.agent = mine.agent; }
    const serverBase = pickSync(next);
    if (state.dirty && !force) {
      if (state.syncing) return;
      ({ data: state.data, pending: state.dirty } = rebaseOnto(next, state.data, state.base));
      state.base = serverBase;
    } else {
      if (!force && same(serverBase, pickSync(state.data))) { emit('boot'); return; }
      state.data = next;
      state.base = serverBase;
      state.dirty = false;
    }
    persist();
    emit('server');
    if (state.dirty) scheduleSync(15000);
  } catch (e) { console.warn('[refresh]', e.message); }
  finally { refreshing = false; }
}
export const pending = () => ({ dirty: state.dirty, syncing: state.syncing, fails: state.fails, lastSync: state.lastSync });

let wired = false;
function wire() {
  if (wired || !G.addEventListener) return;
  wired = true;
  G.document?.addEventListener('visibilitychange', () => { if (G.document.visibilityState === 'visible') refresh(); });
  G.addEventListener('online', () => refresh());
  G.setInterval(() => { if (G.document?.visibilityState === 'visible') refresh(); }, 60000);
}

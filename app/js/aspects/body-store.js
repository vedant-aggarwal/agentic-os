// Body · the data on the phone: nine offline-first collections (svc/store) synced with /api/v1/mod/body/<plural>, the
// writes the screens make, and the exercise library cache. Demo mode (?data=demo) seeds the prototype's story into the
// same collections in memory (body-demo.js), so real and demo run one code path. Owner: the Body agent.
import { collection } from '../svc/store.js';
import * as API from '../svc/api.js';
import * as clock from '../svc/clock.js';
import { DEMO_MODE } from '../data.js';
import * as M from './body-model.js';

const EP = (p) => `/api/v1/mod/body/${p}`;
const byDate = (a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? ''));
export const C = {
  workouts: collection('body/workouts', { endpoint: EP('workouts'), interval: 60000, sort: byDate, prefix: 'bw' }),
  meals: collection('body/meals', { endpoint: EP('meals'), interval: 60000, prefix: 'bm' }),
  readings: collection('body/readings', { endpoint: EP('readings'), interval: 300000, prefix: 'br' }),
  protocol: collection('body/protocol', { endpoint: EP('protocol'), interval: 300000, prefix: 'bp', sort: (a, b) => (a.ord ?? 0) - (b.ord ?? 0) }),
  checks: collection('body/checks', { endpoint: EP('checks'), interval: 60000, prefix: 'bc' }),
  programs: collection('body/programs', { endpoint: EP('programs'), interval: 300000, prefix: 'bg' }),
  scans: collection('body/scans', { endpoint: EP('scans'), interval: 300000, prefix: 'bs', sort: (a, b) => String(a.date).localeCompare(String(b.date)) }),
  settings: collection('body/settings', { endpoint: EP('settings'), interval: 300000, prefix: 'bt' }),
  exercises: collection('body/exercises', { endpoint: EP('exercises'), interval: 600000, prefix: 'be' }),
};
export const ready = Promise.all(Object.values(C).map((c) => c.ready));
const subs = new Set();
/** fn(why) after any Body collection changes (batched to one call per frame). */
export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
let t = 0, whys = new Set();
for (const c of Object.values(C)) c.on('change', ({ why }) => { whys.add(why); cancelAnimationFrame(t); t = requestAnimationFrame(() => { const w = [...whys]; whys = new Set(); subs.forEach((f) => { try { f(w); } catch (e) { console.error('[body] change', e); } }); }); });
export const pending = () => Object.values(C).reduce((n, c) => n + c.pending(), 0);
export const refreshAll = () => Promise.all(Object.values(C).map((c) => c.refresh?.().catch?.(() => {})));
export const today = () => clock.today();
const nowIso = () => new Date(clock.nowMs()).toISOString();
export const setting = (id) => C.settings.get(id);

// ── workouts: planned → live → done (or back to planned when discarded) ──
const planSets = (it) => Array.from({ length: Number(it.sets?.length ?? it.sets) || 1 }, () => ({ ...(it.target ?? {}), done: false }));
/** A plan (stored or worked out on the phone) becomes the live workout. */
export function startLive(plan) {
  const at = nowIso();
  const doc = { id: plan.stored ? plan.id : API.clientId('bw'), date: today(), status: 'live', split: plan.split ?? null, name: plan.name, started_at: at, ended_at: null,
    at: clock.hm(clock.nowMin()), why: plan.why ?? '', reasons: (plan.reasons ?? []).map((r) => (Array.isArray(r) ? r[0] : r)), plan_by: plan.plan_by ?? 'rules', source: 'app',
    items: plan.items.map((it) => ({ ...M.itemOf(it.ex), ...(it.name ? { name: it.name } : {}), note: it.note ?? '', target: it.target ?? null, sets: Array.isArray(it.sets) ? it.sets.map((x) => ({ ...x, done: !!x.done })) : planSets(it) })),
    cur: 0, rest: null, from_plan: plan.stored ? plan.id : null };
  return C.workouts.put(doc);
}
let saveT = 0, saveDoc = null;
/** The live workout changes many times a minute: keep it on the phone at once, and send it after a short pause. */
export function saveLive(doc, { now = false } = {}) {
  saveDoc = doc; clearTimeout(saveT);
  const go = () => { if (saveDoc) { const { _local, ...d } = saveDoc; C.workouts.put(JSON.parse(JSON.stringify(d))); } saveDoc = null; };
  if (now) go(); else saveT = setTimeout(go, 600);
}
const strip = ({ _local, ...d }) => JSON.parse(JSON.stringify(d));
export function finishLive(doc) {
  clearTimeout(saveT); saveDoc = null; doc = strip(doc);
  const end = clock.nowMs();
  const items = doc.items.map((it) => ({ ...it, sets: it.sets.filter((x) => x.done) })).filter((it) => it.sets.length);
  const dur = Math.max(1, Math.round((end - (Date.parse(doc.started_at) || end)) / 60000));
  return C.workouts.put({ ...doc, status: 'done', ended_at: new Date(end).toISOString(), dur, items, rest: null, cur: null });
}
export function discardLive(doc) {
  clearTimeout(saveT); saveDoc = null; doc = strip(doc);
  if (doc.from_plan) return C.workouts.put({ ...doc, id: doc.from_plan, status: 'planned', started_at: null, rest: null, cur: null, items: doc.items.map((it) => ({ ...it, sets: it.sets.map((x) => ({ ...x, done: false })) })) });
  return C.workouts.remove(doc.id);
}
/** A plan he changed (swap, shorter, harder) is stored, so the change survives and syncs. */
export function storePlan(plan, patch = {}) {
  const id = plan.stored ? plan.id : `plan-${plan.date}`;
  return C.workouts.put({ id, date: plan.date, status: 'planned', split: plan.split ?? null, name: plan.name, at: plan.at ?? null, dur: plan.dur ?? null, why: plan.why ?? '',
    reasons: (plan.reasons ?? []).map((r) => (Array.isArray(r) ? r[0] : r)), plan_by: plan.plan_by === 'wyn' ? 'wyn' : 'him', source: 'app',
    items: plan.items.map((it) => ({ ...M.itemOf(it.ex), ...(it.name ? { name: it.name } : {}), note: it.note ?? '', target: it.target ?? null, sets: planSets(it) })), ...patch });
}
export function removeWorkout(id) { const d = C.workouts.get(id); if (d) C.workouts.remove(id); return d; }
/** Wyn plans it as his PT on the PC (Claude on his subscription); the plan arrives through the workouts collection. */
export async function askPlan({ date, focus, minutes } = {}) {
  if (DEMO_MODE) return { demo: true };
  const r = await API.post('/api/v1/mod/body/plan', { date, focus, minutes });
  await C.workouts.refresh();
  return r;
}

// ── food ──
export function addMeal(m) {
  const at = m.at ?? nowIso();
  return C.meals.add({ slot: 'snack', items: [], source: 'app', ...m, at, date: m.date ?? clock.today() });
}
export const removeMeal = (id) => { const d = C.meals.get(id); if (d) C.meals.remove(id); return d; };
export const restore = (col, doc) => (doc ? C[col].put({ ...doc, deleted_at: null }) : null);
export function setWater(n, date = today()) { return C.readings.put({ id: `water:${date}`, kind: 'water', date, value: Math.max(0, Math.min(24, n)), unit: 'glasses', source: 'manual' }); }
export function putReading(kind, value, { date = today(), source = 'manual', ...extra } = {}) {
  const id = `${kind}:${date}`; const cur = C.readings.get(id);
  if (cur && cur.value === value && cur.source === source && JSON.stringify(cur.stages ?? null) === JSON.stringify(extra.stages ?? null)) return cur;
  return C.readings.put({ ...(cur ?? {}), id, kind, date, value, source, ...extra });
}

// ── the protocol, programs, scans ──
export function tick(itemId, done, date = today()) { return C.checks.put({ id: `${date}:${itemId}`, date, item: itemId, done: !!done, at: nowIso(), by: 'him' }); }
export const SUGGESTED = [
  ['am', 'Water, 500 ml', 'Before anything else'], ['am', 'Gentle cleanser', '30 seconds, lukewarm water'], ['am', 'Moisturiser', 'Face and neck'],
  ['am', 'Sunscreen, SPF 50', 'UV sits at 7 to 9 most days'], ['am', 'Chin tucks, 10 × 5 s', 'Two minutes', 'jaw'], ['am', '10 minutes of morning light', 'A walk counts'],
  ['pm', 'Cleanse', 'Sweat and sunscreen off'], ['pm', 'Salicylic acid 2%', 'Tue · Thu · Sat', null, [2, 4, 6]], ['pm', 'Moisturiser', 'A pea-sized amount'],
  ['pm', 'Aligners in', 'Your standing non-negotiable'], ['pm', 'Hyoid and neck, 10 min', 'The neck program', 'hyoid'], ['pm', 'Phone away, lights out', 'Sleep shows on your face first'],
];
export function seedProtocol() {
  return SUGGESTED.map(([half, text, meta, prog, days], i) => C.protocol.add({ half, text, meta, prog: prog ?? null, days: days ?? null, ord: i, active: true }));
}
export const addProtocolItem = (half, text) => C.protocol.add({ half, text, meta: '', ord: C.protocol.list().length, active: true });
export const dropProtocolItem = (id) => C.protocol.update(id, { active: false });
export function setTargets(patch) { const cur = C.settings.get('targets'); return C.settings.put({ ...(cur ?? {}), id: 'targets', ...patch }); }
export function markFresh(m, on = true) {
  const cur = C.settings.get('fresh'); const muscles = { ...(cur?.muscles ?? {}) };
  if (on) muscles[m] = nowIso(); else delete muscles[m];
  return C.settings.put({ id: 'fresh', muscles });
}
export const addScan = (s) => C.scans.add({ date: today(), source: 'app', ...s });
export function enroll(program, on = true) { const cur = C.programs.get(program); return C.programs.put({ ...(cur ?? {}), id: program, started: cur?.started && on ? cur.started : today(), active: on }); }
export const programDone = (program, date = today()) => C.checks.put({ id: `${date}:prog:${program}`, date, item: `prog:${program}`, done: true, at: nowIso(), by: 'him' });
export function addExercise(name, kind = 'weight', p = []) { return C.exercises.add({ name, kind, p, s: [] }); }

// ── the library (free-exercise-db): 876 exercises, the lite list cached on the phone for a week ──
const LIB_KEY = 'aos-body-lib';
let libP = null;
export function loadLibrary() {
  if (libP) return libP;
  libP = (async () => {
    try { const c = API.ls.json(LIB_KEY); if (c?.items?.length && Date.now() - (c.at ?? 0) < 7 * 864e5) { M.setLibrary(c.items); return c.items; } } catch {}
    if (DEMO_MODE) return [];
    try {
      const r = await API.get('/api/v1/mod/body/library?lite=1');
      if (r?.items?.length) { M.setLibrary(r.items); try { API.ls.set(LIB_KEY, JSON.stringify({ at: Date.now(), items: r.items })); } catch {} return r.items; }
    } catch {}
    libP = null; return [];
  })();
  return libP;
}
const howCache = new Map();
export async function libraryHow(id) {
  if (howCache.has(id)) return howCache.get(id);
  try { const r = await API.get(`/api/v1/mod/body/library/${encodeURIComponent(id)}`); howCache.set(id, r?.item?.how ?? []); return r?.item?.how ?? []; } catch { return []; }
}
export const estimateOnPc = (text) => API.post('/api/v1/mod/body/estimate', { text });
export const readFaceOnPc = (image, angle, baseline) => API.post('/api/v1/mod/body/face-read', { image, angle, baseline }, { timeout: 170000 });

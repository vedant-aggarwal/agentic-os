// Body · the iPhone: Apple Health (read only) into readings and workouts, the workout Live Activity (rest timer on the
// lock screen, its Next / Skip / End buttons), the PM protocol reminder as a local notification, and Body's streak for
// the widgets. Every call has a web fallback through svc/native-plugins.js ({ available: false } → nothing happens).
// Owner: the Body agent.
import { native } from '../svc/native-plugins.js';
import { snapshotPart } from '../svc/native.js';
import * as clock from '../svc/clock.js';
import { DEMO_MODE } from '../data.js';
import * as M from './body-model.js';
import { C, putReading, setting } from './body-store.js';

const TYPES = ['steps', 'sleep', 'workouts', 'activeEnergy', 'restingHR', 'hrv', 'weight'];
const KIND = { steps: 'steps', activeEnergy: 'activeEnergy', restingHR: 'rhr', hrv: 'hrv', weight: 'weight' };
const STAGE = { awake: 'a', rem: 'r', core: 'c', deep: 'd', asleep: 'c' };

// ── Apple Health ──────────────────────────────────────────────────────
export async function healthState() {
  if (DEMO_MODE) return { available: true, connected: true };
  const s = await native.health.status();
  return { available: !!s.available, connected: !!(s.available && (setting('health')?.connected)), raw: s };
}
export async function connectHealth() {
  const a = await native.health.authorize({ types: TYPES });
  if (!a.available) return { ok: false, reason: a.reason ?? 'web' };
  if (!a.ok) return { ok: false, reason: a.cancelled ? 'cancelled' : 'denied' };
  C.settings.put({ ...(setting('health') ?? {}), id: 'health', connected: true });
  return syncHealth({ force: true });
}
let lastSync = 0, syncing = null;
/** Read the last two weeks from Apple Health into readings (one per kind per day) and workouts the Watch saw. */
export function syncHealth({ force = false, days = 14 } = {}) {
  if (DEMO_MODE || !native.available || !setting('health')?.connected) return Promise.resolve({ ok: false, reason: 'off' });
  if (syncing) return syncing;
  if (!force && Date.now() - lastSync < 30 * 60000) return Promise.resolve({ ok: true, wrote: 0, skipped: true });
  syncing = (async () => {
    const to = clock.nowMs(); const from = M.dayMs(M.addDays(clock.today(), -days));
    const r = await native.health.query({ types: TYPES, from, to, bucket: 'day' });
    if (!r.ok) return { ok: false, reason: r.reason ?? r.error };
    const d = r.data ?? {}; let wrote = 0;
    const put = (kind, date, value, extra) => { const before = C.readings.get(`${kind}:${date}`); const after = putReading(kind, value, { date, source: 'health', synced_at: new Date().toISOString(), ...extra }); if (after !== before) wrote++; };
    for (const [type, kind] of Object.entries(KIND)) for (const b of d[type] ?? []) {
      if (!Number.isFinite(Number(b.value))) continue;
      put(kind, M.istDay(b.start), Math.round(Number(b.value) * 10) / 10, { unit: r.units?.[type] });
    }
    // sleep: segments into one night per wake day, with the stages in order for the hypnogram
    const nights = new Map();
    for (const s of (d.sleep ?? []).sort((a, b) => a.start - b.start)) { const day = M.istDay(s.end); if (!nights.has(day)) nights.set(day, []); nights.get(day).push(s); }
    for (const [day, segs] of nights) {
      const asleep = segs.filter((s) => STAGE[s.stage] && s.stage !== 'awake').reduce((a, s) => a + (s.end - s.start) / 60000, 0);
      if (asleep < 30) continue;
      const bedSeg = segs.filter((s) => s.stage === 'inBed');
      const start = Math.min(...segs.map((s) => s.start)), end = Math.max(...segs.map((s) => s.end));
      const inBed = bedSeg.length ? bedSeg.reduce((a, s) => a + (s.end - s.start) / 60000, 0) : (end - start) / 60000;
      const stages = []; for (const s of segs) { const k = STAGE[s.stage]; if (!k) continue; const m = Math.round((s.end - s.start) / 60000); if (!m) continue; const lastSt = stages[stages.length - 1]; if (lastSt && lastSt[0] === k) lastSt[1] += m; else stages.push([k, m]); }
      put('sleep', day, Math.round(asleep), { inBed: Math.round(inBed), from: M.istMin(start), to: M.istMin(end), stages, unit: 'min' });
    }
    // workouts the Watch saw: they count for recovery; one he logged here at the same time wins
    const mine = C.workouts.list().filter((w) => w.status === 'done' && w.source !== 'health').map(M.normalize);
    for (const w of d.workouts ?? []) {
      if (mine.some((x) => Math.abs(x.startMs - w.start) < 90 * 60000)) continue;
      const id = `hk-${Math.round(w.start / 1000)}`; if (C.workouts.get(id)) continue;
      const t = String(w.type ?? ''); const ex = /run/i.test(t) ? 'run' : /walk|hik/i.test(t) ? 'walk' : /cycl|bik/i.test(t) ? 'bike' : /strength|functional|core|hiit|cross/i.test(t) ? 'hk-strength' : 'hk-other';
      C.workouts.put({ id, date: M.istDay(w.start), status: 'done', split: null, name: ({ run: 'Run', walk: 'Walk', bike: 'Ride', 'hk-strength': 'Strength (Watch)', 'hk-other': t ? t[0].toUpperCase() + t.slice(1) : 'Workout' })[ex],
        started_at: new Date(w.start).toISOString(), ended_at: new Date(w.end).toISOString(), dur: Math.round(w.minutes ?? (w.end - w.start) / 60000), kcal: w.kcal ?? null, source: 'health',
        items: [{ ...M.itemOf(ex), kind: 'cardio', sets: [{ min: Math.round(w.minutes ?? 0), km: w.km ?? null, done: true }] }] });
      wrote++;
    }
    C.settings.put({ ...(setting('health') ?? {}), id: 'health', connected: true, synced_at: new Date().toISOString() });
    lastSync = Date.now();
    return { ok: true, wrote };
  })().finally(() => { syncing = null; });
  return syncing;
}

// ── the workout Live Activity: what's next, the set, the rest ring on the lock screen ──
const cur = (L) => { const i = Math.min(L.cur ?? 0, L.items.length - 1); const it = L.items[i]; if (!it) return null; const j = it.sets.findIndex((x) => !x.done); return { it, i, j: j < 0 ? it.sets.length - 1 : j }; };
function stateOf(L, phase) {
  const c = cur(L); if (!c) return { title: L.name, exercise: 'Add an exercise', set: 0, sets: 0, phase: 'work' };
  const s = c.it.sets[c.j] ?? {}; const nextIt = L.items.find((x, k) => k > c.i && x.sets.some((y) => !y.done));
  const restLeft = L.rest ? Math.max(1, Math.round(L.rest.total - (clock.nowMs() - L.rest.t0) / 1000)) : null;
  return { kind: 'workout', title: L.name, exercise: c.it.name ?? M.exInfo(c.it.ex, c.it).name, set: c.j + 1, sets: c.it.sets.length,
    ...(s.r != null ? { reps: s.r } : s.t != null ? { reps: s.t } : {}), ...(s.w != null ? { weight: s.w, unit: 'kg' } : {}),
    next: nextIt ? (nextIt.name ?? M.exInfo(nextIt.ex).name) : 'Finish', phase: phase ?? (L.rest ? 'rest' : 'work'), restSeconds: restLeft ?? 90 };
}
let liveId = null;
export async function liveStart(L) { if (!L) return; const r = await native.live.start(stateOf(L, 'work')); if (r.ok) liveId = r.id ?? null; }
export function liveUpdate(L, phase) { if (!L) return; native.live.update({ ...(liveId ? { id: liveId } : {}), ...stateOf(L, phase) }); }
export function liveEnd() { native.live.end({ ...(liveId ? { id: liveId } : { kind: 'workout' }) }); liveId = null; }
/** The lock screen's buttons act on the open workout (body-train.js registers the handlers in nav). */
export function wireLive(nav, getLive) {
  native.on('live', (e) => {
    if (e?.kind !== 'workout') return;
    const L = getLive(); if (!L) { if (e.action === 'end') liveEnd(); return; }
    if (e.action === 'next') { const c = cur(L); if (c && !c.it.sets[c.j]?.done) nav.tickSet?.(c.i, c.j, { fromLock: true }); }
    else if (e.action === 'skip') nav.skipRest?.();
    else if (e.action === 'end') nav.openPlayer?.();
  });
}

// ── the PM protocol reminder (a local notification that opens Looks), rescheduled when the protocol changes ──
let remindKey = '';
export function scheduleReminder({ due, pmDone, items }) {
  if (DEMO_MODE || !native.available) return;
  const today = clock.today(); const key = `${today}|${due}|${pmDone}|${items}`;
  if (key === remindKey) return; remindKey = key;
  native.notify.cancel({ id: 'body-pm' });
  if (!items || pmDone) return;
  const at = M.dayMs(today, M.toMin(due) ?? 22 * 60 + 30);
  if (at <= clock.nowMs()) return;
  native.notify.schedule({ id: 'body-pm', at, title: 'PM protocol', body: `${items} left tonight. Two minutes keeps the streak.`, category: 'streak', url: 'agenticos://body/looks', thread: 'body' });
}

// ── the widgets: Body's streak (protocol), until the lead merges every area's streaks under one key ──
export function shareStreak(getState) {
  snapshotPart('streaks:body', () => {
    const s = getState(); if (!s || !s.items) return undefined;
    const due = M.dayMs(clock.today(), M.toMin(s.due) ?? 22 * 60 + 30);
    return [{ id: 'protocol-pm', label: 'AM + PM protocol', n: s.n, today: s.today, atRisk: !s.today && clock.nowMs() > due - 3600e3, due: Math.round(due / 1000), aspect: 'body' }];
  });
}

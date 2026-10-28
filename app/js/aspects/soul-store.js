// Soul's data: eleven offline-first collections (svc/store) on /api/v1/mod/soul/*, and the views the screens draw,
// derived with soul-logic.js (the same rules the PC runs). Every write lands on the phone first and syncs later.
// Demo mode (?data=demo) seeds the same collections in memory from soul-data.js, so both modes run one code path.
// Owner: the Soul agent.
import { collection } from '../svc/store.js';
import * as clock from '../svc/clock.js';
import { DEMO_MODE } from '../data.js';
import * as L from './soul-logic.js';

const NAMES = ['habits', 'checks', 'clean', 'resets', 'urges', 'moods', 'locks', 'asks', 'talks', 'values', 'reflections'];
const SLOW = new Set(['habits', 'clean', 'resets', 'values', 'locks']);
const PREFIX = { habits: 'hab', checks: 'chk', clean: 'cln', resets: 'rst', urges: 'urg', moods: 'md', locks: 'lk', asks: 'ask', talks: 'tk', values: 'val', reflections: 'rf' };
export const C = Object.fromEntries(NAMES.map((n) => [n, collection(`soul/${n}`, { endpoint: `/api/v1/mod/soul/${n}`, interval: SLOW.has(n) ? 180000 : 60000, prefix: PREFIX[n] })]));
export const ready = Promise.all(NAMES.map((n) => C[n].ready));

export const off = () => clock.getOffset?.() ?? L.IST;
export const nowMs = () => clock.nowMs();
export const today = () => L.dateAt(nowMs(), off());
export const nowMin = () => L.minOfDay(nowMs(), off());
export const hhmm = (ms) => L.hhmmAt(typeof ms === 'number' ? ms : Date.parse(ms), off());
const iso = (ms = nowMs()) => new Date(ms).toISOString();
const live = (n) => C[n].list();

// ── change: one event for every Soul screen, and a cache of the derived views ──
let ver = 0; const cache = new Map();
const memo = (k, fn) => { const c = cache.get(k); if (c && c.v === ver && c.min === nowMin()) return c.x; const x = fn(); cache.set(k, { v: ver, min: nowMin(), x }); return x; };
const subs = new Set();
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
let raf = 0; let whys = new Set();
// listeners get the set of reasons since the last frame: 'local' (this phone wrote; the screen painted it already),
// 'server', 'load', 'error', 'day', 'demo'
const bump = (why) => { ver += 1; whys.add(why ?? 'local'); if (raf) return; raf = (globalThis.requestAnimationFrame ?? setTimeout)(() => { raf = 0; const w = whys; whys = new Set(); subs.forEach((f) => { try { f(w); } catch (e) { console.warn('[soul]', e); } }); }); };
globalThis.document?.addEventListener('store-changed', (e) => { if (String(e.detail?.name ?? '').startsWith('soul/')) bump(e.detail.why); });
clock.onDay?.(() => bump('day'));

// ── habits ────────────────────────────────────────────────────────────────
const LABEL = (title) => { const w = String(title).split(' '); const cut = Math.ceil(w.length / 2); return [w.slice(0, cut).join(' '), w.slice(cut).join(' ') || ' ']; };
/** Each habit with today's state, in the prototype's shape (title, label, icon, at, done, doneAt, streak, best, hist …). */
export const habits = () => memo('habits', () => {
  const checks = live('checks'); const d = today(), m = nowMin(), o = off();
  return live('habits').filter((h) => !h.archived).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.created_at).localeCompare(String(b.created_at))).map((h) => {
    const s = L.habitState(h, checks, d, m, o);
    return { ...h, part: h.part ?? 'morning', label: Array.isArray(h.label) && h.label.length === 2 ? h.label : LABEL(h.title), icon: h.icon ?? 'seedling', at: h.at ?? (h.part === 'evening' ? 'Evening' : 'Morning'),
      by: s.by && s.done ? s.by : h.by ?? 'you', who: h.by ?? 'you', why: h.why ?? '', ...s, count: h.of ? (s.done ? h.of : s.count) : 0 };
  });
});
export const habit = (id) => habits().find((h) => h.id === id) ?? null;
export function tickHabit(id, { done, count, rest, by = 'you', source = 'app' } = {}) {
  const h = habit(id); if (!h) return null;
  const date = today(); const cid = L.checkId(h.id, date);
  const next = rest ? { done: false, rest: true } : count != null ? { count, done: h.of ? count >= h.of : true, rest: false } : { done: done ?? !h.done, rest: false, count: done ?? !h.done ? (h.of || null) : null };
  C.checks.put({ id: cid, habit: h.id, date, at: iso(), by, source, ...next });
  return habit(id);
}
export function addHabit({ title, part = 'morning', at = null, by = 'you', aspect = null, link = null, of = null, unit = null, why = '' }) {
  return C.habits.add({ title, part, at, by, aspect, link, of, unit, why, icon: 'seedling', label: LABEL(title), sort: live('habits').length, start: today() });
}
export const updateHabit = (id, patch) => C.habits.update(id, patch);
export const archiveHabit = (id) => C.habits.update(id, { archived: true });

// ── check-ins and the reflection ─────────────────────────────────────────
export const moodsToday = () => memo('moods', () => live('moods').filter((x) => x.date === today()).sort((a, b) => String(a.at).localeCompare(String(b.at))));
export const logMood = (v) => C.moods.add({ date: today(), at: iso(), v });
export const values = () => memo('values', () => live('values').sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((v) => {
  const rs = live('reflections').filter((r) => r.value === v.id);
  const week = []; for (let i = 13; i >= 1; i--) { const d = L.addDays(today(), -i); const r = rs.find((x) => x.date === d); week.push(r ? Number(r.v) : null); }
  const t = rs.find((x) => x.date === today());
  return { ...v, aspects: v.aspects ?? [], week, tonight: t ? Number(t.v) : null };
}));
export const addValue = ({ name, words = '', aspects = [] }) => C.values.add({ name, words, aspects, sort: live('values').length });
export const updateValue = (id, patch) => C.values.update(id, patch);
export const reflect = (valueId, v) => C.reflections.put({ id: `rf_${today()}_${valueId}`.slice(0, 80), date: today(), value: valueId, v });
export const unreflect = () => live('reflections').filter((r) => r.date === today()).forEach((r) => C.reflections.remove(r.id));

// ── Clean ─────────────────────────────────────────────────────────────────
export const clean = () => memo('clean', () => {
  const c = live('clean').find((x) => x.since && x.active !== false) ?? null;
  if (!c) return null;
  const resets = live('resets').filter((r) => r.tracker === c.id);
  const rec = L.cleanRecord(c, resets, nowMs());
  return { ...c, name: c.name || 'Clean', goal: Number(c.goal) || 30, horizon: Number(c.horizon) || 90, reasons: Array.isArray(c.reasons) ? c.reasons : [], sinceMs: Date.parse(c.since), ...rec,
    lastReset: resets.sort((a, b) => String(b.at).localeCompare(String(a.at)))[0] ?? null };
});
/** Clean anywhere outside its tab: "Day N" and nothing else */
export const cleanText = () => { const c = clean(); return c ? `Day ${L.cleanDay(c.sinceMs, nowMs())}` : null; };
export function startClean({ since = iso(), name = 'Clean', goal = 30, reasons = [] } = {}) {
  const cur = live('clean')[0];
  return cur ? C.clean.update(cur.id, { since, name, goal, active: true }) : C.clean.put({ id: 'clean', name, since, goal, horizon: 90, reasons, widget: false, active: true });
}
export function resetClean({ at = iso(), before = [] } = {}) {
  const c = clean(); if (!c) return null;
  const r = C.resets.add({ tracker: c.id, at, prev_since: c.since, days: Math.floor((Date.parse(at) - c.sinceMs) / 864e5), before });
  C.clean.update(c.id, { since: at });
  return { reset: r, prevSince: c.since };
}
export function undoReset({ reset, prevSince }) { C.resets.remove(reset.id); const c = live('clean')[0]; if (c) C.clean.update(c.id, { since: prevSince }); }
export const updateClean = (patch) => { const c = live('clean')[0]; if (c) C.clean.update(c.id, patch); };

// ── urges ─────────────────────────────────────────────────────────────────
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dayLabel = (date) => { const d = new Date(`${date}T00:00:00Z`); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`; };
/** the last 30 days, newest first, in the prototype's shape ({ day, at, h, place, feel, before, did, out, mins }) */
export const urges = () => memo('urges', () => {
  const from = nowMs() - 30 * 864e5;
  return live('urges').filter((u) => Date.parse(u.at) >= from).sort((a, b) => String(b.at).localeCompare(String(a.at))).map((u) => {
    const ms = Date.parse(u.at); const date = L.dateAt(ms, off());
    return { ...u, day: dayLabel(date), at: L.hhmmAt(ms, off()), iso: u.at, h: Math.floor(L.minOfDay(ms, off()) / 60), place: u.place || 'Not said', feel: u.feel || 'Not said', before: u.before || 'Not said', did: u.did || '', mins: Number(u.mins) || 0 };
  });
});
export const logUrge = (u) => C.urges.add({ at: iso(), out: 'rode', ...u });

// ── the blocker ───────────────────────────────────────────────────────────
export const locks = () => memo('locks', () => live('locks').filter((l) => l.kind !== 'now').sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  .map((l) => ({ ...l, on: l.active !== false, apps: l.apps ?? [], when: L.lockWhen(l), strict: l.strict ?? (l.kind === 'hard' ? 'never' : 'reason') })));
export const addLock = (l) => C.locks.add({ active: true, apps: [], strict: 'reason', ...l });
export const updateLock = (id, patch) => C.locks.update(id, patch);
export const removeLock = (id) => C.locks.remove(id);
const asksAll = () => live('asks');
/** her lock ask for today: pending, or how he answered it */
export const askToday = () => memo('ask', () => asksAll().filter((a) => a.date === today()).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] ?? null);
export function answerAsk(yes, id = null) {
  const a = id ? C.asks.get(id) : askToday(); if (!a) return null;
  return C.asks.update(a.id, { state: yes ? 'yes' : 'no', answered_at: iso() });
}
export const undoAnswer = (id) => C.asks.update(id, { state: 'pending', answered_at: null });
/** "lock it now for an hour" */
export const lockFor = (minutes, apps = []) => C.locks.add({ name: 'For now', kind: 'now', apps, until: iso(nowMs() + minutes * 6e4), active: true });
export const nowLock = () => live('locks').find((l) => l.kind === 'now' && l.until && Date.parse(l.until) > nowMs()) ?? null;
export const endNowLock = () => live('locks').filter((l) => l.kind === 'now' && !l.deleted_at && Date.parse(l.until) > nowMs()).forEach((l) => C.locks.update(l.id, { until: iso() }));
/** what holds right now: the locks, and the window it ends */
export const holding = () => memo('holding', () => live('locks').filter((l) => L.lockHolds(l, nowMs(), { asks: asksAll(), off: off() })).map((l) => ({ ...l, ends: L.lockEnds(l, nowMs(), off()) })));
/** the next window to come today (start later than now) */
export function nextWindow() {
  const m = nowMin(); const d = today();
  const ls = locks().filter((l) => l.on && (l.kind === 'window' || l.kind === 'bedtime') && L.dueOn(l, d)).map((l) => ({ l, s: L.parseHM(l.start) })).filter((x) => x.s != null && x.s > m).sort((a, b) => a.s - b.s);
  return ls[0]?.l ?? null;
}
// the talks
export const talks = () => memo('talks', () => live('talks').sort((a, b) => String(b.at).localeCompare(String(a.at))));
export const talksWeek = () => { const from = L.addDays(today(), -6); return talks().filter((t) => t.date >= from); };
export const opensUsed = () => talks().filter((t) => t.date === today() && t.out === 'open').length;
const monday = () => { const d = today(); return L.addDays(d, -(L.dow(d) - 1)); };
export const passUsed = () => talks().some((t) => t.out === 'pass' && t.date >= monday());
export const weakWeek = () => talksWeek().filter((t) => L.WEAK.test(String(t.reason ?? ''))).length;
/** a granted unlock still running: { app, until (ms), reason, mins, id } */
export function openNow() {
  const t = talks().find((x) => (x.out === 'open' || x.out === 'pass') && x.until && Date.parse(x.until) > nowMs());
  return t ? { id: t.id, app: t.app, until: Date.parse(t.until), reason: t.reason, mins: Number(t.mins) || 5 } : null;
}
export const saveTalk = (t) => C.talks.add({ date: today(), at: iso(), ...t });
export const updateTalk = (id, patch) => C.talks.update(id, patch);
export const relock = () => { const o = openNow(); if (o) C.talks.update(o.id, { until: iso() }); return o; };
/** where the pull shows up: urges and unlock asks by weekday × hour, the last 4 weeks */
export const pull = () => memo('pull', () => {
  const ev = [...live('urges').map((u) => ({ at: u.at })), ...live('talks').map((t) => ({ at: t.at }))];
  const h = L.heat(ev, nowMs(), { off: off() });
  return { ...h, windows: L.learnWindows(h.grid) };
});

// ── what the agent did here today ────────────────────────────────────────
export const agentToday = () => memo('agent', () => {
  const d = today(); const name = (id) => live('habits').find((h) => h.id === id)?.title ?? 'A habit';
  const rows = [];
  for (const c of live('checks')) if (c.date === d && c.done && c.by && c.by !== 'you') rows.push({ at: c.at, kind: 'check', title: `Ticked “${name(c.habit)}”`, meta: c.how ?? (c.by === 'wyn' ? 'she heard it from you' : `from ${c.by[0].toUpperCase()}${c.by.slice(1)}`), by: c.by });
  for (const a of asksAll()) if (a.date === d && a.by === 'wyn') rows.push({ at: a.at ?? a.created_at, kind: 'ask', title: a.title, meta: a.state === 'pending' ? 'waiting on you' : a.state === 'yes' ? 'you said yes' : 'you said no' });
  for (const t of talks()) if (t.date === d && t.source === 'agent') rows.push({ at: t.at, kind: 'talk', title: t.out === 'open' ? `Opened ${t.app ?? 'an app'} for ${t.mins} min` : `Held the line on ${t.app ?? 'an app'}`, meta: `“${t.reason}”` });
  return rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
});

// ── demo mode: the prototype's sample, as records ────────────────────────
async function seedDemo() {
  const M = await import('./soul-data.js');
  const d0 = today(); const at = (date, hm) => new Date(clock.dayStart(date) + (L.parseHM(hm) ?? 600) * 6e4).toISOString();
  const put = (n, doc) => C[n].put({ created_at: at(L.addDays(d0, -60), '09:00'), ...doc }, { touch: true });
  M.HABITS.forEach((h, i) => {
    put('habits', { id: h.id, title: h.title, label: h.label, part: h.part, icon: h.icon, at: h.at, aspect: h.aspect ?? null, by: h.by, why: h.why, how: h.how ?? null, of: h.of ?? null, unit: h.unit ?? null, sort: i, start: L.addDays(d0, -55) });
    const hist = h.hist.split('');
    hist.forEach((c, k) => {
      const date = L.addDays(d0, k - (hist.length - 1));
      if (c === '1') put('checks', { id: L.checkId(h.id, date), habit: h.id, date, at: at(date, date === d0 && h.doneAt ? h.doneAt : '08:00'), done: true, by: date === d0 ? h.by : 'you' });
      else if (c === 's') put('checks', { id: L.checkId(h.id, date), habit: h.id, date, at: at(date, '08:00'), done: false, rest: true });
    });
    if (h.count && !h.done) put('checks', { id: L.checkId(h.id, d0), habit: h.id, date: d0, at: at(d0, '13:12'), count: h.count, done: false, by: h.by });
  });
  M.CHECKINS.forEach((c, i) => put('moods', { id: `md_demo_${i}`, date: d0, at: at(d0, c.at), v: c.v }));
  put('clean', { id: 'clean', name: 'Clean', since: at('2026-10-13', '08:14'), goal: 30, horizon: 90, reasons: M.CLEAN.reasons, widget: false, active: true, pledge: { date: d0, at: at(d0, '07:02') } });
  put('resets', { id: 'rst_demo', tracker: 'clean', prev_since: at(L.addDays(d0, -45), '07:00'), at: at(L.addDays(d0, -29), '07:00'), days: 16 });
  const mon = { Sep: 8, Oct: 9 };
  M.URGES.forEach((u, i) => { const [, dd, mm] = u.day.split(' '); const date = `2026-${String(mon[mm] + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`; put('urges', { id: `urg_demo_${i}`, at: at(date, u.at), place: u.place, feel: u.feel, before: u.before, did: u.did, out: u.out, mins: u.mins ?? null }); });
  put('locks', { id: 'eve', name: 'Evening window', kind: 'window', apps: ['Instagram'], start: '18:00', end: '19:00', days: [1, 2, 3, 4, 5], ask_first: true, learned: true, active: true, strict: 'reason', how: 'Wyn asks first, each day at 17:30' });
  put('locks', { id: 'bed', name: 'Bedtime', kind: 'bedtime', apps: ['Instagram', 'YouTube'], start: '22:45', end: '06:00', active: true, strict: 'reason', how: 'Starts with the phone-out habit' });
  put('locks', { id: 'limit', name: 'Daily limit', kind: 'limit', apps: ['Instagram'], limit_min: 45, active: true, strict: 'easy', how: 'Counted by Screen Time' });
  put('locks', { id: 'hard', name: 'Hard mode', kind: 'hard', apps: [], active: false, strict: 'never', how: 'Even a good reason waits' });
  put('asks', { id: `ask_eve_${d0}`, date: d0, lock: 'eve', by: 'wyn', at: at(d0, '17:38'), state: 'pending', title: 'Block Instagram till cardio?', text: 'Your evenings slip between 18:00 and 19:00. I can lock it at 18:00 and open it at 19:00, before cardio.' });
  const back = { Wed: 1, Tue: 2, Mon: 3 };
  M.ASKS.forEach((a) => { const date = L.addDays(d0, -back[a.day]); put('talks', { id: `tk_demo_${a.id}`, date, at: at(date, a.at), app: M.BAPPS[a.app]?.name ?? a.app, lock: a.lock, lockName: a.lock, reason: a.reason, out: a.out, mins: a.mins ?? null, until: a.out === 'open' ? at(date, L.fmtHM(L.parseHM(a.at) + a.mins)) : null, chat: a.chat }); });
  M.VALUES.forEach((v, i) => {
    put('values', { id: v.id, name: v.name, words: v.words, aspects: v.aspects, sort: i });
    v.week.forEach((x, k) => { const date = L.addDays(d0, k - 13); put('reflections', { id: `rf_${date}_${v.id}`, date, value: v.id, v: x }); });
  });
}
if (DEMO_MODE) ready.then(seedDemo).then(() => bump('demo'));

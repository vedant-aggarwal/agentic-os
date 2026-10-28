// Home's data: dates, the calendar for any day, sleep, how long tasks really take, and a small outbox for the writes
// that don't ride the core sync (the usual night, area rules, what he kept of the agent's proposals, far-off events).
//
// Real mode: today and the next six days come from the bootstrap (js/data.js EVENTS / DAYS, kept current by svc/sync,
// event moves and areas included). Other days come from GET /api/v1/days?from=&n= (store.days on the PC), cached on the
// phone so a month view works offline; until that route answers, a day outside the loaded week is "not loaded" (never
// shown as free). Demo mode (?data=demo) keeps the prototype's usual week around the sample Thursday.
import * as clock from './svc/clock.js';
import { api, ls, connection, onConnection, clientId } from './svc/api.js';
import { EVENTS, DAYS, ALL_DAY, AREA_ASPECTS, DEMO_MODE, USER, boot, onData, hasDay } from './data.js';

export const REAL = !DEMO_MODE;
const G = globalThis;

// ── today, live: the date moves at midnight (the engine reloads on a new PC date; offline it redraws) ─────────
export let TODAY = clock.today();
const daySubs = new Set();
export const onToday = (fn) => { daySubs.add(fn); return () => daySubs.delete(fn); };
const rollDay = () => { const t = clock.today(); if (t === TODAY) return; TODAY = t; daySubs.forEach((fn) => { try { fn(t); } catch (e) { console.warn('[today] day listener', e); } }); };
onData((why) => { if (why === 'day' || why === 'boot' || why === 'server') rollDay(); });
clock.onDay?.(rollDay);

// ── dates ─────────────────────────────────────────────────────────────
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const fmt = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
export const addDays = (iso, n) => { const d = parse(iso); d.setDate(d.getDate() + n); return fmt(d); };
export const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
export function day(iso) {
  const d = parse(iso);
  const wd = d.getDay();
  return { iso, wd: WD[wd], wdLong: WD_LONG[wd], dow: (wd + 6) % 7, d: d.getDate(), m: d.getMonth(), y: d.getFullYear(),
    mon: MON[d.getMonth()], monLong: MON_LONG[d.getMonth()], short: `${WD[wd]} ${d.getDate()} ${MON[d.getMonth()]}`,
    long: `${WD_LONG[wd]} ${d.getDate()} ${MON_LONG[d.getMonth()]}` };
}
/** 'Today', 'Tomorrow', 'Yesterday', else 'Fri 23' */
export const rel = (iso) => (iso === TODAY ? 'Today' : iso === addDays(TODAY, 1) ? 'Tomorrow' : iso === addDays(TODAY, -1) ? 'Yesterday' : `${day(iso).wd} ${day(iso).d}`);
export const weekStart = (iso) => addDays(iso, -day(iso).dow);
export const weekOf = (iso) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(iso), i));
export function monthGrid(iso) {
  const d = day(iso);
  const first = fmt(new Date(d.y, d.m, 1, 12));
  const last = fmt(new Date(d.y, d.m + 1, 0, 12));
  const out = [];
  for (let w = weekStart(first); diffDays(w, last) >= 0; w = addDays(w, 7)) out.push(weekOf(w));
  return out;
}
export const monthStart = (iso, n = 0) => { const d = day(iso); return fmt(new Date(d.y, d.m + n, 1, 12)); };
/** 'Fri 23', 'Sat 31', 'Today', 'Tomorrow' → an ISO date near today */
export function isoOfLabel(label) {
  if (!label) return null;
  if (/^today$/i.test(label)) return TODAY;
  if (/^tomorrow$/i.test(label)) return addDays(TODAY, 1);
  const m = /(\d{1,2})/.exec(label);
  if (!m) return null;
  const n = Number(m[1]);
  for (let i = -10; i <= 40; i++) { const iso = addDays(TODAY, i); if (day(iso).d === n) return iso; }
  return null;
}
export const hm = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
export const toMin = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };
export const isTime = (s) => /^\d\d:\d\d$/.test(s ?? '');
export const snap = (m, q = 15) => Math.round(m / q) * q;
export const snapUp = (m, q = 15) => Math.ceil(m / q) * q;
const t = (h, m = 0) => h * 60 + m;

// ── the calendar ──────────────────────────────────────────────────────
// An event, as Home draws it: { id, title, full, start, end (minutes from that day's midnight; sleep may run past),
// area, aspect, where, sleep, allDay, editable, source, startIso, endIso, date }
const sleepy = (title) => /\bsleep\b/i.test(title ?? '');
export const shortTitle = (s) => String(s ?? '').replace(/\s*\([^)]*\)\s*$/g, '').trim() || String(s ?? '');
function shapeRaw(ev, date) {
  return {
    id: ev.id, title: sleepy(ev.title) ? 'Sleep' : String(ev.title ?? 'Busy'), full: ev.title ?? '',
    start: Math.round(clock.toMin(ev.start, date)), end: Math.round(clock.toMin(ev.end, date)),
    area: ev.area ?? null, aspect: AREA_ASPECTS[ev.area]?.[0] ?? null, where: ev.location ? String(ev.location) : undefined,
    sleep: sleepy(ev.title), allDay: !!ev.allDay, editable: ev.editable !== false, source: ev.source ?? null,
    startIso: ev.start, endIso: ev.end, date,
  };
}

// days beyond the loaded week: GET /days?from=&n=, kept on the phone (aos-today:days), refreshed when shown
const DAYS_KEY = 'aos-today:days';
const fetched = new Map();          // iso → { at, events: [shaped, sleep included] }
let routeState = 'unknown';         // 'unknown' | 'ok' | 'missing' (the PC has no /days yet)
let missingAt = 0;
(() => {
  if (!REAL) return;
  const c = ls.json(DAYS_KEY);
  if (c?.user && c.user !== USER?.id) return;
  for (const [iso, v] of Object.entries(c?.days ?? {})) fetched.set(iso, v);
})();
const persistDays = () => {
  // keep about four months around today
  const lo = addDays(TODAY, -70), hi = addDays(TODAY, 70);
  for (const k of [...fetched.keys()]) if (k < lo || k > hi) fetched.delete(k);
  ls.set(DAYS_KEY, JSON.stringify({ user: USER?.id ?? null, days: Object.fromEntries(fetched) }));
};
const changeSubs = new Set();
export const onCalendar = (fn) => { changeSubs.add(fn); return () => changeSubs.delete(fn); };
const calChanged = (why) => changeSubs.forEach((fn) => { try { fn(why); } catch (e) { console.warn('[today] calendar listener', e); } });
const inFlight = new Map();
/** Load the days from..from+n-1 that the bootstrap doesn't carry (quietly; draws again when they land). */
export function ensureRange(from, n) {
  if (!REAL || n <= 0) return;
  const need = [];
  for (let i = 0; i < n; i++) {
    const iso = addDays(from, i);
    if (hasDay(iso)) continue;
    const f = fetched.get(iso);
    if (!f || Date.now() - f.at > 10 * 60000) need.push(iso);
  }
  if (!need.length) return;
  if (routeState === 'missing' && Date.now() - missingAt < 5 * 60000) return;
  if (connection().status === 'offline') return;
  const a = need[0], z = need[need.length - 1];
  const key = `${a}:${z}`;
  if (inFlight.has(key)) return;
  const span = Math.min(42, diffDays(a, z) + 1);
  const p = api(`/days?from=${a}&n=${span}`, { timeout: 15000 }).then((r) => {
    routeState = 'ok';
    for (const d of r.days ?? []) fetched.set(d.date, { at: Date.now(), events: (d.events ?? []).map((e) => shapeRaw(e, d.date)) });
    persistDays();
    calChanged('days');
  }).catch((e) => {
    if (e?.status === 404) { routeState = 'missing'; missingAt = Date.now(); calChanged('days'); }
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
}
/** Is this day's calendar on the phone? (the loaded week, a fetched day, or demo) */
export const known = (iso) => !REAL || hasDay(iso) || fetched.has(iso);
export const daysRoute = () => routeState;
/** Every timed event on a day, sleep included, in time order; null when the day isn't loaded. */
export function allOn(iso) {
  if (!REAL) return demoDay(iso);
  if (iso === TODAY) return EVENTS.filter((e) => !e.allDay);
  if (hasDay(iso)) return (DAYS.get(iso) ?? []).filter((e) => !e.allDay);
  return fetched.get(iso)?.events.filter((e) => !e.allDay) ?? null;
}
/** A timed event that runs 16 hours or more (a hackathon, a trip) reads as all-day, not as a block on the timeline. */
export const isLong = (e) => !e.sleep && e.end - e.start >= 16 * 60;
/** The day's events without sleep or the long ones ([] when the day isn't loaded: callers ask known() first). */
export const eventsOn = (iso) => (allOn(iso) ?? []).filter((e) => !e.sleep && !isLong(e));
/** All-day events and the long timed ones, for the line above the day. */
export function allDayOn(iso) {
  const long = (allOn(iso) ?? []).filter(isLong);
  if (!REAL) return long;
  const flagged = iso === TODAY || hasDay(iso) ? (ALL_DAY.get(iso) ?? []) : (fetched.get(iso)?.events.filter((e) => e.allDay) ?? []);
  return [...flagged, ...long.filter((e) => !flagged.some((x) => x.id === e.id))];
}
/** A far-off event's local copy moved (the outbox sends the override): the screen shows it at once. */
export function patchFetched(id, patch) {
  for (const [iso, d] of fetched) for (const e of d.events) {
    if (e.id !== id) continue;
    if (patch.startIso) Object.assign(e, { start: Math.round(clock.toMin(patch.startIso, iso)), end: Math.round(clock.toMin(patch.endIso, iso)), startIso: patch.startIso, endIso: patch.endIso });
    if ('area' in patch) Object.assign(e, { area: patch.area, aspect: AREA_ASPECTS[patch.area]?.[0] ?? null });
  }
  persistDays();
}
export const fetchedEvent = (id) => { for (const [, d] of fetched) { const e = d.events.find((x) => x.id === id); if (e) return e; } return null; };

// ── sleep: the night that starts on a day, and the one that ended on it ─
// Real mode reads the sleep blocks the PC sends (Google's "Sleep" events, or the usual night from settings sleep.default,
// one-night changes included); a day with none falls back to the usual night, else 22:45 → 06:00.
export function usualNight() {
  const sd = REAL ? boot()?.sleep : null;
  return sd?.bed && sd?.wake ? { bed: toMin(sd.bed), wake: toMin(sd.wake) } : { bed: t(22, 45), wake: t(6) };
}
/** { id, bed, wake } in minutes from iso's midnight: bed is that evening (≥ 12:00), wake the next morning (> 1440). */
export function nightOf(iso) {
  const all = allOn(iso) ?? [];
  const n = all.find((e) => e.sleep && e.start >= 720 && e.start < 1440 + 360);
  if (n) return { id: n.id, bed: n.start, wake: n.end, ev: n };
  const u = usualNight();
  return { id: null, bed: u.bed < 720 ? u.bed + 1440 : u.bed, wake: u.wake + 1440, ev: null };
}
/** This morning's wake-up (minutes from iso's midnight) and the sleep block it ends. */
export function morningOf(iso) {
  const all = allOn(iso) ?? [];
  const m = all.find((e) => e.sleep && e.start < 720 && e.end > 0 && e.end <= 900);
  if (m) return { id: m.id, wake: m.end, bed: m.start, ev: m };
  return { id: null, wake: usualNight().wake, bed: null, ev: null };
}
/** The waking day on iso: up → bed (bed may be after midnight). */
export function windowOf(iso) {
  const w = morningOf(iso).wake, b = nightOf(iso).bed;
  return { wake: Math.max(0, w), bed: Math.max(w + 60, b) };
}

// ── how long things take ────────────────────────────────────────────────
// estimateMinutes when he set one; else what this kind of task really took him (start → done, the PC's estimates:
// by title word, else by area), rounded to 5; else 30.
const words = (s) => [...new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 3))];
export function learned(title, area) {
  const L = REAL ? boot()?.estimates : null;
  if (!L) return null;
  const hits = words(title).map((w) => L.byWord?.[w]).filter(Boolean);
  if (hits.length) return Math.round(hits.reduce((a, h) => a + h.minutes, 0) / hits.length / 5) * 5;
  return L.byArea?.[area ?? 'none']?.minutes ?? null;
}
/** How much this kind of work runs over its estimate (1.25 = 25% over), from the PC's history. */
export const overrun = (area) => (REAL ? boot()?.estimates?.byArea?.[area ?? 'none']?.over ?? null : null);
const LEN = REAL ? {} : { t1: 15, t2: 60, t3: 30, t4: 30, t12: 30, t13: 45, t14: 30, t15: 45, t16: 60, t17: 30, t18: 20, t22: 10, t23: 15, t25: 30 };
export const lenOf = (task) => Math.max(5, task?.len ?? task?.est ?? LEN[task?.id] ?? 30);
/** The note beside Length in the task sheet: 'usually 45m' / 'runs 25% over', '' when nothing to say. */
export function lenNote(task) {
  if (!task || task.status === 'done') return '';
  const real = learned(task.title, task.area), set = task.len;
  if (real && set && Math.abs(real - set) >= 10) return `usually ${real >= 60 ? `${Math.floor(real / 60)}h${real % 60 ? ` ${real % 60}m` : ''}` : `${real}m`}`;
  const o = overrun(task.area);
  if (o && o >= 1.25) return `runs ${Math.round((o - 1) * 100)}% over`;
  return real && !set ? 'learned' : '';
}

// ── the outbox: writes outside the core sync (offline first, sent in order, retried) ───────────────────────────
// Each op: { id, method, path, body, key }. A newer op with the same key replaces a waiting one (two sleep changes →
// one PUT). A refusal (4xx) drops it and says why; offline or a PC error keeps it and retries (5 s × n, max 60 s).
const OUT_KEY = 'aos-today:outbox';
let outbox = REAL ? (ls.json(OUT_KEY) ?? []).filter((o) => o && o.path) : [];
let flushing = false, timer = 0, fails = 0;
let onRefused = (msg) => console.warn('[today] refused', msg);
export const setRefused = (fn) => { onRefused = fn; };
const saveOut = () => ls.set(OUT_KEY, JSON.stringify(outbox));
/** Queue a write. delay (ms): it waits that long first (an Undo can still cancel it by its key). */
export function send(method, path, body = null, { key = null, delay = 0 } = {}) {
  if (!REAL) return;
  if (key) outbox = outbox.filter((o) => o.key !== key);
  outbox.push({ id: clientId('o'), method, path, body, key, at: Date.now(), after: Date.now() + delay });
  saveOut();
  soon(delay);
}
/** Take back a write that hasn't gone yet (the Undo of something that waits). */
export function cancel(key) { const n = outbox.length; outbox = outbox.filter((o) => o.key !== key); if (outbox.length !== n) saveOut(); }
export const pendingOut = () => outbox.length;
function soon(ms) { G.clearTimeout(timer); timer = G.setTimeout(flush, ms); }
export async function flush() {
  if (!REAL || flushing || !outbox.length) return;
  flushing = true;
  try {
    while (outbox.length) {
      const o = outbox[0];
      if (o.after && o.after > Date.now()) { soon(o.after - Date.now() + 20); break; }
      try {
        await api(o.path, { method: o.method, body: o.body == null ? undefined : JSON.stringify(o.body), timeout: 20000 });
        outbox.shift(); fails = 0; saveOut();
      } catch (e) {
        if (e?.status >= 400 && e.status < 500 && ![404, 408, 409, 429].includes(e.status)) { outbox.shift(); saveOut(); onRefused(e.message); continue; }
        fails++;
        soon(Math.min(60000, 5000 * fails));
        break;
      }
    }
  } finally { flushing = false; }
}
if (REAL) {
  G.addEventListener?.('online', () => soon(200));
  G.document?.addEventListener('visibilitychange', () => { if (G.document.visibilityState === 'visible') soon(400); });
  onConnection((c) => { if (c.status === 'ok') soon(300); });
  if (outbox.length) soon(2500);
}

// ── the prototype's usual week (demo mode only) ────────────────────────
const WEEK = {
  1: [['Morning Gym · Pull day', t(6, 30), t(7, 45), 'personal', 'body', 'Gym, Midtown'], ['DSC II: Linear Algebra', t(9, 30), t(11, 30), 'college', 'mind', 'City College, Block A'], ['Shop: new arrivals shoot', t(15), t(16, 30), 'corner-market', 'money', 'Morgan & Co.'], ['Deep work · Atlas ERP', t(17), t(19), 'northwind', 'mission'], ['Dinner at home', t(20, 30), t(21, 15), 'personal', 'family']],
  2: [['Morning Gym · Legs', t(6, 30), t(7, 45), 'personal', 'body', 'Gym, Midtown'], ['GE I (Th.)', t(10, 30), t(11, 30), 'college', 'mind', 'City College, Block B'], ['P&S (Tut.)', t(12, 30), t(13, 30), 'college', 'mind', 'Room 14'], ['Client call · Glowbox', t(16), t(16, 45), 'northwind', 'money'], ['Deep work · Agentic OS', t(17), t(19, 30), 'projects', 'mission'], ['Journal', t(22), t(22, 15), 'personal', 'growth']],
  3: [['Morning Gym · Push day', t(6, 30), t(7, 45), 'personal', 'body', 'Gym, Midtown'], ['DSC I: Calculus', t(10, 30), t(11, 30), 'college', 'mind', 'City College, Block A'], ['Lab · Python', t(13, 30), t(16, 30), 'college', 'mind', 'Computer lab 2'], ['Deep work · Pulse Chat', t(16, 45), t(18, 45), 'projects', 'mission'], ['Dinner at home', t(20, 30), t(21, 15), 'personal', 'family']],
  4: [['Morning Gym · Push day', t(6, 30), t(7, 45), 'personal', 'body', 'Gym, Midtown'], ['GE I (Th.)', t(10, 30), t(11, 30), 'college', 'mind', 'City College, Block B'], ['P&S (Tut.)', t(12, 30), t(13, 30), 'college', 'mind', 'Room 14'], ['Shop: Corner Market listings', t(15), t(16, 15), 'corner-market', 'money', 'Morgan & Co.'], ['Deep work · Agentic OS', t(16, 30), t(18, 30), 'projects', 'mission'], ['Cardio + core', t(19), t(20), 'personal', 'body'], ['Dinner at home', t(20, 30), t(21, 15), 'personal', 'family']],
  5: [['Morning Gym · Legs', t(6, 30), t(7, 45), 'personal', 'body', 'Gym, Midtown'], ['GE I (Th.)', t(9), t(11), 'college', 'mind', 'City College, Block B'], ['At the store with Dad', t(15), t(18), 'morgan-co', 'money', 'Morgan & Co.'], ['Shoot: 2 reels (R2, R4)', t(19), t(20), 'content', 'mission'], ['Dinner at home', t(20, 30), t(21, 15), 'personal', 'family']],
  6: [['Gym · Upper body', t(7, 30), t(9), 'personal', 'body', 'Gym, Midtown'], ['Content: edit the week', t(11), t(13), 'content', 'mission'], ['Shop: weekend rush', t(15), t(17, 30), 'morgan-co', 'money', 'Morgan & Co.']],
  0: [['Long walk in the park', t(7), t(8), 'personal', 'body'], ['Family lunch', t(13), t(14, 30), 'personal', 'family', 'Home', ['mom', 'dad']], ['Weekly review', t(17), t(18), 'personal', 'growth'], ['Plan the week', t(18), t(18, 30), 'personal', 'growth']],
};
const EXTRA = { '2026-10-31': [['Shop: Diwali stock count', t(10), t(13), 'morgan-co', 'money', 'Morgan & Co.']], '2026-10-16': [['Atlas ERP onboarding call', t(18), t(19), 'northwind', 'money']] };
const demoCache = new Map();
function demoDay(iso) {
  if (iso === TODAY) return EVENTS.filter((e) => !e.task);
  if (demoCache.has(iso)) return demoCache.get(iso);
  const rows = [...(WEEK[parse(iso).getDay()] ?? []), ...(EXTRA[iso] ?? [])];
  const out = rows.map(([title, start, end, area, aspect, where, people], i) => ({ id: `${iso}-${i}`, title, full: title, start, end, area, aspect, where, people, date: iso, mock: true, editable: true }))
    .concat([{ id: `${iso}-sleep`, title: 'Sleep', full: 'Sleep', start: t(22, 45), end: t(30), area: 'personal', aspect: 'body', sleep: true, date: iso, editable: true }])
    .sort((a, b) => a.start - b.start);
  demoCache.set(iso, out);
  return out;
}
export const demoEvent = (id) => { for (const [, evs] of demoCache) { const e = evs.find((x) => x.id === id); if (e) return e; } return null; };

// svc/clock: the real now and today, in India time (the PC's agentos day), with minute ticks.
//
//   nowMs() · today() 'YYYY-MM-DD' · minutes() since local midnight · label(date) → { weekday, day, month, short, iso }
//   dayStart(date) ms · toMin(iso, date) · toIso(date, min) · dateOfIso(iso) · addDays · daysBetween · dparts · dayLabel
//   hm(min) 'HH:MM' · dur(min) '1h 20m' · ago(iso) '5m' · onMinute(fn) · onDay(fn) · freeze('17:40') (demo, screenshots)
//
// The offset comes from the server's bootstrap (today.utcOffsetMinutes, 330 for IST), so the phone and the PC agree on
// what "today" is wherever the phone travels. ?now=HH:MM moves the clock to that time today (development, screenshots);
// the clock still runs from there.
const G = globalThis;
let offset = 330;                 // minutes east of UTC
let delta = 0;                    // ms added to Date.now() (?now=, freeze)
let frozen = null;                // a fixed instant (demo mode: the prototype's Thu 22 Oct 2026 17:40)

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const TZ = 'Asia/Kolkata';

export function setOffset(minutes) { if (Number.isFinite(minutes)) offset = minutes; }
export const getOffset = () => offset;
export const nowMs = () => (frozen != null ? frozen : Date.now() + delta);
export const now = () => new Date(nowMs());

const pad = (n) => String(n).padStart(2, '0');
/** The local date (at the PC's offset) of an instant. */
export const dateAt = (ms) => new Date(ms + offset * 60000).toISOString().slice(0, 10);
export const today = () => dateAt(nowMs());
export const dayStart = (date) => Date.parse(`${date}T00:00:00Z`) - offset * 60000;
/** Minutes since local midnight, with fractions. */
export const minutes = () => (nowMs() - dayStart(today())) / 60000;
export const nowMin = () => Math.floor(minutes());
export const toMin = (iso, date = today()) => (Date.parse(iso) - dayStart(date)) / 60000;
export const toIso = (date, min) => new Date(dayStart(date) + Math.round(min) * 60000).toISOString().replace('.000Z', 'Z');
export const dateOfIso = (iso) => dateAt(Date.parse(iso));
export function addDays(date, n) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
export function dparts(date) { const d = new Date(`${date}T00:00:00Z`); return { dow: d.getUTCDay(), day: d.getUTCDate(), month: d.getUTCMonth(), year: d.getUTCFullYear() }; }
/** TODAY_LABEL's shape: { weekday: 'Thursday', day: 22, month: 'October', short: 'Thu 22 Oct', iso } */
export function label(date = today()) {
  const p = dparts(date);
  return { weekday: WEEKDAYS[p.dow], day: p.day, month: MONTHS[p.month], short: `${WEEKDAYS[p.dow].slice(0, 3)} ${p.day} ${MONTHS[p.month].slice(0, 3)}`, iso: date, year: p.year };
}
/** 'Today', 'Tomorrow', 'Yesterday', else 'Fri 23' */
export function dayLabel(date) {
  const t = today();
  if (date === t) return 'Today';
  if (date === addDays(t, 1)) return 'Tomorrow';
  if (date === addDays(t, -1)) return 'Yesterday';
  const p = dparts(date);
  return `${WEEKDAYS[p.dow].slice(0, 3)} ${p.day}`;
}
export const hm = (m) => { const t = ((Math.round(m) % 1440) + 1440) % 1440; return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`; };
export const dur = (m) => { m = Math.max(0, Math.round(m)); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${r}m`; };
/** How long ago, in the prototype's short words: 'now', '3m', '2h', '1d', '12 Oct'. */
export function ago(iso) {
  if (!iso) return '';
  const s = (nowMs() - Date.parse(iso)) / 1000;
  if (!Number.isFinite(s)) return '';
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)}d`;
  const p = dparts(dateOfIso(iso));
  return `${p.day} ${MONTHS[p.month].slice(0, 3)}`;
}

// ── development and demo ──────────────────────────────────────────────
/** Pin the clock to a time today ('17:40'), or to an instant (ms). Demo mode pins the prototype's Thu 22 Oct 17:40. */
export function freeze(at) {
  if (at == null) { frozen = null; return; }
  if (typeof at === 'number') { frozen = at; return; }
  const [h, m] = String(at).split(':').map(Number);
  frozen = dayStart(dateAt(Date.now())) + ((h || 0) * 60 + (m || 0)) * 60000;
}
(function readNowParam() {
  const q = G.location ? new URLSearchParams(G.location.search).get('now') : null;
  if (!q || !/^\d{1,2}:\d{2}$/.test(q)) return;
  const [h, m] = q.split(':').map(Number);
  const real = Date.now();
  delta = (dayStart(dateAt(real)) + (h * 60 + m) * 60000) - real;
})();

// ── ticks ─────────────────────────────────────────────────────────────
const minuteSubs = new Set(), daySubs = new Set();
let lastMin = null, lastDay = null, timer = 0;
export function onMinute(fn) { minuteSubs.add(fn); start(); return () => minuteSubs.delete(fn); }
export function onDay(fn) { daySubs.add(fn); start(); return () => daySubs.delete(fn); }
function fire() {
  const m = nowMin(), d = today();
  if (lastDay != null && d !== lastDay) for (const fn of daySubs) { try { fn(d); } catch (e) { console.warn('[clock] day listener', e); } }
  if (m !== lastMin || d !== lastDay) for (const fn of minuteSubs) { try { fn(m, d); } catch (e) { console.warn('[clock] minute listener', e); } }
  lastMin = m; lastDay = d;
}
function schedule() {
  if (frozen != null) return;
  G.clearTimeout?.(timer);
  const ms = 60000 - (nowMs() % 60000) + 50;
  timer = G.setTimeout?.(() => { fire(); schedule(); }, ms);
}
let started = false;
function start() {
  if (started || !G.setTimeout) return;
  started = true;
  lastMin = nowMin(); lastDay = today();
  schedule();
  // a phone asleep in a pocket skips timers; coming back catches up at once
  G.document?.addEventListener?.('visibilitychange', () => { if (G.document.visibilityState === 'visible') { fire(); schedule(); } });
}

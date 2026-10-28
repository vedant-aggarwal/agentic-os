// Soul on the iPhone: Face ID for Clean, Screen Time behind the family_controls flag (DECISIONS 4: off in 2.0.0, so
// the blocker runs in the app until Apple approves it), habit reminders, and the Streaks widget's data.
// Every call has a web/flag-off path; nothing here can break the app when a plugin is missing. Owner: the Soul agent.
import { native } from '../svc/native-plugins.js';
import { snapshotPart } from '../svc/native.js';
import * as ST from './soul-store.js';
import { parseHM, checkId } from './soul-logic.js';

// ── Face ID ───────────────────────────────────────────────────────────────
/** → { ok, native } · on the web (and on a phone without Face ID or passcode) the tap itself unlocks, as before */
export async function unlockClean() {
  if (!native.available) return { ok: true, native: false };
  const st = await native.auth.status();
  if (!st.available || (st.biometry === 'none' && !st.passcode)) return { ok: true, native: false };
  const r = await native.auth.authenticate({ reason: 'Open Clean', passcode: true });
  return { ok: !!r.ok, native: true, cancelled: !!r.cancelled };
}

// ── Screen Time ───────────────────────────────────────────────────────────
export const SCREEN = { checked: false, available: false, authorized: false, reason: 'web', picked: null };
export async function screenStatus() {
  const r = await native.screenTime.status();
  Object.assign(SCREEN, { checked: true, available: !!r.available, authorized: !!(r.available && (r.authorized ?? r.ok)), reason: r.reason ?? null, picked: r.picked ?? SCREEN.picked });
  return SCREEN;
}
export async function screenAuthorize() {
  const r = await native.screenTime.authorize(); await screenStatus();
  if (r.ok) { const p = await native.screenTime.pick(); if (p.ok) SCREEN.picked = { apps: p.apps ?? 0, categories: p.categories ?? 0, domains: p.domains ?? 0 }; }
  await applyLocks();
  return SCREEN;
}
const line = () => 'Soul · set by your agent';
/** the system shields follow the records: recurring windows as a schedule, today's "ask first" yes and "for now" as blocks */
export async function applyLocks() {
  if (!SCREEN.available || !SCREEN.authorized) return;
  const ls = ST.locks().filter((l) => l.on && (l.kind === 'window' || l.kind === 'bedtime') && !l.ask_first);
  await native.screenTime.schedule({ windows: ls.map((l) => ({ id: l.id, start: l.start, end: l.end, days: Array.isArray(l.days) && l.days.length ? l.days : undefined })), line: line() });
  const open = ST.openNow();
  if (open) { await native.screenTime.unblock({ minutes: Math.max(1, Math.ceil((open.until - ST.nowMs()) / 6e4)) }); return; }
  const hold = ST.holding().filter((l) => l.kind === 'now' || l.ask_first);
  if (hold.length) {
    const ends = hold.map((l) => (l.kind === 'now' ? Date.parse(l.until) : endsMs(l.ends))).filter(Number.isFinite);
    if (ends.length) await native.screenTime.block({ until: Math.max(...ends), line: line() });
  }
}
function endsMs(hm) {
  const e = parseHM(hm); if (e == null) return NaN;
  const start = ST.nowMs() - ST.nowMin() * 6e4; let t = start + e * 6e4;
  if (t <= ST.nowMs()) t += 864e5;
  return t;
}
/** a granted unlock opens the shield for its minutes (Screen Time's shortest interval is 15) */
export async function systemUnblock(minutes) { if (SCREEN.available && SCREEN.authorized) await native.screenTime.unblock({ minutes }); }
export async function systemRelock() { if (SCREEN.available && SCREEN.authorized) await applyLocks(); }

// ── habit reminders (local notifications; only for habits he asked to be reminded about) ──
export async function enableReminders() { const r = await native.notify.authorize(); return !!(r.available && r.granted); }
export async function scheduleReminders() {
  if (!native.available) return;
  const d = ST.today(); const m = ST.nowMin(); const base = ST.nowMs() - m * 6e4;
  for (const h of ST.habits()) {
    const id = `soul-h-${h.id}-${d}`;
    const at = parseHM(h.at);
    if (!h.remind || h.done || h.rested || at == null || at - 10 <= m) { native.notify.cancel({ id }); continue; }
    native.notify.schedule({
      id, at: base + (at - 10) * 6e4, title: h.title, body: h.atRisk ? `Due at ${h.at}. A miss today ends the run, so this one matters.` : `Due at ${h.at}.`,
      category: 'streak', thread: 'soul', url: `agenticos://soul/habit/${h.id}`,
      actions: { done: { path: '/api/v1/mod/soul/checks', method: 'POST', body: { id: checkId(h.id, d), habit: h.id, date: d, done: true, by: 'you', source: 'notification', at: new Date(base + at * 6e4).toISOString(), updated_at: new Date(base + at * 6e4).toISOString() } } },
    });
  }
}

// ── the widgets: habit streaks; Clean only when he turned it on, and always private ──
function streaks() {
  const endOfDay = Math.round((ST.nowMs() - ST.nowMin() * 6e4 + 864e5) / 1000);
  const out = ST.habits().filter((h) => h.streak > 0 || h.done).slice(0, 8).map((h) => ({ id: h.id, label: h.title.slice(0, 24), n: h.streak, today: !!h.done, atRisk: !!h.atRisk, ...(h.atRisk ? { due: endOfDay } : {}), aspect: h.aspect || 'soul' }));
  const c = ST.clean();
  if (c?.widget) { const t = ST.cleanText(); out.push({ id: 'clean', label: c.name.slice(0, 24), n: Number(t?.slice(4)) || 1, today: true, atRisk: false, aspect: 'soul', private: true }); }
  return out;
}

let started = false;
export function startNative() {
  if (started) return; started = true;
  snapshotPart('streaks:soul', streaks);
  if (!native.available) return;
  screenStatus().then(() => applyLocks());
  native.on('screentime', (e) => { if (e?.action === 'unlock-request') globalThis.__soulAskUnlock?.(); });
  let t = 0;
  ST.onChange(() => { clearTimeout(t); t = setTimeout(() => { scheduleReminders(); applyLocks(); snapshotPart('streaks:soul', streaks); }, 800); });
  scheduleReminders();
}

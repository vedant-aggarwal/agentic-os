// svc/native: the iPhone app's side of the bridge (legacy-app/app.js:488-498, 5762-5828), on top of NATIVE's wrappers
// (svc/native-plugins.js, v2/notes/native.md) when they are there, else the Capacitor plugins directly. Every call is
// safe on the web: it answers { available: false } or falls back (vibrate).
//
//   NATIVE · haptic(kind)  kind: 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error' | ms
//   start()                 after boot: widget snapshot schedule, push registration, notification and call events
//   shareSnapshot(now?)     the snapshot for widgets and the Day Live Activity (shape: v2/notes/native.md section 1)
//   snapshotPart(key, fn)   areas add their part: 'money' | 'streaks:<area>' (all merged into streaks) | 'agent' | anything in the v2 shape
//   setAgentLine(text)      the agent's last line for the Wyn widget (the Agent area calls it)
//   keyboardStatus() · openSettings() · requestPhotos() · exportFile({ name, base64 }) · plugins() → NATIVE's API or null
//   on(event, fn)           'notificationAction' | 'callState' | 'breath' | … (native events; web: never fires)
import { NATIVE as IS_NATIVE, token, api, apiBase } from './api.js';
import * as SYNC from './sync.js';
import * as clock from './clock.js';

const G = globalThis;
export const NATIVE = IS_NATIVE;
const cap = () => G.window?.Capacitor?.Plugins ?? {};
const NativeP = () => cap().Native ?? null;

// NATIVE's wrappers (svc/native-plugins.js) load lazily; until then (or without them) the plugins are called directly.
let wrappers = null, wrappersTried = false;
export async function plugins() {
  if (wrappersTried) return wrappers;
  wrappersTried = true;
  try { wrappers = await import('./native-plugins.js'); } catch (e) { wrappers = null; if (NATIVE) console.info('[native] native-plugins.js not loaded:', e?.message ?? e); }
  return wrappers;
}

// ── haptics ───────────────────────────────────────────────────────────
const VIBRATE = { light: 8, selection: 4, medium: 14, heavy: 20, success: [10, 60, 12], warning: [14, 80, 14], error: [20, 60, 20, 60, 20] };
export function haptic(kind = 'light') {
  if (typeof kind === 'number') kind = kind <= 0 ? null : kind <= 6 ? 'selection' : kind <= 10 ? 'light' : kind <= 16 ? 'medium' : 'heavy';
  if (!kind) return;
  const H = cap().Haptics;
  // the 2.0.0 native layer (Core Haptics patterns) when this build has it, else the Capacitor Haptics plugin
  if (NATIVE && wrappers?.native?.available && wrappers.native.haptics?.play) { wrappers.native.haptics.play(kind); return; }
  if (NATIVE && H) {
    try {
      if (kind === 'success' || kind === 'warning' || kind === 'error') H.notification({ type: kind.toUpperCase() });
      else if (kind === 'selection') H.selectionChanged();
      else H.impact({ style: kind === 'medium' ? 'MEDIUM' : kind === 'heavy' ? 'HEAVY' : 'LIGHT' });
    } catch {}
    return;
  }
  // the web: only after a tap (Chrome refuses vibrate before the user has touched the page)
  if (G.navigator?.userActivation && !G.navigator.userActivation.hasBeenActive) return;
  try { G.navigator?.vibrate?.(VIBRATE[kind] ?? 8); } catch {}
}

// ── events ────────────────────────────────────────────────────────────
const subs = new Map();
export function on(event, fn) {
  if (!subs.has(event)) {
    subs.set(event, new Set());
    const P = NativeP();
    if (NATIVE && P?.addListener) { try { P.addListener(event, (e) => { for (const f of subs.get(event) ?? []) { try { f(e); } catch (err) { console.warn('[native] listener', err); } } }); } catch {} }
  }
  subs.get(event).add(fn);
  return () => subs.get(event)?.delete(fn);
}

// ── small native calls (each answers { available: false } on the web) ─
const off = { available: false, ok: false, reason: 'web' };
const callP = async (name, args) => { const P = NativeP(); if (!NATIVE || !P?.[name]) return off; try { return { available: true, ok: true, ...(await P[name](args)) }; } catch (e) { return { available: true, ok: false, error: e?.message ?? String(e) }; } };
export const keyboardStatus = () => callP('keyboardStatus');
export const openSettings = () => callP('openSettings');
export const requestPhotos = () => callP('requestPhotos');
export const exportFile = (o) => callP('exportFile', o);
export const registerPush = () => callP('registerPush');

// ── the widget snapshot (Shared.swift Snapshot; v2 fields per v2/notes/native.md) ─
let data = null;            // js/data.js, handed in by start() (no import cycle)
let agentLine = null;
const parts = new Map();    // key → () => value: what the areas add (money, streaks, agent mood …)
export function snapshotPart(key, fn) { parts.set(key, fn); scheduleShare(); }
export function setAgentLine(text) { agentLine = text ? String(text).replace(/\s+/g, ' ').slice(0, 140) : null; scheduleShare(); }
const sec = (iso) => Date.parse(iso) / 1000;
function blocks() {
  const d = SYNC.state.data;
  if (!d) return [];
  const now = clock.nowMs() / 1000, out = [], seen = new Set();
  const days = new Set([clock.today(), clock.addDays(clock.today(), 1)]);
  const areaOf = (slug) => (slug ? data.AREAS[slug] : null);
  for (const day of d.days) if (days.has(day.date)) for (const ev of day.events) {
    if (ev.allDay || seen.has(ev.id)) continue;
    seen.add(ev.id);
    const s = sec(ev.start), e = sec(ev.end);
    const a = areaOf(ev.area);
    if (e > s && e > now - 3600) out.push({ title: String(ev.title ?? '').replace(/\s*\([^)]*\)/g, '').trim() || 'Busy', area: a?.name ?? '', color: a?.color ?? '#8e8e93', kind: /\bsleep\b/i.test(ev.title ?? '') ? 'sleep' : 'event', startAt: s, endAt: e });
  }
  for (const t of d.tasks) {
    if (!t.scheduled || t.status === 'done' || t.status === 'dropped') continue;
    const s = sec(t.scheduled.start);
    const e = t.scheduled.end ? sec(t.scheduled.end) : s + 60 * (t.estimateMinutes || 30);
    const a = areaOf(t.area);
    if (e > s && e > now - 3600 && s < now + 2 * 86400) out.push({ title: String(t.title ?? '') || 'Task', area: a?.name ?? '', color: a?.color ?? '#8e8e93', kind: 'task', startAt: s, endAt: e });
  }
  return out.sort((a, b) => a.startAt - b.startAt).slice(0, 100);
}
/** The snapshot as JSON-ready data (exported for tests and the lab). */
export function buildSnapshot() {
  if (!data) return null;
  const today = data.TASKS.filter((t) => ['today', 'overdue', 'doing'].includes(t.list) || t.doneToday);
  const snaps = data.LIFE.snapshots, latest = snaps.at(-1), prev = snaps.at(-2);
  const jobsNeeds = data.JOBS.filter((j) => j.lane === 'needs'), jobsWorking = data.JOBS.filter((j) => j.lane === 'working');
  const snap = {
    v: 2, at: Math.round(clock.nowMs() / 1000), name: data.ME.first || null, skin: G.document?.documentElement.dataset.skin ?? 'obsidian',
    blocks: blocks(), done: today.filter((t) => t.list === 'done').length, total: today.length,
    up: today.filter((t) => t.list !== 'done').slice(0, 3).map((t) => t.title),
    wyn: agentLine, wynName: data.AGENT.name,
    life: latest ? data.ASPECTS.filter((a) => a.score != null).map((a) => ({ id: a.id, name: a.name, score: a.score, p: Math.max(0, Math.min(1, a.score / 10)), ...(prev?.scores?.[a.id] != null ? { delta: a.score - prev.scores[a.id] } : {}) })) : [],
    agent: { name: data.AGENT.name, product: data.AGENT.product, last: agentLine, ask: null },
    jobs: data.USER?.owner ? {
      needs: jobsNeeds.length, working: jobsWorking.length, done: data.JOBS.filter((j) => j.lane === 'done' && j.ago && /^(now|\d+m|\d+h)$/.test(j.ago)).length,
      items: [...jobsNeeds, ...jobsWorking].slice(0, 3).map((j) => ({ id: j.id, title: j.title, engine: j.agent, state: j.lane === 'needs' ? 'needs' : 'working', url: `agenticos://job/${j.id}`, detail: j.ask?.text ?? j.progress?.step ?? j.last ?? '', since: Math.round(Date.parse(j.raw?.updatedAt ?? j.raw?.createdAt ?? new Date().toISOString()) / 1000) })),
    } : undefined,
  };
  // 'streaks' and every 'streaks:<area>' part are concatenated into one list (Growth, Mind, Content, Soul, Body each add
  // rows); 'agent' merges into the base; any other key replaces
  const streaks = [];
  for (const [k, fn] of parts) {
    try {
      const v = fn();
      if (v === undefined || v === null) continue;
      if (k === 'streaks' || k.startsWith('streaks:')) { for (const r of [v].flat()) if (r && !streaks.some((x) => x.id === r.id && x.aspect === r.aspect)) streaks.push(r); }
      else snap[k] = k === 'agent' ? { ...snap.agent, ...v } : v;
    } catch (e) { console.warn(`[native] snapshot part ${k}`, e); }
  }
  // the widget shows six: the ones at risk first, then the longest
  if (streaks.length) snap.streaks = streaks.sort((x, y) => (!!y.atRisk - !!x.atRisk) || ((y.n ?? 0) - (x.n ?? 0))).slice(0, 12);
  return snap;
}
let shareT = 0;
export function scheduleShare(ms = 1500) {
  if (!NATIVE || !NativeP()?.share || SYNC.state.source !== 'real') return;
  G.clearTimeout(shareT);
  shareT = G.setTimeout(shareSnapshot, ms);
}
export async function shareSnapshot() {
  const P = NativeP();
  if (!NATIVE || !P?.share) return off;
  try {
    let snap = buildSnapshot();
    if (!snap) return off;
    if (wrappers?.normalizeSnapshot) snap = wrappers.normalizeSnapshot(snap);
    // base: the widgets and Share extension call the same server the app signed in to
    await P.share({ token: token() || '', base: apiBase() || '', snapshot: JSON.stringify(snap) });
    return { available: true, ok: true };
  } catch (e) { return { available: true, ok: false, error: e?.message ?? String(e) }; }
}
// Wyn's last line for the widget, read from her chat (owner, iPhone only). The Agent area can push it instead.
async function readAgentLine() {
  if (!data?.USER?.owner) return;
  try {
    const st = await api('/wyn', { timeout: 10000 });
    const last = [...(st.messages ?? [])].reverse().find((m) => m.role === 'wyn' && m.text);
    if (last) setAgentLine(last.text);
  } catch {}
}

// ── start ─────────────────────────────────────────────────────────────
let started = false;
/**
 * After boot. route: route.js's link handler, for taps on notifications that carry a link.
 * bus: the shell's bus, for calls (startCall, incomingCall, openAgent) the Agent area provides.
 */
export async function start({ dataModule, route, bus }) {
  if (started) return;
  started = true;
  data = dataModule;
  if (!NATIVE) return;   // areas that want NATIVE's web fallbacks import svc/native-plugins.js themselves
  await plugins();
  if (SYNC.state.source !== 'real') return;
  const P = NativeP();
  if (!P) return;
  // counts, "now" and her last line stay fresh while the app is open; coming back refreshes too
  SYNC.onChange(() => scheduleShare());
  G.document?.addEventListener('data-changed', () => scheduleShare());
  G.document?.addEventListener('aspect-summary', () => scheduleShare());   // an app's figures changed (streaks, money)
  G.setInterval(() => { if (G.document?.visibilityState === 'visible') scheduleShare(); }, 5 * 60000);
  G.document?.addEventListener('visibilitychange', () => { if (G.document.visibilityState === 'visible') { readAgentLine(); scheduleShare(); } });
  readAgentLine().finally(() => scheduleShare(500));
  // a tap on a session alert (a job or terminal that needs him) opens it; Wyn's call and message actions go to her
  on('notificationAction', (e) => {
    if (e?.action === 'link' && e.url) { route?.(e.url, { from: 'push' }); return; }
    if (!data.USER?.owner) return;
    if (e?.action === 'answer') bus?.startCall?.({ incomingId: e.incomingId || null, reason: '' });
    else bus?.openAgent?.('chat');
  });
  on('callState', (e) => { G.document?.dispatchEvent(new CustomEvent('native-call', { detail: e })); });
  if (data.USER?.owner && data.AGENT.on) { try { await P.registerPush(); } catch {} }
}

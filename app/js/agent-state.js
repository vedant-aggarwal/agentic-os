// Her live state, shared by her tab, her thread, her pages and her alerts, so answering an ask in the thread also clears
// it from her home, the badge, Today and her day. Real mode fills it from the PC:
// - GET /api/v1/wyn/home every minute while the app is visible (her day: heartbeats, what she did, noticed and asked,
//   his mood, the ladder, tools, memory, calls), cached for an offline boot;
// - the chat long-poll GET /wyn?after=<id>&wait=25 (her messages, what she's busy with, an incoming call);
// - GET /wyn/summaries every five minutes (each app's own line: what she's watching).
// Writes (answers, Undo, settings, messages) go to the PC at once, or wait in an outbox while it's away and go out
// with an Idempotency-Key when it's back. Demo mode (?data=demo) draws the prototype's day from agent-data.js.
// His mood drives her orb everywhere (orb.js setMood) and the widget (svc/native snapshotPart 'agent').
import { $, esc } from './core.js';
import { I } from './icons.js';
import { AGENT, DEMO_MODE, FEED, USER, aspect } from './data.js';
import { aspectTile } from './aspects.js';
import { api, has } from './bus.js';
import * as API from './svc/api.js';
import { longPoll, every } from './svc/live.js';
import * as NATIVE from './svc/native.js';
import { setMood } from './orb.js';
import { demoHome, demoThread, hm, hmOf, minOf, EVERY } from './agent-data.js';

export const AG = {
  ready: false, offline: false, error: null, at: 0,
  name: AGENT.name, product: AGENT.product ?? 'Wyn',
  home: null,
  items: [], older: [], asks: [], beats: [], alarms: [],
  heartbeat: { on: false, every: EVERY, last: null, next: null, today: 0, quiet: 0 },
  mood: null, ladder: null, prefs: {}, tools: null, memory: null, calls: null, breaths: null, busyBlock: null,
  watching: [],
  thread: { messages: [], busy: null, incoming: null, prefs: null, loaded: false, pending: [], open: false },
  checking: false,
};

const subs = new Set();
/** fn(what, detail) after every change: 'home' | 'thread' | 'message' | 'incoming' | 'asks' | 'did' | 'mood' | 'watching' | 'prefs' | 'error' | 'check'. */
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const changed = (what, detail) => subs.forEach((fn) => { try { fn(what, detail); } catch (e) { console.warn('[agent] refresh failed', e); } });

export const owner = () => DEMO_MODE || !!USER?.owner;
export const agName = () => AG.name || AGENT.name || 'Wyn';
export const openAsks = () => AG.asks.filter((a) => a.status === 'open');
export const didToday = () => AG.items.filter((d) => d.kind === 'did' || d.kind === 'call');
// the nine aspects keep their own names; her other places have plain ones
const PLACES = { tasks: 'Tasks and calendar', calendar: 'Calendar', work: 'Work', content: 'Content OS', brain: 'Brain', memory: 'Her memory', agent: AGENT.name || 'Wyn', life: 'Life', scan: 'Scan', people: 'People' };
export const aspName = (id) => aspect(id)?.name ?? PLACES[id] ?? (id ? String(id).replace(/^./, (c) => c.toUpperCase()) : 'Today');
/** Which app an item belongs to, for its tile and colour. */
export const home = (x) => x?.app ?? x?.aspect ?? 'tasks';
export function tileFor(id, cls = '') {
  if (aspect(id)) return aspectTile(id, cls);
  const glyph = { content: I.content, work: I.work, brain: I.brain, memory: I.brain, scan: I.camera, agent: I.sparkle, life: I.grid, people: I.people }[id] ?? I.cal;
  return `<span class="tile ag-tile-${esc(id ?? 'tasks')} ${cls}" aria-hidden="true">${glyph}</span>`;
}
// how each of the nine apps looks from her side today: waiting on him beats done beats quiet
export function dotState(id) {
  if (openAsks().some((a) => home(a) === id) || AG.alarms.some((a) => home(a) === id && a.status === 'open')) return 'needs';
  if (didToday().some((d) => home(d) === id && !d.undone) || AG.items.some((d) => d.kind === 'noticed' && home(d) === id)) return 'did';
  return 'quiet';
}
// the heartbeat ring: how far through the 15 minutes to the next check
export function beatP() {
  const h = AG.heartbeat;
  if (!h?.last?.at) return 0;
  const every = (h.every || EVERY) * 60000;
  return Math.max(0, Math.min(1, (nowMs() - Date.parse(h.last.at)) / every));
}
export const nextLabel = () => (AG.heartbeat?.next ? hmOf(AG.heartbeat.next) : AG.heartbeat?.on === false ? 'off' : '—');
const nowMs = () => (DEMO_MODE ? Date.UTC(2026, 9, 22, 12, 10) : Date.now());
export const nowMin = () => minOf(new Date(nowMs()).toISOString());
// a small aspect dot, the only way aspect colour appears on her shared screens besides tiles and rings
export const dot = (id, cls = '') => `<i class="dot ${cls}" style="--c:var(--${aspect(id) ? id : 'ag'})" aria-hidden="true"></i>`;

// ── loading ───────────────────────────────────────────────────────────
const CACHE = 'agentos-app:agent-home';
function cached() { try { return JSON.parse(API.ls.get(CACHE) ?? 'null'); } catch { return null; } }
function keep(h) { try { API.ls.set(CACHE, JSON.stringify(h).slice(0, 400_000)); } catch {} }
let inflight = null;
/** Her whole day from the PC (or the demo). Quiet: no 'error' event. */
export function refresh({ quiet = false } = {}) {
  if (DEMO_MODE) { apply(demoHome()); return Promise.resolve(AG.home); }
  if (!owner()) return Promise.resolve(null);
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const h = await API.api('/wyn/home', { timeout: 15000 });
      AG.offline = false; AG.error = null;
      keep(h); apply(h);
      flush();
      return h;
    } catch (e) {
      AG.offline = !e?.status; AG.error = e?.message ?? 'Couldn’t reach the PC';
      if (!AG.home) { const c = cached(); if (c) apply(c, { stale: true }); }
      if (!quiet) changed('error');
      return null;
    } finally { inflight = null; }
  })();
  return inflight;
}
/** The home payload into her state, and out to everything that follows her (orb, widget, Today's FEED, the badge). */
export function apply(h, { stale = false } = {}) {
  if (!h) return;
  AG.home = h; AG.at = Date.now(); AG.stale = stale;
  AG.name = h.name || AG.name;
  AG.product = h.product || AG.product;
  AG.items = (h.items ?? []).filter((x) => x.kind !== 'alarm');
  AG.older = h.older ?? [];
  AG.alarms = [...(h.items ?? []), ...(h.older ?? []), ...(h.alarms ?? [])].filter((x) => x.kind === 'alarm');
  AG.asks = dedupe([...(h.asks ?? [])]);
  AG.beats = h.beats ?? [];
  AG.heartbeat = h.heartbeat ?? AG.heartbeat;
  AG.mood = h.mood ?? AG.mood;
  AG.ladder = h.ladder ?? AG.ladder;
  AG.prefs = h.prefs ?? AG.prefs;
  AG.tools = h.tools ?? AG.tools;
  AG.memory = h.memory ?? AG.memory;
  AG.calls = h.calls ?? AG.calls;
  AG.breaths = h.breaths ?? AG.breaths;
  AG.busyBlock = h.busy ?? null;
  if (h.watching) AG.watching = h.watching;
  mergeLocal();
  if (AG.name && AGENT.name !== AG.name && USER?.owner) { AGENT.name = AG.name; try { API.ls.set('agentos-app:agent', JSON.stringify({ name: AG.name })); } catch {} }
  AG.ready = true;
  follow();
  changed('home');
}
const dedupe = (list) => { const seen = new Set(); return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true))); };

// ── what other apps hold on this phone, in her day beside the PC's: Soul's lock ask (answered through answerLockAsk,
// never /wyn/asks) and what Scan filed today ("Filed: …", with the link to where it went). via marks them.
function localAsks() {
  if (DEMO_MODE || !has('soulLockAsk')) return [];
  let a = null; try { a = api.soulLockAsk(); } catch { a = null; }
  if (!a || a.state !== 'pending') return [];
  return [{ id: a.id, via: 'soul', kind: 'ask', status: 'open', app: 'soul', source: 'tool', day: AG.home?.day, at: a.at, time: hmOf(a.at), title: a.title, text: a.text ?? '', ask: { yes: 'Lock it', no: 'Not today' } }];
}
function localDid() {
  if (DEMO_MODE || !has('scanFiled')) return [];
  let list = []; try { list = api.scanFiled(AG.home?.day) ?? []; } catch { list = []; }
  return list.map((f) => ({ id: `scan:${f.id}`, via: 'scan', kind: 'did', status: 'done', app: f.app, source: f.source === 'share' ? 'share' : 'scan', by: f.by, day: AG.home?.day, at: f.at, time: hmOf(f.at), title: `Filed: ${f.title}`, text: f.where ?? '', link: f.link }));
}
function mergeLocal() {
  AG.asks = dedupe([...AG.asks.filter((x) => !x.via), ...localAsks()]);
  AG.items = [...AG.items.filter((x) => !x.via), ...localDid()].sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
}
// Soul's asks or the scan history changed on this phone (or from the PC): her day follows, once per burst
let localT = 0;
document.addEventListener('store-changed', (e) => {
  if (!AG.ready || !/^(soul\/asks|scan\/items)$/.test(e.detail?.name ?? '')) return;
  clearTimeout(localT);
  localT = setTimeout(() => { mergeLocal(); follow(); changed('asks'); changed('home'); }, 250);
});

// his mood and her line go everywhere she shows up
let lastFeedSig = '';
function follow() {
  const m = AG.mood;
  if (m) {
    try { setMood({ stress: m.stress, energy: m.energy, valence: m.valence }); } catch {}
    document.documentElement.dataset.mood = m.overloaded ? 'overloaded' : String(m.label ?? '').toLowerCase();
  }
  try {
    NATIVE.snapshotPart('agent', () => {
      const ask = openAsks().find((a) => !a.via);   // the widget's Yes/No posts to /wyn/asks: hers from the PC only
      return { name: agName(), product: AG.product, mood: m?.label ?? null, stress: m?.stress ?? null, energy: m?.energy ?? null, valence: m?.valence ?? null,
        ask: ask && !ask.ask?.question ? { id: ask.id, title: ask.title, yes: ask.ask?.yes ?? 'Yes', no: ask.ask?.no ?? 'Not now' } : null };
    });
  } catch {}
  // Today and the apps read FEED (data.js): her open asks, her nudges and what she did, in the prototype's shape
  if (!DEMO_MODE) {
    const feed = [
      ...openAsks().map((a) => ({ id: a.id, at: a.time ?? hmOf(a.at), kind: 'ask', aspect: aspect(home(a)) ? home(a) : null, app: home(a), title: a.title, text: a.text ?? '',
        acts: a.ask?.question ? undefined : [[a.ask?.yes ?? 'Yes', 'feed-yes'], [a.ask?.no ?? 'Not now', 'feed-no']] })),
      ...AG.items.filter((x) => x.kind === 'nudge' && x.status === 'open').map((x) => ({ id: x.id, at: x.time, kind: 'nudge', aspect: aspect(home(x)) ? home(x) : null, app: home(x), title: x.title, text: x.text ?? '' })),
      ...AG.alarms.filter((x) => x.status === 'open').map((x) => ({ id: x.id, at: hmOf(x.ladder?.alarmAt ?? x.at), kind: 'alarm', aspect: aspect(home(x)) ? home(x) : null, app: home(x), title: x.title, text: x.text ?? '', later: true })),
      ...AG.items.filter((x) => x.kind === 'did' && !x.undone).slice(0, 8).map((x) => ({ id: x.id, at: x.time, kind: 'did', aspect: aspect(home(x)) ? home(x) : null, app: home(x), title: x.title, text: x.text ?? '' })),
    ];
    const sig = JSON.stringify(feed);
    if (sig !== lastFeedSig) {
      lastFeedSig = sig;
      FEED.length = 0; FEED.push(...feed);
      document.dispatchEvent(new CustomEvent('data-changed', { detail: { why: 'agent' } }));
    }
  }
  paintBadge();
}

// what she's watching: each app's own summary line, five minutes fresh
const watchLine = (app, s) => {
  if (!s || s.error) return null;
  if (typeof s.line === 'string' && s.line.trim()) return s.line.trim();
  if (app === 'mind' && s.screen?.text) return `Screen ${s.screen.text} today`;
  if (app === 'soul' && s.habits?.total) return `${s.habits.done} of ${s.habits.total} habits today`;
  if (app === 'money') return s.budgeted === false ? 'No budget set yet' : s.today ? `₹${Math.round(s.today.left ?? 0).toLocaleString('en-IN')} left today` : null;
  if (app === 'mission') { const g = (s.goals ?? []).find((x) => x.current) ?? s.goals?.[0]; return g ? `${String(g.title).slice(0, 34)}${g.title.length > 34 ? '…' : ''}: ${g.pace ?? `${Math.round((g.progress ?? 0) * 100)}%`}` : null; }
  if (app === 'content' && s.counts?.edits?.review) return `${s.counts.edits.review} edits to review`;
  return null;
};
export async function loadWatching() {
  if (DEMO_MODE || !owner()) return;
  try {
    const r = await API.api('/wyn/summaries', { timeout: 15000 });
    AG.watching = Object.entries(r.apps ?? {}).map(([app, s]) => ({ app, line: watchLine(app, s), gaps: s?.gaps ?? [] })).filter((w) => w.line);
    changed('watching');
  } catch {}
}

// ── the thread ────────────────────────────────────────────────────────
let poll = null;
const maxId = (list) => list.reduce((m, x) => (typeof x.id === 'number' && x.id > m ? x.id : m), 0);
function applyThread(s, { first = false } = {}) {
  const T = AG.thread;
  const before = maxId(T.messages);
  const byId = new Map(T.messages.map((m) => [m.id, m]));
  for (const m of s.messages ?? []) byId.set(m.id, m);
  T.messages = [...byId.values()].sort((a, b) => a.id - b.id).slice(-300);
  const wasBusy = T.busy?.status;
  T.busy = s.busy ?? null;
  T.prefs = s.prefs ?? T.prefs;
  T.loaded = true;
  const inc = s.incoming ?? null;
  const newInc = inc && inc.id !== T.incoming?.id;
  T.incoming = inc;
  changed('thread');
  if (!first) for (const m of (s.messages ?? []).filter((x) => x.id > before && x.role !== 'user')) changed('message', m);
  if (newInc) changed('incoming', inc);
  if (wasBusy !== T.busy?.status) changed('busy', T.busy);
  const lastHers = [...T.messages].reverse().find((m) => m.role === 'wyn');
  if (lastHers) try { NATIVE.setAgentLine(lastHers.text); } catch {}
}
export async function loadThread() {
  if (DEMO_MODE) { if (!AG.thread.loaded) { AG.thread.messages = demoThread(); AG.thread.loaded = true; changed('thread'); } return; }
  if (!owner()) return;
  try { applyThread(await API.api('/wyn', { timeout: 15000 }), { first: !AG.thread.loaded }); } catch {}
}
let started = false;
/** Once, at boot (owner): her day every minute, the thread's long-poll, what she watches every five minutes. */
export function startLive() {
  if (started) return;
  started = true;
  if (DEMO_MODE) { refresh(); loadThread(); return; }
  const c = cached();
  if (c && !AG.home) apply(c, { stale: true });
  every(60000, () => refresh({ quiet: true }), { now: true, when: owner });
  every(5 * 60000, loadWatching, { now: true, when: owner });
  // the first call returns the recent thread at once; then it waits for anything new
  poll = longPoll((cur) => (cur ? `/wyn?after=${cur}&wait=25` : '/wyn'), { cursor: 0, next: (r) => maxId(r.messages ?? []) || null,
    onData: (r) => { const first = !AG.thread.loaded; applyThread(r, { first }); if (!first && (r.messages ?? []).some((m) => m.meta?.changes || m.meta?.did || m.role === 'call')) refresh({ quiet: true }); },
    when: owner, timeout: 40000 });
  addEventListener('online', () => { flush(); refresh({ quiet: true }); });
  API.onConnection?.((st) => { if (st?.status === 'ok') flush(); });
}
export const pollNow = () => poll?.now?.();

// ── writes: at once, or from the outbox when the PC is back ──
const OUTBOX = 'agentos-app:agent-outbox';
const box = () => { try { return JSON.parse(API.ls.get(OUTBOX) ?? '[]'); } catch { return []; } };
const saveBox = (b) => { try { API.ls.set(OUTBOX, JSON.stringify(b.slice(-100))); } catch {} };
/** A write to her routes. Offline (no answer at all), it waits in the outbox and goes out later with the same key. */
export async function act(path, body = {}, { method = 'POST', queue = true } = {}) {
  if (DEMO_MODE) return { demo: true };
  const key = API.clientId('ag');
  try {
    const call = method === 'PUT' ? API.put : method === 'DELETE' ? (p) => API.del(p) : API.post;
    return await call(path, body, { headers: { 'Idempotency-Key': key } });
  } catch (e) {
    if (!e?.status && queue) { const b = box(); b.push({ key, path, method, body, at: Date.now() }); saveBox(b); changed('outbox', b.length); return { queued: true }; }
    throw e;
  }
}
let flushing = false;
export async function flush() {
  if (flushing || DEMO_MODE) return;
  const b = box();
  if (!b.length) return;
  flushing = true;
  try {
    const left = [];
    for (const op of b) {
      try {
        const call = op.method === 'PUT' ? API.put : op.method === 'DELETE' ? (p) => API.del(p) : API.post;
        await call(op.path, op.body, { headers: { 'Idempotency-Key': op.key } });
      } catch (e) { if (!e?.status) left.push(op); }   // still away: keep it; a refusal (4xx) is dropped
    }
    saveBox(left);
    if (left.length !== b.length) { refresh({ quiet: true }); pollNow(); }
  } finally { flushing = false; }
}
export const pending = () => box().length;

// ── his answers, Undo, the ladder ──
/** An ask answered (yes or no). Optimistic: it leaves "waiting on you" at once; the PC's answer refreshes her day. */
export async function answer(id, yes, { text } = {}) {
  const a = AG.asks.find((x) => x.id === id);
  if (a) { a.status = yes ? 'yes' : 'no'; changed('asks'); }
  // Soul's lock ask: Soul answers it on this phone (its store syncs it to the PC), so every screen agrees
  if (a?.via === 'soul') {
    const f0 = FEED.findIndex((x) => x.id === id); if (f0 >= 0) { FEED.splice(f0, 1); document.dispatchEvent(new CustomEvent('data-changed', { detail: { why: 'agent' } })); }
    paintBadge();
    try { api.answerLockAsk(!!yes); } catch (e) { a.status = 'open'; changed('asks'); throw e; }
    return { did: { title: yes ? 'Locked for that window.' : 'Open today.' } };
  }
  const f = FEED.findIndex((x) => x.id === id); if (f >= 0) { FEED.splice(f, 1); document.dispatchEvent(new CustomEvent('data-changed', { detail: { why: 'agent' } })); }
  paintBadge();
  if (DEMO_MODE) return { demo: true };
  try {
    // an agent's question without his words: "Not now" (the agent hears it and decides for itself)
    const r = /^ask_/.test(id) ? await act(`/wyn/asks/${id}/answer`, { text: text || (yes ? 'Yes' : 'Not now'), choice: yes ? 'yes' : 'no' })
      : await act(`/wyn/feed/${id}/answer`, { choice: yes ? 'yes' : 'no', ...(text ? { text } : {}) });
    refresh({ quiet: true }); pollNow();
    return r;
  } catch (e) { if (a) { a.status = 'open'; changed('asks'); } throw e; }
}
/** An ask answered elsewhere (Today, its own app): the same, by id. */
export function askDoneElsewhere(id, yes) { return answer(id, !!yes).catch(() => null); }
export async function undoItem(id) {
  const x = [...AG.items, ...AG.older].find((i) => i.id === id);
  if (x) { x.undone = true; x.status = 'undone'; changed('did'); }
  if (DEMO_MODE) return { demo: true };
  try { const r = await act(`/wyn/feed/${id}/undo`, {}, { queue: false }); refresh({ quiet: true }); return r; }
  catch (e) { if (x) { x.undone = false; x.status = 'done'; changed('did'); } throw e; }
}
/** Undo one change she made in chat (a row of meta.changes). */
export async function undoChange(changeId) {
  if (DEMO_MODE) return { demo: true };
  const r = await act('/wyn/undo', { change: changeId }, { queue: false });
  refresh({ quiet: true }); pollNow();
  return r;
}
export const snooze = (id, minutes = 10) => (DEMO_MODE ? Promise.resolve({ minutes, argue: null }) : act(`/wyn/feed/${id}/snooze`, { minutes }));
export const seen = (ids) => (DEMO_MODE || !ids.length ? Promise.resolve(null) : act('/wyn/seen', { ids }));
/** Run one heartbeat now ("Check now"): the PC reads every app and the day. */
export async function checkNow() {
  if (DEMO_MODE) return { beat: { kind: 'ok', note: 'All on track', model: 'rules only', checked: 8 }, items: [] };
  const r = await API.post('/wyn/heartbeat', { force: true }, { timeout: 120000 });
  await refresh({ quiet: true });
  return r;
}
export async function savePrefs(patch) {
  AG.prefs = { ...AG.prefs, ...patch };
  if (patch.name) AG.name = patch.name;
  changed('prefs');
  if (DEMO_MODE) return AG.prefs;
  const r = await act('/wyn/prefs', patch, { method: 'PUT' });
  refresh({ quiet: true });
  return r;
}

// the tab bar badge: how many asks are waiting. main.js draws the tab, so paint it once the app is ready and after every change
export function paintBadge() {
  const tab = $('#tabAgent'); if (!tab) return;
  const n = openAsks().length;
  let b = $('.tbadge', tab);
  if (!n) { b?.remove(); return; }
  if (!b) { tab.insertAdjacentHTML('beforeend', '<i class="tbadge ag-tbadge"></i>'); b = $('.tbadge', tab); }
  b.textContent = String(n);
  b.setAttribute('aria-label', `${n} waiting on you`);
}

// icons the agent needs that js/icons.js doesn't have yet (same 2px line). Requested for icons.js in notes/agent.md
const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const AI = {
  bell: s('<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2h-14z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  banner: s('<rect x="3.5" y="4" width="17" height="7" rx="3.5"/><path d="M6 15.5h12M8 19h8"/>'),
  alarm: s('<circle cx="12" cy="13" r="7"/><path d="M12 9.5V13l2.4 1.6M5 4.5 3 6.5M19 4.5l2 2"/>'),
  heartbeat: s('<path d="M3 12h3.5l2-5 3 10 2.5-7 1.5 2H21"/>'),
  attach: s('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.2"'),
  quote: s('<path d="M7 17c-1.7 0-3-1.3-3-3v-1c0-3.3 1.8-5.6 5-6.5M17 17c-1.7 0-3-1.3-3-3v-1c0-3.3 1.8-5.6 5-6.5"/>'),
  wave: s('<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 11v2"/>'),
  snooze: s('<path d="M4 4.5h6l-6 7h6M14 11.5h6l-6 8h6"/>'),
  freeze: s('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="m9.5 4.5 2.5 2 2.5-2M9.5 19.5l2.5-2 2.5 2"/>'),
  play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.9l10.2-6.5a1 1 0 0 0 0-1.8L9.5 4.6A1 1 0 0 0 8 5.5Z"/></svg>`,
  breath: s('<path d="M12 4c-3 2.5-3 5.5 0 8s3 5.5 0 8M7 6.5c-2 2-2 4 0 5.5M17 6.5c2 2 2 4 0 5.5"/>'),
  shield: s('<path d="M12 3.5 5 6v5.5c0 4 3 7.5 7 9 4-1.5 7-5 7-9V6z"/>'),
};

export { esc, I, hm, hmOf, minOf, api, has };

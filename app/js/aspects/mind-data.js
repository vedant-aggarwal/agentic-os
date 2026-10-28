// Mind: the live model. Same names and shapes the screens were built on (the prototype's mind-data), filled from the
// real data: GET /mod/mind/day and /days (the PC's screen time, the usual day, tonight's blocks with Wyn's guesses),
// and eight offline-first collections (books, sessions, highlights, courses, lessons, checkins, screen, apps).
// Arrays and objects are refilled in place and each book/course keeps its object across refreshes, so a pushed page
// that holds one stays current. Demo mode (?data=demo) copies the prototype's sample in (mind-demo.js) and never syncs.
// Writes: the screens change the view at once (as the prototype did) and call the save* functions below, which put
// the change in a collection (phone first, PC when it answers); the collection's change re-derives everything.
// Owner: the Mind agent. Prefix min-.
import { DEMO_MODE, TASKS, GOALS, NOW } from '../data.js';
import * as clock from '../svc/clock.js';
import { collection } from '../svc/store.js';
import * as API from '../svc/api.js';
import * as DEMO from './mind-demo.js';

const G = globalThis;
export const REAL = !DEMO_MODE;
export const fmt = (m) => {
  m = Math.max(0, Math.round(m || 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};
export const hm = (t) => `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
export const mmss = (sec) => { sec = Math.max(0, Math.round(sec || 0)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
export const durSec = (d) => { if (!d) return 0; const p = String(d).split(':').map(Number); if (p.some((x) => !Number.isFinite(x))) return 0; return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + (p[1] ?? 0); };
export const nowMin = () => (DEMO_MODE ? NOW : clock.nowMin());   // demo: 17:40
export const today = () => (DEMO_MODE ? '2026-10-22' : clock.today());

// ── the four kinds of screen time ─────────────────────────────────────────
export const KINDS = DEMO.KINDS;
export const kindName = (id) => KINDS.find((k) => k.id === id)?.name ?? 'Other';
// the answers a block can get, per kind of app (the CLI module's LABELS; the server sends them with each block too)
const L = (id, name, kind, aspect) => ({ id, name, kind, aspect });
export const LABELS = {
  video: [L('learn', 'Learning', 'learning', 'mind'), L('fun', 'Entertainment', 'entertainment', null), L('music', 'Music', 'entertainment', null), L('work', 'Work research', 'work', 'mission')],
  feed: [L('research', 'Content research', 'work', 'mission'), L('scroll', 'Scrolling', 'entertainment', null), L('dms', 'Friends’ messages', 'social', 'friends'), L('posting', 'Posting', 'work', 'mission')],
  chat: [L('friends', 'Friends', 'social', 'friends'), L('clients', 'Clients', 'work', 'mission'), L('college', 'College', 'learning', 'mind'), L('family', 'Family', 'social', 'family')],
  ai: [L('work', 'Work', 'work', 'mission'), L('college', 'College', 'learning', 'mind'), L('learn', 'Learning', 'learning', 'mind'), L('personal', 'Personal', 'social', null)],
  browser: [L('work', 'Work', 'work', 'mission'), L('learn', 'Learning', 'learning', 'mind'), L('fun', 'Entertainment', 'entertainment', null), L('shop', 'Shopping', 'entertainment', null)],
  tool: [L('work', 'Work', 'work', 'mission'), L('learn', 'Learning', 'learning', 'mind'), L('college', 'College', 'learning', 'mind'), L('personal', 'Personal', 'social', null)],
  learn: [L('learn', 'Learning', 'learning', 'mind'), L('college', 'College', 'learning', 'mind'), L('work', 'Work', 'work', 'mission'), L('fun', 'Entertainment', 'entertainment', null)],
  other: [L('work', 'Work', 'work', 'mission'), L('learn', 'Learning', 'learning', 'mind'), L('social', 'People', 'social', null), L('fun', 'Entertainment', 'entertainment', null)],
};
// what he can type for an app in the log sheet ("Instagram 40 min"): id, name, kind, ask, glyph, cat
const PHONE_APPS = { instagram: ['Instagram', 'social', true, 'photo', 'feed'], youtube: ['YouTube', 'entertainment', true, 'video', 'video'], whatsapp: ['WhatsApp', 'social', true, 'chat', 'chat'],
  x: ['X', 'entertainment', true, 'globe', 'feed'], reddit: ['Reddit', 'entertainment', true, 'globe', 'feed'], snapchat: ['Snapchat', 'social', true, 'photo', 'feed'], linkedin: ['LinkedIn', 'work', true, 'globe', 'feed'],
  netflix: ['Netflix', 'entertainment', false, 'video', 'video'], spotify: ['Spotify', 'entertainment', false, 'music', 'video'], chatgpt: ['ChatGPT', 'work', true, 'sparkle', 'ai'], claude: ['Claude', 'work', false, 'claude', 'ai'],
  skool: ['Skool', 'learning', false, 'cap', 'learn'], telegram: ['Telegram', 'social', true, 'chat', 'chat'], gmail: ['Gmail', 'work', false, 'mail', 'tool'], chrome: ['Chrome', 'work', true, 'globe', 'browser'], safari: ['Safari', 'work', true, 'globe', 'browser'] };
const ALIAS = { insta: 'instagram', ig: 'instagram', yt: 'youtube', wa: 'whatsapp', twitter: 'x', gpt: 'chatgpt', reels: 'instagram' };
export const appWord = (w) => { const s = String(w ?? '').toLowerCase().replace(/[^a-z0-9]/g, ''); return ALIAS[s] ?? (PHONE_APPS[s] ? s : Object.keys(PHONE_APPS).find((k) => k.startsWith(s) && s.length >= 3) ?? null); };
export const phoneApp = (id) => { const p = PHONE_APPS[id]; return p ? { id, name: p[0], kind: p[1], ask: p[2], glyph: p[3], cat: p[4] } : { id, name: id, kind: 'work', ask: true, glyph: 'grid', cat: 'other' }; };
export const APP_NAMES = Object.entries(PHONE_APPS).map(([id, p]) => [id, p[0]]);

// ── today's apps, by the hour ──────────────────────────────────────────────
export const APPS = [];
export const app = (id) => APPS.find((a) => a.id === id);
export const appMin = (a) => Object.values(a.hours ?? {}).reduce((s, v) => s + v, 0) || a.minutes || 0;
export const H0 = 6, H1 = 23;
export const HOURS = Array.from({ length: H1 - H0 + 1 }, (_, i) => H0 + i);
export const hourMin = (h) => APPS.reduce((s, a) => s + (a.hours?.[h] ?? 0), 0);
export const todayMin = () => Math.round(APPS.reduce((s, a) => s + appMin(a), 0));
export const USUAL = {};
export const usualDay = () => Object.values(USUAL).reduce((s, v) => s + v, 0);
export const usualByNow = () => {
  const n = nowMin(), h = Math.floor(n / 60), part = (n % 60) / 60;
  return Math.round(Object.entries(USUAL).filter(([x]) => +x < h).reduce((s, [, v]) => s + v, 0) + (USUAL[h] ?? 0) * part);
};
export const USUAL_APP = {};
export const WEEK_APP = {};
export const PICKUPS = { n: null, first: null, firstApp: '' };
export let NOTIFS = null;
// the day's sources and what the screens should say about them
export const MD = { loaded: !REAL, day: null, usualDays: 0, usualBasis: 'weekday', sources: { pc: false, screenTime: false, manual: false }, offline: false, error: null, weekday: '' };

// ── the evening check-in ──────────────────────────────────────────────────
export let CHECKIN_AT = 21 * 60 + 20;
export const BLOCKS = [];
export let STREAK = 0;
export const WEEK = [];
export let LAST_WEEK_AVG = 0;
export const FOR_WEEK = {};
export const MONTH = { year: 2026, month: 9, first: 3, days: [], answered: new Set(), today: 22, name: 'October' };
export const FOCUS = [];
export const INPUTS = [];
export const OUTPUTS = [];
export const OUTPUT_ITEMS = [];

// ── the library and courses ───────────────────────────────────────────────
export const BOOKS = [];
export const book = (id) => BOOKS.find((b) => b.id === id);
export let YEAR_GOAL = 12;
export let DAYS_LEFT = 70;
export let YEAR_GONE = 0.81;
export let READ_GOAL = 20;
export const READ_WEEK = [];
export const NOTES = [];
export const COURSES = [];
export const LIBRARY = [];   // the Skool Vault and call recordings: collections, not courses to finish
export const course = (id) => COURSES.find((c) => c.id === id) ?? LIBRARY.find((c) => c.id === id);
export const COLLEGE = [];
export let LEARN_GOAL = 180;
export const LEARN_WEEK = [];
export const READ_GOAL_ID = { id: null };   // the Mission goal about books, when there is one

// ── state: what changes while he taps ──────────────────────────────────────
export const S = { app: null, checkin: { done: false, answers: null }, readToday: 0, learnExtra: 0, learnBase: 0, reviewed: new Set(), log: [] };
export const courseLeft = (c) => c.lessons.reduce((s, l, i) => s + (c.ldone?.[i] ? 0 : durSec(l[1]) - (i === c.cur && c.at ? durSec(c.at) : 0)), 0) / 60;
export const readWeekToday = () => READ_WEEK.map(([d, m], i) => [d, REAL ? m : i === READ_WEEK.length - 1 ? m + S.readToday : m]);
export const learnWeek = () => (REAL ? S.learnBase + S.learnExtra : DEMO.LEARN_WEEK.reduce((s, [, m]) => s + m, 0) + S.learnExtra);
export const pace = (b) => { const s = b?.sessions ?? []; const p = s.reduce((x, r) => x + (r[3] - r[2]), 0); const m = s.reduce((x, r) => x + r[1], 0); return m >= 10 && p > 0 ? p / m : 0.6; };
export const bookMin = (b) => (b.sessions ?? []).reduce((x, r) => x + r[1], 0);
export const finished = () => BOOKS.filter((b) => b.status === 'done' && (!REAL || String(b.finishedOn ?? '').startsWith(String(new Date(clock.nowMs()).getFullYear())))).length;
export const prog = (b) => (b?.pages ? Math.min(1, (b.page ?? 0) / b.pages) : 0);

// ── derived: how today's time splits by kind, before and after the check-in ──
export const blockFor = (appId) => BLOCKS.find((b) => b.app === appId);
export function labelOf(appId, labelId) {
  const b = blockFor(appId); const hit = b?.labels.find((l) => l.id === labelId);
  if (hit) return hit;
  const a = app(appId); const cat = a?.cat ?? 'other';
  return (LABELS[cat] ?? LABELS.other).find((l) => l.id === labelId) ?? null;
}
export function kindsNow({ answered = S.checkin.done } = {}) {
  const k = { work: 0, learning: 0, social: 0, entertainment: 0 };
  for (const a of APPS) {
    const ans = answered && S.checkin.answers?.[a.id];
    const m = appMin(a);
    if (ans?.length) {
      let used = 0;
      ans.forEach(([lid, mm]) => { const lb = labelOf(a.id, lid); k[lb?.kind ?? a.kind] += mm; used += mm; });
      if (m > used) k[a.kind] += m - used;
    } else k[a.kind] += m;
  }
  for (const x of Object.keys(k)) k[x] = Math.round(k[x]);
  return k;
}
export function appFor(a) {
  const ans = S.checkin.done && S.checkin.answers?.[a.id];
  if (ans) return ans.map(([lid, m]) => `${labelOf(a.id, lid)?.name ?? lid} ${fmt(m)}`).join(' · ');
  const dev = a.source === 'pc' ? 'PC' : a.source === 'manual' ? 'you told Wyn' : a.source === 'both' ? 'PC and phone' : '';
  if (REAL && blockFor(a.id)) return `${a.sessions?.length ?? 0} visits${dev ? ` · ${dev}` : ''} · Wyn asks tonight`;
  if (!REAL && a.ask) return `${a.sessions.length} visits · Wyn asks tonight`;
  return `${kindName(a.kind)}${a.note ? ` · ${a.note}` : dev ? ` · ${dev}` : ''}`;
}
export const guessOf = (b) => b.guess.map(([id, m]) => [id, m]);

// ═════════════════════════ real data ═════════════════════════
const EP = (n) => ({ endpoint: `/api/v1/mod/mind/${n}` });
export const COL = REAL ? {
  books: collection('mind/books', EP('books')), sessions: collection('mind/sessions', EP('sessions')), highlights: collection('mind/highlights', EP('highlights')),
  courses: collection('mind/courses', EP('courses')), lessons: collection('mind/lessons', { ...EP('lessons'), interval: 300000 }), checkins: collection('mind/checkins', EP('checkins')),
  screen: collection('mind/screen', EP('screen')), apps: collection('mind/apps', EP('apps')),
} : null;

const subs = new Set();
/** fn(why) after the model changed (a refresh from the PC, a write, the day turning). */
export const onMind = (fn) => { subs.add(fn); return () => subs.delete(fn); };
let sig = '';
function changed(why) {
  const s = JSON.stringify([todayMin(), BLOCKS.length, S.checkin.done, S.readToday, S.learnBase, STREAK, BOOKS.map((b) => [b.id, b.page, b.status, b.sessions?.length, b.title]), NOTES.length, S.reviewed.size,
    COURSES.map((c) => [c.id, c.status, c.done, c.at]), WEEK.map((w) => w.total), MONTH.days.length, MD.loaded, APPS.length, Object.keys(USUAL).length]);
  if (s === sig && why !== 'force') return;
  sig = s;
  subs.forEach((f) => { try { f(why); } catch (e) { console.error('[mind]', e); } });
}

const dayKey = (d) => `aos-mind:day:${d}`;
const daysKey = 'aos-mind:days';
let dayData = null, daysData = null, loading = null;
/** Fetch the day and the last five weeks from the PC (kept on the phone for offline). */
export function load(force = false) {
  if (!REAL) return Promise.resolve();
  if (loading && !force) return loading;
  const d = today();
  dayData = dayData?.date === d ? dayData : API.ls.json(dayKey(d));
  daysData = daysData ?? API.ls.json(daysKey);
  derive();
  loading = (async () => {
    try {
      const [day, days] = await Promise.all([API.get(`/mod/mind/day?date=${d}`, { timeout: 15000 }), API.get(`/mod/mind/days?from=${firstShown(d)}&to=${d}`, { timeout: 15000 })]);
      dayData = day; daysData = days.days;
      API.ls.set(dayKey(d), JSON.stringify(day)); API.ls.set(daysKey, JSON.stringify(days.days));
      try { API.ls.del(dayKey(clock.addDays(d, -2))); } catch {}
      MD.offline = false; MD.error = null;
    } catch (e) { MD.offline = !e?.status; MD.error = e?.status ? e.message : null; }
    MD.loaded = true;
    derive();
    loading = null;
  })();
  return loading;
}
// the views need this month and the two weeks before today
const firstShown = (d) => { const p = clock.dparts(d); const m1 = `${p.year}-${String(p.month + 1).padStart(2, '0')}-01`; const w = clock.addDays(d, -13); return m1 < w ? m1 : w; };

const refill = (arr, items) => { arr.length = 0; arr.push(...items); };
const clear = (o) => { for (const k of Object.keys(o)) delete o[k]; };
const keep = new Map();   // id → view object, so pages that hold one stay current
const stable = (id, fresh) => { const o = keep.get(id); if (o) { for (const k of Object.keys(o)) if (!(k in fresh)) delete o[k]; Object.assign(o, fresh); return o; } keep.set(id, fresh); return fresh; };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const wdOf = (iso) => WD[clock.dparts(iso).dow];
const shortDay = (iso) => `${wdOf(iso)} ${clock.dparts(iso).day}`;
const minOfIso = (iso) => { const t = Date.parse(iso); if (!Number.isFinite(t)) return null; return Math.round(clock.toMin(iso, clock.dateOfIso(iso))); };

export function derive() {
  if (!REAL) return;
  const d = today();
  const nowY = clock.dparts(d).year;
  const ses = COL.sessions.list();
  const cis = COL.checkins.list();
  // ── year and goals ──
  const y0 = Date.parse(`${nowY}-01-01T00:00:00Z`), y1 = Date.parse(`${nowY + 1}-01-01T00:00:00Z`), tNow = Date.parse(`${d}T12:00:00Z`);
  YEAR_GONE = (tNow - y0) / (y1 - y0); DAYS_LEFT = Math.round((y1 - tNow) / 864e5);
  const g = GOALS.find((x) => /\bbooks?\b|\bread(ing)?\b/i.test(x.title ?? '') && x.status !== 'dropped');
  READ_GOAL_ID.id = g?.id ?? null;
  const gn = g && /(\d+)\s*books?/i.exec(g.title); if (gn) YEAR_GOAL = Number(gn[1]);
  // ── the day: the PC's apps, his entries waiting on the phone, the usual day ──
  const day = dayData?.date === d ? dayData : null;
  const over = new Map(COL.apps.list().map((x) => [x.id, x]));
  const apps = (day?.apps ?? []).map((a) => ({ ...a, hours: { ...a.hours }, sessions: [...(a.sessions ?? [])] }));
  const counted = new Set(day?.manualIds ?? []);
  for (const r of COL.screen.list()) {
    if (r.date !== d || r.source === 'pc' || counted.has(r.id)) continue;
    let a = apps.find((x) => x.id === r.app);
    if (!a) { a = { ...phoneApp(r.app), minutes: 0, hours: {}, sessions: [], source: 'manual', titles: [] }; apps.push(a); }
    const h = Number.isFinite(r.hour) ? r.hour : Math.floor(nowMin() / 60);
    a.hours[h] = (a.hours[h] ?? 0) + Number(r.minutes || 0); a.minutes += Number(r.minutes || 0);
    a.sessions.push([h * 60, Math.max(1, Math.round(r.minutes || 0))]);
    if (a.source === 'pc') a.source = 'both';
  }
  for (const a of apps) { const o = over.get(a.id); if (o?.kind) a.kind = o.kind; if (typeof o?.ask === 'boolean') a.ask = o.ask; a.hours = Object.fromEntries(Object.entries(a.hours).map(([k, v]) => [Number(k), v])); }
  apps.sort((x, y) => appMin(y) - appMin(x));
  refill(APPS, apps.filter((a) => appMin(a) >= 1));
  clear(USUAL); Object.assign(USUAL, Object.fromEntries(Object.entries(day?.usual?.hours ?? {}).map(([k, v]) => [Number(k), v])));
  MD.usualDays = day?.usual?.days ?? 0; MD.usualBasis = day?.usual?.basis ?? 'weekday';
  MD.sources = day?.sources ?? MD.sources; MD.day = day; MD.weekday = clock.label(d).weekday;
  clear(USUAL_APP); Object.assign(USUAL_APP, day?.usualApp ?? {});
  const firsts = APPS.flatMap((a) => (a.sessions ?? []).map((s) => [s[0], a.name])).sort((a, b) => a[0] - b[0]);
  PICKUPS.n = null; PICKUPS.first = firsts[0]?.[0] ?? null; PICKUPS.firstApp = firsts[0]?.[1] ?? '';
  // ── tonight's blocks (the server's, with Wyn's guesses); answered from the phone's copy of the check-in ──
  const ci = COL.checkins.get(`ci.${d}`) ?? (COL.checkins.docs?.get(`ci.${d}`)?.deleted_at || day?.checkin?.deleted_at ? null : day?.checkin) ?? null;
  const blocks = (day?.blocks ?? []).filter((b) => app(b.app) && app(b.app).ask !== false);
  // an entry he made on the phone can add a block the PC hasn't seen yet
  for (const a of APPS) if (a.ask && appMin(a) >= 10 && blocks.length < 3 && !blocks.some((b) => b.app === a.id) && a.source !== 'pc') {
    const labels = LABELS[a.cat] ?? LABELS.other;
    blocks.push({ app: a.id, name: a.name, min: Math.round(appMin(a)), when: 'From what you told me', why: 'You logged this one yourself, so only you know what it was for.', by: 'rules', labels, guess: [[labels[0].id, Math.round(appMin(a))]] });
  }
  refill(BLOCKS, blocks.map((b) => {
    const a = app(b.app); const min = Math.round(appMin(a) || b.min);
    let guess = (b.guess ?? []).filter(([, m]) => m > 0);
    const gs = guess.reduce((s, [, m]) => s + m, 0);
    if (gs !== min && guess.length) { const k = min / Math.max(1, gs); let left = min; guess = guess.map(([l, m], i) => { const v = i === guess.length - 1 ? left : Math.max(1, Math.round(m * k)); left -= v; return [l, v]; }); }
    if (!guess.length) guess = [[b.labels[0].id, min]];
    return { ...b, min, guess, labels: b.labels.map((l) => ({ ...l })) };
  }));
  S.checkin = ci?.at ? { done: true, answers: ci.answers ?? {}, at: minOfIso(ci.at) ?? nowMin(), before: ci.before ?? null, source: ci.source } : { done: false, answers: null };
  const answeredDates = new Set(cis.filter((x) => x.at).map((x) => x.date));
  let n = 0, dd = answeredDates.has(d) ? d : clock.addDays(d, -1);
  while (answeredDates.has(dd)) { n++; dd = clock.addDays(dd, -1); }
  STREAK = answeredDates.has(d) ? n - 1 : n;   // the screens add tonight's one themselves once it's answered
  // ── the week and the month ──
  const byDate = new Map((daysData ?? []).map((x) => [x.date, x]));
  const learnedOn = (iso) => cis.filter((x) => x.date === iso && x.at).reduce((s, x) => s + (Number(x.learned) || 0), 0);
  refill(WEEK, Array.from({ length: 7 }, (_, i) => {
    const iso = clock.addDays(d, i - 6); const x = byDate.get(iso);
    return iso === d ? { d: wdOf(iso), date: clock.dparts(iso).day, iso, total: 0, done: S.checkin.done, today: true }
      : { d: wdOf(iso), date: clock.dparts(iso).day, iso, total: x?.total ?? 0, done: answeredDates.has(iso) || !!x?.answered, kinds: x?.kinds ?? { work: 0, learning: 0, social: 0, entertainment: 0 } };
  }));
  const prev = Array.from({ length: 7 }, (_, i) => byDate.get(clock.addDays(d, i - 13))).filter((x) => x?.total);
  LAST_WEEK_AVG = prev.length ? Math.round(prev.reduce((s, x) => s + x.total, 0) / prev.length) : 0;
  const p = clock.dparts(d);
  MONTH.year = p.year; MONTH.month = p.month; MONTH.today = p.day; MONTH.name = clock.MONTHS[p.month];
  MONTH.first = (new Date(Date.UTC(p.year, p.month, 1)).getUTCDay() + 6) % 7;
  MONTH.len = new Date(Date.UTC(p.year, p.month + 1, 0)).getUTCDate();
  refill(MONTH.days, Array.from({ length: p.day }, (_, i) => { const iso = `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`; return iso === d ? todayMin() : (byDate.get(iso)?.total ?? 0); }));
  MONTH.answered = new Set([...answeredDates].filter((x) => x.startsWith(`${p.year}-${String(p.month + 1).padStart(2, '0')}`)).map((x) => Number(x.slice(8))));
  MONTH.known = new Set((daysData ?? []).filter((x) => x.total > 0).map((x) => x.date));
  // what each app was for this week, from the check-ins' answers (share of the answered minutes)
  clear(FOR_WEEK);
  const agg = {};
  for (const x of cis) {
    if (!x.at || x.date < clock.addDays(d, -6)) continue;
    for (const [aid, list] of Object.entries(x.answers ?? {})) {
      const names = Object.fromEntries((x.blocks?.find((b) => b.app === aid)?.labels ?? LABELS[phoneApp(aid).cat] ?? LABELS.other).map((l) => [l.id, l.name]));
      for (const [lid, m] of list) { const nm = names[lid] ?? lid; (agg[aid] ??= {}); agg[aid][nm] = (agg[aid][nm] ?? 0) + m; }
    }
  }
  for (const [aid, o] of Object.entries(agg)) { const tot = Object.values(o).reduce((s, v) => s + v, 0) || 1; FOR_WEEK[aid] = Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nm, m]) => [nm, Math.round((m / tot) * 100)]); }
  // ── took in, made ──
  const todaySes = ses.filter((x) => x.date === d);
  const k = kindsNow();
  const readM = todaySes.filter((x) => x.kind === 'reading').reduce((s, x) => s + Number(x.minutes || 0), 0);
  const learnM = todaySes.filter((x) => x.kind !== 'reading').reduce((s, x) => s + Number(x.minutes || 0), 0);
  const fun = APPS.filter((a) => a.kind === 'entertainment' || a.kind === 'social').slice(0, 2).map((a) => a.name);
  refill(INPUTS, [
    readM ? { name: 'Reading', detail: [...new Set(todaySes.filter((x) => x.kind === 'reading').map((x) => COL.books.get(x.book)?.title).filter(Boolean))].join(', '), min: readM } : null,
    learnM ? { name: 'Learning', detail: [...new Set(todaySes.filter((x) => x.kind !== 'reading').map((x) => x.title).filter(Boolean))].slice(0, 2).join(', ') || 'Lessons and videos', min: learnM } : null,
    k.entertainment + k.social ? { name: 'Feeds and chats', detail: fun.join(' and ') || 'Screen time', min: k.entertainment + k.social } : null,
    k.learning ? { name: 'Learning on screen', detail: APPS.filter((a) => a.kind === 'learning').map((a) => a.name).slice(0, 2).join(', '), min: k.learning } : null,
  ].filter(Boolean));
  const doneToday = TASKS.filter((t) => t.doneToday);
  refill(OUTPUTS, [
    k.work ? { name: 'Work on screen', detail: APPS.filter((a) => a.kind === 'work').slice(0, 2).map((a) => a.name).join(' and '), min: k.work } : null,
    ...doneToday.filter((t) => t.len || t.estimateMinutes).slice(0, 2).map((t) => ({ name: t.title, detail: 'Task done', min: Number(t.len || t.estimateMinutes) })),
  ].filter(Boolean));
  refill(OUTPUT_ITEMS, doneToday.length ? [`${doneToday.length} task${doneToday.length === 1 ? '' : 's'} done today`] : []);
  // ── books ──
  const sesBy = new Map();
  for (const x of ses) if (x.kind === 'reading' && x.book) (sesBy.get(x.book) ?? sesBy.set(x.book, []).get(x.book)).push(x);
  refill(BOOKS, COL.books.list().sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map((b, i) => {
    const list = (sesBy.get(b.id) ?? []).sort((x, y) => String(y.at ?? y.date).localeCompare(String(x.at ?? x.date)));
    const fin = b.finished ?? null;
    return stable(b.id, {
      id: b.id, title: b.title, author: b.author || 'Author unknown', pages: Number(b.pages) || null, page: Number(b.page) || 0, status: b.status ?? 'next', tone: b.tone ?? ((i % 6) + 1),
      why: b.why ?? null, isbn: b.isbn ?? null, cover: b.cover ?? null, started: b.started ? shortDay(b.started) : null, last: b.last ? shortDay(b.last) : null,
      done: fin ? MON[clock.dparts(fin).month] : null, finishedOn: fin, next: b.why ?? null,
      sessions: list.map((x) => [x.date === d ? 'Today' : shortDay(x.date), Math.round(Number(x.minutes) || 0), Number(x.from_page) || 0, Number(x.to_page) || 0, x.id]),
    });
  }));
  S.readToday = Math.round(readM);
  refill(READ_WEEK, Array.from({ length: 7 }, (_, i) => { const iso = clock.addDays(d, i - 6); return [wdOf(iso), Math.round(ses.filter((x) => x.kind === 'reading' && x.date === iso).reduce((s, x) => s + Number(x.minutes || 0), 0))]; }));
  // ── highlights ──
  refill(NOTES, COL.highlights.list().filter((h) => book(h.book) || !h.book).sort((a, b) => String(a.reviewed_at ?? '').localeCompare(String(b.reviewed_at ?? '')))
    .map((h) => ({ id: h.id, book: h.book, page: h.page ?? null, kind: h.kind ?? 'highlight', text: h.text, mine: h.mine ?? null, reviewed_at: h.reviewed_at ?? null })));
  S.reviewed = new Set(NOTES.filter((x) => x.reviewed_at && clock.dateOfIso(x.reviewed_at) === d).map((x) => x.id));
  // ── courses and lessons ──
  const ls = new Map();
  for (const l of COL.lessons.list()) (ls.get(l.course) ?? ls.set(l.course, []).get(l.course)).push(l);
  const cs = COL.courses.list().sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || (a.position ?? 0) - (b.position ?? 0)).map((c) => {
    const list = (ls.get(c.id) ?? []).sort((a, b) => a.n - b.n);
    const ldone = list.map((l) => l.status === 'done');
    const cur = Math.max(0, ldone.indexOf(false) === -1 ? list.length - 1 : ldone.indexOf(false));
    const curL = list[cur];
    return stable(c.id, {
      id: c.id, title: c.title, from: c.from ?? 'Skool', part: c.part ?? '', status: list.length && ldone.every(Boolean) ? 'done' : c.status ?? 'parked', kind: c.kind ?? 'course', url: c.url ?? null,
      done: ldone.filter(Boolean).length, cur, at: curL?.pos > 0 ? mmss(curL.pos) : null, practice: curL?.practice ?? c.practice ?? null,
      lessons: list.map((l) => [l.title, l.duration || '', l.why || l.watch || null]), lid: list.map((l) => l.id), ldone, urls: list.map((l) => l.url ?? null),
      notes: list.map((l) => l.notes ?? []), statusAt: c.status_at ?? c.updated_at,
    });
  });
  refill(COURSES, cs.filter((c) => c.kind !== 'library' && c.lessons.length));
  refill(LIBRARY, cs.filter((c) => c.kind === 'library' && c.lessons.length));
  // learning this week (since Monday): lessons and logged learning, plus the check-ins' learning answers
  const mon = clock.addDays(d, -((clock.dparts(d).dow + 6) % 7));
  S.learnBase = Math.round(ses.filter((x) => x.kind !== 'reading' && x.date >= mon && x.date !== d).reduce((s, x) => s + Number(x.minutes || 0), 0)
    + cis.filter((x) => x.at && x.date >= mon && x.date !== d).reduce((s, x) => s + (Number(x.learned) || 0), 0) + learnM);
  S.learnExtra = S.checkin.done ? learnedOn(d) : 0;
  refill(LEARN_WEEK, Array.from({ length: 7 }, (_, i) => { const iso = clock.addDays(d, i - 6); return [wdOf(iso), Math.round(ses.filter((x) => x.kind !== 'reading' && x.date === iso).reduce((s, x) => s + Number(x.minutes || 0), 0) + learnedOn(iso))]; }));
  changed('derive');
}

// ═════════════════════════ writes (real mode; demo changes the view only) ═════════════════════════
const tiny = () => REAL && COL;
export function saveSession(f) {
  if (!tiny()) return null;
  return COL.sessions.add({ kind: f.kind ?? 'reading', date: f.date ?? today(), at: new Date(clock.nowMs()).toISOString(), minutes: Math.max(1, Math.round(f.minutes || 0)), book: f.book ?? null,
    from_page: f.from_page ?? null, to_page: f.to_page ?? null, course: f.course ?? null, lesson: f.lesson ?? null, title: f.title ?? null, source: 'app', note: f.note ?? null });
}
export function removeSession(id) { if (tiny() && id) COL.sessions.remove(id); }
export function saveBook(id, patch) { if (!tiny()) return null; const cur = COL.books.get(id); return cur ? COL.books.update(id, patch) : null; }
export function addBook(f) {
  if (!tiny()) return null;
  const dup = COL.books.list().find((b) => (f.isbn && b.isbn === f.isbn) || String(b.title).toLowerCase() === String(f.title).toLowerCase());
  if (dup) return { doc: dup, already: true };
  return { doc: COL.books.add({ title: f.title, author: f.author ?? null, pages: f.pages ?? null, page: 0, isbn: f.isbn ?? null, cover: f.cover ?? null, status: f.status ?? 'next', why: f.why ?? null, tone: (COL.books.list().length % 6) + 1 }), already: false };
}
/** A reading session from the timer, the sheet, a scan or the agent: the session, the book's page and status. */
export function persistReading(b, { minutes, from, to }) {
  if (!tiny()) return null;
  const s = saveSession({ kind: 'reading', book: b.id, minutes, from_page: from, to_page: to });
  const done = b.pages && to >= b.pages;
  saveBook(b.id, { page: to, status: done ? 'done' : 'reading', last: today(), started: COL.books.get(b.id)?.started ?? today(), ...(done ? { finished: today() } : {}) });
  return s;
}
export function saveHighlight(f) { if (!tiny()) return null; return COL.highlights.add({ book: f.book ?? null, page: f.page ?? null, kind: f.kind ?? 'highlight', text: f.text, mine: f.mine ?? null, reviewed_at: null }); }
export function markReviewed(id, v) { if (tiny() && COL.highlights.get(id)) COL.highlights.update(id, { reviewed_at: new Date(clock.nowMs()).toISOString(), review: v }); }
export function saveLesson(cid, i, patch) {
  if (!tiny()) return null;
  const c = course(cid); const id = c?.lid?.[i];
  return id && COL.lessons.get(id) ? COL.lessons.update(id, patch) : null;
}
export function saveCourse(id, patch) { if (tiny() && COL.courses.get(id)) COL.courses.update(id, { ...patch, status_at: new Date(clock.nowMs()).toISOString() }); }
/** File tonight's check-in: the answers, what the day was before them, and what each block could have been. */
export function saveCheckin(answers, before) {
  if (!tiny()) return null;
  const d = today(); const id = `ci.${d}`;
  const cur = COL.checkins.get(id) ?? MD.day?.checkin ?? {};
  const learned = Object.entries(answers).reduce((s, [aid, list]) => s + list.filter(([l]) => labelOf(aid, l)?.kind === 'learning').reduce((x, a) => x + a[1], 0), 0);
  return COL.checkins.put({ ...cur, id, date: d, answers, before, at: new Date(clock.nowMs()).toISOString(), source: 'app', learned,
    blocks: BLOCKS.map((b) => ({ app: b.app, name: b.name, min: b.min, labels: b.labels.map((l) => ({ id: l.id, name: l.name, kind: l.kind, aspect: l.aspect })) })), kinds: kindsNow({ answered: true }) });
}
export function saveAppRule(appId, patch) { if (!tiny()) return null; const cur = COL.apps.get(appId); return COL.apps.put({ ...(cur ?? { id: appId }), id: appId, ...patch }); }
export function saveScreen({ app: id, minutes, hour = null }) {
  if (!tiny()) return null;
  return COL.screen.add({ date: today(), hour: hour ?? Math.floor(nowMin() / 60), app: id, minutes: Math.round(minutes), source: 'manual', device: 'phone' });
}

// ═════════════════════════ demo: the prototype's sample ═════════════════════════
if (!REAL) {
  refill(APPS, DEMO.APPS); Object.assign(USUAL, DEMO.USUAL); Object.assign(USUAL_APP, DEMO.USUAL_APP); Object.assign(WEEK_APP, DEMO.WEEK_APP);
  Object.assign(PICKUPS, DEMO.PICKUPS); NOTIFS = DEMO.NOTIFS; CHECKIN_AT = DEMO.CHECKIN_AT;
  refill(BLOCKS, DEMO.BLOCKS); STREAK = DEMO.STREAK; refill(WEEK, DEMO.WEEK); LAST_WEEK_AVG = DEMO.LAST_WEEK_AVG; Object.assign(FOR_WEEK, DEMO.FOR_WEEK);
  MONTH.days.push(...DEMO.OCT.slice(0, 22)); MONTH.answered = new Set(Array.from({ length: 31 }, (_, i) => i + 1).filter(DEMO.OCT_CHECKED)); MONTH.len = 31; MONTH.known = null;
  refill(FOCUS, DEMO.FOCUS); refill(INPUTS, DEMO.INPUTS); refill(OUTPUTS, DEMO.OUTPUTS); refill(OUTPUT_ITEMS, DEMO.OUTPUT_ITEMS);
  refill(BOOKS, DEMO.BOOKS.map((b) => ({ ...b, finishedOn: b.status === 'done' ? '2026' : null }))); YEAR_GOAL = DEMO.YEAR_GOAL; DAYS_LEFT = DEMO.DAYS_LEFT; YEAR_GONE = DEMO.YEAR_GONE; READ_GOAL = DEMO.READ_GOAL;
  refill(READ_WEEK, DEMO.READ_WEEK); refill(NOTES, DEMO.NOTES); READ_GOAL_ID.id = 'g7';
  refill(COURSES, DEMO.COURSES.map((c) => ({ ...c, cur: c.done, ldone: c.lessons.map((_, i) => i < c.done), lid: c.lessons.map((_, i) => `${c.id}:${i}`), urls: [] })));
  refill(COLLEGE, DEMO.COLLEGE); LEARN_GOAL = DEMO.LEARN_GOAL; refill(LEARN_WEEK, DEMO.LEARN_WEEK);
  MD.weekday = 'Thursday'; MD.sources = { pc: false, screenTime: true, manual: false }; MD.usualDays = 4;
} else {
  for (const c of Object.values(COL)) c.on('change', () => derive());
  G.document?.addEventListener('data-changed', (e) => { if (['boot', 'server', 'day', 'local'].includes(e.detail?.why)) { if (e.detail?.why === 'day') load(true); else derive(); } });
  G.document?.addEventListener('visibilitychange', () => { if (G.document.visibilityState === 'visible' && S.app?.page?.isConnected) load(); });
  clock.onDay?.(() => { dayData = null; load(true); });
  G.setInterval?.(() => { if (G.document?.visibilityState === 'visible' && S.app?.page?.isConnected) load(); }, 5 * 60000);
  Promise.all(Object.values(COL).map((c) => c.ready)).then(() => derive());
  load();
}

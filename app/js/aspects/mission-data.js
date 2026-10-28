// Mission's model: the horizons from the real clock, and what goals don't carry themselves (milestones, check-ins,
// horizon notes, the purpose and its versions, the lifetime directions) from svc/store collections on
// /api/v1/mod/mission/*, plus the mission graph from /api/v1/mod/mission/graph (cached for offline). Goals themselves are
// core (GOALS in js/data.js, written with addGoal/updateGoal through svc/sync). Demo mode (?data=demo) serves the
// prototype's sample (mission-demo.js) through the same shapes, in memory. Owner: the Mission agent.
import { DEMO_MODE } from '../data.js';
import * as clock from '../svc/clock.js';
import * as API from '../svc/api.js';
import { collection } from '../svc/store.js';
import * as D from './mission-demo.js';

export const DEMO = DEMO_MODE;
export const RANK = { week: 0, month: 1, quarter: 2, year: 3, later: 4, life: 5 };
/** The prototype's horizon ids → agentos's (later is a decade there). */
export const CORE_H = { week: 'week', month: 'month', quarter: 'quarter', year: 'year', later: 'decade', life: 'life' };
const subs = new Set();
/** fn(why) when any of Mission's own data changes: a collection, the graph, the day. */
export const onModel = (fn) => { subs.add(fn); return () => subs.delete(fn); };
let fireT = 0;
const fire = (why) => { clearTimeout(fireT); fireT = setTimeout(() => subs.forEach((f) => { try { f(why); } catch (e) { console.warn('[mission]', e); } }), 30); };

// ── periods (IST calendar days; weeks start Monday; the same keys as agentos goals.ts) ──
const pad = (n) => String(n).padStart(2, '0');
const MON = clock.MONTHS.map((m) => m.slice(0, 3));
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const dd = (iso) => { const p = clock.dparts(iso); return `${p.day} ${MON[p.month]}`; };
const wdd = (iso) => { const p = clock.dparts(iso); return `${WD[p.dow]} ${p.day} ${MON[p.month]}`; };
const range = (a, b) => { const x = clock.dparts(a), y = clock.dparts(b); return x.month === y.month ? `${x.day}–${y.day} ${MON[x.month]}` : `${dd(a)} – ${dd(b)}`; };
function isoWeekKey(monday) {
  const thu = new Date(`${clock.addDays(monday, 3)}T00:00:00Z`);
  const y = thu.getUTCFullYear();
  return `${y}-W${pad(1 + Math.floor((thu - Date.UTC(y, 0, 1)) / (7 * 864e5)))}`;
}
/** The period key agentos uses for a horizon on a day: 2026-W43, 2026-10, 2026-Q4, 2026, 2020s, life. */
export function periodKey(h, iso = clock.today()) {
  const p = clock.dparts(iso), c = CORE_H[h] ?? h;
  if (c === 'week' || c === 'day') return isoWeekKey(clock.addDays(iso, -((p.dow + 6) % 7)));
  if (c === 'month') return `${p.year}-${pad(p.month + 1)}`;
  if (c === 'quarter') return `${p.year}-Q${Math.floor(p.month / 3) + 1}`;
  if (c === 'year') return String(p.year);
  if (c === 'decade') return `${Math.floor(p.year / 10) * 10}s`;
  return 'life';
}
const left = (today, end) => { const n = clock.daysBetween(today, end); return n <= 0 ? 'Last day' : `${n + 1} days left`; };

/** The six horizons for today: name, range, time gone (0–1), the stripe's cells, last and next period. */
function buildHZ(today = clock.today()) {
  const p = clock.dparts(today), frac = Math.min(1, Math.max(0, clock.minutes() / 1440));
  const dow = (p.dow + 6) % 7, ws = clock.addDays(today, -dow), we = clock.addDays(ws, 6);
  const nm = dim(p.year, p.month), ms = `${p.year}-${pad(p.month + 1)}-01`, me = `${p.year}-${pad(p.month + 1)}-${pad(nm)}`;
  const q = Math.floor(p.month / 3), qm = [q * 3, q * 3 + 1, q * 3 + 2];
  const qs = `${p.year}-${pad(qm[0] + 1)}-01`, qe = `${p.year}-${pad(qm[2] + 1)}-${pad(dim(p.year, qm[2]))}`;
  const qdays = clock.daysBetween(qs, qe) + 1, qgone = clock.daysBetween(qs, today) + frac;
  const ylen = clock.daysBetween(`${p.year}-01-01`, `${p.year}-12-31`) + 1, ygone = clock.daysBetween(`${p.year}-01-01`, today) + frac;
  const dec = Math.floor(p.year / 10) * 10, dEnd = dec + 9;
  const years = Array.from({ length: dEnd - p.year + 1 }, (_, i) => p.year + i);
  const pm = (p.month + 11) % 12, nx = (p.month + 1) % 12, pmy = p.month ? p.year : p.year - 1, nmy = p.month === 11 ? p.year + 1 : p.year;
  const qn = (i) => `${MON[i * 3]} – ${MON[i * 3 + 2]}`;
  const wcells = Array.from({ length: 7 }, (_, i) => (i < dow ? 1 : i === dow ? frac : 0));
  return [
    { id: 'week', name: 'This week', short: 'Week', of: 'the week', lower: 'this week', range: range(ws, we), left: left(today, we), due: wdd(we).replace(/ \w+$/, ''), time: (dow + frac) / 7,
      cells: wcells, labels: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], days: Array.from({ length: 7 }, (_, i) => clock.addDays(ws, i)), now: dow, gap: 4, start: ws, end: we, key: periodKey('week', today),
      prev: 'Last week', next: 'Next week', prevRange: range(clock.addDays(ws, -7), clock.addDays(ws, -1)), nextRange: range(clock.addDays(ws, 7), clock.addDays(ws, 13)) },
    { id: 'month', name: clock.MONTHS[p.month], short: 'Month', of: clock.MONTHS[p.month], lower: clock.MONTHS[p.month], range: `1–${nm} ${MON[p.month]}`, left: left(today, me), due: wdd(me).replace(/ \w+$/, ''), time: (p.day - 1 + frac) / nm,
      cells: Array.from({ length: nm }, (_, i) => (i < p.day - 1 ? 1 : i === p.day - 1 ? frac : 0)), labels: Object.fromEntries([0, 7, 14, 21, 28].filter((i) => i < nm).map((i) => [i, String(i + 1)])), now: p.day - 1, gap: 2,
      start: ms, end: me, key: periodKey('month', today),
      prev: clock.MONTHS[pm], next: clock.MONTHS[nx], prevRange: `1–${dim(pmy, pm)} ${MON[pm]}`, nextRange: `1–${dim(nmy, nx)} ${MON[nx]}` },
    { id: 'quarter', name: 'This quarter', short: 'Quarter', of: 'the quarter', lower: 'this quarter', range: qn(q), left: left(today, qe), due: wdd(qe).replace(/ \w+$/, ''), time: qgone / qdays,
      cells: qm.map((m) => (m < p.month ? 1 : m === p.month ? (p.day - 1 + frac) / nm : 0)), labels: qm.map((m) => MON[m]), now: p.month - qm[0], gap: 4, start: qs, end: qe, key: periodKey('quarter', today),
      prev: qn((q + 3) % 4), next: qn((q + 1) % 4), prevRange: `Q${((q + 3) % 4) + 1} ${q ? p.year : p.year - 1}`, nextRange: `Q${((q + 1) % 4) + 1} ${q === 3 ? p.year + 1 : p.year}` },
    { id: 'year', name: String(p.year), short: 'Year', of: 'the year', lower: String(p.year), range: 'Jan – Dec', left: left(today, `${p.year}-12-31`), due: wdd(`${p.year}-12-31`).replace(/ \w+$/, ''), time: ygone / ylen,
      cells: Array.from({ length: 12 }, (_, m) => (m < p.month ? 1 : m === p.month ? (p.day - 1 + frac) / nm : 0)), labels: MON.map((m) => m[0]), now: p.month, gap: 3,
      start: `${p.year}-01-01`, end: `${p.year}-12-31`, key: periodKey('year', today), prev: String(p.year - 1), next: String(p.year + 1), prevRange: `Jan – Dec ${p.year - 1}`, nextRange: `Jan – Dec ${p.year + 1}` },
    { id: 'later', name: 'Years out', short: 'Years', of: `the ${dec}s`, lower: 'the years out', range: years.length > 1 ? `${p.year} – ${dEnd}` : String(dEnd), left: `Through ${dEnd}`, due: `31 Dec ${dEnd}`,
      time: (p.year - dec + ygone / ylen) / 10, cells: years.map((y) => (y < p.year ? 1 : y === p.year ? ygone / ylen : 0)), labels: years.map(String), now: 0, gap: 4,
      start: `${dec}-01-01`, end: `${dEnd}-12-31`, key: periodKey('later', today) },
    { id: 'life', name: 'Lifetime', short: 'Life', of: 'a lifetime', lower: 'a lifetime', range: 'Every year after', left: '', due: '', time: null, key: 'life' },
  ];
}
export const HZ = DEMO ? D.HZ.map((h) => ({ ...h, days: h.id === 'week' ? Array.from({ length: 7 }, (_, i) => `2026-10-${19 + i}`) : undefined, key: h.id })) : buildHZ();
export const hz = (id) => HZ.find((h) => h.id === id) ?? HZ[0];
/** Recompute the horizons (a new minute moves the ticks; a new day moves everything). */
export function rebuildHorizons() { if (DEMO) return; HZ.splice(0, HZ.length, ...buildHZ()); }

// ── Mission's collections (lazy: svc/store is told about demo mode at boot, after this file loads) ──
class Memory {   // demo mode: the same API, in memory, never synced
  constructor(docs = []) { this.docs = new Map(docs.map((d) => [d.id, { created_at: '', updated_at: '', deleted_at: null, ...d }])); this.subs = new Set(); this.ready = Promise.resolve(this); }
  list() { return [...this.docs.values()].filter((d) => !d.deleted_at); }
  get(id) { return this.docs.get(id) ?? null; }
  add(doc) { const now = clock.now().toISOString(); const d = { id: `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, created_at: now, updated_at: now, deleted_at: null, ...doc }; this.docs.set(d.id, d); this.emit(); return d; }
  update(id, patch) { const d = this.docs.get(id); if (!d) return null; Object.assign(d, patch, { updated_at: clock.now().toISOString() }); this.emit(); return d; }
  put(doc) { this.docs.set(doc.id, { ...(this.docs.get(doc.id) ?? {}), ...doc }); this.emit(); return this.docs.get(doc.id); }
  remove(id) { return this.update(id, { deleted_at: clock.now().toISOString() }); }
  on(ev, fn) { if (ev === 'change') this.subs.add(fn); return () => this.subs.delete(fn); }
  emit() { this.subs.forEach((f) => f({ why: 'local' })); }
  refresh() { return Promise.resolve(); }
  pending() { return 0; }
}
const NAMES = ['purpose', 'milestones', 'checkins', 'notes', 'life'];
const C = {};
function demoDocs(name) {
  if (name === 'purpose') return D.PURPOSE.versions.map(([when, text, why], i) => ({ id: `pv${i}`, text, why, label: when, values: i ? [] : D.PURPOSE.values, created_at: `2026-${i ? '07-06' : '10-12'}T10:00:00Z` }));
  if (name === 'milestones') return Object.entries(D.X).flatMap(([g, x]) => (x.ms ?? []).map(([title, done, when], i) => ({ id: `${g}-m${i}`, goal: g, title, done, label: when, position: i })));
  if (name === 'checkins') return Object.entries(D.X).flatMap(([g, x]) => (x.checks ?? []).map(([at, by, state, note], i) => ({ id: `${g}-c${i}`, goal: g, state, note, by: by === 'You' ? 'me' : 'agent', label: at, at: `2026-10-${pad(21 - i)}T12:00:00Z` })));
  if (name === 'notes') return [{ id: 'week:week', horizon: 'week', period: 'week', body: 'Two sales calls before Thursday. Shoot reels in one sitting.' }];
  if (name === 'life') return D.DIRECTIONS.map((d, i) => ({ id: d.id, title: d.title, fam: d.fam, aspects: d.aspects, position: i }));
  return [];
}
export function col(name) {
  if (C[name]) return C[name];
  C[name] = DEMO ? new Memory(demoDocs(name)) : collection(`mission/${name}`, { endpoint: `/api/v1/mod/mission/${name}` });
  C[name].on('change', () => fire(name));
  return C[name];
}
/** Open every collection (call once the engine has booted). */
export function start() {
  NAMES.forEach(col);
  if (!DEMO) {
    clock.onDay(() => { rebuildHorizons(); loadGraph(); fire('day'); });
    clock.onMinute(() => { rebuildHorizons(); });
  }
}

// ── reads over the collections ──
const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0) || String(a.created_at).localeCompare(String(b.created_at));
export const milestonesOf = (goal) => col('milestones').list().filter((m) => m.goal === goal).sort(byPos);
export const checkinsOf = (goal) => col('checkins').list().filter((c) => c.goal === goal).sort((a, b) => String(b.at ?? b.created_at).localeCompare(String(a.at ?? a.created_at)));
export const directions = () => col('life').list().sort(byPos);
export function noteOf(h) { const k = DEMO ? h : `${CORE_H[h] ?? h}:${hz(h).key}`; return col('notes').get(k) ?? col('notes').list().find((n) => n.id === k) ?? null; }
export function setNote(h, body) {
  const id = DEMO ? h : `${CORE_H[h] ?? h}:${hz(h).key}`;
  const cur = noteOf(h);
  if (cur) return col('notes').update(cur.id, { body });
  return col('notes').put({ id, horizon: CORE_H[h] ?? h, period: hz(h).key, body, created_at: clock.now().toISOString(), updated_at: clock.now().toISOString(), deleted_at: null });
}
export function purpose() {
  const vs = col('purpose').list().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  return { current: vs[0] ?? null, versions: vs };
}
/** When a doc was written, as he'd say it: 'Today', 'Mon 19', '6 Jul'. */
export function whenOf(iso) {
  if (!iso) return '';
  const d = clock.dateOfIso(iso), t = clock.today();
  if (Math.abs(clock.daysBetween(d, t)) < 7) return clock.dayLabel(d);
  return dd(d);
}
export const timeOfDoc = (iso) => (iso ? clock.hm(clock.toMin(iso, clock.dateOfIso(iso))) : '');
/** A milestone's side line: its own label in demo, else done date, late, or due. */
export function msWhen(m) {
  if (m.label != null) return m.label;
  if (m.done) return m.done_at ? `Done ${whenOf(m.done_at)}` : '';
  if (!m.due) return '';
  const n = clock.daysBetween(clock.today(), m.due);
  return n < 0 ? `${-n} day${n === -1 ? '' : 's'} late` : n === 0 ? 'Due today' : `Due ${clock.dayLabel(m.due)}`;
}

// ── the mission graph (the PC computes it from the goals table and the daily history) ──
const GKEY = 'aos-mission:graph';
export let GRAPH = DEMO ? demoGraph() : (() => { try { return JSON.parse(API.ls.get(GKEY) ?? 'null'); } catch { return null; } })();
export let GRAPH_AT = null;
function demoGraph() {
  return {
    since: '2026-07-06', demo: true,
    weeks: D.WEEKS.map(([label, month], i) => ({ label, month, set: D.BURN.set[i], done: D.BURN.done[i], hit: D.WEEK_HIT[i] })),
    totals: D.TOTALS, streak: 3, history: {},
    months: D.MONTH_HIT.map(([label, hit, total, now]) => ({ label, hit, total, now: !!now })),
    quarters: D.QUARTER_HIT.map(([label, hit, total, now]) => ({ label, hit, total, now: !!now })),
    closed: D.CLOSED,
  };
}
let loading = null;
export function loadGraph() {
  if (DEMO || loading) return loading ?? Promise.resolve(GRAPH);
  loading = API.get('/mod/mission/graph', { timeout: 15000 }).then((g) => {
    GRAPH = g; GRAPH_AT = Date.now();
    API.ls.set(GKEY, JSON.stringify(g));
    fire('graph');
    return g;
  }).catch(() => GRAPH).finally(() => { loading = null; });
  return loading;
}

// ── Add a goal: the agent drafts it on the PC (Claude on the subscription); offline, the phone drafts it ──
export async function draft(text, hints = {}) {
  if (DEMO) throw new Error('demo');
  return API.post('/mod/mission/draft', { kind: 'goal', text, horizon: hints.horizon ? CORE_H[hints.horizon] : undefined, aspects: hints.aspects, parent: hints.parent }, { timeout: 100000 });
}
export async function draftPurpose() {
  if (DEMO) throw new Error('demo');
  return API.post('/mod/mission/draft', { kind: 'purpose' }, { timeout: 100000 });
}

// Demo-only sample content the prototype's screens show (never read in real mode)
export const DEMO_X = D.X, DEMO_LOG = D.LOG, DEMO_SUGGEST = D.SUGGEST, DEMO_PURPOSE = D.PURPOSE;

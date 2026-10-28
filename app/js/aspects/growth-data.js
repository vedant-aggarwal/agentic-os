// Growth's data, live: the journal, check-ins, the week's data points, the level week by week (and growth as its rate of
// change), potential, the overnight dream, the Sunday review and the plans. Owner: the Growth agent.
// Real mode: the store collections at /api/v1/mod/growth/* (offline first: writes land here at once and sync later) and
// the PC's computed /mod/growth/state (cached for offline), plus the shared data in js/data.js (events, tasks, goals).
// Demo mode (?data=demo): the prototype's sample (growth-demo.js), unchanged. Same export names and shapes either way.
// Every binding below is a live `export let`: rebuild() reassigns them and fires `growth-changed` on the document.
import * as DEMO from './growth-demo.js';
import * as clock from '../svc/clock.js';
import * as API from '../svc/api.js';
import { collection } from '../svc/store.js';
import { DEMO_MODE, EVENTS, TASKS, GOALS, PEOPLE, aspect, onData, eventsOn } from '../data.js';

const G = globalThis;
export const REAL = !DEMO_MODE;

// ── dates (local Date objects at midnight, as the prototype's code expects) ──────────────────────────────────────────
export const { iso, fromIso, addDays, sameDay, fmtDay, fmtLong, fmtShort, dow, dowLong, monLong, monShort, MOODS } = DEMO;
export let TODAY = REAL ? fromIso(clock.today()) : DEMO.TODAY;
/** The clock's minutes since midnight (IST), for "17:40 now" and "4h 20m left". Demo: pinned at 17:40. */
export const nowMin = () => (REAL ? clock.nowMin() : 17 * 60 + 40);
export const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const hmOf = (isoT) => { const t = Date.parse(isoT); return Number.isFinite(t) ? new Date(t + clock.getOffset() * 60000).toISOString().slice(11, 16) : ''; };
export const mondayOf = (d) => addDays(d, -((d.getDay() + 6) % 7));
export const moodWord = (p, e) => (p && e ? DEMO.moodWord(p, e) : 'No mood set');

// ── the collections (real mode) ─────────────────────────────────────────────────────────────────────────────────────
const C = REAL ? {
  journal: collection('growth/journal', { endpoint: '/mod/growth/journal', prefix: 'j' }),
  checkins: collection('growth/checkins', { endpoint: '/mod/growth/checkins', prefix: 'ck' }),
  reviews: collection('growth/reviews', { endpoint: '/mod/growth/reviews' }),
  dreams: collection('growth/dreams', { endpoint: '/mod/growth/dreams' }),
  plans: collection('growth/plans', { endpoint: '/mod/growth/plans' }),
  settings: collection('growth/settings', { endpoint: '/mod/growth/settings', interval: 0 }),
} : null;
export const COL = C;

// ── the PC's computed state, cached so the app draws offline ────────────────────────────────────────────────────────
const SKEY = 'aos-growth:state';
export let STATE = null;
try { STATE = REAL ? JSON.parse(API.ls.get(SKEY) ?? 'null') : null; } catch { STATE = null; }
let fetching = null, lastFetch = 0;
export function refreshState(force = false) {
  if (!REAL) return Promise.resolve(null);
  if (fetching) return fetching;
  if (!force && Date.now() - lastFetch < 20_000) return Promise.resolve(STATE);
  fetching = API.get('/mod/growth/state', { timeout: 20000 }).then((s) => {
    STATE = s; lastFetch = Date.now();
    try { API.ls.set(SKEY, JSON.stringify(s)); } catch {}
    rebuild('state');
    return s;
  }).catch((e) => { if (e?.status !== 401) console.warn('[growth] state', e?.message ?? e); return STATE; }).finally(() => { fetching = null; });
  return fetching;
}

// ── the bindings (demo values first; rebuild() fills them in real mode) ────────────────────────────────────────────
export let ENTRIES = DEMO.ENTRIES;            // every entry except today's (today's is TODAY_ENTRY)
export let TODAY_ENTRY = null;                // today's entry, written on the night
export let DAYS = DEMO.DAYS;
export let entriesIn2026 = DEMO.entriesIn2026; // entries this year (the name is the prototype's)
export let STREAK = DEMO.STREAK;
export let PROMPTS = DEMO.PROMPTS;
export let CHECKINS = DEMO.CHECKINS;
export let NOTICED = DEMO.NOTICED;
export let DAY_MOMENTS = DEMO.DAY_MOMENTS;
export let WEEK = DEMO.WEEK;
export let LEVEL = DEMO.LEVEL;
export let RATE = DEMO.RATE;
export let WEEKS = DEMO.LEVEL.map((_, i) => ({ n: i + 1, key: `2026-W${String(i + 1).padStart(2, '0')}`, from: iso(DEMO.weekStart(i + 1)) }));
export let GROWTH = { ...DEMO.GROWTH, has: true };
export let ASPECT_LEVELS = DEMO.ASPECT_LEVELS;
export let DRIVERS = DEMO.DRIVERS;
export let VELOCITY = DEMO.VELOCITY;
export let POTENTIAL = DEMO.POTENTIAL;
export let POT = DEMO.POT;
export let DREAM = DEMO.DREAM;
export let PAST_DREAMS = DEMO.PAST_DREAMS;
export let REVIEW = DEMO.REVIEW;
export let PAST_REVIEWS = DEMO.PAST_REVIEWS;
export let PLAN = DEMO.PLAN;
export let SETTINGS = { nudge: true, alarm: true, call: true, freeze: false };
export let SOURCES = [];
export const entryOn = (k) => (TODAY_ENTRY && k === iso(TODAY) ? TODAY_ENTRY : ENTRIES.find((e) => e.date === k));
export const day = (k) => DAYS.get(k) ?? { written: false };
export const monthStats = (y, m) => {
  const n = new Date(y, m + 1, 0).getDate();
  let written = 0, upTo = 0;
  for (let i = 1; i <= n; i++) { const d = new Date(y, m, i); if (d >= TODAY) break; upTo++; if (day(iso(d)).written) written++; }
  return { written, upTo, days: n };
};
/** Week index (1-based into LEVEL) → its Monday, its label, its ISO week number. */
export const weekStart = (w) => (WEEKS[w - 1] ? fromIso(WEEKS[w - 1].from) : DEMO.weekStart(w));
export const weekLabel = (w) => { const a = weekStart(w), b = addDays(a, 6); return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${monShort(a.getMonth())}` : `${fmtShort(a)} – ${fmtShort(b)}`; };
export const weekNo = (w) => WEEKS[w - 1]?.n ?? w;
export const rateAt = (i, span = 4, arr = LEVEL) => (i <= 0 ? 0 : i < span ? (arr[i] - arr[0]) / i : (arr[i] - arr[i - span]) / span);
/** The photos entries carry (data URLs), by key, for photoHtml(). Demo photos live in growth-flows' PHOTOS. */
export const PHOTO_SRC = new Map();

// ── building the real shapes ────────────────────────────────────────────────────────────────────────────────────────
const ASP = ['body', 'mind', 'soul', 'mission', 'money', 'growth', 'family', 'romance', 'friends'];
const words = (t) => (String(t ?? '').trim() ? String(t).trim().split(/\s+/).length : 0);
function shapeEntry(d) {
  const photos = (d.photos ?? []).map((p, i) => { const k = `${d.id}:${i}`; PHOTO_SRC.set(k, typeof p === 'string' ? { src: p, alt: 'A photo from this entry', at: '' } : { src: p.src, alt: p.alt ?? 'A photo from this entry', at: p.at ?? '' }); return k; });
  const filed = Array.isArray(d.filed) ? d.filed : [];
  return {
    id: d.id, date: d.date, at: hmOf(d.at) || '', kind: d.kind ?? 'typed', p: d.p ?? null, e: d.e ?? null, words: d.words ?? words(d.text),
    title: d.title || 'Untitled', text: String(d.text ?? ''), aspects: [...new Set(filed.map((f) => f[0]).filter(Boolean))], filed,
    asked: d.asked ?? null, photos, photo: photos[0] ?? null, len: d.len ?? null, review: d.review ?? null, by: d.by ?? 'me',
    late: !!d.backfill, readonly: !!d.readonly, mood: d.mood ?? null, prompt: d.prompt ?? null, doc: d,
  };
}
function buildJournal() {
  const today = iso(TODAY);
  const mine = C.journal.list().filter((d) => d.date && d.text != null);
  const wyn = (STATE?.wyn ?? []).filter((n) => !mine.some((m) => m.id === n.id));
  const all = [...mine.map(shapeEntry), ...wyn.map(shapeEntry)];
  // today's entry is the one written tonight (his own, not a backfill); the rest go to the list
  const todays = all.filter((e) => e.date === today && !e.late && !e.readonly);
  TODAY_ENTRY = todays[0] ?? null;
  ENTRIES = all.filter((e) => e !== TODAY_ENTRY).sort((a, b) => (a.date === b.date ? (a.at < b.at ? 1 : -1) : a.date < b.date ? 1 : -1));
  const days = new Map();
  for (const e of all) {
    const c = days.get(e.date) ?? { written: false, live: false, p: null, e: null, entry: null };
    c.written = true; c.live ||= !e.late;
    if (e.p && !c.p) { c.p = e.p; c.e = e.e; }
    if (!c.entry || (c.entry.readonly && !e.readonly)) c.entry = e;
    days.set(e.date, c);
  }
  for (const c of days.values()) if (!c.p) { c.p = 3; c.e = 3; c.nomood = true; }
  DAYS = days;
  const y = String(TODAY.getFullYear());
  entriesIn2026 = [...days.keys()].filter((k) => k.startsWith(y)).length;
  // the streak: nights written in a row, ending last night (tonight adds one once it's in). Backfills don't count.
  const live = (k) => !!days.get(k)?.live;
  let n = 0; for (let d = addDays(TODAY, -1); live(iso(d)); d = addDays(d, -1)) n++;
  const dates = [...days.entries()].filter(([, v]) => v.live).map(([k]) => k).sort();
  let best = 0, run = 0, prev = null, bestTo = null;
  for (const k of dates) { run = prev && Math.round((fromIso(k) - fromIso(prev)) / 864e5) === 1 ? run + 1 : 1; if (run > best) { best = run; bestTo = k; } prev = k; }
  const cur = n + (live(today) ? 1 : 0);
  if (cur > best) { best = cur; bestTo = live(today) ? today : iso(addDays(TODAY, -1)); }
  STREAK = { n, best, bestFrom: bestTo ? addDays(fromIso(bestTo), -(best - 1)) : null, bestTo: bestTo ? fromIso(bestTo) : null, freezes: Math.min(2, Math.floor(cur / 7)), saveBy: '22:00', alarm: '22:00', call: '22:30', today: live(today) };
}
function buildCheckins() {
  const today = iso(TODAY);
  CHECKINS = C.checkins.list().filter((c) => c.date === today).sort((a, b) => String(a.at).localeCompare(String(b.at)))
    .map((c) => ({ id: c.id, at: hmOf(c.at), p: c.p, e: c.e, note: (c.why ?? []).length ? c.why.join(', ') : c.note || (c.by === 'wyn' ? `From what you told ${'her'}` : 'Check-in') }));
}
// the day as it happened: today's calendar blocks (done, now, later), each a way into tonight's entry
function buildMoments() {
  const now = nowMin();
  const evs = EVENTS.filter((e) => !e.sleep && !e.allDay && Number.isFinite(e.start)).sort((a, b) => a.start - b.start);
  DAY_MOMENTS = evs.map((e) => {
    const done = e.end <= now, isNow = e.start <= now && e.end > now;
    const len = Math.max(0, Math.round(e.end - e.start));
    const note = [e.where, len ? clock.dur(len) : null].filter(Boolean).join(' · ') || (done ? 'Done' : isNow ? 'On now' : 'Still to come');
    const prompt = done ? `${e.title} at ${hm(e.start)}. Anything from it worth keeping?` : isNow ? `${e.title} is on now. What do you want from it?` : `How did ${e.title} go?`;
    return { id: e.id, at: hm(Math.max(0, e.start)), label: e.title, aspect: e.aspect ?? 'growth', done, now: isNow, later: !done && !isNow, note, prompt };
  });
}
// tonight's prompts, from his day: what happened on the calendar, what he closed, what is late, what she asked
function buildPrompts() {
  const out = [];
  const now = nowMin();
  const past = EVENTS.filter((e) => !e.sleep && !e.allDay && e.end <= now).sort((a, b) => b.end - a.end);
  const later = EVENTS.filter((e) => !e.sleep && !e.allDay && e.start > now).sort((a, b) => a.start - b.start);
  const done = TASKS.filter((t) => t.doneToday);
  const late = TASKS.filter((t) => t.list === 'overdue').sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const lastAsk = ENTRIES.find((e) => typeof e.asked === 'string' && e.asked);
  if (lastAsk) out.push({ id: 'pa', aspect: 'growth', from: `${'Her'} question about ${fmtDay(fromIso(lastAsk.date))}`, text: lastAsk.asked });
  if (done.length) out.push({ id: 'pd', aspect: done[0].aspect ?? 'mission', from: `${done.length} ${done.length === 1 ? 'task' : 'tasks'} closed today`, text: `You closed "${done[0].title}" today. What made it work?` });
  if (past[0]) out.push({ id: 'pe', aspect: past[0].aspect ?? 'growth', from: `${past[0].title} at ${hm(Math.max(0, past[0].start))}`, text: `${past[0].title} today: what's one thing from it worth remembering?` });
  if (late[0]) out.push({ id: 'pl', aspect: late[0].aspect ?? 'mission', from: `${late[0].title} · ${late[0].late ?? 'late'}`, text: `"${late[0].title}" is ${late[0].late ?? 'late'}. What's really in the way?` });
  if (later[0]) out.push({ id: 'pn', aspect: later[0].aspect ?? 'growth', from: `${later[0].title} at ${hm(later[0].start)}`, text: `${later[0].title} is still ahead tonight. How do you want it to go?` });
  const top = DREAM?.connections?.[0];
  if (top) out.push({ id: 'pc', aspect: top.aspects?.[0] ?? 'growth', from: 'From last night\'s dream', text: `${top.title}. Does that feel true today?` });
  out.push({ id: 'p0', aspect: 'growth', from: 'A question for any night', text: 'What from today do you want to remember a year from now?' });
  out.push({ id: 'p9', aspect: 'growth', from: 'A question for any night', text: 'What took more energy than it should have today?' });
  PROMPTS = out;
}
function shapeDream(d) {
  if (!d) return null;
  const proposals = (d.proposals ?? []).map((p) => ({ ...p }));
  return {
    id: d.id, date: d.date, status: d.status, from: d.from ?? '04:30', to: d.to ?? '', ready: d.to ?? '', headline: d.headline ?? '',
    read: d.read ?? [], missing: d.missing ?? [], connections: (d.connections ?? []).map((c) => ({ ...c, aspects: (c.aspects ?? []).filter((a) => ASP.includes(a)), evidence: c.evidence ?? [] })),
    gaps: d.gaps ?? [], slipped: d.slipped ?? [], proposals, error: d.error ?? null, doc: d,
  };
}
function buildDream() {
  const list = C.dreams.list().filter((d) => d.date).sort((a, b) => b.date.localeCompare(a.date));
  const ready = list.filter((d) => d.status === 'ready' || d.status === 'running' || d.status === 'failed');
  DREAM = shapeDream(ready[0]);
  PAST_DREAMS = ready.slice(1, 15).filter((d) => d.status === 'ready').map((d) => {
    const ps = d.proposals ?? [];
    return { date: d.date, line: d.headline || d.connections?.[0]?.title || 'A quiet night', found: (d.connections ?? []).length + (d.gaps ?? []).length, approved: ps.filter((p) => p.answer === 'yes').length, declined: ps.filter((p) => p.answer === 'no').length, dream: shapeDream(d) };
  });
}
function shapePoint(p) { return { aspect: p.aspect, label: p.label, now: p.now, was: p.was, dir: p.dir, good: p.good, note: p.note ?? '', to: p.to?.startsWith('tasks:') ? 'aspect:mission' : p.to }; }
function buildWeek() {
  const s = STATE;
  const mon = mondayOf(TODAY), key = s?.week?.key ?? null;
  const daysIn = Math.round((TODAY - mon) / 864e5) + 1;
  const people = PEOPLE.map((x) => {
    const re = new RegExp(`\\b${String(x.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const hits = [...ENTRIES, ...(TODAY_ENTRY ? [TODAY_ENTRY] : [])].filter((e) => fromIso(e.date) >= mon && re.test(e.text));
    return { id: x.id, n: hits.length, line: hits.length ? `Mentioned ${hits.map((e) => dow(fromIso(e.date))).join(', ')}` : 'Not in this week\'s entries' };
  });
  WEEK = {
    n: s?.week?.n ?? null, key, label: s?.week?.label ?? `${fmtShort(mon)} – ${fmtShort(addDays(mon, 6))}`, from: iso(mon), to: iso(addDays(mon, 6)),
    reviewAt: `Sun ${addDays(mon, 6).getDate()} ${monShort(addDays(mon, 6).getMonth())}, 18:00`, daysIn,
    score: s?.week?.score ?? null, last: s?.week?.last ?? null, rate: s?.week?.rate ?? 0,
    points: (s?.week?.points ?? []).map(shapePoint),
    moves: (s?.week?.moves ?? []).map((m) => ({ text: m.text, aspect: m.aspect ?? 'growth', done: m.done ? 1 : 0, of: 1, progress: m.progress, state: m.done ? 'on' : (m.progress ?? 0) >= 50 ? 'on' : 'behind', note: m.done ? 'Done' : m.progress != null ? `${m.progress}% of its goal` : 'In Mission' })),
    rule: s?.week?.rule?.text ? { text: s.week.rule.text, kept: null, of: null } : null,
    people: people.filter((p) => p.n).concat(people.filter((p) => !p.n)).slice(0, 4),
  };
}
function buildLevels() {
  const s = STATE;
  const ws = (s?.weeks ?? []).filter((w) => w.level != null || true);
  WEEKS = ws.map((w) => ({ n: w.n, key: w.key, from: w.from }));
  LEVEL = ws.map((w) => w.level ?? 0);
  RATE = ws.map((w) => w.rate ?? 0);
  const n = LEVEL.length;
  if (!n) { GROWTH = { has: false, now: null, start: null, low: null, lowW: 0, high: null, highW: 0, rate4: 0, rate12: 0, sinceLow: 0, sinceStart: 0, weeksSinceLow: 0 }; }
  else {
    const now = LEVEL[n - 1], low = Math.min(...LEVEL), lowW = LEVEL.indexOf(low) + 1;
    const past = LEVEL.slice(0, Math.max(1, n - 1)), high = Math.max(...past), highW = LEVEL.indexOf(high) + 1;
    GROWTH = { has: true, weeks: n, now, start: LEVEL[0], low, lowW, high, highW, rate4: rateAt(n - 1, 4, LEVEL), rate12: rateAt(n - 1, 12, LEVEL), sinceLow: now - low, sinceStart: now - LEVEL[0], weeksSinceLow: n - lowW };
    if (n === 1) { GROWTH.rate4 = 0; GROWTH.rate12 = 0; }
  }
  ASPECT_LEVELS = Object.fromEntries((s?.velocity ?? []).map((v) => [v.id, v.arr]));
  VELOCITY = (s?.velocity ?? []).map((v) => ({ id: v.id, now: v.now, v: v.v, state: v.state, arr: v.arr })).sort((a, b) => b.v - a.v);
  DRIVERS = s?.drivers ?? {};
  SOURCES = s?.sources ?? [];
  POTENTIAL = (s?.potential ?? []).map((x) => ({ id: x.id, now: x.now, goal: null, pot: x.pot == null ? null : Math.max(x.pot, x.now ?? 0), goals: x.goals ?? [], best: x.best ?? 'No data yet', weeks: x.weeks ?? 0 }));
  const has = POTENTIAL.filter((x) => x.now != null && x.pot);
  const avg = (k) => (has.length ? Math.round(has.reduce((a, x) => a + (x[k] ?? 0), 0) / has.length) : 0);
  const pn = avg('now'), pp = avg('pot');
  POT = { now: pn, goal: null, pot: pp, share: pp ? Math.round((pn / pp) * 100) : 0, unclaimed: Math.max(0, pp - pn), gaps: has.map((x) => ({ ...x, gap: x.pot - x.now })).sort((a, b) => b.gap - a.gap) };
}
function buildReview() {
  const s = STATE;
  const key = s?.week?.key;
  const local = key ? C.reviews.get(key) : null;
  const r = local ?? s?.review ?? null;
  const mon = mondayOf(TODAY), next = addDays(mon, 7);
  REVIEW = r ? {
    key: r.id ?? key, week: s?.week?.n ?? r.n, label: r.label ?? WEEK.label, next: r.next ?? `${fmtShort(next)} – ${fmtShort(addDays(next, 6))}`,
    drafted: r.drafted_at ? `${dow(new Date(r.drafted_at))} ${hmOf(r.drafted_at)}` : '', draftedBy: r.drafted_by ?? 'code', status: r.status ?? 'draft',
    feel: { p: r.feel?.p ?? null, e: r.feel?.e ?? null, line: r.feel?.line ?? '' }, headline: r.headline ?? '',
    wins: (r.wins ?? []).map((w) => ({ ...w })), misses: (r.misses ?? []).map((m) => ({ ...m, why: m.why ?? null })), whys: r.whys ?? DEMO.REVIEW.whys,
    rules: (r.rules ?? []).map((x) => ({ ...x })), moves: (r.moves ?? []).map((m) => ({ ...m })), streak: s?.sundays ?? 0,
    sealed: r.status === 'sealed', rule: r.rule ?? null, ruleText: r.ruleText ?? null, doc: r,
  } : { key, week: s?.week?.n ?? null, label: WEEK.label, next: '', drafted: '', status: 'none', feel: { p: null, e: null, line: '' }, headline: '', wins: [], misses: [], whys: DEMO.REVIEW.whys, rules: [], moves: [], streak: 0, sealed: false };
  const sealedLocal = C.reviews.list().filter((x) => x.status === 'sealed' && x.id !== key);
  const fromPc = (s?.reviews ?? []).filter((x) => x.week !== key);
  const byWeek = new Map(fromPc.map((x) => [x.week, x]));
  for (const x of sealedLocal) byWeek.set(x.id, { week: x.id, n: Number(String(x.id).slice(6)), label: x.label, score: x.score, last: x.last, line: x.headline, rule: x.ruleText, moves: (x.moves ?? []).filter((m) => m.on !== false).map((m) => m.text) });
  PAST_REVIEWS = [...byWeek.values()].sort((a, b) => String(b.week).localeCompare(String(a.week))).map((x) => ({ week: x.n ?? Number(String(x.week).slice(6)), key: x.week, label: x.label, score: x.score ?? null, delta: x.score != null && x.last != null ? x.score - x.last : 0, line: x.line ?? '', rule: x.rule ?? '', kept: '', moves: x.moves ?? [] }));
}
function buildPlan() {
  const today = iso(TODAY);
  const doc = C.plans.get(`day-${today}`);
  const open = TASKS.filter((t) => ['today', 'overdue', 'doing'].includes(t.list) || t.doneToday);
  const pick = doc?.three?.length ? doc.three.map((id) => TASKS.find((t) => t.id === id)).filter(Boolean)
    : [...open].sort((a, b) => (a.doneToday === b.doneToday ? 0 : a.doneToday ? -1 : 1) || (a.priority ?? 2) - (b.priority ?? 2)).slice(0, 3);
  const sleep = EVENTS.find((e) => e.sleep && e.end > 0 && e.end < 14 * 60);
  const slept = sleep ? clock.dur(Math.max(0, sleep.end - sleep.start)) : null;
  const tomorrow = TASKS.filter((t) => t.list === 'upcoming' && t.date === iso(addDays(TODAY, 1))).sort((a, b) => (a.at ?? 9999) - (b.at ?? 9999))[0];
  const mon = addDays(mondayOf(TODAY), 7);
  const load = Array.from({ length: 7 }, (_, i) => {
    const d = iso(addDays(mon, i));
    const evm = (eventsOn(d) ?? []).filter((e) => !e.sleep && !e.allDay).reduce((a, e) => a + Math.max(0, e.end - e.start), 0);
    const tm = TASKS.filter((t) => t.date === d && t.list !== 'done').reduce((a, t) => a + (t.len ?? t.est ?? 30), 0);
    return [['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i], Math.round(((evm + tm) / 60) * 2) / 2];
  });
  const weekDoc = STATE?.week?.key ? C.plans.get(`week-${STATE.week.key}`) : null;
  PLAN = {
    day: {
      done: doc?.planned_at ? hmOf(doc.planned_at) : null, slept, doc,
      energy: slept ? `You slept ${slept}. Put the hardest of your three in your first free block` : 'No sleep logged for last night. Put the hardest of your three in your first free block',
      three: pick.map((t) => ({ id: t.id, text: t.title, done: t.list === 'done' || !!t.doneToday, at: t.completedAt ? hmOf(t.completedAt) : '', late: t.late ?? (t.when ? `Planned ${t.when}` : '') })),
      intention: doc?.intention ?? '',
      evening: { at: '22:00', steps: DEMO.PLAN.day.evening.steps },
      tomorrow: tomorrow ? { at: tomorrow.at != null ? hm(tomorrow.at) : 'Tomorrow', text: tomorrow.title, id: tomorrow.id } : null,
    },
    week: { label: `${fmtShort(mon)} – ${fmtShort(addDays(mon, 6))}`, planAt: 'Sunday, after the review', load, rules: weekDoc?.rules ?? [] },
  };
}
function buildSettings() { SETTINGS = { nudge: true, alarm: true, call: true, freeze: false, ...(C.settings.get('streak') ?? {}) }; }

let raf = 0;
export function rebuild(why = 'local') {
  if (!REAL) return;
  TODAY = fromIso(clock.today());
  try {
    buildJournal(); buildCheckins(); buildDream(); buildMoments(); buildPrompts(); buildLevels(); buildWeek(); buildReview(); buildPlan(); buildSettings();
  } catch (e) { console.warn('[growth] rebuild', e); }
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => { G.document?.dispatchEvent(new CustomEvent('growth-changed', { detail: { why } })); G.document?.dispatchEvent(new CustomEvent('aspect-summary', { detail: { id: 'growth' } })); });
}

if (REAL) {
  NOTICED = [];
  rebuild('boot');
  for (const c of Object.values(C)) c.on('change', (d) => { rebuild(d?.why ?? 'store'); if (['server', 'synced', 'refresh'].includes(d?.why)) refreshState(); });
  onData((why) => { if (['boot', 'server', 'day', 'local', 'synced'].includes(why)) rebuild(why); if (why === 'day' || why === 'boot') refreshState(true); });
  G.document?.addEventListener('clock-tick', () => { const m = nowMin(); if (m % 10 === 0) rebuild('tick'); });
  refreshState(true);
  G.addEventListener?.('online', () => refreshState(true));
  G.document?.addEventListener('visibilitychange', () => { if (G.document.visibilityState === 'visible') refreshState(); });
}

// ── writes (real mode; demo mode keeps the prototype's in-memory behaviour in growth-flows) ──────────────────────────
export function saveEntry({ text, p = null, e = null, kind = 'typed', photos = [], prompt = null, asked = [], backfill = null, filed = [], len = null, append = true }) {
  const date = backfill ?? iso(TODAY);
  const cur = !backfill && append ? (TODAY_ENTRY?.doc && !TODAY_ENTRY.readonly ? TODAY_ENTRY.doc : null) : null;
  if (cur) {
    const full = `${cur.text ?? ''}\n\n${text}`.trim();
    return C.journal.update(cur.id, { text: full, words: words(full), p: p ?? cur.p ?? null, e: e ?? cur.e ?? null, photos: [...(cur.photos ?? []), ...photos], asked: [...(cur.asked ?? []), ...asked], filed });
  }
  const title = (() => { const s = text.split(/[.!?\n]/)[0].trim(); return s.length > 46 ? `${s.slice(0, 44).replace(/\s+\S*$/, '')}…` : s || 'Tonight'; })();
  return C.journal.add({ date, at: new Date(clock.nowMs()).toISOString(), kind, text, title, words: words(text), p, e, photos, prompt, asked, filed, by: 'me', source: 'app', backfill: !!backfill, len });
}
export const saveCheckin = ({ p, e, why = [] }) => C.checkins.add({ date: iso(TODAY), at: new Date(clock.nowMs()).toISOString(), p, e, why });
export const answerProposal = (dreamId, pid, answer, made = null) => {
  const d = C.dreams.get(dreamId); if (!d) return null;
  const proposals = (d.proposals ?? []).map((p) => (p.id === pid ? { ...p, answer, answered_at: answer ? new Date(clock.nowMs()).toISOString() : null, made: answer ? made : null } : p));
  return C.dreams.update(dreamId, { proposals });
};
export const putReview = (doc) => C.reviews.put(doc);
export const putPlan = (doc) => C.plans.put(doc);
export const putSettings = (patch) => C.settings.put({ ...(C.settings.get('streak') ?? { id: 'streak' }), ...patch, id: 'streak' });
export const aspectName = (id) => aspect(id)?.name ?? (id === 'content' ? 'Content' : 'Growth');
export { GOALS };

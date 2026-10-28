// Body · what the screens read: the live state derived from his real records (body-store.js collections, through the
// shared model body-model.js), the date helpers on the real clock, and the static content (program exercises, articles,
// lessons, quick foods). Demo mode seeds the prototype's story into the same collections (body-demo.js). The state is
// rebuilt after every change and the built Body sections redraw. Owner: the Body agent.
import { DEMO_MODE, AGENT } from '../data.js';
import * as clock from '../svc/clock.js';
import * as M from './body-model.js';
import { C, onChange, ready } from './body-store.js';
import { seedDemo, DEMO_WYN } from './body-demo.js';
export { MUSCLES, EX, exInfo, itemOf, e1rm, setVol, sessionVolume, sessionSets, workSets, swapsFor, ROTATION, LIB_IMG, libEx, TARGET_SOURCES } from './body-model.js';

// ── dates, on the real clock (demo: pinned to Thu 22 Oct 17:40) ───────
export let TODAY = clock.today();
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MOL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const dt = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = M.addDays;
export const daysBetween = M.daysBetween;
export const weekOf = M.weekOf;
export const dayLabel = (s) => { const d = dt(s); return `${WD[d.getUTCDay()]} ${d.getUTCDate()} ${MO[d.getUTCMonth()]}`; };
export const dayShort = (s) => { const d = dt(s); return `${d.getUTCDate()} ${MO[d.getUTCMonth()]}`; };
export const weekday = (s, long = false) => (long ? WDL : WD)[dt(s).getUTCDay()];
export const monthName = (m, long = true) => (long ? MOL : MO)[m];
export const hm = M.hmOf;
export const nowMs = () => clock.nowMs();
export const nowMin = () => clock.nowMin();
export const clockNow = () => hm(clock.nowMin());
export const relDay = (s) => { const n = daysBetween(s, TODAY); return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : n === -1 ? 'Tomorrow' : n > 0 && n < 7 ? weekday(s, true) : dayLabel(s); };
export const whenOf = (date, at) => `${date === TODAY ? (at && M.toMin(at) >= 17 * 60 ? 'Tonight' : 'Today') : date === addDays(TODAY, 1) ? 'Tomorrow' : weekday(date, true)}${at ? ` · ${at}` : ''}`;

// ── the live state ────────────────────────────────────────────────────
export const B = {
  ready: false, demo: DEMO_MODE,
  all: [], sessions: [], missed: [], plans: [], auto: null, live: null, best: {},
  targets: M.targetsOf(null), fresh: {}, readings: [], health: M.readiness({}), meals: [], mealsAll: [], water: 0,
  items: [], checks: [], proto: { n: 0, today: false, week: [] }, day: { due: 0, done: 0 }, scans: [], programs: [], exercises: [],
  profile: null, healthConn: null, wyn: [], version: 0,
};
const subs = new Set();
/** fn() after the state is rebuilt. */
export function onBody(fn) { subs.add(fn); return () => subs.delete(fn); }
export function rebuild() {
  TODAY = clock.today();
  const now = clock.nowMs();
  B.all = C.workouts.list().map(M.normalize);
  B.sessions = B.all.filter((s) => s.status === 'done').sort((a, b) => a.startMs - b.startMs);
  B.missed = B.all.filter((s) => s.status === 'skipped').sort((a, b) => a.date.localeCompare(b.date));
  B.best = M.annotate(B.sessions);
  const liveDoc = C.workouts.list().find((d) => d.status === 'live');
  B.live = liveDoc ? (B.live?.id === liveDoc.id && B.live._local ? B.live : JSON.parse(JSON.stringify(liveDoc))) : null;
  B.targets = M.targetsOf(C.settings.get('targets'));
  B.fresh = C.settings.get('fresh')?.muscles ?? {};
  B.profile = C.settings.get('profile') ?? null;
  B.healthConn = C.settings.get('health') ?? null;
  B.readings = C.readings.list();
  B.health = M.readiness({ readings: B.readings, sessions: B.sessions, nowMs: now, fresh: B.fresh, sleepGoal: B.targets.sleep });
  B.health.vo2 = (() => { const v = B.readings.filter((r) => r.kind === 'vo2').sort((a, b) => a.date.localeCompare(b.date)); return v.length ? { now: Number(v.at(-1).value), week: v.slice(-7).map((x) => Number(x.value)) } : null; })();
  B.mealsAll = C.meals.list();
  B.meals = B.mealsAll.filter((m) => m.date === TODAY).map(mealView).sort((a, b) => a.at.localeCompare(b.at));
  B.water = Number(C.readings.get(`water:${TODAY}`)?.value ?? 0);
  B.items = C.protocol.list().filter((x) => x.active !== false);
  B.checks = C.checks.list();
  B.proto = M.protocolStreak(B.items, B.checks, TODAY);
  B.day = M.protocolDay(B.items, B.checks, TODAY);
  const doneToday = new Map(B.checks.filter((c) => c.date === TODAY).map((c) => [c.item, c]));
  const due = new Set(M.dueOn(B.items, TODAY).map((x) => x.id));
  const view = (x) => { const c = doneToday.get(x.id); return { ...x, due: due.has(x.id), done: !!c?.done, meta: c?.done && c.at ? `Done ${hm(clock.toMin(c.at))}` : x.meta ?? '' }; };
  B.am = B.items.filter((x) => x.half === 'am').map(view);
  B.pm = B.items.filter((x) => x.half === 'pm').map(view);
  B.scans = C.scans.list().filter((s) => s.skin != null || s.cm != null || s.puff != null).sort((a, b) => a.date.localeCompare(b.date));
  B.exercises = C.exercises.list();
  B.programs = PROGRAM_DEFS.map((p) => {
    const e = C.programs.get(p.id); const on = !!(e && e.active !== false && e.started);
    const day = on ? Math.max(1, Math.min(p.days, daysBetween(e.started, TODAY) + 1)) : 0;
    const done = on ? B.checks.filter((c) => c.item === `prog:${p.id}` && c.done && c.date >= e.started).map((c) => daysBetween(e.started, c.date) + 1) : [];
    return { ...p, enrolled: on, started: on ? e.started : null, day, done: [...new Set(done)].sort((a, b) => a - b), doneToday: done.includes(day) };
  });
  // plans: what is stored (Wyn's or his), then the rules' plan for the next training day when nothing is stored for it
  B.plans = B.all.filter((s) => s.status === 'planned' && s.date >= TODAY).sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start).map((p) => planView(p, true));
  const auto = M.planNext({ sessions: B.sessions, nowMs: now, fresh: B.fresh, readinessScore: B.health.partial ? null : B.health.score });
  B.auto = B.plans.some((p) => p.date === auto.date) ? null : planView(auto, false);
  B.wyn = DEMO_MODE ? DEMO_WYN.map(([at, text]) => ({ at, text })) : wynToday();
  B.ready = true; B.version++;
  subs.forEach((f) => { try { f(); } catch (e) { console.error('[body] redraw', e); } });
}
// a meal as the screens read it
const mealView = (m) => ({ ...m, at: m.at ? hm(clock.toMin(m.at)) : '', slot: slotName(m.slot), p: Math.round(Number(m.protein) || 0), kcal: Math.round(Number(m.kcal) || 0),
  c: Math.round(Number(m.carbs) || 0), f: Math.round(Number(m.fat) || 0), fibre: Math.round(Number(m.fibre) || 0),
  how: m.how ?? ({ scan: 'Scanned', say: 'From your words', quick: 'Quick add', siri: 'From Siri', widget: 'From the widget', wyn: 'Logged by Wyn', plan: `Planned by ${AGENT.name}`, cli: 'From the PC' }[m.source] ?? ''),
  items: (m.items ?? []).map((x) => (Array.isArray(x) ? x : [x.name ?? '', x.grams ? `${Math.round(x.grams)} g` : x.qty ? `${x.qty} ${x.unit ?? ''}`.trim() : '', Math.round(x.kcal ?? 0), Math.round(x.protein ?? 0)])) });
export const slotName = (s) => ({ breakfast: 'Breakfast', lunch: 'Lunch', snack: 'Snack', dinner: 'Dinner', 'pre-workout': 'Pre-workout', 'post-workout': 'Post-workout' }[String(s ?? '').toLowerCase()] ?? (s ? String(s)[0].toUpperCase() + String(s).slice(1) : 'Meal'));
// a plan as the screens read it: items with a set count, a target and a note; reasons as plain lines
function planView(p, stored) {
  return { ...p, stored, at: p.at ?? null, dur: p.dur ?? Math.round((p.items ?? []).reduce((a, it) => a + (it.kind === 'cardio' ? (it.target?.min ?? 20) : (it.sets?.length ?? it.sets ?? 3) * 2.6), 0) / 5) * 5,
    reasons: (p.reasons ?? []).map((r) => (Array.isArray(r) ? r[0] : r)),
    items: (p.items ?? []).map((it) => ({ ...it, name: it.name ?? M.exInfo(it.ex, it).name, sets: Array.isArray(it.sets) ? it.sets.length : (it.sets ?? 3), target: it.target ?? (Array.isArray(it.sets) && it.sets[0] ? (({ done, ...t }) => t)(it.sets[0]) : {}) })) };
}
// what Wyn did in Body today, from the records she wrote
function wynToday() {
  const out = [];
  const day = (iso) => iso && clock.dateOfIso(iso) === TODAY;
  // only what she did today about today (an import of old lines is not something she did today)
  for (const m of C.meals.list()) if (m.source === 'wyn' && m.date === TODAY && day(m.created_at)) out.push({ at: hm(clock.toMin(m.created_at)), text: `Logged ${m.name} from your message: ${Math.round(m.protein ?? 0)} g protein` });
  for (const w of C.workouts.list()) {
    if (w.plan_by === 'wyn' && w.status === 'planned' && w.date >= TODAY && day(w.updated_at)) out.push({ at: hm(clock.toMin(w.updated_at)), text: `Planned ${w.name} for ${relDay(w.date).toLowerCase()} from your recovery` });
    if (w.source === 'wyn' && w.status === 'done' && w.date === TODAY && day(w.updated_at)) out.push({ at: hm(clock.toMin(w.updated_at)), text: `Logged sets to ${w.name}` });
  }
  for (const c of C.checks.list()) if (c.by === 'wyn' && c.date === TODAY && c.at) out.push({ at: hm(clock.toMin(c.at)), text: `Ticked "${C.protocol.get(c.item)?.text ?? 'a protocol item'}"` });
  for (const r of C.readings.list()) if (r.source === 'wyn' && day(r.updated_at)) out.push({ at: hm(clock.toMin(r.updated_at)), text: `Logged your ${r.kind} from your message` });
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// ── reads over the state ──────────────────────────────────────────────
export const next = () => (B.live ? null : B.plans.find((p) => p.date >= TODAY) ?? B.auto ?? null);
export const upcoming = () => [...B.plans, ...(B.auto ? [B.auto] : [])].sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? 0) - (b.start ?? 0));
export const planById = (id) => upcoming().find((p) => p.id === id) ?? null;
export const session = (id) => B.all.find((s) => s.id === id) ?? null;
export const trend = (ex) => M.trend(B.sessions, ex);
export const previous = (ex) => M.previous(B.sessions, ex);
export const bestFor = (ex) => B.best[ex] ?? null;
export const fatigueAt = (hours = 0) => M.fatigueAt(B.sessions, clock.nowMs(), { hours, fresh: B.fresh });
export const pctNow = (m, hours = 0) => M.pctOf(fatigueAt(hours), m);
export const readyIn = (m) => M.readyIn(B.sessions, m, clock.nowMs(), { fresh: B.fresh });
export const recoveryCurve = (m, o = {}) => M.recoveryCurve(B.sessions, m, clock.nowMs(), { fresh: B.fresh, ...o });
export const hoursTo = (date, min) => (M.dayMs(date, min) - clock.nowMs()) / 36e5;
/** Plan text can name live numbers: {chest} now, {2026-10-24 08:00:chest} at a time, {readiness}. */
export const fill = (t) => String(t ?? '').replace(/\{(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}):(\w+)\}/g, (_, d, h, m) => `${pctNow(m, Math.max(0, hoursTo(d, M.toMin(h))))}%`)
  .replace(/\{readiness\}/g, () => String(B.health.score ?? '')).replace(/\{(\w+)\}/g, (_, m) => (M.MUSCLES[m] ? `${pctNow(m)}%` : _));
export function eaten(meals = B.meals) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, fibre: 0 };
  for (const m of meals) { t.kcal += m.kcal; t.p += m.p; t.c += m.c; t.f += m.f; t.fibre += m.fibre ?? 0; }
  return t;
}
export const proteinLeft = () => Math.max(0, B.targets.protein - eaten().p);
export const pmDone = () => B.pm.filter((x) => x.due && x.done).length;
export const pmDue = () => B.pm.filter((x) => x.due).length;
export const trainedToday = () => B.sessions.filter((s) => s.date === TODAY);
/** Protein per day for the week so far (Mon → today). */
export function proteinWeek() {
  const mon = weekOf(TODAY); const out = [];
  for (let d = mon; d <= TODAY; d = addDays(d, 1)) out.push([weekday(d), Math.round(B.mealsAll.filter((m) => m.date === d).reduce((a, m) => a + (Number(m.protein) || 0), 0)), d]);
  return out;
}
/** Readiness as it was each morning (09:00) for the last n days, from what was known then. */
export function readinessHistory(n = 14) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = addDays(TODAY, -i); const at = i === 0 ? clock.nowMs() : M.dayMs(d, 9 * 60);
    const r = M.readiness({ readings: B.readings.filter((x) => x.date <= d), sessions: B.sessions, nowMs: at, fresh: B.fresh, sleepGoal: B.targets.sleep });
    out.push({ d, v: r.score, partial: r.partial });
  }
  return out;
}

// ── programs, articles, lessons (content; his progress in each program comes from his records) ──
// exercises in the Looks programs. kind: hold (seconds × reps) · reps · habit · minutes; art: an illustration in body-ui, or img: a photo
export const LEX = {
  'tongue': { name: 'Tongue posture', kind: 'habit', dose: 'All day', art: 'tongue', how: ['Rest your whole tongue on the roof of your mouth, tip just behind the front teeth.', 'Lips together, teeth lightly apart, breathe through your nose.', 'Check it whenever your phone buzzes.'], note: 'A habit for posture and nose breathing. It will not move bone in an adult.' },
  'chin-tuck': { name: 'Chin tucks', kind: 'hold', hold: 5, reps: 10, dose: '10 × 5 s', art: 'chinTuck', how: ['Sit or stand tall, eyes level.', 'Glide your chin straight back, as if making a double chin.', 'Hold for five seconds, then relax.'], note: 'Pulls a forward head back over the shoulders.' },
  'chew': { name: 'Chewing work', kind: 'minutes', min: 10, dose: '10 min', art: 'chew', how: ['Chew sugar-free gum or mastic.', 'Switch sides every two minutes.', 'Stop if your jaw clicks or aches.'], note: 'Can add a little muscle at the corners of the jaw.' },
  'neck-curl-bw': { name: 'Neck curls', kind: 'reps', reps: 15, sets: 3, dose: '3 × 15', img: 'neck-curl', fx: 80, how: ['Lie on your back, head on the floor.', 'Tuck your chin, then lift your head to look at your chest.', 'Lower slowly.'], note: 'Body weight first; the plate version comes in week 3.' },
  'lean': { name: 'Stay lean', kind: 'habit', dose: 'Fuel', art: 'lean', how: ['Fat under the chin hides the jaw line first.', 'Your plan is a slight calorie deficit with high protein, so you lose fat and keep muscle.', 'Protein high, calories steady: Fuel tracks both.'], note: 'The thing that moves the line under the jaw most.' },
  'ctar': { name: 'Chin tuck against resistance', kind: 'hold', hold: 5, reps: 10, dose: '10 × 5 s', art: 'ctar', how: ['Sit tall with a rolled towel or a soft ball under your chin.', 'Tuck your chin down into it and squeeze.', 'Hold for five seconds, then release.'], note: 'Works the muscles under the chin. Used in clinics for swallowing strength.' },
  'head-lift': { name: 'Head lift', kind: 'hold', hold: 30, reps: 3, dose: '3 × 30 s', art: 'headLift', how: ['Lie on your back, shoulders flat on the floor.', 'Lift only your head to look at your toes.', 'Hold, then lower slowly. Rest 30 s between.'], note: 'The same under-chin muscles, harder. Stop if it strains your neck.' },
  'neck-hold-fb': { name: 'Neck hold, front and back', kind: 'hold', hold: 10, reps: 5, dose: '5 × 10 s', img: 'neck-fb', fx: 50, how: M.EX['neck-fb'].how, note: M.EX['neck-fb'].cue },
  'neck-hold-side': { name: 'Neck hold, sides', kind: 'hold', hold: 10, reps: 6, dose: '3 × 10 s a side', img: 'neck-side', fx: 35, how: M.EX['neck-side'].how, note: M.EX['neck-side'].cue },
  'neck-plate': { name: 'Neck curl with a plate', kind: 'reps', reps: 12, sets: 3, dose: '3 × 12 · 2.5 kg', img: 'neck-curl', fx: 80, how: M.EX['neck-curl'].how, note: M.EX['neck-curl'].cue },
  'cleanse': { name: 'Cleanse', kind: 'habit', dose: 'AM + PM', art: 'bottle', how: ['Lukewarm water and a gentle cleanser for 30 seconds.', 'Pat dry. Twice a day, and after training.'], note: '' },
  'spf': { name: 'Sunscreen, SPF 50', kind: 'habit', dose: 'Every morning', art: 'sun', how: ['Two finger-lengths for face and neck.', 'Reapply if you are outside past noon.'], note: 'Prevents the dark spots that skin clarity counts.' },
  'bha': { name: 'Salicylic acid 2%', kind: 'habit', dose: 'Tue · Thu · Sat', art: 'drop', how: ['After cleansing, a few drops on dry skin.', 'Skip it if your skin stings; moisturise after.'], note: 'Clears pores. Three nights a week is enough.' },
  'moist': { name: 'Moisturiser', kind: 'habit', dose: 'AM + PM', art: 'bottle', how: ['A pea-sized amount on face and neck.'], note: '' },
};
export const PROGRAM_DEFS = [
  { id: 'hyoid', name: 'Hyoid and neck', days: 28, min: 10, items: ['ctar', 'head-lift', 'neck-hold-fb', 'neck-hold-side', 'neck-plate'],
    can: 'Stronger muscles under the chin and around the neck, a firmer jaw–neck line, better head posture.', cant: 'It will not move the hyoid bone or change your skeleton.',
    tip: 'Do it after the evening cleanse, before bed. It ticks the PM protocol item too.' },
  { id: 'jaw', name: 'Jawline', days: 28, min: 12, items: ['tongue', 'chin-tuck', 'chew', 'neck-curl-bw', 'lean'],
    can: 'A sharper line from the side: less forward head, a little more jaw muscle, and staying lean.', cant: 'Mewing and jaw tools will not reshape bone. Bone smashing injures it.',
    tip: 'Chin tucks fit into the morning; chewing work fits into the walk back from college.' },
  { id: 'skin', name: 'Clear skin', days: 56, min: 4, items: ['cleanse', 'spf', 'bha', 'moist'], weeks: true,
    can: 'Fewer spots and a more even tone, measured on your weekly scans.', cant: 'Scars and pores you were born with stay; this keeps new ones from forming.',
    tip: 'Salicylic acid is a Tuesday, Thursday and Saturday thing. Moisturise after.' },
];
export const program = (id) => B.programs.find((p) => p.id === id) ?? PROGRAM_DEFS.find((p) => p.id === id);
export const ARTICLES = [
  { id: 'jaw', title: 'What actually sharpens a jawline', min: 4, tag: 'Jawline', body: [
    'Three things decide how sharp your jaw looks from the side: how much fat sits under the chin, where your head sits on your neck, and the muscle you chew with.',
    'Fat comes first. A slight calorie deficit with high protein takes fat off while the gym keeps your muscle. Fuel tracks both.',
    'Posture is second. When your head drifts forward, the skin under the chin bunches and the angle between chin and neck opens up. Chin tucks and neck work pull it back, and your side scans measure it as the neck–chin angle.',
    'The masseter is third. Ten minutes of chewing work a day can add a little muscle at the corners of the jaw. Stop if your jaw clicks or aches.',
    'What does not work: mewing will not move bone in an adult, and bone smashing injures it. Your scans compare you with your own first scan, so you will see what really moves.'] },
  { id: 'tuck', title: 'Chin tucks: the two-minute posture fix', min: 2, tag: 'Posture', body: [
    'Most of us spend the day looking down at a phone or a laptop. The head drifts forward, and the neck holds it there.',
    'A chin tuck reverses it. Sit tall, keep your eyes level, and glide your chin straight back, as if you were making a double chin. Hold five seconds. Ten of those, morning and evening.',
    'The common mistake is nodding down instead of gliding back. Your eyes should stay on the horizon.',
    'Your side scans measure head posture as an angle. Around 50° and up is typical; it moves over weeks, not days.'] },
  { id: 'puff', title: 'Why some mornings your face looks puffy', min: 3, tag: 'Skin', body: [
    'Puffiness is mostly water. Salt, alcohol, a late heavy dinner and short sleep all make your face hold more of it overnight.',
    'Short sleep is the one most people miss. Compare your scans with your sleep in Recovery and you will usually see it.',
    'Drink water through the day, keep late dinners lighter on salt, and splash cold water in the morning. It fades by midday either way.'] },
  { id: 'spf', title: 'Sunscreen is most of skincare', min: 3, tag: 'Skin', body: [
    'In much of India the UV index sits at 7 to 9 most of the year. That sun causes most of the dark spots and uneven tone that make skin look tired.',
    'An SPF 50 with PA+++ every morning does more than any serum. Use two finger-lengths for face and neck, and reapply if you are out past noon.',
    'Give it eight weeks with salicylic acid three nights a week, and judge it on your scans, not the mirror.'] },
  { id: 'hyoid', title: 'Hyoid training: what it can and cannot do', min: 3, tag: 'Neck', body: [
    'The hyoid is a small bone at the top of your neck, held in place by muscles above and below it.',
    'Training the muscles above it, with head lifts and chin tucks against resistance, is how clinics rebuild swallowing strength. For you it firms the area under the chin and supports better head posture.',
    'What it cannot do is move the bone or change your skeleton. Claims of a "lifted hyoid" in a few weeks are not backed by evidence.',
    'Ten minutes a day, four weeks, and judge it on your side scans.'] },
  { id: 'skip', title: 'Skip these: bone smashing, mouth tape, jaw trainers', min: 2, tag: 'Safety', body: [
    'Bone smashing is tapping your face with hard objects to "remodel" bone. It causes bruising and injury and does not build bone.',
    'Heavy jaw trainers can strain the joint in front of your ear (the TMJ) and cause clicking and pain.',
    'Mouth taping at night is unproven and not safe if your nose blocks. Breathe through your nose by day instead.',
    'Crash diets lose muscle and dull your skin. Slow and steady keeps both.'] },
];
export const LESSONS = [
  { id: 'v1', title: 'Chin tucks, done right', len: '3:40', art: 'chinTuck', prog: 'jaw', how: 'chin-tuck' },
  { id: 'v2', title: 'Head lift for the neck, step by step', len: '4:15', art: 'headLift', prog: 'hyoid', how: 'head-lift' },
  { id: 'v3', title: 'Neck curls with a plate', len: '5:02', img: 'neck-curl', fx: 80, prog: 'hyoid', how: 'neck-plate' },
  { id: 'v4', title: 'A three-step night routine', len: '4:30', art: 'bottle', prog: 'skin', how: 'cleanse' },
  { id: 'v5', title: 'Tongue posture, without the hype', len: '6:10', art: 'tongue', prog: 'jaw', how: 'tongue' },
];
export const QUICK_FOODS = [
  { name: 'Whey shake with water', p: 24, kcal: 120, c: 3, f: 1.5, unit: '1 scoop', img: 'shake' },
  { name: 'Whey shake with milk', p: 32, kcal: 280, c: 15, f: 9.5, unit: '1 scoop + 1 glass', img: 'shake' },
  { name: 'Boiled eggs', p: 12, kcal: 156, c: 1, f: 10, unit: '2 eggs' },
  { name: 'Curd', p: 5, kcal: 110, c: 7, f: 6, unit: '1 katori' },
  { name: 'Greek yogurt', p: 15, kcal: 140, c: 6, f: 6, unit: '1 katori' },
  { name: 'Soya chunks', p: 26, kcal: 170, c: 16, f: 0.5, unit: '50 g dry' },
  { name: 'Paneer', p: 18, kcal: 265, c: 4, f: 20, unit: '100 g' },
  { name: 'Roasted chana', p: 8, kcal: 150, c: 22, f: 2.5, unit: '1 handful' },
  { name: 'Banana', p: 1, kcal: 105, c: 27, f: 0, unit: '1 medium' },
];
export const puffWord = (v) => (v < 45 ? 'Low' : v < 60 ? 'Medium' : 'High');

// ── start: demo seeds its story; every change rebuilds and the open Body sections redraw ──
if (DEMO_MODE) seedDemo(C);
let rb = 0;
onChange(() => { cancelAnimationFrame(rb); rb = requestAnimationFrame(rebuild); });
clock.onMinute?.(() => { if (clock.today() !== TODAY) rebuild(); });
ready.then(rebuild);
rebuild();

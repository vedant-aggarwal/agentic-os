// Body · the prototype's sample story (demo mode only: ?data=demo, the clock pinned to Thu 22 Oct 2026 17:40), written
// as the same docs the PC stores, so demo runs the real code path. Never shown in real mode. Owner: the Body agent.
import { EX } from './body-model.js';

const TODAY = '2026-10-22';
const D = (iso) => Date.parse(`${iso}T00:00:00Z`);
const daysBetween = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const addDays = (s, n) => new Date(D(s) + n * 864e5).toISOString().slice(0, 10);
const hm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;
const isoAt = (date, min) => new Date(D(date) - 330 * 60000 + min * 60000).toISOString();
const SPLITS = {
  push: { name: 'Push', items: ['bench', 'ohp', 'incline-db', 'lat-raise', 'cable-fly', 'pushdown'] },
  pull: { name: 'Pull', items: ['pulldown', 'cable-row', 'face-pull', 'curl', 'hammer'] },
  legs: { name: 'Legs', items: ['squat', 'rdl', 'leg-press', 'calf', 'hlr'] },
  upper: { name: 'Upper', items: ['bench', 'row', 'incline-db', 'pulldown', 'lat-raise', 'curl'] },
  core: { name: 'Cardio + core', items: ['walk', 'hlr', 'cable-crunch', 'plank', 'dead-bug'] },
};
const PLAN = [
  ['2026-08-24', 'push', 390, 64, 118], ['2026-08-26', 'pull', 395, 50, 112], ['2026-08-28', 'legs', 390, 55, 121],
  ['2026-09-01', 'push', 400, 66, 117], ['2026-09-04', 'legs', 392, 57, 122],
  ['2026-09-07', 'push', 390, 65, 119], ['2026-09-08', 'pull', 388, 51, 113], ['2026-09-10', 'legs', 393, 58, 123], ['2026-09-12', 'upper', 480, 70, 118],
  ['2026-09-14', 'pull', 390, 52, 112], ['2026-09-16', 'legs', 395, 56, 121], ['2026-09-18', 'push', 391, 67, 118],
  ['2026-09-21', 'pull', 390, 52, 113], ['2026-09-22', 'legs', 392, 59, 124], ['2026-09-24', 'push', 390, 68, 119], ['2026-09-26', 'upper', 485, 71, 117],
  ['2026-09-28', 'pull', 389, 51, 112], ['2026-09-29', 'legs', 391, 58, 123], ['2026-10-01', 'push', 390, 66, 120], ['2026-10-03', 'upper', 482, 74, 119],
  ['2026-10-05', 'pull', 390, 53, 114], ['2026-10-06', 'legs', 393, 57, 122], ['2026-10-07', 'core', 1140, 42, 129], ['2026-10-08', 'push', 391, 68, 120], ['2026-10-10', 'upper', 480, 72, 118],
  ['2026-10-12', 'pull', 390, 52, 113], ['2026-10-13', 'legs', 392, 59, 124], ['2026-10-15', 'push', 390, 67, 121], ['2026-10-15', 'core', 1142, 44, 130], ['2026-10-17', 'upper', 484, 73, 119],
  ['2026-10-19', 'pull', 390, 52, 114], ['2026-10-20', 'legs', 395, 58, 123], ['2026-10-22', 'push', 392, 69, 121],
];
const BENCH_TOP = {
  '2026-08-24': [37.5, 5], '2026-09-01': [37.5, 6], '2026-09-07': [40, 5], '2026-09-12': [40, 6], '2026-09-18': [40, 6], '2026-09-24': [42.5, 5],
  '2026-09-26': [42.5, 5], '2026-10-01': [42.5, 6], '2026-10-03': [42.5, 6], '2026-10-08': [42.5, 6], '2026-10-10': [45, 5], '2026-10-15': [45, 5],
  '2026-10-17': [45, 5], '2026-10-22': [45, 6],
};
const PROG = {
  ohp: [20, 25, 3, 8, 7], 'incline-db': [10, 14, 3, 10, 9], 'lat-raise': [5, 6, 3, 15, 15], 'cable-fly': [7.5, 10, 3, 12, 12], pushdown: [12.5, 17.5, 3, 12, 10],
  pulldown: [35, 47.5, 3, 10, 9], 'cable-row': [35, 45, 3, 10, 10], 'face-pull': [15, 20, 3, 15, 15], curl: [20, 25, 3, 10, 8], hammer: [8, 10, 3, 12, 11],
  squat: [45, 65, 3, 5, 5], rdl: [40, 60, 3, 8, 8], 'leg-press': [80, 120, 3, 12, 12], calf: [40, 60, 3, 15, 15], row: [35, 42.5, 3, 8, 8], 'cable-crunch': [17.5, 22.5, 3, 15, 15],
};
const T0 = '2026-08-24', span = daysBetween(T0, TODAY);
const snap = (v, step) => Math.round(v / step) * step;
function setsFor(exId, date, split) {
  const k = daysBetween(T0, date) / span;
  if (exId === 'bench') {
    const [w, r] = BENCH_TOP[date] ?? [40, 5];
    const sets = [{ w: 20, r: 10, warm: true }, { w: snap(w * 0.65, 2.5), r: 5, warm: true }];
    if (split === 'upper') sets.push({ w: w - 2.5, r: 5 }, { w: w - 2.5, r: 5 }, { w, r: Math.max(5, r - 1) }, { w: w - 2.5, r: 6 });
    else sets.push({ w: w - 2.5, r: 5 }, { w, r: 5 }, { w, r });
    if (date === '2026-10-03') sets.push({ w: 50, r: 1, single: true });
    return sets;
  }
  if (exId === 'walk') return [{ min: 20, km: +(1.7 + k * 0.2).toFixed(1) }];
  if (exId === 'hlr') { const r = Math.round(8 + k * 2); return [{ r }, { r }, { r: r - 1 }]; }
  if (exId === 'plank') { const t = Math.round((30 + k * 12) / 5) * 5; return [{ t }, { t }, { t: t - 5 }]; }
  if (exId === 'dead-bug') return [{ r: 10 }, { r: 10 }, { r: 10 }];
  const p = PROG[exId]; if (!p) return [];
  const w = snap(p[0] + (p[1] - p[0]) * k, EX[exId].step ?? 2.5);
  return Array.from({ length: p[2] }, (_, i) => ({ w, r: i === p[2] - 1 ? p[4] : p[3] }));
}
const item = (ex) => ({ ex, name: EX[ex].name, kind: EX[ex].kind, p: EX[ex].p, s: EX[ex].s });
const workouts = PLAN.map(([date, split, start, dur, bpm], i) => ({
  id: `s${i + 1}`, date, status: 'done', split, name: SPLITS[split].name, at: hm(start), started_at: isoAt(date, start), ended_at: isoAt(date, start + dur), dur, bpm,
  where: split === 'upper' ? 'Gym, Midtown · Saturday' : 'Gym, Midtown', kcal: Math.round(dur * (split === 'core' ? 7.4 : 5.6)), source: 'app', plan_by: 'wyn',
  items: SPLITS[split].items.map((ex) => ({ ...item(ex), sets: setsFor(ex, date, split).map((x) => ({ ...x, done: true })) })),
  ...(date === TODAY ? { zones: [8, 31, 22, 7, 1] } : {}),
}));
const planned = (id, date, at, split, name, dur, why, reasons, items) => ({ id, date, status: 'planned', split, name, at, dur, why, reasons, plan_by: 'wyn', source: 'wyn',
  items: items.map(([ex, target, sets, note]) => ({ ...item(ex), target, note, sets: Array.from({ length: sets }, () => ({ ...target, done: false })) })) });
const plans = [
  planned('plan-2026-10-22', TODAY, '19:00', 'core', 'Cardio + core', 45, 'Chest is {chest} recovered after this morning, so tonight stays on core and an easy zone 2 walk.',
    ["Chest {chest}, shoulders {shoulders}, triceps {triceps}: still recovering from this morning's push.", 'Core is {abs} recovered: last trained on Tuesday.', 'Readiness is {readiness}. An easy walk helps, a hard run would not.', 'Saturday is upper, so tonight keeps your shoulders out of it.'],
    [['walk', { min: 20, km: 1.9 }, 1, 'Zone 2: 126–144 bpm. 10% incline, 5.5 km/h.'], ['hlr', { r: 12 }, 3, 'Last time 3 × 10. Aim for 12; slow on the way down.'], ['cable-crunch', { w: 25, r: 15 }, 3, 'Up from 22.5 kg. Hips stay still.'], ['plank', { t: 45 }, 3, 'Last time 40 s. Five more seconds a set.'], ['dead-bug', { r: 10 }, 3, 'Ten a side, slow.']]),
  planned('plan-2026-10-24', '2026-10-24', '08:00', 'upper', 'Upper', 70, 'Bench steps up to 47.5 kg. You did 45 kg for 6 today, which says you are ready.',
    ['Chest will be back to {2026-10-24 08:00:chest} by Saturday 08:00: enough for a heavy top set at moderate volume.', '45 kg × 6 today: the top set moves up 2.5 kg.', 'Back and biceps are fresh, so rows and pulldowns go heavier too.', 'This session makes it four days and keeps your streak.'],
    [['bench', { w: 47.5, r: 5 }, 4, 'Up from 45 kg. Two warm-up sets first: 20 × 10, 30 × 5.'], ['row', { w: 45, r: 8 }, 3, 'Up from 42.5 kg.'], ['incline-db', { w: 16, r: 10 }, 3, 'Up from 14 kg a hand.'], ['pulldown', { w: 47.5, r: 10 }, 3, 'Same weight, all ten reps.'], ['lat-raise', { w: 6, r: 15 }, 3, 'Slow, two seconds down.'], ['curl', { w: 25, r: 10 }, 3, 'Finish strict.']]),
];
const at = (hhmm) => isoAt(TODAY, +hhmm.slice(0, 2) * 60 + +hhmm.slice(3));
const meals = [
  { id: 'm1', at: at('07:50'), slot: 'post-workout', name: 'Whey shake with milk', how: 'From your message', source: 'wyn', img: 'shake', items: [{ name: 'Whey, 1 scoop', grams: 32, kcal: 120, protein: 24 }, { name: 'Milk, 1 glass', grams: 300, kcal: 210, protein: 10 }], kcal: 330, protein: 34, carbs: 20, fat: 9, fibre: 0 },
  { id: 'm2', at: at('08:40'), slot: 'breakfast', name: 'Aloo paratha with curd', how: 'Scanned', source: 'scan', img: 'paratha', items: [{ name: 'Aloo paratha, 1', grams: 130, kcal: 290, protein: 6 }, { name: 'Curd, 1 katori', grams: 150, kcal: 110, protein: 5 }], kcal: 400, protein: 11, carbs: 52, fat: 16, fibre: 4 },
  { id: 'm3', at: at('13:50'), slot: 'lunch', name: 'Rajma chawal', how: 'Scanned · City College canteen', source: 'scan', img: 'rajma', items: [{ name: 'Rajma, 1 katori', grams: 180, kcal: 250, protein: 10 }, { name: 'Rice, 1 plate', grams: 200, kcal: 260, protein: 4 }, { name: 'Salad', grams: 40, kcal: 10, protein: 0 }], kcal: 520, protein: 14, carbs: 88, fat: 10, fibre: 9 },
  { id: 'm4', at: at('16:45'), slot: 'snack', name: 'Chai and 2 rusks', how: 'From your message', source: 'wyn', img: 'chai', items: [{ name: 'Chai, 1 cup', grams: 150, kcal: 80, protein: 2 }, { name: 'Rusk, 2', grams: 30, kcal: 80, protein: 1 }], kcal: 160, protein: 3, carbs: 24, fat: 5, fibre: 1 },
  ...[['2026-10-19', 124], ['2026-10-20', 131], ['2026-10-21', 96]].map(([date, p], i) => ({ id: `mw${i}`, date, at: isoAt(date, 13 * 60), slot: 'lunch', name: 'Logged meals', source: 'app', kcal: 2300, protein: p, items: [] })),
].map((m) => ({ date: TODAY, ...m }));
const readings = [];
const R = (kind, date, value, extra = {}) => readings.push({ id: `${kind}:${date}`, kind, date, value, source: 'health', ...extra });
[71, 74, 69, 80, 83, 76, 72, 68, 79, 84, 81, 75, 73, 78].forEach((rd, i) => {
  const date = addDays(TODAY, i - 13);
  R('hrv', date, Math.round(48 + (rd - 66) * 0.7)); R('rhr', date, Math.round(66 - (rd - 66) * 0.35));
  R('sleep', date, date === TODAY ? 391 : Math.round(360 + (rd - 66) * 4), date === TODAY ? { inBed: 405, from: 23 * 60 + 15, to: 6 * 60, stages: [['a', 6], ['c', 28], ['d', 42], ['c', 34], ['r', 18], ['c', 40], ['d', 23], ['c', 30], ['r', 26], ['a', 4], ['c', 38], ['r', 22], ['c', 26], ['r', 22], ['c', 22], ['a', 4], ['c', 20]] } : {});
});
R('steps', TODAY, 6840); R('activeEnergy', TODAY, 512); R('vo2', TODAY, 41.2);
readings.push({ id: `water:${TODAY}`, kind: 'water', date: TODAY, value: 6, source: 'manual' });
const AM = [['a1', 'Water, 500 ml', '', null], ['a2', 'Gentle cleanser', '', null], ['a3', 'Moisturiser', '', null], ['a4', 'Sunscreen, SPF 50', 'UV index 7 in Delhi today', null], ['a5', 'Chin tucks, 10 × 5 s', '', 'jaw'], ['a6', '10 minutes of morning light', 'The walk to the gym counted', null]];
const PM = [['p1', 'Cleanse', 'After cardio: sweat and sunscreen off', null], ['p2', 'Salicylic acid 2%', 'Tue · Thu · Sat', null], ['p3', 'Moisturiser', 'A pea-sized amount', null], ['p4', 'Hyoid and neck, 10 min', 'The neck program', 'hyoid'], ['p5', 'Phone away, lights out by 22:45', 'Sleep shows on your face first', null]];
const protocol = [...AM.map((x, i) => ['am', ...x, i]), ...PM.map((x, i) => ['pm', ...x, 10 + i])].map(([half, id, text, meta, prog, ord]) => ({ id, half, text, meta, prog, ord, active: true, days: id === 'p2' ? [2, 4, 6] : null }));
const checks = [];
for (let d = 11; d >= 1; d--) { const date = addDays(TODAY, -d); for (const it of protocol) if (!it.days || it.days.includes(((new Date(D(date)).getUTCDay() + 6) % 7) + 1)) checks.push({ id: `${date}:${it.id}`, date, item: it.id, done: true }); }
['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].forEach((id, i) => checks.push({ id: `${TODAY}:${id}`, date: TODAY, item: id, done: true, at: at(['07:28', '07:50', '07:51', '07:52', '07:55', '07:58'][i]) }));
const progDays = { hyoid: [1, 2, 3, 4, 5, 6, 7, 8], jaw: [1, 2, 3, 4, 6, 7, 8], skin: Array.from({ length: 17 }, (_, i) => i + 1) };
const started = { hyoid: addDays(TODAY, -8), jaw: addDays(TODAY, -8), skin: addDays(TODAY, -17) };
for (const [p, days] of Object.entries(progDays)) for (const n of days) { const date = addDays(started[p], n - 1); checks.push({ id: `${date}:prog:${p}`, date, item: `prog:${p}`, done: true }); }
const programs = Object.entries(started).map(([id, s]) => ({ id, started: s, active: true }));
const scans = [
  { id: 'f1', date: '2026-09-20', angle: 'side', skin: 64, spots: 7, puff: 58, cm: 132, cva: 44, sym: 95 },
  { id: 'f2', date: '2026-09-27', angle: 'side', skin: 68, spots: 6, puff: 55, cm: 130, cva: 45, sym: 95 },
  { id: 'f3', date: '2026-10-04', angle: 'side', skin: 70, spots: 5, puff: 50, cm: 128, cva: 46, sym: 96 },
  { id: 'f4', date: '2026-10-11', angle: 'side', skin: 73, spots: 4, puff: 42, cm: 126, cva: 48, sym: 96 },
  { id: 'f5', date: '2026-10-18', angle: 'side', skin: 76, spots: 3, puff: 38, cm: 124, cva: 49, sym: 96 },
];
const settings = [
  { id: 'targets', days: 4, protein: 120, kcal: 2500, water: 12, pmDue: '22:30', lift: { ex: 'bench', kg: 60, by: '2026-12-31', single: 50 }, weight: null, call: '23:00' },
  { id: 'health', connected: true, synced_at: at('17:32') },
];
const wyn = [
  ['06:20', 'Planned the push day from recovery: chest and shoulders were fresh'], ['07:42', 'Saved the push day to Apple Health: 69 min, 386 kcal'], ['07:51', 'Logged your shake from the message "whey + milk"'],
  ['13:52', 'Logged rajma chawal from your photo'], ['17:20', 'Protein nudge: 62 of 120 g, with a plan for tonight'], ['17:30', "Planned tonight's cardio + core around your {chest} chest"],
];
export const DEMO_WYN = wyn;
export const DEMO_GAP = [
  { id: 'g1', at: '20:05', slot: 'After cardio', name: 'Whey shake with water', protein: 25, kcal: 130, carbs: 3, fat: 2, img: 'shake' },
  { id: 'g2', at: '20:30', slot: 'Dinner with Mom and Dad', name: 'Palak paneer, 2 roti, dal', protein: 30, kcal: 640, carbs: 62, fat: 28, img: 'paneer' },
  { id: 'g3', at: '21:30', slot: 'If you want it', name: 'A katori of curd', protein: 6, kcal: 110, carbs: 8, fat: 5 },
];
export const DEMO_PLATE = { kind: 'food', title: 'Palak paneer with 2 roti', fields: { name: 'Palak paneer with 2 roti', items: [{ name: 'Palak paneer', grams: 180, kcal: 330, protein: 21 }, { name: 'Roti, 2', grams: 80, kcal: 210, protein: 7 }, { name: 'Dal, 1 katori', grams: 150, kcal: 150, protein: 8 }], kcal: 690, protein: 36, carbs: 64, fat: 30 } };
/** Put the story into the (in-memory, demo) collections once. */
export function seedDemo(C) {
  const put = (col, docs) => docs.forEach((d) => C[col].put({ created_at: isoAt(d.date ?? TODAY, 0), updated_at: isoAt(d.date ?? TODAY, 60), ...d }, { touch: false }));
  put('workouts', [...workouts, ...plans]); put('meals', meals); put('readings', readings); put('protocol', protocol); put('checks', checks);
  put('programs', programs); put('scans', scans); put('settings', settings);
}

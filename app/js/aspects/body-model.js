// Body · the model: exercises, muscles, sets and records, recovery per muscle, readiness, the week, streaks, and the
// rules-based plan the agent (as PT) starts from. Pure: no DOM, no imports, times in milliseconds, days in IST. The app
// computes with it offline (body-data.js) and the PC's body module imports this same file for the agent's tools and
// the morning plan (server/modules/body.ts). Owner: the Body agent.
// Exercise frames: yuhonas/free-exercise-db (Unlicense); the curated 35 below have Body's own ids, how-tos and cues, and
// any of the library's 876 can be used by its id (items carry name, kind and muscles with them, so the model never
// needs the library loaded to read a logged session).

// ── time, in IST ──────────────────────────────────────────────────────
const IST = 330 * 60000;
export const istDay = (ms = Date.now()) => new Date(ms + IST).toISOString().slice(0, 10);
export const istMin = (ms = Date.now()) => { const d = new Date(ms + IST); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
export const dayMs = (iso, min = 0) => Date.parse(`${iso}T00:00:00Z`) - IST + min * 60000;   // that IST day at min minutes
export const addDays = (iso, n) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);
export const weekOf = (iso) => { const d = new Date(`${iso}T00:00:00Z`); return addDays(iso, -((d.getUTCDay() + 6) % 7)); };   // Monday
export const hmOf = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (iso) => `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]}`;
export const toMin = (hm) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(hm ?? '')); return m ? +m[1] * 60 + +m[2] : null; };

// ── muscle groups (the body map draws them; recovery is per group). big: recovers over ~4 days, small over ~3 ──
export const MUSCLES = {
  chest: { name: 'Chest', big: true }, shoulders: { name: 'Shoulders' }, triceps: { name: 'Triceps' }, biceps: { name: 'Biceps' },
  forearms: { name: 'Forearms' }, abs: { name: 'Abs' }, obliques: { name: 'Obliques' }, quads: { name: 'Quads', big: true },
  hamstrings: { name: 'Hamstrings', big: true }, glutes: { name: 'Glutes', big: true }, calves: { name: 'Calves' },
  adductors: { name: 'Adductors' }, traps: { name: 'Traps' }, upperback: { name: 'Upper back', big: true },
  lowerback: { name: 'Lower back', big: true }, neck: { name: 'Neck' },
};

// ── exercises. img: the frame pair in assets/body/ex (free-exercise-db, Unlicense); fx: where the subject sits (thumb crop)
// kind: weight (kg × reps) · bw (reps) · time (seconds) · cardio (minutes + km) · step: the weight increment
export const EX = {
  bench: { name: 'Bench press', img: 'bench', fx: 50, kind: 'weight', bar: 20, step: 2.5, equip: 'Barbell', p: ['chest'], s: ['shoulders', 'triceps'],
    how: ['Lie with your eyes under the bar, feet flat, shoulder blades pinched together.', 'Grip a little wider than your shoulders and unrack with straight arms.', 'Lower to the middle of your chest with elbows about 45° from your body.', 'Press up and slightly back until your arms are straight.'],
    cue: 'Touch the same spot every rep and keep your bum on the bench.' },
  ohp: { name: 'Overhead press', img: 'ohp', fx: 50, kind: 'weight', bar: 20, step: 2.5, equip: 'Barbell', p: ['shoulders'], s: ['triceps', 'traps'],
    how: ['Stand with the bar on your front shoulders, hands just outside them.', 'Squeeze your glutes and brace your stomach.', 'Press straight up, moving your head back so the bar passes your chin.', 'Lock out overhead with the bar over your mid-foot, then lower under control.'],
    cue: 'Ribs down. If your lower back arches, the weight is too heavy.' },
  'incline-db': { name: 'Incline dumbbell press', img: 'incline-db', fx: 65, kind: 'weight', step: 2, equip: 'Dumbbells', p: ['chest'], s: ['shoulders', 'triceps'],
    how: ['Set the bench to about 30°. Sit back with a dumbbell on each thigh.', 'Kick them up as you lie back and hold them over your chest.', 'Lower until the dumbbells sit beside your upper chest.', 'Press up and slightly in, without clanking them together.'],
    cue: 'Weight is per dumbbell. Slow on the way down.' },
  'lat-raise': { name: 'Lateral raise', img: 'lat-raise', fx: 35, kind: 'weight', step: 1, equip: 'Dumbbells', p: ['shoulders'], s: [],
    how: ['Stand tall with a light dumbbell in each hand at your sides.', 'With a soft bend in the elbows, raise your arms out to the side.', 'Stop at shoulder height, little fingers slightly up.', 'Lower slowly for about two seconds.'],
    cue: 'Lead with the elbows, not the hands. No swinging.' },
  'cable-fly': { name: 'Cable fly', img: 'cable-fly', fx: 50, kind: 'weight', step: 2.5, equip: 'Cable', p: ['chest'], s: ['shoulders'],
    how: ['Set both pulleys high. Take a handle in each hand and step forward.', 'With a slight bend in the elbows, bring your hands together in front of your hips.', 'Squeeze your chest for a second.', 'Open back out until you feel a stretch across the chest.'],
    cue: 'Arms stay in one shape; it is a hug, not a press.' },
  pushdown: { name: 'Triceps pushdown', img: 'pushdown', fx: 50, kind: 'weight', step: 2.5, equip: 'Cable', p: ['triceps'], s: [],
    how: ['Face a high pulley with a straight bar or rope.', 'Pin your elbows to your sides.', 'Push down until your arms are straight.', 'Let it come back up to about chest height, elbows still pinned.'],
    cue: 'Only your forearms move.' },
  'db-bench': { name: 'Dumbbell bench press', img: 'db-bench', fx: 65, kind: 'weight', step: 2, equip: 'Dumbbells', p: ['chest'], s: ['shoulders', 'triceps'],
    how: ['Lie flat with a dumbbell in each hand over your chest.', 'Lower them to the sides of your chest.', 'Press back up until your arms are straight.'], cue: 'Each side works alone, so a weak side cannot hide.' },
  pushup: { name: 'Push-up', img: 'pushup', fx: 65, kind: 'bw', equip: 'Body weight', p: ['chest'], s: ['shoulders', 'triceps', 'abs'],
    how: ['Hands under your shoulders, body in one straight line.', 'Lower until your chest is a fist from the floor.', 'Push back up without letting your hips sag.'], cue: 'Squeeze your glutes to keep the line.' },
  row: { name: 'Barbell row', img: 'row', fx: 80, kind: 'weight', bar: 20, step: 2.5, equip: 'Barbell', p: ['upperback'], s: ['biceps', 'shoulders', 'lowerback'],
    how: ['Hinge at the hips with a flat back, bar hanging at arm length.', 'Pull the bar to your lower ribs.', 'Squeeze your shoulder blades together, then lower.'], cue: 'Your torso stays still; if it bounces, go lighter.' },
  pulldown: { name: 'Lat pulldown', img: 'pulldown', fx: 80, kind: 'weight', step: 2.5, equip: 'Cable', p: ['upperback'], s: ['biceps', 'shoulders'],
    how: ['Sit with your thighs under the pads and take a wide grip.', 'Pull the bar to your upper chest, leaning back slightly.', 'Let it rise slowly until your arms are straight.'], cue: 'Think of pulling your elbows to your back pockets.' },
  'cable-row': { name: 'Seated cable row', img: 'cable-row', fx: 0, kind: 'weight', step: 2.5, equip: 'Cable', p: ['upperback'], s: ['biceps', 'lowerback'],
    how: ['Sit tall with your feet on the plate and knees soft.', 'Pull the handle to your stomach, chest up.', 'Reach forward slowly until your arms are straight.'], cue: 'No rocking. Chest up the whole set.' },
  'face-pull': { name: 'Face pull', img: 'face-pull', fx: 5, kind: 'weight', step: 2.5, equip: 'Cable', p: ['shoulders'], s: ['upperback', 'traps'],
    how: ['Set a rope at face height.', 'Pull it towards your forehead, hands ending beside your ears.', 'Pause, then return slowly.'], cue: 'Good for the posture you train in Looks.' },
  curl: { name: 'Barbell curl', img: 'curl', fx: 35, kind: 'weight', bar: 10, step: 2.5, equip: 'Barbell', p: ['biceps'], s: ['forearms'],
    how: ['Stand tall, bar at arm length, palms forward.', 'Curl it up without moving your elbows.', 'Lower slowly to straight arms.'], cue: 'If your back leans, it is too heavy.' },
  hammer: { name: 'Hammer curl', img: 'hammer', fx: 35, kind: 'weight', step: 1, equip: 'Dumbbells', p: ['biceps'], s: ['forearms'],
    how: ['Hold dumbbells at your sides, palms facing in.', 'Curl them up, palms still facing in.', 'Lower slowly.'], cue: 'Thumbs up the whole time.' },
  squat: { name: 'Back squat', img: 'squat', fx: 65, kind: 'weight', bar: 20, step: 2.5, equip: 'Barbell', p: ['quads'], s: ['glutes', 'hamstrings', 'lowerback'],
    how: ['Bar on your upper back, feet shoulder-width, toes slightly out.', 'Brace, then sit down between your heels.', 'Go until your hips are just below your knees.', 'Drive up through the whole foot.'], cue: 'Knees follow your toes.' },
  rdl: { name: 'Romanian deadlift', img: 'rdl', fx: 50, kind: 'weight', bar: 20, step: 2.5, equip: 'Barbell', p: ['hamstrings'], s: ['glutes', 'lowerback'],
    how: ['Stand holding the bar at your thighs, knees soft.', 'Push your hips back, sliding the bar down your legs.', 'Stop when your hamstrings are tight, back flat.', 'Squeeze your glutes to stand.'], cue: 'The bar stays on your legs.' },
  'leg-press': { name: 'Leg press', img: 'leg-press', fx: 80, kind: 'weight', step: 5, equip: 'Machine', p: ['quads'], s: ['glutes', 'hamstrings'],
    how: ['Feet shoulder-width in the middle of the plate.', 'Lower until your knees are near your chest.', 'Press back without locking your knees.'], cue: 'Lower back stays on the pad.' },
  calf: { name: 'Standing calf raise', img: 'calf', fx: 65, kind: 'weight', step: 5, equip: 'Machine', p: ['calves'], s: [],
    how: ['Balls of your feet on the step, heels hanging.', 'Rise as high as you can.', 'Lower until you feel a stretch.'], cue: 'Pause at the top.' },
  walk: { name: 'Incline walk', img: 'walk', fx: 100, kind: 'cardio', equip: 'Treadmill', p: ['quads'], s: ['calves', 'glutes', 'hamstrings'],
    how: ['Set the incline to 10% and the speed to about 5.5 km/h.', 'Walk tall without holding the rails.', 'Keep your heart rate in zone 2: you can talk, not sing.'], cue: 'Zone 2 is 126–144 bpm for you.' },
  bike: { name: 'Stationary bike', img: 'bike', fx: 35, kind: 'cardio', equip: 'Bike', p: ['quads'], s: ['calves', 'glutes', 'hamstrings'],
    how: ['Set the seat so your knee is slightly bent at the bottom.', 'Ride at a steady effort you could hold for an hour.'], cue: 'Easier on the knees than the treadmill.' },
  hlr: { name: 'Hanging leg raise', img: 'hlr', fx: 50, kind: 'bw', equip: 'Pull-up bar', p: ['abs'], s: ['obliques'],
    how: ['Hang from a bar with straight arms.', 'Raise your knees, then legs, by curling your pelvis up.', 'Lower slowly without swinging.'], cue: 'Lift with your abs, not a swing.' },
  'cable-crunch': { name: 'Cable crunch', img: 'cable-crunch', fx: 20, kind: 'weight', step: 2.5, equip: 'Cable', p: ['abs'], s: ['obliques'],
    how: ['Kneel below a high pulley holding the rope beside your head.', 'Hips stay still. Curl your chest towards your knees.', 'Squeeze, then return slowly.'], cue: 'Round your back; the hips do not move.' },
  plank: { name: 'Plank', img: 'plank', fx: 50, kind: 'time', equip: 'Body weight', p: ['abs'], s: ['obliques', 'shoulders'],
    how: ['Forearms under your shoulders, body in one line.', 'Squeeze your glutes and brace like you are about to be poked.', 'Breathe and hold.'], cue: 'Hips level with your shoulders.' },
  'dead-bug': { name: 'Dead bug', img: 'dead-bug', fx: 50, kind: 'bw', equip: 'Body weight', p: ['abs'], s: ['obliques'],
    how: ['Lie on your back, arms up, knees bent over your hips.', 'Lower one arm and the opposite leg towards the floor.', 'Keep your lower back pressed down, then switch.'], cue: 'Slow. Ten a side.' },
  'decline-crunch': { name: 'Decline crunch', img: 'decline-crunch', fx: 50, kind: 'bw', equip: 'Bench', p: ['abs'], s: [],
    how: ['Hook your feet on a decline bench.', 'Curl your chest up towards your knees.', 'Lower with control.'], cue: 'Hands by your ears, not pulling your neck.' },
  'ab-wheel': { name: 'Ab wheel rollout', img: 'ab-wheel', fx: 50, kind: 'bw', equip: 'Ab wheel', p: ['abs'], s: ['shoulders', 'upperback'],
    how: ['Kneel holding the wheel under your shoulders.', 'Roll forward as far as you can with a flat back.', 'Pull back with your abs.'], cue: 'Stop before your back sags.' },
  pallof: { name: 'Pallof press', img: 'pallof', fx: 100, kind: 'weight', step: 2.5, equip: 'Cable', p: ['obliques'], s: ['abs'],
    how: ['Stand side-on to a cable at chest height, handle at your chest.', 'Press it straight out and hold without rotating.', 'Bring it back, then switch sides.'], cue: 'The cable tries to twist you; do not let it.' },
  'knee-raise': { name: 'Knee raise', img: 'knee-raise', fx: 50, kind: 'bw', equip: 'Dip station', p: ['abs'], s: [],
    how: ['Support yourself on your forearms in the station.', 'Raise your knees to your chest.', 'Lower slowly.'], cue: 'Easier than hanging; good on a tired grip.' },
  'side-plank': { name: 'Side plank', img: 'side-plank', fx: 50, kind: 'time', equip: 'Body weight', p: ['obliques'], s: ['abs', 'shoulders'],
    how: ['Lie on your side on one forearm, feet stacked.', 'Lift your hips into one straight line.', 'Hold, then switch sides.'], cue: 'Push the floor away.' },
  'neck-fb': { name: 'Neck hold, front and back', img: 'neck-fb', fx: 50, kind: 'time', equip: 'Hands', p: ['neck'], s: [],
    how: ['Stand tall with your palms on your forehead.', 'Push your head forward into your hands without moving. Hold.', 'Hands behind your head: push back into them. Hold.'], cue: 'Gentle pressure, steady breathing.' },
  'neck-side': { name: 'Neck hold, sides', img: 'neck-side', fx: 35, kind: 'time', equip: 'Hands', p: ['neck'], s: [],
    how: ['Put your right hand on the right side of your head.', 'Push your head into it without moving. Hold.', 'Switch sides.'], cue: 'Ears stay over your shoulders.' },
  'neck-curl': { name: 'Neck curl with a plate', img: 'neck-curl', fx: 80, kind: 'weight', step: 1.25, equip: 'Plate', p: ['neck'], s: [],
    how: ['Lie face up on a bench with your head just off the end.', 'Hold a light plate on your forehead over a folded towel.', 'Curl your chin to your chest, then lower slowly.'], cue: 'Start at 2.5 kg. The neck adapts slowly.' },
};
export const ex = (id) => exInfo(id);

// his own additions (brain: dead hangs 3 × 60 s every session; legs day carries speed work), and what Apple Health brings
Object.assign(EX, {
  'dead-hang': { name: 'Dead hang', art: 'hang', kind: 'time', equip: 'Pull-up bar', p: ['forearms'], s: ['upperback', 'shoulders'],
    how: ['Grab a pull-up bar a little wider than your shoulders.', 'Let your body hang with straight arms, shoulders active, not shrugged.', 'Breathe and hold. Step down before your grip fails.'],
    cue: 'Your rule: 3 × 60 s every session. Build up in 10 s steps if 60 is too long.' },
  sprint: { name: 'Sprint intervals', art: 'sprint', kind: 'time', equip: 'Track or treadmill', p: ['quads'], s: ['hamstrings', 'glutes', 'calves'],
    how: ['Warm up with five minutes of easy jogging.', 'Run hard for the time set, about 85% of your top speed.', 'Walk back or rest a full minute between.'], cue: 'Speed work for legs day. Stop if a hamstring tugs.' },
  run: { name: 'Run', img: 'walk', fx: 100, kind: 'cardio', equip: 'Outdoor', p: ['quads'], s: ['calves', 'glutes', 'hamstrings'], how: ['From Apple Health.'], cue: '' },
  'hk-strength': { name: 'Strength workout', img: 'bench', fx: 50, kind: 'cardio', equip: 'Apple Watch', p: [], s: [], how: ['From Apple Health; log the sets here for recovery to count them.'], cue: '' },
  'hk-other': { name: 'Workout', img: 'walk', fx: 100, kind: 'cardio', equip: 'Apple Watch', p: [], s: ['quads'], how: ['From Apple Health.'], cue: '' },
});

// ── the library (free-exercise-db): the app hands in its cached copy, the PC its file. Lookups fall back gracefully ──
let LIBMAP = null;
export const setLibrary = (arr) => { LIBMAP = arr ? new Map(arr.map((e) => [e.id, e])) : null; };
export const libEx = (id) => LIBMAP?.get(id) ?? null;
export const libList = () => (LIBMAP ? [...LIBMAP.values()] : []);
export const LIB_IMG = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises';
/** Everything Body knows about an exercise id: curated first, then the library, then what the logged item carried. */
export function exInfo(id, item = null) {
  const e = EX[id];
  if (e) return { id, ...e };
  const l = libEx(id);
  if (l) return { id, name: l.name, kind: l.kind, equip: l.equip, p: l.p ?? [], s: l.s ?? [], how: l.how ?? [], cue: '', lib: l.img, step: l.equip === 'Dumbbells' ? 2 : 2.5, bar: l.equip === 'Barbell' ? 20 : undefined, level: l.level };
  return { id, name: item?.name ?? String(id).replace(/[_-]+/g, ' '), kind: item?.kind ?? 'weight', equip: item?.equip ?? '', p: item?.p ?? [], s: item?.s ?? [], how: [], cue: '', lib: item?.lib, step: 2.5 };
}
/** The fields a workout item carries so a session reads the same without the library loaded. */
export const itemOf = (id) => { const e = exInfo(id); return { ex: id, name: e.name, kind: e.kind, p: e.p, s: e.s, ...(e.lib ? { lib: e.lib } : {}) }; };
// exercises that can stand in for one another (same main muscle)
const SWAPS = { 'cable-crunch': ['decline-crunch', 'ab-wheel', 'pallof'], hlr: ['knee-raise', 'decline-crunch', 'ab-wheel'], plank: ['side-plank', 'ab-wheel', 'dead-bug'],
  'dead-bug': ['pallof', 'plank', 'side-plank'], walk: ['bike'], bike: ['walk'], bench: ['db-bench', 'pushup', 'incline-db'], 'incline-db': ['db-bench', 'pushup'], 'db-bench': ['bench', 'pushup'],
  ohp: ['lat-raise', 'face-pull'], row: ['cable-row', 'pulldown'], pulldown: ['cable-row', 'row'], 'cable-row': ['row', 'pulldown'], curl: ['hammer'], hammer: ['curl'],
  pushdown: ['pushup'], 'lat-raise': ['face-pull'], squat: ['leg-press'], 'leg-press': ['squat'], rdl: ['squat'], sprint: ['bike', 'walk'], 'dead-hang': ['hlr', 'knee-raise'] };
export function swapsFor(id, n = 3) {
  const e = exInfo(id); const main = e.p[0];
  const curated = SWAPS[id] ?? Object.keys(EX).filter((k) => k !== id && EX[k].p[0] === main && !k.startsWith('hk-'));
  const lib = main ? libList().filter((x) => x.id !== id && x.p[0] === main && x.kind === e.kind).sort((a, b) => (a.level === 'beginner' ? 0 : 1) - (b.level === 'beginner' ? 0 : 1)).map((x) => x.id) : [];
  return [...new Set([...curated, ...lib])].filter((k) => k !== id).slice(0, n);
}

// ── sets, volume, records ─────────────────────────────────────────────
export const e1rm = (w, r) => (r <= 1 ? w : w * (1 + r / 30));   // Epley
export const workSets = (it) => (it?.sets ?? []).filter((x) => !x.warm && x.done !== false);
export const setVol = (s) => (Number(s.w) || 0) * (Number(s.r) || 0);
export const sessionVolume = (s) => (s.items ?? []).reduce((a, it) => a + workSets(it).reduce((b, x) => b + setVol(x), 0), 0);
export const sessionSets = (s) => (s.items ?? []).reduce((a, it) => a + workSets(it).length, 0);
const scoreOf = (kind, x) => (kind === 'weight' ? e1rm(Number(x.w) || 0, Number(x.r) || 0) + (x.single ? 0.001 : 0) : kind === 'time' ? Number(x.t) || 0 : Number(x.r) || 0);
/** A session as the model reads it: start time in ms, items with kind and muscles. Accepts store docs and demo sessions. */
export function normalize(w) {
  const at = w.at ?? (Number.isFinite(w.start) ? hmOf(w.start) : null);
  const startMs = Date.parse(w.started_at ?? '') || (w.date ? dayMs(w.date, toMin(at) ?? 18 * 60) : 0);
  const items = (w.items ?? []).map((it) => { const e = exInfo(it.ex, it); return { ...it, name: it.name ?? e.name, kind: it.kind ?? e.kind, p: it.p ?? e.p, s: it.s ?? e.s, sets: (it.sets ?? []).map((x) => ({ ...x })) }; });
  return { ...w, status: w.status ?? 'done', at, start: toMin(at) ?? Math.round((startMs - dayMs(w.date ?? istDay(startMs))) / 60000), startMs, items };
}
/** Walk the log once, oldest first: mark each set that beat everything before it; one record per exercise per session. */
export function annotate(sessions) {
  const best = {};
  const done = sessions.filter((s) => s.status === 'done').sort((a, b) => a.startMs - b.startMs);
  for (const s of done) {
    s.records = [];
    for (const it of s.items) {
      if (it.kind === 'cardio') continue;
      for (const set of it.sets) {
        if (set.warm || set.done === false) continue;
        const score = scoreOf(it.kind, set); if (!score) continue;
        const b = best[it.ex];
        set.pr = !!(b && score > b.score + 1e-6);
        if (set.pr) s.records.push({ ex: it.ex, set: { ...set }, was: b.set });
        if (!b || score > b.score) best[it.ex] = { score, set: { ...set }, date: s.date, sid: s.id, kind: it.kind };
      }
    }
    const by = {}; s.records.forEach((r) => { by[r.ex] = r; }); s.records = Object.values(by);
  }
  return best;
}
/** The best set each session for an exercise: [{ date, sid, w, r, t, est }] */
export function trend(sessions, exId) {
  return sessions.filter((s) => s.status === 'done' && s.items.some((it) => it.ex === exId && workSets(it).length)).sort((a, b) => a.startMs - b.startMs).map((s) => {
    const it = s.items.find((x) => x.ex === exId); const sets = workSets(it).filter((x) => !x.single);
    const top = (sets.length ? sets : workSets(it)).reduce((a, x) => (scoreOf(it.kind, x) > scoreOf(it.kind, a) ? x : a));
    return { date: s.date, sid: s.id, ...top, est: it.kind === 'weight' ? e1rm(top.w, top.r) : null };
  });
}
/** Last time's working sets of an exercise, for the Previous column. */
export function previous(sessions, exId, beforeMs = Infinity) {
  const s = sessions.filter((x) => x.status === 'done' && x.startMs < beforeMs && x.items.some((it) => it.ex === exId && workSets(it).length)).sort((a, b) => b.startMs - a.startMs)[0];
  if (!s) return null;
  return { date: s.date, sid: s.id, sets: workSets(s.items.find((it) => it.ex === exId)).filter((x) => !x.single) };
}

// ── recovery: each set tires its muscles, which recover in a straight line over ~66 h (small) or ~90 h (big) ──
const LOAD_P = 0.07, LOAD_S = 0.025, TBIG = 90, TSMALL = 66, CAP = 0.92;
const cardioN = (it) => Math.max(1, Math.round(workSets(it).reduce((a, x) => a + (Number(x.min) || 0), 0) / 10));
/** fresh: { muscle: ISO }: he said it feels fresh, so work before that moment no longer counts for it. */
function load(sessions, at, fresh, only = null) {
  const f = {};
  for (const m of only ? [only] : Object.keys(MUSCLES)) f[m] = 0;
  const freshMs = Object.fromEntries(Object.entries(fresh ?? {}).map(([m, iso]) => [m, Date.parse(iso) || 0]));
  for (const s of sessions) {
    if (s.status !== 'done' || !s.startMs || s.startMs > at) continue;
    const h = (at - s.startMs) / 36e5; if (h > TBIG) continue;
    for (const it of s.items) {
      const k = it.kind === 'cardio' ? cardioN(it) : workSets(it).length; if (!k) continue;
      const add = (m, per) => { if (!(m in f) || (freshMs[m] && s.startMs <= freshMs[m])) return; const T = MUSCLES[m].big ? TBIG : TSMALL; f[m] += k * per * Math.max(0, 1 - h / T); };
      for (const m of it.p ?? []) add(m, LOAD_P);
      for (const m of it.s ?? []) add(m, LOAD_S);
    }
  }
  for (const m in f) f[m] = Math.min(CAP, f[m]);
  return f;
}
/** Fatigue 0..0.92 per muscle at nowMs (+ hours ahead). */
export const fatigueAt = (sessions, nowMs, { hours = 0, fresh = null } = {}) => load(sessions, nowMs + hours * 36e5, fresh);
export const pctOf = (f, m) => Math.round((1 - (f[m] ?? 0)) * 100);
/** Hours until a muscle is back to pct% (70% is ready to train hard again). */
export function readyIn(sessions, m, nowMs, { pct = 70, fresh = null } = {}) {
  for (let h = 0; h <= 168; h += 1) if ((1 - load(sessions, nowMs + h * 36e5, fresh, m)[m]) * 100 >= pct) return h;
  return 168;
}
/** Recovered % of one muscle at each step from -lookback to +ahead hours. */
export function recoveryCurve(sessions, m, nowMs, { lookback = 144, ahead = 72, step = 3, fresh = null } = {}) {
  const pts = [];
  for (let h = -lookback; h <= ahead; h += step) pts.push({ h, v: Math.round((1 - load(sessions, nowMs + h * 36e5, fresh, m)[m]) * 100) });
  return pts;
}

// ── readiness: Oura-style contributors from what Apple Health (or he) gave, plus training load and muscles ──
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function series(readings, kind, today, days = 15) {
  const from = addDays(today, -days);
  return readings.filter((r) => r.kind === kind && r.date >= from && r.date <= today && Number.isFinite(Number(r.value))).sort((a, b) => a.date.localeCompare(b.date));
}
/** Weight is a trend over months, so it keeps every reading. */
export function weightTrail(readings) { return readings.filter((r) => r.kind === 'weight' && Number.isFinite(Number(r.value))).sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ date: r.date, v: Number(r.value), source: r.source })); }
export function readiness({ readings = [], sessions = [], nowMs = Date.now(), fresh = null, sleepGoal = 450 } = {}) {
  const today = istDay(nowMs);
  const out = { score: null, word: '', partial: true, parts: [], hrv: null, rhr: null, sleep: null, steps: null, active: null, weight: null, synced: null };
  const metric = (kind) => {
    const s = series(readings, kind, today); if (!s.length) return null;
    const last = s[s.length - 1]; if (daysBetween(last.date, today) > 2) return { now: null, avg: mean(s.map((x) => Number(x.value))), week: s.slice(-7).map((x) => Number(x.value)), date: last.date };
    const prev = s.slice(0, -1).map((x) => Number(x.value));
    return { now: Number(last.value), avg: prev.length >= 3 ? mean(prev) : null, week: s.slice(-7).map((x) => Number(x.value)), date: last.date, source: last.source };
  };
  out.hrv = metric('hrv'); out.rhr = metric('rhr');
  const sl = readings.filter((r) => r.kind === 'sleep' && (r.date === today || r.date === addDays(today, -1))).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (sl) out.sleep = { asleep: Math.round(Number(sl.value)), inBed: Math.round(Number(sl.inBed ?? sl.value)), from: sl.from ?? null, to: sl.to ?? null, stages: sl.stages ?? null, date: sl.date, goal: sleepGoal,
    week: series(readings, 'sleep', today, 8).map((x) => Math.round(Number(x.value) / 6) / 10), source: sl.source };
  const st = series(readings, 'steps', today, 1).find((r) => r.date === today); out.steps = st ? Math.round(Number(st.value)) : null;
  const ae = series(readings, 'activeEnergy', today, 1).find((r) => r.date === today); out.active = ae ? Math.round(Number(ae.value)) : null;
  const wt = weightTrail(readings); out.weight = wt.length ? { now: wt[wt.length - 1].v, date: wt[wt.length - 1].date, trail: wt } : null;
  out.synced = readings.filter((r) => r.source === 'health').map((r) => r.synced_at ?? r.updated_at).filter(Boolean).sort().pop() ?? null;
  // contributors
  const parts = [];
  if (out.hrv?.now != null && out.hrv.avg) { const d = out.hrv.now - out.hrv.avg; parts.push({ k: 'hrv', w: 0.25, name: 'Heart rate variability', v: `${Math.round(out.hrv.now)} ms`, p: clamp01(0.7 + (d / out.hrv.avg) * 2), note: `${d >= 0 ? '+' : ''}${Math.round(d)} ms on your normal` }); }
  if (out.rhr?.now != null && out.rhr.avg) { const d = out.rhr.avg - out.rhr.now; parts.push({ k: 'rhr', w: 0.2, name: 'Resting heart rate', v: `${Math.round(out.rhr.now)} bpm`, p: clamp01(0.7 + (d / out.rhr.avg) * 4), note: d >= 0 ? `${Math.round(d)} below your normal` : `${Math.round(-d)} above your normal` }); }
  if (out.sleep) { const short = sleepGoal - out.sleep.asleep; parts.push({ k: 'sleep', w: 0.3, name: 'Sleep', v: `${Math.floor(out.sleep.asleep / 60)} h ${String(out.sleep.asleep % 60).padStart(2, '0')} m`, p: clamp01(out.sleep.asleep / sleepGoal), note: short > 15 ? `${Math.round(short / 6) / 10} h short of ${Math.floor(sleepGoal / 60)} h ${sleepGoal % 60 ? `${sleepGoal % 60} m` : ''}`.trim() : 'Enough last night' }); }
  const sets7 = sessions.filter((s) => s.status === 'done' && s.startMs > nowMs - 7 * 864e5 && s.startMs <= nowMs).reduce((a, s) => a + sessionSets(s), 0);
  const sets28 = sessions.filter((s) => s.status === 'done' && s.startMs > nowMs - 28 * 864e5 && s.startMs <= nowMs).reduce((a, s) => a + sessionSets(s), 0);
  const avgW = sets28 / 4;
  if (sets28 - sets7 > 0) { const r = sets7 / Math.max(1, avgW); parts.push({ k: 'load', w: 0.1, name: 'Training load', v: r > 1.3 ? 'High' : r < 0.6 ? 'Low' : 'Steady', p: clamp01(1 - Math.abs(r - 1) * 0.6), note: `${sets7} sets this week against ${Math.round(avgW)} a week lately` }); }
  const f = fatigueAt(sessions, nowMs, { fresh }); const rec = Object.keys(MUSCLES).filter((m) => pctOf(f, m) < 70);
  parts.push({ k: 'muscle', w: 0.15, name: 'Muscles', v: rec.length ? `${rec.length} recovering` : 'All fresh', p: clamp01(1 - rec.length / 8), note: rec.length ? rec.slice(0, 3).map((m) => MUSCLES[m].name.toLowerCase()).join(', ') : 'Train anything', rec });
  for (const p of parts) p.word = p.p >= 0.7 ? 'Good' : p.p >= 0.45 ? (p.k === 'muscle' ? 'Recovering' : 'Fair') : 'Pay attention';
  const W = parts.reduce((a, p) => a + p.w, 0);
  // readiness needs his body's own signal (sleep or heart); training alone gives a training score, not a readiness
  out.partial = !parts.some((p) => p.k === 'hrv' || p.k === 'rhr' || p.k === 'sleep');
  out.trainingScore = Math.round(100 * parts.reduce((a, p) => a + p.w * p.p, 0) / W);
  out.score = out.partial ? null : out.trainingScore;
  out.word = out.score == null ? 'Needs sleep or heart data' : out.score >= 80 ? 'Ready to push' : out.score >= 65 ? 'Good to train' : out.score >= 50 ? 'Train light' : 'Rest or walk';
  out.parts = parts;
  return out;
}

// ── the week and its streak ───────────────────────────────────────────
export const trainedDays = (sessions, from, to) => new Set(sessions.filter((s) => s.status === 'done' && s.date >= from && s.date <= to).map((s) => s.date));
export function weekDays(sessions, plans, today) {
  const mon = weekOf(today);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(mon, i);
    return { d, ss: sessions.filter((s) => s.status === 'done' && s.date === d), missed: sessions.filter((s) => s.status === 'skipped' && s.date === d), plan: plans.find((p) => p.date === d && p.status !== 'done') ?? null, today: d === today, past: d < today };
  });
}
/** Full weeks in a row (before this one) that hit the target; this week counts once it has. */
export function weekStreak(sessions, today, target = 4) {
  let n = 0, w = addDays(weekOf(today), -7);
  for (let guard = 0; guard < 520; guard++) { if (trainedDays(sessions, w, addDays(w, 6)).size >= target) { n++; w = addDays(w, -7); } else break; }
  if (trainedDays(sessions, weekOf(today), today).size >= target) n++;
  return n;
}

// ── the protocol: AM and PM checklists. A day is complete when every item due that weekday is ticked ──
const isoWeekday = (iso) => { const d = new Date(`${iso}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
export const dueOn = (items, date) => items.filter((x) => x.active !== false && !x.deleted_at && (!Array.isArray(x.days) || !x.days.length || x.days.includes(isoWeekday(date))));
export function protocolDay(items, checks, date) {
  const due = dueOn(items, date); const done = new Set(checks.filter((c) => c.date === date && c.done).map((c) => c.item));
  const n = due.filter((x) => done.has(x.id)).length;
  return { due: due.length, done: n, complete: due.length > 0 && n === due.length, half: n > 0 && n < due.length, am: due.filter((x) => x.half === 'am').every((x) => done.has(x.id)), pm: due.filter((x) => x.half === 'pm').every((x) => done.has(x.id)) };
}
export function protocolStreak(items, checks, today) {
  if (!dueOn(items, today).length && !items.length) return { n: 0, today: false, week: [] };
  let n = 0; let d = addDays(today, -1);
  const first = checks.map((c) => c.date).sort()[0] ?? today;
  for (let guard = 0; guard < 3650 && d >= first; guard++) { const p = protocolDay(items, checks, d); if (p.complete) { n++; d = addDays(d, -1); } else if (!p.due) d = addDays(d, -1); else break; }
  const t = protocolDay(items, checks, today);
  const mon = weekOf(today);
  const week = Array.from({ length: 7 }, (_, i) => { const day = addDays(mon, i); const p = protocolDay(items, checks, day); return [day, day > today ? '' : p.complete ? 'done' : p.half || (p.done && !p.complete) ? 'half' : '']; });
  return { n: n + (t.complete ? 1 : 0), today: t.complete, kept: n, week };
}

// ── the plan: his rotation, recovery, and progressive overload (+2.5 kg or +1 rep when last time was all done) ──
// brain/body-baseline: a 6-day split (push / pull / legs + speed / active recovery / hypertrophy / athlete / rest), dead hangs every session
export const ROTATION = [
  { split: 'push', name: 'Push', items: [['bench', 4, 6], ['ohp', 3, 8], ['incline-db', 3, 10], ['lat-raise', 3, 15], ['pushdown', 3, 12], ['dead-hang', 3, 60]] },
  { split: 'pull', name: 'Pull', items: [['pulldown', 4, 8], ['cable-row', 3, 10], ['face-pull', 3, 15], ['curl', 3, 10], ['hammer', 3, 12], ['dead-hang', 3, 60]] },
  { split: 'legs', name: 'Legs + speed', items: [['squat', 4, 6], ['rdl', 3, 8], ['leg-press', 3, 12], ['calf', 3, 15], ['sprint', 6, 20], ['dead-hang', 3, 60]] },
  { split: 'recovery', name: 'Active recovery', items: [['walk', 1, 30], ['plank', 3, 45], ['dead-bug', 3, 10], ['side-plank', 2, 30], ['dead-hang', 3, 60]] },
  { split: 'hyper', name: 'Hypertrophy', items: [['db-bench', 3, 12], ['cable-row', 3, 12], ['incline-db', 3, 12], ['pulldown', 3, 12], ['lat-raise', 3, 15], ['curl', 3, 12], ['pushdown', 3, 12], ['dead-hang', 3, 60]] },
  { split: 'athlete', name: 'Athlete', items: [['squat', 3, 5], ['pushup', 3, 15], ['row', 3, 8], ['hlr', 3, 10], ['bike', 1, 15], ['dead-hang', 3, 60]] },
];
export const splitOf = (id) => ROTATION.find((r) => r.split === id) ?? null;
const snap = (v, step) => Math.round(v / step) * step;
/** Next time's target for one exercise from last time: all reps done → +step (his +2.5 kg rule); else the same. */
export function progression(sessions, exId, reps, beforeMs = Infinity) {
  const e = exInfo(exId); const prev = previous(sessions, exId, beforeMs);
  if (e.kind === 'cardio') { const last = prev?.sets?.[0]; return { target: { min: last?.min ? Math.max(last.min, reps) : reps, ...(last?.km ? { km: last.km } : {}) }, note: last ? `Last time ${last.min} min.` : 'Easy pace: you can talk, not sing.' }; }
  if (e.kind === 'time') { const top = prev ? Math.max(...prev.sets.map((x) => Number(x.t) || 0)) : 0; const t = top ? (prev.sets.every((x) => (Number(x.t) || 0) >= reps) ? Math.max(reps, top + 5) : Math.max(top, Math.min(reps, top + 5))) : reps; return { target: { t }, note: top ? `Last time ${top} s.` : (e.cue || '') }; }
  if (e.kind === 'bw') { const top = prev ? Math.max(...prev.sets.map((x) => Number(x.r) || 0)) : 0; return { target: { r: top ? top + (prev.sets.every((x) => (Number(x.r) || 0) >= top) ? 1 : 0) : reps }, note: top ? `Last time ${prev.sets.map((x) => x.r).join(', ')}. One more rep.` : '' }; }
  if (!prev) return { target: { w: null, r: reps }, note: 'First time: pick a weight you could lift 2 more times than this.' };
  const top = prev.sets.reduce((a, x) => ((Number(x.w) || 0) >= (Number(a.w) || 0) ? x : a), prev.sets[0]);
  const w = Number(top.w) || 0; const hit = prev.sets.filter((x) => (Number(x.w) || 0) === w).every((x) => (Number(x.r) || 0) >= reps);
  const step = e.step ?? 2.5;
  return hit ? { target: { w: snap(w + step, step), r: reps }, note: `Up from ${w} kg: you got all ${reps}s last time.` } : { target: { w, r: reps }, note: `Same ${w} kg. Last time ${prev.sets.map((x) => x.r).join(', ')}.` };
}
/** What to train on `date`: the next day of his rotation whose main muscles are ready, or active recovery. */
export function planNext({ sessions = [], nowMs = Date.now(), date = null, fresh = null, readinessScore = null, at = null } = {}) {
  const today = istDay(nowMs);
  const day = date ?? (sessions.some((s) => s.status === 'done' && s.date === today) ? addDays(today, 1) : today);
  const atMs = day === today ? nowMs : dayMs(day, toMin(at) ?? 7 * 60);
  const done = sessions.filter((s) => s.status === 'done' && s.startMs <= nowMs).sort((a, b) => b.startMs - a.startMs);
  const lastSplit = done.find((s) => splitOf(s.split))?.split ?? null;
  const start = lastSplit ? (ROTATION.findIndex((r) => r.split === lastSplit) + 1) % ROTATION.length : 0;
  const f = fatigueAt(sessions, atMs, { fresh });
  const mainOf = (r) => [...new Set(r.items.slice(0, 2).flatMap(([ex]) => exInfo(ex).p))];
  const ok = (r) => r.split === 'recovery' || mainOf(r).every((m) => pctOf(f, m) >= 70);
  let pick = null, skipped = [];
  for (let i = 0; i < ROTATION.length; i++) { const r = ROTATION[(start + i) % ROTATION.length]; if (ok(r)) { pick = r; break; } skipped.push(r); }
  if (readinessScore != null && readinessScore < 50) pick = splitOf('recovery');
  pick = pick ?? splitOf('recovery');
  // back after a long gap (his record: weeks off after late nights): one set less on each lift, same weights
  const gap = done.length ? daysBetween(done[0].date, day) : null;
  const ease = gap != null && gap > 14;
  const items = pick.items.map(([ex, sets, reps]) => { const g = progression(sessions, ex, reps, atMs); const k = exInfo(ex).kind; return { ...itemOf(ex), sets: ease && k !== 'cardio' && ex !== 'dead-hang' ? Math.max(2, sets - 1) : sets, target: g.target, note: g.note }; });
  const reasons = [];
  if (ease) reasons.push(`${gap} days since your last session (${done[0].name.toLowerCase()}, ${shortDay(done[0].date)}): today eases back in with one set less on each lift.`);
  const main = mainOf(pick);
  if (pick.split === 'recovery' && readinessScore != null && readinessScore < 50) reasons.push(`Readiness is ${readinessScore}: today is for moving, not loading.`);
  else if (main.length) reasons.push(`${main.map((m) => `${MUSCLES[m].name} ${pctOf(f, m)}%`).join(', ')} recovered: ready for ${pick.name.toLowerCase()}.`);
  if (skipped.length) reasons.push(`${skipped[0].name} waits: ${mainOf(skipped[0]).filter((m) => pctOf(f, m) < 70).map((m) => `${MUSCLES[m].name.toLowerCase()} is at ${pctOf(f, m)}%`).join(', ')}.`);
  if (lastSplit) reasons.push(`Last split day was ${splitOf(lastSplit).name.toLowerCase()}; ${pick.name.toLowerCase()} is next in your rotation.`);
  else reasons.push(done.length ? 'Your rotation starts at push from here.' : 'No session logged yet, so your rotation starts at push.');
  const up = items.filter((it) => it.kind === 'weight' && /^Up from/.test(it.note));
  if (up.length) reasons.push(`${up.map((it) => it.name).join(', ')} move up: you hit every rep last time.`);
  reasons.push('Dead hangs, 3 × 60 s, close every session, as you set.');
  const dur = Math.round(items.reduce((a, it) => a + (it.kind === 'cardio' ? (it.target.min ?? 20) : it.sets * (it.kind === 'time' ? 1.5 : 2.6)), 0) / 5) * 5;
  return { id: `auto-${day}`, date: day, status: 'planned', split: pick.split, name: pick.name, at, dur, why: reasons[0], reasons, items, plan_by: 'rules' };
}

// ── his targets until he changes them (Body → Targets). Each says where it came from; nothing here is a measurement ──
export const DEFAULT_TARGETS = {
  days: 6,            // brain/body-baseline: a 6-day split when training runs
  protein: 180,       // brain/body-baseline: minimum 180 g a day
  kcal: 2300,         // Wyn's day plan of 5 Sep (2,320 kcal), a slight deficit
  water: 12,          // glasses of 250 ml (3 L)
  sleep: 450,         // minutes asleep (7 h 30 m)
  pmDue: '22:30', amDue: '09:00',
  weight: { goal: 95, by: '2027-07-31' },   // brain/body-baseline: under 95 kg by July 2027
  lift: null,         // a strength goal he sets: { ex: 'bench', kg: 60, by: 'YYYY-MM-DD' }
};
export const TARGET_SOURCES = { days: 'your 6-day split', protein: 'your 180 g rule', kcal: "Wyn's plan of 5 Sep", weight: 'under 95 kg by July 2027' };
export const targetsOf = (doc) => ({ ...DEFAULT_TARGETS, ...Object.fromEntries(Object.entries(doc ?? {}).filter(([k, v]) => v !== undefined && !['id', 'created_at', 'updated_at', 'deleted_at'].includes(k))) });

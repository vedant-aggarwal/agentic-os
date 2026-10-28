// Body: the gym (the agent as personal trainer), recovery, the log, food, and looks. Owner: the Body agent.
// This file registers the app, its bus functions, links and native hooks; each section lives in its own module:
//   body-train.js  Train (home), workout preview, the live workout, the finish summary, an exercise, goals and targets
//   body-recovery.js  the muscle map, readiness from Apple Health, sleep, heart, a muscle's curve, readings by hand
//   body-log.js    weekly targets and streak, calendar, strength and volume, sessions and missed days, records
//   body-fuel.js   protein and calories, what to eat next, meals, water, scan results
//   body-looks.js  AM / PM protocols, face scans, programs, articles, guides
//   body-data.js (the state) · body-store.js (the collections) · body-model.js (the numbers, shared with the PC)
//   body-food.js (Indian portions) · body-native.js (Health, Live Activity, reminders, widgets) · body-demo.js · body-ui.js
// Data: /api/v1/mod/body/* (server/modules/body.ts), tables body_* (agentos/src/modules/body.ts).
// Exercise frames: yuhonas/free-exercise-db (Unlicense). Muscle map paths: react-native-body-highlighter (MIT).
import { on } from '../core.js';
import { I } from '../icons.js';
import { AGENT } from '../data.js';
import { provide, api } from '../bus.js';
import { registerAspect, openAspect } from '../aspects.js';
import { registerRoute } from '../svc/route.js';
import { B, onBody, TODAY, eaten, proteinLeft, next, trainedToday, whenOf } from './body-data.js';
import * as store from './body-store.js';
import { S, nav, refresh } from './body-state.js';
import { BI } from './body-ui.js';
import { renderTrain, startWorkout, openTools, daysThisWeek } from './body-train.js';
import { renderRecovery, onRecoveryShown } from './body-recovery.js';
import { renderLog } from './body-log.js';
import { renderFuel, logFood, openPlate } from './body-fuel.js';
import { renderLooks, handleFace, openLooksHalf } from './body-looks.js';
import { wireLive, scheduleReminder, shareStreak, syncHealth } from './body-native.js';

// the motion kit's number rolls need css/motion.css; until the shell links it (a request to the lead), link it once here
if (!document.querySelector('link[href$="css/motion.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/motion.css'; l.dataset.by = 'body'; document.head.append(l); }

// what she can do here (the PC's body module has the same tools: server/modules/body.ts)
const TOOLS = [
  { name: 'plan_workout', does: 'Plans each session as your PT from muscle recovery, readiness and your split', auto: true },
  { name: 'log_sets', does: 'Logs sets you tell her about to today\'s workout', auto: true },
  { name: 'swap_exercise', does: 'Swaps an exercise for one that works the same muscles when a machine is taken', auto: true },
  { name: 'log_meal', does: 'Logs a meal from a photo, a message or a voice note, with Indian portions', auto: true },
  { name: 'check_protocol', does: 'Ticks AM and PM protocol items you tell her about', auto: true },
  { name: 'set_protocol_reminder', does: 'Sets when your PM protocol is due, and nudges you once if it isn\'t done', auto: true },
  { name: 'log_reading', does: 'Logs your weight, sleep, steps or heart readings from what you say', auto: true },
  { name: 'mark_fresh', does: 'Marks a muscle recovered when you say it feels fresh', auto: true },
  { name: 'face_scans', does: 'Reads your face scans against your first one; never rates your face', auto: false },
];

// the open app's own section, so the frame's round button and the section stay in step
function go(sid) {
  if (S.app?.scroll && document.contains(S.app.scroll)) S.app.go(sid);
  else openAspect('body', sid);
}
const pmState = () => { const due = B.pm.filter((x) => x.due); return { all: due.length > 0 && due.every((x) => x.done), left: due.filter((x) => !x.done).length, n: due.length }; };

registerAspect({
  id: 'body',
  sections: [
    { id: 'train', label: 'Train', icon: I.dumbbell, render: (el) => renderTrain(el) },
    { id: 'recovery', label: 'Recovery', icon: BI.figure, render: (el) => renderRecovery(el) },
    { id: 'log', label: 'Log', icon: BI.history, render: (el) => renderLog(el) },
    { id: 'fuel', label: 'Fuel', icon: BI.fuel, render: (el) => renderFuel(el) },
    { id: 'looks', label: 'Looks', icon: BI.face, render: (el) => renderLooks(el) },
  ],
  start: 'train',
  primary: { label: 'Start workout', icon: BI.play, run: () => startWorkout(B.live?.id) },
  summary() {
    const t = eaten(); const left = proteinLeft(); const p = next(); const done = trainedToday(); const live = B.live; const pm = pmState();
    const food = left ? `${left} g protein to go` : 'protein covered';
    const plan = p ? `${p.name} ${whenOf(p.date, p.at).toLowerCase()}` : 'rest';
    return {
      line: live ? `${live.name} in progress · ${food}` : done.length ? `${done.map((s) => s.name).join(' and ')} done · ${food}` : `${plan} · ${food}`,
      metric: { v: left, unit: 'g', label: 'protein to go', p: Math.min(1, t.p / B.targets.protein) },
      today: [
        { id: 'bod-t1', text: live ? `${live.name}: in progress` : done.length ? `${done[0].name} done` : p && p.date === TODAY ? `${p.name}${p.at ? ` at ${p.at}` : ''}` : 'Rest day', done: done.length > 0, act: 'bod-start' },
        { id: 'bod-t2', text: left ? `Protein: ${left} g to go` : `Protein: ${B.targets.protein} g hit`, done: !left, act: 'bod-fuel' },
        ...(pm.n ? [{ id: 'bod-t3', text: `PM protocol by ${B.targets.pmDue}`, done: pm.all, act: 'bod-pm' }] : []),
      ],
      ...(B.items.length ? { streak: { n: B.proto.n, label: 'days of AM + PM protocol', atRisk: !B.proto.today && B.proto.kept > 0 } } : {}),
      next: live ? { at: '', text: live.name } : p ? { at: p.at ?? '', text: p.name } : undefined,
      quick: [{ label: 'Start workout', icon: BI.play, act: 'bod-start' }, { label: 'Log a meal', icon: I.camera, act: 'bod-log-food' }],
      readiness: B.health.score, week: { days: daysThisWeek(), target: B.targets.days },
    };
  },
  scan: [
    { kind: 'food', label: 'Food or a plate', hint: 'Logs the meal with protein and calories, in Indian portions', handle: (r) => { openAspect('body', 'fuel'); setTimeout(() => openPlate(r), 260); } },
    { kind: 'face', label: 'Your face, front or side', hint: 'Compares with your first scan: skin, puffiness, posture. Never a rating', handle: (r) => { openAspect('body', 'looks'); setTimeout(() => handleFace(r), 260); } },
  ],
  tools: TOOLS,
  onOpen(app) { S.app = app; store.loadLibrary(); syncHealth().catch(() => {}); },
  onSection(app, sid) { S.app = app; if (sid === 'recovery') onRecoveryShown(app.el('recovery')); },
});

// redraw what is built when his data changes (after a beat, so a ring or a roll can finish first)
let rt = 0;
onBody(() => {
  clearTimeout(rt); rt = setTimeout(() => refresh(), 320);
  const pm = pmState();
  scheduleReminder({ due: B.targets.pmDue, pmDone: pm.all, items: pm.left });
  shareStreak(() => (B.items.length ? { n: B.proto.n, today: B.proto.today, due: B.targets.pmDue, items: B.items.length } : null));
  document.dispatchEvent(new CustomEvent('aspect-summary', { detail: { id: 'body' } }));
});
wireLive(nav, () => B.live);
// for the checks and the console: the state, the store, the nav
window.__body = { B, store, nav };

// ── the bus: what other areas can ask Body for ─────────────────────────
provide('startWorkout', (id, o) => startWorkout(id ?? undefined, o));
provide('logFood', (prefill) => logFood(prefill));
provide('openLooks', () => go('looks'));
provide('openRecovery', () => go('recovery'));
provide('openBodyLog', () => go('log'));
provide('openFuel', () => go('fuel'));
provide('openSession', (id) => nav.openSession?.(id));
provide('openExercise', (id) => nav.openExercise?.(id));

// ── links: body/workout (Siri's Start workout, the Live Activity) is route.js's built-in, calling startWorkout;
//    these add the meal sheet and the protocol (the PM reminder opens body/looks through the aspect route) ──
registerRoute('body/meal', (L, ctx) => { ctx.after(() => logFood(L.query.get('text') ? { text: L.query.get('text') } : undefined)); }, { owner: false });
registerRoute('body/pm', (L, ctx) => { ctx.after(() => { openLooksHalf('pm'); go('looks'); }); });

// ── global acts (Home and Life may surface these) ──────────────────────
on('bod-go', (b) => go(b.dataset.s));
on('bod-fuel', () => go('fuel'));
on('bod-pm', () => { openLooksHalf('pm'); go('looks'); });
on('bod-log-food', () => logFood());
on('bod-tools', () => openTools(TOOLS));
on('bod-ask', () => api.askAgent('', { aspect: 'body' }));

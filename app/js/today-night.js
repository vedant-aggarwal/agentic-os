// The night. Sleep is a block on the calendar (Google's "Sleep", or the usual night the PC keeps in settings
// sleep.default): change one night (an event override, synced) or every night (PUT /settings/sleep, queued), with Undo.
// Open the night to plan work in its hours; a task that lands in sleep moves that night's sleep around it (bedtime later
// near the start of the night, the alarm earlier near its end), and up past bedtime one tap moves tonight's sleep.
import { $, esc, on, openSheet, closeSheet, toast, haptic, seg, wireSegs } from './core.js';
import { I } from './icons.js';
import * as clock from './svc/clock.js';
import { refresh } from './svc/sync.js';
import { onData, TASKS, EVENTS, boot } from './data.js';
import { roll, rollHTML } from './motion.js';
import { send, usualNight, allOn } from './today-data.js';
import { S, NOW, TODAY, REAL, hm, dur, addDays, day, nightOf, morningOf, changed, W, task, awakeThrough } from './today-state.js';

const nightLabel = (night) => (night === TODAY ? 'Tonight' : night === addDays(TODAY, -1) ? 'Last night' : night === addDays(TODAY, 1) ? 'Tomorrow night' : `${day(night).wdLong} night`);
const BED = [18 * 60, 30 * 60], WAKE = [26 * 60, 38 * 60];   // minutes from the night's date: 18:00 → 06:00, 02:00 → 14:00
const BED_PICKS = [1290, 1320, 1350, 1380, 1410, 1440, 1470, 1500, 1560], WAKE_PICKS = [1740, 1770, 1800, 1830, 1860, 1890, 1920, 1980];

// ── the sleep sheet: two steppers in 15-minute steps with quick picks, the total follows, Save moves the night ──
export function openSleep(night = null) {
  // which night: the one he is awake through, else tonight
  const aw = awakeThrough();
  const iso = night ?? (aw?.which === 'morning' ? addDays(TODAY, -1) : TODAY);
  const n = iso === addDays(TODAY, -1) ? (() => { const m = morningOf(TODAY); return m.ev ? { id: m.id, bed: m.bed + 1440, wake: m.wake + 1440, ev: m.ev } : nightOf(iso); })() : nightOf(iso);
  const st = { night: iso, id: n.id, bed: n.bed, wake: n.wake, was: { bed: n.bed, wake: n.wake }, every: !n.id };
  const el = openSheet({ cls: 'sl-sheet', title: 'Sleep', sub: `${nightLabel(iso)}, ${day(iso).wd} into ${day(addDays(iso, 1)).wd}`, body: '<div class="sl-body"></div>' });
  el._sl = st;
  drawSleep(el);
  haptic('selection');
  return el;
}
function drawSleep(el) {
  const st = el._sl; const len = st.wake - st.bed; const ok = len >= 120 && len <= 840;
  const picks = (list, k) => list.map((v) => `<button class="chip sm ${v === st[k] ? 'on' : ''}" data-act="t-sl-pick" data-k="${k}" data-v="${v}">${hm(v)}</button>`).join('');
  const stepper = (k, label) => `<div class="row sl-r"><div class="sl-top"><span class="rtitle">${label}</span><div class="stepper">
    <button class="chip" data-act="t-sl" data-k="${k}" data-d="-15" aria-label="${label} 15 minutes earlier">${I.minus}</button><b class="met" data-sl="${k}">${hm(st[k])}</b>
    <button class="chip" data-act="t-sl" data-k="${k}" data-d="15" aria-label="${label} 15 minutes later">${I.plus}</button></div></div><div class="ts-c sl-picks" data-scroll-x>${picks(k === 'bed' ? BED_PICKS : WAKE_PICKS, k)}</div></div>`;
  const body = $('.sl-body', el);
  const first = !body.firstChild;
  if (first) {
    body.innerHTML = `<div class="group sl-g">${stepper('bed', 'Bedtime')}${stepper('wake', 'Wake up')}</div>
      <p class="sl-total"><b class="met" data-sl="len">${rollHTML(Math.floor(len / 60))}<small>h</small> ${rollHTML(len % 60)}<small>m</small></b> <span class="sl-word">of sleep</span></p>
      <div class="pad">${st.id ? seg('sleepScope', [['tonight', `Just ${nightLabel(st.night).toLowerCase()}`], ['every', 'Every night']], st.every ? 'every' : 'tonight') : '<p class="hint">No sleep block on the calendar for this night: this sets your usual night.</p>'}
      <button class="btn primary block sl-save" data-act="t-sl-save">Save</button></div>`;
    wireSegs(el);
    $('[data-seg="sleepScope"]', el)?.addEventListener('change', (e) => { st.every = e.detail === 'every'; });
  } else {
    $('[data-sl="bed"]', el).textContent = hm(st.bed);
    $('[data-sl="wake"]', el).textContent = hm(st.wake);
    const rolls = el.querySelectorAll('[data-sl="len"] .mx-roll');
    if (rolls.length === 2) { roll(rolls[0], Math.floor(len / 60)); roll(rolls[1], len % 60); }
    el.querySelectorAll('.sl-picks .chip').forEach((c) => c.classList.toggle('on', Number(c.dataset.v) === st[c.dataset.k]));
  }
  const total = $('.sl-total', el);
  total.classList.toggle('short', !ok || len < 360);
  $('.sl-word', el).textContent = !ok ? (len < 120 ? 'is too short a night' : 'is too long a night') : len < 360 ? 'of sleep. A short night' : 'of sleep';
  $('.sl-save', el).disabled = !ok;
}
on('t-sl', (el) => {
  const sh = el.closest('.sheet'), st = sh._sl, k = el.dataset.k, [lo, hi] = k === 'bed' ? BED : WAKE;
  const v = st[k] + Number(el.dataset.d);
  if (v < lo || v > hi) { haptic('warning'); return; }
  st[k] = v; haptic('selection'); drawSleep(sh);
});
on('t-sl-pick', (el) => { const sh = el.closest('.sheet'), st = sh._sl; st[el.dataset.k] = Number(el.dataset.v); haptic('selection'); drawSleep(sh); });
on('t-sl-save', (el) => {
  const sh = el.closest('.sheet'), st = sh._sl;
  closeSheet(sh);
  if (st.bed === st.was.bed && st.wake === st.was.wake && !st.every) return;
  const label = `bed ${hm(st.bed)}, up ${hm(st.wake)}`;
  if (st.id) W.moveEvent(st.id, st.night, { start: st.bed, end: st.wake });
  haptic('success');
  if (!st.every) {
    toast(`${nightLabel(st.night)}: ${label}`, () => { W.moveEvent(st.id, st.night, { start: st.was.bed, end: st.was.wake }); });
    return;
  }
  const prev = REAL ? boot()?.sleep ?? null : null;
  if (REAL) { send('PUT', '/settings/sleep', { bed: hm(st.bed), wake: hm(st.wake) }, { key: 'sleep' }); setTimeout(() => refresh(true), 2500); }
  toast(`Every night: ${label}`, () => {
    if (st.id) W.moveEvent(st.id, st.night, { start: st.was.bed, end: st.was.wake });
    if (REAL) { send('PUT', '/settings/sleep', prev ?? { bed: null, wake: null }, { key: 'sleep' }); setTimeout(() => refresh(true), 2500); }
  });
});

// ── up past bedtime: one tap moves the night he is awake through to start soon, keeping its length ──
export function upLateCard() {
  const a = awakeThrough(); if (!a?.id) return '';
  const night = a.which === 'morning' ? addDays(TODAY, -1) : TODAY;
  const bed0 = a.which === 'morning' ? a.bed + 1440 : a.bed, wake0 = a.which === 'morning' ? a.wake + 1440 : a.wake;
  const nowRel = NOW + (night === TODAY ? 0 : 1440);
  const nb = Math.ceil((nowRel + 45) / 15) * 15, nw = nb + (wake0 - bed0);
  return `<div class="group td-late-night"><div class="row td-ln"><button class="td-ln-main" data-act="sleep" aria-label="Up past bedtime. Sleep was ${hm(bed0)} to ${hm(wake0)}. Change it"><span class="tile td-moon">${I.moon}</span><span class="rbody"><span class="rtitle">Up past bedtime</span><span class="rmeta num">Sleep was ${hm(bed0)}–${hm(wake0)}</span></span></button>
    <button class="btn sm primary td-ln-go" style="--c:var(--today-fill)" data-act="td-sleep-now" data-id="${esc(a.id)}" data-night="${night}" data-bed="${nb}" data-wake="${nw}" data-b0="${bed0}" data-w0="${wake0}">Sleep ${hm(nb)}</button></div></div>`;
}
on('td-sleep-now', (el) => {
  const { id, night } = el.dataset; const nb = Number(el.dataset.bed), nw = Number(el.dataset.wake), b0 = Number(el.dataset.b0), w0 = Number(el.dataset.w0);
  W.moveEvent(id, night, { start: nb, end: nw });
  haptic('success');
  toast(`Sleep moved to ${hm(nb)}`, () => W.moveEvent(id, night, { start: b0, end: w0 }));
});

// ── a task placed in sleep time moves that night's sleep around it ──
// Runs on every local change, so a drag, quick add, the task sheet and the agent's applied changes all count.
let placed = null;
const scheduledNow = () => new Map(TASKS.filter((t) => t.scheduled && t.status !== 'done' && t.status !== 'dropped').map((t) => [t.id, `${t.scheduled.start}|${t.scheduled.end ?? ''}`]));
const sleepEvents = () => {
  const out = new Map();
  for (const iso of [addDays(TODAY, -1), TODAY, addDays(TODAY, 1)]) for (const e of allOn(iso) ?? []) if (e.sleep && e.startIso && !out.has(e.id)) out.set(e.id, { ...e, date: iso });
  return [...out.values()];
};
function fitSleepAround() {
  const map = scheduledNow();
  const prev = placed; placed = map;
  if (!prev) return;
  for (const [id, key] of map) {
    if (prev.get(id) === key) continue;
    const t = task(id); if (!t?.scheduled) continue;
    const s = Date.parse(t.scheduled.start), e = t.scheduled.end ? Date.parse(t.scheduled.end) : s + 30 * 60000;
    const ev = sleepEvents().find((x) => Date.parse(x.startIso) < e && Date.parse(x.endIso) > s);
    if (!ev) continue;
    const bs = Date.parse(ev.startIso), be = Date.parse(ev.endIso);
    const late = s - bs <= be - e;
    const ns = late ? e : bs, ne = late ? be : s;
    if (ne - ns < 2 * 3600e3) { setTimeout(() => toast(`${t.title.split(':')[0].slice(0, 30)} sits in your sleep. Move sleep to fit both.`), 1600); continue; }
    const toM = (ms) => Math.round(clock.toMin(new Date(ms).toISOString(), ev.date));
    W.moveEvent(ev.id, ev.date, { start: toM(ns), end: toM(ne) });
    haptic('success');
    const night = clock.toMin(ev.startIso, ev.date) >= 720 ? ev.date : addDays(ev.date, -1);
    const msg = late ? `${nightLabel(night)}: bedtime moved to ${hm(clock.toMin(new Date(ns).toISOString(), night))}` : `${nightLabel(night)}: wake-up moved to ${hm(clock.toMin(new Date(ne).toISOString(), night))}`;
    setTimeout(() => toast(msg, () => W.moveEvent(ev.id, ev.date, { start: toM(bs), end: toM(be) })), 1600);
  }
}
if (REAL) {
  // what the PC sent is the baseline; only his own changes on this phone move sleep
  onData((why) => { if (why === 'local') fitSleepAround(); else if (why === 'server' || why === 'boot' || why === 'rename') placed = scheduledNow(); });
  placed = scheduledNow();
}
export const usualLabel = () => { const u = usualNight(); return `${hm(u.bed)}–${hm(u.wake)}`; };

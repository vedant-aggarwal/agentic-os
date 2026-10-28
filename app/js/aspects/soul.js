// Soul: doing what is right for you. Habits morning and evening, Clean (the quit tracker he named, behind Face ID),
// the blocker the agent runs in the hours his time slips, and his values in his own words. Real records (soul-store.js
// on /api/v1/mod/soul/*, offline first); ?data=demo seeds the same records from soul-data.js.
// Owner: the Soul agent. Files: this one, soul-ui.js (icons, state, clock), soul-store.js (data), soul-logic.js (rules,
// shared with the PC), soul-native.js (Face ID, Screen Time, reminders, widgets), soul-clean.js (Clean and the urge
// flow), soul-blocker.js (the blocker and the unlock talk), soul-data.js (demo sample); css/aspects/soul.css.
import { $, $$, esc, push, closeSheet, toast, on, onHold, closePeek, ring, setRing, haptic, seg, wireSegs } from '../core.js';
import { I } from '../icons.js';
import { registerAspect, aspHead } from '../aspects.js';
import { provide, api } from '../bus.js';
import { aspect } from '../data.js';
import { label as dayLabelOf } from '../svc/clock.js';
import { registerRoute } from '../svc/route.js';
import { stagger, rollHTML, roll, symbol } from '../motion.js';
import { MOODS, REFLECT_OPTS } from './soul-data.js';
import * as ST from './soul-store.js';
import { SI, S, who, hhmm, plural, adot, soulSheet, soulPeek } from './soul-ui.js';
import { renderClean, openSteady } from './soul-clean.js';
import { renderBlocker, openAsk, blockerLine, repaintBlocker, lockAppsLabel } from './soul-blocker.js';
import { startNative, enableReminders } from './soul-native.js';
import { native } from '../svc/native-plugins.js';

const H = (id) => ST.habit(id);
const PARTS = [['morning', 'Morning', 'Till 12:00'], ['evening', 'Evening', 'From 18:00']];
const doneN = () => ST.habits().filter((h) => h.done).length;
SI.ringCheck = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.6"/><path d="m8.4 12.3 2.5 2.5 4.8-5.2"/></svg>`;
SI.anchor = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5.4" r="2"/><path d="M12 7.4V20.5M8.2 11h7.6M4.6 13.6a7.4 7.4 0 0 0 14.8 0"/></svg>`;

// Open Soul at a section, or switch to it if Soul is already the page on top
export function goSoul(sec = 'today') {
  const top = $('#stack')?.lastElementChild;
  if (S.app?.page && top === S.app.page) { S.app.go(sec); return; }
  api.openAspect('soul', sec);
}

// ── habits ────────────────────────────────────────────────────────────────
const habitP = (h) => (h.done ? 1 : h.of ? Math.min(1, h.count / h.of) : 0);
function habitMeta(h) {
  const t = h.done ? (h.missed ? `Late · ${h.doneAt}` : h.doneAt ?? 'Done') : h.rested ? 'Rest day' : h.missed ? 'Missed' : h.of && h.count ? `${h.count} of ${h.of}` : h.at;
  return h.aspect ? `${adot(h.aspect)}${esc(t)}` : esc(t);   // the dot: this habit also lives in that app
}
// the agent's spark on a ring she or another app closed for him
const habitBadge = (h) => (h.done && h.by && h.by !== 'you' ? `<span class="sou-hab-b" aria-hidden="true">${I.sparkle}</span>` : '');
const habitState = (h) => (h.done ? `done${h.doneAt ? ` at ${h.doneAt}` : ''}` : h.rested ? 'rest day' : h.missed ? 'missed this morning' : h.of && h.count ? `${h.count} of ${h.of} ${h.unit ?? ''}` : `due ${h.at}`);
const tileHtml = (h) => `
  <button class="sou-hab${h.done ? ' on' : ''}${h.missed && !h.done ? ' miss' : ''}" data-act="sou-tick" data-id="${esc(h.id)}" aria-pressed="${h.done}" aria-label="${esc(h.title)}, ${esc(habitState(h))}">
    <span class="sou-hab-r">${ring(habitP(h), 'as', 58, 5, { inner: `<span class="sou-hab-g">${SI[h.icon] ?? SI.seedling}</span>` })}${habitBadge(h)}</span>
    <span class="sou-hab-t">${esc(h.label[0])}<br>${esc(h.label[1])}</span>
    <span class="sou-hab-m">${habitMeta(h)}</span>
  </button>`;

function partHead([id, label, when]) {
  const hs = ST.habits().filter((h) => h.part === id); const n = hs.filter((h) => h.done).length;
  return `<div class="sou-part" data-part="${id}"><span class="sou-part-l">${label}</span><span class="sou-part-m">${hs.length && n === hs.length ? `${I.check}${hs.length === 1 ? "Done" : `All ${hs.length} done`}` : `${n} of ${hs.length}`} · ${when}</span></div>`;
}
// the run that rides on today: said once, where he ticks
function riskHtml() {
  const h = ST.habits().find((x) => x.atRisk && !x.done); if (!h) return '';
  return `<button class="sou-risk" data-act="sou-habit" data-id="${esc(h.id)}"><span class="sou-risk-ic">${I.flame}</span><span class="sou-risk-t"><b>${plural(h.streak, 'day')} of “${esc(h.title)}”</b> ride on today. One miss is fine; this would be the second in a row.</span></button>`;
}
function habitsHtml() {
  const hs = ST.habits();
  if (!hs.length) return `
    <div class="sh"><h2>Habits</h2></div>
    <section class="sou-empty surface">
      <span class="sou-empty-ic">${SI.seedling}</span>
      <h3 class="headline">No habits yet</h3>
      <p class="sub">Pick two or three small ones, small enough for a bad day. Streaks here forgive one miss; only two in a row end a run.</p>
      <div class="sou-empty-a"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="sou-starters">Start with a few</button><button class="btn sm" data-act="sou-new-habit">${I.plus}New habit</button></div>
    </section>`;
  const parts = PARTS.filter((p) => hs.some((h) => h.part === p[0]));
  return `
  <div class="sh"><h2>Habits</h2><span class="sh-count sou-hcount">${doneN()} of ${hs.length}</span><button class="sh-act" data-act="sou-habits">All habits ${I.chevR}</button></div>
  <section class="sou-habits surface">${parts.map((p) => `${partHead(p)}<div class="sou-grid">${hs.filter((h) => h.part === p[0]).map(tileHtml).join('')}</div>`).join('')}<div class="sou-riskslot">${riskHtml()}</div></section>
  <p class="hint">Tap to tick. Hold for the streak and options.</p>`;
}
const dayRing = () => { const n = doneN(), t = ST.habits().length; return t ? ring(n / t, 'as', 56, 6, { id: 'sou-dayring', inner: `<b class="met sou-dr">${rollHTML(n)}<small>/${t}</small></b>`, label: `${n} of ${t} habits done today` }) : ''; };

// repaint one habit everywhere it shows (Today, the habits page), ring first so it draws from where it was
function paintHabit(h) {
  $$(`.sou-hab[data-id="${h.id}"]`).forEach((b) => {
    b.classList.toggle('on', h.done); b.classList.toggle('miss', !!h.missed && !h.done);
    b.setAttribute('aria-pressed', String(h.done)); b.setAttribute('aria-label', `${h.title}, ${habitState(h)}`);
    setRing($('.rg', b), habitP(h));
    $('.sou-hab-m', b).innerHTML = habitMeta(h);
    const r = $('.sou-hab-r', b); $('.sou-hab-b', r)?.remove(); r.insertAdjacentHTML('beforeend', habitBadge(h));
    if (h.done) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); symbol($('.sou-hab-g', b), 'bounce'); }
  });
  $$('.sou-hrow[data-id="' + h.id + '"]').forEach((row) => { $('.sou-hrow-m', row).innerHTML = habitRowMeta(h); });
  const n = doneN(); const t = ST.habits().length;
  $$('.sou-hcount').forEach((e) => { e.textContent = `${n} of ${t}`; });
  const dr = $('#sou-dayring');
  if (dr) { setRing(dr, n / t); roll($('.sou-dr', dr), n); dr.setAttribute('aria-label', `${n} of ${t} habits done today`); }
  $$('.sou-part').forEach((el) => { const p = PARTS.find((x) => x[0] === el.dataset.part); el.outerHTML = partHead(p); });
  $$('.sou-riskslot').forEach((el) => { el.innerHTML = riskHtml(); });
  const sub = S.app?.el('today') && $('.asp-head .sub', S.app.el('today'));
  if (sub) sub.textContent = todaySub();
}

export function tick(id, { quiet = false, done } = {}) {
  const before = H(id); if (!before) return;
  const h = ST.tickHabit(id, { done }); if (!h) return;
  haptic(h.done ? 10 : 6);
  paintHabit(h);
  const all = ST.habits();
  if (!h.done && !quiet) toast(`${h.title}: not done`, () => tick(id, { quiet: true, done: true }));
  else if (h.done && all.every((x) => x.done)) toast('Every habit closed today');
}
function rest(id) {
  const h = ST.tickHabit(id, { rest: true }); if (!h) return;
  paintHabit(h); toast(`Rest day for ${h.title.toLowerCase()}. The streak holds`, () => { ST.tickHabit(id, { done: false }); paintHabit(H(id)); });
}

function habitPeek(id) {
  const h = H(id); if (!h) return;
  S.peek = id;
  const missedLine = h.missed && !h.done ? `<p class="sub">Missed this morning${h.streak ? `, inside a ${h.streak}-day run` : ''}. One miss changes nothing. Just don't miss it twice.</p>` : h.why ? `<p class="sub">${esc(h.why)}</p>` : '';
  soulPeek(`<div class="sou-pk">
      <div class="sou-pk-h">${ring(habitP(h), 'as', 64, 6, { inner: `<span class="sou-hab-g">${SI[h.icon] ?? SI.seedling}</span>` })}
        <div class="sou-pk-t"><h3 class="headline">${esc(h.title)}</h3><p class="foot">${PARTS.find((p) => p[0] === h.part)[1]} · ${esc(h.at)}${h.aspect && aspect(h.aspect) ? ` · ${adot(h.aspect)} also in ${aspect(h.aspect).name}` : ''}</p></div></div>
      ${missedLine}
      ${h.how ? `<p class="foot sou-pk-how">${I.sparkle}<span>${esc(h.how)}</span></p>` : ''}
      <div class="sou-stats"><div><b class="met">${h.streak}</b><span>day streak</span></div><div><b class="met">${h.best}</b><span>best run</span></div><div><b class="met">${h.pct ?? '–'}${h.pct != null ? '<small>%</small>' : ''}</b><span>last 8 weeks</span></div></div>
      ${strip(h.hist.slice(-14), '2 weeks ago', 'Today')}
    </div>`, [
    [h.done ? 'Not done after all' : 'Mark done', I.check, 'sou-pk-tick'],
    ['Take a rest day', SI.moon, 'sou-pk-rest'],
    ...(h.aspect && aspect(h.aspect) ? [[`Open ${aspect(h.aspect).name}`, I.arrowR, 'sou-pk-app']] : []),
    ['Edit habit', I.edit, 'sou-pk-edit'],
  ]);
}
// a row of day marks: done, missed, rest, today
const strip = (str, l, r) => `<div class="sou-strip14"><div class="sou-dots">${str.split('').map((c) => `<i class="d${c === '.' ? 't' : c === '-' ? 'n' : c}"></i>`).join('')}</div><div class="sou-strip-x"><span>${l}</span><span>${r}</span></div></div>`;
on('sou-pk-tick', () => { closePeek(); if (S.peek) tick(S.peek); });
on('sou-pk-rest', () => { closePeek(); if (S.peek) rest(S.peek); });
on('sou-pk-app', () => { closePeek(); const h = H(S.peek); if (h?.aspect) api.openAspect(h.aspect, null, { back: 'Soul' }); });
on('sou-pk-edit', () => { closePeek(); editHabitSheet(S.peek); });

// ── her lock ask, here where it belongs (the feed and Home answer it through answerLockAsk) ──
function askHtml() {
  const a = ST.askToday(); if (!a) return '';
  const l = ST.locks().find((x) => x.id === a.lock);
  const apps = l ? lockAppsLabel(l) : (a.apps ?? []).join(', ') || 'Your apps';
  const win = l ? `${l.start}–${l.end}` : a.start ? `${a.start}–${a.end}` : '';
  if (a.state === 'yes') return `<section class="sou-ask surface is-set"><span class="sou-ask-ic">${I.lock}</span><div class="sou-ask-b"><p class="headline">${esc(apps)} locks ${esc(win)}</p><p class="sub">Ask ${esc(who())} if you need it in between.</p></div><button class="btn sm" data-act="sou-ask-undo" data-id="${esc(a.id)}">Undo</button></section>`;
  if (a.state === 'no') return `<section class="sou-ask surface is-set"><span class="sou-ask-ic">${SI.unlock}</span><div class="sou-ask-b"><p class="headline">Open today</p><p class="sub">No ${l ? esc(l.name.toLowerCase()) : 'lock'} today. ${esc(who())} asks again next time.</p></div><button class="btn sm" data-act="sou-lock-yes">Lock it</button></section>`;
  return `<section class="sou-ask surface" aria-label="${esc(who())} asks">
    <div class="sou-ask-k"><span class="sou-wyn">${I.sparkle}</span><span>${esc(who())} asks · ${hhmm(Date.parse(a.at ?? a.created_at))}</span><span class="dot" style="--c:var(--needs)" aria-label="Waiting on you"></span></div>
    <h3 class="headline">${esc(a.title)}</h3>
    ${a.text ? `<p class="sub">${esc(a.text)}</p>` : ''}
    <div class="sou-ask-acts"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="sou-lock-yes">Lock it</button><button class="btn sm" data-act="sou-lock-no">Not today</button><button class="sou-ask-why" data-act="sou-open-blocker">Why ${esc(win || 'now')} ${I.chevR}</button></div>
  </section>`;
}
export function paintAsk() {
  $$('.sou-askslot').forEach((s) => { s.innerHTML = askHtml(); });
  repaintBlocker();
}
function answer(yes) {
  const a = ST.answerAsk(yes); if (!a) return null;
  haptic(yes ? 10 : 6); paintAsk(); return a;
}
on('sou-lock-yes', () => { const a = answer(true); if (a) toast(`Locked as asked. ${who()} holds it`); });
on('sou-lock-no', () => { if (answer(false)) toast('Okay. It stays open'); });
on('sou-ask-undo', (el) => { ST.undoAnswer(el.dataset.id); paintAsk(); });
on('sou-open-blocker', () => goSoul('blocker'));

// ── check-in ──────────────────────────────────────────────────────────────
function checkHtml() {
  const list = ST.moodsToday();
  const sel = S.mood?.v;
  const earlier = list.filter((c) => c.id !== S.mood?.id).map((c) => `${hhmm(Date.parse(c.at))} ${MOODS[c.v - 1]?.label ?? ''}`).join(' · ');
  const apps = lockAppsLabel(ST.locks()[0]);
  const wyn = !sel || sel > 2 ? '' : S.mood.done
    ? `<div class="sou-ck-wyn">${I.check}<p><b>Done.</b> ${esc(apps)} is locked till ${hhmm(Date.parse(ST.nowLock()?.until ?? new Date().toISOString()))}.</p></div>`
    : `<div class="sou-ck-wyn">${I.sparkle}<p><b>${MOODS[sel - 1].label} at ${S.mood.at}.</b> Days like this are when the pull is strongest. I can lock ${esc(apps)} for an hour, or breathe with you for a minute.</p><div class="sou-ck-a"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="sou-ck-lock">Lock for an hour</button><button class="btn sm" data-act="sou-urge">Breathe</button></div></div>`;
  return `
    <div class="sh"><h2>Check in</h2></div>
    <section class="sou-check surface">
      <p class="sou-q">How are you, right now?</p>
      <div class="sou-moods" role="radiogroup" aria-label="How are you right now">${MOODS.map((m) => `<button class="sou-mood${sel === m.v ? ' on' : ''}" data-act="sou-mood" data-v="${m.v}" role="radio" aria-checked="${sel === m.v}">${SI.mood[m.v - 1]}<span>${m.label}</span></button>`).join('')}</div>
      <p class="sou-ck-f">${sel ? `Logged at ${S.mood.at}.${earlier ? ` Earlier: ${earlier}.` : ''}` : `${earlier ? `Earlier: ${earlier}. ` : ''}${esc(who())} times her nudges by this; it stays in Soul.`}</p>
      ${wyn}
    </section>`;
}
on('sou-mood', (el) => {
  const v = Number(el.dataset.v);
  const doc = ST.logMood(v);
  S.mood = { v, at: hhmm(Date.parse(doc.at)), id: doc.id }; haptic(6);
  $$('.sou-checkslot').forEach((slot) => { slot.innerHTML = checkHtml(); });
});
on('sou-ck-lock', () => {
  ST.lockFor(60, ST.locks()[0]?.apps ?? []); if (S.mood) S.mood.done = true; haptic(10);
  $$('.sou-checkslot').forEach((slot) => { slot.innerHTML = checkHtml(); });
  repaintBlocker();
});

// ── tonight's reflection: one value at a time, three answers each ─────────
function reflectHtml() {
  const vs = ST.values();
  if (!vs.length) return `<section class="sou-rf surface"><p class="sou-rf-w">Write down what doing right means to you, in two or three values. Each night, one tap per value: lived it, partly, or not today.</p><div class="sou-rf-opts"><button class="btn" data-act="sou-open-values">Write my values</button></div></section>`;
  const i = vs.findIndex((v) => v.tonight == null);
  if (i >= 0) {
    const v = vs[i];
    return `<section class="sou-rf surface" aria-live="polite">
      <div class="sou-rf-top"><span class="foot">Best at night, with your journal · ${i + 1} of ${vs.length}</span><span class="sou-rf-dots" aria-hidden="true">${vs.map((x, k) => `<i class="${x.tonight != null ? 'd' : k === i ? 'c' : ''}"></i>`).join('')}</span></div>
      <h3 class="title3">${esc(v.name)}</h3>
      ${v.words ? `<p class="sou-rf-w">${esc(v.words)}</p>` : ''}
      <div class="sou-rf-opts">${REFLECT_OPTS.map(([val, label]) => `<button class="btn" data-act="sou-rf" data-id="${esc(v.id)}" data-v="${val}">${label}</button>`).join('')}</div>
    </section>`;
  }
  const lived = vs.filter((x) => x.tonight === 2).length;
  return `<section class="sou-rf surface is-done" aria-live="polite">
    <div class="sou-rf-sum"><b class="met">${rollHTML(lived)}<small> of ${vs.length}</small></b><span>values lived today</span></div>
    <div class="sou-rf-list">${vs.map((v) => `<div class="sou-rf-row"><span class="sou-vmark v${v.tonight}" aria-hidden="true"></span><span class="sou-rf-n">${esc(v.name)}</span><span class="sou-rf-a">${REFLECT_OPTS.find((o) => o[0] === v.tonight)?.[1] ?? ''}</span></div>`).join('')}</div>
    <div class="sou-rf-acts"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="sou-rf-journal">${I.edit}Add to tonight's journal</button><button class="btn sm" data-act="sou-rf-redo">Redo</button></div>
  </section>`;
}
const paintReflect = () => $$('.sou-rfslot').forEach((s) => { s.innerHTML = reflectHtml(); stagger($$('.sou-rf-row', s), { y: 6, each: 50 }); });
on('sou-rf', (el) => { ST.reflect(el.dataset.id, Number(el.dataset.v)); haptic(6); paintReflect(); });
on('sou-rf-redo', () => { ST.unreflect(); paintReflect(); });
on('sou-rf-journal', () => {
  const words = ST.values().map((v) => `${v.name}: ${(REFLECT_OPTS.find((o) => o[0] === v.tonight)?.[1] ?? 'not answered').toLowerCase()}`).join('; ');
  api.writeJournal({ text: `Values today. ${words}.`, aspect: 'soul' });
});
on('sou-open-values', () => goSoul('values'));

// ── what the agent did in Soul today ─────────────────────────────────────
function wynHtml() {
  const rows = ST.agentToday(); if (!rows.length) return '';
  const icon = (r) => (r.kind === 'ask' ? I.lock : r.kind === 'talk' ? I.chat : I.check);
  return `
  <div class="sh"><h2>${esc(who())}, in Soul today</h2><button class="sh-act" data-act="sou-ask-wyn">Ask her ${I.chevR}</button></div>
  <div class="group sou-nlog">${rows.slice(0, 6).map((r) => `<div class="row ic"><span class="tile">${icon(r)}</span><span class="rbody"><span class="rtitle">${esc(r.title)}</span><span class="rmeta">${hhmm(Date.parse(r.at))} ${r.by && aspect(r.by) ? adot(r.by) : ''}<span class="ell">${esc(r.meta ?? '')}</span></span></span></div>`).join('')}</div>`;
}
on('sou-ask-wyn', () => api.askAgent('', { aspect: 'soul' }));

const todaySub = () => { const L = dayLabelOf(ST.today()); const hs = ST.habits(); const left = hs.length - doneN(); return `${L.weekday} ${L.day} ${L.month}${hs.length ? ` · ${left ? `${plural(left, 'habit')} left` : 'every habit done'}` : ''}`; };
function renderToday(el, app) {
  S.app = app;
  const first = !el.dataset.soulDrawn;
  el.innerHTML = aspHead(app, { title: 'Today', sub: todaySub(), right: dayRing() })
    + `<div class="sou-askslot">${askHtml()}</div>`
    + habitsHtml()
    + `<div class="sou-checkslot">${checkHtml()}</div>`
    + `<div class="sh"><h2>Did I live my values today?</h2></div><div class="sou-rfslot">${reflectHtml()}</div>`
    + wynHtml();
  if (!el._hold) { el._hold = true; onHold(el, '.sou-hab', (b) => habitPeek(b.dataset.id)); }
  if (first) { el.dataset.soulDrawn = '1'; stagger($$('.sou-hab', el), { y: 10, scale: 0.94, each: 35 }); }
}
on('sou-tick', (el) => tick(el.dataset.id));

// ── all habits, a level down ─────────────────────────────────────────────
function habitRowMeta(h) {
  return `${h.done ? `<span class="sou-ok">${I.check}Today</span>` : h.rested ? '<span>Rest day</span>' : h.missed ? '<span>Missed today</span>' : `<span>${esc(h.at)}</span>`}<span>·</span><span class="ell">${h.streak ? `${h.streak}-day run` : h.prev ? `was ${h.prev} days` : 'no run yet'}</span>`;
}
function openHabits() {
  push({
    title: 'Habits', back: 'Soul', aspect: 'soul', cls: 'asp-soul sou-page',
    render(sc) {
      const hs = ST.habits();
      sc.innerHTML = aspHead({ aspect: { name: 'Soul' } }, { title: 'Habits', sub: `${plural(hs.length, 'habit')} · ${doneN()} done today` })
        + PARTS.filter(([id]) => hs.some((h) => h.part === id)).map(([id, label, when]) => `<div class="sh"><h2>${label}</h2><span class="sh-count">${when}</span></div>
          <div class="group">${hs.filter((h) => h.part === id).map((h) => `
            <button class="row ic sou-hrow" data-act="sou-habit" data-id="${esc(h.id)}">
              <span class="tile asp-tile">${SI[h.icon] ?? SI.seedling}</span>
              <span class="rbody"><span class="rtitle">${esc(h.title)}</span><span class="rmeta sou-hrow-m">${habitRowMeta(h)}</span></span>
              <span class="sou-mini" aria-hidden="true">${h.hist.slice(-7).split('').map((c) => `<i class="d${c === '.' ? 't' : c === '-' ? 'n' : c}"></i>`).join('')}</span>${I.chevR}
            </button>`).join('')}</div>`).join('')
        + `<div class="group sou-addrow"><button class="row ic" data-act="sou-new-habit"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">New habit</span></span></button>${hs.length < 3 ? `<button class="row ic" data-act="sou-starters"><span class="tile">${SI.seedling}</span><span class="rbody"><span class="rtitle">Start with a few</span></span></button>` : ''}</div>
          <div class="sh"><h2>How streaks work here</h2></div>
          <div class="group sou-rules">
            <div class="row ic"><span class="tile">${SI.ringCheck}</span><span class="rbody"><span class="rtitle wrap">Miss once, nothing breaks</span><span class="rmeta sou-wrap">A streak only ends when you miss twice in a row.</span></span></div>
            <div class="row ic"><span class="tile">${SI.moon}</span><span class="rbody"><span class="rtitle wrap">Rest days keep it</span><span class="rmeta sou-wrap">Sick, travelling, a wedding: mark a rest day and the streak holds.</span></span></div>
            <div class="row ic"><span class="tile">${I.sparkle}</span><span class="rbody"><span class="rtitle wrap">${esc(who())} ticks what she can prove</span><span class="rmeta sou-wrap">Link a habit to Growth, Body or Mind and it ticks itself. No points, no badges to chase.</span></span></div>
          </div>`;
      stagger($$('.sou-hrow', sc), { y: 8, each: 30 });
    },
  });
}
on('sou-habits', () => openHabits());
on('sou-habit', (el) => habitSheet(el.dataset.id));

// 8 weeks as a calendar: one column per week, Monday on top
function habitSheet(id) {
  const h = H(id); if (!h) return;
  const dow = ((new Date(`${ST.today()}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;   // 1 Mon … 7 Sun
  const days = (h.hist.slice(-(49 + dow)) + 'f'.repeat(7 - dow)).split('');
  const cols = []; for (let w = 0; w < 8; w++) cols.push(days.slice(w * 7, w * 7 + 7));
  const linked = h.link ? `From ${h.link.split('/')[0][0].toUpperCase()}${h.link.split('/')[0].slice(1)}: ${{ 'growth/journal': 'a journal entry', 'body/workouts': 'a workout', 'mind/reading': 'a reading session' }[h.link] ?? 'a record'} ticks it` : null;
  soulSheet({
    title: esc(h.title), sub: `${PARTS.find((p) => p[0] === h.part)[1]} · ${esc(h.at)}`,
    body: `
      <div class="sou-stats sou-stats-sheet"><div><b class="met">${h.streak}</b><span>day streak</span></div><div><b class="met">${h.best}</b><span>best run</span></div><div><b class="met">${h.days8}</b><span>days in 8 weeks</span></div></div>
      <div class="sou-cal-w"><div class="sou-cal-d" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span>${d}</span>`).join('')}</div><div class="sou-cal" role="img" aria-label="The last eight weeks, one column a week">${cols.map((c) => `<div class="sou-cal-c">${c.map((x) => `<i class="d${x === '.' ? 't' : x === '-' ? 'n' : x}"></i>`).join('')}</div>`).join('')}</div></div>
      <div class="sou-cal-x"><span>8 weeks ago</span><span>This week</span></div>
      <div class="group">
        <div class="row ic"><span class="tile">${h.link ? I.sparkle : I.user}</span><span class="rbody"><span class="rtitle">${h.link ? `${esc(who())} ticks it` : 'You tick it'}</span><span class="rmeta"><span class="ell">${esc(linked ?? h.how ?? `Tap the ring in Soul, or tell ${who()}`)}</span></span></span></div>
        <button class="row ic" data-act="sou-remind" data-id="${esc(h.id)}" role="switch" aria-checked="${!!h.remind}"><span class="tile">${I.clock}</span><span class="rbody"><span class="rtitle">Reminder</span><span class="rmeta"><span class="ell">${parseTime(h.at) ? `10 minutes before ${esc(h.at)}, on this iPhone` : 'Give it a time to get a reminder'}</span></span></span><span class="switch${h.remind ? ' on' : ''}" aria-hidden="true"></span></button>
        ${h.aspect && aspect(h.aspect) ? `<button class="row ic" data-act="sou-pk-app"><span class="tile">${adot(h.aspect)}</span><span class="rbody"><span class="rtitle">Also in ${aspect(h.aspect).name}</span><span class="rmeta"><span class="ell">One habit, two places</span></span></span>${I.chevR}</button>` : ''}
      </div>
      ${h.why ? `<p class="hint">${esc(h.why)}</p>` : ''}
      <div class="sou-sheet-acts"><button class="btn" data-act="sou-sheet-rest">${SI.moon}Rest day</button><button class="btn" data-act="sou-sheet-tick">${h.done ? `${I.undo}Undo today` : `${I.check}Mark done`}</button><button class="btn" data-act="sou-sheet-edit">${I.edit}Edit</button></div>`,
  });
  S.peek = id;
}
const parseTime = (s) => /^\d{1,2}:\d{2}$/.test(String(s ?? ''));
on('sou-sheet-rest', (el) => { closeSheet(el.closest('.sheet')); if (S.peek) rest(S.peek); });
on('sou-sheet-tick', (el) => { closeSheet(el.closest('.sheet')); if (S.peek) tick(S.peek); });
on('sou-sheet-edit', (el) => { closeSheet(el.closest('.sheet')); setTimeout(() => editHabitSheet(S.peek), 220); });
on('sou-remind', async (el) => {
  const h = H(el.dataset.id); if (!h) return;
  const want = !h.remind;
  if (want && !parseTime(h.at)) { toast('Give the habit a time first'); return; }
  if (want && !native.available) { toast('Reminders come from the iPhone app'); }
  if (want && native.available && !(await enableReminders())) { toast('Notifications are off for Agentic OS in Settings'); return; }
  ST.updateHabit(h.id, { remind: want }); haptic(6);
  el.setAttribute('aria-checked', String(want)); $('.switch', el).classList.toggle('on', want);
});

// new habit and edit habit: one form
const LINKS = [['you', 'Me'], ['growth/journal', 'Growth: a journal entry'], ['body/workouts', 'Body: a workout'], ['mind/reading', 'Mind: reading']];
function habitForm(h = null) {
  const by = h?.link ?? 'you';
  return `
    <div class="sou-form">
      <label class="field"><input id="sou-nh-name" maxlength="60" placeholder="e.g. Ten push-ups after brushing" autocomplete="off" value="${esc(h?.title ?? '')}" /></label>
      <p class="sou-form-l">When</p>
      ${seg('sou-nh-part', [['morning', 'Morning'], ['evening', 'Evening']], h?.part ?? 'morning')}
      <p class="sou-form-l">At <span>optional, for the reminder</span></p>
      <label class="field"><input id="sou-nh-at" type="time" value="${parseTime(h?.at) ? esc(h.at.padStart(5, '0')) : ''}" /></label>
      <p class="sou-form-l">Who ticks it</p>
      <div class="chips" id="sou-nh-by">${LINKS.map(([v, l]) => `<button class="chip${v === by ? ' on' : ''}" data-act="sou-nh-by" data-v="${v}">${l}</button>`).join('')}</div>
      <p class="sou-form-l">Why <span>optional, in your words</span></p>
      <label class="field sou-ta"><textarea id="sou-nh-why" rows="2" maxlength="160" placeholder="What it gives you">${esc(h?.why ?? '')}</textarea></label>
    </div>`;
}
function readForm(sheet) {
  const title = $('#sou-nh-name', sheet).value.trim();
  const part = $('[data-seg="sou-nh-part"] [aria-selected="true"]', sheet)?.dataset.v ?? 'morning';
  const at = $('#sou-nh-at', sheet).value || null;
  const by = $('#sou-nh-by .chip.on', sheet)?.dataset.v ?? 'you';
  const why = $('#sou-nh-why', sheet).value.trim();
  const link = by === 'you' ? null : by;
  return { title, part, at, link, by: link ? 'wyn' : 'you', aspect: link ? link.split('/')[0] : null, why };
}
function newHabitSheet() {
  const el = soulSheet({ title: 'New habit', sub: 'Small enough to do on a bad day', body: `${habitForm()}<div class="sou-sheet-acts"><button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-nh-save">Add habit</button></div>` });
  setTimeout(() => $('#sou-nh-name', el)?.focus(), 420);
}
function editHabitSheet(id) {
  const h = H(id); if (!h) return;
  soulSheet({ title: 'Edit habit', sub: esc(h.title), body: `${habitForm(h)}<div class="sou-sheet-acts"><button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-eh-save" data-id="${esc(h.id)}">Save</button><button class="btn block" data-act="sou-eh-archive" data-id="${esc(h.id)}">Stop tracking it</button></div>` });
}
on('sou-new-habit', () => newHabitSheet());
on('sou-nh-by', (el) => { $$('.chip', el.parentElement).forEach((c) => c.classList.toggle('on', c === el)); });
on('sou-nh-save', (el) => {
  const sheet = el.closest('.sheet'); const f = readForm(sheet);
  if (!f.title) { $('#sou-nh-name', sheet).focus(); return; }
  ST.addHabit({ ...f, why: f.why || '' });
  closeSheet(sheet); refreshAll();
  toast(`${f.title}: added to ${f.part === 'morning' ? 'mornings' : 'evenings'}`);
});
on('sou-eh-save', (el) => {
  const sheet = el.closest('.sheet'); const f = readForm(sheet);
  if (!f.title) { $('#sou-nh-name', sheet).focus(); return; }
  ST.updateHabit(el.dataset.id, { ...f, label: undefined }); closeSheet(sheet); refreshAll(); toast('Habit saved');
});
on('sou-eh-archive', (el) => {
  const id = el.dataset.id; const h = H(id); ST.archiveHabit(id); closeSheet(el.closest('.sheet')); refreshAll();
  toast(`${h?.title ?? 'Habit'}: no longer tracked. Its record stays`, () => { ST.updateHabit(id, { archived: false }); refreshAll(); });
});

// starters: small, common habits he can pick; nothing about him is assumed, no history comes with them
const STARTERS = [
  ['Up by 06:30', 'morning', '06:30', 'sunrise'], ['No phone for the first 30 minutes', 'morning', null, 'phoneOff'], ['Morning workout', 'morning', '07:00', 'dumbbell', 'body/workouts'],
  ['Five quiet minutes', 'morning', null, 'lotus'], ['Phone-free dinner', 'evening', '20:30', 'dinner'], ['Read 20 pages', 'evening', '21:30', 'book', 'mind/reading'],
  ['Two lines in the journal', 'evening', '22:00', 'pen', 'growth/journal'], ['Phone out of the bedroom', 'evening', '22:45', 'moon'],
];
on('sou-starters', () => {
  const have = new Set(ST.habits().map((h) => h.title.toLowerCase()));
  soulSheet({
    title: 'Start with a few', sub: 'Pick two or three. You can change any of them later.',
    body: `<div class="chips pad sou-starters">${STARTERS.filter((s) => !have.has(s[0].toLowerCase())).map((s, i) => `<button class="chip" data-act="sou-chip" data-i="${STARTERS.indexOf(s)}">${esc(s[0])}</button>`).join('')}</div>
      <p class="hint">The ones with Growth, Body or Mind tick themselves when that app has a record.</p>
      <div class="sou-sheet-acts"><button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-starters-add">Add these</button></div>`,
  });
});
on('sou-starters-add', (el) => {
  const sheet = el.closest('.sheet');
  const picked = $$('.sou-starters .chip.on', sheet).map((c) => STARTERS[Number(c.dataset.i)]);
  if (!picked.length) { toast('Tap the ones you want'); return; }
  for (const [title, part, at, icon, link] of picked) { const d = ST.addHabit({ title, part, at, link: link ?? null, by: link ? 'wyn' : 'you', aspect: link ? link.split('/')[0] : null }); ST.updateHabit(d.id, { icon }); }
  closeSheet(sheet); refreshAll(); toast(`${plural(picked.length, 'habit')} added`);
});

// ── Values ────────────────────────────────────────────────────────────────
function renderValues(el, app) {
  const vs = ST.values();
  if (!vs.length) {
    el.innerHTML = aspHead(app, { title: 'Values', sub: 'What doing right means to me, in my own words' })
      + `<section class="sou-empty surface"><span class="sou-empty-ic">${SI.anchor}</span><h3 class="headline">Two or three values, in your words</h3>
        <p class="sub">What does doing right look like on a normal day? Each night, the reflection on Today asks about each one, and this page shows which ones you live.</p>
        <div class="sou-empty-a"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="sou-value-add">${I.plus}Add a value</button></div></section>`;
    return;
  }
  const answered = vs.flatMap((v) => v.week).filter((x) => x != null);
  const lived = answered.length ? Math.round((answered.filter((x) => x === 2).length / answered.length) * 100) : null;
  const rate = (v) => { const a = v.week.filter((x) => x != null); return a.length ? a.filter((x) => x === 2).length / a.length : null; };
  const rated = vs.filter((v) => rate(v) != null).sort((a, b) => rate(b) - rate(a));
  el.innerHTML = aspHead(app, { title: 'Values', sub: 'What doing right means to me, in my own words' })
    + `<section class="sou-vsum surface">
        <div class="sou-vsum-f"><b class="met">${lived == null ? '–' : `${rollHTML(lived)}<small>%</small>`}</b><span>${lived == null ? 'no nights answered yet' : 'of the nights you answered, lived'}</span></div>
        ${rated.length >= 2 ? `<dl class="sou-vsum-l"><div><dt>Steadiest</dt><dd>${esc(rated[0].name)}</dd></div><div><dt>Needs you</dt><dd>${esc(rated[rated.length - 1].name)}</dd></div></dl>` : ''}
      </section>`
    + vs.map((v) => {
      const a = v.week.filter((x) => x != null); const n = a.filter((x) => x === 2).length;
      const first = v.aspects.find((x) => aspect(x));
      return `<section class="sou-val surface">
        <button class="sou-val-h" data-act="sou-value-edit" data-id="${esc(v.id)}"><h3 class="headline">${esc(v.name)}</h3><span class="sou-val-n">${a.length ? `${n} of ${a.length} nights` : 'not answered yet'}</span></button>
        ${v.words ? `<p class="sou-val-w">${esc(v.words)}</p>` : ''}
        <div class="sou-vstrip" aria-label="Lived on ${n} of the last ${a.length} nights you answered">${v.week.map((x) => `<i class="sou-vmark ${x == null ? 'vn' : `v${x}`}"></i>`).join('')}<i class="sou-vmark ${v.tonight == null ? 'vt' : `v${v.tonight}`}" title="Tonight"></i></div>
        ${a.length >= 3 ? `<div class="sou-val-r">${I.sparkle}<p>${n / a.length >= 0.7 ? 'One of your steadiest.' : n / a.length >= 0.4 ? 'Lived about half the nights.' : 'The one that slips most right now.'} ${n} of the last ${a.length} nights.</p></div>` : ''}
        ${v.aspects.length ? `<div class="sou-val-f"><span class="sou-val-links">${v.aspects.filter((x) => aspect(x)).map((x) => `${adot(x)}${aspect(x).name}`).join('<span class="sep"></span>')}</span>${first ? `<button class="btn sm" data-act="sou-v-open" data-a="${first}">Open ${aspect(first).name}</button>` : ''}</div>` : ''}
      </section>`;
    }).join('')
    + `<div class="sou-vfoot"><button class="btn block tint" style="--c:var(--as-ink)" data-act="sou-reflect-now">Reflect on today</button>
        <button class="btn block" data-act="sou-value-add">${I.plus}Add a value</button></div>`;
  stagger($$('.sou-val', el), { y: 10, each: 50 });
}
on('sou-reflect-now', () => { goSoul('today'); requestAnimationFrame(() => { const c = S.app?.el('today') && $('.sou-rfslot', S.app.el('today')); if (c) S.app.scroll.scrollTo({ top: c.offsetTop - 160, behavior: 'smooth' }); }); });
const ASP = ['body', 'mind', 'mission', 'money', 'growth', 'family', 'romance', 'friends'];
function valueSheet(v = null) {
  soulSheet({ title: v ? 'Edit value' : 'A new value', sub: 'Say it the way you would say it to a friend',
    body: `<div class="sou-form"><label class="field"><input id="sou-v-name" maxlength="40" placeholder="The value, in two or three words" value="${esc(v?.name ?? '')}" /></label><label class="field sou-ta"><textarea id="sou-v-words" rows="3" maxlength="200" placeholder="What it looks like on a normal day">${esc(v?.words ?? '')}</textarea></label>
      <p class="sou-form-l">Where it shows <span>optional</span></p><div class="chips" id="sou-v-asp">${ASP.filter((a) => aspect(a)).map((a) => `<button class="chip${v?.aspects?.includes(a) ? ' on' : ''}" data-act="sou-chip" data-v="${a}">${aspect(a).name}</button>`).join('')}</div></div>
      <div class="sou-sheet-acts"><button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-v-save" data-id="${esc(v?.id ?? '')}">${v ? 'Save' : 'Add value'}</button>${v ? `<button class="btn block" data-act="sou-v-del" data-id="${esc(v.id)}">Remove it</button>` : ''}</div>` });
}
on('sou-value-add', () => valueSheet());
on('sou-value-edit', (el) => valueSheet(ST.values().find((v) => v.id === el.dataset.id)));
on('sou-v-save', (el) => {
  const sh = el.closest('.sheet'); const name = $('#sou-v-name', sh).value.trim();
  if (!name) { $('#sou-v-name', sh).focus(); return; }
  const f = { name, words: $('#sou-v-words', sh).value.trim(), aspects: $$('#sou-v-asp .chip.on', sh).map((c) => c.dataset.v) };
  if (el.dataset.id) ST.updateValue(el.dataset.id, f); else ST.addValue(f);
  closeSheet(sh); refreshAll(); toast(el.dataset.id ? 'Value saved' : `${name}: added`);
});
on('sou-v-del', (el) => { const id = el.dataset.id; ST.C.values.remove(id); closeSheet(el.closest('.sheet')); refreshAll(); toast('Value removed'); });
on('sou-v-open', (el) => api.openAspect(el.dataset.a, null, { back: 'Soul' }));

// ── keep every drawn section true to the records ─────────────────────────
function refreshAll() {
  const app = S.app; if (!app?.page?.isConnected) return;
  for (const s of app.def.sections) { const el = app.el(s.id); if (el?.dataset.built) { s.render(el, app); wireSegs(el); } }
}
ST.onChange((whys) => {
  // this phone's own writes are painted where they happen; records from the PC, a load or a new day redraw
  if ([...whys].some((w) => w !== 'local')) refreshAll();
  // Soul's numbers changed: Today and Life redraw its summary (the lead's shared event)
  document.dispatchEvent(new CustomEvent('aspect-summary', { detail: { id: 'soul' } }));
});

// ── the app ───────────────────────────────────────────────────────────────
registerAspect({
  id: 'soul',
  sections: [
    { id: 'today', label: 'Today', icon: SI.ringCheck, render: renderToday },
    { id: 'clean', label: 'Clean', icon: SI.seedling, render: renderClean },
    { id: 'blocker', label: 'Blocker', icon: I.shield, render: renderBlocker },
    { id: 'values', label: 'Values', icon: SI.anchor, render: renderValues },
  ],
  start: 'today',
  // the urge button: in the one moment it matters, it must be one tap from anywhere in Soul (see notes/soul.md)
  primary: { label: 'I have an urge', icon: SI.wind, run: () => openSteady() },
  summary() {
    const hs = ST.habits(); const n = doneN(); const left = hs.filter((h) => !h.done && !h.rested);
    const ct = ST.cleanText(); const hold = ST.holding()[0]; const nx = ST.nextWindow(); const a = ST.askToday();
    return {
      line: `${hs.length ? (left.length ? `${plural(left.length, 'habit')} left` : 'Every habit done') : 'No habits yet'} · ${blockerLine()}`,
      metric: hs.length ? { v: n, unit: `/${hs.length}`, label: 'habits done', p: n / hs.length } : null,
      today: left.filter((h) => !h.missed).slice(0, 3).map((h) => ({ id: `sou-${h.id}`, text: `${h.title} · ${h.at}`, done: false, act: 'sou-check' })),
      // Clean outside Soul: only "Day N", never what it is for
      ...(ct ? { streak: { n: Number(ct.slice(4)), label: 'Clean', text: ct, atRisk: false, private: true } } : {}),
      next: hold ? { at: hold.ends ?? '', text: `${lockAppsLabel(hold)} locked till ${hold.ends}` } : a?.state === 'pending' ? { at: '', text: a.title } : nx ? { at: nx.start, text: `${nx.name} locks` } : null,
      quick: [{ label: 'Habits', icon: SI.ringCheck, act: 'sou-open' }, { label: 'Urge', icon: SI.wind, act: 'sou-panic' }],
    };
  },
  tools: [
    { name: 'soul_check_habit', does: 'Ticks a habit when you tell her, or when Growth, Body or Mind proves it', auto: true },
    { name: 'soul_log_urge', does: 'Logs an urge you tell her about: when, where, how you felt, what came before', auto: true },
    { name: 'soul_propose_lock', does: 'Proposes a lock on an app for the hours your time slips, and asks before it starts', auto: false },
    { name: 'soul_answer_unlock', does: 'Hears your reason for opening a locked app and opens it for a set time, or holds the line, within your rules', auto: true },
    { name: 'soul_check_in', does: 'Logs how you say you feel, to time her nudges; it stays in Soul', auto: true },
    { name: 'soul_status', does: 'Reads Soul today; Clean only ever as “Day N”', auto: true },
  ],
  onOpen(app) { S.app = app; S.unlocked = false; S.arrived = false; },
  onSection(app, id) { if (id === 'clean' && !S.unlocked) app.refresh('clean'); },
});

// ── the bus: what other apps call ────────────────────────────────────────
provide('checkHabit', (id) => {
  const h = H(String(id ?? '').replace(/^sou-/, ''));
  if (!h) { goSoul('today'); return; }
  const open = !!S.app?.page?.isConnected;
  tick(h.id, { quiet: !open });
  const now = H(h.id);
  if (!open) toast(`${now.title}: ${now.done ? 'done' : 'not done'}`, () => tick(h.id, { quiet: true }));
});
provide('openQuit', () => goSoul('clean'));
provide('panic', () => openSteady());
provide('openBlocker', (o = {}) => { goSoul('blocker'); if (o?.ask) setTimeout(() => openAsk(), 450); });
provide('askUnlock', (app) => openAsk(app));
provide('openValues', () => goSoul('values'));
// Home, the agent's feed and the Yes/No card answer her lock ask here, so every screen agrees
provide('answerLockAsk', (yes = true) => { answer(!!yes); });
/** her open lock ask today, for Home and the feed: { id, title, text, state } or null */
provide('soulLockAsk', () => { const a = ST.askToday(); return a ? { id: a.id, title: a.title, text: a.text ?? null, state: a.state, at: a.at ?? a.created_at } : null; });
/** his latest check-in today (1–5) for the orb and her heartbeats; Soul keeps the rest */
provide('soulMood', () => { const m = ST.moodsToday().at(-1); return m ? { v: m.v, at: m.at } : null; });
provide('openHabits', () => openHabits());
on('sou-check', (el) => api.checkHabit(el.dataset.id));
on('sou-panic', () => openSteady());
on('sou-open', (el) => goSoul(el.dataset.s ?? 'today'));

// links: a widget's habit opens that habit (the shield's Ask is soul/blocker?ask=1, handled by openBlocker)
registerRoute('soul/habit', (L, ctx) => { if (!L.arg) return false; ctx.tab('life'); ctx.after(() => { goSoul('today'); setTimeout(() => habitSheet(L.arg), 420); }); }, { tab: 'life' });
globalThis.__soulAskUnlock = () => { goSoul('blocker'); setTimeout(() => openAsk(), 450); };
startNative();

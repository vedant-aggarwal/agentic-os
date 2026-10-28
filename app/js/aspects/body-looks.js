// Body · Looks: AM and PM protocols with a streak, the weekly face scan measured against his own first scan, programs
// (jawline, hyoid and neck, clear skin) he starts and keeps, short articles and step-by-step guides. Owner: the Body agent.
// Framing: progress and habits. No ratings, ranks or percentiles of his face. Photos stay on the phone; only the
// measurements are stored.
import { $, $$, esc, push, pop, on, openSheet, closeSheet, toast, haptic, ring, seg, wireSegs } from '../core.js';
import { I } from '../icons.js';
import { AGENT, DEMO_MODE } from '../data.js';
import { api, has } from '../bus.js';
import { native } from '../svc/native-plugins.js';
import { stagger } from '../motion.js';
import { B, LEX, PROGRAM_DEFS, program, ARTICLES, LESSONS, puffWord, dayLabel, dayShort, TODAY, daysBetween, addDays, weekday, clockNow, relDay } from './body-data.js';
import * as store from './body-store.js';
import { S, nav, refresh } from './body-state.js';
import { BI, art, thumb, demo, faceDiagram, spark, wyn, lineChart, wireScrub, clock } from './body-ui.js';
import { asDataUrl } from './body-fuel.js';

let half = null;   // the protocol half on screen: PM after 14:00, AM before
const halfNow = () => (Number(clockNow().slice(0, 2)) >= 14 ? 'pm' : 'am');
export function renderLooks(el) {
  half = half ?? halfNow();
  const list = half === 'am' ? B.am : B.pm; const dueList = list.filter((x) => x.due);
  const amAll = B.am.filter((x) => x.due).every((x) => x.done), pmAll = B.pm.filter((x) => x.due).every((x) => x.done);
  const first = B.scans[0], last = B.scans[B.scans.length - 1];
  const next = last ? addDays(last.date, 7) : null;
  el.innerHTML = `
    <div class="phead asp-head"><div class="asp-head-l"><p class="kicker c-as">Body</p><h1 class="lt">Looks</h1>
      <p class="sub">${B.items.length ? `${B.proto.n ? `Day ${B.proto.n} of your protocol streak` : 'Your protocol streak starts today'} · ${pmAll && amAll ? 'all done today' : `PM due by ${esc(B.targets.pmDue)}`}` : 'Protocols, your face over time, programs'}</p></div></div>

    ${B.items.length ? `<section class="bod-proto surface">
      <div class="bod-proto-top">
        ${seg('bod-half', [['am', `${I.sun}AM`, amAll ? '✓' : `${B.am.filter((x) => x.due && x.done).length}/${B.am.filter((x) => x.due).length}`], ['pm', `${I.moon}PM`, pmAll ? '✓' : `${B.pm.filter((x) => x.due && x.done).length}/${B.pm.filter((x) => x.due).length}`]], half, 'bod-halfseg')}
        <span class="bod-streak">${BI.flame}<b class="met">${B.proto.n}</b> days</span>
      </div>
      <div class="bod-pweek">${B.proto.week.map(([d, st]) => `<span class="bod-pw ${st ? `bod-${st}` : ''}${d === TODAY ? ' bod-today' : ''}"><i></i><b>${weekday(d).slice(0, 1)}</b></span>`).join('')}</div>
      <div class="bod-checks">${list.map((x) => `
        <div class="bod-ck${x.done ? ' bod-ck-done' : ''}${x.due ? '' : ' bod-ck-off'}">
          <button class="check${x.done ? ' done' : ''}" data-act="bod-ck" data-id="${esc(x.id)}" aria-label="${esc(x.text)}${x.done ? ', done' : ''}" ${x.due ? '' : 'disabled'}>${I.check}</button>
          <span class="rbody"><span class="rtitle">${esc(x.text)}</span><span class="rmeta">${esc(x.due ? x.meta : `Not today · ${x.meta}`)}</span></span>
          ${x.prog && !x.done && x.due ? `<button class="btn sm tint" style="--c:var(--as-ink)" data-act="bod-prog" data-id="${esc(x.prog)}">Start</button>` : ''}
        </div>`).join('')}</div>
      <p class="foot bod-proto-foot">${esc(protoFoot(half, amAll, pmAll, dueList))}</p>
      <div class="bod-plan-acts"><button class="btn sm" data-act="bod-proto-edit">${I.edit ?? I.plus}Edit</button></div>
    </section>` : `<section class="bod-proto surface bod-empty">
      <p class="headline">Morning and evening, a few minutes each</p>
      <p class="foot">Skin, posture and sleep habits as two checklists with a streak. ${esc(AGENT.name)} reminds you before the PM one is due.</p>
      <div class="bod-plan-acts"><button class="btn tint" style="--c:var(--as-ink)" data-act="bod-proto-seed">Use the suggested routine</button><button class="btn" data-act="bod-proto-edit">Make my own</button></div>
    </section>`}

    <div class="sh"><h2>Face</h2>${B.scans.length ? `<button class="sh-act" data-act="bod-scans">All scans ${I.chevR}</button>` : ''}</div>
    ${last ? `<section class="bod-facecard surface">
      <div class="bod-face-top">
        <div class="bod-face-pics"><figure>${faceDiagram('front')}<figcaption>Front</figcaption></figure><figure>${faceDiagram('side', { cm: last.cm ?? '—', cva: last.cva ?? '—' })}<figcaption>Side${last.cm ? ` · ${last.cm}°` : ''}</figcaption></figure></div>
        <div class="bod-face-meta"><p class="headline">Week ${B.scans.length}</p><p class="foot">${esc(dayLabel(last.date))}${B.scans.length > 1 ? `<br>against ${esc(dayShort(first.date))}` : '<br>your baseline'}</p></div>
      </div>
      <div class="bod-fm">
        ${last.skin != null ? fmetric('Skin clarity', `${last.skin}`, B.scans.length > 1 ? delta(last.skin - first.skin) : 'baseline', last.spots != null ? `${last.spots} active spots${first.spots != null && B.scans.length > 1 ? `, was ${first.spots}` : ''}` : 'Higher is clearer', B.scans.map((x) => x.skin).filter((v) => v != null), 'skin') : ''}
        ${last.puff != null ? fmetric('Puffiness', puffWord(last.puff), B.scans.length > 1 ? (puffWord(first.puff) === puffWord(last.puff) ? 'steady' : `was ${puffWord(first.puff).toLowerCase()}`) : 'baseline', 'Lowest after a full night of sleep', B.scans.map((x) => -(x.puff ?? 0)), 'puff') : ''}
        ${last.cm != null ? fmetric('Neck–chin angle', `${last.cm}°`, B.scans.length > 1 && first.cm != null ? `${first.cm - last.cm}° sharper` : 'baseline', 'Side photo. Posture and body fat move it', B.scans.map((x) => -(x.cm ?? 0)), 'cm') : ''}
        ${last.cva != null ? fmetric('Head posture', `${last.cva}°`, B.scans.length > 1 && first.cva != null ? delta(last.cva - first.cva, '°') : 'baseline', '50° and up is typical', B.scans.map((x) => x.cva ?? 0), 'cva') : ''}
      </div>
      <p class="foot bod-face-note">Measured against your own first scan, in the same light. Not a rating of your face.</p>
      <div class="bod-face-acts"><button class="btn tint" style="--c:var(--as-ink)" data-act="bod-facescan">${I.scan}Scan now</button><span class="foot">${next && next > TODAY ? `Next: ${esc(dayLabel(next))}` : 'Due this week'}</span></div>
    </section>` : `<section class="bod-facecard surface bod-empty">
      <div class="bod-face-top"><div class="bod-face-pics"><figure>${faceDiagram('front')}<figcaption>Front</figcaption></figure><figure>${faceDiagram('side', { cm: '?', cva: '?' })}<figcaption>Side</figcaption></figure></div></div>
      <p class="headline">Your first scan becomes the baseline</p>
      <p class="foot">A front and a side photo once a week, in the same light. Skin, puffiness, neck–chin angle and head posture, each against your own first scan. Never a rating.</p>
      <div class="bod-face-acts"><button class="btn tint" style="--c:var(--as-ink)" data-act="bod-facescan">${I.scan}Take the first scan</button></div>
    </section>`}

    <div class="sh"><h2>Programs</h2><span class="sh-count">${B.programs.filter((p) => p.enrolled).length ? `${B.programs.filter((p) => p.enrolled).length} on` : PROGRAM_DEFS.length}</span></div>
    <div class="group">${B.programs.map((p) => `
      <button class="row bod-progrow" data-act="bod-prog" data-id="${p.id}">
        ${ring(p.enrolled ? p.day / p.days : 0, 'as', 44, 5, { label: p.enrolled ? `${p.name}: day ${p.day} of ${p.days}` : `${p.name}: not started`, inner: `<b class="met bod-progrow-n">${p.enrolled ? (p.weeks ? Math.ceil(p.day / 7) : p.day) : '·'}</b>` })}
        <span class="rbody"><span class="rtitle">${esc(p.name)}</span><span class="rmeta">${p.enrolled ? `${p.weeks ? `Week ${Math.ceil(p.day / 7)} of ${p.days / 7}` : `Day ${p.day} of ${p.days}`} · ${p.doneToday ? 'done today' : `${p.min} min today`}` : `${p.weeks ? `${p.days / 7} weeks` : `${p.days} days`} · ${p.min} min a day`}</span></span>${I.chevR}
      </button>`).join('')}</div>

    <div class="sh"><h2>Learn</h2><span class="sh-count">${ARTICLES.length}</span></div>
    <div class="group">${ARTICLES.slice(0, 4).map((a) => `
      <button class="row ic" data-act="bod-article" data-id="${a.id}"><span class="tile">${I.read}</span><span class="rbody"><span class="rtitle wrap">${esc(a.title)}</span><span class="rmeta">${a.min} min read · ${esc(a.tag)}</span></span>${I.chevR}</button>`).join('')}
      <button class="row ic" data-act="bod-articles"><span class="tile">${I.book}</span><span class="rbody"><span class="rtitle">All ${ARTICLES.length} articles</span></span>${I.chevR}</button></div>

    <div class="sh"><h2>Watch</h2><span class="sh-count">${LESSONS.length} guides</span></div>
    <div class="bod-rail" data-scroll-x>${LESSONS.map((v) => `
      <button class="bod-vid" data-act="bod-video" data-id="${v.id}">
        <span class="bod-vid-p">${v.img ? `<img src="assets/body/ex/${v.img}-0.jpg" alt="" loading="lazy" style="object-position:${v.fx ?? 50}% 50%">` : art(v.art)}<span class="bod-vid-play">${BI.play}</span></span>
        <span class="bod-vid-t">${esc(v.title)}</span>
      </button>`).join('')}</div>`;
  stagger($$('.bod-ck, .bod-fmr, .bod-progrow', el), { each: 30, y: 8 });
  if (!el._seg) { el._seg = true; el.addEventListener('change', (e) => { if (!e.target.closest('[data-seg="bod-half"]')) return; half = e.detail; S.app?.refresh('looks'); }); }
}
const delta = (d, u = '') => `${d >= 0 ? '+' : '−'}${Math.abs(d)}${u}`;
function protoFoot(h, amAll, pmAll, dueList) {
  if (!dueList.length) return `Nothing due ${h === 'am' ? 'this morning' : 'tonight'}.`;
  if (h === 'pm') return pmAll ? `All done. Day ${B.proto.n} is safe.` : `${AGENT.name} reminds you at ${B.targets.pmDue} if it isn't done.`;
  const lastAm = B.am.filter((x) => x.done).map((x) => x.meta.replace('Done ', '')).sort().pop();
  return amAll ? `Morning done${lastAm ? ` at ${lastAm}` : ''}.` : `${dueList.filter((x) => !x.done).length} left this morning.`;
}
const fmetric = (name, v, d, note, vals, k) => `<button class="bod-fmr" data-act="bod-scans" data-k="${k}">
  <span class="rbody"><span class="rtitle">${esc(name)}</span><span class="rmeta">${esc(note)}</span></span>
  ${vals.length > 1 ? spark(vals, { w: 56, h: 24 }) : ''}
  <span class="bod-fmv"><b class="met">${esc(v)}</b><small>${esc(d)}</small></span></button>`;

// ticking an item: the check closes, and the last one of the day saves the streak
on('bod-ck', (b) => {
  const x = [...B.am, ...B.pm].find((y) => y.id === b.dataset.id); if (!x || !x.due) return;
  const wasComplete = B.proto.today;
  if (!x.done) { haptic(10); b.classList.add('closing', 'done'); }
  setTimeout(() => {
    store.tick(x.id, !x.done);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!wasComplete && B.proto.today) { haptic(30); toast(`Day ${B.proto.n}. Streak saved, ${AGENT.name} won't nudge tonight`); } }));
  }, x.done ? 0 : 420);
});
on('bod-proto-seed', () => { store.seedProtocol(); haptic(12); toast('Your AM and PM protocol is set. Edit any item'); });
on('bod-proto-edit', () => {
  openSheet({ title: 'Your protocol', sub: 'Morning and evening checklists', cls: 'bod-sheet', large: true, body: (el) => {
    const draw = () => {
      el.innerHTML = ['am', 'pm'].map((h) => `<div class="sh"><h2>${h === 'am' ? 'Morning' : 'Evening'}</h2></div>
        <div class="group">${B.items.filter((x) => x.half === h).map((x) => `<div class="row"><span class="rbody"><span class="rtitle">${esc(x.text)}</span>${x.days?.length ? `<span class="rmeta">${x.days.map((d) => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(' · ')}</span>` : ''}</span><button class="btn sm icon" data-drop="${esc(x.id)}" aria-label="Remove ${esc(x.text)}">${I.x}</button></div>`).join('')}
        <div class="row"><label class="field bod-addfield"><input type="text" placeholder="Add a ${h === 'am' ? 'morning' : 'evening'} item" data-add="${h}" enterkeyhint="done"></label></div></div>`).join('')
        + (B.items.length ? '' : `<div class="bod-cta"><button class="btn block" data-act="bod-proto-seed">Start from the suggested routine</button></div>`);
    };
    draw();
    el.addEventListener('click', (e) => { const d = e.target.closest('[data-drop]'); if (!d) return; store.dropProtocolItem(d.dataset.drop); haptic(6); setTimeout(draw, 40); });
    el.addEventListener('keydown', (e) => { const inp = e.target.closest('[data-add]'); if (!inp || e.key !== 'Enter' || !inp.value.trim()) return; store.addProtocolItem(inp.dataset.add, inp.value.trim()); haptic(6); setTimeout(draw, 40); });
  } });
});

// ── a program: what it changes, its days, today's session ─────────────
export function openProgram(id) {
  const p = program(id); if (!p) return;
  push({
    title: p.name, back: 'Looks', aspect: 'body', cls: 'bod-page',
    render(sc) {
      const n = p.weeks ? p.days : p.days;
      sc.innerHTML = `
        <div class="phead"><p class="kicker c-as">${p.enrolled ? `${p.weeks ? `Week ${Math.ceil(p.day / 7)} of ${p.days / 7}` : `Day ${p.day} of ${p.days}`} · ` : ''}${p.min} min a day</p><h1 class="lt">${esc(p.name)}</h1></div>
        ${p.enrolled ? `<section class="bod-progcal surface">
          <div class="bod-pdays">${Array.from({ length: n }, (_, i) => `<i class="${p.done.includes(i + 1) ? 'bod-on' : i + 1 === p.day ? 'bod-today' : i + 1 < p.day ? 'bod-miss' : ''}"></i>`).join('')}</div>
          <p class="foot">${p.done.length} of ${p.day - (p.doneToday ? 0 : 1)} days done${p.done.length < p.day - 1 ? `. Missed ${p.day - 1 - p.done.filter((d) => d < p.day).length}, and the program simply carries on` : ''}. Started ${esc(dayShort(p.started))}.</p>
        </section>` : ''}
        <div class="group bod-cancant">
          <div class="row ic"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle wrap">${esc(p.can)}</span><span class="rmeta">What it can change</span></span></div>
          <div class="row ic"><span class="tile">${I.x}</span><span class="rbody"><span class="rtitle wrap">${esc(p.cant)}</span><span class="rmeta">What it can't</span></span></div>
        </div>
        <div class="sh"><h2>${p.enrolled ? 'Today' : 'Each day'}</h2><span class="sh-count">${p.items.length} exercises</span></div>
        <div class="group">${p.items.map((k) => { const x = LEX[k]; return `
          <button class="row bod-lexrow" data-act="bod-lex" data-id="${k}">${thumb(k, 'bod-th-md')}<span class="rbody"><span class="rtitle">${esc(x.name)}</span><span class="rmeta">${esc(x.dose)}</span></span>${I.chevR}</button>`; }).join('')}</div>
        ${wyn(esc(p.tip))}
        <div class="bod-cta">${!p.enrolled ? `<button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-enroll" data-id="${p.id}">${BI.play}Start the ${esc(p.name.toLowerCase())} program</button>`
          : p.items.some((k) => LEX[k].kind === 'hold' || LEX[k].kind === 'reps') ? `<button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-guide" data-id="${p.id}">${BI.play}${p.doneToday ? 'Do it again' : "Start today's session"}</button>`
          : `<button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-prog-done" data-id="${p.id}" ${p.doneToday ? 'disabled' : ''}>${I.check}${p.doneToday ? 'Done today' : 'Mark today done'}</button>`}
          ${p.enrolled ? `<button class="btn block" data-act="bod-unenroll" data-id="${p.id}">Stop the program</button>` : ''}</div>`;
      stagger($$('.bod-pdays i', sc), { each: 8, y: 0, scale: 0.6, max: 300 });
    },
  });
}
on('bod-prog', (b) => { if (b.closest('.sheet')) closeSheet(); openProgram(b.dataset.id); });
on('bod-enroll', (b) => { store.enroll(b.dataset.id, true); haptic(14); pop(); setTimeout(() => openProgram(b.dataset.id), 120); toast(`${program(b.dataset.id).name}: day 1`); });
on('bod-unenroll', (b) => { const id = b.dataset.id; store.enroll(id, false); pop(); toast(`Stopped ${program(id).name}`, () => store.enroll(id, true)); });
on('bod-prog-done', (b) => { finishProgram(b.dataset.id); pop(); });
on('bod-lex', (b) => {
  const x = LEX[b.dataset.id]; if (!x) return;
  openSheet({ title: x.name, sub: x.dose, cls: 'bod-sheet', body: `<div class="bod-lex-media">${x.img ? demo(b.dataset.id) : art(x.art, 'bod-art-lg')}</div>
    <ol class="bod-how bod-inlay">${x.how.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${x.note ? `<p class="bod-sheet-p">${esc(x.note)}</p>` : ''}
    ${x.kind === 'hold' ? `<div class="bod-cta"><button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-guide-one" data-id="${b.dataset.id}">${BI.play}Do it now</button></div>` : ''}` });
});
/** A program session done: its day counts, and the protocol item it belongs to is ticked. */
function finishProgram(id) {
  const p = program(id); if (!p) return null;
  if (!p.enrolled) store.enroll(id, true);
  store.programDone(id);
  const item = [...B.pm, ...B.am].find((y) => y.prog === id && y.due && !y.done);
  if (item) store.tick(item.id, true);
  toast(item ? `${p.name} done. Ticked "${item.text}"` : `${p.name}: today done`);
  return item;
}

// ── the guided session: a ring for each hold, reps counted, rests between ──
let G = null;
function guide(keys, title, progId = null) {
  const steps = keys.filter((k) => LEX[k].kind === 'hold' || LEX[k].kind === 'reps');
  G = { steps, title, i: 0, rep: 1, phase: 'ready', t0: 0, paused: false, progId };
  const page = push({
    title, back: 'Stop', aspect: 'body', cls: 'bod-page bod-guide-page',
    onPop: () => { clearInterval(page._tick); G = null; },
    render(sc) { sc.innerHTML = '<div class="bod-guide"></div>'; drawGuide(sc); },
  });
  page._tick = setInterval(() => tickGuide(page), 200);
}
function drawGuide(root = $('.bod-guide-page .scroll')) {
  if (!G || !root) return;
  const k = G.steps[G.i]; const x = LEX[k]; const hold = x.kind === 'hold' ? x.hold : null; const reps = x.reps ?? 10; const sets = x.sets ?? 1;
  const box = $('.bod-guide', root);
  box.innerHTML = `
    <p class="kicker c-as">Exercise ${G.i + 1} of ${G.steps.length}</p>
    <h1 class="title1">${esc(x.name)}</h1>
    <p class="sub">${esc(x.dose)}</p>
    <div class="bod-guide-ring">${ring(hold ? 0 : (G.rep - 1) / (reps * sets), 'as', 220, 14, { cls: 'bod-gring', inner: `<span class="bod-gring-t"><b class="met">${hold ? hold : G.rep}</b><small>${hold ? 'seconds' : `of ${reps * sets}`}</small><i>${G.phase === 'ready' ? 'Tap start' : hold ? `Rep ${G.rep} of ${reps}` : 'reps'}</i></span>` })}</div>
    <div class="bod-guide-media">${x.img ? thumb(k, 'bod-th-lg') : art(x.art)}</div>
    <p class="bod-guide-how">${esc(x.how[1] ?? x.how[0])}</p>
    <div class="bod-guide-acts">
      ${G.phase === 'ready' ? `<button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-g-go">${BI.play}Start</button>`
        : hold ? `<button class="btn block" data-act="bod-g-pause">${G.paused ? `${BI.play}Resume` : `${I.pause}Pause`}</button>`
        : `<button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-g-rep">${I.plus}Rep done</button>`}
      <button class="btn block" data-act="bod-g-next">${G.i < G.steps.length - 1 ? 'Skip to next' : 'Finish'}</button>
    </div>`;
}
function tickGuide(page) {
  if (!G || !document.contains(page)) { clearInterval(page._tick); return; }
  if (G.phase !== 'hold' || G.paused) return;
  const x = LEX[G.steps[G.i]]; const el = $('.bod-gring', page); if (!el) return;
  const t = (Date.now() - G.t0) / 1000; const left = Math.max(0, x.hold - t);
  el.style.setProperty('--rp', Math.max(0, t / x.hold).toFixed(4)); el.dataset.v = Math.max(0, t / x.hold).toFixed(4);
  const n = $('.bod-gring-t b', page); if (n) n.textContent = Math.ceil(left);
  if (left <= 0) {
    haptic(14); native.haptics.play('tick');
    if (G.rep >= x.reps) { G.phase = 'ready'; G.rep = 1; nextStep(); return; }
    G.rep += 1; G.t0 = Date.now() + 1500; G.phase = 'hold';
    const lbl = $('.bod-gring-t i', page); if (lbl) lbl.textContent = `Rest · rep ${G.rep} next`;
    el.style.setProperty('--rp', '0');
  }
}
function nextStep() {
  if (!G) return;
  if (G.i < G.steps.length - 1) { G.i += 1; G.rep = 1; G.phase = 'ready'; drawGuide(); return; }
  const progId = G.progId ?? PROGRAM_DEFS.find((p) => p.items.some((k) => G.steps.includes(k)))?.id;
  native.haptics.play('success');
  pop();
  if (progId) finishProgram(progId); else toast('Session done');
}
on('bod-g-go', () => { if (!G) return; const x = LEX[G.steps[G.i]]; haptic(8); if (x.kind === 'hold') { G.phase = 'hold'; G.t0 = Date.now(); } else G.phase = 'reps'; drawGuide(); });
on('bod-g-pause', () => { if (!G) return; if (G.paused) { G.t0 = Date.now() - G.pauseAt; G.paused = false; } else { G.pauseAt = Date.now() - G.t0; G.paused = true; } drawGuide(); });
on('bod-g-rep', () => { if (!G) return; const x = LEX[G.steps[G.i]]; haptic(6); if (G.rep >= (x.reps ?? 10) * (x.sets ?? 1)) { nextStep(); return; } G.rep += 1; drawGuide(); });
on('bod-g-next', () => nextStep());
on('bod-guide', (b) => { const p = program(b.dataset.id); if (p) guide(p.items, p.name, p.id); });
on('bod-guide-one', (b) => { closeSheet(); guide([b.dataset.id], LEX[b.dataset.id].name); });

// ── scans: history over time, and taking a new one ────────────────────
function openScans(focus) {
  const first = B.scans[0]; if (!first) return;
  push({
    title: 'Face scans', back: 'Looks', aspect: 'body', cls: 'bod-page',
    render(sc) {
      const Mx = [['skin', 'Skin clarity', '', 'Higher is clearer'], ['puff', 'Puffiness', '', 'Lower is less puffy'], ['cm', 'Neck–chin angle', '°', 'Lower is sharper'], ['cva', 'Head posture', '°', 'Higher is more upright']];
      sc.innerHTML = `
        <div class="phead"><p class="kicker c-as">Once a week, same light</p><h1 class="lt">Face scans</h1><p class="sub">${B.scans.length} ${B.scans.length === 1 ? 'scan' : 'scans'} since ${dayShort(first.date)}. Each one is compared with the first.</p></div>
        ${Mx.map(([k, name, u, how]) => { const rows = B.scans.filter((x) => x[k] != null); return rows.length > 1 ? `<div class="sh"><h2>${name}</h2><span class="sh-count">${how}</span></div>
          <div class="bod-chartcard surface${focus === k ? ' bod-focus' : ''}" id="bod-scan-${k}">${lineChart(rows.map((x, i) => ({ x: i, v: x[k], label: dayShort(x.date) })), { h: 110, fmt: (v) => `${Math.round(v)}${u}`, tickFmt: (v) => `${Math.round(v)}`, xl: [[0, dayShort(rows[0].date)], [rows.length - 1, dayShort(rows.at(-1).date)]], title: name })}</div>` : ''; }).join('')}
        <div class="sh"><h2>Scans</h2></div>
        <div class="group">${B.scans.slice().reverse().map((x, i) => `<div class="row ic"><span class="tile bod-scan-ic">${BI.face}</span><span class="rbody"><span class="rtitle">${dayLabel(x.date)}</span><span class="rmeta">${esc([x.skin != null ? `Skin ${x.skin}` : null, x.puff != null ? `${puffWord(x.puff).toLowerCase()} puffiness` : null, x.cm != null ? `${x.cm}°` : null, x.cva != null ? `${x.cva}°` : null].filter(Boolean).join(' · '))}</span></span>${i === B.scans.length - 1 ? '<span class="pill plain">First</span>' : ''}</div>`).join('')}</div>
        <p class="hint">Photos stay on your phone. Only the measurements are kept.</p>`;
      wireScrub(sc);
      if (focus) requestAnimationFrame(() => { const el = $(`#bod-scan-${focus}`, sc); if (el) sc.scrollTop = Math.max(0, el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 180); });
    },
  });
}
on('bod-scans', (b) => openScans(b.dataset.k));
on('bod-facescan', () => { if (has('scan')) { api.scan('face'); return; } scanFlow(); });
// Body's own guided scan: front, then side (the camera on the iPhone, a photo picker on the web), then the reading
function scanFlow() {
  let step = 0; const shots = {};
  const sh = openSheet({ title: 'Weekly face scan', sub: 'Front, then side. Even light, no glasses, face relaxed.', cls: 'bod-sheet bod-scan-sheet', large: true, body: (el) => {
    const draw = () => {
      el.innerHTML = `<div class="bod-cam stay-dark"><div class="bod-cam-oval${step === 1 ? ' bod-side' : ''}">${shots[step ? 'side' : 'front'] ? `<img src="${shots[step ? 'side' : 'front']}" alt="">` : faceDiagram(step === 1 ? 'side' : 'front')}</div>
        <span class="bod-cam-k">${step === 0 ? 'Front · look straight at the camera' : 'Side · turn your head to the left'}</span>
        ${el._busy ? '<span class="bod-cam-mesh"></span>' : ''}</div>
        <div class="bod-steps2"><span class="${step >= 0 ? 'bod-on' : ''}">1 Front</span><span class="${step >= 1 ? 'bod-on' : ''}">2 Side</span></div>
        <div class="bod-cta"><button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-scan-shot" ${el._busy ? 'disabled' : ''}>${el._busy ? `<span class="spin"></span>${esc(el._busy)}` : `${I.camera}Take the ${step === 0 ? 'front' : 'side'} photo`}</button>${step === 1 && !el._busy ? '<button class="btn block" data-act="bod-scan-skip">Skip the side photo</button>' : ''}</div>`;
    };
    el._draw = draw; el._next = () => { step += 1; }; el._step = () => step; el._shots = shots;
    draw();
  } });
  sh._scan = true;
}
async function shoot(body) {
  if (DEMO_MODE) return 'demo';
  const r = await native.scan.photo({ source: 'camera', maxSize: 1200, quality: 0.8 });
  return r.ok ? asDataUrl(r.image, r.mime) : null;
}
on('bod-scan-shot', async (b) => {
  const body = b.closest('.sheet-body'); if (!body) return;
  const img = await shoot(body); if (!img) return;
  const angle = body._step() === 0 ? 'front' : 'side';
  if (img !== 'demo') body._shots[angle] = img;
  haptic(10);
  if (body._step() === 0) { body._next(); body._draw(); return; }
  readScan(body);
});
on('bod-scan-skip', (b) => { const body = b.closest('.sheet-body'); if (body) readScan(body); });
async function readScan(body) {
  const sheet = body.closest('.sheet');
  if (DEMO_MODE) { body._busy = 'Reading'; body._draw(); setTimeout(() => { closeSheet(sheet); handleFace({ kind: 'face', fields: { angle: 'side', scores: { skin: 77, puff: 37, cm: 124, cva: 50, symmetry: 96 } } }); }, 1200); return; }
  body._busy = `${AGENT.name} is measuring`; body._draw();
  const base = B.scans[0] ? { skin: B.scans[0].skin, puff: B.scans[0].puff, cm: B.scans[0].cm, cva: B.scans[0].cva } : null;
  const out = {};
  try {
    for (const angle of ['front', 'side']) { if (!body._shots[angle]) continue; const r = await store.readFaceOnPc(body._shots[angle], angle, base); for (const k of ['skin', 'spots', 'puff', 'sym', ...(angle === 'side' ? ['cm', 'cva'] : [])]) if (r[k] != null) out[k] = r[k]; if (r.note) out.note = r.note; }
  } catch (e) { body._busy = ''; body._draw(); toast(e?.status ? `Couldn't read it: ${e.message}` : 'Your PC reads the photo. Try again when it is reachable'); return; }
  closeSheet(sheet);
  handleFace({ kind: 'face', fields: { angle: body._shots.side ? 'side' : 'front', scores: { skin: out.skin, puff: out.puff, cm: out.cm, cva: out.cva, symmetry: out.sym, spots: out.spots } }, note: out.note });
}
// what the one Scan button hands Body for a face, or what Body's own flow produced: shown, then saved on his say-so
export function handleFace(result) {
  const sc = result?.fields?.scores ?? {}; const first = B.scans[0]; const last = B.scans.at(-1);
  // the shared lens may hand 1–10 ratings (overall, jawline): Body never keeps a rating of his face; it measures the photo itself
  const rated = ['overall', 'jawline', 'posture'].some((k) => sc[k] != null) && Object.values(sc).every((v) => v == null || Number(v) <= 10);
  if (rated) { if (result?.image && !DEMO_MODE) { toast(`${AGENT.name} is measuring the photo`); scanFlowFrom(result); } else toast('Scan in Looks for measurements against your first scan'); return; }
  const now = { skin: num(sc.skin), puff: num(sc.puff), cm: num(sc.cm), cva: num(sc.cva), sym: num(sc.symmetry ?? sc.sym), spots: num(sc.spots) };
  if (Object.values(now).every((v) => v == null)) {
    if (result?.image && !DEMO_MODE) { scanFlowFrom(result); return; }
    toast('That photo had no face to measure. Try again in even light'); return;
  }
  S.scanned = now;
  const cmp = (k, u = '') => (first?.[k] != null && now[k] != null ? `${now[k] - first[k] >= 0 ? '+' : '−'}${Math.abs(now[k] - first[k])}${u} since the first scan` : 'Your baseline');
  push({
    title: 'Scan read', back: 'Looks', aspect: 'body', cls: 'bod-page',
    render(scr) {
      scr.innerHTML = `
        <div class="phead"><p class="kicker c-as">${esc(relDay(TODAY))} · week ${B.scans.length + 1}</p><h1 class="lt">${first ? 'Against your first scan' : 'Your baseline'}</h1><p class="sub">${first ? `Compared with ${esc(dayLabel(first.date))}.` : 'Every scan from now is measured against this one.'}</p></div>
        <div class="bod-face-pics bod-face-lg surface">${faceDiagram('front')}${faceDiagram('side', { cm: now.cm ?? '—', cva: now.cva ?? '—' })}</div>
        <div class="group bod-scanres">
          ${now.skin != null ? `<div class="row"><span class="rbody"><span class="rtitle">Skin clarity ${now.skin}</span><span class="rmeta">${esc(cmp('skin'))}${last && last.skin != null && first !== last ? ` · ${now.skin - last.skin >= 0 ? '+' : '−'}${Math.abs(now.skin - last.skin)} this week` : ''}</span></span></div>` : ''}
          ${now.puff != null ? `<div class="row"><span class="rbody"><span class="rtitle">Puffiness ${puffWord(now.puff).toLowerCase()}</span><span class="rmeta">${first?.puff != null ? (puffWord(first.puff) === puffWord(now.puff) ? 'Same as the first scan. Sleep is the lever' : `Was ${puffWord(first.puff).toLowerCase()}`) : 'Your baseline'}</span></span></div>` : ''}
          ${now.cm != null ? `<div class="row"><span class="rbody"><span class="rtitle">Neck–chin angle ${now.cm}°</span><span class="rmeta">${first?.cm != null ? `${first.cm - now.cm >= 0 ? `${first.cm - now.cm}° sharper` : `${now.cm - first.cm}° wider`} than the first scan` : 'Your baseline'}</span></span></div>` : ''}
          ${now.cva != null ? `<div class="row"><span class="rbody"><span class="rtitle">Head posture ${now.cva}°</span><span class="rmeta">${esc(cmp('cva', '°'))}</span></span></div>` : ''}
        </div>
        ${result.note ? `<p class="hint">${esc(result.note)}</p>` : ''}
        ${wyn(esc(first ? 'Change here moves over weeks. Keep the light and the angle the same and it stays comparable.' : 'Same window, same time, every week. That is what makes the comparison honest.'))}
        <p class="hint">Photos stay on your phone. These measure change against you, not a score of your face.</p>
        <div class="bod-cta"><button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-scan-save">Save to Looks</button><button class="btn block" data-act="pop">Don't save</button></div>`;
    },
  });
}
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
function scanFlowFrom(result) { store.readFaceOnPc(asDataUrl(result.image, result.mime), result.fields?.angle ?? 'front', null).then((r) => handleFace({ kind: 'face', fields: { scores: { skin: r.skin, puff: r.puff, cm: r.cm, cva: r.cva, symmetry: r.sym, spots: r.spots } }, note: r.note })).catch(() => toast('Your PC reads the photo. Try again when it is reachable')); }
on('bod-scan-save', () => { const s = S.scanned; if (!s) return; store.addScan({ angle: s.cm != null ? 'side' : 'front', ...s }); S.scanned = null; pop(); haptic(14); toast('Saved. Next scan in a week'); });

// ── articles and guides ────────────────────────────────────────────────
function openArticle(id) {
  const a = ARTICLES.find((x) => x.id === id); if (!a) return;
  push({ title: a.title, back: 'Looks', aspect: 'body', cls: 'bod-page bod-article', render(sc) {
    sc.innerHTML = `<div class="phead"><p class="kicker c-as">${esc(a.tag)} · ${a.min} min read</p><h1 class="title1">${esc(a.title)}</h1></div>
      <article class="bod-read">${a.body.map((p) => `<p>${esc(p)}</p>`).join('')}</article>
      <div class="bod-cta"><button class="btn block" data-act="bod-ask-art" data-id="${a.id}">${I.sparkle}Ask ${esc(AGENT.name)} about this</button></div>`;
  } });
}
on('bod-article', (b) => openArticle(b.dataset.id));
on('bod-articles', () => push({ title: 'Learn', back: 'Looks', aspect: 'body', cls: 'bod-page', render(sc) {
  sc.innerHTML = `<div class="phead"><p class="kicker c-as">Short reads</p><h1 class="lt">Learn</h1><p class="sub">What works, what doesn't, and why.</p></div>
    <div class="group">${ARTICLES.map((a) => `<button class="row ic" data-act="bod-article" data-id="${a.id}"><span class="tile">${I.read}</span><span class="rbody"><span class="rtitle">${esc(a.title)}</span><span class="rmeta">${a.min} min read · ${esc(a.tag)}</span></span>${I.chevR}</button>`).join('')}</div>`;
} }));
on('bod-ask-art', (b) => { const a = ARTICLES.find((x) => x.id === b.dataset.id); api.askAgent(`About "${a?.title}"`, { aspect: 'body', about: a?.title }); });
// a guide: the drawing, the steps, a guided timer, and real video lessons on YouTube (no fake player)
on('bod-video', (b) => {
  const v = LESSONS.find((x) => x.id === b.dataset.id); if (!v) return; const x = LEX[v.how];
  const q = encodeURIComponent(`${v.title.replace(/,.*$/, '')} exercise how to`);
  openSheet({ title: v.title, sub: `A guide from the ${program(v.prog)?.name ?? 'Looks'} program`, cls: 'bod-sheet', body: `<div class="bod-player-v stay-dark">${v.img ? `<img src="assets/body/ex/${v.img}-0.jpg" alt="" style="object-position:${v.fx ?? 50}% 50%">` : art(v.art, 'bod-art-lg')}</div>
    ${x ? `<ol class="bod-how bod-inlay">${x.how.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${x.note ? `<p class="bod-sheet-p">${esc(x.note)}</p>` : ''}` : ''}
    <div class="bod-cta">${x?.kind === 'hold' ? `<button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-guide-one" data-id="${v.how}">${BI.play}Do it with the timer</button>` : ''}
      <a class="btn block" href="https://www.youtube.com/results?search_query=${q}" target="_blank" rel="noopener">${BI.play}Watch lessons on YouTube</a>
      <button class="btn block" data-act="bod-prog" data-id="${v.prog}">Open the ${esc(program(v.prog)?.name ?? '')} program</button></div>` });
});
export function openLooksHalf(h) { half = h; }
nav.openProgram = openProgram; nav.handleFace = handleFace;

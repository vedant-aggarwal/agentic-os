// Romance · the sample preview: the app for someone with a partner (most public users). Owner: the Romance agent.
// Every screen here says it is a sample. The partner, Sam, is sample data and appears nowhere else in the app.
import { $, $$, esc, on, push, pop, closeSheet, toast, haptic, ring, setRing, seg, wireSegs, pulse } from '../core.js';
import { I } from '../icons.js';
import { aspHead } from '../aspects.js';
import { api, has } from '../bus.js';
import {
  S, PARTNER, TOGETHER, QUESTION, ACTS, NEXT_DATE, DATE_TAGS, DATE_IDEAS, DATES_LOG, DIMS, CHECKINS, CHECKIN_READ,
  CHECKIN_STEPS, REPAIRS, REPAIR_STEPS, MOMENTS, COUPLE_NOTES, WYN_NOTE, BY_SHORT,
} from './romance-data.js';
import { R, romSheet, mono, entryCard, wynCard, sectionHead, previewKicker, weekDots, openComposer, switchMode, byIcon } from './romance-ui.js';

const rupee = (n) => `₹${n.toLocaleString('en-IN')}`;
// the label on every preview screen: what this is, and the way out
const banner = () => `<div class="rom-banner"><span>Sample data, to show Romance with a partner. None of it is yours.</span><button class="btn sm" data-act="rom-exit">Exit preview</button></div>`;
const askBtn = (label = 'Ask Wyn', about = PARTNER.id) => `<button class="btn sm" data-act="rom-ask" data-about="${about}">${I.sparkle}${esc(label)}</button>`;

// ══ Us ════════════════════════════════════════════════════════════════
export function renderUs(el, app) {
  const toNext = 100 - (TOGETHER % 100);
  el.innerHTML = `
    ${aspHead(app, { kicker: previewKicker, title: 'Romance' })}
    ${banner()}
    <section class="rom-card surface rom-tg">
      <div class="rom-tg-top">
        ${ring((TOGETHER % 100) / 100, 'as', 108, 10, { cls: 'rom-tg-ring', label: `${TOGETHER} days together; day ${TOGETHER + toNext} in ${toNext} days`, inner: `<span class="rom-ring-in"><b class="met" data-count="${TOGETHER}">${TOGETHER}</b><small>days</small></span>` })}
        <div class="rom-tg-txt">
          <p class="rom-k">Together</p>
          <p class="rom-tg-since">Since ${esc(PARTNER.sinceLabel)}</p>
          <p class="sub">Day ${TOGETHER + toNext} is on Monday</p>
        </div>
      </div>
      <button class="row rom-tg-who" data-act="rom-partner">${mono(PARTNER.initial)}<span class="rbody"><span class="rtitle">${esc(PARTNER.name)}</span><span class="rmeta">Last together ${esc(PARTNER.last)}</span></span>${I.chevR}</button>
    </section>
    ${questionCard()}
    <div class="rom-acts-sh">${sectionHead(`For ${PARTNER.name} this week`, { count: `${ACTS.filter((a) => a.done).length} of ${ACTS.length}` })}</div>
    <p class="hint rom-hint-top">Small things in ${esc(PARTNER.name)}’s love languages, quality time first.</p>
    <div class="group rom-acts-g">${ACTS.map(actRow).join('')}</div>
    ${sectionHead('Coming up', { act: 'rom-partner', actLabel: PARTNER.name })}
    <div class="group">
      <button class="row ic" data-act="rom-go" data-s="dates"><span class="tile rom-tile">${I.cal}</span><span class="rbody"><span class="rtitle">${esc(NEXT_DATE.title)}</span><span class="rmeta">${esc(NEXT_DATE.day)} · ${esc(NEXT_DATE.at)} · next date</span></span>${I.chevR}</button>
      ${PARTNER.dates.slice(0, 2).map((d) => `<button class="row ic" data-act="rom-partner"><span class="tile rom-tile">${d.icon === 'gift' ? R.gift : I.heart}</span><span class="rbody"><span class="rtitle">${esc(d.title)}</span><span class="rmeta">${esc(d.day)}</span></span><span class="rend">${esc(d.in)}</span></button>`).join('')}
      <button class="row ic" data-act="rom-go" data-s="checkin"><span class="tile rom-tile">${R.talk}</span><span class="rbody"><span class="rtitle">Sunday check-in</span><span class="rmeta">Sun 25 Oct · 20:00 · 10 minutes</span></span>${I.chevR}</button>
    </div>
    <div class="rom-gap"></div>
    ${wynCard({ ...WYN_NOTE.couple, acts: `<button class="btn sm" data-act="rom-go" data-s="dates">Plan Saturday</button>${askBtn()}` })}`;
}
const actRow = (a) => `<div class="row rom-act ${a.done ? 'is-done' : ''}" data-id="${a.id}">
    <button class="check ${a.done ? 'done' : ''}" data-act="rom-act" data-id="${a.id}" aria-label="${a.done ? 'Done' : 'Mark done'}: ${esc(a.text)}">${I.check}</button>
    <span class="rbody"><span class="rtitle wrap">${esc(a.text)}</span><span class="rmeta">${esc(a.lang)}</span></span></div>`;
on('rom-act', (el) => {
  const a = ACTS.find((x) => x.id === el.dataset.id); if (!a) return;
  a.done = !a.done; haptic(a.done ? 12 : 6);
  const row = el.closest('.row');
  row.classList.toggle('is-done', a.done);
  el.classList.toggle('done', a.done);
  if (a.done) { el.classList.remove('closing'); void el.offsetWidth; el.classList.add('closing'); }
  const cnt = row.closest('.asp-sec')?.querySelector('.rom-acts-sh .sh-count');
  if (cnt) cnt.textContent = `${ACTS.filter((x) => x.done).length} of ${ACTS.length}`;
});

// today's question: Paired's mechanic. Sam has answered; yours unlocks theirs.
function questionCard() {
  const sealed = !S.answered;
  return `<section class="rom-card surface rom-q">
    <p class="rom-card-h"><span class="rom-k">Today’s question</span><span class="rom-k rom-q-streak">${I.flame}${QUESTION.streak} days in a row</span></p>
    <p class="rom-qq">${esc(QUESTION.q)}</p>
    ${S.answered ? `<div class="rom-ans">${mono('V', 'sm me')}<div class="rom-ans-b"><p class="rom-ans-who">You</p><p class="rom-ans-t">${esc(S.myAnswer)}</p></div></div>` : ''}
    <div class="rom-ans them ${sealed ? 'sealed' : ''}">${mono(PARTNER.initial, 'sm')}<div class="rom-ans-b">
      <p class="rom-ans-who">${esc(PARTNER.name)}${sealed ? ' answered' : ''}</p>
      ${sealed ? `<span class="rom-seal" aria-label="Hidden until you answer"><i></i><i></i><i></i></span>` : `<p class="rom-ans-t">${esc(QUESTION.theirs)}</p>`}
    </div>${sealed ? `<span class="rom-seal-lock" aria-hidden="true">${I.lock}</span>` : ''}</div>
    ${sealed ? `<div class="rom-row-btns"><button class="btn sm rom-tint" data-act="rom-q-answer">Answer to see ${esc(PARTNER.name)}’s</button></div>` : `<p class="rom-q-next">Tomorrow’s question arrives at 08:00.</p>`}
  </section>`;
}
on('rom-q-answer', () => {
  const el = romSheet({
    cls: 'rom-sheet', title: 'Today’s question', sub: `${PARTNER.name} has answered · sample preview`,
    body: `<div class="pad"><p class="rom-qq rom-qq-sheet">${esc(QUESTION.q)}</p>
      <label class="rom-ta"><span class="vh">Your answer</span><textarea rows="4" placeholder="Your answer">When you remember the small things I said in passing.</textarea></label></div>`,
    foot: `<div class="rom-sheet-foot"><button class="btn primary block" style="--c:var(--as-fill)" data-act="rom-q-save">Answer and see ${esc(PARTNER.name)}’s</button></div>`,
  });
  return el;
});
on('rom-q-save', (el) => {
  const sh = el.closest('.sheet'); const text = $('textarea', sh).value.trim();
  if (!text) { $('textarea', sh).focus(); return; }
  S.answered = true; S.myAnswer = text;
  closeSheet(sh); haptic(14);
  const card = $('.rom-q', S.app?.page ?? document);
  if (!card) return;
  card.outerHTML = questionCard();
  const nu = $('.rom-q', S.app.page);
  nu.classList.add('rom-revealed');
});

// ══ Dates ═════════════════════════════════════════════════════════════
export function renderDates(el, app) {
  const shown = DATE_IDEAS.filter((d) => S.ideaTag === 'all' || d.tags.includes(S.ideaTag));
  el.innerHTML = `
    ${aspHead(app, { kicker: previewKicker, title: 'Dates', sub: 'One a week. Wyn keeps the ideas coming.' })}
    ${banner()}
    <section class="rom-card surface rom-next">
      <p class="rom-k c-as">Next date</p>
      <p class="rom-next-t">${esc(NEXT_DATE.title)}</p>
      <p class="sub">${esc(NEXT_DATE.day)} · ${esc(NEXT_DATE.at)} · ${esc(NEXT_DATE.meta)}</p>
      <div class="rom-next-rh">${weekDots(PARTNER.rhythmWeeks.map((v, i) => ({ w: ['20 Sep', '27 Sep', '4 Oct', '11 Oct', '18 Oct'][i], s: v ? 'done' : 'missed' })).concat([{ w: '24 Oct', s: 'now' }]))}<span class="foot"><b>4 of the last 5 weeks</b> had a date</span></div>
      <div class="rom-row-btns"><button class="btn sm" data-act="rom-cal">${I.cal}In your calendar</button><button class="btn sm" data-act="rom-ask" data-about="${PARTNER.id}" data-q="Change Saturday’s plan">Change</button></div>
    </section>
    ${sectionHead('Ideas', { count: shown.length })}
    <div class="rom-tags chips" data-scroll-x>${DATE_TAGS.map(([v, l]) => `<button class="chip sm ${S.ideaTag === v ? 'on' : ''}" data-act="rom-dtag" data-v="${v}" aria-pressed="${S.ideaTag === v}">${esc(l)}</button>`).join('')}</div>
    ${shown.length ? `<div class="group rom-ideas-g">${shown.map(ideaRow).join('')}</div>` : `<p class="note">Nothing in this filter yet. Wyn adds ideas as you mention places.</p>`}
    ${sectionHead('Past dates', { count: DATES_LOG.length })}
    <div class="group">${DATES_LOG.map((d) => logRow(d.day, d.title, d.note, d.by)).join('')}</div>`;
}
// a dated row: the day as a small calendar leaf, the line, and who filed it
export const logRow = (day, title, meta, by) => {
  const [wd, dn, mo] = day.split(' ');
  return `<div class="row rom-log"><span class="rom-log-d" aria-label="${esc(day)}"><small>${esc(wd)}</small><b class="met">${esc(dn ?? '')}</b><small>${esc(mo ?? '')}</small></span>
    <span class="rbody"><span class="rtitle wrap">${esc(title)}</span>${meta ? `<span class="rmeta"><span class="ell">${esc(meta)}</span></span>` : ''}<span class="rom-log-by">${byIcon(by)}${esc(BY_SHORT[by] ?? by)}</span></span></div>`;
};
const ideaRow = (d) => `<div class="row rom-idea-r">
    <span class="rbody"><span class="rtitle wrap">${esc(d.title)}</span><span class="rmeta"><span class="ell">${esc(d.where)} · ${rupee(d.cost)} · ${esc(d.len)}</span></span>
      <span class="rom-idea-why rom-why-ic">${d.by === 'chat' ? I.chat : I.sparkle}<span>${esc(d.why)}</span></span></span>
    <button class="btn sm" data-act="rom-plan" data-id="${d.id}">Plan it</button></div>`;
on('rom-dtag', (el) => { S.ideaTag = el.dataset.v; haptic(5); S.app?.refresh('dates'); });
on('rom-cal', () => { if (has('openCalendar')) api.openCalendar('day', NEXT_DATE.iso); else toast(`${NEXT_DATE.day} · ${NEXT_DATE.at} · ${NEXT_DATE.title}`); });
on('rom-plan', (el) => {
  const d = DATE_IDEAS.find((x) => x.id === el.dataset.id); if (!d) return;
  const st = { day: 'Sat 31 Oct', at: '11:00' };
  const chip = (k, v, label = v) => `<button class="chip sm ${st[k] === v ? 'on' : ''}" data-act="rom-plan-pick" data-k="${k}" data-v="${esc(v)}" aria-pressed="${st[k] === v}">${esc(label)}</button>`;
  const sh = romSheet({
    cls: 'rom-sheet', title: esc(d.title), sub: `${esc(d.where)} · ${rupee(d.cost)} · ${esc(d.len)}`,
    body: `<div class="pad">
      <p class="rom-cmp-l">Which day</p><div class="chips">${['Fri 30 Oct', 'Sat 31 Oct', 'Sun 1 Nov'].map((v) => chip('day', v)).join('')}</div>
      <p class="rom-cmp-l">What time</p><div class="chips">${['11:00', '16:00', '19:30'].map((v) => chip('at', v)).join('')}</div>
      <p class="rom-plan-n">${I.sparkle}<span>Wyn pencils it in, checks ${esc(PARTNER.name)}’s exam timetable, and reminds you the evening before.</span></p></div>`,
    foot: `<div class="rom-sheet-foot"><button class="btn primary block" style="--c:var(--as-fill)" data-act="rom-plan-add">Add to calendar</button></div>`,
  });
  sh._rom = { st, d };
});
on('rom-plan-pick', (el) => {
  const sh = el.closest('.sheet'); const { st } = sh._rom ?? {}; if (!st) return;
  st[el.dataset.k] = el.dataset.v;
  $$(`[data-act="rom-plan-pick"][data-k="${el.dataset.k}"]`, sh).forEach((b) => { const on2 = b.dataset.v === st[el.dataset.k]; b.classList.toggle('on', on2); b.setAttribute('aria-pressed', String(on2)); });
  haptic(5);
});
on('rom-plan-add', (el) => {
  const sh = el.closest('.sheet'); const { st, d } = sh._rom ?? {}; if (!d) return;
  closeSheet(sh); haptic(12);
  toast(`Pencilled in: ${d.title}, ${st.day} at ${st.at}`);
});

// ══ Check-in ══════════════════════════════════════════════════════════
export function renderCheckin(el, app) {
  el.innerHTML = `
    ${aspHead(app, { kicker: previewKicker, title: 'Check-in', sub: 'Ten minutes every Sunday, built on Gottman’s State of the Union.' })}
    ${banner()}
    <section class="rom-card surface rom-due">
      <p class="rom-k c-as">This Sunday · 20:00</p>
      <p class="rom-next-t">Your weekly check-in</p>
      <ol class="rom-due-steps">${CHECKIN_STEPS.slice(0, 4).map((s2, i) => `<li><span class="rom-due-n">${i + 1}</span>${esc(s2.title)}</li>`).join('')}</ol>
      <div class="rom-row-btns"><button class="btn sm rom-tint" data-act="rom-checkin">Start now</button><span class="foot">Last one: Sun 18 Oct</span></div>
    </section>
    ${sectionHead('How it felt', { count: '8 weeks' })}
    <section class="rom-card surface rom-trend">
      ${seg('rom-dim', DIMS.map(([v, l]) => [v, l]), S.chart)}
      <div class="rom-trend-body">${trendBody(S.chart)}</div>
    </section>
    ${sectionHead('After a fight')}
    <section class="rom-card surface rom-mend">
      <span class="tile rom-tile">${R.mend}</span>
      <div class="rom-mend-b"><p class="rom-next-t">Repair, in five steps</p>
        <p class="sub">Cool off, say what you felt, see both sides, own your part, agree on one thing.</p>
        <div class="rom-row-btns"><button class="btn sm" data-act="rom-repair">Start a repair</button></div></div>
    </section>
    <div class="group rom-repairs">${REPAIRS.map((r) => `<div class="row"><span class="rbody"><span class="rtitle">${esc(r.what)}</span><span class="rmeta"><span class="ell">${esc(r.day)} · ${esc(r.state)}</span></span><span class="rom-repair-p"><b>Agreed:</b> ${esc(r.plan)}</span></span></div>`).join('')}</div>`;
  $('[data-seg="rom-dim"]', el).addEventListener('change', (e) => { S.chart = e.detail; const b = $('.rom-trend-body', el); b.innerHTML = trendBody(S.chart); b.classList.remove('rom-fade'); void b.offsetWidth; b.classList.add('rom-fade'); });
}
// one series, one hue: a 2px line, a 12% wash, 8px markers with a surface ring, hairline grid; tap a week to read it
function trendBody(dim, pick = CHECKINS.length - 1) {
  const n = CHECKINS.length, W = 320, H = 128, pl = 6, pr = 6, pt = 10, pb = 10;
  const x = (i) => pl + (i * (W - pl - pr)) / (n - 1);
  const y = (v) => pt + ((5 - v) * (H - pt - pb)) / 4;
  const pts = CHECKINS.map((c, i) => [x(i), y(c[dim])]);
  const line = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)} ${b.toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)} ${H - pb} L${x(0).toFixed(1)} ${H - pb} Z`;
  const c = CHECKINS[pick]; const name = DIMS.find(([v]) => v === dim)[1].toLowerCase();
  return `
    <p class="rom-trend-read"><b class="met">${c[dim]}</b><span class="u">of 5</span><span class="rom-trend-w">${pick === n - 1 ? 'Last Sunday' : `Week of ${esc(c.w)}`}</span></p>
    <div class="rom-chart">
      <div class="rom-yl" aria-hidden="true">${[5, 3, 1].map((v) => `<span style="top:${((y(v) / H) * 100).toFixed(2)}%">${v}</span>`).join('')}</div>
      <div class="rom-plot">
        <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="How ${esc(name)} you felt, each Sunday for 8 weeks: ${CHECKINS.map((k) => `${k.w} ${k[dim]}`).join(', ')}">
          <g class="g">${[1, 3, 5].map((v) => `<line x1="0" x2="${W}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
          <path class="ar" d="${area}"/><path class="ln" d="${line}"/>
          ${pts.map(([a, b], i) => `<circle class="pt ${i === pick ? 'on' : ''}" cx="${a.toFixed(1)}" cy="${b.toFixed(1)}" r="${i === pick ? 6 : 4}"/>`).join('')}
        </svg>
        <div class="rom-hits">${CHECKINS.map((k, i) => `<button data-act="rom-pt" data-i="${i}" style="left:${((x(i) / W) * 100).toFixed(2)}%" aria-label="Week of ${esc(k.w)}: ${k[dim]} of 5" ${i === pick ? 'aria-pressed="true"' : ''}></button>`).join('')}</div>
      </div>
    </div>
    <div class="rom-xl" aria-hidden="true">${[0, 4, n - 1].map((i) => `<span class="${i === 0 ? 'first' : i === n - 1 ? 'last' : ''}" style="left:${((x(i) / W) * 100).toFixed(2)}%">${esc(CHECKINS[i].w)}</span>`).join('')}</div>
    <p class="rom-trend-x">${esc(CHECKIN_READ[dim])}</p>`;
}
on('rom-pt', (el) => { const b = el.closest('.rom-trend-body'); if (!b) return; b.innerHTML = trendBody(S.chart, Number(el.dataset.i)); haptic(4); });

// a guided flow in a sheet: steps, one screen each (the check-in and the repair share it)
function flowSheet({ title, sub, steps, done }) {
  const st = { i: 0, rate: {}, chips: new Set() };
  const el = romSheet({ large: true, cls: 'rom-sheet rom-flow', title, sub, body: '<div class="rom-flow-b"></div>', foot: '<div class="rom-sheet-foot rom-flow-foot"></div>' });
  const draw = () => {
    const s2 = steps[st.i]; const last = st.i === steps.length - 1;
    $('.rom-flow-b', el).innerHTML = `
      <div class="pad rom-flow-in">
        <div class="steps" style="--c:var(--as)" aria-label="Step ${st.i + 1} of ${steps.length}">${steps.map((_, k) => `<i class="${k < st.i ? 'done' : k === st.i ? 'on' : ''}"></i>`).join('')}</div>
        <p class="rom-flow-n">Step ${st.i + 1} of ${steps.length}</p>
        <h4 class="rom-flow-t">${esc(s2.title)}</h4>
        <p class="rom-flow-a">${esc(s2.ask)}</p>
        ${s2.chips ? `<div class="chips rom-flow-chips">${s2.chips.map((c) => `<button class="chip sm ${st.chips.has(c) ? 'on' : ''}" data-act="rom-fchip" data-v="${esc(c)}" aria-pressed="${st.chips.has(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
        ${(s2.fields ?? []).map((f, k) => `${s2.labels?.[k] ? `<p class="rom-cmp-l">${esc(s2.labels[k])}</p>` : ''}<label class="rom-ta sm"><span class="vh">${esc(s2.labels?.[k] ?? s2.title)}</span><textarea rows="2" placeholder="${k === 0 && !f ? 'Write it in your words' : ''}">${esc(f)}</textarea></label>`).join('')}
        ${s2.rate ? `<div class="group rom-rates">${DIMS.map(([v, l]) => `<div class="row rom-rate"><span class="rbody"><span class="rtitle">${esc(l)}</span></span><span class="rom-rate-dots" role="radiogroup" aria-label="${esc(l)}">${[1, 2, 3, 4, 5].map((n) => `<button data-act="rom-rate" data-d="${v}" data-v="${n}" role="radio" aria-checked="${st.rate[v] === n}" aria-label="${n} of 5" class="${st.rate[v] >= n ? 'on' : ''}"><span></span></button>`).join('')}</span></div>`).join('')}</div>` : ''}
        ${s2.id === 'cool' ? `<button class="btn block rom-flow-alt" data-act="rom-cool">${I.clock}Remind me in 20 minutes</button>` : ''}
      </div>`;
    $('.rom-flow-foot', el).innerHTML = `${st.i ? `<button class="btn" data-act="rom-fback">Back</button>` : ''}<button class="btn primary block" style="--c:var(--as-fill)" data-act="rom-fnext">${last ? 'Finish' : 'Next'}</button>`;
    $('.sheet-body', el).scrollTop = 0;
  };
  el._flow = { st, draw, steps, done };
  draw();
  return el;
}
on('rom-fnext', (el) => {
  const sh = el.closest('.sheet'); const f = sh?._flow; if (!f) return;
  if (f.st.i < f.steps.length - 1) { f.st.i += 1; haptic(6); f.draw(); return; }
  closeSheet(sh); haptic(14); f.done?.(f.st);
});
on('rom-fback', (el) => { const f = el.closest('.sheet')?._flow; if (!f || !f.st.i) return; f.st.i -= 1; f.draw(); });
on('rom-fchip', (el) => { const f = el.closest('.sheet')?._flow; if (!f) return; const v = el.dataset.v; if (f.st.chips.has(v)) f.st.chips.delete(v); else f.st.chips.add(v); el.classList.toggle('on'); el.setAttribute('aria-pressed', String(f.st.chips.has(v))); haptic(5); });
on('rom-rate', (el) => { const f = el.closest('.sheet')?._flow; if (!f) return; f.st.rate[el.dataset.d] = Number(el.dataset.v); haptic(5); $$(`[data-act="rom-rate"][data-d="${el.dataset.d}"]`, el.closest('.rom-rate-dots')).forEach((b) => { const k = Number(b.dataset.v); b.classList.toggle('on', k <= f.st.rate[el.dataset.d]); b.setAttribute('aria-checked', String(k === f.st.rate[el.dataset.d])); }); });
on('rom-cool', () => toast('Wyn will check in at 18:00'));
on('rom-checkin', () => flowSheet({ title: 'Sunday check-in', sub: `With ${PARTNER.name} · sample preview`, steps: CHECKIN_STEPS, done: () => toast('Check-in saved. Next one Sunday 1 Nov') }));
on('rom-repair', () => flowSheet({ title: 'Repair', sub: 'For you first, then together · sample preview', steps: REPAIR_STEPS, done: () => toast('Saved. Wyn can help you say it; she never sends anything') }));

// ══ Moments ═══════════════════════════════════════════════════════════
export function renderMoments(el, app) {
  const notes = S.journalSeg === 'notes';
  el.innerHTML = `
    ${aspHead(app, { kicker: previewKicker, title: 'Moments', sub: `With ${PARTNER.name}, filed by you and by Wyn.` })}
    ${banner()}
    <div class="pad rom-seg-wrap">${seg('rom-jseg', [['moments', 'Moments', MOMENTS.length], ['notes', 'Private notes', COUPLE_NOTES.length]], S.journalSeg)}</div>
    <div class="rom-entries">${(notes ? COUPLE_NOTES : MOMENTS).map(entryCard).join('')}</div>`;
  $('[data-seg="rom-jseg"]', el).addEventListener('change', (e) => { S.journalSeg = e.detail; app.refresh('moments'); });
}

// ══ the partner page (the shared person-page anatomy) ═════════════════
export function openPartner() {
  push({
    title: PARTNER.name, back: 'Romance', aspect: 'romance', cls: 'rom-pp',
    right: `<button class="gbtn chrome icon" data-act="rom-ask" data-about="${PARTNER.id}" aria-label="Ask Wyn about ${esc(PARTNER.name)}">${I.sparkle}</button>`,
    render(sc) {
      sc.innerHTML = `
        <header class="rom-pp-head">
          ${mono(PARTNER.initial, 'xl')}
          <h1 class="title1">${esc(PARTNER.name)}</h1>
          <p class="sub">Partner · together ${TOGETHER} days</p>
          <p class="rom-pp-sample">${I.eye}Sample person in the preview</p>
          <div class="rom-pp-acts">
            <button class="rom-pp-a" data-act="rom-moment"><span>${I.plus}</span>Moment</button>
            <button class="rom-pp-a" data-act="rom-pp-dates"><span>${I.cal}</span>Plan a date</button>
            <button class="rom-pp-a" data-act="rom-checkin"><span>${R.talk}</span>Check-in</button>
          </div>
        </header>
        <section class="rom-card surface rom-pp-warm">
          <div class="rom-pp-warm-t"><p class="rom-k">Keep it warm</p><p class="rom-next-t">${esc(PARTNER.rhythm)}</p>
            <p class="sub">Last date 4 days ago · next on Saturday</p></div>
          ${weekDots(PARTNER.rhythmWeeks.map((v, i) => ({ w: ['20 Sep', '27 Sep', '4 Oct', '11 Oct', '18 Oct'][i], s: v ? 'done' : 'missed' })).concat([{ w: '24 Oct', s: 'now' }]))}
        </section>
        ${sectionHead('Love languages')}
        <section class="rom-card surface rom-langs">
          ${PARTNER.langs.map(([l, v], i) => `<div class="rom-lang"><span class="rom-lang-l">${i === 0 ? `<b>${esc(l)}</b>` : esc(l)}</span><span class="rom-lang-v met">${v}<small>%</small></span><div class="bar" style="--c:${i === 0 ? 'var(--as)' : 'var(--rom-mute)'}"><i style="--p:${v}%"></i></div></div>`).join('')}
          <p class="rom-langs-me">Yours: ${esc(PARTNER.mine)}. From the quiz you both took in July.</p>
        </section>
        ${sectionHead('Moments', { act: 'rom-pp-moments', actLabel: 'All' })}
        <div class="rom-entries">${MOMENTS.slice(0, 2).map(entryCard).join('')}</div>
        ${sectionHead(`${PARTNER.name}’s world`, { act: 'rom-pp-brain', actLabel: 'Brain file' })}
        <div class="group">${PARTNER.world.map(([t, by]) => `<div class="row"><span class="rbody"><span class="rtitle wrap">${esc(t)}</span><span class="rmeta">${esc(by)}</span></span></div>`).join('')}</div>
        ${sectionHead('Dates to remember')}
        <div class="group">${PARTNER.dates.map((d) => `<div class="row ic"><span class="tile rom-tile">${d.icon === 'gift' ? R.gift : d.icon === 'cal' ? I.cal : I.heart}</span><span class="rbody"><span class="rtitle">${esc(d.title)}</span><span class="rmeta">${esc(d.day)}</span></span><span class="rend">${esc(d.in)}</span></div>`).join('')}</div>
        ${sectionHead('Gift ideas', { count: PARTNER.gifts.length })}
        <div class="group">${PARTNER.gifts.map(([t, why]) => `<div class="row"><span class="rbody"><span class="rtitle wrap">${esc(t)}</span><span class="rom-row-why">${esc(why)}</span></span></div>`).join('')}</div>
        <div class="pad rom-pp-end">${askBtn(`Ask Wyn about ${PARTNER.name}`)}</div>`;
    },
  });
}
on('rom-partner', () => openPartner());
on('rom-pp-dates', () => { pop(); setTimeout(() => S.app?.go('dates'), 120); });
on('rom-pp-moments', () => { pop(); setTimeout(() => S.app?.go('moments'), 120); });
on('rom-pp-brain', () => api.openBrain(PARTNER.file));
on('rom-moment', () => openComposer({ kind: 'moment' }));
on('rom-exit', () => switchMode('single'));

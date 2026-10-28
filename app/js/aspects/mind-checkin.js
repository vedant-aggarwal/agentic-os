// Mind · the evening check-in: Wyn's questions about the day's big blocks of screen time, answered in a tap or
// two, turning raw time into a record of what it was for. Owner: the Mind agent. Prefix min-.
// One card per block. Wyn's guess is already chosen; a tap changes it; two labels split the block and a handle
// sets the share. Swipe the card left (or Next) to move on. The last card files the day: the record, the
// kinds before and after, where each answer was filed on the wheel, and the streak ring closing.
import { $, $$, esc, push, pop, on, ring, pulse, haptic, toast } from '../core.js';
import { I } from '../icons.js';
import { TODAY_LABEL, person, AGENT } from '../data.js';
import { api } from '../bus.js';
import { S, BLOCKS, app, fmt, hm, todayMin, kindsNow, labelOf, STREAK, WEEK, CHECKIN_AT, guessOf, LEARN_GOAL, learnWeek, APPS, REAL, nowMin, saveCheckin, saveAppRule, KINDS } from './mind-data.js';
import { appTile, wynMark, kindsGrid, weekRings, refreshMind, growIn } from './mind-ui.js';

let C = null;   // the open check-in: { page, sc, i, answers: { appId: [[labelId, minutes], …] } }
const dotRing = (p, size) => ring(p, 'as', size, Math.max(3, Math.round(size / 7)));
const same = (a, b) => a.length === b.length && a.every(([l, m], i) => b[i] && b[i][0] === l && b[i][1] === m);

export function openCheckin({ edit = false } = {}) {
  if (S.checkin.done && !edit) return openRecord();
  // nothing she couldn't sort on her own: the day as she sorted it, and one tap files it
  if (!BLOCKS.length) return openQuiet();
  const start = edit && S.checkin.answers ? S.checkin.answers : Object.fromEntries(BLOCKS.map((b) => [b.app, guessOf(b)]));
  C = { i: 0, answers: JSON.parse(JSON.stringify(start)), page: null, sc: null };
  push({
    title: 'Check-in', back: 'Mind', aspect: 'mind', cls: 'min-cip',
    render(sc, page) { C.page = page; C.sc = sc; sc.innerHTML = flowHtml(); wireFlow(sc); place(true); },
  });
}

function flowHtml() {
  return `
    <div class="phead min-cih">
      <p class="kicker c-as">Check-in · ${TODAY_LABEL.weekday} ${TODAY_LABEL.day} ${TODAY_LABEL.month}</p>
      <h1 class="lt">Where did today go?</h1>
      <p class="sub">${fmt(todayMin())} on ${REAL ? 'screen' : 'your phone'} so far. I sorted ${APPS.length - BLOCKS.length} ${APPS.length - BLOCKS.length === 1 ? 'app' : 'apps'} on my own; ${BLOCKS.length === 1 ? 'this one is' : `these ${BLOCKS.length} are`} yours to call.</p>
    </div>
    <div class="min-cistep pad" aria-live="polite">
      <span class="steps" style="--c:var(--as)">${BLOCKS.map(() => '<i></i>').join('')}</span>
      <span class="min-cisn"><b class="met">1</b> of ${BLOCKS.length}</span>
      <button class="min-ciback" data-act="min-ci-prev" hidden>${I.chevL}Back</button>
    </div>
    <div class="min-stack">${BLOCKS.map((b, i) => cardHtml(b, i)).join('')}</div>
    <p class="hint min-cihint">Swipe the card left to go on.</p>`;
}

function cardHtml(b, i) {
  const x = app(b.app);
  const last = i === BLOCKS.length - 1;
  return `<article class="min-cc surface" data-i="${i}" aria-label="${esc(x.name)}, ${fmt(b.min)}">
    <header class="cc-h">${appTile(x, 'lg')}
      <div class="cc-ht"><b>${esc(x.name)}</b><span>${esc(b.when)}</span></div>
      <b class="met cc-v">${fmt(b.min)}</b></header>
    ${timeline(x)}
    <p class="cc-why">${wynMark('xs')}<span>${esc(b.why || 'I only see the app, not what was in it.')}</span></p>
    <p class="cc-q">What was it for?</p>
    <div class="cc-opts">${b.labels.map((l) => `<button class="cc-o" data-act="min-ci-opt" data-l="${l.id}" aria-pressed="false"><span class="cc-oc">${I.check}</span><span class="cc-ol">${esc(l.name)}</span></button>`).join('')}</div>
    <div class="cc-split"><div class="cc-spin"></div></div>
    <p class="cc-map" aria-live="polite"></p>
    <footer class="cc-f"><span class="cc-hint"></span><button class="btn primary cc-next" data-act="min-ci-next" style="--c:var(--as-fill)">${last ? 'File today' : 'Next'}</button></footer>
  </article>`;
}

// where in the day the block sat: 06:00 to now, each session a mark
function timeline(x) {
  const n = Math.max(nowMin(), 7 * 60);
  const a0 = Math.min(6 * 60, ...(x.sessions ?? []).map((s) => s[0])), span = Math.max(60, n - a0);
  return `<div class="cc-tl" aria-hidden="true"><span class="cc-tlb">${x.sessions.map(([t, m]) => `<i style="--x:${((t - a0) / span).toFixed(4)};--w:${(m / span).toFixed(4)}"></i>`).join('')}</span>
    <span class="cc-tlx"><span>${hm(a0)}</span><span>${hm(a0 + span / 2)}</span><span>${hm(n)}</span></span></div>`;
}

// ── state → card ──
function paintCard(card) {
  const b = BLOCKS[card.dataset.i]; const ans = C.answers[b.app];
  const guess = guessOf(b);
  $$('.cc-o', card).forEach((o) => { const on = ans.some(([l]) => l === o.dataset.l); o.setAttribute('aria-pressed', String(on)); o.classList.toggle('on', on); o.classList.toggle('guess', on && same(ans, guess)); });
  const sp = $('.cc-split', card);
  sp.classList.toggle('open', ans.length > 1);
  $('.cc-spin', sp).innerHTML = ans.length > 1 ? splitHtml(b, ans) : '';
  if (ans.length > 1) wireSplit(card, b);
  $('.cc-hint', card).textContent = same(ans, guess) ? 'Wyn’s guess. Tap to change it.' : ans.length > 1 ? 'Drag the line to set the split.' : 'Pick a second one to split the time.';
  $('.cc-map', card).innerHTML = mapHtml(b, ans);
}
// where each answer goes: one block can sit in two places on the wheel
const DEST = { mission: 'Mission', friends: 'Friends', family: 'Family' };
function mapHtml(b, ans) {
  return ans.map(([l]) => {
    const lb = labelOf(b.app, l); if (!lb) return '';
    const p = lb.person ? person(lb.person) : null;
    const dot = lb.aspect && lb.aspect !== 'mind' ? lb.aspect : lb.kind === 'learning' ? 'mind' : null;
    const to = DEST[lb.aspect] ? `${DEST[lb.aspect]}${p ? `, ${p.name}’s file` : ''}` : lb.kind === 'learning' ? 'your learning week' : lb.kind === 'work' ? 'counted as work' : 'counted, not filed';
    return `<span>${dot ? `<i class="dot" style="--c:var(--${dot})"></i>` : '<i class="dot"></i>'}${esc(lb.name)} → ${esc(to)}</span>`;
  }).join('');
}
function splitHtml(b, ans) {
  let acc = 0;
  const handles = ans.slice(0, -1).map(([, m], j) => { acc += m; return `<button class="cc-hd" data-j="${j}" role="slider" aria-label="Split between ${esc(labelOf(b.app, ans[j][0])?.name)} and ${esc(labelOf(b.app, ans[j + 1][0])?.name)}" aria-valuemin="1" aria-valuemax="${b.min - 1}" aria-valuenow="${acc}" style="--x:${(acc / b.min).toFixed(4)}"><i></i></button>`; }).join('');
  return `<div class="cc-sb">${ans.map(([l, m], i) => `<i class="cc-seg" data-i="${i}" style="flex:${m}"></i>`).join('')}${handles}</div>
    <div class="cc-sl">${ans.map(([l, m], i) => `<span data-i="${i}"><i class="cc-sw" data-i="${i}"></i>${esc(labelOf(b.app, l)?.name ?? l)}<b class="met">${fmt(m)}</b></span>`).join('')}</div>`;
}
// repaint the split without rebuilding it (keeps the pointer on the handle)
function paintSplit(card, b) {
  const ans = C.answers[b.app];
  let acc = 0;
  $$('.cc-seg', card).forEach((s, i) => { s.style.flex = ans[i][1]; });
  $$('.cc-hd', card).forEach((h, j) => { acc += ans[j][1]; h.style.setProperty('--x', (acc / b.min).toFixed(4)); h.setAttribute('aria-valuenow', acc); });
  $$('.cc-sl > span', card).forEach((s, i) => { $('b', s).textContent = fmt(ans[i][1]); });
  $('.cc-hint', card).textContent = same(ans, guessOf(b)) ? 'Wyn’s guess. Tap to change it.' : 'Drag the line to set the split.';
  $$('.cc-o', card).forEach((o) => o.classList.toggle('guess', o.classList.contains('on') && same(ans, guessOf(b))));
}
function wireSplit(card, b) {
  $$('.cc-hd', card).forEach((h) => {
    const j = Number(h.dataset.j);
    const set = (mj) => {
      const ans = C.answers[b.app]; const pair = ans[j][1] + ans[j + 1][1];
      mj = Math.max(1, Math.min(pair - 1, mj));
      if (mj === ans[j][1]) return;
      if (Math.abs(mj - ans[j][1]) >= 1 && mj % 5 === 0) haptic(4);
      ans[j + 1][1] = pair - mj; ans[j][1] = mj; paintSplit(card, b);
    };
    h.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      h.setPointerCapture(e.pointerId); h.classList.add('drag');
      const r = $('.cc-sb', card).getBoundingClientRect();
      const before = () => C.answers[b.app].slice(0, j).reduce((s, a) => s + a[1], 0);
      const move = (ev) => set(Math.round(((ev.clientX - r.left) / r.width) * b.min) - before());
      const up = () => { h.classList.remove('drag'); h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    h.addEventListener('keydown', (e) => {
      const ans = C.answers[b.app];
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(ans[j][1] - 1); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(ans[j][1] + 1); }
    });
  });
}

// add or drop a label. Two or three labels split the block; the guess comes back if he lands on it again
function toggle(b, id) {
  const ans = C.answers[b.app];
  const at = ans.findIndex(([l]) => l === id);
  if (at >= 0) {
    if (ans.length === 1) return false;
    const [, freed] = ans.splice(at, 1)[0];
    const rest = ans.reduce((s, a) => s + a[1], 0);
    let left = freed;
    ans.forEach((a, i) => { const add = i === ans.length - 1 ? left : Math.round(freed * (a[1] / rest)); a[1] += add; left -= add; });
    return true;
  }
  if (ans.length >= 3) { toast('Three is the most one block can split into'); return false; }
  const order = b.labels.map((l) => l.id);
  const next = [...ans.map(([l]) => l), id].sort((x, y) => order.indexOf(x) - order.indexOf(y));
  const g = guessOf(b);
  if (next.length === g.length && next.every((l, i) => g[i][0] === l)) { C.answers[b.app] = g; return true; }
  const share = Math.round(b.min / next.length);
  const scale = (b.min - share) / b.min;
  const kept = ans.map(([l, m]) => [l, Math.max(1, Math.round(m * scale))]);
  const got = kept.reduce((s, a) => s + a[1], 0);
  const out = next.map((l) => kept.find((k) => k[0] === l) ?? [l, b.min - got]);
  C.answers[b.app] = out;
  return true;
}

// ── the stack: the card in front, the next ones peeking below it, the answered ones gone to the left ──
function place(instant = false) {
  const cards = $$('.min-cc', C.sc);
  cards.forEach((c, i) => {
    const d = i - C.i;
    if (instant) c.style.transition = 'none';
    c.dataset.d = String(Math.max(-1, Math.min(3, d)));
    c.toggleAttribute('inert', d !== 0);
    if (instant) requestAnimationFrame(() => { c.style.transition = ''; });
  });
  $$('.min-cistep .steps i', C.sc).forEach((s, i) => { s.classList.toggle('done', i < C.i); s.classList.toggle('on', i === C.i); });
  $('.min-cisn .met', C.sc).textContent = String(C.i + 1);
  $('.min-ciback', C.sc).hidden = C.i === 0;
}
function next() {
  if (C.i >= BLOCKS.length - 1) return finish();
  haptic(8); C.i += 1; place();
}
function prev() { if (C.i === 0) return; haptic(6); C.i -= 1; place(); }

function wireFlow(sc) {
  $$('.min-cc', sc).forEach((card) => { paintCard(card); wireSwipe(card); });
}
// 1:1 horizontal drag on the front card; commit on distance or on the release velocity
function wireSwipe(card) {
  let x0 = null, y0 = 0, dx = 0, mode = null, pid = null, hist = [], dragged = 0;
  // a drag ends on whatever was under the finger: a click right after it is not a tap
  card.addEventListener('click', (ev) => { if (performance.now() - dragged < 350) { ev.stopPropagation(); ev.preventDefault(); } }, { capture: true });
  card.addEventListener('pointerdown', (e) => {
    if (card.dataset.d !== '0' || e.target.closest('.cc-hd')) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; mode = null; pid = e.pointerId; hist = [[e.clientX, performance.now()]];
  });
  card.addEventListener('pointermove', (e) => {
    if (x0 == null || e.pointerId !== pid) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!mode) {
      if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my) * 1.2) { mode = 'x'; card.setPointerCapture(pid); card.classList.add('drag'); }
      else if (Math.abs(my) > 10) { x0 = null; return; } else return;
    }
    dx = mx; hist.push([e.clientX, performance.now()]); if (hist.length > 5) hist.shift();
    const resist = (v) => (v * 0.55 * 160) / (160 + 0.55 * Math.abs(v));
    const x = dx > 0 && C.i === 0 ? resist(dx) : dx;
    card.style.transform = `translateX(${x}px) rotate(${(x / 32).toFixed(2)}deg)`;
  });
  const end = () => {
    if (x0 == null) return; x0 = null;
    if (mode !== 'x') return;
    const [a, z] = [hist[0], hist[hist.length - 1]];
    const v = (z[0] - a[0]) / Math.max(1, z[1] - a[1]);   // px per ms at release
    card.classList.remove('drag'); card.style.transform = '';
    dragged = performance.now();
    if (dx < -96 || v < -0.55) next();
    else if ((dx > 96 || v > 0.55) && C.i > 0) prev();
  };
  card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
}

on('min-ci-opt', (el) => {
  const card = el.closest('.min-cc'); if (!card || !C) return;
  const b = BLOCKS[card.dataset.i];
  if (toggle(b, el.dataset.l)) { haptic(5); paintCard(card); }
  else { el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); }
});
on('min-ci-next', () => C && next());
on('min-ci-prev', () => C && prev());

// ── filing the day ──
// the answers become the day's record: on the phone at once, on the PC when it answers
function fileDay(answers) {
  const before = kindsNow({ answered: false });
  S.checkin = { done: true, answers: JSON.parse(JSON.stringify(answers)), at: nowMin(), before, source: 'app' };
  S.learnExtra = Object.entries(answers).reduce((s, [aid, ans]) => s + ans.filter(([l]) => labelOf(aid, l)?.kind === 'learning').reduce((x, a) => x + a[1], 0), 0);
  saveCheckin(S.checkin.answers, before);
  refreshMind('home', 'screen', 'courses');
}
function finish() {
  fileDay(C.answers);
  haptic(14);
  // the cards go, the record arrives in the same page
  C.sc.classList.add('min-filing');
  setTimeout(() => {
    C.sc.classList.remove('min-filing');
    C.sc.scrollTop = 0;
    C.sc.innerHTML = recordHtml(true);
    C.page.querySelector('.tb-title').textContent = 'Today’s record';
    pulse(C.sc); growIn(C.sc); wireRecord(C.sc);
  }, 320);
}

function openQuiet() {
  push({
    title: 'Check-in', back: 'Mind', aspect: 'mind', cls: 'min-cip',
    render(sc, page) {
      sc.innerHTML = `
        <div class="phead min-cih">
          <p class="kicker c-as">Check-in · ${TODAY_LABEL.weekday} ${TODAY_LABEL.day} ${TODAY_LABEL.month}</p>
          <h1 class="lt">Where did today go?</h1>
          <p class="sub">${fmt(todayMin())} on screen so far. ${APPS.length ? 'Every app was clear on its own today, so there’s nothing to ask.' : 'Nothing on screen yet.'}</p>
        </div>
        <section class="surface min-card">${kindsGrid(kindsNow({ answered: false }))}<p class="min-cnote">${esc(AGENT.name)}’s sort, by app. Change how an app counts on its page.</p></section>
        <div class="pad min-reca"><button class="btn primary block" style="--c:var(--as-fill)" data-act="min-ci-file">File today</button></div>`;
      growIn(sc);
      sc._page = page;
    },
  });
}
on('min-ci-file', (el) => {
  const sc = el.closest('.scroll'); const page = sc?.closest('.page');
  fileDay({});
  haptic(14);
  sc.classList.add('min-filing');
  setTimeout(() => {
    sc.classList.remove('min-filing'); sc.scrollTop = 0;
    sc.innerHTML = recordHtml(true);
    const t = page?.querySelector('.tb-title'); if (t) t.textContent = 'Today’s record';
    pulse(sc); growIn(sc); wireRecord(sc);
  }, 320);
});

export function openRecord(fresh = false) {
  push({
    title: 'Today’s record', back: 'Mind', aspect: 'mind', cls: 'min-cip',
    render(sc) { sc.innerHTML = recordHtml(fresh); wireRecord(sc); growIn(sc); if (fresh) { haptic(14); pulse(sc); } },
  });
}

function recordHtml(fresh) {
  const ans = S.checkin.answers ?? {};
  const after = kindsNow(), before = S.checkin.before ?? kindsNow({ answered: false });
  const ig = ans.instagram ?? [];
  const igWork = ig.filter(([l]) => labelOf('instagram', l)?.kind === 'work').reduce((s, a) => s + a[1], 0);
  const n = STREAK + 1;
  const nights = (k) => `${k} ${k === 1 ? 'night' : 'nights'}`;
  const filed = [];
  Object.entries(ans).forEach(([aid, list]) => list.forEach(([lid, m]) => {
    const lb = labelOf(aid, lid); if (!lb || !app(aid)) return;
    filed.push({ aid, lb, m });
  }));
  const where = (f) => {
    const p = f.lb.person ? person(f.lb.person) : null;
    if (f.lb.aspect === 'mission') return { dot: 'mission', to: 'Mission', what: f.lb.file ?? 'Counted as work' };
    if (f.lb.aspect === 'friends') return { dot: 'friends', to: 'Friends', what: p ? `${p.name}’s file in the Brain` : 'Counted as time with friends', act: p ? `data-act="min-person" data-id="${p.id}"` : '' };
    if (f.lb.aspect === 'family') return { dot: 'family', to: 'Family', what: 'Counted as family time' };
    if (f.lb.kind === 'learning') return { dot: 'mind', to: 'Learning week', what: `${fmt(learnWeek())} of ${fmt(LEARN_GOAL)} now` };
    if (f.lb.kind === 'work') return { dot: 'mission', to: 'Work', what: 'Counted as work' };
    return { dot: null, to: f.lb.kind === 'social' ? 'People' : 'Entertainment', what: 'Counted, not filed anywhere' };
  };
  const rows = filed.sort((x, y) => y.m - x.m).map((f) => {
    const w = where(f); const x = app(f.aid);
    return `<${w.act ? 'button' : 'div'} class="row min-frow" ${w.act ?? ''}>
      <span class="min-fm met">${fmt(f.m)}</span>
      <span class="rbody"><span class="rtitle">${esc(f.lb.name)} <span class="min-fapp">on ${esc(x.name)}</span></span>
      <span class="rmeta">${w.dot ? `<i class="dot" style="--c:var(--${w.dot})"></i>` : ''}<span class="ell">${esc(w.to)} · ${esc(w.what)}</span></span></span>${w.act ? I.chevR : ''}</${w.act ? 'button' : 'div'}>`;
  }).join('');
  const insight = !REAL ? (igWork >= 20
    ? `Social went from ${fmt(before.social)} to ${fmt(after.social)}: ${igWork} of Instagram’s 72 minutes were work today. Last week it was 38%.`
    : `Entertainment is ${fmt(after.entertainment)} of today, about a usual Thursday.`) : changeLine(before, after);
  const rule = REAL ? ruleOffer(ans) : { app: 'instagram', text: 'Instagram on the metro was research three times this week. Count it that way from now on, and stop asking?' };
  return `
    <div class="min-rec">
      <div class="rec-hero ${fresh ? 'fresh' : ''}">
        ${ring(1, 'as', 128, 12, { label: `Check-in done, ${nights(n)} in a row`, inner: `<span class="rec-n"><span class="rec-roll"><b class="met">${n - 1}</b><b class="met">${n}</b></span><small>${n === 1 ? 'night' : 'nights'}</small></span>` })}
        <h1 class="title1">Today is on the record</h1>
        <p class="sub">${fmt(todayMin())} sorted at ${hm(S.checkin.at ?? nowMin())} · ${nights(n)} in a row${S.checkin.source === 'agent' ? ` · filed by ${esc(AGENT.name)}` : ''}</p>
        ${weekRings(WEEK.map((w) => (w.today ? { ...w, done: true } : w)), dotRing, 26)}
      </div>
      <div class="sh"><h2>What changed</h2><span class="sh-count">before → after</span></div>
      <section class="surface min-card">${kindsGrid(after, { prev: before })}<p class="min-cnote">${esc(insight)}</p></section>
      ${rows ? `<div class="sh"><h2>Filed</h2><span class="sh-count">${filed.length} ${filed.length === 1 ? 'answer' : 'answers'}</span></div>
      <div class="group surface min-filed">${rows}</div>` : `<p class="note surface">Nothing to sort today: every app was clear on its own.</p>`}
      ${rule ? `<section class="surface min-card min-rule" data-app="${rule.app}" data-kind="${rule.kind ?? ''}">
        <p class="cc-why">${wynMark('xs')}<span>${esc(rule.text)}</span></p>
        <div class="min-rulea"><button class="btn sm" data-act="min-rule" data-v="always">From now on</button><button class="btn sm" data-act="min-rule" data-v="ask">Keep asking</button></div>
      </section>` : ''}
      <div class="sh"><h2>Worth keeping?</h2></div>
      <div class="pad"><label class="field min-keep"><input type="text" placeholder="One thing from today for the Brain" enterkeyhint="done" aria-label="One thing worth keeping from today"><button class="fbtn" data-act="min-keep" aria-label="Save to the Brain">${I.up}</button></label>
      <p class="min-keepx">A hook, a line from a video, an idea from something you saved.</p></div>
      <div class="pad min-reca">
        <button class="btn primary block" style="--c:var(--as-fill)" data-act="min-journal">Write tonight’s journal${I.arrowR}</button>
        <div class="min-recb"><button class="btn block" data-act="min-ci-edit">Change answers</button><button class="btn block" data-act="pop">Done</button></div>
      </div>
    </div>`;
}
function wireRecord(sc) {
  const inp = $('.min-keep input', sc);
  inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); keep(sc); } });
}
function keep(sc) {
  const inp = $('.min-keep input', sc); const v = inp?.value.trim();
  if (!v) { inp?.focus(); return; }
  api.remember(v, { aspect: 'mind' });
  inp.value = '';
  $('.min-keepx', sc).textContent = `Saved to the Brain: “${v}”`;
}
on('min-keep', (el) => keep(el.closest('.scroll')));
on('min-rule', (el) => {
  const box = el.closest('.min-rule');
  const id = box.dataset.app, kind = box.dataset.kind, x = app(id);
  if (el.dataset.v === 'always' && REAL && kind) saveAppRule(id, { kind, ask: false, rule_at: new Date().toISOString() });
  const kn = KINDS.find((k) => k.id === kind)?.name.toLowerCase() ?? 'what you said';
  box.innerHTML = `<p class="cc-why">${wynMark('xs')}<span>${el.dataset.v === 'always' ? (REAL ? `Done. ${esc(x?.name ?? id)} counts as ${kn} from now on, and I stop asking. Change it on its page.` : 'Done. Instagram on the metro counts as research now; I’ll still ask about the feed at night.') : 'Fine, I’ll keep asking. It takes you two taps.'}</span></p>`;
  haptic(6);
});
// the biggest change the answers made, in one sentence
function changeLine(before, after) {
  const d = KINDS.map((k) => [k, (after[k.id] ?? 0) - (before[k.id] ?? 0)]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  if (!d || Math.abs(d[1]) < 1) return `Your answers matched ${AGENT.name}’s first sort. Work ${fmt(after.work)}, entertainment ${fmt(after.entertainment)}.`;
  return `${d[0].name} went from ${fmt(before[d[0].id])} to ${fmt(after[d[0].id])} once you said what the time was for.`;
}
// when one block got a single clear answer, offer to stop asking about that app
function ruleOffer(ans) {
  const one = Object.entries(ans).filter(([aid, list]) => list.length === 1 && app(aid)).sort((a, b) => b[1][0][1] - a[1][0][1])[0];
  if (!one) return null;
  const [aid, [[lid]]] = one; const lb = labelOf(aid, lid); const x = app(aid);
  if (!lb || !x) return null;
  return { app: aid, kind: lb.kind, text: `${x.name} was all ${lb.name.toLowerCase()} today. Count it as ${KINDS.find((k) => k.id === lb.kind)?.name.toLowerCase()} from now on, and stop asking?` };
}
on('min-ci-edit', () => { pop(); setTimeout(() => openCheckin({ edit: true }), 380); });
on('min-person', (el) => api.openPerson(el.dataset.id));

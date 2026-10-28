// Mind · the library: a book's page, a reading session (Bookly-style timer, then "which page?"), the log sheet
// (the app's primary action: tell Wyn in a sentence, or pick one), the notes review (Readwise-style), the ISBN
// barcode scan (native live scanner, else type it) and the Scan button's book handler. Owner: the Mind agent. Prefix min-.
// Every change shows at once and is saved through mind-data's save* functions (phone first, the PC when it answers).
import { $, $$, esc, push, on, ring, pulse, openSheet, closeSheet, toast, haptic, setRing } from '../core.js';
import { I } from '../icons.js';
import { api } from '../bus.js';
import { AGENT } from '../data.js';
import * as API from '../svc/api.js';
import { native } from '../svc/native-plugins.js';
import {
  S, BOOKS, book, fmt, pace, bookMin, READ_GOAL, NOTES, COURSES, YEAR_GOAL, finished, REAL, prog, today, derive, READ_WEEK, READ_GOAL_ID,
  COL, persistReading, saveBook, addBook as addBookDoc, saveHighlight, markReviewed, removeSession, saveSession, saveScreen, appWord, phoneApp, APP_NAMES,
} from './mind-data.js';
import { MI, cover, wynMark, meter, refreshMind, growIn, ensureMind } from './mind-ui.js';

const asRing = (p, size, w, o) => ring(p, 'as', size, w, o);
const STATUS = { reading: 'Reading', paused: 'Paused', next: 'Up next', done: 'Finished' };
const firstBook = () => BOOKS.find((b) => b.status === 'reading') ?? BOOKS.find((b) => b.status === 'paused') ?? BOOKS.find((b) => b.status === 'next') ?? null;
const readStreak = () => { let n = 0; for (let i = READ_WEEK.length - 1; i >= 0; i--) { if (READ_WEEK[i][1] > 0) n++; else if (i !== READ_WEEK.length - 1) break; } return n; };
const redrawPages = () => $$('#stack .page.min-bp').forEach((p) => p._redraw?.());
const after = () => { derive(); refreshMind('home', 'library'); redrawPages(); };
// at his recent pace and the days he reads, when this book ends
function finishLine(b) {
  if (!b.pages || !b.sessions?.length) return '';
  const days = new Set(b.sessions.map((s) => s[0])).size || 1;
  const perDay = bookMin(b) / days;
  const left = (b.pages - b.page) / pace(b);
  const d = Math.max(1, Math.ceil(left / Math.max(5, perDay)));
  const end = new Date(Date.parse(`${today()}T12:00:00Z`) + d * 864e5);
  return `At ${Math.round(perDay)} minutes a reading day you finish around ${end.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' })}.`;
}

// ═════════════ a book ═════════════
export function openBook(id) {
  const b = book(id); if (!b) return;
  const page = push({ title: b.title, back: 'Library', aspect: 'mind', cls: 'min-bp', render(sc) { draw(sc); } });
  function draw(sc) {
    const p = prog(b);
    const pc = pace(b);
    const left = b.pages ? (b.pages - (b.page ?? 0)) / pc : null;
    const notes = NOTES.filter((n) => n.book === b.id);
    sc.innerHTML = `
      <div class="min-bph pad">
        ${cover(b, 116)}
        <div class="min-bpt">
          <span class="pill plain">${b.status === 'done' ? `Finished${b.done ? ` in ${esc(b.done)}` : ''}` : STATUS[b.status]}</span>
          <h1 class="title1">${esc(b.title)}</h1>
          <p class="sub">${esc(b.author)}${b.pages ? ` · ${b.pages} pages` : ''}</p>
        </div>
      </div>
      ${!b.pages && b.status !== 'done' ? `<div class="pad"><label class="field min-pgs"><input type="number" inputmode="numeric" min="1" max="3000" placeholder="How many pages does it have?" aria-label="Number of pages"><button class="fbtn" data-act="min-bk-pages" data-id="${b.id}" aria-label="Save the page count">${I.check}</button></label></div>` : ''}
      ${b.status === 'reading' || b.status === 'paused' ? `
      <section class="surface min-card min-bpp">
        <div class="min-bkp"><span class="met">${b.pages ? `${Math.round(p * 100)}%` : `p. ${b.page}`}</span><span>${b.pages ? `page ${b.page} of ${b.pages}` : `page ${b.page}`}</span></div>
        ${meter(p)}
        <div class="min-stats">
          <span><b class="met">${fmt(bookMin(b))}</b><small>read</small></span>
          <span><b class="met">${b.sessions?.length ?? 0}</b><small>sessions</small></span>
          <span><b class="met">${Math.round(pc * 60)}</b><small>pages an hour</small></span>
          <span><b class="met">${left != null ? fmt(left) : '–'}</b><small>left at your pace</small></span>
        </div>
        ${b.status === 'reading' ? (REAL ? (finishLine(b) ? `<p class="min-cnote">${finishLine(b)}</p>` : '') : `<p class="min-cnote">At 26 minutes a night you finish around Tue 3 November.${b.plan ? ` Tonight is on your calendar at ${b.plan.at}: ${b.plan.pages} pages.` : ''}</p>`)
          : `<p class="min-cnote">Paused${b.last ? ` since ${esc(b.last)}` : ''}. Pick it back up when the one you're reading is done, or take it off the list.</p>`}
      </section>
      <div class="pad min-bka"><button class="btn tint" style="--c:var(--as-ink)" data-act="min-read" data-id="${b.id}">${MI.timer}Start reading</button><button class="btn" data-act="min-pages" data-id="${b.id}">${MI.pages}Log pages</button></div>` : ''}
      ${b.status === 'next' ? `<div class="pad min-bka one"><button class="btn tint" style="--c:var(--as-ink)" data-act="min-book-start" data-id="${b.id}">Start this book</button></div>` : ''}
      ${b.why ? `<div class="sh"><h2>Why this book</h2></div><p class="note surface min-whyb">${esc(b.why)}</p>` : ''}
      ${notes.length ? `<div class="sh"><h2>Notes and highlights</h2><span class="sh-count">${notes.length}</span></div>
        <div class="group surface">${notes.map((n) => `<div class="row min-nrow"><span class="rbody"><span class="rtitle wrap">${n.kind === 'highlight' ? `“${esc(n.text)}”` : esc(n.text)}</span><span class="rmeta">${n.page ? `p. ${n.page} · ` : ''}${n.kind === 'highlight' ? 'highlight' : 'your note'}</span></span></div>`).join('')}</div>` : ''}
      ${b.sessions?.length ? `<div class="sh"><h2>Sessions</h2><span class="sh-count">${b.sessions.length}</span></div>
        <div class="group surface min-sesl">${b.sessions.map(([d, m, a, z]) => `<div class="row"><span class="rbody"><span class="rtitle">${esc(d)}</span><span class="rmeta">pages ${a}–${z}</span></span><span class="rend"><b class="met">${fmt(m)}</b><span>${z - a} pages</span></span></div>`).join('')}</div>` : ''}
      <div class="sh"><h2>Add to it</h2></div>
      <div class="group surface">
        <button class="row ic" data-act="min-hl-add" data-id="${b.id}"><span class="tile">${MI.note}</span><span class="rbody"><span class="rtitle">A highlight or a note</span><span class="rmeta">Type the line, or scan the page</span></span>${I.chevR}</button>
        ${b.status !== 'done' && b.status !== 'next' ? `<button class="row ic" data-act="min-goal"><span class="tile">${I.target}</span><span class="rbody"><span class="rtitle">Read ${YEAR_GOAL} books this year</span><span class="rmeta">${finished()} of ${YEAR_GOAL} · this one makes ${finished() + 1}</span></span>${I.chevR}</button>` : ''}
        ${b.status === 'reading' ? `<button class="row ic" data-act="min-bk-status" data-id="${b.id}" data-v="paused"><span class="tile">${I.pause}</span><span class="rbody"><span class="rtitle">Pause it</span><span class="rmeta">It stays on the shelf, off today's list</span></span></button>` : ''}
        ${b.status === 'paused' ? `<button class="row ic" data-act="min-bk-status" data-id="${b.id}" data-v="reading"><span class="tile">${I.play}</span><span class="rbody"><span class="rtitle">Pick it back up</span><span class="rmeta">Back on reading now</span></span></button>` : ''}
        ${b.status === 'reading' || b.status === 'paused' ? `<button class="row ic" data-act="min-bk-status" data-id="${b.id}" data-v="done"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle">Finished it</span><span class="rmeta">Onto this year's shelf</span></span></button>` : ''}
      </div>`;
    const inp = $('.min-pgs input', sc);
    inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('[data-act="min-bk-pages"]', sc)?.click(); } });
  }
  page._redraw = () => { const sc = $('.scroll', page); draw(sc); pulse(sc); growIn(sc); };
  growIn(page);
}
on('min-book-start', (el) => {
  const b = book(el.dataset.id); if (!b) return;
  const was = { status: b.status, page: b.page, sessions: b.sessions };
  b.status = 'reading'; b.page = b.page ?? 0; b.sessions = b.sessions ?? [];
  saveBook(b.id, { status: 'reading', started: today() });
  toast(`${b.title} is on your reading-now shelf`, () => { Object.assign(b, was); saveBook(b.id, { status: was.status }); refreshMind('library'); redrawPages(); });
  refreshMind('home', 'library');
  el.closest('.page')?._redraw?.();
});
on('min-bk-status', (el) => {
  const b = book(el.dataset.id); if (!b) return;
  const v = el.dataset.v, was = b.status;
  b.status = v; if (v === 'done') { b.page = b.pages ?? b.page; b.finishedOn = today(); }
  saveBook(b.id, { status: v, ...(v === 'done' ? { finished: today(), page: b.pages ?? b.page } : {}) });
  haptic(v === 'done' ? 14 : 6);
  toast(v === 'done' ? `${b.title} is on the shelf · ${finished()} of ${YEAR_GOAL}` : v === 'paused' ? `Paused ${b.title}` : `${b.title} is back on reading now`, () => { b.status = was; saveBook(b.id, { status: was, finished: null }); after(); });
  after();
});
on('min-bk-pages', (el) => {
  const b = book(el.dataset.id); const inp = el.closest('.field')?.querySelector('input'); const n = Math.round(Number(inp?.value));
  if (!b || !(n > 0 && n < 5000)) { inp?.focus(); return; }
  b.pages = n; saveBook(b.id, { pages: n }); haptic(6); after();
});

// ═════════════ a reading session ═════════════
let T = null;   // the running session: { b, start, t0, acc, paused, iv, page }
export function startSession(id) {
  const b = book(id) ?? firstBook();
  if (!b) { openLog({ mode: 'book' }); return; }
  if (T?.iv) clearInterval(T.iv);
  T = { b, start: b.page ?? 0, t0: performance.now(), acc: 0, paused: false, iv: null, end: null };
  window.__minSess = T;   // for screenshots: __minSess.acc = 1860000 pretends 31 minutes have passed
  // the Lock Screen keeps counting (Live Activity), where the build has it
  native.live?.start?.({ kind: 'focus', title: `Reading ${b.title}`, minutes: READ_GOAL }).then((r) => { if (T) T.live = r?.id ?? null; }).catch(() => {});
  push({
    title: 'Reading', back: 'Back', aspect: 'mind', cls: 'min-sess',
    onPop: () => { if (T?.iv) clearInterval(T.iv); endLive(); },
    render(sc) {
      sc.innerHTML = `
        <div class="min-ss">
          <div class="min-ssc">${cover(b, 132)}</div>
          <p class="min-sst"><b>${esc(b.title)}</b><span>From page ${T.start}${b.sessions?.length ? ` · ${Math.round(pace(b) * 60)} pages an hour lately` : ''}</span></p>
          <b class="met min-sstime" aria-live="off">0:00</b>
          <p class="min-ssg">${asRing(S.readToday / READ_GOAL, 24, 4)}<span class="min-ssgt">${S.readToday ? `${S.readToday} of ${READ_GOAL} min today` : `Today’s goal: ${READ_GOAL} minutes`}</span></p>
          <div class="min-ssa"><button class="btn min-sspause" data-act="min-ss-pause">${I.pause}Pause</button><button class="btn primary" style="--c:var(--as-fill)" data-act="min-ss-end">Finish</button></div>
          <div class="min-ssx"><button class="btn sm" data-act="min-scan-page">${I.scan}Scan a line</button><button class="btn sm" data-act="min-ss-note">${MI.note}Add a thought</button></div>
          <div class="min-ssnote" hidden><label class="field"><input type="text" placeholder="A thought from this page" aria-label="A thought from this page" enterkeyhint="done"><button class="fbtn" data-act="min-ss-note-save" aria-label="Save the thought">${I.up}</button></label></div>
          <p class="hint min-ssh">Pages come at the end.</p>
        </div>
        <div class="min-ssend" hidden></div>`;
      $('.min-ssnote input', sc)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveThought(); } });
      tick();
      T.iv = setInterval(tick, 1000);
    },
  });
}
const endLive = () => { if (T?.live) native.live?.end?.({ id: T.live }).catch(() => {}); };
const elapsed = () => (T ? T.acc + (T.paused ? 0 : performance.now() - T.t0) : 0);
function tick() {
  const el = $('.min-sstime'); if (!el || !T) return;
  const s = Math.floor(elapsed() / 1000);
  el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const m = Math.floor(s / 60), td = S.readToday + m;
  const g = $('.min-ssg .rg'); if (g) setRing(g, td / READ_GOAL, { bleed: false });
  const gt = $('.min-ssgt'); if (gt && m) gt.textContent = td >= READ_GOAL ? `${td} min today · goal met` : `${td} of ${READ_GOAL} min today`;
}
on('min-ss-pause', (el) => {
  if (!T) return;
  if (T.paused) { T.paused = false; T.t0 = performance.now(); el.innerHTML = `${I.pause}Pause`; }
  else { T.acc += performance.now() - T.t0; T.paused = true; el.innerHTML = `${I.play}Resume`; }
  haptic(6); tick();
});
on('min-ss-end', () => {
  if (!T) return;
  if (!T.paused) { T.acc += performance.now() - T.t0; T.paused = true; }
  clearInterval(T.iv);
  const m = Math.max(1, Math.round(elapsed() / 60000));
  const guess = Math.max(1, Math.round(m * pace(T.b)));
  T.end = { m, page: T.b.pages ? Math.min(T.b.pages, T.start + guess) : T.start + guess };
  const box = $('.min-ssend'); const main = $('.min-ss');
  main.hidden = true; box.hidden = false;
  box.innerHTML = pageAsk();
  haptic(8);
});
function pageAsk() {
  const { b, start, end } = T;
  return `<div class="min-ssq">
    <p class="kicker c-as">${fmt(end.m)} read</p>
    <h1 class="title1">Which page did you stop at?</h1>
    <div class="min-pgp" role="group" aria-label="Page you stopped at">
      <button class="min-pgb" data-act="min-pg" data-d="-1" aria-label="One page less">${I.minus}</button>
      <span class="min-pgv"><b class="met">${end.page}</b><small>${b.pages ? `of ${b.pages}` : 'page'}</small></span>
      <button class="min-pgb" data-act="min-pg" data-d="1" aria-label="One page more">${I.plus}</button>
    </div>
    <div class="chips min-pgc">${[10, 15, 20, 25, 30].map((n) => `<button class="chip ${start + n === end.page ? 'on' : ''}" data-act="min-pgset" data-v="${start + n}">+${n}</button>`).join('')}</div>
    <p class="min-pgn">${end.page - start} pages from ${start}. ${esc(AGENT.name)} guessed from your pace; fix it if she’s off.</p>
    <button class="btn primary block" style="--c:var(--as-fill)" data-act="min-ss-save">Save session</button>
  </div>`;
}
on('min-ss-note', () => { const box = $('.min-ssnote'); if (!box) return; box.hidden = !box.hidden; if (!box.hidden) $('input', box)?.focus(); });
on('min-ss-note-save', () => saveThought());
function saveThought() {
  const inp = $('.min-ssnote input'); const v = inp?.value.trim(); if (!v || !T) { inp?.focus(); return; }
  const n = { id: `n${Date.now()}`, book: T.b.id, page: T.start, kind: 'note', text: v };
  if (REAL) saveHighlight(n); else NOTES.unshift(n);
  inp.value = ''; $('.min-ssnote').hidden = true;
  toast(`Saved to ${T.b.title}`); haptic(6);
}
const clampPage = (b, p, min) => Math.max(min, b.pages ? Math.min(b.pages, p) : p);
on('min-pg', (el) => { if (!T?.end) return; T.end.page = clampPage(T.b, T.end.page + Number(el.dataset.d), T.start + 1); repaintAsk(); haptic(4); });
on('min-pgset', (el) => { if (!T?.end) return; T.end.page = clampPage(T.b, Number(el.dataset.v), T.start); repaintAsk(); haptic(5); });
function repaintAsk() { const box = $('.min-ssend'); if (box) box.innerHTML = pageAsk(); }
on('min-ss-save', () => {
  if (!T?.end) return;
  const { b, start, end } = T;
  const pages = end.page - start;
  const before = S.readToday;
  b.sessions = [['Today', end.m, start, end.page], ...(b.sessions ?? [])];
  b.page = end.page; S.readToday += end.m;
  if (b.status !== 'reading') b.status = 'reading';
  persistReading(b, { minutes: end.m, from: start, to: end.page });
  S.log.push({ kind: 'reading', text: `${b.title}, ${end.m} min`, min: end.m });
  endLive();
  const box = $('.min-ssend');
  const td = S.readToday, metGoal = td >= READ_GOAL && before < READ_GOAL;
  const streak = REAL ? Math.max(1, readStreak()) : 5;
  box.innerHTML = `<div class="min-ssdone">
    ${asRing(Math.min(2, td / READ_GOAL), 120, 12, { label: `${td} of ${READ_GOAL} minutes today`, inner: `<span class="min-yri"><b class="met">${td}</b><small>of ${READ_GOAL} min</small></span>` })}
    <h1 class="title1">${metGoal ? 'Today’s reading, done' : 'Session saved'}</h1>
    <p class="sub">${fmt(end.m)} · ${pages} pages · now on page ${b.page}${b.pages ? ` of ${b.pages}` : ''}</p>
    <div class="min-stats three"><span><b class="met">${streak}</b><small>${streak === 1 ? 'day' : 'days in a row'}</small></span><span><b class="met">${Math.round((pages / end.m) * 60)}</b><small>pages an hour</small></span><span><b class="met">${b.pages ? `${Math.round(prog(b) * 100)}%` : b.page}</b><small>${b.pages ? 'of the book' : 'page'}</small></span></div>
    <p class="cc-why">${wynMark('xs')}<span>${td >= READ_GOAL ? (REAL ? `${streak > 1 ? `${streak} days in a row. ` : ''}That's today's ring closed.` : 'Five nights in a row. I moved tonight’s 21:30 block to tomorrow, since it’s done.') : `${READ_GOAL - td} minutes more closes today’s ring.`}</span></p>
    <button class="btn primary block" style="--c:var(--as-fill)" data-act="pop">Done</button>
  </div>`;
  pulse(box);
  haptic(12);
  refreshMind('home', 'library');
  T = null;
});

// ═════════════ the log sheet (the round button) ═════════════
function suggestions() {
  if (!REAL) return [['Atomic Habits, 30 min', 'Read Atomic Habits for 30 minutes'], ['Lesson 8 of the Roadmap', 'Watched lesson 8 of the Roadmap'], ['15 pages of $100M Leads', 'Read 15 pages of $100M Leads'], ['A podcast, 20 min', 'Listened to a podcast for 20 minutes']];
  const b = firstBook(), c = COURSES.find((x) => x.status === 'active');
  return [
    b ? [`${b.title}, 30 min`, `Read ${b.title} for 30 minutes`] : null,
    c ? [`A lesson of ${c.title}`, `Watched a lesson of ${c.title}`] : null,
    ['Instagram, 30 min', 'Instagram 30 minutes on my phone'],
    ['A podcast, 20 min', 'Listened to a podcast for 20 minutes'],
  ].filter(Boolean);
}
export function openLog(opts = {}) {
  const fb = firstBook();
  const st = { text: opts.text ?? '', mode: opts.mode ?? 'say', book: opts.book ?? fb?.id ?? null, pages: null, min: opts.minutes ?? 20, app: 'instagram', smin: 30 };
  if (opts.mode === 'reading' && opts.book && !opts.text) st.text = `Read ${book(opts.book)?.title ?? opts.book}${opts.minutes ? ` for ${opts.minutes} minutes` : ''}`;
  if (opts.mode === 'reading') st.mode = 'say';
  const el = openSheet({
    title: st.mode === 'book' ? 'Add a book' : st.mode === 'screen' ? 'Phone time' : 'Log to Mind',
    sub: st.mode === 'book' ? 'Its title, or the ISBN under the barcode' : st.mode === 'screen' ? 'Until Screen Time is switched on, tell Wyn here' : `Tell ${AGENT.name} what you read, watched or learned`, cls: 'min-logs',
    body: (b) => { b.innerHTML = logBody(st); },
    foot: `<div class="min-lgfoot"><button class="btn primary block" style="--c:var(--as-fill)" data-act="min-lg-go" disabled>Log it</button></div>`,
  });
  el.dataset.aspect = 'mind';   // a sheet sits outside the app's page: give it the app's colour
  el._st = st;
  const ta = $('.min-lgt', el);
  ta?.addEventListener('input', () => { st.text = ta.value; paintParse(el); });
  ta?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(el); } });
  const bt = $('.min-lgbt', el);
  bt?.addEventListener('input', () => { st.btext = bt.value; paintBook(el); });
  bt?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(el); } });
  if (st.mode === 'pages') paintPages(el); else if (st.mode === 'book') paintBook(el); else if (st.mode === 'screen') paintScreen(el); else paintParse(el);
  return el;
}
function logBody(st) {
  const b = book(st.book), c = COURSES.find((x) => x.status === 'active');
  if (st.mode === 'book') return `<div class="pad min-lgtop"><div class="field min-lgf"><input class="min-lgbt" type="text" placeholder="Atomic Habits, or 9780735211292" aria-label="Book title or ISBN" enterkeyhint="done"><button class="fbtn" data-act="min-scan" aria-label="Scan the barcode">${I.scan}</button></div>
    <div class="min-lgp" aria-live="polite"></div>
    <div class="chips min-lgs">${['next', 'reading'].map((v) => `<button class="chip sm ${v === (st.bstatus ?? 'next') ? 'on' : ''}" data-act="min-lg-bstat" data-v="${v}">${v === 'next' ? 'Up next' : 'Reading now'}</button>`).join('')}</div></div>`;
  if (st.mode === 'screen') return `<div class="min-lgscreen pad"></div>`;
  return `
    <div class="pad min-lgtop" ${st.mode === 'pages' ? 'hidden' : ''}>
      <div class="field min-lgf"><textarea class="min-lgt" rows="1" enterkeyhint="done" placeholder="${esc(b ? `I read ${b.title} for 30 minutes` : 'I read 20 pages of a book')}" aria-label="What did you read, watch or learn">${esc(st.text)}</textarea>
        <button class="fbtn" data-act="min-lg-mic" aria-label="Say it">${I.mic}</button></div>
      <div class="min-lgp" aria-live="polite"></div>
      <div class="chips min-lgs">${suggestions().map(([l, t]) => `<button class="chip sm" data-act="min-lg-sug" data-t="${esc(t)}">${esc(l)}</button>`).join('')}</div>
    </div>
    <div class="min-lgpages" ${st.mode === 'pages' ? '' : 'hidden'}></div>
    <p class="min-lbl pad">Or pick one</p>
    <div class="min-lgg pad">
      <button class="min-lgk surface" data-act="min-lg-timer">${MI.timer}<b>Reading session</b><span>${b ? 'A timer while you read' : 'Add a book first'}</span></button>
      <button class="min-lgk surface" data-act="min-lg-pages">${MI.pages}<b>Pages read</b><span>${b ? `From page ${b.page ?? 0} on` : 'Add a book first'}</span></button>
      <button class="min-lgk surface" data-act="min-lg-lesson">${MI.cap}<b>A lesson</b><span>${c ? `${esc(c.title)}, lesson ${REAL ? c.cur + 1 : c.done}` : 'Pick a course'}</span></button>
      <button class="min-lgk surface" data-act="min-lg-screen">${MI.phone}<b>Phone time</b><span>An app and how long</span></button>
    </div>`;
}
// what the sentence says: the kind, the book or lesson, minutes, pages; or an app and its minutes
const findBookIn = (t) => BOOKS.filter((b) => b.title).sort((a, b) => b.title.length - a.title.length)
  .find((b) => t.includes(b.title.toLowerCase()) || t.includes(b.title.toLowerCase().replace(/^the /, '')) || (b.title.length > 6 && t.includes(b.title.toLowerCase().split(/[:(]/)[0].trim())));
function parse(text) {
  const t = text.toLowerCase();
  if (!t.trim()) return null;
  const out = { kind: null, book: null, min: null, pages: null, lesson: null, app: null, title: null };
  const mm = t.match(/(\d+)\s*(?:min|mins|minute|minutes|m)\b/) ?? null;
  const hh = t.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/);
  if (mm) out.min = Number(mm[1]); else if (hh) out.min = Math.round(Number(hh[1]) * 60);
  else if (/half an hour/.test(t)) out.min = 30; else if (/an hour/.test(t)) out.min = 60;
  if (mm && hh) out.min = Math.round(Number(hh[1]) * 60) + Number(mm[1]);
  const pg = t.match(/(\d+)\s*pages?/); if (pg) out.pages = Number(pg[1]);
  const b = findBookIn(t); if (b) out.book = b.id;
  const c = COURSES.find((x) => t.includes(x.title.toLowerCase())) ?? (/lesson|course|skool/.test(t) ? COURSES.find((x) => x.status === 'active') : null);
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  const ap = words.map(appWord).find(Boolean);
  if (c && /lesson|course|skool|watched/.test(t)) { out.kind = 'lesson'; out.lesson = c.id; }
  else if (ap && !out.book && !/\bread\b|reading|pages?\b/.test(t)) { out.kind = 'screen'; out.app = ap; }
  else if (out.book || /\bread\b|reading|book|pages?/.test(t)) {
    out.kind = 'reading';
    if (!out.book) { const m = /(?:read|reading)\s+(?:\d+\s*pages?\s+of\s+)?(.+?)(?:\s+for\s+|\s+\d|$)/.exec(text.trim()); const title = m?.[1]?.replace(/^(the book|a book)\s*/i, '').trim(); out.title = title && title.length > 2 && !/^(a|some|my)$/i.test(title) ? title : null; out.book = out.title ? null : firstBook()?.id ?? null; }
  } else if (/watch|video|youtube|listen|podcast|film|episode|class|lecture/.test(t)) out.kind = /listen|podcast/.test(t) ? 'listened' : 'watched';
  if (!out.kind) return null;
  if (out.kind === 'reading') {
    const bk = book(out.book);
    const pc = pace(bk);
    if (out.min && !out.pages) out.pages = Math.max(1, Math.round(out.min * pc));
    if (out.pages && !out.min) out.min = Math.max(1, Math.round(out.pages / pc));
    if (!bk && !out.title) return null;
  }
  return out;
}
function paintParse(el) {
  const st = el._st; const p = parse(st.text); st.p = p;
  const box = $('.min-lgp', el); const go = $('[data-act="min-lg-go"]', el);
  go.disabled = !p || (['reading', 'watched', 'listened', 'screen'].includes(p.kind) && !p.min && !p.pages);
  if (!p) { box.innerHTML = st.text.trim() ? `<p class="min-cnote">Say what it was and for how long: “Read Deep Work for 20 minutes”.</p>` : ''; return; }
  const chip = (icon, t) => `<span class="min-pchip">${icon}${esc(t)}</span>`;
  const b = p.book ? book(p.book) : null;
  const parts = [];
  if (p.kind === 'reading') { parts.push(chip(I.read, 'Reading'), chip(I.book, b ? b.title : `${p.title} · new`)); if (p.min) parts.push(chip(I.clock, fmt(p.min))); if (p.pages) parts.push(chip(MI.pages, b ? `≈ ${p.pages} pages → p. ${b.pages ? Math.min(b.pages, (b.page ?? 0) + p.pages) : (b.page ?? 0) + p.pages}` : `≈ ${p.pages} pages`)); }
  if (p.kind === 'lesson') { const c = COURSES.find((x) => x.id === p.lesson); const i = REAL ? c.cur : c.done; parts.push(chip(MI.cap, 'Lesson'), chip(I.play, `${c.title} · ${i + (REAL ? 1 : 0)}. ${c.lessons[i]?.[0] ?? ''}`)); if (p.min) parts.push(chip(I.clock, fmt(p.min))); }
  if (p.kind === 'watched' || p.kind === 'listened') { parts.push(chip(p.kind === 'watched' ? I.content : MI.phones, p.kind === 'watched' ? 'Watched' : 'Listened')); if (p.min) parts.push(chip(I.clock, fmt(p.min))); parts.push(chip(I.sparkle, 'Counts as learning')); }
  if (p.kind === 'screen') { parts.push(chip(MI.phone, 'Phone time'), chip(I.grid, phoneApp(p.app).name)); if (p.min) parts.push(chip(I.clock, fmt(p.min))); }
  box.innerHTML = `<div class="min-pchips">${parts.join('')}</div>`;
  go.textContent = p.kind === 'lesson' ? 'Open the lesson' : 'Log it';
}
function paintPages(el) {
  const st = el._st; const b = book(st.book);
  const box = $('.min-lgpages', el); box.hidden = false; $('.min-lgtop', el).hidden = true;
  const go = $('[data-act="min-lg-go"]', el);
  if (!b) { box.innerHTML = `<p class="note surface pad">Add the book first: scan its barcode or type its title.</p>`; go.disabled = true; return; }
  if (st.pages == null) st.pages = clampPage(b, (b.page ?? 0) + 18, (b.page ?? 0) + 1);
  const books = BOOKS.filter((x) => x.status === 'reading' || x.status === 'paused');
  box.innerHTML = `<div class="pad">
    <div class="chips min-lgbk">${books.map((x) => `<button class="chip ${x.id === st.book ? 'on' : ''}" data-act="min-lg-book" data-id="${x.id}">${esc(x.title)}</button>`).join('')}</div>
    <div class="surface min-card min-lgpg">
      <span class="min-lgpl">Read from page ${b.page ?? 0} to</span>
      <div class="min-pgp"><button class="min-pgb" data-act="min-lg-pg" data-d="-1" aria-label="One page less">${I.minus}</button>
        <span class="min-pgv"><b class="met">${st.pages}</b><small>${b.pages ? `of ${b.pages}` : 'page'}</small></span>
        <button class="min-pgb" data-act="min-lg-pg" data-d="1" aria-label="One page more">${I.plus}</button></div>
      <span class="min-lgpl">in</span>
      <div class="chips min-lgmin">${[10, 15, 20, 30, 45, 60].map((m) => `<button class="chip sm ${st.min === m ? 'on' : ''}" data-act="min-lg-min" data-v="${m}">${m} min</button>`).join('')}</div>
    </div></div>`;
  go.disabled = false; go.textContent = `Log ${st.pages - (b.page ?? 0)} pages`;
  st.mode = 'pages';
}
function paintScreen(el) {
  const st = el._st; st.mode = 'screen';
  const box = $('.min-lgscreen', el) ?? (() => { const top = $('.min-lgtop', el); if (top) top.hidden = true; const d = document.createElement('div'); d.className = 'min-lgscreen pad'; $('.min-lgpages', el)?.after(d); $$('.min-lbl, .min-lgg', el).forEach((x) => { x.hidden = true; }); return d; })();
  box.innerHTML = `<p class="min-lbl">Which app</p>
    <div class="chips min-lgapp">${APP_NAMES.slice(0, 10).map(([id, n]) => `<button class="chip sm ${st.app === id ? 'on' : ''}" data-act="min-lg-app" data-id="${id}">${esc(n)}</button>`).join('')}</div>
    <p class="min-lbl">How long</p>
    <div class="chips min-lgmin">${[10, 15, 20, 30, 45, 60, 90].map((m) => `<button class="chip sm ${st.smin === m ? 'on' : ''}" data-act="min-lg-smin" data-v="${m}">${fmt(m)}</button>`).join('')}</div>
    <p class="min-cnote">${esc(AGENT.name)} files it under this hour. Screen Time takes over once it's switched on.</p>`;
  const go = $('[data-act="min-lg-go"]', el); go.disabled = false; go.textContent = `Log ${fmt(st.smin)} of ${phoneApp(st.app).name}`;
}
// a new book: a title, or an ISBN (looked up on the PC: Open Library, then Google Books)
let isbnT = 0;
function paintBook(el) {
  const st = el._st; st.mode = 'book';
  const v = String(st.btext ?? '').trim(); const box = $('.min-lgp', el); const go = $('[data-act="min-lg-go"]', el);
  const digits = v.replace(/[^0-9Xx]/g, '');
  const isIsbn = /^(\d{9}[\dXx]|\d{13})$/.test(digits) && digits.length === v.replace(/[\s-]/g, '').length;
  if (isIsbn && st.found?.isbn === digits) { box.innerHTML = foundHtml(st.found); go.disabled = false; go.textContent = 'Add the book'; return; }   // a status tap: keep what was found
  st.found = null;
  if (isIsbn) {
    go.disabled = true; box.innerHTML = `<p class="min-cnote">Looking up ${esc(digits)}…</p>`;
    clearTimeout(isbnT);
    isbnT = setTimeout(async () => {
      const r = await lookupIsbn(digits);
      if (st.btext !== v) return;
      if (r?.title) { st.found = r; box.innerHTML = foundHtml(r); go.disabled = false; go.textContent = 'Add the book'; }
      else box.innerHTML = `<p class="min-cnote">${esc(r?.error ?? 'Couldn’t look that up right now.')} Type the title instead.</p>`;
    }, 250);
    return;
  }
  go.disabled = v.length < 2; go.textContent = 'Add the book';
  box.innerHTML = v.length >= 2 ? `<div class="min-pchips"><span class="min-pchip">${I.book}${esc(v)}</span><span class="min-pchip">${I.plus}${(st.bstatus ?? 'next') === 'next' ? 'Up next' : 'Reading now'}</span></div>` : '';
}
const foundHtml = (r) => `<div class="min-found surface">${cover({ title: r.title, author: r.author ?? '', tone: 3 }, 52)}<span><b>${esc(r.title)}</b><span>${esc(r.author ?? 'Author unknown')}${r.pages ? ` · ${r.pages} pages` : ''}</span></span></div>`;
export async function lookupIsbn(code) {
  if (!REAL) return { isbn: code, title: 'The Mom Test', author: 'Rob Fitzpatrick', pages: 136 };
  try { return await API.get(`/mod/mind/isbn/${encodeURIComponent(code)}`, { timeout: 12000 }); } catch (e) { return { error: e?.status ? e.message : 'The PC is offline, so the barcode can’t be looked up. Type the title.' }; }
}
on('min-lg-bstat', (el) => { const sh = el.closest('.sheet'); sh._st.bstatus = el.dataset.v; $$('[data-act="min-lg-bstat"]', sh).forEach((x) => x.classList.toggle('on', x === el)); paintBook(sh); haptic(4); });
on('min-lg-app', (el) => { const sh = el.closest('.sheet'); sh._st.app = el.dataset.id; paintScreen(sh); haptic(4); });
on('min-lg-smin', (el) => { const sh = el.closest('.sheet'); sh._st.smin = Number(el.dataset.v); paintScreen(sh); haptic(4); });
on('min-lg-screen', (el) => { const sh = el.closest('.sheet'); paintScreen(sh); haptic(5); });
on('min-lg-sug', (el) => { const sh = el.closest('.sheet'); const ta = $('.min-lgt', sh); ta.value = el.dataset.t; sh._st.text = ta.value; paintParse(sh); haptic(5); });
// say it: the phone's own speech recognition (native), else the keyboard's mic
let dict = null;
on('min-lg-mic', async (el) => {
  const sh = el.closest('.sheet'); const ta = $('.min-lgt', sh);
  if (dict) { const r = await native.speech.stop().catch(() => ({})); dict.off?.(); dict = null; el.classList.remove('on'); if (r?.text) { ta.value = r.text; sh._st.text = r.text; paintParse(sh); } return; }
  const r = await native.speech.start().catch(() => ({ available: false }));
  if (!r?.available || r.ok === false) { ta.focus(); toast('Use the mic on your keyboard to say it'); return; }
  el.classList.add('on'); haptic(6);
  dict = { off: native.speech.onPartial(({ text }) => { ta.value = text; sh._st.text = text; paintParse(sh); }) };
});
on('min-lg-timer', (el) => { const sh = el.closest('.sheet'); const id = sh?._st?.book; closeSheet(sh); setTimeout(() => ensureMind(null, () => (id ? startSession(id) : openLog({ mode: 'book' }))), 200); });
on('min-lg-pages', (el) => { const sh = el.closest('.sheet'); paintPages(sh); haptic(5); });
on('min-lg-lesson', (el) => { closeSheet(el.closest('.sheet')); const c = COURSES.find((x) => x.status === 'active'); setTimeout(() => (c ? api.openCourse(c.id) : ensureMind('courses')), 200); });
on('min-lg-book', (el) => { const sh = el.closest('.sheet'); sh._st.book = el.dataset.id; sh._st.pages = null; paintPages(sh); });
on('min-lg-pg', (el) => { const sh = el.closest('.sheet'); const st = sh._st; const b = book(st.book); st.pages = clampPage(b, st.pages + Number(el.dataset.d), (b.page ?? 0) + 1); paintPages(sh); haptic(4); });
on('min-lg-min', (el) => { const sh = el.closest('.sheet'); sh._st.min = Number(el.dataset.v); paintPages(sh); haptic(4); });
on('min-lg-go', (el) => go(el.closest('.sheet')));
function go(sh) {
  const st = sh._st;
  if (st.mode === 'book') {
    const v = String(st.btext ?? '').trim(); if (!st.found && v.length < 2) return;
    const f = st.found ?? { title: v };
    const b = newBook({ ...f, status: st.bstatus ?? 'next' });
    closeSheet(sh);
    if (b) setTimeout(() => ensureMind('library', () => openBook(b.id)), 220);
    return;
  }
  if (st.mode === 'screen') {
    if (REAL) saveScreen({ app: st.app, minutes: st.smin });
    toast(`Logged ${fmt(st.smin)} of ${phoneApp(st.app).name} on your phone`);
    haptic(8); closeSheet(sh); return;
  }
  if (st.mode === 'pages') {
    const b = book(st.book); if (!b) return;
    const from = b.page ?? 0;
    logReading({ book: b.id, minutes: st.min, pages: st.pages - from });
    closeSheet(sh); return;
  }
  const p = st.p ?? parse(st.text); if (!p) return;
  if (p.kind === 'reading') logReading({ book: p.book ?? p.title, minutes: p.min, pages: p.pages });
  else if (p.kind === 'lesson') { closeSheet(sh); setTimeout(() => api.openCourse(p.lesson), 200); return; }
  else if (p.kind === 'screen') { if (REAL) saveScreen({ app: p.app, minutes: p.min ?? 20 }); toast(`Logged ${fmt(p.min ?? 20)} of ${phoneApp(p.app).name} on your phone`); }
  else {
    S.log.push({ kind: p.kind, text: st.text, min: p.min ?? 0 });
    if (REAL) saveSession({ kind: p.kind, minutes: p.min ?? 20, title: st.text.slice(0, 120) });
    toast(`Logged ${fmt(p.min ?? 20)} ${p.kind === 'listened' ? 'of listening' : 'of watching'} as learning`);
    derive(); refreshMind('home', 'courses');
  }
  closeSheet(sh);
}
// a book into the library (real: a collection doc; demo: the sample list). Returns the view object
function newBook(f) {
  if (!REAL) {
    const b = { id: `b${Date.now()}`, title: f.title, author: f.author ?? 'Unknown author', pages: f.pages ?? 240, status: f.status ?? 'next', tone: 2, why: 'Scanned in from a cover.', sessions: [], page: 0 };
    BOOKS.push(b); refreshMind('library');
    toast(`${b.title} is on your ${b.status === 'reading' ? 'reading-now' : 'Up next'} shelf`, () => { BOOKS.splice(BOOKS.indexOf(b), 1); refreshMind('library'); });
    return b;
  }
  const r = addBookDoc(f);
  if (!r) return null;
  derive();
  const b = book(r.doc.id);
  if (r.already) toast(`${r.doc.title} is already in your library`);
  else toast(`${b.title} is on your ${b.status === 'reading' ? 'reading-now' : 'Up next'} shelf`, () => { COL.books.remove(b.id); after(); });
  haptic(10); after();
  return b;
}
// log a reading session without the timer: from the sheet, from Wyn ("I read Atomic Habits for 30 minutes")
export function logReading({ book: id, minutes = 20, pages = null } = {}) {
  let b = book(id) ?? (id ? BOOKS.find((x) => x.title.toLowerCase() === String(id).toLowerCase() || x.title.toLowerCase().includes(String(id).toLowerCase())) : null) ?? (id ? null : firstBook());
  if (!b && id && typeof id === 'string') b = newBook({ title: id, status: 'reading' });
  if (!b) { openLog({ mode: 'book' }); return; }
  const from = b.page ?? 0;
  const pg = pages ?? Math.max(1, Math.round(minutes * pace(b)));
  const to = b.pages ? Math.min(b.pages, from + pg) : from + pg;
  const snap = { page: b.page, sessions: b.sessions, read: S.readToday, status: b.status };
  b.sessions = [['Today', minutes, from, to], ...(b.sessions ?? [])]; b.page = to; S.readToday += minutes;
  if (b.status === 'next' || b.status === 'paused') b.status = 'reading';
  const ses = persistReading(b, { minutes, from, to });
  refreshMind('home', 'library'); redrawPages();
  haptic(10);
  toast(`${fmt(minutes)} of ${b.title} · now page ${to}`, () => {
    b.page = snap.page; b.sessions = snap.sessions; S.readToday = snap.read; b.status = snap.status;
    if (ses) { removeSession(ses.id); saveBook(b.id, { page: snap.page, status: snap.status }); }
    refreshMind('home', 'library'); redrawPages();
  });
}

// ═════════════ notes to look at again (Readwise-style review) ═════════════
export function openReview() {
  const queue = NOTES.filter((n) => !S.reviewed.has(n.id)).slice(0, Math.max(0, 3 - S.reviewed.size));
  if (!queue.length) { toast(NOTES.length ? 'Looked at today’s already' : 'No highlights yet: add one from a book’s page'); return; }
  let i = 0;
  const el = openSheet({
    title: 'To look at again', sub: `${queue.length} for today, the ones you haven’t seen in longest first`, cls: 'min-revs',
    body: (b) => { b.innerHTML = '<div class="min-rev pad"></div>'; },
  });
  el.dataset.aspect = 'mind';
  const paint = () => {
    const box = $('.min-rev', el);
    if (i >= queue.length) {
      box.innerHTML = `<div class="min-revdone">${asRing(1, 64, 7)}<b>That’s today’s ${queue.length === 1 ? 'one' : queue.length === 2 ? 'two' : 'three'}</b><span>Tomorrow brings more. Notes you mark “Keep” come back sooner.</span><button class="btn block" data-act="close-sheet">Done</button></div>`;
      pulse(box); refreshMind('library'); return;
    }
    const n = queue[i]; const b = book(n.book);
    box.innerHTML = `
      <div class="steps" style="--c:var(--as)">${queue.map((_, j) => `<i class="${j < i ? 'done' : j === i ? 'on' : ''}"></i>`).join('')}</div>
      <article class="surface min-revc">
        <span class="min-revk">${n.kind === 'highlight' ? 'Highlight' : 'Your note'}${b ? ` · ${esc(b.title)}` : ''}${n.page ? `, p. ${n.page}` : ''}</span>
        <p class="min-revq">${n.kind === 'highlight' ? `“${esc(n.text)}”` : esc(n.text)}</p>
        ${n.mine ? `<p class="min-nm">${MI.note}${esc(n.mine)}</p>` : ''}
      </article>
      <div class="min-reva">
        <button class="btn" data-act="min-rev" data-v="less">Show less</button>
        <button class="btn" data-act="min-rev" data-v="brain">To the Brain</button>
        <button class="btn primary" style="--c:var(--as-fill)" data-act="min-rev" data-v="keep">Keep</button>
      </div>`;
  };
  el._next = (v) => {
    const n = queue[i];
    if (v === 'brain') api.remember(n.mine ?? n.text, { aspect: 'mind' });
    S.reviewed.add(n.id); markReviewed(n.id, v); i += 1; haptic(6); paint();
  };
  paint();
}
on('min-rev', (el) => el.closest('.sheet')?._next?.(el.dataset.v));

// a highlight or a note on a book, typed (the Scan button reads one off a page)
on('min-hl-add', (el) => {
  const b = book(el.dataset.id); if (!b) return;
  const sh = openSheet({
    title: 'A highlight or a note', sub: b.title, cls: 'min-hls',
    body: (x) => { x.innerHTML = `<div class="pad"><div class="field min-lgf"><textarea class="min-hlt" rows="3" placeholder="The line, or your own thought" aria-label="The highlight or note"></textarea></div>
      <div class="chips min-lgs"><button class="chip sm on" data-act="min-hl-kind" data-v="highlight">Highlight</button><button class="chip sm" data-act="min-hl-kind" data-v="note">My note</button><button class="chip sm" data-act="min-scan-page">${I.scan}Scan the page</button></div>
      <label class="field min-hlp"><input type="number" inputmode="numeric" placeholder="Page ${b.page || ''}" aria-label="Page"></label></div>`; },
    foot: `<div class="min-lgfoot"><button class="btn primary block" style="--c:var(--as-fill)" data-act="min-hl-save">Save</button></div>`,
  });
  sh.dataset.aspect = 'mind'; sh._book = b.id; sh._kind = 'highlight';
});
on('min-hl-kind', (el) => { const sh = el.closest('.sheet'); sh._kind = el.dataset.v; $$('[data-act="min-hl-kind"]', sh).forEach((x) => x.classList.toggle('on', x === el)); });
on('min-hl-save', (el) => {
  const sh = el.closest('.sheet'); const v = $('.min-hlt', sh)?.value.trim(); if (!v) { $('.min-hlt', sh)?.focus(); return; }
  const page = Number($('.min-hlp input', sh)?.value) || book(sh._book)?.page || null;
  const n = { id: `n${Date.now()}`, book: sh._book, page, kind: sh._kind, text: v };
  if (REAL) saveHighlight(n); else NOTES.unshift(n);
  closeSheet(sh); toast('Saved to the book'); haptic(8); after();
});
on('min-scan-page', () => api.scan('book'));

// ═════════════ the ISBN barcode: the live scanner on the iPhone, else type it ═════════════
export async function scanIsbn() {
  const r = await native.scan.barcode().catch(() => ({ available: false }));
  if (r?.available && r.value) {
    haptic(10);
    const f = await lookupIsbn(r.value);
    if (f?.title) return confirmBook(f);
    toast(f?.error ?? 'No book found for that barcode');
    return openLog({ mode: 'book' });
  }
  if (r?.available && r.ok === false && !/cancel/i.test(r.error ?? '')) toast(r.error ?? 'The scanner didn’t start');
  if (!r?.available) openLog({ mode: 'book' });
}
function confirmBook(f) {
  const sh = openSheet({
    title: 'Add this book?', sub: f.isbn ? `ISBN ${f.isbn}` : '', cls: 'min-logs',
    body: (x) => { x.innerHTML = `<div class="pad">${foundHtml(f)}</div>`; },
    foot: `<div class="min-lgfoot min-bka"><button class="btn" data-act="min-bk-add" data-v="next">Up next</button><button class="btn primary" style="--c:var(--as-fill)" data-act="min-bk-add" data-v="reading">Reading now</button></div>`,
  });
  sh.dataset.aspect = 'mind'; sh._found = f;
}
on('min-bk-add', (el) => { const sh = el.closest('.sheet'); const b = newBook({ ...sh._found, status: el.dataset.v }); closeSheet(sh); if (b) setTimeout(() => ensureMind('library', () => openBook(b.id)), 220); });

// ═════════════ the one Scan button, kind "book" ═════════════
// result: { fields: { title, author, pages, page, text?, isbn? }, barcodes?: [{ value, type }] }.
// A barcode adds the book; a page with text becomes a highlight; a page number logs the pages; a new title goes on Up next
export async function handleBookScan(result = {}) {
  const f = result.fields ?? {};
  const code = f.isbn ?? (result.barcodes ?? []).find((x) => /ean|isbn/i.test(x.type ?? '') || /^97[89]\d{10}$/.test(x.value ?? ''))?.value;
  if (code && !f.title) {
    const r = await lookupIsbn(code);
    if (r?.title) return confirmBook(r);
  }
  const t = String(f.title ?? result.title ?? '').toLowerCase();
  let b = BOOKS.find((x) => x.title.toLowerCase() === t || (t && x.title.toLowerCase().includes(t))) ?? (!t && (f.text || f.page) ? firstBook() : null);
  if (b && f.text) {
    const n = { id: `n${Date.now()}`, book: b.id, page: f.page ?? b.page ?? null, kind: 'highlight', text: f.text };
    if (REAL) saveHighlight(n); else NOTES.unshift(n);
    toast(`Saved a highlight from ${b.title}${n.page ? `, p. ${n.page}` : ''}`);
  } else if (b && f.page) {
    const pages = f.page - (b.page ?? 0);
    if (pages > 0) logReading({ book: b.id, minutes: Math.max(5, Math.round(pages / pace(b))), pages });
    else toast(`${b.title} is already at page ${b.page}`);
  } else if (!b && (f.title || result.title)) {
    b = newBook({ title: f.title ?? result.title, author: f.author ?? null, pages: f.pages ?? null, isbn: code ?? null, status: 'next' });
  } else { toast('Couldn’t read the cover. Try the barcode on the back'); return; }
  refreshMind('home', 'library');
  if (b) ensureMind('library', () => openBook(b.id));
}

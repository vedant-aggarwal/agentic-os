// Mind · courses: a course's page (lessons with check circles, the resume card, Wyn's notes per lesson) and a
// lesson (a player that resumes where he left off, notes, practice, mark done). Owner: the Mind agent. Prefix min-.
import { $, $$, esc, push, pop, on, ring, pulse, toast, haptic, setRing } from '../core.js';
import { I } from '../icons.js';
import { api } from '../bus.js';
import { S, COURSES, course, fmt, courseLeft, durSec, mmss as MMSS, REAL, saveLesson, saveCourse, saveSession, derive } from './mind-data.js';
import { MI, wynMark, refreshMind, growIn } from './mind-ui.js';
import { AGENT } from '../data.js';

const asRing = (p, size, w, o) => ring(p, 'as', size, w, o);
const mmss = MMSS;
const NOTES_L = REAL ? {} : { 'roadmap:8': ['Hook, the client’s result, the proof, one ask. Same order every reel.', 'Film the result screen, not the dashboard.'] };
const num = (i) => (REAL ? i + 1 : i);            // real lessons count from 1, the prototype's sample from 0
const isDone = (c, i) => (c.ldone ? !!c.ldone[i] : i < c.done);
const curOf = (c) => c.cur ?? c.done;
const lead = (c) => { let n = 0; while (n < c.lessons.length && isDone(c, n)) n++; return n; };   // watched in a row from the start
const notesOf = (c, i) => (REAL ? (c.notes?.[i] ?? []) : NOTES_L[`${c.id}:${i}`] ?? []);

// ═════════════ a course ═════════════
export function openCourse(id) {
  const c = course(id) ?? COURSES.find((x) => x.status === 'active'); if (!c) return;
  let showDone = false;
  const page = push({ title: c.title, back: 'Courses', aspect: 'mind', cls: 'min-cp', render(sc) { draw(sc); } });
  function draw(sc) {
    const n = c.lessons.length, done = c.done, ci = curOf(c), folded = lead(c);
    const active = c.status === 'active', parked = c.status === 'parked', fin = c.status === 'done', lib = c.kind === 'library';
    const cur = c.lessons[ci];
    const other = COURSES.find((x) => x.status === 'active' && x.id !== c.id);
    sc.innerHTML = `
      <div class="phead"><p class="kicker c-as">${esc(c.from)}${c.part && !c.from.includes(c.part) ? ` · ${esc(c.part)}` : ''}</p><h1 class="lt">${esc(c.title)}</h1>
        <p class="sub">${n} lessons · ${fin ? 'finished' : `${done} done · about ${fmt(courseLeft(c))} left`}</p></div>
      <section class="surface min-card min-cph">
        ${asRing(done / n, 92, 10, { label: `${done} of ${n} lessons`, inner: `<span class="min-yri"><b class="met" data-count="${done}">${done}</b><small>of ${n}</small></span>` })}
        <div class="min-cpt">
          ${active || lib ? `<b>Next: ${num(ci)}. ${esc(cur[0])}</b><span>${c.at && c.at !== '0:00' ? `Resume at ${c.at}${cur[1] ? ` of ${cur[1]}` : ''}` : `${cur[1] || 'Length not listed'} · from the start`}</span>
            <button class="btn primary sm" style="--c:var(--as-fill)" data-act="min-lesson" data-c="${c.id}">${I.play}${c.at && c.at !== '0:00' ? `Resume at ${c.at}` : 'Start'}</button>` : ''}
          ${parked ? `<b>Parked</b><span>${other ? `It starts when ${esc(other.title)} is done, so one course gets finished at a time.` : 'Nothing else is in progress, so it can start now.'}</span>
            <button class="btn sm" data-act="min-cstart" data-id="${c.id}">${other ? `Start it now, park ${esc(other.title)}` : 'Start it now'}</button>` : ''}
          ${fin ? `<b>Finished</b><span>All ${n} lessons watched.</span>` : ''}
        </div>
      </section>
      ${c.practice && active ? `<p class="min-why min-cpw">${wynMark('xs')}<span>${esc(c.practice)}</span></p>` : ''}
      <div class="sh"><h2>Lessons</h2><span class="sh-count">${done} of ${n}</span></div>
      <div class="group surface min-ll">${folded && !showDone ? `<button class="row min-llr done min-llfold" data-act="min-cfold">
          <span class="min-llck" aria-hidden="true">${I.check}</span>
          <span class="rbody"><span class="rtitle">${folded === n ? `All ${n} watched` : `${folded} watched`}</span><span class="rmeta">${num(0)}. ${esc(c.lessons[0][0])}${folded > 1 ? ` to ${num(folded - 1)}. ${esc(c.lessons[folded - 1][0])}` : ''}</span></span>
          <span class="min-llshow">Show${I.chevD}</span></button>` : ''}${c.lessons.map(([t, d, note], i) => {
        if (i < folded && !showDone) return '';
        const st = isDone(c, i) ? 'done' : i === ci && (active || lib) ? 'cur' : 'todo';
        const p = st === 'cur' && c.at && durSec(d) ? durSec(c.at) / durSec(d) : 0;
        const lead = st === 'done' ? `<span class="min-llck" aria-label="Watched">${I.check}</span>`
          : st === 'cur' ? asRing(p, 28, 4, { label: `${Math.round(p * 100)}% watched` }) : `<span class="min-lln met">${num(i)}</span>`;
        return `<button class="row min-llr ${st}" data-act="min-lesson" data-c="${c.id}" data-i="${i}">${lead}
          <span class="rbody"><span class="rtitle">${num(i)}. ${esc(t)}</span>
          <span class="rmeta">${st === 'cur' && c.at ? `${c.at}${d ? ` of ${d}` : ''} · resume` : d || 'Length not listed'}${note && st !== 'done' ? ` · <span class="ell">${esc(note)}</span>` : ''}</span></span>
          ${st === 'cur' ? `<span class="min-llgo">${I.play}</span>` : I.chevR}</button>`;
      }).join('')}</div>
      ${active && !lib && REAL ? `<div class="pad"><button class="btn block" data-act="min-cpark" data-id="${c.id}">${MI.park}Park this course</button></div>` : ''}`;
    const curRow = $('.min-llr.cur', sc);
    if (curRow) requestAnimationFrame(() => { /* the current lesson sits a little under the fold; leave the scroll where the head is */ });
  }
  page._redraw = () => { const sc = $('.scroll', page); draw(sc); pulse(sc); };
  page._fold = () => { showDone = true; page._redraw(); };
}
on('min-cfold', (el) => { el.closest('.page')?._fold?.(); haptic(5); });
// one course at a time: starting a parked one parks the one in progress (undo puts both back)
on('min-cstart', (el) => {
  const c = course(el.dataset.id); if (!c) return;
  const other = COURSES.filter((x) => x.status === 'active' && x.id !== c.id);
  c.status = 'active'; saveCourse(c.id, { status: 'active' });
  other.forEach((x) => { x.status = 'parked'; saveCourse(x.id, { status: 'parked' }); });
  haptic(10);
  toast(`${c.title} is in progress${other.length ? `; ${other.map((x) => x.title).join(', ')} parked` : ''}`, () => {
    c.status = 'parked'; saveCourse(c.id, { status: 'parked' }); other.forEach((x) => { x.status = 'active'; saveCourse(x.id, { status: 'active' }); }); derive(); refreshMind('home', 'courses'); $$('#stack .page.min-cp').forEach((p) => p._redraw?.());
  });
  derive(); refreshMind('home', 'courses'); $$('#stack .page.min-cp').forEach((p) => p._redraw?.());
});
on('min-cpark', (el) => {
  const c = course(el.dataset.id); if (!c) return;
  c.status = 'parked'; saveCourse(c.id, { status: 'parked' }); haptic(6);
  toast(`Parked ${c.title}`, () => { c.status = 'active'; saveCourse(c.id, { status: 'active' }); derive(); refreshMind('home', 'courses'); $$('#stack .page.min-cp').forEach((p) => p._redraw?.()); });
  derive(); refreshMind('home', 'courses'); $$('#stack .page.min-cp').forEach((p) => p._redraw?.());
});

// ═════════════ a lesson ═════════════
let P = null;   // the player: { c, i, pos (s), len (s), iv, playing }
export function openLesson(cid, i) {
  const c = course(cid) ?? COURSES.find((x) => x.status === 'active'); if (!c) return;
  const idx = i ?? curOf(c);
  const lesson = c.lessons[idx]; if (!lesson) return;
  const len = durSec(lesson[1]) || 3600;   // a lesson with no listed length: the scrub runs to an hour
  const pos = idx === curOf(c) && c.at ? durSec(c.at) : 0;
  if (P?.iv) clearInterval(P.iv);
  P = { c, i: idx, pos, len, iv: null, playing: false, start: pos };
  const page = push({
    title: `Lesson ${num(idx)}`, back: c.title, aspect: 'mind', cls: 'min-lp',
    onPop: () => { stop(); },
    render(sc) { draw(sc); },
  });
  function draw(sc) {
    const done = isDone(c, idx);
    const next = c.lessons[idx + 1];
    const notes = notesOf(c, idx);
    const url = c.urls?.[idx];
    sc.innerHTML = `
      <div class="min-vid ${P.playing ? 'playing' : ''}" data-act="min-vplay" role="button" aria-label="${P.playing ? 'Pause' : 'Play'} ${esc(lesson[0])}">
        <span class="min-vpost" aria-hidden="true"><i>${esc(c.title)} · ${num(idx)}</i><b>${esc(lesson[0])}</b></span>
        <span class="min-vb">${P.playing ? I.pause : I.play}</span>
        <span class="min-vs"><span class="min-vtime met">${mmss(P.pos)}</span><span class="min-scrub" style="--p:${(P.pos / P.len).toFixed(4)}"><i></i><b></b></span><span class="min-vtime met">${lesson[1] || '–'}</span></span>
      </div>
      <div class="phead min-lph"><p class="kicker c-as">${esc(c.title)} · ${c.done} of ${c.lessons.length} watched</p><h1 class="title1">${esc(lesson[0])}</h1>
        <p class="sub">${lesson[1] || 'Length not listed'}${done ? ' · watched' : P.pos && lesson[1] ? ` · ${mmss(P.len - P.pos)} left` : ''}</p></div>
      ${url && REAL && !done ? `<p class="hint pad min-lpurl">Play opens it on Skool and keeps time here, so your place is saved when you come back.</p>` : ''}
      <div class="pad min-lpa">
        <button class="btn primary" style="--c:var(--as-fill)" data-act="min-vplay">${P.playing ? `${I.pause}Pause` : P.pos ? `${I.play}Resume at ${mmss(P.pos)}` : `${I.play}Play`}</button>
        ${done ? `<span class="min-lpdone">${I.check}Watched</span>` : `<button class="btn" data-act="min-ldone">${I.check}Mark done</button>`}
      </div>
      ${lesson[2] ? `<p class="min-why min-lpw">${wynMark('xs')}<span><b>Why this one:</b> ${esc(lesson[2])}</span></p>` : ''}
      ${c.practice && idx === curOf(c) ? `<div class="sh"><h2>Practice</h2></div><p class="note surface">${esc(c.practice)}</p>` : ''}
      <div class="sh"><h2>Your notes</h2><span class="sh-count">${notes.length}</span></div>
      ${notes.length ? `<div class="group surface">${notes.map((n) => `<div class="row"><span class="rbody"><span class="rtitle wrap">${esc(n)}</span></span></div>`).join('')}</div>` : ''}
      <div class="pad min-lpn"><label class="field"><input type="text" placeholder="A note at ${mmss(P.pos)}" aria-label="Add a note to this lesson" enterkeyhint="done"><button class="fbtn" data-act="min-lnote" aria-label="Save the note">${I.up}</button></label></div>
      ${next ? `<div class="sh"><h2>Up next</h2></div>
        <div class="group surface"><button class="row min-llr" data-act="min-lnext"><span class="min-lln met">${num(idx + 1)}</span><span class="rbody"><span class="rtitle">${num(idx + 1)}. ${esc(next[0])}</span><span class="rmeta">${next[1] || 'Length not listed'}${next[2] ? ` · <span class="ell">${esc(next[2])}</span>` : ''}</span></span>${I.chevR}</button></div>` : ''}`;
    const inp = $('.min-lpn input', sc);
    inp?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveNote(sc); } });
  }
  page._redraw = () => draw($('.scroll', page));
  P.page = page;
}
function stop() {
  if (!P) return;
  if (P.iv) clearInterval(P.iv);
  P.iv = null; P.playing = false;
  // the resume point is saved as he leaves, like Skool
  if (P.i === curOf(P.c) && P.pos > 0 && !isDone(P.c, P.i)) { P.c.at = mmss(P.pos); saveLesson(P.c.id, P.i, { pos: Math.round(P.pos) }); refreshMind('home', 'courses'); }
}
function paintPlayer() {
  if (!P?.page) return;
  const pg = P.page;
  $$('.min-vtime', pg)[0] && ($$('.min-vtime', pg)[0].textContent = mmss(P.pos));
  const sc = $('.min-vid .min-scrub', pg); sc?.style.setProperty('--p', (P.pos / P.len).toFixed(4));
}
on('min-vplay', () => {
  if (!P) return;
  if (P.playing) { stop(); P.page._redraw(); haptic(6); return; }
  P.playing = true; haptic(6);
  // the real lesson plays on Skool; the timer here keeps his place
  const url = REAL ? P.c.urls?.[P.i] : null;
  if (url && !P.opened) { P.opened = true; try { window.open(url, '_blank', 'noopener'); } catch {} }
  P.iv = setInterval(() => { P.pos = Math.min(P.len, P.pos + 1); paintPlayer(); if (P.pos >= P.len) { stop(); markDone(); } }, 1000);
  P.page._redraw();
});
on('min-ldone', () => markDone());
function markDone() {
  if (!P) return;
  const { c, i } = P;
  if (isDone(c, i)) return;
  const played = P.pos - P.start;
  stop();
  const listed = durSec(c.lessons[i][1]);
  const watched = Math.max(1, Math.round((played > 30 ? played : listed ? listed - P.start : 600) / 60));
  const was = { done: c.done, at: c.at, status: c.status, cur: c.cur, ld: c.ldone ? [...c.ldone] : null };
  if (c.ldone) { c.ldone[i] = true; c.done = c.ldone.filter(Boolean).length; const nx = c.ldone.indexOf(false); c.cur = nx === -1 ? c.lessons.length - 1 : nx; }
  else c.done = Math.max(c.done, i + 1);
  c.at = null;
  S.learnExtra += watched;
  S.log.push({ kind: 'lesson', text: `${c.title}: ${c.lessons[i][0]}`, min: watched });
  if (c.done >= c.lessons.length) c.status = 'done';
  saveLesson(c.id, i, { status: 'done', done_at: new Date().toISOString(), pos: 0 });
  const ses = saveSession({ kind: 'lesson', minutes: watched, course: c.id, lesson: c.lid?.[i] ?? null, title: c.lessons[i][0] });
  haptic(12);
  toast(`Lesson ${num(i)} done · ${c.done} of ${c.lessons.length}`, () => {
    Object.assign(c, { done: was.done, at: was.at, status: was.status, cur: was.cur }); if (was.ld) c.ldone = was.ld; S.learnExtra -= watched;
    saveLesson(c.id, i, { status: 'todo', done_at: null }); if (ses) import('./mind-data.js').then((m) => m.removeSession(ses.id));
    refreshMind('home', 'courses'); $$('#stack .page.min-cp').forEach((p) => p._redraw?.());
  });
  refreshMind('home', 'courses');
  // the course page under this one moves too
  $$('#stack .page.min-cp').forEach((p) => p._redraw?.());
  // this lesson now shows as watched; the next one is one tap away
  P.page?._redraw();
  const b = $('.min-lpdone', P.page); if (b) { b.classList.add('pop'); }
}
on('min-lnext', () => { if (!P) return; const { c, i } = P; pop(); setTimeout(() => openLesson(c.id, i + 1), 360); });
function saveNote(sc) {
  const inp = $('.min-lpn input', sc); const v = inp?.value.trim(); if (!v || !P) return;
  const line = `${mmss(P.pos)} · ${v}`;
  if (REAL) { const list = [...notesOf(P.c, P.i), line]; (P.c.notes ??= [])[P.i] = list; saveLesson(P.c.id, P.i, { notes: list }); }
  else { const k = `${P.c.id}:${P.i}`; (NOTES_L[k] ??= []).push(line); }
  P.page._redraw(); haptic(6); toast('Note saved to the lesson');
}
on('min-lnote', (el) => saveNote(el.closest('.scroll')));

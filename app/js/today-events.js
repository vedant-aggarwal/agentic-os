// Calendar blocks: the event sheet (which area and part of the wheel it feeds, every block with its name at once so
// next week tags itself, and its time moved or stretched in 15-minute steps) and the tag sheet (this week's untagged
// block names, the agent's suggestions with Keep and Keep all). Areas and times are event overrides on the PC
// (PATCH /events/:id, synced); a name tagged for every block is also an area rule (POST /areas/:slug/rules).
import { $, $$, esc, on, openSheet, closeSheet, toast, haptic } from './core.js';
import { I } from './icons.js';
import { AREAS, AREA_ASPECTS, AGENT, aspect, area } from './data.js';
import { api, has } from './bus.js';
import { stagger } from './motion.js';
import { shortTitle, rel } from './today-data.js';
import { NOW, TODAY, REAL, hm, dur, plural, day, addDays, W, tagTitle, untagged, blocksOn, aspectName, allOn } from './today-state.js';
import { findEvent } from './today-cal.js';
import { chipsInView } from './today-tasks.js';
import { canAI, tag as aiTag, decide } from './today-ai.js';

const dot = (id) => (id ? `<i class="dot" style="--c:var(--${id})"></i>` : '');
const aspectOfArea = (slug) => AREA_ASPECTS[slug]?.[0] ?? null;
const sameName = (e) => { const key = shortTitle(e.full ?? e.title); let n = 0; for (let i = 0; i < 7; i++) for (const x of allOn(addDays(TODAY, i)) ?? []) if (!x.sleep && shortTitle(x.full ?? x.title) === key) n++; return n; };
// what each part of the wheel offers for a block: start the workout, log the time with family, add an expense …
const DO = { body: ['Start the workout', 'startWorkout', I.dumbbell], family: ['Log time with family', 'logFamily', I.home], mind: ['Log what you learned', 'logReading', I.read], money: ['Add an expense', 'logExpense', I.rupee], friends: ['Log time with friends', 'logFriends', I.people], romance: ['Log time together', 'logRomance', I.heart], growth: ['Write in the journal', 'writeJournal', I.edit] };

export function openEvent(id) {
  const e = findEvent(id); if (!e) { toast('That block is gone'); return null; }
  const el = openSheet({ cls: 'ev-sheet', head: '', body: '' });
  el._ev = { id, date: e.date, start: e.start, end: e.end, was: { start: e.start, end: e.end }, all: true };
  drawEvent(el, true);
  return el;
}
function drawEvent(el, first = false) {
  const st = el._ev;
  const e = findEvent(st.id); if (!e) { closeSheet(el); return; }
  const isNow = e.date === TODAY && e.start <= NOW && e.end > NOW;
  const past = e.date < TODAY || (e.date === TODAY && e.end <= NOW);
  const a = e.aspect ? aspect(e.aspect) : null;
  const n = sameName(e);
  const doThis = a && DO[a.id] && has(DO[a.id][1]) && !past ? DO[a.id] : null;
  const src = e.source === 'google' ? 'From Google Calendar' : e.sleep ? 'Your night' : 'Calendar block';
  const head = `<div class="grab"></div><div class="sheet-head ev-head"><div class="sh-text"><p class="ev-k">${isNow ? `<span class="c-today">Now · ${dur(e.end - NOW)} left</span><span aria-hidden="true"> · </span>` : ''}${esc(src)}</p><h3>${esc(e.full || e.title)}</h3><p class="num">${esc(rel(e.date) === 'Today' ? 'Today' : day(e.date).short)} · ${hm(e.start)}–${hm(e.end)}${e.where ? ` · ${esc(e.where)}` : ''}</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`;
  const areaChips = `<button class="chip sm ${!e.area ? 'on' : ''}" data-act="ev-area" data-v="">None</button>` + Object.entries(AREAS).filter(([k]) => k !== 'none').map(([slug, x]) => `<button class="chip sm ${e.area === slug ? 'on' : ''}" data-act="ev-area" data-v="${slug}">${dot(aspectOfArea(slug))}${esc(x.name)}</button>`).join('');
  const editable = e.editable !== false && !e.mock && !past;
  const len = st.end - st.start;
  const moved = st.start !== st.was.start || st.end !== st.was.end;
  const body = `${doThis ? `<button class="startjob ev-do" data-act="ev-do" data-fn="${doThis[1]}"><span class="tile asp-tile" data-aspect="${a.id}">${doThis[2]}</span><span class="sj-t"><b>${doThis[0]}</b><small>${esc(a.name)} · ${esc(a.line ?? '')}</small></span>${I.chevR}</button>` : ''}
    <div class="group ts-g">
      <div class="row ts-f"><span class="ts-l">Area${e.area && aspectOfArea(e.area) ? `<small>feeds ${esc(aspectName(aspectOfArea(e.area)))}</small>` : '<small>untagged</small>'}</span><div class="ts-c" data-scroll-x>${areaChips}</div></div>
      ${n > 1 && !e.sleep ? `<div class="row"><span class="rbody"><span class="rtitle">All ${n} “${esc(shortTitle(e.full ?? e.title).slice(0, 26))}”</span><span class="rmeta">This week, and every one after: the PC learns the name</span></span><button class="switch ${st.all ? 'on' : ''}" data-act="ev-all" role="switch" aria-checked="${st.all}" aria-label="Apply to every block with this name"></button></div>` : ''}
    </div>
    ${editable ? `<div class="group ev-time">
      <div class="row ev-tr"><span class="rbody"><span class="rtitle">Starts</span></span><div class="stepper"><button class="chip" data-act="ev-step" data-k="start" data-d="-15" aria-label="Start 15 minutes earlier">${I.minus}</button><b class="met num" data-ev="start">${hm(st.start)}</b><button class="chip" data-act="ev-step" data-k="start" data-d="15" aria-label="Start 15 minutes later">${I.plus}</button></div></div>
      <div class="row ev-tr"><span class="rbody"><span class="rtitle">Ends</span><span class="rmeta num" data-ev="len">${dur(len)}</span></span><div class="stepper"><button class="chip" data-act="ev-step" data-k="end" data-d="-15" aria-label="End 15 minutes earlier">${I.minus}</button><b class="met num" data-ev="end">${hm(st.end)}</b><button class="chip" data-act="ev-step" data-k="end" data-d="15" aria-label="End 15 minutes later">${I.plus}</button></div></div>
      <div class="pad ev-save-p"${moved ? '' : ' hidden'}><button class="btn primary block" style="--c:var(--today-fill)" data-act="ev-save">Move it to ${hm(st.start)}–${hm(st.end)}</button></div>
    </div>
    <p class="hint">Or hold the block on the timeline and drag it. Your calendar on the PC keeps the original; the app keeps the change.</p>` : ''}
    ${a ? `<p class="hint">${esc(AGENT.name)} counts this block's hours toward ${esc(a.name)} on Life.</p>` : '<p class="hint">Give it an area and its hours count toward that part of the wheel on Life.</p>'}`;
  if (first) {
    el.innerHTML = `${head}<div class="sheet-body">${body}</div>`;
    stagger($$('.sheet-body > *', el), { y: 10, each: 30, max: 200 });
  } else {
    const kept = $('.ts-c', el)?.scrollLeft ?? 0;
    el.innerHTML = `${head}<div class="sheet-body">${body}</div>`;
    const c = $('.ts-c', el); if (c) { c.scrollLeft = kept; c._placed = true; }
  }
  chipsInView(el);
}
on('event', (el) => openEvent(el.dataset.id));
on('ev-all', (el) => { const sh = el.closest('.sheet'); sh._ev.all = !sh._ev.all; el.classList.toggle('on', sh._ev.all); el.setAttribute('aria-checked', String(sh._ev.all)); haptic('selection'); });
on('ev-area', (el) => {
  const sh = el.closest('.sheet'), st = sh._ev; const e = findEvent(st.id); if (!e) return;
  const slug = el.dataset.v || null;
  if ((e.area ?? null) === slug) return;
  haptic('selection');
  const all = st.all && sameName(e) > 1 && !e.sleep;
  const undo = all ? tagTitle(e.full ?? e.title, slug) : tagTitle(e.full ?? e.title, slug, { only: e.id });
  const name = slug ? area(slug).name : 'No area';
  toast(all ? `Every “${shortTitle(e.full ?? e.title).slice(0, 16)}”: ${name}` : `Area: ${name}`, () => { undo(); setTimeout(() => sh.isConnected && drawEvent(sh), 0); });
  setTimeout(() => drawEvent(sh), 0);
});
on('ev-step', (el) => {
  const sh = el.closest('.sheet'), st = sh._ev, k = el.dataset.k, d = Number(el.dataset.d);
  const len = st.end - st.start;
  if (k === 'start') { const s = st.start + d; if (st.date === TODAY && s < Math.floor(NOW / 15) * 15 - 15) { haptic('warning'); return; } st.start = s; st.end = s + len; }
  else { const e2 = st.end + d; if (e2 - st.start < 15) { haptic('warning'); return; } st.end = e2; }
  haptic('selection');
  $('[data-ev="start"]', sh).textContent = hm(st.start);
  $('[data-ev="end"]', sh).textContent = hm(st.end);
  $('[data-ev="len"]', sh).textContent = dur(st.end - st.start);
  const p = $('.ev-save-p', sh); const moved = st.start !== st.was.start || st.end !== st.was.end;
  p.hidden = !moved; $('button', p).textContent = `Move it to ${hm(st.start)}–${hm(st.end)}`;
});
on('ev-save', (el) => {
  const sh = el.closest('.sheet'), st = sh._ev;
  moveBlock({ kind: 'event', id: st.id, date: st.date }, st.start, st.end, st.was);
  closeSheet(sh);
});
on('ev-do', (el) => { const fn = el.dataset.fn; closeSheet(); setTimeout(() => api[fn]?.(), 300); });
/** Move a block (an event or a task) to start–end on its day, with Undo. */
export function moveBlock(b, start, end, was = null) {
  if (b.kind === 'task') {
    W.place(b.task, b.date, start, end - start);
    toast(`Moved to ${hm(start)}`, was ? () => W.place(b.task, b.date, was.start, was.end - was.start) : undefined);
  } else {
    W.moveEvent(b.id, b.date, { start, end });
    toast(`Moved to ${hm(start)}–${hm(end)}`, was ? () => W.moveEvent(b.id, b.date, { start: was.start, end: was.end }) : undefined);
  }
  haptic('light');
}

// ── the tag sheet: this week's block names without an area ──────────────
const TAG = { state: null, items: {}, batchId: null };
export function openTags() {
  const el = openSheet({ cls: 'td-tag-sheet', large: true, title: 'Tag your blocks', sub: 'Each name gets an area once; every block with it follows, next week too', body: '<div class="td-tag-body"></div>' });
  drawTags(el, true);
  return el;
}
function drawTags(el, first = false) {
  const groups = untagged();
  const body = $('.td-tag-body', el);
  const card = !groups.length ? '' : !canAI() ? '' : TAG.state === 'thinking'
    ? `<div class="triage surface" role="status"><span class="bi"><span class="spin"></span></span><span class="bt"><b>Reading block names</b><small>Haiku on your PC, a few seconds</small></span></div>`
    : TAG.state === 'ready' && groups.some((g) => TAG.items[g.key])
      ? `<div class="triage surface"><span class="bi">${I.sparkle}</span><span class="bt"><b>${plural(groups.filter((g) => TAG.items[g.key]).length, 'suggestion')}</b><small>Each one becomes a rule, so next week tags itself</small></span><button class="btn sm primary" style="--c:var(--today-fill)" data-act="tag-all">Keep all</button></div>`
      : `<div class="triage surface"><span class="orb xs" aria-hidden="true"></span><span class="bt"><b>Suggest areas</b><small>${esc(AGENT.name)} reads ${plural(groups.length, 'block name')}</small></span><button class="btn sm primary" style="--c:var(--today-fill)" data-act="tag-run">Suggest</button></div>`;
  body.innerHTML = groups.length ? `${card}${groups.map((g) => {
    const x = TAG.state === 'ready' ? TAG.items[g.key] : null;
    const chips = Object.entries(AREAS).filter(([k]) => k !== 'none').map(([slug, a]) => `<button class="chip sm${x?.area === slug ? ' sug' : ''}" data-act="tag-pick" data-key="${esc(g.key)}" data-v="${slug}">${dot(aspectOfArea(slug))}${esc(a.name.split(' ')[0])}</button>`).join('');
    return `<div class="group td-tag-g"><div class="row td-tag-h"><span class="rbody"><span class="rtitle">${esc(g.key)}</span><span class="rmeta">${plural(g.count, 'block')} this week · ${dur(g.min)}</span></span></div>
      ${x ? `<div class="row td-tag-sug"><span class="rbody"><span class="rmeta">Suggested: <b>${esc(area(x.area).name)}</b>${x.why ? ` · ${esc(x.why)}` : ''}</span></span><button class="btn sm tint" style="--c:var(--today)" data-act="tag-keep" data-key="${esc(g.key)}">Keep</button></div>` : ''}
      <div class="row ts-f"><div class="ts-c" data-scroll-x>${chips}</div></div></div>`;
  }).join('')}` : `<p class="note td-tag-none">${I.check} Every block this week has an area.</p>`;
  chipsInView(el);
  if (first) stagger($$('.td-tag-body > *', el), { y: 10, each: 35, max: 280 });
}
const redrawTags = () => $$('.td-tag-sheet').forEach((el) => drawTags(el));
on('tag-run', async () => {
  if (!canAI()) { toast('Suggestions need your PC'); return; }
  TAG.state = 'thinking'; haptic(6); redrawTags();
  try { const r = await aiTag(untagged().map((g) => g.key)); Object.assign(TAG, { state: 'ready', items: r.items, batchId: r.batchId }); haptic('success'); }
  catch (e) { TAG.state = null; toast(e?.status ? e.message : 'Your PC isn’t reachable right now'); }
  redrawTags();
});
function picked(key, slug) {
  const x = TAG.items[key];
  if (x?.pid) decide(TAG.batchId, x.area === slug ? { kept: [x.pid] } : { removed: [x.pid] });
  delete TAG.items[key];
}
on('tag-pick', (el) => {
  const key = el.dataset.key, slug = el.dataset.v;
  picked(key, slug);
  const undo = tagTitle(key, slug);
  haptic('success');
  toast(`${key.slice(0, 18)} now tags as ${area(slug).name.split(' ')[0]}`, () => { undo(); redrawTags(); });
  setTimeout(redrawTags, 0);
});
on('tag-keep', (el) => { const key = el.dataset.key, x = TAG.items[key]; if (!x) return; picked(key, x.area); const undo = tagTitle(key, x.area); haptic('success'); toast(`${key.slice(0, 18)} now tags as ${area(x.area).name.split(' ')[0]}`, () => { undo(); redrawTags(); }); setTimeout(redrawTags, 0); });
on('tag-all', () => {
  const items = Object.values(TAG.items).filter((x) => untagged().some((g) => g.key === x.title));
  const undos = items.map((x) => tagTitle(x.title, x.area));
  decide(TAG.batchId, { kept: items.map((x) => x.pid).filter(Boolean) });
  TAG.items = {};
  haptic('success'); redrawTags();
  toast(`Tagged ${plural(items.length, 'block name')}`, () => { undos.forEach((u) => u()); redrawTags(); });
});
on('td-tags', () => openTags());

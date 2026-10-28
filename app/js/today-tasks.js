// Tasks: the row every area uses (taskRow), finishing and moving tasks, the task sheet, and the Tasks page with smart
// lists, search and grouping, the inbox sorted by the agent and "three in progress". Quick add is today-add.js.
// Real mode: every change goes to the task's real record (W in today-state.js → js/data.js → svc/sync), offline first.
import { $, $$, esc, on, push, openSheet, closeSheet, toast, haptic, seg, wireSegs, ring, swipeRows } from './core.js';
import { I, aspectIcon } from './icons.js';
import { TASKS, GOALS, PROJECTS, PEOPLE, ASPECTS, AREAS, AREA_ASPECTS, USER, area, project, person, aspect, boot } from './data.js';
import { TASK_KEYS } from './svc/sync.js';
import { api, provide, has } from './bus.js';
import { stagger, roll, rollHTML, symbol, flipList } from './motion.js';
import { lenOf, lenNote, isoOfLabel, rel, send } from './today-data.js';
import { S, task, idOf, changed, isDone, isOpen, dateOf, atOf, endOf, isTimed, withAgent, jobsOf, allOpen, LISTS, inList, doneToday, hm, dur, plural, TODAY, addDays, day, goal, goalShort, areaName, projectName, aspectName, W, snapOf, gapsToday, slotFor, REAL, DEMO_MODE, isMember } from './today-state.js';
import { canAI, triage as aiTriage, decide } from './today-ai.js';

const aspectDot = (id) => (id ? `<i class="dot" style="--c:var(--${id})"></i>` : '');
const areaDot = (slug) => aspectDot(AREA_ASPECTS[slug]?.[0] ?? null);
// subtasks, star and repeat: shown once the PC sends them and the sync carries them (v2 notes: Requests for the lead)
export const extras = () => !REAL || (TASK_KEYS.includes('star') && (boot()?.today?.tasks ?? []).some((t) => 'star' in t));
const kids = (id) => TASKS.filter((t) => t.parent === id && t.status !== 'dropped');
const REPEATS = [['', 'None'], ['1d', 'Daily'], ['weekdays', 'Weekdays'], ['1w', 'Weekly'], ['1m', 'Monthly']];
const repeatName = (r) => REPEATS.find(([v]) => v === r)?.[1] ?? (r ? 'Repeats' : '');

// ── the row: check, title, and a meta line that says where it belongs (aspect · project or area · when) ──
export function whenText(t) {
  const d = dateOf(t), a = atOf(t);
  if (isDone(t)) return '';
  if (a != null && d) return d === TODAY ? hm(a) : `${rel(d)} ${hm(a)}`;
  if (t.list === 'today') return 'Today';
  if (t.list === 'upcoming' && d) return rel(d);
  return t.when && !REAL ? t.when : '';
}
export function taskRow(t) {
  t = task(t.id) ?? t;
  const done = isDone(t);
  const where = t.project ? projectName(t.project) : t.area ? area(t.area).name.split(' ')[0] : '';
  const k = kids(t.id);
  const meta = [
    t.aspect ? `<span class="t-a">${aspectDot(t.aspect)}${esc(aspectName(t.aspect))}</span>` : '',
    where ? `<span>${esc(where)}</span>` : '',
    t.late && !done ? `<span class="late">${esc(t.late)}</span>` : '',
    !t.late && whenText(t) ? `<span class="num">${esc(whenText(t))}</span>` : '',
    t.list === 'doing' ? '<span>In progress</span>' : '',
    k.length ? `<span class="t-sub num">${I.check}${k.filter(isDone).length}/${k.length}</span>` : '',
    t.repeat ? `<span class="t-rep" title="${esc(repeatName(t.repeat))}">${I.sync}</span>` : '',
    withAgent(t) ? `<span class="pill plain">${I[jobsOf(t)[0]?.agent ?? 'claude'] ?? I.claude}With ${jobsOf(t)[0]?.agent === 'codex' ? 'Codex' : 'Claude'}</span>` : t.job ? `<span class="pill plain">${I.codex}${esc(t.job)}</span>` : '',
  ].filter(Boolean).join('<span class="t-sep" aria-hidden="true">·</span>');
  return `<div class="row trow ${done ? 'is-done' : ''}" data-id="${t.id}">
    <button class="check ${done ? 'done' : ''}" data-act="task-check" data-id="${t.id}" aria-label="${done ? 'Mark not done' : 'Mark done'}: ${esc(t.title)}">${I.check}</button>
    <button class="rbody" data-act="task" data-id="${t.id}"><span class="rtitle">${t.star ? `<span class="t-star" aria-label="Starred">${I.starF}</span>` : ''}${esc(t.title)}</span><span class="rmeta">${meta}</span></button></div>`;
}

// ── finishing, moving, dropping: every one undoable ──
const closing = new Map();   // id → timer: the check closes before the list reflows
export function complete(id) {
  const t = task(id); if (!t) return;
  if (isDone(t)) { W.done(id, false); haptic(8); toast('Not done', () => W.done(id, true)); return; }
  haptic('success');
  $$(`.check[data-id="${id}"]`).forEach((c) => { c.classList.add('done', 'closing'); c.closest('.row, .td-row, .td-pill')?.classList.add('is-done'); const s = c.querySelector('svg'); if (s) symbol(s, 'draw'); });
  const prev = closing.get(id); if (prev) { clearTimeout(prev.timer); prev.cancelled = true; }
  // the check closes, then what holds it leaves: a tray card folds away sideways, a list row folds up (a block on the
  // timeline stays, struck through, where it happened)
  const job = { cancelled: false, timer: 0, anims: [] };
  closing.set(id, job);
  const go = () => { if (job.cancelled) return; closing.delete(id); W.done(id, true); };
  job.timer = setTimeout(() => {
    if (job.cancelled) return;
    const leaving = $$(`.td-pill[data-id="${id}"], .trow[data-id="${id}"]`).filter((el) => !el.closest('.ts-sheet'));
    if (!leaving.length || matchMedia('(prefers-reduced-motion: reduce)').matches) { go(); return; }
    let n = leaving.length;
    for (const el of leaving) {
      const pill = el.classList.contains('td-pill');
      const kf = pill ? [{ opacity: 1, transform: 'none', width: `${el.offsetWidth}px`, marginRight: '0px' }, { opacity: 0, transform: 'scale(.86)', width: '0px', marginRight: '-8px' }]
        : [{ opacity: 1, height: `${el.offsetHeight}px` }, { opacity: 0, height: '0px' }];
      el.style.overflow = 'hidden';
      const a = el.animate(kf, { duration: 280, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'forwards' });
      job.anims.push(a);
      a.onfinish = () => { if (--n === 0) go(); };
    }
  }, 620);
  toast('Done', () => {
    if (closing.get(id) === job) { job.cancelled = true; clearTimeout(job.timer); job.anims.forEach((a) => a.cancel()); closing.delete(id); changed('undone'); }
    else W.done(id, false);
  });
}
export function toTomorrow(id, at = null) {
  const was = snapOf(id); const tmr = addDays(TODAY, 1);
  W.place(id, tmr, at, at != null ? lenOf(task(id)) : null);
  haptic(8);
  toast(`Moved to ${day(tmr).wdLong}${at != null ? ` ${hm(at)}` : ''}`, () => W.restore(id, was));
}
export function drop(id) { const undo = W.drop(id); haptic(10); toast('Dropped', undo); }
/** Put a task on a day at a time (today by default); undo puts it back where it was. */
export function place(id, start, { date = TODAY, quiet = false, len = null } = {}) {
  const t = task(id); if (!t) return;
  const was = snapOf(id);
  W.place(id, date, start, len ?? lenOf(t));
  S.fresh = new Set([id]); setTimeout(() => { S.fresh = null; }, 1400);
  if (!quiet) toast(`${t.title.split(':')[0].slice(0, 40)} at ${hm(start)}${date !== TODAY ? `, ${rel(date)}` : ''}`, () => W.restore(id, was));
}
export function unplace(id) { const was = snapOf(id); W.unplace(id); toast('Time taken off', () => W.restore(id, was)); }
export function start(id) {
  const t = task(id); if (!t) return;
  const was = snapOf(id);
  W.start(id); haptic(10);
  toast(`Started: ${t.title.slice(0, 40)}`, () => W.restore(id, was));
}
on('task-check', (el) => complete(el.dataset.id));
on('task', (el) => openTask(el.dataset.id));

// ── the task sheet: what it is, what it belongs to, when it happens ──
// A detail is a row: its name on the left, its choices on one line that scrolls sideways, the chosen one in view.
const field = (label, chips, key, note = '') => `<div class="row ts-f" data-k="${key}"><span class="ts-l">${label}${note ? `<small>${note}</small>` : ''}</span><div class="ts-c" data-scroll-x>${chips}</div></div>`;
const chip = (label, isOn, v, extra = '') => `<button class="chip sm ${isOn ? 'on' : ''}" data-act="td-chip" data-v="${esc(v)}"${extra}>${label}</button>`;
const FADE = 24;
export const chipsInView = (el) => requestAnimationFrame(() => $$('.ts-c', el).forEach((c) => {
  const edge = () => { const max = c.scrollWidth - c.clientWidth; c.classList.toggle('fade-l', c.scrollLeft > 2); c.classList.toggle('fade-r', c.scrollLeft < max - 2); };
  const onChip = $('.chip.on', c);
  if (onChip && !c._placed) { c._placed = true; const r = onChip.getBoundingClientRect(), lim = c.getBoundingClientRect().right - FADE; if (r.right > lim + 1) c.scrollLeft += r.right - lim + 8; }
  edge(); if (!c._edge) { c._edge = true; c.addEventListener('scroll', edge, { passive: true }); }
}));
const lenLabel = (m) => dur(m);
function sheetBody(id) {
  const t = task(id); if (!t) return '';
  const g = t.goal ? goal(t.goal) : null;
  const p = t.project ? project(t.project) : null;
  const who = t.person ? person(t.person) : null;
  const d = dateOf(t), a = atOf(t);
  const tmr = addDays(TODAY, 1), d2 = addDays(TODAY, 2);
  const dues = [[TODAY, 'Today'], [tmr, 'Tomorrow'], [d2, rel(d2)]];
  if (d && !dues.some(([x]) => x === d)) dues.push([d, rel(d)]);
  dues.sort((x, y) => x[0].localeCompare(y[0]));
  const whenChips = dues.map(([iso, label]) => chip(esc(label), d === iso, iso)).join('') + chip('No date', !d && t.list !== 'inbox', '') ;
  // time: where it sits, or the free slots today that fit, or none
  const len = lenOf(t);
  const free = d === TODAY || !d ? gapsToday().filter((x) => x.end - x.start >= len).slice(0, 3).map((x) => x.start) : [slotFor(d, len)].filter((x) => x != null);
  const timeChips = (a != null ? `${chip(`${hm(a)}–${hm(endOf(t))}`, true, 'reveal')}<button class="chip sm ts-nudge" data-act="td-nudge" data-id="${id}" data-d="-15" aria-label="15 minutes earlier">${I.minus}</button><button class="chip sm ts-nudge" data-act="td-nudge" data-id="${id}" data-d="15" aria-label="15 minutes later">${I.plus}</button>` : '')
    + free.filter((x) => x !== a).map((x) => chip(`Free at ${hm(x)}`, false, `at:${x}`)).join('')
    + (a == null && !free.length ? `<span class="chip sm ts-none">No free slot${d && d !== TODAY ? '' : ' today'}</span>` : '')
    + chip('No time', a == null, 'none');
  const lens = [10, 15, 30, 45, 60, 90, 120];
  const learnedLen = lenNote(t);
  if (!lens.includes(len)) lens.push(len);
  lens.sort((x, y) => x - y);
  const areaChips = chip('None', !t.area, '') + Object.entries(AREAS).filter(([k]) => k !== 'none').map(([slug, x]) => chip(`${areaDot(slug)}${esc(x.name.split(' ')[0])}`, t.area === slug, slug)).join('');
  const aspectChips = ASPECTS.map((x) => chip(`${aspectDot(x.id)}${x.name}`, x.id === t.aspect, x.id)).join('');
  const goalsFirst = [...GOALS].sort((x, y) => (y.aspects?.includes(t.aspect) ? 1 : 0) - (x.aspects?.includes(t.aspect) ? 1 : 0));
  const goalChips = [chip('None', !t.goal, '')].concat(goalsFirst.filter((x) => x.status !== 'done' || x.id === t.goal).map((x) => chip(esc(goalShort(x.id)), x.id === t.goal, x.id))).join('');
  const projChips = [chip('None', !t.project, '')].concat(PROJECTS.filter((x) => x.status !== 'archived' || x.slug === t.project).map((x) => chip(esc(x.name), x.slug === t.project, x.slug))).join('');
  const links = [
    p ? `<button class="row ic" data-act="td-open-project" data-id="${p.slug}"><span class="tile ts-proj" style="--c:${p.color}">${esc(p.icon && p.icon.length <= 2 ? p.icon : p.name[0])}</span><span class="rbody"><span class="rtitle">${esc(p.name)}</span><span class="rmeta">Project · ${plural(TASKS.filter((x) => x.project === p.slug && isOpen(x)).length, 'open task')}</span></span>${I.chevR}</button>` : '',
    g ? `<button class="row ic" data-act="td-open-goal" data-id="${g.id}"><span class="ts-goal">${ring(g.pace, g.aspects?.[0] ?? 'mission', 32, 4, { k: g.time, label: `${Math.round(g.pace * 100)}% done, ${Math.round(g.time * 100)}% of the time gone` })}</span><span class="rbody"><span class="rtitle">${esc(g.title)}</span><span class="rmeta"><span class="${g.verdict === 'Behind pace' ? 'late' : ''}">${esc(g.verdict)}</span><span>· ${esc({ week: 'This week', month: 'This month', quarter: 'This quarter', year: 'This year', later: 'Later', life: 'Lifetime' }[g.horizon] ?? '')}</span></span></span>${I.chevR}</button>` : '',
    who ? `<button class="row ic" data-act="td-open-person" data-id="${who.id}"><span class="tile ts-mono">${esc(who.name[0])}</span><span class="rbody"><span class="rtitle">${esc(who.name)}</span><span class="rmeta">${esc(who.role ?? '')}</span></span>${I.chevR}</button>` : '',
  ].filter(Boolean).join('');
  const jobs = jobsOf(t);
  const jobRows = jobs.slice(0, 3).map((j) => `<button class="row ic ts-job" data-act="td-open-job" data-id="${j.id}"><span class="tile"><span class="agent sm ${j.agent}">${I[j.agent]}</span></span><span class="rbody"><span class="rtitle">${esc(j.title)}</span><span class="rmeta"><span class="${j.lane === 'needs' ? 'amber' : ''}">${esc({ needs: 'Needs you', working: 'Working', review: 'To review', done: 'Done', stopped: 'Stopped', archive: 'Archived' }[j.lane] ?? j.lane)}</span>${j.ago ? `<span>· ${esc(j.ago)}</span>` : ''}</span></span>${I.chevR}</button>`).join('');
  const sub = extras() ? kids(id) : [];
  const owner = !REAL || USER?.owner;
  const doing = t.list === 'doing';
  return `
    ${owner && !isDone(t) ? `<button class="startjob" data-act="td-hand" data-id="${id}"><span class="agent claude">${I.claude}</span><span class="sj-t"><b>${jobs.length ? 'Hand it on again' : 'Hand it to an agent'}</b><small>Claude or Codex does it on your PC and reports back</small></span>${I.chevR}</button>` : ''}
    ${jobRows ? `<div class="group ts-links ts-jobs">${jobRows}</div>` : ''}
    ${links ? `<div class="group ts-links">${links}</div>` : ''}
    <div class="group ts-g" data-task="${id}">
      ${field('When', whenChips, 'when')}
      ${field('Time', timeChips, 'time')}
      ${field('Length', lens.map((m) => chip(lenLabel(m), m === len, String(m))).join(''), 'len', learnedLen)}
      ${REAL ? field('Area', areaChips, 'area', t.area && AREA_ASPECTS[t.area]?.[0] ? `feeds ${aspectName(AREA_ASPECTS[t.area][0])}` : '') : field('Aspect', aspectChips, 'aspect')}
      ${field('Goal', goalChips, 'goal')}
      ${field('Project', projChips, 'project')}
      ${extras() ? field('Repeat', REPEATS.map(([v, label]) => chip(label, (t.repeat ?? '') === v, v)).join(''), 'repeat') : ''}
    </div>
    ${extras() ? `<div class="group ts-subs" data-task="${id}">
      ${sub.map((k) => `<div class="row ts-sub ${isDone(k) ? 'is-done' : ''}"><button class="check sm ${isDone(k) ? 'done' : ''}" data-act="td-sub-check" data-id="${k.id}" aria-label="${isDone(k) ? 'Mark not done' : 'Mark done'}: ${esc(k.title)}">${I.check}</button><span class="rbody"><span class="rtitle">${esc(k.title)}</span></span><button class="ts-sub-x" data-act="td-sub-drop" data-id="${k.id}" aria-label="Remove ${esc(k.title)}">${I.x}</button></div>`).join('')}
      <label class="row ts-sub-add">${I.plus}<input type="text" enterkeyhint="done" placeholder="Add a step" aria-label="Add a step" data-parent="${id}" /></label>
    </div>` : ''}
    <div class="group ts-notes"><label class="ts-note"><span class="vh">Notes</span><textarea rows="2" placeholder="Notes" data-task="${id}">${esc(t.notes ?? '')}</textarea></label></div>
    <div class="sheet-acts">${isDone(t) ? `<button class="btn" data-act="task-check" data-id="${id}">${I.undo}Reopen</button>` : doing ? `<button class="btn" data-act="t-pause" data-id="${id}">${I.pause}Pause</button>` : `<button class="btn" data-act="t-start" data-id="${id}">${I.play}Start</button>`}<button class="btn" data-act="sheet-tomorrow" data-id="${id}">Tomorrow</button><button class="btn t-drop" data-act="t-drop" data-id="${id}">Drop</button></div>`;
}
const headOf = (t) => `<div class="sheet-head task-head"><button class="check ${isDone(t) ? 'done' : ''}" data-act="task-check" data-id="${t.id}" aria-label="${isDone(t) ? 'Mark not done' : 'Mark done'}">${I.check}</button>
  <div class="sh-text"><textarea class="ts-title" rows="1" aria-label="Task title" enterkeyhint="done" spellcheck="false" data-task="${t.id}">${esc(t.title)}</textarea><p>${t.late && !isDone(t) ? `<span class="late">${esc(t.late)}</span> · ` : ''}${t.aspect ? `${aspectDot(t.aspect)} ${esc(aspectName(t.aspect))}` : t.list === 'inbox' ? 'Inbox' : 'No aspect'}${t.list === 'doing' ? ' · In progress' : ''}${withAgent(t) ? ' · With an agent' : ''}</p></div>
  ${extras() ? `<button class="ts-star ${t.star ? 'on' : ''}" data-act="td-star" data-id="${t.id}" aria-pressed="${!!t.star}" aria-label="${t.star ? 'Unstar' : 'Star'}">${t.star ? I.starF : I.star}</button>` : ''}
  <button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`;
export function openTask(id) {
  const t = task(id); if (!t) { toast('That task is gone'); return; }
  const el = openSheet({ cls: 'ts-sheet', head: headOf(t), body: sheetBody(id) });
  el._task = id;
  wire(el);
  stagger($$('.sheet-body > *', el), { y: 10, each: 28, max: 200 });
  return el;
}
// the sheet redraws after each change, keeping where each row of choices was scrolled
function redrawSheet(el) {
  if (!el) return;
  el._task = idOf(el._task);
  const id = el._task; const t = id && task(id);
  if (!t) return;
  const kept = new Map($$('.ts-c', el).map((c) => [c.closest('.ts-f')?.dataset.k, c.scrollLeft]));
  const focus = document.activeElement?.closest?.('.sheet') === el ? document.activeElement : null;
  const adding = focus?.matches('.ts-sub-add input');
  if (focus?.matches('textarea, input') && !adding) return;   // never redraw under a cursor (the step field keeps its focus)
  const y = $('.sheet-body', el).scrollTop;
  $('.sheet-head', el).outerHTML = headOf(t);
  $('.sheet-body', el).innerHTML = sheetBody(id);
  $('.sheet-body', el).scrollTop = y;
  for (const c of $$('.ts-c', el)) { const k = c.closest('.ts-f')?.dataset.k; if (kept.has(k)) { c.scrollLeft = kept.get(k); c._placed = true; } }
  wire(el);
  if (adding) $('.ts-sub-add input', el)?.focus({ preventScroll: true });
}
function wire(el) {
  chipsInView(el);
  const title = $('.ts-title', el);
  if (title) {
    const fitT = () => { title.style.height = 'auto'; title.style.height = `${title.scrollHeight}px`; };
    requestAnimationFrame(fitT);
    title.addEventListener('input', fitT);
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } });
    title.addEventListener('change', () => { const v = title.value.trim(); const t = task(el._task); if (t && v && v !== t.title) { W.update(t.id, { title: v }); haptic(5); } });
  }
  let noteT = 0;
  $('.ts-note textarea', el)?.addEventListener('input', (e) => { const v = e.target.value; clearTimeout(noteT); noteT = setTimeout(() => W.update(el._task, { notes: v.trim() ? v : null }), 600); });
  const add = $('.ts-sub-add input', el);
  add?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return; e.preventDefault();
    const v = add.value.trim(); if (!v) return;
    const parent = task(el._task);
    const k = W.add({ title: v, area: parent?.area ?? null, project: parent?.project ?? null, goal: parent?.goal ?? null, date: dateOf(parent) ?? null });
    if (k) W.update(k.id, { parent: parent.id });
    add.value = ''; haptic(6);
    setTimeout(() => { redrawSheet(el); $('.ts-sub-add input', el)?.focus({ preventScroll: true }); }, 40);
  });
}
// redraw an open task sheet when its task changes (a sync, a toast's Undo)
export function refreshSheets() { $$('.ts-sheet').forEach((el) => redrawSheet(el)); }
// a chip in a sheet's detail row is a choice: the row's key decides what it changes
on('td-chip', (el) => {
  const row = el.closest('.ts-f'); const g = el.closest('[data-task]');
  if (!row || !g || el.classList.contains('ts-none')) return;
  $$('.chip', el.parentElement).forEach((c) => c.classList.toggle('on', c === el)); haptic('selection');
  const id = g.dataset.task, v = el.dataset.v, k = row.dataset.k, t = task(id);
  if (!t) return;
  const was = snapOf(id);
  if (k === 'goal') W.update(id, { goal: v || null });
  else if (k === 'project') W.update(id, { project: v || null, ...(v && t.status === 'inbox' ? { status: 'todo' } : {}) });
  else if (k === 'area') W.update(id, { area: v || null });
  else if (k === 'aspect') W.update(id, { aspect: v });
  else if (k === 'repeat') W.update(id, { repeat: v || null, ...(v && !dateOf(t) ? { due: TODAY } : {}) });
  else if (k === 'len') {
    const m = Number(v);
    const a = atOf(t);
    if (a != null) W.place(id, dateOf(t), a, m);
    W.update(id, { estimateMinutes: m });
  } else if (k === 'when') {
    if (!v) W.noDate(id);
    else { const a = atOf(t); W.place(id, v, dateOf(t) === v ? a : null); }
    toast(v ? `Due ${rel(v).toLowerCase() === 'today' ? 'today' : rel(v)}` : 'No date', () => W.restore(id, was));
  } else if (k === 'time') {
    if (v === 'none') { if (atOf(t) != null) W.unplace(id); }
    else if (v === 'reveal') { closeSheet(); api.openCalendar('day', dateOf(t) ?? TODAY); setTimeout(() => document.dispatchEvent(new CustomEvent('td-reveal', { detail: { id } })), 360); return; }
    else if (v.startsWith('at:')) { const at = Number(v.slice(3)); W.place(id, dateOf(t) ?? TODAY, at, lenOf(t)); toast(`At ${hm(at)}`, () => W.restore(id, was)); }
  }
  setTimeout(() => redrawSheet(el.closest('.sheet')), 0);
});
on('td-nudge', (el) => {
  const t = task(el.dataset.id); if (!t) return;
  const a = atOf(t); if (a == null) return;
  const len = endOf(t) - a;
  W.place(t.id, dateOf(t), Math.max(0, a + Number(el.dataset.d)), len);
  haptic('selection');
  setTimeout(() => redrawSheet(el.closest('.sheet')), 0);
});
on('td-star', (el) => { const t = task(el.dataset.id); if (!t) return; W.update(t.id, { star: !t.star }); haptic(t.star ? 5 : 'success'); setTimeout(() => redrawSheet(el.closest('.sheet')), 0); });
on('td-sub-check', (el) => { const k = task(el.dataset.id); if (!k) return; W.done(k.id, !isDone(k)); haptic(isDone(k) ? 5 : 'success'); setTimeout(() => redrawSheet(el.closest('.sheet')), 0); });
on('td-sub-drop', (el) => { const sh = el.closest('.sheet'); const undo = W.drop(el.dataset.id); toast('Step removed', () => { undo?.(); setTimeout(() => redrawSheet(sh), 0); }); setTimeout(() => redrawSheet(sh), 0); });
on('sheet-tomorrow', (el) => { closeSheet(); toTomorrow(el.dataset.id); });
on('t-drop', (el) => { closeSheet(); drop(el.dataset.id); });
on('t-start', (el) => { closeSheet(); start(el.dataset.id); });
on('t-pause', (el) => { const id = el.dataset.id; const was = snapOf(id); closeSheet(); W.pause(id); toast('Paused', () => W.restore(id, was)); });
on('td-hand', (el) => {
  const t = task(el.dataset.id); if (!t) return;
  const id = t.id; closeSheet();
  if (REAL && !/^t\d+$/.test(id)) { toast('Still saving this task. Try again in a second'); return; }
  // the brief the shipping app wrote: the task, its notes and when it's due; Work's sheet lets him change it
  const r = t.due ? rel(t.due) : '';
  const brief = `${t.title.replace(/[.\s]+$/, '')}.${t.notes?.trim() ? ` ${t.notes.trim().replace(/([^.!?])$/, '$1.')}` : ''}${r ? ` Due ${/^(Today|Tomorrow|Yesterday)$/.test(r) ? r.toLowerCase() : r}.` : ''}`;
  setTimeout(() => api.newJob({ title: t.title, prompt: brief, task: id, project: t.project ?? undefined }), 300);
});
on('td-open-job', (el) => { closeSheet(); setTimeout(() => api.openJob(el.dataset.id), 300); });
on('td-open-project', (el) => { closeSheet(); api.openProject(el.dataset.id); });
on('td-open-goal', (el) => { closeSheet(); api.openGoal(el.dataset.id); });
on('td-open-person', (el) => { closeSheet(); api.openPerson(el.dataset.id); });

// ── the Tasks page: smart lists, search, grouped by date, project, aspect or area ──
const EMPTY = { overdue: 'Nothing is late.', today: 'Nothing left for today.', doing: 'Nothing in progress.', inbox: 'The inbox is empty.', upcoming: 'Nothing coming up.' };
const TRI = { state: null, items: {}, batchId: null };   // the inbox, sorted by the agent: suggestions waiting for a Keep
export function openTasks(list = null) {
  let group = 'date', q = '', doneAll = false;
  push({
    title: 'Tasks', back: 'Today', dock: true,
    right: `<button class="gbtn chrome icon" data-act="td-add" aria-label="Add a task">${I.plus}</button>`,
    render(sc, page) {
      page.classList.add('tasks-page');
      const sec = (id, label, items, cls = '', extra = '') => items.length ? `<div class="sh" id="tsec-${id}"><h2 class="${cls}">${label}</h2><span class="sh-count">${items.length}</span>${extra}</div><div class="group" data-sec="${id}">${items.map((t) => taskRow(t) + triStrip(t)).join('')}</div>` : '';
      const byDate = (a, b) => (dateOf(a) ?? '9').localeCompare(dateOf(b) ?? '9') || (atOf(a) ?? 9999) - (atOf(b) ?? 9999) || (a.priority ?? 2) - (b.priority ?? 2);
      const draw = (first = false) => {
        const open = allOpen();
        // each task once: late, today, in progress, inbox, coming days, no date (the tiles count the smart lists)
        const doing = inList('doing').filter((t) => t.list === 'doing'), inbox = inList('inbox');
        let body = '';
        if (group === 'date') {
          const upcoming = inList('upcoming').sort(byDate);
          const ups = [...new Set(upcoming.map(dateOf))];
          body = sec('overdue', 'Overdue', inList('overdue').sort(byDate), 'late') + sec('today', 'Today', inList('today').sort(byDate))
            + (doing.length > 3 ? `<div class="sh" id="tsec-doing"><h2>Ongoing</h2><span class="sh-count">${doing.length}</span></div>${capCard(doing)}<div class="group" data-sec="doing">${doing.map(taskRow).join('')}</div>` : sec('doing', 'Ongoing', doing))
            + (inbox.length ? `<div class="sh" id="tsec-inbox"><h2>Inbox</h2><span class="sh-count">${inbox.length}</span></div>${triageCard(inbox)}<div class="group" data-sec="inbox">${inbox.map((t) => taskRow(t) + triStrip(t)).join('')}</div>` : '')
            + (ups.length ? `<div class="sh" id="tsec-upcoming"><h2>Upcoming</h2><span class="sh-count">${upcoming.length}</span></div>${ups.map((d) => `<p class="tp-day">${esc(d ? (Math.abs(Date.parse(d) - Date.parse(TODAY)) / 864e5 <= 7 ? `${day(d).wdLong} ${day(d).d}` : day(d).short) : '')}</p><div class="group" data-sec="up-${d}">${upcoming.filter((t) => dateOf(t) === d).map(taskRow).join('')}</div>`).join('')}` : '')
            + sec('nodate', 'No date', inList('nodate'))
            + sec('done', 'Done today', doneToday());
          const before = REAL ? TASKS.filter((t) => isDone(t) && !t.doneToday) : [];
          if (before.length) body += doneAll ? `${sec('earlier', 'Done before', before.sort((a, b) => String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? ''))))}<button class="row tp-more" data-act="td-done-all">Hide earlier done tasks</button>` : `<div class="group tp-more-g"><button class="row tp-more" data-act="td-done-all"><span class="rbody"><span class="rtitle">${plural(before.length, 'earlier done task')}</span></span>${I.chevR}</button></div>`;
        } else if (group === 'project') {
          body = PROJECTS.map((p) => sec(p.slug, `<span class="tp-proj" style="--c:${p.color}">${esc(p.icon && p.icon.length <= 2 ? p.icon : p.name[0])}</span>${esc(p.name)}`, open.filter((t) => t.project === p.slug), '', `<button class="sh-act" data-act="td-open-project" data-id="${p.slug}">Open ${I.chevR}</button>`)).join('')
            + sec('none', 'No project', open.filter((t) => !t.project || !project(t.project)));
        } else if (group === 'area') {
          body = Object.entries(AREAS).filter(([k]) => k !== 'none').map(([slug, x]) => sec(slug, `<i class="tp-area" style="--c:${x.color}"></i>${esc(x.name)}`, open.filter((t) => t.area === slug))).join('')
            + sec('noarea', 'No area', open.filter((t) => !t.area || !AREAS[t.area]));
        } else {
          body = ASPECTS.map((a) => sec(a.id, `<span class="tile asp-tile tp-asp" data-aspect="${a.id}" aria-hidden="true">${aspectIcon[a.id]}</span>${esc(a.name)}`, open.filter((t) => t.aspect === a.id), '', `<button class="sh-act" data-act="td-aspect" data-id="${a.id}">Open ${I.chevR}</button>`)).join('')
            + sec('noaspect', 'No aspect', open.filter((t) => !t.aspect));
        }
        const counts = Object.fromEntries(LISTS.map(([id]) => [id, inList(id).length]));
        sc.innerHTML = `<div class="phead"><h1 class="lt">Tasks</h1><p class="sub"><b class="num">${open.length}</b> open · <b class="num">${doneToday().length}</b> done today</p></div>
          <div class="pad tp-search"><label class="field">${I.search}<input type="search" placeholder="Search tasks, areas, projects" aria-label="Search tasks" value="${esc(q)}" /></label></div>
          <div class="pad tp-tiles"><div class="tiles">${LISTS.map(([id, label]) => `<button class="tl${id === 'overdue' && counts[id] ? ' late' : ''}" data-act="t-jump" data-id="${id}"><b class="met">${rollHTML(counts[id])}</b><span>${label}</span></button>`).join('')}</div></div>
          <div class="ptools pad"><span class="foot">Group by</span>${seg('tgroup', REAL ? [['date', 'Date'], ['project', 'Project'], ['area', 'Area'], ['aspect', 'Aspect']] : [['date', 'Date'], ['project', 'Project'], ['aspect', 'Aspect']], group, 'sm tp-group')}</div>
          <div class="tp-body">${body || `<p class="note tp-empty">No open tasks. Add one with +.</p>`}</div>
          <p class="note tp-none" hidden></p>
          <div class="group tp-add"><button class="row ic" data-act="td-add"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">Add a task</span></span></button></div>`;
        wireSegs(sc);
        $('[data-seg="tgroup"]', sc).addEventListener('change', (e) => { group = e.detail; draw(); stagger($$('.tp-body > *', sc), { y: 8, each: 24, max: 240 }); });
        const input = $('.tp-search input', sc);
        input.addEventListener('input', () => { q = input.value; filter(); });
        filter();
        if (first) stagger($$('.tp-tiles .tl, .tp-body > .sh, .tp-body > .group', sc), { y: 10, each: 30, max: 300 });
      };
      // search reads titles, areas and projects; it hides the rows that do not match, recounts, hides empty sections
      const filter = () => {
        const s = q.trim().toLowerCase();
        $$('.tp-body .trow', sc).forEach((r) => {
          const t = task(r.dataset.id);
          const hay = `${t?.title ?? ''} ${t ? areaName(t.area) : ''} ${t?.project ? projectName(t.project) : ''} ${t?.notes ?? ''}`.toLowerCase();
          r.hidden = !!s && !hay.includes(s);
          const strip = r.nextElementSibling; if (strip?.classList.contains('tri-strip')) strip.hidden = r.hidden;
        });
        let any = false;
        $$('.tp-body .group', sc).forEach((g) => {
          if (g.classList.contains('tp-more-g')) { g.hidden = !!s; return; }
          const n = $$('.trow:not([hidden])', g).length;
          let h = g.previousElementSibling; while (h && !h.classList.contains('sh') && !h.classList.contains('tp-day')) h = h.previousElementSibling;
          g.hidden = !n; if (h) { h.hidden = !n; const c = $('.sh-count', h); if (c) c.textContent = n; }
          any ||= n > 0;
        });
        $$('.tp-body .tp-cap, .tp-body .triage', sc).forEach((c) => { c.hidden = !!s; });
        const none = $('.tp-none', sc); none.hidden = any || !s; none.textContent = `No task matches "${q.trim()}".`;
      };
      page._refresh = () => { const y = sc.scrollTop; draw(); sc.scrollTop = y; };
      page._date = () => { if (group !== 'date') { group = 'date'; draw(); } };
      page._doneAll = () => { doneAll = !doneAll; page._refresh(); };
      draw(true);
      swipeRows(sc, '.trow', { right: (r) => complete(r.dataset.id), left: (r) => toTomorrow(r.dataset.id) });
      if (list) requestAnimationFrame(() => jump(page, list));
    },
  });
}
function jump(page, id) {
  const sc = $('.scroll', page);
  page._date?.();
  const h = $(`#tsec-${id}`, sc);
  if (!h) { toast(EMPTY[id] ?? 'Nothing here'); return; }
  haptic('selection');
  sc.scrollTo({ top: h.offsetTop - parseFloat(getComputedStyle(sc).paddingTop) + 8, behavior: 'smooth' });
}
on('t-jump', (el) => jump(el.closest('.page'), el.dataset.id));
on('td-done-all', (el) => el.closest('.page')?._doneAll?.());
document.addEventListener('td-redraw', () => $$('.tasks-page').forEach((p) => {
  // the tiles roll to their new counts; the rest redraws in place
  const counts = Object.fromEntries(LISTS.map(([id]) => [id, inList(id).length]));
  p._refresh?.();
  $$('.tp-tiles .tl', p).forEach((b) => { const r = $('.mx-roll', b); if (r) roll(r, counts[b.dataset.id]); });
}));

// ── the inbox, sorted by the agent: a suggestion under each item, Keep one, or Keep all ──
function triageCard(inbox) {
  if (!inbox.length) return '';
  if (DEMO_MODE || !canAI()) {
    if (TRI.state === 'ready' && Object.keys(TRI.items).length) return keepAllCard();
    return REAL && USER?.owner ? `<div class="triage surface"><span class="bi">${I.sparkle}</span><span class="bt"><b>Sort the inbox</b><small>Needs your PC. ${plural(inbox.length, 'item')} wait${inbox.length === 1 ? 's' : ''} here.</small></span></div>` : '';
  }
  if (TRI.state === 'thinking') return `<div class="triage surface" role="status"><span class="bi"><span class="spin"></span></span><span class="bt"><b>Sorting the inbox</b><small>Haiku on your PC, a few seconds</small></span></div>`;
  if (TRI.state === 'ready' && inbox.some((t) => TRI.items[t.id])) return keepAllCard();
  return `<div class="triage surface"><span class="orb xs" aria-hidden="true"></span><span class="bt"><b>Sort the inbox</b><small>Area, day and length for ${plural(inbox.length, 'item')}</small></span><button class="btn sm primary" style="--c:var(--today-fill)" data-act="triage">Sort</button></div>`;
}
const keepAllCard = () => { const n = Object.keys(TRI.items).filter((id) => task(id)?.list === 'inbox').length; return `<div class="triage surface"><span class="bi">${I.sparkle}</span><span class="bt"><b>${plural(n, 'suggestion')}</b><small>Keep one, or open the task to change it first</small></span><button class="btn sm primary" style="--c:var(--today-fill)" data-act="triage-all">Keep all</button></div>`; };
function triStrip(t) {
  const x = TRI.state === 'ready' && t.list === 'inbox' ? TRI.items[t.id] : null;
  if (!x) return '';
  const g = x.goal ? goal(x.goal) : null;
  const chips = [
    x.area ? `<span class="chip sm is-static">${areaDot(x.area)}${esc(area(x.area).name.split(' ')[0])}</span>` : '',
    `<span class="chip sm is-static">${x.due ? esc(rel(x.due)) : 'No date'}</span>`,
    `<span class="chip sm is-static num">${dur(x.minutes ?? 30)}</span>`,
    g ? `<span class="chip sm is-static">${esc(goalShort(g.id))}</span>` : '',
  ].join('');
  return `<div class="tri-strip" data-id="${t.id}"><div class="tri-b"><div class="tri-chips">${chips}</div>${x.why ? `<p class="tri-why">${esc(x.why)}</p>` : ''}</div><button class="tri-skip" data-act="triage-skip" data-id="${t.id}" aria-label="Skip this suggestion">${I.x}</button><button class="btn sm tint tri-keep" style="--c:var(--today)" data-act="triage-keep" data-id="${t.id}">Keep</button></div>`;
}
const redrawTasks = () => document.dispatchEvent(new CustomEvent('td-redraw'));
on('triage', async () => {
  if (!canAI()) { toast('Sorting the inbox needs your PC'); return; }
  TRI.state = 'thinking'; haptic(6); redrawTasks();
  try {
    const r = await aiTriage();
    Object.assign(TRI, { state: 'ready', items: r.items, batchId: r.batchId });
    haptic('success');
    if (!Object.keys(r.items).length) { TRI.state = null; toast('Nothing to suggest for the inbox'); }
  } catch (e) { TRI.state = null; toast(e?.status ? e.message : 'Your PC isn’t reachable right now'); }
  redrawTasks();
});
function keepTriage(ids) {
  const snaps = [], kept = [];
  for (const id of ids) {
    const t = task(id), x = TRI.items[id];
    if (!t || !x || t.list !== 'inbox') continue;
    snaps.push([id, { ...snapOf(id), area: t.area ?? null, goal: t.goal ?? null }]);
    W.update(id, { status: 'todo', area: x.area ?? t.area ?? null, due: x.due ?? t.due ?? null, estimateMinutes: x.minutes ?? null, goal: x.goal ?? t.goal ?? null });
    if (x.pid) kept.push(x.pid);
    delete TRI.items[id];
  }
  decide(TRI.batchId, { kept });
  haptic('success');
  redrawTasks();
  return { n: snaps.length, undo: () => { for (const [id, s] of snaps) W.update(id, s); } };
}
on('triage-keep', (el) => { const r = keepTriage([el.dataset.id]); if (r.n) toast('Sorted', r.undo); });
on('triage-all', () => { const r = keepTriage(Object.keys(TRI.items)); if (r.n) toast(`Sorted ${plural(r.n, 'item')}`, r.undo); });
on('triage-skip', (el) => { const x = TRI.items[el.dataset.id]; if (x?.pid) decide(TRI.batchId, { removed: [x.pid] }); delete TRI.items[el.dataset.id]; haptic(5); redrawTasks(); });

// ── three in progress at a time: Home picks the three that matter, the rest wait (back to to-do), he keeps it ──
const CAP = { pick: null };
function capCard(doing) {
  if (CAP.pick) {
    const names = CAP.pick.keep.map((id) => task(id)?.title.split(':')[0]).filter(Boolean);
    return `<div class="tp-cap surface"><span class="orb xs" aria-hidden="true"></span><span class="bt"><b>Keep: ${esc(names.join(', '))}</b><small>${plural(CAP.pick.rest.length, 'other waits', 'others wait')} as to-do until one of these ships${CAP.pick.busy ? `. ${plural(CAP.pick.busy, 'job')} still working stay${CAP.pick.busy === 1 ? 's' : ''}` : ''}</small></span><button class="btn sm primary" style="--c:var(--today-fill)" data-act="td-cap-keep">Keep</button></div>`;
  }
  return `<div class="tp-cap surface"><span class="orb xs" aria-hidden="true"></span><span class="bt"><b>${doing.length} things are in progress</b><small>Pick the three that matter this week; the rest wait as to-do.</small></span><button class="btn sm" data-act="td-cap">Pick 3</button></div>`;
}
on('td-cap', () => {
  const doing = inList('doing');
  const score = (t) => { const g = t.goal ? goal(t.goal) : null; const d = dateOf(t); return (g?.verdict === 'Behind pace' ? 0 : g ? 1 : 2) + (d && d <= TODAY ? -0.5 : 0) + (t.priority ?? 2) / 10 - (withAgent(t) ? 0.3 : 0) - Date.parse(t.startedAt ?? 0) / 1e15; };
  const sorted = [...doing].sort((a, b) => score(a) - score(b));
  const keep = sorted.slice(0, 3).map((t) => t.id);
  const others = sorted.slice(3);
  const busy = others.filter(withAgent).length;
  CAP.pick = { keep, rest: others.filter((t) => !withAgent(t)).map((t) => t.id), busy };
  haptic(6); redrawTasks();
});
on('td-cap-keep', () => {
  const rest = CAP.pick?.rest ?? []; CAP.pick = null;
  const snaps = rest.map((id) => [id, snapOf(id)]);
  for (const id of rest) W.pause(id);
  haptic('success'); redrawTasks();
  toast(`Three in progress, ${plural(rest.length, 'waiting')}`, () => { for (const [id, s] of snaps) W.restore(id, s); });
});

provide('openTask', (id) => openTask(id));
provide('openTasks', (list) => openTasks(list));

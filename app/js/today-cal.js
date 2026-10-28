// The calendar: the week strip (each day's load under its date), the week as blocks on a time grid, the month with
// each day's density and an agenda for the picked day. Today shows these in place; from any other app openCalendar()
// pushes the same views as a page, so that app's back stack stays put. Days outside the loaded week are fetched
// (today-data ensureRange) and drawn once they land; until then they say so rather than look free.
import { $, $$, esc, on, push, seg, wireSegs, haptic, pulse, ring } from './core.js';
import { api } from './bus.js';
import { I, aspectIcon } from './icons.js';
import { GOALS, TASKS } from './data.js';
import { stagger } from './motion.js';
import { weekOf, monthGrid, monthStart, ensureRange, known, rel, daysRoute } from './today-data.js';
import { S, NOW, hm, dur, plural, colorOf, aspectName, blocksOn, freeOn, bookedOn, TODAY, day, addDays, isOpen, dateOf, atOf, task, REAL, allOn } from './today-state.js';

const dot = (id) => (id ? `<i class="dot" style="--c:var(--${id})"></i>` : '');
export function findEvent(id) {
  for (let i = -1; i < 60; i++) {
    const iso = addDays(TODAY, i);
    const e = (allOn(iso) ?? []).find((x) => x.id === id);
    if (e) return { ...e, date: iso };
  }
  return null;
}
const loadOf = (iso) => { const b = bookedOn(iso); return b == null ? null : Math.min(1, b / 540); };   // nine booked hours is a full day
/** Tasks due on a day without a time (with a time they are blocks). */
export const dueOn = (iso) => TASKS.filter((t) => isOpen(t) && dateOf(t) === iso && atOf(t) == null && t.list !== 'inbox');
const notLoaded = () => (REAL && daysRoute() === 'missing' ? 'This phone has today and the next six days. Other days load once your PC can send them.' : 'Loading from your PC…');

// ── the week strip: seven days, today in Today's colour, each day's load as a short bar under its date ──
export function weekStrip(sel, act = 'td-day') {
  const days = weekOf(sel);
  // this week's strip draws from what the phone has; another week's asks the PC for its days
  if (days[0] !== weekOf(TODAY)[0]) ensureRange(days[0], 7);
  const i = Math.max(0, days.indexOf(sel));
  return `<div class="td-week" role="group" aria-label="This week" style="--i:${i}"><span class="td-week-lens${sel === TODAY ? ' is-today' : ''}" aria-hidden="true"></span>${days.map((iso) => {
    const d = day(iso), isT = iso === TODAY, isOn = iso === sel, l = loadOf(iso);
    const label = `${d.long}${isT ? ', today' : ''}${l == null ? '' : `, ${dur(bookedOn(iso))} booked`}`;
    return `<button class="td-wd${isT ? ' is-today' : ''}${isOn ? ' on' : ''}${iso < TODAY ? ' past' : ''}${l == null ? ' unknown' : ''}" data-act="${act}" data-iso="${iso}" aria-label="${esc(label)}" aria-pressed="${isOn}">
      <span class="td-wd-l">${d.wd.slice(0, 1)}</span><b class="td-wd-n num">${d.d}</b><i class="td-wd-load" style="--p:${(l ?? 0).toFixed(2)}" aria-hidden="true"></i></button>`;
  }).join('')}</div>`;
}

// ── the week: seven columns of blocks over the waking hours, the now line in today's column ──
const PX = 30;   // pixels per hour
export function weekView(iso, act = 'td-day') {
  const days = weekOf(iso);
  ensureRange(days[0], 7);
  const all = days.map((d) => blocksOn(d));
  const lo = Math.min(6, ...all.flat().map((b) => Math.floor(Math.max(0, b.start) / 60)));
  const hi = Math.max(23, ...all.flat().map((b) => Math.ceil(Math.min(1440, b.end) / 60)));
  const H0 = Math.max(0, lo), H1 = Math.min(24, hi);
  const y = (m) => ((m / 60 - H0) * PX).toFixed(1);
  const cols = days.map((d, k) => {
    if (!known(d)) return `<div class="td-wk-col unknown" data-act="${act}" data-iso="${d}" aria-label="${esc(`${day(d).long}: not loaded yet`)}"></div>`;
    const blocks = all[k].filter((e) => e.end > H0 * 60 && e.start < H1 * 60).map((e) => {
      const top = Math.max(e.start, H0 * 60), bot = Math.min(e.end, H1 * 60), h = (bot - top) / 60 * PX;
      const isTask = e.kind === 'task';
      const tag = h - 2 >= 44 ? 'button' : 'span';
      const a = tag === 'button' ? (isTask ? ` data-act="task" data-id="${e.task}"` : ` data-act="event" data-id="${e.id}"`) : '';
      return `<${tag} class="td-wk-b${isTask ? ' task' : ''}${e.aspect ? '' : ' untagged'}${(e.end <= NOW && d === TODAY) || d < TODAY ? ' past' : ''}${e.done ? ' done' : ''}" data-aspect="${e.aspect ?? ''}" style="top:${y(top)}px;height:${Math.max(10, h - 2).toFixed(1)}px;--c:${colorOf(e)}"${a} aria-label="${esc(`${e.title}, ${day(d).short} ${hm(e.start)}–${hm(e.end)}`)}">${h >= 22 ? (aspectIcon[e.aspect] ?? (isTask ? I.check : I.tag)) : ''}</${tag}>`;
    }).join('');
    const now = d === TODAY ? `<span class="td-wk-now" style="top:${y(NOW)}px" aria-hidden="true"></span>` : '';
    return `<div class="td-wk-col${d === TODAY ? ' today' : ''}${d === iso ? ' sel' : ''}" data-act="${act}" data-iso="${d}">${blocks}${now}</div>`;
  }).join('');
  const heads = days.map((d) => {
    const x = day(d), free = freeOn(d);
    return `<button class="td-wk-h${d === TODAY ? ' today' : ''}" data-act="${act}" data-iso="${d}" aria-label="${esc(`${x.long}${free == null ? '' : `, ${dur(free)} free`}`)}"><span>${x.wd.slice(0, 1)}</span><b class="num">${x.d}</b><small class="num">${d < TODAY || free == null ? '' : short(free)}</small></button>`;
  }).join('');
  const axis = Array.from({ length: Math.floor((H1 - H0) / 3) + 1 }, (_, i) => H0 + i * 3).map((h) => `<span style="top:${((h - H0) * PX).toFixed(1)}px">${String(h).padStart(2, '0')}</span>`).join('');
  const loaded = days.filter(known);
  const total = loaded.reduce((a, d) => a + (bookedOn(d) ?? 0), 0);
  const ahead = loaded.filter((d) => d >= TODAY);
  const busiest = loaded.reduce((a, d) => ((bookedOn(d) ?? 0) > (bookedOn(a) ?? -1) ? d : a), loaded[0]);
  const roomiest = ahead.reduce((a, d) => ((freeOn(d) ?? 0) > (freeOn(a) ?? -1) ? d : a), ahead[0]);
  const due = days.reduce((a, d) => a + dueOn(d).length, 0);
  const weekGoals = GOALS.filter((g) => g.horizon === 'week' && g.status !== 'done');
  return `<div class="td-body td-wk">
    <div class="td-wk-head"><span class="td-wk-sp"></span>${heads}</div>
    <div class="td-wk-grid" style="height:${(H1 - H0) * PX}px">
      <div class="td-wk-axis num" aria-hidden="true">${axis}</div>
      <div class="td-wk-cols">${cols}</div>
    </div>
    ${loaded.length < 7 ? `<p class="hint td-wk-miss">${esc(notLoaded())}</p>` : ''}
    <div class="group td-wk-sum">
      ${loaded.length ? `<div class="row"><span class="rbody"><span class="rtitle"><b class="num">${dur(total)}</b> on the calendar</span><span class="rmeta">${busiest ? `Busiest ${esc(day(busiest).wdLong)}` : ''}${roomiest ? ` · most room ${esc(day(roomiest).wdLong)}` : ''}</span></span></div>` : ''}
      ${weekGoals.map((g) => `<button class="row ic" data-act="td-cal-goal" data-id="${g.id}"><span class="td-wk-goal">${ring(g.pace, g.aspects?.[0] ?? 'mission', 30, 4, { k: g.time, label: `${Math.round(g.pace * 100)}% done` })}</span><span class="rbody"><span class="rtitle">${esc(g.title)}</span><span class="rmeta"><span class="${g.verdict === 'Behind pace' ? 'late' : ''}">${esc(g.verdict)}</span><span>· week goal</span></span></span>${I.chevR}</button>`).join('')}
      ${due ? `<div class="row"><span class="rbody"><span class="rtitle">${plural(due, 'task')} due this week</span><span class="rmeta"><span class="ell">${days.flatMap((d) => dueOn(d).map((t) => `${day(d).wd} · ${esc(t.title.split(':')[0])}`)).join(' · ')}</span></span></span></div>` : ''}
    </div>
  </div>`;
}
// free time under a date: exact while it is short, whole hours once it is a long stretch
const short = (m) => (m < 300 ? dur(m) : `${Math.round(m / 60)}h`);
on('td-cal-goal', (el) => api.openGoal(el.dataset.id));

// ── the month: whole weeks; each day its date, the parts of the wheel it touches, and how full it is ──
export function monthView(iso, act = 'td-mo-pick', open = 'td-day') {
  const d = day(iso);
  const grid = monthGrid(iso);
  ensureRange(grid[0][0], grid.length * 7);
  const cells = grid.map((wk) => `<div class="td-mo-row">${wk.map((x) => {
    const xd = day(x), out = xd.m !== d.m, isT = x === TODAY, sel = x === iso && !out;
    const k = known(x);
    const evs = k ? blocksOn(x).filter((b) => b.kind === 'event') : [];
    const asp = [...new Set(evs.map((e) => e.aspect).filter(Boolean))].slice(0, 4);
    const l = k ? Math.round((loadOf(x) ?? 0) * 4) : 0;
    const due = dueOn(x).length;
    return `<button class="td-mo-d${out ? ' out' : ''}${isT ? ' today' : ''}${sel ? ' sel' : ''}${x < TODAY ? ' past' : ''}${k ? '' : ' unknown'}" data-l="${out ? 0 : l}" data-act="${act}" data-iso="${x}" aria-label="${esc(`${xd.long}: ${k ? plural(evs.length, 'event') : 'not loaded'}${due ? `, ${plural(due, 'task')} due` : ''}`)}" aria-pressed="${sel}">
      <b class="num">${xd.d}</b><span class="td-mo-dots" aria-hidden="true">${out ? '' : asp.map((a) => `<i style="--c:var(--${a})"></i>`).join('')}</span>${due && !out ? '<em class="td-mo-due" aria-hidden="true"></em>' : ''}</button>`;
  }).join('')}</div>`).join('');
  return `<div class="td-body td-mo">
    <div class="td-mo-wd" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="td-mo-grid">${cells}</div>
    <div class="td-mo-key"><span><i class="td-mo-k1"></i>Light</span><span><i class="td-mo-k4"></i>Full</span><span><em class="td-mo-due"></em>Task due</span></div>
    ${agenda(iso, open)}
  </div>`;
}
// the picked day, as a list: its blocks in time order, then what is due
export function agenda(iso, open = 'td-day') {
  const d = day(iso);
  const k = known(iso);
  const evs = blocksOn(iso);
  const due = dueOn(iso);
  return `<section class="td-mo-agenda">
    <div class="sh"><h2>${esc(rel(iso) === `${d.wd} ${d.d}` ? d.wdLong : rel(iso))}<span class="td-mo-ag-d"> · ${d.d} ${esc(d.mon)}</span></h2><button class="sh-act" data-act="${open}" data-iso="${iso}">Open day ${I.chevR}</button></div>
    <div class="group td-mo-list">${!k ? `<div class="row"><span class="rbody"><span class="rmeta">${esc(notLoaded())}</span></span></div>` : evs.length ? evs.map((e) => `<button class="row td-mo-ev${iso < TODAY || (iso === TODAY && e.end <= NOW) ? ' past' : ''}${e.done ? ' done' : ''}" ${e.kind === 'task' ? `data-act="task" data-id="${e.task}"` : `data-act="event" data-id="${e.id}"`}>
        <span class="td-mo-ev-t num">${hm(e.start)}<small>${hm(e.end)}</small></span><span class="td-mo-ev-r" style="--c:${colorOf(e)}"></span>
        <span class="rbody"><span class="rtitle">${esc(e.title)}</span><span class="rmeta">${e.kind === 'task' ? `${I.check}<span>Task</span>` : ''}${dot(e.aspect)}${esc(e.aspect ? aspectName(e.aspect) : e.kind === 'event' ? 'No area' : '')}${e.where ? ` · ${esc(e.where)}` : ''}</span></span></button>`).join('')
      : '<div class="row"><span class="rbody"><span class="rmeta">Nothing on the calendar.</span></span></div>'}
      ${due.map((t) => `<button class="row td-mo-ev" data-act="task" data-id="${t.id}"><span class="td-mo-ev-t">${I.check}</span><span class="td-mo-ev-r" style="--c:var(--${t.aspect ?? 'mission'})"></span><span class="rbody"><span class="rtitle">${esc(t.title)}</span><span class="rmeta">Task due${t.goal ? ' · moves a goal' : ''}</span></span></button>`).join('')}
    </div>
  </section>`;
}
on('td-mo-pick', (el) => {
  const root = el.closest('[data-cal]'); const c = root?._cal; if (!c) return;
  const iso = el.dataset.iso;
  if (iso === c.get() && day(iso).m === day(c.get()).m) { c.open(iso); return; }   // a second tap opens the day
  haptic('selection');
  // the picked circle moves; only the agenda under the grid redraws
  $$('.td-mo-d.sel', root).forEach((x) => { x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false'); });
  if (day(iso).m === day(c.get()).m) {
    el.classList.add('sel'); el.setAttribute('aria-pressed', 'true');
    c.quiet(iso);
    const ag = $('.td-mo-agenda', root);
    if (ag) { ag.outerHTML = agenda(iso, c.openAct ?? 'td-day'); stagger($$('.td-mo-agenda .row', root), { y: 8, each: 28, max: 220 }); }
  } else c.set(iso, { keepView: true });
});

// swipes: the strip and the week move by a week, the month by a month
export function wireCal(root, { get, set, open, quiet, openAct } = {}) {
  root.dataset.cal = '1';
  root._cal = { get, set: (iso) => set(iso), quiet: quiet ?? ((iso) => set(iso)), openAct, open: open ?? ((iso) => { S.date = iso; S.view = 'day'; set(iso); }) };
  const swipe = (sel, step) => {
    const el = $(sel, root); if (!el || el._sw) return; el._sw = true;
    let x0 = null, y0 = 0;
    el.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; }, { passive: true });
    el.addEventListener('pointerup', (e) => {
      if (x0 == null) return; const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
      if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.4) { haptic('selection'); root.dataset.dir = dx < 0 ? 'next' : 'prev'; set(step(get(), dx < 0 ? 1 : -1)); }
    });
    el.addEventListener('pointercancel', () => { x0 = null; });
  };
  swipe('.td-week', (iso, n) => addDays(iso, 7 * n));
  swipe('.td-wk-grid', (iso, n) => addDays(iso, 7 * n));
  swipe('.td-mo-grid', (iso, n) => monthStart(iso, n));
}

// ── the calendar as a page (openCalendar from any app) ──
export function openCalendar(view = 'month', date = TODAY) {
  const cs = { view: ['day', 'week', 'month'].includes(view) ? view : 'month', date: date ?? TODAY };
  push({
    title: 'Calendar', cls: 'td-calpage',
    render(sc, page) {
      const draw = () => {
        const d = day(cs.date);
        const ws = addDays(cs.date, -d.dow);
        const title = cs.view === 'month' ? d.monLong : cs.view === 'week' ? `Week of ${day(ws).d} ${day(ws).mon}` : cs.date === TODAY ? 'Today' : d.wdLong;
        const body = cs.view === 'month' ? monthView(cs.date, 'td-mo-pick', 'td-cp-day') : cs.view === 'week' ? weekView(cs.date, 'td-cp-day') : `${weekStrip(cs.date, 'td-cp-day')}<div class="td-body">${agenda(cs.date, 'td-cp-today')}</div>`;
        sc.innerHTML = `<header class="phead td-head td-cp-head"><h1 class="lt">${esc(title)}</h1>
          <div class="td-dl"><p class="sub">${esc(cs.view === 'month' ? String(d.y) : d.long)}</p><span class="td-dl-sp"></span>${seg('td-cp-view', [['day', 'Day'], ['week', 'Week'], ['month', 'Month']], cs.view, 'sm td-views')}</div></header>${body}`;
        wireSegs(sc);
        $('[data-seg="td-cp-view"]', sc).addEventListener('change', (e) => { cs.view = e.detail; haptic('selection'); draw(); pulse(sc); });
        wireCal(sc, { get: () => cs.date, set: (iso) => { cs.date = iso; draw(); }, quiet: (iso) => { cs.date = iso; }, openAct: 'td-cp-day', open: (iso) => { cs.date = iso; cs.view = 'day'; draw(); } });
      };
      page._cs = cs; page._draw = draw;
      draw();
      document.addEventListener('td-redraw', () => { if (page.isConnected) { const y = sc.scrollTop; draw(); sc.scrollTop = y; } });
    },
  });
}
on('td-cp-day', (el) => { const page = el.closest('.td-calpage'); if (!page) return; page._cs.date = el.dataset.iso; page._cs.view = 'day'; haptic('selection'); page._draw(); });
// "Open day" from the calendar page's own day: Today's tab at that day
on('td-cp-today', (el) => { const iso = el.dataset.iso; S.date = iso; S.view = 'day'; api.setTab('today'); setTimeout(() => document.dispatchEvent(new CustomEvent('td-redraw')), 60); });

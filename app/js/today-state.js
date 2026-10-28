// Home's state and the day model: what is on the clock, what is free, what still needs a slot, and every write Home
// makes (W). Every Home view reads from here and redraws on onChange(); today.js listens.
//
// Real mode: tasks and events are the real records (js/data.js views, kept current by svc/sync); W writes through
// data.js (planTask, completeTask, moveEvent …), so a change lands on the phone at once and on the PC when it answers,
// offline first. Demo mode (?data=demo) writes the same fields onto the sample views, so both modes share one model.
import { fmtDur } from './core.js';
import * as clock from './svc/clock.js';
import { onChange as syncChange } from './svc/sync.js';
import { NOW, EVENTS, TASKS, FEED, JOBS, GOALS, PROJECTS, aspect, area, project, DEMO_MODE, USER, onData, completeTask, startTask, planTask, unplanTask, dropTask, updateTask, addTask as dataAddTask, moveEvent as dataMoveEvent } from './data.js';
import { TODAY, REAL, addDays, day, hm, toMin, isTime, snapUp, eventsOn, allOn, known, lenOf, nightOf, morningOf, windowOf, onCalendar, onToday, isoOfLabel, send, cancel, patchFetched, fetchedEvent, demoEvent, shortTitle } from './today-data.js';

export { TODAY, addDays, day, hm, toMin, isTime };
export const dur = (m) => fmtDur(Math.max(0, Math.round(m)));
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const now = () => NOW;

// ── the screen's own state (never sent anywhere) ─────────────────────
export const S = {
  view: 'day', date: TODAY,
  earlier: false,        // the past fold is open
  night: false,          // the night is open (sleep's hours shown as time you can plan)
  fresh: null,           // tasks that just landed (they play the land animation once)
  plan: null,            // the agent's plan while its sheet is open
  feed: new Map(),       // an ask answered here → 'yes' | 'no' (until her feed says so)
};
onToday((t) => { if (S.date < t || S.view === 'day') S.date = t; changed('day'); });

// ── change → redraw ──────────────────────────────────────────────────
const subs = new Set();
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const changed = (why = '') => subs.forEach((fn) => { try { fn(why); } catch (e) { console.error('[today] redraw failed', e); } });
{
  let tm = 0;
  onData((why) => {
    if (!['local', 'server', 'rename', 'boot', 'day', 'jobs', 'synced', 'agent'].includes(why)) return;
    if (why === 'synced' && !REAL) return;
    clearTimeout(tm);
    tm = setTimeout(() => changed(`data:${why}`), why === 'local' ? 0 : 120);
  });
  onCalendar((why) => changed(`cal:${why}`));
}

// ── tasks, as Home reads them (one shape in both modes) ─────────────────
// A task made on the phone has a temp id (n…) until the PC answers; anything on screen that still holds the temp id
// (an open sheet, a tray card) keeps working: lookups follow the rename.
const renamed = new Map();
syncChange((why, d) => { if (why === 'rename' && d?.from && d?.to) renamed.set(d.from, d.to); });
export const idOf = (id) => { let x = id, n = 0; while (renamed.has(x) && n++ < 4) x = renamed.get(x); return x; };
export const task = (id) => TASKS.find((k) => k.id === idOf(id)) ?? null;
export const isDone = (t) => !!t && (t.status === 'done' || t.list === 'done');
export const isOpen = (t) => !!t && !isDone(t) && t.status !== 'dropped';
// demo views carry when ('18:45' · 'Today' · 'Fri 23'); real ones carry date + at (minutes on that date)
export const dateOf = (t) => {
  if (!t) return null;
  if (REAL || t.date) return t.date ?? null;
  if (t.list === 'today' || t.list === 'doing' || isDone(t)) return TODAY;
  if (t.list === 'overdue') return addDays(TODAY, -1);
  if (t.list === 'upcoming') return isoOfLabel(t.when);
  return null;
};
export const atOf = (t) => {
  if (!t) return null;
  if (REAL || 'at' in t) return t.at ?? null;
  return isTime(t.when) ? toMin(t.when) : null;
};
/** Where a scheduled task ends (minutes on its date): its scheduled end, else its length after it starts. */
export const endOf = (t) => {
  const a = atOf(t);
  if (a == null) return null;
  if (REAL && t.scheduled?.end && t.date) return Math.round(clock.toMin(t.scheduled.end, t.date));
  return a + lenOf(t);
};
export const isTimed = (t) => atOf(t) != null;
/** A job is working on it (or the older Give to Claude has it). */
export const withAgent = (t) => !!t && (JOBS.some((j) => j.task === t.id && (j.lane === 'working' || j.lane === 'needs')) || t.owner === 'claude' || !!t._agent);
export const jobsOf = (t) => (t ? JOBS.filter((j) => j.task === t.id || (t.jobIds ?? []).includes(j.id)) : []);
// a step (a subtask) lives inside its task's sheet, not in the tray or the lists
export const allOpen = () => TASKS.filter((t) => isOpen(t) && !t.parent);
export const LISTS = [['overdue', 'Overdue'], ['today', 'Today'], ['doing', 'Ongoing'], ['inbox', 'Inbox'], ['upcoming', 'Upcoming']];
/** A smart list: overdue · today · doing (in progress, or an agent on it) · inbox · upcoming · nodate · done (today) */
export function inList(l) {
  if (l === 'done') return TASKS.filter((t) => isDone(t) && (t.doneToday || !REAL));
  const open = allOpen();
  if (l === 'doing') return open.filter((t) => t.list === 'doing' || (withAgent(t) && t.list !== 'inbox'));
  return open.filter((t) => t.list === l);
}
export const doneToday = () => TASKS.filter((t) => isDone(t) && (t.doneToday || !REAL));

// ── the day: events and task blocks on one timeline ─────────────────────
// { kind: 'event' | 'task', id, task?, title, start, end, aspect, area, where, people, date, done, ev }
export function blocksOn(iso = TODAY, { night = false } = {}) {
  if (!known(iso)) return [];
  const evs = eventsOn(iso).map((e) => ({ kind: 'event', id: e.id, title: e.title, full: e.full ?? e.title, start: e.start, end: e.end, aspect: e.aspect ?? null, area: e.area ?? null, where: e.where, people: e.people, date: iso, ev: e, editable: e.editable !== false && !e.mock }));
  const tb = [];
  for (const t of TASKS) {
    if (t.status === 'dropped') continue;
    const d = dateOf(t), a = atOf(t);
    if (a == null || !d) continue;
    let s = null;
    if (d === iso) s = a;
    // late-night work after midnight sits at the end of the night before
    else if (night && d === addDays(iso, 1) && a < morningOf(d).wake) s = a + 1440;
    if (s == null) continue;
    const e = endOf(t) + (s - a);
    tb.push({ kind: 'task', id: `tk-${t.id}`, task: t.id, title: t.title, start: s, end: Math.max(s + 5, e), aspect: t.aspect ?? null, area: t.area ?? null, date: iso, done: isDone(t), editable: true });
  }
  return [...evs, ...tb].sort((a, b) => a.start - b.start || a.end - b.end);
}
/** The block he is in: the shortest one covering now (a task inside a longer block wins). */
export const current = () => blocksOn(TODAY).filter((b) => b.start <= NOW && b.end > NOW).sort((a, b) => (a.end - a.start) - (b.end - b.start))[0] ?? null;
/** The waking window of a day: up → bed. */
export const wake = (iso = TODAY) => windowOf(iso).wake;
export const bed = (iso = TODAY) => windowOf(iso).bed;
/** Up past bedtime (or still up in the small hours): the sleep block he is awake through, else null. */
export function awakeThrough() {
  const n = nightOf(TODAY), m = morningOf(TODAY);
  if (m.ev && NOW >= Math.max(0, m.ev.start) && NOW < m.wake) return { ...m, which: 'morning' };
  if (NOW >= n.bed && NOW < n.wake) return { ...n, which: 'night' };
  return null;
}
const firstFree = () => Math.max(snapUp(NOW, 5), wake(TODAY));
/** What is left of today: blocks still to come (or running) and the gaps between them, until bed. */
export function restOfToday(from = firstFree()) {
  const end = S.night ? nightOf(TODAY).wake : bed(TODAY);
  const items = blocksOn(TODAY, { night: S.night }).filter((b) => b.end > from && b.start < end);
  const out = []; let cur = from;
  for (const b of items) {
    if (b.start - cur >= 15) out.push({ gap: true, start: cur, end: b.start });
    out.push(b); cur = Math.max(cur, b.end);
  }
  if (end - cur >= 15) out.push({ gap: true, start: cur, end });
  // with the night open, the gap inside sleep is time he could work in (sleep moves around what lands there)
  if (S.night) { const n = nightOf(TODAY); for (const g of out) if (g.gap && g.start >= n.bed - 1) g.sleep = true; }
  return out;
}
export const gapsToday = () => restOfToday().filter((x) => x.gap && !x.sleep);
export const freeToday = () => gapsToday().reduce((a, g) => a + g.end - g.start, 0);
export const earlierToday = () => blocksOn(TODAY).filter((b) => b.end <= NOW);
/** Free time on any day: its waking window less its blocks (gaps of 15 minutes or more); null when not loaded. */
export function freeOn(iso) {
  if (iso === TODAY) return freeToday();
  if (!known(iso)) return null;
  const w = windowOf(iso);
  let cur = w.wake, free = 0;
  for (const b of blocksOn(iso)) { if (b.end <= cur) continue; if (b.start >= w.bed) break; if (b.start - cur >= 15) free += b.start - cur; cur = Math.max(cur, b.end); }
  if (w.bed - cur >= 15) free += w.bed - cur;
  return free;
}
export const bookedOn = (iso) => (known(iso) ? blocksOn(iso).reduce((a, b) => a + Math.max(0, Math.min(b.end, 1440) - Math.max(0, b.start)), 0) : null);
/** The first free stretch of a day that fits len, at or after from (default: the day's start, or now today). */
export function slotFor(iso, len, from = null) {
  const start = from ?? (iso === TODAY ? firstFree() : wake(iso));
  const w = windowOf(iso);
  let cur = snapUp(start);
  for (const b of blocksOn(iso)) {
    if (b.end <= cur) continue;
    if (b.start - cur >= len) return cur;
    cur = snapUp(Math.max(cur, b.end));
  }
  return w.bed - cur >= len ? cur : null;
}

// The tray: open tasks due today (or late) with no time yet, not with an agent.
export function unplanned() {
  const open = allOpen().filter((t) => !isTimed(t) && !withAgent(t) && t.list !== 'doing');
  return { today: open.filter((t) => t.list === 'today'), late: open.filter((t) => t.list === 'overdue') };
}
/** Does the day fit? The free time left against what the unplaced tasks need. */
export function fit() {
  const u = unplanned();
  const all = [...u.today, ...u.late];
  const need = all.reduce((a, t) => a + lenOf(t), 0);
  const free = freeToday();
  return { free, need, over: need - free, count: all.length, today: u.today.length, late: u.late.length };
}
/** Tasks left today, the way he counts them: due today or late, not done. */
export const leftToday = () => allOpen().filter((t) => (t.list === 'today' || t.list === 'overdue') && !withAgent(t));
export const gapFor = (len) => gapsToday().find((g) => g.end - g.start >= len);
/** The task in progress (the one started last). */
export const doingNow = () => [...TASKS].filter((t) => isOpen(t) && t.list === 'doing').sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))[0] ?? null;

// ── the agent and work, as Today needs them ──────────────────────────
export const needsJobs = () => JOBS.filter((j) => j.lane === 'needs');
export const goal = (id) => GOALS.find((g) => g.id === id) ?? null;
export const colorOf = (b) => (b.aspect ? `var(--${b.aspect})` : 'var(--ink-3)');
export const aspectName = (id) => aspect(id)?.name ?? '';
export const areaName = (slug) => (slug ? area(slug).name : 'No area');
export const projectName = (slug) => project(slug)?.name ?? slug ?? '';
export const goalShort = (id) => { const g = goal(id); if (!g) return ''; const t = g.title.split(/[:,(]| — | - /)[0].trim(); return t.length > 34 ? `${t.slice(0, 32)}…` : t; };
export const demoAsks = () => (DEMO_MODE ? FEED.filter((f) => (f.kind === 'ask' || (f.kind === 'nudge' && f.acts)) && !S.feed.has(f.id)) : []);

// ── writes (W): one call per change, real or demo; each returns what Undo needs ─────────────────────────────
const nowIso = () => new Date(clock.nowMs()).toISOString();
const fire = () => document.dispatchEvent(new CustomEvent('data-changed', { detail: { why: 'local' } }));
const demoSet = (id, patch) => { const t = task(id); if (t) { Object.assign(t, patch); fire(); } return t; };
const demoList = (date, at) => (date == null ? 'nodate' : date < TODAY ? 'overdue' : date === TODAY ? 'today' : 'upcoming');
const demoWhen = (date, at) => (date === TODAY ? (at != null ? hm(at) : 'Today') : date ? `${day(date).wd} ${day(date).d}` : undefined);
/** The fields an Undo puts back. */
export function snapOf(id) {
  const t = task(id); if (!t) return null;
  if (!REAL) return { _demo: { list: t.list, when: t.when, date: t.date, at: t.at, len: t.len, status: t.status, late: t.late, doneToday: t.doneToday } };
  return { status: t.status, due: t.due ?? null, scheduled: t.scheduled ? { ...t.scheduled } : null, estimateMinutes: t.estimateMinutes ?? null, startedAt: t.startedAt ?? null, completedAt: t.completedAt ?? null };
}
export const W = {
  restore(id, snap) {
    id = idOf(id);
    if (!snap) return;
    if (snap._demo) { demoSet(id, snap._demo); return; }
    updateTask(id, snap);
  },
  done(id, on = true) {
    id = idOf(id);
    if (!REAL) { const t = task(id); if (!t) return; if (on) demoSet(id, { _was: t.list, list: 'done', status: 'done', doneToday: true }); else demoSet(id, { list: t._was ?? 'today', status: undefined, doneToday: false }); return; }
    completeTask(id, on);
  },
  start(id) {
    id = idOf(id);
    if (!REAL) { demoSet(id, { list: 'doing', spent: 0, startedAt: nowIso() }); return; }
    updateTask(id, { status: 'doing', startedAt: nowIso() });
  },
  pause(id) {
    id = idOf(id);
    if (!REAL) { demoSet(id, { list: 'today' }); return; }
    updateTask(id, { status: 'todo' });
  },
  /** A time on a day (at null: a day task, no time). */
  place(id, date, at = null, len = null) {
    id = idOf(id);
    const t = task(id); if (!t) return;
    if (!REAL) { demoSet(id, { list: t.list === 'doing' && date === TODAY ? 'doing' : demoList(date, at), when: demoWhen(date, at), date, at, late: date < TODAY ? t.late : undefined, ...(len ? { len } : {}) }); return; }
    planTask(id, { date, at, len: len ?? (at != null ? lenOf(t) : null) });
  },
  unplace(id) {
    id = idOf(id);
    const t = task(id); if (!t) return;
    if (!REAL) { const d = dateOf(t); demoSet(id, { at: null, when: demoWhen(d, null), date: d }); return; }
    unplanTask(id);
  },
  noDate(id) {
    id = idOf(id);
    if (!REAL) { demoSet(id, { list: 'nodate', when: undefined, date: null, at: null }); return; }
    updateTask(id, { due: null, scheduled: null });
  },
  drop(id) {
    id = idOf(id);
    if (!REAL) { const i = TASKS.findIndex((t) => t.id === id); const [v] = i >= 0 ? TASKS.splice(i, 1) : []; fire(); return () => { if (v) { TASKS.splice(i, 0, v); fire(); } }; }
    const was = task(id)?.status ?? 'todo';
    dropTask(id);
    // the undo finds the task by its id now (a new task may have got its PC id in between)
    return () => updateTask(idOf(id), { status: was === 'dropped' ? 'todo' : was });
  },
  update(id, patch) {
    id = idOf(id);
    if (!REAL) {
      const p = { ...patch };
      if ('estimateMinutes' in p) { p.len = p.estimateMinutes; delete p.estimateMinutes; }
      return demoSet(id, p);
    }
    return updateTask(id, patch);
  },
  add(f) {
    if (!REAL) {
      const t = dataAddTask({ title: f.title, area: f.area, project: f.project, goal: f.goal, due: f.date ?? f.due, at: f.at, len: f.len });
      if (t) Object.assign(t, { date: f.date ?? f.due ?? null, at: f.at ?? null, aspect: f.aspect ?? t.aspect, person: f.person, list: f.date || f.due ? demoList(f.date ?? f.due) : 'inbox', parent: f.parent ?? undefined });
      fire();
      return t;
    }
    return dataAddTask(f);
  },
  /** Move or re-tag a calendar block. start/end in minutes on date. Days beyond the loaded week go by the outbox. */
  moveEvent(id, date, { start, end, area: a } = {}) {
    if (!REAL) {
      const e = EVENTS.find((x) => x.id === id) ?? demoEvent(id);
      if (!e) return;
      if (start != null) e.start = start; if (end != null) e.end = end; if (a !== undefined) { e.area = a; }
      fire(); return;
    }
    // ISO times: a block that crosses midnight sits in two days, so minutes are only meaningful against `date`
    const iso = start != null && end != null ? { start: clock.toIso(date, start), end: clock.toIso(date, end) } : {};
    if (dataMoveEvent(id, { ...iso, area: a })) return;
    // a day the bootstrap doesn't carry: the override goes straight to the PC (queued), the cached day shows it now
    const e = fetchedEvent(id); if (!e) return;
    const body = {};
    if (iso.start) Object.assign(body, iso);
    if (a !== undefined) body.area = a;
    patchFetched(id, { ...(body.start ? { startIso: body.start, endIso: body.end } : {}), ...('area' in body ? { area: body.area } : {}) });
    send('PATCH', `/events/${encodeURIComponent(id)}`, body, { key: `ev:${id}` });
    changed('event');
  },
};
/** Every loaded event (and far-off one) with this title gets the area; the PC learns it as a rule for future weeks. */
export function tagTitle(title, slug, { only = null } = {}) {
  const key = shortTitle(title);
  const touched = [];
  const days = [TODAY, ...Array.from({ length: 6 }, (_, i) => addDays(TODAY, i + 1))];
  for (const iso of days) for (const e of allOn(iso) ?? []) {
    if (e.sleep) continue;
    if (only ? e.id === only : shortTitle(e.full ?? e.title) === key) { if (!touched.some((x) => x.id === e.id)) touched.push({ id: e.id, date: iso, was: e.area ?? null }); }
  }
  for (const x of touched) W.moveEvent(x.id, x.date, { area: slug });
  // the rule (every block with this name, next week too) can't be taken back on the PC, so it waits out the Undo
  const ruleKey = `rule:${key}`;
  if (REAL && slug && !only) send('POST', `/areas/${encodeURIComponent(slug)}/rules`, { title: key }, { key: ruleKey, delay: 4500 });
  return () => { if (REAL) cancel(ruleKey); for (const x of touched) W.moveEvent(x.id, x.date, { area: x.was }); };
}
/** Blocks this week without an area, grouped by title: [{ key, count, min, ids }] (largest first). */
export function untagged() {
  const map = new Map();
  for (let i = 0; i < 7; i++) {
    const iso = addDays(TODAY, i);
    for (const b of blocksOn(iso)) {
      if (b.kind !== 'event' || b.area || !b.editable) continue;
      const key = shortTitle(b.full ?? b.title);
      const g = map.get(key) ?? { key, count: 0, min: 0, ids: [] };
      g.count++; g.min += b.end - b.start; g.ids.push(b.id);
      map.set(key, g);
    }
  }
  return [...map.values()].sort((a, b) => b.min - a.min);
}
export const isMember = () => REAL && USER && !USER.owner;
export { PROJECTS, GOALS, JOBS, TASKS, EVENTS, NOW, REAL, DEMO_MODE, lenOf, nightOf, morningOf, windowOf, known, eventsOn, allOn, shortTitle };

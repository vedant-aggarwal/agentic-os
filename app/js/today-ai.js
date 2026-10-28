// What Home asks the PC's AI (server/proposals.ts, server/ai.ts on his subscription, owner only) and the same rules on
// the phone when the PC can't: Plan my day, reading a typed line into tasks, Ask (a sentence becomes changes or an
// answer), sorting the inbox, and areas for untagged blocks. The AI only ever proposes; Home applies what he keeps
// through the normal sync, and tells the PC what was kept or removed (ai_batches) so the next plan learns.
import { api, connection } from './svc/api.js';
import { USER, boot } from './data.js';
import { send, lenOf, snapUp } from './today-data.js';
import { TODAY, REAL, NOW, TASKS, addDays, task, isOpen, isTimed, withAgent, dateOf, endOf, blocksOn, restOfToday, wake, slotFor, goal, snapOf, W } from './today-state.js';

export const aiOn = () => REAL && !!USER?.owner && boot()?.ai !== false;
export const online = () => connection().status !== 'offline';
export const canAI = () => aiOn() && online();
const post = (path, body, timeout) => api(path, { method: 'POST', body: JSON.stringify(body ?? {}), timeout });
/** Tell the PC which proposals he kept (queued: works offline, sent once). */
export function decide(batchId, { kept = [], removed = [], closeRest = false } = {}) {
  if (!REAL || !batchId || (!kept.length && !removed.length && !closeRest)) return;
  send('POST', `/ai/batches/${batchId}/decide`, { kept, removed, ...(closeRest ? { closeRest: true } : {}) });
}

// ── Plan my day ──────────────────────────────────────────────────────
// A ghost: { id (task id, or new-<n>), task?, newTask?: { title, area }, pid, date, s, e, why, on }
const FLEX = /hustle|side project|deep work|buffer|free time|strategy/i;
const rank = (t) => {
  const d = dateOf(t), late = d && d < TODAY ? Math.round((Date.parse(TODAY) - Date.parse(d)) / 864e5) : 0;
  return (late ? -late / 100 : d === TODAY ? 1 : d === addDays(TODAY, 1) ? 2 : t.goal ? 3 : d ? 4 : 5) + (t.priority ?? 2) / 10;
};
const whyOf = (t) => {
  const d = dateOf(t), late = d && d < TODAY ? Math.round((Date.parse(TODAY) - Date.parse(d)) / 864e5) : 0;
  if (late) return late === 1 ? '1 day late' : `${late} days late`;
  if (d === TODAY) return 'Due today';
  if (d === addDays(TODAY, 1)) return 'Due tomorrow';
  const g = t.goal ? goal(t.goal) : null;
  if (g) return g.verdict === 'Behind pace' ? 'Feeds a goal behind pace' : 'Feeds a goal';
  return 'Fits here';
};
/** Tasks a plan can place: open, no time yet, not with an agent, not in the inbox (he sorts those first). */
export const planPool = () => TASKS.filter((t) => isOpen(t) && !isTimed(t) && !withAgent(t) && t.list !== 'inbox' && t.list !== 'doing');
/** Free stretches today from now (and the container blocks set aside for work), for the planner. */
function slotsToday() {
  const out = restOfToday().filter((x) => x.gap && !x.sleep).map((g) => ({ s: snapUp(g.start), e: g.end, where: null }));
  for (const b of blocksOn(TODAY)) if (b.kind === 'event' && FLEX.test(b.title) && b.end > NOW) out.push({ s: snapUp(Math.max(b.start, NOW)), e: b.end, where: b.title.replace(/\s*\(.*$/, '').split(' & ')[0] });
  return out.filter((x) => x.e - x.s >= 15).sort((a, b) => a.s - b.s);
}
/** The same rules as the PC's fallback, worked out on the phone: late first, due, goals; nothing after bedtime. */
export function localPlan() {
  const slots = slotsToday();
  const pool = planPool().sort((a, b) => rank(a) - rank(b));
  const ghosts = [], skipped = [];
  const tmr = addDays(TODAY, 1);
  let tmrFrom = null;
  for (const t of pool) {
    const d = Math.min(Math.max(lenOf(t), 15), 240);
    const sl = slots.find((x) => x.e - x.s >= d);
    if (sl) {
      ghosts.push({ id: t.id, task: t.id, date: TODAY, s: sl.s, e: sl.s + d, why: sl.where ? `${whyOf(t)} · in ${sl.where}` : whyOf(t), on: true });
      sl.s += d;
    } else if (rank(t) < 2.5) {
      // late or due by tomorrow and nothing fits today: the first room tomorrow morning
      const at = slotFor(tmr, d, tmrFrom ?? Math.max(wake(tmr), 9 * 60));
      if (at != null) { ghosts.push({ id: t.id, task: t.id, date: tmr, s: at, e: at + d, why: whyOf(t), on: true }); tmrFrom = at + d; } else skipped.push(t.id);
    }
    if (ghosts.length >= 8) break;
  }
  return { ghosts, skipped, batchId: null, summary: '', model: 'Planner', ms: 0, source: 'phone' };
}
/** The PC's plan checked against the phone now: tasks still open and without a time, times still ahead and free. */
export function fromServerPlan(p) {
  if (!p || p.date !== TODAY) return null;
  const nowQ = snapUp(NOW);
  const clash = (date, s, e) => blocksOn(date).some((b) => b.start < e && b.end > s && !(b.kind === 'event' && FLEX.test(b.title)));
  const ghosts = [];
  for (const g of p.ghosts ?? []) {
    if ((g.date === TODAY && g.s < nowQ) || g.date < TODAY || clash(g.date, g.s, g.e)) continue;
    if (g.taskId) {
      const t = task(g.taskId);
      if (!t || !isOpen(t) || isTimed(t) || withAgent(t)) continue;
      ghosts.push({ id: t.id, task: t.id, pid: g.pid, date: g.date, s: g.s, e: g.e, why: g.why, on: true });
    } else if (g.newTask?.title) ghosts.push({ id: `new-${g.pid ?? ghosts.length}`, pid: g.pid, newTask: g.newTask, date: g.date, s: g.s, e: g.e, why: g.why, on: true });
  }
  if (!ghosts.length) return null;
  const skipped = (p.skipped ?? []).filter((id) => { const t = task(id); return t && isOpen(t) && !isTimed(t); });
  return { ghosts, skipped, batchId: p.batchId ?? null, summary: p.summary ?? '', model: p.model ?? 'Sonnet', ms: p.ms ?? 0, fallback: !!p.fallback, source: 'pc', made: p.createdAt ?? null };
}
/** The plan made this morning (07:00) or on the last tap, if it still holds. */
export const readyPlan = () => (REAL ? fromServerPlan(boot()?.aiPlan) : null);
/** Ask the PC for a fresh plan (Sonnet, ~10–60 s); null when it can't (offline, member, an error). */
export async function freshPlan() {
  if (!canAI()) return null;
  try { return fromServerPlan(await post('/ai/plan', {}, 90000)); } catch (e) { console.info('[today] plan from the PC failed:', e?.message); return null; }
}
/** Keep the chosen ghosts: tasks get their times (new ones are made), the PC hears what was kept. Returns undo. */
export function applyPlan(plan) {
  const kept = plan.ghosts.filter((g) => g.on);
  const snaps = [], made = [];
  for (const g of kept) {
    if (g.newTask) { const t = W.add({ title: g.newTask.title, area: g.newTask.area ?? null, date: g.date, at: g.s, len: g.e - g.s }); if (t) made.push(t.id); continue; }
    const t = task(g.task); if (!t) continue;
    snaps.push([t.id, snapOf(t.id)]);
    W.place(t.id, g.date, g.s, g.e - g.s);
  }
  decide(plan.batchId, { kept: kept.map((g) => g.pid).filter(Boolean), removed: plan.ghosts.filter((g) => !g.on).map((g) => g.pid).filter(Boolean) });
  return () => { for (const [id, s] of snaps) W.restore(id, s); for (const id of made) W.drop(id); };
}

// ── tomorrow's first three (the evening draft and the shut-down) ───────
/** The three that should open tomorrow: late first, then due tomorrow, then goals behind pace, then priority. */
export function firstThree() {
  const tmr = addDays(TODAY, 1);
  const pool = TASKS.filter((t) => isOpen(t) && !withAgent(t) && t.list !== 'inbox' && (!isTimed(t) || dateOf(t) < TODAY || (dateOf(t) === TODAY && endOf(t) <= NOW)));
  const score = (t) => { const d = dateOf(t); return (d && d < TODAY ? 0 : d === TODAY ? 0.5 : d === tmr ? 1 : t.goal && goal(t.goal)?.verdict === 'Behind pace' ? 2 : t.goal ? 2.5 : 3) + (t.priority ?? 2) / 10; };
  return pool.sort((a, b) => score(a) - score(b)).slice(0, 3);
}
/** Morning slots for a list of tasks tomorrow, one after another from the first free time. */
export function morningSlots(ids, date = addDays(TODAY, 1)) {
  let from = wake(date) + 15;
  const out = new Map();
  for (const id of ids) {
    const t = task(id); if (!t) continue;
    const len = Math.min(lenOf(t), 180);
    const at = slotFor(date, len, from);
    if (at == null) continue;
    out.set(id, { at, len });
    from = at + len;
  }
  return out;
}

// ── reading a line into tasks (Hinglish welcome) ───────────────────────
// POST /ai/parse { text } → { batchId, tasks: [{ title, area, date, time, minutes, goal, pid }], model, ms }
export async function readLine(text) {
  const r = await post('/ai/parse', { text }, 60000);
  return { batchId: r.batchId ?? null, model: r.model ?? 'Haiku', ms: r.ms ?? 0, rows: (r.tasks ?? []).map((x) => ({ kind: 'add', pid: x.pid ?? null, on: true, task: { title: x.title, area: x.area ?? null, goal: x.goal ?? null, date: x.date ?? null, at: x.time ? Number(x.time.slice(0, 2)) * 60 + Number(x.time.slice(3, 5)) : null, len: x.minutes ?? null } })) };
}
// ── Ask: a sentence becomes proposed changes, or an answer ──────────────
// POST /ai/ask { text } → { kind: 'changes'|'answer', say, taskRefs, changes: [{ op, taskId, patch } | { op: 'add', task }], skipped }
export async function ask(text) {
  const r = await post('/ai/ask', { text }, 100000);
  const rows = [];
  for (const c of r.changes ?? []) {
    if (c.op === 'add') { const t = c.task ?? {}; const d = t.scheduled ? t.scheduled.start : null; rows.push({ kind: 'add', on: true, task: { title: t.title, area: t.area ?? null, date: t.due ?? null, scheduled: t.scheduled ?? null, len: t.estimateMinutes ?? null }, at: d }); continue; }
    const t = task(c.taskId); if (!t) continue;
    rows.push({ kind: c.op === 'give' ? 'agent' : c.op, id: t.id, on: true, patch: c.patch ?? {} });
  }
  for (const s of r.skipped ?? []) rows.push({ kind: 'miss', title: String(s), on: false });
  return { kind: r.kind === 'answer' || !rows.length ? 'answer' : 'changes', say: r.say ?? '', refs: (r.taskRefs ?? []).filter((id) => task(id)), rows, model: r.model ?? 'Haiku', ms: r.ms ?? 0 };
}
// ── the inbox, sorted ───────────────────────────────────────────────
// POST /ai/triage → { batchId, items: [{ taskId, area, due, minutes, goal, why, pid }] }
export async function triage() {
  const r = await post('/ai/triage', {}, 80000);
  return { batchId: r.batchId ?? null, items: Object.fromEntries((r.items ?? []).filter((x) => task(x.taskId)).map((x) => [x.taskId, x])), model: r.model ?? 'Haiku' };
}
// ── areas for untagged block names ─────────────────────────────────────
// POST /ai/tag { titles } → { batchId, items: [{ title, area, why, pid }] }
export async function tag(titles) {
  const r = await post('/ai/tag', { titles }, 60000);
  return { batchId: r.batchId ?? null, items: Object.fromEntries((r.items ?? []).map((x) => [x.title, x])) };
}

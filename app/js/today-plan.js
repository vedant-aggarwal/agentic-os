// The rituals and the placing sheets. Plan: the agent proposes where each task goes (the rest of today, tomorrow
// morning, an agent overnight) and he keeps each line or not; the PC's plan (made at 07:00 or on the tap, Sonnet on his
// subscription) when it has one, the same rules worked out on the phone when it can't. Shut down: an honest look at
// the day, a home for what is still open, tomorrow's first three, the journal, and the day closes. Plus: give one task
// a time, fill one free slot, and the tasks carried over.
import { $, $$, esc, on, openSheet, closeSheet, toast, haptic, seg, wireSegs, ring, setRing, pulse } from './core.js';
import { I } from './icons.js';
import { AGENT, GOALS, USER } from './data.js';
import { api, has } from './bus.js';
import { summary } from './aspects.js';
import { stagger, roll, rollHTML, symbol } from './motion.js';
import { ls } from './svc/api.js';
import { lenOf, rel, weekStart } from './today-data.js';
import { S, NOW, TODAY, REAL, DEMO_MODE, task, changed, hm, dur, plural, day, addDays, gapsToday, unplanned, fit, leftToday, earlierToday, blocksOn, aspectName, isOpen, isDone, isTimed, atOf, endOf, dateOf, doneToday, goal, W, snapOf, slotFor, freeOn, eventsOn, known, wake, withAgent } from './today-state.js';
import { place, toTomorrow, drop } from './today-tasks.js';
import { canAI, aiOn, readyPlan, freshPlan, localPlan, applyPlan, decide, firstThree, morningSlots, planPool } from './today-ai.js';

const dot = (id) => (id ? `<i class="dot" style="--c:var(--${id})"></i>` : '');
const orbLine = (text) => `<div class="td-pl-say"><span class="orb sm" aria-hidden="true"></span><p>${text}</p></div>`;
const tog = (isOn, label) => `<button class="check td-pl-tog ${isOn ? 'done' : ''}" data-act="td-pl-tog" aria-pressed="${isOn}" aria-label="${esc(label)}">${I.check}</button>`;
// an agent can take work that lives in a repo or a client project; not a message, a shoot or the shop floor
const agentable = (t) => !!t.project || t.area === 'projects' || /\b(merge|build|code|website|app|invoice|quote|draft|research|fix|bug)\b/i.test(t.title);
const PLANNED_KEY = 'aos-today:planned', CLOSED_KEY = 'aos-today:closed';
export const plannedToday = () => ls.get(PLANNED_KEY)?.startsWith(TODAY) ? JSON.parse(ls.get(PLANNED_KEY).slice(11) || '{}') : null;
const closedDays = () => { try { return JSON.parse(ls.get(CLOSED_KEY) ?? '[]'); } catch { return []; } };
export const closedToday = () => closedDays().includes(TODAY);
const closeStreak = () => { const set = new Set(closedDays()); let n = 0; for (let d = set.has(TODAY) ? TODAY : addDays(TODAY, -1); set.has(d); d = addDays(d, -1)) n++; return n; };

// ── Plan: the agent's proposal, his approval ──────────────────────────
export function openPlan(kind = 'rest') {
  const st = { kind: kind === 'tomorrow' ? 'tomorrow' : 'rest', off: new Set(), plan: null, state: 'idle', hand: null, handOn: true };
  const el = openSheet({
    large: true, cls: 'td-pl-sheet',
    head: `<div class="sheet-head"><div class="sh-text"><h3>Plan with ${esc(AGENT.name)}</h3><p>She proposes, you keep what you like</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>
      <div class="pad td-pl-seg">${seg('td-pl-kind', [['rest', 'Rest of today'], ['tomorrow', 'Tomorrow']], st.kind)}</div>`,
    body: '<div class="td-pl-body"></div>',
    foot: '<div class="td-pl-foot"><button class="btn primary block" style="--c:var(--today-fill)" data-act="td-pl-go"></button></div>',
    onClose: () => { S.plan = null; if (st.plan?.batchId && st.state === 'ready' && !st.kept) { /* untouched: the plan stays open on the PC for later */ } },
  });
  el._pl = st;
  wireSegs(el);
  $('[data-seg="td-pl-kind"]', el).addEventListener('change', (e) => { st.kind = e.detail; st.off.clear(); drawPlan(el, true); });
  loadPlan(el);
  return el;
}
async function loadPlan(el, { fresh = false } = {}) {
  const st = el._pl;
  const ready = !fresh ? readyPlan() : null;
  if (ready) { st.plan = ready; st.state = 'ready'; drawPlan(el, true); return; }
  if (canAI() && (fresh || !DEMO_MODE)) {
    st.state = 'thinking'; st.plan = null; drawPlan(el, true);
    const p = await freshPlan();
    if (!el.isConnected) return;
    st.plan = p ?? localPlan(); st.state = 'ready';
    if (!p) st.fellBack = true;
    drawPlan(el, true); haptic('success');
    return;
  }
  st.plan = localPlan(); st.state = 'ready'; drawPlan(el, true);
}
const restGhosts = (st) => (st.plan?.ghosts ?? []);
function handPick(st) {
  // one task an agent could do overnight: the longest open one that fits no slot and lives in a project
  if (!REAL || !USER?.owner) return null;
  const placed = new Set(restGhosts(st).map((g) => g.task).filter(Boolean));
  const c = planPool().filter((t) => !placed.has(t.id) && agentable(t) && !withAgent(t)).sort((a, b) => lenOf(b) - lenOf(a))[0];
  return c ?? null;
}
function drawPlan(el, enter = false) {
  const st = el._pl, body = $('.td-pl-body', el), go = $('[data-act="td-pl-go"]', el);
  if (st.kind === 'rest') {
    if (st.state === 'thinking') {
      body.innerHTML = `${orbLine(`${esc(AGENT.name)} is reading your day: what is late, what is due, where the free time is.`)}
        <div class="td-pl-think" role="status"><span class="spin" aria-hidden="true"></span><span class="td-shimmer">Planning on your PC, about 10 seconds</span></div>
        <div class="group td-pl-skel">${[0, 1, 2].map(() => '<div class="row td-pl-row skel"><i></i><span class="rbody"><b></b><small></small></span></div>').join('')}</div>
        <p class="hint td-pl-quick"><button class="td-link" data-act="td-pl-quick">Use the quick plan instead</button></p>`;
      go.textContent = 'Planning…'; go.disabled = true;
      return;
    }
    const plan = st.plan; const ghosts = restGhosts(st);
    const f = fit();
    st.hand = st.hand === null ? handPick(st) : st.hand;
    const kept = ghosts.filter((g) => !st.off.has(g.id));
    // what the kept rows take from free time (a task set inside a block kept for that work takes none)
    const inside = (g) => blocksOn(TODAY).some((b) => b.kind === 'event' && b.start < g.e && b.end > g.s);
    const keptToday = kept.filter((g) => g.date === TODAY && !inside(g)).reduce((a, g) => a + g.e - g.s, 0);
    const row = (g) => {
      const t = g.task ? task(g.task) : null; const isOn = !st.off.has(g.id);
      const title = g.newTask ? g.newTask.title : t?.title ?? '';
      return `<div class="row td-pl-row${isOn ? '' : ' off'}" data-g="${esc(g.id)}">${tog(isOn, `Keep: ${title}`)}
        <span class="td-pl-when"><b class="num">${hm(g.s)}</b></span>
        <span class="rbody"><span class="rtitle wrap">${g.newTask ? '<span class="td-pl-new">New</span>' : ''}${esc(title)}</span><span class="rmeta"><span class="td-pl-why">${esc(g.why ?? '')}</span></span></span>
        <span class="td-pl-len num">${dur(g.e - g.s)}</span></div>`;
    };
    const today = ghosts.filter((g) => g.date === TODAY), tmr = ghosts.filter((g) => g.date !== TODAY);
    const grp = (title, list, sub = '') => (list.length ? `<div class="sh td-pl-sh"><h2>${title}</h2>${sub ? `<span class="sh-count">${sub}</span>` : ''}</div><div class="group">${list.map(row).join('')}</div>` : '');
    const skipped = (plan?.skipped ?? []).map(task).filter(Boolean);
    const intro = plan?.summary ? esc(plan.summary)
      : !ghosts.length ? (f.count ? 'Nothing left fits the time you have today. Move what is late to tomorrow, or give one to an agent.' : 'Everything left has a time. Nothing to plan.')
      : `${plural(today.length, 'thing')} fit${today.length === 1 ? 's' : ''} the rest of today${tmr.length ? `; ${tmr.length} go${tmr.length === 1 ? 'es' : ''} to tomorrow morning` : ''}. Late first, then what is due, then your goals.`;
    const source = plan?.source === 'pc' ? `${esc(plan.model ?? 'Sonnet')} on your PC${plan.made ? ` · made ${hm(Math.round((Date.parse(plan.made) - Date.parse(`${TODAY}T00:00:00+05:30`)) / 60000))}` : ''}` : st.fellBack ? 'Your PC didn’t answer, so this is the quick plan: late, due, goals' : aiOn() && !canAI() ? 'Offline: the quick plan, worked out on this phone' : 'Worked out on this phone';
    const wg = GOALS.find((g) => g.horizon === 'week' && g.status !== 'done' && g.verdict === 'Behind pace');
    const h = st.hand;
    body.innerHTML = `
      ${ghosts.length || f.count ? `<div class="td-pl-fit surface" aria-label="Before and after">
        <div class="td-pl-fit-r"><span class="td-pl-fit-l">Now</span>${fitBar(f.free, f.need)}<span class="td-pl-fit-v num"><b class="${f.over > 0 ? 'late' : ''}">${dur(f.need)}</b> for ${dur(f.free)}</span></div>
        <div class="td-pl-fit-r"><span class="td-pl-fit-l">After</span>${fitBar(f.free, keptToday, true)}<span class="td-pl-fit-v num"><b>${dur(keptToday)}</b> for ${dur(f.free)}</span></div>
      </div>` : ''}
      ${orbLine(intro)}
      ${grp('Rest of today', today, 'in free time')}
      ${grp('Tomorrow morning', tmr, "what didn't fit")}
      ${h ? `<div class="sh td-pl-sh"><h2>Overnight</h2><span class="sh-count">while you sleep</span></div><div class="group"><div class="row td-pl-row${st.handOn ? '' : ' off'}" data-hand="${h.id}">${tog(st.handOn, `Hand to an agent: ${h.title}`)}<span class="td-pl-when"><span class="agent sm codex">${I.codex}</span></span><span class="rbody"><span class="rtitle wrap">${esc(h.title)}</span><span class="rmeta"><span class="td-pl-why">${dur(lenOf(h))} of work with no slot today. Codex can take it tonight; you review in the morning.</span></span></span></div></div>` : ''}
      ${skipped.length ? `<p class="hint td-pl-skip">${esc(plural(skipped.length, 'task'))} still don’t fit: ${esc(skipped.slice(0, 3).map((t) => t.title.split(':')[0]).join(', '))}${skipped.length > 3 ? '…' : ''}.</p>` : ''}
      ${wg ? `<p class="hint td-pl-wg">${I.flag}<span>Week goal behind pace: ${esc(wg.title.length > 60 ? `${wg.title.slice(0, 58)}…` : wg.title)}</span></p>` : ''}
      <p class="foot td-pl-src">${source}${canAI() && plan?.source !== 'pc' ? ` · <button class="td-link" data-act="td-pl-ask">Ask ${esc(AGENT.name)} to plan it</button>` : plan?.source === 'pc' && canAI() ? ` · <button class="td-link" data-act="td-pl-ask">Plan again</button>` : ''}</p>`;
    const n = kept.length + (h && st.handOn ? 1 : 0);
    go.textContent = n ? `Keep ${n} of ${ghosts.length + (h ? 1 : 0)}` : ghosts.length ? 'Keep nothing' : 'Close';
    go.disabled = false;
    if (enter) { stagger($$('.td-pl-row', body), { y: 10, each: 45, max: 360 }); requestAnimationFrame(() => $$('.td-pl-bar i', body).forEach((b) => b.classList.add('go'))); }
    else $$('.td-pl-bar i', body).forEach((b) => b.classList.add('go'));
    return;
  }
  // tomorrow: what is on the calendar, and the three to start with
  const iso = addDays(TODAY, 1);
  const evs = known(iso) ? eventsOn(iso) : [];
  const first = firstThree();
  const free = freeOn(iso);
  const late = first.filter((t) => dateOf(t) && dateOf(t) < TODAY).length;
  body.innerHTML = `${orbLine(`${esc(day(iso).wdLong)} has ${known(iso) ? `${dur(evs.reduce((a, e) => a + e.end - e.start, 0))} of events and ${dur(free ?? 0)} free` : 'its calendar on the way'}. ${first.length ? `Here is the start I would make${late ? `: ${late === 1 ? 'the late one' : 'the late ones'} first` : ''}.` : 'Nothing is waiting for it yet.'}`)}
    <div class="sh td-pl-sh"><h2>${esc(day(iso).wdLong)} so far</h2>${free != null ? `<span class="sh-count num">${dur(free)} free</span>` : ''}</div>
    <div class="group td-pl-tmr">${evs.length ? evs.map((e) => `<div class="row"><span class="td-pl-when"><b class="num">${hm(e.start)}</b></span><span class="td-pl-rail" style="--c:${e.aspect ? `var(--${e.aspect})` : 'var(--ink-3)'}"></span><span class="rbody"><span class="rtitle">${esc(e.title)}</span><span class="rmeta">${dot(e.aspect)}${esc(e.aspect ? aspectName(e.aspect) : 'No area')} · ${dur(e.end - e.start)}</span></span></div>`).join('') : '<div class="row"><span class="rbody"><span class="rmeta">Nothing on the calendar yet.</span></span></div>'}</div>
    ${first.length ? `<div class="sh td-pl-sh"><h2>Start with these</h2></div>
    <div class="group">${first.map((t, i) => { const isOn = !st.off.has(t.id); return `<div class="row td-pl-row${isOn ? '' : ' off'}" data-g="${t.id}">${tog(isOn, `Keep: ${t.title}`)}<span class="td-pl-when"><b class="met td-pl-n">${i + 1}</b></span><span class="rbody"><span class="rtitle wrap">${esc(t.title)}</span><span class="rmeta">${dot(t.aspect)}${esc(t.aspect ? aspectName(t.aspect) : 'No aspect')} · ${dur(lenOf(t))}${t.late ? ` · <span class="late">${esc(t.late)}</span>` : ''}</span></span></div>`; }).join('')}</div>
    <p class="hint">Each gets the first free time after you wake. Change any of them later on the timeline.</p>` : ''}`;
  const n = first.filter((t) => !st.off.has(t.id)).length;
  go.textContent = n ? `Set ${day(iso).wdLong}'s first ${n === 1 ? 'task' : n}` : 'Close';
  go.disabled = false;
  if (enter) stagger($$('.td-pl-row, .td-pl-tmr .row', body), { y: 10, each: 40, max: 320 });
}
// two bars on one scale: what is free, and what the tasks need
const fitBar = (free, need, after = false) => {
  const max = Math.max(free, need, 1);
  return `<span class="td-pl-bar${after ? ' after' : ''}" aria-hidden="true"><i class="td-pl-bar-f" style="--w:${(free / max * 100).toFixed(1)}%"></i><i class="td-pl-bar-n${need > free ? ' over' : ''}" style="--w:${(Math.min(need, max) / max * 100).toFixed(1)}%"></i></span>`;
};
on('td-pl-tog', (el) => {
  const sh = el.closest('.sheet'), row = el.closest('[data-g], [data-hand], [data-task]');
  const st = sh._pl ?? sh._sd; if (!row || !st) return;
  if (row.dataset.hand) st.handOn = !st.handOn;
  else { const id = row.dataset.g ?? row.dataset.task; if (st.off.has(id)) st.off.delete(id); else st.off.add(id); }
  haptic('selection');
  if (sh._pl) drawPlan(sh); else drawShut(sh);
});
on('td-pl-quick', (el) => { const sh = el.closest('.sheet'); const st = sh._pl; st.plan = localPlan(); st.state = 'ready'; st.fellBack = false; drawPlan(sh, true); });
on('td-pl-ask', (el) => { const sh = el.closest('.sheet'); if (!canAI()) { toast('Planning with her needs your PC'); return; } sh._pl.off.clear(); loadPlan(sh, { fresh: true }); });
on('td-pl-go', (el) => {
  const sh = el.closest('.sheet'), st = sh._pl;
  if (st.kind === 'rest') {
    if (st.state !== 'ready') return;
    const plan = st.plan;
    if (!plan?.ghosts.length && !(st.hand && st.handOn)) { closeSheet(sh); return; }
    for (const g of plan.ghosts) g.on = !st.off.has(g.id);
    const undo = applyPlan(plan);
    st.kept = true;
    const n = plan.ghosts.filter((g) => g.on).length;
    const nToday = plan.ghosts.filter((g) => g.on && g.date === TODAY).length;
    if (n) ls.set(PLANNED_KEY, `${TODAY}:${JSON.stringify({ n, at: NOW, by: plan.source })}`);
    S.fresh = new Set(plan.ghosts.filter((g) => g.on).map((g) => g.task).filter(Boolean)); setTimeout(() => { S.fresh = null; }, 1600);
    closeSheet(sh); haptic('success');
    const hand = st.hand && st.handOn ? st.hand : null;
    toast([nToday && `${nToday} placed today`, n - nToday > 0 && `${n - nToday} for tomorrow`].filter(Boolean).join(', ') || (hand ? 'Handing it to Codex' : 'Nothing changed'), n ? undo : undefined);
    if (hand) setTimeout(() => api.handToAgent(hand.id, 'codex'), 420);
    return;
  }
  const first = firstThree().filter((t) => !st.off.has(t.id));
  if (!first.length) { closeSheet(sh); return; }
  const iso = addDays(TODAY, 1);
  const slots = morningSlots(first.map((t) => t.id), iso);
  const snaps = first.map((t) => [t.id, snapOf(t.id)]);
  for (const t of first) { const s = slots.get(t.id); W.place(t.id, iso, s?.at ?? null, s?.len ?? null); }
  closeSheet(sh); haptic('success');
  toast(`${day(iso).wdLong} starts with ${first[0].title.split(':')[0].slice(0, 30)}`, () => { for (const [id, s] of snaps) W.restore(id, s); });
});

// ── Shut down: the day, honestly; a home for what's open; tomorrow's three; the journal; close ──
export function openShutdown() {
  // what still has no slot today: late or due, not timed later tonight
  const open = leftToday().filter((t) => !(isTimed(t) && dateOf(t) === TODAY && atOf(t) >= NOW));
  const st = { pick: new Map(open.map((t) => [t.id, 'tomorrow'])), off: new Set() };
  const el = openSheet({
    large: true, cls: 'td-sd-sheet',
    head: `<div class="sheet-head"><div class="sh-text"><h3>Shut down the day</h3><p>${esc(day(TODAY).long)} · about 3 minutes</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: '<div class="td-sd-body"></div>',
    foot: `<div class="td-pl-foot${canReopen() ? ' two' : ''}">${canReopen() ? '<button class="btn" data-act="td-sd-reopen">Reopen the day</button>' : ''}<button class="btn primary block" style="--c:var(--today-fill)" data-act="td-sd-go">${closedToday() ? 'Close it again' : 'Close the day'}</button></div>`,
  });
  el._sd = st; el._open = open;
  drawShut(el, true);
  pulse(el, 260);
  return el;
}
function verdict(doneN, planned, open, first) {
  if (!planned) return 'A quiet day on the list. Tomorrow is where the next one starts.';
  if (!open.length) return doneN === planned ? `All ${planned} done. Close it and rest.` : 'Everything left today has a time.';
  const late = open.filter((t) => t.late).length;
  return `${doneN} of ${planned} done.${late ? ` ${plural(late, 'task')} ${late === 1 ? 'is' : 'are'} late, so I’d give ${late === 1 ? 'it' : 'them'} tomorrow morning.` : ''}${first ? ` Tomorrow starts with ${first.title.split(':')[0]}.` : ''}`;
}
function drawShut(el, enter = false) {
  const st = el._sd, open = el._open, body = $('.td-sd-body', el);
  const doneN = doneToday().length;
  const planned = doneN + leftToday().length;
  const all = blocksOn(TODAY);
  const kept = all.filter((b) => b.start <= NOW).length;
  // focus: the planned time behind him, as one set (a task inside a longer block counts once)
  const iv = all.map((b) => [b.start, b.end]).sort((a, b) => a[0] - b[0]);
  let total = 0, behind = 0, cs = 0, ce = -1;
  const add = (s, e) => { total += e - s; behind += Math.min(Math.max(NOW - s, 0), e - s); };
  for (const [s, e] of iv) { if (s > ce) { if (ce > cs) add(cs, ce); cs = s; ce = e; } else ce = Math.max(ce, e); }
  if (ce > cs) add(cs, ce);
  const firsts = firstThree().filter((t) => st.pick.get(t.id) !== 'drop');
  const choice = (id, v, label) => `<button class="chip sm ${st.pick.get(id) === v ? 'on' : ''}" data-act="td-sd-pick" data-id="${id}" data-v="${v}">${label}</button>`;
  const g = summary('growth');
  const jStreak = g?.streak?.n > 0 && !g.mock ? g.streak : null;
  const streak = closeStreak();
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart(TODAY), i));
  const closed = new Set(closedDays());
  body.innerHTML = `
    <section class="td-sd-today surface" aria-label="Today, honestly">
      <div class="td-sd-rings">
        <div class="td-sd-r">${ring(doneN / Math.max(1, planned), 'jobs', 64, 7, { id: 'sdR1', inner: `<b class="met">${rollHTML(doneN)}<small>/${planned}</small></b>`, label: `${doneN} of ${planned} tasks done` })}<span>Tasks done</span></div>
        <div class="td-sd-r">${ring(kept / Math.max(1, all.length), 'today', 64, 7, { delay: 80, inner: `<b class="met">${kept}<small>/${all.length}</small></b>`, label: `${kept} of ${all.length} blocks so far` })}<span>Blocks so far</span></div>
        <div class="td-sd-r">${ring(behind / Math.max(1, total), 'mission', 64, 7, { delay: 160, inner: `<b class="met">${hm(behind).replace(/^0/, '')}</b>`, label: `${dur(behind)} of ${dur(total)} planned time behind you` })}<span>Planned time</span></div>
      </div>
      ${orbLine(esc(verdict(doneN, planned, open, firsts[0])))}
    </section>
    ${open.length ? `<div class="sh td-pl-sh"><h2>Still without a slot</h2><span class="sh-count">${open.length}</span></div>` : '<p class="hint td-sd-none">Everything left today has a time.</p>'}
    <div class="group td-sd-open"${open.length ? '' : ' hidden'}>${open.map((t) => `<div class="row td-sd-row"><span class="rbody"><span class="rtitle">${esc(t.title)}</span><span class="rmeta">${dot(t.aspect)}${esc(t.aspect ? aspectName(t.aspect) : 'No aspect')} · ${dur(lenOf(t))}${t.late ? ` · <span class="late">${esc(t.late)}</span>` : ''}</span>
      <span class="td-sd-ch">${choice(t.id, 'tomorrow', 'Tomorrow')}${choice(t.id, 'later', 'Next week')}${choice(t.id, 'drop', 'Drop')}</span></span></div>`).join('')}</div>
    ${firsts.length ? `<div class="sh td-pl-sh"><h2>Tomorrow starts with</h2></div>
    <div class="group">${firsts.map((t, i) => { const isOn = !st.off.has(t.id); return `<div class="row td-pl-row${isOn ? '' : ' off'}" data-task="${t.id}">${tog(isOn, `Start with: ${t.title}`)}<span class="td-pl-when"><b class="met td-pl-n">${i + 1}</b></span><span class="rbody"><span class="rtitle wrap">${esc(t.title)}</span><span class="rmeta">${dot(t.aspect)}${esc(t.aspect ? aspectName(t.aspect) : 'No aspect')} · ${dur(lenOf(t))}</span></span></div>`; }).join('')}</div>` : ''}
    ${has('writeJournal') ? `<div class="sh td-pl-sh"><h2>The journal</h2>${jStreak ? `<span class="sh-count${jStreak.atRisk ? ' late' : ''}">${esc(`${jStreak.n}-day streak`)}</span>` : ''}</div>
    <div class="group"><button class="row ic td-sd-jr" data-act="td-sd-journal"><span class="tile asp-tile" data-aspect="growth">${jStreak?.atRisk ? I.flame : I.edit}</span><span class="rbody"><span class="rtitle">${jStreak?.atRisk ? 'Two lines save the streak' : 'Two lines about today'}</span><span class="rmeta">What went well, what didn't. Growth keeps it.</span></span>${I.chevR}</button></div>` : ''}
    <div class="td-sd-streak" aria-label="${streak} days in a row closed">
      <div class="td-sd-week">${week.map((d) => `<span class="td-sd-wd ${closed.has(d) ? 'on' : d === TODAY ? 'tonight' : ''}"><i>${closed.has(d) ? I.check : ''}</i>${day(d).wd[0]}</span>`).join('')}</div>
      <p class="foot">${streak ? `<b>${plural(streak, 'day')} in a row</b> closed on this phone.${closedToday() ? '' : ` Close tonight for ${streak + 1}.`}` : 'Close the day to start a streak.'}</p>
    </div>`;
  if (enter) stagger($$('.td-sd-body > *', el), { y: 10, each: 40, max: 360 });
}
on('td-sd-pick', (el) => { const sh = el.closest('.sheet'); sh._sd.pick.set(el.dataset.id, el.dataset.v); haptic('selection'); $$(`.chip[data-id="${el.dataset.id}"]`, sh).forEach((c) => c.classList.toggle('on', c === el)); });
on('td-sd-journal', () => api.writeJournal({ prompt: 'What went well today, and what didn\'t?', from: 'shutdown' }));
on('td-sd-go', (el) => {
  const sh = el.closest('.sheet'), st = sh._sd;
  const snaps = [], dropped = [];
  const tmr = addDays(TODAY, 1);
  const firsts = firstThree().filter((t) => !st.off.has(t.id) && st.pick.get(t.id) !== 'drop' && st.pick.get(t.id) !== 'later');
  const slots = morningSlots(firsts.map((t) => t.id), tmr);
  for (const [id, v] of st.pick) {
    const t = task(id); if (!t || isDone(t)) continue;
    snaps.push([id, snapOf(id)]);
    if (v === 'tomorrow' && !slots.has(id)) W.place(id, tmr, null);
    if (v === 'later') W.place(id, addDays(weekStart(TODAY), 7), null);
    if (v === 'drop') dropped.push(W.drop(id));
  }
  for (const t of firsts) { if (!snaps.some(([x]) => x === t.id)) snaps.push([t.id, snapOf(t.id)]); const s = slots.get(t.id); W.place(t.id, tmr, s?.at ?? null, s?.len ?? null); }
  const was = closedDays();
  ls.set(CLOSED_KEY, JSON.stringify([...new Set([...was, TODAY])].slice(-60)));
  // what closing moved, kept for the rest of the day: the toast's Undo is short, Reopen in the sheet is not
  // (closing twice keeps the first close's before, so Reopen goes all the way back)
  const rec = new Map((reopenRec()?.snaps ?? []).map((x) => [x[0], x]));
  for (const [id, s] of snaps) rec.set(id, [id, rec.get(id)?.[1] ?? s, snapOf(id)]);
  ls.set(REOPEN_KEY, JSON.stringify({ day: TODAY, snaps: [...rec.values()] }));
  dropUndo.push(...dropped);
  // the signature: the three rings close together before the sheet goes
  $$('.td-sd-rings .rg', sh).forEach((r, i) => setTimeout(() => setRing(r, 1), i * 90));
  $$('.td-sd-wd.tonight i', sh).forEach((i) => { i.innerHTML = I.check; i.parentElement.classList.add('on'); symbol(i, 'pop'); });
  haptic('ring-close');
  setTimeout(() => {
    closeSheet(sh); changed('closed'); haptic('success');
    toast(`Day closed · ${plural(closeStreak(), 'day')} in a row`, () => reopenDay());
  }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900);
});
// Open the day again: every task closing moved goes back, unless he has moved it again since (that later choice stays)
const REOPEN_KEY = 'aos-today:reopen';
const dropUndo = [];   // the demo's drops (a demo task leaves the list, so only this session can bring it back)
// (the length is left out: the PC fills one in when it places a task, so after a reload it isn't a move of his)
const sigOf = (s) => (!s ? '' : s._demo ? [s._demo.list, s._demo.date, s._demo.at, s._demo.status].join('|')
  : [s.status, s.due ?? '', s.scheduled ? Date.parse(s.scheduled.start) : '', s.scheduled ? Date.parse(s.scheduled.end) : ''].join('|'));
const reopenRec = () => { try { const r = JSON.parse(ls.get(REOPEN_KEY) ?? 'null'); return r?.day === TODAY ? r : null; } catch { return null; } };
// JSON drops a demo snapshot's empty keys; put them back so restoring clears what closing set (a date, a time)
const DEMO_KEYS = ['list', 'when', 'date', 'at', 'len', 'status', 'late', 'doneToday'];
const revive = (s) => (s?._demo ? { _demo: Object.fromEntries(DEMO_KEYS.map((k) => [k, s._demo[k]])) } : s);
export const canReopen = () => closedToday() && !!reopenRec();
export function reopenDay() {
  const r = reopenRec();
  let back = 0, kept = 0;
  if (r) {
    for (const [id, before, after] of r.snaps ?? []) {
      const now = snapOf(id);
      if (!now) { if (after?.status === 'dropped' && REAL) { W.restore(id, before); back++; } continue; }
      if (after && sigOf(now) !== sigOf(after)) { kept++; continue; }
      W.restore(id, revive(before)); back++;
    }
    if (!REAL) dropUndo.forEach((u) => { u?.(); back++; });
  }
  dropUndo.length = 0;
  ls.del(REOPEN_KEY);
  ls.set(CLOSED_KEY, JSON.stringify(closedDays().filter((d) => d !== TODAY)));
  changed('closed');
  return { back, kept };
}
on('td-sd-reopen', (el) => {
  const { back, kept } = reopenDay();
  closeSheet(el.closest('.sheet')); haptic('success');
  toast(back ? `Day open again · ${plural(back, 'task')} back${kept ? `, ${kept} you moved since stay` : ''}` : 'Day open again');
});

// ── give one task a time ──────────────────────────────────────────────
export function openPlace(id) {
  const t = task(id); if (!t) return;
  const len = lenOf(t), gaps = gapsToday();
  const fits = gaps.filter((g) => g.end - g.start >= len);
  const iso = addDays(TODAY, 1);
  const tmrAt = slotFor(iso, len);
  openSheet({
    cls: 'td-pc-sheet',
    head: `<div class="sheet-head"><div class="sh-text"><h3>${esc(t.title)}</h3><p>${dot(t.aspect)}${esc(t.aspect ? aspectName(t.aspect) : 'No aspect')} · needs ${dur(len)}${t.late ? ` · <span class="late">${esc(t.late)}</span>` : ''}</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: `<div class="sh td-pl-sh"><h2>Free today</h2><span class="sh-count">${fits.length ? plural(fits.length, 'slot fits', 'slots fit') : 'nothing fits'}</span></div>
      <div class="group">${gaps.map((g) => { const ok = g.end - g.start >= len; return `<button class="row td-pc-row${ok ? '' : ' no'}" data-act="td-pc-at" data-id="${id}" data-at="${g.start}"${ok ? '' : ' aria-disabled="true"'}>
        <span class="td-pl-when"><b class="num">${hm(g.start)}</b></span><span class="rbody"><span class="rtitle">${dur(g.end - g.start)} free</span><span class="rmeta">${ok ? `${hm(g.start)}–${hm(g.start + len)}${g.end - g.start - len >= 5 ? ` · ${dur(g.end - g.start - len)} to spare` : ' · a snug fit'}` : `${dur(len - (g.end - g.start))} too short`}</span></span>${ok ? I.chevR : ''}</button>`; }).join('') || '<div class="row"><span class="rbody"><span class="rmeta">No free time left today.</span></span></div>'}</div>
      <div class="sh td-pl-sh"><h2>Or</h2></div>
      <div class="group">
        <button class="row ic" data-act="td-pc-tmr" data-id="${id}" data-at="${tmrAt ?? ''}"><span class="tile">${I.cal}</span><span class="rbody"><span class="rtitle">${esc(day(iso).wdLong)}${tmrAt != null ? ` at ${hm(tmrAt)}` : ''}</span><span class="rmeta">${tmrAt != null ? 'The first free slot that fits' : 'Due then, no time yet'}</span></span>${I.chevR}</button>
        ${(!REAL || USER?.owner) && agentable(t) ? `<button class="row ic" data-act="td-pc-hand" data-id="${id}"><span class="tile"><span class="agent sm codex">${I.codex}</span></span><span class="rbody"><span class="rtitle">Hand it to an agent</span><span class="rmeta">Codex or Claude works on it; you review the result</span></span>${I.chevR}</button>` : ''}
        <button class="row ic" data-act="td-pc-open" data-id="${id}"><span class="tile">${I.edit}</span><span class="rbody"><span class="rtitle">Details</span><span class="rmeta">Project, goal, area, length, notes</span></span>${I.chevR}</button>
      </div>`,
  });
}
on('td-pc-at', (el) => { if (el.getAttribute('aria-disabled')) { haptic('warning'); toast('Too short for this task'); return; } closeSheet(); place(el.dataset.id, Number(el.dataset.at)); });
on('td-pc-tmr', (el) => { closeSheet(); toTomorrow(el.dataset.id, el.dataset.at ? Number(el.dataset.at) : null); });
on('td-pc-hand', (el) => { const id = el.dataset.id; closeSheet(); setTimeout(() => api.handToAgent(id, 'codex'), 320); });
on('td-pc-open', (el) => { closeSheet(); setTimeout(() => api.openTask(el.dataset.id), 320); });

// ── fill one free slot: what fits first, what doesn't, add something new, or keep it free ──
export function openGap(start, end, { sleep = false } = {}) {
  const len = end - start; const u = unplanned();
  const all = [...u.late, ...u.today];
  const fits = all.filter((t) => lenOf(t) <= len), long = all.filter((t) => lenOf(t) > len);
  openSheet({
    cls: 'td-pc-sheet',
    head: `<div class="sheet-head"><div class="sh-text"><h3><span class="num">${hm(start)}–${hm(end)}</span></h3><p>${dur(len)} ${sleep ? 'of your night. Sleep moves around what goes here' : 'free. What goes here?'}</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: `<div class="group"><button class="row ic" data-act="td-gap-new" data-at="${start}" data-len="${Math.min(30, len)}"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">Add a task here</span><span class="rmeta num">${hm(start)}–${hm(start + Math.min(30, len))}</span></span>${I.chevR}</button></div>
      ${fits.length ? `<div class="sh td-pl-sh"><h2>Fits</h2><span class="sh-count">${fits.length}</span></div><div class="group">${fits.map((t) => `<button class="row td-pc-row" data-act="td-pc-at" data-id="${t.id}" data-at="${start}"><span class="td-pl-when"><b class="num">${dur(lenOf(t))}</b></span><span class="rbody"><span class="rtitle">${esc(t.title)}</span><span class="rmeta">${dot(t.aspect)}${esc(t.aspect ? aspectName(t.aspect) : 'No aspect')}${t.late ? ` · <span class="late">${esc(t.late)}</span>` : ''}</span></span>${I.chevR}</button>`).join('')}</div>` : all.length ? orbLine('Nothing left today fits this slot.') : ''}
      ${long.length ? `<div class="sh td-pl-sh"><h2>Too long for it</h2></div><div class="group">${long.map((t) => `<div class="row td-pc-row no"><span class="td-pl-when"><b class="num">${dur(lenOf(t))}</b></span><span class="rbody"><span class="rtitle">${esc(t.title)}</span><span class="rmeta">${dur(lenOf(t) - len)} more than this slot</span></span></div>`).join('')}</div>` : ''}
      <div class="pad td-pc-keep"><button class="btn block" data-act="td-gap-keep">Keep it free</button></div>`,
  });
}
on('td-gap-keep', () => { closeSheet(); });
on('td-gap-new', (el) => { closeSheet(); setTimeout(() => api.addTask({ date: TODAY, at: Number(el.dataset.at), len: Number(el.dataset.len) }), 320); });

// ── carried over: late, not lost. A day for each, or one move to tomorrow morning ──
export function openLate() {
  const late = unplanned().late;
  const tmr = addDays(TODAY, 1);
  openSheet({
    cls: 'td-pc-sheet',
    head: `<div class="sheet-head"><div class="sh-text"><h3>Carried over</h3><p>${plural(late.length, 'task')} from earlier days. Pick a day for each.</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: `${orbLine(`I'd put ${late.length === 1 ? 'it' : `all ${late.length}`} on ${esc(day(tmr).wdLong)} morning, the most overdue first. Or keep one for tonight.`)}
      <div class="pad"><button class="btn primary block" style="--c:var(--today-fill)" data-act="td-late-all">Move ${late.length === 1 ? 'it' : 'all'} to ${esc(day(tmr).wdLong)} morning</button></div>
      <div class="group td-lt-g">${late.map((t) => `<div class="row td-lt-row"><span class="rbody"><span class="rtitle">${esc(t.title)}</span><span class="rmeta">${dot(t.aspect)}${esc(t.aspect ? aspectName(t.aspect) : 'No aspect')} · ${dur(lenOf(t))} · <span class="late">${esc(t.late ?? 'late')}</span></span>
        <span class="td-sd-ch"><button class="chip sm" data-act="td-late-tonight" data-id="${t.id}">Tonight</button><button class="chip sm" data-act="td-late-one" data-id="${t.id}">${esc(day(tmr).wd)}</button><button class="chip sm" data-act="td-late-drop" data-id="${t.id}">Drop</button></span></span></div>`).join('')}</div>`,
  });
}
on('td-late-all', () => {
  const late = unplanned().late.sort((a, b) => String(dateOf(a) ?? '').localeCompare(String(dateOf(b) ?? '')));
  const tmr = addDays(TODAY, 1);
  const slots = morningSlots(late.map((t) => t.id), tmr);
  const snaps = late.map((t) => [t.id, snapOf(t.id)]);
  for (const t of late) { const s = slots.get(t.id); W.place(t.id, tmr, s?.at ?? null, s?.len ?? null); }
  closeSheet(); haptic('success');
  toast(`${plural(late.length, 'task')} on ${day(tmr).wdLong} morning`, () => { for (const [id, s] of snaps) W.restore(id, s); });
});
on('td-late-tonight', (el) => { closeSheet(); setTimeout(() => openPlace(el.dataset.id), 320); });
on('td-late-one', (el) => { closeSheet(); const t = task(el.dataset.id); const tmr = addDays(TODAY, 1); toTomorrow(el.dataset.id, t ? slotFor(tmr, lenOf(t)) : null); });
on('td-late-drop', (el) => { closeSheet(); drop(el.dataset.id); });

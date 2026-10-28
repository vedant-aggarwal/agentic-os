// Body · Train: the agent as personal trainer. Home, workout preview, the live workout, the finish summary, an exercise,
// goals and targets. Everything reads B (body-data.js, his records); every change goes through body-store.js, so it is
// on the phone at once, survives a reload and an offline stretch, and syncs. Owner: the Body agent.
import { $, $$, esc, push, pop, on, openSheet, closeSheet, toast, haptic, ring, seg, wireSegs } from '../core.js';
import { I } from '../icons.js';
import { AGENT, DEMO_MODE } from '../data.js';
import { api } from '../bus.js';
import { stagger, rollHTML, roll, symbol } from '../motion.js';
import {
  B, EX, MUSCLES, TODAY, ROTATION, exInfo, itemOf, previous, trend, sessionVolume, sessionSets, e1rm, swapsFor, bestFor, next, upcoming, planById, session,
  addDays, weekOf, weekday, dayLabel, dayShort, daysBetween, hm, fill, eaten, proteinLeft, pmDone, pmDue, trainedToday, whenOf, relDay, clockNow, nowMs, TARGET_SOURCES,
} from './body-data.js';
import * as store from './body-store.js';
import { libList } from './body-model.js';
import { S, nav, refresh } from './body-state.js';
import { BI, kg, int, clock, setText, targetText, thumb, demo, bodyPair, miniMap, workedBy, lightUp, wyn, lineChart, wireScrub } from './body-ui.js';
import { liveStart, liveUpdate, liveEnd } from './body-native.js';

// ── the week: which days he trained, and the streak of full weeks ─────
export function weekDays() {
  const mon = weekOf(TODAY); const plans = upcoming();
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(mon, i);
    return { d, wd: weekday(d).slice(0, 1), ss: B.sessions.filter((s) => s.date === d), missed: B.missed.find((s) => s.date === d) ?? null, plan: plans.find((p) => p.date === d) ?? null, today: d === TODAY, past: d < TODAY };
  });
}
export const daysThisWeek = () => weekDays().filter((x) => x.ss.length).length;
export function weekStreak() {
  const target = B.targets.days; let n = 0, w = addDays(weekOf(TODAY), -7);
  for (let g = 0; g < 260; g++) { const days = new Set(B.sessions.filter((s) => weekOf(s.date) === w).map((s) => s.date)); if (days.size >= target) { n++; w = addDays(w, -7); } else break; }
  return n;
}
export const sessionShort = (s) => (s.name === 'Cardio + core' ? 'Core' : s.name === 'Active recovery' ? 'Recovery' : s.name === 'Legs + speed' ? 'Legs' : s.name);
const planWho = (p) => (p.plan_by === 'wyn' ? `planned by ${AGENT.name}` : p.plan_by === 'him' ? 'your plan' : 'from your recovery');

// ── Train (the app's home) ───────────────────────────────────────────
export function renderTrain(el) {
  const p = next(); const live = B.live; const today = trainedToday();
  const week = weekDays(); const nDays = week.filter((x) => x.ss.length).length; const streak = weekStreak(); const target = B.targets.days;
  const food = eaten(); const left = proteinLeft(); const H = B.health;
  const due = B.day.due, doneN = B.day.done;
  const recent = [...B.sessions, ...B.missed].sort((a, b) => b.date.localeCompare(a.date) || (b.startMs ?? 0) - (a.startMs ?? 0)).slice(0, today.length ? Math.max(3, today.length) : 3);
  const ch = B.profile?.challenge;
  const chDay = ch?.start ? daysBetween(ch.start, TODAY) + 1 : null;
  el.innerHTML = `
    <div class="phead asp-head"><div class="asp-head-l"><p class="kicker c-as">Body</p><h1 class="lt">Train</h1>
      <p class="sub">${esc(weekday(TODAY, true))} · ${nDays} of ${target} days this week${chDay > 0 && chDay <= ch.days ? ` · day ${chDay} of ${ch.days}` : ''}</p></div></div>
    ${live ? liveBar(live) : ''}
    ${!live && p ? (today.length && p.date !== TODAY ? doneCard(today, p) : planCard(p)) : ''}
    <div class="bod-glance">
      <button class="bod-tile surface" data-act="bod-go" data-s="recovery">
        ${ring((H.score ?? 0) / 100, 'as', 40, 5, { label: `Readiness ${H.score ?? 'unknown'}` })}
        <span class="bod-tile-v met">${H.score ?? '—'}</span><span class="bod-tile-k">Readiness</span><span class="bod-tile-m">${H.partial ? 'Add sleep' : esc(H.word)}</span>
      </button>
      <button class="bod-tile surface" data-act="bod-go" data-s="fuel">
        ${ring(food.p / B.targets.protein, 'as', 40, 5, { label: `Protein ${food.p} of ${B.targets.protein} grams` })}
        <span class="bod-tile-v met">${food.p}<small>/${B.targets.protein} g</small></span><span class="bod-tile-k">Protein</span><span class="bod-tile-m">${left ? `${left} g to go` : 'Target hit'}</span>
      </button>
      <button class="bod-tile surface" data-act="bod-go" data-s="looks">
        ${ring(due ? doneN / due : 0, 'as', 40, 5, { label: due ? `Protocol ${doneN} of ${due}` : 'No protocol yet' })}
        <span class="bod-tile-v met">${due ? `${doneN}<small>/${due}</small>` : '—'}</span><span class="bod-tile-k">Protocol</span><span class="bod-tile-m">${!due ? 'Set it up' : pmDone() === pmDue() && pmDue() ? 'All done' : `PM by ${esc(B.targets.pmDue)}`}</span>
      </button>
    </div>

    <div class="sh"><h2>This week</h2><button class="sh-act" data-act="bod-targets">Targets ${I.chevR}</button></div>
    <div class="bod-week surface">
      <div class="bod-week-top">
        <p><span class="met bod-week-n">${nDays}</span><span class="bod-week-of"> of ${target} days</span></p>
        <span class="bod-streak">${BI.flame}<b class="met">${streak}</b> week streak</span>
      </div>
      <div class="bod-days">${week.map(dayDot).join('')}</div>
      <p class="foot bod-week-foot">${esc(weekFoot(week, nDays, target, streak))}</p>
    </div>

    <div class="sh"><h2>${today.length ? 'Today' : 'Recent'}</h2><button class="sh-act" data-act="bod-go" data-s="log">Log ${I.chevR}</button></div>
    ${recent.length ? `<div class="group bod-recent">${recent.map(sessionRow).join('')}</div>` : `<p class="note">${I.dumbbell} Your first workout shows here, with every set. Start the one above, or tell ${esc(AGENT.name)} what you did.</p>`}

    ${goalCard()}

    ${upcomingRows(p)}

    <div class="sh"><h2>${esc(AGENT.name)} in Body</h2><button class="sh-act" data-act="bod-tools">What she can do ${I.chevR}</button></div>
    ${B.wyn.length ? `<div class="group bod-log">${B.wyn.map((x) => `<div class="row bod-logrow"><span class="bod-at met">${esc(x.at)}</span><span class="rbody"><span class="rtitle wrap">${esc(fill(x.text))}</span></span></div>`).join('')}</div>`
      : `<p class="note">Nothing from her here today yet. Tell her what you ate or lifted and she logs it; she plans each session from your recovery.</p>`}`;
  wireScrub(el);
  stagger($$('.bod-plan, .bod-glance > *, .bod-week, .bod-recent > *', el), { each: 35, y: 10 });
}
function weekFoot(week, n, target, streak) {
  if (n >= target) return `${n} days done. The ${streak ? `${streak}-week ` : ''}streak is safe this week.`;
  const left = week.filter((x) => !x.past && !x.ss.length).length;
  const need = target - n;
  if (need > left) return `${need} more would hit ${target}, with ${left} ${left === 1 ? 'day' : 'days'} left. Any session still counts.`;
  const nextPlan = week.find((x) => !x.past && !x.ss.length && x.plan);
  return `${need} more to hit ${target}${nextPlan ? `; next is ${nextPlan.plan.name.toLowerCase()} ${nextPlan.today ? 'today' : `on ${weekday(nextPlan.d, true)}`}` : ''}.`;
}
function dayDot(x) {
  const s = x.ss[0]; const lbl = s ? sessionShort(s) : x.plan ? sessionShort(x.plan) : x.missed && x.past ? 'Missed' : '';
  const st = s ? 'bod-done' : x.plan ? 'bod-planned' : x.past ? 'bod-offday' : 'bod-free';
  const act = s ? `data-act="bod-session" data-id="${esc(s.id)}"` : x.plan ? `data-act="bod-preview" data-id="${esc(x.plan.id)}"` : '';
  const tag = act ? 'button' : 'span';
  return `<${tag} class="bod-day ${st}${x.today ? ' bod-today' : ''}" ${act} aria-label="${esc(`${weekday(x.d, true)}: ${s ? `${s.name} done` : x.plan ? `${x.plan.name} planned` : x.missed ? 'missed' : 'rest'}`)}">
    <span class="bod-day-c">${s ? I.check : `<b>${x.wd}</b>`}</span><span class="bod-day-l">${esc(lbl || weekday(x.d))}</span></${tag}>`;
}
function sessionRow(s) {
  if (s.status === 'skipped') return `<div class="row ic bod-srow bod-missrow"><span class="tile bod-date"><b class="met">${new Date(`${s.date}T00:00:00Z`).getUTCDate()}</b><i>${esc(weekday(s.date))}</i></span>
    <span class="rbody"><span class="rtitle">Missed</span><span class="rmeta ell">${esc(s.note || 'No session')}</span></span></div>`;
  const sets = sessionSets(s), vol = sessionVolume(s);
  const meta = [relDay(s.date), s.at, s.dur ? `${s.dur} min` : null, sets ? `${sets} sets` : s.items.some((it) => it.kind === 'cardio') ? null : 'sets not logged', vol ? `${int(vol)} kg` : null, s.source === 'health' ? 'Apple Health' : null].filter(Boolean).join(' · ');
  return `<button class="row ic bod-srow" data-act="bod-session" data-id="${esc(s.id)}">${miniMap(workedBy(s.items))}
    <span class="rbody"><span class="rtitle">${esc(s.name)}</span><span class="rmeta">${esc(meta)}</span></span>
    ${s.records?.length ? `<span class="pill bod-pr">${BI.trophy}${s.records.length}</span>` : ''}${I.chevR}</button>`;
}
function planCard(p) {
  const canAsk = !DEMO_MODE && p.plan_by !== 'wyn';
  return `<article class="bod-plan surface">
    <button class="bod-plan-hit" data-act="bod-preview" data-id="${esc(p.id)}" aria-label="Preview ${esc(p.name)}"></button>
    <p class="bod-plan-when">${I.cal}<span>${esc(whenOf(p.date, p.at))} · ${esc(planWho(p))}</span><span class="bod-plan-len">${p.dur} min</span></p>
    <h2 class="title2">${esc(p.name)}</h2>
    ${wyn(esc(fill(p.why)))}
    <div class="bod-strip" data-scroll-x>${p.items.map((it) => `<button class="bod-strip-i" data-act="bod-ex" data-id="${esc(it.ex)}" aria-label="${esc(`${it.name}, ${targetText(it.ex, it.target, it.sets)}`)}">${thumb(it.ex)}<span>${esc(stripTop(it))}</span><small>${esc(stripSub(it))}</small></button>`).join('')}</div>
    <div class="bod-plan-acts">
      <button class="btn tint" style="--c:var(--as-ink)" data-act="bod-start" data-id="${esc(p.id)}">${BI.play}Start</button>
      <button class="btn" data-act="bod-preview" data-id="${esc(p.id)}">Preview</button>
      ${canAsk ? `<button class="btn" data-act="bod-askplan" data-date="${esc(p.date)}">${I.sparkle}Ask ${esc(AGENT.name)}</button>` : ''}
    </div>
  </article>`;
}
const stripTop = (it) => { const k = it.kind ?? exInfo(it.ex).kind; const n = it.sets ?? 1; const t = it.target ?? {}; return k === 'cardio' ? `${t.min ?? 20} min` : k === 'time' ? `${n} × ${t.t ?? 30} s` : `${n} × ${t.r ?? 10}`; };
const stripSub = (it) => { const k = it.kind ?? exInfo(it.ex).kind; const t = it.target ?? {}; return k === 'cardio' ? 'Easy pace' : k === 'weight' ? (t.w == null ? 'Pick kg' : `${kg(t.w)} kg`) : k === 'time' ? 'Hold' : 'Reps'; };
function doneCard(today, p) {
  const names = today.map((s) => s.name.toLowerCase());
  return `<article class="bod-plan surface bod-done">
    <p class="bod-plan-when">${I.check}<span>Done today · ${esc(today.map((s) => s.at).filter(Boolean).join(', '))}</span></p>
    <h2 class="title2">Training's done for today</h2>
    ${wyn(`${esc(names.join(' and ').replace(/^\w/, (c) => c.toUpperCase()))} is in. ${proteinLeft() ? `Next: ${proteinLeft()} g of protein before bed.` : 'Protein is covered too.'} ${esc(p.name)} is ${esc(relDay(p.date).toLowerCase())}.`)}
    <div class="bod-plan-acts"><button class="btn" data-act="bod-preview" data-id="${esc(p.id)}">See ${esc(relDay(p.date))}</button><button class="btn" data-act="bod-go" data-s="fuel">Fuel</button></div>
  </article>`;
}
const liveBar = (L) => `<button class="bod-livebar surface" data-act="bod-resume">
  <span class="live" style="--c:var(--done)"></span>
  <span class="rbody"><span class="rtitle">${esc(L.name)} · in progress</span><span class="rmeta bod-live-t">${clock((nowMs() - Date.parse(L.started_at)) / 1000)} · ${liveProgress(L)}</span></span>
  <span class="btn sm tint" style="--c:var(--as-ink)">Resume</span>
</button>`;
const liveProgress = (L) => { const all = L.items.flatMap((it) => it.sets); return `${all.filter((x) => x.done).length} of ${all.length} sets`; };

// the goal card: his strength goal when he set one, else his weight goal (with the stale-value rule: an old weigh-in says so)
function goalCard() {
  const lift = B.targets.lift;
  if (lift?.ex) {
    const e = exInfo(lift.ex); const tr = trend(lift.ex).filter((t) => t.est);
    if (tr.length < 2) return `<div class="sh"><h2>${esc(e.name)} ${kg(lift.kg)} kg</h2><button class="sh-act" data-act="bod-goalset">Goal ${I.chevR}</button></div>
      <p class="note">${tr.length ? `One ${esc(e.name.toLowerCase())} session so far: ${esc(setText(lift.ex, tr[0]))}.` : `No ${esc(e.name.toLowerCase())} logged yet.`} The trend starts with the next one.</p>`;
    const est = tr.at(-1).est; const weeks = Math.max(1, daysBetween(tr[0].date, TODAY) / 7); const rate = (est - tr[0].est) / weeks;
    const to = rate > 0.05 ? Math.ceil((lift.kg - est) / rate) : null;
    const byNote = lift.by ? (to != null && addDays(TODAY, to * 7) <= lift.by ? `, before your ${dayShort(lift.by)} deadline` : lift.by ? `; the deadline is ${dayShort(lift.by)}` : '') : '';
    const lo = Math.floor(Math.min(...tr.map((t) => t.est)) / 10) * 10, hi = Math.ceil((Math.max(lift.kg, ...tr.map((t) => t.est)) + 2) / 10) * 10;
    const b = bestFor(lift.ex);
    return `<div class="sh"><h2>${esc(e.name)} ${kg(lift.kg)} kg</h2><button class="sh-act" data-act="bod-goalset">Goal ${I.chevR}</button></div>
    <button class="bod-goalcard surface" data-act="bod-ex" data-id="${esc(lift.ex)}">
      <div class="bod-goal-top">
        <div><p class="bod-goal-v"><span class="met">${rollHTML(Math.round(est * 2) / 2, { format: 'dec1' })}</span><span class="bod-goal-u"> kg estimated max</span></p>
        <p class="foot">${b ? `Best set ${esc(setText(lift.ex, b.set))}` : ''}${lift.single ? ` · best single ${kg(lift.single)} kg` : ''}</p></div>
        <span class="pill" style="--c:${est >= lift.kg ? 'var(--done)' : rate > 0 ? 'var(--done)' : 'var(--needs)'}">${est >= lift.kg ? 'Reached' : rate > 0 ? 'On the way' : 'Flat'}</span>
      </div>
      ${lineChart(tr.map((t) => ({ x: daysBetween(tr[0].date, t.date), v: t.est, label: dayLabel(t.date) })), {
        h: 120, min: lo, max: hi, ticks: [lo, Math.round((lo + hi) / 20) * 10, hi], goal: { v: lift.kg, label: `Goal ${kg(lift.kg)} kg` }, fmt: (v) => `${kg(Math.round(v * 2) / 2)} kg`, tickFmt: (v) => `${v}`,
        xl: [[0, dayShort(tr[0].date)], [daysBetween(tr[0].date, TODAY), 'Today']], title: `${e.name} estimated max` })}
      ${wyn(rate > 0.05 ? `+${kg(Math.round(rate * 10) / 10)} kg a week since ${dayShort(tr[0].date)}. At this pace ${kg(lift.kg)} kg lands in about ${to} weeks${byNote}.` : `Flat since ${dayShort(tr[0].date)}. Two more reps on the top set, then the weight goes up.`, 'bod-flat')}
    </button>`;
  }
  const w = B.health.weight; const goal = B.targets.weight;
  if (w?.trail?.length) {
    const stale = daysBetween(w.date, TODAY);
    const t = w.trail;
    return `<div class="sh"><h2>Weight</h2><button class="sh-act" data-act="bod-goalset">Goals ${I.chevR}</button></div>
    <section class="bod-goalcard surface">
      <div class="bod-goal-top">
        <div><p class="bod-goal-v"><span class="met">${kg(w.now)}</span><span class="bod-goal-u"> kg on ${esc(dayShort(w.date))}</span></p>
        <p class="foot">${goal?.goal ? `Goal: under ${kg(goal.goal)} kg${goal.by ? ` by ${esc(dayShort(goal.by))} ${goal.by.slice(0, 4)}` : ''}` : 'No weight goal set'}</p></div>
        ${stale > 14 ? `<span class="pill" style="--c:var(--needs)">${stale} days old</span>` : ''}
      </div>
      ${t.length > 1 ? lineChart(t.map((x) => ({ x: daysBetween(t[0].date, x.date), v: x.v, label: dayShort(x.date) })), { h: 110, fmt: (v) => `${kg(Math.round(v * 10) / 10)} kg`, tickFmt: (v) => `${Math.round(v)}`,
        ...(goal?.goal ? { goal: { v: goal.goal, label: `Goal ${kg(goal.goal)} kg` } } : {}), xl: [[0, dayShort(t[0].date)], [daysBetween(t[0].date, t.at(-1).date), dayShort(t.at(-1).date)]], title: 'Weight' }) : ''}
      ${wyn(stale > 30 ? `Your last weigh-in is ${stale} days old, so it can't say where you are now. Step on the scale and tell me, or let Apple Health send it.` : goal?.goal ? `${kg(Math.round((w.now - goal.goal) * 10) / 10)} kg to go.` : 'Set a goal and I keep the pace for you.', 'bod-flat')}
      <div class="bod-plan-acts"><button class="btn sm" data-act="bod-weigh">${BI.scale}Log weight</button></div>
    </section>`;
  }
  return `<div class="sh"><h2>Goals</h2></div>
    <div class="group"><button class="row ic" data-act="bod-goalset"><span class="tile">${BI.trophy}</span><span class="rbody"><span class="rtitle">Set a strength or weight goal</span><span class="rmeta">${esc(AGENT.name)} plans toward it and tracks the pace</span></span>${I.chevR}</button>
      <button class="row ic" data-act="bod-weigh"><span class="tile">${BI.scale}</span><span class="rbody"><span class="rtitle">Log your weight</span><span class="rmeta">Or let Apple Health send it</span></span>${I.chevR}</button></div>`;
}
function upcomingRows(p) {
  const rows = upcoming().filter((x) => x.id !== p?.id).slice(0, 3);
  const scanDay = B.scans.length ? addDays(B.scans.at(-1).date, 7) : null;
  const items = [
    ...rows.map((x) => `<button class="row ic" data-act="bod-preview" data-id="${esc(x.id)}"><span class="tile bod-date"><b class="met">${new Date(`${x.date}T00:00:00Z`).getUTCDate()}</b><i>${esc(weekday(x.date))}</i></span>
      <span class="rbody"><span class="rtitle">${esc(x.name)}</span><span class="rmeta">${esc([x.at, `${x.dur} min`, planWho(x)].filter(Boolean).join(' · '))}</span></span>${I.chevR}</button>`),
    ...(scanDay && scanDay > TODAY && daysBetween(TODAY, scanDay) <= 7 ? [`<button class="row ic" data-act="bod-go" data-s="looks"><span class="tile bod-date"><b class="met">${new Date(`${scanDay}T00:00:00Z`).getUTCDate()}</b><i>${esc(weekday(scanDay))}</i></span>
      <span class="rbody"><span class="rtitle">Weekly face scan</span><span class="rmeta">Same light as last time</span></span>${I.chevR}</button>`] : []),
  ];
  return items.length ? `<div class="sh"><h2>Coming up</h2></div><div class="group">${items.join('')}</div>` : '';
}

// ── preview: what the plan is, and why ────────────────────────────────
export function openPreview(id) {
  const p = planById(id) ?? (session(id)?.status === 'planned' ? planById(session(id).id) : null); if (!p) { toast('That plan has changed. Here is the next one'); const n = next(); if (n && n.id !== id) openPreview(n.id); return; }
  const f = workedBy(p.items.map((it) => ({ ex: it.ex, p: it.p, s: it.s, n: it.sets ?? 2 })));
  push({
    title: p.name, back: 'Train', aspect: 'body', cls: 'bod-page bod-preview-page',
    render(sc) {
      sc.innerHTML = `
        <div class="phead"><p class="kicker c-as">${esc(whenOf(p.date, p.at))} · ${esc(planWho(p))}</p><h1 class="lt">${esc(p.name)}</h1>
          <p class="sub">${p.dur} min · ${p.items.length} exercises · ${p.items.reduce((a, it) => a + (it.sets ?? 1), 0)} sets</p></div>
        <div class="bod-prev-top surface">
          ${bodyPair(f, { cls: 'bod-pair-sm', label: `${p.name} works` })}
          <div class="bod-prev-why"><p class="headline">Why this plan</p><ul class="bod-why">${p.reasons.map((t) => `<li>${esc(fill(t))}</li>`).join('')}</ul></div>
        </div>
        <div class="sh"><h2>Exercises</h2><span class="sh-count">${p.items.length}</span></div>
        <div class="group">${p.items.map((it, i) => {
          const pr = previous(it.ex); const last = pr ? pr.sets[0] : null;
          return `<div class="row bod-exrow">
            <button class="bod-exrow-hit" data-act="bod-ex" data-id="${esc(it.ex)}" aria-label="${esc(it.name)}"></button>
            ${thumb(it.ex, 'bod-th-md')}
            <span class="rbody"><span class="rtitle">${esc(it.name)}</span><span class="rmeta"><b class="bod-tgt">${esc(targetText(it.ex, it.target, it.sets))}</b>${last ? `<span class="ell">· last ${esc(setText(it.ex, last))}</span>` : it.note ? `<span class="ell">· ${esc(it.note)}</span>` : ''}</span></span>
            <button class="btn sm icon bod-swapbtn" data-act="bod-swap" data-plan="${esc(p.id)}" data-i="${i}" aria-label="Swap ${esc(it.name)}">${BI.swap}</button>
          </div>`; }).join('')}</div>
        <div class="bod-adjust"><p class="foot">Short on time?</p><div class="chips">
          <button class="chip sm" data-act="bod-adjust" data-k="short" data-plan="${esc(p.id)}">30 min version</button>
          <button class="chip sm" data-act="bod-adjust" data-k="hard" data-plan="${esc(p.id)}">Make it harder</button>
          <button class="chip sm" data-act="bod-adjust" data-k="ask" data-plan="${esc(p.id)}">Ask ${esc(AGENT.name)} to change it</button></div></div>
        <div class="bod-cta"><button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-start" data-id="${esc(p.id)}">${BI.play}${p.date === TODAY ? 'Start workout' : 'Start it now'}</button></div>`;
      lightUp(sc, 200);
      stagger($$('.bod-exrow', sc), { each: 40, y: 8, delay: 120 });
    },
  });
}
on('bod-askplan', async (b) => {
  if (b.disabled) return; b.disabled = true; const was = b.innerHTML; b.innerHTML = `<span class="spin"></span>${esc(AGENT.name)} is planning`;
  try { const r = await store.askPlan({ date: b.dataset.date }); toast(r?.by === 'wyn' ? `${AGENT.name} planned ${r.plan?.name}` : r?.note || 'Planned from your recovery'); }
  catch (e) { toast(e?.status ? `Couldn't plan just now: ${e.message}` : 'Your PC is offline. The plan from your recovery stays'); }
  finally { b.disabled = false; b.innerHTML = was; }
});

// ── the live workout: one doc in the store (status live), saved as he goes ──
function startFrom(p) {
  const doc = store.startLive(p);
  B.live = { ...JSON.parse(JSON.stringify(doc)), _local: true };
  return B.live;
}
export function startWorkout(id, { start = true } = {}) {
  if (B.live && (!id || id === B.live.id || id === B.live.from_plan)) { openPlayer(); return; }
  const p = (id && planById(id)) ?? next();
  if (!p) { openSwap(null); return; }
  if (B.live) { toast(`${B.live.name} was still open. Finish or discard it first`); openPlayer(); return; }
  if (!start) { openPreview(p.id); return; }
  startFrom(p);
  $$('.bod-player-page').forEach(() => pop());
  openPlayer();
  liveStart(B.live);
}
function L() { const l = B.live; if (l) l._local = true; return l; }
const save = (now = false) => { if (B.live) store.saveLive(B.live, { now }); };
function openPlayer() {
  const l = L(); if (!l) return;
  const page = push({
    title: l.name, back: 'Hide', aspect: 'body', cls: 'bod-page bod-player-page',
    right: `<button class="gbtn chrome accent bod-finish" style="--c:var(--as-fill)" data-act="bod-finish">Finish</button>`,
    onPop: () => { clearInterval(page._tick); save(true); refresh('train'); },
    render(sc, pg) {
      pg._render = () => renderPlayer(sc);
      renderPlayer(sc);
      pg.insertAdjacentHTML('beforeend', '<div class="bod-rest chrome" hidden></div>');
    },
  });
  const back = $('.topbar .back', page); if (back) back.innerHTML = `${I.chevD}<span>Hide</span>`;
  const title = $('.tb-title', page); title.classList.add('always', 'bod-clock');
  const tick = () => {
    if (!document.contains(page) || !B.live) { clearInterval(page._tick); return; }
    title.innerHTML = `<span class="met">${clock((nowMs() - Date.parse(B.live.started_at)) / 1000)}</span><small>${esc(B.live.name)}</small>`;
    tickRest(page);
  };
  tick(); page._tick = setInterval(tick, 1000);
  if (B.live.rest) tickRest(page, true);
}
function renderPlayer(sc) {
  const l = B.live; if (!l) return;
  const all = l.items.flatMap((it) => it.sets); const nDone = all.filter((x) => x.done).length;
  const cur = Math.min(l.cur ?? 0, l.items.length - 1);
  sc.innerHTML = `
    <div class="bod-pl-head">
      <p class="kicker c-as">${esc(l.name)}</p>
      <p class="bod-pl-stats"><span><b class="met">${l.items.length ? cur + 1 : 0}</b> of ${l.items.length} exercises</span><span><b class="met">${nDone}</b> of ${all.length} sets</span>${l.items.length ? `<span>${int(l.items.reduce((a, it) => a + it.sets.filter((x) => x.done).reduce((b, x) => b + (x.w ?? 0) * (x.r ?? 0), 0), 0))} kg</span>` : ''}</p>
      <div class="steps" style="--c:var(--as)">${all.map((x) => `<i class="${x.done ? 'done' : ''}"></i>`).join('')}</div>
    </div>
    ${l.items.length ? l.items.map((it, i) => (i === cur ? exCard(it, i) : exRow(it, i))).join('') : `<p class="note">No exercises yet. Add the first one.</p>`}
    <button class="bod-addex" data-act="bod-addex">${I.plus}Add an exercise</button>`;
}
function exRow(it, i) {
  const e = exInfo(it.ex, it); const done = it.sets.length && it.sets.every((x) => x.done); const n = it.sets.filter((x) => x.done).length;
  return `<button class="bod-pl-row surface${done ? ' bod-done' : ''}" data-act="bod-cur" data-i="${i}">
    ${thumb(it.ex, 'bod-th-md')}
    <span class="rbody"><span class="rtitle">${esc(it.name ?? e.name)}</span><span class="rmeta">${done ? `${n} sets done${it.sets.some((x) => x.pr) ? ' · new record' : ''}` : esc(targetText(it.ex, it.sets[0] ?? it.target, it.sets.length))}</span></span>
    ${done ? `<span class="check done" aria-label="Done">${I.check}</span>` : `<span class="bod-pl-sets" aria-label="${n} of ${it.sets.length} sets"><span class="bod-pl-bars">${it.sets.map((x) => `<i class="${x.done ? 'bod-on' : ''}"></i>`).join('')}</span><small>${n}/${it.sets.length}</small></span>`}
  </button>`;
}
const COLS = { weight: ['kg', 'Reps'], bw: ['', 'Reps'], time: ['', 'Time'], cardio: ['Min', 'Km'] };
function exCard(it, i) {
  const e = exInfo(it.ex, it); const kind = it.kind ?? e.kind; const [c1, c2] = COLS[kind] ?? COLS.weight;
  const prev = previous(it.ex)?.sets ?? [];
  return `<section class="bod-pl-card surface" data-i="${i}">
    ${demo(it.ex, 'bod-demo-card')}
    <div class="bod-pl-title">
      <div><h2 class="title3">${esc(it.name ?? e.name)}</h2><p class="foot">${esc([...(e.p ?? []), ...(e.s ?? []).slice(0, 1)].map((m) => MUSCLES[m]?.name).filter(Boolean).join(' · '))}${e.equip ? ` · ${esc(e.equip)}` : ''}</p></div>
      <button class="gbtn icon bod-more" data-act="bod-exmenu" data-i="${i}" aria-label="More for ${esc(e.name)}">${I.dots}</button>
    </div>
    ${it.note || e.cue ? wyn(esc(it.note || e.cue), 'bod-cue') : ''}
    <div class="bod-sets k-${kind}" role="table" aria-label="Sets">
      <div class="bod-set bod-head" role="row"><span>Set</span><span>Previous</span><span>${c1}</span><span>${c2}</span><span></span></div>
      ${it.sets.map((x, j) => setRow(it, i, x, j, prev[j] ?? prev[prev.length - 1], kind)).join('')}
    </div>
    <div class="bod-pl-foot">
      <button class="btn sm" data-act="bod-addset" data-i="${i}">${I.plus}Add set</button>
      ${kind !== 'cardio' ? `<span class="foot">Rest ${restFor(it)} s between sets</span>` : '<span class="foot">At an easy, talking pace</span>'}
    </div>
  </section>`;
}
function setRow(it, i, x, j, pv, k) {
  const firstOpen = it.sets.findIndex((s) => !s.done) === j;
  const prevT = pv ? (k === 'weight' ? (pv.w == null ? `${pv.r}` : `${kg(pv.w)} × ${pv.r}`) : k === 'bw' ? `${pv.r}` : k === 'time' ? `${pv.t} s` : `${pv.min} min`) : '—';
  const cell = (f, v, label) => (x.done ? `<span class="bod-cell bod-val">${v}</span>` : `<button class="bod-cell${v === '—' ? ' bod-empty' : ''}" data-act="bod-cell" data-i="${i}" data-j="${j}" data-f="${f}" aria-label="${label}">${v}</button>`);
  let a = '', b = '';
  if (k === 'weight') { a = cell('w', x.w == null ? '—' : kg(x.w), `Weight, set ${j + 1}`); b = cell('r', x.r ?? '—', `Reps, set ${j + 1}`); }
  if (k === 'bw') { a = '<span class="bod-cell bod-bw">BW</span>'; b = cell('r', x.r ?? '—', `Reps, set ${j + 1}`); }
  if (k === 'time') { a = '<span class="bod-cell bod-bw"></span>'; b = cell('t', `${x.t ?? 30} s`, `Seconds, set ${j + 1}`); }
  if (k === 'cardio') { a = cell('min', x.min ?? 20, 'Minutes'); b = cell('km', x.km ?? '—', 'Kilometres'); }
  return `<div class="bod-set${x.done ? ' bod-set-done' : ''}${firstOpen ? ' bod-next' : ''}${x.pr ? ' bod-rec' : ''}" role="row">
    <span class="bod-set-n met">${x.pr ? BI.trophy : j + 1}</span><span class="bod-set-prev">${prevT}</span>${a}${b}
    <button class="check${x.done ? ' done' : ''}" data-act="bod-tick" data-i="${i}" data-j="${j}" aria-label="${x.done ? 'Undo' : 'Done'}: set ${j + 1}">${I.check}</button>
  </div>${x.pr && x.prNote ? `<p class="bod-prnote">${BI.trophy}<span>${esc(x.prNote)}</span></p>` : ''}`;
}
const restFor = (it) => { const e = exInfo(it.ex, it); return (e.p ?? []).some((m) => MUSCLES[m]?.big) ? 120 : (it.kind ?? e.kind) === 'weight' ? 90 : 60; };

function rerender() { const pg = $$('.bod-player-page').pop(); pg?._render?.(); }
function beats(it, x) {
  const k = it.kind ?? exInfo(it.ex, it).kind; const b = bestFor(it.ex); if (!b) return null;
  if (k === 'weight' && x.w != null && e1rm(x.w, x.r) > b.score + 1e-6) return `New record: ${kg(x.w)} kg × ${x.r}. Was ${b.set.w != null ? `${kg(b.set.w)} × ${b.set.r}` : `${b.set.r} reps`}.`;
  if (k === 'bw' && x.r > b.score) return `New record: ${x.r} reps. Was ${b.set.r}.`;
  if (k === 'time' && x.t > b.score) return `New record: ${x.t} s. Was ${b.set.t} s.`;
  return null;
}
/** Tick set j of exercise i (from the screen or the lock screen's Live Activity). */
export function tickSet(i, j, { fromLock = false } = {}) {
  const l = L(); if (!l) return;
  const it = l.items[i]; const x = it?.sets[j]; if (!x) return;
  x.done = !x.done;
  if (!x.done) { x.pr = false; x.prNote = ''; save(); rerender(); liveUpdate(l, 'work'); return; }
  x.at = new Date(nowMs()).toISOString();
  haptic(10);
  const rec = beats(it, x); x.pr = !!rec && !it.sets.some((s, k) => k !== j && s.pr); x.prNote = x.pr ? rec : '';
  if (x.pr) haptic(24);
  const last = it.sets.every((s) => s.done);
  const allDone = l.items.every((s) => s.sets.every((y) => y.done));
  if (last && i === (l.cur ?? 0)) { const n = l.items.findIndex((s, k) => k > i && s.sets.some((y) => !y.done)); l.cur = n === -1 ? i : n; }
  if (!allDone && (it.kind ?? exInfo(it.ex, it).kind) !== 'cardio') startRest(restFor(it), last ? (l.items[l.cur]?.name ?? '') : `Set ${it.sets.findIndex((s) => !s.done) + 1}`, false);
  save();
  liveUpdate(l, l.rest ? 'rest' : 'work');
  const apply = () => { rerender(); if (x.pr) { const t = $$('.bod-player-page').pop()?.querySelector('.bod-rec .bod-set-n svg'); if (t) symbol(t, 'bounce'); } if (allDone) toast('Every set done. Tap Finish to save it'); if (last) scrollToCard(true); };
  if (fromLock) apply(); else setTimeout(apply, 420);
}
on('bod-tick', (b) => {
  const it = B.live?.items[+b.dataset.i]; const x = it?.sets[+b.dataset.j];
  // a weighted set with no weight yet: pick it first, so the log and the records stay true
  if (x && !x.done && (it.kind ?? exInfo(it.ex, it).kind) === 'weight' && x.w == null) { const cell = b.parentElement?.querySelector('[data-f="w"]'); toast('Pick the weight first'); cell?.click(); return; }
  b.classList.add('closing', 'done'); tickSet(+b.dataset.i, +b.dataset.j);
});
on('bod-cur', (b) => { const l = L(); if (!l) return; l.cur = +b.dataset.i; haptic(5); save(); rerender(); scrollToCard(false); liveUpdate(l); });
function scrollToCard(smooth) {
  const pg = $$('.bod-player-page').pop(); const sc = pg && $('.scroll', pg); const card = sc && $('.bod-pl-card', sc); if (!card) return;
  const top = card.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 112;
  sc.scrollTo({ top: Math.max(0, top), behavior: smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
}
on('bod-addset', (b) => { const it = L()?.items[+b.dataset.i]; if (!it) return; const l = it.sets[it.sets.length - 1] ?? it.target ?? {}; it.sets.push({ ...l, done: false, pr: false, prNote: '', at: undefined }); save(); rerender(); });
on('bod-addex', () => openSwap(null));
on('bod-resume', () => openPlayer());

// rest timer: a ring that empties, ±15 s, skip; kept in the doc, so a reload or the lock screen shows the same rest
function startRest(sec, nextName, draw = true) {
  const l = L(); if (!l) return;
  l.rest = { t0: nowMs(), total: sec, next: nextName ?? '' };
  if (draw) { const pg = $$('.bod-player-page').pop(); if (pg) tickRest(pg, true); }
  else setTimeout(() => { const pg = $$('.bod-player-page').pop(); if (pg) tickRest(pg, true); }, 430);
}
function tickRest(pg, fresh = false) {
  const l = B.live; const box = $('.bod-rest', pg); if (!box || !l) return;
  if (!l.rest) { box.hidden = true; return; }
  const left = l.rest.total - (nowMs() - l.rest.t0) / 1000;
  if (left <= 0) {
    l.rest = null; haptic(30); save(); liveUpdate(l, 'work');
    box.innerHTML = `<span class="bod-rest-go">${I.bolt}<span>Rest's over. Next set.</span></span>`;
    setTimeout(() => { if (!B.live?.rest) box.hidden = true; }, 2200);
    return;
  }
  if (fresh || !$('.rg', box)) {
    box.hidden = false;
    box.innerHTML = `${ring(1, 'as', 40, 4, { cls: 'bod-rest-rg' })}
      <span class="bod-rest-t"><b class="met">${clock(left)}</b><small>Rest${l.rest.next ? ` · ${esc(l.rest.next)} next` : ''}</small></span>
      <button class="btn sm" data-act="bod-rest-add" data-v="-15">−15</button><button class="btn sm" data-act="bod-rest-add" data-v="15">+15</button>
      <button class="btn sm tint" style="--c:var(--as-ink)" data-act="bod-rest-skip">Skip</button>`;
  }
  $('.bod-rest-t b', box).textContent = clock(left);
  const rg = $('.rg', box); rg.style.setProperty('--rp', Math.max(0, left / l.rest.total).toFixed(4)); rg.dataset.v = (left / l.rest.total).toFixed(4);
}
export function skipRest() { const l = L(); if (!l) return; l.rest = null; save(); liveUpdate(l, 'work'); const pg = $$('.bod-player-page').pop(); const box = pg && $('.bod-rest', pg); if (box) box.hidden = true; }
on('bod-rest-add', (b) => { const r = L()?.rest; if (!r) return; r.total = Math.max(5, r.total + Number(b.dataset.v)); haptic(5); save(); liveUpdate(B.live, 'rest'); const pg = $$('.bod-player-page').pop(); tickRest(pg); });
on('bod-rest-skip', () => skipRest());

// the value stepper: big number, − and +, quick steps, and for a barbell the plates per side
const STEP = { w: (e) => e.step ?? 2.5, r: () => 1, t: () => 5, min: () => 1, km: () => 0.1 };
const UNIT = { w: 'kg', r: 'reps', t: 'seconds', min: 'minutes', km: 'km' };
function plates(total, bar) {
  let side = (total - bar) / 2; if (side <= 0) return 'Just the bar';
  const out = []; for (const p of [20, 15, 10, 5, 2.5, 1.25]) while (side >= p - 1e-6) { out.push(p); side -= p; }
  return `Each side: ${out.map(kg).join(' + ')}`;
}
on('bod-cell', (b) => {
  const l = L(); if (!l) return;
  const i = +b.dataset.i, j = +b.dataset.j, f = b.dataset.f; const it = l.items[i]; const e = exInfo(it.ex, it); const x = it.sets[j];
  const st = STEP[f](e); let v = x[f] ?? (f === 'w' ? (e.bar ?? 10) : f === 'r' ? 10 : f === 't' ? 30 : f === 'km' ? 1 : 20);
  const body = (el) => {
    const draw = () => {
      el.innerHTML = `<div class="bod-step">
        <button class="bod-step-b" data-k="-1" aria-label="Less">${I.minus}</button>
        <p class="bod-step-v"><span class="met">${f === 'w' ? kg(v) : f === 'km' ? Number(v).toFixed(1) : v}</span><small>${UNIT[f]}</small></p>
        <button class="bod-step-b" data-k="1" aria-label="More">${I.plus}</button></div>
        ${f === 'w' && e.bar ? `<p class="bod-plates foot">${plates(v, e.bar)} · ${e.bar} kg bar</p>` : f === 'w' ? `<p class="bod-plates foot">${e.equip === 'Dumbbells' ? 'Per dumbbell' : 'Stack weight'} · steps of ${kg(st)} kg</p>` : ''}
        <div class="chips bod-step-q">${(f === 'w' ? [-5, -st, st, 5] : f === 'r' ? [-2, -1, 1, 2] : f === 't' ? [-10, -5, 5, 10] : [-1, 1]).map((d) => `<button class="chip sm" data-d="${d}">${d > 0 ? '+' : '−'}${f === 'w' ? kg(Math.abs(d)) : Math.abs(d)}</button>`).join('')}</div>
        <p class="foot bod-step-note">Changes the sets after this one too.</p>
        <button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-cell-ok">Done</button>`;
    };
    draw();
    el.addEventListener('click', (ev) => {
      const k = ev.target.closest('[data-k]'); const d = ev.target.closest('[data-d]');
      if (k) v = Math.max(0, +(v + Number(k.dataset.k) * st).toFixed(2)); else if (d) v = Math.max(0, +(v + Number(d.dataset.d)).toFixed(2)); else return;
      haptic(4); draw();
    });
    el._get = () => v;
  };
  const pv = previous(it.ex)?.sets?.[j];
  const sh = openSheet({ title: `${it.name ?? e.name} · set ${j + 1}`, sub: f === 'w' ? `Last time ${pv ? setText(it.ex, pv) : 'not done yet'}` : '', body, cls: 'bod-sheet' });
  sh._apply = () => { const nv = $('.sheet-body', sh)._get(); it.sets.forEach((s, k) => { if (k >= j && !s.done) s[f] = nv; }); save(); rerender(); liveUpdate(l); };
});
on('bod-cell-ok', (b) => { const sh = b.closest('.sheet'); sh?._apply?.(); closeSheet(sh); });

// exercise menu, swaps, and the picker over the whole library
on('bod-exmenu', (b) => {
  const i = +b.dataset.i; const it = B.live?.items[i]; if (!it) return;
  openSheet({ title: it.name ?? exInfo(it.ex, it).name, cls: 'bod-sheet', body: `<div class="group">
    <button class="row ic" data-act="bod-swap" data-plan="live" data-i="${i}"><span class="tile">${BI.swap}</span><span class="rbody"><span class="rtitle">Swap exercise</span><span class="rmeta">Same muscles, different kit</span></span>${I.chevR}</button>
    <button class="row ic" data-act="bod-ex" data-id="${esc(it.ex)}"><span class="tile">${I.read}</span><span class="rbody"><span class="rtitle">How to, history and records</span></span>${I.chevR}</button>
    <button class="row ic" data-act="bod-remove" data-i="${i}"><span class="tile">${I.trash}</span><span class="rbody"><span class="rtitle" style="color:var(--fail-ink)">Remove from today</span></span></button>
  </div>` });
});
on('bod-remove', (b) => { const l = L(); if (!l) return; const i = +b.dataset.i; const [it] = l.items.splice(i, 1); l.cur = Math.max(0, Math.min(l.cur ?? 0, l.items.length - 1)); closeSheet(); save(); rerender(); toast(`Removed ${it.name ?? exInfo(it.ex).name}`, () => { l.items.splice(i, 0, it); save(); rerender(); }); });
on('bod-swap', (b) => openSwap(b.dataset.plan === 'live' ? { live: true, i: +b.dataset.i } : { plan: b.dataset.plan, i: +b.dataset.i }));
function openSwap(ctx) {
  const from = ctx ? (ctx.live ? B.live?.items[ctx.i] : planById(ctx.plan)?.items[ctx.i]) : null;
  const opts = from ? swapsFor(from.ex, 4) : ['dead-hang', 'plank', 'pushup', 'walk', 'bike', 'curl'];
  if (document.querySelector('.sheet.in')) closeSheet();
  const row = (id) => { const e = exInfo(id); return `<button class="row ic bod-swaprow" data-act="bod-swap-pick" data-id="${esc(id)}">${thumb(id, 'bod-th-md')}<span class="rbody"><span class="rtitle">${esc(e.name)}</span><span class="rmeta">${esc([e.equip, (e.p ?? []).map((m) => MUSCLES[m]?.name).filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</span></span>${from ? BI.swap : I.plus}</button>`; };
  const sh = openSheet({
    title: from ? `Instead of ${(from.name ?? exInfo(from.ex).name).toLowerCase()}` : 'Add an exercise', sub: from ? `Same main muscle: ${(MUSCLES[exInfo(from.ex, from).p?.[0]]?.name ?? 'any').toLowerCase()}` : `${libList().length ? `${libList().length + Object.keys(EX).length} exercises` : 'Your exercises'}, or search`, cls: 'bod-sheet', large: true,
    body: (el) => {
      el.innerHTML = `<div class="pad"><label class="field"><input type="search" placeholder="Search: bench, row, plank…" aria-label="Search exercises" enterkeyhint="search" data-bod-q></label></div>
        <div class="group bod-swaplist">${opts.map(row).join('')}</div>
        ${from ? wyn(`${esc(exInfo(opts[0]).name)} is the closest match. Swaps keep your weights for next time.`) : ''}`;
      const list = $('.bod-swaplist', el);
      $('[data-bod-q]', el).addEventListener('input', (ev) => {
        const q = ev.target.value.trim().toLowerCase();
        if (q.length < 2) { list.innerHTML = opts.map(row).join(''); return; }
        const terms = q.split(/\s+/);
        const hit = (n) => terms.every((t) => n.toLowerCase().includes(t));
        const mine = Object.keys(EX).filter((k) => !k.startsWith('hk-') && hit(EX[k].name));
        const lib = libList().filter((x) => hit(x.name)).sort((a, b) => a.name.length - b.name.length).map((x) => x.id);
        const ids = [...new Set([...mine, ...lib])].slice(0, 24);
        list.innerHTML = ids.length ? ids.map(row).join('') : `<p class="note">Nothing called "${esc(q)}".${libList().length ? '' : ' The full library loads when your PC is reachable.'}</p>`;
      });
    },
  });
  sh._ctx = ctx;
  store.loadLibrary();
}
on('bod-swap-pick', (b) => {
  const sh = b.closest('.sheet'); const ctx = sh?._ctx; const id = b.dataset.id; const e = exInfo(id);
  const best = bestFor(id)?.set;
  const tgt = e.kind === 'weight' ? { w: best?.w ?? null, r: best?.r ?? 10 } : e.kind === 'time' ? { t: id === 'dead-hang' ? 60 : 30 } : e.kind === 'cardio' ? { min: 20 } : { r: 10 };
  const l = B.live;
  if (!ctx) {
    if (!l) { // no workout open: start an empty one with this exercise
      startFrom({ name: 'Workout', split: null, items: [{ ...itemOf(id), target: tgt, sets: 3 }], plan_by: 'him', why: '', reasons: [] });
      closeSheet(sh); $$('.bod-player-page').forEach(() => pop()); openPlayer(); liveStart(B.live); return;
    }
    L().items.push({ ...itemOf(id), note: e.cue ?? '', target: tgt, sets: [0, 1, 2].map(() => ({ ...tgt, done: false })) }); closeSheet(sh); save(); rerender(); toast(`Added ${e.name}`); return;
  }
  if (ctx.live) { const it = L().items[ctx.i]; const was = it.name ?? exInfo(it.ex).name; Object.assign(it, itemOf(id), { note: e.cue ?? '', target: tgt, sets: it.sets.map((s) => (s.done ? s : { ...tgt, done: false })) }); closeSheet(sh); save(); rerender(); liveUpdate(l); toast(`Swapped ${was} for ${e.name}`); return; }
  const p = planById(ctx.plan); if (!p) return;
  const was = p.items[ctx.i].name;
  const items = p.items.map((it, k) => (k === ctx.i ? { ...itemOf(id), note: `Instead of ${was.toLowerCase()}.`, target: tgt, sets: it.sets } : it));
  store.storePlan({ ...p, items });
  closeSheet(sh); if ($$('.bod-preview-page').length) { pop(); setTimeout(() => openPreview(p.stored ? p.id : `plan-${p.date}`), 80); }
  toast(`Swapped ${was} for ${e.name}`);
});
on('bod-adjust', (b) => {
  const k = b.dataset.k; const p = planById(b.dataset.plan); if (!p) return;
  if (k === 'ask') { api.askAgent(`Change my ${p.name.toLowerCase()} workout for ${relDay(p.date).toLowerCase()}`, { aspect: 'body', about: p.name }); return; }
  let items = p.items.map((it) => ({ ...it, target: { ...it.target } })); let dur = p.dur;
  if (k === 'short') { items = items.filter((it, i) => i < 3 || it.ex === 'dead-hang').map((it) => (it.kind === 'cardio' ? { ...it, target: { ...it.target, min: Math.min(it.target.min ?? 20, 12) } } : { ...it, sets: Math.min(it.sets, 3) })); dur = 30; toast('Cut to 30 min: the main lifts and your dead hangs'); }
  if (k === 'hard') { items = items.map((it) => ({ ...it, target: { ...it.target, ...(it.target.r ? { r: it.target.r + 2 } : {}), ...(it.target.t ? { t: it.target.t + 10 } : {}) } })); toast('Two more reps and ten more seconds a set'); }
  store.storePlan({ ...p, items, dur });
  pop(); setTimeout(() => openPreview(p.stored ? p.id : `plan-${p.date}`), 80);
});

// finish → summary. The trained muscles light up on the map.
on('bod-finish', () => {
  const l = B.live; if (!l) return;
  const left = l.items.flatMap((it) => it.sets).filter((x) => !x.done).length;
  const any = l.items.flatMap((it) => it.sets).some((x) => x.done);
  if (left || !any) {
    openSheet({ title: any ? `Finish with ${left} ${left === 1 ? 'set' : 'sets'} left?` : 'No sets done yet', sub: any ? 'Done sets are saved; the rest are dropped.' : 'Tick a set to save it, or discard this workout.', cls: 'bod-sheet', body: `<div class="bod-confirm">
      ${any ? '<button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-finish-ok">Finish and save</button>' : ''}
      <button class="btn block" data-act="close-sheet">Keep going</button>
      ${any ? '' : '<button class="btn block tint" style="--c:var(--fail-ink)" data-act="bod-discard">Discard workout</button>'}</div>` });
    return;
  }
  finish();
});
on('bod-finish-ok', () => { closeSheet(); finish(); });
on('bod-discard', () => { closeSheet(); const l = B.live; if (!l) return; store.discardLive(l); B.live = null; liveEnd(); pop(); toast('Workout discarded'); refresh('train'); });
export function finish() {
  const l = B.live; if (!l) return;
  const records = l.items.flatMap((it) => it.sets.filter((x) => x.done && x.pr).map((x) => ({ ex: it.ex, name: it.name, note: x.prNote })));
  const doc = store.finishLive(l);
  B.live = null; liveEnd();
  $$('.bod-player-page').forEach(() => pop());
  setTimeout(() => openSummary(doc.id, records), 80);
}
function openSummary(id, records = null) {
  const s = session(id) ?? null; if (!s) return;
  const f = workedBy(s.items); const vol = sessionVolume(s); const sets = sessionSets(s);
  const recs = records ?? s.records?.map((r) => ({ ex: r.ex, name: exInfo(r.ex).name, note: `${setText(r.ex, r.set)}. Was ${setText(r.ex, r.was)}.` })) ?? [];
  const cardio = s.items.find((it) => it.kind === 'cardio');
  push({
    title: 'Workout done', back: 'Train', aspect: 'body', cls: 'bod-page bod-summary',
    render(sc) {
      sc.innerHTML = `
        <div class="phead"><p class="kicker c-as">${esc(s.name)} · ${esc(dayLabel(s.date))}</p><h1 class="lt">Workout done</h1>
          <p class="sub">${recs.length ? `${recs.length} new ${recs.length === 1 ? 'record' : 'records'}. ` : ''}Saved, and recovery has it.</p></div>
        <div class="bod-stats">
          <div class="bod-stat surface"><span class="met">${s.dur ? `${s.dur}` : '—'}</span><small>Minutes</small></div>
          <div class="bod-stat surface"><span class="met"${vol ? ` data-roll="${Math.round(vol)}"` : ''}>${vol ? rollHTML(0) : cardio ? (workSets(cardio)[0]?.km ?? '—') : 0}</span><small>${vol ? 'kg moved' : 'km'}</small></div>
          <div class="bod-stat surface"><span class="met" data-roll="${sets}">${rollHTML(0)}</span><small>Sets</small></div>
          <div class="bod-stat surface"><span class="met">${s.items.length}</span><small>Exercises</small></div>
        </div>
        <div class="bod-sum-map surface">${bodyPair(f, { label: 'What this workout worked' })}
          <p class="foot">${esc(Object.entries(f).filter(([, v]) => v > 0.08).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([m]) => MUSCLES[m].name).join(' · '))}</p></div>
        ${recs.length ? `<div class="sh"><h2>Records</h2></div><div class="group">${recs.map((x) => `<div class="row ic"><span class="tile bod-tile-pr">${BI.trophy}</span><span class="rbody"><span class="rtitle">${esc(x.name ?? exInfo(x.ex).name)}</span><span class="rmeta">${esc(x.note)}</span></span></div>`).join('')}</div>` : ''}
        ${wyn(proteinLeft() ? `Good session. ${proteinLeft()} g of protein to go today: a whey shake now covers 24 g of it.` : 'Good session. Protein is already covered for today.')}
        <div class="bod-cta">
          ${proteinLeft() ? `<button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-shake">${BI.glass}Log a whey shake</button>` : ''}
          <button class="btn block" data-act="pop">Done</button>
        </div>`;
      lightUp(sc, 380);
      stagger($$('.bod-stat', sc), { each: 50, y: 14 });
      setTimeout(() => $$('[data-roll]', sc).forEach((el) => roll(el, Number(el.dataset.roll))), 260);
      $$('.bod-tile-pr svg', sc).forEach((t, i) => setTimeout(() => symbol(t, 'bounce'), 520 + i * 120));
      haptic(18);
    },
  });
}
const workSets = (it) => (it?.sets ?? []).filter((x) => !x.warm && x.done !== false);
on('bod-shake', (b) => { store.addMeal({ name: 'Whey shake with water', slot: 'post-workout', kcal: 120, protein: 24, carbs: 3, fat: 1.5, source: 'quick', img: 'shake', items: [{ name: 'Whey, 1 scoop', grams: 32, kcal: 120, protein: 24 }] }); haptic(10); b.disabled = true; b.innerHTML = `${I.check}Shake logged`; });

// ── an exercise: how to, history, records ─────────────────────────────
export function openExercise(id) {
  const e = exInfo(id); if (!e) return;
  const t = trend(id); const best = bestFor(id);
  push({
    title: e.name, back: 'Back', aspect: 'body', cls: 'bod-page',
    render(sc) {
      const how = e.how?.length ? e.how : null;
      sc.innerHTML = `
        ${demo(id, 'bod-demo-hero')}
        <div class="phead"><h1 class="title1">${esc(e.name)}</h1><p class="sub">${esc((e.p ?? []).map((m) => MUSCLES[m]?.name).filter(Boolean).join(', '))}${e.s?.length ? ` · also ${esc(e.s.map((m) => MUSCLES[m]?.name.toLowerCase()).filter(Boolean).join(', '))}` : ''}${e.equip ? ` · ${esc(e.equip)}` : ''}</p></div>
        <div class="pad">${seg('bod-exseg', [['how', 'How to'], ['hist', 'History'], ['rec', 'Records']], 'how')}</div>
        <div class="bod-exsec" data-v="how">
          <ol class="bod-how surface">${how ? how.map((x) => `<li>${esc(x)}</li>`).join('') : '<li class="bod-how-load">Loading the steps…</li>'}</ol>
          ${e.cue ? wyn(esc(e.cue)) : ''}
          <div class="bod-exmap surface">${bodyPair(Object.fromEntries([...(e.p ?? []).map((m) => [m, 0.62]), ...(e.s ?? []).map((m) => [m, 0.26])]), { cls: 'bod-pair-sm', label: 'Muscles this works' })}
            <p class="foot"><span class="bod-key bod-k1"></span>Main · <span class="bod-key bod-k2"></span>Also works</p></div>
          ${e.lib ? '<p class="hint">From free-exercise-db (public domain).</p>' : ''}
        </div>
        <div class="bod-exsec" data-v="hist" hidden>
          ${t.length > 1 ? `<div class="bod-chartcard surface"><p class="headline">${e.kind === 'weight' ? 'Estimated max' : e.kind === 'time' ? 'Longest hold' : 'Best set'}</p>
            ${lineChart(t.map((x) => ({ x: daysBetween(t[0].date, x.date), v: e.kind === 'weight' ? x.est : x.r ?? x.t ?? x.min, label: dayLabel(x.date) })), {
              h: 130, fmt: (v) => (e.kind === 'weight' ? `${kg(Math.round(v * 2) / 2)} kg` : e.kind === 'time' ? `${Math.round(v)} s` : `${Math.round(v)}`), tickFmt: (v) => `${Math.round(v)}`,
              xl: [[0, dayLabel(t[0].date)], [daysBetween(t[0].date, t[t.length - 1].date), dayLabel(t[t.length - 1].date)]], title: `${e.name} trend` })}</div>` : `<p class="note">${t.length ? 'One session so far. The trend starts with the next one.' : 'Not done yet. Your sessions with it show here.'}</p>`}
          ${t.length ? `<div class="sh"><h2>Sessions</h2><span class="sh-count">${t.length}</span></div>
          <div class="group">${t.slice().reverse().slice(0, 8).map((x) => {
            const s = session(x.sid); const sets = workSets(s.items.find((it) => it.ex === id));
            return `<button class="row" data-act="bod-session" data-id="${esc(s.id)}"><span class="rbody"><span class="rtitle">${esc(dayLabel(s.date))} · ${esc(s.name)}</span><span class="rmeta ell">${esc(sets.map((y) => setText(id, y).replace(' kg', '')).join(', '))}</span></span>${sets.some((y) => y.pr) ? `<span class="pill bod-pr">${BI.trophy}</span>` : ''}${I.chevR}</button>`; }).join('')}</div>` : ''}
        </div>
        <div class="bod-exsec" data-v="rec" hidden>
          ${best ? `<div class="group">
            <div class="row ic"><span class="tile bod-tile-pr">${BI.trophy}</span><span class="rbody"><span class="rtitle">Best set: ${esc(setText(id, best.set))}</span><span class="rmeta">${esc(dayLabel(best.date))}</span></span></div>
            ${e.kind === 'weight' && best.set.w != null ? `<div class="row ic"><span class="tile">${I.trend}</span><span class="rbody"><span class="rtitle">Estimated max: ${kg(Math.round(e1rm(best.set.w, best.set.r) * 2) / 2)} kg</span><span class="rmeta">From ${esc(setText(id, best.set))}</span></span></div>
            <div class="row ic"><span class="tile">${BI.scale}</span><span class="rbody"><span class="rtitle">Heaviest: ${kg(Math.max(...t.map((x) => x.w ?? 0)))} kg</span><span class="rmeta">Top working set</span></span></div>` : ''}
          </div>` : '<p class="note">No records yet.</p>'}
        </div>`;
      sc.addEventListener('change', (ev) => { if (!ev.target.closest('[data-seg="bod-exseg"]')) return; $$('.bod-exsec', sc).forEach((x) => { x.hidden = x.dataset.v !== ev.detail; }); wireScrub(sc); });
      wireScrub(sc);
      if (!how && e.lib) store.libraryHow(id).then((steps) => { const ol = $('.bod-how', sc); if (ol) ol.innerHTML = steps.length ? steps.map((x) => `<li>${esc(x)}</li>`).join('') : '<li>The steps load when your PC is reachable.</li>'; });
      else if (!how) { const ol = $('.bod-how', sc); if (ol) ol.innerHTML = '<li>No steps saved for this one.</li>'; }
    },
  });
}

// ── targets and goals ─────────────────────────────────────────────────
on('bod-targets', () => {
  const t = B.targets;
  const rows = [['days', 'Training days a week', t.days, 1, 7, 1, ''], ['protein', 'Protein a day', t.protein, 40, 300, 5, 'g'], ['kcal', 'Calories a day', t.kcal, 1200, 4500, 50, 'kcal'], ['water', 'Water a day', t.water, 4, 20, 1, 'glasses']];
  openSheet({ title: 'Targets', sub: `${AGENT.name} plans and nudges against these`, cls: 'bod-sheet', large: true, body: (el) => {
    const draw = () => {
      el.innerHTML = `<div class="group">${rows.map(([k, name, v, , , , u]) => `<div class="row bod-trow"><span class="rbody"><span class="rtitle">${esc(name)}</span><span class="rmeta">${esc(TARGET_SOURCES[k] && v === (B.targets[k]) ? `From ${TARGET_SOURCES[k]}` : '')}</span></span>
        <span class="bod-qty"><button class="btn sm icon" data-tk="${k}" data-d="-1" aria-label="Less">${I.minus}</button><b class="met">${int(B.targets[k])}${u ? `<small> ${u}</small>` : ''}</b><button class="btn sm icon" data-tk="${k}" data-d="1" aria-label="More">${I.plus}</button></span></div>`).join('')}
        <div class="row bod-trow"><span class="rbody"><span class="rtitle">PM protocol due</span></span><span class="bod-qty"><button class="btn sm icon" data-tk="pmDue" data-d="-1" aria-label="Earlier">${I.minus}</button><b class="met">${esc(B.targets.pmDue)}</b><button class="btn sm icon" data-tk="pmDue" data-d="1" aria-label="Later">${I.plus}</button></span></div></div>
        <p class="hint">Saved on this phone at once and synced to your PC.</p>`;
    };
    draw();
    el.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-tk]'); if (!b) return;
      const k = b.dataset.tk, d = Number(b.dataset.d); haptic(4);
      if (k === 'pmDue') { const m = (Number(B.targets.pmDue.slice(0, 2)) * 60 + Number(B.targets.pmDue.slice(3)) + d * 15 + 1440) % 1440; store.setTargets({ pmDue: hm(m) }); }
      else { const r = rows.find((x) => x[0] === k); store.setTargets({ [k]: Math.max(r[3], Math.min(r[4], B.targets[k] + d * r[5])) }); }
      setTimeout(draw, 30);
    });
  } });
});
const LIFTS = [['bench', 'Bench press'], ['squat', 'Back squat'], ['ohp', 'Overhead press'], ['rdl', 'Romanian deadlift'], ['row', 'Barbell row'], ['pulldown', 'Lat pulldown']];
on('bod-goalset', () => {
  const t = B.targets; let ex = t.lift?.ex ?? 'bench'; let goalKg = t.lift?.kg ?? Math.max(20, Math.ceil(((trend('bench').at(-1)?.est ?? 40) + 10) / 5) * 5);
  let wGoal = t.weight?.goal ?? null;
  openSheet({ title: 'Goals', sub: 'A strength goal and a weight goal. Change them any time.', cls: 'bod-sheet', large: true, body: (el) => {
    const draw = () => {
      const est = trend(ex).at(-1)?.est;
      el.innerHTML = `<div class="sh"><h2>Strength</h2></div>
        <div class="pad">${seg('bod-liftseg', LIFTS.slice(0, 4).map(([k, n]) => [k, n.split(' ')[0]]), ex, 'sm')}</div>
        <div class="group"><div class="row bod-trow"><span class="rbody"><span class="rtitle">${esc(exInfo(ex).name)}</span><span class="rmeta">${est ? `Estimated max now ${kg(Math.round(est * 2) / 2)} kg` : 'Not logged yet'}</span></span>
          <span class="bod-qty"><button class="btn sm icon" data-g="-2.5" aria-label="Less">${I.minus}</button><b class="met">${kg(goalKg)}<small> kg</small></b><button class="btn sm icon" data-g="2.5" aria-label="More">${I.plus}</button></span></div></div>
        <div class="bod-cta"><button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-goal-ok">Set ${esc(exInfo(ex).name.toLowerCase())} ${kg(goalKg)} kg</button>${t.lift ? '<button class="btn block" data-act="bod-goal-clear">No strength goal</button>' : ''}</div>
        <div class="sh"><h2>Weight</h2></div>
        <div class="group"><div class="row bod-trow"><span class="rbody"><span class="rtitle">Under</span><span class="rmeta">${t.weight?.by ? `By ${esc(dayShort(t.weight.by))} ${t.weight.by.slice(0, 4)}` : ''}${t.weight?.goal === 95 ? ' · your July 2027 goal' : ''}</span></span>
          <span class="bod-qty"><button class="btn sm icon" data-wg="-1" aria-label="Less">${I.minus}</button><b class="met">${wGoal ?? '—'}<small> kg</small></b><button class="btn sm icon" data-wg="1" aria-label="More">${I.plus}</button></span></div></div>`;
      wireSegs(el);
    };
    draw();
    el.addEventListener('change', (ev) => { if (!ev.target.closest('[data-seg="bod-liftseg"]')) return; ex = ev.detail; draw(); });
    el.addEventListener('click', (ev) => {
      const g = ev.target.closest('[data-g]'); const w = ev.target.closest('[data-wg]');
      if (g) { goalKg = Math.max(5, goalKg + Number(g.dataset.g)); haptic(4); draw(); }
      if (w) { wGoal = Math.max(40, (wGoal ?? Math.round(B.health.weight?.now ?? 90)) + Number(w.dataset.wg)); haptic(4); store.setTargets({ weight: { ...(B.targets.weight ?? {}), goal: wGoal } }); draw(); }
    });
    el._get = () => ({ ex, kg: goalKg });
  } });
});
on('bod-goal-ok', (b) => { const g = $('.sheet-body', b.closest('.sheet'))._get(); store.setTargets({ lift: { ...(B.targets.lift ?? {}), ex: g.ex, kg: g.kg } }); closeSheet(); toast(`Goal: ${exInfo(g.ex).name.toLowerCase()} ${kg(g.kg)} kg`); });
on('bod-goal-clear', () => { store.setTargets({ lift: null }); closeSheet(); });
on('bod-weigh', () => {
  let v = B.health.weight?.now ?? 100;
  openSheet({ title: 'Your weight', sub: 'Today, on your scale', cls: 'bod-sheet', body: (el) => {
    const draw = () => { el.innerHTML = `<div class="bod-step"><button class="bod-step-b" data-k="-0.1" aria-label="Less">${I.minus}</button><p class="bod-step-v"><span class="met">${v.toFixed(1)}</span><small>kg</small></p><button class="bod-step-b" data-k="0.1" aria-label="More">${I.plus}</button></div>
      <div class="chips bod-step-q">${[-1, -0.5, 0.5, 1].map((d) => `<button class="chip sm" data-k="${d}">${d > 0 ? '+' : '−'}${Math.abs(d)}</button>`).join('')}</div>
      <button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-weigh-ok">Save ${v.toFixed(1)} kg</button>`; };
    draw();
    el.addEventListener('click', (ev) => { const k = ev.target.closest('[data-k]'); if (!k) return; v = Math.max(30, Math.round((v + Number(k.dataset.k)) * 10) / 10); haptic(4); draw(); });
    el._get = () => v;
  } });
});
on('bod-weigh-ok', (b) => { const v = $('.sheet-body', b.closest('.sheet'))._get(); store.putReading('weight', v, { source: 'manual', unit: 'kg' }); closeSheet(); toast(`Logged ${v.toFixed(1)} kg`); });

// ── what Wyn can do here ─────────────────────────────────────────────
export function openTools(tools) {
  openSheet({ title: `${AGENT.name} in Body`, sub: 'What she does here on her own, and what she asks first', cls: 'bod-sheet', body: `<div class="group">${tools.map((t) => `
    <div class="row ic"><span class="tile">${t.auto ? I.bolt : I.chat}</span><span class="rbody"><span class="rtitle wrap">${esc(t.does)}</span><span class="rmeta">${t.auto ? 'Does it on her own, then tells you' : 'Asks you first'}</span></span></div>`).join('')}</div>
    <div class="bod-cta"><button class="btn block" data-act="bod-ask">${I.sparkle}Ask ${esc(AGENT.name)} about Body</button></div>` });
}

// shared acts for this module
on('bod-start', (b) => startWorkout(b.dataset.id || undefined));
on('bod-preview', (b) => openPreview(b.dataset.id));
on('bod-ex', (b) => { if (b.closest('.sheet')) closeSheet(); openExercise(b.dataset.id); });
on('bod-demo', (b) => { b.classList.remove('bod-playing'); void b.offsetWidth; b.classList.add('bod-playing'); });
on('bod-finished', (b) => openSummary(b.dataset.id));
nav.openPreview = openPreview; nav.openExercise = openExercise; nav.startWorkout = startWorkout; nav.openSummary = openSummary; nav.tickSet = tickSet; nav.skipRest = skipRest; nav.finish = finish; nav.openPlayer = openPlayer;

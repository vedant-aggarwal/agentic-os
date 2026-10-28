// Body · Log: when he did what. Weekly targets and the streak, the calendar, strength and volume, every session (and the
// days he missed, with the reason he gave), records. Owner: the Body agent.
import { $, $$, esc, push, on, seg, haptic } from '../core.js';
import { I } from '../icons.js';
import { AGENT } from '../data.js';
import { stagger } from '../motion.js';
import { B, EX, TODAY, exInfo, session, sessionVolume, sessionSets, trend, e1rm, upcoming, addDays, weekOf, weekday, dayLabel, dayShort, daysBetween, hm, monthName, dt, relDay } from './body-data.js';
import * as store from './body-store.js';
import { S, nav } from './body-state.js';
import { BI, kg, int, setText, thumb, bodyPair, miniMap, workedBy, lightUp, lineChart, barChart, wyn, wireScrub } from './body-ui.js';
import { weekStreak } from './body-train.js';
import { liveStart } from './body-native.js';

const shortName = (s) => (s.name === 'Cardio + core' ? 'Core' : s.name === 'Active recovery' ? 'Recovery' : s.name === 'Legs + speed' ? 'Legs' : s.name);
const firstDate = () => [...B.sessions, ...B.missed].map((s) => s.date).sort()[0] ?? TODAY;
function weeks() {
  const first = weekOf(firstDate() < addDays(TODAY, -7 * 11) ? addDays(TODAY, -7 * 11) : firstDate()); const out = [];
  for (let w = first; w <= weekOf(TODAY); w = addDays(w, 7)) {
    const ss = B.sessions.filter((s) => weekOf(s.date) === w); const ms = B.missed.filter((s) => weekOf(s.date) === w);
    out.push({ w, ss, ms, days: new Set(ss.map((s) => s.date)).size, vol: ss.reduce((a, s) => a + sessionVolume(s), 0) });
  }
  return out;
}
const wkLabel = (w) => { const a = dt(w), b = dt(addDays(w, 6)); return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${monthName(a.getUTCMonth(), false)}` : `${dayShort(w)} – ${dayShort(addDays(w, 6))}`; };
const wkTick = (w, i) => `${dt(w).getUTCDate()}${i === 0 || dt(w).getUTCDate() <= 7 ? ` ${monthName(dt(w).getUTCMonth(), false)}` : ''}`;

let month = null;   // [year, month 0-11]
let lift = null;
let showAll = false;

export function renderLog(el) {
  const W = weeks(); const streak = weekStreak(); const target = B.targets.days; const total = B.sessions.length;
  const thisW = weekOf(TODAY);
  const [ty, tm] = [Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7)) - 1];
  if (!month) month = [ty, tm];
  const fd = firstDate(); const [fy, fm] = [Number(fd.slice(0, 4)), Number(fd.slice(5, 7)) - 1];
  const lifts = ['bench', 'squat', 'ohp', 'rdl', 'row', 'pulldown', 'incline-db', 'leg-press'].filter((id) => trend(id).length >= 2);
  const mine = [...new Set(B.sessions.flatMap((s) => s.items.map((it) => it.ex)))].filter((id) => !lifts.includes(id) && exInfo(id).kind === 'weight' && trend(id).length >= 2);
  const options = [...lifts, ...mine].slice(0, 4);
  if (!lift || !options.includes(lift)) lift = options[0] ?? null;
  const recIds = Object.keys(B.best).sort((a, b) => String(B.best[b].date).localeCompare(String(B.best[a].date)));
  const plannedLeft = upcoming().filter((p) => weekOf(p.date) === thisW && !W.at(-1).ss.some((s) => s.date === p.date)).length;
  el.innerHTML = `
    <div class="phead asp-head"><div class="asp-head-l"><p class="kicker c-as">Body</p><h1 class="lt">Log</h1>
      <p class="sub">${total ? `${total} ${total === 1 ? 'session' : 'sessions'} since ${esc(dayShort(B.sessions[0].date))}${W.reduce((a, w) => a + w.vol, 0) >= 1000 ? ` · ${Math.round(W.reduce((a, w) => a + w.vol, 0) / 100) / 10} tonnes moved` : ''}` : 'Every session, every set'}</p></div></div>

    <section class="bod-target surface">
      <div class="bod-target-top">
        <div><p class="headline">Weekly target: ${target} days</p><p class="foot">${W.length > 1 ? `Hit ${W.slice(0, -1).filter((w) => w.days >= target).length} of the last ${W.length - 1} weeks` : 'Your first week'}</p></div>
        <span class="bod-streak bod-streak-lg">${BI.flame}<b class="met">${streak}</b><span>week<br>streak</span></span>
      </div>
      ${barChart(W.map((w, i) => ({ label: wkTick(w.w, i), v: w.days, plan: w.w === thisW ? Math.min(plannedLeft, Math.max(0, target - w.days)) : 0, hi: w.w === thisW, off: w.days < target && w.w !== thisW, tip: wkLabel(w.w), tipV: `${w.days} ${w.days === 1 ? 'day' : 'days'}${w.ms.length ? ` · ${w.ms.length} missed` : ''}` })), { h: 128, max: Math.max(target, ...W.map((w) => w.days)) + 1.2, target: { v: target, label: `${target} days` }, title: 'Training days per week' })}
      <p class="foot bod-chart-key"><span class="bod-key-i"><span class="bod-colkey"></span>Days trained</span>${plannedLeft ? '<span class="bod-key-i"><span class="bod-colkey bod-planned"></span>Planned</span>' : ''}<span class="bod-key-i">Under ${target} is dimmed</span></p>
    </section>

    <div class="sh"><h2>${monthName(month[1])}${month[0] !== ty ? ` ${month[0]}` : ''}</h2>
      <span class="bod-month-nav"><button class="btn sm icon" data-act="bod-month" data-d="-1" aria-label="Previous month" ${month[0] * 12 + month[1] <= fy * 12 + fm ? 'disabled' : ''}>${I.chevL}</button><button class="btn sm icon" data-act="bod-month" data-d="1" aria-label="Next month" ${month[0] * 12 + month[1] >= ty * 12 + tm ? 'disabled' : ''}>${I.chevR}</button></span></div>
    ${calendar(month[0], month[1])}

    ${lift ? `<div class="sh"><h2>Strength</h2><span class="sh-count">estimated max</span></div>
    <section class="bod-chartcard surface">
      ${options.length > 1 ? seg('bod-lift', options.map((id) => [id, exInfo(id).name.split(' ')[0]]), lift, 'sm') : ''}
      <div class="bod-lift">${liftChart(lift)}</div>
    </section>` : ''}

    ${W.some((w) => w.vol) ? `<div class="sh"><h2>Volume</h2><span class="sh-count">kg a week</span></div>
    <section class="bod-chartcard surface">
      ${barChart(W.map((w, i) => ({ label: wkTick(w.w, i), v: w.vol / 1000, hi: w.w === thisW, cap: w.w === thisW && w.vol ? `${(w.vol / 1000).toFixed(1)}k` : null, tip: wkLabel(w.w), tipV: `${int(w.vol)} kg` })), { h: 120, fmt: (v) => `${v.toFixed(1)}k`, title: 'Weekly volume in tonnes' })}
      <p class="foot">Volume is weight × reps of every working set.</p>
    </section>` : ''}

    <div class="sh"><h2>Sessions</h2><span class="sh-count">${total}</span></div>
    ${total || B.missed.length ? W.slice().reverse().filter((w) => w.ss.length || w.ms.length).filter((w, i) => showAll || i < 3).map((w) => `
      <p class="bod-wk">${w.w === thisW ? 'This week' : wkLabel(w.w)} <span>${w.days} ${w.days === 1 ? 'day' : 'days'}${w.days >= target ? ` · ${I.check}` : ''}</span></p>
      <div class="group">${[...w.ss, ...w.ms].sort((a, b) => b.date.localeCompare(a.date)).map((s) => (s.status === 'skipped' ? missRow(s) : sessRow(s))).join('')}</div>`).join('')
      : `<p class="note">Nothing logged yet. Finish a workout and it lands here with every set.</p>`}
    ${!showAll && W.filter((w) => w.ss.length || w.ms.length).length > 3 ? `<div class="bod-cta"><button class="btn block" data-act="bod-allsess">Show every week</button></div>` : ''}

    ${recIds.length ? `<div class="sh"><h2>Records</h2><span class="sh-count">best sets</span></div>
    <div class="group">${recIds.slice(0, 12).map((id) => {
      const r = B.best[id]; const e = exInfo(id);
      return `<button class="row ic bod-recrow" data-act="bod-ex" data-id="${esc(id)}">${thumb(id)}<span class="rbody"><span class="rtitle">${esc(e.name)}</span><span class="rmeta">${esc(setText(id, r.set))}${r.kind === 'weight' && r.set.w != null ? ` · est. ${kg(Math.round(e1rm(r.set.w, r.set.r) * 2) / 2)} kg` : ''} · ${esc(dayShort(r.date))}</span></span>${daysBetween(r.date, TODAY) < 7 ? `<span class="pill bod-pr">${BI.trophy}New</span>` : ''}${I.chevR}</button>`; }).join('')}</div>` : ''}`;
  wireScrub(el);
  stagger($$('.bod-cal-c.bod-on', el), { each: 18, y: 4, scale: 0.9 });
  if (!el._seg) {
    el._seg = true;
    el.addEventListener('change', (e) => { if (!e.target.closest('[data-seg="bod-lift"]')) return; lift = e.detail; const box = $('.bod-lift', el); box.innerHTML = liftChart(lift); wireScrub(box); });
  }
}
function sessRow(s) {
  const sets = sessionSets(s), vol = sessionVolume(s);
  return `<button class="row ic bod-srow" data-act="bod-session" data-id="${esc(s.id)}">${miniMap(workedBy(s.items))}
    <span class="rbody"><span class="rtitle">${esc(s.name)}</span><span class="rmeta">${esc([`${weekday(s.date)} ${dt(s.date).getUTCDate()}`, s.at, s.dur ? `${s.dur} min` : null, vol ? `${int(vol)} kg` : sets ? `${sets} sets` : s.items.length ? null : 'sets not logged', s.source === 'health' ? 'Apple Health' : null].filter(Boolean).join(' · '))}</span></span>
    ${s.records?.length ? `<span class="pill bod-pr">${BI.trophy}${s.records.length}</span>` : ''}${I.chevR}</button>`;
}
const missRow = (s) => `<div class="row ic bod-srow bod-missrow"><span class="tile">${I.x}</span><span class="rbody"><span class="rtitle">Missed · ${esc(weekday(s.date))} ${dt(s.date).getUTCDate()}</span><span class="rmeta ell">${esc(s.note || 'No session')}</span></span></div>`;
function liftChart(id) {
  const t = trend(id).filter((x) => x.est); const e = exInfo(id);
  if (t.length < 2) return '<p class="note">Not enough sessions yet.</p>';
  const g = B.targets.lift?.ex === id ? { v: B.targets.lift.kg, label: `Goal ${kg(B.targets.lift.kg)} kg` } : null;
  const vals = t.map((x) => x.est); const step = Math.max(...vals, g?.v ?? 0) - Math.min(...vals) > 24 ? 20 : 10;
  const lo = Math.floor(Math.min(...vals) / step) * step, hi = Math.ceil((Math.max(...vals, g?.v ?? 0) + 1) / step) * step;
  const ticks = []; for (let v = lo; v <= hi; v += step) ticks.push(v);
  const gain = vals[vals.length - 1] - vals[0];
  return `<p class="bod-lift-v"><span class="met">${kg(Math.round(vals[vals.length - 1] * 2) / 2)}</span><small> kg</small><span class="foot"> · ${gain >= 0 ? '+' : ''}${kg(Math.round(gain * 2) / 2)} kg since ${dayShort(t[0].date)}</span></p>
    ${lineChart(t.map((x) => ({ x: daysBetween(t[0].date, x.date), v: x.est, label: `${dayShort(x.date)} · ${kg(x.w)} × ${x.r}` })), { h: 130, min: lo, max: hi, ticks, goal: g, fmt: (v) => `${kg(Math.round(v * 2) / 2)} kg`, tickFmt: (v) => `${v}`,
      xl: [[0, dayShort(t[0].date)], [daysBetween(t[0].date, t[t.length - 1].date), t.at(-1).date === TODAY ? 'Today' : dayShort(t.at(-1).date)]], title: `${e.name} estimated max` })}`;
}
function calendar(y, m) {
  const mm = String(m + 1).padStart(2, '0');
  const first = `${y}-${mm}-01`; const lead = (dt(first).getUTCDay() + 6) % 7;
  const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const plans = upcoming();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="bod-cal-c bod-blank"></span>');
  for (let d = 1; d <= n; d++) {
    const date = `${y}-${mm}-${String(d).padStart(2, '0')}`;
    const ss = B.sessions.filter((s) => s.date === date); const miss = B.missed.find((s) => s.date === date); const plan = plans.find((p) => p.date === date);
    const lbl = ss.length ? (ss.length > 1 ? `${shortName(ss[0])} +${ss.length - 1}` : shortName(ss[0])) : plan ? shortName(plan) : miss ? 'Missed' : '';
    const cls = ss.length ? 'bod-on' : plan ? 'bod-planned' : miss ? 'bod-miss' : date > TODAY ? 'bod-future' : '';
    cells.push(ss.length || plan
      ? `<button class="bod-cal-c ${cls}${date === TODAY ? ' bod-today' : ''}" data-act="${ss.length ? 'bod-session' : 'bod-preview'}" data-id="${esc(ss.length ? ss[ss.length - 1].id : plan.id)}" aria-label="${esc(`${dayLabel(date)}: ${ss.map((s) => s.name).join(' and ') || `${plan.name} planned`}`)}"><b class="met">${d}</b><i>${esc(lbl)}</i></button>`
      : `<span class="bod-cal-c ${cls}${date === TODAY ? ' bod-today' : ''}"${miss ? ` title="${esc(miss.note)}"` : ''}><b class="met">${d}</b>${miss ? `<i>${esc(lbl)}</i>` : ''}</span>`);
  }
  return `<section class="bod-cal surface"><div class="bod-cal-h">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div><div class="bod-cal-g">${cells.join('')}</div></section>`;
}
on('bod-month', (b) => { const v = month[0] * 12 + month[1] + Number(b.dataset.d); month = [Math.floor(v / 12), v % 12]; haptic(5); S.app?.refresh('log'); });
on('bod-allsess', () => { showAll = true; S.app?.refresh('log'); });

// ── one session: stats, the map, records, every set, heart, what Wyn noticed ──
function noteFor(s) {
  if (!s.items.length) return s.note ? `You said: "${s.note}". Sets weren't logged that day, so recovery doesn't count it.` : "Sets weren't logged for this one.";
  if (s.records?.length) return `${s.records.map((r) => `${exInfo(r.ex).name}: ${setText(r.ex, r.set)}`).join(', ')}. ${s.records.length === 1 ? 'That is a record.' : 'Records.'}`;
  const vol = sessionVolume(s); const prev = B.sessions.filter((x) => x.split === s.split && x.startMs < s.startMs).at(-1);
  if (prev && vol && sessionVolume(prev)) { const d = vol - sessionVolume(prev); return `${d >= 0 ? '+' : ''}${int(d)} kg of volume on your last ${s.name.toLowerCase()} (${dayShort(prev.date)}).`; }
  return s.items.some((it) => it.kind === 'cardio') ? 'Easy cardio. Nothing here slows your recovery for the next lift.' : 'Logged. The next one of these is the one to beat.';
}
export function openSession(id) {
  const s = session(id); if (!s) return;
  if (s.status === 'planned') { nav.openPreview?.(id); return; }
  const f = workedBy(s.items); const vol = sessionVolume(s); const cardio = s.items.find((it) => it.kind === 'cardio');
  push({
    title: s.name, back: 'Back', aspect: 'body', cls: 'bod-page',
    render(sc) {
      sc.innerHTML = `
        <div class="phead"><p class="kicker c-as">${esc(dayLabel(s.date))}${s.at ? ` · ${esc(s.at)}${s.dur ? `–${hm((Number(s.at.slice(0, 2)) * 60 + Number(s.at.slice(3)) + s.dur))}` : ''}` : ''}</p><h1 class="lt">${esc(s.name)}</h1>
          <p class="sub">${esc([s.where, s.plan_by === 'wyn' ? `planned by ${AGENT.name}` : null, s.source === 'health' ? 'from Apple Health' : s.source === 'wyn' ? `logged by ${AGENT.name}` : null].filter(Boolean).join(' · ') || relDay(s.date))}</p></div>
        <div class="bod-stats">
          <div class="bod-stat surface"><span class="met">${s.dur ?? '—'}</span><small>Minutes</small></div>
          <div class="bod-stat surface"><span class="met">${vol ? int(vol) : cardio ? (cardio.sets[0]?.km ?? '—') : '—'}</span><small>${vol ? 'kg moved' : 'km'}</small></div>
          <div class="bod-stat surface"><span class="met">${sessionSets(s)}</span><small>Sets</small></div>
          <div class="bod-stat surface"><span class="met">${s.bpm ?? s.kcal ?? '—'}</span><small>${s.bpm ? 'Avg bpm' : 'kcal'}</small></div>
        </div>
        ${s.items.length ? `<div class="bod-sum-map surface">${bodyPair(f, { label: `${s.name} worked` })}</div>` : ''}
        ${s.records?.length ? `<div class="sh"><h2>Records</h2></div><div class="group">${s.records.map((r) => `<button class="row ic" data-act="bod-ex" data-id="${esc(r.ex)}"><span class="tile bod-tile-pr">${BI.trophy}</span><span class="rbody"><span class="rtitle">${esc(exInfo(r.ex).name)}: ${esc(setText(r.ex, r.set))}</span><span class="rmeta">Was ${esc(setText(r.ex, r.was))}</span></span>${I.chevR}</button>`).join('')}</div>` : ''}
        ${s.items.length ? `<div class="sh"><h2>Exercises</h2><span class="sh-count">${s.items.length}</span></div>
        ${s.items.map((it) => `<div class="group bod-sx">
          <button class="row ic bod-sx-h" data-act="bod-ex" data-id="${esc(it.ex)}">${thumb(it.ex)}<span class="rbody"><span class="rtitle">${esc(it.name)}</span><span class="rmeta">${esc(exInfo(it.ex, it).equip ?? '')}</span></span>${I.chevR}</button>
          ${it.sets.map((x, j) => `<div class="row bod-sx-r${x.warm ? ' bod-warm' : ''}${x.pr ? ' bod-rec' : ''}"><span class="bod-set-n met">${x.warm ? 'W' : x.single ? '1RM' : it.sets.filter((y, k) => !y.warm && k <= j).length}</span><span class="rbody">${esc(setText(it.ex, { ...x, kind: it.kind }))}${x.rpe ? ` · RPE ${x.rpe}` : ''}${x.incline ? ` · ${x.incline}% incline` : ''}</span>${x.pr ? `<span class="pill bod-pr">${BI.trophy}Record</span>` : x.warm ? '<span class="foot">Warm-up</span>' : ''}</div>`).join('')}
        </div>`).join('')}` : ''}
        ${s.zones ? `<div class="sh"><h2>Heart rate</h2><span class="sh-count">Apple Watch${s.bpm ? ` · avg ${s.bpm}` : ''}</span></div>
        <section class="bod-zones surface">${s.zones.map((m, i) => `<div class="bod-zone"><span>Zone ${i + 1}</span><span class="bar" style="--p:${Math.round(m / Math.max(...s.zones) * 100)}%;--c:var(--as)"><i></i></span><b class="met">${m}<small> min</small></b></div>`).join('')}</section>` : ''}
        ${wyn(esc(noteFor(s)))}
        ${s.items.length ? `<div class="bod-cta"><button class="btn block" data-act="bod-repeat" data-id="${esc(s.id)}">${I.rewind}Repeat this workout</button></div>` : ''}`;
      lightUp(sc, 220);
    },
  });
}
on('bod-session', (b) => openSession(b.dataset.id));
on('bod-repeat', (b) => {
  const s = session(b.dataset.id); if (!s) return;
  const plan = { id: `repeat-${s.id}`, date: TODAY, name: s.name, split: s.split, plan_by: 'him', why: `A repeat of ${dayLabel(s.date)}.`, reasons: [`The same exercises and weights as ${dayLabel(s.date)}.`],
    items: s.items.map((it) => { const w = it.sets.filter((x) => !x.warm && !x.single); const l = w[w.length - 1] ?? {}; const { done, pr, prNote, at, ...target } = l; return { ex: it.ex, name: it.name, kind: it.kind, p: it.p, s: it.s, target, sets: w.length || 1, note: exInfo(it.ex).cue ?? '' }; }) };
  if (B.live) { nav.openPlayer?.(); return; }
  const doc = store.startLive(plan); B.live = { ...JSON.parse(JSON.stringify(doc)), _local: true };
  nav.openPlayer?.(); liveStart(B.live);
});
nav.openSession = openSession;

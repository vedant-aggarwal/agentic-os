// Body · Recovery: the muscle map from his logged sets, readiness from Apple Health (or what he typed) plus training
// load, the readiness graph, sleep, heart, every muscle. Without Health data it says so and shows what it can.
// Owner: the Body agent.
import { $, $$, esc, on, openSheet, closeSheet, toast, haptic } from '../core.js';
import { I } from '../icons.js';
import { AGENT, DEMO_MODE } from '../data.js';
import { stagger } from '../motion.js';
import { B, MUSCLES, TODAY, fatigueAt, readyIn, recoveryCurve, readinessHistory, addDays, dayShort, weekday, hm, daysBetween, nowMs, relDay } from './body-data.js';
import * as store from './body-store.js';
import { S, nav, refresh } from './body-state.js';
import { BI, bodyPair, lightUp, lineChart, hypnogram, spark, wyn, wireScrub, hmLen, lit } from './body-ui.js';
import { healthState, connectHealth, syncHealth } from './body-native.js';

export const liveFatigue = () => fatigueAt(0);
const word = (pct) => (pct >= 90 ? 'Fresh' : pct >= 70 ? 'Ready' : pct >= 35 ? 'Recovering' : 'Just worked');
const readyText = (m) => {
  const h = readyIn(m); if (h === 0) return 'Ready now';
  const t = nowMs() + h * 36e5; const d = new Date(t + 330 * 60000); const day = d.toISOString().slice(0, 10);
  return `Ready ${day === TODAY ? (d.getUTCHours() >= 17 ? 'tonight' : 'today') : day === addDays(TODAY, 1) ? 'tomorrow' : weekday(day)} ~${String(d.getUTCHours()).padStart(2, '0')}:00`;
};
const lastHit = (m) => {
  const s = [...B.sessions].reverse().find((x) => x.items.some((it) => (it.p ?? []).includes(m)));
  return s ? `${s.name}, ${relDay(s.date).toLowerCase()}` : 'Not in the last weeks';
};
const istOf = (iso) => new Date(Date.parse(iso) + 330 * 60000).toISOString();
const syncedText = () => { const s = B.healthConn?.synced_at ?? B.health.synced; if (!s || Number.isNaN(Date.parse(s))) return ''; const t = istOf(s); return t.slice(0, 10) === TODAY ? `synced ${t.slice(11, 16)}` : `synced ${dayShort(t.slice(0, 10))}`; };

export function renderRecovery(el) {
  const f = liveFatigue(); const H = B.health;
  const rows = Object.keys(MUSCLES).map((m) => ({ m, pct: Math.round((1 - f[m]) * 100) })).sort((a, b) => a.pct - b.pct);
  const recovering = rows.filter((r) => r.pct < 70); const fresh = rows.filter((r) => r.pct >= 90);
  const hist = readinessHistory(14);
  const known = hist.map((x, i) => ({ ...x, i })).filter((x) => x.v != null);
  const showHist = known.length >= 2;
  const sl = H.sleep;
  el.innerHTML = `
    <div class="phead asp-head"><div class="asp-head-l"><p class="kicker c-as">Body</p><h1 class="lt">Recovery</h1>
      <p class="sub">Readiness ${H.score ?? '—'} · ${H.partial ? 'from your training only' : `from Apple Health${syncedText() ? `, ${syncedText()}` : ''}`}</p></div></div>

    <section class="bod-map surface" aria-label="Muscle recovery map">
      ${bodyPair(f, { tap: true, label: 'Muscle recovery' })}
      <div class="bod-legend" aria-hidden="true"><span>Fresh</span><span class="bod-ramp">${[0, 0.15, 0.32, 0.48, 0.62].map((v) => `<i style="--bod-f:${lit(v)}"></i>`).join('')}</span><span>Just worked</span></div>
      <div class="bod-map-sum">
        <p><b>Recovering</b> ${recovering.length ? recovering.map((r) => `<button class="bod-mchip" data-act="bod-muscle" data-m="${r.m}">${esc(MUSCLES[r.m].name)} <span class="met">${r.pct}%</span></button>`).join('') : '<span class="foot">Nothing. Everything is ready.</span>'}</p>
        <p class="foot">${B.sessions.length ? `Fresh: ${esc(fresh.map((r) => MUSCLES[r.m].name.toLowerCase()).slice(0, 6).join(', '))}${fresh.length > 6 ? ' and more' : ''}. Tap a muscle for when it's ready.` : 'The map fills in from the sets you log.'}</p>
      </div>
    </section>

    <div class="sh"><h2>Readiness</h2><button class="sh-act" data-act="bod-health">Apple Health ${I.chevR}</button></div>
    <section class="bod-ready surface">
      <div class="bod-ready-top">
        <p class="bod-ready-v"><span class="met">${H.score ?? '—'}</span><span class="bod-ready-w">${esc(H.partial ? 'No sleep or heart data yet' : H.word)}</span></p>
        <p class="foot">${esc(readyLine(H))}</p>
      </div>
      <div class="bod-contrib">${H.parts.map((p) => `
        <button class="bod-cb" data-act="bod-metric" data-k="${p.k}">
          <span class="bod-cb-n">${esc(p.name)}</span><span class="bod-cb-v met">${esc(p.v)}</span>
          <span class="bar bod-cb-bar" style="--p:${Math.round(Math.min(1, p.p) * 100)}%;--c:${p.word === 'Pay attention' ? 'var(--needs)' : 'var(--as)'}"><i></i></span>
          <span class="bod-cb-m"><span class="${p.word === 'Pay attention' ? 'c-needs' : ''}">${esc(p.word)}</span> · ${esc(p.note)}</span>
        </button>`).join('')}</div>
      ${H.partial ? `<div class="bod-ready-more">${wyn(`Sleep and heart make this real. ${DEMO_MODE ? '' : 'Connect Apple Health in the iPhone app, or add last night here.'}`, 'bod-flat')}
        <div class="bod-plan-acts"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="bod-health">${BI.heart}Connect Apple Health</button><button class="btn sm" data-act="bod-reading" data-k="sleep">${BI.moon}Add last night</button></div></div>` : ''}
    </section>

    ${showHist ? `<div class="sh"><h2>Readiness, last 14 days</h2></div>
    <div class="bod-chartcard surface">
      ${lineChart(known.map((x) => ({ x: x.i, v: x.v, label: dayShort(x.d) })), {
        h: 140, min: 0, max: 100, ticks: [0, 50, 100], fmt: (v) => `${Math.round(v)}`,
        marks: known.map((x) => ({ x: x.i, v: x.v, d: x.d })).filter((p) => B.sessions.some((s) => s.date === p.d)),
        xl: [[known[0].i, dayShort(known[0].d)], [13, 'Today']], title: 'Readiness over 14 days' })}
      <p class="foot bod-chart-key"><span class="bod-dotkey"></span>Training days.${known.length < 14 ? ` ${14 - known.length} of the 14 days had no sleep or heart data.` : ''}</p>
    </div>` : ''}

    <div class="sh"><h2>Last night</h2>${sl?.from != null ? `<span class="sh-count">${hm(sl.from)}–${hm(sl.to)}</span>` : ''}</div>
    ${sl ? `<section class="bod-sleep surface">
      <div class="bod-sleep-top">
        <p><span class="met bod-sleep-v">${Math.floor(sl.asleep / 60)}<small>h</small> ${sl.asleep % 60}<small>m</small></span><span class="foot"> asleep${sl.inBed > sl.asleep ? ` · ${sl.inBed - sl.asleep} min awake` : ''}${sl.date !== TODAY ? ` · ${esc(relDay(sl.date).toLowerCase())}` : ''}</span></p>
        ${sl.week?.length > 2 ? `<span class="bod-sleep-wk">${spark(sl.week, { w: 84, h: 28 })}<small>Last ${sl.week.length} nights</small></span>` : ''}
      </div>
      ${sl.stages?.length ? hypnogram(sl.stages, sl.from ?? 0) : ''}
      ${wyn(sleepLine(sl))}
    </section>` : `<div class="group"><button class="row ic" data-act="bod-reading" data-k="sleep"><span class="tile">${BI.moon}</span><span class="rbody"><span class="rtitle">No sleep for last night</span><span class="rmeta">Apple Health sends it, or add it here</span></span><span class="btn sm icon" aria-hidden="true">${I.plus}</span></button></div>`}

    ${H.hrv || H.rhr || H.vo2 ? `<div class="sh"><h2>Heart</h2><span class="sh-count">${H.hrv?.source === 'manual' ? 'Added by you' : 'Apple Watch'}</span></div>
    <div class="bod-heart">
      ${H.hrv ? `<button class="bod-hm surface" data-act="bod-metric" data-k="hrv"><span class="bod-hm-k">HRV</span><span class="met bod-hm-v">${H.hrv.now ?? '—'}<small>ms</small></span>${H.hrv.week.length > 1 ? spark(H.hrv.week) : ''}</button>` : ''}
      ${H.rhr ? `<button class="bod-hm surface" data-act="bod-metric" data-k="rhr"><span class="bod-hm-k">Resting</span><span class="met bod-hm-v">${H.rhr.now ?? '—'}<small>bpm</small></span>${H.rhr.week.length > 1 ? spark(H.rhr.week) : ''}</button>` : ''}
      ${H.vo2 ? `<button class="bod-hm surface" data-act="bod-metric" data-k="vo2"><span class="bod-hm-k">VO₂ max</span><span class="met bod-hm-v">${H.vo2.now}</span>${H.vo2.week.length > 1 ? spark(H.vo2.week) : ''}</button>` : ''}
    </div>` : ''}

    <div class="sh"><h2>Every muscle</h2><span class="sh-count">${rows.length}</span></div>
    <div class="group bod-mlist">${rows.map((r) => `
      <button class="row bod-mrow" data-act="bod-muscle" data-m="${r.m}">
        <span class="rbody"><span class="rtitle">${esc(MUSCLES[r.m].name)}</span><span class="rmeta">${esc(r.pct >= 70 ? lastHit(r.m) : readyText(r.m))}</span></span>
        <span class="bod-mbar"><span class="bar" style="--p:${r.pct}%;--c:var(--as)"><i></i></span><b class="met">${r.pct}%</b></span>${I.chevR}
      </button>`).join('')}</div>
    <p class="hint">Recovery comes from the sets you log: each one tires its muscles, which recover over three to four days. Cardio from Apple Health counts too.</p>`;
  wireScrub(el);
  $$('.bod-pair.bod-pair-tap .bod-m', el).forEach((p) => { p.setAttribute('role', 'button'); });
  if (!el._tap) { el.addEventListener('click', onMapTap); el._tap = true; }
  stagger($$('.bod-cb', el), { each: 40, y: 8, delay: 120 });
}
function readyLine(H) {
  if (H.partial) return B.sessions.length ? 'Only your training feeds this today: no sleep or heart data yet.' : 'Log a workout or connect Apple Health and this fills in.';
  const bad = H.parts.filter((p) => p.word === 'Pay attention').map((p) => p.name.toLowerCase());
  const good = H.parts.filter((p) => p.word === 'Good' && (p.k === 'hrv' || p.k === 'rhr')).length;
  if (!bad.length) return good ? 'Heart and sleep both say yes. Train as planned.' : 'Nothing holding you back today.';
  return `${good ? 'Heart says yes, ' : ''}${bad.join(' and ')} ${bad.length > 1 ? 'say' : 'says'} take it a little easier.`;
}
function sleepLine(sl) {
  const short = sl.goal - sl.asleep;
  const bed = B.targets.pmDue;
  return short > 30 ? `${hmLen(short)} short of your ${hmLen(sl.goal)} goal. Lights out ${hmLen(sl.goal)} before you need to wake, and your readiness follows.` : `Enough sleep last night. Same time tonight keeps it there; your PM protocol is due by ${esc(bed)}.`;
}
function onMapTap(e) { const m = e.target.closest?.('.bod-pair.bod-pair-tap .bod-m'); if (!m) return; haptic(6); openMuscle(m.dataset.m); }
// a muscle: its recovery over the last week, the forecast, what hit it, and the manual override
export function openMuscle(m) {
  const f = liveFatigue(); const pct = Math.round((1 - f[m]) * 100);
  const pts = recoveryCurve(m, { lookback: 144, ahead: 72, step: 3 });
  const past = pts.filter((p) => p.h <= 0), ahead = pts.filter((p) => p.h >= 0);
  const hits = [...B.sessions].reverse().filter((s) => s.items.some((it) => (it.p ?? []).includes(m) || (it.s ?? []).includes(m))).slice(0, 3);
  const marked = !!B.fresh[m];
  openSheet({
    title: MUSCLES[m].name, sub: `${pct}% recovered · ${word(pct).toLowerCase()}`, cls: 'bod-sheet bod-msheet', large: false,
    body: (el) => {
      el.innerHTML = `
        <div class="bod-msheet-top">${bodyPair(f, { cls: 'bod-pair-xs', hot: m, label: MUSCLES[m].name })}
          <div><p class="bod-ready-v"><span class="met">${pct}%</span></p><p class="headline">${esc(readyText(m))}</p><p class="foot">Last hard work: ${esc(lastHit(m))}</p></div></div>
        <div class="bod-chartcard bod-inlay">
          ${lineChart(past.map((p) => ({ x: p.h, v: p.v, label: p.h === 0 ? 'Now' : `${Math.round(-p.h / 24)} d ago` })), {
            h: 120, min: 0, max: 100, ticks: [0, 50, 100], ahead: ahead.slice(1).map((p) => ({ x: p.h, v: p.v })), fmt: (v) => `${Math.round(v)}%`,
            xl: [[-144, '6 days ago'], [0, 'Now'], [72, '+3 days']], title: `${MUSCLES[m].name} recovery` })}
          <p class="foot bod-chart-key"><span class="bod-dashkey"></span>Forecast if you rest it</p>
        </div>
        <div class="sh"><h2>What hit it</h2></div>
        <div class="group">${hits.map((s) => `<button class="row" data-act="bod-session" data-id="${esc(s.id)}"><span class="rbody"><span class="rtitle">${esc(s.name)} · ${esc(weekday(s.date, true))} ${dayShort(s.date)}</span><span class="rmeta ell">${esc(s.items.filter((it) => (it.p ?? []).includes(m) || (it.s ?? []).includes(m)).map((it) => it.name).join(', '))}</span></span>${I.chevR}</button>`).join('') || '<p class="note">Nothing in the last weeks.</p>'}</div>
        <div class="bod-cta">${marked ? `<button class="btn block" data-act="bod-unfresh" data-m="${m}">Use the logged recovery again</button>` : pct < 90 ? `<button class="btn block" data-act="bod-fresh" data-m="${m}">It feels fresh: mark as recovered</button>` : ''}
          <p class="foot bod-cta-note">${esc(AGENT.name)} plans the next session from this. A muscle under 70% stays out of heavy work.</p></div>`;
      wireScrub(el);
    },
  });
}
on('bod-muscle', (b) => { if (b.closest('.sheet')) closeSheet(); openMuscle(b.dataset.m); });
on('bod-fresh', (b) => { const m = b.dataset.m; store.markFresh(m, true); closeSheet(); toast(`${MUSCLES[m].name} marked fresh. ${AGENT.name} will plan with it`, () => store.markFresh(m, false)); });
on('bod-unfresh', (b) => { store.markFresh(b.dataset.m, false); closeSheet(); });

// one metric over its last two weeks, with what it means
const SERIES = { hrv: ['Heart rate variability', 'ms', 'Higher than your normal means your nervous system has recovered.'], rhr: ['Resting heart rate', 'bpm', 'Lower than normal is good. A jump of 5 bpm or more usually means poor sleep, stress or a cold coming.'],
  vo2: ['VO₂ max', 'ml/kg/min', 'Your cardio fitness, estimated by the Watch on outdoor walks and runs. Zone 2 work moves it.'], sleep: ['Sleep', 'h', 'Short sleep shows in readiness and on your face the next morning.'],
  weight: ['Weight', 'kg', 'Weigh in the morning, after the bathroom, before food, so days compare.'], steps: ['Steps', '', 'Everyday movement. It counts toward recovery more than it costs.'] };
on('bod-metric', (b) => {
  const k = b.dataset.k;
  if (k === 'load' || k === 'muscle') { const p = B.health.parts.find((x) => x.k === k); if (!p) return; openSheet({ title: p.name, sub: `${p.v} · ${p.word}`, cls: 'bod-sheet', body: `<p class="bod-sheet-p">${esc(p.note)}.</p><p class="bod-sheet-p">${k === 'load' ? 'Your last 7 days of sets against your weekly average for the last four weeks. Steady means you add work at a pace your body handles.' : 'Muscles under 70% recovered stay out of heavy work in the next plan.'}</p>` }); return; }
  const def = SERIES[k]; if (!def) return;
  const rows = B.readings.filter((r) => r.kind === k && r.date >= addDays(TODAY, k === 'weight' ? -365 : -13)).sort((a, b2) => a.date.localeCompare(b2.date));
  const vals = rows.map((r) => (k === 'sleep' ? Math.round(Number(r.value) / 6) / 10 : Number(r.value)));
  openSheet({ title: def[0], sub: rows.length ? `Last: ${vals.at(-1)}${def[1] ? ` ${def[1]}` : ''} · ${relDay(rows.at(-1).date).toLowerCase()} · ${rows.at(-1).source === 'health' ? 'Apple Health' : rows.at(-1).source === 'manual' ? 'added by you' : rows.at(-1).source}` : 'No readings yet', cls: 'bod-sheet', body: (el) => {
    el.innerHTML = `${vals.length > 1 ? `<div class="bod-chartcard bod-inlay">${lineChart(rows.map((r, i) => ({ x: daysBetween(rows[0].date, r.date), v: vals[i], label: dayShort(r.date) })), { h: 120, fmt: (v) => `${Math.round(v * 10) / 10}${def[1] ? ` ${def[1]}` : ''}`, xl: [[0, dayShort(rows[0].date)], [daysBetween(rows[0].date, rows.at(-1).date), dayShort(rows.at(-1).date)]], title: def[0] })}</div>` : ''}
      <p class="bod-sheet-p">${esc(def[2])}</p>
      ${['sleep', 'hrv', 'rhr', 'weight', 'steps'].includes(k) ? `<div class="bod-cta"><button class="btn block" data-act="bod-reading" data-k="${k}">${I.plus}Add a reading</button></div>` : ''}`;
    wireScrub(el);
  } });
});

// a reading by hand: the web's stand-in for Apple Health, and for when the Watch wasn't on
const MANUAL = { sleep: ['Last night', 'hours asleep', 6.5, 0.25, 0, 14], hrv: ['HRV', 'ms', 55, 1, 5, 250], rhr: ['Resting heart rate', 'bpm', 62, 1, 30, 120], weight: ['Weight', 'kg', 100, 0.1, 30, 250], steps: ['Steps today', 'steps', 6000, 500, 0, 60000] };
on('bod-reading', (b) => {
  const k = b.dataset.k; const def = MANUAL[k]; if (!def) return;
  if (b.closest('.sheet')) closeSheet();
  const cur = B.readings.filter((r) => r.kind === k).sort((a, c) => a.date.localeCompare(c.date)).at(-1);
  let v = cur ? (k === 'sleep' ? Math.round(Number(cur.value) / 15) / 4 : Number(cur.value)) : def[2];
  setTimeout(() => openSheet({ title: def[0], sub: k === 'sleep' ? `For the night into ${relDay(TODAY).toLowerCase()}` : 'Today', cls: 'bod-sheet', body: (el) => {
    const draw = () => { el.innerHTML = `<div class="bod-step"><button class="bod-step-b" data-k="-1" aria-label="Less">${I.minus}</button><p class="bod-step-v"><span class="met">${k === 'weight' ? v.toFixed(1) : k === 'sleep' ? v.toFixed(2).replace(/0$/, '') : Math.round(v)}</span><small>${def[1]}</small></p><button class="bod-step-b" data-k="1" aria-label="More">${I.plus}</button></div>
      <button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-reading-ok" data-k="${k}">Save</button>`; };
    draw();
    el.addEventListener('click', (ev) => { const x = ev.target.closest('[data-k]'); if (!x || x.dataset.act) return; v = Math.max(def[4], Math.min(def[5], Math.round((v + Number(x.dataset.k) * def[3]) * 100) / 100)); haptic(4); draw(); });
    el._get = () => v;
  } }), 60);
});
on('bod-reading-ok', (b) => {
  const k = b.dataset.k; const v = $('.sheet-body', b.closest('.sheet'))._get();
  if (k === 'sleep') store.putReading('sleep', Math.round(v * 60), { source: 'manual', inBed: Math.round(v * 60), unit: 'min' });
  else store.putReading(k, v, { source: 'manual' });
  closeSheet(); haptic(10); toast(`Saved. Readiness has it`);
});

// Apple Health: what Body reads (HealthKit is read-only in this build), the connection, Sync now
on('bod-health', async () => {
  const st = await healthState();
  const READS = ['Steps', 'Sleep', 'Workouts', 'Active energy', 'Resting heart rate', 'Heart rate variability', 'Body weight'];
  openSheet({ title: 'Apple Health', sub: st.available ? (st.connected ? `Connected${syncedText() ? ` · ${syncedText()}` : ''}` : 'Not connected yet') : 'In the iPhone app', cls: 'bod-sheet', large: true, body: `
    <div class="bod-ah-top">${BI.heart}<p class="foot">${st.available ? 'Body reads what your iPhone and Apple Watch measure, so readiness and recovery use your real sleep, heart and workouts. Nothing is written back.' : DEMO_MODE ? 'Sample data in demo mode.' : 'Apple Health is on the iPhone. In the app it reads your sleep, heart and workouts; here you can add readings by hand.'}</p></div>
    <div class="sh"><h2>Reads</h2></div>
    <div class="group">${READS.map((n) => `<div class="row"><span class="rbody"><span class="rtitle">${esc(n)}</span></span>${st.connected ? `<span class="check done" aria-label="On">${I.check}</span>` : ''}</div>`).join('')}</div>
    <div class="bod-cta">${st.available ? (st.connected ? `<button class="btn block" data-act="bod-sync">${I.sync}Sync now</button>` : `<button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-connect">${BI.heart}Connect Apple Health</button>`) : ''}</div>
    <div class="sh"><h2>Add by hand</h2></div>
    <div class="group">${Object.entries(MANUAL).map(([k, d]) => `<button class="row" data-act="bod-reading" data-k="${k}"><span class="rbody"><span class="rtitle">${esc(d[0])}</span><span class="rmeta">${esc(d[1])}</span></span><span class="btn sm icon" aria-hidden="true">${I.plus}</span></button>`).join('')}</div>` });
});
on('bod-connect', async (b) => { b.innerHTML = '<span class="spin"></span>Asking'; const r = await connectHealth(); closeSheet(); toast(r.ok ? `Apple Health connected: ${r.wrote ?? 0} readings in` : r.reason === 'denied' ? 'Apple Health said no. Settings → Health → Data Access' : 'Apple Health isn\'t available on this phone'); });
on('bod-sync', async (b) => { b.innerHTML = '<span class="spin"></span>Syncing'; const r = await syncHealth({ force: true }); b.innerHTML = `${I.check}Synced just now`; toast(r.ok ? `Apple Health: ${r.wrote ? `${r.wrote} new readings` : 'nothing new'}` : 'Apple Health didn\'t answer'); });

export function onRecoveryShown(el) { lightUp(el, 140); syncHealth().catch(() => {}); }
nav.openMuscle = openMuscle;

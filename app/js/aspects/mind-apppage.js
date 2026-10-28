// Mind · one app's page: today's visits on the day's line, when it usually pulls him (by the hour), what its
// time was for (from the check-ins), how Wyn files it (he can change that), and the way to Soul's blocker.
// Owner: the Mind agent. Prefix min-.
import { esc, push, on, haptic, toast } from '../core.js';
import { I } from '../icons.js';
import { AGENT } from '../data.js';
import { app, appMin, fmt, hm, HOURS, USUAL_APP, WEEK_APP, FOR_WEEK, blockFor, appFor, kindName, S, labelOf, KINDS, REAL, nowMin, saveAppRule, derive } from './mind-data.js';
import { appTile, meter, weekBars, growIn, refreshMind } from './mind-ui.js';

export function openAppPage(id) {
  const x = app(id); if (!x) return;
  const page = push({ title: x.name, back: 'Mind', aspect: 'mind', cls: 'min-ap', render(sc) { sc.innerHTML = html(x); growIn(sc); } });
  page._redraw = () => { const sc = page.querySelector('.scroll'); const y = app(id) ?? x; sc.innerHTML = html(y); };
}

const SRC = { pc: 'on your PC', manual: 'from what you told Wyn', both: 'PC and phone', phone: 'on your phone', screentime: 'from Screen Time' };
function html(x) {
  const today = appMin(x);
  const usual = USUAL_APP[x.id];
  const weekA = WEEK_APP[x.id];
  const ses = x.sessions ?? [];
  const longest = ses.length ? Math.max(...ses.map((s) => s[1])) : 0;
  const lsess = ses.find((s) => s[1] === longest);
  const n = nowMin();
  const a0 = Math.min(6 * 60, ...ses.map((s) => s[0])), span = 24 * 60 - a0;
  const ans = S.checkin.done && S.checkin.answers?.[x.id];
  const forWeek = FOR_WEEK[x.id];
  const peak = usual ? Object.entries(usual).sort((a, b) => b[1] - a[1])[0] : null;
  const prof = usual ? HOURS.map((h) => [String(h).padStart(2, '0'), usual[h] ?? 0, { hideV: true, today: peak && Number(peak[0]) === h, cls: h === Math.floor(n / 60) ? 'now' : '' }]) : null;
  const note = !REAL ? (x.id === 'instagram' ? 'The evening is the big one: 34 minutes between 18:00 and 19:00, right before cardio. The metro rides come next.' : x.id === 'youtube' ? 'Mostly the ride back from college, then a little before bed.' : 'Short visits all day; the college break at 11:30 is the longest.')
    : peak && peak[1] ? `The biggest hour is ${String(peak[0]).padStart(2, '0')}:00, about ${fmt(peak[1])} on a usual day.` : '';
  const stats = REAL
    ? `<span><b class="met">${ses.length}</b><small>${ses.length === 1 ? 'sitting' : 'sittings'}</small></span><span><b class="met">${longest ? fmt(longest) : '–'}</b><small>${lsess ? `longest, at ${hm(lsess[0])}` : 'longest'}</small></span><span><b class="met">${esc(kindName(x.kind))}</b><small>how it counts</small></span>`
    : `<span><b class="met">${x.pickups}</b><small>pickups</small></span><span><b class="met">${x.notifs}</b><small>notifications</small></span><span><b class="met">${fmt(longest)}</b><small>longest, at ${hm(lsess[0])}</small></span>`;
  return `
    <div class="phead min-aph">${appTile(x, 'xl')}
      <div><p class="kicker c-as">Screen time${REAL && SRC[x.source] ? ` · ${SRC[x.source]}` : ''}</p><h1 class="lt">${esc(x.name)}</h1>
      <p class="sub">${fmt(today)} today${weekA ? ` · ${fmt(weekA)} a day this week` : ''}</p></div></div>

    <section class="surface min-card">
      <p class="mh-k">Today, ${ses.length} ${ses.length === 1 ? 'visit' : 'visits'}</p>
      <div class="cc-tl big" aria-hidden="true"><span class="cc-tlb">${ses.map(([t, m]) => `<i style="--x:${((t - a0) / span).toFixed(4)};--w:${(Math.max(m, 2) / span).toFixed(4)}"></i>`).join('')}<span class="cc-tlnow" style="--x:${((n - a0) / span).toFixed(4)}"></span></span>
        <span class="cc-tlx"><span>${hm(a0)}</span><span>12:00</span><span>18:00</span><span>24:00</span></span></div>
      <div class="min-stats three">${stats}</div>
    </section>

    ${prof ? `<div class="sh"><h2>When it pulls you</h2><span class="sh-count">a usual day</span></div>
    <section class="surface min-card">${weekBars(prof, { max: Math.max(40, ...prof.map((p) => p[1])), unit: fmt, cls: 'hours', label: `${x.name} by the hour on a usual day` })}
      ${note ? `<p class="min-cnote">${esc(note)}</p>` : ''}</section>` : ''}

    <div class="sh"><h2>What it was for</h2><span class="sh-count">${ans ? 'today' : forWeek ? 'this week' : `how ${esc(AGENT.name)} files it`}</span></div>
    ${ans ? `<div class="group surface min-kg">${ans.map(([l, m]) => `<div class="row min-kr"><span class="rbody"><span class="min-aprt"><span class="rtitle">${esc(labelOf(x.id, l)?.name ?? l)}</span><b class="met">${fmt(m)}</b></span>${meter(m / Math.max(1, today), 'sm')}</span></div>`).join('')}</div>`
      : forWeek ? `<div class="group surface min-kg">${forWeek.map(([nm, p]) => `<div class="row min-kr"><span class="rbody"><span class="min-aprt"><span class="rtitle">${esc(nm)}</span><b class="met">${p}%</b></span>${meter(p / 100, 'sm')}</span></div>`).join('')}</div>
        <p class="hint">From this week’s check-ins. Tonight’s answer about today’s ${fmt(today)} joins it.</p>`
      : `<p class="note surface">${esc(appFor(x))}.${blockFor(x.id) ? ` ${esc(AGENT.name)} can’t tell what it was for on her own, so she asks tonight.` : ` ${esc(AGENT.name)} files it as ${kindName(x.kind).toLowerCase()} on her own; change it below if that’s wrong.`}</p>`}

    ${REAL ? `<div class="sh"><h2>How it counts</h2></div>
    <section class="surface min-card"><div class="chips min-apk">${KINDS.map((k) => `<button class="chip sm ${x.kind === k.id ? 'on' : ''}" data-act="min-app-kind" data-id="${x.id}" data-v="${k.id}">${k.name}</button>`).join('')}</div>
      <div class="row min-apask"><span class="rbody"><span class="rtitle">Ask me about it at night</span><span class="rmeta">${x.ask ? 'On: it can come up in the check-in' : 'Off: counted as it is'}</span></span><button class="switch${x.ask ? ' on' : ''}" data-act="min-app-ask" data-id="${x.id}" role="switch" aria-checked="${x.ask ? 'true' : 'false'}" aria-label="Ask me about it at night"></button></div></section>` : ''}

    ${x.ask || x.kind === 'entertainment' || x.kind === 'social' ? `<div class="sh"><h2>Around it</h2></div>
    <div class="group surface">
      ${blockFor(x.id) && !S.checkin.done ? `<button class="row ic" data-act="min-checkin"><span class="tile">${I.agent}</span><span class="rbody"><span class="rtitle">Answer for today</span><span class="rmeta">${fmt(today)} waiting in tonight’s check-in</span></span>${I.chevR}</button>` : ''}
      <button class="row ic" data-act="min-blocker"><span class="tile">${I.leaf}</span><span class="rbody"><span class="rtitle">Hold it in Soul</span><span class="rmeta">${!REAL && x.id === 'instagram' ? 'Till 19:00 tonight, or in every deep-work block' : 'Set a window when it stays shut'}</span></span>${I.chevR}</button>
      <button class="row ic" data-act="min-ask" data-about="${x.id}"><span class="tile">${I.sparkle}</span><span class="rbody"><span class="rtitle">Ask about ${esc(x.name)}</span><span class="rmeta">“When does it help, and when does it take over?”</span></span>${I.chevR}</button>
    </div>` : ''}`;
}

const redraw = () => { derive(); refreshMind('home', 'screen'); document.querySelectorAll('#stack .page.min-ap').forEach((p) => p._redraw?.()); };
on('min-app-kind', (el) => {
  const x = app(el.dataset.id); if (!x) return;
  saveAppRule(x.id, { kind: el.dataset.v }); haptic(5);
  toast(`${x.name} counts as ${kindName(el.dataset.v).toLowerCase()} from now on`);
  redraw();
});
on('min-app-ask', (el) => {
  const x = app(el.dataset.id); if (!x) return;
  saveAppRule(x.id, { ask: !x.ask }); haptic(5);
  redraw();
});

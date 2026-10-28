// Soul · the blocker. Which apps lock when, the hours the pull shows up (from what he logs, and Screen Time once Apple
// approves it), the lock screen, and the short talk that opens it: the agent weighs the reason within his rules and
// gives 2 to 15 minutes, or holds the line. Real records (soul-store.js); the rules are soul-logic.js, the same ones
// the agent's soul_answer_unlock tool runs on the PC.
// Two paths (DECISIONS 4): with the family_controls flag on, locks become system shields (soul-native.js); with it off
// (2.0.0), they run here and the screen says so plainly.
import { $, $$, esc, closeSheet, toast, on, ring, setRing, haptic, seg } from '../core.js';
import { I } from '../icons.js';
import { aspHead } from '../aspects.js';
import { stagger } from '../motion.js';
import { DAYS } from './soul-data.js';
import * as ST from './soul-store.js';
import { judgeUnlock, DAILY_OPENS, parseHM } from './soul-logic.js';
import { SI, S, who, hhmm, pad, plural, onTick, emit, onState, soulSheet } from './soul-ui.js';
import { openSteady } from './soul-clean.js';
import { SCREEN, screenAuthorize, systemUnblock, systemRelock } from './soul-native.js';

export const lockAppsLabel = (l) => ((l?.apps ?? []).length ? l.apps.join(', ') : 'Your apps');
// the day runs 06:00 → 06:00, so a night stays in one piece
const col = (h) => ((h % 24) - 6 + 24) % 24;
const pos = (h, m = 0) => ((col(h) + m / 60) / 24) * 100;
let tries = 0;   // times he met the lock screen this session

export function blockerLine() {
  const o = ST.openNow(); if (o) return `${o.app ?? 'Open'} open till ${hhmm(o.until)}`;
  const h = ST.holding()[0]; if (h) return `${lockAppsLabel(h)} locked till ${h.ends}`;
  const a = ST.askToday(); if (a?.state === 'pending') return `${who()} asks: ${a.title}`;
  const n = ST.nextWindow(); if (n) return `${n.name} at ${n.start}`;
  return ST.locks().some((l) => l.on) ? 'Nothing locked now' : 'No locks set';
}

// ── now: what holds, what's open, what comes next ────────────────────────
function stripHtml() {
  const n = ST.nowMin(); const nh = Math.floor(n / 60), nm = n % 60;
  const segs = [];
  for (const l of ST.locks().filter((x) => x.on && (x.kind === 'window' || x.kind === 'bedtime'))) {
    const s = parseHM(l.start), e = parseHM(l.end); if (s == null || e == null) continue;
    const len = ((e - s + 1440) % 1440) / 60;
    const a = ST.askToday(); const pend = l.ask_first && !(a?.lock === l.id && a.state === 'yes');
    if (l.ask_first && a?.lock === l.id && a.state === 'no') continue;
    segs.push(`<span class="sou-lk${pend ? ' pend' : ''}" style="left:${pos(Math.floor(s / 60), s % 60)}%;width:${Math.min(100 - pos(Math.floor(s / 60), s % 60), (len / 24) * 100).toFixed(3)}%"></span>`);
  }
  const nl = ST.nowLock(); if (nl) segs.push(`<span class="sou-lk" style="left:${pos(nh, nm)}%;width:${Math.min(100 - pos(nh, nm), ((Date.parse(nl.until) - ST.nowMs()) / 864e5) * 100).toFixed(3)}%"></span>`);
  const hasPend = segs.some((x) => x.includes(' pend'));
  return `<div class="sou-day" aria-hidden="true">
      <div class="sou-day-t">${segs.join('')}<i class="sou-now" style="left:${pos(nh, nm)}%"></i></div>
      <div class="sou-day-x"><span>06</span><span>12</span><span>18</span><span>00</span><span>06</span></div>
    </div>
    <div class="sou-day-k"><span><i class="k-lock"></i>Locked</span>${hasPend ? `<span><i class="k-pend"></i>${esc(who())} asks first</span>` : ''}<span><i class="k-now"></i>Now ${hhmm(ST.nowMs())}</span></div>`;
}
const leftText = () => { const o = ST.openNow(); if (!o) return '0:00'; const s = Math.ceil(Math.max(0, o.until - ST.nowMs()) / 1000); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
function nowHtml() {
  const ls = ST.locks();
  if (!ls.length) return `<section class="sou-bnow surface sou-empty">
      <span class="sou-empty-ic">${I.shield}</span><h3 class="headline">No locks yet</h3>
      <p class="sub">Pick an app and the hours it takes from you. During a lock, ${esc(who())} hears your reason before it opens: a few minutes for work, nothing for “just five minutes”.</p>
      <div class="sou-empty-a"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="sou-lock-new">${I.plus}Add a lock</button></div></section>`;
  const o = ST.openNow(); const h = ST.holding()[0]; const a = ST.askToday(); const nx = ST.nextWindow();
  const main = o ? { apps: o.app } : h ? { apps: lockAppsLabel(h) } : { apps: lockAppsLabel(a ? ls.find((l) => l.id === a.lock) ?? ls[0] : nx ?? ls[0]) };
  let pill; let line; let acts;
  if (o) {
    pill = `<span class="pill sou-pill">${SI.unlock}Open</span>`;
    line = `Open for <b class="met" data-sou-left>${leftText()}</b> more, for “${esc(o.reason)}”. Then it locks itself.`;
    acts = '<button class="btn sm" data-act="sou-relock">Done, lock it</button>';
  } else if (h) {
    pill = `<span class="pill sou-pill">${I.lock}Locked</span>`;
    line = `Locked till ${esc(h.ends)}${h.kind === 'now' ? ': you asked for it' : `: ${esc(h.name.toLowerCase())}`}. Ask ${esc(who())} if something can’t wait.`;
    acts = `<button class="btn sm tint" style="--c:var(--as-ink)" data-act="sou-ask">Ask to open</button>${h.kind === 'now' ? '<button class="btn sm" data-act="sou-unlock-now">Unlock</button>' : '<button class="btn sm" data-act="sou-shield">See the lock screen</button>'}`;
  } else if (a?.state === 'pending') {
    pill = '<span class="pill plain">Open now</span>';
    line = `${esc(who())} asks: ${esc(a.title)}`;
    acts = '<button class="btn sm tint" style="--c:var(--as-ink)" data-act="sou-lock-yes">Lock it</button><button class="btn sm" data-act="sou-lock-no">Not today</button>';
  } else {
    pill = '<span class="pill plain">Open now</span>';
    line = nx ? `${esc(nx.name)} starts at ${esc(nx.start)} and runs till ${esc(nx.end)}.${nx.ask_first ? ` ${esc(who())} asks you first.` : ''}` : 'Nothing locks again today.';
    acts = `<button class="btn sm tint" style="--c:var(--as-ink)" data-act="sou-lock-hour">Lock for an hour</button><button class="btn sm" data-act="sou-shield">See the lock screen</button>`;
  }
  const used = ST.opensUsed();
  return `<section class="sou-bnow surface">
    <div class="sou-bnow-h"><span class="tile sou-app">${SI.camera}</span><div class="sou-bnow-t"><h3 class="headline">${esc(main.apps)}</h3><p class="foot">${used} of ${DAILY_OPENS} early opens used today</p></div>${pill}</div>
    ${stripHtml()}
    <p class="sou-bnow-l">${line}</p>
    <div class="sou-bnow-a">${acts}</div>
  </section>`;
}
export function repaintBlocker() { $$('.sou-bnowslot').forEach((s) => { s.innerHTML = nowHtml(); }); }
onState(repaintBlocker);
ST.onChange(() => repaintBlocker());
on('sou-relock', () => { const o = ST.relock(); if (!o) return; systemRelock(); emit(); haptic(8); toast(`${o.app ?? 'It'} locked again`); });
on('sou-unlock-now', () => { ST.endNowLock(); systemRelock(); emit(); toast('Unlocked'); });
on('sou-lock-hour', () => { const l = ST.lockFor(60, ST.locks()[0]?.apps ?? []); systemRelock(); emit(); haptic(10); toast(`${lockAppsLabel(l)} locked till ${hhmm(Date.parse(l.until))}`, () => { ST.endNowLock(); systemRelock(); emit(); }); });

// ── system blocking: honest about which path runs ────────────────────────
function systemHtml() {
  if (SCREEN.available && SCREEN.authorized) return `<div class="sou-sys on">${I.shield}<p><b>Screen Time is on.</b> Locks shield ${SCREEN.picked ? plural(SCREEN.picked.apps, 'app') : 'the apps you picked'} on this iPhone, and the shield’s Ask opens the talk here.</p><button class="btn sm" data-act="sou-st-pick">Change apps</button></div>`;
  if (SCREEN.available) return `<div class="sou-sys">${I.shield}<p><b>Screen Time can enforce these locks.</b> Allow it once and pick the apps; nothing leaves your phone.</p><button class="btn sm tint" style="--c:var(--as-ink)" data-act="sou-st-pick">Turn on</button></div>`;
  return `<div class="sou-sys">${I.shield}<p><b>Locks run in the app for now.</b> System blocking switches on when Apple approves Screen Time for Agentic OS. Until then ${esc(who())} keeps the schedule and hears your reasons here, but the apps themselves stay open: the lock is your word.</p></div>`;
}
on('sou-st-pick', async () => { await screenAuthorize(); S.app?.refresh('blocker'); });

// ── where the pull shows up: weekday × hour, with the windows worth locking ───
function heatHtml() {
  const P = ST.pull();
  if (P.n < 5) return `<div class="sh"><h2>Where your time slips</h2></div>
    <section class="sou-heat surface"><p class="sub">After a few urges and unlock asks, this shows the hours of the week the pull is strongest, and ${esc(who())} suggests a window to lock.${SCREEN.authorized ? ' Screen Time adds the minutes once it has a few days.' : ''} ${P.n ? `${plural(P.n, 'moment')} logged so far.` : ''}</p></section>`;
  const MAX = Math.max(1, ...P.grid.flat());
  const cells = P.grid.map((row, r) => `<span class="sou-hm-d">${DAYS[r][0]}</span>${Array.from({ length: 24 }, (_, c) => {
    const h = (c + 6) % 24; const v = row[h];
    return `<i data-r="${r}" data-h="${h}" class="${v ? '' : 'z'}" style="--v:${(v / MAX).toFixed(2)}"></i>`;
  }).join('')}`).join('');
  const wins = P.windows.map((w, i) => { const r0 = 0, r1 = w.days.length === 5 ? 4 : 6; return `<span class="sou-hm-w" style="grid-row:${r0 + 1} / ${r1 + 2};grid-column:${col(w.h) + 2} / ${col(w.h) + 3}"><b>${i + 1}</b></span>`; }).join('');
  const have = (w) => ST.locks().some((l) => l.start === w.start && l.end === w.end);
  return `
    <div class="sh"><h2>Where your time slips</h2><span class="sh-count">4 weeks</span><button class="sh-act" data-act="sou-heat-list">As a list</button></div>
    <section class="sou-heat surface">
      <p class="sou-heat-k">Urges and unlock asks you logged, by hour of the week</p>
      <div class="sou-hm">
        <div class="sou-hm-g" role="img" aria-label="${P.windows.length ? `Strongest: ${P.windows.map((w) => w.label).join(' and ')}` : 'No clear window yet'}">${cells}</div>
        <div class="sou-hm-o" aria-hidden="true">${wins}</div>
      </div>
      <div class="sou-hm-x" aria-hidden="true"><span style="grid-column:2">06</span><span style="grid-column:8">12</span><span style="grid-column:14">18</span><span style="grid-column:20">00</span></div>
      <div class="sou-hm-f"><p class="sou-hm-read" aria-live="polite">Tap an hour</p><span class="sou-hm-leg" aria-hidden="true">0<i style="--v:.08"></i><i style="--v:.35"></i><i style="--v:.65"></i><i style="--v:1"></i>${MAX}</span></div>
      ${P.windows.length ? `<div class="sou-wins">${P.windows.map((w, i) => `<div class="sou-win"><span class="sou-win-n">${i + 1}</span><div class="sou-win-t"><b>${w.label}</b><span>${plural(w.n, 'moment')} in this hour</span></div>${have(w) ? '<span class="sou-tag">Locked</span>' : `<button class="btn sm" data-act="sou-win-lock" data-i="${i}">Lock it</button>`}</div>`).join('')}</div>` : ''}
    </section>`;
}
function wireHeat(el) {
  const g = $('.sou-hm-g', el); if (!g) return;
  g.addEventListener('pointerup', (e) => {
    const c = e.target.closest('i[data-r]'); if (!c) return;
    $$('i.sel', g).forEach((x) => x.classList.remove('sel')); c.classList.add('sel');
    const r = Number(c.dataset.r); const h = Number(c.dataset.h); const v = ST.pull().grid[r][h];
    $('.sou-hm-read', el).innerHTML = `<b>${DAYS[r]} ${pad(h)}:00</b> · ${plural(v, 'moment')}`;
    haptic(4);
  });
}
on('sou-heat-list', () => {
  const P = ST.pull();
  soulSheet({
    title: 'Where your time slips', sub: 'Urges and unlock asks, the last four weeks',
    body: `<div class="group">${P.grid.map((row, r) => {
      const tot = row.reduce((a, b) => a + b, 0); const top = row.map((v, h) => [v, h]).filter(([v]) => v).sort((a, b) => b[0] - a[0]).slice(0, 2);
      return `<div class="row"><span class="rbody"><span class="rtitle">${DAYS[r]}</span><span class="rmeta"><span class="ell">${top.length ? `Most at ${top.map(([v, h]) => `${pad(h)}:00 (${v})`).join(' and ')}` : 'Nothing logged'}</span></span></span><span class="rend met">${tot}</span></div>`;
    }).join('')}</div>`,
  });
});
on('sou-win-lock', (el) => {
  const w = ST.pull().windows[Number(el.dataset.i)]; if (!w) return;
  const apps = ST.locks()[0]?.apps ?? [];
  ST.addLock({ name: `${w.days.length === 5 ? 'Weekday' : 'Daily'} ${w.start} window`, kind: 'window', apps, start: w.start, end: w.end, days: w.days, ask_first: true, learned: true, how: `${who()} asks first, each day before ${w.start}` });
  haptic(10); S.app?.refresh('blocker'); toast(`Locked ${w.label}. ${who()} asks you first each day`);
});

// ── the locks ─────────────────────────────────────────────────────────────
const lockIcon = (l) => ({ window: I.lock, bedtime: I.moon, limit: I.hourglass, hard: SI.hand }[l.kind] ?? I.lock);
const locksHtml = () => { const ls = ST.locks(); if (!ls.length) return ''; return `
  <div class="sh"><h2>Locks</h2><span class="sh-count sou-locks-n">${ls.filter((l) => l.on).length} on</span></div>
  <div class="group">${ls.map((l) => `
    <button class="row ic sou-lockrow" data-act="sou-lock" data-id="${esc(l.id)}">
      <span class="tile">${lockIcon(l)}</span>
      <span class="rbody"><span class="rtitle">${esc(l.name)}${l.learned ? '<span class="sou-tag">Learned</span>' : ''}</span><span class="rmeta"><span class="ell">${[l.apps.join(', '), l.when].filter(Boolean).map(esc).join(' · ')}</span></span></span>
      <span class="rend sou-onoff">${l.on ? 'On' : 'Off'}</span>${I.chevR}
    </button>`).join('')}
    <button class="row ic" data-act="sou-lock-new"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">Add a lock</span></span></button></div>`; };
const KINDS = [['window', 'Window'], ['bedtime', 'Bedtime'], ['limit', 'Daily limit'], ['hard', 'Hard mode']];
const DAYSETS = [['all', 'Every day', []], ['wk', 'Weekdays', [1, 2, 3, 4, 5]], ['we', 'Weekends', [6, 7]]];
function lockForm(l = null) {
  const dk = !l?.days?.length ? 'all' : l.days.join() === '1,2,3,4,5' ? 'wk' : l.days.join() === '6,7' ? 'we' : 'all';
  return `<div class="sou-form">
    <label class="field"><input id="sou-lk-name" maxlength="40" placeholder="e.g. Evening window" value="${esc(l?.name ?? '')}" /></label>
    <p class="sou-form-l">Apps <span>names, comma between</span></p>
    <label class="field"><input id="sou-lk-apps" maxlength="80" placeholder="Instagram, YouTube" value="${esc((l?.apps ?? []).join(', '))}" /></label>
    <p class="sou-form-l">Kind</p>
    <div class="pad">${seg('sou-lk-kind', KINDS, l?.kind ?? 'window')}</div>
    <div class="sou-lk-win"><p class="sou-form-l">From and to</p><div class="sou-lk-times"><label class="field"><input id="sou-lk-s" type="time" value="${esc(l?.start ?? '18:00')}" /></label><label class="field"><input id="sou-lk-e" type="time" value="${esc(l?.end ?? '19:00')}" /></label></div>
      <div class="pad">${seg('sou-lk-days', DAYSETS.map(([k, t]) => [k, t]), dk)}</div></div>
    <div class="sou-lk-lim" hidden><p class="sou-form-l">Minutes a day</p><label class="field"><input id="sou-lk-min" type="number" min="5" max="600" value="${esc(l?.limit_min ?? 45)}" /></label></div>
    <p class="sou-form-l">If you ask to open it</p>
    <div class="pad">${seg('sou-strict', [['easy', 'Opens freely'], ['reason', 'With a reason'], ['never', 'Never']], l?.strict ?? 'reason')}</div>
    <button class="row sou-lk-ask" data-act="sou-lk-askfirst" role="switch" aria-checked="${!!l?.ask_first}"><span class="rbody"><span class="rtitle">${esc(who())} asks you first each day</span><span class="rmeta"><span class="ell">A yes or no before it starts</span></span></span><span class="switch${l?.ask_first ? ' on' : ''}" aria-hidden="true"></span></button>
  </div>`;
}
function syncKind(sheet) {
  const k = $('[data-seg="sou-lk-kind"] [aria-selected="true"]', sheet)?.dataset.v ?? 'window';
  const w = $('.sou-lk-win', sheet), m = $('.sou-lk-lim', sheet);
  if (w) w.hidden = !(k === 'window' || k === 'bedtime'); if (m) m.hidden = k !== 'limit';
}
document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-seg="sou-lk-kind"] [data-v]'); if (b) setTimeout(() => syncKind(b.closest('.sheet')), 0); });
function readLock(sheet) {
  const v = (s) => $(`[data-seg="${s}"] [aria-selected="true"]`, sheet)?.dataset.v;
  const kind = v('sou-lk-kind') ?? 'window';
  return {
    name: $('#sou-lk-name', sheet).value.trim() || KINDS.find((k) => k[0] === kind)[1],
    apps: $('#sou-lk-apps', sheet).value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8),
    kind, strict: v('sou-strict') ?? 'reason', ask_first: $('.sou-lk-ask', sheet).getAttribute('aria-checked') === 'true',
    ...(kind === 'window' || kind === 'bedtime' ? { start: $('#sou-lk-s', sheet).value || '18:00', end: $('#sou-lk-e', sheet).value || '19:00', days: DAYSETS.find((d) => d[0] === v('sou-lk-days'))?.[2] ?? [] } : {}),
    ...(kind === 'limit' ? { limit_min: Math.max(5, Math.min(600, Number($('#sou-lk-min', sheet).value) || 45)) } : {}),
  };
}
on('sou-lk-askfirst', (el) => { const on1 = el.getAttribute('aria-checked') !== 'true'; el.setAttribute('aria-checked', String(on1)); $('.switch', el).classList.toggle('on', on1); haptic(4); });
on('sou-lock-new', () => {
  const sh = soulSheet({ title: 'A new lock', sub: 'The app, and the hours it takes from you', large: true,
    body: `${lockForm()}<div class="sou-sheet-acts"><button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-lk-save">Add lock</button></div>` });
  syncKind(sh);
});
function lockSheet(id) {
  const l = ST.locks().find((x) => x.id === id); if (!l) return;
  const sh = soulSheet({
    title: esc(l.name), sub: esc(l.when), large: true,
    body: `
      <div class="group">
        <button class="row" data-act="sou-lock-sw" data-id="${esc(l.id)}" role="switch" aria-checked="${l.on}"><span class="rbody"><span class="rtitle">${l.on ? 'On' : 'Off'}</span></span><span class="switch${l.on ? ' on' : ''}" aria-hidden="true"></span></button>
        ${l.how ? `<div class="row ic"><span class="tile">${I.sparkle}</span><span class="rbody"><span class="rtitle wrap">${esc(l.how)}</span><span class="rmeta">${l.learned ? `${esc(who())} found it in what you logged` : 'Set by you'}</span></span></div>` : ''}
      </div>
      ${lockForm(l)}
      <p class="hint">With a reason, ${esc(who())} decides: a few minutes, then it locks again by itself. ${DAILY_OPENS} opens a day at most, however good the reason. One free pass a week skips the talk.</p>
      <div class="sou-sheet-acts"><button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-lk-save" data-id="${esc(l.id)}">Save</button><button class="btn block" data-act="sou-lk-del" data-id="${esc(l.id)}">Remove lock</button></div>`,
  });
  syncKind(sh);
}
on('sou-lock', (el) => lockSheet(el.dataset.id));
on('sou-lk-save', (el) => {
  const sh = el.closest('.sheet'); const f = readLock(sh);
  if ((f.kind === 'window' || f.kind === 'bedtime') && f.start === f.end) { toast('A lock needs a start and an end'); return; }
  if (el.dataset.id) ST.updateLock(el.dataset.id, f); else ST.addLock(f);
  closeSheet(sh); systemRelock(); S.app?.refresh('blocker'); toast(el.dataset.id ? 'Lock saved' : `${f.name}: added`);
});
on('sou-lk-del', (el) => { const id = el.dataset.id; const l = ST.locks().find((x) => x.id === id); ST.removeLock(id); closeSheet(el.closest('.sheet')); systemRelock(); S.app?.refresh('blocker'); toast(`${l?.name ?? 'Lock'} removed`); });
on('sou-lock-sw', (el) => {
  const l = ST.locks().find((x) => x.id === el.dataset.id); if (!l) return;
  const on1 = !l.on; ST.updateLock(l.id, { active: on1 }); haptic(6);
  el.setAttribute('aria-checked', String(on1)); $('.switch', el).classList.toggle('on', on1); $('.rtitle', el).textContent = on1 ? 'On' : 'Off';
  $$(`.sou-lockrow[data-id="${l.id}"] .sou-onoff`).forEach((s) => { s.textContent = on1 ? 'On' : 'Off'; });
  $$('.sou-locks-n').forEach((n) => { n.textContent = `${ST.locks().filter((x) => x.on).length} on`; });
  systemRelock(); repaintBlocker();
});

// ── what he asked, and what she decided ──────────────────────────────────
const bubble = (who1, html) => `<div class="sou-msg ${who1 === 'me' ? 'me' : 'her'}"><p>${html}</p></div>`;
const WDS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayOf = (date) => (date === ST.today() ? 'Today' : WDS[new Date(`${date}T00:00:00Z`).getUTCDay()]);
function asksHtml() {
  const ts = ST.talksWeek();
  const open = ts.filter((a) => a.out !== 'held').length;
  const showTry = ST.locks().length > 0;
  return `
    <div class="sh"><h2>Asking to open</h2><span class="sh-count">${plural(ts.length, 'ask')} this week</span></div>
    ${ts.length ? `<p class="sou-lead">${open} opened, ${ts.length - open} held.${ts.length - open ? ' Held is not lost: it opens when the lock ends.' : ''}</p>` : `<p class="sou-lead">None this week.${showTry ? ' When a lock holds, ask here or from the lock screen.' : ''}</p>`}
    <div class="group">${ts.map((a) => `
      <button class="row sou-askrow" data-act="sou-askview" data-id="${esc(a.id)}">
        <span class="rbody"><span class="rtitle">“${esc(a.reason)}”</span><span class="rmeta"><span class="ell">${dayOf(a.date)} ${hhmm(Date.parse(a.at))} · ${esc(a.app ?? 'App')}${a.lockName ? ` · ${esc(a.lockName)}` : ''}</span></span></span>
        <span class="pill plain sou-out">${a.out === 'held' ? `${SI.hand}Held` : `${SI.unlock}${a.mins ?? 5} min`}</span>${I.chevR}
      </button>`).join('')}
      ${showTry ? `<button class="row ic" data-act="sou-ask"><span class="tile">${I.chat}</span><span class="rbody"><span class="rtitle">Ask to open</span><span class="rmeta"><span class="ell">The talk, the way it happens on the lock screen</span></span></span>${I.chevR}</button>` : ''}
    </div>`;
}
on('sou-askview', (el) => {
  const a = ST.talks().find((x) => x.id === el.dataset.id); if (!a) return;
  const chat = Array.isArray(a.chat) && a.chat.length ? a.chat : [['me', a.reason]];
  soulSheet({
    title: `“${esc(a.reason)}”`, sub: `${dayOf(a.date)} ${hhmm(Date.parse(a.at))} · ${esc(a.app ?? 'App')}${a.lockName ? ` · ${esc(a.lockName)}` : ''}`, large: chat.length > 3,
    body: `<div class="sou-cv">${chat.map(([w, t]) => bubble(w, esc(t))).join('')}
      <div class="sou-dec ${a.out === 'held' ? 'held' : 'open'}"><span class="sou-dec-ic">${a.out === 'held' ? SI.hand : SI.unlock}</span><div class="sou-dec-t"><b>${a.out === 'held' ? 'Held' : a.out === 'pass' ? `Free pass, ${a.mins ?? 5} minutes` : `Opened for ${a.mins} minutes`}</b><span>${a.out === 'held' ? 'Nothing opened, nothing lost' : 'Then it locked itself again'}</span></div></div></div>`,
  });
});

// ── this week, from the talks ────────────────────────────────────────────
function weekHtml() {
  const ts = ST.talksWeek(); if (!ts.length) return '';
  const opened = ts.filter((t) => t.out !== 'held'); const mins = opened.reduce((a, t) => a + (Number(t.mins) || 0), 0);
  return `
    <div class="sh"><h2>This week</h2></div>
    <section class="sou-week surface sou-wk3">
      <div><b class="met">${ts.filter((t) => t.out === 'held').length}</b><span>held</span></div>
      <div><b class="met">${opened.length}</b><span>opened early</span></div>
      <div><b class="met">${mins}<small> min</small></b><span>given, in all</span></div>
    </section>`;
}

// ── the lock screen, as he meets it ──────────────────────────────────────
const shieldPreview = () => (ST.locks().length ? `
  <div class="sh"><h2>The lock screen</h2></div>
  <button class="sou-shpv surface" data-act="sou-shield" aria-label="See the lock screen">
    <span class="sou-shpv-m" aria-hidden="true"><span class="sou-shpv-ic">${I.leaf}</span><b>${esc(lockAppsLabel(ST.locks()[0]).split(',')[0])} is locked</b><i class="p"></i><i class="s"></i></span>
    <span class="sou-shpv-t"><b>What you meet during a lock</b><span>The big button says “I don’t need it”, because most of the time that is the answer.</span></span>
  </button>` : '');

export function openShield() {
  $('.sou-shield')?.remove();
  tries += 1;
  const h = ST.holding()[0]; const name = lockAppsLabel(h ?? ST.locks()[0]).split(',')[0];
  const el = document.createElement('section');
  el.className = 'sou-shield stay-dark'; el.dataset.aspect = 'soul';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', `${name} is locked`);
  el.innerHTML = `
    <div class="sou-sh-in">
      <span class="sou-sh-ic">${I.leaf}</span>
      <span class="sou-sh-k">Soul · set by ${esc(who())}</span>
      <h2 class="title1">${esc(name)} is ${h ? 'locked' : 'open now'}</h2>
      <p class="sub">${h ? `Till ${esc(h.ends)}.${tries > 1 ? ` Try ${tries} today.` : ''} ${esc(who())} can open it if it can’t wait.` : 'This is what you meet when a lock holds.'}</p>
    </div>
    <div class="sou-sh-b">
      <button class="btn primary block" style="--c:var(--as-fill)" data-act="sou-sh-close">I don’t need it</button>
      <button class="btn block sou-sh-talk" data-act="sou-sh-talk">Talk to ${esc(who())}</button>
    </div>`;
  $('#phone').append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  haptic(8);
}
function closeShield() { const el = $('.sou-shield'); if (!el) return; el.classList.remove('in'); setTimeout(() => el.remove(), 320); }
on('sou-shield', () => openShield());
on('sou-sh-close', () => { closeShield(); toast('Good call. Back to what you were doing'); });
on('sou-sh-talk', () => { closeShield(); setTimeout(() => openAsk(), 160); });
on('sou-ask', () => openAsk());

// ── the talk: he gives a reason, she gives minutes, or holds the line ─────
const CHIPS = ['Reply to a customer’s message', 'Post today’s reel', 'Someone sent me something', 'Just five minutes'];
export function openAsk(appName = null) {
  const h = ST.holding().find((l) => !appName || !l.apps.length || l.apps.some((a) => a.toLowerCase() === String(appName).toLowerCase())) ?? ST.holding()[0] ?? null;
  const name = appName ?? (h ? lockAppsLabel(h).split(',')[0] : lockAppsLabel(ST.locks()[0]).split(',')[0]);
  const left = Math.max(0, DAILY_OPENS - ST.opensUsed());
  const sheet = soulSheet({
    large: true, cls: 'sou-asksheet',
    head: `<div class="sheet-head sou-ah"><span class="sou-wyn lg">${I.sparkle}</span><div class="sh-text"><h3>Ask ${esc(who())}</h3><p>${esc(name)} · ${h ? `locked till ${esc(h.ends)}` : 'not locked now'} · ${plural(left, 'open')} left today</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: '<div class="sou-cv" aria-live="polite"></div>',
    foot: h ? `<div class="sou-cv-foot">
      <div class="sou-cv-chips" data-scroll-x>${CHIPS.map((c) => `<button class="chip sm sou-cv-chip" data-act="sou-cv-chip">${esc(c)}</button>`).join('')}</div>
      <form class="sou-cv-bar"><label class="field sou-cv-field"><input name="r" placeholder="Tell her why" autocomplete="off" enterkeyhint="send" aria-label="Your reason" /></label><button class="sou-cv-send" type="submit" aria-label="Send">${I.up}</button></form>
    </div>` : '',
  });
  sheet._ask = { app: name, lock: h, round: 0, busy: false, chat: [], talk: null };
  $('form', sheet)?.addEventListener('submit', (e) => { e.preventDefault(); const i = $('input', sheet); send(sheet, i.value); i.value = ''; });
  if (!h) { say(sheet, 'wyn', `Nothing is locked right now, so ${esc(name)} is open. Want me to lock it for an hour?`, `<div class="sou-dec-b"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="sou-lock-hour">Lock for an hour</button></div>`); return; }
  say(sheet, 'wyn', `It’s locked till ${esc(h.ends)}${h.kind === 'now' ? ', because you asked' : `: ${esc(h.name.toLowerCase())}`}. What do you need it for?`);
}
function say(sheet, who1, html, extra = '') {
  const cv = $('.sou-cv', sheet); if (!cv) return;
  cv.insertAdjacentHTML('beforeend', bubble(who1, html) + extra);
  const st = sheet._ask; if (st) { st.chat.push([who1, html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")]); if (st.talk) ST.updateTalk(st.talk, { chat: st.chat.slice() }); }
  const b = $('.sheet-body', sheet); requestAnimationFrame(() => b.scrollTo({ top: b.scrollHeight, behavior: 'smooth' }));
  const last = cv.lastElementChild; if (last) stagger([last], { y: 10, scale: 0.96, each: 0 });
}
function send(sheet, text) {
  const st = sheet._ask; text = String(text ?? '').trim();
  if (!text || st.busy) return;
  st.busy = true; st.reason = text;
  say(sheet, 'me', esc(text));
  $('.sou-cv', sheet).insertAdjacentHTML('beforeend', `<div class="sou-msg her sou-typing" aria-label="${esc(who())} is typing"><p><i></i><i></i><i></i></p></div>`);
  setTimeout(() => { $('.sou-typing', sheet)?.remove(); st.busy = false; decide(sheet, text); }, 950);
}
function decide(sheet, text) {
  const st = sheet._ask; const l = st.lock;
  const hard = ST.locks().some((x) => x.kind === 'hard' && x.on);
  const d = judgeUnlock({ text, round: st.round, opensLeft: DAILY_OPENS - ST.opensUsed(), strict: l.strict ?? 'reason', hard, ends: l.ends, weakWeek: ST.weakWeek() });
  if (d.out === 'open') { grant(sheet, d.mins, text, d.say); return; }
  if (d.out === 'held') { hold(sheet, text, d.text); return; }
  st.round = 1;
  say(sheet, 'wyn', esc(d.text));
}
function record(sheet, f) {
  const st = sheet._ask;
  const t = ST.saveTalk({ app: st.app, lock: st.lock?.id ?? null, lockName: st.lock?.name ?? null, reason: st.reason ?? f.reason, chat: st.chat.slice(), source: 'app', ...f });
  st.talk = t.id;
}
function grant(sheet, mins, reason, sayFn, { pass = false } = {}) {
  const until = ST.nowMs() + mins * 6e4;
  haptic(10);
  say(sheet, 'wyn', esc(sayFn(hhmm(until))), `
    <div class="sou-dec open">
      ${ring(1, 'as', 40, 5, { cls: 'sou-dec-ring' })}
      <div class="sou-dec-t"><b>Open · <span class="met" data-sou-left>${mins}:00</span> left</b><span>Locks again at ${hhmm(until)} by itself</span></div>
      <button class="btn sm" data-act="sou-relock">Lock it</button>
    </div>`);
  const f = { out: pass ? 'pass' : 'open', mins, until: new Date(until).toISOString() };
  if (sheet._ask.talk) ST.updateTalk(sheet._ask.talk, { ...f, reason: sheet._ask.reason ?? reason, chat: sheet._ask.chat.slice() }); else record(sheet, { reason, ...f });
  systemUnblock(mins);
  emit();
  $('.sou-cv-chips', sheet)?.remove();
  startOpenClock();
}
function hold(sheet, reason, text) {
  haptic(6);
  say(sheet, 'wyn', esc(text), `
    <div class="sou-dec held">
      <span class="sou-dec-ic">${SI.hand}</span>
      <div class="sou-dec-t"><b>Holding the line</b><span>Opens at ${esc(sheet._ask.lock.ends)} · nothing lost</span></div>
      <div class="sou-dec-b"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="sou-cv-ok">Okay, hold it</button><button class="btn sm" data-act="sou-cv-breathe">${SI.wind}Breathe with me</button></div>
      <div class="sou-dec-l">${sheet._ask.round === 0 ? '<button class="sou-pass" data-act="sou-cv-more">It’s important</button>' : ''}${ST.passUsed() ? '' : '<button class="sou-pass" data-act="sou-cv-pass">Use the free pass</button>'}</div>
    </div>`);
  if (!sheet._ask.talk) record(sheet, { reason, out: 'held', mins: null, until: null });
  else ST.updateTalk(sheet._ask.talk, { out: 'held' });
}
on('sou-cv-chip', (el) => send(el.closest('.sheet'), el.textContent));
on('sou-cv-ok', (el) => { const sh = el.closest('.sheet'); $$('.sou-dec-b, .sou-dec-l', sh).forEach((b) => b.remove()); say(sh, 'me', 'Okay'); setTimeout(() => say(sh, 'wyn', `Thank you. It opens at ${esc(sh._ask.lock.ends)}.`), 500); });
on('sou-cv-breathe', (el) => { closeSheet(el.closest('.sheet')); setTimeout(() => openSteady({ from: 'blocker' }), 200); });
on('sou-cv-more', (el) => { const sh = el.closest('.sheet'); $$('.sou-dec-b, .sou-dec-l', sh).forEach((b) => b.remove()); sh._ask.round = 1; say(sh, 'me', 'It’s important'); setTimeout(() => { say(sh, 'wyn', 'Then tell me what it is, in one line, and I’ll decide.'); $('input', sh)?.focus(); }, 500); });
on('sou-cv-pass', (el) => {
  const sh = el.closest('.sheet'); $$('.sou-dec-b, .sou-dec-l', sh).forEach((b) => b.remove());
  grant(sh, 5, 'Free pass', (t) => `Opened for 5 minutes, no questions. I lock it at ${t}. Your next pass comes Monday.`, { pass: true });
});
// the open countdown: every [data-sou-left] and its ring, once a second, until it locks itself
function startOpenClock() {
  onTick(() => {
    const o = ST.openNow();
    if (!o) { $$('.sou-dec.open .sou-dec-t b').forEach((b) => { b.textContent = 'Locked again'; }); repaintBlocker(); systemRelock(); return false; }
    $$('[data-sou-left]').forEach((e) => { e.textContent = leftText(); });
    $$('.sou-dec-ring').forEach((r) => setRing(r, (o.until - ST.nowMs()) / (o.mins * 6e4), { bleed: false }));
    return true;
  });
}

// ── the section ───────────────────────────────────────────────────────────
export function renderBlocker(el, app) {
  el.innerHTML = aspHead(app, { title: 'Blocker', sub: `${who()} locks apps in the hours your time slips` })
    + `<div class="sou-bnowslot">${nowHtml()}</div>`
    + systemHtml()
    + heatHtml() + locksHtml() + asksHtml() + weekHtml() + shieldPreview();
  wireHeat(el);
  if (ST.openNow()) startOpenClock();
  stagger($$('.sou-lockrow, .sou-askrow', el), { y: 8, each: 30 });
}

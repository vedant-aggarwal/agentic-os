// Mind: shared render helpers (icons, app tiles, book covers, charts). Owner: the Mind agent. Prefix min-.
// Charts follow the dataviz rules: one series per colour job, the app's colour for today's marks, a recessive
// grey for the usual day, hairline solid grid, 4px rounded data ends, a 2px surface gap, text in text tokens.
import { esc, $, pop } from '../core.js';
import { I } from '../icons.js';
import { api } from '../bus.js';
import { APPS, HOURS, USUAL, hourMin, fmt, hm, MONTH, KINDS, S, MD, REAL, nowMin } from './mind-data.js';
import { stagger, reduced } from '../motion.js';

// ── navigation inside Mind: open the app (or use the one that's open), then do something in it ──
export function ensureMind(section, then) {
  const a = S.app;
  if (a?.page?.isConnected) {
    // a section was asked for: come back to the app first (the pages above it go, the top one slides away)
    if (section) {
      const pages = [...($('#stack')?.children ?? [])];
      const above = pages.slice(pages.indexOf(a.page) + 1);
      above.slice(0, -1).forEach((p) => { p._opts?.onPop?.(); p.remove(); });
      if (above.length) pop();
      if (a.section !== section) a.go(section);
    }
    then?.(a);
    return a;
  }
  api.openAspect('mind', section);
  if (then) requestAnimationFrame(() => then(S.app));
  return S.app;
}
// re-render sections that are already built, after something changed (a log, the check-in)
export function refreshMind(...ids) {
  const a = S.app; if (!a?.page?.isConnected) return;
  ids.forEach((id) => { const el = a.el(id); if (el?.dataset.built) { a.refresh(id); growIn(el); } });
}
// charts grow from their baseline once when they're shown (rings do the same through pulse())
// (marks are drawn at their value by default; 'pre' holds them at the baseline for one frame, so a chart that is
// never primed still shows its data)
export function growIn(root) {
  if (!root || reduced()) return;
  const rows = [...root.querySelectorAll(':scope > section, :scope > .group, :scope > .sh, :scope > .min-rail, :scope > .note, :scope .min-scr > section, :scope .min-scr > .group')].slice(0, 14);
  if (rows.length) stagger(rows, { y: 10, each: 32, max: 360 });
  const els = [...root.querySelectorAll('.min-hc, .min-wk, .min-meter, .min-io-bar, .min-split-v')];
  if (!els.length) return;
  els.forEach((e) => e.classList.add('pre'));
  void root.offsetWidth;
  requestAnimationFrame(() => requestAnimationFrame(() => els.forEach((e) => e.classList.remove('pre'))));
}

const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
// icons drawn for Mind, in the same 2px line as js/icons.js
export const MI = {
  phone: s('<rect x="6.5" y="2.8" width="11" height="18.4" rx="3.2"/><path d="M10.5 17.9h3"/>'),
  cap: s('<path d="M2.8 9.3 12 5.2l9.2 4.1L12 13.4z"/><path d="M6.6 11.3v4.4c1.4 1.4 3.2 2.1 5.4 2.1s4-.7 5.4-2.1v-4.4"/><path d="M21.2 9.3v4.9"/>'),
  mail: s('<rect x="3" y="5.5" width="18" height="13" rx="3.2"/><path d="m4.2 7.6 7.8 5.4 7.8-5.4"/>'),
  photo: s('<rect x="3.5" y="4.5" width="17" height="15" rx="3.6"/><circle cx="9" cy="9.9" r="1.7"/><path d="m4.6 17.6 4.7-4.3 3.4 3 3.2-2.7 4.4 4"/>'),
  timer: s('<circle cx="12" cy="13.5" r="7.3"/><path d="M12 13.5V9.9M9.8 2.9h4.4M18.2 6.8l1.4-1.4"/>'),
  phones: s('<path d="M4 15.5V12a8 8 0 0 1 16 0v3.5"/><rect x="3.5" y="14" width="4.2" height="6.5" rx="2.1"/><rect x="16.3" y="14" width="4.2" height="6.5" rx="2.1"/>'),
  note: s('<path d="M5 4.5h14v10.5l-4.5 4.5H5z"/><path d="M14.5 19.5V15H19M8.5 9h7M8.5 12.5h4"/>'),
  pages: s('<path d="M7 3.5h8.5l3.5 3.5v12.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5v-14.5A1.5 1.5 0 0 1 7 3.5Z"/><path d="M9 11h6M9 14.5h6M9 18h3.5"/>'),
  park: s('<rect x="4" y="5" width="16" height="4.5" rx="1.5"/><path d="M5.5 9.5v8a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-8M10 13.5h4"/>'),
  split: s('<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M12 5v14"/>'),
};
// the glyph each app wears: neutral tiles, never the app's own logo
export const GLYPH = { photo: MI.photo, video: I.content, chat: I.chat, rings: I.today, claude: I.claude, globe: I.globe, cap: MI.cap, mail: MI.mail, camera: I.camera,
  code: I.term, sparkle: I.sparkle, grid: I.grid, note: I.doc, music: I.wave, book: I.book };
export const appTile = (a, cls = '') => `<span class="tile min-at ${cls}" aria-hidden="true">${GLYPH[a.glyph] ?? I.grid}</span>`;
// Wyn's mark inside Mind: the agent's glyph on a control, the same in every app
export const wynMark = (cls = '') => `<span class="tile min-wyn ${cls}" aria-hidden="true">${I.agent}</span>`;

// ── a book: a typographic cover (no publisher art). tone picks one of six inks (css) ──
export const cover = (b, w = 72, cls = '') => {
  const size = w < 60 ? 'xs' : w < 100 ? 'sm' : 'lg';
  return `<span class="min-cover ${size} ${cls}" data-tone="${b.tone ?? 1}" style="--w:${w}px" aria-hidden="true">
    <span class="mc-rule"></span>${size === 'xs' ? '' : `<b class="mc-t">${esc(b.title)}</b>`}${size === 'lg' ? `<i class="mc-a">${esc(b.author)}</i>` : ''}${b.cover && /^https:\/\//.test(b.cover) ? `<img class="mc-img" src="${esc(b.cover)}" alt="" loading="lazy" decoding="async" onerror="this.remove()" onload="this.classList.add('in')">` : ''}</span>`;
};

// ── the day, hour by hour: today's columns over a usual Thursday's. y runs to 60 min (a whole hour on the phone) ──
// what the grey columns are: a usual Thursday, or the days so far when there aren't four Thursdays yet
export const usualName = () => (!REAL || MD.usualBasis === 'weekday' ? `Usual ${MD.weekday}` : MD.usualDays ? `Your usual (${MD.usualDays} ${MD.usualDays === 1 ? 'day' : 'days'})` : 'No usual yet');
export function hourChart({ big = false, id = 'min-hc' } = {}) {
  const NOW = nowMin();
  const hNow = Math.floor(NOW / 60);
  const nowX = Math.max(0, Math.min(1, ((NOW / 60) - HOURS[0]) / HOURS.length));
  const cols = HOURS.map((h) => {
    const t = h <= hNow ? hourMin(h) : 0;
    const u = USUAL[h] ?? 0;
    const state = h < hNow ? 'past' : h === hNow ? 'cur' : 'fut';
    return `<span class="min-hcol ${state}" data-h="${h}" style="--t:${(t / 60).toFixed(3)};--u:${(u / 60).toFixed(3)}"><i class="u"></i>${state === 'fut' ? '' : '<i class="t"></i>'}</span>`;
  }).join('');
  const ticks = [6, 9, 12, 15, 18, 21].map((h) => `<span style="--x:${((h - HOURS[0]) / HOURS.length).toFixed(4)}">${String(h).padStart(2, '0')}</span>`).join('');
  return `<div class="min-hc ${big ? 'big' : ''}" id="${id}" role="img" aria-label="Screen time by hour today, against ${esc(usualName().toLowerCase())}">
    ${big ? '<span class="min-grid" aria-hidden="true"><i style="--y:1"><b>60m</b></i><i style="--y:.5"><b>30m</b></i><i style="--y:0"></i></span>' : ''}
    <div class="min-hcols">${cols}<span class="min-now" style="--x:${nowX.toFixed(4)}" aria-hidden="true"></span></div>
    <div class="min-hx" aria-hidden="true">${ticks}</div>
  </div>`;
}
// what a tapped hour says: the hour, its minutes against the usual, and the apps in it
export function hourRead(h) {
  const t = h <= Math.floor(nowMin() / 60) ? hourMin(h) : null;
  const apps = APPS.filter((a) => a.hours?.[h]).sort((a, b) => b.hours[h] - a.hours[h]).slice(0, 3);
  const span = `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
  const u = USUAL[h] ?? 0;
  if (t == null) return `<b>${span}</b><span>${u ? `Usually ${fmt(u)}` : 'Usually nothing on screen'}</span>`;
  return `<b>${span} · ${fmt(t)}</b><span>${apps.map((a) => `${esc(a.name)} ${fmt(a.hours[h])}`).join(' · ') || (REAL ? 'Nothing on screen' : 'Phone down')}${Object.keys(USUAL).length ? ` · usual ${fmt(u)}` : ''}</span>`;
}
// wire a chart's columns: tap or drag across them to read an hour; tap the same one again to clear
export function wireHourChart(root, out, rest) {
  const hc = root.querySelector('.min-hc'); if (!hc || hc._wired) return; hc._wired = true;
  const cols = [...hc.querySelectorAll('.min-hcol')];
  let cur = null;
  const pick = (x) => {
    const r = hc.querySelector('.min-hcols').getBoundingClientRect();
    const i = Math.max(0, Math.min(cols.length - 1, Math.floor(((x - r.left) / r.width) * cols.length)));
    if (cur === i) return; cur = i;
    cols.forEach((c, j) => c.classList.toggle('sel', j === i));
    hc.classList.add('picking');
    out.innerHTML = hourRead(Number(cols[i].dataset.h));
  };
  const clear = () => { cur = null; cols.forEach((c) => c.classList.remove('sel')); hc.classList.remove('picking'); out.innerHTML = rest; };
  let down = false, moved = false, start = null, x0 = 0;
  hc.addEventListener('pointerdown', (e) => { down = true; moved = false; start = cur; x0 = e.clientX; pick(e.clientX); });
  hc.addEventListener('pointermove', (e) => { if (!down) return; if (Math.abs(e.clientX - x0) > 6) moved = true; if (moved) pick(e.clientX); });
  const up = () => { if (!down) return; down = false; if (!moved && start != null && start === cur) clear(); };
  hc.addEventListener('pointerup', up); hc.addEventListener('pointercancel', () => { down = false; });
}

// columns for a short series (a week): [[label, value, opts], …], scaled to max; an optional reference line
export function weekBars(rows, { max, line = null, lineLabel = '', unit = fmt, cls = '', label = '' } = {}) {
  const m = max ?? Math.max(...rows.map((r) => r[1]), line ?? 0, 1);
  return `<div class="min-wk ${cls}" role="img" aria-label="${esc(label)}">
    <div class="min-wkb">
      ${line != null ? `<span class="min-wkline" style="--y:${(line / m).toFixed(3)}"><b>${esc(lineLabel)}</b></span>` : ''}
      ${rows.map(([d, v, o = {}]) => `<span class="min-wkc ${o.today ? 'today' : ''} ${o.cls ?? ''}" style="--v:${(v / m).toFixed(3)}">
        <em class="met">${o.hideV ? '' : esc(unit(v))}</em><i></i></span>`).join('')}
    </div>
    <div class="min-wkx">${rows.map(([d, , o = {}]) => `<span class="${o.today ? 'today' : ''}">${esc(d)}</span>`).join('')}</div>
  </div>`;
}

// a horizontal meter in the app's colour, for magnitudes (kinds, apps): the same slot-1 colour for every bar
export const meter = (p, cls = '') => `<span class="min-meter ${cls}" style="--p:${Math.max(0, Math.min(1, p)).toFixed(3)}"><i></i></span>`;

// kinds as four figures with meters, scaled to the largest
export function kindsGrid(k, { prev = null } = {}) {
  const max = Math.max(...KINDS.map((x) => Math.max(k[x.id] ?? 0, prev?.[x.id] ?? 0)), 1);
  return `<div class="min-kinds">${KINDS.map((x) => {
    const v = k[x.id] ?? 0, p0 = prev?.[x.id];
    return `<div class="min-kind"><span class="mk-l">${x.name}</span><b class="met mk-v">${fmt(v)}${p0 != null && p0 !== v ? `<small class="mk-was">was ${fmt(p0)}</small>` : ''}</b>
      <span class="min-meter sm${p0 != null ? ' was' : ''}" style="--p:${(v / max).toFixed(3)}${p0 != null ? `;--w:${(p0 / max).toFixed(3)}` : ''}"><i></i></span></div>`;
  }).join('')}</div>`;
}

// the month as a calendar: each day shaded by its screen time (one hue, light to dark), a dot under nights he answered.
// Bins are relative to the month's own days, so a light PC-only month still shows its shape
export function monthHeat() {
  const M = MONTH, vals = M.days.filter((v, i) => v > 0 && i < M.days.length - 1).sort((a, b) => a - b);
  const q = (p) => vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * vals.length))] : Infinity;
  const cut = REAL ? [q(0.2), q(0.4), q(0.6), q(0.8)] : [300, 350, 400, 450];
  const bin = (v) => (!v ? 0 : v < cut[0] ? 1 : v < cut[1] ? 2 : v < cut[2] ? 3 : v < cut[3] ? 4 : 5);
  const cells = [];
  for (let i = 0; i < M.first; i++) cells.push('<span class="min-day pad"></span>');
  for (let d = 1; d <= (M.len ?? 31); d++) {
    const v = M.days[d - 1] ?? 0;
    const fut = d > M.today, today = d === M.today;
    cells.push(`<button class="min-day ${fut ? 'fut' : ''} ${today ? 'today' : ''}" ${fut ? 'disabled' : ''} data-act="min-day" data-d="${d}" data-b="${fut ? 0 : today ? 1 : bin(v)}" aria-label="${d} ${M.name}${v ? `, ${fmt(v)}` : ''}">
      <span class="num">${d}</span>${M.answered.has(d) ? '<i class="ck"></i>' : ''}</button>`);
  }
  return `<div class="min-cal">
    <div class="min-calh" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="min-calg">${cells.join('')}</div>
    <div class="min-call" aria-hidden="true"><span>Less</span>${[1, 2, 3, 4, 5].map((b) => `<i data-b="${b}"></i>`).join('')}<span>More</span><span class="min-callck"><i class="ck"></i>Check-in answered</span></div>
  </div>`;
}

// seven small rings for the week's check-ins: closed for an answered night, open for tonight
export const weekRings = (rows, ringFn, size = 22) => `<span class="min-wr">${rows.map((r) => `<span class="min-wrd ${r.today ? 'today' : ''}">${ringFn(r.done ? 1 : 0, size)}<i>${r.d[0]}</i></span>`).join('')}</span>`;

export { hm };

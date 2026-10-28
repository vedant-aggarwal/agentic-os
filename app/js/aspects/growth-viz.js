// Growth's figures, as SVG and HTML strings: the level with its rate of change beneath it (the derivative he asked
// for), sparklines, potential bars, last night's constellation, the mood pad and the month grid. Owner: the Growth agent.
// Colour comes only from tokens: --as (the app's violet), --needs (slipping), the aspect tokens for identity dots.
import { $, $$, esc, haptic } from '../core.js';
import { ASPECTS, aspect } from '../data.js';
import { LEVEL, RATE, weekStart, weekLabel, weekNo, addDays, iso, day, TODAY, moodWord, monLong, sameDay } from './growth-data.js';

const f1 = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±') + Math.abs(v).toFixed(1);
export const signed = f1;
const r1 = (v) => Math.round(v * 10) / 10;

// ── the level and its growth rate: two panels on one time axis, never two scales on one plot ──
const CW = 340, PL = 26, PR = 34, LT = 20, LB = 136, RT = 162, RB = 214, H = 238;
// the month a week belongs to is the month of its Thursday (ISO)
const weekMonth = (w) => addDays(weekStart(w), 3).getMonth();

export function levelChart({ from = 1, to = LEVEL.length } = {}) {
  const lv = LEVEL.slice(from - 1, to), rt = RATE.slice(from - 1, to), n = lv.length;
  if (!n) return `<p class="gro-empty-chart">No weeks of data yet. The chart starts with your first week of tasks, entries or logs.</p>`;
  const x = (i) => PL + (n === 1 ? 0 : (i / (n - 1)) * (CW - PL - PR));
  const lo = Math.floor((Math.min(...lv) - 3) / 10) * 10, hi = Math.ceil((Math.max(...lv) + 3) / 10) * 10;
  const y = (v) => LB - ((v - lo) / (hi - lo)) * (LB - LT);
  const rmax = Math.max(1, Math.ceil(Math.max(...rt.map(Math.abs)) * 2) / 2);
  const RM = (RT + RB) / 2;
  const ry = (v) => RM - (v / rmax) * ((RB - RT) / 2);
  const line = lv.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)} ${LB} L${x(0).toFixed(1)} ${LB} Z`;
  const grid = [];
  for (let g = lo; g <= hi; g += 10) grid.push(`<line x1="${PL}" x2="${CW - PR + 6}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}" class="gro-grid"/><text x="${PL - 6}" y="${(y(g) + 4).toFixed(1)}" text-anchor="end" class="gro-tick">${g}</text>`);
  const band = n > 1 ? (CW - PL - PR) / (n - 1) : 10;
  const bw = Math.max(2, Math.min(6, band * 0.58));
  const cols = rt.map((v, i) => {
    const h = Math.abs(ry(v) - RM);
    if (h < 0.6) return `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${(RM - 0.5).toFixed(1)}" width="${bw.toFixed(1)}" height="1" class="gro-col z" data-i="${i}"/>`;
    const up = v > 0, r = Math.min(2, bw / 2, h);
    const x0 = x(i) - bw / 2, x1 = x(i) + bw / 2, yb = RM, yt = up ? RM - h : RM + h;
    const d = up
      ? `M${x0.toFixed(1)} ${yb}V${(yt + r).toFixed(1)}Q${x0.toFixed(1)} ${yt.toFixed(1)} ${(x0 + r).toFixed(1)} ${yt.toFixed(1)}H${(x1 - r).toFixed(1)}Q${x1.toFixed(1)} ${yt.toFixed(1)} ${x1.toFixed(1)} ${(yt + r).toFixed(1)}V${yb}Z`
      : `M${x0.toFixed(1)} ${yb}V${(yt - r).toFixed(1)}Q${x0.toFixed(1)} ${yt.toFixed(1)} ${(x0 + r).toFixed(1)} ${yt.toFixed(1)}H${(x1 - r).toFixed(1)}Q${x1.toFixed(1)} ${yt.toFixed(1)} ${x1.toFixed(1)} ${(yt - r).toFixed(1)}V${yb}Z`;
    return `<path d="${d}" class="gro-col ${up ? 'up' : 'dn'}" data-i="${i}" style="--i:${i}"/>`;
  }).join('');
  // month labels where the month changes; skip one that would crowd the last
  // a month gets a label where it starts; a sliver of a month at the left edge gives way to the next full one
  const marks = [];
  let last = -1;
  const gap = n > 30 ? 40 : 30;
  for (let i = 0; i < n; i++) {
    const m = weekMonth(from + i);
    if (m === last) continue;
    last = m;
    const prev = marks.at(-1);
    if (prev && x(i) - prev.x <= gap) { if (prev.i === 0) marks.pop(); else continue; }
    marks.push({ i, x: x(i), m });
  }
  const months = marks.map(({ i, x: mx, m }) => `<text x="${mx.toFixed(1)}" y="${H - 4}" class="gro-tick" text-anchor="${i === 0 ? 'start' : 'middle'}">${monLong(m).slice(0, 3)}</text>`);
  const lowV = Math.min(...lv), lowI = lv.indexOf(lowV);
  const end = n - 1;
  const lowLab = lowI !== end && lowI !== 0 ? `<circle cx="${x(lowI).toFixed(1)}" cy="${y(lowV).toFixed(1)}" r="3.5" class="gro-low"/><text x="${x(lowI).toFixed(1)}" y="${(y(lowV) + 17).toFixed(1)}" text-anchor="middle" class="gro-lab">${lowV}</text>` : '';
  const label = `Level by week, ${weekLabel(from)} to ${weekLabel(to)}: from ${lv[0]} to ${lv[end]}, lowest ${lowV}. Growth this week ${f1(rt[end])} a week.`;
  return `<svg class="gro-lc" viewBox="0 0 ${CW} ${H}" role="img" aria-label="${esc(label)}" data-from="${from}" data-n="${n}" data-pl="${PL}" data-pr="${PR}" data-cw="${CW}">
    <text x="${PL}" y="10" class="gro-cap">Level</text>
    ${grid.join('')}
    <path d="${area}" class="gro-area"/>
    <path d="${line}" class="gro-line" pathLength="1"/>
    ${lowLab}
    <circle cx="${x(end).toFixed(1)}" cy="${y(lv[end]).toFixed(1)}" r="4.5" class="gro-end"/>
    <text x="${(x(end) + 9).toFixed(1)}" y="${(y(lv[end]) + 5).toFixed(1)}" class="gro-lab b">${lv[end]}</text>
    <text x="${PL}" y="${RT - 9}" class="gro-cap">Growth a week</text>
    <line x1="${PL}" x2="${CW - PR + 6}" y1="${RM}" y2="${RM}" class="gro-zero"/>
    ${cols}
    <text x="${(x(end) + 9).toFixed(1)}" y="${(ry(rt[end]) + 5).toFixed(1)}" class="gro-lab b">${f1(rt[end])}</text>
    ${months.join('')}
    <g class="gro-scrub" hidden><line class="gro-xh" x1="0" x2="0" y1="${LT - 4}" y2="${RB + 2}"/><circle class="gro-xd" r="5"/></g>
    <rect class="gro-hit" x="${PL - 8}" y="0" width="${CW - PL - PR + 16}" height="${RB + 4}" fill="transparent"/>
  </svg>`;
}

// scrub the chart: the crosshair finds the nearest week; the readout above leads with the values
export function wireLevelChart(root, onRead) {
  const svg = $('.gro-lc', root); if (!svg) return;
  const from = +svg.dataset.from, n = +svg.dataset.n, cw = +svg.dataset.cw, pl = +svg.dataset.pl, pr = +svg.dataset.pr;
  const lv = LEVEL.slice(from - 1, from - 1 + n), rt = RATE.slice(from - 1, from - 1 + n);
  const lo = Math.floor((Math.min(...lv) - 3) / 10) * 10, hi = Math.ceil((Math.max(...lv) + 3) / 10) * 10;
  const g = $('.gro-scrub', svg), xh = $('.gro-xh', svg), xd = $('.gro-xd', svg);
  let cur = -1;
  const at = (clientX) => {
    const b = svg.getBoundingClientRect();
    const vx = ((clientX - b.left) / b.width) * cw;
    return Math.max(0, Math.min(n - 1, Math.round(((vx - pl) / (cw - pl - pr)) * (n - 1))));
  };
  const show = (i) => {
    if (i === cur) return; cur = i;
    const X = pl + (n === 1 ? 0 : (i / (n - 1)) * (cw - pl - pr));
    const Y = LB - ((lv[i] - lo) / (hi - lo)) * (LB - LT);
    g.hidden = false; xh.setAttribute('x1', X); xh.setAttribute('x2', X); xd.setAttribute('cx', X); xd.setAttribute('cy', Y);
    $$('.gro-col.on', svg).forEach((c) => c.classList.remove('on'));
    $(`.gro-col[data-i="${i}"]`, svg)?.classList.add('on');
    svg.classList.add('scrubbing');
    haptic(3);
    onRead?.({ w: from + i, level: lv[i], rate: rt[i] });
  };
  const hide = () => { cur = -1; g.hidden = true; svg.classList.remove('scrubbing'); $$('.gro-col.on', svg).forEach((c) => c.classList.remove('on')); onRead?.(null); };
  let down = false;
  svg.addEventListener('pointerdown', (e) => { down = true; svg.setPointerCapture?.(e.pointerId); show(at(e.clientX)); });
  svg.addEventListener('pointermove', (e) => { if (down || e.pointerType === 'mouse') show(at(e.clientX)); });
  svg.addEventListener('pointerup', () => { down = false; hide(); });
  svg.addEventListener('pointercancel', () => { down = false; hide(); });
  svg.addEventListener('pointerleave', () => { if (!down) hide(); });
}
export const readout = ({ w, level, rate }, rest = false) => `<span class="gro-ro-w">${rest ? `This week so far · touch the chart to read any week` : `Week ${weekNo(w)} · ${weekLabel(w)}`}</span>
  <span class="gro-ro-v"><b class="met">${level}</b><small>level</small></span>
  <span class="gro-ro-v"><b class="met">${f1(rate)}</b><small>a week</small></span>`;

// ── a 12-week sparkline: context in the quiet ink, the four weeks the rate is measured over in the accent ──
export function spark(arr0, { w = 76, h = 28, win = 4, label = '', state = '' } = {}) {
  const arr = (arr0 ?? []).filter((v) => v != null);
  if (arr.length < 2) return `<svg class="gro-spark is-none" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}><path d="M3 ${h / 2}H${w - 5}" class="gro-sp-ctx"/>${arr.length ? `<circle cx="${w - 5}" cy="${h / 2}" r="3.5" class="gro-sp-end"/>` : ''}</svg>`;
  win = Math.min(win, arr.length - 1);
  const lo = Math.min(...arr) - 2, hi = Math.max(...arr) + 2;
  const xs = arr.map((_, i) => 3 + (i / (arr.length - 1)) * (w - 8));
  const ys = arr.map((v) => h - 4 - ((v - lo) / (hi - lo)) * (h - 8));
  const pts = (a, b) => xs.slice(a, b).map((x, i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${ys[a + i].toFixed(1)}`).join(' ');
  const k = arr.length - 1 - win;
  return `<svg class="gro-spark${state ? ` is-${state}` : ''}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>
    <path d="${pts(0, k + 1)}" class="gro-sp-ctx"/><path d="${pts(k, arr.length)}" class="gro-sp-now"/>
    <circle cx="${xs.at(-1).toFixed(1)}" cy="${ys.at(-1).toFixed(1)}" r="3.5" class="gro-sp-end"/></svg>`;
}

// ── potential: the track runs to what his best weeks lead to; the bar is now; the tick is where his goals sit ──
export function bullet({ now, goal, pot }) {
  return `<span class="gro-bul" style="--now:${now ?? 0};--pot:${pot ?? now ?? 0}${goal != null ? `;--goal:${goal}` : ''}" aria-hidden="true">
    <i class="gro-bul-pot"></i><i class="gro-bul-now"></i>${goal != null ? '<i class="gro-bul-goal"></i>' : ''}</span>`;
}

// ── last night: the nine parts of the wheel on a ring, in wheel order, and the threads she drew between them ──
export function constellation(dream, active = null) {
  const S = 300, C = S / 2, R = 104;
  const pos = {};
  ASPECTS.forEach((a, i) => { const t = (-90 + i * 40) * Math.PI / 180; pos[a.id] = [C + R * Math.cos(t), C + R * Math.sin(t), t]; });
  const used = new Set(dream.connections.flatMap((c) => c.aspects));
  // each thread's number sits on its own curve: the segment midpoint farthest from the numbers already placed
  const placed = [];
  const threads = dream.connections.map((c, k) => {
    const pts = c.aspects.map((id) => pos[id]);
    const segs = [], mids = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      // bow each thread toward the centre, so threads read as connections, not as the ring
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      const qx = mx + (C - mx) * 0.42, qy = my + (C - my) * 0.42;
      segs.push(`M${x1.toFixed(1)} ${y1.toFixed(1)}Q${qx.toFixed(1)} ${qy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`);
      mids.push([0.25 * x1 + 0.5 * qx + 0.25 * x2, 0.25 * y1 + 0.5 * qy + 0.25 * y2]);
    }
    const score = ([x, y]) => (placed.length ? Math.min(...placed.map(([a, b]) => Math.hypot(a - x, b - y))) : 0);
    const [bx, by] = mids.reduce((best, m) => (score(m) > score(best) ? m : best), mids[0]);
    placed.push([bx, by]);
    const on = active == null || active === c.id;
    return `<g class="gro-th${on ? '' : ' dim'}${active === c.id ? ' sel' : ''}" data-c="${c.id}" style="--k:${k}">
      ${segs.map((d) => `<path d="${d}" pathLength="1" class="gro-th-l"/>`).join('')}
      <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="11" class="gro-th-b"/><text x="${bx.toFixed(1)}" y="${(by + 4.5).toFixed(1)}" text-anchor="middle" class="gro-th-n">${k + 1}</text>
      <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="22" class="gro-th-hit" data-act="gro-thread" data-id="${c.id}"/>
    </g>`;
  }).join('');
  const nodes = ASPECTS.map((a) => {
    const [x, y, t] = pos[a.id];
    const lx = C + (R + 20) * Math.cos(t), ly = C + (R + 20) * Math.sin(t) + 4.5;
    const anchor = Math.abs(Math.cos(t)) < 0.25 ? 'middle' : Math.cos(t) > 0 ? 'start' : 'end';
    const on = used.has(a.id) && (active == null || dream.connections.find((c) => c.id === active)?.aspects.includes(a.id));
    return `<g class="gro-nd${on ? ' on' : ''}"><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${used.has(a.id) ? 6.5 : 4.5}" style="--c:var(--${a.id})" class="gro-nd-c${used.has(a.id) ? ' used' : ''}"/>
      <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" class="gro-nd-t">${a.name}</text></g>`;
  }).join('');
  const label = `Last night's connections: ${dream.connections.map((c, k) => `${k + 1}, ${c.title}, between ${c.aspects.map((id) => aspect(id).name).join(', ')}`).join('; ')}.`;
  return `<svg class="gro-cst" viewBox="-40 0 ${S + 80} ${S}" role="img" aria-label="${esc(label)}">
    <circle cx="${C}" cy="${C}" r="${R}" class="gro-cst-ring"/>
    ${threads}${nodes}
  </svg>`;
}

// ── the mood pad: pleasantness left to right, energy bottom to top. Drag 1:1, snap to the cell on release ──
export function moodPad(p, e, { compact = false } = {}) {
  const dots = [];
  for (let ee = 5; ee >= 1; ee--) for (let pp = 1; pp <= 5; pp++) dots.push(`<i style="--x:${pp};--y:${ee}"></i>`);
  return `<div class="gro-mood${compact ? ' sm' : ''}" data-p="${p ?? ''}" data-e="${e ?? ''}">
    <div class="gro-mood-word"><b>${p ? esc(moodWord(p, e)) : 'Drag to how you feel'}</b><small>${p ? moodSub(p, e) : 'Pleasant to the right, more energy up'}</small></div>
    <div class="gro-pad" role="slider" tabindex="0" aria-label="Mood and energy" aria-valuetext="${p ? esc(moodWord(p, e)) : 'Not set'}">
      <span class="gro-pad-ax t">More energy</span><span class="gro-pad-ax b">Less energy</span>
      <span class="gro-pad-ax l">Unpleasant</span><span class="gro-pad-ax r">Pleasant</span>
      <span class="gro-pad-dots" aria-hidden="true">${dots.join('')}</span>
      <span class="gro-pad-knob${p ? '' : ' off'}" style="--x:${p ?? 3};--y:${e ?? 3}" aria-hidden="true"></span>
    </div>
  </div>`;
}
const P_WORD = ['Unpleasant', 'A bit low', 'Neutral', 'Pleasant', 'Very pleasant'];
const E_WORD = ['very low energy', 'low energy', 'some energy', 'high energy', 'very high energy'];
export const moodSub = (p, e) => `${P_WORD[p - 1]}, ${E_WORD[e - 1]}`;
export function wirePad(root, onChange) {
  const box = $('.gro-mood', root); if (!box || box._wired) return; box._wired = true;
  const pad = $('.gro-pad', box), knob = $('.gro-pad-knob', box);
  const cell = (cx, cy) => {
    const b = pad.getBoundingClientRect();
    const fx = Math.max(0, Math.min(1, (cx - b.left) / b.width)), fy = Math.max(0, Math.min(1, (cy - b.top) / b.height));
    return { fx, fy, p: Math.min(5, Math.floor(fx * 5) + 1), e: Math.min(5, 5 - Math.floor(fy * 5)) };
  };
  const set = (p, e, live) => {
    const changed = +box.dataset.p !== p || +box.dataset.e !== e;
    box.dataset.p = p; box.dataset.e = e;
    $('.gro-mood-word b', box).textContent = moodWord(p, e);
    $('.gro-mood-word small', box).textContent = moodSub(p, e);
    pad.setAttribute('aria-valuetext', moodWord(p, e));
    knob.classList.remove('off');
    if (changed) { haptic(4); onChange?.(p, e); }
    if (!live) { knob.style.removeProperty('left'); knob.style.removeProperty('top'); knob.style.setProperty('--x', p); knob.style.setProperty('--y', e); }
  };
  let down = false;
  const move = (ev) => {
    const c = cell(ev.clientX, ev.clientY);
    knob.style.left = `${c.fx * 100}%`; knob.style.top = `${c.fy * 100}%`;
    set(c.p, c.e, true);
  };
  pad.addEventListener('pointerdown', (ev) => { down = true; pad.setPointerCapture?.(ev.pointerId); knob.classList.add('drag'); move(ev); });
  pad.addEventListener('pointermove', (ev) => { if (down) move(ev); });
  const up = () => { if (!down) return; down = false; knob.classList.remove('drag'); set(+box.dataset.p, +box.dataset.e, false); };
  pad.addEventListener('pointerup', up); pad.addEventListener('pointercancel', up);
  pad.addEventListener('keydown', (ev) => {
    let p = +box.dataset.p || 3, e = +box.dataset.e || 3;
    if (ev.key === 'ArrowRight') p++; else if (ev.key === 'ArrowLeft') p--; else if (ev.key === 'ArrowUp') e++; else if (ev.key === 'ArrowDown') e--; else return;
    ev.preventDefault(); set(Math.max(1, Math.min(5, p)), Math.max(1, Math.min(5, e)), false);
  });
}
// a mood as a small glyph: a dot placed on a 5×5 field, so a list can show it without a word
export const moodDot = (p, e) => (p && e ? `<span class="gro-md" style="--x:${p};--y:${e}" aria-hidden="true"><i></i></span>` : '<span class="gro-md none" style="--x:3;--y:3" aria-hidden="true"><i></i></span>');

// ── a month of the journal: written days tinted by mood (one hue, more is a better mood), today ringed ──
export function monthGrid(y, m, { extra = {} } = {}) {
  const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
  const lead = (first.getDay() + 6) % 7;   // Monday first
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="gro-cal-c pad" aria-hidden="true"></span>');
  for (let i = 1; i <= days; i++) {
    const d = new Date(y, m, i), k = iso(d), info = day(k);
    const future = d > TODAY, today = sameDay(d, TODAY);
    if (future) { cells.push(`<span class="gro-cal-c fut" aria-hidden="true">${i}</span>`); continue; }
    if (today && info.written) { cells.push(`<button class="gro-cal-c w today" style="--m:${info.p}" data-act="gro-entry" data-date="${k}" aria-label="Today: ${esc(moodWord(info.p, info.e))}"><span>${i}</span></button>`); continue; }
    if (today) { cells.push(`<button class="gro-cal-c today" data-act="gro-write" aria-label="Today, not written yet. Write tonight's entry"><span>${i}</span></button>`); continue; }
    if (!info.written && extra[k]) { cells.push(`<button class="gro-cal-c w filled" style="--m:${extra[k].p}" data-act="gro-entry" data-date="${k}" aria-label="${i}: filled in later"><span>${i}</span></button>`); continue; }
    if (!info.written) { cells.push(`<button class="gro-cal-c miss" data-act="gro-backfill" data-date="${k}" aria-label="${i}, no entry. Fill it in"><span>${i}</span></button>`); continue; }
    cells.push(`<button class="gro-cal-c w" style="--m:${info.p}" data-act="gro-entry" data-date="${k}" aria-label="${i}: ${esc(moodWord(info.p, info.e))}${info.entry ? `, ${esc(info.entry.title)}` : ''}"><span>${i}</span>${info.entry ? '' : ''}</button>`);
  }
  return `<div class="gro-cal" role="group" aria-label="${monLong(m)} ${y}">
    <div class="gro-cal-h" aria-hidden="true">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div>
    <div class="gro-cal-g">${cells.join('')}</div>
  </div>`;
}

// ── the streak's week: Monday to Sunday, written days filled, tonight ringed ──
export function weekRow(start, { saved = false } = {}) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i), k = iso(d), t = sameDay(d, TODAY), fut = d > TODAY;
    const done = t ? saved : day(k).written;
    out.push(`<span class="gro-wk-d${done ? ' on' : ''}${t ? ' now' : ''}${fut ? ' fut' : ''}"><i aria-hidden="true">${done ? '<svg viewBox="0 0 12 12"><path d="M2.6 6.4l2.2 2.2 4.6-5"/></svg>' : ''}</i><small>${['M', 'T', 'W', 'T', 'F', 'S', 'S'][i]}</small></span>`);
  }
  return `<span class="gro-wk" role="img" aria-label="This week: ${out.filter((x) => x.includes(' on')).length} days written">${out.join('')}</span>`;
}

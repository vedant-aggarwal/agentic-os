// Mission's charts, as plain SVG and HTML strings. Owner: the Mission agent.
// Specs (the dataviz method): 2px lines with round joins, a 10% wash under the one series that matters, hairline grids,
// text in ink tokens (never the series colour), selective labels, a legend for two or more series, and every chart
// has a table twin. The accent is --as (the app's colour); time and context are ink; behind is --needs.
import { esc } from '../core.js';

const f1 = (n) => Number(n).toFixed(1);

// ── a goal's pace: progress over its window against the straight line you'd be on if you were on pace ──
// hist: [[label, x 0–1, p 0–1]…] · t: how much of the window has gone · axis: [start, now, end] labels
export function paceChart({ hist = [], t = 0, axis = ['', '', ''], name = 'Done' }) {
  const W = 338, H = 156, L = 34, R = 18, T = 14, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const X = (x) => L + x * pw, Y = (p) => T + (1 - Math.min(1, p)) * ph;
  const pts = hist.map(([lab, x, p]) => ({ lab, x: X(x), y: Y(p), p, pace: x }));
  const last = pts.at(-1) ?? { x: X(t), y: Y(0), p: 0 };
  const line = pts.map((q, i) => `${i ? 'L' : 'M'}${f1(q.x)} ${f1(q.y)}`).join(' ');
  const area = pts.length ? `${line} L${f1(last.x)} ${f1(Y(0))} L${f1(pts[0].x)} ${f1(Y(0))} Z` : '';
  const grid = [0, 0.5, 1].map((p) => `<line x1="${L}" x2="${W - R}" y1="${f1(Y(p))}" y2="${f1(Y(p))}" class="mc-grid"/><text x="${L - 8}" y="${f1(Y(p) + 4)}" text-anchor="end" class="mc-tick">${p === 1 ? '100%' : Math.round(p * 100)}</text>`).join('');
  const tx = X(t);
  const paceY = Y(t);
  const gap = last.p - t;
  const gapMark = Math.abs(gap) >= 0.1
    ? `<line x1="${f1(tx)}" x2="${f1(tx)}" y1="${f1(Math.min(paceY, last.y) + 6)}" y2="${f1(Math.max(paceY, last.y) - 6)}" class="mc-gap ${gap < 0 ? 'behind' : 'ahead'}"/>
       <text x="${f1(tx + 9)}" y="${f1((paceY + last.y) / 2 + 4)}" class="mc-lab2">${Math.round(Math.abs(gap) * 100)} pts ${gap < 0 ? 'behind' : 'ahead'}</text>` : '';
  const marked = Math.abs(gap) >= 0.1;
  const vy = marked ? last.y + 4 : last.y - 11 < T + 6 ? last.y + 20 : last.y - 11;
  const vx = marked ? last.x - 10 : last.x;
  const svg = `<svg class="mis-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(name)}: ${Math.round(last.p * 100)}% done with ${Math.round(t * 100)}% of the time gone">
    ${grid}
    <line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" class="mc-pace"/>
    <text x="${f1(X(1) - 2)}" y="${f1(Y(1) - 6)}" text-anchor="end" class="mc-lab2">On pace</text>
    <line x1="${f1(tx)}" x2="${f1(tx)}" y1="${T - 4}" y2="${f1(Y(0))}" class="mc-now"/>
    ${area ? `<path d="${area}" class="mc-area"/>` : ''}
    ${line ? `<path d="${line}" class="mc-line"/>` : ''}
    ${gapMark}
    <circle cx="${f1(tx)}" cy="${f1(paceY)}" r="3.5" class="mc-pdot"/>
    <circle cx="${f1(last.x)}" cy="${f1(last.y)}" r="5" class="mc-dot"/>
    <text x="${f1(vx)}" y="${f1(vy)}" text-anchor="${marked ? 'end' : 'middle'}" class="mc-val">${Math.round(last.p * 100)}%</text>
    <text x="${L}" y="${H - 6}" class="mc-tick">${esc(axis[0])}</text>
    <text x="${f1(tx)}" y="${H - 6}" text-anchor="middle" class="mc-tick now">${esc(axis[1])}</text>
    <text x="${W - R}" y="${H - 6}" text-anchor="end" class="mc-tick">${esc(axis[2])}</text>
  </svg>`;
  const scrub = pts.map((q) => ({ x: q.x / W, h: `<b>${Math.round(q.p * 100)}%</b> done <span>${esc(q.lab)} · on pace ${Math.round(q.pace * 100)}%</span>` }));
  const table = `<table><thead><tr><th>When</th><th>Done</th><th>On pace</th></tr></thead><tbody>${hist.map(([lab, x, p]) => `<tr><td>${esc(lab)}</td><td>${Math.round(p * 100)}%</td><td>${Math.round(x * 100)}%</td></tr>`).join('')}</tbody></table>`;
  return chartBox(svg, scrub, table, [['line', name], ['ref', 'On pace']]);
}

// ── done against everything set, week by week since the life review ──
export function burnChart({ set, done, weeks }) {
  const W = 338, H = 176, L = 30, R = 58, T = 12, B = 26;
  if (set.length === 1) { set = [0, ...set]; done = [0, ...done]; weeks = [['Start', weeks[0]?.[1] ?? ''], [weeks[0]?.[0] ?? '', '']]; }
  const top = Math.max(1, ...set), step = top <= 4 ? 2 : top <= 10 ? 5 : top <= 50 ? 25 : 50, max = Math.ceil(top / step) * step;
  const pw = W - L - R, ph = H - T - B;
  const X = (i) => L + (i / Math.max(1, set.length - 1)) * pw, Y = (v) => T + (1 - v / max) * ph;
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${f1(X(i))} ${f1(Y(v))}`).join(' ');
  const n = set.length - 1;
  const grid = [0, ...(max % 2 ? [] : [max / 2]), max].map((v) => `<line x1="${L}" x2="${W - R}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" class="mc-grid"/><text x="${L - 8}" y="${f1(Y(v) + 4)}" text-anchor="end" class="mc-tick">${v}</text>`).join('');
  const months = weeks.map(([, m], i) => (m ? `<text x="${f1(X(i))}" y="${H - 6}" class="mc-tick">${m}</text>` : '')).join('');
  const svg = `<svg class="mis-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Goals set and done by week: ${set[n]} set, ${done[n]} done">
    ${grid}${months}
    <path d="${path(done)} L${f1(X(n))} ${f1(Y(0))} L${f1(X(0))} ${f1(Y(0))} Z" class="mc-area"/>
    <path d="${path(set)}" class="mc-ref"/>
    <path d="${path(done)}" class="mc-line"/>
    <circle cx="${f1(X(n))}" cy="${f1(Y(set[n]))}" r="4" class="mc-rdot"/>
    <circle cx="${f1(X(n))}" cy="${f1(Y(done[n]))}" r="5" class="mc-dot"/>
    <text x="${f1(X(n) + 10)}" y="${f1(Y(set[n]) + 4)}" class="mc-end">${set[n]} set</text>
    <text x="${f1(X(n) + 10)}" y="${f1(Y(done[n]) + 4)}" class="mc-end b">${done[n]} done</text>
  </svg>`;
  const scrub = set.map((v, i) => ({ x: X(i) / W, h: `<b>${done[i]}</b> done of <b>${v}</b> set <span>${esc(weeks[i][0])}</span>` }));
  const table = `<table><thead><tr><th>Week</th><th>Set</th><th>Done</th></tr></thead><tbody>${set.map((v, i) => `<tr><td>${esc(weeks[i][0])}</td><td>${v}</td><td>${done[i]}</td></tr>`).join('')}</tbody></table>`;
  return chartBox(svg, scrub, table, [['line', 'Done'], ['ref', 'Set']]);
}

// The frame every chart sits in: the plot, a scrub layer (the crosshair finds the nearest point), a legend, the numbers
function chartBox(svg, scrub, table, legend) {
  return `<div class="mis-chart" data-scrub='${esc(JSON.stringify(scrub))}'>
      <div class="mis-plot">${svg}<i class="mis-xh" aria-hidden="true"></i><div class="mis-tip overlay" role="status" aria-live="polite"></div></div>
      <div class="mis-legend">${legend.map(([k, l]) => `<span><i class="mk-${k}" aria-hidden="true"></i>${esc(l)}</span>`).join('')}</div>
      <details class="mis-tbl"><summary>Show the numbers</summary>${table}</details>
    </div>`;
}

// ── pace by goal: how far each goal sits from on pace, in points, grouped by horizon. Within ±10 counts as on pace.
//    The domain runs from 60 behind to 30 ahead (most goals sit behind; zero stays put); values sit in their own column ──
// rows: [{ id, name, gap (−1…1), group }]
export function paceBars(rows, groups) {
  const LO = -60, HI = 30;
  const pos = (v) => ((Math.max(LO, Math.min(HI, v)) - LO) / (HI - LO)) * 100;
  const z = pos(0), b1 = pos(-10), b2 = pos(10);
  const body = groups.map(([gid, gname]) => {
    const rs = rows.filter((r) => r.group === gid);
    if (!rs.length) return '';
    return `<p class="mis-pb-g">${esc(gname)}</p>${rs.map((r) => {
      const v = Math.round(r.gap * 100);
      const on = v >= -10;
      const a = pos(Math.min(0, v)), b = pos(Math.max(0, v));
      return `<button class="mis-pb-r" data-act="mis-goal" data-id="${r.id}" aria-label="${esc(r.name)}: ${v === 0 ? 'on pace' : `${Math.abs(v)} points ${v < 0 ? 'behind' : 'ahead'}`}">
        <span class="mis-pb-n">${esc(r.name)}</span>
        <span class="mis-pb-t"><i class="mis-pb-b ${on ? 'on' : 'behind'} ${v < 0 ? 'neg' : 'pos'}" style="left:${a}%;width:${Math.max(0.8, b - a)}%"></i></span>
        <span class="mis-pb-v met">${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v)}</span>
      </button>`;
    }).join('')}`;
  }).join('');
  const table = `<table><thead><tr><th>Goal</th><th>Points from on pace</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${Math.round(r.gap * 100)}</td></tr>`).join('')}</tbody></table>`;
  return `<div class="mis-pb" style="--z:${(z / 100).toFixed(4)};--b1:${(b1 / 100).toFixed(4)};--b2:${(b2 / 100).toFixed(4)}">
      <div class="mis-pb-axis" aria-hidden="true"><span class="l">Behind</span><span class="z">On pace</span><span class="r">Ahead</span></div>
      <div class="mis-pb-rows">${body}</div>
      <div class="mis-legend"><span><i class="mk-bar on" aria-hidden="true"></i>On pace or ahead</span><span><i class="mk-bar behind" aria-hidden="true"></i>Behind</span><span><i class="mk-band" aria-hidden="true"></i>Within 10 points</span></div>
      <details class="mis-tbl"><summary>Show the numbers</summary>${table}</details>
    </div>`;
}

// ── everything set since the review, as one bar: done, pending, missed, dropped ──
export function compBar(t) {
  const parts = [['done', 'Done', t.done], ['pending', 'Pending', t.pending], ['missed', 'Missed', t.missed], ['dropped', 'Dropped', t.dropped]];
  return `<div class="mis-comp" role="img" aria-label="${parts.map(([, l, v]) => `${l} ${v}`).join(', ')} of ${t.set} set">
      ${parts.map(([k, , v]) => `<i class="mis-cp ${k}" style="flex:${v}"></i>`).join('')}
    </div>
    <div class="mis-comp-l">${parts.map(([k, l, v]) => `<span><i class="mis-cp ${k}" aria-hidden="true"></i><b class="met">${v}</b>${l}</span>`).join('')}</div>`;
}

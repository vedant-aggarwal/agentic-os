// Body · shared pieces: icons, exercise thumbnails and demos, the muscle map, charts, illustrations, formatting.
// Owner: the Body agent. Classes and data-act names use the bod- prefix.
import { $, $$, esc } from '../core.js';
import { I } from '../icons.js';
import { EX, LEX, MUSCLES, exInfo, LIB_IMG } from './body-data.js';
import { FRONT, BACK, OUTLINE } from './body-map-paths.js';

// ── icons in the system's style (24 grid, 2px line) ──────────────────
const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const BI = {
  figure: s('<circle cx="12" cy="4.6" r="2.1"/><path d="M4.8 9.4c2.4.8 4.8 1.2 7.2 1.2s4.8-.4 7.2-1.2M12 10.6v4.1M12 14.7 9 21M12 14.7l3 6.3"/>'),
  history: s('<path d="M4 12.5A8.2 8.2 0 1 0 6.4 6.6L4 9"/><path d="M4 4.5V9h4.5"/><path d="M12 8.2v4.3l2.9 1.8"/>'),
  fuel: s('<path d="M7 3.5v17M4.5 3.5v4.8a2.5 2.5 0 0 0 5 0V3.5"/><path d="M17.5 20.5v-17c-2.3 1.3-3.6 3.8-3.6 7.2v3.8h3.6"/>'),
  face: s('<path d="M12 3.4c-3.8 0-6.4 2.9-6.4 7.1 0 4.7 3 10.1 6.4 10.1s6.4-5.4 6.4-10.1c0-4.2-2.6-7.1-6.4-7.1Z"/><path d="M9.6 10.4h.01M14.4 10.4h.01M10.1 15.1c1.2.8 2.6.8 3.8 0"/>'),
  trophy: s('<path d="M8 4.5h8v4.6a4 4 0 0 1-8 0z"/><path d="M8 6.4H5.6a2.4 2.4 0 0 0 2.6 3.4M16 6.4h2.4a2.4 2.4 0 0 1-2.6 3.4M12 13.1v3.4M8.6 20.4h6.8M9.6 20.4l.5-3.9h3.8l.5 3.9"/>'),
  swap: s('<path d="M7 4.5 3.5 8 7 11.5M3.5 8h12.5M17 12.5l3.5 3.5-3.5 3.5M20.5 16H8"/>'),
  glass: s('<path d="M6.2 4h11.6l-1.6 15.1a2 2 0 0 1-2 1.8H9.8a2 2 0 0 1-2-1.8z"/><path d="M6.8 9.4c1.7-.8 3.5-.8 5.2 0s3.5.8 5.2 0"/>'),
  timer: s('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.6M9.5 2.8h5M18.4 6.6l1.3-1.3"/>'),
  bowl: s('<path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z"/><path d="M9 8c0-1.4.8-2.3 1.7-2.9M13.4 8c0-1.4.8-2.3 1.7-2.9"/>'),
  play: s('<path d="M8 5.6v12.8a.9.9 0 0 0 1.4.8l10-6.4a.9.9 0 0 0 0-1.6l-10-6.4A.9.9 0 0 0 8 5.6Z" fill="currentColor" stroke="none"/>'),
  watch: s('<rect x="6.5" y="6" width="11" height="12" rx="3.2"/><path d="M9 6l.6-2.5h4.8L15 6M9 18l.6 2.5h4.8L15 18M12 9.6V12l1.6 1"/>'),
  scale: s('<rect x="3.5" y="4" width="17" height="16" rx="4.5"/><path d="M8.5 9.2a5 5 0 0 1 7 0l-2.2 2.6a1.7 1.7 0 0 0-2.6 0z"/>'),
  leaf: I.leaf, heart: I.heart, flame: I.flame, moon: I.moon,
  spark: s('<path d="M3.5 16.5 8 11l3.5 3.5L16 8l4.5 4"/>'),
  plate: s('<circle cx="12" cy="12" r="8.6"/><circle cx="12" cy="12" r="4.4"/>'),
  sliders: s('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  drop: s('<path d="M12 3.5s6 6.4 6 10.6a6 6 0 0 1-12 0c0-4.2 6-10.6 6-10.6Z"/>'),
  minus: I.minus, plus: I.plus,
};

// ── formatting ───────────────────────────────────────────────────────
export const kg = (n) => `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const int = (n) => Math.round(n).toLocaleString('en-IN');
export const mins = (m) => m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ''}`.trim() : `${m} min`;
export const hmLen = (m) => `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} m`;
export const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
// one set, as read in a log: 45 kg × 6 · 12 reps · 45 s · 20 min · 1.9 km
export function setText(exId, set) {
  const k = set?.kind ?? exInfo(exId)?.kind ?? 'weight';
  if (k === 'cardio') return `${set.min} min${set.km ? ` · ${set.km} km` : ''}`;
  if (k === 'time') return `${set.t} s`;
  if (k === 'bw') return `${set.r} reps`;
  return set.w == null ? `${set.r} reps` : `${kg(set.w)} kg × ${set.r}`;
}
export function targetText(exId, t = {}, n = 3) {
  const k = exInfo(exId)?.kind ?? 'weight';
  if (k === 'cardio') return `${t.min} min`;
  if (k === 'time') return `${n} × ${t.t} s`;
  if (k === 'bw') return `${n} × ${t.r}`;
  return t.w == null ? `${n} × ${t.r} · pick a weight` : `${n} × ${t.r} · ${kg(t.w)} kg`;
}

// ── exercise media: frames from free-exercise-db (Unlicense), monochrome so Body's colour is the only colour ──
const src = (img, n = 0) => `assets/body/ex/${img}-${n}.jpg`;
// a library exercise (free-exercise-db) loads its frame from the project's GitHub; greyed in CSS like the curated ones
const libSrc = (lib, n = 0) => `${LIB_IMG}/${String(lib).split('/').map(encodeURIComponent).join('/')}/${n}.jpg`;
const media = (exId) => EX[exId] ?? LEX[exId] ?? (() => { const e = exInfo(exId); return e?.lib ? { lib: e.lib, name: e.name } : { art: 'dumbbell', name: e?.name ?? '' }; })();
export const thumb = (exId, cls = '') => {
  const e = media(exId);
  if (e.lib) return `<span class="bod-th bod-th-lib ${cls}" aria-hidden="true"><img src="${libSrc(e.lib)}" alt="" loading="lazy" decoding="async" onerror="this.remove()"></span>`;
  if (!e?.img) return `<span class="bod-th bod-th-art ${cls}" aria-hidden="true">${art(e?.art ?? 'bottle')}</span>`;
  return `<span class="bod-th ${cls}" style="--fx:${e.fx ?? 50}%" aria-hidden="true"><img src="${src(e.img)}" alt="" loading="lazy" decoding="async"></span>`;
};
// start and end frames, crossfading a few times like a looped clip; tap to play again
export const demo = (exId, cls = '') => {
  const e = media(exId);
  if (!e?.img && !e?.lib) return `<div class="bod-demo bod-demo-art ${cls}">${art(e?.art ?? 'bottle', 'bod-art-lg')}</div>`;
  const f = (n) => (e.lib ? libSrc(e.lib, n) : src(e.img, n));
  return `<button class="bod-demo bod-playing${e.lib ? ' bod-demo-lib' : ''} ${cls}" data-act="bod-demo" aria-label="Replay how to do ${esc(e.name)}">
    <img class="bod-f0" src="${f(0)}" alt="${esc(e.name)}, start position" decoding="async">
    <img class="bod-f1" src="${f(1)}" alt="" decoding="async">
    <span class="bod-demo-tags" aria-hidden="true"><i class="bod-t0">Start</i><i class="bod-t1">End</i></span>
  </button>`;
};

// ── the muscle map ───────────────────────────────────────────────────
// f: { group: fatigue 0..1 }. Intensity is fatigue stretched so the most worked muscle reads near full colour.
export const lit = (f) => Math.max(0, Math.min(1, (f - 0.05) / 0.5));
const VB = { front: '44 116 640 1240', back: '764 116 640 1240' };
export function bodyFig(side, f = {}, { cls = '', hot = null } = {}) {
  const paths = side === 'front' ? FRONT : BACK;
  return `<svg class="bod-fig ${cls}" viewBox="${VB[side]}" aria-hidden="true">
    <path class="bod-sil" d="${OUTLINE[side]}"/>
    ${paths.map(([g, d]) => g === 'base' ? `<path class="bod-base" d="${d}"/>`
      : `<path class="bod-m${hot === g ? ' bod-hot' : ''}" data-m="${g}" d="${d}" style="--bod-f:${lit(f[g] ?? 0).toFixed(3)}"/>`).join('')}
  </svg>`;
}
// both sides with labels; interactive maps open a muscle on tap
export function bodyPair(f, { cls = '', tap = false, label = 'Muscle map', hot = null } = {}) {
  const worked = Object.entries(f).filter(([, v]) => lit(v) > 0.2).sort((a, b) => b[1] - a[1]).map(([m]) => MUSCLES[m].name.toLowerCase());
  const aria = `${label}. ${worked.length ? `Worked recently: ${worked.join(', ')}.` : 'Everything is fresh.'}`;
  return `<div class="bod-pair ${cls}${tap ? ' bod-pair-tap' : ''}" role="img" aria-label="${esc(aria)}">
    <figure><span class="bod-fig-k">Front</span>${bodyFig('front', f, { hot })}</figure>
    <figure><span class="bod-fig-k">Back</span>${bodyFig('back', f, { hot })}</figure>
  </div>`;
}
// small maps for rows: one sprite, many <use>s, coloured through custom properties
let sprite = false;
function ensureSprite() {
  if (sprite) return; sprite = true;
  const sym = (side, paths) => `<symbol id="bod-sym-${side}" viewBox="${VB[side]}"><path d="${OUTLINE[side]}" style="fill:var(--bod-sil)"/>${paths.map(([g, d]) => g === 'base'
    ? `<path d="${d}" style="fill:var(--bod-mus0)"/>`
    : `<path d="${d}" style="fill:color-mix(in oklch, var(--as) calc(var(--m-${g}, 0) * 100%), var(--bod-mus0))"/>`).join('')}</symbol>`;
  document.body.insertAdjacentHTML('beforeend', `<svg class="bod-sprite" aria-hidden="true" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden">${sym('front', FRONT)}${sym('back', BACK)}</svg>`);
}
export function miniMap(f, cls = '') {
  ensureSprite();
  const vars = Object.entries(f).map(([m, v]) => `--m-${m}:${lit(v).toFixed(2)}`).join(';');
  return `<span class="bod-mini ${cls}" style="${vars}" aria-hidden="true"><svg viewBox="${VB.front}"><use href="#bod-sym-front"/></svg><svg viewBox="${VB.back}"><use href="#bod-sym-back"/></svg></span>`;
}
// the fatigue a list of exercises puts on each muscle (for previews and summaries): primary full, secondary half
export function workedBy(items) {
  const f = {};
  for (const it of items) {
    const e = exInfo(it.ex, it); if (!e) continue;
    const n = (Array.isArray(it.sets) ? it.sets.filter((x) => !x.warm && x.done !== false).length : Number(it.sets) || it.n || 3) || 1;
    e.p.forEach((m) => { f[m] = (f[m] ?? 0) + n; });
    e.s.forEach((m) => { f[m] = (f[m] ?? 0) + n * 0.35; });
  }
  // the most worked muscle reads at full colour, the rest in proportion
  const top = Math.max(0, ...Object.values(f));
  if (top) for (const m in f) f[m] = 0.05 + (f[m] / top) * 0.5;
  return f;
}
// the light-up: muscles start unlit and fill to their value, top of the body first
export function lightUp(root, delay = 120) {
  const ms = $$('.bod-m', root);
  if (!ms.length) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  ms.forEach((m) => { m.dataset.v = m.style.getPropertyValue('--bod-f'); m.style.transition = 'none'; m.style.setProperty('--bod-f', '0'); });
  root.getBoundingClientRect();
  requestAnimationFrame(() => ms.forEach((m) => {
    const box = m.getBBox?.(); const y = box ? box.y : 600;
    m.style.transition = '';
    m.style.transitionDelay = `${delay + Math.round((y - 116) / 1240 * 520)}ms`;
    m.style.setProperty('--bod-f', m.dataset.v);
  }));
}

// ── charts. Thin marks, hairline solid grid, the series in --as, labels in ink; one series, no legend ──
const r1 = (n) => Math.round(n * 10) / 10;
// points: [{ x: 0..n, v, label }] · opts: { w, h, min, max, ticks, goal: { v, label }, ahead: [{ x, v }], xl: [[x, text]], fmt, unit, title }
export function lineChart(points, o = {}) {
  const W = o.w ?? 338, H = o.h ?? 150, padL = 4, padR = o.padR ?? 34, padT = 14, padB = 22;
  const xs = [...points.map((p) => p.x), ...(o.ahead ?? []).map((p) => p.x)];
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const vals = [...points.map((p) => p.v), ...(o.ahead ?? []).map((p) => p.v), ...(o.goal ? [o.goal.v] : [])];
  const min = o.min ?? Math.floor(Math.min(...vals)), max = o.max ?? Math.ceil(Math.max(...vals));
  const X = (x) => padL + (x - x0) / Math.max(1e-6, x1 - x0) * (W - padL - padR);
  const Y = (v) => padT + (1 - (v - min) / Math.max(1e-6, max - min)) * (H - padT - padB);
  const fmt = o.fmt ?? ((v) => `${r1(v)}`);
  const ticks = o.ticks ?? [min, (min + max) / 2, max];
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${r1(X(p.x))} ${r1(Y(p.v))}`).join(' ');
  const area = `${line} L${r1(X(points[points.length - 1].x))} ${H - padB} L${r1(X(points[0].x))} ${H - padB} Z`;
  const last = points[points.length - 1];
  const ahead = o.ahead?.length ? `<path class="bod-ln-ahead" d="M${r1(X(last.x))} ${r1(Y(last.v))} ${o.ahead.map((p) => `L${r1(X(p.x))} ${r1(Y(p.v))}`).join(' ')}"/>` : '';
  const pts = points.map((p) => ({ x: r1(X(p.x)), y: r1(Y(p.v)), t: p.label ?? '', v: fmt(p.v) }));
  return `<div class="bod-chart" data-scrub='${esc(JSON.stringify(pts))}' style="--h:${H}px">
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(o.title ?? 'Chart')}: ${esc(fmt(points[0].v))} to ${esc(fmt(last.v))}">
      ${ticks.map((t) => `<line class="bod-grid" x1="${padL}" x2="${W - padR + 4}" y1="${r1(Y(t))}" y2="${r1(Y(t))}"/><text class="bod-tick" x="${W - padR + 8}" y="${r1(Y(t)) + 4}">${esc(o.tickFmt ? o.tickFmt(t) : fmt(t))}</text>`).join('')}
      ${o.goal ? `<line class="bod-goal" x1="${padL}" x2="${W - padR + 4}" y1="${r1(Y(o.goal.v))}" y2="${r1(Y(o.goal.v))}"/><text class="bod-goal-t" x="${padL + 2}" y="${r1(Y(o.goal.v)) - 6}">${esc(o.goal.label)}</text>` : ''}
      <path class="bod-area" d="${area}"/>
      <path class="bod-ln" d="${line}"/>
      ${ahead}
      ${(o.marks ?? []).map((m) => `<circle class="bod-mark" cx="${r1(X(m.x))}" cy="${r1(Y(m.v))}" r="3"/>`).join('')}
      <circle class="bod-end" cx="${r1(X(last.x))}" cy="${r1(Y(last.v))}" r="4.5"/>
      ${(o.xl ?? []).map(([x, t], i, a) => `<text class="bod-xl" x="${r1(X(x))}" y="${H - 5}" text-anchor="${i === 0 ? 'start' : i === a.length - 1 ? 'end' : 'middle'}">${esc(t)}</text>`).join('')}
    </svg>
    <span class="bod-scrub" aria-hidden="true"><i></i><b></b></span>
  </div>`;
}
// columns: [{ label, v, plan, hi }] · opts: { w, h, max, target: { v, label }, fmt }
export function barChart(cols, o = {}) {
  const W = o.w ?? 338, H = o.h ?? 132, padT = 18, padB = 22, n = cols.length;
  const max = o.max ?? Math.max(...cols.map((c) => (c.v ?? 0) + (c.plan ?? 0)), o.target?.v ?? 0) * 1.08;
  const band = W / n, bw = Math.min(24, band * 0.56);
  const Y = (v) => padT + (1 - v / max) * (H - padT - padB);
  const base = H - padB;
  const fmt = o.fmt ?? ((v) => `${Math.round(v)}`);
  const col = (x, y0, y1, cls) => { const h = y0 - y1; if (h <= 0.5) return ''; const r = Math.min(4, h, bw / 2); return `<path class="${cls}" d="M${r1(x)} ${r1(y0)} V${r1(y1 + r)} Q${r1(x)} ${r1(y1)} ${r1(x + r)} ${r1(y1)} H${r1(x + bw - r)} Q${r1(x + bw)} ${r1(y1)} ${r1(x + bw)} ${r1(y1 + r)} V${r1(y0)} Z"/>`; };
  const pts = cols.map((c, i) => ({ x: r1(band * i + band / 2), y: r1(Y((c.v ?? 0) + (c.plan ?? 0))), t: c.tip ?? c.label, v: c.tipV ?? fmt(c.v ?? 0) }));
  return `<div class="bod-chart bod-bars" data-scrub='${esc(JSON.stringify(pts))}' data-snap="1" style="--h:${H}px">
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="${esc(o.title ?? 'Chart')}">
      <line class="bod-base-l" x1="0" x2="${W}" y1="${base}" y2="${base}"/>
      ${o.target ? `<line class="bod-goal" x1="0" x2="${W}" y1="${r1(Y(o.target.v))}" y2="${r1(Y(o.target.v))}"/><text class="bod-goal-t" x="${W}" y="${r1(Y(o.target.v)) - 5}" text-anchor="end">${esc(o.target.label)}</text>` : ''}
      ${cols.map((c, i) => {
        const x = band * i + (band - bw) / 2; const v = c.v ?? 0;
        const yv = Y(v); const yp = Y(v + (c.plan ?? 0));
        return `${col(x, base, yv, `bod-col${c.hi ? ' bod-hi' : ''}${c.off ? ' bod-dim' : ''}`)}${c.plan ? col(x, yv - (v ? 2 : 0), yp, 'bod-col bod-planned') : ''}
          ${c.cap ? `<text class="bod-cap" x="${r1(x + bw / 2)}" y="${r1(Math.min(yv, yp) - 5)}" text-anchor="middle">${esc(c.cap)}</text>` : ''}
          <text class="bod-xl${c.hi ? ' bod-hi' : ''}" x="${r1(x + bw / 2)}" y="${H - 5}" text-anchor="middle">${esc(c.label)}</text>`;
      }).join('')}
    </svg>
    <span class="bod-scrub" aria-hidden="true"><i></i><b></b></span>
  </div>`;
}
export function spark(vals, { w = 76, h = 26, cls = '' } = {}) {
  const min = Math.min(...vals), max = Math.max(...vals);
  const X = (i) => 2 + i / (vals.length - 1) * (w - 6), Y = (v) => 3 + (1 - (v - min) / Math.max(1e-6, max - min)) * (h - 6);
  const d = vals.map((v, i) => `${i ? 'L' : 'M'}${r1(X(i))} ${r1(Y(v))}`).join(' ');
  return `<svg class="bod-spark ${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><path d="${d}"/><circle cx="${r1(X(vals.length - 1))}" cy="${r1(Y(vals[vals.length - 1]))}" r="3"/></svg>`;
}
// sleep stages as lanes (Awake, REM, Core, Deep): position carries the stage, so one hue is enough
export function hypnogram(stages, from, { w = 338, h = 116 } = {}) {
  const lanes = { a: 0, r: 1, c: 2, d: 3 }; const names = ['Awake', 'REM', 'Core', 'Deep'];
  const total = stages.reduce((a, [, m]) => a + m, 0);
  const padL = 46, laneH = (h - 22) / 4;
  let t = 0;
  const bars = stages.map(([k, m]) => {
    const x = padL + t / total * (w - padL); const bw = Math.max(2, m / total * (w - padL) - 1.5); t += m;
    return `<rect class="bod-hyp bod-s${k}" x="${r1(x)}" y="${r1(lanes[k] * laneH + 4)}" width="${r1(bw)}" height="${r1(laneH - 8)}" rx="3"/>`;
  }).join('');
  const sum = (k) => stages.filter(([x]) => x === k).reduce((a, [, m]) => a + m, 0);
  const end = (from + total) % 1440;
  const hh = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return `<svg class="bod-hypno" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" role="img" aria-label="Last night: deep ${sum('d')} min, core ${sum('c')} min, REM ${sum('r')} min, awake ${sum('a')} min">
    ${names.map((n, i) => `<text class="bod-tick" x="0" y="${r1(i * laneH + laneH / 2 + 4)}">${n}</text><line class="bod-grid" x1="${padL}" x2="${w}" y1="${r1((i + 1) * laneH)}" y2="${r1((i + 1) * laneH)}"/>`).join('')}
    ${bars}
    <text class="bod-xl" x="${padL}" y="${h - 4}">${hh(from)}</text><text class="bod-xl" x="${w}" y="${h - 4}" text-anchor="end">${hh(end)}</text>
  </svg>`;
}
// press and drag across a chart to read it; the nearest point shows its value
export function wireScrub(root) {
  $$('.bod-chart[data-scrub]', root).forEach((c) => {
    if (c._wired) return; c._wired = true;
    const pts = JSON.parse(c.dataset.scrub); const svg = $('svg', c); const tip = $('.bod-scrub', c);
    const vb = svg.viewBox.baseVal;
    const at = (e) => {
      const r = svg.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * vb.width;
      let best = pts[0]; for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
      const px = best.x / vb.width * r.width; const py = best.y / vb.height * r.height;
      tip.style.setProperty('--x', `${px}px`); tip.style.setProperty('--y', `${py}px`);
      $('b', tip).textContent = `${best.v}${best.t ? `  ·  ${best.t}` : ''}`;
      const bw = $('b', tip).offsetWidth; tip.style.setProperty('--bx', `${Math.max(0, Math.min(r.width - bw, px - bw / 2))}px`);
      c.classList.add('bod-on');
    };
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture?.(e.pointerId); at(e); });
    c.addEventListener('pointermove', (e) => { if (c.classList.contains('bod-on')) at(e); });
    const off = () => c.classList.remove('bod-on');
    c.addEventListener('pointerup', () => setTimeout(off, 1400)); c.addEventListener('pointercancel', off);
  });
}

// ── Wyn inside Body: one line, her mark, what she noticed or did ─────
export const wyn = (text, cls = '') => `<div class="bod-wyn ${cls}"><span class="bod-wyn-i" aria-hidden="true">${I.sparkle}</span><p>${text}</p></div>`;

// ── illustrations: line drawings in ink, the move in Body's colour ────
const HEAD = '<path class="bod-ln" d="M44 26c12-14 40-14 50 4 4 7 4 14 2 20l9 14c1 3-1 4-4 5l2 6-3 3 2 5c-2 4-6 5-11 4-3 6-9 9-15 9"/><path class="bod-ln" d="M41 92c-6-8-11-22-9-38 1-12 5-21 12-28"/><circle class="bod-ln" cx="58" cy="58" r="4"/>';
const ARTS = {
  chinTuck: `<g transform="translate(14 6)"><g class="bod-ghost" transform="translate(12 0)">${HEAD}</g>${HEAD}<path class="bod-ln" d="M76 98l-2 22M44 96l-4 24"/></g><path class="bod-mv" d="M128 70h-22M112 63l-7 7 7 7"/>`,
  ctar: `<g transform="translate(14 6)">${HEAD}<path class="bod-ln" d="M76 98l-2 22M44 96l-4 24"/><circle class="bod-acc" cx="88" cy="92" r="9"/></g><path class="bod-mv" d="M118 52v20M111 65l7 7 7-7"/>`,
  headLift: '<path class="bod-ln" d="M16 98h92"/><path class="bod-ln" d="M30 98c4-8 10-12 18-12h44c6 0 10 4 12 12"/><g class="bod-ghost"><circle class="bod-ln" cx="124" cy="88" r="11"/></g><circle class="bod-ln" cx="122" cy="68" r="11"/><path class="bod-ln" d="M104 92l12-16"/><path class="bod-mv" d="M142 86V62M135 69l7-7 7 7"/>',
  tongue: `<g transform="translate(14 6)">${HEAD}<path class="bod-ln" d="M76 98l-2 22M44 96l-4 24"/><path class="bod-acc-ln" d="M68 66c8-6 18-6 26-2"/></g>`,
  chew: `<g transform="translate(14 6)">${HEAD}<path class="bod-ln" d="M76 98l-2 22M44 96l-4 24"/><ellipse class="bod-acc" cx="66" cy="78" rx="7" ry="11"/></g><path class="bod-mv" d="M120 58v34M113 65l7-7 7 7M113 85l7 7 7-7"/>`,
  lean: '<path class="bod-ln" d="M40 104c0-22 8-36 22-40M120 104c0-22-8-36-22-40"/><circle class="bod-ln" cx="80" cy="40" r="18"/><path class="bod-acc-ln" d="M66 52c8 8 20 8 28 0"/><path class="bod-mv" d="M30 28h18M112 28h18"/>',
  bottle: '<rect class="bod-ln" x="58" y="34" width="44" height="74" rx="10"/><path class="bod-ln" d="M70 34V24h20v10M72 16h16"/><path class="bod-acc-ln" d="M70 62h20M70 74h14"/>',
  sun: '<circle class="bod-acc" cx="80" cy="60" r="16"/><path class="bod-ln" d="M80 24v10M80 86v10M44 60h10M106 60h10M55 35l7 7M98 78l7 7M55 85l7-7M98 42l7-7"/>',
  drop: '<path class="bod-ln" d="M80 22s26 28 26 46a26 26 0 0 1-52 0c0-18 26-46 26-46Z"/><path class="bod-acc-ln" d="M70 70a10 10 0 0 0 10 10"/>',
  hang: '<path class="bod-ln" d="M36 16h88"/><path class="bod-acc-ln" d="M66 16v22M94 16v22"/><circle class="bod-ln" cx="80" cy="34" r="9"/><path class="bod-ln" d="M66 38c2 14 6 22 14 24 8-2 12-10 14-24M80 62v26M80 88l-9 22M80 88l9 22"/>',
  sprint: '<circle class="bod-ln" cx="96" cy="24" r="9"/><path class="bod-ln" d="M92 34 80 62l-18 4M86 46l18 10 8-10M80 62l16 18-6 26M80 62l-14 22-20 4"/><path class="bod-mv" d="M20 50h22M14 64h22M24 78h18"/>',
  dumbbell: '<path class="bod-ln" d="M40 60h80"/><rect class="bod-acc" x="30" y="44" width="10" height="32" rx="3"/><rect class="bod-acc" x="120" y="44" width="10" height="32" rx="3"/><path class="bod-ln" d="M22 52v16M138 52v16"/>',
};
export const art = (k, cls = '') => `<svg class="bod-art ${cls}" viewBox="0 0 160 120" aria-hidden="true">${ARTS[k] ?? ARTS.bottle}</svg>`;

// the face diagrams the scan draws on: front (symmetry axis, jaw line) and side (neck–chin angle, head posture)
export function faceDiagram(side, { cm = 124, cva = 49 } = {}) {
  if (side === 'front') return `<svg class="bod-face" viewBox="0 0 120 140" aria-hidden="true">
    <path class="bod-ln" d="M60 12c24 0 36 18 35 44-1 18-5 32-15 44-7 8-14 12-20 12s-13-4-20-12C30 88 26 74 25 56 24 30 36 12 60 12Z"/>
    <path class="bod-acc-ln" d="M27 74c3 14 7 22 13 26 7 8 14 12 20 12s13-4 20-12c6-4 10-12 13-26"/>
    <path class="bod-ln" d="M46 106l-2 26M74 106l2 26M39 48c6-4 12-4 15-1M66 47c4-3 10-3 15 1M41 57c4-3 8-3 11 0M68 57c3-3 7-3 11 0M60 60l-3 16c2 2 5 2 7 1M51 90c6 3 12 3 18 0"/>
    <path class="bod-axis" d="M60 6v128"/>
    <circle class="bod-pt" cx="40" cy="57" r="1.8"/><circle class="bod-pt" cx="80" cy="57" r="1.8"/><circle class="bod-pt" cx="60" cy="76" r="1.8"/><circle class="bod-pt" cx="60" cy="112" r="1.8"/><circle class="bod-pt" cx="27" cy="74" r="1.8"/><circle class="bod-pt" cx="93" cy="74" r="1.8"/>
  </svg>`;
  return `<svg class="bod-face" viewBox="0 0 120 140" aria-hidden="true">
    <path class="bod-ln" d="M30 20c15-12 48-12 58 6 4 7 4 16 2 22l9 14c1 3-1 4-4 5l2 6-3 3 2 5c-2 4-6 5-11 4-1 4-3 7-7 7"/>
    <path class="bod-ln" d="M30 20C20 30 16 46 18 62c2 14 6 24 12 30M30 92l4 40"/>
    <path class="bod-ln" d="M78 92 68 101 64 132"/>
    <circle class="bod-ln" cx="46" cy="62" r="5"/>
    <path class="bod-acc-ln" d="M86 92 68 101 64 129"/>
    <path class="bod-acc-arc" d="M77 96.5a10 10 0 0 1-9.9 13.4"/>
    <text class="bod-ang" x="76" y="118">${cm}°</text>
    <path class="bod-axis" d="M34 130 46 62M10 130h52"/>
    <text class="bod-ang bod-dim2" x="8" y="124">${cva}°</text>
    <circle class="bod-pt" cx="86" cy="92" r="1.8"/><circle class="bod-pt" cx="68" cy="101" r="1.8"/><circle class="bod-pt" cx="46" cy="62" r="1.8"/>
  </svg>`;
}

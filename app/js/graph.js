// The graph engine for the Life map and the Brain: a force-directed graph on one canvas (devicePixelRatio aware).
// Spring links, charge, clusters on the wheel's angles (each aspect's colour), collision; settled before the first
// paint so it never explodes on screen, then it blooms out from the centre. Pan, pinch and wheel zoom with momentum
// and soft edges; tap a node to focus it (its neighbours light, the rest step back, its links pulse); labels fade in
// by zoom and never overlap; nodes can be you (the hub), aspects, areas, people, goals, projects, tasks and notes.
// Same layout every visit (positions seeded from the ids). Sleeps when nothing moves. Owner: MOTION (notes/motion.md).
//
// mountGraph(el, { nodes, links, colors, onTap }) → { update, focus, zoomTo, highlight, positions, resize, destroy }
import { SPRINGS, SpringSet, clock, clamp, lerp, reduced, onReduced, onVisible, tracker, project, rubberband, easeFn, haptic } from './motion.js';

// how each kind looks and weighs. label: the zoom at which its name fades in (0 = always)
const KIND = {
  hub: { r: 19, shape: 'hub', label: 0, charge: -700, pri: 9 },
  aspect: { r: 12, shape: 'core', label: 0, charge: -420, pri: 8 },
  area: { r: 6.5, shape: 'circle', label: 1.05, charge: -150, pri: 6 },
  person: { r: 8.5, shape: 'person', label: 0.9, charge: -170, pri: 7 },
  goal: { r: 5.6, shape: 'diamond', label: 1.3, charge: -100, pri: 5 },
  project: { r: 5.4, shape: 'square', label: 1.3, charge: -100, pri: 5 },
  task: { r: 3.1, shape: 'dot', label: 2.3, charge: -40, pri: 2 },
  note: { r: 3.4, shape: 'dot', label: 1.9, charge: -46, pri: 3 },
};
// the wheel's angles (as brain-graph.js): Self up and left, Work right, People down
export const WHEEL = { body: -122, mind: -90, soul: -58, mission: -2, money: 30, growth: 62, family: 118, romance: 150, friends: 182 };
const RAD = Math.PI / 180;
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const rand = (seed) => { let t = seed + 0x6d2b79f5; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const easeOut = easeFn('out');
const easeIO = easeFn('inOut');

/**
 * opts: nodes [{ id, label, kind, group, color?, size? (0–1, an aspect's score), ring? (0–1), hollow?, initial?, done?, x?, y? }],
 * links [{ source, target, dotted? } | [a, b]], colors { group: css colour } (default var(--<group>)), onTap(node|null),
 * root (the centre node's id, default the first hub), anchors { group: degrees } (default WHEEL, else spread evenly),
 * capture 'all' (one finger pans) | 'card' (inside a scrolling page: vertical swipes scroll the page), label (for
 * screen readers), minZoom, maxZoom, maxDpr, enter (bloom on mount, default true), padding.
 */
export function mountGraph(el, opts = {}) {
  const o = { colors: {}, capture: 'all', minZoom: 0.3, maxZoom: 4.5, maxDpr: 3, enter: true, padding: 28, label: 'Graph', ...opts };
  el.classList.add('fg');
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  const cv = document.createElement('canvas');
  cv.className = 'fg-cv';
  cv.setAttribute('role', 'img');
  cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none';
  cv.tabIndex = 0;
  el.append(cv);
  const a11y = document.createElement('ul');
  a11y.className = 'fg-a11y mx-vh';
  el.append(a11y);
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden';
  el.append(probe);
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  // ── colours from the skin's tokens (re-read when the skin or theme changes) ──────────────────────────────────────
  const colorCache = new Map();
  // any CSS colour (a token, color-mix, oklch …) → rgb(), through a 1×1 canvas so the canvas below can mix alpha into it
  const px = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const resolve = (c) => {
    if (colorCache.has(c)) return colorCache.get(c);
    probe.style.color = ''; probe.style.color = c; let v = getComputedStyle(probe).color || c;
    if (!/^rgba?\(/.test(v) && px) { px.clearRect(0, 0, 1, 1); px.fillStyle = '#000'; px.fillStyle = v; px.fillRect(0, 0, 1, 1); const d = px.getImageData(0, 0, 1, 1).data; v = `rgb(${d[0]}, ${d[1]}, ${d[2]})`; }
    colorCache.set(c, v); return v;
  };
  const rgba = (c, a) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return c; const p = m[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3); return `rgba(${p.join(',')},${a})`; };
  let T = {};
  const theme = () => {
    colorCache.clear(); glowCache.clear();
    const d = document.documentElement.dataset;
    T = { ink: resolve('var(--ink)'), ink2: resolve('var(--ink-2)'), ink3: resolve('var(--ink-3)'), sep: resolve('var(--sep, rgba(127,127,127,.2))'), bg: resolve('var(--e1, #111)'),
      skin: d.skin === 'matte' ? 'matte' : 'obsidian', light: d.theme === 'light', font: getComputedStyle(el).fontFamily || 'system-ui',
      round: getComputedStyle(el).getPropertyValue('--round').trim() || 'ui-rounded, system-ui' };
    for (const n of N) n._lw = null;
    T.glow = T.skin === 'obsidian' && !T.light;
    for (const n of N) n.c = colorOf(n);
  };
  const colorOf = (n) => resolve(n.color ?? o.colors[n.group] ?? (n.group ? `var(--${n.group}, var(--ink-2))` : n.kind === 'hub' ? 'var(--ink)' : 'var(--ink-2)'));
  const glowCache = new Map();
  const glow = (c) => {
    if (glowCache.has(c)) return glowCache.get(c);
    const g = document.createElement('canvas'); g.width = g.height = 128; const x = g.getContext('2d');
    const r = x.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, rgba(c, 0.55)); r.addColorStop(0.35, rgba(c, 0.22)); r.addColorStop(1, rgba(c, 0));
    x.fillStyle = r; x.fillRect(0, 0, 128, 128); glowCache.set(c, g); return g;
  };

  // ── the model ─────────────────────────────────────────────────────────────────────────────────────────────────
  let N = [], L = [], byId = new Map(), adj = new Map(), root = null;
  const anchorAng = (g) => {
    const A = o.anchors ?? WHEEL;
    if (A[g] != null) return A[g] * RAD;
    const gs = [...new Set(N.filter((n) => n.kind === 'aspect').map((n) => n.group))];
    const i = Math.max(0, gs.indexOf(g)); return (-90 + (360 * i) / Math.max(1, gs.length)) * RAD;
  };
  const RA = 150;   // the aspects' ring, world units
  function build(data, keep = new Map()) {
    const nodes = (data.nodes ?? []).map((d) => {
      const k = KIND[d.kind] ?? KIND.note;
      const old = keep.get(d.id);
      const n = { ...d, k, r: k.r * (d.kind === 'aspect' ? 0.72 + 0.6 * clamp(d.size ?? 0.5) : 1), vx: 0, vy: 0, fx: null, fy: null, e: 1, et: 1, appear: o.enter && !reduced() ? 0 : 1, dl: 0, gone: false, deg: 0 };
      if (old) { n.x = old.x; n.y = old.y; n.vx = old.vx; n.vy = old.vy; n.appear = old.appear; n.e = old.e; }
      return n;
    });
    byId = new Map(nodes.map((n) => [n.id, n]));
    const links = (data.links ?? []).map((l) => (Array.isArray(l) ? { source: l[0], target: l[1] } : l)).map((l) => ({ ...l, s: byId.get(l.source), t: byId.get(l.target) })).filter((l) => l.s && l.t && l.s !== l.t);
    adj = new Map(nodes.map((n) => [n.id, new Set()]));
    for (const l of links) { l.s.deg++; l.t.deg++; adj.get(l.s.id).add(l.t.id); adj.get(l.t.id).add(l.s.id); }
    root = byId.get(o.root) ?? nodes.find((n) => n.kind === 'hub') ?? null;
    // each node's parent: the link toward the centre (for the bloom and for placing new nodes)
    const depth = new Map(); if (root) { depth.set(root.id, 0); const q = [root]; while (q.length) { const n = q.shift(); for (const id of adj.get(n.id)) if (!depth.has(id)) { depth.set(id, depth.get(n.id) + 1); byId.get(id).parent = n; q.push(byId.get(id)); } } }
    for (const n of nodes) n.depth = depth.get(n.id) ?? 2;
    for (const l of links) {
      const a = l.s.k.shape, b = l.t.k.shape; const kinds = [l.s.kind, l.t.kind];
      l.dist = kinds.includes('hub') ? RA : kinds.includes('aspect') && !l.dotted ? (kinds.includes('person') ? 50 : kinds.includes('note') ? 44 : 56) : l.dotted ? 110 : (a === 'dot' || b === 'dot') ? 22 : 30;
      l.str = (l.dotted ? 0.12 : 1) / Math.max(1, Math.min(l.s.deg, l.t.deg));
      l.bias = l.s.deg / (l.s.deg + l.t.deg);
    }
    // seeded first positions near each group's spoke, so the layout is the same every time
    const kids = new Map();
    for (const n of nodes) {
      if (n.x != null && keep.has(n.id)) continue;
      if (d0(n.x) && d0(n.y)) continue;
      const ang = n.group ? anchorAng(n.group) : 0; const r0 = rand(hashStr(n.id));
      if (n === root) { n.x = 0; n.y = 0; continue; }
      if (n.kind === 'aspect') { n.x = Math.cos(ang) * RA; n.y = Math.sin(ang) * RA; continue; }   // (pinned below)
      const i = (kids.get(n.group) ?? 0) + 1; kids.set(n.group, i);
      const par = n.parent && keep.has(n.parent.id) ? n.parent : null;
      const rr = (par ? 20 : RA + 40 + (i % 4) * 14) + r0 * 18, aa = ang + (r0 - 0.5) * 0.9;
      n.x = (par ? par.x : 0) + Math.cos(aa) * rr; n.y = (par ? par.y : 0) + Math.sin(aa) * rr;
    }
    // the bloom's order: the hub, then each aspect round the wheel 45 ms apart, then what feeds it
    const clockwise = (n) => (anchorAng(n.group) + Math.PI / 2 + 4 * Math.PI) % (2 * Math.PI);
    const asp = nodes.filter((n) => n.kind === 'aspect').sort((p, q) => clockwise(p) - clockwise(q));
    asp.forEach((n, i) => { n.dl = 60 + i * 45; });
    const per = new Map();
    for (const n of nodes) if (n.kind !== 'aspect' && n !== root) { const base = n.parent?.dl ?? 120; const i = per.get(n.parent?.id) ?? 0; per.set(n.parent?.id, i + 1); n.dl = base + 140 + Math.min(i * 16, 240); }
    N = nodes; L = links;
    for (const n of N) { n.c = colorOf(n); if (n.kind === 'aspect' && o.wheel !== false && n.group) { const a = anchorAng(n.group); n.pin = [Math.cos(a) * RA, Math.sin(a) * RA]; } }
    a11yList();
  }
  const d0 = (v) => typeof v === 'number' && Number.isFinite(v);

  // ── the simulation (d3-force's model, with its alpha cooling) ───────────────────────────────────────────────────
  const sim = { alpha: 1, target: 0, min: 0.003, decay: 0.0228, vdecay: 0.4 };
  function tick() {
    sim.alpha += (sim.target - sim.alpha) * sim.decay;
    const a = sim.alpha;
    for (const l of L) {   // springs
      const s = l.s, t = l.t; let x = t.x + t.vx - s.x - s.vx || 1e-3, y = t.y + t.vy - s.y - s.vy || 1e-3;
      let d = Math.sqrt(x * x + y * y); d = ((d - l.dist) / d) * a * l.str; x *= d; y *= d;
      t.vx -= x * l.bias; t.vy -= y * l.bias; s.vx += x * (1 - l.bias); s.vy += y * (1 - l.bias);
    }
    charge(a);
    for (const n of N) {   // each group keeps to its spoke of the wheel; the hub holds the middle
      if (n === root) continue;
      if (!n.group) { n.vx -= n.x * 0.004 * a; n.vy -= n.y * 0.004 * a; continue; }
      const ang = anchorAng(n.group); const R = n.kind === 'aspect' ? RA : RA + 62;
      const kk = n.kind === 'aspect' ? 0.16 : 0.018;
      n.vx += (Math.cos(ang) * R - n.x) * kk * a; n.vy += (Math.sin(ang) * R - n.y) * kk * a;
    }
    collide();
    for (const n of N) {
      if (n === root && !n.fx) { n.x = 0; n.y = 0; n.vx = n.vy = 0; continue; }
      if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = n.vy = 0; continue; }
      if (n.pin) { n.x += (n.pin[0] - n.x) * 0.18; n.y += (n.pin[1] - n.y) * 0.18; n.vx = n.vy = 0; if (Math.abs(n.pin[0] - n.x) + Math.abs(n.pin[1] - n.y) > 0.3) sim.alpha = Math.max(sim.alpha, 0.02); continue; }
      n.vx *= 1 - sim.vdecay; n.vy *= 1 - sim.vdecay; n.x += n.vx; n.y += n.vy;
    }
  }
  function charge(a) {
    if (N.length <= 160) {
      for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
        const p = N[i], q = N[j]; let x = q.x - p.x, y = q.y - p.y, l = x * x + y * y || 1e-2;
        if (l > 90000) continue;
        if (l < 36) l = Math.sqrt(36 * l);
        const fp = (q.k.charge * a) / l, fq = (p.k.charge * a) / l;
        p.vx += x * fp; p.vy += y * fp; q.vx -= x * fq; q.vy -= y * fq;
      }
      return;
    }
    // Barnes–Hut for the big Brain: far groups act as one body (θ = 0.9)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of N) { if (n.x < x0) x0 = n.x; if (n.y < y0) y0 = n.y; if (n.x > x1) x1 = n.x; if (n.y > y1) y1 = n.y; }
    const size = Math.max(x1 - x0, y1 - y0) + 1;
    const rootQ = { x0, y0, s: size, kids: null, n: null, q: 0, cx: 0, cy: 0 };
    const insert = (c, n, depth = 0) => {
      if (!c.kids && !c.n) { c.n = n; return; }
      if (!c.kids) { if (depth > 24) { (c.extra ??= []).push(n); return; } c.kids = [null, null, null, null]; const m = c.n; c.n = null; place(c, m, depth); }
      place(c, n, depth);
    };
    const place = (c, n, depth) => { const h = c.s / 2; const i = (n.x >= c.x0 + h ? 1 : 0) + (n.y >= c.y0 + h ? 2 : 0); if (!c.kids[i]) c.kids[i] = { x0: c.x0 + (i & 1 ? h : 0), y0: c.y0 + (i & 2 ? h : 0), s: h, kids: null, n: null, q: 0, cx: 0, cy: 0 }; insert(c.kids[i], n, depth + 1); };
    for (const n of N) insert(rootQ, n);
    const sum = (c) => {
      if (!c) return; let q = 0, x = 0, y = 0;
      if (c.n || c.extra) { for (const n of [c.n, ...(c.extra ?? [])].filter(Boolean)) { q += n.k.charge; x += n.k.charge * n.x; y += n.k.charge * n.y; } }
      if (c.kids) for (const k of c.kids) { if (!k) continue; sum(k); q += k.q; x += k.q * k.cx; y += k.q * k.cy; }
      c.q = q; c.cx = q ? x / q : c.x0 + c.s / 2; c.cy = q ? y / q : c.y0 + c.s / 2;
    };
    sum(rootQ);
    const apply = (n, c) => {
      if (!c || !c.q) return;
      const x = c.cx - n.x, y = c.cy - n.y; let l = x * x + y * y || 1e-2;
      if (c.kids && (c.s * c.s) / 0.81 >= l) { for (const k of c.kids) apply(n, k); if (c.n && c.n !== n) direct(n, c.n); return; }
      if (!c.kids && (c.n === n && !c.extra)) return;
      if (l > 160000) return; if (l < 36) l = Math.sqrt(36 * l);
      n.vx += (x * c.q * a) / l; n.vy += (y * c.q * a) / l;
    };
    const direct = (n, m) => { const x = m.x - n.x, y = m.y - n.y; let l = x * x + y * y || 1e-2; if (l < 36) l = Math.sqrt(36 * l); n.vx += (x * m.k.charge * a) / l; n.vy += (y * m.k.charge * a) / l; };
    for (const n of N) apply(n, rootQ);
  }
  function collide() {   // a grid of buckets; each pair close enough is pushed apart
    const cell = 34; const grid = new Map();
    for (const n of N) { const k = `${Math.floor(n.x / cell)},${Math.floor(n.y / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)).push(n); }
    for (const n of N) {
      const gx = Math.floor(n.x / cell), gy = Math.floor(n.y / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const b = grid.get(`${gx + i},${gy + j}`); if (!b) continue;
        for (const m of b) {
          if (m === n || m.id < n.id) continue;
          const x = m.x + m.vx - n.x - n.vx, y = m.y + m.vy - n.y - n.vy; const r = n.r + m.r + 5; const l = x * x + y * y;
          if (l >= r * r || l === 0) continue;
          const d = Math.sqrt(l); const f = ((r - d) / d) * 0.6; const wx = x * f, wy = y * f;
          const share = m.r * m.r / (n.r * n.r + m.r * m.r);
          n.vx -= wx * share; n.vy -= wy * share; m.vx += wx * (1 - share); m.vy += wy * (1 - share);
        }
      }
    }
  }
  const settle = (n = 260) => { for (let i = 0; i < n && sim.alpha > sim.min; i++) tick(); };

  // ── the camera: springs for x, y and log zoom; momentum after a pan ──────────────────────────────────────────────
  const cam = new SpringSet({ x: 0, y: 0, z: 0 }, { spring: SPRINGS.gentle, onUpdate: () => wake() });
  const K = () => Math.exp(cam.values.z);
  let inertia = null, t0 = 0;
  const toScreen = (x, y, c = cam.values) => { const k = Math.exp(c.z); return [(x - c.x) * k + W / 2, (y - c.y) * k + H / 2]; };
  const toWorld = (sx, sy, c = cam.values) => { const k = Math.exp(c.z); return [(sx - W / 2) / k + c.x, (sy - H / 2) / k + c.y]; };
  const bounds = (list = N) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of list) { if (n.gone) continue; x0 = Math.min(x0, n.x - n.r - 18); y0 = Math.min(y0, n.y - n.r - 10); x1 = Math.max(x1, n.x + n.r + 18); y1 = Math.max(y1, n.y + n.r + 22); }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 };
  };
  const fitCam = (list, { pad = o.padding, min = o.minZoom, max = o.maxZoom } = {}) => {
    const b = bounds(list); const k = clamp(Math.min((W - pad * 2) / (b.x1 - b.x0), (H - pad * 2) / (b.y1 - b.y0)), min, max);
    return { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2, z: Math.log(k) };
  };
  const camTo = (c, { animate = true, velocity } = {}) => { inertia = null; if (!animate || reduced()) cam.jump(c); else cam.set(c, { velocity }); wake(); };
  // soft edges: the camera may not leave the graph behind; past the edge it resists, and springs back on release
  const camLimit = () => { const b = bounds(); return { x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, z0: Math.log(o.minZoom), z1: Math.log(o.maxZoom) }; };
  const band = (v, lo, hi, dim) => (v < lo ? lo + rubberband(v - lo, dim, 0.5) : v > hi ? hi + rubberband(v - hi, dim, 0.5) : v);
  const banded = (c) => { const L0 = camLimit(c); const k = Math.exp(c.z); return { x: band(c.x, L0.x0, L0.x1, W / k), y: band(c.y, L0.y0, L0.y1, H / k), z: band(c.z, L0.z0, L0.z1, 1.2) }; };
  const homeCam = (velocity) => { const c = cam.values; const L0 = camLimit(c); const t = { x: clamp(c.x, L0.x0, L0.x1), y: clamp(c.y, L0.y0, L0.y1), z: clamp(c.z, L0.z0, L0.z1) }; if (t.x !== c.x || t.y !== c.y || t.z !== c.z) camTo(t, { velocity }); };

  // ── focus and highlight ───────────────────────────────────────────────────────────────────────────────────────
  let focused = null, lit = null, pulses = [], hover = null;
  const emphasize = () => {
    for (const n of N) {
      n.et = !lit ? 1 : lit.has(n.id) ? (focused && n.id === focused.id ? 1 : 0.92) : 0.13;
    }
    wake();
  };
  function focus(id, { zoom = true, pulse = true, silent = false } = {}) {
    const n = id == null ? null : byId.get(typeof id === 'object' ? id.id : id);
    focused = n ?? null;
    lit = n ? new Set([n.id, ...adj.get(n.id)]) : null;
    emphasize();
    if (n) {
      if (!silent) haptic('selection');
      if (zoom) { const list = [...lit].map((i) => byId.get(i)).filter((m) => m !== root || n === root); const f = fitCam(list, { pad: Math.max(48, o.padding * 2), min: K(), max: Math.max(1.8, K()) }); camTo(f); }
      if (pulse && !reduced()) { const now = clock.now(); pulses = []; for (const m of adj.get(n.id)) for (let w = 0; w < 3; w++) pulses.push({ a: n, b: byId.get(m), t0: now + w * 520, d: 880 }); }
      cv.setAttribute('aria-label', `${o.label}. ${n.label ?? n.id}, linked to ${adj.get(n.id).size}`);
    } else { pulses = []; cv.setAttribute('aria-label', summary()); }
    return api;
  }
  function highlight(ids) { focused = null; lit = ids && ids.length ? new Set(ids) : null; pulses = []; emphasize(); return api; }

  // ── drawing ───────────────────────────────────────────────────────────────────────────────────────────────────
  let dirty = true;
  const shapes = {
    hub(n, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = T.skin === 'matte' ? T.ink : rgba(T.ink, 0.95); ctx.fill(); },
    core(n, x, y, r) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
      if (n.hollow) { ctx.lineWidth = Math.max(1.4, r * 0.18); ctx.strokeStyle = n.c; ctx.stroke(); return; }
      ctx.fillStyle = n.c; ctx.fill();
      if (T.skin === 'obsidian') { const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r); g.addColorStop(0, 'rgba(255,255,255,.42)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.fill(); }
    },
    circle(n, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = n.c; ctx.fill(); },
    person(n, x, y, r) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = rgba(n.c, T.skin === 'matte' ? 0.3 : 0.22); ctx.fill(); ctx.lineWidth = Math.max(1.2, r * 0.18); ctx.strokeStyle = n.c; ctx.stroke();
      const rs = r * K(); if (rs < 6.5) return;
      const fs = Math.max(7, r * 1.05); ctx.font = `700 ${fs}px ${T.round}`; ctx.fillStyle = T.ink; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      ctx.fillText((n.initial ?? n.label ?? '?')[0], x, y + fs * 0.04); ctx.textAlign = 'start';
    },
    diamond(n, x, y, r) { const q = r * 1.18; ctx.beginPath(); ctx.moveTo(x, y - q); ctx.lineTo(x + q, y); ctx.lineTo(x, y + q); ctx.lineTo(x - q, y); ctx.closePath(); ctx.fillStyle = n.c; ctx.fill(); },
    square(n, x, y, r) { const q = r * 0.92, rr = q * 0.42; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - q, y - q, q * 2, q * 2, rr) : ctx.rect(x - q, y - q, q * 2, q * 2); ctx.fillStyle = n.c; ctx.fill(); },
    dot(n, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); if (n.done) { ctx.lineWidth = Math.max(1, r * 0.4); ctx.strokeStyle = n.c; ctx.stroke(); } else { ctx.fillStyle = n.kind === 'note' && !n.group ? T.ink3 : n.c; ctx.fill(); } },
  };
  function render(now) {
    const c = cam.values; const k = Math.exp(c.z);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.scale(k, k); ctx.translate(-c.x, -c.y);
    const rk = Math.pow(k, -0.35);   // nodes grow slower than the zoom, so a close look stays readable
    for (const n of N) { const p = easeOut(n.appear); const par = n.parent ?? root; n.dp = p; if (p >= 1 || !par) { n.dx = n.x; n.dy = n.y; } else { n.dx = lerp(par.x, n.x, p); n.dy = lerp(par.y, n.y, p); } }
    // links: one path per look
    const groups = new Map();
    for (const l of L) {
      const ax = l.s.dx, ay = l.s.dy, ap = l.s.dp, bx = l.t.dx, by = l.t.dy, bp = l.t.dp;
      const vis = Math.min(ap, bp) * Math.min(l.s.e, l.t.e) * (l.s.gone || l.t.gone ? 0 : 1); if (vis < 0.02) continue;
      const on = lit && focused && (l.s === focused || l.t === focused);
      const key = `${on ? (l.s === focused ? l.t.c : l.s.c) : 'n'}|${l.dotted ? 1 : 0}|${Math.round(vis * 10)}`;
      (groups.get(key) ?? groups.set(key, { on, dotted: l.dotted, vis, c: on ? (l.s.kind === 'hub' ? l.t.c : l.s.kind === 'hub' ? l.s.c : (l.s === focused ? l.s.c : l.t.c)) : null, segs: [] }).get(key)).segs.push(ax, ay, bx, by);
    }
    for (const g of groups.values()) {
      ctx.beginPath();
      for (let i = 0; i < g.segs.length; i += 4) { ctx.moveTo(g.segs[i], g.segs[i + 1]); ctx.lineTo(g.segs[i + 2], g.segs[i + 3]); }
      ctx.lineWidth = (g.on ? 1.7 : 1) / k;
      ctx.setLineDash(g.dotted ? [2 / k, 4 / k] : []);
      ctx.strokeStyle = g.on ? rgba(g.c, 0.9) : rgba(T.ink, (T.light ? 0.16 : 0.13) * g.vis + (g.dotted ? 0.05 : 0));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // light: the hub and the aspects cast their colour onto the stone (Obsidian, dark only); Matte has none
    if (T.glow) {
      ctx.globalCompositeOperation = 'lighter';
      for (const n of N) {
        if ((n.kind !== 'aspect' && n !== focused) || n.hollow) continue;
        const x = n.dx, y = n.dy, p = n.dp; const R = n.r * rk * (n === focused ? 4.2 : 3.4) * (0.55 + 0.45 * p);
        ctx.globalAlpha = p * n.e * (n === focused ? 0.9 : 0.62); ctx.drawImage(glow(n.c), x - R, y - R + n.r * rk * 0.2, R * 2, R * 2);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // nodes: the dim ones first, so the lit ones sit on top
    for (let pass = 0; pass < 2; pass++) for (const n of N) {
      if ((n.e >= 0.5) !== (pass === 1)) continue;
      if (n.gone && n.appear <= 0.01) continue;
      const x = n.dx, y = n.dy, p = n.dp; if (p <= 0.001) continue;
      const r = n.r * rk * (0.55 + 0.45 * p);
      ctx.globalAlpha = p * (0.25 + 0.75 * n.e) * (n.e < 0.5 ? 0.6 : 1);
      shapes[n.k.shape](n, x, y, r);
      if (n.ring != null && !n.hollow) {   // an aspect's score, as the system's ring: track, then arc
        const rr = r + Math.max(2.6, 3.4 * rk); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(x, y, rr, 0, 7); ctx.lineWidth = 2.2 * rk; ctx.strokeStyle = rgba(n.c, 0.18); ctx.stroke();
        ctx.beginPath(); ctx.arc(x, y, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(n.ring) * easeOut(p)); ctx.strokeStyle = n.c; ctx.stroke();
      }
      if (n === focused) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(x, y, r + 5 * rk + 2 / k, 0, 7); ctx.lineWidth = 1.5 / k; ctx.strokeStyle = rgba(T.ink, 0.85); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    // pulses along the focused links
    pulses = pulses.filter((q) => now - q.t0 < q.d);
    for (const q of pulses) {
      const u = (now - q.t0) / q.d; if (u < 0) continue; const e = easeIO(u);
      const x = lerp(q.a.x, q.b.x, e), y = lerp(q.a.y, q.b.y, e); const s = (T.glow ? 3.2 : 2.4) / k;
      ctx.globalAlpha = Math.sin(Math.PI * u);
      if (T.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(glow(q.b.c), x - s * 4, y - s * 4, s * 8, s * 8); ctx.globalCompositeOperation = 'source-over'; }
      ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fillStyle = T.glow ? '#fff' : q.b.c; ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // labels, in screen space so the type stays crisp; the most important first, none overlapping
    // labels keep off the nodes themselves (the hub, aspects, people and the focused one)
    const placed = [];
    for (const n of N) {
      if (n.gone || n.dp < 0.6 || !(n.kind === 'hub' || n.kind === 'aspect' || n.kind === 'person' || n === focused)) continue;
      const [sx, sy] = toScreen(n.dx, n.dy, c); const r = n.r * rk * k + (n.ring != null ? 5 : 2);
      placed.push([sx - r, sy - r, sx + r, sy + r, n]);
    }
    const cand = [];
    for (const n of N) {
      if (n.gone || !n.label) continue;
      const x = n.dx, y = n.dy, p = n.dp; if (p < 0.6) continue;
      const lv = n.k.label; const forced = (lit && lit.has(n.id)) || n === hover;
      const za = lv === 0 ? 1 : clamp((k - lv) / 0.22 + 0.5);
      const a = (forced ? 1 : za) * clamp((p - 0.6) / 0.4) * (lit && !lit.has(n.id) ? 0.25 : 1);
      if (a < 0.03) continue;
      cand.push({ n, x, y, a, pri: (n === focused ? 20 : forced ? 12 : 0) + n.k.pri + (n.size ?? 0) });
    }
    cand.sort((p, q) => q.pri - p.pri);
    for (const c2 of cand) {
      const n = c2.n; const [sx, sy] = toScreen(c2.x, c2.y, c);
      const r = n.r * rk * k;
      const big = n.kind === 'hub' || n.kind === 'aspect' || n === focused;
      const font = `${big ? 650 : 550} ${big ? 12.5 : 11.5}px ${T.font}`; ctx.font = font;
      const text = n.kind === 'person' && k < 1.6 && n !== focused ? n.label.split(' ')[0] : n.label;
      if (!n._lw || n._lw[0] !== font + text) n._lw = [font + text, ctx.measureText(text).width];
      const w = n._lw[1]; const h = 14;
      const inside = n.kind === 'hub';
      // below the node first, then above, right, left; an aspect, the hub or the focused node always gets its name
      const gap = n.ring != null ? 7 : 4;
      const tries = inside ? [[sx - w / 2, sy - h / 2]] : [[sx - w / 2, sy + r + gap], [sx - w / 2, sy - r - gap - h], [sx + r + gap, sy - h / 2], [sx - r - gap - w, sy - h / 2]];
      // an aspect's name sits on the outside of the wheel, away from you, so neighbours never collide
      if (n.kind === 'aspect' && root) {
        const [hx, hy] = toScreen(root.dx ?? root.x, root.dy ?? root.y, c); let ux = sx - hx, uy = sy - hy; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
        const off = r + gap + Math.max(Math.abs(ux) * (w / 2), Math.abs(uy) * (h / 2));
        tries.unshift([sx + ux * off - w / 2, sy + uy * off - h / 2]);
      }
      const free = (bx) => !placed.some((b) => b[4] !== n && bx[0] < b[2] && bx[2] > b[0] && bx[1] < b[3] && bx[3] > b[1]);
      let lx = null, ly = null, box = null;
      for (const [tx, ty] of tries) { const bx = [tx - 3, ty - 1, tx + w + 3, ty + h + 1, n]; if (inside || free(bx)) { lx = tx; ly = ty; box = bx; break; } }
      if (box == null) { if (!(n.kind === 'aspect' || n === focused)) continue; [lx, ly] = tries[0]; box = [lx - 3, ly - 1, lx + w + 3, ly + h + 1, n]; }
      if (lx > W || lx + w < 0 || ly > H || ly + h < 0) continue;
      placed.push(box);
      ctx.globalAlpha = c2.a;
      ctx.textBaseline = 'top';
      if (inside) { ctx.fillStyle = T.skin === 'matte' ? T.bg : rgba(T.bg, 1); ctx.font = `700 ${Math.max(12, Math.min(22, r * 0.9))}px ${T.round}`; const tw = ctx.measureText(n.initial ?? text).width; ctx.fillText(n.initial ?? text, sx - tw / 2, sy - Math.max(12, Math.min(22, r * 0.9)) * 0.52); continue; }
      ctx.fillStyle = n === focused || big ? T.ink : T.ink2;
      ctx.fillText(text, lx, ly);
    }
    ctx.globalAlpha = 1;
  }

  // ── the loop ──────────────────────────────────────────────────────────────────────────────────────────────────
  let sub = null, visible = true, alive = true, last = 0;
  function wake() { dirty = true; if (alive && visible && !sub) { last = clock.now(); sub = clock.add(frame); } }
  function frame(now) {
    if (!alive || !visible) { sub = null; return false; }
    const dt = clamp(now - last, 0, 50); last = now;
    let busy = false;
    if (sim.alpha > sim.min || sim.target > 0) { tick(); busy = true; }
    for (const n of N) {
      if (n.appear < 1 && !n.gone) { n.appear = clamp((now - t0 - n.dl) / 620); busy = true; }
      if (n.gone) { n.appear = Math.max(0, n.appear - dt / 220); busy = true; }
      if (Math.abs(n.e - n.et) > 0.004) { n.e += (n.et - n.e) * (1 - Math.exp(-dt / 70)); busy = true; } else n.e = n.et;
    }
    if (N.some((n) => n.gone && n.appear <= 0)) { const keep = N.filter((n) => !n.gone || n.appear > 0); if (keep.length !== N.length) { N = keep; L = L.filter((l) => N.includes(l.s) && N.includes(l.t)); } }
    if (inertia) {
      const c = cam.values; const k = Math.exp(c.z);
      inertia.vx *= Math.pow(0.998, dt); inertia.vy *= Math.pow(0.998, dt);
      const nc = banded({ x: c.x - (inertia.vx * dt) / 1000 / k, y: c.y - (inertia.vy * dt) / 1000 / k, z: c.z });
      cam.jump(nc);
      if (Math.hypot(inertia.vx, inertia.vy) < 12) { inertia = null; homeCam(); } else busy = true;
    }
    if (cam.moving) busy = true;
    if (pulses.length) busy = true;
    if (busy || dirty) { render(now); dirty = false; }
    if (!busy && !g.down.size) { sub = null; return false; }
    return true;
  }

  // ── gestures ──────────────────────────────────────────────────────────────────────────────────────────────────
  const g = { down: new Map(), mode: null, node: null, start: null, vt: tracker(), lastTap: 0, moved: false };
  const hit = (sx, sy) => {
    const [wx, wy] = toWorld(sx, sy); const k = K(); const rk = Math.pow(k, -0.35);
    let best = null, bd = Infinity;
    for (const n of N) { if (n.gone || n.appear < 0.5) continue; const d = Math.hypot(n.x - wx, n.y - wy) * k; const reach = Math.max(20, n.r * rk * k + 8); if (d < reach && d < bd) { bd = d; best = n; } }
    return best;
  };
  const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.style.touchAction = o.capture === 'card' ? 'pan-y' : 'none';
  cv.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const [x, y] = local(e);
    g.down.set(e.pointerId, { x, y, x0: x, y0: y });
    try { cv.setPointerCapture(e.pointerId); } catch {}
    inertia = null; cam.stop();
    if (g.down.size === 1) {
      g.mode = 'press'; g.node = hit(x, y); g.moved = false; g.start = { cam: cam.values, x, y, t: clock.now() };
      g.vt.reset(); g.vt.add(x, y);
    } else if (g.down.size === 2) {
      if (g.mode === 'node' && g.node) { g.node.fx = g.node.fy = null; sim.target = 0; }
      const [p, q] = [...g.down.values()];
      g.mode = 'pinch'; g.start = { cam: cam.values, d: Math.hypot(p.x - q.x, p.y - q.y) || 1, m: [(p.x + q.x) / 2, (p.y + q.y) / 2] };
      g.start.w = toWorld(...g.start.m, g.start.cam);
    }
    wake();
  });
  cv.addEventListener('pointermove', (e) => {
    const [x, y] = local(e);
    if (!g.down.has(e.pointerId)) { if (e.pointerType === 'mouse') { const h = hit(x, y); if (h !== hover) { hover = h; cv.style.cursor = h ? 'pointer' : 'grab'; wake(); } } return; }
    const p = g.down.get(e.pointerId); p.x = x; p.y = y;
    if (g.mode === 'pinch' && g.down.size >= 2) {
      const [a, b] = [...g.down.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1; const m = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      const z = g.start.cam.z + Math.log(d / g.start.d); const k = Math.exp(z);
      cam.jump(banded({ x: g.start.w[0] - (m[0] - W / 2) / k, y: g.start.w[1] - (m[1] - H / 2) / k, z }));
      return;
    }
    const dx = x - g.start.x, dy = y - g.start.y;
    if (g.mode === 'press' && Math.hypot(dx, dy) > 6) {
      g.moved = true;
      if (g.node && g.node !== root) { g.mode = 'node'; sim.target = 0.22; sim.alpha = Math.max(sim.alpha, 0.22); }
      else g.mode = 'pan';
      g.start.x = x; g.start.y = y; g.start.cam = cam.values;
    }
    g.vt.add(x, y);
    if (g.mode === 'pan') { const k = Math.exp(g.start.cam.z); cam.jump(banded({ x: g.start.cam.x - (x - g.start.x) / k, y: g.start.cam.y - (y - g.start.y) / k, z: g.start.cam.z })); }
    if (g.mode === 'node') { const [wx, wy] = toWorld(x, y); g.node.fx = wx; g.node.fy = wy; wake(); }
  });
  const end = (e) => {
    if (!g.down.has(e.pointerId)) return;
    g.down.delete(e.pointerId);
    if (g.mode === 'pinch') { if (g.down.size === 1) { const [p] = [...g.down.values()]; g.mode = 'pan'; g.start = { cam: cam.values, x: p.x, y: p.y }; g.vt.reset(); } else if (!g.down.size) { g.mode = null; homeCam(); } return; }
    if (g.down.size) return;
    const mode = g.mode; g.mode = null;
    if (mode === 'node') { const v = g.vt.velocity(); const k = K(); g.node.vx = (v.x / k) * 0.016; g.node.vy = (v.y / k) * 0.016; g.node.fx = g.node.fy = null; sim.target = 0; wake(); return; }
    if (mode === 'pan') {
      const v = g.vt.velocity();
      if (!reduced() && Math.hypot(v.x, v.y) > 60) { inertia = { vx: v.x, vy: v.y }; wake(); } else homeCam();
      return;
    }
    if (mode === 'press' && e.type === 'pointerup') {
      const now = clock.now();
      if (!g.node && now - g.lastTap < 320) {   // double tap on the ground: zoom in there
        const [x, y] = local(e); const c = cam.values; const z = Math.min(Math.log(o.maxZoom), c.z + Math.log(2)); const k = Math.exp(z); const [wx, wy] = toWorld(x, y);
        camTo({ x: wx - (x - W / 2) / k, y: wy - (y - H / 2) / k, z }); g.lastTap = 0; return;
      }
      g.lastTap = now;
      if (g.node) { focus(g.node.id); o.onTap?.(g.node, api); } else if (focused || lit) { focus(null); o.onTap?.(null, api); }
    }
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (hover) { hover = null; wake(); } });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [x, y] = local(e); const c = cam.values;
    const z = c.z - e.deltaY * (e.ctrlKey ? 0.012 : 0.0018); const zc = clamp(z, Math.log(o.minZoom), Math.log(o.maxZoom)); const k = Math.exp(zc); const [wx, wy] = toWorld(x, y, c);
    inertia = null; cam.jump({ x: wx - (x - W / 2) / k, y: wy - (y - H / 2) / k, z: zc });
  }, { passive: false });
  cv.addEventListener('keydown', (e) => {
    const c = cam.values; const step = 60 / Math.exp(c.z);
    const m = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, -step, 0], ArrowDown: [0, step, 0], '+': [0, 0, 0.35], '=': [0, 0, 0.35], '-': [0, 0, -0.35] }[e.key];
    if (m) { e.preventDefault(); camTo({ x: c.x + m[0], y: c.y + m[1], z: clamp(c.z + m[2], Math.log(o.minZoom), Math.log(o.maxZoom)) }); }
    if (e.key === 'Escape' && (focused || lit)) { focus(null); o.onTap?.(null, api); }
  });

  // ── screen readers: the canvas says what it is; a hidden list lets you reach every node ─────────────────────────
  const summary = () => { const c = {}; for (const n of N) c[n.kind] = (c[n.kind] ?? 0) + 1; return `${o.label}: ${Object.entries(c).map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`).join(', ')}`; };
  function a11yList() {
    a11y.replaceChildren(...N.filter((n) => n.label).slice(0, 400).map((n) => { const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; b.tabIndex = -1; b.textContent = `${n.label}${n.kind ? `, ${n.kind}` : ''}`; b.addEventListener('click', () => { focus(n.id); o.onTap?.(n, api); }); li.append(b); return li; }));
    cv.setAttribute('aria-label', summary());
  }

  // ── size, skin, visibility ────────────────────────────────────────────────────────────────────────────────────
  function resize() {
    const r = el.getBoundingClientRect(); const w = Math.max(1, r.width), h = Math.max(1, r.height);
    dpr = Math.min(window.devicePixelRatio || 1, o.maxDpr);
    if (w === W && h === H && cv.width === Math.round(w * dpr)) return;
    const first = !W; W = w; H = h; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    if (first) cam.jump(fitCam(N)); wake();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(el);
  const mo = new MutationObserver(() => { theme(); wake(); });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin', 'data-theme'] });
  const offVis = onVisible(el, (v) => { visible = v; if (v) wake(); });
  const offRm = onReduced(() => wake());

  const api = {
    el, canvas: cv,
    /** Replace the data. Nodes that stay keep their place; new ones grow out of their neighbour; gone ones fade. */
    update(data, { reheat = 0.5, fit = false } = {}) {
      const keep = new Map(N.map((n) => [n.id, n]));
      const nextIds = new Set((data.nodes ?? []).map((n) => n.id));
      const leaving = N.filter((n) => !nextIds.has(n.id)).map((n) => ({ ...n, gone: true }));
      build(data, keep);
      for (const n of N) if (!keep.has(n.id)) { n.appear = reduced() ? 1 : 0; n.dl = 0; const p = n.parent; if (p) { n.x = p.x + (rand(hashStr(n.id)) - 0.5) * 30; n.y = p.y + (rand(hashStr(`${n.id}y`)) - 0.5) * 30; } }
      if (!reduced()) N.push(...leaving); else for (const n of leaving) n.appear = 0;
      t0 = clock.now();
      if (focused && !byId.has(focused.id)) { focused = null; lit = null; }
      else if (focused) focus(focused.id, { zoom: false, pulse: false, silent: true });
      sim.alpha = Math.max(sim.alpha, reheat);
      if (reduced()) settle(300);
      if (fit) camTo(fitCam(N.filter((n) => !n.gone)));
      wake(); return api;
    },
    focus, highlight,
    /** zoomTo('fit') · zoomTo(nodeId) · zoomTo({ ids: [...] }) · zoomTo({ x, y, k }); { animate } */
    zoomTo(t = 'fit', { animate = true } = {}) {
      let c;
      if (t === 'fit') c = fitCam(N.filter((n) => !n.gone));
      else if (typeof t === 'string') { const n = byId.get(t); if (!n) return api; const list = [n, ...[...adj.get(n.id)].map((i) => byId.get(i))]; c = fitCam(list, { pad: 56, min: o.minZoom, max: o.maxZoom }); }
      else if (t.ids) c = fitCam(t.ids.map((i) => byId.get(i)).filter(Boolean));
      else c = { x: t.x ?? cam.values.x, y: t.y ?? cam.values.y, z: Math.log(clamp(t.k ?? K(), o.minZoom, o.maxZoom)) };
      camTo(c, { animate }); return api;
    },
    /** Where every node is now ({ id: [x, y] }): keep it to give the next visit the same layout. */
    positions() { return Object.fromEntries(N.filter((n) => !n.gone).map((n) => [n.id, [Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10]])); },
    get focused() { return focused; },
    get zoom() { return K(); },
    resize,
    destroy() { alive = false; sub && clock.remove(sub); ro.disconnect(); mo.disconnect(); offVis(); offRm(); cv.remove(); a11y.remove(); probe.remove(); el.classList.remove('fg'); },
  };

  // first paint: settle the layout off screen, frame it, then bloom out from the centre
  build({ nodes: o.nodes, links: o.links });
  theme();
  settle(reduced() ? 400 : 300);
  sim.alpha = Math.min(sim.alpha, 0.05);
  resize();
  t0 = clock.now();
  wake();
  return api;
}

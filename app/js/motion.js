// The motion kit. Springs in Apple's terms (response + damping ratio: velocity-aware, interruptible, closed-form so they
// are exact at any frame rate), tweens and timelines on the Web Animations API, FLIP layout moves, staggered entrances,
// rolling numbers, path morphs, View Transitions, scroll effects, drag with momentum and rubber-banding, SF-Symbols-style
// glyph effects and one haptic hook. One clock drives everything that runs in JS and it sleeps when nothing moves.
// Transform and opacity only. Reduced motion: springs land at once, entrances become a short fade, loops stop.
// No dependencies, works offline in the app. Owner: MOTION. API and examples: v2/notes/motion.md.

const SVGNS = 'http://www.w3.org/2000/svg';
const html = () => document.documentElement;
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
const isEl = (x) => typeof Element !== 'undefined' && x instanceof Element;
export const toEls = (t) => (t == null ? [] : isEl(t) ? [t] : typeof t === 'string' ? [...document.querySelectorAll(t)] : [...t].filter(isEl));

// ── reduced motion: the system setting, or data-motion="reduced" on <html> (the lab's switch) ───────────────────────
const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reduced = () => !!mq?.matches || (typeof document !== 'undefined' && html().dataset.motion === 'reduced');
const rmSubs = new Set();
/** Call fn(isReduced) whenever the setting changes. Returns an unsubscribe. */
export function onReduced(fn) { rmSubs.add(fn); return () => rmSubs.delete(fn); }
if (typeof document !== 'undefined') {
  const tell = () => { const r = reduced(); rmSubs.forEach((f) => f(r)); };
  mq?.addEventListener?.('change', tell);
  new MutationObserver(tell).observe(html(), { attributes: true, attributeFilter: ['data-motion'] });
}

// ── the clock: one requestAnimationFrame loop for every JS animation. Subscribers get the absolute time (ms) and
//    return false to leave. clock.manual() freezes time and clock.step(ms) advances it frame by frame, so a test can
//    capture exact frames; clock.scale slows everything (the lab's slow motion). ────────────────────────────────────
const subs = new Set();
let raf = 0, manualT = null, scale = 1, base = { real: 0, virt: 0 };
const realNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const now = () => (manualT != null ? manualT : base.virt + (realNow() - base.real) * scale);
const run = (t) => {
  for (const fn of [...subs]) {
    let keep;
    try { keep = fn(t); } catch (e) { console.error('[motion]', e); keep = false; }
    if (keep === false) subs.delete(fn);
  }
};
const costs = [];
let profile = false;
const frame = () => {
  raf = 0;
  if (profile) { const a = realNow(); run(now()); costs.push(realNow() - a); if (costs.length > 600) costs.shift(); } else run(now());
  wake();
};
const wake = () => { if (!raf && manualT == null && subs.size) raf = requestAnimationFrame(frame); };
export const clock = {
  now,
  /** Run fn(timeMs) every frame until it returns false. Returns a remover. */
  add(fn) { subs.add(fn); wake(); return () => subs.delete(fn); },
  remove(fn) { subs.delete(fn); },
  get size() { return subs.size; },
  get scale() { return scale; },
  set scale(v) { const t = now(); base = { real: realNow(), virt: t }; scale = Math.max(0.02, Number(v) || 1); },
  manual(t) { manualT = t ?? now(); if (raf) cancelAnimationFrame(raf); raf = 0; },
  step(ms = 1000 / 60) { if (manualT == null) clock.manual(); manualT += ms; run(manualT); },
  auto() { if (manualT == null) return; base = { real: realNow(), virt: manualT }; manualT = null; wake(); },
  get isManual() { return manualT != null; },
  /** clock.profile = true records how long each frame's JS took (clock.costs, ms, the last 600 frames). */
  get profile() { return profile; },
  set profile(v) { profile = !!v; costs.length = 0; },
  get costs() { return [...costs]; },
};

// ── springs ──────────────────────────────────────────────────────────────────────────────────────────────────────
// response: seconds to (nearly) reach the target, not a duration. damping: 1 = no overshoot, lower = bouncier.
// The named ones are DESIGN.md's motion table, so every area reaches for the same feel.
export const SPRINGS = {
  default: { response: 0.4, damping: 1 },     // most UI: graceful, no overshoot
  snappy: { response: 0.3, damping: 1 },      // small things: thumbs, toggles, chips
  gentle: { response: 0.6, damping: 1 },      // big surfaces settling, colour and mood
  page: { response: 0.42, damping: 1 },       // push / pop
  sheet: { response: 0.42, damping: 1 },      // sheet detents
  flick: { response: 0.42, damping: 0.88 },   // a release that carried momentum
  lift: { response: 0.3, damping: 0.8 },      // lift a block
  drop: { response: 0.36, damping: 0.9 },     // drop / reposition
  land: { response: 0.36, damping: 0.86 },    // lands from a drag, keeps its velocity
  snap: { response: 0.35, damping: 0.85 },    // swipe snaps back
  fold: { response: 0.5, damping: 1 },        // folds and accordions
  thumb: { response: 0.32, damping: 1 },      // segmented thumb
  pill: { response: 0.36, damping: 0.82 },    // the tab pill
  reshape: { response: 0.55, damping: 0.82 }, // the rare rewarding moment (wheel re-score): a little overshoot
  jelly: { response: 0.5, damping: 0.42 },    // the orb let go after a drag
};
const cfgOf = (s) => (typeof s === 'string' ? SPRINGS[s] ?? SPRINGS.default : s === true || !s ? SPRINGS.default : s);

// The damped harmonic oscillator, solved: x0 is the displacement from the target, v0 the velocity (units/s).
// Returns t (s) -> [displacement, velocity].
function oscillator(x0, v0, response, damping) {
  const w0 = (2 * Math.PI) / Math.max(0.016, response);
  const z = Math.max(0, damping);
  if (Math.abs(z - 1) < 1e-3) {
    const A = x0, B = v0 + w0 * x0;
    return (t) => { const e = Math.exp(-w0 * t); return [e * (A + B * t), e * (B - w0 * (A + B * t))]; };
  }
  if (z < 1) {
    const a = z * w0, wd = w0 * Math.sqrt(1 - z * z), A = x0, B = (v0 + a * x0) / wd;
    return (t) => {
      const e = Math.exp(-a * t), c = Math.cos(wd * t), s = Math.sin(wd * t);
      return [e * (A * c + B * s), e * ((B * wd - a * A) * c - (A * wd + a * B) * s)];
    };
  }
  const q = Math.sqrt(z * z - 1), r1 = -w0 * (z - q), r2 = -w0 * (z + q), C1 = (v0 - r2 * x0) / (r1 - r2), C2 = x0 - C1;
  return (t) => { const e1 = Math.exp(r1 * t), e2 = Math.exp(r2 * t); return [C1 * e1 + C2 * e2, C1 * r1 * e1 + C2 * r2 * e2]; };
}

/** One animated number. set() retargets from the value on screen and keeps its velocity, so a grab mid-flight never jumps. */
export class Spring {
  constructor({ value = 0, to, velocity = 0, response, damping, spring, precision, onUpdate, onRest, _set } = {}) {
    const c = cfgOf(spring);
    this.v = value; this.vel = 0; this.to = value;
    this.response = response ?? c.response; this.damping = damping ?? c.damping; this.precision = precision;
    this.onUpdate = onUpdate; this.onRest = onRest; this._set = _set;
    this._f = null; this._t0 = 0; this._eps = 1e-3; this._tick = null; this._waits = [];
    if ((to != null && to !== value) || velocity) this.set(to ?? value, { velocity });
  }
  get value() { this._sync(); return this.v; }
  get velocity() { this._sync(); return this.vel; }
  get target() { return this.to; }
  get moving() { return !!this._f; }
  /** Go to `to` from wherever it is now. velocity (units/s) overrides the current one: hand it a finger's release speed. */
  set(to, { velocity, response, damping, spring, from } = {}) {
    this._sync();
    if (spring) { const c = cfgOf(spring); this.response = c.response; this.damping = c.damping; }
    if (response != null) this.response = response;
    if (damping != null) this.damping = damping;
    if (from != null) this.v = from;
    const v0 = velocity ?? this.vel;
    this.to = to;
    const x0 = this.v - to;
    if (reduced() || (Math.abs(x0) < 1e-6 && Math.abs(v0) < 1e-6)) return this.jump(to);
    this._eps = this.precision ?? Math.min(0.1, Math.max(1e-4, Math.abs(x0) * 5e-4, Math.abs(v0) * 2e-5));
    this._f = oscillator(x0, v0, this.response, this.damping);
    this._t0 = now();
    if (this._set) this._set._wake();
    else if (!this._tick) { this._tick = (t) => this._frame(t); clock.add(this._tick); }
    return this;
  }
  /** Be at v now, without animating (a finger is holding it, or reduced motion). */
  jump(v) {
    this._f = null; this.v = this.to = v; this.vel = 0;
    if (!this._set) { this.onUpdate?.(v, 0); this._settle(); }
    return this;
  }
  /** Freeze where it is (an interrupting grab). */
  stop() { this._sync(); this._f = null; this.to = this.v; this.vel = 0; this._release(); return this; }
  /** Resolves once it comes to rest (or is stopped). */
  rest() { return this._f ? new Promise((r) => this._waits.push(r)) : Promise.resolve(this.v); }
  _sync(t = now()) { if (this._f) this._advance(t); }
  _advance(t) {
    const [x, v] = this._f((t - this._t0) / 1000);
    if (Math.abs(x) < this._eps && Math.abs(v) < this._eps * 30) { this.v = this.to; this.vel = 0; return true; }
    this.v = this.to + x; this.vel = v; return false;
  }
  _frame(t) {
    if (!this._f) { this._tick = null; return false; }
    const done = this._advance(t);
    if (done) this._f = null;
    this.onUpdate?.(this.v, this.vel);
    if (done) { this._tick = null; this._settle(); return false; }
    return true;
  }
  _settle() { this.onRest?.(this.v); this._release(); }
  _release() { const w = this._waits; this._waits = []; w.forEach((r) => r(this.v)); }
}
export const spring = (opts) => new Spring(opts);

/** Several springs that move as one thing (x, y, scale …), one onUpdate per frame. 2D motion is two springs, as on iOS. */
export class SpringSet {
  constructor(initial, { response, damping, spring, precision, onUpdate, onRest } = {}) {
    this.ch = {};
    for (const k of Object.keys(initial)) this.ch[k] = new Spring({ value: initial[k], response, damping, spring, precision, _set: this });
    this.onUpdate = onUpdate; this.onRest = onRest; this._tick = null;
  }
  get values() { const o = {}; for (const k in this.ch) o[k] = this.ch[k].value; return o; }
  get velocities() { const o = {}; for (const k in this.ch) o[k] = this.ch[k].velocity; return o; }
  get moving() { return Object.values(this.ch).some((c) => c.moving); }
  set(targets, { velocity = {}, ...cfg } = {}) {
    for (const k of Object.keys(targets)) this.ch[k]?.set(targets[k], { ...cfg, velocity: velocity[k] });
    if (!this.moving) this._emit();
    return this;
  }
  jump(values) { for (const k of Object.keys(values)) this.ch[k]?.jump(values[k]); this._emit(); return this; }
  stop() { for (const k in this.ch) this.ch[k].stop(); if (this._tick) { clock.remove(this._tick); this._tick = null; } return this; }
  rest() { return Promise.all(Object.values(this.ch).map((c) => c.rest())); }
  _emit() { const v = {}, vel = {}; for (const k in this.ch) { v[k] = this.ch[k].v; vel[k] = this.ch[k].vel; } this.onUpdate?.(v, vel); }
  _wake() { if (!this._tick) { this._tick = (t) => this._frame(t); clock.add(this._tick); } }
  _frame(t) {
    let moving = false;
    for (const k in this.ch) { const c = this.ch[k]; if (c._f) { if (c._advance(t)) c._f = null; else moving = true; } }
    this._emit();
    if (!moving) { this._tick = null; for (const k in this.ch) this.ch[k]._release(); this.onRest?.(this.values); return false; }
    return true;
  }
}
export const springs = (initial, opts) => new SpringSet(initial, opts);

// A spring as a CSS easing: linear() sampled from the same oscillator, so a WAAPI or CSS transition rides the compositor
// with real spring physics. velocity is in progress per second (finger px/s ÷ distance), so a gesture hands its speed over.
const LINEAR_OK = typeof CSS !== 'undefined' && !!CSS.supports?.('transition-timing-function', 'linear(0, 1)');
const curveCache = new Map();
const r4 = (n) => +n.toFixed(4);
function simplify(pts, eps) {   // Ramer–Douglas–Peucker on the vertical error, which is what linear() interpolates
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  let dmax = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const [x, y] = pts[i]; const d = Math.abs(y - (ay + ((by - ay) * (x - ax)) / (bx - ax || 1)));
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}
/** { easing, duration } for CSS / WAAPI. springCurve('page'), springCurve({ response, damping }, { velocity }). */
export function springCurve(s = SPRINGS.default, { velocity = 0 } = {}) {
  const c = cfgOf(s);
  const key = `${c.response}|${c.damping}|${(+velocity).toFixed(2)}`;
  if (curveCache.has(key)) return curveCache.get(key);
  const f = oscillator(-1, velocity, c.response, c.damping);
  const dt = 1 / 240; const pts = [[0, 0]]; let t = 0, still = 0;
  while (t < 4) {
    t += dt; const [x, v] = f(t); pts.push([t, 1 + x]);
    if (Math.abs(x) < 6e-4 && Math.abs(v) < 0.02) { if (++still > 6) break; } else still = 0;
  }
  const T = t; const norm = simplify(pts.map(([x, y]) => [x / T, y]), 0.0009);
  norm[norm.length - 1] = [1, 1];
  const easing = LINEAR_OK
    ? `linear(${norm.map(([x, y], i) => (i === 0 ? `${r4(y)}` : i === norm.length - 1 ? '1' : `${r4(y)} ${+(x * 100).toFixed(2)}%`)).join(', ')})`
    : 'cubic-bezier(.22, 1, .36, 1)';
  const out = { easing, duration: Math.round(T * 1000), points: norm.length };
  curveCache.set(key, out);
  return out;
}

// ── easing ───────────────────────────────────────────────────────────────────────────────────────────────────────
// The shell's curves (css/system.css 1.5), plus one in-out for things that move across the screen.
export const EASE = {
  out: 'cubic-bezier(.22, 1, .36, 1)',      // = --ease: enter, exit, settle
  move: 'cubic-bezier(.32, .72, 0, 1)',     // = --ease-move: pages and sheets
  land: 'cubic-bezier(.2, .9, .25, 1)',     // = --spring: small things that land
  inOut: 'cubic-bezier(.77, 0, .175, 1)',   // on-screen moves and morphs
  sine: 'cubic-bezier(.37, 0, .63, 1)',     // breathing: no snap at either end
  linear: 'linear',
};
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t) => ((ax * t + bx) * t + cx) * t, Y = (t) => ((ay * t + by) * t + cy) * t, dX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0; if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) { const e = X(t) - x; if (Math.abs(e) < 1e-6) return Y(t); const d = dX(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
    let lo = 0, hi = 1; t = x;
    for (let i = 0; i < 24; i++) { const v = X(t); if (Math.abs(v - x) < 1e-6) break; if (x > v) lo = t; else hi = t; t = (lo + hi) / 2; }
    return Y(t);
  };
}
const fnCache = new Map();
/** A JS easing function for a name, a cubic-bezier() string, or a spring config. */
export function easeFn(e = 'out') {
  if (typeof e === 'function') return e;
  if (typeof e === 'object') { const c = cfgOf(e); const f = oscillator(-1, 0, c.response, c.damping); const T = springCurve(c).duration / 1000; return (k) => (k >= 1 ? 1 : 1 + f(k * T)[0]); }
  const s = EASE[e] ?? e;
  if (fnCache.has(s)) return fnCache.get(s);
  const m = /cubic-bezier\(([^)]+)\)/.exec(s);
  const f = m ? bezier(...m[1].split(',').map(Number)) : (k) => k;
  fnCache.set(s, f);
  return f;
}
const timing = (o = {}) => {
  if (o.spring) { const c = springCurve(o.spring, { velocity: o.velocity ?? 0 }); return { duration: c.duration, easing: c.easing }; }
  return { duration: o.duration ?? 240, easing: EASE[o.ease] ?? o.ease ?? EASE.out };
};

// ── tweens ───────────────────────────────────────────────────────────────────────────────────────────────────────
// tween(el, { transform, opacity } | { x, y, scale, rotate }, { from, duration, ease, spring, delay }) → Animation.
// It starts from what is on screen (a running tween on the same element is read, then replaced), and writes the end
// state into the element's style when it finishes, so nothing piles up as fill: forwards.
// tween(object, { n: 10 }, { duration, ease, onUpdate }) animates plain numbers on the clock.
const TF = ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'];
const n0 = (v) => +(v ?? 0);
export function toKeyframe(p = {}) {
  const o = { ...p };
  if (TF.some((k) => k in o)) {
    o.transform = `translate(${n0(o.x)}px, ${n0(o.y)}px) scale(${o.scaleX ?? o.scale ?? 1}, ${o.scaleY ?? o.scale ?? 1}) rotate(${n0(o.rotate)}deg)`;
    TF.forEach((k) => delete o[k]);
  }
  return o;
}
const running = new WeakMap();
function tweenEl(el, to, o) {
  to = toKeyframe(to);
  const props = Object.keys(to);
  const prev = running.get(el);
  let from = o.from && toKeyframe(o.from);
  if (!from) { const cs = getComputedStyle(el); from = Object.fromEntries(props.map((p) => [p, cs[p]])); }
  prev?.cancel();
  if (reduced()) {
    if ('opacity' in to) {   // reduced: only the fade is kept
      const a = el.animate([{ opacity: from.opacity ?? getComputedStyle(el).opacity }, { opacity: to.opacity }], { duration: 160, easing: EASE.out, fill: 'both' });
      a.finished.then(() => { try { a.commitStyles(); } catch {} a.cancel(); Object.assign(el.style, to); }).catch(() => {});
      return a;
    }
    Object.assign(el.style, to);
    return el.animate([to, to], { duration: 0, fill: 'none' });
  }
  const a = el.animate([from, to], { ...timing(o), delay: o.delay ?? 0, fill: 'both' });
  running.set(el, a);
  a.finished.then(() => {
    if (running.get(el) === a) running.delete(el);
    if (o.commit !== false) { try { a.commitStyles(); } catch {} a.cancel(); }
  }).catch(() => {});
  return a;
}
function tweenObj(obj, to, { duration = 240, ease = 'out', delay = 0, onUpdate, onComplete } = {}) {
  const from = Object.fromEntries(Object.keys(to).map((k) => [k, +obj[k] || 0]));
  const f = easeFn(ease);
  let done; const finished = new Promise((r) => { done = r; });
  let cancelled = false;
  if (reduced() || duration <= 0) { Object.assign(obj, to); onUpdate?.(obj); onComplete?.(); done(); return { finished, cancel() {} }; }
  const t0 = now() + delay;
  clock.add((t) => {
    if (cancelled) return false;
    if (t < t0) return true;
    const k = clamp((t - t0) / duration); const e = f(k);
    for (const key in to) obj[key] = from[key] + (to[key] - from[key]) * e;
    onUpdate?.(obj);
    if (k >= 1) { onComplete?.(); done(); return false; }
    return true;
  });
  return { finished, cancel() { cancelled = true; done(); } };
}
export function tween(target, to, opts = {}) {
  if (isEl(target)) return tweenEl(target, to, opts);
  if (target && typeof target === 'object' && !(typeof target.length === 'number' || typeof target === 'string')) return tweenObj(target, to, opts);
  const anims = toEls(target).map((el, i) => tweenEl(el, to, { ...opts, delay: (opts.delay ?? 0) + i * (opts.stagger ?? 0) }));
  return { anims, finished: Promise.all(anims.map((a) => a.finished.catch(() => {}))), cancel: () => anims.forEach((a) => a.cancel()) };
}
/** Show or hide an element with a fade and a small scale, from wherever it is now. */
export function presence(el, show, { y = 6, scale = 0.97, spring = SPRINGS.snappy, duration = 180 } = {}) {
  if (!el) return Promise.resolve();
  const busy = running.has(el);
  if (show) {
    const was = el.hidden; el.hidden = false;
    if (!was && !busy) return Promise.resolve();
    return tween(el, { opacity: 1, transform: 'none' }, { from: busy ? undefined : { opacity: 0, transform: `translateY(${y}px) scale(${scale})` }, spring }).finished;
  }
  if (el.hidden && !busy) return Promise.resolve();
  const a = tween(el, { opacity: 0, transform: `translateY(${y}px) scale(${scale})` }, { duration, ease: 'out', commit: false });
  return a.finished.then(() => { if (running.get(el) === undefined) { el.hidden = true; a.cancel(); el.style.opacity = ''; el.style.transform = ''; } }).catch(() => {});
}

// ── timelines: GSAP-style sequencing on WAAPI (seek, reverse and pause are the browser's, so they stay in sync) ─────
// const tl = timeline(); tl.to(a, { opacity: 1 }, { duration: 200 }).to(b, { y: 0 }, { spring: 'default' }, '<+=60')
//   .call(() => haptic('success')).play();
// Positions: a number (ms), '>' after the previous (default), '<' with the previous, '+=n' / '-=n' / '<+=n'.
export function timeline({ defaults = {}, onComplete } = {}) {
  const items = [], calls = [];
  let end = 0, prevStart = 0, prevEnd = 0, master = null, watching = false;
  const pos = (at) => {
    if (typeof at === 'number') return at;
    if (at == null || at === '>') return prevEnd;
    if (at === '<') return prevStart;
    const m = /^([<>])?([+-])=(\d+(?:\.\d+)?)$/.exec(String(at));
    if (m) return Math.max(0, (m[1] === '<' ? prevStart : prevEnd) + (m[2] === '+' ? 1 : -1) * Number(m[3]));
    return prevEnd;
  };
  const sync = () => {
    if (master) return;
    for (const it of items) it.a.effect.updateTiming({ endDelay: Math.max(0, end - (it.start + it.dur)) });
    master = new Animation(new KeyframeEffect(null, null, { duration: Math.max(1, end), fill: 'both' }), document.timeline);
    master.pause();
    master.onfinish = () => onComplete?.();
  };
  const all = () => [...items.map((i) => i.a), ...(master ? [master] : [])];
  const fire = (t, back) => { for (const c of calls) { if (!back && !c.done && t >= c.at) { c.done = true; c.fn(); } if (back && c.done && t < c.at) c.done = false; } };
  const watch = () => {
    if (watching) return; watching = true;
    clock.add(() => { if (!master) return (watching = false); const t = master.currentTime ?? 0; fire(t, master.playbackRate < 0); if (master.playState !== 'running') { watching = false; return false; } return true; });
  };
  const add = (target, from, to, o, at) => {
    const els = toEls(target); const opt = { ...defaults, ...o }; const t = pos(at); const tm = timing(opt);
    els.forEach((el, i) => {
      const cs = getComputedStyle(el);
      const F = from ? toKeyframe(from) : Object.fromEntries(Object.keys(toKeyframe(to)).map((p) => [p, cs[p]]));
      const T = to ? toKeyframe(to) : Object.fromEntries(Object.keys(F).map((p) => [p, cs[p]]));
      const start = t + (opt.stagger ?? 0) * i;
      const a = el.animate([F, T], { duration: tm.duration, easing: tm.easing, delay: start, fill: 'both' });
      a.pause(); items.push({ a, start, dur: tm.duration }); end = Math.max(end, start + tm.duration);
    });
    prevStart = t; prevEnd = t + tm.duration + (opt.stagger ?? 0) * Math.max(0, els.length - 1);
    master = null;
    return tl;
  };
  const tl = {
    to: (el, to, o = {}, at) => add(el, null, to, o, at),
    from: (el, from, o = {}, at) => add(el, from, null, o, at),
    fromTo: (el, from, to, o = {}, at) => add(el, from, to, o, at),
    call(fn, at) { calls.push({ fn, at: pos(at), done: false }); return tl; },
    get duration() { return end; },
    play() {
      sync();
      if (reduced()) { tl.seek(end); onComplete?.(); return tl; }
      all().forEach((a) => { if (a.playbackRate < 0) a.playbackRate = 1; a.play(); }); watch(); return tl;
    },
    pause() { all().forEach((a) => a.pause()); return tl; },
    reverse() { sync(); all().forEach((a) => a.reverse()); watch(); return tl; },
    seek(ms) { sync(); all().forEach((a) => { a.currentTime = ms; }); fire(ms, false); return tl; },
    progress(p) { return tl.seek(clamp(p) * end); },
    cancel() { all().forEach((a) => a.cancel()); },
    get finished() { sync(); return master.finished; },
  };
  return tl;
}

// ── FLIP: move things to their new layout, then animate them from where they were ────────────────────────────────
// flip(els, () => reorder()) · flipList(ul, () => render()) also fades new children in and old ones out (as ghosts).
// Reads the on-screen position first, so a second shuffle mid-flight starts from where things are.
const flips = new WeakMap();
const flipPlay = (el, dx, dy, sx, sy, o, delay = 0) => {
  const base = getComputedStyle(el).transform; const b = base === 'none' ? '' : ` ${base}`;
  const a = el.animate([
    { transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})${b}` },
    { transformOrigin: '0 0', transform: b.trim() || 'none' },
  ], { ...timing({ spring: o.spring ?? SPRINGS.default, ...o }), delay });
  flips.set(el, a);
  return a;
};
export async function flip(targets, mutate, o = {}) {
  const els = toEls(targets);
  const first = new Map(els.map((el) => [el, el.getBoundingClientRect()]));
  els.forEach((el) => flips.get(el)?.cancel());
  await mutate?.();
  if (reduced()) return;
  const anims = [];
  els.forEach((el, i) => {
    if (!el.isConnected) return;
    const a = first.get(el), b = el.getBoundingClientRect();
    const sx = o.scale !== false && b.width ? a.width / b.width : 1, sy = o.scale !== false && b.height ? a.height / b.height : 1;
    const dx = a.left - b.left, dy = a.top - b.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.004 && Math.abs(sy - 1) < 0.004) return;
    anims.push(flipPlay(el, dx, dy, sx, sy, o, i * (o.stagger ?? 0)));
  });
  await Promise.all(anims.map((a) => a.finished.catch(() => {})));
}
const ghostOut = (container, el, r) => {
  const c = container.getBoundingClientRect();
  const g = el.cloneNode(true);
  g.removeAttribute('id'); g.setAttribute('aria-hidden', 'true'); g.dataset.mxGhost = '1'; g.inert = true;
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  Object.assign(g.style, { position: 'absolute', margin: '0', boxSizing: 'border-box', pointerEvents: 'none', zIndex: '0',
    left: `${r.left - c.left - container.clientLeft + container.scrollLeft}px`, top: `${r.top - c.top - container.clientTop + container.scrollTop}px`,
    width: `${r.width}px`, height: `${r.height}px` });
  container.appendChild(g);
  g.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.96)' }], { duration: 200, easing: EASE.out, fill: 'forwards' })
    .finished.then(() => g.remove(), () => g.remove());
};
export async function flipList(container, mutate, { key = (el) => el.dataset.key || el.id || null, stagger: st = 0, enterY = 8, ...o } = {}) {
  const kids = () => [...container.children].filter((el) => !el.dataset.mxGhost);
  const before = new Map();
  kids().forEach((el) => { before.set(key(el) ?? el, { el, r: el.getBoundingClientRect() }); flips.get(el)?.cancel(); });
  await mutate?.();
  if (reduced()) return;
  const after = kids(); const keys = new Set(after.map((el) => key(el) ?? el));
  for (const [k, { el, r }] of before) if (!keys.has(k)) ghostOut(container, el, r);
  const tm = timing({ spring: o.spring ?? SPRINGS.default, ...o });
  const anims = [];
  after.forEach((el, i) => {
    const old = before.get(key(el) ?? el);
    if (old) {
      const b = el.getBoundingClientRect(); const dx = old.r.left - b.left, dy = old.r.top - b.top;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) anims.push(flipPlay(el, dx, dy, 1, 1, o));
    } else {
      const d = i * st;
      anims.push(el.animate([{ transform: `translateY(${enterY}px) scale(.97)` }, { transform: 'none' }], { ...tm, delay: d, fill: 'backwards' }));
      anims.push(el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: Math.min(260, tm.duration * 0.6), easing: EASE.out, delay: d, fill: 'backwards' }));
    }
  });
  await Promise.all(anims.map((a) => a.finished.catch(() => {})));
}

// ── staggered entrances: a list arriving, one row after another (30–60 ms apart, capped so long lists don't wait) ───
export function stagger(targets, { y = 12, x = 0, scale = 1, each = 40, max = 420, delay = 0, from = 'start', spring = SPRINGS.default } = {}) {
  let els = toEls(targets);
  if (from === 'end') els = els.reverse();
  if (reduced()) return Promise.all(els.map((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: EASE.out, fill: 'backwards' }).finished.catch(() => {})));
  const tm = timing({ spring });
  const center = (els.length - 1) / 2;
  return Promise.all(els.flatMap((el, i) => {
    const d = delay + Math.min((from === 'center' ? Math.abs(i - center) : i) * each, max);
    return [
      el.animate([{ transform: `translate(${x}px, ${y}px) scale(${scale})` }, { transform: 'none' }], { ...tm, delay: d, fill: 'backwards' }),
      el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: Math.min(280, tm.duration * 0.55), easing: EASE.out, delay: d, fill: 'backwards' }),
    ].map((a) => a.finished.catch(() => {}));
  }));
}

// ── rolling numbers: each digit is a strip that rolls to its new place, the right-most first, up when the number grows
//    and down when it shrinks. Separators and the ₹ stay put; digits that appear or go fade, the rest slide over (FLIP).
//    rollHTML(v, opts) for first render, roll(el, v, opts) to change it. opts: { format: 'inr' | 'int' | 'dec1' | fn,
//    prefix, suffix }. Screen readers read the whole number (a hidden copy); the strips are aria-hidden. ─────────────
const FORMAT = {
  int: (v) => Math.round(v).toLocaleString('en-IN'),
  inr: (v) => Math.round(v).toLocaleString('en-IN'),
  dec1: (v) => (Math.round(v * 10) / 10).toLocaleString('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
  dec2: (v) => v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  plain: (v) => String(Math.round(v)),
};
const STRIP = '0123456789'.repeat(3).split('').join('\n');
const fmtOf = (o) => (typeof o.format === 'function' ? o.format : FORMAT[o.format ?? 'int'] ?? FORMAT.int);
// cells keyed from the right: d0 is the ones digit, s1 the first separator to its left, …
function cellsOf(text) {
  const out = []; let d = 0, s = 0;
  for (let i = text.length - 1; i >= 0; i--) { const ch = text[i]; if (ch >= '0' && ch <= '9') out.unshift({ k: `d${d++}`, ch, digit: true }); else out.unshift({ k: `s${s++}`, ch, digit: false }); }
  return out;
}
const cellHTML = (c) => (c.digit
  ? `<span class="mx-rc mx-rd" data-k="${c.k}" data-p="${10 + +c.ch}"><span class="mx-rh">${c.ch}</span><span class="mx-rs" style="--p:${10 + +c.ch}">${STRIP}</span></span>`
  : `<span class="mx-rc" data-k="${c.k}">${c.ch === ' ' ? '&nbsp;' : c.ch}</span>`);
const escTxt = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function rollHTML(value, o = {}) {
  const text = fmtOf(o)(+value || 0); const full = `${o.prefix ?? ''}${text}${o.suffix ?? ''}`;
  return `<span class="mx-roll${o.cls ? ` ${o.cls}` : ''}" data-v="${+value || 0}"><span class="mx-vh">${escTxt(full)}</span>`
    + `${o.prefix ? `<span class="mx-rx" aria-hidden="true">${escTxt(o.prefix)}</span>` : ''}<span class="mx-rr" aria-hidden="true">${cellsOf(text).map(cellHTML).join('')}</span>`
    + `${o.suffix ? `<span class="mx-rx" aria-hidden="true">${escTxt(o.suffix)}</span>` : ''}</span>`;
}
export function roll(host, value, o = {}) {
  if (!host) return;
  const el = host.classList.contains('mx-roll') ? host : host.querySelector('.mx-roll');
  if (!el) { host.innerHTML = rollHTML(value, o); return; }
  const v = +value || 0; const old = +el.dataset.v || 0;
  el.dataset.v = String(v);
  const text = fmtOf(o)(v);
  const vh = el.querySelector('.mx-vh'); if (vh) vh.textContent = `${o.prefix ?? ''}${text}${o.suffix ?? ''}`;
  const row = el.querySelector('.mx-rr');
  const want = cellsOf(text); const up = v >= old;
  const have = new Map([...row.children].filter((c) => !c.dataset.mxGhost).map((c) => [c.dataset.k, c]));
  const sameShape = want.length === have.size && want.every((c) => have.get(c.k) && (c.digit === have.get(c.k).classList.contains('mx-rd')));
  const apply = () => {
    if (!sameShape) {
      const frag = want.map((c) => { const ex = have.get(c.k); if (ex && c.digit === ex.classList.contains('mx-rd') && (c.digit || ex.textContent === c.ch)) return ex; const t = document.createElement('template'); t.innerHTML = cellHTML(c); const n = t.content.firstElementChild; if (c.digit) { n.dataset.p = String(up ? 10 : 20); n.lastElementChild.style.setProperty('--p', n.dataset.p); n.classList.add('mx-rnew'); } return n; });
      row.replaceChildren(...frag);
    }
    // right-most digit first; each strip goes the short way in the number's direction: 9 → 0 keeps rolling up
    const digits = want.filter((c) => c.digit).reverse();
    digits.forEach((c, i) => {
      const cell = row.querySelector(`[data-k="${c.k}"]`);
      if (!cell) return;
      const strip = cell.lastElementChild; const cur = +cell.dataset.p; const d = +c.ch;
      cell.firstElementChild.textContent = c.ch;
      const cands = [d, 10 + d, 20 + d];
      let p;
      if (cell.classList.contains('mx-rnew')) { cell.classList.remove('mx-rnew'); requestAnimationFrame(() => { strip.style.setProperty('--p', 10 + d); }); cell.dataset.p = String(10 + d); return; }
      else if (up) p = cands.find((x) => x >= cur) ?? 20 + d;
      else p = [...cands].reverse().find((x) => x <= cur) ?? d;
      strip.style.transitionDelay = reduced() ? '0ms' : `${i * 26}ms`;
      cell.dataset.p = String(p); strip.style.setProperty('--p', p);
    });
  };
  if (reduced()) { apply(); normalize(row); return; }
  if (sameShape) apply(); else flipList(row, apply, { key: (c) => c.dataset.k, spring: SPRINGS.snappy, enterY: up ? 10 : -10 });
  clearTimeout(el._mxNorm);
  el._mxNorm = setTimeout(() => normalize(row), 1300);
}
// once a roll lands, move each strip back to its middle decade without animating, so the next roll has room
function normalize(row) {
  const moved = [];
  for (const cell of row.querySelectorAll('.mx-rd')) {
    const p = +cell.dataset.p; const n = 10 + (p % 10); if (p === n) continue;
    const s = cell.lastElementChild; s.classList.add('mx-rnow'); cell.dataset.p = String(n); s.style.setProperty('--p', n); moved.push(s);
  }
  if (!moved.length) return;
  void row.offsetWidth;   // one style flush for all of them
  moved.forEach((s) => s.classList.remove('mx-rnow'));
}

// ── morphing shapes ──────────────────────────────────────────────────────────────────────────────────────────────
// pathTween(a, b) → (t) => d. Paths with the same commands interpolate their numbers exactly (an icon's chevron folding
// into a tick); any others are resampled to matching points, rotated to the closest match, and blended.
const NUM = /-?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi;
const shapeOf = (d) => d.replace(NUM, '#').replace(/[\s,]+/g, '');
let measure = null;
function samplePath(d, n) {
  if (!measure) { measure = document.createElementNS(SVGNS, 'svg'); measure.setAttribute('aria-hidden', 'true'); measure.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden'; document.body.appendChild(measure); }
  const subs = d.split(/(?=M)/).filter((s) => s.trim());
  return subs.map((sd) => {
    const p = document.createElementNS(SVGNS, 'path'); p.setAttribute('d', sd); measure.appendChild(p);
    const L = p.getTotalLength(); const closed = /z\s*$/i.test(sd.trim());
    const pts = Array.from({ length: n }, (_, i) => { const q = p.getPointAtLength((L * i) / (closed ? n : n - 1)); return [q.x, q.y]; });
    p.remove();
    return { pts, closed };
  });
}
function align(a, b) {   // rotate (and maybe reverse) b's points so they sit closest to a's: no twisting mid-morph
  const n = a.length; let best = Infinity, bestK = 0, bestRev = false;
  for (const rev of [false, true]) {
    const bb = rev ? [...b].reverse() : b;
    for (let k = 0; k < n; k++) { let s = 0; for (let i = 0; i < n; i += 2) { const p = bb[(i + k) % n]; s += (p[0] - a[i][0]) ** 2 + (p[1] - a[i][1]) ** 2; } if (s < best) { best = s; bestK = k; bestRev = rev; } }
  }
  const bb = bestRev ? [...b].reverse() : b;
  return bb.map((_, i) => bb[(i + bestK) % n]);
}
const f2 = (v) => +v.toFixed(2);
export function pathTween(a, b, { samples = 72 } = {}) {
  if (shapeOf(a) === shapeOf(b)) {
    const na = a.match(NUM).map(Number), nb = b.match(NUM).map(Number); const parts = a.split(NUM);
    return (t) => parts.reduce((s, part, i) => s + part + (i < na.length ? f2(na[i] + (nb[i] - na[i]) * t) : ''), '');
  }
  const A = samplePath(a, samples), B = samplePath(b, samples);
  const n = Math.max(A.length, B.length);
  const centroid = (S) => { const all = S.flatMap((s) => s.pts); return [all.reduce((x, p) => x + p[0], 0) / all.length, all.reduce((y, p) => y + p[1], 0) / all.length]; };
  const pad = (S, other) => { const c = centroid(other); while (S.length < n) S.push({ pts: Array.from({ length: samples }, () => [...c]), closed: true }); return S; };
  pad(A, B); pad(B, A);
  const pairs = A.map((s, i) => ({ a: s.pts, b: s.closed && B[i].closed ? align(s.pts, B[i].pts) : B[i].pts, closed: s.closed || B[i].closed }));
  return (t) => pairs.map(({ a: pa, b: pb, closed }) => `M${pa.map((p, i) => `${f2(p[0] + (pb[i][0] - p[0]) * t)} ${f2(p[1] + (pb[i][1] - p[1]) * t)}`).join('L')}${closed ? 'Z' : ''}`).join('');
}
/** Morph an SVG path (or polygon via d) to a new d. Interruptible: a new morph starts from the shape on screen. */
export function morph(path, to, { duration = 420, ease = 'inOut', spring, samples } = {}) {
  if (!path) return Promise.resolve();
  path._mxMorph?.cancel();
  const from = path.getAttribute('d') ?? '';
  if (reduced() || !from || from === to) { path.setAttribute('d', to); return Promise.resolve(); }
  const f = pathTween(from, to, { samples });
  const state = { k: 0 };
  const t = tweenObj(state, { k: 1 }, { duration: spring ? springCurve(spring).duration : duration, ease: spring ? cfgOf(spring) : ease, onUpdate: () => path.setAttribute('d', f(state.k)) });
  path._mxMorph = t;
  return t.finished.then(() => { if (path._mxMorph === t) { path.setAttribute('d', to); path._mxMorph = null; } });
}

// ── View Transitions: a page or tab change as one crossfade the browser composes (motion.css styles each type) ───────
// viewTransition(() => setTab('life'), { type: 'tab', dir: 1 }). Types: 'tab' 'push' 'pop' 'fade'. Without support the
// update runs at once. A transition already running is skipped to its end, so a quick second tap is never lost.
let vtNow = null;
export function viewTransition(update, { type = 'fade', dir = 0 } = {}) {
  const d = html();
  if (!document.startViewTransition || (reduced() && type !== 'fade')) { update(); return Promise.resolve(); }
  vtNow?.skipTransition?.();
  d.dataset.mxVt = type; d.dataset.mxDir = dir > 0 ? 'fwd' : dir < 0 ? 'back' : 'none';
  let vt;
  try { vt = document.startViewTransition({ update, types: [`mx-${type}`] }); } catch { vt = document.startViewTransition(update); }
  vtNow = vt;
  const clear = () => { if (vtNow === vt) { vtNow = null; delete d.dataset.mxVt; delete d.dataset.mxDir; } };
  vt.finished.then(clear, clear);
  return vt.updateCallbackDone.catch(() => {});
}

// ── scroll effects. motion.css does them with CSS scroll-driven animations (.mx-reveal, .mx-parallax, .mx-progress,
//    .mx-shrink); where the browser has no scroll timelines, scrollFx(root) reveals with an IntersectionObserver. ─────
export const scrollTimelines = typeof CSS !== 'undefined' && !!CSS.supports?.('animation-timeline: view()');
export function scrollFx(root = document) {
  if (scrollTimelines || typeof IntersectionObserver === 'undefined') return () => {};
  html().classList.add('mx-sfx');
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('mx-in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  root.querySelectorAll('.mx-reveal:not(.mx-in)').forEach((el) => io.observe(el));
  return () => io.disconnect();
}

// ── gestures ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** Apple's projection: where a flick at v px/s comes to rest with deceleration rate d (0.998 scroll, 0.99 snappier). */
export const project = (v, d = 0.998) => ((v / 1000) * d) / (1 - d);
/** Resistance past an edge: the further past, the less it follows. */
export const rubberband = (over, dim = 300, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
// velocity from the last ~100 ms of pointer samples, px/s
export function tracker() {
  const h = [];
  return {
    add(x, y, t = now()) { h.push([x, y, t]); while (h.length > 2 && t - h[0][2] > 100) h.shift(); },
    velocity() { if (h.length < 2) return { x: 0, y: 0 }; const a = h[0], b = h[h.length - 1]; const dt = Math.max(8, b[2] - a[2]) / 1000; return { x: (b[0] - a[0]) / dt, y: (b[1] - a[1]) / dt }; },
    reset() { h.length = 0; },
  };
}
/**
 * Drag an element 1:1 (from where you grabbed it), let go with momentum. axis 'x' | 'y' | 'both'. bounds { left, right,
 * top, bottom } (offsets in px) rubber-band past their edges. snap: [{x, y}] or fn(projected) → the resting point;
 * without snap a fling glides to its projected point inside the bounds. A grab mid-flight catches it where it is.
 */
export function drag(el, {
  axis = 'both', bounds = null, rubber = 0.55, snap = null, decel = 0.998, spring: sp = SPRINGS.flick, threshold = 6, handle = el,
  initial = { x: 0, y: 0 }, apply, onStart, onMove, onRelease, onRest,
} = {}) {
  const set = (x, y) => (apply ? apply(x, y) : (el.style.transform = `translate3d(${x}px, ${y}px, 0)`));
  const ss = springs({ x: initial.x, y: initial.y }, { ...cfgOf(sp), onUpdate: (v) => { set(v.x, v.y); onMove?.(v); }, onRest: (v) => onRest?.(v) });
  set(initial.x, initial.y);
  handle.style.touchAction = axis === 'x' ? 'pan-y' : axis === 'y' ? 'pan-x' : 'none';
  const vt = tracker();
  let p = null;
  const B = () => (typeof bounds === 'function' ? bounds() : bounds);
  const band = (v, lo, hi, dim) => (lo != null && v < lo ? lo + rubberband(v - lo, dim, rubber) : hi != null && v > hi ? hi + rubberband(v - hi, dim, rubber) : v);
  const down = (e) => {
    if (e.button > 0 || p) return;
    ss.stop();
    const v = ss.values;
    p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, ox: v.x, oy: v.y, live: false };
    vt.reset(); vt.add(e.clientX, e.clientY);
  };
  const move = (e) => {
    if (!p || e.pointerId !== p.id) return;
    const dx = e.clientX - p.x0, dy = e.clientY - p.y0;
    if (!p.live) {
      const ax = Math.abs(dx), ay = Math.abs(dy);
      if (Math.max(ax, ay) < threshold) return;
      if ((axis === 'x' && ay > ax * 1.2) || (axis === 'y' && ax > ay * 1.2)) { p = null; return; }   // the page's scroll wins
      p.live = true; handle.setPointerCapture?.(e.pointerId); onStart?.();
      p.x0 = e.clientX; p.y0 = e.clientY;    // start from here: no jump as the threshold is crossed
    }
    vt.add(e.clientX, e.clientY);
    const b = B() ?? {}; const r = el.getBoundingClientRect();
    const x = axis === 'y' ? p.ox : band(p.ox + e.clientX - p.x0, b.left, b.right, r.width || 300);
    const y = axis === 'x' ? p.oy : band(p.oy + e.clientY - p.y0, b.top, b.bottom, r.height || 300);
    ss.jump({ x, y });
    e.preventDefault?.();
  };
  const up = (e) => {
    if (!p || e.pointerId !== p.id) return;
    const live = p.live; p = null;
    if (!live) return;
    const v = vt.velocity(); const vx = axis === 'y' ? 0 : v.x, vy = axis === 'x' ? 0 : v.y;
    const cur = ss.values;
    let target = { x: cur.x + project(vx, decel), y: cur.y + project(vy, decel) };
    if (snap) target = typeof snap === 'function' ? snap(target, { x: vx, y: vy }) : snap.reduce((best, s) => (Math.hypot(s.x - target.x, s.y - target.y) < Math.hypot(best.x - target.x, best.y - target.y) ? s : best), snap[0]);
    const b = B();
    if (b) target = { x: clamp(target.x, b.left ?? -Infinity, b.right ?? Infinity), y: clamp(target.y, b.top ?? -Infinity, b.bottom ?? Infinity) };
    const over = onRelease?.({ x: cur.x, y: cur.y, vx, vy, target });
    if (over === false) return;
    if (over && typeof over === 'object') target = over;
    if (reduced()) { ss.jump(target); onRest?.(target); return; }
    ss.set(target, { velocity: { x: vx, y: vy } });
  };
  handle.addEventListener('pointerdown', down);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
  return {
    get x() { return ss.values.x; }, get y() { return ss.values.y; },
    to(pt, { velocity, spring: s } = {}) { ss.set(pt, { velocity, ...(s ? cfgOf(s) : {}) }); return ss.rest(); },
    jump(pt) { ss.jump(pt); },
    destroy() { ss.stop(); handle.removeEventListener('pointerdown', down); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); },
  };
}

// ── haptics ──────────────────────────────────────────────────────────────────────────────────────────────────────
// haptic(name): inside the app, NATIVE's Core Haptics patterns (svc/native-plugins.js native.haptics.play); an older
// binary without them gets Capacitor's Haptics; the web gets navigator.vibrate, or iOS Safari's switch-toggle tick.
// Fire it on the same frame as the visual it belongs to. Names (NATIVE's set): tick selection light medium heavy
// success warning error done ring-close heartbeat breathe-in breathe-hold breathe-out breathe-rest.
const VIBE = {
  tick: 6, selection: 4, light: 8, medium: 14, heavy: 22, success: [10, 60, 12, 60, 18], done: [10, 60, 12, 60, 18], warning: [14, 80, 14, 80, 14], error: [20, 60, 20, 60, 20],
  'ring-close': [18, 30, 8], heartbeat: [16, 120, 10, 700, 16, 120, 10], 'breathe-in': [30, 40, 60], 'breathe-hold': [12, 90, 12], 'breathe-out': [60, 40, 30], 'breathe-rest': 10,
};
const CAP = { tick: ['sel'], selection: ['sel'], light: ['imp', 'LIGHT'], medium: ['imp', 'MEDIUM'], heavy: ['imp', 'HEAVY'], success: ['note', 'SUCCESS'], done: ['note', 'SUCCESS'], warning: ['note', 'WARNING'], error: ['note', 'ERROR'], 'ring-close': ['imp', 'LIGHT'], heartbeat: ['imp', 'MEDIUM'], 'breathe-in': ['imp', 'MEDIUM'], 'breathe-hold': ['imp', 'LIGHT'], 'breathe-out': ['imp', 'HEAVY'], 'breathe-rest': ['imp', 'LIGHT'] };
const isNative = () => !!globalThis.Capacitor?.isNativePlatform?.();
let nativeMod = null, nativeTried = false, lastSource = 'none', switchLabel = null;
/** The native plugin module, loaded only inside the app (on the web there is nothing native to call). */
export function nativePlugins() {
  if (nativeTried) return nativeMod;
  nativeTried = true;
  if (!isNative()) return (nativeMod = Promise.resolve(null));
  nativeMod = import('./svc/native-plugins.js').catch(() => null);
  return nativeMod;
}
/** NATIVE's facade (svc/native-plugins.js `native`) inside the app; null on the web. */
export const nativeApi = () => { const m = nativePlugins(); return m && typeof m.then === 'function' ? m.then((x) => x?.native ?? x?.default ?? null) : Promise.resolve(null); };
// play it natively; an answer of { available: false } (an older binary) falls back to Capacitor's Haptics
const nativePlay = (m, name) => {
  const h = m?.native?.haptics ?? m?.default?.haptics;
  if (typeof h?.play !== 'function') return null;
  return Promise.resolve(h.play(name)).then((r) => (r?.available === false ? false : r?.ok !== false), () => false);
};
function capPlay(name) {
  const H = globalThis.Capacitor?.Plugins?.Haptics;
  if (!isNative() || !H) return false;
  const [k, s] = CAP[name] ?? CAP.light;
  try { if (k === 'sel') H.selectionChanged?.(); else if (k === 'note') H.notification?.({ type: s }); else H.impact?.({ style: s }); return true; } catch { return false; }
}
function webPlay(name) {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return false;
  if (typeof navigator.vibrate === 'function') { try { if (navigator.vibrate(VIBE[name] ?? 8)) return 'vibrate'; } catch {} }
  // iOS 18+ Safari ticks when a switch checkbox toggles (inside a user gesture); the legacy app's trick
  try {
    if (!switchLabel) { switchLabel = document.createElement('label'); switchLabel.setAttribute('aria-hidden', 'true'); switchLabel.style.display = 'none'; const i = document.createElement('input'); i.type = 'checkbox'; i.setAttribute('switch', ''); switchLabel.append(i); document.body.append(switchLabel); }
    switchLabel.click(); return 'switch';
  } catch { return false; }
}
export function haptic(name = 'tick') {
  if (isNative()) {
    const m = nativePlugins();
    if (m && typeof m.then === 'function') {
      m.then(async (mod) => { const p = mod && nativePlay(mod, name); if (p && (await p)) { lastSource = 'native'; return; } lastSource = capPlay(name) ? 'capacitor' : 'none'; });
      return;
    }
  }
  const w = webPlay(name);
  lastSource = w || 'none';
}
/** Which path the last haptic took: native | capacitor | vibrate | switch | none (the lab shows it). */
export const hapticSource = () => lastSource;

// ── symbol effects: SF Symbols' bounce, pulse, wiggle … for any glyph (icons.js or a mark). Played on the <svg> itself,
//    so it composites. symbol(svg, 'bounce'). Returns the Animation; 'spin' and 'breathe' loop until you cancel it. ────
const FX = {
  bounce: { kf: [{ transform: 'none' }, { transform: 'translateY(4%) scale(.86, .8)', offset: 0.22 }, { transform: 'translateY(-14%) scale(.96, 1.08)', offset: 0.5 }, { transform: 'translateY(2%) scale(1.02, .98)', offset: 0.76 }, { transform: 'none' }], duration: 520, easing: 'cubic-bezier(.3, .7, .4, 1)' },
  pop: { kf: [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1.14)', opacity: 1, offset: 0.55 }, { transform: 'scale(.97)', offset: 0.8 }, { transform: 'none', opacity: 1 }], duration: 460, easing: EASE.out },
  pulse: { kf: [{ opacity: 1 }, { opacity: 0.35, offset: 0.4 }, { opacity: 1 }], duration: 620, easing: EASE.sine },
  wiggle: { kf: [{ transform: 'none' }, { transform: 'rotate(-14deg)', offset: 0.18 }, { transform: 'rotate(11deg)', offset: 0.38 }, { transform: 'rotate(-7deg)', offset: 0.58 }, { transform: 'rotate(3deg)', offset: 0.78 }, { transform: 'none' }], duration: 640, easing: 'ease-out' },
  rotate: { kf: [{ transform: 'none' }, { transform: 'rotate(360deg)' }], duration: 700, easing: EASE.inOut },
  lift: { kf: [{ transform: 'none' }, { transform: 'translateY(-16%) rotate(-6deg)', offset: 0.45 }, { transform: 'none' }], duration: 560, easing: 'cubic-bezier(.3, .7, .4, 1)' },
  launch: { kf: [{ transform: 'none', opacity: 1 }, { transform: 'translateY(-70%)', opacity: 0, offset: 0.42 }, { transform: 'translateY(60%)', opacity: 0, offset: 0.43 }, { transform: 'none', opacity: 1 }], duration: 620, easing: EASE.out },
  spin: { kf: [{ transform: 'none' }, { transform: 'rotate(360deg)' }], duration: 1000, easing: 'linear', iterations: Infinity },
  breathe: { kf: [{ transform: 'none', opacity: 1 }, { transform: 'scale(1.1)', opacity: 0.82 }, { transform: 'none', opacity: 1 }], duration: 1800, easing: EASE.sine, iterations: Infinity },
};
export function symbol(target, effect = 'bounce', { delay = 0, iterations } = {}) {
  const el = isEl(target) ? (target.tagName.toLowerCase() === 'svg' ? target : target.querySelector('svg') ?? target) : null;
  if (!el) return null;
  if (effect === 'turn') return turn(el);
  el._mxFx?.cancel();
  if (effect === 'draw') return drawOn(el, { delay });
  const fx = FX[effect] ?? FX.bounce;
  if (reduced()) {
    if (fx.iterations === Infinity || !fx.kf.some((k) => 'opacity' in k)) return null;
    return el.animate([{ opacity: 1 }, { opacity: 0.5 }, { opacity: 1 }], { duration: 300, easing: EASE.out });
  }
  el.style.transformOrigin = el.style.transformOrigin || '50% 50%';
  const a = el.animate(fx.kf, { duration: fx.duration, easing: fx.easing, iterations: iterations ?? fx.iterations ?? 1, delay, fill: fx.fill ?? 'none' });
  el._mxFx = a;
  return a;
}
// a plus turns into a close ×, and back: a toggle that starts from wherever it is (interruptible)
function turn(el) {
  const to = el._mxTurned ? 0 : 45; el._mxTurned = !el._mxTurned;
  const cur = getComputedStyle(el).transform;
  el._mxFx?.cancel();
  if (reduced()) { el.style.transform = to ? 'rotate(45deg)' : ''; return null; }
  const a = el.animate([{ transform: cur === 'none' ? 'rotate(0deg)' : cur }, { transform: `rotate(${to}deg)` }], { ...springCurve(SPRINGS.snappy), fill: 'forwards' });
  el._mxFx = a;
  a.finished.then(() => { if (el._mxFx === a) { el.style.transform = to ? 'rotate(45deg)' : ''; a.cancel(); } }, () => {});
  return a;
}
// strokes draw themselves on, in document order (a filled glyph pops instead)
function drawOn(svg, { delay = 0 } = {}) {
  const parts = [...svg.querySelectorAll('path, line, polyline, circle, rect, ellipse, polygon')].filter((p) => { const cs = getComputedStyle(p); return cs.stroke !== 'none' && cs.fill === 'none'; });
  if (!parts.length) return symbol(svg, 'pop', { delay });
  if (reduced()) return svg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE.out });
  const per = Math.min(360, 700 / parts.length);
  let last = null;
  parts.forEach((p, i) => {
    const had = p.getAttribute('pathLength');
    p.setAttribute('pathLength', '1');
    last = p.animate([{ strokeDasharray: '1 1', strokeDashoffset: 1 }, { strokeDasharray: '1 1', strokeDashoffset: 0 }], { duration: per * 1.6, delay: delay + i * per * 0.55, easing: EASE.out, fill: 'backwards' });
    last.finished.then(() => { if (had == null) p.removeAttribute('pathLength'); else p.setAttribute('pathLength', had); }, () => {});
  });
  return last;
}

// ── visibility: run fn(true|false) as an element enters or leaves the screen (loops pause off screen) ────────────────
export function onVisible(el, fn, { margin = '80px' } = {}) {
  if (typeof IntersectionObserver === 'undefined') { fn(true); return () => {}; }
  let inView = false, shown = null;
  const tell = () => { const v = inView && document.visibilityState === 'visible'; if (v !== shown) { shown = v; fn(v); } };
  const io = new IntersectionObserver((es) => { inView = es[es.length - 1].isIntersecting; tell(); }, { rootMargin: margin });
  io.observe(el);
  document.addEventListener('visibilitychange', tell);
  return () => { io.disconnect(); document.removeEventListener('visibilitychange', tell); };
}

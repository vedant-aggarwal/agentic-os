// Shell: tabs, navigation stack, sheets, segmented controls, peek, toast, the dock and the sky.
import { I } from './icons.js';
import { viewTransition, symbol, springCurve, project, rubberband, tracker } from './motion.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// haptic(ms | kind): the engine plugs in the native one (svc/native.js: Core Haptics in the iPhone app, vibrate on the web)
let hapticImpl = (ms) => navigator.vibrate?.(ms);
export const setHaptic = (fn) => { if (typeof fn === 'function') hapticImpl = fn; };
export const haptic = (ms = 8) => { try { hapticImpl(ms); } catch {} };

const phone = () => $('#phone');
const tabs = new Map();      // id -> { render(el), sky:[c1,c2,c3], title }
let current = null;

// ── tabs ──────────────────────────────────────────────────────────────
export function registerTab(id, def) { tabs.set(id, def); }

export function setTab(id, { instant = false } = {}) {
  if (!tabs.has(id)) return;
  popAll(true);
  const def = tabs.get(id);
  $$('#pages > .page').forEach((p) => { p.hidden = p.dataset.tab !== id; });
  const page = $(`#pages > .page[data-tab="${id}"]`);
  if (!page.dataset.built) { buildPage(page, def); page.dataset.built = '1'; }
  else def.onShow?.(page);
  current = id;
  $('#dock').classList.remove('min');
  $('#dock').dataset.tab = id;
  $$('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
  moveLens(instant);
  setSky(def.sky);
  history.replaceState(null, '', `#${id}`);
  pulse(page);
}
export const currentTab = () => current;

function buildPage(page, def) {
  page.innerHTML = '';
  def.render(page);
  wirePage(page);
}

// Every page: a .topbar and a .scroll. Scrolling fades in the inline title and minimises the dock.
export function wirePage(page) {
  const sc = $('.scroll', page);
  if (!sc) return;
  let last = 0;
  sc.addEventListener('scroll', () => {
    const y = sc.scrollTop;
    page.classList.toggle('scrolled', y > 44);
    const dock = $('#dock');
    if (!page.closest('.stack') || page.closest('.stack.has-dock')) {
      if (y > 120 && y > last + 4) dock.classList.add('min');
      else if (y < last - 6 || y < 60) dock.classList.remove('min');
    }
    last = y;
  }, { passive: true });
  wireSegs(page);
}

// The lens is one column wide and moves by whole columns, so it stays right while the bar resizes.
function moveLens(instant) {
  const tabsEls = $$('.tab'); const on = $('.tab.on'); const lens = $('.tab-lens');
  if (lens) lens.style.opacity = on ? '' : '0';   // a page with no tab of its own (#more) lights none
  if (!on || !lens) return;
  if (instant) lens.style.transition = 'none';
  lens.style.transform = `translateX(${tabsEls.indexOf(on) * 100}%)`;
  if (instant) requestAnimationFrame(() => { lens.style.transition = ''; });
}
addEventListener('resize', () => moveLens(true));

// ── sky: each place tints the ambient light ──────────────────────────
export function setSky(c) {
  return; // the ambient sky was removed in the de-slop pass
  if (!c) return;
  const r = document.documentElement.style;
  ['--sky1', '--sky2', '--sky3'].forEach((k, i) => r.setProperty(k, c[i]));
  $$('.sky i').forEach((b, i) => { b.style.backgroundColor = c[i]; });
}

// ── navigation stack ─────────────────────────────────────────────────
// push({ title, back, right, render(scrollEl, page), sky, dock, cls, aspect })
// aspect: an aspect app's id; the page gets data-aspect, which maps --as, --as-a, --as-b, --as-ink, --as-fill (css/aspects.css)
export function push(opts) {
  const stack = $('#stack');
  const page = document.createElement('section');
  page.className = `page${opts.cls ? ` ${opts.cls}` : ''}`;
  if (opts.aspect) page.dataset.aspect = opts.aspect;
  const backLabel = opts.back ?? tabs.get(current)?.title ?? 'Back';
  page.innerHTML = `
    <header class="topbar">
      <div class="tb-left"><button class="gbtn chrome back" data-act="pop">${I.chevL}<span>${esc(backLabel)}</span></button></div>
      <div class="tb-title">${opts.titleHtml ?? esc(opts.title ?? '')}</div>
      <div class="tb-right">${opts.right ?? ''}</div>
    </header>
    <div class="scroll"></div>`;
  stack.append(page);
  stack.classList.toggle('has-dock', !!opts.dock);
  const sc = $('.scroll', page);
  opts.render(sc, page);
  wirePage(page);
  pulse(page, 120);
  if (opts.sky) setSky(opts.sky);
  $('#pages').classList.add('pushed');
  if (!opts.dock) $('#dock').classList.add('away');
  requestAnimationFrame(() => requestAnimationFrame(() => page.classList.add('in')));
  page._opts = opts;
  edgeSwipe(page);
  return page;
}

export function pop() {
  const stack = $('#stack');
  const page = stack.lastElementChild;
  if (!page) return;
  page.classList.remove('in');
  const prev = page.previousElementSibling;
  if (!prev) { $('#pages').classList.remove('pushed'); $('#dock').classList.remove('away'); setSky(tabs.get(current)?.sky); }
  else { if (prev._opts?.sky) setSky(prev._opts.sky); stack.classList.toggle('has-dock', !!prev._opts?.dock); if (!prev._opts?.dock) $('#dock').classList.add('away'); else $('#dock').classList.remove('away'); }
  setTimeout(() => page.remove(), 700);   // the page spring (--mx-page) settles in ~680 ms
  page._opts?.onPop?.();
}
function popAll(instant) {
  const stack = $('#stack');
  if (!stack) return;
  [...stack.children].forEach((p) => p.remove());
  $('#pages').classList.remove('pushed');
  $('#dock').classList.remove('away');
}

// Swipe from the left edge to go back, tracked 1:1 with the finger; the page below slides back in with it. On release
// it goes back if the swipe is going past half the width (projected, DESIGN.md), and the page spring starts at the
// finger's own speed, so there is no seam between the drag and the animation.
function edgeSwipe(page) {
  let x0 = null, dx = 0; const vt = tracker();
  const below = () => (page.previousElementSibling ? null : $('#pages'));   // the tab page under the first pushed one
  const dim = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--push-dim')) || 0.7;
  page.addEventListener('pointerdown', (e) => {
    if (e.clientX - page.getBoundingClientRect().left > 24) return;
    x0 = e.clientX; dx = 0; vt.reset(); vt.add(e.clientX, 0);
    page.style.transition = 'none'; const b = below(); if (b) b.style.transition = 'none';
    page.setPointerCapture(e.pointerId);
  });
  page.addEventListener('pointermove', (e) => {
    if (x0 == null) return;
    dx = Math.max(0, e.clientX - x0); vt.add(e.clientX, 0);
    page.style.transform = `translateX(${dx}px)`;
    const b = below(); if (!b) return;
    const k = Math.min(1, dx / page.offsetWidth), d = dim();
    b.style.transform = `translateX(${(-28 * (1 - k)).toFixed(2)}%)`; b.style.filter = `brightness(${(d + (1 - d) * k).toFixed(3)})`;
  });
  const end = () => {
    if (x0 == null) return;
    x0 = null;
    const w = page.offsetWidth, v = vt.velocity().x;
    const back = dx + project(v, 0.995) > w / 2;   // a flick goes back; a slow drag short of half doesn't
    const dist = (back ? w : 0) - dx;
    const { duration, easing } = springCurve('page', { velocity: dist ? v / dist : 0 });
    const t = `transform ${duration}ms ${easing}`;
    page.style.transition = t; page.style.transform = '';
    const b = below(); if (b) { b.style.transition = `${t}, filter ${duration}ms ${easing}`; b.style.transform = ''; b.style.filter = ''; }
    if (back) pop();
    setTimeout(() => { page.style.transition = ''; if (b) b.style.transition = ''; }, duration);
  };
  page.addEventListener('pointerup', end); page.addEventListener('pointercancel', end);
}

// ── sheets ────────────────────────────────────────────────────────────
// openSheet({ title, sub, head (html), body (html | fn(el)), large, cls, onClose, aspect })
const sheets = [];
export function openSheet(o) {
  const el = document.createElement('section');
  el.className = `sheet overlay ${o.large ? 'large' : ''} ${o.cls ?? ''}`;
  const asp = o.aspect ?? $('#stack')?.lastElementChild?.dataset.aspect;   // sheets inherit the open app's colour
  if (asp) el.dataset.aspect = asp;
  el.innerHTML = `<div class="grab"></div>
    ${o.head ?? (o.title ? `<div class="sheet-head"><div class="sh-text"><h3>${o.title}</h3>${o.sub ? `<p>${o.sub}</p>` : ''}</div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>` : '')}
    <div class="sheet-body"></div>${o.foot ?? ''}`;
  $('#phone').append(el);
  const body = $('.sheet-body', el);
  if (typeof o.body === 'function') o.body(body, el); else body.innerHTML = o.body ?? '';
  wireSegs(el);
  el._o = o;
  sheets.push(el);
  $('#scrim').classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  dragSheet(el);
  haptic(6);
  return el;
}
export function closeSheet(el = sheets[sheets.length - 1]) {
  if (!el) return;
  sheets.splice(sheets.indexOf(el), 1);
  el.classList.remove('in'); el.style.transform = '';
  if (!sheets.length) $('#scrim').classList.remove('on');
  el._o?.onClose?.();
  setTimeout(() => el.remove(), 700);   // the sheet spring (--mx-page) settles in ~680 ms
}
// Drag down from the grabber or the head to dismiss. It follows the finger (up, it resists: Apple's rubber band); on
// release it closes if the drag is going past 45% of its height (projected with d = 0.99, so a gentle drag settles back
// and a flick still closes; 0.998 is for picking between detents), and either way the spring
// starts at the finger's speed: the sheet spring to close, the flick spring (a hair of overshoot) to settle back.
function dragSheet(el) {
  let y0 = null, dy = 0; const vt = tracker();
  const start = (e) => {
    const body = $('.sheet-body', el);
    const fromHead = !body.contains(e.target) || body.scrollTop <= 0 && e.target.closest('.grab, .sheet-head');
    if (!fromHead || e.target.closest('button:not(.grab), input, textarea, .seg')) return;
    y0 = e.clientY; dy = 0; vt.reset(); vt.add(0, e.clientY); el.classList.add('drag');
  };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    const d = e.clientY - y0; vt.add(0, e.clientY);
    dy = d > 0 ? d : rubberband(d, el.offsetHeight);
    el.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    const v = vt.velocity().y, h = el.offsetHeight;
    const close = dy + project(v, 0.99) > h * 0.45;
    const dist = (close ? h + 20 : 0) - dy;
    const { duration, easing } = springCurve(close ? 'sheet' : 'flick', { velocity: dist ? v / dist : 0 });
    el.classList.remove('drag'); el.style.transition = `transform ${duration}ms ${easing}`; el.style.transform = '';
    if (close) closeSheet(el);
    setTimeout(() => { if (el.isConnected) el.style.transition = ''; }, duration);
  };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
}

// ── segmented controls: <div class="seg" data-seg="name"><button data-v="a" aria-selected="true">…</button>…</div>
export function wireSegs(root) {
  $$('.seg', root).forEach((seg) => {
    if (seg._wired) return; seg._wired = true;
    if (!$('.seg-thumb', seg)) seg.insertAdjacentHTML('afterbegin', '<span class="seg-thumb"></span>');
    const place = (instant) => {
      const on = $('button[aria-selected="true"]', seg) ?? $('button', seg);
      const th = $('.seg-thumb', seg);
      if (instant) th.style.transition = 'none';
      th.style.width = `${on.offsetWidth}px`;
      th.style.transform = `translateX(${on.offsetLeft - 3}px)`;
      if (instant) requestAnimationFrame(() => { th.style.transition = ''; });
    };
    seg._place = place;
    requestAnimationFrame(() => place(true));
    new ResizeObserver(() => place(true)).observe(seg);
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || !seg.contains(b)) return;
      $$('button', seg).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
      place(); haptic(5);
      seg.dispatchEvent(new CustomEvent('change', { detail: b.dataset.v, bubbles: true }));
    });
  });
}
export const seg = (name, items, on, cls = '') => `<div class="seg ${cls}" data-seg="${name}" role="tablist">${items.map(([v, label, n]) =>
  `<button data-v="${v}" role="tab" aria-selected="${v === on}">${label}${n != null ? ` <span class="n">${n}</span>` : ''}</button>`).join('')}</div>`;

// ── peek: hold something to preview it ───────────────────────────────
export function peek(html, menu = []) {
  const w = $('#peek');
  w.innerHTML = `<div><div class="peek overlay">${html}</div>${menu.length ? `<div class="peek-menu overlay">${menu.map(([label, icon, act]) => `<button data-act="${act}">${label}${icon ?? ''}</button>`).join('')}</div>` : ''}</div>`;
  w.classList.add('on'); haptic(12);
}
export function closePeek() { $('#peek').classList.remove('on'); }
export function onHold(root, sel, fn, ms = 420) {
  let t = null, sx = 0, sy = 0, held = false;
  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(sel); if (!el) return;
    sx = e.clientX; sy = e.clientY; held = false;
    t = setTimeout(() => { held = true; fn(el, e); }, ms);
  });
  root.addEventListener('pointermove', (e) => { if (t && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) { clearTimeout(t); t = null; } });
  const up = () => { clearTimeout(t); t = null; };
  root.addEventListener('pointerup', up); root.addEventListener('pointercancel', up);
  root.addEventListener('click', (e) => { if (held && e.target.closest(sel)) { e.stopPropagation(); e.preventDefault(); held = false; } }, true);
  root.addEventListener('contextmenu', (e) => { if (e.target.closest(sel)) e.preventDefault(); });
}

// ── toast ─────────────────────────────────────────────────────────────
let toastT;
// toast(text, undo?, { ms }?): ms is how long it stays (default 2.6 s; a multi-item Undo wants ~6 s)
export function toast(text, undo, { ms = 2600 } = {}) {
  const t = $('#toast');
  t.innerHTML = `${I.check}<span>${esc(text)}</span>${undo ? `<button data-act="toast-undo">Undo</button>` : ''}`;
  t._undo = undo;
  t.classList.add('on');
  swipeToast(t);
  symbol(t, 'pop');   // the tick lands as the toast does
  t._ms = ms;
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), ms);
}
// up and away; let go early and it springs home and waits a little longer
function swipeToast(t) {
  if (t._swipe) return;
  t._swipe = true;
  let y0 = null, dy = 0; const vt = tracker();
  t.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    y0 = e.clientY; dy = 0; vt.reset(); vt.add(0, e.clientY); t.style.transition = 'none'; clearTimeout(toastT);
    try { t.setPointerCapture(e.pointerId); } catch {}
  });
  t.addEventListener('pointermove', (e) => {
    if (y0 == null) return;
    const d = e.clientY - y0; vt.add(0, e.clientY);
    dy = d < 0 ? d : rubberband(d, 90);
    t.style.transform = `translateY(${dy}px)`;
  });
  const end = () => {
    if (y0 == null) return;
    y0 = null;
    const away = dy + project(vt.velocity().y, 0.99) < -30;
    const { duration, easing } = springCurve('snappy');
    t.style.transition = `transform ${duration}ms ${easing}, opacity .25s`; t.style.transform = '';
    if (away) t.classList.remove('on'); else toastT = setTimeout(() => t.classList.remove('on'), Math.max(1800, (t._ms ?? 2600) - 800));
    setTimeout(() => { t.style.transition = ''; }, duration);
  };
  t.addEventListener('pointerup', end); t.addEventListener('pointercancel', end);
}

// ── swipe rows: right = primary (done / move on), left = secondary ──
export function swipeRows(root, sel, { right, left }) {
  let row = null, x0 = 0, y0 = 0, dx = 0, mode = null;
  root.addEventListener('pointerdown', (e) => {
    const r = e.target.closest(sel); if (!r || e.target.closest('.check')) return;
    row = r; x0 = e.clientX; y0 = e.clientY; dx = 0; mode = null;
  });
  root.addEventListener('pointermove', (e) => {
    if (!row) return;
    const mx = e.clientX - x0, my = e.clientY - y0;
    if (!mode) { if (Math.abs(mx) > 10 && Math.abs(mx) > Math.abs(my)) { mode = 'x'; row.classList.add('swiping'); } else if (Math.abs(my) > 10) { row = null; return; } }
    if (mode !== 'x') return;
    dx = mx;
    const lim = row.offsetWidth * .6;
    const x = Math.abs(dx) > lim ? Math.sign(dx) * (lim + (Math.abs(dx) - lim) * .25) : dx;
    row.style.transform = `translateX(${x}px)`;
    row.dataset.swipe = dx > 60 ? 'right' : dx < -60 ? 'left' : '';
  });
  const end = () => {
    if (!row) return;
    const r = row; row = null;
    r.classList.remove('swiping'); r.style.transform = '';
    const dir = r.dataset.swipe; r.dataset.swipe = '';
    if (mode === 'x') { if (dir === 'right') { haptic(10); right?.(r); } if (dir === 'left') { haptic(10); left?.(r); } }
  };
  root.addEventListener('pointerup', end); root.addEventListener('pointercancel', end);
}

// ── delegated actions: <button data-act="name" data-id="…"> ───────────
const acts = new Map();
window.__acts = acts;
export function on(name, fn) { acts.set(name, fn); }
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]'); if (!el) return;
  const fn = acts.get(el.dataset.act); if (!fn) return;
  e.preventDefault(); fn(el, e);
});
on('pop', () => pop());
on('close-sheet', (el) => closeSheet(el.closest('.sheet') ?? undefined));
on('toast-undo', () => { const t = $('#toast'); t._undo?.(); t.classList.remove('on'); });
// each tab's glyph has its own small moment when you pick it (motion.js symbol: SF Symbols-style effects)
const TAB_FX = { today: 'draw', life: 'rotate', jobs: 'bounce', content: 'pop', agent: 'pop' };
on('tab', (el) => {
  const dock = $('#dock');
  if (dock.classList.contains('min')) { dock.classList.remove('min'); requestAnimationFrame(() => moveLens(true)); return; }
  haptic(5);
  const id = el.dataset.tab;
  if (id === current) { setTab(id); return; }   // the same tab again: back to its root, as before
  // a short crossfade that leans toward the side of the tab you picked (css/motion.css, type 'tab'); the dock stays live
  const order = $$('.tab').map((t) => t.dataset.tab);
  viewTransition(() => setTab(id), { type: 'tab', dir: Math.sign(order.indexOf(id) - order.indexOf(current)) });
  symbol(el, TAB_FX[id] ?? 'bounce');
});

// ── small render helpers ─────────────────────────────────────────────
export const fmtDur = (m) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`;

// A ring. p is progress and may pass 1 (the ring laps itself). hue: today | jobs | clients | content | life | needs.
// k (0–1) puts a marker across the track, e.g. how much of the time has gone.
// The markup is the union of what every skin paints; each skin's CSS reacts only to its own layers:
//   .rg-l      Obsidian's light, a blurred copy of the lit arc that falls on the surface beneath (hidden by other skins)
//   .ink-tex   Matte's printed-ink texture, on strokes of 9px and up (ignored by other skins)
export const ring = (p, hue = 'today', size = 44, w = 6, { inner = '', cls = '', k = null, id = '', delay = 0, label = '' } = {}) => {
  const v = Math.max(0, Number(p) || 0).toFixed(4);
  const style = `--size:${size}px;--w:${w}px;--rp:${v}${k != null ? `;--k:${Number(k).toFixed(4)}` : ''}`;
  const tex = w >= 9 ? ' ink-tex' : '';
  return `<span class="rg ${hue}${tex} ${cls}"${id ? ` id="${id}"` : ''} data-v="${v}"${delay ? ` data-delay="${delay}"` : ''} style="${style}" ${label ? `role="img" aria-label="${esc(label)}"` : ''}>`
    + `<i class="rg-l" aria-hidden="true"><i></i></i><i class="rg-t"></i><i class="rg-a"></i><i class="rg-0"></i><i class="rg-o"></i><i class="rg-s"></i><i class="rg-h"></i>${k != null ? '<i class="rg-k"></i>' : ''}${inner}</span>`;
};
// Concentric rings with a 2px gap, outermost first: [[p, hue, opts], …]
export const ringSet = (rings, size, w, gap = 2, label = '') =>
  `<span class="rset" style="--size:${size}px"${label ? ` role="img" aria-label="${esc(label)}"` : ''}>${rings.map(([p, hue, o = {}], i) => ring(p, hue, size - i * 2 * (w + gap), w, { delay: i * 70, ...o })).join('')}</span>`;
// Move a ring to a new value from wherever it is now. The fresh head re-marks itself ('ink': Matte's bleed).
export function setRing(el, p, { bleed = true } = {}) {
  if (!el) return;
  const v = Math.max(0, Number(p) || 0).toFixed(4);
  if (el.dataset.v === v) return;
  el.dataset.v = v;
  if (!reduced()) {
    el.classList.add('go');
    if (bleed) { el.classList.remove('ink'); el.style.setProperty('--d', '0ms'); void el.offsetWidth; el.classList.add('ink'); }
  }
  el.style.setProperty('--rp', v);
}

// ── pulse: when a tab or page opens, its rings draw to their value once and the figures beside them count up.
//    The open sets every skin's state class; each skin's CSS answers to its own:
//      bloom  Obsidian: the light swells onto the stone and settles (removed once spent, so the next open blooms again)
//      ink    Matte: ink spreads into the paper at each cap as the stroke stops, then dries
//    The draw's length and curve come from the skin's tokens (--draw, --count-ease), so the count keeps pace. ──
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const springX = (k) => { const u = k * 7.15; return Math.min(1, (1 - (1 + .75 * u) * Math.exp(-u)) / .9948); };
// the pen stroke: the same ease as Matte's --ease-draw, sampled
const inkX = (k) => { const u = 1 - k; return 1 - u * u * u * (1 - .35 * k); };
function drawTiming() {
  const cs = getComputedStyle(document.documentElement);
  const D = parseFloat(cs.getPropertyValue('--draw')) * 1000 || 780;
  return { D, ease: cs.getPropertyValue('--count-ease').trim() === 'ink' ? inkX : springX };
}
const FMT = {
  int: (v) => Math.round(v).toLocaleString('en-IN'),
  hm: (v) => { const m = Math.round(v); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; },
  dur: (v) => fmtDur(Math.round(v)),
  dec: (v) => v.toFixed(1),
  pct: (v) => `${Math.round(v)}`,
};
export function pulse(root, delay = 0) {
  if (!root) return;
  const rings = $$('.rg[data-v]', root);
  const nums = $$('[data-count]', root);
  if (reduced()) { rings.forEach((r) => { r.classList.remove('go', 'bloom', 'ink'); r.style.setProperty('--rp', r.dataset.v); }); return; }
  clearTimeout(root._bloomT);
  rings.forEach((r) => { r.classList.remove('go', 'bloom', 'ink'); r.style.transitionDelay = ''; r.style.setProperty('--rp', '0'); const l = r.querySelector('.rg-l'); if (l) l.style.animationDelay = ''; });
  nums.forEach((n) => {
    const fmt = FMT[n.dataset.fmt] ?? FMT.int;
    n.style.minWidth = '';
    n.textContent = fmt(Number(n.dataset.count));
    if (getComputedStyle(n).display === 'inline') n.style.display = 'inline-block';
    n.style.minWidth = `${Math.ceil(n.getBoundingClientRect().width)}px`;
    n.textContent = fmt(0);
  });
  root.getBoundingClientRect();
  const go = () => {
    const timing = drawTiming();
    rings.forEach((r) => {
      r.classList.add('go', 'bloom');
      const d = Number(r.dataset.delay) || 0;
      r.style.transitionDelay = d ? `${d}ms` : '';
      r.style.setProperty('--d', `${d}ms`);
      const l = r.querySelector('.rg-l'); if (l) l.style.animationDelay = d ? `${d}ms` : '';
      if (Number(r.dataset.v) > 0) r.classList.add('ink');
      r.style.setProperty('--rp', r.dataset.v);
    });
    nums.forEach((n) => countUp(n, timing));
    setTimeout(() => rings.forEach((r) => { r.style.transitionDelay = ''; }), 1400);
    // the bloom is spent: drop the class so the next open can bloom again, and the light rests at its level
    root._bloomT = setTimeout(() => rings.forEach((r) => { r.classList.remove('bloom'); const l = r.querySelector('.rg-l'); if (l) l.style.animationDelay = ''; }), 2200);
  };
  if (delay) setTimeout(() => requestAnimationFrame(go), delay); else requestAnimationFrame(go);
}
function countUp(el, { D, ease } = drawTiming()) {
  const to = Number(el.dataset.count); const fmt = FMT[el.dataset.fmt] ?? FMT.int;
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / D);
    el.textContent = fmt(k >= 1 ? to : to * ease(k));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// The page you are looking at: the top pushed page, or the current tab. A skin switch re-runs its draw.
export const visiblePage = () => $('#stack')?.lastElementChild ?? $(`#pages > .page[data-tab="${current}"]`);
export const topbar = ({ title = '', left = '', right = '' } = {}) =>
  `<header class="topbar"><div class="tb-left">${left}</div><div class="tb-title">${title}</div><div class="tb-right">${right}</div></header>`;

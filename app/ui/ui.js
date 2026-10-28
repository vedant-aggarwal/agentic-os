// The design system's JS (app/ui/STRUCTURE.md): skins and theme, rings and their draw-in, the segmented control,
// peek and hold. app.js imports this before anything renders and hands every piece to modules on window.AOS
// (app/MODULES.md lists them). Plain ES module, no build step, relative paths only (scripts/build-www.mjs).
import { I, areaIcon } from './icons.js';
export { I, areaIcon };

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const html = document.documentElement;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const QS = new URLSearchParams(location.search);
const forceReduce = QS.get('motion') === 'reduce';
export const reduced = () => forceReduce || matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
// app.js passes its haptic() and the page you are looking at (the top pushed page, else the current tab)
let hooks = { haptic: () => {}, visiblePage: () => null };

// ---------- Skins ----------
// The skin is one attribute on <html> (data-skin="obsidian" | "matte"); every skin rule in the CSS is scoped to it.
// index.html sets it before the first paint (?skin= > localStorage 'aos-skin' > obsidian); this keeps it in sync.
const SKIN_KEY = 'aos-skin', THEME_KEY = 'aos-theme';
export const SKINS = [
  { id: 'obsidian', name: 'Obsidian', bar: { dark: '#050506', light: '#e7e7eb' } },
  { id: 'matte', name: 'Matte', bar: { dark: '#12100e', light: '#efe9e0' } },
];
const knownSkin = (id) => SKINS.some((s) => s.id === id);
export const skin = () => html.dataset.skin;

// The theme: Auto (follows the phone) · Dark · Light. data-theme on <html> is always the resolved value.
const THEMES = ['auto', 'dark', 'light'];
const osLight = matchMedia('(prefers-color-scheme: light)');
let themeOverride = THEMES.includes(QS.get('theme')) ? QS.get('theme') : null;   // ?theme= for one visit
export const theme = () => themeOverride ?? (THEMES.includes(read(THEME_KEY)) ? read(THEME_KEY) : 'auto');
const resolveTheme = (pref) => (pref === 'light' || (pref === 'auto' && osLight.matches) ? 'light' : 'dark');

// browser chrome follows both: the status bar colour is the ground of the skin in that theme
function syncMeta() {
  const s = SKINS.find((x) => x.id === skin()) ?? SKINS[0];
  const c = html.dataset.theme === 'light' ? s.bar.light : s.bar.dark;
  for (const m of $$('meta[name="theme-color"]')) m.setAttribute('content', c);
}
// every copy of a control shows the same choice
function syncControls() {
  for (const sg of $$('.segmented[data-seg="skin"]')) selectSeg(sg, skin());
  for (const sg of $$('.segmented[data-seg="theme"]')) selectSeg(sg, theme());
}
// A switch is an instant attribute write inside a short crossfade (View Transitions; a plain fade of the screen
// where they are missing). The page you are on then draws its rings in once, in the new material.
function crossfade(apply, animate) {
  const run = () => { apply(); pulse(hooks.visiblePage()); };
  if (!animate) { run(); return; }
  if (document.startViewTransition) { document.startViewTransition(run); return; }
  const host = $('#screen') ?? document.body;
  host.classList.add('skin-fade', 'skin-out');
  setTimeout(() => { run(); requestAnimationFrame(() => host.classList.remove('skin-out')); setTimeout(() => host.classList.remove('skin-fade'), 240); }, 140);
}
export function setSkin(id, { animate = true } = {}) {
  if (!knownSkin(id)) return;
  if (id === skin()) { syncControls(); return; }
  crossfade(() => { html.dataset.skin = id; store(SKIN_KEY, id); syncMeta(); syncControls(); }, animate);
}
export function setTheme(pref, { animate = true } = {}) {
  if (!THEMES.includes(pref)) return;
  themeOverride = null;
  store(THEME_KEY, pref);
  const next = resolveTheme(pref);
  if (next === html.dataset.theme) { syncControls(); return; }
  crossfade(() => { html.dataset.theme = next; syncMeta(); syncControls(); }, animate);
}
osLight.addEventListener?.('change', () => { if (theme() === 'auto') setTheme('auto'); });

// ---------- Segmented control ----------
// seg('jobs', [['board', 'Board'], ['projects', 'Projects', 5]], 'board', { role: 'tab' }) → markup. Segments are equal
// width, so the lens is placed by CSS from --i; one delegated listener moves it and fires a bubbling 'segchange'
// ({ detail: value }) on the control. role 'tab' (views) uses aria-selected; 'radio' (settings) aria-checked.
export function seg(name, items, on, { cls = '', label = '', role = 'radio' } = {}) {
  const i = Math.max(0, items.findIndex(([v]) => v === on));
  const attr = role === 'tab' ? 'aria-selected' : 'aria-checked';
  return `<div class="segmented ${cls}" data-seg="${esc(name)}" role="${role === 'tab' ? 'tablist' : 'radiogroup'}"${label ? ` aria-label="${esc(label)}"` : ''} style="--n:${items.length};--i:${i}"><span class="seg-thumb" aria-hidden="true"></span>`
    + items.map(([v, h, n], k) => `<button type="button" role="${role}" data-v="${esc(v)}" ${attr}="${k === i}">${h}${n != null && n !== '' ? ` <span class="n">${esc(n)}</span>` : ''}</button>`).join('')
    + '</div>';
}
export function selectSeg(sg, v) {
  if (!sg) return;
  const bs = $$(':scope > button', sg);
  const i = bs.findIndex((b) => b.dataset.v === v);
  if (i < 0) return;
  bs.forEach((b, k) => b.setAttribute(b.getAttribute('role') === 'tab' ? 'aria-selected' : 'aria-checked', String(k === i)));
  sg.style.setProperty('--i', i);
}
const segValue = (sg) => $$(':scope > button', sg).find((b) => b.getAttribute('aria-selected') === 'true' || b.getAttribute('aria-checked') === 'true')?.dataset.v;
document.addEventListener('click', (e) => {
  const b = e.target.closest('.segmented[data-seg] > button');
  if (!b || b.disabled) return;
  const sg = b.parentElement;
  if (segValue(sg) === b.dataset.v) return;
  selectSeg(sg, b.dataset.v);
  hooks.haptic('selection');
  sg.dispatchEvent(new CustomEvent('segchange', { detail: b.dataset.v, bubbles: true }));
});
// the Appearance and Theme controls (More → App, the account sheet) work wherever they are drawn
document.addEventListener('segchange', (e) => {
  const name = e.target.dataset?.seg;
  if (name === 'skin') setSkin(e.detail);
  else if (name === 'theme') setTheme(e.detail);
});
// The control: the segmented control, each option leading with a tiny swatch of its skin, painted by that skin's file.
export const skinSeg = (cls = '') => seg('skin', SKINS.map((s) => [s.id, `<span class="skin-sw" data-sw="${s.id}" aria-hidden="true"></span>${s.name}`]), skin(), { cls: `skin-seg ${cls}`, label: 'Appearance' });
export const themeSeg = (cls = '') => seg('theme', [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']], theme(), { cls: `sm ${cls}`, label: 'Theme' });

// ---------- Rings ----------
const fmtDur = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);
// A ring. p is progress and may pass 1 (the ring laps itself). hue: today | jobs | clients | content | life | needs.
// k (0–1) puts a marker across the track. The markup is the union of what every skin paints; each skin reacts only
// to its own layers: .rg-l is Obsidian's light; .ink-tex is Matte's printed texture (strokes of 9px and up).
// Set --ring-bg on an ancestor to the surface colour under the ring (Matte mixes its track into it).
export const ring = (p, hue = 'today', size = 44, w = 6, { inner = '', cls = '', k = null, id = '', delay = 0, label = '' } = {}) => {
  const v = Math.max(0, Number(p) || 0).toFixed(4);
  const style = `--size:${size}px;--w:${w}px;--rp:${v}${k != null ? `;--k:${Number(k).toFixed(4)}` : ''}`;
  const tex = w >= 9 ? ' ink-tex' : '';
  return `<span class="rg ${hue}${tex} ${cls}"${id ? ` id="${esc(id)}"` : ''} data-v="${v}"${delay ? ` data-delay="${delay}"` : ''} style="${style}" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>`
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

// pulse(root): when a tab or page opens, its rings draw to their value once and the figures marked
// data-count="<n>" (data-fmt="int|hm|dur|dec|pct") count up beside them. The open sets every skin's state class;
// each skin's CSS answers to its own: bloom (Obsidian's light swells and settles), ink (Matte's cap bleeds).
// The draw's length and curve come from the skin's tokens (--draw, --count-ease), so the count keeps pace.
const springX = (k) => { const u = k * 7.15; return Math.min(1, (1 - (1 + 0.75 * u) * Math.exp(-u)) / 0.9948); };
const inkX = (k) => { const u = 1 - k; return 1 - u * u * u * (1 - 0.35 * k); };
function drawTiming() {
  const cs = getComputedStyle(html);
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
  if (!rings.length && !nums.length) return;
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

// ---------- Peek: hold something to preview it ----------
// peek(html, [{ label, icon, run }]) shows a card over a veil with an optional menu; a tap outside closes it.
export function peek(body, menu = []) {
  const w = $('#peek');
  if (!w) return;
  w.innerHTML = `<div><div class="peek overlay">${body}</div>${menu.length ? `<div class="peek-menu overlay" role="menu">${menu.map((m, i) => `<button type="button" role="menuitem" data-peek-i="${i}">${esc(m.label)}${m.icon ?? ''}</button>`).join('')}</div>` : ''}</div>`;
  w._menu = menu;
  w.classList.add('on');
  w.setAttribute('aria-hidden', 'false');
  hooks.haptic('medium');
}
export function closePeek() { const w = $('#peek'); if (!w) return; w.classList.remove('on'); w.setAttribute('aria-hidden', 'true'); }
document.addEventListener('click', (e) => {
  const w = e.target.closest?.('#peek');
  if (!w) return;
  const b = e.target.closest('[data-peek-i]');
  if (b) { const m = w._menu?.[+b.dataset.peekI]; closePeek(); m?.run?.(); return; }
  if (!e.target.closest('.peek')) closePeek();
});
addEventListener('keydown', (e) => { if (e.key === 'Escape') closePeek(); });
// onHold(root, selector, fn(el, e), ms): a press held still for ms (10px of slop) fires fn and swallows the click.
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

// ---------- Boot ----------
export function initUI({ haptic, visiblePage } = {}) {
  if (haptic) hooks.haptic = haptic;
  if (visiblePage) hooks.visiblePage = visiblePage;
  if (!knownSkin(skin())) html.dataset.skin = SKINS[0].id;
  if (!['dark', 'light'].includes(html.dataset.theme)) html.dataset.theme = resolveTheme(theme());
  syncMeta();
}

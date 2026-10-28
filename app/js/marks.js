// Animated marks: the agents that do the work, drawn so you can see what they are doing.
//   Claude  the starburst: ten rays at the approved glyph's angles, a hair uneven like a hand-drawn spark
//   Codex   the hexagon with its prompt: the cursor blinks, the outline runs, the prompt folds into a tick
//   Wyn    her small orb (Wyn for a new user): the mood colours the living orb broadcasts (orb.js setMood)
// Six states each: idle (barely breathing) · thinking · working · needs (a gentle attention pulse) · done (a settle
// and a tick) · failed. markHTML(agent, { state, size }) → html · setMarkState(el, state). 14–96 px.
// Marks are ink (agents are glyphs, not colours); only needs, done and failed carry their semantic colour.
// Also a few live glyphs for primary actions: play/pause, scan, mic level, the agent's spark. Owner: MOTION.
import { morph, reduced, symbol } from './motion.js';

export const MARK_STATES = ['idle', 'thinking', 'working', 'needs', 'done', 'failed'];
const NAME = { claude: 'Claude', codex: 'Codex', wyn: 'Wyn', wyn: 'Wyn', agent: 'Wyn' };
const WORD = { idle: 'idle', thinking: 'thinking', working: 'working', needs: 'needs you', done: 'done', failed: 'failed' };
let phase = 0;   // golden-ratio steps: neighbouring marks never breathe in step
const tierOf = (size) => (size <= 18 ? 'xs' : size <= 28 ? 'sm' : size <= 56 ? 'md' : 'lg');

// ── Claude: [angle clockwise from 12 o'clock, length]. Each ray is a capsule (HTML, so its motion runs on the
//    compositor: transform and opacity only, nothing repaints). A ray changes length by sliding along its own axis
//    under an opaque core, so its cap stays round and its root never leaves the centre; ten of them 2.3 wide meet the
//    core at r≈3.3–3.6, which gives the spark its notched solid centre. Geometry is in the icon's 24-unit grid. ─────
const RAYS = [[0, 1], [41, 0.95], [78, 1], [114, 0.97], [155, 0.94], [191, 1], [227, 0.96], [263, 0.99], [296, 0.95], [336, 0.97]];
const R_IN = 0.7;
// a static, rotated arm (its angle inline) holds a capsule that only ever moves along it, in % of its own length: the
// keyframes carry no var(), which is what lets the browser run them off the main thread
const rayHTML = ([a, l], i) => `<i class="am-rw" style="transform:rotate(${a}deg)"><i class="am-ray am-r${i % 2}" style="--rv:${(R_IN + 0.86 * (10.1 * l - R_IN)).toFixed(3)};--i:${i}"></i></i>`;
const claudeHTML = () => `<span class="am-cl">${RAYS.map(rayHTML).join('')}<i class="am-core"></i></span>`;

// ── Codex: the hexagon and the prompt as SVG (two paths whose commands match the tick's and the cross's, so done and
//    failed are exact morphs: the chevron folds, the cursor swings up), and its running light as a turning beam
//    masked to the outline (a transform, so it runs on the compositor too). ─────────────────────────────────────────
const HEX = 'M12 2.8 L20 7.4 L20 16.6 L12 21.2 L4 16.6 L4 7.4 Z';
const PROMPT = { chev: 'M8.6 10.2 L11 12.2 L8.6 14.2', cur: 'M13 14.6 L16 14.6' };
const TICK = { chev: 'M8.3 12.5 L10.8 15 L10.8 15', cur: 'M10.8 15 L15.9 9.5' };
const CROSS = { chev: 'M9.3 9.3 L12 12 L14.7 14.7', cur: 'M14.7 9.3 L9.3 14.7' };
const promptFor = (s) => (s === 'done' ? TICK : s === 'failed' ? CROSS : PROMPT);
const codexHTML = (s) => {
  const p = promptFor(s);
  return `<svg class="am-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="am-hex" d="${HEX}"/><path class="am-hl" pathLength="1" d="${HEX}"/>`
    + `<path class="am-chev" d="${p.chev}"/><path class="am-cur" pathLength="1" d="${p.cur}"/></svg><i class="am-run"></i>`;
};

// the status badge, bottom right, cut out of whatever the mark sits on (--am-bg, like the rings' --ring-bg); the halo
// that goes out while it waits on you is a plain ring (HTML), so it composites
const BADGE = '<i class="am-halo"></i><svg class="am-bsvg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g class="am-badge"><g class="am-bi"><circle class="am-bd" cx="19.4" cy="19.4" r="4.3"/>'
  + '<path class="am-bt" pathLength="1" d="M17.5 19.5 L18.8 20.8 L21.3 18.1"/><path class="am-bx" pathLength="1" d="M17.9 17.9 L20.9 20.9 M20.9 17.9 L17.9 20.9"/></g></g></svg>';

/**
 * A mark as html. agent: 'claude' | 'codex' | 'wyn' ('wyn' and 'agent' are Wyn). state: one of MARK_STATES.
 * size in px (14–96); label overrides the spoken name. cls adds classes (e.g. the tile it sits in).
 */
export function markHTML(agent = 'claude', { state = 'idle', size = 24, label, cls = '' } = {}) {
  const a = agent === 'wyn' || agent === 'agent' ? 'wyn' : NAME[agent] ? agent : 'claude';
  const s = MARK_STATES.includes(state) ? state : 'idle';
  const name = label ?? NAME[agent] ?? NAME[a];
  const head = `<span class="am am-${a} am-${tierOf(size)} am-s-${s}${cls ? ` ${cls}` : ''}" data-am="${a}" data-state="${s}" style="--am-size:${size}px;--am-ph:${(phase = (phase + 0.618) % 1).toFixed(3)}" role="img" aria-label="${name}, ${WORD[s]}">`;
  if (a === 'wyn') return `${head}<span class="am-in am-orb" aria-hidden="true"><i class="am-o1"></i><i class="am-o2"></i></span><i class="am-dot" aria-hidden="true"></i></span>`;
  return `${head}<span class="am-in" aria-hidden="true">${a === 'claude' ? claudeHTML() : codexHTML(s)}</span>${BADGE}</span>`;
}

// what a loop leaves behind when it stops: the parts glide home instead of snapping
const LOOPED = '.am-in, .am-ray, .am-cl, .am-cur, .am-chev, .am-hex, .am-run, .am-halo, .am-o1';   // (ray motion is along its arm)
const LOOPS = new Set(['thinking', 'working', 'needs']);
function settle(el, run, from) {
  if (reduced() || !LOOPS.has(from)) { run(); return; }
  const parts = [...el.querySelectorAll(LOOPED)];
  const was = parts.map((p) => { const cs = getComputedStyle(p); return [cs.transform, cs.opacity, cs.strokeDasharray]; });
  run();
  parts.forEach((p, i) => {
    const cs = getComputedStyle(p);
    if (cs.animationName && cs.animationName !== 'none') return;   // the new state loops this part: let it
    const [t, o, d] = was[i];
    if (t === cs.transform && o === cs.opacity && d === cs.strokeDasharray) return;
    const from = { transform: t, opacity: o }, to = { transform: cs.transform, opacity: cs.opacity };
    if (d !== cs.strokeDasharray && d !== 'none' && cs.strokeDasharray !== 'none') { from.strokeDasharray = d; to.strokeDasharray = cs.strokeDasharray; }
    p.animate([from, to], { duration: 420, easing: 'cubic-bezier(.22, 1, .36, 1)' });
  });
}

/** Move a mark (the .am element, or anything holding one) to a new state, with that state's one-time moment. */
export function setMarkState(host, state) {
  const el = host?.classList?.contains('am') ? host : host?.querySelector?.('.am');
  if (!el || !MARK_STATES.includes(state)) return;
  const prev = el.dataset.state;
  if (prev === state) return;
  settle(el, () => {
    el.classList.remove(`am-s-${prev}`, 'am-go');
    el.classList.add(`am-s-${state}`);
    el.dataset.state = state;
  }, prev);
  const label = el.getAttribute('aria-label') ?? '';
  el.setAttribute('aria-label', `${label.split(', ')[0]}, ${WORD[state]}`);
  clearTimeout(el._amT);
  if (!reduced()) { requestAnimationFrame(() => { if (el.dataset.state === state) el.classList.add('am-go'); }); el._amT = setTimeout(() => el.classList.remove('am-go'), 1700); }
  if (el.dataset.am === 'codex') {
    const p = promptFor(state);
    morph(el.querySelector('.am-chev'), p.chev, { spring: 'snappy' });
    morph(el.querySelector('.am-cur'), p.cur, { spring: 'snappy' });
  }
}

/** Wyn's orb swells with her voice: level 0–1 from an audio meter (other marks ignore it). */
export function setMarkLevel(host, level) {
  const el = host?.classList?.contains('am') ? host : host?.querySelector?.('.am');
  if (el) el.style.setProperty('--lvl', Math.max(0, Math.min(1, +level || 0)).toFixed(3));
}

/** Pause the loops of marks (and live glyphs) that are off screen; returns a stop function. */
export function pauseOffscreen(root = document) {
  if (typeof IntersectionObserver === 'undefined') return () => {};
  const io = new IntersectionObserver((es) => es.forEach((e) => e.target.classList.toggle('am-off', !e.isIntersecting)), { rootMargin: '40px' });
  const scan = () => root.querySelectorAll('.am:not([data-am-io]), .amg:not([data-am-io])').forEach((m) => { m.dataset.amIo = '1'; io.observe(m); });
  scan();
  const mo = new MutationObserver(scan);
  mo.observe(root === document ? document.body : root, { childList: true, subtree: true });
  return () => { io.disconnect(); mo.disconnect(); };
}

// ── live glyphs for primary actions (24-unit grid, the icon set's 2px line). glyphHTML(name, { size, state }) ───────
//   playpause  state 'play' | 'pause': the triangle splits into the two bars (setGlyph(el, 'pause'))
//   scan       state 'idle' | 'scanning': the lens corners close in and a line sweeps
//   mic        setGlyphLevel(el, 0–1): the sound arcs follow your voice
//   spark      the agent's spark in a circle; state 'idle' | 'thinking'; symbol(el, 'twinkle') turns it once
const PP = {
  play: ['M8 5.2 L13.3 8.6 L13.3 15.4 L8 18.8 Z', 'M13.3 8.6 L19 12 L19 12 L13.3 15.4 Z'],
  pause: ['M6.6 5.4 L10.4 5.4 L10.4 18.6 L6.6 18.6 Z', 'M13.6 5.4 L17.4 5.4 L17.4 18.6 L13.6 18.6 Z'],
};
const GLYPH = {
  playpause: (s) => { const [a, b] = PP[s === 'pause' ? 'pause' : 'play']; return `<path class="amg-pp" d="${a}"/><path class="amg-pp" d="${b}"/>`; },
  scan: () => '<path class="amg-sc-c" d="M4 8.5v-2A2.5 2.5 0 0 1 6.5 4h2M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2"/><path class="amg-sc-l" d="M7.5 12h9"/>',
  mic: () => '<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M12 17.5V21"/><path class="amg-mc-a" d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path class="amg-mc-w amg-mc-w1" d="M3.2 8.6a9 9 0 0 0 0 4.8"/><path class="amg-mc-w amg-mc-w2" d="M20.8 8.6a9 9 0 0 1 0 4.8"/>',
  spark: () => '<circle class="amg-sp-o" cx="12" cy="12" r="8.8"/><path class="amg-sp-s" d="M12 6.8c.45 2.85 1.75 4.15 4.6 4.6-2.85.45-4.15 1.75-4.6 4.6-.45-2.85-1.75-4.15-4.6-4.6 2.85-.45 4.15-1.75 4.6-4.6Z"/>',
};
export function glyphHTML(name, { size = 24, state = 'idle', label = '' } = {}) {
  const g = GLYPH[name]; if (!g) return '';
  return `<span class="amg amg-${name} amg-s-${state}" data-amg="${name}" data-state="${state}" style="--am-size:${size}px"${label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"'}>`
    + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${g(state)}</svg></span>`;
}
export function setGlyph(host, state) {
  const el = host?.classList?.contains('amg') ? host : host?.querySelector?.('.amg');
  if (!el || el.dataset.state === state) return;
  el.classList.remove(`amg-s-${el.dataset.state}`); el.classList.add(`amg-s-${state}`); el.dataset.state = state;
  if (el.dataset.amg === 'playpause') {
    const [a, b] = PP[state === 'pause' ? 'pause' : 'play'];
    const ps = el.querySelectorAll('.amg-pp');
    morph(ps[0], a, { spring: 'snappy' }); morph(ps[1], b, { spring: 'snappy' });
  }
  if (el.dataset.amg === 'spark' && state === 'twinkle') { twinkle(el); el.dataset.state = 'idle'; el.classList.replace('amg-s-twinkle', 'amg-s-idle'); }
}
/** The mic's arcs follow a level (0–1): call it from an audio meter, ~30–60 times a second. */
export function setGlyphLevel(host, level) {
  const el = host?.classList?.contains('amg') ? host : host?.querySelector?.('.amg');
  if (el) el.style.setProperty('--lvl', Math.max(0, Math.min(1, +level || 0)).toFixed(3));
}
/** The agent's spark turns a quarter and twinkles once (her tab opening, a reply arriving). */
export function twinkle(host) {
  const s = (host?.querySelector?.('.amg-sp-s')) ?? host;
  if (!s || reduced()) return null;
  return s.animate([
    { transform: 'rotate(0deg) scale(1)' },
    { transform: 'rotate(50deg) scale(.62)', offset: 0.4 },
    { transform: 'rotate(96deg) scale(1.12)', offset: 0.78 },
    { transform: 'rotate(90deg) scale(1)' },
  ], { duration: 640, easing: 'cubic-bezier(.3, .7, .4, 1)' });
}
export { symbol };

// The one capture lens: the round button beside the tab bar. Scan · Voice · Type · Files on one surface.
// It opens straight on the camera. The agent (through Jev) works out what it sees, outlines it, suggests where it goes,
// and hands the result to the app that owns it (registerAspect({ scan }) · Content OS · the Brain). Several in a row.
// Owner: CAPTURE (v2). Provides on the bus: openCapture(mode, ctx), scan(hint), openShareIn(sample).
// Keeps exporting openCapture, recorder, liftWithKeyboard and animateHeight (Work, Clients and Wyn import them).
// v2: in real mode the camera is the phone's (a live viewfinder; the native camera or a file when that isn't allowed), the
// PC reads each shot (POST /mod/scan/classify: Codex, plus the phone's own OCR and first guess), and a result goes to the
// app that owns its kind (capture-route.js). Shots taken offline wait on the phone. Voice goes through the real recorder
// (the PC transcribes with Codex) and "say it once" (/mod/scan/say). Demo mode (?data=demo) keeps the prototype's scenes.
import { $, $$, esc, on, toast, haptic, onHold, seg, wireSegs, closeSheet } from './core.js';
import { I } from './icons.js';
import { PROJECTS, AGENT, ASPECTS, aspect, DEMO_MODE, TASKS, addTask, dropTask, updateTask, onData } from './data.js';
import { scope } from './scope.js';
import { api, provide, has } from './bus.js';
import { aspectTile } from './aspects.js';
import { SCENES, sceneSvg, sceneIndex, SCENE_BOX } from './capture-scenes.js';
import { routeScan, takes, handlerFor } from './capture-route.js';
import { openShareIn } from './capture-share.js';
import * as R from './capture-real.js';
import * as clock from './svc/clock.js';
import { native } from './svc/native-plugins.js';
import { registerRoute } from './svc/route.js';
import * as SYNC from './svc/sync.js';
import * as API from './svc/api.js';

/** Real data (the phone's camera, the PC's reading); demo mode keeps the sample scenes */
const REAL = !DEMO_MODE;
// MOTION's kit, loaded on the side: a problem in it never takes the lens down
let MX = null;
import('./motion.js').then((m) => { MX = m; }).catch(() => {});
const mx = (fn) => { try { if (MX && !reduced()) fn(MX); } catch (e) { console.warn('[capture] motion', e); } };
/** The card's parts arrive one after another (the draft, where it goes, the button) */
const arrive = (root, sel = '.cap-draft > *, .cap-rows p, .cap-dest, .cap-note, .cap-file, .cap-alts') => mx((m) => m.stagger([...root.querySelectorAll(sel)], { y: 10, each: 34, max: 320 }));

const isAspect = (id) => ASPECTS.some((a) => a.id === id);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const MODES = [['scan', 'Scan'], ['voice', 'Voice'], ['type', 'Type'], ['files', 'Files']];
const G = {
  torch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3h8v3l-2 4v10a2 2 0 0 1-4 0V10L8 6z"/><path d="M12 13v2"/></svg>',
  flip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 9.5a8 8 0 0 1 14.2-2.8M19.5 14.5a8 8 0 0 1-14.2 2.8"/><path d="M19 3v4h-4M5 21v-4h4"/></svg>',
  photos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="14" rx="3.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-4.5 4 3.5 3-2.5 4.5 3.5"/></svg>',
  pdf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5h7.5l4 4v11.5a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5Z"/><path d="M13.5 3.5V8h4.5"/></svg>',
};

// ── what a thing is: the card leads with the kind of object it read (where it goes has its own tile and colour) ──
const K = {
  receipt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h12v17l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/></svg>',
  food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/></svg>',
  face: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5c-4 0-6.5 3-6.5 7.2 0 4.6 3 9.3 6.5 9.3s6.5-4.7 6.5-9.3c0-4.2-2.5-7.2-6.5-7.2Z"/><path d="M9.5 10.5h.01M14.5 10.5h.01M10 15c1.2.8 2.8.8 4 0"/></svg>',
};
const KIND_ICON = { receipt: K.receipt, statement: I.doc, food: K.food, face: K.face, book: I.book, page: I.edit, chat: I.chat, card: I.user, document: I.doc, goals: I.target, reel: I.play, link: I.link };
const kindTile = (kind) => `<span class="tile cap-kind cap-kt" aria-hidden="true">${KIND_ICON[kind] ?? I.scan}</span>`;

// ── where things go: a tile and a fill for every destination the lens can suggest ──
const DEST = {
  content: { name: 'Content', icon: I.content, fill: 'var(--content-fill)', tint: 'var(--content)' },
  brain: { name: 'Brain', icon: I.graph, fill: 'var(--ink)', tint: 'var(--ink-3)' },
  today: { name: 'Today', icon: I.today, fill: 'var(--today-fill)', tint: 'var(--today)' },
  none: { name: '', icon: I.rewind, fill: 'var(--ink)', tint: 'var(--ink-3)' },
};
const destTile = (app, cls = '') => (isAspect(app) ? aspectTile(app, cls) : `<span class="tile cap-dt ${cls}" style="--t:${DEST[app]?.tint ?? 'var(--ink-3)'}" aria-hidden="true">${DEST[app]?.icon ?? I.grid}</span>`);
// the base colour, read where it's used, so inside the always-dark camera it takes the dark theme's value
const destFill = (app) => (isAspect(app) ? `var(--${app})` : DEST[app]?.fill ?? 'var(--ink)');
const destName = (app) => (isAspect(app) ? aspect(app).name : DEST[app]?.name ?? '');

// ── files you can bring in: recent photos, PDFs and screenshots on the phone ──
const FILES = [
  { id: 'f-stmt', name: 'Demo Bank statement, Oct', meta: 'PDF · 3 pages · 09:12', thumb: 'pdf', kind: 'statement',
    title: 'Bank statement · Demo Bank', sub: '1 to 21 Oct · 38 rows', rows: [['New to Money', '31 rows'], ['Already logged from UPI', '7 rows'], ['Biggest', '₹2,400 · Myntra']],
    to: { app: 'money', where: 'Money · October', act: 'Review 31 rows', done: '31 rows went to Money for your review' },
    alts: [{ label: 'Save to Brain', app: 'brain', where: 'Brain › Money › Statements', act: 'Save', done: 'Saved to Money › Statements' }],
    result: { kind: 'statement', title: 'Demo Bank statement', fields: { bank: 'Demo Bank', period: '1–21 Oct', rows: [{ date: '2026-10-21', desc: 'UPI · Swiggy', amount: -340 }, { date: '2026-10-20', desc: 'UPI · Uber', amount: -210 }, { date: '2026-10-19', desc: 'Myntra', amount: -2400 }, { date: '2026-10-18', desc: 'From Dad', amount: 5000 }] } } },
  { id: 'f-reel', name: 'Screenshot 16:48', meta: 'Screenshot · a reel', thumb: 'reel', kind: 'reel',
    title: 'Reel · “one app instead of five”', sub: 'Instagram · from a screenshot', quote: 'A creator walks through one app that replaced five, in 40 seconds.',
    to: { app: 'content', where: 'Content · Ideas', act: 'Add as an idea', done: 'Added to Content ideas' },
    alts: [{ label: 'Save to Brain', app: 'brain', where: 'Brain › Mission › Projects', act: 'Save', done: 'Saved to Mission › Projects' }],
    result: { kind: 'reel', title: 'One app instead of five', fields: { url: 'instagram.com/reel/one-app', platform: 'Instagram', title: 'One app instead of five', why: 'Same angle as your R4 script, a reference for pacing' } } },
  { id: 'f-thali', name: 'IMG_2214', meta: 'Photo · 13:40', thumb: 'food', scene: 'food' },
  { id: 'f-doc', name: 'GE I assessment', meta: 'PDF · Mon 19 Oct', thumb: 'pdf', scene: 'doc' },
  { id: 'f-rcpt', name: 'IMG_2209', meta: 'Photo · 13:55', thumb: 'receipt', scene: 'receipt' },
  { id: 'f-chat', name: 'Screenshot 17:06', meta: 'Screenshot · chat', thumb: 'chat', scene: 'chat' },
];
const fileItem = (f) => (f.scene ? { ...SCENES.find((s) => s.id === f.scene), fromFile: f } : f);

// ── voice: say it once, she files every part where it belongs ──
const SAY = 'Read Atomic Habits for 30 minutes. Now I\'m sitting with Mom and Dad. Spent ₹120 on samosas for everyone.';
const HEARD = [
  { app: 'mind', what: 'Reading', detail: 'Atomic Habits, 30 min · page 142 to 172', done: 'Logged 30 min of reading' },
  { app: 'family', what: 'Moment', detail: 'With Mom and Dad, 17:42', done: 'Moment saved' },
  { app: 'money', what: 'Expense', detail: '₹120 · samosas · Food & drinks', done: '₹120 added' },
];
const EXAMPLES = [['I read Atomic Habits for 30 minutes', [0]], ['I\'m sitting with family', [1]], ['Spent ₹120 on samosas', [2]]];
const ASK_SAY = 'What did I save about Kabir?';

// ── the lens ──────────────────────────────────────────────────────────
let L = null;
const alive = () => L?.el?.isConnected;
const FRAME = [[66, 250], [336, 250], [336, 520], [66, 520]];

const CORNERS = ['M0 24V8a8 8 0 0 1 8-8h16', 'M-24 0H-8a8 8 0 0 1 8 8v16', 'M0-24v16a8 8 0 0 1-8 8h-16', 'M24 0H8a8 8 0 0 1-8-8v-16'];
function lensHtml() {
  if (REAL) return realLensHtml();
  const corner = CORNERS;
  return `
    <div class="cap-cam stay-dark" data-scroll-x>
      <div class="cap-strip">${SCENES.map((s, i) => `<div class="cap-scene" data-i="${i}" style="--i:${i}">${sceneSvg(s)}</div>`).join('')}</div>
      <svg class="cap-ov" viewBox="0 0 ${SCENE_BOX.W} ${SCENE_BOX.H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path class="cap-dim" fill-rule="evenodd" d=""/>
        ${corner.map((d, i) => `<g class="cap-c" data-c="${i}"><path d="${d}"/></g>`).join('')}
      </svg>
      <button class="cap-tag chrome" data-act="cap-shutter" aria-live="polite"></button>
      <i class="cap-flash" aria-hidden="true"></i>
    </div>
    <header class="cap-top">
      <button class="gbtn chrome icon" data-act="cap-close" aria-label="Close">${I.x}</button>
      <button class="cap-count chrome" data-act="cap-session" hidden></button>
      <button class="gbtn chrome icon cap-torch" data-act="cap-torch" aria-label="Torch" aria-pressed="false">${G.torch}</button>
    </header>
    <div class="cap-pane overlay" hidden></div>
    <div class="cap-card overlay" hidden></div>
    <footer class="cap-bottom">
      <div class="cap-dots" aria-hidden="true">${SCENES.map((s, i) => `<span class="cap-dot" data-i="${i}"><i></i></span>`).join('')}</div>
      <p class="cap-swipe" aria-live="polite"></p>
      <div class="cap-modes">${seg('cap-mode', MODES, 'scan', 'chrome')}</div>
      <div class="cap-shoot">
        <button class="cap-last" data-act="cap-last" aria-label="Files">${G.photos}</button>
        <button class="cap-shutter" data-act="cap-shutter" aria-label="Capture"><i></i></button>
        <button class="gbtn chrome icon cap-flip" data-act="cap-flip" aria-label="Flip to the front camera">${G.flip}</button>
      </div>
    </footer>`;
}

function buildLens(opts) {
  const el = document.createElement('section');
  el.className = 'cap-lens';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Capture');
  el.innerHTML = lensHtml();
  $('#phone').append(el);
  L = { el, mode: null, i: 0, state: 'looking', alt: null, filed: [], sub: 'task', item: null, dt: 0, opts, q: null, hint: null };
  wireSegs(el);
  if (REAL) realWire(el);
  el.addEventListener('change', (e) => { if (e.target.closest('[data-seg="cap-mode"]')) setMode(e.detail); });
  swipe(el);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLens(); });
  // it opens out of the Scan button, like the camera opening from the lock screen
  // (from the bottom centre when the dock has slid away under a pushed page), with a radius that reaches every corner
  const b = $('#captureBtn')?.getBoundingClientRect(), ph = $('#phone').getBoundingClientRect();
  const onScreen = b && b.top < ph.bottom - 4 && b.width > 0;
  const ox = onScreen ? b.left + b.width / 2 - ph.left : ph.width / 2, oy = onScreen ? b.top + b.height / 2 - ph.top : ph.height - 60;
  const r = Math.max(...[[0, 0], [ph.width, 0], [0, ph.height], [ph.width, ph.height]].map(([x, y]) => Math.hypot(x - ox, y - oy))) + 24;
  el.style.setProperty('--ox', `${ox.toFixed(0)}px`); el.style.setProperty('--oy', `${oy.toFixed(0)}px`); el.style.setProperty('--or', `${r.toFixed(0)}px`);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  haptic(10);
  return el;
}

// openCapture(mode, { hint }) · a hint that matches a scan kind (statement, receipt, food, face, book, page, chat, card,
// goals, document) opens the camera already expecting it; the result goes to the app that registered that kind
export function openCapture(type = 'scan', opts = {}) {
  // a scan kind in place of the mode (#scan/statement, openCapture('receipt')) is a hint for the camera
  if (type && (SCENES.some((s) => s.id === type || s.kind === type) || R.KINDS.includes(type))) { opts = { ...opts, hint: opts.hint ?? type }; type = 'scan'; }
  // capture?type=idea (the old + sheet's types, widgets, Siri) opens Type on that type; with voice=1 it records into it
  const TYPED = ['task', 'idea', 'job', 'note', 'ask'];
  if (!TYPED.includes(type) && TYPED.includes(opts.type) && (type === 'type' || type === 'voice' || type == null)) { if (type === 'voice') opts = { ...opts, record: true }; type = opts.type; }
  const legacy = TYPED.includes(type);
  const mode = legacy ? 'type' : ['scan', 'voice', 'type', 'files'].includes(type) ? type : 'scan';
  // a sheet that asked for the camera (Money's "scan a receipt") steps aside first
  $$('#phone > .sheet.in').forEach((s) => closeSheet(s));
  if (!alive()) buildLens(opts); else L.opts = { ...L.opts, ...opts };
  if (legacy) L.sub = type;
  const hint = opts.hint ?? opts.kind;
  if (REAL) L.hint = hint ? ({ doc: 'document' }[hint] ?? (R.KINDS.includes(hint) ? hint : null)) : L.hint;
  else if (hint && SCENES.some((s) => s.id === hint || s.kind === hint)) { L.i = sceneIndex(hint); L.expect = true; }
  setMode(mode, { force: true });
  if (mode === 'type' && opts.record) requestAnimationFrame(() => startRec());
  return L.el;
}
export const scan = (hint) => openCapture('scan', hint ? { hint } : {});

function closeLens() {
  if (!alive()) return;
  const { el, filed } = L;
  clearTimeout(L.dt); clearTimeout(L.doneT); L.voice?.stop?.(); T?.rec?.cancel(); T?.kbOff?.();
  if (REAL) { R.camera.stop(); L.unsub?.(); L.filesSub?.(); stopCountdown(); clearTimeout(L.tagT); }
  el.classList.remove('on'); el.classList.add('off');
  L = null; T = null;
  setTimeout(() => el.remove(), reduced() ? 160 : 460);
  if (filed.length > 1) toast(`Filed ${filed.length} things · ${[...new Set(filed.map((f) => destName(f.to.app)))].slice(0, 3).join(', ')}`);
}

function setMode(mode, { force = false } = {}) {
  if (!alive()) return;
  if (L.mode === mode && !force) return;
  const el = L.el; const was = L.mode;
  L.mode = mode;
  el.dataset.mode = mode;
  el.classList.toggle('stay-dark', mode === 'scan');
  const sg = $('[data-seg="cap-mode"]', el);
  $$('button', sg).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === mode)));
  requestAnimationFrame(() => sg._place?.());
  hideCard(true);
  if (was === 'voice') L.voice?.stop?.();
  if (was === 'type') { T?.rec?.cancel(); T?.kbOff?.(); T = null; }
  const pane = $('.cap-pane', el);
  pane.hidden = mode === 'scan';
  if (REAL && mode !== 'scan') R.camera.stop();
  if (mode === 'scan') { if (REAL) realLook(); else { place(true); detect(); } }
  else { clearTimeout(L.dt); pane.innerHTML = ''; pane.className = `cap-pane overlay cap-pane-${mode}`; ({ voice: voicePane, type: typePane, files: filesPane })[mode](pane); }
  if (was && was !== mode) haptic(5);
}

// ── scenes: swipe between them; the strip follows the finger and lands where the flick was heading ──
function place(instant = false) {
  const strip = $('.cap-strip', L.el);
  strip.style.transition = instant || reduced() ? 'none' : '';
  strip.style.transform = `translateX(${-L.i * 100}%)`;
  if (instant) requestAnimationFrame(() => { if (strip.isConnected) strip.style.transition = ''; });
  $$('.cap-dot', L.el).forEach((d, i) => d.classList.toggle('on', i === L.i));
  const sw = $('.cap-swipe', L.el); if (sw) sw.textContent = `${SCENES[L.i].name} · sample ${L.i + 1} of ${SCENES.length} · swipe for more`;
  L.el.classList.toggle('front', !!SCENES[L.i].front);
}
function go(i) {
  if (!alive()) return;
  L.i = (i + SCENES.length) % SCENES.length;
  place(); detect();
}
function swipe(el) {
  const cam = $('.cap-cam', el);
  let x0 = null, y0 = 0, t0 = 0, axis = null, dx = 0, dy = 0;
  cam.addEventListener('pointerdown', (e) => {
    if (L?.mode !== 'scan' || e.target.closest('button')) return;
    x0 = e.clientX; y0 = e.clientY; t0 = performance.now(); axis = null; dx = dy = 0;
  });
  cam.addEventListener('pointermove', (e) => {
    if (x0 == null || !alive()) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    if (!axis && Math.hypot(dx, dy) > 10) { axis = Math.abs(dx) > Math.abs(dy) ? (REAL ? 'none' : 'x') : dy > 0 ? 'y' : 'none'; if (axis !== 'none') { cam.setPointerCapture(e.pointerId); L.el.classList.add('dragging'); clearTimeout(L.dt); hideCard(true); } }
    if (axis === 'x') { const w = cam.offsetWidth; $('.cap-strip', el).style.transition = 'none'; $('.cap-strip', el).style.transform = `translateX(${-L.i * w + dx}px)`; }
    if (axis === 'y') { el.style.transition = 'none'; el.style.transform = `translateY(${Math.max(0, dy) * 0.92}px)`; }
  });
  const end = () => {
    if (x0 == null || !alive()) { x0 = null; return; }
    const dt = Math.max(1, performance.now() - t0), w = cam.offsetWidth;
    L.el.classList.remove('dragging');
    if (axis === 'x') {
      const v = dx / dt * 1000, proj = dx + (v / 1000) * 0.99 / (1 - 0.99) * 10;
      $('.cap-strip', el).style.transition = '';
      if (proj < -w * 0.35) go(L.i + 1); else if (proj > w * 0.35) go(L.i - 1); else { place(); detect(); }
    } else if (axis === 'y') {
      el.style.transition = ''; el.style.transform = '';
      if (dy > 150 || dy / dt > 0.7) closeLens();
      else if (L.state === 'looking' && !REAL) detect();
    }
    x0 = null; axis = null;
  };
  cam.addEventListener('pointerup', end); cam.addEventListener('pointercancel', end);
}

// ── seeing: outline what it found, dim the rest, name it ──
function setBrackets(quad) {
  const svg = $('.cap-ov', L.el);
  $$('.cap-c', svg).forEach((g, i) => {
    const [x, y] = quad[i]; const [nx, ny] = quad[(i + 1) % 4];
    const a = Math.atan2(ny - y, nx - x) * 180 / Math.PI - i * 90;
    g.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${a.toFixed(2)}deg)`;
  });
}
// the rest of the scene steps back; round things (a plate, a face) get a round window
function setDim(quad, round = false) {
  const p = $('.cap-dim', L.el);
  if (!quad) { p.classList.remove('on'); return; }
  const xs = quad.map((q) => q[0]), ys = quad.map((q) => q[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const rx = (Math.max(...xs) - Math.min(...xs)) / 2, ry = (Math.max(...ys) - Math.min(...ys)) / 2;
  const hole = round
    ? `M${(cx - rx).toFixed(1)} ${cy.toFixed(1)}a${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(2 * rx).toFixed(1)} 0a${rx.toFixed(1)} ${ry.toFixed(1)} 0 1 0 ${(-2 * rx).toFixed(1)} 0Z`
    : `M${quad.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L')}Z`;
  p.setAttribute('d', `M-20-20H${SCENE_BOX.W + 20}V${SCENE_BOX.H + 20}H-20Z ${hole}`);
  p.classList.add('on');
}
function toScreen([x, y]) {
  const cam = $('.cap-cam', L.el).getBoundingClientRect(), ph = L.el.getBoundingClientRect();
  const s = Math.max(cam.width / SCENE_BOX.W, cam.height / SCENE_BOX.H);
  return [x * s + (cam.width - SCENE_BOX.W * s) / 2 + cam.left - ph.left, y * s + (cam.height - SCENE_BOX.H * s) / 2 + cam.top - ph.top];
}
function setTag(state, s) {
  const tag = $('.cap-tag', L.el);
  if (state === 'looking') {
    tag.className = 'cap-tag chrome looking';
    tag.innerHTML = `<span class="spin" style="--c:var(--ink)"></span><span>${L.expect && s?.lookFor ? `Looking for a ${esc(s.lookFor)}` : 'Looking'}</span>`;
    tag.style.left = '50%'; tag.style.top = `${toScreen([0, 214])[1]}px`; tag.style.setProperty('--tx', '-50%'); return;
  }
  const xs = s.quad.map((q) => q[0]), ys = s.quad.map((q) => q[1]);
  const [lx, ty] = toScreen([Math.min(...xs), Math.min(...ys)]);
  const top = Math.max(ty - 14, toScreen([0, 150])[1]);
  tag.className = 'cap-tag chrome found';
  tag.innerHTML = `${I.sparkle}<span>${esc(s.tag)}</span>${I.chevR}`;
  tag.style.left = `${Math.max(16, lx)}px`; tag.style.top = `${top}px`; tag.style.setProperty('--tx', '0px');
  tag.setAttribute('aria-label', `${s.tag}. Capture`);
}
function detect() {
  if (!alive() || L.mode !== 'scan') return;
  const s = SCENES[L.i];
  L.state = 'looking'; L.alt = null; L.item = null;
  clearTimeout(L.dt);
  setBrackets(FRAME); setDim(null); setTag('looking', s);
  L.el.classList.remove('found');
  L.dt = setTimeout(() => {
    if (!alive() || L.mode !== 'scan' || SCENES[L.i] !== s) return;
    L.state = 'found'; L.expect = false; L.el.classList.add('found');
    setBrackets(s.quad); setDim(s.quad, s.round); setTag('found', s); haptic(6);
  }, reduced() ? 120 : 720);
}
function shutter() {
  if (!alive() || L.mode !== 'scan') return;
  if (REAL) { realShoot(); return; }
  if (L.state === 'review') return;
  const s = SCENES[L.i];
  clearTimeout(L.dt);
  if (L.state !== 'found') { L.state = 'found'; L.el.classList.add('found'); setBrackets(s.quad); setDim(s.quad, s.round); setTag('found', s); }
  const f = $('.cap-flash', L.el); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  haptic(14);
  showCard(s);
}

// ── the card: what it is, the draft it made, where it goes, the one tap, the alternatives ──
function draftHtml(item) {
  const rows = item.rows ? `<div class="cap-rows">${item.rows.map(([k, v]) => `<p><span>${esc(k)}</span><b>${esc(v)}</b></p>`).join('')}${item.total ? `<p class="tot"><span>${esc(item.total[0])}</span><b>${esc(item.total[1])}</b></p>` : ''}</div>` : '';
  const quote = item.quote ? `<p class="cap-quote">${esc(item.quote)}</p>` : '';
  const prog = item.progress != null ? `<div class="cap-progw"><p><span>${esc(item.progressLabel?.[0] ?? '')}</span><b>${esc(item.progressLabel?.[1] ?? '')}</b></p><div class="bar cap-prog" style="--p:${(item.progress * 100).toFixed(0)}%;--c:var(--mind)" role="img" aria-label="${Math.round(item.progress * 100)}% read"><i></i></div></div>` : '';
  const ev = item.event ? `<p class="cap-event">${I.cal}<span>${esc(item.event)}</span></p>` : '';
  return `${quote}${prog}${rows}${ev}`;
}
function cardHtml(item) {
  const to = L.alt != null ? item.alts[L.alt] : item.to;
  return `<div class="cap-card-in">
    <div class="cap-card-h">${kindTile(item.kind)}
      <div class="cap-card-t"><p class="cap-k">${I.sparkle}<span>${esc(AGENT.name)} · read by Jev in 0.${4 + (item.title.length % 5)} s</span></p><h3>${esc(item.title)}</h3><p class="cap-sub">${esc(item.sub)}</p></div>
      <button class="cap-card-x" data-act="cap-card-x" aria-label="Back to the camera">${I.x}</button></div>
    <div class="cap-draft">${draftHtml(item)}</div>
    <div class="cap-dest" aria-live="polite"><span class="cap-dest-l">Goes to</span>${destTile(to.app, 'sm')}<b>${esc(to.where)}</b></div>
    <button class="btn primary block cap-file" style="--c:${destFill(to.app)}" data-act="cap-file">${esc(to.act)}</button>
    ${item.alts?.length ? `<div class="chips cap-alts" role="group" aria-label="Or">${item.alts.map((a, i) => `<button class="chip sm${L.alt === i ? ' on' : ''}" data-act="cap-alt" data-i="${i}" aria-pressed="${L.alt === i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
  </div>`;
}
function showCard(item) {
  if (!alive()) return;
  L.item = item; L.state = L.mode === 'scan' ? 'review' : L.state;
  const c = $('.cap-card', L.el);
  c.innerHTML = cardHtml(item);
  c.hidden = false; c.classList.remove('done');
  requestAnimationFrame(() => c.classList.add('in'));
  L.el.classList.add('carding');
}
function hideCard(instant = false) {
  if (!alive()) return;
  const c = $('.cap-card', L.el);
  L.el.classList.remove('carding');
  c.classList.remove('in');
  if (instant) { c.hidden = true; c.innerHTML = ''; return; }
  setTimeout(() => { if (c.isConnected && !c.classList.contains('in')) { c.hidden = true; c.innerHTML = ''; } }, 320);
}
function brainAspect(item) { return item.result?.fields?.aspect ?? ({ receipt: 'money', statement: 'money', food: 'body', face: 'body', book: 'mind', page: 'growth', chat: 'friends', reel: 'mission' }[item.kind] ?? null); }
function fileNow() {
  if (!alive() || !L.item) return;
  if (REAL) { realFile(); return; }
  const item = L.item; const to = L.alt != null ? item.alts[L.alt] : item.to;
  if (to.app === 'none') { haptic(8); hideCard(); if (L.mode === 'scan') detect(); return; }
  if (to.app === 'today') {
    if (has('addTask')) { closeLens(); api.addTask(to.task); return; }
  } else if (to.app === 'brain') {
    api.remember(item.result.fields.text ?? item.quote ?? `${item.title}: ${item.sub}`, { aspect: brainAspect(item), person: to.person ?? null, title: item.title, via: item.fromFile ? 'a file' : 'a scan', by: 'you', quiet: true });
  } else {
    const result = { ...item.result, fields: { ...item.result.fields, ...(to.patch ?? {}) }, image: null };
    const { sheet, page } = routeScan(result);
    if (has('remember') && to.app !== 'content') api.remember(`${item.title}: ${item.sub}`, { aspect: isAspect(to.app) ? to.app : brainAspect(item), title: item.title, via: 'a scan', by: 'you', quiet: true });
    // the app opened its own page: step aside so you see it
    if (page) { record(item, to); closeLens(); return; }
    // the app opened its review sheet over the lens: when you close it, the lens moves on to the next thing
    if (sheet) { record(item, to); showDone(item, { ...to, done: `Over to ${destName(to.app)} to review` }, sheet); return; }
  }
  record(item, to);
  showDone(item, to);
}
function record(item, to) {
  if (!L) return;
  L.filed.push({ item, to, at: R.nowLabel(), undo: to.undo ?? null });
  const n = L.filed.length;
  const cnt = $('.cap-count', L.el); cnt.hidden = false;
  cnt.innerHTML = `${I.check}<span><b class="met">${n}</b> filed</span>`;
  cnt.classList.remove('bump'); void cnt.offsetWidth; cnt.classList.add('bump');
  mx((m) => m.symbol(cnt.querySelector('svg'), 'pop'));
  const last = $('.cap-last', L.el);
  last.innerHTML = item.draw ? `<span class="cap-last-img">${sceneSvg(item, `cl${n}-`)}</span>` : item.thumb ? `<span class="cap-last-img"><img src="${item.thumb}" alt=""></span>` : destTile(to.app, 'cap-last-t');
  last.setAttribute('aria-label', `${n} filed. See them`);
}
function showDone(item, to, waitFor = null) {
  const c = $('.cap-card', L.el); c.classList.add('done');
  c.innerHTML = `<div class="cap-done">${destTile(to.app, 'cap-kind')}<span class="cap-done-t"><b>${esc(to.done)}</b><small>${esc(to.where)} · just now</small></span>
    <span class="cap-done-ok" aria-hidden="true">${I.check}</span></div>
    <div class="cap-done-a">${!REAL || to.undo ? `<button class="btn sm" data-act="cap-undo">${I.undo}Undo</button>` : ''}${isAspect(to.app) ? `<button class="btn sm" data-act="cap-open-app" data-id="${to.app}">Open ${esc(aspect(to.app).name)}</button>` : ''}<span class="cap-done-next">${L.mode === 'scan' && (!REAL || nextReady()) ? 'Next one in a moment' : ''}</span></div>`;
  haptic(16);
  clearTimeout(L.doneT);
  const next = () => { if (!alive()) return; hideCard(); if (L.mode === 'scan') { if (REAL) { L.q = null; L.item = null; realLook(); setTimeout(() => openNextReady(), 380); } else go(L.i + 1); } };
  if (!waitFor) { L.doneT = setTimeout(next, 1900); return; }
  // wait for the app's sheet to close, then carry on scanning
  const watch = () => { if (!alive()) return; if (waitFor.isConnected && waitFor.classList.contains('in')) { L.doneT = setTimeout(watch, 300); return; } L.doneT = setTimeout(next, 500); };
  L.doneT = setTimeout(watch, 600);
}
function sessionHtml() {
  const list = L.filed;
  return `<div class="cap-card-in cap-session">
    <div class="cap-card-h"><div class="cap-card-t"><h3>Filed this time</h3><p class="cap-sub">${list.length} thing${list.length === 1 ? '' : 's'}, each in the app it belongs to</p></div><button class="cap-card-x" data-act="cap-card-x" aria-label="Close the list">${I.x}</button></div>
    <div class="group cap-slist">${list.map((f, i) => `<div class="row ic">${destTile(f.to.app)}<span class="rbody"><span class="rtitle">${esc(f.item.title)}</span><span class="rmeta">${esc(f.to.where)}</span></span>${!REAL || f.undo ? `<button class="btn sm" data-act="cap-unfile" data-i="${i}">Undo</button>` : ''}</div>`).join('')}</div>
    <button class="btn primary block" data-act="cap-close">Done</button></div>`;
}

on('capture', (el) => (el.id === 'captureBtn' || el.closest('.dock') ? openCapture('scan') : openCapture('task')));
// "New job" anywhere opens Work's own composer (Work provides newJob); the lens only falls back to its Job type
on('new-job', (el) => (has('newJob') ? api.newJob({ prompt: el?.dataset?.prompt ?? '' }) : openCapture('job')));
on('cap-close', () => closeLens());
on('cap-shutter', () => shutter());
on('cap-dot', (el) => { if (!alive()) return; haptic(5); go(+el.dataset.i); });
on('cap-flip', () => {
  if (!alive()) return;
  if (REAL) { haptic(6); R.camera.flip().then(() => { if (alive()) { L.el.classList.toggle('front', R.camera.facing === 'user'); realCamState(); } }); return; }
  const f = sceneIndex('face');
  if (L.i === f) { go(L.back ?? 0); return; }
  L.back = L.i; go(f);
});
on('cap-torch', (el) => { if (!alive()) return; if (REAL) { const v = !R.camera.torchOn; R.camera.torch(v).then((ok) => { if (ok) { el.setAttribute('aria-pressed', String(v)); haptic(6); } else toast('No torch on this camera here'); }); return; } const v = !L.el.classList.contains('torch'); L.el.classList.toggle('torch', v); el.setAttribute('aria-pressed', String(v)); haptic(6); });
function showSession() {
  if (!alive() || !L.filed.length) return;
  clearTimeout(L.doneT); L.item = null;
  const c = $('.cap-card', L.el); c.innerHTML = sessionHtml(); c.hidden = false; c.classList.remove('done');
  requestAnimationFrame(() => c.classList.add('in')); L.el.classList.add('carding');
}
on('cap-last', () => { if (!alive()) return; if (L.filed.length) showSession(); else setMode('files'); });
on('cap-tray', (el) => { if (!alive()) return; const q = R.live.get(el.dataset.id); if (q) { haptic(6); showRealCard(q); } });
on('cap-session', () => showSession());
on('cap-card-x', () => { if (!alive()) return; if (REAL) { stopCountdown(); hideCard(); L.item = null; L.q = null; L.alt = null; if (L.mode === 'scan') realLook(); return; } hideCard(); if (L.mode === 'scan') { L.state = L.item ? 'found' : L.state; if (!L.item) detect(); } L.item = null; });
on('cap-alt', (el) => { if (!alive() || !L.item) return; const i = +el.dataset.i; L.alt = L.alt === i ? null : i; haptic(6); if (REAL) { stopCountdown(); $('.cap-card', L.el).innerHTML = realCardHtml(L.q); return; } $('.cap-card', L.el).innerHTML = cardHtml(L.item); });
on('cap-file', () => fileNow());
on('cap-undo', () => {
  if (!alive()) return; clearTimeout(L.doneT);
  const f = L.filed.pop(); haptic(8);
  if (REAL && f) { realUndo(f); return; }
  const cnt = $('.cap-count', L.el); if (L.filed.length) cnt.innerHTML = `${I.check}<span><b class="met">${L.filed.length}</b> filed</span>`; else cnt.hidden = true;
  if (!L.filed.length) $('.cap-last', L.el).innerHTML = G.photos;
  if (f) { L.alt = null; showCard(f.item); }
  toast('Undone. Nothing was filed');
});
on('cap-unfile', (el) => { if (!alive()) return; const [uf] = L.filed.splice(+el.dataset.i, 1); haptic(8); if (REAL && uf) realUndo(uf, { quiet: true }); if (!L.filed.length) { hideCard(); $('.cap-count', L.el).hidden = true; $('.cap-last', L.el).innerHTML = G.photos; if (L.mode === 'scan') detect(); return; } $('.cap-count', L.el).innerHTML = `${I.check}<span><b class="met">${L.filed.length}</b> filed</span>`; $('.cap-card', L.el).innerHTML = sessionHtml(); });
on('cap-open-app', (el) => { const id = el.dataset.id; closeLens(); api.openAspect(id); });
on('cap-sharein', () => { closeLens(); setTimeout(() => api.openShareIn(), 200); });

// hold the round button to talk straight away
onHold($('#phone'), '#captureBtn', () => openCapture('voice', { record: true }), 380);

// ── voice ─────────────────────────────────────────────────────────────
function voicePane(pane) {
  if (REAL) { realVoicePane(pane); return; }
  const ask = !!L.opts.ask;
  pane.innerHTML = `<div class="cap-pane-body cap-voice">
      <p class="cap-v-k">${I.sparkle}<span>${ask ? 'Ask your Brain anything' : `Tell ${esc(AGENT.name)} anything. She files each part where it belongs.`}</span></p>
      <p class="cap-v-text" aria-live="polite"><span class="ph">${ask ? '“What did I save about Kabir?”' : '“I read Atomic Habits for 30 minutes, and I’m sitting with family.”'}</span></p>
      <div class="cap-v-wave" aria-hidden="true">${'<i></i>'.repeat(44)}</div>
      <div class="cap-v-ctl"><span class="cap-v-time met">0:00</span><button class="cap-v-mic" data-act="cap-v-mic" aria-label="Start talking">${I.mic}</button><span class="cap-v-hint">Tap to talk</span></div>
      <div class="cap-v-out"></div>
      ${ask ? '' : `<div class="cap-v-ex"><p class="cap-lbl">Or try</p><div class="chips">${EXAMPLES.map(([t], i) => `<button class="chip sm" data-act="cap-v-ex" data-i="${i}">${esc(t)}</button>`).join('')}</div></div>`}
    </div>`;
  L.voice = { state: 'idle', stop: () => {} };
  if (L.opts.record) { L.opts.record = false; requestAnimationFrame(() => voiceStart()); }
}
function voiceStart(script = null) {
  if (!alive() || L.mode !== 'voice') return;
  const pane = $('.cap-pane', L.el), V = L.voice; if (V.state === 'rec') return;
  const ask = !!L.opts.ask;
  const words = (script ?? (ask ? ASK_SAY : SAY)).split(' ');
  V.state = 'rec'; V.items = script ? EXAMPLES.find(([t]) => t === script)[1] : [0, 1, 2];
  pane.classList.add('rec'); $('.cap-v-out', pane).innerHTML = ''; $('.cap-v-ex', pane)?.setAttribute('hidden', '');
  const mic = $('.cap-v-mic', pane); mic.innerHTML = '<i></i>'; mic.setAttribute('aria-label', 'Stop'); $('.cap-v-hint', pane).textContent = 'Listening';
  const text = $('.cap-v-text', pane); text.innerHTML = '';
  const bars = $$('.cap-v-wave i', pane); const lv = Array(bars.length).fill(0.06);
  const t0 = performance.now(); let w = 0;
  const iv = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const env = 0.35 + 0.65 * Math.abs(Math.sin(t * 7.3 + Math.sin(t * 3.1)));
    lv.shift(); lv.push(Math.max(0.06, Math.min(1, env * (0.55 + Math.random() * 0.45))));
    bars.forEach((b, i) => { b.style.transform = `scaleY(${lv[i]})`; });
    const s = Math.floor(t); $('.cap-v-time', pane).textContent = `0:${String(s).padStart(2, '0')}`;
  }, 80);
  const wv = setInterval(() => {
    if (w >= words.length) { clearInterval(wv); V.autoT = setTimeout(() => voiceStop(), 700); return; }
    text.insertAdjacentHTML('beforeend', `<span class="w">${esc(words[w])} </span>`); w++;
  }, 150);
  V.stop = () => { clearInterval(iv); clearInterval(wv); clearTimeout(V.autoT); clearTimeout(V.thinkT); };
  haptic(12);
}
function voiceStop() {
  if (!alive() || L.mode !== 'voice') return;
  const pane = $('.cap-pane', L.el), V = L.voice; if (V.state !== 'rec') return;
  V.stop(); V.state = 'think'; pane.classList.remove('rec');
  $$('.cap-v-wave i', pane).forEach((b) => { b.style.transform = 'scaleY(.06)'; });
  const mic = $('.cap-v-mic', pane); mic.innerHTML = I.mic; mic.setAttribute('aria-label', 'Talk again'); $('.cap-v-hint', pane).textContent = 'Tap to add more';
  if (L.opts.ask) { const q = ASK_SAY; closeLens(); setTimeout(() => api.openBrain(`search=${q}`), 220); return; }
  $('.cap-v-out', pane).innerHTML = `<p class="cap-v-think"><span class="spin" style="--c:var(--ink-2)"></span><span>${esc(AGENT.name)} is sorting it</span></p>`;
  haptic(8);
  V.thinkT = setTimeout(() => {
    if (!alive() || L.mode !== 'voice') return;
    V.state = 'parsed'; V.on = V.items.map(() => true);
    $('.cap-v-out', pane).innerHTML = heardHtml();
  }, reduced() ? 100 : 900);
}
function heardHtml() {
  const V = L.voice; const n = V.on.filter(Boolean).length;
  return `<div class="cap-heard"><p class="cap-heard-k"><b>${V.items.length === 1 ? 'One thing' : `${V.items.length} things`}</b>, ${V.items.length === 1 ? 'for this app' : 'each for its own app'}. Untick any you don’t want.</p>
    <div class="group">${V.items.map((h, i) => { const x = HEARD[h]; return `<button class="row ic cap-hrow${V.filed ? ' filed' : ''}" data-act="cap-v-row" data-i="${i}" ${V.filed ? 'disabled' : ''}>${aspectTile(x.app)}<span class="rbody"><span class="rtitle">${esc(aspect(x.app).name)} · ${esc(x.what)}</span><span class="rmeta">${esc(V.filed ? x.done : x.detail)}</span></span><span class="check${V.on[i] ? ' done' : ''}" role="checkbox" aria-checked="${V.on[i]}" aria-label="File this">${I.check}</span></button>`; }).join('')}</div>
    ${V.filed ? `<button class="btn block" data-act="cap-v-again">${I.mic}Say something else</button>` : `<button class="btn primary block" data-act="cap-v-file" ${n ? '' : 'disabled'}>File ${n === V.items.length ? (n === 1 ? 'it' : `all ${n}`) : n}</button>`}</div>`;
}
on('cap-v-mic', () => { if (!alive()) return; if (REAL) { realMic(); return; } const V = L.voice; if (V.state === 'rec') voiceStop(); else voiceStart(); });
on('cap-v-ex', (el) => voiceStart(EXAMPLES[+el.dataset.i][0]));
on('cap-v-row', (el) => { const V = L?.voice; if (!V || V.filed) return; const i = +el.dataset.i; V.on[i] = !V.on[i]; haptic(5); $('.cap-v-out', L.el).innerHTML = REAL ? realHeardHtml() : heardHtml(); });
on('cap-v-file', () => {
  const V = L?.voice; if (!V) return;
  if (REAL) { realSayFile(); return; }
  const picked = V.items.filter((_, i) => V.on[i]).map((h) => HEARD[h]);
  picked.forEach((x) => { if (has('remember')) api.remember(`${x.what}: ${x.detail}`, { aspect: x.app, person: x.app === 'family' ? 'mom' : null, via: 'voice', by: 'wyn', quiet: true }); record({ title: `${aspect(x.app).name} · ${x.what}`, sub: x.detail }, { app: x.app, where: `${aspect(x.app).name} · ${x.what}`, done: x.done }); });
  V.filed = true; V.items = V.items.filter((_, i) => V.on[i]); V.on = V.items.map(() => true);
  $('.cap-v-out', L.el).innerHTML = heardHtml();
  haptic(16); toast(`Filed to ${[...new Set(picked.map((x) => aspect(x.app).name))].join(', ')}`);
});
on('cap-v-again', () => { if (!alive()) return; L.voice = { state: 'idle', stop: () => {} }; voicePane($('.cap-pane', L.el)); });
on('cap-v-retry', () => realRetry());

// ── files ─────────────────────────────────────────────────────────────
function filesPane(pane) {
  if (REAL) { realFilesPane(pane); return; }
  const thumb = (f) => {
    if (f.thumb === 'pdf') return `<span class="cap-fthumb pdf">${G.pdf}<b>PDF</b></span>`;
    if (f.thumb === 'reel') return `<span class="cap-fthumb reel">${I.play}</span>`;
    const s = SCENES.find((x) => x.id === f.thumb);
    return `<span class="cap-fthumb img">${sceneSvg(s, `cf-${f.id}-`)}</span>`;
  };
  pane.innerHTML = `<div class="cap-pane-body cap-files">
      <p class="cap-v-k">${I.sparkle}<span>Pick a photo, a PDF or a screenshot. ${esc(AGENT.name)} reads it the same way the camera does.</span></p>
      <p class="cap-lbl">Recent on this phone</p>
      <div class="cap-fgrid">${FILES.map((f) => `<button class="cap-file-t" data-act="cap-pick" data-id="${f.id}">${thumb(f)}<span class="cap-fn">${esc(f.name)}</span><span class="cap-fm">${esc(f.meta)}</span></button>`).join('')}</div>
      <div class="group cap-share-row"><button class="row ic" data-act="cap-sharein"><span class="tile">${I.share}</span><span class="rbody"><span class="rtitle">Share in from another app</span><span class="rmeta">Instagram, Safari, WhatsApp, GPay: Share › Agentic OS</span></span>${I.chevR}</button></div>
    </div>`;
}
on('cap-pick', (el) => { if (!alive()) return; const f = FILES.find((x) => x.id === el.dataset.id); if (!f) return; haptic(8); L.alt = null; showCard(fileItem(f)); });

// ── type: a task, an idea, a note for the Brain, a job, or a question for the agent ──
// (the j15 + sheet's flows, kept: parsed chips while you type, Ask results you can untick, the job's engine and options)
const TYPES = [['task', 'Task'], ['idea', 'Idea'], ['note', 'Note'], ['job', `<span class="cap-jg">${I.claude}</span>Job`], ['ask', 'Ask']];
const PROJ_DEMO = ['agentic-os', 'atlas', 'wyn', 'content-os'];
/** The project chips: the last ones he used (the shipping app's key), else the first active ones */
function projList() {
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem('agentos-app:recent-projects') ?? '[]'); } catch {}
  const slugs = REAL ? [...new Set([...recent, ...PROJECTS.filter((p) => !p.archived && p.status !== 'archived').map((p) => p.slug)])].slice(0, 4) : PROJ_DEMO;
  return [{ slug: '', name: 'No project' }, ...slugs.map((sl) => PROJECTS.find((p) => p.slug === sl)).filter(Boolean)];
}
const MODELS = { claude: ['Default', 'Opus', 'Sonnet', 'Haiku'], codex: ['Default', 'gpt-6.1-sol', 'gpt-6.1-mini'] };
const MODEL_NAME = {
  claude: { Default: 'Opus 5.5', Opus: 'Opus 5.5', Sonnet: 'Sonnet 5.5', Haiku: 'Haiku 5.5' },
  codex: { Default: 'gpt-6.1-sol', 'gpt-6.1-sol': 'gpt-6.1-sol', 'gpt-6.1-mini': 'gpt-6.1-mini' },
};
const EFFORTS = ['Low', 'Medium', 'High', 'Max'];
const PH = { task: 'Add a task', idea: 'Drop an idea', note: 'A note for your Brain', job: 'What should the job do?', ask: `Ask ${AGENT.name} anything` };
const SAYS = {
  task: 'Call Dad about the Lucknowi restock tomorrow at 6pm',
  idea: 'Hold a job row to peek at its last output',
  note: 'Dad wants the Diwali stock list by Sunday',
  job: 'In Agentic OS, make the Jobs badge count only jobs that need me, and add a test for it',
  ask: 'What should I do first this evening?',
};
const SUGGEST = [['plan', 'Plan my day'], ['slip', 'What’s slipping?'], ['push', 'Push overdue to tomorrow']];
const ASKS = {
  plan: { title: 'Plan my day', rows: [
    ['clock', 'Shoot: 1 reel (R1)', 'No time', '18:45–19:00'],
    ['clock', 'Reply to the Atlas ERP onboarding call notes', 'Today', '17:00–17:30'],
    ['clock', 'Upload 12 new kurta listings', 'Today', '20:30–21:15'],
  ] },
  slip: { title: 'What’s slipping?', answer: '5 tasks are late. Two are clients waiting on you, so they go first.', rows: [
    ['clock', 'Harborline OS: send the Basic / Advanced quote', '1 day late', 'Today 16:45'],
    ['clock', 'Glowbox: invoice the catalog fill', '1 day late', 'Today 17:30'],
    ['cal', 'Subscriptions: decide Codex Pro', '2 days late', 'Thu 22'],
  ] },
  push: { title: 'Push overdue to tomorrow', rows: [
    ['cal', 'Subscriptions: decide Codex Pro', 'Mon 19', 'Thu 22'],
    ['cal', 'Atlas ERP wave 1: merge the agents', 'Mon 19', 'Thu 22'],
    ['cal', 'Shoot: 1 reel (R1)', 'Tue 20', 'Thu 22'],
  ] },
  question: { title: `Ask ${AGENT.name}`, answer: 'You have 2h 15m free after GE I. The Harborline quote is the only thing a client is waiting on, so I’d put it first.', rows: [
    ['clock', 'Harborline OS: send the Basic / Advanced quote', '1 day late', 'Today 16:45'],
  ] },
};
const AREA_WORDS = [
  [/\b(reel|shoot|script|post|edit)\b/i, 'Content', '#f2b134'],
  [/\b(invoice|quote|client|pitch|proposal)\b/i, 'Northwind Studio', '#7c5cff'],
  [/\b(class|exam|assignment|tutorial|lab)\b/i, 'City College', '#5b8def'],
  [/\b(kurta|shop|store|dad|restock)\b/i, 'Morgan & Co.', '#d9822b'],
  [/\b(gym|cardio|doctor|dentist|walk|sleep)\b/i, 'Personal + Health', '#4caf50'],
];
const NOTE_WORDS = [
  [/\b(dad|mom)\b|family|home|anniversary/i, 'family'], [/kabir|rohan|friend/i, 'friends'], [/₹|paid|spent|budget|invoice|upi/i, 'money'],
  [/gym|protein|sleep|meal|workout/i, 'body'], [/read|book|class|exam|course/i, 'mind'], [/client|atlas|northwind|reel|goal/i, 'mission'],
  [/habit|instagram|urge/i, 'soul'], [/journal|week|plan/i, 'growth'],
];
const NOTE_PEOPLE = [[/\bdad\b/i, 'dad', 'Dad'], [/\bmom\b/i, 'mom', 'Mom'], [/kabir/i, 'kabir', 'Kabir'], [/rohan/i, 'rohan', 'Rohan']];
const DAYS_DEMO = { mon: 'Mon 26', tue: 'Tue 27', wed: 'Wed 28', thu: 'Thu 22', fri: 'Fri 23', sat: 'Sat 24', sun: 'Sun 25' };
const DOW = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
/** The next date with that weekday (today counts), as YYYY-MM-DD */
function nextDow(key) {
  const t = clock.today(), d = clock.dparts(t).dow;
  return clock.addDays(t, (DOW[key] - d + 7) % 7);
}
const shortDay = (iso) => { const { dow, day } = clock.dparts(iso); return `${clock.WEEKDAYS[dow].slice(0, 3)} ${day}`; };
const DAYS = new Proxy({}, { get: (_, k) => (REAL ? (k in DOW ? shortDay(nextDow(k)) : undefined) : DAYS_DEMO[k]) });

let T = null;   // the Type mode's state (S in the j15 sheet)
function typePane(pane) {
  const o = L.opts; const cl = o.client ?? scope.client;
  const st = { type: L.sub ?? 'task', text: '', project: cl?.project ?? '', client: cl, engine: 'claude', model: 'Default', effort: 'High', worktree: true, planFirst: false, warm: false, ask: null, prevChips: new Set(), el: pane };
  T = st;
  pane.innerHTML = `<div class="cap-head">${seg('cap-type', TYPES, st.type, 'dom')}</div>
    <div class="cap-pane-body">${bodyHtml()}</div>
    <div class="cap-foot"><p class="cap-hint"></p><button class="btn primary block cap-go" data-act="cap-go" disabled>Add task</button></div>`;
  wireSegs(pane);
  const ta = $('.cap-text', pane);
  ta.addEventListener('input', () => { st.text = ta.value; grow(ta); if (st.ask && !st.ask.question) st.ask = null; update(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); goType(); } });
  $('[data-seg="cap-type"]', pane).addEventListener('change', (e) => { animateHeight(pane, () => { st.type = e.detail; L.sub = e.detail; st.ask = null; update(true); }); });
  st.kbOff = liftWithKeyboard(pane, 8);
  if (o.text) { ta.value = o.text; st.text = o.text; grow(ta); }
  update(true);
  if (!o.record) setTimeout(() => { if (T === st && ta.isConnected) ta.focus({ preventScroll: true }); }, 380);
}
function bodyHtml() {
  return `
    <div class="cap-top-f">
      <div class="cap-field"><textarea class="cap-text" rows="1" enterkeyhint="go" autocapitalize="sentences" aria-label="What is it"></textarea>
        <button class="cap-mic" data-act="cap-mic" aria-label="Record">${I.mic}</button></div>
      <div class="cap-rec" hidden></div>
    </div>
    <div class="cap-client"></div>
    <div class="cap-parsed"></div>
    <div class="cap-suggest"></div>
    <div class="cap-ask"></div>
    <div class="cap-job"></div>
    <p class="cap-lbl cap-plbl">Project</p>
    <div class="cap-proj chips"></div>
    <div class="cap-jobopts"></div>`;
}
function grow(ta) { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 168)}px`; }

function update(full = false) {
  const st = T; if (!st) return; const el = st.el;
  el.dataset.type = st.type;
  const ta = $('.cap-text', el);
  const task = st.type === 'task', job = st.type === 'job', note = st.type === 'note', ask = st.type === 'ask';
  ta.placeholder = PH[st.type];
  $('.cap-client', el).innerHTML = job && st.client ? `<div class="cap-for"><span class="cap-for-l">For</span><span class="chip sm on cap-for-c">${I.clients}${esc(st.client.name)}<button class="cap-for-x" data-act="cap-client-x" aria-label="Not for a client">${I.x}</button></span></div>` : '';

  const chips = task && st.text.trim() ? parse(st.text) : note && st.text.trim() ? parseNote(st.text) : [];
  const keys = new Set(chips.map((c) => c.key));
  $('.cap-parsed', el).innerHTML = chips.map((c) => `<span class="pchip${st.prevChips.has(c.key) ? '' : ' new'}">${c.c ? `<i class="dot" style="--c:${c.c}"></i>` : I[c.icon]}${esc(c.label)}</span>`).join('');
  st.prevChips = keys;
  const showSuggest = task && !st.text.trim() && !st.ask;
  $('.cap-suggest', el).innerHTML = showSuggest ? SUGGEST.map(([k, l]) => `<button class="schip" data-act="cap-suggest" data-k="${k}">${I.sparkle}<span>${l}</span></button>`).join('') : '';
  $('.cap-ask', el).innerHTML = st.ask ? askHtml(st.ask) : '';

  const showProj = (task || job || st.type === 'idea') && !st.ask;
  $('.cap-plbl', el).textContent = job ? 'Where' : 'Project';
  $('.cap-plbl', el).hidden = !showProj;
  const pj = $('.cap-proj', el);
  pj.hidden = !showProj;
  if (full || !pj.children.length) pj.innerHTML = projList().map((p) => projChip(p, st.project)).join('');
  else $$('.chip', pj).forEach((c) => c.classList.toggle('on', c.dataset.p === st.project));
  $('.cap-job', el).innerHTML = job ? enginesHtml(st) : '';
  $('.cap-jobopts', el).innerHTML = job ? jobOptsHtml(st) : '';

  const btn = $('.cap-go', el), hint = $('.cap-hint', el);
  const has = !!st.text.trim();
  btn.style.removeProperty('--c');
  if (st.ask) {
    const n = st.ask.ready ? st.ask.on.filter(Boolean).length : 0;
    btn.textContent = st.ask.ready ? (n ? `Apply ${n} change${n === 1 ? '' : 's'}` : 'Nothing to apply') : 'Reading your day…';
    btn.disabled = !st.ask.ready || !n; hint.textContent = '';
  } else if (task) {
    const q = st.text.trim().endsWith('?');
    btn.textContent = q ? `Ask ${AGENT.name}` : 'Add task'; btn.disabled = !has;
    const dated = chips.some((c) => c.key.startsWith('d:') || c.key.startsWith('t:'));
    hint.textContent = q ? `${AGENT.name} reads your day and answers here.` : (!st.project && !dated ? 'No project and no day: it lands in your Inbox. Try “at 6pm” or “tomorrow”.' : '');
  } else if (st.type === 'idea') {
    btn.textContent = 'Save idea'; btn.disabled = !has;
    const p = projList().find((x) => x.slug === st.project) ?? { name: st.project };
    hint.textContent = st.project ? `Lands in ${p.name} › Ideas.` : 'Lands in your Ideas inbox.';
  } else if (note) {
    btn.textContent = 'Save to Brain'; btn.disabled = !has;
    const f = chips.find((c) => c.key.startsWith('f:'));
    hint.textContent = has ? `${AGENT.name} files it under ${f ? f.label : 'Growth'}${chips.some((c) => c.key.startsWith('p:')) ? ', on their file too' : ''}.` : 'A fact, a thought, something to remember. She files it by aspect and person.';
  } else if (ask) {
    btn.textContent = `Ask ${AGENT.name}`; btn.disabled = !has;
    hint.textContent = 'Opens her chat with this as the first message.';
  } else {
    btn.textContent = `Start job with ${st.engine === 'claude' ? 'Claude' : 'Codex'}`; btn.disabled = !has;
    const where = st.worktree ? 'in its own copy' : 'in the project folder';
    hint.textContent = st.client ? `Runs on your PC ${where}, scoped to ${st.client.name}. Every step shows in Work.` : `Runs on your PC ${where}. Every step shows in Work.`;
  }
  btn.classList.toggle('claude', job && st.engine === 'claude');
  btn.classList.toggle('codex', job && st.engine === 'codex');
  hint.hidden = !hint.textContent;
}
function projChip(p, onSlug) {
  const ic = !p.slug ? '' : /\p{Extended_Pictographic}/u.test(p.icon ?? '') ? `<span class="pj-ic emoji">${p.icon}</span>` : `<span class="pj-ic" style="--c:${p.color}">${esc(p.icon ?? p.name[0])}</span>`;
  return `<button class="chip sm${p.slug === onSlug ? ' on' : ''}" data-act="cap-proj" data-p="${p.slug}">${ic}${esc(p.name)}</button>`;
}
function enginesHtml(st) {
  const card = (k, name) => `<button class="eng-card ${k}${st.engine === k ? ' on' : ''}" data-act="cap-engine" data-k="${k}" aria-pressed="${st.engine === k}">
      <span class="eng-ic"><span class="agent ${k}">${I[k]}</span><span class="eng-tick" aria-hidden="true">${I.check}</span></span>
      <span class="eng-txt"><b>${name}</b><small>${MODEL_NAME[k][st.engine === k ? st.model : 'Default']}</small></span>
    </button>`;
  return `<p class="cap-lbl">Engine</p><div class="eng">${card('claude', 'Claude')}${card('codex', 'Codex')}</div>`;
}
function jobOptsHtml(st) {
  const chip = (act, v, onv) => `<button class="chip sm${onv ? ' on' : ''}" data-act="${act}" data-v="${v}">${esc(v)}</button>`;
  const sw = (k, title, sub) => `<button class="row cap-sw" data-act="cap-switch" data-k="${k}"><div class="rbody"><div class="rtitle">${title}</div><div class="rmeta"><span class="ell">${sub}</span></div></div><span class="switch${st[k] ? ' on' : ''}"></span></button>`;
  return `
    <p class="cap-lbl">Model</p>
    <div class="chips cap-chips">${MODELS[st.engine].map((m) => chip('cap-model', m, m === st.model)).join('')}</div>
    <p class="cap-lbl">Effort</p>
    <div class="chips cap-chips">${EFFORTS.map((e) => chip('cap-effort', e, e === st.effort)).join('')}</div>
    <div class="group cap-group">
      ${sw('worktree', 'Own copy (worktree)', 'Works on a branch, merges when it ships')}
      ${sw('planFirst', 'Plan first', 'Shows you a plan before it edits')}
      ${sw('warm', 'Keep warm', 'Holds the prompt cache for 1 h')}
    </div>`;
}
function askHtml(a) {
  const def = ASKS[a.kind];
  if (!a.ready) return `<div class="ask-card"><div class="ask-k">${I.sparkle}<span>${esc(def.title)}</span></div><p class="ask-load"><span class="spin" style="--c:var(--ink-2)"></span><span>Reading your day</span></p></div>`;
  const n = def.rows.length;
  return `<div class="ask-card in">
    <div class="ask-k">${I.sparkle}<span>${esc(def.title)}</span><button class="ask-x" data-act="cap-ask-x" aria-label="Dismiss">${I.x}</button></div>
    ${def.answer ? `<p class="ask-ans">${esc(def.answer)}</p>` : ''}
    ${n ? `<p class="ask-sum"><b>${n} change${n === 1 ? '' : 's'}.</b> Untick any you don’t want.</p>` : ''}
    <div class="group ask-rows">${def.rows.map(([ic, title, from, to], i) => `
      <button class="row ic ask-row" data-act="cap-ask-row" data-i="${i}">
        <span class="tile">${I[ic]}</span>
        <div class="rbody"><div class="rtitle wrap">${esc(title)}</div><div class="rmeta"><s>${esc(from)}</s><span class="arr">→</span><b>${esc(to)}</b></div></div>
        <span class="check${a.on[i] ? ' done' : ''}" role="checkbox" aria-checked="${!!a.on[i]}" aria-label="Apply this change">${I.check}</span>
      </button>`).join('')}</div>
    ${a.real ? '' : `<p class="ask-meta">${esc(AGENT.name)} · Sonnet 5.5 on your PC · 4.2 s</p>`}
  </div>`;
}
function parse(text) {
  const out = [];
  const pad = (n) => String(n).padStart(2, '0');
  let day = null;
  if (/\btomorrow\b/i.test(text)) day = 'Tomorrow';
  else if (/\b(today|tonight)\b/i.test(text)) day = 'Today';
  else { const m = text.match(/\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i); if (m) day = DAYS[m[1].toLowerCase()]; }
  if (day) out.push({ key: `d:${day}`, icon: 'cal', label: day });
  let len = 30;
  const lm = text.match(/\b(\d+(?:\.\d)?)\s*(h|hr|hrs|hours?)\b/i) ?? null;
  const mm = text.match(/\b(\d+)\s*(m|min|mins|minutes?)\b/i);
  if (lm) len = Math.round(parseFloat(lm[1]) * 60); else if (mm) len = +mm[1];
  const tm = text.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ?? text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i);
  if (tm) {
    let h = +tm[1]; const m = +(tm[2] ?? 0); const ap = tm[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; if (!ap && h < 8) h += 12;
    if (h < 24) {
      const s = h * 60 + m, e = s + len;
      out.push({ key: `t:${s}-${e}`, icon: 'clock', label: `${pad(h)}:${pad(m)}–${pad(Math.floor(e / 60) % 24)}:${pad(e % 60)}` });
      if (!day) out.unshift({ key: 'd:Today', icon: 'cal', label: 'Today' });
    }
  }
  if (lm || mm) out.push({ key: `l:${len}`, icon: 'hourglass', label: len >= 60 ? `${Math.floor(len / 60)}h${len % 60 ? ` ${len % 60}m` : ''}` : `${len}m` });
  for (const [re, name, c] of AREA_WORDS) if (re.test(text)) { out.push({ key: `a:${name}`, c, label: name }); break; }
  if (text.trim().endsWith('?')) out.push({ key: 'q', icon: 'sparkle', label: `Ask ${AGENT.name}` });
  else if (!out.some((c) => c.key.startsWith('d:') || c.key.startsWith('t:')) && !T?.project) out.push({ key: 'inbox', icon: 'inbox', label: 'Inbox' });
  return out;
}
/** A typed task's when: { date, at (minutes), len, title } from the same words parse() reads */
function parseReal(text) {
  let date = null, at = null, len = null, t = text;
  if (/\btomorrow\b/i.test(text)) { date = clock.addDays(clock.today(), 1); t = t.replace(/\btomorrow\b/i, ''); }
  else if (/\b(today|tonight)\b/i.test(text)) { date = clock.today(); t = t.replace(/\b(today|tonight)\b/i, ''); }
  else { const m = text.match(/\b(?:on\s+|this\s+|next\s+)?(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i); if (m) { date = nextDow(m[1].toLowerCase()); t = t.replace(m[0], ''); } }
  const lm = text.match(/\b(?:for\s+)?(\d+(?:\.\d)?)\s*(h|hr|hrs|hours?)\b/i), mm = text.match(/\b(?:for\s+)?(\d+)\s*(m|min|mins|minutes?)\b/i);
  if (lm) { len = Math.round(parseFloat(lm[1]) * 60); t = t.replace(lm[0], ''); } else if (mm) { len = +mm[1]; t = t.replace(mm[0], ''); }
  const tm = text.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ?? text.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/i);
  if (tm) {
    let h = +tm[1]; const m = +(tm[2] ?? 0); const ap = tm[3]?.toLowerCase();
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; if (!ap && h < 8) h += 12;
    if (h < 24) { at = h * 60 + m; date ??= clock.today(); t = t.replace(tm[0], ''); }
  }
  const title = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').replace(/^[\s,.-]+|[\s,.-]+$/g, '').trim() || text.trim();
  return { title, date, at, len };
}
async function addIdeaReal(text, project) {
  if (has('addIdea')) return api.addIdea({ text, project, source: 'capture' });
  try { const w = await import('./work-engine.js'); if (w.addIdea) return await w.addIdea({ text, project, source: 'capture' }); } catch (e) { console.warn('[capture] work engine', e); }
  return (await API.post('/ideas', { title: text, project: project || null, source: 'capture' })).idea;
}
function parseNote(text) {
  const out = [];
  const f = NOTE_WORDS.find(([re]) => re.test(text));
  if (f) out.push({ key: `f:${f[1]}`, c: `var(--${f[1]})`, label: aspect(f[1]).name });
  for (const [re, id, name] of NOTE_PEOPLE) if (re.test(text)) out.push({ key: `p:${id}`, icon: 'user', label: `People › ${name}` });
  if (/\b(sunday|saturday|monday|tomorrow|by \w+day)\b/i.test(text)) out.push({ key: 'd', icon: 'cal', label: 'Reminds you before it’s due' });
  return out;
}
function goType() {
  const st = T; if (!st) return;
  const btn = $('.cap-go', st.el); if (btn.disabled) return;
  if (st.ask?.ready) {
    const n = st.ask.on.filter(Boolean).length;
    if (REAL && st.ask.apply) { const undo = st.ask.apply(st.ask.on); closeLens(); haptic(14); toast(`${n} change${n === 1 ? '' : 's'} made`, () => { undo(); toast('Changes undone'); }); return; }
    closeLens(); haptic(14);
    toast(`${n} change${n === 1 ? '' : 's'} applied`, () => toast('Changes undone'));
    return;
  }
  const text = st.text.trim();
  if (st.type === 'task' && text.endsWith('?')) { if (REAL) { closeLens(); setTimeout(() => api.askAgent(text, {}), 200); return; } runAsk('question'); return; }
  if (st.type === 'ask') { closeLens(); setTimeout(() => api.askAgent(text, {}), 200); return; }
  if (st.type === 'note') {
    const c = parseNote(text); const f = c.find((x) => x.key.startsWith('f:')); const p = c.find((x) => x.key.startsWith('p:'));
    closeLens(); haptic(14);
    api.remember(text, { aspect: f ? f.key.slice(2) : null, person: p ? p.key.slice(2) : null, by: 'you', via: 'typed' });
    return;
  }
  // a job is Work's: it owns the agent, the copy and plan-first. The lens hands over what you typed and picked
  if (st.type === 'job') {
    const job = { prompt: text, engine: st.engine, model: st.model, effort: st.effort, worktree: st.worktree, planFirst: st.planFirst, project: st.project || null, client: st.client ?? null };
    closeLens(); haptic(14);
    setTimeout(() => (has('newJob') ? api.newJob(job) : toast(`Job started${st.client ? ` for ${st.client.name}` : ''} · ${st.engine === 'claude' ? 'Claude' : 'Codex'}`)), 200);
    return;
  }
  if (REAL) {
    const project = st.project || null;
    if (st.type === 'task') {
      const w = parseReal(text);
      let t;
      try { t = addTask({ title: w.title, project, date: w.date, due: w.at == null ? w.date : undefined, at: w.at ?? undefined, len: w.len ?? undefined }); }
      catch (e) { toast(e?.message ?? 'Couldn’t add it'); return; }
      closeLens(); haptic(14);
      const p = projList().find((x) => x.slug === project);
      toast(project ? `Added to ${p?.name ?? project}` : w.date ? `Task added · ${w.at != null ? `${shortDay(w.date)} ${clock.hm(w.at)}` : shortDay(w.date)}` : 'Added to Inbox', () => { dropTask(t.id); toast('Task removed'); });
    } else {
      closeLens(); haptic(14);
      addIdeaReal(text, project).then((it) => toast(it?.pending ? 'Idea saved on this phone. It goes to your PC when it’s reachable' : 'Idea saved')).catch((e) => toast(e?.message ? `Couldn’t save the idea: ${e.message}` : 'Couldn’t save the idea'));
    }
    return;
  }
  closeLens(); haptic(14);
  if (st.type === 'task') {
    const p = projList().find((x) => x.slug === st.project) ?? { name: st.project };
    const dated = parse(text).some((c) => c.key.startsWith('d:') || c.key.startsWith('t:'));
    toast(st.project ? `Added to ${p.name}` : dated ? 'Task added' : 'Added to Inbox', () => toast('Task removed'));
  } else toast('Idea saved', () => toast('Idea removed'));
}
function realAsk(kind) {
  const st = T; if (!st) return;
  if (kind === 'plan') { closeLens(); setTimeout(() => (has('planDay') ? api.planDay('day') : api.askAgent('Plan my day', {})), 200); return; }
  if (kind === 'slip') { closeLens(); setTimeout(() => api.askAgent('What’s slipping?', {}), 200); return; }
  // push the overdue to tomorrow: the real late tasks, each one a change you can untick, undone as one
  const late = TASKS.filter((t) => t.list === 'overdue' && t.status !== 'done' && t.status !== 'dropped').slice(0, 12);
  const tom = clock.addDays(clock.today(), 1);
  ASKS.push = { title: 'Push overdue to tomorrow', answer: late.length ? null : 'Nothing is overdue. You’re clear.', rows: late.map((t) => ['cal', t.title, t.late ?? (t.due ? shortDay(t.due) : 'Late'), shortDay(tom)]) };
  animateHeight(st.el, () => {
    st.ask = { kind: 'push', ready: true, on: late.map(() => true), real: true,
      apply: (on) => {
        const was = late.filter((_, i) => on[i]).map((t) => ({ id: t.id, due: t.due ?? null, scheduled: t.scheduled ?? null }));
        for (const w of was) updateTask(w.id, { due: tom, scheduled: null });
        return () => { for (const w of was) updateTask(w.id, { due: w.due, scheduled: w.scheduled }); };
      } };
    update();
  });
}
function runAsk(kind) {
  const st = T; if (!st) return;
  if (REAL) { realAsk(kind); return; }
  animateHeight(st.el, () => { st.ask = { kind, ready: false, on: ASKS[kind].rows.map(() => true), question: kind === 'question' }; update(); });
  setTimeout(() => {
    if (T !== st || !st.ask || st.ask.kind !== kind || !st.el.isConnected) return;
    animateHeight(st.el, () => { st.ask.ready = true; update(); });
    haptic(10);
  }, 1500);
}
function startRec() {
  const st = T; if (!st) return;
  if (REAL) {
    const ta = $('.cap-text', st.el), slot = $('.cap-rec', st.el), btn = $('.cap-mic', st.el);
    R.recorder().then((rec) => {
      if (T !== st) return;
      if (rec.recording()) { rec.stop(); return; }
      rec.unlock?.();
      slot.hidden = false;
      rec.start({ target: ta, slot, button: btn, source: 'capture', purpose: st.type,
        onState: (s2) => { if (s2 === 'idle') slot.hidden = true; },
        onText: () => { if (T !== st || !ta.isConnected) return; st.text = ta.value; grow(ta); slot.hidden = true; animateHeight(st.el, () => update()); } });
    }).catch(() => toast('The recorder didn’t load. Try again in a moment'));
    return;
  }
  const slot = $('.cap-rec', st.el);
  $('.cap-field', st.el).hidden = true;
  st.rec = recorder(slot, {
    say: SAYS[st.type],
    onDone: (text) => {
      if (!st.el.isConnected) return;
      $('.cap-field', st.el).hidden = false;
      const ta = $('.cap-text', st.el);
      ta.value = text; st.text = text; grow(ta);
      animateHeight(st.el, () => update());
      st.rec = null;
    },
    onCancel: () => { if (st.el.isConnected) $('.cap-field', st.el).hidden = false; st.rec = null; },
  });
}
on('cap-go', () => goType());
on('cap-mic', () => startRec());
on('cap-suggest', (el) => runAsk(el.dataset.k));
on('cap-ask-x', () => { if (T) animateHeight(T.el, () => { T.ask = null; update(); }); });
on('cap-ask-row', (el) => { if (!T?.ask) return; const i = +el.dataset.i; T.ask.on[i] = !T.ask.on[i]; haptic(5); const c = $('.check', el); c.classList.toggle('done', T.ask.on[i]); c.setAttribute('aria-checked', String(T.ask.on[i])); update(); });
on('cap-proj', (el) => { if (!T) return; T.project = el.dataset.p; haptic(5); update(); });
on('cap-client-x', () => { if (!T) return; T.client = null; haptic(5); animateHeight(T.el, () => update()); });
on('cap-engine', (el) => { if (!T || T.engine === el.dataset.k) return; T.engine = el.dataset.k; T.model = 'Default'; haptic(8); update(); });
on('cap-model', (el) => { if (!T) return; T.model = el.dataset.v; haptic(5); update(); });
on('cap-effort', (el) => { if (!T) return; T.effort = el.dataset.v; haptic(5); update(); });
on('cap-switch', (el) => { if (!T) return; const k = el.dataset.k; T[k] = !T[k]; haptic(6); $('.switch', el).classList.toggle('on', T[k]); update(); });

provide('openCapture', (mode, ctx) => openCapture(mode, ctx ?? {}));
// agenticos://capture/share/<id> (the push after a share-in) and scan?mode=document|barcode (widgets, controls, Siri)
registerRoute('capture/share', (Lk, ctx) => { ctx.after(() => openShareIn(Lk.parts?.[2] ?? Lk.arg ?? null)); }, { owner: false });
registerRoute('scan', (Lk, ctx) => {
  const mode = Lk.query?.get('mode') ?? Lk.sub ?? null;
  ctx.base();
  ctx.after(() => {
    if (mode === 'document' && REAL && native.available) { openCapture('scan', { hint: 'document' }); setTimeout(() => realDoc(), 450); return; }
    if (mode === 'barcode' && REAL && native.available) { openCapture('scan', { hint: 'book' }); setTimeout(() => realBarcode(), 450); return; }
    openCapture('scan', mode && mode !== 'photo' ? { hint: mode } : {});
  });
});
if (REAL) {
  // what was shared in while the app was closed, and scans that waited offline: once at boot, then on focus
  onData((why) => { if (why === 'boot') setTimeout(() => { R.flushQueue(); tellWaiting(); }, 2500); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => tellWaiting(), 1500); });
}
provide('scan', (hint) => scan(hint));
// what was filed today (shares the PC filed, scans you or she filed), newest first, each with the link to where it went;
// her day (agent-state.js) shows them as "Filed: …"
const FILED_LINK = { content: (f) => (f.ref ? `content/idea/${f.ref}` : 'content/ideas'), today: (f) => (f.ref ? `task/${f.ref}` : 'tasks'), work: () => 'ideas', brain: () => 'brain' };
provide('scanFiled', (day = clock.today()) => (REAL ? R.scans().list().filter((x) => x.status === 'filed' && x.filed?.at && !x.filed.undone && clock.dateOfIso(x.filed.at) === day)
  .map((x) => ({ id: x.id, title: x.title ?? R.KIND_LABEL[x.kind] ?? 'Scan', app: x.filed.app ?? x.app ?? 'brain', where: x.filed.where ?? null, at: x.filed.at, by: x.filed.by ?? 'you', source: x.source ?? 'camera',
    link: (FILED_LINK[x.filed.app] ?? ((f) => f.app ?? 'brain'))(x.filed) }))
  .sort((a, b) => String(b.at).localeCompare(String(a.at))) : []));
provide('openShareIn', (sample) => { if (alive()) closeLens(); return openShareIn(sample); });

// ══ REAL MODE: the phone's camera, the PC's reading, the apps' handlers ════════════════════════════════════════
const BARCODE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6v12M7.5 6v12M11 6v12M13.5 6v12M17 6v12M20 6v12"/></svg>';
const CLOUD_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M8.5 6.4A6 6 0 0 1 18 11a4 4 0 0 1 2.5 6.9M17 18H7a5 5 0 0 1-1.6-9.7"/></svg>';
const KIND_WORD = { receipt: 'receipt', statement: 'statement', food: 'plate', face: 'face', book: 'book', page: 'page', goals: 'goal list', chat: 'chat', card: 'card', document: 'document', reel: 'reel', link: 'link' };
const rs = (n) => (n == null ? '' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
let offlineSaid = false, sid = 0;

function realLensHtml() {
  const tools = native.available ? `<div class="cap-tools">
      <button class="chip sm chrome" data-act="cap-doc">${I.doc}<span>Document</span></button>
      <button class="chip sm chrome" data-act="cap-barcode">${BARCODE}<span>Barcode</span></button></div>` : '';
  return `
    <div class="cap-cam stay-dark">
      <video class="cap-video" playsinline muted autoplay aria-label="Camera"></video>
      <div class="cap-nocam" hidden></div>
      <svg class="cap-ov" viewBox="0 0 ${SCENE_BOX.W} ${SCENE_BOX.H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <path class="cap-dim" fill-rule="evenodd" d=""/>
        ${CORNERS.map((d, i) => `<g class="cap-c" data-c="${i}"><path d="${d}"/></g>`).join('')}
      </svg>
      <button class="cap-tag chrome looking" data-act="cap-shutter" aria-live="polite"></button>
      <i class="cap-flash" aria-hidden="true"></i>
    </div>
    <header class="cap-top">
      <button class="gbtn chrome icon" data-act="cap-close" aria-label="Close">${I.x}</button>
      <button class="cap-count chrome" data-act="cap-session" hidden></button>
      <button class="gbtn chrome icon cap-torch" data-act="cap-torch" aria-label="Torch" aria-pressed="false" hidden>${G.torch}</button>
    </header>
    <div class="cap-tray" role="list" aria-label="Scans being read"></div>
    <div class="cap-pane overlay" hidden></div>
    <div class="cap-card overlay" hidden></div>
    <footer class="cap-bottom">
      ${tools}
      <p class="cap-swipe" aria-live="polite"></p>
      <div class="cap-modes">${seg('cap-mode', MODES, 'scan', 'chrome')}</div>
      <div class="cap-shoot">
        <button class="cap-last" data-act="cap-last" aria-label="Photos and files">${G.photos}</button>
        <button class="cap-shutter" data-act="cap-shutter" aria-label="Capture"><i></i></button>
        <button class="gbtn chrome icon cap-flip" data-act="cap-flip" aria-label="Flip the camera">${G.flip}</button>
      </div>
    </footer>`;
}
function realWire(el) {
  L.sid = ++sid;
  L.unsub = R.onScan((q) => onRealScan(q));
  R.flushQueue();
  R.status();
  el.classList.add('real');
}

// ── looking: the live camera, the frame, what to point it at ──
function realLook() {
  if (!alive() || L.mode !== 'scan') return;
  L.state = 'looking'; L.el.classList.remove('found');
  setBrackets(FRAME); setDim(null);
  const tag = $('.cap-tag', L.el);
  tag.className = 'cap-tag chrome looking';
  tag.innerHTML = `${I.scan}<span>${L.hint ? `Point at the ${esc(KIND_WORD[L.hint] ?? L.hint)}` : 'Point at anything'}</span>`;
  tag.setAttribute('aria-label', 'Capture');
  tag.style.left = '50%'; tag.style.top = `${toScreen([0, 214])[1]}px`; tag.style.setProperty('--tx', '-50%');
  // it says what to do, then steps out of the picture
  clearTimeout(L.tagT); L.tagT = setTimeout(() => { if (alive() && L.state === 'looking') tag.classList.add('quiet'); }, 2600);
  const sw = $('.cap-swipe', L.el);
  if (sw) sw.textContent = L.hint === 'document' ? 'A page, a form, a notice: it keeps the text' : 'A receipt, a plate, a book, a page, a chat, a card';
  const video = $('.cap-video', L.el);
  if (R.camera.state !== 'on' || video.srcObject !== R.camera.stream) {
    R.camera.state = 'starting'; realCamState();
    R.camera.start(video).then(() => { if (alive()) realCamState(); });
  } else realCamState();
  drawTray();
}
function realCamState() {
  if (!alive()) return;
  const st = R.camera.state, box = $('.cap-nocam', L.el);
  L.el.dataset.cam = st;
  $('.cap-torch', L.el).hidden = !(st === 'on' && R.camera.canTorch());
  if (st === 'on' || st === 'starting') { box.hidden = st === 'on'; box.innerHTML = st === 'starting' ? '<span class="spin" style="--c:#fff"></span>' : ''; return; }
  const denied = st === 'denied';
  box.hidden = false;
  box.innerHTML = `<span class="cap-nocam-ic" aria-hidden="true">${I.scan}</span>
    <h3>${denied ? 'The camera is off for this app' : 'No live camera here'}</h3>
    <p>${denied ? 'Allow the camera in Settings, or take a photo instead.' : 'Take a photo or pick one: it reads them the same way.'}</p>
    <div class="cap-nocam-a"><button class="btn primary" data-act="cap-photo">${I.scan}Take a photo</button><button class="btn" data-act="cap-pick-photos">${G.photos}Choose photos</button></div>`;
}

// ── shooting: the frame goes to the tray at once; the PC reads it while he shoots the next ──
function flash() { const f = $('.cap-flash', L.el); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go'); }
async function realShoot() {
  if (R.camera.state !== 'on') { realPhoto('camera'); return; }
  const f = R.camera.frame();
  if (!f) { toast('The camera isn’t ready yet'); return; }
  flash(); haptic(14);
  const q = R.shoot({ image: f.image, thumb: f.thumb, mime: f.mime, source: 'camera', hint: L.hint });
  q.image = `data:image/jpeg;base64,${f.image}`; q.sid = L.sid;
  flyToTray(q);
}
async function realPhoto(source = 'camera') {
  const r = await native.scan.photo({ source, ocr: true, barcodes: true, classify: true, maxSize: 1600, quality: 0.82 });
  if (!r?.ok) { if (!r?.cancelled && r?.error) toast(r.error); return; }
  if (!alive()) return;
  const thumb = await R.thumbFrom(r.image, r.mime);
  const q = R.shoot({ image: r.image, mime: r.mime ?? 'image/jpeg', thumb, source: source === 'library' ? 'library' : 'camera', hint: L?.hint, ocr: r.text ?? null, barcodes: r.barcodes ?? null, guess: r.classify?.guess ?? null });
  q.image = `data:${r.mime ?? 'image/jpeg'};base64,${r.image}`; q.sid = L?.sid;
  haptic(12); drawTray();
}
async function realPickPhotos() {
  const files = await R.pickFiles({ multiple: true });
  if (!files.length || !alive()) return;
  if (L.mode !== 'scan') setMode('scan');
  for (const f of files) { const q = R.shoot({ image: f.image, mime: f.mime, thumb: f.thumb, source: 'file', hint: L.hint }); q.image = `data:${f.mime};base64,${f.image}`; q.sid = L.sid; }
  haptic(12); drawTray();
  toast(files.length === 1 ? `${AGENT.name} is reading it` : `${AGENT.name} is reading ${files.length}`);
}
async function realDoc() {
  const r = await native.scan.document({ ocr: true, maxSize: 2000 });
  if (!r?.ok || !r.pages?.length || !alive()) { if (r?.available === false) toast('The document scanner is on the iPhone app'); return; }
  const [first, ...rest] = r.pages;
  const thumb = await R.thumbFrom(first.image);
  const q = R.shoot({ image: first.image, images: rest.map((p) => p.image), thumb, source: 'document', hint: L.hint && L.hint !== 'document' ? L.hint : null, ocr: r.text ?? null });
  q.image = `data:image/jpeg;base64,${first.image}`; q.sid = L.sid; drawTray();
}
async function realBarcode() {
  const r = await native.scan.barcode();
  if (!r?.ok || !r.value || !alive()) { if (r?.available === false) toast('The barcode scanner is on the iPhone app'); return; }
  const q = R.shoot({ barcodes: [{ value: r.value, type: r.type }], source: 'barcode', hint: 'book' });
  q.sid = L.sid; haptic(12); drawTray();
}
on('cap-photo', () => realPhoto('camera'));
on('cap-pick-photos', () => realPickPhotos());
on('cap-doc', () => realDoc());
on('cap-barcode', () => realBarcode());

// ── the tray: every shot in flight, with its state; tap one to see it ──
const sessionScans = () => [...R.live.values()].filter((q) => q.sid === L?.sid || (q.queued && q.state !== 'filed')).slice(-8);
function drawTray() {
  if (!alive()) return;
  const tray = $('.cap-tray', L.el), list = sessionScans();
  tray.classList.toggle('on', list.length > 0 && L.mode === 'scan');
  tray.innerHTML = list.map((q) => `<button class="cap-tq ${q.state}${q === L.q ? ' cur' : ''}" role="listitem" data-act="cap-tray" data-id="${esc(q.id)}" aria-label="${esc(trayLabel(q))}">
      ${q.thumb ? `<img src="${q.thumb}" alt="">` : `<span class="cap-tq-k">${KIND_ICON[q.item?.kind ?? q.guess] ?? BARCODE}</span>`}
      <i class="cap-tq-ring" aria-hidden="true"></i>${q.state === 'offline' ? `<b class="cap-tq-b">${CLOUD_OFF}</b>` : q.state === 'failed' ? '<b class="cap-tq-b">!</b>' : q.state === 'filed' ? `<b class="cap-tq-b ok">${I.check}</b>` : ''}</button>`).join('');
  const reading = list.filter((q) => q.state === 'reading').length, waiting = list.filter((q) => q.state === 'offline').length;
  const sw = $('.cap-swipe', L.el);
  if (sw && L.mode === 'scan' && !L.q) sw.textContent = reading ? `${AGENT.name} is reading ${reading === 1 ? 'one' : reading}. Keep shooting` : waiting ? `${waiting} saved on this phone, read when your PC is back` : (L.hint === 'document' ? 'A page, a form, a notice: it keeps the text' : 'A receipt, a plate, a book, a page, a chat, a card');
}
const trayLabel = (q) => ({ reading: 'Reading', ready: q.item?.title ?? 'Ready', offline: 'Saved on this phone', failed: 'Couldn’t read it', filed: `Filed: ${q.item?.title ?? ''}` })[q.state] ?? '';
function flyToTray(q) {
  drawTray();
  if (reduced() || !q.thumb) return;
  const slot = $(`.cap-tq[data-id="${CSS.escape(q.id)}"]`, L.el); if (!slot) return;
  const a = $('.cap-cam', L.el).getBoundingClientRect(), b = slot.getBoundingClientRect(), ph = L.el.getBoundingClientRect();
  const g = document.createElement('img'); g.src = q.thumb; g.className = 'cap-fly'; g.alt = '';
  const w = Math.min(220, a.width * 0.55);
  Object.assign(g.style, { left: `${a.left - ph.left + (a.width - w) / 2}px`, top: `${a.top - ph.top + a.height * 0.28}px`, width: `${w}px` });
  L.el.append(g);
  slot.style.opacity = '0';
  const gx = b.left - ph.left - (a.left - ph.left + (a.width - w) / 2), gy = b.top - ph.top - (a.top - ph.top + a.height * 0.28), s = b.width / w;
  g.animate([{ transform: 'translate(0,0) scale(1) rotate(0deg)', borderRadius: '18px', opacity: 1 }, { transform: `translate(${gx}px, ${gy}px) scale(${s}) rotate(-4deg)`, borderRadius: `${12 / s}px`, opacity: 1 }],
    { duration: 520, easing: 'cubic-bezier(.3,1.25,.4,1)' }).finished.then(() => { g.remove(); slot.style.opacity = ''; slot.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }], { duration: 300, easing: 'cubic-bezier(.3,1.4,.5,1)' }); }).catch(() => g.remove());
}
function onRealScan(q) {
  if (!alive()) return;
  drawTray();
  if (q.state === 'offline' && !offlineSaid) { offlineSaid = true; toast('Saved on this phone. It’s read when your PC is reachable'); }
  if (L.q === q) { const c = $('.cap-card', L.el); c.innerHTML = realCardHtml(q); if (q.state === 'ready') { arrive(c); haptic(8); } maybeCountdown(); return; }
  if ((q.state === 'ready' || q.state === 'failed') && q.sid === L.sid) {
    haptic(q.state === 'ready' ? 8 : 4);
    if (L.mode === 'scan' && !L.q) showRealCard(q);
  }
}
const nextReady = () => sessionScans().find((q) => q.state === 'ready' && q !== L?.q) ?? null;
function openNextReady() { if (!alive() || L.mode !== 'scan' || L.q) return; const q = nextReady(); if (q) showRealCard(q); }

// ── the card: what it read, where it goes, one tap (or she files it herself), the alternatives ──
function showRealCard(q) {
  if (!alive()) return;
  stopCountdown();
  L.q = q; L.item = q.item ?? null; L.alt = null; L.state = 'review';
  const c = $('.cap-card', L.el);
  c.innerHTML = realCardHtml(q);
  c.hidden = false; c.classList.remove('done');
  requestAnimationFrame(() => c.classList.add('in'));
  L.el.classList.add('carding');
  if (q.state === 'ready') arrive(c);
  drawTray();
  maybeCountdown();
}
const textOf = (it) => {
  const f = it?.fields ?? {};
  if (f.text) return String(f.text);
  if (it?.kind === 'receipt' && f.items?.length) return f.items.map((x) => `${x.name}${x.qty > 1 ? ` ×${x.qty}` : ''} ${rs(x.price)}`).join(', ');
  if (it?.kind === 'goals' && f.items?.length) return f.items.map((g) => `• ${g.title}`).join('\n');
  if (it?.kind === 'card') return [f.name, f.role, f.org, f.phone, f.email].filter(Boolean).join(' · ');
  if (it?.kind === 'reel' || it?.kind === 'link') return [f.title, f.url].filter(Boolean).join('\n');
  return '';
};
function realDraftHtml(it) {
  const f = it.fields ?? {}, rows = (list, tot) => `<div class="cap-rows">${list.map(([k, v]) => `<p><span>${esc(k)}</span><b>${esc(v)}</b></p>`).join('')}${tot ? `<p class="tot"><span>${esc(tot[0])}</span><b>${esc(tot[1])}</b></p>` : ''}</div>`;
  const quote = (t, n = 240) => (t ? `<p class="cap-quote">${esc(String(t).length > n ? `${String(t).slice(0, n - 1)}…` : t)}</p>` : '');
  switch (it.kind) {
    case 'receipt': return f.items?.length ? rows(f.items.slice(0, 6).map((x) => [`${x.name}${x.qty > 1 ? ` ×${x.qty}` : ''}`, rs(x.price)]), f.total != null ? ['Total', rs(f.total)] : null)
      : rows([['Merchant', f.merchant ?? 'Not on it'], ['Date', f.date ?? 'Not on it']], f.total != null ? ['Total', rs(f.total)] : null);
    case 'statement': return rows([['Bank', f.bank ?? '—'], ['Period', f.period ?? '—'], ['Rows read', String(f.rows?.length ?? 0)]]);
    case 'food': return f.items?.length ? rows(f.items.slice(0, 6).map((x) => [x.name, x.kcal ? `${x.kcal} kcal` : '']), f.kcal ? ['About', `${f.kcal} kcal${f.protein ? ` · ${Math.round(f.protein)} g protein` : ''}`] : null) : quote(it.summary);
    case 'face': return `${rows([['Angle', f.angle ?? 'front'], ...(f.lighting ? [['Light', f.lighting]] : [])])}${quote(f.notes)}`;
    case 'book': return rows([['Author', f.author ?? 'Not on the cover'], ...(f.pages ? [['Pages', String(f.pages)]] : []), ...(f.page ? [['Open at', `page ${f.page}`]] : [])]);
    case 'goals': return rows((f.items ?? []).slice(0, 6).map((g, i) => [`${i + 1}`, g.title]));
    case 'chat': return `${f.person ? `<p class="cap-event">${I.user}<span>${esc(f.person)}${f.app ? ` · ${esc(f.app)}` : ''}</span></p>` : ''}${quote(f.asks || f.text)}`;
    case 'card': return rows([['Name', f.name ?? '—'], ...(f.role || f.org ? [['Work', [f.role, f.org].filter(Boolean).join(', ')]] : []), ...(f.phone ? [['Phone', f.phone]] : []), ...(f.email ? [['Email', f.email]] : [])]);
    case 'reel': case 'link': return `${quote(f.title ?? it.title, 140)}${f.url ? `<p class="cap-event">${I.link}<span>${esc(f.platform ?? '')}${f.platform ? ' · ' : ''}${esc(String(f.url).replace(/^https?:\/\/(www\.)?/, '').slice(0, 42))}</span></p>` : ''}`;
    default: return quote(f.text ?? it.summary);
  }
}
function realCardHtml(q) {
  const it = q.item;
  const head = (kind, k, title, sub) => `<div class="cap-card-h">${q.thumb ? `<span class="tile cap-kind cap-shot" aria-hidden="true"><img src="${q.thumb}" alt=""></span>` : kindTile(kind)}
      <div class="cap-card-t"><p class="cap-k">${I.sparkle}<span>${esc(k)}</span></p><h3>${esc(title)}</h3>${sub ? `<p class="cap-sub">${esc(sub)}</p>` : ''}</div>
      <button class="cap-card-x" data-act="cap-card-x" aria-label="Back to the camera">${I.x}</button></div>`;
  if (q.state === 'reading' || q.state === 'offline') {
    const g = q.guess ? R.KIND_LABEL[q.guess] : null;
    return `<div class="cap-card-in">${head(q.guess, q.state === 'offline' ? 'Saved on this phone' : `${AGENT.name} is reading it`, g ? `${g}?` : 'Reading…', q.state === 'offline' ? 'Your PC is away. It’s read the moment it’s back, and waits for you here.' : 'It takes a few seconds. Keep shooting: each one waits in the tray.')}
      <div class="cap-skel" aria-hidden="true"><i></i><i></i><i></i></div>
      <button class="btn block" data-act="cap-card-x">Keep scanning</button></div>`;
  }
  if (q.state === 'failed' || !it?.kind) {
    return `<div class="cap-card-in">${head(null, 'Couldn’t read it', 'Not sure what this is', q.error ?? it?.error ?? 'Try again, closer and with more light.')}
      <div class="cap-done-a cap-fail-a"><button class="btn primary" data-act="cap-rescan">${I.undo}Try again</button><button class="btn" data-act="cap-brain">Save to Brain</button></div></div>`;
  }
  const to = L.alt != null ? it.alternatives[L.alt] : it.suggestion;
  const secs = it.ms ? `${Math.max(1, Math.round(it.ms / 1000))} s` : '';
  const who = it.engine === 'phone' ? 'read on this phone (the PC couldn’t)' : it.engine === 'isbn' ? 'found by its barcode' : it.engine === 'link' ? 'read from the link' : `read on your PC${secs ? ` in ${secs}` : ''}`;
  const off = isAspect(to.app) && !takes(to.kind, it.fields ?? {});
  const auto = autoOk(it, to);
  return `<div class="cap-card-in">${head(it.kind, `${AGENT.name} · ${who}`, it.title, it.summary)}
    <div class="cap-draft">${realDraftHtml(it)}</div>
    <div class="cap-dest" aria-live="polite"><span class="cap-dest-l">Goes to</span>${destTile(off ? 'brain' : to.app, 'sm')}<b>${esc(off ? `Brain, for ${destName(to.app)}` : to.where)}</b></div>
    ${off ? `<p class="cap-note">${esc(destName(to.app))} isn’t taking scans on this phone yet, so it waits in your Brain.</p>` : ''}
    <button class="btn primary block cap-file${auto ? ' counting' : ''}" style="--c:${destFill(off ? 'brain' : to.app)}" data-act="cap-file"><span class="cap-cd" aria-hidden="true"></span><span class="cap-file-l">${esc(off ? 'Save to Brain' : to.label)}</span></button>
    ${auto ? `<p class="cap-cd-hint">${esc(AGENT.name)} files it in a moment. Tap anything to stop her.</p>` : ''}
    ${it.alternatives?.length ? `<div class="chips cap-alts" role="group" aria-label="Or">${it.alternatives.map((a, i) => `<button class="chip sm${L.alt === i ? ' on' : ''}" data-act="cap-alt" data-i="${i}" aria-pressed="${L.alt === i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
  </div>`;
}
// DECISIONS 2: when she's sure and the app files silently (its scan entry says auto), she files it herself after a beat
function autoOk(it, to) {
  if (L?.alt != null || !it || it.confidence < 0.8 || to !== it.suggestion) return false;
  const h = handlerFor(to.kind, it.fields ?? {});
  return !!h?.h?.auto;
}
function maybeCountdown() {
  stopCountdown();
  const b = alive() && $('.cap-file.counting', L.el);
  if (!b) return;
  L.cdT = setTimeout(() => { if (alive() && L.q?.item && $('.cap-file.counting', L.el)) realFile({ auto: true }); }, reduced() ? 2400 : 3000);
  const stop = (e) => { if (!e.target.closest('.cap-file')) stopCountdown(); };
  L.cdOff = () => L.el.removeEventListener('pointerdown', stop, true);
  L.el.addEventListener('pointerdown', stop, true);
}
function stopCountdown() {
  if (!L) return;
  clearTimeout(L.cdT); L.cdT = 0; L.cdOff?.(); L.cdOff = null;
  $$('.cap-file.counting', L.el).forEach((b) => b.classList.remove('counting'));
  $$('.cap-cd-hint', L.el).forEach((p) => p.remove());
}
on('cap-rescan', () => {
  const q = L?.q; if (!q) return;
  hideCard(); L.q = null; L.item = null;
  if (q.image) { R.live.delete(q.id); const n = R.shoot({ image: q.image.split(',')[1], thumb: q.thumb, source: q.source ?? 'camera', hint: L.hint }); n.image = q.image; n.sid = L.sid; }
  realLook();
});
on('cap-brain', () => { const q = L?.q; if (!q) return; if (has('remember')) api.remember(q.item?.summary || 'A scan I couldn’t read', { title: q.item?.title ?? 'Scan', via: 'scan', by: 'you', quiet: true }); toast('Saved to your Brain'); q.state = 'filed'; hideCard(); L.q = null; L.item = null; realLook(); });

const doneLine = (to, it, app) => (app === 'brain' && to.app !== 'brain' ? 'Saved to your Brain' : to.app === 'today' ? 'Added to your tasks' : it.kind === 'receipt' && it.fields?.total != null && to.app === 'money' ? `${rs(it.fields.total)} to Money` : `Sent to ${destName(app) || 'its app'}`);
async function realFile({ auto = false } = {}) {
  const q = L?.q, it = q?.item;
  if (!it?.kind) return;
  stopCountdown();
  const to = L.alt != null ? it.alternatives[L.alt] : it.suggestion;
  const result = { kind: to.kind, title: it.title, summary: it.summary, fields: it.fields ?? {}, image: q.image ?? null, imageUrl: it.imageUrl ?? null, id: it.id, source: it.source };
  let undo = null, where = to.where, app = to.app, sheet = null, page = false;
  try {
    if (to.app === 'today') {
      const t = addTask({ title: it.title, notes: [it.summary, textOf(it)].filter(Boolean).join('\n\n') || null });
      undo = () => dropTask(t.id); where = 'Tasks · Inbox';
    } else if (to.app === 'brain' || (isAspect(to.app) && !takes(to.kind, result.fields))) {
      // the Brain; or the app for this kind isn't taking scans yet, so it waits in the Brain instead of nowhere
      if (has('remember')) api.remember(`${it.title}${it.summary ? `: ${it.summary}` : ''}${textOf(it) ? `\n${textOf(it)}` : ''}`, { aspect: isAspect(to.app) ? to.app : it.fields?.aspect ?? null, title: it.title, via: 'scan', by: auto ? 'wyn' : 'you', quiet: true });
      if (to.app !== 'brain') where = `Brain, for ${destName(to.app)}`;
      app = 'brain';
    } else {
      const r = routeScan(result, { auto, id: it.id, source: it.source });
      const ret = await Promise.resolve(r.ret).catch(() => null);
      if (typeof ret?.undo === 'function') undo = ret.undo;
      if (ret?.where) where = ret.where;
      sheet = r.sheet; page = r.page;
    }
  } catch (e) { console.warn('[capture] filing', e); toast('That app couldn’t take it. Try another place'); return; }
  R.saveItem(it, { status: 'filed', app, filed: { app, kind: to.kind, action: to.action, where, at: new Date().toISOString(), by: auto ? 'wyn' : 'you' } });
  q.state = 'filed';
  if (!alive()) return;
  drawTray();
  const view = { title: it.title, sub: it.summary, thumb: q.thumb, q };
  const dest = { app, where, done: doneLine(to, it, app), undo };
  if (page) { record(view, dest); closeLens(); return; }
  if (sheet) { record(view, dest); showDone(view, { ...dest, done: `Over to ${destName(app)} to review` }, sheet); return; }
  record(view, dest);
  showDone(view, dest);
  if (auto && has('agentSay')) api.agentSay(`Filed ${it.title} · ${where}`, { kind: 'did', ...(undo ? { onUndo: undo } : {}) });
}
function realUndo(f, { quiet = false } = {}) {
  try { f.undo?.(); } catch (e) { console.warn('[capture] undo', e); }
  const q = f.item?.q;
  if (q?.item) { R.saveItem(q.item, { status: 'ready', filed: null }); q.state = 'ready'; }
  const cnt = $('.cap-count', L.el);
  if (L.filed.length) cnt.innerHTML = `${I.check}<span><b class="met">${L.filed.length}</b> filed</span>`; else { cnt.hidden = true; $('.cap-last', L.el).innerHTML = G.photos; }
  drawTray();
  if (quiet) { if (L.filed.length) $('.cap-card', L.el).innerHTML = sessionHtml(); else { hideCard(); L.q = null; realLook(); } toast('Undone'); return; }
  toast('Undone. It’s back to file');
  if (q) showRealCard(q); else hideCard();
}

// ── voice: the real recorder; the PC writes it down (Codex), then she splits it per app ──
function loginBanner(s) {
  const p = R.loginProblem(s);
  if (!p) return '';
  return `<div class="cap-login" role="status"><span class="tile">${I.sparkle}</span><span><b>${p === 'expired' ? 'Codex needs you on the PC' : 'Codex isn’t signed in on the PC'}</b><small>Open Codex on your PC and sign in${p === 'expired' ? ' again' : ''}. Your recordings are kept and go through after.</small></span></div>`;
}
function realVoicePane(pane) {
  const ask = !!L.opts.ask;
  pane.innerHTML = `<div class="cap-pane-body cap-voice">
      <p class="cap-v-k">${I.sparkle}<span>${ask ? 'Ask your Brain anything' : `Tell ${esc(AGENT.name)} anything. She files each part where it belongs.`}</span></p>
      <div class="cap-v-login"></div>
      <p class="cap-v-text" aria-live="polite"><span class="ph">${ask ? '“What did I save about Dad?”' : '“Spent ₹120 on samosas, and remind me to call Dad at 6”'}</span></p>
      <div class="cap-v-wave idle" aria-hidden="true">${Array.from({ length: 44 }, (_, i) => `<i style="--h:${(0.1 + 0.22 * Math.abs(Math.sin(i * 0.55)) * Math.abs(Math.cos(i * 0.21))).toFixed(3)}"></i>`).join('')}</div>
      <div class="cap-v-slot"></div>
      <p class="cap-v-tip">Hinglish is fine. Hold the Scan button anywhere to start talking.</p>
      <div class="cap-v-ctl"><span class="cap-v-time met"></span><button class="cap-v-mic" data-act="cap-v-mic" aria-label="Start talking">${I.mic}</button><span class="cap-v-hint">Tap to talk</span></div>
      <div class="cap-v-out"></div>
      <textarea class="cap-v-target" hidden aria-hidden="true"></textarea>
    </div>`;
  L.voice = { state: 'idle', stop: () => { R.recorder().then((r) => (r.recording() ? r.cancel() : null)).catch(() => {}); } };
  R.status().then((s) => { if (alive() && L.mode === 'voice') $('.cap-v-login', L.el).innerHTML = loginBanner(s); });
  if (L.opts.record) { L.opts.record = false; requestAnimationFrame(() => realMic()); }
}
async function realMic() {
  if (!alive() || L.mode !== 'voice') return;
  const pane = $('.cap-pane', L.el), V = L.voice;
  let rec;
  try { rec = await R.recorder(); } catch (e) { console.warn('[capture] recorder', e); toast('The recorder didn’t load. Try again in a moment'); return; }
  if (!alive()) return;
  if (rec.recording()) { rec.stop(); return; }
  if (V.state === 'think' || V.state === 'tx') return;
  const ta = $('.cap-v-target', pane); ta.value = '';
  $('.cap-v-out', pane).innerHTML = '';
  rec.unlock?.();
  rec.start({ target: ta, slot: $('.cap-v-slot', pane), button: $('.cap-v-mic', pane), source: 'capture', purpose: L.opts.ask ? 'ask' : 'capture',
    onState: (st, o) => voiceState(st, o),
    onText: (text, r) => voiceHeard(text, r) });
}
function voiceState(st, { received = false } = {}) {
  if (!alive() || L.mode !== 'voice') return;
  const pane = $('.cap-pane', L.el), V = L.voice;
  pane.classList.toggle('rec', st === 'recording' || st === 'starting');
  const hint = $('.cap-v-hint', pane), mic = $('.cap-v-mic', pane);
  if (st === 'recording') { V.state = 'rec'; hint.textContent = 'Listening'; mic.innerHTML = '<i></i>'; mic.setAttribute('aria-label', 'Stop'); haptic(12); }
  else if (st === 'transcribing') { V.state = 'tx'; hint.textContent = 'Writing it down'; mic.innerHTML = I.mic; $('.cap-v-out', pane).innerHTML = `<p class="cap-v-think"><span class="spin" style="--c:var(--ink-2)"></span><span>Your PC is writing it down</span></p>`; }
  else if (st === 'queued' && received) { V.state = 'idle'; hint.textContent = 'Tap to talk'; $('.cap-v-out', pane).innerHTML = `<p class="cap-v-think"><span class="spin" style="--c:var(--ink-2)"></span><span>Your PC has it and is still writing it down. It shows here when it’s done, and in Settings › Voice recordings.</span></p>`; }
  else if (st === 'queued') { V.state = 'idle'; hint.textContent = 'Tap to talk'; $('.cap-v-out', pane).innerHTML = `<p class="cap-v-think">${CLOUD_OFF}<span>Saved on this phone. It’s written down when your PC is reachable, in Settings › Voice recordings.</span></p>`; }
  else if (st === 'failed') { V.state = 'idle'; hint.textContent = 'Tap to talk'; voiceFailed(); }
  else if (st === 'idle' && V.state === 'rec') { V.state = 'idle'; hint.textContent = 'Tap to talk'; mic.innerHTML = I.mic; }
}
async function voiceFailed() {
  const rs0 = await R.recordings();
  const r = rs0.find((x) => x.source === 'capture' && x.status === 'failed');
  if (!alive() || L.mode !== 'voice') return;
  L.voice.failedId = r?.id ?? null;
  const login = r?.errorCode === 'login_expired' || r?.errorCode === 'login_required';
  if (login) $('.cap-v-login', L.el).innerHTML = loginBanner({ transcription: { login: r.errorCode === 'login_expired' ? 'expired' : 'missing' } });
  $('.cap-v-out', L.el).innerHTML = `<div class="cap-heard"><p class="cap-heard-k"><b>${login ? 'Codex is signed out on your PC.' : 'It wasn’t written down.'}</b> ${esc(login ? 'The recording is kept.' : r?.error ?? 'The recording is kept.')}</p>
    ${r ? '<button class="btn block" data-act="cap-v-retry">Try again</button>' : ''}</div>`;
}
async function realRetry() {
  const id = L?.voice?.failedId; if (!id) return;
  $('.cap-v-out', L.el).innerHTML = `<p class="cap-v-think"><span class="spin" style="--c:var(--ink-2)"></span><span>Trying again</span></p>`;
  try {
    const r = (await API.post(`/voice/${id}/retry`, {})).recording;
    if (r?.status === 'done') { R.status(true).then((s) => { if (alive()) $('.cap-v-login', L.el).innerHTML = loginBanner(s); }); voiceHeard(r.text ?? '', r); }
    else voiceFailed();
  } catch { voiceFailed(); }
}
async function voiceHeard(text, recording) {
  if (!alive() || L.mode !== 'voice') return;
  const pane = $('.cap-pane', L.el), V = L.voice;
  text = String(text ?? '').trim();
  if (!text) { V.state = 'idle'; $('.cap-v-out', pane).innerHTML = ''; return; }
  $('.cap-v-text', pane).innerHTML = esc(text);
  if (L.opts.ask) { closeLens(); setTimeout(() => api.openBrain(`search=${text}`), 220); return; }
  V.state = 'think'; V.text = text; V.rid = recording?.id ?? null;
  $('.cap-v-out', pane).innerHTML = `<p class="cap-v-think"><span class="spin" style="--c:var(--ink-2)"></span><span>${esc(AGENT.name)} is sorting it</span></p>`;
  try {
    const p = await R.plan(text);
    if (!alive() || L.voice !== V) return;
    V.state = 'parsed'; V.reply = p.reply; V.items = p.items ?? []; V.on = V.items.map(() => true); V.filed = false; V.id = API.clientId('say');
    const hint = $('.cap-v-hint', pane); if (hint) hint.textContent = 'Tap to add more';
    if (!V.items.length) V.items = [{ n: 0, action: 'note', app: 'brain', title: 'Note', detail: text.slice(0, 120), args: { text } }], V.on = [true];
    $('.cap-v-out', pane).innerHTML = realHeardHtml();
    arrive(pane, '.cap-heard-k, .cap-hrow, [data-act="cap-v-file"]');
  } catch (e) {
    V.state = 'idle';
    $('.cap-v-out', pane).innerHTML = `<div class="cap-heard"><p class="cap-heard-k"><b>She couldn’t sort it just now.</b> The words are kept above.</p><div class="chips"><button class="chip sm" data-act="cap-v-astask">Make it a task</button><button class="chip sm" data-act="cap-v-asnote">Save to Brain</button></div></div>`;
  }
}
const SAY_APP = { today: 'today', work: 'work', brain: 'brain', content: 'content' };
const sayTile = (app) => (isAspect(app) ? aspectTile(app) : destTile(SAY_APP[app] ?? (app === 'people' ? 'friends' : 'brain')));
function realHeardHtml() {
  const V = L.voice; const n = V.on.filter(Boolean).length;
  const rows = V.items.map((x, i) => {
    const res = V.results?.find((r) => r.n === x.n);
    const meta = V.filed ? (res?.ok ? `${x.detail ? `${x.detail} → ` : ''}${res.where ?? 'Filed'}${res.undone ? ' · undone' : ''}` : res ? `Didn’t go: ${res.error ?? ''}` : 'Left out') : x.detail;
    return `<button class="row ic cap-hrow${V.filed ? ' filed' : ''}${V.filed && !res?.ok ? ' miss' : ''}" data-act="cap-v-row" data-i="${i}" ${V.filed ? 'disabled' : ''}>${sayTile(x.app)}<span class="rbody"><span class="rtitle">${esc(x.title)}</span><span class="rmeta">${esc(meta)}</span></span><span class="check${(V.filed ? res?.ok && !res.undone : V.on[i]) ? ' done' : ''}" role="checkbox" aria-checked="${!!V.on[i]}" aria-label="File this">${I.check}</span></button>`;
  }).join('');
  const okN = (V.results ?? []).filter((r) => r.ok && !r.undone).length;
  const head = V.filed ? (okN ? `<b>Filed.</b> ${okN === 1 ? 'It’s in its app.' : `${okN} things, each in its app.`}` : '<b>Nothing filed.</b>') : `<b>${V.items.length === 1 ? 'One thing' : `${V.items.length} things`}</b>${V.reply ? `. ${esc(V.reply)}` : ', each for its own app.'} Untick any you don’t want.`;
  const undoable = V.filed && V.results?.some((r) => r.ok && r.undo && !r.undone);
  return `<div class="cap-heard"><p class="cap-heard-k">${head}</p><div class="group">${rows}</div>
    ${V.filed ? `<div class="cap-done-a cap-v-done">${undoable ? `<button class="btn sm" data-act="cap-v-undo">${I.undo}Undo all</button>` : ''}<button class="btn sm" data-act="cap-v-again">${I.mic}Say something else</button></div>` : `<button class="btn primary block" data-act="cap-v-file" ${n ? '' : 'disabled'}>File ${n === V.items.length ? (n === 1 ? 'it' : `all ${n}`) : n}</button>`}</div>`;
}
async function realSayFile() {
  const V = L?.voice; if (!V?.items || V.filed || V.busy) return;
  const picked = V.items.filter((_, i) => V.on[i]);
  if (!picked.length) return;
  V.busy = true;
  const btn = $('[data-act="cap-v-file"]', L.el); if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin" style="--c:var(--on-color)"></span>Filing`; }
  try {
    const r = await R.applyPlan(V.id, V.text, picked);
    V.results = r.item?.results ?? [];
    // what the PC hands back to the phone: the Brain's note when its server half isn't there
    for (const x of V.results) if (x.ok && x.phone?.bus === 'remember' && has('remember')) api.remember(x.phone.text, { aspect: x.phone.aspect ?? null, person: x.phone.person ?? null, via: 'voice', by: 'wyn', quiet: true });
    V.filed = true; V.items = picked;
    if (alive()) $('.cap-v-out', L.el).innerHTML = realHeardHtml();
    SYNC.refresh?.(true);
    haptic(16);
    const ok = V.results.filter((x) => x.ok);
    toast(ok.length ? `Filed to ${[...new Set(ok.map((x) => (x.where ?? '').split(/ [·›,]/)[0]).filter(Boolean))].slice(0, 3).join(', ')}` : 'Nothing went through. Try again');
    record({ title: V.text.slice(0, 60), sub: `${ok.length} filed` }, { app: ok[0]?.app === 'today' ? 'today' : isAspect(ok[0]?.app) ? ok[0].app : 'brain', where: ok.map((x) => x.where).join(', '), done: 'Filed', undo: null });
  } catch (e) { toast(e?.message ? `Couldn’t file it: ${e.message}` : 'Couldn’t file it. Try again'); if (btn) { btn.disabled = false; btn.textContent = 'File'; } }
  finally { V.busy = false; }
}
on('cap-v-undo', async () => {
  const V = L?.voice; if (!V?.id) return;
  try { const r = await R.undoItem(V.id); V.results = r.item?.results ?? V.results; SYNC.refresh?.(true); toast('Undone'); if (alive()) $('.cap-v-out', L.el).innerHTML = realHeardHtml(); }
  catch (e) { toast(e?.message ?? 'Couldn’t undo it'); }
});
on('cap-v-astask', () => { const V = L?.voice; if (!V?.text) return; const t = addTask({ title: V.text.slice(0, 300) }); toast('Added to your Inbox', () => { dropTask(t.id); toast('Task removed'); }); closeLens(); });
on('cap-v-asnote', () => { const V = L?.voice; if (!V?.text) return; if (has('remember')) api.remember(V.text, { via: 'voice', by: 'you' }); closeLens(); });

// ── files: photos and screenshots read like the camera; what waits to be filed; what was filed lately ──
function realFilesPane(pane) {
  const S = R.scans();
  const list = S.list().filter((x) => x.kind && x.kind !== 'say');
  const waiting = list.filter((x) => x.status === 'ready' && !x.filed).slice(0, 8);
  const filed = list.filter((x) => x.status === 'filed' && x.filed).slice(0, 8);
  const ago = (iso) => (iso ? clock.ago(iso) : '');
  const row = (x, act) => `<div class="row ic">${x.imageUrl ? `<span class="tile cap-kind cap-shot" data-img="${esc(x.imageUrl)}" aria-hidden="true">${KIND_ICON[x.kind] ?? I.scan}</span>` : kindTile(x.kind)}<span class="rbody"><span class="rtitle">${esc(x.title ?? R.KIND_LABEL[x.kind] ?? 'Scan')}</span><span class="rmeta">${esc(act === 'file' ? `${R.KIND_LABEL[x.kind] ?? ''} · ${x.source === 'share' ? 'shared in' : x.source ?? 'scan'} · ${ago(x.created_at)}` : `${x.filed?.where ?? ''} · ${x.filed?.by === 'wyn' ? AGENT.name : 'you'} · ${ago(x.filed?.at ?? x.updated_at)}`)}</span></span>${act === 'file' ? `<button class="btn sm" data-act="cap-file-waiting" data-id="${esc(x.id)}">File</button>` : x.filed?.undo && !x.filed.undone ? `<button class="btn sm" data-act="cap-undo-pc" data-id="${esc(x.id)}">Undo</button>` : ''}</div>`;
  pane.innerHTML = `<div class="cap-pane-body cap-files">
      <p class="cap-v-k">${I.sparkle}<span>Pick photos or screenshots. ${esc(AGENT.name)} reads them the way the camera does.</span></p>
      <div class="cap-fbtns">
        <button class="cap-fbtn" data-act="cap-pick-photos"><span class="tile">${G.photos}</span><b>Photos</b><small>Receipts, screenshots, pages</small></button>
        ${native.available ? `<button class="cap-fbtn" data-act="cap-doc"><span class="tile">${I.doc}</span><b>Document</b><small>Every page, with its text</small></button>
        <button class="cap-fbtn" data-act="cap-barcode"><span class="tile">${BARCODE}</span><b>Barcode</b><small>A book, by its ISBN</small></button>` : ''}
      </div>
      ${waiting.length ? `<p class="cap-lbl">Waiting to be filed</p><div class="group cap-flist">${waiting.map((x) => row(x, 'file')).join('')}</div>` : ''}
      ${filed.length ? `<p class="cap-lbl">Filed lately</p><div class="group cap-flist">${filed.map((x) => row(x, 'undo')).join('')}</div>` : ''}
      ${!waiting.length && !filed.length ? `<p class="cap-empty">Nothing scanned yet. What you scan or share shows here, with where it went.</p>` : ''}
      <div class="group cap-share-row"><button class="row ic" data-act="cap-sharein"><span class="tile">${I.share}</span><span class="rbody"><span class="rtitle">Share in from another app</span><span class="rmeta">Instagram, Safari, WhatsApp, GPay: Share › Agentic OS. ${esc(AGENT.name)} files it and tells you</span></span>${I.chevR}</button></div>
    </div>`;
  if (!L.filesSub) { L.filesSub = S.on('change', () => { if (alive() && L.mode === 'files') realFilesPane($('.cap-pane', L.el)); }); S.refresh?.(); }
  // the photos, fetched with this session (an <img> can't carry the iPhone's token); kept for the session
  $$('[data-img]', pane).forEach((t) => photoOf(t.dataset.img).then((u) => { if (u && t.isConnected) t.innerHTML = `<img src="${u}" alt="">`; }));
}
const photos = new Map();
function photoOf(url) {
  if (!photos.has(url)) photos.set(url, API.rawFetch(url).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null));
  return photos.get(url);
}
on('cap-file-waiting', (el) => {
  if (!alive()) return;
  const x = R.scans().get(el.dataset.id); if (!x) return;
  const q = R.live.get(x.id) ?? { id: x.id, thumb: null, state: 'ready', item: x, sid: L.sid, source: x.source };
  q.item = x; q.state = 'ready'; q.sid = L.sid; R.live.set(x.id, q);
  haptic(6); showRealCard(q);
});
on('cap-undo-pc', async (el) => {
  try { await R.undoItem(el.dataset.id); R.scans().refresh?.(); SYNC.refresh?.(true); toast('Undone'); }
  catch (e) { toast(e?.message ?? 'Couldn’t undo it'); }
});

// shared items that arrived while the app was closed: she filed what she could on the PC; the rest waits here
let waitingToldAt = 0;
async function tellWaiting() {
  if (!REAL) return;
  const S = R.scans();
  await S.ready;
  const fresh = S.list().filter((x) => x.source === 'share' && x.status === 'ready' && !x.filed && Date.parse(x.created_at) > Date.now() - 3 * 864e5);
  if (!fresh.length || Date.now() - waitingToldAt < 30 * 60000) return;
  waitingToldAt = Date.now();
  const text = fresh.length === 1 ? `You shared “${fresh[0].title}”. It’s ready to file.` : `${fresh.length} things you shared are ready to file.`;
  if (has('agentSay')) api.agentSay(text, { kind: 'nudge', app: 'capture', acts: [['See', () => openCapture('files')]] });
  else toast(text);
}

// ── shared helpers (Wyn, Work and Clients use these too) ─────────────
// A live recorder: red dot, a 36-bar scrolling wave, timer, cancel and stop. Stop → "Transcribing" → onDone(text).
export function recorder(slot, { say, onDone, onCancel }) {
  if (REAL) return realRecorder(slot, { onDone, onCancel });
  slot.hidden = false;
  slot.innerHTML = `<div class="rec-bar"><i class="rec-dot"></i><div class="wave">${'<i></i>'.repeat(36)}</div><span class="rec-t num">0:00</span>
    <button class="rec-x" aria-label="Cancel">${I.x}</button><button class="rec-stop" aria-label="Stop and transcribe"><i></i></button></div>`;
  slot.classList.add('on');
  const bars = $$('.wave i', slot);
  const lv = Array(36).fill(0.06);
  const t0 = performance.now();
  const iv = setInterval(() => {
    const t = (performance.now() - t0) / 1000;
    const speaking = Math.sin(t * 2.3) + Math.sin(t * 5.1) * 0.5 > -0.4;
    const env = speaking ? 0.35 + 0.65 * Math.abs(Math.sin(t * 7.3 + Math.sin(t * 3.1))) : 0.08;
    lv.shift(); lv.push(Math.max(0.06, Math.min(1, env * (0.55 + Math.random() * 0.45))));
    bars.forEach((b, i) => { b.style.transform = `scaleY(${lv[i]})`; });
  }, 80);
  const tv = setInterval(() => {
    const s = Math.floor((performance.now() - t0) / 1000);
    const el = $('.rec-t', slot); if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 250);
  const clear = () => { clearInterval(iv); clearInterval(tv); };
  const hide = () => { slot.classList.remove('on'); slot.hidden = true; slot.innerHTML = ''; };
  $('.rec-x', slot).addEventListener('click', (e) => { e.stopPropagation(); clear(); hide(); haptic(6); onCancel?.(); });
  $('.rec-stop', slot).addEventListener('click', (e) => {
    e.stopPropagation(); clear(); haptic(10);
    slot.innerHTML = `<div class="rec-bar tx"><span class="spin" style="--c:var(--ink-2)"></span><span>Transcribing</span></div>`;
    setTimeout(() => { hide(); onDone?.(say); }, 1100);
  });
  haptic(12);
  return { cancel: () => { clear(); hide(); } };
}

// The same API on the real recorder (app/work/recorder.js): it records into a hidden field, the PC writes it down
// (Codex), and onDone gets the text; cancel discards the take.
function realRecorder(slot, { onDone, onCancel }) {
  slot.hidden = false;
  const ta = document.createElement('textarea'); ta.hidden = true;
  slot.after(ta);
  let mod = null, done = false;
  const end = () => { if (done) return; done = true; ta.remove(); slot.hidden = true; slot.innerHTML = ''; };
  R.recorder().then((rec) => {
    mod = rec; rec.unlock?.();
    rec.start({ target: ta, slot, source: 'app',
      onState: (s) => { if (s === 'idle' && !done && !ta.value) { end(); onCancel?.(); } },
      onText: (text) => { const t = text || ta.value; end(); onDone?.(t); } });
  }).catch(() => { end(); toast('The recorder didn’t load'); onCancel?.(); });
  return { cancel: () => { mod?.cancel?.(); end(); } };
}

// Keep a sheet above the iOS keyboard: pin its bottom to the visual viewport.
export function liftWithKeyboard(el, gap = 8) {
  const vv = window.visualViewport;
  if (!vv) return () => {};
  const base = el.style.bottom;
  const f = () => {
    const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop);
    el.style.bottom = kb > 80 ? `${kb + gap}px` : base;
  };
  vv.addEventListener('resize', f); vv.addEventListener('scroll', f);
  return () => { vv.removeEventListener('resize', f); vv.removeEventListener('scroll', f); };
}

// Animate a sheet's height across a content change, so modes morph instead of jumping.
export function animateHeight(el, fn) {
  if (!el?.isConnected || matchMedia('(prefers-reduced-motion: reduce)').matches) { fn(); return; }
  const h0 = el.offsetHeight;
  fn();
  const h1 = el.offsetHeight;
  if (Math.abs(h1 - h0) < 2) return;
  el.animate([{ height: `${h0}px` }, { height: `${h1}px` }], { duration: 440, easing: 'cubic-bezier(.22,1,.36,1)' });
}

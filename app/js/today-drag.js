// Gestures on Today.
// · A tray task: hold it (380 ms) and it lifts, following the finger 1:1 from where it was grabbed; every free slot says
//   whether it fits; over a slot the time follows the finger in 15-minute steps; a drop places the task there (the card
//   flies into the slot), anything else sends it home.
// · A block on the timeline: hold it and drag to move it in 15-minute steps (a time tag shows where it lands); grab its
//   lower edge to stretch or shorten it instead. Let go without moving and it shows its quick menu (the peek).
// The page scrolls when the finger nears an edge. Haptics: a tick per 15-minute step, a thud on lift, success on land.
import { $, $$, haptic, toast, peek } from './core.js';
import { SPRINGS, Spring, tracker, reduced, springCurve } from './motion.js';
import { lenOf, snap, snapUp } from './today-data.js';
import { S, NOW, TODAY, task, hm, dur, blocksOn, nightOf, bed } from './today-state.js';
import { place } from './today-tasks.js';
import { moveBlock } from './today-events.js';

const HOLD = 380, SLOP = 8, EDGE = 90, BOTTOM = 150, STEP_PX = 16;   // 16 px of finger per 15 minutes on the spine

export function wireDrag(sc) {
  if (!sc || sc._drag) return; sc._drag = true;
  let hold = null, d = null, b = null, x0 = 0, y0 = 0, raf = 0;
  const stopHold = () => { clearTimeout(hold); hold = null; };

  sc.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || d || b) return;
    const pill = e.target.closest('.td-pill[data-id]');
    const row = e.target.closest('.td-blk.can-move');
    if ((!pill && !row) || e.target.closest('.check, .td-bact, .td-tag-c')) return;
    x0 = e.clientX; y0 = e.clientY;
    stopHold();
    if (pill) hold = setTimeout(() => { hold = null; startPill(pill, e); }, HOLD);
    else hold = setTimeout(() => { hold = null; startBlock(row, e); }, 420);
  });
  sc.addEventListener('pointermove', (e) => {
    if (hold && Math.hypot(e.clientX - x0, e.clientY - y0) > SLOP) stopHold();
    if (d) movePill(e);
    if (b) moveBlk(e);
  });
  const up = (e) => { stopHold(); if (d) endPill(e); if (b) endBlk(e); };
  addEventListener('pointerup', up);
  addEventListener('pointercancel', (e) => { stopHold(); if (d) endPill(e, true); if (b) endBlk(e, true); });
  // while something is lifted the page must not scroll under the finger
  addEventListener('touchmove', (e) => { if (d || b) e.preventDefault(); }, { passive: false });
  // a held tray task or block must not open its sheet on release
  sc.addEventListener('click', (e) => { if (sc._justDragged && e.target.closest('.td-pill, .td-blk')) { e.stopPropagation(); e.preventDefault(); } }, true);
  sc.addEventListener('contextmenu', (e) => { if (e.target.closest('.td-pill, .td-blk.can-move')) e.preventDefault(); });
  const eat = () => { sc._justDragged = true; setTimeout(() => { sc._justDragged = false; }, 80); };

  // ── the page scrolls near the top or the bottom (above the dock), faster the nearer the edge ──
  function tick() {
    if (!d && !b) return;
    const g = d ?? b;
    const r = sc.getBoundingClientRect();
    const top = r.top + EDGE, bot = r.bottom - BOTTOM;
    let v = 0;
    if (g.y < top) v = -Math.min(18, (top - g.y) / 4);
    else if (g.y > bot) v = Math.min(18, (g.y - bot) / 4);
    if (v) { const before = sc.scrollTop; sc.scrollTop += v; if (sc.scrollTop !== before) { if (d) movePill({ clientX: d.x, clientY: d.y }); else moveBlk({ clientX: b.x, clientY: b.y }); } }
    raf = requestAnimationFrame(tick);
  }

  // ── the tray: lift a task and drop it into a free slot ──
  function startPill(pill, e) {
    const id = pill.dataset.id, t = task(id); if (!t) return;
    const phone = $('#phone'), pr = phone.getBoundingClientRect(), r = pill.getBoundingClientRect();
    const ghost = pill.cloneNode(true);
    ghost.classList.add('td-ghost'); ghost.removeAttribute('data-id');
    Object.assign(ghost.style, { width: `${r.width}px`, height: `${r.height}px`, left: `${r.left - pr.left}px`, top: `${r.top - pr.top}px` });
    phone.append(ghost);
    pill.classList.add('lifted');
    sc.classList.add('td-dragging');
    const len = lenOf(t);
    // every free slot says up front whether this task fits it
    $$('.td-gap', sc).forEach((g) => {
      const gl = Number(g.dataset.end) - Number(g.dataset.start);
      const ok = gl >= len;
      g.classList.add(ok ? 'drop-ok' : 'drop-no');
      const fit = $('.td-gap-fit', g); if (fit) fit.textContent = ok ? `fits ${dur(len)}` : `needs ${dur(len)}`;
    });
    d = { id, t, len, pill, ghost, pr, gx: e.clientX - r.left, gy: e.clientY - r.top, x: e.clientX, y: e.clientY, over: null, at: null, home: { left: r.left - pr.left, top: r.top - pr.top } };
    haptic('medium');
    const lift = new Spring({ value: 1, spring: SPRINGS.lift, onUpdate: (v) => { ghost.style.scale = String(v); } });
    lift.set(1.04);
    raf = requestAnimationFrame(tick);
  }
  function movePill(e) {
    d.x = e.clientX; d.y = e.clientY;
    d.ghost.style.transform = `translate(${(e.clientX - d.pr.left - d.gx - d.home.left).toFixed(1)}px, ${(e.clientY - d.pr.top - d.gy - d.home.top).toFixed(1)}px)`;
    const under = document.elementFromPoint(e.clientX, e.clientY)?.closest('.td-gap');
    if (under !== d.over) {
      if (d.over) { d.over.classList.remove('drop-hover'); const f = $('.td-gap-fit', d.over); if (f) f.textContent = d.over.classList.contains('drop-ok') ? `fits ${dur(d.len)}` : `needs ${dur(d.len)}`; }
      d.over = under ?? null; d.at = null;
      if (d.over) { d.over.classList.add('drop-hover'); haptic(d.over.classList.contains('drop-ok') ? 'light' : 'selection'); }
    }
    // inside a slot that fits, the start follows the finger in 15-minute steps
    if (d.over?.classList.contains('drop-ok')) {
      const gs = Number(d.over.dataset.start), ge = Number(d.over.dataset.end);
      const r = d.over.getBoundingClientRect();
      const k = Math.min(1, Math.max(0, (e.clientY - r.top) / Math.max(1, r.height)));
      const lo = snapUp(gs), hi = Math.max(lo, Math.floor((ge - d.len) / 15) * 15);
      const at = Math.min(hi, Math.max(lo, snap(gs + k * (ge - gs) - d.len / 2)));
      if (at !== d.at) { if (d.at != null) haptic('selection'); d.at = at; const f = $('.td-gap-fit', d.over); if (f) f.textContent = `${hm(at)}–${hm(at + d.len)}`; }
    }
  }
  function endPill(e, cancelled = false) {
    cancelAnimationFrame(raf);
    const { id, t, len, ghost, pill, over, at } = d; d = null;
    eat();
    const clear = () => { $$('.td-gap', sc).forEach((g) => { g.classList.remove('drop-ok', 'drop-no', 'drop-hover'); const f = $('.td-gap-fit', g); if (f) f.textContent = ''; }); sc.classList.remove('td-dragging'); pill.classList.remove('lifted'); };
    if (!cancelled && over?.classList.contains('drop-ok')) {
      const start = at ?? snapUp(Number(over.dataset.start));
      const gr = over.getBoundingClientRect(), pr = $('#phone').getBoundingClientRect(), now = ghost.getBoundingClientRect();
      // the card flies into the slot, then the slot becomes the block
      const dx = gr.left - pr.left + 8 - (now.left - pr.left), dy = gr.top - pr.top + 4 - (now.top - pr.top);
      const base = ghost.style.transform || 'translate(0px, 0px)';
      const done = () => { ghost.remove(); clear(); place(id, start); haptic('success'); };
      if (reduced()) { done(); return; }
      const c = springCurve(SPRINGS.land);
      const a = ghost.animate([{ transform: base, opacity: 1 }, { transform: `${base} translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(.9)`, opacity: 0 }], { duration: Math.min(360, c.duration), easing: c.easing });
      a.onfinish = done;
      return;
    }
    if (!cancelled && over?.classList.contains('drop-no')) toast(`${t.title.split(':')[0].slice(0, 30)} needs ${dur(len)}; that slot has ${dur(Number(over.dataset.end) - Number(over.dataset.start))}`);
    // home: back along the way it came, on a spring
    const home = () => { ghost.remove(); clear(); };
    if (reduced()) { home(); return; }
    const c = springCurve(SPRINGS.drop);
    const a = ghost.animate([{ transform: ghost.style.transform || 'none', scale: ghost.style.scale || 1 }, { transform: 'translate(0, 0)', scale: 1 }], { duration: c.duration, easing: c.easing });
    a.onfinish = home;
  }

  // ── a block: hold to move, grab its lower edge to stretch ──
  function startBlock(row, e) {
    const blk = (row._blk ?? null) || findBlock(row);
    if (!blk) return;
    const r = row.getBoundingClientRect();
    const edge = e.clientY > r.top + Math.max(30, r.height * 0.68) && r.height > 40;
    b = { row, blk, mode: edge ? 'end' : 'move', y0: e.clientY, x: e.clientX, y: e.clientY, s: blk.start, e: blk.end, moved: false, scroll0: sc.scrollTop, tr: tracker() };
    row.classList.add('lifting', b.mode === 'end' ? 'resizing' : 'moving');
    sc.classList.add('td-moving');
    const tag = document.createElement('span');
    tag.className = 'td-tag-time num';
    row.append(tag);
    b.tag = tag;
    b.lift = new Spring({ value: 1, spring: SPRINGS.lift, onUpdate: (v) => { row.style.scale = String(v); } });
    b.lift.set(b.mode === 'move' ? 1.025 : 1);
    haptic('medium');
    label();
    raf = requestAnimationFrame(tick);
  }
  const limits = () => {
    const lo = b.blk.date === TODAY ? Math.floor(NOW / 15) * 15 : 0;
    const hi = b.blk.date === TODAY && !S.night ? Math.max(bed(TODAY), b.blk.end) : nightOf(b.blk.date).wake;
    return { lo, hi };
  };
  function label() {
    b.tag.textContent = b.mode === 'end' ? `Ends ${hm(b.e)} · ${dur(b.e - b.s)}` : `${hm(b.s)}–${hm(b.e)}`;
  }
  function moveBlk(e) {
    b.x = e.clientX; b.y = e.clientY; b.tr.add(e.clientX, e.clientY);
    const dy = e.clientY - b.y0 + (sc.scrollTop - b.scroll0);
    if (!b.moved && Math.abs(dy) > 4) b.moved = true;
    const steps = Math.round(dy / STEP_PX);
    const { lo, hi } = limits();
    let s = b.blk.start, en = b.blk.end;
    if (b.mode === 'move') { const len = en - s; s = Math.min(hi - len, Math.max(lo, b.blk.start + steps * 15)); en = s + len; b.row.style.transform = `translateY(${dy.toFixed(1)}px)`; }
    else { en = Math.min(hi, Math.max(s + 15, b.blk.end + steps * 15)); b.row.style.setProperty('--grow', `${Math.max(-b.row.offsetHeight + 40, dy).toFixed(1)}px`); }
    if (s !== b.s || en !== b.e) { b.s = s; b.e = en; haptic('selection'); label(); }
  }
  function endBlk(e, cancelled = false) {
    cancelAnimationFrame(raf);
    const g = b; b = null;
    eat();
    g.lift.set(1);
    g.tag.remove();
    sc.classList.remove('td-moving');
    const reset = () => { g.row.classList.remove('lifting', 'moving', 'resizing'); g.row.style.transform = ''; g.row.style.removeProperty('--grow'); };
    if (!cancelled && !g.moved) {
      // held, not moved: the block's quick menu
      reset();
      document.dispatchEvent(new CustomEvent('td-peek-block', { detail: { blk: g.blk } }));
      return;
    }
    if (cancelled || (g.s === g.blk.start && g.e === g.blk.end)) {
      if (reduced()) { reset(); return; }
      const c = springCurve(SPRINGS.drop);
      const a = g.row.animate([{ transform: g.row.style.transform || 'none' }, { transform: 'none' }], { duration: c.duration, easing: c.easing });
      a.onfinish = reset;
      return;
    }
    reset();
    S.landFrom = { id: g.blk.kind === 'task' ? g.blk.task : g.blk.id, top: g.row.getBoundingClientRect().top };
    moveBlock(g.blk, g.s, g.e, { start: g.blk.start, end: g.blk.end });
  }
  function findBlock(row) {
    const id = row.dataset.id; const date = sc.dataset.date ?? TODAY;
    return blocksOn(date, { night: S.night }).find((x) => x.id === id) ?? null;
  }
}

// for the screenshot steps: lift a task and hold it over the nth free slot, without a finger
export function demoLift(sc, id, gapIndex = 1) {
  const pill = $(`.td-pill[data-id="${id}"]`, sc); const gaps = $$('.td-gap', sc);
  if (!pill || !gaps[gapIndex]) return false;
  gaps[gapIndex].scrollIntoView({ block: 'center' });
  const r = pill.getBoundingClientRect(), g = gaps[gapIndex].getBoundingClientRect();
  const fire = (type, x, y) => pill.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 7, isPrimary: true }));
  fire('pointerdown', r.left + 40, r.top + 20);
  setTimeout(() => {
    const ev = (x, y) => sc.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerId: 7 }));
    ev(g.left + 120, g.top + g.height / 2);
  }, HOLD + 60);
  return true;
}
export { peek };

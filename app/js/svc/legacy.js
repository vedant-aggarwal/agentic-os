// svc/legacy: what the shipping app's pages (app/work, app/modules) need from its old shell, rebuilt for this one:
// their stylesheets scoped so they never restyle the new screens, the old sheet engine (springs and detents), and the
// old task row. aos.js puts these on window.AOS. Phase 2 areas that port a page off this layer stop needing it.
//
//   scopeCss(css, scope)   rewrite a stylesheet so every rule applies only inside `scope` (.aos-legacy)
//   legacyCss(href)        load one of the old stylesheets, scoped (once); ensureLegacyBase() loads the old design system
//   makeSheet(el, { detents, scrimFor })   the old sheet: open(detent) · snap() · close(velocity) · to(y) · hide()
//   rowHTML(t, grip, { project, still })   the old task row (Work's project pages use it)
const G = globalThis;
export const SCOPE = '.aos-legacy';
const KF_PREFIX = 'lg-';

// ── CSS scoping ───────────────────────────────────────────────────────
// A small CSS reader: comments out, rules and at-rules walked with their nesting, selectors split at top-level commas.
function splitTop(s, sep = ',') {
  const out = []; let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i] ?? ''; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
/** The first compound selector of a complex selector, and the rest (with its leading combinator). */
function firstCompound(sel) {
  let depth = 0, q = null;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~')) return [sel.slice(0, i), sel.slice(i)];
  }
  return [sel, ''];
}
export function scopeSelector(sel, scope = SCOPE) {
  const s = sel.trim();
  if (!s) return s;
  if (s.startsWith('#screen')) return s;                       // already the legacy layer's own
  const [head, rest] = firstCompound(s);
  if (/^(html|body)$/i.test(head) || head === ':root') return rest ? `${scope}${rest}` : scope;
  if (/^(html|body)(?=[.#:[])/i.test(head)) return `${head.replace(/^(html|body)/i, scope)}${rest}`;
  if (head.includes(':root') || /^html[.#:[]/i.test(head)) return `${head} ${scope}${rest}`;
  return `${scope} ${s}`;
}
/** Rewrite a stylesheet so it applies only inside `scope`. @keyframes get a prefix (and so do the animations that use them). */
export function scopeCss(text, scope = SCOPE) {
  const css = String(text).replace(/\/\*[\s\S]*?\*\//g, '');
  const imports = [];
  const frames = new Set();
  for (const m of css.matchAll(/@(?:-webkit-)?keyframes\s+([\w-]+)/g)) frames.add(m[1]);
  const renameAnim = (decls) => (frames.size ? decls.replace(/(animation(?:-name)?\s*:)([^;}]*)/g, (all, k, v) => k + v.replace(/[\w-]+/g, (w) => (frames.has(w) ? KF_PREFIX + w : w))) : decls);
  let i = 0;
  function block() {
    // reads rules until the matching } (or the end); returns the rewritten text
    let out = '';
    while (i < css.length) {
      while (i < css.length && /\s/.test(css[i])) i++;
      if (i >= css.length) break;
      if (css[i] === '}') { i++; break; }
      if (css[i] === '@') {
        const start = i;
        let q = null;
        while (i < css.length && (q || (css[i] !== '{' && css[i] !== ';'))) { const c = css[i]; if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; i++; }
        const prelude = css.slice(start, i).trim();
        if (css[i] === ';') { i++; if (/^@import/i.test(prelude)) imports.push(`${prelude};`); else if (!/^@charset/i.test(prelude)) out += `${prelude};`; continue; }
        i++; // {
        if (/^@(-webkit-)?keyframes/i.test(prelude)) {
          const name = prelude.replace(/^@(-webkit-)?keyframes\s+/i, '');
          out += `${prelude.replace(name, KF_PREFIX + name)}{${raw()}}`;
        } else if (/^@(font-face|property|page|counter-style|font-feature-values)/i.test(prelude)) {
          out += `${prelude}{${raw()}}`;
        } else {
          out += `${prelude}{${block()}}`;   // @media, @supports, @container, @layer, @scope …: their rules get scoped too
        }
        continue;
      }
      // a style rule
      const sStart = i;
      let q = null, depth = 0;
      while (i < css.length && (q || depth > 0 || css[i] !== '{')) { const c = css[i]; if (q) { if (c === '\\') i++; else if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; i++; }
      const selector = css.slice(sStart, i).trim();
      i++; // {
      const decls = raw();
      const scoped = /^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/.test(selector) ? selector : splitTop(selector).map((x) => scopeSelector(x, scope)).join(', ');
      out += `${scoped}{${renameAnim(decls)}}`;
    }
    return out;
  }
  // the declarations of a block, as they are (nested blocks included)
  function raw() {
    const start = i; let depth = 1, q = null;
    while (i < css.length) {
      const c = css[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
      i++;
    }
    const body = css.slice(start, i);
    i++;
    return body;
  }
  const body = block();
  return `${imports.join('\n')}\n${body}`;
}

const loaded = new Map();   // href → Promise
let base = null;
/** The old design system, scoped: tokens, components, both skins, and the screens the module pages draw from. */
export const LEGACY_BASE = ['ui/system.css', 'ui/skins/obsidian.css', 'ui/skins/matte.css', 'ui/screens/today.css', 'ui/screens/jobs.css', 'ui/screens/content.css', 'ui/screens/life.css', 'ui/screens/more.css', 'ui/screens/overlays.css', 'work/work.css'];
/** Load one old stylesheet, scoped to .aos-legacy. Resolves when it is in the page. */
export function legacyCss(href) {
  const key = String(href).replace(/^\.?\//, '');
  if (loaded.has(key)) return loaded.get(key);
  const p = (async () => {
    const holder = G.document.createElement('style');
    holder.dataset.legacy = key;
    // keep the cascade order: the base first, then module sheets in the order they were asked for
    G.document.head.appendChild(holder);
    try {
      const r = await G.fetch(key, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`${r.status}`);
      holder.textContent = scopeCss(await r.text());
    } catch (e) { console.warn('[legacy] stylesheet', key, e?.message ?? e); holder.remove(); }
  })();
  loaded.set(key, p);
  return p;
}
export function ensureLegacyBase() {
  base ??= Promise.all(LEGACY_BASE.map(legacyCss));
  return base;
}

// ── the old sheet engine (legacy-app/app.js:1296-1358, 1831-1845) ──────
const reduced = () => new URLSearchParams(G.location?.search ?? '').get('motion') === 'reduce' || G.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
/** Apple-style spring: response (s) + damping ratio; starts from the live value and carries velocity. */
export function animate({ from, to, velocity = 0, response = 0.4, damping = 1, epsilon = 0.3, onUpdate, onDone }) {
  if (reduced()) { onUpdate(to); onDone?.(); return { stop() {} }; }
  const k = (2 * Math.PI / response) ** 2;
  const c = (4 * Math.PI * damping) / response;
  let x = from, v = velocity, last = performance.now(), raf = 0, stopped = false;
  const step = (t) => {
    if (stopped) return;
    const dt = clamp((t - last) / 1000, 0, 0.064);
    last = t;
    if (dt > 0) { const n = Math.ceil(dt * 240), h = dt / n; for (let i = 0; i < n; i++) { v += (-k * (x - to) - c * v) * h; x += v * h; } }
    if (Math.abs(x - to) < epsilon && Math.abs(v) < epsilon * 10) { onUpdate(to); onDone?.(); return; }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { stop() { stopped = true; cancelAnimationFrame(raf); } };
}
const project = (v, d = 0.998) => ((v / 1000) * d) / (1 - d);
const rubber = (o, dim = 300, c = 0.55) => (o * dim * c) / (dim + c * Math.abs(o));
function tracker() {
  const pts = [];
  return {
    add(x, y, t) { pts.push({ x, y, t }); while (pts.length > 2 && t - pts[0].t > 100) pts.shift(); },
    v() { if (pts.length < 2) return { x: 0, y: 0 }; const a = pts[0], b = pts.at(-1), dt = (b.t - a.t) / 1000 || 1; return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt }; },
  };
}
/** #screen: the layer the old pages put their sheets on, over the new shell's pages and under its toast and peek. */
export function layer() {
  let el = G.document.getElementById('screen');
  if (!el) {
    el = G.document.createElement('div');
    el.id = 'screen';
    el.className = 'aos-legacy lg-layer';
    (G.document.getElementById('phone') ?? G.document.body).appendChild(el);
  }
  if (!el.querySelector(':scope > .lg-scrim')) {
    const s = G.document.createElement('div');
    s.className = 'scrim lg-scrim';
    s.addEventListener('click', () => topSheet()?.close());
    el.prepend(s);
  }
  return el;
}
const scrimEl = () => layer().querySelector(':scope > .lg-scrim');
// aos.js hands in what loads the modules' own stylesheets, so a sheet that opens first still gets them
let wake = () => {};
export const onSheetShow = (fn) => { wake = fn; };
const stack = [];
export const topSheet = () => stack.at(-1) ?? null;
export const sheetCount = () => stack.length;
export function makeSheet(el, { detents, scrimFor }) {
  const scrim = scrimEl();
  if (el.parentElement !== layer()) layer().appendChild(el);
  const s = { el, y: 0, isOpen: false, anim: null, detents };
  s.H = () => el.offsetHeight;
  s.set = (y) => {
    s.y = y;
    el.style.transform = `translate3d(0, ${y}px, 0)`;
    if (topSheet() === s || !stack.length) scrim.style.opacity = scrimFor(y, s.H());
  };
  s.to = (y, velocity = 0, done) => { s.anim?.stop(); s.anim = animate({ from: s.y, to: y, velocity, response: 0.42, damping: velocity ? 0.88 : 1, epsilon: 0.5, onUpdate: s.set, onDone: done }); };
  const show = () => {
    ensureLegacyBase();
    wake();
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    if (!stack.includes(s)) { stack.push(s); el.style.zIndex = 89 + stack.length; }
    scrim.classList.add('on');
    layer().classList.add('has-sheet');
  };
  s.open = (name) => {
    const fresh = !s.isOpen;
    if (fresh) { if (!s.anim) s.set(s.H() + 30); s.isOpen = true; }
    show();
    s.to(detents(s.H())[name] ?? 0);
  };
  s.snap = (y = 0) => {
    s.anim?.stop(); s.anim = null; s.isOpen = true; s.y = y;
    show();
    el.style.transform = `translate3d(0, ${y}px, 0)`;
    scrim.style.opacity = 1;
    if (!reduced()) { el.classList.add('pop'); scrim.classList.add('pop'); }
  };
  s.hide = () => {
    s.anim?.stop(); s.anim = null;
    el.classList.remove('open', 'pop');
    el.setAttribute('aria-hidden', 'true');
    if (!stack.length) { scrim.style.opacity = 0; layer().classList.remove('has-sheet'); }
  };
  s.close = (velocity = 0, { keep = false } = {}) => {
    s.isOpen = false;
    const i = stack.indexOf(s);
    if (i >= 0) stack.splice(i, 1);
    if (!stack.length) scrim.classList.remove('on', 'pop');
    s.to(s.H() + 30, velocity, () => { s.anim = null; if (!s.isOpen && !keep) s.hide(); });
  };
  // drag from the grabber or the head: follows the finger, settles on the nearest detent the throw points at
  for (const h of el.querySelectorAll('.grabber, .sheet-head')) {
    h.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || e.target.closest('button, input, textarea, select, a')) return;
      s.anim?.stop();
      const g = { id: e.pointerId, y0: e.clientY, start: s.y, tr: tracker() };
      g.tr.add(e.clientX, e.clientY, e.timeStamp);
      try { h.setPointerCapture(e.pointerId); } catch {}
      const move = (ev) => { if (ev.pointerId !== g.id) return; g.tr.add(ev.clientX, ev.clientY, ev.timeStamp); const raw = g.start + (ev.clientY - g.y0); s.set(raw < 0 ? -rubber(-raw, 200) : raw); };
      const up = (ev) => {
        if (ev.pointerId !== g.id) return;
        h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
        const v = g.tr.v().y, H = s.H(), closed = H + 30, proj = s.y + project(v);
        const target = [...Object.values(s.detents(H)), closed].reduce((a, b) => (Math.abs(b - proj) < Math.abs(a - proj) ? b : a));
        if (target === closed) s.close(v); else s.to(target, v);
      };
      h.addEventListener('pointermove', move); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
  }
  return s;
}

// ── the old task row (legacy-app/app.js:1398-1418) ─────────────────────
export const CHECK_SVG = '<svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg>';
export const CHEV = '<svg class="chev" viewBox="0 0 14 14"><path d="M5 2.5 9.5 7 5 11.5"/></svg>';
export const PLUS = '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>';
export const AGENT_GLYPH = '<svg class="ai-glyph" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="3"/><path d="m4.8 6.4 2 1.6-2 1.6M8.6 9.8h2.6"/></svg>';
export const AG_LABEL = { queued: 'Queued', running: 'Working', needs: 'Needs you', review: 'Ready to review', done: 'Done', failed: 'Stopped', offline: 'PC offline' };
export function rowHTMLWith(h) {
  // h: { esc, today, color, areaShort, dayLabel, dur, fmt, toMin, dateOfIso, daysBetween, weekday(date), projectName(slug) }
  return function rowHTML(t, grip = true, { project = false, still = false } = {}) {
    const { esc } = h;
    const done = t.status === 'done';
    const TODAY = h.today();
    const sd = t.scheduled ? h.dateOfIso(t.scheduled.start) : null;
    const lateN = !done && t.due && t.due < TODAY ? h.daysBetween(t.due, TODAY) : 0;
    const late = lateN ? `<span class="late">${lateN === 1 ? '1 day late' : `${lateN} days late`}</span>` : '';
    const due = !done && !lateN && t.due && t.due > TODAY ? `<span>Due ${h.weekday(t.due)}</span>` : '';
    const est = t.estimateMinutes ? `<span>${h.dur(t.estimateMinutes)}</span>` : '';
    const gripBtn = grip && !still ? `<button class="row-grip" aria-label="Plan ${esc(t.title)} in the next free gap, or drag to choose a time"><svg viewBox="0 0 16 16"><circle cx="5.5" cy="3.5" r="1.4"/><circle cx="10.5" cy="3.5" r="1.4"/><circle cx="5.5" cy="8" r="1.4"/><circle cx="10.5" cy="8" r="1.4"/><circle cx="5.5" cy="12.5" r="1.4"/><circle cx="10.5" cy="12.5" r="1.4"/></svg></button>` : '';
    const when = done
      ? `<span>Done${t.completedAt ? ` ${h.dayLabel(h.dateOfIso(t.completedAt))}` : ''}</span>`
      : t.status === 'doing' ? '<span class="now">In progress</span>' : sd ? `<span>${sd === TODAY ? h.fmt(h.toMin(t.scheduled.start, sd)) : `${h.dayLabel(sd)} ${h.fmt(h.toMin(t.scheduled.start, sd))}`}</span>` : '';
    const proj = project && t.project ? `<span class="t-p">${esc(h.projectName(t.project))}</span>` : '';
    const ag = t.agent && t.agent.state !== 'done' ? `<span class="ag-chip s-${t.agent.state}">Claude · ${AG_LABEL[t.agent.state]}</span>` : '';
    const lead = ag ? `<span class="ag-dot s-${t.agent.state} row-ag" aria-hidden="true">${AGENT_GLYPH}</span>`
      : still ? `<span class="check" aria-hidden="true"><i>${CHECK_SVG}</i></span>` : `<button class="check" aria-label="${done ? 'Mark not done' : 'Mark done'}"><i>${CHECK_SVG}</i></button>`;
    const areaPart = ag || `<span class="t-a"><i></i>${esc(t.status === 'inbox' && !t.area ? 'Inbox' : h.areaShort(t.area))}</span>`;
    const parts = [areaPart, done ? '' : late, ag ? '' : when, done ? '' : due, proj, done || sd || ag ? '' : est].filter(Boolean);
    return `<div class="row-wrap" data-id="${esc(t.id)}"><div class="row${done ? ' done' : ''}" style="--c:${h.color(t.area)}">${lead}<div class="row-text"><div class="row-title">${esc(t.title)}</div><div class="row-meta">${parts.join('<span class="t-sep" aria-hidden="true">·</span>')}</div></div>${ag ? '' : gripBtn}</div></div>`;
  };
}

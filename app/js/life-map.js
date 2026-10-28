// Life · Map: everything that feeds his life, as one living constellation (MOTION's graph.js). You at the centre, the nine
// aspects on the wheel's angles (sized and ringed by their score, hollow when nothing feeds them), and round them the real
// areas, goals, projects, people and open tasks, linked from the real data: area → aspect (life_area_aspects), goal →
// aspects, project → area, person → aspect. A thing in two places wears a full ring. Tap to focus (its links pulse), pinch
// and pan, filter, and drag an area (or a goal) onto an aspect to link it there: PUT /life/area-aspects, offline first.
// Owner: LIFE (v2). Prefix lf-.
import { $, $$, esc, toast, haptic as coreHaptic } from './core.js';
import { I } from './icons.js';
import { aspect, area, GOALS, TASKS, updateGoal } from './data.js';
import { aspectTile } from './aspects.js';
import { mountGraph } from './graph.js';
import { stagger, reduced } from './motion.js';
import { IDS, graphData, feeds, feedsOf, twoPlaces, aspectsOfArea, setAreaAspects, goalAspects, goalHasOwnAspects, scores, latest } from './life-data.js';

const KIND = { area: 'Area', project: 'Project', goal: 'Goal', person: 'Person', task: 'Task', aspect: 'Aspect', hub: 'You' };
const FILTERS = [['all', 'All'], ['area', 'Areas'], ['goal', 'Goals'], ['project', 'Projects'], ['person', 'People']];
const M = { filter: 'all', sel: null, graph: null, host: null, data: null, drag: null, tasks: false };
const gd = () => graphData({ filter: M.filter, tasks: M.tasks });
const andList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const nameOf = (id) => aspect(id)?.name ?? id;

// ── the screen ────────────────────────────────────────────────────────
export function mapView() {
  const list = feeds();
  const two = twoPlaces(list);
  const gaps = IDS.filter((id) => !feedsOf(id, list).length);
  const count = (k) => (k === 'all' ? list.length : list.filter((f) => f.kind === k).length);
  return `<div class="lf-stage" id="lfStage">
      <div class="lf-sky" aria-hidden="true"></div>
      <div class="lf-g" id="lfGraph"></div>
      <div class="lf-st-top">
        <div class="chips lf-map-f" role="group" aria-label="Show">${FILTERS.map(([k, l]) => `<button class="chip sm${M.filter === k ? ' on' : ''}" data-act="lf-map-f" data-k="${k}" aria-pressed="${M.filter === k}">${l} <span class="n">${count(k)}</span></button>`).join('')}</div>
      </div>
      <div class="lf-st-tools">
        <button class="lf-st-btn" data-act="lf-map-fit" aria-label="Fit the whole map">${I.target}</button>
        <button class="lf-st-btn${M.tasks ? ' on' : ''}" data-act="lf-map-tasks" aria-pressed="${M.tasks}" aria-label="Show open tasks">${I.check}</button>
      </div>
      <div class="lf-st-drop" id="lfDrop" aria-live="polite"></div>
      <div class="lf-st-card" id="lfMapCard">${cardHtml()}</div>
    </div>
    <div class="lf-map-after">
    <div class="sh lf-sh"><h2>In two places</h2><span class="sh-count">${two.length}</span></div>
    ${two.length ? `<div class="group">${two.slice(0, 8).map((f) => `<button class="row lf-two" data-act="lf-map-sel" data-k="${esc(f.id)}">${glyph(f)}<span class="rbody"><span class="rtitle">${esc(f.name)}</span><span class="rmeta">${f.feeds.map((id) => `<i class="dot" style="--c:var(--${id})"></i>${esc(nameOf(id))}`).join('<span class="lf-two-sep">·</span>')}</span></span>${I.chevR}</button>`).join('')}</div>`
      : `<p class="foot pad">Nothing sits in two places yet. Drag an area onto a second aspect to link it.</p>`}
    <div class="sh lf-sh"><h2>Gaps</h2><span class="sh-count">${gaps.length}</span></div>
    ${gaps.length ? `<div class="group">${gaps.map((id) => `<div class="row ic">${aspectTile(id)}<span class="rbody"><span class="rtitle">${esc(nameOf(id))}</span><span class="rmeta">No area, goal, project or person feeds it</span></span><button class="btn sm" data-act="lf-gap-goal" data-id="${id}">${I.plus}Goal</button></div>`).join('')}</div>`
      : `<p class="foot pad">Every part of your life has something feeding it.</p>`}
    </div>`;
}

function glyph(f) {
  if (f.kind === 'person') return `<span class="lf-th-g mono" style="--c:var(--${f.feeds[0] ?? 'ink-3'})">${esc(f.name[0])}</span>`;
  if (f.kind === 'goal') return `<span class="lf-th-g gl" style="--c:var(--${f.feeds[0] ?? 'mission'})"><i></i></span>`;
  if (f.kind === 'project') return `<span class="lf-th-g pj" style="--c:${f.color ?? 'var(--ink-3)'}">${esc((f.name ?? '?')[0])}</span>`;
  if (f.kind === 'task') return `<span class="lf-th-g tk" style="--c:var(--${f.group ?? 'ink-3'})"><i></i></span>`;
  return `<span class="lf-th-g ar" style="--c:${f.color ?? 'var(--ink-3)'}"><i></i></span>`;
}

// the card at the foot of the map: what you tapped, where it sits, the way in (or, with nothing tapped, what the map says)
function cardHtml() {
  const sel = M.sel;
  const list = M.data?.feeds ?? feeds();
  if (!sel) {
    const two = twoPlaces(list), gaps = IDS.filter((id) => !feedsOf(id, list).length);
    return `<div class="lf-mc-hint">
      ${two.length ? `<button class="lf-pill" data-act="lf-map-two">${I.link}<b>${two.length}</b> in two places</button>` : ''}
      ${gaps.length ? `<button class="lf-pill" data-act="lf-map-gaps">${I.flag}${esc(andList(gaps.map(nameOf)))} ${gaps.length === 1 ? 'has' : 'have'} nothing</button>` : ''}
      <span class="lf-mc-tip">Tap to trace · drag an area onto an aspect to link it</span>
    </div>`;
  }
  const close = `<button class="lf-mcard-x" data-act="lf-map-clear" aria-label="Clear">${I.x}</button>`;
  if (sel === 'me') return `<div class="lf-mcard"><span class="tile lf-brain-t">${I.graph}</span><span class="lf-mcard-b"><span class="lf-mcard-t">You, at the centre</span><span class="lf-mcard-s">Your Brain links all nine</span></span><button class="btn sm" data-act="lf-brain">Brain</button>${close}</div>`;
  if (sel.startsWith('a:')) {
    const id = sel.slice(2); const fs = feedsOf(id, list); const s = scores()[id]; const l = latest();
    const by = fs.slice(0, 3).map((f) => f.name);
    return `<div class="lf-mcard two">
      <div class="lf-mcard-row">${aspectTile(id)}<span class="lf-mcard-b"><span class="lf-mcard-t">${esc(nameOf(id))}${s != null ? ` <span class="lf-mcard-sc met">${s}</span>` : ''}</span>
        <span class="lf-mcard-s">${fs.length ? `Fed by ${esc(andList(by))}${fs.length > 3 ? ` and ${fs.length - 3} more` : ''}` : 'Nothing feeds it yet'}</span></span>${close}</div>
      <div class="lf-mcard-acts"><button class="btn sm primary" data-act="aspect-open" data-id="${id}">Open ${esc(nameOf(id))}${I.chevR}</button>${fs.length ? '' : `<button class="btn sm" data-act="lf-gap-goal" data-id="${id}">${I.plus}Goal</button>`}
        ${s != null && l ? `<span class="lf-mcard-note">${s} of 10 on ${esc(l.label)}</span>` : ''}</div>
    </div>`;
  }
  const f = list.find((x) => x.id === sel) ?? taskFeed(sel);
  if (!f) return '';
  const open = { goal: ['lf-open-goal', 'Goal'], project: ['lf-open-project', 'Project'], person: ['lf-open-person', 'File'], task: ['lf-open-task', 'Task'] }[f.kind];
  const editable = f.kind === 'area' || f.kind === 'goal';
  const chips = f.feeds.map((id) => `<span class="lf-asp-chip" style="--c:var(--${id})"><button class="lf-asp-go" data-act="aspect-open" data-id="${id}"><i class="dot"></i>${esc(nameOf(id))}</button>${editable && (f.kind === 'area' || f.feeds.length > 1) ? `<button class="lf-asp-x" data-act="lf-unlink" data-k="${esc(f.id)}" data-a="${id}" aria-label="Unlink ${esc(f.name)} from ${esc(nameOf(id))}">${I.x}</button>` : ''}</span>`).join('');
  const sub = f.kind === 'task' ? `Task · in ${esc(f.hostName ?? '')}`
    : f.kind === 'project' ? (f.area ? `Project · in ${esc(area(f.area).name)}` : 'Project · no area yet')
    : f.kind === 'goal' ? `Goal${f.verdict ? ` · ${esc(f.verdict)}` : ''}${!f.own && f.area ? ` · through ${esc(area(f.area).name)}` : ''}`
    : `${KIND[f.kind]}${f.feeds.length > 1 ? ' · sits in two places' : ''}`;
  return `<div class="lf-mcard two">
    <div class="lf-mcard-row">${glyph(f)}<span class="lf-mcard-b"><span class="lf-mcard-t">${esc(f.name)}</span><span class="lf-mcard-s">${sub}</span></span>${close}</div>
    <div class="lf-mcard-acts">${chips || '<span class="lf-mcard-note">Feeds nothing yet</span>'}${open ? `<button class="btn sm" data-act="${open[0]}" data-id="${esc(f.ref)}">${open[1]}${I.chevR}</button>` : ''}</div>
    ${editable ? `<p class="lf-mcard-tip">Drag ${f.kind === 'area' ? 'it' : 'the goal'} onto another aspect to link it there too.</p>` : ''}
  </div>`;
}
function taskFeed(id) {
  if (!id.startsWith('t:')) return null;
  const t = TASKS.find((x) => String(x.id) === id.slice(2)); if (!t) return null;
  const host = M.data?.links?.find((l) => Array.isArray(l) && l[1] === id)?.[0];
  const hostName = host ? (M.data.nodes.find((n) => n.id === host)?.label ?? '') : '';
  return { id, kind: 'task', ref: t.id, name: t.title, feeds: t.aspect ? [t.aspect] : [], group: t.aspect, hostName };
}
const decorate = (list) => { for (const f of list) if (f.kind === 'goal') f.verdict = GOALS.find((g) => String(g.id) === String(f.ref))?.verdict; return list; };

// ── mount, update, tear down ──────────────────────────────────────────
export function mountMap(root, { immerse = false } = {}) {
  const host = $('#lfGraph', root); if (!host) return;
  if (M.graph && M.host !== host) { M.graph.destroy(); M.graph = null; }
  M.host = host;
  M.data = gd(); decorate(M.data.feeds);
  sizeStage(root, { immerse });
  M.graph = mountGraph(host, { nodes: M.data.nodes, links: M.data.links, capture: 'all', label: 'Life map', padding: 48, minZoom: 0.35, maxZoom: 4,
    onTap: (n) => select(n ? n.id : null, { fromGraph: true }) });
  wireDrag(host);
  if (M.sel) requestAnimationFrame(() => M.graph?.focus(M.sel, { pulse: false, silent: true }));
  if (!reduced()) stagger($$('.lf-st-top .chip, .lf-st-btn, .lf-st-card > *', root), { y: 8, each: 34, delay: 380 });
}
const sig = (d) => `${d.nodes.map((n) => `${n.id}${n.size ?? ''}${n.ring ?? ''}${n.hollow ? 'h' : ''}${n.label}`).join('|')}#${d.links.map((l) => (Array.isArray(l) ? l.join('>') : `${l.source}>${l.target}`)).join('|')}`;
export function refreshMap(root, { reheat = 0.35 } = {}) {
  if (!M.graph || !root?.contains(M.host)) return;
  const next = gd(); decorate(next.feeds);
  const same = M.data && sig(next) === sig(M.data);
  M.data = next;
  if (same) { paintCard(root); return; }
  if (M.sel && !M.data.nodes.some((n) => n.id === M.sel)) M.sel = null;
  M.graph.update({ nodes: M.data.nodes, links: M.data.links }, { reheat });
  paintCard(root);
}
export function unmountMap() { M.graph?.destroy(); M.graph = null; M.host = null; }
export const mapState = M;

// the stage fills the screen between the Wheel/Map switch (scrolled up under the top bar) and the dock; `immerse`
// scrolls there, so the map opens as one full screen with the lists below it
function sizeStage(root, { immerse = false } = {}) {
  const st = $('#lfStage', root); const sc = st?.closest('.scroll'); if (!st || !sc) return;
  const bar = $('.topbar', root)?.getBoundingClientRect().bottom ?? 0;
  const seg = $('.lf-segwrap', root)?.getBoundingClientRect();
  const dockTop = document.querySelector('.dock')?.getBoundingClientRect().top ?? (innerHeight - 90);
  const shift = seg ? seg.top - bar - 2 : 0;                  // how far the page scrolls to bring the switch under the bar
  const top = st.getBoundingClientRect().top - shift;
  st.style.height = `${Math.round(Math.max(380, Math.min(900, dockTop - 10 - top)))}px`;
  if (immerse && Math.abs(shift) > 2) sc.scrollBy({ top: shift, behavior: 'instant' });
}
function paintCard(root) {
  const c = $('#lfMapCard', root); if (!c) return;
  c.innerHTML = cardHtml();
  c.classList.toggle('on', !!M.sel);
}
export function select(id, { fromGraph = false, scroll = false } = {}) {
  const root = M.host?.closest('.lf-page');
  M.sel = id && id === M.sel && !fromGraph ? null : id;
  if (!fromGraph && M.graph) { if (M.sel) M.graph.focus(M.sel); else M.graph.focus(null); }
  coreHaptic(5);
  if (root) {
    paintCard(root);
    if (scroll) { const st = $('#lfStage', root); const sc = st?.closest('.scroll'); if (st && sc) sc.scrollTo({ top: st.offsetTop - (parseFloat(getComputedStyle(sc).paddingTop) || 0) - 6, behavior: reduced() ? 'auto' : 'smooth' }); }
  }
}
export function setFilter(k, root) {
  M.filter = k; M.sel = null;
  $$('.lf-map-f .chip', root).forEach((b) => { const on = b.dataset.k === k; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  M.graph?.focus(null);
  refreshMap(root, { reheat: 0.6 });
  // frame it once the new layout has mostly settled (the leaving nodes fade first)
  clearTimeout(M.fitT); M.fitT = setTimeout(() => M.graph?.zoomTo('fit'), 420);
}
export function highlightTwo(root) {
  const two = twoPlaces(M.data?.feeds ?? feeds());
  const ids = new Set(two.map((f) => f.id)); for (const f of two) f.feeds.forEach((a) => ids.add(`a:${a}`));
  M.sel = null; paintCard(root); M.graph?.highlight([...ids]); M.graph?.zoomTo({ ids: [...ids] });
}
export function highlightGaps(root) {
  const list = M.data?.feeds ?? feeds();
  const ids = IDS.filter((id) => !feedsOf(id, list).length).map((id) => `a:${id}`);
  M.sel = null; paintCard(root); M.graph?.highlight(['me', ...ids]);
}

// ── link and unlink ───────────────────────────────────────────────────
// an area: the area → aspect map. A goal: its own aspects (it stops following its area's).
function link(key, aspectId) {
  if (key.startsWith('r:')) {
    const slug = key.slice(2); const was = aspectsOfArea(slug);
    if (was.includes(aspectId)) return { same: true, name: area(slug).name };
    setAreaAspects(slug, [...was, aspectId]);
    return { name: area(slug).name, undo: () => setAreaAspects(slug, was) };
  }
  if (key.startsWith('g:')) {
    const g = GOALS.find((x) => `g:${x.id}` === key); if (!g) return null;
    const was = goalAspects(g); const own = goalHasOwnAspects(g);
    if (was.includes(aspectId)) return { same: true, name: g.title };
    updateGoal(g.id, { aspects: [...was, aspectId] });
    return { name: g.title, undo: () => updateGoal(g.id, { aspects: own ? was : null }) };
  }
  return null;
}
function unlink(key, aspectId) {
  if (key.startsWith('r:')) { const slug = key.slice(2); const was = aspectsOfArea(slug); setAreaAspects(slug, was.filter((a) => a !== aspectId)); return { name: area(slug).name, undo: () => setAreaAspects(slug, was) }; }
  if (key.startsWith('g:')) {
    const g = GOALS.find((x) => `g:${x.id}` === key); if (!g) return null;
    const was = goalAspects(g); const own = goalHasOwnAspects(g); const next = was.filter((a) => a !== aspectId);
    updateGoal(g.id, { aspects: next.length ? next : null });
    return { name: g.title, undo: () => updateGoal(g.id, { aspects: own ? was : null }) };
  }
  return null;
}
export function doUnlink(key, aspectId, root) {
  const r = unlink(key, aspectId); if (!r) return;
  coreHaptic(8);
  refreshMap(root);
  toast(`${short(r.name)} no longer feeds ${nameOf(aspectId)}`, () => { r.undo(); refreshMap(root); });
}
const short = (s) => (s.length > 28 ? `${s.slice(0, 26).trim()}…` : s);

// ── drag a thing onto an aspect ───────────────────────────────────────
// graph.js already lets a node be dragged; this watches where it goes. World positions only move for the node under
// the finger (a pan moves the camera, not the world), so the one that moved most is the one being carried.
function wireDrag(host) {
  const cv = host.querySelector('canvas'); if (!cv || cv._lfDrag) return; cv._lfDrag = true;
  const drop = () => $('#lfDrop', host.closest('.lf-stage'));
  let down = null, raf = 0;
  const near = (pos, key) => {
    const p = pos[key]; if (!p) return null;
    let best = null, bd = 46;
    for (const id of IDS) { const q = pos[`a:${id}`]; if (!q) continue; const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = id; } }
    return best;
  };
  const watch = () => {
    raf = 0; if (!down || !M.graph) return;
    const pos = M.graph.positions();
    let key = M.drag?.key ?? null;
    if (!key) {
      let best = null, bd = 10;
      for (const [id, p] of Object.entries(pos)) { if (!/^[rg]:/.test(id)) continue; const o = down.pos[id]; if (!o) continue; const d = Math.hypot(p[0] - o[0], p[1] - o[1]); if (d > bd) { bd = d; best = id; } }
      if (!best) return;
      key = best; M.drag = { key, target: null };
    }
    const t = near(pos, key);
    if (t !== M.drag.target) {
      M.drag.target = t;
      const node = M.data.nodes.find((n) => n.id === key);
      const linked = t && (M.data.feeds.find((f) => f.id === key)?.feeds ?? []).includes(t);
      M.graph.highlight(t ? [key, `a:${t}`] : [key]);
      const d = drop();
      if (d) { d.innerHTML = t ? `${linked ? I.check : I.link}<span>${linked ? `${esc(short(node?.label ?? ''))} already feeds ${esc(nameOf(t))}` : `Link to <b>${esc(nameOf(t))}</b>`}</span>` : `${I.link}<span>Drop on an aspect</span>`; d.classList.add('on'); d.style.setProperty('--c', t ? `var(--${t})` : 'var(--ink-3)'); }
      if (t) coreHaptic(6);
    }
  };
  cv.addEventListener('pointerdown', (e) => { if (e.button > 0 || !M.graph) return; down = { pos: M.graph.positions(), id: e.pointerId }; M.drag = null; });
  cv.addEventListener('pointermove', () => { if (down && !raf) raf = requestAnimationFrame(watch); });
  const end = (e) => {
    if (!down || e.pointerId !== down.id) return;
    cancelAnimationFrame(raf); raf = 0;
    const d = M.drag; down = null; M.drag = null;
    drop()?.classList.remove('on');
    if (!d) return;
    const root = host.closest('.lf-page');
    M.graph?.highlight(null);
    if (!d.target || e.type === 'pointercancel') return;
    const r = link(d.key, d.target);
    if (!r) return;
    if (r.same) { toast(`${short(r.name)} already feeds ${nameOf(d.target)}`); return; }
    coreHaptic(12);
    M.sel = d.key;
    refreshMap(root, { reheat: 0.5 });
    requestAnimationFrame(() => M.graph?.focus(d.key, { zoom: false }));
    toast(`${short(r.name)} now feeds ${nameOf(d.target)}`, () => { r.undo(); refreshMap(root); });
  };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
}

export const mapSummary = () => { const list = feeds(); return { two: twoPlaces(list).length, gaps: IDS.filter((id) => !feedsOf(id, list).length) }; };
// console and the screenshot tools: the live map
globalThis.__lifeMap = { get graph() { return M.graph; }, select, state: M, refresh: () => refreshMap(M.host?.closest('.lf-page')) };

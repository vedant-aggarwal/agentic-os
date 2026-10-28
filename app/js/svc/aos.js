// svc/aos: window.AOS, the host the shipping app's Work code (app/work) and its 13 module pages (app/modules) were
// written against (legacy-app/app.js:2440-2476, app/MODULES.md), mapped onto this shell. Their pages open as pushed
// pages, their sheets on the #screen layer, their CSS scoped to .aos-legacy so the new screens stay as they are.
//
// Beyond the old host:
//   AOS.openClassic('jobs' | 'content' | 'clients')   the shipping app's tab, as a pushed page (for reference and porting)
//   AOS.mods() → the registered modules · AOS.figureOf(id) → { value, label } | null   (More draws its rows from these)
//   AOS.renderCards(slot, host, m)                     mount the modules' Today ('todayTop') or Life ('life') cards
//   loadLegacy()                                       import app/work, then app/modules (after the first paint)
import { $, $$, esc, push, pop, toast, setTab as shellSetTab, currentTab, visiblePage } from '../core.js';
import { api as bus } from '../bus.js';
import * as API from './api.js';
import * as SYNC from './sync.js';
import * as clock from './clock.js';
import { haptic, NATIVE } from './native.js';
import * as L from './legacy.js';
import * as UI from '../../ui/ui.js';
import * as data from '../data.js';

const G = globalThis;
const SY = SYNC.state;

// ── helpers the old pages call ────────────────────────────────────────
const clip = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1).trimEnd()}…` : String(t));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const areaRec = (slug) => (slug ? SY.boot?.areas?.find((a) => a.slug === slug) ?? null : null);
const color = (slug) => areaRec(slug)?.color ?? '#8e8e93';
const areaName = (slug) => areaRec(slug)?.name ?? 'No area';
const areaShort = (slug) => (areaRec(slug) ? areaRec(slug).name.replace(/\s*\+.*$/, '') : 'No area');
const AREAS = new Map();
const refreshAreas = () => { AREAS.clear(); for (const a of SY.boot?.areas ?? []) AREAS.set(a.slug, a); };
const RECENT_KEY = 'agentos-app:recent-projects';
const recentProjects = () => API.ls.json(RECENT_KEY) ?? [];
function touchProject(slug) { if (slug) API.ls.set(RECENT_KEY, JSON.stringify([slug, ...recentProjects().filter((x) => x !== slug)].slice(0, 20))); }
const liveProjects = () => {
  const rec = recentProjects();
  const rank = (p) => { const i = rec.indexOf(p.slug); return i < 0 ? 999 : i; };
  return (SY.data?.projects ?? []).filter((p) => !['done', 'archived', 'dropped'].includes(p.status))
    .sort((a, b) => rank(a) - rank(b) || (a.sort ?? 1e9) - (b.sort ?? 1e9) || String(a.name).localeCompare(String(b.name)));
};
const projGlyph = (p) => (p.icon ? `<span class="pj-ico">${esc(p.icon)}</span>` : `<i style="--c:${p.color || color(p.area)}"></i>`);
const areaChips = (selected, { none = false } = {}) => [...AREAS.values()]
  .map((a) => `<button class="chip-btn${a.slug === selected ? ' on' : ''}" data-area="${a.slug}" style="--c:${a.color}"><i></i>${esc(areaShort(a.slug))}</button>`).join('')
  + (none ? `<button class="chip-btn${!selected ? ' on' : ''}" data-area="">None</button>` : '');
const rowHTML = L.rowHTMLWith({
  esc, today: () => clock.today(), color, areaShort, dayLabel: clock.dayLabel, dur: clock.dur, fmt: clock.hm, toMin: clock.toMin,
  dateOfIso: clock.dateOfIso, daysBetween: clock.daysBetween, weekday: (d) => clock.WEEKDAYS[clock.dparts(d).dow].slice(0, 3),
  projectName: (slug) => SY.data?.projects.find((p) => p.slug === slug)?.name ?? slug,
});
const rerender = (why = 'render') => G.document.dispatchEvent(new CustomEvent('data-changed', { detail: { why } }));

// ── pushed pages for the old shell's details, module pages and tabs ───
const DETAILS = new Map();   // kind → { render(box, id, el), once? }   (app/work registers job, project, code, term …)
const TABS = new Map();      // name → render(el, page)                 (app/work/tab.js draws the old Jobs tab)
const TAB_DEFS = new Map();  // name → { render(el, page), onShow? }    (crm fills Clients, content fills Content)
const MODS = new Map();
const backLabel = () => { const top = $('#stack')?.lastElementChild; if (top) return top._opts?.title || $('.tb-title', top)?.textContent?.trim() || 'Back'; return ({ today: 'Today', life: 'Life', jobs: 'Work', content: 'Content', agent: data.AGENT.name, clients: 'Clients', more: 'More' })[currentTab()] ?? 'Back'; };
// The shell's own classes on a pushed page; any other class old code puts on its page is mirrored inside .aos-legacy,
// so the old stylesheets' page-level rules (.cl-page .cl-hero …) still find it.
const SHELL_CLASSES = new Set(['page', 'lg-page', 'in', 'scrolled', 'asp', 'tasks-page', 'mo-page']);
/**
 * Push one of the old pages: render(box, page) fills a .detail-content box inside .aos-legacy; the page carries
 * data-kind and data-id, a .navbar header with a .nav-title and a right-hand span (old code fills both), and a
 * .scroller (old code keeps its scroll position through it).
 */
function pushLegacy({ kind, id = '', title = '', render, onPop }) {
  L.ensureLegacyBase();
  wakeCss();
  const page = push({
    title, back: backLabel(), cls: 'lg-page',
    render(sc, pg) {
      pg.dataset.kind = kind; pg.dataset.id = id;
      const bar = $('.topbar', pg);
      bar.classList.add('navbar');
      $('.tb-title', bar)?.classList.add('nav-title');
      const right = $('.tb-right', bar);
      if (right) { const span = G.document.createElement('span'); span.className = 'tb-right aos-legacy'; span.innerHTML = right.innerHTML; right.replaceWith(span); }
      new MutationObserver(() => { const last = bar.lastElementChild; if (last && !last.classList.contains('aos-legacy')) last.classList.add('aos-legacy', 'tb-right'); }).observe(bar, { childList: true });
      sc.classList.add('lg-scroll', 'scroller');
      sc.innerHTML = '<div class="aos-legacy lg-root"><div class="lg-mirror"><div class="tab-content detail-content"></div></div></div>';
      const mirror = $('.lg-mirror', sc);
      const syncClasses = () => { mirror.className = ['lg-mirror', ...[...pg.classList].filter((c) => !SHELL_CLASSES.has(c))].join(' '); };
      new MutationObserver(syncClasses).observe(pg, { attributes: true, attributeFilter: ['class'] });
      try { render($('.detail-content', sc), pg); } catch (e) { console.warn(`[aos] ${kind} page`, e); $('.detail-content', sc).innerHTML = '<p class="empty-line">This page couldn’t open.</p>'; }
      syncClasses();
    },
    onPop,
  });
  return page;
}
const legacyPages = () => $$('#stack > .page.lg-page');
function openDetail(kind, id) {
  const d = DETAILS.get(kind);
  if (!d) { console.warn(`[aos] no page kind "${kind}"`); return null; }
  return pushLegacy({ kind, id, render: (box, pg) => d.render(box, id, pg) });
}
function openModPage(id) {
  const m = MODS.get(id);
  if (!m) { console.warn(`[aos] no module "${id}"`); toast('That module isn’t on this phone yet'); return; }
  if (m.tab) { openClassic(m.tab); return; }
  const top = $('#stack')?.lastElementChild;
  if (top?.dataset.kind === 'mod' && top.dataset.id === id) return;
  pushLegacy({ kind: 'mod', id, title: m.title, render(box) { box.classList.add('mod-page'); box.dataset.mod = id; m.page(box); } });
}
const CLASSIC = { jobs: 'Jobs', content: 'Content', clients: 'Clients' };
// the old tabs' element ids, which their code looks up (crm.js draws into #clientsContent, its buttons into #clientsActs)
const CLASSIC_IDS = { jobs: ['pageJobs', 'jobsContent', 'jobsActs'], content: ['pageContent', 'contentContent', 'contentActs'], clients: ['pageClients', 'clientsContent', 'clientsActs'] };
/** The shipping app's tab as a pushed page: Jobs (app/work/tab.js), Content and Clients (their modules). */
function openClassic(name) {
  const fn = TABS.get(name), def = TAB_DEFS.get(name);
  if (!fn && !def) { toast(`${CLASSIC[name] ?? name} isn’t loaded yet`); return; }
  const top = $('#stack')?.lastElementChild;
  if (top?.dataset.kind === 'classic' && top.dataset.id === name) return;
  for (const id of CLASSIC_IDS[name] ?? []) G.document.getElementById(id)?.removeAttribute('id');
  pushLegacy({
    kind: 'classic', id: name, title: CLASSIC[name] ?? name,
    render(box, pg) {
      const [pageId, boxId, actsId] = CLASSIC_IDS[name] ?? [];
      if (pageId) pg.id = pageId;
      if (boxId) box.id = boxId;
      if (actsId) $('.tb-right', pg)?.insertAdjacentHTML('afterbegin', `<span class="nav-acts aos-legacy" id="${actsId}"></span>`);
      box.classList.add('tab-body');
      if (def) { box.classList.add('mod-page'); def.render(box, pg); } else fn(box, pg);
    },
  });
}
/** Old code asks for a tab to redraw (a module's figure changed, the Jobs list moved). */
function renderTab(name) {
  if (name === 'more') { G.document.dispatchEvent(new CustomEvent('aos-more')); return; }
  for (const pg of legacyPages()) if (pg.dataset.kind === 'classic' && pg.dataset.id === name) {
    const box = $('.detail-content', pg);
    const fn = TABS.get(name);
    if (fn && box) { try { fn(box, pg); } catch (e) { console.warn(`[aos] tab ${name}`, e); } }
  }
}
// The old tab names, in this shell: Today · Life · Work (jobs) · Content · Agent, Clients and More behind them.
function setTabCompat(tab) {
  const go = (id) => { if (currentTab() !== id) shellSetTab(id); };
  switch (tab) {
    case 'today': return go('today');
    case 'tasks': go('today'); return bus.openTasks();
    case 'life': case 'goals': return go('life');
    case 'jobs': case 'projects': case 'ideas': case 'code': { if (currentTab() !== 'jobs') shellSetTab('jobs'); return; }
    case 'clients': return go('clients');
    case 'content': return go('content');
    case 'more': return bus.openMore();
    default: return go(tab);
  }
}
// What old code reads off ui(): the tab, a stack per tab (the pushed pages), the Jobs segment.
const uiCompat = { jobsSeg: 'board', todayPane: 'schedule', view: 'day', taskList: 'today' };
Object.defineProperty(uiCompat, 'tab', { get: () => currentTab() ?? 'today', enumerable: true });
Object.defineProperty(uiCompat, 'stack', { get: () => { const s = $$('#stack > .page'); return new Proxy({}, { get: () => s }); }, enumerable: true });

// ── modules ───────────────────────────────────────────────────────────
function registerMod(mod) {
  if (!mod || typeof mod.id !== 'string' || !/^[a-z0-9-]+$/.test(mod.id) || typeof mod.page !== 'function') throw new Error('AOS.register needs { id: "kebab-case", title, page(el) }');
  const m = { order: 100, ...mod, title: String(mod.title ?? mod.id) };
  if (m.tab && !CLASSIC[m.tab]) { console.warn(`[mod:${m.id}] there is no "${m.tab}" tab; it opens from More`); delete m.tab; }
  MODS.set(m.id, m);
  if (m.tab) TAB_DEFS.set(m.tab, { render: (el) => { el.dataset.mod = m.id; m.page(el); }, onShow: m.onShow ? (el) => m.onShow(el) : undefined });
  G.document.dispatchEvent(new CustomEvent('aos-more'));
  return mod;
}
const sortedMods = () => [...MODS.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));
function figureOf(id) {
  const m = MODS.get(id);
  try { const f = m?.figure?.(); return f && ((f.value != null && f.value !== '') || f.label) ? f : null; } catch (e) { console.warn(`[mod:${id}] figure`, e); return null; }
}
/** Mount every module's card for a slot into host (one child per module, kept across renders). */
function renderCards(slot, host, m) {
  if (!host) return;
  host.classList.add('aos-legacy');
  L.ensureLegacyBase();
  for (const mod of sortedMods()) {
    const fn = mod.cards?.[slot];
    if (typeof fn !== 'function') continue;
    let el = host.querySelector(`:scope > [data-mod-card="${CSS.escape(mod.id)}"]`);
    if (!el) { el = G.document.createElement('div'); el.dataset.modCard = mod.id; host.appendChild(el); }
    try { fn(el, m ?? { isToday: true, date: clock.today() }); } catch (e) { console.warn(`[mod:${mod.id}] cards.${slot}`, e); }
  }
}
let dataT = 0;
function notifyModsData() {
  G.clearTimeout(dataT);
  dataT = G.setTimeout(() => { for (const m of MODS.values()) { try { m.onData?.(); } catch (e) { console.warn(`[mod:${m.id}] onData`, e); } } }, 50);
}
// Module stylesheets wait for the first old page that needs them, in the order they were asked for.
const cssQueue = [];
let cssLive = false;
function loadCss(href) {
  const key = String(href).replace(/^\.?\//, '');
  if (cssQueue.includes(key)) return;
  cssQueue.push(key);
  if (cssLive) L.ensureLegacyBase().then(() => L.legacyCss(key));
}
function wakeCss() {
  if (cssLive) return;
  cssLive = true;
  L.ensureLegacyBase().then(() => Promise.all(cssQueue.map((k) => L.legacyCss(k))));
}

// ── the host ──────────────────────────────────────────────────────────
const cap = { type: 'task', project: null, engine: 'claude', worktree: null };
const host = {
  api: (path, opts = {}) => API.api(path, { timeout: 0, ...opts }),
  fetch: (path, opts = {}) => API.rawFetch(path, opts),
  data: () => SY.data, areas: AREAS, boot: () => SY.boot, ui: () => uiCompat,
  toast, haptic, makeSheet: L.makeSheet, setTab: setTabCompat, refresh: (force) => SYNC.refresh(force), esc, fmt: clock.hm,
  css: loadCss, register: registerMod, openPage: openModPage,
  native: NATIVE, authHeaders: API.authHeaders,
  push: (kind, id) => openDetail(kind, id),
  pop: (opts) => { const n = opts?.all ? $$('#stack > .page').length : 1; for (let i = 0; i < n; i++) pop(); },
  detail: (kind, d) => DETAILS.set(kind, d),
  tab: (name, fn) => { TABS.set(name, fn); renderTab(name); },
  topDetail: () => { const top = $('#stack')?.lastElementChild; return top?.dataset.kind ? top : null; },
  openCapture: (o = {}) => bus.openCapture(o?.voice ? 'voice' : 'type', { type: o?.mode === 'goal' ? 'goal' : o?.type, project: o?.project ?? undefined, source: o?.source, date: o?.date, inbox: o?.inbox, aspects: o?.aspects }),
  openItem: (id) => bus.openTask(id),
  taskById: (id) => SY.data?.tasks.find((t) => t.id === id) ?? null,
  save: () => SYNC.save('local'), commit: () => SYNC.save('local'), render: () => rerender(), renderTasks: () => rerender(),
  rowHTML, dayLabel: clock.dayLabel, color, areaName, dur: clock.dur, CHEV: L.CHEV, PLUS: L.PLUS, CHECK_SVG: L.CHECK_SVG, projGlyph, liveProjects, touchProject,
  areaShort, clip, plural, AGENT: L.AGENT_GLYPH, areaChips,
  onBoot: (fn) => SYNC.onBoot(fn), onLocal: (fn) => SYNC.onLocal(fn), sync: () => SYNC.scheduleSync(0),
  adopt: (kind, obj) => SYNC.adopt(kind, obj),
  topSheet: () => L.topSheet(), capState: () => cap,
  skins: UI.SKINS, skin: UI.skin, setSkin: UI.setSkin, theme: UI.theme, setTheme: UI.setTheme,
  ring: UI.ring, ringSet: UI.ringSet, setRing: UI.setRing, pulse: UI.pulse,
  seg: UI.seg, selectSeg: UI.selectSeg, skinSeg: UI.skinSeg, themeSeg: UI.themeSeg,
  peek: UI.peek, closePeek: UI.closePeek, onHold: UI.onHold, icons: UI.I, areaIcons: UI.areaIcon,
  registerTab: (id, def) => { if (!def || typeof def.render !== 'function') throw new Error('AOS.registerTab needs { render(el) }'); TAB_DEFS.set(id, def); return def; },
  renderTab, visiblePage,
  syncStatus: () => API.connection().status,
  openTasks: (list) => bus.openTasks(list), openLife: () => setTabCompat('life'),
  // v2
  openClassic, mods: sortedMods, figureOf, renderCards, legacyCss: (href) => L.legacyCss(href),
};
Object.defineProperties(host, {
  today: { get: () => clock.today(), enumerable: true },
  user: { get: () => SY.user ?? null, enumerable: true },
  owner: { get: () => (SY.user?.role === 'owner'), enumerable: true },
  real: { get: () => SY.source === 'real', enumerable: true },
  apiBase: { get: () => API.apiBase(), enumerable: true },
});

let installed = false;
/** Put window.AOS in place (before app/work or app/modules load) and keep it fed. */
export function install() {
  if (installed) return G.window.AOS;
  installed = true;
  refreshAreas();
  L.layer();
  UI.initUI({ haptic, visiblePage });
  G.window.AOS = host;
  L.onSheetShow(wakeCss);
  SYNC.onBoot(() => refreshAreas());
  SYNC.onChange((why) => { if (why === 'synced' || why === 'server' || why === 'boot') notifyModsData(); });
  // the old pages' stylesheets come in with the first old page or sheet, or soon after the first paint
  const idle = G.requestIdleCallback ?? ((fn) => G.setTimeout(fn, 1200));
  idle(() => wakeCss(), { timeout: 2500 });
  G.document.addEventListener('pointerdown', (e) => { if (e.target.closest?.('.lg-page, #screen')) wakeCss(); }, true);
  return host;
}

/**
 * Load app/work, then app/modules, the way the shipping app did after its first render. app/work's own link handling
 * (hashchange, appUrlOpen) is kept out: svc/route.js is the one entry for links and calls AOS.work.handleLink itself.
 */
export async function loadLegacy({ work = true } = {}) {
  install();
  if (work) {
    const hash = G.location.hash;
    const plugins = G.window.Capacitor?.Plugins;
    const App = plugins?.App;
    try {
      if (hash) G.history.replaceState(null, '', G.location.pathname + G.location.search);
      if (plugins && App) plugins.App = { ...App, addListener: () => ({ remove() {} }), getLaunchUrl: () => Promise.resolve(null) };
      await import('../../work/index.js');
      data.bindWork(await import('../../work/state.js'));
    } catch (e) { console.warn('[work] failed to load', e); }
    finally {
      if (plugins && App) plugins.App = App;
      if (hash && !G.location.hash) G.history.replaceState(null, '', G.location.pathname + G.location.search + hash);
    }
  }
  try { await import('../../modules/index.js'); } catch (e) { console.warn('[mod] modules failed to load', e); }
  G.document.dispatchEvent(new CustomEvent('aos-more'));
  notifyModsData();
}

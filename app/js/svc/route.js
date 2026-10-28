// svc/route: one checked entry for every screen change that starts outside the screen: the boot hash, #links followed
// inside the app, agenticos:// links (widgets, Siri, the share sheet, quick actions, the keyboard), push taps and
// ?link= on the web. Role checks live here and only here: a member gets no Work, agent or AI screens.
// (brain note/route-every-screen-change-through-one-checked-entry-point)
//
//   go(link, { from }) → true when something opened     link: 'agenticos://job/j12' · '#money/budget' · 'today/week'
//   registerRoute(heads, fn, { owner, tab }) → unregister   (also on the bus: api.registerRoute)
//   start() · parse(link) → { head, sub, arg, parts, query, path, raw } · allowed(head) · routes() → the registered keys
//
// An area registers its own deep-link heads from its own file, at import (before the boot link is routed):
//   registerRoute('goal', (L, ctx) => { ctx.tab('life'); ctx.after(() => openGoal(L.sub)); });
//   registerRoute('money/expense', (L, ctx) => { ctx.after(() => logExpense({ amount: Number(L.query.get('amount')) })); }, { tab: 'life' });
//   registerRoute(['journal', 'growth/journal'], (L, ctx) => …);
// · a key is a head ('goal') or a head and its first part ('money/expense'); the longer key is tried first
// · fn(L, ctx) returns false to pass the link on (to the head's own key, then an aspect app, then Today); anything
//   else means it handled it. L: the parsed link. ctx: { from, tab(id), after(fn), base(), legacy(fn), go(link),
//   built(tab), bus }: tab switches instantly, after waits two frames (a pushed page needs its tab built), base puts
//   Today under a page opened at boot, legacy waits for the shipping app's pages (app/work, app/modules)
// · { owner: true } refuses the head to a member, on top of route.js's own owner-only list (an area can't open one of
//   those to members); { tab } switches to that tab before fn runs
// · an area's key replaces route.js's built-in one for the same key: the area owns its links (a second area on the
//   same key gets a console warning, and the later registration wins)
// · any head that is an aspect id with no route of its own opens that app at the section (#money/budget)
//
// Built-in links (agenticos://<path> or #<path>): today[/day|week|month] · tasks[/<list>] · task/<id> · life · goals ·
// <aspect>[/<section>] · brain[/<path>] · note/<id> · person/<id> · goal/<id> · horizon/<h> ·
// capture[?type=idea|task|job&voice=1&project=] · capture/<scan|voice|type|files> · scan[?mode=] · voice ·
// breathe[?pattern=&running=1] · focus?minutes=&title= · ask[?text=] · ask/<id> · agent[/<view>] · wyn[/call] ·
// work[/jobs|projects|ideas|job/<id>|project/<slug>|changes/<id>|terminal|new|night] · jobs · job/<id> · project/<slug> ·
// code · term|compare|copy|idea/<id> · content[/<view>[/<arg>]] · clients · client/<slug> · more ·
// money/expense[?amount=&note=] · body/workout[?start=1] · growth/journal · soul/habit/<id> · soul/blocker[?ask=1] ·
// mod/<module> (a PC module's page) · classic/<jobs|content|clients> (the shipping app's screen) · flow · keyboard
import { setTab, toast, currentTab } from '../core.js';
import { api as bus, has, provide } from '../bus.js';
import { openAspect, aspectIds } from '../aspects.js';
import * as data from '../data.js';

const G = globalThis;
// the heads a member never gets, whoever registers them (DECISIONS: members get no Jobs, agent or AI)
const OWNER_ONLY = new Set(['work', 'jobs', 'job', 'project', 'projects', 'ideas', 'idea', 'code', 'term', 'compare', 'copy', 'agent', 'wyn', 'ask', 'clients', 'client']);
const after = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn));
// a page or a sheet opened from a link needs a tab under it (at boot there is none yet)
const base = () => { if (!currentTab()) setTab('today', { instant: true }); };
// the shipping app's pages (modules, Work's terminals and copies) load just after the first paint: wait for them
const legacyThen = (fn) => { const p = G.window?.__engine?.legacy; if (p && G.document?.documentElement.dataset.legacy !== 'loaded') p.then(() => after(fn)); else after(fn); };
const built = (id) => !!G.document?.querySelector(`#pages > .page[data-tab="${id}"]`)?.dataset.built;
const tab = (id) => setTab(id, { instant: true });

export function parse(raw) {
  let s = String(raw ?? '').trim();
  const original = s;
  s = s.replace(/^agenticos:\/\//i, '').replace(/^#\/?/, '').replace(/^\/+/, '');
  const [path, query = ''] = s.split('?');
  let parts;
  try { parts = path.split('/').map((x) => decodeURIComponent(x ?? '')); } catch { parts = path.split('/'); }
  const [head = '', sub, arg] = parts;
  return { head: head.toLowerCase(), sub, arg, parts, query: new URLSearchParams(query), path, raw: original };
}

// ── the registry ──────────────────────────────────────────────────────
const ROUTES = new Map();   // key ('goal' | 'money/expense') → { fn, owner, tab, builtIn, by }
let defining = false;       // true while route.js registers its own
const keyOf = (k) => String(k ?? '').trim().replace(/^agenticos:\/\//i, '').replace(/^[#/]+/, '').toLowerCase();
/**
 * Register what a link head opens. heads: a key or a list of keys ('goal', 'money/expense'). fn(L, ctx) returns false
 * to pass the link on. Options: owner (refuse it to a member), tab (show this tab first). Returns unregister().
 */
export function registerRoute(heads, fn, { owner = false, tab: firstTab = null } = {}) {
  if (typeof fn !== 'function') throw new Error('registerRoute(heads, fn): fn is a function');
  const keys = [].concat(heads).map(keyOf).filter(Boolean);
  if (!keys.length) throw new Error('registerRoute needs a head, e.g. registerRoute(\'goal\', fn)');
  // who registered it (for the warning and routes()): the first caller outside route.js and the bus
  const by = defining ? 'route.js' : (new Error().stack?.split('\n').find((l) => /\/js\/(?!svc\/route\.js|bus\.js)[\w/.-]+\.js/.test(l))?.match(/\/js\/([\w/.-]+\.js)/)?.[1] ?? 'an area');
  const mine = new Map();
  for (const k of keys) {
    const prev = ROUTES.get(k) ?? null;
    if (prev && !prev.builtIn && prev.fn !== fn) console.warn(`[route] "${k}" was registered by ${prev.by}; ${by} replaces it`);
    const entry = { fn, owner: !!owner, tab: firstTab, builtIn: defining, by, prev };
    ROUTES.set(k, entry);
    mine.set(k, entry);
  }
  // unregister puts back what was there before (route.js's own route, or an earlier area's)
  return () => {
    for (const [k, entry] of mine) {
      if (ROUTES.get(k) === entry) { if (entry.prev) ROUTES.set(k, entry.prev); else ROUTES.delete(k); }
      else for (let e = ROUTES.get(k); e; e = e.prev) if (e.prev === entry) { e.prev = entry.prev; break; }
    }
  };
}
/** The registered keys, with who registered each (for the console: __engine.route.routes()). */
export const routes = () => [...ROUTES.entries()].map(([k, r]) => `${k}${r.owner ? ' (owner)' : ''} · ${r.by}`).sort();
provide('registerRoute', registerRoute);

/** May this account open links that start with head? Role checks live here. */
export const allowed = (head) => {
  const h = keyOf(head).split('/')[0];
  const ownerOnly = OWNER_ONLY.has(h) || [...ROUTES.entries()].some(([k, r]) => r.owner && k.split('/')[0] === h);
  return !ownerOnly || data.USER?.owner !== false || data.DEMO_MODE;
};

let last = { url: '', at: 0 };
/** Open what a link points at. from: 'boot' | 'hash' | 'link' | 'push' | 'app'. */
export function go(raw, { from = 'app' } = {}) {
  const url = String(raw ?? '');
  // a cold start can deliver the same URL twice (getLaunchUrl and a retained appUrlOpen): handle it once
  if (from !== 'hash' && url && url === last.url && Date.now() - last.at < 3000) return true;
  last = { url, at: Date.now() };
  const L = parse(url);
  if (!allowed(L.head)) {
    toast('That isn’t on this account');
    tab('today');
    return false;
  }
  const ctx = { from, tab, after, base, legacy: legacyThen, go: (link) => go(link, { from }), built, bus };
  const run = (r) => { if (!r) return false; if (r.tab) tab(r.tab); return r.fn(L, ctx) !== false; };
  try {
    if (L.sub && run(ROUTES.get(`${L.head}/${String(L.sub).toLowerCase()}`))) return true;
    if (run(ROUTES.get(L.head))) return true;
    // an aspect app with no route of its own opens at the section the link names
    if (aspectIds().includes(L.head)) { tab('life'); after(() => openAspect(L.head, L.sub)); return true; }
  } catch (e) { console.warn('[route]', url, e); }
  if (from === 'boot' || from === 'hash') tab('today');
  return false;
}

// ── the built-in links (an area's registration for the same key replaces one of these) ──
defining = true;
const R = registerRoute;
R(['', 'today'], (L, c) => { c.tab('today'); if (['day', 'week', 'month'].includes(L.sub)) c.after(() => bus.openCalendar(L.sub)); });
R('tasks', (L, c) => { c.tab('today'); c.after(() => bus.openTasks(L.sub)); });
R('task', (L, c) => { if (!L.sub) return false; c.tab('today'); c.after(() => bus.openTask(L.sub)); });
R(['life', 'goals'], (L, c) => { c.tab('life'); if (L.sub) c.after(() => bus.openLife(L.sub)); });
R('brain', (L, c) => { c.tab('life'); c.after(() => bus.openBrain(L.parts.slice(1).join('/') || undefined)); });
R('note', (L, c) => { if (!L.sub) return false; c.tab('life'); c.after(() => bus.openBrain(`notes/${L.sub}`)); });
R('person', (L, c) => { if (!L.sub) return false; c.tab('life'); c.after(() => bus.openPerson(L.sub)); });
R('goal', (L, c) => { c.tab('life'); c.after(() => bus.openGoal(L.sub)); });
R('horizon', (L, c) => { c.tab('life'); c.after(() => bus.openHorizon(L.sub)); });
// the native shortcuts into an aspect app's one action (NATIVE notes section 3); other sections open the app itself
R('money/expense', (L, c) => { c.tab('life'); c.after(() => bus.logExpense({ amount: L.query.get('amount') ? Number(L.query.get('amount')) : undefined, note: L.query.get('note') ?? undefined })); });
R('body/workout', (L, c) => { c.tab('life'); c.after(() => bus.startWorkout(L.query.get('id') ?? undefined, { start: L.query.get('start') === '1' })); });
R('growth/journal', (L, c) => { c.tab('life'); c.after(() => bus.writeJournal()); });
R('soul/habit', (L, c) => { if (!L.arg) return false; c.tab('life'); c.after(() => bus.checkHabit(L.arg)); });
R('soul/blocker', (L, c) => { c.tab('life'); c.after(() => bus.openBlocker({ ask: L.query.get('ask') === '1' })); });
R(['capture', 'scan'], (L, c) => {
  const q = L.query, isScan = L.head === 'scan';
  const type = ['idea', 'task', 'job'].includes(q.get('type')) ? q.get('type') : null;
  if (type === 'job' && !data.USER?.owner && !data.DEMO_MODE) return c.go('capture?type=idea');
  const mode = isScan ? 'scan' : q.get('voice') === '1' ? 'voice' : (L.sub || q.get('mode') || (type ? 'type' : undefined));
  const o = { type: type ?? undefined, project: q.get('project') || undefined, source: q.get('source') || (q.get('voice') === '1' ? 'widget' : undefined), hint: isScan ? (L.sub || q.get('mode') || undefined) : undefined, text: q.get('text') || undefined };
  c.base();
  c.after(() => (isScan && has('scan') ? bus.scan(o.hint) : bus.openCapture(mode, o)));
});
R('voice', (L, c) => { c.base(); c.legacy(() => bus.openVoice()); });
R('breathe', (L, c) => { c.base(); c.after(() => bus.startBreathing({ pattern: L.query.get('pattern') || undefined, running: L.query.get('running') === '1' })); });
// the focus block (the Live Activity and the Start focus intent open this): an area that owns a focus timer provides
// startFocus; until one does, the link lands on Today with the task in progress open (the iPhone keeps the countdown)
R('focus', (L, c) => {
  if (has('startFocus')) { c.base(); c.after(() => bus.startFocus({ minutes: Number(L.query.get('minutes')) || undefined, title: L.query.get('title') || undefined })); return; }
  c.tab('today');
  const doing = data.TASKS.find((t) => t.list === 'doing');
  if (doing && has('openTask')) c.after(() => bus.openTask(doing.id));
});
R('ask', (L, c) => { c.tab('agent'); c.after(() => (L.sub ? bus.openAgent('feed', L.sub) : bus.askAgent(L.query.get('text') ?? '', {}))); }, { owner: true });
R(['agent', 'wyn'], (L, c) => {
  if (L.sub === 'call') { c.base(); c.after(() => bus.startCall({ why: L.query.get('reason') ?? undefined })); return; }
  // the Agent tab reads its own hash the first time it is built; after that the bus opens the view
  if (L.sub && !c.built('agent')) { G.history?.replaceState(null, '', `#agent/${L.sub}${L.arg ? `/${L.arg}` : ''}`); c.tab('agent'); return; }
  c.tab('agent');
  if (L.sub) c.after(() => bus.openAgent(L.sub, L.arg));
}, { owner: true });
R(['job', 'project'], (L, c) => c.go(`work/${L.head}/${L.sub ?? ''}`), { owner: true });
R(['jobs', 'projects', 'ideas', 'code'], (L, c) => c.go(`work/${L.head === 'code' ? 'jobs' : L.head}`), { owner: true });
R('work', (L, c) => {
  const { sub, arg } = L;
  // Work reads its own hash the first time it is built (#work/job/j12); after that the bus opens the page
  if (sub && !['jobs', 'projects', 'ideas'].includes(sub) && !c.built('jobs')) { G.history?.replaceState(null, '', `#work/${[sub, arg].filter(Boolean).join('/')}`); c.tab('jobs'); return; }
  c.tab('jobs');
  if (sub) c.after(() => (sub === 'job' ? bus.openJob(arg) : sub === 'changes' ? bus.openChanges(arg) : sub === 'project' ? bus.openProject(arg) : bus.openWork(sub)));
}, { owner: true });
// the shipping app's Work pages (terminals, compares, copies, idea pages) until the Work area has its own
R(['term', 'compare', 'copy', 'idea'], (L, c) => { c.tab('jobs'); c.legacy(() => G.window?.AOS?.work?.handleLink?.(`${L.head}/${L.sub ?? ''}`)); }, { owner: true });
R('content', (L, c) => { c.tab('content'); if (L.sub) c.after(() => bus.openContent(L.sub, L.arg)); });
R('clients', (L, c) => { c.tab('clients'); }, { owner: true });
R('client', (L, c) => { if (!L.sub) return false; c.base(); c.after(() => bus.openClient(L.sub)); }, { owner: true });
R('more', (L, c) => { c.base(); c.after(() => bus.openMore()); });
R('mod', (L, c) => { if (!L.sub) return false; if (L.sub === 'content') return c.go('content'); c.base(); c.legacy(() => G.window?.AOS?.openPage?.(L.sub)); });
R('classic', (L, c) => { if (!L.sub) return false; if (L.sub === 'content') return c.go('content'); c.base(); c.legacy(() => G.window?.AOS?.openClassic?.(L.sub)); });   // the old Content page is retired: its link opens the tab
// handled by the native side (SceneDelegate): the keyboard's dictation hand-off and its Photos prompt
R(['flow', 'keyboard'], () => true);
defining = false;

let started = false;
/** Route the boot link, then every later one. Call once, after the areas have registered. */
export function start() {
  if (started) return;
  started = true;
  const qs = new URLSearchParams(G.location?.search ?? '');
  const link = qs.get('link');
  if (link) {
    qs.delete('link');
    const rest = qs.toString();
    G.history?.replaceState(null, '', `${G.location.pathname}${rest ? `?${rest}` : ''}${G.location.hash}`);
    go(G.location.hash || '#today', { from: 'boot' });
    go(link, { from: 'link' });
  } else go(G.location?.hash || '#today', { from: 'boot' });
  // a #link followed inside the app routes the same way (and no one else answers it: work/index.js listens too)
  G.addEventListener?.('hashchange', (e) => { e.stopImmediatePropagation(); go(G.location.hash, { from: 'hash' }); });
  const App = G.window?.Capacitor?.Plugins?.App;
  App?.addListener?.('appUrlOpen', (d) => go(d?.url ?? '', { from: 'link' }));
  App?.getLaunchUrl?.().then((r) => { if (r?.url) go(r.url, { from: 'link' }); }).catch(() => {});
}

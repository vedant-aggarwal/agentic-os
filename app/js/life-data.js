// Life on real data: the wheel's scorings (life_snapshots), the area → aspect map with its own offline outbox
// (PUT /life/area-aspects), the agent's draft read from what the apps logged, the re-score rhythm, and the map's graph.
// Owner: LIFE (v2). Reads data.js at call time (its arrays are refilled in place), never caches a number.
import { ASPECTS, AREAS, AREA_ASPECTS, GOALS, PROJECTS, TASKS, EVENTS, DAYS, PEOPLE, LIFE, ME, AGENT, DEMO_MODE, aspect, area } from './data.js';
import { summary, aspectDef } from './aspects.js';
import * as clock from './svc/clock.js';
import * as API from './svc/api.js';
import * as SYNC from './svc/sync.js';

export const IDS = ASPECTS.map((a) => a.id);
export const FAM_ORDER = ['health', 'work', 'people'];
export const famIds = (f) => ASPECTS.filter((a) => a.fam === f).map((a) => a.id);
export const RESCORE_DAYS = 30;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDate = (iso) => { const p = clock.dparts(iso); return `${p.day} ${MON[p.month ?? (Number(iso.slice(5, 7)) - 1)]}`; };

// ── the scorings ──────────────────────────────────────────────────────
// demo mode keeps the prototype's three earlier scorings (the sample's history); real mode reads life_snapshots only
const DEMO_SNAPS = [['2026-04-05', { body: 3, mind: 4, soul: 2, mission: 2, money: 2, growth: 3, family: 5, romance: 1, friends: 3 }],
  ['2026-05-06', { body: 2, mind: 3, soul: 3, mission: 2, money: 3, growth: 4, family: 5, romance: 1, friends: 2 }],
  ['2026-06-06', { body: 3, mind: 3, soul: 2, mission: 3, money: 3, growth: 4, family: 6, romance: 2, friends: 2 }]];
let demoSaved = null;
/** Every scoring, oldest first: [{ date, label, source, scores }]. A day scored twice (two sources) keeps the app's. */
export function snapshots() {
  if (DEMO_MODE) {
    const list = DEMO_SNAPS.map(([date, scores]) => ({ date, source: 'sample', scores }));
    list.push({ date: '2026-07-06', source: 'sample', scores: Object.fromEntries(ASPECTS.map((a) => [a.id, demoSaved?.prev?.[a.id] ?? a.score])) });
    if (demoSaved) list.push({ date: clock.today(), source: 'app', scores: Object.fromEntries(ASPECTS.map((a) => [a.id, a.score])) });
    return list.map((s) => ({ ...s, label: shortDate(s.date) }));
  }
  const byDay = new Map();
  for (const s of LIFE.snapshots ?? []) { const cur = byDay.get(s.date); if (!cur || s.source === 'app') byDay.set(s.date, s); }
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).map((s) => ({ ...s, label: shortDate(s.date) }));
}
export const demoScored = (prev) => { demoSaved = { prev }; };
/** The latest scoring's scores ({ id: 0-10 | null }), what the wheel shows. */
export const scores = () => Object.fromEntries(ASPECTS.map((a) => [a.id, a.score ?? null]));
export const scoredCount = () => ASPECTS.filter((a) => a.score != null).length;
export const latest = () => snapshots().at(-1) ?? null;
/** When he last scored, how long ago, and whether a re-score is due (monthly, the prototype's default). */
export function rhythm() {
  const l = latest();
  if (!l) return { none: true, due: true, days: null, label: null, next: null };
  const days = clock.daysBetween(l.date, clock.today());
  return { none: false, date: l.date, label: days === 0 ? 'Today' : l.label, days, ago: days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`, due: days >= RESCORE_DAYS, next: clock.addDays(l.date, RESCORE_DAYS) };
}

// ── the area → aspect map, offline first ──────────────────────────────
// a change lands at once (here and on the map), waits in localStorage, and goes out as one PUT of the whole map; the
// latest map wins, so a resend is harmless. After the PC answers, a refresh brings it back through the bootstrap.
const AA_KEY = 'aos-life:area-aspects';
let aaPending = (() => { try { return JSON.parse(API.ls.get(AA_KEY) ?? 'null'); } catch { return null; } })();
let aaTimer = null, aaFails = 0;
const aaSubs = new Set();
export const onAreaAspects = (fn) => { aaSubs.add(fn); return () => aaSubs.delete(fn); };
const aaEmit = (why) => aaSubs.forEach((f) => { try { f(why); } catch (e) { console.warn(e); } });
/** The map as he sees it now: a change still waiting for the PC first, then the PC's. */
export const areaAspects = () => (aaPending?.map ?? AREA_ASPECTS);
export const aspectsOfArea = (slug) => [...(areaAspects()[slug] ?? [])];
export const areaAspectsPending = () => !!aaPending;
export function setAreaAspects(slug, list) {
  const map = Object.fromEntries(Object.entries(areaAspects()).map(([k, v]) => [k, [...v]]));
  map[slug] = [...new Set(list)].filter((id) => IDS.includes(id));
  if (DEMO_MODE) { for (const k of Object.keys(AREA_ASPECTS)) delete AREA_ASPECTS[k]; Object.assign(AREA_ASPECTS, map); aaEmit('local'); return map[slug]; }
  aaPending = { map, at: new Date().toISOString() };
  API.ls.set(AA_KEY, JSON.stringify(aaPending));
  aaEmit('local');
  aaFlush(150);
  return map[slug];
}
function aaFlush(ms = 0) {
  clearTimeout(aaTimer);
  aaTimer = setTimeout(async () => {
    const mine = aaPending; if (!mine) return;
    try {
      await API.put('/life/area-aspects', mine.map);
      if (aaPending === mine) { aaPending = null; API.ls.del(AA_KEY); }
      aaFails = 0;
      await SYNC.refresh(true).catch(() => {});
      aaEmit('synced');
    } catch (e) {
      if (e?.status >= 400 && e.status < 500 && e.status !== 404 && e.status !== 408 && e.status !== 429) {
        // the PC refused it (an area that no longer exists): drop the change and show the PC's map again
        if (aaPending === mine) { aaPending = null; API.ls.del(AA_KEY); }
        aaEmit('refused');
        return;
      }
      aaFails++;
      aaFlush(Math.min(60000, 5000 * aaFails));
    }
  }, ms);
}
if (aaPending && !DEMO_MODE) aaFlush(2500);
globalThis.addEventListener?.('online', () => { if (aaPending) aaFlush(300); });

/** A goal's aspects: its own when it has them, else its area's (the map's current one), else Mission. */
export function goalAspects(g) {
  const raw = DEMO_MODE ? null : SYNC.state.data?.goals?.find((x) => String(x.id) === String(g.id));
  const own = DEMO_MODE ? g.aspects : raw?.aspects;
  if (own?.length) return [...own];
  const fromArea = g.area ? aspectsOfArea(g.area) : [];
  return fromArea.length ? fromArea : [...(g.aspects?.length ? g.aspects : ['mission'])];
}
export const goalHasOwnAspects = (g) => !!(DEMO_MODE ? g.aspects?.length : SYNC.state.data?.goals?.find((x) => String(x.id) === String(g.id))?.aspects?.length);

// ── what feeds each aspect: areas, goals, projects, people (one thing can sit in two places) ──
const areaList = () => Object.entries(AREAS).filter(([slug]) => slug !== 'none').map(([slug, a]) => ({ slug, ...a }));
const liveGoals = () => GOALS.filter((g) => g.status !== 'done' && g.status !== 'dropped');
const liveProjects = () => PROJECTS.filter((p) => p.status !== 'done' && p.status !== 'dropped' && p.status !== 'archived');
/** [{ id, kind, ref, name, feeds: [aspect ids], via? }] from the real records. */
export function feeds() {
  const out = [];
  for (const a of areaList()) out.push({ id: `r:${a.slug}`, kind: 'area', ref: a.slug, name: a.name, color: a.color, feeds: aspectsOfArea(a.slug) });
  for (const g of liveGoals()) out.push({ id: `g:${g.id}`, kind: 'goal', ref: g.id, name: g.title, feeds: goalAspects(g), area: g.area ?? null, own: goalHasOwnAspects(g) });
  for (const p of liveProjects()) out.push({ id: `p:${p.slug}`, kind: 'project', ref: p.slug, name: p.name ?? p.slug, color: p.color, feeds: p.area ? aspectsOfArea(p.area) : [], area: p.area ?? null, via: p.area ? 'area' : null });
  for (const p of PEOPLE) if (p.aspect) out.push({ id: `h:${p.id}`, kind: 'person', ref: p.id, name: p.name, feeds: [p.aspect] });
  return out;
}
export const feedsOf = (id, list = feeds()) => list.filter((f) => f.feeds.includes(id));
export const twoPlaces = (list = feeds()) => list.filter((f) => f.feeds.length > 1);

// a name short enough to sit on the map (the card under it shows the whole one)
const clip = (s, n) => { const t = String(s ?? '').replace(/\s*\([^)]*\)/g, '').trim(); if (t.length <= n) return t; const cut = t.slice(0, n - 1); return `${cut.replace(/[\s,:;·-]+\S*$/, '').trim() || cut}…`; };
// ── the map as a graph (graph.js): you at the centre, the nine aspects on the wheel's angles, what feeds them ──
export function graphData({ filter = 'all', tasks = true } = {}) {
  const list = feeds();
  const sc = scores();
  const nodes = [{ id: 'me', kind: 'hub', label: ME.first || ME.name || 'You', initial: (ME.initial || ME.first?.[0] || 'Y').toUpperCase() }];
  const links = [];
  for (const id of IDS) {
    const fed = list.some((f) => f.feeds.includes(id));
    const s = sc[id];
    nodes.push({ id: `a:${id}`, kind: 'aspect', group: id, label: aspect(id).name, size: s == null ? 0.45 : s / 10, ring: s == null ? undefined : s / 10, hollow: !fed });
    links.push(['me', `a:${id}`]);
  }
  const show = (k) => filter === 'all' || filter === k;
  const two = new Set(twoPlaces(list).map((f) => f.id));
  for (const f of list) {
    if (!show(f.kind)) continue;
    const group = f.feeds[0] ?? null;
    const n = { id: f.id, kind: f.kind, group, label: clip(f.name, f.kind === 'goal' ? 30 : 26) };
    if (f.kind === 'area') n.color = f.color;
    if (f.kind === 'person') n.initial = f.name[0];
    if (two.has(f.id)) n.ring = 1;   // a thing in two places wears a full ring: it glows as such
    nodes.push(n);
    if (f.kind === 'project' && f.area && show('area')) { links.push([`r:${f.area}`, f.id]); continue; }
    if (f.kind === 'goal' && f.area && !f.own && show('area')) { links.push([`r:${f.area}`, f.id]); continue; }
    if (!f.feeds.length) { links.push({ source: 'me', target: f.id, dotted: true }); continue; }
    f.feeds.forEach((a) => links.push([`a:${a}`, f.id]));
  }
  // open tasks: small stars round what they belong to (their goal, else project, else area), named when you zoom in
  if (tasks && filter === 'all') {
    const have = new Set(nodes.map((n) => n.id));
    for (const t of TASKS) {
      if (t.list === 'done' || t.status === 'done') continue;
      const to = (t.goal != null && have.has(`g:${t.goal}`)) ? `g:${t.goal}` : (t.project && have.has(`p:${t.project}`)) ? `p:${t.project}` : (t.area && have.has(`r:${t.area}`)) ? `r:${t.area}` : null;
      if (!to) continue;
      const host = nodes.find((n) => n.id === to);
      nodes.push({ id: `t:${t.id}`, kind: 'task', group: host.group, label: clip(t.title, 26) });
      links.push([to, `t:${t.id}`]);
    }
  }
  return { nodes, links, feeds: list };
}

// ── the agent's draft: each aspect's last score, moved by what its apps and your records show since ──
const within = (iso, days) => iso && clock.daysBetween(clock.dateOfIso(iso), clock.today()) <= days;
const realSummary = (id) => {
  if (DEMO_MODE || !aspectDef(id)?.summary) return null;
  const s = summary(id);
  return s.line && s.line !== aspect(id).line ? s : (s.metric || s.streak ? s : null);
};
const DEMO_DRAFT = {
  body: [4, '11 workouts in October; protein short most days'], mind: [3, '7 of 12 books; screens 20 min under your usual'],
  soul: [3, 'Day 9; habits kept 6 days in 10'], mission: [4, 'Atlas ERP on pace; the week goal is behind'],
  money: [4, 'Under budget most days; two invoices late'], growth: [5, 'Journal 6 days running'],
  family: [5, 'Dinner at home most nights this week'], romance: [1, 'Nothing logged since July'], friends: [2, 'A friend in person 1 of 4 weeks'],
};
/** { id: { v, why, signals: [text] } } for the nine aspects. Every reason names a real figure, or says there is none. */
export function draft() {
  if (DEMO_MODE) return Object.fromEntries(IDS.map((id) => [id, { v: DEMO_DRAFT[id][0], why: DEMO_DRAFT[id][1], signals: [DEMO_DRAFT[id][1]] }]));
  const l = latest(); const since = l ? clock.daysBetween(l.date, clock.today()) : 30; const span = Math.max(7, Math.min(since || 30, 60));
  const sc = scores();
  const out = {};
  for (const id of IDS) {
    const base = sc[id] ?? 5; let d = 0; const sig = [];
    const done = TASKS.filter((t) => t.aspect === id && t.status === 'done' && within(t.completedAt, span)).length;
    const late = TASKS.filter((t) => t.aspect === id && t.late && t.status !== 'done').length;
    if (done >= 8) { d += 1; sig.push(`${done} tasks done in ${span} days`); } else if (done >= 3) { d += 0.5; sig.push(`${done} tasks done in ${span} days`); }
    if (late >= 3) { d -= 0.5; sig.push(`${late} tasks overdue`); }
    const gs = GOALS.filter((g) => goalAspects(g).includes(id) && g.status !== 'dropped');
    const on = gs.filter((g) => g.verdict === 'On pace' || g.verdict === 'Done').length, behind = gs.filter((g) => g.verdict === 'Behind pace').length;
    if (on) { d += 0.5; sig.push(`${on} goal${on === 1 ? '' : 's'} on pace`); }
    if (behind) { d -= 0.5; sig.push(`${behind} goal${behind === 1 ? '' : 's'} behind`); }
    const hrs = [...EVENTS, ...[...DAYS.values()].flat()].filter((e) => e.aspect === id && !e.sleep && !e.allDay).reduce((a, e) => a + Math.max(0, e.end - e.start), 0) / 60;
    if (hrs >= 6) { d += 0.5; sig.push(`${Math.round(hrs)} h on the calendar this week`); }
    const s = realSummary(id);
    if (s?.metric?.p != null) { if (s.metric.p >= 0.8) { d += 0.5; sig.push(s.line); } else if (s.metric.p < 0.25) { d -= 0.5; sig.push(s.line); } }
    if (s?.streak?.n >= 7 && !s.streak.private && id !== 'soul') { d += 0.5; sig.push(`${s.streak.n}-day streak`); }
    if (s?.streak?.atRisk) d -= 0.5;
    d = Math.max(-2, Math.min(2, d));
    const v = Math.max(0, Math.min(10, Math.round(base + d)));
    out[id] = { v, why: sig.length ? sig.slice(0, 2).join('; ') : (l ? `Nothing logged for ${aspect(id).name} since ${l.label}` : 'Nothing logged yet'), signals: sig, base };
  }
  return out;
}

// ── the re-score reminder: one local notification, a month after the last scoring, with her draft waiting ──
let lastPlanned = null;
export async function planReminder() {
  if (DEMO_MODE) return;
  const r = rhythm();
  const at = r.none ? null : Math.max(clock.dayStart(r.next) + 19 * 3600000, clock.nowMs() + 3600000);
  const key = `${at}`;
  if (key === lastPlanned) return; lastPlanned = key;
  try {
    const { native } = await import('./svc/native-plugins.js');
    if (!native?.notify) return;
    await native.notify.cancel({ id: 'life-rescore' });
    if (at == null) return;
    await native.notify.schedule({
      id: 'life-rescore', at: new Date(at).toISOString(), title: 'Time to score your wheel',
      body: `A month since ${r.label}. ${AGENT.name} has a draft from your apps.`, category: 'nudge', thread: 'life', url: 'agenticos://life/score',
    });
  } catch (e) { console.warn('[life] reminder', e); }
}
export { area };

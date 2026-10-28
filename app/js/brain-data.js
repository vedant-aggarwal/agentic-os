// The Brain's live data: the app's own second brain (an offline store collection of items on the PC's agentos DB:
// notes, inbox captures, files, facts, moments) and, for the owner, his brain vault through the server (read-only,
// cached on the phone so it opens offline). Owner: BRAIN. Read by js/brain.js, js/brain-graph.js, js/brain-search.js
// and, through the bus, by Life (brainStats), Capture (remember, brainFile) and every app (remember, openBrain).
// Demo mode (?data=demo) serves the prototype's samples from brain-demo.js, unchanged.
//
// View shapes (the prototype's, so the approved screens draw unchanged):
//   NOTES[]  { id, folder, sub, kind, title, text, by: 'wyn'|'you', via, day: 'today'|'yesterday'|'Mon 19 Oct', at: 'HH:MM',
//              where, links: { goal, task, person, project }, linkList, pinned, status, auto, person, ms, raw }
//   INBOX[]  { id, kind: 'reel'|'shot'|'voice'|'note', from, at, title, meta, why, to: [[aspect, label]], content, raw }
//   FOLDERS  { [aspect]: { count, updated, by, subs: [[name, n]], private, vault } }
import { DEMO_MODE, ASPECTS, PEOPLE, GOALS, PROJECTS, TASKS, AREAS, AREA_ASPECTS, AGENT, ME, person, aspect } from './data.js';
import * as D from './brain-demo.js';
import { collection } from './svc/store.js';
import * as API from './svc/api.js';
import * as clock from './svc/clock.js';

export const REAL = !DEMO_MODE;
export const PRIVATE = ['romance', 'soul'];
export const isOwner = () => DEMO_MODE || !!ME.owner;
const EP = '/api/v1/mod/brain';
const COL = REAL ? collection('brain/items', { endpoint: `${EP}/items`, prefix: 'b', sort: (a, b) => msOf(b) - msOf(a) }) : null;
export const items = () => (COL ? COL.list() : []);
export const ready = COL ? COL.ready : Promise.resolve();

// ── the views, refilled in place (other files hold these objects) ───────────────────────────────────────────────
const emptyFolders = () => Object.fromEntries(ASPECTS.map((a) => [a.id, { count: 0, updated: '', by: null, subs: [], private: PRIVATE.includes(a.id), vault: 0 }]));
export const FOLDERS = REAL ? emptyFolders() : D.FOLDERS;
export const NOTES = REAL ? [] : D.NOTES;
export const INBOX = REAL ? [] : D.INBOX;
export const PERSON_FILE = REAL ? {} : D.PERSON_FILE;
export let NOTE_TOTAL = REAL ? 0 : D.NOTE_TOTAL;
export const FEEDS = REAL ? [] : D.FEEDS;
// the owner's vault at a glance (GET /summary), kept on the phone so the library opens offline
const VKEY = 'aos-brain:vault';
export const VAULT = { ok: false, notes: 0, folders: [], domains: [], recent: [], at: 0 };
try { const v = REAL ? API.ls.json(VKEY) : null; if (v) Object.assign(VAULT, v); } catch {}
if (DEMO_MODE) Object.assign(VAULT, { ok: false });
export const MEANING = { up: false, vectors: 0 };

// ── time words ──────────────────────────────────────────────────────────────
function msOf(it) { const t = Date.parse(it?.at ?? ''); return Number.isFinite(t) ? t : Date.parse(it?.created_at ?? '') || 0; }
const hmOf = (ms) => new Date(ms + clock.getOffset() * 60000).toISOString().slice(11, 16);
export function dayWord(ms) {
  const d = clock.dateAt(ms), t = clock.today();
  if (d === t) return 'today';
  if (d === clock.addDays(t, -1)) return 'yesterday';
  return clock.label(d).short;
}
export const whenWord = (ms) => { const d = dayWord(ms); return d === 'today' ? hmOf(ms) : d === 'yesterday' ? `Yesterday ${hmOf(ms)}` : d; };
const VIA = { typed: 'typed', voice: 'a voice note', scan: 'a scan', share: 'a share', photo: 'a photo', file: 'a file', files: 'a file', whatsapp: 'WhatsApp', email: 'email', siri: 'Siri', widget: 'a widget', agent: 'what you said', chat: 'a chat', calendar: 'your calendar', cli: 'the PC', screenshot: 'a screenshot', capture: 'a capture' };
export const viaLabel = (s) => (s ? VIA[String(s).toLowerCase()] ?? (aspect(s)?.name ?? String(s)) : 'typed');
const FROM = { share: 'Shared', voice: 'Voice note', scan: 'Scan', photo: 'Photo', file: 'File', files: 'File', whatsapp: 'WhatsApp', email: 'Email', siri: 'Siri', widget: 'Widget', typed: 'Typed', agent: AGENT.name, screenshot: 'Screenshot' };
const linksObj = (list = []) => { const o = {}; for (const l of list) if (l?.kind && l.id && !o[l.kind]) o[l.kind] = l.id; return o; };

export function viewOf(it) { return view(it); }
function view(it) {
  const ms = msOf(it);
  const agent = (it.filed_by ?? it.author) === 'agent';
  return {
    id: it.id, folder: it.aspect ?? null, sub: it.sub ?? null, kind: it.kind === 'inbox' ? 'note' : it.kind ?? 'note', title: it.title || 'Untitled', text: it.text ?? '',
    by: agent ? 'wyn' : 'you', via: viaLabel(it.source), day: dayWord(ms), at: hmOf(ms), where: it.place ?? '', links: linksObj(it.links), linkList: it.links ?? [],
    pinned: !!it.pinned, status: it.status ?? 'filed', auto: !!it.auto, person: it.person ?? null, ms, private: PRIVATE.includes(it.aspect), raw: it,
  };
}
function inboxView(it) {
  const ms = msOf(it);
  const src = String(it.source ?? '').toLowerCase();
  const kind = it.thumb ?? (it.content?.platform || /reel/i.test(it.kind ?? '') ? 'reel' : /shot|screenshot|photo|scan/.test(src) || it.kind === 'scan' ? 'shot' : src === 'voice' || it.kind === 'voice' ? 'voice' : 'note');
  const s = it.suggest ?? localSuggest(it);
  return {
    id: it.id, kind, from: it.from ?? FROM[src] ?? (src ? src[0].toUpperCase() + src.slice(1) : 'Typed'), at: dayWord(ms) === 'today' ? hmOf(ms) : whenWord(ms), title: it.title || 'Untitled',
    meta: it.meta ?? `${FROM[src] ?? 'Note'}`, why: s?.why ?? '', to: (s?.to ?? []).map((t) => [t.aspect, t.label, t.person ?? null]), content: it.content ?? null, raw: it, ms,
  };
}

// ── the agent's suggestion while offline (the PC's is better and replaces it when the item syncs) ─────────────────
const GUESS = [
  [/protein|gym|workout|bench|sleep|slept|meal|breakfast|lunch|dinner|khana|cardio|face|skin/i, 'body'], [/read|book|class|lecture|course|exam|assignment|tutorial|college|college/i, 'mind'],
  [/habit|urge|streak|blocker|pray|meditat/i, 'soul'], [/client|atlas|northwind|project|pitch|reel|content|ship|build|harborline|pulsechat/i, 'mission'],
  [/₹|rupee|\brs\b|paid|spent|budget|upi|gpay|invoice|bill|payout|bank|statement/i, 'money'], [/journal|weekly review|lesson|dream|reflect/i, 'growth'],
  [/dad|mom|mom|dad|family|ghar|anniversary|diwali/i, 'family'], [/friend|dost|yaar|hangout|meetup/i, 'friends'],
];
export function localSuggest(it) {
  const text = `${it.title ?? ''} ${it.text ?? ''}`;
  const who = PEOPLE.find((p) => new RegExp(`\\b${p.name}\\b`, 'i').test(text));
  const a = who?.aspect ?? GUESS.find(([re]) => re.test(text))?.[1] ?? null;
  if (!a) return { to: [], confidence: 0, why: 'Nothing in it points to one folder yet' };
  return { to: [{ aspect: a, person: who?.id ?? null, label: who ? `People › ${who.name}` : aspect(a)?.name ?? a, score: 2 }], confidence: 0.4, why: who ? `Mentions ${who.name}` : '' };
}

// ── derive everything from the collection ─────────────────────────────────────────────────────────────────────
let unlocked = new Set();   // private folders opened behind Face ID this session (brain-lock.js sets it)
export const setUnlocked = (set) => { unlocked = set; derive('lock'); };
export const isLocked = (a) => PRIVATE.includes(a) && !unlocked.has(a);
function derive(why = 'server') {
  if (!REAL) return;
  const all = items();
  const filed = all.filter((i) => i.status !== 'inbox' && i.aspect);
  NOTES.splice(0, NOTES.length, ...filed.map(view));
  INBOX.splice(0, INBOX.length, ...all.filter((i) => i.status === 'inbox').map(inboxView));
  const F = emptyFolders();
  for (const n of NOTES) {
    const f = F[n.folder]; if (!f) continue;
    f.count++;
    if (!f._ms || n.ms > f._ms) { f._ms = n.ms; f.updated = n.day === 'today' ? n.at : n.day === 'yesterday' ? 'Yesterday' : n.day; f.by = n.by; }
    if (n.sub) { const s = f.subs.find((x) => x[0] === n.sub); if (s) s[1]++; else f.subs.push([n.sub, 1]); }
  }
  for (const d of VAULT.domains ?? []) if (d.aspect && F[d.aspect]) F[d.aspect].vault += d.count;
  for (const [k, v] of Object.entries(F)) { delete v._ms; FOLDERS[k] = v; }
  for (const k of Object.keys(PERSON_FILE)) delete PERSON_FILE[k];
  for (const it of all) {
    if (it.kind !== 'fact' || !it.person) continue;
    (PERSON_FILE[it.person] ??= { facts: [], tasks: [], goals: [] }).facts.push([it.title, it.text, it.id]);
  }
  for (const n of NOTES) if (n.person) { const F2 = (PERSON_FILE[n.person] ??= { facts: [], tasks: [], goals: [] }); if (n.links.task && !F2.tasks.includes(n.links.task)) F2.tasks.push(n.links.task); if (n.links.goal && !F2.goals.includes(n.links.goal)) F2.goals.push(n.links.goal); }
  NOTE_TOTAL = all.length + (VAULT.ok ? VAULT.notes ?? 0 : 0);
  deriveFeeds();
  emit(why);
}
let emitT = 0;
// Today and Life redraw on 'aspect-summary' (the lead's shared event); the Brain sends it only when its figures move
let statSig = '';
function emit(why) {
  clearTimeout(emitT);
  emitT = setTimeout(() => {
    document.dispatchEvent(new CustomEvent('brain-changed', { detail: { why } }));
    const s = stats(); const sig = `${s.notes}|${s.vault}|${s.inbox}|${s.filedToday}|${s.savedToday}`;
    if (sig !== statSig) { statSig = sig; document.dispatchEvent(new CustomEvent('aspect-summary', { detail: { id: 'brain' } })); }
    spotlightSoon();
  }, 16);
}
if (REAL) {
  COL.on('change', ({ why }) => derive(why));
  document.addEventListener('data-changed', (e) => { if (['boot', 'server', 'day', 'local', 'people'].includes(e.detail?.why)) { deriveFeeds(); emit('data'); } });
  document.addEventListener('clock-tick', () => { /* day words move at midnight */ if (clock.minutes() < 1) derive('day'); });
  COL.ready.then(() => { derive('load'); refreshSummary(); });
}

// what feeds what (the Life map and the graph): goals by their aspects, areas by the area→aspect map, projects by
// their area, people by their aspect. One thing can sit in two places.
function deriveFeeds() {
  if (!REAL) return;
  const out = [];
  for (const g of GOALS) { const asp = (g.aspects ?? []).filter((a) => aspect(a)); if (asp.length) out.push({ id: `g:${g.id}`, kind: 'goal', ref: g.id, name: g.title, sub: g.verdict ?? 'Goal', feeds: asp }); }
  for (const [slug, a] of Object.entries(AREAS)) { if (slug === 'none') continue; const asp = (AREA_ASPECTS[slug] ?? []).filter((x) => aspect(x)); if (asp.length) out.push({ id: `a:${slug}`, kind: 'area', ref: slug, name: a.name ?? slug, sub: 'Area', feeds: asp }); }
  for (const p of PROJECTS) { const asp = (AREA_ASPECTS[p.area] ?? []).filter((x) => aspect(x)); if (asp.length) out.push({ id: `p:${p.slug}`, kind: 'project', ref: p.slug, name: p.name, sub: 'Project', feeds: asp }); }
  for (const p of PEOPLE) if (aspect(p.aspect)) out.push({ id: p.id, kind: 'person', ref: p.id, name: p.name, sub: p.role?.split(' · ')[0] ?? 'Person', feeds: [p.aspect] });
  FEEDS.splice(0, FEEDS.length, ...out);
}
export const feedsOf = (aid) => FEEDS.filter((f) => f.feeds.includes(aid));
export const shared = () => FEEDS.filter((f) => f.feeds.length > 1);

// ── reads ────────────────────────────────────────────────────────────────────
export const note = (id) => NOTES.find((n) => n.id === id) ?? (REAL ? (() => { const it = COL.get(id); return it ? (it.status === 'inbox' ? { ...view(it), inbox: true } : view(it)) : null; })() : null);
const visible = (n) => !isLocked(n.folder);
// what the agent filed today, newest first (the Brain's day and the Life tab's Brain row read this)
export const filedToday = () => NOTES.filter((n) => n.day === 'today' && n.by === 'wyn' && visible(n)).sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0) || b.at.localeCompare(a.at));
export const savedToday = () => NOTES.filter((n) => n.day === 'today' && visible(n)).sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0) || b.at.localeCompare(a.at));
export const notesAbout = (pid) => NOTES.filter((n) => (n.links?.person === pid || n.person === pid || n.linkList?.some((l) => l.kind === 'person' && l.id === pid)) && n.kind !== 'fact' && visible(n));
export const factsOf = (pid) => (PERSON_FILE[pid]?.facts ?? []);
export const stats = () => ({ notes: REAL ? items().length : D.NOTE_TOTAL, vault: VAULT.ok ? VAULT.notes : null, total: NOTE_TOTAL, inbox: INBOX.length, filedToday: filedToday().length, savedToday: savedToday().length, people: PEOPLE.length });
export const pending = () => (COL ? COL.pending() : 0);
export const refused = () => (COL ? COL.errors() : new Map());

// ── writes (offline first: on the phone now, on the PC when it answers; the PC's read of it comes back on sync) ───
const nowIso = () => new Date(clock.nowMs()).toISOString();
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
/** A new item. Without a folder it goes to the inbox (the PC suggests where, and files it when it's sure and it came from a share or scan). */
export function addItem(f = {}) {
  if (!REAL) return demoAdd(f);
  const text = String(f.text ?? '').trim();
  const asp = f.aspect && aspect(f.aspect) ? f.aspect : (f.person ? person(f.person)?.aspect : null) ?? null;
  const links = [...(f.links ?? [])];
  if (f.person && !links.some((l) => l.kind === 'person' && l.id === f.person)) links.push({ kind: 'person', id: f.person });
  const doc = clean({
    kind: f.kind ?? (f.person && asp ? 'moment' : 'note'), title: f.title ?? clip(text.replace(/\s+/g, ' '), 64), text, aspect: f.inbox ? null : asp, person: f.person ?? null,
    status: f.inbox || !asp ? 'inbox' : 'filed', author: f.by === 'wyn' || f.by === 'agent' ? 'agent' : 'you', source: f.via ?? f.source ?? 'typed', place: f.where ?? f.place ?? null,
    at: f.at ?? nowIso(), links, pinned: false, hold: f.hold ?? (f.inbox ? true : undefined), content: f.content, thumb: f.thumb, from: f.from, meta: f.meta,
    filed_at: f.inbox || !asp ? null : nowIso(), filed_by: f.inbox || !asp ? null : (f.by === 'wyn' || f.by === 'agent' ? 'agent' : 'you'),
  });
  if (doc.status === 'inbox') doc.suggest = localSuggest(doc);
  const d = COL.add(doc);
  derive('local');
  return note(d.id);
}
export function updateItem(id, patch) { if (!REAL) return null; const d = COL.update(id, patch); derive('local'); return d; }
/** File an inbox item (his tap or the agent's suggestion). Returns an undo. */
export function fileItem(id, { aspect: a = null, person: pid = undefined, by = 'you' } = {}) {
  if (!REAL) return () => {};
  const cur = COL.get(id); if (!cur) return () => {};
  const s = cur.suggest ?? localSuggest(cur);
  const to = a ?? s.to?.[0]?.aspect ?? null;
  if (!to) return null;
  const who = pid === undefined ? (cur.person ?? s.to?.find((t) => t.aspect === to)?.person ?? null) : pid;
  const links = [...(cur.links ?? [])];
  if (who && !links.some((l) => l.kind === 'person' && l.id === who)) links.push({ kind: 'person', id: who });
  const before = { ...cur };
  COL.update(id, { status: 'filed', aspect: to, person: who, links, filed_at: nowIso(), filed_by: by, kind: cur.kind === 'inbox' ? 'note' : cur.kind, sub: cur.aspect === to ? cur.sub : null });
  derive('local');
  return () => { COL.put({ ...before }); derive('local'); };
}
/** The agent filed it on her own: put it back in the inbox (and keep it there). */
export function unfile(id) { if (!REAL) return; COL.update(id, { status: 'inbox', aspect: null, filed_at: null, filed_by: null, auto: false, hold: true }); derive('local'); }
export function moveItem(id, to) { const cur = REAL && COL.get(id); if (!cur) return () => {}; const from = cur.aspect; COL.update(id, { aspect: to, sub: null, status: 'filed', filed_by: 'you', filed_at: nowIso() }); derive('local'); return () => { COL.update(id, { aspect: from, sub: cur.sub }); derive('local'); }; }
export function pinItem(id) { const cur = REAL && COL.get(id); if (!cur) return; COL.update(id, { pinned: !cur.pinned }); derive('local'); }
export function removeItem(id) { const cur = REAL && COL.get(id); if (!cur) return () => {}; COL.remove(id); derive('local'); return () => { COL.put({ ...cur, deleted_at: null }); derive('local'); }; }
export function linkItem(id, link, on = true) {
  const cur = REAL && COL.get(id); if (!cur) return;
  const links = (cur.links ?? []).filter((l) => !(l.kind === link.kind && l.id === link.id));
  if (on) links.push(link);
  COL.update(id, { links }); derive('local');
}
/** A fact on a person's file: one item per key, replaced when it changes. */
export function setFact(pid, key, value) {
  if (!REAL) { const F = (PERSON_FILE[pid] ??= { facts: [], tasks: [], goals: [] }); const f = F.facts.find((x) => x[0] === key); if (f) f[1] = value; else F.facts.push([key, value]); return; }
  const cur = items().find((i) => i.kind === 'fact' && i.person === pid && String(i.title).toLowerCase() === String(key).toLowerCase());
  if (cur) COL.update(cur.id, { text: value });
  else COL.add({ kind: 'fact', title: key, text: value, person: pid, aspect: person(pid)?.aspect ?? 'friends', status: 'filed', author: 'you', source: 'typed', at: nowIso(), links: [{ kind: 'person', id: pid }], filed_at: nowIso(), filed_by: 'you' });
  derive('local');
}
/** After a write reaches the PC, its read of it (suggestion, auto-filing) is on the phone: redraw with it. */
export async function settle() { if (!COL) return; await COL.flush(); derive('server'); }
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// demo mode: the prototype's in-memory behaviour
let TICK = 0;
function demoAdd(f) {
  const folder = (f.aspect && D.FOLDERS[f.aspect] ? f.aspect : null) ?? (f.person ? person(f.person)?.aspect : null) ?? localSuggest(f).to[0]?.aspect ?? 'growth';
  const m = clock.nowMin(); const at = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const n = { id: `x${Date.now().toString(36)}${TICK++}`, folder, sub: null, kind: f.kind ?? (f.person ? 'moment' : 'note'), title: f.title ?? clip(String(f.text ?? ''), 52), by: f.by ?? 'wyn', via: f.via ?? 'you said', day: 'today', at, where: f.where ?? 'Midtown', text: f.text ?? '', links: f.person ? { person: f.person } : {}, fresh: true };
  D.NOTES.unshift(n); D.FOLDERS[folder].count++; D.FOLDERS[folder].updated = at; D.FOLDERS[folder].by = n.by;
  document.dispatchEvent(new CustomEvent('brain-changed', { detail: { why: 'local' } }));
  return n;
}

// ── the PC's side: the summary, search, person files and the vault (cached on the phone for offline) ───────────
const LKEY = (k) => `aos-brain:${k}`;
const lru = (k, v) => { try { const all = API.ls.json(LKEY('lru')) ?? {}; all[k] = { at: Date.now(), v }; const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at); for (const x of keys.slice(60)) delete all[x]; API.ls.set(LKEY('lru'), JSON.stringify(all)); } catch {} };
const lruGet = (k) => { try { return (API.ls.json(LKEY('lru')) ?? {})[k]?.v ?? null; } catch { return null; } };
async function remote(path, key, { timeout = 15000 } = {}) {
  if (!REAL) throw Object.assign(new Error('demo'), { status: 0 });
  try { const r = await API.api(path, { timeout }); if (key) lru(key, r); return r; }
  catch (e) { const c = key ? lruGet(key) : null; if (c) return { ...c, offline: true }; throw e; }
}
export const cached = (key) => lruGet(key);
let sumP = null;
export function refreshSummary() {
  if (!REAL) return Promise.resolve(null);
  sumP ??= API.api(`${EP}/summary`, { timeout: 12000 }).then((s) => {
    if (s?.vault?.ok) { Object.assign(VAULT, { ok: true, notes: s.vault.notes, folders: s.vault.folders ?? [], domains: s.vault.domains ?? [], recent: s.vault.recent ?? [], at: Date.now() }); API.ls.set(VKEY, JSON.stringify(VAULT)); }
    if (s?.meaning) Object.assign(MEANING, { up: !!s.meaning.up, vectors: s.meaning.vectors ?? 0 });
    derive('summary');
    return s;
  }).catch(() => null).finally(() => { setTimeout(() => { sumP = null; }, 30000); });
  return sumP;
}
export const searchRemote = (q, { when = null, place = null, aspect: a = null, private: priv = false } = {}) => {
  const qs = new URLSearchParams({ q, agent: AGENT.name ?? '' });
  if (when && when !== 'any') qs.set('when', when); if (place && place !== 'any') qs.set('place', place); if (a) qs.set('aspect', a);
  if (priv) qs.set('private', '1'); if (!isOwner()) qs.set('vault', '0');
  return remote(`${EP}/search?${qs}`, `s:${qs}`, { timeout: 20000 });
};
export const personRemote = (id) => remote(`${EP}/people/${encodeURIComponent(id)}`, `p:${id}`);
export const vaultNote = (id) => remote(`${EP}/vault/note?id=${encodeURIComponent(id)}`, `vn:${id}`);
export const vaultFolder = (a) => remote(`${EP}/vault/folder?aspect=${encodeURIComponent(a)}&limit=30`, `vf:${a}`);
export const vaultBrowse = (o) => { const qs = new URLSearchParams(Object.entries(o).filter(([, v]) => v)); return remote(`${EP}/vault/browse?${qs}`, `vb:${qs}`); };
export const vaultGraph = () => remote(`${EP}/vault/graph`, 'vg', { timeout: 60000 });
export const vaultCapture = (text) => API.post(`${EP}/vault/capture`, { text });

// ── Spotlight: the Brain's notes, never a private folder (the native side opens agenticos://note/<id>). People index
// themselves (aspects/people-store.js owns persons and clears kind 'person'), so the Brain leaves them alone. ──
let spotT = 0, spotDone = '';
function spotlightSoon() {
  if (!REAL || !API.NATIVE) return;
  clearTimeout(spotT);
  spotT = setTimeout(async () => {
    try {
      const { native } = await import('./svc/native-plugins.js');
      if (!native.available) return;
      const rows = [
        ...NOTES.filter((n) => !n.private && n.kind !== 'fact').slice(0, 300).map((n) => ({ id: n.id, kind: 'note', title: n.title, subtitle: `${aspect(n.folder)?.name ?? 'Brain'} · ${n.text.slice(0, 80)}`, keywords: [aspect(n.folder)?.name, n.sub, n.where].filter(Boolean), url: `agenticos://note/${n.id}` })),
      ];
      const sig = rows.map((r) => `${r.id}:${r.title}`).join('|');
      if (sig === spotDone) return;
      spotDone = sig;
      await native.spotlight.clear({ kind: 'note' });
      if (rows.length) await native.spotlight.index(rows);
    } catch {}
  }, 3000);
}

// small lookups other files use (kept from the prototype)
export const taskTitle = (id) => TASKS.find((t) => String(t.id) === String(id));
export const goalOf = (id) => GOALS.find((g) => String(g.id) === String(id));
export const projectOf = (slug) => PROJECTS.find((p) => p.slug === slug);
export const areaOf = (slug) => AREAS[slug];
// the prototype's graph data, demo only (the live graph is brain-graph.js on MOTION's engine)
export const graphData = D.graphData;

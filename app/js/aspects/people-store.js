// People: the one store behind Family, Friends and Romance (and data.js's PEOPLE). Owner: the PEOPLE agent.
// Nine offline-first collections on /api/v1/mod/people/* (svc/store: optimistic, an outbox with client ids, LWW), the
// calendar's view of his people (GET /mod/people/calendar, cached on the phone), and the shared reads every app needs:
// who is warm or due against the rhythm he set, a week's time together, the next time a date comes round.
// Real mode starts from what the PC has: the owner's four real people (seeded there once), nothing invented, dates
// never guessed. Demo mode (?data=demo) fills the same collections with the prototype's sample (people-demo.js).
//
//   import * as P from './people-store.js';
//   P.persons('family') · P.person(id) · P.moments({ aspect, person }) · P.warmth(id) · P.datesFor({ person })
//   P.logMoment({ people, title, … }) · P.add('ideas', {…}) · P.update(kind, id, patch) · P.remove(kind, id) · P.restore(kind, doc)
//   P.onPeople(fn) · P.calendar() · P.pickContact() · P.faceId(reason)
import { collection } from '../svc/store.js';
import * as clock from '../svc/clock.js';
import { api as http, clientId, NATIVE } from '../svc/api.js';
import { native } from '../svc/native-plugins.js';
import { DEMO_MODE, PEOPLE, USER } from '../data.js';
import { demoDocs } from './people-demo.js';

const G = globalThis;
const EP = (n) => `/api/v1/mod/people/${n}`;
const stamp = (d) => `${d.date ?? ''}${d.at ?? ''}${d.created_at ?? ''}`;
const newest = (a, b) => stamp(b).localeCompare(stamp(a));
const bySort = (a, b) => (a.sort ?? 99) - (b.sort ?? 99) || String(a.name ?? a.title ?? '').localeCompare(String(b.name ?? b.title ?? ''));
export const KINDS = ['persons', 'moments', 'plans', 'ideas', 'rhythms', 'dates', 'journal', 'drafts', 'state'];
const SORT = { persons: bySort, moments: newest, journal: newest, rhythms: bySort, plans: (a, b) => String(a.date ?? '9').localeCompare(String(b.date ?? '9')) };
const PREFIX = { persons: 'pe', moments: 'mo', plans: 'pl', ideas: 'id', rhythms: 'rh', dates: 'dt', journal: 'jn', drafts: 'dr', state: 'st' };
export const col = Object.fromEntries(KINDS.map((k) => [k, collection(`people/${k}`, { endpoint: EP(k), sort: SORT[k] ?? null, prefix: PREFIX[k] })]));
export const ready = Promise.all(KINDS.map((k) => col[k].ready));

// ── the sample, in demo mode only ─────────────────────────────────────
if (DEMO_MODE) {
  const docs = demoDocs();
  for (const k of KINDS) for (const d of docs[k] ?? []) col[k].put({ created_at: '2026-10-01T00:00:00.000Z', ...d }, { touch: false });
}

// ── time ──────────────────────────────────────────────────────────────
export const today = () => clock.today();
export const nowHm = () => clock.hm(clock.nowMin());
export const nowMin = () => clock.nowMin();
export const addDays = clock.addDays;
export const daysBetween = clock.daysBetween;
export const mondayOf = (iso = today()) => clock.addDays(iso, -((clock.dparts(iso).dow + 6) % 7));
/** Mon..Sun of the week holding iso. */
export const weekOf = (iso = today()) => { const m = mondayOf(iso); return Array.from({ length: 7 }, (_, i) => clock.addDays(m, i)); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WDS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WDL = clock.WEEKDAYS;
export const dayShort = (iso) => { const p = clock.dparts(iso); return `${WDS[p.dow]} ${p.day} ${MON[p.month]}`; };
export const fmtDay = (iso, o = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' });
export const weekday = (iso, long = false) => (long ? WDL : WDS)[clock.dparts(iso).dow];
/** "Today", "Yesterday", "Tomorrow", "Tuesday" (this week), then "Sun 18 Oct". */
export function relDay(iso) {
  const n = clock.daysBetween(today(), iso);
  if (n === 0) return 'Today';
  if (n === -1) return 'Yesterday';
  if (n === 1) return 'Tomorrow';
  if (n < 0 && n > -6) return WDL[clock.dparts(iso).dow];
  return fmtDay(iso);
}
export const inDays = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n} days ago` : `in ${n} days`);
export const ago = (iso) => { const n = clock.daysBetween(iso, today()); return n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`; };
/** The next time an annual MM-DD comes round, on or after today. */
export function nextAnnual(md) { const y = Number(today().slice(0, 4)); const a = `${y}-${md}`; return clock.daysBetween(today(), a) >= 0 ? a : `${y + 1}-${md}`; }
/** When a date doc next happens (ISO), or null while it isn't known. */
export function nextOf(d) {
  if (!d) return null;
  if (d.annual && d.md) return nextAnnual(d.md);
  if (d.date) return d.date;
  if (d.md) return nextAnnual(d.md);
  return null;
}

// ── reads ─────────────────────────────────────────────────────────────
export const persons = (aspect = null) => col.persons.list().filter((p) => !aspect || p.aspect === aspect);
export const person = (id) => col.persons.get(id);
export const nameOf = (id) => person(id)?.name ?? '';
export const namesOf = (ids = []) => { const n = ids.map(nameOf).filter(Boolean); return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`; };
/** Moments, newest first. kept: false includes the ones let go in a weekly review. */
export function moments({ aspect = null, person: pid = null, from = null, to = null, kept = true } = {}) {
  return col.moments.list().filter((m) => (!kept || !m.let_go) && (!aspect || m.aspect === aspect) && (!pid || (m.people ?? []).includes(pid))
    && (!from || m.date >= from) && (!to || m.date <= to));
}
export const moment = (id) => col.moments.get(id);
export const rhythmsOf = (pid) => col.rhythms.list().filter((r) => r.person === pid);
/** The rhythm that places a friend in the circle: the first that isn't the nightly dinner. */
export const mainRhythm = (pid) => { const rs = rhythmsOf(pid); return rs.find((r) => !r.dinner) ?? rs[0] ?? null; };
export const datesFor = ({ aspect = null, person: pid = null } = {}) => col.dates.list().filter((d) => (!aspect || d.aspect === aspect || (d.people ?? []).some((x) => person(x)?.aspect === aspect)) && (!pid || (d.people ?? []).includes(pid)));
export const birthdayOf = (pid) => col.dates.list().find((d) => d.kind === 'birthday' && (d.people ?? []).length === 1 && d.people[0] === pid) ?? null;
export const plansFor = ({ aspect = null, person: pid = null, open = false } = {}) => col.plans.list().filter((p) => (!aspect || p.aspect === aspect) && (!pid || (p.people ?? []).includes(pid)) && (!open || !['done', 'dropped'].includes(p.state)));
export const ideasFor = ({ aspect = null, person: pid = null, kind = null } = {}) => col.ideas.list().filter((i) => (!aspect || i.aspect === aspect) && (!pid || i.person === pid) && (!kind || i.kind === kind));
export const draftsFor = (pid) => col.drafts.list().filter((d) => d.person === pid && d.state === 'draft');
export const journal = (kind = null) => col.journal.list().filter((j) => !kind || j.kind === kind);
export const state = (id) => col.state.get(id);

// ── warmth: where someone stands against the rhythm he set (the server's agentos warmthOf, the same rules) ──
export function counts(m, r) {
  if (r?.mode === 'meet' && m.kind !== 'meet') return false;
  if (r?.act && m.act !== r.act && !(r.act === 'meal' && m.dinner)) return false;
  if (r?.dinner && !m.dinner && m.act !== 'meal') return false;
  if (r?.solo && (m.people?.length ?? 0) > 1) return false;
  return true;
}
/** { band: warm | due | drift | none, days, x (0 now · 1 due · 2 twice over), last, every, mode } */
export function warmth(pid, r = mainRhythm(pid)) {
  const t = today();
  const last = moments({ person: pid }).find((m) => m.date <= t && counts(m, r)) ?? null;
  if (!last) return { band: 'none', days: null, x: null, last: null, every: r?.every ?? null, mode: r?.mode ?? 'any', rhythm: r };
  const days = clock.daysBetween(last.date, t);
  const x = r?.every ? days / r.every : 0;
  return { band: x <= 1 ? 'warm' : x <= 2 ? 'due' : 'drift', days, x, last, every: r?.every ?? null, mode: r?.mode ?? 'any', rhythm: r };
}
/** Minutes together on a day (or a week), with anyone in ids (null = anyone in the aspect). */
export const minutesOn = (iso, { aspect = null, person: pid = null } = {}) => moments({ aspect, person: pid, from: iso, to: iso }).reduce((a, m) => a + (m.minutes || 0), 0);
export const minutesIn = (days, o = {}) => days.reduce((a, d) => a + minutesOn(d, o), 0);

// ── the calendar's view: events that name a person (birthdays, plans), cached for offline ──
const CAL_KEY = 'aos-people:calendar';
let CAL = (() => { try { return JSON.parse(G.localStorage?.getItem(CAL_KEY) ?? 'null'); } catch { return null; } })();
export const calendar = () => (DEMO_MODE ? [] : CAL?.items ?? []);
export async function refreshCalendar() {
  if (DEMO_MODE) return;
  try {
    const r = await http(EP('calendar'), { timeout: 15000 });
    CAL = { at: Date.now(), items: r.items ?? [] };
    try { G.localStorage?.setItem(CAL_KEY, JSON.stringify(CAL)); } catch {}
    tell('calendar');
  } catch {}
}
/** Once a day the PC files what the calendar knows (past events with someone, birthdays). The 23:15 job does it too. */
async function fileCalendar() {
  if (DEMO_MODE || !USER?.owner) return;
  const k = 'aos-people:filed';
  try { if (G.localStorage?.getItem(k) === today()) return; } catch {}
  try {
    const r = await http(EP('calendar/file'), { method: 'POST', timeout: 20000 });
    try { G.localStorage?.setItem(k, today()); } catch {}
    if (r?.filed || r?.birthdays?.length) { col.moments.refresh(); col.dates.refresh(); }
  } catch {}
}

// ── writes (optimistic; the store sends them) ─────────────────────────
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
export function add(kind, fields) { return col[kind].add(clean(fields)); }
export function update(kind, id, patch) { return col[kind].get(id) ? col[kind].update(id, clean(patch)) : null; }
export function remove(kind, id) { return col[kind].remove(id); }
/** Put a removed doc back (undo). */
export function restore(kind, doc) { return col[kind].put({ ...doc, deleted_at: null }); }
export function setState(id, patch) { const cur = col.state.get(id); return cur ? col.state.update(id, patch) : col.state.put({ id, ...patch }); }
/** A moment, with the defaults every app uses: today, now, 0 minutes, in person, logged by him. */
export function logMoment(f = {}) {
  const ps = (f.people ?? []).filter(Boolean);
  const aspect = f.aspect ?? (ps.length && ps.every((id) => person(id)?.aspect === person(ps[0])?.aspect) ? person(ps[0])?.aspect : 'friends');
  return add('moments', { date: today(), at: nowHm(), minutes: 0, kind: 'meet', by: 'you', source: 'you', ...f, people: ps, aspect });
}
const slugOf = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'person';
const REL_ASPECT = { family: 'family', friend: 'friends', new: 'friends', partner: 'romance' };
/** Someone new. id from the name (riya, riya-2); a Contacts pick brings phones, emails and a birthday. */
export function addPerson({ name, rel = 'friend', role = null, where = null, note = null, follow = null, pronoun = null, contact = null } = {}) {
  const n = String(name ?? '').trim();
  if (!n) return null;
  let id = slugOf(n); for (let i = 2; col.persons.get(id) || col.persons.docs.has(id); i++) id = `${slugOf(n)}-${i}`;
  const aspect = REL_ASPECT[rel] ?? 'friends';
  const p = add('persons', { id, name: n, rel, aspect, role: role ?? (where ? `Met at ${where}` : null), where, note, follow, pronoun, file: `people/${aspect}/${id}`,
    sort: 50 + persons().length, added: today(), contact: contact ? { id: contact.id ?? null, phones: contact.phones ?? [], emails: contact.emails ?? [] } : null });
  const b = contact?.birthday;
  if (b?.month && b?.day) {
    const md = `${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`;
    add('dates', { id: clientId('dt'), kind: 'birthday', people: [id], aspect, md, year: b.year ?? null, annual: true, title: `${n}'s birthday`, source: 'contacts' });
  }
  if (note) add('ideas', { kind: 'plan', person: id, aspect, title: note, from: 'When you added them', done: false, by: 'you' });
  return p;
}
/** Set (or change) a birthday or another date he knows. Never called with a guess. */
export function setDate({ id = null, kind, people: ps, md = null, date = null, year = null, title, aspect = null, source = 'you' }) {
  const annual = kind === 'birthday' || kind === 'anniversary';
  const doc = clean({ kind, people: ps, md, date, year, annual, title, aspect: aspect ?? person(ps?.[0])?.aspect ?? null, source });
  const cur = id ? col.dates.get(id) : kind === 'birthday' ? birthdayOf(ps?.[0]) : null;
  return cur ? update('dates', cur.id, doc) : add('dates', doc);
}

// ── listening ─────────────────────────────────────────────────────────
const subs = new Set();
let pend = null, pendWhy = new Set();
function tell(kind, why = 'local') {
  pendWhy.add(kind);
  if (pend) return;
  pend = requestAnimationFrame(() => {
    const kinds = pendWhy; pendWhy = new Set(); pend = null;
    if (kinds.has('persons')) syncPeople();
    for (const fn of subs) { try { fn({ kinds, why }); } catch (e) { console.warn('[people] listener', e); } }
    summarySoon(kinds);
  });
}
/** Run fn(person) once that person is in the store (a deep link at boot can arrive before the PC's copy), up to 8 s. */
export function whenPerson(id, fn) {
  const p = col.persons.get(id); if (p) { fn(p); return; }
  let off = null; const t = setTimeout(() => off?.(), 8000);
  off = onPeople(() => { const q = col.persons.get(id); if (q) { off(); clearTimeout(t); fn(q); } });
}
/** fn({ kinds: Set, why }) after any people data changed (coalesced to one frame). Returns unsubscribe. */
export function onPeople(fn) { subs.add(fn); return () => subs.delete(fn); }
for (const k of KINDS) col[k].on('change', ({ why }) => { if (why !== 'error') tell(k, why); });

// data.js's PEOPLE (Life, the Brain, Scan read it) is these persons, in the prototype's shape; areas redraw on data-changed
let lastSig = '';
let fireT = 0;
function syncPeople() {
  if (DEMO_MODE) return;
  const list = persons().map((p) => {
    const w = warmth(p.id);
    return { id: p.id, name: p.name, rel: p.rel, role: p.role ?? '', aspect: p.aspect, file: p.file ?? `people/${p.aspect}/${p.id}`, last: w.last ? lastLine(w.last) : 'Nothing logged yet', pronoun: p.pronoun ?? null };
  });
  const sig = JSON.stringify(list);
  if (sig === lastSig) return;
  lastSig = sig;
  PEOPLE.length = 0; PEOPLE.push(...list);
  clearTimeout(fireT);
  fireT = setTimeout(() => G.document?.dispatchEvent(new CustomEvent('data-changed', { detail: { why: 'people' } })), 120);
  spotlight(list);
}
// Today and Life redraw an app's figures on 'aspect-summary' { id } (the lead's event)
let sumT = 0; const sumIds = new Set();
function summarySoon(kinds) {
  if (kinds.has('journal') || kinds.has('state')) sumIds.add('romance');
  if ([...kinds].some((k) => k !== 'journal')) { sumIds.add('family'); sumIds.add('friends'); }
  clearTimeout(sumT);
  sumT = setTimeout(() => { for (const id of sumIds) G.document?.dispatchEvent(new CustomEvent('aspect-summary', { detail: { id } })); sumIds.clear(); }, 150);
}
export function lastLine(m) {
  const d = relDay(m.date);
  const how = m.kind === 'chat' ? 'a chat' : m.kind === 'call' ? 'a call' : '';
  return how ? `${d}, ${how}` : d;
}

// Spotlight on the iPhone: search "Dad" from the home screen and land on his page
let spotT = 0;
function spotlight(list) {
  if (!native.available) return;
  clearTimeout(spotT);
  spotT = setTimeout(async () => {
    try {
      await native.spotlight.clear({ kind: 'person' });
      if (list.length) await native.spotlight.index(list.map((p) => ({ id: p.id, kind: 'person', title: p.name, subtitle: p.role || (p.aspect === 'family' ? 'Family' : 'Friends'), keywords: [p.aspect], url: `agenticos://person/${p.id}` })));
    } catch {}
  }, 1500);
}

// ── native: Contacts and Face ID, each with its web fallback ──────────
export const canPickContact = () => NATIVE && native.available;
/** → { name, given, family, phones, emails, birthday: { day, month, year? } } or null (cancelled, or the web). */
export async function pickContact() {
  const r = await native.contacts.pick();
  if (!r?.ok || !r.contact) return null;
  const c = r.contact;
  return { id: c.id ?? null, name: c.nickname || c.name || [c.given, c.family].filter(Boolean).join(' '), given: c.given ?? '', family: c.family ?? '', phones: c.phones ?? [], emails: c.emails ?? [], birthday: c.birthday ?? null, org: c.org ?? null };
}
/** Face ID on the iPhone: { ok } · { ok: false, cancelled } · { available: false } on the web or without biometrics. */
export async function faceId(reason) {
  const st = await native.auth.status();
  if (!st?.available || st.biometry === 'none') return { available: false };
  const r = await native.auth.authenticate({ reason, passcode: true });
  return { available: true, ok: !!r?.ok, cancelled: !!r?.cancelled };
}

// ── start: refresh the calendar view now and every 30 minutes while visible; file it once a day ──
if (!DEMO_MODE) {
  ready.then(() => { syncPeople(); refreshCalendar(); fileCalendar(); });
  G.setInterval?.(() => { if (G.document?.visibilityState === 'visible') refreshCalendar(); }, 30 * 60000);
  G.document?.addEventListener('visibilitychange', () => { if (G.document.visibilityState === 'visible' && (!CAL || Date.now() - CAL.at > 10 * 60000)) refreshCalendar(); });
} else ready.then(() => tell('persons', 'load'));


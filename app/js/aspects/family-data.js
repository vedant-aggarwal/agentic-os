// Family: the reads and numbers behind the app, on the people store (js/aspects/people-store.js). Owner: the PEOPLE agent.
// Real mode: the people in Family are the PC's (the owner's parents, plus anyone he adds); time together, the
// dinner streak and the rings come from moments (his, the agent's, the calendar's); dates nobody told us show "Add date".
// Demo mode: the same reads over the prototype's sample (people-demo.js), the clock pinned to Thu 22 Oct 17:40.
import { DEMO_MODE, FUNDS, TASKS, EVENTS } from '../data.js';
import * as P from './people-store.js';

export { fmtDay, relDay, inDays } from './people-store.js';
export const today = () => P.today();
export const week = () => P.weekOf(P.today());
export const daysFrom = (iso, from = P.today()) => P.daysBetween(from, iso);
export const dayGoal = () => P.state('family')?.dayGoal ?? 60;   // his rhythm: an hour of proper time together a day
export const weekGoal = () => 7 * dayGoal();

// ── UI state for the session (filters, the moment that just landed) ──
export const S = { filter: 'all', fresh: null };

// where a moment came from, in his words
export const SOURCE = {
  said: 'from what you said', chat: 'from a chat you shared', share: 'from a chat shared in', calendar: 'from your calendar', call: 'from your morning call',
  voice: 'from a voice note', session: 'from a together session', contacts: 'from Contacts',
};
// what it was (the store's act; a call or a chat is its kind)
export const KINDS = [['meal', 'Meal'], ['talk', 'Talk'], ['shop', 'At the shop'], ['help', 'Helped out'], ['outing', 'Outing'], ['call', 'Call']];

// ── the people at home ───────────────────────────────────────────────
export const homeIds = () => P.persons('family').map((p) => p.id);
export const personOf = (id) => P.person(id) ?? { id, name: id };
export const namesOf = (ids) => P.namesOf(ids);
// "Mom and Dad" reads more naturally than "Dad and Mom"
export const withNames = (ids) => P.namesOf([...ids].sort((a, b) => (a === 'mom' ? -1 : b === 'mom' ? 1 : 0)));
export const pron = (id) => { const p = P.person(id)?.pronoun; return p === 'she' ? ['she', 'her', 'her'] : p === 'he' ? ['he', 'him', 'his'] : ['they', 'them', 'their']; };

// ── moments, in the Family view's shape ───────────────────────────────
const view = (d) => ({
  id: d.id, date: d.date, at: d.at ?? '', min: d.minutes ?? 0, people: d.people ?? [],
  kind: d.kind === 'chat' ? 'chat' : d.kind === 'call' ? 'call' : (d.act ?? 'talk'),
  title: d.title || 'Time together', text: d.text ?? '', said: d.said ?? null, saidNote: d.saidNote ?? null,
  chat: d.chat ? d.chat.map(([w, t]) => [w === 'me' ? 'me' : (w === 'them' ? d.people?.[0] : w), t]) : null,
  by: d.by === 'wyn' ? 'wyn' : 'you', from: d.source ?? 'you', dinner: !!d.dinner, quiet: !!d.quiet, raw: d,
});
/** Every family moment he keeps (let-go ones leave), newest first. */
export const kept = () => P.moments({ aspect: 'family' }).map(view);
/** The ones the journal shows (demo's quiet dinner markers only count toward the streak). */
export const shown = () => kept().filter((m) => !m.quiet);
export const momentById = (id) => { const d = P.moment(id); return d ? view(d) : null; };
export const minutesOn = (iso, who = null) => kept().filter((m) => m.date === iso && (!who || m.people.includes(who))).reduce((a, m) => a + (m.min || 0), 0);
export const weekMinutes = (who = null) => week().reduce((a, d) => a + minutesOn(d, who), 0);
export const weekMoments = () => { const w = week(); return shown().filter((m) => w.includes(m.date)); };
export const dinnerOn = (iso) => kept().some((m) => m.date === iso && m.dinner);
export const dinnersThisWeek = (who = null) => week().filter((d) => kept().some((m) => m.date === d && m.dinner && (!who || m.people.includes(who)))).length;
/** Days in a row with a dinner together, counting back from today (today counts once it's in, else from yesterday). */
export function streak() {
  const days = new Set(kept().filter((m) => m.dinner).map((m) => m.date));
  let d = days.has(today()) ? today() : P.addDays(today(), -1), n = 0;
  while (days.has(d)) { n++; d = P.addDays(d, -1); }
  return n;
}
/** The month's dinner days (day numbers) and its best run. */
export function dinnerMonth(iso = today()) {
  const ym = iso.slice(0, 7);
  const set = new Set(kept().filter((m) => m.dinner && m.date.startsWith(ym)).map((m) => Number(m.date.slice(8))));
  let best = 0, run = 0;
  for (let d = 1; d <= 31; d++) { if (set.has(d)) { run++; best = Math.max(best, run); } else run = 0; }
  return { set, best };
}

// ── rhythms (keep warm) and what to remember ──────────────────────────
export const rhythmsOf = (id) => P.rhythmsOf(id);
export const remember = (id) => P.person(id)?.remember ?? [];

// ── tonight's dinner: a family dinner on today's calendar (the sample's e7 in demo) ──
const FAMILY_WORDS = /\b(dinner|khana|khaana)\b/i;
export function tonight() {
  const ids = homeIds(); const names = ids.map((id) => P.person(id)?.name).filter(Boolean);
  return EVENTS.find((e) => e.id === 'e7') ?? EVENTS.find((e) => FAMILY_WORDS.test(e.title ?? '') && (/\b(home|family|ghar)\b/i.test(e.title) || names.some((n) => e.title.includes(n)))) ?? null;
}

// ── dates: the ones he or his calendar told us, and "Add date" rows for the ones nobody did ──
const ICON = { birthday: 'cake', anniversary: 'rings', festival: 'diya', other: 'cal' };
export function dates() {
  const ids = homeIds();
  const docs = P.datesFor({ aspect: 'family' });
  const out = docs.map((d) => ({ id: d.id, title: d.title, kind: d.kind, icon: ICON[d.kind] ?? 'cal', who: d.people ?? [], note: d.note ?? (d.source === 'calendar' ? 'From your calendar' : d.source === 'contacts' ? 'From Contacts' : ''), doc: d, iso: P.nextOf(d), year: d.year ?? null }));
  for (const id of ids) if (!docs.some((d) => d.kind === 'birthday' && (d.people ?? []).length === 1 && d.people[0] === id))
    out.push({ id: `add-bday-${id}`, title: `${personOf(id).name}'s birthday`, kind: 'birthday', icon: 'cake', who: [id], placeholder: true, person: id });
  if (ids.length >= 2 && !docs.some((d) => d.kind === 'anniversary'))
    out.push({ id: 'add-wedding', title: 'Wedding anniversary', kind: 'anniversary', icon: 'rings', who: ids.slice(0, 2), placeholder: true });
  return out;
}
export const sortedDates = () => { const all = dates(); const known = all.filter((d) => d.iso).sort((a, b) => a.iso.localeCompare(b.iso)); return [...known, ...all.filter((d) => !d.iso)]; };
export const wedding = () => P.datesFor({ aspect: 'family' }).find((d) => d.kind === 'anniversary') ?? null;

// ── what's planned on a day: plans, family events on the calendar, tonight's dinner ──
export function planned(iso) {
  const out = P.plansFor({ aspect: 'family', open: true }).filter((p) => p.date === iso).map((p) => ({ icon: /shop/i.test(p.title) ? 'shop' : /dinner|anniv/i.test(p.title) ? 'rings' : 'cal', text: p.title, at: p.slot ?? '', by: p.by, plan: p.id }));
  const ids = new Set(homeIds());
  for (const e of P.calendar()) if (e.date === iso && e.kind !== 'birthday' && e.people.some((x) => ids.has(x))) out.push({ icon: 'cal', text: e.title, at: e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }), cal: e.id });
  const t = tonight();
  if (iso === today() && t && !dinnerOn(iso) && !out.some((x) => x.text === t.title)) out.unshift({ icon: 'plate', text: t.title, at: `${String(Math.floor(t.start / 60)).padStart(2, '0')}:${String(t.start % 60).padStart(2, '0')}`, ev: t.id });
  return out;
}
export const plans = () => P.plansFor({ aspect: 'family', open: true });
export const gifts = (who = null) => P.ideasFor({ aspect: 'family', kind: 'gift' }).filter((g) => !who || g.person === who);
export const showups = () => P.ideasFor({ aspect: 'family', kind: 'showup' });
export const session = () => { const s = P.state('session:family'); return s?.active ? { start: Date.parse(s.start), people: s.people ?? homeIds(), at: s.at ?? P.nowHm(), base: s.base ?? 0 } : null; };

// ── where Family meets Work and Money for one person: his real tasks that name them (Dad's shop), never a work page ──
const SHOP_AREAS = new Set(['morgan-co', 'corner-market']);
export function workFor(id) {
  if (DEMO_MODE) return id === 'dad' ? [
    { title: 'Corner Market listings at the shop', meta: 'Today 15:00 to 16:15 · in your calendar', act: 'fam-ev', id: 'e4', done: true },
    { title: 'Close the website payment', meta: 'Fri 23 · a task in Work', act: 'fam-task', id: 't14' },
    { title: 'Online sales this month', meta: 'Corner Market · in Money', act: 'fam-money' },
  ] : [];
  const p = P.person(id); if (!p) return [];
  const words = [p.name, ...(p.aliases ?? [])].map((w) => String(w).toLowerCase());
  const named = (t) => { const s = ` ${String(t ?? '').toLowerCase()} `; return words.some((w) => w.length > 2 && new RegExp(`[^a-z]${w}(['’]s)?[^a-z]`).test(s)); };
  const rows = TASKS.filter((t) => t.list !== 'done' && named(t.title)).slice(0, 3)
    .map((t) => ({ title: t.title, meta: `${t.when ? `${t.when} · ` : ''}a task in Work`, act: 'fam-task', id: t.id }));
  if (id === 'dad' || rows.length) for (const e of EVENTS.filter((e) => SHOP_AREAS.has(e.area) && !e.sleep).slice(0, 1)) rows.push({ title: e.title, meta: `Today · in your calendar`, act: 'fam-ev', id: e.id });
  return rows;
}

// ── the 25th: a countdown once the wedding date (with its year) is known; the fund is Money's (sample in demo) ──
export const FUND = DEMO_MODE ? FUNDS.anniversary : null;
export const fundP = () => (FUND ? FUND.saved / FUND.target : 0);

// Friends: the reads, templates and date helpers the app needs, on the people store (people-store.js). Owner: the PEOPLE agent.
// People come only from the store (the owner's friends, plus anyone he adds). Nothing here invents a friend or
// a fact: what isn't known shows as "not on file yet" so the agent asks instead of guessing. The real clock everywhere.
import { EVENTS, DAYS, GOALS, TASKS, DEMO_MODE } from '../data.js';
import * as P from './people-store.js';

export const today = () => P.today();
export const daysBetween = (a, b = P.today()) => P.daysBetween(a, b);
export const weekday = (iso, long = false) => P.weekday(iso, long);
export const dayLabel = (iso) => P.dayShort(iso);
export const when = (iso) => { const n = P.daysBetween(iso, P.today()); return n === 0 ? 'Today' : n === 1 ? 'Yesterday' : n === -1 ? 'Tomorrow' : P.dayShort(iso); };
export const ago = (iso) => P.ago(iso);
export const shiftIso = (iso, n) => P.addDays(iso, n);
export const thisWeek = () => P.weekOf(P.today());
export const isThisWeek = (iso) => { const w = thisWeek(); return !!iso && iso >= w[0] && iso <= w[6]; };

// ── the circle: friends with a rhythm; people met recently (rel: new) grow in Grow until he sets one ──
export const circleIds = () => P.persons('friends').filter((p) => p.rel !== 'new').map((p) => p.id);
export const newIds = () => P.persons('friends').filter((p) => p.rel === 'new').map((p) => p.id);
export const allIds = () => P.persons('friends').map((p) => p.id);
export const rhythmOf = (id) => P.mainRhythm(id);
const r0 = (l) => (l ? l.charAt(0).toLowerCase() + l.slice(1) : 'no rhythm yet');
export const rhythmLabel = (id) => rhythmOf(id)?.label ?? 'No rhythm yet';
export const rhythmShort = (id) => { const r = rhythmOf(id); if (!r) return 'no rhythm'; const e = r.every === 7 ? 'every week' : r.every === 14 ? 'every two weeks' : r.every === 30 ? 'every month' : `every ${r.every} days`; return r.mode === 'talk' ? `a chat ${e}` : e; };

// how far a friend is from the rhythm he set: 0 = just saw them, 1 = due today, 2 = twice over. Never logged: on the due line.
export const drift = (id) => { const w = P.warmth(id); return w.band === 'none' ? 1.5 : Math.max(0, w.x ?? 0); };
export const warmth = (id) => Math.max(0, Math.min(1, 1 - drift(id) / 2));
export const band = (id) => { const w = P.warmth(id); return w.band === 'none' ? 'none' : w.band; };
export function status(id) {
  const w = P.warmth(id);
  if (w.band === 'none') { const l = rhythmLabel(id); return { band: 'none', short: 'Not yet', line: r0(l), w }; }
  const n = w.days, what = w.last?.kind === 'chat' ? 'a chat' : w.last?.kind === 'call' ? 'a call' : 'in person';
  if (w.band === 'warm') return { band: 'warm', short: n === 0 ? 'Today' : `${n} days`, line: n === 0 ? `Warm · ${what} today` : `Warm · ${P.ago(w.last.date)}`, w };
  return { band: w.band, short: `${n} days`, line: `Due · ${n} days · ${rhythmShort(id)}`, over: n - (w.every ?? 7), dueSince: P.addDays(w.last.date, w.every ?? 7), w };
}

// ── moments, in the Friends view's shape ──────────────────────────────
const FROM_OF = { you: 'typed', chat: 'screenshot', share: 'share', said: 'said', calendar: 'calendar', session: 'said', voice: 'said', call: 'said', contacts: 'typed' };
const ACT_OF = { meal: 'food' };
export const view = (d) => ({
  id: d.id, date: d.date, time: d.at ?? '', people: d.people ?? [], kind: d.kind ?? 'meet', act: ACT_OF[d.act] ?? d.act ?? null, acts: d.acts ?? null,
  title: d.title ?? '', text: d.text ?? '', by: d.by === 'wyn' ? 'wyn' : 'you', from: FROM_OF[d.source] ?? 'typed', quote: d.said ?? d.quote ?? null, loop: d.loop ?? null,
  chat: d.chat ? d.chat.map(([w, t]) => [w === 'me' ? 'me' : 'them', t]) : null, minutes: d.minutes ?? 0, raw: d,
});
export const moments = (o = {}) => P.moments({ aspect: 'friends', ...o }).map(view);
export const momentById = (id) => { const d = P.moment(id); return d ? view(d) : null; };
export const KIND = { meet: 'In person', call: 'Call', chat: 'Chat' };
export const FROM = {
  screenshot: 'from a screenshot you shared',
  share: 'from WhatsApp, shared in',
  said: 'from what you said',
  calendar: 'from your calendar',
  typed: 'You logged it',
};

// ── this month's weeks (Mon–Sun): did he see a friend in person in each? ──
export function monthWeeks(iso = P.today()) {
  const ym = iso.slice(0, 7), cur = P.mondayOf(iso);
  let mon = P.mondayOf(`${ym}-01`); if (mon.slice(0, 7) < ym) mon = P.addDays(mon, 7);   // the weeks that start in this month
  const out = [];
  // a week before anything was logged isn't "missed": the app wasn't keeping count yet
  const first = moments().map((m) => m.date).sort()[0] ?? null;
  for (; mon.slice(0, 7) === ym; mon = P.addDays(mon, 7)) {
    const end = P.addDays(mon, 6);
    const seen = mon <= cur ? moments({ from: mon, to: end }).find((m) => m.kind === 'meet') : null;
    const state = seen ? 'done' : mon < cur ? (first && first <= end ? 'missed' : 'pre') : mon === cur ? 'now' : 'ahead';
    out.push({ id: mon, label: `${Number(mon.slice(8))}–${Number(end.slice(8))}`, state, who: seen?.people?.[0] ?? null, left: mon === cur ? P.daysBetween(iso, end) : null });
  }
  return out;
}
/** A real goal about seeing friends, if he has one (the sample's g9 in demo). */
export const friendGoal = () => (DEMO_MODE ? GOALS.find((g) => g.id === 'g9') : GOALS.find((g) => /\bfriend/i.test(g.title ?? ''))) ?? null;
/** His open tasks that name a friend. */
export function tasksFor(id) {
  const p = P.person(id); if (!p) return [];
  const words = [p.name, ...(p.aliases ?? [])].map((w) => String(w).toLowerCase()).filter((w) => w.length > 2);
  return TASKS.filter((t) => t.list !== 'done' && words.some((w) => new RegExp(`\\b${w}\\b`, 'i').test(t.title ?? ''))).slice(0, 2);
}

// ── plans: ideas beyond food (activities, not facts), on the next free weekend slots ──
const nextDow = (dow, from = P.today()) => { for (let i = 0; i < 8; i++) { const d = P.addDays(from, i); if (P.weekday(d) === dow && (i > 0 || P.nowMin() < 17 * 60)) return d; } return P.addDays(from, 7); };
export const SLOTS = () => [['Sat', '06:30'], ['Sat', '19:00'], ['Sun', '16:00'], ['Sun', '18:00']].map(([d, t]) => `${d} ${t}`);
export const slotIso = (slot) => nextDow(slot.slice(0, 3));
export const IDEAS = {
  gym: { id: 'gym', title: 'Gym together', line: 'Bring them to your morning session. Food after still counts.', slot: 'Sat 06:30', link: ['body', 'Your training is in Body'] },
  drive: { id: 'drive', title: 'A drive', line: 'Parathas on the highway, an hour or so each way.', slot: 'Sat 19:00' },
  film: { id: 'film', title: 'A film', line: 'An evening show. Wyn checks what’s on near you.', slot: 'Sun 18:00' },
  chai: { id: 'chai', title: 'Chai and a walk', line: 'Easy to say yes to. Meet halfway.', slot: 'Sun 16:00' },
};
export const ideasFor = (id) => P.person(id)?.ideas ?? ['chai', 'film', 'drive'];

// Message templates. The agent's own drafts (people_drafts) come first; these are ways to start. He sends them himself.
export function drafts(id) {
  const n = P.nameOf(id) || 'there';
  const mine = P.draftsFor(id).map((d) => d.text);
  const base = {
    hinglish: [`${n}, is weekend free hai? Milte hain.`, `${n}, kya chal raha hai aajkal? Kab mil rahe?`, `${n}, ek film chalein is weekend? Shaam ka show.`],
    english: [`${n}, free this weekend? Let’s meet.`, `What’s new with you, ${n}? When are we meeting?`, `Up for a film this weekend, ${n}? An evening show.`],
    tags: ['This weekend', 'What’s new', 'A film'],
  };
  if (!mine.length) return base;
  return { hinglish: [...mine, ...base.hinglish].slice(0, 3), english: [...mine, ...base.english].slice(0, 3), tags: ['Wyn’s draft', ...base.tags].slice(0, 3), own: mine.length };
}
export const opener = (k, id) => ({ now: 'Aur bata, aajkal kya chal raha hai? College, kaam, sab?', college: 'Btw tu abhi kaunse college mein hai? Kaisa lag raha?' }[k] ?? `${P.nameOf(id)}, aajkal kya chal raha hai?`);

// ── grow: where his next friend could come from, read from his own calendar this week (classes, the gym, clubs) ──
const ROOM = /\b(tutorial|lecture|class|seminar|lab|gym|club|meetup|workshop|society|practice|session|fest|event)\b/i;
export function seeds() {
  if (DEMO_MODE) return [
    { id: 's1', title: 'P&S tutorial', meta: 'Thursdays 12:30 · Room 14', line: 'Small and weekly: the same faces every time. Ask one person to compare notes before the next one.', task: 'Ask someone from the P&S tutorial to compare notes', icon: 'people' },
    { id: 's2', title: 'GE I lecture', meta: 'Thursdays 10:30 · City College, Block B', line: 'The lecture is hard to talk in. The walk out after it is easy.', task: 'Walk out of GE I with someone and talk', icon: 'book' },
    { id: 's3', title: 'Morning gym', meta: 'Every day 06:30 · Midtown', line: 'The same regulars every morning. Ask someone to spot you on bench.', task: 'Ask a regular at the gym to spot you', icon: 'dumbbell' },
  ];
  const evs = [...EVENTS.map((e) => ({ ...e, date: P.today() })), ...[...DAYS.values()].flat()];
  const seen = new Map();
  for (const e of evs) {
    if (!e?.title || e.sleep || e.allDay || !ROOM.test(e.title)) continue;
    const key = e.title.replace(/\s*\(.*\)\s*/g, '').trim().toLowerCase();
    if (seen.has(key)) { seen.get(key).n++; continue; }
    seen.set(key, { e, n: 1 });
  }
  return [...seen.values()].sort((a, b) => b.n - a.n).slice(0, 3).map(({ e, n }, i) => {
    const gym = /\bgym\b/i.test(e.title);
    const t = `${String(Math.floor(e.start / 60)).padStart(2, '0')}:${String(e.start % 60).padStart(2, '0')}`;
    return { id: `s-${i}`, title: e.title.replace(/\s*\(.*\)\s*/g, '').trim(), meta: `${n > 1 ? `${n} times this week` : P.weekday(e.date, true)} · ${t}${e.where ? ` · ${e.where}` : ''}`,
      line: gym ? 'The same regulars every time. Ask someone to spot you, or how they train.' : 'The same faces every time. The few minutes after it end are the easiest to talk in.',
      task: gym ? `Talk to one regular at ${e.title.replace(/\s*\(.*\)\s*/g, '').trim()}` : `Talk to one person after ${e.title.replace(/\s*\(.*\)\s*/g, '').trim()}`, icon: gym ? 'dumbbell' : 'people', date: e.date };
  });
}
export const WHERE = ['College', 'A class', 'The gym', 'An event', 'Through a friend', 'Online', 'Somewhere else'];

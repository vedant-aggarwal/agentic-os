// Romance: the app's data. Owner: the PEOPLE agent. Two states, one app.
// "single" is the owner's real one: his notes, reps, weekly small steps, what he's looking for and his privacy settings,
// all real records in the people store (journal + state docs), private, and nothing names a person or invents a crush.
// "couple" is a clearly labelled sample preview of how the app looks with a partner (most public users); its partner,
// Sam, is sample data and never leaves the preview. Demo mode (?data=demo) shows the prototype's sample for both.
import { DEMO_MODE } from '../data.js';
import * as P from './people-store.js';

// ── what the screen remembers (every load starts in his real state, locked) ──
export const S = {
  mode: 'single',          // 'single' | 'couple' (sample preview)
  unlockedAt: 0,           // ms; an unlock lasts 5 minutes
  app: null,               // the open Romance app (js/aspects.js app object)
  answered: false,         // couple preview: today's question
  myAnswer: '',
  chart: 'close',
  ideaTag: 'all',
  journalSeg: 'moments',
};

// ── his settings (a state doc, synced): Face ID, the line on Today, patterns, nudges ──
const DEF = { lock: true, onToday: true, patterns: true, nudge: 'sun' };
export const prefs = () => ({ ...DEF, ...(P.state('romance') ?? {}) });
export const setPref = (k, v) => P.setState('romance', { [k]: v });

// ── the week ──────────────────────────────────────────────────────────
export function weekInfo() {
  const t = P.today(), mon = P.mondayOf(t), end = P.addDays(mon, 6);
  const left = P.daysBetween(t, end);
  return { monday: mon, label: `${Number(mon.slice(8))}–${Number(end.slice(8))} ${P.fmtDay(end, { month: 'short' })}`, left: left === 0 ? 'Last day' : `${left} ${left === 1 ? 'day' : 'days'} left` };
}

// this week's one small step: a library of small, general steps (no invented events). The why line uses what's real:
// a plan with a friend this week.
const LIB = [
  { text: 'Say yes to one plan with people', why: 'Any plan with friends counts. Ask if someone else can come along.', from: 'One small step a week' },
  { text: 'Go to one thing you would usually skip', why: 'A talk, a club, a college event. One hour is enough.', from: 'Ask Wyn to find one near you' },
  { text: 'Start one conversation with someone new', why: 'Somewhere you see the same faces every week. Say hi to one of them.', from: 'One small step a week' },
  { text: 'Ask a classmate to get chai after a class', why: 'Someone you already get on with. Ask one of them.', from: 'One small step a week' },
];
const DEMO_STEPS = [
  { text: 'Say yes to one plan with people', why: 'Saturday food with Kabir counts. Ask if anyone else is coming along.', from: 'Picked from your calendar and the Friends app' },
  { text: 'Go to one thing you would usually skip', why: 'The founders’ meetup in Hauz Khas is on Saturday at 18:00. One hour is enough.', from: 'Picked from events near you' },
  { text: 'Start one conversation at the run club', why: 'Sunday, 06:30 at Lodhi Garden. Same faces as last time; say hi to one of them.', from: 'Picked from your reps' },
  { text: 'Ask a classmate to get chai after P&S', why: 'You got on with the two people from Tuesday’s tutorial. Ask one of them.', from: 'Picked from your journal' },
];
const friendPlanThisWeek = () => {
  const w = P.weekOf(P.today());
  return P.plansFor({ aspect: 'friends', open: true }).find((p) => p.date && p.date >= P.today() && p.date <= w[6]) ?? null;
};
export function steps() {
  if (DEMO_MODE) return DEMO_STEPS;
  const pl = friendPlanThisWeek();
  return LIB.map((s, i) => (i === 0 && pl ? { ...s, why: `${pl.title} with ${P.namesOf(pl.people ?? [])}${pl.date ? ` on ${P.weekday(pl.date, true)}` : ''} counts. Ask if anyone else is coming along.`, from: 'Picked from the Friends app' } : s));
}
const stepId = (mon = P.mondayOf(P.today())) => `step:${mon}`;
export const stepState = () => P.state(stepId()) ?? { idx: 0, done: false, feel: null };
export const setStep = (patch) => P.setState(stepId(), patch);
export const currentStep = () => { const s = stepState(); const all = steps(); return all[(s.idx ?? 0) % all.length]; };

// the weeks so far, oldest first; the last is this week. done · missed · quiet (a quiet week keeps the streak, adds nothing).
// Weeks before he started don't count as missed: the strip starts at his first step.
const STEP_ID = /^step:\d{4}-\d{2}-\d{2}$/;
export function weeks() {
  const mon = P.mondayOf(P.today());
  const docs = P.col.state.list().filter((d) => STEP_ID.test(d.id));
  const first = docs.map((d) => d.id.slice(5)).sort()[0] ?? mon;
  const out = [];
  for (let k = 6; k >= 0; k--) {
    const w = P.addDays(mon, -7 * k);
    if (w < first) continue;
    const d = P.state(`step:${w}`);
    out.push({ w: P.fmtDay(w, { day: 'numeric', month: 'short' }), s: k === 0 ? 'now' : d?.done ? 'done' : d?.quiet ? 'quiet' : 'missed' });
  }
  return out;
}
export function streak() {
  const mon = P.mondayOf(P.today());
  let n = 0;
  for (let k = 1; k < 60; k++) { const d = P.state(`step:${P.addDays(mon, -7 * k)}`); if (d?.done) n++; else if (!d?.quiet) break; }
  const ym = P.today().slice(0, 7);
  const quietUsed = P.col.state.list().filter((d) => STEP_ID.test(d.id) && d.quiet && d.id.slice(5, 12) === ym).length;
  return { n, quietLeft: Math.max(0, 1 - quietUsed) };
}

// ── what he's looking for: Hinge-style prompts, answered in his own words (a state doc) ──
// fb is the agent's light feedback, Hinge's three levels: great · small (try a small change) · deeper. She never rewrites.
export const PROMPTS = [
  { id: 'p1', q: 'Someone I’d be glad to come home to is…' },
  { id: 'p2', q: 'We’ll get along if…' },
  { id: 'p3', q: 'A green flag I look for…' },
  { id: 'p4', q: 'What I bring…' },
  { id: 'p5', q: 'A first date I’d actually enjoy…' },
  { id: 'p6', q: 'I’ll know it’s right when…' },
  { id: 'p7', q: 'Something I’m still figuring out…' },
];
export const FB = {
  great: ['Great answer', 'Specific and sounds like you.'],
  small: ['Try a small change', ''],
  deeper: ['Go a little deeper', ''],
};
export const looking = () => ({ intent: null, must: [], green: [], answers: {}, ...(P.state('looking') ?? {}) });
export const setLooking = (patch) => P.setState('looking', patch);
/** The prompts with his answers on them. */
export const prompts = () => { const a = looking().answers ?? {}; return PROMPTS.map((p) => ({ ...p, a: a[p.id]?.a ?? '', fb: a[p.id]?.fb ?? null, ask: a[p.id]?.ask ?? null })); };

// ── becoming ready: most of it happens in the other apps (their live lines; demo shows the sample's) ──
export const READY = [
  { id: 'body', title: 'Feeling good in your body', fallback: DEMO_MODE ? 'Trained this morning · bench 50 of 60' : 'Training, sleep, how you look after yourself' },
  { id: 'friends', title: 'A social life', fallback: DEMO_MODE ? 'A friend in person: 1 of 4 weeks' : 'Time with friends, and room for new people' },
  { id: 'soul', title: 'Steady evenings', fallback: DEMO_MODE ? 'Evening habits: 2 of 3 yesterday' : 'The habits that keep you steady' },
  { id: 'mind', title: 'A quieter head', fallback: DEMO_MODE ? 'Instagram 52 min yesterday' : 'Screen time and focus' },
];

// ── getting out there: ideas this week from what's real (a plan with a friend); demo: the sample ──
const DEMO_IDEAS = [
  { id: 'i1', title: 'Food with Kabir: ask who else is coming', when: 'Sat 24', where: 'Through a friend', why: 'Meeting people through friends is the easiest door.', icon: 'people', person: 'kabir' },
  { id: 'i2', title: 'Founders’ meetup', when: 'Sat 24 · 18:00', where: 'Hauz Khas', why: 'You’d know half the topics. It’s 40 minutes away; stay for one hour.', icon: 'rocket' },
  { id: 'i3', title: 'Sunday run club', when: 'Sun 25 · 06:30', where: 'Lodhi Garden', why: 'You went once. The same faces each week make it easier.', icon: 'sun' },
  { id: 'i4', title: 'Quiz society open round', when: 'Fri 23 · 16:00', where: 'City College, seminar room', why: 'Teams of three, so nobody has to carry a conversation.', icon: 'bulb' },
];
export function ideas() {
  if (DEMO_MODE) return DEMO_IDEAS;
  const w = P.weekOf(P.today());
  return P.plansFor({ aspect: 'friends', open: true }).filter((x) => x.date && x.date >= P.today() && x.date <= w[6]).slice(0, 2).map((p) => {
    const pid = p.people?.[0];
    return { id: `pl-${p.id}`, title: `${p.title} with ${P.nameOf(pid)}: ask who else is coming`, when: `${P.weekday(p.date)} ${Number(p.date.slice(8))}${p.slot ? ` · ${p.slot.replace(/^\w+ /, '')}` : ''}`, where: 'Through a friend', why: 'Meeting people through friends is the easiest door.', icon: 'people', person: pid };
  });
}
export const WEEK_PROMPT = 'Who did you enjoy talking to this week?';

// ── the private journal (people_journal: notes and reps) ──────────────
export const FEELS = [['hopeful', 'Hopeful'], ['calm', 'Calm'], ['happy', 'Happy'], ['curious', 'Curious'], ['nervous', 'Nervous'], ['low', 'Low']];
const byOf = (j) => (j.by === 'you' ? 'me' : j.source === 'chat' ? 'chat' : j.source === 'calendar' ? 'cal' : 'voice');
const dayOf = (iso) => (iso === P.today() ? 'Today' : P.dayShort(iso));
const shape = (j) => ({ id: j.id, day: dayOf(j.date), date: j.date, at: j.at ?? '', feel: j.feel ?? null, by: byOf(j), text: j.text ?? '', prompt: j.prompt ?? undefined, src: j.src ?? undefined, step: !!j.step });
export const notes = () => P.journal('note').map(shape);
export const reps = () => P.journal('rep').map(shape);
/** What the agent notices, computed from his own notes (only once there are a few; nothing is made up). */
export function patterns() {
  if (DEMO_MODE) return [
    ['Days with people read lighter', '4 of your last 5 notes after going out were hopeful or calm.'],
    ['You write here late on Sundays', 'Three of the last four Sundays, after 22:30.'],
  ];
  const ns = P.journal('note').slice(0, 30);
  if (ns.length < 4) return [];
  const out = [];
  const feels = ns.filter((n) => n.feel);
  if (feels.length >= 3) {
    const c = {}; for (const n of feels) c[n.feel] = (c[n.feel] ?? 0) + 1;
    const [top, k] = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    const name = FEELS.find(([v]) => v === top)?.[1] ?? top;
    out.push([`Mostly ${name.toLowerCase()} lately`, `${k} of your last ${feels.length} notes with a feeling were ${name.toLowerCase()}.`]);
  }
  const late = ns.filter((n) => (n.at ?? '') >= '22:00').length;
  if (late >= 3) out.push(['You write here late', `${late} of your last ${ns.length} notes were after 22:00.`]);
  const dows = {}; for (const n of ns) { const d = P.weekday(n.date, true); dows[d] = (dows[d] ?? 0) + 1; }
  const [dTop, dk] = Object.entries(dows).sort((a, b) => b[1] - a[1])[0];
  if (dk >= 3) out.push([`${dTop}s are when you write`, `${dk} of your last ${ns.length} notes.`]);
  return out.slice(0, 2);
}
export const NOTE_PROMPTS = ['Who did you enjoy talking to today?', 'What do you want more of?', 'What took a bit of courage today?'];

// ── the agent here: a wise, warm friend ───────────────────────────────
export function wynNote() {
  if (DEMO_MODE) return WYN_NOTE.single;
  const pt = patterns()[0];
  if (pt) return { at: '', text: `${pt[1]} Worth noticing, nothing more.` };
  return { at: '', text: 'Write a line here when something stirs: a conversation, a feeling, a night out. Once there are a few, I’ll tell you what I notice. Nobody else reads this.' };
}
export const TOOLS = [
  { name: 'people_romance_note', does: 'Files a feeling or a moment you tell her into your private journal', auto: true },
  { name: 'people_plan', does: 'Pencils in a plan with people after you say yes', auto: true },
  { name: 'people_add_date', does: 'Keeps important dates you mention, and reminds you in time', auto: true },
  { name: 'people_add_person', does: 'Adds someone you’re seeing, only when you ask', auto: false },
];
export const BY = {
  me: 'Written by you',
  voice: 'Wyn filed this from what you told her',
  chat: 'Wyn filed this from a chat screenshot',
  cal: 'Wyn filed this from your calendar',
};
export const BY_SHORT = { me: 'You', voice: 'Wyn, from what you said', chat: 'Wyn, from a chat', cal: 'Wyn, from your calendar' };

export const WYN_NOTE = {
  single: { at: 'Last night, 21:40', text: 'Your notes are lighter on days you spend with people. On Tuesday, after staying back with classmates, you wrote more than on any day this month.' },
  couple: { at: 'Today, 16:05', text: 'Sam has exams till December and a heavy week. Quality time is Sam’s first language, so a phone-free hour on Saturday will land better than a gift.' },
};

// ══ the sample preview: Romance with a partner ═══════════════════════
export const PARTNER = {
  id: 'sam', name: 'Sam', initial: 'S', since: '2025-06-13', sinceLabel: '13 Jun 2025', last: 'Sunday, Lodhi Garden', file: 'people/partner',
  rhythm: 'A date every week', rhythmWeeks: [1, 1, 0, 1, 1],
  langs: [['Quality time', 38], ['Words of affirmation', 27], ['Acts of service', 17], ['Physical touch', 12], ['Receiving gifts', 6]],
  mine: 'Words of affirmation, then quality time',
  world: [
    ['Exams till Fri 4 Dec', 'From what you told Wyn'],
    ['A cousin’s wedding in January; you’re invited', 'From a chat screenshot'],
    ['Allergic to peanuts', 'You'],
    ['Cold coffee, no sugar', 'You'],
  ],
  gifts: [
    ['A film camera', 'Sam said “I want to shoot on film” · from a chat screenshot'],
    ['Tickets to a stand-up night', 'You both laughed most on the 3rd'],
    ['The cookbook from the Lebanese place', 'Wyn’s idea'],
  ],
  dates: [
    { title: 'Day 500 together', day: 'Mon 26 Oct', in: 'in 4 days', icon: 'heart' },
    { title: 'Sam’s birthday', day: 'Sat 14 Nov', in: 'in 23 days', icon: 'gift' },
    { title: 'Two years together', day: 'Sun 13 Jun 2027', in: 'in 8 months', icon: 'cal' },
  ],
};
const DAY = 86400000;
export const TOGETHER = Math.round((Date.UTC(2026, 9, 22) - Date.UTC(2025, 5, 13)) / DAY);   // 496

export const QUESTION = { q: 'What’s a small thing I do that makes your day?', theirs: 'When you send a voice note on your way home, even if it’s just “reached”.', streak: 12 };
export const ACTS = [
  { id: 'a1', text: 'A phone-free dinner', lang: 'Quality time', done: true },
  { id: 'a2', text: 'Plan Saturday properly', lang: 'Quality time', done: true },
  { id: 'a3', text: 'Tell Sam one specific thing you liked this week', lang: 'Words', done: false },
];
export const NEXT_DATE = { day: 'Sat 24 Oct', at: '16:00', title: 'Picnic at Sunder Nursery', meta: '₹600 · 25 min by metro', iso: '2026-10-24' };
export const DATE_TAGS = [['all', 'All'], ['under500', 'Under ₹500'], ['outdoors', 'Outdoors'], ['home', 'At home'], ['new', 'New for you']];
export const DATE_IDEAS = [
  { id: 'd1', title: 'Old Delhi food walk, early', where: 'Chandni Chowk', cost: 400, len: '3 h', tags: ['under500', 'outdoors', 'new'], why: 'A whole morning together. Quality time is Sam’s first language.' },
  { id: 'd2', title: 'The Lebanese place in Khan Market', where: 'Khan Market', cost: 1800, len: '2 h', tags: ['new'], why: 'Sam sent it with “we have to try this”. Filed from a chat screenshot.', by: 'chat' },
  { id: 'd3', title: 'Cook rajma chawal together', where: 'At home', cost: 350, len: '2 h', tags: ['home', 'under500'], why: 'You haven’t had a night in since the film on the 9th.' },
  { id: 'd4', title: 'Lodhi Art District walk and coffee', where: 'Lodhi Colony', cost: 300, len: '2 h', tags: ['under500', 'outdoors'], why: 'The murals are free to walk, and the light is good after 16:00.' },
  { id: 'd5', title: 'A stand-up night', where: 'Hauz Khas', cost: 1200, len: '2 h', tags: ['new'], why: 'You both laughed most on the 3rd. Tickets from ₹600 each.' },
];
export const DATES_LOG = [
  { day: 'Sun 18 Oct', title: 'Lodhi Garden walk, then momos', by: 'cal', note: 'Sam called it the best Sunday in weeks' },
  { day: 'Fri 9 Oct', title: 'Film night at home', by: 'voice', note: 'You told Wyn “we’re watching a film at home”' },
  { day: 'Sat 3 Oct', title: 'Hauz Khas lake and the bookshop', by: 'me', note: 'Laughed the whole way back' },
  { day: 'Sun 27 Sep', title: 'Old Fort light and sound show', by: 'cal', note: 'After the cancelled Saturday' },
];
// the Sunday check-ins, oldest first. Each is rated 1 to 5 by him.
export const DIMS = [['close', 'Close'], ['fun', 'Fun'], ['sup', 'Supported'], ['ease', 'At ease']];
export const CHECKINS = [
  { w: '30 Aug', close: 4, fun: 4, sup: 4, ease: 4 },
  { w: '6 Sep', close: 4, fun: 3, sup: 4, ease: 3 },
  { w: '13 Sep', close: 3, fun: 3, sup: 4, ease: 3 },
  { w: '20 Sep', close: 3, fun: 2, sup: 3, ease: 2 },
  { w: '27 Sep', close: 2, fun: 3, sup: 3, ease: 2 },
  { w: '4 Oct', close: 4, fun: 4, sup: 4, ease: 3 },
  { w: '11 Oct', close: 4, fun: 4, sup: 5, ease: 4 },
  { w: '18 Oct', close: 5, fun: 4, sup: 4, ease: 4 },
];
export const CHECKIN_READ = {
  close: 'Back up since the repair on 27 Sep, and 5 last Sunday.',
  fun: 'Steady at 4 for three weeks.',
  sup: 'Highest the week of 11 Oct, when Sam helped you prepare for the test.',
  ease: 'Lowest in late September, settled since.',
};
export const CHECKIN_STEPS = [
  { id: 'appreciate', title: 'Appreciations', ask: 'Three things Sam did this week that you liked, and what each says about Sam.', fields: ['Brought chai to my study session without asking', 'Sent good-luck notes before my tutorial', ''] },
  { id: 'well', title: 'What went well', ask: 'What worked between you this week?', fields: ['We kept Saturday free, phones away'] },
  { id: 'mind', title: 'One thing on your mind', ask: 'Start with “I felt…”, not “you always…”. One thing only.', fields: [''] },
  { id: 'need', title: 'What you need this week', ask: 'What could Sam do to help you feel loved this week? Ask for it, kindly.', fields: [''] },
  { id: 'rate', title: 'How did this week feel?', ask: 'Rate it for yourself. Only you see this.', rate: true },
];
export const REPAIRS = [
  { day: 'Tue 13 Oct', what: 'Late replies on a busy day', plan: 'A quick “busy, call at 9” instead of going quiet', state: 'Repaired the same night' },
  { day: 'Sat 26 Sep', what: 'Cancelled plans for a client call', plan: 'No work on date nights unless it’s urgent, and say so early', state: 'Talked it through on Sunday' },
];
export const REPAIR_STEPS = [
  { id: 'cool', title: 'Cool off first', ask: 'If your heart is racing, take 20 minutes apart and do something calming. Repair works once you’re both settled.' },
  { id: 'felt', title: 'What you felt', ask: 'Just the feelings, no reasons yet.', chips: ['Hurt', 'Ignored', 'Stressed', 'Embarrassed', 'Lonely', 'Defensive', 'Overwhelmed'] },
  { id: 'sides', title: 'Both sides', ask: 'Your side in one line, then Sam’s side as Sam would tell it.', fields: ['', ''], labels: ['How it looked to you', 'How it might have looked to Sam'] },
  { id: 'part', title: 'Your part', ask: 'What would you do differently? One sentence.', fields: [''], labels: ['I could have…'] },
  { id: 'plan', title: 'One plan for next time', ask: 'Agree on one small thing, together.', fields: [''], labels: ['Next time we’ll…'] },
];
export const MOMENTS = [
  { day: 'Today', at: '13:40', text: 'Sam sent “good luck in the tutorial” with a photo of their notes.', by: 'chat', src: 'WhatsApp' },
  { day: 'Sun 18 Oct', at: '17:00', text: 'Walked the whole of Lodhi Garden, then momos. Sam called it the best Sunday in weeks.', by: 'voice' },
  { day: 'Tue 13 Oct', at: '22:30', text: 'Talked through the late replies. Agreed on a quick “busy, call at 9”.', by: 'me' },
  { day: 'Fri 9 Oct', at: '21:00', text: 'Film night at home. Picked a bad film and laughed anyway.', by: 'voice' },
];
export const COUPLE_NOTES = [
  { id: 'c2', day: 'Wed 21 Oct', at: '23:05', feel: 'calm', by: 'me', text: 'I worry I give work more of me than I give Sam. Saturday is a start.' },
  { id: 'c1', day: 'Sun 11 Oct', at: '22:40', feel: 'happy', by: 'me', text: 'Sam remembered the thing I said about my first day at college. Small, but it stayed with me.' },
];

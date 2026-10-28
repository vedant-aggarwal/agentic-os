// Mind: the prototype's sample data, unchanged, for demo mode only (?data=demo). Owner: the Mind agent.
// The live model is mind-data.js; it copies these in when DEMO_MODE is on. Now is Thu 22 Oct 2026, 17:40 here.
// Everything here is sample data for a first-year student, never his real usage.
import { NOW } from '../data.js';

export const fmt = (m) => {
  m = Math.round(m);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
};
// "1h 12m" as words for a sentence: "1 hour 12 minutes" reads too long on a phone; we keep the short form
export const hm = (t) => `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

// ── the four kinds of screen time (the brief's own words) ─────────────────
export const KINDS = [
  { id: 'work', name: 'Work' },
  { id: 'learning', name: 'Learning' },
  { id: 'social', name: 'Social' },
  { id: 'entertainment', name: 'Entertainment' },
];
export const kindName = (id) => KINDS.find((k) => k.id === id)?.name ?? 'Other';

// ── today's apps, by the hour (06–17; 17:00–17:40 is the current hour) ──
// kind: where the phone files it on its own. ask: Wyn can't tell it apart, so the evening check-in asks.
export const APPS = [
  { id: 'instagram', name: 'Instagram', glyph: 'photo', kind: 'social', ask: true, pickups: 6, notifs: 21,
    hours: { 7: 2, 8: 6, 9: 10, 10: 8, 13: 22, 16: 7, 17: 17 },
    sessions: [[7 * 60 + 52, 2], [8 * 60 + 20, 6], [9 * 60 + 50, 10], [10 * 60 + 5, 8], [13 * 60 + 36, 22], [16 * 60 + 20, 7], [17 * 60 + 5, 17]] },
  { id: 'youtube', name: 'YouTube', glyph: 'video', kind: 'entertainment', ask: true, pickups: 2, notifs: 6,
    hours: { 9: 14, 14: 34 }, sessions: [[9 * 60 + 18, 14], [14 * 60 + 2, 34]] },
  { id: 'whatsapp', name: 'WhatsApp', glyph: 'chat', kind: 'social', ask: true, pickups: 7, notifs: 96,
    hours: { 6: 3, 8: 4, 10: 4, 11: 15, 13: 4, 15: 4, 17: 2 },
    sessions: [[6 * 60 + 2, 3], [8 * 60 + 40, 4], [10 * 60 + 15, 4], [11 * 60 + 34, 15], [13 * 60 + 32, 4], [15 * 60 + 20, 4], [17 * 60 + 31, 2]] },
  { id: 'agentic', name: 'Agentic OS', glyph: 'rings', kind: 'work', pickups: 3, notifs: 9, note: 'Jobs and tasks',
    hours: { 6: 8, 7: 2, 16: 8, 17: 8 }, sessions: [[6 * 60 + 6, 8], [7 * 60 + 46, 2], [16 * 60 + 34, 8], [17 * 60 + 26, 8]] },
  { id: 'claude', name: 'Claude', glyph: 'claude', kind: 'work', pickups: 2, notifs: 2, note: 'Chats about the Atlas ERP pricing',
    hours: { 11: 3, 14: 10, 16: 6, 17: 3 }, sessions: [[11 * 60 + 50, 3], [14 * 60 + 36, 10], [16 * 60 + 41, 6], [17 * 60 + 35, 3]] },
  { id: 'chrome', name: 'Chrome', glyph: 'globe', kind: 'work', pickups: 1, notifs: 0, note: 'The store admin and the City College portal',
    hours: { 11: 3, 12: 12, 17: 3 }, sessions: [[11 * 60 + 53, 3], [12 * 60 + 10, 12], [17 * 60 + 2, 3]] },
  { id: 'skool', name: 'Skool', glyph: 'cap', kind: 'learning', pickups: 1, notifs: 4, note: 'Freelance Roadmap, lesson 8',
    hours: { 9: 14 }, sessions: [[9 * 60 + 33, 14]] },
  { id: 'gmail', name: 'Gmail', glyph: 'mail', kind: 'work', pickups: 2, notifs: 12, note: 'Two client threads',
    hours: { 13: 4, 16: 4 }, sessions: [[13 * 60 + 52, 4], [16 * 60 + 12, 4]] },
  { id: 'camera', name: 'Camera', glyph: 'camera', kind: 'work', pickups: 1, notifs: 0, note: 'Kurta photos for the listings',
    hours: { 15: 6 }, sessions: [[15 * 60 + 8, 6]] },
];
export const app = (id) => APPS.find((a) => a.id === id);
export const appMin = (a) => Object.values(a.hours).reduce((s, v) => s + v, 0);

export const H0 = 6, H1 = 23;   // the chart runs 06:00–24:00
export const HOURS = Array.from({ length: H1 - H0 + 1 }, (_, i) => H0 + i);
export const hourMin = (h) => APPS.reduce((s, a) => s + (a.hours[h] ?? 0), 0);
export const todayMin = () => APPS.reduce((s, a) => s + appMin(a), 0);    // 250 = 4h 10m
// a usual Thursday: the average of the last four, by the hour
export const USUAL = { 6: 10, 7: 5, 8: 12, 9: 36, 10: 9, 11: 18, 12: 9, 13: 30, 14: 36, 15: 10, 16: 30, 17: 44, 18: 48, 19: 14, 20: 8, 21: 18, 22: 24, 23: 9 };
export const usualDay = () => Object.values(USUAL).reduce((s, v) => s + v, 0);   // 370 = 6h 10m
export const usualByNow = () => {
  const h = Math.floor(NOW / 60), part = (NOW % 60) / 60;
  return HOURS.filter((x) => x < h).reduce((s, x) => s + USUAL[x], 0) + Math.round(USUAL[h] * part);
};
// a usual day for the three apps Wyn asks about, by the hour (the last four weeks)
export const USUAL_APP = {
  instagram: { 7: 3, 8: 6, 9: 10, 10: 4, 13: 18, 14: 8, 16: 6, 17: 22, 18: 34, 19: 5, 21: 9, 22: 15, 23: 6 },
  youtube: { 9: 12, 14: 20, 21: 6, 22: 8, 23: 3 },
  whatsapp: { 6: 4, 8: 5, 10: 3, 11: 12, 13: 5, 15: 4, 17: 4, 18: 6, 20: 3, 21: 3, 22: 2 },
};
export const WEEK_APP = { instagram: 86, youtube: 54, whatsapp: 41 };   // minutes a day this week
export const PICKUPS = { n: 61, first: 6 * 60 + 2, firstApp: 'WhatsApp' };
export const NOTIFS = APPS.reduce((s, a) => s + a.notifs, 0);   // 150

// ── the evening check-in: the blocks Wyn can't tell apart, her guess, and what each label feeds ──
// labels: kind (how it counts) · aspect (where on the wheel it is filed, if anywhere) · person (a Brain file)
export const CHECKIN_AT = 21 * 60 + 20;
export const BLOCKS = [
  { app: 'instagram', min: 72, when: 'On the metro, and at 17:05',
    why: 'You saved 6 reels and opened 3 creator profiles on the metro. At 17:05 it was the feed.',
    labels: [
      { id: 'research', name: 'Content research', kind: 'work', aspect: 'mission', file: 'Reel ideas for @example_creator' },
      { id: 'scroll', name: 'Scrolling', kind: 'entertainment' },
      { id: 'dms', name: 'Friends’ messages', kind: 'social', aspect: 'friends' },
      { id: 'posting', name: 'Posting', kind: 'work', aspect: 'mission' },
    ],
    guess: [['research', 32], ['scroll', 40]] },
  { app: 'youtube', min: 48, when: 'Both metro rides',
    why: 'Two Hermes Agent videos on the way back. The morning one looked like music.',
    labels: [
      { id: 'learn', name: 'Learning', kind: 'learning', aspect: 'mind', file: 'Hermes Agent: memory and skills' },
      { id: 'fun', name: 'Entertainment', kind: 'entertainment' },
      { id: 'music', name: 'Music', kind: 'entertainment' },
      { id: 'work', name: 'Work research', kind: 'work', aspect: 'mission' },
    ],
    guess: [['learn', 34], ['fun', 14]] },
  { app: 'whatsapp', min: 36, when: 'Eight short visits',
    why: 'Rohan and the college group most of the day, then 12 minutes on the Glowbox chat.',
    labels: [
      { id: 'friends', name: 'Friends', kind: 'social', aspect: 'friends', person: 'rohan' },
      { id: 'clients', name: 'Clients', kind: 'work', aspect: 'mission' },
      { id: 'college', name: 'College', kind: 'learning', aspect: 'mind' },
      { id: 'family', name: 'Family', kind: 'social', aspect: 'family' },
    ],
    guess: [['friends', 24], ['clients', 12]] },
];
// the nights he answered (the streak): 12 in a row, Sat 10 to Wed 21 Oct. Tonight is open.
export const STREAK = 12;
export const WEEK = [
  // the last seven days, oldest first. total and kinds after that night's check-in
  { d: 'Fri', date: 16, total: 362, done: true, kinds: { work: 124, learning: 58, social: 86, entertainment: 94 } },
  { d: 'Sat', date: 17, total: 434, done: true, kinds: { work: 70, learning: 40, social: 142, entertainment: 182 } },
  { d: 'Sun', date: 18, total: 400, done: true, kinds: { work: 88, learning: 74, social: 118, entertainment: 120 } },
  { d: 'Mon', date: 19, total: 331, done: true, kinds: { work: 132, learning: 66, social: 70, entertainment: 63 } },
  { d: 'Tue', date: 20, total: 348, done: true, kinds: { work: 128, learning: 52, social: 88, entertainment: 80 } },
  { d: 'Wed', date: 21, total: 365, done: true, kinds: { work: 118, learning: 64, social: 92, entertainment: 91 } },
  { d: 'Thu', date: 22, total: 0, done: false, today: true },
];
export const LAST_WEEK_AVG = 394;   // 6h 34m
// what each asked-about app was for this week, from the check-ins (share of its time)
export const FOR_WEEK = {
  instagram: [['Content research', 38], ['Scrolling', 52], ['Friends’ messages', 10]],
  youtube: [['Learning', 61], ['Entertainment', 31], ['Music', 8]],
  whatsapp: [['Friends', 58], ['Clients', 30], ['Family', 12]],
};
// October, a total per day (1–22) and whether that night's check-in was answered
export const OCT = [372, 341, 455, 418, 306, 333, 389, 351, 402, 470, 395, 281, 322, 347, 366, 362, 434, 400, 331, 348, 365, 0];
export const OCT_CHECKED = (d) => d >= 10 && d <= 21;

// focus today: the blocks where the phone was meant to stay down
export const FOCUS = [
  { name: 'GE I (Th.)', at: '10:30', len: 60, broke: null },
  { name: 'P&S (Tut.)', at: '12:30', len: 60, broke: null },
  { name: 'Deep work · Agentic OS', at: '16:30', len: 70, broke: { at: '17:05', app: 'Instagram', min: 17 }, now: true },
];

// inputs and outputs today: what he took in, what he made (all devices and off-screen, from the calendar and his agents)
export const INPUTS = [
  { name: 'Lectures', detail: 'GE I and P&S', min: 120 },
  { name: 'Instagram', detail: 'Research and the feed', min: 72 },
  { name: 'YouTube', detail: 'Hermes Agent, music', min: 48 },
  { name: 'Skool', detail: 'Lesson 8, Content that sells', min: 14 },
];
export const OUTPUTS = [
  { name: 'Kurta listings', detail: '8 of 12 uploaded', min: 75 },
  { name: 'Deep work', detail: 'Agentic OS, still going', min: 70 },
  { name: 'Algebra sheet 3', detail: 'Done before college', min: 40 },
];
export const OUTPUT_ITEMS = ['“Agents in class” posted at 09:00, 4.1k views', 'four jobs your agents shipped'];

// ── the library ──────────────────────────────────────────────────────────
// tone: which cover ink (css: .min-cover[data-tone]); sessions: [day, minutes, from page, to page]
export const BOOKS = [
  { id: 'atomic', title: 'Atomic Habits', author: 'James Clear', pages: 320, page: 142, status: 'reading', tone: 1, started: 'Tue 6 Oct',
    why: 'Systems for the reel streak and the gym, not more goals.', plan: { at: '21:30', pages: 20, task: 't21' },
    sessions: [['Wed 21', 26, 128, 142], ['Tue 20', 30, 110, 128], ['Mon 19', 18, 100, 110], ['Sun 18', 35, 80, 100], ['Fri 16', 22, 68, 80],
      ['Wed 14', 28, 52, 68], ['Mon 12', 24, 38, 52], ['Thu 8', 33, 18, 38], ['Tue 6', 36, 0, 18]] },
  { id: 'leads', title: '$100M Leads', author: 'Alex Hormozi', pages: 268, page: 64, status: 'paused', tone: 3, started: 'Mon 21 Sep', last: 'Fri 2 Oct',
    why: 'How to get the first ten clients for Northwind.',
    sessions: [['Fri 2 Oct', 25, 52, 64], ['Tue 29 Sep', 30, 36, 52], ['Sat 26 Sep', 40, 14, 36], ['Mon 21 Sep', 26, 0, 14]] },
  { id: 'momtest', title: 'The Mom Test', author: 'Rob Fitzpatrick', pages: 136, status: 'next', tone: 2, why: 'Pairs with lesson 8 of the Roadmap, Talking to buyers.', next: 'Pairs with lesson 7' },
  { id: 'hooked', title: 'Hooked', author: 'Nir Eyal', pages: 256, status: 'next', tone: 5, why: 'Why the apps you build keep people coming back.', next: 'For the apps you build' },
  { id: 'steal', title: 'Steal Like an Artist', author: 'Austin Kleon', pages: 160, status: 'next', tone: 4, why: 'For the content system.', next: 'For the reel system' },
  { id: 'money', title: 'The Psychology of Money', short: 'Psychology of Money', author: 'Morgan Housel', pages: 256, status: 'done', tone: 2, done: 'Jan' },
  { id: 'offers', title: '$100M Offers', author: 'Alex Hormozi', pages: 224, status: 'done', tone: 3, done: 'Feb' },
  { id: 'deep', title: 'Deep Work', author: 'Cal Newport', pages: 296, status: 'done', tone: 6, done: 'Mar' },
  { id: 'naval', title: 'The Almanack of Naval Ravikant', short: 'Almanack of Naval', author: 'Eric Jorgenson', pages: 242, status: 'done', tone: 1, done: 'Apr' },
  { id: 'show', title: 'Show Your Work!', author: 'Austin Kleon', pages: 224, status: 'done', tone: 4, done: 'Jun' },
  { id: 'zero', title: 'Zero to One', author: 'Peter Thiel', pages: 224, status: 'done', tone: 5, done: 'Aug' },
  { id: 'dmmt', title: 'Don’t Make Me Think', author: 'Steve Krug', pages: 216, status: 'done', tone: 6, done: 'Sep' },
];
export const book = (id) => BOOKS.find((b) => b.id === id);
export const YEAR_GOAL = 12;
export const DAYS_LEFT = 70;       // 22 Oct to 31 Dec
export const YEAR_GONE = 0.81;     // of 2026 (GOALS g7.time)
export const READ_GOAL = 20;       // minutes a day
// reading minutes, the last seven days (Fri → Thu). Today's grows as he logs
export const READ_WEEK = [['Fri', 22], ['Sat', 0], ['Sun', 35], ['Mon', 18], ['Tue', 30], ['Wed', 26], ['Thu', 0]];
// notes and highlights to look at today (Readwise-style): a short highlight, and his own notes
export const NOTES = [
  { id: 'n1', book: 'atomic', page: 27, kind: 'highlight', text: 'You do not rise to the level of your goals. You fall to the level of your systems.', mine: 'The content system, not the follower goal.' },
  { id: 'n2', book: 'deep', page: 101, kind: 'note', text: 'Phone in the other room for the first desk block. It worked every day in March.' },
  { id: 'n3', book: 'money', page: 54, kind: 'note', text: 'When the first ₹2 lakh month comes, save it. Don’t upgrade anything for three months.' },
];

// ── courses: an online classroom and the semester at City College ──
// lessons: [title, duration "m:ss", Wyn's note?]. done: lessons finished, in order. at: the resume point in the current one
const L = (t, d, n) => (n ? [t, d, n] : [t, d]);
export const COURSES = [
  { id: 'roadmap', title: 'Freelance Roadmap', from: 'Online classroom', part: 'Make Money', status: 'active', done: 8, at: '6:12', weekGoal: true,
    lessons: [L('Intro', '0:51'), L('Picking a skill', '4:02'), L('Your first offer', '4:14'), L('Portfolio basics', '6:23'), L('Finding a niche', '6:01'),
      L('Pricing your time', '7:40'), L('Saying no', '5:55'), L('Talking to buyers', '12:30', 'What a real buyer needs and says, before another feature.'),
      L('Content that sells', '14:20', 'Useful once a post can show a real result for a client.'), L('Tools', '6:45'), L('Launch', '8:10'), L('Leads', '9:30'),
      L('Daily outreach', '7:05'), L('Follow-up', '5:20'), L('Discovery calls', '16:00', 'Calls to demos, and practical English for them.'),
      L('Objections', '16:02'), L('Social proof', '3:15', 'Turn real work into proof a prospect can check.'), L('Contracts', '4:14'),
      L('Onboarding', '2:11'), L('Delivery', '2:35'), L('Measuring value', '4:21', 'Decide what counts as value before the pilot starts.'), L('Free to paid', '4:23')],
    practice: 'Reserve 15 minutes after the lesson: turn one project into a client-result post.' },
  { id: 'claude', title: 'Building with AI agents', from: 'Online classroom', part: 'AI', status: 'active', done: 5, at: '12:40',
    lessons: [L('What you will learn', '3:45'), L('Setup', '5:10'), L('Your first agent', '18:20'), L('Prompts that hold up', '21:05'),
      L('Tools and permissions', '33:46', 'Repeat one task in Agentic OS and keep the output.'), L('Memory', '22:10'), L('Background jobs', '19:30'),
      L('Shipping an app', '26:40'), L('Reviews and tests', '23:53', 'Good for cutting requirements down.'), L('Design systems', '21:15'),
      L('Deploying safely', '19:28', 'Watch in full: what a public deploy still has to prove.'), L('Voice agents', '14:00')],
    practice: 'Run one trick from the lesson on a real Agentic OS task before moving on.' },
  { id: 'start', title: 'Start Here', from: 'Online classroom', part: 'Start here', status: 'done', done: 3,
    lessons: [L('Welcome', '2:10'), L('How this works', '2:31'), L('Tools', '6:25')] },
];
export const course = (id) => COURSES.find((c) => c.id === id);
// college, semester 1 at City College: the papers on his calendar. units done of the syllabus; today from EVENTS / TASKS
export const COLLEGE = [
  { id: 'ge1', title: 'GE I', kind: 'Theory', of: 'units', total: 4, done: 2, today: 'In class today, 10:30', event: 'e2' },
  { id: 'ps', title: 'P&S', kind: 'Tutorial', of: 'units', total: 5, done: 2, today: 'Room 14 today, 12:30', event: 'e3' },
  { id: 'alg', title: 'Algebra', kind: 'Tutorial sheets', of: 'sheets', total: 8, done: 3, today: 'Sheet 3 done this morning', task: 't20' },
];
// learning this week, minutes (Fri → Thu), against a 3-hour weekly goal
export const LEARN_GOAL = 180;
export const LEARN_WEEK = [['Fri', 20], ['Sat', 0], ['Sun', 25], ['Mon', 18], ['Tue', 22], ['Wed', 15], ['Thu', 14]];

// ── state: what changes while he taps (the prototype has no backend) ──
export const S = {
  app: null,                 // the open Mind app (js/aspects.js), so pushed pages can refresh its sections
  checkin: { done: false, answers: null },
  readToday: 0,              // minutes read today
  learnExtra: 0,             // learning minutes the check-in adds (a YouTube lesson counted)
  reviewed: new Set(),       // notes looked at today
  log: [],                   // what he logged today: { kind, text, min }
};
export const durSec = (d) => { const p = d.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
export const courseLeft = (c) => c.lessons.slice(c.done).reduce((s, l, i) => s + durSec(l[1]) - (i === 0 && c.at ? durSec(c.at) : 0), 0) / 60;
export const readWeekToday = () => READ_WEEK.map(([d, m], i) => [d, i === READ_WEEK.length - 1 ? m + S.readToday : m]);
export const learnWeek = () => LEARN_WEEK.reduce((s, [, m]) => s + m, 0) + S.learnExtra;
// pace on the current book: pages a minute across its sessions
export const pace = (b) => { const s = b.sessions ?? []; const p = s.reduce((x, r) => x + (r[3] - r[2]), 0); const m = s.reduce((x, r) => x + r[1], 0); return m ? p / m : 0.55; };
export const bookMin = (b) => (b.sessions ?? []).reduce((x, r) => x + r[1], 0);
export const finished = () => BOOKS.filter((b) => b.status === 'done').length;

// ── derived: how today's time splits by kind, before and after the check-in ──
export const blockFor = (appId) => BLOCKS.find((b) => b.app === appId);
export const labelOf = (appId, labelId) => blockFor(appId)?.labels.find((l) => l.id === labelId);
export function kindsNow({ answered = S.checkin.done } = {}) {
  const k = { work: 0, learning: 0, social: 0, entertainment: 0 };
  for (const a of APPS) {
    const ans = answered && S.checkin.answers?.[a.id];
    if (ans) ans.forEach(([lid, m]) => { const lb = labelOf(a.id, lid); k[lb?.kind ?? a.kind] += m; });
    else k[a.kind] += appMin(a);
  }
  return k;
}
// one line under an app's name: what its time was for, or that Wyn asks tonight
export function appFor(a) {
  const ans = S.checkin.done && S.checkin.answers?.[a.id];
  if (ans) return ans.map(([lid, m]) => `${labelOf(a.id, lid)?.name ?? lid} ${fmt(m)}`).join(' · ');
  if (a.ask) return `${a.sessions.length} visits · Wyn asks tonight`;
  return `${kindName(a.kind)}${a.note ? ` · ${a.note}` : ''}`;
}
// the guess Wyn proposes for a block, as answers: [[labelId, minutes], …]
export const guessOf = (b) => b.guess.map(([id, m]) => [id, m]);

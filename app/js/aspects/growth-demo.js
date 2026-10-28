// Growth demo data (?data=demo only): the prototype's sample journal, week, levels, potential, dream, review and plans,
// unchanged. Real mode never reads this file; growth-data.js builds the same shapes from the PC. Owner: the Growth agent.
// "Now" is Thu 22 Oct 2026, 17:40 (the demo clock).

// ── dates ─────────────────────────────────────────────────────────────
export const TODAY = new Date(2026, 9, 22);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const fromIso = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const sameDay = (a, b) => iso(a) === iso(b);
export const fmtDay = (d) => `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;            // Thu 22 Oct
export const fmtLong = (d) => `${DOW_LONG[d.getDay()]} ${d.getDate()} ${MON_LONG[d.getMonth()]}`;  // Thursday 22 October
export const fmtShort = (d) => `${d.getDate()} ${MON[d.getMonth()]}`;                              // 22 Oct
export const dow = (d) => DOW[d.getDay()];
export const dowLong = (d) => DOW_LONG[d.getDay()];
export const monLong = (m) => MON_LONG[m];
export const monShort = (m) => MON[m];
const daysBetween = (a, b) => Math.round((b - a) / 864e5);

// ── mood × energy: two axes, as on a mood meter. p = pleasantness 1–5 (left to right), e = energy 1–5 (bottom to top).
//    The words are his to see; the numbers drive the calendar tint and the week's feel. ──
export const MOODS = [
  // e = 1 (low energy) … e = 5 (high energy); each row runs unpleasant → pleasant
  ['Drained', 'Tired', 'Sleepy', 'Relaxed', 'Peaceful'],
  ['Down', 'Bored', 'Calm', 'Settled', 'Grateful'],
  ['Frustrated', 'Uneasy', 'Okay', 'Good', 'Happy'],
  ['Anxious', 'Tense', 'Alert', 'Focused', 'Energised'],
  ['Panicked', 'Stressed', 'Wired', 'Excited', 'Fired up'],
];
export const moodWord = (p, e) => MOODS[Math.min(5, Math.max(1, e)) - 1][Math.min(5, Math.max(1, p)) - 1];

// ── the journal. Detailed entries are the ones he wrote; `filed` is what Wyn took from each and where she put it.
//    kind: 'typed' | 'voice' | 'scan'. photo: a key in PHOTOS (growth.js). ──
export const ENTRIES = [
  {
    date: '2026-10-21', at: '23:05', kind: 'typed', p: 4, e: 4, words: 118,
    title: 'Shipped before GE, then the payment again',
    text: 'Pull day at 6:30, deadlifts felt strong for once. Shipped the Builders page before GE I and showed the board running on my phone in class. That felt good.\n\nDad asked about the website payment again at dinner. I keep saying "this week". It feels weird to send my own father an invoice, but the work is real and he said he wants to pay properly. I need to send the monthly fee proposal and stop making it a big deal.\n\nSlept late again. Reels from 00:20 to 01:10.',
    aspects: ['body', 'mission', 'money', 'family'],
    filed: [
      ['money', 'Dad: website payment', 'Moved up to Fri 23 (task)', 'task:t14'],
      ['family', 'Dad wants to pay properly', 'Added to his file in the Brain', 'brain:people/family/dad'],
      ['body', 'Slept at 01:10 after reels', 'Logged to sleep', 'aspect:body'],
    ],
    asked: 'You said billing Dad feels weird. What would make it feel fair to you?',
  },
  {
    date: '2026-10-20', at: '22:40', kind: 'voice', len: '1:48', p: 4, e: 2, words: 96, photo: 'dinner',
    title: 'A quiet dinner, 25 pages',
    text: 'Long day at City College, two tutorials back to back. Came home and just ate with Mom and Dad without the phone. Mom was telling me the Diwali cleaning plan, and that the festive stock is moving faster than last year.\n\nRead 25 pages of Atomic Habits after. The bit about environment design hit: at night, my phone is my environment.',
    aspects: ['family', 'mind', 'money'],
    filed: [
      ['mind', 'Atomic Habits, 25 pages', 'Logged a reading session', 'aspect:mind'],
      ['family', 'Dinner without phones', 'Added as a moment', 'aspect:family'],
      ['money', 'Festive stock moving faster', 'Noted for the Corner Market week', 'aspect:money'],
    ],
  },
  {
    date: '2026-10-19', at: '22:15', kind: 'typed', p: 5, e: 4, words: 74,
    title: 'The Monday plan held',
    text: 'Did the morning plan properly for once: three things, written before college. Got two of three. The Atlas ERP wave 1 merge is still waiting on me.\n\nCardio in the evening, 32 minutes. The three moves from Sunday are on the calendar now, which makes them feel real.',
    aspects: ['mission', 'body', 'growth'],
    filed: [
      ['mission', 'Atlas ERP wave 1 merge still open', 'Kept on Today, 2 days late', 'task:t2'],
      ['body', 'Cardio, 32 minutes', 'Logged a session', 'aspect:body'],
    ],
  },
  {
    date: '2026-10-18', at: '21:30', kind: 'typed', p: 4, e: 2, words: 71, review: 42,
    title: 'Sunday review, week 42',
    text: 'Did the review with Wyn. Week 42 scored 42, up 1. The honest part: I avoided both invoices all week.\n\nMoves for this week: two sales calls before Thursday, gym four days, journal every night. Rule for the week: no calls after 22:00. Felt lighter after writing it down.',
    aspects: ['growth', 'money'],
    filed: [['growth', 'Week 42 sealed', '3 moves became goals', 'review:42']],
  },
  {
    date: '2026-10-17', at: '23:40', kind: 'typed', p: 2, e: 1, words: 82, photo: 'shop',
    title: 'Shop all day',
    text: 'Full day at the shop. The Diwali rush has started. Shot 40 kurtas for Corner Market and uploaded 12. My back hurts from bending over the table.\n\nDad handled three wedding families at once like it was nothing. I should film him one day. People would love it.',
    aspects: ['money', 'family', 'mission'],
    filed: [
      ['money', '12 listings uploaded', 'Counted on the Corner Market week', 'aspect:money'],
      ['mission', 'Film Dad with wedding customers', 'Added to the Content inbox', 'aspect:mission'],
    ],
  },
  {
    date: '2026-10-16', at: '23:50', kind: 'voice', len: '2:14', p: 2, e: 2, words: 88,
    title: 'Starting the streak again',
    text: 'Missed yesterday. Not a big deal, but I noticed I skip writing on the days I feel behind.\n\nThe P&S tutorial went badly because I hadn\'t done the sheet. Rohan sent his notes, which helped. Starting the streak again tonight, even if it\'s two lines.',
    aspects: ['growth', 'mind', 'friends'],
    filed: [
      ['friends', 'Rohan sent his P&S notes', 'Added as a moment', 'person:rohan'],
      ['mind', 'P&S sheet not done', 'Flagged for the Saturday catch-up', 'aspect:mind'],
    ],
    asked: 'You skip writing on days you feel behind. Want me to ask for just one line on those nights?',
  },
  {
    date: '2026-10-14', at: '22:50', kind: 'typed', p: 4, e: 3, words: 64,
    title: 'First call with Glowbox',
    text: 'The onboarding call went well. They want the catalogue filled before Diwali. I quoted on the call without thinking it through. I need a proper Basic and Advanced sheet, like I keep saying.\n\nSkipped the gym. Slept at 2.',
    aspects: ['money', 'mission', 'body'],
    filed: [
      ['money', 'Glowbox: invoice after the catalogue fill', 'Task for Tue 20', 'task:t4'],
      ['body', 'Gym skipped, slept at 02:00', 'Logged', 'aspect:body'],
    ],
  },
  {
    date: '2026-10-13', at: '22:30', kind: 'typed', p: 3, e: 3, words: 41,
    title: 'Harborline wants a price',
    text: 'Harborline asked for the first-year price. I don\'t know what to charge. Wyn pulled my last three quotes, and I\'m cheaper than I think. Decide by Friday.',
    aspects: ['money', 'mission'],
    filed: [['money', 'Harborline first-year price', 'Task, due Wed 21', 'task:t3']],
  },
  {
    date: '2026-10-12', at: '23:10', kind: 'typed', p: 2, e: 4, words: 52,
    title: 'Too many open loops',
    text: 'Six things open at once: Atlas ERP, Harborline, Glowbox, the Pulse Chat apps, the website builder, Agentic OS. I keep starting and not closing. Wyn showed me 11 tasks sitting in "ongoing". Picking two for this week and parking the rest.',
    aspects: ['mission'],
    filed: [['mission', 'Parked 4 projects for the week', 'Ongoing list trimmed', 'aspect:mission']],
  },
  {
    date: '2026-10-11', at: '21:00', kind: 'typed', p: 5, e: 2, words: 38, review: 41,
    title: 'Sunday review, week 41',
    text: 'Review: 41 points, flat. Gym three days. Shipped the jobs board. Rule for the week: the phone charges outside the room. Kept it four nights of seven.',
    aspects: ['growth'],
    filed: [['growth', 'Week 41 sealed', 'Rule kept 4 of 7 nights', 'review:41']],
  },
  {
    date: '2026-10-10', at: '22:20', kind: 'typed', p: 5, e: 3, words: 66, photo: 'momos',
    title: 'Momos with Kabir',
    text: 'Food with Kabir after ages. We talked about his internship in Gurgaon. He wants to start the gym, and I said I\'d take him on Saturdays.\n\nWe always say this. This time it goes on the calendar.',
    aspects: ['friends', 'body'],
    filed: [['friends', 'Kabir wants to start the gym', 'Added to his file: Saturdays', 'person:kabir']],
  },
  {
    date: '2026-10-09', at: '23:30', kind: 'scan', p: 3, e: 2, words: 45,
    title: 'Page from the notebook',
    text: 'Wrote this in the notebook during the free period and scanned it. Ideas for the Corner Market festive page: drape videos, a 60-second "how to pick a Silk", Dad on camera. Price the Diwali bundle at ₹2,999.',
    aspects: ['money', 'mission'],
    filed: [['mission', '3 content ideas', 'Added to the Content inbox', 'aspect:mission']],
  },
  {
    date: '2026-10-08', at: '22:05', kind: 'typed', p: 4, e: 4, words: 33,
    title: 'Bench 50 for five',
    text: 'Bench 50 kg for five clean reps. Ten more kilos to the goal. Protein was 118 g, closest yet.',
    aspects: ['body'],
    filed: [['body', 'Bench 50 kg × 5', 'Logged a personal best', 'aspect:body']],
  },
  {
    date: '2026-10-07', at: '23:15', kind: 'voice', len: '0:52', p: 3, e: 2, words: 29,
    title: 'Tired but done',
    text: 'Tired. Did the listings, skipped reading. Two lines are enough tonight.',
    aspects: ['money'],
    filed: [],
  },
  {
    date: '2026-10-06', at: '22:45', kind: 'typed', p: 4, e: 3, words: 47,
    title: 'Pulse Chat on a real phone',
    text: 'Got the Pulse Chat app running on Dad\'s phone. He sent a test message to a customer and grinned. Three bugs to fix, but it works where it matters.',
    aspects: ['mission', 'family'],
    filed: [['mission', '3 Pulse Chat bugs', 'Added to the project', 'aspect:mission']],
  },
  {
    date: '2026-10-05', at: '21:50', kind: 'typed', p: 4, e: 3, words: 39,
    title: 'A new rule for the week',
    text: 'Sunday review done. Rule for this week: the phone charges outside the room. Let\'s see if I last past Wednesday.',
    aspects: ['growth'],
    filed: [['growth', 'Week 40 sealed', 'Rule set for the week', 'review:40']],
  },
  {
    date: '2026-10-03', at: '23:20', kind: 'typed', p: 3, e: 2, words: 36,
    title: 'Saturday at the shop',
    text: 'Shop till 9. Helped Dad with two bridal orders. Uploaded nothing for Corner Market because there was no time to shoot.',
    aspects: ['money', 'family'],
    filed: [],
  },
  {
    date: '2026-10-02', at: '22:10', kind: 'typed', p: 5, e: 4, words: 44,
    title: 'A holiday, and I built all day',
    text: 'Gandhi Jayanti, no college. Slept in, then built for eight hours straight. The jobs board finally loads in under a second. This is the version of me I want more of.',
    aspects: ['mission'],
    filed: [['mission', 'Jobs board loads under a second', 'Noted on the project', 'aspect:mission']],
  },
  {
    date: '2026-10-01', at: '22:35', kind: 'typed', p: 3, e: 3, words: 52,
    title: 'Dad asked what he owes me',
    text: 'Dad asked what he owes me for the website. I said nothing, then felt stupid about it all evening. It\'s real work and he knows it. I should just tell him a monthly number.',
    aspects: ['family', 'money'],
    filed: [['money', 'A monthly fee for the website', 'Task for later this month', 'task:t14']],
  },
  {
    date: '2026-09-22', at: '23:00', kind: 'typed', p: 5, e: 4, words: 40,
    title: 'Atlas ERP signed',
    text: 'The client said yes to Atlas ERP. The biggest project Northwind has taken on. Scared and excited in equal parts. Dad said he was proud, which I didn\'t expect to matter this much.',
    aspects: ['mission', 'money', 'family'],
    filed: [['mission', 'Atlas ERP signed', 'Project created', 'aspect:mission']],
  },
];
export const entryOn = (isoDate) => ENTRIES.find((e) => e.date === isoDate);

// Every day of 2026 up to yesterday: written or not, with its mood. The detailed entries above win; the rest are
// shorter entries seeded so the calendar, the counts and the streaks all agree with each other.
function seeded(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const WRITTEN_SEP = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 20, 22, 23, 24, 25, 26, 27, 28];
const WRITTEN_OCT = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 20, 21];
export const DAYS = (() => {
  const rnd = seeded(2026);
  const out = new Map();
  for (let d = new Date(2026, 0, 1); d < TODAY; d = addDays(d, 1)) {
    const m = d.getMonth(), day = d.getDate();
    let written;
    if (m === 8) written = WRITTEN_SEP.includes(day);
    else if (m === 9) written = WRITTEN_OCT.includes(day);
    else written = rnd() < (m < 3 ? 0.34 : m < 6 ? 0.28 : 0.22);
    const p = Math.max(1, Math.min(5, Math.round(2.4 + rnd() * 2.4 + (m >= 7 ? 0.3 : 0))));
    const e = Math.max(1, Math.min(5, Math.round(1.8 + rnd() * 2.8)));
    const ent = entryOn(iso(d));
    if (ent) out.set(iso(d), { written: true, p: ent.p, e: ent.e, entry: ent });
    else out.set(iso(d), { written, p: written ? p : null, e: written ? e : null });
  }
  return out;
})();
export const day = (isoDate) => DAYS.get(isoDate) ?? { written: false };
export const entriesIn2026 = [...DAYS.values()].filter((x) => x.written).length;
// the current streak ends yesterday (tonight's entry is not written yet); the longest is measured over the year
export const STREAK = (() => {
  let n = 0; for (let d = addDays(TODAY, -1); day(iso(d)).written; d = addDays(d, -1)) n++;
  let best = 0, run = 0, bestEnd = null;
  for (let d = new Date(2026, 0, 1); d < TODAY; d = addDays(d, 1)) { if (day(iso(d)).written) { run++; if (run > best) { best = run; bestEnd = new Date(d); } } else run = 0; }
  return { n, best, bestFrom: addDays(bestEnd, -(best - 1)), bestTo: bestEnd, freezes: 1, saveBy: '22:00', alarm: '22:00', call: '22:30' };
})();
export const monthStats = (y, m) => {
  const days = new Date(y, m + 1, 0).getDate();
  let written = 0, upTo = 0;
  for (let i = 1; i <= days; i++) { const d = new Date(y, m, i); if (d >= TODAY) break; upTo++; if (day(iso(d)).written) written++; }
  return { written, upTo, days };
};

// ── today ─────────────────────────────────────────────────────────────
// The prompts know his day: they come from the calendar, the tasks and what he wrote this week.
export const PROMPTS = [
  { id: 'p1', aspect: 'family', from: 'Dinner at 20:30 · your entry last night', text: 'Dinner with Mom and Dad tonight. Did the website fee come up, and how did you handle it?' },
  { id: 'p2', aspect: 'body', from: 'Push day at 06:30 · 4h 50m of sleep', text: 'You trained on 4h 50m of sleep. How did the body hold up, and was the late night worth it?' },
  { id: 'p3', aspect: 'friends', from: 'Your entry on Sat 10 Oct', text: 'You told Kabir you\'d take him to the gym on Saturdays. Has that happened yet?' },
  { id: 'p4', aspect: 'growth', from: 'A question for any night', text: 'What from today do you want to remember a year from now?' },
];
// check-ins today: the morning one came with the morning plan
export const CHECKINS = [
  { at: '07:12', p: 3, e: 2, note: 'Before the plan' },
];
// what she noticed or logged in this app today, each linked to the app it came from
export const NOTICED = [
  { aspect: 'body', at: '07:50', text: 'Push day logged on 4h 50m of sleep. Bench stalled at 50 kg.', act: 'aspect:body' },
  { aspect: 'mission', at: '16:31', text: 'Deep work started on time, the third day in a row.', act: 'aspect:mission' },
  { aspect: 'money', at: '16:05', text: 'Dad\'s website payment is due tomorrow. I put it in tonight\'s prompts.', act: 'task:t14' },
];
// the day, as she saw it: the moments tonight's entry can draw on (EVENTS ids), each with what she knows about it.
//    done: it happened · now: it's on · later: still to come. Tapping one starts the entry with its prompt.
export const DAY_MOMENTS = [
  { id: 'e1', at: '06:30', label: 'Push day', aspect: 'body', done: true, note: 'On 4h 50m of sleep. Bench stalled at 50 kg.', prompt: 'Push day on 4h 50m of sleep, and the bench stalled at 50. What would have made this morning better?' },
  { id: 'e2', at: '10:30', label: 'GE I', aspect: 'mind', done: true, note: 'City College, Block B. You were on time.', prompt: 'Anything from GE I today worth keeping?' },
  { id: 'e3', at: '12:30', label: 'P&S tutorial', aspect: 'mind', done: true, note: 'Algebra sheet 3 handed in at 12:10.', prompt: 'You handed in sheet 3 on time this week. How did that feel, after last week?' },
  { id: 'e4', at: '15:00', label: 'Shop listings', aspect: 'money', done: true, note: 'The 12 listings are still open on Today.', prompt: 'The listings block ran from 15:00. What got in the way of the 12 kurtas?' },
  { id: 'e5', at: '16:30', label: 'Deep work', aspect: 'mission', now: true, note: 'Started on time, the third day in a row.', prompt: 'Deep work started on time again. What did you get done in it?' },
  { id: 'k1', at: '18:45', label: 'Shoot a reel', aspect: 'mission', later: true, note: 'R1, 15 minutes at the desk.', prompt: 'How did the R1 shoot go?' },
  { id: 'e6', at: '19:00', label: 'Cardio', aspect: 'body', later: true, note: 'Makes it four sessions this week.', prompt: 'Did cardio happen tonight, and how did the body feel?' },
  { id: 'e7', at: '20:30', label: 'Dinner', aspect: 'family', later: true, note: 'With Mom and Dad. The fee is due tomorrow.', prompt: 'Dinner with Mom and Dad tonight. Did the website fee come up, and how did you handle it?' },
];

// ── the week (19–25 Oct): data points from every app, Mon–Thu so far against Mon–Thu last week.
//    good: whether this direction is good (screen time and spending are better when lower) ──
export const WEEK = {
  n: 43, label: '19–25 Oct', from: '2026-10-19', to: '2026-10-25', reviewAt: 'Sun 25 Oct, 10:00', daysIn: 4,
  score: 44, last: 42,
  points: [
    { aspect: 'body', label: 'Workouts', now: '3', was: '2', dir: 1, good: true, note: 'Cardio tonight makes 4' },
    { aspect: 'body', label: 'Sleep, a night', now: '5h 50m', was: '6h 35m', dir: -1, good: false, note: '3 nights after 01:00' },
    { aspect: 'body', label: 'Protein, a day', now: '92 g', was: '85 g', dir: 1, good: true, note: 'Goal 120 g' },
    { aspect: 'mind', label: 'Reading', now: '1h 50m', was: '40m', dir: 1, good: true, note: 'Atomic Habits, 61 pages' },
    { aspect: 'mind', label: 'Screen time, a day', now: '4h 12m', was: '4h 50m', dir: -1, good: true, note: 'Instagram 52m a day' },
    { aspect: 'soul', label: 'Habits kept', now: '71%', was: '64%', dir: 1, good: true, note: '20 of 28' },
    { aspect: 'soul', label: 'Blocker held', now: '3 of 4', was: '1 of 4', dir: 1, good: true, note: 'Evenings, 18:00 to 19:00' },
    { aspect: 'mission', label: 'Tasks done', now: '9', was: '12', dir: -1, good: false, note: '4 overdue' },
    { aspect: 'mission', label: 'Deep work', now: '7h 40m', was: '9h 10m', dir: -1, good: false, note: 'Goal 10h by Sunday' },
    { aspect: 'money', label: 'Spent', now: '₹5,860', was: '₹4,210', dir: 1, good: false, note: '₹900 shirt on Thursday' },
    { aspect: 'money', label: 'Invoices sent', now: '0 of 2', was: '1 of 1', dir: -1, good: false, note: 'Harborline, Glowbox' },
    { aspect: 'growth', label: 'Journal', now: '4 of 4', was: '3 of 4', dir: 1, good: true, note: 'Tonight makes 5' },
    { aspect: 'growth', label: 'Morning plan', now: '3 of 4', was: '1 of 4', dir: 1, good: true, note: 'Skipped Tuesday' },
    { aspect: 'family', label: 'Dinners together', now: '3', was: '2', dir: 1, good: true, note: 'Tonight at 20:30' },
    { aspect: 'friends', label: 'Time with friends', now: '0h', was: '0h', dir: 0, good: null, note: 'Kabir: 12 days' },
    { aspect: 'romance', label: 'Logged', now: 'Nothing', was: 'Nothing', dir: 0, good: null, note: 'Only if you want it tracked' },
  ],
  // last Sunday's three moves, and how each is going: built on top of the last analysis
  moves: [
    { text: 'Two sales calls before Thursday', aspect: 'money', done: 0, of: 2, state: 'behind', note: 'Both calls still unbooked' },
    { text: 'Gym four days', aspect: 'body', done: 3, of: 4, state: 'on', note: 'Cardio tonight closes it' },
    { text: 'Journal every night', aspect: 'growth', done: 4, of: 4, state: 'on', note: 'Tonight keeps it' },
  ],
  rule: { text: 'No calls after 22:00', kept: 3, of: 4 },
  // who the week's entries were about, from the journal: the cast of the week
  people: [
    { id: 'dad', n: 3, line: 'The website fee, twice' },
    { id: 'mom', n: 2, line: 'Diwali plans, dinner' },
    { id: 'rohan', n: 1, line: 'Sent his P&S notes' },
    { id: 'kabir', n: 0, line: 'Not this week · 12 days' },
  ],
};

// ── the level, week by week across 2026 (0–100, built from every app's data points). Growth is its rate of change:
//    the change over the last four weeks, per week. Week 43 is this week so far. ──
export const LEVEL = [39, 41, 42, 40, 38, 37, 36, 37, 35, 34, 36, 38, 39, 41, 43, 44, 42, 44, 45, 43, 41, 40, 38, 36, 35, 33, 31, 29, 30, 32, 33, 35, 34, 36, 37, 38, 40, 41, 40, 41, 41, 42, 44];
export const weekStart = (w) => addDays(new Date(2025, 11, 29), (w - 1) * 7);   // ISO week 1 of 2026 starts Mon 29 Dec 2025
export const weekLabel = (w) => { const a = weekStart(w), b = addDays(a, 6); return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${monShort(a.getMonth())}` : `${fmtShort(a)} – ${fmtShort(b)}`; };
export const rateAt = (i, span = 4, arr = LEVEL) => (i < span ? (arr[i] - arr[0]) / Math.max(1, i) : (arr[i] - arr[i - span]) / span);
export const RATE = LEVEL.map((_, i) => (i === 0 ? 0 : rateAt(i)));
export const GROWTH = (() => {
  const n = LEVEL.length, now = LEVEL[n - 1];
  const low = Math.min(...LEVEL), lowW = LEVEL.indexOf(low) + 1;
  const high = Math.max(...LEVEL.slice(0, n - 1)), highW = LEVEL.indexOf(high) + 1;
  return {
    now, start: LEVEL[0], low, lowW, high, highW,
    rate4: rateAt(n - 1, 4), rate12: rateAt(n - 1, 12),
    sinceLow: now - low, sinceStart: now - LEVEL[0],
    weeksSinceLow: n - lowW,
  };
})();

// each part of the wheel, its level over the last 12 weeks (weeks 32–43); velocity is the same four-week rate
export const ASPECT_LEVELS = {
  body: [30, 32, 31, 34, 36, 38, 37, 40, 41, 43, 44, 46],
  mind: [36, 35, 37, 38, 38, 39, 40, 39, 40, 41, 41, 42],
  soul: [38, 37, 39, 40, 41, 40, 42, 43, 42, 41, 40, 40],
  mission: [44, 46, 47, 49, 50, 52, 53, 55, 56, 57, 58, 60],
  money: [40, 41, 42, 44, 45, 44, 45, 46, 45, 45, 44, 44],
  growth: [48, 50, 51, 53, 54, 55, 56, 58, 59, 60, 61, 62],
  family: [58, 58, 59, 60, 60, 61, 60, 61, 62, 61, 62, 62],
  romance: [12, 12, 13, 12, 13, 14, 14, 15, 15, 15, 15, 15],
  friends: [30, 31, 32, 33, 32, 31, 30, 30, 29, 28, 27, 26],
};
// why each one moved, in a line: what Wyn would say if asked
export const DRIVERS = {
  body: 'Three to four sessions a week since September, protein up. Sleep is the drag.',
  mind: 'Reading came back this month. Screen time is falling slowly.',
  soul: 'The evening blocker holds more often. Late nights pull it back.',
  mission: 'Shipping every week: the jobs board, the Builders page, two client launches.',
  money: 'Spending crept up with Diwali; two invoices are waiting on you.',
  growth: 'Journal streaks are longer and every Sunday has a review.',
  family: 'Dinners at home most nights. Steady, and it shows.',
  romance: 'Not something you\'ve asked me to track. It stays quiet unless you do.',
  friends: 'No time with friends in 12 days. Kabir is the easy fix.',
};
export const VELOCITY = Object.entries(ASPECT_LEVELS).map(([id, arr]) => {
  const v = rateAt(arr.length - 1, 4, arr);
  return { id, now: arr.at(-1), v, state: v >= 1 ? 'up' : v <= -1 ? 'down' : 'flat', arr };
}).sort((a, b) => b.v - a.v);

// ── potential: where his best weeks this year lead by 31 Dec, if they became normal. Goals: where his goals put him.
//    "Your potential may be 100% while your goals are set at 80%." goal null: no goal sets a bar here. ──
export const POTENTIAL = [
  { id: 'body', now: 46, goal: 60, pot: 72, goals: ['g6'], best: 'Apr: 4 sessions a week for 6 weeks' },
  { id: 'mind', now: 42, goal: 50, pot: 68, goals: ['g7'], best: 'Mar: 3 books in a month' },
  { id: 'soul', now: 40, goal: 55, pot: 70, goals: ['g8'], best: 'Sep: 19 clean evenings' },
  { id: 'mission', now: 60, goal: 72, pot: 84, goals: ['g2', 'g3'], best: 'This month: a ship every week' },
  { id: 'money', now: 44, goal: 76, pot: 80, goals: ['g4', 'g5'], best: 'Aug: ₹62,000 in a month' },
  { id: 'growth', now: 62, goal: 70, pot: 82, goals: ['g3'], best: 'Sep: a 14-day journal streak' },
  { id: 'family', now: 62, goal: 72, pot: 84, goals: ['g10'], best: 'Every dinner at home in May' },
  { id: 'romance', now: 15, goal: null, pot: 45, goals: [], best: 'No data yet' },
  { id: 'friends', now: 26, goal: 45, pot: 70, goals: ['g9'], best: 'Jun: friends 3 weekends running' },
];
export const POT = (() => {
  const avg = (k) => Math.round(POTENTIAL.reduce((a, x) => a + (x[k] ?? x.now), 0) / POTENTIAL.length);
  const now = avg('now'), goal = avg('goal'), pot = avg('pot');
  // the parts where the goal sits furthest under what he has shown he can do
  const gaps = POTENTIAL.map((x) => ({ ...x, gap: x.pot - (x.goal ?? x.now) })).sort((a, b) => b.gap - a.gap);
  return { now, goal, pot, share: Math.round((goal / pot) * 100), unclaimed: pot - goal, gaps };
})();

// ── last night's dream. She reads the day while he sleeps, connects what sits in different apps, finds what's missing
//    and what slipped, and proposes changes for his yes. Every finding carries its evidence. ──
export const DREAM = {
  date: '2026-10-22', from: '01:40', to: '05:20', slept: '4h 50m', ready: '05:24',
  read: [
    ['growth', 'Journal', '1 entry, 118 words'], ['today', 'Calendar', '11 blocks'], ['mission', 'Tasks', '25, 4 overdue'],
    ['money', 'Money', '3 UPI messages'], ['body', 'Body', 'Sleep and 1 workout'], ['mind', 'Screen time', '4h 12m'],
    ['mission', 'Work', '13 jobs'], ['content', 'Content', '1 reel, 4.1k views'], ['life', 'Brain', '4 new notes'], ['agent', 'Chats with you', '9 messages'],
  ],
  missing: ['Instagram messages (not connected)', 'Heart rate (Health permission off)'],
  connections: [
    {
      id: 'c1', title: 'Late nights are costing your mornings', aspects: ['soul', 'body', 'mind'], strength: 'Strong',
      text: 'On 3 of the last 4 nights you went to sleep after 01:00. Each one started with reels after 00:20, and each next morning\'s session was skipped or stalled.',
      evidence: [['growth', 'Journal, Wed 21', '"Reels from 00:20 to 01:10"'], ['body', 'Sleep', '01:10 · 01:40 · 02:00'], ['body', 'Gym log', 'Wed 14 skipped · bench stalled today'], ['mind', 'Screen time', 'Reels 48m after midnight']],
      proposal: 'r1',
    },
    {
      id: 'c2', title: 'The invoice you keep postponing', aspects: ['family', 'money', 'mission'], strength: 'Strong',
      text: 'Dad\'s website payment came up in 3 entries this month. It\'s due tomorrow, and it\'s the largest amount that could still move your October money goal.',
      evidence: [['growth', 'Journal', 'Wed 21 · Wed 14 · Thu 1'], ['mission', 'Task', 'Close the website payment, Fri 23'], ['money', 'Goal', '₹2 lakh a month by Dec, 18%']],
      proposal: 'r2',
    },
    {
      id: 'c3', title: 'Planned days get finished', aspects: ['growth', 'mission'], strength: 'Clear',
      text: 'On the 9 days this month you did the morning plan, you closed 3.1 tasks on average. On the other 12 days, 1.3.',
      evidence: [['growth', 'Morning plans', '9 of 21 days'], ['mission', 'Tasks done', '3.1 against 1.3 a day']],
      proposal: 'r4',
    },
  ],
  gaps: [
    { aspect: 'friends', title: 'Kabir, 12 days', text: 'Saturday is still empty, and he said he wants to start the gym.', proposal: 'r3' },
    { aspect: 'mind', title: 'No reading on Wednesday', text: 'The reading goal is one book behind pace: 7 of 12 with 81% of the year gone.' },
    { aspect: 'romance', title: 'Romance has no goal', text: 'That\'s fine. I won\'t nudge you here unless you ask me to.' },
  ],
  slipped: [
    { aspect: 'money', title: 'Harborline first-year price', meta: '1 day late', act: 'task:t3' },
    { aspect: 'money', title: 'Glowbox invoice', meta: '1 day late', act: 'task:t4' },
    { aspect: 'money', title: 'Subscriptions: cancel Cursor', meta: '2 days late · billed again on 20 Oct', act: 'task:t1' },
  ],
  proposals: [
    { id: 'r1', kind: 'Rule', aspect: 'soul', title: 'Lock reels from 00:15 on gym nights', meta: 'Sun, Tue and Thu · you can ask me to open them', confidence: 'High', from: 'c1' },
    { id: 'r2', kind: 'Task', aspect: 'money', title: 'Draft the monthly fee proposal for Dad', meta: 'Ready by 10:00 tomorrow · I draft it, you send it', confidence: 'High', from: 'c2' },
    { id: 'r3', kind: 'Plan', aspect: 'friends', title: 'Gym with Kabir, Saturday 08:00', meta: 'A block on your calendar and a message for you to send', confidence: 'Medium', from: 'gap' },
    { id: 'r4', kind: 'Ritual', aspect: 'growth', title: 'Move the morning plan to 07:10, before the phone', meta: 'One alarm, every weekday', confidence: 'Medium', from: 'c3' },
  ],
};
export const PAST_DREAMS = [
  { date: '2026-10-21', line: 'Spending runs high on days you skip lunch at home', found: 2, approved: 1, declined: 1 },
  { date: '2026-10-20', line: 'Your best deep work starts before 17:00', found: 3, approved: 2, declined: 0 },
  { date: '2026-10-19', line: 'Sunday\'s moves had no calendar blocks yet', found: 2, approved: 2, declined: 0 },
  { date: '2026-10-18', line: 'Both invoices waited the whole week', found: 1, approved: 0, declined: 1 },
];

// ── the Sunday review, drafted from the week so far. Steps: feel, numbers, wins, misses, a rule, next week. ──
export const REVIEW = {
  week: 43, label: '19–25 Oct', next: '26 Oct – 1 Nov', drafted: 'Thu 17:40',
  feel: { p: 4, e: 3, line: 'Mostly focused. Wednesday night dipped after the payment came up.' },
  headline: 'Your week scores 44, up 2. Body and Mission carried it; Friends and Money held it back.',
  wins: [
    { text: 'Gym three times by Thursday, up from two', aspect: 'body', on: true },
    { text: 'Journal every night, four of four', aspect: 'growth', on: true },
    { text: 'Morning plan three days out of four', aspect: 'growth', on: true },
    { text: 'Read 1h 50m, up from 40 minutes', aspect: 'mind', on: true },
    { text: 'The evening blocker held three evenings', aspect: 'soul', on: true },
  ],
  misses: [
    { text: 'Neither invoice went out', aspect: 'money', why: 'Avoided it', whys: ['Avoided it', 'No time', 'Unsure of the price'], detail: 'Harborline and Glowbox are both a day late.' },
    { text: 'Asleep after 01:00 on three nights', aspect: 'body', why: 'Phone in bed', whys: ['Phone in bed', 'Work ran late', "Couldn't sleep"], detail: 'Each one started with reels after 00:20.' },
    { text: 'No time with friends', aspect: 'friends', why: 'No plan', whys: ['No plan', 'No time', "Didn't feel like it"], detail: 'Kabir: 12 days. Saturday is still empty.' },
    { text: '₹1,650 more spent than last week', aspect: 'money', why: 'Impulse', whys: ['Impulse', 'Needed it', 'Diwali shopping'], detail: 'Most of it was the ₹900 shirt.' },
  ],
  whys: ['Avoided it', 'No time', 'Tired', 'Phone in bed', 'No plan', 'Impulse', 'Forgot'],
  rules: [
    { id: 'u1', text: 'Send first, talk after', why: 'From the invoices: you avoid them, then they hang over the week.' },
    { id: 'u2', text: 'The phone charges outside the room on gym nights', why: 'From the late nights: you kept this 4 of 7 nights in week 41.' },
    { id: 'u3', text: 'On days I feel behind, I still write two lines', why: 'From the journal: the misses come on the bad days.' },
  ],
  moves: [
    { id: 'm1', text: 'Send both invoices Monday by 11:00', aspect: 'money', goal: 'g1', lands: 'A week goal and 2 tasks on Mon 26', on: true },
    { id: 'm2', text: 'Lights out by 00:30 on gym nights', aspect: 'body', goal: 'g6', lands: 'A blocker rule and 3 alarms', on: true },
    { id: 'm3', text: 'Gym with Kabir on Saturday', aspect: 'friends', goal: 'g9', lands: 'A block on Sat 31, 08:00 and a message for you to send', on: true },
  ],
  streak: 7,   // Sundays in a row with a review
};
export const PAST_REVIEWS = [
  { week: 42, label: '12–18 Oct', score: 42, delta: 1, line: 'Avoided both invoices; gym 3 days', rule: 'No calls after 22:00', kept: '3 of 4 so far' },
  { week: 41, label: '5–11 Oct', score: 41, delta: 0, line: 'Shipped the jobs board; flat week', rule: 'The phone charges outside the room', kept: '4 of 7' },
  { week: 40, label: '28 Sep – 4 Oct', score: 41, delta: 1, line: 'Two client calls; missed two journal days', rule: 'Lunch at home on college days', kept: '5 of 6' },
  { week: 39, label: '21–27 Sep', score: 40, delta: -1, line: 'Exams week; sleep held', rule: 'Study before screens', kept: '4 of 7' },
  { week: 38, label: '14–20 Sep', score: 41, delta: 1, line: 'Best week of the quarter so far', rule: 'Gym before college', kept: '4 of 5' },
];

// ── planning rituals ──────────────────────────────────────────────────
export const PLAN = {
  day: {
    done: '07:20', slept: '4h 50m', energy: 'Expect a dip after 15:00. A ten-minute walk before deep work at 16:30 helps',
    three: [
      { id: 't19', text: 'Morning gym · push day', done: true, at: '07:45' },
      { id: 't20', text: 'Algebra tutorial sheet 3', done: true, at: '12:10' },
      { id: 't2', text: 'Atlas ERP wave 1: merge the 11 parallel agents', done: false, late: '2 days late' },
    ],
    intention: 'Close one open loop before starting a new one',
    evening: { at: '22:00', steps: ['See what got done', 'Move what didn\'t', 'Write tonight\'s entry', 'Set tomorrow\'s first move', 'Phone down by 23:00'] },
    tomorrow: { at: '10:00', text: 'Dad: send the monthly fee proposal (draft ready)' },
  },
  week: {
    label: '26 Oct – 1 Nov', planAt: 'Sun 25 Oct, after the review',
    load: [['Mon', 9.5], ['Tue', 8], ['Wed', 9], ['Thu', 7.5], ['Fri', 6], ['Sat', 5], ['Sun', 3]],
  },
};

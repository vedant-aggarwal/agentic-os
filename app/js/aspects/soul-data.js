// Soul's own mock data: habits, check-ins, values, Clean and the blocker. Owner: the Soul agent.
// "Now" is Thu 22 Oct 2026, 17:40 (js/data.js NOW). Sample numbers only, never his real ones.
// Handle with care: Clean is the name he gave the quit tracker. Nothing in this file says what it is for, and
// nothing should: reasons, stages and the log are written so they could belong to any habit he is leaving behind.

export const NOW_DATE = new Date(2026, 9, 22, 17, 40, 0);
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// A deterministic history string for the habit calendars, oldest first, today last.
// '1' done · '0' missed · 's' a rest day (kept the streak) · '-' not due that day
function hist(run, density, seed, today) {
  let x = seed; const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  const past = [];
  for (let i = 0; i < 55; i++) past.push(rnd() < density ? '1' : rnd() < 0.18 ? 's' : '0');
  for (let i = 0; i < run && i < 55; i++) past[54 - i] = '1';   // the run up to yesterday
  if (run < 55) past[54 - run] = '0';                              // and the miss that started it
  return past.join('') + today;
}

// part: morning | evening. by: who ticks it (you, or Wyn from your phone or another app). aspect: the app it also feeds.
export const HABITS = [
  { id: 'up', part: 'morning', title: 'Up by 06:15', label: ['Up by', '06:15'], icon: 'sunrise', at: '06:15',
    done: true, doneAt: '06:02', streak: 11, best: 19, by: 'you', why: 'The gym at 06:30 only happens if this does.' },
  { id: 'nophone', part: 'morning', title: 'No phone for the first 30 minutes', label: ['No phone', 'first 30 min'], icon: 'phoneOff', at: '06:00–06:30',
    done: true, doneAt: '06:41', streak: 4, best: 9, by: 'wyn', how: 'First unlock 06:41, from Screen Time', why: 'The day starts with your plan, not the feed.' },
  { id: 'gym', part: 'morning', title: 'Morning gym', label: ['Morning', 'gym'], icon: 'dumbbell', at: '06:30', aspect: 'body',
    done: true, doneAt: '07:45', streak: 3, best: 12, by: 'body', how: 'Push day, logged in Body at 07:45', why: 'Four days a week, for the 60 kg bench.' },
  { id: 'quiet', part: 'morning', title: 'Five quiet minutes', label: ['Five quiet', 'minutes'], icon: 'lotus', at: 'By 10:00',
    done: false, missed: true, streak: 0, prev: 6, best: 8, by: 'you', why: 'Five minutes with no input, before the day takes over.' },
  { id: 'dinner', part: 'evening', title: 'Phone-free dinner', label: ['Phone-free', 'dinner'], icon: 'dinner', at: '20:30', aspect: 'family',
    done: false, streak: 2, best: 6, by: 'you', why: 'Dinner with Mom and Dad, all of me there.' },
  { id: 'read', part: 'evening', title: 'Read 20 pages', label: ['Read', '20 pages'], icon: 'book', at: '21:30', aspect: 'mind',
    done: false, count: 8, of: 20, unit: 'pages', streak: 5, best: 14, by: 'mind', how: '8 pages at lunch, logged in Mind', why: 'Atomic Habits, then the next one. 7 of 12 books this year.' },
  { id: 'journal', part: 'evening', title: 'Two lines in the journal', label: ['Journal', 'two lines'], icon: 'pen', at: '22:00', aspect: 'growth',
    done: false, streak: 6, best: 6, by: 'growth', atRisk: true, how: 'Ticks itself when you write in Growth', why: 'Two lines are enough. If you miss it, Wyn calls at 22:30.' },
  { id: 'phoneout', part: 'evening', title: 'Phone out of the bedroom', label: ['Phone out', 'by 22:45'], icon: 'moon', at: '22:45',
    done: false, streak: 5, best: 11, by: 'wyn', how: 'Ticks when the phone charges outside your room after 22:30', why: 'Agents work the night. You sleep.' },
];
// streak counts today when it is done; a missed habit keeps the run it had (prev) so "never miss twice" can name it
HABITS.forEach((h, i) => {
  const run = h.done ? h.streak - 1 : h.missed ? (h.prev ?? 6) : h.streak;
  h.hist = hist(run, [0.72, 0.6, 0.58, 0.5, 0.45, 0.62, 0.7, 0.55][i], 7 + i * 13, h.done ? '1' : h.missed ? '0' : '.');
});

// How are you right now? Five words, no faces that judge.
export const MOODS = [
  { v: 1, label: 'Low' }, { v: 2, label: 'Flat' }, { v: 3, label: 'Okay' }, { v: 4, label: 'Good' }, { v: 5, label: 'Great' },
];
export const CHECKINS = [{ at: '07:02', v: 4 }, { at: '13:10', v: 3 }];

// What doing right means to him, in his words. week: the last 13 nights' reflection (2 lived · 1 partly · 0 not), oldest first.
export const VALUES = [
  { id: 'word', name: 'Keep my word', words: 'When I say it will be done, it is done. For Dad, for clients, for myself.', aspects: ['mission', 'money'],
    week: [2, 2, 1, 2, 2, 0, 1, 2, 2, 1, 2, 0, 1],
    read: 'Four tasks are past their date. Sending Harborline the quote tonight would count.', act: ['Open the quote', 'sou-v-task'] },
  { id: 'there', name: 'Be there', words: 'Phone down when I am with people. Show up for Mom, Dad and my friends.', aspects: ['family', 'friends'],
    week: [1, 2, 0, 1, 2, 2, 0, 1, 2, 0, 2, 1, 0],
    read: 'Dinner is where the phone comes out: 3 of the last 7 nights. Tonight is 20:30.', act: ['Phone-free dinner', 'sou-v-dinner'] },
  { id: 'body', name: 'Respect my body', words: 'Train, eat right, sleep on time. It carries everything else.', aspects: ['body'],
    week: [2, 1, 2, 2, 2, 1, 2, 2, 2, 2, 1, 2, 2],
    read: 'Your steadiest one: 6 of the last 7 days. Cardio at 19:00 keeps it.', act: ['Open Body', 'sou-v-body'] },
  { id: 'build', name: 'Build, don’t scroll', words: 'Make more than I take in. Evenings are for building.', aspects: ['mind', 'mission'],
    week: [1, 0, 1, 2, 1, 0, 2, 1, 1, 0, 2, 2, 1],
    read: 'The evening decides this one. The 18:00 lock is there for it.', act: ['Open the blocker', 'sou-v-block'] },
];
export const REFLECT_OPTS = [[2, 'Yes'], [1, 'Partly'], [0, 'Not today']];

// ── Clean ────────────────────────────────────────────────────────────────
export const CLEAN = {
  since: new Date(2026, 9, 13, 8, 14, 0),   // the last reset: Tue 13 Oct
  sinceLabel: 'Tue 13 Oct',
  goal: 30, horizon: 90, goalId: 'g8',
  best: 16, bestWhen: 'September', year: 63,
  pledge: { done: true, at: '07:02' },
  reasons: [
    'I want my mornings and my focus back.',
    'Energy for the gym and for building Northwind.',
    'When I am with people, I want to actually be there.',
    'The same person at 23:00 as at 09:00.',
  ],
};
export const MILESTONES = [
  { d: 1, short: '1', unit: 'day', label: '1 day', line: 'The first one is the hardest, and it is done.' },
  { d: 3, short: '3', unit: 'days', label: '3 days', line: 'Past the loudest stretch.' },
  { d: 7, short: '1', unit: 'week', label: '1 week', line: 'Seven mornings that were yours.' },
  { d: 14, short: '2', unit: 'weeks', label: '2 weeks', line: 'Two weeks is where most people start to feel it working.' },
  { d: 30, short: '30', unit: 'days', label: '30 days', line: 'Your goal in Mission: 30 clean days.' },
  { d: 60, short: '60', unit: 'days', label: '60 days', line: 'New routines start to run on their own.' },
  { d: 90, short: '90', unit: 'days', label: '90 days', line: 'The long one. Quiet most days.' },
  { d: 365, short: '1', unit: 'year', label: '1 year', line: 'A year of being the person you said you would be.' },
];
// What many people report as the weeks go by. Phrased as experience, not as medical fact.
export const STAGES = [
  { from: 1, to: 3, title: 'The pull is loudest', text: 'Urges come often and hard, and sleep can be off. This is the hardest stretch, and you are past it.' },
  { from: 4, to: 7, title: 'The loop loosens', text: 'The urges still come, but you start to see them coming, and that is half the work.' },
  { from: 8, to: 14, title: 'Focus comes back in patches', text: 'Mornings get clearer. Some days feel flat: that is the old reward fading, not you failing.' },
  { from: 15, to: 30, title: 'Waves, further apart', text: 'Urges come in waves with longer gaps between them. Most pass in minutes if you ride them out.' },
  { from: 31, to: 60, title: 'Routines feel like yours', text: 'The habits you built around this start to run without effort.' },
  { from: 61, to: 90, title: 'Quiet most days', text: 'Around ninety days, many people say the old pull stops running the show.' },
];
// The urge log, newest first. place, feel, before: chips he taps in two seconds. out: rode | slip
export const URGES = [
  { day: 'Wed 21 Oct', at: '23:12', h: 23, place: 'Bedroom', feel: 'Tired', before: 'Scrolling', did: 'Breathed, put the phone outside', out: 'rode', mins: 9 },
  { day: 'Tue 20 Oct', at: '00:05', h: 0, place: 'Bedroom', feel: 'Restless', before: 'Late night', did: 'Called Wyn', out: 'rode', mins: 14 },
  { day: 'Mon 19 Oct', at: '16:40', h: 16, place: 'College', feel: 'Bored', before: 'Nothing to do', did: 'Walked to the canteen', out: 'rode', mins: 6 },
  { day: 'Sun 18 Oct', at: '23:40', h: 23, place: 'Bedroom', feel: 'Flat', before: 'Scrolling', did: 'Read his reasons', out: 'rode', mins: 12 },
  { day: 'Sat 17 Oct', at: '13:20', h: 13, place: 'Home', feel: 'Bored', before: 'Alone', did: 'Went to the shop with Dad', out: 'rode', mins: 20 },
  { day: 'Fri 16 Oct', at: '22:55', h: 22, place: 'Bedroom', feel: 'Tired', before: 'Scrolling', did: 'Phone outside, lights out', out: 'rode', mins: 8 },
  { day: 'Thu 15 Oct', at: '23:30', h: 23, place: 'Bedroom', feel: 'Stressed', before: 'Work', did: 'Breathed, then journalled', out: 'rode', mins: 16 },
  { day: 'Wed 14 Oct', at: '00:20', h: 0, place: 'Bedroom', feel: 'Flat', before: 'Late night', did: 'Called Wyn', out: 'rode', mins: 11 },
  { day: 'Tue 13 Oct', at: '08:05', h: 8, place: 'Bedroom', feel: 'Low', before: 'Woke up low', did: '', out: 'slip' },
  { day: 'Mon 12 Oct', at: '23:45', h: 23, place: 'Bedroom', feel: 'Tired', before: 'Scrolling', did: 'Breathed', out: 'rode', mins: 10 },
  { day: 'Sat 10 Oct', at: '01:10', h: 1, place: 'Bedroom', feel: 'Restless', before: 'Late night', did: 'Walked to the kitchen, water', out: 'rode', mins: 13 },
  { day: 'Wed 7 Oct', at: '22:40', h: 22, place: 'Bedroom', feel: 'Stressed', before: 'Scrolling', did: 'Called Wyn', out: 'rode', mins: 15 },
  { day: 'Sun 4 Oct', at: '15:30', h: 15, place: 'Home', feel: 'Bored', before: 'Alone', did: 'Messaged Rohan', out: 'rode', mins: 7 },
  { day: 'Sat 26 Sep', at: '00:40', h: 0, place: 'Bedroom', feel: 'Flat', before: 'Scrolling', did: '', out: 'slip' },
];
export const URGE_CHIPS = {
  place: ['Bedroom', 'Home', 'College', 'Shop', 'Outside'],
  feel: ['Tired', 'Bored', 'Stressed', 'Lonely', 'Flat', 'Restless'],
  before: ['Scrolling', 'Late night', 'Alone', 'Work', 'Nothing'],
};

// ── the blocker ─────────────────────────────────────────────────────────
// Apps are named, never drawn with their own marks: a neutral glyph stands in.
export const BAPPS = {
  instagram: { name: 'Instagram', glyph: 'camera' },
  youtube: { name: 'YouTube', glyph: 'play' },
};
// Instagram minutes per hour, the last four weeks' average. Rows Mon…Sun, columns 00…23.
const H = (night, h18, day) => Array.from({ length: 24 }, (_, h) => {
  const base = { 0: night * .55, 1: night * .12, 7: 4, 8: 3, 9: 2, 10: 3, 11: day + 2, 12: day + 4, 13: day + 3, 14: day + 1, 15: day + 3, 16: day + 4, 17: day + 6, 18: h18, 19: 6, 20: 4, 21: 11, 22: 16, 23: night }[h] ?? 0;
  return Math.round(base);
});
export const HEAT = [
  H(30, 44, 3), H(28, 41, 4), H(33, 46, 3), H(26, 39, 4), H(31, 38, 5),   // Mon–Fri: the 18:00 hour
  H(38, 16, 9), H(36, 14, 10),                                            // Sat, Sun: spread out, later nights
];
export const WINDOWS = [
  { id: 'eve', label: 'Weekdays 18:00–19:00', avg: 41, rows: [0, 4], cols: [18, 18], note: 'After deep work, before cardio' },
  { id: 'night', label: 'Every night 23:00–00:30', avg: 34, rows: [0, 6], cols: [23, 24], note: 'In bed, with the phone' },
];
export const LOCKS = [
  { id: 'eve', name: 'Evening window', apps: ['instagram'], when: 'Weekdays 18:00–19:00', how: 'Wyn asks first, each day at 17:30', on: true, learned: true },
  { id: 'bed', name: 'Bedtime', apps: ['instagram', 'youtube'], when: 'Every night 22:45–06:00', how: 'Starts with the phone-out habit', on: true },
  { id: 'limit', name: 'Daily limit', apps: ['instagram'], when: '45 minutes a day', how: '31 minutes used today', on: true },
  { id: 'hard', name: 'Hard mode', apps: [], when: 'No unlocks until a lock ends', how: 'Even a good reason waits', on: false },
];
export const TODAY_USE = { app: 'instagram', used: 31, limit: 45, opens: 9 };
// What he asked this week, and what Wyn decided. out: open | held. (Wednesday he said "Not today" to the evening
// lock, and the 18:00 hour ran to 52 minutes: that is the "52 min yesterday" in her ask today, FEED f1.)
export const ASKS = [
  { id: 'a1', day: 'Wed', at: '23:20', app: 'instagram', lock: 'Bedtime', reason: 'Check one thing', out: 'held',
    chat: [['me', 'Let me check one thing'], ['wyn', 'It’s 23:20, and this is the hour the night slips. If it can wait till morning, it waits.'], ['me', 'Ok fine'], ['wyn', 'Thank you. It opens at 06:00.']] },
  { id: 'a2', day: 'Tue', at: '18:40', app: 'instagram', lock: 'Evening window', reason: 'Post the reel I shot', out: 'open', mins: 10,
    chat: [['me', 'Need to post the reel I shot'], ['wyn', 'Posting counts as work. Open for 10 minutes; I lock it again at 18:50. Post, answer comments, close.'], ['wyn', 'Locked again at 18:49. You closed it yourself, a minute early.']] },
  { id: 'a3', day: 'Tue', at: '18:15', app: 'instagram', lock: 'Evening window', reason: 'Just five minutes', out: 'held',
    chat: [['me', 'Open Instagram, just five minutes'], ['wyn', 'I’ll hold this one. Five minutes at this hour usually runs to forty, and cardio is at 19:00. It opens then.'], ['me', 'Fine'], ['wyn', 'Thank you. I’ll open it at 19:00 sharp.']] },
  { id: 'a4', day: 'Mon', at: '23:35', app: 'youtube', lock: 'Bedtime', reason: 'Can’t sleep, something calm', out: 'held',
    chat: [['me', 'Can’t sleep. Something calm on YouTube?'], ['wyn', 'Screens keep you up longer. Breathe with me for two minutes; if you’re still awake at 00:00, I’ll open it for 15.'], ['me', 'Ok'], ['wyn', 'You were asleep by 23:52.']] },
  { id: 'a5', day: 'Mon', at: '18:05', app: 'instagram', lock: 'Evening window', reason: 'Reply to a customer about a kurta order', out: 'open', mins: 5,
    chat: [['me', 'A customer messaged about a kurta order on Corner Market'], ['wyn', 'That won’t wait. Open for 5 minutes, messages only; I lock it again at 18:10.']] },
];
// Instagram minutes a day this week vs the usual for that weekday (the last four weeks). Thursday is still running.
export const WEEK_USE = { this: [54, 47, 96, 31, null, null, null], usual: [78, 74, 81, 76, 72, 96, 104], locked: [true, true, false, null, null, null, null], stopped: 14 };

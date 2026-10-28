// Mission's sample data for demo mode (?data=demo) only: the prototype's horizons, goal extras, closed goals, purpose and
// directions, frozen at Thu 22 Oct 2026, 17:40. Real mode never reads this file's numbers (mission-data.js builds them).

// ── horizons, nearest first. time: how much of the period has gone (the tick on every ring in it).
//    cells: the units the period's stripe is cut into, each with how much of it has gone (0–1) ──
const days = (n, full, part) => Array.from({ length: n }, (_, i) => (i < full ? 1 : i === full ? part : 0));
export const HZ = [
  { id: 'week', name: 'This week', short: 'Week', of: 'the week', lower: 'this week', range: '19–25 Oct', left: '3 days left', due: 'Sun 25 Oct', time: 0.6,
    cells: days(7, 3, 0.74), labels: ['M', 'T', 'W', 'T', 'F', 'S', 'S'], now: 3, gap: 4,
    prev: 'Last week', next: 'Next week', prevRange: '12–18 Oct', nextRange: '26 Oct – 1 Nov' },
  { id: 'month', name: 'October', short: 'Month', of: 'October', lower: 'October', range: '1–31 Oct', left: '9 days left', due: 'Sat 31 Oct', time: 0.71,
    cells: days(31, 21, 0.74), labels: Object.fromEntries([[0, '1'], [7, '8'], [14, '15'], [21, '22'], [28, '29']]), now: 21, gap: 2,
    prev: 'September', next: 'November', prevRange: '1–30 Sep', nextRange: '1–30 Nov' },
  { id: 'quarter', name: 'This quarter', short: 'Quarter', of: 'the quarter', lower: 'this quarter', range: 'Oct – Dec', left: '70 days left', due: 'Thu 31 Dec', time: 0.24,
    cells: [0.71, 0, 0], labels: ['Oct', 'Nov', 'Dec'], now: 0, gap: 4,
    prev: 'Jul – Sep', next: 'Jan – Mar', prevRange: 'Q3 2026', nextRange: 'Q1 2027' },
  { id: 'year', name: '2026', short: 'Year', of: 'the year', lower: '2026', range: 'Jan – Dec', left: '70 days left', due: 'Thu 31 Dec', time: 0.81,
    cells: [1, 1, 1, 1, 1, 1, 1, 1, 1, 0.71, 0, 0], labels: ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'], now: 9, gap: 3,
    prev: '2025', next: '2027', prevRange: 'Before the review', nextRange: 'Jan – Dec 2027' },
  { id: 'later', name: 'Years out', short: 'Years', of: 'the five years', lower: 'the years out', range: '2027 – 2031', left: '', due: '', time: 0,
    cells: [0, 0, 0, 0, 0], labels: ['2027', '2028', '2029', '2030', '2031'], now: -1, gap: 4 },
  { id: 'life', name: 'Lifetime', short: 'Life', of: 'a lifetime', lower: 'a lifetime', range: 'Every year after', left: '', due: '', time: null },
];
export const hz = (id) => HZ.find((h) => h.id === id) ?? HZ[0];
export const RANK = { week: 0, month: 1, quarter: 2, year: 3, later: 4, life: 5 };

// ── the purpose, and the three lifetime directions: one per family of the wheel ──
export const PURPOSE = {
  text: 'Build software that runs shops like Dad\'s, earn my own way, and make Mom and Dad proud.',
  written: 'Written with Wyn on 6 Jul, after your life review',
  revised: 'Revised 12 Oct',
  values: [
    ['Ship, then polish', 'Live and rough beats perfect and unseen.'],
    ['Earn my own way', 'Every rupee from work I did.'],
    ['Home comes first', 'The shop and the family before anything else.'],
  ],
  versions: [
    ['12 Oct', 'Build software that runs shops like Dad\'s, earn my own way, and make Mom and Dad proud.', 'Now'],
    ['6 Jul', 'Get into a good college and start earning on my own.', 'After the life review'],
  ],
};
export const DIRECTIONS = [
  { id: 'L-work', fam: 'work', title: 'Ship tools real shops pay for', aspects: ['mission', 'money', 'growth'] },
  { id: 'L-health', fam: 'health', title: 'Strong enough to keep at it', aspects: ['body', 'mind', 'soul'] },
  { id: 'L-people', fam: 'people', title: 'Keep my people close', aspects: ['family', 'romance', 'friends'] },
];

// ── what each shared goal carries here ──
// short: a name for charts and threads · measure: what it counts · ms: milestones [text, done, when] · next: the next
// step (a task id, or text) · say: the agent's read, acts: [label, act, id] · hist: progress over the window
// [label, x 0–1 of the window, p] · checks: check-ins · projects: what feeds it
export const X = {
  g1: {
    short: 'Harborline payment', measure: '1 of 3 steps', start: 'Mon 19 Oct',
    ms: [['Pick the Basic and Advanced scope', true, 'Mon 19'], ['Send the first-year quote', false, '1 day late'], ['Collect the payment', false, 'Sun 25']],
    next: { task: 't3', text: 'Send Harborline the Basic / Advanced quote' },
    say: 'Behind pace. The quote is the blocker: send it today and the payment can land by Sunday.',
    acts: [['Draft the quote', 'mis-say', 'draft'], ['Remind me at 19:00', 'mis-say', 'remind']],
    hist: [['Mon', 0, 0], ['Tue', 1 / 7, 0.2], ['Wed', 2 / 7, 0.2], ['Thu', 0.6, 0.2]], axis: ['Mon', 'Thu', 'Sun'],
    checks: [['Wed 21 · 21:00', 'Wyn', 'risk', 'The quote is still a draft. The price isn\'t picked.'], ['Mon 19 · 09:00', 'You', 'on', 'Set for the week.']],
  },
  g2: {
    short: 'Atlas ERP', measure: '5 of 9 areas', start: 'Mon 19 Oct',
    ms: [['Counter', true, ''], ['Bills', true, ''], ['Stock', true, ''], ['Reports', true, ''], ['Users and roles', true, ''],
      ['Merge wave 1 into main', false, '2 days late'], ['Tests green on every area', false, ''], ['Hosted on the VPS', false, ''], ['Phone apps build', false, '']],
    next: { task: 't2', text: 'Merge the 11 parallel agents into main' },
    say: 'On pace if wave 1 merges tonight. Every day it waits pushes hosting into the weekend.',
    acts: [['Hand it to Claude', 'mis-say', 'job'], ['Plan it at 21:00', 'mis-say', 'plan']],
    hist: [['Mon', 0, 0.2], ['Tue', 1 / 7, 0.35], ['Wed', 2 / 7, 0.45], ['Thu', 0.6, 0.55]], axis: ['Mon', 'Thu', 'Sun'],
    checks: [['Wed 21 · 21:00', 'Wyn', 'on', 'Reports landed. Wave 1 is waiting on the merge.'], ['Mon 19 · 09:00', 'You', 'on', 'Five areas left.']],
    projects: ['atlas'],
  },
  g3: {
    short: '5,000 followers', measure: '2,310 of 5,000 followers', start: '1 Oct',
    ms: [['A shoot pack ready every night', true, '8 Oct'], ['7 reels a week, two weeks running', false, '4 of 7 this week'], ['5,000 followers', false, '2,310 now']],
    next: { task: 't5', text: 'Shoot: 1 reel (R1) at 18:45' },
    say: 'Behind pace. 2,690 followers in 9 days is out of reach. Keep 7 reels a week as October\'s goal and move the 5,000 to December.',
    acts: [['Split it for me', 'mis-say', 'split'], ['Keep it as it is', 'mis-say', 'keep']],
    hist: [['1 Oct', 0, 0.3], ['8 Oct', 7 / 31, 0.35], ['15 Oct', 14 / 31, 0.41], ['22 Oct', 0.71, 0.46]], axis: ['1 Oct', '22 Oct', '31 Oct'],
    checks: [['Sun 18 · 19:00', 'Wyn', 'risk', '4 reels last week. Followers grew 6% against 12% needed.'], ['Sun 11 · 19:00', 'You', 'on', 'The shoot pack works.']],
    projects: ['content-os'],
  },
  g4: {
    short: '₹2 lakh a month', measure: '₹36,000 of ₹2 lakh this month', start: '1 Oct',
    ms: [['First Northwind client paid', true, '26 Sep'], ['Harborline OS signed and paid', false, 'This week'], ['Atlas ERP billing every month', false, 'Nov'], ['Reels every day for a month', false, 'Nov'], ['One month at ₹2 lakh', false, 'Dec']],
    say: 'On pace, just. It turns on Harborline paying this week and Atlas ERP billing from November.',
    acts: [['Open Money', 'mis-say', 'money']],
    hist: [['1 Oct', 0, 0.08], ['8 Oct', 7 / 92, 0.1], ['15 Oct', 14 / 92, 0.14], ['22 Oct', 0.24, 0.18]], axis: ['Oct', 'Nov', 'Dec'],
    checks: [['Sun 18 · 19:00', 'Wyn', 'on', '₹36,000 in so far. Two payments due this month.']],
    projects: ['atlas', 'content-os'],
  },
  g5: {
    short: '₹2 lakh, on my own', measure: 'Best month ₹60,000 (Sep) of ₹2 lakh', start: '6 Jul',
    ms: [['Get into college', true, 'Aug'], ['First paid client', true, 'Sep'], ['₹1 lakh in one month', false, 'Nov'], ['December at ₹2 lakh', false, 'Dec']],
    say: 'Behind on the calendar, but this one moves in steps: it lands when the quarter goal lands. Watch the quarter, not this ring.',
    acts: [['Open the quarter goal', 'mis-goal', 'g4']],
    hist: [['Jul', 0.5, 0.05], ['Aug', 0.58, 0.1], ['Sep', 0.67, 0.22], ['Oct', 0.81, 0.3]], axis: ['Jan', 'Oct', 'Dec'],
    checks: [['Sun 18 · 19:00', 'Wyn', 'risk', 'Behind on time, on track through the quarter goal.']],
  },
  g6: {
    short: 'Bench 60 kg', measure: 'Bench 50 of 60 kg', start: '1 Oct',
    ms: [['Bench 50 kg', true, 'Today'], ['Bench 55 kg', false, 'Nov'], ['Bench 60 kg', false, 'Dec'], ['4 sessions a week, 8 weeks running', false, '3 of 8']],
    next: { task: 't24', text: 'Protein: hit 120 g today' },
    say: 'Ahead. Push day moved your bench to 50 kg this morning. Four sessions a week gets you 55 by mid-November.',
    acts: [['Open Body', 'mis-say', 'body']],
    hist: [['1 Oct', 0, 0.2], ['8 Oct', 7 / 92, 0.27], ['15 Oct', 14 / 92, 0.33], ['22 Oct', 0.24, 0.4]], axis: ['Oct', 'Nov', 'Dec'],
    checks: [['Thu 22 · 07:50', 'Wyn', 'on', 'Logged from your workout: bench 50 kg × 5.']],
  },
  g7: {
    short: '12 books', measure: '7 of 12 books', start: '1 Jan',
    ms: [['7 books read', true, 'Sep'], ['Finish Atomic Habits', false, '20 pages a night'], ['Book 9', false, 'Nov'], ['Book 12', false, 'Dec']],
    next: { task: 't21', text: 'Read 20 pages of Atomic Habits at 21:30' },
    say: 'Behind. Five books in ten weeks is one every two weeks. Twenty pages a night does it.',
    acts: [['Open Mind', 'mis-say', 'mind']],
    hist: [['Jul', 0.5, 0.33], ['Aug', 0.58, 0.42], ['Sep', 0.67, 0.5], ['Oct', 0.81, 0.58]], axis: ['Jan', 'Oct', 'Dec'],
    checks: [['Sun 18 · 19:00', 'Wyn', 'risk', '22 pages this week.']],
  },
  g8: {
    short: '30 clean days', measure: 'Day 9 of 30', start: '14 Oct',
    ms: [['Day 7', true, '20 Oct'], ['Day 14', false, '27 Oct'], ['Day 30', false, '12 Nov']],
    say: 'Day 9. It can\'t finish inside October now: it ends on 12 Nov if the streak holds. Give it its own 30 days?',
    acts: [['Give it 30 days', 'mis-say', 'thirty'], ['Open Soul', 'mis-say', 'soul']],
    hist: [['14 Oct', 13 / 31, 0], ['18 Oct', 17 / 31, 0.13], ['22 Oct', 0.71, 0.3]], axis: ['1 Oct', '22 Oct', '31 Oct'],
    checks: [['Thu 22 · 09:00', 'Wyn', 'on', 'Day 9. The evening window held.']],
  },
  g9: {
    short: 'Friends, weekly', measure: '1 of 4 weeks', start: '1 Oct',
    ms: [['One meet in person', true, 'Week 1'], ['Saturday food with Kabir', false, 'Sat 24'], ['One more before 31 Oct', false, '']],
    next: { task: 't22', text: 'Message Kabir: food on Saturday?' },
    say: 'Saturday with Kabir makes it 2 of 4. I drafted the message; you send it.',
    acts: [['See the draft', 'mis-say', 'kabir']],
    hist: [['1 Oct', 0, 0], ['8 Oct', 7 / 31, 0.25], ['15 Oct', 14 / 31, 0.25], ['22 Oct', 0.71, 0.25]], axis: ['1 Oct', '22 Oct', '31 Oct'],
    checks: [['Sun 18 · 19:00', 'Wyn', 'off', 'No meet this week. Kabir last 12 days ago.']],
  },
  g10: {
    short: 'Parents\' 25th', measure: '₹8,000 saved of ₹80,000', start: '6 Jul',
    ms: [['An anniversary fund, started', true, 'Aug'], ['This year\'s dinner, paid by you', false, 'Sun 25'], ['Pick the place for the 25th', false, ''], ['The day', false, '']],
    next: { task: 't23', text: 'Book a table for Sunday\'s anniversary dinner' },
    say: 'On pace. Sunday\'s dinner is the rehearsal: pay for it yourself and log it in Family.',
    acts: [['Open Family', 'mis-say', 'family']],
    hist: [['Jul', 0, 0], ['Aug', 0.03, 0.05], ['Oct', 0.1, 0.1]], axis: ['Jul 2026', 'Now', '2031'],
    checks: [['Sun 18 · 19:00', 'Wyn', 'on', '₹8,000 in the fund.']],
  },
};

// ── closed since the life review on 6 Jul. state: done · missed · dropped. week: which week (W1 = 6–12 Jul) ──
export const WEEKS = [
  ['6–12 Jul', 'Jul'], ['13–19 Jul', ''], ['20–26 Jul', ''], ['27 Jul – 2 Aug', ''], ['3–9 Aug', 'Aug'], ['10–16 Aug', ''], ['17–23 Aug', ''],
  ['24–30 Aug', ''], ['31 Aug – 6 Sep', 'Sep'], ['7–13 Sep', ''], ['14–20 Sep', ''], ['21–27 Sep', ''], ['28 Sep – 4 Oct', 'Oct'], ['5–11 Oct', ''],
  ['12–18 Oct', ''], ['19–25 Oct', ''],
];
export const CLOSED = [
  // this week: closed today, when the Jobs board went live (JOBS j11)
  { id: 'c1', horizon: 'week', w: 15, title: 'Ship the Jobs board and Builders', state: 'done', when: 'Today 12:40', aspects: ['mission'], area: 'projects', note: 'Closed by Wyn when j11 went live.' },
  { id: 'c2', horizon: 'week', w: 14, title: 'Atlas ERP: stock and reports', state: 'done', when: 'Sun 18 Oct', aspects: ['mission', 'money'], area: 'northwind', parent: 'g4' },
  { id: 'c3', horizon: 'week', w: 14, title: 'Post 4 reels', state: 'done', when: 'Sat 17 Oct', aspects: ['mission', 'growth'], area: 'content', parent: 'g3' },
  { id: 'c4', horizon: 'week', w: 13, title: 'Atlas ERP: counter and bills', state: 'done', when: 'Sat 10 Oct', aspects: ['mission', 'money'], area: 'northwind', parent: 'g4' },
  { id: 'c5', horizon: 'week', w: 13, title: 'Gym four times', state: 'done', when: 'Sun 11 Oct', aspects: ['body'], area: 'personal', parent: 'g6' },
  { id: 'c6', horizon: 'week', w: 12, title: 'Atlas ERP kickoff', state: 'done', when: 'Thu 1 Oct', aspects: ['mission'], area: 'northwind' },
  { id: 'c7', horizon: 'week', w: 12, title: 'Post 3 reels', state: 'done', when: 'Sat 3 Oct', aspects: ['mission', 'growth'], area: 'content' },
  { id: 'c8', horizon: 'month', w: 12, title: 'Navratri collection live on Corner Market', state: 'done', when: '30 Sep', aspects: ['money', 'mission'], area: 'corner-market' },
  { id: 'c9', horizon: 'month', w: 12, title: 'Content OS running every night', state: 'done', when: '30 Sep', aspects: ['mission', 'growth'], area: 'content' },
  { id: 'c10', horizon: 'month', w: 12, title: 'Pitch five shops', state: 'done', when: '29 Sep', aspects: ['money', 'mission'], area: 'northwind' },
  { id: 'c11', horizon: 'quarter', w: 11, title: 'First paying Northwind client', state: 'done', when: '26 Sep', aspects: ['money', 'mission'], area: 'northwind', parent: 'g5' },
  { id: 'c12', horizon: 'week', w: 11, title: 'Close the first client', state: 'done', when: 'Sat 26 Sep', aspects: ['money', 'mission'], area: 'northwind' },
  { id: 'c13', horizon: 'week', w: 11, title: 'Ship Pulse Chat\'s order flow', state: 'missed', when: 'Sun 27 Sep', aspects: ['mission'], area: 'projects', note: 'Gave the week to the first client instead.' },
  { id: 'c14', horizon: 'week', w: 10, title: 'Navratri listings live', state: 'done', when: 'Fri 18 Sep', aspects: ['money'], area: 'corner-market' },
  { id: 'c15', horizon: 'week', w: 9, title: 'Send the first client proposal', state: 'done', when: 'Thu 10 Sep', aspects: ['money', 'mission'], area: 'northwind' },
  { id: 'c16', horizon: 'week', w: 9, title: 'Gym four times', state: 'missed', when: 'Sun 13 Sep', aspects: ['body'], area: 'personal', note: 'Three sessions; the fourth clashed with a tutorial.' },
  { id: 'c17', horizon: 'week', w: 8, title: 'Pitch two shops', state: 'done', when: 'Sat 5 Sep', aspects: ['money', 'mission'], area: 'northwind' },
  { id: 'c18', horizon: 'week', w: 8, title: 'Content OS: first script pack', state: 'done', when: 'Fri 4 Sep', aspects: ['mission', 'growth'], area: 'content' },
  { id: 'c19', horizon: 'dropped', w: 10, title: 'Start a YouTube channel', state: 'dropped', when: 'Dropped 14 Sep', aspects: ['mission'], area: 'content', note: 'Reels first. Long video can wait.' },
  { id: 'c20', horizon: 'week', w: 7, title: 'First week of classes in the calendar', state: 'done', when: 'Sat 29 Aug', aspects: ['mind'], area: 'college' },
  { id: 'c21', horizon: 'week', w: 7, title: 'Agentic OS on the phone', state: 'done', when: 'Sun 30 Aug', aspects: ['mission'], area: 'projects' },
  { id: 'c22', horizon: 'month', w: 8, title: 'Settle into college: timetable, travel, gym', state: 'done', when: '31 Aug', aspects: ['mind', 'body'], area: 'college' },
  { id: 'c23', horizon: 'month', w: 8, title: 'Read 3 books in August', state: 'missed', when: '31 Aug', aspects: ['mind'], area: 'personal', note: 'Two of three.' },
  { id: 'c24', horizon: 'week', w: 6, title: 'Gym four times', state: 'missed', when: 'Sun 23 Aug', aspects: ['body'], area: 'personal', note: 'College started; mornings moved.' },
  { id: 'c25', horizon: 'dropped', w: 6, title: 'Learn Rust', state: 'dropped', when: 'Dropped 22 Aug', aspects: ['mind'], area: 'projects', note: 'Not this year. Ship first.' },
  { id: 'c26', horizon: 'quarter', w: 5, title: 'Get into college', state: 'done', when: '14 Aug', aspects: ['mind', 'mission'], area: 'college', parent: 'g5' },
  { id: 'c27', horizon: 'week', w: 5, title: 'City College admission fees paid', state: 'done', when: 'Fri 14 Aug', aspects: ['mind'], area: 'college' },
  { id: 'c28', horizon: 'week', w: 5, title: 'Agentic OS: Today page, first version', state: 'done', when: 'Sun 16 Aug', aspects: ['mission'], area: 'projects' },
  { id: 'c29', horizon: 'week', w: 4, title: 'Pick the college', state: 'done', when: 'Sat 8 Aug', aspects: ['mind'], area: 'college' },
  { id: 'c30', horizon: 'week', w: 4, title: 'Read 100 pages', state: 'missed', when: 'Sun 9 Aug', aspects: ['mind'], area: 'personal', note: '64 pages.' },
  { id: 'c31', horizon: 'month', w: 3, title: 'A morning routine that sticks', state: 'done', when: '31 Jul', aspects: ['body', 'soul'], area: 'personal' },
  { id: 'c32', horizon: 'month', w: 3, title: 'Corner Market: 100 new listings', state: 'missed', when: '31 Jul', aspects: ['money'], area: 'corner-market', note: '62 listed.' },
  { id: 'c33', horizon: 'week', w: 3, title: 'Fill the college admission form', state: 'done', when: 'Thu 30 Jul', aspects: ['mind'], area: 'college' },
  { id: 'c34', horizon: 'week', w: 3, title: 'Gym four times', state: 'done', when: 'Sun 2 Aug', aspects: ['body'], area: 'personal' },
  { id: 'c35', horizon: 'week', w: 2, title: 'Wyn: the morning call works', state: 'done', when: 'Sat 25 Jul', aspects: ['mission'], area: 'projects' },
  { id: 'c36', horizon: 'week', w: 1, title: 'Corner Market: 20 new listings', state: 'done', when: 'Fri 17 Jul', aspects: ['money'], area: 'corner-market' },
  { id: 'c37', horizon: 'week', w: 1, title: 'Wyn: the morning call works', state: 'missed', when: 'Sun 19 Jul', aspects: ['mission'], area: 'projects', note: 'Landed the week after.' },
  { id: 'c38', horizon: 'week', w: 0, title: 'Score the life wheel', state: 'done', when: 'Mon 6 Jul', aspects: ['growth'], area: 'personal' },
  { id: 'c39', horizon: 'week', w: 0, title: 'Gym four times', state: 'done', when: 'Sun 12 Jul', aspects: ['body'], area: 'personal' },
];

// The graph's own counts since 6 Jul, by week (cumulative, end of each week W1…W16); they agree with CLOSED's totals:
// 49 set · 30 done · 7 missed · 2 dropped · 10 pending (GOALS)
export const BURN = {
  set: [9, 11, 12, 14, 19, 21, 22, 24, 30, 32, 33, 35, 42, 44, 46, 49],
  done: [2, 3, 4, 7, 8, 11, 11, 13, 16, 17, 18, 20, 25, 27, 29, 30],
};
export const TOTALS = { set: 49, done: 30, pending: 10, missed: 7, dropped: 2 };
// week by week: true = every week goal hit; false = one or more missed; null = this week, still open
export const WEEK_HIT = [true, false, true, true, false, true, false, true, true, false, true, false, true, true, true, null];
export const MONTH_HIT = [['Jul', 1, 2], ['Aug', 1, 2], ['Sep', 3, 3], ['Oct', 0, 3, true]];
export const QUARTER_HIT = [['Q3', 2, 2], ['Q4', 0, 2, true]];

// What the agent did in Mission today, newest first
export const LOG = [
  ['17:30', 'Checked pace on all 10 goals. Harborline and the 5,000 followers slipped behind.', 'g1'],
  ['15:10', 'Linked "Upload 12 new kurta listings" to ₹2 lakh a month.', 'g4'],
  ['12:40', 'Closed "Ship the Jobs board and Builders" when j11 went live.', 'c1'],
  ['09:00', 'Moved "Merge wave 1" into this week. It\'s 2 days late.', 'g2'],
];

// Suggestions in Add a goal: from what has no goal yet
export const SUGGEST = [
  { text: '50 Corner Market orders in November', why: 'Corner Market has no goal', horizon: 'month', period: 'November', aspects: ['money', 'mission'], parent: 'g4',
    measure: 'Orders · 0 → 50', steps: ['List the 12 new kurtas today', 'One kurta reel every other day', 'A Diwali offer on WhatsApp'], note: 'That\'s 12 orders a week. Today\'s listings task is the first step.' },
  { text: 'Finish Atomic Habits by Sunday', why: 'Feeds 12 books', horizon: 'week', period: 'This week', aspects: ['mind'], parent: 'g7',
    measure: 'Pages · 140 → 320', steps: ['20 pages tonight at 21:30', '60 pages on Saturday', 'Notes into the Brain'], note: 'Book 8 of 12. It keeps the year goal in reach.' },
  { text: 'Plan the 25th with Mom and Dad\'s friends', why: 'Feeds the 25th', horizon: 'later', period: 'Years out', aspects: ['family', 'money'], parent: 'g10',
    measure: 'Steps · 0 of 4', steps: ['Ask Dad who they\'d want there', 'A budget for the day', '₹2,000 a month into the fund'], note: 'A long one. I\'ll check on it once a month.' },
];

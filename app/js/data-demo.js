// The approved prototype's sample data, kept as it was: the app shows it only under ?data=demo (and the prototype's
// tools read it). js/data.js serves these same names from the real bootstrap; what still has no backend comes from
// here in real mode too and is listed in data.js's MOCK set. "Now" in this file is Thu 22 Oct 2026, 17:40.
// Owned by the lead. Never import this file from an area: read js/data.js.
export const NOW = 17 * 60 + 40;   // minutes since midnight
export const TODAY_LABEL = { weekday: 'Thursday', day: 22, month: 'October', short: 'Thu 22 Oct', iso: '2026-10-22' };

// ── who ───────────────────────────────────────────────────────────────
export const ME = { name: 'Alex Morgan', first: 'Alex', initial: 'A', city: 'Delhi', home: 'Midtown', college: 'City College', year: 'First year' };
// The agent. The product's agent is Wyn (Alex's ruling, 22 Oct); "Wyn" is the name he gave his own.
export const AGENT = { name: 'Wyn', product: 'Wyn', pronoun: 'she', heartbeat: 15, models: { cheap: 'Jev router', deep: 'Claude Opus 5.5' } };

// ── the life wheel: nine aspects in three families (Ali Abdaal's wheel: health, work, relationships) ──
// score: the last scoring (6 Jul), 0–10. Each aspect is its own app (js/aspects/<id>.js); its colour tokens are --<id>.
export const FAMILIES = { health: 'Health', work: 'Work', people: 'Relationships' };
export const ASPECTS = [
  { id: 'body', name: 'Body', fam: 'health', score: 2, line: 'Train, eat, recover, look after your face' },
  { id: 'mind', name: 'Mind', fam: 'health', score: 3, line: 'What you read, watch, learn and scroll' },
  { id: 'soul', name: 'Soul', fam: 'health', score: 2, line: 'Habits, quitting, and doing the right thing' },
  { id: 'mission', name: 'Mission', fam: 'work', score: 3, line: 'Your purpose, and goals across time horizons' },
  { id: 'money', name: 'Money', fam: 'work', score: 4, line: 'Earn, spend, budget, net worth' },
  { id: 'growth', name: 'Growth', fam: 'work', score: 5, line: 'Journal, review the week, dream, plan' },
  { id: 'family', name: 'Family', fam: 'people', score: 5, line: 'Time with the people at home' },
  { id: 'romance', name: 'Romance', fam: 'people', score: 1, line: 'Love, dating, and being ready for it' },
  { id: 'friends', name: 'Friends', fam: 'people', score: 2, line: 'Your circle, kept warm' },
];
export const aspect = (id) => ASPECTS.find((a) => a.id === id);

// ── people: only the real ones (brain: note/close-relationships). Never invent friends to fill a screen;
//    an honest short list with a good empty state beats a fake circle. Each person is a file in the Brain. ──
export const PEOPLE = [
  { id: 'dad', name: 'Dad', rel: 'family', role: 'Father · runs Morgan & Co.', aspect: 'family', last: 'Today, at the shop', file: 'people/family/dad' },
  { id: 'mom', name: 'Mom', rel: 'family', role: 'Mother', aspect: 'family', last: 'Today, breakfast', file: 'people/family/mom' },
  { id: 'kabir', name: 'Kabir', rel: 'friend', role: 'Childhood friend · the weekly food buddy', aspect: 'friends', last: '12 days ago', file: 'people/friends/kabir' },
  { id: 'rohan', name: 'Rohan', rel: 'friend', role: 'Friend from school', aspect: 'friends', last: 'Today, on WhatsApp', file: 'people/friends/rohan' },
];
export const person = (id) => PEOPLE.find((p) => p.id === id);

export const AREAS = {
  college: { name: 'City College', color: '#5b8def' },
  'morgan-co': { name: 'Morgan & Co.', color: '#d9822b' },
  'corner-market': { name: 'Corner Market', color: '#e0559b' },
  northwind: { name: 'Northwind', color: '#7c5cff' },
  projects: { name: 'Projects', color: '#2bb39a' },
  content: { name: 'Content', color: '#f2b134' },
  personal: { name: 'Personal + Health', color: '#4caf50' },
  none: { name: 'No area', color: '#8e8e93' },
};
export const area = (slug) => AREAS[slug] ?? AREAS.none;

const t = (h, m = 0) => h * 60 + m;
// Thursday's calendar. aspect: which part of the wheel a block feeds (Home colours by it; Life counts the hours)
export const EVENTS = [
  { id: 'e0', title: 'Sleep', start: t(-1, 15), end: t(6), area: 'personal', aspect: 'body', sleep: true },
  { id: 'e1', title: 'Morning Gym · Push day', start: t(6, 30), end: t(7, 45), area: 'personal', aspect: 'body', where: 'Gym, Midtown' },
  { id: 'e2', title: 'GE I (Th.)', start: t(10, 30), end: t(11, 30), area: 'college', aspect: 'mind', where: 'City College, Block B' },
  { id: 'e3', title: 'P&S (Tut.)', start: t(12, 30), end: t(13, 30), area: 'college', aspect: 'mind', where: 'Room 14' },
  { id: 'e4', title: 'Shop: Corner Market listings', start: t(15), end: t(16, 15), area: 'corner-market', aspect: 'money', where: 'Morgan & Co.' },
  { id: 'e5', title: 'Deep work · Agentic OS', start: t(16, 30), end: t(18, 30), area: 'projects', aspect: 'mission' },
  { id: 'k1', title: 'Shoot: 1 reel (R1)', start: t(18, 45), end: t(19), area: 'content', aspect: 'mission', task: 't5' },
  { id: 'e6', title: 'Cardio + core', start: t(19), end: t(20), area: 'personal', aspect: 'body' },
  { id: 'e7', title: 'Dinner with Mom and Dad', start: t(20, 30), end: t(21, 15), area: 'personal', aspect: 'family', people: ['mom', 'dad'] },
  { id: 'e8', title: 'Journal + shut down the day', start: t(22), end: t(22, 20), area: 'personal', aspect: 'growth' },
  { id: 'e9', title: 'Sleep', start: t(22, 45), end: t(30), area: 'personal', aspect: 'body', sleep: true },
];

// aspect: which part of the wheel a task feeds; goal: the goal it moves (GOALS)
export const TASKS = [
  { id: 't1', title: 'Subscriptions: decide Codex Pro on last cycle usage; cancel Cursor', area: 'personal', aspect: 'money', list: 'overdue', late: '2 days late' },
  { id: 't2', title: 'Atlas ERP wave 1: merge the 11 parallel agents into main', area: 'projects', aspect: 'mission', list: 'overdue', late: '2 days late', project: 'atlas', goal: 'g2' },
  { id: 't3', title: 'Harborline OS: pick first-year price, send Basic / Advanced quote', area: 'northwind', aspect: 'money', list: 'overdue', late: '1 day late', goal: 'g1' },
  { id: 't4', title: 'Glowbox: invoice the catalog fill, ask the four launch inputs', area: 'northwind', aspect: 'money', list: 'overdue', late: '1 day late', goal: 'g4' },
  { id: 't5', title: 'Shoot: 1 reel (R1)', area: 'content', aspect: 'mission', list: 'today', when: '18:45', len: 15, goal: 'g3' },
  { id: 't6', title: 'ShopBrain: new logo options (Codex image gen)', area: 'projects', aspect: 'mission', list: 'doing', est: 30, spent: 22 },
  { id: 't7', title: 'Complete the new Atlas ERP system', area: 'projects', aspect: 'mission', list: 'doing', project: 'atlas', goal: 'g2' },
  { id: 't8', title: 'Website builder: Shopify-like client storefront', area: 'projects', aspect: 'mission', list: 'doing' },
  { id: 't9', title: 'Pulse Chat: native iOS / Android apps', area: 'projects', aspect: 'mission', list: 'doing', project: 'pulsechat' },
  { id: 't10', title: 'Glowbox: website UI design', area: 'projects', aspect: 'mission', list: 'doing' },
  { id: 't11', title: 'Atlas ERP: native iPhone + Android apps', area: 'projects', aspect: 'mission', list: 'doing', project: 'atlas', goal: 'g2' },
  { id: 't12', title: 'Reply to the Atlas ERP onboarding call notes', area: 'northwind', aspect: 'mission', list: 'today', when: 'Today' },
  { id: 't13', title: 'Upload 12 new kurta listings', area: 'corner-market', aspect: 'money', list: 'today', when: 'Today', len: 45 },
  { id: 't14', title: 'Dad: close the website payment, propose a monthly fee', area: 'northwind', aspect: 'money', list: 'upcoming', when: 'Fri 23', goal: 'g4' },
  { id: 't15', title: 'ShopBrain founding five: 5 names from Dad\'s network', area: 'northwind', aspect: 'mission', list: 'upcoming', when: 'Sat 31' },
  { id: 't16', title: 'Sales system: pitch prep and a pitch slideshow creator', area: null, aspect: 'mission', list: 'inbox' },
  { id: 't17', title: 'UI: pin Cabinet and Content at the top of More', area: 'projects', aspect: 'mission', list: 'nodate', project: 'agentic-os' },
  { id: 't18', title: 'Keyboard: attach latest screenshot not working', area: 'projects', aspect: 'mission', list: 'nodate', project: 'agentic-os', job: 'j12' },
  { id: 't19', title: 'Morning Gym · Push day', area: 'personal', aspect: 'body', list: 'done', goal: 'g6' },
  { id: 't20', title: 'Algebra tutorial sheet 3', area: 'college', aspect: 'mind', list: 'done' },
  { id: 't21', title: 'Read 20 pages of Atomic Habits', area: 'personal', aspect: 'mind', list: 'today', when: '21:30', len: 30, goal: 'g7' },
  { id: 't22', title: 'Message Kabir: food on Saturday?', area: 'personal', aspect: 'friends', list: 'today', when: 'Today', person: 'kabir', goal: 'g9' },
  { id: 't23', title: 'Book a table for Mom and Dad\'s anniversary dinner', area: 'personal', aspect: 'family', list: 'upcoming', when: 'Sun 25', goal: 'g10' },
  { id: 't24', title: 'Protein: hit 120 g today', area: 'personal', aspect: 'body', list: 'today', when: 'Today', goal: 'g6' },
  { id: 't25', title: 'Log October expenses from the bank statement', area: 'personal', aspect: 'money', list: 'inbox' },
];
export const LISTS = [
  ['overdue', 'Overdue'], ['today', 'Today'], ['doing', 'Ongoing'], ['inbox', 'Inbox'], ['upcoming', 'Upcoming'],
];

// ── jobs ── task / goal: what a job moves (Today, Work and the agent show the same links) ──
export const JOBS = [
  { id: 'j12', title: 'Keyboard: latest screenshot attaches', agent: 'codex', model: 'gpt-6.1-sol', effort: 'High', lane: 'needs', project: 'agentic-os', task: 't18',
    ask: { kind: 'permission', text: 'Run bun test server in the j12 copy?' }, worktree: true, cache: 31, ago: '3m', last: 'Waiting for your OK to run the tests.', progress: { done: 4, total: 6, step: 'Run tests', stage: 'Verify' } },
  { id: 'j13', title: 'Atlas ERP: price three tiers', agent: 'claude', model: 'Opus 5.5', effort: 'High', lane: 'needs', project: 'atlas', goal: 'g4',
    ask: { kind: 'form', text: 'Anchor the top tier at ₹25,000 or ₹40,000 a month?' }, worktree: false, cache: 44, ago: '9m', last: 'Compared 4 competitor pricing pages.', progress: { done: 2, total: 4, step: 'Pick the anchor', stage: 'Decide' } },
  { id: 'j15', title: 'New UI mockup: liquid glass', agent: 'claude', model: 'Opus 5.5', effort: 'High', lane: 'working', project: 'agentic-os', star: true,
    worktree: false, cache: 52, ago: 'now', last: 'Writing the Jobs board: lanes, ship chips, cache rings.', progress: { done: 3, total: 7, step: 'Jobs + Content OS', stage: 'Build' } },
  { id: 'j9', title: 'Content OS: nightly shoot pack v2', agent: 'claude', model: 'Sonnet 5.5', effort: 'Medium', lane: 'working', project: 'content-os', task: 't5', goal: 'g3',
    worktree: true, cache: 38, ago: '1m', last: 'Grouping 4 scripts into 2 setups.', progress: { done: 4, total: 6, step: 'Teleprompter cards', stage: 'Build' }, queued: 1 },
  { id: 'j14', title: 'Worktree jobs by default', agent: 'claude', model: 'Opus 5.5', effort: 'High', lane: 'review', project: 'agentic-os',
    ship: 'building', worktree: true, cache: 12, ago: '24m', last: 'Handed to the Builder. Build run 39571.', diff: [412, 88, 9] },
  { id: 'j5', title: 'Session activity on the island', agent: 'codex', model: 'gpt-6.1-sol', effort: 'Medium', lane: 'review', project: 'agentic-os',
    ship: 'none', worktree: true, cache: 0, ago: '2h', last: 'Live Activity shows the current job step.', diff: [120, 14, 4] },
  { id: 'j11', title: 'Jobs board, Builders and cache tracking', agent: 'claude', model: 'Opus 5.5', effort: 'High', lane: 'done', project: 'agentic-os', ship: 'live', ago: '5h', diff: [1840, 210, 23] },
  { id: 'j10', title: 'Keyboard setup in Settings', agent: 'codex', model: 'gpt-6.1-sol', effort: 'Medium', lane: 'done', project: 'agentic-os', ship: 'live', ago: '7h' },
  { id: 'j7', title: 'Voice meter recovers; effort picker', agent: 'claude', model: 'Sonnet 5.5', effort: 'Medium', lane: 'done', project: 'agentic-os', ship: 'live', ago: '9h' },
  { id: 'j6', title: 'Restarts no longer cut off jobs', agent: 'claude', model: 'Opus 5.5', effort: 'High', lane: 'done', project: 'agentic-os', ship: 'live', ago: '11h' },
  { id: 'j4', title: 'Mic level meter', agent: 'codex', model: 'gpt-6.1-sol', effort: 'Low', lane: 'done', project: 'agentic-os', ship: 'failed', ago: '1d' },
  { id: 'j8', title: 'Parallel jobs landing lane', agent: 'claude', model: 'Opus 5.5', effort: 'High', lane: 'archive', project: 'agentic-os', ago: '1d' },
  { id: 'j2', title: 'Wyn brain over MCP', agent: 'codex', model: 'gpt-6.1-sol', effort: 'High', lane: 'archive', project: 'wyn', ago: '3d' },
];
export const LANES = [
  ['needs', 'Needs you'], ['working', 'Working'], ['review', 'To review'], ['done', 'Completed'], ['archive', 'Archive'],
];
export const BUILDERS = [
  { id: 'b1', project: 'agentic-os', name: 'Agentic OS', model: 'Sonnet 5.5', effort: 'Medium', state: 'building', last: 'j14 · build 39571 running' },
  { id: 'b2', project: 'atlas', name: 'Atlas ERP', model: 'Sonnet 5.5', effort: 'Medium', state: 'idle', last: 'Last ship live 1d ago' },
];
export const SHIP = {
  none: ['Not shipped', 'var(--ink-3)'], queued: ['Queued to ship', 'var(--blue)'], building: ['Building', 'var(--blue)'],
  live: ['Live', 'var(--green)'], failed: ['Ship failed', 'var(--red)'],
};

export const PROJECTS = [
  { slug: 'agentic-os', name: 'Agentic OS', icon: '🚀', area: 'projects', color: '#2bb39a', folder: '~/agentic-os', desc: 'Phone + desk OS: Today, tasks, jobs, Content OS, Wyn.', tasks: 3, ideas: 4 },
  { slug: 'atlas', name: 'Atlas ERP', icon: 'A', area: 'northwind', color: '#7c5cff', folder: '~/atlas', desc: 'ERP for a client: counter, bills, stock, reports.', tasks: 3, ideas: 1 },
  { slug: 'wyn', name: 'Wyn', icon: 'N', area: 'projects', color: '#5ce1b4', folder: '~/wyn', desc: 'The assistant who calls, chats and remembers.', tasks: 0, ideas: 7 },
  { slug: 'content-os', name: 'Content OS', icon: '🎬', area: 'content', color: '#f2b134', folder: '~/content-os', desc: 'Ideas in, scripts out, reels posted.', tasks: 1, ideas: 5 },
  { slug: 'pulsechat', name: 'Pulse Chat', icon: 'P', area: 'projects', color: '#3d9bff', folder: '~/pulsechat', desc: 'WhatsApp flows for shops.', tasks: 1, ideas: 0 },
];
export const project = (slug) => PROJECTS.find((p) => p.slug === slug);

export const IDEAS = [
  { id: 'i1', title: 'Wyn: reactions and voice notes on WhatsApp', project: 'wyn', ago: '2h' },
  { id: 'i2', title: 'Wyn: approval guardrails for outward actions', project: 'wyn', ago: '5h' },
  { id: 'i3', title: 'Wyn: "roast me" onboarding', project: 'wyn', ago: '1d' },
  { id: 'i4', title: 'Wyn: reports back when delegated work finishes', project: 'wyn', ago: '1d' },
  { id: 'i5', title: 'Agentic OS: hold a job row to peek its last output', project: 'agentic-os', ago: '3h', inbox: true },
  { id: 'i6', title: 'Agentic OS: one tap to hand a task to Codex', project: 'agentic-os', ago: '6h' },
  { id: 'i7', title: 'Wyn: texts first about real events', project: 'wyn', ago: '2d', inbox: true },
];

// ── a job chat ────────────────────────────────────────────────────────
export const CHAT = {
  j15: [
    { who: 'me', text: 'Mockup of the whole phone app, new UI. Apple-level, liquid glass, less clutter. Tasks compact on Home with a switch. Content OS and Jobs up front. Send me a Cloudflare link.' },
    { who: 'work', done: true, dur: '1m 52s', steps: [['read', 'Read index.html, app.js, MODULES.md'], ['term', 'Ran the app against a copy of agentos.db'], ['eye', 'Screenshotted 10 screens']] },
    { who: 'ai', text: 'Mapped the current app: 6 tabs, 12 modules, the Code board buried under Projects, Content under More. Plan: 5 tabs (Today, Jobs, Content, Life, More), Tasks folded into Today behind a switch.' },
    { who: 'plan', stages: [['Study', ['Map current app', 'Design direction'], 2], ['Build', ['Home + tasks panel', 'Jobs + Content OS', 'Other screens'], 1], ['Ship', ['Phone screenshots check', 'Cloudflare tunnel link'], 0]] },
    { who: 'work', done: false, steps: [['edit', 'Edit css/system.css'], ['edit', 'Edit js/jobs.js'], ['term', 'node shoot.mjs …/mockup']] },
  ],
};

// ── goals & life ──────────────────────────────────────────────────────
// aspects: the parts of the wheel a goal serves (the first is its home). parent: the longer goal it rolls up into.
// The Mission app owns how goals are shown and planned (time horizons); every app reads the same list.
export const GOALS = [
  { id: 'g1', horizon: 'week', title: 'Collect Harborline OS\'s first-year payment', area: 'northwind', aspects: ['money', 'mission'], parent: 'g4', pace: 0.2, time: 0.6, verdict: 'Behind pace', tasks: [1, 3] },
  { id: 'g2', horizon: 'week', title: 'Atlas ERP: every area to the AGENTS.md bar, tested, hosted', area: 'projects', aspects: ['mission'], parent: 'g4', pace: 0.55, time: 0.6, verdict: 'On pace', tasks: [5, 9] },
  { id: 'g3', horizon: 'month', title: 'A steady content system and 5,000 Instagram followers', area: 'content', aspects: ['mission', 'growth'], parent: 'g4', pace: 0.46, time: 0.71, verdict: 'Behind pace', metric: 'Instagram followers: 46%' },
  { id: 'g4', horizon: 'quarter', title: '₹2 lakh a month in revenue, and an audience through consistent Reels', area: null, aspects: ['money', 'mission'], parent: 'g5', pace: 0.18, time: 0.24, verdict: 'On pace' },
  { id: 'g5', horizon: 'year', title: 'End 2026 earning ₹2 lakh a month on my own', area: null, aspects: ['money', 'mission'], pace: 0.3, time: 0.81, verdict: 'Behind pace' },
  { id: 'g6', horizon: 'quarter', title: 'Bench 60 kg and train 4 days a week', area: 'personal', aspects: ['body'], pace: 0.4, time: 0.24, verdict: 'On pace', metric: 'Bench 50 of 60 kg' },
  { id: 'g7', horizon: 'year', title: 'Read 12 books in 2026', area: 'personal', aspects: ['mind'], pace: 0.58, time: 0.81, verdict: 'Behind pace', metric: '7 of 12 books' },
  { id: 'g8', horizon: 'month', title: '30 clean days', area: 'personal', aspects: ['soul'], pace: 0.3, time: 0.71, verdict: 'Behind pace', metric: 'Day 9 of 30' },
  { id: 'g9', horizon: 'month', title: 'See a friend in person every week', area: 'personal', aspects: ['friends'], pace: 0.25, time: 0.71, verdict: 'Behind pace', metric: '1 of 4 weeks' },
  { id: 'g10', horizon: 'later', title: 'Host Mom and Dad\'s 25th anniversary, paid by me', area: 'personal', aspects: ['family', 'money'], pace: 0.12, time: 0.1, verdict: 'On pace', metric: '₹18,400 of ₹1.5 lakh saved', fund: 'anniversary' },
];
export const HORIZONS = [['week', 'This week', '19–25 Oct, 3 days left'], ['month', 'October', '9 days left'], ['quarter', 'This quarter', 'Q4 2026'], ['year', 'This year', '2026'], ['later', 'Later', 'Years out'], ['life', 'Lifetime', 'The whole arc']];
// savings pots that more than one app shows (Family plans the 25th; Money holds the money). goal: the goal it funds
export const FUNDS = {
  anniversary: { id: 'anniversary', name: 'Anniversary fund', saved: 18400, target: 150000, month: 2500, goal: 'g10', aspect: 'family' },
};
// the old wheel shape, still read by life.js: [name, score, family]
export const WHEEL = ASPECTS.map((a) => [a.name, a.score, { health: 'self', work: 'work', people: 'people' }[a.fam]]);
// a new scoring of one aspect (the Life tab's score sheet): updates ASPECTS and WHEEL together
export function setScore(id, v) {
  const i = ASPECTS.findIndex((a) => a.id === id); if (i < 0) return;
  ASPECTS[i].score = v; WHEEL[i][1] = v;
}

// ── the agent's proactive feed: what she noticed, asked or did on her own (heartbeats every 15 min).
//    Home shows the top of it; the Agent tab owns the whole feed. kind: ask (needs a yes) · nudge · alarm · did ──
export const FEED = [
  { id: 'f1', at: '17:38', kind: 'ask', aspect: 'soul', title: 'Block Instagram till cardio?', text: 'It pulls you in between 18:00 and 19:00 most days: 52 min yesterday. I can lock it until 19:00; you can ask me to open it with a reason.', acts: [['Block till 19:00', 'feed-yes'], ['Not today', 'feed-no']] },
  { id: 'f2', at: '17:20', kind: 'nudge', aspect: 'body', title: 'Protein 62 of 120 g', text: 'Paneer at dinner covers about 30 g. A shake after cardio covers the rest.' },
  { id: 'f3', at: '16:05', kind: 'did', aspect: 'money', title: 'Logged ₹1,240 from 4 UPI messages', text: 'Chai ₹40, Uber ₹210, printouts ₹90 and a ₹900 shirt. ₹260 left in today\'s budget.' },
  { id: 'f4', at: '15:00', kind: 'nudge', aspect: 'friends', title: 'Kabir, 12 days', text: 'You usually eat out on Saturdays. Want me to draft "food on Saturday?" for you to send?' },
  { id: 'f5', at: '22:00', kind: 'alarm', aspect: 'growth', title: 'Save your 6-day journal streak', text: 'Tonight 22:00. Two lines are enough. If you miss it, I call at 22:30.', later: true },
];

// ── content OS ────────────────────────────────────────────────────────
export const CHANNELS = ['@northwindstudio', '@example_creator'];
export const CONTENT = {
  inbox: [
    { id: 'c1', title: 'My phone runs five coding agents while I sit in class', ch: '@northwindstudio', source: 'From your work', status: 'Scripted', tags: ['agents', 'build in public'] },
    { id: 'c2', title: 'Kurta fold hack in 30 seconds', ch: '@example_creator', source: 'With a reel', status: 'Card ready', tags: ['kurta', 'hack'] },
    { id: 'c3', title: 'Midtown shop tour: 30 years of Morgan & Co.', ch: '@example_creator', source: 'Idea', status: 'Inbox', tags: ['shop', 'story'] },
    { id: 'c4', title: 'What a ₹15k website gets a local shop', ch: '@northwindstudio', source: 'From your work', status: 'Inbox', tags: ['pricing'] },
    { id: 'c5', title: 'I replaced 5 apps with one OS I built', ch: '@northwindstudio', source: 'Idea', status: 'Scripted', tags: ['agentic os'] },
  ],
  pack: {
    day: 'Thu 22 Oct', scripts: 4, setups: [
      { name: 'Desk, window light', framing: 'Medium close-up, phone in hand', props: 'Laptop, iPhone, mic', takes: [
        { code: 'R1', title: 'My phone runs five coding agents', secs: 30, words: 80, status: 'Ready' },
        { code: 'R4', title: 'I replaced 5 apps with one OS', secs: 35, words: 92, status: 'Ready' },
      ] },
      { name: 'The store, Midtown', framing: 'Wide, then a slow push in', props: 'Silk scarf drape, mannequin', takes: [
        { code: 'R2', title: 'Kurta fold hack in 30 seconds', secs: 28, words: 64, status: 'Ready' },
        { code: 'R3', title: 'Midtown shop tour', secs: 45, words: 118, status: 'Writing' },
      ] },
    ],
  },
  edits: [
    { id: 'd1', title: 'Price reveal: a ₹15k website', ch: '@northwindstudio', status: 'Rendered v2', note: 'Cut the first 2 seconds, hook lands faster.', post: 'Fri 18:30' },
    { id: 'd2', title: 'Silk scarf drape in 30 seconds', ch: '@example_creator', status: 'Needs approval', note: 'Captions burnt in, music at -18 dB.', post: 'Sat 12:00' },
    { id: 'd3', title: 'Diwali kurta hooks', ch: '@example_creator', status: 'Rendering', note: '3 hooks, pick one.', post: null },
  ],
  posts: [
    { day: 'Today', items: [{ ch: '@northwindstudio', title: 'Agents in class', status: 'Posted', time: '09:00', views: '4.1k' }] },
    { day: 'Fri 23', items: [{ ch: '@northwindstudio', title: 'Price reveal', status: 'Scheduled', time: '18:30' }, { ch: '@example_creator', title: 'Kurta fold hack', status: 'Scheduled', time: '19:30' }] },
    { day: 'Sat 24', items: [{ ch: '@example_creator', title: 'Silk scarf drape', status: 'Waiting on edit', time: '12:00' }] },
  ],
  stats: { followers: 2310, goal: 5000, week: 4, weekGoal: 7, streak: 3 },
};

// ── modules on More ───────────────────────────────────────────────────
export const MODULES = [
  { id: 'cabinet', title: 'The Cabinet', icon: 'people', tint: '#a68bff', line: 'Sits Saturday 19:00' },
  { id: 'clients', title: 'Client window', icon: 'window', tint: '#3d9bff', line: '2 waiting on clients' },
  { id: 'ribbon', title: 'Reality ribbon', icon: 'ribbon', tint: '#5ce1b4', line: '2h 10m on Projects' },
  { id: 'weather', title: 'Week weather', icon: 'cloud', tint: '#8fb3ff', line: 'Stormy Thursday' },
  { id: 'demand', title: 'Demand radar', icon: 'radar', tint: '#ff6fae', line: '3 repeated asks' },
  { id: 'doctrine', title: 'Doctrine', icon: 'doc', tint: '#ffd60a', line: '1 new observation' },
  { id: 'thumbs', title: 'From your thumbs', icon: 'thumb', tint: '#f0875a', line: '3 redesigns proposed' },
  { id: 'price', title: 'Price on every block', icon: 'rupee', tint: '#32d74b', line: 'An hour is worth ₹1,200' },
  { id: 'runbooks', title: 'Runbooks', icon: 'book', tint: '#ffb340', line: '4 ready to run' },
  { id: 'bounty', title: 'Bounty board', icon: 'target', tint: '#ff5a4f', line: '2 bounties open' },
  { id: 'ping', title: 'Ping', icon: 'ping', tint: '#8e8e93', line: 'Modules are live' },
];

// ── Wyn ──────────────────────────────────────────────────────────────
export const WYN = {
  chat: [
    { who: 'wyn', text: 'Evening. Deep work runs till 18:30, then the reel shoot, then cardio at 19:00.' },
    { who: 'wyn', text: 'Two jobs need you: j12 wants to run the tests, j13 is asking which price to anchor.' },
    { who: 'me', text: 'Anchor at 40k.' },
    { who: 'wyn', text: 'Told j13: anchor at ₹40,000.', undo: true },
  ],
  calls: [
    { why: 'Morning call', summary: 'Planned the day around GE I; picked the reel shoot slot.', day: 'Today', len: '4 min', cost: '$0.06' },
    { why: 'You called', summary: 'Talked through Atlas ERP pricing; she filed a job.', day: 'Yesterday', len: '7 min', cost: '$0.11' },
    { why: 'Night call', summary: 'Shut down the day; 3 tasks moved to tomorrow.', day: 'Mon', len: '3 min', cost: '$0.05' },
  ],
};

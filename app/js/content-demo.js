// Content OS · the prototype's sample (demo mode, ?data=demo): idea cards with the agent's score and reasons, scripts
// with hook / beats / CTA, the shoot setups, edits with versions, the posting week, the numbers and what the learning
// loop changed. Now is Thu 22 Oct 2026, 17:40. Real mode never reads this file; content-data.js serves the PC's data.
import { CONTENT, EVENTS } from './data-demo.js';   // the sample, whatever mode data.js is in

const shared = (id) => CONTENT.inbox.find((x) => x.id === id) ?? {};
const sharedEdit = (id) => CONTENT.edits.find((x) => x.id === id) ?? {};

// ── the two channels: one engine, two identities ──────────────────────────
export const CHS = [
  { id: '@northwindstudio', short: 'northwindstudio', mono: 'N', tint: 'var(--content)', main: true,
    focus: 'AI news and building in public, on camera', voice: 'English, with Hinglish where it comes naturally',
    followers: 2310, delta: 86, goal: 'g3', slots: ['09:00', '18:30'], perDay: 1, look: 'Black, electric blue, silver' },
  { id: '@example_creator', short: 'example_creator', mono: 'E', tint: 'var(--content-2)', main: false,
    focus: 'Magic, hacks and fun to watch', short2: 'Magic and hacks', voice: 'Hinglish',
    followers: 640, delta: 12, goal: null, slots: ['12:00', '19:30'], perDay: 1, look: 'Warm, handheld, close up' },
];
export const chOf = (id) => CHS.find((c) => c.id === id) ?? CHS[0];

// ── idea cards. status: new (to sort) · kept (picked, no script yet) · writing · scripted · killed
//    source: radar · work (mined from what you built) · reel (you shared it) · you (you typed it)
//    why: the agent's reasons, signed: + raised the score, − lowered it (the learning loop at work) ──
export const IDEAS = [
  { id: 'c6', title: 'Claude and Codex get the same bug. Who fixes it first?', ch: '@northwindstudio', source: 'radar', status: 'new', score: 8.1, at: '02:30',
    from: 'A coding channel you follow · 1.2M views in 3 days',
    why: [['+', 'Agents are your best topic'], ['+', 'Fresh this week'], ['+', 'Easy proof on screen']],
    hook: 'Same bug. Two agents. One timer.',
    angle: 'Run it for real on Agentic OS: two jobs on the same bug, the clock on screen, and say who won and why.',
    proof: 'Screen: both jobs side by side with the timer running',
    ref: { views: '1.2M', age: '3 days', hook: 'Same bug, two agents, one timer.', structure: 'Setup, the race, the result, one takeaway', why: 'A race with a visible timer gives people a reason to stay to the end.' } },
  { id: 'c8', title: 'A card trick where my phone guesses your card', ch: '@example_creator', source: 'reel', status: 'new', score: 7.9, at: 'Tue',
    from: 'You shared it from Instagram on Tue',
    why: [['+', 'You saved it with a note'], ['+', 'Magic is what this channel is for'], ['+', 'Under 25 seconds']],
    hook: 'Card socho. Mera phone pehle se jaanta hai.',
    angle: 'The reveal lands on the phone screen, so the slow replay is the second half of the reel.',
    proof: 'Close up: the card, then the phone screen in one shot',
    ref: { views: '2.3M', age: '9 days', hook: 'Pick a card. My phone already knows it.', structure: 'The pick, the phone, the reveal, a slow replay', why: 'The reveal happens on a second screen, so people rewatch to catch the move.', note: 'Something like this, but with Agentic OS?' } },
  { id: 'c9', title: 'The one tap that keeps my coding agents safe', ch: '@northwindstudio', source: 'work', status: 'new', score: 7.7, at: '09:15',
    from: 'From your work · j12 asked before it ran the tests',
    why: [['+', 'From your work'], ['+', 'Fresh today'], ['+', 'Opens on the screen']],
    hook: 'My agent stopped and asked me first.',
    angle: 'Show the permission ask arrive on the phone mid-lecture and the one tap that lets it run.',
    proof: 'Screen: the "Run tests?" ask and the Allow button' },
  { id: 'c7', title: 'The coin that walks across my knuckles, slowed down 4×', ch: '@example_creator', source: 'radar', status: 'new', score: 7.4, at: '02:30',
    from: 'A sleight-of-hand channel you follow · 640k views',
    why: [['+', 'Magic is what this channel is for'], ['+', 'Short: about 15 seconds'], ['−', 'Needs practice before you shoot it']],
    hook: 'Coin dekho. Ab dobara dekho, dheere.',
    angle: 'Full speed once, then the same move at 4× slow motion with the trick named.',
    proof: 'Close up on the hand, plain background',
    ref: { views: '640k', age: '5 days', hook: 'Watch the coin. Now watch it again, slower.', structure: 'Full speed, 4× slow motion, the move named', why: 'The slow replay gives people a reason to watch twice.' } },
  { id: 'c4', title: shared('c4').title ?? 'What a ₹15k website gets a local shop', ch: '@northwindstudio', source: 'work', status: 'new', score: 5.6, at: '09:15',
    from: 'From your work · a shop website you finished',
    why: [['+', 'From your work'], ['−', 'Pricing ideas: you killed 4 of the last 5'], ['−', 'Hard to show in the first 3 seconds']],
    hook: 'This is everything a local shop gets for its website.',
    angle: 'Walk the finished site on the phone in one take, the way a shop owner would use it.',
    proof: 'Screen: the shop\'s site on a phone' },
  { id: 'c10', title: 'City College lectures by day, shipping at night: one day in 30 seconds', ch: '@northwindstudio', source: 'you', status: 'kept', score: 7.2, at: 'Mon',
    from: 'You typed it on Mon',
    why: [['+', 'You wrote it yourself'], ['+', 'Build in public brings the most follows']],
    hook: '9:30 lecture. 11 PM deploy. Same phone.',
    angle: 'Five shots across one real day, each with the clock on screen.',
    proof: 'The phone\'s clock in every shot' },
  { id: 'c11', title: 'Making a ₹10 coin vanish at a chai stall', ch: '@example_creator', source: 'radar', status: 'kept', score: 7.0, at: 'Wed',
    from: 'A street magic reel you follow · 410k views',
    why: [['+', 'Magic is what this channel is for'], ['+', 'Real place, real reactions']],
    hook: 'Bhaiya, yeh dus ka sikka dekh rahe ho?',
    angle: 'One take at a stall you know; ask before you film anyone.',
    proof: 'The stall, the coin, the reaction' },
  { id: 'c1', title: shared('c1').title, ch: '@northwindstudio', source: 'work', status: 'scripted', take: 'R1', score: 8.6, at: 'Wed',
    from: 'From your work · five jobs ran from your phone', why: [['+', 'From your work'], ['+', 'Agents are your best topic'], ['+', 'Opens on the screen']] },
  { id: 'c5', title: shared('c5').title, ch: '@northwindstudio', source: 'you', status: 'scripted', take: 'R4', score: 7.8, at: 'Tue',
    from: 'You typed it on Tue', why: [['+', 'You wrote it yourself'], ['+', 'A script already exists']] },
  { id: 'c2', title: shared('c2').title, ch: '@example_creator', source: 'reel', status: 'scripted', take: 'R2', score: 7.6, at: 'Sun',
    from: 'You shared a reel on Sun', why: [['+', 'Reference card analysed'], ['+', 'Hacks do well here']] },
  { id: 'c3', title: shared('c3').title, ch: '@example_creator', source: 'you', status: 'writing', take: 'R3', score: 7.1, at: 'Sat',
    from: 'You typed it on Sat', why: [['+', 'You wrote it yourself']] },
];

// ── scripts: hook (three drafts, one chosen), beats (what you say and what is on screen), the CTA ──
// The teleprompter reads hook + beats + CTA as one line per sentence (content-ui.js takeLines).
export const SCRIPTS = {
  R1: { idea: 'c1', ch: '@northwindstudio', setup: 0, status: 'ready', title: CONTENT.pack.setups[0].takes[0].title,
    hooks: ['I\'m sitting in a lecture right now. And five coding agents are building software for me.', 'My laptop is at home. My code is still shipping.', 'Five AI agents are working for me. I\'m in class.'],
    beats: [
      { k: 'Proof', say: ['This is Agentic OS. I built it.', 'Every job runs on my PC at home.'], show: 'Screen: the Work tab, five jobs running' },
      { k: 'How it works', say: ['Claude and Codex write the code.', 'My phone shows each step, and pings me when one needs a decision.'], show: 'Screen: a job\'s steps, then the ping' },
      { k: 'The moment', say: ['This one wants to run the tests. I tap OK.', 'That one asks which price to anchor. I answer in one line.'], show: 'Close up: your thumb on Allow' },
      { k: 'Payoff', say: ['By the time class ends, two features are live.'], show: 'Screen: two jobs turn Live' },
    ],
    cta: 'Follow if you want to see how it\'s built.',
    checks: [['ok', 'Hook lands in 2 seconds'], ['ok', 'Proof on screen by 0:03'], ['ok', 'One payoff before the CTA'], ['ok', 'Under 35 seconds'], ['ok', 'Nothing promised in the CTA']] },
  R4: { idea: 'c5', ch: '@northwindstudio', setup: 0, status: 'ready', title: CONTENT.pack.setups[0].takes[1].title,
    hooks: ['I used to pay for five apps.', 'Five apps, and none of them talked to each other.', 'I deleted five apps this month.'],
    beats: [
      { k: 'Problem', say: ['A calendar, a task list, a notes app, a habit tracker, and a CRM.', 'None of them talked to each other.'], show: 'Five app icons, one after another' },
      { k: 'Turn', say: ['So I built one OS that does all of it.'], show: 'Screen: Agentic OS opens' },
      { k: 'Proof', say: ['My day, my tasks, my clients and my content live in one place.', 'And agents do the boring parts while I sleep.'], show: 'Screen: Today, then Work, then Content' },
      { k: 'Payoff', say: ['This is what it looks like on my phone.'], show: 'Hold the phone up to the lens' },
    ],
    cta: 'Comment “OS” and I\'ll show you the setup.',
    checks: [['ok', 'Hook lands in 2 seconds'], ['ok', 'Proof on screen by 0:06'], ['ok', 'Under 35 seconds'], ['warn', 'The CTA promises a DM, and no reply is set up for “OS”']],
    fixCta: 'Follow, and I\'ll show the setup next week.' },
  R2: { idea: 'c2', ch: '@example_creator', setup: 1, status: 'ready', title: CONTENT.pack.setups[1].takes[0].title,
    hooks: ['Zyada tar log kurta aise fold karte hain.', 'Aapki kurta yahin se crease hoti hai. Har baar.', 'Tees saal ka fold, tees second mein.'],
    beats: [
      { k: 'Problem', say: ['Aur scarf pe seedha crease aa jaata hai.'], show: 'Close up: the crease on the scarf' },
      { k: 'Turn', say: ['Dad tees saal se aise fold karte hain.'], show: 'Wide: the counter, then push in' },
      { k: 'Steps', say: ['Pehle border ke saath pleats.', 'Phir knot upar se, neeche se kabhi nahi.', 'Roll karo, press mat karo.'], show: 'Top down: hands on the fold' },
      { k: 'Payoff', say: ['Tees second, aur almari ke liye ready.'], show: 'The folded kurta on the shelf' },
    ],
    cta: 'Agli shaadi ke liye save kar lo.',
    checks: [['ok', 'Hook lands in 2 seconds'], ['ok', 'Hinglish, as this channel likes'], ['ok', 'One payoff before the CTA'], ['ok', 'Nothing promised in the CTA']] },
  R3: { idea: 'c3', ch: '@example_creator', setup: 1, status: 'writing', title: CONTENT.pack.setups[1].takes[1].title, progress: 2, of: 4,
    hooks: ['Tees saal purani dukaan, ek minute mein.'], beats: [
      { k: 'Open', say: ['Midtown ki galiyon mein ek dukaan hai.'], show: 'Walk in from the street' },
      { k: 'Story', say: ['Dad tees saal se isi counter pe baithe hain.'], show: 'The old signboard' },
    ], cta: '', checks: [] },
};

// ── the shoot: the pack's setups (shared) with the light, outfit and a framing guide ──
const k1 = EVENTS.find((e) => e.id === 'k1');
export const SHOOT = {
  at: k1?.start ?? 18 * 60 + 30, len: k1 ? k1.end - k1.start : 15, task: k1?.task ?? 't5', job: 'j9', planned: '04:10',
  setups: [
    { ...CONTENT.pack.setups[0], light: 'Window on your left; best before the sun drops at 18:50', outfit: 'Black tee', frame: 'mcu', codes: ['R1', 'R4'] },
    { ...CONTENT.pack.setups[1], light: 'Shop tube lights, plus the ring light at 40%', outfit: 'White kurta', frame: 'wide', codes: ['R2', 'R3'], when: 'At the shop' },
  ],
};

// ── edits: renders waiting on him, with versions and what changed ──
export const EDITS = [
  { id: 'd2', title: sharedEdit('d2').title ?? 'Silk scarf drape in 30 seconds', ch: '@example_creator', status: 'review', v: 2, len: 29, post: 'Sat 12:00', day: 5, slot: '12:00',
    cover: { lines: ['Silk scarf drape', 'in 30 seconds'], hi: 0, scene: 'kurta' },
    changes: ['Captions burnt in, word by word', 'Music down to −18 dB under your voice', 'Ends on the drape, not the logo'],
    history: [['v1', 'Wed 22:10', 'First cut, 0:31'], ['note', 'Wed 22:40', 'Captions bigger, music lower'], ['v2', 'Today 11:40', '3 changes, 0:29']],
    checks: [['ok', 'Hook at 0:01'], ['ok', 'Captions on'], ['ok', 'Loudness −14 LUFS'], ['ok', 'Clear of Instagram\'s buttons'], ['ok', '0:29 long']],
    caption: 'Silk scarf drape, tees second mein. Knot wala trick end mein hai.', tags: ['#kurta', '#silk', '#drape'],
    track: [[0, 'Silk scarf drape'], [2.5, 'tees second mein'], [6, 'pehle fold'], [12, 'knot upar se'], [19, 'pin, aur done'], [25, 'save kar lo']] },
  { id: 'd3', title: sharedEdit('d3').title ?? 'Diwali kurta hooks', ch: '@example_creator', status: 'rendering', v: 1, len: 24, p: .64, post: null,
    cover: { lines: ['Ek kurta,', 'teen Diwali looks'], hi: 1, scene: 'diya' },
    hooks: ['Is Diwali, yeh drape try karo.', 'Ek kurta, teen Diwali looks.', 'Diwali se pehle yeh zaroor dekh lo.'],
    note: sharedEdit('d3').note ?? '3 hooks, pick one.' },
  { id: 'd1', title: sharedEdit('d1').title ?? 'Price reveal: a ₹15k website', ch: '@northwindstudio', status: 'scheduled', v: 2, len: 31, post: 'Fri 18:30', day: 4, slot: '18:30',
    cover: { lines: ['What a local', 'shop website gets'], hi: 1, scene: 'site' },
    changes: [sharedEdit('d1').note ?? 'Cut the first 2 seconds, hook lands faster.'],
    history: [['v1', 'Mon 20:05', 'First cut, 0:33'], ['note', 'Mon 21:00', 'Hook lands too late'], ['v2', 'Tue 10:20', 'Cut the first 2 seconds'], ['ok', 'Tue 10:31', 'You approved it']],
    caption: 'Everything a local shop gets with its website, in one take.', tags: ['#buildinpublic', '#smallbusiness'] },
];

// ── the posting week, Mon 19 to Sun 25 Oct. One reel a day on either channel keeps the streak.
//    s: posted · scheduled · review (waiting on your approval) · empty (an open slot) ──
export const WEEK = [
  { d: 'Mon', n: 19, posts: [] },
  { d: 'Tue', n: 20, posts: [{ ch: '@northwindstudio', t: '09:00', title: 'Claude Code on the metro', s: 'posted', views: 2600, hold: 61, cover: { lines: ['Claude Code', 'on the metro'], hi: 0, scene: 'metro' } }] },
  { d: 'Wed', n: 21, posts: [
    { ch: '@northwindstudio', t: '18:30', title: 'What I ship between lectures', s: 'posted', views: 3200, hold: 57, cover: { lines: ['What I ship', 'between lectures'], hi: 0, scene: 'agents' } },
    { ch: '@example_creator', t: '19:30', title: 'The vanishing chai cup', s: 'posted', views: 1100, hold: 66, cover: { lines: ['The vanishing', 'chai cup'], hi: 1, scene: 'chai' } }] },
  { d: 'Thu', n: 22, today: true, posts: [{ ch: '@northwindstudio', t: '09:00', title: CONTENT.posts[0]?.items[0]?.title ?? 'Agents in class', s: 'posted', views: 4100, hold: 64, cover: { lines: ['Agents', 'in class'], hi: 0, scene: 'agents' } }] },
  { d: 'Fri', n: 23, posts: [
    { ch: '@northwindstudio', t: '18:30', title: 'Price reveal', s: 'scheduled', edit: 'd1', cover: EDITS[2].cover },
    { ch: '@example_creator', t: '19:30', title: 'The coin through the glass', s: 'scheduled', cover: { lines: ['The coin', 'through the glass'], hi: 0, scene: 'coin' } }] },
  { d: 'Sat', n: 24, posts: [{ ch: '@example_creator', t: '12:00', title: 'Silk scarf drape', s: 'review', edit: 'd2', cover: EDITS[0].cover }] },
  { d: 'Sun', n: 25, posts: [] },
];
// the day flags the screens read (real mode sets them from the clock)
WEEK.forEach((w) => { w.iso = `2026-10-${String(w.n).padStart(2, '0')}`; w.past = w.n < 22; w.future = w.n > 22; w.tomorrow = w.n === 23; w.today = w.n === 22; });
export const STREAK = { n: CONTENT.stats.streak ?? 3, best: 11, weekGoal: CONTENT.stats.weekGoal ?? 7, freeze: true };
// today's pack in shooting order, and the channel's goal (demo: g3, the prototype's 5,000-follower goal)
export const PACK = ['R1', 'R4', 'R2', 'R3'];

// ── numbers, per channel. Followers for the last 8 weeks (Mondays); what's working over the last 30 days ──
export const STATS = {
  '@northwindstudio': {
    weeks: ['31 Aug', '7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct', '19 Oct'],
    followers: [1520, 1610, 1705, 1790, 1902, 2041, 2224, 2310],
    reels: 14, views: 41200, hold: 58, follows: 412,
    hook: [['Opens on the screen', 63, 6], ['Bold first line', 54, 4], ['A question', 41, 2], ['Face, then context', 37, 2]],
    format: [['Screen and face', 3400, 6], ['Talking head', 2100, 5], ['Voiceover on B-roll', 1400, 3]],
    topic: [['Coding agents', 3600, 5], ['Building Agentic OS', 2900, 5], ['Shops and pricing', 1000, 2]],
    top: ['Agents in class', 'What I ship between lectures', 'Claude Code on the metro'],
  },
  '@example_creator': {
    weeks: ['31 Aug', '7 Sep', '14 Sep', '21 Sep', '28 Sep', '5 Oct', '12 Oct', '19 Oct'],
    followers: [455, 478, 502, 531, 560, 589, 628, 640],
    reels: 9, views: 11800, hold: 61, follows: 96,
    hook: [['Trick first, explain later', 66, 4], ['Before and after', 52, 3], ['A dare', 44, 2]],
    format: [['One take, close up', 1600, 4], ['Slow-motion reveal', 1300, 3], ['Walk and talk', 700, 2]],
    topic: [['Magic', 1500, 5], ['Kurta hacks', 1100, 3], ['Street food', 600, 1]],
    top: ['The vanishing chai cup'],
  },
};

// ── the learning loop: his verdicts and the numbers, turned into rules that shape the next ideas and scripts ──
export const LEARN = [
  { id: 'l1', on: true, rule: 'Open on the screen, then your face', ch: '@northwindstudio', from: 'Hold 63% against 41% across 6 reels', since: '18 Oct', shapes: 'Scripts', fresh: true },
  { id: 'l2', on: true, rule: 'Keep @northwindstudio under 35 seconds', ch: '@northwindstudio', from: '58% watched under 35 s, 31% over 45 s', since: '12 Oct', shapes: 'Scripts' },
  { id: 'l3', on: true, rule: 'Fewer ideas about pricing', ch: '@northwindstudio', from: 'You killed 4 of the last 5', since: '16 Oct', shapes: 'Ideas' },
  { id: 'l4', on: true, rule: 'Hinglish on @example_creator', ch: '@example_creator', from: 'Your verdicts on 7 scripts', since: '9 Oct', shapes: 'Scripts' },
  { id: 'l5', on: true, rule: 'A comment-keyword CTA only when its DM reply is set up', ch: null, from: 'Your script rules', since: '6 Oct', shapes: 'Scripts' },
];
// proposed by the loop, waiting for his yes
export const PROPOSALS = [
  { id: 'p1', rule: 'Post @northwindstudio at 09:00 instead of 18:30', from: '09:00 reels average 3.6k views, 18:30 ones 2.4k (5 of each)', act: 'Move the slot' },
];
// what he said about recent ideas, newest first (verdicts feed the loop)
export const VERDICTS = [
  { at: 'Wed', title: 'My pricing page, explained in 20 seconds', v: 'kill', why: 'Too salesy' },
  { at: 'Wed', title: 'Coding on the metro, part 2', v: 'keep', why: null },
  { at: 'Tue', title: 'Three Claude settings I changed', v: 'kill', why: 'Done before' },
  { at: 'Mon', title: 'The vanishing chai cup', v: 'keep', why: null },
];

// ── what the agent did in Content today, on its jobs (the night plan, the radar, the editor) ──
export const SHIFT = [
  { at: '02:30', icon: 'radar', text: 'Radar read 46 new videos and filed 3 ideas', go: 'ideas' },
  { at: '04:10', icon: 'layers', text: 'Planned today\'s pack: 4 scripts in 2 setups', go: 'pack', job: 'j9' },
  { at: '09:15', icon: 'hammer', text: 'Found 2 reel ideas in what you built yesterday', go: 'ideas' },
  { at: '11:40', icon: 'film', text: 'Rendered the Silk scarf drape v2 with your notes', go: 'edit:d2' },
];
export const RADAR = { last: '02:30', read: 46, filed: 3, sources: [['YouTube subscriptions', 82], ['Saved reels', 14], ['Your work, every evening', null]] };

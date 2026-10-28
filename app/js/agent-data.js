// The agent's fixed copy (the ladder's rungs, the rules that always ask, prompts per app, voices, tool titles) and the
// prototype's sample day for demo mode (?data=demo), shaped exactly like the PC's GET /api/v1/wyn/home so the screens
// draw one shape. Real mode never reads the sample: agent-state.js fills everything from the PC.
import { AGENT } from './data.js';

// The public name of the agent (DECISIONS 1): everyone's agent is a Wyn; Alex named his Wyn (AGENT.name).
export const PRODUCT = AGENT.product ?? 'Wyn';
export const EVERY = 15;   // minutes between her heartbeats

export const hm = (m) => { m = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
/** "HH:MM" India time of an ISO time. */
export const hmOf = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? new Date(t + 330 * 60000).toISOString().slice(11, 16) : ''; };
/** Minutes after India midnight of an ISO time. */
export const minOf = (iso) => { const t = Date.parse(iso ?? ''); if (!Number.isFinite(t)) return null; const d = new Date(t + 330 * 60000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

// ── the ladder: how far she may climb in each app. 0 off · 1 notification · 2 banner · 3 alarm · 4 call ──
export const RUNGS = [
  { n: 0, id: 'off', label: 'Off', icon: 'x', line: 'She logs it and says nothing.' },
  { n: 1, id: 'note', label: 'Notification', icon: 'inbox', line: 'A line on your lock screen. Time-sensitive only when there\'s a deadline.' },
  { n: 2, id: 'banner', label: 'Banner', icon: 'chat', line: 'She drops in over whatever you\'re doing, with one tap to act.' },
  { n: 3, id: 'alarm', label: 'Alarm', icon: 'clock', line: 'Full screen, with sound, through Silent and Focus. One snooze, then she argues.' },
  { n: 4, id: 'call', label: 'Call', icon: 'phone', line: 'She rings you, says why, and does it with you.' },
];
// what can never run without him, whatever a tool is set to (wyn-policy.ts enforces it, outside the model)
export const ALWAYS_ASKS = [
  ['coin', 'Spend or move money'],
  ['people', 'Reach someone new'],
  ['trash', 'Delete anything'],
  ['lock', 'Anything that can\'t be undone'],
  ['chat', 'Send as you, unless you allowed that person and that kind of message'],
];
export const AUTONOMY = [
  ['off', 'Off', 'She never uses this app'],
  ['ask', 'Asks first', 'Every action here waits for your yes'],
  ['normal', 'Her judgment', 'Low-stakes things on her own, the rest asks'],
  ['trusted', 'Trusted', 'Everything that isn\'t risky runs on her own'],
];

// ── the chips over the composer, per app, and what she opens with there (no facts: those come from the app itself) ──
export const PROMPTS = {
  default: ['What did you do today?', 'Plan my evening', 'What\'s waiting on me?', 'I\'m sitting with family', 'Call me'],
  body: ['Log what I just ate', 'Plan tomorrow\'s workout', 'How\'s my recovery?', 'What should I eat tonight?'],
  mind: ['I read for 30 minutes', 'What did I do on my phone today?', 'Find me a course', 'Plan tonight\'s reading'],
  soul: ['I have an urge right now', 'How are my habits today?', 'Block Instagram for an hour', 'Why do I slip in the evening?'],
  mission: ['Am I on pace this week?', 'What moves my main goal today?', 'Break my goal down', 'Write my purpose with me'],
  money: ['Spent ₹450 on lunch', 'Here\'s today\'s bank statement', 'Can I afford this?', 'Where did this month go?'],
  growth: ['Journal two lines with me', 'Review my week', 'What did you connect last night?', 'Plan tomorrow'],
  family: ['I\'m sitting with family', 'When did I last call home?', 'Ideas for the next occasion', 'Plan a Sunday together'],
  romance: ['One small step this week', 'Journal about it with me', 'What do I want in a partner?'],
  friends: ['Who haven\'t I seen in a while?', 'Draft a plan with a friend', 'Met someone new today', 'Remind me to call someone'],
  content: ['What should I shoot tomorrow?', 'Ideas from this week\'s work', 'Rewrite a hook', 'How are my posts doing?'],
  tasks: ['Add a task', 'Move my evening around', 'What\'s overdue?', 'Plan tomorrow'],
  work: ['What are my agents doing?', 'Anything waiting on me in Work?', 'Start a job for this', 'Summarise today\'s commits'],
};
export const OPEN_LINE = (app, name) => ({
  body: 'Tell me what you ate or lifted and I\'ll log it, or ask about your recovery.',
  mind: 'Reading, courses, screen time: tell me and I\'ll file it.',
  soul: 'Habits, urges, blocks. I\'m here for any of it.',
  mission: 'Goals and pace. Ask me where you stand.',
  money: 'Tell me what you spent or send a statement; I\'ll keep Money right.',
  growth: 'Your journal, your week, last night\'s dream. Where do you want to start?',
  family: 'Tell me what happened with family and I\'ll keep it.',
  romance: 'Whatever you want to think through. It stays here.',
  friends: 'Who did you see? I\'ll keep track of people for you.',
  content: 'Ideas, scripts, the shoot pack. What are we making?',
  tasks: 'Tasks and the calendar: tell me what to add or move.',
  work: 'Jobs and sessions on your PC. Ask what they\'re up to.',
}[app] ?? `Ask me anything about ${app}, ${name}.`);

// ── her voice on calls ──
// The free path speaks with the phone's own voice (the best installed en-IN voice, female first); the realtime path
// (only with a funded OpenAI key) uses these.
export const VOICES = [
  { id: 'marin', name: 'Marin', line: 'Warm and clear' },
  { id: 'coral', name: 'Coral', line: 'Bright, a little quick' },
  { id: 'sage', name: 'Sage', line: 'Soft, unhurried' },
  { id: 'shimmer', name: 'Shimmer', line: 'Light and friendly' },
  { id: 'cedar', name: 'Cedar', line: 'Low and calm (male)' },
];
// how she talks: three sliders become one line in her tone pref, which she reads before every reply
export const TALK = {
  length: ['Short. One or two sentences.', 'Short by default, longer when it helps.', 'Detailed when there\'s something to explain.'],
  humour: ['Plain and direct.', 'Warm, a little dry.', 'Playful; teases lightly.'],
  push: ['Gentle: says it once, then lets it go.', 'Firm: says it plainly, and follows up once.', 'Relentless: keeps at it until it\'s done.'],
};
export const toneOf = (P) => [TALK.length[P.length < 0.34 ? 0 : P.length < 0.67 ? 1 : 2], TALK.humour[P.humour < 0.34 ? 0 : P.humour < 0.67 ? 1 : 2], TALK.push[P.push < 0.34 ? 0 : P.push < 0.67 ? 1 : 2],
  P.hinglish ? 'Mixes in Hindi when he does.' : 'English only.'].join(' ');
// a line in each style, for the sample under the sliders (an illustration, not data)
export const SAMPLE = {
  short: { plain: ['Your evening is open. Want me to plan it?', 'Your evening is open. I\'ll plan it unless you say no.', 'Your evening is open. Planning it now.'],
    dry: ['Your evening is suspiciously free. Plan it?', 'Your evening is free. Not for long: I\'m planning it.', 'Free evening. Was. I\'ve planned it.'],
    playful: ['Free evening! Want a plan?', 'Free evening! Plan coming up.', 'Free evening, and I already have ideas. Let\'s go.'] },
  long: { plain: ['Your evening is open after the gym. If you like, I can put the quote first and keep reading for later.', 'Your evening is open after the gym. I\'ll put the quote first and reading after; say if you want it different.', 'Your evening is open after the gym: quote first, reading after. I\'ll check at 21:30 that both happened.'],
    dry: ['The evening is open after the gym, which never lasts. The quote could go first, if you\'re in the mood.', 'The evening is open after the gym. Quote first, reading after; I\'ll look in at 21:30.', 'Open evening after the gym, and we both know how those go. Quote first, reading after, and I will check.'],
    playful: ['Look at that, a free evening after the gym! Quote first, then reading? Only if you want.', 'Free evening after the gym! Quote first, reading after. I\'ll check in at 21:30.', 'Free evening after the gym, and it\'s mine now: quote, then reading, then I check. Deal?'] },
};
export const sample = (P) => SAMPLE[P.length < 0.5 ? 'short' : 'long'][P.humour < 0.34 ? 'plain' : P.humour < 0.67 ? 'dry' : 'playful'][P.push < 0.34 ? 0 : P.push < 0.67 ? 1 : 2];

// tool names → what the tools page and the thread call them
const TITLES = { add_task: 'Add a task', update_task: 'Update a task', drop_task: 'Drop a task', find_tasks: 'Find tasks', overview: 'Read your day', goals: 'Read your goals',
  add_goal: 'Add a goal', update_goal: 'Change a goal', set_sleep: 'Move your sleep', remember: 'Remember', forget: 'Forget', recall: 'Recall', journal: 'Write the journal',
  schedule: 'Schedule a call or message', give_to_claude: 'Hand work to Claude', session_new: 'Start a coding session', session_send: 'Prompt a session',
  calendar_add: 'Add to your calendar', calendar_move: 'Move an event', calendar_cancel: 'Cancel an event', add_idea: 'Save an idea', update_idea: 'Grow an idea',
  send_whatsapp: 'WhatsApp you', set_preferences: 'Change how she works', update_soul: 'Change her soul', brain_capture: 'Save to your brain' };
export const toolTitle = (n, fallback) => TITLES[n] ?? fallback ?? String(n).replace(/^[a-z]+_/, (p) => (/^(body|mind|soul|mission|money|growth|people|scan|brain|content)_$/.test(p) ? '' : p))
  .replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

// ── demo mode: the prototype's day, in the PC's shapes ─────────────────────────────────────────────────────────────
const T0 = Date.UTC(2026, 9, 22, 0, 0) - 330 * 60000;   // Thu 22 Oct 2026, 00:00 in Delhi
const at = (h, m = 0) => new Date(T0 + (h * 60 + m) * 60000).toISOString();
const item = (id, h, m, kind, app, title, text, x = {}) => ({ id, at: at(h, m), time: hm(h * 60 + m), day: '2026-10-22', kind, app, title, text, source: 'heartbeat', status: kind === 'ask' || kind === 'nudge' || kind === 'alarm' ? 'open' : 'done', urgency: 50, undo: kind === 'did', undone: false, ask: null, ladder: null, ...x });
export function demoHome() {
  const items = [
    item('d9', 16, 5, 'did', 'money', 'Logged ₹1,240 from 3 UPI messages', 'Chai ₹40, Uber ₹210, printouts ₹90 and a ₹900 shirt. ₹260 left in today\'s budget.'),
    item('d8', 15, 15, 'did', 'tasks', '7 of 12 kurta listings are live', 'You uploaded them in the shop block. I kept the task open for the other 5.', { undo: false }),
    item('d7', 14, 2, 'did', 'mission', 'Told j13 to anchor at ₹40,000', 'You answered in chat. I also moved "Shoot: 1 reel (R1)" to 18:45.', { source: 'chat' }),
    item('d6', 13, 45, 'did', 'mind', 'Ticked Algebra tutorial sheet 3', 'You scanned the finished sheet at 13:40.'),
    item('d5', 9, 15, 'did', 'content', 'Two reel ideas from your work', '"My phone runs five coding agents while I sit in class" and "What a ₹15k website gets a local shop".', { undo: false }),
    item('d4', 8, 0, 'call', 'growth', 'Morning call, 4 min', 'Planned the day around GE I and picked the reel slot.', { undo: false }),
    item('d3', 7, 45, 'did', 'body', 'Logged Push day, 1h 12m', 'Bench 50 kg × 5 for 3 sets: one set more than last Thursday.'),
    item('n1', 17, 20, 'nudge', 'body', 'Protein 62 of 120 g', 'Paneer at dinner covers about 30 g. A shake after cardio covers the rest.', { ladder: { rung: 1, ceiling: 2, seen: true } }),
    item('a1', 17, 38, 'ask', 'soul', 'Block Instagram till cardio?', 'It pulls you in between 18:00 and 19:00 most days: 52 min yesterday. I can lock it until 19:00.', { ask: { yes: 'Block till 19:00', no: 'Not today' } }),
    item('a4', 17, 2, 'ask', 'content', 'Approve the Silk scarf drape edit?', 'v2 has captions burnt in and music at −18 dB. Approving schedules it for Sat 12:00 on @example_creator.', { ask: { yes: 'Approve', no: 'Send back' } }),
    item('a3', 16, 50, 'ask', 'family', 'Anniversary dinner on Sunday?', 'Two places have a table for four at 20:00: the mall, about ₹4,500, and Westside, about ₹3,200.', { ask: { yes: 'Hold the mall', no: 'Show me both' } }),
    item('al1', 21, 45, 'alarm', 'growth', 'Save your 6-day journal streak', 'Two lines before midnight. If you write before 21:45, none of this happens.', { ladder: { rung: 0, ceiling: 4, alarmAt: at(22, 15), next: at(21, 45) }, meta: { streak: { n: 6 } } }),
  ];
  const quiet = new Set([6 * 60 + 15, 6 * 60 + 30, 6 * 60 + 45, 7 * 60, 7 * 60 + 15, 7 * 60 + 30, 10 * 60 + 30, 10 * 60 + 45, 11 * 60, 11 * 60 + 15, 12 * 60 + 30, 12 * 60 + 45, 13 * 60, 13 * 60 + 15, 15 * 60 + 30, 16 * 60 + 30, 16 * 60 + 45, 17 * 60]);
  const beats = [];
  for (let m = 6 * 60; m <= 17 * 60 + 30; m += 15) {
    const found = items.filter((x) => Math.floor((Date.parse(x.at) - T0) / 60000 / 15) * 15 === m);
    const kind = found.some((x) => x.kind === 'ask') ? 'ask' : found.some((x) => x.kind === 'nudge') ? 'nudge' : found.length ? 'did' : 'ok';
    beats.push({ id: `hb${m}`, at: at(0, m), time: hm(m), kind, checked: 8, secs: kind === 'ok' ? 0.2 : 4, model: kind === 'ok' ? 'rules only' : 'haiku', note: kind === 'ok' ? (quiet.has(m) ? (m < 8 * 60 ? 'You were at the gym' : m < 14 * 60 ? 'In class' : 'Deep work') : 'All on track') : found.map((x) => x.title).join('; '), found: found.length });
  }
  const calls = [
    { id: 'c1', direction: 'incoming', reason: 'Morning call', status: 'ended', started_at: at(8), seconds: 240, cost_usd: 0, summary: 'Planned the day around GE I; picked the reel shoot slot.' },
    { id: 'c2', direction: 'outgoing', reason: 'You called', status: 'ended', started_at: at(-24 + 21), seconds: 420, cost_usd: 0, summary: 'Talked through Atlas ERP pricing; she filed a job.' },
    { id: 'c3', direction: 'incoming', reason: 'Night call', status: 'ended', started_at: at(-48 + 22, 30), seconds: 180, cost_usd: 0, summary: 'Shut down the day; 3 tasks moved to tomorrow.' },
  ];
  return {
    name: AGENT.name || 'Wyn', product: PRODUCT, day: '2026-10-22', now: at(17, 40), awake: true, inCall: false, busy: null,
    heartbeat: { on: true, every: EVERY, last: { at: at(17, 30), time: '17:30', kind: 'ask', note: 'Asked about Instagram' }, next: at(17, 45), today: beats.length, quiet: beats.filter((b) => b.kind === 'ok').length, model: 'haiku' },
    beats, items: items.filter((x) => x.kind !== 'alarm'), older: [], asks: items.filter((x) => x.kind === 'ask'),
    alarms: items.filter((x) => x.kind === 'alarm'),
    mood: { stress: 0.48, energy: 0.55, valence: 0.1, label: 'Busy', line: 'Busy: the quote is a day late, 3 h booked in the 5 h left before bed.', overloaded: false, reasons: [{ key: 'load', text: '3 h booked in the 5 h left before bed', stress: 0.12 }, { key: 'overdue', text: 'The Harborline quote is a day late', stress: 0.06 }] },
    ladder: { ceilings: { growth: 4, body: 2, soul: 3, mind: 2, mission: 2, money: 1, family: 1, romance: 1, friends: 1, tasks: 3, work: 2, content: 2 }, step: 15, quiet: { sleep: true, class: true } },
    tools: { total: 64, auto: 51, ask: 13, apps: 10 },
    memory: { long: 212, short: 3, learned: [{ id: 'L1', text: 'Instagram pulls you in between 18:00 and 19:00 most days', kind: 'habit', importance: 3 }, { id: 'L2', text: 'Bench went up a set: 50 kg × 5 for 3', kind: 'health', importance: 2 }, { id: 'L3', text: 'Saturdays with Kabir are usually Haldiram\'s', kind: 'person', importance: 2 }],
      now: [{ id: 'S1', text: 'In deep work on Agentic OS till 18:30', kind: 'now' }, { id: 'S2', text: 'Waiting on Harborline\'s first-year payment', kind: 'followup' }] },
    calls: { morning: '08:00', night: '22:30', recent: calls, voice: { free: true, realtime: false } },
    breaths: { sessions: [], minutes: 0, today: 0 },
    prefs: { name: AGENT.name || 'Wyn', tone: 'Warm and direct, like a close friend who knows the plan.', voice: 'marin', proactive_level: 'normal', morning_call: '08:00', night_call: '22:30', snooze: '15', heartbeat: 'on' },
    watching: [
      { app: 'body', line: 'Protein 62 of 120 g' }, { app: 'soul', line: 'Instagram after 18:00' }, { app: 'growth', line: 'Journal streak: 6 days' },
      { app: 'money', line: 'Harborline quote 1 day late' }, { app: 'content', line: 'Reel R1 shoots 18:45' }, { app: 'friends', line: 'Kabir: 12 days' },
    ],
  };
}
export function demoThread() {
  const m = (id, role, text, h, mm, meta = null) => ({ id, role, text, at: at(h, mm), ...(meta ? { meta } : {}) });
  return [
    m(1, 'wyn', 'Morning. GE I at 10:30, the shop block at 15:00, deep work from 16:30.', 7, 50),
    m(2, 'call', 'Planned the day around GE I; picked the reel shoot slot.', 8, 4, { callId: 'c1', seconds: 240, actions: ['Reel shoot at 18:45', 'Send the Harborline quote before 17:00'] }),
    m(3, 'wyn', 'Afternoon. Two jobs need you: j12 wants to run its tests, j13 is asking which price to anchor.', 14, 0),
    m(4, 'user', 'Anchor at 40k. And move the reel shoot to 18:45.', 14, 1),
    m(5, 'wyn', 'Told j13: anchor at ₹40,000. The reel is at 18:45 now.', 14, 2, { changes: [{ id: 1, label: 'Moved “Shoot: 1 reel (R1)” to 18:45', undone: false }] }),
    m(6, 'wyn', 'Logged ₹1,240 from 3 UPI messages. ₹260 left today.', 16, 5, { did: [{ id: 'd9', kind: 'did', app: 'money', title: 'Logged ₹1,240 from 3 UPI messages', undo: true, undone: false }] }),
    m(7, 'wyn', 'Protein is at 62 of 120 g. Paneer at dinner and a shake after cardio close it.', 17, 20),
  ];
}

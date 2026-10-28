// The Brain's demo knowledge (?data=demo only): the prototype's folders, notes, inbox, person files and the Life map's
// "what feeds what", unchanged from the approved prototype. Real mode never reads this (brain-data.js is the live layer).
// "Now" is Thu 22 Oct 2026, 17:40. Only the four people in data.js exist; unknown facts stay "Add date", never invented.
import { ASPECTS, PEOPLE, GOALS, PROJECTS, TASKS, AREAS } from './data.js';

// ── folders: one per aspect, plus People. count = notes in the folder (only some are spelled out below) ──
export const FOLDERS = {
  body: { count: 24, updated: '17:38', by: 'wyn', subs: [['Fuel', 9], ['Training', 11], ['Looks', 4]] },
  mind: { count: 31, updated: '12:40', by: 'wyn', subs: [['City College', 14], ['Library', 12], ['Screen time', 5]] },
  soul: { count: 9, updated: 'Wed', by: 'wyn', subs: [['Habits', 6], ['Private', 3]] },
  mission: { count: 42, updated: '09:10', by: 'wyn', subs: [['Northwind', 16], ['Projects', 19], ['Purpose', 7]] },
  money: { count: 37, updated: '16:05', by: 'wyn', subs: [['Statements', 4], ['Receipts', 11], ['Corner Market', 6]] },
  growth: { count: 28, updated: '03:00', by: 'wyn', subs: [['Journal', 21], ['Dreams', 7]] },
  family: { count: 18, updated: '15:00', by: 'wyn', subs: [['Moments', 12], ['Plans', 6]] },
  romance: { count: 3, updated: 'Sun', by: 'you', private: true, subs: [] },
  friends: { count: 12, updated: '15:00', by: 'wyn', subs: [['Moments', 8], ['Plans', 4]] },
};
export const NOTE_TOTAL = Object.values(FOLDERS).reduce((a, f) => a + f.count, 0) + PEOPLE.length;

// ── notes. by: who filed it (wyn | you) · via: where it came from · day: today | yesterday | a short date ──
// where: a place, so "what did I save at the shop?" works. links: what it ties to elsewhere in the app.
export const NOTES = [
  // Body
  { id: 'b1', folder: 'body', sub: 'Fuel', kind: 'log', title: 'Protein 62 of 120 g', by: 'wyn', via: 'heartbeat', day: 'today', at: '17:38', where: 'Midtown',
    text: 'Eggs at breakfast 18 g, rajma at lunch 16 g, a whey shake 24 g, chai 4 g. Paneer at dinner covers about 30 g; a shake after cardio covers the rest.', links: { goal: 'g6', task: 't24' } },
  { id: 'b2', folder: 'body', sub: 'Training', kind: 'log', title: 'Push day · bench 50 kg × 5', by: 'you', via: 'workout', day: 'today', at: '07:40', where: 'Gym, Midtown',
    text: 'Bench 50 kg for 5, 5 and 4. Incline dumbbells 16 kg for 10. Ten kilos to go to the 60 kg goal.', links: { goal: 'g6' } },
  { id: 'b3', folder: 'body', sub: 'Training', kind: 'log', title: 'Slept 6 h 40 m', by: 'wyn', via: 'health', day: 'today', at: '06:05', where: 'Midtown',
    text: 'In bed at 23:20, up at 06:00, two wake-ups. Third night short of your 7 hours.' },
  { id: 'b4', folder: 'body', sub: 'Looks', kind: 'scan', title: 'Face scan · front', by: 'you', via: 'scan', day: 'Thu 8 Oct', at: '08:10', where: 'Midtown',
    text: 'Good light, neutral face. The next scan is due this week so the two can be compared.' },
  // Mind
  { id: 'm1', folder: 'mind', sub: 'City College', kind: 'note', title: 'P&S: sheet 4 due next Thursday', by: 'wyn', via: 'class', day: 'today', at: '12:40', where: 'City College, Room 14',
    text: 'Said at the end of the tutorial: problems 1 to 12 from sheet 4, due Thursday 29 October.' },
  { id: 'm2', folder: 'mind', sub: 'City College', kind: 'doc', title: 'GE I internal assessment', by: 'you', via: 'scan', day: 'Mon 19 Oct', at: '11:35', where: 'City College, Block B',
    text: 'Test 1 on 30 October. The assignment is due on 6 November.' },
  { id: 'm3', folder: 'mind', sub: 'Library', kind: 'highlight', title: 'Atomic Habits · page 118', by: 'you', via: 'scan', day: 'Tue 20 Oct', at: '22:05', where: 'Midtown',
    text: 'Habits stick when they are part of who you are. The aim is to become a reader, not to finish a book.', links: { goal: 'g7', task: 't21' } },
  { id: 'm4', folder: 'mind', sub: 'Screen time', kind: 'log', title: 'Instagram, 52 min yesterday', by: 'wyn', via: 'screen time', day: 'yesterday', at: '23:00', where: 'Midtown',
    text: 'Mostly reels between 18:00 and 19:00. You said about half of it was research for the shoot.' },
  // Soul
  { id: 's1', folder: 'soul', sub: 'Habits', kind: 'note', title: 'The evening window', by: 'wyn', via: 'noticed', day: 'Wed 21 Oct', at: '21:30', where: 'Midtown',
    text: 'The pull is strongest between 18:00 and 19:00, just before cardio. Blocking until 19:00 held on both days you tried it.' },
  // Mission
  { id: 'w1', folder: 'mission', sub: 'Northwind', kind: 'voice', title: 'Atlas ERP onboarding call', by: 'you', via: 'voice', day: 'yesterday', at: '11:20', where: 'City College',
    text: 'They want counter billing first, then stock. Reply to their notes today.', links: { task: 't12', project: 'atlas' } },
  { id: 'w2', folder: 'mission', sub: 'Northwind', kind: 'note', title: 'Harborline OS: Basic or Advanced', by: 'you', via: 'typed', day: 'Tue 20 Oct', at: '19:40', where: 'Midtown',
    text: 'Basic covers the storefront. Advanced adds the WhatsApp flows. Pick the first-year price and send both.', links: { task: 't3', goal: 'g1' } },
  { id: 'w3', folder: 'mission', sub: 'Purpose', kind: 'note', title: 'Purpose, Wyn\'s second draft', by: 'wyn', via: 'drafted', day: 'Sun 18 Oct', at: '10:00', where: 'Midtown', pinned: true,
    text: 'A draft for you to rewrite: build tools that let one person run what used to need a team, starting with Dad\'s shop.' },
  { id: 'w4', folder: 'mission', sub: 'Projects', kind: 'doc', title: 'Reel R1: five agents in class', by: 'wyn', via: 'Content OS', day: 'today', at: '09:10', where: 'City College',
    text: 'Hook: my phone runs five coding agents while I sit in class. 30 seconds, desk and window light.', links: { task: 't5', goal: 'g3' } },
  // Money
  { id: 'n1', folder: 'money', sub: 'Receipts', kind: 'log', title: '3 UPI messages · ₹1,240', by: 'wyn', via: 'UPI messages', day: 'today', at: '16:05', where: 'Midtown',
    text: 'Chai ₹40, Uber ₹210, printouts ₹90 and a ₹900 shirt. ₹260 left in today\'s budget.' },
  { id: 'n2', folder: 'money', sub: null, kind: 'note', title: 'Budget rules', by: 'you', via: 'typed', day: 'Thu 1 Oct', at: '21:00', where: 'Midtown', pinned: true,
    text: '₹1,500 a day. Food and chai under ₹500. Anything over ₹2,000 waits a night.' },
  { id: 'n3', folder: 'money', sub: null, kind: 'note', title: 'Subscriptions to decide', by: 'wyn', via: 'noticed', day: 'Mon 19 Oct', at: '09:00', where: 'Midtown', pinned: true,
    text: 'Codex Pro: decide on last cycle\'s use. Cursor: cancel before the next charge.', links: { task: 't1' } },
  { id: 'n4', folder: 'money', sub: 'Corner Market', kind: 'doc', title: 'Corner Market payouts, October', by: 'wyn', via: 'statement', day: 'Wed 21 Oct', at: '18:20', where: 'Morgan & Co.',
    text: 'Four payouts so far this month. The next one lands on Monday.' },
  // Growth
  { id: 'g1n', folder: 'growth', sub: 'Journal', kind: 'journal', title: 'Journal · Wed 21 Oct', by: 'you', via: 'typed', day: 'yesterday', at: '22:10', where: 'Midtown',
    text: 'Good shop day. Slept late again; I want that fixed before the exams.' },
  { id: 'g2n', folder: 'growth', sub: 'Dreams', kind: 'note', title: 'What slipped this week', by: 'wyn', via: 'overnight', day: 'today', at: '03:00', where: 'Midtown',
    text: 'Two client follow-ups slipped while Agentic OS took the evenings. Friends got no time for the second week running.' },
  // Family
  { id: 'f1', folder: 'family', sub: 'Moments', kind: 'moment', title: 'Listings at the shop with Dad', by: 'wyn', via: 'calendar', day: 'today', at: '15:00', where: 'Morgan & Co.',
    text: 'Corner Market listings at the shop, 15:00 to 16:15.', links: { person: 'dad' } },
  { id: 'f2', folder: 'family', sub: 'Moments', kind: 'moment', title: 'Breakfast with Mom', by: 'wyn', via: 'you said', day: 'today', at: '08:30', where: 'Midtown',
    text: 'You mentioned breakfast with Mom before college.', links: { person: 'mom' } },
  { id: 'f3', folder: 'family', sub: 'Plans', kind: 'note', title: 'Their 25th anniversary', by: 'you', via: 'typed', day: 'Sun 18 Oct', at: '20:15', where: 'Midtown', pinned: true,
    text: 'Host it myself, paid by me. Book a table by Sunday. The date still needs adding.', links: { goal: 'g10', task: 't23', person: 'mom' } },
  // Friends
  { id: 'r1', folder: 'friends', sub: 'Moments', kind: 'fact', title: 'Kabir eats out on Saturdays', by: 'wyn', via: 'noticed', day: 'today', at: '15:00', where: 'Midtown',
    text: 'Your last four meetups were Saturday evenings. It has been 12 days.', links: { person: 'kabir', task: 't22', goal: 'g9' } },
  { id: 'r2', folder: 'friends', sub: 'Moments', kind: 'moment', title: 'Rohan on WhatsApp', by: 'wyn', via: 'chat', day: 'today', at: '13:10', where: 'City College',
    text: 'He asked how the app is going. Nothing to follow up.', links: { person: 'rohan' } },
];
export const note = (id) => NOTES.find((n) => n.id === id);

// what Wyn filed today, newest first (the Brain's activity and the Life tab's Brain row read this)
export const filedToday = () => NOTES.filter((n) => n.day === 'today' && n.by === 'wyn').sort((a, b) => b.at.localeCompare(a.at));
export const savedToday = () => NOTES.filter((n) => n.day === 'today').sort((a, b) => b.at.localeCompare(a.at));

// ── the inbox: captured or shared, not yet filed. Wyn's suggestion says where each would go ──
export const INBOX = [
  { id: 'i1', kind: 'reel', from: 'Instagram', at: '16:52', title: 'Silk scarf drape in 30 seconds', meta: 'Reel · 0:28',
    why: 'A drape tutorial: an idea for @example_creator, and styling notes for Corner Market.', to: [['content', 'Content ideas'], ['money', 'Corner Market']],
    content: { url: 'instagram.com/reel/drape30', platform: 'Instagram', title: 'Silk scarf drape in 30 seconds', why: 'Styling hook for @example_creator; the fold could sell the Silk listings' } },
  { id: 'i2', kind: 'voice', from: 'Voice note', at: '17:05', title: '“Dad wants the Diwali stock list by Sunday…”', meta: 'Voice · 0:42',
    why: 'About Dad and the shop, with something due on Sunday.', to: [['family', 'People › Dad'], ['task', 'Task · Sun 25']] },
  { id: 'i3', kind: 'shot', from: 'GPay', at: '17:31', title: 'Paid ₹1,200 · City Electricals', meta: 'Screenshot',
    why: 'New lights for the shop: a shop expense, not your own.', to: [['money', 'Money › Morgan & Co.']] },
];

// ── person files: what the Brain holds about each person beyond data.js. null = unknown, shown as "Add" ──
export const PERSON_FILE = {
  dad: { facts: [['Relation', 'Father'], ['Runs', 'Morgan & Co., Midtown'], ['Birthday', null], ['Anniversary', null]],
    tasks: ['t14', 't15', 't23'], goals: ['g10'] },
  mom: { facts: [['Relation', 'Mother'], ['Birthday', null], ['Anniversary', null]], tasks: ['t23'], goals: ['g10'] },
  kabir: { facts: [['Known since', 'Childhood'], ['Rhythm you want', 'Every week'], ['Usually', 'Eats out on Saturdays']], tasks: ['t22'], goals: ['g9'] },
  rohan: { facts: [['Known from', 'school'], ['Talk on', 'WhatsApp'], ['Birthday', null]], tasks: [], goals: ['g9'] },
};
export const notesAbout = (pid) => NOTES.filter((n) => n.links?.person === pid);

// ── what feeds what: the Life map. Each thing feeds one aspect or several; one thing can sit in two places ──
// kind: area | project | goal | person. feeds: aspect ids, the first is its home.
export const FEEDS = [
  { id: 'a-college', kind: 'area', ref: 'college', name: 'City College', sub: 'College', feeds: ['mind', 'growth'] },
  { id: 'g7', kind: 'goal', ref: 'g7', name: '12 books in 2026', sub: '7 of 12', feeds: ['mind'] },
  { id: 'g6', kind: 'goal', ref: 'g6', name: 'Bench 60 kg', sub: '50 of 60 kg', feeds: ['body'] },
  { id: 'g8', kind: 'goal', ref: 'g8', name: 'Day 9 of 30', sub: 'Private', feeds: ['soul'] },
  { id: 'a-northwind', kind: 'area', ref: 'northwind', name: 'Northwind', sub: 'Your company', feeds: ['mission', 'money'] },
  { id: 'p-agentic', kind: 'project', ref: 'agentic-os', name: 'Agentic OS', sub: 'Project', feeds: ['mission', 'growth'] },
  { id: 'p-content', kind: 'project', ref: 'content-os', name: 'Content OS', sub: 'Project', feeds: ['mission', 'growth'] },
  { id: 'g3', kind: 'goal', ref: 'g3', name: '5,000 followers', sub: '46%, behind pace', feeds: ['mission', 'growth'] },
  { id: 'a-wonder', kind: 'area', ref: 'corner-market', name: 'Corner Market', sub: 'The online store', feeds: ['money', 'mission'] },
  { id: 'p-atlas', kind: 'project', ref: 'atlas', name: 'Atlas ERP', sub: 'Client project', feeds: ['money', 'mission'] },
  { id: 'g4', kind: 'goal', ref: 'g4', name: '₹2 lakh a month', sub: 'This quarter', feeds: ['money', 'mission'] },
  { id: 'a-kurta', kind: 'area', ref: 'morgan-co', name: 'Morgan & Co.', sub: 'Dad\'s shop', feeds: ['money', 'family'] },
  { id: 'dad', kind: 'person', ref: 'dad', name: 'Dad', sub: 'Family', feeds: ['family', 'money'] },
  { id: 'mom', kind: 'person', ref: 'mom', name: 'Mom', sub: 'Family', feeds: ['family'] },
  { id: 'g10', kind: 'goal', ref: 'g10', name: 'Their 25th anniversary', sub: 'Paid by you', feeds: ['family', 'money'] },
  { id: 'kabir', kind: 'person', ref: 'kabir', name: 'Kabir', sub: '12 days ago', feeds: ['friends'] },
  { id: 'rohan', kind: 'person', ref: 'rohan', name: 'Rohan', sub: 'Today', feeds: ['friends'] },
  { id: 'g9', kind: 'goal', ref: 'g9', name: 'A friend every week', sub: '1 of 4 weeks', feeds: ['friends'] },
];
export const feedsOf = (aid) => FEEDS.filter((f) => f.feeds.includes(aid));
export const shared = () => FEEDS.filter((f) => f.feeds.length > 1);

// ── the graph: every folder, person, goal and the notes that tie them. Positions are a settled layout in a 360×440 box ──
export function graphData() {
  const nodes = [{ id: 'hub', kind: 'hub', label: 'Brain', aspect: null }];
  const links = [];
  for (const a of ASPECTS) { nodes.push({ id: `f:${a.id}`, kind: 'folder', label: a.name, aspect: a.id }); links.push(['hub', `f:${a.id}`]); }
  for (const p of PEOPLE) { nodes.push({ id: `p:${p.id}`, kind: 'person', label: p.name, aspect: p.aspect }); links.push([`f:${p.aspect}`, `p:${p.id}`]); }
  for (const g of GOALS.filter((x) => ['g1', 'g3', 'g4', 'g6', 'g7', 'g9', 'g10'].includes(x.id))) {
    nodes.push({ id: `g:${g.id}`, kind: 'goal', label: FEEDS.find((f) => f.id === g.id)?.name ?? g.title, aspect: g.aspects[0] });
    for (const a of g.aspects) links.push([`f:${a}`, `g:${g.id}`]);
  }
  for (const n of NOTES) {
    nodes.push({ id: `n:${n.id}`, kind: 'note', label: n.title, aspect: n.folder, note: n.id });
    links.push([`f:${n.folder}`, `n:${n.id}`]);
    if (n.links?.person) links.push([`n:${n.id}`, `p:${n.links.person}`]);
    if (n.links?.goal && nodes.some((x) => x.id === `g:${n.links.goal}`)) links.push([`n:${n.id}`, `g:${n.links.goal}`]);
  }
  return { nodes, links };
}

// small lookups other files use
export const taskTitle = (id) => TASKS.find((t) => t.id === id);
export const goalOf = (id) => GOALS.find((g) => g.id === id);
export const projectOf = (slug) => PROJECTS.find((p) => p.slug === slug);
export const areaOf = (slug) => AREAS[slug];

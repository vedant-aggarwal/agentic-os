// People: the approved prototype's sample, in the people store's shape. Demo mode only (?data=demo, the clock pinned to
// Thu 22 Oct 2026 17:40). Real mode never reads this. Owner: the PEOPLE agent.
// The four people are fictional; their moments, plans and notes here are the prototype's illustrations.
const P = (id, name, rel, aspect, role, extra = {}) => ({ id, name, rel, aspect, role, file: `people/${aspect}/${id}`, ...extra });
const M = (id, date, at, people, aspect, f) => ({ id, date, at, people, aspect, kind: 'meet', minutes: 0, ...f });

export function demoDocs() {
  return {
    persons: [
      P('dad', 'Dad', 'family', 'family', 'Father · runs Morgan & Co.', { short: 'Father · the shop', pronoun: 'he', sort: 1, aliases: ['dad', 'father'],
        remember: [
          { text: 'The festive rush at the shop runs till Diwali, Sun 8 Nov', from: 'From Wednesday evening' },
          { text: 'Wants the Silk stock online before the rush', from: 'From today, at the shop' },
          { text: 'Uses the shop\'s online store you run, Corner Market', from: 'In his Brain file' },
        ] }),
      P('mom', 'Mom', 'family', 'family', 'Mother', { short: 'Mother', pronoun: 'she', sort: 2, aliases: ['mom', 'mother'],
        remember: [
          { text: 'Wants the house painted before Diwali', from: 'From Wednesday evening' },
          { text: 'Checks you\'ll be home for dinner when you\'re out', from: 'From a chat on Wednesday' },
          { text: 'Asked when your exams start', from: 'From this morning' },
        ] }),
      P('kabir', 'Kabir', 'friend', 'friends', 'Childhood friend · the weekly food buddy', { since: 'Since childhood', pronoun: 'he', sort: 3,
        habit: 'You two usually eat out on Saturdays', ideas: ['gym', 'drive', 'film'],
        remember: [
          { text: 'Childhood friend', from: 'Your file' },
          { text: 'Your weekly food buddy, usually on Saturdays', from: 'From your moments' },
          { text: 'You want more than food together: the gym, a drive, a film', from: 'You told Wyn' },
        ],
        ask: [{ k: 'now', label: 'What he’s up to these days', opener: 'Aur bata, aajkal kya chal raha hai? College, kaam, sab?' }] }),
      P('rohan', 'Rohan', 'friend', 'friends', 'Friend from school', { since: 'Since school', pronoun: 'he', sort: 4, ideas: ['chai', 'film'],
        note: 'School was what you two shared. Ask what he’s into now, and find the next thing.',
        remember: [
          { text: 'Friend from school', from: 'Your file' },
          { text: 'You mostly talk on WhatsApp now', from: 'From your moments' },
          { text: 'He asked when you’re meeting', from: 'Today’s chat' },
        ],
        ask: [{ k: 'college', label: 'Where he’s studying now', opener: 'Btw tu abhi kaunse college mein hai? Kaisa lag raha?' }] }),
    ],
    rhythms: [
      { id: 'rh-dad-dinner', person: 'dad', title: 'Dinner together', label: 'Most nights', every: 2, mode: 'meet', act: 'meal', dinner: true, source: 'default', sort: 1 },
      { id: 'rh-dad-shop', person: 'dad', title: 'Saturday at the shop', label: 'Every week', every: 7, mode: 'meet', act: 'shop', source: 'default', sort: 2 },
      { id: 'rh-mom-dinner', person: 'mom', title: 'Dinner together', label: 'Most nights', every: 2, mode: 'meet', act: 'meal', dinner: true, source: 'default', sort: 1 },
      { id: 'rh-mom-time', person: 'mom', title: 'Time with just her', label: 'Every week', every: 7, mode: 'meet', solo: true, source: 'default', sort: 2 },
      { id: 'rh-kabir', person: 'kabir', title: 'See him', label: 'Every week, in person', every: 7, mode: 'meet', source: 'default', sort: 1 },
      { id: 'rh-rohan', person: 'rohan', title: 'Stay in touch', label: 'Every week, a chat or a call', every: 7, mode: 'talk', source: 'default', sort: 1 },
    ],
    moments: [
      // family (the prototype's fm1–fm9 and October's dinners)
      M('fm2', '2026-10-22', '14:40', ['dad'], 'family', { act: 'shop', minutes: 15, title: 'Chai with Dad at the shop', text: 'Before the listings. He wants the Silk stock online before the Diwali rush.', by: 'you', source: 'you' }),
      M('fm1', '2026-10-22', '08:10', ['mom'], 'family', { act: 'meal', minutes: 20, title: 'Breakfast with Mom', text: 'Parathas before GE I. She asked when your exams start.', by: 'wyn', source: 'call' }),
      M('fm3', '2026-10-21', '21:05', ['mom', 'dad'], 'family', { act: 'talk', minutes: 70, dinner: true, title: 'Dinner, then sat with them', text: 'Dad talked about the Diwali rush at the shop. Mom wants the house painted before the 8th.',
        said: 'I\'m sitting with family', saidNote: 'Wyn quieted your phone and timed it until you picked it up at 22:15.', by: 'wyn', source: 'said' }),
      M('fm4', '2026-10-21', '13:05', ['mom'], 'family', { kind: 'chat', act: null, title: 'Mom asked if you\'d be home for dinner', chat: [['them', 'Aaj khane pe ghar aaoge?'], ['me', 'Haan, 9 tak']], by: 'wyn', source: 'chat' }),
      M('fm5', '2026-10-20', '21:00', ['mom', 'dad'], 'family', { act: 'meal', minutes: 45, dinner: true, title: 'Dinner at home', text: 'Rajma chawal. You showed them the app you\'re building.', by: 'wyn', source: 'calendar' }),
      M('fm6', '2026-10-20', '18:20', ['mom'], 'family', { act: 'help', minutes: 20, title: 'Set up UPI on Mom\'s phone', text: 'Her phone is slow. Worth remembering: a phone with a bigger screen.', by: 'you', source: 'you' }),
      M('fm7', '2026-10-19', '21:00', ['mom', 'dad'], 'family', { act: 'meal', minutes: 40, dinner: true, title: 'Dinner at home', text: 'Dad was tired after the stock count.', by: 'wyn', source: 'calendar' }),
      M('fm8', '2026-10-18', '20:45', ['mom', 'dad'], 'family', { act: 'meal', minutes: 55, dinner: true, title: 'Sunday dinner', text: 'Kadhi chawal. You talked about taking them out for their anniversary next Sunday.', by: 'wyn', source: 'voice' }),
      M('fm9', '2026-10-10', '11:00', ['dad'], 'family', { act: 'shop', minutes: 240, title: 'A Saturday at the shop', text: 'You ran the counter while he did the accounts.', by: 'you', source: 'you' }),
      ...[1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 14, 15, 16].map((d) => M(`fmd${d}`, `2026-10-${String(d).padStart(2, '0')}`, '21:00', ['mom', 'dad'], 'family', { act: 'meal', minutes: 0, dinner: true, title: 'Dinner at home', by: 'wyn', source: 'calendar', quiet: true })),
      // friends (the prototype's m1–m8)
      M('m1', '2026-10-22', '14:12', ['rohan'], 'friends', { kind: 'chat', title: 'He asked when you’re meeting', text: 'You said maybe Sunday. Nothing is fixed yet.', by: 'wyn', source: 'chat', loop: 'Meet Rohan on Sunday',
        chat: [['them', 'bhai kitne din ho gaye'], ['them', 'kab mil rahe?'], ['me', 'sunday?'], ['them', 'done, time bata']] }),
      M('m2', '2026-10-18', '21:05', ['rohan'], 'friends', { kind: 'chat', title: 'Reels back and forth', text: 'He sent a reel; you sent three back.', by: 'wyn', source: 'share' }),
      M('m3', '2026-10-10', '21:40', ['kabir'], 'friends', { act: 'food', minutes: 120, title: 'Food on Saturday', text: 'Momos, then the long walk back.', by: 'wyn', source: 'said', said: 'Back from momos with Kabir' }),
      M('m4', '2026-10-04', '18:30', ['rohan'], 'friends', { kind: 'call', minutes: 25, title: 'A 25-minute call', text: 'Caught up on college.', by: 'wyn', source: 'said', said: 'Just talked to Rohan for like 25 minutes' }),
      M('m5', '2026-09-26', '19:00', ['kabir'], 'friends', { act: 'food', minutes: 90, title: 'Food after the shop', text: 'Rolls at the usual place.', by: 'wyn', source: 'calendar' }),
      M('m6', '2026-09-19', '17:00', ['rohan'], 'friends', { act: 'chai', minutes: 60, title: 'Chai and a walk', text: 'The two of you, after a long gap.', by: 'wyn', source: 'calendar' }),
      M('m7', '2026-09-12', '20:15', ['kabir'], 'friends', { act: 'food', minutes: 90, title: 'Chole bhature', text: 'Saturday lunch, the two of you.', by: 'you', source: 'you' }),
      M('m8', '2026-09-05', '19:30', ['kabir'], 'friends', { act: 'food', minutes: 150, title: 'Pizza night', text: 'A long one. Talked till the shop shut.', by: 'wyn', source: 'calendar' }),
    ],
    plans: [
      { id: 'p1', date: '2026-10-24', people: ['kabir'], aspect: 'friends', title: 'Gym first, then food', state: 'draft', slot: 'Sat 06:30', idea: 'gym' },
      { id: 'p2', date: '2026-10-25', people: ['rohan'], aspect: 'friends', title: 'Meet up on Sunday', state: 'asked' },
      { id: 'pl-shop', date: '2026-10-24', people: ['dad'], aspect: 'family', title: 'Saturdays at the shop', meta: 'Till Diwali · 24 Oct, 31 Oct, 7 Nov', state: 'idea', by: 'wyn', slot: '11:00' },
      { id: 'pl-paint', date: null, people: ['mom'], aspect: 'family', title: 'Paint the house', meta: 'Before Diwali · Mom\'s ask', state: 'idea', by: 'wyn' },
      { id: 'pl-dinner', date: '2026-10-25', people: ['mom', 'dad'], aspect: 'family', title: 'Their anniversary dinner', meta: 'Sun 25 · a table for three', state: 'tentative', slot: 'Evening' },
    ],
    ideas: [
      { id: 'gi-phone', kind: 'gift', person: 'mom', aspect: 'family', title: 'A phone with a bigger screen', from: 'From Tuesday: hers is slow', moment: 'fm6', done: false },
      { id: 'su-table', kind: 'showup', person: 'mom', with: ['mom', 'dad'], aspect: 'family', title: 'Book a table for the anniversary dinner', meta: 'Due Sun 25 · for the 25th', done: false },
      { id: 'su-shop', kind: 'showup', person: 'dad', aspect: 'family', title: 'Help Dad at the shop on Saturday', meta: 'Sat 24 · 11:00 to 15:00', done: false },
      { id: 'su-ask', kind: 'showup', person: 'mom', aspect: 'family', title: 'Ask Mom what she\'d like for Diwali', meta: 'Wyn adds it to her gift ideas', done: false },
    ],
    dates: [
      { id: 'dt-diwali-2026', kind: 'festival', title: 'Diwali', date: '2026-11-08', md: '11-08', annual: false, people: ['dad', 'mom'], aspect: 'family', source: 'festival', note: 'The busiest fortnight at the shop runs up to it' },
      { id: 'dt-anniv-dinner', kind: 'other', title: 'Their anniversary dinner', date: '2026-10-25', annual: false, people: ['mom', 'dad'], aspect: 'family', source: 'you', note: 'Table not booked yet' },
    ],
    drafts: [
      { id: 'dr-kabir', person: 'kabir', kind: 'plan', state: 'draft', by: 'wyn', text: 'Bhai, Saturday free hai? Is baar pehle gym, phir khaana. Chalega?', at: '15:00', why: 'For Saturday' },
    ],
    journal: [
      { id: 'n5', date: '2026-10-20', at: '22:05', kind: 'note', feel: 'calm', by: 'wyn', source: 'voice', text: 'Stayed back after the P&S tutorial and talked to two people for half an hour. One of them is building something too. Felt normal, in a good way.' },
      { id: 'n4', date: '2026-10-18', at: '23:10', kind: 'note', feel: 'low', by: 'you', source: 'you', text: 'Quiet Sunday. Everyone seems to have a plan except me. Not sad exactly, just aware of it.' },
      { id: 'n3', date: '2026-10-17', at: '21:30', kind: 'note', feel: 'hopeful', by: 'you', source: 'you', prompt: 'What took a bit of courage today?', text: 'Went to the freshers’ night for an hour. Didn’t talk much, but I went. Next time, stay longer.' },
      { id: 'n2', date: '2026-10-14', at: '19:12', kind: 'note', feel: 'curious', by: 'wyn', source: 'chat', src: 'WhatsApp · class group', text: 'The class group is planning a stall for the fest. You said you’d help on Friday.' },
      { id: 'n1', date: '2026-10-12', at: '07:50', kind: 'note', feel: 'happy', by: 'you', source: 'you', text: 'Gym felt good. I’ve started to notice I stand differently.' },
      { id: 'r1', date: '2026-10-20', at: '18:00', kind: 'rep', by: 'wyn', source: 'voice', text: 'Stayed back after the tutorial and talked to two classmates' },
      { id: 'r2', date: '2026-10-17', at: '22:00', kind: 'rep', by: 'you', source: 'you', step: true, text: 'Freshers’ night, for an hour' },
      { id: 'r3', date: '2026-10-11', at: '08:00', kind: 'rep', by: 'wyn', source: 'calendar', step: true, text: 'First time at the Sunday run club' },
      { id: 'r4', date: '2026-10-08', at: '13:00', kind: 'rep', by: 'wyn', source: 'chat', text: 'Said yes to the class group’s lunch' },
    ],
    state: [
      { id: 'romance', lock: true, onToday: true, patterns: true, nudge: 'sun' },
      { id: 'looking', intent: 'Something long-term, when it’s right', must: ['Honest, even when it’s awkward', 'Gets on with family', 'Ambitious about something', 'Laughs easily'], green: ['Remembers small things', 'Says sorry first', 'Kind to strangers', 'Has close friends'],
        answers: {
          p1: { a: 'Kind when nobody is watching, with a big thing of their own going on.', fb: 'great' },
          p2: { a: 'You can sit through two hours of me talking about building things, then drag me outside.', fb: 'great' },
          p3: { a: 'Close to their family, and still has their own opinions.', fb: 'deeper', ask: 'What does “their own opinions” look like when the two of you disagree?' },
          p4: { a: 'I’ll build you things, I show up, and I don’t give up on people.', fb: 'small', ask: '“I show up” is the strongest line. Try leading with it.' },
        } },
      { id: 'step:2026-09-07', done: true }, { id: 'step:2026-09-14', done: false }, { id: 'step:2026-09-21', done: true }, { id: 'step:2026-09-28', quiet: true },
      { id: 'step:2026-10-05', done: true }, { id: 'step:2026-10-12', done: true },
      { id: 'family', dayGoal: 60 },
    ],
  };
}

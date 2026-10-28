// Money's demo data (?data=demo only): the approved prototype's October 2026, as the same docs the PC keeps, so demo
// mode runs through the real arithmetic. Never shown in real mode. Owner: the Money agent.
import { isoAt, pad2 } from './money-calc.js';

const day = (d, t = '12:00') => isoAt(`2026-10-${pad2(d)}`, t);
// [day, time, merchant, category, amount, logged by, note?, extra?]   by: upi · scan · you · told
const RAW = [
  [1, '09:10', 'Uber', 'transport', 240, 'upi'], [1, '11:20', 'Xerox, City College', 'college', 60, 'upi'],
  [1, '12:40', 'City College canteen', 'food', 90, 'upi'], [1, '16:15', 'Chai', 'food', 30, 'you', 'Cash'],
  [1, '21:30', "Swiggy · Domino's", 'food', 400, 'upi'],
  [2, '14:30', 'Rapido', 'transport', 120, 'upi'], [2, '15:50', 'PVR INOX, Midtown', 'fun', 640, 'upi'],
  [2, '18:30', "Haldiram's", 'food', 380, 'upi'], [2, '19:40', 'Rapido', 'transport', 120, 'upi'],
  [3, '11:05', 'Delhi Metro card', 'transport', 220, 'upi'], [3, '20:50', 'Swiggy · Biryani Blues', 'food', 420, 'upi'],
  [4, '10:00', 'Laundry', 'other', 150, 'told', 'Cash'], [4, '17:20', 'Blinkit', 'food', 230, 'upi'],
  [5, '08:55', 'Uber', 'transport', 260, 'upi'], [5, '13:10', 'City College canteen', 'food', 110, 'upi'],
  [5, '22:15', 'Amazon', 'college', 340, 'upi', 'Linear algebra book'],
  [6, '09:05', 'Rapido', 'transport', 90, 'upi'], [6, '11:30', 'Chai', 'food', 30, 'you', 'Cash'],
  [6, '12:00', 'Xerox, City College', 'college', 100, 'upi'], [6, '14:20', 'Wow! Momo', 'food', 190, 'upi'],
  [6, '19:10', 'Apollo Pharmacy', 'health', 180, 'upi'],
  [7, '07:50', 'Gym, Midtown', 'health', 1100, 'upi', 'October fee'], [7, '13:00', 'City College canteen', 'food', 100, 'upi'],
  [7, '16:30', 'Chai', 'food', 40, 'you', 'Cash'],
  [8, '09:00', 'Uber', 'transport', 230, 'upi'], [8, '17:45', 'Chaayos', 'food', 220, 'upi'],
  [9, '10:15', 'Rapido', 'transport', 80, 'upi'], [9, '21:05', "Swiggy · Domino's", 'food', 480, 'upi'],
  [9, '23:10', 'Steam', 'fun', 420, 'upi'],
  [10, '12:30', 'Myntra', 'shopping', 1250, 'upi', 'Kurta for Diwali'],
  [10, '14:10', "QD's, Midtown", 'food', 760, 'upi', 'Lunch with Kabir', { split: 'kabir', name: 'Kabir', share: 380 }],
  [10, '17:00', 'Chai', 'food', 30, 'you', 'Cash'],
  [11, '18:40', 'Blinkit', 'food', 300, 'upi'],
  [12, '08:50', 'Uber', 'transport', 250, 'upi'], [12, '13:20', 'City College canteen', 'food', 90, 'upi'],
  [12, '18:00', 'Haircut', 'other', 180, 'told', 'Cash'],
  [13, '09:10', 'Rapido', 'transport', 110, 'upi'], [13, '14:00', 'Wow! Momo', 'food', 210, 'upi'],
  [13, '16:20', 'Chai', 'food', 30, 'you', 'Cash'], [13, '19:30', "Haldiram's", 'family', 290, 'upi', 'Sweets for home'],
  [14, '08:40', 'Delhi Metro card', 'transport', 250, 'upi'], [14, '11:00', 'Chai', 'food', 40, 'you', 'Cash'],
  [14, '13:10', 'City College canteen', 'food', 120, 'upi'],
  [15, '18:20', 'Puma, the mall', 'shopping', 2100, 'scan', 'Running shoes'], [15, '20:10', 'Uber', 'transport', 250, 'upi'],
  [16, '09:20', 'Rapido', 'transport', 140, 'upi'], [16, '10:30', 'Chai', 'food', 40, 'you', 'Cash'],
  [16, '21:15', 'Swiggy · Biryani Blues', 'food', 380, 'upi'],
  [17, '16:40', 'Decathlon', 'shopping', 650, 'scan', 'Gym shorts'], [17, '18:10', 'Chai and bun maska', 'food', 70, 'you', 'Cash'],
  [18, '19:00', 'Blinkit', 'food', 230, 'upi'],
  [19, '08:45', 'Uber', 'transport', 260, 'upi'], [19, '13:05', 'City College canteen', 'food', 110, 'upi'],
  [19, '18:30', 'BookMyShow', 'fun', 320, 'upi', 'Stand-up, Hauz Khas'],
  [20, '09:00', 'Rapido', 'transport', 100, 'upi'], [20, '11:40', 'Xerox, City College', 'college', 50, 'upi'],
  [20, '14:30', 'Wow! Momo', 'food', 230, 'upi'], [20, '22:40', 'Google Play', 'fun', 100, 'upi'],
  [21, '11:15', 'Chai', 'food', 40, 'you', 'Cash'], [21, '13:15', 'City College canteen', 'food', 100, 'upi'],
  [21, '19:45', 'Flowers for Mom', 'family', 230, 'upi'],
  [22, '09:05', 'Uber', 'transport', 210, 'upi'], [22, '10:15', 'Chai', 'food', 40, 'upi'],
  [22, '12:10', 'Xerox, City College', 'college', 90, 'upi', 'Printouts'], [22, '14:20', 'Snitch, Midtown', 'shopping', 900, 'upi', 'Shirt'],
];
const VPA = {
  Uber: 'uber.in@axisbank', 'Xerox, City College': 'collegexerox@okhdfc', 'City College canteen': 'collegecanteen@paytm', Chai: 'q47219@ybl',
  "Swiggy · Domino's": 'swiggy.stores@icici', Rapido: 'rapido.bike@axl', 'PVR INOX, Midtown': 'pvrinox@hdfcbank', "Haldiram's": 'haldirams@icici',
  'Delhi Metro card': 'dmrc.recharge@sbi', 'Swiggy · Biryani Blues': 'swiggy.stores@icici', Blinkit: 'blinkit@kotak', Amazon: 'amazon@apl',
  'Wow! Momo': 'wowmomo@ybl', 'Apollo Pharmacy': 'apollopharmacy@icici', 'Gym, Midtown': 'fitzone.midtown@okaxis', Chaayos: 'chaayos@hdfcbank',
  Steam: 'steam.payu@hdfcbank', Myntra: 'myntra@icici', "QD's, Midtown": 'qdsrestaurant@okicici', BookMyShow: 'bookmyshow@hdfcbank',
  'Google Play': 'playstore@axisbank', 'Flowers for Mom': 'fnp.flowers@ybl', 'Snitch, Midtown': 'snitch.payu@hdfcbank',
  'Puma, the mall': 'puma.midtown@hdfcbank', Decathlon: 'decathlon@icici',
};
const SAID = { Laundry: 'Laundry was 150, paid cash', Haircut: '180 for the haircut, cash' };
const RECEIPT = { 'Puma, the mall': [['Velocity Nitro running shoes', 2100]], Decathlon: [['Kalenji running shorts', 499], ['Sports socks, 2 pairs', 151]] };
const refOf = (i) => String(629514873210 - i * 7349117).slice(0, 12);
const T0 = '2026-10-01T00:00:00.000Z';
const stamp = (o) => ({ created_at: T0, updated_at: T0, deleted_at: null, ...o });

const spends = RAW.map(([d, t, m, c, a, by, note, x = {}], i) => stamp({
  created_at: day(d, t), updated_at: day(d, t), id: `x${i + 1}`, kind: 'out', amount: a, category: c, merchant: m, at: day(d, t), note: note === 'Cash' ? '' : note ?? '',
  source: by === 'scan' ? 'receipt' : by, pay: by === 'you' || by === 'told' ? 'cash' : 'upi', account: by === 'you' || by === 'told' ? 'cash' : 'hdfc',
  vpa: by === 'upi' ? VPA[m] ?? null : null, ref: by === 'upi' ? refOf(i) : null, said: by === 'told' ? SAID[m] ?? null : null, items: by === 'scan' ? RECEIPT[m] ?? null : null,
  split: x.split ? { person: x.split, name: x.name, share: x.share } : null,
}));
const RECURRING = [
  { id: 'claude', name: 'Claude Max', amount: 8900, day: 3, pay: 'card', account: 'card', note: 'Your one LLM budget' },
  { id: 'jio', name: 'Jio recharge', amount: 349, day: 5, pay: 'upi', account: 'hdfc', note: 'Every 28 days', every: '28d' },
  { id: 'spotify', name: 'Spotify', amount: 119, day: 8, pay: 'card', account: 'card', note: 'Monthly' },
  { id: 'codex', name: 'Codex Pro', amount: 9900, day: 12, pay: 'card', account: 'card', note: 'Started 12 Sep', leak: true, why: 'Used on 6 of the last 30 days' },
  { id: 'cursor', name: 'Cursor Pro', amount: 1950, day: 15, pay: 'card', account: 'card', note: 'You meant to cancel it', leak: true, why: 'Unused for 41 days' },
  { id: 'icloud', name: 'iCloud+ 50 GB', amount: 75, day: 18, pay: 'card', account: 'card', note: 'Monthly' },
].map((r) => stamp({ every: 'month', state: 'active', ...r }));
const billTx = RECURRING.map((r) => stamp({ id: `b_${r.id}`, kind: 'out', amount: r.amount, category: 'bills', merchant: r.name, bill: r.id, at: day(r.day, '06:00'), source: 'recurring', account: r.account, pay: r.pay }));
const income = [
  { id: 'in1', d: 1, t: '09:00', c: 'pocket', m: 'Pocket money', from: 'Dad', a: 5000 },
  { id: 'in2', d: 5, t: '19:30', c: 'wonder', m: 'Corner Market payout', from: 'Morgan & Co.', a: 4800 },
  { id: 'in3', d: 9, t: '11:10', c: 'client', m: 'Atlas ERP · milestone 2', from: 'Atlas ERP', a: 20000 },
  { id: 'in4', d: 12, t: '19:30', c: 'wonder', m: 'Corner Market payout', from: 'Morgan & Co.', a: 5200 },
  { id: 'in5', d: 19, t: '19:30', c: 'wonder', m: 'Corner Market payout', from: 'Morgan & Co.', a: 6000 },
].map((x) => stamp({ id: x.id, kind: 'in', amount: x.a, category: x.c, merchant: x.m, from: x.from, at: day(x.d, x.t), source: 'upi', account: 'hdfc' }));
const AS_OF = '2026-10-22T12:00:00.000Z';
const ACCOUNTS = [
  { id: 'cash', kind: 'cash', name: 'Cash', balance: 2350, meta: 'In your wallet' },
  { id: 'hdfc', kind: 'bank', name: 'Demo Bank savings', balance: 48500, meta: 'From UPI messages · ends 1234', primary: true },
  { id: 'lite', kind: 'upi', name: 'UPI Lite', balance: 1180, meta: 'On your phone, for small payments' },
  { id: 'amazon', kind: 'wallet', name: 'Amazon Pay balance', balance: 640, meta: 'Topped up 11 Oct' },
  { id: 'usd', kind: 'fx', name: 'US dollars', balance: 7480, meta: '$85 in Wise at ₹88.0' },
  { id: 'index', kind: 'invest', name: 'Nifty 50 index fund', balance: 24850, meta: 'SIP ₹2,000 on the 7th · up 4.1%' },
  { id: 'trading', kind: 'trading', name: 'Trading', balance: 0, meta: 'Paper only, nothing live · not counted', counted: false },
  { id: 'card', kind: 'card', name: 'Demo Bank credit card', balance: 20944, meta: 'Due Thu 5 Nov · the five subscriptions', due: '2026-11-05' },
].map((a) => stamp({ as_of: AS_OF, counted: true, ...a }));
const BUDGETS = { food: 8000, transport: 3500, shopping: 4000, college: 1500, family: 6000, fun: 3000, health: 2500, other: 2500 };
const HISTORY = [['2026-05', 46200, 6900], ['2026-06', 53800, 7600], ['2026-07', 60900, 7100], ['2026-08', 69600, 8700], ['2026-09', 73400, 3800]];
const SOURCES = [
  { id: 'wonder', name: 'Corner Market', kind: 'business', read: 'Your share of online sales, paid each Monday. Up 18% on September, and Diwali weeks are next.', expected: 6500, prev: 13600, link: { task: 't13' } },
  { id: 'client', name: 'Northwind clients', kind: 'client', read: 'Milestone 2 of Atlas ERP, by NEFT. Your biggest payer; the tier you pick on j13 sets November.', prev: 20000 },
  { id: 'pocket', name: 'Pocket money', kind: 'pocket', read: 'From Dad on the 1st. Steady, and the one you can\'t grow.', prev: 5000, link: { person: 'dad' } },
];

export const DEMO_RAW = {
  tx: [...spends, ...billTx, ...income],
  budgets: Object.entries(BUDGETS).map(([c, a]) => stamp({ id: `2026-10:${c}`, month: '2026-10', category: c, amount: a })),
  recurring: RECURRING, accounts: ACCOUNTS,
  funds: [stamp({ id: 'anniversary', key: 'anniversary', name: 'Anniversary fund', target: 150000, start: 18400, monthly: 2500, aspect: 'family', goal: 'g10' })],
  leaks: [], sources: SOURCES.map(stamp), imports: [],
  snapshots: HISTORY.map(([m, w, k]) => stamp({ id: `${m}-28`, date: `${m}-28`, worth: w, kept: k })),
  settings: stamp({ id: 'prefs', nudge: true, borrow: true, call: false, borrowed: {} }),
};
// what the Demo Bank statement holds when he shares it in demo mode: the review the prototype showed
export const DEMO_PENDING = [{ id: 'glowbox:1', slug: 'glowbox', name: 'Glowbox', what: 'Catalog fill', amount: 12000, label: '₹12,000', note: 'Not invoiced yet' }];
export function demoStatement(logged) {
  const rows = [
    [8, 'UPI/DR/624118230917/XEROX POINT/YESB/xeroxpoint@ybl', 'Xerox Point', 'college', 40, 'new'],
    [13, 'UPI/DR/624530118266/SWIGGY INSTAMART/ICIC/instamart@icici', 'Swiggy Instamart', 'food', 243, 'new'],
    [14, 'UPI/DR/624611907143/ZOMATO LTD/HDFC/zomato@hdfcbank', 'Zomato', 'food', 386, 'new', 'Zomato notifications were off that night'],
    [16, 'UPI/DR/624822014590/BLINKIT/KKBK/blinkit@kotak', 'Blinkit', 'food', 164, 'new'],
    [18, 'UPI/DR/625013377021/DMRC/SBIN/dmrc.recharge@sbi', 'Delhi Metro card', 'transport', 200, 'new'],
    [19, 'NACH/DR/GOOGLE ONE/GOOGLE INDIA DIGITAL', 'Google One', 'bills', 130, 'sub', 'A subscription you don\'t have in Money. You also pay for iCloud+'],
    [20, 'UPI/DR/625217840033/RAPIDO/UTIB/rapido.bike@axl', 'Rapido', 'transport', 95, 'new'],
    [21, 'IMPS/DR/600000000001/ROHAN/HDFC0000001', 'Rohan', null, 500, 'ask', 'Sent to Rohan. Only you know what it was'],
    [3, 'ATM/WDL/MIDTOWN/HDFC', 'Cash from the ATM', null, 2000, 'moved', 'Moved to your wallet, not spent'],
    [7, 'ACH/DR/NIPPON INDIA MF/SIP', 'Index fund SIP', null, 2000, 'moved', 'Into the Nifty 50 index fund, not spent'],
    [11, 'UPI/DR/624377102481/AMAZON PAY/APL/amazonpay@apl', 'Amazon Pay top-up', null, 500, 'moved', 'Into your Amazon Pay balance, not spent'],
  ].map(([d, desc, m, c, a, status, why = ''], i) => ({ id: `r${i + 1}`, date: `2026-10-${pad2(d)}`, desc, merchant: m, amount: a, dir: 'dr', status, category: c, why, person: status === 'ask' ? m : null, match: null, rail: desc.split('/')[0] }));
  const matched = logged.filter((t) => t.date < '2026-10-22' && (t.kind === 'in' || (t.pay === 'upi' && (t.by === 'upi' || t.by === 'scan'))))
    .map((t, i) => ({ id: `m${i + 1}`, date: t.date, desc: '', merchant: t.m, amount: t.a, dir: t.kind === 'in' ? 'cr' : 'dr', status: 'matched', category: t.c, match: t.id, why: t.by === 'scan' ? 'Matched the receipt you scanned' : 'Matched the UPI message' }));
  const all = [...rows, ...matched];
  const counts = { rows: all.length, matched: 0, new: 0, moved: 0, sub: 0, ask: 0, income: 0 };
  for (const r of all) counts[r.status]++;
  return { id: 'imp_demo', kind: 'statement', status: 'review', bank: 'Demo Bank', name: 'Statement_Oct2026.pdf', period: { from: '2026-10-01', to: '2026-10-21' }, rows: all, counts, account: 'hdfc', closing: null, parser: 'demo' };
}

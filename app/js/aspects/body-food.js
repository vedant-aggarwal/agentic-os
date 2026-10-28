// Body · food estimates in Indian portions (roti, katori, glass, scoop), for "say what you ate" offline and for meals
// that arrive with a name only (Siri, a widget, Wyn). Pure, no imports: the PC's body module imports this same file.
// Numbers are typical home-cooked values per portion (IFCT-style averages); every result says it is an estimate.
// Owner: the Body agent.

// k: names it answers to · u: the portion · g: grams in one · kcal, p (protein), c (carbs), f (fat), fib (fibre) per portion
export const FOODS = [
  { k: ['roti', 'chapati', 'chapatti', 'phulka', 'rotis'], u: 'roti', g: 40, kcal: 110, p: 3, c: 18, f: 3, fib: 2 },
  { k: ['paratha', 'plain paratha'], u: 'paratha', g: 80, kcal: 260, p: 5, c: 32, f: 12, fib: 3 },
  { k: ['aloo paratha'], u: 'paratha', g: 130, kcal: 290, p: 6, c: 40, f: 12, fib: 4 },
  { k: ['paneer paratha'], u: 'paratha', g: 130, kcal: 330, p: 12, c: 36, f: 15, fib: 3 },
  { k: ['puri', 'poori'], u: 'puri', g: 25, kcal: 100, p: 2, c: 12, f: 5, fib: 1 },
  { k: ['naan'], u: 'naan', g: 90, kcal: 260, p: 8, c: 45, f: 5, fib: 2 },
  { k: ['rice', 'chawal', 'steamed rice'], u: 'katori', g: 150, kcal: 195, p: 4, c: 43, f: 0.5, fib: 1 },
  { k: ['jeera rice'], u: 'katori', g: 150, kcal: 230, p: 4, c: 42, f: 5, fib: 1 },
  { k: ['biryani', 'veg biryani'], u: 'katori', g: 180, kcal: 330, p: 7, c: 48, f: 12, fib: 3 },
  { k: ['chicken biryani'], u: 'katori', g: 200, kcal: 400, p: 20, c: 45, f: 15, fib: 2 },
  { k: ['khichdi'], u: 'katori', g: 200, kcal: 240, p: 9, c: 38, f: 6, fib: 4 },
  { k: ['poha'], u: 'plate', g: 150, kcal: 270, p: 5, c: 45, f: 8, fib: 2 },
  { k: ['upma'], u: 'plate', g: 150, kcal: 250, p: 6, c: 38, f: 8, fib: 3 },
  { k: ['idli', 'idlis'], u: 'idli', g: 40, kcal: 60, p: 2, c: 12, f: 0.3, fib: 0.5 },
  { k: ['dosa', 'plain dosa'], u: 'dosa', g: 100, kcal: 170, p: 4, c: 28, f: 5, fib: 1 },
  { k: ['masala dosa'], u: 'dosa', g: 180, kcal: 330, p: 7, c: 45, f: 13, fib: 3 },
  { k: ['dal', 'daal', 'dal tadka', 'arhar dal', 'moong dal', 'masoor dal', 'kali masur dal'], u: 'katori', g: 150, kcal: 150, p: 8, c: 20, f: 4, fib: 5 },
  { k: ['dal makhani'], u: 'katori', g: 150, kcal: 250, p: 9, c: 22, f: 14, fib: 6 },
  { k: ['rajma'], u: 'katori', g: 180, kcal: 250, p: 10, c: 32, f: 8, fib: 9 },
  { k: ['chole', 'chana masala', 'chhole'], u: 'katori', g: 180, kcal: 270, p: 10, c: 35, f: 9, fib: 9 },
  { k: ['kadhi'], u: 'katori', g: 180, kcal: 180, p: 6, c: 14, f: 11, fib: 1 },
  { k: ['sambar'], u: 'katori', g: 180, kcal: 130, p: 6, c: 18, f: 4, fib: 5 },
  { k: ['paneer', 'paneer bhurji', 'paneer tikka'], u: '100 g', g: 100, kcal: 265, p: 18, c: 4, f: 20, fib: 0 },
  { k: ['palak paneer'], u: 'katori', g: 180, kcal: 330, p: 15, c: 10, f: 25, fib: 3 },
  { k: ['shahi paneer', 'paneer butter masala', 'kadai paneer'], u: 'katori', g: 180, kcal: 380, p: 14, c: 12, f: 30, fib: 2 },
  { k: ['sabzi', 'sabji', 'mixed veg', 'aloo gobi', 'bhindi', 'aloo sabzi', 'aloo-mangodi sabzi', 'lauki'], u: 'katori', g: 150, kcal: 140, p: 3, c: 16, f: 7, fib: 4 },
  { k: ['soya', 'soya chunks', 'nutrela'], u: 'katori', g: 50, kcal: 170, p: 26, c: 16, f: 0.5, fib: 6 },
  { k: ['egg', 'eggs', 'boiled egg', 'boiled eggs', 'anda', 'ande'], u: 'egg', g: 50, kcal: 78, p: 6, c: 0.5, f: 5, fib: 0 },
  { k: ['omelette', 'omelet'], u: 'omelette', g: 110, kcal: 190, p: 13, c: 2, f: 14, fib: 0 },
  { k: ['egg white', 'egg whites'], u: 'egg white', g: 33, kcal: 17, p: 3.6, c: 0.2, f: 0, fib: 0 },
  { k: ['chicken', 'chicken breast', 'grilled chicken', 'tandoori chicken'], u: '100 g', g: 100, kcal: 165, p: 31, c: 0, f: 4, fib: 0 },
  { k: ['chicken curry', 'butter chicken'], u: 'katori', g: 180, kcal: 330, p: 25, c: 8, f: 22, fib: 1 },
  { k: ['fish', 'fish curry'], u: '100 g', g: 100, kcal: 180, p: 22, c: 3, f: 9, fib: 0 },
  { k: ['whey', 'whey protein', 'protein shake', 'shake', 'scoop'], u: 'scoop', g: 32, kcal: 120, p: 24, c: 3, f: 1.5, fib: 0 },
  { k: ['milk', 'doodh'], u: 'glass', g: 250, kcal: 160, p: 8, c: 12, f: 8, fib: 0 },
  { k: ['curd', 'dahi', 'yogurt', 'yoghurt'], u: 'katori', g: 150, kcal: 110, p: 5, c: 7, f: 6, fib: 0 },
  { k: ['greek yogurt', 'greek yoghurt'], u: 'katori', g: 150, kcal: 140, p: 15, c: 6, f: 6, fib: 0 },
  { k: ['lassi'], u: 'glass', g: 250, kcal: 220, p: 7, c: 30, f: 7, fib: 0 },
  { k: ['chaas', 'buttermilk'], u: 'glass', g: 250, kcal: 40, p: 2, c: 4, f: 1.5, fib: 0 },
  { k: ['chai', 'tea'], u: 'cup', g: 150, kcal: 80, p: 2, c: 11, f: 3, fib: 0 },
  { k: ['coffee'], u: 'cup', g: 150, kcal: 90, p: 3, c: 11, f: 3.5, fib: 0 },
  { k: ['black coffee'], u: 'cup', g: 200, kcal: 5, p: 0.3, c: 0, f: 0, fib: 0 },
  { k: ['oats', 'protein oats'], u: 'katori', g: 40, kcal: 150, p: 5, c: 27, f: 3, fib: 4 },
  { k: ['bread', 'toast', 'brown bread'], u: 'slice', g: 28, kcal: 75, p: 3, c: 13, f: 1, fib: 1 },
  { k: ['sandwich', 'veg sandwich'], u: 'sandwich', g: 140, kcal: 260, p: 8, c: 36, f: 9, fib: 3 },
  { k: ['peanut butter'], u: 'tablespoon', g: 16, kcal: 95, p: 4, c: 3, f: 8, fib: 1 },
  { k: ['banana', 'kela'], u: 'banana', g: 120, kcal: 105, p: 1.3, c: 27, f: 0.4, fib: 3 },
  { k: ['apple', 'seb'], u: 'apple', g: 180, kcal: 95, p: 0.5, c: 25, f: 0.3, fib: 4 },
  { k: ['pear'], u: 'pear', g: 180, kcal: 100, p: 0.6, c: 27, f: 0.2, fib: 5 },
  { k: ['orange'], u: 'orange', g: 150, kcal: 70, p: 1.3, c: 17, f: 0.2, fib: 3 },
  { k: ['pomegranate', 'anar'], u: 'katori', g: 90, kcal: 75, p: 1.5, c: 17, f: 1, fib: 4 },
  { k: ['almonds', 'badam'], u: 'handful', g: 20, kcal: 116, p: 4, c: 4, f: 10, fib: 2.5 },
  { k: ['peanuts', 'moongfali'], u: 'handful', g: 30, kcal: 170, p: 7.5, c: 5, f: 14, fib: 2.5 },
  { k: ['roasted chana', 'chana'], u: 'handful', g: 40, kcal: 150, p: 8, c: 22, f: 2.5, fib: 7 },
  { k: ['sprouts'], u: 'katori', g: 100, kcal: 110, p: 8, c: 18, f: 1, fib: 5 },
  { k: ['salad'], u: 'plate', g: 100, kcal: 30, p: 1, c: 6, f: 0.2, fib: 2 },
  { k: ['samosa'], u: 'samosa', g: 80, kcal: 260, p: 4, c: 28, f: 15, fib: 2 },
  { k: ['pakora', 'pakoda', 'pakode'], u: 'piece', g: 25, kcal: 75, p: 2, c: 6, f: 5, fib: 1 },
  { k: ['maggi', 'noodles'], u: 'packet', g: 70, kcal: 310, p: 7, c: 44, f: 12, fib: 2 },
  { k: ['pasta'], u: 'plate', g: 200, kcal: 350, p: 11, c: 55, f: 10, fib: 3 },
  { k: ['pizza'], u: 'slice', g: 100, kcal: 270, p: 11, c: 33, f: 10, fib: 2 },
  { k: ['burger'], u: 'burger', g: 150, kcal: 350, p: 12, c: 40, f: 15, fib: 2 },
  { k: ['momos', 'momo'], u: 'piece', g: 25, kcal: 40, p: 1.5, c: 6, f: 1, fib: 0.3 },
  { k: ['biscuit', 'biscuits'], u: 'biscuit', g: 7, kcal: 30, p: 0.5, c: 5, f: 1, fib: 0 },
  { k: ['rusk', 'rusks'], u: 'rusk', g: 15, kcal: 40, p: 1, c: 7, f: 0.8, fib: 0.3 },
  { k: ['kheer'], u: 'katori', g: 150, kcal: 260, p: 7, c: 38, f: 9, fib: 0 },
  { k: ['gulab jamun'], u: 'piece', g: 40, kcal: 150, p: 2, c: 22, f: 6, fib: 0 },
  { k: ['coke', 'cola', 'pepsi', 'soft drink'], u: 'can', g: 300, kcal: 130, p: 0, c: 33, f: 0, fib: 0 },
  { k: ['juice', 'fruit juice'], u: 'glass', g: 250, kcal: 115, p: 1, c: 27, f: 0.3, fib: 0.5 },
  { k: ['ghee'], u: 'teaspoon', g: 5, kcal: 45, p: 0, c: 0, f: 5, fib: 0 },
];
const WORDS = { a: 1, an: 1, one: 1, ek: 1, two: 2, do: 2, three: 3, teen: 3, four: 4, char: 4, five: 5, paanch: 5, six: 6, half: 0.5, aadha: 0.5, adha: 0.5, quarter: 0.25, couple: 2, few: 3 };
// a portion word next to the food changes how much: "a plate of rice" is two katoris, "half plate" one
const UNIT = { katori: 1, bowl: 1, cup: 1, glass: 1, scoop: 1, piece: 1, pc: 1, slice: 1, plate: 2, 'full plate': 2, 'half plate': 1, spoon: 0.15, tablespoon: 0.2, chamach: 0.15, handful: 1, mutthi: 1, packet: 1 };
const ALIAS = FOODS.flatMap((f) => f.k.map((k) => [k, f])).sort((a, b) => b[0].length - a[0].length);
const r1 = (n) => Math.round(n * 10) / 10;

/** "2 roti, paneer bhurji and a katori of dal" → { name, items: [{ name, qty, unit, grams, kcal, protein, carbs, fat, fibre }], kcal, protein, carbs, fat, fibre, unknown, estimate } */
export function estimate(text) {
  const src = String(text ?? '').toLowerCase().replace(/½/g, ' 0.5 ').replace(/[()]/g, ' ');
  const parts = src.split(/,|\+|\band\b|\baur\b|\bwith\b|\bke saath\b|;|\n/).map((s) => s.trim()).filter(Boolean);
  const items = [], unknown = [];
  for (const part of parts) {
    // every food named in this part ("rajma chawal" is two), longest names first so "aloo paratha" beats "paratha"
    let rest = ` ${part} `; const hits = [];
    for (const [k, f] of ALIAS) {
      const re = new RegExp(`([^a-z])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^a-z])`);
      if (re.test(rest) && !hits.includes(f)) { hits.push(f); rest = rest.replace(re, '$1#'); }
    }
    if (!hits.length) { if (part.replace(/[^a-z]/g, '').length > 2) unknown.push(part); continue; }
    for (const f of hits) {
      const num = /(\d+(?:\.\d+)?)/.exec(part); const word = Object.keys(WORDS).find((w) => new RegExp(`(^|\\s)${w}(\\s|$)`).test(part));
      let qty = num ? Number(num[1]) : word ? WORDS[word] : 1;
      if (num && /^\s*(g|gm|grams?)\b/.test(part.slice(num.index + num[0].length))) qty = Number(num[1]) / f.g;          // "150 g paneer"
      else if (num && /^\s*ml\b/.test(part.slice(num.index + num[0].length))) qty = Number(num[1]) / f.g;
      const unitWord = Object.keys(UNIT).sort((a, b) => b.length - a.length).find((u) => part.includes(u));
      if (unitWord && f.u === 'katori' && hits.length === 1) qty *= UNIT[unitWord] || 1;
      if (/half plate/.test(part) && !num) qty = 1;
      qty = Math.max(0.25, Math.min(12, qty));
      items.push({ name: f.k[0][0].toUpperCase() + f.k[0].slice(1), qty: r1(qty), unit: f.u, grams: Math.round(f.g * qty), kcal: Math.round(f.kcal * qty), protein: r1(f.p * qty), carbs: r1(f.c * qty), fat: r1(f.f * qty), fibre: r1(f.fib * qty) });
    }
  }
  const sum = (k) => r1(items.reduce((a, x) => a + x[k], 0));
  const name = String(text ?? '').trim().replace(/^\w/, (c) => c.toUpperCase()).slice(0, 80);
  return { name, items, kcal: Math.round(sum('kcal')), protein: sum('protein'), carbs: sum('carbs'), fat: sum('fat'), fibre: sum('fibre'), unknown, estimate: true };
}
/** Plants in a day of meals (fibre and plants feed the gut): distinct plant foods by name. */
const PLANTS = ['roti', 'paratha', 'rice', 'dal', 'rajma', 'chole', 'sabzi', 'palak', 'soya', 'oats', 'banana', 'apple', 'pear', 'orange', 'pomegranate', 'almonds', 'peanuts', 'chana', 'sprouts', 'salad', 'aloo', 'bhindi', 'gobi', 'lauki', 'poha', 'upma', 'idli', 'dosa', 'sambar', 'khichdi', 'fruit', 'veg'];
export function plantsIn(meals) {
  const seen = new Set();
  for (const m of meals) for (const t of [m.name, ...(m.items ?? []).map((x) => x.name ?? x[0])]) { const s = String(t ?? '').toLowerCase(); for (const p of PLANTS) if (s.includes(p)) seen.add(p); }
  return [...seen];
}

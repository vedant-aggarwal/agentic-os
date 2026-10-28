// Body · Fuel: protein and calories for today against his targets, what to eat next to close the gap (from his usual
// foods), meals (a photo through the one Scan button, words, or quick add), water, fibre and plants, the week.
// Owner: the Body agent. Food photos come through api.scan('food') (Capture); Body handles the result.
import { $, $$, esc, on, openSheet, closeSheet, toast, haptic, ring, setRing, seg, wireSegs } from '../core.js';
import { I } from '../icons.js';
import { AGENT, DEMO_MODE } from '../data.js';
import { api, has } from '../bus.js';
import { native } from '../svc/native-plugins.js';
import { stagger, roll, rollHTML } from '../motion.js';
import { B, QUICK_FOODS, TODAY, eaten, proteinLeft, proteinWeek, clockNow, nowMin, hm, slotName, weekday } from './body-data.js';
import * as store from './body-store.js';
import { estimate, plantsIn } from './body-food.js';
import { DEMO_GAP, DEMO_PLATE } from './body-demo.js';
import { S, nav, refresh } from './body-state.js';
import { BI, int, wyn, barChart, wireScrub } from './body-ui.js';

// food photos in assets/body/food (CC0, see notes); a meal with its own photo shows that; else the bowl glyph
const MEAL_IMG = { shake: 'shake', paratha: 'paratha', rajma: 'rajma', chai: 'chai', paneer: 'paneer' };
const mealPic = (m, cls = '') => (m.photo ? `<span class="bod-food ${cls}"><img src="${esc(m.photo)}" alt="" decoding="async">${BI.bowl}</span>`
  : m.img && MEAL_IMG[m.img] ? `<span class="bod-food ${cls}"><img src="assets/body/food/${MEAL_IMG[m.img]}.jpg" alt="" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('bod-nopic');this.remove()">${BI.bowl}</span>`
  : `<span class="bod-food bod-nopic ${cls}">${BI.bowl}</span>`);
const slotNow = () => { const m = nowMin(); return m < 11 * 60 ? 'breakfast' : m < 16 * 60 ? 'lunch' : m < 19 * 60 ? 'snack' : 'dinner'; };

// what to eat next: his usual high-protein foods, densest first, until the gap closes (demo: the prototype's plan)
export function gapPlan() {
  const left = proteinLeft(); if (!left) return [];
  if (DEMO_MODE) return DEMO_GAP.filter((g) => !B.meals.some((m) => m.name === g.name));
  const pool = QUICK_FOODS.filter((q) => q.p >= 8).sort((a, b) => b.p / b.kcal - a.p / a.kcal);
  const out = []; let need = left; const m = nowMin();
  const slots = [m < 19 * 60 ? ['Next snack', hm(Math.max(m + 30, 17 * 60))] : null, ['With dinner', hm(Math.max(m + 45, 20 * 60 + 30))], ['Before bed', hm(Math.max(m + 90, 22 * 60))]].filter(Boolean);
  for (const q of pool) { if (need <= 3 || out.length >= 3) break; const sl = slots[out.length] ?? slots.at(-1); out.push({ id: `gap-${q.name}`, at: sl[1], slot: sl[0], name: q.name, protein: q.p, kcal: q.kcal, carbs: q.c, fat: q.f, unit: q.unit, img: q.img }); need -= q.p; }
  return out;
}

export function renderFuel(el) {
  const t = eaten(); const T = B.targets; const left = Math.max(0, T.protein - t.p); const kLeft = Math.max(0, T.kcal - t.kcal);
  const gap = gapPlan(); const planned = gap.reduce((a, g) => a + g.protein, 0);
  const week = proteinWeek(); const plants = plantsIn(B.mealsAll.filter((m) => m.date === TODAY));
  el.innerHTML = `
    <div class="phead asp-head"><div class="asp-head-l"><p class="kicker c-as">Body</p><h1 class="lt">Fuel</h1>
      <p class="sub">${left ? `${left} g protein` : 'Protein done'} and ${int(kLeft)} kcal left today</p></div></div>

    <section class="bod-fuel surface">
      <div class="bod-fuel-ring">
        ${ring(t.p / T.protein, 'as', 148, 14, { cls: 'bod-pring', label: `Protein ${t.p} of ${T.protein} grams`,
          inner: `<span class="bod-pring-t"><b class="met">${rollHTML(t.p)}</b><small>of ${T.protein} g</small><i>protein</i></span>` })}
      </div>
      <div class="bod-macros">
        ${macro('Calories', t.kcal, T.kcal, 'kcal')}
        ${macro('Carbs', t.c, Math.round(T.kcal * 0.45 / 4), 'g')}
        ${macro('Fat', t.f, Math.round(T.kcal * 0.25 / 9), 'g')}
        ${macro('Fibre', t.fibre, 30, 'g')}
      </div>
    </section>

    ${left && gap.length ? `<div class="sh"><h2>Close the gap</h2><span class="sh-count">${left} g to go</span></div>
    <section class="bod-gap surface">
      ${wyn(esc(`${gap.slice(0, 2).map((g) => g.name.toLowerCase()).join(' and ').replace(/^\w/, (c) => c.toUpperCase())} cover ${Math.min(left, gap.slice(0, 2).reduce((a, g) => a + g.protein, 0))} g of it.${planned < left ? ' The rest from dinner.' : gap.length > 2 ? ` ${gap[2].name} tops up the rest.` : ''}`), 'bod-flat')}
      <div class="bod-gap-l">${gap.map((g) => `
        <div class="bod-gap-r">
          <span class="bod-gap-at met">${esc(g.at)}</span>
          <span class="rbody"><span class="rtitle">${esc(g.name)}</span><span class="rmeta">${esc(g.slot)} · ${g.kcal} kcal${g.unit ? ` · ${esc(g.unit)}` : ''}</span></span>
          <span class="bod-gap-p met">${g.protein}<small> g</small></span>
          <button class="btn sm icon" data-act="bod-gap-add" data-id="${esc(g.id)}" aria-label="Log ${esc(g.name)}">${I.plus}</button>
        </div>`).join('')}</div>
    </section>` : !left ? `<p class="note">${I.check} Protein target hit. ${esc(AGENT.name)} stops nudging for today.</p>` : ''}

    <div class="bod-logbar">
      <button class="bod-lb" data-act="bod-food-scan"><span class="bod-lb-i">${I.camera}</span><span>Scan a plate</span></button>
      <button class="bod-lb" data-act="bod-food-say"><span class="bod-lb-i">${I.mic}</span><span>Say it</span></button>
      <button class="bod-lb" data-act="bod-food-quick"><span class="bod-lb-i">${I.plus}</span><span>Quick add</span></button>
    </div>

    <div class="sh"><h2>Meals</h2><span class="sh-count">${B.meals.length}</span></div>
    ${B.meals.length ? `<div class="group bod-meals">${B.meals.map((m) => `
      <button class="row bod-meal" data-act="bod-meal" data-id="${esc(m.id)}">
        ${mealPic(m)}
        <span class="rbody"><span class="rtitle">${esc(m.name)}</span><span class="rmeta"><span>${esc(m.at)} · ${esc(m.slot)}</span>${m.how ? `<span class="ell">· ${esc(m.how)}</span>` : ''}</span></span>
        <span class="bod-meal-n"><b class="met">${m.p}<small> g</small></b><small>${m.kcal} kcal${m.estimate ? ' est.' : ''}</small></span>
      </button>`).join('')}</div>` : `<p class="note">Nothing logged today. A photo, a sentence ("2 roti and dal") or a message to ${esc(AGENT.name)} all work.</p>`}

    <div class="sh"><h2>Water</h2><span class="sh-count">${(B.water * 0.25).toFixed(2).replace(/\.?0+$/, '')} of ${(T.water * 0.25).toFixed(2).replace(/\.?0+$/, '')} L</span></div>
    <section class="bod-water surface">
      <div class="bod-glasses" role="img" aria-label="${B.water} of ${T.water} glasses">${Array.from({ length: Math.max(T.water, B.water) }, (_, i) => `<span class="bod-glass${i < B.water ? ' bod-on' : ''}">${BI.glass}</span>`).join('')}</div>
      <div class="bod-water-acts"><button class="btn sm" data-act="bod-water" data-d="-1" aria-label="Remove a glass" ${B.water ? '' : 'disabled'}>${I.minus}</button><button class="btn sm tint" style="--c:var(--as-ink)" data-act="bod-water" data-d="1">${I.plus}Glass, 250 ml</button></div>
    </section>

    ${B.meals.length ? `<div class="sh"><h2>Gut and skin</h2></div>
    <div class="group">
      <div class="row ic"><span class="tile">${BI.leaf}</span><span class="rbody"><span class="rtitle">Fibre ${t.fibre} of 30 g</span><span class="rmeta">${t.fibre >= 30 ? 'Covered today.' : 'Dal, rajma, chana, fruit and salad bring it up.'}</span></span></div>
      <div class="row ic"><span class="tile">${BI.bowl}</span><span class="rbody"><span class="rtitle">${plants.length} of 5 plants</span><span class="rmeta">${plants.length ? esc(plants.slice(0, 5).join(', ').replace(/^\w/, (c) => c.toUpperCase())) : 'None named in today\'s meals yet'}</span></span></div>
    </div>
    <p class="hint">Fibre and plants feed your gut. Salt, sugar and short sleep show on your skin first, and your face scans see it.</p>` : ''}

    ${week.some(([, v]) => v) ? `<div class="sh"><h2>Protein this week</h2><span class="sh-count">target ${T.protein} g</span></div>
    <section class="bod-chartcard surface">
      ${barChart(week.map(([d, v], i) => ({ label: d, v, hi: i === week.length - 1, off: v < T.protein && i !== week.length - 1, cap: i === week.length - 1 ? `${v} g so far` : null, tipV: `${v} g` })), { h: 112, max: Math.max(T.protein * 1.25, ...week.map(([, v]) => v)), target: { v: T.protein, label: `${T.protein} g` }, title: 'Protein per day this week' })}
      <p class="foot">${weekFoot(week, T.protein)}</p>
    </section>` : ''}`;
  wireScrub(el);
  stagger($$('.bod-meal, .bod-gap-r', el), { each: 40, y: 8 });
}
function weekFoot(week, target) {
  const past = week.slice(0, -1); if (!past.length) return 'Monday counts the week from here.';
  const hit = past.filter(([, v]) => v >= target).length; const worst = past.filter(([, v]) => v < target).sort((a, b) => a[1] - b[1])[0];
  return `${hit} of ${past.length} days on target.${worst ? ` ${weekday(worst[2], true)} missed by ${target - worst[1]} g.` : ''}`;
}
const macro = (name, v, of, u) => `<div class="bod-macro"><p><span class="bod-macro-k">${name}</span><span class="met bod-macro-v">${int(v)}<small> / ${int(of)}${u === 'kcal' ? '' : ` ${u}`}</small></span></p><span class="bar" style="--p:${Math.min(100, Math.round((v / Math.max(1, of)) * 100))}%;--c:var(--ink-2)"><i></i></span></div>`;

// add a gap item: the ring moves from where it is, then the section redraws
export function addGap(id) {
  const g = gapPlan().find((x) => x.id === id); if (!g) return;
  const doc = store.addMeal({ name: g.name, slot: slotNow(), kcal: g.kcal, protein: g.protein, carbs: g.carbs, fat: g.fat, source: 'plan', img: g.img ?? null, items: [{ name: g.name, qty: 1, unit: g.unit ?? '', kcal: g.kcal, protein: g.protein }] });
  haptic(10);
  const rg = $('.asp-body .bod-pring'); if (rg) setRing(rg, (eaten().p + g.protein) / B.targets.protein);
  const n = $('.asp-body .bod-pring-t b'); if (n) roll(n, eaten().p + g.protein);
  toast(`Logged ${g.name}: +${g.protein} g protein`, () => store.removeMeal(doc.id));
}
on('bod-gap-add', (b) => addGap(b.dataset.id));
on('bod-water', (b) => { store.setWater(B.water + Number(b.dataset.d)); haptic(6); });

// one meal, what's in it
on('bod-meal', (b) => {
  const m = B.meals.find((x) => x.id === b.dataset.id); if (!m) return;
  openSheet({ title: m.name, sub: [m.at, m.slot, m.how, m.estimate ? 'estimated' : null].filter(Boolean).join(' · '), cls: 'bod-sheet', body: `
    ${m.photo || m.img ? `<div class="bod-meal-hero">${mealPic(m, 'bod-food-hero')}</div>` : ''}
    <div class="bod-mealtot"><span><b class="met">${m.p}</b><small>g protein</small></span><span><b class="met">${m.kcal}</b><small>kcal</small></span><span><b class="met">${m.c}</b><small>g carbs</small></span><span><b class="met">${m.f}</b><small>g fat</small></span></div>
    ${m.items.length ? `<div class="group">${m.items.map(([n, q, k, p]) => `<div class="row"><span class="rbody"><span class="rtitle">${esc(n)}</span><span class="rmeta">${esc(q)}${q ? ' · ' : ''}${k} kcal</span></span><span class="rend met">${p} g</span></div>`).join('')}</div>` : ''}
    ${m.unknown ? `<p class="bod-sheet-p">${esc(AGENT.name)} couldn't put numbers on this one. Open it in Say it to describe the portions.</p>` : ''}
    <div class="bod-cta"><button class="btn block" data-act="bod-meal-del" data-id="${esc(m.id)}">${I.trash}Remove this meal</button></div>` });
});
on('bod-meal-del', (b) => { const d = store.removeMeal(b.dataset.id); closeSheet(); if (d) toast(`Removed ${d.name}`, () => store.restore('meals', d)); });

// ── logging food: scan (the one Scan button), say it, quick add ───────
export function logFood(prefill) {
  if (prefill?.kind === 'food' || prefill?.fields) return openPlate(prefill);
  if (prefill?.text) return openSay(prefill.text);
  openSheet({ title: 'Log a meal', sub: 'A photo is fastest. Indian portions are understood: katori, roti, glass.', cls: 'bod-sheet', body: `
    <div class="bod-logbar bod-in-sheet">
      <button class="bod-lb" data-act="bod-food-scan"><span class="bod-lb-i">${I.camera}</span><span>Scan a plate</span></button>
      <button class="bod-lb" data-act="bod-food-say"><span class="bod-lb-i">${I.mic}</span><span>Say it</span></button>
      <button class="bod-lb" data-act="bod-food-quick"><span class="bod-lb-i">${I.plus}</span><span>Quick add</span></button>
    </div>
    <div class="sh"><h2>Your usual</h2></div>
    ${quickList()}` });
}
const quickList = () => `<div class="group">${QUICK_FOODS.map((q, i) => `<button class="row bod-quick" data-act="bod-quick-add" data-i="${i}"><span class="rbody"><span class="rtitle">${esc(q.name)}</span><span class="rmeta">${esc(q.unit)} · ${q.kcal} kcal</span></span><span class="rend met">${q.p} g</span><span class="btn sm icon" aria-hidden="true">${I.plus}</span></button>`).join('')}</div>`;
on('bod-food-quick', () => { if (document.querySelector('.sheet.in')) closeSheet(); setTimeout(() => openSheet({ title: 'Quick add', sub: 'Your usual foods, one tap each', cls: 'bod-sheet', body: quickList() }), 60); });
on('bod-quick-add', (b) => {
  const q = QUICK_FOODS[+b.dataset.i];
  store.addMeal({ name: q.name, slot: slotNow(), kcal: q.kcal, protein: q.p, carbs: q.c, fat: q.f, source: 'quick', img: q.img ?? null, items: [{ name: q.name, qty: 1, unit: q.unit, kcal: q.kcal, protein: q.p }] });
  haptic(10); closeSheet(); toast(`Logged ${q.name}: +${q.p} g protein`);
});
on('bod-food-scan', async () => {
  if (document.querySelector('.sheet.in')) closeSheet();
  if (has('scan')) { api.scan('food'); return; }
  if (DEMO_MODE) { setTimeout(() => openPlate(DEMO_PLATE, 'Scanned'), 80); return; }
  // without the shared lens: a photo for the meal, then his words for what is on it
  const r = await native.scan.photo({ source: 'camera', maxSize: 900, quality: 0.7 });
  if (!r.ok) { if (!r.cancelled) openSay(''); return; }
  openSay('', await thumbOf(asDataUrl(r.image, r.mime)));
});
on('bod-food-say', () => { if (document.querySelector('.sheet.in')) closeSheet(); setTimeout(() => openSay(''), 60); });
function openSay(text, photo = null) {
  openSheet({ title: 'Say what you ate', sub: `${AGENT.name} turns it into grams and protein`, cls: 'bod-sheet', body: (el) => {
    el.innerHTML = `${photo ? `<div class="bod-meal-hero">${mealPic({ photo }, 'bod-food-hero')}</div>` : ''}<div class="pad"><label class="field"><input type="text" value="${esc(text)}" placeholder="2 roti, paneer bhurji and a katori of dal" aria-label="What you ate" enterkeyhint="done"></label>
      <p class="foot bod-say-hint">Try "a glass of milk and 2 eggs" or "half plate biryani".</p></div>
      <div class="bod-cta"><button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-say-go">${I.sparkle}Work it out</button></div>`;
    el._photo = photo;
    setTimeout(() => $('input', el)?.focus(), 250);
  } });
}
on('bod-say-go', (b) => {
  const sh = b.closest('.sheet'); const body = $('.sheet-body', sh); const text = $('input', sh)?.value.trim();
  if (!text) { $('input', sh)?.focus(); return; }
  const e = estimate(text);
  if (!e.items.length) { toast(`Didn't recognise that. Try naming the foods: "2 roti and dal"`); return; }
  closeSheet(sh);
  setTimeout(() => openPlate({ kind: 'food', title: e.name, fields: { name: e.name, items: e.items, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat, fibre: e.fibre, unknown: e.unknown }, image: body?._photo ?? null }, 'From your words'), 60);
});

// the result card: photo, what it found, portions you can fix, then where it goes
export async function openPlate(result, how = 'Scanned') {
  const fl = result.fields ?? {}; const items = (fl.items ?? []).map((x) => ({ ...x, q: 1 }));
  const photo = result.image ? await thumbOf(asDataUrl(result.image, result.mime)) : null;
  let slot = ['breakfast', 'lunch', 'snack', 'dinner'].includes(fl.slot) ? fl.slot : slotNow();
  const scale = (k) => items.reduce((a, x) => a + (Number(x[k]) || 0) * x.q, 0);
  const sh = openSheet({ title: fl.name ?? result.title ?? 'Your plate', sub: `${how} · check the portions`, cls: 'bod-sheet', large: true, body: (el) => {
    const draw = () => {
      const p = Math.round(scale('protein')); const k = Math.round(scale('kcal'));
      const ratio = fl.kcal ? k / fl.kcal : 1;
      const carbs = items.some((x) => x.carbs != null) ? Math.round(scale('carbs')) : Math.round((fl.carbs ?? 0) * ratio);
      const fat = items.some((x) => x.fat != null) ? Math.round(scale('fat')) : Math.round((fl.fat ?? 0) * ratio);
      el.innerHTML = `<div class="bod-meal-hero">${mealPic(photo ? { photo } : DEMO_MODE ? { img: 'paneer' } : {}, 'bod-food-hero')}<span class="bod-scan-tag">${I.sparkle}Found ${items.length} ${items.length === 1 ? 'item' : 'items'}</span></div>
        <div class="bod-mealtot"><span><b class="met">${p}</b><small>g protein</small></span><span><b class="met">${k}</b><small>kcal</small></span><span><b class="met">${carbs}</b><small>g carbs</small></span><span><b class="met">${fat}</b><small>g fat</small></span></div>
        <div class="group">${items.map((x, i) => `<div class="row bod-plate-r"><span class="rbody"><span class="rtitle">${esc(x.name)}</span><span class="rmeta">${x.grams ? `${Math.round(x.grams * x.q)} g · ` : ''}${Math.round(x.kcal * x.q)} kcal · ${Math.round(x.protein * x.q)} g protein</span></span>
          <span class="bod-qty"><button class="btn sm icon" data-q="-" data-i="${i}" aria-label="Less ${esc(x.name)}">${I.minus}</button><b class="met">${x.q % 1 ? x.q.toFixed(1) : x.q}×</b><button class="btn sm icon" data-q="+" data-i="${i}" aria-label="More ${esc(x.name)}">${I.plus}</button></span></div>`).join('')}</div>
        ${fl.unknown?.length ? `<p class="foot pad">Not counted: ${esc(fl.unknown.join(', '))}.</p>` : ''}
        ${wyn(proteinLeft() ? `That closes ${Math.min(p, proteinLeft())} of your ${proteinLeft()} g gap.` : 'Protein is already covered today; this one is for the calories.')}
        <div class="bod-slot"><span class="foot">Log it as</span>${seg('bod-slot', [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['snack', 'Snack'], ['dinner', 'Dinner']], slot, 'sm')}</div>
        <div class="bod-cta"><button class="btn primary block" style="--c:var(--as-fill)" data-act="bod-plate-ok">Add to ${slotName(slot).toLowerCase()}</button><button class="btn block" data-act="close-sheet">Not now</button></div>`;
      el._sum = { p, k, carbs, fat, slot };
      wireSegs(el);
    };
    draw();
    el.addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (!b) return; const x = items[+b.dataset.i]; x.q = Math.max(0.5, Math.min(4, x.q + (b.dataset.q === '+' ? 0.5 : -0.5))); haptic(4); draw(); });
    el.addEventListener('change', (e) => { if (!e.target.closest('[data-seg="bod-slot"]')) return; slot = e.detail; el._sum.slot = slot; const ok = $('[data-act="bod-plate-ok"]', el); if (ok) ok.textContent = `Add to ${slotName(slot).toLowerCase()}`; });
  } });
  sh._plate = { result, items, how, photo };
}
on('bod-plate-ok', (b) => {
  const sh = b.closest('.sheet'); const st = sh?._plate; const sum = $('.sheet-body', sh)?._sum; if (!st || !sum) return;
  const fl = st.result.fields ?? {};
  store.addMeal({ name: fl.name ?? st.result.title ?? 'Your plate', slot: sum.slot, kcal: sum.k, protein: sum.p, carbs: sum.carbs, fat: sum.fat,
    fibre: Math.round(st.items.reduce((a, x) => a + (Number(x.fibre) || 0) * x.q, 0)) || null, source: st.how === 'From your words' ? 'say' : 'scan', how: st.how, estimate: true,
    photo: st.photo ?? null, img: !st.photo && DEMO_MODE ? 'paneer' : null,
    items: st.items.map((x) => ({ name: x.name, qty: x.q, grams: x.grams ? Math.round(x.grams * x.q) : null, kcal: Math.round(x.kcal * x.q), protein: Math.round(x.protein * x.q) })) });
  closeSheet(sh); haptic(12);
  toast(`Added to ${slotName(sum.slot).toLowerCase()}: +${sum.p} g protein`);
  if (S.app?.section !== 'fuel') S.app?.go('fuel');
});
/** native.scan answers raw base64; Capture may hand a data URL. Either way, a data URL. */
export const asDataUrl = (img, mime = 'image/jpeg') => (!img ? null : String(img).startsWith('data:') ? String(img) : `data:${mime || 'image/jpeg'};base64,${img}`);
/** A small JPEG of a photo (~160 px) for the meal row: kept with the meal, so it syncs with it. */
export function thumbOf(src, size = 160) {
  return new Promise((res) => {
    if (!src) { res(null); return; }
    const img = new Image();
    img.onload = () => { try { const s = Math.min(1, size / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', 0.7)); } catch { res(null); } };
    img.onerror = () => res(null);
    img.src = src;
  });
}
nav.addGap = addGap; nav.logFood = logFood; nav.openPlate = openPlate;

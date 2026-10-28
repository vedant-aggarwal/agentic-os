// Price on every block: what an hour of each area is worth, typed by you, and what each block today displaces
// (server/modules/price.ts). An area without a rate says "no rate yet" and never shows a number.
// Design: j15/mockup/final/js/more.js PAGES.price (app/ui/STRUCTURE.md, area (d)).
const { AOS } = window;
AOS.css('modules/price.css');

const I = AOS.icons;
const ICON = I.rupee;
const esc = AOS.esc;
const state = { blocks: null, rates: null, error: null, saving: false, loadedAt: 0 };
let pageEl = null, cardEl = null, lastM = null;
const color = (slug) => (slug ? AOS.areas.get(slug)?.color ?? 'var(--ink-3)' : 'var(--ink-3)');
const rupees = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const nowHM = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
const head = (sub) => `<div class="mp-head"><span class="mp-ic" aria-hidden="true">${ICON}</span><h1 class="large-title">Price on every block</h1><p class="sub">${sub}</p></div>`;

async function load(silent = false) {
  if (!silent) state.error = null;
  try {
    const [b, r] = await Promise.all([AOS.api(`/mod/price/blocks?date=${AOS.today}`), AOS.api('/mod/price/rates')]);
    state.blocks = b; state.rates = r; state.loadedAt = Date.now(); state.error = null;
  } catch (e) { state.error = e.message || 'Your PC isn’t reachable right now.'; }
  renderCard(); renderPage();
  figSync();
}
// More's row (app.js modFigure): the highest rate you typed and its area. More redraws when it changes and is on screen
function figure() {
  const r = state.rates;
  if (!r) return null;
  const set = (r.rates ?? []).filter((x) => x.rate_per_hour != null);
  if (!set.length) return { value: '', label: 'No rates yet' };
  const top = set.reduce((a, x) => (x.rate_per_hour > a.rate_per_hour ? x : a));
  return { value: `${rupees(top.rate_per_hour)}/h`, label: set.length === 1 ? `${top.name}, the only rate so far` : `Top rate, ${top.name}` };
}
let figKey = null;
function figSync() {
  const k = JSON.stringify(figure());
  if (k === figKey) return;
  figKey = k;
  const ui = AOS.ui?.();
  if (ui?.tab === 'more' && !ui.stack?.more?.length) AOS.renderTab?.('more');
}

// ── Today card: the blocks still ahead and what each pushes out, once two rates exist ──
function renderCard() {
  if (!cardEl) return;
  const b = state.blocks;
  if (!b?.enough || !lastM?.isToday) { cardEl.innerHTML = ''; return; }
  const now = nowHM();
  const rows = b.blocks.filter((x) => x.displaces && (x.to ?? '') > now).slice(0, 3);
  if (!rows.length) { cardEl.innerHTML = ''; return; }
  cardEl.innerHTML = `<div class="mcard-list">${rows.map((x, i) => `<button class="lrow b-row mcard" data-pr-open aria-label="${esc(`${x.from} ${x.title}: ${x.displaces.text}`)}"><span class="bi">${i ? '' : ICON}</span><span class="rbody"><span class="rtitle"><span class="num">${esc(x.from)}</span> ${esc(x.title)}</span><span class="rmeta"><span class="ell">${esc(x.displaces.text)}</span></span></span>${I.chevR}</button>`).join('')}</div>`;
}

// ── page: the rates you typed, then today's blocks ─────────────────────────
const rateOf = (area) => state.rates?.rates?.find((r) => r.area === area) ?? null;
function ratesHTML() {
  const r = state.rates;
  if (!r) return '';
  const rows = r.rates.map((x) => `<button class="lrow mp-dot pr-rate" data-pr-rate="${esc(x.area)}" aria-label="${esc(x.name)}: ${x.rate_per_hour != null ? `${rupees(x.rate_per_hour)} an hour` : 'no rate yet'}. Edit">
      <span class="dot" style="--c:${color(x.area)}"></span>
      <span class="rbody"><span class="rtitle">${esc(x.name)}</span>${x.note ? `<span class="rmeta"><span class="ell">${esc(x.note)}</span></span>` : ''}</span>
      <span class="rend num${x.rate_per_hour != null ? ' pr-set' : ''}">${x.rate_per_hour != null ? `${rupees(x.rate_per_hour)}/h` : 'No rate yet'}</span>${I.chevR}
    </button>`).join('');
  const more = r.enough ? '' : `<p class="mp-hint">Two rates make a comparison.${r.count === 1 ? ' One more to go.' : ' Tap an area to type what its hour earns.'}</p>`;
  return `<div class="sh"><h2>Rates</h2></div><div class="group">${rows}</div>${more}`;
}
function blockValue(x) {
  if (!x.area) return '<span class="rend pr-none">No area</span>';
  const rate = rateOf(x.area)?.rate_per_hour;
  return rate != null ? `<span class="rend num pr-val">${rupees((rate * x.minutes) / 60)}</span>` : '<span class="rend pr-none">No rate</span>';
}
function blocksHTML() {
  const b = state.blocks;
  if (!b) return '';
  const title = `<div class="sh"><h2>Today’s blocks</h2>${b.blocks.length ? `<span class="sh-count">${b.blocks.length}</span>` : ''}</div>`;
  if (!b.blocks.length) return `${title}<div class="note">No blocks on today’s calendar.</div>`;
  const rows = b.blocks.map((x) => {
    const why = x.displaces ? x.displaces.text : b.enough ? 'Nothing else with a rate has open work' : '';
    return `<div class="lrow mp-dot mp-tall pr-block">
      <span class="dot" style="--c:${color(x.area)}"></span>
      <span class="rbody"><span class="rtitle wrap">${esc(x.title)}</span><span class="rmeta num"><span class="ell">${esc(x.from)}–${esc(x.to)}${x.areaName ? ` · ${esc(x.areaName)}` : ''}</span></span>${why ? `<span class="mp-why">${esc(why)}</span>` : ''}</span>
      ${blockValue(x)}
    </div>`;
  }).join('');
  return `${title}<div class="group">${rows}</div>${b.enough ? '' : '<p class="mp-hint">Once two areas have a rate, each block says what it pushes out.</p>'}`;
}
function renderPage() {
  if (!pageEl?.isConnected) return;
  const sub = 'What an hour of each area is worth, and what each block today pushes out. Nothing here is guessed.';
  let body;
  if (state.error && !state.rates) body = `<div class="note mp-note fail" role="alert"><b>${esc(state.error)}</b><span>Rates and blocks are read on your PC.</span><button class="btn sm" data-pr-reload>Try again</button></div>`;
  else if (!state.rates) body = '<div class="mp-load" role="status"><span class="spin" aria-hidden="true"></span>Reading rates</div>';
  else body = ratesHTML() + blocksHTML();
  pageEl.innerHTML = head(sub) + body;
}

// ── the rate sheet: one area's rupees per hour and where the number comes from ──
let SH = null;
function sheet() {
  if (SH) return SH;
  const el = document.createElement('section');
  el.className = 'sheet pr-sheet mp-sheet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<div class="grabber"></div><div class="sheet-head"></div><div class="sheet-body"></div>';
  (document.getElementById('screen') ?? document.body).appendChild(el);
  const fit = (H) => { const h = el.querySelector('.sheet-head')?.offsetHeight ?? 0, b = el.querySelector('.pr-sb')?.offsetHeight ?? 0; return { large: 0, fit: Math.max(0, Math.round(H - (22 + h + b + 34))) }; };
  SH = { el, s: AOS.makeSheet(el, { detents: fit, scrimFor: (y, H) => Math.min(1, Math.max(0, 1 - y / (H * 0.85))) }) };
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-pr-close]')) SH.s.close();
    const clear = e.target.closest('[data-pr-clear]');
    if (clear) save(clear.dataset.prClear, null, '');
  });
  el.addEventListener('submit', (e) => {
    const f = e.target.closest('[data-pr-form]');
    if (!f) return;
    e.preventDefault();
    const raw = f.rate.value.trim();
    save(f.dataset.prForm, raw === '' ? null : Number(raw), f.note.value);
  });
  return SH;
}
function openRate(area) {
  const x = rateOf(area);
  if (!x) return;
  const { el, s } = sheet();
  el.setAttribute('aria-label', `${x.name} rate`);
  el.querySelector('.sheet-head').innerHTML = `<div class="pr-shead"><div class="pr-shead-t"><h2>${esc(x.name)}</h2><p>What an hour here earns, typed by you</p></div><button class="sheet-close" data-pr-close aria-label="Close">${I.x}</button></div>`;
  const b = el.querySelector('.sheet-body');
  b.innerHTML = `<div class="pr-sb"><form class="pr-form" data-pr-form="${esc(x.area)}">
      <label class="ifield pr-field"><span class="pr-cur" aria-hidden="true">₹</span><input name="rate" type="number" inputmode="decimal" min="0" step="50" value="${x.rate_per_hour ?? ''}" placeholder="No rate yet" aria-label="Rupees per hour" enterkeyhint="done"><span class="pr-unit" aria-hidden="true">an hour</span></label>
      <label class="ifield"><input name="note" type="text" value="${esc(x.note ?? '')}" placeholder="Where the number comes from" aria-label="Where the number comes from" maxlength="200" enterkeyhint="done"></label>
      <button class="btn primary block" type="submit">Save</button>
      ${x.rate_per_hour != null ? `<button class="btn block pr-clear" type="button" data-pr-clear="${esc(x.area)}">Clear the rate</button>` : ''}
    </form></div>`;
  requestAnimationFrame(() => s.open('fit'));
  AOS.haptic('light');
  setTimeout(() => b.querySelector('input[name=rate]')?.focus({ preventScroll: true }), 420);
}
async function save(area, rate, note) {
  if (state.saving || !state.rates) return;
  if (rate != null && !(Number.isFinite(rate) && rate >= 0)) { AOS.toast('Type rupees per hour, like 1200'); return; }
  // the same body as always: the whole list, with this one area changed
  const rates = state.rates.rates.map((x) => (x.area === area ? { area, rate_per_hour: rate, note: note ?? '' } : { area: x.area, rate_per_hour: x.rate_per_hour, note: x.note ?? '' }));
  state.saving = true;
  const btns = SH?.el.querySelectorAll('.pr-form .btn') ?? [];
  btns.forEach((b) => { b.disabled = true; });
  try {
    state.rates = await AOS.api('/mod/price/rates', { method: 'PUT', body: JSON.stringify({ rates }) });
    AOS.haptic('success');
    AOS.toast(rate == null ? 'Rate cleared' : 'Rate saved');
    SH?.s.close();
  } catch (e) { AOS.toast(e.message || 'Could not save'); btns.forEach((b) => { b.disabled = false; }); }
  state.saving = false;
  load(true);
}

AOS.register({
  id: 'price', title: 'Price on every block', order: 30,
  icon: ICON, figure,
  page(el) {
    pageEl = el;
    el.classList.add('pr-page');
    renderPage();
    if (!state.rates || Date.now() - state.loadedAt > 30_000) load();
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-pr-reload]')) { state.error = null; renderPage(); load(); return; }
      const r = e.target.closest('[data-pr-rate]');
      if (r) openRate(r.dataset.prRate);
    });
  },
  cards: {
    todayTop(el, m) {
      cardEl = el; lastM = m;
      renderCard();
      el.onclick = (e) => { if (e.target.closest('[data-pr-open]')) { AOS.haptic('light'); AOS.openPage('price'); } };
    },
  },
  onData() { load(true); },
});
load(true);

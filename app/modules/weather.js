// Week weather: a forecast of the week from your own history, no LLM in the numbers (server/modules/weather.ts).
// Today card: the one line that matters. Page: the headline beside the heaviest day's ring, load per day as rings,
// the odds per project and dated task, the three changes that move the numbers most (pencilled in until you keep
// them), and the standing blocks. Design: j15/mockup/final/js/more.js PAGES.weather (app/ui/STRUCTURE.md, area (d)).
const { AOS } = window;
AOS.css('modules/weather.css');

const I = AOS.icons;
const esc = AOS.esc;
const ICON = I.cloud;
const state = { week: 'default', fc: null, error: null, busy: false, loadedAt: 0, acting: new Set() };
let pageEl = null, cardEl = null, lastM = null, drawn = null;
const pct = (p) => (p == null ? '' : `${Math.round(p * 100)}%`);
const color = (slug) => AOS.areas.get(slug)?.color ?? 'var(--a-none)';
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (d) => { const x = new Date(`${d}T00:00:00Z`); return `${WD[x.getUTCDay()]} ${x.getUTCDate()}`; };
const weekLabel = (fc) => (fc?.from && fc?.to ? `${dayLabel(fc.from)} – ${dayLabel(fc.to)}` : '');
const taskTitle = (id) => AOS.data().tasks.find((t) => t.id === id)?.title ?? id;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? `${one}s`}`;
const word = (text, c) => `<span class="mp-st" style="--c:${c}">${esc(text)}</span>`;
const SPIN = '<span class="spin" aria-hidden="true"></span>';
// odds read in the semantic set: red at risk, orange needs you, green on track
const oddsColor = (p, low = 0.5, mid = 0.8) => (p < low ? 'var(--fail-ink)' : p < mid ? 'var(--needs-ink)' : 'var(--done)');
const odds = (p, low, mid) => (p == null ? '' : `<span class="pill num wx-odds" style="--c:${oddsColor(p, low, mid)}">${pct(p)}</span>`);

async function load(silent = false) {
  if (!silent) state.error = null;
  try {
    state.fc = await AOS.api(`/mod/weather/forecast?week=${state.week}`);
    state.loadedAt = Date.now();
    state.error = null;
  } catch (e) {
    state.error = e.message || 'Your PC isn’t reachable right now.';
  }
  renderCard(); renderPage();
  figSync();
}
// More's row (app.js modFigure): the fullest day still ahead. More redraws when it changes and is on screen
function figure() {
  const fc = state.fc;
  if (!fc) return null;
  if (!fc.run) return { value: '', label: 'No forecast yet' };
  const peak = (fc.days ?? []).filter((d) => !d.past).reduce((a, d) => (!a || d.load > a.load ? d : a), null);
  return peak ? { value: `${peak.load}%`, label: `${peak.weekday} is the fullest day` } : { value: '', label: weekLabel(fc) };
}
let figKey = null;
function figSync() {
  const k = JSON.stringify(figure());
  if (k === figKey) return;
  figKey = k;
  const ui = AOS.ui?.();
  if (ui?.tab === 'more' && !ui.stack?.more?.length) AOS.renderTab?.('more');
}
async function run(force = true) {
  state.busy = true; renderPage();
  try { state.fc = await AOS.api('/mod/weather/run', { method: 'POST', body: JSON.stringify({ week: state.week, force }) }); state.error = null; AOS.haptic('success'); }
  catch (e) { AOS.toast(e.message || 'The forecast couldn’t run'); }
  state.busy = false; renderCard(); renderPage();
}

// ── card: a row of Today's brief ────────────────────────────────────────────
function renderCard() {
  if (!cardEl) return;
  const fc = state.fc;
  if (!fc?.headline) { cardEl.innerHTML = ''; return; }
  cardEl.innerHTML = `<button class="lrow b-row mcard mp-tall" data-wx-open aria-label="Week weather: ${esc(fc.headline)}"><span class="bi">${ICON}</span><span class="rbody"><span class="rtitle wrap">${esc(fc.headline)}</span><span class="rmeta"><span class="ell">Week weather · ${esc(weekLabel(fc))}</span></span></span>${I.chevR}</button>`;
}

// ── page ────────────────────────────────────────────────────────────────────
const head = () => `<div class="mp-head"><span class="mp-ic" aria-hidden="true">${ICON}</span><h1 class="large-title">Week weather</h1><p class="sub">The week you’ll actually have, from your own history. No model touches the numbers.</p></div>`;
function heroHTML(fc) {
  const days = fc.days.filter((d) => !d.past);
  const peak = (days.length ? days : fc.days).reduce((a, d) => (!a || d.load > a.load ? d : a), null);
  const ring = peak ? `<div class="wx-peak">${AOS.ring(peak.load / 100, 'today', 96, 12, { inner: `<b class="met wx-peak-n">${peak.load}<small>%</small></b>`, label: `${peak.weekday} is booked to ${peak.load}% of its waking hours` })}<span class="wx-peak-d">${esc(peak.weekday)}</span></div>` : '';
  return `<section class="mp-card wx-hero"><div class="wx-hero-t"><p class="mp-k">${esc(weekLabel(fc))}</p><p class="wx-headline">${esc(fc.headline)}</p>${peak ? `<p class="foot">The heaviest day is ${esc(peak.weekday)}: ${peak.load}% of its waking hours booked or due.</p>` : ''}</div>${ring}</section>`;
}
function loadHTML(fc) {
  if (!fc.days.length) return '';
  const cols = fc.days.map((d) => `<div class="wx-day${d.past ? ' past' : ''}${d.load > 100 ? ' over' : ''}">${AOS.ring(d.load / 100, 'today', 40, 6, { label: `${d.weekday}: ${d.load}% booked${d.past ? ', past' : ''}` })}<b>${esc(d.weekday)}</b><span class="met">${d.load}%</span></div>`).join('');
  return `<div class="sh"><h2>Load per day</h2></div><section class="mp-card wx-load"><div class="wx-days" style="--n:${fc.days.length}">${cols}</div><p class="foot wx-load-f">A full ring is a day booked to every waking hour: blocks plus the work due that day. Past days are dimmed.</p></section>`;
}
function projectsHTML(fc) {
  if (!fc.projects.length) return `<div class="sh"><h2>Projects</h2></div><div class="note">No project has two or more open tasks this week.</div>`;
  const rows = [...fc.projects].sort((a, b) => a.probability - b.probability).map((p) => `<div class="lrow mp-dot"><span class="dot" style="--c:${color(p.area)}"></span><span class="rbody"><span class="rtitle">${esc(p.name)}</span><span class="rmeta"><span class="ell">${plural(p.tasks, 'task')}${p.due ? ` · ships by ${esc(dayLabel(p.due))}` : ''}</span></span></span>${odds(p.probability)}</div>`).join('');
  return `<div class="sh"><h2>Projects</h2><span class="sh-count">${fc.projects.length}</span></div><div class="group">${rows}</div>`;
}
function tasksHTML(fc) {
  const list = fc.tasks.filter((t) => t.due && t.due <= fc.to).sort((a, b) => a.probability - b.probability || (a.due < b.due ? -1 : 1));
  if (!list.length) return `<div class="sh"><h2>Dated tasks</h2></div><div class="note">Nothing dated this week.</div>`;
  const rows = list.map((t) => `<div class="lrow mp-dot"><span class="dot" style="--c:${color(t.area)}"></span><span class="rbody"><span class="rtitle">${esc(t.title)}</span><span class="rmeta">${t.late ? `${word(`Was due ${dayLabel(t.due)}`, 'var(--fail-ink)')}<span>·</span>` : ''}<span class="ell">${t.late ? '' : `Due ${esc(dayLabel(t.due))} · `}~${t.minutes} min</span></span></span>${odds(t.probability)}</div>`).join('');
  return `<div class="sh"><h2>Dated tasks</h2><span class="sh-count">${list.length}</span></div><div class="group">${rows}</div>`;
}
// a change starts as a suggestion (Pencil in), becomes a pencilled row (Keep or Remove), then is kept
function changesHTML(fc) {
  const pending = (fc.pending ?? []).filter((p) => p.status === 'open');
  const applied = (fc.pending ?? []).filter((p) => p.status === 'kept');
  const pendingBy = new Map(pending.map((p) => [p.taskId, p]));
  const doneBy = new Set(applied.map((p) => p.taskId));
  const dis = (k) => (state.acting.has(k) ? 'disabled' : '');
  const decideBtns = (p) => `<div class="mp-racts"><button class="btn sm" data-wx-keep="${esc(p.batchId)}" data-pid="${esc(p.pid)}" ${dis(p.pid)}>${I.check}Keep</button><button class="btn sm" data-wx-remove="${esc(p.batchId)}" data-pid="${esc(p.pid)}" ${dis(p.pid)}>Remove</button></div>`;
  const items = fc.changes.map((c, i) => {
    const tid = c.proposal?.taskId;
    const p = pendingBy.get(tid);
    const kept = doneBy.has(tid);
    const status = kept ? word('Kept', 'var(--done)') : p ? word('Pencilled in', 'var(--needs-ink)') : '';
    const pen = !kept && !p ? `<div class="mp-racts"><button class="btn sm wx-pen" data-wx-pencil="${i}" ${dis(`c${i}`)}>${state.acting.has(`c${i}`) ? SPIN : I.edit}Pencil in</button></div>` : '';
    return `<div class="lrow mp-tall wx-chg${kept ? ' kept' : ''}"><span class="wx-n num" aria-hidden="true">${i + 1}</span><div class="rbody"><span class="wx-line">${esc(c.line)}</span>${status ? `<span class="rmeta">${status}</span>` : ''}${p && !kept ? decideBtns(p) : pen}</div></div>`;
  });
  // pencilled rows from earlier runs whose change is no longer in the top three still need an answer
  for (const p of pending) if (!fc.changes.some((c) => c.proposal?.taskId === p.taskId))
    items.push(`<div class="lrow mp-tall wx-chg"><span class="wx-n" aria-hidden="true">${I.edit}</span><div class="rbody"><span class="wx-line">${esc(p.reason || p.summary || taskTitle(p.taskId))}</span><span class="rmeta">${word('Pencilled in earlier', 'var(--needs-ink)')}</span>${decideBtns(p)}</div></div>`);
  if (!items.length) return `<div class="sh"><h2>Three changes that move it most</h2></div><div class="note">No change would move the numbers much.</div>`;
  return `<div class="sh"><h2>${fc.changes.length ? 'Three changes that move it most' : 'Pencilled in'}</h2></div><div class="group wx-chgs">${items.join('')}</div>
    <p class="mp-hint">Pencil in puts the change on your calendar as a suggestion. Keep applies it and the forecast runs again.</p>`;
}
function blocksHTML(fc) {
  if (!fc.blocks.length) return `<div class="sh"><h2>Standing blocks</h2></div><div class="note">No standing blocks this week.</div>`;
  const rows = fc.blocks.map((b) => `<div class="lrow mp-dot"><span class="dot" style="--c:${color(b.area)}"></span><span class="rbody"><span class="rtitle">${esc(b.title)}</span><span class="rmeta"><span class="ell">${esc(b.days.join(' '))}${b.basis === 'history' ? ` · skipped ${b.misses} of ${b.occurrences}` : ' · no history yet'}</span></span></span>${odds(b.probability, 0.6, 0.85)}</div>`).join('');
  return `<div class="sh"><h2>Standing blocks</h2><span class="sh-count">${fc.blocks.length}</span></div><div class="group">${rows}</div>`;
}
function basisHTML(fc) {
  const b = fc.basis;
  if (!b) return '';
  const made = fc.run ? new Date(fc.run.createdAt).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', hour12: false, timeZone: 'Asia/Kolkata' }) : '';
  return `<p class="mp-hint">From ${plural(b.doneWithTimes, 'timed task')}: work runs ×${Math.exp(b.overrun?.mu ?? 0).toFixed(2)} its estimate${b.overrun?.n ? '' : ' (a prior until you time tasks)'}. ${fc.summary?.draws ?? '1,000'} draws${made ? `, made ${esc(made)}` : ''}${fc.wordedBy === 'Haiku' ? '. Haiku words the changes; the numbers are the simulation’s' : ''}.</p>`;
}
function renderPage() {
  if (!pageEl?.isConnected) return;
  const fc = state.fc;
  // the server picks the week ahead by default (next week once Sunday comes); the switch follows what it chose
  const showing = fc?.week ? (fc.week > AOS.today ? 'next' : 'this') : state.week === 'next' ? 'next' : 'this';
  const seg = `<div class="wx-seg">${AOS.seg('wx-week', [['this', 'This week'], ['next', 'Next week']], showing, { role: 'tab', label: 'Week' })}</div>`;
  let body;
  if (state.error && !fc) body = `<div class="note mp-note fail" role="alert"><b>${esc(state.error)}</b><span>The forecast runs on your PC.</span><button class="btn sm" data-wx-retry>Try again</button></div>`;
  else if (!fc) body = `<div class="mp-load" role="status">${SPIN}Reading the week</div>`;
  else if (!fc.run) {
    const which = showing === 'next' ? 'next week' : 'this week';
    body = `<section class="mp-card"><p class="mp-k">${showing === 'next' ? 'Next week' : 'This week'}${fc.week ? ` · from ${esc(dayLabel(fc.week))}` : ''}</p><p class="t2">No forecast yet</p><p class="mp-text">It runs every hour when something changes${showing === 'next' ? ', and for next week from Saturday evening' : ''}. Or run it now.</p>
      <div class="mp-acts"><button class="btn sm primary" data-wx-run ${state.busy ? 'disabled' : ''}>${state.busy ? `${SPIN}Simulating` : `${I.play}Forecast ${which}`}</button></div></section>`;
  } else {
    body = `${heroHTML(fc)}${loadHTML(fc)}${projectsHTML(fc)}${tasksHTML(fc)}${changesHTML(fc)}${blocksHTML(fc)}${basisHTML(fc)}
      <div class="mp-foot"><button class="btn block" data-wx-run ${state.busy ? 'disabled' : ''}>${state.busy ? `${SPIN}Simulating` : `${I.sync}Run again`}</button></div>`;
  }
  pageEl.innerHTML = head() + seg + body;
  // the rings arrive after the page opened (or with another week): draw them in once per forecast
  const key = fc?.run?.id ?? null;
  if (key && drawn !== `${key}:${fc.week}`) { drawn = `${key}:${fc.week}`; AOS.pulse(pageEl); }
}

async function decide(batchId, pid, keep) {
  AOS.haptic('light');
  state.acting.add(pid); renderPage();
  try {
    const r = await AOS.api('/mod/weather/decide', { method: 'POST', body: JSON.stringify({ batchId, week: state.week, ...(keep ? { kept: [pid] } : { removed: [pid] }) }) });
    if (keep && r.applied?.length) {
      AOS.toast(`Applied: ${r.applied.map((a) => a.title).join(', ').slice(0, 60)}`, async () => {
        try { await AOS.api('/mod/weather/undo', { method: 'POST', body: JSON.stringify({ applied: r.applied }) }); AOS.refresh(true); load(true); } catch (e) { AOS.toast(e.message || 'Undo failed'); }
      });
      AOS.refresh(true);
    } else if (keep && r.failed?.length) AOS.toast(r.failed[0].error);
    else if (!keep) AOS.toast('Removed. The calendar stays as it was');
  } catch (e) { AOS.toast(e.message || 'Couldn’t record that'); }
  state.acting.delete(pid);
  load(true);
}
async function pencil(i) {
  const c = state.fc?.changes?.[i];
  if (!c) return;
  AOS.haptic('light');
  state.acting.add(`c${i}`); renderPage();
  try { await AOS.api('/mod/weather/apply', { method: 'POST', body: JSON.stringify({ week: state.week, change: c }) }); }
  catch (err) { AOS.toast(err.message || 'Couldn’t pencil that in'); }
  state.acting.delete(`c${i}`);
  load(true);
}

AOS.register({
  id: 'weather', title: 'Week weather', order: 20,
  icon: ICON, figure,
  page(el) {
    pageEl = el;
    drawn = state.fc?.run ? `${state.fc.run.id}:${state.fc.week}` : null;   // the push draws what is already here
    renderPage();
    if (!state.fc || Date.now() - state.loadedAt > 30_000) load();
    el.addEventListener('segchange', (e) => {
      if (e.target.dataset?.seg !== 'wx-week') return;
      state.week = e.detail; state.fc = null; renderPage(); load();
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.matches('[data-wx-retry]')) { state.error = null; renderPage(); load(); return; }
      if (b.matches('[data-wx-run]')) { run(true); return; }
      if (b.matches('[data-wx-pencil]')) { pencil(Number(b.dataset.wxPencil)); return; }
      if (b.matches('[data-wx-keep]')) decide(b.dataset.wxKeep, b.dataset.pid, true);
      else if (b.matches('[data-wx-remove]')) decide(b.dataset.wxRemove, b.dataset.pid, false);
    });
  },
  cards: {
    todayTop(el, m) {
      cardEl = el; lastM = m;
      renderCard();
      el.onclick = (e) => { if (e.target.closest('[data-wx-open]')) { AOS.haptic('light'); AOS.openPage('weather'); } };
    },
  },
  onData() { load(true); },
});
load(true);

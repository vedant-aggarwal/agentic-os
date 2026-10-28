// The Cabinet: every area's advocate argues for next week; the referee pencils blocks in and leaves conflicts
// for you to tap (server/modules/cabinet.ts). Page: the sitting's state, the plan per area, conflicts to answer,
// the blocks to keep or remove, then the transcript. Today card on Saturday evening and Sunday.
// Design: j15/mockup/final/js/more.js PAGES.cabinet and css/screens/more.css (app/ui/STRUCTURE.md, area (d)).
const { AOS } = window;
AOS.css('modules/cabinet.css');

const I = AOS.icons;
const esc = AOS.esc;
const ICON = I.people;
const state = { cur: null, error: null, busy: false, loadedAt: 0 };
let pageEl = null, cardEl = null, lastM = null, poll = null;
const color = (slug) => AOS.areas.get(slug)?.color ?? 'var(--a-none)';
const areaName = (slug) => AOS.areas.get(slug)?.name ?? slug ?? 'No area';
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d) => { const x = new Date(`${d}T00:00:00Z`); return `${WD[x.getUTCDay()]} ${x.getUTCDate()}`; };
// "19 – 25 Oct", or "26 Oct – 1 Nov" across a month
function weekText(c) {
  if (!c?.from || !c?.to) return 'next week';
  const a = new Date(`${c.from}T00:00:00Z`), b = new Date(`${c.to}T00:00:00Z`);
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()} – ${b.getUTCDate()} ${MON[b.getUTCMonth()]}` : `${a.getUTCDate()} ${MON[a.getUTCMonth()]} – ${b.getUTCDate()} ${MON[b.getUTCMonth()]}`;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? `${one}s`}`;
const hours = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`; };
const when = (iso) => new Date(iso).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', hour12: false, timeZone: 'Asia/Kolkata' });
const word = (text, c) => `<span class="mp-st" style="--c:${c}">${esc(text)}</span>`;
const SPIN = '<span class="spin" aria-hidden="true"></span>';
// an advocate's case in one line: the first sentence of what it said
const firstSentence = (t) => { const s = String(t ?? '').trim(); const m = s.match(/^.+?[.!?](?=\s|$)/); return (m ? m[0] : s).slice(0, 180); };
const session = () => state.cur?.session ?? null;
const running = () => !!session()?.running || session()?.status === 'open';
const canSit = () => AOS.user?.role === 'owner';
// the page shows next week's sitting, or this week's once that one has settled; Run always convenes next week
const isNext = () => (state.cur?.week ?? '') > AOS.today;

async function load(silent = false) {
  if (!silent) state.error = null;
  try {
    let cur = await AOS.api('/mod/cabinet/sessions/current?week=next');
    // Mid-week, the session that settled last Sunday is the one that matters.
    if (!cur.session && cur.weekday !== 'sun' && cur.weekday !== 'sat') { const t = await AOS.api('/mod/cabinet/sessions/current?week=this'); if (t.session) cur = t; }
    state.cur = cur;
    state.loadedAt = Date.now();
    state.error = null;
  } catch (e) { state.error = e.message || 'Your PC isn’t reachable right now.'; }
  renderCard(); renderPage();
  schedulePoll();
  figSync();
}
// More's row (app.js modFigure): what the Cabinet wants from you now. More redraws when it changes and is on screen
function figure() {
  const c = state.cur, s = session();
  if (!c) return null;
  if (running() || state.busy) return { value: '', label: 'Sitting now' };
  if (s?.status === 'failed') return { value: '', label: 'Couldn’t settle the week' };
  if (s) {
    const conflicts = (c.conflicts ?? []).filter((x) => x.status === 'open').length;
    if (conflicts) return { value: conflicts, label: conflicts === 1 ? 'Conflict to settle' : 'Conflicts to settle' };
    const open = (c.blocks ?? []).filter((b) => b.status === 'open').length;
    if (open) return { value: open, label: open === 1 ? 'Block to keep or remove' : 'Blocks to keep or remove' };
    return { value: '', label: `Settled for ${weekText(c)}` };
  }
  return { value: '', label: 'Sits Sunday at 20:00' };
}
let figKey = null;
function figSync() {
  const k = JSON.stringify(figure());
  if (k === figKey) return;
  figKey = k;
  const ui = AOS.ui?.();
  if (ui?.tab === 'more' && !ui.stack?.more?.length) AOS.renderTab?.('more');
}
function schedulePoll() {
  clearTimeout(poll);
  if (running() && (pageEl?.isConnected || cardEl?.isConnected)) poll = setTimeout(() => load(true), 4000);
}
async function run() {
  if (state.busy) return;
  state.busy = true; renderPage(); renderCard();
  try { await AOS.api('/mod/cabinet/run', { method: 'POST', body: JSON.stringify({ week: 'next' }) }); AOS.haptic('medium'); }
  catch (e) { AOS.toast(e.message || 'The cabinet couldn’t sit'); }
  state.busy = false;
  load(true);
}

// ── card: a row of Today's brief, Saturday evening and Sunday (or while next week's sitting is open) ──
function renderCard() {
  if (!cardEl) return;
  const m = lastM;
  const dow = m?.date ? new Date(`${m.date}T00:00:00Z`).getUTCDay() : -1;
  const show = m?.isToday && (dow === 0 || (dow === 6 && m.now >= 18 * 60));
  const s = session();
  if (!show && !(s && s.week > AOS.today && s.status !== 'failed')) { cardEl.innerHTML = ''; return; }
  let text, sub;
  const sitting = running() || state.busy;
  if (sitting) { text = 'The cabinet is sitting'; sub = 'The advocates are speaking; the referee settles the week in a minute or two.'; }
  else if (s && (s.status === 'settled' || s.status === 'applied')) {
    text = `Cabinet: ${plural(s.blocks, 'block')}, ${plural(s.conflicts, 'conflict')}`;
    const left = s.blocks - s.kept;
    sub = s.open_conflicts ? `${s.open_conflicts} to answer, then ${left} to keep or remove` : left ? `${plural(left, 'block')} waiting for you` : 'Everything is kept';
  } else if (s?.status === 'failed') { text = 'The cabinet couldn’t settle'; sub = s.error || 'Try again.'; }
  else { text = 'The cabinet sits at 20:00'; sub = 'Your areas argue for next week; you see only what they couldn’t settle.'; }
  // the line under the title may take a second line beside the button rather than clip what is waiting
  const words = `<span class="bi">${ICON}</span><span class="rbody"><span class="rtitle wrap">${esc(text)}</span><span class="mp-why">${esc(sub)}</span></span>`;
  // the words open the page; the one action (sit now) is its own button at the end of the row
  cardEl.innerHTML = canSit() && !sitting
    ? `<div class="lrow b-row mcard mp-tall cb-card"><button class="cb-card-main" data-cb-open aria-label="The Cabinet: ${esc(text)}. ${esc(sub)}">${words}</button><button class="btn sm mc-act" data-cb-run>${s && s.status !== 'failed' ? 'Sit again' : 'Run now'}</button></div>`
    : `<button class="lrow b-row mcard mp-tall" data-cb-open aria-label="The Cabinet: ${esc(text)}. ${esc(sub)}">${words}${sitting ? SPIN : I.chevR}</button>`;
}

// ── page ────────────────────────────────────────────────────────────────────
const head = () => `<div class="mp-head"><span class="mp-ic" aria-hidden="true">${ICON}</span><h1 class="large-title">The Cabinet</h1><p class="sub">Your areas argue for next week’s hours. You see only what they couldn’t settle.</p></div>`;
const kicker = (c) => `${isNext() ? 'Next week' : 'This week'} · ${esc(weekText(c))}`;
const runBtn = (label, primary = false) => (canSit() ? `<button class="btn sm${primary ? ' primary' : ''}" data-cb-run ${state.busy ? 'disabled' : ''}>${state.busy ? `${SPIN}Convening` : `${primary ? I.play : I.sparkle}${label}`}</button>` : '');
function stateCard(c, s) {
  if (!s) {
    return `<section class="mp-card cb-state"><p class="mp-k">${kicker(c)}</p><p class="t2">No sitting yet</p>
      <p class="mp-text">It sits by itself on Sunday at 20:00. Each area makes its case from its goals, late tasks and last week’s hours.</p>
      ${canSit() ? `<div class="mp-acts">${runBtn('Run now', true)}</div>` : ''}</section>`;
  }
  if (running()) {
    const n = c.turns.filter((t) => t.advocate !== 'referee').length;
    return `<section class="mp-card cb-state" role="status"><p class="mp-k">Sitting now · ${esc(weekText(c))}</p>
      <p class="t2 cb-sitting">${SPIN}<span>${n ? `${plural(n, 'advocate')} spoke; the referee is settling the week` : 'The advocates are speaking'}</span></p>
      <p class="mp-text">This takes a minute or two. The page fills in as they finish.</p></section>`;
  }
  if (s.status === 'failed') {
    return `<section class="mp-card cb-state"><p class="mp-k">${kicker(c)}</p><p class="t2">The cabinet couldn’t settle</p>
      <p class="mp-text">${esc(s.error || 'Unknown error')}.</p>${canSit() ? `<div class="mp-acts">${runBtn('Try again')}</div>` : ''}</section>`;
  }
  const open = c.blocks.filter((b) => b.status === 'open').length;
  const t2 = s.open_conflicts ? `${plural(s.open_conflicts, 'conflict')} to answer` : open ? `${plural(open, 'block')} to keep or remove` : 'Everything is decided';
  return `<section class="mp-card cb-state"><p class="mp-k">${kicker(c)}</p><p class="t2">${esc(t2)}</p>
    ${s.summary ? `<p class="mp-text cb-sum">${esc(s.summary)}</p>` : ''}
    <div class="mp-acts">${runBtn(isNext() ? 'Sit again' : 'Sit for next week')}${c.turns.length ? '<button class="btn sm" data-cb-transcript>Transcript</button>' : ''}</div></section>`;
}
// what each area got: the hours the referee placed for it (blocks not removed), and its case in one line
function planHTML(c) {
  const by = new Map();
  for (const b of c.blocks) if (b.status !== 'removed') by.set(b.area, (by.get(b.area) ?? 0) + (Number(b.minutes) || 0));
  const said = new Map(c.turns.filter((t) => t.advocate && t.advocate !== 'referee').map((t) => [t.advocate, t]));
  const areas = [...new Set([...by.keys(), ...said.keys()])].filter(Boolean).sort((a, b) => (by.get(b) ?? 0) - (by.get(a) ?? 0));
  if (!areas.length) return '';
  const rows = areas.map((a) => {
    const why = firstSentence(said.get(a)?.text);
    return `<div class="lrow ic mp-tall cb-ask"><span class="tile mp-aglyph" style="--t:${color(a)}">${AOS.areaIcons?.[a] ?? I.grid}</span><span class="rbody"><span class="rtitle">${esc(areaName(a))}</span>${why ? `<span class="mp-why">${esc(why)}</span>` : ''}</span><b class="met mp-v">${by.get(a) ? hours(by.get(a)) : '0h'}</b></div>`;
  }).join('');
  return `<div class="sh"><h2>The plan for ${esc(weekText(c))}</h2></div><div class="group cb-plan">${rows}</div>`;
}
function conflictsHTML(c) {
  const open = c.conflicts.filter((x) => x.status === 'open');
  const done = c.conflicts.filter((x) => x.status !== 'open');
  if (!open.length && !done.length) return '';
  const who = (x) => (x.advocates?.length ? `<p class="cb-who">${x.advocates.map((a) => `<span><i class="dot" style="--c:${color(a)}"></i>${esc(areaName(a))}</span>`).join('')}</p>` : '');
  const can = canSit() && !state.busy && !running();
  const openHTML = open.map((x) => `<div class="cb-conf"><p class="cb-q">${esc(x.question)}</p>${who(x)}
    <div class="cb-opts" role="group" aria-label="${esc(x.question)}">${(x.options ?? []).map((o, i) => `<button class="cb-opt" data-cb-choice="${esc(x.id)}" data-i="${i}" ${can ? '' : 'disabled'}><span class="cb-opt-l">${esc(o.label)}</span>${o.consequence ? `<span class="cb-opt-c">${esc(o.consequence)}</span>` : ''}</button>`).join('')}</div></div>`).join('');
  const doneHTML = done.map((x) => `<div class="cb-conf done"><p class="cb-q">${esc(x.question)}</p><p class="cb-chosen">${I.check}<span>${esc(x.choice?.label ?? x.reason ?? '')}</span></p>${x.choice?.consequence ? `<p class="mp-why">${esc(x.choice.consequence)}</p>` : ''}</div>`).join('');
  return `<div class="sh"><h2>${open.length ? 'Conflicts' : 'Conflicts settled'}</h2>${open.length ? `<span class="sh-count">${open.length}</span>` : ''}</div>
    <div class="group cb-confs">${openHTML}${doneHTML}</div>
    ${open.length ? '<p class="mp-hint">Your answer goes back to the referee, who settles the week again around it.</p>' : ''}`;
}
function blocksHTML(c) {
  if (!c.blocks.length) return `<div class="sh"><h2>Blocks</h2></div><div class="note">${c.session.status === 'settled' ? 'The referee placed nothing: no ask fitted a free gap.' : 'No blocks yet.'}</div>`;
  const open = c.blocks.filter((b) => b.status === 'open');
  const rows = c.blocks.map((b) => {
    const st = b.status;
    const w = st === 'open' ? word('Pencilled in', 'var(--needs-ink)') : st === 'kept' ? word('Kept', 'var(--done)') : word('Removed', 'var(--ink-3)');
    const meta = `${dayLabel(b.date)} · ${b.start}–${b.end}${b.where ? ` · in ${b.where}` : ''}${b.taskId ? '' : ' · a new task'}`;
    const acts = st === 'open' && canSit() ? `<div class="mp-racts"><button class="btn sm" data-cb-keep="${esc(b.pid)}">${I.check}Keep</button><button class="btn sm" data-cb-remove="${esc(b.pid)}">Remove</button></div>` : '';
    return `<div class="lrow mp-dot mp-tall cb-block${st === 'removed' ? ' mp-off' : ''}"><span class="dot" style="--c:${color(b.area)}"></span>
      <div class="rbody"><span class="rtitle wrap">${esc(b.title)}</span><span class="rmeta">${w}<span>·</span><span class="ell">${esc(meta)}</span></span>${b.why ? `<span class="mp-why">${esc(b.why)}</span>` : ''}${acts}</div></div>`;
  }).join('');
  const keepAll = open.length > 1 && canSit() ? `<button class="sh-act" data-cb-keep-all>Keep all ${open.length}</button>` : '';
  return `<div class="sh"><h2>Blocks</h2><span class="sh-count">${c.blocks.length}</span>${keepAll}</div><div class="group cb-blocks">${rows}</div>
    <p class="mp-hint">Keep moves the task into that slot on your calendar. You can undo a keep from the toast.</p>`;
}
function transcriptHTML(c, open = false) {
  if (!c.turns.length) return '';
  const list = (label, xs) => (xs?.length ? `<p class="cb-tlab">${label}</p><ul class="cb-list">${xs.join('')}</ul>` : '');
  const turns = c.turns.map((t) => {
    if (t.advocate === 'referee') return `<div class="cb-turn"><p class="cb-turn-who"><b>Referee</b>${t.round > 2 ? `<span>· round ${t.round - 1}</span>` : ''}</p><p class="cb-turn-t">${esc(t.text)}</p>${t.dropped?.length ? `<p class="mp-why">Couldn’t place: ${esc(t.dropped.join('; '))}</p>` : ''}</div>`;
    const asks = (t.asks ?? []).map((a) => `<li>${esc(a.title)} · ${a.minutes} min${a.day && a.day !== 'any' ? ` · ${esc(a.day)}` : ''}${a.why ? `. ${esc(a.why)}` : ''}</li>`);
    return `<div class="cb-turn"><p class="cb-turn-who"><i class="dot" style="--c:${color(t.advocate)}"></i><b>${esc(areaName(t.advocate))}</b>${t.model && t.model !== 'Sonnet' ? `<span>· ${esc(t.model)}</span>` : ''}</p><p class="cb-turn-t">${esc(t.text)}</p>
      ${list('Asks', asks)}${list('Concedes', (t.concedes ?? []).map((s) => `<li>${esc(s)}</li>`))}${list('Evidence', (t.evidence ?? []).map((s) => `<li>${esc(s)}</li>`))}</div>`;
  }).join('');
  return `<details class="group mp-more cb-tx" id="cbTranscript"${open ? ' open' : ''}><summary class="lrow"><span class="rbody"><span class="rtitle">Transcript</span><span class="rmeta">${plural(c.turns.length, 'turn')}</span></span><span class="mp-caret" aria-hidden="true">${I.chevD}</span></summary><div class="cb-turns">${turns}</div></details>`;
}
function renderPage() {
  if (!pageEl?.isConnected) return;
  const c = state.cur, s = session();
  const keep = pageEl.querySelector('#cbTranscript')?.open;
  let body;
  if (state.error && !c) body = `<div class="note mp-note fail" role="alert"><b>${esc(state.error)}</b><span>The Cabinet sits on your PC.</span><button class="btn sm" data-cb-retry>Try again</button></div>`;
  else if (!c) body = `<div class="mp-load" role="status">${SPIN}Asking your PC</div>`;
  else if (!s) body = stateCard(c, s);
  else if (running()) body = stateCard(c, s) + transcriptHTML(c, true);
  else if (s.status === 'failed') body = stateCard(c, s) + transcriptHTML(c, keep);
  else body = `${stateCard(c, s)}${planHTML(c)}${conflictsHTML(c)}${blocksHTML(c)}${transcriptHTML(c, keep)}
    <p class="mp-hint">${esc([s.model, s.ms ? `${Math.round(s.ms / 1000)} s of model time` : '', s.settled_at ? `settled ${when(s.settled_at)}` : ''].filter(Boolean).join(' · '))}</p>`;
  pageEl.innerHTML = head() + body;
}

async function decide(kept, removed) {
  const s = session();
  if (!s) return;
  AOS.haptic('light');
  try {
    const r = await AOS.api(`/mod/cabinet/sessions/${s.id}/decide`, { method: 'POST', body: JSON.stringify({ kept, removed }) });
    if (r.applied?.length) {
      AOS.toast(`Kept ${plural(r.applied.length, 'block')}`, async () => {
        try { await AOS.api(`/mod/cabinet/sessions/${s.id}/undo`, { method: 'POST', body: JSON.stringify({ applied: r.applied }) }); AOS.refresh(true); load(true); } catch (e) { AOS.toast(e.message || 'Undo failed'); }
      });
      AOS.refresh(true);
    } else if (r.failed?.length) AOS.toast(r.failed[0].error);
    else if (removed.length) AOS.toast(`Removed ${plural(removed.length, 'block')}`);
  } catch (e) { AOS.toast(e.message || 'Couldn’t record that'); }
  load(true);
}
async function choose(id, i) {
  const s = session();
  if (!s) return;
  AOS.haptic('medium');
  try { await AOS.api(`/mod/cabinet/sessions/${s.id}/conflicts/${id}`, { method: 'POST', body: JSON.stringify({ choice: i }) }); AOS.toast('The referee is settling the week around it'); }
  catch (e) { AOS.toast(e.message || 'Couldn’t answer that'); }
  load(true);
}

AOS.register({
  id: 'cabinet', title: 'The Cabinet', order: 10,
  icon: ICON, figure,
  page(el) {
    pageEl = el;
    renderPage();
    if (!state.cur || Date.now() - state.loadedAt > 15_000) load(); else schedulePoll();
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button, [data-cb-choice]');
      if (!b || b.disabled) return;
      if (b.matches('[data-cb-run]')) { run(); return; }
      if (b.matches('[data-cb-retry]')) { state.error = null; renderPage(); load(); return; }
      if (b.matches('[data-cb-transcript]')) {
        const d = el.querySelector('#cbTranscript');
        if (d) { d.open = true; d.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
        return;
      }
      if (b.matches('[data-cb-choice]')) { b.disabled = true; choose(b.dataset.cbChoice, Number(b.dataset.i)); return; }
      if (b.matches('[data-cb-keep]')) { b.disabled = true; decide([b.dataset.cbKeep], []); return; }
      if (b.matches('[data-cb-remove]')) { b.disabled = true; decide([], [b.dataset.cbRemove]); return; }
      if (b.matches('[data-cb-keep-all]')) { b.disabled = true; decide(state.cur.blocks.filter((x) => x.status === 'open').map((x) => x.pid), []); }
    });
  },
  cards: {
    todayTop(el, m) {
      cardEl = el; lastM = m;
      renderCard();
      el.onclick = (e) => {
        if (e.target.closest('[data-cb-run]')) { run(); return; }
        if (e.target.closest('[data-cb-open]')) { AOS.haptic('light'); AOS.openPage('cabinet'); }
      };
    },
  },
  onData() { load(true); },
});
load(true);

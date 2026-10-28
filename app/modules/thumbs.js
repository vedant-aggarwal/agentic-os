// The OS redesigns itself from your thumbs. This file records which screens you use (tab, a short target such as
// tab:tasks or btn:Score today, and how long you hesitated before the first tap on a page) and posts batches to
// server/modules/thumbs.ts. Never a typed value, nothing on login.html. The page shows what you used this month and
// the month's three proposals. Design: j15/mockup/final/js/more.js PAGES.thumbs (app/ui/STRUCTURE.md, area (d)).
const { AOS } = window;
AOS.css('modules/thumbs.css');

const esc = AOS.esc;
const I = AOS.icons;
const ICON = I.thumb;
const ON_LOGIN = /login(\.html)?$/i.test(location.pathname);
const sec = (ms) => (ms == null ? '' : ms < 950 ? `${Math.round(ms / 100) / 10} s` : `${Math.round(ms / 1000)} s`);
const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? `${one}s`}`;
// screens are recorded by the tab and the page pushed over it; these are their names on the page
const TAB_NAMES = { today: 'Today', tasks: 'Tasks', goals: 'Goals', areas: 'Areas', life: 'Life', more: 'More', jobs: 'Jobs', clients: 'Clients', content: 'Content', projects: 'Projects', code: 'Code', ideas: 'Ideas' };
const KIND_NAMES = { job: 'a job', jobdiff: 'a job’s changes', project: 'a project', code: 'Code', ideas: 'Ideas', review: 'Weekly review', goal: 'a goal', area: 'an area', areas: 'Areas', life: 'Life', tasks: 'Tasks' };
const MOD_NAMES = { cabinet: 'The Cabinet', ribbon: 'Reality ribbon', weather: 'Week weather', demand: 'Demand radar', doctrine: 'Doctrine', thumbs: 'From your thumbs', price: 'Price on every block', runbooks: 'Runbooks', bounty: 'Bounty board', ping: 'Ping', clients: 'Client window', content: 'Content', crm: 'Clients' };
const screenName = (tab) => {
  const [t, rest] = String(tab).split('/');
  const sub = rest ? (rest.startsWith('mod:') ? MOD_NAMES[rest.slice(4)] ?? rest.slice(4) : KIND_NAMES[rest] ?? rest) : '';
  return `${TAB_NAMES[t] ?? t}${sub ? ` › ${sub}` : ''}`;
};
// each screen's bar wears its domain's colour; screens outside the four domains are neutral
function hueOf(tab) {
  const [t, rest = ''] = String(tab).split('/');
  if (t === 'today' || t === 'tasks') return 'var(--today)';
  if (['jobs', 'projects', 'code', 'ideas'].includes(t) || /^(job|jobdiff|code|ideas|project)$/.test(rest)) return 'var(--jobs)';
  if (t === 'content' || rest === 'mod:content') return 'var(--content)';
  if (['life', 'goals'].includes(t) || /^(goal|review|life)$/.test(rest)) return 'var(--life)';
  if (t === 'clients' || /^mod:(clients|crm)$/.test(rest)) return 'var(--clients)';
  return 'var(--ink-2)';
}

// ---------- telemetry ----------
let queue = [], pageKey = '', pageOpenedAt = performance.now(), firstTapDone = false, typedIn = null, flushing = false;
function currentPage() {
  const p = document.querySelector('.page[data-tab]:not([hidden])');
  if (!p) return '?';
  const tab = p.dataset.tab;
  const tops = p.querySelectorAll(':scope > .page.detail');
  const top = tops[tops.length - 1];
  if (!top) return tab;
  return `${tab}/${top.dataset.kind === 'mod' ? `mod:${top.dataset.id}` : top.dataset.kind}`;
}
function pageChanged() {
  const k = currentPage();
  if (k === pageKey) return;
  pageKey = k;
  pageOpenedAt = performance.now();
  firstTapDone = false;
}
function targetOf(el) {
  if (!(el instanceof Element)) return null;
  const t = el.closest('[data-tab],[data-ai],[data-view],[data-wyn-view],[data-mod],button,a,[role="button"],[role="tab"],.block,.gap,.area-row,.chip-btn,.pr-row,input,textarea,select,label');
  if (!t) return null;
  if (t.dataset.tab) return `tab:${t.dataset.tab}`;
  if (t.dataset.ai) return `ai:${t.dataset.ai}`;
  if (t.dataset.view) return `view:${t.dataset.view}`;
  if (t.dataset.wynView) return `wyn:${t.dataset.wynView}`;
  if (t.dataset.mod) return `mod:${t.dataset.mod}`;
  if (t.matches('input,textarea,select')) return `${t.tagName.toLowerCase()}#${t.id || t.name || '?'}`;
  const card = t.closest('.block,.gap,.area-row,.brief-card,.goal-card,.sheet,.detail-card,.pr-row,.tabbar,.accessory,.hero');
  const cls = card ? (card.className.split(/\s+/).find((c) => c && !/^(is-|on$|open$|past$|current$)/.test(c)) || '') : '';
  const label = t.getAttribute('aria-label') || (t.matches('button,a,[role="button"],[role="tab"]') ? t.textContent.trim().replace(/\s+/g, ' ').slice(0, 24) : '');
  const head = t.id ? `#${t.id}` : t.matches('button,[role="button"],[role="tab"]') ? 'btn' : t.tagName.toLowerCase();
  return `${head}${label ? `:${label}` : ''}${cls ? ` @${cls}` : ''}`.slice(0, 80);
}
function record(target) {
  if (ON_LOGIN || !target) return;
  const hesitation = firstTapDone ? null : Math.round(performance.now() - pageOpenedAt);
  firstTapDone = true;
  queue.push({ at: new Date().toISOString(), tab: pageKey || currentPage(), target, hesitation_ms: hesitation, pageOpenedAt: Math.round(pageOpenedAt) });
  if (queue.length >= 200) flush();
}
async function flush() {
  if (flushing || !queue.length || ON_LOGIN) return;
  flushing = true;
  const batch = queue.splice(0, 500);
  try { await AOS.api('/api/v1/mod/thumbs/events', { method: 'POST', body: JSON.stringify({ events: batch }), keepalive: true }); }
  catch { queue.unshift(...batch); if (queue.length > 500) queue.length = 500; }
  finally { flushing = false; }
}
if (!ON_LOGIN) {
  pageKey = currentPage();
  new MutationObserver(() => queueMicrotask(pageChanged)).observe(document.body, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
  document.addEventListener('click', (e) => record(targetOf(e.target)), true);
  document.addEventListener('focusin', () => { typedIn = null; }, true);
  document.addEventListener('keydown', (e) => {
    const el = e.target;
    const field = el instanceof Element && el.matches('input,textarea,[contenteditable]') ? `${el.tagName.toLowerCase()}#${el.id || el.name || '?'}` : null;
    if (e.key === 'Enter' || e.key === 'Escape') return record(`key:${e.key.toLowerCase()}${field ? `@${field}` : ''}`);
    if (field && typedIn !== el) { typedIn = el; record(`type@${field}`); } // once per field, never the keys themselves
  }, true);
  setInterval(flush, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  addEventListener('pagehide', () => flush());
}

// ---------- page ----------
let state = null, error = null, pageEl = null, loading = false, poll = null, sheet = null, sheetEl = null;
const head = (sub) => `<div class="mp-head"><span class="mp-ic" aria-hidden="true">${ICON}</span><h1 class="large-title">From your thumbs</h1><p class="sub">${sub}</p></div>`;
const word = (t, c, spin = false) => `<span class="mp-st" style="--c:${c}">${spin ? '<span class="spin" style="--c:var(--ink-2)" aria-hidden="true"></span>' : ''}${esc(t)}</span>`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (ym) => { const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? '')); return m ? MONTHS[Number(m[2]) - 1] : String(ym ?? ''); };
const dayText = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d ?? '')); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1].slice(0, 3)}` : ''; };
async function load() {
  if (loading) return;
  loading = true;
  try { state = await AOS.api('/api/v1/mod/thumbs/summary'); error = null; }
  catch (e) { error = e.status === 403 ? 'The proposals are the owner’s.' : e.message || 'Your PC isn’t reachable right now.'; }
  finally { loading = false; }
  renderPage();
  figSync();
  clearInterval(poll);
  if (state?.run?.running && pageEl?.isConnected) poll = setInterval(() => { if (pageEl?.isConnected) load(); else clearInterval(poll); }, 5000);
}
// More's row (app.js modFigure): proposals waiting for you, else the month's taps. Asked for once when More draws
// before anything loaded; More redraws when it changes and is on screen
let figKey = null, figAsked = 0;
function figure() {
  if (!state) { if (!loading && Date.now() - figAsked > 60_000) { figAsked = Date.now(); load(); } return null; }
  if (state.run?.running) return { value: '', label: 'Drawing this month’s proposals' };
  const open = (state.proposals ?? []).filter((p) => p.status === 'open').length;
  if (open) return { value: open, label: open === 1 ? 'Proposal to answer' : 'Proposals to answer' };
  const taps = state.summary?.events ?? 0;
  return taps ? { value: taps.toLocaleString('en-IN'), label: `Taps in the last ${state.summary.days ?? 30} days` } : { value: '', label: 'No taps recorded yet' };
}
function figSync() {
  const k = JSON.stringify(figure());
  if (k === figKey) return;
  figKey = k;
  const ui = AOS.ui?.();
  if (ui?.tab === 'more' && !ui.stack?.more?.length) AOS.renderTab?.('more');
}
function proposalHTML(p) {
  const open = p.status === 'open';
  const st = open ? word('Proposed', 'var(--needs-ink)') : p.status === 'accepted' ? word(`Accepted${p.task ? ` · task ${p.task}` : ''}`, 'var(--done)') : p.status === 'declined' ? word('Not now', 'var(--ink-3)') : word(p.status, 'var(--ink-2)');
  const acts = [p.mockup ? `<button class="btn sm" data-th-mock="${esc(p.id)}">${I.eye}Mockup</button>` : '', open ? `<button class="btn sm" data-th-accept="${esc(p.id)}">Accept</button><button class="btn sm" data-th-decline="${esc(p.id)}">Not now</button>` : ''].join('');
  return `<section class="mp-card th-prop${open ? '' : ' done'}" data-id="${esc(p.id)}">
    <p class="mp-k">${st}<span class="th-month">· ${esc(monthName(p.month))}</span></p>
    <h3 class="t2">${esc(p.title)}</h3>
    <p class="mp-text">${esc(p.reason)}</p>
    ${p.numbers?.length ? `<p class="th-nums">${p.numbers.map((n) => `<span class="chip num">${esc(n)}</span>`).join('')}</p>` : ''}
    ${acts ? `<div class="mp-acts">${acts}</div>` : ''}
  </section>`;
}
function useRow(x, top) {
  const wait = x.hesitation_ms != null ? `${sec(x.hesitation_ms)} to the first tap` : '';
  return `<div class="th-use" title="${esc(`${screenName(x.tab)}: ${x.taps} taps on ${plural(x.days, 'day')}${wait ? `, ${wait}` : ''}`)}">
    <span class="th-use-t"><span class="th-use-n">${esc(screenName(x.tab))}${wait ? `<span class="th-use-m num"> · ${esc(wait)}</span>` : ''}</span><b class="met">${x.taps}</b></span>
    <span class="bar th-bar" style="--p:${Math.max(2, Math.round((x.taps / top) * 100))}%;--c:${hueOf(x.tab)}"><i></i></span>
  </div>`;
}
function pageHTML() {
  const sub = 'The OS reads where your thumbs go and proposes changes to itself.';
  if (error && !state) return `${head(sub)}<div class="note mp-note fail" role="alert"><b>${esc(error)}</b><span>Taps per screen become three UI proposals a month.</span><button class="btn sm" data-th-reload>Try again</button></div>`;
  if (!state) return `${head(sub)}<div class="mp-load" role="status"><span class="spin" aria-hidden="true"></span>Asking your PC</div>`;
  const s = state.summary ?? {}, run = state.run;
  const screens = [...(s.screens ?? [])].sort((a, b) => b.taps - a.taps);
  const top = Math.max(1, ...screens.map((x) => x.taps));
  const shown = screens.slice(0, 6), rest = screens.slice(6);
  const removed = (s.rejected ?? []).filter((r) => r.removed);
  const notes = [
    s.dead?.length ? `Not opened this month: ${s.dead.map(screenName).join(', ')}.` : '',
    removed.length ? `You removed ${removed.map((r) => `${r.removed} ${r.kind} proposal${r.removed === 1 ? '' : 's'}`).join(', ')} before; the next run weighs that.` : '',
  ].filter(Boolean);
  const usage = s.events
    ? `<div class="sh"><h2>What you used this month</h2></div>
      <section class="mp-card th-usage">
        <p class="mp-k">${plural(s.events, 'tap')} on ${plural(s.activeDays, 'day')}${s.since ? ` since ${esc(dayText(s.since))}` : ''}</p>
        <div class="th-uses">${shown.map((x) => useRow(x, top)).join('')}</div>
        ${rest.length ? `<details class="mp-more th-rest"><summary class="th-sum"><span>${plural(rest.length, 'more screen')}</span><span class="mp-caret">${I.chevD}</span></summary><div class="th-uses">${rest.map((x) => useRow(x, top)).join('')}</div></details>` : ''}
        ${notes.map((t) => `<p class="mp-text th-note">${esc(t)}</p>`).join('')}
      </section>`
    : '<div class="note th-first">No taps recorded yet. Use the app: it notes only which screens you tap, never what you type.</div>';
  const running = run?.running ? `<section class="mp-card th-run" role="status"><p class="mp-k">${word('Proposing', 'var(--ink-2)', true)}</p><p class="mp-text">Claude is reading these numbers and drawing three mockups. Started ${esc(hhmm(run.startedAt))}; it takes a few minutes.</p></section>` : '';
  const failed = run && !run.running && run.error ? `<div class="note mp-note fail" role="alert"><b>The last run failed</b><span>${esc(run.error)}</span></div>` : '';
  const props = state.proposals?.length
    ? `<div class="sh"><h2>Proposals</h2><span class="sh-count">${state.proposals.length}</span></div>${state.proposals.map(proposalHTML).join('')}`
    : `<div class="sh"><h2>Proposals</h2></div><div class="note">No proposals yet. The next run is on the 1st at 09:00, from these numbers.</div>`;
  const runBtn = run?.running ? '' : `<div class="mp-foot"><button class="btn block" data-th-run>${I.sparkle}${state.proposals?.length ? 'Propose again' : 'Propose now'}</button></div>`;
  return `${head(sub)}${running}${failed}${usage}${props}${runBtn}`;
}
function renderPage() { if (pageEl?.isConnected) pageEl.innerHTML = pageHTML(); }

// the mockup opens in a sheet, in a sandboxed frame: it can draw, it cannot run anything
function ensureSheet() {
  if (sheet) return sheet;
  sheetEl = document.createElement('section');
  sheetEl.className = 'sheet th-sheet mp-sheet';
  sheetEl.setAttribute('role', 'dialog');
  sheetEl.setAttribute('aria-label', 'Mockup');
  sheetEl.setAttribute('aria-hidden', 'true');
  sheetEl.innerHTML = `<div class="grabber"></div><div class="sheet-head"><div class="th-shead"><div class="th-shead-t"><h2 id="thSheetTitle">Mockup</h2><p>A proposal. Nothing changes until you accept it.</p></div><button class="sheet-close" data-th-close aria-label="Close">${I.x}</button></div></div><div class="sheet-body th-sheet-body"><iframe class="th-frame" sandbox="" title="Mockup"></iframe></div>`;
  document.getElementById('screen').appendChild(sheetEl);
  sheet = AOS.makeSheet(sheetEl, { detents: () => ({ large: 0 }), scrimFor: (y, H) => Math.max(0, Math.min(1, 1 - y / (H * 0.85))) });
  sheetEl.addEventListener('click', (e) => { if (e.target.closest('[data-th-close]')) sheet.close(); });
  return sheet;
}
// the frame's own page: the skin's ground and ink, so loading and errors read in either skin
const frameNote = (text, fail) => { const cs = getComputedStyle(document.documentElement); return `<p style="margin:0;padding:20px;font:15px/20px system-ui;color:${fail ? cs.getPropertyValue('--fail-ink') : cs.getPropertyValue('--ink-2')}">${esc(text)}</p>`; };
async function openMockup(id) {
  const p = state?.proposals?.find((x) => x.id === id);
  ensureSheet();
  sheetEl.querySelector('#thSheetTitle').textContent = p?.title ?? 'Mockup';
  sheetEl.setAttribute('aria-label', p?.title ? `Mockup: ${p.title}` : 'Mockup');
  const frame = sheetEl.querySelector('.th-frame');
  frame.srcdoc = frameNote('Loading the mockup…');
  sheet.open('large');
  try { const r = await AOS.api(`/api/v1/mod/thumbs/mockups/${id}?json=1`); frame.srcdoc = r.html; }
  catch (e) { frame.srcdoc = frameNote(e.message || 'No mockup', true); }
}
async function act(path, body) {
  AOS.haptic('light');
  try { const r = await AOS.api(`/api/v1/mod/thumbs${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) }); await load(); return r; }
  catch (e) { AOS.toast(e.message || 'That didn’t work'); return null; }
}

AOS.register({
  id: 'thumbs', title: 'From your thumbs', order: 30,
  icon: ICON, figure,
  page(el) {
    pageEl = el;
    el.classList.add('th-page');
    renderPage();
    load();
    el.addEventListener('click', async (e) => {
      const t = e.target;
      if (t.closest('[data-th-reload]')) { error = null; state = null; renderPage(); return load(); }
      const mock = t.closest('[data-th-mock]');
      if (mock) { AOS.haptic('light'); return openMockup(mock.dataset.thMock); }
      const acc = t.closest('[data-th-accept]');
      if (acc) { acc.disabled = true; const r = await act(`/proposals/${acc.dataset.thAccept}/accept`); if (r) { AOS.haptic('success'); AOS.toast(`Task added: ${r.task?.title ?? 'UI change'}`); } else acc.disabled = false; return; }
      const dec = t.closest('[data-th-decline]');
      if (dec) { dec.disabled = true; if (await act(`/proposals/${dec.dataset.thDecline}/decline`)) AOS.toast('Not now'); else dec.disabled = false; return; }
      const run = t.closest('[data-th-run]');
      if (run) { run.disabled = true; const r = await act('/run'); if (r) AOS.toast('Claude is on it. A few minutes.'); else run.disabled = false; }
    });
  },
  onData() { if (pageEl?.isConnected && !state?.run?.running) load(); },
});

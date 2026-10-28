// Runbooks: a task done twice with evidence becomes a runbook; ready ones get a Run button and a line on Today.
// Server: server/modules/runbooks.ts (GET /books?full=1, GET /today, PATCH /books/:id, POST /books/:id/run, POST /scan).
// Design: j15/mockup/final/js/more.js PAGES.runbooks, in the module frame of app/ui/screens/content.css (area (d)).
const { AOS } = window;
AOS.css('modules/runbooks.css');

const I = AOS.icons;
const ICON = I.book;
const esc = AOS.esc;
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? `${one}s`}`;
const word = (text, c) => `<span class="mp-st" style="--c:${c}">${esc(text)}</span>`;
const spin = '<span class="spin" aria-hidden="true"></span>';
let books = null, dryRun = false, matches = [], err = null, busy = '', pageEl = null, cardEl = null, lastM = null, loading = null, openId = null, lastFig = '';

// ── the page: one list; a ready book runs from its row and opens in place to its steps ──
function stepHTML(s) {
  return `<li class="${s.ok ? '' : 'failed'}"><span class="rbk-st">${esc(s.text)}</span>${s.ok ? '' : `<span class="rbk-fail">${word('Failed before', 'var(--fail-ink)')}</span>`}${s.command ? `<code class="rbk-cmd">${esc(s.command)}</code>` : ''}${s.note ? `<span class="rbk-note">${esc(s.note)}</span>` : ''}</li>`;
}
function bookHTML(b) {
  const k = b.book, ready = k.status === 'ready', steps = b.steps ?? [];
  const open = openId === k.id;
  const meta = [k.needs_assembly ? 'Steps not in order yet' : plural(steps.length, 'step'), `done ${k.times_done ?? 0}×`].join(' · ');
  const act = ready
    ? `<button class="btn sm" data-rb-run="${k.id}" ${busy ? 'disabled' : ''}>${busy === `run${k.id}` ? `${spin}Sending` : `${I.play}Run`}</button>`
    : `<button class="btn sm" data-rb-status="ready" data-id="${k.id}" ${busy || !steps.length ? 'disabled' : ''}>${busy === `status${k.id}` ? spin : ''}Mark ready</button>`;
  const run = b.runs?.[0];
  return `<div class="rbk${open ? ' open' : ''}" data-book="${k.id}">
    <div class="lrow ic rbk-top">
      <button class="rbk-hit" data-rb-open="${k.id}" aria-expanded="${open}"><span class="tile">${ICON}</span>
        <span class="rbody"><span class="rtitle wrap">${esc(k.title)}</span><span class="rmeta">${word(ready ? 'Ready' : 'Draft', ready ? 'var(--done)' : 'var(--ink-2)')}<span class="ell">${esc(meta)}</span></span></span>
        <span class="rbk-caret" aria-hidden="true">${I.chevD}</span></button>
      ${act}
    </div>
    <div class="rbk-more"${open ? '' : ' inert'}><div>
      ${steps.length ? `<ol class="rbk-steps">${steps.map(stepHTML).join('')}</ol>` : '<p class="foot rbk-none">No steps yet. The next scan puts them in order.</p>'}
      <p class="foot rbk-last">${[k.last_done_at ? `Last done by hand ${esc(day(k.last_done_at))}` : '', run ? `last run ${esc(day(run.started_at))}${run.task ? ` as ${esc(run.task)}` : ''}: ${esc(run.result ?? 'in progress')}` : 'not run yet'].filter(Boolean).join(' · ').replace(/^l/, 'L')}</p>
      ${ready ? `<div class="rbk-foot"><button class="btn sm" data-rb-status="draft" data-id="${k.id}" ${busy ? 'disabled' : ''}>${busy === `status${k.id}` ? spin : ''}Back to draft</button></div>` : ''}
    </div></div>
  </div>`;
}
const head = () => `<div class="mp-head"><span class="mp-ic" aria-hidden="true">${ICON}</span><h1 class="large-title">Runbooks</h1><p class="sub">Work you repeat, written once, run by an agent.</p></div>`;
function renderPage() {
  if (!pageEl?.isConnected) return;
  let body;
  if (err && !books) body = `<div class="note mp-note fail" role="alert"><b>${esc(err)}</b><span>Runbooks live on your PC.</span><button class="btn sm" data-rb-retry>Try again</button></div>`;
  else if (!books) body = `<div class="mp-load" role="status">${spin}Asking your PC</div>`;
  else body = `${dryRun ? '<div class="note rbk-dry"><b>Dry run on this PC.</b> Run records what it would send and starts nothing.</div>' : ''}
    ${books.length ? `<div class="group rbk-list">${books.map(bookHTML).join('')}</div>`
      : '<div class="note rbk-empty">No runbooks yet. Finish the same task twice with evidence (agentos done &lt;id&gt; --evidence "…") and the hourly scan writes one.</div>'}
    <div class="mp-foot"><button class="btn block" data-rb-scan ${busy ? 'disabled' : ''}>${busy === 'scan' ? `${spin}Scanning` : `${I.search}Scan for repeated work`}</button></div>
    <p class="mp-hint">The scan runs every hour. Mark a runbook ready and it gets a Run button, and a line on Today when a matching task is due.</p>`;
  pageEl.innerHTML = head() + body;
}

// ── Today: open tasks today that match a ready book, each with Run it ──
function renderCard(el, m) {
  if (!el) return;
  if (!m?.isToday || !matches.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="mcard-list">${matches.slice(0, 3).map((x) => `<div class="lrow b-row mcard rbk-card">
      <span class="bi">${ICON}</span>
      <span class="rbody"><span class="rtitle">${esc(x.title)}</span><span class="rmeta"><span class="ell">${esc(x.book_title && x.book_title !== x.title ? `Runbook: ${x.book_title}` : 'Has a ready runbook')}</span></span></span>
      <button class="btn sm mc-act" data-rb-run="${x.book}" ${busy ? 'disabled' : ''}>${busy === `run${x.book}` ? `${spin}Sending` : 'Run it'}</button>
    </div>`).join('')}</div>`;
}
// More's row: how many are ready to run (app.js renderMore reads figure())
function figure() {
  if (!books) return null;
  const ready = books.filter((b) => b.book.status === 'ready').length, drafts = books.length - ready;
  if (ready) return { value: String(ready), label: 'Ready to run' };
  if (drafts) return { value: String(drafts), label: drafts === 1 ? 'Draft to check' : 'Drafts to check' };
  return { value: '', label: 'None written yet' };
}
const render = () => {
  renderPage();
  renderCard(cardEl, lastM);
  // More redraws when the figure changed and its list is what you are looking at (not a page pushed over it)
  const f = JSON.stringify(figure());
  if (f !== lastFig) {
    lastFig = f;
    const ui = AOS.ui?.();
    if (ui?.tab === 'more' && !ui.stack?.more?.length) AOS.renderTab?.('more');
  }
};

async function load() {
  if (loading) return loading;
  loading = (async () => {
    err = null;
    try {
      const [b, t] = await Promise.all([AOS.api('/mod/runbooks/books?full=1'), AOS.api('/mod/runbooks/today')]);
      books = b.books ?? []; dryRun = !!b.dryRun; matches = t.matches ?? [];
    } catch (e) { if (!books) err = e.message || 'Your PC isn’t reachable right now.'; }
    render();
  })().finally(() => { loading = null; });
  return loading;
}
async function act(what, fn) {
  if (busy) return;
  busy = what;
  render();
  AOS.haptic('light');
  try { await fn(); AOS.haptic('success'); } catch (e) { AOS.toast(e.message || 'That didn’t work'); }
  busy = '';
  await load();
}
function toggle(id) {
  openId = openId === id ? null : id;
  for (const el of pageEl?.querySelectorAll('.rbk') ?? []) {
    const o = Number(el.dataset.book) === openId;
    el.classList.toggle('open', o);
    el.querySelector('.rbk-hit')?.setAttribute('aria-expanded', String(o));
    const more = el.querySelector('.rbk-more');
    if (more) more.inert = !o;
  }
  AOS.haptic('selection');
}
function onClick(e) {
  const t = e.target.closest('[data-rb-run],[data-rb-status],[data-rb-scan],[data-rb-open],[data-rb-retry]');
  if (!t || t.disabled) return;
  if (t.dataset.rbOpen) { toggle(Number(t.dataset.rbOpen)); return; }
  if ('rbRetry' in t.dataset) { err = null; render(); load(); return; }
  if (t.dataset.rbRun) return act(`run${t.dataset.rbRun}`, async () => {
    const r = await AOS.api(`/mod/runbooks/books/${t.dataset.rbRun}/run`, { method: 'POST', body: '{}' });
    const title = r?.task?.title ?? 'the task';
    AOS.toast(r?.dryRun ? `Dry run: would send ${title} to Claude` : `Sent ${title} to Claude`);
    AOS.refresh?.(true);
  });
  if (t.dataset.rbStatus) return act(`status${t.dataset.id}`, async () => {
    await AOS.api(`/mod/runbooks/books/${t.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: t.dataset.rbStatus }) });
    AOS.toast(t.dataset.rbStatus === 'ready' ? 'Ready. It shows on Today when a matching task is due.' : 'Back to draft.');
  });
  if ('rbScan' in t.dataset) return act('scan', async () => {
    const r = await AOS.api('/mod/runbooks/scan', { method: 'POST', body: '{}' });
    AOS.toast(r.count ? `${plural(r.count, 'runbook')}, ${r.assembled} put in order` : 'No task done twice with evidence yet');
  });
}
const bind = (el) => { if (el && !el._rbBound) { el._rbBound = true; el.addEventListener('click', onClick); } };

AOS.register({
  id: 'runbooks', title: 'Runbooks', order: 31,
  icon: ICON,
  figure,
  page(el) { pageEl = el; bind(el); renderPage(); load(); },
  cards: { todayTop(el, m) { cardEl = el; lastM = m; bind(el); renderCard(el, m); if (!books && !loading) load(); } },
  onData() { load(); },
});

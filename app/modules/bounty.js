// Bounty board and payroll: recurring work priced at minutes a week times your hourly value; Take hands it to Claude.
// Server: server/modules/bounty.ts (GET /board, GET /payroll, PUT /rate, POST /items/:id/take|dismiss, /scan, /payroll/run,
// /payroll/proposals/:id/keep|remove). Design: j15/mockup/final/js/more.js PAGES.bounty, in the module frame of
// app/ui/screens/content.css (area (d)).
const { AOS } = window;
AOS.css('modules/bounty.css');

const I = AOS.icons;
const ICON = I.target;
const esc = AOS.esc;
const rs = (n) => (n == null ? '' : `₹${Math.round(n).toLocaleString('en-IN')}`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? `${one}s`}`;
const num = (n) => (n == null ? '' : String(Math.round(Number(n) * 10) / 10));
const word = (text, c) => `<span class="mp-st" style="--c:${c}">${esc(text)}</span>`;
const spin = '<span class="spin" aria-hidden="true"></span>';
let board = null, payroll = null, err = null, busy = '', rateOpen = false, pageEl = null, loading = null, loadedAt = 0, lastFig = '';

// a runner's name as you would say it: "AI · plan", "Claude jobs", "doctrine · doctrine-weekly"
function runnerName(r) {
  const s = String(r ?? '');
  if (s === 'agent:claude') return 'Claude jobs';
  if (s.startsWith('ai:')) return `AI · ${s.slice(3)}`;
  if (s.startsWith('job:')) { const [, mod, id] = s.split(':'); return id && id !== mod ? `${mod} · ${id}` : mod; }
  return s;
}

// ── the page ──────────────────────────────────────────────────────────────
const head = () => `<div class="mp-head"><span class="mp-ic" aria-hidden="true">${ICON}</span><h1 class="large-title">Bounty board</h1><p class="sub">Recurring work, priced in minutes and your hourly value.</p></div>`;
function rateHTML(b) {
  const src = b.rate_source === 'price_rates' ? 'From your rates in Price on every block' : '';
  if (rateOpen || !b.rate) {
    return `<form class="mp-card bt-rate" data-bt-rate-form>
      <p class="mp-k">Your hour is worth</p>
      <div class="mp-add bt-rateadd">
        <label class="ifield bt-rupee"><span class="bt-cur" aria-hidden="true">₹</span><input name="rate" type="number" inputmode="numeric" min="1" step="50" placeholder="Rupees an hour" value="${b.rate ?? ''}" required aria-label="Your hourly value in rupees"></label>
        <button class="btn primary" type="submit" ${busy ? 'disabled' : ''}>${busy === 'rate' ? spin : ''}Save</button>
      </div>
      ${b.rate ? '<div class="mp-acts"><button class="btn sm" type="button" data-bt-rate-cancel>Cancel</button></div>' : '<p class="foot bt-rate-foot">Payoffs need a rate. Minutes a week are counted either way.</p>'}
    </form>`;
  }
  return `<section class="mp-card bt-rate">
    <p class="mp-k">Your hour is worth</p>
    <p class="mp-big met">${rs(b.rate)}<small>/h</small></p>
    ${src ? `<p class="foot">${esc(src)}</p>` : ''}
    <div class="mp-acts"><button class="btn sm" data-bt-rate>${I.edit}Change</button></div>
  </section>`;
}
function itemHTML(i) {
  const open = i.status === 'open';
  const meta = [`${num(i.minutes_per_week)} min a week`, `${num(i.times_per_week)}× a week, ${num(i.minutes_each)} min each`, i.basis ?? '', i.source ?? ''].filter(Boolean).join(' · ');
  const end = i.payoff_per_month != null ? `<span class="bt-pay"><b class="met bt-v">${rs(i.payoff_per_month)}</b><small>a month</small></span>` : '<span class="bt-pay bt-norate">Set a rate</span>';
  const acts = open
    ? `<div class="mp-racts"><button class="btn sm" data-bt-take="${i.id}" ${busy ? 'disabled' : ''}>${busy === `take${i.id}` ? `${spin}Sending` : `${I.check}Take`}</button><button class="btn sm" data-bt-dismiss="${i.id}" ${busy ? 'disabled' : ''}>${busy === `dismiss${i.id}` ? spin : ''}Dismiss</button></div>`
    : `<p class="bt-taken">${word(i.status === 'taken' ? 'Taken' : 'Dismissed', i.status === 'taken' ? 'var(--done)' : 'var(--ink-3)')}${i.task ? `<span> · ${esc(i.task)}</span>` : ''}</p>`;
  return `<div class="lrow mp-tall bt-row${open ? '' : ' bt-done'}">
    <span class="rbody"><span class="rtitle wrap">${esc(i.title)}</span><span class="mp-why">${esc(meta)}</span>${acts}</span>
    ${end}
  </div>`;
}
function payrollHTML() {
  if (!payroll) return '';
  const open = (payroll.proposals ?? []).filter((p) => p.status === 'open');
  const period = payroll.rows?.[0]?.period;
  const rows = (payroll.rows ?? []).filter((r) => r.period === period);
  const retired = new Set(payroll.retired ?? []);
  const props = open.map((p) => `<div class="lrow mp-tall bt-prop">
      <span class="rbody"><span class="rtitle wrap">Retire ${esc(runnerName(p.runner))}?</span>
        <span class="mp-why">You kept ${p.kept} and removed ${p.removed} of what it proposed in 30 days (${p.keptRate}% kept).</span>
        <div class="mp-racts"><button class="btn sm bt-retire" data-bt-prop="${esc(p.id)}" data-decision="keep" ${busy ? 'disabled' : ''}>${busy === `prop${p.id}` ? spin : ''}Retire</button><button class="btn sm" data-bt-prop="${esc(p.id)}" data-decision="remove" ${busy ? 'disabled' : ''}>Keep running</button></div>
      </span>
    </div>`).join('');
  const runners = rows.map((r) => {
    const off = retired.has(r.runner);
    const meta = [plural(r.runs ?? 0, 'run'), r.kept_rate == null ? '' : `${r.kept_rate}% kept`, `${r.tasks_done ?? 0} done${r.evidence_verified ? `, ${r.evidence_verified} with evidence` : ''}`].filter(Boolean).join(' · ');
    return `<div class="lrow mp-tall bt-runner${off ? ' mp-off' : ''}">
      <span class="rbody"><span class="rtitle">${esc(runnerName(r.runner))}</span><span class="rmeta">${off ? `${word('Retired', 'var(--ink-3)')}<span>·</span>` : ''}<span class="ell">${esc(meta)}</span></span></span>
      <b class="met mp-v bt-rv">${r.value_estimate == null ? '–' : rs(r.value_estimate)}</b>
    </div>`;
  }).join('');
  return `<div class="sh"><h2>Payroll</h2>${period ? `<span class="sh-count">${esc(period)}</span>` : ''}</div>
    ${props ? `<div class="group bt-props">${props}</div>` : ''}
    ${runners ? `<div class="group bt-runners">${runners}</div>` : '<div class="note">No payroll yet. It runs at 07:00 on the 1st: per runner, the runs, what you kept, the tasks done with evidence and what that was worth.</div>'}
    <div class="mp-foot"><button class="btn block" data-bt-payroll ${busy ? 'disabled' : ''}>${busy === 'payroll' ? `${spin}Adding up` : `${I.coin}Run payroll now`}</button></div>`;
}
function renderPage() {
  if (!pageEl?.isConnected) return;
  const b = board;
  let body;
  if (err && !b) body = `<div class="note mp-note fail" role="alert"><b>${esc(err)}</b><span>The board lives on your PC.</span><button class="btn sm" data-bt-retry>Try again</button></div>`;
  else if (!b) body = `<div class="mp-load" role="status">${spin}Asking your PC</div>`;
  else {
    const items = b.items ?? [];
    const open = items.filter((i) => i.status === 'open').length;
    body = `${rateHTML(b)}
    ${b.dryRun ? '<div class="note bt-dry"><b>Dry run on this PC.</b> Take records what it would send and starts nothing.</div>' : ''}
    <div class="sh"><h2>Open bounties</h2>${open ? `<span class="sh-count">${open}</span>` : ''}</div>
    ${items.length ? `<div class="group bt-items">${items.map(itemHTML).join('')}</div>` : '<div class="note">Nothing recurs yet. Give a task a repeat (agentos add "…" --repeat daily) or finish the same thing three times, then scan.</div>'}
    <div class="mp-foot"><button class="btn block" data-bt-scan ${busy ? 'disabled' : ''}>${busy === 'scan' ? `${spin}Scanning` : `${I.search}Scan for new bounties`}</button></div>
    <p class="mp-hint">Take files a task and hands it to Claude, to turn the work into one command.</p>
    ${payrollHTML()}`;
  }
  // a redraw keeps the rate you were typing
  const typed = pageEl.querySelector('[data-bt-rate-form] input')?.value;
  pageEl.innerHTML = head() + body;
  if (typed) { const i = pageEl.querySelector('[data-bt-rate-form] input'); if (i) i.value = typed; }
}
// More's row: what is open to take (app.js renderMore reads figure())
function figure() {
  if (!board) return null;
  const open = (board.items ?? []).filter((i) => i.status === 'open').length;
  if (open) return { value: String(open), label: open === 1 ? 'Open bounty' : 'Open bounties' };
  return { value: '', label: board.rate ? 'Nothing open to take' : 'Set your hourly value' };
}
function render() {
  renderPage();
  // More redraws when the figure changed and its list is what you are looking at (not a page pushed over it)
  const f = JSON.stringify(figure());
  if (f !== lastFig) {
    lastFig = f;
    const ui = AOS.ui?.();
    if (ui?.tab === 'more' && !ui.stack?.more?.length) AOS.renderTab?.('more');
  }
}

async function load() {
  if (loading) return loading;
  loading = (async () => {
    err = null;
    try {
      const [b, p] = await Promise.all([AOS.api('/mod/bounty/board'), AOS.api('/mod/bounty/payroll')]);
      board = b; payroll = p; loadedAt = Date.now();
    } catch (e) { if (!board) err = e.message || 'Your PC isn’t reachable right now.'; }
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
function onSubmit(e) {
  const f = e.target.closest('[data-bt-rate-form]');
  if (!f) return;
  e.preventDefault();
  const rate = Number(f.rate.value);
  if (!(rate > 0)) { f.rate.focus(); return; }
  act('rate', async () => { board = await AOS.api('/mod/bounty/rate', { method: 'PUT', body: JSON.stringify({ rate }) }); rateOpen = false; AOS.toast(`Rate saved: ${rs(rate)} an hour`); });
}
function onClick(e) {
  const t = e.target.closest('[data-bt-take],[data-bt-dismiss],[data-bt-scan],[data-bt-rate],[data-bt-rate-cancel],[data-bt-payroll],[data-bt-prop],[data-bt-retry]');
  if (!t || t.disabled) return;
  if ('btRetry' in t.dataset) { err = null; render(); load(); return; }
  if ('btRate' in t.dataset) { rateOpen = true; renderPage(); pageEl.querySelector('[data-bt-rate-form] input')?.focus(); return; }
  if ('btRateCancel' in t.dataset) { rateOpen = false; renderPage(); return; }
  if (t.dataset.btTake) return act(`take${t.dataset.btTake}`, async () => {
    const r = await AOS.api(`/mod/bounty/items/${t.dataset.btTake}/take`, { method: 'POST', body: '{}' });
    const title = r?.task?.title ?? 'the task';
    AOS.toast(r?.dryRun ? `Dry run: would send ${title} to Claude` : `Sent ${title} to Claude`);
    AOS.refresh?.(true);
  });
  if (t.dataset.btDismiss) return act(`dismiss${t.dataset.btDismiss}`, async () => { await AOS.api(`/mod/bounty/items/${t.dataset.btDismiss}/dismiss`, { method: 'POST', body: '{}' }); AOS.toast('Dismissed'); });
  if ('btScan' in t.dataset) return act('scan', async () => { const r = await AOS.api('/mod/bounty/scan', { method: 'POST', body: '{}' }); AOS.toast(`${r.count ?? 0} on the board`); });
  if ('btPayroll' in t.dataset) return act('payroll', async () => { const r = await AOS.api('/mod/bounty/payroll/run', { method: 'POST', body: '{}' }); AOS.toast(`Payroll ${r.period}: ${plural(r.rows?.length ?? 0, 'runner')}, ${r.new_proposals ?? 0} to retire`); });
  if (t.dataset.btProp) return act(`prop${t.dataset.btProp}`, async () => {
    const r = await AOS.api(`/mod/bounty/payroll/proposals/${t.dataset.btProp}/${t.dataset.decision}`, { method: 'POST', body: '{}' });
    AOS.toast(r.decision === 'retired' ? `${runnerName(r.runner)} retired. Its job now skips.` : 'Kept running.');
  });
}

AOS.register({
  id: 'bounty', title: 'Bounty board', order: 32,
  icon: ICON,
  figure,
  page(el) { pageEl = el; rateOpen = false; el.addEventListener('click', onClick); el.addEventListener('submit', onSubmit); renderPage(); load(); },
  // the board reads again on every sync while it is open; otherwise every five minutes, for More's figure
  onData() { if (pageEl?.isConnected || Date.now() - loadedAt > 5 * 60_000) load(); },
});

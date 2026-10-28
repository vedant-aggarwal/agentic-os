// Doctrine: one observation a week about how you really work, with the rows that prove it; accepted, it becomes a
// rule Plan my day obeys. Server: server/modules/doctrine.ts (GET /state, POST /observations/:id/accept|decline,
// /rules/:id/retire, /observe). Page plus a card on the Life page.
// Design: j15/mockup/final/js/more.js PAGES.doctrine (app/ui/STRUCTURE.md, area (d)).
const { AOS } = window;
AOS.css('modules/doctrine.css');

const I = AOS.icons;
const esc = AOS.esc;
const ICON = I.doc;
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);
const short = (d) => { const x = new Date(`${String(d).slice(0, 10)}T12:00:00Z`); return `${x.getUTCDate()} ${MON[x.getUTCMonth()]}`; };
const dayLabel = (d) => { const x = new Date(`${String(d).slice(0, 10)}T12:00:00Z`); return `${WD[x.getUTCDay()]} ${x.getUTCDate()}`; };
const weekName = (w) => { const m = String(w ?? '').match(/W(\d+)/); return m ? `week ${Number(m[1])}` : String(w ?? ''); };
const areaName = (slug) => AOS.areas.get(slug)?.name ?? slug;
const color = (slug) => AOS.areas.get(slug)?.color ?? 'var(--a-none)';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? `${one}s`}`;
const pill = (text, c) => `<span class="pill" style="--c:${c}">${esc(text)}</span>`;
const SPIN = '<span class="spin" aria-hidden="true"></span>';
let st = null, err = null, busy = '', pageEl = null, lifeEl = null, loading = null;

// One evidence row: its day on the left, the task in the middle, what happened at the end. The rows differ by
// pattern (skipped blocks, overruns, late adds, inbox age, missing evidence, removed proposals); each is read for
// what it has.
function evRow(r) {
  const date = ['date', 'done', 'captured', 'added'].map((k) => r[k]).find(isDate);
  const left = date ? dayLabel(date) : r.weekday ? String(r.weekday).slice(0, 3) : '';
  const title = r.title ?? r.what ?? r.task ?? '';
  const meta = [r.planned ? `planned ${r.planned}` : '', r.estimate != null && r.actual != null ? `est. ${r.estimate} min, took ${r.actual}` : '',
    r.due ? `due ${short(r.due)}` : '', r.age != null ? `${plural(r.age, 'day')} in the inbox` : '', r.kind ? String(r.kind) : '',
    r.area && !r.kind ? areaName(r.area) : ''].filter(Boolean).join(' · ');
  let end = '';
  if (r.result) end = r.result === 'done' ? pill('Done', 'var(--done)') : r.result === 'skipped' ? pill('Skipped', 'var(--fail-ink)') : /later/.test(r.result) ? pill('A day late', 'var(--needs-ink)') : pill(r.result.replace(/^./, (c) => c.toUpperCase()), 'var(--ink-2)');
  else if (r.status === 'kept' || r.status === 'removed') end = pill(r.status === 'kept' ? 'Kept' : 'Removed', r.status === 'kept' ? 'var(--done)' : 'var(--fail-ink)');
  else if (r.ratio != null) end = pill(`${r.ratio}×`, r.ratio >= 1.5 ? 'var(--needs-ink)' : 'var(--ink-2)');
  else if (r.late != null) end = r.late > 0 ? pill(`${plural(r.late, 'day')} late`, 'var(--fail-ink)') : pill('On time', 'var(--done)');
  else if (r.area && !r.kind) end = '';
  return `<div class="dc-ev"><span class="foot num dc-ev-d">${esc(left)}</span><span class="dc-ev-t"><span>${esc(title)}</span>${meta ? `<small class="num">${r.area && !r.kind ? `<i class="dot" style="--c:${color(r.area)}"></i>` : ''}${esc(meta)}</small>` : ''}</span>${end}</div>`;
}
function evidenceHTML(rows) {
  if (!rows?.length) return '';
  return `<div class="dc-evs">${rows.slice(0, 6).map(evRow).join('')}</div>${rows.length > 6 ? `<p class="foot dc-more">and ${plural(rows.length - 6, 'more row')}</p>` : ''}`;
}
// the open observation: what it saw, the rows that prove it, the rule it proposes, and your answer
function obsCard(o, { life = false } = {}) {
  const dis = busy ? 'disabled' : '';
  const k = `<p class="mp-k">This week’s observation · ${esc(weekName(o.week))}</p>`;
  return `<section class="mp-card dc-obs" data-obs="${o.id}">
    ${life ? `<div class="dc-lhead">${k}<button class="dc-open" data-doc-open aria-label="Open Doctrine${o.evidence?.length ? `, ${plural(o.evidence.length, 'row')} of evidence` : ''}">Doctrine${I.chevR}</button></div>` : k}
    <p class="dc-text">${esc(o.text)}</p>
    ${life ? '' : evidenceHTML(o.evidence)}
    ${o.rule ? `<div class="dc-rule"><span class="dc-rule-k">Proposed rule</span><span>${esc(o.rule)}</span></div>` : ''}
    <div class="mp-acts"><button class="btn sm primary" data-doc-accept="${o.id}" ${dis}>${busy === 'accept' ? `${SPIN}Accepting` : 'Accept rule'}</button><button class="btn sm" data-doc-decline="${o.id}" ${dis}>Not this</button></div>
  </section>`;
}
function renderLife() {
  if (!lifeEl?.isConnected) return;
  lifeEl.innerHTML = st?.current ? obsCard(st.current, { life: true }) : '';
}
function renderPage() {
  if (!pageEl?.isConnected) return;
  const rules = st?.rules ?? [], active = rules.filter((r) => r.active), retired = rules.filter((r) => !r.active);
  const past = (st?.observations ?? []).filter((o) => o.status !== 'open');
  const head = `<div class="mp-head"><span class="mp-ic" aria-hidden="true">${ICON}</span><h1 class="large-title">Doctrine</h1><p class="sub">Rules the planner learns from how your weeks really go, one honest observation a week.</p></div>`;
  let body;
  if (err && !st) body = `<div class="note mp-note fail" role="alert"><b>${esc(err)}</b><span>Doctrine reads your history on your PC.</span><button class="btn sm" data-doc-retry>Try again</button></div>`;
  else if (!st) body = `<div class="mp-load" role="status">${SPIN}Asking your PC</div>`;
  else {
    const current = st.current ? obsCard(st.current)
      : '<section class="mp-card"><p class="mp-k">This week</p><p class="mp-text">No observation yet. The Sunday 18:00 job writes one from your history, or observe now.</p></section>';
    const ruleRows = active.map((r) => `<div class="lrow mp-tall dc-rulerow"><div class="rbody"><span class="dc-rule-t">${esc(r.text)}</span><span class="mp-why">Since ${esc(short(r.since))}${r.from ? `, from: ${esc(r.from)}` : ''}</span></div><button class="btn sm" data-doc-retire="${r.id}" ${busy ? 'disabled' : ''}>Retire</button></div>`).join('');
    const pastRows = past.map((o) => `<details class="mp-more dc-past"><summary class="lrow mp-tall"><div class="rbody"><span class="rtitle wrap">${esc(o.text)}</span><span class="rmeta"><span class="mp-st" style="--c:${o.status === 'accepted' ? 'var(--done)' : 'var(--ink-3)'}">${o.status === 'accepted' ? 'Accepted' : 'Not this'}</span><span>·</span><span class="ell">${esc(weekName(o.week))}${o.decided_at ? ` · ${esc(short(o.decided_at))}` : ''}</span></span></div><span class="mp-caret" aria-hidden="true">${I.chevD}</span></summary>
      <div class="dc-past-b">${evidenceHTML(o.evidence)}${o.rule ? `<div class="dc-rule"><span class="dc-rule-k">Rule</span><span>${esc(o.rule)}</span></div>` : ''}</div></details>`).join('');
    body = `${current}
      <div class="sh"><h2>Rules the planner obeys</h2>${active.length ? `<span class="sh-count">${active.length}</span>` : ''}</div>
      ${active.length ? `<div class="group">${ruleRows}</div>` : '<div class="note">No rules yet. Accept an observation to make one; Plan my day obeys it at once.</div>'}
      ${retired.length ? `<p class="mp-hint">Retired: ${retired.map((r) => esc(r.text)).join(' · ')}</p>` : ''}
      <div class="sh"><h2>Past observations</h2>${past.length ? `<span class="sh-count">${past.length}</span>` : ''}</div>
      ${past.length ? `<div class="group">${pastRows}</div>` : '<div class="note">Nothing yet. Each week’s answer lands here.</div>'}
      <div class="mp-foot"><button class="btn block" data-doc-observe ${busy ? 'disabled' : ''}>${busy === 'observe' ? `${SPIN}Reading your week` : `${I.sparkle}Observe now`}</button></div>
      <p class="mp-hint">One Sonnet call reads the strongest pattern in your history. Rules you accept go into Plan my day’s rules (agentos ai rules).</p>`;
  }
  pageEl.innerHTML = head + body;
}
const render = () => { renderPage(); renderLife(); };

async function load() {
  if (loading) return loading;
  loading = (async () => {
    err = null;
    try { st = await AOS.api('/mod/doctrine/state'); } catch (e) { if (!st) err = e.message || 'Your PC isn’t reachable right now.'; }
    render();
    figSync();
  })().finally(() => { loading = null; });
  return loading;
}
// More's row (app.js modFigure): an observation waiting for you, else the rules in force. Asked for once when More
// draws before anything loaded; More redraws when it changes and is on screen
let figKey = null, figAsked = 0;
function figure() {
  if (!st) { if (!loading && Date.now() - figAsked > 60_000) { figAsked = Date.now(); load(); } return null; }
  if (st.current?.status === 'open') return { value: 1, label: 'Observation to answer' };
  const n = (st.rules ?? []).filter((r) => r.active).length;
  return n ? { value: n, label: n === 1 ? 'Rule the planner obeys' : 'Rules the planner obeys' } : { value: '', label: 'No rules yet' };
}
function figSync() {
  const k = JSON.stringify(figure());
  if (k === figKey) return;
  figKey = k;
  const ui = AOS.ui?.();
  if (ui?.tab === 'more' && !ui.stack?.more?.length) AOS.renderTab?.('more');
}
async function act(what, path, done) {
  if (busy) return;
  busy = what;
  render();
  AOS.haptic('light');
  try {
    const r = await AOS.api(path, { method: 'POST', body: '{}' });
    if (r && r.rules) st = { ...st, ...r };
    done?.(r);
    AOS.haptic('success');
  } catch (e) { AOS.toast(e.message || 'That didn’t work'); }
  busy = '';
  render();
  figSync();
}
function onClick(e) {
  const t = e.target.closest('button');
  if (!t || t.disabled) return;
  if ('docRetry' in t.dataset) { err = null; render(); load(); return; }
  if ('docOpen' in t.dataset) { AOS.haptic('light'); AOS.openPage('doctrine'); return; }
  if (t.dataset.docAccept) return act('accept', `/mod/doctrine/observations/${t.dataset.docAccept}/accept`, () => AOS.toast('Rule added. Plan my day obeys it from now.'));
  if (t.dataset.docDecline) return act('decline', `/mod/doctrine/observations/${t.dataset.docDecline}/decline`, () => AOS.toast('Noted. Nothing changes.'));
  if (t.dataset.docRetire) return act('retire', `/mod/doctrine/rules/${t.dataset.docRetire}/retire`, () => AOS.toast('Rule retired.'));
  if ('docObserve' in t.dataset) return act('observe', '/mod/doctrine/observe', (r) => AOS.toast(r.observation ? 'Observation ready.' : r.reason || 'Nothing to observe yet.'));
}
const bind = (el) => { if (el && !el._docBound) { el._docBound = true; el.addEventListener('click', onClick); } };

AOS.register({
  id: 'doctrine', title: 'Doctrine', order: 30,
  icon: ICON, figure,
  page(el) { pageEl = el; bind(el); renderPage(); load(); },
  cards: { life(el) { lifeEl = el; bind(el); renderLife(); if (!st && !loading) load(); } },
  onData() { load(); },
});

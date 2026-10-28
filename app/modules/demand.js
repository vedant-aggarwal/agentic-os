// Demand radar: clusters of repeated asks ranked by how many clients asked, each heavy cluster a product candidate
// (spec, a price marked as a guess, a landing draft) to Build or Drop. A cluster opens as its own page. Plus a box for
// a pasted chat or thread, and a button to run the radar now. Server: server/modules/demand.ts (/api/v1/mod/demand/...).
// Design: j15/mockup/final/js/more.js PAGES.demand, in the module frame of app/ui/screens/content.css (area (d)).
const { AOS } = window;
AOS.css('modules/demand.css');

const API = '/api/v1/mod/demand';
const I = AOS.icons;
const ICON = I.radar;
const esc = AOS.esc;
let state = { clusters: [], unclustered: 0, status: null, error: null, loaded: false, showDropped: false };
let busy = '';               // 'run' | 'import' | 'status'
let pageEl = null, loadedAt = 0, lastFig = '';
let detail = null;           // the cluster page open now: { id, box, el, data, error }
let inline = null;           // an app without pushed pages: the cluster drawn in place of the list
const IST = { timeZone: 'Asia/Kolkata' };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short' }) : '');
const SOURCE = { lead: 'Lead', capture: 'Capture', chat: 'Chat', manual: 'Pasted' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? `${one}s`}`;
const word = (text, c) => `<span class="mp-st" style="--c:${c}">${esc(text)}</span>`;
const spin = '<span class="spin" aria-hidden="true"></span>';

/** The little markdown the candidates use: headings, bullets, bold, paragraphs. Escaped first. */
function md(src) {
  const lines = esc(src || '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
  let html = '', list = false, para = [];
  const flush = () => { if (para.length) { html += `<p>${para.join(' ')}</p>`; para = []; } };
  const endList = () => { if (list) { html += '</ul>'; list = false; } };
  for (const raw of lines) {
    const l = raw.trim();
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { flush(); endList(); html += `<h${h[1].length + 2}>${h[2]}</h${h[1].length + 2}>`; continue; }
    if (/^[-*]\s+/.test(l)) { flush(); if (!list) { html += '<ul>'; list = true; } html += `<li>${l.replace(/^[-*]\s+/, '')}</li>`; continue; }
    if (!l) { flush(); endList(); continue; }
    para.push(l);
  }
  flush(); endList();
  return html;
}
const who = (c) => (c.clientCount ? `${plural(c.clientCount, 'client')}: ${c.clients.join(', ')}` : 'no client named');
// a cluster's state is a word: new, spec coming, spec ready (yours to decide), building, dropped
function statusWord(c) {
  if (c.status === 'dropped') return word('Dropped', 'var(--ink-3)');
  if (c.status === 'building') return word('Building', 'var(--done)');
  if (c.candidate) return word('Spec ready', 'var(--needs-ink)');
  if (c.ready) return word('Spec next run', 'var(--ink-2)');
  return word('New', 'var(--ink-3)');
}

async function load() {
  try {
    const [l, s] = await Promise.all([AOS.api(`${API}/clusters${state.showDropped ? '?all=1' : ''}`), AOS.api(`${API}/status`)]);
    state = { ...state, clusters: l.clusters, unclustered: l.unclustered, status: s, error: null, loaded: true };
    loadedAt = Date.now();
  } catch (e) { state = { ...state, error: e.message || 'Your PC isn’t reachable right now.', loaded: true }; }
  render();
  if (detail?.el?.isConnected || inline) loadDetail();
  // More redraws when the figure changed and its list is what you are looking at (not a page pushed over it)
  const f = JSON.stringify(figure());
  if (f !== lastFig) {
    lastFig = f;
    const ui = AOS.ui?.();
    if (ui?.tab === 'more' && !ui.stack?.more?.length) AOS.renderTab?.('more');
  }
}
// More's row: a spec waiting for your Build or Drop first, else how many asks repeat (app.js renderMore reads figure())
function figure() {
  if (!state.status) return null;
  const live = state.clusters.filter((c) => c.status !== 'dropped');
  const decide = live.filter((c) => c.candidate && c.status !== 'building').length;
  if (decide) return { value: String(decide), label: decide === 1 ? 'Spec to decide' : 'Specs to decide' };
  if (live.length) return { value: String(live.length), label: live.length === 1 ? 'Repeated ask' : 'Repeated asks' };
  return { value: '', label: 'No repeated asks yet' };
}
async function loadDetail() {
  const d = detail ?? inline;
  if (!d) return;
  try { d.data = await AOS.api(`${API}/clusters/${d.id}`); d.error = null; }
  catch (e) { d.error = e.message || 'Couldn’t open that cluster.'; }
  renderDetail();
}

// ── the list page ─────────────────────────────────────────────────────────
const head = () => `<div class="mp-head"><span class="mp-ic" aria-hidden="true">${ICON}</span><h1 class="large-title">Demand radar</h1><p class="sub">The same ask from more than one client, ranked, with a price guess.</p></div>`;
function clusterRow(c, i) {
  const asks = plural(c.count, 'ask');
  return `<button class="lrow dr-row${c.status === 'dropped' ? ' mp-off' : ''}" data-dr-open="${c.id}" aria-label="${esc(c.title)}: ${esc(asks)}, ${esc(who(c))}. Open">
    <span class="dr-rank num" aria-hidden="true">${i + 1}</span>
    <span class="rbody"><span class="rtitle wrap">${esc(c.title)}</span><span class="rmeta">${statusWord(c)}<span>·</span><span class="ell">${esc(asks)}, ${esc(who(c))}</span></span></span>
    ${I.chevR}
  </button>`;
}
function lanesHint() {
  const s = state.status;
  if (!s) return '';
  const lanes = ['pasted chats', 'captures', s.pulseChat ? 'Pulse Chat' : ''].filter(Boolean).join(', ');
  const last = s.lastRun?.at ? `last ran ${esc(day(s.lastRun.at))}` : 'has not run yet';
  const wait = state.unclustered ? ` <b>${plural(state.unclustered, 'ask')}</b> ${state.unclustered === 1 ? 'waits' : 'wait'} for the next run.` : '';
  return `<p class="mp-hint">It runs by itself at 05:30 and ${last}. It reads ${esc(lanes)}.${wait}</p>`;
}
function formHTML() {
  const clients = state.status?.clients ?? [];
  const on = busy === 'import';
  return `<div class="sh"><h2>Paste asks</h2></div>
    <form class="mp-card dr-form" data-form="import">
      <label class="ifield dr-ta"><textarea name="text" rows="5" placeholder="Paste a WhatsApp export, an email thread, or a few asks, one per line" aria-label="Asks to add" required></textarea></label>
      <div class="dr-pair">
        <label class="ifield dr-sel"><select name="source" aria-label="Where the asks came from"><option value="chat">Chat export</option><option value="manual">Notes</option><option value="lead">Lead</option></select>${I.chevD}</label>
        <label class="ifield dr-sel"><select name="client" aria-label="Which client asked"><option value="">No client</option>${clients.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join('')}</select>${I.chevD}</label>
      </div>
      <button class="btn primary block" type="submit" ${on ? 'disabled' : ''}>${on ? `${spin}Splitting with Haiku` : 'Split into asks'}</button>
    </form>`;
}
function listHTML() {
  if (!state.loaded) return `${head()}<div class="mp-load" role="status">${spin}Asking your PC</div>`;
  if (state.error && !state.status) return `${head()}<div class="note mp-note fail" role="alert"><b>${esc(state.error)}</b><span>The radar lives on your PC.</span><button class="btn sm" data-act="retry">Try again</button></div>`;
  const rows = state.clusters.map(clusterRow).join('');
  const run = busy === 'run';
  return `${head()}
    <div class="sh"><h2>Clusters</h2>${state.clusters.length ? `<span class="sh-count">${state.clusters.length}</span>` : ''}</div>
    ${rows ? '' : `<div class="note dr-empty">No clusters yet. Paste a chat below, or run the radar after captures come in.</div>`}
    <div class="group dr-list">${rows}
      <label class="lrow dr-sw"><span class="rbody"><span class="rtitle">Show dropped clusters</span></span><input type="checkbox" switch data-act="dropped" ${state.showDropped ? 'checked' : ''} aria-label="Show dropped clusters"></label>
    </div>
    ${formHTML()}
    <div class="mp-foot"><button class="btn block" data-act="run" ${run ? 'disabled' : ''}>${run ? `${spin}Running the radar` : `${ICON}Run the radar now`}</button></div>
    ${lanesHint()}`;
}
function render() {
  if (!pageEl?.isConnected) return;
  if (inline) { renderDetail(); return; }
  // a redraw keeps what you pasted
  const ta = pageEl.querySelector('form[data-form="import"] textarea');
  const keep = ta ? { v: ta.value, src: pageEl.querySelector('select[name="source"]')?.value, cl: pageEl.querySelector('select[name="client"]')?.value } : null;
  pageEl.innerHTML = listHTML();
  if (keep) {
    const f = pageEl.querySelector('form[data-form="import"]');
    if (f) { f.text.value = keep.v; if (keep.src) f.source.value = keep.src; if (keep.cl != null) f.client.value = keep.cl; }
  }
}

// ── a cluster: its own pushed page (asks, the candidate, Build or Drop) ──
function detailHTML(d) {
  if (d.error && !d.data) return `<div class="note mp-note fail" role="alert"><b>${esc(d.error)}</b><button class="btn sm" data-act="detail-retry">Try again</button></div>`;
  if (!d.data) return `<div class="mp-load" role="status">${spin}Opening the cluster</div>`;
  const c = d.data.cluster, k = d.data.candidate, items = d.data.items ?? [];
  const on = busy === 'status';
  const acts = `<div class="mp-acts dr-acts">
      ${c.status === 'building' ? word('Building', 'var(--done)') : `<button class="btn sm primary" data-act="build" ${on ? 'disabled' : ''}>${on ? spin : I.hammer}Build</button>`}
      ${c.status === 'dropped' ? `<button class="btn sm" data-act="restore" ${on ? 'disabled' : ''}>${I.undo}Restore</button>` : `<button class="btn sm dr-drop" data-act="drop" ${on ? 'disabled' : ''} aria-label="Drop this cluster">${I.trash}Drop</button>`}
    </div>`;
  const cand = k ? `
    <div class="mp-card dr-price"><p class="mp-k">Price guess</p><p class="dr-pv num">${esc(k.priceGuess || 'Not priced')}</p><p class="foot">A guess, not a quote.</p></div>
    <div class="sh"><h2>Spec</h2></div><div class="mp-card dr-md">${md(k.spec)}</div>
    <div class="sh"><h2>Landing draft</h2></div><div class="mp-card dr-md">${md(k.landing)}</div>`
    : `<div class="note dr-wait">${c.ready ? 'The spec, price guess and landing draft come with the next radar run.' : 'A spec is written once 3 people ask, or 2 clients do.'}</div>`;
  const asks = items.map((i) => `<div class="lrow mp-tall dr-ask"><span class="rbody"><span class="dr-ask-t">${esc(i.text)}</span><span class="rmeta"><span class="ell">${esc([i.client || 'No client named', SOURCE[i.source] ?? i.source, i.askedAt ? day(i.askedAt) : ''].filter(Boolean).join(' · '))}</span></span></span></div>`).join('');
  return `<div class="mp-head dr-dhead"><span class="mp-ic" aria-hidden="true">${ICON}</span><h1 class="large-title dr-title">${esc(c.title)}</h1>
      <p class="sub">${statusWord(c)} · ${esc(plural(c.count, 'ask'))}, ${esc(who(c))}</p></div>
    ${acts}
    ${cand}
    <div class="sh"><h2>Asks</h2><span class="sh-count">${items.length}</span></div>
    ${asks ? `<div class="group">${asks}</div>` : '<div class="note">The asks behind this cluster were removed.</div>'}`;
}
function renderDetail() {
  if (inline && pageEl?.isConnected) {
    pageEl.innerHTML = `<button class="btn sm dr-back" data-act="back">${I.chevL}Clusters</button>${detailHTML(inline)}`;
    return;
  }
  if (!detail?.box?.isConnected) return;
  detail.box.innerHTML = detailHTML(detail);
  const t = detail.el.querySelector('.nav-title');
  if (t && detail.data) t.textContent = detail.data.cluster.title;
}
function open(id) {
  AOS.haptic('light');
  if (typeof AOS.push === 'function' && typeof AOS.detail === 'function') {
    try { AOS.push('demand-cluster', String(id)); return; } catch (e) { console.warn('[demand] push', e); }
  }
  inline = { id, data: null, error: null };
  renderDetail();
  pageEl.closest('.scroller')?.scrollTo?.({ top: 0 });
  loadDetail();
}
AOS.detail?.('demand-cluster', {
  render(box, id, el) {
    detail = { id: Number(id), box, el, data: null, error: null };
    box.classList.add('mod-page', 'dr-page');
    box.addEventListener('click', onClick);
    const t = el.querySelector('.nav-title');
    if (t) t.textContent = state.clusters.find((c) => c.id === Number(id))?.title ?? 'Cluster';
    renderDetail();
    loadDetail();
  },
});
async function setStatus(id, status) {
  if (busy) return;
  busy = 'status'; renderDetail();
  try {
    const r = await AOS.api(`${API}/clusters/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
    AOS.haptic(status === 'dropped' ? 'medium' : 'success');
    AOS.toast(status === 'building' ? (r.task ? `Build task ${r.task.id} filed` : 'Marked as building') : status === 'dropped' ? 'Dropped' : 'Restored');
  } catch (e) { AOS.toast(e.message || 'That didn’t work'); }
  busy = '';
  await load();
}

// ── events ────────────────────────────────────────────────────────────────
function onClick(e) {
  const row = e.target.closest('[data-dr-open]');
  if (row) { open(Number(row.dataset.drOpen)); return; }
  const b = e.target.closest('[data-act]');
  if (!b || b.matches('input') || b.disabled) return;
  const act = b.dataset.act;
  const id = (detail?.box?.contains(b) ? detail.id : inline?.id) ?? null;
  if (act === 'retry') { state.loaded = false; state.error = null; render(); load(); return; }
  if (act === 'detail-retry') { loadDetail(); return; }
  if (act === 'back') { inline = null; render(); return; }
  if (act === 'build' && id != null) { setStatus(id, 'building'); return; }
  if (act === 'drop' && id != null) { setStatus(id, 'dropped'); return; }
  if (act === 'restore' && id != null) { setStatus(id, 'new'); return; }
  if (act === 'run') runRadar();
}
async function runRadar() {
  if (busy) return;
  busy = 'run'; render();
  try {
    const r = await AOS.api(`${API}/run`, { method: 'POST', body: '{}' });
    const x = r.run;
    AOS.haptic('success');
    AOS.toast(`${x.clustered} clustered (${x.created} new), ${plural(x.candidates, 'candidate')}${x.error ? ' · one step failed' : ''}`);
  } catch (err) { AOS.toast(err.message || 'The radar failed'); }
  busy = '';
  await load();
}

AOS.register({
  id: 'demand', title: 'Demand radar', order: 21,
  icon: ICON,
  figure,
  page(el) {
    pageEl = el;
    inline = null;
    render();
    load();
    el.addEventListener('click', onClick);
    el.addEventListener('change', (e) => {
      if (e.target.matches('[data-act="dropped"]')) { state.showDropped = e.target.checked; AOS.haptic('selection'); load(); }
    });
    el.addEventListener('submit', async (e) => {
      const f = e.target.closest('form[data-form="import"]');
      if (!f) return;
      e.preventDefault();
      if (busy) return;
      const text = f.text.value.trim();
      if (!text) { f.text.focus(); return; }
      busy = 'import'; render();
      try {
        const r = await AOS.api(`${API}/import`, { method: 'POST', body: JSON.stringify({ text, source: f.source.value, client: f.client.value || undefined }) });
        AOS.haptic('success');
        AOS.toast(`${plural(r.added, 'ask')} added${r.skipped ? `, ${r.skipped} already there` : ''}. Run the radar to cluster them.`);
        const ta = pageEl?.querySelector('form[data-form="import"] textarea');
        if (ta) ta.value = '';
      } catch (err) { AOS.toast(err.message || 'Could not import'); }
      busy = '';
      await load();
    });
  },
  // reads again on every sync while a page is open; otherwise every five minutes, for More's figure
  onData() { if (pageEl?.isConnected || detail?.box?.isConnected || Date.now() - loadedAt > 5 * 60_000) load(); },
});

// Client pages (the Client window module): the owner's side. Clients with their public link (copy, preview, open,
// revoke, make one), the decisions waiting on clients and the answers that came back, Claude's questions that can be
// handed to a client, and forms to ask one yourself or add a client. It opens from Clients → Client pages (crm.js);
// More no longer lists it. Server: server/modules/clients.ts (/api/v1/mod/clients/...).
// Design: j15/mockup/final/js/more.js PAGES.clients, in the module frame of app/ui/screens/content.css (area (d)).
const { AOS } = window;
AOS.css('modules/clients.css');

const API = '/api/v1/mod/clients';
const I = AOS.icons;
const ICON = I.window;
let state = { clients: [], projects: [], decisions: [], questions: [], error: null, loaded: false };
let pageEl = null, cardEl = null, sheet = null, sheetEl = null, preview = null, busy = '';
const esc = AOS.esc;
const IST = { timeZone: 'Asia/Kolkata' };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { ...IST, day: 'numeric', month: 'short' }) : '');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? `${one}s`}`;
const word = (text, c) => `<span class="mp-st" style="--c:${c}">${esc(text)}</span>`;
const spin = '<span class="spin" aria-hidden="true"></span>';
const ago = (iso) => {
  if (!iso) return 'Not opened yet';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 2) return 'Opened just now'; if (m < 60) return `Opened ${m} min ago`; if (m < 48 * 60) return `Opened ${Math.round(m / 60)} h ago`;
  return `Opened ${day(iso)}`;
};
const pageUrl = (c) => (c.link ? (/^https?:/.test(location.origin) ? `${location.origin}${c.link.path}` : c.link.url) : null);
const shortUrl = (u) => String(u ?? '').replace(/^https?:\/\//, '');
const nameOf = (slug) => state.clients.find((x) => x.slug === slug)?.name ?? slug;

async function load() {
  try {
    const [a, d, q] = await Promise.all([AOS.api(`${API}/`), AOS.api(`${API}/decisions?all=1`), AOS.api(`${API}/questions`).catch(() => ({ questions: [] }))]);
    state = { clients: a.clients, projects: a.projects, decisions: d.decisions, questions: q.questions ?? [], error: null, loaded: true };
  } catch (e) { state = { ...state, error: e.message || 'Your PC isn’t reachable right now.', loaded: true }; }
  renderPage();
  renderCard();
}

// ── the page ──────────────────────────────────────────────────────────────
const head = () => `<div class="mp-head"><span class="mp-ic" aria-hidden="true">${ICON}</span><h1 class="large-title">Client pages</h1><p class="sub">A private page per client: what shipped, what is next, and the questions waiting on them. Their answers land here.</p></div>`;
function clientRow(c) {
  const open = state.decisions.filter((d) => d.client === c.slug && d.status === 'open').length;
  const meta = [c.link ? ago(c.link.lastSeen) : 'No link yet', c.viewsThisWeek ? `${plural(c.viewsThisWeek, 'view')} this week` : '', open ? `${open} waiting` : '', c.answeredThisWeek ? `${c.answeredThisWeek} answered` : ''].filter(Boolean).join(' · ');
  const on = (a) => busy === `${a}:${c.slug}`;
  // the link itself opens their page; Preview shows it here first
  const acts = c.link
    ? `<button class="btn sm" data-act="preview">${I.eye}Preview</button><button class="btn sm cw-revoke" data-act="revoke" ${busy ? 'disabled' : ''}>${on('revoke') ? spin : ''}Revoke</button>`
    : `<button class="btn sm" data-act="link" ${busy ? 'disabled' : ''}>${on('link') ? spin : I.link}Make a link</button>`;
  return `<div class="lrow ic mp-tall cw-client${c.active ? '' : ' cw-off'}" data-slug="${esc(c.slug)}">
    <span class="tile">${I.window}</span>
    <span class="rbody">
      <span class="rtitle">${esc(c.name)}</span>
      ${c.link ? `<a class="cw-link" href="${esc(pageUrl(c))}" target="_blank" rel="noopener" aria-label="Open ${esc(c.name)}’s page">${esc(shortUrl(c.link.url))}</a>` : ''}
      <span class="mp-why">${c.active ? '' : `${word('Inactive', 'var(--ink-3)')} · `}${esc(c.projects.join(', ') || 'No projects')} · ${esc(meta)}</span>
      <span class="mp-racts">${acts}</span>
    </span>
    ${c.link ? `<button class="btn cw-copy" data-act="copy" aria-label="Copy ${esc(c.name)}’s link">${I.copy}</button>` : ''}
  </div>`;
}
function decisionRow(d) {
  if (d.status === 'open') {
    const meta = [nameOf(d.client), `asked ${day(d.createdAt)}`, d.source ? `from ${d.source}` : '', d.options.length ? d.options.join(' / ') : ''].filter(Boolean).join(' · ');
    return `<div class="lrow mp-tall cw-dec"><span class="rbody"><span class="cw-q">${esc(d.question)}</span><span class="mp-why">${esc(meta)}</span></span></div>`;
  }
  return `<div class="lrow mp-tall cw-dec"><span class="rbody"><span class="cw-q">${esc(d.question)}</span><span class="mp-why"><b class="cw-ans">${esc(nameOf(d.client))}: ${esc(d.answer)}</b> · ${esc(day(d.answeredAt))}</span></span></div>`;
}
function questionRow(q) {
  return `<div class="lrow mp-tall cw-dec" data-task="${esc(q.task)}"><span class="rbody"><span class="cw-q">${esc(q.question)}</span>
    <span class="mp-why">Claude on ${esc(q.task)} · ${esc(q.title)} · ${esc(q.clientName)}</span>
    <span class="mp-racts">${q.marked ? word(`On ${q.clientName}’s page`, 'var(--done)') : `<button class="btn sm" data-act="ask-task" ${busy ? 'disabled' : ''}>${busy === `ask:${q.task}` ? spin : I.send}Ask the client</button>`}</span></span></div>`;
}
const sel = (name, label, opts) => `<label class="ifield cw-sel"><select name="${name}" aria-label="${esc(label)}" required>${opts}</select>${I.chevD}</label>`;
const field = (name, ph, extra = '') => `<label class="ifield"><input name="${name}" placeholder="${esc(ph)}" aria-label="${esc(ph)}" ${extra}></label>`;
function renderPage() {
  if (!pageEl?.isConnected) return;
  const typed = keepForms();
  const open = state.decisions.filter((d) => d.status === 'open');
  const answered = state.decisions.filter((d) => d.status === 'answered').slice(0, 12);
  const active = state.clients.filter((c) => c.active);
  let body;
  if (!state.loaded) body = `<div class="mp-load" role="status">${spin}Asking your PC</div>`;
  else if (state.error && !state.clients.length) body = `<div class="note mp-note fail" role="alert"><b>${esc(state.error)}</b><span>Client pages live on your PC.</span><button class="btn sm" data-act="retry">Try again</button></div>`;
  else body = `
    <div class="sh"><h2>Clients</h2>${state.clients.length ? `<span class="sh-count">${state.clients.length}</span>` : ''}</div>
    ${state.clients.length ? `<div class="group cw-list">${state.clients.map(clientRow).join('')}</div>` : '<div class="note">No clients yet. Add one below, over its agentos projects, then make their link.</div>'}
    <div class="sh"><h2>Waiting on clients</h2>${open.length ? `<span class="sh-count">${open.length}</span>` : ''}</div>
    ${open.length ? `<div class="group">${open.map(decisionRow).join('')}</div>` : '<div class="note">Nothing is waiting on a client.</div>'}
    ${state.questions.length ? `<div class="sh"><h2>Claude is asking</h2><span class="sh-count">${state.questions.length}</span></div><div class="group">${state.questions.map(questionRow).join('')}</div>` : ''}
    <div class="sh"><h2>Ask a client</h2></div>
    ${active.length ? `<form class="mp-card cw-form" data-form="ask">
      ${sel('client', 'Which client', active.map((c) => `<option value="${esc(c.slug)}">${esc(c.name)}</option>`).join(''))}
      ${field('question', 'The question, as they would read it', 'maxlength="500" required')}
      ${field('options', 'Choices, like Yes | No', 'maxlength="300"')}
      ${field('source', 'The task it is about, like t12', 'maxlength="12" autocapitalize="off" spellcheck="false"')}
      <p class="foot cw-opt">Choices and the task are optional. Without choices they answer in their own words.</p>
      <button class="btn primary block" type="submit" ${busy ? 'disabled' : ''}>${busy === 'form:ask' ? spin : ''}Put it on their page</button>
    </form>` : '<div class="note">Add a client first. Then a question you write here shows on their page.</div>'}
    ${answered.length ? `<div class="sh"><h2>Answered</h2><span class="sh-count">${answered.length}</span></div><div class="group">${answered.map(decisionRow).join('')}</div>` : ''}
    <div class="sh"><h2>New client</h2></div>
    <form class="mp-card cw-form" data-form="client">
      ${field('name', 'Name, as on their page', 'maxlength="80" required')}
      ${field('slug', 'Short name for the link, like tara-sons', 'pattern="[a-z0-9][a-z0-9\\-]*" maxlength="40" required autocapitalize="off" spellcheck="false"')}
      ${state.projects.length ? `<p class="mp-k cw-pk">Projects on their page</p><div class="chips cw-projects" role="group" aria-label="Projects on their page">${state.projects.map((p) => `<button type="button" class="chip-btn" data-cw-proj="${esc(p.slug)}" aria-pressed="false">${esc(p.name)}</button>`).join('')}</div>` : ''}
      ${field('contactName', 'Contact name', 'maxlength="80"')}
      ${field('contactChannel', 'Channel, like whatsapp:+91…', 'maxlength="80" autocapitalize="off"')}
      <p class="foot cw-opt">The contact is optional. Projects come from agentos.</p>
      <button class="btn block" type="submit" ${busy ? 'disabled' : ''}>${busy === 'form:client' ? spin : ''}Add client</button>
    </form>`;
  pageEl.innerHTML = head() + body;
  restoreForms(typed);
}
// a redraw keeps what you typed in either form, and the projects you picked
function keepForms() {
  const out = {};
  for (const f of pageEl?.querySelectorAll('form[data-form]') ?? []) {
    out[f.dataset.form] = { fields: Object.fromEntries([...f.querySelectorAll('input, select')].map((i) => [i.name, i.value])), picked: [...f.querySelectorAll('[data-cw-proj][aria-pressed="true"]')].map((b) => b.dataset.cwProj) };
  }
  return out;
}
function restoreForms(typed) {
  for (const f of pageEl?.querySelectorAll('form[data-form]') ?? []) {
    const t = typed[f.dataset.form];
    if (!t) continue;
    for (const [k, v] of Object.entries(t.fields)) { const i = f.querySelector(`[name="${k}"]`); if (i && v) i.value = v; }
    for (const s of t.picked) { const b = f.querySelector(`[data-cw-proj="${CSS.escape(s)}"]`); if (b) { b.setAttribute('aria-pressed', 'true'); b.classList.add('on'); } }
  }
}
function clearForm(name) {
  const f = pageEl?.querySelector(`form[data-form="${name}"]`);
  if (!f) return;
  f.reset();
  for (const b of f.querySelectorAll('[data-cw-proj]')) { b.setAttribute('aria-pressed', 'false'); b.classList.remove('on'); }
}

// ── Today: a client answered, or questions wait on clients ────────────────
function renderCard() {
  if (!cardEl) return;
  const open = state.decisions.filter((d) => d.status === 'open');
  const today = new Date().toLocaleDateString('en-CA', IST);
  const fresh = state.decisions.filter((d) => d.status === 'answered' && d.answeredAt && new Date(d.answeredAt).toLocaleDateString('en-CA', IST) === today);
  if (!open.length && !fresh.length) { cardEl.innerHTML = ''; return; }
  const title = fresh.length ? `${plural(fresh.length, 'client answer')} today` : `${plural(open.length, 'question')} waiting on clients`;
  const names = [...new Set((fresh.length ? fresh : open).map((d) => nameOf(d.client)))].join(', ');
  const meta = [names, fresh.length && open.length ? `${open.length} still waiting` : ''].filter(Boolean).join(' · ');
  cardEl.innerHTML = `<button class="lrow b-row mcard" data-open-clients><span class="bi">${ICON}</span><span class="rbody"><span class="rtitle">${esc(title)}</span><span class="rmeta"><span class="ell">${esc(meta)}</span></span></span>${I.chevR}</button>`;
}

// ── the preview sheet: the client's page, rendered from the same payload ──
function ensureSheet() {
  if (sheet) return sheet;
  sheetEl = document.createElement('section');
  sheetEl.className = 'sheet cw-sheet mp-sheet';
  sheetEl.setAttribute('role', 'dialog');
  sheetEl.setAttribute('aria-label', 'Client page preview');
  sheetEl.setAttribute('aria-hidden', 'true');
  sheetEl.innerHTML = `<div class="grabber"></div><div class="sheet-head"><div class="cw-shead"><div class="cw-shead-t"><h2>Preview</h2><p>What the client sees</p></div><button class="sheet-close" data-act="close" aria-label="Close">${I.x}</button></div></div><div class="sheet-body cw-sheet-body"></div>`;
  (document.getElementById('screen') ?? document.body).appendChild(sheetEl);
  sheet = AOS.makeSheet(sheetEl, { detents: (H) => ({ large: 0, half: Math.round(H * 0.3) }), scrimFor: (y, H) => Math.min(1, Math.max(0, 1 - y / (H * 0.85))) });
  sheetEl.addEventListener('click', (e) => { if (e.target.closest('[data-act="close"]')) sheet.close(); });
  return sheet;
}
const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
function previewHTML(p, c) {
  const row = (mark, t, m) => `<div class="lrow mp-tall cw-prow">${mark}<span class="rbody"><span class="cw-pt">${t}</span>${m ? `<span class="mp-why">${m}</span>` : ''}</span></div>`;
  const dec = p.decisions.map((d) => row('<span class="cw-mark cw-m-ask" aria-hidden="true">?</span>', esc(d.question), d.options.length ? `<span class="cw-opts">${d.options.map((o) => `<span class="chip">${esc(o)}</span>`).join('')}</span>` : 'A free answer')).join('');
  const shipped = p.shipped.map((t) => row(`<span class="cw-mark cw-m-done" aria-hidden="true">${I.check}</span>`, esc(t.title), `${esc(day(t.doneAt))}${t.evidence?.text ? ` · ${esc(t.evidence.text)}` : ''}${(t.evidence?.links ?? []).map((l) => ` · <a href="${esc(l)}" target="_blank" rel="noopener">${esc(host(l))}</a>`).join('')}`)).join('');
  const next = p.next.map((t) => row('<span class="cw-mark cw-m-next" aria-hidden="true"></span>', esc(t.title), `${t.doing ? 'In progress · ' : ''}${t.due ? `Due ${esc(day(`${t.due}T00:00:00+05:30`))}` : 'No date yet'}`)).join('');
  const block = (label, html, empty) => `<p class="cw-gl">${label}</p>${html ? `<div class="group">${html}</div>` : `<div class="note">${empty}</div>`}`;
  return `<div class="cw-prev-head"><p class="mp-k">Northwind · your window</p><h3>${esc(p.client.name)}</h3><p class="foot">${esc(p.client.projects.join(', '))}</p></div>
    ${block('Decisions', dec, 'Nothing waiting on them.')}${block('Shipped · last 14 days', shipped, 'Nothing finished in the last two weeks.')}${block('Next', next, 'Nothing lined up.')}
    <div class="cw-prev-foot"><a class="btn primary block" href="${esc(pageUrl(c))}" target="_blank" rel="noopener">${I.window}Open the real page</a><button class="btn block" data-act="close">Close</button></div>`;
}
async function openPreview(c) {
  const s = ensureSheet();
  const body = sheetEl.querySelector('.cw-sheet-body');
  sheetEl.querySelector('.sheet-head p').textContent = `What ${c.name} sees`;
  body.innerHTML = `<div class="mp-load" role="status">${spin}Reading their page</div>`;
  s.open('large');
  try { preview = await AOS.api(`${API}/${c.slug}/preview`); body.innerHTML = previewHTML(preview, c); }
  catch (e) { body.innerHTML = `<div class="note mp-note fail" role="alert"><b>${esc(e.message || 'Could not load the preview.')}</b></div>`; }
}

async function act(slug, action) {
  const c = state.clients.find((x) => x.slug === slug);
  if (!c || (busy && action !== 'copy' && action !== 'preview')) return;
  try {
    if (action === 'copy') {
      const url = c.link.url;
      try { await navigator.clipboard.writeText(url); AOS.toast('Link copied'); } catch { if (navigator.share) await navigator.share({ url }); else AOS.toast(url); }
      AOS.haptic('success');
    } else if (action === 'link') {
      busy = `link:${slug}`; renderPage();
      const r = await AOS.api(`${API}/${slug}/link`, { method: 'POST', body: '{}' });
      AOS.haptic('success'); AOS.toast(r.minted ? 'Link made. Copy it to send.' : 'Link ready');
    } else if (action === 'revoke') {
      if (!confirm(`Revoke ${c.name}’s link? Their page stops working until you make a new one.`)) return;
      busy = `revoke:${slug}`; renderPage();
      await AOS.api(`${API}/${slug}/revoke`, { method: 'POST', body: '{}' });
      AOS.haptic('medium'); AOS.toast('Link revoked');
    } else if (action === 'preview') { AOS.haptic('light'); await openPreview(c); return; }
  } catch (e) { AOS.toast(e.message || 'That didn’t work'); }
  if (action === 'link' || action === 'revoke') { busy = ''; await load(); }
}

AOS.register({
  id: 'clients', title: 'Client pages', order: 20,
  icon: ICON,
  page(el) {
    pageEl = el;
    renderPage();
    load();
    el.addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-cw-proj]');
      if (chip) { const on = chip.getAttribute('aria-pressed') !== 'true'; chip.setAttribute('aria-pressed', String(on)); chip.classList.toggle('on', on); AOS.haptic('selection'); return; }
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      if (b.dataset.act === 'retry') { state.loaded = false; renderPage(); load(); return; }
      const row = b.closest('[data-slug]');
      if (row) { act(row.dataset.slug, b.dataset.act); return; }
      const qrow = b.closest('[data-task]');
      if (qrow && b.dataset.act === 'ask-task') {
        if (busy) return;
        busy = `ask:${qrow.dataset.task}`; renderPage();
        try { await AOS.api(`${API}/asks`, { method: 'POST', body: JSON.stringify({ task: qrow.dataset.task }) }); AOS.haptic('success'); AOS.toast('On their page'); }
        catch (err) { AOS.toast(err.message || 'That didn’t work'); }
        busy = ''; await load();
      }
    });
    el.addEventListener('submit', async (e) => {
      const f = e.target.closest('form[data-form]');
      if (!f) return;
      e.preventDefault();
      if (busy) return;
      const kind = f.dataset.form;
      const body = kind === 'ask'
        ? { client: f.client.value, question: f.question.value.trim(), options: f.options.value.split('|').map((s) => s.trim()).filter(Boolean), source: f.source.value.trim() || undefined }
        : { name: f.name.value.trim(), slug: f.slug.value.trim(), projects: [...f.querySelectorAll('[data-cw-proj][aria-pressed="true"]')].map((x) => x.dataset.cwProj), contactName: f.contactName.value.trim() || undefined, contactChannel: f.contactChannel.value.trim() || undefined };
      busy = `form:${kind}`; renderPage();
      try {
        await AOS.api(kind === 'ask' ? `${API}/decisions` : `${API}/`, { method: 'POST', body: JSON.stringify(body) });
        AOS.toast(kind === 'ask' ? 'On their page' : 'Client added. Make their link.');
        AOS.haptic('success');
        clearForm(kind);
      } catch (err) { AOS.toast(err.message || 'That didn’t work'); }
      busy = '';
      await load();
    });
  },
  cards: {
    todayTop(el) {
      cardEl = el;
      renderCard();
      if (!el._cwBound) { el._cwBound = true; el.addEventListener('click', (e) => { if (e.target.closest('[data-open-clients]')) { AOS.haptic('light'); AOS.openPage('clients'); } }); }
    },
  },
  onData() { if (pageEl?.isConnected || cardEl) load(); },
});
load();

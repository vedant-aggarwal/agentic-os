// Clients: the Clients tab. server/modules/crm.ts reads the owner's client system on the PC (northwind-brain, the mind;
// northwind-os, the body); this draws it: the money ring and the health split, Clients · Leads · Pipeline, and a page per
// client and lead that mirrors its files. Nothing here edits a file itself: anything that would change one starts a job
// on the PC, prefilled with the client's folder as the place to work. The one direct write, Log work, needs CRM_WRITE=on
// on the server and says so while it's off. Design: j15/mockup/final/js/clients.js and css/screens/clients.css.
const { AOS } = window;
AOS.css('modules/crm.css');

const API = '/api/v1/mod/crm';
const esc = AOS.esc;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const LS = { view: 'aos-crm-view', pin: 'aos-crm-pin', done: 'aos-crm-done', cache: 'aos-crm-overview', engine: 'agentos-app:job-engine' };
const read = (k, d = null) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch {} };

// ── the design system: AOS hands it to modules; until it does, the same files are imported directly ──
let UI = null;
import('../ui/ui.js').then((m) => { UI = m; S.ver++; draw(); }).catch(() => {});
// four glyphs the system's set doesn't have yet, drawn on its 24-unit grid with its 2px line (from the mockup)
const sv = (d, x = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${x}>${d}</svg>`;
const LOCAL = {
  next: sv('<path d="M5 4.5v6.5a4 4 0 0 0 4 4h10M15 11l4 4-4 4"/>'),
  pinF: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><g class="ig ig-obsidian"><path d="M8.6 3.5h6.8l-.7 5.6 3.1 3.5v1.6H6.2v-1.6l3.1-3.5z"/><path d="M12 14.2V21" fill="none"/></g><g class="ig ig-matte"><path d="M9 3.5h6l-.8 5.3 3.3 3.4v1.5h-11v-1.5l3.3-3.4z"/><path d="M12 13.7v6.8" fill="none"/></g></svg>`,
  folderPlus: sv('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/>'),
  paste: sv('<rect x="5" y="4.5" width="14" height="16.5" rx="3"/><path d="M9 4.5V4a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4v.5M9 10.5h6M9 14h6M9 17.5h3.5"/>'),
};
const I = new Proxy({}, { get: (_, k) => AOS.icons?.[k] ?? UI?.I?.[k] ?? LOCAL[k] ?? '' });
const ring = (...a) => (AOS.ring ?? UI?.ring)?.(...a) ?? '';
const seg = (...a) => (AOS.seg ?? UI?.seg)?.(...a) ?? '';
const pulse = (el) => (AOS.pulse ?? UI?.pulse)?.(el);

// ── state ──
const S = {
  data: null, at: 0, error: null, offline: false, loading: null, ver: 0, drawn: -1,
  view: ['clients', 'leads', 'pipeline'].includes(read(LS.view)) ? read(LS.view) : 'clients',
  retired: false,
  full: new Map(),            // slug → the client with its whole log and files (GET clients/<slug>)
  leadFull: new Map(),
  pin: read(LS.pin),
  done: new Set(JSON.parse(read(LS.done, '[]') || '[]')),   // "slug:text" waiting-on-you items ticked on this phone
  logAll: new Set(),          // client pages showing every work-log entry
};
const D = () => S.data;
const clientOf = (slug) => S.full.get(slug) ?? D()?.clients.find((c) => c.slug === slug) ?? null;
const leadOf = (slug) => S.leadFull.get(slug) ?? D()?.leads.find((l) => l.slug === slug) ?? null;
const cap = (s) => String(s ?? '').charAt(0).toUpperCase() + String(s ?? '').slice(1);
const HEALTH = { green: 'On track', yellow: 'Needs attention', red: 'At risk' };
const HC = { green: 'var(--done)', yellow: 'var(--warn)', red: 'var(--fail)' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "21 Oct" never breaks between the day and the month
const day = (iso) => (/^\d{4}-\d\d-\d\d/.test(iso ?? '') ? `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]}` : String(iso ?? ''));
const dayYear = (iso) => (/^\d{4}-\d\d-\d\d/.test(iso ?? '') ? `${day(iso)}${iso.slice(0, 4) === (D()?.today ?? '').slice(0, 4) ? '' : ` ${iso.slice(0, 4)}`}` : String(iso ?? ''));
const ago = (ms) => { const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : day(new Date(ms + 330 * 60000).toISOString()); };
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// ASAP, today and overdue ask for you; no date is quiet. is-today lets a skin tell today from overdue
const dueTone = (d) => (/^today/i.test(d) ? 'late is-today' : /^(overdue|asap)/i.test(d) ? 'late' : /no date|unknown|not scheduled|not set/i.test(d) ? 'quiet' : '');
const dueRank = (d) => (/^(overdue|asap)/i.test(d) ? 0 : /^today/i.test(d) ? 1 : /no date|unknown/i.test(d) ? 3 : 2);
const isPinned = (c) => S.pin === c.slug;
const doneKey = (c, t) => `${c.slug}:${t}`;
// a hyphenated word (first-year) never breaks at its hyphen
const words = (t) => esc(t).replace(/[^\s-]+(?:-[^\s-]+)+/g, (w) => `<span class="cl-nw">${w}</span>`);
const count = (n, cls = 'sh-count') => (n ? `<span class="${cls}">${n}</span>` : '');
const nextLine = (icon, text, due, tone = '') => `<span class="cl-next"><span class="cl-next-i" aria-hidden="true">${icon}</span><span class="cl-next-b"><span class="cl-due ${tone}">${esc(due)}</span>${words(text)}</span></span>`;
const mono = (x, size = '') => `<span class="cl-mono ${size}" aria-hidden="true">${esc(x.mono)}${x.health ? `<i class="cl-hdot" style="--c:${HC[x.health]}"></i>` : ''}</span>`;
const warmth = (w) => {
  const n = { cold: 1, warm: 2, hot: 3 }[w] ?? 0;
  const label = w === 'unknown' || !w ? 'Not set' : cap(w);
  return `<span class="cl-warm" aria-label="Warmth: ${esc(label)}"><span class="cl-warm-b" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>${esc(label)}</span>`;
};
const snapNote = (c, key, file) => (c.src?.[key] === 'snapshot' ? `<p class="cl-src">No ${esc(file)} on your PC yet, so this is the ${esc(day(D()?.snapshotAt))} snapshot</p>` : '');

// ── loading: the overview, kept on this phone so the tab opens offline ──
// The kept copy draws at once; it only reads as offline once a fetch for a fresh one has failed.
function fromCache() { try { const c = JSON.parse(read(LS.cache) || 'null'); if (c?.d?.clients) { S.data = c.d; S.at = c.at; } } catch {} }
fromCache();
function load({ fresh = false } = {}) {
  if (!AOS.owner) { S.ver++; draw(); return Promise.resolve(); }
  if (S.loading) return S.loading;
  S.loading = (async () => {
    try {
      const d = await AOS.api(`${API}/overview${fresh ? '?fresh=1' : ''}`);
      S.data = d; S.at = Date.now(); S.error = null; S.offline = false;
      write(LS.cache, JSON.stringify({ at: S.at, d }));
      // an open page reads its whole client again (log and files); the rest wait until they open
      const open = new Set([...pages].filter((p) => p.isConnected).map((p) => p.dataset.slug ?? `lead:${p.dataset.lead}`));
      for (const k of [...S.full.keys()]) if (!open.has(k)) S.full.delete(k);
      for (const k of [...S.leadFull.keys()]) if (!open.has(`lead:${k}`)) S.leadFull.delete(k);
      for (const k of open) if (k.startsWith('lead:')) loadLead(k.slice(5)); else loadClient(k);
    } catch (e) { S.error = e; S.offline = !!S.data; }
    finally { S.loading = null; S.ver++; draw(); refreshPages(); }
  })();
  return S.loading;
}
async function loadClient(slug) {
  try { const r = await AOS.api(`${API}/clients/${encodeURIComponent(slug)}`); S.full.set(slug, { ...r.client, write: r.write }); refreshPages(); }
  catch {}
}
async function loadLead(slug) {
  try { const r = await AOS.api(`${API}/leads/${encodeURIComponent(slug)}`); S.leadFull.set(slug, r.lead); refreshPages(); }
  catch {}
}

// ── the tab ───────────────────────────────────────────────────────────
const host = () => document.getElementById('clientsContent');
function draw(force = false) {
  const el = host();
  if (!el) return;
  if (!force && S.drawn === S.ver && el.firstChild) return;
  S.drawn = S.ver;
  const sc = el.closest('.scroller');
  const y = sc?.scrollTop ?? 0;
  const wasEmpty = !el.querySelector('.cl-sum');
  el.classList.add('crm');
  acts();
  if (!AOS.owner) { el.innerHTML = `<div class="phead"><h1 class="large-title">Clients</h1></div><div class="note cl-empty"><b>Clients live on the owner's PC</b>They come from northwind-brain and northwind-os, which only the owner's account reads.</div>`; return; }
  const d = D();
  if (!d) {
    el.innerHTML = `<div class="phead"><h1 class="large-title">Clients</h1></div>${S.error
      ? `<div class="note cl-empty" role="alert"><b>${esc(S.error.status ? S.error.message : 'Your PC isn’t reachable right now')}</b>The client files are read on the PC each time. <button class="text-btn" data-cl="retry">Try again</button></div>`
      : '<div class="cl-loading" role="status"><span class="spin" aria-hidden="true"></span>Reading northwind-brain and northwind-os</div>'}`;
    return;
  }
  const paying = d.clients.filter((c) => !c.free).length, free = d.clients.length - paying;
  const owe = d.clients.filter((c) => c.money.state === 'due').length;
  const n = (k, one, many) => `<b class="num">${k}</b> ${k === 1 ? one : many ?? `${one}s`}`;
  el.innerHTML = `
    <div class="phead">
      <h1 class="large-title">Clients</h1>
      <p class="sub cl-sumline">${n(paying, 'client')}${free ? ` · ${n(free, 'free build')}` : ''} · ${n(d.leads.length, 'lead')} · <b class="num">${owe}</b> owe you</p>
    </div>
    ${blocked(d)}
    ${summary(d)}
    <div class="cl-seg">${seg('cl-view', [['clients', 'Clients', d.clients.length], ['leads', 'Leads', d.leads.length], ['pipeline', 'Pipeline']], S.view, { role: 'tab', label: 'Show' })}</div>
    <div class="cl-panel" id="clPanel" role="tabpanel">${panelHtml(d)}</div>`;
  if (sc) sc.scrollTop = y;
  // the app draws a tab's rings in as it opens; when the figures arrive after that, they draw in then
  if (wasEmpty && visible()) pulse(el);
}
const visible = () => !!document.getElementById('pageClients') && !document.getElementById('pageClients').hidden;
/** The bar's two buttons: search and a new lead. */
function acts() {
  const a = document.getElementById('clientsActs');
  if (!a || a.dataset.crm) return;
  a.dataset.crm = '1';
  a.innerHTML = `<button class="gbtn chrome icon" data-cl="search" aria-label="Search clients and leads">${I.search}</button><button class="gbtn chrome icon accent" style="--c:var(--clients-fill)" data-cl="new-lead" aria-label="New lead">${I.plus}</button>`;
}
// the files couldn't be read at all: say so above everything, since every figure below is the snapshot's
function blocked(d) {
  const hard = d.sync.issues.filter((i) => ['no-brain', 'no-os', 'read-failed', 'unreadable'].includes(i.kind));
  const off = S.offline ? `<div class="note cl-offline" role="status"><b>Offline</b>Showing what this phone read ${esc(ago(S.at))}. ${S.error?.status ? esc(S.error.message) : 'Your PC isn’t reachable right now.'}</div>` : '';
  return off + (hard.length ? `<div class="note cl-offline" role="status">${hard.map((i) => `<p>${esc(i.text)}</p>`).join('')}</div>` : '');
}
// the summary has a job: how much of what you billed has come in, and who is healthy
function summary(d) {
  const m = d.money;
  const share = m.billed ? m.paid / m.billed : 0;
  const pct = Math.round(share * 100);
  const H = ['green', 'yellow', 'red'];
  const hc = d.health;
  const inner = m.billed
    ? `<span class="cl-sum-in"><b class="met"><span data-count="${pct}" data-fmt="pct">${pct}</span><small>%</small></b><small>collected</small></span>`
    : '<span class="cl-sum-in"><b class="met">0<small>%</small></b><small>nothing billed</small></span>';
  return `<section class="cl-sum surface" aria-label="Money and client health">
    <div class="cl-sum-main">
      ${ring(share, 'clients', 92, 11, { inner, label: m.billed ? `${pct}% of what you billed has come in: ${inr(m.paid)} of ${m.approx ? 'about ' : ''}${inr(m.billed)}` : 'Nothing billed in figures yet' })}
      <div class="cl-sum-stats">
        <span class="cl-sum-l">Outstanding</span>
        <b class="met cl-sum-big c-clients">${m.approx ? '≈ ' : ''}₹<span data-count="${m.due}">${Number(m.due).toLocaleString('en-IN')}</span></b>
        <span class="cl-sum-s"><b class="num">${inr(m.paid)}</b> paid${m.unpriced ? ` · ${m.unpriced} price not set` : ''}</span>
      </div>
    </div>
    <div class="cl-health">
      <span class="cl-hbar" aria-hidden="true">${H.filter((h) => hc[h]).map((h) => `<i style="flex:${hc[h]};background:${HC[h]}"></i>`).join('')}</span>
      <span class="cl-hkey" role="list" aria-label="Client health">${H.map((h) => `<span class="cl-h${hc[h] ? '' : ' zero'}" role="listitem"><i class="dot" style="--c:${HC[h]}"></i><b class="met">${hc[h] ?? 0}</b>${HEALTH[h]}</span>`).join('')}</span>
    </div>
  </section>`;
}
const panelHtml = (d) => (S.view === 'leads' ? leadsView(d) : S.view === 'pipeline' ? pipelineView(d) : clientsView(d));
function panel(anim) {
  const p = document.getElementById('clPanel');
  const d = D();
  if (!p || !d) return;
  p.innerHTML = panelHtml(d);
  if (anim) { p.classList.remove('swap'); void p.offsetWidth; p.classList.add('swap'); }
}

// ── Clients ───────────────────────────────────────────────────────────
// money on the right of the name: the figure and what it is. A price that is not set, or free work, says so in words
function amount(c) {
  if (c.money.state === 'due') return /\d/.test(c.money.outstanding) && !/^₹?0$/.test(c.money.outstanding.trim())
    ? `<span class="cl-amt"><b class="met">${esc(c.money.outstanding)}</b><small>due</small></span>`
    : `<span class="cl-amt is-text">${esc(/\d/.test(c.money.outstanding) ? 'Due' : c.money.outstanding)}</span>`;
  return c.free ? '<span class="cl-amt is-text">Free</span>' : '';
}
const stageText = (c) => [c.stage, c.stageNote].filter(Boolean).join(' · ');
function saidClient(c) {
  const due = c.money.state === 'due' ? (/\d/.test(c.money.outstanding) ? `${c.money.outstanding} due` : c.money.outstanding) : c.free ? 'Free' : '';
  return [c.name, isPinned(c) ? 'Pinned' : '', HEALTH[c.health], stageText(c), c.product, due, `Next: ${c.next.text}, ${c.next.due}`].filter(Boolean).join('. ');
}
function clientCard(c) {
  const flags = [
    c.health !== 'green' ? `<span class="cl-hw" style="--c:${HC[c.health]}">${HEALTH[c.health]}</span>` : '',
    c.kind === 'own' && c.ownerNote ? `<span>${esc(c.ownerNote)}, own business</span>` : '',
    c.osFolder ? '' : '<span class="cl-noos">No OS folder</span>',
  ].filter(Boolean);
  return `<button class="cl-card surface" data-cl="client" data-id="${esc(c.slug)}" aria-label="${esc(saidClient(c))}">
    <span class="cl-head">
      ${mono(c)}
      <span class="cl-id">
        <span class="cl-l1"><b class="cl-name">${esc(c.name)}</b>${isPinned(c) ? `<span class="cl-pinned">${I.pinF}</span>` : ''}${amount(c)}</span>
        <span class="cl-l2"><span class="cl-stage">${esc(stageText(c))}</span><span class="cl-prod">${esc(c.product)}</span></span>
        ${flags.length ? `<span class="cl-l3">${flags.join('<span class="cl-sep" aria-hidden="true">·</span>')}</span>` : ''}
      </span>
    </span>
    ${nextLine(I.next, c.next.text, c.next.due, dueTone(c.next.due))}
  </button>`;
}
// what the sync found: each problem says what is wrong, for whom, and the one move that fixes it
const ISSUE_ICON = { 'missing-os-folder': 'folderPlus', 'template-unfilled': 'doc', 'ledger-behind': 'clock', 'stage-mismatch': 'flag', 'lead-not-on-board': 'people', 'not-on-board': 'flag', 'missing-brain-folder': 'folderPlus' };
function issueFix(i) {
  const d = D();
  const name = (s) => d.clients.find((c) => c.slug === s)?.name ?? d.leads.find((l) => l.slug === s)?.name ?? s;
  if (i.kind === 'missing-os-folder') return { label: 'Create from template', ask: `Create ${i.slugs.map((s) => `clients\\${s}`).join(' and ')} in northwind-os from _templates\\client\\ (OS.md §5), filled from each client's northwind-brain dossier and work log. Write unknown (ask) for anything the brain doesn't say. Mirror any stage you set to the brain's clients\\_pipeline.md.`, at: 'os', who: i.slugs.map(name).join(', ') };
  if (i.kind === 'template-unfilled') return { label: 'Fill them', ask: `Fill ${i.files.map((f) => f.split('\\').pop()).join(' and ')} for ${name(i.slugs[0])} from its northwind-brain dossier and work log. Keep every {placeholder} you can't answer as unknown (ask). Money only from northwind-brain/money/pricing.md.`, at: 'client', slug: i.slugs[0] };
  if (i.kind === 'ledger-behind') return { label: 'Update it', ask: `Bring payments.md for ${name(i.slugs[0])} up to date with the brain: the work log records a payment after the ledger's last balance. Append rows (it is append-only), recompute Outstanding, and note the source of each figure.`, at: 'client', slug: i.slugs[0] };
  return null;
}
function issuesBlock(d) {
  const list = d.sync.issues.filter((i) => !['no-brain', 'no-os', 'read-failed', 'unreadable'].includes(i.kind));
  if (!list.length) return '';
  const who = (i) => (i.slugs ?? []).map((s) => d.clients.find((c) => c.slug === s)?.name ?? d.leads.find((l) => l.slug === s)?.name ?? s).join(', ');
  return `<div class="cl-issues surface" role="status" aria-label="What the sync found">${list.map((i, k) => {
    const fix = issueFix(i);
    // "Glowbox: contract.md is still the blank template" reads as the problem, with whose it is under it
    const title = i.kind === 'missing-os-folder' ? i.text : i.text.replace(/^[^:]+:\s*/, '');
    const sub = who(i) || (i.files ?? []).join(', ');
    return `<div class="cl-issue"><span class="tile cl-issue-i" aria-hidden="true">${I[ISSUE_ICON[i.kind] ?? 'flag']}</span>
      <span class="cl-issue-b"><b>${esc(/^\S+\.\w+\b/.test(title) ? title : cap(title))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      ${fix ? `<button class="btn sm" data-cl="issue" data-i="${k}">${esc(fix.label)}</button>` : ''}</div>`;
  }).join('')}</div>`;
}
const issueList = () => D()?.sync.issues.filter((i) => !['no-brain', 'no-os', 'read-failed', 'unreadable'].includes(i.kind)) ?? [];
function syncLine(d, what = d.sync.source) {
  const when = S.offline ? `last read ${ago(S.at)}` : ago(Date.parse(d.sync.at) || S.at);
  return `<div class="cl-sync">${I.sync}<span class="cl-sync-t">${S.offline ? 'Offline · ' : 'Synced from '}${words(what)} · ${esc(when)}</span><button class="cl-sync-btn" data-cl="sync">${S.loading ? '<span class="spin" aria-label="Syncing"></span>' : S.offline ? 'Try again' : 'Sync now'}</button></div>`;
}
function retiredBlock(d) {
  if (!d.retired.length) return '';
  return `<div class="group cl-retired">
    <button class="lrow" data-cl="retired" aria-expanded="${S.retired}"><span class="rbody"><span class="rtitle">Retired</span></span><span class="rend"><span class="met">${d.retired.length}</span><span class="cl-fold">${S.retired ? I.chevU : I.chevD}</span></span></button>
    ${S.retired ? d.retired.map((r) => `<div class="lrow"><span class="rbody"><span class="rtitle">${esc(r.name)}</span><span class="rmeta">${esc(r.note)}</span></span></div>`).join('') : ''}
  </div>`;
}
// the links you send clients (the Client window module) live here now, under Clients
const windowRow = () => `<div class="group cl-windows"><button class="lrow ic" data-cl="window"><span class="tile">${I.link}</span><span class="rbody"><span class="rtitle">Client pages</span><span class="rmeta"><span class="ell">Links you send clients, and their answers</span></span></span>${I.chevR}</button></div>`;
function clientsView(d) {
  const list = [...d.clients].sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)) || dueRank(a.next.due) - dueRank(b.next.due));
  return `${list.length ? `<div class="cl-list">${list.map(clientCard).join('')}</div>` : '<div class="note cl-empty"><b>No clients on the board</b>northwind-brain\\clients\\_pipeline.md lists none yet.</div>'}${issuesBlock(d)}${retiredBlock(d)}${windowRow()}${syncLine(d)}`;
}

// ── Leads ─────────────────────────────────────────────────────────────
function leadCard(l) {
  const t = l.nextTouch.text;
  return `<button class="cl-card surface" data-cl="lead" data-id="${esc(l.slug)}" aria-label="${esc(`${l.name}. Lead, ${l.stage}, warmth ${l.warmth === 'unknown' ? 'not set' : l.warmth}. Next touch: ${t}`)}">
    <span class="cl-head">
      ${mono(l)}
      <span class="cl-id">
        <span class="cl-l1"><b class="cl-name">${esc(l.name)}</b><span class="cl-amt is-warm">${warmth(l.warmth)}</span></span>
        <span class="cl-l2"><span class="cl-stage">${esc(l.stage)}</span><span class="cl-prod">${l.since ? `Lead since ${esc(l.since)}` : 'Lead'}</span></span>
        <span class="cl-l3"><span>Pitch ${esc(l.pitch.toLowerCase())}</span><span class="cl-sep" aria-hidden="true">·</span><span>Potential ${esc(l.potential.toLowerCase())}</span>${l.onBoard ? '' : '<span class="cl-sep" aria-hidden="true">·</span><span>Not on the board</span>'}</span>
      </span>
    </span>
    ${nextLine(I.clock, 'Next touch', t, l.nextTouch.set ? dueTone(t) : 'late')}
  </button>`;
}
const leadsView = (d) => `${d.leads.length ? `<div class="cl-list">${d.leads.map(leadCard).join('')}</div>`
  : '<div class="note cl-empty"><b>No leads yet</b>File the first one from what you know.</div>'}
  <div class="group cl-addlead"><button class="lrow ic" data-cl="new-lead"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">New lead</span><span class="rmeta">Paste or speak what you know</span></span>${I.chevR}</button></div>
  ${syncLine(d, 'northwind-os\\sales')}`;

// ── Pipeline: one path from a first contact to an active client. Each stage is a node on the rail, the people in it
//    sit under it; an empty stage is one quiet line. Leads cross to clients where Convert to client moves them ──
const onPath = (stages, off) => stages.filter((s) => !off.includes(s));
const offPath = (stages, off) => stages.filter((s) => off.includes(s));
function stageNode(st, items) {
  const xs = items.filter((x) => x.stage === st);
  const meta = (x) => (x.kind === 'lead' ? (x.warmth === 'unknown' ? 'warmth not set' : x.warmth) : x.free ? `free${x.stageNote ? ` ${x.stageNote}` : ''}` : x.stageNote);
  return `<li class="clp-st${xs.length ? ' has' : ''}">
    <span class="clp-node" aria-hidden="true"></span>
    <span class="clp-h"><b>${esc(cap(st))}</b><span class="met">${xs.length}</span></span>
    ${xs.length ? `<span class="clp-items">${xs.map((x) => `<button class="clp-item" data-cl="${x.kind === 'lead' ? 'lead' : 'client'}" data-id="${esc(x.slug)}">${mono(x, 'sm')}<span class="clp-t">${esc(x.name)}</span>${meta(x) ? `<span class="clp-m">${esc(meta(x))}</span>` : ''}${I.chevR}</button>`).join('')}</span>` : ''}
  </li>`;
}
function part(title, stages, off, items, extra = []) {
  const offs = [...offPath(stages, off).map((st) => [cap(st), items.filter((x) => x.stage === st).length]), ...extra];
  const unknown = items.filter((x) => !stages.includes(x.stage));
  return `<section class="clp-card surface" aria-label="${esc(title)}">
    <h2 class="clp-hd">${esc(title)}</h2>
    <ol class="clp-path">${onPath(stages, off).map((st) => stageNode(st, items)).join('')}${unknown.length ? stageNode(unknown[0].stage, unknown) : ''}</ol>
    <p class="clp-off"><span class="clp-off-l">Off the path</span>${offs.map(([k, v]) => `<span class="${v ? 'has' : ''}">${esc(k)} <b class="met">${v}</b></span>`).join('')}</p>
  </section>`;
}
const pipelineView = (d) => `<div class="cl-pipe">${part('Leads', d.stages.lead, d.stages.off, d.leads)}
  <p class="clp-conv"><span>Convert to client moves a lead into ${esc(d.stages.client[0] ?? 'onboarding')}</span></p>
  ${part('Clients', d.stages.client, d.stages.off, d.clients, [['Retired', d.retired.length]])}</div>${syncLine(d)}`;

// ── client page ───────────────────────────────────────────────────────
const pages = new Set();
export function openClient(slug) {
  if (!clientOf(slug)) return;
  AOS.push('crm-client', slug);
}
export function openLead(slug) {
  if (!leadOf(slug)) return;
  AOS.push('crm-lead', slug);
}
AOS.detail('crm-client', { render(box, slug, el) { el.classList.add('cl-page'); el.dataset.slug = slug; pages.add(el); drawClientPage(el); loadClient(slug); } });
AOS.detail('crm-lead', { render(box, slug, el) { el.classList.add('cl-page', 'lead-page'); el.dataset.lead = slug; pages.add(el); drawLeadPage(el); loadLead(slug); } });
function refreshPages() {
  for (const el of [...pages]) {
    if (!el.isConnected) { pages.delete(el); continue; }
    if (el.dataset.slug) drawClientPage(el); else if (el.dataset.lead) drawLeadPage(el);
  }
}
function pageShell(el, title, right = '') {
  const t = $('.nav-title', el);
  if (t) t.textContent = title;
  const end = $('.navbar > :last-child', el);
  if (end && !end.classList.contains('nav-back')) end.innerHTML = right;
  return $('.detail-content', el);
}
const pinBtn = (c) => `<button class="gbtn chrome icon cl-pin${isPinned(c) ? ' on' : ''}" data-cl="pin" data-id="${esc(c.slug)}" aria-pressed="${isPinned(c)}" aria-label="${isPinned(c) ? 'Unpin' : 'Pin'} ${esc(c.name)}">${isPinned(c) ? I.pinF : I.pin}</button>`;
function drawClientPage(el) {
  const c = clientOf(el.dataset.slug);
  const box = pageShell(el, c?.name ?? 'Client', c ? pinBtn(c) : '');
  if (!box) return;
  const sc = box.closest('.scroller'), y = sc?.scrollTop ?? 0;
  box.innerHTML = c ? clientHtml(c) : '<div class="note cl-empty"><b>This client isn’t on the board any more</b>It may have been renamed or retired in northwind-brain.</div>';
  if (sc) sc.scrollTop = y;
}
const writeState = (c) => c.write ?? D()?.write ?? { on: false, why: '' };
const youOpen = (c) => c.waitingOn.you.filter((x) => !S.done.has(doneKey(c, x.text))).length;
function clientHtml(c) {
  const w = writeState(c);
  const projects = (c.projects ?? []).map((p) => AOS.data?.()?.projects?.find((x) => x.slug === p)).filter(Boolean);
  return `
  <header class="cl-hero">
    <div class="cl-hero-id">
      ${mono(c, 'lg')}
      <div class="cl-hero-t"><h1 class="title1 cl-hname">${esc(c.name)}</h1><p class="sub">${esc([c.product, c.package].filter(Boolean).join(' · '))}</p></div>
    </div>
    <div class="cl-hmeta">
      <span class="cl-hh"><i class="dot" style="--c:${HC[c.health]}"></i>${HEALTH[c.health]}</span>
      <span class="pill plain">${esc([stageText(c), c.since ? `since ${c.since}` : ''].filter(Boolean).join(' · '))}</span>
      ${c.kind === 'own' && c.ownerNote ? `<span class="pill plain">${esc(c.ownerNote)}, own business</span>` : ''}
      ${c.free && !/free/i.test(c.package) ? '<span class="pill plain">Free</span>' : ''}
    </div>
    <p class="cl-hsum">${esc(c.summary)}${c.freeNote && !c.summary.includes(c.freeNote.match(/D-\d+/)?.[0] ?? c.freeNote) ? ` ${esc(c.freeNote)}.` : ''}</p>
  </header>

  <section class="cl-nextcard surface" aria-label="Next step">
    <div class="cl-nc-top"><span class="cl-nc-k">${I.next}${c.next.owner === 'you' ? 'Your next step' : 'Their next step'}</span><span class="cl-due ${dueTone(c.next.due)}">${esc(c.next.due)}</span></div>
    <p class="cl-nc-t">${words(c.next.text)}</p>
    <button class="btn primary cl-wide" style="--c:var(--clients-fill)" data-cl="job" data-id="${esc(c.slug)}">${I.claude}Start a job for this client</button>
    <div class="cl-nc-acts">
      <button class="btn" data-cl="flows" data-id="${esc(c.slug)}">${I.flow}Run a workflow</button>
      <button class="btn" data-cl="log" data-id="${esc(c.slug)}" ${w.on && c.brainFolder ? '' : 'disabled aria-describedby="clLogOff"'}>${I.edit}Log work</button>
    </div>
    ${w.on ? '' : `<p class="cl-off" id="clLogOff">Log work is off: it writes to northwind-brain, so it waits until CRM_WRITE is turned on in the server config.</p>`}
  </section>

  ${projects.length ? `<div class="sh"><h2>Project in Jobs</h2></div>
  <div class="group">${projects.map((p) => `<button class="lrow ic cl-proj" data-cl="project" data-id="${esc(p.slug)}"><span class="tile">${AOS.projGlyph ? AOS.projGlyph(p) : I.folder}</span><span class="rbody"><span class="rtitle">${esc(p.name)}</span>${p.description ? `<span class="rmeta"><span class="ell">${esc(p.description)}</span></span>` : ''}</span>${I.chevR}</button>`).join('')}</div>` : ''}
  ${c.window ? `<div class="group cl-window"><button class="lrow ic" data-cl="window"><span class="tile">${I.link}</span><span class="rbody"><span class="rtitle">Client page</span><span class="rmeta">${c.window.link ? 'Their link is live' : 'No link yet'}${c.window.active ? '' : ' · inactive'}</span></span>${I.chevR}</button></div>` : ''}

  <div class="sh"><h2>Waiting on</h2><span class="sh-count cl-waitn">${youOpen(c) + c.waitingOn.them.length || ''}</span></div>
  <div class="group cl-wait">${waitHtml(c)}</div>

  <div class="sh"><h2>Money</h2></div>
  ${moneyCard(c)}

  <div class="sh"><h2>Workflows</h2>${count(c.workflows.length)}<button class="sh-act" data-cl="flows" data-id="${esc(c.slug)}">Run one${I.chevR}</button></div>
  <div class="group cl-flowlist">${flowsHtml(c)}</div>

  <div class="sh"><h2>Key dates</h2>${count(c.keyDates.length)}</div>
  <div class="group cl-dates">${c.keyDates.length ? c.keyDates.map((k) => `<div class="lrow"><span class="rbody"><span class="rtitle wrap">${esc(k.what)}</span></span><span class="cl-due ${k.tone ?? dueTone(k.when)}">${esc(k.when)}</span></div>`).join('') : '<div class="lrow"><span class="cl-none">No dates yet</span></div>'}</div>

  <div class="sh"><h2>Work log</h2>${count(c.logCount ?? c.log.length)}<button class="sh-act" data-cl="log" data-id="${esc(c.slug)}" ${w.on && c.brainFolder ? '' : 'disabled'}>Log${I.chevR}</button></div>
  <div class="group cl-log">${logHtml(c)}</div>

  <div class="sh"><h2>Contract</h2></div>
  <div class="group cl-kv">
    ${c.contract.note ? `<div class="lrow"><span class="rbody"><span class="rtitle wrap cl-cnote">${esc(c.contract.note)}</span></span></div>` : ''}
    <div class="lrow"><span class="cl-k">Term</span><span class="cl-v">${esc(c.contract.term || 'Not written down')}</span></div>
    <div class="lrow"><span class="cl-k">Deliverables</span><span class="cl-v">${c.contract.deliverables.length ? c.contract.deliverables.map(esc).join(', ') : 'Not written down'}</span></div>
    <div class="lrow"><span class="cl-k">Payment</span><span class="cl-v">${esc(c.contract.payment || 'Not written down')}</span></div>
    ${(c.commercials ?? []).length ? `<div class="cl-wl"><span>Commercials, from the dossier</span></div>${c.commercials.map((x) => (x.label
      ? `<div class="lrow"><span class="cl-k">${esc(x.label)}</span><span class="cl-v">${esc(x.value)}</span></div>`
      : `<div class="lrow"><span class="rbody"><span class="rtitle wrap cl-cnote">${esc(x.value)}</span></span></div>`)).join('')}` : ''}
  </div>

  <div class="sh"><h2>Goals</h2>${count(c.goals.length)}</div>
  <div class="group cl-goals">${c.goals.length ? c.goals.map((g) => `<div class="lrow"><span class="rbody"><span class="rtitle wrap">${esc(g)}</span></span></div>`).join('') : '<div class="lrow"><span class="cl-none">None written down</span></div>'}</div>

  <div class="sh"><h2>Files</h2></div>
  <div class="cl-filewrap">${filesHtml(c)}</div>
  <p class="cl-hint">Read from the files on your PC. Edits happen there, or in a job.${snapList(c)}</p>`;
}
// which parts of this page are the snapshot's, in one line
function snapList(c) {
  const parts = [['health', 'health'], ['workflows', 'workflows'], ['keyDates', 'key dates'], ['contract.term', 'contract'], ['goals', 'goals']].filter(([k]) => c.src?.[k] === 'snapshot').map(([, l]) => l);
  return parts.length ? ` Not in the files yet, so from the ${esc(day(D()?.snapshotAt))} snapshot: ${parts.join(', ')}.` : '';
}

// waiting on you comes first, a list you can tick off on this phone; waiting on them is a list
function waitHtml(c) {
  const wo = c.waitingOn;
  const none = '<div class="lrow cl-wr"><span class="cl-wd" aria-hidden="true"></span><span class="rbody"><span class="cl-none">Nothing</span></span></div>';
  // items from one NOW.md loop name the loop once, under the first of them
  const you = wo.you.map((x, i) => {
    const k = doneKey(c, x.text), d = S.done.has(k);
    const detail = x.detail && x.detail !== wo.you[i - 1]?.detail ? x.detail : '';
    return `<div class="lrow cl-wr cl-wy${d ? ' is-done' : ''}"><button class="cl-tick${d ? ' on' : ''}" data-cl="wait" data-k="${esc(k)}" aria-pressed="${d}" aria-label="${d ? 'Mark not done' : 'Mark done'}: ${esc(x.text)}"><i>${I.check}</i></button><span class="rbody"><span class="rtitle wrap">${esc(x.text)}</span>${detail ? `<span class="rmeta"><span class="ell">${esc(detail)}</span></span>` : ''}</span></div>`;
  }).join('') || none;
  const them = wo.them.map((t) => `<div class="lrow cl-wr"><span class="cl-wd" aria-hidden="true"><i></i></span><span class="rbody"><span class="rtitle wrap">${esc(t)}</span></span></div>`).join('') || none;
  return `<div class="cl-wl"><span>You</span>${wo.you.length ? `<b class="met">${youOpen(c)}</b>` : ''}</div>${you}
    <div class="cl-wl"><span>Them</span>${count(wo.them.length, 'met')}</div>${them}`;
}
// the workflows this client is opted into, named in words, with their folder and state
const FLOW_DOT = { running: 'var(--done)', done: 'var(--ink-3)' };
const flowState = (st) => `<span class="cl-wfst${st === 'running' ? ' run' : ''}${st === 'done' ? ' done' : ''}">${st === 'done' ? I.check : `<i class="live-dot" style="--c:${FLOW_DOT[st] ?? 'var(--warn)'}"></i>`}${esc(cap(st))}</span>`;
function flowsHtml(c) {
  if (!c.workflows.length) return '<div class="lrow"><span class="cl-none">No workflows yet</span></div>';
  return c.workflows.map((w) => `<div class="lrow cl-wf"><span class="rbody"><span class="rtitle wrap">${esc(w.name)}</span><span class="rmeta">${w.folder ? `<span class="mono">${esc(w.folder)}/</span>` : `<span class="ell">${esc(w.detail || 'Opted in')}</span>`}</span></span>${flowState(w.status)}</div>`).join('');
}
const PAY = { paid: ['Paid', 'var(--done)'], due: ['Due', 'var(--needs-ink)'], partial: ['Partial', 'var(--needs-ink)'], none: ['No charge', ''] };
const rupees = (s) => { const m = String(s).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s?(L|lakh|k)?\b/i); if (!m) return null; const n = +m[1]; return /^l/i.test(m[2] ?? '') ? n * 1e5 : /^k/i.test(m[2] ?? '') ? n * 1e3 : n; };
function moneyCard(c) {
  let paid = 0, due = 0, approx = false;
  for (const r of c.money.rows) { const n = rupees(r.amount); if (r.status === 'paid') paid += n ?? 0; else if ((r.status === 'due' || r.status === 'partial') && n != null) { due += n; if (/≈|~/.test(r.amount)) approx = true; } }
  const billed = paid + due;
  const share = billed ? paid / billed : 0;
  const inWords = !/\d/.test(c.money.outstanding);
  const top = billed
    ? `<div class="cl-m-top">${ring(share, 'clients', 64, 7, { inner: `<b class="met cl-m-pct">${Math.round(share * 100)}<small>%</small></b>`, label: `${Math.round(share * 100)}% of what you billed ${c.name} has come in` })}
        <div class="cl-m-stats"><span class="cl-m-l">Outstanding</span><b class="met cl-m-big c-clients">${esc(c.money.outstanding)}</b><span class="foot">${inr(paid)} paid of ${approx ? '≈ ' : ''}${inr(billed)} billed${c.money.asOf ? ` · as of ${esc(dayYear(c.money.asOf))}` : ''}</span></div></div>`
    : `<div class="cl-m-top"><div class="cl-m-stats"><span class="cl-m-l">Outstanding</span><b class="${inWords ? 'cl-m-words' : 'met cl-m-big'}">${esc(c.money.outstanding)}</b>${c.money.rows.length ? '' : `<span class="foot">${esc(c.freeNote ?? 'Nothing billed yet')}</span>`}</div></div>`;
  const rows = c.money.rows.map((r) => `<div class="cl-pay">
      <span class="cl-pay-b"><b>${esc(cap(r.what))}</b><small>${esc(dayYear(r.date))}${r.note ? ` · ${esc(r.note)}` : ''}</small></span>
      <span class="cl-pay-r"><b class="met">${esc(r.amount)}</b><span class="pill${PAY[r.status]?.[1] ? '' : ' plain'}"${PAY[r.status]?.[1] ? ` style="--c:${PAY[r.status][1]}"` : ''}>${PAY[r.status]?.[0] ?? esc(r.status)}</span></span>
    </div>`).join('');
  const behind = D()?.sync.issues.find((i) => i.kind === 'ledger-behind' && i.slugs?.includes(c.slug));
  return `<div class="cl-money surface">${top}${rows ? `<div class="cl-pays">${rows}</div>` : ''}${behind ? `<p class="cl-behind">${esc(cap(behind.text.replace(/^[^:]+:\s*/, '')))}</p>` : ''}${snapNote(c, 'money', 'payments.md')}</div>`;
}
const LOG_SHOWN = 6;
function logHtml(c) {
  if (!c.log.length) return '<div class="lrow"><span class="cl-none">Nothing logged yet</span></div>';
  const all = S.logAll.has(c.slug) || c.log.length <= LOG_SHOWN + 1;
  const list = all ? c.log : c.log.slice(0, LOG_SHOWN);
  const total = c.logCount ?? c.log.length;
  return list.map((e) => `<div class="lrow cl-le${e.fresh ? ' fresh' : ''}"><span class="cl-le-d num">${esc(day(e.date))}</span><span class="rbody"><span class="rtitle wrap">${esc(e.title)}</span>${e.body ? `<span class="cl-le-b">${esc(e.body)}</span>` : ''}</span></div>`).join('')
    + (all ? '' : `<button class="lrow cl-more" data-cl="more-log" data-id="${esc(c.slug)}"><span class="rbody"><span class="rtitle">Show all ${total}</span></span>${I.chevD}</button>`);
}
// a tap copies the full path, ready to paste into a job; the folder rows carry the copy glyph for the whole list
const fileRow = (path, f) => `<button class="lrow cl-f" data-cl="file" data-path="${esc(`${path}\\${f.replace(/\/$/, '')}`)}" aria-label="Copy the path of ${esc(f)}"><span class="cl-f-i">${f.endsWith('/') ? I.folder : I.doc}</span><span class="rbody"><span class="rtitle mono">${esc(f)}</span></span></button>`;
const folderRow = (title, rel, abs, icon = I.folder) => `<button class="lrow ic cl-froot" data-cl="file" data-path="${esc(abs ?? rel)}"><span class="tile">${icon}</span><span class="rbody"><span class="rtitle">${title}</span><span class="rmeta"><span class="mono ell">${esc(rel)}</span></span></span>${I.copy || ''}</button>`;
function filesHtml(c) {
  const os = c.osFolder
    ? `<div class="group cl-files">${folderRow('OS folder', c.osFolder, c.osPath)}${(c.files?.os ?? []).map((f) => fileRow(c.osPath ?? c.osFolder, f)).join('')}</div>`
    : `<div class="group cl-files"><div class="lrow ic cl-froot cl-nofolder"><span class="tile">${I.folderPlus}</span><span class="rbody"><span class="rtitle">No OS folder yet</span><span class="rmeta">Payments, contract and goals live there</span></span><button class="btn sm" data-cl="make-os" data-id="${esc(c.slug)}">Create</button></div></div>`;
  const brain = c.brainFolder ? `<div class="group cl-files">${folderRow('Brain folder', c.brainFolder, c.brainPath)}${(c.files?.brain ?? []).map((f) => fileRow(c.brainPath ?? c.brainFolder, f)).join('')}</div>` : '';
  return os + brain;
}

// ── lead page ─────────────────────────────────────────────────────────
function drawLeadPage(el) {
  const l = leadOf(el.dataset.lead);
  const box = pageShell(el, l?.name ?? 'Lead');
  if (!box) return;
  const sc = box.closest('.scroller'), y = sc?.scrollTop ?? 0;
  box.innerHTML = l ? leadHtml(l) : '<div class="note cl-empty"><b>This lead isn’t in northwind-os\\sales any more</b>It may have been converted or renamed.</div>';
  if (sc) sc.scrollTop = y;
}
// where a lead is on the path: the stages it has reached are inked, and the one it is in is named in ink
function stageTrack(st) {
  const d = D();
  const path = onPath(d?.stages.lead ?? [], d?.stages.off ?? []);
  const i = path.indexOf(st);
  const where = i < 0 ? `off the path, ${st}` : `${st}, ${i + 1} of ${path.length}`;
  return `<div class="cl-track${i < 0 ? ' off' : ''}" role="img" aria-label="Stage: ${esc(where)}" style="--n:${path.length}">
    <span class="cl-track-l"><span class="cl-k">Stage</span><span>${i < 0 ? `Off the path · ${esc(cap(st))}` : `${i + 1} of ${path.length}`}</span></span>
    <span class="cl-track-bar" aria-hidden="true">${path.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</span>
    <span class="cl-track-s" aria-hidden="true">${path.map((s, k) => `<span class="${k === i ? 'now' : ''}">${esc(cap(s))}</span>`).join('')}</span>
  </div>`;
}
const LEAD_MOVES = [['prepare-pitch', 'doc', 'Prepare pitch'], ['client-onboarding', 'next', 'Convert to client'], ['lead-research', 'search', 'Run lead research']];
function leadHtml(l) {
  const unset = !l.nextTouch.set;
  const flows = D()?.workflows ?? [];
  return `
  <header class="cl-hero">
    <div class="cl-hero-id">
      ${mono(l, 'lg')}
      <div class="cl-hero-t"><h1 class="title1 cl-hname">${esc(l.name)}</h1><p class="sub">${esc([l.since ? `Lead since ${l.since}` : 'Lead', l.source ? `via ${l.source}` : ''].filter(Boolean).join(' · '))}</p></div>
    </div>
    ${l.note ? `<p class="cl-hsum">${esc(l.note.replace(/\.?$/, '.'))}</p>` : ''}
    ${l.onBoard ? '' : '<p class="cl-hsum cl-offboard">Not on the board in northwind-brain\\clients\\_pipeline.md.</p>'}
  </header>

  <section class="cl-nextcard surface" aria-label="Next touch">
    <div class="cl-nc-top"><span class="cl-nc-k">${I.clock}Next touch</span>${unset ? '<span class="cl-due late">Needs you</span>' : `<span class="cl-due ${dueTone(l.nextTouch.text)}">${esc(l.nextTouch.text.split(' · ')[0])}</span>`}</div>
    <p class="cl-nc-t">${esc(unset ? l.nextTouch.text : (l.nextTouch.what ? cap(l.nextTouch.what) : l.nextTouch.text))}</p>
    <button class="btn ${unset ? 'primary' : ''} cl-wide" ${unset ? 'style="--c:var(--clients-fill)"' : ''} data-cl="touch" data-id="${esc(l.slug)}">${I.cal}${unset ? 'Set the next touch' : 'Change the next touch'}</button>
  </section>

  <div class="sh"><h2>Where it stands</h2></div>
  <div class="group cl-kv">
    ${stageTrack(l.stage)}
    <div class="lrow"><span class="cl-k">Warmth</span><span class="cl-v">${warmth(l.warmth)}${l.warmthText ? `<span class="cl-wt">${esc(l.warmthText)}</span>` : ''}</span></div>
    <div class="lrow"><span class="cl-k">Potential</span><span class="cl-v">${esc(l.potential)}</span></div>
    <div class="lrow"><span class="cl-k">Pitch</span><span class="cl-v">${esc(l.pitch)}</span></div>
  </div>

  <div class="sh"><h2>Moves</h2></div>
  <div class="group cl-moves">
    ${LEAD_MOVES.map(([id, ic, label]) => {
      const wf = flows.find((x) => x.id === id) ?? { id, name: label, line: '', built: false };
      return `<button class="lrow ic" data-cl="lead-flow" data-w="${id}" data-id="${esc(l.slug)}"><span class="tile">${I[ic]}</span><span class="rbody"><span class="rtitle">${label}</span>${wf.line ? `<span class="rmeta"><span class="ell">${esc(wf.line)}</span></span>` : ''}</span>${wf.built ? `<span class="pill">${I.play}Run</span>` : '<span class="pill plain">Spec only</span>'}</button>`;
    }).join('')}
  </div>

  <div class="sh"><h2>Files</h2></div>
  <div class="group cl-files">${folderRow('Sales folder', l.osFolder, l.osPath)}${(l.files ?? []).map((f) => fileRow(l.osPath ?? l.osFolder, f)).join('')}</div>
  <p class="cl-hint">Read from northwind-os on your PC. Changes go through a job, so the lead's files stay the record.</p>`;
}

// ── sheets: one for this module's lists and forms, one for starting a job ──
const scrimFor = (y, H) => Math.min(1, Math.max(0, 1 - y / (H * 0.85)));
function sheetEl(id, cls) {
  let el = document.getElementById(id);
  if (el) return el;
  el = document.createElement('section');
  el.id = id;
  el.className = `sheet crm-sheet ${cls}`;
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('role', 'dialog');
  el.innerHTML = '<div class="grabber"></div><div class="sheet-head"></div><div class="sheet-body"></div>';
  (document.getElementById('screen') ?? document.body).appendChild(el);
  return el;
}
// a sheet as tall as what is in it ("fit"), or most of the screen ("large")
const fitDetents = (el) => (H) => {
  const head = $('.sheet-head', el)?.offsetHeight ?? 0, body = $('.cl-sb', el)?.offsetHeight ?? 0;
  return { large: 0, fit: Math.max(0, Math.round(H - (22 + head + body + 34))) };
};
let SH = null, JS = null;
function sheet() {
  if (SH) return SH;
  const el = sheetEl('crmSheet', '');
  SH = { el, s: AOS.makeSheet(el, { detents: fitDetents(el), scrimFor }) };
  return SH;
}
function openSheet({ title, sub = '', body, cls = '', size = 'fit', label }) {
  const { el, s } = sheet();
  el.className = `sheet crm-sheet ${cls}${el.classList.contains('open') ? ' open' : ''}`;
  el.setAttribute('aria-label', label ?? title);
  $('.sheet-head', el).innerHTML = `<div class="cl-shead"><div class="cl-shead-t"><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="sheet-close" data-cl="close" aria-label="Close">${I.x}</button></div>`;
  const b = $('.sheet-body', el);
  b.innerHTML = '<div class="cl-sb"></div>';
  b.scrollTop = 0;
  if (typeof body === 'function') body($('.cl-sb', b)); else $('.cl-sb', b).innerHTML = body;
  requestAnimationFrame(() => s.open(size));
  AOS.haptic('light');
  return el;
}
const closeSheet = () => { if (SH?.s.isOpen) SH.s.close(); };

// what can run now, apart from what is only written down; what already runs for this client says so instead of Run
function flowsSheet(c) {
  const all = (D()?.workflows ?? []).filter((w) => w.for === 'client');
  const ready = all.filter((w) => w.built), spec = all.filter((w) => !w.built && w.spec), named = all.filter((w) => !w.built && !w.spec);
  const runs = (w) => c.workflows.some((x) => x.folder === w.id || x.name.toLowerCase() === w.name.toLowerCase());
  const others = c.workflows.filter((x) => x.status !== 'done' && !all.some((w) => w.id === x.folder));
  const row = (w) => `<button class="lrow cl-fl${w.built ? '' : ' spec'}" data-cl="flow-run" data-w="${esc(w.id)}" data-id="${esc(c.slug)}">
      <span class="rbody"><span class="rtitle">${esc(w.name)}</span><span class="rmeta">${w.needsOk ? '<span class="cl-late">Needs your OK</span><span>·</span>' : ''}<span class="ell">${esc(w.line || w.dept || '')}</span></span></span>
      ${!w.built ? '<span class="pill plain">Spec only</span>' : runs(w) ? flowState('running') : `<span class="pill">${I.play}Run</span>`}
    </button>`;
  const now = others.length ? `<p class="cl-flow-now">${I.flow}<span>${[...new Set(others.map((x) => x.status))].map((st) => `${esc(cap(st))} for ${esc(c.name)}: <b>${others.filter((x) => x.status === st).map((x) => esc(x.name)).join(', ')}</b>`).join('. ')}</span></p>` : '';
  openSheet({
    title: 'Run a workflow', sub: `For ${esc(c.name)} · northwind-os\\WORKFLOWS.md`, cls: 'cl-flow-sheet', size: 'large',
    body: `${now}${ready.length ? `<p class="cl-lbl">Ready to run</p><div class="group cl-flows">${ready.map(row).join('')}</div>` : ''}
      ${spec.length ? `<p class="cl-lbl">Written down, not built yet</p><div class="group cl-flows">${spec.map(row).join('')}</div>` : ''}
      ${named.length ? `<p class="cl-foot">${plural(named.length, 'more is', 'more are')} only named in the catalog so far.</p>` : ''}`,
  });
}
function logSheet(c) {
  const today = D()?.today ?? new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  openSheet({
    title: 'Log work', sub: `${esc(c.name)} · goes into work-log.md`, cls: 'cl-log-sheet',
    body: (b) => {
      b.innerHTML = `<div class="cl-logsheet">
        <label class="ifield cl-ta"><textarea rows="4" placeholder="What did you do?" aria-label="What you did" enterkeyhint="enter"></textarea></label>
        <p class="foot">Dated ${esc(day(today))}, at the end of ${esc(c.brainFolder)}\\work-log.md. The first line is the title. The log is append-only: a mistake is fixed with a new entry.</p>
        <button class="btn primary cl-wide" style="--c:var(--clients-fill)" data-cl="log-save" data-id="${esc(c.slug)}" disabled>Add to the work log</button>
      </div>`;
      const ta = $('textarea', b), btn = $('.btn', b);
      ta.addEventListener('input', () => { btn.disabled = !ta.value.trim(); });
      setTimeout(() => ta.focus({ preventScroll: true }), 420);
    },
  });
}
// next touch: one date, one move. It is written by a job, since the lead's card lives in northwind-os
function touchSheet(l) {
  const today = D()?.today ?? new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const at = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mon = at(((8 - wd) % 7) || 7);
  const whens = [['Tomorrow', at(1)], [`${WD[new Date(`${at(2)}T00:00:00Z`).getUTCDay()]} ${day(at(2))}`, at(2)], [`Mon ${day(mon)}`, mon], ['In two weeks', at(14)]];
  const moves = ['Call', 'WhatsApp', 'Visit', 'Send the pitch'];
  const pick = (name, items, on) => `<div class="chips" role="radiogroup" aria-label="${name}">${items.map(([label, v], i) => `<button class="chip-btn${i === on ? ' on' : ''}" role="radio" data-cl="pick" data-v="${esc(v)}" aria-checked="${i === on}">${esc(label)}</button>`).join('')}</div>`;
  openSheet({
    title: 'Next touch', sub: `${esc(l.name)} · one date, one move`, cls: 'cl-touch-sheet',
    body: `<div class="cl-touchsheet">
      <p class="cl-lbl">When</p>${pick('When', whens, 1)}
      <p class="cl-lbl">Move</p>${pick('Move', moves.map((m) => [m, m]), 0)}
      <p class="foot cl-touch-note">The next touch lives in ${esc(l.osFolder)}\\index.md. A job on your PC writes it there.</p>
      <button class="btn primary cl-wide" style="--c:var(--clients-fill)" data-cl="touch-save" data-id="${esc(l.slug)}">Start a job to set it</button>
    </div>`,
  });
}
// what you type becomes the folder name; a name that is already a lead or client is caught here, not after
const slugify = (t) => t.split(/[,.\n:;–—]/)[0].toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s-]/g, '').trim().split(/\s+/).slice(0, 4).join('-');
const dupOf = (slug) => [...(D()?.leads ?? []), ...(D()?.clients ?? [])].find((x) => slug && (x.slug === slug || slug.startsWith(x.slug) || x.slug.startsWith(slug)));
function newLeadSheet() {
  const mic = AOS.work?.voice?.micButtonHTML?.('data-mic-for="clNlIn" data-source="clients" data-purpose="context"') ?? '';
  openSheet({
    title: 'New lead', sub: 'Paste or speak what you know. Lead intake files it.', cls: 'cl-nl-sheet', size: 'large',
    body: (b) => {
      b.innerHTML = `<div class="cl-nl">
        <div class="cl-nl-field"><textarea class="cl-nl-in" id="clNlIn" rows="3" placeholder="Who they are, what they need, how you met" aria-label="What you know about the lead"></textarea>${mic}</div>
        <div class="rec-slot" data-rec-for="clNlIn"></div>
        <div class="cl-nl-tools"><button class="chip-btn" data-cl="nl-paste">${I.paste}Paste</button><span class="cl-nl-to"><span>Files to</span><span class="mono cl-nl-path">sales\\…\\</span></span></div>
        <p class="cl-nl-dup" hidden></p>
        <ol class="cl-nl-steps">
          <li><b>Reads</b> what you paste or say</li>
          <li><b>Checks</b> your clients and leads for a duplicate</li>
          <li><b>Files</b> it in northwind-os with index.md, potential.md and raw/</li>
        </ol>
        <button class="btn primary cl-wide" style="--c:var(--clients-fill)" data-cl="nl-go" disabled>File the lead</button>
      </div>`;
      $('.cl-nl-in', b).addEventListener('input', () => nlUpdate(b));
      setTimeout(() => $('.cl-nl-in', b)?.focus({ preventScroll: true }), 420);
    },
  });
}
function nlUpdate(b) {
  const v = $('.cl-nl-in', b).value.trim();
  const slug = slugify(v);
  const dup = dupOf(slug);
  $('.cl-nl-path', b).textContent = dup ? `${(dup.osFolder ?? dup.brainFolder ?? `sales\\${dup.slug}`).replace(/^northwind-(os|brain)\\/, '')}\\raw\\` : `sales\\${slug || '…'}\\`;
  const d = $('.cl-nl-dup', b);
  d.hidden = !dup;
  if (dup) d.innerHTML = `<b>${esc(dup.name)}</b> is already ${dup.kind === 'lead' ? 'a lead' : 'a client'}. This goes into its raw/ folder instead of a new one.`;
  const go = $('[data-cl="nl-go"]', b);
  go.disabled = !slug;
  go.textContent = dup ? `Add to ${dup.name}` : 'File the lead';
}
function searchSheet() {
  openSheet({
    title: 'Search clients', size: 'large', cls: 'cl-search-sheet',
    body: (b) => {
      b.innerHTML = `<label class="ifield cl-find">${I.search}<input type="search" placeholder="Clients, leads, products" autocomplete="off" enterkeyhint="search" aria-label="Search clients and leads" /><button class="cl-find-x" type="button" aria-label="Clear the search" hidden>${I.x}</button></label><div class="cl-res" aria-live="polite"></div>`;
      const d = D();
      // retired clients are found too, but they have no page to open
      const retired = (d?.retired ?? []).map((r) => ({ ...r, kind: 'retired', stage: 'retired', mono: r.name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join('') }));
      const res = $('.cl-res', b), input = $('input', b), clear = $('.cl-find-x', b);
      const meta = (x) => (x.kind === 'lead' ? `${cap(x.stage)} · ${x.warmth === 'unknown' ? 'warmth not set' : x.warmth}` : x.kind === 'retired' ? x.note : [x.product, x.stage].filter(Boolean).join(' · '));
      const row = (x) => (x.kind === 'retired'
        ? `<div class="lrow ic cl-res-ret">${mono(x, 'sm')}<span class="rbody"><span class="rtitle">${esc(x.name)}</span><span class="rmeta"><span class="ell">${esc(meta(x))}</span></span></span></div>`
        : `<button class="lrow ic" data-cl="${x.kind === 'lead' ? 'lead' : 'client'}" data-id="${esc(x.slug)}">${mono(x, 'sm')}<span class="rbody"><span class="rtitle">${esc(x.name)}</span><span class="rmeta"><span class="ell">${esc(meta(x))}</span></span></span>${I.chevR}</button>`);
      const drawRes = (q) => {
        const hit = (x) => !q || `${x.name} ${x.product ?? ''} ${x.stage} ${x.slug}`.toLowerCase().includes(q.toLowerCase());
        const parts = [['Clients', d?.clients ?? []], ['Leads', d?.leads ?? []], ['Retired', retired]].map(([t, xs]) => [t, xs.filter(hit)]).filter(([, xs]) => xs.length);
        res.innerHTML = parts.length ? parts.map(([t, xs]) => `<p class="cl-lbl">${t}<span class="num">${xs.length}</span></p><div class="group cl-res-g">${xs.map(row).join('')}</div>`).join('')
          : `<div class="note cl-empty"><b>Nothing matches “${esc(q)}”</b>Search looks at names, products and stages.</div>`;
        clear.hidden = !input.value;
      };
      drawRes('');
      input.addEventListener('input', () => drawRes(input.value.trim()));
      clear.addEventListener('click', (e) => { e.preventDefault(); input.value = ''; drawRes(''); input.focus(); });
      setTimeout(() => input.focus({ preventScroll: true }), 420);
    },
  });
}

// ── starting a job for a client ──
// The job sheet (app/work) takes a folder when its owner adds it (AOS.work.jobFolders); until then this module's own
// start sheet posts the same /jobs call with the folder as the place to work, then opens the job's live page.
function placesOf(c) {
  const out = [];
  if (c?.osPath) out.push({ id: 'os', label: 'OS folder', rel: c.osFolder, path: c.osPath });
  if (c?.brainPath) out.push({ id: 'brain', label: 'Brain folder', rel: c.brainFolder, path: c.brainPath });
  return out;
}
function startJob({ title, context, places, client }) {
  if (!AOS.owner || !AOS.real) { AOS.toast('Jobs run on the owner’s PC'); return; }
  if (!places.length) { AOS.toast('No folder for this on the PC yet'); return; }
  closeSheet();
  const w = AOS.work;
  if (w?.jobFolders && w.openJobSheet) { w.openJobSheet({ folder: places[0].path, folders: places.map((p) => p.path), title, context, client }); return; }
  jobSheet({ title, context, places, client });
}
const ENGINES = [['claude', 'Claude'], ['codex', 'Codex']];
const MODES = [['ask', 'Ask first', 'Every edit and command comes to this phone for an OK.'], ['edits', 'Auto-edit', 'File edits go through; commands come to this phone.'], ['auto', 'Full access', 'Nothing asks; it works on its own.']];
let J = null;
function jobSheet(o) {
  if (!JS) { const el = sheetEl('crmJobSheet', 'cl-job-sheet'); JS = { el, s: AOS.makeSheet(el, { detents: fitDetents(el), scrimFor }) }; }
  J = { ...o, engine: read(LS.engine) === 'codex' ? 'codex' : 'claude', place: 0, mode: 'auto' };
  const el = JS.el;
  el.setAttribute('aria-label', 'Start a job');
  $('.sheet-head', el).innerHTML = `<div class="cl-shead"><div class="cl-shead-t"><h2>Start a job</h2><p>${o.client ? `For ${esc(o.client.name)} · ` : ''}runs on your PC</p></div><button class="sheet-close" data-cl="job-close" aria-label="Close">${I.x}</button></div>`;
  $('.sheet-body', el).innerHTML = '<div class="cl-sb cl-jobsheet"></div>';
  drawJobSheet(true);
  requestAnimationFrame(() => JS.s.open('large'));
  AOS.haptic('light');
}
function drawJobSheet(fresh = false) {
  const b = $('.cl-jobsheet', JS.el);
  const keep = fresh ? J.context : $('#clJobCtx', b)?.value ?? J.context;
  const p = J.places[J.place];
  b.innerHTML = `
    <div class="cl-jfield"><span class="cl-lbl">Engine</span>${seg('cl-engine', ENGINES, J.engine, { label: 'Engine' })}</div>
    <div class="cl-jfield"><span class="cl-lbl">Where it works</span>
      <div class="chips" role="radiogroup" aria-label="Where it works">${J.places.map((x, i) => `<button class="chip-btn${i === J.place ? ' on' : ''}" role="radio" aria-checked="${i === J.place}" data-cl="job-place" data-i="${i}">${I.folder}${esc(x.label)}</button>`).join('')}</div>
      <p class="foot cl-jpath"><span class="mono">${esc(p.rel)}</span></p></div>
    <div class="cl-jfield"><span class="cl-lbl">What to do</span><label class="ifield cl-ta"><textarea id="clJobCtx" rows="5" aria-label="What the job should do">${esc(keep)}</textarea></label></div>
    <div class="cl-jfield"><span class="cl-lbl">Permissions</span><div class="chips" role="radiogroup" aria-label="Permissions">${MODES.map(([v, l]) => `<button class="chip-btn${J.mode === v ? ' on' : ''}" role="radio" aria-checked="${J.mode === v}" data-cl="job-mode" data-v="${v}">${l}</button>`).join('')}</div><p class="foot">${MODES.find((m) => m[0] === J.mode)[2]}</p></div>
    <button class="btn primary cl-wide" style="--c:var(--clients-fill)" data-cl="job-go">${I.claude}Start with ${J.engine === 'codex' ? 'Codex' : 'Claude'}</button>`;
}
async function jobGo(btn) {
  const context = $('#clJobCtx', JS.el)?.value.trim();
  if (!context) { AOS.toast('Say what the job should do'); return; }
  btn.disabled = true; btn.textContent = 'Starting';
  try {
    const first = context.split('\n')[0];
    const r = await AOS.api('/jobs', { method: 'POST', body: JSON.stringify({ engine: J.engine, cwd: J.places[J.place].path, title: J.title ?? (first.length > 80 ? `${first.slice(0, 78).trimEnd()}…` : first), context, mode: J.mode }) });
    JS.s.close();
    AOS.haptic('success');
    await AOS.work?.reload?.().catch(() => {});
    if (r?.job?.id && AOS.work?.openJob) AOS.work.openJob(r.job.id); else AOS.toast('Job started on your PC');
  } catch (e) { btn.disabled = false; btn.textContent = `Start with ${J.engine === 'codex' ? 'Codex' : 'Claude'}`; AOS.toast(e?.status ? e.message : 'Your PC isn’t reachable right now'); }
}
document.addEventListener('segchange', (e) => {
  const n = e.target?.dataset?.seg;
  if (n === 'cl-view') { S.view = e.detail; write(LS.view, S.view); panel(true); }
  else if (n === 'cl-engine' && J) { J.engine = e.detail; write(LS.engine, J.engine); drawJobSheet(); }
});

// the job each client action asks for
const clientJob = (c, what) => ({ title: `${c.name}: ${what.split('\n')[0]}`.slice(0, 80), context: what, places: placesOf(c), client: { slug: c.slug, name: c.name } });

// ── actions ───────────────────────────────────────────────────────────
const ACT = {
  client: (b) => { closeSheet(); openClient(b.dataset.id); },
  lead: (b) => { closeSheet(); openLead(b.dataset.id); },
  retry: () => load({ fresh: true }),
  sync: (b) => { b.disabled = true; b.innerHTML = '<span class="spin" aria-label="Syncing"></span>'; load({ fresh: true }).then(() => { if (!S.error) AOS.toast('Read northwind-os and northwind-brain again'); }); },
  retired: () => { S.retired = !S.retired; AOS.haptic('selection'); panel(); },
  'more-log': (b) => { S.logAll.add(b.dataset.id); AOS.haptic('light'); refreshPages(); },
  project: (b) => AOS.work?.openProject?.(b.dataset.id),
  window: () => AOS.openPage('clients'),
  search: () => searchSheet(),
  'new-lead': () => newLeadSheet(),
  close: () => closeSheet(),
  'job-close': () => JS?.s.close(),
  pick: (b) => { $$('.chip-btn', b.parentElement).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); AOS.haptic('selection'); },
  wait: (b) => {
    const k = b.dataset.k;
    const on = !S.done.has(k);
    if (on) S.done.add(k); else S.done.delete(k);
    write(LS.done, JSON.stringify([...S.done]));
    AOS.haptic(on ? 'success' : 'selection');
    refreshPages();
    if (on) AOS.toast('Ticked on this phone. NOW.md is unchanged', () => { S.done.delete(k); write(LS.done, JSON.stringify([...S.done])); refreshPages(); });
  },
  file: async (b) => {
    const p = b.dataset.path;
    try { await navigator.clipboard.writeText(p); AOS.haptic('success'); AOS.toast('Path copied'); } catch { AOS.toast(p); }
  },
  pin: (b) => {
    const c = clientOf(b.dataset.id);
    if (!c) return;
    const on = !isPinned(c);
    S.pin = on ? c.slug : null;
    write(LS.pin, S.pin);
    AOS.haptic(on ? 'success' : 'selection');
    S.ver++; draw(); refreshPages();
    AOS.toast(on ? `Pinned ${c.name}: it stays first in Clients on this phone` : `Unpinned ${c.name}`);
  },
  job: (b) => { const c = clientOf(b.dataset.id); if (c) startJob(clientJob(c, `For ${c.name}. Next step: ${c.next.text}.`)); },
  flows: (b) => { const c = clientOf(b.dataset.id); if (c) flowsSheet(c); },
  'flow-run': (b) => {
    const c = clientOf(b.dataset.id), w = D()?.workflows.find((x) => x.id === b.dataset.w);
    if (!c || !w) return;
    if (!w.built) { AOS.haptic('light'); AOS.toast(`${w.name} is written down, not built${w.needsOk ? ', and needs your OK' : ''}. Nothing to run yet`); return; }
    startJob(clientJob(c, `Run the ${w.id} workflow for ${c.name} (northwind-os\\WORKFLOWS.md${w.id.includes('-') ? `, skills\\${w.id}` : ''}).${w.needsOk ? ' It is agency-era: ask me before doing anything.' : ''}`));
  },
  log: (b) => { const c = clientOf(b.dataset.id); if (c && writeState(c).on) logSheet(c); },
  'log-save': async (b) => {
    const sh = b.closest('.sheet'); const v = $('textarea', sh)?.value.trim(); if (!v) return;
    b.disabled = true; b.textContent = 'Adding';
    try {
      const r = await AOS.api(`${API}/clients/${encodeURIComponent(b.dataset.id)}/log`, { method: 'POST', body: JSON.stringify({ text: v }) });
      if (r.client) { r.client.log = r.client.log.map((e, i) => (i === 0 ? { ...e, fresh: true } : e)); S.full.set(b.dataset.id, { ...r.client, write: { on: true } }); }
      closeSheet(); AOS.haptic('success'); refreshPages(); load();
      AOS.toast('Added to work-log.md');
    } catch (e) { b.disabled = false; b.textContent = 'Add to the work log'; AOS.toast(e?.status ? e.message : 'Your PC isn’t reachable right now'); }
  },
  issue: (b) => {
    const i = issueList()[+b.dataset.i]; const fix = i && issueFix(i);
    if (!fix) return;
    const c = fix.slug ? clientOf(fix.slug) : null;
    const places = fix.at === 'os' ? [{ id: 'os', label: 'northwind-os', rel: 'northwind-os', path: D().sync.os }] : placesOf(c);
    startJob({ title: fix.label, context: fix.ask, places, client: c ? { slug: c.slug, name: c.name } : null });
  },
  'make-os': (b) => {
    const c = clientOf(b.dataset.id); if (!c) return;
    startJob({ title: `Create the OS folder for ${c.name}`, context: `Create clients\\${c.slug} in northwind-os from _templates\\client\\ (OS.md §5), filled from northwind-brain\\clients\\${c.slug}\\dossier.md and work-log.md. Write unknown (ask) for anything the brain doesn't say.`, places: [{ id: 'os', label: 'northwind-os', rel: 'northwind-os', path: D().sync.os }], client: { slug: c.slug, name: c.name } });
  },
  touch: (b) => { const l = leadOf(b.dataset.id); if (l) touchSheet(l); },
  'touch-save': (b) => {
    const l = leadOf(b.dataset.id); if (!l) return;
    const [when, move] = $$('.chips', b.closest('.sheet')).map((g) => $('.chip-btn.on', g)?.dataset.v ?? '');
    startJob({ title: `${l.name}: next touch`, context: `In ${l.osFolder}\\index.md set the next-touch line to: next-touch: ${when} — ${move.toLowerCase()}. It is sacred (OS.md rule 11); change nothing else.`, places: [{ id: 'lead', label: 'Sales folder', rel: l.osFolder, path: l.osPath }], client: { slug: l.slug, name: l.name } });
  },
  'lead-flow': (b) => {
    const l = leadOf(b.dataset.id), w = D()?.workflows.find((x) => x.id === b.dataset.w);
    if (!l) return;
    if (!w?.built) { AOS.haptic('light'); AOS.toast(`${w?.name ?? 'That'} is written down, not built. Nothing to run yet`); return; }
    startJob({ title: `${w.name}: ${l.name}`, context: `Use the ${w.id} skill (northwind-os\\skills\\${w.id}) for the lead ${l.name} in ${l.osFolder}.`, places: [{ id: 'lead', label: 'Sales folder', rel: l.osFolder, path: l.osPath }], client: { slug: l.slug, name: l.name } });
  },
  'nl-paste': async (b) => {
    const sh = b.closest('.sheet'); const ta = $('.cl-nl-in', sh);
    try { const t = await navigator.clipboard.readText(); if (t) { ta.value = t.trim(); nlUpdate(sh); AOS.haptic('light'); } else AOS.toast('Nothing to paste'); }
    catch { AOS.toast('The clipboard isn’t readable here. Long-press the box to paste'); }
  },
  'nl-go': (b) => {
    const sh = b.closest('.sheet'); const v = $('.cl-nl-in', sh)?.value.trim(); const slug = slugify(v ?? '');
    if (!slug) return;
    const dup = dupOf(slug);
    const os = D()?.sync.os;
    if (!os) { AOS.toast('northwind-os isn’t on the PC'); return; }
    startJob({
      title: dup ? `Lead intake: more on ${dup.name}` : `Lead intake: ${v.split('\n')[0].slice(0, 60)}`,
      context: dup ? `Use the lead-intake skill. This is more about ${dup.name}, already ${dup.kind === 'lead' ? 'a lead' : 'a client'}: file it in its raw/ folder, not a new one.\n\n${v}` : `Use the lead-intake skill (northwind-os\\skills\\lead-intake). New lead:\n\n${v}\n\nCheck clients and leads for a duplicate first, then file it under sales\\${slug}\\.`,
      places: [{ id: 'os', label: 'northwind-os', rel: 'northwind-os', path: os }],
    });
  },
  'job-place': (b) => { J.place = +b.dataset.i; AOS.haptic('selection'); drawJobSheet(); },
  'job-mode': (b) => { J.mode = b.dataset.v; AOS.haptic('selection'); drawJobSheet(); },
  'job-go': (b) => jobGo(b),
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cl]');
  if (!b || b.disabled) return;
  const fn = ACT[b.dataset.cl];
  if (!fn) return;
  e.preventDefault();
  fn(b, e);
});

// ── the tab hook: AOS.registerTab (render once, onShow on every reopen; the app pulses the rings after either) ──
// Opening the tab reads the files again when this phone's copy is more than a minute old (the server caches 60 s too).
const stale = () => !S.data || Date.now() - S.at > 60_000;
function onShow() { if (stale()) load(); draw(true); }
if (typeof AOS.registerTab === 'function') AOS.registerTab('clients', { render: onShow, onShow });
else {
  // an app.js without registerTab: draw on its render passes and watch the page open
  if (typeof AOS.tab === 'function') AOS.tab('clients', () => draw());
  const page = document.getElementById('pageClients');
  let wasHidden = page?.hidden ?? true;
  if (page) new MutationObserver(() => { if (wasHidden && !page.hidden) onShow(); wasHidden = page.hidden; }).observe(page, { attributes: true, attributeFilter: ['hidden'] });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (visible() || pages.size) && stale()) load(); });
// other areas open a client or a lead, or ask which one is pinned
AOS.crm = { openClient, openLead, pinned: () => (S.pin ? clientOf(S.pin) : null), placesOf: (slug) => placesOf(clientOf(slug)) };
draw();
if (AOS.owner) load();

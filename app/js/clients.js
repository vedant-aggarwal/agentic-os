// Clients: the client system on the PC (studio-os, the body; studio-brain, the mind), read through the server
// (server/modules/crm.ts), and the pages clients see (server/modules/clients.ts). Up top a money ring and the health
// split, then Clients · Leads · Pipeline. Every client and lead opens a page that mirrors its files.
//
// Real mode: GET /mod/crm/overview, kept on this phone (agentos-app:crm-overview) so Clients opens offline and says when
// it was read; each page also reads /clients/<slug> or /leads/<slug>. It reads again on open, on Sync now and every 60 s
// while Clients or Work is on screen. Nothing here edits a client file itself: Log work is the one direct write (POST
// /clients/<slug>/log, only while the server's CRM_WRITE is on; otherwise the sheet says why). Everything else that would
// change a file (an OS folder from the template, a new lead, a lead's next touch, a workflow, the fixes the sync finds)
// becomes a job in Work's New job sheet (api.newJob, with the client's folders), and he taps Start. The client window
// (their link, the preview, questions for them) goes through /mod/clients.
// Demo mode (?data=demo) draws clients-data.js and keeps the prototype's session-only flows.
// Clients has no tab of its own. It lives in Work as a page with the dock kept (openClients, data-act w-clients,
// api.openClients); #clients and setTab('clients') land there too. Bus: openClients, openClient, openLead, clientsSummary
// (and a 'clients-changed' event on document whenever what it returns may have moved).
import { $, $$, esc, registerTab, setTab, currentTab, push, openSheet, closeSheet, toast, on, seg, ring, setRing, pulse, haptic, wireSegs } from './core.js';
import { I } from './icons.js';
import * as DEMO from './clients-data.js';
import { project, DEMO_MODE, USER } from './data.js';
import { scope } from './scope.js';
import { api, provide } from './bus.js';
import { recorder } from './work-ui.js';
import * as clock from './svc/clock.js';
import { api as pc, connection, onConnection, ls } from './svc/api.js';
import { every } from './svc/live.js';
import { registerRoute } from './svc/route.js';
import { stagger, rollHTML, roll, flipList, symbol, springCurve, reduced } from './motion.js';

const REAL = !DEMO_MODE;
const { HEALTH } = DEMO;
const HC = { green: 'var(--done)', yellow: 'var(--warn)', red: 'var(--fail)' };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const VIEWS = ['clients', 'leads', 'pipeline'];
// the path is every stage from the OS cards except the ones a lead or client leaves it by
const OFF = ['snoozed', 'dead', 'paused', 'churned'];
const K = { overview: 'agentos-app:crm-overview', detail: 'agentos-app:crm-details', win: 'agentos-app:crm-window', done: 'agentos-app:crm-done', outbox: 'agentos-app:crm-log-outbox', view: 'agentos-app:crm-view' };
const jsonOf = (k) => { try { return JSON.parse(ls.get(k) ?? 'null'); } catch { return null; } };

// ── what is on screen: the clients, from the demo file or the PC, in one shape ──
const M = {
  ready: false, clients: [], leads: [], retired: [], stages: { client: [], lead: [], off: OFF }, workflows: [], issues: [],
  write: { on: false, why: '' }, today: '', snapshotAt: '', os: '', found: { brain: true, os: true },
  readAt: 0,     // when the PC read the files (ms)
  gotAt: 0,      // when this phone got that read
};
// the PC: the read in flight, the last failure ({ offline, message }), the pages read one by one, the client window
const NET = { loading: null, error: null, detail: new Map(), lead: new Map(), win: null, winLoading: null, winError: null };
const S = {
  view: 'clients', prev: 'clients', retired: false,
  logAll: new Set(),        // client pages showing every work-log entry
  done: new Set(),          // "slug:text": a waiting-on-you item ticked on this phone (real: kept here, NOW.md unchanged)
  // demo only: the prototype's session changes
  made: new Set(), logs: {}, touch: {}, synced: DEMO.SYNC.at,
};
const owner = () => !REAL || !!USER?.owner;
const today = () => clock.today();

// ── small words ──────────────────────────────────────────────────────
const cap = (s) => String(s ?? '').charAt(0).toUpperCase() + String(s ?? '').slice(1);
const isoDay = (s) => /^\d{4}-\d\d-\d\d/.test(s ?? '');
// "21 Oct" never breaks between the day and the month
const day = (iso) => (isoDay(iso) ? `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]}` : String(iso ?? ''));
const dayYear = (iso) => (isoDay(iso) && iso.slice(0, 4) !== today().slice(0, 4) ? `${day(iso)} ${iso.slice(0, 4)}` : day(iso));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// today, ASAP and overdue ask for you; no date is quiet. is-today lets a skin tell today from overdue
const dueTone = (d) => (/^today/i.test(d) ? 'late is-today' : /^(overdue|asap)/i.test(d) ? 'late' : /no date|unknown|not scheduled|not set/i.test(d) ? 'quiet' : '');
// the list leads with what is most urgent: overdue and ASAP, today, dated, no date
const dueRank = (d) => (/^(overdue|asap)/i.test(d) ? 0 : /^today/i.test(d) ? 1 : /^(no date|unknown|not scheduled)/i.test(d) ? 3 : 2);
const isPinned = (c) => scope.client?.slug === c.slug;
// a workflow named like a folder (catalog-fill) reads as words, with its folder underneath
const kebab = (n) => /^[a-z0-9]+(-[a-z0-9]+)+$/.test(n ?? '');
const flowName = (id) => (M.workflows.length ? M.workflows : DEMO.WORKFLOWS).find((x) => x.id === id)?.name ?? (kebab(id) ? cap(id.replace(/-/g, ' ')) : id);
const onPath = (stages) => stages.filter((s) => !M.stages.off.includes(s));
const offPath = (stages) => stages.filter((s) => M.stages.off.includes(s));
const overdue = (n) => `Overdue ${n} day${n === 1 ? '' : 's'}`;
/** When something is due, said from today: Today, Overdue 2 days, Tomorrow, Fri 23, 9 Nov (the server's words). */
function dueLabel(iso) {
  const t = today(), d = clock.daysBetween(t, iso);
  if (d === 0) return 'Today';
  if (d < 0) return overdue(-d);
  if (d === 1) return 'Tomorrow';
  if (d < 7) return `${WD[clock.dparts(iso).dow]} ${+iso.slice(8, 10)}`;
  return iso.slice(0, 4) === t.slice(0, 4) ? day(iso) : `${day(iso)} ${iso.slice(0, 4)}`;
}
// "Today" or "Fri 23" was said on the day the files were read (or on the snapshot's day, for a field no file gives):
// said again from today, so a copy kept on this phone never calls yesterday Today
function relabel(when, base) {
  const t = today();
  if (!when || !base || base >= t) return when;
  const d = clock.daysBetween(base, t);
  if (/^today$/i.test(when)) return overdue(d);
  let m = when.match(/^overdue (\d+) days?$/i);
  if (m) return overdue(+m[1] + d);
  if (/^tomorrow$/i.test(when)) return d === 1 ? 'Today' : overdue(d - 1);
  m = when.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d{1,2})$/);
  if (m) for (let i = 0; i < 7; i++) { const iso = clock.addDays(base, i); if (+iso.slice(8, 10) === +m[2]) return dueLabel(iso); }
  return when;
}
const agoText = (ms) => {
  const m = Math.round((clock.nowMs() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 24 * 60 ? `${Math.round(m / 60)} h ago` : `on ${day(clock.dateAt(ms))}`;
};
const atText = (ms) => { const d = clock.dateAt(ms); const t = clock.hm(clock.toMin(new Date(ms).toISOString(), d)); return d === today() ? t : `${day(d)}, ${t}`; };

// ── money, read from the payments rows. Amounts are text in the files: "₹40,000", "≈ ₹20,000", "₹1.5L", "Not set" ──
const rupees = (s) => { const m = String(s).replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s?(L|lakh|k)?\b/i); if (!m) return null; const n = +m[1]; return /^l/i.test(m[2] ?? '') ? n * 1e5 : /^k/i.test(m[2] ?? '') ? n * 1e3 : n; };
const inr = (n) => `₹${Math.round(n).toLocaleString('en-IN')}`;
/** D-022: free work is never counted, so the totals leave free builds out (one client's own card counts all its rows). */
function money(list = M.clients, { all = false } = {}) {
  let paid = 0, due = 0, approx = false, unpriced = 0;
  for (const c of list) {
    if (c.free && !all) continue;
    for (const r of c.money.rows) {
      const n = rupees(r.amount);
      if (r.status === 'paid') paid += n ?? 0;
      else if (r.status === 'due' || r.status === 'partial') { if (n == null) unpriced += 1; else { due += n; if (/≈|~/.test(r.amount)) approx = true; } }
    }
  }
  return { paid, due, approx, unpriced, billed: paid + due };
}
const owing = () => M.clients.filter((c) => !c.free && c.money.state === 'due');

// ── one shape for a client and a lead, whichever side drew them ───────
function normClient(c, base = {}) {
  const src = c.src ?? {};
  const on = (k) => (src[k] === 'snapshot' ? base.snapshotAt ?? M.snapshotAt : base.today ?? M.today);
  const flow = (w) => (REAL
    ? { name: kebab(w.name) ? cap(w.name.replace(/-/g, ' ')) : w.name, status: w.status ?? 'running', folder: w.folder ?? null, detail: w.detail ?? '' }
    : kebab(w.name) ? { name: flowName(w.name), status: w.status, folder: w.name, detail: '' } : { name: w.name, status: w.status, folder: null, detail: '' });
  const keyDate = (k) => {
    if (REAL && k.iso) { const d = clock.daysBetween(today(), k.iso); const when = d >= 0 ? dueLabel(k.iso) : day(k.iso); return { what: k.what, when, tone: d < 0 ? 'quiet' : dueTone(when) }; }
    const when = REAL ? relabel(k.when, on('keyDates')) : k.when;
    return { what: k.what, when, tone: k.tone === 'quiet' ? 'quiet' : dueTone(when) };
  };
  return {
    ...c,
    free: c.free ?? !!c.freeNote, product: c.product ?? '', package: c.package ?? '', stage: c.stage ?? 'active', stageNote: c.stageNote ?? '',
    since: c.since ?? '', summary: c.summary ?? '', health: HC[c.health] ? c.health : 'green',
    next: { owner: 'you', text: 'Nothing on record', ...c.next, due: REAL ? relabel(c.next?.due ?? 'No date', on('next')) : c.next.due },
    waitingOn: { you: (c.waitingOn?.you ?? []).map((x) => (typeof x === 'string' ? { text: x, detail: '' } : { text: x.text, detail: x.detail ?? '' })), them: [...(c.waitingOn?.them ?? [])] },
    money: { outstanding: c.money?.outstanding ?? '₹0', state: c.money?.state ?? 'none', rows: c.money?.rows ?? [], asOf: c.money?.asOf ?? null },
    workflows: (c.workflows ?? []).map(flow),
    keyDates: (c.keyDates ?? []).map(keyDate),
    log: [...(c.log ?? [])], logCount: c.logCount ?? (c.log ?? []).length,
    contract: { term: '', deliverables: [], payment: '', note: '', ...c.contract },
    commercials: c.commercials ?? [], goals: c.goals ?? [], projects: c.projects ?? [], src, files: c.files ?? null,
    osFolder: c.osFolder ?? null, brainFolder: c.brainFolder ?? null, osPath: c.osPath ?? null, brainPath: c.brainPath ?? null,
  };
}
function normLead(l) {
  let t = l.nextTouch;
  if (typeof t === 'string') t = { text: t, set: !/not set/i.test(t), iso: null, what: '' };
  t = { text: 'Not set (ask)', set: false, iso: null, what: '', ...t };
  if (REAL && t.iso) t = { ...t, text: `${dueLabel(t.iso)}${t.what ? ` · ${cap(t.what)}` : ''}` };
  return { warmthText: '', source: '', onBoard: true, files: null, osPath: null, note: '', since: '', potential: 'Unknown', pitch: 'Not started', ...l, nextTouch: t };
}
function fromDemo() {
  M.today = today();
  M.workflows = DEMO.WORKFLOWS;
  M.clients = DEMO.CLIENTS.map((c) => normClient(c));
  M.leads = DEMO.LEADS.map(normLead);
  M.retired = DEMO.RETIRED.map((r) => ({ ...r }));
  M.stages = { client: DEMO.CLIENT_STAGES, lead: DEMO.LEAD_STAGES, off: OFF };
  M.issues = DEMO.SYNC.issues;
  M.write = { on: true, why: '' };
  M.ready = true;
}
function fromOverview(d, gotAt) {
  M.today = d.today ?? today();
  M.snapshotAt = d.snapshotAt ?? '';
  M.workflows = d.workflows ?? [];
  M.clients = (d.clients ?? []).map((c) => normClient(c));
  M.leads = (d.leads ?? []).map(normLead);
  M.retired = d.retired ?? [];
  M.stages = { client: d.stages?.client ?? DEMO.CLIENT_STAGES, lead: d.stages?.lead ?? DEMO.LEAD_STAGES, off: d.stages?.off ?? OFF };
  M.issues = d.sync?.issues ?? [];
  M.write = d.write ?? { on: false, why: '' };
  M.os = d.sync?.os ?? '';
  M.found = d.sync?.found ?? { brain: true, os: true };
  M.readAt = Date.parse(d.sync?.at ?? '') || gotAt;
  M.gotAt = gotAt;
  M.ready = true;
}
// a page read from /clients/<slug> has the whole work log and the files; under a newer list it keeps those two
const logKey = (e) => `${e.date}|${e.title}`;
function mergeLog(a, b) { const seen = new Set(); return [...a, ...b].filter((e) => { const k = logKey(e); if (seen.has(k)) return false; seen.add(k); return true; }).sort((x, y) => String(y.date).localeCompare(String(x.date))); }
function clientOf(slug) {
  const card = M.clients.find((c) => c.slug === slug) ?? null;
  const det = NET.detail.get(slug);
  if (!det) return card;
  if (!card) return M.ready ? null : det.c;
  if (det.at >= M.gotAt) return det.c;
  return { ...card, log: mergeLog(card.log, det.c.log), files: det.c.files };
}
const leadOf = (slug) => { const l = M.leads.find((x) => x.slug === slug) ?? null; const det = NET.lead.get(slug); return det && (!l || det.at >= M.gotAt) ? det.l : l; };
const clientsOf = (slug) => clientOf(slug) ?? leadOf(slug);
// where a client's work happens on the PC: its OS folder, its brain folder, then its projects' folders
const placesOf = (c) => [...new Set([c?.osPath, c?.brainPath, ...(c?.projects ?? []).map((p) => project(p)?.folder)].filter(Boolean))];

// ── reading the PC ───────────────────────────────────────────────────
function fromCache() {
  const c = jsonOf(K.overview);
  if (c?.d?.clients) { try { fromOverview(c.d, c.at); } catch (e) { console.warn('[clients] the kept copy did not read', e); } }
  const det = jsonOf(K.detail) ?? {};
  for (const [slug, x] of Object.entries(det)) if (x?.client) { try { NET.detail.set(slug, { at: x.at, today: x.today, raw: x.client, c: normClient(x.client, { today: x.today }) }); } catch {} }
  const w = jsonOf(K.win);
  if (w?.clients) NET.win = w;
  for (const k of jsonOf(K.done) ?? []) S.done.add(k);
  if (VIEWS.includes(ls.get(K.view))) S.view = S.prev = ls.get(K.view);
}
const isOffline = () => !!NET.error?.offline || connection().status === 'offline';
const failure = (e) => ({ offline: !e?.status, message: e?.status ? e.message || `Your PC answered ${e.status}` : '' });
/** The overview from the PC; a read already on its way is shared. fresh: the PC reads the files again (not its 60 s copy). */
function load({ fresh = false } = {}) {
  if (!REAL || !owner()) return Promise.resolve();
  if (NET.loading) return NET.loading;
  NET.loading = (async () => {
    syncBits();
    let d;
    try { d = await pc(`/mod/crm/overview${fresh ? '?fresh=1' : ''}`, { timeout: 30000 }); }
    catch (e) { NET.loading = null; NET.error = failure(e); changed('error'); return; }
    const before = sig();
    const gotAt = clock.nowMs();
    try { fromOverview(d, gotAt); }
    catch (e) {
      // an answer this phone can't read is not the PC being away: the kept copy stays, and the line says so
      console.error('[clients] the overview did not read', e);
      NET.loading = null; NET.error = { offline: false, message: 'The client files came back in a shape this phone can’t read' };
      fromCache(); changed('error'); return;
    }
    NET.error = null;
    ls.set(K.overview, JSON.stringify({ at: gotAt, d }));
    NET.loading = null;
    changed(sig() === before ? 'fresh' : 'data');
    // the pages on screen read their whole client again; the rest wait until they open
    $$('#stack .cl-page[data-slug]').forEach((p) => loadClient(p.dataset.slug));
    $$('#stack .lead-page[data-lead]').forEach((p) => loadLead(p.dataset.lead));
    if ($('#stack .cl-page[data-slug]') || $('.cl-wins-sheet')) loadWin();
    flushLogs();
  })();
  return NET.loading;
}
// what the views show, so a read that changed nothing changes nothing on screen
const sig = () => JSON.stringify([M.clients, M.leads, M.retired, M.issues, M.workflows.length, M.write, M.stages]);
function keepDetails() {
  const out = {};
  [...NET.detail.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, 8).forEach(([slug, x]) => { if (x.raw) out[slug] = { at: x.at, today: x.today, client: x.raw }; });
  ls.set(K.detail, JSON.stringify(out));
}
async function loadClient(slug) {
  if (!REAL || !owner() || !slug) return;
  try {
    const r = await pc(`/mod/crm/clients/${encodeURIComponent(slug)}`, { timeout: 30000 });
    NET.detail.set(slug, { at: clock.nowMs(), today: r.today, raw: r.client, c: normClient(r.client, { today: r.today }) });
    if (r.write) M.write = r.write;
    keepDetails();
  } catch (e) { if (e?.status === 404) NET.detail.delete(slug); }
  $$(`#stack .cl-page[data-slug="${CSS.escape(slug)}"]`).forEach(refreshClientPage);
}
async function loadLead(slug) {
  if (!REAL || !owner() || !slug) return;
  try { const r = await pc(`/mod/crm/leads/${encodeURIComponent(slug)}`, { timeout: 30000 }); NET.lead.set(slug, { at: clock.nowMs(), l: normLead(r.lead) }); }
  catch (e) { if (e?.status === 404) NET.lead.delete(slug); }
  $$(`#stack .lead-page[data-lead="${CSS.escape(slug)}"]`).forEach(refreshLeadPage);
}
/** The client window: each client's link, the questions waiting on them and their answers, and Claude's questions. */
function loadWin() {
  if (!REAL || !owner()) return Promise.resolve();
  if (NET.winLoading) return NET.winLoading;
  NET.winLoading = (async () => {
    try {
      const [a, d, q] = await Promise.all([pc('/mod/clients/'), pc('/mod/clients/decisions?all=1'), pc('/mod/clients/questions').catch(() => ({ questions: [] }))]);
      NET.win = { clients: a.clients ?? [], projects: a.projects ?? [], decisions: d.decisions ?? [], questions: q.questions ?? [], at: clock.nowMs() };
      NET.winError = null;
      ls.set(K.win, JSON.stringify(NET.win));
    } catch (e) { NET.winError = failure(e); }
    NET.winLoading = null;
    refreshWin();
  })();
  return NET.winLoading;
}
// after anything moved: every view on screen catches up, and Work's card hears it
let sumSig = '';
function changed(why) {
  refreshHome(why);
  $$('#stack .cl-page[data-slug]').forEach(refreshClientPage);
  $$('#stack .lead-page[data-lead]').forEach(refreshLeadPage);
  syncBits();
  document.dispatchEvent(new CustomEvent('clients-changed', { detail: { why } }));
  // the lead's shared event: Today and Life redraw an app's figures on it, so only when the money or the next thing moves
  const s = clientsSummary();
  const sig = `${s.ready}|${s.due}|${s.owe}|${s.paid}|${s.billed}|${s.next?.slug ?? ''}:${s.next?.text ?? ''}`;
  if (sig !== sumSig) { sumSig = sig; document.dispatchEvent(new CustomEvent('aspect-summary', { detail: { id: 'clients' } })); }
}

// ── Work's card: the same money rule as the ring (D-022), and the one thing most due ──
export function clientsSummary() {
  const m = money();
  const next = M.clients.filter((c) => c.next?.text && !/^nothing on record$/i.test(c.next.text))
    .sort((a, b) => dueRank(a.next.due) - dueRank(b.next.due) || Number(isPinned(b)) - Number(isPinned(a)) || Number(a.free) - Number(b.free))[0];
  return {
    due: m.due, approx: m.approx, owe: owing().length, unpriced: m.unpriced, paid: m.paid, billed: m.billed,
    next: next ? { slug: next.slug, name: next.name, text: next.next.text, due: next.next.due } : null,
    updatedAt: REAL && M.readAt ? new Date(M.readAt).toISOString() : null,
    ready: M.ready, offline: REAL && M.ready && isOffline(), demo: !REAL,
  };
}

// ── pieces every view uses ───────────────────────────────────────────
// a monogram on a control medallion (a skin may stamp it in its title face); the dot is the dossier's traffic light
const mono = (x, size = '') => `<span class="cl-mono ${size}" aria-hidden="true">${esc(x.mono)}${x.health ? `<i class="cl-hdot" style="--c:${HC[x.health]}"></i>` : ''}</span>`;
const warmth = (w) => {
  const n = { cold: 1, warm: 2, hot: 3 }[w] ?? 0;
  const label = !w || w === 'unknown' ? 'Not set' : cap(w);
  return `<span class="cl-warm" aria-label="Warmth: ${esc(label)}"><span class="cl-warm-b" aria-hidden="true">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>${esc(label)}</span>`;
};
// a hyphenated word (first-year) never breaks at its hyphen
const words = (t) => esc(t).replace(/[^\s-]+(?:-[^\s-]+)+/g, (w) => `<span class="cl-nw">${w}</span>`);
// a count beside a section or a list label; an empty one says nothing instead of 0
const count = (n, cls = 'sh-count') => (n ? `<span class="${cls}">${n}</span>` : '');
// the next step inside a card: the words take the width, the due floats on the first line, so neither is ever cut
const nextLine = (icon, text, due, tone = '') => `<span class="cl-next"><span class="cl-next-i" aria-hidden="true">${icon}</span><span class="cl-next-b"><span class="cl-due ${tone}">${esc(due)}</span>${words(text)}</span></span>`;
const stageText = (c) => [c.stage, c.stageNote].filter(Boolean).join(' · ');
// the money figure is a roll: digits move to a new value instead of being redrawn (motion.js)
const ROLL = { prefix: '₹', format: 'inr' };
const zeros = (v) => Math.round(v).toLocaleString('en-IN').replace(/\d/g, '0');
const springOf = (name) => springCurve(name);

// where the copy on screen came from, and how fresh it is
function staleLine() {
  if (!REAL || !M.ready || (!isOffline() && !NET.error)) return '';
  const what = isOffline() ? `<b>Offline:</b> this is the copy from ${esc(atText(M.readAt))}` : `<b>Not read:</b> ${esc(NET.error.message)}. This is the copy from ${esc(atText(M.readAt))}`;
  return `<p class="cl-stale" role="status">${I.cloud}<span>${what}</span></p>`;
}
function syncLine(what = DEMO.SYNC.source) {
  if (!REAL) return `<div class="cl-sync" data-what="${esc(what)}">${I.sync}<span class="cl-sync-t">Synced from ${esc(what)} · ${esc(S.synced)}</span><button class="cl-sync-btn" data-act="cl-sync">Sync now</button></div>`;
  const busy = !!NET.loading;
  const text = M.readAt ? `Read from your PC ${agoText(M.readAt)}` : busy ? 'Reading your PC' : 'Not read from your PC yet';
  return `<div class="cl-sync${busy ? ' is-busy' : ''}" data-what="${esc(what)}">${I.sync}<span class="cl-sync-t">${esc(text)}</span><button class="cl-sync-btn" data-act="cl-sync"${busy ? ' disabled' : ''}>${busy ? '<span class="spin" aria-label="Reading"></span>' : isOffline() ? 'Try again' : 'Sync now'}</button></div>`;
}
// a page's own line: when the files were read, and that it is this phone's copy while the PC is away
const freshText = () => (M.readAt ? (isOffline() ? `${agoText(M.readAt)}, kept on this phone` : agoText(M.readAt)) : '');
// the freshness bits move each minute and with the connection, without redrawing anything else
function syncBits() {
  if (!REAL) return;
  $$('.cl-sync').forEach((el) => { el.outerHTML = syncLine(el.dataset.what); });
  $$('.cl-stalebox').forEach((el) => {
    const html = staleLine();
    if (el.innerHTML === html) return;
    const was = !!el.firstElementChild;
    el.innerHTML = html;
    if (html && !was && !reduced()) el.firstElementChild.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { ...springOf('snappy'), fill: 'backwards' });
  });
  $$('.cl-fresh').forEach((el) => { el.textContent = freshText(); });
}

// ── the page: pushed over Work, with the dock, so Work stays lit and Back returns to it ──
export function openClients() {
  const open = $('#stack .cl-home');
  if (open) { draw(); refreshSoon(); return; }
  push({
    title: 'Clients', back: 'Work', dock: true, cls: 'cl-home',
    right: `<button class="gbtn chrome icon" data-act="cl-search" aria-label="Search clients and leads">${I.search}</button>
            <button class="gbtn chrome icon accent" style="--c:var(--clients-fill)" data-act="cl-new-lead" aria-label="New lead">${I.plus}</button>`,
    render(sc) { sc.id = 'clScroll'; draw({ enter: true }); },
  });
  refreshSoon();
}
// opening reads the PC again unless it was read a moment ago (the server keeps its own read for 60 s too)
function refreshSoon() { if (REAL && owner() && !NET.loading && clock.nowMs() - M.gotAt > 15000) load(); }
// the old tab id still answers (#clients, setTab('clients')): it opens Work, then Clients on top
const toWork = () => setTimeout(() => { if (currentTab() !== 'jobs') setTab('jobs'); openClients(); }, 0);
registerTab('clients', { title: 'Clients', render(page) { page.innerHTML = ''; toWork(); }, onShow() { toWork(); } });
provide('openClients', openClients);
provide('openClient', (slug) => openClient(slug));
provide('openLead', (slug) => openLead(slug));
provide('clientsSummary', clientsSummary);
on('w-clients', () => openClients());
registerRoute('lead', (L, ctx) => { if (!L.sub) return false; ctx.base(); ctx.after(() => openLead(L.sub)); }, { owner: true });

function sumline() {
  const free = M.clients.filter((c) => c.free).length, paying = M.clients.length - free;
  const n = (k, one, many = `${one}s`) => `<b class="num">${k}</b> ${k === 1 ? one : many}`;
  return `${n(paying, 'client')}${free ? ` · ${n(free, 'free build')}` : ''} · ${n(M.leads.length, 'lead')} · <b class="num">${owing().length}</b> owe you`;
}
const skeleton = () => `<div class="phead"><h1 class="lt">Clients</h1><p class="sub cl-sumline"><span class="mx-shimmer cl-sk-line"></span></p></div>
  <section class="cl-sum surface cl-skel" aria-busy="true" aria-label="Reading your clients from your PC">
    <div class="cl-sum-main"><span class="mx-shimmer cl-sk-ring"></span><span class="cl-sk-stats"><i class="mx-shimmer"></i><i class="mx-shimmer"></i><i class="mx-shimmer"></i></span></div>
    <span class="mx-shimmer cl-sk-bar"></span>
  </section>
  <div class="cl-list">${'<div class="cl-card surface cl-skel" aria-hidden="true"><span class="cl-head"><span class="mx-shimmer cl-sk-mono"></span><span class="cl-sk-stats"><i class="mx-shimmer"></i><i class="mx-shimmer"></i></span></span><span class="mx-shimmer cl-sk-next"></span></div>'.repeat(3)}</div>`;
const unreachable = () => `<div class="phead"><h1 class="lt">Clients</h1></div>
  <div class="note cl-empty" role="alert"><b>${esc(NET.error?.message || 'Your PC isn’t reachable right now')}</b>Clients are read from studio-os and studio-brain on your PC. This phone has no copy yet.
    <button class="btn sm cl-retry" data-act="cl-retry">Try again</button></div>`;
const memberNote = () => `<div class="phead"><h1 class="lt">Clients</h1></div><div class="note cl-empty"><b>Clients live on the owner’s PC</b>They come from studio-brain and studio-os, which only the owner’s account reads.</div>`;

function draw({ enter = false } = {}) {
  const sc = $('#clScroll'); if (!sc) return;
  const y = sc.scrollTop;
  if (!owner()) { sc.innerHTML = memberNote(); return; }
  if (!M.ready) { sc.innerHTML = NET.error && !NET.loading ? unreachable() : skeleton(); return; }
  sc.innerHTML = `
    <div class="phead">
      <h1 class="lt">Clients</h1>
      <p class="sub cl-sumline">${sumline()}</p>
    </div>
    ${REAL ? `<div class="cl-stalebox">${staleLine()}</div>` : ''}
    ${summary({ enter })}
    <div class="pad cl-seg">${seg('cl-view', [['clients', 'Clients', M.clients.length], ['leads', 'Leads', M.leads.length], ['pipeline', 'Pipeline']], S.view)}</div>
    <div id="clPanel" class="panel"></div>`;
  wireSegs(sc);
  $('[data-seg="cl-view"]', sc).addEventListener('change', (e) => { S.prev = S.view; S.view = e.detail; if (REAL) ls.set(K.view, S.view); panel(true); });
  panel();
  sc.scrollTop = y;
  if (enter) enterHome(sc);
}
// the opening: the outstanding money rolls up from zero while the ring draws, the health bar fills from the left and
// the cards rise one after another. Each says what it is about: how much, who is healthy, who is next
function enterHome(sc) {
  const r = $('.cl-sum-big .mx-roll', sc);
  if (r && r.dataset.to != null) setTimeout(() => roll(r, +r.dataset.to, ROLL), reduced() ? 0 : 200);
  growBar($('.cl-hbar', sc), 260);
  enterPanel($('#clPanel', sc), 0, 140);
}
function growBar(bar, delay = 0) {
  if (!bar || reduced()) return;
  const sp = springOf('gentle');
  $$('i:not([hidden])', bar).forEach((seg, k) => seg.animate([{ transform: 'scaleX(0)' }, { transform: 'none' }], { ...sp, delay: delay + k * 110, fill: 'backwards' }));
}
// a view arriving: its blocks come in one after another, from the side you moved toward (or up, when nothing moved)
function enterPanel(p, dir = 0, delay = 0) {
  if (!p) return;
  const items = $$(':scope > .cl-list > *, :scope > .cl-pipe > *, :scope > :not(.cl-list):not(.cl-pipe)', p);
  stagger(items, { x: dir * 22, y: dir ? 0 : 14, each: 40, max: 320, delay });
  // on the pipeline the people sit down on their stage, top to bottom
  if (!reduced()) $$('.clp-st.has .clp-node', p).forEach((node, i) => node.animate([{ transform: 'scale(.2)' }, { transform: 'none' }], { ...springOf('land'), delay: delay + 140 + i * 70, fill: 'backwards' }));
}

// the summary has a job: how much of what you billed has come in, and who is healthy
const H = ['green', 'yellow', 'red'];
function healthCounts() { const hc = { green: 0, yellow: 0, red: 0 }; M.clients.forEach((c) => { hc[c.health] = (hc[c.health] ?? 0) + 1; }); return hc; }
const paidLine = (m) => `<b class="num">${inr(m.paid)}</b> paid${m.unpriced ? ` · ${m.unpriced} price not set` : ''}`;
const ringLabel = (m, pct) => `${pct}% of what you billed has come in: ${inr(m.paid)} of ${m.approx ? 'about ' : ''}${inr(m.billed)}`;
function summary({ enter = false } = {}) {
  const m = money();
  const share = m.billed ? m.paid / m.billed : 0;
  const pct = Math.round(share * 100);
  const hc = healthCounts();
  const from0 = enter && !reduced();
  return `<section class="cl-sum surface" aria-label="Money and client health">
    <div class="cl-sum-main">
      ${ring(share, 'clients', 92, 11, { inner: `<span class="cl-sum-in"><b class="met"><span data-count="${pct}" data-fmt="pct">${pct}</span><small>%</small></b><small>collected</small></span>`, label: ringLabel(m, pct) })}
      <div class="cl-sum-stats">
        <span class="cl-sum-l">Outstanding</span>
        <b class="met cl-sum-big c-clients"><span class="cl-approx">${m.approx ? '≈ ' : ''}</span>${rollHTML(m.due, from0 ? { ...ROLL, format: zeros } : ROLL).replace('class="mx-roll"', `class="mx-roll" data-to="${m.due}"`)}</b>
        <span class="cl-sum-s">${paidLine(m)}</span>
      </div>
    </div>
    <div class="cl-health">
      <span class="cl-hbar" aria-hidden="true">${H.map((h) => `<i data-h="${h}" style="flex-grow:${hc[h]};background:${HC[h]}"${hc[h] ? '' : ' hidden'}></i>`).join('')}</span>
      <span class="cl-hkey" role="list" aria-label="Client health">${H.map((h) => `<span class="cl-h${hc[h] ? '' : ' zero'}" data-h="${h}" role="listitem"><i class="dot" style="--c:${HC[h]}"></i><b class="met">${rollHTML(hc[h], { format: 'int' })}</b>${HEALTH[h]}</span>`).join('')}</span>
    </div>
  </section>`;
}
// a read that changed the figures moves them: the ring to its new share, the money and the counts roll, the bar slides
function updateSummary(sc) {
  const m = money(), share = m.billed ? m.paid / m.billed : 0, pct = Math.round(share * 100), hc = healthCounts();
  const rg = $('.cl-sum .rg', sc);
  if (rg) { setRing(rg, share); rg.setAttribute('aria-label', ringLabel(m, pct)); }
  const p = $('.cl-sum-in [data-count]', sc); if (p) { p.dataset.count = String(pct); p.textContent = String(pct); }
  const ap = $('.cl-approx', sc); if (ap) ap.textContent = m.approx ? '≈ ' : '';
  roll($('.cl-sum-big .mx-roll', sc), m.due, ROLL);
  const s = $('.cl-sum-s', sc); if (s) s.innerHTML = paidLine(m);
  H.forEach((h) => {
    const i = $(`.cl-hbar i[data-h="${h}"]`, sc); if (i) { i.hidden = !hc[h]; i.style.flexGrow = String(hc[h]); }
    const k = $(`.cl-h[data-h="${h}"]`, sc); if (k) { k.classList.toggle('zero', !hc[h]); roll($('.mx-roll', k), hc[h], { format: 'int' }); }
  });
}
function refreshHome(why) {
  const sc = $('#clScroll'); if (!sc) return;
  const drawn = !!$('.cl-sum:not(.cl-skel)', sc);
  if (!drawn || !M.ready) { draw({ enter: M.ready }); if (M.ready) pulse(sc); return; }
  if (why !== 'data') return;
  $('.cl-sumline', sc).innerHTML = sumline();
  updateSummary(sc);
  [[0, M.clients.length], [1, M.leads.length]].forEach(([i, v]) => { const b = $$('[data-seg="cl-view"] button', sc)[i]; const nEl = b && $('.n', b); if (nEl) nEl.textContent = String(v); });
  swapPanel($('#clPanel', sc), panelHtml());
}
const panelHtml = () => (S.view === 'clients' ? clientsView() : S.view === 'leads' ? leadsView() : pipelineView());
function panel(anim) {
  const p = $('#clPanel'); if (!p) return;
  p.innerHTML = panelHtml();
  if (anim) enterPanel(p, Math.sign(VIEWS.indexOf(S.view) - VIEWS.indexOf(S.prev)));
}
// the same view drawn again from new data: the cards that stay slide to their new places, new ones come in, gone ones
// fade; what sits around the list is replaced as it is
function swapPanel(p, html) {
  if (!p) return;
  const t = document.createElement('template'); t.innerHTML = html;
  const kids = [...t.content.children];
  const nl = kids.find((el) => el.classList.contains('cl-list'));
  const ol = [...p.children].find((el) => el.classList.contains('cl-list'));
  if (!nl || !ol) { p.replaceChildren(...kids); return; }
  flipList(ol, () => ol.replaceChildren(...nl.children), { key: (el) => el.dataset.id || null, stagger: 30 });
  [...p.children].forEach((el) => { if (el !== ol) el.remove(); });
  const at = kids.indexOf(nl);
  kids.slice(0, at).forEach((el) => p.insertBefore(el, ol));
  kids.slice(at + 1).forEach((el) => p.appendChild(el));
}

// ── Clients ───────────────────────────────────────────────────────────
// money on the right of the name: the figure and what it is. A price that is not set, or free work, says so in words
function amount(c) {
  if (c.money.state === 'due') {
    return /\d/.test(c.money.outstanding) && !/^₹?\s?0$/.test(c.money.outstanding.trim())
      ? `<span class="cl-amt"><b class="met">${esc(c.money.outstanding)}</b><small>due</small></span>`
      : `<span class="cl-amt is-text">${esc(/\d/.test(c.money.outstanding) ? 'Due' : c.money.outstanding)}</span>`;
  }
  return c.free ? '<span class="cl-amt is-text">Free</span>' : '';
}
// what a screen reader hears for a card: who, how it stands, the money and the next step
function saidClient(c) {
  const due = c.money.state === 'due' ? (/\d/.test(c.money.outstanding) ? `${c.money.outstanding} due` : c.money.outstanding) : c.free ? 'Free' : '';
  return [c.name, isPinned(c) ? 'Pinned' : '', HEALTH[c.health], stageText(c), c.product, due, `Next: ${c.next.text}, ${c.next.due}`].filter(Boolean).join('. ');
}
function clientCard(c) {
  const flags = [
    c.health !== 'green' ? `<span class="cl-hw" style="--c:${HC[c.health]}">${HEALTH[c.health]}</span>` : '',
    c.kind === 'own' && c.ownerNote ? `<span>${esc(c.ownerNote)}, own business</span>` : '',
    osPath(c) ? '' : '<span class="cl-noos">No OS folder</span>',
  ].filter(Boolean);
  return `<button class="cl-card surface" data-act="client-open" data-id="${esc(c.slug)}" aria-label="${esc(saidClient(c))}">
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
const osPath = (c) => c.osFolder ?? (S.made.has(c.slug) ? `studio-os\\clients\\${c.slug}` : null);
const missingOs = () => M.issues.filter((x) => x.kind === 'missing-os-folder').flatMap((x) => x.slugs ?? []).filter((s) => { const c = clientOf(s); return c && !osPath(c); });
// what the sync found. Demo: the one issue, a tap from fixed. Real: each problem says what is wrong, for whom, and the
// one move that fixes it (a job), in one card
const HARD = ['no-brain', 'no-os', 'read-failed', 'unreadable'];
const ISSUE_ICON = { 'missing-os-folder': 'folderPlus', 'template-unfilled': 'doc', 'ledger-behind': 'clock', 'stage-mismatch': 'flag', 'lead-not-on-board': 'people', 'not-on-board': 'flag', 'missing-brain-folder': 'folderPlus' };
const issueList = () => M.issues.filter((i) => !HARD.includes(i.kind));
const nameOf = (s) => clientsOf(s)?.name ?? s;
function issueFix(i) {
  if (i.kind === 'missing-os-folder') return { label: 'Create from template', title: `OS folder for ${i.slugs.map(nameOf).join(' and ')}`, prompt: `Create ${i.slugs.map((s) => `clients\\${s}`).join(' and ')} in studio-os from _templates\\client\\ (OS.md §5), filled from each client's studio-brain dossier and work log. Write unknown (ask) for anything the brain doesn't say. Mirror any stage you set to the brain's clients\\_pipeline.md.`, folders: [M.os, ...i.slugs.map((s) => clientOf(s)?.brainPath)].filter(Boolean), slug: i.slugs.length === 1 ? i.slugs[0] : null };
  const c = clientOf(i.slugs?.[0]);
  if (!c) return null;
  if (i.kind === 'template-unfilled') return { label: 'Fill them', title: `Fill the OS files for ${c.name}`, prompt: `Fill ${(i.files ?? []).map((f) => f.split('\\').pop()).join(' and ')} for ${c.name} from its studio-brain dossier and work log. Keep every {placeholder} you can't answer as unknown (ask). Money only from studio-brain/money/pricing.md.`, folders: placesOf(c), slug: c.slug };
  if (i.kind === 'ledger-behind') return { label: 'Update it', title: `Bring ${c.name}'s payments.md up to date`, prompt: `Bring payments.md for ${c.name} up to date with the brain: the work log records a payment after the ledger's last balance. Append rows (it is append-only), recompute Outstanding, and note the source of each figure.`, folders: placesOf(c), slug: c.slug };
  return null;
}
function issueBlock() {
  if (!REAL) {
    const miss = missingOs();
    if (!miss.length) return '';
    const issue = M.issues.find((x) => x.kind === 'missing-os-folder');
    return `<div class="cl-issue surface" role="status">
      <span class="tile cl-issue-i" aria-hidden="true">${I.folderPlus}</span>
      <span class="cl-issue-b"><b>${miss.length} client${miss.length === 1 ? ' has' : 's have'} no OS folder yet</b><small>${miss.map((s) => esc(nameOf(s))).join(', ')}</small></span>
      <button class="btn sm" data-act="cl-make-os">${esc(issue.action)}</button>
    </div>`;
  }
  const list = issueList();
  if (!list.length) return '';
  return `<div class="cl-issues surface" role="status" aria-label="What the sync found">${list.map((i, k) => {
    const fix = issueFix(i);
    // "Glowbox: contract.md is still the blank template" reads as the problem, with whose it is under it
    const title = i.kind === 'missing-os-folder' ? i.text : i.text.replace(/^[^:]+:\s*/, '');
    const sub = (i.slugs ?? []).map(nameOf).join(', ') || (i.files ?? []).join(', ');
    return `<div class="cl-issue"><span class="tile cl-issue-i" aria-hidden="true">${I[ISSUE_ICON[i.kind] ?? 'flag']}</span>
      <span class="cl-issue-b"><b>${esc(/^\S+\.\w+\b/.test(title) ? title : cap(title))}</b>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      ${fix ? `<button class="btn sm" data-act="cl-issue" data-i="${k}">${esc(fix.label)}</button>` : ''}</div>`;
  }).join('')}</div>`;
}
// the files could not be read at all: said above everything, since every figure is then the snapshot's
const hardIssues = () => (REAL ? M.issues.filter((i) => HARD.includes(i.kind)) : []);
const hardBlock = () => (hardIssues().length ? `<div class="note cl-hard" role="status">${hardIssues().map((i) => `<p>${esc(i.text)}</p>`).join('')}</div>` : '');
function retiredBlock() {
  if (!M.retired.length) return '';
  return `<div class="group cl-retired">
    <button class="row" data-act="cl-retired" aria-expanded="${S.retired}"><span class="rbody"><span class="rtitle">Retired</span></span><span class="rend"><span class="met">${M.retired.length}</span><span class="cl-fold">${S.retired ? I.chevU : I.chevD}</span></span></button>
    ${S.retired ? M.retired.map((r) => `<div class="row"><span class="rbody"><span class="rtitle">${esc(r.name)}</span><span class="rmeta">${esc(r.note)}</span></span></div>`).join('') : ''}
  </div>`;
}
// the pages clients see live here, under Clients (the client window)
const windowsRow = () => (REAL ? `<div class="group cl-windows"><button class="row ic" data-act="cl-windows"><span class="tile">${I.window}</span><span class="rbody"><span class="rtitle">Client pages</span><span class="rmeta"><span class="ell">Links you send clients, and their answers</span></span></span>${I.chevR}</button></div>` : '');
const clientsView = () => `${hardBlock()}${M.clients.length
  ? `<div class="cl-list">${[...M.clients].sort((a, b) => dueRank(a.next.due) - dueRank(b.next.due)).map(clientCard).join('')}</div>`
  : '<div class="note cl-empty"><b>No clients on the board</b>studio-brain\\clients\\_pipeline.md lists none yet.</div>'}${issueBlock()}${retiredBlock()}${windowsRow()}${syncLine()}`;

// ── Leads ─────────────────────────────────────────────────────────────
function leadCard(l) {
  const t = S.touch[l.slug] ?? l.nextTouch.text;
  const set = S.touch[l.slug] ? true : l.nextTouch.set;
  return `<button class="cl-card surface" data-act="lead-open" data-id="${esc(l.slug)}" aria-label="${esc(`${l.name}. Lead, ${l.stage}, warmth ${l.warmth === 'unknown' ? 'not set' : l.warmth}. Next touch: ${t}`)}">
    <span class="cl-head">
      ${mono(l)}
      <span class="cl-id">
        <span class="cl-l1"><b class="cl-name">${esc(l.name)}</b><span class="cl-amt is-warm">${warmth(l.warmth)}</span></span>
        <span class="cl-l2"><span class="cl-stage">${esc(l.stage)}</span><span class="cl-prod">${l.since ? `Lead since ${esc(l.since)}` : 'Lead'}</span></span>
        <span class="cl-l3"><span>Pitch ${esc(l.pitch.toLowerCase())}</span><span class="cl-sep" aria-hidden="true">·</span><span>Potential ${esc(l.potential.toLowerCase())}</span>${l.onBoard ? '' : '<span class="cl-sep" aria-hidden="true">·</span><span>Not on the board</span>'}</span>
      </span>
    </span>
    ${nextLine(I.clock, 'Next touch', t, set ? dueTone(t) : 'late')}
  </button>`;
}
const leadsView = () => `${M.leads.length ? `<div class="cl-list">${M.leads.map(leadCard).join('')}</div>`
  : '<div class="note cl-empty"><b>No leads yet</b>File the first one from what you know.</div>'}
  <div class="group cl-addlead"><button class="row ic" data-act="cl-new-lead"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">New lead</span><span class="rmeta">Paste or ${REAL ? 'type' : 'speak'} what you know</span></span>${I.chevR}</button></div>
  ${syncLine('studio-os\\sales')}`;

// ── Pipeline: one path from a first contact to an active client. Each stage is a node on the rail, the people in
//    it sit under it; an empty stage is one quiet line. Leads cross to clients where Convert to client moves them ──
function stage(st, items) {
  const xs = items.filter((x) => x.stage === st);
  const meta = (x) => (x.kind === 'lead' ? (x.warmth === 'unknown' ? 'warmth not set' : x.warmth) : x.free ? `free${x.stageNote ? ` ${x.stageNote}` : ''}` : x.stageNote);
  return `<li class="clp-st${xs.length ? ' has' : ''}">
    <span class="clp-node" aria-hidden="true"></span>
    <span class="clp-h"><b>${esc(cap(st))}</b><span class="met">${xs.length}</span></span>
    ${xs.length ? `<span class="clp-items">${xs.map((x) => `<button class="clp-item" data-act="${x.kind === 'lead' ? 'lead-open' : 'client-open'}" data-id="${esc(x.slug)}">${mono(x, 'sm')}<span class="clp-t">${esc(x.name)}</span>${meta(x) ? `<span class="clp-m">${esc(meta(x))}</span>` : ''}${I.chevR}</button>`).join('')}</span>` : ''}
  </li>`;
}
function part(title, stages, items, extra = []) {
  const off = [...offPath(stages).map((st) => [cap(st), items.filter((x) => x.stage === st).length]), ...extra];
  // someone on a stage the cards don't list still shows, on a node of its own
  const odd = [...new Set(items.filter((x) => !stages.includes(x.stage)).map((x) => x.stage))];
  return `<section class="clp-card surface" aria-label="${esc(title)}">
    <h2 class="clp-hd">${esc(title)}</h2>
    <ol class="clp-path">${[...onPath(stages), ...odd].map((st) => stage(st, items)).join('')}</ol>
    <p class="clp-off"><span class="clp-off-l">Off the path</span>${off.map(([k, v]) => `<span class="${v ? 'has' : ''}">${esc(k)} <b class="met">${v}</b></span>`).join('')}</p>
  </section>`;
}
const pipelineView = () => `<div class="cl-pipe">${part('Leads', M.stages.lead, M.leads)}
  <p class="clp-conv"><span>Convert to client moves a lead into ${esc(M.stages.client[0] ?? 'onboarding')}</span></p>
  ${part('Clients', M.stages.client, M.clients, [['Retired', M.retired.length]])}</div>${syncLine()}`;

// ── client page ───────────────────────────────────────────────────────
export function openClient(slug) {
  if (!slug) return;
  const c = clientOf(slug);
  // a link can open a client before the first read lands; the page fills in when it does
  if (!c && (M.ready && !NET.loading || !REAL)) { toast('That client isn’t on the board'); return; }
  push({
    title: c?.name ?? 'Client', back: backLabel(),
    right: c ? pinBtn(c) : '',
    render(sc, page) { page.classList.add('cl-page'); page.dataset.slug = slug; drawClientPage(page, { enter: true }); },
  });
  if (REAL) { loadClient(slug); loadWin(); if (!M.ready || clock.nowMs() - M.gotAt > 15000) load(); }
}
// Back names the page underneath (Clients, a project, another client), else the tab
const backLabel = () => $('#stack')?.lastElementChild?._opts?.title || undefined;
const pinBtn = (c) => `<button class="gbtn chrome icon cl-pin${isPinned(c) ? ' on' : ''}" data-act="cl-pin" data-id="${esc(c.slug)}" aria-pressed="${isPinned(c)}" aria-label="${isPinned(c) ? 'Unpin' : 'Pin'} ${esc(c.name)}">${isPinned(c) ? I.pinF : I.pin}</button>`;
const doneKey = (c, t) => `${c.slug}:${t}`;
const youOpen = (c) => c.waitingOn.you.filter((x) => !S.done.has(doneKey(c, x.text))).length;
const waitCount = (c) => c.waitingOn.them.length + youOpen(c);
const coreSig = (c) => JSON.stringify({ ...c, log: 0, logCount: 0, files: 0 });
const extraSig = (c) => JSON.stringify([c.log, c.logCount, c.files]);
const pageSkeleton = () => `<div class="cl-hero"><div class="cl-hero-id"><span class="mx-shimmer cl-sk-mono lg"></span><span class="cl-sk-stats"><i class="mx-shimmer"></i><i class="mx-shimmer"></i></span></div></div>
  <div class="cl-nextcard surface cl-skel" aria-busy="true" aria-label="Reading this client from your PC"><span class="cl-sk-stats"><i class="mx-shimmer"></i><i class="mx-shimmer"></i><i class="mx-shimmer"></i></span></div>`;
const gone = (what) => `<div class="note cl-empty"><b>${what === 'lead' ? 'This lead isn’t in studio-os\\sales any more' : 'This client isn’t on the board any more'}</b>${what === 'lead' ? 'It may have been converted or renamed.' : 'It may have been renamed or retired in studio-brain.'}</div>`;
function drawClientPage(page, { enter = false } = {}) {
  const c = clientOf(page.dataset.slug);
  const sc = $('.scroll', page); if (!sc) return;
  const y = sc.scrollTop;
  page._core = c ? coreSig(c) : null; page._extra = c ? extraSig(c) : null;
  sc.innerHTML = c ? clientHtml(c) : M.ready && !NET.loading ? gone('client') : pageSkeleton();
  sc.scrollTop = y;
  if (c) {
    const t = $('.tb-title', page); if (t && t.textContent !== c.name) t.textContent = c.name;
    const r = $('.tb-right', page); if (r && !$('.cl-pin', r)) r.innerHTML = pinBtn(c);
  }
  if (enter && c) enterPage(sc);
}
// a page opening: its blocks rise in turn under the money ring's draw (core's pulse)
function enterPage(sc) { stagger($$(':scope > *', sc).slice(0, 9), { y: 12, each: 36, max: 300, delay: 120 }); }
function refreshClientPage(page) {
  const c = clientOf(page.dataset.slug);
  if (!c || !page._core || coreSig(c) !== page._core) { const was = !!page._core; drawClientPage(page, { enter: !was }); if (!was && c) pulse(page); return; }
  if (extraSig(c) === page._extra) return;
  // only the whole work log and the files came in: those parts are drawn again, the rest stays put
  page._extra = extraSig(c);
  const slug = page.dataset.slug;
  refreshPart(slug, '.cl-log', logHtml(c));
  refreshPart(slug, '.cl-logn', String(logTotal(c) || ''));
  const fw = $('.cl-filewrap', page);
  if (fw) { const had = $$('.cl-f', fw).length; fw.innerHTML = filesHtml(c); if (!had) stagger($$('.cl-f', fw), { y: 6, each: 24, max: 240 }); }
}
const refreshPart = (slug, sel, html) => $$(`.cl-page[data-slug="${CSS.escape(slug)}"] ${sel}`).forEach((g) => { g.innerHTML = html; });

function clientHtml(c) {
  const projects = c.projects.map((p) => project(p)).filter(Boolean);
  return `${REAL ? `<div class="cl-stalebox">${staleLine()}</div>` : ''}
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
    <button class="btn primary block" style="--c:var(--clients-fill)" data-act="cl-job" data-id="${esc(c.slug)}">${I.claude}Start a job for this client</button>
    <div class="cl-nc-acts">
      <button class="btn" data-act="cl-flows" data-id="${esc(c.slug)}">${I.flow}Run a workflow</button>
      <button class="btn" data-act="cl-log" data-id="${esc(c.slug)}">${I.edit}Log work</button>
    </div>
  </section>

  ${projects.length ? `<div class="sh"><h2>Project in Jobs</h2></div>
  <div class="group">${projects.map((pj) => `<button class="row ic cl-proj" data-act="cl-project" data-id="${esc(pj.slug)}" data-back="${esc(c.name)}"><span class="tile">${String(pj.icon ?? '').length > 1 ? pj.icon : `<b>${esc(pj.icon ?? pj.name.charAt(0))}</b>`}</span><span class="rbody"><span class="rtitle">${esc(pj.name)}</span>${pj.desc ? `<span class="rmeta"><span class="ell">${esc(pj.desc)}</span></span>` : ''}</span>${I.chevR}</button>`).join('')}</div>` : ''}

  ${REAL ? `<div class="cl-winbox" data-slug="${esc(c.slug)}">${winHtml(c)}</div>` : ''}

  <div class="sh"><h2>Waiting on</h2><span class="sh-count cl-waitn">${waitCount(c) || ''}</span></div>
  <div class="group cl-wait">${waitHtml(c)}</div>

  <div class="sh"><h2>Money</h2></div>
  ${moneyCard(c)}

  <div class="sh"><h2>Workflows</h2><span class="sh-count cl-flown">${c.workflows.length || ''}</span><button class="sh-act" data-act="cl-flows" data-id="${esc(c.slug)}">Run one${I.chevR}</button></div>
  <div class="group cl-flowlist">${flowsHtml(c)}</div>

  <div class="sh"><h2>Key dates</h2>${count(c.keyDates.length)}</div>
  <div class="group cl-dates">${c.keyDates.length ? c.keyDates.map((d) => `<div class="row"><span class="rbody"><span class="rtitle wrap">${esc(d.what)}</span></span><span class="cl-due ${d.tone}">${esc(d.when)}</span></div>`).join('') : '<div class="row"><span class="cl-none">No dates yet</span></div>'}</div>

  <div class="sh"><h2>Work log</h2><span class="sh-count cl-logn">${logTotal(c) || ''}</span><button class="sh-act" data-act="cl-log" data-id="${esc(c.slug)}">Log${I.chevR}</button></div>
  <div class="group cl-log">${logHtml(c)}</div>

  <div class="sh"><h2>Contract</h2></div>
  <div class="group cl-kv">
    ${c.contract.note ? `<div class="row"><span class="rbody"><span class="rtitle wrap cl-cnote">${esc(c.contract.note)}</span></span></div>` : ''}
    <div class="row"><span class="cl-k">Term</span><span class="cl-v">${esc(c.contract.term || 'Not written down')}</span></div>
    <div class="row"><span class="cl-k">Deliverables</span><span class="cl-v">${c.contract.deliverables.length ? c.contract.deliverables.map(esc).join(', ') : 'Not written down'}</span></div>
    <div class="row"><span class="cl-k">Payment</span><span class="cl-v">${esc(c.contract.payment || 'Not written down')}</span></div>
    ${c.commercials.length ? `<div class="cl-wl"><span>Commercials, from the dossier</span></div>${c.commercials.map((x) => (x.label
      ? `<div class="row"><span class="cl-k">${esc(x.label)}</span><span class="cl-v">${esc(x.value)}</span></div>`
      : `<div class="row"><span class="rbody"><span class="rtitle wrap cl-cnote">${esc(x.value)}</span></span></div>`)).join('')}` : ''}
  </div>

  <div class="sh"><h2>Goals</h2>${count(c.goals.length)}</div>
  <div class="group cl-goals">${c.goals.length ? c.goals.map((g) => `<div class="row"><span class="rbody"><span class="rtitle wrap">${esc(g)}</span></span></div>`).join('') : '<div class="row"><span class="cl-none">None written down</span></div>'}</div>

  <div class="sh"><h2>Files</h2></div>
  <div class="cl-filewrap">${filesHtml(c)}</div>
  <p class="hint cl-hint">${REAL ? `Read from the files on your PC <span class="cl-fresh">${esc(freshText())}</span>. Edits happen there, or in a job.${snapList(c)}` : 'Read-only mirror. Edits happen in the files on your PC.'}</p>`;
}
// which parts of this page are the snapshot's (no file gives them yet), in one line
function snapList(c) {
  const parts = [['health', 'health'], ['workflows', 'workflows'], ['keyDates', 'key dates'], ['contract.term', 'contract'], ['goals', 'goals']].filter(([k]) => c.src?.[k] === 'snapshot').map(([, l]) => l);
  return parts.length ? ` Not in the files yet, so from the ${esc(day(M.snapshotAt))} snapshot: ${parts.join(', ')}.` : '';
}

// waiting on you comes first, a list you can tick off on this phone; waiting on them is a list
function waitHtml(c) {
  const wo = c.waitingOn;
  const none = '<div class="row cl-wr"><span class="cl-wd" aria-hidden="true"></span><span class="rbody"><span class="cl-none">Nothing</span></span></div>';
  // items from one NOW.md loop name the loop once, under the first of them
  const you = wo.you.map((x, i) => {
    const k = doneKey(c, x.text); const d = S.done.has(k);
    const detail = x.detail && x.detail !== wo.you[i - 1]?.detail ? x.detail : '';
    return `<div class="row cl-wr cl-wy${d ? ' is-done' : ''}"><button class="check${d ? ' done' : ''}" data-act="cl-wait" data-id="${esc(c.slug)}" data-k="${esc(k)}" aria-pressed="${d}" aria-label="${d ? 'Mark not done' : 'Mark done'}: ${esc(x.text)}">${I.check}</button><span class="rbody"><span class="rtitle wrap">${esc(x.text)}</span>${detail ? `<span class="rmeta"><span class="ell">${esc(detail)}</span></span>` : ''}</span></div>`;
  }).join('') || none;
  const them = wo.them.map((t) => `<div class="row cl-wr"><span class="cl-wd" aria-hidden="true"><i></i></span><span class="rbody"><span class="rtitle wrap">${esc(t)}</span></span></div>`).join('') || none;
  return `<div class="cl-wl"><span>You</span>${wo.you.length ? `<b class="met">${youOpen(c)}</b>` : ''}</div>${you}
    <div class="cl-wl"><span>Them</span>${count(wo.them.length, 'met')}</div>${them}`;
}
// the workflows this client is opted into, named in words, with their folder (or what they are at) and state
const FLOW_DOT = { running: 'var(--done)' };
const flowState = (st) => `<span class="cl-wfst${st === 'running' ? ' run' : ''}${st === 'done' ? ' done' : ''}">${st === 'done' ? I.check : `<i class="live" style="--c:${FLOW_DOT[st] ?? 'var(--warn)'}"></i>`}${esc(cap(st))}</span>`;
function flowsHtml(c) {
  if (!c.workflows.length) return '<div class="row"><span class="cl-none">No workflows yet</span></div>';
  return c.workflows.map((w) => `<div class="row cl-wf"><span class="rbody"><span class="rtitle${REAL ? ' wrap' : ''}">${esc(w.name)}</span><span class="rmeta">${w.folder ? `<span class="mono">${esc(w.folder)}/</span>` : `<span class="ell">${esc(w.detail || 'Opted in')}</span>`}</span></span>${flowState(w.status)}</div>`).join('');
}

const PAY = { paid: ['Paid', 'var(--done)'], due: ['Due', 'var(--needs)'], partial: ['Partial', 'var(--needs)'], none: ['No charge', ''] };
function moneyCard(c) {
  const m = money([c], { all: true });
  const inWords = !/\d/.test(c.money.outstanding);
  const share = m.billed ? m.paid / m.billed : 0;
  const top = m.billed
    ? `<div class="cl-m-top">${ring(share, 'clients', 64, 7, { inner: `<b class="met cl-m-pct">${Math.round(share * 100)}<small>%</small></b>`, label: `${Math.round(share * 100)}% of what you billed ${esc(c.name)} has come in` })}
        <div class="cl-m-stats"><span class="cl-m-l">Outstanding</span><b class="met cl-m-big c-clients">${esc(c.money.outstanding)}</b><span class="foot">${inr(m.paid)} paid of ${m.approx ? '≈ ' : ''}${inr(m.billed)} billed${c.money.asOf ? ` · as of ${esc(dayYear(c.money.asOf))}` : ''}</span></div></div>`
    // nothing billed in figures: the amount in words, and why, unless a payment row below already says it
    : `<div class="cl-m-top"><div class="cl-m-stats"><span class="cl-m-l">Outstanding</span><b class="${inWords ? 'cl-m-words' : 'met cl-m-big'}">${esc(c.money.outstanding)}</b>${c.money.rows.length ? '' : `<span class="foot">${esc(c.freeNote ?? 'Nothing billed yet')}</span>`}</div></div>`;
  const rows = c.money.rows.map((r) => { const st = PAY[r.status] ?? [cap(r.status), '']; return `<div class="cl-pay">
      <span class="cl-pay-b"><b>${esc(cap(r.what))}</b><small>${esc(dayYear(r.date))}${r.note ? ` · ${esc(r.note)}` : ''}</small></span>
      <span class="cl-pay-r"><b class="met">${esc(r.amount)}</b><span class="pill${st[1] ? '' : ' plain'}"${st[1] ? ` style="--c:${st[1]}"` : ''}>${esc(st[0])}</span></span>
    </div>`; }).join('');
  const behind = REAL ? M.issues.find((i) => i.kind === 'ledger-behind' && i.slugs?.includes(c.slug)) : null;
  const snap = REAL && c.src?.money === 'snapshot' ? `<p class="cl-src">No payments.md on your PC yet, so this is the ${esc(day(M.snapshotAt))} snapshot</p>` : '';
  return `<div class="cl-money surface">${top}${rows ? `<div class="cl-pays">${rows}</div>` : ''}${behind ? `<p class="cl-behind">${esc(cap(behind.text.replace(/^[^:]+:\s*/, '')))}</p>` : ''}${snap}</div>`;
}

const LOG_SHOWN = 6;
const logOf = (c) => [...(S.logs[c.slug] ?? []), ...outboxFor(c.slug), ...c.log];
// every entry: the file's count, and what this phone added on top (the demo's, and those waiting for the PC)
const logTotal = (c) => Math.max(c.logCount, c.log.length) + (logOf(c).length - c.log.length);
function logHtml(c) {
  const list = logOf(c);
  if (!list.length) return '<div class="row"><span class="cl-none">Nothing logged yet</span></div>';
  const all = S.logAll.has(c.slug) || list.length <= LOG_SHOWN + 1;
  const shown = all ? list : list.slice(0, LOG_SHOWN);
  const total = logTotal(c);
  return shown.map((e) => `<div class="row cl-le${e.fresh ? ' fresh' : ''}${e.waiting ? ' is-waiting' : ''}"><span class="cl-le-d num">${esc(day(e.date))}</span><span class="rbody"><span class="rtitle wrap">${esc(e.title)}</span>${e.body ? `<span class="cl-le-b">${esc(e.body)}</span>` : ''}${e.waiting ? '<span class="cl-le-w">On this phone. It goes to work-log.md when your PC answers</span>' : ''}</span></div>`).join('')
    + (all ? '' : `<button class="row cl-more" data-act="cl-more-log" data-id="${esc(c.slug)}"><span class="rbody"><span class="rtitle">Show all ${total}</span></span>${I.chevD}</button>`);
}

const OS_FILES = ['index.md', 'payments.md', 'contract.md', 'goals.md', 'brand.md', 'raw/'];
const BRAIN_FILES = ['dossier.md', 'work-log.md', 'results.md'];
// a tap copies the full path, ready to paste into a job (demo: what it would open)
const fileRow = (path, f) => `<button class="row cl-f" data-act="cl-file" data-f="${esc(f)}"${path ? ` data-path="${esc(`${path}\\${f.replace(/\/$/, '')}`)}" aria-label="Copy the path of ${esc(f)}"` : ''}><span class="cl-f-i">${f.endsWith('/') ? I.folder : I.doc}</span><span class="rbody"><span class="rtitle mono">${esc(f)}</span></span>${path ? I.copy : I.chevR}</button>`;
const folderRow = (title, rel, abs, icon = I.folder) => (abs
  ? `<button class="row ic cl-froot" data-act="cl-file" data-f="${esc(rel)}" data-path="${esc(abs)}" aria-label="Copy the path of the ${esc(title)}"><span class="tile">${icon}</span><span class="rbody"><span class="rtitle">${title}</span><span class="rmeta"><span class="mono ell">${esc(rel)}</span></span></span>${I.copy}</button>`
  : `<div class="row ic cl-froot"><span class="tile">${icon}</span><span class="rbody"><span class="rtitle">${title}</span><span class="rmeta"><span class="mono ell">${esc(rel)}</span></span></span></div>`);
function filesHtml(c) {
  const os = osPath(c);
  const flows = c.workflows.map((w) => w.folder).filter(Boolean).map((n) => `${n}/`);
  const osFiles = REAL ? c.files?.os ?? [] : [...OS_FILES, ...flows];
  const brainFiles = REAL ? c.files?.brain ?? [] : BRAIN_FILES;
  return `<div class="group cl-files">
    ${os ? `${folderRow('OS folder', os, c.osPath)}${osFiles.map((f) => fileRow(c.osPath, f)).join('')}`
    : `<div class="row ic cl-froot cl-nofolder"><span class="tile">${I.folderPlus}</span><span class="rbody"><span class="rtitle">No OS folder yet</span><span class="rmeta">Payments, contract and goals live there</span></span><button class="btn sm" data-act="cl-make-os" data-id="${esc(c.slug)}">Create</button></div>`}
  </div>
  ${c.brainFolder ? `<div class="group cl-files">${folderRow('Brain folder', c.brainFolder, c.brainPath)}${brainFiles.map((f) => fileRow(c.brainPath, f)).join('')}</div>` : ''}`;
}

// ── their page: the client window (real mode) ─────────────────────────
const pageUrl = (link) => (link ? (/^https?:/.test(location.origin) ? `${location.origin}${link.path}` : link.url) : null);
function winHtml(c) {
  const W = NET.win;
  const w = W?.clients.find((x) => x.slug === c.slug) ?? null;
  const decs = (W?.decisions ?? []).filter((d) => d.client === c.slug);
  const open = decs.filter((d) => d.status === 'open');
  const answered = decs.filter((d) => d.status === 'answered').slice(0, 3);
  const asks = (W?.questions ?? []).filter((q) => q.client === c.slug);
  const id = `data-id="${esc(c.slug)}"`;
  let link;
  if (!W) link = NET.winError ? `<div class="row ic"><span class="tile">${I.window}</span><span class="rbody"><span class="rtitle">Their page isn’t readable now</span><span class="rmeta"><span class="ell">${esc(NET.winError.offline ? 'Your PC isn’t reachable' : NET.winError.message)}</span></span></span></div>`
    : `<div class="row ic" aria-busy="true"><span class="tile">${I.window}</span><span class="rbody"><span class="mx-shimmer cl-sk-line"></span></span></div>`;
  else if (!w) link = `<div class="row ic cl-win-row"><span class="tile">${I.window}</span><span class="rbody"><span class="rtitle">No page for them yet</span><span class="rmeta cl-wrapm">A private link: what shipped, what is next, and questions for them</span></span><button class="btn sm" data-act="cl-win-link" ${id}>Make one</button></div>`;
  else if (!w.active) link = `<div class="row ic cl-win-row"><span class="tile">${I.window}</span><span class="rbody"><span class="rtitle">Their page is switched off</span><span class="rmeta cl-wrapm">Inactive in the client window. Turn it on from the PC to make a link</span></span></div>`;
  else if (!w.link) link = `<div class="row ic cl-win-row"><span class="tile">${I.window}</span><span class="rbody"><span class="rtitle">No link yet</span><span class="rmeta cl-wrapm">${esc([w.projects.length ? `Shows ${w.projects.join(', ')}` : 'No projects on it', w.openDecisions ? `${w.openDecisions} waiting` : ''].filter(Boolean).join(' · '))}</span></span><button class="btn sm" data-act="cl-win-link" ${id}>Make a link</button></div>`;
  else {
    const seen = w.link.lastSeen ? `Opened ${agoText(Date.parse(w.link.lastSeen))}` : 'Not opened yet';
    link = `<div class="row ic cl-win-row"><span class="tile cl-win-live">${I.window}</span><span class="rbody"><span class="rtitle">Their link is live</span><span class="rmeta"><span class="ell">${esc([seen, w.viewsThisWeek ? `${plural(w.viewsThisWeek, 'view')} this week` : ''].filter(Boolean).join(' · '))}</span></span></span><button class="gbtn icon cl-win-copy" data-act="cl-win-copy" ${id} aria-label="Copy ${esc(c.name)}’s link">${I.copy}</button></div>
      <div class="cl-win-acts"><button class="btn sm" data-act="cl-win-preview" ${id}>${I.eye}Preview</button><button class="btn sm" data-act="cl-win-revoke" ${id}>Revoke</button></div>`;
  }
  const decRow = (d) => `<div class="row cl-dec"><span class="cl-dec-i${d.status === 'open' ? ' open' : ''}" aria-hidden="true">${d.status === 'open' ? '?' : I.check}</span><span class="rbody"><span class="rtitle wrap">${esc(d.question)}</span><span class="rmeta"><span class="ell">${esc(d.status === 'open'
    ? [`Asked ${day(clock.dateOfIso(d.createdAt))}`, d.options?.length ? d.options.join(' / ') : 'A free answer'].join(' · ')
    : `${c.name}: ${d.answer} · ${day(clock.dateOfIso(d.answeredAt))}`)}</span></span></span></div>`;
  const askRow = (q) => `<div class="row cl-dec"><span class="cl-dec-i ai" aria-hidden="true">${I.claude}</span><span class="rbody"><span class="rtitle wrap">${esc(q.question)}</span><span class="rmeta"><span class="ell">Claude, on ${esc(q.title)}</span></span></span>${q.marked ? '<span class="pill plain">On their page</span>' : `<button class="btn sm" data-act="cl-win-q" data-task="${esc(q.task)}" ${id}>Ask them</button>`}</div>`;
  return `<div class="sh"><h2>Their page</h2>${count(open.length)}</div>
  <div class="group cl-win">${link}${open.map(decRow).join('')}${asks.map(askRow).join('')}${answered.map(decRow).join('')}
    ${w?.active ? `<button class="row ic" data-act="cl-win-ask" ${id}><span class="tile">${I.chat}</span><span class="rbody"><span class="rtitle">Ask them something</span><span class="rmeta"><span class="ell">It shows on their page; the answer comes back here</span></span></span>${I.chevR}</button>` : ''}</div>`;
}
function refreshWin() {
  $$('.cl-winbox').forEach((box) => { const c = clientOf(box.dataset.slug); if (c) box.innerHTML = winHtml(c); });
  const b = $('.cl-wins-sheet .sheet-body'); if (b?._draw) b._draw();
}

// ── lead page ─────────────────────────────────────────────────────────
export function openLead(slug) {
  if (!slug) return;
  const l = leadOf(slug);
  if (!l && (M.ready && !NET.loading || !REAL)) { toast('That lead isn’t in studio-os\\sales'); return; }
  push({ title: l?.name ?? 'Lead', back: backLabel(), render(sc, page) { page.classList.add('cl-page', 'lead-page'); page.dataset.lead = slug; drawLeadPage(page, { enter: true }); } });
  if (REAL) { loadLead(slug); if (!M.ready || clock.nowMs() - M.gotAt > 15000) load(); }
}
function drawLeadPage(page, { enter = false } = {}) {
  const l = leadOf(page.dataset.lead);
  const sc = $('.scroll', page); if (!sc) return;
  const y = sc.scrollTop;
  const s = l ? JSON.stringify([l, S.touch[l.slug]]) : null;
  const was = page._sig;
  page._sig = s;
  sc.innerHTML = l ? leadHtml(l) : M.ready && !NET.loading ? gone('lead') : pageSkeleton();
  sc.scrollTop = y;
  if (l) { const t = $('.tb-title', page); if (t && t.textContent !== l.name) t.textContent = l.name; }
  if ((enter || !was) && l) enterPage(sc);
}
function refreshLeadPage(page) { const l = leadOf(page.dataset.lead); if (!l || JSON.stringify([l, S.touch[l.slug]]) !== page._sig) drawLeadPage(page); }
// where a lead is on the path: the stages it has reached are inked, and the one it is in is the one named in ink
function stageTrack(st) {
  const path = onPath(M.stages.lead);
  const i = path.indexOf(st);
  const where = i < 0 ? `off the path, ${st}` : `${st}, ${i + 1} of ${path.length}`;
  return `<div class="cl-track${i < 0 ? ' off' : ''}" role="img" aria-label="Stage: ${esc(where)}" style="--n:${path.length || 1}">
    <span class="cl-track-l"><span class="cl-k">Stage</span><span>${i < 0 ? `Off the path · ${esc(cap(st))}` : `${i + 1} of ${path.length}`}</span></span>
    <span class="cl-track-bar" aria-hidden="true">${path.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</span>
    <span class="cl-track-s" aria-hidden="true">${path.map((s, k) => `<span class="${k === i ? 'now' : ''}">${esc(cap(s))}</span>`).join('')}</span>
  </div>`;
}
const LEAD_MOVES = [['prepare-pitch', 'doc', 'Prepare pitch'], ['client-onboarding', 'next', 'Convert to client'], ['lead-research', 'search', 'Run lead research']];
function leadHtml(l) {
  const touched = S.touch[l.slug];
  const unset = !touched && !l.nextTouch.set;
  const t = touched ?? l.nextTouch.text;
  // real: the next touch is "Fri 23 · Call": the when goes top right, the move is the line
  const [when, ...rest] = REAL && l.nextTouch.set ? t.split(' · ') : [null];
  return `${REAL ? `<div class="cl-stalebox">${staleLine()}</div>` : ''}
  <header class="cl-hero">
    <div class="cl-hero-id">
      ${mono(l, 'lg')}
      <div class="cl-hero-t"><h1 class="title1 cl-hname">${esc(l.name)}</h1><p class="sub">${esc([l.since ? `Lead since ${l.since}` : 'Lead', l.source ? `via ${l.source}` : ''].filter(Boolean).join(' · '))}</p></div>
    </div>
    ${l.note ? `<p class="cl-hsum">${esc(l.note.replace(/\.?$/, '.'))}</p>` : ''}
    ${l.onBoard ? '' : '<p class="cl-hsum cl-offboard">Not on the board in studio-brain\\clients\\_pipeline.md.</p>'}
  </header>

  <section class="cl-nextcard surface" aria-label="Next touch">
    <div class="cl-nc-top"><span class="cl-nc-k">${I.clock}Next touch</span>${unset ? '<span class="cl-due late">Needs you</span>' : when ? `<span class="cl-due ${dueTone(when)}">${esc(when)}</span>` : ''}</div>
    <p class="cl-nc-t">${esc(when ? (rest.join(' · ') || when) : t)}</p>
    <button class="btn ${unset ? 'primary' : ''} block" ${unset ? 'style="--c:var(--clients-fill)"' : ''} data-act="lead-touch" data-id="${esc(l.slug)}">${I.cal}${unset ? 'Set the next touch' : 'Change the next touch'}</button>
  </section>

  <div class="sh"><h2>Where it stands</h2></div>
  <div class="group cl-kv">
    ${stageTrack(l.stage)}
    <div class="row"><span class="cl-k">Warmth</span><span class="cl-v">${warmth(l.warmth)}${l.warmthText ? `<span class="cl-wt">${esc(l.warmthText)}</span>` : ''}</span></div>
    <div class="row"><span class="cl-k">Potential</span><span class="cl-v">${esc(l.potential)}</span></div>
    <div class="row"><span class="cl-k">Pitch</span><span class="cl-v">${esc(l.pitch)}</span></div>
  </div>

  <div class="sh"><h2>Moves</h2></div>
  <div class="group cl-moves">
    ${LEAD_MOVES.map(([w, ic, label]) => {
      const wf = M.workflows.find((x) => x.id === w) ?? { id: w, name: label, line: '', built: false };
      return `<button class="row ic" data-act="lead-flow" data-w="${w}" data-id="${esc(l.slug)}"><span class="tile">${I[ic]}</span><span class="rbody"><span class="rtitle">${label}</span>${wf.line ? `<span class="rmeta"><span class="ell">${esc(wf.line)}</span></span>` : ''}</span>${wf.built ? `<span class="pill">${I.play}Run</span>` : '<span class="pill plain">Spec only</span>'}</button>`;
    }).join('')}
  </div>

  <div class="sh"><h2>Files</h2></div>
  <div class="group cl-files">${folderRow('Sales folder', l.osFolder, l.osPath)}${(l.files ?? ['index.md', 'potential.md', 'pitch.md', 'raw/']).map((f) => fileRow(l.osPath, f)).join('')}</div>
  ${REAL ? '<p class="hint cl-hint">Read from studio-os on your PC. Changes go through a job, so the lead’s files stay the record.</p>' : ''}`;
}

// ── jobs: anything that would change a file is a job in Work's New job sheet, prefilled; he taps Start there ──
function startJob({ title, prompt, folders, client = null, project: proj }) {
  const fs = (folders ?? []).filter(Boolean);
  if (!fs.length) { haptic(6); toast('There’s no folder for this on your PC yet'); return; }
  const t = title.length > 80 ? `${title.slice(0, 78).trimEnd()}…` : title;
  const p = proj && project(proj) ? proj : undefined;
  // a sheet still sliding away (this one's own) goes first, the way Work opens its sheet after another
  setTimeout(() => api.newJob({ prompt, title: t, client, folder: fs[0], folders: fs, project: p }), $('.sheet:not(.in)') ? 260 : 0);
}
const forClient = (c) => ({ slug: c.slug, name: c.name });

// ── sheets ────────────────────────────────────────────────────────────
// what can run now, apart from what is only written down; what already runs for this client says so instead of Run
function flowsSheet(c) {
  const list = M.workflows.filter((w) => w.for === 'client');
  const runs = (w) => c.workflows.some((x) => x.folder === w.id || x.name.toLowerCase() === String(w.name).toLowerCase());
  // what runs for this client but is not in the list below (its own rollout or pilot) is named up top
  const others = c.workflows.filter((x) => x.status !== 'done' && !list.some((w) => w.id === x.folder));
  const row = (w) => `<button class="row cl-fl${w.built ? '' : ' spec'}" data-act="cl-flow-run" data-w="${esc(w.id)}" data-id="${esc(c.slug)}">
      <span class="rbody"><span class="rtitle">${esc(w.name)}</span><span class="rmeta cl-fl-m">${w.needsOk ? '<span class="late">Needs your OK</span> · ' : ''}<span>${esc(w.line || w.dept || '')}</span></span></span>
      ${!w.built ? '<span class="pill plain">Spec only</span>' : runs(w) ? flowState('running') : `<span class="pill">${I.play}Run</span>`}
    </button>`;
  const ready = list.filter((w) => w.built), spec = list.filter((w) => !w.built && w.spec !== false), named = list.filter((w) => !w.built && w.spec === false);
  openSheet({
    title: 'Run a workflow', sub: `For ${esc(c.name)} · WORKFLOWS.md`, cls: 'cl-flow-sheet', large: ready.length + spec.length > 5,
    body: (b) => {
      b.innerHTML = `${others.length ? `<p class="cl-flow-now">${I.flow}<span>${[...new Set(others.map((x) => x.status))].map((st) => `${esc(cap(st))} for ${esc(c.name)}: <b>${others.filter((x) => x.status === st).map((x) => esc(x.name)).join(', ')}</b>`).join('. ')}</span></p>` : ''}
        ${ready.length ? `<p class="cl-lbl">Ready to run</p><div class="group cl-flows">${ready.map(row).join('')}</div>` : ''}
        ${spec.length ? `<p class="cl-lbl">Written down, not built yet</p><div class="group cl-flows">${spec.map(row).join('')}</div>` : ''}
        ${named.length ? `<p class="cl-foot">${plural(named.length, 'more is', 'more are')} only named in the catalog so far.</p>` : ''}
        ${REAL ? '<p class="cl-foot">Run starts a job in the client’s folders. You check it and tap Start in Work.</p>' : ''}`;
      stagger($$('.row, .cl-flow-now', b), { y: 8, each: 26, max: 200, delay: 120 });
    },
  });
}
function logSheet(c) {
  const on = M.write.on;
  openSheet({
    title: 'Log work', sub: `${esc(c.name)} · goes into work-log.md`, cls: 'cl-log-sheet',
    body: (b) => {
      b.innerHTML = `<div class="pad cl-logsheet">
        <label class="field cl-ta"><textarea rows="4" placeholder="What did you do?" aria-label="What you did"></textarea></label>
        ${on ? `<p class="foot">Dated ${esc(day(today()))}, at the ${REAL ? 'end' : 'top'} of the Work log. The first line is the title.${REAL ? ' The log is append-only: a mistake is fixed with a new entry.' : ''}</p>
        <button class="btn primary block" style="--c:var(--clients-fill)" data-act="cl-log-save" data-id="${esc(c.slug)}" disabled>Add to the work log</button>`
        : `<p class="cl-off" role="note">${esc(M.write.why || 'Logging from the phone is off on your PC.')}</p>
        <button class="btn block" data-act="cl-log-job" data-id="${esc(c.slug)}" disabled>${I.claude}Hand it to a job instead</button>`}
      </div>`;
      const ta = $('textarea', b), btn = $('.btn', b);
      ta.addEventListener('input', () => { btn.disabled = !ta.value.trim(); });
      setTimeout(() => ta.focus({ preventScroll: true }), 450);
    },
  });
}
// one date, one move. Real: the lead's card lives in studio-os, so a job writes it there
function touchSheet(l) {
  const t = today();
  const at = (n) => clock.addDays(t, n);
  const wd = clock.dparts(t).dow;
  const mon = at(((8 - wd) % 7) || 7);
  const whens = [['Tomorrow', at(1)], [`${WD[clock.dparts(at(2)).dow]} ${day(at(2))}`, at(2)], [`Mon ${day(mon)}`, mon], ['In two weeks', at(14)]]
    .filter(([, v], i, a) => a.findIndex(([, x]) => x === v) === i);
  const pick = (name, items, on) => `<div class="chips" role="radiogroup" aria-label="${name}">${items.map(([label, v], i) => `<button class="chip${i === on ? ' on' : ''}" data-act="cl-pick" data-v="${esc(v)}" role="radio" aria-checked="${i === on}">${esc(label)}</button>`).join('')}</div>`;
  openSheet({
    title: 'Next touch', sub: `${esc(l.name)} · one date, one move`,
    body: `<div class="pad cl-touchsheet">
      <p class="cl-lbl">When</p>${pick('When', whens, Math.min(1, whens.length - 1))}
      <p class="cl-lbl">Move</p>${pick('Move', ['Call', 'WhatsApp', 'Visit', 'Send the pitch'].map((m) => [m, m]), 0)}
      ${REAL ? `<p class="foot cl-touch-note">The next touch lives in ${esc(l.osFolder)}\\index.md. A job on your PC writes it there.</p>` : ''}
      <button class="btn primary block" style="--c:var(--clients-fill)" data-act="lead-touch-save" data-id="${esc(l.slug)}">${REAL ? 'Start a job to set it' : 'Save the next touch'}</button>
    </div>`,
  });
}
function newLeadSheet() {
  openSheet({
    title: 'New lead', sub: `Paste or ${REAL ? 'type' : 'speak'} what you know. Lead intake files it.`, cls: 'cl-nl-sheet',
    body: (b) => {
      b.innerHTML = `<div class="cl-nl">
        <div class="cl-nl-field"><textarea class="cl-nl-in" rows="3" placeholder="Who they are, what they need, how you met" aria-label="What you know about the lead"></textarea>
          ${REAL ? '' : `<button class="cl-nl-mic" data-act="cl-nl-mic" aria-label="Speak it">${I.mic}</button>`}</div>
        <div class="cl-nl-rec" hidden></div>
        <div class="cl-nl-tools"><button class="chip sm" data-act="cl-nl-paste">${I.paste}Paste</button><span class="cl-nl-to"><span>Files to</span><span class="mono cl-nl-path">sales\\…\\</span></span></div>
        <p class="cl-nl-dup" hidden></p>
        <ol class="cl-nl-steps">
          <li><b>Reads</b> what you paste or ${REAL ? 'type' : 'say'}</li>
          <li><b>Checks</b> your clients and leads for a duplicate</li>
          <li><b>Files</b> it in studio-os with index.md, potential.md and raw/</li>
        </ol>
        ${REAL ? '<p class="foot cl-nl-job">It runs as a job on your PC: you check it and tap Start in Work.</p>' : ''}
        <button class="btn primary block" style="--c:var(--clients-fill)" data-act="cl-nl-go" disabled>File the lead</button>
      </div>`;
      $('.cl-nl-in', b).addEventListener('input', () => nlUpdate(b));
      if (REAL) setTimeout(() => $('.cl-nl-in', b)?.focus({ preventScroll: true }), 450);
    },
  });
}
// what you type becomes the folder name; a name that is already a lead or client is caught here, not after
const slugify = (t) => t.split(/[,.\n:;–—]/)[0].toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9\s-]/g, '').trim().split(/\s+/).slice(0, 4).join('-');
const dupOf = (slug) => [...M.leads, ...M.clients].find((x) => slug && (x.slug === slug || slug.startsWith(x.slug) || (REAL && x.slug.startsWith(slug))));
function nlUpdate(b) {
  const v = $('.cl-nl-in', b).value.trim();
  const slug = slugify(v);
  const dup = dupOf(slug);
  $('.cl-nl-path', b).textContent = dup ? `${(dup.osFolder ?? dup.brainFolder ?? `sales\\${dup.slug}`).replace(/^[\w-]+-(os|brain)\\/, '')}\\raw\\` : `sales\\${slug || '…'}\\`;
  const d = $('.cl-nl-dup', b);
  d.hidden = !dup;
  if (dup) d.innerHTML = `<b>${esc(dup.name)}</b> is already ${dup.kind === 'lead' ? 'a lead' : 'a client'}. This goes into its raw/ folder instead of a new one.`;
  const go = $('[data-act="cl-nl-go"]', b);
  go.disabled = !slug;
  go.textContent = dup ? `Add to ${dup.name}` : 'File the lead';
}
function searchSheet() {
  openSheet({
    title: 'Search clients', large: true,
    body: (b) => {
      b.innerHTML = `<div class="pad"><label class="field cl-find">${I.search}<input type="search" placeholder="Clients, leads, products" autocomplete="off" enterkeyhint="search" aria-label="Search clients and leads" /><button class="fbtn cl-find-x" type="button" aria-label="Clear the search" hidden>${I.x}</button></label></div><div class="cl-res" aria-live="polite"></div>`;
      // retired clients are found too, but they have no page to open
      const retired = M.retired.map((r) => ({ ...r, kind: 'retired', mono: r.name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join(''), stage: 'retired' }));
      const res = $('.cl-res', b), input = $('input', b), clear = $('.cl-find-x', b);
      const meta = (x) => (x.kind === 'lead' ? `${cap(x.stage)} · ${x.warmth === 'unknown' ? 'warmth not set' : x.warmth}` : x.kind === 'retired' ? x.note : [x.product, x.stage].filter(Boolean).join(' · '));
      const row = (x) => (x.kind === 'retired'
        ? `<div class="row ic cl-res-ret">${mono(x, 'sm')}<span class="rbody"><span class="rtitle">${esc(x.name)}</span><span class="rmeta"><span class="ell">${esc(meta(x))}</span></span></span></div>`
        : `<button class="row ic" data-act="${x.kind === 'lead' ? 'lead-open' : 'client-open'}" data-id="${esc(x.slug)}">${mono(x, 'sm')}<span class="rbody"><span class="rtitle">${esc(x.name)}</span><span class="rmeta"><span class="ell">${esc(meta(x))}</span></span></span>${I.chevR}</button>`);
      const drawRes = (q) => {
        const hit = (x) => !q || `${x.name} ${x.product ?? ''} ${x.stage} ${x.slug}`.toLowerCase().includes(q.toLowerCase());
        const parts = [['Clients', M.clients], ['Leads', M.leads], ['Retired', retired]].map(([t, xs]) => [t, xs.filter(hit)]).filter(([, xs]) => xs.length);
        res.innerHTML = parts.length ? parts.map(([t, xs]) => `<p class="cl-lbl">${t}<span class="num">${xs.length}</span></p><div class="group cl-res-g">${xs.map(row).join('')}</div>`).join('')
          : `<div class="note cl-empty"><b>Nothing matches “${esc(q)}”</b>Search looks at names, products and stages.</div>`;
        clear.hidden = !input.value;
      };
      drawRes('');
      input.addEventListener('input', () => drawRes(input.value.trim()));
      clear.addEventListener('click', (e) => { e.preventDefault(); input.value = ''; drawRes(''); input.focus(); });
      setTimeout(() => input.focus(), 450);
    },
  });
}
// the client window, all clients: who has a page, what waits on them, what Claude would ask them, what came back
function windowsSheet() {
  openSheet({
    title: 'Client pages', sub: 'Links you send clients, and their answers', large: true, cls: 'cl-wins-sheet',
    body: (b) => { b._draw = () => { b.innerHTML = windowsHtml(); }; b._draw(); },
  });
  loadWin();
}
function windowsHtml() {
  const W = NET.win;
  if (!W) return NET.winError ? `<div class="note cl-empty" role="alert"><b>${esc(NET.winError.offline ? 'Your PC isn’t reachable right now' : NET.winError.message)}</b>Client pages live on your PC.</div>` : '<div class="cl-loading" role="status"><span class="spin" aria-hidden="true"></span>Asking your PC</div>';
  const nameOfWin = (s) => W.clients.find((x) => x.slug === s)?.name ?? nameOf(s);
  const open = W.decisions.filter((d) => d.status === 'open'), answered = W.decisions.filter((d) => d.status === 'answered').slice(0, 12);
  const row = (w) => {
    const meta = [!w.active ? 'Switched off' : w.link ? (w.link.lastSeen ? `Opened ${agoText(Date.parse(w.link.lastSeen))}` : 'Link live, not opened yet') : 'No link yet', w.openDecisions ? `${w.openDecisions} waiting` : '', w.answeredThisWeek ? `${w.answeredThisWeek} answered` : ''].filter(Boolean).join(' · ');
    const has = !!clientOf(w.slug);
    return `<${has ? 'button' : 'div'} class="row ic"${has ? ` data-act="client-open" data-id="${esc(w.slug)}"` : ''}><span class="tile${w.link && w.active ? ' cl-win-live' : ''}">${I.window}</span><span class="rbody"><span class="rtitle">${esc(w.name)}</span><span class="rmeta"><span class="ell">${esc(meta)}</span></span></span>${has ? I.chevR : ''}</${has ? 'button' : 'div'}>`;
  };
  const dec = (d) => `<div class="row cl-dec"><span class="cl-dec-i${d.status === 'open' ? ' open' : ''}" aria-hidden="true">${d.status === 'open' ? '?' : I.check}</span><span class="rbody"><span class="rtitle wrap">${esc(d.question)}</span><span class="rmeta"><span class="ell">${esc(d.status === 'open' ? `${nameOfWin(d.client)} · asked ${day(clock.dateOfIso(d.createdAt))}` : `${nameOfWin(d.client)}: ${d.answer} · ${day(clock.dateOfIso(d.answeredAt))}`)}</span></span></span></div>`;
  const ask = (q) => `<div class="row cl-dec"><span class="cl-dec-i ai" aria-hidden="true">${I.claude}</span><span class="rbody"><span class="rtitle wrap">${esc(q.question)}</span><span class="rmeta"><span class="ell">${esc(`For ${q.clientName} · on ${q.title}`)}</span></span></span>${q.marked ? '<span class="pill plain">On their page</span>' : `<button class="btn sm" data-act="cl-win-q" data-task="${esc(q.task)}" data-id="${esc(q.client)}">Ask them</button>`}</div>`;
  return `<div class="cl-wins">
    ${W.clients.length ? `<p class="cl-lbl">Clients with a page<span class="num">${W.clients.length}</span></p><div class="group">${W.clients.map(row).join('')}</div>`
    : '<div class="note cl-empty"><b>No client pages yet</b>Open a client and make their link under Their page.</div>'}
    ${W.questions.length ? `<p class="cl-lbl">Claude would ask them<span class="num">${W.questions.length}</span></p><div class="group">${W.questions.map(ask).join('')}</div>` : ''}
    ${open.length ? `<p class="cl-lbl">Waiting on clients<span class="num">${open.length}</span></p><div class="group">${open.map(dec).join('')}</div>` : ''}
    ${answered.length ? `<p class="cl-lbl">Answered<span class="num">${answered.length}</span></p><div class="group">${answered.map(dec).join('')}</div>` : ''}
  </div>`;
}
function askSheet(c) {
  openSheet({
    title: 'Ask them', sub: `${esc(c.name)} sees it on their page`,
    body: (b) => {
      b.innerHTML = `<div class="pad cl-asksheet">
        <label class="field cl-ta"><textarea rows="3" maxlength="500" placeholder="The question, as they would read it" aria-label="The question"></textarea></label>
        <label class="field"><input maxlength="300" placeholder="Choices, like Yes | No (optional)" aria-label="Choices" autocapitalize="off" /></label>
        <p class="foot">Without choices they answer in their own words. Their answer comes back to Clients and your inbox.</p>
        <button class="btn primary block" style="--c:var(--clients-fill)" data-act="cl-win-ask-go" data-id="${esc(c.slug)}" disabled>Put it on their page</button>
      </div>`;
      const ta = $('textarea', b), btn = $('.btn', b);
      ta.addEventListener('input', () => { btn.disabled = ta.value.trim().length < 3; });
      setTimeout(() => ta.focus({ preventScroll: true }), 450);
    },
  });
}
async function previewSheet(c) {
  const w = NET.win?.clients.find((x) => x.slug === c.slug);
  const el = openSheet({ title: 'Their page', sub: `What ${esc(c.name)} sees`, large: true, cls: 'cl-prev-sheet', body: '<div class="cl-loading" role="status"><span class="spin" aria-hidden="true"></span>Reading their page</div>' });
  const body = $('.sheet-body', el);
  try {
    const p = await pc(`/mod/clients/${encodeURIComponent(c.slug)}/preview`);
    const url = pageUrl(p.link ?? w?.link);
    const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
    const row = (mark, t, m) => `<div class="row cl-prow">${mark}<span class="rbody"><span class="rtitle wrap">${t}</span>${m ? `<span class="rmeta cl-wrapm">${m}</span>` : ''}</span></div>`;
    const block = (label, html, empty) => `<p class="cl-lbl">${label}</p>${html ? `<div class="group">${html}</div>` : `<div class="note cl-empty">${empty}</div>`}`;
    const decs = p.decisions.map((d) => row('<span class="cl-dec-i open" aria-hidden="true">?</span>', esc(d.question), d.options.length ? d.options.map(esc).join(' / ') : 'A free answer')).join('');
    const shipped = p.shipped.map((t) => row(`<span class="cl-dec-i" aria-hidden="true">${I.check}</span>`, esc(t.title), `${esc(day(clock.dateOfIso(t.doneAt)))}${t.evidence?.text ? ` · ${esc(t.evidence.text)}` : ''}${(t.evidence?.links ?? []).map((l) => ` · ${esc(host(l))}`).join('')}`)).join('');
    const next = p.next.map((t) => row('<span class="cl-dec-i next" aria-hidden="true"></span>', esc(t.title), `${t.doing ? 'In progress · ' : ''}${t.due ? `Due ${esc(day(t.due))}` : 'No date yet'}`)).join('');
    body.innerHTML = `<div class="cl-prev">
      <div class="cl-prev-head surface"><span class="cl-lbl">Northwind Studio · your window</span><b>${esc(p.client.name)}</b><span class="foot">${esc(p.client.projects.join(', ') || 'No projects on it')}</span></div>
      ${block('Decisions', decs, 'Nothing waiting on them.')}${block('Shipped · last 14 days', shipped, 'Nothing finished in the last two weeks.')}${block('Next', next, 'Nothing lined up.')}
      ${url ? `<div class="pad cl-prev-foot"><a class="btn block" href="${esc(url)}" target="_blank" rel="noopener">${I.window}Open the real page</a></div>` : ''}
    </div>`;
    stagger($$('.cl-prev > *', body), { y: 10, each: 40, max: 240 });
  } catch (e) { body.innerHTML = `<div class="note cl-empty" role="alert"><b>${esc(e?.status ? e.message : 'Your PC isn’t reachable right now')}</b>The preview is read from your PC.</div>`; }
}
function revokeSheet(c) {
  openSheet({
    title: `Revoke ${esc(c.name)}’s link?`, sub: 'Their page stops working until you make a new one.',
    body: `<div class="pad cl-revoke"><button class="btn tint block" style="--c:var(--fail)" data-act="cl-win-revoke-go" data-id="${esc(c.slug)}">Revoke the link</button><button class="btn block" data-act="close-sheet">Keep it</button></div>`,
  });
}

// ── the work log: the one direct write, and it waits on this phone when the PC is away ──
// An entry the PC may have written already (a lost reply) is looked for in the client's log before it is sent again.
const outbox = () => jsonOf(K.outbox) ?? [];
const outboxFor = (slug) => outbox().filter((x) => x.slug === slug).map((x) => ({ date: x.date, title: x.title, body: x.body, waiting: true }));
const logTitle = (t) => t.replace(/\s+/g, ' ').replace(/^#+\s*/, '').trim().slice(0, 120);
let flushing = false;
async function flushLogs() {
  if (!REAL || flushing || !M.write.on) return;
  const q = outbox(); if (!q.length) return;
  flushing = true;
  try {
    for (const x of q) {
      const c = clientOf(x.slug);
      if (c?.log.some((e) => e.title === x.title && e.date >= x.date)) { drop(x.id); continue; }
      try { await pc(`/mod/crm/clients/${encodeURIComponent(x.slug)}/log`, { method: 'POST', body: JSON.stringify({ text: x.text }) }); drop(x.id); }
      catch (e) { if (e?.status && e.status < 500) { drop(x.id); toast(`Not logged for ${c?.name ?? x.slug}: ${e.message}`); } else break; }
    }
  } finally { flushing = false; }
  q.map((x) => x.slug).filter((s, i, a) => a.indexOf(s) === i).forEach(loadClient);
  function drop(id) { ls.set(K.outbox, JSON.stringify(outbox().filter((y) => y.id !== id))); }
}

// ── actions ───────────────────────────────────────────────────────────
const fromSheet = (el) => { const s = el.closest('.sheet'); if (s) closeSheet(s); };
const copy = async (text, said) => {
  try { await navigator.clipboard.writeText(text); haptic(10); toast(said); }
  catch { if (navigator.share) { try { await navigator.share({ text }); } catch {} } else toast(text); }
};
on('client-open', (el) => { fromSheet(el); openClient(el.dataset.id); });
on('lead-open', (el) => { fromSheet(el); openLead(el.dataset.id); });
on('cl-retired', () => { S.retired = !S.retired; haptic(5); const g = $('#clPanel .cl-retired'); if (g) { const t = document.createElement('template'); t.innerHTML = retiredBlock(); const n = t.content.firstElementChild; g.replaceWith(n); if (S.retired) stagger($$('.row + .row', n), { y: -6, each: 30 }); } else panel(); });
on('cl-project', (el) => api.openProject(el.dataset.id, el.dataset.back));
on('cl-pick', (el) => { $$('.chip', el.parentElement).forEach((c) => { c.classList.toggle('on', c === el); c.setAttribute('aria-checked', String(c === el)); }); haptic(5); });
on('cl-retry', () => { load({ fresh: true }); draw(); });
on('cl-more-log', (el) => { S.logAll.add(el.dataset.id); haptic(5); const c = clientOf(el.dataset.id); if (!c) return; const before = $$(`.cl-page[data-slug="${CSS.escape(c.slug)}"] .cl-log .cl-le`).length; refreshPart(c.slug, '.cl-log', logHtml(c)); stagger($$(`.cl-page[data-slug="${CSS.escape(c.slug)}"] .cl-log .cl-le`).slice(before), { y: 8, each: 22, max: 300 }); });
on('cl-wait', (el) => {
  const k = el.dataset.k; const slug = el.dataset.id; const c = clientOf(slug); if (!c) return;
  const keep = () => { if (REAL) ls.set(K.done, JSON.stringify([...S.done])); };
  const redraw = () => { refreshPart(slug, '.cl-wait', waitHtml(c)); refreshPart(slug, '.cl-waitn', String(waitCount(c) || '')); };
  if (S.done.has(k)) { S.done.delete(k); keep(); redraw(); return; }
  S.done.add(k); keep(); haptic(10); redraw();
  toast(REAL ? 'Ticked on this phone. NOW.md is unchanged' : 'Marked done', () => { S.done.delete(k); keep(); redraw(); });
});
on('cl-sync', (el) => {
  if (!REAL) {
    el.disabled = true; el.innerHTML = '<span class="spin" aria-label="Syncing"></span>'; el.closest('.cl-sync')?.classList.add('is-busy');
    setTimeout(() => { S.synced = 'just now'; panel(); toast('Synced with studio-os and studio-brain'); }, 900);
    return;
  }
  haptic(6);
  load({ fresh: true }).then(() => { if (!NET.error) toast('Read studio-os and studio-brain again'); else toast(NET.error.offline ? 'Your PC isn’t reachable right now' : NET.error.message); });
});
on('cl-file', (el) => (REAL && el.dataset.path ? copy(el.dataset.path, 'Path copied') : toast(`Opens ${el.dataset.f} on your PC`)));
// a job for a client opens Work's New job sheet with the client's next step as the brief and its folders as the places
on('cl-job', (el) => {
  const c = clientOf(el.dataset.id); if (!c) return;
  if (!REAL) { api.newJob({ prompt: `${c.name}: ${c.next.text}`, title: `${c.name}: ${c.next.text}`, client: { ...forClient(c), project: c.projects[0] }, project: c.projects[0] ?? 'agentic-os' }); return; }
  startJob({ title: `${c.name}: ${c.next.text}`, prompt: `For ${c.name}. Next step: ${c.next.text}.`, folders: placesOf(c), client: forClient(c), project: c.projects[0] });
});
on('cl-flows', (el) => { const c = clientOf(el.dataset.id); if (c) flowsSheet(c); });
on('cl-log', (el) => { const c = clientOf(el.dataset.id); if (c) logSheet(c); });
on('cl-flow-run', (el) => {
  const w = M.workflows.find((x) => x.id === el.dataset.w); const c = clientOf(el.dataset.id);
  if (!w || !c) return;
  if (!w.built) { haptic(6); toast(`${w.name} is ${REAL ? 'written down, not built' : 'spec only'}${w.needsOk ? ' and needs your OK' : ''}. Nothing to run yet`); return; }
  const runs = c.workflows.some((x) => x.folder === w.id || x.name.toLowerCase() === String(w.name).toLowerCase());
  if (!REAL) {
    if (runs) { haptic(6); toast(`${w.name} is already running for ${c.name}`); return; }
    closeSheet(el.closest('.sheet')); haptic(12);
    // a run shows up on the client page straight away, as a running workflow
    c.workflows.push({ name: w.name, status: 'running', folder: w.id, detail: '' });
    refreshPart(c.slug, '.cl-flowlist', flowsHtml(c));
    refreshPart(c.slug, '.cl-flown', String(c.workflows.length || ''));
    toast(`${w.name} started for ${c.name}`);
    return;
  }
  fromSheet(el);
  startJob({
    title: `${w.name} for ${c.name}`,
    prompt: `Run the ${w.id} workflow for ${c.name} (studio-os\\WORKFLOWS.md; the skill is studio-os\\skills\\${w.id}\\SKILL.md).${runs ? ' It already runs for them: carry it on from where its folder says it is.' : ''}${w.needsOk ? ' It is agency-era: ask me before doing anything.' : ''}`,
    folders: [c.osPath, c.brainPath, M.os], client: forClient(c), project: c.projects[0],
  });
});
on('cl-log-save', async (el) => {
  const sh = el.closest('.sheet'); const v = $('textarea', sh)?.value.trim(); if (!v) return;
  const slug = el.dataset.id; const c = clientOf(slug); if (!c) return;
  const [title, ...rest] = v.split('\n');
  const redraw = () => { const cc = clientOf(slug); if (!cc) return; refreshPart(slug, '.cl-log', logHtml(cc)); refreshPart(slug, '.cl-logn', String(logTotal(cc) || '')); };
  if (!REAL) {
    Object.values(S.logs).forEach((l) => l.forEach((e) => { e.fresh = false; }));
    (S.logs[slug] ??= []).unshift({ date: today(), title: title.trim(), body: rest.join(' ').trim(), fresh: true });
    closeSheet(sh); haptic(12); redraw();
    toast('Logged to work-log.md', () => { S.logs[slug].shift(); redraw(); });
    return;
  }
  el.disabled = true; el.textContent = 'Adding';
  try {
    const r = await pc(`/mod/crm/clients/${encodeURIComponent(slug)}/log`, { method: 'POST', body: JSON.stringify({ text: v }) });
    if (r.client) { const n = normClient(r.client); n.log = n.log.map((e, i) => (i === 0 ? { ...e, fresh: true } : e)); NET.detail.set(slug, { at: clock.nowMs(), today: today(), raw: r.client, c: n }); keepDetails(); }
    closeSheet(sh); haptic(12);
    $$(`#stack .cl-page[data-slug="${CSS.escape(slug)}"]`).forEach(refreshClientPage);
    toast('Added to work-log.md');
    load();
  } catch (e) {
    if (e?.status) { el.disabled = false; el.textContent = 'Add to the work log'; toast(e.message); return; }
    // the PC is away: it waits here and goes when the PC answers
    ls.set(K.outbox, JSON.stringify([...outbox(), { id: `l${Date.now().toString(36)}`, slug, text: v, title: logTitle(title), body: rest.join(' ').trim(), date: today() }]));
    closeSheet(sh); haptic(10); redraw();
    toast('Saved on this phone. It goes to work-log.md when your PC answers');
  }
});
on('cl-log-job', (el) => {
  const sh = el.closest('.sheet'); const v = $('textarea', sh)?.value.trim(); const c = clientOf(el.dataset.id); if (!v || !c) return;
  const [title, ...rest] = v.split('\n');
  fromSheet(el);
  startJob({ title: `Log for ${c.name}: ${logTitle(title)}`, prompt: `Add this to the end of ${c.brainFolder}\\work-log.md as a new dated entry (the log is append-only; change nothing above it):\n\n## ${today()} — ${logTitle(title)}\n\n${rest.join('\n').trim()}`.trim(), folders: [c.brainPath], client: forClient(c), project: c.projects[0] });
});
on('cl-pin', (el) => {
  const c = clientOf(el.dataset.id); if (!c) return;
  const pin = !isPinned(c);
  scope.client = pin ? { slug: c.slug, name: c.name, project: c.projects[0] ?? '' } : null;
  $$('.cl-pin').forEach((b) => { const me = scope.client?.slug === b.dataset.id; b.classList.toggle('on', me); b.innerHTML = me ? I.pinF : I.pin; b.setAttribute('aria-pressed', String(me)); b.setAttribute('aria-label', `${me ? 'Unpin' : 'Pin'} ${clientOf(b.dataset.id)?.name ?? ''}`); });
  if (pin) symbol(el, 'bounce');
  panel();   // the list under this page shows the pin too, so it is right when you go back
  document.dispatchEvent(new CustomEvent('clients-changed', { detail: { why: 'pin' } }));   // a pinned client wins a tie for Work's next
  haptic(10);
  toast(pin ? `Pinned: jobs and Wyn stay scoped to ${c.name}` : `Unpinned ${c.name}`);
});
on('cl-make-os', (el) => {
  const slugs = el.dataset.id ? [el.dataset.id] : missingOs();
  if (!slugs.length) return;
  if (REAL) {
    if (!M.os) { toast('studio-os isn’t on your PC'); return; }
    const fix = issueFix({ kind: 'missing-os-folder', slugs });
    startJob({ title: fix.title, prompt: fix.prompt, folders: fix.folders, client: slugs.length === 1 && clientOf(slugs[0]) ? forClient(clientOf(slugs[0])) : null });
    return;
  }
  el.disabled = true; el.innerHTML = '<span class="spin" aria-label="Creating"></span>';
  setTimeout(() => {
    slugs.forEach((s) => S.made.add(s));
    const redraw = () => { draw(); $$('.cl-page[data-slug]').forEach((p) => { const c = clientOf(p.dataset.slug); const w = c && $('.cl-filewrap', p); if (w) w.innerHTML = filesHtml(c); }); };
    redraw(); haptic(12);
    toast(slugs.length > 1 ? `${slugs.length} OS folders made from the template` : `Made studio-os\\clients\\${slugs[0]}`, () => { slugs.forEach((s) => S.made.delete(s)); redraw(); });
  }, 900);
});
on('cl-issue', (el) => {
  const i = issueList()[+el.dataset.i]; const fix = i && issueFix(i); if (!fix) return;
  const c = fix.slug ? clientOf(fix.slug) : null;
  startJob({ title: fix.title, prompt: fix.prompt, folders: fix.folders, client: c ? forClient(c) : null, project: c?.projects[0] });
});
on('lead-touch', (el) => { const l = leadOf(el.dataset.id); if (l) touchSheet(l); });
on('lead-touch-save', (el) => {
  const sh = el.closest('.sheet'); const [whenEl, moveEl] = $$('.chips', sh).map((c) => $('.chip.on', c));
  const slug = el.dataset.id; const l = leadOf(slug); if (!l) return;
  if (REAL) {
    fromSheet(el);
    startJob({ title: `${l.name}: next touch`, prompt: `In ${l.osFolder}\\index.md set the next-touch line to: next-touch: ${whenEl?.dataset.v} — ${(moveEl?.dataset.v ?? 'call').toLowerCase()}. It is sacred (OS.md rule 11); change nothing else.`, folders: [l.osPath], client: forClient(l) });
    return;
  }
  const when = whenEl?.textContent ?? '', move = moveEl?.textContent ?? '';
  const prev = S.touch[slug];
  S.touch[slug] = `${move} · ${when}`;
  closeSheet(sh); haptic(12);
  const redraw = () => { $$(`.lead-page[data-lead="${CSS.escape(slug)}"]`).forEach((p) => drawLeadPage(p)); panel(); };
  redraw();
  toast(`Next touch: ${move}, ${when}`, () => { if (prev) S.touch[slug] = prev; else delete S.touch[slug]; redraw(); });
});
on('lead-flow', (el) => {
  const w = M.workflows.find((x) => x.id === el.dataset.w); const l = leadOf(el.dataset.id);
  if (!l) return;
  if (!w?.built) { haptic(6); toast(`${w?.name ?? 'That'} is ${REAL ? 'written down, not built' : 'spec only'}. Nothing to run yet`); return; }
  if (!REAL) { haptic(12); toast(`${w.name} started on your PC for ${l.name}`); return; }
  startJob({ title: `${w.name}: ${l.name}`, prompt: `Use the ${w.id} skill (studio-os\\skills\\${w.id}\\SKILL.md) for the lead ${l.name} in ${l.osFolder}.`, folders: [l.osPath, M.os], client: forClient(l) });
});
on('cl-search', () => searchSheet());
on('cl-new-lead', () => newLeadSheet());
on('cl-nl-paste', async (el) => {
  const b = el.closest('.sheet'); const ta = $('.cl-nl-in', b);
  if (!REAL) { ta.value = 'Silver Lens: follow up, they never got a next touch'; nlUpdate(b); haptic(6); return; }
  try { const t = await navigator.clipboard.readText(); if (t?.trim()) { ta.value = t.trim(); nlUpdate(b); haptic(6); } else toast('Nothing to paste'); }
  catch { toast('The clipboard isn’t readable here. Long-press the box to paste'); }
});
on('cl-nl-mic', (el) => {
  const b = el.closest('.sheet'); const slot = $('.cl-nl-rec', b); const field = $('.cl-nl-field', b);
  field.hidden = true;
  recorder(slot, {
    say: 'Silver Lens. Ask them what they need, then set a next touch',
    onDone: (t) => { field.hidden = false; $('.cl-nl-in', b).value = t; nlUpdate(b); },
    onCancel: () => { field.hidden = false; },
  });
});
on('cl-nl-go', (el) => {
  const b = el.closest('.sheet'); const v = $('.cl-nl-in', b).value.trim(); const slug = slugify(v);
  if (!slug) return;
  const dup = dupOf(slug);
  if (REAL) {
    if (!M.os) { toast('studio-os isn’t on your PC'); return; }
    fromSheet(el);
    startJob({
      title: dup ? `Lead intake: more on ${dup.name}` : `Lead intake: ${v.split('\n')[0].slice(0, 60)}`,
      prompt: dup ? `Use the lead-intake skill (studio-os\\skills\\lead-intake\\SKILL.md). This is more about ${dup.name}, already ${dup.kind === 'lead' ? 'a lead' : 'a client'}: file it in its raw/ folder, not a new one.\n\n${v}`
        : `Use the lead-intake skill (studio-os\\skills\\lead-intake\\SKILL.md). New lead:\n\n${v}\n\nCheck clients and leads for a duplicate first, then file it under sales\\${slug}\\.`,
      folders: [M.os], client: dup ? forClient(dup) : null,
    });
    return;
  }
  closeSheet(b); haptic(14);
  if (dup) { toast(`Added to ${dup.name}'s raw/ folder`); return; }
  const name = v.split(/[,.\n:;–—]/)[0].trim().replace(/\b\w/g, (m) => m.toUpperCase()).slice(0, 40);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const t = clock.dparts(today());
  M.leads.push(normLead({ slug, name, mono: initials || 'NL', kind: 'lead', stage: 'new', warmth: 'cold', nextTouch: 'Not set (ask)', potential: 'Unknown', pitch: 'Not started', since: `${MON[t.month]} ${t.year}`, osFolder: `studio-os\\sales\\${slug}`, note: 'Filed from the phone' }));
  S.prev = S.view; S.view = 'leads';
  draw();
  enterPanel($('#clPanel'), 1);
  toast(`Filed studio-os\\sales\\${slug}`, () => { M.leads = M.leads.filter((l) => l.slug !== slug); draw(); });
});
// the client window
const winOf = (slug) => NET.win?.clients.find((x) => x.slug === slug) ?? null;
async function winAct(el, run, ok) {
  if (el.disabled) return;
  const label = el.innerHTML; el.disabled = true; el.innerHTML = '<span class="spin" aria-label="Working"></span>';
  try { const r = await run(); haptic(12); if (ok) toast(typeof ok === 'function' ? ok(r) : ok); await loadWin(); }
  catch (e) { el.disabled = false; el.innerHTML = label; toast(e?.status ? e.message : 'Your PC isn’t reachable right now'); }
}
on('cl-windows', () => windowsSheet());
on('cl-win-link', (el) => {
  const c = clientOf(el.dataset.id); if (!c) return;
  // a client with no page yet gets one (named as on the board, over its agentos projects), then its link
  winAct(el, async () => {
    if (!winOf(c.slug)) await pc('/mod/clients/', { method: 'POST', body: JSON.stringify({ slug: c.slug, name: c.name, projects: c.projects.filter((p) => project(p)) }) });
    return pc(`/mod/clients/${encodeURIComponent(c.slug)}/link`, { method: 'POST', body: '{}' });
  }, (r) => (r?.minted ? 'Link made. Copy it to send' : 'Their link is ready'));
});
on('cl-win-copy', (el) => { const w = winOf(el.dataset.id); if (w?.link) copy(w.link.url, 'Link copied'); });
on('cl-win-preview', (el) => { const c = clientOf(el.dataset.id); if (c) previewSheet(c); });
on('cl-win-revoke', (el) => { const c = clientOf(el.dataset.id); if (c) revokeSheet(c); });
on('cl-win-revoke-go', (el) => winAct(el, async () => { const r = await pc(`/mod/clients/${encodeURIComponent(el.dataset.id)}/revoke`, { method: 'POST', body: '{}' }); closeSheet(el.closest('.sheet')); return r; }, 'Link revoked'));
on('cl-win-ask', (el) => { const c = clientOf(el.dataset.id); if (c) askSheet(c); });
on('cl-win-ask-go', (el) => {
  const sh = el.closest('.sheet'); const q = $('textarea', sh)?.value.trim(); const opts = ($('input', sh)?.value ?? '').split('|').map((s) => s.trim()).filter(Boolean);
  if (!q || q.length < 3) return;
  winAct(el, async () => { const r = await pc('/mod/clients/decisions', { method: 'POST', body: JSON.stringify({ client: el.dataset.id, question: q, options: opts }) }); closeSheet(sh); return r; }, 'On their page');
});
on('cl-win-q', (el) => winAct(el, () => pc('/mod/clients/asks', { method: 'POST', body: JSON.stringify({ task: el.dataset.task }) }), (r) => (r?.decision ? 'On their page' : r?.note ?? 'Marked for them')));

// ── start ─────────────────────────────────────────────────────────────
if (REAL) {
  fromCache();
  // after the first paint: Work's card wants the figures before Clients is ever opened
  setTimeout(() => { if (owner()) load(); }, 700);
  every(60000, () => load(), { when: () => owner() && (!!$('#clScroll') || !!$('#stack .cl-page') || currentTab() === 'jobs') });
  let was = connection().status;
  onConnection((c) => { if (c.status === 'ok' && was === 'offline') { load(); flushLogs(); } was = c.status; syncBits(); });
  clock.onMinute(() => syncBits());
} else fromDemo();

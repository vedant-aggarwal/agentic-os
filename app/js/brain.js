// The Brain: the centre of the wheel. What you and the agent know, in two libraries behind one search: the app's own
// Brain (notes, the inbox, facts, moments, filed by aspect, a file per person) and, for the owner, his brain vault (read
// through the PC's `brain` CLI, never edited here). Search by words, meaning, day and place, with the answer and its
// sources; what the agent filed today; folders by aspect with Romance and Soul behind Face ID; a living graph.
// A calm, deep library: Obsidian's graph, Apple Notes' clarity, not a file manager.
// Owner: BRAIN. Provides on the bus: openBrain(path), openPerson(id), remember(text, opts), brainStats(), brainFile(id, aspect).
import { $, $$, esc, push, pop, on, toast, haptic, openSheet, closeSheet, ring } from './core.js';
import { I, aspectIcon } from './icons.js';
import { ASPECTS, FAMILIES, aspect, PEOPLE, person, AGENT, ME, TASKS, GOALS, PROJECTS, DEMO_MODE } from './data.js';
import { aspectTile, aspectDef } from './aspects.js';
import { api, provide, has } from './bus.js';
import * as B from './brain-data.js';
import { FOLDERS, NOTES, INBOX, PERSON_FILE, VAULT, note, filedToday, savedToday, notesAbout, isLocked } from './brain-data.js';
import { graphModel, nodeInfo, FILTERS as GFILT } from './brain-graph.js';
import { localSearch, markHtml, WHEN, PLACES } from './brain-search.js';
import { unlock, lockNow, lockLabel } from './brain-lock.js';
import { mountGraph } from './graph.js';
import { stagger, rollHTML, roll, reduced } from './motion.js';
import { registerRoute } from './svc/route.js';
import * as clock from './svc/clock.js';

// the motion kit's stylesheet (rolling figures, the graph's a11y list) loads on first use, as other areas do
if (!document.querySelector('link[href$="css/motion.css"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/motion.css'; document.head.append(l); }

const FAM_ORDER = ['health', 'work', 'people'];
const KIND_ICON = { log: I.check, note: I.doc, doc: I.doc, file: I.doc, voice: I.mic, scan: I.scan, highlight: I.read, journal: I.edit, moment: I.people, fact: I.bulb, link: I.link };
const KIND_NAME = { log: 'Log', note: 'Note', doc: 'Document', file: 'File', voice: 'Voice note', scan: 'Scan', highlight: 'Highlight', journal: 'Journal', moment: 'Moment', fact: 'Fact', link: 'Link' };
const VFOLDER = { journal: 'Journal', note: 'Note', entity: 'Entity', tool: 'Tool', project: 'Project', doctrine: 'Doctrine', reference: 'Reference', source: 'Source', capture: 'Capture' };
const VDOMAIN = { work: 'Work', system: 'Systems', money: 'Money', self: 'Self', people: 'People', learn: 'Learning' };
const who = (n) => (n.by === 'wyn' ? AGENT.name : 'You');
const when = (n) => (n.day === 'today' ? n.at : n.day === 'yesterday' ? `Yesterday ${n.at}` : n.day);
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1).trimEnd()}…` : String(s));
const smooth = () => (reduced() ? 'auto' : 'smooth');
const where = (n) => (n.folder ? `${aspect(n.folder)?.name ?? n.folder}${n.sub ? ` › ${n.sub}` : ''}` : 'Inbox');
const owner = () => B.isOwner();
const enter = (els, o = {}) => { if (els?.length) stagger(els, { y: 10, each: 26, max: 300, ...o }); };
const dayOf = (iso) => { if (!iso) return ''; const d = String(iso).slice(0, 10); return d === clock.today() ? 'Today' : clock.label(d).short; };

// ── remember: file a note into the Brain (the agent, every app and the capture lens call this through the bus) ──
const viaOf = (v) => String(v ?? '').replace(/^(a|an|your) /i, '').toLowerCase() || null;
function remember(text, opts = {}) {
  const via = viaOf(opts.via ?? opts.source);
  const n = B.addItem({ text, aspect: opts.aspect ?? null, person: opts.person ?? null, title: opts.title ?? null, kind: opts.kind, by: opts.by ?? 'wyn', via: via === 'you said' ? 'agent' : via, where: opts.where ?? opts.place,
    inbox: !!opts.inbox, links: opts.links, content: opts.content, thumb: opts.thumb, from: opts.from, meta: opts.meta });
  if (!opts.quiet && n) {
    const to = n.status === 'inbox' || !n.folder ? 'Inbox' : n.links?.person ? person(n.links.person)?.name ?? aspect(n.folder)?.name : aspect(n.folder)?.name;
    toast(`Saved to your Brain · ${to}`, B.REAL ? () => { B.removeItem(n.id); } : undefined);
  }
  // the PC reads it (where it goes, whether she files it now); redraw when that comes back
  if (B.REAL) B.settle().catch(() => {});
  return n;
}
provide('remember', remember);
provide('brainStats', () => B.stats());
provide('brainFile', (id, asp, o = {}) => B.fileItem(id, { aspect: asp, person: o.person, by: o.by ?? 'you' }));

// ── rows ──────────────────────────────────────────────────────────────
function noteRow(n, { folder = true, hit = null } = {}) {
  const title = hit ? markHtml(hit.title.text, hit.title.marks) : esc(n.title);
  const text = hit ? markHtml(hit.snip.text, hit.snip.marks) : esc(n.text);
  return `<button class="row ic br-note" data-act="br-note" data-id="${esc(n.id)}">
    <span class="tile br-kind" aria-hidden="true">${KIND_ICON[n.kind] ?? I.doc}</span>
    <span class="rbody"><span class="rtitle">${title}</span>${n.text ? `<span class="br-snip">${text}</span>` : ''}
      <span class="br-meta">${folder ? `<i class="dot" style="--c:var(--${n.folder ?? 'ink-3'})"></i>${esc(where(n))} · ` : ''}${esc(who(n))} · ${esc(when(n))}${n.where ? ` · ${esc(n.where)}` : ''}</span></span>
  </button>`;
}
function vaultRow(r, { marks = null, tmarks = null } = {}) {
  const meta = [VFOLDER[r.folder] ?? 'Note', VDOMAIN[r.domain] ?? null, r.updated ? dayOf(r.updated) : null].filter(Boolean).join(' · ');
  return `<button class="row ic br-vrow" data-act="br-vnote" data-id="${esc(r.id)}">
    <span class="tile br-kind br-vk" aria-hidden="true">${r.folder === 'journal' ? I.edit : r.folder === 'entity' ? I.people : r.folder === 'project' ? I.hammer : r.folder === 'tool' ? I.link : I.book}</span>
    <span class="rbody"><span class="rtitle">${tmarks ? markHtml(r.title, tmarks) : esc(r.title)}</span>${r.summary ? `<span class="br-snip">${marks ? markHtml(r.summary, marks) : esc(r.summary)}</span>` : ''}
      <span class="br-meta"><i class="br-vdot" aria-hidden="true"></i>Vault · ${esc(meta)}</span></span></button>`;
}
const mono = (p, cls = '') => `<span class="br-mono ${cls}" style="--c:var(--${p.aspect})" aria-hidden="true">${esc(p.name[0])}</span>`;
const lastAbout = (pid) => { const n = notesAbout(pid)[0]; return n ? `Last note ${when(n)}` : 'No notes yet'; };

// ── home ──────────────────────────────────────────────────────────────
function inboxRow(it) {
  const thumb = it.kind === 'reel' ? `<span class="br-thumb reel" aria-hidden="true">${I.play}</span>` : it.kind === 'shot' ? `<span class="br-thumb shot" aria-hidden="true"><i></i><i></i><i></i></span>` : `<span class="tile br-kind" aria-hidden="true">${it.kind === 'voice' ? I.mic : I.doc}</span>`;
  const to = it.to.map((d) => d[1]).join(' + ');
  return `<div class="row br-in" data-id="${esc(it.id)}">
    <button class="br-in-open" data-act="br-in-open" data-id="${esc(it.id)}">${thumb}
      <span class="rbody"><span class="rtitle wrap">${esc(it.title)}</span><span class="rmeta">${esc(it.from)} · ${esc(String(it.meta ?? '').split(' · ').pop())} · ${esc(it.at)}</span>
      <span class="br-to">${I.sparkle}<span>${to ? esc(to) : `${esc(AGENT.name)} isn't sure yet: tap to pick`}</span></span></span></button>
    <button class="btn sm br-file" data-act="br-file" data-id="${esc(it.id)}"${to ? '' : ' data-pick="1"'}>${to ? 'File' : 'Pick'}</button>
  </div>`;
}
function inboxHtml() {
  return `<div class="sh" id="brInbox"><h2>Inbox</h2><span class="sh-count">${INBOX.length || ''}</span>${INBOX.filter((i) => i.to.length).length > 1 ? `<button class="sh-act" data-act="br-file-all">File all</button>` : ''}</div>
    <div class="group br-inbox">${INBOX.length ? INBOX.map(inboxRow).join('') : `<div class="row br-in-empty"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle">All filed</span><span class="rmeta">New shares and captures land here first</span></span></div>`}
      <button class="row ic br-share" data-act="br-sharein"><span class="tile">${I.share}</span><span class="rbody"><span class="rtitle">Share in from any app</span><span class="rmeta">Share › Agentic OS, from Instagram, Safari, WhatsApp, GPay</span></span>${I.chevR}</button>
    </div>`;
}
function todayHtml(shown = null) {
  const list = filedToday();
  const saved = savedToday().length;
  return `<div class="sh"><h2>${esc(AGENT.name)} filed ${rollHTML(shown ?? list.length)} today</h2></div>
    <div class="group br-day">${list.length ? list.slice(0, 5).map((n) => `<button class="br-tl" data-act="br-note" data-id="${esc(n.id)}">
      <span class="br-tl-t met">${esc(n.at)}</span><i class="br-tl-dot" style="--c:var(--${n.folder})" aria-hidden="true"></i>
      <span class="br-tl-b"><span class="br-tl-n">${esc(n.title)}</span><span class="br-tl-m">${esc(where(n))} · from ${esc(n.via)}</span></span></button>`).join('')
      : `<div class="row br-day-empty"><span class="tile">${I.sparkle}</span><span class="rbody"><span class="rtitle">Nothing filed yet today</span><span class="rmeta">Share, scan or tell ${esc(AGENT.name)} something; she files it and it shows here</span></span></div>`}
      <button class="row br-more" data-act="br-ask" data-q="What did I save today?"><span class="rbody"><span class="rtitle">Everything saved today</span></span><span class="br-more-n met">${saved}</span>${I.chevR}</button>
    </div>`;
}
function peopleHtml() {
  const list = PEOPLE.filter((p) => !isLocked(p.aspect));
  return `<div class="sh"><h2>People</h2><span class="sh-count">${list.length}</span><button class="sh-act" data-act="br-people">All ${I.chevR}</button></div>
    <div class="br-people">${list.map((p) => `<button class="br-person surface" data-act="br-person" data-id="${esc(p.id)}">${mono(p)}
      <span class="br-p-n">${esc(p.name)}</span><span class="br-p-r">${esc(String(p.role ?? '').split(' · ')[0])}</span><span class="br-p-l">${esc(DEMO_MODE ? p.last : lastAbout(p.id))}</span></button>`).join('')}
      <button class="br-person br-add" data-act="br-add-person"><span class="br-mono add" aria-hidden="true">${I.plus}</span><span class="br-add-t"><span class="br-p-n">Add someone</span><span class="br-p-r">A classmate at City College, someone you met</span></span></button>
    </div>`;
}
function folderCount(a) {
  const F = FOLDERS[a.id] ?? { count: 0 };
  if (isLocked(a.id)) return `${I.lock}Private`;
  if (!F.count && F.vault) return `<b class="met">${F.vault}</b> in vault`;
  if (!F.count) return 'Nothing yet';
  return `<b class="met">${F.count}</b>${F.updated ? ` · ${esc(F.updated)}` : ''}`;
}
function foldersHtml() {
  return `<div class="sh"><h2>Folders</h2><span class="sh-count">${ASPECTS.length}</span></div>
    ${FAM_ORDER.map((f) => `<p class="br-fam">${esc(FAMILIES[f])}</p><div class="br-folders">${ASPECTS.filter((a) => a.fam === f).map((a) => `<button class="br-folder surface${isLocked(a.id) ? ' locked' : ''}" data-act="br-folder" data-id="${a.id}">${aspectTile(a.id)}
        <span class="br-f-n">${esc(a.name)}</span><span class="br-f-c">${folderCount(a)}</span></button>`).join('')}</div>`).join('')}`;
}
function vaultHtml() {
  if (!owner() || DEMO_MODE) return '';
  if (!VAULT.ok) return `<div class="sh"><h2>Your vault</h2></div><div class="group"><div class="row"><span class="tile">${I.book}</span><span class="rbody"><span class="rtitle">Reading your vault…</span><span class="rmeta">Your brain vault on the PC opens here, read-only</span></span></div></div>`;
  const doms = [...(VAULT.domains ?? [])].sort((a, b) => b.count - a.count);
  return `<div class="sh"><h2>Your vault</h2><span class="sh-count">${rollHTML(VAULT.notes ?? 0)}</span><button class="sh-act" data-act="br-vault">Browse ${I.chevR}</button></div>
    <div class="chips br-vdoms pad">${doms.map((d) => `<button class="chip sm" data-act="br-vbrowse" data-domain="${esc(d.id)}">${esc(VDOMAIN[d.id] ?? d.id)} <span class="n">${d.count}</span></button>`).join('')}</div>
    <div class="group br-vrecent">${(VAULT.recent ?? []).slice(0, 4).map((r) => vaultRow({ id: r.id, title: r.title, folder: 'journal', updated: r.updated, summary: '' })).join('')}
      <button class="row ic" data-act="br-vcapture"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">Save a thought to your vault</span><span class="rmeta">Goes to the vault's capture inbox through the brain CLI</span></span>${I.chevR}</button></div>
    <p class="hint">Read from the brain vault on your PC. The app never edits it.</p>`;
}
function graphCard() {
  return `<div class="sh"><h2>Graph</h2></div>
    <button class="br-graphcard surface" data-act="br-graph" aria-label="Open the graph"><span class="br-gc-host" aria-hidden="true"></span>
      <span class="br-gc-b"><span class="br-gc-t">How it all connects</span><span class="br-gc-s"></span></span>${I.chevR}</button>`;
}
const subLine = () => {
  const n = B.REAL ? B.items().length : B.NOTE_TOTAL;
  const v = owner() && VAULT.ok ? VAULT.notes : 0;
  return v ? `${n} in your Brain, ${v} in your vault, ${PEOPLE.length} people. Everything you and ${esc(AGENT.name)} know.` : `${n} notes, ${PEOPLE.length} people. Everything you and ${esc(AGENT.name)} know.`;
};
function askChips() {
  const top = [...PEOPLE].filter((p) => !isLocked(p.aspect)).sort((a, b) => notesAbout(b.id).length - notesAbout(a.id).length)[0];
  return ['What did I save today?', top ? `What did I save about ${top.name}?` : null, 'From the shop', 'This week'].filter(Boolean);
}

let HOME = null;
function brainHome({ focus } = {}) {
  const page = push({
    title: 'Brain', cls: 'br-page',
    right: `<button class="gbtn chrome icon" data-act="br-graph" aria-label="Graph">${I.graph}</button>`,
    render(sc) {
      sc.innerHTML = `
        <header class="phead br-head"><h1 class="lt">Brain</h1><p class="sub br-subline">${subLine()}</p></header>
        <div class="br-searchrow pad">
          <button class="br-search" data-act="br-search">${I.search}<span>Search or ask your Brain</span></button>
          <button class="br-voice" data-act="br-voice" aria-label="Ask by voice">${I.mic}</button>
        </div>
        <div class="chips br-asks pad" data-slot="asks">${askChips().map((q) => `<button class="chip sm" data-act="br-ask" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
        <div class="br-inbox-slot">${inboxHtml()}</div>
        <div class="br-today-slot">${todayHtml()}</div><div class="br-people-slot">${peopleHtml()}</div><div class="br-folders-slot">${foldersHtml()}</div><div class="br-vault-slot">${vaultHtml()}</div>${graphCard()}`;
      enter($$('.br-in, .br-tl, .br-person, .br-folder', sc), { delay: 120 });
      rollUp(sc);
      mountMini(sc);
    },
    onPop() { if (HOME === page) HOME = null; mini?.destroy(); mini = null; },
  });
  HOME = page;
  if (B.REAL) B.refreshSummary();
  if (focus === 'inbox') requestAnimationFrame(() => { const t = $('#brInbox', page); t && $('.scroll', page).scrollTo({ top: t.offsetTop - 100, behavior: smooth() }); });
  return page;
}
// the figures roll up from zero when the page opens (the motion kit's rolling digits)
function rollUp(sc) {
  if (reduced()) return;
  for (const el of $$('.mx-roll', sc)) { const v = +el.dataset.v; if (!v) continue; el.outerHTML = rollHTML(0); }
  requestAnimationFrame(() => requestAnimationFrame(() => { const t = $('.br-today-slot .mx-roll', sc); if (t) roll(t, filedToday().length); const v = $('.br-vault-slot .mx-roll', sc); if (v) roll(v, VAULT.notes ?? 0); }));
}
// the home card's graph: alive, small, and a button (taps open the full graph)
let mini = null, miniSig = '';
const sigOf = (m) => `${m.nodes.map((n) => `${n.id}${n.hollow ? 'h' : ''}${Math.round((n.size ?? 0) * 20)}`).join('|')}#${m.links.length}`;
function mountMini(sc) {
  const host = $('.br-gc-host', sc); if (!host) return;
  const m = graphModel({ mini: true, vault: owner() ? B.cached('vg') : null });
  miniSig = sigOf(m);
  $('.br-gc-s', sc).textContent = `${m.nodes.length} nodes · ${m.links.length} links`;
  requestAnimationFrame(() => { try { mini?.destroy(); mini = mountGraph(host, { nodes: m.nodes, links: m.links, capture: 'card', label: 'Your Brain as a graph', padding: 14, minZoom: 0.2, maxZoom: 1.2 }); } catch (e) { console.warn('[brain] graph', e); } });
}
function refreshHome(why) {
  if (!HOME?.isConnected) return;
  const sc = $('.scroll', HOME);
  const s = $('.br-inbox-slot', sc); if (s) s.innerHTML = inboxHtml();
  const t = $('.br-today-slot', sc); if (t) { const old = +($('.mx-roll', t)?.dataset.v ?? 0); const n = filedToday().length; t.innerHTML = todayHtml(old); if (old !== n) roll($('.mx-roll', t), n); }
  const f = $('.br-folders-slot', sc); if (f) f.innerHTML = foldersHtml();
  const pp = $('.br-people-slot', sc); if (pp) { pp.innerHTML = peopleHtml(); if (why === 'people') enter($$('.br-person', pp)); }
  const ak = $('.br-asks', sc); if (ak) ak.innerHTML = askChips().map((q) => `<button class="chip sm" data-act="br-ask" data-q="${esc(q)}">${esc(q)}</button>`).join('');
  const v = $('.br-vault-slot', sc); if (v) v.innerHTML = vaultHtml();
  const sl = $('.br-subline', sc); if (sl) sl.innerHTML = subLine();
  if (mini) { const m = graphModel({ mini: true, vault: owner() ? B.cached('vg') : null }); const sg = sigOf(m); if (sg !== miniSig) { miniSig = sg; mini.update(m, { reheat: 0.3 }); } $('.br-gc-s', sc).textContent = `${m.nodes.length} nodes · ${m.links.length} links`; }
}
document.addEventListener('brain-changed', (e) => { refreshHome(e.detail?.why); refreshOpenPages(e.detail?.why); });
// People fills PEOPLE once its collection loads (aspects/people-store.js): the people cards and the graph follow
document.addEventListener('data-changed', (e) => { if (e.detail?.why === 'people') refreshHome('people'); });

// ── filing the inbox ──────────────────────────────────────────────────
function collapse(el, then) {
  if (!el || reduced()) { then?.(); return; }
  const h = el.offsetHeight;
  el.animate([{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' }], { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' }).onfinish = then;
}
function fileOne(it, aspectId = null, pid = undefined) {
  if (!B.REAL) { const i = INBOX.indexOf(it); if (i >= 0) INBOX.splice(i, 1); for (const [dest] of it.to) if (FOLDERS[dest]) B.addItem({ text: it.title, aspect: dest, by: 'wyn', via: it.from.toLowerCase() }); return () => { INBOX.unshift(it); refreshHome(); }; }
  // a reel or link also goes to Content OS (its owner), as the share-in card does
  if (it.content && has('addContentIdea') && it.to.some((d) => d[0] === 'content')) { try { api.addContentIdea(it.content); } catch {} }
  return B.fileItem(it.id, { aspect: aspectId ?? it.to.find((d) => FOLDERS[d[0]])?.[0] ?? null, person: pid, by: 'you' });
}
on('br-file', (el) => {
  const it = INBOX.find((x) => x.id === el.dataset.id); if (!it) return;
  if (el.dataset.pick || !it.to.some((d) => FOLDERS[d[0]])) return fileSheet(it);
  haptic(10);
  collapse(el.closest('.br-in'), () => {
    const undo = fileOne(it);
    refreshHome();
    toast(`Filed to ${it.to.filter((d) => FOLDERS[d[0]]).map((d) => d[1]).join(' and ')}`, undo || undefined);
  });
});
on('br-file-all', () => {
  const all = INBOX.filter((i) => i.to.some((d) => FOLDERS[d[0]])); haptic(12);
  $$('.br-in', HOME).filter((r) => all.some((i) => i.id === r.dataset.id)).forEach((r, i) => setTimeout(() => collapse(r), i * 70));
  setTimeout(() => { const undos = all.map((it) => fileOne(it)); refreshHome(); toast(`Filed ${all.length} things`, () => undos.forEach((u) => u?.())); }, all.length * 70 + 320);
});
// where an inbox item goes: her suggestions first, then every folder, and a person if it's about someone
function fileSheet(it) {
  const sug = it.to.filter((d) => FOLDERS[d[0]]);
  openSheet({
    title: 'File to', sub: esc(clip(it.title, 80)),
    body: `${it.why ? `<p class="br-why pad">${I.sparkle}<span>${esc(it.why)}</span></p>` : ''}
      ${sug.length ? `<div class="chips pad br-sug">${sug.map((d) => `<button class="chip" data-act="br-file-to" data-id="${esc(it.id)}" data-to="${d[0]}"${d[2] ? ` data-p="${esc(d[2])}"` : ''}>${I.sparkle}${esc(d[1])}</button>`).join('')}</div>` : ''}
      <div class="br-movegrid pad">${ASPECTS.map((a) => `<button class="br-mv" data-act="br-file-to" data-id="${esc(it.id)}" data-to="${a.id}">${aspectTile(a.id)}<span>${esc(a.name)}</span></button>`).join('')}</div>
      ${B.REAL ? `<div class="pad br-sheet-foot"><button class="btn sm" data-act="br-in-delete" data-id="${esc(it.id)}">${I.trash}Delete</button></div>` : ''}`,
  });
}
on('br-in-open', (el) => {
  const it = INBOX.find((x) => x.id === el.dataset.id); if (!it) return;
  // a share with content (a reel, a link) opens the share-in card that knows it; anything else opens the filing sheet
  if (it.content && has('openShareIn') && !B.REAL) return api.openShareIn(it.id);
  fileSheet(it);
});
on('br-file-to', (el) => {
  const it = INBOX.find((x) => x.id === el.dataset.id); if (!it) return;
  closeSheet(); haptic(10);
  const row = $$('.br-in', HOME ?? document).find((r) => r.dataset.id === it.id);
  collapse(row, () => { const undo = fileOne(it, el.dataset.to, el.dataset.p ?? undefined); refreshHome(); toast(`Filed to ${aspect(el.dataset.to)?.name}`, undo || undefined); });
});
on('br-in-delete', (el) => { closeSheet(); const undo = B.removeItem(el.dataset.id); refreshHome(); toast('Deleted from your inbox', undo); });
on('br-sharein', () => api.openShareIn());

// ── a folder ──────────────────────────────────────────────────────────
function folderPage(id, sub = null) {
  const a = aspect(id); const F = FOLDERS[id]; if (!a || !F) return brainHome();
  if (isLocked(id)) return privatePage(id, sub);
  const page = push({
    title: a.name, back: 'Brain', aspect: id, cls: 'br-page br-folderpage',
    right: B.PRIVATE.includes(id) ? `<button class="gbtn chrome icon" data-act="br-lock" aria-label="Lock ${lockLabel()}">${I.lock}</button>` : `<button class="gbtn chrome icon" data-act="aspect-open" data-id="${id}" aria-label="Open the ${esc(a.name)} app">${aspectIcon[id]}</button>`,
    render(sc) {
      const draw = () => {
        const notes = NOTES.filter((n) => n.folder === id && (!sub || n.sub === sub));
        const pinned = notes.filter((n) => n.pinned);
        const rest = notes.filter((n) => sub || !n.pinned);
        const by = F.by === 'wyn' ? esc(AGENT.name) : 'you';
        sc.innerHTML = `
          <header class="phead"><p class="kicker c-as">Folder in your Brain</p><h1 class="lt">${esc(a.name)}</h1><p class="sub">${F.count ? `${F.count} note${F.count === 1 ? '' : 's'}${F.updated ? ` · updated ${esc(F.updated)} by ${by}` : ''}` : 'Nothing filed here yet'}${F.vault ? ` · ${F.vault} related in your vault` : ''}</p></header>
          ${F.subs.length ? `<div class="chips br-subs pad"><button class="chip sm${!sub ? ' on' : ''}" data-act="br-sub" data-id="${id}" data-s="">All</button>${F.subs.map(([s, c]) => `<button class="chip sm${sub === s ? ' on' : ''}" data-act="br-sub" data-id="${id}" data-s="${esc(s)}">${esc(s)} <span class="n">${c}</span></button>`).join('')}</div>` : ''}
          ${pinned.length && !sub ? `<div class="sh"><h2>Pinned</h2></div><div class="group">${pinned.map((n) => noteRow(n, { folder: false })).join('')}</div>` : ''}
          <div class="sh"><h2>${sub ? esc(sub) : 'Recent'}</h2><span class="sh-count">${rest.length}</span></div>
          <div class="group br-flist">${rest.map((n) => noteRow(n, { folder: false })).join('') || `<div class="row"><span class="rbody"><span class="rtitle">Nothing here yet</span><span class="rmeta">${esc(AGENT.name)} files here as your apps log things and you tell her</span></span></div>`}</div>
          <div class="br-vfolder"></div>
          <div class="group br-open"><button class="row ic" data-act="aspect-open" data-id="${id}">${aspectTile(id)}<span class="rbody"><span class="rtitle">Open the ${esc(a.name)} app</span><span class="rmeta">${esc(a.line ?? '')}</span></span>${I.chevR}</button></div>`;
        enter($$('.br-flist .row', sc));
        fillVaultFolder(sc, id);
      };
      sc._draw = (s) => { sub = s || null; draw(); };
      sc._redraw = () => draw();
      draw();
    },
  });
  page._brain = { kind: 'folder', id };
  return page;
}
// "In your vault": the vault's notes from the domain closest to this folder (owner)
function fillVaultFolder(sc, id) {
  const slot = $('.br-vfolder', sc); if (!slot || !owner() || DEMO_MODE || !(FOLDERS[id]?.vault)) return;
  const paint = (r) => { if (!slot.isConnected || !r?.results?.length) return; slot.innerHTML = `<div class="sh"><h2>In your vault</h2><span class="sh-count">${FOLDERS[id].vault}</span>${r.offline ? '<span class="br-off">saved copy</span>' : ''}</div><div class="group">${r.results.slice(0, 8).map((x) => vaultRow(x)).join('')}</div>`; enter($$('.row', slot)); };
  const c = B.cached(`vf:${id}`); if (c) paint(c);
  B.vaultFolder(id).then(paint).catch(() => {});
}
on('br-sub', (el) => { const sc = el.closest('.scroll'); sc?._draw?.(el.dataset.s); haptic(5); });
function privatePage(id, sub = null) {
  const a = aspect(id);
  const page = push({
    title: a.name, back: 'Brain', aspect: id, cls: 'br-page',
    render(sc) {
      sc.innerHTML = `<div class="br-private"><span class="br-lock">${I.lock}</span><h1 class="t1">${esc(a.name)} is private</h1>
        <p class="sub">${FOLDERS[id]?.count ? `${FOLDERS[id].count} notes. ` : ''}They open behind Face ID, and never show on Today, Life, search or the graph until you do.</p>
        <button class="btn primary" style="--c:var(--${id}-fill)" data-act="br-unlock" data-id="${id}"${sub ? ` data-s="${esc(sub)}"` : ''}>${I.lock}Open with Face ID</button>
        <button class="btn sm br-private-app" data-act="aspect-open" data-id="${id}">Open the ${esc(a.name)} app</button></div>`;
    },
  });
  page._brain = { kind: 'private', id };
}
on('br-unlock', async (el) => {
  const id = el.dataset.id; const sub = el.dataset.s || null;
  if (!(await unlock(id))) return;
  haptic(14);
  const top = $('#stack')?.lastElementChild;
  if (top?._brain?.kind === 'private') top.remove();
  folderPage(id, sub);
});
on('br-lock', () => { lockNow(); haptic(8); toast(`${lockLabel()} locked`); });
// locking closes every private page: the top one animates away (a folder turns back into its lock), the rest go quietly
document.addEventListener('brain-locked', () => {
  const pages = $$('#stack > .page').filter((p) => p._brain && p._brain.kind !== 'private' && (B.PRIVATE.includes(p._brain.id) || p._brain.private));
  const top = $('#stack')?.lastElementChild;
  for (const p of pages) if (p !== top) p.remove();
  if (top && pages.includes(top)) { const folder = top._brain.kind === 'folder' ? top._brain.id : null; if (folder) { top.remove(); privatePage(folder); } else pop(); }
});

// ── a note ────────────────────────────────────────────────────────────
function linkedRows(n) {
  const rows = [];
  const list = n.linkList?.length ? n.linkList : Object.entries(n.links ?? {}).map(([kind, id]) => ({ kind, id }));
  for (const l of list) {
    if (l.kind === 'goal') { const g = GOALS.find((x) => String(x.id) === String(l.id)); if (g) rows.push(`<button class="row ic" data-act="br-goal" data-id="${esc(g.id)}"><span class="br-ring">${ring(g.pace ?? 0, g.aspects?.[0] ?? 'mission', 30, 4)}</span><span class="rbody"><span class="rtitle">${esc(g.title)}</span><span class="rmeta">Goal${g.verdict ? ` · ${esc(g.verdict)}` : ''}</span></span>${I.chevR}</button>`); }
    if (l.kind === 'task') { const t = TASKS.find((x) => String(x.id) === String(l.id) || String(x.id) === `t${l.id}`); if (t) rows.push(`<button class="row ic" data-act="br-task" data-id="${esc(t.id)}"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle">${esc(t.title)}</span><span class="rmeta">Task · ${esc(t.late ?? t.when ?? 'No date')}</span></span>${I.chevR}</button>`); }
    if (l.kind === 'person') { const p = person(l.id); if (p) rows.push(`<button class="row ic" data-act="br-person" data-id="${esc(p.id)}">${mono(p, 'sm')}<span class="rbody"><span class="rtitle">${esc(p.name)}</span><span class="rmeta">${esc(p.role ?? 'Person')}</span></span>${I.chevR}</button>`); }
    if (l.kind === 'project') { const p = PROJECTS.find((x) => x.slug === l.id); if (p) rows.push(`<button class="row ic" data-act="br-project" data-id="${esc(p.slug)}"><span class="tile">${I.hammer}</span><span class="rbody"><span class="rtitle">${esc(p.name)}</span><span class="rmeta">Project</span></span>${I.chevR}</button>`); }
    if (l.kind === 'vault' && owner()) rows.push(vaultRow({ id: l.id, title: l.label ?? l.id.split('/').pop().replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' '), folder: l.id.split('/')[0], summary: '' }));
    if (l.kind === 'item') { const x = note(l.id); if (x) rows.push(noteRow(x)); }
  }
  return rows.join('');
}
function notePage(id) {
  const n = note(id); if (!n) { toast('That note is gone'); return; }
  if (n.folder && isLocked(n.folder)) return privatePage(n.folder);
  const page = push({
    title: clip(n.title, 24), back: 'Back', aspect: n.folder ?? undefined, cls: 'br-page br-notepage',
    right: `<button class="gbtn chrome icon" data-act="br-note-ask" data-id="${esc(n.id)}" aria-label="Ask ${esc(AGENT.name)} about this">${I.sparkle}</button>`,
    render(sc) {
      const draw = () => {
        const x = note(id) ?? n;
        const related = NOTES.filter((r) => r.id !== x.id && !r.private && (r.folder === x.folder || (x.person && r.person === x.person))).slice(0, 3);
        const links = linkedRows(x);
        const placeWhen = `${x.day === 'today' ? `Today ${x.at}` : when(x)}${x.where ? ` · ${esc(x.where)}` : ''}`;
        sc.innerHTML = `
          <header class="phead br-note-head"><button class="kicker c-as br-crumb" data-act="${x.folder ? 'br-folder' : 'br-home'}" data-id="${x.folder ?? ''}">${esc(where(x))}</button>
            <h1 class="t1">${esc(x.title)}</h1>
            <p class="br-by"><span class="br-by-a ${x.by}" aria-hidden="true">${x.by === 'wyn' ? I.sparkle : esc(ME.initial || 'Y')}</span><span>${x.by === 'wyn' ? `${esc(AGENT.name)} filed this` : 'You saved this'} · from ${esc(x.via)}<br>${placeWhen}</span></p></header>
          ${x.auto ? `<div class="br-auto pad"><span>${I.sparkle}${esc(AGENT.name)} filed this from your inbox</span><button class="btn sm" data-act="br-unfile" data-id="${esc(x.id)}">${I.undo}Put back</button></div>` : ''}
          ${x.inbox ? `<div class="br-auto pad"><span>${I.inbox}In your inbox</span><button class="btn sm" data-act="br-in-pick" data-id="${esc(x.id)}">File</button></div>` : ''}
          <div class="br-body surface"><p>${esc(x.text || x.title)}</p><span class="br-kindtag">${KIND_ICON[x.kind] ?? I.doc}${esc(KIND_NAME[x.kind] ?? 'Note')}${x.pinned ? ` · ${I.pinF}Pinned` : ''}</span></div>
          ${links ? `<div class="sh"><h2>Linked</h2></div><div class="group">${links}</div>` : ''}
          ${related.length ? `<div class="sh"><h2>Related</h2></div><div class="group">${related.map((r) => noteRow(r, { folder: r.folder !== x.folder })).join('')}</div>` : ''}
          <div class="br-actions pad">
            <button class="btn sm" data-act="br-move" data-id="${esc(x.id)}">${I.folder}Move</button>
            <button class="btn sm" data-act="br-pin" data-id="${esc(x.id)}">${x.pinned ? I.pinF : I.pin}${x.pinned ? 'Unpin' : 'Pin'}</button>
            <button class="btn sm" data-act="br-link" data-id="${esc(x.id)}">${I.link}Link</button>
            ${x.folder ? `<button class="btn sm" data-act="aspect-open" data-id="${x.folder}">${aspectIcon[x.folder]}Open ${esc(aspect(x.folder)?.name ?? '')}</button>` : ''}
            ${B.REAL ? `<button class="btn sm br-del" data-act="br-delete" data-id="${esc(x.id)}">${I.trash}Delete</button>` : ''}</div>`;
      };
      sc._redraw = draw;
      draw();
      enter($$('.br-body, .group .row, .br-actions .btn', sc), { delay: 80 });
    },
  });
  page._brain = { kind: 'note', id, private: !!n.private };
}
on('br-unfile', (el) => { B.unfile(el.dataset.id); haptic(8); toast('Back in your inbox'); const top = $('#stack')?.lastElementChild; if (top?._brain?.kind === 'note') { top.remove(); } refreshHome(); });
on('br-in-pick', (el) => { const it = INBOX.find((x) => x.id === el.dataset.id); if (it) fileSheet(it); });
on('br-pin', (el) => { B.pinItem(el.dataset.id); haptic(6); });
on('br-delete', (el) => { const n = note(el.dataset.id); if (!n) return; const undo = B.removeItem(n.id); haptic(10); const top = $('#stack')?.lastElementChild; if (top?._brain?.id === n.id) pop(); toast(`Deleted “${clip(n.title, 28)}”`, undo); });
on('br-move', (el) => {
  const n = note(el.dataset.id); if (!n) return;
  openSheet({
    title: 'Move to', sub: esc(n.title),
    body: `<div class="br-movegrid pad">${ASPECTS.map((a) => `<button class="br-mv${a.id === n.folder ? ' on' : ''}" data-act="br-move-to" data-id="${esc(n.id)}" data-to="${a.id}">${aspectTile(a.id)}<span>${esc(a.name)}</span></button>`).join('')}</div>`,
  });
});
on('br-move-to', (el) => {
  const n = note(el.dataset.id); const to = el.dataset.to; if (!n || to === n.folder) { closeSheet(); return; }
  closeSheet(); haptic(8);
  if (!B.REAL) { const from = n.folder; n.folder = to; FOLDERS[from].count--; FOLDERS[to].count++; toast(`Moved to ${aspect(to).name}`, () => { n.folder = from; FOLDERS[from].count++; FOLDERS[to].count--; }); return; }
  const undo = B.moveItem(n.id, to);
  toast(`Moved to ${aspect(to).name}`, undo);
});
// link a note to a goal, a task, a person or a project
on('br-link', (el) => {
  const n = note(el.dataset.id); if (!n) return;
  const has_ = (k, id) => n.linkList?.some((l) => l.kind === k && String(l.id) === String(id));
  const chip = (k, id, label) => `<button class="chip sm${has_(k, id) ? ' on' : ''}" data-act="br-link-to" data-id="${esc(n.id)}" data-k="${k}" data-to="${esc(id)}" aria-pressed="${has_(k, id)}">${esc(clip(label, 30))}</button>`;
  const open = TASKS.filter((t) => t.status !== 'done').slice(0, 12);
  openSheet({
    title: 'Link to', sub: esc(n.title), large: true,
    body: `<div class="pad br-linkp">
      ${PEOPLE.length ? `<p class="br-fam">People</p><div class="chips">${PEOPLE.filter((p) => !isLocked(p.aspect)).map((p) => chip('person', p.id, p.name)).join('')}</div>` : ''}
      ${GOALS.length ? `<p class="br-fam">Goals</p><div class="chips">${GOALS.map((g) => chip('goal', g.id, g.title)).join('')}</div>` : ''}
      ${PROJECTS.length ? `<p class="br-fam">Projects</p><div class="chips">${PROJECTS.map((p) => chip('project', p.slug, p.name)).join('')}</div>` : ''}
      ${open.length ? `<p class="br-fam">Open tasks</p><div class="chips">${open.map((t) => chip('task', t.id, t.title)).join('')}</div>` : ''}</div>`,
  });
});
on('br-link-to', (el) => {
  const on_ = el.getAttribute('aria-pressed') !== 'true';
  if (B.REAL) B.linkItem(el.dataset.id, { kind: el.dataset.k, id: el.dataset.to }, on_);
  el.classList.toggle('on', on_); el.setAttribute('aria-pressed', String(on_)); haptic(5);
});
on('br-note-ask', (el) => { const n = note(el.dataset.id); api.askAgent(n ? `About "${n.title}"` : '', { aspect: n?.folder, about: n?.id }); });
// a page that's open redraws when the Brain changes under it
function refreshOpenPages(why) {
  for (const p of $$('#stack > .page')) {
    const sc = $('.scroll', p);
    if (p._brain?.kind === 'note' || p._brain?.kind === 'folder') sc?._redraw?.();
    if (p._brain?.kind === 'person' && why !== 'summary') sc?._redraw?.();
  }
}

// ── a vault note (owner): read-only, its links in and out ─────────────
function mdLite(md) {
  // headings, lists, bold, code and [[wikilinks]] (tappable): enough to read a vault note, nothing it can't show
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_, id, label) => `<button class="br-wl" data-act="br-vnote" data-id="${esc(id.trim())}">${esc(label ?? id.split('/').pop().replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/-/g, ' '))}</button>`);
  const out = []; let list = null;
  for (const line of String(md ?? '').split(/\r?\n/)) {
    const t = line.trim();
    const li = /^[-*]\s+(.*)$/.exec(t) || /^\d+\.\s+(.*)$/.exec(t);
    if (li) { (list ??= []).push(`<li>${inline(li[1])}</li>`); continue; }
    if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (!t) continue;
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) out.push(`<h3>${inline(h[2])}</h3>`); else if (t.startsWith('>')) out.push(`<blockquote>${inline(t.replace(/^>\s?/, ''))}</blockquote>`); else if (!/^\|?-{3,}/.test(t)) out.push(`<p>${inline(t)}</p>`);
  }
  if (list) out.push(`<ul>${list.join('')}</ul>`);
  return out.join('');
}
function vaultNotePage(id) {
  if (!owner()) { toast("That's the owner's vault"); return; }
  const page = push({
    title: 'Vault', back: 'Back', cls: 'br-page br-vpage',
    right: `<button class="gbtn chrome icon" data-act="br-vsave" data-id="${esc(id)}" aria-label="Keep in your Brain">${I.pin}</button>`,
    render(sc) {
      const paint = (r) => {
        if (!sc.isConnected) return;
        if (!r?.ok) { sc.innerHTML = `<div class="br-private"><span class="br-lock">${I.book}</span><h1 class="t1">Not in your vault</h1><p class="sub">${esc(r?.error ?? 'The vault has no note with that id.')}</p></div>`; return; }
        const nt = r.note;
        const links = [...(r.outbound ?? []), ...(r.inbound ?? []).map((x) => ({ ...x, in: true }))].filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
        sc.innerHTML = `<header class="phead br-note-head"><p class="kicker br-vkick"><i class="br-vdot" aria-hidden="true"></i>${esc([VFOLDER[nt.id.split('/')[0]] ?? nt.kind, VDOMAIN[nt.domain] ?? nt.domain].filter(Boolean).join(' · '))}</p>
            <h1 class="t1">${esc(nt.title)}</h1><p class="br-by"><span class="br-by-a vault" aria-hidden="true">${I.book}</span><span>In your vault${nt.updated ? ` · updated ${esc(dayOf(nt.updated))}` : ''}${r.offline ? ' · saved copy' : ''}<br>${esc(nt.id)}</span></p></header>
          ${nt.summary ? `<p class="br-vsum pad">${esc(nt.summary)}</p>` : ''}
          <article class="br-body br-md surface">${mdLite(r.body)}</article>
          ${links.length ? `<div class="sh"><h2>Connected</h2><span class="sh-count">${links.length}</span></div><div class="group">${links.slice(0, 16).map((l) => `<button class="row ic br-vrow" data-act="br-vnote" data-id="${esc(l.id)}"><span class="tile br-kind br-vk" aria-hidden="true">${l.in ? I.undo : I.link}</span><span class="rbody"><span class="rtitle">${esc(l.title)}</span><span class="br-meta">${esc([l.in ? 'Links here' : 'Links to', l.edge, VFOLDER[l.id.split('/')[0]]].filter(Boolean).join(' · '))}</span></span>${I.chevR}</button>`).join('')}</div>` : ''}
          <p class="hint">Read from your brain vault through the brain CLI. Edit it on the PC.</p>`;
        enter($$('.br-md > *, .group .row', sc), { each: 18, max: 260 });
      };
      sc.innerHTML = `<div class="br-loading pad"><span class="br-skel w60"></span><span class="br-skel w90"></span><span class="br-skel w80"></span><span class="br-skel w70"></span></div>`;
      const c = B.cached(`vn:${id}`); if (c) paint(c);
      B.vaultNote(id).then(paint).catch((e) => { if (!c) paint({ ok: false, error: e.status === 404 ? 'The vault has no note with that id.' : "Your PC didn't answer. The vault opens when it's back." }); });
    },
  });
  page._brain = { kind: 'vault', id };
}
// keep a vault note in the app's Brain: a note in the folder its domain sits closest to, linked to the vault note
on('br-vsave', (el) => {
  const r = B.cached(`vn:${el.dataset.id}`); const nt = r?.note;
  if (!nt) { toast('Open it once online first'); return; }
  const n = B.addItem({ text: nt.summary || nt.title, title: nt.title, aspect: nt.aspect ?? 'mission', by: 'you', via: 'vault', links: [{ kind: 'vault', id: nt.id, label: nt.title }] });
  haptic(10); toast(`Kept in ${aspect(n?.folder ?? 'mission')?.name ?? 'your Brain'}`, n ? () => { B.removeItem(n.id); } : undefined);
});
function vaultBrowsePage({ domain = null, kind = null } = {}) {
  if (!owner()) return;
  push({
    title: domain ? VDOMAIN[domain] ?? domain : kind ? VFOLDER[kind] ?? kind : 'Vault', back: 'Brain', cls: 'br-page',
    render(sc) {
      const head = `<header class="phead"><p class="kicker br-vkick"><i class="br-vdot" aria-hidden="true"></i>Your vault</p><h1 class="lt">${esc(domain ? VDOMAIN[domain] ?? domain : kind ? VFOLDER[kind] ?? kind : 'Vault')}</h1><p class="sub">${VAULT.notes ?? ''} notes on your PC, newest first. Read-only.</p></header>
        <div class="chips pad br-vkinds">${(VAULT.folders ?? []).map((f) => `<button class="chip sm${kind === f.id ? ' on' : ''}" data-act="br-vbrowse" data-kind="${esc(f.id)}">${esc(VFOLDER[f.id] ?? f.id)} <span class="n">${f.count}</span></button>`).join('')}</div>`;
      const paint = (r) => { if (!sc.isConnected) return; sc.innerHTML = `${head}<div class="group br-vlist">${(r?.results ?? []).map((x) => vaultRow(x)).join('') || `<div class="row"><span class="rbody"><span class="rtitle">Nothing here</span></span></div>`}</div>`; enter($$('.br-vlist .row', sc), { each: 16 }); };
      sc.innerHTML = `${head}<div class="br-loading pad"><span class="br-skel w90"></span><span class="br-skel w70"></span><span class="br-skel w80"></span></div>`;
      const key = new URLSearchParams(Object.entries({ domain, kind }).filter(([, v]) => v));
      const c = B.cached(`vb:${key}`); if (c) paint(c);
      B.vaultBrowse({ domain, kind, limit: 80 }).then(paint).catch(() => { if (!c) paint({ results: [] }); });
    },
  });
}
on('br-vault', () => vaultBrowsePage({ kind: 'journal' }));
on('br-vbrowse', (el) => { const top = $('#stack')?.lastElementChild; if (el.closest('.br-vkinds') && top) top.remove(); vaultBrowsePage({ domain: el.dataset.domain || null, kind: el.dataset.kind || null }); });
on('br-vnote', (el) => vaultNotePage(el.dataset.id));
// the one vault write: `brain capture`, only when he asks here
on('br-vcapture', () => {
  openSheet({
    title: 'Save to your vault', sub: "A thought for the vault's capture inbox. You file it properly on the PC later.",
    body: `<div class="pad br-addp"><label class="field"><textarea rows="3" placeholder="What should the vault keep?" aria-label="Thought"></textarea></label>
      <button class="btn primary block" data-act="br-vcapture-save">Save to the vault</button></div>`,
  });
  setTimeout(() => $('.sheet.in textarea, .sheet:last-of-type textarea')?.focus(), 380);
});
on('br-vcapture-save', async (el) => {
  const sh = el.closest('.sheet'); const v = $('textarea', sh)?.value.trim(); if (!v) return;
  el.disabled = true;
  try { await B.vaultCapture(v); closeSheet(sh); haptic(12); toast('Saved to your vault'); }
  catch (e) { el.disabled = false; toast(e.status ? `The vault said no: ${e.message}` : "Your PC isn't reachable; try again when it is"); }
});

// ── a person's file ───────────────────────────────────────────────────
const FACT_KEYS = { family: ['Relation', 'Birthday', 'Anniversary'], friends: ['Known since', 'Birthday', 'Usually'], romance: ['Birthday', 'Anniversary'] };
function personPage(id) {
  const p = person(id); if (!p) return brainHome();
  if (isLocked(p.aspect)) return privatePage(p.aspect);
  const app = aspectDef(p.aspect);
  const page = push({
    title: p.name, back: 'Brain', aspect: p.aspect, cls: 'br-page br-pfile',
    render(sc) {
      let remote = B.cached(`p:${id}`);
      const draw = () => {
        const F = PERSON_FILE[id] ?? { facts: [], tasks: [], goals: [] };
        const have = new Map(F.facts.map(([k, v]) => [String(k).toLowerCase(), v]));
        const keys = [...F.facts.map((f) => f[0]), ...(FACT_KEYS[p.aspect] ?? FACT_KEYS.friends).filter((k) => !have.has(k.toLowerCase()))];
        const moments = notesAbout(id);
        const tasks = [...new Set([...F.tasks, ...TASKS.filter((t) => t.status !== 'done' && new RegExp(`\\b${p.name}\\b`, 'i').test(t.title)).map((t) => t.id)])];
        const v = remote?.vault;
        sc.innerHTML = `
          <header class="br-phead">${mono(p, 'xl')}<h1 class="lt">${esc(p.name)}</h1><p class="sub">${esc(p.role ?? '')}</p>
            <p class="br-last"><span>${DEMO_MODE ? 'Last together' : 'In your Brain'}</span><b>${esc(DEMO_MODE ? p.last : `${moments.length} note${moments.length === 1 ? '' : 's'}${moments[0] ? ` · last ${when(moments[0])}` : ''}`)}</b></p>
            <div class="br-phead-a">${app?.person ? `<button class="btn sm" data-act="br-open-app-person" data-id="${esc(id)}">${aspectIcon[p.aspect]}Open in ${esc(aspect(p.aspect).name)}</button>` : `<button class="btn sm" data-act="aspect-open" data-id="${p.aspect}">${aspectIcon[p.aspect]}${esc(aspect(p.aspect).name)}</button>`}
              <button class="btn sm" data-act="br-person-ask" data-id="${esc(id)}">${I.sparkle}Ask ${esc(AGENT.name)}</button></div></header>
          <div class="sh"><h2>Facts</h2></div>
          <div class="group br-facts">${keys.map((k) => { const val = have.get(String(k).toLowerCase()); return `<div class="row br-fact"><span class="br-fact-k">${esc(k)}</span>${val ? `<button class="br-fact-v" data-act="br-fact-add" data-k="${esc(k)}" data-id="${esc(id)}" data-v="${esc(val)}">${esc(val)}</button>` : `<button class="chip sm br-fact-add" data-act="br-fact-add" data-k="${esc(k)}" data-id="${esc(id)}">${I.plus}Add</button>`}</div>`; }).join('')}
            <div class="row br-fact"><button class="chip sm br-fact-add" data-act="br-fact-add" data-k="" data-id="${esc(id)}">${I.plus}Another fact</button></div></div>
          <div class="sh"><h2>Moments and notes</h2><span class="sh-count">${moments.length}</span></div>
          <div class="group br-moments">${moments.length ? moments.map((m) => `<button data-act="br-note" data-id="${esc(m.id)}" class="row br-mo"><i class="br-mo-dot" aria-hidden="true"></i><span class="rbody"><span class="rtitle wrap">${esc(m.title)}</span><span class="rmeta">${esc(when(m))} · ${esc(who(m))} · ${esc(m.via)}</span></span></button>`).join('') : `<div class="row"><span class="rbody"><span class="rtitle">Nothing yet</span><span class="rmeta">Tell ${esc(AGENT.name)} when you see ${esc(p.name)}; she files it here</span></span></div>`}</div>
          ${tasks.length || F.goals.length ? `<div class="sh"><h2>Linked</h2></div><div class="group">${linkedRows({ linkList: [...tasks.map((t) => ({ kind: 'task', id: t })), ...F.goals.map((g) => ({ kind: 'goal', id: g }))] })}</div>` : ''}
          ${owner() && !DEMO_MODE ? `<div class="br-pvault">${v?.entity ? `<div class="sh"><h2>In your vault</h2>${remote.offline ? '<span class="br-off">saved copy</span>' : ''}</div>
            <div class="group"><button class="row ic br-vrow" data-act="br-vnote" data-id="${esc(v.entity.id)}"><span class="tile br-kind br-vk" aria-hidden="true">${I.people}</span><span class="rbody"><span class="rtitle">${esc(v.entity.title)}</span><span class="br-snip">${esc(v.entity.summary)}</span><span class="br-meta"><i class="br-vdot" aria-hidden="true"></i>Vault · Entity${v.entity.updated ? ` · ${esc(dayOf(v.entity.updated))}` : ''}</span></span></button>
            ${(v.notes ?? []).slice(0, 6).map((x) => `<button class="row ic br-vrow" data-act="br-vnote" data-id="${esc(x.id)}"><span class="tile br-kind br-vk" aria-hidden="true">${x.id.startsWith('journal/') ? I.edit : I.book}</span><span class="rbody"><span class="rtitle">${esc(x.title)}</span><span class="br-meta">${esc([x.edge === 'about' ? 'About them' : 'Linked', VFOLDER[x.id.split('/')[0]]].filter(Boolean).join(' · '))}</span></span>${I.chevR}</button>`).join('')}</div>` : remote ? '' : `<div class="br-loading pad"><span class="br-skel w80"></span><span class="br-skel w60"></span></div>`}</div>` : ''}
          <p class="hint">This is ${esc(p.name)}'s file in your Brain. ${esc(AGENT.name)} reads it before she drafts anything about them, and only you see it.</p>`;
      };
      sc._redraw = draw;
      draw();
      enter($$('.br-fact, .br-mo', sc), { delay: 100 });
      if (B.REAL) B.personRemote(id).then((r) => { remote = r; if (sc.isConnected) { draw(); enter($$('.br-pvault .row', sc)); } }).catch(() => {});
    },
  });
  page._brain = { kind: 'person', id, private: B.PRIVATE.includes(p.aspect) };
}
function peoplePage(rel = null) {
  push({
    title: 'People', back: 'Brain', cls: 'br-page',
    render(sc) {
      const groups = [['family', 'Family'], ['friend', 'Friends'], ['other', 'Others']].filter(([r]) => !rel || r === rel || `${r}s` === rel);
      const of = (r) => PEOPLE.filter((p) => !isLocked(p.aspect) && (r === 'other' ? !['family', 'friend'].includes(p.rel) : p.rel === r));
      sc.innerHTML = `<header class="phead"><h1 class="lt">People</h1><p class="sub">A file for everyone who matters. ${esc(AGENT.name)} keeps them current from what you tell her.</p></header>
        ${groups.filter(([r]) => of(r).length).map(([r, label]) => `<div class="sh"><h2>${label}</h2></div><div class="group">${of(r).map((p) => `<button class="row ic br-prow" data-act="br-person" data-id="${esc(p.id)}">${mono(p, 'sm')}<span class="rbody"><span class="rtitle">${esc(p.name)}</span><span class="rmeta">${esc(p.role ?? '')}</span><span class="rmeta">${esc(DEMO_MODE ? `Last together: ${p.last}` : lastAbout(p.id))}</span></span>${I.chevR}</button>`).join('')}</div>`).join('')}
        <div class="group br-add-row"><button class="row ic" data-act="br-add-person"><span class="tile">${I.plus}</span><span class="rbody"><span class="rtitle">Add someone</span><span class="rmeta">A classmate at City College, someone you met at an event</span></span>${I.chevR}</button></div>`;
      enter($$('.br-prow', sc));
    },
  });
}
// a new person belongs to People (their app adds them); without it, the Brain keeps a note for the agent to set up
on('br-add-person', () => {
  if (has('addPerson')) return api.addPerson({ from: 'brain' });
  openSheet({
    title: `Who should ${esc(AGENT.name)} know?`, sub: 'A name and where you met is enough. She starts their file and asks you the rest over time.',
    body: `<div class="pad br-addp"><label class="field"><input type="text" placeholder="Name" aria-label="Name" enterkeyhint="next" /></label>
      <label class="field"><input type="text" placeholder="Where you met, e.g. the City College fest" aria-label="Where you met" enterkeyhint="done" /></label>
      <div class="chips"><button class="chip sm" data-act="br-addp-kind" data-k="friends">Friend</button><button class="chip sm" data-act="br-addp-kind" data-k="family">Family</button><button class="chip sm" data-act="br-addp-kind" data-k="other">Someone new</button></div>
      <button class="btn primary block" data-act="br-addp-save">Start their file</button></div>`,
  });
});
on('br-addp-kind', (el) => { $$('.chip', el.parentElement).forEach((c) => c.classList.toggle('on', c === el)); haptic(5); });
on('br-addp-save', (el) => {
  const sh = el.closest('.sheet'); const [nm, met] = $$('input', sh).map((i) => i.value.trim()); const k = $('.chip.on', sh)?.dataset.k;
  closeSheet(sh);
  if (!nm) { toast(`Tell ${AGENT.name} their name when you meet them`); return; }
  // adding a person reaches someone new: it waits in the inbox for him (DECISIONS 2), the People app makes the person
  remember(`New person to add: ${nm}${met ? `, met at ${met}` : ''}.`, { aspect: k && k !== 'other' ? k : null, by: 'you', via: 'typed', title: `Add ${nm}`, inbox: true, quiet: true });
  toast(`Started a note for ${nm}; ${AGENT.name} sets up their file`);
});
on('br-fact-add', (el) => {
  const p = person(el.dataset.id); if (!p) return;
  const k = el.dataset.k;
  openSheet({
    title: k ? `${esc(p.name)}: ${esc(k.toLowerCase())}` : `A fact about ${esc(p.name)}`, sub: `Only you see this. ${esc(AGENT.name)} uses it for reminders.`,
    body: `<div class="pad br-addp">${k ? '' : `<label class="field"><input type="text" class="br-fk" placeholder="What, e.g. Works at" aria-label="Fact" /></label>`}<label class="field"><input type="text" class="br-fv" value="${esc(el.dataset.v ?? '')}" placeholder="${/Birthday|Anniversary/.test(k) ? 'e.g. 14 March' : 'Type it'}" aria-label="${esc(k || 'Value')}" /></label>
      <button class="btn primary block" data-act="br-fact-save" data-k="${esc(k)}" data-id="${esc(p.id)}">Save</button></div>`,
  });
});
on('br-fact-save', (el) => {
  const sh = el.closest('.sheet'); const v = $('.br-fv', sh)?.value.trim(); const k = el.dataset.k || $('.br-fk', sh)?.value.trim(); closeSheet(sh);
  if (!v || !k) return;
  B.setFact(el.dataset.id, k, v); haptic(8);
  toast(`Saved to ${person(el.dataset.id).name}'s file`);
  const top = $('#stack')?.lastElementChild; if (top?._brain?.kind === 'person') $('.scroll', top)?._redraw?.();
});
on('br-person-ask', (el) => { const p = person(el.dataset.id); api.askAgent('', { aspect: p.aspect, about: p.id }); });
on('br-open-app-person', (el) => { const p = person(el.dataset.id); aspectDef(p.aspect)?.person?.(p.id); });

// openPerson: the person's own app has the richer page (Family, Friends); the Brain file is the fallback
function openPerson(id) {
  const p = person(id); if (!p) { toast('No file for that person yet'); return; }
  const def = aspectDef(p.aspect);
  if (def?.person) { try { return def.person(id); } catch (e) { console.warn('[brain] person page failed', id, e); } }
  personPage(id);
}
provide('openPerson', openPerson);

// ── search: by words, meaning, time and place; the answer, its sources, and the vault beside it ──────────────
const PLACE_CHIPS = [['any', 'Anywhere'], ...Object.entries(PLACES).map(([k, v]) => [k, v.label])];
function answerCard(a, { local = false, read = 0 } = {}) {
  if (!a) return '';
  return `<div class="br-answer surface${local ? ' local' : ''}"><p class="br-ans-k">${I.sparkle}<span>${esc(AGENT.name)}</span><small>${local ? 'on this phone' : `${read} note${read === 1 ? '' : 's'} read`}</small></p><p class="br-ans">${esc(a.text)}</p>
    ${a.sources?.length ? `<div class="br-src">${a.sources.slice(0, 3).map((s, i) => `<button class="br-src-c" data-act="${s.kind === 'vault' ? 'br-vnote' : 'br-note'}" data-id="${esc(s.id)}"><b class="met">${i + 1}</b>${esc(clip(s.title, 22))}</button>`).join('')}</div>` : ''}</div>`;
}
function vaultAnswer(v) {
  if (!v?.answer) return '';
  const a = v.answer;
  return `<div class="br-answer br-vans surface"><p class="br-ans-k">${I.book}<span>Your vault</span><small>${esc(v.mode === 'hybrid' ? 'by meaning and words' : 'by words')}${a.similarity ? ` · ${Math.round(a.similarity * 100)}% close` : ''}</small></p>
    <button class="br-vans-t" data-act="br-vnote" data-id="${esc(a.id)}">${esc(a.title)}${I.chevR}</button>
    ${a.evidence ? `<p class="br-ans br-evid">${esc(clip(a.evidence, 260))}</p>` : ''}
    ${a.also?.length ? `<div class="br-src">${a.also.slice(0, 3).map((s, i) => `<button class="br-src-c" data-act="br-vnote" data-id="${esc(s.id)}"><b class="met">${i + 1}</b>${esc(clip(s.title, 22))}</button>`).join('')}</div>` : ''}</div>`;
}
function searchPage(q0 = '', o = {}) {
  const st = { q: q0, when: o.when ?? 'any', place: o.place ?? 'any', remote: null, seq: 0, busy: false };
  const page = push({
    title: 'Search', back: 'Brain', cls: 'br-page br-searchpage',
    render(sc) {
      sc.innerHTML = `<div class="br-qrow pad"><label class="field br-q">${I.search}<input type="search" enterkeyhint="search" placeholder="Ask, or search by person, place, day" value="${esc(q0)}" aria-label="Search your Brain" /></label></div>
        <div class="chips br-filt pad" data-f="when">${WHEN.map(([k, l]) => `<button class="chip sm${k === st.when ? ' on' : ''}" data-act="br-filt" data-f="when" data-k="${k}">${l}</button>`).join('')}</div>
        <div class="chips br-filt pad" data-f="place">${PLACE_CHIPS.map(([k, l]) => `<button class="chip sm${k === st.place ? ' on' : ''}" data-act="br-filt" data-f="place" data-k="${k}">${l}</button>`).join('')}</div>
        <div class="br-results" aria-live="polite"></div>`;
      const input = $('input', sc);
      const pool = () => NOTES.filter((n) => !isLocked(n.folder));
      const draw = (animate = false) => {
        const loc = localSearch(pool(), st.q, st);
        if (st._auto !== st.q && loc.parsed) { st._auto = st.q; if (loc.parsed.when && st.when === 'any') st.when = loc.parsed.when; if (loc.parsed.place && st.place === 'any') st.place = loc.parsed.place; sync(); }
        const R = st.remote && st.remote.q === st.q ? st.remote : null;
        const hits = R ? R.items.map((h) => ({ n: note(h.id) ?? B.viewOf(h.item), title: h.title, snip: h.snip })).filter((h) => h.n && !isLocked(h.n.folder)) : loc.hits;
        const hasQ = st.q.trim() || st.when !== 'any' || st.place !== 'any';
        const localAns = !R && hasQ ? { text: hits.length ? `${hits.length} thing${hits.length === 1 ? '' : 's'} on this phone${st.q.trim() ? ` for “${clip(st.q.trim(), 40)}”` : ''}. The closest is “${hits[0].n.title}”.` : `Nothing on this phone matches yet${B.REAL ? '; asking your PC…' : '.'}`, sources: hits.slice(0, 3).map((h) => ({ kind: 'item', id: h.n.id, title: h.n.title })) } : null;
        const vr = R?.vault?.results?.filter((x) => !R.items.some((h) => h.item?.links?.some((l) => l.kind === 'vault' && l.id === x.id))) ?? [];
        const list = hasQ ? hits.map((h) => h.n) : NOTES.filter((n) => !isLocked(n.folder));
        $('.br-results', sc).innerHTML = `
          ${R ? answerCard(R.answer, { read: R.count }) : answerCard(localAns, { local: true })}
          ${R ? vaultAnswer(R.vault) : st.busy && owner() && st.q.trim() ? `<div class="br-answer br-vans surface br-wait"><p class="br-ans-k">${I.book}<span>Your vault</span><small>reading…</small></p><span class="br-skel w90"></span><span class="br-skel w70"></span></div>` : ''}
          ${st.when === 'today' ? dayStrip(list) : ''}
          <div class="sh"><h2>${hasQ ? 'Notes' : 'Everything'}</h2><span class="sh-count">${list.length}</span>${R?.mode === 'hybrid' ? '<span class="br-mode">by meaning</span>' : ''}</div>
          <div class="group br-rlist">${(hasQ ? hits : list.map((n) => ({ n }))).slice(0, 60).map((h) => noteRow(h.n, { hit: h.title ? h : null })).join('') || `<div class="row"><span class="rbody"><span class="rtitle">Nothing with these filters</span><span class="rmeta">Try any time or anywhere</span></span></div>`}</div>
          ${vr.length ? `<div class="sh"><h2>In your vault</h2><span class="sh-count">${vr.length}</span></div><div class="group br-vres">${vr.map((x) => vaultRow(x, { marks: x.marks, tmarks: x.tmarks })).join('')}</div>` : ''}`;
        if (animate) { const a = $$('.br-answer', sc); a.forEach((el) => el.animate?.([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: reduced() ? 0 : 260, easing: 'cubic-bezier(.22,1,.36,1)' })); enter($$('.br-rlist .row, .br-vres .row, .br-src-c', sc), { each: 22, max: 240 }); }
      };
      const sync = () => $$('.br-filt', sc).forEach((row) => $$('.chip', row).forEach((c) => c.classList.toggle('on', c.dataset.k === st[row.dataset.f])));
      let t = 0;
      const ask = () => {
        clearTimeout(t);
        if (!B.REAL) return;
        const q = st.q;
        if (!q.trim() && st.when === 'any' && st.place === 'any') { st.remote = null; st.busy = false; return; }
        st.busy = true;
        t = setTimeout(async () => {
          const my = ++st.seq;
          try { const r = await B.searchRemote(q || (st.when !== 'any' ? st.when : ''), { when: st.when, place: st.place, private: false }); if (my !== st.seq || !sc.isConnected) return; st.remote = { ...r, q }; st.busy = false; draw(true); }
          catch { if (my !== st.seq) return; st.busy = false; draw(); }
        }, 280);
      };
      sc._st = st; sc._run = () => { draw(); ask(); }; sc._sync = sync;
      input.addEventListener('input', () => { st.q = input.value; st._auto = null; draw(); ask(); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
      draw(true); ask();
      if (!q0) setTimeout(() => input.focus({ preventScroll: true }), 420);
    },
  });
  page._brain = { kind: 'search' };
}
// by time: the day as a strip, each saved thing at its time, now as a line
function dayStrip(list) {
  const pos = (n) => { const m = (n.ms - clock.dayStart(clock.today())) / 60000; return Math.max(0, Math.min(1, m / 1440)); };
  const items = list.filter((n) => n.day === 'today').sort((a, b) => a.ms - b.ms);
  const lanes = [];
  const placed = items.map((n) => { const x = pos(n); let lane = 0; while (lanes[lane] != null && x - lanes[lane] < 0.04) lane++; lanes[lane] = x; return { n, x, lane: Math.min(lane, 2) }; });
  const dy = [0, -15, 15];
  const now = Math.max(0, Math.min(1, clock.minutes() / 1440));
  return `<div class="br-strip surface" role="img" aria-label="${items.length} things saved today">
    <div class="br-strip-l">${placed.map(({ n, x, lane }) => `<i class="br-strip-d${n.by === 'wyn' ? '' : ' you'}" style="left:${(x * 100).toFixed(1)}%;--dy:${dy[lane]}px;--c:var(--${n.folder})"></i>`).join('')}<i class="br-strip-now" style="left:${(now * 100).toFixed(1)}%"></i></div>
    <div class="br-strip-x"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
    <p class="br-strip-k"><span><i class="br-strip-d"></i>${esc(AGENT.name)}</span><span><i class="br-strip-d you"></i>You</span></p></div>`;
}
on('br-filt', (el) => { const sc = el.closest('.scroll'); const st = sc?._st; if (!st) return; st[el.dataset.f] = el.dataset.k; st.remote = null; sc._sync(); sc._run(); haptic(5); });

// ── the graph: MOTION's engine on the live Brain ──────────────────────
function graphPage() {
  const st = { filter: 'all', sel: null, g: null, vault: owner() ? B.cached('vg') : null };
  const page = push({
    title: 'Graph', back: 'Brain', cls: 'br-page br-graphpage',
    render(sc) {
      sc.innerHTML = `<header class="phead"><h1 class="lt">Graph</h1><p class="sub">Your Brain the way the wheel sees it: each folder on its spoke, everything that ties to it close by${owner() && !DEMO_MODE ? ', and your vault as rings' : ''}.</p></header>
        <div class="chips pad br-gfilt">${GFILT.filter(([k]) => k !== 'vault' || (owner() && !DEMO_MODE)).map(([k, l]) => `<button class="chip sm${st.filter === k ? ' on' : ''}" data-act="br-gfilt" data-k="${k}">${l}</button>`).join('')}</div>
        <div class="br-graphwrap"><div class="br-ghost" aria-label="Your Brain as a graph"></div></div>
        <div class="br-gcard-slot"><p class="foot br-ghint">Tap a dot to see what it connects to. Pinch to zoom.</p></div>`;
      const host = $('.br-ghost', sc);
      const model = () => graphModel({ filter: st.filter, vault: st.vault });
      requestAnimationFrame(() => {
        const m = model();
        st.g = mountGraph(host, { nodes: m.nodes, links: m.links, capture: 'card', label: 'Your Brain', padding: 26, minZoom: 0.3, maxZoom: 4, onTap: (n) => { st.sel = n?.id ?? null; paintCard(sc, st); if (n) haptic(6); } });
        refit();
      });
      // once the layout has spread out, frame all of it (new nodes push the edges out after the first fit)
      let fitT = 0;
      const refit = () => { clearTimeout(fitT); fitT = setTimeout(() => { if (sc.isConnected && !st.sel) st.g?.zoomTo('fit'); }, 1500); };
      sc._g = st;
      sc._draw = () => { st.g?.update(model(), { reheat: 0.45, fit: true }); st.sel = null; paintCard(sc, st); refit(); };
      if (owner() && B.REAL) B.vaultGraph().then((v) => { if (!v?.nodes || !sc.isConnected) return; st.vault = v; st.g?.update(model(), { reheat: 0.4, fit: true }); refit(); }).catch(() => {});
    },
    onPop() { st.g?.destroy(); },
  });
  page._brain = { kind: 'graph' };
}
function paintCard(sc, st) {
  const slot = $('.br-gcard-slot', sc); if (!slot) return;
  const m = graphModel({ filter: st.filter, vault: st.vault });
  const n = st.sel && m.nodes.find((x) => x.id === st.sel);
  if (!n) { slot.innerHTML = `<p class="foot br-ghint">Tap a dot to see what it connects to. Pinch to zoom.</p>`; return; }
  const info = nodeInfo(n);
  const near = m.links.filter((l) => l.source === n.id || l.target === n.id).map((l) => m.nodes.find((x) => x.id === (l.source === n.id ? l.target : l.source))).filter((x) => x && x.kind !== 'hub');
  slot.innerHTML = `<div class="br-gcard surface">
    <div class="br-gcard-h">${info.group ? `<i class="dot" style="--c:var(--${info.group})"></i>` : ''}<span class="br-gcard-b"><span class="br-gcard-t">${esc(n.label)}</span><span class="br-gcard-s">${esc(info.kind)} · ${near.length} link${near.length === 1 ? '' : 's'}</span></span>
      <button class="btn sm" data-act="${info.open[0]}" data-id="${esc(info.open[1])}">${info.open[2]}</button></div>
    ${near.length ? `<div class="br-gcard-l">${near.slice(0, 6).map((l) => `<button class="chip sm" data-act="br-gsel" data-id="${esc(l.id)}">${l.group ? `<i class="dot" style="--c:var(--${l.group})"></i>` : ''}${esc(clip(l.label, 24))}</button>`).join('')}${near.length > 6 ? `<span class="br-gcard-more">${near.length - 6} more</span>` : ''}</div>` : ''}
  </div>`;
}
on('br-gsel', (el) => { const sc = el.closest('.scroll'); const st = sc?._g; if (!st) return; st.sel = el.dataset.id; st.g?.focus(st.sel); haptic(6); paintCard(sc, st); });
on('br-gfilt', (el) => { const sc = el.closest('.scroll'); const st = sc?._g; if (!st) return; st.filter = el.dataset.k; $$('.br-gfilt .chip', sc).forEach((c) => c.classList.toggle('on', c === el)); haptic(5); sc._draw(); });

// ── routing: openBrain(path) ──────────────────────────────────────────
function openBrain(path = '') {
  const p = String(path ?? '').replace(/^\/+|\/+$/g, '');
  if (!p) return brainHome();
  if (p === 'inbox') return brainHome({ focus: 'inbox' });
  if (p === 'graph') return graphPage();
  if (p === 'today') return searchPage('', { when: 'today' });
  if (p === 'people') return peoplePage();
  if (p.startsWith('search')) return searchPage(decodeURIComponent(p.split('=').slice(1).join('=') ?? ''));
  if (p.startsWith('note/') || p.startsWith('notes/')) return notePage(decodeURIComponent(p.replace(/^notes?\//, '')));
  if (p === 'vault') return vaultBrowsePage({ kind: 'journal' });
  if (p.startsWith('vault/')) return vaultNotePage(decodeURIComponent(p.slice(6)));
  const parts = p.split('/');
  if (parts[0] === 'people') {
    const id = parts[2] ?? (person(parts[1]) ? parts[1] : null);
    return id ? personPage(id) : peoplePage(parts[1] ?? null);
  }
  if (FOLDERS[parts[0]]) return folderPage(parts[0], parts[1] ? decodeURIComponent(parts[1]) : null);
  return brainHome();
}
provide('openBrain', openBrain);
// agenticos://vault/<id> (Spotlight, the agent's links) opens a vault note; the owner's only
try { registerRoute('vault', (L, c) => { c.tab('life'); c.after(() => openBrain(L.parts.length > 1 ? `vault/${L.parts.slice(1).join('/')}` : 'vault')); }, { owner: true }); } catch (e) { console.warn('[brain] route', e); }

on('br-home', () => openBrain());
on('br-search', () => searchPage(''));
on('br-ask', (el) => { const q = el.dataset.q; if (/^this week$/i.test(q)) return searchPage('', { when: 'week' }); if (/^what did i save today\??$/i.test(q)) return searchPage(q, { when: 'today' }); searchPage(q); });
on('br-voice', () => api.openCapture('voice', { ask: true }));
on('br-graph', () => graphPage());
on('br-people', () => peoplePage());
on('br-person', (el) => personPage(el.dataset.id));
on('br-folder', (el) => folderPage(el.dataset.id));
on('br-note', (el) => notePage(el.dataset.id));
on('br-goal', (el) => api.openGoal(el.dataset.id));
on('br-task', (el) => api.openTask(el.dataset.id));
on('br-project', (el) => api.openProject(el.dataset.id));

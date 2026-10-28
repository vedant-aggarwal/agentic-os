// Share-in: what happens when you share something into Agentic OS from another app (the iOS share extension).
// The other app, the share sheet, then our extension: what it got, what the agent thinks it is, where it'll go (often two
// places), an optional note, Save. Anything she can't place goes to the Brain inbox. Inbox items reopen here to be filed.
// Owner: CAPTURE. capture.js provides it on the bus as openShareIn(sample).
// v2, real mode: the iPhone's share extension posts to the PC (/mod/scan/share), which files it the moment it arrives
// (DECISIONS 2: reels and links to Content ideas, text through say-it-once, documents to the Brain; the nine apps' kinds
// wait for the lens). openShareIn(<scan id>) shows what she made of one share and where it went, with Undo;
// openShareIn() lists the recent shares. The sample apps below are demo mode only.
import { $, $$, esc, on, toast, haptic } from './core.js';
import { I } from './icons.js';
import { AGENT, aspect, ASPECTS, TODAY_LABEL, DEMO_MODE } from './data.js';
import * as R from './capture-real.js';
import * as API from './svc/api.js';
import * as clock from './svc/clock.js';
import { aspectTile } from './aspects.js';
import { api, has } from './bus.js';
import { routeScan } from './capture-route.js';
import { INBOX } from './brain-data.js';

const isAspect = (id) => ASPECTS.some((a) => a.id === id);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const destTile = (id) => (isAspect(id) ? aspectTile(id) : `<span class="tile cap-shx-dt" style="--t:${id === 'content' ? 'var(--content)' : id === 'today' ? 'var(--today)' : 'var(--ink-3)'}" aria-hidden="true">${id === 'content' ? I.content : id === 'today' ? I.today : I.graph}</span>`);

// what each sample app shares, and what the agent makes of it
const SAMPLES = {
  reel: { app: 'Instagram', host: 'reel', title: 'Kurta styling in 30 seconds', meta: 'Reel · 0:28', thumb: 'reel',
    what: 'A reel about styling a Lucknowi kurta. It belongs in two places.',
    dest: [{ id: 'content', label: 'Content ideas', sub: 'an idea for @example_creator', on: true }, { id: 'money', label: 'Brain › Corner Market', sub: 'styling notes for the listings', on: true }],
    content: { url: 'instagram.com/reel/style30', platform: 'Instagram', title: 'Kurta styling in 30 seconds', why: 'A styling hook for @example_creator; the fold could sell the Lucknowi listings' } },
  article: { app: 'Safari', host: 'article', title: 'How to price a website for a local shop', meta: 'medium.com · 6 min read', thumb: 'article',
    what: 'An article on pricing small-shop websites. Useful for the two quotes you owe.',
    dest: [{ id: 'mission', label: 'Brain › Mission › Northwind Studio', sub: 'next to the Harborline quote', on: true }, { id: 'mind', label: 'Mind › Reading list', sub: '6 minutes, tonight', on: false }] },
  upi: { app: 'GPay', host: 'upi', title: 'Paid ₹180 · Sharma Stationers', meta: 'Screenshot · 17:02', thumb: 'upi',
    what: 'A UPI payment for printouts. ₹80 would be left in today’s budget.',
    dest: [{ id: 'money', label: 'Money · Education', sub: '₹180, today 17:02', on: true }],
    receipt: { merchant: 'Sharma Stationers', total: 180, date: TODAY_LABEL.iso, items: [{ name: 'Printouts', price: 180 }], category: 'Education' } },
  chat: { app: 'WhatsApp', host: 'chat', title: 'Dad: the Diwali stock list', meta: 'Message · 16:40', thumb: 'chat',
    what: 'Dad needs the Diwali stock list by Sunday.',
    dest: [{ id: 'family', label: 'Family › Dad', sub: 'a moment, and on his file', on: true }, { id: 'today', label: 'Task · Sun 25', sub: 'Send Dad the Diwali stock list', on: true }],
    chat: { app: 'WhatsApp', person: 'dad', text: 'Diwali stock list by Sunday: 40 Lucknowi, 25 khadi.' } },
};
// inbox items reopen in the extension card, to be filed (Brain › Inbox)
const fromInbox = (it) => ({
  inbox: it.id, app: it.from, title: it.title, meta: it.meta, thumb: it.kind === 'reel' ? 'reel' : it.kind === 'shot' ? 'upi' : 'voice', what: it.why,
  dest: it.to.map(([id, label]) => ({ id: id === 'task' ? 'today' : id, label, sub: id === 'content' ? 'an idea for @example_creator' : id === 'task' ? 'due Sunday' : 'in your Brain', on: true })),
  content: it.content,
  receipt: it.id === 'i3' ? { merchant: 'City Electricals', total: 1200, date: TODAY_LABEL.iso, items: [{ name: 'Shop lights', price: 1200 }], category: 'Shop' } : null,
});

let X = null;
const alive = () => X?.el?.isConnected;
function close(after) {
  if (!alive()) return;
  const el = X.el; X = null;
  el.classList.remove('on'); el.classList.add('off');
  setTimeout(() => { el.remove(); after?.(); }, reduced() ? 120 : 420);
}

export function openShareIn(sample) {
  if (!DEMO_MODE) return realShareIn(sample);
  if (alive()) X.el.remove();
  const el = document.createElement('section');
  el.className = 'cap-shx';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Share in');
  $('#phone').append(el);
  X = { el, s: null };
  const it = INBOX.find((x) => x.id === sample);
  if (it) { X.s = fromInbox(it); el.classList.add('inbox'); el.innerHTML = '<div class="cap-shx-layer"></div>'; card(true); }
  else if (SAMPLES[sample]) { X.s = structuredClone(SAMPLES[sample]); host(X.s); shareSheet(); }
  else picker();
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  return el;
}

// ── 0 · which app to share from (the prototype's way in; on the phone it's just Share in any app) ──
function picker() {
  X.el.innerHTML = `<div class="cap-shx-scrim" data-act="cap-shx-close"></div>
    <div class="cap-shx-pick overlay">
      <div class="grab"></div>
      <div class="sheet-head"><div class="sh-text"><h3>Share in from any app</h3><p>On the phone it’s Share › Agentic OS. Pick one to see what happens.</p></div><button class="sheet-close" data-act="cap-shx-close" aria-label="Close">${I.x}</button></div>
      <div class="group cap-shx-pick-list">${Object.entries(SAMPLES).map(([k, s]) => `<button class="row ic" data-act="cap-shx-sample" data-k="${k}">${thumb(s.thumb)}<span class="rbody"><span class="rtitle">${esc(s.app)}</span><span class="rmeta">${esc(s.title)}</span></span>${I.chevR}</button>`).join('')}</div>
    </div>`;
}
function thumb(t) {
  if (t === 'reel') return `<span class="cap-shx-th reel" aria-hidden="true">${I.play}</span>`;
  if (t === 'article') return `<span class="cap-shx-th article" aria-hidden="true"><i></i><i></i><i></i></span>`;
  if (t === 'upi') return `<span class="cap-shx-th upi" aria-hidden="true">${I.check}</span>`;
  if (t === 'voice') return `<span class="cap-shx-th voice" aria-hidden="true">${I.mic}</span>`;
  return `<span class="cap-shx-th chat" aria-hidden="true">${I.chat}</span>`;
}

// ── 1 · the other app, as you'd be looking at it ──
function host(s) {
  const reel = () => `<div class="cap-shx-host reel stay-dark">
      <svg viewBox="0 0 402 874" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs><linearGradient id="cap-shxr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a1418"/><stop offset="1" stop-color="#14070a"/></linearGradient>
          <linearGradient id="cap-shxs" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b3263a"/><stop offset="1" stop-color="#6e0f1f"/></linearGradient></defs>
        <rect width="402" height="874" fill="url(#cap-shxr)"/>
        <ellipse cx="201" cy="250" rx="34" ry="40" fill="#2a1612"/>
        <path d="M150 300c30-14 72-14 102 0l26 420H124z" fill="url(#cap-shxs)"/>
        <path d="M150 300c40 60 70 180 64 420" fill="none" stroke="#e3b341" stroke-width="10" opacity=".9"/>
        <path d="M252 300c-24 90-14 260 26 420" fill="none" stroke="#e3b341" stroke-width="6" opacity=".7"/>
        <path d="M124 720c50-30 104-30 154 0" fill="none" stroke="#e3b341" stroke-width="12"/>
        ${Array.from({ length: 9 }, (_, i) => `<circle cx="${160 + (i % 3) * 30}" cy="${400 + Math.floor(i / 3) * 90}" r="5" fill="#e3b341" opacity=".75"/>`).join('')}
      </svg>
      <div class="cap-shx-reel-rail">${[I.heart, I.chat, I.share].map((g) => `<span>${g}</span>`).join('')}</div>
      <div class="cap-shx-reel-cap"><b>Kurta styling in 30 seconds</b><span>Original audio</span></div>
    </div>`;
  const article = () => `<div class="cap-shx-host article">
      <div class="cap-shx-art"><p class="cap-shx-art-k">Small business · 6 min read</p><h1>How to price a website for a local shop</h1>
        <p class="cap-shx-art-by">A guide for freelancers and small studios</p>
        <div class="cap-shx-art-img"></div>${'<i class="cap-shx-line"></i>'.repeat(9)}</div>
      <div class="cap-shx-url">medium.com</div>
    </div>`;
  const upi = () => `<div class="cap-shx-host upi">
      <div class="cap-shx-upi"><span class="cap-shx-upi-ok">${I.check}</span><p class="cap-shx-upi-a met">₹180</p><p class="cap-shx-upi-to">Paid to Sharma Stationers</p>
        <p class="cap-shx-upi-m">22 Oct 2026, 17:02</p><p class="cap-shx-upi-m">UPI transaction ID ···· 4021</p></div>
    </div>`;
  const chat = () => `<div class="cap-shx-host chat stay-dark">
      <div class="cap-shx-chat-h"><span class="cap-shx-av">D</span><span><b>Dad</b><small>online</small></span></div>
      <div class="cap-shx-chat-b">
        <p class="in">Beta, Diwali stock list Sunday tak bhej dena<small>16:40</small></p>
        <p class="in">40 Lucknowi, 25 khadi, baaki tum dekh lo<small>16:40</small></p>
        <p class="out">Haan Dad, kar dunga<small>16:44</small></p>
      </div>
    </div>`;
  const voice = () => `<div class="cap-shx-host chat stay-dark"><div class="cap-shx-chat-h"><span class="cap-shx-av">V</span><span><b>Voice memo</b><small>17:05 · 0:42</small></span></div>
      <div class="cap-shx-chat-b"><p class="in">“Dad wants the Diwali stock list by Sunday. 40 Lucknowi, 25 khadi.”<small>17:05</small></p></div></div>`;
  X.el.innerHTML = `${({ reel, article, upi, chat, voice })[s.host]()}<div class="cap-shx-layer"></div>`;
}

// ── 2 · the share sheet ──
function shareSheet() {
  const s = X.s;
  const apps = [['Messages', I.chat, '#30c25a'], ['Mail', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>', '#2f7cf6'], ['Agentic OS', null, null], ['Notes', I.edit, '#f4c430'], ['Files', I.folder, '#3d8ef7']];
  $('.cap-shx-layer', X.el).innerHTML = `<div class="cap-shx-scrim" data-act="cap-shx-close"></div>
    <div class="cap-shx-sheet overlay">
      <div class="grab"></div>
      <div class="cap-shx-sheet-h">${thumb(s.thumb)}<span class="cap-shx-sheet-t"><b>${esc(s.title)}</b><small>${esc(s.app)} · ${esc(s.meta)}</small></span><button class="sheet-close" data-act="cap-shx-close" aria-label="Close">${I.x}</button></div>
      <div class="cap-shx-apps">${apps.map(([n, g, c]) => (g ? `<button class="cap-shx-app" data-act="cap-shx-other" data-n="${esc(n)}"><span class="cap-shx-ic" style="--c:${c}">${g}</span><span>${n}</span></button>` : `<button class="cap-shx-app ours" data-act="cap-shx-ours"><span class="cap-shx-ic ours" aria-hidden="true"><svg viewBox="0 0 32 32"><g fill="none" stroke-width="3.2" stroke-linecap="round"><path d="M16 4.5a11.5 11.5 0 1 1-10 5.8" stroke="#fa114f"/><path d="M16 9a7 7 0 1 1-6.9 8.2" stroke="#a3f000"/><path d="M16 13.4a2.6 2.6 0 1 1-1.7 4.6" stroke="#a47bff"/></g></svg></span><span>${n}</span></button>`)).join('')}</div>
      <div class="group cap-shx-acts">${[['Copy', I.copy], ['Add to favourites', I.star], ['Save to Files', I.folder]].map(([t, g]) => `<button class="row" data-act="cap-shx-other" data-n="${t}"><span class="rbody"><span class="rtitle">${t}</span></span>${g}</button>`).join('')}</div>
    </div>`;
}

// ── 3 · our extension: what it got, where it goes, a note, Save ──
function card(fromInboxItem = false) {
  const s = X.s;
  const layer = $('.cap-shx-layer', X.el);
  layer.innerHTML = `<div class="cap-shx-scrim" data-act="cap-shx-close"></div>
    <div class="cap-shx-ext overlay" role="document">
      <div class="cap-shx-ext-bar"><button class="cap-shx-txt" data-act="cap-shx-close">Cancel</button><b>Agentic OS</b><button class="cap-shx-txt b" data-act="cap-shx-save">${fromInboxItem ? 'File' : 'Save'}</button></div>
      <div class="cap-shx-prev">${thumb(s.thumb)}<span class="cap-shx-prev-t"><b>${esc(s.title)}</b><small>${esc(s.app)} · ${esc(s.meta)}</small></span></div>
      <p class="cap-shx-wyn">${I.sparkle}<span><b>${esc(AGENT.name)}:</b> ${esc(s.what)}</span></p>
      <div class="group cap-shx-dests">${s.dest.map((d, i) => `<button class="row ic cap-shx-dest" data-act="cap-shx-dest" data-i="${i}" aria-pressed="${d.on}">${destTile(d.id)}<span class="rbody"><span class="rtitle">${esc(d.label)}</span><span class="rmeta">${esc(d.sub)}</span></span><span class="check${d.on ? ' done' : ''}" aria-hidden="true">${I.check}</span></button>`).join('')}</div>
      <label class="field cap-shx-note"><input type="text" placeholder="Add a note, if you like" aria-label="Note" enterkeyhint="done" /></label>
      <p class="cap-shx-foot">Nothing ticked? It waits in your Brain’s inbox for ${esc(AGENT.name)} to sort.</p>
    </div>`;
  requestAnimationFrame(() => $('.cap-shx-ext', layer)?.classList.add('in'));
}

function save() {
  if (!alive()) return;
  const s = X.s; const picked = s.dest.filter((d) => d.on);
  const note = $('.cap-shx-note input', X.el)?.value.trim();
  for (const d of picked) {
    if (d.id === 'content' && s.content) routeScan({ kind: 'reel', title: s.title, fields: s.content });
    else if (d.id === 'money' && s.receipt) routeScan({ kind: 'receipt', title: s.receipt.merchant, fields: s.receipt });
    else if (s.chat && isAspect(d.id)) { routeScan({ kind: 'chat', title: s.title, fields: { ...s.chat, text: `${s.chat.text}${note ? ` ${note}` : ''}` } }); if (has('remember')) api.remember(s.chat.text, { person: s.chat.person, title: s.title, via: s.app.toLowerCase(), by: 'you', quiet: true }); }
    else if (d.id === 'today') { /* the task: Home's quick add takes it once the extension closes */ }
    else if (has('remember')) api.remember(`${s.title}${note ? `. ${note}` : ''}`, { aspect: isAspect(d.id) ? d.id : null, person: /Dad/.test(d.label) ? 'dad' : null, title: s.title, via: s.app.toLowerCase(), by: 'you', quiet: true });
  }
  if (s.inbox) { const i = INBOX.findIndex((x) => x.id === s.inbox); if (i >= 0) INBOX.splice(i, 1); document.dispatchEvent(new CustomEvent('brain-changed')); }
  else if (!picked.length) { INBOX.unshift({ id: `i${Date.now().toString(36)}`, kind: s.thumb === 'reel' ? 'reel' : 'shot', from: s.app, at: '17:40', title: s.title, meta: s.meta, why: s.what, to: s.dest.map((d) => [d.id, d.label]), content: s.content }); document.dispatchEvent(new CustomEvent('brain-changed')); }
  const ext = $('.cap-shx-ext', X.el);
  ext.classList.add('saved');
  ext.innerHTML = `<div class="cap-shx-done"><span class="cap-shx-done-ic">${I.check}</span><b>${picked.length ? `Saved to ${picked.map((d) => d.label.split(' › ').pop()).join(' and ')}` : 'In your Brain’s inbox'}</b><small>${esc(AGENT.name)} takes it from here</small></div>`;
  haptic(16);
  const task = picked.find((d) => d.id === 'today');
  setTimeout(() => close(() => {
    toast(picked.length ? `Shared in · ${s.title}` : 'Shared in · waiting in your inbox');
    if (task && has('addTask')) api.addTask({ title: task.sub, when: 'Sun 25', person: 'dad', aspect: 'family' });
  }), reduced() ? 300 : 1100);
}

on('cap-shx-close', () => close());
on('cap-shx-sample', (el) => { if (!alive()) return; X.s = structuredClone(SAMPLES[el.dataset.k]); haptic(6); host(X.s); shareSheet(); });
on('cap-shx-ours', () => { if (!alive()) return; haptic(8); card(false); });
on('cap-shx-other', (el) => toast(`${el.dataset.n} is the phone’s own; this demo shows Agentic OS`));
on('cap-shx-dest', (el) => { if (!alive()) return; const d = X.s.dest[+el.dataset.i]; d.on = !d.on; haptic(5); $('.check', el).classList.toggle('done', d.on); el.setAttribute('aria-pressed', String(d.on)); });
on('cap-shx-save', () => save());

// ══ REAL MODE ══════════════════════════════════════════════════════════════════════════════════════════════
const SHARE_ICON = { reel: 'reel', link: 'article', receipt: 'upi', chat: 'chat', say: 'chat' };
const whereOf = (it) => (it.kind === 'say' ? (it.results ?? []).filter((r) => r.ok && !r.undone).map((r) => r.where).filter(Boolean) : it.filed && !it.filed.undone ? [it.filed.where] : []);
const undoable = (it) => (it.kind === 'say' ? (it.results ?? []).some((r) => r.ok && r.undo && !r.undone) : !!(it.filed?.undo && !it.filed.undone));
function shell() {
  if (alive()) X.el.remove();
  const el = document.createElement('section');
  el.className = 'cap-shx real';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Shared in');
  el.innerHTML = '<div class="cap-shx-layer"></div>';
  $('#phone').append(el);
  X = { el, s: null, real: true };
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  return el;
}
async function realShareIn(id) {
  const S = R.scans();
  await Promise.race([S.ready, new Promise((r) => setTimeout(r, 1500))]);
  let it = id ? S.get(id) : null;
  if (id && !it) { try { it = (await API.get(`/mod/scan/items/${encodeURIComponent(id)}`, { timeout: 8000 })).item; } catch {} }
  shell();
  if (it) shareCard(it); else shareList();
  return X.el;
}
function shareList() {
  const list = R.scans().list().filter((x) => x.source === 'share').slice(0, 20);
  $('.cap-shx-layer', X.el).innerHTML = `<div class="cap-shx-scrim" data-act="cap-shx-close"></div>
    <div class="cap-shx-pick overlay">
      <div class="grab"></div>
      <div class="sheet-head"><div class="sh-text"><h3>Shared in</h3><p>From any app: Share › Agentic OS. ${esc(AGENT.name)} files it the moment it arrives and tells you.</p></div><button class="sheet-close" data-act="cap-shx-close" aria-label="Close">${I.x}</button></div>
      ${list.length ? `<div class="group cap-shx-pick-list">${list.map((x) => `<button class="row ic" data-act="cap-shx-open" data-id="${esc(x.id)}">${thumb(SHARE_ICON[x.kind] ?? 'voice')}<span class="rbody"><span class="rtitle">${esc(x.title ?? x.text ?? 'Shared')}</span><span class="rmeta">${esc(whereOf(x).join(', ') || (x.status === 'ready' ? 'Ready to file' : x.status === 'undone' ? 'Undone' : 'In your inbox'))} · ${esc(x.created_at ? clock.ago(x.created_at) : '')}</span></span>${I.chevR}</button>`).join('')}</div>`
        : `<p class="cap-empty cap-shx-empty">Nothing shared in yet. Share a reel, a link, a screenshot or a message from any app.</p>`}
    </div>`;
}
function shareCard(it) {
  X.s = it;
  const where = whereOf(it);
  const ready = it.status === 'ready' && !it.filed;
  const rows = it.kind === 'say'
    ? (it.results ?? []).map((r) => `<div class="row ic cap-shx-dest">${destTile(r.app === 'people' ? 'friends' : r.app)}<span class="rbody"><span class="rtitle">${esc(r.title ?? '')}</span><span class="rmeta">${esc(r.ok ? `${r.where ?? ''}${r.undone ? ' · undone' : ''}` : `Didn’t go: ${r.error ?? ''}`)}</span></span><span class="check${r.ok && !r.undone ? ' done' : ''}" aria-hidden="true">${I.check}</span></div>`).join('')
    : `<div class="row ic cap-shx-dest">${destTile(ready ? (it.suggestion?.app ?? 'brain') : it.filed?.app ?? 'brain')}<span class="rbody"><span class="rtitle">${esc(ready ? it.suggestion?.where ?? 'Waiting to be filed' : it.filed?.where ?? (it.status === 'undone' ? 'Undone' : 'Your Brain’s inbox'))}</span><span class="rmeta">${esc(ready ? `${it.suggestion?.label ?? 'File it'}: one tap in the lens` : it.filed?.undone || it.status === 'undone' ? 'You undid it' : `${it.filed?.by === 'wyn' ? `${AGENT.name} filed it` : 'Filed'} ${it.filed?.at ? clock.ago(it.filed.at) : ''}`)}</span></span><span class="check${!ready && it.status !== 'undone' ? ' done' : ''}" aria-hidden="true">${I.check}</span></div>`;
  const said = it.kind === 'say' ? (it.reply || `Filed: ${where.join(', ') || 'nothing yet'}`) : (it.summary || (ready ? 'Ready to file.' : `Filed to ${where.join(', ')}.`));
  $('.cap-shx-layer', X.el).innerHTML = `<div class="cap-shx-scrim" data-act="cap-shx-close"></div>
    <div class="cap-shx-ext overlay" role="document">
      <div class="cap-shx-ext-bar"><button class="cap-shx-txt" data-act="cap-shx-close">Close</button><b>Shared in</b>${ready ? '<button class="cap-shx-txt b" data-act="cap-shx-file">File</button>' : undoable(it) ? '<button class="cap-shx-txt b" data-act="cap-shx-undo">Undo</button>' : '<span></span>'}</div>
      <div class="cap-shx-prev"><span class="cap-shx-th-wrap">${thumb(SHARE_ICON[it.kind] ?? 'voice')}</span><span class="cap-shx-prev-t"><b>${esc(it.title ?? it.text?.slice(0, 80) ?? 'Shared')}</b><small>${esc([it.fields?.platform, it.created_at ? clock.ago(it.created_at) : ''].filter(Boolean).join(' · '))}</small></span></div>
      <p class="cap-shx-wyn">${I.sparkle}<span><b>${esc(AGENT.name)}:</b> ${esc(said)}</span></p>
      <div class="group cap-shx-dests">${rows}</div>
      ${it.note ? `<p class="cap-shx-foot">Your note: ${esc(it.note)}</p>` : ''}
    </div>`;
  requestAnimationFrame(() => $('.cap-shx-ext', X.el)?.classList.add('in'));
  // the photo the share brought, fetched with this session (an <img> can't carry the iPhone's token)
  if (it.imageUrl) API.rawFetch(it.imageUrl).then((r) => (r.ok ? r.blob() : null)).then((b) => {
    if (!b || !alive() || X.s !== it) return;
    const w = $('.cap-shx-th-wrap', X.el); if (w) w.innerHTML = `<span class="cap-shx-th img"><img src="${URL.createObjectURL(b)}" alt=""></span>`;
  }).catch(() => {});
}
on('cap-shx-open', (el) => { if (!alive()) return; const it = R.scans().get(el.dataset.id); if (it) { haptic(6); shareCard(it); } });
on('cap-shx-undo', async () => {
  if (!alive() || !X.s) return;
  try { const r = await R.undoItem(X.s.id); haptic(10); toast('Undone'); R.scans().refresh?.(); if (alive()) shareCard(r.item ?? X.s); }
  catch (e) { toast(e?.message ?? 'Couldn’t undo it'); }
});
on('cap-shx-file', () => { if (!alive() || !X.s) return; const id = X.s.id; close(() => { if (has('openCapture')) api.openCapture('files', {}); setTimeout(() => document.querySelector(`[data-act="cap-file-waiting"][data-id="${CSS.escape(id)}"]`)?.click(), 600); }); });

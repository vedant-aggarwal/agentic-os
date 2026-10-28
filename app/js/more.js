// More (behind your avatar): you, areas, voice recordings, the modules running on your PC, app settings and the account sheet.
// It opens as a page from the avatar on any tab (openMore on the bus); #more still opens it as a hidden tab for deep links.
// Real mode draws from the PC: the modules that registered (app/modules through window.AOS, each with its own figure()),
// this week's areas, the voice queue, the account (server address, invites, password, sign out). Demo mode keeps the
// prototype's sample rows and module pages exactly as they were approved.
import { $, $$, esc, registerTab, push, openSheet, closeSheet, on, toast, topbar, seg, haptic, ring, wireSegs, currentTab, visiblePage } from './core.js';
import { provide, api as bus } from './bus.js';
import { I, areaIcon } from './icons.js';
import { area, MODULES, EVENTS, TASKS, ME, AREAS, DAYS, USER, DEMO_MODE, SOURCE, onData } from './data.js';
import { stackBar, lifeCard } from './life.js';
import { skinSeg, setTheme } from './skin.js';
import * as API from './svc/api.js';
import * as SYNC from './svc/sync.js';
import * as native from './svc/native.js';
import { pendingAll, wipe } from './svc/store.js';
import * as clock from './svc/clock.js';

const theme = () => document.documentElement.dataset.theme || 'dark';
const AOS = () => window.AOS;
const mod = (id) => MODULES.find((m) => m.id === id);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// Clients has its own tab now, so the old Client window module is gone from the list
const GRID = MODULES.filter((m) => m.id !== 'clients');
// Modules sit outside the four domains, so their glyphs are neutral
const ic = (m, cls = '') => `<span class="mo-ic ${cls}">${I[m.icon]}</span>`;
// Each module reports one figure, and the words under its name say what the figure counts (demo: the prototype's lines)
const LEAD = {
  cabinet: ['19:00', 'Sits Saturday'], ribbon: ['2h 10m', 'On Projects today'], weather: ['Stormy', 'Thursday'],
  demand: ['3', 'Repeated asks'], doctrine: ['1', 'New observation'], thumbs: ['3', 'Redesigns proposed'],
  price: ['₹1,200', 'An hour is worth'], runbooks: ['4', 'Ready to run'], bounty: ['2', 'Open bounties'], ping: ['41 ms', 'Modules are live'],
};
const modRowHTML = (id, title, icon, v, words) => `<button class="row ic mo-mod" data-act="mod-open" data-id="${esc(id)}"><span class="tile">${icon}</span>
    <span class="rbody"><span class="rtitle">${esc(title)}</span>${words ? `<span class="rmeta">${esc(words)}</span>` : ''}</span>${v ? `<b class="met mo-v">${esc(v)}</b>` : ''}${I.chevR}</button>`;
const modRow = (m) => { const [v, words] = LEAD[m.id] ?? ['', m.line]; return modRowHTML(m.id, m.title, I[m.icon], v, words); };

// ── real mode: what the PC's modules say about themselves ─────────────
const ORDER = GRID.map((m) => m.id);
function realMods() {
  const list = (AOS()?.mods?.() ?? []).filter((m) => !m.tab && m.id !== 'clients');
  return list.sort((a, b) => (ORDER.indexOf(a.id) + 1 || 99) - (ORDER.indexOf(b.id) + 1 || 99));
}
function realModRow(m) {
  const meta = mod(m.id);
  const f = AOS()?.figureOf?.(m.id) ?? null;
  const icon = meta ? I[meta.icon] : (typeof m.icon === 'string' && m.icon.trim().startsWith('<svg') ? m.icon : `<b>${esc(m.title[0] ?? '•')}</b>`);
  return modRowHTML(m.id, m.title, icon, f?.value != null && f.value !== '' ? String(f.value) : '', f?.label ?? '');
}
// This week on the calendar, by area (sleep left out), and the blocks with no area yet
function weekByArea() {
  const minutes = new Map();
  const untagged = new Map();
  const days = [EVENTS, ...DAYS.values()];
  for (const evs of days) for (const e of evs) {
    if (e.sleep) continue;
    const m = Math.max(0, Math.min(e.end, 1440) - Math.max(e.start, 0));
    const k = e.area ?? 'none';
    minutes.set(k, (minutes.get(k) ?? 0) + m);
    if (!e.area) { const t = e.full || e.title; const g = untagged.get(t) ?? { title: t, ids: [], n: 0 }; g.ids.push(e.id); g.n++; untagged.set(t, g); }
  }
  return { minutes, untagged: [...untagged.values()] };
}
const hours = (min) => (min >= 60 ? `${Math.round(min / 60)}h` : `${min}m`);
let voiceWaiting = null;
async function refreshVoice() {
  const V = AOS()?.work?.voice;
  if (!V?.pending) return;
  try { voiceWaiting = (await V.pending()).length; } catch { return; }
  $$('[data-mo-voice-meta]').forEach((el) => { el.textContent = voiceLine(); });
}
const voiceLine = () => (DEMO_MODE ? '3 on this phone · 1 waiting to send' : voiceWaiting == null ? 'On this phone until your PC has the text' : voiceWaiting ? `${plural(voiceWaiting, 'recording')} waiting to send` : 'Nothing waiting to send');
let kb = null;
async function refreshKeyboard() {
  if (!native.NATIVE) return;
  const r = await native.keyboardStatus();
  if (!r.available || !r.ok) return;
  kb = r;
  $$('[data-mo-kb-meta]').forEach((el) => { el.textContent = kbLine(); });
}
const kbLine = () => (DEMO_MODE ? 'Agentic keyboard · On' : !kb ? 'The Agentic OS keyboard' : kb.seen ? 'On, with Full Access' : kb.added ? 'Added. Turn on Allow Full Access' : 'Not added yet. Set up in Settings');

// ── More: one body, shown as a pushed page from the avatar, or as the hidden 'more' tab for #more ──
const TAB_TITLES = { today: 'Today', life: 'Life', jobs: 'Work', content: 'Content', agent: 'Agent' };
function moreBody() {
  if (DEMO_MODE) return demoBody();
  const { minutes, untagged } = weekByArea();
  const planned = [...minutes].filter(([k]) => k !== 'none').reduce((s, [, v]) => s + v, 0);
  const busiest = [...minutes].filter(([k]) => k !== 'none' && AREAS[k]).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const four = [...busiest, ...Object.keys(AREAS).filter((k) => k !== 'none' && !busiest.includes(k))].slice(0, 4);
  const dots = four.map((s) => `<i style="background:${area(s).color}"></i>`).join('');
  const mods = realMods();
  const owner = USER?.owner;
  // the old Content page is retired (the Content tab replaces it); Jobs and Clients stay until Work ports them
  const classic = owner ? [['jobs', 'Jobs board', I.work, 'The shipping app’s board'], ['clients', 'Clients', I.clients, 'Your clients and leads']] : [];
  return `
      <div class="phead"><h1 class="lt">More</h1></div>
      <div class="group mo-first">
        <button class="row ic mo-me" data-act="account-sheet"><span class="mo-avatar" aria-hidden="true">${esc(ME.initial)}</span><span class="rbody"><span class="rtitle">${esc(ME.name)}</span><span class="rmeta">${esc([ME.college, ME.city].filter(Boolean).join(' · ') || USER?.email || '')}</span></span>${I.chevR}</button>
      </div>
      <div class="group mo-first">
        <button class="row ic" data-act="more-areas"><span class="tile mo-areas-tile">${dots}</span><span class="rbody"><span class="rtitle">Areas</span><span class="rmeta">${planned ? `${hours(planned)} this week` : 'Nothing planned this week'}</span></span>${untagged.length ? `<span class="rend"><span class="pill" style="--c:var(--needs-ink)">${untagged.length} untagged</span></span>` : ''}${I.chevR}</button>
        <button class="row ic" data-act="more-voice"><span class="tile">${I.mic}</span><span class="rbody"><span class="rtitle">Voice recordings</span><span class="rmeta" data-mo-voice-meta>${esc(voiceLine())}</span></span>${I.chevR}</button>
      </div>
      <div class="sh"><h2>Modules on your PC</h2><span class="sh-count">${mods.length || ''}</span></div>
      ${mods.length ? `<div class="group mo-mods">${mods.map(realModRow).join('')}</div>` : `<div class="note">${document.documentElement.dataset.legacy === 'loaded' ? 'No modules answered from your PC.' : 'Loading the modules on your PC…'}</div>`}
      ${classic.length ? `<div class="sh"><h2>From the first app</h2></div>
      <div class="group">${classic.map(([id, t, icon, m]) => `<button class="row ic" data-act="mo-classic" data-id="${id}"><span class="tile">${icon}</span><span class="rbody"><span class="rtitle">${esc(t)}</span><span class="rmeta">${esc(m)}</span></span>${I.chevR}</button>`).join('')}</div>` : ''}
      <div class="sh"><h2>App</h2></div>
      <div class="group">
        <div class="row ic mo-skin"><span class="tile">${I.brush}</span><span class="rbody"><span class="rtitle">Appearance</span></span>${skinSeg()}</div>
        <div class="row ic"><span class="tile mo-theme-ic">${theme() === 'light' ? I.sun : I.moon}</span><span class="rbody"><span class="rtitle">Theme</span></span>${seg('more-theme', [['dark', 'Dark'], ['light', 'Light']], theme(), 'sm mo-theme')}</div>
        ${native.NATIVE ? `<button class="row ic" data-act="more-keyboard"><span class="tile">${I.keyboard}</span><span class="rbody"><span class="rtitle">Keyboard</span><span class="rmeta" data-mo-kb-meta>${esc(kbLine())}</span></span>${I.chevR}</button>` : ''}
        <button class="row ic" data-act="account-sheet"><span class="tile">${I.gear}</span><span class="rbody"><span class="rtitle">Settings</span><span class="rmeta">Sync, server, invite, security</span></span>${I.chevR}</button>
      </div>`;
}
function demoBody() {
  const dots = ['college', 'projects', 'northwind', 'content'].map((s) => `<i style="background:${area(s).color}"></i>`).join('');
  return `
      <div class="phead"><h1 class="lt">More</h1></div>
      <div class="group mo-first">
        <button class="row ic mo-me" data-act="account-sheet"><span class="mo-avatar" aria-hidden="true">${esc(ME.initial)}</span><span class="rbody"><span class="rtitle">${esc(ME.name)}</span><span class="rmeta">${esc(ME.college)} · ${esc(ME.city)}</span></span>${I.chevR}</button>
      </div>
      <div class="group mo-first">
        <button class="row ic" data-act="more-areas"><span class="tile mo-areas-tile">${dots}</span><span class="rbody"><span class="rtitle">Areas</span><span class="rmeta">56h this week</span></span><span class="rend"><span class="pill" style="--c:var(--needs-ink)">4 untagged</span></span>${I.chevR}</button>
        <button class="row ic" data-act="more-voice"><span class="tile">${I.mic}</span><span class="rbody"><span class="rtitle">Voice recordings</span><span class="rmeta">3 on this phone · 1 waiting to send</span></span>${I.chevR}</button>
      </div>
      <div class="sh"><h2>Modules on your PC</h2><span class="sh-count">${GRID.length}</span></div>
      <div class="group mo-mods">${GRID.map(modRow).join('')}</div>
      <div class="sh"><h2>App</h2></div>
      <div class="group">
        <div class="row ic mo-skin"><span class="tile">${I.brush}</span><span class="rbody"><span class="rtitle">Appearance</span></span>${skinSeg()}</div>
        <div class="row ic"><span class="tile mo-theme-ic">${theme() === 'light' ? I.sun : I.moon}</span><span class="rbody"><span class="rtitle">Theme</span></span>${seg('more-theme', [['dark', 'Dark'], ['light', 'Light']], theme(), 'sm mo-theme')}</div>
        <button class="row ic" data-act="more-keyboard"><span class="tile">${I.keyboard}</span><span class="rbody"><span class="rtitle">Keyboard</span><span class="rmeta">Agentic keyboard · On</span></span>${I.chevR}</button>
        <button class="row ic" data-act="account-sheet"><span class="tile">${I.gear}</span><span class="rbody"><span class="rtitle">Settings</span><span class="rmeta">Sync, invite, data, security</span></span>${I.chevR}</button>
      </div>`;
}
function wireMore(root) {
  root.addEventListener('change', (e) => {
    if (!e.target.closest('[data-seg="more-theme"]')) return;
    setTheme(e.detail);
    const t = $('.mo-theme-ic', root); if (t) t.innerHTML = e.detail === 'light' ? I.sun : I.moon;
  });
  refreshVoice(); refreshKeyboard();
}
// a module's figure changed, a module registered, the data moved: redraw More where it is open
function redrawMore() {
  for (const sc of [$('#pages > .page[data-tab="more"] .scroll'), ...$$('#stack > .page.mo-page > .scroll')].filter(Boolean)) {
    const y = sc.scrollTop;
    sc.innerHTML = moreBody(); wireSegs(sc); sc.scrollTop = y;
  }
  refreshVoice();
}
let moreT = 0;
const soonMore = () => { clearTimeout(moreT); moreT = setTimeout(redrawMore, 120); };
document.addEventListener('aos-more', soonMore);
onData((why) => { if (['server', 'boot', 'local', 'synced'].includes(why)) soonMore(); });
registerTab('more', {
  title: 'More',
  render(page) {
    page.innerHTML = `${topbar({ title: 'More' })}<div class="scroll">${moreBody()}</div>`;
    wireMore(page);
  },
  onShow(page) {
    const s = $('[data-seg="more-theme"]', page); if (!s) return;
    $$('button', s).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === theme())));
    s._place?.(true);
    const t = $('.mo-theme-ic', page); if (t) t.innerHTML = theme() === 'light' ? I.sun : I.moon;
  },
});
export function openMore() {
  push({ title: 'More', back: TAB_TITLES[currentTab()] ?? 'Back', cls: 'mo-page', render(sc, page) { sc.innerHTML = moreBody(); wireSegs(sc); wireMore(page); } });
}
provide('openMore', openMore);
on('more-open', () => openMore());
on('mo-classic', (el) => AOS()?.openClassic?.(el.dataset.id));

// ── account sheet (also opened from Life) ────────────────────────────
// Groups that explain themselves carry no label; a label names only what a row cannot say for itself.
// the avatar on any tab opens More; the account sheet is one level in (your row, Settings)
on('account', () => openMore());
on('account-sheet', () => (DEMO_MODE ? demoAccount() : openAccount()));
function demoAccount() {
  openSheet({
    large: true, cls: 'mo-acct-sheet',
    head: `<div class="sheet-head mo-acct"><span class="mo-avatar">A</span><div class="sh-text"><h3>Alex</h3><p>alex@example.com · Owner</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: `
    <div class="group"><div class="row ic"><span class="tile mo-sync">${I.sync}</span><span class="rbody"><span class="rtitle">Demo data</span><span class="rmeta">Nothing here is saved to your PC</span></span></div></div>
    <p class="mo-gl">Appearance</p>
    <div class="group"><div class="row mo-skin-sheet">${skinSeg()}</div></div>
    <p class="mo-gl">Data on this phone</p>
    <div class="group"><div class="row"><span class="rbody"><span class="rtitle">Source</span><span class="rmeta">Demo never syncs to your PC</span></span>${seg('more-data', [['real', 'Real'], ['demo', 'Demo']], 'demo', 'sm')}</div></div>
    <p class="hint">The sample day from the prototype. Switch to Real to sign in to your PC.</p>`,
  });
}

const acct = { invite: null, pw: false, busy: false, msg: '', msgKind: '', out: false, server: false };
function syncLine() {
  const c = API.connection();
  const p = SYNC.pending();
  const apps = pendingAll();
  const waiting = [p.dirty ? 'your edits' : null, apps ? plural(apps, 'app record') : null].filter(Boolean).join(' and ');
  if (c.status === 'offline') return ['Offline', waiting ? `${capFirst(waiting)} wait on this phone and sync when your PC is reachable` : 'Changes wait on this phone and sync when your PC is reachable', 'warn'];
  if (c.status === 'error') return ['Your PC hit an error saving', 'Changes stay on this phone and are retried', 'warn'];
  if (p.dirty || apps) return ['Saving to your PC', `${capFirst(waiting)} on the way`, ''];
  const at = p.lastSync || null;
  return ['In sync with your PC', at ? `Last saved ${clock.ago(new Date(at).toISOString()) === 'now' ? 'just now' : `${clock.ago(new Date(at).toISOString())} ago`}` : 'Nothing waiting', 'ok'];
}
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const initials = () => esc(ME.initial || '?');
function accountBody() {
  const [syncT, syncS, syncK] = syncLine();
  const owner = USER?.owner;
  const S = API.serverInfo();
  const rows = [];
  rows.push(`<div class="group"><div class="row ic"><span class="tile mo-sync"${syncK === 'warn' ? ' style="color:var(--needs-ink)"' : ''}>${I.sync}</span><span class="rbody"><span class="rtitle">${esc(syncT)}</span><span class="rmeta">${esc(syncS)}</span></span><button class="btn sm" data-act="mo-sync"${acct.syncing ? ' disabled' : ''}>${acct.syncing ? '<span class="spin"></span>' : 'Sync now'}</button></div></div>`);
  rows.push(`<p class="mo-gl">Appearance</p><div class="group"><div class="row mo-skin-sheet">${skinSeg()}</div></div>`);
  rows.push(`<div class="group mo-gap">
      <button class="row ic" data-act="more-voice-sheet"><span class="tile">${I.mic}</span><span class="rbody"><span class="rtitle">Voice recordings</span><span class="rmeta" data-mo-voice-meta>${esc(voiceLine())}</span></span>${I.chevR}</button>
      ${native.NATIVE ? `<button class="row ic" data-act="more-keyboard"><span class="tile">${I.keyboard}</span><span class="rbody"><span class="rtitle">Agentic keyboard</span><span class="rmeta" data-mo-kb-meta>${esc(kbLine())}</span></span>${I.chevR}</button>` : ''}
    </div>`);
  // the PC this phone talks to
  rows.push('<p class="mo-gl">Your PC</p>');
  if (S.native) {
    rows.push(acct.server
      ? `<form class="eng-form" data-mo-server><label class="eng-field"><span class="vh">Server address</span><input name="server" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(S.base)}" placeholder="${esc(S.default)}" /></label>
          <p class="eng-note warn">Changing it signs you out of this phone${SYNC.pending().dirty || pendingAll() ? ', and the changes still waiting to sync are dropped' : ''}.</p>
          <button class="btn primary block" type="submit">Use this server</button>
          ${S.custom ? '<button class="btn block" type="button" data-act="mo-server-reset">Back to the usual server</button>' : ''}</form>`
      : `<div class="group"><button class="row ic" data-act="mo-server"><span class="tile">${I.link ?? I.gear}</span><span class="rbody"><span class="rtitle">Server address</span><span class="rmeta"><span class="ell">${esc(S.base.replace(/^https?:\/\//, ''))}${S.custom ? ' · custom' : ''}</span></span></span>${I.chevR}</button></div>`);
  } else rows.push(`<div class="group"><div class="row ic"><span class="tile">${I.link ?? I.gear}</span><span class="rbody"><span class="rtitle">This page talks to</span><span class="rmeta"><span class="ell">${esc(S.base.replace(/^https?:\/\//, ''))}</span></span></span></div></div>`);
  if (owner) {
    rows.push(`<p class="mo-gl">Invite</p><div class="group">${acct.invite
      ? `<div class="row ic"><span class="tile">${I.key}</span><span class="rbody"><span class="rtitle mono mo-code">${esc(acct.invite.code)}</span><span class="rmeta">One sign-up · until ${esc(shortDate(acct.invite.expiresAt))}</span></span><button class="btn sm" data-act="more-copy">${I.copy}Copy</button></div>`
      : `<button class="row ic" data-act="mo-invite"><span class="tile">${I.key}</span><span class="rbody"><span class="rtitle">Create an invite code</span><span class="rmeta">One sign-up, valid for 7 days</span></span>${I.chevR}</button>`}</div>${acct.invite ? '<p class="eng-note">They open this app, tap “Have an invite?”, and get their own empty space.</p>' : ''}`);
  }
  rows.push(`<p class="mo-gl">Data on this phone</p><div class="group"><div class="row"><span class="rbody"><span class="rtitle">Source</span><span class="rmeta">Demo never syncs to your PC</span></span>${seg('more-data', [['real', 'Real'], ['demo', 'Demo']], SOURCE, 'sm')}</div></div>`);
  const waiting = SYNC.pending().dirty || pendingAll();
  rows.push(`<div class="group mo-gap">${acct.pw
    ? `<form class="eng-form" data-mo-pw>${USER?.hasPassword === false ? '' : '<label class="eng-field"><span class="vh">Current password</span><input type="password" name="current" placeholder="Current password" autocomplete="current-password" required /></label>'}
        <label class="eng-field"><span class="vh">New password</span><input type="password" name="next" placeholder="New password (8+ characters)" autocomplete="new-password" minlength="8" required /></label>
        <button class="btn primary block" type="submit"${acct.busy ? ' disabled' : ''}>Change password</button></form>`
    : `<button class="row ic" data-act="more-pass"><span class="tile">${I.lock}</span><span class="rbody"><span class="rtitle">Change password</span></span>${I.chevR}</button>`}
    <button class="row ic mo-danger" data-act="more-signout"><span class="tile">${I.arrowR}</span><span class="rbody"><span class="rtitle">${acct.out ? 'Sign out anyway' : 'Sign out'}</span>${acct.out && waiting ? '<span class="rmeta">Changes that haven’t reached your PC are dropped</span>' : ''}</span></button></div>`);
  if (acct.msg) rows.push(`<p class="eng-note ${acct.msgKind}" role="status">${esc(acct.msg)}</p>`);
  rows.push(`<p class="hint">Signed in as ${esc(USER?.email ?? '')}. Sessions last 60 days; changing the password signs out your other devices.</p>`);
  return rows.join('');
}
const shortDate = (iso) => { if (!iso) return ''; const p = clock.dparts(String(iso).slice(0, 10)); return `${p.day} ${clock.MONTHS[p.month].slice(0, 3)}`; };
let acctEl = null;
function drawAccount() { const b = acctEl && $('.sheet-body', acctEl); if (!b) return; b.innerHTML = accountBody(); wireSegs(b); }
function openAccount() {
  Object.assign(acct, { msg: '', msgKind: '', pw: false, out: false, server: false });
  acctEl = openSheet({
    large: true, cls: 'mo-acct-sheet',
    head: `<div class="sheet-head mo-acct"><span class="mo-avatar">${initials()}</span><div class="sh-text"><h3>${esc(ME.name)}</h3><p>${esc(USER?.email ?? '')}${USER?.owner ? ' · Owner' : ''}</p></div><button class="sheet-close" data-act="close-sheet" aria-label="Close">${I.x}</button></div>`,
    body: (b) => { b.innerHTML = accountBody(); },
    onClose: () => { acctEl = null; },
  });
  refreshVoice(); refreshKeyboard();
  const b = $('.sheet-body', acctEl);
  b.addEventListener('submit', async (e) => {
    const form = e.target;
    e.preventDefault();
    if (form.matches('[data-mo-pw]')) {
      const f = new FormData(form);
      acct.busy = true; drawAccount();
      try {
        await API.post('/account/password', { current: f.get('current'), next: f.get('next') });
        Object.assign(acct, { pw: false, msg: 'Password changed. Your other devices are signed out.', msgKind: '' });
        haptic('success');
      } catch (err) { Object.assign(acct, { msg: err.status ? err.message : 'Your PC isn’t reachable right now.', msgKind: 'bad' }); }
      acct.busy = false; drawAccount();
    }
    if (form.matches('[data-mo-server]')) {
      const v = new FormData(form).get('server');
      try {
        if (API.normalizeServer(v) === API.apiBase()) { acct.server = false; drawAccount(); return; }
        API.setServer(v);
        await wipe();
        location.replace('login.html');
      } catch (err) { Object.assign(acct, { msg: err.message, msgKind: 'bad' }); drawAccount(); }
    }
  });
  b.addEventListener('change', (e) => {
    if (!e.target.closest('[data-seg="more-data"]')) return;
    switchSource(e.detail);
  });
}
const pendingSync = () => SYNC.pending();
document.addEventListener('data-changed', () => { if (acctEl) drawAccount(); });
API.onConnection(() => { if (acctEl) drawAccount(); });
function switchSource(src) {
  if (src === SOURCE) return;
  API.ls.set(API.KEYS.source, src);
  const u = new URL(location.href);
  u.searchParams.delete('data');
  location.replace(u.toString());
}
on('mo-sync', async () => {
  if (acct.syncing || DEMO_MODE) return;
  acct.syncing = true; drawAccount();
  try {
    await SYNC.flush();
    await SYNC.refresh(true);
    for (const c of (await import('./svc/store.js')).collections()) await c.kick();
  } finally { acct.syncing = false; }
  const st = API.connection().status;
  Object.assign(acct, { msg: st === 'ok' ? 'Synced with your PC.' : 'Your PC isn’t reachable right now.', msgKind: st === 'ok' ? '' : 'warn' });
  drawAccount();
});
on('mo-server', () => { acct.server = true; drawAccount(); setTimeout(() => $('[data-mo-server] input', acctEl)?.focus(), 60); });
on('mo-server-reset', async () => { API.setServer(null); await wipe(); location.replace('login.html'); });
on('mo-invite', async () => {
  try { acct.invite = await API.post('/invites', { uses: 1, days: 7 }); haptic('success'); acct.msg = ''; }
  catch (err) { Object.assign(acct, { msg: err.status ? err.message : 'Your PC isn’t reachable right now.', msgKind: 'bad' }); }
  drawAccount();
});
on('more-copy', async () => {
  if (DEMO_MODE || !acct.invite) { toast('Invite code copied'); return; }
  const base = API.serverInfo().base;
  const text = `Join me on Agentic OS: ${base}/login?invite=${acct.invite.code}`;
  try { if (navigator.share) await navigator.share({ text }); else { await navigator.clipboard.writeText(text); toast('Invite copied'); } } catch {}
});
on('more-pass', () => { if (DEMO_MODE) { toast('Opens change password'); return; } acct.pw = true; drawAccount(); setTimeout(() => $('[data-mo-pw] input', acctEl)?.focus(), 60); });
on('more-signout', async () => {
  if (DEMO_MODE) { switchSource('real'); return; }
  const waiting = pendingSync().dirty || pendingAll();
  if (waiting && !acct.out) { acct.out = true; drawAccount(); return; }
  await wipe();
  await API.signOut();
});
on('more-keyboard', () => { if (native.NATIVE) native.openSettings(); else toast('Opens iOS keyboard setup on the iPhone'); });
on('more-voice-sheet', (el) => { closeSheet(el.closest('.sheet')); openVoice(); });

// ── Areas ─────────────────────────────────────────────────────────────
const AREA_HOURS = { projects: 18, 'college': 14, personal: 9, northwind: 6, content: 3, 'morgan-co': 2, 'corner-market': 0 };
function areasPage() {
  push({
    title: 'Areas', back: 'More',
    render(sc) {
      const real = !DEMO_MODE;
      const w = real ? weekByArea() : null;
      const rows = real
        ? Object.keys(AREAS).filter((s) => s !== 'none').map((s) => [s, Math.round((w.minutes.get(s) ?? 0) / 60)]).sort((a, b) => b[1] - a[1])
        : Object.entries(AREA_HOURS).sort((a, b) => b[1] - a[1]);
      const none = real ? Math.round((w.minutes.get('none') ?? 0) / 60) : 4;
      const untaggedN = real ? w.untagged.reduce((n, g) => n + g.n, 0) : 4;
      sc.innerHTML = `
      <div class="phead"><h1 class="lt">Areas</h1><p class="sub">Where your week's calendar goes.</p></div>
      <div class="lf-card mo-acard">${stackBar([...rows.filter((r) => r[1] > 0), ...(none ? [['none', none]] : [])])}</div>
      <div class="sh"><h2>Areas</h2><span class="sh-count">${rows.length}</span></div>
      <div class="group">
        ${rows.map(([s, h]) => { const a = area(s); const n = TASKS.filter((t) => t.area === s && t.list !== 'done').length; return `<button class="row ic" data-act="more-area" data-s="${s}"><span class="tile mo-aglyph" style="--t:${a.color}">${areaIcon[s] ?? I.grid}</span><span class="rbody"><span class="rtitle">${esc(a.name)}</span><span class="rmeta">${h ? `${h}h planned this week` : 'Nothing planned this week'}</span></span><span class="rend num">${n ? `${n} open` : ''}</span>${I.chevR}</button>`; }).join('')}
        <div class="row ic"><span class="tile mo-aglyph" style="--t:var(--a-none)">${I.tag}</span><span class="rbody"><span class="rtitle">No area</span><span class="rmeta">${untaggedN ? `${plural(untaggedN, 'block')} · ${none}h this week` : 'Every block has an area'}</span></span>${untaggedN ? '<button class="btn sm mo-tagbtn" data-act="more-tag">Tag</button>' : ''}</div>
      </div>`;
    },
  });
}
on('more-areas', () => areasPage());
on('more-area', (el) => { const s = el.dataset.s; const n = TASKS.filter((t) => t.area === s && t.list !== 'done').length; toast(`${area(s).name}: ${n ? plural(n, 'open task') : 'nothing open'}`); });
// one choice per block name: a segmented control. Saving tags every block with that name, now and in future weeks
const TAG_AREAS = ['personal', 'projects', 'northwind', 'morgan-co'];
on('more-tag', () => {
  if (DEMO_MODE) return demoTag();
  const groups = weekByArea().untagged;
  const choices = Object.keys(AREAS).filter((s) => s !== 'none');
  const pick = TAG_AREAS.filter((s) => choices.includes(s)).concat(choices.filter((s) => !TAG_AREAS.includes(s))).slice(0, 4);
  openSheet({
    title: 'Blocks with no area', sub: 'Pick an area once and every block with that name gets it.',
    body: `<div class="mo-tags">${groups.map((g, i) => `
      <div class="mo-tagrow" data-title="${esc(g.title)}"><p class="mo-tag-t">${esc(g.title)}</p><p class="foot">${plural(g.n, 'block')} this week</p>
      ${seg(`mo-tag-${i}`, [['', 'Skip'], ...pick.map((s) => [s, `<i class="dot" style="--c:${area(s).color}"></i>${esc(s === 'college' ? 'College' : area(s).name.split(' ')[0])}`])], '', 'sm mo-tagseg')}</div>`).join('')}
      <div class="pad mo-tagfoot"><button class="btn primary block" data-act="mo-tagsave">Tag these blocks</button></div></div>`,
  });
});
function demoTag() {
  openSheet({
    title: 'Blocks with no area', sub: 'Pick an area once and every block with that name gets it.',
    body: `<div class="mo-tags">${[['Cardio, Abs & Spine Decompression', '3 blocks', 'personal'], ['Lunch', '5 blocks', 'personal'], ['Call with Dad', '1 block', 'morgan-co']].map(([t, n, sug], i) => `
      <div class="mo-tagrow"><p class="mo-tag-t">${esc(t)}</p><p class="foot">${n} · Claude suggests ${esc(area(sug).name)}</p>
      ${seg(`mo-tag-${i}`, TAG_AREAS.map((s) => [s, `<i class="dot" style="--c:${area(s).color}"></i>${esc(s === 'college' ? 'College' : area(s).name.split(' ')[0])}`]), sug, 'sm mo-tagseg')}</div>`).join('')}
      <div class="pad mo-tagfoot"><button class="btn primary block" data-act="more-tagsave">Tag 9 blocks</button></div></div>`,
  });
}
on('more-tagsave', (el) => { closeSheet(el.closest('.sheet')); toast('9 blocks tagged'); });
on('mo-tagsave', async (el) => {
  const sheet = el.closest('.sheet');
  const picks = $$('.mo-tagrow', sheet).map((r) => [r.dataset.title, $('button[aria-selected="true"]', r)?.dataset.v]).filter(([, s]) => s);
  closeSheet(sheet);
  if (!picks.length) return;
  const { moveEvent } = await import('./data.js');
  let n = 0;
  for (const [title, slug] of picks) {
    for (const evs of [EVENTS, ...DAYS.values()]) for (const e of evs) if (!e.area && (e.full || e.title) === title) { moveEvent(e.id, { area: slug }); n++; }
    // future weeks too: the area's rule (the same as `agentos area rule`)
    API.post(`/areas/${encodeURIComponent(slug)}/rules`, { title }).catch(() => toast(`Saved here; the rule for “${title}” waits for your PC`));
  }
  toast(`${plural(n, 'block')} tagged`);
});

// ── Voice recordings ─────────────────────────────────────────────────
// Real mode opens the shipping app's queue (app/work/voice.js: what waits on this phone, retry, play, export).
function openVoice() {
  if (!DEMO_MODE && AOS()?.work?.openVoice) { AOS().work.openVoice(); return; }
  if (!DEMO_MODE) { toast('Voice recordings are still loading'); return; }
  voicePage();
}
provide('openVoice', openVoice);
const REC = [
  { first: 'Okay so for the Agentic OS redesign, liquid glass, compact tasks on home…', date: 'Today 13:58', dur: '2:41', src: 'Capture', status: ['Transcribed', 'var(--done)'] },
  { first: 'Reel idea: my phone runs five coding agents while I sit in class', date: 'Today 09:12', dur: '0:38', src: 'Keyboard', status: ['Waiting to send', 'var(--needs-ink)'] },
  { first: 'Tell Dad the website payment and the monthly fee…', date: 'Yesterday 21:40', dur: '1:05', src: 'Wyn chat', status: ['Upload failed', 'var(--fail-ink)'] },
  { first: 'Atlas ERP pricing: three tiers, anchor high, done-for-you on top', date: 'Mon 19 Oct', dur: '3:12', src: 'Capture', status: ['Transcribed', 'var(--done)'] },
];
function voicePage() {
  push({
    title: 'Voice recordings', back: 'More',
    render(sc) {
      sc.classList.add('mo-voice');
      sc.innerHTML = `
      <div class="phead"><h1 class="lt">Voice recordings</h1><p class="sub">Each recording stays on this phone until your PC has the text.</p></div>
      <div class="group">
        <div class="row ic"><span class="tile mo-wait">${I.up}</span><span class="rbody"><span class="rtitle">1 waiting to send</span><span class="rmeta">Sends when the PC answers</span></span><button class="btn sm" data-act="more-send">Send now</button></div>
        <div class="row ic"><span class="tile">${I.archive}</span><span class="rbody"><span class="rtitle">Back up audio</span><span class="rmeta">4 recordings · 7.9 MB</span></span><button class="btn sm" data-act="more-backup">Back up</button></div>
      </div>
      <div class="sh"><h2>Recordings</h2><span class="sh-count">${REC.length}</span></div>
      <div class="group mo-recs">${REC.map((r, i) => `
        <div class="mo-rec" data-i="${i}">
          <button class="row mo-rec-top" data-act="more-rec" aria-expanded="false"><span class="mo-play">${I.wave}</span>
            <span class="rbody"><span class="rtitle wrap">${esc(r.first)}</span>
              <span class="rmeta"><span class="mo-st" style="--c:${r.status[1]}">${r.status[0]}</span><span class="ell">${r.date} · <span class="num">${r.dur}</span></span></span></span>
            <span class="mo-caret">${I.chevD}</span></button>
          <div class="mo-rec-more"><div>
            <p class="mo-rec-full">${esc(r.first.replace('…', ''))}.${i === 0 ? ' And keep the jobs right at the front, the coding part, I use it a lot.' : ''}</p>
            <p class="mo-rec-src">${{ Capture: 'Recorded in Capture', Keyboard: 'Recorded from the keyboard', 'Wyn chat': 'Recorded in a Wyn chat' }[r.src] ?? esc(r.src)}</p>
            <div class="mo-rec-acts">
              <button class="btn sm" data-act="more-play">${I.play}Play</button>
              <button class="btn sm" data-act="more-copytext">${I.copy}Copy</button>
              <button class="btn sm" data-act="more-idea">${I.bulb}Use as idea</button>
              ${r.status[0] !== 'Transcribed' ? `<button class="btn sm" data-act="more-retry">${I.sync}Retry</button>` : ''}
              <button class="btn sm mo-del" data-act="more-del" aria-label="Delete recording">${I.trash}</button>
            </div>
          </div></div>
        </div>`).join('')}</div>`;
    },
  });
}
on('more-voice', () => openVoice());
on('more-rec', (el) => { const r = el.closest('.mo-rec'); const o = r.classList.toggle('open'); el.setAttribute('aria-expanded', String(o)); haptic(5); });
on('more-send', (el) => { el.innerHTML = '<span class="spin"></span>'; setTimeout(() => { el.textContent = 'Sent'; toast('Recording sent to your PC'); }, 900); });
on('more-backup', () => toast('Backing up 4 recordings'));
on('more-play', (el) => { el.innerHTML = el.textContent.includes('Pause') ? `${I.play}Play` : `${I.pause}Pause`; });
on('more-copytext', () => toast('Text copied'));
on('more-idea', () => toast('Saved as an idea'));
on('more-retry', () => toast('Retrying the transcription'));
on('more-del', (el) => {
  const r = el.closest('.mo-rec'); const parent = r.parentElement; const next = r.nextElementSibling;
  r.classList.add('mo-out'); setTimeout(() => r.remove(), 250);
  toast('Recording deleted', () => { r.classList.remove('mo-out'); parent.insertBefore(r, next); });
});

// ── module pages ─────────────────────────────────────────────────────
// Real mode: the module's own page from your PC (app/modules through window.AOS). Demo: the prototype's pages below.
const head = (m, sub) => `<div class="phead mo-head">${ic(m, 'lg')}<h1 class="lt">${esc(m.title)}</h1><p class="sub">${sub}</p></div>`;
const sw = (onn, label = 'Keep') => `<button class="switch${onn ? ' on' : ''}" data-act="mod-switch" aria-label="${esc(label)}"></button>`;
const hrs = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const areaChip = (s) => `<button class="chip sm" data-act="mod-pick"><i class="dot" style="--c:${area(s).color}"></i>${esc(area(s).name.split(' ')[0])}</button>`;

const PAGES = {
  cabinet: (m) => `${head(m, 'Your areas argue for next week\'s hours. You decide.')}
    <div class="mo-card mo-hero"><p class="foot">Next sitting</p><p class="t2">Saturday 19:00, or now</p><p class="foot">Each area makes its case from goals, late tasks and last week's hours.</p><div class="mo-acts"><button class="btn sm primary" data-act="mod-run">${I.play}Run now</button><button class="btn sm" data-act="mod-toast" data-t="Opens the last transcript">Transcript</button></div></div>
    <div class="sh"><h2>The plan for 26 Oct – 1 Nov</h2></div>
    <div class="group">${[['northwind', '10h', 'Two payments are late; one sales call a day.'], ['content', '6h', 'One shoot block Tue and Fri covers 7 reels.'], ['projects', '14h', 'Atlas ERP wave 1 has to merge before Wednesday.'], ['personal', '9h', 'Gym five mornings; cardio kept.']].map(([s, h, why]) => `<div class="row ic mo-ask"><span class="tile mo-aglyph" style="--t:${area(s).color}">${areaIcon[s]}</span><span class="rbody"><span class="rtitle">${esc(area(s).name)}</span><span class="mo-why">${esc(why)}</span></span><b class="met mo-v">${h}</b></div>`).join('')}</div>
    <div class="sh"><h2>Conflicts</h2><span class="sh-count">2</span></div>
    <div class="group">${[['Thu 17:00', 'northwind', 'content', 'Sales call or the shoot'], ['Sat 10:00', 'projects', 'personal', 'Atlas ERP merge or the long run']].map(([when, a, b, t]) => `<div class="row mo-conf"><span class="rbody"><span class="rtitle">${t}</span><span class="rmeta num">${when}</span></span><span class="chips mo-pick">${areaChip(a)}${areaChip(b)}</span></div>`).join('')}</div>
    <div class="sh"><h2>Blocks</h2><span class="sh-count">5</span><button class="sh-act" data-act="mod-keepall">Keep all</button></div>
    <div class="group">${[['Mon 17:00–19:00', 'Sales calls', 'northwind', 1], ['Tue 18:00–19:30', 'Shoot pack: 4 reels', 'content', 1], ['Wed 16:30–18:45', 'Atlas ERP wave 1 merge', 'projects', 1], ['Fri 18:00–19:30', 'Shoot pack: 3 reels', 'content', 0], ['Sat 19:00–22:00', 'Friends', 'personal', 1]].map(([w, t, s, k]) => `<div class="row mo-block"><span class="dot" style="--c:${area(s).color}"></span><span class="rbody"><span class="rtitle">${esc(t)}</span><span class="rmeta num">${w}</span></span>${sw(k, `Keep ${t}`)}</div>`).join('')}</div>`,

  clients: (m) => `${head(m, 'A private page per client. They answer, you see it here.')}
    <div class="sh"><h2>Client links</h2><span class="sh-count">3</span></div>
    <div class="group">${[['Harborline OS', 'your-server.example/c/harb-8f2k', 'Opened 2h ago'], ['Glowbox', 'your-server.example/c/glow-q71x', 'Not opened yet'], ['Atlas ERP', 'your-server.example/c/atls-3ad9', 'Opened yesterday']].map(([n, l, s]) => `<div class="row ic"><span class="tile">${I.link}</span><span class="rbody"><span class="rtitle">${n}</span><span class="rmeta"><span class="mo-link ell">${l}</span></span><span class="rmeta">${s}</span></span><button class="gbtn icon mo-ib" data-act="mod-toast" data-t="Link copied" aria-label="Copy">${I.copy}</button></div>`).join('')}
      <button class="row lf-add" data-act="mod-toast" data-t="New client link">${I.plus}<span>New client</span></button></div>
    <div class="pad mo-foot"><button class="btn block" data-act="mod-toast" data-t="Ask a client">${I.chat}Ask a client</button></div>`,

  ribbon: (m) => {
    const H = hrs(6, 21);
    const plan = { 6: 'personal', 7: 'personal', 10: 'college', 13: 'college', 14: 'college', 15: 'college', 16: 'projects', 17: 'projects', 18: 'projects', 19: null, 20: null };
    const real = { 6: 'personal', 7: 'personal', 9: 'projects', 10: 'college', 11: 'projects', 12: 'projects', 13: 'college', 14: 'college' };
    const strip = (map, upto) => `<div class="mo-strip">${H.map((h) => { const s = map[h]; const has = h in map; return `<i class="${h > upto ? 'fut' : ''}" style="${has ? `background:${s ? area(s).color : 'var(--a-none)'}` : ''}"></i>`; }).join('')}</div>`;
    return `${head(m, 'Today, as it happened, next to what you planned.')}
    <div class="mo-card">
      <div class="mo-ribrow"><span class="foot">Plan</span>${strip(plan, 22)}</div>
      <div class="mo-ribrow"><span class="foot">Real</span>${strip(real, 14)}</div>
      <div class="mo-ticks"><span class="mo-tk">${[6, 10, 14, 18, 21].map((h) => `<i style="left:${((h - 6 + .5) / 16) * 100}%">${String(h).padStart(2, '0')}</i>`).join('')}</span></div>
      <div class="mo-rstats">${[['projects', '2h 10m'], ['college', '1h 45m'], ['personal', '1h 30m']].map(([s, t]) => `<span class="mo-rs"><span class="mo-rs-n"><i class="dot" style="--c:${area(s).color}"></i>${esc(area(s).name.split(' ')[0])}</span><b class="met">${t}</b></span>`).join('')}</div>
    </div>
    <div class="sh"><h2>By project</h2></div>
    <div class="group">${[['Agentic OS', 70, '1h 25m', '#2bb39a'], ['Atlas ERP', 30, '35m', '#7c5cff'], ['Content OS', 12, '10m', '#f2b134']].map(([n, p, t, c]) => `<div class="row mo-prow"><span class="rbody"><span class="mo-prow-t"><span class="rtitle">${n}</span><b class="num">${t}</b></span><span class="bar mo-pbar" style="--p:${p}%;--c:${c}"><i></i></span></span></div>`).join('')}</div>
    <div class="sh"><h2>Started by itself</h2></div>
    <div class="group"><div class="row ic"><span class="tile">${I.claude}</span><span class="rbody"><span class="rtitle">j15 ran 45m while you were in GE I</span><span class="rmeta">Counted under Agentic OS</span></span></div></div>
    <div class="sh"><h2>No area yet</h2><span class="sh-count">2</span></div>
    <div class="group">${[['YouTube · 25m', '12:10–12:35'], ['Chrome: shiprocket.in · 15m', '11:40–11:55']].map(([t, w]) => `<div class="row"><span class="rbody"><span class="rtitle">${t}</span><span class="rmeta num">${w}</span></span><button class="btn sm mo-tagbtn" data-act="mod-toast" data-t="Tagged">Tag</button></div>`).join('')}</div>
    <div class="sh"><h2>Rules to keep</h2></div>
    <div class="group"><div class="row"><span class="rbody"><span class="rtitle">"shiprocket" → Corner Market</span><span class="rmeta">Seen 4 times this week</span></span>${sw(true, 'Keep this rule')}</div></div>`;
  },

  weather: (m) => {
    const load = [['Mon', 7, 9], ['Tue', 8, 9], ['Wed', 9, 9], ['Thu', 11.5, 9], ['Fri', 8, 9], ['Sat', 6, 8], ['Sun', 3, 6]];
    return `${head(m, 'A forecast for the week from deadlines, standing blocks and pace.')}
    <div class="mo-card mo-fc"><div class="mo-fc-t"><p class="mo-fc-h">Stormy Thursday</p><p class="foot mo-fc-s">11h 30m booked on a 9h day, and three deadlines meet. Clear from Saturday.</p></div>
      ${ring(11.5 / 9, 'today', 96, 12, { inner: '<b class="met mo-fc-n">128<small>%</small></b>', label: 'Thursday is booked to 128% of a usual day' })}</div>
    <div class="sh"><h2>Load per day</h2></div>
    <div class="mo-card mo-load"><div class="mo-rings">${load.map(([d, v, cap]) => `<div class="mo-rcol${v > cap ? ' over' : ''}">${ring(v / cap, 'today', 40, 6, { label: `${d}: ${v} hours booked on a ${cap} hour day` })}<b>${d}</b><span class="met">${v}h</span></div>`).join('')}</div>
      <p class="foot mo-bfoot">A full ring is what you usually get done that day.</p></div>
    <div class="sh"><h2>Odds this week</h2></div>
    <div class="group">${[['Atlas ERP wave 1 by Wed', 38, 'var(--fail-ink)'], ['Harborline payment by Sun', 55, 'var(--needs-ink)'], ['7 reels this week', 72, 'var(--done)']].map(([t, p, c]) => `<div class="row"><span class="rbody"><span class="rtitle">${t}</span></span><span class="pill num" style="--c:${c}">${p}%</span></div>`).join('')}</div>
    <div class="sh"><h2>Three changes that move it most</h2></div>
    <div class="group">${['Move the Thursday shoot to Saturday morning', 'Hand the Atlas ERP reports area to a Codex job tonight', 'Drop the Friday sales prep; reuse Monday\'s deck'].map((t, i) => `<div class="row mo-chg"><span class="lf-mv-n">${i + 1}</span><span class="rbody"><span class="rtitle wrap">${t}</span></span><button class="btn sm" data-act="mod-apply">Apply</button></div>`).join('')}</div>`;
  },

  demand: (m) => `${head(m, 'The same ask from more than one client, ranked, with a price guess.')}
    <div class="mo-cards">${[
      ['WhatsApp catalogue for shops', 4, ['"Can customers see the stock on WhatsApp?"', '"Send the new kurtas to my list"'], '₹8,000–12,000'],
      ['GST export from the counter', 3, ['"My CA wants the GST sheet every month"'], '₹5,000 one-time'],
      ['Staff attendance on the phone', 2, ['"Who came late this week?"'], '₹3,000 a month'],
    ].map(([t, n, asks, price], i) => `<div class="mo-card mo-cl">
      <div class="mo-cl-top"><span class="mo-rank">${i + 1}</span><span class="rbody"><p class="t2">${t}</p><p class="foot">Asked by ${n} clients</p></span></div>
      ${asks.map((a) => `<p class="mo-quote">${esc(a)}</p>`).join('')}
      <div class="mo-kv"><span class="foot">Price guess</span><b class="num">${price}</b></div>
      <div class="mo-acts"><button class="btn sm" data-act="mod-toast" data-t="Started a Build job">${I.hammer}Build</button><button class="btn sm" data-act="mod-toast" data-t="Opens the spec">Spec</button><button class="btn sm" data-act="mod-toast" data-t="Opens the landing draft">Landing</button><button class="btn sm mo-drop" data-act="mod-drop" aria-label="Drop this ask">${I.trash}</button></div>
    </div>`).join('')}</div>
    <div class="sh"><h2>Paste asks</h2></div>
    <div class="pad"><div class="field"><input placeholder="Paste a WhatsApp message or call note" aria-label="Paste an ask" /><button class="fbtn" data-act="mod-toast" data-t="Added to the radar" aria-label="Add to the radar">${I.up}</button></div></div>
    <div class="pad mo-foot"><button class="btn block" data-act="mod-run">${I.radar}Run the radar now</button></div>`,

  doctrine: (m) => `${head(m, 'Rules the planner learns from how your weeks really go.')}
    <div class="mo-card mo-hero"><p class="foot">This week's observation</p><p class="t2 mo-obs">You finish 80% of deep work before 13:00, and 20% after.</p>
      <div class="mo-ev">${[['Mon 19', 'Atlas ERP merge', '09:00–11:30', 'done'], ['Tue 20', 'Agentic OS jobs board', '10:00–12:00', 'done'], ['Tue 20', 'Atlas ERP reports', '16:30–18:45', 'skipped']].map(([d, t, w, s]) => `<div class="mo-evrow"><span class="foot num">${d}</span><span class="mo-evt"><span>${t}</span><small class="num">${w}</small></span><span class="pill" style="--c:${s === 'done' ? 'var(--done)' : 'var(--fail-ink)'}">${s === 'done' ? 'Done' : 'Skipped'}</span></div>`).join('')}</div>
      <div class="mo-acts"><button class="btn sm primary" data-act="mod-toast" data-t="Rule added">Accept rule</button><button class="btn sm" data-act="mod-toast" data-t="Noted. Not a rule.">Not this</button></div></div>
    <div class="sh"><h2>Rules the planner obeys</h2><span class="sh-count">3</span></div>
    <div class="group">${['Deep work goes before 13:00', 'No calls during GE I or P&S', 'One rest day after three late nights'].map((r) => `<div class="row"><span class="rbody"><span class="rtitle wrap">${r}</span></span>${sw(true, r)}</div>`).join('')}</div>
    <div class="sh"><h2>Past observations</h2></div>
    <div class="group">${[['Shoots slip when planned after 20:00', '12 Oct · accepted'], ['Sunday plans hold better than Monday plans', '5 Oct · dismissed']].map(([t, s]) => `<div class="row"><span class="rbody"><span class="rtitle wrap">${t}</span><span class="rmeta">${s}</span></span></div>`).join('')}</div>`,

  thumbs: (m) => `${head(m, 'The OS reads where your thumbs go and redesigns itself.')}
    <div class="sh"><h2>Opens this month</h2></div>
    <div class="mo-card">${[['Jobs', 412, 'var(--jobs)'], ['Today', 288, 'var(--today)'], ['Capture', 140, 'var(--ink-2)'], ['Content', 97, 'var(--content)'], ['Life', 18, 'var(--life)']].map(([n, v, c]) => `<div class="mo-use"><span class="mo-use-n">${n}</span><span class="bar" style="--p:${(v / 412) * 100}%;--c:${c}"><i></i></span><span class="met mo-use-v">${v}</span></div>`).join('')}<p class="foot mo-bfoot">Counted from 1 Oct.</p></div>
    <div class="sh"><h2>Proposals</h2><span class="sh-count">3</span></div>
    <div class="mo-cards">${[
      ['Jobs on the Today screen', 'You open Jobs 412 times and Today 288. Put live jobs at the top of Today.', 'jobs'],
      ['Content as its own tab', 'You reach Content through More 97 times a month, 3 taps each.', 'tab'],
      ['Hold + to start a job', 'You switch the capture type to Job in 61% of captures.', 'hold'],
    ].map(([t, why, k]) => `<div class="mo-card mo-prop"><span class="mo-mock ${k}" aria-hidden="true"><i></i><i></i><i></i></span><span class="rbody"><p class="t2">${t}</p><p class="foot">${why}</p><span class="mo-acts"><button class="btn sm" data-act="mod-toast" data-t="Trying it for a week">Try it</button><button class="btn sm" data-act="mod-drop">Dismiss</button></span></span></div>`).join('')}</div>`,

  price: (m) => `${head(m, 'What an hour is worth, and what each block pushes out.')}
    <div class="sh"><h2>Rates</h2></div>
    <div class="group">${[['Client work', '₹1,000/h'], ['Content', '₹800/h'], ['Learning', '₹400/h'], ['Rest', 'Not priced']].map(([n, v]) => `<button class="row" data-act="mod-toast" data-t="Edit the ${n.toLowerCase()} rate"><span class="rbody"><span class="rtitle">${n}</span></span><span class="rend num">${v}</span>${I.chevR}</button>`).join('')}</div>
    <div class="sh"><h2>Today's blocks</h2></div>
    <div class="group">${EVENTS.filter((e) => !e.sleep && e.start >= 13 * 60).map((e) => { const h = (e.end - e.start) / 60; const s = e.area; const v = s === 'projects' ? 1000 : s === 'content' ? 800 : s === 'college' ? 400 : 0; const fmt = (x) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; return `<div class="row mo-blk"><span class="dot" style="--c:${area(s).color}"></span><span class="rbody"><span class="rtitle wrap">${esc(e.title)}</span><span class="rmeta num">${fmt(e.start)}–${fmt(e.end)} · ${v ? `displaces ${s === 'projects' ? 'content' : 'client work'}` : 'rest'}</span></span><span class="rend num mo-rupee${v ? '' : ' off'}">${v ? `₹${Math.round(v * h).toLocaleString('en-IN')}` : 'Not priced'}</span></div>`; }).join('')}</div>`,

  runbooks: (m) => `${head(m, 'Work you repeat, written once, run by an agent.')}
    <div class="group mo-books">${[
      ['Ship a client site', 7, 'Ready', ['Pull the brief from the client page', 'Clone the storefront template', 'Fill the catalog from the sheet', 'Deploy to a preview link']],
      ['Monthly invoices', 5, 'Ready', null],
      ['New reel from a voice note', 6, 'Draft', null],
      ['Onboard a new client', 9, 'Ready', null],
    ].map(([t, n, st, steps], i) => `<div class="mo-book${i === 0 ? ' open' : ''}">
      <div class="row ic mo-book-top">
        <button class="mo-book-hit" data-act="mod-book" aria-expanded="${i === 0}"><span class="tile">${I.book}</span><span class="rbody"><span class="rtitle wrap">${t}</span><span class="rmeta"><span class="mo-st" style="--c:${st === 'Ready' ? 'var(--done)' : 'var(--ink-2)'}">${st}</span><span>${n} steps</span></span></span><span class="mo-caret">${I.chevD}</span></button>
        ${st === 'Ready' ? `<button class="btn sm" data-act="mod-toast" data-t="Started a job from the runbook">${I.play}Run</button>` : `<button class="btn sm" data-act="mod-toast" data-t="Marked ready">Mark ready</button>`}
      </div>
      <div class="mo-stepwrap"><div>${steps ? `<ol class="mo-steps">${steps.map((s) => `<li>${s}</li>`).join('')}</ol>` : ''}<div class="mo-stepfoot"><span class="foot">${steps ? `and ${n - steps.length} more steps` : `${n} steps, kept on your PC`}</span><button class="btn sm" data-act="mod-toast" data-t="${st === 'Ready' ? 'Back to draft' : 'Opens the draft'}">${st === 'Ready' ? 'Back to draft' : 'Edit draft'}</button></div></div></div>
    </div>`).join('')}</div>
    <div class="pad mo-foot"><button class="btn block" data-act="mod-run">${I.search}Scan for repeated work</button></div>`,

  bounty: (m) => `${head(m, 'Recurring work, priced in minutes and your hourly value.')}
    <div class="mo-card mo-pay"><span class="foot">Paid to yourself this month</span><span class="mo-pay-v met">₹<span data-count="4800">4,800</span></span><span class="foot">6 bounties taken</span></div>
    <div class="sh"><h2>Open bounties</h2><span class="sh-count">2</span></div>
    <div class="group mo-bounties">${[['Reconcile Shiprocket COD remittance', 45, 'Weekly · Corner Market'], ['Reply to Google reviews for the shop', 20, 'Weekly · Morgan & Co.']].map(([t, min, s]) => `<div class="row mo-bty"><span class="rbody"><span class="rtitle wrap">${t}</span><span class="rmeta num">${min}m × ₹1,000/h · ${s}</span></span><b class="met mo-bty-v">₹${Math.round(min / 60 * 1000)}</b><div class="mo-bty-a"><button class="btn sm" data-act="mod-take">${I.check}Take</button><button class="btn sm" data-act="mod-dismiss">Dismiss</button></div></div>`).join('')}</div>
    <div class="pad mo-foot"><button class="btn block" data-act="mod-run">${I.search}Scan for new bounties</button></div>`,

  ping: (m) => `${head(m, 'A test module. If this answers, modules are live on your PC.')}
    <div class="pad"><div class="field"><input id="moPing" placeholder="Say something" value="hello from the phone" aria-label="Message" /><button class="fbtn" data-act="mod-ping" aria-label="Send">${I.up}</button></div></div>
    <div class="group mo-log" id="moLog"><div class="row mo-logrow"><span class="pill num" style="--c:var(--done)">200</span><span class="mono">pong · 41 ms · 14:12</span></div></div>
    <div class="pad mo-foot"><button class="btn block" data-act="mod-ping">${I.sync}Ask again</button></div>`,
};

on('mod-open', (el) => {
  if (!DEMO_MODE) { AOS()?.openPage?.(el.dataset.id); return; }
  const m = mod(el.dataset.id); if (!m) return;
  push({ title: m.title, back: 'More', render(sc) { sc.innerHTML = PAGES[m.id](m); sc.classList.add(`mo-p-${m.id}`); } });
});
on('mod-toast', (el) => toast(el.dataset.t));
on('mod-switch', (el) => { el.classList.toggle('on'); haptic(6); });
on('mod-keepall', (el) => { $$('.switch', el.closest('.scroll')).forEach((s) => s.classList.add('on')); toast('Kept all blocks'); });
on('mod-pick', (el) => { $$('.chip', el.parentElement).forEach((c) => c.classList.toggle('on', c === el)); haptic(5); });
on('mod-run', (el) => { const t = el.innerHTML; el.innerHTML = '<span class="spin"></span>Running on your PC'; setTimeout(() => { el.innerHTML = t; toast('Done. Results updated'); }, 1300); });
on('mod-apply', (el) => { el.textContent = 'Applied'; el.disabled = true; toast('Calendar updated', () => { el.textContent = 'Apply'; el.disabled = false; }); });
on('mod-drop', (el) => {
  const c = el.closest('.mo-card'); const parent = c.parentElement; const next = c.nextElementSibling;
  c.classList.add('mo-out'); setTimeout(() => c.remove(), 260);
  toast('Dropped', () => { c.classList.remove('mo-out'); parent.insertBefore(c, next); });
});
on('mod-book', (el) => { const b = el.closest('.mo-book'); const o = b.classList.toggle('open'); el.setAttribute('aria-expanded', String(o)); haptic(5); });
on('mod-take', (el) => { el.closest('.row').classList.add('is-done'); el.parentElement.innerHTML = '<span class="pill" style="--c:var(--done)">Taken · on Today</span>'; toast('Bounty taken · added to Today'); });
on('mod-dismiss', (el) => { const r = el.closest('.row'); r.classList.add('mo-out'); setTimeout(() => r.remove(), 220); });
on('mod-ping', (el) => {
  const log = $('#moLog', el.closest('.scroll')); const v = $('#moPing', el.closest('.scroll'))?.value || 'ping';
  const ms = 30 + Math.round(Math.random() * 40);
  log.insertAdjacentHTML('afterbegin', `<div class="row mo-logrow rise"><span class="pill num" style="--c:var(--done)">200</span><span class="mono">echo "${esc(v)}" · ${ms} ms</span></div>`);
  haptic(6);
});
// the data source control in the demo account sheet
document.addEventListener('change', (e) => { if (DEMO_MODE && e.target.closest?.('[data-seg="more-data"]')) switchSource(e.detail); });

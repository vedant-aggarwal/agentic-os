// Ping: the reference module. Copy this file to start a new one (app/MODULES.md).
// Server side: server/modules/ping.ts answers /api/v1/mod/ping/ping and /echo.
// Design: j15/mockup/final/js/more.js PAGES.ping (app/ui/STRUCTURE.md, area (d)).
const { AOS } = window;
AOS.css('modules/ping.css');

const I = AOS.icons;
const ICON = I.ping;
const esc = AOS.esc;
const CARD_KEY = 'aos:ping-card';   // "1" shows one line on Today; off by default so Today stays clean
const cardOn = () => { try { return localStorage.getItem(CARD_KEY) === '1'; } catch { return false; } };
const setCard = (on) => { try { localStorage.setItem(CARD_KEY, on ? '1' : '0'); } catch {} };
const hhmm = (d = new Date()) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const head = () => `<div class="mp-head"><span class="mp-ic" aria-hidden="true">${ICON}</span><h1 class="large-title">Ping</h1><p class="sub">A test module. If this answers, modules are live on your PC.</p></div>`;
let info = null, error = null, last = null, pageEl = null, cardEl = null, lastM = null, asking = false;
const log = [];   // this visit's answers, newest first

// one request, timed: the answer and how long the round trip took
async function timed(fn) {
  const t0 = performance.now();
  try { const r = await fn(); return { ok: true, r, ms: Math.round(performance.now() - t0), at: new Date() }; }
  catch (e) { return { ok: false, error: e.message || 'Your PC isn’t reachable right now.', status: e.status ?? null, ms: Math.round(performance.now() - t0), at: new Date() }; }
}
const pill = (x) => `<span class="pill num" style="--c:${x.ok ? 'var(--done)' : 'var(--fail-ink)'}">${x.ok ? '200' : esc(x.status ?? 'No answer')}</span>`;

function renderCard(el, m) {
  if (!el) return;
  if (!cardOn()) { el.innerHTML = ''; return; }
  const meta = !last ? 'Opens the test module' : last.ok ? `Your PC answered in ${last.ms} ms at ${hhmm(last.at)}` : `No answer at ${hhmm(last.at)}`;
  el.innerHTML = `<button class="lrow b-row mcard" data-ping-open><span class="bi">${ICON}</span><span class="rbody"><span class="rtitle">${last && !last.ok ? 'Ping: your PC isn’t answering' : 'Ping: modules are live'}${m && !m.isToday ? ` · ${esc(m.date)}` : ''}</span><span class="rmeta"><span class="ell">${esc(meta)}</span></span></span>${I.chevR}</button>`;
}
function renderPage() {
  if (!pageEl?.isConnected) return;
  const input = pageEl.querySelector('[data-ping-form] input');
  const typed = input ? input.value : 'hello from the phone';
  const answer = asking && !last ? '<div class="mp-load" role="status"><span class="spin" aria-hidden="true"></span>Asking your PC</div>'
    : last ? `<section class="mp-card ping-answer" aria-live="polite">
        <p class="ping-line">${pill(last)}<span class="mono">${last.ok ? `pong · ${last.ms} ms · ${hhmm(last.at)}` : esc(last.error)}</span></p>
        ${info && last.ok ? `<pre class="ping-json mono">${esc(JSON.stringify(info, null, 2))}</pre>` : ''}
      </section>` : '';
  pageEl.innerHTML = `${head()}
    <form class="mp-add" data-ping-form><label class="ifield"><input type="text" value="${esc(typed)}" placeholder="Say something" aria-label="Message to echo" autocomplete="off" enterkeyhint="send"></label><button class="btn" type="submit">${I.up}Echo</button></form>
    ${answer}
    ${log.length ? `<div class="sh"><h2>This visit</h2><span class="sh-count">${log.length}</span></div><div class="group ping-log">${log.map((x) => `<div class="lrow ping-row">${pill(x)}<span class="rbody"><span class="rtitle mono">${esc(x.text)}</span></span><span class="rend num">${x.ms} ms</span></div>`).join('')}</div>` : ''}
    <div class="mp-foot"><button class="btn block" data-ping-reload ${asking ? 'disabled' : ''}>${asking ? '<span class="spin" aria-hidden="true"></span>Asking' : `${I.sync}Ask again`}</button></div>
    <div class="group ping-opts"><label class="lrow ping-sw"><span class="rbody"><span class="rtitle">Show a line on Today</span><span class="rmeta">Off by default, so Today stays clean</span></span><input type="checkbox" switch data-ping-card ${cardOn() ? 'checked' : ''} aria-label="Show a line on Today"></label></div>`;
}
async function load() {
  if (asking) return;
  asking = true;
  renderPage();
  const x = await timed(() => AOS.api('/api/v1/mod/ping/ping'));
  asking = false;
  last = x;
  info = x.ok ? x.r : null;
  error = x.ok ? null : x.error;
  if (pageEl?.isConnected) { log.unshift({ ...x, text: x.ok ? `ping · ${hhmm(x.at)}` : `ping · ${x.error}` }); log.length = Math.min(log.length, 10); }
  renderPage();
  renderCard(cardEl, lastM);
  figSync();
}
// More's row (app.js modFigure): the last round trip. Asked for once when More draws before any; More redraws
// when it changes and is on screen
let figKey = null, figAsked = 0;
function figure() {
  if (!last) { if (!asking && Date.now() - figAsked > 60_000) { figAsked = Date.now(); load(); } return null; }
  return last.ok ? { value: `${last.ms} ms`, label: 'Modules are live' } : { value: '', label: 'Your PC isn’t answering' };
}
function figSync() {
  const k = JSON.stringify(figure());
  if (k === figKey) return;
  figKey = k;
  const ui = AOS.ui?.();
  if (ui?.tab === 'more' && !ui.stack?.more?.length) AOS.renderTab?.('more');
}

AOS.register({
  id: 'ping', title: 'Ping', order: 900,
  icon: ICON, figure,
  page(el) {
    pageEl = el;
    el.classList.add('ping-page');
    renderPage();
    load();
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-ping-reload]')) load();
    });
    el.addEventListener('submit', async (e) => {
      const f = e.target.closest('[data-ping-form]');
      if (!f) return;
      e.preventDefault();
      const text = f.querySelector('input').value.trim() || 'ping';
      AOS.haptic('light');
      const x = await timed(() => AOS.api('/api/v1/mod/ping/echo', { method: 'POST', body: JSON.stringify({ hello: text, at: new Date().toISOString() }) }));
      log.unshift({ ...x, text: x.ok ? `echo “${x.r?.hello ?? text}”` : `echo · ${x.error}` });
      log.length = Math.min(log.length, 10);
      if (!x.ok) AOS.toast(x.error || 'Echo failed');
      renderPage();
    });
    el.addEventListener('change', (e) => {
      if (!e.target.matches('[data-ping-card]')) return;
      setCard(e.target.checked);
      AOS.haptic('selection');
      renderCard(cardEl, lastM);
    });
  },
  cards: {
    todayTop(el, m) {
      cardEl = el; lastM = m;
      if (!el._pingWired) { el._pingWired = true; el.addEventListener('click', (e) => { if (e.target.closest('[data-ping-open]')) { AOS.haptic('light'); AOS.openPage('ping'); } }); }
      renderCard(el, m);
    },
  },
  // the page refreshes after every sync; the Today line asks once a sync too, so what it says is current
  onData() { if (pageEl?.isConnected || (cardOn() && cardEl)) load(); },
});

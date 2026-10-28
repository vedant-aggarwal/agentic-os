// Her thread: the one conversation for everything (the shape Duet, Muse and dots share), on the real Wyn. Opened from
// her tab, from the ✦ in every app (with that app's context chip and prompts) and from Today. Messages come from the PC
// (GET /wyn, then the long-poll), what she changed rides on her message as cards with Undo (core changes and the apps'
// own tools), an agent's question is answered in place, a call leaves its summary and action points. What he sends goes
// out at once, or waits in the outbox while the PC is away. Dictation is on device (the iPhone's Speech plugin, or the
// browser's speech recognition), so a voice note is just words to her.
import { $, $$, esc, openSheet, closeSheet, toast, haptic, on, ring, pulse } from './core.js';
import { I } from './icons.js';
import { aspect, person, DEMO_MODE } from './data.js';
import { api, has } from './bus.js';
import { summary } from './aspects.js';
import { native } from './svc/native-plugins.js';
import { AG, AI, changed, onChange, agName, aspName, dot, tileFor, home, nextLabel, beatP, act, undoItem, undoChange, answer, seen, loadThread, pollNow } from './agent-state.js';
import { PROMPTS, OPEN_LINE, hmOf } from './agent-data.js';
import { askHtml, answerCard, dayWord } from './agent-home.js';

let C = null;   // the open thread: { el, ctx, rec }
export function openChat({ prompt = '', aspect: asp = null, about = null, mode = null } = {}) {
  const ctx = asp || about ? { aspect: asp ?? personAspect(about), about } : null;
  if (C?.el?.isConnected) { setCtx(ctx); if (prompt) send(prompt); else if (mode === 'voice') startVoice(); return C.el; }
  const st = { ctx: null, rec: null };
  C = st;
  AG.thread.open = true;
  const name = esc(agName());
  st.el = openSheet({
    large: true, cls: 'wyn-sheet ag-chat',
    head: `<div class="wyn-head">
        <span class="ag-hd" aria-hidden="true">${ring(beatP(), 'ag', 52, 2, { cls: 'ag-beat' })}<span class="orb hd"></span></span>
        <div class="nh-text"><h3>${name}</h3><p><i class="live${AG.offline ? ' off' : ''}" aria-hidden="true"></i><span class="nh-status">${esc(statusLine())}</span></p></div>
        <button class="nh-btn call" data-act="ag-call" aria-label="Call ${name}">${I.phone}</button>
        <button class="nh-btn" data-act="ag-chat-her" aria-label="${name}: settings">${I.dots}</button>
      </div>
      <div class="ag-ctxbar" hidden></div>`,
    body: (b) => { b.innerHTML = '<div class="ag-thread" role="log" aria-label="Your thread with her" aria-live="polite"></div>'; },
    foot: `<div class="wyn-foot ag-foot">
        <div class="nf-quick" data-scroll-x role="list" aria-label="Things to say"></div>
        <div class="ag-tray" data-scroll-x hidden>
          <button class="ag-tr" data-act="ag-tr-cam"><span class="tile">${I.camera}</span><span>Camera</span></button>
          <button class="ag-tr" data-act="ag-tr-scan" data-mode="document"><span class="tile">${I.doc}</span><span>Scan a page</span></button>
          <button class="ag-tr" data-act="ag-tr-scan" data-mode="receipt"><span class="tile">${I.coin ?? I.doc}</span><span>A receipt</span></button>
        </div>
        <div class="ag-rec" hidden></div>
        <form class="nf-bar" autocomplete="off">
          <button type="button" class="ag-plus" data-act="ag-attach" aria-label="Attach a photo or a scan" aria-expanded="false">${I.plus}</button>
          <div class="field nf-field"><input type="text" placeholder="Message ${name}" enterkeyhint="send" aria-label="Message ${name}" />
            <button type="button" class="fbtn" data-act="ag-mic" aria-label="Say it instead">${I.mic}</button></div>
          <button type="submit" class="nf-send" aria-label="Send" disabled>${I.up}</button>
        </form>
      </div>`,
    onClose: () => { st.rec?.cancel(); st.kbOff?.(); if (C === st) { C = null; AG.thread.open = false; } },
  });
  const input = $('.nf-bar input', st.el);
  input.addEventListener('input', () => { $('.nf-send', st.el).disabled = !input.value.trim(); });
  $('.nf-bar', st.el).addEventListener('submit', (e) => { e.preventDefault(); const v = input.value; input.value = ''; $('.nf-send', st.el).disabled = true; send(v); });
  st.kbOff = liftWithKeyboard(st.el);
  setCtx(ctx, true);
  render(true);
  if (!AG.thread.loaded) loadThread().then(() => render(true));
  // she told him things he hasn't opened: now he has, so the ladder stops climbing
  const unseen = AG.items.filter((x) => x.kind === 'nudge' && x.status === 'open' && !x.ladder?.seen).map((x) => x.id);
  if (unseen.length) seen(unseen).catch(() => {});
  if (prompt) setTimeout(() => send(prompt), 380);
  else if (mode === 'voice') setTimeout(startVoice, 420);
  return st.el;
}
const personAspect = (about) => (about && person(about)?.aspect) || (about === 'content' ? 'content' : null);
function statusLine() {
  const b = AG.thread.busy?.status;
  if (b) return `${b}…`;
  if (AG.offline) return 'Your PC is away · messages wait and send';
  return AG.heartbeat?.on ? `Awake · next check ${nextLabel()}` : 'Awake';
}

// the chip says where you came from; under it, what she can do there (from the app's own tools)
function setCtx(ctx, first = false) {
  const st = C; if (!st) return;
  st.ctx = ctx;
  const bar = $('.ag-ctxbar', st.el);
  if (ctx?.aspect) {
    const id = ctx.aspect, p = ctx.about && person(ctx.about);
    const line = p ? p.role : contextLine(id);
    bar.innerHTML = `<div class="ag-ctx">${dot(id)}<b>${esc(p ? p.name : aspName(id))}</b><span>${esc(line)}</span>
      <button class="ag-ctx-x" data-act="ag-ctx-x" aria-label="Talk about everything, not just ${esc(p ? p.name : aspName(id))}">${I.x}</button></div>`;
    bar.hidden = false;
  } else { bar.hidden = true; bar.innerHTML = ''; }
  prompts();
  if (!first) render(true);
}
function contextLine(id) {
  try {
    if (id === 'content' && has('contentSummary')) return api.contentSummary()?.line ?? '';
    const w = AG.watching?.find((x) => x.app === id)?.line;
    return summary(id)?.line ?? w ?? aspect(id)?.line ?? '';
  } catch { return AG.watching?.find((x) => x.app === id)?.line ?? ''; }
}
function prompts() {
  const st = C; if (!st) return;
  const list = PROMPTS[st.ctx?.aspect] ?? PROMPTS.default;
  $('.nf-quick', st.el).innerHTML = list.map((q) => `<button class="qchip" role="listitem" data-act="ag-q" data-q="${esc(q)}">${esc(q)}</button>`).join('');
}

// ── rendering the real thread ────────────────────────────────────────
const SAY = new Map();       // a pending message he sent: local id → { text, at, queued }
function rows() {
  const out = [];
  const list = AG.thread.messages ?? [];
  let lastAt = 0, lastDay = '';
  const push = (m) => {
    const t = Date.parse(m.at ?? '') || Date.now();
    const day = new Date(t + 330 * 60000).toISOString().slice(0, 10);
    if (day !== lastDay || t - lastAt > 45 * 60000) out.push({ k: 'time', at: m.at });
    lastAt = t; lastDay = day;
    out.push(m);
  };
  for (const m of list) push({ k: 'msg', ...m });
  // what he sent that the PC hasn't confirmed yet
  for (const [id, p] of SAY) {
    if (list.some((m) => m.role === 'user' && m.text === p.text && Date.parse(m.at) >= p.at - 60000)) { SAY.delete(id); continue; }
    push({ k: 'msg', id, role: 'user', text: p.text, at: new Date(p.at).toISOString(), pending: true, queued: p.queued });
  }
  if (C?.ctx?.aspect) out.push({ k: 'ctx', app: C.ctx.aspect });
  if (AG.thread.busy) out.push({ k: 'typing', status: AG.thread.busy.status });
  if (!list.length && !SAY.size) out.unshift({ k: 'empty' });
  return out;
}
function render(toEnd = false) {
  const st = C; if (!st?.el?.isConnected) return;
  const box = $('.ag-thread', st.el), body = $('.sheet-body', st.el);
  const nearEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 140;
  const y = body.scrollTop;
  box.innerHTML = groups(rows()).map(itemHtml).join('');
  const s = $('.nh-status', st.el); if (s) s.textContent = statusLine();
  if (toEnd || nearEnd) { body.scrollTop = body.scrollHeight; requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; }); }
  else body.scrollTop = y;
}
// consecutive bubbles from the same side sit in one group, as in Messages; her cards follow the bubble that carries them
function groups(list) {
  const out = [];
  for (const m of list) {
    const g = out[out.length - 1];
    const who = m.role === 'user' ? 'me' : m.role === 'wyn' ? 'her' : null;
    if (m.k === 'msg' && who && g?.k === 'grp' && g.who === who && !g.cards) { g.items.push(m); if (hasCards(m)) g.cards = true; }
    else if (m.k === 'msg' && who) out.push({ k: 'grp', who, items: [m], cards: hasCards(m) });
    else out.push(m);
  }
  return out;
}
const hasCards = (m) => !!(m.meta?.changes?.length || m.meta?.did?.length || m.meta?.askState);
function itemHtml(m) {
  if (m.k === 'time') return `<p class="nb-time">${esc(dayWord(m.at))}</p>`;
  if (m.k === 'typing') return `<div class="grp her"><div class="bub typing" aria-label="She is ${esc(m.status ?? 'typing')}"><i></i><i></i><i></i></div>${m.status && m.status !== 'Typing' && m.status !== 'Thinking' ? `<span class="ag-busy">${esc(m.status)}…</span>` : ''}</div>`;
  if (m.k === 'empty') return `<div class="ag-empty"><span class="orb md" aria-hidden="true"></span><p><b>This is your thread with ${esc(agName())}.</b> Tell her anything: a task, what you spent, how the day went. She files it in the right app and tells you what she did.</p></div>`;
  if (m.k === 'ctx') return ctxCard(m.app);
  if (m.k === 'grp') return `<div class="grp ${m.who === 'me' ? 'me' : 'her'}">${m.items.map(bubble).join('')}</div>${m.items.map(cardsOf).join('')}`;
  if (m.k === 'msg' && m.role === 'call') return `<div class="ag-cwrap">${callCard(m)}</div>`;
  if (m.k === 'msg' && m.role === 'system') return `<p class="ag-sys">${I.x}<span>${esc(m.text)}</span></p>`;
  return '';
}
function bubble(m) {
  const cls = `bub${m.pending ? ' pending' : ''}`;
  const tail = m.pending ? `<small class="ag-pend">${m.queued ? 'Waiting for your PC' : 'Sending…'}</small>` : '';
  return `<div class="${cls}">${linkify(m.text)}${tail}</div>`;
}
const linkify = (t) => esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');
// what she did on that message, with Undo per change
function cardsOf(m) {
  const ch = m.meta?.changes ?? [], did = (m.meta?.did ?? []).filter((x) => x.kind !== 'ask');
  const asks = (m.meta?.did ?? []).filter((x) => x.kind === 'ask' && x.status === 'open');
  let html = '';
  if (ch.length || did.length) {
    const rowsHtml = [
      ...did.map((x) => `<li class="${x.undone ? 'off' : ''}">${tileFor(home(x), 'sm')}<span>${esc(x.title)}</span>${x.undo && !x.undone ? `<button class="btn sm" data-act="ag-undo-did" data-id="${esc(x.id)}">Undo</button>` : x.undone ? '<small>Undone</small>' : ''}</li>`),
      ...ch.map((c) => `<li class="${c.undone ? 'off' : ''}">${tileFor('tasks', 'sm')}<span>${esc(c.label)}</span>${!c.undone ? `<button class="btn sm" data-act="ag-undo-ch" data-id="${c.id}">Undo</button>` : '<small>Undone</small>'}</li>`),
    ].join('');
    html += `<div class="ag-cwrap"><div class="ag-card ag-didc"><div class="ag-card-k">${AI.heartbeat}<span>What I did</span>${m.at ? `<time class="num">${esc(hmOf(m.at))}</time>` : ''}</div><ul class="ag-didl">${rowsHtml}</ul></div></div>`;
  }
  for (const a of asks) { const full = AG.asks.find((x) => x.id === a.id); if (full) html += `<div class="ag-cwrap">${askHtml(full)}</div>`; }
  const q = m.meta?.askState;
  if (q && ['asked', 'calling', 'scheduled'].includes(q.status)) {
    html += `<div class="ag-cwrap"><article class="ag-ask" data-ask="${esc(q.id)}"><div class="ag-ask-k">${tileFor('agent')}<span>${esc(q.from)} asks</span></div>
      <div class="ag-ask-acts"><button class="btn sm ag-yes" data-act="ag-reply" data-id="${esc(q.id)}">Answer</button><button class="btn sm ag-ghost" data-act="ag-no" data-id="${esc(q.id)}">Not now</button></div></article></div>`;
  } else if (q && q.status === 'answered' && q.answer) {
    html += `<p class="ag-sys ok">${I.check}<span>Passed to ${esc(q.from)}: ${esc(String(q.answer).slice(0, 120))}</span></p>`;
  }
  return html;
}
function callCard(m) {
  const meta = m.meta ?? {}, mins = meta.seconds ? Math.max(1, Math.round(meta.seconds / 60)) : null;
  const pts = Array.isArray(meta.actions) ? meta.actions : [];
  return `<div class="ag-card ag-callc">
      <div class="ag-card-k">${tileFor('growth')}<span>Call${mins ? ` · ${mins} min` : ''}</span><time class="num">${esc(hmOf(m.at))}</time></div>
      <p class="ag-card-p">${esc(m.text)}</p>
      ${pts.length ? `<ul class="ag-points">${pts.map((p) => `<li>${I.check}<span>${esc(p)}</span></li>`).join('')}</ul>` : ''}
      <div class="ag-card-f">${meta.callId ? `<button class="btn sm" data-act="ag-transcript" data-id="${esc(meta.callId)}">${I.doc}Transcript</button>` : ''}</div>
    </div>`;
}
// where you came from: what she does in this app, on her own or after asking
function ctxCard(app) {
  return `<div class="ag-cwrap"><div class="ag-card ag-toolsc"><div class="ag-card-k">${tileFor(app)}<span>${esc(aspName(app))}</span></div>
      <p class="ag-card-p">${esc(OPEN_LINE(app, agName()))}</p>
      <div class="ag-card-f"><button class="btn sm ag-open" data-act="ag-go-tools">What I can do here${I.chevR}</button></div></div></div>`;
}

// ── talking ──────────────────────────────────────────────────────────
let seq = 0;
export async function send(text) {
  const st = C; text = String(text ?? '').trim(); if (!st || !text) return;
  haptic(8);
  $('.ag-tray', st.el).hidden = true; $('.ag-plus', st.el).setAttribute('aria-expanded', 'false');
  const id = `p${++seq}`;
  SAY.set(id, { text, at: Date.now(), queued: false });
  render(true);
  if (DEMO_MODE) {
    setTimeout(() => {
      SAY.delete(id);
      const n = AG.thread.messages.length + 100;
      AG.thread.messages.push({ id: n, role: 'user', text, at: new Date().toISOString() }, { id: n + 1, role: 'wyn', text: 'This is demo mode, so nothing changed. On your PC I\'d do that for real and show you what I did, with Undo.', at: new Date().toISOString() });
      render(true);
    }, 700);
    return;
  }
  try {
    const r = await act('/wyn/messages', { text });
    if (r?.queued) { SAY.get(id) && (SAY.get(id).queued = true); render(); toast('Saved. It goes to her when your PC is back.'); }
    else { AG.thread.busy = AG.thread.busy ?? { status: 'Thinking' }; render(true); pollNow(); }
  } catch (e) { SAY.delete(id); render(); toast(e?.message ?? 'Couldn\'t send that'); }
}

// ── saying it: on-device dictation, the words go to her ──────────────
const webSR = () => globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition ?? null;
async function startVoice() {
  const st = C; if (!st || st.rec) return;
  const slot = $('.ag-rec', st.el), bar = $('.nf-bar', st.el), quick = $('.nf-quick', st.el);
  const input = $('.nf-bar input', st.el);
  const done = (text) => { bar.hidden = false; quick.hidden = false; st.rec = null; if (text) send(text); };
  // the iPhone: the Speech plugin (on device)
  if (native.available) {
    const r = await native.speech.start({ locale: 'en-IN' });
    if (r?.ok !== false && r?.available !== false) {
      bar.hidden = true; quick.hidden = true;
      let heard = '';
      const off = native.speech.onPartial((e) => { heard = e?.text ?? heard; const t = $('.ag-rec-t', slot); if (t) t.textContent = heard || 'Listening…'; });
      st.rec = recorder(slot, { onStop: async () => { off(); const r2 = await native.speech.stop(); done(String(r2?.text ?? heard).trim()); }, onCancel: () => { off(); native.speech.stop(); done(''); } });
      return;
    }
  }
  // a browser with speech recognition
  const SR = webSR();
  if (SR) {
    const rec = new SR();
    rec.lang = 'en-IN'; rec.interimResults = true; rec.continuous = true;
    let heard = '';
    rec.onresult = (e) => { heard = [...e.results].map((x) => x[0].transcript).join(' '); const t = $('.ag-rec-t', slot); if (t) t.textContent = heard; };
    rec.onerror = () => {};
    bar.hidden = true; quick.hidden = true;
    try { rec.start(); } catch {}
    st.rec = recorder(slot, { onStop: () => { try { rec.stop(); } catch {} setTimeout(() => done(heard.trim()), 350); }, onCancel: () => { try { rec.abort(); } catch {} done(''); } });
    return;
  }
  input.focus();
  toast('Dictation works in the iPhone app. Type it here, or use the keyboard\'s mic.');
}
// the listening bar: a live wave, a timer, what's been heard so far, cancel and send
function recorder(slot, { onStop, onCancel }) {
  slot.hidden = false;
  slot.innerHTML = `<div class="ag-recbar"><i class="ag-recdot" aria-hidden="true"></i><div class="ag-wave" aria-hidden="true">${'<i></i>'.repeat(32)}</div>
    <span class="ag-rect num" aria-live="off">0:00</span>
    <button type="button" class="ag-recx" aria-label="Cancel">${I.x}</button>
    <button type="button" class="ag-recstop" aria-label="Stop and send"><i></i></button></div>
    <p class="ag-rec-t" aria-live="polite">Listening…</p>`;
  const bars = $$('.ag-wave i', slot), lv = Array(32).fill(0.08), t0 = performance.now();
  const iv = setInterval(() => {
    const s = (performance.now() - t0) / 1000;
    lv.shift(); lv.push(Math.max(0.1, Math.min(1, 0.25 + 0.5 * Math.abs(Math.sin(s * 6.1)) * (0.5 + Math.random() * 0.5))));
    bars.forEach((b, i) => { b.style.transform = `scaleY(${lv[i]})`; });
    const el = $('.ag-rect', slot); if (el) el.textContent = `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }, 90);
  const stop = () => { clearInterval(iv); slot.innerHTML = ''; slot.hidden = true; };
  $('.ag-recx', slot).addEventListener('click', (e) => { e.stopPropagation(); stop(); haptic(6); onCancel?.(); });
  $('.ag-recstop', slot).addEventListener('click', (e) => { e.stopPropagation(); clearInterval(iv); haptic(10); slot.innerHTML = `<div class="ag-recbar tx"><span class="spin" style="--c:var(--ink-2)"></span><span>Writing it down</span></div>`; Promise.resolve(onStop?.()).finally(stop); });
  haptic(12);
  return { cancel: () => { stop(); onCancel?.(); } };
}
// the sheet rides up with the keyboard (a copy of Capture's helper, so the thread doesn't depend on Capture's file)
function liftWithKeyboard(el, gap = 0) {
  const vv = window.visualViewport; if (!vv) return () => {};
  const f = () => { const kb = Math.max(0, innerHeight - vv.height - vv.offsetTop); el.style.bottom = kb > 80 ? `${kb + gap}px` : ''; };
  vv.addEventListener('resize', f); vv.addEventListener('scroll', f);
  return () => { vv.removeEventListener('resize', f); vv.removeEventListener('scroll', f); };
}

/** Something that happened outside the thread: in real mode the PC posts it, so this only redraws. */
export function addToThread() { if (C?.el?.isConnected) { loadThread(); render(true); } }

// her state changes elsewhere (a new message, an ask answered on her tab, an Undo in her day): the thread shows the same truth
onChange((what) => { if (C?.el?.isConnected && ['thread', 'busy', 'asks', 'did', 'home', 'message'].includes(what)) render(false); });

// ── actions ──────────────────────────────────────────────────────────
on('ag-q', (el) => { const q = el.dataset.q; if (/^call me$/i.test(q)) { api.startCall({ why: 'You asked me to call' }); return; } send(q); });
on('ag-mic', () => startVoice());
on('ag-attach', (el) => { const tray = $('.ag-tray', C?.el); if (!tray) return; tray.hidden = !tray.hidden; el.setAttribute('aria-expanded', String(!tray.hidden)); haptic(5); });
on('ag-tr-cam', () => { closeSheet(C?.el); setTimeout(() => api.scan(), 250); });
on('ag-tr-scan', (el) => { closeSheet(C?.el); setTimeout(() => api.scan(el.dataset.mode), 250); });
on('ag-ctx-x', () => setCtx(null));
on('ag-chat-her', () => { closeSheet(C?.el); setTimeout(() => api.openAgent('her'), 260); });
on('ag-transcript', (el) => api.openAgent('call-detail', el.dataset.id));
on('ag-go-tools', () => { closeSheet(C?.el); setTimeout(() => api.openAgent('tools'), 260); });
on('ag-undo-did', async (el) => { haptic(8); try { await undoItem(el.dataset.id); toast('Undone'); render(); } catch (e) { toast(e?.message ?? 'Couldn\'t undo that'); } });
on('ag-undo-ch', async (el) => {
  haptic(8);
  try {
    const r = await undoChange(Number(el.dataset.id));
    toast(r?.undone?.length ? `Undone: ${r.undone[0]}` : r?.skipped?.length ? 'It changed again since, so I left it' : 'Undone');
    for (const m of AG.thread.messages) for (const c of m.meta?.changes ?? []) if (c.id === Number(el.dataset.id) && r?.undone?.length) c.undone = true;
    render();
  } catch (e) { toast(e?.message ?? 'Couldn\'t undo that'); }
});

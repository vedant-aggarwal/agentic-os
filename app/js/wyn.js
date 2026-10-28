// The agent (Wyn by default; each owner can name theirs, DECISIONS 1). This file wires her area together and
// owns the call. Her tab is agent-home.js, her thread agent-chat.js, her pages agent-pages.js, her alerts
// agent-alerts.js, her state agent-state.js (real data from the PC), her copy and demo day agent-data.js.
// The call runs on the free voice path (DECISIONS 4): in the iPhone app the native loop hears and speaks on device and
// asks the PC for each reply (POST /api/v1/wyn/voice-turn); in a browser the same loop runs here with the browser's
// speech recognition and voice, or by typing when there's no recognition. Demo mode keeps the prototype's scripted call.
// Exports other areas import: openWyn(view), startCall(), incomingCall({ why }). Bus: askAgent, openAgent, agentSay,
// alarm, startCall, incomingCall, agentNotify, meetAgent, agentAskDone, agentAsks, agentAnswer, agentMood, startBreathing.
import { $, $$, esc, on, toast, haptic, setTab, closeSheet } from './core.js';
import { I } from './icons.js';
import { provide } from './bus.js';
import { DEMO_MODE } from './data.js';
import * as API from './svc/api.js';
import { native } from './svc/native-plugins.js';
import { mountOrb } from './orb.js';
import './agent-home.js';                                   // registers the Agent tab
import { logBreath, ensureCss } from './agent-home.js';
import { openChat } from './agent-chat.js';
import { openFeed, openAlarms, openTools, openHer, openMemory, openCalls, meet, openMood, openReply, openCallDetail } from './agent-pages.js';
import { agentSay, alarm, notify, ringFull, preview } from './agent-alerts.js';
import { AG, agName, changed, onChange, openAsks, askDoneElsewhere, answer, act, owner, startLive, refresh, home, pending, flush, seen, snooze } from './agent-state.js';

// ── her views ────────────────────────────────────────────────────────
export function openAgent(view = 'chat', arg) {
  switch (view) {
    case 'chat': return openChat({ mode: arg });
    case 'ask': return openChat({ aspect: arg });
    case 'feed': {
      // ask/<id> and agent/feed/<id> (a notification tap): her open question, else her day
      const a = arg && AG.asks.find((x) => x.id === arg);
      if (a) return a.ask?.question ? openReply(a.id) : openAsk(a.id);
      if (arg) seen([arg]).catch(() => {});   // a nudge's notification tapped: he's seen it, so it stops climbing
      return openFeed();
    }
    case 'alarms': return openAlarms();
    case 'tools': return openTools();
    case 'call': return startCall();
    case 'her': case 'persona': return openHer(arg);
    case 'cost': return openHer('cost');
    case 'memory': return openMemory();
    case 'calls': return openCalls();
    case 'call-detail': return openCallDetail(arg);
    case 'meet': return meet();
    case 'mood': return openMood();
    case 'reply': return openReply(arg);
    case 'alarm': return alarm(arg ? { item: arg } : { preview: true });
    case 'ring': return ringFull({ why: AG.thread.incoming?.reason ?? 'a quick check-in', incomingId: AG.thread.incoming?.id ?? null });
    case 'preview': return preview(arg);
    default: return setTab('agent');
  }
}
export function openWyn(view = 'chat') { return openAgent(view); }
// one ask as a sheet, from a notification tap or a link
function openAsk(id) {
  setTab('agent');
  requestAnimationFrame(() => { const el = document.querySelector(`.ag-ask[data-ask="${CSS.escape(id)}"]`); el?.scrollIntoView({ block: 'center', behavior: 'smooth' }); el?.classList.add('flash'); setTimeout(() => el?.classList.remove('flash'), 1600); });
}

// ── the call ─────────────────────────────────────────────────────────
// demo mode only: the prototype's scripted call (each line belongs to an agenda item, which ticks off as she covers it)
const SCRIPTS = {
  now: { agenda: ['Harborline quote', 'Reel at 18:45', 'Protein'], lines: [
    [0, 'Hey. You\'re in deep work till 18:30, so I\'ll be quick.'],
    [0, 'Harborline\'s quote is a day late. Want me to draft it for 18:30, for you to send?'],
    [1, 'Then the reel at 18:45. R1\'s script is on the prompter.'],
    [2, 'And protein is at 62. Paneer tonight, a shake after cardio. That\'s all.'],
  ] },
  night: { agenda: ['Two lines', 'Tomorrow at 06:30', 'Sleep by 22:45'], lines: [
    [0, 'Hey. Day\'s nearly done. Two lines for your journal: how did today go?'],
    [0, 'Got it. Both lines are in Growth, and your streak is seven.'],
    [1, 'Tomorrow: gym at 06:30, then GE I at 10:30.'],
    [2, 'Phone down by 22:45. Good night, Alex.'],
  ] },
};
let CALL = null;
const webSR = () => globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition ?? null;
export function startCall({ why = 'You called', agenda = null, incomingId = null } = {}) {
  if (CALL) { showCall(); return; }
  $('.ninc')?.remove(); $('.ag-ring')?.remove();
  ensureCss('css/motion.css'); ensureCss('css/orb.css');
  const demo = DEMO_MODE;
  const sc = /night|journal|streak/i.test(why) ? SCRIPTS.night : SCRIPTS.now;
  const items = agenda?.length ? agenda : demo ? sc.agenda : [];
  const typed = !demo && !native.available && !webSR();
  const el = document.createElement('div');
  el.className = 'ncall stay-dark';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', `Call with ${agName()}`);
  el.innerHTML = `
    <button class="nc-min" data-act="wyn-min" aria-label="Keep the call going and use the app">${I.chevD}</button>
    <div class="nc-top"><p class="nc-name">${esc(agName())}</p><p class="nc-status num">Connecting…</p><p class="nc-why">${esc(why)}</p></div>
    ${items.length ? `<ol class="nc-agenda" aria-label="What she wants to cover">${items.map((a, i) => `<li data-i="${i}"><span class="nc-tick">${I.check}</span><span>${esc(a)}</span></li>`).join('')}</ol>` : '<div class="nc-agenda"></div>'}
    <div class="nc-stage"><div class="nc-orbwrap"><div class="nc-rings" aria-hidden="true"><i></i><i></i><i></i></div><span class="nc-lv" aria-hidden="true"></span></div></div>
    <p class="nc-caption" aria-live="polite"></p>
    <p class="nc-heard" aria-live="polite"></p>
    ${typed ? `<form class="nc-type" autocomplete="off"><input type="text" placeholder="This browser can't hear you: type to her" aria-label="Say something to her" enterkeyhint="send" /><button type="submit" aria-label="Send">${I.up}</button></form>` : ''}
    <div class="nc-controls">
      <button class="nc-btn" data-act="wyn-mute"><span class="nc-c">${I.mic}</span><span>Mute</span></button>
      <button class="nc-btn end" data-act="wyn-end"><span class="nc-c">${I.phone}</span><span>End</span></button>
      <button class="nc-btn" data-act="wyn-callchat"><span class="nc-c">${I.chat}</span><span>Chat</span></button>
    </div>`;
  $('#phone').append(el);
  const c = CALL = { el, why, items, lines: sc.lines, t0: null, muted: false, state: 'connecting', li: 0, timers: [], amp: null, demo, callId: null, mode: demo ? 'demo' : native.available ? 'native' : webSR() ? 'web' : 'typed', rec: null, said: [] };
  try { c.orb = mountOrb($('.nc-lv', el), { size: 168, interactive: false, hold: false, label: agName(), state: 'listening' }); } catch { $('.nc-lv', el).classList.add('orb', 'big'); }
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  haptic(20);
  c.tick = setInterval(() => paintStatus(c), 500);
  if (demo) { c.timers.push(setTimeout(() => { c.t0 = performance.now(); setState(c, 'listening'); c.timers.push(setTimeout(() => speakScript(c), 1200)); }, 900)); return; }
  $('.nc-type', el)?.addEventListener('submit', (e) => { e.preventDefault(); const i = $('input', e.currentTarget); const v = i.value.trim(); i.value = ''; if (v) heardLine(c, v); });
  if (c.mode === 'native') nativeCall(c, { why, incomingId });
  else webCall(c, { why, incomingId });
}
function fmtT(c) {
  if (!c.t0) return '0:00';
  const s = Math.floor((performance.now() - c.t0) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function paintStatus(c) {
  const word = { connecting: 'Connecting…', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' }[c.state] ?? 'On the call';
  const label = c.state === 'connecting' ? word : `${c.muted ? 'Muted' : word} · ${fmtT(c)}`;
  const st = $('.nc-status', c.el); if (st) st.textContent = label;
  const pill = $('.ncall-pill small'); if (pill) pill.textContent = fmtT(c);
}
function setState(c, s) {
  c.state = s; c.el.classList.toggle('speaking', s === 'speaking'); c.el.classList.toggle('thinking', s === 'thinking');
  try { c.orb?.setState(s === 'connecting' ? 'calm' : s); } catch {}
  paintStatus(c);
}
function caption(c, text) {
  const cap = $('.nc-caption', c.el); if (!cap) return;
  cap.textContent = '';
  let i = 0;
  clearInterval(c.typer);
  c.typer = setInterval(() => { i += 2; cap.textContent = text.slice(0, i); if (i >= text.length) clearInterval(c.typer); }, 28);
}
// her voice, as the orb's level, while she speaks (the browser can't meter its own speech, so a soft pulse stands in)
function levelWhile(c, on) {
  clearInterval(c.amp);
  const wrap = $('.nc-orbwrap', c.el);
  if (!on) { wrap?.style.setProperty('--amp', '0'); try { c.orb?.setLevel(0); } catch {} return; }
  c.amp = setInterval(() => { const v = 0.25 + Math.random() * 0.6; wrap?.style.setProperty('--amp', v.toFixed(2)); try { c.orb?.setLevel(v); } catch {} }, 110);
}

// the iPhone: the native loop does the hearing and speaking (and the PC turns); this screen follows its events
async function nativeCall(c, { why, incomingId }) {
  c.off = native.on('voice', (e) => {
    if (CALL !== c) return;
    if (e.callId) c.callId = e.callId;
    if (e.state && e.state !== 'ended') { if (!c.t0) c.t0 = performance.now(); setState(c, e.state); }
    if (typeof e.level === 'number') { try { c.orb?.setLevel(e.level); } catch {} $('.nc-orbwrap', c.el)?.style.setProperty('--amp', e.level.toFixed(2)); }
    if (e.said?.text) caption(c, e.said.text);
    if (e.heard?.text) { const h = $('.nc-heard', c.el); if (h) h.textContent = e.heard.text; }
    if (e.error) toast(e.error);
    if (e.state === 'ended') endCall({ fromNative: true });
  });
  const r = await native.voice.start({ reason: why, incomingId: incomingId ?? undefined, locale: 'en-IN' });
  if (r?.available === false || r?.ok === false) { c.off?.(); c.mode = webSR() ? 'web' : 'typed'; toast(r?.error ?? 'The phone\'s call loop isn\'t in this build; talking here instead.'); webCall(c, { why, incomingId }); }
}
// a browser: the same loop here. Her line comes from the PC; the browser speaks it, then listens (or he types)
async function webCall(c, { why, incomingId }) {
  try {
    const r = await API.post('/wyn/voice-turn', { callId: null, start: true, reason: why, incomingId, native: false }, { timeout: 30000 });
    if (CALL !== c) { if (r?.callId) API.post('/wyn/voice-turn', { callId: r.callId, hangup: true }).catch(() => {}); return; }
    c.callId = r.callId; c.t0 = performance.now();
    await say(c, r.reply);
    if (r.end) return endCall();
    listen(c);
  } catch (e) { toast(e?.status === 403 ? 'She isn\'t on this account.' : `Couldn't reach her: ${e?.message ?? 'the PC is away'}`); endCall({ quiet: true }); }
}
function say(c, text) {
  return new Promise((resolve) => {
    if (CALL !== c || !text) return resolve();
    setState(c, 'speaking'); caption(c, text); levelWhile(c, true);
    c.said.push(text);
    const S = globalThis.speechSynthesis;
    const done = () => { levelWhile(c, false); resolve(); };
    if (!S) { setTimeout(done, Math.min(6000, 600 + text.length * 45)); return; }
    try {
      S.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = S.getVoices().find((x) => /en-IN/i.test(x.lang) && /female|heera|veena|neerja|swara/i.test(x.name)) ?? S.getVoices().find((x) => /en-IN/i.test(x.lang)) ?? null;
      if (v) u.voice = v;
      u.rate = 1.02;
      u.onend = done; u.onerror = done;
      S.speak(u);
      // some browsers never fire onend: a ceiling
      setTimeout(done, Math.min(20000, 1500 + text.length * 80));
    } catch { setTimeout(done, 1200); }
  });
}
function listen(c) {
  if (CALL !== c) return;
  setState(c, 'listening');
  const SR = webSR();
  if (!SR || c.mode === 'typed') { $('.nc-type input', c.el)?.focus(); return; }
  const rec = new SR();
  rec.lang = 'en-IN'; rec.interimResults = true; rec.continuous = false;
  let heard = '', sent = false;
  rec.onresult = (e) => {
    heard = [...e.results].map((x) => x[0].transcript).join(' ');
    const h = $('.nc-heard', c.el); if (h) h.textContent = heard;
    if (e.results[e.results.length - 1].isFinal && !sent) { sent = true; heardLine(c, heard); }
  };
  rec.onend = () => { if (CALL === c && !sent) { if (heard.trim()) { sent = true; heardLine(c, heard); } else if (c.state === 'listening' && !c.muted) setTimeout(() => listen(c), 300); } };
  rec.onerror = (e) => { if (e?.error === 'not-allowed') { c.mode = 'typed'; toast('The microphone is off for this page; type to her instead.'); } };
  c.rec = rec;
  try { if (!c.muted) rec.start(); } catch {}
}
async function heardLine(c, text) {
  if (CALL !== c || !c.callId) return;
  try { c.rec?.abort(); } catch {}
  const h = $('.nc-heard', c.el); if (h) h.textContent = text;
  setState(c, 'thinking');
  // the soft two-note sound the phone plays while she thinks: here, the orb thinking
  try {
    const r = await API.post('/wyn/voice-turn', { callId: c.callId, text }, { timeout: 120000 });
    if (CALL !== c) return;
    await say(c, r.reply);
    if (r.end) { setTimeout(() => endCall(), 400); return; }
    listen(c);
  } catch (e) {
    if (CALL !== c) return;
    c.fails = (c.fails ?? 0) + 1;
    if (c.fails >= 3 || e?.status === 404) { toast('She lost the call. Try again in a minute.'); endCall(); return; }
    await say(c, 'Sorry, I lost that. Say it again?');
    listen(c);
  }
}
// demo: the scripted call, line by line
function agendaAt(c, i) {
  c.el.querySelectorAll('.nc-agenda li').forEach((li) => { const k = Number(li.dataset.i); li.classList.toggle('done', k < i); li.classList.toggle('on', k === i); });
}
function speakScript(c) {
  if (CALL !== c) return;
  if (c.li >= c.lines.length) { agendaAt(c, c.items.length); setState(c, 'listening'); return; }
  const [ai, line] = c.lines[c.li++];
  agendaAt(c, ai);
  setState(c, 'speaking'); levelWhile(c, true); caption(c, line);
  c.timers.push(setTimeout(() => { levelWhile(c, false); setState(c, 'listening'); c.timers.push(setTimeout(() => speakScript(c), 2400)); }, 700 + line.length * 32));
}
function showCall() {
  const c = CALL; if (!c) return;
  $('.ncall-pill')?.remove();
  c.el.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => c.el.classList.add('in')));
}
function minimise() {
  const c = CALL; if (!c) return;
  c.el.classList.remove('in');
  setTimeout(() => { if (CALL === c && !c.el.classList.contains('in')) c.el.hidden = true; }, 420);
  if (!$('.ncall-pill')) {
    const p = document.createElement('button');
    p.className = 'ncall-pill';
    p.dataset.act = 'wyn-pill';
    p.setAttribute('aria-label', `Back to the call with ${agName()}`);
    // Shaped like the Dynamic Island's call activity: leading Wyn, room for the camera, trailing timer and end.
    p.classList.toggle('compact', !(matchMedia('(min-width: 640px)').matches || safeTop() > 30));
    p.innerHTML = `<span class="np-lead"><span class="orb xs" aria-hidden="true"></span><b>${esc(agName())}</b></span><span class="np-gap" aria-hidden="true"></span><span class="np-trail"><small class="num">${fmtT(c)}</small><span class="np-end" data-act="wyn-end" role="button" aria-label="End call">${I.phone}</span></span>`;
    $('#phone').append(p);
    requestAnimationFrame(() => requestAnimationFrame(() => p.classList.add('in')));
  }
}
function safeTop() {
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;top:0;width:1px;height:env(safe-area-inset-top);visibility:hidden;pointer-events:none';
  document.body.append(d);
  const h = d.offsetHeight; d.remove();
  return h;
}
function endCall({ fromNative = false, quiet = false } = {}) {
  const c = CALL; if (!c) return;
  const dur = fmtT(c);
  c.timers.forEach((t) => { clearTimeout(t); clearInterval(t); });
  clearInterval(c.tick); clearInterval(c.amp); clearInterval(c.typer);
  try { c.rec?.abort(); } catch {}
  try { globalThis.speechSynthesis?.cancel(); } catch {}
  CALL = null;
  if (c.mode === 'native' && !fromNative) native.voice.stop().catch?.(() => {});
  c.off?.();
  if (c.callId && c.mode !== 'native' && !c.demo) API.post('/wyn/voice-turn', { callId: c.callId, hangup: true }).catch(() => {});
  try { c.orb?.destroy(); } catch {}
  c.el.classList.remove('in');
  setTimeout(() => c.el.remove(), 420);
  const p = $('.ncall-pill'); if (p) { p.classList.remove('in'); setTimeout(() => p.remove(), 400); }
  haptic(14);
  if (!quiet) toast(c.t0 ? `Call ended · ${dur}. She's writing up what you covered.` : 'Call ended');
  setTimeout(() => refresh({ quiet: true }), 4000);
}

// ── incoming: a banner while you're in the app (the iPhone rings through CallKit itself) ──
export function incomingCall({ why = 'a quick check-in', full = false, agenda, len, incomingId = null } = {}) {
  if (full) return ringFull({ why, agenda, len, incomingId });
  $('.ninc')?.remove();
  const b = document.createElement('div');
  b.className = 'ninc overlay';
  b.setAttribute('role', 'alertdialog');
  b.setAttribute('aria-label', `${agName()} is calling`);
  b.innerHTML = `<span class="orb ib" aria-hidden="true"></span>
    <div class="ni-text"><b>${esc(agName())} is calling</b><small>${esc(why)}</small></div>
    <button class="ni-btn later" data-act="wyn-inc-later" aria-label="Later">${I.clock}<span>Later</span></button>
    <button class="ni-btn decline" data-act="wyn-inc-decline" aria-label="Decline">${I.phone}</button>
    <button class="ni-btn answer" data-act="wyn-inc-answer" aria-label="Answer">${I.phone}</button>`;
  b._why = why; b._id = incomingId;
  $('#phone').append(b);
  requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add('in')));
  haptic(30);
  return b;
}
function dismissIncoming() {
  const b = $('.ninc'); if (!b) return null;
  b.classList.remove('in'); setTimeout(() => b.remove(), 450);
  return { why: b._why, id: b._id };
}
// she rings (the PC's incoming state): on the web, the banner; the iPhone app gets CallKit from the VoIP push
onChange((what, inc) => {
  if (what !== 'incoming' || !inc || native.available || CALL) return;
  if (Date.parse(inc.expires ?? 0) && inc.expires < Date.now()) return;
  incomingCall({ why: inc.reason, incomingId: inc.id });
});

// ── breathing: the orb, full screen, and the session logged on the PC ──
let BR = null;
export function startBreathing({ pattern = 'box', running = false } = {}) {
  if (BR) return BR.orb;
  ensureCss('css/motion.css'); ensureCss('css/orb.css');
  const el = document.createElement('div');
  el.className = 'ag-breath stay-dark';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Breathe');
  el.innerHTML = `<button class="ag-br-x" data-act="ag-br-close" aria-label="Stop">${I.x}</button>
    <p class="ag-br-k">${esc(agName())} · breathe with her</p><div class="ag-br-stage"><span class="ag-br-lv"></span></div>
    <p class="ag-br-hint">Tap her to stop. Your phone keeps time with the screen off.</p>`;
  $('#phone').append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  const close = () => { if (!BR) return; const b = BR; BR = null; b.el.classList.remove('in'); setTimeout(() => { try { b.orb?.destroy(); } catch {} b.el.remove(); }, 420); };
  let orb = null;
  try {
    orb = mountOrb($('.ag-br-lv', el), { size: 220, interactive: 'full', hold: false, overlay: false, pattern, label: agName(),
      onBreathEnd: (sum) => { logBreath(sum); setTimeout(close, 3700); } });
    orb.startBreathing({ pattern, follow: running });
  } catch (e) { console.warn('[agent] breathing could not start', e); toast('Breathing needs the motion kit'); el.remove(); return null; }
  BR = { el, orb, close };
  return orb;
}
on('ag-br-close', () => { if (!BR) return; if (BR.orb?.breathing) BR.orb.stop(); else BR.close(); });

// ── actions ──────────────────────────────────────────────────────────
on('wyn', () => openChat());                              // Today's orb and any old "wyn" button
on('wyn-call', () => startCall());
on('wyn-min', () => minimise());
on('wyn-pill', (el, e) => { if (e.target.closest('.np-end')) return; showCall(); });
on('wyn-end', (el, e) => { e.stopPropagation?.(); endCall(); });
on('wyn-mute', (el) => {
  const c = CALL; if (!c) return;
  c.muted = !c.muted; el.classList.toggle('on', c.muted); haptic(8); paintStatus(c);
  if (c.mode === 'native') native.voice.mute(c.muted);
  else if (c.muted) { try { c.rec?.abort(); } catch {} }
  else if (c.state === 'listening') listen(c);
});
on('wyn-callchat', () => { minimise(); openChat(); });
on('wyn-incoming', () => incomingCall());
on('wyn-inc-later', () => { const d = dismissIncoming(); if (d?.id && !DEMO_MODE) act(`/wyn/incoming/${d.id}/snooze`, { minutes: 30 }).catch(() => {}); toast('She\'ll call back in 30 min'); });
on('wyn-inc-decline', () => { const d = dismissIncoming(); if (d?.id && !DEMO_MODE) act(`/wyn/incoming/${d.id}/decline`, {}).catch(() => {}); haptic(10); });
on('wyn-inc-answer', () => { const d = dismissIncoming(); startCall({ why: d?.why ?? 'You answered', incomingId: d?.id ?? null }); });

// ── the bus ──────────────────────────────────────────────────────────
// askAgent(prompt, { aspect, about }): her thread, with the chip of the app you're in and that app's prompts
provide('askAgent', (prompt = '', { aspect = null, about = null } = {}) => openChat({ prompt, aspect, about }));
provide('openAgent', (view, arg) => openAgent(view, arg));
provide('agentSay', (text, opts) => agentSay(text, opts));
provide('alarm', (opts) => alarm(opts));
provide('startCall', (opts) => startCall(opts));
provide('incomingCall', (opts) => incomingCall(opts));
provide('agentNotify', (opts) => notify(opts));
provide('meetAgent', () => meet());
provide('startBreathing', (opts) => startBreathing(opts));
// an ask of hers answered on Today or in its app: her tab, badge and thread clear it, and the PC hears it (once)
provide('agentAskDone', (id, yes) => { const a = AG.asks.find((x) => x.id === id); if (a && a.status === 'open') return askDoneElsewhere(id, yes); return null; });
// Today's agent card reads her asks and answers them through these
provide('agentAsks', () => openAsks().map((a) => ({ id: a.id, title: a.title, text: a.text ?? '', at: a.time ?? '', aspect: home(a), from: a.from ?? null, source: 'agent',
  acts: a.ask?.question ? null : [[a.ask?.yes ?? 'Yes', 'yes'], [a.ask?.no ?? 'Not now', 'no']] })));
provide('agentAnswer', (id, value, text = null) => {
  // "later" isn't a no: her ask stays open and comes back in an hour (an agent's question simply waits)
  if (value === 'later') return /^ask_/.test(id) ? Promise.resolve(null) : snooze(id, 60).catch(() => null);
  return answer(id, value === 'yes' || value === true, { text: text ?? undefined }).catch((e) => { toast(e?.message ?? 'Couldn\'t answer that'); });
});
// his mood (the PC's score, with its reasons), for anyone who draws the orb or the widget
provide('agentMood', () => AG.mood);
// for the console and screenshot steps: __agent.state
window.__agent = { state: AG, openAgent, agentSay, alarm, startCall, incomingCall, startBreathing, refresh, act, pending, flush,
  /** for screenshot steps: close every open sheet the way a swipe would */
  closeSheets: () => { for (const el of $$('.sheet.in').reverse()) closeSheet(el); } };

// ── start: once the shell is up, for the owner (a member has no agent) ──
const go = () => { if (owner()) { startLive(); } };
if (document.body.classList.contains('ready')) go();
else new MutationObserver((_, o) => { if (document.body.classList.contains('ready')) { o.disconnect(); go(); } }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
// Today and the apps hear when her asks change (today-agent.js listens for this)
onChange((what) => { if (['home', 'asks'].includes(what)) document.dispatchEvent(new CustomEvent('agent-changed', { detail: { what } })); });

// The Agent tab: her home, on her real day. Who she is right now (the living orb in the middle of the nine apps, tinted
// by his mood and red when he's overloaded; hold it to breathe), a ring for the 15 minutes to her next heartbeat, what
// she's watching (each app's own line), what's waiting on you (one tap each), what rings tonight, her day as a dot per
// heartbeat, what she did (with Undo), her calls, and how she works. A composer floats over the tab bar.
import { $, $$, esc, registerTab, topbar, ring, setRing, pulse, toast, haptic, on } from './core.js';
import { I } from './icons.js';
import { ASPECTS, AGENT, DEMO_MODE } from './data.js';
import { api, has } from './bus.js';
import { mountOrb } from './orb.js';
import * as API from './svc/api.js';
import { go as openLink } from './svc/route.js';
import { AG, AI, onChange, changed, agName, openAsks, didToday, aspName, dotState, beatP, nextLabel, dot, answer, undoItem, paintBadge, home, tileFor,
  refresh, checkNow, act, savePrefs, nowMin } from './agent-state.js';
import { RUNGS, EVERY, hm, hmOf, minOf } from './agent-data.js';

let PAGE = null;
let SEL = null;           // the heartbeat selected on the day grid (minutes after midnight)
let ORB = null;
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** The motion kit's stylesheets, until the shell links them (as Today does). */
export function ensureCss(href) {
  if (document.querySelector(`link[href$="${href}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l);
}

registerTab('agent', {
  title: AGENT.name,
  render(page) {
    PAGE = page;
    ensureCss('css/motion.css'); ensureCss('css/orb.css');
    page.classList.add('ag-page');
    page.innerHTML = topbar({
      title: `<span class="ag-tt">${esc(agName())}</span>`,
      right: `<button class="gbtn chrome icon" data-act="ag-call" aria-label="Call ${esc(agName())}">${I.phone}</button>
              <button class="gbtn chrome icon" data-act="ag-her" aria-label="${esc(agName())}: settings">${I.dots}</button>`,
    }) + `<div class="scroll" id="agScroll">
        <div id="agHero"></div><div id="agState"></div><div id="agAsks"></div><div id="agTonight"></div><div id="agDay"></div><div id="agCalls"></div><div id="agHow"></div>
      </div>
      <div class="ag-compose chrome">
        <button class="ag-cmp" data-act="ag-type"><span>Tell ${esc(agName())} anything</span></button>
        <button class="ag-cmp-mic" data-act="ag-voice" aria-label="Voice note to ${esc(agName())}">${I.mic}</button>
      </div>`;
    draw();
    if (!AG.ready) refresh({ quiet: true });
    // #agent/<view>: open a view of hers once the tab has drawn (the shell rewrites the hash to #agent after this)
    const m = location.hash.match(/^#agent\/([\w-]+)(?:\/([\w-]+))?/);
    if (m) requestAnimationFrame(() => requestAnimationFrame(() => api.openAgent(m[1], m[2])));
  },
  onShow() { draw(); refresh({ quiet: true }); },
});

function draw(parts = ['hero', 'state', 'asks', 'tonight', 'day', 'calls', 'how']) {
  if (!PAGE?.isConnected) return;
  const R = { hero: heroHtml, state: stateHtml, asks: asksHtml, tonight: tonightHtml, day: dayHtml, calls: callsHtml, how: howHtml };
  for (const k of parts) {
    const el = $(`#ag${k[0].toUpperCase()}${k.slice(1)}`, PAGE);
    if (!el) continue;
    if (k === 'hero' && el.querySelector('.ag-face .lv')) { paintHero({ full: true }); continue; }   // the orb keeps living; the rest is redrawn
    el.innerHTML = R[k]();
  }
  const t = $('.ag-tt', PAGE); if (t) t.textContent = agName();
  mountHeroOrb();
  wireGrid();
}
// her state changes elsewhere (the thread, her pages, the PC): her home follows
onChange((what) => {
  paintBadge();
  if (AG.checking || !PAGE?.isConnected) return;
  if (what === 'asks' || what === 'did') draw(['hero', 'asks', 'day']);
  else if (what === 'watching' || what === 'mood') paintHero({ full: true });
  else if (what === 'home' || what === 'prefs' || what === 'error') draw();
  else if (what === 'busy' || what === 'thread') paintHero();
});
document.addEventListener('clock-tick', () => { if (PAGE?.isConnected && !AG.checking) { paintHero(); setRing($('.ag-beat', PAGE), beatP()); } });

// ── presence ─────────────────────────────────────────────────────────
function statusText() {
  const h = AG.heartbeat ?? {}, busy = AG.thread.busy?.status;
  if (busy) return `${busy}…`;
  if (AG.offline) return `Offline · her day as of ${hmOf(new Date(AG.at || Date.now()).toISOString())}`;
  if (AG.home?.inCall) return 'On a call with you';
  if (AG.home && AG.home.awake === false) return 'Quiet while you sleep';
  if (!h.on) return `${h.today ? `${h.today} checks today · ` : ''}Heartbeats are off on this PC`;
  return `Awake · ${h.today ?? 0} check${h.today === 1 ? '' : 's'} today · next at ${nextLabel()}`;
}
function heroHtml() {
  const name = esc(agName());
  return `<section class="ag-hero${AG.mood?.overloaded ? ' is-hot' : ''}" aria-label="${name} right now">
      <div class="ag-halo">
        ${ring(beatP(), 'ag', 132, 3, { cls: 'ag-beat', label: `${Math.round(beatP() * EVERY)} of ${EVERY} minutes to her next check` })}
        <div class="ag-face"><span class="ag-lv"></span></div>
        ${ASPECTS.map((a, i) => { const st = dotState(a.id); return `<button class="ag-sat s-${st}" data-act="ag-app" data-id="${a.id}" style="--i:${i};--c:var(--${a.id})" aria-label="${a.name}: ${st === 'needs' ? 'waiting on you' : st === 'did' ? 'she did something today' : 'quiet today'}"><i></i></button>`; }).join('')}
      </div>
      <div class="ag-hero-info">${infoHtml()}</div>
    </section>
    <div class="ag-watchwrap">${watchHtml()}</div>`;
}
// her name, what she's doing, his mood, and the two things you can do with her right here
function infoHtml() {
  const m = AG.mood;
  return `<h1 class="ag-name">${esc(agName())}</h1>
      <p class="ag-status"><i class="live${AG.offline ? ' off' : ''}" aria-hidden="true"></i><span class="ag-st" aria-live="polite">${esc(statusText())}</span></p>
      ${m ? `<button class="ag-mood" data-act="ag-mood" aria-label="How you seem: ${esc(m.line)}"><b>${esc(m.label)}</b><span>${esc(m.reasons?.[0]?.text ?? 'From your day')}</span>${I.chevR}</button>` : ''}
      <div class="ag-heroacts">
        <button class="chip sm ag-checknow" data-act="ag-check"${AG.checking ? ' disabled' : ''}>${AI.heartbeat}<span>Check now</span></button>
        <button class="chip sm ag-breathe" data-act="ag-breathe">${AI.breath}<span>Breathe</span></button>
      </div>`;
}
function watchHtml() {
  const watching = AG.watching ?? [];
  return watching.length ? `<div class="ag-watch" data-scroll-x role="list" aria-label="What she's watching">
      ${watching.map((w) => `<button class="ag-wchip" role="listitem" data-act="ag-app" data-id="${esc(w.app)}">${dot(w.app)}<span><b>${esc(aspName(w.app))}</b> ${esc(w.line)}</span></button>`).join('')}
    </div>` : '';
}
/** The hero without touching the orb: her words, his mood, the nine apps, the ring. */
function paintHero({ full = false } = {}) {
  if (!PAGE?.isConnected) return;
  const hero = $('.ag-hero', PAGE);
  if (!hero) return;
  hero.classList.toggle('is-hot', !!AG.mood?.overloaded);
  for (const s of $$('.ag-sat', PAGE)) { const k = dotState(s.dataset.id); s.className = `ag-sat s-${k}`; }
  if (full) {
    const info = $('.ag-hero-info', PAGE); if (info) info.innerHTML = infoHtml();
    const w = $('.ag-watchwrap', PAGE); if (w) w.innerHTML = watchHtml();
  } else { const st = $('.ag-st', PAGE); if (st) st.textContent = statusText(); }
  setRing($('.ag-beat', PAGE), beatP());
  // her face follows what she's doing: thinking while she works on a reply or a heartbeat
  ORB?.setState(AG.checking || AG.thread.busy ? 'thinking' : 'calm');
}
function mountHeroOrb() {
  const host = $('.ag-face .ag-lv', PAGE);
  if (!host || host.classList.contains('lv')) return;
  try {
    ORB = mountOrb(host, { size: 96, interactive: 'full', hold: true, pattern: 'box', label: agName(), overlay: 'auto',
      onTap: () => api.openAgent('chat'),
      onBreathEnd: (sum) => logBreath(sum) });
    ORB.setState(AG.thread.busy ? 'thinking' : 'calm');
  } catch (e) { console.warn('[agent] the orb could not start', e); host.classList.add('orb', 'ag-orb'); }
}
/** A breathing session's end, logged on the PC (Soul and Body read it; her mood eases). */
export async function logBreath(sum) {
  if (!sum || !(sum.seconds > 3)) return;
  const r = await act('/wyn/breaths', { id: API.clientId('br'), pattern: sum.pattern, rounds: sum.rounds, seconds: sum.seconds, completed: !!sum.completed, at: new Date().toISOString(), source: 'orb' }).catch(() => null);
  if (r?.mood) { AG.mood = r.mood; changed('mood'); paintHero({ full: true }); }
  if (sum.completed) toast(`${sum.rounds} ${sum.rounds === 1 ? 'round' : 'rounds'} of ${sum.name ?? 'breathing'}. ${r?.queued ? 'Saved; it syncs when the PC is back.' : 'Logged.'}`);
}

// the PC can't be reached and there's nothing to show yet, or she isn't on this account
function stateHtml() {
  if (AG.ready && !AG.offline) return '';
  if (!AG.ready && AG.offline) return `<div class="note ag-off">${I.wifiOff ?? I.x}<span>Her day lives on your PC, and it isn't answering. She'll catch up the moment it's back.</span></div>`;
  if (!AG.ready) return `<div class="ag-skel" aria-hidden="true"><i></i><i></i><i></i></div>`;
  return `<div class="note ag-off">${I.clock}<span>Offline. This is her day as of ${esc(hmOf(new Date(AG.at || Date.now()).toISOString()))}; what you do now waits and syncs.</span></div>`;
}

// ── waiting on you ───────────────────────────────────────────────────
function asksHtml() {
  const list = openAsks();
  if (!AG.ready) return '';
  if (!list.length) return `<div class="sh"><h2>Waiting on you</h2></div>
    <div class="note ag-clear">${I.check}<span>Nothing is waiting on you. She'll ask the moment something needs a yes.</span></div>`;
  return `<div class="sh"><h2>Waiting on you</h2><span class="sh-count ag-n">${list.length}</span></div>
    <div class="group ag-asks">${list.map(askHtml).join('')}</div>`;
}
export function askHtml(a) {
  const q = a.ask?.question;
  const from = a.from ? `${esc(a.from)} asks` : esc(aspName(home(a)));
  return `<article class="ag-ask" data-ask="${esc(a.id)}">
      <div class="ag-ask-k">${tileFor(home(a))}<span>${from}</span><time>${esc(a.time ?? hmOf(a.at))}</time></div>
      <h3>${esc(a.title)}</h3>
      ${a.text ? `<p class="ag-ask-x${a.text.length > 180 ? ' long' : ''}"${a.text.length > 180 ? ' data-act="ag-more"' : ''}>${esc(a.text)}</p>` : ''}
      ${a.ask?.draft ? `<blockquote class="ag-draft">${esc(a.ask.draft)}</blockquote>` : ''}
      <div class="ag-ask-acts">${q
        ? `<button class="btn sm ag-yes" data-act="ag-reply" data-id="${esc(a.id)}">Answer</button><button class="btn sm ag-ghost" data-act="ag-no" data-id="${esc(a.id)}">Not now</button>`
        : `<button class="btn sm ag-yes" data-act="ag-yes" data-id="${esc(a.id)}">${esc(a.ask?.yes ?? 'Yes')}</button><button class="btn sm ag-ghost" data-act="ag-no" data-id="${esc(a.id)}">${esc(a.ask?.no ?? 'Not now')}</button>`}
      </div>
    </article>`;
}
// one tap: the card says what happened right where the buttons were, then folds away into her day
export async function answerCard(id, yes, btn, text) {
  const card = btn?.closest('.ag-ask');
  haptic(yes ? 12 : 8);
  const say = (line, ok = true) => $$(`.ag-ask[data-ask="${CSS.escape(id)}"]`).forEach((c) => {
    const acts = $('.ag-ask-acts', c);
    if (acts) acts.outerHTML = `<div class="ag-ask-done${ok && yes ? '' : ' no'}"><span class="check ${ok && yes ? 'done closing' : ''}">${I.check}</span><span>${esc(line)}</span></div>`;
  });
  say(yes ? 'On it…' : 'Okay, not now.');
  try {
    const r = await answer(id, yes, { text });
    const line = r?.queued ? 'Saved. It goes to the PC when it\'s back.' : r?.error ? `Didn't go through: ${r.error}` : yes ? (r?.did?.title ?? (r?.message ? 'Told her. She\'s on it.' : 'Done.')) : 'Okay, not now.';
    say(line, !r?.error);
  } catch (e) { say(`Couldn't send that: ${e.message ?? 'try again'}`, false); }
  if (card && !card.closest('.ag-thread')) {
    setTimeout(() => {
      if (!card.isConnected) return;
      card.style.height = `${card.offsetHeight}px`; void card.offsetHeight;
      card.classList.add('leaving');
      setTimeout(() => draw(['asks', 'hero', 'day']), 340);
    }, reduce() ? 300 : 1200);
  }
}

// ── tonight: what rings if he doesn't act (a streak's alarm and its ladder) ──
const RUNG_ICON = { 0: I.x, 1: AI.bell, 2: AI.banner, 3: AI.alarm, 4: I.phone };
function tonightHtml() {
  const al = AG.alarms.find((x) => x.status === 'open');
  const night = AG.calls?.night || AG.prefs?.night_call;
  if (!AG.ready) return '';
  if (!al) {
    if (!night) return '';
    return `<div class="sh"><h2>Tonight</h2></div>
      <section class="surface ag-tonight saved"><div class="ag-tn-k">${tileFor('growth')}<span>Night call</span></div>
        <h3>Nothing will ring tonight</h3><p class="ag-tn-sub">She calls at ${esc(night)} to close the day.</p></section>`;
  }
  const L = al.ladder ?? {}, n = al.meta?.streak?.n ?? al.meta?.streak?.current ?? 0;
  const alarmAt = L.alarmAt ? minOf(L.alarmAt) : null, first = L.next ? minOf(L.next) : null, step = AG.ladder?.step ?? 15;
  const rungs = [1, 2, 3, 4].filter((r) => r <= (L.ceiling ?? 1)).map((r) => {
    const t = r === 3 && alarmAt != null ? alarmAt : r === 4 && alarmAt != null ? alarmAt + step : first != null ? first + (r - 1) * step : null;
    return { r, at: t != null ? hm(t) : '', label: RUNGS[r].label };
  });
  const days = Array.from({ length: 7 }, (_, i) => i);
  return `<div class="sh"><h2>Tonight</h2><span class="sh-count">${rungs[0]?.at ? `from ${esc(rungs[0].at)}` : ''}</span></div>
    <section class="surface ag-tonight">
      <div class="ag-tn-k">${tileFor(home(al))}<span>${esc(aspName(home(al)))}</span></div>
      <h3>${esc(al.title)}</h3>
      <p class="ag-tn-sub">${esc(al.text ?? '')}</p>
      ${n ? `<div class="ag-streak" role="img" aria-label="${n} days in a row, today still open">${days.map((i) => `<span class="ag-sday${i === 6 ? ' today' : ''}">${ring(i < 6 && i >= 6 - n ? 1 : 0, home(al), 30, 4, { delay: i * 50 })}<small>${i === 6 ? 'Today' : ''}</small></span>`).join('')}</div>` : ''}
      <ol class="ag-ladder" aria-label="What she does if you don't">
        ${rungs.map((x, i) => `<li><button class="ag-rung${(L.rung ?? 0) >= x.r ? ' on' : ''}" data-act="ag-rung" data-id="${RUNGS[x.r].id}" data-item="${esc(al.id)}" aria-label="${x.at} ${x.label}: preview">
          <span class="ag-rg-ic">${RUNG_ICON[x.r]}</span><b class="num">${esc(x.at)}</b><small>${x.label}</small></button>${i < rungs.length - 1 ? '<i class="ag-rg-line" aria-hidden="true"></i>' : ''}</li>`).join('')}
      </ol>
      <div class="ag-tn-acts"><button class="btn sm ag-yes" data-act="ag-alarm-do" data-id="${esc(al.id)}">Do it now</button><button class="btn sm ag-ghost" data-act="ag-alarm-open" data-id="${esc(al.id)}">See the alarm</button></div>
    </section>`;
}

// ── her day: one dot per heartbeat, 06:00 to 22:45 ───────────────────
const HOURS = Array.from({ length: 17 }, (_, i) => 6 + i);
const FROM = 6 * 60, TO = 22 * 60 + 45;
const slotOf = (iso) => { const m = minOf(iso); return m == null ? null : Math.floor(m / 15) * 15; };
function beatsBySlot() {
  const map = new Map();
  for (const b of AG.beats) { const s = slotOf(b.at); if (s == null) continue; const prev = map.get(s); if (!prev || RANK[b.kind] > RANK[prev.kind]) map.set(s, b); }
  return map;
}
const RANK = { ok: 0, noticed: 1, did: 2, nudge: 3, ask: 4 };
function slotKind(m, map) {
  if (m < FROM || m > TO) return 'off';
  const b = map.get(m);
  if (b) return b.kind === 'noticed' ? 'ok' : b.kind;
  const nx = AG.heartbeat?.next ? slotOf(AG.heartbeat.next) : null;
  if (m === nx) return 'next';
  const al = AG.alarms.find((x) => x.status === 'open' && x.ladder?.alarmAt && slotOf(x.ladder.alarmAt) === m);
  if (al) return 'sched';
  return m < (nowMin() ?? 0) ? 'past' : 'future';
}
function gridHtml(map) {
  const cells = [];
  for (let q = 0; q < 4; q++) for (const h of HOURS) {
    const m = h * 60 + q * 15, k = slotKind(m, map);
    cells.push(`<i class="ag-b k-${k}${m === SEL ? ' sel' : ''}" data-m="${m}" style="grid-column:${h - 5};grid-row:${q + 1}"></i>`);
  }
  const marks = [6, 9, 12, 15, 18, 21].map((h) => `<span style="grid-column:${h - 5}">${String(h).padStart(2, '0')}</span>`).join('');
  return `<div class="ag-gridwrap">
      <div class="ag-grid" role="slider" tabindex="0" aria-label="Her checks today" aria-valuemin="${FROM}" aria-valuemax="${TO}" aria-valuenow="${SEL ?? FROM}" aria-valuetext="${hm(SEL ?? FROM)}">${cells.join('')}</div>
      <div class="ag-axis" aria-hidden="true">${marks}</div>
    </div>`;
}
function selHtml(m, map) {
  if (m == null) return `<p class="ag-sel-ok">${AG.beats.length ? 'Tap a dot to see what she checked.' : AG.heartbeat?.on ? 'Her first check today shows here.' : 'Heartbeats are off on this PC. Check now runs one.'}</p>`;
  const b = map.get(m);
  if (b) {
    const found = [...AG.items, ...AG.asks].filter((x) => x.beat === b.id);
    return `<p class="ag-sel-h"><b class="num">${esc(b.time ?? hm(m))}</b><span>Read ${b.checked} ${b.checked === 1 ? 'place' : 'places'}${b.secs != null ? ` · ${b.secs < 1 ? '<1' : Math.round(b.secs)} s` : ''} · ${esc(b.model ?? 'rules only')}</span></p>
      ${found.length ? `<ul class="ag-sel-l">${found.map((x) => `<li>${dot(home(x))}<span>${x.kind === 'ask' ? 'Asked you: ' : x.kind === 'nudge' ? 'Told you: ' : x.kind === 'noticed' ? 'Noticed: ' : ''}${esc(x.title)}</span></li>`).join('')}</ul>`
        : `<p class="ag-sel-ok">${esc(b.note || 'All on track')}${b.kind === 'ok' ? '. Nothing worth saying.' : ''}</p>`}`;
  }
  const al = AG.alarms.find((x) => x.status === 'open' && x.ladder?.alarmAt && slotOf(x.ladder.alarmAt) === m);
  if (al) return `<p class="ag-sel-h"><b class="num">${hm(m)}</b><span>Alarm, if it isn't done</span></p><p class="ag-sel-ok">${esc(al.title)}</p>`;
  const nx = AG.heartbeat?.next ? slotOf(AG.heartbeat.next) : null;
  if (m === nx) return `<p class="ag-sel-h"><b class="num">${hm(m)}</b><span>Her next check</span></p><p class="ag-sel-ok">She reads every app and says nothing unless something moved.</p>`;
  return `<p class="ag-sel-h"><b class="num">${hm(m)}</b><span>${m < (nowMin() ?? 0) ? 'No check then' : 'A check to come'}</span></p><p class="ag-sel-ok">${m < (nowMin() ?? 0) ? 'She was quiet, asleep, or the PC was off.' : `She checks every ${EVERY} minutes while you're up.`}</p>`;
}
function dayHtml() {
  if (!AG.ready) return '';
  const did = didToday(), map = beatsBySlot();
  const quiet = AG.beats.filter((b) => b.kind === 'ok').length;
  if (SEL == null && AG.beats.length) SEL = slotOf(AG.beats.at(-1).at);
  return `<div class="sh"><h2>Her day</h2><button class="sh-act" data-act="ag-feed">All of it ${I.chevR}</button></div>
    <section class="surface ag-day">
      <p class="ag-day-sum"><b class="num">${AG.beats.length}</b> checks today · <b class="num">${quiet}</b> quiet · <b class="num">${did.filter((d) => !d.undone).length}</b> done</p>
      ${gridHtml(map)}
      <div class="ag-key" aria-hidden="true"><span><i class="ag-b k-ok"></i>Quiet</span><span><i class="ag-b k-did"></i>Did something</span><span><i class="ag-b k-ask"></i>Asked you</span><span><i class="ag-b k-next"></i>Next</span></div>
      <div class="ag-sel" aria-live="polite">${selHtml(SEL, map)}</div>
    </section>
    ${did.length ? `<div class="group ag-did">${did.slice(0, 4).map(didRow).join('')}</div>` : `<p class="hint ag-none">Nothing done on her own yet today. What she does lands here, with Undo.</p>`}`;
}
export function didRow(d) {
  const off = d.undone;
  return `<div class="row ic ag-drow${off ? ' undone' : ''}" data-id="${esc(d.id)}">
      ${tileFor(home(d))}
      <div class="rbody"><div class="rtitle wrap">${esc(d.title)}</div><div class="rmeta"><span class="num">${esc(d.time ?? hmOf(d.at))}</span><span>·</span><span class="ell">${off ? 'Undone' : esc(d.via === 'scan' ? (d.text || aspName(home(d))) : d.source === 'chat' ? 'From your chat' : d.source === 'call' ? 'On a call' : d.source === 'tap' ? 'You said yes' : aspName(home(d)))}</span></div></div>
      ${d.link ? `<button class="btn sm" data-act="ag-link" data-link="${esc(d.link)}">Open</button>` : d.undo && !off ? `<button class="btn sm" data-act="ag-undo" data-id="${esc(d.id)}">Undo</button>` : ''}
    </div>`;
}
function wireGrid() {
  const g = $('.ag-grid', PAGE); if (!g || g._wired) return; g._wired = true;
  const pick = (e) => {
    const r = g.getBoundingClientRect();
    const col = Math.max(0, Math.min(16, Math.floor(((e.clientX - r.left) / r.width) * 17)));
    const row = Math.max(0, Math.min(3, Math.floor(((e.clientY - r.top) / r.height) * 4)));
    select((6 + col) * 60 + row * 15);
  };
  let down = false;
  g.addEventListener('pointerdown', (e) => { down = true; g.setPointerCapture(e.pointerId); pick(e); });
  g.addEventListener('pointermove', (e) => { if (down) pick(e); });
  g.addEventListener('pointerup', () => { down = false; });
  g.addEventListener('pointercancel', () => { down = false; });
  g.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 15, ArrowLeft: -15, ArrowUp: -15, ArrowDown: 15 }[e.key]; if (!d) return;
    e.preventDefault(); select(Math.max(FROM, Math.min(TO, (SEL ?? FROM) + d)));
  });
}
function select(m) {
  const map = beatsBySlot();
  if (m === SEL || slotKind(m, map) === 'off') return;
  SEL = m; haptic(4);
  $$('.ag-b.sel', PAGE).forEach((x) => x.classList.remove('sel'));
  $(`.ag-grid .ag-b[data-m="${m}"]`, PAGE)?.classList.add('sel');
  const g = $('.ag-grid', PAGE); g?.setAttribute('aria-valuenow', m); g?.setAttribute('aria-valuetext', hm(m));
  const s = $('.ag-sel', PAGE); if (s) s.innerHTML = selHtml(m, map);
}

// ── calls ────────────────────────────────────────────────────────────
function callsHtml() {
  if (!AG.ready) return '';
  const C = AG.calls ?? {}, last = (C.recent ?? []).find((c) => c.status === 'ended' && c.summary) ?? (C.recent ?? [])[0];
  const night = AG.prefs?.night_call ?? C.night ?? '', morning = AG.prefs?.morning_call ?? C.morning ?? '';
  const free = C.voice?.realtime ? 'Realtime voice' : 'Free voice: on your phone';
  return `<div class="sh"><h2>Calls</h2><button class="sh-act" data-act="ag-calls">All calls ${I.chevR}</button></div>
    <div class="group ag-callg">
      <div class="row ic"><span class="tile">${I.sun}</span>
        <div class="rbody"><div class="rtitle">Morning call${morning ? ` at ${esc(morning)}` : ''}</div><div class="rmeta"><span class="ell">${morning ? 'The shape of the day in under a minute' : 'Off'}</span></div></div>
        <button class="switch${morning ? ' on' : ''}" data-act="ag-callsw" data-k="morning" role="switch" aria-checked="${!!morning}" aria-label="Morning call"></button></div>
      <div class="row ic"><span class="tile">${I.moon}</span>
        <div class="rbody"><div class="rtitle">Night call${night ? ` at ${esc(night)}` : ''}</div><div class="rmeta"><span class="ell">${night ? 'Close the day, two lines for your journal' : 'Off'}</span></div></div>
        <button class="switch${night ? ' on' : ''}" data-act="ag-callsw" data-k="night" role="switch" aria-checked="${!!night}" aria-label="Night call"></button></div>
      ${last ? `<button class="row ic" data-act="ag-calls"><span class="tile">${I.phone}</span>
        <div class="rbody"><div class="rtitle">${esc(last.reason || (last.direction === 'outgoing' ? 'You called' : 'She called'))}${last.seconds ? ` · ${Math.max(1, Math.round(last.seconds / 60))} min` : ''}</div><div class="rmeta"><span class="num">${esc(dayWord(last.started_at))}</span><span>·</span><span class="ell">${esc(last.summary ?? last.status)}</span></div></div>${I.chevR}</button>` : ''}
    </div>
    <p class="hint">${esc(free)}. Her brain runs on your PC; nothing is billed per minute.</p>`;
}
export function dayWord(iso) {
  const t = Date.parse(iso ?? ''); if (!Number.isFinite(t)) return '';
  const d = (x) => new Date(x + 330 * 60000).toISOString().slice(0, 10);
  const now = DEMO_MODE ? Date.UTC(2026, 9, 22, 12, 10) : Date.now();
  if (d(t) === d(now)) return `Today ${hmOf(iso)}`;
  if (d(t) === d(now - 864e5)) return `Yesterday ${hmOf(iso)}`;
  return new Date(t + 330 * 60000).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// ── how she works ────────────────────────────────────────────────────
function howHtml() {
  if (!AG.ready) return '';
  const row = (act, icon, title, end) => `<button class="row ic" data-act="${act}"><span class="tile">${icon}</span><div class="rbody"><div class="rtitle">${title}</div></div><span class="rend">${end}${I.chevR}</span></button>`;
  const ceil = Object.values(AG.ladder?.ceilings ?? {});
  const top = RUNGS[Math.max(0, ...ceil)]?.label ?? 'Notification';
  const t = AG.tools;
  const tone = String(AG.prefs?.tone ?? '').split(/[.,]/)[0].trim().slice(0, 26) || 'Warm, direct';
  return `<div class="sh"><h2>How she works</h2></div>
    <div class="group">
      ${row('ag-tools', I.bolt, 'What she can do', t ? `${t.total} tools · ${t.auto} on her own` : 'Tools')}
      ${row('ag-alarms', AI.bell, 'Reminders and alarms', `Up to ${top === 'Alarm' ? 'an' : 'a'} ${top.toLowerCase()}`)}
      ${row('ag-her', I.sparkle, 'How she is', esc(tone))}
      ${row('ag-memory', I.brain, 'What she remembers', `${(AG.memory?.long ?? 0) + (AG.memory?.short ?? 0)}`)}
      ${row('ag-cost', I.coin, 'Models and cost', 'On your subscription')}
    </div>`;
}

// ── a heartbeat, run now: the ring closes, each app lights as she reads it, and what she found lands in her day ──
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function runCheck() {
  if (AG.checking || !PAGE?.isConnected) return;
  AG.checking = true; haptic(10);
  changed('check');
  const hero = $('.ag-hero', PAGE), st = $('.ag-st', PAGE), r = $('.ag-beat', PAGE), btn = $('.ag-checknow', PAGE);
  hero?.classList.add('checking'); if (btn) btn.disabled = true;
  ORB?.setState('thinking');
  if (r) setRing(r, 1, { bleed: false });
  const job = checkNow().catch((e) => ({ error: e?.message ?? 'The PC didn\'t answer' }));
  // the apps light one by one while the PC reads them
  for (const s of $$('.ag-sat', hero ?? PAGE)) {
    if (st) st.textContent = `Reading ${aspName(s.dataset.id)}…`;
    s.classList.add('ping');
    await wait(reduce() ? 40 : 160);
  }
  if (st) st.textContent = 'Thinking it through…';
  const out = await job;
  AG.checking = false;
  hero?.classList.remove('checking'); if (btn) btn.disabled = false;
  ORB?.setState('calm');
  if (out?.error) { if (st) st.textContent = statusText(); toast(`Couldn't check: ${out.error}`); return; }
  const found = out?.items ?? [];
  if (out?.beat?.at) SEL = slotOf(out.beat.at);
  draw();
  pulse($('#agHero', PAGE));
  toast(found.length ? `Checked ${out.beat?.checked ?? ''} places: ${found[0].title}${found.length > 1 ? ` and ${found.length - 1} more` : ''}` : `Checked ${out?.beat?.checked ?? ''} places: ${out?.beat?.note || 'all on track'}`);
}

// ── his mood, in plain words, with the way out (breathe) ──
on('ag-mood', () => {
  const m = AG.mood; if (!m) return;
  api.openAgent('mood');
});

// ── actions ──────────────────────────────────────────────────────────
on('ag-check', () => runCheck());
on('ag-more', (el) => { if (el.classList.contains('long')) { el.classList.toggle('open'); haptic(4); } });
on('ag-breathe', () => { haptic(8); api.startBreathing({ pattern: 'box' }); });
on('ag-yes', (el) => answerCard(el.dataset.id, true, el));
on('ag-no', (el) => answerCard(el.dataset.id, false, el));
on('ag-reply', (el) => api.openAgent('reply', el.dataset.id));
// a row that says where something went (what Scan filed): its own app, through the one link router
on('ag-link', (el) => { haptic(5); openLink(el.dataset.link, { from: 'agent' }); });
on('ag-undo', async (el) => {
  const id = el.dataset.id; haptic(8);
  try { await undoItem(id); toast('Undone'); } catch (e) { toast(e?.message ?? 'Couldn\'t undo that'); }
});
on('ag-app', (el) => {
  const id = el.dataset.id; haptic(5);
  if (id === 'content') { api.openContent?.(); return; }
  if (id === 'tasks' || id === 'calendar') { api.setTab('today'); return; }
  if (id === 'work') { api.openWork?.(); return; }
  if (ASPECTS.some((a) => a.id === id)) api.openAspect(id, undefined, { back: agName() });
  else api.askAgent('', { aspect: id });
});
on('ag-callsw', async (el) => {
  const k = el.dataset.k, onNow = !el.classList.contains('on');
  const pref = k === 'night' ? 'night_call' : 'morning_call';
  const remembered = AG.prefs?.[`${pref}_was`] || (k === 'night' ? '22:15' : '07:30');
  el.classList.toggle('on', onNow); el.setAttribute('aria-checked', String(onNow)); haptic(6);
  const value = onNow ? remembered : '';
  if (!onNow) AG.prefs[`${pref}_was`] = AG.prefs[pref];
  try { await savePrefs({ [pref]: value }); toast(onNow ? `${k === 'night' ? 'Night' : 'Morning'} call on: ${value}` : `${k === 'night' ? 'Night' : 'Morning'} call off`); }
  catch (e) { toast(e?.message ?? 'Couldn\'t change that'); }
});
on('ag-alarm-do', (el) => {
  const al = AG.alarms.find((x) => x.id === el.dataset.id);
  if (home(al) === 'growth') { if (has('writeJournal')) api.writeJournal(); else api.openJournal(); return; }
  api.openAspect(home(al), undefined, { back: agName() });
});
on('ag-alarm-open', (el) => api.alarm({ item: el.dataset.id }));
on('ag-type', () => api.openAgent('chat'));
on('ag-voice', () => api.openAgent('chat', 'voice'));
on('ag-call', () => api.startCall({ why: 'You called' }));
on('ag-her', () => api.openAgent('her'));
on('ag-feed', () => api.openAgent('feed'));
on('ag-calls', () => api.openAgent('calls'));
on('ag-tools', () => api.openAgent('tools'));
on('ag-alarms', () => api.openAgent('alarms'));
on('ag-memory', () => api.openAgent('memory'));
on('ag-cost', () => api.openAgent('her', 'cost'));
on('ag-rung', (el) => api.openAgent('preview', el.dataset.id));

// the badge waits for the shell: main.js draws the tab bar after every area has loaded
if (document.body.classList.contains('ready')) paintBadge();
else new MutationObserver((_, o) => { if (document.body.classList.contains('ready')) { o.disconnect(); paintBadge(); } }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

export { draw as drawHome };

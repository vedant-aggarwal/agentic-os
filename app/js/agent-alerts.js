// How she reaches him, rung by rung, on real items from her day: a notification (the PC pushes it; here, the preview), a
// banner (agentSay, on any screen: her new message, or an unseen nudge that climbed to the banner rung), the full-screen
// alarm (Duolingo-grade: one big action, the streak as rings, a snooze she argues with the second time), and the call
// that says why it's ringing. On the iPhone an alarm item is also scheduled with AlarmKit (it rings through Silent and
// Focus even with the app closed) and cancelled the moment it's done.
import { $, $$, esc, toast, haptic, on, ring, setRing, pulse } from './core.js';
import { I } from './icons.js';
import { TODAY_LABEL, DEMO_MODE } from './data.js';
import { api, has } from './bus.js';
import { native } from './svc/native-plugins.js';
import { AG, AI, changed, onChange, agName, aspName, dot, home, act, snooze, seen, refresh } from './agent-state.js';
import { hmOf } from './agent-data.js';

const phone = () => $('#phone');
const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fns = new Map(); let fnSeq = 0;
// an action is [label, act]: act is a data-act name (any area's) or a function
const actBtn = ([label, a], cls = 'btn sm') => {
  if (typeof a === 'function') { const k = `f${++fnSeq}`; fns.set(k, a); return `<button class="${cls}" data-act="ag-fn" data-k="${k}">${esc(label)}</button>`; }
  return `<button class="${cls}" data-act="${esc(a)}">${esc(label)}</button>`;
};
on('ag-fn', (el) => { const f = fns.get(el.dataset.k); el.closest('.ag-say')?.dispatchEvent(new Event('ag-done')); el.closest('.ag-alarm') && closeAlarm(); f?.(el); });

// ── the banner: agentSay(text, { aspect, kind, acts, title, item }) ───
let sayT = null;
export function agentSay(text, { aspect = null, app = null, kind = 'nudge', acts = [], title = null, onUndo = null, item = null } = {}) {
  $('.ag-say')?.remove(); clearTimeout(sayT);
  $('#toast')?.classList.remove('on');   // her banner takes the top of the screen; a passing toast steps aside
  const id = aspect ?? app, name = esc(agName());
  const list = [...acts];
  if (kind === 'did' && onUndo) list.push(['Undo', () => { onUndo(); toast('Undone'); }]);
  const b = document.createElement('div');
  b.className = `ag-say overlay k-${kind}`;
  b.setAttribute('role', kind === 'ask' ? 'alertdialog' : 'status');
  b.setAttribute('aria-label', `${agName()}: ${title ?? text}`);
  b.innerHTML = `<button class="ag-say-main" data-act="ag-say-open" data-id="${esc(id ?? '')}" data-item="${esc(item ?? '')}">
      <span class="orb sm" aria-hidden="true"></span>
      <span class="ag-say-t">
        <span class="ag-say-k"><b>${name}</b>${id ? `${dot(id)}<span>${esc(aspName(id))}</span>` : ''}<time>now</time></span>
        ${title ? `<b class="ag-say-h">${esc(title)}</b>` : ''}<span class="ag-say-x">${esc(text)}</span>
      </span></button>
    ${list.length ? `<div class="ag-say-acts">${list.map((a, i) => actBtn(a, `btn sm${i === 0 && kind !== 'did' ? ' primary' : ''}`)).join('')}</div>` : ''}`;
  phone().append(b);
  requestAnimationFrame(() => requestAnimationFrame(() => b.classList.add('in')));
  haptic(kind === 'ask' ? 16 : 10);
  const hide = () => { clearTimeout(sayT); b.classList.remove('in'); setTimeout(() => b.remove(), 420); };
  b.addEventListener('ag-done', hide);
  b.addEventListener('click', (e) => { if (e.target.closest('.ag-say-acts button')) setTimeout(hide, 60); });
  // swipe it away upward; holding it keeps it
  let y0 = null;
  b.addEventListener('pointerdown', (e) => { y0 = e.clientY; clearTimeout(sayT); });
  b.addEventListener('pointermove', (e) => { if (y0 == null) return; const dy = Math.min(0, e.clientY - y0); b.style.transform = `translateY(${dy}px)`; });
  const end = (e) => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; b.style.transform = ''; if (dy < -40) { hide(); if (item) seen([item]).catch(() => {}); } else arm(); };
  b.addEventListener('pointerup', end); b.addEventListener('pointercancel', end);
  const arm = () => { clearTimeout(sayT); sayT = setTimeout(hide, kind === 'ask' ? 11000 : 6500); };
  arm();
  return b;
}
on('ag-say-open', (el) => {
  const id = el.dataset.id || null, item = el.dataset.item || null;
  el.closest('.ag-say')?.dispatchEvent(new Event('ag-done'));
  if (item) seen([item]).catch(() => {});
  api.askAgent('', { aspect: id });
});

// ── what arrives while he's in the app ───────────────────────────────
// her new message (a nudge, a report, an answer) when the thread isn't open: a banner
const FRESH_MS = 3 * 60000;
onChange((what, m) => {
  if (what === 'message' && m && !AG.thread.open && document.visibilityState === 'visible') {
    if (Date.now() - Date.parse(m.at ?? 0) > FRESH_MS) return;
    if (m.role === 'call') { agentSay(m.text, { kind: 'did', title: 'From our call', app: 'growth', acts: [['Open', () => api.openAgent('chat')]] }); return; }
    if (m.role !== 'wyn') return;
    const ask = m.meta?.askState && ['asked', 'calling'].includes(m.meta.askState.status);
    const did = m.meta?.did?.[0] ?? null;
    agentSay(m.text, { kind: ask ? 'ask' : did ? 'did' : 'nudge', app: did?.app ?? null, acts: ask ? [['Answer', () => api.openAgent('reply', m.meta.askState.id)]] : [['Reply', () => api.openAgent('chat')]] });
  }
  if (what === 'home') { ladderWatch(); scheduleAlarms(); }
});
// the ladder's upper rungs while the app is open: the banner rung shows a banner, the alarm rung the full screen
const shown = new Set();
function ladderWatch() {
  if (document.visibilityState !== 'visible') return;
  const live = [...AG.items, ...AG.older, ...AG.asks, ...AG.alarms].filter((x) => x.status === 'open' && x.ladder && !x.ladder.seen);
  for (const x of live) {
    const r = x.ladder.rung ?? 0;
    if (r >= 3 && !shown.has(`${x.id}:3`) && !$('.ag-alarm')) { shown.add(`${x.id}:3`); alarm({ item: x.id }); return; }
    if (r === 2 && !shown.has(`${x.id}:2`)) {
      shown.add(`${x.id}:2`);
      agentSay(x.text ?? '', { kind: x.kind === 'ask' ? 'ask' : 'nudge', title: x.title, app: home(x), item: x.id,
        acts: x.kind === 'ask' ? [[x.ask?.yes ?? 'Yes', () => api.agentAnswer(x.id, 'yes')], [x.ask?.no ?? 'Not now', () => api.agentAnswer(x.id, 'no')]]
          : [['Got it', () => seen([x.id]).catch(() => {})], ['Later', () => snooze(x.id, 30).catch(() => {})]] });
      return;
    }
  }
}
// on the iPhone, an alarm item rings through AlarmKit at its time even if the app is closed; done items are cancelled
const AKEY = 'agentos-app:agent-alarms';
const scheduledAlarms = () => { try { return JSON.parse(localStorage.getItem(AKEY) ?? '{}'); } catch { return {}; } };
async function scheduleAlarms() {
  if (DEMO_MODE || !native.available) return;
  const have = scheduledAlarms();
  const want = AG.alarms.filter((x) => x.status === 'open' && x.ladder?.alarmAt && Date.parse(x.ladder.alarmAt) > Date.now() && (x.ladder.ceiling ?? 0) >= 3);
  for (const x of want) {
    if (have[x.id] === x.ladder.alarmAt) continue;
    const r = await native.alarm.schedule({ id: `aos-${x.id}`, at: x.ladder.alarmAt, title: x.title, body: x.text ?? '', snoozeMinutes: 10, url: `agenticos://agent/alarm/${x.id}` });
    if (r?.ok) have[x.id] = x.ladder.alarmAt;
  }
  for (const id of Object.keys(have)) if (!want.some((x) => x.id === id)) { await native.alarm.cancel({ id: `aos-${id}` }); delete have[id]; }
  try { localStorage.setItem(AKEY, JSON.stringify(have)); } catch {}
}
// the native alarm's buttons: stop (seen), snooze (her snooze, so the PC's ladder waits too), open (the alarm screen)
native.on?.('alarm', (e) => {
  const id = String(e?.id ?? '').replace(/^aos-/, '');
  if (!id) return;
  if (e.action === 'snooze') snooze(id, 10).catch(() => {});
  else if (e.action === 'stop') seen([id]).catch(() => {});
  else if (e.action === 'open') alarm({ item: id });
});

// ── a notification, as iOS would show it (the ladder's first rung, previewed) ───
export function notify({ title = agName(), text = 'Two lines for your journal before bed.' } = {}) {
  $('.ag-note')?.remove();
  const n = document.createElement('div');
  n.className = 'ag-note overlay'; n.setAttribute('role', 'status');
  n.innerHTML = `<span class="ag-note-app" aria-hidden="true"><span class="orb xs"></span></span>
    <span class="ag-note-t"><span class="ag-note-k"><b>${esc(title)}</b><time>now</time></span><span>${esc(text)}</span></span>`;
  phone().append(n);
  requestAnimationFrame(() => requestAnimationFrame(() => n.classList.add('in')));
  haptic(8);
  setTimeout(() => { n.classList.remove('in'); setTimeout(() => n.remove(), 420); }, 4200);
  n.addEventListener('click', () => { n.classList.remove('in'); setTimeout(() => n.remove(), 300); api.askAgent('', {}); });
}

// ── the full-screen alarm: an alarm item from her day (or a preview) ──
let AL = null;
const itemOf = (id) => [...AG.alarms, ...AG.items, ...AG.older, ...AG.asks].find((x) => x.id === id) ?? null;
export function alarm(o = {}) {
  closeAlarm(true);
  const x = o.item ? itemOf(o.item) : null;
  const app = x ? home(x) : (o.aspect ?? 'growth');
  const streak = x?.meta?.streak ?? (o.preview ? { n: 6 } : null);
  const n = Number(streak?.n ?? streak?.current ?? 0);
  const journal = app === 'growth' && !o.acts;
  const S = { snoozes: x?.ladder?.snoozes ?? 0, item: x?.id ?? null, app, journal, preview: !!o.preview && !x,
    title: x?.title ?? o.title ?? 'Save your 6-day journal streak', text: x?.text ?? o.text ?? 'Two lines are enough. It takes ninety seconds.',
    time: x?.ladder?.alarmAt ? hmOf(x.ladder.alarmAt) : (o.time ?? hmOf(new Date().toISOString())) };
  const el = document.createElement('div');
  el.className = 'ag-alarm stay-dark';
  el.dataset.aspect = app;
  el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', S.title);
  const days = n ? Array.from({ length: 7 }, (_, i) => `<span class="ag-al-day${i === 6 ? ' today' : ''}">${ring(i < 6 && i >= 6 - Math.min(6, n) ? 1 : 0, 'as', i === 6 ? 44 : 30, i === 6 ? 6 : 4, { cls: i === 6 ? 'ag-al-open' : '', delay: i * 60 })}<small>${i === 6 ? 'Today' : ''}</small></span>`).join('') : '';
  el.innerHTML = `<div class="ag-al-top"><p class="ag-al-time num">${esc(S.time)}</p><p class="ag-al-date">${esc(TODAY_LABEL.weekday)} ${esc(TODAY_LABEL.day)} ${esc(TODAY_LABEL.month)}</p></div>
    <div class="ag-al-mid">
      <p class="ag-al-from"><span class="orb xs" aria-hidden="true"></span><b>${esc(agName())}</b><span>·</span><span>${esc(aspName(app))}</span>${S.preview ? '<span>· preview</span>' : ''}</p>
      <h2 class="ag-al-title">${esc(S.title)}</h2>
      <p class="ag-al-text" aria-live="polite">${esc(S.text)}</p>
      ${days ? `<div class="ag-al-streak" role="img" aria-label="${n} days in a row; today is still open">${days}</div>` : ''}
      ${journal ? `<div class="ag-al-write" hidden><textarea rows="3" placeholder="How did today go? Two lines." aria-label="Two lines for your journal"></textarea></div>` : ''}
    </div>
    <div class="ag-al-acts">
      ${journal ? `<button class="btn primary block ag-al-go" data-act="ag-al-write" style="--c:var(--as-fill)">Write two lines</button>`
        : o.acts ? o.acts.map((a, i) => actBtn(a, `btn block${i === 0 ? ' primary' : ''}`)).join('').replace('class="btn block primary"', 'class="btn block primary" style="--c:var(--as-fill)"')
        : `<button class="btn primary block ag-al-go" data-act="ag-al-app" style="--c:var(--as-fill)">Open ${esc(aspName(app))}</button>`}
      <div class="ag-al-row">
        <button class="btn" data-act="ag-al-snooze">${AI.snooze}<span>Snooze 10 min</span></button>
        <button class="btn" data-act="ag-al-dismiss">${I.x}<span>Dismiss</span></button>
      </div>
      <p class="ag-al-foot">${esc(o.foot ?? ((x?.ladder?.ceiling ?? 3) >= 4 ? 'If it isn\'t done, I call you next.' : 'If it isn\'t done, I\'ll ask again on my next check.'))}</p>
    </div>`;
  phone().append(el);
  AL = { el, S };
  requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('in'); pulse(el, 160); }));
  try { navigator.vibrate?.([220, 120, 220]); } catch {}
  if (x) seen([x.id]).catch(() => {});
  if (o.demo === 'write') setTimeout(() => writeMode(), reduce() ? 0 : 520);
  return el;
}
function closeAlarm(instant = false) {
  const a = AL; if (!a) return; AL = null;
  if (instant) { a.el.remove(); return; }
  a.el.classList.remove('in'); setTimeout(() => a.el.remove(), 450);
}
function writeMode() {
  const a = AL; if (!a) return;
  const w = $('.ag-al-write', a.el); if (!w) return;
  w.hidden = false; $('.ag-al-text', a.el).textContent = 'Two lines. What went well, what you would change.';
  $('.ag-al-streak', a.el)?.classList.add('small');
  const go = $('.ag-al-go', a.el);
  go.textContent = 'Save'; go.dataset.act = 'ag-al-save'; go.disabled = true;
  $('.ag-al-row', a.el).hidden = true;
  const ta = $('textarea', w);
  ta.addEventListener('input', () => { go.disabled = !ta.value.trim(); });
  setTimeout(() => ta.focus({ preventScroll: true }), 80);
}
on('ag-al-write', () => writeMode());
on('ag-al-app', () => { const a = AL; if (!a) return; closeAlarm(); api.openAspect(a.S.app, undefined, { back: agName() }); });
// saving the lines writes Growth's journal through her tools (it lands in her day), and the open ring closes
on('ag-al-save', async () => {
  const a = AL; if (!a) return;
  const text = $('textarea', a.el).value.trim(); if (!text) return;
  haptic(18);
  const go = $('.ag-al-go', a.el); go.disabled = true; go.textContent = 'Saving…';
  let ok = true, queued = false;
  if (!DEMO_MODE) {
    try { const r = await act('/wyn/tools/run', { name: 'growth_journal_write', args: { text } }); queued = !!r?.queued; if (r?.result?.error) ok = false; }
    catch { ok = false; }
  }
  if (!ok) { go.disabled = false; go.textContent = 'Save'; toast('Couldn\'t save it. Try again, or open Growth.'); return; }
  if (a.S.item) act(`/wyn/feed/${a.S.item}/answer`, { choice: 'yes' }).catch(() => {});
  $('.ag-al-write', a.el).hidden = true;
  $('.ag-al-streak', a.el)?.classList.remove('small');
  const openRing = $('.ag-al-open', a.el); if (openRing) setRing(openRing, 1);
  $('.ag-al-title', a.el).textContent = 'Saved';
  $('.ag-al-text', a.el).textContent = queued ? 'In your journal as soon as the PC is back. Nothing else will ring tonight.' : 'In your journal. Nothing else will ring tonight.';
  $('.ag-al-acts', a.el).innerHTML = `<button class="btn block" data-act="ag-al-dismiss">Done</button>`;
  changed('did');
  refresh({ quiet: true });
  setTimeout(() => { if (AL === a) closeAlarm(); }, 2600);
});
on('ag-al-snooze', async () => {
  const a = AL; if (!a) return;
  haptic(10);
  a.S.snoozes += 1;
  const r = a.S.item ? await snooze(a.S.item, 10).catch(() => null) : null;
  const argue = r?.argue ?? (a.S.snoozes >= 2 ? 'That\'s the second snooze. It takes two minutes now, and then I stop asking.' : null);
  if (argue && !a.el.classList.contains('argued')) {
    $('.ag-al-text', a.el).textContent = argue;
    $('.ag-al-row', a.el).innerHTML = `<button class="btn" data-act="ag-al-snooze-final">${AI.snooze}<span>Snooze anyway</span></button>`;
    $('.ag-al-go', a.el)?.replaceChildren(document.createTextNode(a.S.journal ? 'Fine, write now' : 'Fine, do it now'));
    a.el.classList.add('argued');
    return;
  }
  closeAlarm();
  toast(r?.queued ? 'Snoozed; the PC hears it when it\'s back' : 'Snoozed for 10 minutes');
});
on('ag-al-snooze-final', () => { closeAlarm(); toast('Snoozed for 10 minutes'); });
on('ag-al-dismiss', () => { const a = AL; if (a?.S.item) seen([a.S.item]).catch(() => {}); closeAlarm(); });

// ── the call that says why it's ringing ──────────────────────────────
export function ringFull({ why = 'a quick check-in', agenda = [], len = '', incomingId = null } = {}) {
  $('.ag-ring')?.remove(); $('.ninc')?.remove();
  const name = esc(agName());
  const el = document.createElement('div');
  el.className = 'ag-ring stay-dark'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-label', `${agName()} is calling about ${why}`);
  el.innerHTML = `<div class="ag-ring-stage"><span class="orb big" aria-hidden="true"></span></div>
    <h2 class="ag-ring-name">${name}</h2>
    <p class="ag-ring-why">is calling about <b>${esc(why)}</b></p>
    ${agenda.length ? `<ol class="ag-ring-agenda">${agenda.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>` : ''}
    ${len ? `<p class="ag-ring-len">${esc(len)}</p>` : ''}
    <div class="ag-ring-small">
      <button class="ag-ring-s" data-act="ag-ring-text"><span class="nc-c">${I.chat}</span><span>Text me instead</span></button>
      <button class="ag-ring-s" data-act="ag-ring-later"><span class="nc-c">${I.clock}</span><span>In 30 min</span></button>
    </div>
    <div class="ag-ring-main">
      <button class="nc-btn end" data-act="ag-ring-decline"><span class="nc-c">${I.phone}</span><span>Decline</span></button>
      <button class="nc-btn ans" data-act="ag-ring-answer"><span class="nc-c">${I.phone}</span><span>Answer</span></button>
    </div>`;
  el._ctx = { why, agenda, incomingId };
  phone().append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  try { navigator.vibrate?.([400, 200, 400]); } catch {}
  return el;
}
const closeRing = () => { const r = $('.ag-ring'); if (!r) return null; r.classList.remove('in'); setTimeout(() => r.remove(), 420); return r._ctx; };
on('ag-ring-answer', () => { const c = closeRing(); haptic(14); api.startCall({ why: c?.why ?? 'She called', agenda: c?.agenda, incomingId: c?.incomingId }); });
on('ag-ring-decline', () => { const c = closeRing(); haptic(10); if (c?.incomingId && !DEMO_MODE) act(`/wyn/incoming/${c.incomingId}/decline`, {}).catch(() => {}); });
on('ag-ring-text', () => { const c = closeRing(); haptic(8); if (c?.incomingId && !DEMO_MODE) act(`/wyn/incoming/${c.incomingId}/decline`, {}).catch(() => {}); setTimeout(() => api.askAgent(c?.why ? `Text me instead: ${c.why}` : '', {}), 420); });
on('ag-ring-later', () => { const c = closeRing(); haptic(8); if (c?.incomingId && !DEMO_MODE) act(`/wyn/incoming/${c.incomingId}/snooze`, { minutes: 30 }).catch(() => {}); toast('She\'ll ring again in 30 minutes'); });

// the ladder, rung by rung, from her home and her reminders page (previews: nothing is sent)
export function preview(id) {
  if (id === 'note') return notify({ text: 'Two lines for your journal before bed.' });
  if (id === 'banner') return agentSay('Your journal block is on. Two lines are enough.', { app: 'growth', title: 'Journal, 22:00', acts: [['Write now', () => (has('writeJournal') ? api.writeJournal() : api.openJournal())], ['Later', 'ag-say-x']] });
  if (id === 'alarm') return alarm({ preview: true });
  if (id === 'call') return ringFull({ why: 'your journal streak', agenda: ['Two lines for today', 'Tomorrow\'s first block'], len: 'About 2 minutes' });
  return null;
}
on('ag-say-x', (el) => el.closest('.ag-say')?.dispatchEvent(new Event('ag-done')));

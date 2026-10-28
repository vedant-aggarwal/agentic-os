// Romance: pieces both states share (icons, the Face ID lock, cards, the note composer, the privacy sheet).
// Owner: the PEOPLE agent. Prefix rom-. His notes are real records (people_journal); the preview's stay in memory.
import { $, $$, esc, on, openSheet, closeSheet, toast, haptic, pulse, wireSegs, seg } from '../core.js';
import { I } from '../icons.js';
import { api, has } from '../bus.js';
import { S, FEELS, NOTE_PROMPTS, COUPLE_NOTES, MOMENTS, TOOLS, BY, PARTNER, prefs, setPref } from './romance-data.js';
import { AGENT } from '../data.js';
import * as P from './people-store.js';

// ── icons drawn for Romance, in the icons.js style (24 grid, 2px line) ──
const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const R = {
  // what you're looking for: a speech bubble holding a small heart
  want: s('<path d="M4.5 19V8.2a3.7 3.7 0 0 1 3.7-3.7h7.6a3.7 3.7 0 0 1 3.7 3.7v4.6a3.7 3.7 0 0 1-3.7 3.7H8.3z"/><path d="M12 13.4s-2.7-1.6-2.7-3.5a1.45 1.45 0 0 1 2.7-.8 1.45 1.45 0 0 1 2.7.8c0 1.9-2.7 3.5-2.7 3.5Z"/>'),
  // out there: a place to go
  out: s('<path d="M12 21s-6.5-5.7-6.5-11a6.5 6.5 0 0 1 13 0c0 5.3-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/>'),
  // check-in: two people talking
  talk: s('<path d="M4.5 15V6.6a3 3 0 0 1 3-3h4.2a3 3 0 0 1 3 3v3.6a3 3 0 0 1-3 3H7.3z"/><path d="M14.7 9.4h1.8a3 3 0 0 1 3 3v7.1l-3-2.3h-5a3 3 0 0 1-3-3v-1"/>'),
  gift: s('<rect x="4" y="9.5" width="16" height="10.5" rx="2.2"/><path d="M3.5 9.5h17M12 9.5V20M12 9.5c-.8-3-4.7-4.4-5.2-2.2-.4 1.8 2.6 2.2 5.2 2.2Zm0 0c.8-3 4.7-4.4 5.2-2.2.4 1.8-2.6 2.2-5.2 2.2Z"/>'),
  // repair: a plaster
  mend: s('<g transform="rotate(-45 12 12)"><rect x="2.8" y="8.4" width="18.4" height="7.2" rx="3.6"/><path d="M9.4 8.4v7.2M14.6 8.4v7.2"/></g>'),
  moments: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  note: I.edit,
  quiet: s('<path d="M7 12h10"/>', 'stroke-width="3"'),
};
// two open rings, for the door to the preview
export const pairArt = `<svg class="rom-pair" viewBox="0 0 72 44" fill="none" stroke-width="3" stroke-linecap="round" aria-hidden="true">
  <circle cx="26" cy="22" r="15" stroke="var(--as)"/><circle cx="46" cy="22" r="15" stroke="var(--as-b)" opacity=".8"/></svg>`;
// the Face ID glyph: four corners, a face, and the tick it turns into
const faceId = `<svg class="fid" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <g class="fid-c"><path d="M6 20v-7a7 7 0 0 1 7-7h7"/><path d="M44 6h7a7 7 0 0 1 7 7v7"/><path d="M58 44v7a7 7 0 0 1-7 7h-7"/><path d="M20 58h-7a7 7 0 0 1-7-7v-7"/></g>
  <g class="fid-f"><path d="M23 24v4.5M41 24v4.5"/><path d="M32.5 24v11.5h-3"/><path d="M24 42.5c4.6 4 11.4 4 16 0"/></g>
  <path class="fid-k" pathLength="1" d="M20.5 33.5 28 41l15.5-17"/></svg>`;

// ── sheets live outside the app page, so they carry the app's colour themselves ──
export const romSheet = (o) => { const el = openSheet(o); el.dataset.aspect = 'romance'; return el; };

// ── small pieces ──────────────────────────────────────────────────────
export const mono = (letter, cls = '') => `<span class="rom-mono ${cls}" aria-hidden="true">${esc(letter)}</span>`;
export const byIcon = (by) => (by === 'me' ? I.edit : by === 'chat' ? I.chat : by === 'cal' ? I.cal : I.mic);
export const byLine = (by, src = '') => `<p class="rom-by">${byIcon(by)}<span>${esc(String(BY[by] ?? by).replace(/^Wyn/, AGENT.name))}${src ? ` · ${esc(src)}` : ''}</span></p>`;
export const feelName = (k) => (FEELS.find(([v]) => v === k) ?? [k, k])[1];
export const sectionHead = (title, { count = null, act = '', actLabel = '', attrs = '' } = {}) =>
  `<div class="sh"><h2>${esc(title)}</h2>${count != null ? `<span class="sh-count">${esc(count)}</span>` : ''}${act ? `<button class="sh-act" data-act="${act}" ${attrs}>${esc(actLabel)}${I.chevR}</button>` : ''}</div>`;
export const lockKicker = `<span class="rom-kick">${I.lock}Private to you</span>`;
export const previewKicker = `<span class="rom-kick">${I.eye}Sample preview</span>`;

// the agent speaking inside the app: a wise, warm friend
export const wynCard = ({ at = '', text, acts = '' }) => `
  <section class="rom-card surface rom-wyn">
    <span class="tile rom-wyn-t" aria-hidden="true">${I.agent}</span>
    <div class="rom-wyn-b">
      <p class="rom-wyn-h"><b>${esc(AGENT.name)}</b>${at ? `<span>${esc(at)}</span>` : ''}</p>
      <p class="rom-wyn-x">${esc(text)}</p>
      ${acts ? `<div class="rom-row-btns">${acts}</div>` : ''}
    </div>
  </section>`;

// a journal entry or a moment: Apple Journal's card, saying who filed it
export const entryCard = (n) => `
  <article class="rom-entry surface">
    <p class="rom-entry-h"><span class="rom-entry-d">${esc(n.day)}${n.at ? ` · ${esc(n.at)}` : ''}</span>${n.feel ? `<span class="pill plain">${esc(feelName(n.feel))}</span>` : ''}</p>
    ${n.prompt ? `<p class="rom-entry-p">${esc(n.prompt)}</p>` : ''}
    <p class="rom-entry-t">${esc(n.text)}</p>
    ${byLine(n.by, n.src)}
  </article>`;

// the strip of weeks: done · missed · quiet · now
export const weekDots = (weeks, { done = false } = {}) => `<span class="rom-dots" role="img" aria-label="${weeks.map((w) => `${w.w}: ${w.s === 'now' ? (done ? 'done' : 'this week') : w.s}`).join(', ')}">${weeks.map((w) => {
  const st = w.s === 'now' ? (done ? 'done now' : 'now') : w.s;
  return `<i class="rom-dot ${st}">${st.startsWith('done') ? I.check : st === 'quiet' ? R.quiet : ''}</i>`;
}).join('')}</span>`;

// ── Face ID: Romance is private by default ────────────────────────────
const FIVE_MIN = 5 * 60 * 1000;
export const isLocked = () => prefs().lock && Date.now() - S.unlockedAt > FIVE_MIN;
export function mountLock(app) {
  const pg = app.page;
  if (!pg || !isLocked()) return;
  pg.classList.add('rom-locked');
  pg.insertAdjacentHTML('beforeend', `
    <div class="rom-lock" role="dialog" aria-modal="true" aria-labelledby="romLockT">
      <div class="rom-lock-in">
        ${faceId}
        <h2 class="rom-lock-t" id="romLockT">Romance is private</h2>
        <p class="rom-lock-s">Only you can open it. ${esc(AGENT.name)} files things here quietly and keeps them off Today.</p>
        <button class="btn primary rom-unlock" style="--c:var(--as-fill)" data-act="rom-unlock">Open with Face ID</button>
      </div>
    </div>`);
}
on('rom-unlock', async (el) => {
  const pg = el.closest('.page'); const lock = $('.rom-lock', pg);
  if (!lock || lock.classList.contains('scan') || lock._asking) return;
  haptic(10);
  // the iPhone asks Face ID (or the passcode); the web has no biometrics, so the tap is the unlock
  lock._asking = true;
  const r = await P.faceId('Open Romance');
  lock._asking = false;
  if (r.available && !r.ok) { lock.classList.remove('rom-no'); void lock.offsetWidth; lock.classList.add('rom-no'); haptic(20); return; }
  lock.classList.add('scan');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => { lock.classList.add('ok'); haptic(14); }, reduce ? 0 : 620);
  setTimeout(() => {
    S.unlockedAt = Date.now();
    lock.classList.add('out');
    pg.classList.remove('rom-locked');
    const app = pg._app; const sec = app?.el(app.section);
    if (sec) { sec.classList.remove('rom-rise'); void sec.offsetWidth; sec.classList.add('rom-rise'); pulse(sec, 60); }
    setTimeout(() => lock.remove(), 320);
  }, reduce ? 120 : 1040);
});
export function lockNow() {
  S.unlockedAt = 0;
  const app = S.app; if (!app?.page?.isConnected) return;
  closeSheet();
  app.page.scrollTop = 0;
  mountLock(app);
  toast('Romance is locked');
}

// ── the note composer: the primary action ─────────────────────────────
// prefill: { text, person, prompt, kind: 'note' | 'moment' }
export function openComposer(prefill = {}) {
  const couple = S.mode === 'couple';
  const kind = couple ? (prefill.kind ?? 'moment') : 'note';
  const st = { feel: null, prompt: prefill.prompt ?? '', kind };
  const head = (k) => k === 'moment' ? ['Log a moment', `With ${PARTNER.name} · sample preview`] : ['Private note', 'Only you read this'];
  const [t0, s0] = head(kind);
  const el = romSheet({
    large: true, cls: 'rom-sheet rom-compose', title: t0, sub: s0,
    body: `
      ${couple ? `<div class="pad rom-cmp-seg">${seg('rom-cmp-kind', [['moment', `Moment with ${esc(PARTNER.name)}`], ['note', 'Private note']], kind)}</div>` : ''}
      <div class="pad">
        <p class="rom-cmp-l">How does it feel?</p>
        <div class="chips rom-feels">${FEELS.map(([v, l]) => `<button class="chip sm" data-act="rom-feel" data-v="${v}" aria-pressed="false">${esc(l)}</button>`).join('')}</div>
        <p class="rom-cmp-prompt"${st.prompt ? '' : ' hidden'}>${esc(st.prompt)}</p>
        <label class="rom-ta"><span class="vh">Your note</span><textarea rows="7" placeholder="${couple && kind === 'moment' ? 'What happened? A line is enough.' : 'What’s on your mind?'}">${esc(prefill.text ?? '')}</textarea></label>
        <p class="rom-cmp-l">Or start from a prompt</p>
        <div class="chips rom-cprompts">${NOTE_PROMPTS.map((p) => `<button class="chip sm" data-act="rom-cprompt">${esc(p)}</button>`).join('')}</div>
        <p class="rom-cmp-foot">${I.lock}<span>${esc(AGENT.name)} reads your notes to notice patterns and never quotes them outside Romance.</span></p>
      </div>`,
    foot: `<div class="rom-sheet-foot">
        <button class="btn rom-ib" data-act="rom-cmp-voice" aria-label="Say it instead">${I.mic}</button>
        <button class="btn primary block" style="--c:var(--as-fill)" data-act="rom-cmp-save">${kind === 'moment' ? 'Save the moment' : 'Save privately'}</button>
      </div>`,
  });
  el._rom = st;
  $('.rom-cmp-seg', el)?.addEventListener('change', (e) => {
    st.kind = e.detail; const [t, sub] = head(st.kind);
    $('.sheet-head h3', el).textContent = t; $('.sheet-head p', el).textContent = sub;
    $('[data-act="rom-cmp-save"]', el).textContent = st.kind === 'moment' ? 'Save the moment' : 'Save privately';
  });
  if (prefill.text) requestAnimationFrame(() => { const ta = $('textarea', el); ta.setSelectionRange(ta.value.length, ta.value.length); });
  return el;
}
on('rom-feel', (el) => {
  const sh = el.closest('.sheet'); const st = sh?._rom; if (!st) return;
  const v = el.dataset.v; st.feel = st.feel === v ? null : v;
  $$('[data-act="rom-feel"]', sh).forEach((b) => { const onNow = b.dataset.v === st.feel; b.classList.toggle('on', onNow); b.setAttribute('aria-pressed', String(onNow)); });
  haptic(5);
});
on('rom-cprompt', (el) => {
  const sh = el.closest('.sheet'); const st = sh?._rom; if (!st) return;
  st.prompt = el.textContent; const p = $('.rom-cmp-prompt', sh);
  p.textContent = st.prompt; p.hidden = false;
  $('textarea', sh).focus();
});
on('rom-cmp-voice', () => { if (has('openCapture')) api.openCapture('voice', { aspect: 'romance', private: true }); else toast('Recording a private voice note'); });
on('rom-cmp-save', (el) => {
  const sh = el.closest('.sheet'); const st = sh?._rom; if (!st) return;
  const ta = $('textarea', sh); const text = ta.value.trim();
  if (!text) { ta.focus(); sh.classList.remove('rom-nudge'); void sh.offsetWidth; sh.classList.add('rom-nudge'); return; }
  closeSheet(sh);
  haptic(12);
  if (S.mode !== 'couple') {
    // his real journal: a private record in the people store, offline first
    const j = P.add('journal', { date: P.today(), at: P.nowHm(), kind: 'note', feel: st.feel ?? null, by: 'you', source: 'you', text, prompt: st.prompt || undefined });
    toast('Saved privately', () => P.remove('journal', j.id));
    return;
  }
  // the sample preview keeps its entries in memory only
  const entry = { id: `n${Date.now()}`, day: 'Today', at: P.nowHm(), feel: st.feel, by: 'me', text, prompt: st.prompt || undefined };
  const list = st.kind === 'moment' ? MOMENTS : COUPLE_NOTES;
  list.unshift(entry);
  refreshIfBuilt('moments');
  toast(st.kind === 'moment' ? 'Moment saved (preview)' : 'Saved (preview)', () => { const i = list.indexOf(entry); if (i >= 0) list.splice(i, 1); refreshIfBuilt('moments'); });
});

// re-render a section of the open app, only if it was already shown once
export function refreshIfBuilt(sid) {
  const app = S.app; const el = app?.el?.(sid);
  if (el?.dataset.built) app.refresh(sid);
}

// ── privacy and what Wyn does here ───────────────────────────────────
export function openPrivacy() {
  const pf = prefs();
  const sw = (k, title, meta) => `<div class="row"><span class="rbody"><span class="rtitle">${esc(title)}</span>${meta ? `<span class="rmeta">${esc(meta)}</span>` : ''}</span><button class="switch ${pf[k] ? 'on' : ''}" data-act="rom-sw" data-k="${k}" role="switch" aria-checked="${!!pf[k]}" aria-label="${esc(title)}"></button></div>`;
  const el = romSheet({
    large: true, cls: 'rom-sheet', title: 'Privacy', sub: `Romance stays between you and ${esc(AGENT.name)}`,
    body: `
      <div class="group">
        ${sw('lock', 'Face ID to open Romance', 'Asks again after 5 minutes away')}
        ${sw('onToday', 'A gentle line on Today', 'Only “One small step this week”, never a note')}
        ${sw('patterns', `${AGENT.name} reads your notes for patterns`, 'She never quotes them outside Romance')}
      </div>
      <div class="sh"><h2>Your situation</h2></div>
      <div class="pad">${seg('rom-mode', [['single', 'Single'], ['couple', 'With someone']], S.mode)}
        <p class="hint rom-hint">“With someone” shows a sample preview: a partner page, dates, check-ins and repair, with sample data.</p></div>
      <div class="sh"><h2>What ${esc(AGENT.name)} does here</h2><span class="sh-count">${TOOLS.length}</span></div>
      <div class="group">${TOOLS.map((t) => `<div class="row"><span class="rbody"><span class="rtitle wrap">${esc(t.does)}</span><span class="rmeta">${t.auto ? 'On her own, and tells you' : 'Asks you first'}</span></span></div>`).join('')}</div>
      <div class="pad rom-sheet-end"><button class="btn block" data-act="rom-lock-now">${I.lock}Lock Romance now</button></div>`,
  });
  $('[data-seg="rom-mode"]', el)?.addEventListener('change', (e) => {
    const m = e.detail; if (m === S.mode) return;
    closeSheet(el);
    setTimeout(() => switchMode(m), 260);
  });
  return el;
}
on('rom-privacy', () => openPrivacy());
on('rom-lock-now', () => lockNow());
on('rom-sw', (el) => {
  const k = el.dataset.k; const v = !prefs()[k];
  setPref(k, v);
  el.classList.toggle('on', v); el.setAttribute('aria-checked', String(v)); haptic(6);
  if (k === 'lock') toast(v ? 'Romance asks for Face ID again' : 'Romance opens without Face ID');
  if (k === 'onToday') toast(v ? 'Today shows one gentle line' : 'Romance is hidden on Today');
  if (k === 'patterns') { toast(v ? `${AGENT.name} will notice patterns again` : `${AGENT.name} won’t read your notes`); refreshIfBuilt('journal'); }
});

// ── switching between his state and the sample preview: one crossfade, the app rebuilt in place ──
let switcher = null;
export const setSwitcher = (fn) => { switcher = fn; };
export const switchMode = (m) => switcher?.(m);

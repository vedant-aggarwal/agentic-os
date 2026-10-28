// Growth's pushed pages and sheets: the composer (the app's primary action), an entry, a check-in, the guided Sunday
// review, the planning rituals, the streak, and the trend sheets. Owner: the Growth agent.
// State lives in G; growth.js sets the hooks it needs to repaint when something here changes.
import { $, $$, esc, on, push, pop, openSheet, closeSheet, toast, haptic, ring, setRing, pulse, seg, wireSegs } from '../core.js';
import { I } from '../icons.js';
import { aspectTile } from '../aspects.js';
import { aspect, AGENT, EVENTS, TASKS, GOALS, CONTENT, addGoal, updateTask, completeTask, task as taskOf } from '../data.js';
import { api, has } from '../bus.js';
import { native } from '../svc/native-plugins.js';
import * as API from '../svc/api.js';
import {
  TODAY, iso, fromIso, addDays, fmtDay, fmtLong, fmtShort, dow, dowLong, ENTRIES, entryOn, day, STREAK, entriesIn2026, PROMPTS, CHECKINS,
  WEEK, LEVEL, RATE, weekLabel, weekNo, ASPECT_LEVELS, VELOCITY, DRIVERS, POTENTIAL, REVIEW, PAST_REVIEWS, PAST_DREAMS, DREAM, PLAN, moodWord,
  REAL, TODAY_ENTRY, nowMin, hm, mondayOf, saveEntry, saveCheckin, putReview, putPlan, putSettings, SETTINGS, PHOTO_SRC, COL, aspectName,
} from './growth-data.js';
import { moodPad, wirePad, moodDot, spark, bullet, signed, moodSub } from './growth-viz.js';

// the deep link the app was opened with (#growth/review, #growth/write…), read before main.js rewrites the hash
export const BOOT = { hash: /^#growth\/(write|compose|review|plan|entry|checkin|streak)/.test(location.hash) ? location.hash : '' };

export const G = {
  saved: false, entry: null, draft: null, morePrompts: false,
  checkins: CHECKINS.map((c) => ({ ...c })),
  answered: {},          // dream proposals: id → 'yes' | 'no'
  reviewed: false, rule: null,
  backfilled: {},        // iso → an entry written later for a missed day
};
export const hooks = { onSaved() {}, onCheckin() {}, onReviewed() {}, refreshDream() {} };
const by = () => `<span class="gro-by"><span class="orb xs" aria-hidden="true"></span>${esc(AGENT.name)}</span>`;
const nowt = () => hm(nowMin());
/** Real mode: G mirrors what the PC and the store hold (today's entry, check-ins, answers, the review). */
export function syncG() {
  if (!REAL) return;
  G.saved = !!TODAY_ENTRY; G.entry = TODAY_ENTRY;
  G.checkins = CHECKINS.map((c) => ({ ...c }));
  G.answered = Object.fromEntries((DREAM?.proposals ?? []).filter((p) => p.answer).map((p) => [p.id, p.answer]));
  G.reviewed = !!REVIEW.sealed; G.rule = REVIEW.rule ?? G.rule;
}
syncG();
// an image the camera or the library gave (base64 or a data URL) as a small data URL for the entry
const asDataUrl = (r) => (r?.image ? (String(r.image).startsWith('data:') ? r.image : `data:${r.mime ?? 'image/jpeg'};base64,${r.image}`) : null);
export const backLabel = () => {
  const p = $('#stack')?.lastElementChild;
  if (p) return $('.tb-title', p)?.textContent?.trim() || 'Back';
  return { today: 'Today', life: 'Life', jobs: 'Work', agent: AGENT.name, more: 'More' }[$('#dock')?.dataset.tab] ?? 'Back';
};

// ── links into the other apps, through the bus. A link nobody has built yet shows the bus's own toast ──
export function link(to = '') {
  const i = to.indexOf(':'); const kind = to.slice(0, i), id = to.slice(i + 1);
  haptic(5);
  if (kind === 'aspect') return api.openAspect(id);
  if (kind === 'task') return api.openTask(id);
  if (kind === 'goal') return api.openGoal(id);
  if (kind === 'brain') return api.openBrain(id);
  if (kind === 'person') return api.openPerson(id);
  if (kind === 'review') return openPastReview(+id);
  if (kind === 'calendar') return api.openCalendar(id);
  if (kind === 'horizon') return api.openHorizon(id);
  if (kind === 'content') return api.openContent(id || 'stats');
}

// ── photos: demo entries keep a key and a caption but ship no image (src: null), so the drawn fallback shows ──
export const PHOTOS = {
  dinner: { src: null, alt: 'Dinner at home: dal, rice and rotis on steel plates', at: 'Tue 20 Oct, 21:05' },
  shop: { src: null, alt: 'Silk kurtas folded on the shop shelves', at: 'Sat 17 Oct, 16:20' },
  momos: { src: null, alt: 'A plate of momos at a street stall', at: 'Sat 10 Oct, 20:40' },
  desk: { src: null, alt: 'A laptop with code open on the desk at dusk', at: 'Today, 16:40' },
};
export function photoHtml(key, size = 'md') {
  const p = PHOTO_SRC.get(key) ?? PHOTOS[key]; if (!p) return '';
  if (!p.src) return `<span class="gro-ph ${size} none" data-ph="${key}"><i aria-hidden="true">${I.camera}</i></span>`;
  return `<span class="gro-ph ${size}" data-ph="${key}"><img src="${p.src}" alt="${esc(p.alt)}" loading="lazy" onerror="this.parentNode.classList.add('none');this.remove()" /><i aria-hidden="true">${I.camera}</i></span>`;
}

// ── what she files from an entry, by what it mentions ──
const FILERS = [
  [/mom|dad|mum|parents|dinner|family|home|bhai|didi/i, 'family', () => 'Family', 'aspect:family'],
  [/fee|payment|invoice|bill|₹|spent|money|paid|salary|rupees/i, 'money', (t) => (/fee|payment|invoice|bill/i.test(t) ? 'A payment' : 'Money'), 'aspect:money'],
  [/gym|bench|push|workout|cardio|sleep|slept|tired|protein|run|walk/i, 'body', (t) => (/sleep|slept|tired/i.test(t) ? 'Sleep and energy' : 'Training'), 'aspect:body'],
  [/read|book|pages|study|class|lecture|exam|course/i, 'mind', (t) => (/read|book|pages/i.test(t) ? 'Reading' : 'Study'), 'aspect:mind'],
  [/friend|met up|hung out|party/i, 'friends', () => 'Friends', 'aspect:friends'],
  [/ship|client|merge|launch|deploy|build|project|work|reel|post/i, 'mission', () => 'Work', 'aspect:mission'],
  [/habit|meditat|pray|calm|anxious|stress|phone|reels|scroll/i, 'soul', () => 'Habits and calm', 'aspect:soul'],
];
// the parts of his life an entry touches (by what it mentions). In real mode she files the facts herself from the PC;
// these chips only say where the entry points, and open that app.
export function fileTargets(text) {
  const out = FILERS.filter(([re]) => re.test(text)).slice(0, 3).map(([, a, label, to]) => [a, label(text), REAL ? 'Mentioned in this entry' : 'Filed', to]);
  return out.length ? out : [['growth', 'Tonight\'s entry', 'Kept in your journal', 'aspect:growth']];
}
const titleFrom = (text) => { const s = text.split(/[.!?\n]/)[0].trim(); return s.length > 46 ? `${s.slice(0, 44).replace(/\s+\S*$/, '')}…` : s || 'Tonight'; };
const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);

// ═══ THE COMPOSER: tonight's entry. Prompts from the day, typing or talking, mood and energy, photos, and her follow-up ═══
const VOICE = 'Push day this morning on barely five hours of sleep. Bench stuck at fifty again, and I know why: I was on reels till one. GE was fine. The listings took longer than I thought, twelve kurtas. I want to finish the Atlas ERP merge before dinner, so I can talk to Dad about the website fee without that hanging over me.';
// a second question when the first doesn't land, as in a focused mode: three to pick from, one at a time
const DEEPER_ALT = ['What would you tell a friend who wrote this?', 'What\'s one small thing you could do about it tomorrow?'];
const DEEPER = [
  [/dad|fee|payment|invoice|bill/i, 'What would make the fee feel fair, to him and to you?'],
  [/sleep|late|reels|tired|night/i, 'What were you doing in the hour before you slept, and what would you swap it for?'],
  [/gym|bench|workout|push/i, 'What would make Saturday\'s session better than today\'s?'],
  [/kabir|rohan|friend/i, 'What would you like the friendship to look like a year from now?'],
  [/.*/, 'What\'s underneath that? Say a little more.'],
];
export function openComposer(prefill = {}) {
  const pr = typeof prefill.prompt === 'string' && !PROMPTS.some((p) => p.id === prefill.prompt)
    ? { id: 'x', text: prefill.prompt, from: prefill.from ?? `${AGENT.name} asked`, aspect: 'growth' }
    : PROMPTS.find((p) => p.id === prefill.prompt) ?? PROMPTS[0];
  const st = { pi: PROMPTS.indexOf(pr), prompt: pr, p: prefill.p ?? null, e: prefill.e ?? null, photos: [], asked: [], kind: prefill.kind ?? 'typed', rec: null, deeperShown: false };
  const bf = prefill.backfill ? fromIso(prefill.backfill) : null;
  st.backfill = prefill.backfill ?? null;
  const draft = !prefill.text && !bf && G.draft ? G.draft : null;
  const start = prefill.text ?? draft?.text ?? (G.saved ? '' : '');
  const sheet = openSheet({
    large: true, cls: 'gro-cmp',
    head: `<div class="gro-cmp-head">
      <button class="sheet-close" data-act="gro-cmp-close" aria-label="Close">${I.x}</button>
      <div class="gro-cmp-ttl"><b>${bf ? `Fill in ${fmtDay(bf)}` : G.saved ? 'Add to tonight' : 'Tonight'}</b><small>${bf ? 'Written today, filed on that day' : `${fmtLong(TODAY)} · <span class="num">${nowt()}</span>${REAL ? '' : ' · Midtown'}`}</small></div>
      <button class="btn sm primary gro-save" style="--c:var(--as-fill)" data-act="gro-save">Save</button>
    </div>`,
    body(b) {
      b.innerHTML = `
        ${prefill.kind === 'scan' ? `<p class="gro-cmp-note">${I.scan}<span>Typed out from your scanned page${prefill.from ? `: ${esc(prefill.from)}` : ''}. Check it, then save.</span></p>` : ''}
        ${bf ? `<p class="gro-cmp-note">${I.rewind}<span>It goes in the journal for ${fmtDay(bf)}. Streaks count the nights you write, so this one won't change yours.</span></p>` : ''}
        <div class="gro-cmp-pr" aria-live="polite">
          <p class="gro-cmp-pr-k">${by()}<span class="gro-cmp-pr-f">${esc(pr.from)}</span></p>
          <p class="gro-cmp-pr-q">${esc(pr.text)}</p>
          <div class="gro-cmp-pr-a"><button class="btn sm" data-act="gro-cmp-next">${I.sync}Another prompt</button></div>
        </div>
        <div class="gro-flow"><textarea class="gro-ta" rows="4" placeholder="Start anywhere. Two lines are enough." aria-label="Tonight's entry">${esc(start)}</textarea></div>
        <div class="gro-deeper" hidden></div>
        <div class="gro-voice" hidden>
          <div class="gro-wave" aria-hidden="true">${Array.from({ length: 28 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>
          <p class="gro-voice-t"><span class="gro-rec-dot" aria-hidden="true"></span><span class="num" id="groRecT">0:00</span><span>Listening. ${esc(AGENT.name)} types as you talk.</span></p>
          <button class="btn sm" data-act="gro-cmp-stop">${I.stop}Stop</button>
        </div>
        <div class="gro-cmp-ph"></div>
        <div class="gro-cmp-md" hidden>${moodPad(st.p, st.e)}</div>
        <p class="gro-cmp-priv">${I.lock}<span>Only you and ${esc(AGENT.name)} read this. She files facts, never the words.${REAL ? ' Saved on this phone first, then on your PC.' : ''}</span></p>`;
    },
    foot: `<div class="gro-cmp-bar">
      <button class="gro-tb" data-act="gro-cmp-mood" aria-expanded="false"><span class="gro-tb-g">${moodDot(3, 3)}</span><span class="gro-tb-l">Mood</span></button>
      <button class="gro-tb" data-act="gro-cmp-photo">${I.camera}<span class="gro-tb-l">Photo</span></button>
      <button class="gro-tb" data-act="gro-cmp-voice">${I.mic}<span class="gro-tb-l">Talk</span></button>
      <span class="gro-cmp-wc num" aria-live="polite">0 words</span>
    </div>`,
    onClose() {
      clearInterval(st.rec);
      const txt = allText(sheet);
      if (!st.saved && txt.trim()) { G.draft = { text: txt }; toast('Draft kept for tonight'); }
      if (st.saved) G.draft = null;
    },
  });
  sheet.dataset.aspect = 'growth';
  sheet._st = st;
  const ta = $('.gro-ta', sheet);
  const grow = (t) => { t.style.height = 'auto'; t.style.height = `${Math.max(120, t.scrollHeight)}px`; };
  sheet.addEventListener('input', (e) => {
    const t = e.target.closest('.gro-ta'); if (!t) return;
    grow(t); count(sheet);
    clearTimeout(st.deeperT);
    if (!st.deeperShown && allText(sheet).length > 50) st.deeperT = setTimeout(() => showDeeper(sheet), 900);
  });
  wirePad(sheet, (p, e) => { st.p = p; st.e = e; const b = $('[data-act="gro-cmp-mood"]', sheet); $('.gro-tb-g', b).innerHTML = moodDot(p, e); $('.gro-tb-l', b).textContent = moodWord(p, e); b.classList.add('set'); });
  grow(ta); count(sheet);
  if (start && start.length > 50) showDeeper(sheet);
  if (prefill.mode === 'voice') setTimeout(() => startVoice(sheet), 380);
  else if (!prefill.noFocus) setTimeout(() => { ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length); }, 420);
  return sheet;
}
const allText = (sheet) => $$('.gro-flow .gro-ta', sheet).map((t) => t.value.trim()).filter(Boolean).join('\n\n');
function count(sheet) { const n = words(allText(sheet)); const w = $('.gro-cmp-wc', sheet); if (w) w.textContent = `${n} ${n === 1 ? 'word' : 'words'}`; }
function showDeeper(sheet) {
  const st = sheet._st; if (st.deeperShown) return;
  const txt = allText(sheet);
  const q = DEEPER.find(([re]) => re.test(txt))[1];
  st.deeperShown = true; st.deeperQ = q; st.qs = [q, ...DEEPER_ALT]; st.qi = 0;
  const d = $('.gro-deeper', sheet);
  d.innerHTML = `<p class="gro-dp-k">${by()}<span>has a follow-up</span></p><p class="gro-dp-q">${esc(q)}</p><div class="gro-dp-a"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="gro-cmp-deeper">Answer it</button><button class="btn sm" data-act="gro-cmp-otherq">Another question</button><button class="btn sm gro-dp-x" data-act="gro-cmp-nodeeper" aria-label="Not tonight">${I.x}</button></div>`;
  d.hidden = false; d.classList.add('gro-rise');
}
on('gro-cmp-close', (el) => closeSheet(el.closest('.sheet')));
on('gro-cmp-next', (el) => {
  const sheet = el.closest('.sheet'), st = sheet._st;
  st.pi = (Math.max(0, st.pi) + 1) % PROMPTS.length; st.prompt = PROMPTS[st.pi]; haptic(5);
  const box = $('.gro-cmp-pr', sheet);
  $('.gro-cmp-pr-f', box).textContent = st.prompt.from; $('.gro-cmp-pr-q', box).textContent = st.prompt.text;
  box.classList.remove('gro-swap'); void box.offsetWidth; box.classList.add('gro-swap');
});
on('gro-cmp-deeper', (el) => {
  const sheet = el.closest('.sheet'), st = sheet._st;
  const d = $('.gro-deeper', sheet); d.hidden = true;
  const flow = $('.gro-flow', sheet);
  flow.insertAdjacentHTML('beforeend', `<div class="gro-asked"><span class="orb xs" aria-hidden="true"></span><p>${esc(st.deeperQ)}</p></div><textarea class="gro-ta" rows="3" placeholder="Answer in a line or two" aria-label="Your answer"></textarea>`);
  st.asked.push(st.deeperQ);
  const t = flow.lastElementChild; t.style.height = '96px'; t.focus();
  haptic(6);
});
on('gro-cmp-nodeeper', (el) => { const d = $('.gro-deeper', el.closest('.sheet')); d.hidden = true; });
on('gro-cmp-otherq', (el) => {
  const sheet = el.closest('.sheet'), st = sheet._st; st.qi = (st.qi + 1) % st.qs.length; st.deeperQ = st.qs[st.qi]; haptic(4);
  const q = $('.gro-dp-q', sheet); q.textContent = st.deeperQ; q.classList.remove('gro-swap'); void q.offsetWidth; q.classList.add('gro-swap');
});
on('gro-cmp-mood', (el) => {
  const sheet = el.closest('.sheet'); const md = $('.gro-cmp-md', sheet);
  md.hidden = !md.hidden; el.setAttribute('aria-expanded', String(!md.hidden)); haptic(5);
  if (!md.hidden) { md.classList.add('gro-rise'); setTimeout(() => md.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 60); }
});
on('gro-cmp-photo', async (el) => {
  const sheet = el.closest('.sheet'), st = sheet._st;
  const box = $('.gro-cmp-ph', sheet);
  if (REAL) {
    if (st.photos.length >= 3) return toast('Three photos at most for one entry');
    const r = await native.scan.photo({ source: 'library', maxSize: 900, quality: 0.72 });
    const src = asDataUrl(r);
    if (!r.ok || !src) { if (!r.cancelled) toast('No photo added'); return; }
    const k = `new:${Date.now().toString(36)}`;
    PHOTO_SRC.set(k, { src, alt: 'A photo from tonight', at: nowt() });
    st.photos.push(k); haptic(6);
    box.innerHTML = `<div class="gro-phs">${st.photos.map((x) => `<span class="gro-phs-i">${photoHtml(x, 'md')}<button class="gro-phs-x" data-act="gro-cmp-addph" data-k="${x}" aria-label="Remove photo">${I.x}</button></span>`).join('')}</div>`;
    return;
  }
  if (box.querySelector('.gro-pick')) { box.querySelector('.gro-pick').remove(); return; }
  box.insertAdjacentHTML('afterbegin', `<div class="gro-pick gro-rise"><p class="gro-pick-h">From today</p><div class="gro-pick-l">${['desk', 'shop'].map((k) => `<button class="gro-pick-i${st.photos.includes(k) ? ' on' : ''}" data-act="gro-cmp-addph" data-k="${k}" aria-label="Add ${esc(PHOTOS[k].alt)}">${photoHtml(k, 'sm')}<small>${k === 'desk' ? '16:40' : '15:12'}</small></button>`).join('')}</div></div>`);
  haptic(5);
});
on('gro-cmp-addph', (el) => {
  const sheet = el.closest('.sheet'), st = sheet._st, k = el.dataset.k;
  if (st.photos.includes(k)) st.photos = st.photos.filter((x) => x !== k); else st.photos.push(k);
  haptic(6);
  const box = $('.gro-cmp-ph', sheet);
  box.innerHTML = st.photos.length ? `<div class="gro-phs">${st.photos.map((x) => `<span class="gro-phs-i">${photoHtml(x, 'md')}<button class="gro-phs-x" data-act="gro-cmp-addph" data-k="${x}" aria-label="Remove photo">${I.x}</button></span>`).join('')}</div>` : '';
});
on('gro-cmp-voice', (el) => { const sheet = el.closest('.sheet'); if (sheet._st.rec) stopVoice(sheet); else startVoice(sheet); });
on('gro-cmp-stop', (el) => stopVoice(el.closest('.sheet')));
// real dictation: the iPhone's on-device speech, else the browser's, else a note that typing works
const SR = () => globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition ?? null;
async function startDictation(sheet) {
  const st = sheet._st; const v = $('.gro-voice', sheet); const ta = $$('.gro-flow .gro-ta', sheet).at(-1);
  const base = ta.value.trim() ? `${ta.value.trim()} ` : '';
  const put = (t) => { ta.value = base + t; ta.style.height = 'auto'; ta.style.height = `${Math.max(120, ta.scrollHeight)}px`; count(sheet); };
  const show = () => {
    v.hidden = false; v.classList.add('rec', 'gro-rise'); st.kind = 'voice'; haptic(10);
    const dp = $('.gro-deeper', sheet); st.deeperWas = !dp.hidden; dp.hidden = true;
    $('[data-act="gro-cmp-voice"]', sheet)?.classList.add('on');
    let s = 0; st.t0 = Date.now();
    st.rec = setInterval(() => { s++; const t = $('#groRecT', sheet); if (t) t.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);
  };
  if (native.available) {
    const r = await native.speech.start({ locale: 'en-IN' });
    if (r.ok) { show(); st.unsub = native.speech.onPartial((e) => put(e.text ?? '')); st.stopper = async () => { const x = await native.speech.stop(); if (x?.text) put(x.text); st.unsub?.(); }; return; }
  }
  const R = SR();
  if (!R) { toast('Dictation isn\'t available in this browser. Type it, or use the iPhone app'); return; }
  const rec = new R(); rec.lang = 'en-IN'; rec.continuous = true; rec.interimResults = true;
  let finalT = '';
  rec.onresult = (e) => { let interim = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const x = e.results[i]; if (x.isFinal) finalT += `${x[0].transcript} `; else interim += x[0].transcript; } put((finalT + interim).trim()); };
  rec.onerror = (e) => { if (e.error !== 'aborted') toast(e.error === 'not-allowed' ? 'The microphone is blocked for this page' : 'Dictation stopped'); stopVoice(sheet); };
  rec.onend = () => { if (st.rec) stopVoice(sheet); };
  try { rec.start(); show(); st.stopper = () => { try { rec.stop(); } catch {} }; } catch { toast('Dictation couldn\'t start'); }
}
function startVoice(sheet) {
  if (REAL) return startDictation(sheet);
  const st = sheet._st; const v = $('.gro-voice', sheet); const ta = $$('.gro-flow .gro-ta', sheet).at(-1);
  v.hidden = false; v.classList.add('rec', 'gro-rise'); st.kind = 'voice'; haptic(10);
  const dp = $('.gro-deeper', sheet); st.deeperWas = !dp.hidden; dp.hidden = true;
  $('[data-act="gro-cmp-voice"]', sheet)?.classList.add('on');
  const ws = VOICE.split(' '); let i = 0, s = 0;
  const base = ta.value.trim() ? `${ta.value.trim()} ` : '';
  st.rec = setInterval(() => {
    i++; if (i % 4 === 0) { s++; const t = $('#groRecT', sheet); if (t) t.textContent = `0:${String(s).padStart(2, '0')}`; }
    ta.value = base + ws.slice(0, i).join(' ');
    ta.style.height = 'auto'; ta.style.height = `${Math.max(120, ta.scrollHeight)}px`; count(sheet);
    if (i >= ws.length) stopVoice(sheet);
  }, 150);
}
function stopVoice(sheet) {
  const st = sheet._st; clearInterval(st.rec); st.rec = null;
  if (st.t0) { const s = Math.round((Date.now() - st.t0) / 1000); st.len = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; st.t0 = 0; }
  const stop = st.stopper; st.stopper = null; stop?.();
  const v = $('.gro-voice', sheet); v.classList.remove('rec'); v.hidden = true;
  $('[data-act="gro-cmp-voice"]', sheet)?.classList.remove('on');
  if (st.deeperWas) $('.gro-deeper', sheet).hidden = false;
  else if (allText(sheet).length > 50) showDeeper(sheet);
}
on('gro-save', (el) => {
  const sheet = el.closest('.sheet'), st = sheet._st;
  clearInterval(st.rec);
  const text = allText(sheet);
  if (!text.trim()) { toast('Write a line first. Two lines are enough'); const t = $('.gro-ta', sheet); t.focus(); return; }
  if (REAL) {
    const photos = st.photos.map((k) => PHOTO_SRC.get(k)).filter(Boolean).map((x) => ({ src: x.src, at: x.at }));
    const first = !G.saved;
    const full = (G.saved && G.entry && !st.backfill) ? `${G.entry.text}\n\n${text}` : text;
    saveEntry({ text, p: st.p, e: st.e, kind: st.kind, photos, prompt: st.prompt?.text ?? null, asked: st.asked, backfill: st.backfill, filed: fileTargets(full), len: st.len ?? null });
    st.saved = true; G.draft = null; closeSheet(sheet); haptic(10);
    syncG();
    if (st.backfill) { toast(`Filed in ${fmtDay(fromIso(st.backfill))}`); setTimeout(() => hooks.onBackfill?.(), 300); return; }
    if (first) setTimeout(() => hooks.onSaved(), 420);
    else { toast('Added to tonight\'s entry'); setTimeout(() => hooks.onCheckin(), 300); }
    return;
  }
  const p = st.p ?? 4, e = st.e ?? 3;
  if (st.backfill) {
    G.backfilled[st.backfill] = { date: st.backfill, at: '17:52', kind: st.kind, p, e, words: words(text), title: titleFrom(text), text, photos: st.photos, photo: st.photos[0], filed: fileTargets(text), aspects: [], late: true };
    st.saved = true; closeSheet(sheet); haptic(10);
    toast(`Filed in ${fmtDay(fromIso(st.backfill))}`);
    setTimeout(() => hooks.onBackfill?.(), 300);
    return;
  }
  const add = G.saved && G.entry;
  const full = add ? `${G.entry.text}\n\n${text}` : text;
  G.entry = {
    date: iso(TODAY), at: add ? G.entry.at : '17:52', kind: add ? G.entry.kind : st.kind, p, e, words: words(full),
    title: add ? G.entry.title : titleFrom(text), text: full, photos: [...(add ? G.entry.photos : []), ...st.photos],
    photo: (add ? G.entry.photos : st.photos)[0] ?? st.photos[0], filed: fileTargets(full), asked: st.asked, aspects: [],
  };
  G.entry.aspects = G.entry.filed.map((f) => f[0]);
  const first = !G.saved;
  G.saved = true; G.draft = null; st.saved = true;
  closeSheet(sheet);
  if (first) setTimeout(() => hooks.onSaved(), 420);
  else { toast('Added to tonight\'s entry'); setTimeout(() => hooks.onCheckin(), 300); }
});

// ═══ AN ENTRY ═══════════════════════════════════════════════════════════
const PLACE = { '2026-10-17': 'Morgan & Co.', '2026-10-03': 'Morgan & Co.', '2026-10-10': 'the mall', '2026-10-09': 'City College' };
const WEATHER = ['27°, haze', '26°, clear', '28°, haze', '25°, smoke haze', '29°, sunny'];
function todayEntry() { return G.saved ? { ...G.entry, photo: G.entry.photos[0] } : null; }
export function openEntry(k) {
  const isToday = k === iso(TODAY);
  const e = isToday ? (todayEntry() ?? entryOn(k)) : entryOn(k) ?? G.backfilled[k];
  if (!e) {
    if (isToday) return openComposer();
    const info = day(k);
    return toast(info.written ? `A short entry on ${fmtDay(fromIso(k))}, mood ${moodWord(info.p, info.e).toLowerCase()}` : `No entry on ${fmtDay(fromIso(k))}`);
  }
  const d = fromIso(e.date);
  const list = ENTRIES.filter((x) => x.text && x.date !== iso(TODAY));
  const idx = list.findIndex((x) => x.date === e.date);
  const newer = isToday ? null : idx > 0 ? list[idx - 1] : (G.saved ? { date: iso(TODAY), title: G.entry.title } : null);
  const older = isToday ? list[0] : list[idx + 1];
  push({
    title: fmtDay(d), back: backLabel(), aspect: 'growth', cls: 'gro-ep',
    right: `<button class="gbtn chrome icon" data-act="gro-ask" data-q="${esc(`About my entry on ${fmtDay(d)}`)}" aria-label="Ask ${esc(AGENT.name)} about this entry">${I.sparkle}</button>`,
    render(sc) {
      sc.innerHTML = `
        <header class="gro-ep-head">
          <p class="gro-ep-k c-as">${fmtLong(d)}</p>
          <h1 class="gro-ep-t">${esc(e.title)}</h1>
          <p class="gro-ep-m">${moodDot(e.p, e.e)}<b>${esc(e.mood && !e.p ? e.mood : moodWord(e.p, e.e))}</b><span>·</span><span class="num">${e.at}</span><span>·</span><span>${e.kind === 'voice' ? `Spoken${e.len ? `, <span class="num">${e.len}</span>` : ''}` : e.kind === 'scan' ? 'Scanned page' : e.kind === 'agent' || e.by === 'wyn' ? `Told ${esc(AGENT.name)}` : 'Typed'}</span><span>·</span><span class="num">${e.words} words</span>${e.late ? '<span>·</span><span>Filled in later</span>' : ''}</p>
          ${REAL ? '' : `<p class="gro-ep-ctx">${I.globe}<span>${esc(PLACE[e.date] ?? 'Midtown')} · ${WEATHER[d.getDate() % WEATHER.length]}</span></p>`}
        </header>
        ${e.photo ? `<div class="gro-ep-ph">${photoHtml(e.photo, 'lg')}${PHOTOS[e.photo] ? `<p class="gro-ep-phc">${esc(PHOTOS[e.photo].at)}</p>` : ''}</div>` : ''}
        ${e.kind === 'voice' && !REAL ? `<button class="gro-ep-au surface" data-act="gro-play" aria-label="Play the voice note">${I.play}<span class="gro-ep-wv" aria-hidden="true">${Array.from({ length: 34 }, (_, i) => `<i style="--h:${(Math.sin(i * 1.7) * 0.5 + 0.5) * 70 + 18}%"></i>`).join('')}</span><span class="num">${e.len ?? '1:12'}</span></button>` : ''}
        <div class="gro-ep-body">${e.text.split(/\n+/).map((pp) => `<p>${esc(pp)}</p>`).join('')}${(e.asked ?? []).length && isToday ? e.asked.map((q) => `<div class="gro-asked"><span class="orb xs" aria-hidden="true"></span><p>${esc(q)}</p></div>`).join('') : ''}</div>
        ${e.filed?.length ? `<div class="sh"><h2>${REAL ? 'What it touches' : `What ${esc(AGENT.name)} took from it`}</h2><span class="sh-count">${e.filed.length}</span></div>
          <div class="group">${e.filed.map(([a, t, m, to]) => `<button class="row ic" data-act="gro-open" data-to="${to}">${aspectTile(a)}<span class="rbody"><span class="rtitle">${esc(t)}</span><span class="rmeta"><span>${esc(aspect(a)?.name ?? 'Brain')}</span><span>·</span><span class="ell">${esc(m)}</span></span></span>${I.chevR}</button>`).join('')}</div>
          <p class="hint">She files the facts. The words stay in your journal.</p>` : ''}
        ${e.asked && typeof e.asked === 'string' ? `<section class="gro-ep-ask surface"><p class="gro-ep-ask-k">${by()}<span>asked the next morning</span></p><p class="gro-ep-ask-q">${esc(e.asked)}</p><div class="gro-ep-ask-a"><button class="btn sm tint" style="--c:var(--as-ink)" data-act="gro-answer" data-q="${esc(e.asked)}" data-from="${esc(`${AGENT.name} asked about ${fmtDay(d)}`)}">Answer tonight</button><button class="btn sm" data-act="gro-ask" data-q="${esc(e.asked)}">Talk it through</button></div></section>` : ''}
        <nav class="gro-ep-nav">
          ${older ? `<button class="gro-ep-nb" data-act="gro-entry-swap" data-date="${older.date}"><small>${I.chevL}Older</small><span>${esc(older.title)}</span></button>` : '<span></span>'}
          ${newer ? `<button class="gro-ep-nb r" data-act="gro-entry-swap" data-date="${newer.date}"><small>Newer<span class="gro-flip">${I.chevL}</span></small><span>${esc(newer.title)}</span></button>` : '<span></span>'}
        </nav>`;
    },
  });
}
on('gro-entry-swap', (el) => { pop(); setTimeout(() => openEntry(el.dataset.date), 60); });
on('gro-answer', (el) => openComposer({ prompt: el.dataset.q, from: el.dataset.from }));
on('gro-play', (el) => { el.classList.toggle('on'); haptic(5); toast(el.classList.contains('on') ? 'Playing the voice note' : 'Paused'); });

// ═══ A CHECK-IN ═════════════════════════════════════════════════════════
const BEHIND = ['Work', 'College', 'Family', 'Body', 'Sleep', 'Money', 'Friends', 'Nothing in particular'];
export function openCheckin() {
  const st = { p: null, e: null, why: [] };
  const sh = openSheet({
    title: 'How are you now?', cls: 'gro-cks',
    body(b) {
      b.innerHTML = `<div class="pad">${moodPad(null, null, { compact: true })}</div>
        <p class="gro-cks-h pad">What's behind it?</p>
        <div class="chips pad gro-cks-c">${BEHIND.map((w) => `<button class="chip sm" data-act="gro-ck-why" data-w="${esc(w)}" aria-pressed="false">${esc(w)}</button>`).join('')}</div>
        <div class="pad gro-cks-s"><button class="btn primary block" style="--c:var(--as-fill)" data-act="gro-ck-save" disabled>Save check-in</button></div>
        <p class="hint">${esc(AGENT.name)} reads your check-ins with the calendar on Sunday: which hours lift you, which drain you.</p>`;
    },
  });
  sh.dataset.aspect = 'growth'; sh._st = st;
  wirePad(sh, (p, e) => { st.p = p; st.e = e; $('[data-act="gro-ck-save"]', sh).disabled = false; });
}
on('gro-ck-why', (el) => { const st = el.closest('.sheet')._st; const w = el.dataset.w; el.classList.toggle('on'); el.setAttribute('aria-pressed', String(el.classList.contains('on'))); st.why = el.classList.contains('on') ? [...st.why, w] : st.why.filter((x) => x !== w); haptic(4); });
on('gro-ck-save', (el) => {
  const sh = el.closest('.sheet'), st = sh._st; if (!st.p) return;
  if (REAL) { saveCheckin({ p: st.p, e: st.e, why: st.why }); syncG(); }
  else G.checkins.push({ at: nowt(), p: st.p, e: st.e, note: st.why.length ? st.why.join(', ') : 'Afternoon' });
  closeSheet(sh); haptic(10);
  toast(`Checked in: ${moodWord(st.p, st.e)}`);
  setTimeout(() => hooks.onCheckin(), 300);
});

// ═══ THE SUNDAY REVIEW: guided, one question a screen, drafted from the week ═══
const STEPS = [['feel', 'How the week felt'], ['numbers', 'The week in numbers'], ['wins', 'What went well'], ['misses', 'What went wrong'], ['rule', 'One lesson, one rule'], ['plan', 'Next week']];
function contentWeek() {
  // the Content agent's numbers when it answers; this app's sample otherwise
  let s = null;
  try { s = has('contentSummary') ? api.contentSummary() : null; } catch { s = null; }
  const n = (...v) => v.find((x) => typeof x === 'number' && isFinite(x));
  if (REAL) {
    // real mode: only what the Content tab says; the PC's own count of published posts otherwise
    const pc = WEEK.points.find((p) => p.aspect === 'content');
    const posted = n(s?.week?.posted, s?.posted, s?.reels, s?.week?.reels) ?? (pc ? Number(pc.now) : null);
    const plan = n(s?.week?.planned, s?.week?.goal, s?.planned, s?.plan) ?? null;
    const gained = n(s?.followers?.gained, s?.week?.followersGained, s?.followersGained, s?.gained) ?? null;
    const was = n(s?.followers?.lastWeek, s?.lastWeekGained) ?? null;
    const total = n(s?.followers?.total, typeof s?.followers === 'number' ? s.followers : null) ?? null;
    return { posted, plan, gained, was, total, wasPosted: pc ? Number(pc.was) : null, live: !!s || !!pc };
  }
  const posted = n(s?.week?.posted, s?.posted, s?.reels, s?.week?.reels, CONTENT?.stats?.week) ?? 4;
  const plan = n(s?.week?.planned, s?.week?.goal, s?.planned, s?.plan, CONTENT?.stats?.weekGoal) ?? 7;
  const gained = n(s?.followers?.gained, s?.week?.followersGained, s?.followersGained, s?.gained) ?? 86;
  const was = n(s?.followers?.lastWeek, s?.lastWeekGained) ?? 54;
  const total = n(s?.followers?.total, s?.followers, CONTENT?.stats?.followers) ?? 2310;
  return { posted, plan, gained, was, total, wasPosted: 3, live: !!s };
}
export { contentWeek };
export function openReviewFlow() {
  if (REAL && !REVIEW.key) { toast('The review needs your PC once to gather the week. Try again when it\'s back'); return; }
  const rv = { i: 0, p: REVIEW.feel.p, e: REVIEW.feel.e, wins: REVIEW.wins.map((w) => ({ ...w })), misses: REVIEW.misses.map((m) => ({ ...m })), rule: G.rule ?? REVIEW.rules[0]?.id ?? 'own', own: REVIEW.doc?.own ?? '', moves: REVIEW.moves.map((m) => ({ ...m })), diff: REVIEW.doc?.diff ?? '', sealed: G.reviewed, all: false };
  push({
    title: `Week ${REVIEW.week ?? ''} review`, back: backLabel(), aspect: 'growth', cls: 'gro-rv',
    right: `<button class="gbtn chrome icon" data-act="gro-ask" data-q="Help me with this week's review" aria-label="Ask ${esc(AGENT.name)}">${I.sparkle}</button>`,
    render(sc, page) {
      page._rv = rv;
      sc.innerHTML = `<div class="gro-rv-prog pad" aria-hidden="true"></div><div class="gro-rv-step" aria-live="polite"></div>`;
      page.insertAdjacentHTML('beforeend', `<div class="gro-rv-foot chrome"><button class="btn" data-act="gro-rv-back">Back</button><button class="btn primary" style="--c:var(--as-fill)" data-act="gro-rv-next">Next</button></div>`);
      drawStep(page, 0);
    },
  });
}
function drawStep(page, dir) {
  const rv = page._rv, sc = $('.scroll', page);
  const prog = $('.gro-rv-prog', page), host = $('.gro-rv-step', page), foot = $('.gro-rv-foot', page);
  if (rv.sealed) {
    prog.innerHTML = ''; foot.hidden = true;
    host.innerHTML = sealedHtml(rv);
    host.className = 'gro-rv-step gro-rise';
    const r = $('#groSealRing', host); if (r) { r.style.setProperty('--rp', '0'); r.dataset.v = '0.0000'; requestAnimationFrame(() => requestAnimationFrame(() => setRing(r, 1))); }
    pulse(host);
    return;
  }
  foot.hidden = false;
  const [id, label] = STEPS[rv.i];
  prog.innerHTML = `<div class="gro-rv-bars">${STEPS.map((_, k) => `<i class="${k < rv.i ? 'done' : k === rv.i ? 'on' : ''}"></i>`).join('')}</div><p class="gro-rv-pl"><span>Week ${REVIEW.week} · ${esc(REVIEW.label)}</span><span>Step ${rv.i + 1} of ${STEPS.length}</span></p>`;
  host.innerHTML = STEP_HTML[id](rv);
  host.className = `gro-rv-step ${dir > 0 ? 'gro-in-r' : dir < 0 ? 'gro-in-l' : ''}`;
  $('[data-act="gro-rv-back"]', foot).disabled = rv.i === 0;
  $('[data-act="gro-rv-next"]', foot).textContent = rv.i === STEPS.length - 1 ? 'Seal the week' : 'Next';
  sc.scrollTop = 0;
  if (id === 'feel') wirePad(host, (p, e) => { rv.p = p; rv.e = e; });
  if (id === 'numbers') pulse(host);
  wireSegs(host);
}
const reviewNumbers = () => {
  const c = contentWeek();
  if (REAL) {
    const pts = WEEK.points.filter((p) => p.aspect !== 'content').slice(0, 6);
    if (c.live && c.posted != null) pts.splice(Math.min(4, pts.length), 0, { aspect: 'content', label: 'Posts published', now: c.plan ? `${c.posted} of ${c.plan}` : String(c.posted), was: c.wasPosted != null ? String(c.wasPosted) : '–', dir: c.wasPosted != null ? Math.sign(c.posted - c.wasPosted) : 0, good: c.wasPosted != null && c.posted !== c.wasPosted ? c.posted > c.wasPosted : null, note: c.gained != null ? `+${c.gained} followers${c.total != null ? `, ${c.total.toLocaleString('en-IN')} now` : ''}` : 'From the Content tab', content: true });
    return pts;
  }
  const pick = ['Workouts', 'Sleep, a night', 'Reading', 'Tasks done', 'Spent', 'Journal'];
  const pts = WEEK.points.filter((p) => pick.includes(p.label));
  pts.splice(4, 0, { aspect: 'content', label: 'Reels posted', now: `${c.posted} of ${c.plan}`, was: '3 of 7', dir: 1, good: c.posted >= 4, note: `+${c.gained} followers, ${c.total.toLocaleString('en-IN')} now`, content: true });
  return pts;
};
// this week's check-ins and entry moods, Monday to today, for the review's first step
function weekMoods() {
  if (!REAL) return [['Mon', [4, 4]], ['Tue', [4, 2]], ['Wed', [3, 2]], ['Thu', [3, 2]]].map(([d, m]) => ({ d, p: m[0], e: m[1] }));
  const mon = mondayOf(TODAY), out = [];
  const cks = COL.checkins.list();
  for (let i = 0; i < 7; i++) {
    const dt = addDays(mon, i); if (dt > TODAY) break;
    const k = iso(dt), dd = day(k);
    const c = cks.filter((x) => x.date === k);
    const p = c.length ? Math.round(c.reduce((a, x) => a + x.p, 0) / c.length) : dd.written && !dd.nomood ? dd.p : null;
    const e = c.length ? Math.round(c.reduce((a, x) => a + x.e, 0) / c.length) : dd.written && !dd.nomood ? dd.e : null;
    out.push({ d: dow(dt), p, e });
  }
  return out;
}
const STEP_HTML = {
  feel: (rv) => `<h2 class="gro-rv-q">How did the week feel?</h2>
    <p class="gro-rv-n">${by()}<span>${esc(REVIEW.feel.line || 'Drag to how the week felt overall. Your check-ins are below.')}</span></p>
    <div class="gro-rv-card surface">${moodPad(rv.p, rv.e)}</div>
    <p class="gro-rv-sub">Your check-ins</p>
    <div class="gro-rv-ci">${(() => { const ms = weekMoods(); const left = 7 - ms.length; return ms.map((m) => `<span>${moodDot(m.p, m.e)}<b>${m.d}</b><small>${m.p ? esc(moodWord(m.p, m.e)) : 'No check-in'}</small></span>`).join('') + (left > 0 ? `<span class="fut"><i></i><b>${dow(addDays(TODAY, 1))}</b><small>to come</small></span>` : ''); })()}</div>`,
  numbers: (rv) => {
    const pts = reviewNumbers();
    const rows = rv.all ? (REAL ? WEEK.points : WEEK.points.concat(pts.filter((p) => p.content))) : pts;
    return `<h2 class="gro-rv-q">The week in numbers</h2>
    <p class="gro-rv-n">${by()}<span>${esc(REVIEW.headline)}</span></p>
    <div class="gro-rv-score surface">
      ${ring((WEEK.score ?? 0) / 100, 'as', 96, 10, { k: (WEEK.last ?? 0) / 100, inner: `<span class="gro-wh-in"><b class="met" data-count="${WEEK.score ?? 0}">${WEEK.score ?? '–'}</b><small>this week</small></span>`, label: `Week score ${WEEK.score ?? 'not yet'}, last week ${WEEK.last ?? 'none'}` })}
      <div><p class="gro-rv-sc-d"><b class="met">${WEEK.score != null && WEEK.last != null ? signed(WEEK.score - WEEK.last).replace('.0', '') : '–'}</b> on last week</p><p class="gro-rv-sc-l">The tick on the ring is last week. Growth this week: <b>${signed(RATE.at(-1) ?? 0)}</b> a week over four weeks.</p></div>
    </div>
    <div class="group gro-rv-pts">${rows.map((p) => `<div class="row gro-pt">${aspectTileOr(p.aspect)}<span class="rbody"><span class="rtitle">${esc(p.label)}</span><span class="rmeta"><span class="ell">${esc(p.note)}</span></span></span><span class="gro-pt-v"><b class="met">${esc(p.now)}</b><small>was ${esc(p.was)}</small></span><span class="gro-pt-d${p.good === true ? ' good' : p.good === false ? ' bad' : ''}">${p.dir > 0 ? I.up : p.dir < 0 ? `<span class="gro-dn">${I.up}</span>` : '<i class="gro-eq"></i>'}</span></div>`).join('')}
      ${rv.all || WEEK.points.length <= rows.length ? '' : `<button class="row gro-more" data-act="gro-rv-all"><span class="rbody"><span class="rtitle">All ${WEEK.points.length} data points</span></span>${I.chevD}</button>`}</div>
    <p class="hint">Content comes from the Content tab: <button class="gro-link" data-act="gro-open" data-to="content:stats">open its stats</button>.</p>`;
  },
  wins: (rv) => `<h2 class="gro-rv-q">What went well?</h2>
    <p class="gro-rv-n">${by()}<span>${rv.wins.length ? `I found ${rv.wins.length} from your apps. Keep the ones that feel true and add your own.` : 'Nothing in the numbers moved up yet. Add the wins only you know about.'}</span></p>
    <div class="group gro-rv-list">${rv.wins.map((w, k) => `<button class="row gro-rv-w${w.on ? ' on' : ''}" data-act="gro-rv-win" data-k="${k}" aria-pressed="${w.on}"><span class="check${w.on ? ' done' : ''}" aria-hidden="true"><svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg></span><span class="rbody"><span class="rtitle wrap">${esc(w.text)}</span><span class="rmeta"><i class="dot" style="--c:var(--${w.aspect})"></i><span>${esc(aspect(w.aspect)?.name ?? '')}</span>${w.mine ? '<span>· yours</span>' : ''}</span></span></button>`).join('')}</div>
    <div class="pad gro-rv-add"><label class="field"><input id="groWinIn" placeholder="Add a win of your own" enterkeyhint="done" /></label><button class="btn sm" data-act="gro-rv-addwin">Add</button></div>`,
  misses: (rv) => `<h2 class="gro-rv-q">What went wrong?</h2>
    <p class="gro-rv-n">${by()}<span>${rv.misses.length ? 'Pick the honest reason for each. I plan next week around it.' : 'Nothing slipped in the numbers. Write what you would do differently anyway.'}</span></p>
    ${rv.misses.map((m, k) => `<section class="gro-rv-miss surface">
      <div class="gro-rv-mh">${aspectTile(m.aspect)}<span><b>${esc(m.text)}</b><small>${esc(m.detail)}</small></span></div>
      <div class="gro-rv-why" role="radiogroup" aria-label="Why">${(m.whys ?? REVIEW.whys).map((w) => `<button class="chip sm${m.why === w ? ' on' : ''}" role="radio" data-act="gro-rv-why" data-k="${k}" data-w="${esc(w)}" aria-checked="${m.why === w}">${esc(w)}</button>`).join('')}</div>
    </section>`).join('')}
    <p class="gro-rv-sub">One thing you'd do differently</p>
    <div class="pad"><label class="field gro-rv-ta"><textarea id="groDiff" rows="2" placeholder="Send the invoice before the call, not after">${esc(rv.diff)}</textarea></label></div>`,
  rule: (rv) => `<h2 class="gro-rv-q">One lesson, one rule</h2>
    <p class="gro-rv-n">${by()}<span>Next week I plan around the rule you pick.${WEEK.rule?.text ? ` Last week's was "${esc(WEEK.rule.text)}"${WEEK.rule.kept != null ? `, held ${WEEK.rule.kept} of ${WEEK.rule.of} days` : ''}.` : ''}</span></p>
    <div class="gro-rv-rules" role="radiogroup" aria-label="This week's rule">${REVIEW.rules.map((r) => `<button class="gro-rv-r surface${rv.rule === r.id ? ' on' : ''}" role="radio" aria-checked="${rv.rule === r.id}" data-act="gro-rv-rule" data-id="${r.id}"><span class="gro-rv-rr" aria-hidden="true"></span><span><b>${esc(r.text)}</b><small>${esc(r.why)}</small></span></button>`).join('')}
      <div class="gro-rv-r surface own${rv.rule === 'own' ? ' on' : ''}"><span class="gro-rv-rr" aria-hidden="true"></span><label class="gro-rv-own"><b>Or write your own</b><input id="groOwnRule" placeholder="A rule in your words" value="${esc(rv.own)}" /></label></div>
    </div>`,
  plan: (rv) => `<h2 class="gro-rv-q">Next week, three moves</h2>
    <p class="gro-rv-n">${by()}<span>Each move becomes a goal for ${esc(REVIEW.next)}, with its tasks and calendar blocks. Switch off any you don't want.</span></p>
    <div class="group gro-rv-mv">${rv.moves.map((m, k) => `<div class="row gro-rv-m"><span class="gro-rv-mn met">${k + 1}</span><span class="rbody"><span class="rtitle wrap">${esc(m.text)}</span><span class="gro-rv-ml">${esc(m.lands)}</span><button class="gro-link" data-act="gro-rv-goal" data-k="${k}">Edit as a goal</button></span><button class="switch${m.on ? ' on' : ''}" data-act="gro-rv-move" data-k="${k}" role="switch" aria-checked="${m.on}" aria-label="Keep: ${esc(m.text)}"></button></div>`).join('')}</div>
    <div class="gro-rv-sum surface"><p><b>When you seal the week</b></p><ul><li>${rv.moves.filter((m) => m.on).length} goals land in Mission for next week</li><li>${REAL ? 'A late task named in a move gets next Tuesday as its date' : 'Their tasks go on Today, with blocks on the calendar'}</li><li>The rule "${esc(ruleText(rv))}" goes on next week's plan</li><li>Next Sunday's review starts from here</li></ul></div>`,
};
const ruleText = (rv) => (rv.rule === 'own' ? rv.own || 'your own rule' : REVIEW.rules.find((r) => r.id === rv.rule)?.text ?? rv.own ?? '');
const aspectTileOr = (id) => (aspect(id) ? aspectTile(id) : `<span class="tile gro-ct-tile" aria-hidden="true">${I.content}</span>`);
function sealedHtml(rv) {
  const n = rv.moves.filter((m) => m.on).length;
  return `<div class="gro-seal">
    ${ring(1, 'as', 148, 14, { id: 'groSealRing', inner: `<span class="gro-seal-in">${I.check}<b>Sealed</b></span>`, label: 'Week sealed' })}
    <h2 class="gro-seal-t">Week ${REVIEW.week ?? ''} is sealed</h2>
    <p class="gro-seal-s">${REAL ? `${Math.max(1, REVIEW.streak)} ${Math.max(1, REVIEW.streak) === 1 ? 'Sunday' : 'Sundays in a row'}. Next week's plan is ready.` : `${REVIEW.streak + 1} Sundays in a row. Next week's plan is ready.`}</p>
    <div class="gro-seal-g surface">
      <span><b class="met">${n}</b><small>${n === 1 ? 'goal' : 'goals'} in Mission</small></span>
      <span><b class="met">${REAL ? (rv.moved ?? 0) : n + 2}</b><small>${REAL ? 'tasks moved' : 'tasks on Today'}</small></span>
      <span><b class="met">1</b><small>rule for the week</small></span>
    </div>
    <div class="group gro-seal-l">${rv.moves.filter((m) => m.on).map((m, k) => `<div class="row gro-rv-m"><span class="gro-rv-mn met">${k + 1}</span><span class="rbody"><span class="rtitle wrap">${esc(m.text)}</span><span class="gro-rv-ml">${esc(m.lands)}</span></span></div>`).join('')}
      <div class="row"><span class="tile">${I.flag}</span><span class="rbody"><span class="rtitle wrap">Rule: ${esc(ruleText(rv))}</span></span></div></div>
    <div class="pad gro-seal-a"><button class="btn primary block" style="--c:var(--as-fill)" data-act="gro-plan" data-k="week">See next week's plan</button><button class="btn block" data-act="pop">Done</button></div>
  </div>`;
}
const RV = (el) => el.closest('.page')?._rv;
on('gro-rv-next', (el) => {
  const page = el.closest('.page'), rv = page._rv; if (!rv) return;
  syncFields(page, rv);
  if (rv.i < STEPS.length - 1) { rv.i++; haptic(5); drawStep(page, 1); return; }
  if (REAL) sealReview(rv);
  rv.sealed = true; G.reviewed = true; G.rule = rv.rule; haptic(16);
  drawStep(page, 1);
  hooks.onReviewed();
  if (has('agentSay')) setTimeout(() => api.agentSay(`Week ${REVIEW.week ?? ''} sealed. ${rv.moves.filter((m) => m.on).length} goals for next week are in Mission.`, { aspect: 'growth', kind: 'did' }), 1600);
});
// sealing, for real: each kept move becomes a week goal for next week, a late task it names moves to next Tuesday,
// and the review is stored sealed (the PC scores next week against it)
function sealReview(rv) {
  const mon = addDays(mondayOf(TODAY), 7), tue = iso(addDays(mon, 1));
  let moved = 0;
  const moves = rv.moves.map((m) => {
    if (!m.on) return { ...m };
    let goalId = null;
    try { goalId = addGoal({ title: m.text, horizon: 'week', aspects: m.aspect ? [m.aspect] : null, start: iso(mon) })?.id ?? null; } catch (e) { console.warn('[growth] goal', e); }
    if (m.task && taskOf(m.task)) { try { updateTask(m.task, { due: tue }); moved++; } catch {} }
    return { ...m, goalId, goalTitle: m.text };
  });
  rv.moved = moved;
  putReview({ ...(REVIEW.doc ?? {}), id: REVIEW.key, week: REVIEW.key, label: REVIEW.label, status: 'sealed', sealed_at: new Date().toISOString(), score: WEEK.score, last: WEEK.last,
    feel: { ...(REVIEW.feel ?? {}), p: rv.p, e: rv.e }, wins: rv.wins, misses: rv.misses, rule: rv.rule, own: rv.own, ruleText: ruleText(rv), diff: rv.diff, moves, headline: REVIEW.headline });
  const wk = `week-${REVIEW.key.slice(0, 5)}W${String(Number(REVIEW.key.slice(6)) + 1).padStart(2, '0')}`;
  putPlan({ ...(COL.plans.get(wk) ?? {}), id: wk, rule: ruleText(rv), moves: moves.filter((m) => m.on !== false).map((m) => ({ text: m.text, aspect: m.aspect, goalId: m.goalId })), from: REVIEW.key });
}
on('gro-rv-back', (el) => { const page = el.closest('.page'), rv = page._rv; if (!rv || rv.i === 0) return; syncFields(page, rv); rv.i--; haptic(4); drawStep(page, -1); });
function syncFields(page, rv) {
  const d = $('#groDiff', page); if (d) rv.diff = d.value;
  const o = $('#groOwnRule', page); if (o) { rv.own = o.value; if (o.value.trim() && rv.rule === 'own') rv.own = o.value.trim(); }
}
on('gro-rv-all', (el) => { const page = el.closest('.page'); page._rv.all = true; drawStep(page, 0); });
on('gro-rv-win', (el) => { const rv = RV(el); const w = rv.wins[+el.dataset.k]; w.on = !w.on; haptic(5); el.classList.toggle('on', w.on); el.setAttribute('aria-pressed', String(w.on)); $('.check', el).classList.toggle('done', w.on); });
on('gro-rv-addwin', (el) => {
  const page = el.closest('.page'), rv = page._rv, inp = $('#groWinIn', page);
  const t = inp?.value.trim(); if (!t) { inp?.focus(); return; }
  rv.wins.push({ text: t, aspect: 'growth', on: true, mine: true }); haptic(8); drawStep(page, 0);
});
on('gro-rv-why', (el) => {
  const rv = RV(el); const m = rv.misses[+el.dataset.k]; m.why = el.dataset.w; haptic(4);
  $$(`[data-act="gro-rv-why"][data-k="${el.dataset.k}"]`, el.closest('.gro-rv-miss')).forEach((c) => { const on = c.dataset.w === m.why; c.classList.toggle('on', on); c.setAttribute('aria-checked', String(on)); });
});
on('gro-rv-rule', (el) => {
  const rv = RV(el); rv.rule = el.dataset.id; haptic(5);
  $$('.gro-rv-r', el.closest('.gro-rv-rules')).forEach((r) => { const on = r.dataset.id === rv.rule; r.classList.toggle('on', on); r.setAttribute('aria-checked', String(on)); });
});
document.addEventListener('focusin', (e) => {
  if (e.target.id !== 'groOwnRule') return;
  const page = e.target.closest('.page'); const rv = page?._rv; if (!rv) return;
  rv.rule = 'own';
  $$('.gro-rv-r', page).forEach((r) => { const on = r.classList.contains('own'); r.classList.toggle('on', on); if (r.hasAttribute('role')) r.setAttribute('aria-checked', 'false'); });
});
on('gro-rv-move', (el) => {
  const page = el.closest('.page'), rv = page._rv; const m = rv.moves[+el.dataset.k]; m.on = !m.on; haptic(6);
  el.classList.toggle('on', m.on); el.setAttribute('aria-checked', String(m.on));
  const sum = $('.gro-rv-sum li', page); if (sum) sum.textContent = `${rv.moves.filter((x) => x.on).length} goals land in Mission for next week`;
});
on('gro-rv-goal', (el) => {
  const rv = RV(el); const m = rv.moves[+el.dataset.k];
  if (has('addGoal')) api.addGoal({ title: m.text, horizon: 'week', aspect: m.aspect, aspects: m.aspect ? [m.aspect] : undefined, parent: REAL ? undefined : m.goal });
  else toast('Mission opens it as a goal for next week');
});

export function openPastReview(w) {
  const r = PAST_REVIEWS.find((x) => x.week === w); if (!r) return toast(`No review for week ${w}`);
  push({
    title: `Week ${w}`, back: backLabel(), aspect: 'growth', cls: 'gro-pv',
    render(sc) {
      const e = ENTRIES.find((x) => x.review === w);
      sc.innerHTML = `
        <div class="phead"><p class="kicker c-as">Sunday review · sealed</p><h1 class="lt">Week ${w}</h1><p class="sub">${esc(r.label)}</p></div>
        <section class="gro-wh surface sm">
          ${ring((r.score ?? 0) / 100, 'as', 92, 10, { inner: `<span class="gro-wh-in"><b class="met" data-count="${r.score ?? 0}">${r.score ?? '–'}</b><small>of 100</small></span>`, label: `Scored ${r.score ?? 'no score'}` })}
          <div class="gro-wh-side"><p class="gro-wh-d"><b class="met">${signed(r.delta).replace('.0', '')}</b> on the week before</p><p class="gro-wh-l">${esc(r.line)}</p></div>
        </section>
        <div class="sh"><h2>The rule</h2></div>
        <div class="group"><div class="row ic"><span class="tile">${I.flag}</span><span class="rbody"><span class="rtitle wrap">${esc(r.rule || 'No rule set')}</span>${r.kept ? `<span class="rmeta">Kept ${esc(r.kept)}</span>` : ''}</span></div></div>
        ${REAL && r.moves?.length ? `<div class="sh"><h2>Its moves</h2></div><div class="group">${r.moves.map((m, k) => `<div class="row"><span class="gro-rv-mn met">${k + 1}</span><span class="rbody"><span class="rtitle wrap">${esc(m)}</span></span></div>`).join('')}</div>` : ''}
        ${!REAL && w === 42 ? `<div class="sh"><h2>Its three moves</h2></div><div class="group">${WEEK.moves.map((m, k) => `<div class="row"><span class="gro-rv-mn met">${k + 1}</span><span class="rbody"><span class="rtitle">${esc(m.text)}</span><span class="rmeta">${m.done} of ${m.of} this week · ${esc(m.note)}</span></span></div>`).join('')}</div>` : ''}
        ${e ? `<div class="sh"><h2>What you wrote that night</h2></div><div class="group"><button class="row" data-act="gro-entry" data-date="${e.date}"><span class="rbody"><span class="rtitle">${esc(e.title)}</span><span class="rmeta"><span class="ell">${esc(e.text.slice(0, 90))}</span></span></span>${I.chevR}</button></div>` : ''}`;
    },
  });
}
export function openPastDream(k) {
  const d = PAST_DREAMS.find((x) => x.date === k); if (!d) return toast('No dream that night');
  const dt = fromIso(d.date);
  if (REAL && d.dream) return openRealPastDream(d);
  push({
    title: fmtDay(dt), back: backLabel(), aspect: 'growth', cls: 'gro-pv',
    render(sc) {
      sc.innerHTML = `
        <div class="phead"><p class="kicker c-as">The night before ${fmtDay(dt)}</p><h1 class="t1 gro-pd-t">${esc(d.line)}</h1><p class="sub">${d.found} ${d.found === 1 ? 'thing' : 'things'} found · ${d.approved} approved${d.declined ? ` · ${d.declined} declined` : ''}</p></div>
        <div class="group">${Array.from({ length: d.found }, (_, i) => `<div class="row ic">${aspectTile(['money', 'mission', 'growth', 'body'][i % 4])}<span class="rbody"><span class="rtitle wrap">${i === 0 ? esc(d.line) : i === 1 ? 'A proposal for the next day' : 'A gap she flagged'}</span><span class="rmeta">${i < d.approved ? 'You said yes' : i < d.approved + d.declined ? 'You said no' : 'Noted'}</span></span></div>`).join('')}</div>
        <p class="hint">Older nights keep their findings and your answers, so she learns what you say yes to.</p>`;
    },
  });
}

function openRealPastDream(d) {
  const dr = d.dream, dt = fromIso(d.date);
  const ans = (pid) => dr.proposals.find((p) => p.id === pid);
  push({
    title: fmtDay(dt), back: backLabel(), aspect: 'growth', cls: 'gro-pv',
    render(sc) {
      sc.innerHTML = `
        <div class="phead"><p class="kicker c-as">The night before ${fmtDay(dt)}</p><h1 class="t1 gro-pd-t">${esc(d.line)}</h1><p class="sub">${d.found} ${d.found === 1 ? 'thing' : 'things'} found · ${d.approved} approved${d.declined ? ` · ${d.declined} declined` : ''}</p></div>
        <div class="group">${dr.connections.map((c) => { const p = c.proposal ? ans(c.proposal) : null; return `<div class="row ic">${aspectTile(c.aspects[0] ?? 'growth')}<span class="rbody"><span class="rtitle wrap">${esc(c.title)}</span><span class="gro-gap-x">${esc(c.text)}</span>${p ? `<span class="rmeta">${esc(p.kind)}: ${esc(p.title)} · ${p.answer === 'yes' ? 'You said yes' : p.answer === 'no' ? 'You said no' : 'Not answered'}</span>` : ''}</span></div>`; }).join('')}
          ${dr.gaps.map((g) => `<div class="row ic">${aspectTile(g.aspect ?? 'growth')}<span class="rbody"><span class="rtitle wrap">${esc(g.title)}</span><span class="gro-gap-x">${esc(g.text)}</span></span></div>`).join('')}</div>
        <p class="hint">Older nights keep their findings and your answers, so she learns what you say yes to.</p>`;
    },
  });
}

// ═══ PLANNING RITUALS ═══════════════════════════════════════════════════
export function openPlanPage(kind = 'day') {
  if (kind === 'week') return openWeekPlan();
  const st = { v: kind === 'evening' ? 'evening' : 'morning', three: PLAN.day.three.map((t) => ({ ...t })), ev: [true, false, G.saved, false, false] };
  push({
    title: 'Plan the day', back: backLabel(), aspect: 'growth', cls: 'gro-pl',
    render(sc, page) {
      page._pl = st;
      sc.innerHTML = `<div class="phead"><p class="kicker c-as">Plan the day</p><h1 class="lt">${dowLong(TODAY)}</h1><p class="sub" id="groPlSub"></p></div>
        <div class="pad gro-pl-seg">${seg('gro-plv', [['morning', 'Morning'], ['evening', 'Evening']], st.v)}</div>
        <div id="groPlBody"></div>`;
      const draw = () => { if (REAL) st.three = PLAN.day.three.map((t) => ({ ...t })); $('#groPlSub', page).innerHTML = st.v === 'morning' ? (PLAN.day.done ? `Planned at <b class="num">${PLAN.day.done}</b>${PLAN.day.slept ? ` · slept ${PLAN.day.slept}` : ''}` : `Not planned yet${PLAN.day.slept ? ` · slept ${PLAN.day.slept}` : ''}`) : `Shutdown at <b class="num">${PLAN.day.evening.at}</b> · five steps, about six minutes`; $('#groPlBody', page).innerHTML = st.v === 'morning' ? morningHtml(st) : eveningHtml(st); pulse($('#groPlBody', page)); };
      page.addEventListener('change', (e) => { if (e.target.closest('[data-seg="gro-plv"]')) { st.v = e.detail; draw(); } });
      page._plDraw = draw;
      draw();
    },
  });
}
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
function morningHtml(st) {
  const done = st.three.filter((t) => t.done).length;
  const evs = EVENTS.filter((e) => !e.sleep && !e.allDay);
  const nm = nowMin();
  if (REAL && !st.three.length) return `<div class="note gro-empty">Nothing is on today's list yet. Add your three on Today, then lock the plan here.</div>
    <div class="pad gro-pl-a"><button class="btn block" data-act="gro-open" data-to="calendar:day">${I.cal}Open today</button></div>`;
  return `<section class="gro-pl-e surface"><span class="tile">${I.bolt}</span><p><b>Energy:</b> ${esc(PLAN.day.energy)}.</p></section>
    <div class="sh"><h2>Your three</h2><span class="sh-count">${done} of ${st.three.length}</span></div>
    <div class="group">${st.three.map((t, k) => `<div class="row gro-pl-t${t.done ? ' is-done' : ''}"><button class="check${t.done ? ' done' : ''}" data-act="gro-pl-check" data-k="${k}" aria-label="${t.done ? 'Mark not done' : 'Mark done'}: ${esc(t.text)}"><svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg></button><span class="rbody"><span class="rtitle wrap">${esc(t.text)}</span><span class="rmeta">${t.done ? `<span class="num">Done ${t.at}</span>` : `<span class="late">${esc(t.late)}</span>`}</span></span>${!t.done ? `<button class="btn sm" data-act="gro-open" data-to="task:${t.id}">Open</button>` : ''}</div>`).join('')}</div>
    <div class="sh"><h2>Intention</h2></div>
    ${REAL ? `<div class="pad"><label class="field gro-rv-ta"><input id="groIntent" placeholder="One line for today, like: close one loop before starting another" value="${esc(PLAN.day.intention)}" enterkeyhint="done" /></label></div>` : `<blockquote class="gro-pl-q surface">${esc(PLAN.day.intention)}</blockquote>`}
    <div class="sh"><h2>The day</h2><button class="sh-act" data-act="gro-open" data-to="calendar:day">Open the day${I.chevR}</button></div>
    <div class="group gro-pl-day">${evs.length ? evs.map((e) => `<div class="row gro-pl-ev${e.end <= nm ? ' past' : e.start <= nm ? ' now' : ''}"><span class="gro-pl-tm num">${hhmm(Math.max(0, Math.round(e.start)))}</span><i class="dot" style="--c:var(--${e.aspect ?? 'growth'})"></i><span class="rbody"><span class="rtitle">${esc(e.title)}</span></span>${e.start <= nm && e.end > nm ? '<span class="pill" style="--c:var(--as-ink)">Now</span>' : ''}</div>`).join('') : '<div class="row"><span class="rbody"><span class="rtitle">Nothing on the calendar today</span></span></div>'}</div>
    ${REAL ? `<div class="pad gro-pl-a"><button class="btn primary block" style="--c:var(--as-fill)" data-act="gro-pl-lock">${I.check}${PLAN.day.done ? 'Update the plan' : 'Lock in the plan'}</button><button class="btn block" data-act="gro-ask" data-q="Re-plan the rest of my day">${I.sparkle}Re-plan the rest of the day</button></div>`
    : `<p class="gro-pl-n">${by()}<span>I'm guarding 16:30 to 18:30 and I'll nudge you at 18:40 for the shoot.</span></p>
    <div class="pad gro-pl-a"><button class="btn block" data-act="gro-ask" data-q="Re-plan the rest of my day">${I.sparkle}Re-plan the rest of the day</button></div>`}`;
}
function eveningHtml(st) {
  const open = st.three.filter((t) => !t.done);
  const tmr = addDays(TODAY, 1);
  const closed = REAL ? TASKS.filter((t) => t.doneToday) : null;
  const steps = REAL ? [
    ['See what got done', closed.length ? `${closed.length} ${closed.length === 1 ? 'task' : 'tasks'} closed today: ${closed.slice(0, 2).map((t) => esc(t.title)).join(', ')}${closed.length > 2 ? '…' : ''}` : 'Nothing closed today yet', null],
    ['Move what didn\'t', open.length ? `${open.map((t) => esc(t.text)).join(', ')}` : 'Nothing left over', open.length ? `<button class="btn sm" data-act="gro-pl-move">Move to ${fmtDay(tmr)}</button>` : null],
    ['Write tonight\'s entry', G.saved ? 'Saved. The streak is safe' : STREAK.n ? `Your streak is ${STREAK.n} ${STREAK.n === 1 ? 'day' : 'days'}` : 'Two lines start a streak', G.saved ? null : `<button class="btn sm tint" style="--c:var(--as-ink)" data-act="gro-write">Write</button>`],
    ['Set tomorrow\'s first move', PLAN.day.tomorrow ? `${PLAN.day.tomorrow.at} · ${esc(PLAN.day.tomorrow.text)}` : 'Nothing set for tomorrow yet', PLAN.day.tomorrow ? null : `<button class="btn sm" data-act="gro-open" data-to="calendar:day">Open Today</button>`],
    ['Phone down by 23:00', 'Charge it outside the room tonight', null],
  ] : [
    ['See what got done', `${TASKS.filter((t) => t.list === 'done').length + st.three.filter((t) => t.done && !['t19', 't20'].includes(t.id)).length} tasks closed today, gym and the algebra sheet among them`, null],
    ['Move what didn\'t', open.length ? `${open.map((t) => esc(t.text)).join(', ')}` : 'Nothing left over', open.length ? `<button class="btn sm" data-act="gro-pl-move">Move to Fri 10:30</button>` : null],
    ['Write tonight\'s entry', G.saved ? 'Saved. The streak is safe' : `Your streak is ${STREAK.n} days`, G.saved ? null : `<button class="btn sm tint" style="--c:var(--as-ink)" data-act="gro-write">Write</button>`],
    ['Set tomorrow\'s first move', `${PLAN.day.tomorrow.at} · ${esc(PLAN.day.tomorrow.text)}`, null],
    ['Phone down by 23:00', G.answered.r1 === 'yes' ? 'Reels lock at 00:15 tonight, as you agreed' : 'Say yes to last night\'s rule and I lock reels at 00:15', G.answered.r1 === 'yes' ? null : `<button class="btn sm" data-act="gro-go" data-s="dream">See the rule</button>`],
  ];
  return `<div class="group gro-pl-steps">${steps.map(([t, m, act], k) => `<div class="row gro-pl-s${st.ev[k] ? ' is-done' : ''}"><button class="check${st.ev[k] ? ' done' : ''}" data-act="gro-pl-step" data-k="${k}" aria-label="${esc(t)}"><svg viewBox="0 0 12 12"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg></button><span class="rbody"><span class="rtitle">${k + 1}. ${t}</span><span class="gro-pl-sm">${m}</span>${act ? `<span class="gro-pl-act">${act}</span>` : ''}</span></div>`).join('')}</div>
    <p class="gro-pl-n">${by()}<span>At 22:00 the alarm opens tonight's entry if it's still missing${SETTINGS.call ? `, and at 22:30 ${esc(AGENT.name)} can call` : ''}.</span></p>`;
}
on('gro-pl-check', (el) => { const page = el.closest('.page'), st = page._pl; const t = st.three[+el.dataset.k]; t.done = !t.done; t.at = t.done ? nowt() : t.at; haptic(8); if (REAL) { try { completeTask(t.id, t.done); } catch (e) { toast('That task changed on your PC; reopen the plan'); } } if (t.done) { el.classList.add('closing'); setTimeout(() => page._plDraw(), 420); } else page._plDraw(); });
on('gro-pl-lock', (el) => {
  const page = el.closest('.page'), st = page._pl; if (!st) return;
  const intention = $('#groIntent', page)?.value.trim() ?? PLAN.day.intention;
  const id = `day-${iso(TODAY)}`;
  putPlan({ ...(COL.plans.get(id) ?? {}), id, three: st.three.map((t) => t.id), intention, planned_at: new Date().toISOString() });
  haptic(12); toast('Today\'s plan is locked in');
  setTimeout(() => page._plDraw?.(), 60);
});
on('gro-pl-step', (el) => { const page = el.closest('.page'), st = page._pl; const k = +el.dataset.k; st.ev[k] = !st.ev[k]; haptic(6); page._plDraw(); });
on('gro-pl-move', (el) => {
  const page = el.closest('.page'), st = page._pl; st.ev[1] = true; haptic(8);
  if (REAL) {
    const tmr = iso(addDays(TODAY, 1));
    const open = st.three.filter((t) => !t.done && taskOf(t.id));
    const was = open.map((t) => [t.id, taskOf(t.id)?.due ?? null]);
    for (const t of open) { try { updateTask(t.id, { due: tmr, scheduled: null }); } catch {} }
    toast(`Moved ${open.length} to ${fmtDay(addDays(TODAY, 1))}`, () => { for (const [id, due] of was) { try { updateTask(id, { due }); } catch {} } st.ev[1] = false; page._plDraw(); });
    page._plDraw(); return;
  }
  toast('Moved to Fri 23, 10:30', () => { st.ev[1] = false; page._plDraw(); }); page._plDraw();
});
function openWeekPlan() {
  const moves = REVIEW.moves.filter((m) => m.on !== false);
  const max = Math.max(1, ...PLAN.week.load.map((x) => x[1]));
  const heavy = [...PLAN.week.load].sort((a, b) => b[1] - a[1])[0];
  const ruleNow = REAL ? (REVIEW.ruleText ?? REVIEW.rules.find((r) => r.id === G.rule)?.text ?? REVIEW.rules[0]?.text ?? null) : (REVIEW.rules.find((r) => r.id === (G.rule ?? 'u1'))?.text ?? 'Send first, talk after');
  push({
    title: 'Plan next week', back: backLabel(), aspect: 'growth', cls: 'gro-pl',
    render(sc) {
      sc.innerHTML = `<div class="phead"><p class="kicker c-as">Plan the week</p><h1 class="lt">${esc(PLAN.week.label)}</h1><p class="sub">${G.reviewed ? 'From Sunday\'s review. Sealed.' : `${esc(AGENT.name)}'s draft. Sunday's review settles it.`}</p></div>
        <div class="sh"><h2>${moves.length === 3 ? 'Three moves' : 'Moves'}</h2></div>
        <div class="group">${moves.length ? moves.map((m, k) => `<div class="row gro-rv-m"><span class="gro-rv-mn met">${k + 1}</span><span class="rbody"><span class="rtitle wrap">${esc(m.text)}</span><span class="gro-rv-ml">${esc(m.lands ?? '')}</span></span></div>`).join('') : '<div class="row"><span class="rbody"><span class="rtitle">The Sunday review sets them</span></span></div>'}</div>
        <div class="sh"><h2>Rule for the week</h2></div>
        <div class="group"><div class="row ic"><span class="tile">${I.flag}</span><span class="rbody"><span class="rtitle wrap">${esc(ruleNow ?? 'Picked in the Sunday review')}</span><span class="rmeta">${ruleNow ? 'Every planner works around it' : 'Six short steps on Sunday'}</span></span></div>
          ${(PLAN.week.rules ?? []).map((r) => `<div class="row ic"><span class="tile">${I.moon}</span><span class="rbody"><span class="rtitle wrap">${esc(r.text)}</span><span class="rmeta">${esc(r.kind ?? 'Rule')} from a dream${r.meta ? ` · ${esc(r.meta)}` : ''}</span></span></div>`).join('')}</div>
        <div class="sh"><h2>Hours planned</h2><span class="sh-count">${PLAN.week.load.reduce((a, x) => a + x[1], 0)}h</span></div>
        <section class="gro-load surface" role="img" aria-label="Hours planned by day: ${PLAN.week.load.map(([d, h]) => `${d} ${h}`).join(', ')}">
          ${PLAN.week.load.map(([d, h]) => `<span class="gro-load-c"><b class="num">${h}</b><span class="gro-load-t"><i style="--h:${((h / max) * 100).toFixed(1)}%"></i></span><small>${d}</small></span>`).join('')}
        </section>
        <p class="hint">${REAL ? (heavy && heavy[1] ? `${heavy[0]} is the heaviest so far, at ${heavy[1]} hours of blocks and tasks.` : 'Nothing is planned for next week yet. The review\'s moves land here as goals.') : `Monday is the heaviest: both invoices and the Atlas ERP merge. ${esc(AGENT.name)} keeps Saturday morning free for the gym with Kabir.`}</p>
        <div class="group gro-pl-links">
          <button class="row ic" data-act="gro-open" data-to="horizon:week"><span class="tile">${I.compass}</span><span class="rbody"><span class="rtitle">This week's goals in Mission</span><span class="rmeta">The horizons above them: ${fmtLong(TODAY).split(' ').at(-1)}, Q${Math.floor(TODAY.getMonth() / 3) + 1}, ${TODAY.getFullYear()}</span></span>${I.chevR}</button>
          <button class="row ic" data-act="gro-open" data-to="calendar:week"><span class="tile">${I.cal}</span><span class="rbody"><span class="rtitle">Next week on the calendar</span><span class="rmeta">Blocks for each move</span></span>${I.chevR}</button>
        </div>`;
    },
  });
}

// ═══ THE STREAK: how she keeps it, Duolingo-grade ═══════════════════════
export function openStreak() {
  const n = G.saved ? STREAK.n + 1 : STREAK.n;
  const sh = openSheet({
    title: 'Your streak', sub: G.saved ? 'Tonight\'s entry is in.' : `Save it by ${STREAK.saveBy} tonight.`, cls: 'gro-sks',
    body(b) {
      b.innerHTML = `<div class="gro-sk-h">
          ${ring(G.saved ? 1 : STREAK.n / 7, 'as', 112, 11, { inner: `<span class="gro-sb-in"><b class="met">${n}</b><small>days</small></span>`, label: `${n}-day streak` })}
          <div class="gro-sk-st"><span><b class="met">${STREAK.best}</b><small>${STREAK.bestFrom ? `longest, ${fmtShort(STREAK.bestFrom)} to ${fmtShort(STREAK.bestTo)}` : 'longest so far'}</small></span><span><b class="met">${REAL ? STREAK.freezes : STREAK.freezes + (G.saved ? 1 : 0)}</b><small>streak ${(REAL ? STREAK.freezes : STREAK.freezes + (G.saved ? 1 : 0)) === 1 ? 'freeze' : 'freezes'}</small></span><span><b class="met">${REAL ? entriesIn2026 : entriesIn2026 + (G.saved ? 1 : 0)}</b><small>entries in ${TODAY.getFullYear()}</small></span></div>
        </div>
        <div class="sh"><h2>Next milestones</h2></div>
        <div class="group">
          ${(() => { const next7 = Math.ceil((n + (G.saved ? 0 : 1)) / 7) * 7 || 7; const rec = STREAK.best + 1; return `<div class="row ic"><span class="tile">${I.shield}</span><span class="rbody"><span class="rtitle">${next7} days: a streak freeze</span><span class="rmeta">${next7 - n <= (G.saved ? 0 : 1) ? (G.saved ? 'Earned tonight' : 'Tonight') : `${next7 - n} more nights`}</span></span></div>
          <div class="row ic"><span class="tile">${I.star}</span><span class="rbody"><span class="rtitle">${rec} days: past your record</span><span class="rmeta">${STREAK.best ? `Your best is ${STREAK.best}${STREAK.bestFrom ? `, from ${fmtShort(STREAK.bestFrom)}` : ''}` : 'Your first streak sets it'}</span></span></div>`; })()}
        </div>
        <div class="sh"><h2>How ${esc(AGENT.name)} keeps it</h2></div>
        <div class="group gro-ladder">
          ${[['21:00', 'A nudge', 'A quiet notification with tonight\'s first prompt', SETTINGS.nudge, 'nudge'], ['22:00', 'The alarm', 'Full screen: two lines are enough', SETTINGS.alarm, 'alarm'], ['22:30', 'A call', `${esc(AGENT.name)} calls and you talk the entry instead`, SETTINGS.call, 'call'], ['23:30', 'Use a freeze', 'Only if you\'ve said so', SETTINGS.freeze, 'freeze']].map(([t, h, m, onv, key]) => `<div class="row gro-ld"><span class="gro-ld-t num">${t}</span><span class="rbody"><span class="rtitle">${h}</span><span class="rmeta"><span class="ell">${m}</span></span></span><button class="switch${onv ? ' on' : ''}" data-act="gro-ld" data-k="${key}" role="switch" aria-checked="${!!onv}" aria-label="${h} at ${t}"></button></div>`).join('')}
        </div>
        <div class="pad gro-sk-a"><button class="btn block" data-act="gro-alarm">${I.clock}Preview the 22:00 alarm</button></div>`;
    },
  });
  sh.dataset.aspect = 'growth';
  pulse(sh);
}
on('gro-ld', (el) => { el.classList.toggle('on'); const v = el.classList.contains('on'); el.setAttribute('aria-checked', String(v)); haptic(5); if (REAL && el.dataset.k) { putSettings({ [el.dataset.k]: v }); hooks.onLadder?.(); } });
on('gro-alarm', () => {
  const o = { title: STREAK.n ? `Save your ${STREAK.n}-day journal streak` : 'Tonight\'s entry', text: `Two lines are enough.${SETTINGS.call ? ' If you miss it, I call at 22:30.' : ''}`, aspect: 'growth', acts: [['Write now', 'gro-write'], ['Talk it instead', 'gro-talk']] };
  if (has('alarm')) { closeSheet(); setTimeout(() => api.alarm(o), 300); } else toast('The Agent tab shows the alarm at 22:00');
});

// ═══ TREND SHEETS ═══════════════════════════════════════════════════════
const WEEKS_LEN = () => LEVEL.length;
export function openTableSheet([from, to]) {
  const rows = [];
  for (let w = to; w >= from; w--) rows.push(`<tr><th scope="row">${weekNo(w)}</th><td>${esc(weekLabel(w))}</td><td class="num">${LEVEL[w - 1]}</td><td class="num ${RATE[w - 1] > 0 ? 'up' : RATE[w - 1] < 0 ? 'dn' : ''}">${signed(RATE[w - 1])}</td></tr>`);
  const sh = openSheet({
    title: 'Week by week', sub: `${to - from + 1} weeks · level and growth a week`, large: true, cls: 'gro-tbl',
    body: `<div class="pad"><table class="gro-table"><thead><tr><th scope="col">Week</th><th scope="col">Dates</th><th scope="col">Level</th><th scope="col">Growth</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <p class="hint">Growth is the change in level over the last four weeks, divided by four. One good or bad week can't swing it.</p>`,
  });
  sh.dataset.aspect = 'growth';
}
export function openAspectTrend(id) {
  const v = VELOCITY.find((x) => x.id === id), pt = POTENTIAL.find((x) => x.id === id), a = aspect(id);
  if (!v || !a) return;
  const goals = (pt?.goals ?? []).map((g) => GOALS.find((x) => x.id === g)).filter(Boolean);
  const sh = openSheet({
    title: a.name, sub: v.state === 'up' ? 'Improving' : v.state === 'down' ? 'Slipping' : 'Flat', cls: 'gro-ats',
    body(b) {
      const n0 = WEEKS_LEN(), first = Math.max(1, n0 - (v.arr?.length ?? 12) + 1);
      b.innerHTML = `<div class="gro-at-h pad">${aspectTile(id, 'big')}<span><b class="met">${v.now ?? '–'}</b><small>level now</small></span><span><b class="met">${signed(v.v)}</b><small>a week</small></span></div>
        <div class="gro-at-sp surface">${spark(v.arr, { w: 320, h: 92, label: `${a.name}, weeks ${weekNo(first)} to ${weekNo(n0)}` })}<p class="gro-at-ax"><span>Week ${weekNo(first)}</span><span>Week ${weekNo(n0)}</span></p></div>
        <p class="gro-at-d pad">${by()}<span>${esc(DRIVERS[id] ?? '')}</span></p>
        ${pt && pt.pot != null ? `<div class="sh"><h2>Potential</h2></div><div class="gro-at-pot surface">${bullet(pt)}<p><span>Now <b class="num">${pt.now ?? '–'}</b></span>${REAL ? `<span>Goals <b class="num">${pt.goals.length}</b></span>` : `<span>Goal <b class="num">${pt.goal ?? 'none'}</b></span>`}<span>${REAL ? 'Best weeks' : 'Potential'} <b class="num">${pt.pot}</b></span></p><p class="gro-at-best">Best ${REAL ? 'week' : 'stretch'}: ${esc(pt.best)}</p></div>` : ''}
        ${goals.length ? `<div class="sh"><h2>Goals here</h2></div><div class="group">${goals.map((g) => `<button class="row ic" data-act="gro-open" data-to="goal:${g.id}"><span class="tile">${I.target}</span><span class="rbody"><span class="rtitle wrap">${esc(g.title)}</span><span class="rmeta"><span>${esc(g.verdict)}</span>${g.metric ? `<span>·</span><span class="ell">${esc(g.metric)}</span>` : ''}</span></span>${I.chevR}</button>`).join('')}</div>` : ''}
        <div class="pad gro-at-a"><button class="btn block" data-act="gro-open" data-to="aspect:${id}">Open ${esc(a.name)}</button><button class="btn block" data-act="gro-ask" data-q="${esc(`Why is ${a.name} ${v.state === 'up' ? 'improving' : v.state === 'down' ? 'slipping' : 'flat'}?`)}">${I.sparkle}Ask why</button></div>`;
    },
  });
  sh.dataset.aspect = 'growth';
}

// Friends: the sheets. Log a moment (the agent reads what you type as you type it), a drafted message (you send it),
// a plan, the rhythm, someone new, a moment, the nudge ladder, a birthday. Every save is a real record in the people
// store. Owner: the PEOPLE agent. Controls inside a sheet use data-fx (local), so they never collide with data-act names.
import { $, $$, esc, openSheet, closeSheet, toast, seg, haptic } from '../core.js';
import { I } from '../icons.js';
import { AGENT } from '../data.js';
import { api } from '../bus.js';
import { symbol } from '../motion.js';
import * as P from './people-store.js';
import { IDEAS, SLOTS, slotIso, WHERE, KIND, today, when, dayLabel, shiftIso, isThisWeek, drafts, circleIds, allIds, momentById, moments, rhythmOf } from './friends-data.js';
import { S, G, av, who, nameOf, namesOf, chatThumb, momentTitle, ACT_ICON, ACT_NAME, KIND_ICON, FROM_ICON } from './friends-ui.js';

export const actsLabel = (acts = []) => acts.map((a, i) => i ? (ACT_NAME[a] ?? a).toLowerCase() : (ACT_NAME[a] ?? a)).join(' and ');
const sheet = (o) => { const el = openSheet({ ...o, cls: `fri-sheet ${o.cls ?? ''}` }); el.dataset.aspect = 'friends'; return el; };
const fx = (el, fn) => el.addEventListener('click', (e) => { const b = e.target.closest('[data-fx]'); if (b && el.contains(b)) fn(b.dataset.fx, b, e); });
const copy = (text) => { try { navigator.clipboard?.writeText(text).catch(() => {}); } catch {} };

// ── moments: add, remove (the store sends them; every open screen redraws from its change event) ──
const weekSaved = () => moments({ from: P.mondayOf(today()), to: P.addDays(P.mondayOf(today()), 6) }).some((m) => m.kind === 'meet');
/** Files a moment; true when it's the first in-person one this week (the week is saved). */
export function addMoment(m) {
  const was = weekSaved();
  const act = m.act === 'food' ? 'food' : m.act;
  const doc = P.logMoment({ aspect: 'friends', people: m.people, kind: m.kind ?? 'meet', act: act ?? null, acts: m.acts, title: m.title, text: m.text || undefined, date: m.date ?? today(),
    at: m.time ?? P.nowHm(), minutes: m.minutes ?? (m.kind === 'meet' ? 90 : 0), by: m.by ?? 'you', source: m.source ?? (m.by === 'wyn' ? 'said' : 'you'), said: m.quote, chat: m.chat, loop: m.loop });
  addMoment.last = doc.id;
  return !was && doc.kind === 'meet' && isThisWeek(doc.date);
}
export function removeMoment(id) { P.remove('moments', id); }

// ── 1 · log a moment: what he types becomes people, how, what and when, live ──
const RX = {
  call: /\b(call(ed)?|phone|rang|voice note)\b/i,
  chat: /\b(chat(ted)?|text(ed)?|whats ?app|messag(e|ed)|dm(ed)?|reels?|memes?)\b/i,
  gym: /\b(gym|work(ed)? ?out|trained|bench|push day|pull day|leg day|lift(ed)?|spot(ted)?)\b/i,
  drive: /\b(drive|drove|murthal|ride)\b/i,
  film: /\b(film|movie|cinema|pvr|show)\b/i,
  chai: /\b(chai|coffee|tea)\b/i,
  walk: /\b(walk(ed)?|stroll)\b/i,
  food: /\b(momos?|food|ate|eat|dinner|lunch|breakfast|pizza|rolls?|biryani|chole|bhature|khaa?na|burger|cafe|parathas?)\b/i,
  yesterday: /\b(yesterday|kal)\b/i,
  sat: /\b(saturday|last sat)\b/i,
};
function parse(text) {
  const t = text.trim();
  const people = allIds().filter((id) => { const p = P.person(id); return [p.name, ...(p.aliases ?? [])].some((w) => new RegExp(`\\b${String(w).replace(/[^\w ]/g, '')}\\b`, 'i').test(t)); });
  const kind = !t ? null : RX.call.test(t) ? 'call' : RX.chat.test(t) ? 'chat' : 'meet';
  const acts = ['gym', 'drive', 'film', 'chai', 'walk', 'food'].filter((k) => RX[k].test(t));
  const day = RX.yesterday.test(t) ? 'yesterday' : RX.sat.test(t) ? 'sat' : null;
  return { people, kind, act: acts[0] ?? null, acts, day };
}
const lastSat = () => { for (let i = 1; i <= 7; i++) { const d = P.addDays(today(), -i); if (P.weekday(d) === 'Sat') return d; } return P.addDays(today(), -1); };
const DAYS = () => [['today', 'Today', today()], ['yesterday', 'Yesterday', P.addDays(today(), -1)], ['sat', dayLabel(lastSat()).replace(/ \w+$/, (m) => m), lastSat()]];

export function openLog(prefill = {}) {
  const ids = allIds();
  const st = { picked: new Set([].concat(prefill.person ?? []).filter(Boolean)), excluded: new Set(), text: prefill.text ?? '', kind: prefill.kind ?? null, userKind: !!prefill.kind, day: prefill.day ?? null, userDay: !!prefill.day, shown: new Set() };
  const days = DAYS();
  const el = sheet({
    title: 'Log a moment', sub: `Tell ${esc(AGENT.name)} what happened. She files it with the right person.`, cls: 'fri-log',
    foot: `<div class="fri-sfoot"><button class="btn" data-fx="scan">${I.scan}<span>Scan a chat</span></button><button class="btn primary fri-go" data-fx="save">Save moment</button></div>`,
    body: (b) => {
      b.innerHTML = `<div class="fri-sb">
        <div class="fri-who" role="group" aria-label="Who was it with">
          ${ids.map((id) => `<button class="fri-whob" data-fx="who" data-v="${id}" aria-pressed="false">${av(id, 48)}<span>${esc(nameOf(id))}</span></button>`).join('')}
          <button class="fri-whob add" data-fx="new"><span class="fri-av fri-av-add" style="--av:48px">${I.plus}</span><span>Someone new</span></button>
        </div>
        <label class="fri-ta"><span class="vh">What happened</span><textarea rows="3" data-fx-in="text" placeholder="What happened? Say it like you'd tell a friend: had momos${ids[0] ? ` with ${esc(nameOf(ids[0]))}` : ''} after the gym">${esc(st.text)}</textarea></label>
        <div class="fri-parse" aria-live="polite"></div>
        <div class="fri-line"><span class="fri-lbl">How</span>${seg('fri-lkind', [['meet', 'In person'], ['call', 'Call'], ['chat', 'Chat']], st.kind ?? 'meet', 'sm')}</div>
        <div class="fri-line"><span class="fri-lbl">When</span><div class="chips fri-days">${days.map(([v, l]) => `<button class="chip sm" data-fx="day" data-v="${v}">${esc(l)}</button>`).join('')}</div></div>
      </div>`;
    },
  });
  const ta = $('textarea', el); const out = $('.fri-parse', el); const kseg = $('[data-seg="fri-lkind"]', el);
  const setKind = (k) => { $$('button', kseg).forEach((x) => x.setAttribute('aria-selected', String(x.dataset.v === k))); kseg._place?.(); };
  const render = () => {
    const p = parse(ta.value);
    const people = [...new Set([...st.picked, ...p.people])].filter((id) => !st.excluded.has(id));
    if (!st.userKind && p.kind) { st.kind = p.kind; setKind(p.kind); }
    if (!st.userDay && p.day) st.day = p.day;
    const day = st.day ?? 'today';
    $$('.fri-whob[data-v]', el).forEach((x) => x.setAttribute('aria-pressed', String(people.includes(x.dataset.v))));
    $$('.fri-days .chip', el).forEach((x) => x.classList.toggle('on', x.dataset.v === day));
    const kind = st.kind ?? 'meet';
    const tags = [
      ...people.map((id) => ['p-' + id, `${av(id, 20)}<span>${esc(nameOf(id))}</span>`]),
      ['k-' + kind, `${KIND_ICON[kind]}<span>${KIND[kind]}</span>`],
      ...p.acts.map((a) => ['a-' + a, `${ACT_ICON[a]}<span>${ACT_NAME[a]}</span>`]),
      ['d-' + day, `${I.cal}<span>${esc(days.find((d) => d[0] === day)[1])}</span>`],
    ];
    out.innerHTML = ta.value.trim() || people.length
      ? `<span class="fri-parse-h">${I.sparkle}<span>${esc(AGENT.name)} files it as</span></span><span class="fri-tags">${tags.map(([k, h]) => `<span class="fri-tag${st.shown.has(k) ? '' : ' fresh'}">${h}</span>`).join('')}</span>`
      : `<span class="fri-parse-h">${I.sparkle}<span>${esc(AGENT.name)} picks out who, what and when as you type.</span></span>`;
    tags.forEach(([k]) => st.shown.add(k));
    st.people = people; st.act = p.act; st.acts = p.acts;
  };
  ta.addEventListener('input', render);
  kseg.addEventListener('change', (e) => { st.kind = e.detail; st.userKind = true; render(); });
  fx(el, (f, b) => {
    if (f === 'who') { const v = b.dataset.v; if ((st.people ?? []).includes(v)) { st.picked.delete(v); st.excluded.add(v); } else { st.picked.add(v); st.excluded.delete(v); } haptic(5); render(); }
    if (f === 'day') { st.day = b.dataset.v; st.userDay = true; render(); }
    if (f === 'new') { closeSheet(el); setTimeout(() => openAdd({ note: ta.value.trim() }), 260); }
    if (f === 'scan') { closeSheet(el); setTimeout(() => api.scan('chat'), 260); }
    if (f === 'save') {
      if (!st.people?.length) { out.innerHTML = `<span class="fri-parse-h warn">${I.people}<span>Who was it with? Tap a friend above.</span></span>`; haptic(14); return; }
      const kind = st.kind ?? 'meet'; const date = days.find((d) => d[0] === (st.day ?? 'today'))[2];
      const names = namesOf(st.people);
      const what = actsLabel(st.acts);
      const title = what ? `${what} with ${names}` : kind === 'meet' ? `Time with ${names}` : kind === 'call' ? `A call with ${names}` : `A chat with ${names}`;
      closeSheet(el);
      const saved = addMoment({ date, time: date === today() ? P.nowHm() : '20:00', people: st.people, kind, act: kind === 'meet' ? st.act : null, acts: st.acts?.length > 1 ? st.acts : undefined, title, text: ta.value.trim(), by: 'you', source: 'you' });
      const id = addMoment.last;
      haptic(saved ? 18 : 10);
      toast(saved ? `Week saved: you saw ${names} in person` : `Filed: ${kind === 'meet' ? `time with ${names}` : `a ${kind} with ${names}`}`, () => removeMoment(id));
    }
  });
  render();
  if (prefill.focus) setTimeout(() => ta.focus(), 420);
  return el;
}

// the agent filing on her own, from something he said (logFriends({ person, text, auto: true }))
export function fileFromSaid({ person, text, kind = 'meet' }) {
  const p = parse(text ?? ''); const people = [...new Set([].concat(person ?? []).concat(p.people))].filter((id) => P.person(id));
  if (!people.length) return openLog({ text });
  const k = p.kind ?? kind; const names = namesOf(people);
  const saved = addMoment({ people, kind: k, title: k === 'meet' && p.acts.length ? `${actsLabel(p.acts)} with ${names}` : k === 'call' ? `A call with ${names}` : k === 'chat' ? `A chat with ${names}` : `Time with ${names}`,
    act: k === 'meet' ? p.act : null, acts: k === 'meet' && p.acts.length > 1 ? p.acts : undefined, by: 'wyn', source: 'said', quote: text });
  const id = addMoment.last;
  toast(saved ? `${AGENT.name} filed it. Week saved with ${names}` : `${AGENT.name} filed it under ${names}`, () => removeMoment(id));
  return momentById(id);
}

// ── 2 · a drafted message: Hinglish or English, three directions, copy then send it himself ──
export function openDraft(id, { variant = 0, text = null } = {}) {
  const p = who(id); if (!P.person(id)) return null;
  const d = drafts(id);
  const own = P.draftsFor(id);
  const st = { tone: S.tone, i: variant, edited: text };
  const phone = (P.person(id)?.contact?.phones ?? [])[0];
  const wa = phone ? `https://wa.me/${String(phone).replace(/[^\d]/g, '').replace(/^0+/, '').replace(/^(?=\d{10}$)/, '91')}` : null;
  const allowed = (P.person(id)?.allow?.kinds ?? []).length;
  const el = sheet({
    title: `Message ${esc(p.name)}`, sub: own.length ? `${esc(AGENT.name)} drafted it. You send it.` : 'A way to start. You send it.', cls: 'fri-draft',
    foot: `<div class="fri-sfoot"><button class="btn" data-fx="copy">${I.copy}<span>Copy</span></button><button class="btn primary fri-go" data-fx="open">${wa ? 'Open WhatsApp' : 'Copy and send'}</button></div>`,
    body: (b) => {
      b.innerHTML = `<div class="fri-sb">
        <div class="fri-line">${seg('fri-tone', [['hinglish', 'Hinglish'], ['english', 'English']], st.tone, 'sm')}</div>
        <div class="fri-draftbox">
          <span class="fri-draft-to">${av(id, 28)}<span>To ${esc(p.name)}</span></span>
          <label class="fri-bubble"><span class="vh">Message</span><textarea rows="3" data-fx-in="msg"></textarea></label>
        </div>
        <div class="chips fri-alts">${d.tags.map((t, i) => `<button class="chip sm" data-fx="alt" data-i="${i}">${esc(t)}</button>`).join('')}</div>
        <p class="fri-never">${I.lock}<span>${allowed ? `${esc(AGENT.name)} only sends the small things you allowed for ${esc(p.name)}. This one you send.` : `${esc(AGENT.name)} never sends messages as you. She copies it; you press send.`}</span></p>
      </div>`;
    },
  });
  const ta = $('textarea', el);
  const fill = () => { ta.value = st.edited ?? d[st.tone][st.i] ?? d[st.tone][0]; $$('.fri-alts .chip', el).forEach((c) => c.classList.toggle('on', Number(c.dataset.i) === st.i)); };
  ta.addEventListener('input', () => { st.edited = ta.value; });
  $('[data-seg="fri-tone"]', el).addEventListener('change', (e) => { st.tone = e.detail; S.tone = e.detail; st.edited = null; fill(); });
  fx(el, (f, b) => {
    if (f === 'alt') { st.i = Number(b.dataset.i); st.edited = null; fill(); haptic(5); }
    if (f === 'copy') { copy(ta.value); toast('Copied. Paste it in your chat with ' + p.name); }
    if (f === 'open') {
      copy(ta.value);
      if (wa) { try { window.open(`${wa}?text=${encodeURIComponent(ta.value)}`, '_blank'); } catch {} }
      $('.sheet-body', el).innerHTML = `<div class="fri-sb fri-sentq">
        <span class="fri-sentq-i">${I.check}</span>
        <h4 class="title3">Copied for ${esc(p.name)}</h4>
        <p class="sub">${wa ? 'WhatsApp opens with your chat. Press send yourself.' : 'Paste it in your chat and press send yourself.'}</p>
        <p class="fri-quote">“${esc(ta.value)}”</p>
      </div>`;
      symbol($('.fri-sentq-i', el), 'draw');
      $('.fri-sfoot', el).innerHTML = `<button class="btn" data-fx="later">Not yet</button><button class="btn primary fri-go" data-fx="sent">I sent it</button>`;
    }
    if (f === 'later') { closeSheet(el); toast('Okay. The draft stays here for later'); }
    if (f === 'sent') {
      const msg = ta.value.trim();
      for (const dr of own) P.update('drafts', dr.id, { state: 'sent', sent_at: new Date().toISOString() });
      for (const pl of P.plansFor({ person: id }).filter((x) => x.state === 'draft')) P.update('plans', pl.id, { state: 'sent' });
      addMoment({ people: [id], kind: 'chat', title: `You messaged ${p.name}`, text: msg.slice(0, 280), by: 'you', source: 'you' });
      closeSheet(el); haptic(12);
      toast(`Nice. ${AGENT.name} watches for ${p.name}’s reply`);
    }
  });
  fill();
  return el;
}
// several drafts at once, from the weekly prompt
export function openDrafts(ids) {
  if (ids.length === 1) return openDraft(ids[0]);
  const el = sheet({
    title: `${ids.length} messages`, sub: `A way to start with each. You send them.`, cls: 'fri-draft',
    body: (b) => {
      b.innerHTML = `<div class="fri-sb">${ids.map((id) => `<div class="fri-draftbox">
          <span class="fri-draft-to">${av(id, 28)}<span>To ${esc(nameOf(id))}</span></span>
          <p class="fri-bubble-p">${esc(drafts(id)[S.tone][0])}</p>
          <div class="fri-draftbox-a"><button class="btn sm" data-fx="edit" data-id="${id}">Change it</button><button class="btn sm tint" style="--c:var(--as-ink)" data-fx="copy" data-id="${id}">${I.copy}<span>Copy</span></button></div>
        </div>`).join('')}
        <p class="fri-never">${I.lock}<span>${esc(AGENT.name)} never sends messages as you.</span></p></div>`;
    },
  });
  fx(el, (f, b) => {
    const id = b.dataset.id;
    if (f === 'copy') { copy(drafts(id)[S.tone][0]); b.innerHTML = `${I.check}<span>Copied</span>`; toast(`Copied for ${nameOf(id)}`); }
    if (f === 'edit') { closeSheet(el); setTimeout(() => openDraft(id), 260); }
  });
  return el;
}

// ── 3 · a plan beyond food ──
export function openPlan(ideaId = 'chai', whoId = null) {
  const idea = IDEAS[ideaId] ?? IDEAS.chai;
  const ids = circleIds(); if (!ids.length && !whoId) return null;
  const st = { who: whoId ?? ids[0], slot: idea.slot };
  const el = sheet({
    title: idea.title, sub: 'Pick who and when. Then message them.', cls: 'fri-plan',
    foot: `<div class="fri-sfoot"><button class="btn" data-fx="pencil">${I.cal}<span>Pencil it in</span></button><button class="btn primary fri-go" data-fx="draft">Draft the message</button></div>`,
    body: (b) => {
      b.innerHTML = `<div class="fri-sb">
        <div class="fri-plan-hero"><span class="fri-itile big">${ACT_ICON[ideaId] ?? I.cal}</span><p class="sub">${esc(idea.line)}</p></div>
        <div class="fri-line col"><span class="fri-lbl">With</span><div class="chips">${[...new Set([...ids, ...(whoId ? [whoId] : [])])].map((id) => `<button class="chip fri-pchip" data-fx="who" data-v="${id}">${av(id, 24)}<span>${esc(nameOf(id))}</span></button>`).join('')}</div></div>
        <div class="fri-line col"><span class="fri-lbl">When</span><div class="chips">${SLOTS().map((s) => `<button class="chip" data-fx="slot" data-v="${s}">${s}</button>`).join('')}</div></div>
        ${idea.link ? `<button class="row tap fri-link" data-fx="link"><span class="tile asp-tile" data-aspect="${idea.link[0]}">${I.dumbbell}</span><span class="rbody"><span class="rtitle">${esc(idea.link[1])}</span><span class="rmeta">Your sessions and plan</span></span>${I.chevR}</button>` : ''}
      </div>`;
    },
  });
  const paint = () => {
    $$('[data-fx="who"]', el).forEach((c) => c.classList.toggle('on', c.dataset.v === st.who));
    $$('[data-fx="slot"]', el).forEach((c) => c.classList.toggle('on', c.dataset.v === st.slot));
  };
  fx(el, (f, b) => {
    if (f === 'who') { st.who = b.dataset.v; paint(); haptic(5); }
    if (f === 'slot') { st.slot = b.dataset.v; paint(); haptic(5); }
    if (f === 'link') { closeSheet(el); api.openAspect(idea.link[0]); }
    if (f === 'draft') { closeSheet(el); setTimeout(() => openDraft(st.who, { variant: ideaId === 'film' ? 2 : 0 }), 260); }
    if (f === 'pencil') {
      const name = nameOf(st.who); const date = slotIso(st.slot);
      const ex = P.plansFor({ person: st.who, open: true }).find((x) => x.date === date);
      if (ex) P.update('plans', ex.id, { title: idea.title, idea: ideaId, slot: st.slot, state: ex.state === 'asked' ? 'tentative' : ex.state });
      else P.add('plans', { date, people: [st.who], aspect: 'friends', title: idea.title, idea: ideaId, slot: st.slot, state: 'tentative', by: 'you' });
      closeSheet(el); haptic(10);
      toast(`Pencilled in: ${idea.title} with ${name}, ${st.slot}`);
    }
  });
  paint();
  return el;
}

// ── 4 · the rhythm he wants with someone ──
const EVERY = [[7, 'Every week'], [14, 'Every two weeks'], [30, 'Every month']];
export function openRhythm(id) {
  const p = who(id); if (!P.person(id)) return null;
  const r = rhythmOf(id);
  const st = { every: r?.every ?? 7, mode: r?.mode === 'talk' ? 'talk' : 'meet' };
  const el = sheet({
    title: `Rhythm with ${esc(p.name)}`, sub: `How often you want this. ${esc(AGENT.name)} nudges you when it slips.`, cls: 'fri-rhythm',
    foot: `<div class="fri-sfoot one"><button class="btn primary fri-go block" data-fx="save">Save</button></div>`,
    body: (b) => {
      b.innerHTML = `<div class="fri-sb">
        <div class="group fri-opts" role="radiogroup" aria-label="How often">${EVERY.map(([n, l]) => `<button class="row tap" role="radio" data-fx="every" data-v="${n}"><span class="rbody"><span class="rtitle">${l}</span></span><span class="fri-rck">${I.check}</span></button>`).join('')}</div>
        <div class="fri-line col"><span class="fri-lbl">What counts</span>${seg('fri-rmode', [['meet', 'In person'], ['talk', 'A chat or a call']], st.mode)}</div>
        <p class="hint">${esc(p.name)} moves out in your circle as the days pass, and back in when you meet.</p>
      </div>`;
    },
  });
  const paint = () => $$('[data-fx="every"]', el).forEach((x) => { const on = Number(x.dataset.v) === st.every; x.setAttribute('aria-checked', String(on)); x.classList.toggle('on', on); });
  $('[data-seg="fri-rmode"]', el).addEventListener('change', (e) => { st.mode = e.detail; });
  fx(el, (k, b) => {
    if (k === 'every') { st.every = Number(b.dataset.v); paint(); haptic(5); }
    if (k === 'save') {
      const label = `${EVERY.find((e) => e[0] === st.every)[1]}, ${st.mode === 'meet' ? 'in person' : 'a chat or a call'}`;
      if (r) P.update('rhythms', r.id, { every: st.every, mode: st.mode, label, source: 'you' });
      else P.add('rhythms', { person: id, every: st.every, mode: st.mode, title: st.mode === 'meet' ? `See ${p.name}` : 'Stay in touch', label, source: 'you', sort: 1 });
      if (P.person(id)?.rel === 'new') P.update('persons', id, { rel: 'friend' });   // a rhythm makes someone new part of the circle
      closeSheet(el); toast(`Rhythm with ${p.name}: ${label.toLowerCase()}`);
    }
  });
  paint();
  return el;
}

// ── 5 · someone new: one line is enough (or a pick from Contacts on the iPhone) ──
export function openAdd(prefill = {}) {
  const st = { where: prefill.where ?? null, follow: '2d', contact: prefill.contact ?? null };
  const el = sheet({
    title: 'Someone new', sub: 'One line is enough. Add more any time.', cls: 'fri-add',
    foot: `<div class="fri-sfoot"><button class="btn" data-fx="${P.canPickContact() ? 'contact' : 'card'}">${P.canPickContact() ? `${I.people}<span>Contacts</span>` : `${I.scan}<span>Scan a card</span>`}</button><button class="btn primary fri-go" data-fx="add">Add to circle</button></div>`,
    body: (b) => {
      b.innerHTML = `<div class="fri-sb">
        <div class="fri-add-hero"><span class="fri-av lit fri-mono" style="--av:72px" aria-hidden="true">${esc((prefill.name ?? '').trim()[0]?.toUpperCase() ?? '')}${prefill.name ? '' : I.plus}</span>
          <p class="foot">New people start warm. ${esc(AGENT.name)} reminds you to follow up while it’s easy, and counts the hours you spend together.</p></div>
        <label class="field fri-field"><span class="vh">Name</span><input data-fx-in="name" placeholder="Their name" autocomplete="off" value="${esc(prefill.name ?? '')}" /></label>
        <div class="fri-line col"><span class="fri-lbl">Where you met</span><div class="chips">${WHERE.map((w) => `<button class="chip" data-fx="where" data-v="${esc(w)}">${esc(w)}</button>`).join('')}</div></div>
        <label class="field fri-field"><span class="vh">Something to remember</span><input data-fx-in="note" placeholder="One thing to remember about them" autocomplete="off" value="${esc(prefill.note ?? '')}" /></label>
        <div class="fri-line col"><span class="fri-lbl">Follow up</span>${seg('fri-follow', [['2d', 'In 2 days'], ['week', 'Next week'], ['no', 'No']], st.follow)}</div>
        <p class="fri-hint" aria-live="polite"></p>
      </div>`;
    },
  });
  const name = $('input[data-fx-in="name"]', el); const mono = $('.fri-mono', el);
  const setMono = () => { const c = name.value.trim()[0]?.toUpperCase(); mono.innerHTML = c ? esc(c) : I.plus; mono.classList.toggle('typed', !!c); };
  name.addEventListener('input', setMono);
  const paint = () => $$('[data-fx="where"]', el).forEach((c) => c.classList.toggle('on', c.dataset.v === st.where));
  $('[data-seg="fri-follow"]', el).addEventListener('change', (e) => { st.follow = e.detail; });
  fx(el, async (f, b) => {
    if (f === 'where') { st.where = st.where === b.dataset.v ? null : b.dataset.v; paint(); haptic(5); }
    if (f === 'card') { closeSheet(el); setTimeout(() => api.scan('card'), 260); }
    if (f === 'contact') { const c = await P.pickContact(); if (c) { st.contact = c; name.value = c.name; setMono(); haptic(8); $('.fri-hint', el).textContent = c.birthday ? 'Their birthday comes from Contacts too.' : ''; } }
    if (f === 'add') {
      const n = name.value.trim();
      if (!n) { $('.fri-hint', el).textContent = 'Add their name first.'; name.focus(); haptic(14); return; }
      const note = $('input[data-fx-in="note"]', el).value.trim();
      const follow = st.follow === '2d' ? shiftIso(today(), 2) : st.follow === 'week' ? shiftIso(today(), 7) : null;
      const p = P.addPerson({ name: n, rel: 'new', where: st.where, note: note || null, follow, contact: st.contact });
      closeSheet(el); haptic(16);
      if (p) toast(follow ? `${n} is in your circle. ${AGENT.name} reminds you ${dayLabel(follow)}` : `${n} is in your circle`, () => P.remove('persons', p.id));
    }
  });
  paint();
  return el;
}

// ── 6 · one moment, and where it came from ──
const FROM_LONG = (m) => ({
  screenshot: `From a WhatsApp screenshot you shared at ${m.time}`,
  share: `Shared in from WhatsApp at ${m.time}`,
  said: `From what you told her at ${m.time}`,
  calendar: `From your calendar: ${momentTitle(m)}, ${m.time}`,
  typed: `You logged it at ${m.time}`,
}[m.from] ?? '');
export function openMoment(id, { onPerson } = {}) {
  const m = momentById(id); if (!m) return;
  const el = sheet({
    title: esc(momentTitle(m)), sub: `${when(m.date)} · ${esc(m.time)}`, cls: 'fri-msheet',
    body: (b) => {
      b.innerHTML = `<div class="fri-sb">
        <div class="fri-md-who">${m.people.map((p) => `<button class="fri-md-p" data-fx="person" data-id="${p}">${av(p, 32)}<span>${esc(nameOf(p))}</span>${I.chevR}</button>`).join('')}</div>
        ${m.text ? `<p class="fri-md-x">${esc(m.text)}</p>` : ''}
        ${chatThumb(m, true)}
        <div class="fri-md-src">
          <span class="tile">${FROM_ICON[m.from] ?? I.edit}</span>
          <span class="fri-md-srcb"><b>${m.by === 'wyn' ? `Filed by ${esc(AGENT.name)}` : 'You logged it'}</b><span class="foot">${esc(FROM_LONG(m))} · ${esc(KIND[m.kind] ?? '')}${m.act ? ` · ${esc(ACT_NAME[m.act] ?? m.act)}` : ''}</span>
          ${m.quote ? `<span class="fri-quote">“${esc(m.quote)}”</span>` : ''}</span>
        </div>
        ${m.loop ? `<button class="row tap fri-loop-row" data-fx="loop"><span class="tile">${I.clock}</span><span class="rbody"><span class="rtitle">${esc(m.loop)}</span><span class="rmeta">From this chat · pick a plan</span></span>${I.chevR}</button>` : ''}
        <div class="group fri-md-acts">
          <button class="row ic tap" data-fx="remember"><span class="tile">${I.brain}</span><span class="rbody"><span class="rtitle">Keep it in ${esc(nameOf(m.people[0]))}’s file</span><span class="rmeta">So ${esc(AGENT.name)} remembers it</span></span>${I.chevR}</button>
          <button class="row ic tap fri-del" data-fx="del"><span class="tile">${I.trash}</span><span class="rbody"><span class="rtitle">Delete this moment</span></span></button>
        </div>
      </div>`;
    },
  });
  fx(el, (f, b) => {
    if (f === 'person') { closeSheet(el); onPerson?.(b.dataset.id); }
    if (f === 'loop') { closeSheet(el); setTimeout(() => openPlan('chai', m.people[0]), 260); }
    if (f === 'remember') { closeSheet(el); api.remember(`${momentTitle(m)}. ${m.text ?? ''}`.trim(), { aspect: 'friends', person: m.people[0] }); }
    if (f === 'del') { const doc = m.raw; closeSheet(el); removeMoment(m.id); toast('Moment deleted', () => P.restore('moments', doc)); }
  });
  return el;
}

// ── 7 · the ladder: what the agent does if the week stays empty (his settings, kept in the store) ──
const LADDER = [
  ['Fri 20:00', 'A notification', 'The weekend’s still open. Nobody’s heard from you.'],
  ['Sat 10:00', 'A banner', 'When you next pick up your phone, on any screen.'],
  ['Sat 12:00', 'The alarm', 'Save your week. One tap opens a draft.'],
  ['Sat 14:00', 'She calls', 'Only if you ignored the alarm. Two minutes, then she lets it go.'],
];
export const ladder = () => P.state('friends')?.ladder ?? [true, true, true, false];
export function openLadder() {
  const on0 = ladder();
  const el = sheet({
    title: 'If the week stays empty', sub: `How ${esc(AGENT.name)} keeps a week from slipping. You choose how far she goes.`, cls: 'fri-ladder-s',
    foot: `<div class="fri-sfoot one"><button class="btn block" data-fx="preview">${G.bell}<span>Preview the alarm</span></button></div>`,
    body: (b) => {
      b.innerHTML = `<div class="fri-sb"><ol class="fri-ladder">${LADDER.map(([t, h, l], i) => `
        <li class="fri-step">
          <span class="fri-step-dot" aria-hidden="true">${i + 1}</span>
          <span class="fri-step-b"><span class="fri-step-t"><b>${h}</b><span class="num">${t}</span></span><span class="foot">${esc(l)}</span></span>
          <button class="switch${on0[i] ? ' on' : ''}" role="switch" aria-checked="${on0[i]}" aria-label="${h}" data-fx="sw" data-i="${i}"></button>
        </li>`).join('')}</ol>
        <p class="hint">The ladder stops the moment you message someone or make a plan.</p></div>`;
    },
  });
  fx(el, (f, b) => {
    if (f === 'sw') {
      const on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); haptic(6);
      const next = [...ladder()]; next[Number(b.dataset.i)] = on; P.setState('friends', { ladder: next });
    }
    if (f === 'preview') {
      closeSheet(el);
      const first = circleIds()[0];
      setTimeout(() => api.alarm({ title: 'Save your week', text: `You haven’t seen a friend in person this week.${first ? ` A message to ${nameOf(first)} is one tap away.` : ''}`, aspect: 'friends', acts: [['Open a draft', 'fri-draft'], ['Not this week', 'fri-skipweek']] }), 280);
    }
  });
  return el;
}

// ── 8 · a birthday: never guessed, only added ──
export function openBday(id) {
  const p = who(id); const b = P.birthdayOf(id);
  const v = b ? (b.year ? `${b.year}-${b.md}` : `${today().slice(0, 4)}-${b.md}`) : '';
  const el = sheet({
    title: `${esc(p.name)}’s birthday`, sub: `${esc(AGENT.name)} reminds you a week before, and on the day.`, cls: 'fri-bday',
    foot: `<div class="fri-sfoot one"><button class="btn primary fri-go block" data-fx="save">Save</button></div>`,
    body: (bb) => { bb.innerHTML = `<div class="fri-sb"><label class="field fri-field"><span class="vh">Birthday</span><input type="date" data-fx-in="date" value="${esc(v)}" /></label><p class="hint">Only you add it. ${esc(AGENT.name)} never guesses a date.</p></div>`; },
  });
  fx(el, (f) => {
    if (f !== 'save') return;
    const val = $('input', el).value;
    if (!val) { closeSheet(el); return; }
    P.setDate({ kind: 'birthday', people: [id], md: val.slice(5), year: null, title: `${p.name}'s birthday`, aspect: 'friends' });
    closeSheet(el);
    const [, mm, dd] = val.split('-'); toast(`${p.name}’s birthday saved: ${Number(dd)} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mm) - 1]}`);
  });
  return el;
}

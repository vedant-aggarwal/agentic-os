// Romance: love, dating, and being ready for it. Owner: the PEOPLE agent (this file, romance-*.js, people-store.js,
// css/aspects/romance.css). The frame, the colour (--as) and registerAspect() are the lead's, in js/aspects.js.
//
// Two states, one app:
//   single (his): Home · Looking for · Out there · Journal. One small step a week, what he wants in his own words,
//                 the links to Body, Friends, Soul and Mind that make him ready, social reps, a private journal.
//                 All of it real records in the people store (people_journal, people_state), private.
//   couple (a sample preview, labelled on every screen): Us · Dates · Check-in · Moments, and the partner page.
// Private by default: Face ID on open (the iPhone; a tap on the web). Nothing here names a real person or invents a crush.
import { $, $$, esc, on, closeSheet, toast, haptic, ring, setRing } from '../core.js';
import { I } from '../icons.js';
import { registerAspect, aspHead, aspectTile, summary, openAspect } from '../aspects.js';
import { aspect, AGENT } from '../data.js';
import { api, has, provide } from '../bus.js';
import { stagger } from '../motion.js';
import * as P from './people-store.js';
import {
  S, weekInfo, steps, stepState, setStep, currentStep, weeks, streak, prompts, FB, looking, setLooking, READY, ideas, reps, WEEK_PROMPT,
  notes, patterns, wynNote, prefs, TOOLS, PARTNER,
} from './romance-data.js';
import {
  R, romSheet, pairArt, entryCard, wynCard, sectionHead, lockKicker, weekDots, mountLock, openComposer, refreshIfBuilt, setSwitcher,
} from './romance-ui.js';
import { renderUs, renderDates, renderCheckin, renderMoments, openPartner, logRow } from './romance-couple.js';

// ══ Home ══════════════════════════════════════════════════════════════
function renderHome(el, app) {
  const ps = prompts(); const answered = ps.filter((p) => p.a);
  el.innerHTML = `
    ${aspHead(app, { kicker: lockKicker, title: 'Romance', right: `<button class="rom-ib" data-act="rom-privacy" aria-label="Privacy settings">${I.shield}</button>` })}
    ${stepCard()}
    <div class="rom-gap sm"></div>
    ${wynCard({ ...wynNote(), acts: `<button class="btn sm" data-act="rom-ask">${I.sparkle}Talk it through</button>` })}
    ${sectionHead('What you’re looking for', { act: 'rom-go', actLabel: 'All', attrs: 'data-s="looking"' })}
    <div class="rom-rail rail" data-scroll-x>${answered.map((p) => promptCard(p)).join('')}
      <button class="rom-pc rom-pc-more surface" data-act="rom-go" data-s="looking"><span class="rom-pc-plus">${I.plus}</span><span class="rom-pq">${answered.length ? `${ps.length - answered.length} more to answer, when you feel like it` : `${ps.length} prompts to answer in your own words, when you feel like it`}</span></button></div>
    ${sectionHead('Getting ready')}
    <p class="hint rom-hint-top">Most of it happens in your other apps.</p>
    <div class="group">${READY.map(readyRow).join('')}</div>
    <div class="rom-gap"></div>
    <section class="rom-card surface rom-door">
      ${pairArt}
      <div class="rom-door-b"><p class="rom-next-t">When you meet someone</p>
        <p class="sub">A page for them, dates, a Sunday check-in and help after a fight. See it with sample data.</p>
        <div class="rom-row-btns"><button class="btn sm" data-act="rom-preview">See a preview</button></div></div>
    </section>`;
  stagger($$('.rom-card, .group', el).slice(0, 5), { y: 10, each: 50, delay: 80 });
}

// this week's one small step: a ring that closes, a streak that allows quiet weeks
const stepCard = () => {
  const st = currentStep(); const s = stepState(); const done = !!s.done; const wk = weekInfo(); const str = streak();
  return `<section class="rom-card surface rom-step ${done ? 'is-done' : ''}">
    <p class="rom-card-h"><span class="rom-k c-as">This week’s small step</span><span class="rom-k rom-step-left">${done ? 'Done' : esc(wk.left)}</span></p>
    <div class="rom-step-main">
      <div class="rom-step-txt" aria-live="polite">
        <p class="rom-step-t">${esc(st.text)}</p>
        <p class="rom-step-why">${esc(done ? `Logged as a rep. ${AGENT.name} picks next week’s step on Monday.` : st.why)}</p>
      </div>
      ${ring(done ? 1 : 0, 'as', 76, 8, { cls: 'rom-step-ring', label: done ? 'This week’s step is done' : 'This week’s step is still open', inner: `<span class="rom-step-ic">${done ? I.check : I.people}</span>` })}
    </div>
    <div class="rom-week">${weekDots(weeks(), { done })}<span class="rom-streak"><b class="met">${str.n + (done ? 1 : 0)}</b><span>${str.n + (done ? 1 : 0) === 1 ? 'week' : 'weeks'} in a row</span></span></div>
    <div class="rom-step-acts">${done ? feelRow() : `<div class="rom-row-btns"><button class="btn sm rom-tint" data-act="rom-step-done">${I.check}I did it</button><button class="btn sm" data-act="rom-step-next">Another idea</button></div>`}</div>
    <p class="rom-step-from">${I.sparkle}<span>${esc(done ? `${str.quietLeft} quiet ${str.quietLeft === 1 ? 'week' : 'weeks'} left this month, if you need one` : st.from)}</span></p>
  </section>`;
};
// the same step, compact, for the top of Out there
const stepMini = () => {
  const st = currentStep(); const done = !!stepState().done; const str = streak();
  return `<section class="rom-card surface rom-step rom-step-mini ${done ? 'is-done' : ''}">
    ${ring(done ? 1 : 0, 'as', 56, 6, { cls: 'rom-step-ring', label: done ? 'This week’s step is done' : 'This week’s step is still open', inner: `<span class="rom-step-ic">${done ? I.check : I.people}</span>` })}
    <div class="rom-step-txt"><p class="rom-k c-as">This week’s small step</p><p class="rom-step-t">${esc(st.text)}</p>
      <p class="rom-step-why">${done ? `Done · ${str.n + 1} ${str.n + 1 === 1 ? 'week' : 'weeks'} in a row` : `${esc(weekInfo().left)} · ${str.n} ${str.n === 1 ? 'week' : 'weeks'} in a row`}</p></div>
    ${done ? '' : `<button class="btn sm rom-tint" data-act="rom-step-done">I did it</button>`}
  </section>`;
};
const FEEL_STEP = [['good', 'Went well'], ['awkward', 'Awkward'], ['unsure', 'Not sure']];
const feelRow = () => { const f = stepState().feel; return f
  ? `<p class="rom-step-felt">${I.check}<span>Saved how it went: ${esc(FEEL_STEP.find(([v]) => v === f)?.[1].toLowerCase() ?? f)}</span></p>`
  : `<p class="rom-cmp-l rom-step-q">How did it go?</p><div class="chips">${FEEL_STEP.map(([v, l]) => `<button class="chip sm" data-act="rom-step-feel" data-v="${v}">${esc(l)}</button>`).join('')}</div>`; };

const stepCards = () => $$('.rom-step', S.app?.page ?? document);
function rerenderSteps({ except = null } = {}) {
  stepCards().forEach((c) => { if (c !== except) c.outerHTML = c.classList.contains('rom-step-mini') ? stepMini() : stepCard(); });
}
const setText = (root, sel, text) => { const n = $(sel, root); if (n) n.textContent = text; };
let quiet = false;   // a local change is drawn in place; the store's echo shouldn't redraw over the animation
on('rom-step-done', (el) => {
  if (stepState().done) return;
  const card = el.closest('.rom-step');
  const before = streak().n;
  quiet = true; setTimeout(() => { quiet = false; }, 1200);
  setStep({ done: true, done_at: new Date().toISOString() });
  const rep = P.add('journal', { date: P.today(), at: P.nowHm(), kind: 'rep', step: true, by: 'you', source: 'you', text: currentStep().text });
  haptic(16);
  // the visible card closes in place; any other copy is simply redrawn
  rerenderSteps({ except: card });
  setRing($('.rom-step-ring', card), 1);
  card.classList.add('is-done', 'rom-closing');
  const ic = $('.rom-step-ic', card); if (ic) ic.innerHTML = I.check;
  setText(card, '.rom-step-left', 'Done');
  const now = $('.rom-dot.now', card); if (now) { now.className = 'rom-dot done now pop'; now.innerHTML = I.check; }
  const n = $('.rom-streak b', card); if (n) setTimeout(() => { n.textContent = String(before + 1); n.classList.add('bump'); }, 420);
  if (card.classList.contains('rom-step-mini')) {
    setText(card, '.rom-step-why', `Done · ${before + 1} ${before + 1 === 1 ? 'week' : 'weeks'} in a row`);
    card.querySelector('[data-act="rom-step-done"]')?.remove();
  } else {
    setText(card, '.rom-step-why', `Logged as a rep. ${AGENT.name} picks next week’s step on Monday.`);
    const acts = $('.rom-step-acts', card); if (acts) acts.innerHTML = feelRow();
    setText(card, '.rom-step-from span', `${streak().quietLeft} quiet week left this month, if you need one`);
  }
  refreshIfBuilt(S.app?.section === 'out' ? 'home' : 'out');
  toast(`Step done. ${before + 1} ${before + 1 === 1 ? 'week' : 'weeks'} in a row`, () => { setStep({ done: false, feel: null }); P.remove('journal', rep.id); });
});
on('rom-step-feel', (el) => {
  quiet = true; setTimeout(() => { quiet = false; }, 600);
  setStep({ feel: el.dataset.v }); haptic(8);
  stepCards().forEach((c) => { const a = $('.rom-step-acts', c); if (a) a.innerHTML = feelRow(); });
  toast(`${AGENT.name} will use it to pick next week’s step`);
});
on('rom-step-next', () => {
  quiet = true; setTimeout(() => { quiet = false; }, 600);
  setStep({ idx: ((stepState().idx ?? 0) + 1) % steps().length }); haptic(6);
  const st = currentStep();
  stepCards().forEach((c) => {
    setText(c, '.rom-step-t', st.text); setText(c, '.rom-step-from span', st.from);
    if (!c.classList.contains('rom-step-mini')) setText(c, '.rom-step-why', st.why);
    const t = $('.rom-step-txt', c); t.classList.remove('rom-swap'); void t.offsetWidth; t.classList.add('rom-swap');
  });
});

// a prompt in his words: Hinge's card, with the agent's light feedback
const fbPill = (p) => (p.fb ? `<span class="rom-fb ${p.fb}">${I.sparkle}${esc(FB[p.fb][0])}</span>` : '');
const promptCard = (p, full = false) => `<button class="rom-pc surface ${full ? 'full' : ''}" data-act="rom-prompt" data-id="${p.id}">
    <span class="rom-pq">${esc(p.q)}</span><span class="rom-pa">${esc(p.a)}</span>${fbPill(p)}</button>`;

// getting ready lives in the other apps: their live status when they answer, a plain line until they do
const readyRow = (r) => {
  const a = aspect(r.id); const sm = summary(r.id);
  const live = sm?.line && sm.line !== a.line ? sm.line : r.fallback;
  return `<button class="row ic" data-act="rom-ready" data-id="${r.id}">${aspectTile(r.id)}<span class="rbody"><span class="rtitle">${esc(r.title)}</span><span class="rmeta"><span class="ell">${esc(live)}</span></span></span>${I.chevR}</button>`;
};
on('rom-ready', (el) => {
  const id = el.dataset.id; haptic(5);
  if (id === 'mind' && has('openScreenTime')) return api.openScreenTime();
  openAspect(id, undefined, { back: 'Romance' });
});

// ══ Looking for ═══════════════════════════════════════════════════════
function renderLooking(el, app) {
  const ps = prompts(); const answered = ps.filter((p) => p.a); const open = ps.filter((p) => !p.a); const L = looking();
  el.innerHTML = `
    ${aspHead(app, { kicker: lockKicker, title: 'Looking for', sub: `In your own words. ${esc(AGENT.name)} helps you say it clearly; she never rewrites it.` })}
    <div class="group"><button class="row ic" data-act="rom-intent"><span class="tile rom-tile">${I.target}</span><span class="rbody"><span class="rmeta rom-row-l">What you want</span><span class="rtitle wrap">${esc(L.intent ?? 'Not said yet')}</span></span>${I.chevR}</button></div>
    ${answered.length ? `${sectionHead('In your words', { count: `${answered.length} of ${ps.length}` })}
    <div class="rom-pcs">${answered.map((p) => promptCard(p, true)).join('')}</div>` : ''}
    ${open.length ? `${sectionHead(answered.length ? 'Still to answer' : 'Prompts', { count: open.length })}
    <div class="group">${open.map((p) => `<button class="row" data-act="rom-prompt" data-id="${p.id}"><span class="rbody"><span class="rtitle wrap">${esc(p.q)}</span></span>${I.chevR}</button>`).join('')}</div>` : ''}
    ${sectionHead('Must-haves', { count: L.must.length })}
    ${listGroup(L.must, 'must', I.check)}
    ${sectionHead('Green flags', { count: L.green.length })}
    ${listGroup(L.green, 'green', I.flag)}
    <div class="rom-gap"></div>
    ${wynCard({ text: 'Tell me what you’re looking for the way you’d tell a friend. I’ll put it in your words, then ask you one question.', acts: `<button class="btn sm" data-act="rom-ask" data-q="Help me put what I’m looking for into words">${I.mic}Talk it through</button>` })}`;
}
// a short list he keeps: one line each, and a way to add one
const listGroup = (items, k, icon) => `<div class="group rom-list">${items.map((c, i) => `<div class="row"><span class="rom-li">${icon}</span><span class="rbody"><span class="rtitle wrap">${esc(c)}</span></span><button class="rom-li-x" data-act="rom-chip-del" data-k="${k}" data-i="${i}" aria-label="Remove ${esc(c)}">${I.x}</button></div>`).join('')}
    <button class="row rom-list-add" data-act="rom-chip-add" data-k="${k}"><span class="rom-li">${I.plus}</span><span class="rbody"><span class="rtitle">Add one</span></span></button></div>`;
function openPromptSheet(id) {
  const p = prompts().find((x) => x.id === id); if (!p) return;
  const sh = romSheet({
    cls: 'rom-sheet rom-psheet', title: 'In your words', sub: 'Only you see this',
    body: `<div class="pad">
      <p class="rom-pq rom-pq-sheet">${esc(p.q)}</p>
      <label class="rom-ta"><span class="vh">${esc(p.q)}</span><textarea rows="4" placeholder="Say it the way you would to a friend">${esc(p.a)}</textarea></label>
      <div class="rom-fbox"${p.fb ? '' : ' hidden'}>${p.fb ? fbBox(p.fb, p.ask) : ''}</div>
      <p class="rom-cmp-foot">${I.sparkle}<span>${esc(AGENT.name)} gives light feedback in three steps, like a friend reading over your shoulder. She never changes your words.</span></p>
    </div>`,
    foot: `<div class="rom-sheet-foot"><button class="btn" data-act="rom-p-fb">${I.sparkle}Ask ${esc(AGENT.name)}</button><button class="btn primary block" style="--c:var(--as-fill)" data-act="rom-p-save">Save</button></div>`,
  });
  sh._rom = { p };
}
const fbBox = (fb, ask) => `<p class="rom-fb ${fb}">${I.sparkle}${esc(FB[fb][0])}</p><p class="rom-fbx">${esc(ask || FB[fb][1])}</p>`;
on('rom-prompt', (el) => openPromptSheet(el.dataset.id));
// on-device feedback (a length and specificity read; the agent's richer read is "Talk it through")
on('rom-p-fb', (el) => {
  const sh = el.closest('.sheet'); const { p } = sh._rom ?? {}; if (!p) return;
  const text = $('textarea', sh).value.trim(); const box = $('.rom-fbox', sh);
  box.hidden = false; box.innerHTML = `<p class="rom-fbx rom-reading"><span class="spin" style="--c:var(--as)"></span>Reading it</p>`;
  const fb = text.length < 40 ? 'deeper' : text.length < 70 && /\b(nice|good|kind|fun|chill)\b/i.test(text) ? 'small' : 'great';
  const ask = fb === 'deeper' ? 'What would that look like on an ordinary Tuesday?' : fb === 'small' ? 'One concrete detail would make it sound like you.' : 'Specific, and it sounds like you. Keep it.';
  setTimeout(() => { if (!box.isConnected) return; box.innerHTML = fbBox(fb, ask); sh._rom.fb = fb; sh._rom.ask = ask; haptic(6); }, 700);
});
on('rom-p-save', (el) => {
  const sh = el.closest('.sheet'); const st = sh._rom ?? {}; const p = st.p; if (!p) return;
  const text = $('textarea', sh).value.trim();
  if (!text) { $('textarea', sh).focus(); return; }
  const answers = { ...(looking().answers ?? {}) };
  answers[p.id] = { a: text, fb: st.fb ?? (p.a ? p.fb : null), ask: st.ask ?? (p.a ? p.ask : null), at: new Date().toISOString() };
  setLooking({ answers });
  closeSheet(sh); haptic(10);
  toast('Saved in your words');
});
on('rom-intent', () => {
  const opts = ['Something long-term, when it’s right', 'Open to seeing where it goes', 'Not looking right now'];
  const cur = looking().intent;
  romSheet({
    cls: 'rom-sheet', title: 'What you want', sub: `For you and ${esc(AGENT.name)}, nobody else`,
    body: `<div class="group">${opts.map((o) => `<button class="row" data-act="rom-intent-pick" data-v="${esc(o)}"><span class="rbody"><span class="rtitle">${esc(o)}</span></span>${o === cur ? `<span class="rom-pick">${I.check}</span>` : ''}</button>`).join('')}</div>`,
  });
});
on('rom-intent-pick', (el) => { setLooking({ intent: el.dataset.v }); closeSheet(); haptic(6); });
on('rom-chip-add', (el) => {
  const k = el.dataset.k;
  const sh = romSheet({
    cls: 'rom-sheet', title: k === 'must' ? 'A must-have' : 'A green flag', sub: 'A few words is enough',
    body: `<div class="pad"><label class="field"><span class="vh">New ${k === 'must' ? 'must-have' : 'green flag'}</span><input type="text" placeholder="${k === 'must' ? 'Wants a family one day' : 'Asks good questions'}" enterkeyhint="done"/></label></div>`,
    foot: `<div class="rom-sheet-foot"><button class="btn primary block" style="--c:var(--as-fill)" data-act="rom-chip-save">Add</button></div>`,
  });
  sh._rom = { k };
  requestAnimationFrame(() => $('input', sh)?.focus());
});
on('rom-chip-save', (el) => {
  const sh = el.closest('.sheet'); const { k } = sh._rom ?? {}; const v = $('input', sh).value.trim();
  if (!v) { $('input', sh).focus(); return; }
  const L = looking(); setLooking({ [k]: [...(L[k] ?? []), v] });
  closeSheet(sh); toast('Added');
});
on('rom-chip-del', (el) => {
  const k = el.dataset.k, i = Number(el.dataset.i); const L = looking(); const list = [...(L[k] ?? [])]; const [gone] = list.splice(i, 1);
  setLooking({ [k]: list }); haptic(6);
  toast('Removed', () => { const cur = [...(looking()[k] ?? [])]; cur.splice(i, 0, gone); setLooking({ [k]: cur }); });
});

// ══ Out there ═════════════════════════════════════════════════════════
const NUDGE = { sun: 'One nudge on Sunday at 18:00', weekend: 'Saturday and Sunday evenings', off: 'No nudges' };
function renderOut(el, app) {
  const ids = ideas(); const rs = reps();
  el.innerHTML = `
    ${aspHead(app, { kicker: lockKicker, title: 'Out there', sub: 'One small step a week. Reps, not results.' })}
    ${stepMini()}
    ${sectionHead('Ideas this week', { count: ids.length || null })}
    <div class="group rom-ideas-g">${ids.map(ideaRow).join('')}
      <button class="row ic" data-act="rom-ask" data-q="Find one thing near me this week where I could meet new people: a talk, a club, a college event"><span class="tile rom-tile">${I.sparkle}</span><span class="rbody"><span class="rtitle wrap">Find one thing near you this week</span><span class="rmeta"><span class="ell">${esc(AGENT.name)} looks for a talk, a club or an event</span></span></span>${I.chevR}</button></div>
    <div class="rom-gap"></div>
    <section class="rom-card surface rom-wq">
      <p class="rom-k c-as">This week’s question</p>
      <p class="rom-next-t">${esc(WEEK_PROMPT)}</p>
      <p class="sub">A line in your journal is enough. Nobody else sees it.</p>
      <div class="rom-row-btns"><button class="btn sm" data-act="rom-wprompt">${I.edit}Answer privately</button></div>
    </section>
    ${sectionHead('Reps', { count: rs.length ? `${rs.length}` : null })}
    ${rs.length ? `<div class="group">${rs.slice(0, 8).map((r) => logRow(r.day, r.text, r.step ? 'That week’s small step' : '', r.by)).join('')}</div>`
      : `<p class="note surface">A rep is any small social thing you did: stayed back after class, said yes to a plan. Log one, or tell ${esc(AGENT.name)}.</p>`}
    <div class="pad"><button class="btn block" data-act="rom-rep-add">${I.plus}Log a rep</button></div>
    ${sectionHead('Nudges')}
    <div class="group"><button class="row ic" data-act="rom-nudges"><span class="tile rom-tile">${I.clock}</span><span class="rbody"><span class="rtitle">${esc(NUDGE[prefs().nudge] ?? NUDGE.sun)}</span><span class="rmeta">Only if the week’s step is still open</span></span>${I.chevR}</button></div>
    <p class="hint">Romance never raises an alarm or calls you. A missed week is fine; you get one quiet week a month that keeps the streak.</p>`;
}
const ideaRow = (d) => `<div class="row ic rom-idea-r">
    <span class="tile rom-tile">${I[d.icon] ?? I.cal}</span>
    <span class="rbody"><span class="rtitle wrap">${esc(d.title)}</span><span class="rmeta"><span class="ell">${esc(d.when)} · ${esc(d.where)}</span></span><span class="rom-idea-why">${esc(d.why)}</span></span>
    <button class="btn sm" data-act="rom-idea" data-id="${d.id}" aria-label="${d.person ? `Open ${esc(P.nameOf(d.person) || 'them')} in Friends` : `Add ${esc(d.title)} to your calendar`}">${d.person ? 'Open' : 'Add'}</button></div>`;
on('rom-idea', (el) => {
  const d = ideas().find((x) => x.id === el.dataset.id); if (!d) return;
  haptic(6);
  if (d.person) return api.openPerson(d.person);
  if (has('addTask')) return api.addTask({ title: d.title, when: d.when, aspect: 'romance' });
  toast(`Pencilled in: ${d.title}, ${d.when}`);
});
on('rom-wprompt', () => openComposer({ prompt: WEEK_PROMPT }));
on('rom-rep-add', () => {
  const sh = romSheet({
    cls: 'rom-sheet', title: 'A rep', sub: 'Any small social thing you did. Only you see it.',
    body: `<div class="pad"><label class="field"><span class="vh">What you did</span><input type="text" maxlength="120" placeholder="Stayed back after class and talked to two people" enterkeyhint="done"/></label></div>`,
    foot: `<div class="rom-sheet-foot"><button class="btn primary block" style="--c:var(--as-fill)" data-act="rom-rep-save">Log it</button></div>`,
  });
  requestAnimationFrame(() => $('input', sh)?.focus());
});
on('rom-rep-save', (el) => {
  const sh = el.closest('.sheet'); const v = $('input', sh).value.trim();
  if (!v) { $('input', sh).focus(); return; }
  const j = P.add('journal', { date: P.today(), at: P.nowHm(), kind: 'rep', by: 'you', source: 'you', text: v });
  closeSheet(sh); haptic(10); toast('Rep logged', () => P.remove('journal', j.id));
});
on('rom-nudges', () => {
  const cur = prefs().nudge;
  romSheet({
    cls: 'rom-sheet', title: 'Nudges', sub: 'Gentle, and only when the step is open',
    body: `<div class="group">${Object.entries(NUDGE).map(([k, v]) => `<button class="row" data-act="rom-nudge-pick" data-v="${k}"><span class="rbody"><span class="rtitle">${esc(v)}</span></span>${cur === k ? `<span class="rom-pick">${I.check}</span>` : ''}</button>`).join('')}</div>
      <div class="pad rom-sheet-end"><button class="btn block" data-act="rom-nudge-try">${I.sparkle}Show me Sunday’s nudge</button></div>`,
  });
});
on('rom-nudge-pick', (el) => { P.setState('romance', { nudge: el.dataset.v }); closeSheet(); haptic(6); });
on('rom-nudge-try', () => {
  closeSheet();
  const text = `This week’s small step is still open: ${currentStep().text.toLowerCase()}. No pressure if it’s a quiet week.`;
  setTimeout(() => { if (has('agentSay')) api.agentSay(text, { aspect: 'romance', kind: 'nudge', preview: true }); else toast('Sunday 18:00 · one small step is still open'); }, 300);
});

// ══ Journal ═══════════════════════════════════════════════════════════
function renderJournal(el, app) {
  const ns = notes(); const pts = patterns(); const pf = prefs();
  const byWyn = ns.filter((n) => n.by !== 'me').length;
  el.innerHTML = `
    ${aspHead(app, { kicker: lockKicker, title: 'Journal', sub: `Only you read this. ${esc(AGENT.name)} reads it to notice patterns, nothing more.` })}
    ${pf.patterns ? (pts.length ? `<section class="rom-card surface rom-pat">
      <p class="rom-card-h"><span class="rom-k c-as">What ${esc(AGENT.name)} notices</span><span class="rom-k">${esc(P.fmtDay(P.today(), { month: 'long' }))}</span></p>
      ${pts.map(([t, sub]) => `<div class="rom-pat-r"><p class="rom-pat-t">${esc(t)}</p><p class="sub">${esc(sub)}</p></div>`).join('')}
      <div class="rom-stats">
        <span><b class="met">${ns.length}</b>notes</span><span><b class="met">${byWyn}</b>filed by ${esc(AGENT.name)}</span><span><b class="met">${reps().length}</b>reps</span>
      </div>
    </section>` : `<p class="note surface">Once there are a few notes, ${esc(AGENT.name)} tells you what she notices here. Only patterns from your own words, nothing guessed.</p>`)
      : `<p class="note">${esc(AGENT.name)} isn’t reading your notes for patterns. <button class="rom-link" data-act="rom-privacy">Change in Privacy</button></p>`}
    ${sectionHead('Recent', { count: ns.length })}
    ${ns.length ? `<div class="rom-entries">${ns.map(entryCard).join('')}</div>` : `<p class="note surface">Nothing here yet. The round button writes a private note; you can also say it, and ${esc(AGENT.name)} files it here.</p>`}`;
  stagger($$('.rom-entry', el).slice(0, 5), { y: 8, each: 45, delay: 80 });
}

// ══ shared actions ════════════════════════════════════════════════════
on('rom-go', (el) => { S.app?.go(el.dataset.s); S.app && (S.app.scroll.scrollTop = 0); });
on('rom-ask', (el) => api.askAgent(el.dataset.q ?? '', { aspect: 'romance', ...(el.dataset.about ? { about: el.dataset.about } : {}) }));
on('rom-preview', () => switchTo('couple'));
on('rom-quick-note', () => openComposer());

// a chat screenshot from the one Scan button lands here privately
function handleChat(result = {}) {
  const f = result.fields ?? result;
  if (S.mode === 'couple') { toast('Exit the preview first: your chats go to your own journal'); return null; }
  const j = P.add('journal', { date: P.today(), at: P.nowHm(), kind: 'note', by: 'wyn', source: 'chat', src: f.app ?? 'Chat', text: f.text ? `From the chat: “${String(f.text).slice(0, 600)}”` : 'A chat you shared, filed privately.' });
  toast('Filed privately in Romance', () => P.remove('journal', j.id));
  return j;
}

// redraw what's open when his data changes (another device, the agent), unless it's this screen's own animated change
P.onPeople(({ kinds }) => {
  if (quiet || S.mode === 'couple' || !S.app?.page?.isConnected) return;
  if (!kinds.has('journal') && !kinds.has('state') && !kinds.has('plans')) return;
  for (const sid of ['home', 'looking', 'out', 'journal']) refreshIfBuilt(sid);
});

// ══ the two states, and switching between them in place ═══════════════
const SINGLE = [
  { id: 'home', label: 'Home', icon: I.heart, render: renderHome },
  { id: 'looking', label: 'Looking for', icon: R.want, render: renderLooking },
  { id: 'out', label: 'Out there', icon: R.out, render: renderOut },
  { id: 'journal', label: 'Journal', icon: I.book, render: renderJournal },
];
const COUPLE = [
  { id: 'us', label: 'Us', icon: I.heart, render: renderUs },
  { id: 'dates', label: 'Dates', icon: I.cal, render: renderDates },
  { id: 'checkin', label: 'Check-in', icon: R.talk, render: renderCheckin },
  { id: 'moments', label: 'Moments', icon: R.moments, render: renderMoments },
];
// #romance/us, #romance/dates, #romance/checkin, #romance/moments and #romance/preview open the preview
{
  const [head, sub] = decodeURIComponent(location.hash.replace(/^#/, '')).split('/');
  if (head === 'romance' && (sub === 'preview' || COUPLE.some((c) => c.id === sub))) S.mode = 'couple';
}
function switchTo(mode) {
  const old = S.app?.page;
  if (!old?.isConnected || mode === S.mode) { S.mode = mode; return; }
  const back = old._opts?.back ?? 'Life';
  S.mode = mode; haptic(10);
  const app = openAspect('romance', undefined, { back });
  const pg = app?.page; if (!pg) return;
  // the new state arrives where the old one was: a crossfade, no slide
  pg.style.transition = 'none'; pg.style.transform = 'none'; pg.style.opacity = '0';
  requestAnimationFrame(() => requestAnimationFrame(() => { pg.style.transition = 'opacity 280ms var(--ease)'; pg.style.opacity = '1'; }));
  setTimeout(() => { old.remove(); pg.style.transition = ''; pg.style.transform = ''; pg.style.opacity = ''; }, 340);
  toast(mode === 'couple' ? 'Preview with sample data' : 'Back to your Romance');
}
setSwitcher(switchTo);

registerAspect({
  id: 'romance',
  get sections() { return S.mode === 'couple' ? COUPLE : SINGLE; },
  get start() { return S.mode === 'couple' ? 'us' : 'home'; },
  get primary() {
    return S.mode === 'couple'
      ? { label: 'Log a moment', icon: I.plus, run: () => openComposer({ kind: 'moment' }) }
      : { label: 'Write a private note', icon: I.edit, run: () => openComposer() };
  },
  // read by Home, Life and the agent: always his real state, and never more than a gentle line
  summary() {
    const quick = [{ label: 'Private note', icon: I.edit, act: 'rom-quick-note' }];
    if (!prefs().onToday) return { line: 'Private', quick };
    const done = !!stepState().done; const st = currentStep(); const str = streak();
    return {
      line: done ? 'This week’s small step is done' : `One small step this week: ${st.text.charAt(0).toLowerCase()}${st.text.slice(1)}`,
      metric: { v: done ? 1 : 0, unit: 'of 1', label: 'step this week', p: done ? 1 : 0 },
      today: [],
      streak: { n: str.n + (done ? 1 : 0), label: 'weeks with a small step', atRisk: false },
      next: null,
      quick,
    };
  },
  scan: [{ kind: 'chat', label: 'Chat screenshot', hint: 'Files it privately in Romance', handle: handleChat }],
  tools: TOOLS,
  // the Brain's openPerson hands over here; the only romance person in the preview is its sample partner
  person(id) { if (id === PARTNER.id || id === 'partner') { openPartner(); return true; } return false; },
  onOpen(app) {
    S.app = app;
    mountLock(app);
    // leaving the app returns it to his real state; switching states replaces the page without a pop
    queueMicrotask(() => { if (app.page?._opts) app.page._opts.onPop = () => { if (S.app === app) { S.mode = 'single'; S.app = null; } }; });
  },
});

// logRomance({ text, prompt, kind }) opens the composer; { file: true, text, feel } is the agent filing a private note
provide('logRomance', (prefill = {}) => {
  if (!prefill.file) return openComposer(prefill);
  const j = P.add('journal', { date: P.today(), at: P.nowHm(), kind: prefill.kind === 'rep' ? 'rep' : 'note', feel: prefill.feel ?? null, by: 'wyn', source: prefill.from ?? 'said', text: String(prefill.text ?? '').slice(0, 4000) });
  if (!prefill.silent) toast(`${AGENT.name} filed it privately in Romance`, () => P.remove('journal', j.id));
  return j;
});


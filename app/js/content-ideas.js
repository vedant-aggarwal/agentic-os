// Content OS · Ideas: the inbox (radar, your work, reels you shared, your own), the swipe deck that sorts new ideas
// (keep or kill: each verdict feeds the learning loop), an idea's page (the agent's score, its reasons, research,
// the hook it drafted, the reference reel) and the two ways in: the + sheet and a reel shared in from Scan.
// Real mode: every verdict and capture is an op the PC applies once (content-data.js send); the deck walks the inbox the
// way the nightly plan scores it, and what he kills marks lookalikes down from then on.
import { $, $$, esc, on, push, pop, openSheet, closeSheet, toast, haptic, ring, pulse } from './core.js';
import { I } from './icons.js';
import { AGENT } from './data.js';
import { api } from './bus.js';
import { S, CI, SRC, IDEA_WORD, inCh, idea, newIdeas, toSortCount, srcSentence, route, go, redraw, onRedraw, head, askBtn, bar, chAv, chDot, chOf, cover, word, plural, CHS, REAL, META, keepInputs, enter } from './content-ui.js';
import { RADAR, send, opOf, refresh, coverOf } from './content-data.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const scoreRing = (x, size = 34, w = 3.5) => (x.score == null
  ? ring(0, 'content', size, w, { inner: '<b class="met ct-score-n">–</b>', label: 'Not scored yet' })
  : ring(x.score / 10, 'content', size, w, { inner: `<b class="met ct-score-n">${x.score.toFixed(1)}</b>`, label: `Scored ${x.score.toFixed(1)} of 10` }));
const srcOf = (x) => SRC[x.source] ?? SRC.you;
// a reference card's cover: its hook in two lines (the reel itself stays on the PC)
const refLines = (h) => String(h ?? '').split(/,|\.|\?/).map((t) => t.trim()).filter(Boolean).slice(0, 2);
const refCover = (x, w, label = '') => cover(x.ref?.hook ? { lines: refLines(x.ref.hook), hi: 0, scene: x.ch === '@example_creator' ? (x.id === 'c8' ? 'card' : 'coin') : 'agents' } : coverOf(x.title), { ch: x.ch, w, label });

// ── the ideas page ──────────────────────────────────────────────────────
let IP = null;                     // the open ideas page: { page, sc }
const FILTERS = [['all', 'All'], ['radar', 'Radar'], ['work', 'Your work'], ['reel', 'Shared'], ['agent', 'Research'], ['you', 'Yours']];
let filt = 'all';
function openIdeas() {
  const page = push({ title: 'Ideas', back: 'Content', right: askBtn(), cls: 'ct-page', render(sc) { IP = { sc }; drawIdeas(); enter(sc); } });
  IP.page = page;
  const off = onRedraw(() => { if (IP?.page === page && page.isConnected) keepInputs(IP.sc, drawIdeas); });
  page._opts.onPop = () => { off(); IP = null; };
}
route('ideas', openIdeas);

function ideaRow(x) {
  const src = srcOf(x);
  return `<button class="row ic ct-irow" data-act="ct-idea" data-id="${esc(x.id)}" ${x.pending ? 'data-pending="1"' : ''}>
    <span class="tile ct-srct" style="--t:${chOf(x.ch).tint}">${src.icon}</span>
    <span class="rbody">
      <span class="rtitle wrap">${esc(x.title)}</span>
      <span class="rmeta">${x.pending ? word('Saving', 'var(--content-ink)', true) : IDEA_WORD[x.status]?.() ?? ''}<span>·</span>${chDot(x.ch)}<span class="ell">${esc(x.ch)} · ${esc(src.label)}</span></span>
    </span>
    <span class="ct-score">${scoreRing(x)}</span>
  </button>`;
}
function drawIdeas() {
  if (!IP) return;
  const all = S.ideas.filter((x) => x.status !== 'killed' && inCh(x));
  const isSrc = (x, v) => v === 'all' || x.source === v || (v === 'reel' && x.source === 'link') || (v === 'agent' && x.source === 'email');   // Shared holds reels and links
  const list = all.filter((x) => isSrc(x, filt));
  const fresh = newIdeas();
  const nFresh = toSortCount();
  const by = (st) => list.filter((x) => st.includes(x.status));
  const nNew = by(['new']).slice(0, 60), nKept = by(['kept']), nIn = by(['writing', 'scripted', 'shot', 'edited', 'scheduled']).slice(0, 40);
  const filters = FILTERS.filter(([v]) => !(v === 'agent' && !REAL));
  IP.sc.innerHTML = `${head({ title: 'Ideas', sub: `${nFresh} new · ${S.ideas.filter((x) => x.status === 'kept' && inCh(x)).length} kept · ${S.ideas.filter((x) => ['writing', 'scripted'].includes(x.status) && inCh(x)).length} in scripts` })}
    ${nFresh ? `<button class="ct-sortcard surface" data-act="ct-triage">
      <span class="ct-sort-stack" aria-hidden="true"><i></i><i></i><i>${CI.swipe}</i></span>
      <span class="ct-sort-t"><b>${plural(nFresh, 'new idea')} to sort</b><span class="foot">${esc(srcSentence(fresh))} ${REAL && nFresh > fresh.length ? `The best ${fresh.length} first. ` : ''}Keep or kill each one; ${esc(AGENT.name)} learns from both.</span></span>
      ${I.chevR}
    </button>` : `<div class="note ct-allsorted">${CI.keep}<span>Every new idea is sorted. The plan runs again at 02:30.</span></div>`}
    <form class="ct-add" data-ct-form="idea">
      <label class="field ct-field">${I.bulb}<input id="ctIdea" type="text" placeholder="An idea, or paste a reel link" enterkeyhint="done" autocomplete="off" aria-label="New idea" /></label>
      <button class="btn ct-addbtn" type="submit">Add</button>
    </form>
    <div class="chips ct-filters" role="group" aria-label="Filter ideas by source">${filters.map(([v, l]) => { const n = all.filter((x) => isSrc(x, v)).length; return n || v === 'all' ? `<button class="chip sm ${filt === v ? 'on' : ''}" data-act="ct-ifilt" data-v="${v}" aria-pressed="${filt === v}">${l}<span class="ct-chip-n num">${n}</span></button>` : ''; }).join('')}</div>
    ${nNew.length ? `<div class="sh"><h2>New</h2><span class="sh-count">${REAL && S.ch === 'all' && filt === 'all' ? nFresh : nNew.length}</span></div><div class="group">${nNew.map(ideaRow).join('')}</div>` : ''}
    ${nKept.length ? `<div class="sh"><h2>Kept</h2><span class="sh-count">${nKept.length}</span></div><div class="group">${nKept.map(ideaRow).join('')}</div><p class="hint">${esc(AGENT.name)} writes scripts for kept ideas in tonight's plan at 02:30.</p>` : ''}
    ${nIn.length ? `<div class="sh"><h2>In scripts</h2><span class="sh-count">${nIn.length}</span></div><div class="group">${nIn.map(ideaRow).join('')}</div>` : ''}
    ${!list.length ? `<div class="note">${S.ideas.length ? `No ideas from ${esc(filters.find(([v]) => v === filt)?.[1] ?? '')} yet.` : 'No ideas yet. Type one above, share a reel from Instagram, or let the nightly plan bring some.'}</div>` : ''}
    <div class="sh"><h2>Where ideas come from</h2></div>
    <div class="group">
      ${REAL ? `<div class="row ic"><span class="tile">${I.radar}</span><span class="rbody"><span class="rtitle">Radar and research</span><span class="rmeta"><span class="ell">${RADAR.last ? `Swept at ${RADAR.last} today` : 'Filed by content-os and the nightly plan'}${RADAR.filed ? ` · ${RADAR.filed} new today` : ''}</span></span></span></div>
        ${RADAR.sources.map(([n, c]) => `<div class="row ic"><span class="tile">${n.startsWith('Reels') ? CI.bookmark : I.hammer}</span><span class="rbody"><span class="rtitle">${esc(n)}</span><span class="rmeta">${c != null ? `${plural(c, 'reference card')} so far` : 'Read at 21:30 each night'}</span></span></div>`).join('')}
        <div class="row ic"><span class="tile">${I.share}</span><span class="rbody"><span class="rtitle">Share a reel from Instagram</span><span class="rmeta">The share sheet files it here; your PC writes its card</span></span></div>`
      : `<div class="row ic"><span class="tile">${I.radar}</span><span class="rbody"><span class="rtitle">Radar</span><span class="rmeta"><span class="ell">Ran ${RADAR.last} · read ${RADAR.read} videos · filed ${RADAR.filed}</span></span></span></div>
        ${RADAR.sources.map(([n, c]) => `<div class="row ic"><span class="tile">${n.startsWith('YouTube') ? I.globe : n.startsWith('Saved') ? CI.bookmark : I.hammer}</span><span class="rbody"><span class="rtitle">${esc(n)}</span>${c != null ? `<span class="rmeta">${c} followed</span>` : `<span class="rmeta">Mined at 21:30 each night</span>`}</span></div>`).join('')}
        <button class="row ic" data-act="ct-share-demo"><span class="tile">${I.share}</span><span class="rbody"><span class="rtitle">Share a reel from Instagram</span><span class="rmeta">It lands here as a card with its hook and structure</span></span>${I.chevR}</button>`}
    </div>`;
  pulse(IP.sc);
}
on('ct-ifilt', (el) => { filt = el.dataset.v; drawIdeas(); haptic(5); });
on('ct-idea', (el) => { if (el.dataset.pending) { toast('Saving to your PC; it opens once it lands'); return; } openIdea(el.dataset.id); });
on('ct-share-demo', () => api.openShareIn({ kind: 'reel', url: 'https://www.instagram.com/reel/DQx7Lm2kP', platform: 'instagram', title: 'A pen spun into a coin, one take', why: 'The trick happens in the first second' }));

// the inline field: a link becomes a shared reel, anything else your own idea
document.addEventListener('submit', (e) => {
  const f = e.target.closest?.('[data-ct-form="idea"]'); if (!f) return;
  e.preventDefault();
  const inp = $('#ctIdea', f); const v = inp?.value.trim();
  if (!v) { inp?.focus(); return; }
  const link = /https?:\/\/|instagram\.com|youtu/i.test(v);
  if (link) { inp.value = ''; addContentIdea({ url: v, platform: /youtu/i.test(v) ? 'youtube' : 'instagram' }); return; }
  const ch = S.ch === 'all' ? '@northwindstudio' : S.ch;
  if (REAL) send('capture', { text: v, channel: ch });
  else S.ideas.unshift({ id: `c${Date.now()}`, title: v, ch, source: 'you', status: 'new', score: 6.5, at: 'Now', from: 'You typed it just now', why: [['+', 'You wrote it yourself'], ['+', 'Fresh today']] });
  inp.value = '';
  redraw('ideas'); haptic(8); toast(REAL ? 'Saved to Ideas · scored in tonight\'s plan' : 'Idea saved to New');
});

// ── an idea's page ───────────────────────────────────────────────────────
function openIdea(id) {
  const x = idea(id); if (!x) { if (REAL) toast('That idea isn\'t loaded on this phone yet'); return; }
  const page = push({ title: 'Idea', back: IP ? 'Ideas' : 'Content', right: askBtn(), cls: 'ct-page has-bar',
    render(sc, pg) { pg._ct = id; drawIdea(sc, pg); enter(sc); } });
  const off = onRedraw(() => { if (page.isConnected) drawIdea($('.scroll', page), page); });
  page._opts.onPop = off;
}
route('idea', openIdea);

function drawIdea(sc, page) {
  const x = idea(page._ct); if (!x) return;
  const src = srcOf(x), c = chOf(x.ch);
  const why = (x.why ?? []).map(([sgn, t]) => `<li class="${sgn === '−' ? 'neg' : 'pos'}"><span class="ct-sgn" aria-label="${sgn === '−' ? 'lowers' : 'raises'} the score">${sgn === '−' ? '−' : '+'}</span>${esc(t)}</li>`).join('');
  const ref = x.ref ? `<div class="sh"><h2>${x.ref.views ? 'The reel it came from' : REAL ? 'The reference card' : 'What you saved'}</h2></div>
    <div class="group ct-ref">
      <div class="ct-ref-top">${refCover(x, 64, 'The reference reel')}
        <div class="ct-ref-s">${x.ref.views ? `<b class="met">${esc(x.ref.views)}</b><span class="foot">views in ${esc(x.ref.age)}</span>` : `<b>${REAL ? (x.ref.basis === 'transcript' ? 'Read from its transcript' : 'Read from its caption') : 'A link you saved'}</b>`}<span class="foot">${esc((x.from ?? '').split(' · ')[0])}</span></div></div>
      <dl class="ct-dl">
        ${x.ref.hook ? `<div><dt>Hook</dt><dd>“${esc(x.ref.hook)}”</dd></div>` : ''}
        ${x.ref.structure ? `<div><dt>Structure</dt><dd>${esc(x.ref.structure)}</dd></div>` : ''}
        ${x.ref.format ? `<div><dt>Format</dt><dd>${esc(x.ref.format)}</dd></div>` : ''}
        ${x.ref.why ? `<div><dt>Why it works</dt><dd>${esc(x.ref.why)}</dd></div>` : ''}
        ${x.ref.useFor ? `<div><dt>For you</dt><dd>${esc(x.ref.useFor)}</dd></div>` : ''}
        ${x.ref.note ? `<div><dt>Your note</dt><dd>${esc(x.ref.note)}</dd></div>` : ''}
      </dl>
    </div>` : '';
  const notes = REAL && (x.evidence || x.skeleton?.length || x.note) ? `<div class="sh"><h2>${x.evidence ? 'From your work' : 'Notes'}</h2></div>
    <section class="surface ct-hookcard">
      ${x.evidence ? `<p class="ct-fl">${I.hammer}<span><b>Evidence:</b> ${esc(String(x.evidence).slice(0, 400))}</span></p>` : ''}
      ${x.skeleton?.length ? `<ol class="ct-skel-l">${x.skeleton.map((l) => `<li>${esc(l)}</li>`).join('')}</ol>` : x.note ? `<p class="ct-note-t">${esc(String(x.note).slice(0, 600))}</p>` : ''}
      ${x.link ? `<p class="ct-fl">${I.link}<span class="ell">${esc(x.link.replace(/^https?:\/\//, '').slice(0, 60))}</span></p>` : ''}
    </section>` : '';
  const st = x.status;
  const scriptCode = x.script ?? x.take;
  const acts = st === 'new' ? `<button class="btn ct-kill" data-act="ct-iv" data-v="kill" data-id="${x.id}">${CI.kill}Kill</button><button class="btn" data-act="ct-iv" data-v="keep" data-id="${x.id}">${CI.keep}Keep</button><button class="btn primary" style="--c:var(--content-fill)" data-act="ct-iv" data-v="script" data-id="${x.id}">${I.sparkle}Script it</button>`
    : st === 'kept' ? `<button class="btn ct-kill" data-act="ct-iv" data-v="kill" data-id="${x.id}">${CI.kill}Kill</button><button class="btn primary block" style="--c:var(--content-fill)" data-act="ct-iv" data-v="script" data-id="${x.id}">${I.sparkle}Write the script now</button>`
    : st === 'writing' ? `<span class="ct-bar-note">${word(`${AGENT.name} is writing ${x.take ?? 'the script'}`, 'var(--content-ink)', true)}</span>`
    : ['scripted', 'shot', 'edited', 'scheduled', 'posted'].includes(st) && scriptCode ? `<button class="btn primary block" style="--c:var(--content-fill)" data-act="ct-open-script" data-code="${esc(scriptCode)}">${I.doc}Open script ${esc(x.take ?? '')}</button>`
    : st === 'killed' ? `<button class="btn block" data-act="ct-iv" data-v="restore" data-id="${x.id}">${I.undo}Bring it back</button>`
    : `<span class="ct-bar-note">${IDEA_WORD[st]?.() ?? ''}</span>`;
  sc.innerHTML = `<div class="phead ct-ihead">
      <p class="ct-ichan">${chAv(x.ch)}<span>${esc(x.ch)}</span><span class="ct-sep">·</span><span class="ct-isrc">${src.icon}${esc(src.label)}</span></p>
      <h1 class="title1">${esc(x.title)}</h1>
      <p class="sub">${IDEA_WORD[st]?.() ?? ''} · ${esc(x.from ?? '')}</p>
    </div>
    <section class="surface ct-why-card">
      <div class="ct-why-h">${scoreRing(x, 64, 6)}<div>${x.score != null ? `<b>${REAL ? `Why it scores ${x.score.toFixed(1)}` : `Why ${esc(AGENT.name)} rates it ${x.score.toFixed(1)}`}</b><span class="foot">Scored against what you kept, killed${REAL ? ', how fresh it is and what already exists' : ' and what got watched'} on ${esc(c.short)}</span>`
        : `<b>Not scored yet</b><span class="foot">The nightly plan scores it at 02:30, with its reasons</span>`}</div></div>
      ${why ? `<ul class="ct-why">${why}</ul>` : ''}
    </section>
    ${x.hook ? `<div class="sh"><h2>${REAL ? 'The hook' : `The hook ${esc(AGENT.name)} drafted`}</h2></div>
    <section class="surface ct-hookcard">
      <p class="ct-hookq">“${esc(x.hook)}”</p>
      ${x.proof ? `<p class="ct-fl">${I.eye}<span><b>First 3 seconds:</b> ${esc(x.proof)}</span></p>` : ''}
      ${x.angle ? `<p class="ct-fl">${I.compass}<span><b>Angle:</b> ${esc(x.angle)}</span></p>` : ''}
    </section>` : ''}
    ${notes}
    ${ref}
    <div class="sh"><h2>Channel</h2></div>
    <div class="group">${CHS.map((k) => `<button class="row ct-chpick" data-act="ct-ich" data-id="${x.id}" data-ch="${k.id}" aria-pressed="${x.ch === k.id}">${chAv(k.id)}<span class="rbody"><span class="rtitle">${esc(k.id)}</span><span class="rmeta"><span class="ell">${esc(k.focus)}</span></span></span>${x.ch === k.id ? `<span class="ct-tick">${I.check}</span>` : ''}</button>`).join('')}</div>
    ${bar(acts, `ct-bar-${st}`)}`;
  pulse(sc);
}
on('ct-ich', (el) => {
  const x = idea(el.dataset.id); if (!x || x.ch === el.dataset.ch) return;
  if (REAL) send('idea', { idea: x.id, channel: el.dataset.ch });
  else x.ch = el.dataset.ch;
  haptic(6); redraw('ideas'); toast(`Moved to ${el.dataset.ch}`);
});
on('ct-open-script', (el) => go('script', el.dataset.code));

// one verdict, from the idea page or the deck: keep · kill · script · restore. Real: an op (undo is a restore op).
let nextCode = 5;
const STATUS_BACK = { new: 'inbox', kept: 'picked', scripted: 'scripted', killed: 'dropped' };
export function verdict(id, v, { quiet = false, why = null, was: before = null, undo: undoOp = null } = {}) {
  // real: the PC may already have moved it out of the loaded lists (a kill drops it from the inbox); the op still goes
  const x = idea(id) ?? (REAL ? DK?.snap?.get(id) ?? null : null); if (!x) return null;
  const was = before ?? x.status;
  let undo, op = null;
  if (REAL) {
    // restore: back to the status before the verdict (the caller knows it), removing that verdict's learning row
    op = send('verdict', { idea: id, v, why, was: STATUS_BACK[was] ?? 'inbox', ...(v === 'restore' && undoOp ? { undo: undoOp } : {}) });
    undo = v === 'restore' ? null : () => { send('verdict', { idea: id, v: 'restore', was: STATUS_BACK[was] ?? 'inbox', undo: op?.id }); redraw('ideas'); };
  } else {
    if (v === 'keep') x.status = 'kept';
    if (v === 'kill') x.status = 'killed';
    if (v === 'restore') x.status = 'new';
    if (v === 'script') {
      x.status = 'writing'; x.take = x.take ?? `R${nextCode++}`;
      const code = x.take;
      S.scripts[code] = S.scripts[code] ?? { idea: x.id, ch: x.ch, setup: x.ch === '@example_creator' ? 1 : 0, status: 'writing', title: x.title, progress: 1, of: 4,
        hooks: [x.hook ?? x.title], beats: [{ k: 'Proof', say: [x.angle ?? 'Show it on screen first.'], show: x.proof ?? 'Screen first' }], cta: 'Follow for part two.', checks: [] };
      setTimeout(() => {
        x.status = 'scripted';
        const sc = S.scripts[code]; if (sc) { sc.status = 'ready'; sc.checks = [['ok', 'Hook lands in 2 seconds'], ['ok', 'Proof on screen first'], ['ok', 'Nothing promised in the CTA']]; }
        redraw('ideas');
        if (!quiet) toast(`${code} is written: “${x.title.slice(0, 28)}${x.title.length > 28 ? '…' : ''}”`);
      }, 2600);
    }
    if (v !== 'restore') S.verdicts.unshift({ at: 'Now', title: x.title, v: v === 'script' ? 'keep' : v, why });
    undo = () => { x.status = was; S.verdicts.shift(); redraw('ideas'); };
  }
  redraw('ideas');
  if (!quiet) {
    haptic(v === 'kill' ? 12 : 8);
    toast(v === 'kill' ? 'Killed. Fewer like this.' : v === 'keep' ? 'Kept for tonight\'s plan' : v === 'script' ? `${AGENT.name} is writing ${REAL ? 'it' : x.take}` : 'Back in New', v === 'restore' ? null : undo);
  }
  return op;
}
on('ct-iv', (el) => verdict(el.dataset.id, el.dataset.v));

// ── the swipe deck: sort every new idea in one sitting ───────────────────
let DK = null;
const WHY_NOT = ['Not my voice', 'Done before', 'Weak hook', 'Wrong channel', 'Old news'];
function openTriage() {
  const list = newIdeas().filter((x) => !x.pending).map((x) => x.id);
  if (!list.length) { toast(REAL && META.deckCount ? 'Loading the next ideas from your PC' : 'Nothing new to sort'); if (REAL && META.deckCount) refresh({ force: true }); return; }
  if (DK) closeDeck(true);
  const el = document.createElement('div');
  el.className = 'ct-deck';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Sort new ideas');
  $('#phone').append(el);
  DK = { el, list, i: 0, tally: { keep: 0, kill: 0, script: 0 }, hist: [], busy: false, lastKill: null, held: null, total: REAL && S.ch === 'all' ? Math.max(list.length, META.deckCount) : list.length,
    snap: new Map(list.map((id) => [id, { ...idea(id) }])) };   // the cards as dealt, while the PC moves the real ones
  drawDeck();
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  haptic(8);
}
route('triage', openTriage);
on('ct-triage', openTriage);

function cardHtml(x, depth) {
  const src = srcOf(x);
  return `<article class="ct-card" data-id="${esc(x.id)}" data-d="${depth}" style="--d:${depth}" ${depth ? 'aria-hidden="true"' : ''}>
    <header class="ct-card-h">${chAv(x.ch)}<span class="ct-card-ch">${esc(x.ch)}</span><span class="ct-card-src">${src.icon}${esc(src.label)}</span></header>
    <div class="ct-card-score">${scoreRing(x, 52, 5)}</div>
    <h2 class="ct-card-t">${esc(x.title)}</h2>
    ${x.hook && x.hook !== x.title ? `<p class="ct-card-hook">“${esc(x.hook)}”</p>` : ''}
    <ul class="ct-why ct-card-why">${(x.why ?? []).slice(0, 4).map(([sgn, t]) => `<li class="${sgn === '−' ? 'neg' : 'pos'}"><span class="ct-sgn">${sgn === '−' ? '−' : '+'}</span>${esc(t)}</li>`).join('')}</ul>
    ${x.angle || x.proof ? `<div class="ct-card-plan">
      ${x.proof ? `<p class="ct-fl">${I.eye}<span><b>First 3 seconds:</b> ${esc(x.proof)}</span></p>` : ''}
      ${x.angle ? `<p class="ct-fl">${I.compass}<span><b>Angle:</b> ${esc(x.angle)}</span></p>` : ''}
    </div>` : ''}
    <footer class="ct-card-f">${x.ref ? refCover(x, 40) : `<span class="tile">${srcOf(x).icon}</span>`}<span class="ct-card-from"><b>${esc(srcOf(x).label)}</b><span class="foot">${esc(x.from ?? '')}</span></span></footer>
    <span class="ct-stamp keep" aria-hidden="true">Keep</span><span class="ct-stamp kill" aria-hidden="true">Kill</span><span class="ct-stamp script" aria-hidden="true">Script it</span>
  </article>`;
}
function drawDeck() {
  const d = DK; if (!d) return;
  const left = d.list.slice(d.i);
  const done = !left.length;
  const many = d.list.length > 12;
  d.el.innerHTML = `
    <div class="ct-deck-top">
      <button class="gbtn chrome icon" data-act="ct-dk-close" aria-label="Close">${I.x}</button>
      <div class="ct-deck-ttl"><b>Sort new ideas</b>${many ? `<span class="ct-deck-n num" aria-live="polite">${Math.min(d.i + 1, d.list.length)} of ${d.total}</span><span class="ct-deck-bar" aria-hidden="true"><i style="--k:${(d.i / d.list.length).toFixed(3)}"></i></span>`
        : `<span class="ct-deck-dots" aria-label="${Math.min(d.i + 1, d.list.length)} of ${d.list.length}">${d.list.map((_, k) => `<i class="${k < d.i ? 'done' : k === d.i ? 'on' : ''}"></i>`).join('')}</span>`}</div>
      <button class="gbtn chrome icon" data-act="ct-dk-undo" aria-label="Undo the last one" ${d.hist.length && !done ? '' : 'disabled'}>${I.undo}</button>
    </div>
    <div class="ct-deck-stack" data-scroll-x>${done ? deckEnd() : left.slice(0, 3).map((id, k) => cardHtml(d.snap.get(id) ?? idea(id) ?? { id, title: '', ch: '@northwindstudio' }, k)).reverse().join('')}</div>
    ${done ? '' : `<div class="ct-deck-why" ${d.lastKill ? '' : 'hidden'}>
        <span class="foot">Why not? It teaches ${esc(AGENT.name)}.</span>
        <div class="chips">${WHY_NOT.map((w) => `<button class="chip sm" data-act="ct-dk-why" data-v="${esc(w)}">${esc(w)}</button>`).join('')}</div>
      </div>
      <div class="ct-deck-acts">
        <button class="ct-dk-btn kill" data-act="ct-dk" data-v="kill" aria-label="Kill this idea">${CI.kill}</button>
        <button class="ct-dk-btn script" data-act="ct-dk" data-v="script" aria-label="Script it now">${CI.pen}</button>
        <button class="ct-dk-btn keep" data-act="ct-dk" data-v="keep" aria-label="Keep this idea">${CI.keep}</button>
      </div>
      <p class="ct-deck-hint">Right keeps · left kills · up scripts it now</p>`}`;
  if (!done) wireCard($('.ct-card[data-d="0"]', d.el));
  else pulse(d.el);
}
function deckEnd() {
  const t = DK.tally;
  const more = REAL ? Math.max(0, DK.total - DK.list.length) : 0;
  return `<div class="ct-deck-end">
    ${ring(1, 'content', 112, 10, { inner: `<span class="ct-end-in">${CI.keep}</span>`, label: 'All sorted' })}
    <h2 class="title2">${more ? 'This batch is sorted' : 'All sorted'}</h2>
    <p class="ct-end-n"><span><b class="met">${t.keep + t.script}</b> kept</span><span><b class="met">${t.kill}</b> killed</span><span><b class="met">${t.script}</b> scripting now</span></p>
    <p class="sub">${t.keep ? `${esc(AGENT.name)} writes the kept ones in tonight's plan at 02:30.` : 'Nothing waits for tonight\'s plan.'} Every verdict tunes what she brings you next.${more ? ` ${plural(more, 'more idea')} wait.` : ''}</p>
    <div class="ct-end-acts">${t.keep ? `<button class="btn" data-act="ct-dk-writeall">${I.sparkle}Write them now</button>` : ''}${more ? `<button class="btn" data-act="ct-dk-more">Next ideas</button>` : ''}<button class="btn primary" style="--c:var(--content-fill)" data-act="ct-dk-close">Done</button></div>
  </div>`;
}

// 1:1 drag from where you grabbed it; on release, the throw carries the finger's velocity (spring with velocity handoff)
function wireCard(card) {
  if (!card) return;
  let x0 = 0, y0 = 0, dx = 0, dy = 0, hist = [], dragging = false, axis = null;
  const set = (x, y) => {
    card.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${Math.max(-16, Math.min(16, x / 16))}deg)`;
    const k = (v, lim) => Math.max(0, Math.min(1, v / lim));
    card.style.setProperty('--keep', k(x, 110).toFixed(3));
    card.style.setProperty('--kill', k(-x, 110).toFixed(3));
    card.style.setProperty('--script', k(-y - Math.abs(x) * .5, 120).toFixed(3));
    const next = card.previousElementSibling;   // the card under it rises as this one leaves
    if (next) next.style.setProperty('--lift', Math.min(1, Math.hypot(x, y) / 220).toFixed(3));
  };
  card._set = set;
  card.addEventListener('pointerdown', (e) => {
    if (DK?.busy) return;
    x0 = e.clientX - dx; y0 = e.clientY - dy; hist = [[e.clientX, e.clientY, performance.now()]]; dragging = true; axis = null;
    card.setPointerCapture(e.pointerId); card.classList.add('drag');
  });
  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    if (!axis && Math.hypot(dx, dy) > 8) axis = 'free';
    hist.push([e.clientX, e.clientY, performance.now()]); if (hist.length > 6) hist.shift();
    set(dx, dy < 0 ? dy : dy * .35);   // pulling down rubber-bands
  });
  const end = () => {
    if (!dragging) return; dragging = false; card.classList.remove('drag');
    const [a, b] = [hist[0], hist[hist.length - 1]];
    const dt = Math.max(16, b[2] - a[2]);
    const vx = (b[0] - a[0]) / dt * 1000, vy = (b[1] - a[1]) / dt * 1000;   // px per second
    // project where the throw is going (Apple's decay projection), then decide on that point
    const px = dx + vx * .998 / (1 - .998) / 1000 * .35, py = dy + vy * .998 / (1 - .998) / 1000 * .35;
    let v = null;
    if (px > 130) v = 'keep'; else if (px < -130) v = 'kill'; else if (py < -150 && Math.abs(px) < 120) v = 'script';
    if (v) throwCard(card, v, { x: dx, y: dy, vx, vy });
    else spring(card, { x: dx, y: dy, vx, vy }, { x: 0, y: 0 }, () => { dx = 0; dy = 0; }, set);
    if (!v) { dx = 0; dy = 0; }
  };
  card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
}
// a critically-damped-ish spring (damping 0.8 after a throw, response 0.35 s) that starts at the finger's velocity
function spring(card, from, to, done, set = card._set, { zeta = .8, response = .35 } = {}) {
  if (reduced()) { set(to.x, to.y); done?.(); return; }
  const w = 2 * Math.PI / response, kk = w * w, c = 2 * zeta * w;
  let x = from.x, y = from.y, vx = from.vx ?? 0, vy = from.vy ?? 0, last = performance.now();
  const step = (now) => {
    const dt = Math.min(.032, (now - last) / 1000); last = now;
    vx += (-kk * (x - to.x) - c * vx) * dt; vy += (-kk * (y - to.y) - c * vy) * dt;
    x += vx * dt; y += vy * dt;
    set(x, y);
    if (Math.abs(x - to.x) < .5 && Math.abs(y - to.y) < .5 && Math.abs(vx) < 8 && Math.abs(vy) < 8) { set(to.x, to.y); done?.(); return; }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// real mode holds the last kill a moment, so a "why not?" tap travels with it (one verdict, one learning row)
function flushKill() {
  const d = DK; const h = d?.held; if (!h) return;
  d.held = null;
  const op = verdict(h.id, 'kill', { quiet: true, why: h.why ?? null, was: h.was });
  const e = d.hist.find(([id, v]) => id === h.id && v === 'kill'); if (e) e[3] = op?.id ?? null;
}
function throwCard(card, v, from = { x: 0, y: 0, vx: 0, vy: 0 }) {
  const d = DK; if (!d || d.busy) return;
  d.busy = true;
  const W = d.el.offsetWidth;
  const to = v === 'keep' ? { x: W * 1.25, y: from.y + 40 } : v === 'kill' ? { x: -W * 1.25, y: from.y + 40 } : { x: from.x * .3, y: -d.el.offsetHeight };
  // a button press gives the card a push in its direction, so it leaves the same way a swipe would
  const push0 = from.vx || from.vy ? from : { x: 0, y: 0, vx: v === 'keep' ? 1800 : v === 'kill' ? -1800 : 0, vy: v === 'script' ? -2200 : -200 };
  haptic(v === 'kill' ? 12 : 9);
  const id = card.dataset.id;
  spring(card, push0, to, () => {}, card._set, { zeta: 1, response: .42 });
  setTimeout(() => {
    flushKill();
    const x = idea(id); const was = x?.status ?? 'new';
    let op = null;
    if (REAL && v === 'kill') { d.held = { id, was }; if (x) x.status = 'killed'; }
    else op = verdict(id, v, { quiet: true });
    d.tally[v] += 1; d.hist.push([id, v, was, op?.id ?? null]); d.i += 1; d.busy = false;
    d.lastKill = v === 'kill' ? id : null;
    drawDeck();
  }, reduced() ? 60 : 280);
}
on('ct-dk', (el) => { const c = DK && $('.ct-card[data-d="0"]', DK.el); if (c) throwCard(c, el.dataset.v); });
on('ct-dk-why', (el) => {
  const d = DK; if (!d?.lastKill) return;
  if (REAL) { if (d.held?.id === d.lastKill) { d.held.why = el.dataset.v; flushKill(); } }
  else { const v = S.verdicts.find((x) => x.title === idea(d.lastKill)?.title); if (v) v.why = el.dataset.v; }
  d.lastKill = null; haptic(6);
  $('.ct-deck-why', d.el).hidden = true;
  toast(`Noted: ${el.dataset.v.toLowerCase()}. ${AGENT.name} weighs it from tonight.`);
});
on('ct-dk-undo', () => {
  const d = DK; if (!d?.hist.length) return;
  const [id, , was, opId] = d.hist.pop(); const x = idea(id);
  if (REAL) {
    if (d.held?.id === id) { d.held = null; if (x) x.status = was ?? 'new'; }    // the kill never left the phone
    else verdict(id, 'restore', { quiet: true, was: was ?? 'new', undo: opId });
  } else {
    if (x) { x.status = 'new'; }
    const last = S.verdicts.findIndex((q) => q.title === x?.title); if (last >= 0) S.verdicts.splice(last, 1);
  }
  d.i -= 1; d.lastKill = null;
  // recount from the history that is left
  d.tally = { keep: 0, kill: 0, script: 0 }; d.hist.forEach(([, k]) => { d.tally[k] += 1; });
  redraw('ideas'); drawDeck(); haptic(6);
});
on('ct-dk-writeall', () => {
  const d = DK; if (!d) return;
  flushKill();
  const kept = d.hist.filter(([, v]) => v === 'keep').map(([id]) => id);
  if (REAL) kept.forEach((id) => send('write', { idea: id }));
  else kept.forEach((id) => { const x = idea(id); if (x?.status === 'kept') verdict(id, 'script', { quiet: true }); });
  toast(`${AGENT.name} is writing ${plural(kept.length, 'script')} now`);
  closeDeck();
});
on('ct-dk-more', () => { flushKill(); closeDeck(true); refresh({ force: true }).then(() => openTriage()); });
on('ct-dk-close', () => closeDeck());
function closeDeck(instant) {
  const d = DK; if (!d) return;
  flushKill();
  DK = null;
  redraw('ideas');
  if (instant || reduced()) { d.el.remove(); return; }
  d.el.classList.remove('in'); setTimeout(() => d.el.remove(), 380);
}
addEventListener('keydown', (e) => {
  if (!DK) return;
  if (e.key === 'Escape') { e.preventDefault(); closeDeck(); }
  const c = $('.ct-card[data-d="0"]', DK.el); if (!c) return;
  if (e.key === 'ArrowRight') throwCard(c, 'keep');
  if (e.key === 'ArrowLeft') throwCard(c, 'kill');
  if (e.key === 'ArrowUp') throwCard(c, 'script');
});

// ── the + sheet: type or say an idea, pick the channel ────────────────────
export function newIdeaSheet(prefill = {}) {
  let ch = prefill.ch ?? (S.ch === 'all' ? '@northwindstudio' : S.ch);
  openSheet({
    title: 'New idea', sub: 'Lands in Ideas, scored by the morning',
    body: (b) => {
      b.innerHTML = `<div class="pad ct-newsheet">
        <label class="field ct-ta"><textarea rows="3" placeholder="What's the reel? Or paste a link" aria-label="The idea">${esc(prefill.title ?? '')}</textarea></label>
        <div class="ct-newch" role="radiogroup" aria-label="Channel">${CHS.map((k) => `<button class="ct-chopt" role="radio" data-ch="${k.id}" aria-checked="${k.id === ch}">${chAv(k.id)}<span><b>${esc(k.id)}</b><small>${esc(k.focus)}</small></span></button>`).join('')}</div>
        <div class="ct-newacts">
          <button class="btn" data-act="ct-new-voice">${I.mic}Say it</button>
          <button class="btn primary" style="--c:var(--content-fill)" data-act="ct-new-save" disabled>Save idea</button>
        </div>
      </div>`;
      const ta = $('textarea', b), save = $('[data-act="ct-new-save"]', b);
      const sync = () => { save.disabled = !ta.value.trim(); };
      ta.addEventListener('input', sync); sync();
      $$('.ct-chopt', b).forEach((o) => o.addEventListener('click', () => { ch = o.dataset.ch; $$('.ct-chopt', b).forEach((p) => p.setAttribute('aria-checked', String(p === o))); haptic(5); }));
      b._ch = () => ch;
      setTimeout(() => ta.focus({ preventScroll: true }), 420);
    },
  });
}
route('new', newIdeaSheet);
on('ct-new-voice', () => { closeSheet(); api.openCapture('voice', { about: 'content' }); });
on('ct-new-save', (el) => {
  const sh = el.closest('.sheet'); const v = $('textarea', sh)?.value.trim(); if (!v) return;
  const ch = $('.sheet-body', sh)?._ch?.() ?? '@northwindstudio';
  closeSheet(sh);
  if (/https?:\/\/|instagram\.com|youtu/i.test(v)) { setTimeout(() => addContentIdea({ url: v.match(/https?:\/\/\S+/)?.[0] ?? v, platform: /youtu/i.test(v) ? 'youtube' : 'instagram', ch, note: v.replace(/https?:\/\/\S+/, '').trim() || null }), 320); return; }
  if (REAL) send('capture', { text: v, channel: ch });
  else S.ideas.unshift({ id: `c${Date.now()}`, title: v, ch, source: 'you', status: 'new', score: 6.5, at: 'Now', from: 'You typed it just now', why: [['+', 'You wrote it yourself'], ['+', 'Fresh today']] });
  redraw('ideas'); toast(`Saved to Ideas · ${ch}`);
});

// ── a reel shared in (Scan, the share sheet, a pasted link): saved first, then read into a reference card ──
export function addContentIdea(prefill = {}) {
  if (REAL) return addRealIdea(prefill);
  const ch = prefill.ch ?? (/magic|trick|coin|card|chai/i.test(`${prefill.title ?? ''} ${prefill.why ?? ''}`) ? '@example_creator' : '@northwindstudio');
  // a reel or a short is watched; anything else (an article, a post) is read
  const isReel = /instagram|youtube|tiktok/i.test(prefill.platform ?? '') || /reel|shorts|youtu/i.test(prefill.url ?? '') || (!prefill.platform && !prefill.url);
  const app = /youtu/i.test(`${prefill.platform ?? ''} ${prefill.url ?? ''}`) ? 'YouTube' : isReel ? 'Instagram' : (prefill.platform && !/^web$/i.test(prefill.platform) ? prefill.platform[0].toUpperCase() + prefill.platform.slice(1) : 'the web');
  const x = { id: `c${Date.now()}`, title: prefill.title || (isReel ? 'A reel you shared' : 'A link you shared'), ch, source: isReel ? 'reel' : 'link', status: 'new', score: 7.2, at: 'Now',
    from: `You shared it from ${app} just now`, why: [['+', 'You saved it yourself'], ['+', 'Fresh today']],
    url: prefill.url ?? null, reading: true, isReel };
  S.ideas.unshift(x);
  redraw('ideas');
  const sh = openSheet({
    title: 'Saved to Ideas', sub: esc(prefill.url ? prefill.url.replace(/^https?:\/\//, '').slice(0, 42) : 'Shared from another app'),
    body: (b) => { b._id = x.id; drawShared(b, x, prefill); },
  });
  setTimeout(() => {
    x.reading = false;
    if (isReel) {
      x.title = prefill.title || 'Pen into a coin, in one take';
      x.hook = prefill.title ? null : 'Pen dekho. Ab sikka dekho.';
      x.ref = { views: '880k', age: '4 days', hook: prefill.title ? 'The payoff lands in the first second' : 'Watch the pen. Now it’s a coin.', structure: 'The payoff at full speed, a slow replay, then how it’s done', why: prefill.why ?? 'It pays off in the first second, so nobody scrolls past.' };
    } else {
      x.title = prefill.title || 'An article you saved';
      x.ref = { views: null, age: null, hook: x.title, structure: 'Read for you: the main point and three takeaways', why: prefill.why ?? 'One clear idea you can show on screen in a reel' };
    }
    // the agent watched it: a trick belongs on the magic channel unless you chose one
    if (!prefill.ch && /coin|card|magic|trick|vanish/i.test(`${x.title} ${x.ref.structure}`)) x.ch = '@example_creator';
    x.why = [['+', 'You saved it yourself'], ['+', 'Fresh today'], ['+', ch === '@example_creator' ? 'Magic is what this channel is for' : 'Fits what this channel posts']];
    x.score = 7.6;
    redraw('ideas');
    const body = $('.sheet-body', sh); if (body?.isConnected) drawShared(body, x, prefill);
  }, 1700);
  return x.id;
}
// real: one capture op; the PC downloads the reel and writes the card in the background (it shows up on the idea later)
function addRealIdea(prefill) {
  const url = prefill.url ?? prefill.link ?? null;
  const ch = prefill.ch ?? (/magic|trick|coin|card|jaadu/i.test(`${prefill.title ?? ''} ${prefill.why ?? ''}`) ? '@example_creator' : '@northwindstudio');
  const text = [prefill.title, prefill.why, prefill.note].filter(Boolean).join('\n\n') || null;
  const op = send('capture', { text, link: url, title: prefill.title || null, channel: ch, from: 'share' });
  const st = { op: op?.id, ch, url, note: prefill.note ?? '' };
  const sh = openSheet({
    title: 'Saved to Ideas', sub: esc(url ? url.replace(/^https?:\/\//, '').slice(0, 42) : 'Shared from another app'),
    body: (b) => { b._st = st; drawSharedReal(b, st); },
  });
  const poll = setInterval(() => {
    const body = $('.sheet-body', sh);
    if (!body?.isConnected) { clearInterval(poll); return; }
    const d = st.op && opOf(st.op);
    if (d?.applied_at || d?.state === 'refused') { clearInterval(poll); drawSharedReal(body, st); }
  }, 900);
  return op?.id ?? null;
}
function drawSharedReal(b, st) {
  const d = st.op && opOf(st.op);
  const ideaId = d?.result?.idea ?? null;
  const refused = d?.state === 'refused';
  b.innerHTML = `<div class="pad ct-shared">
    <div class="ct-shared-card group">
      ${cover({ lines: ideaId ? ['Saved', 'to Ideas'] : ['Saving', 'to your PC'], hi: 0, scene: st.ch === '@example_creator' ? 'coin' : 'agents' }, { ch: st.ch, w: 72, state: ideaId || refused ? '' : 'reading' })}
      <div class="ct-shared-b">
        ${refused ? `<p class="ct-shared-st">${word('Not saved', 'var(--needs-ink)')}</p><p class="foot">${esc(d.error ?? 'Your PC refused it.')}</p>`
        : ideaId ? `<b class="ct-shared-t">In Ideas as ${esc(ideaId)}</b><p class="foot">${st.url ? 'Your PC downloads it and writes a reference card (hook, structure, why it works). It shows on the idea when it\'s done.' : 'It\'s scored in tonight\'s plan.'}</p>`
        : `<p class="ct-shared-st">${word(navigator.onLine === false ? 'Waiting for your PC' : 'Saving', 'var(--content-ink)', true)}</p><p class="foot">${navigator.onLine === false ? 'You\'re offline: it\'s kept on this phone and sent when you\'re back.' : 'One moment.'}</p>`}
      </div>
    </div>
    <p class="ct-shared-ch">${chAv(st.ch)}<span>Filed for <b>${esc(st.ch)}</b></span>${ideaId ? `<button class="btn sm" data-act="ct-shared-ch2">Switch</button>` : ''}</p>
    <div class="ct-newacts"><button class="btn" data-act="ct-shared-open2" ${ideaId ? '' : 'disabled'}>Open idea</button><button class="btn primary" style="--c:var(--content-fill)" data-act="ct-shared-done2">Done</button></div>
  </div>`;
}
on('ct-shared-ch2', (el) => {
  const b = el.closest('.sheet-body'); const st = b?._st; const id = st && opOf(st.op)?.result?.idea; if (!id) return;
  st.ch = st.ch === '@example_creator' ? '@northwindstudio' : '@example_creator';
  send('idea', { idea: id, channel: st.ch }); haptic(5); drawSharedReal(b, st);
});
on('ct-shared-done2', (el) => { closeSheet(el.closest('.sheet')); toast('In Ideas, under New'); });
on('ct-shared-open2', (el) => { const st = el.closest('.sheet-body')?._st; const id = st && opOf(st.op)?.result?.idea; closeSheet(el.closest('.sheet')); if (id) setTimeout(() => refresh({ force: true }).then(() => openIdea(id)), 300); });
function drawShared(b, x, prefill) {
  b.innerHTML = `<div class="pad ct-shared">
    <div class="ct-shared-card group">
      ${cover({ lines: x.reading ? ['Reading', 'the reel'] : (x.ref?.hook ?? x.title).split(/,|\./).filter(Boolean).slice(0, 2).map((t) => t.trim()), hi: 0, scene: x.ch === '@example_creator' ? 'coin' : 'agents' }, { ch: x.ch, w: 72, state: x.reading ? 'reading' : '' })}
      <div class="ct-shared-b">
        ${x.reading ? `<p class="ct-shared-st">${word(`${AGENT.name} is ${x.isReel === false ? 'reading' : 'watching'} it`, 'var(--content-ink)', true)}</p><p class="foot">${x.isReel === false ? 'The main point and what a reel could take from it' : 'Transcript, hook, structure and why it works'}, in a few seconds.</p>`
        : `<b class="ct-shared-t">${esc(x.title)}</b>
           <dl class="ct-dl sm"><div><dt>Hook</dt><dd>${esc(x.ref.hook)}</dd></div><div><dt>Structure</dt><dd>${esc(x.ref.structure)}</dd></div><div><dt>Why it works</dt><dd>${esc(x.ref.why)}</dd></div></dl>`}
      </div>
    </div>
    <p class="ct-shared-ch">${chAv(x.ch)}<span>Filed for <b>${esc(x.ch)}</b>${x.reading ? '' : `, scored ${x.score.toFixed(1)}`}</span><button class="btn sm" data-act="ct-shared-ch" data-id="${x.id}">Switch</button></p>
    <label class="field ct-ta"><textarea rows="2" placeholder="Add a note: what you liked about it" aria-label="Your note">${esc(prefill.note ?? '')}</textarea></label>
    <div class="ct-newacts"><button class="btn" data-act="ct-shared-open" data-id="${x.id}" ${x.reading ? 'disabled' : ''}>Open idea</button><button class="btn primary" style="--c:var(--content-fill)" data-act="ct-shared-done" data-id="${x.id}">Done</button></div>
  </div>`;
}
on('ct-shared-ch', (el) => {
  const x = idea(el.dataset.id); if (!x) return;
  x.ch = x.ch === '@example_creator' ? '@northwindstudio' : '@example_creator'; haptic(5); redraw('ideas');
  const b = el.closest('.sheet-body'); if (b) drawShared(b, x, {});
});
const saveNote = (el) => { const x = idea(el.dataset.id); const n = el.closest('.sheet')?.querySelector('textarea')?.value.trim(); if (x && n) { x.ref = x.ref ?? {}; x.ref.note = n; } };
on('ct-shared-done', (el) => { saveNote(el); closeSheet(el.closest('.sheet')); toast('In Ideas, under New'); });
on('ct-shared-open', (el) => { saveNote(el); closeSheet(el.closest('.sheet')); setTimeout(() => openIdea(el.dataset.id), 300); });

export { openIdeas, openIdea, openTriage };

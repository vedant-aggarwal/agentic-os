// Content OS · shipping the reel: Edits (renders to approve: a 9:16 player, what changed, the agent's checks, Instagram's
// safe zones; Approve books the RealFlow slot with no second confirm, Send back takes a note), the posting calendar
// (week, month, the profile grid, slots per channel), Stats (what went out, against the goal) and what the loop learned.
// Real mode: approve, undo, notes, slots and rule switches are ops; the player streams the render from the PC through a
// signed link; posts are the RealFlow ledger content-os keeps plus approvals. While CONTENT_POST is off on the PC an
// approval is a dry run (booked here, nothing sent to RealFlow) and every screen says so.
import { $, $$, esc, on, push, openSheet, closeSheet, toast, haptic, ring, pulse, seg, wireSegs } from './core.js';
import { I } from './icons.js';
import { AGENT, GOALS } from './data.js';
import { api } from './bus.js';
import * as clock from './svc/clock.js';
import { S, CI, edit, route, go, redraw, onRedraw, head, askBtn, bar, chAv, chDot, chOf, cover, word, plural, dur, kfmt, faceFrame, CHS, REAL, META, keepInputs, enter } from './content-ui.js';
import { STATS, STREAK, POSTS, send, mediaUrl, captionFor, pendingOps } from './content-data.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const posting = () => !REAL || !!META.flags?.post;
const EDIT_WORD = (d) => d.status === 'review' ? word('Needs your OK', 'var(--needs-ink)')
  : d.status === 'rendering' ? word(`Rendering ${Math.round((d.p ?? 0) * 100)}%`, 'var(--content-ink)', true)
  : d.status === 'draft' ? word('Not rendered yet', 'var(--ink-2)')
  : d.status === 'scheduled' ? word(d.pending ? 'Approving' : REAL && d.postStatus === 'dry-run' ? 'Approved · dry run' : 'Scheduled', 'var(--done)', !!d.pending)
  : d.status === 'redo' ? word('Back with the editor', 'var(--content-ink)', true)
  : word(d.status);
const slotText = (d) => d.post ?? (REAL ? (CHS.find((k) => k.id === d.ch)?.slotsSet ? 'in the next open slot' : 'once a posting slot is set') : 'the next open slot');
const slotShort = (d) => d.post ?? (REAL ? (CHS.find((k) => k.id === d.ch)?.slotsSet ? 'next open slot' : 'no slot set yet') : 'the next open slot');

// ── approve: books the slot, the week's ring for that day turns booked; Undo sits in the toast ──
export function approve(id) {
  const d = edit(id); if (!d || d.status !== 'review') return;
  haptic(14);
  if (REAL) {
    const caption = $(`.ct-review textarea[data-edit="${id}"]`)?.value?.trim() || null;
    send('approve', { edit: id, caption, at: d.pickAt ?? null });
    redraw('edits');
    toast(posting() ? `Scheduled · ${slotText(d)} on ${d.ch}` : `Approved · a dry run: CONTENT_POST is off, nothing went to RealFlow`, () => { send('unapprove', { edit: id }); redraw('edits'); });
    return;
  }
  d.status = 'scheduled';
  const p = S.week.flatMap((w) => w.posts).find((x) => x.edit === id); if (p) p.s = 'scheduled';
  redraw('edits');
  toast(`Scheduled · ${d.post} on ${d.ch}`, () => { d.status = 'review'; if (p) p.s = 'review'; redraw('edits'); });
}
on('ct-approve', (el) => approve(el.dataset.id));
on('ct-unapprove', (el) => {
  const d = edit(el.dataset.id); if (!d) return;
  if (REAL) {
    if (d.postStatus === 'scheduled' && posting()) { toast('It\'s booked in RealFlow: cancel it there first'); return; }
    send('unapprove', { edit: d.id }); redraw('edits'); toast('Back to waiting for your OK'); return;
  }
  d.status = 'review'; const p = S.week.flatMap((w) => w.posts).find((x) => x.edit === d.id); if (p) p.s = 'review'; redraw('edits'); toast('Back to waiting for your OK');
});

// ── the edits page ──────────────────────────────────────────────────────
function openEdits() {
  const page = push({ title: 'Edits', back: 'Content', right: askBtn(), cls: 'ct-page', render(sc) { drawEdits(sc); enter(sc); } });
  const off = onRedraw(() => { if (page.isConnected) drawEdits($('.scroll', page)); });
  page._opts.onPop = off;
}
route('edits', openEdits);
function editCard(d) {
  const acts = d.status === 'review' ? `<button class="btn sm" data-act="ct-note" data-id="${d.id}">${I.edit}Send back</button><button class="btn sm primary" style="--c:var(--content-fill)" data-act="ct-approve" data-id="${d.id}">${I.check}Approve</button>`
    : d.status === 'rendering' ? `<button class="btn sm" data-act="ct-hooks" data-id="${d.id}">${CI.layers}Pick a hook</button>`
    : d.status === 'scheduled' ? `<span class="ct-sched">${I.clock}<span>${REAL && d.postStatus === 'dry-run' ? `Dry run · ${esc(d.post ?? 'no slot yet')}` : `Posts ${esc(d.post ?? 'next')} through RealFlow`}</span></span>`
    : '';
  const note = d.status === 'rendering' ? d.note : d.status === 'redo' ? `Your note: ${(d.history ?? []).filter((h) => h[0] === 'note').at(-1)?.[2] ?? ''}` : d.status === 'draft' ? 'The editor hasn\'t rendered it yet' : (d.changes ?? [])[0] ?? (REAL ? (d.recipe ? `Cut with ${d.recipe}` : '') : '');
  return `<article class="ct-ecard ${d.status}" data-id="${d.id}">
    <button class="ct-ecard-top" data-act="ct-edit" data-id="${d.id}" aria-label="${d.status === 'rendering' ? 'Pick a hook for' : 'Review'} ${esc(d.title)}">
      <span class="ct-ecard-cv">${cover(d.cover, { ch: d.ch, w: 64, dur: d.len, state: d.status === 'rendering' ? 'rendering' : '' })}${d.status === 'rendering' ? `<span class="ct-cv-prog" style="--p:${d.p}"><i></i></span>` : ''}</span>
      <span class="ct-ecard-b">
        <span class="ct-ecard-t"><b>${esc(d.title)}</b>${I.chevR}</span>
        <span class="ct-ecard-m">${EDIT_WORD(d)}<span>·</span>${chDot(d.ch)}<span class="ell">${d.status === 'review' ? `posts ${esc(slotText(d))}` : `${esc(d.ch)} · v${d.v}`}</span></span>
        ${note ? `<span class="ct-note">${I.sparkle}<span>${esc(note)}${d.status === 'review' && d.changes?.length > 1 ? `, and ${d.changes.length - 1} more` : ''}</span></span>` : ''}
      </span>
    </button>
    ${acts ? `<div class="ct-ecard-a">${acts}</div>` : ''}
  </article>`;
}
function drawEdits(sc) {
  const list = S.edits.filter((d) => S.ch === 'all' || d.ch === S.ch);
  const n = (st) => list.filter((d) => d.status === st).length;
  const order = { review: 0, redo: 1, rendering: 2, draft: 3, scheduled: 4 };
  sc.innerHTML = `${head({ title: 'Edits', sub: [n('review') ? `${n('review')} waiting for you` : 'Nothing waiting for you', n('rendering') ? `${n('rendering')} rendering` : '', n('redo') ? `${n('redo')} with the editor` : '', n('scheduled') ? `${n('scheduled')} ${REAL && !posting() ? 'approved' : 'scheduled'}` : ''].filter(Boolean).join(' · ') })}
    ${REAL && !posting() ? `<div class="note ct-drynote">${I.flag}<span>Posting is off on your PC (CONTENT_POST). Approve books the slot here as a dry run; nothing goes to RealFlow.</span></div>` : ''}
    <div class="ct-elist">${[...list].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)).map(editCard).join('') || '<div class="note">No edits yet. Takes you keep become drafts here for your OK.</div>'}</div>
    <p class="hint">Approve books the slot in RealFlow straight away, with no second confirm; Undo sits in the toast. Send back goes to the editor with your note.</p>`;
  pulse(sc);
}
on('ct-edit', (el) => openEdit(el.dataset.id));
on('ct-hooks', (el) => hookPicker(el.dataset.id));

// a render that waits on a choice: three hooks, the agent cuts the one you pick (prototype)
function hookPicker(id) {
  const d = edit(id); if (!d) return;
  openSheet({
    title: 'Pick a hook', sub: `${esc(d.title)} · the editor cuts the one you pick`,
    body: (b) => {
      b.innerHTML = `<div class="pad ct-hookpick">${(d.hooks ?? []).map((h, i) => `<button class="ct-hopt" data-act="ct-hook-pick" data-id="${d.id}" data-i="${i}">
          ${cover({ lines: h.split(/,|\./).filter(Boolean).slice(0, 2).map((t) => t.trim()), hi: 1, scene: d.cover.scene }, { ch: d.ch, w: 64 })}
          <span class="rbody"><b>Hook ${'ABC'[i]}</b><span class="ct-hopt-q">“${esc(h)}”</span>${i === 1 ? `<span class="foot">${esc(AGENT.name)}'s pick: the same shape held 66% on this channel</span>` : ''}</span>
        </button>`).join('')}</div>`;
    },
  });
}
on('ct-hook-pick', (el) => {
  const d = edit(el.dataset.id); if (!d) return;
  const h = d.hooks[Number(el.dataset.i)];
  d.note = `Cutting hook ${'ABC'[Number(el.dataset.i)]}: “${h}”`; d.cover.lines = h.split(/,|\./).filter(Boolean).slice(0, 2).map((t) => t.trim());
  closeSheet(el.closest('.sheet')); haptic(8); redraw('edits');
  toast(`Hook ${'ABC'[Number(el.dataset.i)]} it is. The render finishes in about 6 minutes`);
});

// ── the review page: watch it, see what changed, approve or send back ─────
let PL = null;   // the playing player (demo): { id, t, raf, last, el }
function openEdit(id) {
  if (!id) return openEdits(); // content/edit with no id: the list
  const d = edit(id); if (!d) return;
  if (d.status === 'rendering') { hookPicker(id); return; }
  const page = push({ title: d.title, back: 'Edits', right: askBtn(), cls: 'ct-page has-bar ct-review', render(sc, pg) { pg._id = id; pg._v = d.v; drawEdit(sc, pg); } });
  const off = onRedraw(() => { if (page.isConnected) keepInputs($('.scroll', page), () => drawEdit($('.scroll', page), page)); });
  page._opts.onPop = () => { off(); stopPlay(); const v = $('video', page); if (v) { v.pause(); v.removeAttribute('src'); v.load?.(); } };
  if (REAL) {
    if (d.render) mediaUrl(id).then((m) => { page._media = m; if (page.isConnected) attachMedia(page); }).catch((e) => { page._mediaErr = e.message; if (page.isConnected) drawEdit($('.scroll', page), page); });
    captionFor(d).then(() => { const ta = $(`textarea[data-edit="${id}"]`, page); if (ta && !ta.value && d.caption) ta.value = d.caption; });
  }
}
route('edit', openEdit);
/** The real render in the frame (once its signed link arrives); safe zones and the time bar ride on top. */
function attachMedia(page) {
  const fr = $('.ct-pl-frame', page); const m = page._media; if (!fr || !m) return;
  let v = $('video', fr);
  if (!v) {
    v = document.createElement('video');
    v.className = 'ct-pl-video'; v.playsInline = true; v.preload = 'metadata'; v.setAttribute('playsinline', ''); v.src = m.url;
    fr.prepend(v);
    const svg = $('svg', fr); if (svg) svg.style.opacity = '0';
    const d = edit(page._id);
    v.addEventListener('loadedmetadata', () => { if (d && Number.isFinite(v.duration)) { d.len = Math.round(v.duration); const tm = $('.ct-pl-time', page); if (tm) tm.textContent = `${dur(0)} / ${dur(d.len)}`; } });
    v.addEventListener('timeupdate', () => { const f = $('.ct-pl-fill', page); if (f && v.duration) f.style.setProperty('--p', (v.currentTime / v.duration).toFixed(4)); const tm = $('.ct-pl-time', page); if (tm && v.duration) tm.textContent = `${dur(v.currentTime)} / ${dur(v.duration)}`; });
    const sync = () => { const b = $('.ct-pl-play', page); if (!b) return; b.innerHTML = v.paused ? I.play : I.pause; b.setAttribute('aria-label', v.paused ? 'Play' : 'Pause'); b.classList.toggle('playing', !v.paused); };
    v._sync = sync;
    v.addEventListener('play', sync); v.addEventListener('pause', sync); v.addEventListener('ended', sync);
    v.addEventListener('error', () => { page._mediaErr = 'The render didn\'t play: the PC may have moved the file'; const svg2 = $('.ct-pl-frame svg', page); if (svg2) svg2.style.opacity = '1'; v.remove(); });
  }
  // the time bar is redrawn with the page: wire the new one, and show where the playing video is
  const tr = $('.ct-pl-track', page);
  if (tr && !tr._wired) { tr._wired = true; tr.addEventListener('click', (e) => { const r = e.currentTarget.getBoundingClientRect(); if (v.duration) v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * v.duration; }); }
  const svg = $('svg', fr); if (svg) svg.style.opacity = '0';
  v._sync?.();
}
function captionAt(d, t) { const tr = d.track ?? [[0, d.cover.lines.join(' ')]]; let c = tr[0][1]; for (const [at, txt] of tr) if (t >= at) c = txt; return c; }
function playerSvg(d, t, v, playing = false) {
  const cap = captionAt(d, t);
  const pl = d.ch === '@example_creator';
  const words = cap.split(' ');
  // v1 captioned small and low; v2 burns them in big, word by word while it plays
  const shown = v === 1 || !playing ? cap : words.slice(0, Math.max(1, Math.ceil(((t % 2.5) / 2.5 + .35) * words.length))).join(' ');
  const fs = v === 1 ? 7 : 11, y = v === 1 ? 140 : 114, cw = fs * .62;
  const fit = Math.min(1, 56 / Math.max(1, shown.length * cw)), k = fit * fs / 14, bw = shown.length * cw * fit + 8;
  const tint = pl ? '#7cf2e6' : '#33c6ff';
  const capSvg = pl && v > 1
    ? `<rect x="${(45 - bw / 2).toFixed(1)}" y="${(y - fs * .95).toFixed(1)}" width="${bw.toFixed(1)}" height="${(fs * 1.3).toFixed(1)}" rx="2" fill="#f6f6f8"/><text transform="translate(45 ${y}) scale(${k.toFixed(3)})" text-anchor="middle" font-size="14" fill="#0b0b0d">${esc(shown)}</text>`
    : `<text transform="translate(45 ${y}) scale(${k.toFixed(3)})" text-anchor="middle" font-size="14" fill="${v > 1 ? tint : '#f6f6f8'}">${esc(shown)}</text>`;
  return `<svg viewBox="0 0 90 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="90" height="160" fill="#0d0e11"/>
    <g class="ct-pl-person"><circle cx="45" cy="58" r="15"/><path d="M9 162c2-38 17-62 36-62s34 24 36 62z"/></g>
    ${pl ? '<g class="ct-pl-drape"><path d="M55 101c-3 16 0 34 10 60"/><path d="M60 100c-3 17 0 36 10 61"/><path d="M65 102c-2 15 1 33 10 58"/></g>' : ''}
    <g class="ct-pl-cap">${capSvg}</g>
  </svg>`;
}
function drawEdit(sc, page) {
  const d = edit(page._id); if (!d) return;
  const v = page._v ?? d.v;
  const t = PL?.id === d.id ? PL.t : 0;
  const ticks = (d.track ?? []).map(([at]) => `<i style="left:${(at / d.len * 100).toFixed(2)}%"></i>`).join('');
  const sched = d.status === 'scheduled';
  const canApprove = d.status === 'review';
  const hist = (d.history ?? []).map(([k, at, txt]) => `<li class="${k}"><span class="ct-hist-k">${k === 'note' ? I.chat : k === 'ok' ? I.check : `<b>${esc(k)}</b>`}</span><span class="rbody"><span class="ct-hist-t">${esc(txt)}</span><span class="foot">${esc(at)}${k === 'note' ? ' · your note' : ''}</span></span></li>`).join('');
  const playing = REAL ? false : PL?.id === d.id && PL.on;
  const noRender = REAL && !d.render;
  const keepV = REAL ? $('.ct-pl-frame video', sc) : null;   // a redraw (the PC answered) keeps the render playing where it is
  keepV?.remove();
  sc.innerHTML = `<div class="phead ct-ihead">
      <p class="ct-ichan">${chAv(d.ch)}<span>${esc(d.ch)}</span>${d.len ? `<span class="ct-sep">·</span><span class="ct-isrc">${dur(d.len)}</span>` : ''}</p>
      <h1 class="title1">${esc(d.title)}</h1>
      <p class="sub">${EDIT_WORD(d)} · ${sched ? (REAL && d.postStatus === 'dry-run' ? `dry run · ${esc(d.post ?? 'no slot')}` : `posts ${esc(d.post ?? 'next')}`) : canApprove ? `approve and it posts ${esc(slotText(d))}` : d.status === 'redo' ? 'the editor has your note' : 'waiting for the render'}</p>
    </div>
    ${d.v > 1 ? `<div class="ct-vseg">${seg('ct-ver', Array.from({ length: d.v }, (_, i) => [String(i + 1), `v${i + 1}${i + 1 === d.v ? ' · latest' : ''}`]), String(v), 'sm')}</div>` : ''}
    <section class="ct-player" data-id="${d.id}">
      <div class="ct-pl-frame ${page._safe ? 'safe' : ''}">
        ${REAL ? (cover(d.cover, { ch: d.ch, w: 240 }).match(/<svg[\s\S]*?<\/svg>/)?.[0] ?? '') : playerSvg(d, t, v, playing)}
        <div class="ct-safe" aria-hidden="true"><i class="top"><span>Reels header</span></i><i class="side"><span>Buttons</span></i><i class="bot"><span>Caption and audio</span></i></div>
        ${noRender ? `<span class="ct-pl-none">${I.film}<span>Not rendered yet</span></span>` : `<button class="ct-pl-play" data-act="ct-play" data-id="${d.id}" aria-label="${playing ? 'Pause' : 'Play'}">${playing ? I.pause : I.play}</button>`}
      </div>
      <div class="ct-pl-bar"><div class="ct-pl-track">${ticks}<span class="ct-pl-fill" style="--p:${d.len ? (t / d.len).toFixed(4) : 0}"></span></div><span class="ct-pl-time num">${dur(t)} / ${d.len ? dur(d.len) : '–:––'}</span></div>
      <button class="chip sm ct-safebtn ${page._safe ? 'on' : ''}" data-act="ct-safe" aria-pressed="${!!page._safe}">${CI.safe}Safe zones</button>
      ${page._mediaErr ? `<p class="foot ct-pl-err">${esc(page._mediaErr)}</p>` : ''}
    </section>
    ${v === d.v && d.changes?.length ? `<div class="sh"><h2>What changed in v${d.v}</h2></div>
      <ul class="group ct-chgs">${d.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : v < d.v ? `<p class="note">You're watching v${v}, the cut before your note.</p>` : ''}
    ${d.checks?.length ? `<div class="sh"><h2>${esc(AGENT.name)}'s checks</h2><span class="sh-count">${d.checks.filter(([k]) => k === 'ok').length} of ${d.checks.length}</span></div>
      <div class="group ct-checks">${d.checks.map(([k, txt]) => `<div class="ct-check2 ${k}"><span class="ct-ck">${k === 'ok' ? I.check : '!'}</span><span>${esc(txt)}</span></div>`).join('')}</div>` : ''}
    <div class="sh"><h2>Post</h2></div>
    <div class="group">
      <div class="row ic"><span class="tile">${I.clock}</span><span class="rbody"><span class="rtitle">${esc(d.pickAt ? `${clock.dayLabel(clock.dateOfIso(d.pickAt))} ${clock.hm(clock.toMin(d.pickAt, clock.dateOfIso(d.pickAt)))}` : d.post ?? (REAL ? capFirst(slotText(d)) : 'Next open slot'))}</span><span class="rmeta">${chDot(d.ch)}<span class="ell">${esc(d.ch)} · ${posting() ? 'through RealFlow' : 'dry run: posting is off on your PC'}</span></span></span>${sched || !canApprove ? '' : `<button class="btn sm" data-act="ct-slot-change" data-id="${d.id}">Change</button>`}</div>
      <label class="ct-captionf"><span class="foot">Caption</span><textarea rows="3" aria-label="Post caption" data-edit="${d.id}" ${sched ? 'readonly' : ''}>${esc(d.caption ?? '')}</textarea><span class="ct-tags">${(d.tags ?? []).map((x) => `<span class="pill plain">${esc(x)}</span>`).join('')}</span></label>
    </div>
    ${hist ? `<div class="sh"><h2>History</h2></div><ul class="group ct-hist">${hist}</ul>` : ''}
    ${bar(sched ? `<span class="ct-bar-done">${I.check}<span><b>${REAL && d.postStatus === 'dry-run' ? 'Approved · dry run' : `Scheduled · ${esc(d.post ?? '')}`}</b><small>${esc(d.ch)} ${posting() ? 'through RealFlow' : '· nothing went to RealFlow'}</small></span></span><button class="btn sm" data-act="ct-unapprove" data-id="${d.id}">${I.undo}Undo</button>`
      : canApprove ? `<button class="btn" data-act="ct-note" data-id="${d.id}">${I.edit}Send back</button><button class="btn primary ct-grow ct-btn2" style="--c:var(--content-fill)" data-act="ct-approve" data-id="${d.id}">${I.check}<span><b>Approve</b><small>${d.post ? `posts ${esc(d.post)}` : esc(slotShort(d))}</small></span></button>`
      : `<button class="btn block" data-act="ct-note" data-id="${d.id}">${I.edit}Add a note for the editor</button>`, sched ? 'ct-bar-ok' : '')}`;
  wireSegs(sc);
  $('[data-seg="ct-ver"]', sc)?.addEventListener('change', (e) => { page._v = Number(e.detail); stopPlay(); drawEdit(sc, page); });
  if (keepV) $('.ct-pl-frame', sc)?.prepend(keepV);
  if (REAL) attachMedia(page);
  pulse(sc);
}
const capFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
function stopPlay() { if (PL) { cancelAnimationFrame(PL.raf); PL.on = false; } }
on('ct-play', (el) => {
  const d = edit(el.dataset.id); const page = el.closest('.page'); if (!d || !page) return;
  if (REAL) {
    const v = $('video', page);
    if (!v) { toast(page._mediaErr ?? 'Loading the render from your PC'); return; }
    if (v.paused) v.play().catch(() => toast('The render didn\'t start')); else v.pause();
    return;
  }
  if (PL?.id === d.id && PL.on) { stopPlay(); paintPlayer(page, d); return; }
  if (PL?.id !== d.id || PL.t >= d.len) PL = { id: d.id, t: 0 };
  PL.on = true; PL.last = 0;
  const step = (ts) => {
    if (!PL?.on || !page.isConnected) return;
    PL.t = Math.min(d.len, PL.t + (PL.last ? (ts - PL.last) / 1000 : 0)); PL.last = ts;
    paintPlayer(page, d);
    if (PL.t >= d.len) { PL.on = false; paintPlayer(page, d); return; }
    PL.raf = requestAnimationFrame(step);
  };
  PL.raf = requestAnimationFrame(step);
  paintPlayer(page, d);
});
function paintPlayer(page, d) {
  const fr = $('.ct-pl-frame', page); if (!fr) return;
  const t = PL?.id === d.id ? PL.t : 0;
  $('svg', fr).outerHTML = playerSvg(d, t, page._v ?? d.v, PL?.id === d.id && PL.on);
  const b = $('.ct-pl-play', fr); const on1 = PL?.id === d.id && PL.on;
  b.innerHTML = on1 ? I.pause : I.play; b.setAttribute('aria-label', on1 ? 'Pause' : 'Play'); b.classList.toggle('playing', on1);
  $('.ct-pl-fill', page)?.style.setProperty('--p', (t / d.len).toFixed(4));
  const tm = $('.ct-pl-time', page); if (tm) tm.textContent = `${dur(t)} / ${dur(d.len)}`;
}
on('ct-safe', (el) => { const page = el.closest('.page'); if (!page) return; page._safe = !page._safe; $('.ct-pl-frame', page)?.classList.toggle('safe', page._safe); el.classList.toggle('on', page._safe); el.setAttribute('aria-pressed', String(page._safe)); haptic(5); });
// the open slots this channel has in the next week (real: its slot times minus what's booked)
function openSlotsFor(ch, days = 7) {
  const k = chOf(ch); const out = [];
  const taken = new Set(POSTS.filter((p) => p.ch === k.id && p.s !== 'posted').map((p) => p.at && new Date(p.at).toISOString()));
  for (let i = 0; i < days; i++) {
    const iso = clock.addDays(clock.today(), i);
    for (const t of k.slots) {
      const [h, m] = t.split(':').map(Number); const at = clock.toIso(iso, h * 60 + m);
      if (Date.parse(at) > clock.nowMs() + 30 * 60000 && !taken.has(new Date(at).toISOString())) out.push({ iso, t, at });
    }
  }
  return out;
}
on('ct-slot-change', (el) => {
  const d = edit(el.dataset.id); if (!d) return;
  if (REAL) {
    const opts = openSlotsFor(d.ch).slice(0, 8);
    openSheet({ title: 'Post when', sub: `${esc(d.ch)}'s open slots`,
      body: (b) => { b.innerHTML = opts.length ? `<div class="group">${opts.map((o) => `<button class="row" data-act="ct-slot-pick" data-id="${d.id}" data-at="${o.at}"><span class="rbody"><span class="rtitle">${esc(clock.dayLabel(o.iso))} ${esc(o.t)}</span></span>${o.at === d.pickAt ? `<span class="ct-tick">${I.check}</span>` : ''}</button>`).join('')}</div>`
        : `<div class="pad"><p class="note">No open slot: ${esc(d.ch)} has no posting times yet.</p><button class="btn block" data-act="ct-go" data-v="calendar">Set posting slots</button></div>`; } });
    return;
  }
  const opts = [['Sat 12:00', 5], ['Sat 19:30', 5], ['Sun 12:00', 6], ['Sun 19:30', 6]];
  openSheet({ title: 'Post when', sub: `${esc(d.ch)}'s open slots this week`,
    body: (b) => { b.innerHTML = `<div class="group">${opts.map(([o]) => `<button class="row" data-act="ct-slot-pick" data-id="${d.id}" data-v="${o}"><span class="rbody"><span class="rtitle">${esc(o)}</span>${o === 'Sun 12:00' ? `<span class="rmeta">Keeps Sunday's streak day too</span>` : ''}</span>${o === d.post ? `<span class="ct-tick">${I.check}</span>` : ''}</button>`).join('')}</div>`; } });
});
on('ct-slot-pick', (el) => {
  const d = edit(el.dataset.id); if (!d) return;
  closeSheet(el.closest('.sheet'));
  if (REAL) { d.pickAt = el.dataset.at; redraw('edits'); toast(`Posts ${clock.dayLabel(clock.dateOfIso(d.pickAt))} ${clock.hm(clock.toMin(d.pickAt, clock.dateOfIso(d.pickAt)))} once you approve`); return; }
  d.post = el.dataset.v; redraw('edits'); toast(`Posts ${d.post} once you approve`);
});

// send back with a note: typed, said, or one tap on a common fix
on('ct-note', (el) => {
  const d = edit(el.dataset.id); if (!d) return;
  openSheet({
    title: 'Send back to the editor', sub: esc(d.title),
    body: (b) => {
      b.innerHTML = `<div class="pad ct-notesheet">
        <div class="chips">${['Cut the intro', 'Bigger captions', 'Music lower', 'End on the payoff'].map((t) => `<button class="chip sm" data-fix="${esc(t)}">${esc(t)}</button>`).join('')}</div>
        <label class="field ct-ta"><textarea rows="3" placeholder="What should change?" aria-label="Note for the editor"></textarea></label>
        <div class="ct-newacts"><button class="btn" data-act="ct-note-voice">${I.mic}Say it</button><button class="btn primary" style="--c:var(--content-fill)" data-act="ct-note-send" data-id="${d.id}" disabled>Send back</button></div>
      </div>`;
      const ta = $('textarea', b), btn = $('[data-act="ct-note-send"]', b);
      ta.addEventListener('input', () => { btn.disabled = !ta.value.trim(); });
      $$('[data-fix]', b).forEach((c) => c.addEventListener('click', () => { ta.value = ta.value ? `${ta.value.replace(/\.?$/, '.')} ${c.dataset.fix}.` : `${c.dataset.fix}.`; btn.disabled = false; haptic(5); }));
    },
  });
});
on('ct-note-voice', () => { closeSheet(); api.openCapture('voice', { about: 'content' }); });
on('ct-note-send', (el) => {
  const d = edit(el.dataset.id); const v = el.closest('.sheet')?.querySelector('textarea')?.value.trim(); if (!d || !v) return;
  closeSheet(el.closest('.sheet'));
  if (REAL) { send('note', { edit: d.id, text: v }); redraw('edits'); toast('Sent back. The next cut lands here for your OK'); return; }
  const was = d.status; d.status = 'redo'; d.history = [...(d.history ?? []), ['note', 'Now', v]];
  redraw('edits');
  toast(`Sent back. v${d.v + 1} lands here when it's cut`, () => { d.status = was; d.history.pop(); redraw('edits'); });
});

// ── the calendar: slots per channel; an open slot is a place to fill ─────
let calView = 'week', gridCh = '@northwindstudio';
const DAYNAME = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };
function openCalendar(view) {
  if (['week', 'month', 'grid'].includes(view)) calView = view;
  const page = push({ title: 'Calendar', back: 'Content', right: askBtn(), cls: 'ct-page', render(sc) { drawCal(sc); enter(sc); } });
  const off = onRedraw(() => { if (page.isConnected) drawCal($('.scroll', page)); });
  page._opts.onPop = off;
}
route('calendar', openCalendar);
route('posts', openCalendar);
const chState = (ps, ch) => { const q = ps.filter((p) => p.ch === ch); return q.some((p) => p.s === 'posted') ? 'posted' : q.some((p) => p.s === 'review') ? 'review' : q.some((p) => p.s === 'scheduled' || p.s === 'dry') ? 'scheduled' : 'open'; };
const dayCell = (w) => `<button class="ct-wcell ${w.today ? 'today' : ''}" data-act="ct-calday" data-iso="${w.iso}" aria-label="${w.d} ${w.n}"><span class="ct-wd">${w.d[0]}</span><b class="num">${w.n}</b><span class="ct-wdots">${CHS.map((k) => `<i class="${chState(w.posts, k.id)}" style="--t:${k.tint}"></i>`).join('')}</span></button>`;
function slotRow(p) {
  const posted = p.s === 'posted';
  const end = posted ? (p.views != null ? `<span class="ct-views"><b class="met">${kfmt(p.views)}</b><small>views</small></span>` : '')
    : p.s === 'review' ? `<button class="btn sm" data-act="ct-edit" data-id="${p.edit}">Review</button>`
    : p.edit && REAL ? `<button class="btn sm" data-act="ct-edit" data-id="${p.edit}">Open</button>` : '';
  const st = posted ? word(REAL ? 'Sent' : 'Posted', 'var(--ink-2)') : p.s === 'review' ? word('Needs your OK', 'var(--needs-ink)') : p.s === 'dry' ? word('Approved · dry run', 'var(--ink-2)') : word(REAL ? 'Booked in RealFlow' : 'Scheduled', 'var(--done)');
  return `<div class="row ct-slotrow ${p.s}">
    <span class="ct-slot-t num">${esc(p.t)}</span>
    ${cover(p.cover, { ch: p.ch, w: 34 })}
    <span class="rbody"><span class="rtitle wrap">${esc(p.title)}</span><span class="rmeta">${st}<span>·</span>${chDot(p.ch)}<span class="ell">${esc(p.ch)}</span></span></span>
    ${end}
  </div>`;
}
function openSlots(w) {
  if (!w || w.past) return [];
  const taken = new Set(w.posts.map((p) => `${p.ch}${p.t}`));
  const now = REAL ? clock.hm(clock.nowMin()) : '17:40';
  return CHS.flatMap((k) => k.slots.filter((t) => !taken.has(`${k.id}${t}`) && !(w.today && t <= now)).map((t) => ({ ch: k.id, t })));
}
function drawCal(sc) {
  const sched = REAL ? POSTS.filter((p) => (p.s === 'scheduled' || p.s === 'dry') && Date.parse(p.at) > clock.nowMs()) : S.week.flatMap((w) => w.posts.filter((p) => p.s === 'scheduled').map((p) => ({ ...p, w })));
  const next = sched[0];
  const nextLine = next ? (REAL ? `${clock.dayLabel(next.iso)} ${next.t}` : `${next.w.d} ${next.t}`) : '';
  let body = '';
  if (calView === 'week') {
    const shown = REAL ? S.week.filter((w) => !w.past) : [...S.week].filter((w) => w.n >= 20);
    const earlier = REAL ? S.week.filter((w) => w.past) : S.week.filter((w) => w.n < 20);
    body = `<div class="ct-wstrip">${S.week.map(dayCell).join('')}</div>
      <p class="ct-legend">${CHS.map((k) => `<span><i style="--t:${k.tint}"></i>${esc(k.id)}</span>`).join('')}<span class="ct-lg-k"><i class="ring"></i>booked</span></p>
      ${shown.map((w) => {
        const open = openSlots(w).filter((o) => S.ch === 'all' || o.ch === S.ch);
        const posts = w.posts.filter((p) => S.ch === 'all' || p.ch === S.ch);
        if (!posts.length && !open.length && !(REAL && (w.today || w.future))) return '';
        return `<div class="sh ct-calh" id="ctDay${w.iso}"><h2>${w.today ? 'Today' : w.tomorrow ? 'Tomorrow' : DAYNAME[w.d]} <span class="ct-calh-d">${w.today || w.tomorrow ? `${w.d} ` : ''}${w.n} ${esc(REAL ? clock.MONTHS[clock.dparts(w.iso).month].slice(0, 3) : 'Oct')}</span></h2>${posts.length ? `<span class="sh-count">${posts.length}</span>` : ''}</div>
          <div class="group">${posts.map((p) => slotRow(p)).join('')}${open.length ? `<div class="row ct-openrow"><span class="ct-slot-t num">${esc(open[0].t)}</span><span class="ct-cv-empty" aria-hidden="true">${I.plus}</span><span class="rbody"><span class="rtitle">${plural(open.length, 'open slot')}</span><span class="rmeta"><span class="ell">${open.map((o) => `${o.t} ${o.ch.replace('@', '')}`).join(' · ')}</span></span></span><button class="btn sm" data-act="ct-fill" data-iso="${w.iso}">Fill</button></div>`
            : !posts.length ? `<div class="row ct-openrow"><span class="ct-slot-t num"></span><span class="ct-cv-empty" aria-hidden="true">${I.plus}</span><span class="rbody"><span class="rtitle">Nothing booked</span><span class="rmeta"><span class="ell">${CHS.some((k) => k.slotsSet) ? 'Every slot that day has passed' : 'Set posting slots below to see open ones'}</span></span></span><button class="btn sm" data-act="ct-fill" data-iso="${w.iso}">Fill</button></div>` : ''}</div>`;
      }).join('')}
      ${earlier.length ? `<div class="sh"><h2>Earlier this week</h2></div>
      <div class="group">${earlier.map((w) => { const ps = w.posts.filter((p) => S.ch === 'all' || p.ch === S.ch); return `<div class="row"><span class="rbody"><span class="rtitle">${w.d} ${w.n}</span><span class="rmeta">${ps.length ? `${plural(ps.filter((p) => p.s === 'posted').length || ps.length, 'reel')}: ${esc(ps.map((p) => p.title).join(' · ').slice(0, 90))}` : word('No reel: the streak broke here', 'var(--ink-3)')}</span></span></div>`; }).join('')}</div>` : ''}`;
  } else if (calView === 'month') {
    if (REAL) {
      const t = clock.today(), p = clock.dparts(t);
      const first = `${t.slice(0, 8)}01`;
      const lead = (clock.dparts(first).dow + 6) % 7;
      const daysIn = new Date(Date.UTC(p.year, p.month + 1, 0)).getUTCDate();
      const cells = []; for (let i = 0; i < lead; i++) cells.push('<span class="ct-mcell pad0"></span>');
      let withReel = 0;
      for (let n = 1; n <= daysIn; n++) {
        const iso = `${t.slice(0, 8)}${String(n).padStart(2, '0')}`;
        const ps = POSTS.filter((x) => x.iso === iso);
        if (iso <= t && ps.some((x) => x.s === 'posted')) withReel++;
        cells.push(`<button class="ct-mcell ${iso === t ? 'today' : ''} ${iso > t ? 'later' : ''}" data-act="ct-calday" data-iso="${iso}" aria-label="${n} ${clock.MONTHS[p.month]}"><b class="num">${n}</b><span class="ct-wdots">${CHS.map((k) => `<i class="${chState(ps, k.id)}" style="--t:${k.tint}"></i>`).join('')}</span></button>`);
      }
      body = `<div class="ct-month"><div class="ct-mhead">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div><div class="ct-mgrid">${cells.join('')}</div></div>
        <p class="ct-legend">${CHS.map((k) => `<span><i style="--t:${k.tint}"></i>${esc(k.id)}</span>`).join('')}<span class="ct-lg-k"><i class="ring"></i>booked</span></p>
        <div class="group ct-mstats"><div class="row"><span class="rbody"><span class="rtitle">${esc(clock.MONTHS[p.month])} so far</span><span class="rmeta">${plural(withReel, 'day')} with a reel out of ${p.day}</span></span><span class="ct-views"><b class="met">${Math.round(withReel / p.day * 100)}%</b></span></div>
        <div class="row"><span class="rbody"><span class="rtitle">Best streak</span><span class="rmeta">Days in a row with a reel out</span></span><span class="ct-views"><b class="met">${STREAK.best}</b><small>days</small></span></div></div>`;
    } else {
      // October: what posted each day on each channel (mock history before this week)
      const hist = (n) => { if (n >= 19) { const w = S.week.find((x) => x.n === n); return CHS.map((k) => chState(w?.posts ?? [], k.id)); }
        const nd = [1, 2, 3, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17].includes(n), pl = [2, 5, 9, 11, 14, 16].includes(n); return [nd ? 'posted' : 'open', pl ? 'posted' : 'open']; };
      const cells = []; for (let i = 0; i < 3; i++) cells.push('<span class="ct-mcell pad0"></span>');   // 1 Oct 2026 is a Thursday
      for (let n = 1; n <= 31; n++) { const [a, b2] = hist(n); cells.push(`<button class="ct-mcell ${n === 22 ? 'today' : ''} ${n > 25 ? 'later' : ''}" data-act="ct-calday" data-iso="2026-10-${String(n).padStart(2, '0')}" aria-label="${n} October"><b class="num">${n}</b><span class="ct-wdots"><i class="${a}" style="--t:${CHS[0].tint}"></i><i class="${b2}" style="--t:${CHS[1].tint}"></i></span></button>`); }
      body = `<div class="ct-month"><div class="ct-mhead">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => `<span>${x}</span>`).join('')}</div><div class="ct-mgrid">${cells.join('')}</div></div>
        <p class="ct-legend">${CHS.map((k) => `<span><i style="--t:${k.tint}"></i>${esc(k.id)}</span>`).join('')}<span class="ct-lg-k"><i class="ring"></i>booked</span></p>
        <div class="group ct-mstats"><div class="row"><span class="rbody"><span class="rtitle">October so far</span><span class="rmeta">${plural(19, 'day')} with a reel out of 22</span></span><span class="ct-views"><b class="met">86%</b></span></div>
        <div class="row"><span class="rbody"><span class="rtitle">Best streak</span><span class="rmeta">7 to 17 Oct</span></span><span class="ct-views"><b class="met">${STREAK.best}</b><small>days</small></span></div></div>`;
    }
  } else {
    const k = chOf(gridCh);
    const posts = REAL ? POSTS.filter((p) => p.ch === gridCh).slice().reverse().slice(0, 30) : S.week.flatMap((w) => w.posts.filter((p) => p.ch === gridCh).map((p) => ({ ...p, w }))).reverse();
    const older = REAL ? [] : gridCh === '@northwindstudio' ? [['Claude can read my screen now', 'site'], ['I timed my own coding day', 'clock'], ['Five tabs I closed', 'apps'], ['A build log, day 12', 'desk'], ['What I’d tell a first year', 'clock'], ['The setup on my desk', 'desk']] : [['Coin in the chai', 'chai'], ['The rubber band jump', 'coin'], ['Card in the glass', 'card'], ['Dupatta in 10 seconds', 'kurta']];
    const st = STATS[k.id] ?? {};
    body = `<div class="ct-gridseg">${seg('ct-gridch', CHS.map((c) => [c.id, `${chAv(c.id)}${esc(c.short)}`]), gridCh, 'sm')}</div>
      <div class="ct-profile"><span class="ct-av lg" style="--t:${k.tint}">${esc(k.mono)}</span><div><b>${esc(k.id)}</b><span class="foot">${REAL ? `${plural(st.reels ?? 0, 'reel')} sent in 30 days` : `${k.followers.toLocaleString('en-IN')} followers`} · ${esc(k.focus)}</span></div></div>
      ${posts.length || older.length ? `<div class="ct-igrid">${posts.map((p) => `<span class="ct-gtile ${p.s}">${cover(p.cover, { ch: p.ch, w: 120, cls: 'ct-gcv' })}${p.s !== 'posted' ? `<span class="ct-gbadge">${p.s === 'review' ? '!' : I.clock}</span>` : p.views != null ? `<span class="ct-gviews num">${I.play}${kfmt(p.views)}</span>` : ''}</span>`).join('')}${older.map(([t, sc2]) => `<span class="ct-gtile posted">${cover({ lines: t.split(' ').length > 3 ? [t.split(' ').slice(0, 2).join(' '), t.split(' ').slice(2).join(' ')] : [t, ''], hi: 0, scene: sc2 }, { ch: gridCh, w: 120, cls: 'ct-gcv' })}</span>`).join('')}</div>
      <p class="hint">Scheduled reels sit first, the way the grid will look once they post.${REAL ? ' Covers are drawn from the titles; the real thumbnails stay in RealFlow.' : ''}</p>`
      : `<div class="note">Nothing has gone out on ${esc(k.id)} through RealFlow yet.</div>`}`;
  }
  sc.innerHTML = `${head({ title: 'Calendar', sub: next ? `${plural(sched.length, 'reel')} ${REAL ? 'booked' : 'scheduled'} · next ${nextLine}` : 'Nothing booked ahead' })}
    <div class="ct-vseg">${seg('ct-cal', [['week', 'Week'], ['month', 'Month'], ['grid', 'Grid']], calView)}</div>
    ${body}
    ${calView !== 'grid' ? `<div class="sh"><h2>Posting slots</h2></div>
    <div class="group">${CHS.map((k) => `<div class="row ct-slots">${chAv(k.id)}<span class="rbody"><span class="rtitle">${esc(k.id)}</span>
        <span class="ct-slotchips">${k.slots.map((t) => `<button class="ct-slotchip num" data-act="ct-slot-rm" data-ch="${k.id}" data-t="${t}" aria-label="Remove the ${t} slot">${t}</button>`).join('')}${REAL && !k.slots.length ? '<span class="foot">No times yet</span>' : ''}<button class="ct-slotchip ct-slot-add" data-act="ct-slot-add" data-ch="${k.id}" aria-label="Add a slot for ${esc(k.id)}">${I.plus}</button></span></span></div>`).join('')}</div>
    <p class="hint">Approve fills the next open slot. RealFlow posts at these times.</p>` : ''}`;
  wireSegs(sc);
  $('[data-seg="ct-cal"]', sc)?.addEventListener('change', (e) => { calView = e.detail; drawCal(sc); });
  $('[data-seg="ct-gridch"]', sc)?.addEventListener('change', (e) => { gridCh = e.detail; drawCal(sc); });
  pulse(sc);
}
on('ct-calday', (el) => {
  const iso = el.dataset.iso;
  const sc = el.closest('.scroll'); if (!sc) return;
  const inWeek = S.week.some((w) => w.iso === iso);
  if (calView !== 'week') {
    if (!inWeek) { const ps = REAL ? POSTS.filter((p) => p.iso === iso) : []; toast(ps.length ? `${clock.dayLabel(iso)}: ${ps.map((p) => p.title).join(' · ').slice(0, 80)}` : iso > (REAL ? clock.today() : '2026-10-22') ? 'Nothing planned that far yet' : 'No reel that day'); return; }
    calView = 'week'; drawCal(sc);
  }
  const t = $(`#ctDay${iso}`, sc);
  if (t) sc.scrollTo({ top: t.offsetTop - 110, behavior: reduced() ? 'auto' : 'smooth' });
});
on('ct-fill', (el) => {
  const iso = el.dataset.iso;
  const w = S.week.find((x) => x.iso === iso);
  const waiting = S.edits.filter((d) => d.status === 'review').length;
  openSheet({ title: 'Fill a slot', sub: w && !w.posts.length ? `${DAYNAME[w.d] ?? 'That day'} has no reel yet: one keeps the streak` : 'Approved edits and ready takes',
    body: (b) => { b.innerHTML = `<div class="group">
      ${REAL ? '' : `<button class="row ic" data-act="ct-fill-r1" data-iso="${iso}"><span class="tile">${I.film}</span><span class="rbody"><span class="rtitle">R1 · My phone runs five coding agents</span><span class="rmeta">Shoots tonight; the edit lands tomorrow at about 11:00</span></span>${I.chevR}</button>`}
      <button class="row ic" data-act="ct-go" data-v="edits"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle">From edits</span><span class="rmeta">${plural(waiting, 'edit')} waiting for your OK</span></span>${I.chevR}</button>
      ${REAL ? `<button class="row ic" data-act="ct-go" data-v="pack"><span class="tile">${I.camera}</span><span class="rbody"><span class="rtitle">From the shoot pack</span><span class="rmeta">Shoot it, and the edit lands for your OK</span></span>${I.chevR}</button>` : ''}
      <button class="row ic" data-act="ct-go" data-v="ideas"><span class="tile">${I.bulb}</span><span class="rbody"><span class="rtitle">From ideas</span><span class="rmeta">${esc(AGENT.name)} writes it in tonight's plan</span></span>${I.chevR}</button>
    </div>`; } });
});
on('ct-fill-r1', (el) => {
  const w = S.week.find((x) => x.iso === el.dataset.iso); closeSheet(el.closest('.sheet'));
  if (w && !w.posts.some((p) => p.title.startsWith('R1'))) { w.posts.push({ ch: '@northwindstudio', t: '09:00', title: 'R1 · five coding agents', s: 'scheduled', cover: { lines: ['Five agents.', 'One lecture.'], hi: 0, scene: 'agents' }, pencil: true }); }
  redraw('calendar'); toast(`Pencilled R1 into ${w?.d ?? 'that day'} 09:00. It books once you approve the edit`);
});
const setSlots = (k, slots) => send('settings', { values: { [`slots.${k.handle}`]: slots.length ? slots.join(',') : null } });
on('ct-slot-add', (el) => {
  const k = CHS.find((x) => x.id === el.dataset.ch); if (!k) return;
  if (REAL) {
    openSheet({ title: `A posting slot for ${k.id}`, sub: 'RealFlow posts at this time (IST)',
      body: (b) => { b.innerHTML = `<div class="pad ct-timesheet"><label class="field"><span class="foot">Time</span><input type="time" value="${k.slots.length ? '19:00' : '12:30'}" aria-label="Slot time" /></label><div class="ct-newacts"><button class="btn primary" style="--c:var(--content-fill)" data-act="ct-slot-save" data-ch="${k.id}">Add slot</button></div></div>`; } });
    return;
  }
  const extra = ['21:00', '07:30', '15:00'].find((t) => !k.slots.includes(t)); if (!extra) { toast('That\'s every slot'); return; }
  k.slots.push(extra); k.slots.sort(); redraw('calendar'); haptic(6);
  toast(`Slot added · ${k.id} at ${extra}`, () => { k.slots = k.slots.filter((t) => t !== extra); redraw('calendar'); });
});
on('ct-slot-save', (el) => {
  const k = CHS.find((x) => x.id === el.dataset.ch); const v = el.closest('.sheet')?.querySelector('input')?.value; closeSheet(el.closest('.sheet'));
  if (!k || !/^\d{2}:\d{2}$/.test(v ?? '')) return;
  if (k.slots.includes(v)) { toast('That slot is already there'); return; }
  const next = [...k.slots, v].sort(); const was = [...k.slots];
  setSlots(k, next); haptic(6); redraw('calendar');
  toast(`Slot added · ${k.id} at ${v}`, () => { setSlots(k, was); redraw('calendar'); });
});
on('ct-slot-rm', (el) => {
  const k = CHS.find((x) => x.id === el.dataset.ch); if (!k) return;
  const t = el.dataset.t; const was = [...k.slots];
  if (REAL) setSlots(k, was.filter((x) => x !== t)); else k.slots = was.filter((x) => x !== t);
  haptic(6); redraw('calendar');
  toast(`Removed the ${t} slot`, () => { if (REAL) setSlots(k, was); else k.slots = was; redraw('calendar'); });
});

// ── stats: what went out against the goal, what's working, what the loop changed ──
let statCh = '@northwindstudio';
function openStats(ch) {
  if (ch && STATS[ch]) statCh = ch;
  const page = push({ title: 'Stats', back: 'Content', right: askBtn(), cls: 'ct-page', render(sc) { drawStats(sc); enter(sc); } });
  const off = onRedraw(() => { if (page.isConnected) drawStats($('.scroll', page)); });
  page._opts.onPop = off;
}
route('stats', openStats);
const niceStep = (max) => { const raw = Math.max(1, max / 4); const p = 10 ** Math.floor(Math.log10(raw)); return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw; };
function lineChart(st, key = 'followers', step = 500, label = 'Followers') {
  const W = 338, H = 156, L = 34, R = 12, T = 14, B = 26;
  if (key === 'sent') step = niceStep(Math.max(...st[key]));
  const v = st[key]; const lo = Math.floor(Math.min(...v) / step) * step, hi = Math.max(lo + step, Math.ceil(Math.max(...v) / step) * step);
  const x = (i) => L + i * (W - L - R) / (v.length - 1), y = (n) => T + (hi - n) / (hi - lo) * (H - T - B);
  const pts = v.map((n, i) => `${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ');
  const ticks = []; for (let n = lo; n <= hi; n += step) ticks.push(n);
  return `<svg class="ct-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}, last ${v.length} weeks: ${v[0].toLocaleString('en-IN')} to ${v[v.length - 1].toLocaleString('en-IN')}">
    ${ticks.map((n) => `<line class="gl" x1="${L}" x2="${W - R}" y1="${y(n)}" y2="${y(n)}"/><text class="ax" x="${L - 6}" y="${y(n) + 4}" text-anchor="end">${kfmt(n)}</text>`).join('')}
    <polygon class="area" points="${x(0)},${y(lo)} ${pts} ${x(v.length - 1)},${y(lo)}"/>
    <polyline class="ln" points="${pts}"/>
    <circle class="end" cx="${x(v.length - 1)}" cy="${y(v[v.length - 1])}" r="4.5"/>
    <text class="ax" x="${x(0)}" y="${H - 6}">${esc(st.weeks[0])}</text><text class="ax" x="${x(v.length - 1)}" y="${H - 6}" text-anchor="end">${esc(st.weeks[st.weeks.length - 1])}</text>
    <g class="ct-hover" hidden><line class="cross" y1="${T}" y2="${H - B}"/><circle class="hd" r="4.5"/></g>
  </svg><div class="ct-tip" hidden></div>`;
}
const bars = (rows, fmt, unit) => {
  const max = Math.max(...rows.map((r) => r[1]));
  return `<div class="ct-bars">${rows.map(([label, n, reels], i) => `<div class="ct-barrow ${i === 0 ? 'top' : ''}"><span class="ct-bar-l">${esc(label)}<small>${plural(reels, 'reel')}</small></span><span class="ct-bar-t"><i style="--w:${(n / max * 100).toFixed(1)}%"></i></span><b class="num">${fmt(n)}${unit}</b></div>`).join('')}</div>`;
};
function drawStats(sc) {
  if (REAL) { drawRealStats(sc); return; }
  const st = STATS[statCh], k = chOf(statCh);
  const g = k.goal ? GOALS.find((x) => x.id === k.goal) : null;
  const last = st.followers[st.followers.length - 1], prev = st.followers[st.followers.length - 2];
  const perDay = (last - prev) / 7;
  const proj = Math.round((last + perDay * 9) / 10) * 10;
  const learned = S.learn.filter((l) => !l.ch || l.ch === statCh).slice(0, 2);
  sc.innerHTML = `${head({ title: 'Stats', sub: 'Last 30 days' })}
    <div class="ct-vseg">${seg('ct-statch', CHS.map((c) => [c.id, `${chAv(c.id)}${esc(c.short)}`]), statCh, 'sm')}</div>
    <section class="surface ct-shero">
      <div class="ct-shero-m">
        <div><span class="ct-k">Followers</span><b class="ct-hero-n" data-count="${last}">${last.toLocaleString('en-IN')}</b><span class="ct-delta">${I.up}+${(last - prev).toLocaleString('en-IN')} this week</span></div>
        ${g ? ring(g.pace, 'content', 76, 7, { k: g.time, inner: `<span class="ct-ring-in"><b class="met">${Math.round(g.pace * 100)}</b><small class="met">%</small></span>`, label: `${Math.round(g.pace * 100)}% of the goal, ${Math.round(g.time * 100)}% of the month gone` }) : ''}
      </div>
      ${g ? `<p class="ct-verdict"><b>${esc(g.verdict)}.</b> ${(5000 - last).toLocaleString('en-IN')} to go for 5,000 with 9 days left. At this week's pace, about ${proj.toLocaleString('en-IN')} by 31 Oct.</p>
      <button class="row ct-goalrow" data-act="ct-goal" data-id="${g.id}">${I.target}<span class="rbody"><span class="rtitle wrap">${esc(g.title)}</span><span class="rmeta">The goal in Mission · this month</span></span>${I.chevR}</button>` : `<p class="ct-verdict">No follower goal on this channel. It's for fun; the numbers just show what lands.</p>`}
    </section>
    <div class="sh"><h2>Followers</h2><span class="sh-count">8 weeks</span></div>
    <section class="surface ct-chartcard">${lineChart(st)}</section>
    <div class="ct-tiles">
      <div class="ct-tile surface"><span class="ct-k">Reels</span><b class="met">${st.reels}</b></div>
      <div class="ct-tile surface"><span class="ct-k">Views</span><b class="met">${kfmt(st.views)}</b></div>
      <div class="ct-tile surface"><span class="ct-k">Held past 3 s</span><b class="met">${st.hold}<small>%</small></b></div>
      <div class="ct-tile surface"><span class="ct-k">New follows</span><b class="met">${st.follows}</b></div>
    </div>
    <div class="sh"><h2>What's working</h2></div>
    <section class="surface ct-work">
      <h3 class="ct-work-h">Hook <small>share of viewers held past 3 seconds</small></h3>${bars(st.hook, (n) => n, '%')}
      <h3 class="ct-work-h">Format <small>average views</small></h3>${bars(st.format, kfmt, '')}
      <h3 class="ct-work-h">Topic <small>average views</small></h3>${bars(st.topic, kfmt, '')}
    </section>
    <div class="sh"><h2>What ${esc(AGENT.name)} changed</h2><button class="sh-act" data-act="ct-go" data-v="learning">All ${I.chevR}</button></div>
    <div class="group">${learned.map((l) => `<button class="row" data-act="ct-go" data-v="learning"><span class="rbody"><span class="rtitle wrap">${esc(l.rule)}</span><span class="rmeta"><span class="ell">${esc(l.from)}</span></span></span>${I.chevR}</button>`).join('')}</div>`;
  wireSegs(sc);
  $('[data-seg="ct-statch"]', sc)?.addEventListener('change', (e) => { statCh = e.detail; drawStats(sc); });
  wireChart(sc, st);
  pulse(sc);
}
// real: what the PC knows. Reels that went out (the RealFlow ledger), the streak, the loop's verdicts; follower counts,
// views and holds aren't on the PC, so those sections say so instead of guessing (no mock numbers shown as real)
function drawRealStats(sc) {
  const st = STATS[statCh] ?? {}, k = chOf(statCh);
  const g = k.goal ? GOALS.find((x) => x.id === k.goal) : null;
  const sent = st.sent ?? [];
  const thisWeek = sent[sent.length - 1] ?? 0, lastWeek = sent[sent.length - 2] ?? 0;
  const learned = S.learn.filter((l) => l.on).slice(0, 2);
  sc.innerHTML = `${head({ title: 'Stats', sub: 'What went out, from the RealFlow ledger' })}
    <div class="ct-vseg">${seg('ct-statch', CHS.map((c) => [c.id, `${chAv(c.id)}${esc(c.short)}`]), statCh, 'sm')}</div>
    <section class="surface ct-shero">
      <div class="ct-shero-m">
        <div><span class="ct-k">Reels sent · 30 days</span><b class="ct-hero-n" data-count="${st.reels ?? 0}">${st.reels ?? 0}</b><span class="ct-delta">${thisWeek} this week · ${lastWeek} last week</span></div>
        ${ring(Math.min(1, STREAK.n / 7), 'content', 76, 7, { inner: `<span class="ct-ring-in"><b class="met">${STREAK.n}</b><small class="met">d</small></span>`, label: `${STREAK.n}-day streak` })}
      </div>
      <p class="ct-verdict">${st.ahead ? `<b>${plural(st.ahead, 'reel')} booked ahead.</b> ` : ''}Follower numbers aren't on your PC yet: RealFlow doesn't send Instagram's counts back, so this page shows what went out, not who followed.</p>
      ${g ? `<button class="row ct-goalrow" data-act="ct-goal" data-id="${g.id}">${I.target}<span class="rbody"><span class="rtitle wrap">${esc(g.title)}</span><span class="rmeta">The goal in Mission</span></span>${I.chevR}</button>` : ''}
    </section>
    <div class="sh"><h2>Reels a week</h2><span class="sh-count">${sent.length} weeks</span></div>
    ${sent.some((n) => n > 0) ? `<section class="surface ct-chartcard">${lineChart(st, 'sent', 2, 'Reels sent')}</section>` : `<div class="note">Nothing has gone out on ${esc(k.id)} in the last 8 weeks.</div>`}
    <div class="ct-tiles">
      <div class="ct-tile surface"><span class="ct-k">Sent · 30 days</span><b class="met">${st.reels ?? 0}</b></div>
      <div class="ct-tile surface"><span class="ct-k">Booked ahead</span><b class="met">${st.ahead ?? 0}</b></div>
      <div class="ct-tile surface"><span class="ct-k">Ideas kept · 30 d</span><b class="met">${META.kept30}</b></div>
      <div class="ct-tile surface"><span class="ct-k">Ideas killed · 30 d</span><b class="met">${META.killed30}</b></div>
    </div>
    <div class="sh"><h2>What's working</h2></div>
    <div class="note ct-empty-work">${CI.chart}<span>Views, holds and follows by hook, format and topic need Instagram's insights for each reel. They aren't on your PC yet, so there's nothing honest to rank.</span></div>
    ${st.top?.length ? `<div class="sh"><h2>Latest out</h2></div><div class="group">${st.top.map((t) => `<div class="row"><span class="rbody"><span class="rtitle wrap">${esc(t)}</span></span></div>`).join('')}</div>` : ''}
    <div class="sh"><h2>What the loop learned</h2><button class="sh-act" data-act="ct-go" data-v="learning">All ${I.chevR}</button></div>
    ${learned.length ? `<div class="group">${learned.map((l) => `<button class="row" data-act="ct-go" data-v="learning"><span class="rbody"><span class="rtitle wrap ct-clamp2">${esc(l.rule)}</span><span class="rmeta"><span class="ell">${esc(l.from)}</span></span></span>${I.chevR}</button>`).join('')}</div>` : '<div class="note">No rules yet. Your verdicts in the deck become them.</div>'}`;
  wireSegs(sc);
  $('[data-seg="ct-statch"]', sc)?.addEventListener('change', (e) => { statCh = e.detail; drawStats(sc); });
  if (sent.some((n) => n > 0)) wireChart(sc, st, 'sent', niceStep(Math.max(...sent)));
  pulse(sc);
}
// hover: the nearest week's value under a crosshair
function wireChart(sc, st, key = 'followers', step = 500) {
  const svg = $('.ct-chart', sc), tip = $('.ct-tip', sc); if (!svg || !tip) return;
  const v = st[key];
  const W = 338, L = 34, R = 12, n = v.length;
  const lo = Math.floor(Math.min(...v) / step) * step, hi = Math.max(lo + step, Math.ceil(Math.max(...v) / step) * step);
  const show = (e) => {
    const r = svg.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(n - 1, Math.round((px - L) / ((W - L - R) / (n - 1)))));
    const x = L + i * (W - L - R) / (n - 1), y = 14 + (hi - v[i]) / (hi - lo) * (156 - 14 - 26);
    const g = $('.ct-hover', svg); g.hidden = false;
    $('.cross', g).setAttribute('x1', x); $('.cross', g).setAttribute('x2', x); $('.hd', g).setAttribute('cx', x); $('.hd', g).setAttribute('cy', y);
    tip.hidden = false; tip.innerHTML = `<b class="num">${v[i].toLocaleString('en-IN')}</b><span>${key === 'sent' ? `${v[i] === 1 ? 'reel' : 'reels'} · week of` : 'week of'} ${esc(st.weeks[i])}</span>`;
    tip.style.left = `${Math.max(8, Math.min(r.width - 120, x / W * r.width - 56))}px`;
  };
  svg.addEventListener('pointermove', show); svg.addEventListener('pointerdown', show);
  svg.addEventListener('pointerleave', () => { $('.ct-hover', svg).hidden = true; tip.hidden = true; });
}
on('ct-goal', (el) => api.openGoal(el.dataset.id || 'g3'));

// ── what the learning loop changed: rules from verdicts and numbers, each with its receipts ──
const learnTitle = () => (REAL ? 'What the loop learned' : `What ${AGENT.name} learned`);
function openLearning() {
  const page = push({ title: learnTitle(), back: 'Content', right: askBtn(), cls: 'ct-page', render(sc) { drawLearning(sc); enter(sc); } });
  const off = onRedraw(() => { if (page.isConnected) drawLearning($('.scroll', page)); });
  page._opts.onPop = off;
}
route('learning', openLearning);
function drawLearning(sc) {
  const on1 = S.learn.filter((l) => l.on).length;
  sc.innerHTML = `${head({ title: learnTitle(), sub: S.learn.length ? `${on1} ${on1 === 1 ? 'rule shapes' : 'rules shape'} ${REAL ? 'the next scripts' : 'tonight\'s ideas and scripts'}` : 'Nothing learned yet' })}
    ${S.proposals.map((p) => `<section class="surface ct-propose">
      <p class="ct-propose-k">${I.sparkle}<span>New this week, waiting for your yes</span></p>
      <b class="ct-propose-t">${esc(p.rule)}</b>
      <p class="foot">${esc(p.from)}</p>
      <div class="ct-newacts"><button class="btn sm" data-act="ct-prop" data-id="${p.id}" data-v="no">Not now</button><button class="btn sm primary" style="--c:var(--content-fill)" data-act="ct-prop" data-id="${p.id}" data-v="yes">${esc(p.act)}</button></div>
    </section>`).join('')}
    ${REAL ? `<div class="ct-tiles"><div class="ct-tile surface"><span class="ct-k">Kept · 30 days</span><b class="met">${META.kept30}</b></div><div class="ct-tile surface"><span class="ct-k">Killed · 30 days</span><b class="met">${META.killed30}</b></div></div>
      <p class="hint">Ideas that look like ones you killed are scored down; ones like those you kept are scored up. The rules below go to the script writer.</p>` : ''}
    <div class="sh"><h2>Rules</h2><span class="sh-count">${REAL ? META.rules || S.learn.length : S.learn.length}</span></div>
    ${S.learn.length ? `<div class="group">${S.learn.map((l) => `<button class="row ct-rule" data-act="ct-rule" data-id="${l.id}" aria-pressed="${l.on}">
      <span class="rbody"><span class="rtitle wrap ${REAL ? 'ct-clamp3' : ''}">${esc(l.rule)}</span><span class="ct-rule-from">${esc(l.from)}. Since ${esc(l.since)}.</span><span class="ct-rule-s">${l.fresh ? word('New', 'var(--content-ink)') : ''}<span class="foot">Shapes ${esc(l.shapes.toLowerCase())}${l.ch ? ` on ${esc(l.ch)}` : ''}</span></span></span>
      <span class="switch ${l.on ? 'on' : ''}" aria-hidden="true"></span>
    </button>`).join('')}</div>` : '<div class="note">No rules yet. Edit notes and content-os lessons land here.</div>'}
    <p class="hint">Turn a rule off and it stops shaping ${REAL ? 'the scripts written from now on' : 'ideas and scripts from tonight\'s plan'}.</p>
    <div class="sh"><h2>Your verdicts</h2><span class="sh-count">${S.verdicts.length}</span></div>
    ${S.verdicts.length ? `<div class="group">${S.verdicts.slice(0, 12).map((v) => `<div class="row ic"><span class="tile ct-vk ${v.v}">${v.v === 'kill' ? CI.kill : CI.keep}</span><span class="rbody"><span class="rtitle">${esc(v.title)}</span><span class="rmeta"><span class="ell">${v.v === 'kill' ? 'Killed' : 'Kept'} ${esc(v.at)}${v.why ? ` · ${esc(v.why)}` : ''}</span></span></span></div>`).join('')}</div>` : '<div class="note">No verdicts yet. Sort new ideas: right keeps, left kills.</div>'}`;
  pulse(sc);
}
on('ct-rule', (el) => {
  const l = S.learn.find((x) => x.id === el.dataset.id); if (!l) return;
  haptic(6);
  if (REAL) {
    const on2 = !l.on;
    send('rule', { learning: l.id, on: on2 }); redraw('learning');
    toast(on2 ? 'On: it shapes the next scripts' : 'Off: the script writer stops using it', () => { send('rule', { learning: l.id, on: !on2 }); redraw('learning'); });
    return;
  }
  l.on = !l.on; redraw('learning');
  toast(l.on ? `On: ${l.rule}` : `Off from tonight: ${l.rule}`, () => { l.on = !l.on; redraw('learning'); });
});
on('ct-prop', (el) => {
  const i = S.proposals.findIndex((x) => x.id === el.dataset.id); if (i < 0) return;
  const [p] = S.proposals.splice(i, 1);
  if (el.dataset.v === 'yes') {
    const k = CHS[0]; const was = [...k.slots]; k.slots = ['09:00', '12:30'];
    S.learn.unshift({ id: `l${Date.now()}`, on: true, rule: p.rule, ch: '@northwindstudio', from: p.from, since: 'today', shapes: 'Slots', fresh: true });
    toast('Moved: @northwindstudio posts at 09:00 and 12:30', () => { k.slots = was; S.learn.shift(); S.proposals.splice(i, 0, p); redraw('learning'); });
  } else toast('Not now. It asks again if the numbers hold', () => { S.proposals.splice(i, 0, p); redraw('learning'); });
  redraw('learning');
});

// ── a channel: one engine, its own identity ──────────────────────────────
function openChannel(id) {
  const k = chOf(id);
  const page = push({ title: k.id, back: 'Content', right: askBtn(), cls: 'ct-page', render(sc) { drawChannel(sc, k); enter(sc); } });
  const off = onRedraw(() => { if (page.isConnected) drawChannel($('.scroll', page), k); });
  page._opts.onPop = off;
}
route('channel', openChannel);
function drawChannel(sc, k) {
  const st = STATS[k.id] ?? {};
  const posts = REAL ? S.week.flatMap((w) => w.posts.filter((p) => p.ch === k.id)) : S.week.flatMap((w) => w.posts.filter((p) => p.ch === k.id));
  const everRF = POSTS.some((p) => p.ch === k.id && p.realflow);
  sc.innerHTML = `<div class="phead ct-chhead">
      <span class="ct-av xl" style="--t:${k.tint}" aria-hidden="true">${esc(k.mono)}</span>
      <h1 class="title1">${esc(k.id)}</h1>
      <p class="sub">${esc(k.focus)}</p>
    </div>
    <div class="ct-tiles">
      ${REAL ? `<div class="ct-tile surface"><span class="ct-k">Sent · 30 days</span><b class="met">${st.reels ?? 0}</b><span class="foot">${st.ahead ? `${st.ahead} booked ahead` : 'nothing booked ahead'}</span></div>
      <div class="ct-tile surface"><span class="ct-k">Streak</span><b class="met">${STREAK.n}<small> d</small></b><span class="foot">either channel counts</span></div>`
      : `<div class="ct-tile surface"><span class="ct-k">Followers</span><b class="met">${k.followers.toLocaleString('en-IN')}</b><span class="ct-delta">${I.up}+${k.delta} this week</span></div>
      <div class="ct-tile surface"><span class="ct-k">Held past 3 s</span><b class="met">${st.hold}<small>%</small></b><span class="foot">${st.reels} reels in 30 days</span></div>`}
    </div>
    <div class="sh"><h2>How it sounds and looks</h2></div>
    <div class="group">
      <div class="row ic"><span class="tile">${I.chat}</span><span class="rbody"><span class="rtitle">Voice</span><span class="rmeta"><span class="ell">${esc(k.voice)}</span></span></span></div>
      ${k.look ? `<div class="row ic"><span class="tile">${I.brush}</span><span class="rbody"><span class="rtitle">${REAL ? 'Setup' : 'Look'}</span><span class="rmeta"><span class="ell">${esc(k.look)}</span></span></span></div>` : ''}
      <div class="row ic"><span class="tile">${CI.layers}</span><span class="rbody"><span class="rtitle">Reels a day</span><span class="rmeta">The nightly plan writes this many${REAL && !k.perDaySet ? ' · the default until you set it' : ''}</span></span><span class="rend num">${k.perDay}</span></div>
    </div>
    <div class="sh"><h2>Posting</h2></div>
    <div class="group">
      <button class="row ic" data-act="ct-go" data-v="calendar"><span class="tile">${I.clock}</span><span class="rbody"><span class="rtitle">Slots</span><span class="rmeta">${k.slots.length ? k.slots.join(' · ') : 'None yet: approvals have no slot to take'}</span></span>${I.chevR}</button>
      <div class="row ic"><span class="tile">${I.sync}</span><span class="rbody"><span class="rtitle">RealFlow</span><span class="rmeta">${REAL ? (posting() ? word(everRF ? 'Posting through it' : 'On, no posts recorded yet', 'var(--done)') : word(everRF ? 'Dry run here: posting is off on your PC' : 'No RealFlow posts recorded', 'var(--ink-2)')) : word('Connected', 'var(--done)')}<span>·</span><span class="ell">Approve schedules here</span></span></span></div>
      <div class="row ic"><span class="tile">${I.cal}</span><span class="rbody"><span class="rtitle">This week</span><span class="rmeta"><span class="ell">${posts.filter((p) => p.s === 'posted').length} ${REAL ? 'sent' : 'posted'} · ${posts.filter((p) => p.s !== 'posted').length} ahead</span></span></span></div>
    </div>
    <div class="group ct-chlinks">
      <button class="row ic" data-act="ct-chstats" data-ch="${k.id}"><span class="tile">${CI.chart}</span><span class="rbody"><span class="rtitle">Stats for ${esc(k.short)}</span></span>${I.chevR}</button>
      <button class="row ic" data-act="ct-chgrid" data-ch="${k.id}"><span class="tile">${CI.grid}</span><span class="rbody"><span class="rtitle">The profile grid</span></span>${I.chevR}</button>
    </div>`;
  pulse(sc);
}
on('ct-chstats', (el) => openStats(el.dataset.ch));
on('ct-chgrid', (el) => { gridCh = el.dataset.ch; calView = 'grid'; openCalendar(); });

export { openEdits, openEdit, openCalendar, openStats, openLearning, openChannel };

// Content OS · making the reel: Scripts (hook, beats, CTA, the ready check and the agent's rewrite with revert), the shoot
// pack (setups that group takes, so the light is set once), the teleprompter that records (text under the lens over the
// front camera, words-per-minute speed, size, mirror, voice follow, the slate cue, countdown, REC and keep or retake),
// and takes uploading from the phone, each filed under the script it was recorded for.
// Real mode: scripts and the pack are the PC's; a rewrite, a revert, "mark shot" and the pack settings are ops; a kept
// take is a real recording (MediaRecorder on the front camera) that uploads in 5 MB chunks (content-takes.js).
import { $, $$, esc, on, push, openSheet, closeSheet, toast, haptic, ring, setRing, pulse, wireSegs } from './core.js';
import { I } from './icons.js';
import { AGENT, NOW } from './data.js';
import { api } from './bus.js';
import * as clock from './svc/clock.js';
import * as API from './svc/api.js';
import { S, CI, script, idea, route, go, redraw, onRedraw, head, askBtn, bar, chAv, chDot, chOf, cover, word, plural, hm, untilText, dur, SHOOT, CHS, takeLines, hookLineCount, wordsOf, secsOf, codeOf, saveTp, REAL, META, enter } from './content-ui.js';
import { send, loadScript, pendingOps, opOf, refresh, coverOf, mediaUrl } from './content-data.js';
import { UPLOADS, onUploads, queueTake, progressOf, retryUploads, forget } from './content-takes.js';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const order = () => S.pack;
const codes = () => [...order().filter((c) => S.scripts[c]), ...Object.keys(S.scripts).filter((c) => !order().includes(c))];
const ready = () => codes().filter((c) => S.scripts[c].status === 'ready' || (REAL && S.scripts[c].status === 'shot' && S.scripts[c].full));
const isShot = (c) => S.shot.has(c) || S.scripts[c]?.status === 'shot' || S.takes.some((t) => t.code === c && t.kept) || (REAL && S.takes.some((t) => t.script === c && t.kept));
const SCRIPT_WORD = (c) => {
  const s = S.scripts[c];
  if (s.status === 'writing') return word(`${AGENT.name} is writing it`, 'var(--content-ink)', true);
  if (s.rewriting) return word(`${AGENT.name} is rewriting it`, 'var(--content-ink)', true);
  if (isShot(c)) return word('Shot', 'var(--ink-3)');
  return word('Ready', 'var(--done)');
};
const codeChip = (c) => `<span class="ct-code num">${esc(codeOf(c))}</span>`;
const metaOf = (c) => `~${secsOf(c)} s · ${wordsOf(c) || S.scripts[c]?.words || 0} words`;
const today = () => (REAL ? clock.today() : '2026-10-22');

// ── the scripts page ──────────────────────────────────────────────────────
function openScripts() {
  const page = push({ title: 'Scripts', back: 'Content', right: askBtn(), cls: 'ct-page', render(sc) { drawScripts(sc); enter(sc); } });
  const off = onRedraw(() => { if (page.isConnected) drawScripts($('.scroll', page)); });
  page._opts.onPop = off;
}
route('scripts', openScripts);
function scriptRow(c) {
  const s = S.scripts[c];
  return `<button class="row ct-take" data-act="ct-script" data-code="${esc(c)}">
    ${codeChip(c)}
    <span class="rbody"><span class="rtitle wrap">${esc(s.title)}</span><span class="rmeta num">${SCRIPT_WORD(c)}<span>·</span>${chDot(s.ch)}<span class="ell">${s.status === 'writing' ? `${s.progress ?? 1} of ${s.of ?? 4} beats` : metaOf(c)}</span></span></span>
    ${I.chevR}
  </button>`;
}
function drawScripts(sc) {
  const inPack = codes().filter((c) => order().includes(c) && (S.ch === 'all' || S.scripts[c].ch === S.ch));
  const extra = codes().filter((c) => !order().includes(c) && (S.ch === 'all' || S.scripts[c].ch === S.ch));
  const kept = S.ideas.filter((x) => x.status === 'kept' && (S.ch === 'all' || x.ch === S.ch));
  const warn = inPack.filter((c) => (S.scripts[c].checks ?? []).some(([k]) => k === 'warn'));
  const writing = pendingOps('write').length;
  sc.innerHTML = `${head({ title: 'Scripts', sub: `${inPack.length} in today's pack · ${warn.length ? `${plural(warn.length, 'needs', 'need')} a look` : inPack.length ? 'all checked' : 'nothing to shoot today'}` })}
    <div class="sh"><h2>Today's pack</h2><span class="sh-count">${inPack.length}</span><button class="sh-act" data-act="ct-go" data-v="pack">Shoot pack ${I.chevR}</button></div>
    ${inPack.length ? `<div class="group">${inPack.map(scriptRow).join('')}</div>` : `<div class="note">No pack today. ${REAL ? `Plan one from the shoot pack, or keep ideas for tonight's plan.` : ''}</div>`}
    ${warn.length ? `<p class="hint ct-warnhint">${I.flag}<span>${warn.map((c) => `${esc(codeOf(c))}: ${esc((S.scripts[c].checks.find(([k]) => k === 'warn') ?? [])[1] ?? '')}`).join(' · ')}</span></p>` : ''}
    ${writing ? `<p class="hint">${word(`${AGENT.name} is writing ${plural(writing, 'script')}`, 'var(--content-ink)', true)}</p>` : ''}
    ${extra.length ? `<div class="sh"><h2>${REAL ? 'Written lately' : 'Written today'}</h2><span class="sh-count">${extra.length}</span></div><div class="group">${extra.map(scriptRow).join('')}</div>` : ''}
    <div class="sh"><h2>For tonight's plan</h2><span class="sh-count">${kept.length}</span></div>
    ${kept.length ? `<div class="group">${kept.slice(0, 30).map((x) => `<button class="row ic" data-act="ct-idea" data-id="${esc(x.id)}"><span class="tile">${I.bulb}</span><span class="rbody"><span class="rtitle wrap">${esc(x.title)}</span><span class="rmeta">${word('Kept', 'var(--ink)')}<span>·</span>${chDot(x.ch)}<span class="ell">${esc(x.ch)} · scripted at 02:30</span></span></span>${I.chevR}</button>`).join('')}</div>`
      : `<div class="note">Nothing kept for tonight. Sort new ideas and ${esc(AGENT.name)} scripts the ones you keep.</div>`}`;
  pulse(sc);
}
on('ct-script', (el) => go('script', el.dataset.code));
on('ct-go', (el) => go(el.dataset.v));

// ── one script ────────────────────────────────────────────────────────────
// demo: the agent's rewrites as canned diffs [where, old, new]; real: a rewrite op (Sonnet on the PC), the CLI keeps the
// version before it, and the page shows the diff with Revert and Keep
const REWRITES = {
  R1: [
    ['Punchier hook', [['hook', null, 'I\'m in a lecture. Five coding agents are shipping my code.']]],
    ['Shorter', [[[0, 1], 'Every job runs on my PC at home.', ''], [[2, 1], 'That one asks which price to anchor. I answer in one line.', '']]],
    ['More Hinglish', [['hook', null, 'Main abhi lecture mein baitha hoon. Aur paanch coding agents mere liye software bana rahe hain.']]],
    ['Simpler words', [[[1, 0], 'Claude and Codex write the code.', 'Two AI tools write the code.']]],
  ],
  R4: [
    ['Fix the CTA', [['cta', null, 'Follow, and I\'ll show the setup next week.']]],
    ['Punchier hook', [['hook', null, 'Five apps. Zero of them talked.']]],
    ['Shorter', [[[2, 1], 'And agents do the boring parts while I sleep.', '']]],
    ['More Hinglish', [['hook', null, 'Pehle main paanch apps ke paise deta tha.']]],
  ],
  R2: [
    ['Punchier hook', [['hook', null, 'Kurta aise fold mat karna.']]],
    ['Shorter', [[[2, 2], 'Roll karo, press mat karo.', '']]],
    ['In English', [['hook', null, 'Most people fold a kurta like this.']]],
  ],
};
const REAL_REWRITES = [['hook', 'Punchier hook'], ['shorter', 'Shorter'], ['hinglish', 'More Hinglish'], ['simpler', 'Simpler words'], ['cta', 'Fix the CTA'], ['english', 'In English']];
function openScript(code) {
  if (!code) return openScripts(); // content/script with no id: the list, never scripts/undefined
  const s = script(code);
  if (!s && !REAL) return;
  const page = push({ title: s ? codeOf(code) : code, back: 'Scripts', right: askBtn(), cls: 'ct-page has-bar', render(sc, pg) { pg._code = code; drawScript(sc, pg); enter(sc); } });
  const off = onRedraw(() => { if (page.isConnected) drawScript($('.scroll', page), page); });
  page._opts.onPop = off;
  if (REAL && !s?.full) loadScript(code).then(() => { if (page.isConnected) drawScript($('.scroll', page), page); }).catch((e) => { toast(e.message || 'That script didn\'t load'); });
}
route('script', openScript);

function lineAt(s, where) {
  if (where === 'hook') return s.hooks[s.hook ?? 0];
  if (where === 'cta') return s.cta;
  return s.beats[where[0]]?.say[where[1]] ?? '';
}
const keptKey = (s) => `aos-content-kept:${s.id}:${s.revisions}`;
/** The real diff: paragraphs of the version before the last rewrite against now. */
function realDiff(s) {
  const prev = s.previous; if (!prev?.teleprompter || !s.revisions || API.ls.get(keptKey(s))) return '';
  const a = String(prev.teleprompter).split(/\n\s*\n/).map((x) => x.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const b = takeLines(s.id).length ? [s.hooks[0], ...s.beats.map((x) => x.say.join(' ')), ...(s.cta ? [s.cta] : [])] : [];
  const rows = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) { if (a[i] !== b[i]) rows.push([a[i] ?? '', b[i] ?? '']); }
  const was = prev.words ?? a.join(' ').split(/\s+/).filter(Boolean).length;
  return `<section class="surface ct-diff" aria-live="polite">
    <p class="ct-diff-h">${I.sparkle}<b>${esc(prev.label ?? 'Rewrite')}</b><span class="foot">Your version is kept: Revert brings it back</span></p>
    ${rows.slice(0, 8).map(([o, n]) => `<div class="ct-diff-l">${o ? `<del>${esc(o)}</del>` : ''}${n ? `<ins>${esc(n)}</ins>` : '<span class="foot">Line cut</span>'}</div>`).join('') || '<p class="foot">Same words, new order.</p>'}
    <p class="ct-diff-n num">${s.words ?? wordsOf(s.id)} words · ~${secsOf(s.id)} s <span class="foot">(was ${was} words${prev.seconds ? ` · ~${prev.seconds} s` : ''})</span></p>
    <div class="ct-diff-acts"><button class="btn sm" data-act="ct-rw-revert" data-code="${esc(s.id)}">${I.undo}Revert</button><button class="btn sm tint" style="--c:var(--done)" data-act="ct-rw-keep" data-code="${esc(s.id)}">${I.check}Keep it</button></div>
  </section>`;
}
function drawScript(sc, page) {
  const code = page._code, s = script(code);
  if (!s || (REAL && !s.full)) {
    sc.innerHTML = `${head({ title: s?.title ?? 'Script', sub: 'Loading the script from your PC' })}<div class="ct-skel surface" aria-hidden="true"><i></i><i></i><i></i></div>`;
    return;
  }
  const c = chOf(s.ch), setup = SHOOT.setups[s.setup];
  const writing = s.status === 'writing';
  const busy = !!(s.rewriting || s.reverting);
  // the structure strip: each part's share of the spoken words
  const parts = [['Hook', s.hooks[s.hook ?? 0]], ...s.beats.map((b) => [b.k, b.say.join(' ')]), ...(s.cta ? [['CTA', s.cta]] : [])];
  const wc = (t) => String(t ?? '').split(/\s+/).filter(Boolean).length;
  let acc = 0;
  const stamps = parts.map(([k, t]) => { const at = acc; acc += wc(t); return [k, Math.round(at / 2.7), wc(t)]; });
  const strip = `<div class="ct-strip" role="img" aria-label="Structure: ${parts.map(([k]) => k).join(', ')}">${stamps.map(([k, , n], i) => `<i class="${i === 0 ? 'hook' : k === 'CTA' ? 'cta' : ''}" style="flex:${n}"></i>`).join('')}</div>
    <div class="ct-strip-l num"><span>0:00</span><span>${dur(secsOf(code))}</span></div>`;
  const hookTabs = s.hooks.length > 1 ? `<div class="seg ct-hooktabs" data-seg="ct-hook" aria-label="Hook drafts">${s.hooks.map((_, i) => `<button data-v="${i}" role="tab" aria-selected="${i === (s.hook ?? 0)}">${'ABC'[i]}</button>`).join('')}</div>` : '';
  const beats = s.beats.map((b, i) => `<div class="ct-beat">
      <span class="ct-beat-t num">${dur(stamps[i + 1]?.[1] ?? 0)}</span>
      <div class="ct-beat-b">
        <span class="ct-beat-k">${esc(b.k)}</span>
        ${b.say.map((l) => `<p class="ct-say">${esc(l)}</p>`).join('')}
        ${b.show ? `<p class="ct-show">${I.eye}<span>${esc(b.show)}</span></p>` : ''}
      </div>
    </div>`).join('');
  const fixable = (t) => /CTA|call to action/i.test(t);
  const checks = (s.checks ?? []).map(([k, t]) => `<div class="row ct-check ${k}"><span class="ct-ck" aria-label="${k === 'ok' ? 'Passes' : 'Needs a look'}">${k === 'ok' ? I.check : '!'}</span><span class="rbody"><span class="rtitle wrap">${esc(t)}</span></span>${k === 'warn' && (s.fixCta || (REAL && fixable(t))) ? `<button class="btn sm" data-act="${REAL ? 'ct-rw2' : 'ct-rw'}" data-code="${esc(code)}" data-i="0" data-k="cta" ${busy ? 'disabled' : ''}>Fix it</button>` : ''}</div>`).join('');
  const rw = REAL ? REAL_REWRITES : (REWRITES[code] ?? []);
  const pend = page._diff;
  const diff = REAL ? realDiff(s) : pend ? `<section class="surface ct-diff" aria-live="polite">
      <p class="ct-diff-h">${I.sparkle}<b>${esc(pend.label)}</b><span class="foot">${esc(AGENT.name)} saved your version first</span></p>
      ${pend.ops.map(([where, , nu], k) => `<div class="ct-diff-l"><del>${esc(pend.before[k])}</del>${nu ? `<ins>${esc(nu)}</ins>` : '<span class="foot">Line cut</span>'}</div>`).join('')}
      <p class="ct-diff-n num">${wordsOf(code)} words · ~${secsOf(code)} s${wordsOf(code) !== pend.words ? ` <span class="foot">(was ${pend.words} · ~${pend.secs} s)</span>` : ' <span class="foot">· the same length</span>'}</p>
      <div class="ct-diff-acts"><button class="btn sm" data-act="ct-rw-revert" data-code="${code}">${I.undo}Revert</button><button class="btn sm tint" style="--c:var(--done)" data-act="ct-rw-keep" data-code="${code}">${I.check}Keep it</button></div>
    </section>` : '';
  const rwOp = s.rewriting && opOf(s.rewriting);
  // what the script copies: the outlier reel, its private Drive copy, and the reel it became once posted
  const src = s.src ?? null;
  const orig = src?.outlier ?? (s.idea ? idea(s.idea)?.link : null) ?? null;
  const ext = (href, icon, label, tint) => `<a class="btn sm${tint ? ' tint' : ''}" ${tint ? `style="--c:${tint}" ` : ''}href="${esc(href)}" target="_blank" rel="noopener">${icon}${label}</a>`;
  const based = orig || src?.archive || src?.posted ? `<div class="sh"><h2>Based on</h2></div>
    <section class="surface ct-srccard">
      ${src?.owner ? `<p class="ct-src-by"><b>@${esc(src.owner)}</b>${src.stats ? `<span class="foot">${esc(src.stats)}</span>` : ''}</p>` : ''}
      <div class="ct-src-acts">
        ${orig ? ext(orig, I.film, /instagram|youtu|tiktok/i.test(orig) ? 'Original reel' : 'Source') : ''}
        ${src?.archive ? ext(src.archive, I.cloud, 'Saved copy') : ''}
        ${src?.posted ? ext(src.posted, I.check, 'Your reel', 'var(--done)') : ''}
      </div>
    </section>` : '';
  sc.innerHTML = `<div class="phead ct-ihead">
      <p class="ct-ichan">${codeChip(code)}${chAv(s.ch)}<span>${esc(s.ch)}</span>${setup ? `<span class="ct-sep">·</span><span class="ct-isrc">${esc(setup.name ?? '')}</span>` : ''}</p>
      <h1 class="title1">${esc(s.title)}</h1>
      <p class="sub">${SCRIPT_WORD(code)} · ${writing ? `${s.progress ?? 1} of ${s.of ?? 4} beats written` : `${s.words ?? wordsOf(code)} words · ~${secsOf(code)} s at reel pace`}</p>
    </div>
    ${writing ? '' : `<section class="ct-structure">${strip}</section>`}
    ${busy ? `<section class="surface ct-diff"><p class="ct-diff-h">${word(s.reverting ? 'Putting your version back' : `${AGENT.name} is rewriting: ${(REAL_REWRITES.find(([k]) => k === rwOp?.rewrite) ?? [0, 'a rewrite'])[1]}`, 'var(--content-ink)', true)}</p><p class="foot">${rwOp?.state === 'running' ? 'On your PC now. It lands here in about a minute.' : navigator.onLine === false ? 'Offline: it goes to your PC when you\'re back.' : 'Sending it to your PC.'}</p></section>` : diff}
    ${based}
    <div class="sh"><h2>Hook</h2>${s.hooks.length > 1 ? `<span class="sh-count">${s.hooks.length} drafts</span>` : ''}</div>
    <section class="surface ct-hookcard">
      <p class="ct-hookq">${esc(s.hooks[s.hook ?? 0])}</p>
      ${hookTabs}
    </section>
    ${beats ? `<div class="sh"><h2>Beats</h2></div>
    <section class="surface ct-beats">${beats}${writing ? `<div class="ct-beat ct-beat-writing"><span class="ct-beat-t">${word('', 'var(--content-ink)', true)}</span><div class="ct-beat-b"><p class="foot">${esc(AGENT.name)} is writing the next beat</p></div></div>` : ''}</section>` : ''}
    ${s.cta ? `<div class="sh"><h2>Call to action</h2></div><section class="surface ct-ctacard"><p class="ct-say">${esc(s.cta)}</p></section>` : ''}
    ${checks ? `<div class="sh"><h2>Ready check</h2><span class="sh-count">${(s.checks ?? []).filter(([k]) => k === 'ok').length} of ${(s.checks ?? []).length}</span></div><div class="group">${checks}</div>` : ''}
    ${rw.length && !writing ? `<div class="sh"><h2>Ask ${esc(AGENT.name)} to rewrite</h2></div>
      <div class="chips ct-rwchips pad">${rw.map(([k, l], i) => REAL ? `<button class="chip" data-act="ct-rw2" data-code="${esc(code)}" data-k="${k}" ${busy ? 'disabled' : ''}>${esc(l)}</button>` : `<button class="chip" data-act="ct-rw" data-code="${code}" data-i="${i}" ${pend ? 'disabled' : ''}>${esc(k)}</button>`).join('')}</div>
      <p class="hint">Every rewrite saves your version first, so Revert always brings it back.</p>` : ''}
    ${bar(writing ? `<span class="ct-bar-note">${word(`${AGENT.name} is writing ${codeOf(code)}`, 'var(--content-ink)', true)}</span>`
      : `<button class="btn primary block" style="--c:var(--content-fill)" data-act="ct-tp-open" data-code="${esc(code)}">${CI.rec}Read and record</button>`)}`;
  wireSegs(sc);
  const seg0 = $('.ct-hooktabs', sc);
  if (seg0) seg0.addEventListener('change', (e) => { s.hook = Number(e.detail); drawScript(sc, page); haptic(5); });
  pulse(sc);
}
// real: a rewrite op; the PC runs it (Sonnet) and the page shows the diff when it lands
on('ct-rw2', (el) => {
  const code = el.dataset.code; const s = script(code); if (!s || s.rewriting) return;
  send('rewrite', { script: code, rewrite: el.dataset.k });
  haptic(8); redraw('scripts');
  $('.scroll', el.closest('.page'))?.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
});
on('ct-rw', (el) => {
  const page = el.closest('.page'); const code = el.dataset.code; const s = script(code); if (!s || !page) return;
  const [label, ops] = (REWRITES[code] ?? [])[Number(el.dataset.i)] ?? [];
  if (!ops) return;
  const snap = JSON.parse(JSON.stringify({ hooks: s.hooks, hook: s.hook ?? 0, beats: s.beats, cta: s.cta, checks: s.checks }));
  const before = ops.map(([w, old]) => old ?? lineAt(s, w));
  const words = wordsOf(code), secs = secsOf(code);
  // apply: a hook rewrite becomes the chosen draft; an empty new line cuts the line
  ops.forEach(([w, old, nu]) => {
    if (w === 'hook') { s.hooks = [...s.hooks]; s.hooks[s.hook ?? 0] = nu; }
    else if (w === 'cta') { s.cta = nu; s.checks = (s.checks ?? []).map(([k, t]) => (k === 'warn' ? ['ok', 'The CTA promises nothing that needs a reply'] : [k, t])); }
    else { const b = s.beats[w[0]]; if (b) b.say = b.say.map((l) => (l === old ? nu : l)).filter(Boolean); }
  });
  page._diff = { label, ops, before, snap, words, secs };
  haptic(8);
  drawScript($('.scroll', page), page);
  $('.scroll', page).scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
});
on('ct-rw-revert', (el) => {
  const page = el.closest('.page'); const s = script(el.dataset.code);
  if (REAL) { if (!s) return; send('revert', { script: s.id }); haptic(6); toast('Putting your version back'); return; }
  const d = page?._diff; if (!s || !d) return;
  Object.assign(s, d.snap); page._diff = null; haptic(6);
  drawScript($('.scroll', page), page); toast('Back to your version');
});
on('ct-rw-keep', (el) => {
  const page = el.closest('.page');
  if (REAL) { const s = script(el.dataset.code); if (s) API.ls.set(keptKey(s), '1'); redraw('scripts'); toast('Kept. The prompter has the new lines'); return; }
  if (!page?._diff) return; page._diff = null; redraw('scripts'); drawScript($('.scroll', page), page); toast('Kept. The prompter has the new lines');
});

// ── the shoot pack ────────────────────────────────────────────────────────
const DEMO_DAYS = [
  { key: 'wed', label: 'Yesterday', date: 'Wed 21 Oct', past: true, scripts: 3, line: 'Shot 3 of 3 at the desk. Two are posted, one is with the editor.' },
  { key: 'thu', label: 'Today', date: 'Thu 22 Oct' },
  { key: 'fri', label: 'Tomorrow', date: 'Fri 23 Oct', future: true, line: `${AGENT.name} plans it at 02:30 from what you keep tonight.` },
];
// real: yesterday, today, tomorrow (another day's pack loads when you go to it)
const realDays = () => [-1, 0, 1].map((k) => { const iso = clock.addDays(clock.today(), k); return { key: iso, iso, label: clock.dayLabel(iso), date: clock.label(iso).short, past: k < 0, future: k > 0 }; });
const DAYS = () => (REAL ? realDays() : DEMO_DAYS);
const other = new Map();   // iso → the PC's pack for that day (or { loading } / { error })
let dayK = 1;
export function openShootPack(day) {
  const days = DAYS();
  if (typeof day === 'string') { const k = days.findIndex((d) => d.key === day.toLowerCase().slice(0, 3) || d.iso === day || d.date.startsWith(day)); if (k >= 0) dayK = k; }
  else if (typeof day === 'number') dayK = Math.max(0, Math.min(2, 1 + day));
  else dayK = 1;
  const page = push({ title: 'Shoot pack', back: 'Content', right: askBtn(), cls: 'ct-page has-bar', render(sc) { drawPack(sc); enter(sc); } });
  const off = onRedraw(() => { if (page.isConnected) drawPack($('.scroll', page)); });
  const off2 = onUploads(() => { if (page.isConnected) paintUploads(page); });
  page._opts.onPop = () => { off(); off2(); };
  return page;
}
route('pack', openShootPack);

// a framing guide: where you sit in the 9:16 frame, eyes on the upper third
const frameSvg = (kind) => `<svg class="ct-frame" viewBox="0 0 90 160" aria-hidden="true"><rect x="1" y="1" width="88" height="158" rx="9"/><path class="g" d="M30 1v158M60 1v158M1 53h88M1 107h88"/>${kind === 'wide'
  ? '<circle cx="45" cy="70" r="8.5"/><path d="M29 128c2-26 8-40 16-40s14 14 16 40"/><path class="g2" d="M8 118h74"/>'
  : '<circle cx="45" cy="56" r="17"/><path d="M12 160c3-34 15-50 33-50s30 16 33 50"/>'}</svg>`;

function loadOther(iso, sc) {
  if (other.has(iso)) return;
  other.set(iso, { loading: true });
  API.api(`/mod/content/pack?date=${iso}`).then((p) => other.set(iso, p)).catch((e) => other.set(iso, { error: e.message }))
    .finally(() => { if (sc.isConnected) drawPack(sc); });
}
function otherDay(sc, d, nav) {
  const p = other.get(d.iso);
  if (!p) { loadOther(d.iso, sc); }
  const scripts = p?.scripts ?? [];
  const planning = pendingOps('plan').some((o) => o.date === d.iso);
  const line = p?.loading || !p ? 'Loading that day from your PC' : p.error ? p.error
    : scripts.length ? `${plural(scripts.length, 'script')} in ${plural(p.setups?.length ?? 1, 'setup')}${d.past ? '' : ''}`
    : d.future ? `${AGENT.name} plans it at 02:30 from what you keep tonight.` : 'Nothing was planned that day.';
  sc.innerHTML = `${head({ title: 'Shoot pack', sub: d.date })}${nav}
    <div class="note ct-daynote"><span>${esc(line)}</span>${d.future && !scripts.length ? `<button class="btn sm" data-act="ct-plan" data-date="${d.iso}" ${planning ? 'disabled' : ''}>${planning ? '<span class="spin"></span>Planning' : `${I.sparkle}Plan now`}</button>` : ''}</div>
    ${scripts.length ? `<div class="group">${scripts.map((s) => `<button class="row ct-take" data-act="ct-script" data-code="${esc(s.id)}"><span class="ct-code num">${esc(s.take ?? s.id)}</span><span class="rbody"><span class="rtitle wrap">${esc(s.title)}</span><span class="rmeta">${s.status === 'shot' ? word('Shot', 'var(--ink-3)') : word('Ready', 'var(--done)')}<span>·</span><span class="ell">~${s.seconds ?? '?'} s · ${s.words ?? 0} words</span></span></span>${I.chevR}</button>`).join('')}</div>` : ''}`;
}
function drawPack(sc) {
  const days = DAYS();
  const d = days[dayK];
  const nav = `<div class="ct-daynav">
      <button class="ct-daybtn" data-act="ct-day" data-d="-1" aria-label="Previous day" ${dayK === 0 ? 'disabled' : ''}>${I.chevL}</button>
      <div class="ct-dayname" aria-live="polite"><b>${esc(d.label)}</b><span class="foot">${esc(d.date)}</span></div>
      <button class="ct-daybtn ct-flip" data-act="ct-day" data-d="1" aria-label="Next day" ${dayK === days.length - 1 ? 'disabled' : ''}>${I.chevL}</button>
    </div>`;
  if (d.past || d.future) {
    if (REAL) { otherDay(sc, d, nav); return; }
    sc.innerHTML = `${head({ title: 'Shoot pack', sub: d.date })}${nav}
      <div class="note ct-daynote"><span>${esc(d.line)}</span>${d.future ? `<button class="btn sm" data-act="ct-plan">${I.sparkle}Plan now</button>` : ''}</div>`;
    return;
  }
  const list = codes().filter((c) => order().includes(c));
  const rd = list.filter((c) => ['ready', 'shot'].includes(S.scripts[c].status));
  const shot = rd.filter(isShot).length;
  const talk = rd.reduce((n, c) => n + secsOf(c), 0);
  const planning = pendingOps('plan').some((o) => o.date === today());
  if (REAL && !list.length) {
    const p = SHOOT.pending ?? [];
    sc.innerHTML = `${head({ title: 'Shoot pack', sub: `${d.date} · nothing planned` })}${nav}
      <div class="note ct-daynote"><span>${p.length ? `${plural(p.length, 'idea')} picked for today, still being written.` : `No pack for today. ${AGENT.name} can plan one now from your ideas: the picks, the scripts and the Shoot block on Today.`}</span>
        <button class="btn sm" data-act="ct-plan" data-date="${today()}" ${planning ? 'disabled' : ''}>${planning ? '<span class="spin"></span>Planning' : `${I.sparkle}Plan today`}</button></div>
      ${takesSection()}
      ${settingsSection()}
      ${bar(`<button class="btn block" data-act="ct-upload">${CI.upload}Upload takes</button>`)}`;
    pulse(sc); return;
  }
  const setups = (SHOOT.setups.length ? SHOOT.setups : [{ name: 'Today', framing: '', props: '', codes: list, frame: 'mcu' }]).map((g, i) => {
    const cs = (g.codes ?? []).filter((c) => S.scripts[c]);
    const done = cs.filter(isShot).length;
    const facts = [[I.camera, g.framing], [CI.light, g.light], [CI.shirt, g.outfit], [I.tag, g.props]].filter(([, t]) => t);
    return `<section class="group ct-setup">
      <header class="ct-setup-h">
        ${frameSvg(g.frame)}
        <div class="ct-setup-t">
          <span class="ct-setup-k">Setup ${i + 1}${g.when ? ` · ${esc(g.when)}` : ''}</span>
          <h3 class="t2">${esc(g.name)}</h3>
          <span class="ct-setup-n num">${done} of ${cs.length} shot</span>
        </div>
      </header>
      ${facts.length ? `<ul class="ct-facts">${facts.map(([ic, t]) => `<li>${ic}<span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
      ${cs.map((c) => takeRow(c)).join('')}
    </section>`;
  }).join('');
  const plan = META.jobs?.plan;
  const jobRow = REAL ? (plan?.at ? `<div class="row ct-jobrow">${I.claude}<span class="rbody"><span class="rtitle">Planned ${clock.dateOfIso(plan.at) === today() ? `at ${clock.hm(clock.toMin(plan.at, today()))}` : clock.dayLabel(clock.dateOfIso(plan.at)).toLowerCase()} by the nightly plan</span><span class="rmeta">${plan.ok === false ? 'It failed last time: Plan again re-runs it' : 'Picks per channel, scripts, the Shoot block on Today'}</span></span></div>` : '')
    : `<button class="row ct-jobrow" data-act="ct-job" data-id="${SHOOT.job}">${I.claude}<span class="rbody"><span class="rtitle">Planned ${SHOOT.planned} by ${esc(AGENT.name)}</span><span class="rmeta">Agentic OS job ${SHOOT.job} · nightly shoot pack</span></span>${I.chevR}</button>`;
  sc.innerHTML = `${head({ title: 'Shoot pack', sub: `${d.date} · ${plural(list.length, 'script')} in ${plural(Math.max(1, SHOOT.setups.length), 'setup')}` })}${nav}
    <section class="surface ct-packsum">
      <div class="ct-packsum-m">
        ${ring(rd.length ? shot / rd.length : 0, 'content', 64, 6, { inner: `<span class="ct-ring-in"><b class="met" data-count="${shot}">${shot}</b><small class="met">/${rd.length}</small></span>`, label: `${shot} of ${rd.length} shot` })}
        <div class="ct-packsum-t">
          <b class="num">${SHOOT.at != null ? `${hm(SHOOT.at)} <span class="ct-in">${untilText(SHOOT.at)}</span>` : 'Shoot time not set'}</b>
          <span class="foot">About ${dur(talk)} of talking, ${SHOOT.len + 10} minutes with the setup</span>
          ${REAL ? '' : '<span class="foot">Window light is best before 18:50</span>'}
        </div>
      </div>
      ${jobRow}
    </section>
    ${setups}
    ${takesSection()}
    ${settingsSection()}
    ${bar(rd.length && shot < rd.length ? `<button class="btn primary block" style="--c:var(--content-fill)" data-act="ct-shoot">${CI.rec}Start shoot · ${esc(codeOf(rd.find((c) => !isShot(c)) ?? ''))}</button>` : `<button class="btn block" data-act="ct-upload">${CI.upload}Upload takes</button>`)}`;
  pulse(sc);
}
function takesSection() {
  const ups = REAL ? UPLOADS.filter((u) => !u.done || !S.takes.some((t) => t.id === u.take)) : [];
  const takes = S.takes;
  const n = ups.length + takes.length;
  return `<div class="sh" id="ctTakes"><h2>Takes</h2>${n ? `<span class="sh-count">${n}</span>` : ''}</div>
    <div class="group ct-takes">
      ${ups.map(uploadRow).join('')}
      ${takes.map(takeUpRow).join('')}
      <label class="row ic ct-uplabel" ${REAL ? '' : 'data-act="ct-upload"'}><span class="tile">${CI.upload}</span><span class="rbody"><span class="rtitle">Upload from Photos</span><span class="rmeta">Shot on this phone's camera, another phone or a camera</span></span>${I.chevR}${REAL ? '<input type="file" accept="video/*" multiple class="vh" data-ct-file aria-label="Upload takes">' : ''}</label>
    </div>
    <p class="hint">${REAL ? (META.flags?.transcribe ? 'Say the take code before the hook (“R1, take 2”). A take recorded here is filed under its script; one from Photos is matched by that code.' : 'A take recorded here is filed under its script. Takes from Photos wait on your PC until a transcript key can match them by the code you say.') : 'Say the take code before the hook (“R1, take 2”). Each upload is matched to its script by that code.'}</p>`;
}
function settingsSection() {
  return `<div class="sh"><h2>Pack settings</h2></div>
    <div class="group">
      ${CHS.map((k) => `<div class="row ct-set">${chAv(k.id)}<span class="rbody"><span class="rtitle">${esc(k.id)}</span><span class="rmeta">Reels a day${REAL && !k.perDaySet ? ' · default' : ''}</span></span>
        <span class="ct-step"><button data-act="ct-step" data-ch="${k.id}" data-d="-1" aria-label="Fewer reels a day for ${esc(k.id)}" ${k.perDay <= 0 ? 'disabled' : ''}>${I.minus}</button><b class="num">${k.perDay}</b><button data-act="ct-step" data-ch="${k.id}" data-d="1" aria-label="More reels a day for ${esc(k.id)}" ${k.perDay >= 5 ? 'disabled' : ''}>${I.plus}</button></span></div>`).join('')}
      <button class="row ct-set" data-act="ct-time"><span class="ct-lead">${I.clock}</span><span class="rbody"><span class="rtitle">Shoot time</span><span class="rmeta">The Shoot block lands on Today at this time</span></span><span class="rend num ct-time">${SHOOT.at != null ? hm(SHOOT.at) : 'Set'}</span>${I.chevR}</button>
    </div>`;
}
function takeRow(c) {
  const s = S.scripts[c];
  const ts = S.takes.filter((t) => t.code === c || t.script === c);
  const best = ts.find((t) => t.best) ?? ts.find((t) => t.kept);
  if (s.status === 'writing') return `<div class="row ct-take">${codeChip(c)}<span class="rbody"><span class="rtitle wrap">${esc(s.title)}</span><span class="rmeta">${word(`${AGENT.name} is writing it · ${s.progress ?? 1} of ${s.of ?? 4} beats`, 'var(--content-ink)', true)}</span></span></div>`;
  return `<button class="row ct-take" data-act="ct-tp-open" data-code="${esc(c)}" aria-label="${esc(codeOf(c))}, ${esc(s.title)}. Open in the teleprompter">
    ${codeChip(c)}
    <span class="rbody"><span class="rtitle wrap">${esc(s.title)}</span><span class="rmeta num">${SCRIPT_WORD(c)}<span>·</span><span class="ell">${ts.length ? `${plural(ts.length, 'take')}${best ? ` · take ${best.n} kept` : ''}` : metaOf(c)}</span></span></span>
    <span class="ct-play">${isShot(c) ? I.check : I.play}</span>
  </button>`;
}
function takeUpRow(t) {
  const up = t.p >= 1;
  const matched = REAL ? (t.script ? `Under ${esc(codeOf(t.script))}${t.match?.how === 'take code' ? `: heard “${esc(t.match.code ?? '')}”` : t.match?.how === 'transcript similarity' ? ' by its words' : ''}` : t.transcript === 'pending' ? 'On your PC · waiting for a match' : 'On your PC · no script matched')
    : `Matched to ${esc(t.code)}: heard “${esc(t.code)}” at 0:01`;
  return `<div class="row ic ct-foot" data-t="${esc(t.id)}">
    <span class="tile">${I.film}</span>
    <span class="rbody"><span class="rtitle">${esc(t.code ? codeOf(t.code) : 'Take')} · take ${t.n}${t.best ? ' · the one to use' : ''}</span><span class="rmeta num">${t.secs ? `<span>${dur(t.secs)}</span><span>·</span>` : ''}<span class="ell">${up ? matched : t.src === 'photos' ? 'Uploading from Photos' : 'Uploading'}</span></span></span>
    ${up ? `${REAL && t.real ? `<button class="ct-ok" data-act="ct-take-play" data-id="${esc(t.id)}" aria-label="Play this take">${I.play}</button>` : `<span class="ct-ok" role="img" aria-label="Uploaded">${I.check}</span>`}` : `<span class="ct-up">${ring(t.p, 'content', 36, 4, { cls: 'ct-upring', label: `${Math.round(t.p * 100)}% uploaded` })}<b class="met ct-upn">${Math.round(t.p * 100)}</b></span>`}
  </div>`;
}
function uploadRow(u) {
  const p = progressOf(u);
  const label = u.done ? 'Uploaded · filing it' : u.fatal ? u.error : u.error ? u.error : u.busy ? `Uploading · ${Math.round((u.sent ?? 0) / 1048576)} of ${Math.max(1, Math.round(u.size / 1048576))} MB` : 'Waiting to upload';
  return `<div class="row ic ct-foot" data-u="${esc(u.id)}">
    <span class="tile">${I.film}</span>
    <span class="rbody"><span class="rtitle">${esc(u.code ? codeOf(u.code) : 'Take')}${u.n ? ` · take ${u.n}` : ''}</span><span class="rmeta num">${u.secs ? `<span>${dur(u.secs)}</span><span>·</span>` : ''}<span class="ell ct-upl">${esc(label)}${u.volatile && !u.done ? ' · keep the app open' : ''}</span></span></span>
    ${u.done ? `<span class="ct-ok" role="img" aria-label="Uploaded">${I.check}</span>` : u.fatal ? `<button class="btn sm" data-act="ct-up-forget" data-id="${esc(u.id)}">Remove</button>` : `<span class="ct-up">${ring(p, 'content', 36, 4, { cls: 'ct-upring', label: `${Math.round(p * 100)}% uploaded` })}<b class="met ct-upn">${Math.round(p * 100)}</b></span>`}
  </div>`;
}
/** Uploads tick without redrawing the page: the ring and the line move in place. */
function paintUploads(page) {
  for (const u of UPLOADS) {
    const row = $(`.ct-foot[data-u="${u.id}"]`, page);
    if (!row) { if (!u.done) redraw('takes'); continue; }
    if (u.done || u.fatal) { redraw('takes'); return; }
    const r = $('.ct-upring', row); if (r) setRing(r, progressOf(u), { bleed: false });
    const n = $('.ct-upn', row); if (n) n.textContent = Math.round(progressOf(u) * 100);
    const l = $('.ct-upl', row); if (l) l.textContent = u.error ? u.error : u.busy ? `Uploading · ${Math.round((u.sent ?? 0) / 1048576)} of ${Math.max(1, Math.round(u.size / 1048576))} MB` : 'Waiting to upload';
  }
}
on('ct-up-forget', (el) => forget(el.dataset.id));
on('ct-take-play', async (el) => {
  try {
    const m = await mediaUrl(el.dataset.id);
    openSheet({ title: 'Take', sub: 'Played from your PC', body: (b) => { b.innerHTML = `<div class="pad ct-takeplay"><video src="${esc(m.url)}" controls playsinline autoplay preload="metadata"></video></div>`; } });
  } catch (e) { toast(e.message || 'That take isn\'t reachable'); }
});
on('ct-day', (el) => { dayK = Math.max(0, Math.min(DAYS().length - 1, dayK + Number(el.dataset.d))); const sc = el.closest('.scroll'); if (sc) drawPack(sc); haptic(5); });
on('ct-plan', (el) => {
  if (!REAL) { el.disabled = true; el.innerHTML = '<span class="spin"></span>Planning'; toast(`${AGENT.name} is planning Friday's pack`); setTimeout(() => { toast('Friday: 2 scripts from your kept ideas, 1 setup'); }, 2400); return; }
  const date = el.dataset.date ?? today();
  send('plan', { date });
  other.delete(date);
  el.disabled = true; el.innerHTML = '<span class="spin"></span>Planning';
  toast(`${AGENT.name} is planning ${clock.dayLabel(date).toLowerCase()}'s pack on your PC`);
});
on('ct-job', (el) => api.openJob(el.dataset.id));
let stepT = 0;
on('ct-step', (el) => {
  const k = CHS.find((x) => x.id === el.dataset.ch); if (!k) return;
  k.perDay = Math.max(0, Math.min(5, k.perDay + Number(el.dataset.d)));
  const box = el.parentElement; $('b', box).textContent = k.perDay;
  const [m, p] = $$('button', box); m.disabled = k.perDay <= 0; p.disabled = k.perDay >= 5;
  haptic(5);
  if (REAL) { clearTimeout(stepT); stepT = setTimeout(() => send('settings', { values: { [`reels_per_day.${k.handle}`]: String(k.perDay) } }), 700); }
});
const TIMES = [18 * 60 + 30, 18 * 60 + 45, 19 * 60 + 30, 7 * 60 + 30];
on('ct-time', (el) => {
  if (!REAL) { SHOOT.at = TIMES[(TIMES.indexOf(SHOOT.at) + 1) % TIMES.length]; $('.ct-time', el).textContent = hm(SHOOT.at); haptic(5); toast(`Shoot time set to ${hm(SHOOT.at)}`); redraw('pack'); return; }
  openSheet({ title: 'Shoot time', sub: 'Tonight\'s plan puts the Shoot block on Today at this time',
    body: (b) => {
      b.innerHTML = `<div class="pad ct-timesheet"><label class="field"><span class="foot">Time (IST)</span><input type="time" value="${SHOOT.at != null ? hm(SHOOT.at) : '18:30'}" aria-label="Shoot time" /></label>
        <div class="ct-newacts">${SHOOT.at != null ? '<button class="btn" data-act="ct-time-clear">No fixed time</button>' : ''}<button class="btn primary" style="--c:var(--content-fill)" data-act="ct-time-save">Save</button></div></div>`;
    } });
});
on('ct-time-save', (el) => { const v = el.closest('.sheet')?.querySelector('input')?.value; closeSheet(el.closest('.sheet')); if (/^\d{2}:\d{2}$/.test(v ?? '')) { send('settings', { values: { shoot_at: v } }); toast(`Shoot time set to ${v}`); } });
on('ct-time-clear', (el) => { closeSheet(el.closest('.sheet')); send('settings', { values: { shoot_at: null } }); toast('No fixed shoot time'); });

// demo: uploads tick while you look; a finished one re-draws its page
setInterval(() => {
  if (REAL) return;
  let moved = false, landed = false;
  for (const t of S.takes) if (t.p < 1) { t.p = Math.min(1, t.p + (t.src === 'photos' ? .02 : .035)); moved = true; if (t.p >= 1) landed = true; }
  if (!moved) return;
  $$('.ct-foot[data-t]').forEach((row) => {
    const t = S.takes.find((x) => x.id === row.dataset.t); if (!t) return;
    setRing($('.ct-upring', row), t.p, { bleed: false });
    const n = $('.ct-upn', row); if (n) n.textContent = Math.round(t.p * 100);
  });
  if (landed) redraw('takes');
}, 500);

// real: files picked from Photos upload with a ring each (today's pack date; the PC matches them by the spoken code)
document.addEventListener('change', (e) => {
  const inp = e.target.closest?.('[data-ct-file]'); if (!inp || !inp.files?.length) return;
  const files = [...inp.files]; inp.value = '';
  files.forEach((f) => queueTake(f, { date: SHOOT.date ?? today(), src: 'photos' }));
  toast(`Uploading ${plural(files.length, 'clip')} to your PC`);
  redraw('takes');
});
// demo: a picker of clips in Photos (mock), then each one uploads with its own ring
on('ct-upload', () => {
  if (REAL) { const f = $('#stack .page:last-child [data-ct-file]') ?? $('[data-ct-file]'); if (f) f.click(); else go('pack'); return; }
  const clips = [['R1', 34, 'Today 18:41'], ['R1', 31, 'Today 18:44'], ['R4', 29, 'Today 18:52'], ['R2', 22, 'Today 16:10'], ['', 12, 'Yesterday'], ['', 48, 'Yesterday']];
  openSheet({
    title: 'Upload from Photos', sub: 'Pick today\'s takes; each is matched by the code you said',
    body: (b) => {
      b.innerHTML = `<div class="pad"><div class="ct-pick">${clips.map(([c, s, at], i) => `<button class="ct-clip" data-i="${i}" aria-pressed="false" aria-label="Clip ${i + 1}, ${dur(s)}, ${at}">
          ${cover({ lines: c ? [c, 'take'] : ['', ''], hi: 0, scene: 'face' }, { ch: c === 'R2' ? '@example_creator' : '@northwindstudio', w: 104, dur: s })}
          <span class="ct-clip-at foot">${esc(at)}</span><span class="ct-clip-ck">${I.check}</span></button>`).join('')}</div>
        <button class="btn primary block ct-pick-go" style="--c:var(--content-fill)" data-act="ct-upload-go" disabled>Upload</button></div>`;
      const sel = new Set();
      $$('.ct-clip', b).forEach((el) => el.addEventListener('click', () => {
        const i = Number(el.dataset.i); sel.has(i) ? sel.delete(i) : sel.add(i);
        el.setAttribute('aria-pressed', String(sel.has(i))); haptic(5);
        const go2 = $('.ct-pick-go', b); go2.disabled = !sel.size; go2.textContent = sel.size ? `Upload ${plural(sel.size, 'clip')}` : 'Upload';
      }));
      b._sel = () => [...sel].map((i) => clips[i]);
    },
  });
});
on('ct-upload-go', (el) => {
  const sh = el.closest('.sheet'); const picked = $('.sheet-body', sh)?._sel?.() ?? [];
  closeSheet(sh);
  picked.forEach(([c, s], k) => {
    const code = c || 'R4';
    const n = S.takes.filter((t) => t.code === code).length + 1;
    S.takes.push({ id: `u${Date.now()}${k}`, code, n, secs: s, p: .04 * k, kept: true, src: 'photos' });
  });
  redraw('takes');
  toast(`Uploading ${plural(picked.length, 'clip')} to your PC`);
});

// ── the teleprompter: always dark. Camera on: the words sit under the lens over the live front camera ──
let TP = null;
const takeN = (code) => S.takes.filter((t) => t.code === code || t.script === code).length + UPLOADS.filter((u) => u.script === code && !(u.take && S.takes.some((t) => t.id === u.take))).length + 1;
export function openTeleprompter(take) {
  const list = ready().filter((c) => !REAL || S.scripts[c].full);
  // a take code (R1) or a script id (s65)
  const want = take && (S.scripts[take] ? take : Object.keys(S.scripts).find((id) => S.scripts[id].code === take));
  const code = want && ['ready', 'shot'].includes(S.scripts[want]?.status) && (!REAL || S.scripts[want].full) ? want : list.find((c) => !isShot(c)) ?? list[0];
  if (!code) {
    if (REAL && want && !S.scripts[want]?.full) { loadScript(want).then(() => openTeleprompter(want)).catch(() => toast('That script didn\'t load')); return; }
    toast('No script is ready to read yet'); return;
  }
  if (TP) closeTp(true);
  const el = document.createElement('div');
  el.className = 'ct-tp stay-dark';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Teleprompter');
  $('#phone').append(el);
  TP = { el, code, y: 0, playing: false, raf: 0, last: 0, counted: false, ended: false, cd: 0, rec: false, t0: 0, tick: 0, panel: null, stream: null, recorder: null, chunks: [], blob: null, cam: null };
  fillTp();
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  haptic(10);
  el.addEventListener('click', onTpClick);
  // the words follow a drag while paused (1:1 from where you grabbed them); a tap on them starts or pauses
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    const v = e.target.closest('.ct-tp-view'); if (!v || !TP || TP.panel) return;
    drag = { y0: e.clientY, start: TP.y, moved: false, paused: !TP.playing };
    if (drag.paused) { try { v.setPointerCapture(e.pointerId); } catch {} }
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag?.paused || !TP) return;
    const dy = e.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) > 6) drag.moved = true;
    if (drag.moved) { TP.y = clampY(drag.start - dy); drawTp(); }
  });
  el.addEventListener('pointerup', () => { const d = drag; drag = null; if (d && !d.moved && TP && !TP.rec && !$('.ct-tp-go', TP.el)?.disabled) togglePlay(); });
  el.addEventListener('pointercancel', () => { drag = null; });
  if (REAL && S.tp.camera) startCamera();
}
route('teleprompter', openTeleprompter);
const TP_S = () => S.tp;
const WPM = 162;

// the front camera behind the words (the app on the iPhone; a browser served by the PC blocks it by policy)
async function startCamera() {
  const t = TP; if (!t) return;
  if (t.stream) { attachVideo(); return; }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { t.cam = 'none'; fillCamState(); return; }
  // a page the PC serves forbids the camera by policy (Permissions-Policy: camera=()); the app on the iPhone doesn't
  const pol = document.permissionsPolicy ?? document.featurePolicy;
  if (pol?.allowsFeature && !pol.allowsFeature('camera')) { t.cam = 'blocked'; fillCamState(); return; }
  t.cam = 'starting'; fillCamState();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1920 } }, audio: true });
    if (TP !== t) { stream.getTracks().forEach((x) => x.stop()); return; }
    t.stream = stream; t.cam = 'on'; attachVideo();
  } catch (e) {
    t.cam = e?.name === 'NotAllowedError' ? 'denied' : 'none'; fillCamState();
  }
}
function attachVideo() {
  const t = TP; if (!t?.stream) return;
  const v = $('.ct-tp-video', t.el); if (!v) return;
  if (v.srcObject !== t.stream) { v.srcObject = t.stream; v.play?.().catch(() => {}); }
  t.el.classList.add('live');
  fillCamState();
}
function fillCamState() {
  const t = TP; if (!t) return;
  const l = $('.ct-tp-camlabel', t.el); if (!l) return;
  const s = S.scripts[t.code];
  l.textContent = t.cam === 'on' ? `${SHOOT.setups[s?.setup]?.framing || 'Front camera'} · 9:16` : t.cam === 'starting' ? 'Starting the camera'
    : t.cam === 'blocked' ? 'This browser page can\'t use the camera: record in the app, or in the Camera app and upload'
    : t.cam === 'denied' ? 'Camera access is off: allow it in Settings, or record in the Camera app and upload' : t.cam === 'none' ? 'No camera here: record in the Camera app, then upload the take' : `${SHOOT.setups[s?.setup]?.framing || 'Front camera'} · 9:16`;
}
function stopCamera(t = TP) { if (t?.stream) { t.stream.getTracks().forEach((x) => x.stop()); t.stream = null; } }

function fillTp() {
  const s = S.scripts[TP.code], o = TP_S();
  const lines = takeLines(TP.code);
  // the beat's direction sits dim before its first line; the reading line skips it
  const dirAt = new Map(); let k = hookLineCount(TP.code);
  s.beats.forEach((b) => { if (b.show) dirAt.set(k, b.show); k += b.say.length; });
  const list = ready().filter((c) => !REAL || S.scripts[c].full); const next = list[(list.indexOf(TP.code) + 1) % list.length];
  const n = takeN(TP.code);
  const cc = codeOf(TP.code);
  TP.el.classList.toggle('cam', o.camera); TP.el.classList.toggle('mirror', o.mirror);
  TP.el.style.setProperty('--tp-k', o.size.toFixed(2));
  TP.el.innerHTML = `
    ${o.camera ? `<div class="ct-tp-cam" aria-hidden="true">
      ${REAL ? '<video class="ct-tp-video" muted playsinline autoplay></video>' : ''}
      <svg viewBox="0 0 90 195" preserveAspectRatio="xMidYMid slice"><path class="g" d="M30 0v195M60 0v195M0 65h90M0 130h90"/>${SHOOT.setups[s.setup]?.frame === 'wide' ? '<circle cx="45" cy="122" r="8"/><path d="M28 182c2-28 8-44 17-44s15 16 17 44z"/><path class="g2" d="M6 168h78"/>' : '<circle cx="45" cy="128" r="15"/><path d="M8 204c2-38 17-58 37-58s35 20 37 58z"/>'}</svg>
      <span class="ct-tp-camlabel">${esc(SHOOT.setups[s.setup]?.framing || 'Front camera')} · 9:16</span>
      <span class="ct-tp-rec num" hidden><i></i><span>0:00</span></span>
      ${o.voice ? `<span class="ct-tp-voice"><span class="ct-tp-bars"><i></i><i></i><i></i><i></i></span>Following your voice</span>` : ''}
    </div>` : ''}
    <div class="ct-tp-top">
      <button class="gbtn chrome icon" data-act="ct-tp-close" aria-label="Close the teleprompter">${I.x}</button>
      <div class="ct-tp-title"><b class="ct-tp-tt">${esc(s.title)}</b><small class="num"><span class="ct-tp-code">${esc(cc)}</span> · take ${n} · ${wordsOf(TP.code)} words · <span class="ct-tp-wpm">${Math.round(WPM * o.speed)}</span> wpm</small></div>
      <button class="gbtn chrome icon" data-act="ct-tp-set" aria-label="Prompter settings" aria-expanded="false">${CI.sliders}</button>
    </div>
    <div class="ct-tp-prog" aria-hidden="true"><i></i></div>
    <div class="ct-tp-view">
      <span class="ct-tp-guide" aria-hidden="true"></span>
      <div class="ct-tp-text">
        <p class="ct-tp-slate" data-dir="1">Say “${esc(cc)}, take ${n}”</p>
        ${lines.map((l, i) => `${dirAt.has(i) ? `<p class="ct-tp-dir" data-dir="1">${esc(dirAt.get(i))}</p>` : ''}<p class="ct-tp-l">${esc(l)}</p>`).join('')}
      </div>
      <div class="ct-tp-count" aria-hidden="true"></div>
    </div>

    <div class="ct-tp-bot chrome">
      <div class="ct-tp-speed">
        <span class="foot">Speed</span>
        <input class="ct-range" type="range" min="0.5" max="2" step="0.05" value="${o.speed}" aria-label="Scroll speed in words per minute" />
        <b class="num ct-tp-sv">${Math.round(WPM * o.speed)}<small> wpm</small></b>
      </div>
      <div class="ct-tp-ctl">
        <button class="btn sm" data-act="ct-tp-mark" ${isShot(TP.code) ? 'disabled' : ''}>${I.check}${isShot(TP.code) ? 'Shot' : 'Mark shot'}</button>
        <button class="ct-tp-go ${o.camera ? 'rec' : ''}" data-act="ct-tp-go" aria-label="${o.camera ? 'Record' : 'Start'}">${o.camera ? '<i></i>' : I.play}</button>
        <button class="btn sm" data-act="ct-tp-next" ${list.length < 2 ? 'disabled' : ''}>Next ${esc(next ? codeOf(next) : '')}${I.arrowR}</button>
      </div>
    </div>`;
  TP.y = 0; TP.playing = false; TP.counted = false; TP.ended = false; TP.rec = false; TP.cd += 1; TP.panel = null;
  clearInterval(TP.tick);
  TP.el.classList.remove('counting', 'playing', 'recording');
  const r = $('.ct-range', TP.el);
  const paint = () => r.style.setProperty('--v', `${(o.speed - .5) / 1.5 * 100}%`);
  paint();
  r.addEventListener('input', () => { o.speed = Number(r.value); const w = Math.round(WPM * o.speed); $('.ct-tp-sv', TP.el).innerHTML = `${w}<small> wpm</small>`; $('.ct-tp-wpm', TP.el).textContent = w; paint(); });
  r.addEventListener('change', saveTp);
  if (REAL && o.camera) { if (TP.stream) attachVideo(); else fillCamState(); }
  requestAnimationFrame(() => { if (!TP) return; TP.y = firstY(); drawTp(); });
}
const tpLines = () => $$('.ct-tp-text .ct-tp-l', TP.el);
const mid = (p) => p.offsetTop + p.offsetHeight / 2;
const firstY = () => { const p = tpLines()[0]; return p ? mid(p) : 0; };
const lastY = () => { const ps = tpLines(); const p = ps[ps.length - 1]; return p ? mid(p) : 0; };
const clampY = (y) => Math.max(firstY() - 60, Math.min(lastY(), y));
function drawTp() {
  if (!TP) return;
  $('.ct-tp-text', TP.el).style.transform = `translate3d(0, ${-TP.y}px, 0)`;
  const ps = tpLines();
  let best = 0, bd = Infinity;
  ps.forEach((p, i) => { const d = Math.abs(mid(p) - TP.y); if (d < bd) { bd = d; best = i; } });
  ps.forEach((p, i) => { p.classList.toggle('cur', i === best); p.classList.toggle('past', i < best); });
  const span = lastY() - firstY();
  $('.ct-tp-prog i', TP.el)?.style.setProperty('--k', span > 0 ? Math.max(0, (TP.y - firstY()) / span).toFixed(4) : '0');
}
function tick(ts) {
  if (!TP?.playing) return;
  const dt = TP.last ? Math.min(64, ts - TP.last) : 16;
  TP.last = ts;
  const o = TP_S();
  if (o.voice) {
    // voice follow steps line by line: each line holds for as long as it takes to say, then the next one slides up
    const ps = tpLines();
    if (TP.vi == null) { TP.vi = Math.max(0, ps.findIndex((p) => p.classList.contains('cur'))); TP.vt = 0; }
    TP.vt += dt / 1000;
    const need = ps[TP.vi].textContent.split(/\s+/).length / (WPM * o.speed / 60);
    if (TP.vt >= need) {
      if (TP.vi >= ps.length - 1) { TP.vi = null; drawTp(); if (TP.rec) stopRec(); else setPlaying(false, true); return; }
      TP.vi += 1; TP.vt = 0;
    }
    TP.y += (mid(ps[TP.vi]) - TP.y) * Math.min(1, dt / 110);
    drawTp();
    TP.raf = requestAnimationFrame(tick);
    return;
  }
  // plain scroll glides at the chosen words per minute
  TP.y += dt / 1000 * 36 * o.speed * o.size;
  if (TP.y >= lastY()) { TP.y = lastY(); drawTp(); if (TP.rec) stopRec(); else setPlaying(false, true); return; }
  drawTp();
  TP.raf = requestAnimationFrame(tick);
}
function setPlaying(v, ended = false) {
  if (!TP) return;
  TP.playing = v; TP.vi = null;
  const b = $('.ct-tp-go', TP.el);
  if (!TP_S().camera) { b.innerHTML = v ? I.pause : ended ? I.undo : I.play; b.setAttribute('aria-label', v ? 'Pause' : ended ? 'Start again' : 'Start'); }
  TP.el.classList.toggle('playing', v);
  TP.ended = ended;
  if (v) { TP.last = 0; TP.raf = requestAnimationFrame(tick); } else cancelAnimationFrame(TP.raf);
}
// a workout-style countdown: each second closes a ring around its number
function countdown(done) {
  const c = $('.ct-tp-count', TP.el);
  let n = 3; const token = TP.cd = TP.cd + 1;
  TP.el.classList.add('counting');
  const step = () => {
    if (!TP || TP.cd !== token) return;
    if (n === 0) { c.classList.remove('on'); c.innerHTML = ''; TP.el.classList.remove('counting'); done(); return; }
    c.innerHTML = `${ring(0, 'content', 168, 12, { cls: 'ct-cd-ring' })}<b class="met">${n}</b>`;
    c.classList.remove('on'); void c.offsetWidth; c.classList.add('on');
    haptic(6); n -= 1; setTimeout(step, 650);
  };
  step();
}
function togglePlay() {
  if (!TP) return;
  if (TP_S().camera) { TP.rec ? stopRec() : startRec(); return; }
  if (TP.playing) { setPlaying(false); return; }
  if (TP.ended) { TP.y = firstY(); drawTp(); TP.ended = false; }
  if (!TP.counted && !reduced()) { TP.counted = true; $('.ct-tp-go', TP.el).disabled = true; countdown(() => { if (!TP) return; $('.ct-tp-go', TP.el).disabled = false; setPlaying(true); }); return; }
  setPlaying(true);
}
const MIMES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'];
function startRec() {
  if (!TP || TP.rec) return;
  const go1 = $('.ct-tp-go', TP.el); go1.disabled = true;
  TP.y = firstY() - 46; drawTp();
  const begin = () => {
    if (!TP) return;
    go1.disabled = false; go1.classList.add('on'); go1.setAttribute('aria-label', 'Stop recording');
    TP.rec = true; TP.t0 = performance.now(); TP.blob = null; TP.chunks = [];
    // a real recording when the camera is live (real mode); otherwise the prompter runs as a rehearsal
    if (REAL && TP.stream) {
      try {
        const mimeType = MIMES.find((t) => MediaRecorder.isTypeSupported?.(t));
        const rec = new MediaRecorder(TP.stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: 8_000_000 });
        const t = TP;
        rec.ondataavailable = (e) => { if (e.data?.size) t.chunks.push(e.data); };
        rec.onstop = () => { t.blob = new Blob(t.chunks, { type: rec.mimeType || mimeType || 'video/mp4' }); t.chunks = []; t.onBlob?.(t.blob); };
        rec.start(1000);
        TP.recorder = rec;
      } catch (e) { TP.recorder = null; console.warn('[content] recorder', e); }
    }
    TP.el.classList.add('recording');
    const r = $('.ct-tp-rec', TP.el); if (r) r.hidden = false;
    TP.tick = setInterval(() => { const sp = $('.ct-tp-rec span', TP?.el); if (sp) sp.textContent = dur((performance.now() - TP.t0) / 1000); }, 250);
    setPlaying(true);
  };
  if (reduced()) begin(); else countdown(begin);
}
function stopRec() {
  if (!TP?.rec) return;
  const secs = Math.max(3, Math.round((performance.now() - TP.t0) / 1000));
  TP.rec = false; clearInterval(TP.tick); setPlaying(false);
  TP.el.classList.remove('recording');
  const recorded = !!TP.recorder;
  try { TP.recorder?.state !== 'inactive' && TP.recorder?.stop(); } catch {}
  TP.recorder = null;
  const go1 = $('.ct-tp-go', TP.el); go1.classList.remove('on'); go1.setAttribute('aria-label', 'Record');
  const n = takeN(TP.code);
  const cc = codeOf(TP.code);
  // the take you just recorded: keep it (it starts uploading) or record it again
  const p = document.createElement('div');
  p.className = 'ct-tp-take overlay';
  p.innerHTML = REAL && !recorded
    ? `<div class="ct-tp-take-h"><span class="ct-tp-code">${esc(cc)}</span><b>Rehearsal</b><span class="num foot">${dur(secs)}</span></div>
      <p class="foot">${TP.cam === 'denied' ? 'Camera access is off for the app, so' : TP.cam === 'blocked' ? 'This browser page can\'t use the camera, so' : 'There\'s no camera here, so'} nothing was recorded. Record in the Camera app with this script, then upload the take.</p>
      <div class="ct-tp-take-acts"><button class="btn" data-act="ct-tp-retake">${CI.repeat}Again</button><button class="btn primary" style="--c:var(--content-fill)" data-act="ct-tp-mark">${I.check}Mark shot</button></div>`
    : `<div class="ct-tp-take-h"><span class="ct-tp-code">${esc(cc)}</span><b>Take ${n}</b><span class="num foot">${dur(secs)}</span></div>
      <p class="foot">${REAL ? `It goes to your PC and lands under ${esc(cc)}${META.flags?.transcribe ? '' : ''}.` : `Heard “${cc}, take ${n}” at 0:01. It goes to your PC and lands under ${cc}.`}</p>
      <div class="ct-tp-take-acts"><button class="btn" data-act="ct-tp-retake">${CI.repeat}Retake</button><button class="btn primary" style="--c:var(--content-fill)" data-act="ct-tp-keep" data-secs="${secs}">${I.check}Keep take ${n}</button></div>`;
  TP.el.append(p); TP.panel = p;
  requestAnimationFrame(() => p.classList.add('in'));
  haptic(12);
}
function onTpClick(e) {
  const b = e.target.closest('[data-act]'); if (!b || !TP || b.disabled) return;
  const a = b.dataset.act;
  if (a === 'ct-tp-close') closeTp();
  else if (a === 'ct-tp-go') togglePlay();
  else if (a === 'ct-tp-set') toggleSettings(b);
  else return;
  e.stopPropagation();
}
on('ct-tp-open', (el) => openTeleprompter(el.dataset.code));
on('ct-shoot', () => openTeleprompter());
on('ct-tp-keep', (el) => {
  if (!TP) return;
  const code = TP.code; const n = takeN(code);
  const secs = Number(el.dataset.secs) || 30;
  if (REAL) {
    const t = TP;
    const keep = (blob) => {
      if (!blob?.size) { toast('The recording came back empty; record it again'); return; }
      queueTake(blob, { script: code, code: codeOf(code), n, date: SHOOT.date ?? today(), secs, src: 'phone', name: `${codeOf(code)} take ${n}.${/webm/.test(blob.type) ? 'webm' : 'mp4'}` });
      redraw('takes');
    };
    if (t.blob) keep(t.blob); else t.onBlob = keep;
    toast(`${codeOf(code)} take ${n} kept · uploading to your PC`);
  } else {
    S.takes.forEach((t) => { if (t.code === code) t.best = false; });
    S.takes.push({ id: `t${Date.now()}`, code, n, secs, p: .02, kept: true, best: true, src: 'phone' });
    S.shot.add(code);
    redraw('takes');
    toast(`${code} take ${n} kept · uploading`, () => { S.takes.pop(); S.shot.delete(code); redraw('takes'); });
  }
  closePanel();
  const next = ready().filter((c) => !REAL || S.scripts[c].full).find((c) => !isShot(c) && c !== code);
  if (next) { TP.code = next; swapTp(); } else fillTp();
});
on('ct-tp-retake', () => { closePanel(); if (TP) { TP.blob = null; TP.onBlob = null; TP.y = firstY(); drawTp(); } });
const closePanel = () => { const p = TP?.panel; if (!p) return; TP.panel = null; p.classList.remove('in'); setTimeout(() => p.remove(), 260); };
on('ct-tp-mark', () => {
  if (!TP) return;
  const code = TP.code; haptic(12);
  if (REAL) { send('script', { script: code, status: 'shot' }); toast(`${codeOf(code)} marked shot`, () => send('script', { script: code, status: 'draft' })); }
  else { S.shot.add(code); toast(`${code} marked shot`, () => { S.shot.delete(code); redraw('takes'); }); }
  closePanel();
  redraw('takes');
  const next = ready().filter((c) => !REAL || S.scripts[c].full).find((c) => !isShot(c) && c !== code);
  if (next) { cancelAnimationFrame(TP.raf); TP.code = next; swapTp(); } else fillTp();
});
on('ct-tp-next', () => { if (!TP) return; const list = ready().filter((c) => !REAL || S.scripts[c].full); cancelAnimationFrame(TP.raf); TP.code = list[(list.indexOf(TP.code) + 1) % list.length]; swapTp(); });
function swapTp() {
  const v = $('.ct-tp-view', TP.el);
  if (reduced()) { fillTp(); return; }
  v.classList.add('ct-tp-swap');
  setTimeout(() => { if (!TP) return; fillTp(); $('.ct-tp-view', TP.el)?.classList.add('ct-tp-swapin'); }, 220);
}
// settings: text size, mirror for a glass rig, voice follow, and the camera behind the words
function toggleSettings(btn) {
  const open = $('.ct-tp-sets', TP.el);
  if (open) { open.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
  const o = TP_S();
  const p = document.createElement('div');
  p.className = 'ct-tp-sets overlay';
  const sw = (k, label, sub, icon) => `<button class="ct-tp-opt" data-k="${k}" aria-pressed="${!!o[k]}"><span class="ct-tp-oi">${icon}</span><span class="rbody"><b>${label}</b><small>${sub}</small></span><span class="switch ${o[k] ? 'on' : ''}" aria-hidden="true"></span></button>`;
  p.innerHTML = `<div class="ct-tp-size"><span class="foot">Text size</span><div class="ct-step"><button data-sz="-1" aria-label="Smaller text">${I.minus}</button><b class="num">${Math.round(o.size * 100)}%</b><button data-sz="1" aria-label="Larger text">${I.plus}</button></div></div>
    ${sw('camera', 'Camera', 'Record here, words under the lens', I.camera)}
    ${sw('mirror', 'Mirror', 'For a glass prompter rig', CI.mirror)}
    ${sw('voice', 'Follow my voice', 'Scrolls as you speak, waits when you stop', CI.voice)}`;
  TP.el.append(p); btn.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => p.classList.add('in'));
  p.addEventListener('click', (e) => {
    const t = e.target.closest('[data-k]'); const z = e.target.closest('[data-sz]');
    if (t) {
      o[t.dataset.k] = !o[t.dataset.k]; haptic(6); saveTp();
      if (t.dataset.k === 'camera') { if (o.camera && REAL) startCamera(); else if (!o.camera) { stopCamera(); TP.el.classList.remove('live'); } }
      fillTp(); toggleSettings($('[data-act="ct-tp-set"]', TP.el));
    }
    if (z) { o.size = Math.max(.8, Math.min(1.4, +(o.size + Number(z.dataset.sz) * .1).toFixed(2))); haptic(5); saveTp(); fillTp(); toggleSettings($('[data-act="ct-tp-set"]', TP.el)); }
    e.stopPropagation();
  });
}
function closeTp(instant) {
  if (!TP) return;
  const t = TP;
  const { el, raf, tick: tk } = t; cancelAnimationFrame(raf); clearInterval(tk); t.cd += 1; TP = null;
  try { if (t.recorder && t.recorder.state !== 'inactive') t.recorder.stop(); } catch {}
  // a kept take still waiting for its last chunk of data finishes saving before the camera goes
  if (t.onBlob && !t.blob) setTimeout(() => stopCamera(t), 1500); else stopCamera(t);
  if (instant || reduced()) { el.remove(); return; }
  el.classList.remove('in'); setTimeout(() => el.remove(), 420);
}
addEventListener('keydown', (e) => {
  if (!TP) return;
  if (e.key === 'Escape') { e.preventDefault(); closeTp(); }
  else if (e.key === ' ' && !e.target.closest?.('input, textarea, button')) { e.preventDefault(); togglePlay(); }
});

export const packInfo = () => {
  const rd = ready().filter((c) => order().includes(c));
  return { ready: rd, shot: rd.filter(isShot).length, first: rd.find((c) => !isShot(c)) ?? null, talk: rd.reduce((n, c) => n + secsOf(c), 0) };
};
export { openScripts, openScript, isShot, codes };

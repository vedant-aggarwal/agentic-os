// Content OS · shared state, the small router between its pages, and the pieces every Content screen draws with:
// channel marks, reel covers, status words, page heads, the bottom action bar. Owned by the Content area.
import { esc } from './core.js';
import { I } from './icons.js';
import { AGENT, NOW } from './data.js';
import { CHS, chOf, IDEAS, SCRIPTS, EDITS, WEEK, LEARN, PROPOSALS, VERDICTS, SHOOT, REAL, PACK, TAKES, META, onData } from './content-data.js';
import { ls } from './svc/api.js';
import { stagger } from './motion.js';

// ── state: real mode reads the live bindings (content-data.js refills them from the PC, with waiting ops drawn on top);
//    demo mode keeps the prototype's copies, so taps change what every screen reads and nothing leaves the phone ──
const clone = (x) => JSON.parse(JSON.stringify(x));
const TP_KEY = 'aos-content-tp';
export const S = {
  ch: 'all',                               // the channel filter: 'all' | '@northwindstudio' | '@example_creator'
  ideas: REAL ? IDEAS : clone(IDEAS),
  scripts: REAL ? SCRIPTS : clone(SCRIPTS),
  edits: REAL ? EDITS : clone(EDITS),
  week: REAL ? WEEK : clone(WEEK),
  learn: REAL ? LEARN : clone(LEARN),
  proposals: REAL ? PROPOSALS : clone(PROPOSALS),
  verdicts: REAL ? VERDICTS : clone(VERDICTS),
  takes: REAL ? TAKES : [],                // real: the PC's takes for today's pack (uploads in flight live in content-takes.js)
  pack: REAL ? PACK : ['R1', 'R4', 'R2', 'R3'],   // today's pack in shooting order
  shot: new Set(),                         // take codes marked shot (demo; real: the script's status)
  tp: { speed: 1, size: 1, mirror: false, voice: false, camera: true, ...(ls.json(TP_KEY) ?? {}) },
  sorted: 0,
};
export const saveTp = () => ls.set(TP_KEY, JSON.stringify(S.tp));
export { REAL, META };
export const inCh = (x) => S.ch === 'all' || x.ch === S.ch;
// a script read aloud: hook + beats + CTA, one line per sentence (the live copy, so a rewrite changes the prompter)
const sentences = (t) => (String(t ?? '').match(/[^.!?]+[.!?]+["'”’]*|[^.!?]+$/g) ?? [t]).map((x) => x.trim()).filter(Boolean);
export const takeLines = (code) => {
  const s = S.scripts[code]; if (!s) return [];
  return [...sentences(s.hooks[s.hook ?? 0]), ...s.beats.flatMap((b) => b.say), ...(s.cta ? [s.cta] : [])];
};
export const hookLineCount = (code) => { const s = S.scripts[code]; return s ? sentences(s.hooks[s.hook ?? 0]).length : 0; };
export const wordsOf = (code) => takeLines(code).join(' ').split(/\s+/).filter(Boolean).length;
// spoken at reel pace, about 160 words a minute (real scripts carry the PC's own estimate)
export const secsOf = (code) => (REAL && S.scripts[code]?.secs ? S.scripts[code].secs : Math.round(wordsOf(code) / 2.7));
/** A script's on-camera code: the take code when it is in a pack (R1), else its id (s65). */
export const codeOf = (id) => S.scripts[id]?.code ?? id;
export const idea = (id) => S.ideas.find((x) => x.id === id);
export const script = (code) => S.scripts[code];
export const edit = (id) => S.edits.find((x) => x.id === id);
export const newIdeas = () => S.ideas.filter((x) => x.status === 'new' && inCh(x) && (!REAL || x.score != null || x.pending));
/** How many ideas wait to be sorted (real: the PC's whole inbox; the deck walks the best of them). */
export const toSortCount = () => (REAL ? Math.max(newIdeas().length, (S.ch === 'all' ? META.deckCount : newIdeas().length)) : newIdeas().length);
// where a set of ideas came from, as a sentence: "From the radar, your work and a reel you shared."
export const srcSentence = (list) => {
  const n = (k) => list.filter((x) => x.source === k).length;
  const parts = [n('radar') && 'the radar', n('work') && 'your work', n('reel') && (n('reel') > 1 ? 'reels you shared' : 'a reel you shared'), n('link') && (n('link') > 1 ? 'links you shared' : 'a link you shared'), n('you') && 'your own notes'].filter(Boolean);
  return parts.length ? `From ${parts.join(', ').replace(/, ([^,]*)$/, ' and $1')}.` : '';
};

// ── a tiny router: each Content module registers its pages; anyone in Content calls go('idea:c6') ──
const ROUTES = new Map();
export const route = (name, fn) => ROUTES.set(name, fn);
export function go(view = 'home', ...rest) {
  const [name, arg] = String(view).split(':');
  const fn = ROUTES.get(name);
  if (fn) return fn(arg ?? rest[0], ...rest.slice(arg ? 0 : 1));
  return ROUTES.get('home')?.();
}
// the page Content rebuilds after a change (home and stage pages register a redraw)
const REDRAW = new Set();
export const onRedraw = (fn) => { REDRAW.add(fn); return () => REDRAW.delete(fn); };
export const redraw = (what) => REDRAW.forEach((fn) => { try { fn(what); } catch (e) { console.warn('[content] redraw', e); } });
onData((why) => redraw(why));

// ── time ──
export const hm = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const untilText = (m) => { if (m == null) return 'time not set'; const d = m - NOW; if (d <= 0) return 'now'; return d < 60 ? `in ${d} min` : `in ${Math.floor(d / 60)}h${d % 60 ? ` ${d % 60}m` : ''}`; };
export const dur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
export const kfmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n));
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const shootAt = () => SHOOT.at;

// ── extra glyphs, drawn like js/icons.js (24 grid, 2px line) ──
const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
export const CI = {
  bookmark: s('<path d="M7 3.5h10a1 1 0 0 1 1 1v16l-6-4-6 4v-16a1 1 0 0 1 1-1Z"/>'),
  layers: s('<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/>'),
  mirror: s('<path d="M12 3v18"/><path d="M8.5 7 4 12l4.5 5z"/><path d="M15.5 7 20 12l-4.5 5z" fill="currentColor"/>'),
  text: s('<path d="M4 18 8.5 6h1L14 18M5.6 14h6.8"/><path d="M15 18l2.6-7h.8l2.6 7M15.9 15.6h4.2"/>'),
  rec: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="currentColor"/></svg>',
  voice: s('<path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10.5v3"/>'),
  grid: s('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16"/>'),
  chart: s('<path d="M4 20V4"/><path d="M4 20h16"/><path d="m7.5 15 3.5-4 3 2.5 5-6.5"/>'),
  safe: s('<rect x="5.5" y="2.5" width="13" height="19" rx="3"/><path d="M15 9v7M8.5 17.5h4"/>'),
  sliders: s('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>'),
  frame: s('<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="10" r="2.6"/><path d="M7.5 17c.8-2.2 2.5-3.3 4.5-3.3s3.7 1.1 4.5 3.3"/>'),
  light: s('<circle cx="12" cy="12" r="3.6"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>'),
  shirt: s('<path d="m8.5 4-4.5 3 2 4 2-1V20h8V10l2 1 2-4-4.5-3c-.5 1.5-1.8 2.5-3.5 2.5S9 5.5 8.5 4Z"/>'),
  swipe: s('<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11"/><path d="M12 10.5V9.4a1.5 1.5 0 0 1 3 0v1.6a1.5 1.5 0 0 1 3 0v3.5a6 6 0 0 1-6 6h-.6a5.4 5.4 0 0 1-4.5-2.4L4.5 14.4a1.6 1.6 0 0 1 2.4-2l2.1 2"/>'),
  upload: s('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5"/><path d="M4.5 14.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/>'),
  kill: s('<path d="M6 6l12 12M18 6 6 18"/>', 'stroke-width="2.6"'),
  keep: s('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'stroke-width="2.6"'),
  pen: s('<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/>', 'stroke-width="2.4"'),
  flip: s('<path d="M7 7h10a3 3 0 0 1 3 3v1M17 17H7a3 3 0 0 1-3-3v-1"/><path d="m14 4 3 3-3 3M10 20l-3-3 3-3"/>'),
  repeat: s('<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5"/>'),
};

// ── channels: a dot, an avatar (monogram in the channel's step of cyan), a chip ──
export const chDot = (ch) => `<span class="dot" style="--c:${chOf(ch).tint}" aria-hidden="true"></span>`;
export const chAv = (ch, cls = '') => { const c = chOf(ch); return `<span class="ct-av ${cls}" style="--t:${c.tint}" aria-hidden="true">${esc(c.mono)}</span>`; };
export const chName = (ch) => esc(ch);
export const chLine = (ch, rest = '') => `${chDot(ch)}<span class="ell">${esc(ch)}${rest ? ` · ${rest}` : ''}</span>`;

// ── a status word leads a row's meta line, in its semantic colour; running work carries the small spinner ──
export const word = (text, c = 'var(--ink-2)', spin = false) =>
  `<span class="ct-st" style="--c:${c}">${spin ? '<span class="spin" style="--c:var(--content)" aria-hidden="true"></span>' : ''}${esc(text)}</span>`;
export const IDEA_WORD = {
  new: () => word('New', 'var(--content-ink)'),
  kept: () => word('Kept', 'var(--ink)'),
  writing: () => word('Writing', 'var(--content-ink)', true),
  scripted: () => word('Scripted', 'var(--done)'),
  shot: () => word('Shot', 'var(--done)'),
  edited: () => word('In edits', 'var(--done)'),
  scheduled: () => word('Scheduled', 'var(--done)'),
  posted: () => word('Posted', 'var(--ink-2)'),
  killed: () => word('Killed', 'var(--ink-3)'),
};
export const SRC = {
  radar: { label: 'Radar', icon: I.radar },
  work: { label: 'From your work', icon: I.hammer },
  reel: { label: 'Shared reel', icon: I.film },
  link: { label: 'Shared link', icon: I.link },
  you: { label: 'Yours', icon: I.bulb },
  agent: { label: 'Research', icon: I.sparkle },
  email: { label: 'Email', icon: I.chat },
};

// ── a page head: a kicker in Content's colour, the large title, a subline, an optional right slot ──
export const head = ({ kicker = '', title, sub = '', right = '' }) => `
  <div class="phead ct-head">
    <div class="ct-head-l">
      ${kicker ? `<p class="kicker c-content">${kicker}</p>` : ''}
      <h1 class="lt">${esc(title)}</h1>
      ${sub ? `<p class="sub">${sub}</p>` : ''}
    </div>
    ${right ? `<div class="ct-head-r">${right}</div>` : ''}
  </div>`;
/** Redraw a page without losing what he is typing: text fields keep their value, focus and caret across the redraw
 *  (the PC's answer can land mid-word). Fields are matched by id, then data-edit, then their place on the page. */
export function keepInputs(root, draw) {
  if (!root) return draw();
  const keyOf = (el, i) => el.id || (el.dataset.edit ? `edit:${el.dataset.edit}` : `n${i}`);
  const fields = [...root.querySelectorAll('input[type="text"], input:not([type]), textarea')];
  const saved = new Map(fields.map((el, i) => [keyOf(el, i), { v: el.value, focus: document.activeElement === el, s: el.selectionStart, e: el.selectionEnd, dirty: el.value !== el.defaultValue }]));
  const r = draw();
  [...root.querySelectorAll('input[type="text"], input:not([type]), textarea')].forEach((el, i) => {
    const k = saved.get(keyOf(el, i)); if (!k || !k.dirty) return;
    el.value = k.v;
    if (k.focus) { el.focus({ preventScroll: true }); try { el.setSelectionRange(k.s, k.e); } catch {} }
  });
  return r;
}
/** A pushed page's first paint: its cards and rows arrive in a short stagger (the motion kit; a fade under reduced motion). */
export function enter(sc) {
  try { stagger([...sc.querySelectorAll(':scope > .phead, :scope > .surface, :scope > .group, :scope > .ct-elist > .ct-ecard, :scope > .ct-tiles > .ct-tile, :scope > .note')].slice(0, 14), { y: 10, each: 35, max: 360 }); } catch { /* motion is decoration */ }
}
export const askBtn = (about = 'content') => `<button class="gbtn chrome icon" data-act="ct-ask" data-about="${about}" aria-label="Ask ${esc(AGENT.name)} about Content">${I.sparkle}</button>`;
// a pushed page's one action, floating over its bottom edge (chrome)
export const bar = (html, cls = '') => `<div class="ct-bar ${cls}"><div class="ct-bar-in chrome">${html}</div></div>`;

// ── reel covers: a 9:16 frame drawn in SVG, so it reads as a video still at any size. Media stays dark in every
//    theme. Each channel captions its own way: @northwindstudio left-set, one line in electric blue; @example_creator
//    boxed and centred, the way handheld reels caption. The scene is a few strokes of line art. ──
const SCENES = {
  agents: '<rect x="31" y="20" width="28" height="50" rx="5"/><path d="M36 31h11M36 39h14M36 47h9M36 55h12"/><circle cx="52.5" cy="31" r="1.6" class="a"/><circle cx="54" cy="47" r="1.6" class="a"/><path d="M14 74h62"/>',
  apps: '<rect x="12" y="22" width="11" height="11" rx="3"/><rect x="27" y="14" width="11" height="11" rx="3"/><rect x="52" y="14" width="11" height="11" rx="3"/><rect x="67" y="22" width="11" height="11" rx="3"/><rect x="39.5" y="10" width="11" height="11" rx="3"/><rect x="33" y="44" width="24" height="24" rx="6" class="a"/><path d="M23 33l12 12M38 25l4 18M52 25l-4 18M67 33 55 45"/>',
  kurta: '<path d="M18 16c14 10 14 24 0 36s-6 26 10 32"/><path d="M30 14c14 10 14 24 0 36s-6 26 10 32"/><path d="M42 12c14 10 14 24 0 36s-6 26 10 32" class="a"/><path d="M60 18v58M66 18v58"/><path d="m60 26 6 4-6 4 6 4-6 4 6 4-6 4 6 4-6 4"/>',
  shop: '<path d="M14 34 20 18h50l6 16"/><path d="M14 34a7 7 0 0 0 14 0 7 7 0 0 0 14 0 7 7 0 0 0 14 0 7 7 0 0 0 14 0" class="a"/><path d="M19 38v38h52V38"/><path d="M38 76V60a7 7 0 0 1 14 0v16"/>',
  site: '<rect x="29" y="12" width="32" height="58" rx="5"/><path d="M29 22h32"/><rect x="34" y="27" width="22" height="13" rx="2" class="a"/><path d="M34 46h22M34 52h16M34 58h19"/>',
  coin: '<circle cx="45" cy="40" r="11" class="a"/><path d="M45 34v12M41 37.5c1-1.5 6-1.5 7 0s-1 2.5-3 2.5-4 1-3 2.5 6 1.5 7 0"/><path d="M18 58c8-10 18-12 27-6M72 58c-8-10-18-12-27-6"/><path d="M22 24c4-4 9-6 14-6M68 24c-4-4-9-6-14-6"/>',
  chai: '<path d="M31 30h28l-4 40H35z"/><path d="M33 44h24" class="a"/><path d="M38 24c-2-3 2-5 0-8M45 24c-2-3 2-5 0-8M52 24c-2-3 2-5 0-8"/><path d="M20 74h50"/>',
  card: '<rect x="18" y="20" width="26" height="38" rx="3"/><path d="m31 32 4.5 7-4.5 7-4.5-7z" class="a"/><rect x="50" y="24" width="22" height="40" rx="4"/><path d="m61 37 3 5-3 5-3-5z"/>',
  diya: '<path d="M22 54c6 10 40 10 46 0"/><path d="M18 54h54"/><path d="M45 50c-6-6-6-12 0-22 6 10 6 16 0 22Z" class="a"/><path d="M30 70h30"/>',
  metro: '<rect x="18" y="18" width="54" height="40" rx="8"/><path d="M45 18v40" /><path d="M30 8v10M60 8v10"/><circle cx="30" cy="70" r="3" class="a"/><circle cx="60" cy="70" r="3" class="a"/><path d="M18 64h54"/>',
  desk: '<rect x="22" y="26" width="46" height="30" rx="3"/><path d="M16 60h58"/><path d="M30 36h14M30 43h22" class="a"/><path d="M45 60v14M34 74h22"/>',
  clock: '<circle cx="45" cy="42" r="22"/><path d="M45 28v14l9 6" class="a"/><path d="M45 20v3M45 61v3M23 42h3M64 42h3"/>',
  face: '<circle cx="45" cy="44" r="15"/><path d="M17 104c3-20 14-30 28-30s25 10 28 30" /><path d="M39 42h.01M51 42h.01" class="a"/>',
};
export function cover(c = {}, { ch = '@northwindstudio', w = 54, cls = '', dur: d = null, label = '', state = '' } = {}) {
  const pl = chOf(ch).short === 'example_creator';
  const lines = (c.lines ?? ['', '']).slice(0, 2);
  const tint = pl ? '#7cf2e6' : '#33c6ff';   // the media's own pigments: they do not change with the theme
  // captions are set at 14 units and scaled down to fit the frame's width (CW: a bold glyph's average width)
  const CW = 8.1, fit = (l, room) => Math.min(1, room / Math.max(1, l.length * CW));
  const cap = pl
    ? lines.map((l, i) => { const k = fit(l, 66), bw = l.length * CW * k + 9; return `<rect x="${(45 - bw / 2).toFixed(1)}" y="${105 + i * 17}" width="${bw.toFixed(1)}" height="15" rx="2.5" fill="${i === c.hi ? tint : '#f6f6f8'}"/><text transform="translate(45 ${116.5 + i * 17}) scale(${k.toFixed(3)})" text-anchor="middle" fill="#0b0b0d">${esc(l)}</text>`; }).join('')
    : lines.map((l, i) => { const k = fit(l, 70); return `<text transform="translate(10 ${117 + i * 16}) scale(${k.toFixed(3)})" fill="${i === c.hi ? tint : '#f6f6f8'}">${esc(l)}</text>`; }).join('');
  const scene = SCENES[c.scene] ?? '';
  return `<span class="ct-cv ${cls} ${state ? `is-${state}` : ''}" style="--w:${w}px;--tint:${tint}" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'}>
    <svg viewBox="0 0 90 160" preserveAspectRatio="xMidYMid slice"><rect width="90" height="160" fill="#0d0e11"/>
      <g class="ct-cv-art" transform="translate(0 6)">${scene}</g>
      <g class="ct-cv-cap ${pl ? 'pl' : 'nd'}">${cap}</g></svg>
    ${d != null ? `<span class="ct-cv-dur num">${dur(d)}</span>` : ''}
  </span>`;
}
export const faceFrame = SCENES.face;
export { CHS, chOf, SHOOT };

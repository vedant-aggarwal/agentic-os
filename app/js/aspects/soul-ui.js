// Soul: icons, session state and the clock shared by soul.js, soul-clean.js and soul-blocker.js. Owner: the Soul agent.
// Icons are drawn like js/icons.js: 24 grid, 2px line, round caps; strokes take currentColor.
import { I } from '../icons.js';
import { openSheet, peek } from '../core.js';
import { AGENT } from '../data.js';
import * as ST from './soul-store.js';

const s = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const face = (mouth) => s(`<circle cx="12" cy="12" r="8.6"/><path d="M9.1 10h.01M14.9 10h.01" stroke-width="2.7"/>${mouth}`);

export const SI = {
  // the urge button: breath, three lines of moving air
  wind: s('<path d="M3 8h9.5a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h6"/>', 'stroke-width="2.2"'),
  sunrise: s('<path d="M3 18h18M7.5 18a4.5 4.5 0 0 1 9 0M12 5.5v4M5.6 10.6l1.5 1.5M18.4 10.6l-1.5 1.5"/>'),
  phoneOff: s('<rect x="7" y="2.8" width="10" height="18.4" rx="2.6"/><path d="M10.6 17.8h2.8M3.8 4.2 20.2 19.8"/>'),
  lotus: s('<path d="M12 19.5c-1.9-2.2-2.6-4.4-2.6-6.4S10.4 9 12 7c1.6 2 2.6 4 2.6 6.1s-.7 4.2-2.6 6.4Z"/><path d="M12 19.5c-3.6.2-6.7-1.3-8.5-4.4 2.3-.6 4.3-.4 5.9.4M12 19.5c3.6.2 6.7-1.3 8.5-4.4-2.3-.6-4.3-.4-5.9.4"/>'),
  dinner: s('<path d="M7.5 3v7M5 3v4.5a2.5 2.5 0 0 0 5 0V3M7.5 10v11"/><path d="M17.5 21V3c-2.2 1.3-3.2 4-3.2 7.6V13h3.2"/>'),
  faceId: s('<path d="M4 8.5v-2A2.5 2.5 0 0 1 6.5 4h2M15.5 4h2A2.5 2.5 0 0 1 20 6.5v2M20 15.5v2a2.5 2.5 0 0 1-2.5 2.5h-2M8.5 20h-2A2.5 2.5 0 0 1 4 17.5v-2"/><path class="fid-f" d="M9 9.5v1.5M15 9.5v1.5M12.2 9.5v3.6h-1.1M9.4 15.6c1.5 1.3 3.7 1.3 5.2 0"/>'),
  walk: s('<circle cx="13" cy="4.6" r="1.8"/><path d="M12.4 8 11 13.2l-2.6 7.3M11 13.2l3 2.8.6 4.5M8 11l4.4-3 3.4 3.4"/>'),
  drop: s('<path d="M12 3.5c3.5 4.2 6 7.4 6 10.6a6 6 0 0 1-12 0c0-3.2 2.5-6.4 6-10.6Z"/>'),
  quote: s('<path d="M10 7.5H6.5A1.5 1.5 0 0 0 5 9v3a1.5 1.5 0 0 0 1.5 1.5H9V15a2.5 2.5 0 0 1-2.5 2.5M19 7.5h-3.5A1.5 1.5 0 0 0 14 9v3a1.5 1.5 0 0 0 1.5 1.5H18V15a2.5 2.5 0 0 1-2.5 2.5"/>'),
  hand: s('<path d="M8.5 12.5V5.8a1.4 1.4 0 0 1 2.8 0V11M11.3 10.6V4.4a1.4 1.4 0 0 1 2.8 0v6.2M14.1 10.8V6.2a1.4 1.4 0 0 1 2.8 0v7.3a6.8 6.8 0 0 1-6.8 6.8h-.4a6.2 6.2 0 0 1-5-2.5l-1.9-2.6a1.5 1.5 0 0 1 2.3-1.9l2.6 2.2"/>'),
  unlock: s('<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8 10.5V8a4 4 0 0 1 7.7-1.6"/>'),
  heat: s('<rect x="3.5" y="4.5" width="5" height="5" rx="1.2"/><rect x="9.5" y="4.5" width="5" height="5" rx="1.2"/><rect x="15.5" y="4.5" width="5" height="5" rx="1.2"/><rect x="3.5" y="10.5" width="5" height="5" rx="1.2"/><rect x="9.5" y="10.5" width="5" height="5" rx="1.2" fill="currentColor"/><rect x="15.5" y="10.5" width="5" height="5" rx="1.2"/><path d="M4 19.5h16"/>'),
  chain: s('<circle cx="12" cy="12" r="8.5" stroke-dasharray="2.4 3.2"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"/>'),
  seedling: s('<path d="M12 20.5v-8"/><path d="M12 12.5c0-3.6-2.4-6-6.5-6 0 3.8 2.6 6 6.5 6ZM12 14.5c0-3.8 2.5-6.6 7-6.6 0 4.3-2.8 6.6-7 6.6Z"/>'),
  camera: I.camera, play: I.play, book: I.book, pen: I.edit, moon: I.moon, dumbbell: I.dumbbell,
  // check-in faces: five plain words, five plain mouths
  mood: [
    face('<path d="M8.6 16.2c.9-1.3 2-1.9 3.4-1.9s2.5.6 3.4 1.9"/>'),
    face('<path d="M9 15.2h6"/>'),
    face('<path d="M9 14.6c.9.6 1.9.9 3 .9s2.1-.3 3-.9"/>'),
    face('<path d="M8.6 14c.9 1.5 2 2.2 3.4 2.2s2.5-.7 3.4-2.2"/>'),
    face('<path d="M8.4 13.6h7.2a3.6 3.6 0 0 1-7.2 0Z"/>'),
  ],
};

// Session state only: what is on screen right now. Everything that lasts is a record (soul-store.js).
export const S = {
  app: null,            // the open Soul app (js/aspects.js app object), while it is open
  unlocked: false,      // Clean's privacy lock: locks again every time Soul opens
  mood: null,           // the check-in he tapped this session: { v, at, id }
  peek: null,           // the habit a peek or sheet was opened for
};

// her name: Wyn for the owner, Wyn for a new account (DECISIONS 1)
export const who = () => AGENT?.name || 'Wyn';
// the real clock (svc/clock), shown in IST whatever the phone's time zone
export const now = () => new Date(ST.nowMs());
export const pad = (n) => String(n).padStart(2, '0');
export const hhmm = (d) => ST.hhmm(typeof d === 'number' ? d : d.getTime());
export const plural = (n, w, ws = `${w}s`) => `${n} ${n === 1 ? w : ws}`;
export const cleanSince = () => new Date(ST.clean()?.sinceMs ?? ST.nowMs());
export function cleanElapsed() {
  const ms = Math.max(0, ST.nowMs() - cleanSince().getTime());
  const days = ms / 864e5;
  const d = Math.floor(days);
  const rest = ms - d * 864e5;
  return { ms, days, d, h: Math.floor(rest / 36e5), m: Math.floor((rest % 36e5) / 6e4), s: Math.floor((rest % 6e4) / 1e3) };
}
// "4 d 14 h", "3 h 20 m", "12 m"
export function span(ms) {
  const m = Math.max(0, Math.round(ms / 6e4));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d} d ${h} h` : h ? `${h} h ${mm} m` : `${mm} m`;
}
// an aspect's dot, the only way another app's colour appears inside Soul
export const adot = (id) => `<span class="dot sou-adot" style="--c:var(--${id})" aria-hidden="true"></span>`;

// Sheets and peeks hang off #phone, outside the Soul page, so they carry the colour themselves
export function soulSheet(o) { const el = openSheet(o); el.dataset.aspect = 'soul'; return el; }
export function soulPeek(html, menu) { peek(html, menu); const w = document.querySelector('#peek > div'); if (w) w.dataset.aspect = 'soul'; }

// Something in S changed (a lock, an unlock, a reset): the screens that show it repaint themselves
export const emit = () => document.dispatchEvent(new CustomEvent('sou:state'));
export const onState = (fn) => document.addEventListener('sou:state', fn);

// One clock for every live figure in Soul (the streak, an open unlock). It runs while something on screen
// reads it and stops by itself when nothing does.
const ticks = new Set();
let timer = null;
export function onTick(fn) {
  ticks.add(fn);
  if (!timer) timer = setInterval(() => { for (const f of [...ticks]) { if (f() === false) ticks.delete(f); } if (!ticks.size) { clearInterval(timer); timer = null; } }, 1000);
}

// Private folders (Romance, Soul) behind Face ID. One unlock opens both for this visit; they close again when the app
// goes to the background or after five quiet minutes. On the iPhone it is Face ID (or the passcode) through NATIVE's
// auth.authenticate; in a browser, which has no Face ID, it is a deliberate press-and-hold so nothing private opens on a
// stray tap. Until unlocked, private notes stay out of the home, search, the graph, Spotlight and the Life tab.
// Owner: BRAIN. This gates the screens; the notes themselves still sync to the phone (notes/brain.md, What's weak).
import { $, openSheet, closeSheet, haptic, esc } from './core.js';
import { I } from './icons.js';
import { aspect } from './data.js';
import { PRIVATE, setUnlocked } from './brain-data.js';

const IDLE = 5 * 60_000;
let open = new Set(), timer = 0;
export const isOpen = () => open.size > 0;
function lock(why = 'idle') {
  if (!open.size) return;
  open = new Set(); setUnlocked(open);
  document.dispatchEvent(new CustomEvent('brain-locked', { detail: { why } }));
}
const touch = () => { clearTimeout(timer); timer = setTimeout(() => lock('idle'), IDLE); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') lock('background'); });
document.addEventListener('pointerdown', () => { if (open.size) touch(); }, { passive: true });

async function faceId(reason) {
  try {
    const { native } = await import('./svc/native-plugins.js');
    if (!native?.available) return null;
    const st = await native.auth.status();
    if (st?.available === false) return null;
    const r = await native.auth.authenticate({ reason, passcode: true });
    return r.available === false ? null : !!r.ok;
  } catch { return null; }
}
// the browser's stand-in: hold the lock for a second
function holdToOpen(name) {
  return new Promise((resolve) => {
    let done = false, t0 = 0, raf = 0;
    const finish = (ok) => { if (done) return; done = true; cancelAnimationFrame(raf); closeSheet(sh); resolve(ok); };
    const sh = openSheet({
      title: `${name} is private`, sub: 'This browser has no Face ID. Press and hold to open your private folders for this visit.',
      body: `<div class="pad br-hold"><button class="br-hold-b" data-act="br-hold" aria-label="Press and hold to open">
        <svg viewBox="0 0 64 64" aria-hidden="true"><circle class="br-hold-t" cx="32" cy="32" r="28"/><circle class="br-hold-p" cx="32" cy="32" r="28" pathLength="100"/></svg>
        <span class="br-hold-i">${I.lock}</span></button><p class="foot">They close again when you leave the app.</p></div>`,
      onClose: () => finish(false),
    });
    const b = $('.br-hold-b', sh);
    const ring = $('.br-hold-p', sh);
    const tick = () => { const p = Math.min(1, (performance.now() - t0) / 900); ring.style.strokeDashoffset = String(100 - p * 100); if (p >= 1) { haptic(20); finish(true); return; } raf = requestAnimationFrame(tick); };
    const start = (e) => { e.preventDefault(); t0 = performance.now(); haptic(6); b.classList.add('on'); raf = requestAnimationFrame(tick); };
    const stop = () => { if (done) return; cancelAnimationFrame(raf); b.classList.remove('on'); ring.style.strokeDashoffset = '100'; };
    b.addEventListener('pointerdown', start); b.addEventListener('pointerup', stop); b.addEventListener('pointerleave', stop); b.addEventListener('pointercancel', stop);
    b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { haptic(20); finish(true); } });
  });
}

/** Open the private folders (asks Face ID, or the hold in a browser). Resolves true when they're open. */
export async function unlock(asp = PRIVATE[0]) {
  if (open.size) { touch(); return true; }
  const name = aspect(asp)?.name ?? 'This folder';
  const r = await faceId(`Open ${name} in your Brain`);
  const ok = r == null ? await holdToOpen(name) : r;
  if (!ok) return false;
  open = new Set(PRIVATE); setUnlocked(open); touch();
  document.dispatchEvent(new CustomEvent('brain-unlocked'));
  return true;
}
export const lockNow = () => lock('asked');
export const lockLabel = () => esc(PRIVATE.map((a) => aspect(a)?.name ?? a).join(' and '));

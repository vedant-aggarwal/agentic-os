// Skins: one app, two materials. The skin is an attribute on <html> (data-skin="obsidian" | "matte");
// every skin-specific rule in the CSS is scoped to it, so switching is one attribute write.
// index.html sets the attribute before the first paint (from ?skin= or localStorage); this module
// keeps it in sync, runs the crossfade, re-draws the rings on the page you are looking at, and
// renders the two-option control used by More and the account sheet.
import { $, $$, seg, pulse, visiblePage, haptic } from './core.js';

const KEY = 'aos-skin';
const icon = (ground, a, b, c) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='9' fill='${ground}'/><g fill='none' stroke-width='3.2' stroke-linecap='round'><path d='M16 4.5a11.5 11.5 0 1 1-10 5.8' stroke='${a}'/><path d='M16 9a7 7 0 1 1-6.9 8.2' stroke='${b}'/><path d='M16 13.4a2.6 2.6 0 1 1-1.7 4.6' stroke='${c}'/></g></svg>`)}`;

export const SKINS = [
  { id: 'obsidian', name: 'Obsidian', bar: { dark: '#050506', light: '#e7e7eb' }, icon: icon('#000', '#fa114f', '#a3f000', '#a47bff') },
  { id: 'matte', name: 'Matte', bar: { dark: '#12100e', light: '#efe9e0' }, icon: icon('#12100e', '#d55e72', '#add45a', '#9a80dc') },
];
const known = (id) => SKINS.some((s) => s.id === id);
export const skin = () => document.documentElement.dataset.skin;

// browser chrome follows the skin: status bar colour and the tab icon
function syncMeta() {
  const s = SKINS.find((x) => x.id === skin()) ?? SKINS[0];
  const light = document.documentElement.dataset.theme === 'light';
  $('meta[name="theme-color"]')?.setAttribute('content', light ? s.bar.light : s.bar.dark);
  $('link[rel="icon"]')?.setAttribute('href', s.icon);
  // Android ignores theme-color inside the app, so its status bar icons are set here (DARK = light icons)
  const C = globalThis.Capacitor;
  if (C?.getPlatform?.() === 'android') C.Plugins?.StatusBar?.setStyle?.({ style: light ? 'LIGHT' : 'DARK' })?.catch?.(() => {});
}

// every copy of the control shows the same choice
function syncControls() {
  $$('[data-seg="skin"]').forEach((sg) => {
    $$('button', sg).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === skin())));
    sg._place?.(true);
  });
}

// The switch: an instant attribute write inside a short crossfade. The page you are on re-draws its rings
// once in the new material (Obsidian's light blooms, Matte's ink goes in). View Transitions where the browser
// has them; a plain fade of the phone otherwise. Input is held only for the length of the fade.
export function setSkin(id, { animate = true } = {}) {
  if (!known(id)) return;
  if (id === skin()) { syncControls(); return; }
  const apply = () => {
    document.documentElement.dataset.skin = id;
    try { localStorage.setItem(KEY, id); } catch {}
    syncMeta();
    syncControls();
    pulse(visiblePage());
  };
  if (!animate) { apply(); return; }
  if (document.startViewTransition) { document.startViewTransition(apply); return; }
  const host = $('#phone') ?? $('main') ?? document.body;
  host.classList.add('skin-fade', 'skin-out');
  setTimeout(() => {
    apply();
    requestAnimationFrame(() => host.classList.remove('skin-out'));
    setTimeout(() => host.classList.remove('skin-fade'), 240);
  }, 140);
}

// The control: the system's segmented control, each option leading with a tiny swatch of its skin.
// The swatches are painted by each skin's own stylesheet and do not change with the active skin.
export const skinSeg = (cls = '') => seg('skin', SKINS.map((s) => [s.id, `<span class="skin-sw" data-sw="${s.id}" aria-hidden="true"></span>${s.name}`]), skin(), `skin-seg ${cls}`);

// The theme: dark or light, remembered (aos-theme); 'auto' follows the phone. index.html applies it before the first
// paint (?theme= for one visit only); More's Theme control calls setTheme.
const THEME_KEY = 'aos-theme';
const osLight = matchMedia('(prefers-color-scheme: light)');
export const themePref = () => { try { const v = localStorage.getItem(THEME_KEY); return ['dark', 'light', 'auto'].includes(v) ? v : 'dark'; } catch { return 'dark'; } };
export const theme = () => document.documentElement.dataset.theme || 'dark';
export function setTheme(pref, { animate = true } = {}) {
  if (!['dark', 'light', 'auto'].includes(pref)) return;
  try { localStorage.setItem(THEME_KEY, pref); } catch {}
  const next = pref === 'auto' ? (osLight.matches ? 'light' : 'dark') : pref;
  if (next === theme()) return;
  const apply = () => { document.documentElement.dataset.theme = next; pulse(visiblePage()); };
  if (animate && document.startViewTransition) document.startViewTransition(apply); else apply();
}
osLight.addEventListener?.('change', () => { if (themePref() === 'auto') setTheme('auto', { animate: false }); });

export function initSkin() {
  if (!known(skin())) document.documentElement.dataset.skin = SKINS[0].id;
  syncMeta();
  document.addEventListener('change', (e) => {
    if (!e.target.closest?.('[data-seg="skin"]')) return;
    haptic(6);
    setSkin(e.detail);
  });
  // the theme can change too (More → Theme); the status bar colour follows both
  new MutationObserver(syncMeta).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.__skin = { set: setSkin, get: skin, theme: setTheme };
}

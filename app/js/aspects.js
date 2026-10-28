// The nine aspect apps: the registry, the shared app frame and deep links. Owned by the lead.
//
// Each aspect of the life wheel is its own app inside the app. js/aspects/<id>.js calls registerAspect() once, on import:
//   id         'money'
//   sections   2–5 of [{ id, label, icon, render(el, app) }]. The first is the app's home. They sit in the app's own
//              tab bar at the bottom, beside the app's one primary action (the round button). A section renders once,
//              the first time it is shown, and keeps its state and scroll after that; render again with app.refresh(id).
//   primary    { label, icon, run(app) }   the action you reach for most here (log an expense, start a workout)
//   summary()  → { line, metric: { v, unit, label }, today: [{ text, done, act }], streak }   read by Home, Life and the agent
//   widget()   → html, an optional card for Today. Home decides where cards go and how many show.
//   scan       [{ kind, label, hint, handle(result) }]   what the one Scan button can route into this app
//   tools      [{ name, does }]   what the agent can do in this app (the agent's permissions page lists them)
//   onOpen(app), onSection(app, id)   optional hooks
// The app object handed to render/run: { id, def, aspect, page, scroll, section, go(id), el(id), refresh(id), rebuild() }
import { $, $$, esc, push, on, haptic, pulse, wireSegs, ring, toast } from './core.js';
import { I, aspectIcon } from './icons.js';
import { ASPECTS, aspect, AGENT } from './data.js';
import { provide, api } from './bus.js';

const REG = new Map();
export function registerAspect(def) { REG.set(def.id, def); document.dispatchEvent(new CustomEvent('aspect-registered', { detail: def.id })); }
export const aspectDef = (id) => REG.get(id);
export const aspectIds = () => ASPECTS.map((a) => a.id);
// every registered app that declares a key, in wheel order: aspectsWith('scan'), aspectsWith('widget')
export const aspectsWith = (key) => ASPECTS.map((a) => REG.get(a.id)).filter((d) => d && d[key]);

// what Home, Life and the agent show for an aspect. Falls back to the wheel's own line until the app answers.
export function summary(id) {
  const a = aspect(id); const d = REG.get(id);
  let s = {};
  try { s = d?.summary?.() ?? {}; } catch (e) { console.warn('[aspect] summary failed', id, e); }
  return { id, name: a.name, score: a.score, line: a.line, ...s };
}

// A large title for the top of a section: kicker (the aspect, in its colour), title, subline, an optional right slot
export const aspHead = (app, { title, sub = '', kicker = null, right = '' } = {}) => `
  <div class="phead asp-head">
    <div class="asp-head-l">
      <p class="kicker c-as">${kicker ?? esc(app.aspect.name)}</p>
      <h1 class="lt">${esc(title ?? app.aspect.name)}</h1>
      ${sub ? `<p class="sub">${sub}</p>` : ''}
    </div>
    ${right ? `<div class="asp-head-r">${right}</div>` : ''}
  </div>`;

// The aspect's glyph on a tile in its colour, for rows, cards and the wheel
export const aspectTile = (id, cls = '') => `<span class="tile asp-tile ${cls}" data-aspect="${id}" aria-hidden="true">${aspectIcon[id] ?? I.grid}</span>`;

// ── open an app ───────────────────────────────────────────────────────
export function openAspect(id, sub, { back = 'Life' } = {}) {
  const a = aspect(id);
  if (!a) return;
  const def = REG.get(id);
  if (!def) { toast(`${a.name} is still being built`); return; }
  const secs = def.sections ?? [];
  const start = secs.some((s) => s.id === sub) ? sub : (def.start ?? secs[0]?.id);
  const app = { id, def, aspect: a, page: null, scroll: null, section: null, pos: {} };
  app.el = (sid) => app.scroll && $(`.asp-sec[data-s="${sid}"]`, app.scroll);
  app.go = (sid) => show(app, sid);
  // keeps the scroll position: read it before clearing (an empty section drops scrollTop to 0), restore it after
  app.rebuild = () => { const y = app.scroll.scrollTop; secs.forEach((x) => { const el = app.el(x.id); if (el) { el.innerHTML = ''; delete el.dataset.built; } }); app.pos[app.section] = y; show(app, app.section, true); app.scroll.scrollTop = y; pulse(app.el(app.section)); };
  app.refresh = (sid = app.section) => { const el = app.el(sid); const s = secs.find((x) => x.id === sid); if (!el || !s) return; el.innerHTML = ''; s.render(el, app); wireSegs(el); pulse(el); };

  const page = push({
    title: a.name, back, aspect: id, cls: `asp asp-${id}`,
    right: `<button class="gbtn chrome icon asp-ask" data-act="as-ask" data-id="${id}" aria-label="Ask ${esc(AGENT.name)} about ${esc(a.name)}">${I.sparkle}</button>`,
    render(sc, pg) {
      app.page = pg; app.scroll = sc; pg._app = app;
      sc.innerHTML = secs.map((s) => `<div class="asp-sec" data-s="${s.id}" hidden></div>`).join('');
      if (secs.length > 1 || def.primary) {
        pg.insertAdjacentHTML('beforeend', `
          <div class="adock">
            ${secs.length > 1 ? `<nav class="atabbar chrome" style="--n:${secs.length}" aria-label="${esc(a.name)} sections">
              <span class="atab-lens" aria-hidden="true"></span>
              ${secs.map((s) => `<button class="atab" data-act="as-tab" data-s="${s.id}">${s.icon ?? I.grid}<span>${esc(s.label)}</span></button>`).join('')}
            </nav>` : '<span class="adock-gap"></span>'}
            ${def.primary ? `<button class="aact" data-act="as-primary" aria-label="${esc(def.primary.label)}">${def.primary.icon ?? I.plus}</button>` : ''}
          </div>`);
      }
      show(app, start, true);
      def.onOpen?.(app);
    },
  });
  return app;
}

function show(app, sid, first = false) {
  const secs = app.def.sections;
  const s = secs.find((x) => x.id === sid); if (!s) return;
  if (app.section && !first) app.pos[app.section] = app.scroll.scrollTop;
  $$('.asp-sec', app.scroll).forEach((el) => { el.hidden = el.dataset.s !== sid; });
  const el = app.el(sid);
  if (!el.dataset.built) {
    try { s.render(el, app); } catch (e) { console.error('[aspect] render failed', app.id, sid, e); el.innerHTML = `<p class="note pad">This section failed to render: ${esc(e.message)}</p>`; }
    el.dataset.built = '1'; wireSegs(el);
  }
  if (!first) { el.classList.remove('asp-in'); void el.offsetWidth; el.classList.add('asp-in'); }
  app.section = sid;
  app.scroll.scrollTop = app.pos[sid] ?? 0;
  $$('.atab', app.page).forEach((t) => t.classList.toggle('on', t.dataset.s === sid));
  const lens = $('.atab-lens', app.page);
  if (lens) {
    if (first) lens.style.transition = 'none';
    lens.style.transform = `translateX(${secs.findIndex((x) => x.id === sid) * 100}%)`;
    if (first) requestAnimationFrame(() => { lens.style.transition = ''; });
  }
  if (!first) pulse(el);
  app.def.onSection?.(app, sid);
}

on('as-tab', (el) => { const app = el.closest('.page')?._app; if (!app || app.section === el.dataset.s) return; haptic(5); app.go(el.dataset.s); });
on('as-primary', (el) => { const app = el.closest('.page')?._app; if (!app) return; haptic(8); app.def.primary.run(app); });
on('as-ask', (el) => api.askAgent('', { aspect: el.dataset.id }));
on('aspect-open', (el) => openAspect(el.dataset.id, el.dataset.s));
provide('openAspect', openAspect);
provide('summary', summary);

// A ring in the aspect's colour, outside its app (inside one, ring(p, 'as', …) reads the page's colour)
export const aspectRing = (id, p, size = 44, w = 6, o = {}) => ring(p, id, size, w, o);

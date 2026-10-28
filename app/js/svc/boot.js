// svc/boot: the engine's start, in order. main.js calls startEngine() before any area loads (so every area reads
// real data from its first line), then afterAreas() once they have registered.
//   1 the day: GET /bootstrap, else the offline copy, else sign in (svc/sync) · 2 the bindings in js/data.js
//   3 window.AOS (svc/aos) · 4 the sync pill · then: links (svc/route), the native bridge (svc/native), and after the
//   first paint the shipping app's Work code and module pages (app/work, app/modules).
import { toast, setHaptic } from '../core.js';
import { api as bus } from '../bus.js';
import * as API from './api.js';
import * as SYNC from './sync.js';
import * as store from './store.js';
import * as data from '../data.js';
import * as aos from './aos.js';
import * as native from './native.js';
import * as route from './route.js';

const G = globalThis;

export async function startEngine() {
  const demo = data.DEMO_MODE;
  store.setDemo(demo);
  setHaptic(native.haptic);
  SYNC.setToast((t) => toast(t));
  const r = await SYNC.start({ demo });
  data.hydrate();
  aos.install();
  pill();
  G.document.documentElement.dataset.source = data.SOURCE;
  if (data.USER) G.document.documentElement.dataset.role = data.USER.role;
  // for the console and the checks: __engine.state, __engine.data, __engine.flush() …
  G.window.__engine = { state: SYNC.state, data, api: API, sync: SYNC, store, route, native, aos, flush: () => SYNC.flush(), refresh: (f) => SYNC.refresh(f) };
  return r;
}

/** Links, the native bridge, then (in the background, after the first paint) app/work and app/modules. */
export function afterAreas() {
  // the promise exists before the first link is routed, so a boot link to a module page can wait for it
  let loaded = () => {};
  G.window.__engine.legacy = data.DEMO_MODE ? Promise.resolve() : new Promise((res) => { loaded = res; });
  route.start();
  native.start({ dataModule: data, route: (url, o) => route.go(url, o), bus });
  if (data.DEMO_MODE) return Promise.resolve();
  // the shipping app's Work and module pages load after the first paint; a broken one never blanks the app
  new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)))
    .then(() => aos.loadLegacy())
    .finally(() => { G.document.documentElement.dataset.legacy = 'loaded'; loaded(); });
  return Promise.resolve();
}

// ── the sync pill: says Offline only when it is true (cb42bc8), and when the PC failed to save ──
function pill() {
  const el = G.document.getElementById('syncPill');
  if (!el) return;
  const draw = () => {
    const c = API.connection();
    const { dirty } = SYNC.pending();
    let text = '', kind = '';
    if (data.DEMO_REMEMBERED) { text = 'Demo data. Nothing here syncs'; kind = 'demo'; }
    else if (data.SOURCE === 'real' && c.status === 'offline') { text = dirty ? 'Offline. Your changes are saved on this phone' : 'Offline. Showing what this phone has'; kind = 'offline'; }
    else if (data.SOURCE === 'real' && c.status === 'error') { text = 'Your PC hit an error saving. Retrying; changes are kept'; kind = 'error'; }
    el.hidden = !text;
    el.dataset.kind = kind;
    el.textContent = text;
  };
  API.onConnection(draw);
  SYNC.onChange(draw);
  el.addEventListener('click', () => { if (data.DEMO_REMEMBERED) bus.openMore(); else { API.probe(); SYNC.refresh(); } });
  draw();
}

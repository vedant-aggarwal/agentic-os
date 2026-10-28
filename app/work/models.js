// The model picker for Claude and Codex jobs and sessions: the job sheet, the + sheet's Job mode, New session, and a
// job's header. Choices come from the PC (GET /jobs/models: Claude Code's aliases, what the Codex login may use);
// "" = Default, the engine's own pick. The last pick is remembered per engine. The effort picker below works the same way.
const { AOS } = window;
const { esc } = AOS;

const KEY = (e) => `agentos-app:model-${e}`;
export const lastModel = (e) => { try { return localStorage.getItem(KEY(e)) ?? ''; } catch { return ''; } };
export const rememberModel = (e, m) => { try { if (m) localStorage.setItem(KEY(e), m); else localStorage.removeItem(KEY(e)); } catch { /* private mode */ } };

// Until the PC answers (or on an older server): Claude Code's aliases always resolve to the newest model of each family.
const FALLBACK = { claude: ['opus', 'sonnet', 'haiku'], codex: [] };
let list = null;
let loading = null;
/** Fetch the choices once per app run; `then` redraws whatever sheet is open. */
export function loadModels(then) {
  if (list) return;
  loading ??= AOS.api('/jobs/models').then((r) => { list = r.models ?? null; }).catch(() => {}).finally(() => { loading = null; });
  loading.then(() => { if (list) then?.(); });
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** claude-opus-5-5 → Opus 5.5, claude-haiku-4-5-20251001 → Haiku 4.5, claude-sonnet-5[1m] → Sonnet 5 (1M), opus → Opus (latest), gpt-6.1-sol → GPT-6.1-Sol. */
export function modelLabel(id) {
  if (!id) return 'Default';
  const m = id.match(/^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i);
  if (m) return `${cap(m[1])} ${m[2]}${m[3] ? `.${m[3]}` : ''}${m[4] ? ' (1M)' : ''}`;
  if (/^(opus|sonnet|haiku|fable)$/i.test(id)) return `${cap(id.toLowerCase())} (latest)`;
  return id.replace(/^gpt-/i, 'GPT-').replace(/-([a-z])/g, (_, c) => `-${c.toUpperCase()}`);
}
/** The engine's choices; a saved value missing from the list still shows. */
export function modelChoices(engine, value) { return choices(engine, value); }
function choices(engine, value) {
  const ids = (list?.[engine]?.length ? list[engine] : FALLBACK[engine]) ?? [];
  return value && !ids.includes(value) ? [value, ...ids] : ids;
}

/** A "Model" field of chips, Default first. `attr` names the data attribute the sheet listens for. */
export function modelFieldHTML(engine, value, attr) {
  const chip = (v, l) => `<button type="button" class="chip-btn${value === v ? ' on' : ''}" role="radio" aria-checked="${value === v}" ${attr}="${esc(v)}">${esc(l)}</button>`;
  // Chips stay short (Opus, not Opus (latest)) so the Claude row fits a phone's width.
  return `<div class="field"><span class="f-label">Model</span><div class="chips scroll" role="radiogroup" aria-label="Model">${chip('', 'Default')}${choices(engine, value).map((v) => chip(v, modelLabel(v).replace(' (latest)', ''))).join('')}</div></div>`;
}

// ---------- Effort: how hard the model thinks. "" = Default, the model's own level; the last pick is remembered per engine ----------
const EKEY = (e) => `agentos-app:effort-${e}`;
export const lastEffort = (e) => { try { return localStorage.getItem(EKEY(e)) ?? ''; } catch { return ''; } };
export const rememberEffort = (e, v) => { try { if (v) localStorage.setItem(EKEY(e), v); else localStorage.removeItem(EKEY(e)); } catch { /* private mode */ } };
const EFFORT_FALLBACK = { claude: ['low', 'medium', 'high', 'xhigh', 'max'], codex: ['low', 'medium', 'high', 'xhigh'] };
const EFFORT_LABEL = { minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra' };
export const effortLabel = (v) => (v ? EFFORT_LABEL[v] ?? cap(v) : 'Default');
export function effortChoices(engine, value) {
  const ids = list?.efforts?.[engine]?.length ? list.efforts[engine] : EFFORT_FALLBACK[engine] ?? [];
  return value && !ids.includes(value) ? [...ids, value] : ids;
}
/** An "Effort" field of chips, Default first, lowest to highest. */
export function effortFieldHTML(engine, value, attr) {
  const chip = (v) => `<button type="button" class="chip-btn${value === v ? ' on' : ''}" role="radio" aria-checked="${value === v}" ${attr}="${esc(v)}">${esc(effortLabel(v))}</button>`;
  return `<div class="field"><span class="f-label">Effort</span><div class="chips scroll" role="radiogroup" aria-label="Effort">${chip('')}${effortChoices(engine, value).map(chip).join('')}</div></div>`;
}

const CHEVRON ='<svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg>';
/** A pill showing the model; tapping it opens the phone's own picker (a transparent native select on top). */
export function modelPickHTML(engine, value, attr) {
  const opts = [['', 'Default model'], ...choices(engine, value).map((v) => [v, modelLabel(v)])];
  return `<label class="model-pick"><span>${esc(value ? modelLabel(value) : 'Default model')}</span>${CHEVRON}<select ${attr} aria-label="Model for the next turn">${opts.map(([v, l]) => `<option value="${esc(v)}"${value === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}
/** The same pill for the effort. */
export function effortPickHTML(engine, value, attr) {
  const opts = [['', 'Default effort'], ...effortChoices(engine, value).map((v) => [v, `${effortLabel(v)} effort`])];
  return `<label class="model-pick"><span>${esc(value ? `${effortLabel(value)} effort` : 'Default effort')}</span>${CHEVRON}<select ${attr} aria-label="Effort for the next turn">${opts.map(([v, l]) => `<option value="${esc(v)}"${value === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}

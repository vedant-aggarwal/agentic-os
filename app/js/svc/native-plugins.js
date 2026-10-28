// svc/native-plugins: one JS API for the 2.0.0 iOS layer (NATIVE's file; the Swift side is ios/App/App/*.swift).
// Contract and examples: v2/notes/native.md. Every method returns a Promise that never rejects and always carries
// { available, ok }: { available: true, ok: true, ...data } · { available: true, ok: false, error, cancelled? } ·
// { available: false, ok: false, reason: 'web' | 'ios' | 'device' | 'flag' | 'denied' | 'off' }.
// Times in and out are milliseconds (Date.now()); the widget snapshot keeps Unix seconds (its v1 contract).
//
//   import { native, normalizeSnapshot } from './svc/native-plugins.js';
//   await native.haptics.play('success');
//   const off = native.on('breath', (e) => orb.phase(e));  await native.haptics.breathe({ pattern: 'box', cycles: 4 });
//   const r = await native.scan.document({ ocr: true });  if (r.ok) file(r.pages);
//
// Web fallbacks: haptics (vibrate), breathing (a JS timer with the same "breath" events), photo (a file input),
// speak and voices (speechSynthesis), geo.here (browser geolocation). Everything else answers { available: false }.

const G = globalThis;
const cap = () => G.window?.Capacitor ?? null;
const isNative = () => !!cap()?.isNativePlatform?.();
const plugin = (name) => (isNative() ? cap()?.Plugins?.[name] ?? null : null);

const OFF = (reason = 'web', extra = {}) => ({ available: false, ok: false, reason, ...extra });

/** Calls a native plugin method; shapes whatever comes back into { available, ok, ... }. */
async function call(name, method, args = {}) {
  const P = plugin(name);
  if (!P || typeof P[method] !== 'function') return OFF(isNative() ? 'ios' : 'web');
  try {
    const r = (await P[method](args)) ?? {};
    return { available: r.available ?? true, ok: r.ok ?? true, ...r };
  } catch (e) {
    const code = e?.code ?? '';
    if (code === 'UNIMPLEMENTED' || code === 'UNAVAILABLE') return OFF('ios', { error: e?.message });
    return { available: true, ok: false, error: e?.message ?? String(e) };
  }
}

// ── events ────────────────────────────────────────────────────────────
// Native events arrive on the Native plugin: breath, voice, live, alarm, notify, geofence, screentime,
// notificationAction, callState. Web fallbacks (breathing) emit to the same subscribers.
const subs = new Map();
const hooked = new Set();
function emitLocal(event, data) {
  for (const fn of subs.get(event) ?? []) { try { fn(data); } catch (e) { console.warn('[native-plugins] listener', event, e); } }
}
function on(event, fn) {
  if (!subs.has(event)) subs.set(event, new Set());
  subs.get(event).add(fn);
  const P = plugin('Native');
  if (P?.addListener && !hooked.has(event)) {
    hooked.add(event);
    try { P.addListener(event, (data) => emitLocal(event, data)); } catch {}
  }
  return () => subs.get(event)?.delete(fn);
}

// ── haptics and the breathing programme ───────────────────────────────
const VIBRATE = {
  'breathe-in': [30, 40, 60], 'breathe-hold': [12, 90, 12], 'breathe-out': [60, 40, 30], 'breathe-rest': 10,
  'ring-close': [18, 30, 8], success: [10, 60, 12, 60, 18], warning: [14, 80, 14, 80, 14], error: [20, 60, 20, 60, 20],
  tick: 6, heartbeat: [16, 120, 10, 700, 16, 120, 10], light: 8, medium: 14, heavy: 22, selection: 4, done: [10, 60, 12, 60, 18],
};
function vibrate(name) {
  if (G.navigator?.userActivation && !G.navigator.userActivation.hasBeenActive) return false;
  try { return !!G.navigator?.vibrate?.(VIBRATE[name] ?? 8); } catch { return false; }
}

const PRESETS = {
  calm: [{ phase: 'in', s: 4 }, { phase: 'hold', s: 4 }, { phase: 'out', s: 6 }],
  box: [{ phase: 'in', s: 4 }, { phase: 'hold', s: 4 }, { phase: 'out', s: 4 }, { phase: 'rest', s: 4 }],
  '478': [{ phase: 'in', s: 4 }, { phase: 'hold', s: 7 }, { phase: 'out', s: 8 }],
};
const LABEL = { in: 'Breathe in', hold: 'Hold', out: 'Breathe out', rest: 'Hold' };
const HAPTIC = { in: 'breathe-in', hold: 'breathe-hold', out: 'breathe-out', rest: 'breathe-rest' };

// The web's breathing programme: phases at fixed offsets from the start, so it doesn't drift.
let webBreath = null;
function webBreathe({ pattern = 'calm', cycles = 4 } = {}) {
  webStopBreath('replaced');
  const phases = Array.isArray(pattern) ? pattern.filter((p) => LABEL[p?.phase] && p.s > 0) : (PRESETS[pattern] ?? PRESETS.calm);
  const n = Math.min(Math.max(Math.round(cycles) || 4, 1), 40);
  const plan = [];
  let t = 0;
  for (let c = 1; c <= n; c++) for (const p of phases) { plan.push({ ...p, cycle: c, at: t }); t += p.s * 1000; }
  const id = `web-${Date.now().toString(36)}`, started = Date.now(), endsAt = started + t;
  webBreath = { id, plan, step: 0, started, endsAt, cycles: n, pattern: Array.isArray(pattern) ? 'custom' : pattern, timer: 0 };
  const advance = () => {
    const b = webBreath;
    if (!b || b.id !== id) return;
    if (b.step >= b.plan.length) { vibrate('done'); webStopBreath('complete'); return; }
    const cur = b.plan[b.step++];
    const at = b.started + cur.at, end = at + cur.s * 1000;
    vibrate(HAPTIC[cur.phase]);
    emitLocal('breath', { id, phase: cur.phase, label: LABEL[cur.phase], s: cur.s, cycle: cur.cycle, cycles: b.cycles, at, phaseEndsAt: end, endsAt: b.endsAt });
    b.timer = G.setTimeout(advance, Math.max(16, end - Date.now()));
  };
  advance();
  return { available: true, ok: true, native: false, id, endsAt, cycles: n, seconds: t / 1000 };
}
function webStopBreath(reason = 'stopped') {
  const b = webBreath;
  if (!b) return { available: true, ok: true, running: false };
  G.clearTimeout(b.timer);
  webBreath = null;
  const done = b.plan[Math.max(0, b.step - 1)]?.cycle ?? 0;
  const out = { id: b.id, phase: 'done', reason, cycles: reason === 'complete' ? b.cycles : Math.max(0, done - 1), planned: b.cycles, seconds: Math.round((Date.now() - b.started) / 100) / 10 };
  emitLocal('breath', out);
  return { available: true, ok: true, native: false, ...out };
}

const haptics = {
  /** name: breathe-in breathe-hold breathe-out breathe-rest ring-close success warning error tick heartbeat light medium heavy selection done */
  async play(name = 'tick') {
    if (plugin('AosHaptics')) return call('AosHaptics', 'play', { name });
    return { available: !!G.navigator?.vibrate, ok: vibrate(name), native: false, engine: 'vibrate' };
  },
  /** { pattern: 'calm' | 'box' | '478' | [{ phase: 'in'|'hold'|'out'|'rest', s }], cycles = 4, voice = false, sound = true, activity = true, title } */
  async breathe(opts = {}) {
    if (plugin('AosHaptics')) return call('AosHaptics', 'breathe', opts);
    return webBreathe(opts);
  },
  async stop() {
    if (plugin('AosHaptics')) return call('AosHaptics', 'stop');
    return webStopBreath('stopped');
  },
  async state() {
    if (plugin('AosHaptics')) return call('AosHaptics', 'state');
    const b = webBreath;
    if (!b) return { available: true, ok: true, native: false, running: false };
    const cur = b.plan[Math.max(0, b.step - 1)];
    return { available: true, ok: true, native: false, running: true, id: b.id, phase: cur.phase, label: LABEL[cur.phase], cycle: cur.cycle, cycles: b.cycles, endsAt: b.endsAt };
  },
  presets: PRESETS,
};

// ── Face ID ───────────────────────────────────────────────────────────
const auth = {
  status: () => call('AosAuth', 'status'),
  /** { reason, passcode = true } → { ok, cancelled? } */
  authenticate: (opts = {}) => call('AosAuth', 'authenticate', opts),
};

// ── camera and scanning ───────────────────────────────────────────────
// The web's photo: a file input (the camera on phones that offer it), scaled down to JPEG base64 like the native one.
function webPhoto({ source = 'camera', maxSize = 1600, quality = 0.8 } = {}) {
  const doc = G.document;
  if (!doc) return Promise.resolve(OFF());
  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (source !== 'library') input.setAttribute('capture', 'environment');
    input.style.display = 'none';
    let settled = false;
    const done = (r) => { if (settled) return; settled = true; input.remove(); resolve(r); };
    input.addEventListener('cancel', () => done({ available: true, ok: false, cancelled: true, native: false, error: 'Nothing picked.' }));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return done({ available: true, ok: false, cancelled: true, native: false, error: 'Nothing picked.' });
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight, 1));
        const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        const canvas = doc.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const image = dataUrl.slice(dataUrl.indexOf(',') + 1);
        done({ available: true, ok: true, native: false, image, width: w, height: h, bytes: Math.round(image.length * 0.75), mime: 'image/jpeg' });
      };
      img.onerror = () => { URL.revokeObjectURL(url); done({ available: true, ok: false, native: false, error: "That image couldn't be read." }); };
      img.src = url;
    });
    doc.body.appendChild(input);
    input.click();
  });
}

const scan = {
  status: () => call('AosScan', 'status'),
  /** { source: 'camera' | 'library', maxSize = 1600, quality = 0.8, ocr = false, barcodes = false, classify = false } → { image, width, height, text?, lines?, barcodes?, classify? } */
  async photo(opts = {}) {
    if (plugin('AosScan')) return call('AosScan', 'photo', opts);
    return webPhoto(opts);
  },
  /** { ocr = true, maxSize = 2000, quality = 0.8 } → { pages: [{ image, width, height, text, lines }], text, count } */
  document: (opts = {}) => call('AosScan', 'document', opts),
  /** { image: base64, barcodes? } → { text, lines: [{ text, confidence, box: { x, y, w, h } }] } */
  text: (opts = {}) => call('AosScan', 'text', opts),
  /** the live scanner → { value, type } (ISBN is 'ean13') */
  barcode: (opts = {}) => call('AosScan', 'barcode', opts),
  /** { image } → { guess: receipt|document|book|food|face|screenshot|photo, labels: [{ id, confidence }], faces, text, textLines, barcodes } (offline) */
  classify: (opts = {}) => call('AosScan', 'classify', opts),
};

// ── widgets and the snapshot ──────────────────────────────────────────
const widgets = {
  reload: () => call('AosSystem', 'reloadWidgets'),
};

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : null);
const int = (v, min = 0) => { const n = num(v); return n == null ? null : Math.max(min, Math.round(n)); };
const str = (v, max = 140) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, max) || null);
const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : null);
const bool = (v) => (v == null ? undefined : !!v);
const clamp = (v, lo, hi) => { const n = num(v); return n == null ? null : Math.min(hi, Math.max(lo, n)); };
/** Unix seconds from seconds, milliseconds or an ISO string. */
const secs = (v) => {
  if (typeof v === 'string' && !Number.isFinite(+v)) { const t = Date.parse(v); return Number.isFinite(t) ? Math.round(t / 1000) : null; }
  const n = num(v);
  return n == null ? null : n > 1e11 ? Math.round(n / 1000) : n;
};
const compact = (o) => { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k]; return o; };

/**
 * The snapshot exactly as Shared.swift decodes it (v2/notes/native.md section 1): types fixed, numbers clamped,
 * bad rows dropped, Clean always private, and kept under ~16 KB.
 */
export function normalizeSnapshot(s = {}) {
  const out = {
    v: 2,
    at: secs(s.at) ?? Math.round(Date.now() / 1000),
    name: str(s.name, 40),
    skin: s.skin === 'matte' || s.skin === 'obsidian' ? s.skin : undefined,
    blocks: (Array.isArray(s.blocks) ? s.blocks : []).map((b) => {
      const startAt = secs(b?.startAt), endAt = secs(b?.endAt);
      if (startAt == null || endAt == null || endAt <= startAt) return null;
      return { title: str(b.title, 80) ?? 'Busy', area: str(b.area, 40) ?? '', color: hex(b.color) ?? '#8E8E93',
        kind: ['event', 'task', 'sleep'].includes(b.kind) ? b.kind : 'event', startAt, endAt };
    }).filter(Boolean).slice(0, 100),
    done: int(s.done) ?? 0,
    total: int(s.total) ?? 0,
    up: (Array.isArray(s.up) ? s.up : []).map((t) => str(t, 120)).filter(Boolean).slice(0, 5),
    wyn: str(s.wyn, 160),
    wynName: str(s.wynName, 40),
  };
  if (Array.isArray(s.life)) {
    out.life = s.life.map((a) => {
      const score = clamp(a?.score, 0, 10);
      if (!a?.id || score == null) return null;
      return compact({ id: String(a.id), name: str(a.name, 24) ?? String(a.id), score: Math.round(score * 10) / 10,
        p: clamp(a.p, 0, 1) ?? undefined, color: hex(a.color) ?? undefined, delta: num(a.delta) ?? undefined });
    }).filter(Boolean).slice(0, 12);
  }
  if (s.money && num(s.money.left) != null && num(s.money.budget) != null) {
    const m = s.money;
    out.money = compact({ left: Math.round(num(m.left)), budget: Math.round(num(m.budget)), spent: num(m.spent) ?? undefined,
      currency: str(m.currency, 4) ?? undefined, monthLeft: num(m.monthLeft) ?? undefined, monthBudget: num(m.monthBudget) ?? undefined });
  }
  if (Array.isArray(s.streaks)) {
    out.streaks = s.streaks.map((x) => {
      if (!x?.id) return null;
      const id = String(x.id);
      return compact({ id, label: str(x.label, 32) ?? id, n: int(x.n) ?? 0, today: bool(x.today), atRisk: bool(x.atRisk),
        due: secs(x.due) ?? undefined, aspect: str(x.aspect, 16) ?? undefined,
        // Clean never shows where someone else could see it, whatever the area sent.
        private: /clean/i.test(id) ? true : bool(x.private) });
    }).filter(Boolean).slice(0, 6);
  }
  if (s.agent && typeof s.agent === 'object') {
    const a = s.agent, k = a.ask;
    out.agent = compact({ name: str(a.name, 24) ?? undefined, product: str(a.product, 24) ?? undefined, mood: str(a.mood, 24) ?? undefined,
      stress: clamp(a.stress, 0, 1) ?? undefined, energy: clamp(a.energy, 0, 1) ?? undefined, valence: clamp(a.valence, -1, 1) ?? undefined,
      last: str(a.last, 200) ?? undefined,
      ask: k && k.id && k.title ? compact({ id: String(k.id), title: str(k.title, 140), yes: str(k.yes, 18) ?? undefined, no: str(k.no, 18) ?? undefined }) : undefined });
  }
  if (s.jobs && typeof s.jobs === 'object') {
    const j = s.jobs;
    out.jobs = compact({ needs: int(j.needs) ?? 0, working: int(j.working) ?? 0, done: int(j.done) ?? undefined,
      items: (Array.isArray(j.items) ? j.items : []).map((x) => (x?.id && x?.title ? compact({
        id: String(x.id), title: str(x.title, 80), state: ['working', 'needs', 'done'].includes(x.state) ? x.state : 'working',
        url: typeof x.url === 'string' && x.url.startsWith('agenticos://') ? x.url : undefined, engine: str(x.engine, 12) ?? undefined,
        detail: str(x.detail, 80) ?? undefined, since: secs(x.since) ?? undefined }) : null)).filter(Boolean).slice(0, 3) });
  }
  if (s.routes && typeof s.routes === 'object') {
    const r = {};
    for (const k of ['expense', 'meal', 'journal', 'habit', 'workout']) if (typeof s.routes[k] === 'string' && s.routes[k].startsWith('/')) r[k] = s.routes[k];
    if (Object.keys(r).length) out.routes = r;
  }
  compact(out);
  out.blocks ??= [];
  out.up ??= [];
  // The keychain item stays small: trim the agenda first, then the extras.
  for (const cut of [() => { out.blocks = out.blocks.slice(0, 40); }, () => { out.blocks = out.blocks.slice(0, 16); }, () => { delete out.routes; }, () => { if (out.jobs) out.jobs.items = []; }]) {
    if (JSON.stringify(out).length <= 16000) break;
    cut();
  }
  return out;
}

// ── Live Activities ───────────────────────────────────────────────────
const live = {
  /** { kind: 'workout', title, exercise, set, sets, reps?, weight?, unit?, next?, phase: 'work'|'rest', restSeconds? } ·
   *  { kind: 'focus', title, minutes } · { kind: 'breathing', title, pattern } → { id } */
  start: (opts = {}) => call('AosLive', 'start', opts),
  /** { id | kind, ...state } (focus: minutes | endsAt | paused | label) */
  update: (opts = {}) => call('AosLive', 'update', opts),
  end: (opts = {}) => call('AosLive', 'end', opts),
  list: () => call('AosLive', 'list'),
};

// ── alarms (AlarmKit on iOS 26, else time-sensitive notifications) ────
const alarm = {
  authorize: () => call('AosAlarm', 'authorize'),
  /** { id?, at (ms | ISO), title, body?, snoozeMinutes = 9, url?, weekdays?: [1 = Mon ... 7 = Sun] } → { id, kit } */
  schedule: (opts = {}) => call('AosAlarm', 'schedule', opts),
  cancel: (opts = {}) => call('AosAlarm', 'cancel', opts),
  list: () => call('AosAlarm', 'list'),
};

// ── local notifications with buttons ──────────────────────────────────
const notify = {
  authorize: () => call('AosNotify', 'authorize'),
  /** { id?, at? | in? (s), title, body, subtitle?, category: 'task'|'nudge'|'streak'|'plain', timeSensitive?, thread?, url?, data?,
   *  actions?: { do|later|snooze|done: { path, method?, body? } | { url } }, snoozeMinutes? } → { id } */
  schedule: (opts = {}) => call('AosNotify', 'schedule', opts),
  cancel: (opts = {}) => call('AosNotify', 'cancel', opts),
  list: () => call('AosNotify', 'list'),
  badge: (n = 0) => call('AosNotify', 'badge', { n }),
};

// ── voice: the free call loop, speech, voices ─────────────────────────
function webVoices() {
  const list = G.speechSynthesis?.getVoices?.() ?? [];
  return list.filter((v) => /^(en|hi)/i.test(v.lang)).map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, quality: 'default', gender: 'unspecified' }));
}
const voice = {
  /** In the app: { reason?, incomingId?, locale = 'en-IN', voice? }. Events: 'voice' { state, level?, heard?, said?, callId, error? } */
  start: (opts = {}) => call('AosVoice', 'start', opts),
  stop: () => call('AosVoice', 'stop'),
  mute: (muted = true) => call('AosVoice', 'mute', { muted }),
  /** The iPhone's own call screen (CallKit). */
  call: (opts = {}) => call('AosVoice', 'call', opts),
  /** Mic and speech recognition, asked once. */
  permissions: () => call('AosVoice', 'permissions'),
  /** { text, voice?, rate? (0-1) } */
  async speak({ text, voice: v, rate } = {}) {
    if (plugin('AosVoice')) return call('AosVoice', 'speak', { text, voice: v, rate });
    const S = G.speechSynthesis;
    if (!S || !text) return OFF();
    const u = new G.SpeechSynthesisUtterance(text);
    const pick = webVoices().find((x) => x.id === v) ?? webVoices().find((x) => /en-IN/i.test(x.lang));
    if (pick) u.voice = S.getVoices().find((x) => x.voiceURI === pick.id) ?? null;
    if (rate) u.rate = Math.min(2, Math.max(0.5, rate * 2));
    S.speak(u);
    return { available: true, ok: true, native: false };
  },
  async voices() {
    if (plugin('AosVoice')) return call('AosVoice', 'voices');
    return { available: !!G.speechSynthesis, ok: true, native: false, voices: webVoices() };
  },
  /** { free, realtime }: which call path the PC offers. */
  mode: () => call('AosVoice', 'mode'),
};

// ── dictation (the Speech plugin: on-device speech to text for the Ask bar) ──
const speech = {
  /** { locale = 'en-IN' }; partial text arrives through onPartial until stop() */
  start: (opts = {}) => call('Speech', 'start', { locale: 'en-IN', ...opts }),
  /** → { text } */
  stop: () => call('Speech', 'stop'),
  /** fn({ text, final }); returns an unsubscribe function */
  onPartial(fn) {
    const P = plugin('Speech');
    if (!P?.addListener) return () => {};
    let handle = null, dead = false;
    Promise.resolve(P.addListener('partial', (e) => { if (!dead) fn(e); })).then((h) => { handle = h; if (dead) handle?.remove?.(); }).catch(() => {});
    return () => { dead = true; handle?.remove?.(); };
  },
};

// ── Health ────────────────────────────────────────────────────────────
const health = {
  status: () => call('AosHealth', 'status'),
  /** { types?: ['steps','sleep','workouts','activeEnergy','restingHR','hrv','weight'] } */
  authorize: (opts = {}) => call('AosHealth', 'authorize', opts),
  /** { types, from, to, bucket: 'day' | 'hour' } → { data: { steps: [{ start, end, value }], sleep: [{ start, end, stage }], ... }, units } */
  query: (opts = {}) => call('AosHealth', 'query', opts),
};

// ── Screen Time (built, ships off: { available: false, reason: 'flag' } until the build turns it on) ──
const screenTime = {
  status: () => call('AosScreenTime', 'status'),
  authorize: () => call('AosScreenTime', 'authorize'),
  pick: () => call('AosScreenTime', 'pick'),
  /** { minutes? | until?, line? } */
  block: (opts = {}) => call('AosScreenTime', 'block', opts),
  /** { minutes? }: unpause now, pause again after minutes (15 at least) */
  unblock: (opts = {}) => call('AosScreenTime', 'unblock', opts),
  /** { windows: [{ id, start: 'HH:MM', end: 'HH:MM', days?: [1-7] }], line? } */
  schedule: (opts = {}) => call('AosScreenTime', 'schedule', opts),
  setLine: (line) => call('AosScreenTime', 'setLine', { line }),
};

// ── Spotlight ─────────────────────────────────────────────────────────
const spotlight = {
  /** [{ id, kind: 'person'|'goal'|'note'|'project'|'task', title, subtitle?, keywords?, url? }]; a tap opens url (default agenticos://<kind>/<id>) */
  index: (items = []) => call('AosSystem', 'spotlightIndex', { items }),
  remove: ({ ids = [], kind } = {}) => call('AosSystem', 'spotlightRemove', { ids, kind }),
  clear: ({ kind } = {}) => call('AosSystem', 'spotlightClear', kind ? { kind } : {}),
};

// ── the on-device model (iOS 26, Apple Intelligence phones) ───────────
const llm = {
  status: () => call('AosLLM', 'status'),
  /** { prompt, instructions?, schema? (JSON schema: object, array, string/enum, number, integer, boolean), temperature?, maxTokens? } → { text } | { json, text } */
  respond: (opts = {}) => call('AosLLM', 'respond', opts),
};

// ── calendars, contacts, places ───────────────────────────────────────
const calendar = {
  authorize: (opts = {}) => call('AosPersonal', 'calendarAuthorize', opts),
  /** { from, to } → { events: [{ id, title, start, end, allDay, calendar, color?, location? }] } */
  events: (opts = {}) => call('AosPersonal', 'events', opts),
  /** { done? } → { reminders: [{ id, title, done, list, priority, due?, notes? }] } */
  reminders: (opts = {}) => call('AosPersonal', 'reminders', opts),
};
const contacts = {
  /** → { contact: { id, name, given, family, nickname?, org?, phones, emails, birthday?: { day, month, year? }, image? } } */
  pick: () => call('AosPersonal', 'pickContact'),
};
const geo = {
  authorize: () => call('AosPersonal', 'geoAuthorize'),
  /** { id, lat, lng, radius = 150, title, onEnter?: { notify?: { title, body }, url?, post?: { path, body } }, onExit? } */
  add: (opts = {}) => call('AosPersonal', 'geoAdd', opts),
  remove: (opts = {}) => call('AosPersonal', 'geoRemove', opts),
  list: () => call('AosPersonal', 'geoList'),
  async here() {
    if (plugin('AosPersonal')) return call('AosPersonal', 'geoHere');
    const g = G.navigator?.geolocation;
    if (!g) return OFF();
    return new Promise((resolve) => g.getCurrentPosition(
      (p) => resolve({ available: true, ok: true, native: false, lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp }),
      (e) => resolve({ available: true, ok: false, native: false, error: e?.message ?? 'No location.', cancelled: e?.code === 1 }),
      { timeout: 15000, maximumAge: 60000 }));
  },
};

// ── the app icon ──────────────────────────────────────────────────────
const icon = {
  get: () => call('AosSystem', 'iconGet'),
  /** 'obsidian' | 'matte' | null, or { name } (null is the default icon) */
  set: (arg = null) => {
    const name = arg && typeof arg === 'object' ? arg.name ?? null : arg;
    return call('AosSystem', 'iconSet', name ? { name } : {});
  },
};

// ── what this phone can do ────────────────────────────────────────────
async function caps() {
  if (plugin('AosSystem')) return call('AosSystem', 'caps');
  return { available: false, ok: true, reason: isNative() ? 'ios' : 'web', native: false,
    haptics: !!G.navigator?.vibrate, camera: !!G.document, speech: !!G.speechSynthesis, geolocation: !!G.navigator?.geolocation };
}

// ── on the phone: does this binary have every plugin and method the JS expects? ──
const EXPECTED = {
  AosHaptics: ['play', 'breathe', 'stop', 'state'], AosAuth: ['status', 'authenticate'],
  AosScan: ['photo', 'document', 'text', 'barcode', 'classify', 'status'], AosLive: ['start', 'update', 'end', 'list'],
  AosAlarm: ['authorize', 'schedule', 'cancel', 'list'], AosNotify: ['authorize', 'schedule', 'cancel', 'list', 'badge'],
  AosVoice: ['start', 'stop', 'mute', 'call', 'speak', 'voices', 'mode', 'permissions'], AosHealth: ['status', 'authorize', 'query'],
  AosSystem: ['caps', 'reloadWidgets', 'spotlightIndex', 'spotlightRemove', 'spotlightClear', 'iconGet', 'iconSet'],
  AosPersonal: ['calendarAuthorize', 'events', 'reminders', 'pickContact', 'geoAuthorize', 'geoAdd', 'geoRemove', 'geoList', 'geoHere'],
  AosLLM: ['status', 'respond'], AosScreenTime: ['status', 'authorize', 'pick', 'block', 'unblock', 'schedule', 'setLine'],
  Native: ['share', 'registerPush', 'call', 'requestPhotos', 'keyboardStatus', 'openSettings', 'exportFile'], Speech: ['start', 'stop'],
};
/** From the Safari Web Inspector on the phone: `await (await import('./js/svc/native-plugins.js')).native.selfTest()`. */
async function selfTest() {
  const headers = cap()?.PluginHeaders ?? [];
  const have = Object.fromEntries(headers.map((h) => [h.name, (h.methods ?? []).map((m) => m.name)]));
  const plugins = {};
  for (const [name, methods] of Object.entries(EXPECTED)) {
    const got = have[name];
    plugins[name] = got ? { ok: methods.every((m) => got.includes(m)), missing: methods.filter((m) => !got.includes(m)) } : { ok: false, missing: 'the whole plugin' };
  }
  return { native: isNative(), allOk: Object.values(plugins).every((p) => p.ok), plugins, caps: await caps() };
}

export const native = {
  get available() { return isNative() && !!plugin('AosSystem'); },
  get platform() { return isNative() ? 'ios' : 'web'; },
  caps, on, selfTest,
  haptics, auth, scan, widgets, live, alarm, notify, voice, speech, health, screenTime, spotlight, llm, calendar, contacts, geo, icon,
};

export default native;

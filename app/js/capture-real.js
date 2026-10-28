// The lens's real engine (v2): the camera, on-device reading (NATIVE's Vision OCR, barcode and first guess, Foundation
// Models), the PC's classifier (POST /api/v1/mod/scan/classify, Codex on his subscription), an offline queue for scans
// taken without the PC, the scan history (svc/store collection scan/items), say-it-once, the Codex login state, and
// filing a result into the app that owns it (with its undo).
// Owner: CAPTURE. Read by capture.js, capture-share.js. Demo mode never loads this path (capture.js keeps the scenes).
import * as API from './svc/api.js';
import { collection } from './svc/store.js';
import { native } from './svc/native-plugins.js';
import * as clock from './svc/clock.js';

const G = globalThis;
export const KINDS = ['receipt', 'statement', 'food', 'face', 'book', 'page', 'goals', 'chat', 'card', 'document', 'reel', 'link'];
export const KIND_LABEL = { receipt: 'Receipt', statement: 'Bank statement', food: 'Food', face: 'Face', book: 'Book', page: 'Handwritten page', goals: 'Goal list', chat: 'Chat', card: 'Card', document: 'Document', reel: 'Reel', link: 'Link' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (p, ms, d = null) => Promise.race([Promise.resolve(p).catch(() => d), sleep(ms).then(() => d)]);

// ── the scan history on the PC (filed, waiting, undone), offline-first ──
let col = null;
export function scans() {
  col ??= collection('scan/items', { endpoint: '/api/v1/mod/scan/items', prefix: 'scan' });
  return col;
}
/** A write that wins over the PC's copy even when this phone's clock runs behind it. */
const bump = (iso) => new Date(Math.max(Date.now(), (Date.parse(iso ?? '') || 0) + 1)).toISOString();
export function saveItem(item, patch) {
  const cur = scans().get(item.id) ?? item;
  const doc = { ...cur, ...patch, id: item.id, updated_at: bump(cur.updated_at) };
  try { return scans().put(doc, { touch: false }); } catch (e) { console.warn('[capture] scan history', e); return doc; }
}

// ── events: every change to a scan in flight (reading → ready | offline | failed) ──
const subs = new Set();
export const onScan = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const emit = (q) => { for (const fn of subs) { try { fn(q); } catch (e) { console.warn('[capture] listener', e); } } };

// ── the camera: a live viewfinder in the lens (getUserMedia); the native camera when that isn't allowed ──
export const camera = {
  stream: null, video: null, facing: 'environment', state: 'off', torchOn: false,
  async start(video) {
    this.video = video;
    if (this.stream && video.srcObject === this.stream) { this.state = 'on'; return { ok: true }; }
    if (!G.navigator?.mediaDevices?.getUserMedia) { this.state = 'none'; return { ok: false, reason: 'none' }; }
    try {
      this.state = 'starting';
      this.stream = await G.navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: this.facing }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
      if (this.video !== video || !video.isConnected) { this.stop(); return { ok: false, reason: 'gone' }; }
      video.srcObject = this.stream;
      video.muted = true; video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
      await video.play().catch(() => {});
      this.state = 'on';
      return { ok: true };
    } catch (e) {
      this.state = e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'denied' : 'none';
      return { ok: false, reason: this.state, error: e?.message };
    }
  },
  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.video) this.video.srcObject = null;
    this.stream = null; this.state = 'off'; this.torchOn = false;
  },
  async flip() {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    const v = this.video; this.stop();
    return v ? this.start(v) : { ok: false };
  },
  canTorch() { const t = this.stream?.getVideoTracks?.()[0]; return !!t?.getCapabilities?.()?.torch; },
  async torch(on) {
    const t = this.stream?.getVideoTracks?.()[0];
    if (!t?.getCapabilities?.()?.torch) return false;
    try { await t.applyConstraints({ advanced: [{ torch: !!on }] }); this.torchOn = !!on; return true; } catch { return false; }
  },
  /** The current frame as JPEG: { image (base64), width, height, thumb (a small data URL for the tray) } */
  frame(maxSize = 1600, quality = 0.82) {
    const v = this.video;
    if (!v?.videoWidth) return null;
    const s = Math.min(1, maxSize / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * s), h = Math.round(v.videoHeight * s);
    const c = G.document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (this.facing === 'user') { g.translate(w, 0); g.scale(-1, 1); }
    g.drawImage(v, 0, 0, w, h);
    const url = c.toDataURL('image/jpeg', quality);
    return { image: url.slice(url.indexOf(',') + 1), width: w, height: h, thumb: thumbOf(c), mime: 'image/jpeg' };
  },
};
function thumbOf(src, size = 180) {
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  const s = Math.min(1, size / Math.max(w0, h0, 1));
  const c = G.document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * s)); c.height = Math.max(1, Math.round(h0 * s));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
}
/** A thumbnail for a base64 JPEG from the native camera or a picked file. */
export function thumbFrom(base64, mime = 'image/jpeg') {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(thumbOf(img));
    img.onerror = () => resolve(null);
    img.src = `data:${mime};base64,${base64}`;
  });
}
/** Files the person picked (photos, screenshots) → [{ image, mime, thumb, name }] scaled like the camera. */
export function pickFiles({ multiple = true, accept = 'image/*' } = {}) {
  return new Promise((resolve) => {
    const input = G.document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple; input.style.display = 'none';
    let done = false;
    const finish = (v) => { if (done) return; done = true; input.remove(); resolve(v); };
    input.addEventListener('cancel', () => finish([]));
    input.addEventListener('change', async () => {
      const out = [];
      for (const f of [...(input.files ?? [])].slice(0, 12)) {
        const r = await scaleFile(f).catch(() => null);
        if (r) out.push({ ...r, name: f.name });
      }
      finish(out);
    });
    G.document.body.appendChild(input);
    input.click();
  });
}
function scaleFile(file, maxSize = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight, 1));
      const c = G.document.createElement('canvas'); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      const d = c.toDataURL('image/jpeg', 0.82);
      resolve({ image: d.slice(d.indexOf(',') + 1), mime: 'image/jpeg', width: c.width, height: c.height, thumb: thumbOf(c) });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}

// ── what the phone can do on its own (iPhone 2.0.0): OCR, barcodes, a first guess, Foundation Models ──
let capsP = null;
export const caps = () => (capsP ??= within(native.caps(), 2500, { available: false }).then((c) => c ?? { available: false }));
async function onDevice(image) {
  if (!native.available) return {};
  const [txt, cls] = await Promise.all([within(native.scan.text({ image, barcodes: true }), 1800), within(native.scan.classify({ image }), 1800)]);
  const out = { ocr: txt?.ok ? txt.text ?? '' : cls?.ok ? cls.text ?? '' : '', barcodes: (txt?.ok ? txt.barcodes : cls?.barcodes) ?? [], guess: cls?.ok ? cls.guess : null };
  // Foundation Models (Apple Intelligence phones) turns the OCR text into one of our kinds, offline
  if (out.ocr && out.ocr.length > 12) {
    const st = await within(native.llm.status(), 600);
    if (st?.available) {
      const r = await within(native.llm.respond({ prompt: `Text read from a photo:\n${out.ocr.slice(0, 1500)}\n\nVision labels: ${(cls?.labels ?? []).slice(0, 5).map((l) => l.id ?? l).join(', ')}. Which one kind is it?`,
        instructions: `Pick one of: ${KINDS.join(', ')}. A receipt has a total; a chat screenshot has messages and times; a page is handwriting; a card is a person's contact.`,
        schema: { type: 'string', enum: KINDS }, temperature: 0 }), 1600);
      const g = r?.json ?? r?.text;
      if (typeof g === 'string' && KINDS.includes(g.trim())) out.guess = g.trim();
    }
  }
  return out;
}

// ── the offline queue: a scan taken without the PC waits on the phone (IndexedDB) and is read when it's back ──
let dbp = null;
function db() {
  dbp ??= new Promise((resolve) => {
    if (!G.indexedDB) { resolve(null); return; }
    const r = G.indexedDB.open('aos-scan', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('pending')) r.result.createObjectStore('pending', { keyPath: 'id' }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => resolve(null);
  });
  return dbp;
}
const idb = async (mode, fn) => { const d = await db(); if (!d) return null; return new Promise((resolve) => { const t = d.transaction('pending', mode); const r = fn(t.objectStore('pending')); t.oncomplete = () => resolve(r?.result ?? null); t.onerror = () => resolve(null); }); };
const queued = () => idb('readonly', (s) => s.getAll()).then((v) => v ?? []);

/** Scans in this session and from the queue: id → { id, thumb, state, guess, item, error, at } */
export const live = new Map();
const isOffline = (e) => !e?.status || e.status >= 500 || e.status === 404 || e.status === 408;

/** One capture → the PC. Returns the live entry at once; its state moves through onScan. */
export function shoot({ image, images = null, mime = 'image/jpeg', thumb = null, source = 'camera', hint = null, ocr = null, barcodes = null, guess = null, text = null, url = null, note = null }) {
  const id = API.clientId('scan');
  const q = { id, thumb, state: 'reading', guess, item: null, error: null, at: Date.now(), source };
  live.set(id, q);
  emit(q);
  (async () => {
    const dev = image && !ocr ? await onDevice(image) : {};
    q.guess = guess ?? dev.guess ?? null;
    if (q.guess) emit(q);
    const body = { id, image, images, mime, ocr: ocr ?? dev.ocr ?? null, barcodes: barcodes ?? dev.barcodes ?? [], guess: q.guess, hint, source, text, url, note };
    await send(q, body);
  })();
  return q;
}
async function send(q, body) {
  try {
    const r = await API.post('/mod/scan/classify', body, { timeout: 175000 });
    q.item = r.item; q.state = r.item?.status === 'failed' ? 'failed' : 'ready'; q.error = r.item?.error ?? null;
    if (r.item?.retry && r.item.status !== 'failed') q.weak = true;
    idb('readwrite', (s) => s.delete(q.id));
    scans().refresh?.();
  } catch (e) {
    if (isOffline(e)) {
      q.state = 'offline';
      await idb('readwrite', (s) => s.put({ id: q.id, body, thumb: q.thumb, guess: q.guess, at: q.at }));
    } else { q.state = 'failed'; q.error = e?.message ?? String(e); }
  }
  emit(q);
}
let flushing = false;
/** Sends what waited offline. Called on open, online, focus and every 30 s while visible. */
export async function flushQueue() {
  if (flushing || API.connection().status === 'offline') return 0;
  flushing = true;
  let n = 0;
  try {
    for (const p of await queued()) {
      const q = live.get(p.id) ?? { id: p.id, thumb: p.thumb, state: 'reading', guess: p.guess, item: null, error: null, at: p.at, source: p.body?.source, queued: true };
      live.set(p.id, q); q.state = 'reading'; emit(q);
      await send(q, p.body);
      if (q.state === 'offline') break;
      n++;
    }
  } finally { flushing = false; }
  return n;
}
export const waitingOnPhone = () => queued().then((v) => v.length);
if (G.addEventListener) {
  G.addEventListener('online', () => flushQueue());
  G.document?.addEventListener('visibilitychange', () => { if (G.document.visibilityState === 'visible') flushQueue(); });
  setInterval(() => { if (G.document?.visibilityState === 'visible') flushQueue(); }, 30000);
}

// ── Codex on the PC: is its login good (transcription and scans both use it)? ──
let statusAt = 0, statusV = null;
export async function status(force = false) {
  if (!force && statusV && Date.now() - statusAt < 60000) return statusV;
  try { statusV = await API.get('/mod/scan/status', { timeout: 6000 }); statusAt = Date.now(); } catch { /* keep the last one */ }
  return statusV;
}
export const loginProblem = (s) => (s?.transcription?.login && s.transcription.login !== 'ok' ? (s.transcription.login === 'expired' ? 'expired' : 'missing') : null);

// ── say it once: a voice note or a sentence → one entry per app ──
export const plan = (text) => API.post('/mod/scan/say', { text }, { timeout: 150000 });
export const applyPlan = (id, text, items) => API.post('/mod/scan/say/apply', { id, text, items }, { timeout: 60000 });
export const undoItem = (id, n) => API.post(`/mod/scan/items/${encodeURIComponent(id)}/undo`, n == null ? {} : { n }, { timeout: 30000 });

// ── the real voice recorder (app/work/recorder.js: IndexedDB chunks, upload while recording, the PC transcribes) ──
let recP = null;
export function recorder() {
  recP ??= (async () => {
    // it needs window.AOS (the host svc/aos.js installs at boot)
    for (let i = 0; i < 40 && !G.window?.AOS?.api; i++) await sleep(100);
    return import('../work/recorder.js');
  })();
  return recP;
}
/** The PC's record of a recording (after a failure: its error and errorCode, e.g. login_expired). */
export const recording = (id) => API.get(`/voice/${encodeURIComponent(id)}`, { timeout: 8000 }).then((r) => r.recording).catch(() => null);
export const recordings = () => API.get('/voice', { timeout: 8000 }).then((r) => r.recordings ?? []).catch(() => []);

export const nowLabel = () => clock.hm(clock.nowMin());

// One voice recorder for the whole app: the + sheet, job context, the job composer and Settings all use it.
// MediaRecorder with a 2 s timeslice; every chunk goes to IndexedDB first and is PUT to the PC right away, so a crash,
// a closed app or no signal loses nothing. Finish → the PC transcribes (OpenAI) → the text is appended at the caret.
// Server: POST /voice, PUT /voice/:id/chunk/:n, POST /voice/:id/finish { async: true } → "transcribing" at once, then
// GET /voice/:id?wait=25 until the words are written down (CONTRACT.md 4.3).
const { AOS } = window;
const esc = AOS.esc;

// ---------- IndexedDB: recordings waiting to upload, and their chunks ----------
const DB_NAME = 'aos-voice';
let dbp = null;
function db() {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('recs')) d.createObjectStore('recs', { keyPath: 'local' });
      if (!d.objectStoreNames.contains('chunks')) d.createObjectStore('chunks', { keyPath: ['local', 'n'] });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function store(name, mode = 'readonly') { return (await db()).transaction(name, mode).objectStore(name); }
const idb = {
  put: async (name, v) => req((await store(name, 'readwrite')).put(v)),
  get: async (name, k) => req((await store(name)).get(k)),
  del: async (name, k) => req((await store(name, 'readwrite')).delete(k)),
  all: async (name) => req((await store(name)).getAll()),
  chunksOf: async (local) => req((await store('chunks')).getAll(IDBKeyRange.bound([local, 0], [local, Infinity]))),
};

// Writes keep the server id once known, whichever side (recorder or uploader) writes last.
async function saveRec(rec) {
  const cur = await idb.get('recs', rec.local);
  const id = rec.id ?? cur?.id ?? null;
  if (active?.rec.local === rec.local && id) active.rec.id = id;
  await idb.put('recs', { ...cur, ...rec, id, chunks: Math.max(rec.chunks, cur?.chunks ?? 0),
    finished: !!(cur?.finished || rec.finished), durationMs: Math.max(cur?.durationMs ?? 0, rec.durationMs ?? 0),
    uploaded: [...new Set([...(cur?.uploaded ?? []), ...(rec.uploaded ?? [])])] });
}

// ---------- Uploader: creates the recording on the PC, sends chunks in order, then finishes ----------
const waiters = new Map();    // local id → { resolve, reject, received() }

/** The words of a recording the PC has: asks GET /voice/:id?wait=25 until they're written down (or it failed), for at
 *  most 15 minutes. Rejects with { recording } on a failure or when it is still going; the take is safe on the PC. */
async function written(r) {
  const until = Date.now() + 15 * 60_000;
  let pause = 0;
  while (r.status === 'transcribing' && Date.now() < until) {
    const t0 = Date.now();
    try {
      r = (await AOS.api(`/voice/${r.id}?wait=25`, { timeout: 40000 })).recording ?? r;
      pause = 0;
      // a PC that doesn't wait (an older server) is asked every 1.5 s, not in a tight loop
      if (r.status === 'transcribing' && Date.now() - t0 < 1000) await new Promise((ok) => setTimeout(ok, 1500));
    } catch (e) {
      if (e.status === 404) break;
      pause = Math.min(30000, pause ? pause * 2 : 2000);
      await new Promise((ok) => setTimeout(ok, pause));
    }
  }
  if (r.status === 'done') return r;
  throw Object.assign(new Error(r.status === 'transcribing' ? 'Still being written down' : r.error || 'Transcription failed'), { recording: r });
}
let running = false, again = false, backoff = 0, retryT = 0;
const activeLocal = () => active?.rec.local ?? null;
async function upload() {
  if (running) { again = true; return; }
  running = true;
  again = false;
  let failed = false;
  try {
    const recs = (await idb.all('recs')).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const rec of recs) {
      for (let attempt = 0; attempt < 2; attempt++) {
      try {
      if (!rec.id) {
        const r = await AOS.api('/voice', { method: 'POST', body: JSON.stringify({ source: rec.source, purpose: rec.purpose, mime: rec.mime }) });
        rec.id = r.recording.id;
        if (active?.rec.local === rec.local) active.rec.id = rec.id;
        await saveRec(rec);
      }
      const chunks = (await idb.chunksOf(rec.local)).sort((a, b) => a.n - b.n);
      rec.uploaded ??= [];
      for (const c of chunks) {
        if (rec.uploaded.includes(c.n)) continue;
        const r = await AOS.fetch(`/voice/${rec.id}/chunk/${c.n}`, { method: 'PUT', headers: { 'Content-Type': rec.mime.split(';')[0] }, body: c.data });
        if (!r.ok) throw Object.assign(new Error(`chunk ${c.n}: ${r.status}`), { status: r.status });
        rec.uploaded.push(c.n);
        await saveRec(rec);
      }
      if (rec.finished) {
        // No final receipt: keep every local byte, including on HTTP errors. async: the PC answers as soon as it has
        // the whole take ("transcribing"), and the words follow (written() below), so the queue never waits on them.
        const out = (await AOS.api(`/voice/${rec.id}/finish`, { method: 'POST', body: JSON.stringify({ chunks: rec.chunks, durationMs: rec.durationMs, async: true }) })).recording;
        const bytes = chunks.reduce((n, c) => n + c.data.byteLength, 0);
        if (!out || out.id !== rec.id || !['done', 'failed', 'transcribing'].includes(out.status) || out.chunks !== rec.chunks || !(out.bytes >= bytes))
          throw new Error('The PC has not confirmed the complete recording. Audio is kept on this phone.');
        for (const c of chunks) await idb.del('chunks', [rec.local, c.n]);
        await idb.del('recs', rec.local);
        const w = waiters.get(rec.local);
        waiters.delete(rec.local);
        if (w) { w.received?.(); written(out).then(w.resolve, w.reject); }
        notify();
      } else if (rec.local !== activeLocal()) {
        // Interrupted sessions remain exportable until Send now finalizes them with a complete receipt.
        notify();
      }
      break;
      } catch (e) {
        if (e.status === 404 && rec.id && attempt === 0) {
          const saved = (await idb.chunksOf(rec.local)).sort((a, b) => a.n - b.n);
          if (rec.chunks > 0 && saved.length === rec.chunks && saved.every((c, n) => c.n === n)) {
            // The phone still has the complete take, but earlier upload receipts refer to a PC
            // record that no longer exists. Replay from chunk zero, which the PC can recover.
            rec.uploaded = [];
            await idb.put('recs', { ...(await idb.get('recs', rec.local)), uploaded: [] });
            continue;
          }
        }
        // A stale/deleted PC id or one incomplete take must not hold every newer recording hostage.
        // Keep all of this take's bytes for recovery, then let the rest of the queue make progress.
        failed = true;
        await saveRec({ ...rec, lastError: e.message || 'Upload failed' }).catch(() => {});
        notify();
        if (e.status) console.warn('[voice] upload', e.message);
        break;
      }
      }
    }
    if (!failed) backoff = 0;
  } catch (e) {
    failed = true;
    console.warn('[voice] queue', e.message);
  } finally {
    running = false;
    if (failed) {
      backoff = Math.min(60000, backoff ? backoff * 2 : 3000);
      clearTimeout(retryT);
      retryT = setTimeout(upload, backoff);
    } else if (again) upload();
  }
}
addEventListener('online', () => upload());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') upload(); });

const listeners = new Set();
function notify() { for (const fn of listeners) { try { fn(); } catch {} } }

// ---------- Caret: append where the cursor is, never replace ----------
// The caret is our own record, not the browser's: WebKit doesn't keep a blurred field's selection reliably (after a
// programmatic value change it can read back as 0), which put a second recording in front of the first. A field
// remembers { pos, value } whenever the person moves the caret in it, and after every insert; the record only counts
// while the value is still the one it was taken from. No record → the end of the text.
const CARETS = new WeakMap();
const noteCaret = (el) => {
  if (!el?.matches?.('input, textarea') || document.activeElement !== el || el.selectionEnd == null) return;
  CARETS.set(el, { pos: el.selectionEnd, value: el.value });
};
for (const ev of ['keyup', 'pointerup', 'select', 'input']) document.addEventListener(ev, (e) => { if (!e.isTrusted) return; noteCaret(e.target); }, true);
document.addEventListener('selectionchange', () => noteCaret(document.activeElement));
document.addEventListener('focusout', (e) => noteCaret(e.target), true);
function caretOf(el) {
  const c = CARETS.get(el);
  if (c && c.value === el.value && c.pos >= 0 && c.pos <= el.value.length) return c.pos;
  return el.value.length;
}
export function insertAtCaret(el, text) {
  const t = String(text ?? '').trim();
  if (!t || !el) return;
  const v = el.value;
  const s = caretOf(el);
  const before = v.slice(0, s), after = v.slice(s);
  let ins = t;
  if (before && !/\s$/.test(before)) ins = ` ${ins}`;
  if (after && !/^\s/.test(after)) ins += ' ';
  el.value = before + ins + after;
  const caret = before.length + ins.length;
  CARETS.set(el, { pos: caret, value: el.value });
  if (document.activeElement === el) { try { el.setSelectionRange(caret, caret); } catch {} }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

// Recordings into one field land in the order they were started: each waits for the one before it to land (or fail),
// for at most two minutes, so a recording stuck offline doesn't hold the next one back for good.
const TAILS = new WeakMap();
function queueSlot(target) {
  const prev = TAILS.get(target) ?? Promise.resolve();
  let release;
  const mine = new Promise((r) => (release = r));
  TAILS.set(target, mine);
  const wait = () => Promise.race([prev, new Promise((r) => setTimeout(r, 120_000))]);
  return { wait, release };
}

// ---------- Recording ----------
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function pickMime() {
  const ok = (m) => { try { return window.MediaRecorder?.isTypeSupported?.(m); } catch { return false; } };
  if (IOS && ok('audio/mp4')) return 'audio/mp4';
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) if (ok(m)) return m;
  return '';
}
let streamFactory = null;     // test hook: () => Promise<MediaStream>
let active = null;            // { rec, mr, stream, target, slot, button, opts, started, ctx, raf, levels, stopping }
const uid = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`);
const MIC_SVG = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
const clock = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// A new recording can start while the last one is still transcribing; `inflight` holds every recording not yet landed.
// One that went to the queue (PC slow or unreachable) still lands in order, but no longer holds its field.
const inflight = new Set();
/** Recording or still transcribing into `target` (any field when omitted): its text isn't in the field yet. */
export function busy(target) { return [...inflight].some((A) => !A.queued && (!target || A.target === target)); }
/** The mic is open (for `target`, when given). Tap-to-toggle buttons stop on this and start otherwise. */
export function recording(target) { return !!active && !active.stopping && (!target || active.target === target); }
export function lastId(target) { return target?._voiceId ?? null; }

/**
 * Start recording into `target` (an input or textarea). `slot` gets the live waveform and timer; `button` gets `.on`.
 * opts: { source, purpose, onText(text, recording), onState(state, { received }) }
 */
export async function start({ target, slot, button, source = 'app', purpose = null, onText, onState } = {}) {
  if (active && !active.stopping) { if (active.target === target) stop(); return; }
  if (!window.MediaRecorder) { AOS.toast('This browser can’t record audio'); return; }
  const rec = { local: uid(), id: null, source, purpose, mime: pickMime(), createdAt: new Date().toISOString(), chunks: 0, durationMs: 0, finished: false };
  const A = (active = { rec, target, slot, button, opts: { onText, onState }, started: performance.now(), levels: [], writes: [], turn: queueSlot(target) });
  inflight.add(A);
  const drop = () => { inflight.delete(A); A.turn.release(); };
  A.drop = drop;
  unlock();   // still inside the tap: the level meter's audio context must start here, before the first await
  render('starting');
  try {
    A.stream = streamFactory ? await streamFactory() : await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  } catch (e) {
    if (active === A) active = null;
    drop();
    releaseMeter(A);
    render('idle', A);
    AOS.toast(e?.name === 'NotAllowedError' ? 'Allow the microphone to record.' : 'The microphone didn’t start.');
    return;
  }
  if (active !== A) { A.stream.getTracks().forEach((t) => t.stop()); drop(); return; }
  try {
    A.mr = new MediaRecorder(A.stream, rec.mime ? { mimeType: rec.mime } : undefined);
  } catch {
    A.mr = new MediaRecorder(A.stream);
  }
  rec.mime = A.mr.mimeType || rec.mime || 'audio/webm';
  await idb.put('recs', rec);
  upload();
  A.mr.ondataavailable = (e) => {
    if (!e.data?.size) return;
    const n = rec.chunks++;
    // Store first, then send: the chunk survives the app being killed between the two.
    A.writes.push(e.data.arrayBuffer().then((data) => idb.put('chunks', { local: rec.local, n, data })).then(() => saveRec(rec)).then(() => upload()));
  };
  A.mr.onstop = async () => {
    A.stream.getTracks().forEach((t) => t.stop());
    await Promise.allSettled(A.writes);
    if (A.cancelled) return;
    rec.finished = true;
    rec.durationMs = Math.round(performance.now() - A.started);
    await saveRec(rec);
    const done = new Promise((resolve, reject) => waiters.set(rec.local, { resolve, reject, received: () => { A.received = true; } }));
    upload();
    finishUI(A, done);
  };
  A.mr.start(2000);
  meter(A);
  render('recording');
  AOS.haptic('medium');
}

export function stop() {
  const A = active;
  if (!A || A.stopping) return;
  A.stopping = true;
  if (A.mr && A.mr.state !== 'inactive') A.mr.stop();
  else { active = null; A.drop?.(); render('idle', A); return; }
  render('transcribing');
  AOS.haptic('light');
}

export async function cancel() {
  const A = active;
  if (!A || A.stopping) return;
  A.cancelled = true;
  A.stopping = true;
  try { if (A.mr?.state !== 'inactive') A.mr.stop(); } catch {}
  A.stream?.getTracks().forEach((t) => t.stop());
  active = null;
  A.drop?.();
  releaseMeter(A);
  render('idle', A);
  await Promise.allSettled(A.writes);
  for (const c of await idb.chunksOf(A.rec.local)) await idb.del('chunks', [c.local, c.n]);
  await idb.del('recs', A.rec.local);
  if (A.rec.id) AOS.api(`/voice/${A.rec.id}`, { method: 'DELETE' }).catch(() => {});
}

async function finishUI(A, done) {
  releaseMeter(A);
  // After 25 s the take waits in the queue: its bar goes and the field is free to save or send without it.
  let slow = setTimeout(() => {
    A.queued = true;
    if (active === A) active = null;
    render('queued', A);
  }, 25000);
  try {
    const r = await done;
    clearTimeout(slow);
    if (active === A) active = null;
    // An earlier recording into this field that is still transcribing goes in first.
    await A.turn.wait();
    A.target._voiceId = r.id;
    const closed = A.target.closest?.('.sheet:not(.open)') || !A.target.isConnected;
    if (!closed) insertAtCaret(A.target, r.text ?? '');
    A.drop();
    render('idle', A);
    if (!r.text?.trim()) AOS.toast('Didn’t catch anything. Try again');
    else if (closed) AOS.toast('Recording transcribed. It’s in Settings › Voice recordings');
    A.opts.onText?.(r.text ?? '', r);
  } catch (e) {
    clearTimeout(slow);
    A.drop();
    if (active === A) active = null;
    render('idle', A);
    const still = e?.recording?.status === 'transcribing';
    AOS.toast(still ? 'Your PC is still writing it down. It lands in Settings › Voice recordings' : e?.recording ? 'Transcription failed. Retry it from Voice recordings' : 'Saved. It transcribes when your PC is reachable');
    A.opts.onState?.('failed');
  }
}

// ---------- Live level meter: a scrolling row of bars from the mic's loudness ----------
// One AudioContext for every recording. It is created or resumed inside the tap (unlock()), because WebKit keeps a
// context made after `await getUserMedia` suspended, and a suspended context feeds the analyser silence: flat bars.
let audioCtx = null;
/** Call from a tap that may lead to recording without one (hold-to-record opens it from a timer). */
export function unlock() {
  try {
    const Ctx = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx || audioCtx.state === 'closed') audioCtx = new Ctx();
    if (audioCtx.state !== 'running') audioCtx.resume?.().catch(() => {});
    // A tap that never turns into a recording shouldn't keep audio awake.
    clearTimeout(unlock.t);
    unlock.t = setTimeout(() => { if (!active && audioCtx?.state === 'running') audioCtx.suspend?.().catch(() => {}); }, 3000);
    return audioCtx;
  } catch { return null; }
}
const BUCKET_MS = 70;        // one bar per 70 ms
const FLOOR_DB = -58, TOP_DB = -16;   // quiet room → bar at rest; normal speech after the phone's AGC → near full
const toLevel = (rms) => {
  const db = 20 * Math.log10(Math.max(rms, 1e-6));
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (TOP_DB - FLOOR_DB))) ** 1.3;
};
// Recording opened without a tap (Quick idea widget, lock screen, Control Center, Siri) starts its context outside a
// gesture, often while the app is still coming to the front; WebKit can leave that context suspended or feeding the
// analyser zeros for the whole recording. So the meter wakes the context on the first touch anywhere and when the app
// becomes visible, and rebuilds its graph on a fresh context when it has read nothing but silence for a while.
const DEAD_MS = 1200;        // this long without a single non-zero sample (or with the context not running) → rebuild
const MAX_REBUILDS = 4;
function wakeMeter() {
  if (!active || active.stopping || !active.nodes) return;
  if (audioCtx && audioCtx.state !== 'running') audioCtx.resume?.().catch(() => {});
}
for (const ev of ['pointerdown', 'touchstart', 'keydown']) document.addEventListener(ev, wakeMeter, { capture: true, passive: true });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wakeMeter(); });
function meter(A) {
  try {
    let an = null, fbuf = null, bbuf = null;
    // Hook the mic into the shared context; `fresh` throws the old context away first.
    const build = (fresh) => {
      try { A.src?.disconnect(); } catch {}
      for (const n of A.nodes ?? []) { try { n.disconnect(); } catch {} }
      if (fresh && audioCtx) { const old = audioCtx; audioCtx = null; old.close?.().catch(() => {}); }
      const ctx = unlock();
      if (!ctx) throw new Error('no Web Audio');
      A.ctx = ctx;
      A.src = ctx.createMediaStreamSource(A.stream);
      an = ctx.createAnalyser();
      an.fftSize = 1024;   // ~21 ms at 48 kHz: one animation frame's worth of audio
      // WebKit only pulls audio through nodes that reach the destination; a muted gain keeps the analyser fed.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      A.src.connect(an);
      an.connect(mute);
      mute.connect(ctx.destination);
      A.nodes = [an, mute];
      fbuf = an.getFloatTimeDomainData ? new Float32Array(an.fftSize) : null;
      bbuf = fbuf ? null : new Uint8Array(an.fftSize);
    };
    build(false);
    // -1: the analyser handed back nothing but exact zeros (a dead graph; a live mic always has some noise).
    const rmsNow = () => {
      let sum = 0, any = false;
      if (fbuf) { an.getFloatTimeDomainData(fbuf); for (const v of fbuf) { sum += v * v; if (v) any = true; } return any ? Math.sqrt(sum / fbuf.length) : -1; }
      an.getByteTimeDomainData(bbuf);
      for (const v of bbuf) { const x = (v - 128) / 128; sum += x * x; if (v !== 128) any = true; }
      return any ? Math.sqrt(sum / bbuf.length) : -1;
    };
    let bucketStart = 0, peak = 0, shown = 0, lastResume = 0, deadSince = 0, rebuilds = 0;
    const tick = (t) => {
      if (active !== A || A.stopping) return;
      A.raf = requestAnimationFrame(tick);
      const ctx = A.ctx;
      // iOS can drop the context to "interrupted" (a call, Siri, another app's audio); ask for it back, at most once a second.
      if (ctx.state !== 'running' && t - lastResume > 1000) { lastResume = t; ctx.resume?.().catch(() => {}); }
      const r = ctx.state === 'running' ? rmsNow() : -1;
      if (r < 0) {
        deadSince ||= t;
        if (t - deadSince > DEAD_MS * (rebuilds + 1) && rebuilds < MAX_REBUILDS && A.stream.getAudioTracks().some((k) => k.readyState === 'live')) {
          rebuilds++;
          deadSince = 0;
          try { build(true); } catch {}
        }
      } else deadSince = 0;
      // Read every frame and keep the loudest, so a short syllable between two bars still shows.
      peak = Math.max(peak, r);
      if (!bucketStart) bucketStart = t;
      if (t - bucketStart < BUCKET_MS) return;
      bucketStart = t;
      const target = toLevel(peak);
      peak = 0;
      // Rise at once, fall off over a few bars, so speech reads as words, not flicker.
      shown = target >= shown ? target : shown * 0.55 + target * 0.45;
      A.levels.push(shown);
      if (A.levels.length > 48) A.levels.shift();
      drawLevels(A);
    };
    A.raf = requestAnimationFrame(tick);
  } catch {}
  const timer = setInterval(() => {
    if (active !== A || A.stopping) { clearInterval(timer); return; }
    const el = A.slot?.querySelector('.rb-time');
    if (el) el.textContent = clock(performance.now() - A.started);
  }, 250);
}
// Unhook this recording from the shared context and let it sleep; the next tap on a mic wakes it again.
function releaseMeter(A) {
  cancelAnimationFrame(A.raf);
  try { A.src?.disconnect(); } catch {}
  for (const n of A.nodes ?? []) { try { n.disconnect(); } catch {} }
  A.src = null;
  A.nodes = null;
  if ((!active || active === A) && audioCtx?.state === 'running') audioCtx.suspend?.().catch(() => {});
}
function drawLevels(A) {
  const bars = A.slot?.querySelector('.rb-wave');
  if (!bars) return;
  const n = bars.children.length;
  const lv = A.levels;
  for (let i = 0; i < n; i++) {
    const v = lv[lv.length - n + i] ?? 0;
    bars.children[i].style.transform = `scaleY(${Math.max(0.08, v).toFixed(3)})`;
  }
}

function render(state, A = active) {
  if (!A) return;
  // An older recording finishing while a newer one records into the same field leaves the newer one's bar alone.
  const newer = active && active !== A ? active : null;
  if (!(newer && newer.button === A.button)) {
    A.button?.classList.toggle('on', state === 'recording' || state === 'starting');
    A.button?.classList.toggle('busy', state === 'transcribing');
    A.button?.setAttribute('aria-label', state === 'recording' ? 'Stop recording' : 'Record');
  }
  if (A.slot && !(newer && newer.slot === A.slot)) {
    if (state === 'recording' || state === 'starting') {
      A.slot.innerHTML = `<div class="rec-bar" role="status"><span class="rb-dot" aria-hidden="true"></span><span class="rb-wave" aria-hidden="true">${'<i></i>'.repeat(36)}</span><span class="rb-time">0:00</span><button type="button" class="rb-x" data-rec-cancel aria-label="Discard recording"><svg viewBox="0 0 12 12"><path d="m3 3 6 6M9 3 3 9"/></svg></button><button type="button" class="rb-stop" data-rec-stop aria-label="Stop and transcribe"><i></i></button></div>`;
    } else if (state === 'transcribing') {
      A.slot.innerHTML = '<div class="rec-bar busy" role="status"><span class="rb-spin" aria-hidden="true"></span><span class="rb-label">Transcribing</span></div>';
    } else A.slot.innerHTML = '';
  }
  A.opts.onState?.(state, { received: !!A.received });   // received: the PC has the whole take
  notify();
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-rec-stop]')) { e.preventDefault(); stop(); }
  else if (e.target.closest('[data-rec-cancel]')) { e.preventDefault(); cancel(); }
});

/** Wire a mic button to a field: tap to record, tap again to stop and append. */
export function bindMic(button, getTarget, { slot, source = 'app', purpose = null, onText } = {}) {
  button.addEventListener('click', (e) => {
    e.preventDefault();
    const target = getTarget();
    if (recording(target)) { stop(); return; }
    start({ target, slot: typeof slot === 'function' ? slot() : slot, button, source, purpose, onText });
  });
}
export const micButtonHTML = (attrs = '') => `<button type="button" class="mic-btn" ${attrs} aria-label="Record">${MIC_SVG}</button>`;

/** Recordings still on this phone (not yet on the PC, or not yet finished). */
export async function pending() {
  const recs = await idb.all('recs');
  const out = [];
  for (const r of recs) out.push({ ...r, waiting: (await idb.chunksOf(r.local)).length });
  return out;
}
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const flush = async () => {
  for (const rec of await idb.all('recs')) if (rec.local !== activeLocal()) await saveRec({ ...rec, finished: true });
  return upload();
};

/** A portable backup retains numbered chunks even when an older app already uploaded the beginning. */
export async function backupPending(local) {
  const rec = await idb.get('recs', local);
  if (!rec) throw new Error('This recording has moved to PC history. Download its audio there.');
  const chunks = (await idb.chunksOf(local)).sort((a, b) => a.n - b.n).map((c) => {
    const bytes = new Uint8Array(c.data);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
    return { n: c.n, base64: btoa(binary) };
  });
  return new Blob([JSON.stringify({ format: 'aos-voice-backup', version: 1, recording: rec, chunks })], { type: 'application/json' });
}

export async function exportPending(local) {
  const rec = await idb.get('recs', local);
  if (!rec) throw new Error('This recording has moved to PC history. Download its audio there.');
  const chunks = (await idb.chunksOf(local)).sort((a, b) => a.n - b.n);
  const complete = chunks.length === rec.chunks && chunks.every((c, n) => c.n === n);
  const name = `voice-${rec.local}`;
  if (!complete) return { blob: await backupPending(local), name: `${name}.aos-voice.json`, complete: false };
  const ext = ({ 'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/wav': 'wav', 'audio/ogg': 'ogg' })[rec.mime.split(';')[0]] || 'audio';
  return { blob: new Blob(chunks.map(c => c.data), { type: rec.mime }), name: `${name}.${ext}`, complete: true };
}

// Test hooks: feed a recorded file through the same path (no microphone needed).
export const test = {
  /** Use this MediaStream factory instead of the microphone, e.g. a decoded audio file played into a stream. */
  useStream(fn) { streamFactory = fn; },
  /** Plays an audio URL into a MediaStream so MediaRecorder records it like a mic. Returns { stream, ms }. */
  async fileStream(url) {
    const ctx = new (window.AudioContext ?? window.webkitAudioContext)();
    const ab = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = ab;
    const dst = ctx.createMediaStreamDestination();
    src.connect(dst);
    src.start();
    return { stream: dst.stream, ms: ab.duration * 1000 };
  },
  /** Upload a ready Blob as a recording (split into chunks), finish it, and return the PC's recording. */
  async inject(blob, { source = 'app', purpose = 'test', chunkBytes = 32 * 1024 } = {}) {
    const rec = { local: uid(), id: null, source, purpose, mime: blob.type || 'audio/webm', createdAt: new Date().toISOString(), chunks: 0, durationMs: 0, finished: false };
    await idb.put('recs', rec);
    for (let o = 0; o < blob.size; o += chunkBytes) await idb.put('chunks', { local: rec.local, n: rec.chunks++, data: await blob.slice(o, o + chunkBytes).arrayBuffer() });
    Object.assign(rec, { finished: true, durationMs: 1000 });
    await idb.put('recs', rec);
    const done = new Promise((resolve, reject) => waiters.set(rec.local, { resolve, reject }));
    upload();
    return done;
  },
};

upload();

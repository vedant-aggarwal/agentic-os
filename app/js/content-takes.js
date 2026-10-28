// Content OS · takes from the phone to the PC: 5 MB chunks with the PC answering the offset it has, so an upload resumes
// where it stopped; each take is filed under the script it was recorded for (the PC's matcher handles the rest). The file
// waits in IndexedDB until the PC has every byte, so a take survives a reload, an offline stretch or the app closing.
// Demo mode never uploads (the prototype's rings tick in content-make.js).
import * as API from './svc/api.js';
import * as clock from './svc/clock.js';
import { REAL, refresh } from './content-data.js';

const G = globalThis;
/** Uploads this phone knows about, newest first: { id, name, size, sent, done, error, script, code, n, date, secs, src, take, at } */
export const UPLOADS = [];
const subs = new Set();
export const onUploads = (fn) => { subs.add(fn); return () => subs.delete(fn); };
let tellT = 0;
const tell = (now = false) => {
  const run = () => { tellT = 0; for (const fn of subs) { try { fn(); } catch (e) { console.warn('[takes]', e); } } };
  if (now) { G.clearTimeout(tellT); run(); } else if (!tellT) tellT = G.setTimeout(run, 120);
};
export const progressOf = (u) => (u.size ? Math.min(1, (u.sent ?? 0) / u.size) : 0);

// ── IndexedDB: the files and their state ──
const DB = 'aos-content-takes';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res) => {
    try {
      const r = G.indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('files', { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    } catch { res(null); }
  });
  return dbp;
}
const memory = new Map();   // id → Blob, when IndexedDB can't hold it (private mode, quota)
async function idb(mode, fn) {
  const d = await db(); if (!d) return null;
  return new Promise((res) => {
    try {
      const t = d.transaction('files', mode); const st = t.objectStore('files');
      const r = fn(st);
      t.oncomplete = () => res(r?.result ?? true); t.onerror = () => res(null); t.onabort = () => res(null);
    } catch { res(null); }
  });
}
const meta = (u) => ({ id: u.id, name: u.name, size: u.size, sent: u.sent ?? 0, done: !!u.done, script: u.script ?? null, code: u.code ?? null, n: u.n ?? null, date: u.date, secs: u.secs ?? null, src: u.src, take: u.take ?? null, at: u.at, mime: u.mime ?? null });
// progress saves keep the file that is already stored; only queueTake writes it, only finish drops it
const save = (u, blob = null) => idb('readwrite', (st) => {
  if (blob) return st.put({ ...meta(u), blob });
  const g = st.get(u.id);
  g.onsuccess = () => { if (g.result) st.put({ ...g.result, ...meta(u) }); };
  return g;
});
async function blobOf(u) {
  if (memory.has(u.id)) return memory.get(u.id);
  const r = await idb('readonly', (st) => st.get(u.id));
  return r?.blob ?? null;
}

// ── the PC ──
function put(path, body, onProgress) {
  return new Promise((res, rej) => {
    const x = new XMLHttpRequest();
    x.open('PUT', API.apiUrl(path));
    const h = API.authHeaders(); for (const k of Object.keys(h)) x.setRequestHeader(k, h[k]);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.withCredentials = !API.usesToken();
    x.timeout = 180000;
    x.upload.onprogress = (e) => onProgress?.(e.loaded);
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText || '{}'); } catch {} if (x.status >= 200 && x.status < 300) res(j); else rej(Object.assign(new Error(j.error || `HTTP ${x.status}`), { status: x.status, body: j })); };
    x.onerror = () => rej(Object.assign(new Error('The PC is not reachable'), { status: 0 }));
    x.ontimeout = () => rej(Object.assign(new Error('The upload timed out'), { status: 0 }));
    x.send(body);
  });
}
let pumping = false, retryT = 0, fails = 0;
async function pump() {
  if (!REAL || pumping) return;
  pumping = true;
  try {
    for (const u of UPLOADS.filter((x) => !x.done && !x.fatal)) {
      const ok = await send(u);
      if (!ok) { fails++; G.clearTimeout(retryT); retryT = G.setTimeout(pump, Math.min(60000, 5000 * fails)); break; }
      fails = 0;
    }
  } finally { pumping = false; }
}
async function send(u) {
  const blob = await blobOf(u);
  if (!blob) { u.error = 'The file is no longer on this phone'; u.fatal = true; tell(true); return true; }
  try {
    u.error = null; u.busy = true; tell();
    const start = await API.api('/mod/content/uploads', { method: 'POST', body: JSON.stringify({ id: u.id, name: u.name, size: u.size, date: u.date, script: u.script, take: u.n }), timeout: 20000 });
    let offset = start.offset ?? 0;
    const chunk = start.chunk || 5 * 1024 * 1024;
    if (start.done) { await finish(u, start); return true; }
    while (offset < u.size) {
      const part = blob.slice(offset, Math.min(u.size, offset + chunk));
      let r;
      try { r = await put(`/mod/content/uploads/${u.id}?offset=${offset}`, part, (n) => { u.sent = offset + n; tell(); }); }
      catch (e) {
        if (e.status === 409 && Number.isFinite(e.body?.offset)) { offset = e.body.offset; u.sent = offset; continue; }   // the PC has a different offset: go from there
        throw e;
      }
      offset = r.offset ?? offset + part.size; u.sent = offset;
      await save(u); tell();
      if (r.done) { await finish(u, r); return true; }
    }
    const s = await API.api(`/mod/content/uploads/${u.id}`);
    if (s.done) { await finish(u, s); return true; }
    return false;
  } catch (e) {
    u.busy = false;
    if (e.status && e.status >= 400 && e.status < 500 && e.status !== 404 && e.status !== 408 && e.status !== 409 && e.status !== 429) { u.error = e.message; u.fatal = true; tell(true); return true; }
    u.error = e.status ? e.message : 'Waiting for your PC'; tell(true);
    return false;
  }
}
async function finish(u, r) {
  u.done = true; u.busy = false; u.sent = u.size; u.take = r.take ?? null; u.error = null;
  memory.delete(u.id);
  // keep the state (not the file) so the list says "uploaded" after a reload, until the PC lists it
  await idb('readwrite', (st) => st.put(meta(u)));
  tell(true);
  refresh({ force: true });
}

/** Queue a take (a recorded Blob or a picked File). Returns its upload entry. */
export async function queueTake(file, { script = null, code = null, n = null, date = clock.today(), secs = null, src = 'phone', name = null } = {}) {
  const id = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const ext = /mp4/.test(file.type) ? 'mp4' : /quicktime|mov/.test(file.type) ? 'mov' : /webm/.test(file.type) ? 'webm' : (String(file.name ?? '').split('.').pop() || 'mp4');
  const u = { id, name: (name ?? file.name ?? `${code ?? 'take'}${n ? ` take ${n}` : ''}.${ext}`).replace(/[^\w. -]+/g, '_').slice(0, 80), size: file.size, sent: 0, done: false,
    script, code, n, date, secs, src, take: null, at: new Date().toISOString(), mime: file.type || null };
  UPLOADS.unshift(u);
  const stored = await save(u, file);
  if (!stored) memory.set(id, file);   // no IndexedDB here: it uploads from memory, and a reload loses it (said on screen)
  u.volatile = !stored;
  tell(true);
  pump();
  return u;
}
/** Try the waiting ones again now (Upload tapped, the PC came back). */
export const retryUploads = () => { for (const u of UPLOADS) if (!u.done && !u.fatal) u.error = null; fails = 0; pump(); };
/** Forget an upload this phone holds (one that can't go, or one the PC already lists). */
export async function forget(id) {
  const i = UPLOADS.findIndex((u) => u.id === id); if (i >= 0) UPLOADS.splice(i, 1);
  memory.delete(id); await idb('readwrite', (st) => st.delete(id)); tell(true);
}

// ── start: what an earlier session left (done ones a day old are dropped) ──
export const takesReady = REAL ? (async () => {
  const all = await idb('readonly', (st) => st.getAll());
  const dayAgo = Date.now() - 864e5;
  for (const r of (Array.isArray(all) ? all : []).sort((a, b) => String(b.at).localeCompare(String(a.at)))) {
    if (r.done && Date.parse(r.at) < dayAgo) { idb('readwrite', (st) => st.delete(r.id)); continue; }
    const { blob, ...m } = r;
    UPLOADS.push({ ...m, error: r.done ? null : 'Waiting to resume' });
  }
  tell(true);
  pump();
  G.addEventListener?.('online', retryUploads);
  G.document?.addEventListener('visibilitychange', () => { if (G.document.visibilityState === 'visible' && UPLOADS.some((u) => !u.done && !u.fatal)) pump(); });
})() : Promise.resolve();

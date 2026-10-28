// The threads he opened last, kept on this phone so a job still reads with the PC away (and paints at once on open).
// IndexedDB 'aos-work' → store 'threads', one record per job: { id, at, job, events }. At most 12 jobs (the oldest
// opened goes first), 800 events each, and any long text in an event (tool output, a diff) is cut to its last 2,000
// characters. Nothing here is sent anywhere; the PC's copy always wins once it answers.
//
//   import { keepThread, readThread } from '../work/thread-cache.js';
//   keepThread(job, events)   (debounced per job; events: any iterable of the job's events)
//   await readThread(jobId)   → { at, job, events } | null
const G = globalThis;
const DB = 'aos-work', VERSION = 1, STORE = 'threads';
const MAX_JOBS = 12, MAX_EVENTS = 800, CUT = 2000;
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    if (!G.indexedDB) { resolve(null); return; }
    let req;
    try { req = G.indexedDB.open(DB, VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' }).createIndex('at', 'at'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbp;
}
const done = (r) => new Promise((resolve) => { r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => resolve(null); });
/** Long strings anywhere in an event keep their last CUT characters (where a tool's answer usually is). */
function trim(v, depth = 0) {
  if (typeof v === 'string') return v.length > CUT ? `…${v.slice(-CUT)}` : v;
  if (!v || typeof v !== 'object' || depth > 6) return v;
  if (Array.isArray(v)) return v.slice(-200).map((x) => trim(x, depth + 1));
  const o = {};
  for (const [k, x] of Object.entries(v)) o[k] = trim(x, depth + 1);
  return o;
}
const timers = new Map();
export function keepThread(job, events) {
  const id = job?.id;
  if (!id) return;
  clearTimeout(timers.get(id));
  timers.set(id, setTimeout(async () => {
    timers.delete(id);
    const d = await db();
    if (!d) return;
    const list = [...events].sort((a, b) => a.seq - b.seq).slice(-MAX_EVENTS).map((e) => trim(e));
    try {
      const t = d.transaction(STORE, 'readwrite');
      const st = t.objectStore(STORE);
      st.put({ id, at: Date.now(), job: trim(job), events: list });
      // the oldest opened threads go once there are more than MAX_JOBS
      const keys = await done(st.index('at').getAllKeys());
      if (keys && keys.length > MAX_JOBS) for (const k of keys.slice(0, keys.length - MAX_JOBS)) st.delete(k);
    } catch {}
  }, 1200));
}
export async function readThread(id) {
  const d = await db();
  if (!d) return null;
  try { return await done(d.transaction(STORE).objectStore(STORE).get(id)); } catch { return null; }
}

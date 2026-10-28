// svc/store: offline-first collections for the new data v2 adds (expenses, workouts, journal lines, habits, people…).
// Every write lands on the phone first (IndexedDB), shows at once, and goes to the PC from an outbox, keyed by a
// client-made id, so a write sent twice is still one record. Reads merge last-write-wins by updated_at.
//
//   const expenses = collection('money/expenses', { endpoint: '/api/v1/mod/money/expenses' });
//   await expenses.ready;                      // loaded from the phone (then refreshed from the PC in the background)
//   expenses.list()  · expenses.get(id)        // what to draw (soft-deleted docs are left out)
//   expenses.add({ amount: 40, note: 'Chai' }) → the doc, with id, created_at, updated_at (optimistic)
//   expenses.update(id, { note: 'Chai x2' })   · expenses.remove(id)   (soft delete: deleted_at)
//   expenses.on('change', ({ why, ids }) => draw())   why: 'load' | 'local' | 'server' | 'error'
//   expenses.refresh() · expenses.flush() · expenses.pending() → ops waiting · expenses.errors() → refused writes
//
// The server side of the contract (server/modules/_collection.ts implements it; v2/notes/engine.md documents it):
//   GET    <endpoint>?since=<cursor>  → { items: [doc], cursor }   (with since: changed docs, tombstones included)
//   PUT    <endpoint>/<id>  doc       → { item }  upsert by id; an older updated_at than the stored one loses (LWW)
//   POST   <endpoint>       doc w/ id → { item }  the same upsert (App Intents and widgets use it)
//   DELETE <endpoint>/<id>            → { item }  soft delete (deleted_at); deleting twice, or an unknown id, is fine
// Every doc: { id, created_at, updated_at, deleted_at, ...fields }. Times are ISO strings.
import * as API from './api.js';

const G = globalThis;
const DB_NAME = 'aos-store', DB_VERSION = 1;
const nowIso = () => new Date().toISOString();
let demo = false;
/** Demo mode keeps collections in memory and never talks to the PC. */
export const setDemo = (on) => { demo = !!on; };

// ── IndexedDB, with a localStorage fallback (private mode, old WebKit) ───
let dbp = null;
function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    if (!G.indexedDB) { resolve(null); return; }
    let req;
    try { req = G.indexedDB.open(DB_NAME, DB_VERSION); } catch { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: ['col', 'id'] }).createIndex('col', 'col');
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: ['col', 'id'] }).createIndex('col', 'col');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'col' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbp;
}
const tx = (db, stores, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(stores, mode);
  const out = fn(t);
  t.oncomplete = () => resolve(out?.result ?? out);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error);
});
const all = (db, store, col) => new Promise((resolve) => {
  const r = db.transaction(store).objectStore(store).index('col').getAll(col);
  r.onsuccess = () => resolve(r.result ?? []);
  r.onerror = () => resolve([]);
});
const one = (db, store, key) => new Promise((resolve) => {
  const r = db.transaction(store).objectStore(store).get(key);
  r.onsuccess = () => resolve(r.result ?? null);
  r.onerror = () => resolve(null);
});

// ── the collection ────────────────────────────────────────────────────
const cols = new Map();
/** One collection per name: collection('money/expenses', { endpoint }) returns the same object every time. */
export function collection(name, opts = {}) {
  if (cols.has(name)) return cols.get(name);
  const c = new Collection(name, opts);
  cols.set(name, c);
  return c;
}
export const collections = () => [...cols.values()];

class Collection {
  constructor(name, { endpoint, interval = 60000, sort = null, prefix = null } = {}) {
    if (!endpoint && !demo) throw new Error(`collection(${name}) needs an endpoint`);
    this.name = name;
    this.endpoint = endpoint ? API.apiPath(endpoint) : null;
    this.prefix = prefix ?? (name.split('/').pop().replace(/[^a-z0-9]/gi, '').slice(0, 3).toLowerCase() || 'c');
    this.sortFn = sort ?? ((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    this.docs = new Map();       // id → doc (tombstones included until the PC confirms them)
    this.outbox = new Map();     // id → { col, id, op: 'put' | 'delete', doc, seq, tries }
    this.refused = new Map();    // id → message (the PC said no)
    this.cursor = null;
    this.subs = new Map();
    this.seq = 0;
    this.fails = 0;
    this.flushing = null;
    this.timer = 0;
    this.ready = this.load().then(() => { this.emit('change', { why: 'load', ids: [...this.docs.keys()] }); this.kick(); return this; });
    if (!demo && this.endpoint) {
      G.document?.addEventListener('visibilitychange', () => { if (G.document.visibilityState === 'visible') this.kick(); });
      G.addEventListener?.('online', () => this.kick());
      if (interval) G.setInterval?.(() => { if (G.document?.visibilityState === 'visible') this.refresh(); }, interval);
    }
  }

  // persistence
  get lsKey() { return `aos-store:${this.name}`; }
  async load() {
    if (demo) return;
    const db = await openDb();
    if (db) {
      const [docs, ops, meta] = await Promise.all([all(db, 'docs', this.name), all(db, 'outbox', this.name), one(db, 'meta', this.name)]);
      for (const d of docs) this.docs.set(d.id, d.doc);
      for (const o of ops) { this.outbox.set(o.id, o); this.seq = Math.max(this.seq, o.seq ?? 0); }
      this.cursor = meta?.cursor ?? null;
      return;
    }
    const v = API.ls.json(this.lsKey);
    for (const d of v?.docs ?? []) this.docs.set(d.id, d);
    for (const o of v?.outbox ?? []) { this.outbox.set(o.id, o); this.seq = Math.max(this.seq, o.seq ?? 0); }
    this.cursor = v?.cursor ?? null;
  }
  async save(ids = null) {
    if (demo) return;
    const db = await openDb();
    if (!db) { API.ls.set(this.lsKey, JSON.stringify({ docs: [...this.docs.values()], outbox: [...this.outbox.values()], cursor: this.cursor })); return; }
    try {
      await tx(db, ['docs', 'outbox', 'meta'], 'readwrite', (t) => {
        const ds = t.objectStore('docs'), os = t.objectStore('outbox');
        for (const id of ids ?? this.docs.keys()) {
          const d = this.docs.get(id);
          if (d) ds.put({ col: this.name, id, doc: d }); else ds.delete([this.name, id]);
          const o = this.outbox.get(id);
          if (o) os.put(o); else os.delete([this.name, id]);
        }
        t.objectStore('meta').put({ col: this.name, cursor: this.cursor, at: nowIso() });
      });
    } catch (e) { console.warn(`[store] ${this.name} could not save`, e); }
  }

  // events
  on(ev, fn) { if (!this.subs.has(ev)) this.subs.set(ev, new Set()); this.subs.get(ev).add(fn); return () => this.subs.get(ev)?.delete(fn); }
  emit(ev, detail) {
    for (const fn of this.subs.get(ev) ?? []) { try { fn(detail); } catch (e) { console.warn(`[store] ${this.name} listener`, e); } }
    if (ev === 'change') G.document?.dispatchEvent(new CustomEvent('store-changed', { detail: { name: this.name, ...detail } }));
  }

  // reads
  list({ deleted = false } = {}) { return [...this.docs.values()].filter((d) => deleted || !d.deleted_at).sort(this.sortFn); }
  get(id) { const d = this.docs.get(id); return d && !d.deleted_at ? d : null; }
  pending() { return this.outbox.size; }
  errors() { return new Map(this.refused); }

  // writes (optimistic: on the phone and on screen now, on the PC when it answers)
  add(fields = {}) {
    const t = nowIso();
    const doc = { ...fields, id: fields.id ?? API.clientId(this.prefix), created_at: fields.created_at ?? t, updated_at: t, deleted_at: null };
    this.docs.set(doc.id, doc);
    this.queue(doc.id, 'put', doc);
    return doc;
  }
  update(id, patch = {}) {
    const cur = this.docs.get(id);
    if (!cur) throw new Error(`${this.name}: no ${id}`);
    const doc = { ...cur, ...patch, id, created_at: cur.created_at, updated_at: nowIso() };
    this.docs.set(id, doc);
    this.queue(id, 'put', doc);
    return doc;
  }
  /** Put a doc in as it is (an import, an undo). It keeps its own updated_at unless touch is true. */
  put(doc, { touch = true } = {}) {
    if (!doc?.id) throw new Error(`${this.name}: put needs an id`);
    const d = { created_at: nowIso(), deleted_at: null, ...doc, ...(touch || !doc.updated_at ? { updated_at: nowIso() } : {}) };
    this.docs.set(d.id, d);
    this.queue(d.id, 'put', d);
    return d;
  }
  remove(id) {
    const cur = this.docs.get(id);
    const t = nowIso();
    const doc = { ...(cur ?? { id, created_at: t }), deleted_at: t, updated_at: t };
    this.docs.set(id, doc);
    this.queue(id, 'delete', doc);
    return doc;
  }
  queue(id, op, doc) {
    this.refused.delete(id);
    if (!demo) this.outbox.set(id, { col: this.name, id, op, doc, seq: ++this.seq, tries: 0 });
    this.save([id]);
    this.emit('change', { why: 'local', ids: [id] });
    this.soon(300);
  }

  // the PC
  soon(ms) { if (demo || !this.endpoint) return; G.clearTimeout(this.timer); this.timer = G.setTimeout(() => this.kick(), ms); }
  async kick() { if (demo || !this.endpoint) return; await this.flush(); await this.refresh(); }
  /** Send what waits, oldest first. Offline or a PC error keeps it (retried with backoff); a refusal drops it. */
  flush() {
    if (demo || !this.endpoint) return Promise.resolve();
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const ops = [...this.outbox.values()].sort((a, b) => a.seq - b.seq);
      for (const o of ops) {
        try {
          const url = `${this.endpoint}/${encodeURIComponent(o.id)}`;
          const r = o.op === 'delete' ? await API.api(url, { method: 'DELETE' }) : await API.api(url, { method: 'PUT', body: JSON.stringify(o.doc) });
          const now = this.outbox.get(o.id);
          if (now && now.seq === o.seq) this.outbox.delete(o.id);   // changed again while in flight: send that too
          // the PC's reply can carry more than was sent (her suggestion, auto-filing): redraw when it does
          const took = r?.item && !this.outbox.has(o.id) && this.take(r.item);
          this.fails = 0;
          await this.save([o.id]);
          if (took) this.emit('change', { why: 'server', ids: [o.id] });
        } catch (e) {
          if (e.status && e.status >= 400 && e.status < 500 && e.status !== 404 && e.status !== 408 && e.status !== 429) {
            // refused: drop it and say so (the screen can show the doc as not saved and offer to remove it)
            if (this.outbox.get(o.id)?.seq === o.seq) this.outbox.delete(o.id);
            this.refused.set(o.id, e.message);
            await this.save([o.id]);
            this.emit('change', { why: 'error', ids: [o.id], error: e.message });
            this.emit('error', { id: o.id, error: e.message, status: e.status });
            continue;
          }
          // offline, the PC failed, or its module isn't there yet (404): keep it, try later
          o.tries = (o.tries ?? 0) + 1;
          this.fails++;
          this.soon(Math.min(e.status === 404 ? 300000 : 60000, 5000 * this.fails));
          break;
        }
      }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  /** A doc from the PC: newest updated_at wins, and a doc still waiting to be sent keeps the phone's copy. */
  take(item) {
    if (!item?.id) return false;
    if (this.outbox.has(item.id)) return false;
    const cur = this.docs.get(item.id);
    if (cur && String(cur.updated_at ?? '') > String(item.updated_at ?? '')) return false;
    if (cur && JSON.stringify(cur) === JSON.stringify(item)) return false;
    this.docs.set(item.id, item);
    this.refused.delete(item.id);
    return true;
  }
  async refresh() {
    if (demo || !this.endpoint) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const q = this.cursor ? `?since=${encodeURIComponent(this.cursor)}` : '';
        const r = await API.api(`${this.endpoint}${q}`, { timeout: 15000 });
        const ids = [];
        for (const it of r.items ?? []) if (this.take(it)) ids.push(it.id);
        // tombstones the PC has confirmed can go once nothing waits on them
        for (const [id, d] of this.docs) if (d.deleted_at && !this.outbox.has(id) && (r.items ?? []).some((x) => x.id === id && x.deleted_at)) { this.docs.delete(id); ids.push(id); }
        if (r.cursor != null) this.cursor = String(r.cursor);
        await this.save(ids.length ? ids : []);
        if (ids.length) this.emit('change', { why: 'server', ids });
      } catch (e) {
        if (e.status !== 404) console.info(`[store] ${this.name} refresh`, e.message);
      } finally { this.refreshing = null; }
    })();
    return this.refreshing;
  }
}

/** Every collection's waiting ops (Settings shows the count; sign-out warns about them). */
export const pendingAll = () => collections().reduce((n, c) => n + c.pending(), 0);
/** Forget everything on this phone (sign out, server change). */
export async function wipe() {
  for (const c of cols.values()) { c.docs.clear(); c.outbox.clear(); c.cursor = null; }
  try { G.localStorage && Object.keys(G.localStorage).filter((k) => k.startsWith('aos-store:')).forEach((k) => G.localStorage.removeItem(k)); } catch {}
  const db = await openDb();
  if (db) { try { await tx(db, ['docs', 'outbox', 'meta'], 'readwrite', (t) => { t.objectStore('docs').clear(); t.objectStore('outbox').clear(); t.objectStore('meta').clear(); }); } catch {} }
}

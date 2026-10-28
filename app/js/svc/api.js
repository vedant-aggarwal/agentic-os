// svc/api: the one way the app reaches the PC. The server address, the session, a truthful connection state, and
// JSON requests with timeouts. Ported from the shipping app (legacy-app/app.js:27-87, the cb42bc8 connection fix).
//
//   api(path, { method, body, timeout })  JSON in and out; throws Error { status, message, body }; a 401 signs out;
//                                          null for a 304 (the caller sent If-None-Match)
//   rawFetch(path, opts)                   the same session, no JSON, no timeout (streams, uploads); never redirects
//   connection() → { status: 'ok' | 'offline' | 'error', error }   onConnection(fn) → unsubscribe
//   apiBase() · setServer(url) · serverInfo() · token() · setToken(t) · authHeaders() · signOut() · loginUrl()
//
// The native app talks to https://your-server.example unless Settings → Server address (localStorage
// agentos-app:server) says otherwise; ?server=<url> sets that override for development (?server=default clears it).
// The web build is always same-origin: the server's CORS only lets the native shell call across origins.
const G = globalThis;

// Seams for tests (server/connection.test.ts drives the real module with fake timers and fetch).
export const env = {
  fetch: (...a) => G.fetch(...a),
  setTimeout: (fn, ms) => G.setTimeout(fn, ms),
  clearTimeout: (t) => G.clearTimeout(t),
  now: () => Date.now(),
  onLine: () => G.navigator?.onLine !== false,
  replace: (url) => G.location?.replace(url),
};

export const NATIVE = !!G.window?.Capacitor?.isNativePlatform?.();
export const DEFAULT_SERVER = 'https://your-server.example';
// Kept from the shipping app so an updated install keeps its session and its queued edits.
export const KEYS = { token: 'agentos-app:token', server: 'agentos-app:server', boot: 'agentos-app:boot', state: 'agentos-app:state', source: 'agentos-app:source' };

export const ls = {
  get(k) { try { return G.localStorage?.getItem(k) ?? null; } catch { return null; } },
  set(k, v) { try { G.localStorage?.setItem(k, v); return true; } catch { return false; } },
  del(k) { try { G.localStorage?.removeItem(k); } catch {} },
  json(k) { try { return JSON.parse(G.localStorage?.getItem(k) ?? 'null'); } catch { return null; } },
};

// ── the server address ────────────────────────────────────────────────
/** A server address as the app stores it: scheme + host (+ port), no trailing slash. null when it is not one. */
export function normalizeServer(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return `${u.protocol}//${u.host}`;
  } catch { return null; }
}
(function readServerParam() {
  const q = G.location ? new URLSearchParams(G.location.search).get('server') : null;
  if (q == null) return;
  if (q === '' || q === 'default') { ls.del(KEYS.server); return; }
  const n = normalizeServer(q);
  if (n) ls.set(KEYS.server, n); else console.warn('[api] ?server= is not an http(s) address:', q);
})();
const override = () => normalizeServer(ls.get(KEYS.server));
/** Where /api/v1 lives: '' (same origin) on the web, the PC's public address in the iPhone app. */
export function apiBase() {
  if (!NATIVE) {
    // the web page and the API share an origin; an override only makes sense when this page is not served by the PC
    const o = override();
    return o && G.location && o !== G.location.origin ? o : '';
  }
  return override() ?? DEFAULT_SERVER;
}
/** Bearer tokens: always natively; on the web only when the API is on another origin (cookies stay same-origin). */
export const usesToken = () => NATIVE || apiBase() !== '';
export const serverInfo = () => ({ base: apiBase() || (G.location?.origin ?? ''), custom: !!override(), default: DEFAULT_SERVER, native: NATIVE });
/**
 * Point the app at another PC. The session and the cached data belong to the old server, so they are dropped and the
 * app signs in again; edits still waiting to sync are dropped too (the caller asks first). null goes back to the default.
 */
export function setServer(raw) {
  const n = raw == null || raw === '' ? null : normalizeServer(raw);
  if (raw != null && raw !== '' && !n) throw new Error('That isn’t a web address. Try https://your-pc.example.com');
  const before = apiBase();
  if (n && n !== DEFAULT_SERVER) ls.set(KEYS.server, n); else ls.del(KEYS.server);
  if (apiBase() !== before) for (const k of [KEYS.token, KEYS.boot, KEYS.state]) ls.del(k);
  return apiBase();
}

// ── the session ───────────────────────────────────────────────────────
export const token = () => ls.get(KEYS.token);
export function setToken(t) { if (t) ls.set(KEYS.token, t); else ls.del(KEYS.token); }
export function authHeaders() { const t = usesToken() ? token() : null; return t ? { Authorization: `Bearer ${t}` } : {}; }
export function loginUrl() {
  if (NATIVE || usesToken()) return 'login.html';
  const here = G.location ? G.location.pathname + G.location.search + G.location.hash : '/';
  return `/login?next=${encodeURIComponent(here)}`;
}
export const hang = () => new Promise(() => {});
let leaving = false;
/** The PC no longer knows this session: forget it and sign in again. Queued edits stay (they replay for the same user). */
async function unauthorized() {
  if (!leaving) {
    leaving = true;
    ls.del(KEYS.token); ls.del(KEYS.boot);
    env.replace(loginUrl());
  }
  await hang();
}
/** Sign out on purpose: tell the PC, then forget the session, the cached day and any edits still waiting. */
export async function signOut() {
  try { await api('/auth/logout', { method: 'POST', body: '{}', timeout: 6000, noAuthRedirect: true }); } catch {}
  for (const k of [KEYS.boot, KEYS.state, KEYS.token]) ls.del(k);
  leaving = true;
  env.replace(NATIVE || usesToken() ? 'login.html' : '/login');
  await hang();
}

// ── the connection: truthful offline (cb42bc8) ──────────────────────────
// Any HTTP reply proves the PC answered. "Offline" shows only when the phone says it is offline, or after 2+ failures
// spread over 2.5 s; a single dropped request is rechecked quietly with GET /healthz (3 s × n, at most 30 s apart).
// 'error' means the PC answered but failed to save (sync sets it); the next good save or response clears it.
const conn = { status: 'ok', error: null, failures: 0, first: 0, retry: 0, gen: 0 };
const subs = new Set();
export const connection = () => ({ status: conn.status, error: conn.error });
export function onConnection(fn) { subs.add(fn); return () => subs.delete(fn); }
const emit = () => { for (const fn of subs) { try { fn(connection()); } catch (e) { console.warn('[api] connection listener', e); } } };
export function responded() {
  conn.gen++;
  conn.failures = 0;
  conn.first = 0;
  if (conn.retry) env.clearTimeout(conn.retry);
  conn.retry = 0;
  if (conn.status === 'offline') { conn.status = 'ok'; conn.error = null; emit(); }
}
export function failed() {
  conn.failures++;
  conn.first ||= env.now();
  if (!env.onLine() || (conn.failures > 1 && env.now() - conn.first >= 2500)) {
    if (conn.status !== 'offline') { conn.status = 'offline'; conn.error = null; emit(); }
  }
  if (!conn.retry) conn.retry = env.setTimeout(probe, Math.min(30000, 3000 * conn.failures));
}
export async function probe() {
  conn.retry = 0;
  try { await connectionFetch(`${apiBase()}/healthz`, { cache: 'no-store', signal: timeoutSignal(5000) }); } catch {}
}
/** The PC answered but could not save (a 5xx while syncing). Offline outranks it. */
export function setError(message) { if (conn.status === 'offline') return; conn.status = 'error'; conn.error = message ?? null; emit(); }
export function clearError() { if (conn.status !== 'error') return; conn.status = 'ok'; conn.error = null; emit(); }
export async function connectionFetch(url, opts) {
  const gen = conn.gen;
  try {
    const r = await env.fetch(url, opts);
    responded();
    return r;
  } catch (e) {
    // A request the app cancelled itself is not an outage; a timeout is (the PC did not answer in time).
    if (e?.name !== 'AbortError' && gen === conn.gen) failed();
    throw e;
  }
}
if (G.addEventListener) {
  G.addEventListener('online', () => { probe(); });
  G.addEventListener('offline', () => failed());
}

// ── requests ──────────────────────────────────────────────────────────
function timeoutSignal(ms) {
  if (!ms) return undefined;
  if (G.AbortSignal?.timeout) return G.AbortSignal.timeout(ms);
  const c = new AbortController();
  env.setTimeout(() => c.abort(Object.assign(new Error('The PC took too long to answer.'), { name: 'TimeoutError' })), ms);
  return c.signal;
}
function anySignal(signals) {
  const list = signals.filter(Boolean);
  if (list.length < 2) return list[0];
  if (G.AbortSignal?.any) return G.AbortSignal.any(list);
  const c = new AbortController();
  for (const s of list) { if (s.aborted) { c.abort(s.reason); break; } s.addEventListener('abort', () => c.abort(s.reason), { once: true }); }
  return c.signal;
}
/** '/api/v1/tasks' and '/tasks' are the same path. */
export const apiPath = (p) => { const s = String(p ?? ''); const x = s.replace(/^\/api\/v1(?=\/|$)/, ''); return x.startsWith('/') ? x : `/${x}`; };
export const apiUrl = (p) => `${apiBase()}/api/v1${apiPath(p)}`;
const credentials = () => (apiBase() ? 'omit' : 'same-origin');

/**
 * JSON request to /api/v1. Throws Error { status, message, body } for an HTTP error, a TypeError/TimeoutError when the
 * PC can't be reached. A 401 forgets the session and goes to sign-in (unless noAuthRedirect). Default timeout 20 s.
 */
export async function api(path, { timeout = 20000, signal, headers, noAuthRedirect = false, ...opts } = {}) {
  const sig = anySignal([signal, timeoutSignal(timeout)]);
  const r = await connectionFetch(apiUrl(path), {
    cache: 'no-store', credentials: credentials(), ...opts, ...(sig ? { signal: sig } : {}),
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(headers ?? {}) },
  });
  if (r.status === 401 && !noAuthRedirect && !/^\/auth\//.test(apiPath(path))) await unauthorized();
  // the caller sent If-None-Match and its copy is still current
  if (r.status === 304) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error ?? (r.statusText || `HTTP ${r.status}`)), { status: r.status, body: j });
  return j;
}
/** The session on a plain fetch to /api/v1 (streams, binary uploads). The caller reads the status. */
export function rawFetch(path, opts = {}) {
  return connectionFetch(apiUrl(path), { cache: 'no-store', credentials: credentials(), ...opts, headers: { ...authHeaders(), ...(opts.headers ?? {}) } });
}
/** JSON helpers. body may be an object (stringified) or a string. */
const send = (method) => (path, body, o = {}) => api(path, { ...o, method, body: body == null ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
export const get = (path, o) => api(path, o);
export const post = send('POST');
export const patch = send('PATCH');
export const put = send('PUT');
export const del = (path, o = {}) => api(path, { ...o, method: 'DELETE' });

/** A client-made id: time-ordered, unique enough for one person's devices, safe in URLs. prefix: 'c', 'n' (task) … */
export function clientId(prefix = 'c') {
  const t = Date.now().toString(36);
  const r = (G.crypto?.getRandomValues ? [...G.crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(36).padStart(2, '0')).join('') : Math.random().toString(36).slice(2, 14)).slice(0, 12);
  return `${prefix}_${t}${r}`;
}

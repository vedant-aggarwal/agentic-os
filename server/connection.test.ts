// The app's truthful connection state (cb42bc8), now in app/js/svc/api.js and svc/sync.js (v2). The same five cases
// as before, driven through the real modules with fake timers, fetch and storage.
import { beforeEach, expect, test } from 'bun:test';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
let online = true;
Object.defineProperty(globalThis, 'navigator', { value: { get onLine() { return online; } }, configurable: true });

const API: any = await import('../app/js/svc/api.js');
const SYNC: any = await import('../app/js/svc/sync.js');

let now = 10_000;
const timers: (() => unknown)[] = [];
API.env.now = () => now;
API.env.setTimeout = (fn: () => unknown) => { timers.push(fn); return timers.length; };
API.env.clearTimeout = () => {};
API.env.replace = () => {};
const advance = (ms: number) => { now += ms; };
const boot = (date = '2026-10-22') => ({ user: { id: 1, role: 'owner' }, today: { date, utcOffsetMinutes: 330, tasks: [] }, week: { days: [] }, goals: { goals: [] }, projects: [], life: { snapshots: [] }, agents: {} });
const reset = () => {
  online = true; timers.length = 0;
  API.responded();                       // a known-good start: no failures, status ok
  Object.assign(SYNC.state, { source: 'real', boot: boot(), user: { id: 1, role: 'owner' }, dirty: false, syncing: false });
  SYNC.state.data = SYNC.fresh(SYNC.state.boot);
  SYNC.state.base = SYNC.pickSync(SYNC.state.data);
};
beforeEach(reset);

test('one dropped refresh does not announce that the phone is offline', async () => {
  API.env.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await SYNC.refresh();
  expect(API.connection().status).toBe('ok');
});

test('a local rendering error after a successful refresh is not a network outage', async () => {
  API.env.fetch = async () => Response.json({ ...boot(), today: { date: '2026-10-22', utcOffsetMinutes: 330, tasks: [{ id: 't1', title: 'x', status: 'todo' }] } });
  const off = SYNC.onBoot(() => { throw new TypeError('local render error'); });
  await SYNC.refresh(true);
  off();
  expect(API.connection().status).toBe('ok');
  expect(SYNC.state.data.tasks.map((t: any) => t.id)).toEqual(['t1']);
});

test('repeated failure is confirmed by a background probe and recovers', async () => {
  API.env.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await API.api('/bootstrap').catch(() => {});
  expect(API.connection().status).toBe('ok');          // one failure is only a recheck
  advance(3000);
  await timers.shift()!();                              // the quiet /healthz probe fails too
  expect(API.connection().status).toBe('offline');
  API.env.fetch = async () => Response.json({ ok: true });
  advance(6000);
  await timers.shift()!();
  expect(API.connection().status).toBe('ok');
});

test('a successful transcription response clears stale offline feedback immediately', async () => {
  online = false;
  API.env.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await API.api('/voice/v_test001/finish', { method: 'POST' }).catch(() => {});
  expect(API.connection().status).toBe('offline');
  online = true;
  API.env.fetch = async () => Response.json({ recording: { status: 'done', text: 'test' } });
  await API.api('/voice/v_test001/finish', { method: 'POST' });
  expect(API.connection().status).toBe('ok');
});

test('confirmed network loss keeps warning visible and a server response clears it', async () => {
  online = false;
  API.env.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await API.api('/bootstrap').catch(() => {});
  expect(API.connection().status).toBe('offline');
  online = true;
  API.env.fetch = async () => Response.json({ error: 'temporary server error' }, { status: 503 });
  await expect(API.api('/bootstrap')).rejects.toMatchObject({ status: 503 });
  expect(API.connection().status).toBe('ok');           // the PC answered, even with an error
});

test('a request the app cancels itself is not an outage', async () => {
  API.env.fetch = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  for (let i = 0; i < 3; i++) { advance(2000); await API.api('/jobs').catch(() => {}); }
  expect(API.connection().status).toBe('ok');
  expect(timers.length).toBe(0);
});

test('a 401 forgets the session but keeps the edits waiting for the same person', async () => {
  store.set(API.KEYS.token, 'tok'); store.set(API.KEYS.boot, '{}'); store.set(API.KEYS.state, '{"dirty":true}');
  let went = '';
  API.env.replace = (u: string) => { went = u; };
  API.env.fetch = async () => Response.json({ error: 'Sign in again.' }, { status: 401 });
  const p = API.api('/tasks');
  await new Promise((r) => setTimeout(r, 20));          // api() never resolves: the page is leaving
  expect(went).toContain('login');
  expect(store.has(API.KEYS.token)).toBe(false);
  expect(store.has(API.KEYS.boot)).toBe(false);
  expect(store.get(API.KEYS.state)).toBe('{"dirty":true}');
  void p;
});

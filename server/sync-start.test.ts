// The app's start (app/js/svc/sync.js): a copy of today opens the app without waiting for the PC, the PC is asked in
// the background, and an unchanged day answers 304 to the copy's etag. No copy: the app waits for the PC as before.
import { beforeEach, expect, test } from 'bun:test';

const store = new Map<string, string>();
(globalThis as any).localStorage ??= { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, String(v)), removeItem: (k: string) => store.delete(k) };
const ls = (globalThis as any).localStorage;
const API: any = await import('../app/js/svc/api.js');
const SYNC: any = await import('../app/js/svc/sync.js');
const clock: any = await import('../app/js/svc/clock.js');

clock.setOffset(330);
const TODAY = clock.today();
const boot = (date: string, tasks: any[] = [], etag?: string) => ({ user: { id: 1, role: 'owner' }, today: { date, utcOffsetMinutes: 330, tasks }, week: { days: [] },
  goals: { goals: [] }, projects: [], life: { snapshots: [] }, agents: {}, ...(etag ? { etag } : {}) });
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
let calls: { path: string; inm: string | null }[] = [];
let answer: () => Promise<Response>;
beforeEach(() => {
  for (const k of Object.values(API.KEYS) as string[]) ls.removeItem(k);
  calls = [];
  API.env.replace = () => {};
  API.env.fetch = (url: string, o: any) => { calls.push({ path: String(url).replace(/^.*\/api\/v1/, ''), inm: o?.headers?.['If-None-Match'] ?? null }); return answer(); };
  Object.assign(SYNC.state, { source: 'real', boot: null, data: null, base: null, dirty: false, syncing: false, offline: false });
});

test('a copy of today opens at once; the PC is asked right after and its answer lands', async () => {
  ls.setItem(API.KEYS.boot, JSON.stringify(boot(TODAY, [{ id: 't1', title: 'Old', status: 'todo' }], 'W/"old"')));
  let release!: (r: Response) => void;
  answer = () => new Promise((r) => { release = r; });
  const t0 = performance.now();
  const r = await SYNC.start();
  expect(performance.now() - t0).toBeLessThan(50);
  expect(r.offline).toBe(true);
  expect(SYNC.state.data.tasks.map((t: any) => t.title)).toEqual(['Old']);
  await tick();
  expect(calls).toEqual([{ path: '/bootstrap', inm: 'W/"old"' }]);
  release(Response.json(boot(TODAY, [{ id: 't1', title: 'New', status: 'todo' }], 'W/"new"')));
  await tick();
  expect(SYNC.state.offline).toBe(false);
  expect(SYNC.state.data.tasks.map((t: any) => t.title)).toEqual(['New']);
  expect(JSON.parse(ls.getItem(API.KEYS.boot)).etag).toBe('W/"new"');
});

test('a 304 keeps the copy and counts as the PC answering', async () => {
  const copy = boot(TODAY, [{ id: 't1', title: 'Same', status: 'todo' }], 'W/"same"');
  ls.setItem(API.KEYS.boot, JSON.stringify(copy));
  answer = async () => new Response(null, { status: 304 });
  await SYNC.start();
  await tick();
  expect(calls[0].inm).toBe('W/"same"');
  expect(SYNC.state.offline).toBe(false);
  expect(SYNC.state.data.tasks.map((t: any) => t.title)).toEqual(['Same']);
});

test('without a copy of today the app waits for the PC', async () => {
  ls.setItem(API.KEYS.boot, JSON.stringify(boot('2020-01-01', [], 'W/"stale"')));
  answer = async () => { await tick(60); return Response.json(boot(TODAY, [{ id: 't9', title: 'Fresh', status: 'todo' }], 'W/"fresh"')); };
  const t0 = performance.now();
  const r = await SYNC.start();
  expect(performance.now() - t0).toBeGreaterThanOrEqual(50);
  expect(r.offline).toBe(false);
  expect(SYNC.state.data.tasks.map((t: any) => t.title)).toEqual(['Fresh']);
  expect(calls[0].inm).toBe('W/"stale"');   // an older copy still offers its tag
});

// The v2 app engine (app/js/svc): the core sync (field diff, temp-id rename, refusals, rebase) and the offline store's
// round trip against the real server helper (server/modules/_collection.ts), with fake fetch, storage and an in-memory db.
import { beforeEach, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { collectionDDL, mountCollection } from './modules/_collection';

const ls = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => ls.set(k, String(v)), removeItem: (k: string) => ls.delete(k), key: () => null, length: 0 };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const API: any = await import('../app/js/svc/api.js');
const SYNC: any = await import('../app/js/svc/sync.js');
const STORE: any = await import('../app/js/svc/store.js');
API.env.setTimeout = () => 0;   // no background retries: each test drives the engine itself
API.env.clearTimeout = () => {};
API.env.replace = () => {};
SYNC.setToast(() => {});

// ── core sync ─────────────────────────────────────────────────────────
type Call = { method: string; path: string; body: any; key: string | null };
let calls: Call[] = [];
let reply: (c: Call) => Response;
API.env.fetch = async (url: string, opts: any = {}) => {
  const c = { method: opts.method ?? 'GET', path: new URL(url, 'http://x').pathname.replace('/api/v1', ''), body: opts.body ? JSON.parse(opts.body) : null, key: opts.headers?.['Idempotency-Key'] ?? null };
  calls.push(c);
  return reply(c);
};
const boot = (tasks: any[] = [], goals: any[] = []) => ({ user: { id: 7, role: 'owner' }, today: { date: '2026-10-22', utcOffsetMinutes: 330, tasks }, week: { days: [] }, goals: { goals }, projects: [], life: { snapshots: [] } });
function seed(tasks: any[] = [], goals: any[] = []) {
  calls = [];
  Object.assign(SYNC.state, { source: 'real', boot: boot(tasks, goals), user: { id: 7, role: 'owner' }, dirty: false, syncing: false, fails: 0 });
  SYNC.state.data = SYNC.fresh(SYNC.state.boot);
  SYNC.state.base = SYNC.pickSync(SYNC.state.data);
}
beforeEach(() => { reply = () => Response.json({}); });

test('an edit sends only the fields that changed', async () => {
  seed([{ id: 't1', title: 'Old', status: 'todo', area: 'projects', due: '2026-10-22' }]);
  SYNC.state.data.tasks[0].title = 'New';
  SYNC.state.dirty = true;
  await SYNC.sync();
  expect(calls).toEqual([{ method: 'PATCH', path: '/tasks/t1', body: { title: 'New' }, key: null }]);
  expect(SYNC.state.dirty).toBe(false);
});

test('a new goal and a task on it go up in order; temp ids become the PC\'s, idempotency keys ride along', async () => {
  seed();
  SYNC.state.data.goals.push({ id: 'ng1', title: 'Ship v2', horizon: 'month', status: 'active', start: '2026-10-01' });
  SYNC.state.data.tasks.push({ id: 'nt1', title: 'Write the notes', status: 'todo', goal: 'ng1' });
  SYNC.state.dirty = true;
  reply = (c) => (c.path === '/goals' ? Response.json({ id: 'g9' }, { status: 201 }) : c.path === '/tasks' ? Response.json({ id: 't77' }, { status: 201 }) : Response.json({}));
  await SYNC.sync();
  expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /goals', 'POST /tasks']);
  expect(calls[0].key).toBe('goal:7:ng1');
  expect(calls[1].key).toBe('task:7:nt1');
  expect(calls[1].body.goal).toBe('g9');                 // the task points at the goal's new id
  expect(SYNC.state.data.tasks[0].id).toBe('t77');
  expect(SYNC.state.data.goals[0].id).toBe('g9');
});

test('a refused change is dropped and the PC\'s state taken; a PC error keeps it for a retry', async () => {
  seed([{ id: 't1', title: 'A', status: 'todo' }]);
  SYNC.state.data.tasks[0].status = 'banana';
  SYNC.state.dirty = true;
  reply = (c) => (c.method === 'PATCH' ? Response.json({ error: 'Bad status.' }, { status: 400 }) : Response.json(boot([{ id: 't1', title: 'A', status: 'todo' }])));
  await SYNC.sync();
  expect(SYNC.state.dirty).toBe(false);
  expect(SYNC.state.data.tasks[0].status).toBe('todo');
  seed([{ id: 't1', title: 'A', status: 'todo' }]);
  SYNC.state.data.tasks[0].status = 'done';
  SYNC.state.dirty = true;
  reply = () => Response.json({ error: 'database is locked' }, { status: 500 });
  await SYNC.sync();
  expect(SYNC.state.dirty).toBe(true);
  expect(API.connection().status).toBe('error');
  API.clearError();
});

test('waiting edits replay over fresh data: the phone\'s touched field wins, the PC wins the rest', () => {
  const base = SYNC.pickSync(SYNC.fresh(boot([{ id: 't1', title: 'A', status: 'todo', notes: null }])));
  const local = SYNC.fresh(boot([{ id: 't1', title: 'A', status: 'done', notes: null }]));
  const next = SYNC.fresh(boot([{ id: 't1', title: 'A (renamed on the PC)', status: 'todo', notes: 'from the PC' }]));
  const r = SYNC.rebaseOnto(next, local, base);
  expect(r.pending).toBe(true);
  expect(r.data.tasks[0]).toMatchObject({ title: 'A (renamed on the PC)', status: 'done', notes: 'from the PC' });
});

// ── the offline store against the real server helper ──────────────────
function server() {
  const db = new Database(':memory:');
  db.exec(collectionDDL({ table: 'money_expenses', columns: { amount: 'real', note: 'text' } }));
  const col = mountCollection({ table: 'money_expenses', columns: { amount: 'real', note: 'text' } });
  let up = true, lose = false;
  API.env.fetch = async (url: string, opts: any = {}) => {
    if (!up) throw new TypeError('Failed to fetch');
    const u = new URL(url, 'http://127.0.0.1');
    const path = u.pathname.replace('/api/v1/mod/money', '');
    const ctx: any = { method: opts.method ?? 'GET', path, url: u, db: () => db, body: async () => (opts.body ? JSON.parse(opts.body) : null), json: (d: unknown, s = 200) => Response.json(d, { status: s }), fail: (s: number, m: string) => Response.json({ error: m }, { status: s }) };
    const r = (await col.handle(ctx, '/expenses')) ?? Response.json({ error: 'No such endpoint.' }, { status: 404 });
    if (lose) { lose = false; throw new TypeError('Failed to fetch'); }   // the PC applied it, the answer never came back
    return r;
  };
  return { db, down: () => { up = false; }, upAgain: () => { up = true; }, loseNextReply: () => { lose = true; }, count: () => (db.query('SELECT count(*) n FROM money_expenses').get() as any).n };
}
const col = (name: string) => STORE.collection(name, { endpoint: '/api/v1/mod/money/expenses', interval: 0 });

test('an expense added offline waits in the outbox, then reaches the PC once', async () => {
  const S = server();
  const c = col('test/expenses-1');
  await c.ready;
  S.down();
  const doc = c.add({ amount: 40, note: 'Chai' });
  expect(c.list().map((d: any) => d.id)).toEqual([doc.id]);  // on screen at once
  await c.flush();
  expect(c.pending()).toBe(1);
  S.upAgain();
  S.loseNextReply();                                          // first try lands but the reply is lost
  await c.flush();
  expect(c.pending()).toBe(1);
  await c.flush();                                            // sent again: still one record
  expect(c.pending()).toBe(0);
  expect(S.count()).toBe(1);
});

test('a newer write on the PC wins over an older copy on the phone, and deletes travel as tombstones', async () => {
  const S = server();
  const c = col('test/expenses-2');
  await c.ready;
  const d = c.add({ amount: 210, note: 'Uber' });
  await c.flush();
  await c.refresh();
  // the PC changes it later (another device, an App Intent)
  S.db.query("UPDATE money_expenses SET note = 'Uber to City College', updated_at = '2999-01-01T00:00:00.000Z', rev = rev + 10 WHERE id = ?").run(d.id);
  await c.refresh();
  expect(c.get(d.id).note).toBe('Uber to City College');
  c.remove(d.id);
  expect(c.get(d.id)).toBeNull();
  await c.flush();
  expect((S.db.query('SELECT deleted_at FROM money_expenses WHERE id = ?').get(d.id) as any).deleted_at).toBeTruthy();
  await c.refresh();
  expect(c.list({ deleted: true }).some((x: any) => x.id === d.id)).toBe(false);
});

test('a write the PC refuses is dropped from the outbox and reported', async () => {
  server();
  const c = STORE.collection('test/expenses-3', { endpoint: '/api/v1/mod/money/expenses', interval: 0 });
  await c.ready;
  const errors: any[] = [];
  c.on('error', (e: any) => errors.push(e));
  const d = c.put({ id: 'bad id with spaces', amount: 1 });
  await c.flush();
  expect(c.pending()).toBe(0);
  expect(errors[0]).toMatchObject({ id: d.id, status: 400 });
  expect(c.errors().get(d.id)).toBe('Bad id.');
});

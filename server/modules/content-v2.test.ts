// Content OS v2 on the phone server: the ops outbox (each write applied once by its id, refusals recorded, slow ones in the
// background), rewrites with revert, dry-run approvals and their undo, settings and rule switches, signed media links
// with Range, uploads filed under the script they were recorded for, and the agent's tools. The v2 agentos CLI runs from
// source on throwaway databases; the model is a fake (no subscription is spent).
import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { content } from './content';
import type { ModCtx } from './types';

const dir = mkdtempSync(join(tmpdir(), 'aos-content-v2-'));
const dbPath = join(dir, 'agentos.db'), contentDbPath = join(dir, 'content.db');
const SRC = process.env.AGENTOS_SRC || join(import.meta.dir, '..', '..', 'cli', 'src', 'agentos.ts');
const env = { ...process.env, AGENTOS_DB: dbPath, AGENTOS_CONTENT_DB: contentDbPath, AGENTOS_EVENTS: join(dir, 'none.json') };
afterAll(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
async function cli(args: string[]) {
  const p = Bun.spawn([process.execPath, SRC, ...args, '--json'], { env, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  if (p.exitCode) throw Object.assign(new Error((() => { try { return JSON.parse(out).error; } catch { return out || err; } })()), { status: p.exitCode === 2 ? 400 : 502 });
  return JSON.parse(out);
}
let aiCalls = 0;
function ctx(path: string, method = 'GET', body: any = {}, opts: { bytes?: Uint8Array; headers?: Record<string, string>; owner?: boolean } = {}): ModCtx {
  const url = new URL(`http://local/api/v1/mod/content${path}`);
  const owner = opts.owner ?? true;
  return {
    req: new Request(url, { method, headers: opts.headers, ...(opts.bytes ? { body: opts.bytes } : {}) }), url, method, path: url.pathname.slice('/api/v1/mod/content'.length),
    user: owner ? { id: 1, role: 'owner' } as any : null, owner, dbPath, contentDbPath, dataDir: join(dir, 'data'), store: {} as any, db: () => { throw new Error('unexpected hub access'); },
    agentos: cli, conf: (_k, d) => d,
    ai: { claude: async ({ prompt }: any) => { aiCalls++; return { out: { hook: 'Lecture mein hoon, code ship ho raha hai.', body: `Short version. (${String(prompt).slice(0, 9)})`, cta: 'Follow karo.' }, ms: 1 }; } } as any,
    codex: async () => { throw new Error('no agents in tests'); }, wyn: null, push: async () => {},
    body: async () => body, json: (j, status = 200) => Response.json(j, { status }), fail: (status, error) => Response.json({ error }, { status }), log: () => {},
  };
}
async function call(path: string, method = 'GET', body?: any, opts?: Parameters<typeof ctx>[3]) {
  const r = await content.handle(ctx(path, method, body, opts));
  if (!r) throw new Error(`missing route ${method} ${path}`);
  const type = r.headers.get('content-type') ?? '';
  return { status: r.status, data: type.includes('json') ? await r.json() as any : null, res: r };
}
const op = (id: string, kind: string, fields: any = {}) => call(`/ops/${id}`, 'PUT', { id, kind, ...fields, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
const waitOp = async (id: string) => { for (let i = 0; i < 100; i++) { const r = await call(`/ops/${id}`); if (r.data.item?.state !== 'running') return r.data.item; await Bun.sleep(100); } throw new Error(`op ${id} still running`); };

test('setup: skip the first-start import on the temp DBs', async () => {
  await cli(['content', 'settings', 'set', 'import.auto', 'fixture']);
  await cli(['content', 'settings', 'set', 'paths.content_os', join(dir, 'no-content-os')]);
  expect((await call('/overview')).status).toBe(200);
}, 60_000);

test('a verdict op is applied once by its id; a refusal is recorded and answers the same on a resend', async () => {
  const idea = (await cli(['content', 'capture', 'Claude Code modding is wild'])).idea.id;
  const first = await op('op_v1', 'verdict', { idea, v: 'kill', why: 'done before' });
  expect(first.status).toBe(200);
  expect(first.data.item.state).toBe('done');
  expect(first.data.item.applied_at).toBeTruthy();
  expect(first.data.item.result.status).toBe('dropped');
  const again = await op('op_v1', 'verdict', { idea, v: 'kill', why: 'done before' });
  expect(again.data.item.applied_at).toBe(first.data.item.applied_at);
  expect((await cli(['content', 'learnings'])).verdicts).toHaveLength(1);
  const bad = await op('op_v2', 'verdict', { idea: 'c99999', v: 'keep' });
  expect(bad.status).toBe(400);
  const badAgain = await op('op_v2', 'verdict', { idea: 'c99999', v: 'keep' });
  expect(badAgain.status).toBe(200);
  expect(badAgain.data.item.state).toBe('refused');
  expect((await op('op_v3', 'nonsense')).status).toBe(400);
  const list = await call('/ops');
  expect(list.data.items.map((x: any) => x.id)).toEqual(expect.arrayContaining(['op_v1', 'op_v2']));
  expect((await call('/ops/op_v1', 'DELETE')).status).toBe(405);
  // undo is a new op: restore puts it back in the inbox and removes the learning
  await op('op_v4', 'verdict', { idea, v: 'restore', was: 'inbox', undo: 'op_v1' });
  expect((await cli(['content', 'show', idea])).idea.status).toBe('inbox');
  expect((await cli(['content', 'learnings'])).verdicts).toHaveLength(0);
}, 60_000);

test('a capture op files one idea however often it is sent; the deck and learnings answer', async () => {
  await op('op_c1', 'capture', { text: 'Scarf fold hack', channel: '@example_creator' });
  await op('op_c1', 'capture', { text: 'Scarf fold hack', channel: '@example_creator' });
  const ideas = (await cli(['content', 'ideas', '--status', 'all'])).ideas.filter((x: any) => x.title === 'Scarf fold hack');
  expect(ideas).toHaveLength(1);
  expect(ideas[0].channel).toBe('example_creator');
  const deck = await call('/deck');
  expect(deck.data.ideas.some((x: any) => x.title === 'Scarf fold hack')).toBe(true);
  expect(Array.isArray(deck.data.ideas[0].why)).toBe(true);
  expect((await call('/learnings')).data.counts).toBeTruthy();
}, 60_000);

test('a rewrite runs in the background, keeps the version before it, and a revert op brings it back', async () => {
  const idea = (await cli(['content', 'capture', 'Agents in class'])).idea.id;
  const md = join(dir, 's.md'), tp = join(dir, 's.txt');
  writeFileSync(md, '# Agents in class\n\n## Spoken script\n\nMain lecture mein hoon.\n\nAgents kaam kar rahe hain.\n\nFollow karo.\n');
  writeFileSync(tp, 'Main lecture mein hoon.\n\nAgents kaam kar rahe hain.\n\nFollow karo.\n');
  const sid = (await cli(['content', 'script', 'add', '--idea', idea, '--date', 'today', '--title', 'Agents in class', '--body-file', md, '--teleprompter-file', tp])).script.id;
  const calls = aiCalls;
  const r = await op('op_rw1', 'rewrite', { script: sid, rewrite: 'shorter' });
  expect(r.data.item.state).toBe('running');
  const resend = await op('op_rw1', 'rewrite', { script: sid, rewrite: 'shorter' });
  expect(resend.data.item.state).toBe('running');
  const done = await waitOp('op_rw1');
  expect(done.state).toBe('done');
  expect(done.result.label).toBe('Shorter');
  expect(aiCalls).toBe(calls + 1);
  const s = (await call(`/scripts/${sid}`)).data.script;
  expect(s.teleprompter).toContain('code ship ho raha hai');
  expect(s.previous.teleprompter).toContain('Agents kaam kar rahe hain');
  expect((await op('op_rw2', 'rewrite', { script: sid, rewrite: 'louder' })).data.item.state).toBe('running');
  expect((await waitOp('op_rw2')).state).toBe('refused');
  await op('op_rv1', 'revert', { script: sid });
  expect((await call(`/scripts/${sid}`)).data.script.teleprompter).toContain('Agents kaam kar rahe hain');
  // an upload recorded for this script lands under it and marks it shot; a second start with the same id resumes
  const bytes = new TextEncoder().encode('0123456789abcdef');
  const start = await call('/uploads', 'POST', { id: 'utest0001', name: 'R1 take 1.mp4', size: bytes.length, script: sid, take: 1 });
  expect(start.status).toBe(201);
  expect((await call('/uploads', 'POST', { id: 'utest0001', name: 'R1 take 1.mp4', size: bytes.length })).data.id).toBe('utest0001');
  const put = await call('/uploads/utest0001?offset=0', 'PUT', undefined, { bytes });
  expect(put.data.done).toBe(true);
  const take = (await cli(['content', 'show', put.data.take])).take;
  expect(take.script).toBe(sid);
  expect(take.chosen).toBe(true);
  expect((await cli(['content', 'show', sid])).script.status).toBe('shot');
  // the take plays through a signed link
  const link = await call(`/takes/${put.data.take}/media`);
  expect(link.data.url).toMatch(/^\/api\/v1\/mod\/content\/media\//);
}, 90_000);

test('approve is a dry run with CONTENT_POST off; unapprove takes it back; settings and rule switches are ops too', async () => {
  const render = join(dir, 'cut.mp4');
  writeFileSync(render, new Uint8Array(4096).map((_, i) => i % 251));
  const e = (await cli(['content', 'edit', 'add', '--title', 'A cut', '--render', render])).edit.id;
  const a = await op('op_a1', 'approve', { edit: e });
  expect(a.data.item.result.dryRun).toBe(true);
  expect((await cli(['content', 'show', e])).edit.status).toBe('approved');
  await op('op_a2', 'unapprove', { edit: e });
  expect((await cli(['content', 'show', e])).edit.status).toBe('review');
  await op('op_s1', 'settings', { values: { 'slots.northwindstudio': '12:30,19:00', shoot_at: '18:30' } });
  const st = await cli(['content', 'settings']);
  expect([st.slots.northwindstudio, st.shoot_at]).toEqual(['12:30,19:00', '18:30']);
  expect((await op('op_s2', 'settings', { values: { 'paths.content_os': 'C:\\' } })).status).toBe(400);
  await op('op_n1', 'note', { edit: e, text: 'Bigger captions' });
  expect((await cli(['content', 'show', e])).edit.status).toBe('redo');
  // media: a signed link, served with Range to anyone holding it, refused when tampered with
  const link = (await call(`/edits/${e}/media`)).data;
  expect(link.type).toBe('video/mp4');
  const path = link.url.slice('/api/v1/mod/content'.length);
  const part = await call(path, 'GET', undefined, { owner: false, headers: { range: 'bytes=0-9' } });
  expect(part.status).toBe(206);
  expect(part.res.headers.get('content-range')).toBe('bytes 0-9/4096');
  expect((await part.res.arrayBuffer()).byteLength).toBe(10);
  const whole = await call(path, 'GET', undefined, { owner: false });
  expect(whole.status).toBe(200);
  expect((await whole.res.arrayBuffer()).byteLength).toBe(4096);
  expect((await call(`${path.slice(0, -3)}xyz`, 'GET', undefined, { owner: false })).status).toBe(403);
  expect((await call('/overview', 'GET', undefined, { owner: false })).status).toBe(403);
  expect((await call('/edits/e999/media')).status).toBe(400);
}, 90_000);

test('the agent has a tool for every meaningful action, with ask-first on verdicts, approvals and settings', async () => {
  const tools = content.tools!;
  const names = tools.map((t) => t.name);
  expect(new Set(names).size).toBe(names.length);
  for (const t of tools) { expect(t.name).toMatch(/^content_[a-z_]+$/); expect(t.description.length).toBeGreaterThan(20); expect((t.input as any).type).toBe('object'); }
  expect(tools.filter((t) => !t.auto).map((t) => t.name).sort()).toEqual(['content_approve_edit', 'content_set_setting', 'content_verdict']);
  const filed: any = await tools.find((t) => t.name === 'content_file_idea')!.run(ctx('/'), { text: 'Reel idea from the agent' });
  expect(filed.ok).toBe(true);
  expect(filed.idea).toMatch(/^c\d+$/);
  const ops = (await call('/ops')).data.items;
  expect(ops.find((x: any) => x.id === filed.op).source).toBe('agent');
  const o: any = await tools.find((t) => t.name === 'content_overview')!.run(ctx('/'), {});
  expect(o.counts.ideas).toBeTruthy();
}, 60_000);

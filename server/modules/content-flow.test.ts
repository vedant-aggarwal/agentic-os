import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { content } from './content';
import type { ModCtx } from './types';

const dir = mkdtempSync(join(tmpdir(), 'aos-content-flow-'));
const dbPath = join(dir, 'agentos.db'), contentDbPath = join(dir, 'content.db');
const bin = process.env.AGENTOS_BIN || 'agentos';
const env = { ...process.env, AGENTOS_DB: dbPath, AGENTOS_CONTENT_DB: contentDbPath, AGENTOS_EVENTS: join(dir, 'none.json') };
async function cli(args: string[]) {
  const p = Bun.spawn([bin, ...args, '--json'], { env, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  if (p.exitCode) throw new Error(out || err);
  return JSON.parse(out);
}
let failScript = false, modelCalls = 0, key = '';
const pushes: string[] = [];
function ctx(path: string, method = 'GET', body: any = {}, bytes?: Uint8Array): ModCtx {
  const url = new URL(`http://local/api/v1/mod/content${path}`);
  return {
    req: new Request(url, { method, ...(bytes ? { body: bytes } : {}) }), url, method, path: url.pathname.slice('/api/v1/mod/content'.length),
    user: { id: 1, role: 'owner' } as any, owner: true, dbPath, contentDbPath, dataDir: join(dir, 'data'), store: {} as any, db: () => { throw new Error('unexpected direct hub access'); },
    agentos: cli, conf: (k, d) => k === 'OPENAI_API_KEY' ? key : d,
    ai: { claude: async () => { modelCalls++; if (failScript) throw new Error('synthetic provider interruption'); return { out: { title: 'Recording check', hook: 'A recording check.', body: 'This verifies the saved pack.', cta: 'Keep the evidence.', seconds: 10 }, ms: 1 }; } } as any,
    codex: async () => { throw new Error('no agents in tests'); }, wyn: null, push: async title => { pushes.push(title); },
    body: async () => body, json: (j, status = 200) => Response.json(j, { status }), fail: (status, error) => Response.json({ error }, { status }), log: () => {},
  };
}
async function call(path: string, method = 'GET', body?: any, bytes?: Uint8Array) {
  const r = await content.handle(ctx(path, method, body, bytes));
  if (!r) throw new Error('missing route');
  return { status: r.status, data: await r.json() as any };
}

test('a partial nightly plan fails visibly, then resumes into one pack and one shoot task', async () => {
  await cli(['content', 'settings', 'set', 'import.auto', 'fixture']);
  await cli(['content', 'capture', 'Recording pipeline fixture']);
  failScript = true;
  const failed = await call('/plan', 'POST');
  expect(failed.status).toBe(502);
  expect(failed.data.error).toContain('Pack incomplete');
  const job = content.jobs!.find(j => j.id === 'content-plan')!;
  await expect(job.run(ctx('/'))).rejects.toThrow('Pack incomplete');
  expect(pushes).toHaveLength(0);
  failScript = false;
  await job.run(ctx('/'));
  const actualDate = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const pack = (await call(`/pack?date=${actualDate}`)).data;
  expect(pack.scripts).toHaveLength(1);
  expect(pack.pending).toHaveLength(0);
  expect(pack.task).toMatch(/^t\d+$/);
  expect(pack.scripts[0].teleprompter).toContain('This verifies the saved pack.');
  const calls = modelCalls;
  await job.run(ctx('/'));
  expect(modelCalls).toBe(calls);
  const tasks = await cli(['list', '--area', 'content']);
  expect(JSON.stringify(tasks).match(/Shoot: 1 reel/g)?.length).toBe(1);
}, 20000);

test('a saved reference with a failed transcript and an older caption card can recover', async () => {
  key = 'sk-test-transcription-fixture-123456';
  const media = join(dir, 'reference.mp4');
  const ffmpeg = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', media], { stdout: 'ignore', stderr: 'pipe' });
  await ffmpeg.exited;
  expect(ffmpeg.exitCode).toBe(0);
  const idea = await cli(['content', 'capture', 'Saved reference fixture', '--link', 'https://example.invalid/fixture-reel']);
  const ref = idea.reference.id;
  const card = join(dir, 'caption-card.json');
  writeFileSync(card, JSON.stringify({ basis: 'caption', summary: 'fixture caption only' }));
  await cli(['content', 'reference', ref, '--media', media, '--analysis-file', card, '--transcript-status', 'failed', '--error', '2026-01-01T00:00:00.000Z synthetic provider interruption']);
  const nativeFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async (url: any, options: any) => {
    if (url !== 'https://api.openai.com/v1/audio/transcriptions') return nativeFetch(url, options);
    requests++;
    return Response.json({ text: 'A recovered reference recording.' });
  }) as typeof fetch;
  try {
    await call('/sweep?limit=1', 'POST');
    const saved = (await cli(['content', 'show', ref])).reference;
    expect(saved.transcript).toBe('done');
    expect(saved.analysis.basis).toBe('transcript');
    expect(requests).toBe(1);
  } finally { globalThis.fetch = nativeFetch; key = ''; }
}, 20000);

test('upload without a key resumes transcription and matching after configuration is repaired', async () => {
  const media = join(dir, 'take.mp4');
  const p = Bun.spawn(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', media], { stdout: 'ignore', stderr: 'pipe' });
  await p.exited;
  expect(p.exitCode).toBe(0);
  const bytes = new Uint8Array(readFileSync(media));
  const actualDate = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const up = await call('/uploads', 'POST', { name: 'take.mp4', size: bytes.byteLength, date: actualDate });
  const result = await call(`/uploads/${up.data.id}?offset=0`, 'PUT', {}, bytes);
  expect(result.data.done).toBe(true);
  await Bun.sleep(50);
  const takeId = result.data.take;
  expect((await cli(['content', 'show', takeId])).take.transcript).toBe('pending');
  const nativeFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async (url: any, options: any) => {
    if (url !== 'https://api.openai.com/v1/audio/transcriptions') return nativeFetch(url, options);
    requests++;
    expect(options.body.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(options.body.get('file').size).toBeGreaterThan(100);
    return Response.json({ text: 'R1. A recording check. This verifies the saved pack.' });
  }) as typeof fetch;
  key = 'sk-test-transcription-fixture-123456';
  try {
    const sweep = await call('/sweep?limit=1', 'POST');
    expect(sweep.status).toBe(200);
    const take = (await cli(['content', 'show', takeId])).take;
    expect(take.transcript).toBe('done');
    expect(take.script).toMatch(/^s\d+$/);
    expect(take.match.how).toBe('take code');
    expect(take.chosen).toBe(true);
    expect(requests).toBe(1);
    await call('/sweep?limit=1', 'POST');
    expect(requests).toBe(1);
  } finally { globalThis.fetch = nativeFetch; }
}, 20000);

// finish { async: true }: the receipt comes at once ("transcribing"), the words through GET /voice/:id?wait=.
// Without the flag (installed app builds, the keyboard) finish still waits for the words.
// Hermetic: real ffmpeg on a generated tone, a slow fake Codex, no Hinglish rewrite.
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openVoice } from './voice';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function wav(seconds = 1) {
  const n = 16000 * seconds, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 16000) * 8000), 44 + i * 2);
  return b;
}
async function fixture(ms = 600) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-voice-async-')); dirs.push(dir);
  let calls = 0;
  const voice = openVoice({ dataDir: dir, openaiKey: () => '', provider: () => 'codex', romanize: null,
    codex: async () => { calls++; await Bun.sleep(ms); return 'Kal Dad ko call karna hai.'; } });
  const r = voice.create(1, { mime: 'audio/wav', source: 'capture' });
  await voice.putChunk(1, r.id, 0, new Request('http://localhost', { method: 'PUT', body: wav() }));
  return { voice, id: r.id, calls: () => calls };
}

test('async finish answers at once with a complete receipt, and the words arrive through getWait', async () => {
  const { voice, id, calls } = await fixture();
  const t0 = performance.now();
  const out = await voice.finish(1, id, { chunks: 1, durationMs: 1000, async: true });
  const receiptMs = performance.now() - t0;
  expect(out).toMatchObject({ id, status: 'transcribing', chunks: 1 });
  expect(out.bytes).toBeGreaterThan(30000);
  expect(receiptMs).toBeLessThan(400);
  // the same finish again (its answer was lost): the receipt again, not a 409, and no second transcription
  expect(await voice.finish(1, id, { chunks: 1, async: true })).toMatchObject({ status: 'transcribing' });
  expect(voice.get(1, id).status).toBe('transcribing');
  const done = await voice.getWait(1, id, 20);
  expect(done).toMatchObject({ status: 'done', text: 'Kal Dad ko call karna hai.', provider: 'codex' });
  expect(calls()).toBe(1);
  console.log(`[voice-async] receipt in ${Math.round(receiptMs)} ms; words after ${Math.round(performance.now() - t0)} ms`);
});

test('finish without async still waits for the words (older app builds and the keyboard)', async () => {
  const { voice, id } = await fixture(300);
  const t0 = performance.now();
  const out = await voice.finish(1, id, { chunks: 1 });
  expect(out).toMatchObject({ status: 'done', text: 'Kal Dad ko call karna hai.' });
  expect(performance.now() - t0).toBeGreaterThanOrEqual(300);
});

test('getWait returns at once for a recording that is already written down', async () => {
  const { voice, id } = await fixture(50);
  await voice.finish(1, id, { chunks: 1 });
  const t0 = performance.now();
  expect((await voice.getWait(1, id, 25)).status).toBe('done');
  expect(performance.now() - t0).toBeLessThan(200);
});

test('async finish still refuses an incomplete take (missing chunks keep the audio on the phone)', async () => {
  const { voice, id } = await fixture();
  await expect(voice.finish(1, id, { chunks: 3, async: true })).rejects.toThrow('Missing chunks');
  expect(voice.get(1, id).status).toBe('recording');
});

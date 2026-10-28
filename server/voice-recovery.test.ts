import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openVoice } from './voice';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'aos-voice-recovery-')); dirs.push(dir);
  return openVoice({ dataDir: dir, openaiKey: () => '' });
}
test('an empty orphan gets a terminal receipt so an installed phone can continue its upload queue', async () => {
  const voice = fixture();
  const r = await voice.finish(1, 'v_missing001', { chunks: 0, durationMs: 1200 });
  expect(r).toMatchObject({ id: 'v_missing001', status: 'failed', chunks: 0, bytes: 0 });
  expect(r.error).toContain('No audio');
});
test('an empty existing recording also gets a terminal receipt', async () => {
  const voice = fixture(); const r = voice.create(1, { mime: 'audio/mp4' });
  expect(await voice.finish(1, r.id, { chunks: 0 })).toMatchObject({ status: 'failed', chunks: 0, bytes: 0 });
});
test('chunk zero recovers a missing PC record under the same user and id without losing audio', async () => {
  const voice = fixture();
  await voice.putChunk(1, 'v_missing002', 0, new Request('http://localhost', {
    method: 'PUT', headers: { 'Content-Type': 'audio/mp4' }, body: new Uint8Array([1, 2, 3, 4]),
  }));
  expect(voice.get(1, 'v_missing002')).toMatchObject({ id: 'v_missing002', mime: 'audio/mp4', bytes: 4, chunks: 1 });
  expect(new Uint8Array(await voice.audio(1, 'v_missing002').arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect(() => voice.get(2, 'v_missing002')).toThrow('No such recording');
});
test('a nonempty orphan cannot receive a false complete receipt', async () => {
  const voice = fixture();
  await expect(voice.finish(1, 'v_missing003', { chunks: 2 })).rejects.toThrow('No such recording');
});

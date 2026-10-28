import { afterEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openVoice } from './voice';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('audio conversion yields to the event loop so other phone requests can be answered', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos-voice-responsive-'));
  const path = join(dir, 'audio.wav');
  writeFileSync(path, new Uint8Array([1, 2, 3]));
  // Hold the converter for 100 ms. Both paths simulate an unreadable file, so the
  // normal original-audio fallback runs, without a paid API or a live recording.
  const sync = spyOn(Bun, 'spawnSync').mockImplementation(() => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    return { exitCode: 1, stderr: Buffer.from('test conversion failure') } as any;
  });
  const spawn = spyOn(Bun, 'spawn').mockImplementation(() => ({
    exited: Bun.sleep(100).then(() => 1),
    stderr: new Response('test conversion failure').body,
  }) as any);
  let heartbeat = false, responsiveAtProvider = false;
  const timer = setTimeout(() => { heartbeat = true; }, 0);
  globalThis.fetch = (async () => { responsiveAtProvider = heartbeat; return Response.json({ text: 'Recorded words' }); }) as any;
  try {
    const voice = openVoice({ dataDir: dir, openaiKey: () => 'test-only-key', provider: () => 'openai' });
    expect(await voice.transcribeFile(path)).toBe('Recorded words');
    expect(responsiveAtProvider).toBe(true);
  } finally {
    clearTimeout(timer); sync.mockRestore(); spawn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

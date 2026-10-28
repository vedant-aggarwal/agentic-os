import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('planning and concurrent content reads can open the same databases', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'content-concurrent-'));
  const env = { ...process.env, AGENTOS_DB: join(dir, 'agentos.db'), AGENTOS_CONTENT_DB: join(dir, 'content.db'), AGENTOS_EVENTS: join(dir, 'none.json') };
  async function cli(args: string[]) {
    const p = Bun.spawn([process.execPath, join(import.meta.dir, '..', 'agentos.ts'), ...args, '--json'], { env, stdout: 'pipe', stderr: 'pipe' });
    const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
    await p.exited;
    return { code: p.exitCode, out, err };
  }
  expect((await cli(['content', 'capture', 'Synthetic planning fixture'])).code).toBe(0);
  for (let batch = 0; batch < 3; batch++) {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => cli(i === 0 ? ['content', 'plan', '--date', `2026-11-0${batch + 1}`] : ['content', 'overview'])));
    expect(results.filter(r => r.code !== 0).map(r => r.err || r.out)).toEqual([]);
  }
}, 30000);

import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('launcher passes the explicit data folder to the watcher, including spaces', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ribbon-launch-'));
  const data = join(dir, 'phone data');
  mkdirSync(data);
  writeFileSync(join(data, 'agent.token'), 'test-token');
  const probe = join(dir, 'probe.ps1');
  writeFileSync(probe, `param([string]$Launcher, [string]$Data)
function Get-CimInstance { @() }
function Start-Process {
  param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, $RedirectStandardOutput, $RedirectStandardError)
  [ordered]@{ data = $env:DATA_DIR; hidden = ($WindowStyle -eq 'Hidden'); logs = $RedirectStandardOutput } | ConvertTo-Json -Compress
}
Remove-Item Env:DATA_DIR -ErrorAction SilentlyContinue
& $Launcher -DataDir $Data
`);
  const p = Bun.spawn(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', probe, '-Launcher', join(import.meta.dir, 'ribbon-watch.ps1'), '-Data', data], { stdout: 'pipe', stderr: 'pipe' });
  const output = await new Response(p.stdout).text();
  const error = await new Response(p.stderr).text();
  await p.exited;
  const line = output.split(/\r?\n/).find(s => s.startsWith('{'));
  expect(line, error).toBeDefined();
  const launched = JSON.parse(line!);
  expect(launched.data).toBe(data);
  expect(launched.hidden).toBe(true);
  expect(launched.logs).toBe(join(data, 'logs', 'ribbon-watch.out.log'));
}, 10000);

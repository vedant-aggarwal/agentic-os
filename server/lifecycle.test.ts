import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('overlapping restarts launch only one server', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'aos restart '));
  const probe = join(dir,'probe.ps1'), marker=join(dir,'launches.txt');
  writeFileSync(probe, `param($Script,$Data,$Marker)
function Get-NetTCPConnection { @() }
function Invoke-CimMethod { param($ClassName,$MethodName,$Arguments)
  [IO.File]::AppendAllText($Marker, "launch\n")
  [Threading.Thread]::Sleep(1500)
}
function Start-Sleep {}
function Invoke-WebRequest { [pscustomobject]@{StatusCode=200;Content='{"ok":true}'} }
& $Script -DataDir $Data -Port 59119
`);
  const start=()=>Bun.spawn(['powershell.exe','-NoProfile','-NonInteractive','-File',probe,'-Script',join(import.meta.dir,'restart.ps1'),'-Data',dir,'-Marker',marker],{stdout:'pipe',stderr:'pipe'});
  const first=start();await Bun.sleep(200);const second=start();
  const results=await Promise.all([first,second].map(async p=>{const out=await new Response(p.stdout).text();const err=await new Response(p.stderr).text();return {code:await p.exited,out,err}}));
  expect(results.every(r=>r.code===0),JSON.stringify(results)).toBe(true);
  expect(readFileSync(marker,'utf8').trim().split(/\r?\n/)).toHaveLength(1);
},15000);

// These run the real supervisor against temporary config and a real HTTP listener.
// A listening socket alone must never make an unavailable app look healthy.
async function supervisorProbe(port?: number, explicit = false) {
  const dir = mkdtempSync(join(tmpdir(), 'aos health '));
  copyFileSync(join(import.meta.dir, 'supervise.ps1'), join(dir, 'supervise.ps1'));
  if (existsSync(join(import.meta.dir, 'runtime.ps1'))) copyFileSync(join(import.meta.dir, 'runtime.ps1'), join(dir, 'runtime.ps1'));
  const marker = join(dir, 'called.json');
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ PORT: String(port ?? 59121) }));
  writeFileSync(join(dir, 'restart.ps1'), `param([string]$DataDir,[int]$Port)
@{data=$DataDir;port=$Port}|ConvertTo-Json -Compress|Set-Content -LiteralPath '${marker.replaceAll("'", "''")}'
`);
  const p = Bun.spawn(['powershell.exe', '-NoProfile', '-NonInteractive', '-File', join(dir, 'supervise.ps1'), '-DataDir', dir, ...(explicit ? ['-Port', String(port)] : []), '-Once'], { stdout: 'pipe', stderr: 'pipe' });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  expect(code, out + err).toBe(0);
  expect(existsSync(marker), out + err).toBe(true);
  return JSON.parse(readFileSync(marker, 'utf8').replace(/^\uFEFF/, ''));
}

test('supervisor recovers on the configured port instead of the obsolete default', async () => {
  expect((await supervisorProbe()).port).toBe(59121);
}, 15000);

test('supervisor detects an HTTP failure even when the port is listening', async () => {
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('unavailable', { status: 503 }) });
  try { expect((await supervisorProbe(server.port, true)).port).toBe(server.port); }
  finally { server.stop(true); }
}, 15000);

test('supervisor uses the existing data folder when recovering a missing listener', async () => {
  const dir=mkdtempSync(join(tmpdir(),'aos supervisor '));
  const script=join(dir,'supervise.ps1'), marker=join(dir,'called.json');
  expect(existsSync(join(import.meta.dir,'supervise.ps1'))).toBe(true);
  copyFileSync(join(import.meta.dir,'supervise.ps1'),script);
  copyFileSync(join(import.meta.dir,'runtime.ps1'),join(dir,'runtime.ps1'));
  writeFileSync(join(dir,'restart.ps1'),`param([string]$DataDir,[int]$Port)
@{data=$DataDir;port=$Port}|ConvertTo-Json -Compress|Set-Content -LiteralPath '${marker.replaceAll("'","''")}'
`);
  const p=Bun.spawn(['powershell.exe','-NoProfile','-NonInteractive','-File',script,'-DataDir',dir,'-Port','59120','-Once'],{stdout:'pipe',stderr:'pipe'});
  const err=await new Response(p.stderr).text();await p.exited;
  expect(p.exitCode,err).toBe(0);
  expect(JSON.parse(readFileSync(marker,'utf8').replace(/^\uFEFF/,''))).toEqual({data:dir,port:59120});
},15000);

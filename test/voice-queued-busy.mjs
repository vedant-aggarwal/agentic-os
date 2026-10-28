// A take the PC hasn't confirmed after 25 s goes to the queue and stops holding its field (the + sheet's Save button
// keyed off busy() and stayed disabled for good while Enter still saved). The queued text still lands when it arrives.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Playwright: the installed `playwright-core` package, or PLAYWRIGHT_CORE=<path to playwright-core/index.mjs>.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : 'playwright-core');
let mode = 'down';
const srv = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/') {
    res.setHeader('content-type', 'text/html');
    return res.end(`<textarea id="target"></textarea><script>
      window.AOS={esc:s=>s,toast:()=>{},haptic:()=>{},fetch:(p,o)=>fetch('/api'+p,o),api:async(p,o)=>{const r=await fetch('/api'+p,o);const j=await r.json();if(!r.ok)throw Object.assign(new Error(j.error),{status:r.status});return j}};
      </script><script type="module">import * as V from '/recorder.js';window.V=V;</script>`);
  }
  if (req.url === '/recorder.js') { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(path.join(root, 'app/work/recorder.js'))); }
  if (req.url === '/api/voice') return res.end(JSON.stringify({ recording: { id: 'v_q1' } }));
  if (/\/chunk\/\d+$/.test(req.url)) { let n = 0; for await (const p of req) n += p.length; return res.end(JSON.stringify({ ok: true, bytes: n })); }
  if (req.url.endsWith('/finish')) {
    if (mode === 'down') { res.statusCode = 502; return res.end(JSON.stringify({ error: 'PC unreachable' })); }
    const body = JSON.parse(await new Promise((r) => { let s = ''; req.on('data', (d) => (s += d)); req.on('end', () => r(s)); }));
    return res.end(JSON.stringify({ recording: { id: 'v_q1', status: 'done', chunks: body.chunks, bytes: 1e9, text: 'Queued words' } }));
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
let failed = false;
try {
  await page.clock.install();
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  await page.waitForFunction(() => window.V);
  await page.evaluate(async () => {
    window.states = [];
    window.V.test.useStream(async () => {
      const ctx = new AudioContext(); const osc = ctx.createOscillator(); const dst = ctx.createMediaStreamDestination();
      osc.connect(dst); osc.start(); return dst.stream;
    });
    const target = document.getElementById('target');
    await window.V.start({ target, onState: (s) => window.states.push(s) });
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.V.stop());
  await page.waitForFunction(() => window.states.includes('transcribing'));
  assert.equal(await page.evaluate(() => window.V.busy(document.getElementById('target'))), true, 'busy while transcribing');
  await page.waitForTimeout(500);   // let onstop store the last chunk and hand the take to finishUI
  await page.clock.runFor(26000);
  await page.waitForFunction(() => window.states.includes('queued'));
  assert.equal(await page.evaluate(() => window.V.busy(document.getElementById('target'))), false, 'a queued take must not hold the field');
  assert.equal(await page.evaluate(() => window.V.busy()), false, 'nor any field');
  console.log('PASS queued take frees the field');
  mode = 'up';
  await page.evaluate(() => window.V.flush());
  await page.waitForFunction(() => document.getElementById('target').value.includes('Queued words'), null, { timeout: 5000 });
  console.log('PASS queued text still lands when the PC confirms');
} catch (e) { failed = true; console.log(`FAIL ${e.message}`); }
await browser.close(); await new Promise((r) => srv.close(r));
if (failed) process.exitCode = 1;

// Real IndexedDB and the production uploader; the HTTP peer injects upload/finalize failures.
// Browser plugin not available in this session; reuse the installed Playwright runtime.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Playwright: the installed `playwright-core` package, or PLAYWRIGHT_CORE=<path to playwright-core/index.mjs>.
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ? pathToFileURL(process.env.PLAYWRIGHT_CORE).href : 'playwright-core');
let state;
const srv = http.createServer(async (req,res) => {
  res.setHeader('content-type','application/json');
  if (req.url === '/') {
    res.setHeader('content-type','text/html');
    return res.end(`<textarea id="target"></textarea><script>
      window.AOS={esc:s=>s,toast:()=>{},haptic:()=>{},fetch:(p,o)=>fetch('/api'+p,o),api:async(p,o)=>{const r=await fetch('/api'+p,o);const j=await r.json();if(!r.ok)throw Object.assign(new Error(j.error),{status:r.status});return j}};
      </script><script type="module">import * as V from '/recorder.js';window.V=V;</script>`);
  }
  if (req.url === '/recorder.js') {res.setHeader('content-type','text/javascript');return res.end(fs.readFileSync(path.join(root,'app/work/recorder.js')));}
  if (req.url === '/api/voice') return res.end(JSON.stringify({recording:{id:'v_test001'}}));
  const m=/\/chunk\/(\d+)$/.exec(req.url);
  if (m) {
    const n=Number(m[1]);const parts=[];for await(const part of req)parts.push(part);
    state.puts[n]=(state.puts[n]||0)+1;
    if(state.mode==='chunkFailure' && n===1){res.statusCode=503;return res.end(JSON.stringify({error:'temporary failure'}));}
    state.saved[n]=Buffer.concat(parts);
    return res.end(JSON.stringify({ok:true,bytes:state.saved[n].length}));
  }
  if(req.url.endsWith('/finish')) {
    state.finishes++;
    if(state.mode==='409'||state.mode==='500'){res.statusCode=Number(state.mode);return res.end(JSON.stringify({error:'finish failed'}));}
    if(state.mode==='malformed')return res.end(JSON.stringify({recording:{status:'done'}}));
    return res.end(JSON.stringify({recording:{id:'v_test001',status:'done',chunks:2,bytes:4,text:'Recovered words'}}));
  }
  res.statusCode=404;res.end('{}');
});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chrome'});
const failures=[];
for(const mode of ['409','500','chunkFailure','malformed','done']) {
  state={mode,puts:{},saved:{},finishes:0};
  const ctx=await browser.newContext();const page=await ctx.newPage();
  try {
    await page.goto(`http://127.0.0.1:${srv.address().port}/`);
    await page.waitForFunction(()=>window.V);
    await page.evaluate(()=>{window.uploadDone=false;window.V.test.inject(new Blob([new Uint8Array([1,2,3,4])],{type:'audio/mp4'}),{chunkBytes:2}).then(()=>{window.uploadDone=true}).catch(()=>{});});
    const until=Date.now()+3000;
    while(Date.now()<until && !(mode==='chunkFailure'?state.puts[1]:state.finishes))await new Promise(r=>setTimeout(r,10));
    await page.waitForTimeout(75);
    const pending=await page.evaluate(()=>window.V.pending());
    if(mode==='done'){assert.equal(pending.length,0);assert.equal(await page.evaluate(()=>window.uploadDone),true);}
    else {
      assert.equal(pending.length,1,'unconfirmed recording must remain recoverable');
      assert.equal(pending[0].waiting,2,'all original audio chunks must survive a failed finish or upload');
      const backup=await page.evaluate(async()=>{const [r]=await window.V.pending();return JSON.parse(await (await window.V.backupPending(r.local)).text())});
      assert.deepEqual(backup.chunks.map(c=>[c.n,c.base64]),[[0,'AQI='],[1,'AwQ=']]);
      state.mode='done';await page.evaluate(()=>window.V.flush());
      assert.equal((await page.evaluate(()=>window.V.pending())).length,0,'same recording can resume and finish');
      assert.equal(state.puts[0],1,'acknowledged chunks are retained locally but not uploaded twice');
    }
    console.log(`PASS ${mode}`);
  } catch(e){failures.push({mode,error:e.message});console.log(`FAIL ${mode}: ${e.message}`);}
  finally{await ctx.close();}
}
await browser.close();await new Promise(r=>srv.close(r));
if(failures.length)process.exitCode=1;

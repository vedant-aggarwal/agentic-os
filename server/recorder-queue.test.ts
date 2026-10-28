import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the production queue with an IndexedDB-shaped async store. No microphone or live data.
test('one missing recording does not stop another saved recording from reaching the PC', async () => {
  const recs = new Map([
    ['old', { local: 'old', id: 'v_missing001', createdAt: '2026-10-21T01:00:00Z', chunks: 0, finished: true, uploaded: [] }],
    ['new', { local: 'new', id: 'v_pending001', mime: 'audio/mp4', createdAt: '2026-10-21T02:00:00Z', chunks: 1, finished: true, uploaded: [] }],
  ]);
  const chunks = new Map([['new', [{ local: 'new', n: 0, data: new Uint8Array([1, 2, 3]).buffer }]]]);
  const apiCalls: string[] = [];
  const source = readFileSync(new URL('../app/work/recorder.js', import.meta.url), 'utf8');
  const queue = source.slice(source.indexOf('// Writes keep'), source.indexOf("addEventListener('online'"));
  const script = `${queue}\nthis.finished = upload();`;
  const context: any = {
    active: null, notify() {}, setTimeout() { return 1; }, clearTimeout() {}, console,
    idb: {
      all: async () => [...recs.values()].map(r => structuredClone(r)),
      get: async (_: string, k: string) => structuredClone(recs.get(k)),
      put: async (_: string, v: any) => { recs.set(v.local, structuredClone(v)); },
      chunksOf: async (k: string) => chunks.get(k) ?? [],
      del: async (name: string, k: any) => { if (name === 'recs') recs.delete(k); else chunks.delete(k[0]); },
    },
    AOS: {
      api: async (p: string) => {
        apiCalls.push(p);
        if (p.includes('v_missing001')) throw Object.assign(new Error('No such recording.'), { status: 404 });
        return { recording: { id: 'v_pending001', status: 'done', chunks: 1, bytes: 3, text: 'Saved words' } };
      },
      fetch: async () => new Response('{}'),
    },
  };
  runInNewContext(script, context);
  await context.finished;
  expect(apiCalls).toContain('/voice/v_pending001/finish');
  expect(recs.has('old')).toBe(true);
  expect(recs.has('new')).toBe(false);
});

test('a missing PC recording replays previously acknowledged chunks when the whole take is still on the phone', async () => {
  const rec = { local:'saved', id:'v_missing002', mime:'audio/mp4', createdAt:'2026-10-21T01:00:00Z', chunks:2, finished:true, uploaded:[0] };
  let saved:any = structuredClone(rec), gone = false, exists = false;
  const puts:number[] = [];
  const chunks = [0,1].map(n=>({local:'saved',n,data:new Uint8Array([n+1]).buffer}));
  const source=readFileSync(new URL('../app/work/recorder.js',import.meta.url),'utf8');
  const queue=source.slice(source.indexOf('// Writes keep'),source.indexOf("addEventListener('online'"));
  const context:any={active:null,notify(){},setTimeout(){return 1},clearTimeout(){},console,
    idb:{all:async()=>[structuredClone(saved)],get:async()=>structuredClone(saved),put:async(_:string,v:any)=>{saved=structuredClone(v)},chunksOf:async()=>chunks,del:async(name:string)=>{if(name==='recs')gone=true}},
    AOS:{
      fetch:async(p:string)=>{const n=Number(p.split('/').at(-1));puts.push(n);if(!exists&&n!==0)return new Response('{}',{status:404});exists=true;return new Response('{}')},
      api:async()=>({recording:{id:rec.id,status:'done',chunks:2,bytes:2,text:'Recovered words'}}),
    },
  };
  runInNewContext(`${queue}\nthis.finished=upload();`,context);await context.finished;
  expect(puts).toEqual([1,0,1]);
  expect(gone).toBe(true);
});

test('an async receipt frees the phone copy at once, and the words come from the wait on GET /voice/:id', async () => {
  const recs = new Map([['take', { local: 'take', id: 'v_async0001', mime: 'audio/mp4', createdAt: '2026-10-23T01:00:00Z', chunks: 1, finished: true, uploaded: [] }]]);
  const chunks = new Map([['take', [{ local: 'take', n: 0, data: new Uint8Array([1, 2, 3]).buffer }]]]);
  const calls: { path: string; body?: any }[] = [];
  const source = readFileSync(new URL('../app/work/recorder.js', import.meta.url), 'utf8');
  const queue = source.slice(source.indexOf('// Writes keep'), source.indexOf("addEventListener('online'"));
  const context: any = {
    active: null, notify() {}, setTimeout: (fn: () => void) => setTimeout(fn, 0), clearTimeout() {}, console, Date,
    idb: {
      all: async () => [...recs.values()].map((r) => structuredClone(r)),
      get: async (_: string, k: string) => structuredClone(recs.get(k)),
      put: async (_: string, v: any) => { recs.set(v.local, structuredClone(v)); },
      chunksOf: async (k: string) => chunks.get(k) ?? [],
      del: async (name: string, k: any) => { if (name === 'recs') recs.delete(k); else chunks.delete(k[0]); },
    },
    AOS: {
      api: async (p: string, o: any = {}) => {
        calls.push({ path: p, body: o.body ? JSON.parse(o.body) : undefined });
        if (p.endsWith('/finish')) return { recording: { id: 'v_async0001', status: 'transcribing', chunks: 1, bytes: 3, text: null } };
        return { recording: { id: 'v_async0001', status: 'done', chunks: 1, bytes: 3, text: 'Words later' } };
      },
      fetch: async () => new Response('{}'),
    },
  };
  runInNewContext(`${queue}
this.words = new Promise((resolve, reject) => waiters.set('take', { resolve, reject, received: () => { this.received = true; } }));
this.finished = upload();`, context);
  await context.finished;
  expect(recs.has('take')).toBe(false);              // the PC has every byte: the phone copy goes
  expect(context.received).toBe(true);
  expect(calls[0]).toMatchObject({ path: '/voice/v_async0001/finish', body: { chunks: 1, async: true } });
  expect((await context.words).text).toBe('Words later');
  expect(calls[1].path).toBe('/voice/v_async0001?wait=25');
});

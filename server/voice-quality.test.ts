import { expect, test, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openVoice, fixWav } from './voice';
const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch});
function fixture(){const dir=mkdtempSync(join(tmpdir(),'aos-voice-quality-')),file=join(dir,'test.wav');const b=Buffer.alloc(32000+44);b.write('RIFF');b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);fixWav(b);writeFileSync(file,b);return {file,voice:openVoice({dataDir:dir,openaiKey:()=> 'test-only-key',provider:()=>'openai',romanize:null})};}
test('repetitive provider text is rejected rather than saved as successful transcription',async()=>{
  const {file,voice}=fixture();
  globalThis.fetch=(async()=>Response.json({text:'pright '.repeat(100)})) as any;
  await expect(voice.transcribeFile(file)).rejects.toThrow('repetitive');
});
test('new transcription uses Hindi and English hints without feeding the previous transcript back',async()=>{
  const {file,voice}=fixture();let captured:FormData;
  globalThis.fetch=(async(_url:any,opts:any)=>{captured=opts.body;return Response.json({text:'The cache is warm. कैश अभी warm है।'})}) as any;
  const text=await voice.transcribeFile(file);
  expect(captured!.get('model')).toBe('gpt-transcribe');
  expect(captured!.getAll('languages[]')).toEqual(['hi','en']);
  expect(captured!.get('prompt')).toBeNull();
  expect(text).toContain('The cache is warm.');
});

// v2 transcription: Codex dictation first (no paid API), OpenAI only as the fallback with a key, codes the app acts on.
// Hermetic: a fake CODEX_HOME login and a mocked fetch; real ffmpeg turns a generated tone into Opus WebM.
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cutPoints, cleanTranscript, dictationStatus, openVoice } from './voice';

const originalFetch = globalThis.fetch;
const dirs: string[] = [];
let prevHome: string | undefined;
function login(expInSeconds = 3600) {
  const home = mkdtempSync(join(tmpdir(), 'aos-codex-home-')); dirs.push(home);
  const claims = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expInSeconds })).toString('base64url');
  writeFileSync(join(home, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: `test-only.${claims}.sig`, account_id: 'acct-test' } }));
  process.env.CODEX_HOME = home;
}
/** A 2 s 440 Hz tone as 16 kHz mono WAV (real audio for ffmpeg to encode). */
function tone(seconds = 2) {
  const dir = mkdtempSync(join(tmpdir(), 'aos-voice-codex-')); dirs.push(dir);
  const n = 16000 * seconds, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF'); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / 16000) * 8000), 44 + i * 2);
  const file = join(dir, 'audio.wav'); writeFileSync(file, b);
  return { dir, file };
}
beforeEach(() => { prevHome = process.env.CODEX_HOME; });
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (prevHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = prevHome;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test('Codex dictation is the default: Opus WebM to the ChatGPT transcribe endpoint with the Codex login', async () => {
  login();
  const { dir, file } = tone();
  const calls: { url: string; type: string; auth: string; account: string }[] = [];
  globalThis.fetch = (async (url: any, opts: any) => {
    const f = (opts.body as FormData).get('file') as File;
    calls.push({ url: String(url), type: f.type, auth: opts.headers.Authorization, account: opts.headers['ChatGPT-Account-Id'] });
    return Response.json({ text: 'Kal Dad ko call karna hai about the restock.' });
  }) as any;
  const voice = openVoice({ dataDir: dir, openaiKey: () => '' });
  const got = await voice.transcribeWith(file);
  expect(got).toEqual({ text: 'Kal Dad ko call karna hai about the restock.', provider: 'codex' });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('https://chatgpt.com/backend-api/transcribe');
  expect(calls[0].type).toBe('audio/webm');
  expect(calls[0].auth.startsWith('Bearer test-only.')).toBe(true);
  expect(calls[0].account).toBe('acct-test');
});

test('an expired Codex login fails with login_expired (the app says "open Codex on the PC") and no paid call without a key', async () => {
  login(-60);
  const { dir } = tone();
  let fetched = 0;
  globalThis.fetch = (async () => { fetched++; return Response.json({ text: 'x' }); }) as any;
  const voice = openVoice({ dataDir: dir, openaiKey: () => '' });
  const r = voice.create(1, { mime: 'audio/wav', source: 'capture' });
  const wav = Bun.file(tone().file);
  await voice.putChunk(1, r.id, 0, new Request('http://localhost', { method: 'PUT', body: await wav.arrayBuffer() }));
  const out = await voice.finish(1, r.id, { chunks: 1 });
  expect(out.status).toBe('failed');
  expect(out.errorCode).toBe('login_expired');
  expect(out.error).toContain('Open Codex');
  expect(fetched).toBe(0);
});

test('with an OpenAI key set, Codex being unavailable falls back to OpenAI once', async () => {
  login(-60);
  const { dir, file } = tone();
  const urls: string[] = [];
  globalThis.fetch = (async (url: any) => { urls.push(String(url)); return Response.json({ text: 'Fallback words' }); }) as any;
  const voice = openVoice({ dataDir: dir, openaiKey: () => 'test-only-key' });
  expect(await voice.transcribeWith(file)).toEqual({ text: 'Fallback words', provider: 'openai' });
  expect(urls.every((u) => u.startsWith('https://api.openai.com/'))).toBe(true);
});

test('a rate-limited Codex reply keeps its message when the fallback also fails', async () => {
  login();
  const { dir, file } = tone();
  globalThis.fetch = (async (url: any) => (String(url).includes('chatgpt.com') ? new Response('slow down', { status: 429 }) : Response.json({ error: { message: 'insufficient_quota' } }, { status: 429 }))) as any;
  const voice = openVoice({ dataDir: dir, openaiKey: () => 'unfunded-key' });
  await expect(voice.transcribeWith(file)).rejects.toThrow('rate limited');
});

test('repetitive Codex text is refused like OpenAI text', async () => {
  login();
  const { dir, file } = tone();
  globalThis.fetch = (async () => Response.json({ text: 'haan '.repeat(60) })) as any;
  const voice = openVoice({ dataDir: dir, openaiKey: () => 'test-only-key' });
  await expect(voice.transcribeWith(file)).rejects.toThrow('repetitive');
});

test('Codex conversion yields to the event loop (a stuck ffmpeg never blocks the phone) and falls back to the file as sent', async () => {
  login();
  const dir = mkdtempSync(join(tmpdir(), 'aos-voice-codex-resp-')); dirs.push(dir);
  const path = join(dir, 'audio.m4a'); writeFileSync(path, new Uint8Array([1, 2, 3]));
  const spawn = spyOn(Bun, 'spawn').mockImplementation(() => ({ exited: Bun.sleep(80).then(() => 1), stderr: new Response('test failure').body }) as any);
  let heartbeat = false, responsive = false, type = '';
  const timer = setTimeout(() => { heartbeat = true; }, 0);
  globalThis.fetch = (async (_u: any, opts: any) => { responsive = heartbeat; type = ((opts.body as FormData).get('file') as File).type; return Response.json({ text: 'Recorded words' }); }) as any;
  try {
    const voice = openVoice({ dataDir: dir, openaiKey: () => '' });
    expect(await voice.transcribeFile(path)).toBe('Recorded words');
    expect(responsive).toBe(true);
    expect(type).toBe('audio/mp4');
  } finally { clearTimeout(timer); spawn.mockRestore(); }
});

test('long takes are cut at pauses, never past the piece limit', () => {
  expect(cutPoints(200, [])).toEqual([]);
  expect(cutPoints(700, [])).toEqual([300, 600]);
  // the latest pause between 60% and 100% of a piece wins
  expect(cutPoints(650, [[100, 101], [250, 251], [290, 290.6], [520, 521]])).toEqual([290.3, 520.5]);
});

test('cleanTranscript marks gaps as [unclear]', () => {
  expect(cleanTranscript('Haan … theek hai...')).toBe('Haan [unclear] theek hai [unclear]');
});

test('dictationStatus reports the login without the token', async () => {
  login(-5);
  const s = await dictationStatus();
  expect(s.login).toBe('expired');
  expect(JSON.stringify(s)).not.toContain('test-only');
  login(7200);
  const ok = await dictationStatus();
  expect(ok.login).toBe('ok');
  expect(Date.parse(ok.expiresAt!)).toBeGreaterThan(Date.now());
});

test('Hindi in Devanagari is put in Roman Hinglish, keeping the original; a failed rewrite keeps the words', async () => {
  login();
  const { dir, file } = tone();
  globalThis.fetch = (async () => Response.json({ text: 'ये बताओ, जो हमने QR कोड ऐड करा है' })) as any;
  const voice = openVoice({ dataDir: dir, openaiKey: () => '', romanize: async () => 'Ye batao, jo humne QR code add kara hai' });
  expect(await voice.transcribeWith(file)).toEqual({ text: 'Ye batao, jo humne QR code add kara hai', provider: 'codex', original: 'ये बताओ, जो हमने QR कोड ऐड करा है' });
  const keep = openVoice({ dataDir: dir, openaiKey: () => '', romanize: async () => { throw new Error('down'); } });
  expect((await keep.transcribeWith(file)).text).toBe('ये बताओ, जो हमने QR कोड ऐड करा है');
  let called = 0;
  globalThis.fetch = (async () => Response.json({ text: 'Plain English words' })) as any;
  const latin = openVoice({ dataDir: dir, openaiKey: () => '', romanize: async (t) => { called++; return t; } });
  expect((await latin.transcribeWith(file)).text).toBe('Plain English words');
  expect(called).toBe(0);
});

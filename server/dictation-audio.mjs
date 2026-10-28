// Vendored from a local codex-dictation-bridge project (audio.mjs) (22 Oct 2026; that folder is not in git).
// ffprobe/ffmpeg (on PATH): validates an upload and turns it into mono 24 kHz Opus WebM, the shape Codex dictation
// takes. Limits 25 MB and 600 s per request. Used by server/voice.ts.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeError } from './dictation-provider.mjs';
const run = promisify(execFile);
export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_SECONDS = 600;
export async function audioToolsReady() {
  try { await run('ffmpeg', ['-version'], {windowsHide:true, timeout:5000}); await run('ffprobe', ['-version'], {windowsHide:true, timeout:5000}); return true; } catch { return false; }
}
export async function prepareAudio(bytes, {signal} = {}) {
  if(signal?.aborted)throw new BridgeError('Transcription cancelled.',499,'cancelled');
  if (!bytes.length || bytes.length > MAX_BYTES) throw new BridgeError('Choose a recording between 1 byte and 25 MB.', 413, 'size_limit');
  const directory = await mkdtemp(join(tmpdir(), 'codex-dictation-'));
  try {
    const input = join(directory, 'input.audio'), output = join(directory, 'dictation.webm');
    await writeFile(input, bytes, {mode:0o600});
    // No playlists, remote URLs, or nested network protocols in untrusted uploads.
    const formats = 'mov,matroska,webm,wav,mp3,ogg,flac,aac,aiff,amr';
    const limits = ['-protocol_whitelist','file,pipe','-format_whitelist',formats];
    let info;
    try {
      const result = await run('ffprobe', ['-v','error',...limits,'-show_entries','format=duration:stream=codec_type,duration','-of','json',input], {windowsHide:true, timeout:15000, maxBuffer:262144, signal});
      info = JSON.parse(result.stdout);
    } catch { if(signal?.aborted)throw new BridgeError('Transcription cancelled.',499,'cancelled');throw new BridgeError('This file is not a supported audio recording. Try WAV, MP3, M4A, MP4, WebM, OGG or FLAC.', 415, 'invalid_audio'); }
    if (!info.streams?.some(stream => stream.codec_type === 'audio')) throw new BridgeError('This file has no audio track.', 415, 'no_audio');
    const durations = [info.format?.duration,...info.streams.map(stream=>stream.duration)].map(Number).filter(Number.isFinite);
    if (durations.some(duration=>duration>MAX_SECONDS+.05)) throw new BridgeError('The recording is longer than 10 minutes. Split it into shorter recordings.', 413, 'duration_limit');
    // Decode up to one extra second, so stream recordings without duration metadata
    // cannot silently exceed the limit. Limit output to a small mono Opus stream.
    try {
      await run('ffmpeg',['-nostdin','-v','error',...limits,'-i',input,'-map','0:a:0','-vn','-t',String(MAX_SECONDS+1),'-ac','1','-ar','24000','-c:a','libopus','-b:a','48k',output], {windowsHide:true, timeout:60000, maxBuffer:262144, signal});
      const result = await run('ffprobe',['-v','error','-show_entries','format=duration','-of','json',output], {windowsHide:true,timeout:5000,maxBuffer:16384,signal});
      const duration = Number(JSON.parse(result.stdout).format?.duration);
      if (!Number.isFinite(duration) || duration <= .05) throw new BridgeError('This recording contains too little audio.', 400, 'empty_audio');
      if (duration > MAX_SECONDS+.05) throw new BridgeError('The recording is longer than 10 minutes. Split it into shorter recordings.',413,'duration_limit');
      return {bytes:await readFile(output), durationSeconds:duration, type:'audio/webm', filename:'dictation.webm'};
    } catch(error) {
      if (error instanceof BridgeError) throw error;
      if (signal?.aborted) throw new BridgeError('Transcription cancelled.',499,'cancelled');
      throw new BridgeError('This audio could not be decoded. Try exporting it as WAV, MP3 or M4A.',415,'invalid_audio');
    }
  } finally { await rm(directory,{recursive:true,force:true}); }
}

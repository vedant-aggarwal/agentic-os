// Vendored from a local codex-dictation-bridge project (provider.mjs) (22 Oct 2026; that folder is not in git).
// Codex dictation: POST https://chatgpt.com/backend-api/transcribe with the Codex ChatGPT login read fresh from
// %CODEX_HOME%\auth.json on every call (never refreshed here; Codex renews it). Used by server/voice.ts (v2, DECISIONS).
// Undocumented endpoint (reverse-engineered from Codex desktop 26.1016.6573); see the bridge's research/FINDINGS.md.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const PROVIDER = 'Codex dictation';
const ENDPOINT = 'https://chatgpt.com/backend-api/transcribe';
export class BridgeError extends Error {
  constructor(message, status = 500, code = 'bridge_error') { super(message); this.status = status; this.code = code; }
}
export async function readCodexAuth() {
  let data;
  try { data = JSON.parse(await readFile(join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'), 'utf8')); }
  catch { throw new BridgeError('Codex login is unavailable on this PC. Open Codex and sign in.', 503, 'login_required'); }
  const token = data.tokens?.access_token;
  if (!token || (data.auth_mode && data.auth_mode !== 'chatgpt')) throw new BridgeError('Sign in to Codex with ChatGPT on this PC.', 503, 'login_required');
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); } catch {}
  if (claims?.exp && claims.exp * 1000 < Date.now() + 30000) throw new BridgeError('The Codex login on this PC has expired. Open Codex to renew it, then retry.', 503, 'login_expired');
  return { token, accountId: data.tokens.account_id };
}
export async function transcribe(audio, { type = 'audio/webm', filename = 'dictation.webm', signal, language } = {}) {
  const auth = await readCodexAuth();
  const body = new FormData();
  body.append('file', new Blob([audio], { type }), filename);
  if (language) body.append('language', language);
  const headers = { Authorization: `Bearer ${auth.token}`, originator: 'Codex Desktop', 'User-Agent': 'Codex Desktop/26.1016.6573 (Windows NT 10.0; x64)', Accept: 'application/json' };
  if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId;
  let response;
  for (let attempt=0;attempt<3;attempt++) {
    if(signal?.aborted)throw new BridgeError('Transcription cancelled.',499,'cancelled');
    try { response = await fetch(ENDPOINT, { method: 'POST', headers, body, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(40000)]) : AbortSignal.timeout(40000) }); }
    catch (error) {
      if (signal?.aborted) throw new BridgeError('Transcription cancelled.', 499, 'cancelled');
      if(attempt===2)throw new BridgeError('Could not reach Codex transcription. Your recording is still available to retry.', 502, 'network_error');
      try{await delay(500*2**attempt,undefined,{signal});}catch{throw new BridgeError('Transcription cancelled.',499,'cancelled');}
      continue;
    }
    if(![408,500,502,503,504].includes(response.status)||attempt===2)break;
    const retryAfter=Number(response.headers.get('retry-after'))*1000;
    if(retryAfter>10000)break;
    await response.body?.cancel();
    try{await delay(Math.max(500*2**attempt,Number.isFinite(retryAfter)?retryAfter:0),undefined,{signal});}catch{throw new BridgeError('Transcription cancelled.',499,'cancelled');}
  }
  if (!response.ok) {
    await response.body?.cancel();
    const messages = {401:'Codex rejected the saved login. Open Codex and sign in again.',403:'This Codex account cannot access the dictation endpoint.',429:'Codex dictation is rate limited. Wait before retrying.',413:'Codex rejected this recording because it is too large.',400:'Codex could not read this audio recording.'};
    throw new BridgeError(messages[response.status] || `Codex transcription failed (HTTP ${response.status}). Retry your recording.`, response.status === 401 ? 503 : response.status, 'upstream_error');
  }
  let result;
  try { result = await response.json(); } catch { throw new BridgeError('Codex returned an unreadable transcription response.', 502, 'invalid_response'); }
  if (typeof result?.text !== 'string') throw new BridgeError('Codex returned no transcript field.', 502, 'invalid_response');
  return result.text;
}

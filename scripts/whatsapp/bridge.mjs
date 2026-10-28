// Pulse Chat control bridge for your business WhatsApp number.
//
// Meta → your public webhook host (e.g. https://your-server.example, a Cloudflare tunnel) → this bridge on :8090.
// - Every message goes to Pulse Chat (POST /api/webhooks/control, signed), and the bridge
//   sends Pulse Chat's reply from the number. A sender Pulse Chat doesn't know is told how
//   to link their phone. (Changed 2026-10-16: the owner's messages used to go to Hermes.)
// - Only the owner's messages that start with "hermes" go to Hermes, unchanged, on
//   hermesUrl, as do statuses; Hermes still checks Meta's signature itself.
// - Pulse Chat's own sends (nightly reports) arrive at POST /pulse/send, signed.
// - Wyn (added 2026-10-21, Agentic OS repo scripts/whatsapp/bridge.mjs): with wynUrl and wynSecret in config.json,
//   the owner's messages and voice notes go to Wyn on the Agentic OS server instead (signed x-wyn-signature), with
//   delivery statuses. "pc …" and LINK codes still go to Pulse Chat, "hermes …" to Hermes. Wyn sends through
//   POST /wyn/send (to the owner only) and marks messages read through POST /wyn/read, both signed.
//   /wyn/send also takes {reaction: {message_id, emoji}} and {audio: {data (base64 Ogg/Opus), mime, voice}} (2026-10-21).
//
// The number's Meta credentials are read from Hermes's .env at start and never logged.
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(here, 'config.json'), 'utf8'));
const env = Object.fromEntries(fs.readFileSync(config.hermesEnv, 'utf8').split(/\r?\n/)
  .map(line => /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())).filter(Boolean).map(m => [m[1], m[2].replace(/^["']|["']$/g, '')]));
const PHONE_ID = env.WHATSAPP_CLOUD_PHONE_NUMBER_ID, TOKEN = env.WHATSAPP_CLOUD_ACCESS_TOKEN, APP_SECRET = env.WHATSAPP_CLOUD_APP_SECRET;
const GRAPH = config.graphUrl || `https://graph.facebook.com/${env.WHATSAPP_CLOUD_API_VERSION || 'v20.0'}`; // graphUrl: tests only
const OWNERS = new Set(String(env.WHATSAPP_CLOUD_ALLOWED_USERS || '').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean));
if (!PHONE_ID || !TOKEN || !APP_SECRET) throw new Error('Hermes .env is missing the WhatsApp Cloud phone id, token or app secret.');
if (!config.secret || config.secret.length < 32) throw new Error('config.json needs a secret of at least 32 characters.');

const mask = phone => `…${String(phone).slice(-4)}`;
const logFile = path.join(here, 'bridge.log');
const log = line => { const s = `${new Date().toISOString()} ${line}\n`; fs.appendFile(logFile, s, () => {}); process.stdout.write(s); };
const sign = body => crypto.createHmac('sha256', config.secret).update(body).digest('hex');
const WYN = !!(config.wynUrl && String(config.wynSecret || '').length >= 32);
const signWyn = body => crypto.createHmac('sha256', String(config.wynSecret)).update(body).digest('hex');
const sameHex = (a, b) => a.length === b.length && /^[0-9a-f]+$/i.test(a) && crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const PREFIX = /^(pc|pulse)\b[\s:,.-]*/i, LINK = /^link\s*\d{6}$/i, HERMES = /^hermes\b/i;
const UNLINKED = 'This is Pulse Chat’s WhatsApp number. To use it, open Pulse Chat → Settings → Notifications → Pulse Chat on WhatsApp, tap “Link my WhatsApp”, and send the code here.';

async function readBody(req, limit = 3 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('too large'); chunks.push(c); }
  return Buffer.concat(chunks);
}

/* ── sending from the number ─────────────────────────────────────────── */
async function graphSend(payload, edge = 'messages') {
  const res = await fetch(`${GRAPH}/${PHONE_ID}/${edge}`, {method: 'POST', headers: {authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json'},
    body: JSON.stringify({messaging_product: 'whatsapp', ...payload}), signal: AbortSignal.timeout(20000)});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ? `${data.error.code ?? res.status}: ${data.error.message}` : `HTTP ${res.status}`);
  return data;
}
async function sendText(to, text) {
  // WhatsApp allows 4096 characters a message; split on paragraph breaks.
  const parts = []; let rest = String(text);
  while (rest.length > 4000) { const at = rest.lastIndexOf('\n\n', 4000), cut = at > 1000 ? at : 4000; parts.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart(); }
  parts.push(rest);
  for (const body of parts) await graphSend({to, type: 'text', text: {body, preview_url: false}});
}
/** Uploads audio to Meta for this number; returns the media id. */
async function uploadMedia(bytes, mime) {
  if (!bytes.length || bytes.length > 16 * 1024 * 1024) throw new Error('audio must be under 16 MB');
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([bytes], {type: mime}), mime.includes('ogg') ? 'wyn.ogg' : 'wyn.audio');
  const res = await fetch(`${GRAPH}/${PHONE_ID}/media`, {method: 'POST', headers: {authorization: `Bearer ${TOKEN}`}, body: form, signal: AbortSignal.timeout(30000)});
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.id) throw new Error(data?.error?.message ? `${data.error.code ?? res.status}: ${data.error.message}` : `media upload HTTP ${res.status}`);
  return String(data.id);
}
async function sendTemplate(to, t) {
  await graphSend({to, type: 'template', template: {name: t.name, language: {code: t.language || 'en'},
    components: t.variables?.length ? [{type: 'body', parameters: t.variables.map(v => ({type: 'text', text: String(v).replace(/[\r\n\t]+/g, ' ').slice(0, 200) || '—'}))}] : []}});
}

/* ── Hermes and Pulse Chat ─────────────────────────────────────────────── */
async function toHermes(req, raw) {
  try {
    const headers = {'content-type': req.headers['content-type'] || 'application/json'};
    if (req.headers['x-hub-signature-256']) headers['x-hub-signature-256'] = req.headers['x-hub-signature-256'];
    const res = await fetch(config.hermesUrl + req.url, {method: req.method, headers, body: req.method === 'GET' ? undefined : raw, signal: AbortSignal.timeout(15000)});
    return {status: res.status, body: await res.text()};
  } catch { return {status: 502, body: 'Hermes is not running'}; }
}
/** A voice note's audio from Meta (media id → short-lived url → bytes), at most 5 MB. */
async function mediaBytes(mediaId) {
  const meta = await fetch(`${GRAPH}/${mediaId}`, {headers: {authorization: `Bearer ${TOKEN}`}, signal: AbortSignal.timeout(15000)}).then(r => r.ok ? r.json() : null);
  if (!meta?.url || Number(meta.file_size) > 5 * 1024 * 1024) return null;
  const res = await fetch(meta.url, {headers: {authorization: `Bearer ${TOKEN}`}, signal: AbortSignal.timeout(30000)});
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return bytes.length <= 5 * 1024 * 1024 ? {bytes, mime: String(meta.mime_type || 'audio/ogg')} : null;
}
async function toPulse(from, text, id, audio) {
  // Opus voice notes are about 2 KB a second; Pulse Chat bills started minutes from this.
  const body = JSON.stringify(audio ? {from, text, id, audio: audio.bytes.toString('base64'), mime: audio.mime, seconds: Math.ceil(audio.bytes.length / 2000)} : {from, text, id});
  const res = await fetch(`${config.pulseUrl}/api/webhooks/control`, {method: 'POST', headers: {'content-type': 'application/json', 'x-pulse-signature': sign(body)}, body, signal: AbortSignal.timeout(95000)});
  if (!res.ok) throw new Error(`Pulse Chat ${res.status}`);
  return res.json();
}

/** Wyn on the Agentic OS server: it answers at once and replies later through /wyn/send. */
async function toWyn(payload) {
  const body = JSON.stringify(payload);
  const res = await fetch(config.wynUrl, {method: 'POST', headers: {'content-type': 'application/json', 'x-wyn-signature': signWyn(body)}, body, signal: AbortSignal.timeout(20000)});
  if (!res.ok) throw new Error(`Wyn ${res.status}`);
  return res.json().catch(() => ({}));
}

/** WhatsApp calls to the number: Pulse Chat answers with OpenAI's voice; we accept with its SDP answer. */
async function onCall(c) {
  const from = String(c.from || '').replace(/\D/g, '');
  if (c.event === 'terminate') { await postSigned('/api/webhooks/control-call', {event: 'terminate', callId: c.id}).catch(() => null); log(`call ${mask(from)}: ended`); return; }
  if (c.event !== 'connect' || !c.session?.sdp) return;
  const r = await postSigned('/api/webhooks/control-call', {event: 'connect', from, callId: c.id, sdp: c.session.sdp});
  if (r?.action !== 'accept' || !r.sdp) {
    await graphSend({call_id: c.id, action: 'reject'}, 'calls').catch(() => null);
    log(`call ${mask(from)}: rejected (${r?.reason || 'no answer'})`);
    if (r?.reason === 'not-linked') await sendText(from, UNLINKED).catch(() => {});
    return;
  }
  const session = {sdp_type: 'answer', sdp: r.sdp};
  await graphSend({call_id: c.id, action: 'pre_accept', session}, 'calls');
  await graphSend({call_id: c.id, action: 'accept', session}, 'calls');
  log(`call ${mask(from)}: answered by Pulse Chat AI`);
}
async function postSigned(pathname, payload) {
  const body = JSON.stringify(payload);
  const res = await fetch(`${config.pulseUrl}${pathname}`, {method: 'POST', headers: {'content-type': 'application/json', 'x-pulse-signature': sign(body)}, body, signal: AbortSignal.timeout(25000)});
  if (!res.ok) throw new Error(`Pulse Chat ${res.status}`);
  return res.json();
}

/** Meta's webhook: answer 200 at once, then route each message. */
async function onWebhook(req, res, raw) {
  const expected = crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
  if (!sameHex(String(req.headers['x-hub-signature-256'] || '').replace(/^sha256=/, ''), expected)) { res.writeHead(401).end(); log('webhook: bad signature'); return; }
  res.writeHead(200).end('ok');
  let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { return; }
  const values = (payload.entry ?? []).flatMap(e => e.changes ?? []).map(c => c.value ?? {}).filter(v => v.metadata?.phone_number_id === PHONE_ID);
  const messages = values.flatMap(v => v.messages ?? []), callEvents = values.flatMap(v => v.calls ?? []);
  for (const c of callEvents) await onCall(c).catch(error => log(`call ${mask(c.from)}: failed (${error.message})`));
  // Delivery receipts to Wyn, so a refused message shows in her chat. Hermes still gets them below.
  const statuses = values.flatMap(v => v.statuses ?? []);
  if (WYN && statuses.length) await toWyn({statuses: statuses.map(s => ({id: s.id, status: s.status, errors: s.errors}))}).catch(error => log(`statuses to Wyn failed (${error.message})`));
  let hermes = !messages.length && !callEvents.length; // statuses and other updates are Hermes's
  for (const m of messages) {
    const from = String(m.from || '').replace(/\D/g, ''), text = m.type === 'text' ? String(m.text?.body ?? '').trim() : '';
    const owner = OWNERS.has(from);
    if (owner && HERMES.test(text)) { hermes = true; continue; }
    // The owner talks to Wyn; "pc …" and LINK codes still reach Pulse Chat below.
    if (owner && WYN && !PREFIX.test(text) && !LINK.test(text)) {
      try {
        const audio = m.type === 'audio' && m.audio?.id ? await mediaBytes(m.audio.id) : null;
        if (m.type === 'audio' && !audio) { await sendText(from, 'I could not download that voice note. Keep it under about 5 minutes, or type it.'); continue; }
        await toWyn({message: {from, id: m.id, type: m.type, text: text || null, ...(audio ? {audio: audio.bytes.toString('base64'), mime: audio.mime} : {})}});
        log(`in ${mask(from)}: Wyn`);
      } catch (error) {
        log(`in ${mask(from)}: Wyn failed (${error.message})`);
        await sendText(from, 'Wyn isn’t answering: the Agentic OS server on the PC looks down. Start a message with “pc” to reach Pulse Chat.').catch(() => {});
      }
      continue;
    }
    // Voice notes go to Pulse Chat as audio to transcribe; other non-text reaches it as empty text, and it says what it reads.
    const question = PREFIX.test(text) ? text.replace(PREFIX, '').trim() || 'help' : text;
    try {
      const audio = m.type === 'audio' && m.audio?.id ? await mediaBytes(m.audio.id) : null;
      if (m.type === 'audio' && !audio) { await sendText(from, 'I could not download that voice note. Keep it under about 5 minutes, or type your question.'); continue; }
      const r = await toPulse(from, question, m.id, audio);
      if (r.handled === false) { log(`in ${mask(from)}: not linked, told how to link`); await sendText(from, owner ? `${UNLINKED}\n\nTo talk to Hermes, start your message with “hermes”.` : UNLINKED); continue; }
      log(`in ${mask(from)}: Pulse Chat${r.reply ? ' replied' : ' (no reply)'}`);
      if (r.reply) await sendText(from, r.reply);
    } catch (error) {
      log(`in ${mask(from)}: Pulse Chat failed (${error.message})`);
      await sendText(from, 'Pulse Chat could not answer just now. Try again in a minute.').catch(() => {});
    }
  }
  if (hermes) { const r = await toHermes(req, raw); if (r.status >= 300) log(`Hermes answered ${r.status}`); }
}

/** Pulse Chat's own sends (the nightly report). */
async function onPulseSend(req, res, raw) {
  if (!sameHex(String(req.headers['x-pulse-signature'] || ''), sign(raw))) { res.writeHead(401).end('bad signature'); return; }
  let m; try { m = JSON.parse(raw.toString('utf8')); } catch { res.writeHead(400).end('bad json'); return; }
  const to = String(m.to || '').replace(/\D/g, '');
  if (!/^[1-9]\d{7,14}$/.test(to) || !m.text) { res.writeHead(400).end('to and text are required'); return; }
  try {
    if (m.windowOpen) await sendText(to, m.text);
    else if (m.template?.name) await sendTemplate(to, m.template);
    else { res.writeHead(409).end('window closed and no template'); return; }
    log(`out ${mask(to)}: ${m.windowOpen ? 'text' : 'template'} sent`);
    res.writeHead(200, {'content-type': 'application/json'}).end('{"ok":true}');
  } catch (error) {
    log(`out ${mask(to)}: failed (${error.message})`);
    res.writeHead(502).end(error.message.slice(0, 200));
  }
}

/** Wyn's sends (text or template, to the owner only) and read receipts. */
async function onWyn(req, res, raw, action) {
  if (!sameHex(String(req.headers['x-wyn-signature'] || ''), signWyn(raw))) { res.writeHead(401).end('bad signature'); return; }
  let m; try { m = JSON.parse(raw.toString('utf8')); } catch { res.writeHead(400).end('bad json'); return; }
  const reply = (status, data) => res.writeHead(status, {'content-type': 'application/json'}).end(JSON.stringify(data));
  try {
    if (action === 'read') {
      if (!m.id) { res.writeHead(400).end('id is required'); return; }
      // typing: false marks it read without "typing…" (a message Wyn answers with a reaction only).
      await graphSend({status: 'read', message_id: String(m.id), ...(m.typing === false ? {} : {typing_indicator: {type: 'text'}})});
      reply(200, {ok: true});
      return;
    }
    const to = String(m.to || '').replace(/\D/g, '');
    if (!OWNERS.has(to)) { res.writeHead(403).end('Wyn only messages the owner'); return; }
    let data;
    if (m.template?.name) {
      data = await graphSend({to, type: 'template', template: {name: m.template.name, language: {code: m.template.language || 'en'},
        components: m.template.variables?.length ? [{type: 'body', parameters: m.template.variables.map(v => ({type: 'text', text: String(v).replace(/[\r\n\t]+/g, ' ').slice(0, 1000) || '—'}))}] : []}});
    } else if (m.text) {
      data = await graphSend({to, type: 'text', text: {body: String(m.text).slice(0, 4096), preview_url: false}});
    } else if (m.reaction?.message_id) {
      // An emoji on one of the owner's messages (added 2026-10-21).
      data = await graphSend({to, type: 'reaction', reaction: {message_id: String(m.reaction.message_id), emoji: String(m.reaction.emoji ?? '').slice(0, 16)}});
    } else if (m.audio?.data) {
      // A voice note (Ogg/Opus, base64): upload it to Meta, then send it as audio; voice: true shows it as a voice note.
      const id = await uploadMedia(Buffer.from(String(m.audio.data), 'base64'), String(m.audio.mime || 'audio/ogg'));
      data = await graphSend({to, type: 'audio', audio: {id, ...(m.audio.voice ? {voice: true} : {})}})
        .catch(() => graphSend({to, type: 'audio', audio: {id}}));
    } else { res.writeHead(400).end('text, template, reaction or audio is required'); return; }
    log(`out ${mask(to)}: Wyn ${m.template?.name ? 'template' : m.reaction ? 'reaction' : m.audio ? 'voice note' : 'text'} sent`);
    reply(200, {ok: true, id: data?.messages?.[0]?.id ?? null});
  } catch (error) {
    log(`wyn ${action}: failed (${error.message})`);
    res.writeHead(502).end(error.message.slice(0, 200));
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://bridge');
    if (req.method === 'GET' && url.pathname === '/pulse/health') { res.writeHead(200).end('ok'); return; }
    if (req.method === 'POST' && url.pathname === '/pulse/send') return await onPulseSend(req, res, await readBody(req, 64 * 1024));
    if (req.method === 'POST' && (url.pathname === '/wyn/send' || url.pathname === '/wyn/read')) {
      // Wyn's routes answer only on this PC, never through the tunnel (which adds cf-connecting-ip).
      if (!WYN || req.headers['cf-connecting-ip']) { res.writeHead(404).end('Wyn is not set up on this bridge'); return; }
      // Voice notes come as base64 audio: up to about 8 MB.
      return await onWyn(req, res, await readBody(req, 12 * 1024 * 1024), url.pathname.slice(6));
    }
    if (req.method === 'POST' && url.pathname === (config.webhookPath || '/whatsapp/webhook')) return await onWebhook(req, res, await readBody(req));
    // Meta's verification handshake and anything else: Hermes, as before.
    const r = await toHermes(req, req.method === 'GET' ? null : await readBody(req));
    res.writeHead(r.status).end(r.body);
  } catch (error) {
    log(`error: ${error.message}`);
    if (!res.headersSent) res.writeHead(500).end();
  }
});
// Loopback only (both families: the tunnel may dial localhost as ::1).
const port = config.port || 8090;
server.listen(port, '127.0.0.1', () => log(`bridge listening on localhost:${port}; Hermes at ${config.hermesUrl}; Pulse Chat at ${config.pulseUrl}; Wyn ${WYN ? `at ${config.wynUrl}` : 'off'}; ${OWNERS.size} owner number(s)`));
http.createServer(server.listeners('request')[0]).listen(port, '::1').on('error', () => log('IPv6 loopback unavailable; IPv4 only'));

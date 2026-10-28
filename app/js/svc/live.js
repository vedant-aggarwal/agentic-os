// svc/live: live updates over plain HTTP, the way the shipping app does them (work/job.js:167-189, app.js:5054-5071).
// Server-sent events are parsed from fetch, because EventSource can't send the Bearer token from the iPhone app.
//
//   const s = stream('/jobs/j12/stream', { after: () => lastSeq, onEvent(type, data) {…}, onState(st) {…} })
//     reconnects after 1 s, 2 s … 5 s; ?after=<seq> replays what was missed; s.close() ends it for good
//   const p = longPoll((after) => `/wyn?after=${after}&wait=25`, { cursor: 0, next: (r) => r.messages.at(-1)?.id, onData })
//     asks again as soon as an answer lands, backs off while the PC is away; p.stop() · p.now()
//   const t = every(8000, fn, { when: () => anyJobRunning() })   a poll that only runs while the page is visible
import { rawFetch, api } from './api.js';

const G = globalThis;
const visible = () => G.document?.visibilityState !== 'hidden';

/** Parse an SSE body. Calls onEvent(type, data) per event; data is JSON when it parses, else the text. */
export async function readSSE(body, onEvent) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
      let type = 'message', id = null;
      const data = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(':')) continue;
        if (line.startsWith('event:')) type = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        else if (line.startsWith('id:')) id = line.slice(3).trim();
      }
      if (!data.length) continue;
      const raw = data.join('\n');
      let parsed = raw;
      try { parsed = JSON.parse(raw); } catch {}
      try { onEvent(type, parsed, { id, raw }); } catch (e) { console.warn('[live] event handler', e); }
    }
  }
}

/**
 * A server-sent event stream that stays up. after(): the last sequence seen, sent as ?after= on every (re)connect.
 * onState('open' | 'closed' | 'retry' | 'gone'): 'gone' is a 404/410 (the thing no longer exists; no retry).
 */
export function stream(path, { onEvent, onState, after = null, minDelay = 1000, maxDelay = 5000 } = {}) {
  let ctrl = null, alive = true, tries = 0, timer = 0, gen = 0;
  const url = () => { const a = after?.(); if (a == null) return path; return `${path}${path.includes('?') ? '&' : '?'}after=${encodeURIComponent(a)}`; };
  const state = (s, extra) => { try { onState?.(s, extra); } catch {} };
  async function run() {
    if (!alive) return;
    const mine = ++gen;   // one connection at a time: a run that was replaced (reconnect, close) ends quietly
    ctrl = new AbortController();
    try {
      const r = await rawFetch(url(), { headers: { Accept: 'text/event-stream' }, signal: ctrl.signal });
      if (r.status === 404 || r.status === 410) { alive = false; state('gone', { status: r.status }); return; }
      if (!r.ok || !r.body) throw Object.assign(new Error(`stream ${r.status}`), { status: r.status });
      tries = 0;
      state('open');
      await readSSE(r.body, (type, data, meta) => { if (mine === gen) onEvent?.(type, data, meta); });
      if (mine !== gen) return;
      state('closed');
    } catch (e) {
      if (!alive || mine !== gen) return;
      state('retry', { error: e });
    }
    if (!alive || mine !== gen) return;
    tries++;
    timer = G.setTimeout(run, Math.min(maxDelay, minDelay * tries));
  }
  run();
  return {
    close() { alive = false; gen++; G.clearTimeout(timer); ctrl?.abort(); },
    /** Drop the connection and open it again now (after a reply was sent, after coming back to the app). */
    reconnect() { if (!alive) return; G.clearTimeout(timer); tries = 0; gen++; ctrl?.abort(); G.setTimeout(run, 0); },
    get alive() { return alive; },
  };
}

/**
 * A long-poll loop: build(cursor) → a path that waits on the PC (e.g. /wyn?after=12&wait=25); next(answer) → the new
 * cursor. Runs while the page is visible (and while when() says so), backs off 3 s × n (max 30 s) while the PC is away.
 */
export function longPoll(build, { cursor = 0, next = () => null, onData, onError, when = () => true, timeout = 35000 } = {}) {
  let alive = true, running = false, fails = 0, timer = 0, ctrl = null;
  let cur = cursor;
  async function loop() {
    if (!alive || running) return;
    if (!visible() || !when()) { timer = G.setTimeout(loop, 5000); return; }
    running = true;
    ctrl = new AbortController();
    try {
      const r = await api(build(cur), { timeout, signal: ctrl.signal });
      fails = 0;
      const n = next(r);
      if (n != null) cur = n;
      try { onData?.(r); } catch (e) { console.warn('[live] long-poll handler', e); }
      running = false;
      timer = G.setTimeout(loop, 50);
    } catch (e) {
      running = false;
      if (!alive) return;
      fails++;
      try { onError?.(e); } catch {}
      timer = G.setTimeout(loop, e?.status === 403 || e?.status === 404 ? 60000 : Math.min(30000, 3000 * fails));
    }
  }
  const wake = () => { if (visible() && alive && !running) { G.clearTimeout(timer); loop(); } };
  G.document?.addEventListener('visibilitychange', wake);
  loop();
  return {
    stop() { alive = false; G.clearTimeout(timer); ctrl?.abort(); G.document?.removeEventListener('visibilitychange', wake); },
    now: wake,
    get cursor() { return cur; },
    set cursor(v) { cur = v; },
  };
}

/** A poll that runs only while the page is visible and when() is true. fn may be async; runs never overlap. */
export function every(ms, fn, { when = () => true, now = false } = {}) {
  let busy = false;
  const tick = async () => {
    if (busy || !visible() || !when()) return;
    busy = true;
    try { await fn(); } catch (e) { console.info('[live] poll', e?.message ?? e); } finally { busy = false; }
  };
  const id = G.setInterval(tick, ms);
  if (now) tick();
  return { stop: () => G.clearInterval(id), now: tick };
}

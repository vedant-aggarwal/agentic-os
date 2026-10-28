// Settings › Voice recordings: every recording from the PC (newest first) plus any still waiting on this phone.
// Tap one to play it, copy its text, retry it, or turn it into an idea.
import * as voice from './recorder.js';
import { createIdea } from './state.js';
import { saveVoiceFile } from './voice-export.js';

const { AOS } = window;
const { esc } = AOS;
const $ = (s, el = document) => el.querySelector(s);
const screen = document.getElementById('screen');
const STATUS = { recording: 'Recording', interrupted: 'Interrupted', uploaded: 'Uploaded', transcribing: 'Transcribing', done: 'Done', failed: 'Failed' };
const SOURCE = { capture: 'Capture', widget: 'Widget', keyboard: 'Keyboard', siri: 'Siri', app: 'App', desktop: 'Desktop', voice: 'Voice' };

const el = document.createElement('section');
el.className = 'sheet work-sheet voice-sheet';
el.id = 'voiceSheet';
el.setAttribute('aria-label', 'Voice recordings');
el.setAttribute('aria-hidden', 'true');
el.innerHTML = '<div class="grabber"></div><div class="sheet-head"><h2>Voice recordings</h2><p>Pending audio stays on this phone until the PC confirms it. Back up important recordings before updating or clearing the app.</p></div><div class="sheet-body voice-body"></div>';
screen.appendChild(el);
const sheet = AOS.makeSheet(el, { detents: () => ({ large: 0 }), scrimFor: (y, H) => Math.min(1, Math.max(0, 1 - y / (H * 0.85))) });

const V = { list: null, local: [], open: null, error: null, audio: new Map() };
const exports = new Map();
export async function openVoice() {
  V.open = null;
  exports.clear();
  render();
  sheet.open('large');
  await load();
}
async function load() {
  V.local = await voice.pending().catch(() => []);
  try { V.list = (await AOS.api('/voice')).recordings ?? []; V.error = null; }
  catch (e) { V.error = e.status === 404 ? 'Voice recordings aren’t on your PC’s server yet.' : 'Your PC isn’t reachable right now.'; V.list ??= []; }
  render();
}
voice.onChange(() => { if (el.classList.contains('open')) load(); });

const mmss = (ms) => { const s = Math.round((ms ?? 0) / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
function render() {
  const body = $('.voice-body', el);
  const local = V.local.filter((r) => !V.list?.some((x) => x.id === r.id && r.waiting === 0));
  const localHTML = local.length ? `<h3 class="sec-label">On this phone<span class="sec-count">${local.length}</span></h3><div class="work-list">${local.map((r) => `<div class="work-row vr-row local"><span class="vr-ico" aria-hidden="true"></span><span class="wr-text"><span class="wr-title">${r.finished ? 'Waiting for PC confirmation' : 'Recording or interrupted'}</span><span class="wr-sub">${esc(when(r.createdAt))} · ${AOS.plural(r.waiting, 'chunk')} saved here</span>${r.lastError ? `<span class="wr-sub vr-error">${esc(r.lastError)}</span>` : ''}</span><span class="vr-local-actions"><button class="small-btn" data-vr-flush>Send now</button><button class="small-btn" data-vr-backup="${esc(r.local)}">${exports.has(r.local) ? 'Save backup' : 'Back up'}</button></span></div>`).join('')}</div>` : '';
  if (V.list == null) { body.innerHTML = `${localHTML}<p class="quiet pad">Loading…</p>`; return; }
  const rows = V.list.map((r) => {
    const open = V.open === r.id;
    const first = (r.text ?? '').split('\n')[0];
    const canRetry = ['interrupted', 'failed', 'uploaded', 'recording'].includes(r.status) || (r.status === 'done' && !r.text);
    return `<div class="vr-item${open ? ' open' : ''}"><button class="work-row vr-row" data-vr="${esc(r.id)}"><span class="vr-ico s-${esc(r.status)}" aria-hidden="true"></span><span class="wr-text"><span class="wr-title">${first ? esc(first) : `<i>${esc(STATUS[r.status] ?? r.status)}</i>`}</span><span class="wr-sub">${esc(when(r.createdAt))} · ${mmss(r.durationMs)} · ${esc(SOURCE[r.source] ?? r.source ?? '')}${r.status !== 'done' ? ` · <b class="st-${esc(r.status)}">${esc(STATUS[r.status] ?? r.status)}</b>` : ''}</span></span></button>
${open ? `<div class="vr-detail">${r.text ? `<p class="vr-text">${esc(r.text)}</p>` : r.error ? `<p class="quiet">${esc(r.error)}</p>` : ''}
${r.text && r.error ? `<p class="quiet">${esc(r.error)}</p>` : ''}<div class="vr-audio" data-audio-for="${esc(r.id)}">${V.audio.get(r.id) ? `<audio controls src="${V.audio.get(r.id)}"></audio>` : '<button class="small-btn" data-vr-play>Play</button>'}</div>
${r.reviewRequired ? '<p class="quiet">Needs listening review. Unclear passages are marked in the transcript.</p>' : ''}<div class="chips">${r.text ? '<button class="chip-btn" data-vr-copy>Copy text</button><button class="chip-btn" data-vr-idea>Use as idea</button>' : ''}<button class="chip-btn" data-vr-export>Save audio</button>${canRetry ? '<button class="chip-btn on" data-vr-retry>Retry</button>' : ''}<button class="chip-btn danger" data-vr-del>Delete</button></div></div>` : ''}</div>`;
  }).join('');
  body.innerHTML = `${localHTML}${V.error ? `<p class="quiet pad">${esc(V.error)}</p>` : ''}${rows ? `<div class="work-list vr-list">${rows}</div>` : V.error ? '' : '<p class="quiet pad">No recordings yet. Tap a mic anywhere to make one.</p>'}`;
}

el.addEventListener('click', async (e) => {
  const t = e.target;
  const backup = t.closest('[data-vr-backup]');
  if (backup) {
    const local = backup.dataset.vrBackup;
    backup.disabled = true;
    try {
      if (exports.has(local)) await saveVoiceFile(exports.get(local).blob, exports.get(local).name);
      else {
        backup.textContent = 'Preparing…';
        const file = await voice.exportPending(local); exports.set(local, file);
        AOS.toast(file.complete ? 'Backup ready. Tap Save backup.' : 'Remaining chunks backed up as a recovery file. Keep the PC copy too. Tap Save backup.');
      }
    } catch (err) { AOS.toast(err.message || 'Couldn’t save the backup. Audio is still kept.'); }
    finally { render(); }
    return;
  }
  if (t.closest('[data-vr-flush]')) { voice.flush(); AOS.toast('Sending'); return; }
  const row = t.closest('[data-vr]');
  if (row) { V.open = V.open === row.dataset.vr ? null : row.dataset.vr; AOS.haptic('selection'); render(); return; }
  const r = V.list?.find((x) => x.id === V.open);
  if (!r) return;
  if (t.closest('[data-vr-export]')) {
    const b = t.closest('[data-vr-export]'); b.disabled = true;
    try {
      const res = await AOS.fetch(`/voice/${r.id}/audio`);
      if (!res.ok) throw new Error('Couldn’t load the audio. Try again when connected.');
      const blob = await res.blob(), ext = ({'audio/mp4':'m4a','audio/wav':'wav','audio/webm':'webm','audio/ogg':'ogg'})[r.mime] || 'audio';
      await saveVoiceFile(blob, `${r.id}.${ext}`);
    } catch (err) { AOS.toast(err.message || 'Couldn’t save the audio'); }
    finally { b.disabled = false; }
    return;
  }
  if (t.closest('[data-vr-play]')) {
    try {
      const res = await AOS.fetch(`/voice/${r.id}/audio`);
      if (!res.ok) throw new Error();
      V.audio.set(r.id, URL.createObjectURL(await res.blob()));
      render();
      $(`[data-audio-for="${CSS.escape(r.id)}"] audio`, el)?.play().catch(() => {});
    } catch { AOS.toast('Couldn’t load the audio'); }
    return;
  }
  if (t.closest('[data-vr-copy]')) {
    try { await navigator.clipboard.writeText(r.text); AOS.toast('Copied'); } catch { AOS.toast('Couldn’t copy'); }
    return;
  }
  if (t.closest('[data-vr-idea]')) {
    await createIdea({ text: r.text, source: 'voice', recordingId: r.id });
    AOS.haptic('success');
    AOS.toast('Saved to Ideas');
    return;
  }
  if (t.closest('[data-vr-retry]')) {
    const b = t.closest('[data-vr-retry]');
    b.disabled = true;
    b.textContent = 'Transcribing';
    try {
      const out = (await AOS.api(`/voice/${r.id}/retry`, { method: 'POST', body: '{}' })).recording;
      Object.assign(r, out);
      AOS.toast(out.text ? 'Transcribed' : out.error || 'Still no text');
    } catch (err) { AOS.toast(err.status ? err.message : 'Your PC isn’t reachable right now'); }
    render();
    return;
  }
  if (t.closest('[data-vr-del]')) {
    try {
      await AOS.api(`/voice/${r.id}`, { method: 'DELETE' });
      V.list = V.list.filter((x) => x !== r);
      V.open = null;
      render();
      AOS.toast('Recording deleted');
    } catch (err) { AOS.toast(err.status ? err.message : 'Your PC isn’t reachable right now'); }
  }
});

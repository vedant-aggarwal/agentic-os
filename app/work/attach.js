// Attachments for jobs: a paperclip button opens the photo/file picker, each pick uploads at once
// (POST /jobs/attachments, photos shrunk to 2048 px first) and shows as a removable thumbnail in a tray.
// The composer and the job sheet send the ids with the message; the PC names the files in the prompt.
// Pasting an image into a field inside [data-att-host] attaches it too.
const AOS = window.AOS;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CLIP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m20.5 11.5-8.1 8.1a5 5 0 0 1-7.1-7.1l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7l-8.5 8.5a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8"/></svg>';
const MAX_EDGE = 2048, MAX = 10, MAX_BYTES = 25 * 1024 * 1024;

const trays = new Map();   // key -> [{ lid, name, image, url, id, state: 'up' | 'ok' | 'err', error }]
const listeners = new Map();
let lid = 0, pickFor = null;

export const attachButtonHTML = (key) => `<button type="button" class="att-btn" data-attach="${esc(key)}" aria-label="Attach photos or files">${CLIP}</button>`;
/** The same, as a labelled row under a form field (the job sheet). */
export const attachRowHTML = (key) => `<button type="button" class="att-field" data-attach="${esc(key)}">${CLIP}<span>Photos or files</span></button>`;
export const trayHTML =(key) => `<div class="att-tray" data-att-tray="${esc(key)}" hidden></div>`;
const list = (key) => trays.get(key) ?? [];
export const ids = (key) => list(key).filter((a) => a.state === 'ok').map((a) => a.id);
export const has = (key) => list(key).length > 0;
export const uploading = (key) => list(key).some((a) => a.state === 'up');
export function clear(key) { for (const a of list(key)) if (a.url) URL.revokeObjectURL(a.url); trays.delete(key); changed(key); }
/** fn runs whenever this key's tray changes (the composer re-checks its Send button). */
export function onChange(key, fn) { listeners.set(key, fn); }

/** Redraw every tray for this key (a page that mounts a tray calls it once to show a kept draft). */
export function changed(key) {
  const items = list(key);
  const html = items.map((a) => `<div class="att-item${a.image ? ' img' : ''} ${a.state}" title="${esc(a.error || a.name)}">${a.image && a.url ? `<img src="${a.url}" alt="" />` : `<span class="att-name">${esc(a.name)}</span>`}${a.state === 'up' ? '<i class="att-spin"></i>' : a.state === 'err' ? '<i class="att-err">!</i>' : ''}<button type="button" class="att-x" data-att-x="${esc(key)}:${a.lid}" aria-label="Remove ${esc(a.name)}">×</button></div>`).join('');
  for (const t of document.querySelectorAll(`[data-att-tray="${CSS.escape(key)}"]`)) {
    if (t._html !== html) { t.innerHTML = html; t._html = html; }
    t.hidden = !items.length;
  }
  listeners.get(key)?.();
}

const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true, hidden: true });
input.setAttribute('aria-hidden', 'true');
document.body.appendChild(input);
input.addEventListener('change', () => {
  const files = [...input.files];
  input.value = '';
  if (pickFor) add(pickFor, files);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-attach]');
  if (b) { e.preventDefault(); pickFor = b.dataset.attach; AOS.haptic?.('light'); input.click(); return; }
  // Tap a sent photo to see it full screen; tap again to close.
  const th = e.target.closest('.att-thumb');
  if (th?.src && !th.src.startsWith('data:')) {
    const v = Object.assign(document.createElement('div'), { className: 'att-view' });
    v.append(Object.assign(document.createElement('img'), { src: th.src, alt: th.alt }));
    v.addEventListener('click', () => v.remove());
    document.body.appendChild(v);
    return;
  }
  const x = e.target.closest('[data-att-x]');
  if (x) {
    e.preventDefault();
    const [key, n] = x.dataset.attX.split(':');
    const a = list(key).find((v) => v.lid === +n);
    if (a?.url) URL.revokeObjectURL(a.url);
    trays.set(key, list(key).filter((v) => v.lid !== +n));
    changed(key);
  }
});
document.addEventListener('paste', (e) => {
  const host = e.target.closest?.('[data-att-host]');
  const files = [...(e.clipboardData?.files ?? [])];
  if (!host || !files.length) return;
  e.preventDefault();
  add(host.dataset.attHost, files);
});

export function add(key, files) {
  const room = MAX - list(key).length;
  if (files.length > room) AOS.toast(`Ten attachments at most${room > 0 ? `: added the first ${room}` : ''}`);
  for (const f of files.slice(0, Math.max(0, room))) {
    if (f.size > MAX_BYTES) { AOS.toast(`${f.name || 'That file'} is over 25 MB`); continue; }
    const image = /^image\//.test(f.type) || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f.name);
    const a = { lid: ++lid, name: f.name || (image ? 'photo.jpg' : 'file'), image, url: image ? URL.createObjectURL(f) : null, id: null, state: 'up', error: '' };
    trays.set(key, [...list(key), a]);
    changed(key);
    upload(key, a, f);
  }
}

async function upload(key, a, f) {
  try {
    const { blob, name } = a.image ? await shrink(f, a.name) : { blob: f, name: a.name };
    const r = await AOS.fetch(`/jobs/attachments?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Upload failed (${r.status})`);
    Object.assign(a, { id: j.attachment.id, name: j.attachment.name, state: 'ok' });
    if (!j.attachment.image && a.url) { URL.revokeObjectURL(a.url); Object.assign(a, { image: false, url: null }); }
  } catch (e) {
    Object.assign(a, { state: 'err', error: e?.message || 'Upload failed' });
    AOS.toast(e instanceof TypeError ? 'Your PC isn’t reachable right now' : a.error);
  }
  if (list(key).includes(a)) changed(key);
}

/** Phone photos are 4000+ px and several MB; 2048 px JPEG keeps them sharp for the model and quick to send.
 *  GIFs and anything the browser can't decode (some HEIC) go as they are; the PC converts HEIC. */
async function shrink(f, name) {
  if (/gif/i.test(f.type)) return { blob: f, name };
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const s = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const png = /png/i.test(f.type);
    if (s === 1 && (png || /jpe?g/i.test(f.type)) && f.size < 3.5e6) { bmp.close?.(); return { blob: f, name }; }
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
    // Screenshots stay PNG (sharper text) unless that comes out too big for the model to take inline.
    let blob = png ? await new Promise((r) => c.toBlob(r, 'image/png')) : null;
    let ext = 'png';
    if (!blob || blob.size > 3.5e6) { blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85)); ext = 'jpg'; }
    if (!blob) return { blob: f, name };
    return { blob, name: `${name.replace(/\.[^.]*$/, '') || 'photo'}.${ext}` };
  } catch {
    return { blob: f, name };
  }
}

/** A sent message's "Attached files" block: thumbnails and names instead of PC paths. */
const HEAD = 'Attached files (saved on the PC; read them):';
export function splitAttached(text) {
  const t = String(text ?? '');
  const i = t.indexOf(HEAD);
  if (i < 0) return { text: t, files: [] };
  // The block can sit mid-prompt (a new job's context), so only its own "- name: path" lines come out.
  const lines = t.slice(i + HEAD.length).split(/\r?\n/);
  let n = 1;
  while (n < lines.length && /^- .+: /.test(lines[n])) n++;
  const files = lines.slice(1, n).map((l) => l.match(/^- (.+?): .*[\\/](a_[a-f0-9]{16})[\\/]/)).filter(Boolean).map((m) => ({ name: m[1], id: m[2], image: /\.(jpe?g|png|gif|webp)$/i.test(m[1]) }));
  const body = `${t.slice(0, i).trimEnd()}\n\n${lines.slice(n).join('\n').trimStart()}`.trim();
  return { text: body === 'See the attached files.' ? '' : body, files };
}
export const sentHTML = (files) => !files.length ? '' : `<div class="att-sent">${files.map((f) => f.image
  ? `<img class="att-thumb" data-att-src="${esc(f.id)}" alt="${esc(f.name)}" />`
  : `<span class="att-file">${CLIP}${esc(f.name)}</span>`).join('')}</div>`;

// Thumbnails need the session (the iPhone app sends a Bearer token), so they load through fetch as blob URLs.
const thumbs = new Map();
async function thumb(id) {
  if (!thumbs.has(id)) thumbs.set(id, AOS.fetch(`/jobs/attachments/${id}`).then((r) => (r.ok ? r.blob() : null)).then((b) => (b ? URL.createObjectURL(b) : null)).catch(() => null));
  return thumbs.get(id);
}
new MutationObserver(() => {
  for (const img of document.querySelectorAll('img[data-att-src]:not([src])')) {
    img.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAAAAACw=');
    thumb(img.dataset.attSrc).then((u) => { if (u) img.src = u; else img.replaceWith(Object.assign(document.createElement('span'), { className: 'att-file', textContent: img.alt })); });
  }
}).observe(document.body, { childList: true, subtree: true });

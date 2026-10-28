// A unified diff for the phone: what changed, file by file. The job's Changes page, a copy's page and the compare
// page show the files as a list (each with its kind and +/− counts) and the one you pick below it, line by line with
// its numbers. Class names are Jobs' own (j…), so module markup never picks them up.
import { statHTML } from './cards.js';

const { AOS } = window;
const { esc } = AOS;

export const sumFiles = (files) => (files ?? []).reduce((a, f) => ({ add: a.add + (f.add ?? 0), del: a.del + (f.del ?? 0) }), { add: 0, del: 0 });
const ST = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R' };
const KIND = { A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed' };

/** "3 files · +12 −4" (the older inline form). */
export function countsHTML(files) {
  const { add, del } = sumFiles(files);
  return files?.length ? `<b>${files.length}</b> ${files.length === 1 ? 'file' : 'files'} · <span class="d-add">+${add}</span> <span class="d-del">−${del}</span>` : 'No file changes';
}
/** The page's sum line: "+412 −88 across 9 files". */
export function sumHTML(files, extra = '') {
  const { add, del } = sumFiles(files);
  const n = files?.length ?? 0;
  return n ? `<span class="jdiffstat num">${statHTML(add, del)}</span><span>across ${n} ${n === 1 ? 'file' : 'files'}${extra}</span>` : `<span>No file changes${extra}</span>`;
}

/** Each file's hunks from a unified diff: path → { from, binary, hunks: [{ head, ctx, lines: [[kind, n, text]] }], cut }. */
export function parsePatch(patch) {
  const out = new Map();
  let cur = null, h = null, oldN = 0, newN = 0;
  for (const line of String(patch ?? '').split('\n')) {
    const m = line.match(/^diff --git a\/(.*?) b\/(.*)$/);
    if (m) { cur = { path: m[2], from: m[1] !== m[2] ? m[1] : null, binary: false, hunks: [], n: 0, cut: 0 }; out.set(cur.path, cur); h = null; continue; }
    if (!cur) continue;
    if (!h) {
      // the file's header: only what it says about a rename or a binary file is kept
      if (line.startsWith('rename from ')) cur.from = line.slice(12);
      else if (/^Binary files /.test(line)) cur.binary = true;
    }
    const hh = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/);
    if (hh) { oldN = +hh[1]; newN = +hh[3]; h = { head: `−${hh[1]},${hh[2] ?? 1} +${hh[3]},${hh[4] ?? 1}`, ctx: hh[5] ?? '', lines: [] }; cur.hunks.push(h); continue; }
    if (!h) continue;
    // Long files are cut so the page stays light; the rest is on the PC.
    if (cur.n >= 400) { cur.cut++; continue; }
    cur.n++;
    if (line.startsWith('+')) h.lines.push(['a', newN++, line.slice(1)]);
    else if (line.startsWith('-')) h.lines.push(['d', oldN++, line.slice(1)]);
    else if (line.startsWith('\\')) h.lines.push(['n', '', line.slice(1).trim()]);
    else { h.lines.push(['', newN, line.slice(1)]); oldN++; newN++; }
  }
  return out;
}

const FOLD = 8;
/** The files as rows: the kind's letter, the name and its folder (or where it was renamed from), the counts.
 *  sel: the picked file's index. Past FOLD files the rest fold behind "Show N more files". */
export function filesGroupHTML(files, sel = 0, { parts = null, open = false } = {}) {
  const list = files ?? [];
  const shown = list.length > FOLD + 1 && !open ? list.slice(0, FOLD).concat(sel >= FOLD ? [list[sel]] : []) : list;
  const row = (f) => {
    const i = list.indexOf(f);
    const k = ST[f.status] ?? 'M';
    const name = f.path.split('/').pop();
    const dir = f.path.slice(0, -name.length);
    const from = parts?.get(f.path)?.from;
    return `<button type="button" class="lrow jfile${i === sel ? ' on' : ''}" data-jfile="${i}" aria-pressed="${i === sel}"><span class="jfk jfk-${k}" role="img" aria-label="${KIND[k]}">${k}</span><span class="rbody"><span class="rtitle mono">${esc(name)}</span><span class="rmeta mono jf-path">${esc(f.status === 'renamed' && from ? `from ${from}` : dir || './')}</span></span><span class="jf-n num">${statHTML(f.add, f.del)}</span></button>`;
  };
  const more = list.length - shown.length;
  return `<div class="group jfiles">${shown.map(row).join('')}${list.length > FOLD + 1 ? `<button type="button" class="lrow jmore" data-jfiles-more aria-expanded="${open}"><span class="rbody">${open ? 'Show fewer files' : `Show ${more} more ${more === 1 ? 'file' : 'files'}`}</span>${open ? AOS.icons.chevU : AOS.icons.chevD}</button>` : ''}</div>`;
}
/** One file's changes, line by line; a long line wraps under its own code, never under the numbers. */
export function fileDiffHTML(f, part) {
  if (!f) return '';
  const k = ST[f.status] ?? 'M';
  let body;
  if (k === 'D') body = `<p class="jdv-note">${f.del} ${f.del === 1 ? 'line' : 'lines'} removed with the file.</p>`;
  else if (part?.binary) body = '<p class="jdv-note">A binary file. Open it on your PC to see it.</p>';
  else if (!part?.hunks.length) body = `<p class="jdv-note">${k === 'R' && part?.from ? `Moved from <span class="mono">${esc(part.from)}</span>${f.add + f.del ? '; ' : '.'}` : ''}${f.add + f.del ? `${f.add + f.del} lines changed. Open it on your PC for the full diff.` : k === 'R' ? '' : 'No line changes.'}</p>`;
  else {
    body = part.hunks.map((h) => `<div class="jdv-hunk mono">@@ ${esc(h.head)} @@ ${esc(h.ctx)}</div><div class="jdv-code mono">${h.lines.map(([t, n, c]) => `<div class="jdl${t ? ` ${t}` : ''}"><i class="jdl-n">${n}</i><i class="jdl-k">${t === 'a' ? '+' : t === 'd' ? '−' : ''}</i><span class="jdl-c">${esc(c) || ' '}</span></div>`).join('')}</div>`).join('')
      + (part.cut ? `<p class="jdv-note">${part.cut} more ${part.cut === 1 ? 'line' : 'lines'} in this file. See them on your PC.</p>` : '');
  }
  return `<div class="jdv" id="jdv"><div class="jdv-h"><span class="jfk jfk-${k}" role="img" aria-label="${KIND[k]}">${k}</span><span class="jdv-p mono">${esc(f.path)}</span><span class="jf-n num">${statHTML(f.add, f.del)}</span></div>${body}</div>`;
}
/** The list and the picked file's diff, wired: tap a file to show it, fold the long list. Redraws only itself. */
export function mountFiles(box, files, patch, { onPick } = {}) {
  const S = { sel: 0, open: false, parts: parsePatch(patch) };
  const draw = () => { box.innerHTML = files?.length ? `${filesGroupHTML(files, S.sel, S)}${fileDiffHTML(files[S.sel], S.parts.get(files[S.sel]?.path))}` : ''; };
  draw();
  box.onclick = (e) => {
    const f = e.target.closest('[data-jfile]');
    if (f) {
      S.sel = Number(f.dataset.jfile);
      AOS.haptic('selection');
      draw();
      onPick?.(S.sel);
      const dv = box.querySelector('#jdv');
      const sc = box.closest('.scroller');
      if (dv && sc) sc.scrollTo({ top: Math.max(0, dv.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 110), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return;
    }
    if (e.target.closest('[data-jfiles-more]')) { S.open = !S.open; AOS.haptic('selection'); draw(); }
  };
  return S;
}

// ---------- The older stacked form (every file's patch in a row), kept for anything that still draws it ----------
export function filesHTML(files) {
  return `<div class="df-files">${(files ?? []).map((f) => `<button type="button" class="df-file" data-jump-file="${esc(f.path)}"><span class="d-st s-${esc(f.status)}">${ST[f.status] ?? 'M'}</span><span class="df-name">${esc(f.path)}</span><span class="df-num"><span class="d-add">+${f.add}</span> <span class="d-del">−${f.del}</span></span></button>`).join('')}</div>`;
}
export function patchHTML(patch, files) {
  const parts = [];
  for (const line of String(patch ?? '').split('\n')) {
    const m = line.match(/^diff --git a\/(.*?) b\/(.*)$/);
    if (m) { parts.push({ path: m[2], lines: [] }); continue; }
    const cur = parts.at(-1);
    if (!cur || /^(index |--- |\+\+\+ |similarity |rename |new file mode|deleted file mode)/.test(line)) continue;
    cur.lines.push(line);
  }
  return parts.map((p) => {
    const f = (files ?? []).find((x) => x.path === p.path);
    const shown = p.lines.slice(0, 400);
    return `<section class="df-patch" data-file="${esc(p.path)}"><h4><span class="d-st s-${esc(f?.status ?? 'modified')}">${ST[f?.status] ?? 'M'}</span>${esc(p.path)}</h4><pre>${shown.map((l) => `<span class="${l.startsWith('@@') ? 'l-hunk' : l.startsWith('+') ? 'l-add' : l.startsWith('-') ? 'l-del' : l.startsWith('\\') ? 'l-note' : ''}">${esc(l) || ' '}\n</span>`).join('')}${p.lines.length > shown.length ? `<span class="l-note">… ${p.lines.length - shown.length} more lines (see it on the PC)\n</span>` : ''}</pre></section>`;
  }).join('');
}
// Tap a file in the stacked list: scroll its patch into view.
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-jump-file]');
  if (!b) return;
  const box = b.closest('.detail-content') ?? document;
  box.querySelector(`.df-patch[data-file="${CSS.escape(b.dataset.jumpFile)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
});

// A job's Changes page: what the agent changed in its folder, for the whole job or one turn. The files as a list, the
// one you pick line by line, then Undo turn N (or Undo every change for the whole job), asked first.
// Opened from a "N files changed" card in the chat or the hero's +/− counts. id = "<jobId>~<turn>" (0 = whole job).
import { putJob, jobById } from './state.js';
import { sumHTML, mountFiles } from './diff.js';
import { ask } from './board.js';

const { AOS } = window;
const { esc } = AOS;
const I = AOS.icons;
const $ = (s, el = document) => el.querySelector(s);
const err = (e) => (e?.status ? e.message : 'Your PC isn’t reachable right now');

function render(box, id, el) {
  const [jobId, t] = String(id).split('~');
  const S = { jobId, turn: Number(t) || 0, data: null, busy: false };
  box.classList.add('jobdiff-page');
  el.querySelector('.nav-title').textContent = 'Changes';
  box.innerHTML = '<div class="phead"><h1 class="lt">Changes</h1><p class="sub jc-sum"></p></div><div class="chips scroll jd-turns" role="tablist" aria-label="Turns"></div><div class="jd-files"></div><div class="jundo-w"></div>';
  const working = () => { const j = jobById(jobId); return !!j && ['starting', 'running', 'needs_input'].includes(j.status); };
  const draw = () => {
    const j = jobById(jobId);
    const turns = j?.turns ?? 0;
    const d = S.data;
    $('.jc-sum', box).innerHTML = !d ? 'Loading the changes…' : d.error ? esc(d.error) : sumHTML(d.files, d.live && working() ? ' · still working' : '');
    $('.jd-turns', box).innerHTML = turns ? [0, ...Array.from({ length: turns }, (_, i) => i + 1)].map((n) => `<button type="button" role="tab" aria-selected="${n === S.turn}" class="chip-btn${n === S.turn ? ' on' : ''}" data-jd-turn="${n}">${n ? `Turn ${n}` : 'Whole job'}</button>`).join('') : '';
    const files = $('.jd-files', box);
    if (!d) files.innerHTML = '';
    else if (d.error) files.innerHTML = `<p class="empty-line">${esc(d.error)}</p>`;
    else if (!d.files.length) files.innerHTML = `<p class="empty-line">No file changes ${S.turn ? 'in this turn' : 'in this job'}.</p>`;
    else if (files._for !== d) { files._for = d; mountFiles(files, d.files, d.patch); }
    const can = !!d && !d.error && d.files.length > 0;
    $('.jundo-w', box).innerHTML = can ? `<button type="button" class="btn block jundo" data-jd="undo" ${working() || S.busy ? 'disabled' : ''}>${I.undo}${S.busy ? 'Undoing…' : S.turn ? `Undo turn ${S.turn}` : 'Undo every change'}</button>
<p class="foot">${working() ? 'Wait for the agent to finish first.' : `Files go back to how they were before ${S.turn ? `turn ${S.turn}` : 'this job'}.`}</p>` : '';
  };
  const load = async () => {
    S.data = null; draw();
    try { S.data = await AOS.api(`/jobs/${jobId}/diff?turn=${S.turn}`); } catch (e) { S.data = { files: [], patch: '', error: err(e) }; }
    draw();
  };
  box.addEventListener('click', async (e) => {
    const tb = e.target.closest('[data-jd-turn]');
    if (tb) { const n = Number(tb.dataset.jdTurn); if (n === S.turn) return; S.turn = n; AOS.haptic('selection'); load(); return; }
    if (!e.target.closest('[data-jd="undo"]') || S.busy || working()) return;
    const j = jobById(jobId);
    const turns = j?.turns ?? 0;
    // The whole job goes back to before its first turn; a turn takes the later turns' changes with it.
    const n = S.turn || 1;
    const ok = await ask(S.turn
      ? { title: `Undo turn ${S.turn}?`, body: `Files go back to how they were before turn ${S.turn}.${S.turn < turns ? ' Later turns’ changes go too.' : ''} This can’t be brought back from the phone.`, ok: `Undo turn ${S.turn}`, cancel: 'Keep', danger: true }
      : { title: 'Undo every change?', body: 'Files go back to how they were before this job. This can’t be brought back from the phone.', ok: 'Undo every change', cancel: 'Keep', danger: true });
    if (!ok) return;
    S.busy = true; draw();
    try {
      const r = await AOS.api(`/jobs/${jobId}/revert`, { method: 'POST', body: JSON.stringify({ turn: n }) });
      if (r.job) putJob(r.job);
      AOS.haptic('success');
      AOS.toast(`Put back: ${AOS.plural(r.restored, 'file')} restored, ${r.removed} removed`);
    } catch (er) { AOS.toast(err(er)); }
    S.busy = false;
    load();
  });
  load();
}
AOS.detail('jobdiff', { render });
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-open-jobdiff]');
  if (!b) return;
  const top = AOS.topDetail();
  if (top?.dataset.kind === 'jobdiff' && top.dataset.id === b.dataset.openJobdiff) return;
  AOS.push('jobdiff', b.dataset.openJobdiff);
});

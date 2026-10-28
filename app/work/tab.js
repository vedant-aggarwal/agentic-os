// The Jobs tab: one line of what is happening on the PC, then Board · Projects · Ideas. The board (lanes, swipes, hold
// menus, builders, terminals) is board.js's and code.js's; Projects and Ideas are projects.js's. Area (b) owns this file
// (app/ui/STRUCTURE.md). Pushed pages (a job's chat, a project, a terminal, a copy, a Builder) slide over this tab.
import { W, onChange } from './state.js';
import { mountBoard } from './code.js';
import { boardCounts } from './board.js';
import { renderProjectsList, mountIdeas } from './projects.js';

const { AOS } = window;
const { esc } = AOS;
const $ = (s, el = document) => el.querySelector(s);
const SEGS = ['board', 'projects', 'ideas'];

function counts() {
  const ideas = W.ideas.filter((i) => (i.status ?? 'open') === 'open').length;
  return { ...boardCounts(), projects: AOS.liveProjects().length, ideas };
}
// "PC online · 2 need you · 1 working · 1 to review · 14 stopped": only what is true now. Each count is also the way
// to its lane: a tap scrolls the board there.
function summaryHTML(c) {
  const part = ([id, n, label, cls = '']) => `<button type="button" class="jsum-p${cls ? ` ${cls}` : ''}" data-jlane="${id}"><b class="met">${n}</b>${label}</button>`;
  // the three most urgent counts, so the line stays one line: what asks you, what runs, what to review, what stopped
  const parts = [['needs', c.needs, c.needs === 1 ? 'needs you' : 'need you', 'amber'], ['working', c.working, 'working'], ['review', c.review, 'to review'], ['stopped', c.stopped, 'stopped']]
    .filter(([, n]) => n).slice(0, 3).map(part).join('');
  // only claim the PC is online when the last sync reached it
  const st = AOS.syncStatus?.() ?? 'ok';
  const reach = st === 'ok';
  const pc = !AOS.real ? 'Jobs run on the owner’s PC' : !reach ? (st === 'error' ? 'Your PC hit an error' : 'Your PC isn’t reachable') : W.termDown ? 'PC online, terminal host off' : 'PC online';
  return `<span class="live-dot${reach ? '' : ' needs'}" aria-hidden="true"></span><span>${esc(pc)}</span>${parts || (reach && AOS.real ? '<span class="jsum-q">all quiet</span>' : '')}`;
}

function draw(el) {
  if (!el) return;
  const ui = AOS.ui();
  if (!SEGS.includes(ui.jobsSeg)) ui.jobsSeg = 'board';
  const c = counts();
  if (!el._built) {
    el._built = true;
    el.innerHTML = `<div class="phead jobs-head"><h1 class="large-title">Jobs</h1><p class="sub jobs-sum"></p></div>
<div class="jobs-seg">${AOS.seg('jobs', [['board', 'Board'], ['projects', 'Projects<span class="n"></span>'], ['ideas', 'Ideas<span class="n"></span>']], ui.jobsSeg, { role: 'tab', label: 'Jobs' })}</div>
<div class="jobs-body"></div>`;
    const acts = document.getElementById('jobsActs');
    if (acts) acts.innerHTML = `<button class="nav-icon" data-board-settings aria-label="Board settings">${AOS.icons.gear}</button>${AOS.owner && AOS.real ? `<button class="nav-pill strong" data-code-new style="--c:var(--jobs-fill)">${AOS.icons.plus}New</button>` : ''}`;
  }
  const sum = $('.jobs-sum', el);
  const sh = summaryHTML(c);
  if (sum._html !== sh) { sum.innerHTML = sh; sum._html = sh; }
  const segEl = $('.segmented[data-seg="jobs"]', el);
  const setN = (v, n) => { const s = $(`[data-v="${v}"] .n`, segEl); if (s && s.textContent !== String(n || '')) s.textContent = n || ''; };
  setN('projects', c.projects);
  setN('ideas', c.ideas);
  let body = $('.jobs-body', el);
  if (body.dataset.seg !== ui.jobsSeg) {
    // a fresh body per segment, so one segment's redraw hooks never act on another's markup
    const swapped = !!body.dataset.seg;
    const fresh = document.createElement('div');
    fresh.className = `jobs-body${swapped ? ' swap' : ''}`;
    fresh.dataset.seg = ui.jobsSeg;
    body.replaceWith(fresh);
    body = fresh;
    AOS.selectSeg(segEl, ui.jobsSeg);
    if (ui.jobsSeg === 'board') mountBoard(body);
    else if (ui.jobsSeg === 'ideas') mountIdeas(body);
    else renderProjectsList(body);
    if (swapped) AOS.pulse(body);
  } else if (ui.jobsSeg === 'projects') renderProjectsList(body);
}

AOS.tab('jobs', (el) => draw(el));
document.addEventListener('segchange', (e) => {
  if (e.target.dataset?.seg !== 'jobs') return;
  AOS.ui().jobsSeg = e.detail;
  draw(document.getElementById('jobsContent'));
});
onChange(() => { if (AOS.ui().tab === 'jobs') draw(document.getElementById('jobsContent')); });

// The summary is the board's index: a count scrolls to its lane (switching to Board first).
document.addEventListener('click', (e) => {
  const b = e.target.closest('.jobs-sum [data-jlane]');
  if (!b) return;
  const el = document.getElementById('jobsContent');
  const go = () => {
    const t = document.getElementById(`lane-${b.dataset.jlane}`);
    const sc = el?.closest('.scroller');
    if (t && sc) sc.scrollTo({ top: Math.max(0, t.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - 96), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  AOS.haptic('selection');
  if (AOS.ui().jobsSeg !== 'board') { AOS.ui().jobsSeg = 'board'; draw(el); requestAnimationFrame(go); } else go();
});

// The Jobs tab carries the Needs you count (asks, replies waiting on you, failures, terminals that ask), the same
// number as the summary line, so it falls as you answer (state.js still keeps the working dot, #projectsDot)
function badge() {
  const b = document.getElementById('jobsBadge');
  if (!b) return;
  const n = boardCounts().needs;
  b.hidden = !n;
  b.textContent = n || '';
  b.setAttribute('aria-label', `${n} need you`);
}
onChange(badge);
badge();

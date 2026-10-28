// Work · review: what a job changed, read and judged file by file on the phone, then shipped.
// Changes groups the files by checkpoint (one per turn). Swipe a file right to keep it, left to revert it, or open it
// to read the diff with Keep and Revert under the thumb. When every file is judged, Ship takes what you kept: merge
// the job's copy into main as one commit, open a PR, or hand it to the Builder.
import { $, $$, esc, push, pop, openSheet, closeSheet, toast, on, haptic, swipeRows } from './core.js';
import { I } from './icons.js';
import { BUILDERS } from './data.js';
import { CHANGES, THREADS, REPOS, SUMMARY } from './work-data.js';
import { W, WI, job, project, stat, backLabel, agentName, changed, repoOf } from './work-ui.js';
import { api } from './bus.js';

const FK = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed' };
export const filesOf = (j) => CHANGES[j.id] ?? [];
const rv = (j) => (W.review[j.id] ??= {});
export const reviewOf = (j) => { const fs = filesOf(j), r = rv(j); const kept = fs.filter((f) => r[f.path] === 'kept').length, rev = fs.filter((f) => r[f.path] === 'reverted').length; return { n: fs.length, kept, rev, left: fs.length - kept - rev }; };
const sum = (fs) => fs.reduce((t, f) => [t[0] + f.a, t[1] + f.d], [0, 0]);
export const turnFiles = (j, n) => filesOf(j).filter((f) => !n || f.turn === n);
const turnAt = (j, n) => THREADS[j.id]?.[n - 1]?.at ?? '';
const name = (p) => p.split('/').pop();
const dir = (p) => p.slice(0, -name(p).length) || './';

// ── the Changes page ──────────────────────────────────────────────────
export function openChanges(j, { turn = 0 } = {}) {
  if (!j || !filesOf(j).length) return;
  const st = { turn };
  push({
    title: 'Changes', back: backLabel(),
    right: `<button class="gbtn chrome icon" data-act="wr-menu" data-id="${j.id}" aria-label="More">${I.dots}</button>`,
    render(sc, page) {
      page.classList.add('jpage', 'wr-page');
      page.dataset.job = j.id;
      const draw = () => { sc.innerHTML = changesHtml(j, st); };
      page._redraw = draw; page._st = st;
      draw();
      sc.addEventListener('click', (e) => {
        const t = e.target.closest('[data-turn]'); if (!t) return;
        st.turn = Number(t.dataset.turn); haptic(5); draw();
      });
      swipeRows(sc, '.wr-file', {
        right: (r) => judge(j, r.dataset.path, 'kept'),
        left: (r) => judge(j, r.dataset.path, 'reverted'),
      });
    },
  });
}
function changesHtml(j, st) {
  const turns = Math.max(0, ...filesOf(j).map((f) => f.turn));
  const fs = turnFiles(j, st.turn); const [a, d] = sum(fs); const r = rv(j);
  const done = fs.filter((f) => r[f.path]).length;
  const all = reviewOf(j);
  const chip = (n, label, sub) => `<button class="wr-cp${st.turn === n ? ' on' : ''}" data-turn="${n}" role="tab" aria-selected="${st.turn === n}"><b>${label}</b>${sub ? `<span class="num">${sub}</span>` : ''}</button>`;
  return `<div class="phead"><h1 class="lt">Changes</h1><p class="sub num wr-sum">${stat(a, d)}<span>across ${fs.length} file${fs.length === 1 ? '' : 's'}${st.turn ? ` in turn ${st.turn}` : ''}</span></p></div>
    <div class="wr-cps" role="tablist" aria-label="Checkpoints" data-scroll-x>${chip(0, 'Every turn', '')}${Array.from({ length: turns }, (_, i) => chip(i + 1, `Turn ${i + 1}`, turnAt(j, i + 1))).join('')}</div>
    ${proofCard(j, st.turn)}
    <div class="wr-meter" role="img" aria-label="${done} of ${fs.length} files reviewed">
      <span class="wr-m-t"><b class="met">${done}</b><small> of ${fs.length} reviewed</small></span>
      <span class="wr-m-k">${all.kept ? `<span class="c-jobs">${all.kept} kept</span>` : ''}${all.rev ? `<span class="wr-rv">${all.rev} reverted</span>` : ''}</span>
      <span class="wr-bar" aria-hidden="true">${fs.map((f) => `<i class="${r[f.path] ?? ''}"></i>`).join('')}</span>
    </div>
    <div class="group wr-files">${fs.map((f) => fileRow(j, f)).join('')}</div>
    <p class="hint">Swipe a file right to keep it, left to revert it. Tap it to read the diff.</p>
    <div class="pad wr-acts">
      ${all.left === 0 && all.kept ? `<button class="btn primary block" style="--c:var(--jobs-fill)" data-act="wr-ship" data-id="${j.id}">${j.worktree ? WI.merge : WI.commit}Ship ${all.kept} file${all.kept === 1 ? '' : 's'}</button>`
        : `<button class="btn primary block" style="--c:var(--jobs-fill)" data-act="wr-keep-rest" data-id="${j.id}">${I.check}Keep ${all.left === all.n ? 'all' : `the other ${all.left}`} and ship</button>`}
      ${turns > 1 || st.turn ? `<button class="btn block wr-undo" data-act="wr-undo" data-id="${j.id}" data-turn="${st.turn || turns}">${WI.revert}Undo turn ${st.turn || turns}</button>` : `<button class="btn block wr-undo" data-act="wr-undo" data-id="${j.id}" data-turn="0">${WI.revert}Undo every change</button>`}
      <p class="foot">${st.turn || turns > 1 ? `Files go back to the checkpoint before turn ${st.turn || turns}, at ${esc(turnAt(j, st.turn || turns))}. The chat stays.` : 'Files go back to how they were before this job. The chat stays.'}</p>
    </div>`;
}
// before the diff: what the agent says it did, and the evidence that it works (tests, builds), turn by turn
function proofCard(j, turn) {
  const ts = THREADS[j.id] ?? []; const picked = turn ? [ts[turn - 1]].filter(Boolean) : ts;
  const said = (!turn && SUMMARY[j.id]) || picked.map((t) => t.ai).filter(Boolean).slice(-1)[0];
  const proof = picked.flatMap((t) => t.steps ?? []).filter(([k, , d]) => (k === 'term' || k === 'hammer') && d && !/^Running|^Waiting/.test(d)).map(([k, t, d]) => [k === 'hammer' ? I.hammer : WI.checkC, k === 'hammer' ? d : `${t.split(' ').slice(0, 3).join(' ')} · ${d}`]);
  if (!said && !proof.length) return '';
  return `<div class="wr-proof surface">
    <p class="wr-pf-h">${I[j.agent]}<b>${turn ? `Turn ${turn}` : 'What it did'}</b><span class="cap">${agentName(j.agent)}</span></p>
    ${said ? `<p class="wr-pf-s">${esc(said)}</p>` : ''}
    ${proof.length ? `<div class="wr-pf-c">${proof.map(([ic, t]) => `<span class="wr-pf">${ic}<span class="mono-ish">${esc(t)}</span></span>`).join('')}</div>` : ''}
  </div>`;
}
function fileRow(j, f) {
  const s = rv(j)[f.path];
  return `<button class="row wr-file${s ? ` is-${s}` : ''}" data-act="wr-open" data-id="${j.id}" data-path="${esc(f.path)}" data-swipe-host>
    <span class="fk fk-${f.k}" role="img" aria-label="${FK[f.k]}">${f.k}</span>
    <span class="rbody"><span class="rtitle mono">${esc(name(f.path))}</span><span class="rmeta mono jf-path">${esc(f.k === 'R' ? `from ${f.from}` : dir(f.path))}</span></span>
    <span class="jf-n num">${stat(f.a, f.d)}</span>
    <span class="wr-st" aria-label="${s === 'kept' ? 'Kept' : s === 'reverted' ? 'Reverted' : 'Not reviewed'}">${s === 'kept' ? I.check : s === 'reverted' ? WI.revert : ''}</span>
  </button>`;
}
// keep or revert one file; the page you are on redraws, the toast can take it back
function judge(j, path, v) {
  const r = rv(j); const was = r[path];
  if (was === v) delete r[path]; else r[path] = v;
  haptic(v === 'kept' ? 10 : 14);
  redrawReview(j);
  if (r[path]) toast(`${v === 'kept' ? 'Kept' : 'Reverted'} ${name(path)}`, () => { if (was) r[path] = was; else delete r[path]; redrawReview(j); });
  const left = reviewOf(j).left;
  if (!left && reviewOf(j).kept) setTimeout(() => toast('Every file reviewed. Ready to ship'), 2700);
}
const redrawReview = (j) => { $$(`#stack .wr-page[data-job="${j.id}"], #stack .wf-page[data-job="${j.id}"]`).forEach((p) => p._redraw?.()); changed({ job: j.id }); };

// ── one file: its diff, and Keep / Revert under the thumb ──────────────
export function openFile(j, path) {
  const fs = filesOf(j); const st = { i: Math.max(0, fs.findIndex((f) => f.path === path)) };
  push({
    title: name(path), back: 'Changes',
    titleHtml: `<span class="wf-pos num"></span>`,
    right: `<button class="gbtn chrome icon" data-act="wf-step" data-d="-1" aria-label="Previous file">${I.chevU}</button><button class="gbtn chrome icon" data-act="wf-step" data-d="1" aria-label="Next file">${I.chevD}</button>`,
    render(sc, page) {
      page.classList.add('jpage', 'wf-page');
      page.dataset.job = j.id;
      page.insertAdjacentHTML('beforeend', '<div class="wf-bar chrome"></div>');
      const draw = () => {
        const f = fs[st.i]; const s = rv(j)[f.path];
        $('.tb-title', page).innerHTML = `${esc(name(f.path))}<small class="num">${st.i + 1} of ${fs.length}</small>`;
        $('.tb-title', page).classList.add('always');
        sc.innerHTML = fileHtml(f, s, j);
        $('.wf-bar', page).innerHTML = `<button class="btn wf-rev${s === 'reverted' ? ' on' : ''}" data-act="wf-judge" data-v="reverted" aria-pressed="${s === 'reverted'}">${WI.revert}${s === 'reverted' ? 'Reverted' : 'Revert'}</button>
          <button class="btn wf-keep${s === 'kept' ? ' on' : ''}" data-act="wf-judge" data-v="kept" aria-pressed="${s === 'kept'}" style="--c:var(--jobs-fill)">${I.check}${s === 'kept' ? 'Kept' : 'Keep'}</button>`;
        sc.scrollTop = 0;
      };
      page._redraw = draw; page._wf = { st, fs, j };
      draw();
    },
  });
}
const comments = (j, path) => ((W.comments ??= {})[j.id] ??= {})[path] ??= new Set();
function fileHtml(f, s, j) {
  const cm = j ? comments(j, f.path) : new Set();
  const body = f.hunks ? f.hunks.map((h) => hunkHtml(h, cm)).join('')
    : f.k === 'D' ? `<p class="dv-note">${f.d} lines removed with the file.</p>`
    : `<p class="dv-note">${f.k === 'R' ? `Moved from <span class="mono">${esc(f.from)}</span>. ` : ''}${f.a + f.d} lines changed. The full diff is on your PC.</p><div class="pad wf-pc"><button class="btn sm" data-act="wf-pc" data-path="${esc(f.path)}">${WI.pc}Open on the PC</button></div>`;
  return `<div class="wf-head">
      <span class="fk fk-${f.k}" role="img" aria-label="${FK[f.k]}">${f.k}</span>
      <span class="wf-p"><b class="mono">${esc(name(f.path))}</b><span class="mono">${esc(f.k === 'R' ? `from ${f.from}` : dir(f.path))}</span></span>
      <span class="jf-n num">${stat(f.a, f.d)}</span>
    </div>
    ${s ? `<p class="wf-said ${s}">${s === 'kept' ? I.check : WI.revert}${s === 'kept' ? 'You kept this file' : 'You reverted this file. It goes back to main when you ship'}</p>` : ''}
    <div class="dv surface">${body}</div>
    ${f.hunks ? `<p class="hint">Tap a line to comment on it. Comments go with your next message${cm.size ? `: ${cm.size} so far` : ''}.</p>` : ''}`;
}
// a removed line and the added line after it highlight only the words that changed
function pairWords(a, b) {
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let k = 0; while (k < a.length - i && k < b.length - i && a[a.length - 1 - k] === b[b.length - 1 - k]) k++;
  const mid = (s) => s.length - i - k;
  if (mid(a) > a.length * .7 && mid(b) > b.length * .7) return null;
  // only the side that has changed words gets a highlight; an empty one would leave a sliver
  const w = (s) => (mid(s) > 0 ? `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, s.length - k))}</mark>${esc(s.slice(s.length - k))}` : esc(s));
  return [w(a), w(b)];
}
function hunkHtml(h, cm = new Set()) {
  if (h[0] === '~') return `<div class="dv-fold" role="separator"><span>${h[1]} unchanged lines</span></div>`;
  const [range, ctx, lines] = h;
  const html = lines.map(([k, n, l]) => [k, n, esc(l)]);
  for (let x = 0; x < lines.length - 1; x++) {
    if (lines[x][0] === '-' && lines[x + 1][0] === '+') { const p = pairWords(lines[x][2], lines[x + 1][2]); if (p) { html[x][2] = p[0]; html[x + 1][2] = p[1]; } }
  }
  return `<div class="dv-hunk mono">@@ ${esc(range)} @@${ctx ? ` <span>${esc(ctx)}</span>` : ''}</div>
    <div class="dv-code mono">${html.map(([k, n, l]) => { const key = `${k}${n}`; return `<div class="dl${k === '+' ? ' a' : k === '-' ? ' d' : ''}${cm.has(key) ? ' has-c' : ''}" role="button" tabindex="0" data-ln="${n}" data-k="${k === '-' ? '-' : '+'}" aria-label="Line ${n}${cm.has(key) ? ', has your comment' : ''}"><i class="dl-n">${n}</i><i class="dl-k">${k === '+' ? '+' : k === '-' ? '−' : ''}</i><span class="dl-c">${l || ' '}</span></div>`; }).join('')}</div>`;
}
// tap a line to steer: the comment rides along with your next message as file:line
document.addEventListener('click', (e) => {
  const ln = e.target.closest('.wf-page .dl[data-ln]'); if (!ln) return;
  const pg = ln.closest('.page'); const w = pg?._wf; if (!w) return;
  const f = w.fs[w.st.i]; const n = ln.dataset.ln; const key = `${ln.dataset.k === '-' ? '-' : '+'}${n}`;
  const line = ln.querySelector('.dl-c')?.textContent.trim() ?? '';
  openSheet({ title: `Line ${n}`, sub: `${esc(name(f.path))} · goes with your next message to ${agentName(w.j.agent)}`, body: (b) => {
    b.innerHTML = `<div class="pad"><pre class="wf-cl mono">${esc(line.slice(0, 120))}</pre>
      <label class="field wf-cta"><textarea rows="3" placeholder="What should change here?" aria-label="Your comment"></textarea></label>
      <button class="btn primary block" style="--c:var(--jobs-fill)" data-act="wf-comment" disabled>Add to my next message</button></div>`;
    const ta = $('textarea', b), btn = $('.btn', b);
    ta.addEventListener('input', () => { btn.disabled = !ta.value.trim(); });
    b._c = { j: w.j, f, n, key, pg };
    setTimeout(() => ta.focus(), 420);
  } });
});
on('wf-comment', (el) => {
  const b = el.closest('.sheet-body'); const c = b?._c; const text = $('textarea', b)?.value.trim(); if (!c || !text) return;
  comments(c.j, c.f.path).add(c.key);
  ((W.attach ??= {})[c.j.id] ??= []).push({ icon: I.chat, label: `${name(c.f.path)}:${c.n} · ${text}` });
  closeSheet(el.closest('.sheet')); haptic(8); c.pg._redraw?.(); changed({ job: c.j.id });
  toast(`Comment added. It goes with your next message to ${agentName(c.j.agent)}`);
});
on('wr-open', (el) => { const j = job(el.dataset.id); if (j) openFile(j, el.dataset.path); });
on('wf-step', (el) => {
  const pg = el.closest('.page'); const w = pg?._wf; if (!w) return;
  w.st.i = (w.st.i + Number(el.dataset.d) + w.fs.length) % w.fs.length; haptic(5); pg._redraw();
});
on('wf-judge', (el) => {
  const pg = el.closest('.page'); const w = pg?._wf; if (!w) return;
  const f = w.fs[w.st.i]; const r = rv(w.j); const v = el.dataset.v;
  if (r[f.path] === v) delete r[f.path]; else r[f.path] = v;
  haptic(v === 'kept' ? 10 : 14);
  // a judged file moves you on to the next one you have not looked at
  const next = w.fs.findIndex((x, i) => i > w.st.i && !r[x.path]);
  const wrap = next < 0 ? w.fs.findIndex((x) => !r[x.path]) : next;
  if (r[f.path] && wrap >= 0) setTimeout(() => { w.st.i = wrap; pg._redraw(); }, 260);
  else if (r[f.path] && wrap < 0) setTimeout(() => { pop(); toast('Every file reviewed. Ready to ship'); }, 320);
  pg._redraw(); redrawReview(w.j);
});
on('wf-pc', (el) => toast(`Opens ${name(el.dataset.path)} in your editor on the PC`));

// ── ship: what you kept leaves the job ────────────────────────────────
const MSG = {
  j14: ['Make a separate copy the default for new jobs', ['Jobs start in a worktree on aos/<name>, with node_modules shared in', 'Separate copy comes first in the Where picker', 'Tests for copies and the merge back: 58 pass', 'docs/jobs.md explains copies']],
  j5: ['Show the running job\'s step in a Live Activity', ['The island shows the job, its step and n of N', 'It turns orange when the job needs you', 'server/activity.ts pushes each step to the phone']],
  j12: ['Keyboard: wait for the Photos grant before attaching', ['Falls back to the shared app-group container', '52 server tests pass']],
  j15: ['New UI mockup: liquid glass, Home and Jobs', ['Tab bar with the sliding lens', 'Home tasks behind a switch', 'Jobs board with lanes and rings']],
};
const ROUTES = {
  copy: [['merge', WI.merge, 'Merge into main as one commit', (j) => `Squashes feat/${j.id} onto main and removes the copy`],
    ['pr', WI.pr, 'Push and open a pull request', (j) => `feat/${j.id} into main on GitHub, for a second look`],
    ['builder', I.hammer, 'Hand to the Builder', () => 'Merges, tests, builds and restarts once no job is busy']],
  folder: [['commit', WI.commit, 'Commit to main', () => 'One commit on the branch you are on'],
    ['push', WI.push, 'Commit and push', () => 'Then push main to origin'],
    ['pr', WI.pr, 'Commit to a branch and open a PR', (j) => `On feat/${j.id}, into main on GitHub`]],
};
export function shipSheet(j) {
  const fs = filesOf(j); const r = rv(j);
  const kept = fs.filter((f) => r[f.path] !== 'reverted'); const reverted = fs.length - kept.length;
  const [ka, kd] = sum(kept);
  const routes = ROUTES[j.worktree ? 'copy' : 'folder'];
  const hasBuilder = BUILDERS.some((b) => b.project === j.project);
  const list = routes.filter(([k]) => k !== 'builder' || hasBuilder);
  const [title, body] = MSG[j.id] ?? [j.title, []];
  const st = { how: list[0][0] };
  openSheet({
    title: 'Ship the changes', sub: `${kept.length} file${kept.length === 1 ? '' : 's'} · <span class="diffstat num">${stat(ka, kd)}</span>${reverted ? ` · ${reverted} reverted` : ''}`, cls: 'wr-ship-sheet',
    body: (b) => {
      b.innerHTML = `<div class="pad">
        <p class="wr-lbl">Commit message</p>
        <div class="wr-msg">
          <textarea class="wr-msg-t" rows="2" aria-label="Commit title">${esc(title)}</textarea>
          <textarea class="wr-msg-b" rows="${Math.max(3, body.length)}" aria-label="Commit body">${esc(body.map((x) => `- ${x}`).join('\n'))}</textarea>
        </div>
        <p class="wr-ai">${I.sparkle}<span>Written from the job's ${THREADS[j.id]?.length ?? 1} turn${(THREADS[j.id]?.length ?? 1) === 1 ? '' : 's'} and the files you kept.</span><button class="btn sm" data-act="wr-rewrite">Rewrite</button></p>
        <p class="wr-lbl">How it leaves</p>
        <div class="group wr-routes" role="radiogroup">${list.map(([k, ic, t, sub]) => `<button class="row ic wr-route${k === st.how ? ' on' : ''}" role="radio" aria-checked="${k === st.how}" data-act="wr-how" data-k="${k}"><span class="tile">${ic}</span><span class="rbody"><span class="rtitle">${t}</span><span class="rmeta"><span class="ell">${esc(sub(j))}</span></span></span><span class="o-r" aria-hidden="true"></span></button>`).join('')}</div>
        <button class="btn primary block wr-go" style="--c:var(--jobs-fill)" data-act="wr-go" data-id="${j.id}">${goLabel(list[0][0])}</button>
        <p class="foot wr-go-n">${reverted ? `The ${reverted} reverted file${reverted === 1 ? ' goes' : 's go'} back to main's version first.` : 'Every file goes as the job left it.'}</p>
      </div>`;
      b._st = st;
    },
  });
}
const goLabel = (k) => ({ merge: 'Merge into main', pr: 'Open the pull request', builder: 'Hand to the Builder', commit: 'Commit', push: 'Commit and push' }[k]);
on('wr-how', (el) => {
  const b = el.closest('.sheet-body'); b._st.how = el.dataset.k; haptic(5);
  $$('.wr-route', b).forEach((r) => { const on = r === el; r.classList.toggle('on', on); r.setAttribute('aria-checked', String(on)); });
  $('.wr-go', b).textContent = goLabel(el.dataset.k);
});
on('wr-rewrite', (el) => {
  const b = el.closest('.sheet-body'); const t = $('.wr-msg-t', b);
  el.disabled = true; el.innerHTML = '<span class="spin" aria-label="Rewriting"></span>';
  setTimeout(() => { t.value = t.value.startsWith('Make') ? 'Jobs open in their own copy by default' : t.value.replace(/^./, (c) => c.toUpperCase()); el.disabled = false; el.textContent = 'Rewrite'; haptic(6); }, 900);
});
// the button says what is happening while it happens, the way a commit, a push and a PR really go
const STAGES = { merge: ['Squashing into one commit…', 'Merging into main…'], pr: ['Writing the PR…', 'Pushing the branch…', 'Opening the pull request…'], builder: ['Handing it over…'], commit: ['Committing…'], push: ['Committing…', 'Pushing…'] };
on('wr-go', (el) => {
  const b = el.closest('.sheet-body'); if (el.dataset.busy) return;
  const how = b._st.how; const steps = STAGES[how] ?? ['Working…'];
  el.dataset.busy = '1'; el.disabled = true; haptic(10);
  steps.forEach((t, i) => setTimeout(() => { el.innerHTML = `<span class="spin" style="--c:var(--on-color)"></span>${t}`; }, i * 520));
  setTimeout(() => ship(el, b, how), steps.length * 520 + 180);
});
function ship(el, b, how) {
  const j = job(el.dataset.id); if (!j) return;
  const before = { lane: j.lane, ship: j.ship };
  const repo = REPOS[j.project];
  closeSheet(el.closest('.sheet')); haptic(16);
  if (how === 'merge' || how === 'commit' || how === 'push') { W.shipped[j.id] = how === 'merge' ? 'merged' : 'committed'; j.lane = 'done'; j.ship = j.ship === 'building' ? j.ship : 'none'; if (repo) { repo.ahead = (repo.ahead ?? 0) + (how === 'push' ? 0 : 1); repo.commit = ['f3e21c7', $('.wr-msg-t', b)?.value ?? j.title, 'now']; } }
  else if (how === 'pr') { W.shipped[j.id] = 'pr'; j.lane = 'done'; if (repo) repo.pr = { n: 42, title: j.title, job: j.id, state: 'open', checks: 'running' }; }
  else { W.shipped[j.id] = 'builder'; j.ship = 'queued'; }
  changed({ job: j.id });
  $$(`#stack .wr-page[data-job="${j.id}"]`).forEach(() => pop());
  const words = { merge: `Merged into main as one commit`, commit: 'Committed to main', push: 'Committed and pushed', pr: `Opened PR #42 · ${project(j.project)?.name}`, builder: `Queued for the ${project(j.project)?.name} Builder` }[how];
  toast(words, () => { j.lane = before.lane; j.ship = before.ship; delete W.shipped[j.id]; changed({ job: j.id }); });
}
on('wr-ship', (el) => { const j = job(el.dataset.id); if (j) shipSheet(j); });
on('wr-keep-rest', (el) => {
  const j = job(el.dataset.id); if (!j) return; const r = rv(j);
  filesOf(j).forEach((f) => { if (!r[f.path]) r[f.path] = 'kept'; });
  haptic(12); redrawReview(j); setTimeout(() => shipSheet(j), 220);
});
on('wr-undo', (el) => {
  const j = job(el.dataset.id); if (!j) return; const n = Number(el.dataset.turn); const r = rv(j);
  const fs = turnFiles(j, n); const was = Object.fromEntries(fs.map((f) => [f.path, r[f.path]]));
  fs.forEach((f) => { r[f.path] = 'reverted'; });
  haptic(16); redrawReview(j);
  toast(n ? `Turn ${n} undone: ${fs.length} file${fs.length === 1 ? '' : 's'} back to ${turnAt(j, n)}` : 'Every change undone', () => { fs.forEach((f) => { if (was[f.path]) r[f.path] = was[f.path]; else delete r[f.path]; }); redrawReview(j); });
});
on('wr-menu', (el) => {
  const j = job(el.dataset.id);
  openSheet({ title: 'Changes', sub: `${esc(j.title)} · ${agentName(j.agent)}`, body: `<div class="group">
    <button class="row ic" data-act="wr-all" data-v="kept" data-id="${j.id}"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle">Keep every file</span></span></button>
    <button class="row ic" data-act="wr-all" data-v="" data-id="${j.id}"><span class="tile">${I.undo}</span><span class="rbody"><span class="rtitle">Clear my review</span></span></button>
    <button class="row ic" data-act="wr-ship" data-id="${j.id}"><span class="tile">${WI.merge}</span><span class="rbody"><span class="rtitle">Ship what I kept…</span></span></button>
    <button class="row ic" data-act="wf-pc" data-path="${esc(filesOf(j)[0]?.path ?? '')}"><span class="tile">${WI.pc}</span><span class="rbody"><span class="rtitle">Open the diff on the PC</span></span></button></div>` });
});
on('wr-all', (el) => { const j = job(el.dataset.id); const r = rv(j); closeSheet(); filesOf(j).forEach((f) => { if (el.dataset.v) r[f.path] = el.dataset.v; else delete r[f.path]; }); redrawReview(j); toast(el.dataset.v ? 'Kept every file' : 'Review cleared'); });

// ── a job's own copy: what you can do with the branch ──
export function copySheet(j) {
  const p = project(j.project); const fs = filesOf(j); const [a, d] = sum(fs);
  const rows = [
    fs.length ? ['wc-changes', WI.fileDiff, 'See what changed', `${fs.length} files · ${stat(a, d)}`] : null,
    fs.length ? ['wr-ship', WI.merge, 'Ship it…', 'Merge as one commit, open a PR, or hand to the Builder'] : null,
    ['wc-term', I.term, 'Open a terminal in this copy', `.aos-copies\\feat-${j.id}`],
    ['wc-discard', I.trash, 'Discard the copy', 'Deletes the branch and its folder. The chat stays'],
  ].filter(Boolean);
  openSheet({
    title: `feat/${j.id}`, sub: `A separate copy of ${esc(p?.name ?? '')}, made for this job`, cls: 'wr-copy-sheet',
    body: `<div class="wr-copy-h"><span class="mono">main</span><span class="wr-copy-l" aria-hidden="true"></span><span class="mono">feat/${j.id}</span><span class="foot num">${repoOf(j.project).commit?.[0] ?? ''} → ${fs.length} file${fs.length === 1 ? '' : 's'} ahead</span></div>
      <div class="group">${rows.map(([act, ic, t, m]) => `<button class="row ic${act === 'wc-discard' ? ' wr-danger' : ''}" data-act="${act}" data-id="${j.id}"><span class="tile">${ic}</span><span class="rbody"><span class="rtitle">${t}</span><span class="rmeta"><span class="ell">${m}</span></span></span>${act === 'wc-discard' ? '' : I.chevR}</button>`).join('')}</div>`,
  });
}
on('wc-changes', (el) => { closeSheet(); const j = job(el.dataset.id); setTimeout(() => openChanges(j), 200); });
on('wc-term', (el) => { closeSheet(); const j = job(el.dataset.id); document.dispatchEvent(new CustomEvent('work:terminal', { detail: { project: j.project, job: j.id } })); });
on('wc-discard', (el) => {
  const j = job(el.dataset.id); closeSheet(); const was = j.worktree;
  j.worktree = false; haptic(16); changed({ job: j.id });
  toast(`Discarded feat/${j.id}`, () => { j.worktree = was; changed({ job: j.id }); });
});
// the real engine's Changes page is work-changes.js (jobs.js picks); this one tells the demo story
on('jdiff', (el) => { api.openChanges(el.dataset.id, Number(el.dataset.turn) || 0); });

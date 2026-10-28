// Work · the cards every Work screen shares: a question waiting on you (answered in place), a job on the board, a
// project, an idea, the 14-day activity bars and the plan meters. One look everywhere: the Work tab, a project page
// and the board. Real mode reads each job's PC record (j.raw: its open request, progress, copy, ship) and answers
// through work-engine.js; ?data=demo keeps the prototype's story.
import { $, esc, ring, toast, on, haptic } from './core.js';
import { I } from './icons.js';
import { JOBS, BUILDERS, IDEAS } from './data.js';
import { NOTES, THREADS } from './work-data.js';
import { W, WI, job, lane, agentName, project, plural, ago, hasRing, shipChip, stat, jobRing, steps, since, sinceIso, repoOf, projJobs, projTasks, projIdeas, capFirst, changed, markFor, agentMark, ideasNow, REAL } from './work-ui.js';
import { askOf, formOf, allow, deny, answer } from './work-thread.js';
import { filesOf, reviewOf, shipSheet, openChanges } from './work-review.js';
import { USAGE } from './work-new.js';
import * as E from './work-engine.js';
import { api } from './bus.js';

// a job's first turn says when it started; running work counts from there
export const startedAt = (j) => THREADS[j.id]?.[0]?.at ?? null;
export const elapsed = (j) => (REAL ? (j.raw?.updatedAt ? `<span class="num">${esc(ago(j))}</span>` : '') : startedAt(j) ? since(startedAt(j)) : `<span class="num">${esc(j.ago)}</span>`);
// a job in review that is already on its way out (being built or queued to the Builder) is landing, not waiting on you
export const isLanding = (j) => (REAL ? ['queued', 'sent', 'committed', 'building'].includes(j.ship) && j.lane !== 'archive' && j.lane !== 'working' && j.lane !== 'needs'
  : j.lane === 'review' && (['building', 'queued'].includes(j.ship) || W.shipped[j.id] === 'builder'));
const SHIP_WORD = { queued: 'Queued for the Builder', sent: 'With the Builder', committed: 'Committed, building next', building: 'Building' };

// ── what waits on you: the question itself, answered in place ─────────
/** Real: what a job in Needs you wants, from its PC record. kind: permission | plan | form | html | reply | failed. */
export function askOfReal(j) {
  const r = j.raw ?? {};
  const p = r.pending;
  if (r.status === 'needs_input' && p) {
    if (p.html) return { kind: 'html', title: p.title ?? 'A form for you', p };
    if (p.form?.length || p.kind === 'question') return { kind: 'form', q: p.form?.[0]?.question ?? p.title ?? '', n: p.form?.length ?? 1, opts: p.form?.length === 1 ? (p.form[0].options ?? []) : [], multi: !!p.form?.[0]?.multiSelect, p };
    if (p.kind === 'plan') return { kind: 'plan', p };
    const cmd = String(p.title ?? '').replace(p.kind === 'command' ? /^Run\s+/ : p.kind === 'edit' ? /^Edit\s+/ : /^$/, '');
    return { kind: 'permission', cmd, what: p.kind, p };
  }
  if (r.status === 'failed') return { kind: 'failed', text: r.error ?? 'It stopped with an error.' };
  return { kind: 'reply', text: j.last ?? '' };
}
const where = (j) => { const w = j.raw?.workspace; return w?.kind === 'worktree' && w.branch ? `In its own copy, ${String(w.branch).replace(/^aos\//, '')}` : w?.kind === 'scratch' ? 'In its scratch folder' : 'In the project folder'; };
export function needsCard(j, { compact = false } = {}) {
  const p = project(j.project);
  const head = `<button class="wk-ask-h" data-act="job" data-id="${j.id}" aria-label="Open ${esc(j.title)}">${jobRing(j, 40, 4)}
    <span class="rbody"><span class="rtitle wrap">${esc(j.title)}</span><span class="rmeta">${p ? `<i class="dot" style="--c:${p.color}"></i><span>${esc(p.name)}</span>` : ''}<span>· ${agentName(j.agent)}</span><span>· ${esc(ago(j))}</span></span></span>${I.chevR}</button>`;
  let body = '';
  if (REAL) {
    const a = askOfReal(j);
    const id = esc(j.id);
    if (a.kind === 'permission') {
      const has = (k) => a.p.options?.some((o) => o.kind === k);
      body = `<p class="wk-q-t">${I.shield}<span>${esc(agentName(j.agent))} ${a.what === 'edit' ? 'wants to edit' : 'wants to run'} <span class="mono">${esc(a.cmd.slice(0, 160))}</span></span></p>
        <p class="wk-q-s">${esc(where(j))}${j.progress ? ` · step ${Math.min(j.progress.total, j.progress.done + 1)} of ${j.progress.total}` : ''}</p>
        <div class="ask-b"><button class="btn sm primary" style="--c:var(--needs)" data-act="wk-allow" data-id="${id}">Allow once</button>${has('allow_always') ? `<button class="btn sm" data-act="wk-allow" data-id="${id}" data-always="1">Always</button>` : ''}<button class="btn sm" data-act="wk-deny" data-id="${id}">Deny</button></div>`;
    } else if (a.kind === 'plan') {
      body = `<p class="wk-q-t">${WI.plan}<span>${esc(agentName(j.agent))} wrote a plan and waits for your OK</span></p>
        <div class="ask-b"><button class="btn sm primary" style="--c:var(--needs)" data-act="wk-plan-ok" data-id="${id}">Approve and build</button><button class="btn sm" data-act="job" data-id="${id}">Read the plan</button></div>`;
    } else if (a.kind === 'form') {
      const quick = !a.multi && a.opts.length && a.opts.length <= 3 && a.n === 1 ? a.opts : [];
      body = `<p class="wk-q-t">${I.chat}<span>${esc(a.q)}${a.n > 1 ? ` <span class="cap">and ${plural(a.n - 1, 'more question')}</span>` : ''}</span></p>
        <div class="ask-b wk-quick">${quick.map((o, i) => `<button class="btn sm${i === 0 ? ' tint' : ''}"${i === 0 ? ' style="--c:var(--needs)"' : ''} data-act="wk-quick" data-id="${id}" data-i="${i}">${esc(String(o.label).slice(0, 40))}</button>`).join('')}<button class="btn sm${quick.length ? '' : ' tint'}"${quick.length ? '' : ' style="--c:var(--needs)"'} data-act="job" data-id="${id}">${quick.length ? 'More' : 'Answer'}</button></div>`;
    } else if (a.kind === 'html') {
      body = `<p class="wk-q-t">${I.chat}<span>${esc(a.title)}</span></p><div class="ask-b"><button class="btn sm tint" style="--c:var(--needs)" data-act="job" data-id="${id}">Open the form</button></div>`;
    } else if (a.kind === 'failed') {
      body = `<p class="wk-q-t wk-fail">${WI.warn}<span>It stopped with an error</span></p><p class="wk-q-s wk-q-err">${esc(String(a.text).replace(/\s+/g, ' ').slice(0, 180))}</p>
        <div class="ask-b"><button class="btn sm" data-act="wk-carry" data-id="${id}">Carry on</button><button class="btn sm" data-act="job" data-id="${id}">Open</button></div>`;
    } else {
      body = `<p class="wk-q-t">${markFor(j, 17, { state: 'idle' })}<span>Replied. Your turn</span></p>${a.text ? `<p class="wk-q-s wk-q-said">${esc(String(a.text).slice(0, 200))}</p>` : ''}
        <div class="ask-b"><button class="btn sm tint" style="--c:var(--jobs-ink)" data-act="job" data-id="${id}">Reply</button>${j.diff?.[2] ? `<button class="btn sm" data-act="jdiff" data-id="${id}">${WI.fileDiff}Review</button>` : ''}<button class="btn sm" data-act="wk-done" data-id="${id}">Done</button></div>`;
    }
    return `<div class="wk-ask surface${compact ? ' compact' : ''}" data-job="${j.id}">${head}<div class="wk-q">${body}</div></div>`;
  }
  if (j.ask?.kind === 'permission') {
    const a = askOf(j);
    body = `<p class="wk-q-t">${I.shield}<span>${esc(agentName(j.agent))} wants to run <span class="mono">${esc(a.cmd)}</span></span></p>
      <p class="wk-q-s">${j.worktree ? `In its own copy, feat/${j.id}` : 'In the project folder'}${j.progress ? ` · step ${j.progress.done + 1} of ${j.progress.total}` : ''}</p>
      ${!compact && NOTES[j.id] ? `<p class="wyn-hint">${I.sparkle}<span>${esc(NOTES[j.id])}</span></p>` : ''}
      <div class="ask-b"><button class="btn sm primary" style="--c:var(--needs)" data-act="allow" data-id="${j.id}">Allow once</button><button class="btn sm" data-act="allow" data-id="${j.id}" data-always="1">Always</button><button class="btn sm" data-act="deny" data-id="${j.id}">Deny</button></div>`;
  } else if (j.ask?.kind === 'plan') {
    body = `<p class="wk-q-t">${WI.plan}<span>${esc(agentName(j.agent))} wrote a plan and waits for your OK</span></p>
      <div class="ask-b"><button class="btn sm primary" style="--c:var(--needs)" data-act="jp-approve" data-id="${j.id}">Approve and build</button><button class="btn sm" data-act="job" data-id="${j.id}">Read the plan</button></div>`;
  } else {
    const f = formOf(j);
    const quick = f.opts.slice(0, 2);
    body = `<p class="wk-q-t">${I.chat}<span>${esc(f.q)}</span></p>
      ${!compact && NOTES[j.id] ? `<p class="wyn-hint">${I.sparkle}<span>${esc(NOTES[j.id])}</span></p>` : ''}
      <div class="ask-b wk-quick">${quick.map(([o, , pick], i) => `<button class="btn sm${pick ? ' tint' : ''}"${pick ? ' style="--c:var(--needs)"' : ''} data-act="w-answer" data-id="${j.id}" data-i="${i}">${pick ? I.sparkle : ''}${esc(o.replace(' a month', ''))}</button>`).join('')}<button class="btn sm" data-act="job" data-id="${j.id}">More</button></div>`;
  }
  return `<div class="wk-ask surface" data-job="${j.id}">${head}<div class="wk-q">${body}</div></div>`;
}
on('w-answer', (el) => answer(job(el.dataset.id), Number(el.dataset.i)));
// real answers, right on the card: the card leaves Needs you the moment the PC takes it
async function onCard(el, fn, done) {
  const box = el.closest('.ask-b'); const btns = box ? [...box.querySelectorAll('button')] : [el];
  btns.forEach((b) => { b.disabled = true; });
  el.classList.add('is-busy');
  const card = el.closest('.wk-ask');
  try { await fn(); haptic('success'); card?.classList.add('wk-answered'); if (done) toast(done); }
  catch (e) { btns.forEach((b) => { b.disabled = false; }); el.classList.remove('is-busy'); toast(E.err(e)); }
}
on('wk-allow', (el) => onCard(el, () => E.act.allow(el.dataset.id, { always: !!el.dataset.always }), el.dataset.always ? 'Allowed for this session' : 'Allowed once'));
on('wk-deny', (el) => onCard(el, () => E.act.deny(el.dataset.id), 'Denied. It looks for another way'));
on('wk-plan-ok', (el) => onCard(el, () => E.act.plan(el.dataset.id, true), 'Plan approved. Building'));
on('wk-quick', (el) => onCard(el, () => { const p = E.raw(el.dataset.id)?.pending; const q = p?.form?.[0]; const o = q?.options?.[Number(el.dataset.i)]; if (!q || !o) throw Object.assign(new Error('That question is no longer open.'), { status: 409 }); return E.act.answer(el.dataset.id, 'submit', { requestId: p.requestId, answers: { [q.question]: o.label } }); }, 'Answer sent'));
on('wk-carry', (el) => onCard(el, () => E.act.prompt(el.dataset.id, 'Carry on where you left off.'), 'Carrying on'));
on('wk-done', (el) => onCard(el, () => E.act.done(el.dataset.id), 'Job done'));

// ── a job on the board ────────────────────────────────────────────────
const marks = (j) => `${j.star ? `<span class="jstar" role="img" aria-label="Starred">${I.starF}</span>` : ''}${j.worktree ? `<span class="jbr" role="img" aria-label="Own copy">${I.branch}</span>` : ''}`;
const meta = (...parts) => `<span class="jmeta">${parts.filter(Boolean).join('')}</span>`;
export function jobCard(j, { showProject = false } = {}) {
  const p = project(j.project);
  const proj = showProject && p ? `<span><i class="dot" style="--c:${p.color}"></i> ${esc(p.name)}</span>` : '';
  if (j.lane === 'needs') return needsCard(j);
  if (j.lane === 'working') {
    return `<div class="row jcard working" data-id="${j.id}" data-act="job">${jobRing(j, 48, 5)}<div class="rbody">
      <div class="jt">${marks(j)}<span class="rtitle">${esc(j.title)}</span></div>
      ${meta(proj, `<span>${agentName(j.agent)}</span>`, `<span>${elapsed(j)}</span>`, j.queued ? `<span>${j.queued} queued</span>` : '')}
      ${j.progress ? `<div class="jprog"><b class="met c-jobs">${j.progress.done}<small>/${j.progress.total}</small></b><span class="jp-step">${esc(j.progress.step)}</span><span class="cap">${esc(j.progress.stage)}</span></div>${steps(j.progress)}` : ''}
      ${j.last ? `<p class="jlast" data-live="${j.id}">${esc(j.last)}</p>` : ''}</div></div>`;
  }
  if (isLanding(j)) {
    const b = REAL ? null : BUILDERS.find((x) => x.project === j.project);
    const bj = REAL ? j.raw?.ship?.builderJob : null;
    return `<div class="row jcard landing" data-id="${j.id}" data-act="job">${agentMark(j.agent, '', j)}<div class="rbody">
      <div class="jt">${marks(j)}<span class="rtitle">${esc(j.title)}</span></div>
      ${meta(proj, `<span>${agentName(j.agent)}</span>`, `<span>${esc(ago(j))}</span>`)}
      <div class="jland">${j.ship === 'building' ? '<span class="spin" style="--c:var(--jobs)"></span>' : WI.queue}<span>${REAL ? esc(SHIP_WORD[j.ship] ?? 'With the Builder') : j.ship === 'building' ? 'Building · step 3 of 5' : 'Queued for the Builder'}</span></div>
      <div class="jnext">${REAL ? (bj ? `<button class="btn sm" data-act="job" data-id="${esc(bj)}">${I.hammer}Builder</button>` : '') : `<button class="btn sm" data-act="builder" data-id="${b?.id ?? 'b1'}">${I.hammer}Builder</button>`}${REAL ? (j.diff?.[2] ? `<button class="btn sm" data-act="jdiff" data-id="${j.id}">${WI.fileDiff}${stat(j.diff[0], j.diff[1])}</button>` : '') : filesOf(j).length ? `<button class="btn sm" data-act="jdiff" data-id="${j.id}">${WI.fileDiff}${stat(...sumOf(j))}</button>` : ''}</div></div></div>`;
  }
  if (j.lane === 'review') {
    if (REAL) {
      const files = j.diff?.[2] ?? j.raw?.files ?? 0;
      return `<div class="row jcard review" data-id="${j.id}" data-act="job">${agentMark(j.agent, '', j)}<div class="rbody">
        <div class="jt">${marks(j)}<span class="rtitle">${esc(j.title)}</span></div>
        ${meta(proj, shipChip(j.ship), `<span>${agentName(j.agent)}</span>`, `<span>${esc(ago(j))}</span>`)}
        ${files ? `<div class="jrev">${j.diff ? `<span class="diffstat num">${stat(j.diff[0], j.diff[1])}</span>` : ''}<span>${plural(files, 'file')}</span></div>` : j.last ? `<p class="jlast">${esc(j.last)}</p>` : ''}
        <div class="jnext">${files ? `<button class="btn sm tint" style="--c:var(--jobs-ink)" data-act="jdiff" data-id="${j.id}">${WI.fileDiff}Review</button>` : ''}<button class="btn sm" data-act="wk-unreview" data-id="${j.id}">${I.check}Reviewed</button></div></div></div>`;
    }
    const r = reviewOf(j); const fs = filesOf(j);
    const ready = fs.length && !r.left;
    return `<div class="row jcard review" data-id="${j.id}" data-act="job"><span class="agent ${j.agent}">${I[j.agent]}</span><div class="rbody">
      <div class="jt">${marks(j)}<span class="rtitle">${esc(j.title)}</span></div>
      ${meta(proj, shipChip(j.ship), `<span>${agentName(j.agent)}</span>`, `<span>${esc(ago(j))}</span>`)}
      ${j.diff ? `<div class="jrev"><span class="diffstat num">${stat(j.diff[0], j.diff[1])}</span><span>${j.diff[2]} files</span>${fs.length ? `<span>${r.n - r.left ? `${r.n - r.left} of ${r.n} reviewed` : 'Not reviewed'}</span>` : ''}</div>` : ''}
      <div class="jnext">${fs.length ? `<button class="btn sm${ready ? '' : ' tint'}" style="--c:var(--jobs-ink)" data-act="jdiff" data-id="${j.id}">${WI.fileDiff}${ready ? 'Reviewed' : 'Review'}</button>` : ''}<button class="btn sm${ready ? ' primary' : ''}"${ready ? ' style="--c:var(--jobs-fill)"' : ''} data-act="${fs.length ? 'wr-ship' : 'w-ship-simple'}" data-id="${j.id}">${j.worktree ? WI.merge : WI.commit}Ship</button></div></div></div>`;
  }
  return compactRow(j, { showProject });
}
on('wk-unreview', async (el) => { try { await E.act.board(el.dataset.id, { review: false }); haptic(8); toast('Review cleared', () => E.act.board(el.dataset.id, { review: true }).catch(() => {})); } catch (e) { toast(E.err(e)); } });
const sumOf = (j) => filesOf(j).reduce((t, f) => [t[0] + f.a, t[1] + f.d], [0, 0]);
const SHIPPED = { merged: 'Merged', committed: 'Committed', pr: 'PR open', builder: 'With the Builder' };
export function compactRow(j, { showProject = false } = {}) {
  const p = project(j.project);
  const end = REAL ? (j.status === 'failed' ? '<span class="jst-fail">Failed</span>' : shipChip(j.ship)) : W.shipped[j.id] ? `<span class="ship" style="--c:var(--ink-2)"><i class="dot"></i>${SHIPPED[W.shipped[j.id]]}</span>` : shipChip(j.ship);
  return `<button class="row jsmall" data-act="job" data-id="${j.id}">${REAL ? agentMark(j.agent, 'sm', j) : `<span class="agent sm ${j.agent}">${I[j.agent]}</span>`}
    <span class="rbody"><span class="rtitle">${j.star ? `<span class="jstar" aria-hidden="true">${I.starF}</span>` : ''}${esc(j.title)}</span>${showProject && p ? `<span class="rmeta"><i class="dot" style="--c:${p.color}"></i><span>${esc(p.name)}</span></span>` : ''}</span>${end}<span class="cap num">${esc(j.ago)}</span></button>`;
}
on('w-ship-simple', (el) => { const j = job(el.dataset.id); const was = j.lane; j.lane = 'done'; W.shipped[j.id] = j.worktree ? 'merged' : 'committed'; haptic(14); changed({ job: j.id }); toast(j.worktree ? 'Merged into main as one commit' : 'Committed', () => { j.lane = was; delete W.shipped[j.id]; changed({ job: j.id }); }); });

// ── activity: jobs and commits per day, the last 14 days, today on the right ──
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayName = (i) => { const d = E.clock.addDays(E.clock.today(), i - 13); const p = E.clock.dparts(d); return i === 13 ? 'Today' : i === 12 ? 'Yesterday' : `${WEEK[p.dow]} ${p.day}`; };
export function activity(slug, { big = false } = {}) {
  const a = repoOf(slug).activity ?? Array(14).fill(0); const total = a.reduce((s, v) => s + v, 0); const max = Math.max(10, ...a);
  const h = big ? 44 : 18;
  const bars = a.map((v, i) => { const px = v ? Math.max(3, Math.round(v / max * h)) : 2; return `<i class="${v ? '' : 'zero'}${i === a.length - 1 ? ' today' : ''}" style="height:${px}px;--i:${i}" data-v="${v}" data-d="${i}"></i>`; }).join('');
  const label = `${total} jobs and commits in 14 days, ${a[a.length - 1]} today`;
  if (!big) return `<span class="wk-act" role="img" aria-label="${label}">${bars}</span>`;
  const mid = REAL ? dayName(6) : 'Thu 15';
  return `<div class="wk-act-big surface" role="group" aria-label="Activity">
    <div class="wk-ab-h"><b class="met">${total}</b><span>jobs and commits in 14 days</span><span class="wk-ab-pick num" aria-live="polite">Today · ${a[a.length - 1]}</span></div>
    <div class="wk-act big" role="img" aria-label="${label}">${bars}</div>
    <div class="wk-ab-x num" aria-hidden="true"><span>${REAL ? dayName(0) : 'Fri 9'}</span><span>${mid}</span><span>Today</span></div>
  </div>`;
}
// tap a day on the big bars to read it
document.addEventListener('click', (e) => {
  const bar = e.target.closest('.wk-act.big i'); if (!bar) return;
  const box = bar.closest('.wk-act-big'); const d = Number(bar.dataset.d); const v = Number(bar.dataset.v);
  const day = REAL ? dayName(d) : d === 13 ? 'Today' : d === 12 ? 'Yesterday' : `${['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'][d % 7]} ${9 + d} Oct`;
  box.querySelectorAll('.wk-act.big i').forEach((x) => x.classList.toggle('pick', x === bar));
  $('.wk-ab-pick', box).textContent = `${day} · ${v}`; haptic(4);
});

// ── a project at a glance: what is live in it, where its repo stands, how busy it has been ──
export function projectCard(p) {
  const pj = projJobs(p.slug); const live = pj.filter((j) => ['needs', 'working'].includes(j.lane) || isLanding(j) || j.lane === 'review');
  const r = repoOf(p.slug);
  const copiesN = copies(p.slug);
  // the live rows say what needs you and what runs, so the head only speaks when nothing is live
  const state = live.length ? '' : r.quiet ? `<span class="wk-p-st quiet">Quiet ${r.quiet} days</span>` : '';
  const repo = REAL
    ? [r.branch ? `<span class="mono">${I.branch}${esc(r.branch)}</span>` : p.folder ? '' : '<span>No folder</span>', r.ahead ? `<span class="num">↑${r.ahead}</span>` : '', r.dirty?.length ? `<span>${r.dirty.length} uncommitted</span>` : '', copiesN ? `<span>${copiesN} cop${copiesN === 1 ? 'y' : 'ies'}</span>` : '', r.lastShip ? `<span>Shipped ${esc(r.lastShip[2])} ago</span>` : '', !r.branch && p.folder ? `<span class="mono ell">${esc(String(p.folder).split(/[\\/]/).filter(Boolean).pop() ?? '')}</span>` : ''].filter(Boolean).slice(0, 4).join('<i class="sep" aria-hidden="true">·</i>')
    : [`<span class="mono">${I.branch}${esc(r.branch)}</span>`, r.ahead ? `<span class="num">↑${r.ahead}</span>` : '', r.dirty?.length ? `<span>${r.dirty.length} changed</span>` : '', copiesN ? `<span>${copiesN} cop${copiesN === 1 ? 'y' : 'ies'}</span>` : '', r.waves ? `<span>${r.waves.n} to merge</span>` : '', r.lastShip ? `<span>Shipped ${esc(r.lastShip[2])} ago</span>` : ''].filter(Boolean).slice(0, 4).join('<i class="sep" aria-hidden="true">·</i>');
  const shown = live.slice(0, 3); const nT = projTasks(p.slug).length, nI = projIdeas(p.slug).length;
  const counts = [nT ? `<span><b class="met">${nT}</b> task${nT === 1 ? '' : 's'}</span>` : '', nI ? `<span><b class="met">${nI}</b> idea${nI === 1 ? '' : 's'}</span>` : ''].join('');
  const nudge = REAL ? realNudge(p, r, live, nT) : NOTES[p.slug] ? (W.night?.queued?.includes('n2') && p.slug === 'pulsechat'
    ? `<div class="wk-p-nudge"><span class="wyn-hint">${WI.moon}<span>On tonight's shift: Claude plans the native apps at 23:00.</span></span></div>`
    : `<div class="wk-p-nudge"><span class="wyn-hint">${I.sparkle}<span>${esc(NOTES[p.slug])}</span></span><button class="btn sm" data-act="w-night">Plan it tonight</button></div>`) : '';
  return `<div class="wk-pcard surface" style="--c:${p.color}" data-project="${esc(p.slug)}">
    <button class="wk-p-head" data-act="project" data-id="${p.slug}" data-back="Work">
      ${pmarkLocal(p)}<span class="wk-p-id"><b>${esc(p.name)}</b><span class="wk-p-repo">${repo}</span></span>${state}${I.chevR}
    </button>
    ${shown.length ? `<div class="wk-p-jobs">${shown.map(miniJob).join('')}${live.length > 3 ? `<button class="wk-p-more" data-act="project" data-id="${p.slug}" data-back="Work"><span>${live.length - 3} more ${live.length - 3 === 1 ? 'job' : 'jobs'} in ${esc(p.name)}</span>${I.chevR}</button>` : ''}</div>` : ''}
    ${nudge}
    <button class="wk-p-foot" data-act="project" data-id="${p.slug}" data-back="Work" tabindex="-1" aria-hidden="true">
      <span class="wk-p-counts">${counts}</span>${activity(p.slug)}
    </button>
  </div>`;
}
// what is true and worth a tap: quiet with open tasks (hand one off), uncommitted changes left behind
function realNudge(p, r, live, nT) {
  if (live.length) return '';
  const t = projTasks(p.slug).find((x) => !x.job && ['todo', 'inbox'].includes(x.status));
  if (r.quiet >= 7 && t) return `<div class="wk-p-nudge"><span class="wyn-hint">${I.sparkle}<span>Quiet for ${r.quiet} days with ${plural(nT, 'open task')}. Hand one to an agent?</span></span><button class="btn sm" data-act="w-hand" data-id="${esc(t.id)}" data-a="claude">Hand off</button></div>`;
  return '';
}
const copies = (slug) => (REAL ? E.code.worktrees.filter((w) => w.state === 'open' && w.project === slug).length : JOBS.filter((j) => j.project === slug && j.worktree && ['needs', 'working', 'review'].includes(j.lane)).length);
const pmarkLocal = (p) => `<span class="p-ic" style="--c:${p.color}" aria-hidden="true">${/\p{Extended_Pictographic}/u.test(p.icon) ? p.icon : `<b>${esc(p.icon)}</b>`}</span>`;
function miniJob(j) {
  const right = j.lane === 'needs' ? '<span class="wk-mj-s needs">Needs you</span>'
    : j.lane === 'working' ? (j.progress ? `<span class="wk-mj-s"><b class="met c-jobs">${j.progress.done}<small>/${j.progress.total}</small></b></span>` : '<span class="wk-mj-s">Working</span>')
    : isLanding(j) ? '<span class="wk-mj-s">Landing</span>'
    : '<span class="wk-mj-s">To review</span>';
  const lead = hasRing(j) ? ring(j.progress.done / j.progress.total, j.lane === 'needs' ? 'needs' : 'jobs', 28, 3, { cls: j.lane === 'working' ? 'running' : '', inner: `<span class="wk-mj-a" data-mark-job="${j.id}">${REAL ? markFor(j, 14) : I[j.agent]}</span>` }) : REAL ? agentMark(j.agent, 'sm', j) : `<span class="agent sm ${j.agent}">${I[j.agent]}</span>`;
  const sub = REAL ? miniSub(j) : j.lane === 'working' ? esc(j.progress?.step ?? '') : j.lane === 'needs' ? esc(j.ask?.kind === 'permission' ? `Wants to run ${askOf(j).cmd}` : j.ask?.kind === 'plan' ? 'Wrote a plan' : formOf(j).q) : isLanding(j) ? 'The Builder is on it' : `${j.diff ? `${j.diff[2]} files` : 'Ready'}`;
  return `<button class="wk-mj" data-act="job" data-id="${j.id}">${lead}<span class="rbody"><span class="rtitle">${esc(j.title)}</span><span class="rmeta"><span class="ell">${sub}</span></span></span>${right}</button>`;
}
function miniSub(j) {
  if (j.lane === 'working') return esc(j.progress?.step || j.last || 'Working');
  if (j.lane === 'needs') { const a = askOfReal(j); return esc(a.kind === 'permission' ? `${a.what === 'edit' ? 'Wants to edit' : 'Wants to run'} ${a.cmd}` : a.kind === 'plan' ? 'Wrote a plan' : a.kind === 'form' ? a.q : a.kind === 'failed' ? 'Failed' : a.kind === 'html' ? a.title : 'Replied. Your turn'); }
  if (isLanding(j)) return SHIP_WORD[j.ship] ?? 'With the Builder';
  return j.diff?.[2] ? plural(j.diff[2], 'file') : 'Ready';
}

// ── plan meters: how much of each plan is left (demo only: the PC can't see the subscription's limits) ──
export const usageRow = () => (REAL ? '' : `<div class="wk-usage" role="group" aria-label="What is left of your plans">${['claude', 'codex'].map((a) => `<button class="wk-u" data-act="w-usage" data-a="${a}"><span class="wk-u-t">${I[a]}<b>${agentName(a)}</b><span class="num">${Math.round(USAGE[a].left * 100)}% left</span></span><span class="bar" style="--p:${Math.round(USAGE[a].left * 100)}%;--c:var(--jobs)" aria-hidden="true"><i></i></span><span class="wk-u-s">${a === 'claude' ? `Resets ${USAGE.claude.resets}` : 'Resets Monday'}</span></button>`).join('')}</div>`);
on('w-usage', (el) => toast(el.dataset.a === 'claude' ? 'Claude: 38% of this 5-hour window is left. It resets at 19:00' : 'Codex: 71% of this week is left. It resets on Monday'));

// ── ideas: a sentence, its age, and two ways out ──────────────────────
export function ideaRow(i, p) {
  const title = p && i.title.startsWith(`${p.name}: `) ? capFirst(i.title.slice(p.name.length + 2)) : i.title;
  const pending = REAL && i.pending;
  return `<div class="row idea${pending ? ' is-pending' : ''}" data-id="${i.id}"><span class="rbody">
    <span class="rtitle wrap">${esc(title)}</span>
    <span class="idea-m"><span class="rmeta"><span>${pending ? 'Saved on this phone' : i.ago === 'now' ? 'Just now' : /^\d+[mhd]$/.test(i.ago) ? `${esc(i.ago)} ago` : esc(i.ago ?? '')}</span>${i.inbox ? '<span class="pill plain">Inbox</span>' : ''}${REAL && i.status === 'jobbed' ? '<span class="pill plain">A job has it</span>' : ''}</span>
      <span class="idea-acts"><button class="btn sm" data-act="idea-task" data-id="${i.id}"${pending ? ' disabled' : ''}>Task</button><button class="btn sm tint" style="--c:var(--jobs-ink)" data-act="idea-job" data-id="${i.id}"${pending ? ' disabled' : ''}>Job</button></span></span></span></div>`;
}
export function wireIdeaField(root, slug) {
  const inp = $('.jidea-in', root); if (!inp || inp._wired) return; inp._wired = true;
  inp.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !inp.value.trim()) return;
    e.preventDefault();
    const text = inp.value.trim();
    if (REAL) {
      inp.value = ''; haptic(8);
      try { const it = await E.addIdea({ text, project: slug ?? null }); toast(it?.pending ? 'Saved on this phone. It goes to your PC when it’s reachable' : 'Idea saved'); } catch (er) { inp.value = text; toast(E.err(er)); }
      return;
    }
    const it = { id: `i${Date.now()}`, title: text, project: slug, ago: 'now', inbox: true };
    W.ideas.unshift(it); inp.value = ''; haptic(8); changed({ idea: it.id });
    toast('Idea saved', () => { W.ideas = W.ideas.filter((x) => x !== it); changed(); });
  });
}
on('idea-task', async (el) => {
  if (REAL) {
    el.disabled = true;
    try { const t = await E.ideaToTask(el.dataset.id); if (t) { haptic('success'); toast(t.status === 'inbox' ? 'Task added to the inbox' : 'Turned into a task'); } else el.disabled = false; } catch (e) { el.disabled = false; toast(E.err(e)); }
    return;
  }
  const i = W.ideas.findIndex((x) => x.id === el.dataset.id); if (i < 0) return;
  const [it] = W.ideas.splice(i, 1); changed();
  toast('Turned into a task', () => { W.ideas.splice(i, 0, it); changed(); });
});
on('idea-job', (el) => {
  const it = ideasNow().find((x) => x.id === el.dataset.id); if (!it) return;
  if (REAL) { api.newJob({ idea: it.id, prompt: it.body ? `${it.title}\n\n${it.body}` : it.title, project: it.project ?? null }); return; }
  document.dispatchEvent(new CustomEvent('work:newjob', { detail: { prompt: capFirst(it.title.replace(/^[^:]+: /, '')), project: it.project ?? 'agentic-os', idea: it.id } }));
});
export { allow, deny, plural, lane, shipSheet, openChanges, IDEAS };

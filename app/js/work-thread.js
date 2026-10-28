// Work · a job's thread: the conversation with Claude or Codex, the way T3 Code shows it, sized for a thumb.
// Each turn is your message, the work it did (folded into one row once it is done), its answer and its checkpoint:
// what that turn changed, one tap from review. What waits on you is a plain question with the agent's advice under it.
// The composer carries what shapes the next turn (model, access, plan) beside the send button.
import { $, $$, esc, push, pop, openSheet, closeSheet, toast, on, onHold, peek, closePeek, seg, ring, haptic, wireSegs, pulse, setRing } from './core.js';
import { I } from './icons.js';
import { JOBS, LANES, BUILDERS, CHAT } from './data.js';
import { THREADS, MODELS, EFFORT, ACCESS, NOTES } from './work-data.js';
import { W, WI, job, agentName, project, STATUS, hasRing, ago, linksOf, taskOf, goalOf, shipChip, stat, backLabel, changed, since, sinceOf, recorder, pickMark, branchOf } from './work-ui.js';
import { filesOf, turnFiles, openChanges, openFile, copySheet, reviewOf } from './work-review.js';
import { api } from './bus.js';

const permOf = (j) => W.perm[j.id] ?? 'auto';
const extra = (j) => (W.extra[j.id] ??= []);
W.extra ??= {}; W.attach ??= {}; W.planFirst ??= {};

// ── the approvals and questions jobs are waiting on, in plain words ──
const ASKS = {
  j12: { who: 'Codex wants to run a command', cmd: 'bun test server', where: 'In feat/j12, its own copy of Agentic OS', why: 'Runs the 52 server tests to check the keyboard fix before handing it over.' },
};
const FORMS = {
  j13: { q: 'Anchor the top tier at ₹25,000 or ₹40,000 a month?', opts: [
    ['₹25,000 a month', 'The easier yes. Sized to Dad\'s shop and the pilot'],
    ['₹40,000 a month', 'Anchors Growth higher. Three of the four rivals charge about this at the top', true],
    ['Something else', 'Type your own price'],
  ] },
};
export const askOf = (j) => ASKS[j.id] ?? (() => { const m = /^Run (.+?)(?: in .+)?\?$/.exec(j.ask?.text ?? ''); return { who: `${agentName(j.agent)} wants to run a command`, cmd: m?.[1] ?? j.ask?.text ?? '', where: j.worktree ? `In feat/${j.id}, its own copy` : 'In the project folder', why: '' }; })();
export const formOf = (j) => FORMS[j.id] ?? { q: j.ask?.text ?? '', opts: [['Yes', ''], ['No', ''], ['Something else', 'Type your own answer']] };
const isAlways = (cmd) => W.always.has(cmd.split(' ').slice(0, 2).join(' '));

// Each job's plan: stages of named steps. How far it has got comes from the job's own progress, so the plan, the ring
// and the composer always agree.
const PLANS = {
  j15: [['Study', ['Map current app', 'Design direction']], ['Build', ['Home + tasks panel', 'Jobs + Content OS', 'Other screens']], ['Ship', ['Phone screenshots check', 'Cloudflare tunnel link']]],
  j12: [['Study', ['Find the screenshot button', 'Read the picker code']], ['Fix', ['Wait for the Photos grant', 'Fall back to the shared container']], ['Verify', ['Run the tests', 'Try it on the phone']]],
  j13: [['Study', ['Read the last two calls', 'Compare competitor pricing']], ['Decide', ['Pick the anchor', 'Write the tiers']]],
  j9: [['Study', ['Read the four scripts']], ['Build', ['Group into setups', 'Shot list per setup', 'Teleprompter cards', 'Export the pack']], ['Ship', ['Send to the phone']]],
};
export function planFor(j) {
  const total = j.progress?.total ?? 4;
  const stages = PLANS[j.id] ?? W.plans?.[j.id] ?? [[j.progress?.stage ?? 'Build', Array.from({ length: total }, (_, i) => (i === (j.progress?.done ?? 0) ? (j.progress?.step ?? `Step ${i + 1}`) : `Step ${i + 1}`))]];
  let left = j.progress?.done ?? 0;
  return stages.map(([name, steps]) => { const d = Math.min(left, steps.length); left -= d; return [name, steps, d]; });
}
export function planCard(stages, { compact = false, head = true, foot = '' } = {}) {
  const total = stages.reduce((n, s) => n + s[1].length, 0), done = stages.reduce((n, s) => n + s[2], 0);
  const cur = stages.findIndex(([, steps, d]) => d < steps.length);
  return `<div class="plan surface">${head ? `<div class="pc-h">${WI.plan}<b>Plan</b><span class="cap num">${done} of ${total} done</span></div>` : ''}
    <ol class="pl">${stages.map(([name, steps, d], si) => {
      if (compact && d === steps.length) return `<li class="pl-s pl-folded"><div class="pl-r done"><span class="pl-c">${I.check}</span><span class="pl-t">${esc(name)}</span><span class="cap num">${steps.length} done</span></div></li>`;
      return `<li class="pl-s"><span class="pl-n">${esc(name)}</span>${steps.map((s, i) => `<div class="pl-r ${i < d ? 'done' : si === cur && i === d ? 'on' : ''}"><span class="pl-c">${i < d ? I.check : ''}</span><span class="pl-t">${esc(s)}</span></div>`).join('')}</li>`;
    }).join('')}</ol>${foot}</div>`;
}

// ── the page ──────────────────────────────────────────────────────────
export function openJob(id) {
  const j = job(id); if (!j) return;
  push({
    back: backLabel(), title: 'Chat',
    titleHtml: `${esc(j.title)}<small>${agentName(j.agent)} · ${esc(j.model)}</small>`,
    right: topRight(j),
    render(sc, page) {
      page.classList.add('jpage', 'chat-page');
      page.dataset.job = j.id;
      // a redraw keeps your place, keeps open groups open, and leaves the ring where it is (it drew once, on open)
      const draw = (keep = true) => {
        const y = sc.scrollTop, atEnd = sc.scrollHeight - sc.clientHeight - y < 80;
        const open = $$('details.work', sc).map((d) => d.open);
        sc.innerHTML = `${hero(j)}<div class="msgs" id="msgs-${j.id}">${timeline(j)}</div>`;
        $$('details.work', sc).forEach((d, i) => { if (open[i] != null && !d.classList.contains('going')) d.open = open[i]; });
        $$('.rg[data-v]', sc).forEach((r) => r.style.setProperty('--rp', r.dataset.v));
        if (!keep || atEnd) sc.scrollTop = sc.scrollHeight; else sc.scrollTop = y;
      };
      page._redraw = draw;
      sc.innerHTML = `${hero(j)}<div class="msgs" id="msgs-${j.id}">${timeline(j)}</div>`;
      page.insertAdjacentHTML('beforeend', composer(j));
      wireComposer(page, j);
      onHold(sc, '.msg', (el) => peek(`<div class="pk"><div class="kicker">${el.classList.contains('me') ? 'Your message' : agentName(j.agent)}</div><p class="sub pk-msg">${esc($('p', el)?.textContent ?? '')}</p></div>`,
        [['Copy', I.copy, 'm-copy'], ['Edit and resend', I.edit, 'm-edit'], ['Rewind to here…', I.rewind, 'm-rewind'], ['Fork from here', I.fork, 'm-fork']]));
      onHold(sc, '.ckpt', (el) => peek(`<div class="pk"><div class="kicker">Checkpoint · turn ${el.dataset.turn}</div><p class="sub pk-msg">The files as they stood after this turn.</p></div>`,
        [['Review this turn', WI.fileDiff, `jc-ck-review-${el.dataset.turn}`], ['Undo this turn', WI.revert, `jc-ck-undo-${el.dataset.turn}`]]));
      onHold(page, '.cmp-send', () => peek(`<div class="pk"><div class="kicker">Send</div><p class="sub pk-msg">${esc($('.cmp-in', page).value || 'Your message')}</p></div>`,
        [['Steer now', WI.steer, 'm-steer'], ['Queue after this turn', I.clock, 'm-queue'], ['Interrupt and send now', I.stop, 'm-interrupt']]));
      requestAnimationFrame(() => { sc.scrollTop = sc.scrollHeight; });
      page._job = j;
    },
  });
}
// a change to this job redraws its page in place and keeps your place in the chat
document.addEventListener('work:change', (e) => {
  $$('#stack .chat-page').forEach((pg) => {
    const j = pg._job; if (!j || (e.detail?.job && e.detail.job !== j.id)) return;
    pg._redraw?.();
    const c = $('.cmp-wrap', pg); if (c) { const typed = $('.cmp-in', c)?.value ?? ''; c.outerHTML = composer(j); wireComposer(pg, j); const ta = $('.cmp-in', pg); if (ta) { ta.value = typed; grow(ta); syncSend(pg, j); } }
    const r = $('.tb-right', pg); if (r) r.innerHTML = topRight(j);
  });
});

function topRight(j) {
  const fs = filesOf(j); const [a, d] = fs.reduce((t, f) => [t[0] + f.a, t[1] + f.d], [0, 0]);
  const rv = reviewOf(j);
  const diff = fs.length ? `<button class="gbtn chrome jdiff-b" data-act="jdiff" data-id="${j.id}" aria-label="Changes: ${fs.length} files, ${a} lines added, ${d} removed${rv.left < rv.n ? `, ${rv.n - rv.left} reviewed` : ''}">${WI.fileDiff}<span class="num">${stat(a, d)}</span></button>` : '';
  return `${diff}<button class="gbtn chrome icon" data-act="jmenu" data-id="${j.id}" aria-label="Job menu">${I.dots}</button>`;
}

// The hero: the ring and where the job stands, its title, then what it is connected to: the project, the copy it works
// in, the task it came from and the goal it moves. Then what the session has used.
function hero(j) {
  const needs = j.lane === 'needs';
  const top = hasRing(j)
    ? `<div class="jh-top">${ring(j.progress.done / j.progress.total, 'jobs', 76, 9, { cls: j.lane === 'working' ? 'running' : '', inner: `<span class="agent ${j.agent} big">${I[j.agent]}</span>`, label: `${j.progress.done} of ${j.progress.total} steps` })}
        <div class="jh-stat"><b class="met c-jobs"><span data-count="${j.progress.done}">${j.progress.done}</span><small>/${j.progress.total} steps</small></b>
          <span class="jh-step">${esc(j.progress.step)}</span><span class="cap">${needs ? '<span class="amber">Needs you</span> · ' : ''}${esc(j.progress.stage)}</span></div></div>`
    : `<div class="jh-top"><span class="agent ${j.agent} big">${I[j.agent]}</span><div class="jh-stat"><span class="jh-step">${W.shipped[j.id] ? shippedWord(j) : STATUS[j.lane]}</span><span class="jmeta">${shipChip(j.ship)}<span>${esc(ago(j))}</span></span></div></div>`;
  const p = project(j.project); const l = linksOf(j); const t = l.task && taskOf(l.task); const g = l.goal && goalOf(l.goal);
  const links = [
    p ? `<button class="jlink" data-act="project" data-id="${p.slug}" data-back="Chat"><i class="dot" style="--c:${p.color}"></i><span>${esc(p.name)}</span></button>` : '',
    j.worktree ? `<button class="jlink mono" data-act="jcopy" data-id="${j.id}">${I.branch}<span>feat/${j.id}</span></button>` : `<span class="jlink is-static">${I.folder}<span>Project folder</span></span>`,
    t ? `<button class="jlink" data-act="w-task" data-id="${t.id}">${I.check}<span class="ell">From the task: ${esc(t.title)}</span></button>` : '',
    g ? `<button class="jlink" data-act="w-goal" data-id="${g.id}">${I.target}<span class="ell">Moves: ${esc(g.title)}</span></button>` : '',
    l.client ? `<button class="jlink" data-act="client-open" data-id="${l.client}">${I.clients}<span>For Morgan & Co.</span></button>` : '',
  ].filter(Boolean).join('');
  const turns = THREADS[j.id] ?? [];
  const started = turns[0]?.at;
  return `<div class="jhero">${top}
    <h1 class="t1">${esc(j.title)}</h1>
    <div class="jlinks">${links}</div>
    <p class="cap jh-use num">${started ? `Started ${started} · ` : ''}${esc(j.model)} · ${esc(j.effort)} · 12k in · 3k out · context 40%${j.cache ? ` · cache ${j.cache}m` : ''}</p>
  </div>`;
}
const shippedWord = (j) => ({ merged: 'Merged into main', committed: 'Committed', pr: 'Pull request open', builder: 'With the Builder' }[W.shipped[j.id]] ?? STATUS[j.lane]);

// ── the conversation ──────────────────────────────────────────────────
function timeline(j) {
  const turns = THREADS[j.id] ?? fallback(j);
  const live = j.lane === 'working';
  const html = turns.map((t, i) => turnHtml(j, t, i + 1, { last: i === turns.length - 1, live })).join('');
  return html + extra(j).map((m) => extraHtml(j, m)).join('') + pending(j);
}
function fallback(j) {
  if (j.id === 'j15') return THREADS.j15;
  if (CHAT[j.id]) return [{ at: '', me: CHAT[j.id][0].text, dur: '3m 10s', steps: [], ai: j.last }];
  const done = !['working'].includes(j.lane);
  return [{ at: '', me: `${j.title}. Keep it small and tested.`, dur: done ? '3m 10s' : null, live: !done, steps: [['read', 'Read the relevant files'], ['edit', 'Edited 4 files'], ['term', 'bun test', done ? 'All tests pass' : 'Running']], ai: done ? (j.last ?? 'Done.') : null }];
}
function turnHtml(j, t, n, { last, live }) {
  const running = t.live && last;
  const waiting = running && j.lane === 'needs';
  // while it waits on you, the step it wants to take is the card below; this group shows only what it already did
  const shown = waiting ? { ...t, steps: t.steps.slice(0, -1) } : t;
  return `<section class="turn" data-turn="${n}" aria-label="Turn ${n}">
    ${t.me ? `<div class="msg me"><p>${esc(t.me)}</p>${t.at ? `<span class="m-at num">${t.at}</span>` : ''}</div>` : ''}
    ${shown.steps?.length ? workGroup(j, shown, { running: running && !waiting, waiting }) : ''}
    ${t.ai ? `<div class="msg ai"><p>${esc(t.ai)}</p></div>` : ''}
    ${t.plan ? planCard(planFor(j), { compact: true }) : ''}
    ${!running ? checkpoint(j, n, t) : ''}
  </section>`;
}
const TOOL_I = { read: I.read, edit: I.edit, term: I.term, eye: I.eye, search: I.search, globe: I.globe, hammer: I.hammer };
// paths and commands read as code; everything else is a sentence
const CODE = /(`[^`]+`|(?:[\w.-]*\/)+[\w.<>-]+|[\w-]+\.(?:css|js|mjs|ts|md|swift|html|json|db|tsx))/g;
const toolText = (k, t) => (k === 'term' && /^(node|bun|git|npm|npx|pwsh|xcodebuild|pnpm)\b/.test(t) ? `<span class="mono">${esc(t)}</span>` : esc(t).replace(CODE, '<span class="mono">$1</span>'));
const tint = (d) => esc(d).replace(/\+(\d+)/g, '<b class="add">+$1</b>').replace(/−(\d+)/g, '<b class="del">−$1</b>');
function toolRow(j, [k, t, d], { run, wait }) {
  const isStat = d && /^[+−]\d/.test(d);
  const path = k === 'edit' && filesOf(j).find((f) => t.includes(f.path.split('/').pop()))?.path;
  const tag = path || k === 'term' ? 'button' : 'li';
  const act = path ? ` data-act="wr-open" data-id="${j.id}" data-path="${esc(path)}"` : k === 'term' ? ` data-act="jt-term" data-id="${j.id}"` : '';
  const body = `<span class="t-ic">${TOOL_I[k] ?? I.term}</span><span class="t-b"><span class="t-t">${toolText(k, t)}</span>${d && !isStat ? `<span class="t-d">${esc(d)}</span>` : ''}</span>${isStat ? `<span class="t-n num">${tint(d)}</span>` : ''}${run ? '<span class="t-s">Running</span>' : wait ? '<span class="t-s t-wait">Waiting for you</span>' : ''}`;
  return tag === 'button' ? `<li class="tool tap${run ? ' run' : ''}"><button class="t-btn"${act}>${body}</button></li>` : `<li class="tool${run ? ' run' : ''}">${body}</li>`;
}
// a work group says what it did, the way T3 Code folds tool calls: the two biggest kinds of work, then the rest
const KIND = { edit: ['Edited', 'a file', 'files'], term: ['Ran', 'a command', 'commands'], hammer: ['Handed off', 'a build', 'builds'], read: ['Read', 'a file', 'files'], search: ['Searched', 'once', 'times'], globe: ['Checked', 'a web page', 'web pages'], eye: ['Took', 'a screenshot', 'screenshots'] };
const RANK = ['edit', 'term', 'hammer', 'read', 'search', 'globe', 'eye'];
export function summarize(steps) {
  const n = {}; steps.forEach(([k]) => { n[k] = (n[k] ?? 0) + 1; });
  const kinds = RANK.filter((k) => n[k]);
  const say = (k, i) => { const [v, one, many] = KIND[k]; const w = i ? v.toLowerCase() : v; return `${w} ${n[k] === 1 ? one : `${n[k]} ${many}`}`; };
  const named = kinds.slice(0, 2).map(say); const rest = kinds.slice(2).reduce((s, k) => s + n[k], 0);
  return rest ? `${named.join(', ')} and ${rest} more` : named.join(' and ');
}
function workGroup(j, t, { running, waiting }) {
  const n = t.steps.length; const lastStep = t.steps[n - 1];
  const head = running
    ? `<span class="spin" style="--c:var(--jobs)"></span><span class="w-h"><b>Working for ${since(t.at, { secs: true })}</b><span class="cap w-now">${toolText(lastStep[0], lastStep[1])}</span></span>`
    : waiting ? `<span class="w-ic w-wait">${I.clock}</span><span class="w-h"><b>Waiting for you</b><span class="cap">${esc(summarize(t.steps))} so far</span></span>`
    : `<span class="w-ic">${I.check}</span><span class="w-h"><b>Worked for ${esc(t.dur)}</b><span class="cap">${esc(summarize(t.steps))}</span></span>`;
  return `<details class="work${running ? ' going' : ''}"${running ? ' open' : ''}><summary>${head}${I.chevD}</summary>
    <ol class="tools">${t.steps.map((s, i) => toolRow(j, s, { run: running && i === n - 1, wait: false })).join('')}</ol></details>`;
}
// a live tick: the running group gets its new step in place, so an open group stays open and nothing else moves
document.addEventListener('work:tick', (e) => {
  $$('#stack .chat-page').forEach((pg) => {
    const j = pg._job; if (!j || j.id !== e.detail?.job) return;
    const g = $('.work.going', pg); const t = (THREADS[j.id] ?? []).slice(-1)[0]; if (!g || !t) return;
    g.outerHTML = workGroup(j, t, { running: true, waiting: false });
    const sc = $('.scroll', pg); if (sc.scrollHeight - sc.clientHeight - sc.scrollTop < 160) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
    const row = $('.cmp-cap-row', pg); if (row) row.innerHTML = capsule(j) + modelPill(j);
  });
});
// what a finished turn changed: its checkpoint, one tap from reading it
function checkpoint(j, n, t) {
  const fs = turnFiles(j, n); if (!fs.length) return '';
  const [a, d] = fs.reduce((x, f) => [x[0] + f.a, x[1] + f.d], [0, 0]);
  return `<button class="ckpt" data-act="jdiff" data-id="${j.id}" data-turn="${n}"><span class="tile">${WI.fileDiff}</span>
    <span class="rbody"><b>${fs.length} file${fs.length === 1 ? '' : 's'} changed</b><span class="ck-m"><span class="num">${stat(a, d)}</span><span>Checkpoint ${n}${t.at ? ` · ${t.at}` : ''}</span></span></span><span class="btn sm">Review</span></button>`;
}
function extraHtml(j, m) {
  if (m.kind === 'me') return `<div class="msg me${m.fresh ? ' rise' : ''}"><p>${esc(m.text)}</p>${m.tag ? `<span class="m-tag">${esc(m.tag)}</span>` : ''}</div>`;
  if (m.kind === 'ai') return `<div class="msg ai"><p>${esc(m.text)}</p></div>`;
  if (m.kind === 'note') return `<p class="m-note">${m.icon ?? I.check}<span>${esc(m.text)}</span></p>`;
  if (m.kind === 'work') return workGroup(j, { at: m.at, dur: m.dur, steps: m.steps }, { running: !m.dur, waiting: false });
  if (m.kind === 'plan') return planCard(planFor(j), { foot: m.wait ? `<div class="ask-b pc-acts"><button class="btn sm primary" style="--c:var(--jobs-fill)" data-act="jp-approve" data-id="${j.id}">Approve and build</button><button class="btn sm" data-act="jp-change" data-id="${j.id}">Change it</button></div>` : '' });
  return '';
}

// What waits on you, at the end of the chat: an OK for a command, or a question with options.
function pending(j) {
  if (j.lane !== 'needs' || !j.ask) return '';
  if (j.ask.kind === 'permission') {
    const a = askOf(j);
    return `<div class="perm-card surface" id="ask-${j.id}" role="group" aria-label="${esc(a.who)}">
      <div class="pc-h">${I.shield}<b>${esc(a.who)}</b>${j.progress ? `<span class="cap num">Step ${j.progress.done + 1} of ${j.progress.total}</span>` : ''}</div>
      <pre class="pc-cmd mono"><span class="pc-ps">$</span> ${esc(a.cmd)}</pre>
      <p class="pc-why">${esc(a.where)}.${a.why ? ` ${esc(a.why)}` : ''}</p>
      ${NOTES[j.id] ? `<p class="wyn-hint">${I.sparkle}<span>${esc(NOTES[j.id])}</span></p>` : ''}
      <div class="ask-b"><button class="btn sm primary" style="--c:var(--needs)" data-act="allow" data-id="${j.id}">Allow once</button><button class="btn sm" data-act="allow" data-id="${j.id}" data-always="1">Always</button><button class="btn sm" data-act="deny" data-id="${j.id}">Deny</button></div>
      <div class="pc-more"><button class="pc-tell" data-act="jt-tell" data-id="${j.id}">${I.edit}Tell ${agentName(j.agent)} what to do instead</button>
        <details class="pc-whyd"><summary>Why is it asking?</summary><p>${esc(ACCESS[permOf(j)][0])} lets ${agentName(j.agent)} ${permOf(j) === 'ask' ? 'do nothing without asking you first' : 'edit files on its own, but it asks before it runs a command'}. ${permOf(j) === 'full' ? '' : 'Full access would skip this, for this job only.'}</p></details></div>
    </div>`;
  }
  const f = formOf(j);
  return `<div class="form-card surface" id="ask-${j.id}" role="group" aria-label="${esc(agentName(j.agent))} asks">
    <div class="pc-h">${I.chat}<b>${agentName(j.agent)} asks</b><span class="cap">1 question</span></div>
    <p class="fq">${esc(f.q)}</p>
    <div class="opts" role="radiogroup">${f.opts.map(([o, d, pick], i) => `<button class="opt" data-act="opt" data-i="${i}" role="radio" aria-checked="false"><span class="o-b"><span class="o-t">${esc(o)}${pick ? `<span class="o-pick">${I.sparkle}${esc('Wyn\'s pick')}</span>` : ''}</span>${d ? `<span class="o-d">${esc(d)}</span>` : ''}</span><span class="o-r"></span></button>`).join('')}</div>
    <div class="field o-other" hidden><input placeholder="Your price, e.g. ₹32,000" aria-label="Your answer" /></div>
    ${NOTES[j.id] ? `<p class="wyn-hint">${I.sparkle}<span>${esc(NOTES[j.id])}</span></p>` : ''}
    <div class="ask-b"><button class="btn sm primary" style="--c:var(--needs)" data-act="send-answers" data-id="${j.id}" disabled>Send answer</button><button class="btn sm" data-act="jt-skip" data-id="${j.id}">Skip</button></div>
  </div>`;
}

// ── answering: the same three moves wherever the question shows (here, the Work tab, Today) ──
export function allow(j, { always = false } = {}) {
  if (!j || j.lane !== 'needs' || j.ask?.kind !== 'permission') return;
  const a = askOf(j); const before = { lane: j.lane, ask: j.ask, last: j.last, p: j.progress && { ...j.progress } };
  if (always) W.always.add(a.cmd.split(' ').slice(0, 2).join(' '));
  const unsettle = settleWaiting(j);
  j.lane = 'working'; j.ask = null; j.last = `Running ${a.cmd}…`;
  const at = clockNow();
  const run = { kind: 'work', at, steps: [['term', a.cmd, j.id === 'j12' ? 'Running 52 tests across 9 files' : 'Running']] };
  extra(j).push({ kind: 'note', text: always ? `You allowed ${a.cmd.split(' ').slice(0, 2).join(' ')} for good in ${project(j.project)?.name}` : `You allowed ${a.cmd} once` }, run);
  haptic(14); changed({ job: j.id });
  toast(always ? `Always allowed: ${a.cmd.split(' ').slice(0, 2).join(' ')}` : 'Allowed once', () => { unsettle(); j.lane = before.lane; j.ask = before.ask; j.last = before.last; if (before.p) j.progress = before.p; W.extra[j.id] = extra(j).filter((m) => m !== run && m.kind !== 'note'); changed({ job: j.id }); });
  setTimeout(() => {
    if (j.lane !== 'working') return;
    run.dur = '1.8s'; run.steps = [['term', a.cmd, j.id === 'j12' ? '52 pass · 0 fail' : 'Exited 0']];
    if (j.progress) { j.progress.done = Math.min(j.progress.total - 1, j.progress.done + 1); j.progress.step = j.id === 'j12' ? 'Try it on the phone' : 'Carry on'; }
    j.last = j.id === 'j12' ? '52 pass. Building it for TestFlight.' : 'Done. Carrying on.';
    extra(j).push({ kind: 'ai', text: j.id === 'j12' ? '52 pass, 0 fail. The fix holds. Next I build it for TestFlight so you can try the button on your phone.' : 'It passed. Carrying on with the plan.' },
      { kind: 'work', at: clockNow(), steps: [['term', j.id === 'j12' ? 'ios-build --testflight' : 'Carry on', 'Building']] });
    changed({ job: j.id });
  }, 2600);
}
export function deny(j) {
  if (!j || j.lane !== 'needs') return;
  const a = askOf(j); const before = { lane: j.lane, ask: j.ask, last: j.last };
  const unsettle = settleWaiting(j);
  j.lane = 'working'; j.ask = null; j.last = 'Asked for another way to check the fix.';
  const added = [{ kind: 'note', icon: I.x, text: `You said no to ${a.cmd}` }, { kind: 'ai', text: 'Understood, no tests. I\'ll check the fix by reading the picker flow end to end instead, and say what I could not verify.' }];
  extra(j).push(...added);
  haptic(10); changed({ job: j.id });
  toast('Denied', () => { unsettle(); j.lane = before.lane; j.ask = before.ask; j.last = before.last; W.extra[j.id] = extra(j).filter((m) => !added.includes(m)); changed({ job: j.id }); });
}
export function answer(j, i, text) {
  if (!j || j.lane !== 'needs') return;
  const f = formOf(j); const pick = text || f.opts[i]?.[0]; if (!pick) return;
  j.lane = 'working'; j.ask = null; j.last = `Writing the tiers with the top at ${pick}.`;
  if (j.progress) { j.progress.done = Math.min(j.progress.total - 1, j.progress.done + 1); j.progress.step = 'Write the tiers'; }
  extra(j).push({ kind: 'me', text: pick, fresh: true }, { kind: 'work', at: clockNow(), steps: [['edit', 'Writing the Growth and Done-for-you tiers']] });
  haptic(12); changed({ job: j.id }); toast('Answer sent');
}
// once you answer, the turn that was waiting on you is over: its pending step becomes the run you allowed (or not)
function settleWaiting(j) {
  const t = (THREADS[j.id] ?? []).slice(-1)[0];
  if (!t?.live) return () => {};
  const was = { live: t.live, steps: t.steps, dur: t.dur };
  t.live = false; t.steps = t.steps.slice(0, -1); t.dur = t.dur ?? '—';
  return () => Object.assign(t, was);   // Undo puts the turn back as it was
}
const clockNow = () => { const d = new Date(Date.now() - W.loaded); const m = 17 * 60 + 40 + Math.floor(d / 60000); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

on('allow', (el) => allow(job(el.dataset.id), { always: !!el.dataset.always }));
on('deny', (el) => deny(job(el.dataset.id)));
on('opt', (el) => {
  const card = el.closest('.form-card, .wk-ask'); if (!card) return;
  $$('.opt', card).forEach((o) => { o.classList.toggle('on', o === el); o.setAttribute('aria-checked', String(o === el)); });
  const other = $('.o-other', card); const isOther = el.dataset.i === String(formOf(job(card.dataset.job ?? card.closest('[data-job]')?.dataset.job ?? '') ?? {}).opts?.length - 1);
  if (other) other.hidden = !(el === $$('.opt', card).pop());
  const b = $('[data-act="send-answers"]', card); if (b) b.disabled = false;
  if (other && !other.hidden) setTimeout(() => $('input', other)?.focus(), 60);
  haptic(5); void isOther;
});
on('send-answers', (el) => {
  const card = el.closest('.form-card'); const o = $('.opt.on', card); if (!o) return;
  const other = $('.o-other', card); const typed = other && !other.hidden ? $('input', other).value.trim() : '';
  if (other && !other.hidden && !typed) { $('input', other).focus(); return; }
  answer(job(el.dataset.id), Number(o.dataset.i), typed);
});
on('jt-skip', (el) => { const j = job(el.dataset.id); toast('Skipped. It stays in Needs you'); void j; });
on('jt-term', (el) => { const j = job(el.dataset.id); document.dispatchEvent(new CustomEvent('work:terminal', { detail: { project: j.project, job: j.id } })); });
on('jcopy', (el) => copySheet(job(el.dataset.id)));
on('w-task', (el) => api.openTask(el.dataset.id));
on('w-goal', (el) => api.openGoal(el.dataset.id));
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act^="jc-ck-"]'); if (!b) return;
  closePeek(); const [, , kind, n] = b.dataset.act.split('-'); const pg = $('#stack .chat-page:last-child'); const j = pg?._job; if (!j) return;
  if (kind === 'review') openChanges(j, { turn: Number(n) });
  else { const r = (W.review[j.id] ??= {}); turnFiles(j, Number(n)).forEach((f) => { r[f.path] = 'reverted'; }); changed({ job: j.id }); toast(`Turn ${n} undone`, () => { turnFiles(j, Number(n)).forEach((f) => { delete r[f.path]; }); changed({ job: j.id }); }); }
});

// ── the composer: what shapes the next turn, then the field ───────────
// The status capsule floats above the composer: where the job stands, in one line you can tap.
function capsule(j) {
  if (j.lane === 'working' && j.progress) {
    const last = (THREADS[j.id] ?? []).slice(-1)[0];
    return `<button class="cmp-cap chrome" data-act="jsteps" data-id="${j.id}" aria-label="Plan: ${j.progress.done} of ${j.progress.total} done, ${esc(j.progress.step)}">${ring(j.progress.done / j.progress.total, 'jobs', 20, 3, { cls: 'running' })}<b class="met c-jobs">${j.progress.done}<small>/${j.progress.total}</small></b><span class="ell">${esc(j.progress.step)}</span>${last?.live && last.at ? `<span class="cap">${since(last.at)}</span>` : ''}</button>
      ${j.queued ? `<button class="cmp-cap chrome cmp-qd" data-act="m-steer" aria-label="${j.queued} queued. Steer now">${I.clock}<b>${j.queued}</b></button>` : ''}`;
  }
  if (j.lane === 'needs') {
    const what = j.ask?.kind === 'permission' ? 'Waiting for your OK' : j.ask?.kind === 'plan' ? 'Plan ready for your OK' : 'Waiting for your answer';
    return `<button class="cmp-cap chrome is-needs" data-act="jt-goask" data-id="${j.id}"><i class="dot" style="--c:var(--needs)"></i><span>${what}</span>${I.chevD}</button>`;
  }
  const fs = filesOf(j); const rv = reviewOf(j);
  if (j.lane === 'review' && fs.length) return `<button class="cmp-cap chrome" data-act="jdiff" data-id="${j.id}">${WI.checkC}<span>${rv.left ? `${rv.left} of ${fs.length} files to review` : 'Reviewed · ready to ship'}</span>${I.chevR}</button>`;
  if (W.shipped[j.id]) return `<span class="cmp-cap chrome is-static">${WI.merge}<span>${shippedWord(j)}</span></span>`;
  return '';
}
// the job's settings ride beside the status: the model it uses, one tap from effort, access and plan first
const modelPill = (j) => `<button class="cmp-model chrome" data-act="jmodel" data-id="${j.id}" aria-label="This job: ${esc(j.model)}, effort ${esc(j.effort)}, ${esc(ACCESS[permOf(j)][0])}${W.planFirst[j.id] ? ', plan first' : ''}">${I[j.agent]}<span>${esc(j.model)}</span>${I.chevD}</button>`;
function placeholder(j) {
  if (j.lane === 'needs' && j.ask?.kind === 'permission') return `Or tell ${agentName(j.agent)} what to do`;
  if (j.lane === 'needs' && j.ask?.kind === 'plan') return 'Say what to change in the plan';
  if (j.lane === 'working') return 'Steer, or queue a message';
  return `Message ${agentName(j.agent)}`;
}
function composer(j) {
  const working = j.lane === 'working';
  const att = W.attach[j.id] ?? [];
  const plan = !!W.planFirst[j.id];
  void plan;
  return `<div class="cmp-wrap" data-job="${j.id}"><div class="cmp-cap-row">${capsule(j)}${modelPill(j)}</div>
    <div class="composer chrome">
      ${att.length ? `<div class="cmp-att">${att.map((a, i) => `<span class="cmp-chip">${a.icon}<span class="ell">${esc(a.label)}</span><button class="cmp-att-x" data-act="jc-unattach" data-id="${j.id}" data-i="${i}" aria-label="Remove ${esc(a.label)}">${I.x}</button></span>`).join('')}</div>` : ''}
      <div class="cmp-row">
        <button class="cmp-plus" data-act="jc-attach" data-id="${j.id}" aria-label="Add to the message">${I.plus}</button>
        <div class="field cmp-f"><textarea class="cmp-in" rows="1" placeholder="${esc(placeholder(j))}" aria-label="Message"></textarea><button class="fbtn" data-act="mic-note" data-id="${j.id}" aria-label="Record a voice note">${I.mic}</button></div>
        <button class="cmp-send ${working ? 'stop' : ''}" data-act="send" data-id="${j.id}" aria-label="${working ? 'Stop' : 'Send'}">${working ? I.stop : I.up}</button>
      </div>
      <div class="cmp-rec" hidden></div>
    </div>
  </div>`;
}
const grow = (ta) => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`; };
// while a job works, an empty field's button stops it; once you type, the same button steers (your setting) or queues
function syncSend(page, j) {
  const b = $('.cmp-send', page); if (!b) return;
  const typed = !!$('.cmp-in', page)?.value.trim();
  const stop = j.lane === 'working' && !typed;
  b.classList.toggle('stop', stop); b.innerHTML = stop ? I.stop : I.up;
  b.setAttribute('aria-label', stop ? 'Stop' : j.lane === 'working' ? (W.set.steer ? 'Steer' : 'Queue') : 'Send');
  // while you type, the model pill gives the field its room and keeps only the agent's mark
  $('.composer', page)?.classList.toggle('typing', typed);
}
function wireComposer(page, j) {
  const wrap = $('.cmp-wrap', page), ta = $('.cmp-in', page), sc = $('.scroll', page);
  const fit = () => sc.style.setProperty('--cmp-h', `${wrap.offsetHeight}px`);
  new ResizeObserver(fit).observe(wrap); fit();
  ta.addEventListener('input', () => { grow(ta); syncSend(page, j); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('.cmp-send', page)?.click(); } });
}
function sendMsg(page, j, how) {
  const ta = $('.cmp-in', page); const text = ta.value.trim(); if (!text) return false;
  // a message sent while an OK is pending says no to the command and tells the agent what to do instead
  if (j.lane === 'needs' && j.ask?.kind === 'permission') {
    const a = askOf(j); settleWaiting(j); j.lane = 'working'; j.ask = null; j.last = 'Taking another way, as you asked.';
    extra(j).push({ kind: 'note', icon: I.x, text: `You said no to ${a.cmd} and redirected it` }, { kind: 'me', text, fresh: true }, { kind: 'work', at: clockNow(), steps: [['read', 'Reading what you asked for instead']] });
    ta.value = ''; grow(ta); haptic(10); changed({ job: j.id }); toast('Declined and redirected');
    return true;
  }
  if (j.lane === 'needs' && j.ask?.kind === 'plan') {
    extra(j).push({ kind: 'me', text, fresh: true }, { kind: 'ai', text: 'Changed the plan. Have a look; I start once you approve it.' });
    ta.value = ''; grow(ta); haptic(8); changed({ job: j.id });
    return true;
  }
  const working = j.lane === 'working';
  const tag = working ? (how === 'queue' ? 'Queued for after this turn' : how === 'interrupt' ? 'Interrupted the turn' : 'Steered into this turn') : '';
  extra(j).push({ kind: 'me', text, tag, fresh: true });
  if (working && how === 'queue') j.queued = (j.queued ?? 0) + 1;
  ta.value = ''; grow(ta); haptic(8);
  if (!working) {
    j.lane = 'working'; j.ask = null; j.last = 'Reading your message';
    const w = { kind: 'work', at: clockNow(), steps: [['read', 'Reading your message'], ['edit', `Editing ${filesOf(j)[0]?.path.split('/').pop() ?? 'the files'}`]] };
    setTimeout(() => { extra(j).push(w); changed({ job: j.id }); }, 600);
  }
  W.attach[j.id] = [];
  changed({ job: j.id });
  return true;
}
on('send', (el) => {
  const page = el.closest('.page'); const j = job(el.dataset.id); if (!page || !j) return;
  if (sendMsg(page, j, W.set.steer ? 'steer' : 'queue')) return;
  if (j.lane === 'working') { const was = j.lane; j.lane = 'review'; j.last = 'Stopped by you.'; haptic(14); changed({ job: j.id }); toast('Stopped', () => { j.lane = was; changed({ job: j.id }); }); }
});
const fromPeek = (how) => { closePeek(); const pg = $('#stack .chat-page:last-child'); const j = pg?._job; if (pg && j && sendMsg(pg, j, how)) toast(how === 'queue' ? 'Queued after this turn' : how === 'interrupt' ? 'Interrupted and sent' : 'Steered into this turn'); };
on('m-steer', () => fromPeek('steer'));
on('m-queue', () => fromPeek('queue'));
on('m-interrupt', () => fromPeek('interrupt'));
on('m-copy', () => { closePeek(); toast('Copied'); });
on('m-edit', () => { closePeek(); toast('Back in the field to edit'); });
on('m-fork', () => { closePeek(); toast('Forked into a new job from here'); });
const rewindSheet = (j) => openSheet({
  title: 'Rewind', sub: 'Go back to a checkpoint. Pick what goes back.',
  body: `<div class="group">${(THREADS[j?.id] ?? []).map((t, i) => `<button class="row" data-act="rewound" data-n="${i + 1}"><span class="rbody"><span class="rtitle">Before turn ${i + 1}</span><span class="rmeta">${t.at ? `${t.at} · ` : ''}${esc((t.me ?? 'The agent carried on').slice(0, 44))}${(t.me ?? '').length > 44 ? '…' : ''}</span></span>${I.chevR}</button>`).join('')}</div>
    <div class="pad jrw">${seg('jrw', [['both', 'Code and chat'], ['chat', 'Chat only'], ['code', 'Code only']], 'both')}</div>`,
});
on('m-rewind', () => { closePeek(); rewindSheet($('#stack .chat-page:last-child')?._job); });
on('rewound', (el) => { closeSheet(); toast(`Rewound to before turn ${el.dataset.n}`, () => {}); });
on('jc-attach', (el) => {
  const j = job(el.dataset.id);
  const opts = [['image', WI.image, 'Photo or screenshot', 'The latest screenshot is 2 min old'], ['file', WI.file, 'A file from the project', `${project(j.project)?.folder.split('\\').pop()}\\…`], ['term', I.term, 'Terminal output', 'The last 40 lines of bun dev'], ['job', I.chat, 'Another job\'s chat', 'Summarised, not pasted'], ['brain', I.brain, 'A note from the Brain', 'For example the client\'s brief']];
  openSheet({ title: 'Add to the message', sub: `${agentName(j.agent)} reads it with your next message`, body: `<div class="group">${opts.map(([k, ic, t, m]) => `<button class="row ic" data-act="jc-add" data-id="${j.id}" data-k="${k}"><span class="tile">${ic}</span><span class="rbody"><span class="rtitle">${t}</span><span class="rmeta"><span class="ell">${esc(m)}</span></span></span>${I.plus}</button>`).join('')}</div>` });
});
const ATT = { image: [WI.image, 'Screenshot 17:38'], file: [WI.file, 'PhotoPicker.swift'], term: [I.term, 'bun dev · 40 lines'], job: [I.chat, 'Chat: j11'], brain: [I.brain, 'brief.md'] };
on('jc-add', (el) => { const j = job(el.dataset.id); const [icon, label] = ATT[el.dataset.k]; (W.attach[j.id] ??= []).push({ icon, label }); closeSheet(); haptic(6); changed({ job: j.id }); });
on('jc-unattach', (el) => { const j = job(el.dataset.id); W.attach[j.id]?.splice(Number(el.dataset.i), 1); changed({ job: j.id }); });
// a voice note: the recorder takes the field's place, and what you said lands in the field to check before sending
const SAY = { j15: 'Make the plan card more compact, and send me the link when the screenshots pass.', j13: 'Go with forty thousand, and add a yearly price at two months free.', j12: 'Run the tests, then try it on my phone.', j9: 'Split the setups by location, and keep each card under thirty seconds.' };
on('mic-note', (el) => {
  const page = el.closest('.page'); const j = job(el.dataset.id);
  const slot = page && $('.cmp-rec', page), row = page && $('.cmp-row', page);
  if (!slot || !row) return;
  row.hidden = true; slot.hidden = false;
  recorder(slot, {
    say: SAY[j?.id] ?? 'Keep it small, and add a test for it.',
    onDone: (text) => { row.hidden = false; slot.hidden = true; const ta = $('.cmp-in', page); ta.value = text; grow(ta); if (j) syncSend(page, j); },
    onCancel: () => { row.hidden = false; slot.hidden = true; },
  });
});

// ── what shapes the next turn ─────────────────────────────────────────
// one sheet for what shapes the next turn: the model, how hard it thinks, what it may do alone, and plan first
on('jmodel', (el) => {
  const j = job(el.dataset.id);
  const other = j.agent === 'claude' ? 'codex' : 'claude';
  openSheet({ title: 'This job', sub: `${agentName(j.agent)} on your PC · the next turn uses these`, large: true, cls: 'jt-set', body: (b) => {
    const draw = () => {
      const cur = permOf(j);
      b.innerHTML = `<p class="wr-lbl pad">Model</p>
        <div class="group">${MODELS[j.agent].map(([m, s, c]) => `<button class="row" data-act="jm-pick" data-id="${j.id}" data-m="${m}"><span class="rbody"><span class="rtitle">${m}</span><span class="rmeta"><span class="ell">${esc(s)}</span><span>· ${c}</span></span></span>${m === j.model ? pickMark : ''}</button>`).join('')}</div>
        <p class="wr-lbl pad">Effort</p>
        <div class="pad">${seg('eff', EFFORT.map(([e]) => [e, e]), j.effort)}<p class="foot jeff-note">${esc(EFFORT.find(([e]) => e === j.effort)?.[1] ?? '')}</p></div>
        <p class="wr-lbl pad">Access</p>
        <div class="group jsheet-list">${Object.entries(ACCESS).map(([k, [t, s, ic]]) => `<button class="row ic" data-act="jperm-pick" data-id="${j.id}" data-v="${k}" data-stay="1"><span class="tile${k === 'full' ? ' is-full' : ''}">${I[ic]}</span><span class="rbody"><span class="rtitle">${t}</span><span class="rmeta">${s}</span></span>${k === cur ? pickMark : ''}</button>`).join('')}</div>
        <div class="group jm-plan"><div class="row"><span class="rbody"><span class="rtitle">Plan first</span><span class="rmeta">It writes a plan and waits for your OK before it edits</span></span><button class="switch ${W.planFirst[j.id] ? 'on' : ''}" data-act="jplan-sw" data-id="${j.id}" role="switch" aria-checked="${!!W.planFirst[j.id]}" aria-label="Plan first"></button></div></div>
        <div class="group jm-fork"><button class="row ic" data-act="jm-switch" data-id="${j.id}"><span class="tile">${I[other]}</span><span class="rbody"><span class="rtitle">Hand it to ${agentName(other)}</span><span class="rmeta">A new job in its own copy, with this chat summarised</span></span>${I.chevR}</button></div>
        <p class="hint">Whatever it asks still comes to Needs you, wherever you are in the app.</p>`;
      wireSegs(b);
      $('.seg', b).addEventListener('change', (e) => { j.effort = e.detail; $('.jeff-note', b).textContent = EFFORT.find(([x]) => x === e.detail)?.[1] ?? ''; changed({ job: j.id }); });
    };
    b._draw = draw; draw();
  } });
});
on('jm-pick', (el) => { const j = job(el.dataset.id); j.model = el.dataset.m; haptic(6); changed({ job: j.id }); el.closest('.sheet-body')?._draw?.(); toast(`Next turn uses ${el.dataset.m}`); });
on('jt-tell', (el) => { const pg = el.closest('.page'); const ta = pg && $('.cmp-in', pg); if (ta) { ta.focus(); toast(`Type what ${agentName(job(el.dataset.id).agent)} should do instead`); } });
on('jt-goask', (el) => { const pg = el.closest('.page'); const card = pg && $(`#ask-${el.dataset.id}`, pg); const sc = pg && $('.scroll', pg); if (card && sc) sc.scrollTo({ top: card.offsetTop - 120, behavior: 'smooth' }); });
on('jm-switch', (el) => { const j = job(el.dataset.id); closeSheet(); setTimeout(() => api.newJob({ prompt: `Carry on from ${j.id}: ${j.title}`, project: j.project, agent: j.agent === 'claude' ? 'codex' : 'claude', from: j.id }), 280); });
on('jperm', (el) => {
  const j = job(el.dataset.id); const cur = permOf(j);
  openSheet({ title: 'Access', sub: `What ${agentName(j.agent)} may do without asking you`, body: `<div class="group jsheet-list">${Object.entries(ACCESS).map(([k, [t, s, ic]]) => `<button class="row ic" data-act="jperm-pick" data-id="${j.id}" data-v="${k}"><span class="tile${k === 'full' ? ' is-full' : ''}">${I[ic]}</span><span class="rbody"><span class="rtitle">${t}</span><span class="rmeta">${s}</span></span>${k === cur ? pickMark : ''}</button>`).join('')}</div>
    <div class="group jm-plan"><div class="row"><span class="rbody"><span class="rtitle">Plan first</span><span class="rmeta">It writes a plan and waits for your OK before it edits</span></span><button class="switch ${W.planFirst[j.id] ? 'on' : ''}" data-act="jplan-sw" data-id="${j.id}" role="switch" aria-checked="${!!W.planFirst[j.id]}" aria-label="Plan first"></button></div></div>
    <p class="hint">Whatever it asks still comes to Needs you, wherever you are in the app.</p>` });
});
on('jperm-pick', (el) => { const v = el.dataset.v; W.perm[el.dataset.id] = v; haptic(6); if (el.dataset.stay) el.closest('.sheet-body')?._draw?.(); else closeSheet(); changed({ job: el.dataset.id }); toast(`${ACCESS[v][0]} for the rest of this job`); });
on('jplan-sw', (el) => { const id = el.dataset.id; W.planFirst[id] = !W.planFirst[id]; el.classList.toggle('on', W.planFirst[id]); el.setAttribute('aria-checked', String(W.planFirst[id])); haptic(6); changed({ job: id }); toast(W.planFirst[id] ? 'Plan first: the next turn starts with a plan' : 'Plan first off'); });
on('jsteps', (el) => {
  const j = job(el.dataset.id);
  openSheet({ title: 'Plan', sub: `${j.progress.done} of ${j.progress.total} done · ${esc(j.progress.stage)}`, body: `<div class="pad">${planCard(planFor(j), { head: false })}</div>` });
});
on('jp-approve', (el) => {
  const j = job(el.dataset.id); const m = extra(j).find((x) => x.kind === 'plan' && x.wait); if (m) m.wait = false;
  j.lane = 'working'; j.ask = null; if (j.progress) { j.progress.done = 1; j.progress.step = planFor(j)[1]?.[1]?.[0] ?? 'Build'; }
  extra(j).push({ kind: 'note', text: 'You approved the plan' }, { kind: 'work', at: clockNow(), steps: [['edit', 'Starting on the first step']] });
  haptic(14); changed({ job: j.id }); toast('Plan approved. Building');
});
on('jp-change', (el) => { const pg = el.closest('.page'); const ta = pg && $('.cmp-in', pg); if (ta) { ta.value = 'Change the plan: '; ta.focus(); grow(ta); } });

// ── the job menu ──────────────────────────────────────────────────────
on('jmenu', (el) => {
  const j = job(el.dataset.id);
  const items = [['star', j.star ? I.starF : I.star, j.star ? 'Unstar' : 'Star'], ['rewind', I.rewind, 'Rewind to a checkpoint…'], ['fork', I.fork, 'Fork into a new job'], ['term', I.term, 'Open its terminal'], ['warm', I.flame, 'Keep the cache warm for 1 h']];
  if (BUILDERS.some((b) => b.project === j.project)) items.push(['builder', I.hammer, 'Open the Builder']);
  openSheet({ title: esc(j.title), sub: `${agentName(j.agent)} · ${esc(j.model)} · ${esc(j.effort)}`, body: `
    <div class="group">${items.map(([k, ic, t]) => `<button class="row ic" data-act="jm-do" data-k="${k}" data-id="${j.id}"><span class="tile">${ic}</span><span class="rbody"><span class="rtitle">${t}</span></span></button>`).join('')}</div>
    <div class="sh"><h2>Move to</h2></div>
    <div class="pad chips">${LANES.filter(([l]) => l !== 'archive').map(([l, n]) => `<button class="chip ${l === j.lane ? 'on' : ''}" data-act="jm-move" data-id="${j.id}" data-l="${l}">${n}</button>`).join('')}</div>
    <div class="group jm-danger"><button class="row ic" data-act="jm-do" data-k="archive" data-id="${j.id}"><span class="tile">${I.archive}</span><span class="rbody"><span class="rtitle">Archive</span></span></button></div>` });
});
on('jm-do', (el) => {
  const j = job(el.dataset.id), k = el.dataset.k;
  closeSheet();
  if (k === 'star') { j.star = !j.star; changed({ job: j.id }); toast(j.star ? 'Starred' : 'Unstarred'); }
  else if (k === 'archive') { const was = j.lane; j.lane = 'archive'; changed({ job: j.id }); pop(); toast('Archived', () => { j.lane = was; changed({ job: j.id }); }); }
  else if (k === 'rewind') setTimeout(() => rewindSheet(j), 320);
  else if (k === 'term') document.dispatchEvent(new CustomEvent('work:terminal', { detail: { project: j.project, job: j.id } }));
  else if (k === 'builder') document.dispatchEvent(new CustomEvent('work:builder', { detail: { id: BUILDERS.find((b) => b.project === j.project).id } }));
  else if (k === 'fork') setTimeout(() => api.newJob({ prompt: `Fork of ${j.id}: ${j.title}`, project: j.project, agent: j.agent, from: j.id }), 280);
  else toast('Cache kept warm for 1 h');
});
on('jm-move', (el) => { const j = job(el.dataset.id); const was = j.lane; j.lane = el.dataset.l; closeSheet(); changed({ job: j.id }); toast(`Moved to ${el.textContent}`, () => { j.lane = was; changed({ job: j.id }); }); });
// a job card anywhere opens its page: the live thread on the real engine (jobs.js decides), this story in demo
on('job', (el, e) => { if (e?.target?.closest?.('.ask-b button, .wk-ask button, .jnext button')) return; api.openJob(el.dataset.id); });
export { JOBS };

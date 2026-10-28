// Work · terminals and Builders. A terminal page holds a project's sessions as tabs: Claude Code or Codex running in a
// terminal, a plain PowerShell, a script. Real mode reads the PC's terminal host (GET /term, /term/:id/text every 1.5 s,
// keys and replies through /term/:id/key and /send): a plain shell runs whatever you send, so typing into it stays off
// until you turn it on; the agents' terminals take Y/N and number replies from the key bar. A Builder page says what
// it is shipping, how it ships (its notes), its model, and what it shipped. ?data=demo keeps the prototype's story.
import { $, $$, esc, push, openSheet, closeSheet, toast, on, haptic } from './core.js';
import { I } from './icons.js';
import { BUILDERS, PROJECTS } from './data.js';
import { TERMS, SCRIPTS } from './work-data.js';
import { W, WI, job, project, backLabel, shipChip, changed, REAL, markFor, plural } from './work-ui.js';
import { api } from './bus.js';
import * as E from './work-engine.js';

const KEYS = ['Enter', 'Esc', 'Tab', '↑', '↓', 'Y', 'N', '1', '2', '3', 'Ctrl C'];
const KEY_OF = { Enter: 'enter', Esc: 'esc', Tab: 'tab', '↑': 'up', '↓': 'down', Y: 'y', N: 'n', 1: '1', 2: '2', 3: '3', 'Ctrl C': 'ctrl-c', '⇧Tab': 'shift-tab' };
const sessions = (slug) => [...TERMS.filter((t) => t.project === slug), ...(W.extraTerms ?? []).filter((t) => t.project === slug)];
const PROMPT = (where) => `PS ~\\${esc(where)}&gt;`;
const ok = (t, ms) => `<span class="t-ok">✓</span> ${t} <span class="t-d">[${ms}ms]</span>`;

// what each session has printed so far (demo)
function out(t) {
  const p = `<span class="t-p">${PROMPT(t.where.startsWith('feat/') ? `.aos-copies\\${t.where.replace('/', '-')}` : t.where)}</span>`;
  const typed = W.term.filter((c) => c.term === t.id).map((c) => `${p} ${esc(c.text)}${c.reply ? `\n${c.reply}` : ''}`);
  if (t.kind === 'agent') {
    const j = job(t.job);
    const allowed = j && j.lane !== 'needs';
    return [
      `<span class="t-d">Codex · ${esc(j?.title ?? '')}</span>`,
      `${p} git status --short`, ' M keyboard/PhotoPicker.swift', ' M keyboard/KeyboardViewController.swift', ' M server/keyboard.ts',
      allowed
        ? [`${p} bun test server`, '<span class="t-d">bun test v1.3.2</span>', '', '<span class="t-f">server/keyboard.test.ts:</span>', ok('attaches the newest screenshot', '3.10'), ok('falls back to the shared container', '1.92'),
          '<span class="t-f">server/board.test.ts:</span>', ok('lanes move one step', '0.88'), '', ' <span class="t-ok">52 pass</span>', ' <span class="t-d">0 fail</span>', 'Ran 52 tests across 9 files. <span class="t-d">[1.84s]</span>'].join('\n')
        : `<span class="t-wait">Waiting for your OK to run</span> <span class="mono">bun test server</span>`,
      ...typed,
      `${p} <span class="caret"></span>`,
    ].join('\n');
  }
  if (t.kind === 'script') {
    return [`${p} ${esc(t.title)}`, '<span class="t-d">$ vite --port 5173</span>', '', '  <span class="t-ok">VITE v7.1.4</span>  ready in 812 ms', '', '  ➜  Local:   <span class="t-f">http://localhost:5173/</span>', '  ➜  Network: <span class="t-f">http://192.168.1.7:5173/</span>',
      '<span class="t-d">17:31:02</span> [vite] hmr update /js/jobs.js', '<span class="t-d">17:38:44</span> [vite] hmr update /css/system.css', ...typed].join('\n');
  }
  return [`${p} git log --oneline -3`, '<span class="t-f">a41c9e2</span> Jobs board, Builders and cache tracking', '<span class="t-f">9be03f1</span> Keyboard setup in Settings', '<span class="t-f">77d2a10</span> Voice meter recovers; effort picker', ...typed, `${p} <span class="caret"></span>`].join('\n');
}
const canType = (t) => t.kind !== 'shell' || W.set.type;
function bar(t) {
  if (!canType(t)) return `<div class="term-lock"><span class="tile">${I.lock}</span><span class="rbody"><b>Watching only</b><span>Typing into a plain PowerShell is off.</span></span><button class="btn sm" data-act="wt-type">Turn on</button></div>`;
  const keys = `<div class="keys" role="toolbar" aria-label="Keys" data-scroll-x>${KEYS.map((k) => `<button class="key" data-act="wt-key" data-k="${k}">${k}</button>`).join('')}</div>`;
  return `${keys}<div class="field term-f"><input class="mono term-in" placeholder="${t.kind === 'agent' || E.isAgentTerm(t) ? 'Reply, or type a command' : 'Type a command'}" aria-label="Command" enterkeyhint="send" autocapitalize="off" autocomplete="off" spellcheck="false" /><button class="fbtn" data-act="wt-send" aria-label="Run">${I.up}</button></div>`;
}
const stateWord = (t) => t.state === 'waiting' ? `<span class="amber">${esc(t.note)}</span>` : t.state === 'running' ? `<span class="c-jobs">Running</span><span>· ${esc(t.note)}</span>` : `<span>${esc(t.note)}</span>`;
const tIcon = (t) => (t.kind === 'agent' ? I[job(t.job)?.agent ?? 'codex'] : t.kind === 'script' ? I.play : I.term);

export function openTerminal(slug = 'agentic-os', pick = null) {
  if (REAL) return openTerminalReal(slug, pick);
  const p = project(slug); const list = sessions(slug);
  const st = { cur: pick ?? list[0]?.id };
  push({
    title: 'Terminal', back: backLabel(),
    right: `<button class="gbtn chrome icon" data-act="wt-new" data-p="${slug}" aria-label="New terminal">${I.plus}</button>`,
    render(sc, page) {
      page.classList.add('jpage', 'term-page');
      page._term = st;
      const draw = () => {
        const all = sessions(slug); const t = all.find((x) => x.id === st.cur) ?? all[0];
        sc.innerHTML = `<div class="phead"><h1 class="lt">Terminal</h1><p class="sub jt-sub"><span>${esc(p.name)}</span><span class="mono">${esc(t.where)}</span></p></div>
          <div class="wt-tabs" role="tablist" aria-label="Sessions" data-scroll-x>${all.map((x) => `<button class="wt-tab${x.id === t.id ? ' on' : ''}" role="tab" aria-selected="${x.id === t.id}" data-act="wt-pick" data-id="${x.id}">${tIcon(x)}<span>${esc(x.title)}</span>${x.state === 'waiting' ? '<i class="dot" style="--c:var(--needs)"></i>' : x.state === 'running' ? '<i class="live"></i>' : ''}</button>`).join('')}</div>
          <p class="wt-state">${stateWord(t)}</p>
          <div class="term surface"><pre class="mono" id="termOut">${out(t)}</pre></div>
          ${SCRIPTS[slug] ? `<div class="sh"><h2>Scripts</h2><span class="sh-count">${SCRIPTS[slug].length}</span></div>
          <div class="wt-scripts">${SCRIPTS[slug].map(([n, cmd]) => `<button class="wt-script" data-act="wt-run" data-p="${slug}" data-cmd="${esc(cmd)}" data-n="${esc(n)}"><b>${esc(n)}</b><span class="mono">${esc(cmd)}</span></button>`).join('')}</div>` : ''}`;
        let b = $('.term-bar', page);
        if (!b) { page.insertAdjacentHTML('beforeend', '<div class="term-bar chrome"></div>'); b = $('.term-bar', page); new ResizeObserver(() => sc.style.setProperty('--cmp-h', `${b.offsetHeight}px`)).observe(b); }
        b.innerHTML = bar(t); b.dataset.id = t.id;
      };
      page._redraw = draw;
      draw();
      page.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('.term-in')) { e.preventDefault(); send(page); } });
      requestAnimationFrame(() => { const o = $('.term', sc); if (o) sc.scrollTop = Math.max(0, o.offsetTop + o.offsetHeight - sc.clientHeight + 140); });
    },
  });
}
function send(page) {
  if (page._real) { sendReal(page); return; }
  const inp = $('.term-in', page); const text = inp?.value.trim(); if (!text) return;
  const id = $('.term-bar', page)?.dataset.id;
  const reply = /^git status/.test(text) ? 'On branch main\nnothing to commit, working tree clean' : /^ls|^dir/.test(text) ? 'app  docs  ios  server  tools  package.json  README.md' : null;
  W.term.push({ term: id, text, reply }); inp.value = ''; haptic(6);
  page._redraw?.();
  const sc = $('.scroll', page); sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' });
}
on('wt-pick', (el) => { const pg = el.closest('.page'); pg._term.cur = el.dataset.id; haptic(5); pg._redraw(); pg._tick?.(true); });
on('wt-send', (el) => send(el.closest('.page')));
on('wt-key', async (el) => {
  haptic(4); const k = el.dataset.k; const pg = el.closest('.page');
  if (pg?._real) { const id = pg._term.cur; try { await E.term.key(id, KEY_OF[k] ?? String(k).toLowerCase()); setTimeout(() => pg._tick?.(true), 250); } catch (e) { toast(E.err(e)); } return; }
  if (['Y', 'N', '1', '2', '3'].includes(k)) toast(`Sent ${k}`);
});
on('wt-type', async (el) => {
  const pg = el.closest('.page');
  if (pg?._real) { el.disabled = true; try { const r = await E.term.settings({ phoneShellInput: true }); E.code.settings = r.settings; haptic('success'); toast('Typing on for plain terminals. Turn it off in Board settings'); pg._redraw?.(); } catch (e) { el.disabled = false; toast(E.err(e)); } return; }
  W.set.type = true; haptic(8); pg?._redraw?.(); toast('Typing on for plain terminals');
});
on('wt-run', async (el) => {
  const { p, cmd, n } = el.dataset;
  if (REAL) {
    if (!E.code.settings.phoneShellInput) { toast('Running a script types into a PowerShell: turn on typing into plain terminals first (Board settings)'); return; }
    try {
      haptic(10);
      const r = await E.term.create({ kind: 'shell', project: p, title: `${n} · ${cmd}` });
      await E.term.send(r.session.id, cmd);
      await E.loadCode(true);
      toast(`${n}: ${cmd} started`);
      openTerminalReal(p, r.session.id);
    } catch (e) { toast(E.err(e)); }
    return;
  }
  const id = `tx${Date.now()}`;
  (W.extraTerms ??= []).push({ id, kind: 'script', title: cmd, project: p, where: project(p).folder.split('\\').pop(), state: 'running', note: 'Started just now' });
  haptic(10); toast(`${n}: ${cmd} started`);
  const pg = el.closest('.page'); if (pg?._term) { pg._term.cur = id; pg._redraw(); }
});
on('wt-new', (el) => {
  const slug = el.dataset?.p || null;
  const p = slug ? project(slug) : null;
  if (REAL && !p) {
    // no project picked: choose where it opens
    const list = projectsWithFolder();
    openSheet({ title: 'New terminal', sub: 'In which project?', body: `<div class="group">${list.map((x) => `<button class="row ic" data-act="wt-new" data-p="${esc(x.slug)}"><span class="tile"><i class="dot" style="--c:${x.color}"></i></span><span class="rbody"><span class="rtitle">${esc(x.name)}</span><span class="rmeta mono"><span class="ell">${esc(x.folder)}</span></span></span>${I.chevR}</button>`).join('') || '<div class="row"><span class="rbody"><span class="rmeta">No project has a folder yet. Set one on a project page.</span></span></div>'}</div>` });
    return;
  }
  const pp = p ?? project('agentic-os');
  if (el.closest('.sheet')) closeSheet();
  setTimeout(() => openSheet({
    title: 'New terminal', sub: `${esc(pp?.name ?? '')} · on your PC`,
    body: `<div class="group">${[['shell', I.term, 'PowerShell', 'A plain shell in the project folder'], ['claude', REAL ? markFor('claude', 20) : I.claude, 'Claude Code', 'The terminal app, for when you want the TUI'], ['codex', REAL ? markFor('codex', 20) : I.codex, 'Codex CLI', 'The same for Codex']].map(([k, ic, t, m]) => `<button class="row ic" data-act="wt-open" data-k="${k}" data-p="${pp?.slug ?? ''}"><span class="tile">${ic}</span><span class="rbody"><span class="rtitle">${t}</span><span class="rmeta">${m}</span></span>${I.chevR}</button>`).join('')}</div>`,
  }), el.closest('.sheet') ? 260 : 0);
});
const projectsWithFolder = () => PROJECTS.filter((x) => x.folder && !['done', 'archived', 'dropped'].includes(x.status));
on('wt-open', async (el) => {
  const { k, p } = el.dataset; closeSheet();
  if (REAL) {
    try {
      haptic(10);
      const r = await E.term.create({ kind: k, project: p || undefined, title: k === 'shell' ? 'PowerShell' : k === 'claude' ? 'Claude Code' : 'Codex CLI' });
      await E.loadCode(true);
      toast(k === 'shell' ? 'PowerShell opened on your PC' : `${k === 'claude' ? 'Claude Code' : 'Codex CLI'} started on your PC`);
      openTerminalReal(p || null, r.session.id);
    } catch (e) { toast(E.err(e)); }
    return;
  }
  const id = `tx${Date.now()}`;
  (W.extraTerms ??= []).push({ id, kind: k === 'shell' ? 'shell' : 'script', title: k === 'shell' ? 'PowerShell' : k === 'claude' ? 'claude' : 'codex', project: p, where: project(p).folder.split('\\').pop(), state: k === 'shell' ? 'idle' : 'running', note: k === 'shell' ? 'Just opened' : 'Started just now' });
  const pg = $('#stack .term-page:last-child'); if (pg?._term) { pg._term.cur = id; pg._redraw(); } else openTerminal(p, id);
  toast(k === 'shell' ? 'PowerShell opened' : `${k === 'claude' ? 'Claude Code' : 'Codex CLI'} started`);
});
on('terminal', (el) => openTerminal(el.dataset?.p || (REAL ? null : 'agentic-os'), el.dataset?.id || null));

// ── a real terminal page ──
const TERM_STATE = (t) => (t.status === 'exited' ? 'Ended' : !E.isAgentTerm(t) ? 'Open' : t.status === 'needs_input' ? 'Needs you' : t.status === 'running' ? 'Working' : 'Waiting for you');
function openTerminalReal(slug, pick) {
  const list = () => E.code.terms.filter((t) => (slug ? t.project === slug : true) && (t.status !== 'exited' || t.id === st.cur)).sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  const st = { cur: pick, text: new Map(), timer: 0, alive: true };
  const p = slug ? project(slug) : null;
  push({
    title: 'Terminal', back: backLabel(), cls: 'wt-real',
    right: `<button class="gbtn chrome icon" data-act="wt-new" data-p="${esc(slug ?? '')}" aria-label="New terminal">${I.plus}</button>`,
    onPop: () => { st.alive = false; clearTimeout(st.timer); },
    render(sc, page) {
      page.classList.add('jpage', 'term-page');
      page._term = st; page._real = true;
      const draw = () => {
        const all = list();
        if (!st.cur || !all.some((x) => x.id === st.cur)) st.cur = all[0]?.id ?? st.cur;
        const t = E.code.terms.find((x) => x.id === st.cur);
        if (!t) {
          sc.innerHTML = `<div class="phead"><h1 class="lt">Terminal</h1><p class="sub jt-sub"><span>${esc(p?.name ?? 'Every project')}</span></p></div>
            <div class="group"><button class="row ic jempty" data-act="wt-new" data-p="${esc(slug ?? '')}"><span class="tile">${I.term}</span><span class="rbody"><span class="rtitle">${E.code.down ? 'The terminal host isn’t running' : 'No terminal open'}</span><span class="rmeta">${E.code.down ? 'It starts with the first terminal you open.' : 'Open a PowerShell, Claude Code or Codex in a project.'}</span></span>${I.chevR}</button></div>`;
          $('.term-bar', page)?.remove();
          return;
        }
        const out = st.text.get(t.id);
        const agent = E.isAgentTerm(t);
        const live = t.status !== 'exited';
        sc.innerHTML = `<div class="phead"><h1 class="lt">Terminal</h1><p class="sub jt-sub"><span>${esc(project(t.project)?.name ?? p?.name ?? '')}</span><span class="mono">${esc(String(t.cwd ?? '').split(/[\\/]/).filter(Boolean).slice(-2).join('\\'))}</span></p></div>
          <div class="wt-tabs" role="tablist" aria-label="Sessions" data-scroll-x>${all.map((x) => `<button class="wt-tab${x.id === t.id ? ' on' : ''}" role="tab" aria-selected="${x.id === t.id}" data-act="wt-pick" data-id="${esc(x.id)}">${E.isAgentTerm(x) ? markFor(x.kind, 16, { state: x.status === 'needs_input' ? 'needs' : x.status === 'running' ? 'working' : 'idle' }) : I.term}<span>${esc(x.title)}</span>${x.status === 'needs_input' ? '<i class="dot" style="--c:var(--needs)"></i>' : x.status === 'running' && agent ? '<i class="live"></i>' : ''}</button>`).join('')}</div>
          <p class="wt-state"><span class="${t.status === 'needs_input' ? 'amber' : t.status === 'running' && agent ? 'c-jobs' : ''}">${esc(TERM_STATE(t))}</span>${t.detail && agent ? `<span>· ${esc(String(t.detail).slice(0, 120))}</span>` : ''}${t.updatedAt ? `<span>· ${esc(E.clock.ago(t.updatedAt))}</span>` : ''}</p>
          <div class="term surface"><pre class="mono wt-out" aria-label="Terminal screen" tabindex="0">${out == null ? '<span class="t-d">Reading the screen…</span>' : esc(out || ' ')}</pre></div>
          <div class="pad wt-acts">${agent && live ? `<button class="btn sm" data-act="wt-act" data-a="done">${I.check}${t.taskIds?.length ? 'Done, close its tasks' : 'Done'}</button>` : ''}${live ? `<button class="btn sm tint" style="--c:var(--fail-ink)" data-act="wt-act" data-a="kill">${I.stop}Stop</button>` : `<button class="btn sm primary" style="--c:var(--jobs-fill)" data-act="wt-act" data-a="restart">${t.engineSessionId ? 'Resume' : 'Restart'}</button>`}</div>`;
        let b = $('.term-bar', page);
        if (!b) { page.insertAdjacentHTML('beforeend', '<div class="term-bar chrome"></div>'); b = $('.term-bar', page); new ResizeObserver(() => sc.style.setProperty('--cmp-h', `${b.offsetHeight}px`)).observe(b); }
        const typing = live && (agent || E.code.settings.phoneShellInput);
        const html = !live ? '' : typing ? `<div class="keys" role="toolbar" aria-label="Keys" data-scroll-x>${[...KEYS.slice(0, 5), '⇧Tab', ...KEYS.slice(5)].map((k) => `<button class="key" data-act="wt-key" data-k="${k}">${k}</button>`).join('')}</div><div class="field term-f"><input class="mono term-in" placeholder="${agent ? 'Reply, or type a command' : 'Type a command'}" aria-label="Send to the terminal" enterkeyhint="send" autocapitalize="off" autocomplete="off" spellcheck="false" /><button class="fbtn" data-act="wt-send" aria-label="Send">${I.up}</button></div>`
          : `<div class="term-lock"><span class="tile">${I.lock}</span><span class="rbody"><b>Watching only</b><span>Typing into a plain terminal is off.</span></span><button class="btn sm" data-act="wt-type">Turn on</button></div>`;
        if (b._html !== html) { const keep = $('.term-in', b)?.value ?? ''; b.innerHTML = html; b._html = html; const inp = $('.term-in', b); if (inp) inp.value = keep; }
        b.hidden = !live;
        b.dataset.id = t.id;
        const pre = $('.wt-out', sc); if (pre && st.atEnd !== false) pre.scrollTop = pre.scrollHeight;
      };
      page._redraw = draw;
      const tick = async (now = false) => {
        clearTimeout(st.timer);
        if (!page.isConnected) st.alive = false;   // left without a pop (a tab switch)
        if (!st.alive) return;
        if (document.visibilityState === 'visible' && st.cur) {
          try {
            const r = await E.term.text(st.cur, 200);
            const pre = $('.wt-out', sc);
            st.atEnd = !pre || pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40 || now;
            if (r.text !== st.text.get(st.cur)) { st.text.set(st.cur, r.text ?? ''); if (pre) { pre.textContent = r.text || ' '; if (st.atEnd) pre.scrollTop = pre.scrollHeight; } else draw(); }
            const t = E.code.terms.find((x) => x.id === st.cur);
            if (t && r.status && t.status !== r.status) { t.status = r.status; draw(); }
          } catch (e) { if (e.status === 404) { st.text.set(st.cur, 'This terminal is gone from your PC.'); draw(); } }
        }
        const t = E.code.terms.find((x) => x.id === st.cur);
        st.timer = setTimeout(() => tick(), t?.status === 'exited' ? 15000 : 1500);
      };
      page._tick = tick;
      draw();
      page.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.closest('.term-in')) { e.preventDefault(); sendReal(page); } });
      E.loadCode(true).then(() => { draw(); tick(true); });
    },
  });
}
async function sendReal(page) {
  const inp = $('.term-in', page); const text = inp?.value.trim(); if (!text) return;
  const id = page._term.cur;
  inp.value = ''; haptic(6);
  try { await E.term.send(id, text); setTimeout(() => page._tick?.(true), 200); } catch (e) { inp.value = text; toast(E.err(e)); }
}
on('wt-act', async (el) => {
  const pg = el.closest('.page'); const id = pg?._term?.cur; if (!id) return; const a = el.dataset.a;
  if (a === 'kill' && !(await E.confirm({ title: 'Stop this terminal?', body: 'Whatever runs in it stops. You can start it again from here.', ok: 'Stop it', cancel: 'Keep it', danger: true }))) return;
  try {
    const r = await E.term.act(id, a, a === 'done' ? { completeTasks: true } : {});
    if (a === 'done') { haptic('success'); toast(r.failed?.length ? `Couldn’t close ${r.failed.map((f) => f.id).join(', ')}` : r.closed?.length ? `Closed ${r.closed.join(', ')}` : 'Marked done'); }
    else toast(a === 'kill' ? 'Stopped' : 'Starting again');
    await E.loadCode(true); pg._redraw?.(); pg._tick?.(true);
  } catch (e) { toast(E.err(e)); }
});

// ── Builders: how each project ships, step by step, and what it shipped last ──
const PIPES = {
  b1: { at: 2, run: { job: 'j14', title: 'Worktree jobs by default', build: 'build 39571', time: '4m' },
    steps: [['git merge feat/j14', 'Merge the job’s own copy'], ['bun test server', 'Run the server tests'], ['scripts/build-www.mjs', 'Build the web app'], ['server\\restart.ps1', 'Restart, once no job is busy'], ['ios-build', 'Run the iOS build workflow']],
    ships: [['j14', 'Worktree jobs by default', 'building', '24m'], ['j11', 'Jobs board, Builders and cache tracking', 'live', '5h'], ['j10', 'Keyboard setup in Settings', 'live', '7h'], ['j4', 'Mic level meter', 'failed', '1d']] },
  b2: { at: -1,
    steps: [['git merge', 'Merge the job’s own copy'], ['bun test', 'Run the tests'], ['bun run build', 'Build the ERP'], ['deploy', 'Ship the build']],
    ships: [['j3', 'Stock report export', 'live', '1d']] },
};
const BSET = { model: ['Model', ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5']], effort: ['Effort', ['Low', 'Medium', 'High', 'Max']], batch: ['Batching', ['Ship each job alone', 'Within 10 min', 'Within 30 min']] };
const bval = (b, k) => (k === 'batch' ? (b.batch ?? 'Within 10 min') : b[k]);
export function openBuilder(id) {
  if (REAL) return openBuilderReal(id);
  const b = BUILDERS.find((x) => x.id === id); if (!b) return;
  const pipe = PIPES[id] ?? PIPES.b1; const building = b.state === 'building' && pipe.run;
  push({
    title: b.name, back: backLabel(),
    render(sc, page) {
      page.classList.add('jpage');
      sc.innerHTML = `<div class="phead"><p class="kicker">Builder</p><h1 class="lt">${esc(b.name)}</h1><p class="sub">Merges, tests, builds and restarts what jobs hand it, once no job is busy.</p></div>
        <div class="group jb-now">${building
          ? `<button class="row ic" data-act="job" data-id="${pipe.run.job}"><span class="tile">${I.hammer}</span><span class="rbody"><span class="rtitle">Building ${esc(pipe.run.title)}</span><span class="rmeta"><span class="mono">${pipe.run.job}</span><span>· ${pipe.run.build} · ${pipe.run.time}</span></span></span>${I.chevR}</button>`
          : `<div class="row ic"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle">Idle</span><span class="rmeta">${esc(b.last)}</span></span></div>`}</div>
        <div class="sh"><h2>How it ships</h2><span class="sh-count">${pipe.steps.length} steps</span></div>
        <ol class="group jpipe">${pipe.steps.map(([cmd, what], i) => {
          const s = building ? (i < pipe.at ? 'done' : i === pipe.at ? 'run' : '') : '';
          return `<li class="row jp-r ${s}"><span class="jp-c">${s === 'done' ? I.check : s === 'run' ? '<span class="spin" style="--c:var(--jobs)"></span>' : i + 1}</span><span class="rbody"><span class="rtitle mono">${esc(cmd)}</span><span class="rmeta">${esc(what)}</span></span>${s === 'run' ? '<span class="jp-s">Running</span>' : ''}</li>`;
        }).join('')}</ol>
        <div class="sh"><h2>Settings</h2></div>
        <div class="group">${Object.entries(BSET).map(([k, [label]]) => `<button class="row" data-act="wb-set" data-id="${b.id}" data-k="${k}"><span class="rbody"><span class="rtitle">${label}</span></span><span class="rend">${esc(bval(b, k))}${I.chevR}</span></button>`).join('')}</div>
        <div class="sh"><h2>Recent ships</h2></div>
        <div class="group">${pipe.ships.map(([jid, t, s, when]) => { const tag = job(jid) ? 'button' : 'div'; return `<${tag} class="row"${tag === 'button' ? ` data-act="job" data-id="${jid}"` : ''}><span class="rbody"><span class="rtitle">${esc(t)}</span><span class="rmeta"><span class="mono">${jid}</span><span>· ${when} ago</span></span></span>${shipChip(s)}</${tag}>`; }).join('')}</div>`;
    },
  });
}
on('builder', (el) => openBuilder(el.dataset.id));
on('wb-set', (el) => {
  const b = BUILDERS.find((x) => x.id === el.dataset.id); const k = el.dataset.k; const [title, opts] = BSET[k];
  openSheet({ title, sub: `${esc(b.name)} Builder`, body: `<div class="group">${opts.map((o) => `<button class="row" data-act="wb-pick" data-id="${b.id}" data-k="${k}" data-v="${o}"><span class="rbody"><span class="rtitle">${o}</span></span>${o === bval(b, k) ? `<span class="jpick">${I.check}</span>` : ''}</button>`).join('')}</div>` });
});
on('wb-pick', (el) => {
  const b = BUILDERS.find((x) => x.id === el.dataset.id); const { k, v } = el.dataset;
  b[k] = v; closeSheet();
  const end = $(`#stack .page:last-child [data-act="wb-set"][data-k="${k}"] .rend`); if (end) end.innerHTML = `${esc(v)}${I.chevR}`;
  toast(`${BSET[k][0]}: ${v}`); changed();
});
// real: GET /jobs/builders; notes, model and effort through POST /jobs/builders/:key; batching is the board's
const SHIP_WORD = { queued: 'Queued', sent: 'With the Builder', committed: 'Committed', building: 'Building', live: 'Live', failed: 'Failed' };
function openBuilderReal(key) {
  const st = { key, alive: true, s: null };
  push({
    title: 'Builder', back: backLabel(), cls: 'wb-real',
    onPop: () => { st.alive = false; },
    render(sc, page) {
      page.classList.add('jpage');
      const draw = () => {
        const b = (E.builders.list ?? []).find((x) => x.key === key);
        const t = $('.tb-title', page); if (t && b) t.textContent = E.builderName(b);
        if (!b) { sc.innerHTML = `<div class="phead"><p class="kicker">Builder</p><h1 class="lt">Builder</h1><p class="sub">${E.builders.list ? 'This Builder isn’t on your PC any more.' : 'Reading the Builders on your PC…'}</p></div>`; return; }
        const focused = document.activeElement?.classList?.contains('wb-notes');
        if (focused) return;   // never redraw under the finger while he writes its notes
        const cur = (b.ships ?? []).find((s) => ['queued', 'sent', 'committed', 'building'].includes(s.state));
        const j = b.job;
        const busy = !!cur || (j && ['starting', 'running', 'needs_input'].includes(j.status));
        const MODELS = [['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku']];
        const EFF = ['low', 'medium', 'high', 'xhigh', 'max'];
        sc.innerHTML = `<div class="phead"><p class="kicker">Builder</p><h1 class="lt">${esc(E.builderName(b))}</h1><p class="sub">Commits, merges, builds and deploys what ${b.key === '_global' ? 'jobs without a project' : 'this project’s jobs'} hand over with publish_changes, once no job is busy.</p></div>
          <div class="group jb-now">${cur ? `<button class="row ic" data-act="job" data-id="${esc(cur.jobId)}"><span class="tile">${I.hammer}</span><span class="rbody"><span class="rtitle">${esc(SHIP_WORD[cur.state] ?? cur.state)}: ${esc(cur.title)}</span><span class="rmeta"><span class="mono">${esc(cur.jobId)}</span><span>· ${esc(E.clock.ago(cur.at))} ago</span></span></span><span class="wk-bmk">${markFor(j ?? 'claude', 18, { state: 'working' })}</span></button>`
            : `<div class="row ic"><span class="tile">${I.check}</span><span class="rbody"><span class="rtitle">${busy ? 'Working' : 'Idle'}</span><span class="rmeta"><span class="ell">${(b.ships ?? [])[0] ? `Last ship ${b.ships[0].state === 'live' ? 'went live' : SHIP_WORD[b.ships[0].state]?.toLowerCase() ?? b.ships[0].state} ${esc(E.clock.ago(b.ships[0].doneAt ?? b.ships[0].at))} ago` : 'It starts with the first job that ships'}</span></span></span></div>`}
            ${j ? `<button class="row ic" data-act="job" data-id="${esc(j.id)}"><span class="tile">${markFor(j, 20)}</span><span class="rbody"><span class="rtitle">Its chat</span><span class="rmeta"><span class="ell">${esc({ starting: 'Starting', running: 'Working', needs_input: 'Needs you', idle: 'Waiting', stopped: 'Stopped', failed: 'Failed', done: 'Done' }[j.status] ?? j.status)} · ${esc(E.clock.ago(j.updatedAt ?? j.createdAt))}</span></span></span>${I.chevR}</button>` : ''}</div>
          <div class="sh"><h2>How it ships</h2></div>
          <div class="pad"><label class="field wb-notesf"><textarea class="wb-notes" rows="4" placeholder="e.g. run bun test server, then restart.ps1" aria-label="How this project ships">${esc(b.notes ?? '')}</textarea></label><p class="hint wb-hint">The Builder follows these steps on every ship. Saved when you leave the field.</p></div>
          <div class="sh"><h2>Settings</h2></div>
          <div class="group">
            <button class="row" data-act="wbr-pick" data-k="model"><span class="rbody"><span class="rtitle">Model</span></span><span class="rend">${esc(MODELS.find(([v]) => v === (b.model ?? 'sonnet'))?.[1] ?? E.modelName(b.model))}${I.chevR}</span></button>
            <button class="row" data-act="wbr-pick" data-k="effort"><span class="rbody"><span class="rtitle">Effort</span></span><span class="rend">${esc(E.effortName(b.effort ?? 'medium'))}${I.chevR}</span></button>
            ${st.s ? `<button class="row" data-act="wbr-pick" data-k="batch"><span class="rbody"><span class="rtitle">Batching</span><span class="rmeta">For every Builder: how long it waits for more to ship</span></span><span class="rend">${st.s.batchSec ? `${st.s.batchSec} s` : 'No wait'}${I.chevR}</span></button>` : ''}
          </div>
          ${b.ships?.length ? `<div class="sh"><h2>Recent ships</h2><span class="sh-count">${b.ships.length}</span></div>
          <div class="group">${b.ships.slice(0, 10).map((s) => `<button class="row" data-act="job" data-id="${esc(s.jobId)}"><span class="rbody"><span class="rtitle">${esc(s.title)}</span><span class="rmeta"><span class="mono">${esc(s.jobId)}</span><span>· ${esc(E.clock.ago(s.doneAt ?? s.at))} ago${s.commit ? ` · ${esc(s.commit)}` : ''}</span></span>${s.note ? `<span class="jlast">${esc(s.note)}</span>` : ''}</span>${shipChip(s.state)}</button>`).join('')}</div>` : ''}`;
        page._b = b; page._models = MODELS; page._eff = EFF;
      };
      page._redraw = draw;
      draw();
      Promise.all([E.loadBuilders(true), E.boardSettings.get().then((s) => { st.s = s; }).catch(() => {})]).then(() => { if (st.alive) draw(); });
      sc.addEventListener('focusout', async (e) => {
        const ta = e.target.closest?.('.wb-notes'); if (!ta) return;
        const b = page._b; const was = (b?.notes ?? '').trim();
        if (ta.value.trim() === was) return;
        try { await E.configureBuilder(key, { notes: ta.value.trim() || null }); toast('Saved'); } catch (er) { toast(E.err(er)); }
        draw();
      });
    },
  });
}
on('wbr-pick', (el) => {
  const pg = el.closest('.page'); const b = pg?._b; if (!b) return; const k = el.dataset.k;
  const opts = k === 'model' ? pg._models.map(([v, l]) => [v, l]) : k === 'effort' ? pg._eff.map((v) => [v, E.effortName(v)]) : [[0, 'No wait'], [20, '20 s'], [60, '60 s']];
  const cur = k === 'model' ? b.model ?? 'sonnet' : k === 'effort' ? b.effort ?? 'medium' : null;
  openSheet({ title: { model: 'Model', effort: 'Effort', batch: 'Batching' }[k], sub: esc(E.builderName(b)), body: (x) => {
    x.innerHTML = `<div class="group">${opts.map(([v, l]) => `<button class="row" data-v="${esc(v)}"><span class="rbody"><span class="rtitle">${esc(l)}</span></span>${String(v) === String(cur) ? `<span class="jpick">${I.check}</span>` : ''}</button>`).join('')}</div>`;
    x.addEventListener('click', async (e) => {
      const r = e.target.closest('[data-v]'); if (!r) return;
      try {
        if (k === 'batch') await E.boardSettings.set({ batchSec: Number(r.dataset.v) });
        else await E.configureBuilder(b.key, { [k]: r.dataset.v });
        haptic(6); toast('Saved');
      } catch (er) { toast(E.err(er)); }
      closeSheet(x.closest('.sheet')); pg._redraw?.();
    });
  } });
});
export const termCount = (slug) => (REAL ? E.code.terms.filter((t) => t.project === slug && t.status !== 'exited').length : sessions(slug).length);
export const termSessions = (slug) => (REAL ? E.code.terms.filter((t) => t.project === slug) : sessions(slug));
export { WI };

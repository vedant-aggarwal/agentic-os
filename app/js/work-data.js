// Work's own mock data: what each job said and did, what it changed turn by turn, each project's repo, the terminals,
// project scripts and the night shift. Shared data (JOBS, PROJECTS, TASKS, GOALS) stays in data.js; this file only adds
// to it by job id or project slug, so every screen still tells the same story. Now is Thu 22 Oct 2026, 17:40.

// ── pickers ───────────────────────────────────────────────────────────
export const MODELS = {
  claude: [
    ['Opus 5.5', 'Deepest. Builds, refactors, hard bugs', '1M context'],
    ['Sonnet 5.5', 'Fast. Most everyday jobs', '1M context'],
    ['Haiku 5.5', 'Quick fixes and questions', '200k context'],
  ],
  codex: [
    ['gpt-6.1-sol', 'Default. Long refactors and tests', '400k context'],
    ['gpt-6.1-mini', 'Fast and cheap for small edits', '400k context'],
  ],
};
export const EFFORT = [
  ['Low', 'Answers fast, thinks little'],
  ['Medium', 'A short think before each turn'],
  ['High', 'Thinks it through. Your default'],
  ['Max', 'The longest think. Slow, and spends the most of your plan'],
];
export const ACCESS = {
  ask: ['Ask first', 'Asks before it edits a file or runs a command', 'shield'],
  auto: ['Auto-edit', 'Edits files on its own, asks before it runs a command', 'edit'],
  full: ['Full access', 'Edits and runs anything without asking', 'bolt'],
};
export const WHERE = {
  copy: ['Separate copy', 'Its own branch next to the repo. Merge back as one commit, or open a PR'],
  folder: ['Project folder', 'Works straight in your files, on the branch you are on'],
  compare: ['Compare two agents', 'Claude and Codex take the same task in two copies. You keep one'],
};

// ── what links a job back to the rest of the life OS: the task it came from, the goal it moves, the client it is for ──
export const LINKS = {
  j12: { task: 't18' },
  j13: { goal: 'g4', client: 'dad-shop' },
  j9: { task: 't5', goal: 'g3' },
  j15: { goal: null },
  j14: {},
};

// ── each job's conversation, turn by turn. A turn: your message, the work (tool calls), the answer, what changed.
//    at: when the turn started; steps: [kind, text, detail?]; files: the turn's checkpoint (paths into CHANGES) ──
export const THREADS = {
  j12: [
    { at: '16:58', me: 'The keyboard\'s Latest screenshot button attaches nothing. Fix it.', dur: '2m 41s', steps: [
      ['search', 'Searched the keyboard extension for "screenshot"', '6 results in 3 files'],
      ['read', 'Read KeyboardViewController.swift'],
      ['read', 'Read PhotoPicker.swift'],
      ['edit', 'Edited PhotoPicker.swift', '+18 −6'],
      ['edit', 'Edited KeyboardViewController.swift', '+4'],
      ['edit', 'Edited server/keyboard.ts', '+9 −2'],
    ], ai: 'The extension asked Photos for the newest asset before access was granted, so it got nothing. It now waits for the grant and falls back to the shared app-group container.' },
    { at: '17:37', me: null, dur: null, live: true, steps: [['term', 'bun test server', 'Waiting for your OK']] },
  ],
  j13: [
    { at: '17:24', me: 'Price Atlas ERP in three tiers. Use the last two client calls.', dur: '4m 05s', steps: [
      ['read', 'Read the Atlas ERP notes and the last two client calls'],
      ['globe', 'Compared 4 pricing pages', 'Vyapar, Marg ERP, Zoho Books, Tally Prime'],
      ['edit', 'Drafted pricing/atlas-tiers.md', '+86'],
    ], ai: 'Three tiers drafted: Starter, Growth and Done-for-you. Starter and Growth follow the two calls. One call before I finish the page.' },
  ],
  j15: [
    { at: '16:41', me: 'Mockup of the whole phone app, new UI. Apple-level, liquid glass, less clutter. Tasks compact on Home with a switch. Content OS and Jobs up front. Send me a Cloudflare link.', dur: '1m 52s', steps: [
      ['read', 'Read index.html, app.js, MODULES.md'],
      ['term', 'node tools/serve.ts', 'Serving a copy of agentos.db'],
      ['eye', 'Screenshotted 10 screens'],
    ], ai: 'Mapped the current app: 6 tabs, 12 modules, the Code board buried under Projects, Content under More. Plan: 5 tabs, with Tasks folded into Today behind a switch.', plan: true },
    { at: '17:02', me: 'Go. Start with Home, then Jobs.', dur: null, live: true, steps: [
      ['edit', 'Edited css/system.css', '+164 −12'],
      ['edit', 'Edited js/today.js', '+52 −41'],
      ['term', 'node tools/shoot.mjs …/mockup', '12 screenshots'],
      ['edit', 'Editing js/jobs.js'],
    ] },
  ],
  j9: [
    { at: '17:12', me: 'Tonight\'s shoot pack from the four ready scripts. Group by setup so I change the light once.', dur: null, live: true, steps: [
      ['read', 'Read the four scripts R1 to R4'],
      ['edit', 'Grouped them into 2 setups', 'Desk, window light · The store'],
      ['edit', 'Wrote the shot list per setup'],
      ['edit', 'Writing the teleprompter cards'],
    ] },
  ],
  j14: [
    { at: '16:58', me: 'Every new job should get its own copy by default. Folder stays one tap away.', dur: '6m 12s', steps: [
      ['read', 'Read server/jobs.ts and server/worktrees.ts'],
      ['edit', 'Edited server/jobs.ts', '+64 −18'],
      ['edit', 'Edited server/worktrees.ts', '+88 −12'],
    ], ai: 'New jobs now start in a separate copy on aos/<name>, with node_modules linked in so a copy opens in seconds.' },
    { at: '17:06', me: 'Add tests, and put Separate copy first in the Where picker.', dur: '5m 40s', steps: [
      ['edit', 'Added server/worktrees.test.ts', '+96'],
      ['term', 'bun test server', '58 pass · 0 fail'],
      ['edit', 'Edited app/work/new-session.js', '+41 −22'],
      ['edit', 'Edited app/work/job-row.js and app/css/work.css', '+42 −10'],
      ['edit', 'Renamed branch-chip.js to copy-chip.js', '+12 −3'],
    ], ai: 'Tests cover a copy per job, the shared node_modules and the merge back as one commit: 58 pass. Separate copy is now the first choice.' },
    { at: '17:16', me: 'Clean up the old Where code, write it up in docs, then hand it to the Builder.', dur: '3m 28s', steps: [
      ['edit', 'Deleted app/work/old-where.js', '−23'],
      ['edit', 'Edited docs/jobs.md', '+69'],
      ['hammer', 'Handed feat/j14 to the Agentic OS Builder', 'Build 39571'],
    ], ai: 'Old code removed and docs/jobs.md explains copies. The Builder is merging feat/j14 and running build 39571.' },
  ],
  j5: [
    { at: '15:22', me: 'Show the running job\'s current step in a Live Activity on the island.', dur: '9m 03s', steps: [
      ['read', 'Read ios/Island and server/jobs.ts'],
      ['edit', 'Edited ios/Island/LiveActivity.swift', '+64 −6'],
      ['edit', 'Added server/activity.ts', '+38'],
      ['edit', 'Edited ios/Island/Widget.swift and app/jobs.js', '+18 −8'],
      ['term', 'xcodebuild -scheme Island build', 'Build succeeded'],
    ], ai: 'The island shows the job, its step and n of N while it runs, and turns orange when the job needs you. Not shipped yet: it needs a TestFlight build.' },
  ],
};

// what a whole job did, in one paragraph, for the top of its review (a single turn shows that turn's own answer)
export const SUMMARY = {
  j14: 'New jobs start in a separate copy on aos/<name>, with node_modules shared in. Separate copy comes first in the Where picker, tests cover copies and the merge back, and docs/jobs.md explains it.',
  j5: 'The island shows the running job, its step and n of N, and turns orange when the job needs you. It builds; it needs a TestFlight build before it can ship.',
  j12: 'The keyboard now waits for the Photos grant before it attaches the newest screenshot, and falls back to the shared app-group container.',
  j15: 'Home and Jobs are rebuilt in the new style so far: the tab bar with its sliding lens, tasks behind a switch on Home, and the Jobs board.',
};

// ── what each job changed, file by file. turn: which turn's checkpoint made it. hunks: [header, context, lines]
//    lines: [kind (' ' | '+' | '-' | '~' for a fold of unchanged lines), line number, text] ──
export const CHANGES = {
  j14: [
    { k: 'M', path: 'server/jobs.ts', a: 64, d: 18, turn: 1, hunks: [
      ['−41,9 +41,14', 'startJob()', [
        [' ', 41, 'export async function startJob(req: StartJob) {'],
        [' ', 42, '  const project = await projects.get(req.project);'],
        ['-', 43, "  const where = req.where ?? 'folder';"],
        ['+', 43, '  // a job gets its own copy unless it asks for the folder'],
        ['+', 44, "  const where = req.where ?? settings.defaultWhere ?? 'copy';"],
        ['+', 45, "  const cwd = where === 'copy'"],
        ['+', 46, '    ? await worktrees.create(project, { branch: `aos/${slug(req.title)}` })'],
        ['+', 47, '    : project.folder;'],
        [' ', 48, '  const job = await db.jobs.insert({'],
        [' ', 49, '    title: req.title,'],
        ['-', 50, '    cwd: project.folder,'],
        ['+', 50, '    cwd,'],
        ['+', 51, '    where,'],
        [' ', 52, '    agent: req.agent,'],
      ]],
      ['~', 22],
      ['−118,6 +128,12', 'finishJob()', [
        [' ', 128, '  await sink.close();'],
        ['+', 129, "  if (job.where === 'copy') {"],
        ['+', 130, '    // the copy stays until you merge, open a PR or discard it'],
        ['+', 131, "    await db.jobs.update(job.id, { copy: 'kept' });"],
        ['+', 132, '  }'],
        [' ', 133, '  return job;'],
      ]],
    ] },
    { k: 'M', path: 'server/worktrees.ts', a: 88, d: 12, turn: 1, hunks: [
      ['−12,6 +12,9', 'create()', [
        [' ', 12, 'export async function create(project: Project, o: { branch: string }) {'],
        [' ', 13, "  const dir = path.join(project.folder, '..', '.aos-copies', o.branch.replace('/', '-'));"],
        ['-', 14, "  await git(project.folder, ['worktree', 'add', dir]);"],
        ['+', 14, "  await git(project.folder, ['worktree', 'add', '-b', o.branch, dir, 'HEAD']);"],
        ['+', 15, '  // share the ignored node_modules so a copy starts in seconds'],
        ['+', 16, "  await linkIgnored(project.folder, dir, ['node_modules', '.env']);"],
        [' ', 17, '  return dir;'],
        [' ', 18, '}'],
      ]],
    ] },
    { k: 'A', path: 'server/worktrees.test.ts', a: 96, d: 0, turn: 2, hunks: [
      ['−0,0 +1,10', '', [
        ['+', 1, "import { test, expect } from 'bun:test';"],
        ['+', 2, "import { create, mergeBack } from './worktrees';"],
        ['+', 3, ''],
        ['+', 4, "test('a job gets its own copy by default', async () => {"],
        ['+', 5, "  const job = await startTestJob({ title: 'Fix the picker' });"],
        ['+', 6, "  expect(job.where).toBe('copy');"],
        ['+', 7, "  expect(job.cwd).toContain('.aos-copies');"],
        ['+', 8, '});'],
        ['+', 9, ''],
        ['+', 10, "test('merging back lands as one commit', async () => {"],
      ]],
    ] },
    { k: 'M', path: 'app/work/new-session.js', a: 41, d: 22, turn: 2, hunks: [
      ['−8,7 +8,7', 'const WHERE', [
        [' ', 8, 'const WHERE = ['],
        ['-', 9, "  ['folder', 'Project folder', 'Works in your files directly'],"],
        ['-', 10, "  ['copy', 'Separate copy', 'Its own branch; merge back when you like'],"],
        ['+', 9, "  ['copy', 'Separate copy', 'Its own branch; merge back when you like'],"],
        ['+', 10, "  ['folder', 'Project folder', 'Works in your files directly'],"],
        [' ', 11, "  ['compare', 'Compare 2–3 agents', 'Same task, separate copies, keep one'],"],
        [' ', 12, '];'],
        ['-', 13, "let where = 'folder';"],
        ['+', 13, "let where = settings.defaultWhere ?? 'copy';"],
      ]],
    ] },
    { k: 'M', path: 'app/work/job-row.js', a: 18, d: 4, turn: 2, hunks: [
      ['−30,4 +30,8', 'jobRow()', [
        [' ', 30, '  const meta = [agentName(j), ago(j)];'],
        ['-', 31, "  if (j.worktree) meta.push('copy');"],
        ['+', 31, '  // a copy shows its branch, so you can tell two copies of one project apart'],
        ['+', 32, '  if (j.copy) meta.push(copyChip(j.copy.branch, j.copy.files));'],
        [' ', 33, "  return row(j.title, meta.join(' · '));"],
      ]],
    ] },
    { k: 'M', path: 'app/css/work.css', a: 24, d: 6, turn: 2 },
    { k: 'R', path: 'app/work/copy-chip.js', from: 'app/work/branch-chip.js', a: 12, d: 3, turn: 3 },
    { k: 'D', path: 'app/work/old-where.js', a: 0, d: 23, turn: 3 },
    { k: 'A', path: 'docs/jobs.md', a: 69, d: 0, turn: 3, hunks: [
      ['−0,0 +1,8', '', [
        ['+', 1, '# Jobs and copies'],
        ['+', 2, ''],
        ['+', 3, 'Every job starts in a separate copy of the project: a git worktree on'],
        ['+', 4, '`aos/<name>`, next to the repo, with node_modules shared in.'],
        ['+', 5, ''],
        ['+', 6, 'When it is done you can merge it back as one commit, open a PR,'],
        ['+', 7, 'or discard the copy. Pick "Project folder" to work in your files'],
        ['+', 8, 'directly instead.'],
      ]],
    ] },
  ],
  j5: [
    { k: 'M', path: 'ios/Island/LiveActivity.swift', a: 64, d: 6, turn: 1, hunks: [
      ['−21,3 +21,7', 'struct JobActivity', [
        [' ', 21, 'struct JobActivity: ActivityAttributes {'],
        ['-', 22, '  var title: String'],
        ['+', 22, '  var title: String'],
        ['+', 23, '  var step: String'],
        ['+', 24, '  var done: Int, total: Int'],
        ['+', 25, '  var needsYou: Bool'],
        [' ', 26, '}'],
      ]],
    ] },
    { k: 'A', path: 'server/activity.ts', a: 38, d: 0, turn: 1, hunks: [
      ['−0,0 +1,6', '', [
        ['+', 1, "import { push } from './apns';"],
        ['+', 2, ''],
        ['+', 3, '// every step a job takes moves the Live Activity on the phone'],
        ['+', 4, 'export const onStep = (job: Job) =>'],
        ['+', 5, '  push(job.device, { step: job.step, done: job.done, total: job.total,'],
        ['+', 6, "    needsYou: job.lane === 'needs' });"],
      ]],
    ] },
    { k: 'M', path: 'ios/Island/Widget.swift', a: 14, d: 8, turn: 1 },
    { k: 'M', path: 'app/jobs.js', a: 4, d: 0, turn: 1 },
  ],
  j12: [
    { k: 'M', path: 'keyboard/PhotoPicker.swift', a: 18, d: 6, turn: 1, hunks: [
      ['−14,8 +14,16', 'latestScreenshot()', [
        [' ', 14, 'func latestScreenshot() async -> UIImage? {'],
        ['-', 15, '  let assets = PHAsset.fetchAssets(with: .image, options: newest)'],
        ['-', 16, '  return await image(for: assets.firstObject)'],
        ['+', 15, '  // ask first: before the grant, Photos answers with nothing'],
        ['+', 16, '  let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)'],
        ['+', 17, '  guard status == .authorized || status == .limited else {'],
        ['+', 18, '    return SharedContainer.lastScreenshot()'],
        ['+', 19, '  }'],
        ['+', 20, '  let assets = PHAsset.fetchAssets(with: .image, options: newest)'],
        ['+', 21, '  return await image(for: assets.firstObject) ?? SharedContainer.lastScreenshot()'],
        [' ', 22, '}'],
      ]],
    ] },
    { k: 'M', path: 'keyboard/KeyboardViewController.swift', a: 4, d: 0, turn: 1 },
    { k: 'M', path: 'server/keyboard.ts', a: 9, d: 2, turn: 1 },
  ],
  j15: [
    { k: 'M', path: 'css/system.css', a: 164, d: 12, turn: 2, hunks: [
      ['−12,4 +12,8', '.tabbar', [
        [' ', 12, '.tabbar {'],
        ['-', 13, '  height: 62px; background: var(--surface);'],
        ['+', 13, '  flex: 1; height: var(--dock-h); border-radius: 31px;'],
        ['+', 14, '  display: grid; grid-template-columns: repeat(5, 1fr);'],
        [' ', 15, '}'],
        ['+', 16, '.tab-lens {'],
        ['+', 17, '  transition: transform .5s var(--spring);'],
        ['+', 18, '}'],
      ]],
    ] },
    { k: 'M', path: 'js/today.js', a: 52, d: 41, turn: 2 },
    { k: 'A', path: 'js/jobs.js', a: 118, d: 0, turn: 2 },
  ],
};

// ── each project's repository: where it stands, its copies (one per job that works in its own copy), the PR, the
//    last ship. activity: jobs and commits per day for the last 14 days, oldest first, today last ──
export const REPOS = {
  'agentic-os': {
    branch: 'main', ahead: 2, behind: 0, dirty: [],
    commit: ['a41c9e2', 'Jobs board, Builders and cache tracking', '5h'],
    commits: [['a41c9e2', 'Jobs board, Builders and cache tracking', 'j11', '5h'], ['9be03f1', 'Keyboard setup in Settings', 'j10', '7h'], ['77d2a10', 'Voice meter recovers; effort picker', 'j7', '9h'], ['3c5e8b2', 'Restarts no longer cut off jobs', 'j6', '11h']],
    pr: { n: 41, title: 'Worktree jobs by default', job: 'j14', state: 'open', checks: 'running' },
    ship: { state: 'building', what: 'Worktree jobs by default', job: 'j14', build: '39571', eta: '4 min' },
    lastShip: ['Jobs board, Builders and cache tracking', 'live', '5h'],
    activity: [3, 5, 2, 6, 4, 8, 7, 5, 9, 6, 8, 10, 7, 6],
  },
  atlas: {
    branch: 'main', ahead: 0, behind: 0, dirty: ['pricing/atlas-tiers.md', 'pricing/notes.md'],
    commit: ['b7d04e9', 'Stock report export', '1d'],
    commits: [['b7d04e9', 'Stock report export', 'j3', '1d'], ['4a1c2f0', 'Counter bill: GST split per line', null, '2d']],
    waves: { n: 11, label: 'Wave 1: 11 copies wait to merge', task: 't2' },
    lastShip: ['Stock report export', 'live', '1d'],
    client: 'dad-shop',
    activity: [2, 4, 6, 3, 0, 5, 8, 9, 4, 6, 3, 2, 1, 2],
  },
  wyn: {
    branch: 'main', ahead: 0, behind: 0, dirty: [],
    commit: ['5c0e7d1', 'Wyn brain over MCP', '3d'],
    commits: [['5c0e7d1', 'Wyn brain over MCP', 'j2', '3d']],
    lastShip: null,
    activity: [4, 2, 3, 1, 0, 2, 3, 0, 1, 0, 0, 1, 0, 0],
  },
  'content-os': {
    branch: 'main', ahead: 1, behind: 0, dirty: [],
    commit: ['e9a1b40', 'Shoot pack v1: setups and cards', '2d'],
    commits: [['e9a1b40', 'Shoot pack v1: setups and cards', null, '2d']],
    lastShip: ['Shoot pack v1', 'live', '2d'],
    activity: [0, 1, 2, 0, 3, 1, 0, 2, 4, 1, 2, 0, 3, 2],
  },
  pulsechat: {
    branch: 'main', ahead: 0, behind: 0, dirty: [],
    commit: ['31f0aa2', 'Flow editor: drag to reorder steps', '12d'],
    commits: [['31f0aa2', 'Flow editor: drag to reorder steps', null, '12d']],
    lastShip: ['Flow editor', 'live', '12d'],
    quiet: 12,
    activity: [1, 2, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
};

// ── terminals: the agent's own commands, a plain shell, and a running script ──
export const TERMS = [
  { id: 'tm1', kind: 'agent', title: 'bun test server', job: 'j12', project: 'agentic-os', where: 'feat/j12', state: 'waiting', note: 'Waits for your OK' },
  { id: 'tm2', kind: 'script', title: 'bun dev', project: 'agentic-os', where: 'agentic-os', state: 'running', note: 'localhost:5173 · up 2h 14m' },
  { id: 'tm3', kind: 'shell', title: 'PowerShell', project: 'agentic-os', where: 'agentic-os', state: 'idle', note: 'Idle 12m' },
];
// one-tap project scripts, the way T3 Code runs a project's actions
export const SCRIPTS = {
  'agentic-os': [['Dev', 'bun dev'], ['Test', 'bun test server'], ['Build', 'node scripts/build-www.mjs'], ['Restart', 'server\\restart.ps1']],
  atlas: [['Dev', 'bun run dev'], ['Test', 'bun test'], ['Build', 'bun run build']],
  wyn: [['Dev', 'bun dev'], ['Test', 'bun test']],
  'content-os': [['Dev', 'bun dev'], ['Pack', 'bun scripts/pack.ts']],
  pulsechat: [['Dev', 'pnpm dev'], ['Test', 'pnpm test']],
};

// ── the night shift: tasks that are ready for an agent, run at 23:00 while he sleeps, reported at 07:00.
//    Runs on his Claude and Codex plans, so it adds no API spend ──
export const NIGHT = {
  at: '23:00', report: '07:00',
  picks: [
    { id: 'n1', task: 't17', agent: 'codex', model: 'gpt-6.1-sol', mode: 'build', est: 20, on: true, why: 'Small and clear: two rows move up' },
    { id: 'n2', task: 't9', agent: 'claude', model: 'Opus 5.5', mode: 'plan', est: 35, on: true, why: 'Pulse Chat has been quiet for 12 days. A plan only; you approve it at breakfast' },
    { id: 'n3', task: 't11', agent: 'claude', model: 'Opus 5.5', mode: 'plan', est: 30, on: false, why: 'Plan the Atlas ERP phone apps after wave 1 is merged' },
  ],
  last: { ran: 2, shipped: 2, jobs: ['j6', 'j7'] },
};

// ── what the agent noticed in Work. Each line names the job or project it is about ──
export const NOTES = {
  j12: 'You allowed bun test for j11 and j14 this week. Always allow it in Agentic OS?',
  j13: 'Both client calls asked for done-for-you, and that is what the top tier sells.',
  pulsechat: 'Quiet for 12 days, and t9 is still open. Plan the native apps on tonight\'s shift?',
  j14: 'Build 39571 is on step 3 of 5. I\'ll tell you when it is live.',
};
export const SHIP_STREAK = 5;   // days in a row something went live

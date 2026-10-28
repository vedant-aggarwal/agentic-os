// Where a job works: its own copy (git worktree on an aos/* branch), the project folder, or a scratch folder in
// agentic-jobs. The PC reports it on every job (job.workspace: kind, branch, stage, files, commits, why no copy); this
// draws the chip on job rows, the card with the copy's progress on the job page, and the "Where it works" picker for
// starting a job. Older servers don't send job.workspace; then the open copies list (code.js) is the fallback.
import { W, copyFor, folderLabel } from './state.js';

const { AOS } = window;
const { esc } = AOS;
export const BRANCH_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="5.5" r="1.6"/><path d="M4.5 5.1v5.8M11.5 7.1c0 2.6-3 2.6-6.4 4"/></svg>';
const FOLDER_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 4.9a1.3 1.3 0 0 1 1.3-1.3h2.7l1.3 1.5h5a1.3 1.3 0 0 1 1.3 1.3v5.3a1.3 1.3 0 0 1-1.3 1.3H3.5a1.3 1.3 0 0 1-1.3-1.3z"/></svg>';
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const short = (b) => String(b ?? '').replace(/^aos\//, '');

/** job.workspace, or what the open copies list says for older servers. */
export function wsOf(j) {
  if (!j || j.role === 'builder') return null;
  if (j.workspace) return j.workspace;
  const c = copyFor(j.cwd);
  if (c) return { kind: 'worktree', wanted: true, worktreeId: c.id, branch: c.branch, base: c.base, stage: c.commits ? 'committed' : c.files?.length ? 'changes' : 'copy', files: c.files?.length ?? 0, add: 0, del: 0, commits: c.commits ?? 0, behind: c.behind ?? 0, inner: [] };
  return null;
}

// ---------- The chip on job rows ----------
const STAGE_ROW = { copy: 'Worktree', changes: 'Worktree', committed: 'Worktree', merged: 'Merged', removed: 'Copy deleted' };
export function wsChipHTML(j) {
  const w = wsOf(j);
  if (!w) return '';
  if (w.kind === 'worktree') {
    const extra = w.stage === 'committed' ? ` · ${plural(w.commits, 'commit')}` : w.stage === 'changes' ? ` · ${plural(w.files, 'file')}` : '';
    return `<span class="ws-chip wt st-${esc(w.stage ?? 'copy')}" title="${esc(`Own copy on ${w.branch ?? 'its branch'}${w.base ? ` from ${w.base}` : ''}`)}">${BRANCH_SVG}${esc(STAGE_ROW[w.stage] ?? 'Worktree')}${esc(extra)}</span>`;
  }
  const warn = w.wanted && w.why ? ' warn' : '';
  if (w.kind === 'scratch' && w.inner?.length) {
    const names = w.inner.map((r) => r.name).join(' · ');
    return `<span class="ws-chip in${warn}" title="${esc(w.inner.map((r) => `${r.name}: ${r.branch ?? 'detached'}`).join(', '))}">${BRANCH_SVG}${esc(names)}</span>`;
  }
  return `<span class="ws-chip${warn}" title="${esc(w.why ?? '')}">${FOLDER_SVG}${w.kind === 'scratch' ? 'Scratch' : 'Folder'}${warn ? ' · no copy' : ''}</span>`;
}

// ---------- The card on the job page ----------
const STEPS = [['copy', 'Copy made'], ['changes', 'Changes'], ['committed', 'Committed'], ['merged', 'Merged']];
/** counts: false when the page already shows the +/− (the job hero's Changes button), so the card says files only. */
export function wsCardHTML(j, { counts = true } = {}) {
  const w = wsOf(j);
  if (!w) return '';
  const why = w.wanted && w.why ? `<p class="ws-why">Asked for its own copy: ${esc(w.why)}</p>` : '';
  if (w.kind === 'worktree') {
    const copy = W.worktrees?.find((x) => x.id === w.worktreeId && x.state === 'open');
    const at = w.stage === 'removed' ? -1 : Math.max(0, STEPS.findIndex(([k]) => k === (w.stage ?? 'copy')));
    const detail = { changes: w.files ? `${plural(w.files, 'file')}${counts && (w.add || w.del) ? ` +${w.add} −${w.del}` : ''}` : '', committed: w.commits ? plural(w.commits, 'commit') : '', merged: w.commit ? w.commit : '' };
    const steps = STEPS.map(([k, label], i) => {
      const st = w.stage === 'merged' || i < at ? 'done' : i === at ? 'now' : '';
      return `<li class="${st}"><i></i><span>${esc(label)}${detail[k] && i <= at ? `<small>${esc(detail[k])}</small>` : ''}</span></li>`;
    }).join('');
    return `<div class="ws-card wt"><div class="ws-head">${BRANCH_SVG}<b>Own copy</b><code>${esc(short(w.branch))}</code>${w.base ? `<span>from <code>${esc(w.base)}</code></span>` : ''}${copy ? `<button class="text-btn" data-open-copy="${esc(copy.id)}">Open copy</button>` : ''}</div>
${w.stage === 'removed' ? '<p class="ws-why">The copy was deleted without merging.</p>' : `<ol class="ws-steps">${steps}</ol>`}
${w.behind && w.stage !== 'merged' && w.stage !== 'removed' ? `<p class="ws-note">${esc(w.base ?? 'Its base')} has ${plural(w.behind, 'newer commit')} since the copy was made.</p>` : ''}</div>`;
  }
  if (w.kind === 'scratch') {
    const inner = w.inner?.length ? `<ul class="ws-inner">${w.inner.map((r) => `<li>${BRANCH_SVG}<b>${esc(r.name)}</b><code>${esc(r.branch ?? 'detached')}</code>${r.worktree ? '<small>worktree</small>' : ''}</li>`).join('')}</ul>` : '';
    return `<div class="ws-card"><div class="ws-head">${FOLDER_SVG}<b>Scratch folder</b><code>${esc(folderLabel(j.cwd))}</code></div>${why}${inner ? `<p class="ws-note">Checkouts it set up itself:</p>${inner}` : ''}</div>`;
  }
  return `<div class="ws-card"><div class="ws-head">${FOLDER_SVG}<b>Project folder</b><code title="${esc(j.cwd ?? '')}">${esc(folderLabel(j.cwd).split('\\').at(-1))}</code>${w.branch ? `<span>on <code>${esc(w.branch)}</code></span>` : ''}</div>${why}</div>`;
}

// ---------- "Where it works", when starting a job ----------
const checks = new Map();   // folder → { repo, hasCommits } | 'busy'
/** Is the project's folder a git repo with commits? Asked once per folder; then() re-renders. */
function repoState(folder, then) {
  const c = checks.get(folder);
  if (c && c !== 'busy') return c;
  if (!c) {
    checks.set(folder, 'busy');
    AOS.api(`/worktrees/check?folder=${encodeURIComponent(folder)}`)
      .then((r) => checks.set(folder, { repo: !!r.repo, hasCommits: r.hasCommits !== false, branch: r.branch ?? null }))
      .catch(() => checks.set(folder, { repo: null }))
      .finally(() => then?.());
  }
  return null;
}
/** The folder's repo check for other sheets: { repo, hasCommits, branch } once known, null while asking (then() redraws). */
export const repoOf = (folder, then) => (folder ? repoState(folder, then) : null);
/** The field: two choices when the project has a git folder; otherwise why there's no copy and how to get one. */
export function whereFieldHTML(project, on, then, attr = 'data-ws-pick') {
  const label = '<span class="f-label">Where it works</span>';
  if (!project?.folder) {
    const why = project ? `${esc(project.name)} has no folder set, so it runs in a new scratch folder and can’t get its own copy.` : 'No project: it runs in a new scratch folder in agentic-jobs.';
    return `<div class="field ws-field">${label}<div class="chips"><span class="chip-btn on static">${FOLDER_SVG}Scratch folder</span><button type="button" class="chip-btn" disabled>${BRANCH_SVG}Own copy</button></div><p class="cn-note">${why}${project ? ` <button type="button" class="text-btn" data-ws-setfolder="${esc(project.slug)}">Set its folder</button>` : ''}</p></div>`;
  }
  const r = repoState(project.folder, then);
  const can = r ? r.repo && r.hasCommits : true;   // unknown yet: offer it; the PC falls back and says why
  const pick = can && on;
  const note = !r ? 'Checking the folder…'
    : !r.repo ? 'The folder isn’t a git repo, so it works in the folder itself.'
    : !r.hasCommits ? 'The repo has no commits yet, so it works in the folder itself.'
    : pick ? `Own branch (aos/…) off ${esc(r.branch ?? 'the current branch')}, so other jobs can’t clash with it. Its Builder merges it.`
    : `Works straight in ${esc(project.folder)}${r.branch ? ` on ${esc(r.branch)}` : ''}. Other jobs there see its changes at once.`;
  // project.kind 'client': the folder is a client's (the + sheet with a client pinned), not a project's
  return `<div class="field ws-field">${label}<div class="chips" role="radiogroup" aria-label="Where it works"><button type="button" class="chip-btn${pick ? ' on' : ''}" role="radio" aria-checked="${pick}" ${attr}="copy"${can ? '' : ' disabled'}>${BRANCH_SVG}Own copy</button><button type="button" class="chip-btn${pick ? '' : ' on'}" role="radio" aria-checked="${!pick}" ${attr}="folder">${FOLDER_SVG}${project.kind === 'client' ? 'Client folder' : 'Project folder'}</button></div><p class="cn-note">${note}</p></div>`;
}

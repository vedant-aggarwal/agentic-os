// Where a job works, for the app: its own copy (git worktree on an aos/* branch), the project folder itself, or a
// scratch folder in agentic-jobs. A job records what was asked for and what it got when it starts (meta.workspace),
// including why it didn't get a copy. info() adds the live git state, cached, so every job row can show the branch and
// how far the copy has got: made, changes, commits, merged, deleted. Jobs without a record (older ones, forks) are
// worked out from the folder, and repos an agent set up itself inside a scratch folder are listed by name and branch.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { inside, type Worktrees } from "./worktrees";

export type WorkspaceKind = "worktree" | "folder" | "scratch";
/** What the job asked for (wanted) and what it got. why: the reason a wanted copy wasn't made. */
export type WorkspaceRec = { kind: WorkspaceKind; wanted: boolean; why?: string | null; worktreeId?: string | null };
/** copy: made, nothing changed yet. changes: files changed, not committed. committed: commits on the branch.
 *  merged: the branch is in its base (or merged from the app). removed: the copy was deleted unmerged. */
export type CopyStage = "copy" | "changes" | "committed" | "merged" | "removed";
export type Workspace = WorkspaceRec & {
  branch: string | null; base: string | null; repo: string | null; stage: CopyStage | null;
  files: number; add: number; del: number; commits: number; behind: number; commit: string | null;
  /** Scratch folders: git checkouts an agent made inside it (e.g. desk, phone), with their branch. */
  inner: { name: string; branch: string | null; worktree: boolean }[];
};

const TTL = 15_000;
export const scratchRoot = () => join(process.env.USERPROFILE ?? homedir(), "agentic-jobs");

/** The branch checked out in a folder, read from .git without running git. null when detached or not a checkout. */
export function headBranch(dir: string): string | null {
  try {
    const dot = join(dir, ".git");
    let gitDir = dot;
    if (statSync(dot).isFile()) {
      const m = readFileSync(dot, "utf8").match(/gitdir:\s*(.+)/);
      if (!m) return null;
      gitDir = isAbsolute(m[1].trim()) ? m[1].trim() : resolve(dir, m[1].trim());
    }
    const head = readFileSync(join(gitDir, "HEAD"), "utf8").trim();
    return head.startsWith("ref: refs/heads/") ? head.slice(16) : null;
  } catch { return null; }
}
/** Git checkouts directly inside a folder (one level down). */
function innerRepos(dir: string): Workspace["inner"] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith(".") && existsSync(join(dir, d.name, ".git")))
      .slice(0, 8)
      .map((d) => ({ name: d.name, branch: headBranch(join(dir, d.name)), worktree: statSync(join(dir, d.name, ".git")).isFile() }));
  } catch { return []; }
}

export function openJobWorkspace(wt: Worktrees, opts: { ttlMs?: number } = {}) {
  const ttl = opts.ttlMs ?? TTL;
  const cache = new Map<string, { at: number; val: Workspace; busy: boolean }>();

  /** At job start: make the copy when one is wanted and possible, else say why not. folder null = scratch. */
  async function prepare(o: { folder: string | null; wanted: boolean; title: string; project: string | null }): Promise<{ cwd: string | null; rec: WorkspaceRec }> {
    const { folder, wanted } = o;
    if (!folder) return { cwd: null, rec: { kind: "scratch", wanted, why: wanted ? "The project has no folder set, so there was nothing to copy." : null } };
    if (!wanted) return { cwd: folder, rec: { kind: wt.forFolder(folder) ? "worktree" : "folder", wanted: false, worktreeId: wt.forFolder(folder)?.id ?? null } };
    // Already inside a copy (a job started in one): work there.
    const open = wt.forFolder(folder);
    if (open) return { cwd: folder, rec: { kind: "worktree", wanted, worktreeId: open.id } };
    const c = await wt.check(folder).catch(() => null);
    if (!c?.repo) return { cwd: folder, rec: { kind: "folder", wanted, why: "The folder isn't a git repo, so it works in the folder itself." } };
    if (c.hasCommits === false) return { cwd: folder, rec: { kind: "folder", wanted, why: "The repo has no commits yet, so it works in the folder itself." } };
    const w = await wt.create({ folder, title: o.title, project: o.project });
    return { cwd: w.cwd, rec: { kind: "worktree", wanted, worktreeId: w.id } };
  }

  /** What the record (or the folder) says, before git is asked anything. */
  function base(cwd: string | null, rec: WorkspaceRec | null): Workspace {
    const blank = { branch: null, base: null, repo: null, stage: null, files: 0, add: 0, del: 0, commits: 0, behind: 0, commit: null, inner: [] };
    const w = (rec?.worktreeId ? wt.record(rec.worktreeId) : null) ?? (cwd ? wt.recordFor(cwd) : null);
    if (w) {
      const stage: CopyStage | null = w.state === "merged" ? "merged" : w.state === "discarded" ? "removed" : null;
      return { ...blank, kind: "worktree", wanted: rec?.wanted ?? true, why: null, worktreeId: w.id, branch: w.branch, base: w.base, repo: w.repo, stage, commit: w.commit ?? null };
    }
    if (!cwd) return { ...blank, kind: rec?.kind ?? "scratch", wanted: !!rec?.wanted, why: rec?.why ?? null };
    const scratch = inside(cwd, scratchRoot());
    if (scratch) return { ...blank, kind: "scratch", wanted: !!rec?.wanted, why: rec?.why ?? null, inner: innerRepos(cwd) };
    return { ...blank, kind: "folder", wanted: !!rec?.wanted, why: rec?.why ?? null, branch: headBranch(cwd) };
  }

  /** Live git state for an open copy. */
  async function refresh(b: Workspace): Promise<Workspace> {
    if (b.kind !== "worktree" || !b.worktreeId || b.stage) return b;
    const s = await wt.progress(b.worktreeId).catch(() => null);
    if (!s) return b;
    if (s.missing) return { ...b, stage: s.merged ? "merged" : "removed" };
    const add = s.files.reduce((a, f) => a + f.add, 0), del = s.files.reduce((a, f) => a + f.del, 0);
    const stage: CopyStage = s.merged ? "merged" : s.commits > 0 ? "committed" : s.files.length ? "changes" : "copy";
    return { ...b, stage, files: s.files.length, add, del, commits: s.commits, behind: s.behind };
  }

  /** Sync, for job rows: the last known state; a stale one is refreshed in the background and changed() is called. */
  function info(cwd: string | null, rec: WorkspaceRec | null, changed?: () => void): Workspace {
    const key = `${cwd ?? ""}|${rec?.worktreeId ?? ""}|${rec?.kind ?? ""}`;
    const hit = cache.get(key);
    if (hit && (hit.busy || Date.now() - hit.at < ttl)) return hit.val;
    const b = base(cwd, rec);
    const val = hit ? { ...hit.val, ...pick(b) } : b;
    const entry = { at: Date.now(), val, busy: true };
    cache.set(key, entry);
    refresh(b).then((v) => {
      const before = JSON.stringify(entry.val);
      entry.val = v;
      if (JSON.stringify(v) !== before) changed?.();
    }).catch(() => {}).finally(() => { entry.busy = false; entry.at = Date.now(); });
    return val;
  }
  // Fields that never need git, so a stale cached copy can still take the latest of them at once.
  const pick = (b: Workspace) => ({ kind: b.kind, wanted: b.wanted, why: b.why, inner: b.inner, ...(b.kind === "folder" ? { branch: b.branch } : {}) });

  /** The current state, waiting for git (no cache). */
  const now = (cwd: string | null, rec: WorkspaceRec | null) => refresh(base(cwd, rec));

  return { prepare, info, now };
}
export type JobWorkspace = ReturnType<typeof openJobWorkspace>;

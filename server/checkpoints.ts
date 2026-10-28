// File checkpoints for jobs: before and after every turn the job's folder is snapshotted into a private git dir
// (<DATA_DIR>/jobs/ckpt/j<id>.git, work tree = the job's cwd). The folder's own .git, branches and index are never
// touched; its .gitignore still applies. A turn's diff is before..after; revert puts the files back to "before".
// Works the same for every engine and driver, and for folders that are not git repos.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export type FileChange = { path: string; status: "added" | "modified" | "deleted" | "renamed"; add: number; del: number };
const EXCLUDE = ["node_modules/", ".venv/", "venv/", "__pycache__/", ".next/", ".turbo/", ".cache/", "dist/", "build/", "out/",
  "target/", ".gradle/", "Pods/", "DerivedData/", "*.log", ".DS_Store", "Thumbs.db"].join("\n") + "\n";
const MAX_MS = 30_000;

export function openCheckpoints(dataDir: string) {
  const root = join(dataDir, "jobs", "ckpt");
  mkdirSync(root, { recursive: true });

  /** Folders too broad to snapshot: drive roots and the home folder itself. */
  const tooBroad = (cwd: string) => {
    const p = resolve(cwd).replace(/[\\/]+$/, "").toLowerCase();
    return /^[a-z]:$/.test(p) || p === resolve(homedir()).toLowerCase() || p === "";
  };

  async function git(id: number, cwd: string, args: string[], input?: string) {
    const gitDir = join(root, `j${id}.git`);
    const p = Bun.spawn(["git", `--git-dir=${gitDir}`, `--work-tree=${cwd}`, "-c", "core.autocrlf=false", "-c", "core.safecrlf=false",
      "-c", "core.longpaths=true", "-c", "core.quotepath=false", ...args], {
      cwd, stdin: input != null ? "pipe" : "ignore", stdout: "pipe", stderr: "pipe",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Agentic OS", GIT_AUTHOR_EMAIL: "aos@local",
        GIT_COMMITTER_NAME: "Agentic OS", GIT_COMMITTER_EMAIL: "aos@local", GIT_INDEX_FILE: join(gitDir, "index") },
    });
    if (input != null) { (p.stdin as any).write(input); (p.stdin as any).end(); }
    const timer = setTimeout(() => p.kill(), MAX_MS);
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    clearTimeout(timer);
    if (code !== 0) throw new Error((err || out).trim().split("\n").slice(-2).join(" ").slice(0, 300) || `git exited ${code}`);
    return out;
  }
  async function ensure(id: number, cwd: string) {
    const gitDir = join(root, `j${id}.git`);
    if (existsSync(join(gitDir, "HEAD"))) return;
    const p = Bun.spawn(["git", "init", "-q", "--bare", gitDir], { stdout: "ignore", stderr: "pipe" });
    if ((await p.exited) !== 0) throw new Error("git init failed");
    writeFileSync(join(gitDir, "config"), "[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tfilemode = false\n[gc]\n\tauto = 0\n");
    mkdirSync(join(gitDir, "info"), { recursive: true });
    writeFileSync(join(gitDir, "info", "exclude"), EXCLUDE);
  }

  /** Snapshot the folder; returns the tree id, or null when the folder can't be snapshotted (with the reason). */
  async function snapshot(id: number, cwd: string): Promise<{ tree: string | null; error?: string }> {
    if (!cwd || !existsSync(cwd)) return { tree: null, error: "The folder is gone." };
    if (tooBroad(cwd)) return { tree: null, error: "No checkpoints in a drive root or the home folder." };
    try {
      await ensure(id, cwd);
      // --ignore-errors still exits non-zero when a file can't be read; the rest is indexed and write-tree fails on real errors.
      await git(id, cwd, ["add", "-A", "--ignore-errors", "."]).catch(() => {});
      return { tree: (await git(id, cwd, ["write-tree"])).trim() };
    } catch (e) {
      return { tree: null, error: String((e as Error).message ?? e) };
    }
  }

  async function changes(id: number, cwd: string, from: string, to: string): Promise<FileChange[]> {
    const num = await git(id, cwd, ["diff-tree", "-r", "-M", "--numstat", "--no-commit-id", from, to]);
    const st = await git(id, cwd, ["diff-tree", "-r", "-M", "--name-status", "--no-commit-id", from, to]);
    const kinds = new Map<string, FileChange["status"]>();
    for (const l of st.split("\n").filter(Boolean)) {
      const [s, ...ps] = l.split("\t");
      kinds.set(ps.at(-1)!, s[0] === "A" ? "added" : s[0] === "D" ? "deleted" : s[0] === "R" ? "renamed" : "modified");
    }
    return num.split("\n").filter(Boolean).map((l) => {
      const [a, d, ...ps] = l.split("\t");
      const path = ps.join("\t").replace(/^.*\{(.*) => (.*)\}.*$/, (_m, _x, y) => y).replace(/^(.*) => (.*)$/, "$2");
      return { path, status: kinds.get(path) ?? "modified", add: a === "-" ? 0 : Number(a), del: d === "-" ? 0 : Number(d) };
    });
  }
  /** Unified diff between two snapshots, optionally for one file. Binary files show as a one-line note. */
  async function patch(id: number, cwd: string, from: string, to: string, file?: string) {
    return git(id, cwd, ["diff-tree", "-p", "-M", "--no-color", "--no-commit-id", "-U3", from, to, ...(file ? ["--", file] : [])]);
  }
  /** Put the files back the way they were in `tree`: changed files restored, files added since then deleted. */
  async function restore(id: number, cwd: string, tree: string) {
    const now = await snapshot(id, cwd);
    if (!now.tree) throw new Error(now.error ?? "Couldn't read the folder.");
    // Only the files that differ are written, so untouched files keep their timestamps.
    const list = (filter: string) => git(id, cwd, ["diff-tree", "-r", "--no-commit-id", "--no-renames", "--name-only", `--diff-filter=${filter}`, tree, now.tree])
      .then((s) => s.split("\n").filter(Boolean));
    const added = await list("A");
    const back = await list("MDT");
    await git(id, cwd, ["read-tree", tree]);
    for (let i = 0; i < back.length; i += 200) await git(id, cwd, ["checkout-index", "-f", "--", ...back.slice(i, i + 200)]);
    for (const f of added) { try { rmSync(join(cwd, f), { force: true }); } catch {} }
    return { restored: back.length, removed: added.length };
  }
  /** Delete a job's snapshots (an archived job's cleanup). Its diffs and reverts stop working; the chat stays. */
  function drop(id: number) {
    const gitDir = join(root, `j${id}.git`);
    if (!existsSync(gitDir)) return false;
    rmSync(gitDir, { recursive: true, force: true });
    return !existsSync(gitDir);
  }
  /** Whether this job's store still holds `tree` (a copied data folder, or one whose snapshots were deleted, has the
   *  turns in its meta but not the objects). */
  async function has(id: number, cwd: string, tree: string) {
    if (!tree || !existsSync(join(root, `j${id}.git`, "HEAD"))) return false;
    try { await git(id, cwd && existsSync(cwd) ? cwd : root, ["cat-file", "-e", `${tree}^{tree}`]); return true; } catch { return false; }
  }
  return { snapshot, changes, patch, restore, drop, has };
}
export type Checkpoints = ReturnType<typeof openCheckpoints>;

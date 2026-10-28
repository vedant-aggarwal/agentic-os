// Separate copies of a project for agents: a git worktree on its own branch (aos/<slug>), next to the repo in
// <parent>/.aos-worktrees/<repo>/<slug>. Several copies made together share a group, so two or three agents can try
// the same task and the best one is merged back. Records live in <DATA_DIR>/worktrees.json.
//   merge   = commit what's left in the copy, squash it onto the base branch as one commit, delete the copy
//   discard = delete the copy and its branch
// A git-ignored node_modules at the repo root (or the project subfolder) is shared into the copy with a directory
// junction, so agents don't reinstall; the junction is unlinked before a copy is deleted.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { ApiError } from "./store";

export type WtFile = { path: string; status: "added" | "modified" | "deleted" | "renamed"; add: number; del: number };
export type Worktree = {
  id: string; repo: string; path: string; cwd: string; branch: string; base: string | null; baseSha: string;
  title: string; project: string | null; group: string | null; label: string | null; links: string[];
  createdAt: string; state: "open" | "merged" | "discarded"; closedAt?: string | null; commit?: string | null;
};
const iso = () => new Date().toISOString();
/** Is p inside dir (or dir itself)? Case-insensitive, Windows paths. */
export const inside = (p: string, dir: string) => {
  const a = resolve(p).toLowerCase(), b = resolve(dir).toLowerCase();
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
};

async function run(cmd: string[], cwd: string, env?: Record<string, string>, timeoutMs = 120_000) {
  const p = Bun.spawn(cmd, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } });
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  clearTimeout(timer);
  return { out, err, code };
}
async function git(cwd: string, args: string[], env?: Record<string, string>) {
  const r = await run(["git", "-c", "core.quotepath=false", ...args], cwd, env);
  if (r.code !== 0) throw new Error((r.err || r.out).trim().split("\n").filter(Boolean).slice(-3).join(" ").slice(0, 400) || `git ${args[0]} failed`);
  return r.out;
}
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32).replace(/-+$/, "") || "work";

export function openWorktrees(o: { dataDir: string; beforeRemove?: (path: string) => Promise<void> }) {
  const file = join(o.dataDir, "worktrees.json");
  let all: Worktree[] = [];
  try { all = JSON.parse(readFileSync(file, "utf8")); } catch {}
  const save = () => { writeFileSync(`${file}.tmp`, JSON.stringify(all, null, 1)); renameSync(`${file}.tmp`, file); };
  const get = (id: string) => {
    const w = all.find((x) => x.id === id);
    if (!w) throw new ApiError(404, "No such copy.");
    return w;
  };
  const open = (id: string) => {
    const w = get(id);
    if (w.state !== "open") throw new ApiError(409, `That copy was already ${w.state}.`);
    return w;
  };

  /** Is this folder in a git repo? Where, on which branch, and how many uncommitted changes (they don't go into a copy). */
  async function check(folder: string) {
    if (!folder || !existsSync(folder)) throw new ApiError(400, "That folder doesn't exist.");
    const top = await run(["git", "rev-parse", "--show-toplevel"], folder);
    if (top.code !== 0) return { repo: null, branch: null, dirty: 0, sub: "" };
    const repo = resolve(top.out.trim());
    const branch = (await run(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], repo)).out.trim() || null;
    const hasHead = (await run(["git", "rev-parse", "--verify", "--quiet", "HEAD"], repo)).code === 0;
    const dirty = (await run(["git", "status", "--porcelain"], repo)).out.split("\n").filter(Boolean).length;
    return { repo, branch, dirty, sub: relative(repo, resolve(folder)), hasCommits: hasHead };
  }

  async function create(b: { folder: string; title?: string; project?: string | null; group?: string | null; label?: string | null }) {
    const c = await check(String(b.folder ?? ""));
    if (!c.repo) throw new ApiError(400, "That folder isn't a git repo, so it can't get a separate copy.");
    if (!c.hasCommits) throw new ApiError(400, "That repo has no commits yet. Make a first commit, then try again.");
    const title = String(b.title ?? "").trim().slice(0, 120) || "Agent work";
    const slug = `${slugify(title)}-${randomBytes(2).toString("hex")}`;
    const path = join(dirname(c.repo), ".aos-worktrees", basename(c.repo), slug);
    const branch = `aos/${slug}`;
    const baseSha = (await git(c.repo, ["rev-parse", "HEAD"])).trim();
    mkdirSync(dirname(path), { recursive: true });
    await git(c.repo, ["worktree", "add", "-b", branch, path, baseSha]);
    const links: string[] = [];
    for (const rel of new Set(["node_modules", c.sub ? join(c.sub, "node_modules") : "node_modules"])) {
      const src = join(c.repo, rel), dst = join(path, rel);
      if (!existsSync(src) || existsSync(dst) || !statSync(src).isDirectory()) continue;
      // Only when git ignores it: a shared node_modules must never end up in a commit or a checkpoint.
      if ((await run(["git", "check-ignore", "-q", rel.replace(/\\/g, "/")], c.repo)).code !== 0) continue;
      mkdirSync(dirname(dst), { recursive: true });
      const r = await run(["cmd", "/c", "mklink", "/J", dst, src], c.repo);
      if (r.code === 0) links.push(dst);
    }
    const w: Worktree = { id: `w_${randomBytes(5).toString("hex")}`, repo: c.repo, path, cwd: join(path, c.sub), branch, base: c.branch, baseSha,
      title, project: b.project ?? null, group: b.group ? String(b.group) : null, label: b.label ? String(b.label).slice(0, 40) : null, links,
      createdAt: iso(), state: "open" };
    all.push(w);
    save();
    return { ...w, uncommittedLeftBehind: c.dirty };
  }

  /** The copy as one tree, uncommitted and untracked files included, without touching its index. */
  async function treeOf(w: Worktree) {
    const idx = join(tmpdir(), `aos-wt-${w.id}-${randomBytes(3).toString("hex")}.idx`);
    const env = { GIT_INDEX_FILE: idx };
    try {
      await git(w.path, ["read-tree", "HEAD"], env);
      await git(w.path, ["add", "-A", "--ignore-errors", "."], env).catch(() => {});
      return (await git(w.path, ["write-tree"], env)).trim();
    } finally { try { rmSync(idx, { force: true }); } catch {} }
  }
  async function files(w: Worktree, tree: string): Promise<WtFile[]> {
    const num = await git(w.path, ["diff-tree", "-r", "-M", "--numstat", "--no-commit-id", w.baseSha, tree]);
    const st = await git(w.path, ["diff-tree", "-r", "-M", "--name-status", "--no-commit-id", w.baseSha, tree]);
    const kinds = new Map<string, WtFile["status"]>();
    for (const l of st.split("\n").filter(Boolean)) {
      const [s, ...ps] = l.split("\t");
      kinds.set(ps.at(-1)!, s[0] === "A" ? "added" : s[0] === "D" ? "deleted" : s[0] === "R" ? "renamed" : "modified");
    }
    return num.split("\n").filter(Boolean).map((l) => {
      const [a, d, ...ps] = l.split("\t");
      const path = ps.join("\t").replace(/^(.*) => (.*)$/, "$2").replace(/\{.*? => (.*?)\}/, "$1");
      return { path, status: kinds.get(path) ?? "modified", add: a === "-" ? 0 : Number(a), del: d === "-" ? 0 : Number(d) };
    });
  }
  async function status(w: Worktree) {
    if (w.state !== "open" || !existsSync(w.path)) return { ...w, files: [] as WtFile[], commits: 0, behind: 0, dirty: 0, missing: w.state === "open" };
    const [fs, counts, dirty] = await Promise.all([
      treeOf(w).then((t) => files(w, t)).catch(() => [] as WtFile[]),
      git(w.path, ["rev-list", "--left-right", "--count", `${w.base ?? w.baseSha}...HEAD`]).catch(() => "0\t0"),
      git(w.path, ["status", "--porcelain"]).then((s) => s.split("\n").filter(Boolean).length).catch(() => 0),
    ]);
    const [behind, commits] = counts.trim().split(/\s+/).map(Number);
    return { ...w, files: fs, commits: commits || 0, behind: behind || 0, dirty, missing: false };
  }
  async function list(q: { all?: boolean; group?: string | null } = {}) {
    const ws = all.filter((w) => (q.all || w.state === "open") && (!q.group || w.group === q.group)).slice(-60);
    return Promise.all(ws.map(status));
  }
  async function diff(id: string, file?: string | null) {
    const w = open(id);
    const tree = await treeOf(w);
    const fs = await files(w, tree);
    const patch = fs.length ? await git(w.path, ["diff-tree", "-p", "-M", "--no-color", "--no-commit-id", "-U3", w.baseSha, tree, ...(file ? ["--", file] : [])]) : "";
    return { files: fs, patch: patch.length > 400_000 ? patch.slice(0, 400_000) + "\n… (cut at 400 KB)" : patch };
  }

  async function commitAll(w: Worktree, message: string) {
    if (!(await git(w.path, ["status", "--porcelain"])).trim()) return false;
    await git(w.path, ["add", "-A"]);
    await git(w.path, ["commit", "-q", "--no-verify", "-m", message]);
    return true;
  }
  async function remove(w: Worktree) {
    await o.beforeRemove?.(w.path);
    // Unlink shared folders first: deleting the copy must never reach into the repo's own node_modules.
    for (const l of w.links) if (existsSync(l)) {
      await run(["cmd", "/c", "rmdir", l], w.repo);
      if (existsSync(l)) throw new ApiError(500, `Couldn't unlink ${l}; left the copy in place.`);
    }
    let last = "";
    for (let i = 0; i < 4; i++) {
      const r = await run(["git", "worktree", "remove", "--force", w.path], w.repo);
      last = (r.err || r.out).trim();
      // "is not a working tree": an earlier try already unregistered it and deleted its files.
      if (r.code === 0 || !existsSync(w.path) || /is not a working tree/i.test(last)) { last = ""; break; }
      await Bun.sleep(1200); // a process that was just stopped may still hold the folder
    }
    if (last) throw new ApiError(409, `Something still has files open in the copy (${last.slice(0, 160)}). Stop its sessions and try again.`);
    // Git deletes the files but can't delete a folder some process still has as its working directory; clear what's left.
    for (let i = 0; i < 4 && existsSync(w.path); i++) {
      try { rmSync(w.path, { recursive: true, force: true }); } catch {}
      if (existsSync(w.path)) await Bun.sleep(1000);
    }
    await run(["git", "worktree", "prune"], w.repo);
    await run(["git", "branch", "-D", w.branch], w.repo);
    return existsSync(w.path) ? `The empty folder ${w.path} is still in use; delete it later.` : null;
  }

  /** Squash the copy onto its base branch in the main folder as one commit, then delete the copy. */
  async function merge(id: string, b: { message?: string } = {}) {
    const w = open(id);
    if (!w.base) throw new ApiError(409, "The repo was on a detached HEAD when the copy was made; merge it by hand.");
    const cur = (await run(["git", "symbolic-ref", "--quiet", "--short", "HEAD"], w.repo)).out.trim();
    if (cur !== w.base) throw new ApiError(409, `Your folder is on ${cur || "a detached HEAD"}, not ${w.base}. Switch back to ${w.base} first.`);
    if ((await run(["git", "diff", "--cached", "--quiet"], w.repo)).code !== 0)
      throw new ApiError(409, `You have staged changes in ${w.repo}. Commit or unstage them first, so they don't end up in this merge.`);
    const message = String(b.message ?? "").trim() || w.title;
    await commitAll(w, `${message} (work in progress from Agentic OS)`);
    if ((await git(w.repo, ["rev-list", "--count", `${w.base}..${w.branch}`])).trim() === "0") throw new ApiError(409, "Nothing to merge: the copy has no changes.");
    const m = await run(["git", "merge", "--squash", w.branch], w.repo);
    if (m.code !== 0) {
      const conflicts = (await run(["git", "diff", "--name-only", "--diff-filter=U"], w.repo)).out.split("\n").filter(Boolean);
      if (conflicts.length) await run(["git", "reset", "--merge"], w.repo);
      throw new ApiError(409, conflicts.length
        ? `Merge conflicts in ${conflicts.slice(0, 5).join(", ")}. Nothing was changed. Ask the agent to rebase on ${w.base}, or merge by hand.`
        : `Git refused the merge: ${(m.err || m.out).trim().split("\n").slice(-2).join(" ").slice(0, 300)}`);
    }
    await git(w.repo, ["commit", "-q", "--no-verify", "-m", message, "-m", `Merged from ${w.branch} by Agentic OS.`]);
    const commit = (await git(w.repo, ["rev-parse", "--short", "HEAD"])).trim();
    w.state = "merged"; w.closedAt = iso(); w.commit = commit;
    save();
    const left = await remove(w).catch((e) => `The copy wasn't deleted: ${String(e.message).slice(0, 160)}`);
    return { worktree: w, commit, note: left };
  }
  async function discard(id: string) {
    const w = open(id);
    const left = await remove(w);
    w.state = "discarded"; w.closedAt = iso();
    save();
    return { worktree: w, note: left };
  }
  /** Push the branch and open a GitHub pull request into the base branch. Needs a remote and the gh CLI. */
  async function pr(id: string, b: { title?: string; body?: string } = {}) {
    const w = open(id);
    if (!(await run(["git", "remote"], w.repo)).out.trim()) throw new ApiError(409, "This repo has no remote to open a pull request on.");
    if (!Bun.which("gh")) throw new ApiError(409, "The GitHub CLI (gh) isn't installed.");
    const title = String(b.title ?? "").trim() || w.title;
    await commitAll(w, title);
    await git(w.path, ["push", "-u", "origin", w.branch]);
    const r = await run(["gh", "pr", "create", "--head", w.branch, ...(w.base ? ["--base", w.base] : []), "--title", title,
      "--body", String(b.body ?? "").trim() || `Work by an Agentic OS agent on \`${w.branch}\`.`], w.path);
    const url = (r.out.match(/https:\/\/\S+/) ?? [])[0];
    if (r.code !== 0 && !url) throw new ApiError(502, `gh: ${(r.err || r.out).trim().slice(0, 300)}`);
    return { url: url ?? null };
  }
  /** Keep one copy of a compare group: merge it, delete the others. */
  async function pick(id: string, b: { message?: string } = {}) {
    const w = open(id);
    const others = all.filter((x) => x.group && x.group === w.group && x.id !== w.id && x.state === "open");
    const merged = await merge(id, b);
    const dropped: string[] = [], failed: { id: string; error: string }[] = [];
    for (const x of others) {
      try { await discard(x.id); dropped.push(x.id); } catch (e) { failed.push({ id: x.id, error: String((e as Error).message) }); }
    }
    return { ...merged, dropped, failed };
  }
  /** The open copy a folder is in, if any. */
  const forFolder = (folder: string) => all.find((w) => w.state === "open" && inside(folder, w.path)) ?? null;
  /** A copy's record in any state, by id or by a folder in it (the newest wins). */
  const record = (id: string) => all.find((w) => w.id === id) ?? null;
  const recordFor = (folder: string) => all.findLast((w) => inside(folder, w.path)) ?? null;
  /** status() plus merged: the branch's work is already in its base (merged here, or by a Builder or by hand). */
  async function progress(id: string) {
    const w = get(id);
    const s = await status(w);
    let merged = w.state === "merged";
    if (!merged && w.state === "open" && w.base) {
      const head = (await run(["git", "rev-parse", "--verify", "--quiet", w.branch], w.repo)).out.trim();
      merged = !!head && head !== w.baseSha && (await run(["git", "merge-base", "--is-ancestor", head, w.base], w.repo)).code === 0;
    }
    return { ...s, merged };
  }
  return { check, create, list, status: (id: string) => status(get(id)), diff, merge, discard, pr, pick, forFolder, record, recordFor, progress };
}
export type Worktrees = ReturnType<typeof openWorktrees>;

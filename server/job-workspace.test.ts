// Real git in a temp folder: what a job gets when it asks for its own copy, and how the copy's stage moves.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorktrees } from "./worktrees";
import { headBranch, openJobWorkspace } from "./job-workspace";

let root: string, repo: string, plain: string, data: string;
const sh = (args: string[], cwd = repo) => {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(String(r.stderr));
  return String(r.stdout).trim();
};
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "aos-jw-"));
  repo = join(root, "proj");
  plain = join(root, "notes");
  data = join(root, "data");
  mkdirSync(repo); mkdirSync(plain); mkdirSync(data);
  writeFileSync(join(repo, "app.js"), "export const a = 1;\n");
  sh(["init", "-q", "-b", "main"]);
  sh(["add", "-A"]);
  sh(["commit", "-qm", "init"]);
});
afterAll(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

test("no folder, a plain folder, and a repo: scratch, folder with a reason, own copy", async () => {
  const wt = openWorktrees({ dataDir: data });
  const ws = openJobWorkspace(wt);
  const a = await ws.prepare({ folder: null, wanted: true, title: "x", project: "p" });
  expect(a.cwd).toBeNull();
  expect(a.rec).toMatchObject({ kind: "scratch", wanted: true });
  expect(a.rec.why).toContain("no folder");
  const b = await ws.prepare({ folder: plain, wanted: true, title: "x", project: null });
  expect(b.rec).toMatchObject({ kind: "folder", wanted: true });
  expect(b.rec.why).toContain("isn't a git repo");
  const c = await ws.prepare({ folder: repo, wanted: false, title: "x", project: null });
  expect(c).toEqual({ cwd: repo, rec: { kind: "folder", wanted: false, worktreeId: null } });
  expect(ws.info(repo, c.rec)).toMatchObject({ kind: "folder", branch: "main" });
});

test("a copy goes copy → changes → committed → merged", async () => {
  const wt = openWorktrees({ dataDir: data });
  const ws = openJobWorkspace(wt);
  const { cwd, rec } = await ws.prepare({ folder: repo, wanted: true, title: "Add b", project: "p" });
  expect(rec.kind).toBe("worktree");
  expect(cwd).not.toBe(repo);
  const w = wt.record(rec.worktreeId!)!;
  expect(headBranch(cwd!)).toBe(w.branch);

  expect(ws.info(cwd!, rec)).toMatchObject({ kind: "worktree", branch: w.branch, stage: null });   // before git answers
  expect((await ws.now(cwd!, rec)).stage).toBe("copy");
  writeFileSync(join(cwd!, "b.js"), "export const b = 2;\n");
  expect(await ws.now(cwd!, rec)).toMatchObject({ stage: "changes", files: 1, add: 1, branch: w.branch, base: "main" });

  sh(["add", "-A"], cwd!);
  sh(["commit", "-qm", "b"], cwd!);
  expect(await ws.now(cwd!, rec)).toMatchObject({ stage: "committed", commits: 1 });

  sh(["merge", "-q", "--ff-only", w.branch]);
  expect((await ws.now(cwd!, rec)).stage).toBe("merged");
  // A fork in the same folder, with no record, is still seen as the copy.
  expect(ws.info(join(cwd!, "."), null).kind).toBe("worktree");
});

test("a scratch folder lists the checkouts an agent made in it", () => {
  const wt = openWorktrees({ dataDir: data });
  const ws = openJobWorkspace(wt);
  const prev = process.env.USERPROFILE;
  process.env.USERPROFILE = root;
  try {
    const job = join(root, "agentic-jobs", "j99");
    mkdirSync(job, { recursive: true });
    sh(["worktree", "add", "-q", "-b", "feat/j99", join(job, "desk")]);
    const info = ws.info(job, { kind: "scratch", wanted: true, why: "The project has no folder set, so there was nothing to copy." });
    expect(info.kind).toBe("scratch");
    expect(info.inner).toEqual([{ name: "desk", branch: "feat/j99", worktree: true }]);
  } finally { process.env.USERPROFILE = prev; }
});

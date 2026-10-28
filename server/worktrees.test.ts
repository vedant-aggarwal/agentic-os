// Real git in a temp folder: copies, the shared node_modules junction, diff, merge, conflicts, compare-pick, discard.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorktrees } from "./worktrees";

let root: string, repo: string, data: string;
const sh = (args: string[], cwd = repo) => {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(String(r.stderr));
  return String(r.stdout).trim();
};
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "aos-wt-"));
  repo = join(root, "proj");
  data = join(root, "data");
  mkdirSync(join(repo, "node_modules", "dep"), { recursive: true });
  mkdirSync(data);
  writeFileSync(join(repo, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  writeFileSync(join(repo, "app.js"), "export const a = 1;\n");
  sh(["init", "-q", "-b", "main"]);
  sh(["add", "-A"]);
  sh(["commit", "-qm", "init"]);
});
afterAll(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

test("check tells repo, branch and uncommitted count", async () => {
  const wt = openWorktrees({ dataDir: data });
  const c = await wt.check(repo);
  expect(c.branch).toBe("main");
  expect(c.dirty).toBe(0);
  expect((await wt.check(root)).repo).toBeNull();
});

test("a copy shares node_modules, shows its changes, and merges back as one commit", async () => {
  const stopped: string[] = [];
  const wt = openWorktrees({ dataDir: data, beforeRemove: async (p) => { stopped.push(p); } });
  const w = await wt.create({ folder: repo, title: "Add b", project: "p" });
  expect(w.branch).toStartWith("aos/add-b-");
  expect(existsSync(join(w.cwd, "node_modules", "dep", "index.js"))).toBe(true);
  writeFileSync(join(w.cwd, "app.js"), "export const a = 1;\nexport const b = 2;\n");
  writeFileSync(join(w.cwd, "b.js"), "export {};\n");
  const s = await wt.status(w.id);
  expect(s.files.map((f) => f.path).sort()).toEqual(["app.js", "b.js"]);
  expect(s.files.some((f) => f.path.includes("node_modules"))).toBe(false);
  const d = await wt.diff(w.id);
  expect(d.patch).toContain("+export const b = 2;");
  const r = await wt.merge(w.id, { message: "Add b" });
  expect(r.commit).toMatch(/^[0-9a-f]{7,}$/);
  expect(sh(["log", "-1", "--format=%s"])).toBe("Add b");
  expect(readFileSync(join(repo, "app.js"), "utf8")).toContain("b = 2");
  expect(existsSync(w.path)).toBe(false);
  // The shared folder survived the copy being deleted.
  expect(existsSync(join(repo, "node_modules", "dep", "index.js"))).toBe(true);
  expect(sh(["branch", "--list", w.branch])).toBe("");
  expect(stopped).toEqual([w.path]);
});

test("a conflicting merge changes nothing and says which files", async () => {
  const wt = openWorktrees({ dataDir: data });
  const w = await wt.create({ folder: repo, title: "Change a" });
  writeFileSync(join(w.cwd, "app.js"), "export const a = 100;\nexport const b = 2;\n");
  writeFileSync(join(repo, "app.js"), "export const a = 5;\nexport const b = 2;\n");
  sh(["commit", "-qam", "main moved"]);
  const head = sh(["rev-parse", "HEAD"]);
  await expect(wt.merge(w.id)).rejects.toThrow(/conflicts in app.js/i);
  expect(sh(["rev-parse", "HEAD"])).toBe(head);
  expect(sh(["status", "--porcelain"])).toBe("");
  expect(existsSync(w.path)).toBe(true);
  await wt.discard(w.id);
  expect(existsSync(w.path)).toBe(false);
});

test("staged changes in the main folder block a merge", async () => {
  const wt = openWorktrees({ dataDir: data });
  const w = await wt.create({ folder: repo, title: "Staged guard" });
  writeFileSync(join(w.cwd, "c.js"), "1\n");
  writeFileSync(join(repo, "mine.txt"), "mine\n");
  sh(["add", "mine.txt"]);
  await expect(wt.merge(w.id)).rejects.toThrow(/staged changes/);
  sh(["reset", "-q", "mine.txt"]);
  rmSync(join(repo, "mine.txt"));
  await wt.discard(w.id);
});

test("compare: pick one copy, the others are deleted", async () => {
  const wt = openWorktrees({ dataDir: data });
  const g = "g_test";
  const a = await wt.create({ folder: repo, title: "Race", group: g, label: "Claude" });
  const b = await wt.create({ folder: repo, title: "Race", group: g, label: "Codex" });
  writeFileSync(join(a.cwd, "race.txt"), "from a\n");
  writeFileSync(join(b.cwd, "race.txt"), "from b\n");
  expect((await wt.list({ group: g })).length).toBe(2);
  const r = await wt.pick(b.id, { message: "Race winner" });
  expect(r.dropped).toEqual([a.id]);
  expect(readFileSync(join(repo, "race.txt"), "utf8").replace(/\r\n/g, "\n")).toBe("from b\n");
  expect(existsSync(a.path) || existsSync(b.path)).toBe(false);
  expect((await wt.list({ group: g })).length).toBe(0);
  // Records survive a restart.
  expect((await openWorktrees({ dataDir: data }).list({ all: true, group: g })).map((x) => x.state).sort()).toEqual(["discarded", "merged"]);
});

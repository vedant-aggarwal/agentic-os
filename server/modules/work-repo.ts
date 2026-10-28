// A project's repository at a glance, for its page in Work.
//   GET /api/v1/mod/work/repo?project=<slug> | ?folder=<full path>
//   → { folder, repo: true, root, branch, upstream, ahead, behind, dirty: [{ path, status }] (max 50), dirtyCount,
//       commits: [{ sha, subject, at }] (last 8), activity: [14 counts, oldest first, today IST last], scripts: [{ name, cmd }] }
//   → { folder, repo: false, scripts } for a folder that isn't in a git repo; 404 when the folder isn't there.
// Read-only git (no optional locks, so `git status` never rewrites the index), 5 s per call; a call that fails leaves
// its field null. scripts: package.json "scripts" in the folder, else at the repo root (max 12). Kept 20 s per folder.
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { ist } from "./scheduler";
import type { ModCtx } from "./types";

type Dirty = { path: string; status: string };
type Commit = { sha: string; subject: string; at: string };
export type RepoInfo =
  | { folder: string; repo: true; root: string; branch: string | null; upstream: string | null; ahead: number | null; behind: number | null;
      dirty: Dirty[] | null; dirtyCount: number | null; commits: Commit[] | null; activity: number[] | null; scripts: { name: string; cmd: string }[] }
  | { folder: string; repo: false; scripts: { name: string; cmd: string }[] };

const GIT_MS = 5_000;
const CACHE_MS = 20_000;
const DAYS = 14;

async function git(cwd: string, args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[k];
  try {
    const p = Bun.spawn(["git", "-c", "core.quotepath=false", ...args], { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe", env });
    const timer = setTimeout(() => p.kill(), GIT_MS);
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    clearTimeout(timer);
    return { ok: code === 0, out, err };
  } catch (e) { return { ok: false, out: "", err: String(e) }; }
}

function scriptsOf(dir: string): { name: string; cmd: string }[] | null {
  try {
    const s = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))?.scripts;
    if (!s || typeof s !== "object") return null;
    const list = Object.entries(s).filter(([, v]) => typeof v === "string").slice(0, 12).map(([name, cmd]) => ({ name, cmd: String(cmd) }));
    return list.length ? list : null;
  } catch { return null; }
}

/** porcelain v1 with -z: "XY path\0", and for a rename or copy "XY new\0old\0". */
export function parseStatus(out: string): Dirty[] {
  const parts = out.split("\0");
  const list: Dirty[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const xy = e.slice(0, 2);
    list.push({ path: e.slice(3), status: xy.trim() || xy });
    if (xy[0] === "R" || xy[0] === "C") i++;
  }
  return list;
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** Commits per IST day for the last 14 days, oldest first, from unix seconds. */
export function activityOf(stamps: number[], now = new Date()) {
  const today = ist(now).date;
  const first = addDays(today, -(DAYS - 1));
  const counts = new Array(DAYS).fill(0);
  for (const s of stamps) {
    const day = ist(new Date(s * 1000)).date;
    if (day < first || day > today) continue;
    counts[Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 864e5)]++;
  }
  return counts;
}

export async function repoInfo(folder: string, now = new Date()): Promise<RepoInfo> {
  const top = await git(folder, ["rev-parse", "--show-toplevel"]);
  const root = top.ok && top.out.trim() ? resolve(top.out.trim()) : null;
  const scripts = scriptsOf(folder) ?? (root && root.toLowerCase() !== folder.toLowerCase() ? scriptsOf(root) : null) ?? [];
  if (!root) return { folder, repo: false, scripts };
  const unborn = (r: { err: string }) => /does not have any commits|unknown revision|bad default revision/i.test(r.err);
  const [branch, upstream, counts, status, log, days] = await Promise.all([
    git(folder, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    git(folder, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
    git(folder, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]),
    git(folder, ["status", "--porcelain=v1", "-z", "--untracked-files=normal"]),
    git(folder, ["log", "-8", "--format=%h%x1f%s%x1f%cI%x1e"]),
    git(folder, ["log", `--since=${DAYS}.days`, "--max-count=5000", "--format=%ct"]),
  ]);
  const [ahead, behind] = counts.ok ? counts.out.trim().split(/\s+/).map(Number) : [NaN, NaN];
  const dirty = status.ok ? parseStatus(status.out) : null;
  const commits = log.ok
    ? log.out.split("\x1e").map((x) => x.trim()).filter(Boolean).map((x) => {
        const [sha, subject, at] = x.split("\x1f");
        return { sha, subject: subject ?? "", at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : at ?? "" };
      })
    : unborn(log) ? [] : null;
  const activity = days.ok ? activityOf(days.out.split("\n").map(Number).filter((n) => n > 0), now) : unborn(days) ? new Array(DAYS).fill(0) : null;
  return {
    folder, repo: true, root, branch: branch.ok ? branch.out.trim() || null : null, upstream: upstream.ok ? upstream.out.trim() || null : null,
    ahead: Number.isFinite(ahead) ? ahead : null, behind: Number.isFinite(behind) ? behind : null,
    dirty: dirty ? dirty.slice(0, 50) : null, dirtyCount: dirty ? dirty.length : null, commits, activity, scripts,
  };
}

const cache = new Map<string, { at: number; value: Promise<RepoInfo> }>();
/** repoInfo, kept CACHE_MS per folder; two pages asking at once share one set of git calls. */
export function cachedRepoInfo(folder: string): Promise<RepoInfo> {
  const key = folder.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  if (cache.size > 64) for (const [k, v] of cache) if (Date.now() - v.at >= CACHE_MS) cache.delete(k);
  const value = repoInfo(folder).catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function repoRoute(ctx: ModCtx) {
  const slug = ctx.url.searchParams.get("project");
  const given = ctx.url.searchParams.get("folder");
  let folder: string;
  if (slug) {
    let row: any = null;
    try { row = ctx.db().query("SELECT slug, folder FROM projects WHERE slug = ?").get(slug); } catch {}
    if (!row) return ctx.fail(404, `No project "${slug}".`);
    if (!row.folder) return ctx.fail(404, "That project has no folder yet.");
    folder = String(row.folder);
  } else if (given) {
    if (!isAbsolute(given)) return ctx.fail(400, "Give the folder's full path.");
    folder = given;
  } else return ctx.fail(400, "Say which: ?project=<slug> or ?folder=<full path>.");
  let isDir = false;
  try { isDir = existsSync(folder) && statSync(folder).isDirectory(); } catch {}
  if (!isDir) return ctx.fail(404, `The folder ${folder} isn't on this PC.`);
  return ctx.json(await cachedRepoInfo(resolve(folder)));
}

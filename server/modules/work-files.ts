// One file of a job's changes, put back (the app's Changes page: Revert one file, and Undo of that).
//   POST /api/v1/mod/work/jobs/:jobId/revert-file   { path, turn? }       → { path, turn, action, undo: { path, blob } }
//   POST /api/v1/mod/work/jobs/:jobId/restore-file  { path, blob|null }   → { path, action, undo: { path, blob } }
// action is "restored", "removed" or "unchanged"; blob null means the file didn't exist.
// The job's checkpoints (server/checkpoints.ts: a private git dir per job whose work tree is the job's folder) hold each
// turn's before and after trees. A revert takes one path from a turn's "before" tree (turn 0 or none: the first turn
// with one, i.e. before the job started) and deletes the file when that tree didn't have it. The file's bytes from just
// before go into the same object store first, so restore-file can put them back exactly. Git always runs on a fresh
// temp index, never the checkpoint's own (the job runner uses it); reads of meta.json only, never writes.
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import type { ModCtx } from "./types";

export class WorkError extends Error { constructor(public status: number, message: string) { super(message); } }
type Ctx = Pick<ModCtx, "db" | "dataDir">;
type Turn = { n: number; before?: string | null; after?: string | null };
type Git = (args: string[], o?: { ok?: number[]; literal?: boolean }) => Promise<{ code: number; bytes: Uint8Array; text: string }>;

const BUSY = new Set(["starting", "running", "needs_input"]);
const MAX_MS = 30_000;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** The job row for "j12" or "12". */
export function jobRow(ctx: Ctx, idIn: string): { id: number; cwd: string | null; status: string } {
  const m = /^j?(\d+)$/i.exec(String(idIn ?? ""));
  const n = m ? Number(m[1]) : 0;
  if (!n) throw new WorkError(404, "No such job.");
  let row: any = null;
  try { row = ctx.db().query("SELECT id, cwd, status FROM jobs WHERE id = ?").get(n); } catch {}
  if (!row) throw new WorkError(404, `No job j${n}.`);
  return row;
}

/** A path from the job's folder, with forward slashes. Refuses full paths, drive letters, `..`, .git and names Windows
 *  can't hold (a `:` would reach an NTFS stream, a trailing dot or space names a different file). */
export function cleanPath(input: unknown): string {
  if (typeof input !== "string" || !input.trim()) throw new WorkError(400, "Say which file: its path inside the job's folder.");
  const s = input.replace(/\\/g, "/");
  if (s.startsWith("/") || /^[A-Za-z]:/.test(s)) throw new WorkError(400, "Give the path from the job's folder, not a full path.");
  const parts = s.split("/").filter((p) => p !== "" && p !== ".");
  if (!parts.length) throw new WorkError(400, "Say which file: its path inside the job's folder.");
  for (const p of parts) {
    if (p === "..") throw new WorkError(400, "The path can't leave the job's folder.");
    if (/^\.git$/i.test(p) || /^git~\d+$/i.test(p)) throw new WorkError(400, "Files inside .git aren't part of a job's changes.");
    if (/[<>:"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))
      throw new WorkError(400, `"${p}" isn't a file name Windows allows.`);
  }
  return parts.join("/");
}

const lower = (p: string) => resolve(p).replace(/[\\/]+$/, "").toLowerCase();
const inside = (p: string, dir: string) => { const a = lower(p), b = lower(dir); return a === b || a.startsWith(b + sep); };

/** The file's full path, checked to stay in the folder: no junction or link on the way may lead out, and no nested
 *  repo (a checkpoint holds another repo as one entry, never its files). */
function fileIn(cwd: string, rel: string) {
  const root = resolve(cwd);
  const abs = resolve(root, rel);
  if (!inside(abs, root) || lower(abs) === lower(root)) throw new WorkError(400, "The path can't leave the job's folder.");
  let near = dirname(abs);
  while (!existsSync(near) && inside(near, root) && lower(near) !== lower(root)) near = dirname(near);
  let real = near, realRoot = root;
  try { real = realpathSync.native(near); realRoot = realpathSync.native(root); } catch {}
  if (!inside(real, realRoot)) throw new WorkError(400, "That path goes through a link out of the job's folder.");
  for (let d = dirname(abs); lower(d) !== lower(root) && inside(d, root); d = dirname(d))
    if (existsSync(join(d, ".git"))) throw new WorkError(409, "That file is in another git repo inside the folder, so the job's checkpoints don't track it.");
  return abs;
}

/** meta.json, the checkpoint store and the folder, or the reason there's nothing to revert from. */
async function checkpointOf(ctx: Ctx, row: { id: number; cwd: string | null }) {
  const file = join(ctx.dataDir, "jobs", `${row.id}.meta.json`);
  let meta: any = null;
  // The runner rewrites meta.json in place; a read that lands mid-write gets one more try.
  for (let i = 0; i < 2 && !meta && existsSync(file); i++) {
    try { meta = JSON.parse(readFileSync(file, "utf8")); } catch { await Bun.sleep(60); }
  }
  if (!meta) throw new WorkError(404, "This job has no checkpoints.");
  if (meta.ckptDropped) throw new WorkError(409, "This job's checkpoints were deleted after it was archived.");
  const gitDir = join(ctx.dataDir, "jobs", "ckpt", `j${row.id}.git`);
  if (!existsSync(join(gitDir, "HEAD"))) throw new WorkError(404, "This job has no checkpoints.");
  if (!row.cwd || !existsSync(row.cwd)) throw new WorkError(404, "The job's folder isn't on this PC any more.");
  return { turns: (Array.isArray(meta.turns) ? meta.turns : []) as Turn[], gitDir, cwd: row.cwd, error: meta.ckptError ? String(meta.ckptError) : null };
}

/** Run fn with git on the job's checkpoint store and a fresh temp index, deleted afterwards. */
async function withGit<T>(gitDir: string, cwd: string, fn: (git: Git) => Promise<T>): Promise<T> {
  const index = join(tmpdir(), `aos-work-${process.pid}-${randomBytes(6).toString("hex")}.index`);
  const git: Git = async (args, o = {}) => {
    const p = Bun.spawn(["git", `--git-dir=${gitDir}`, `--work-tree=${cwd}`, "-c", "core.autocrlf=false", "-c", "core.safecrlf=false",
      "-c", "core.longpaths=true", "-c", "core.quotepath=false", ...args], {
      cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      // literal: a path is a path, never a pattern (ls-tree takes it; check-ignore refuses the flag)
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_INDEX_FILE: index, ...(o.literal ? { GIT_LITERAL_PATHSPECS: "1" } : {}) },
    });
    const timer = setTimeout(() => p.kill(), MAX_MS);
    const [out, err, code] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text(), p.exited]);
    clearTimeout(timer);
    if (!(o.ok ?? [0]).includes(code)) throw new Error(err.trim().split("\n").slice(-2).join(" ").slice(0, 300) || `git exited ${code}`);
    const bytes = new Uint8Array(out);
    return { code, bytes, text: new TextDecoder().decode(bytes) };
  };
  try { return await fn(git); }
  finally { for (const f of [index, `${index}.lock`]) { try { rmSync(f, { force: true }); } catch {} } }
}

const statOf = (abs: string) => { try { return lstatSync(abs); } catch { return null; } };
/** The file's bytes as they are now, into the store, untouched by any filter: the undo copy. */
const saveBytes = async (git: Git, rel: string) => (await git(["hash-object", "-w", "--no-filters", "--", rel])).text.trim();

async function entryOf(git: Git, tree: string, rel: string) {
  let r;
  try { r = await git(["ls-tree", "-z", tree, "--", rel], { literal: true }); }
  catch { throw new WorkError(404, "That turn's checkpoint is missing from the job's store."); }
  for (const line of r.text.split("\0")) {
    const m = /^(\d+) (\w+) ([0-9a-f]+)\t(.*)$/s.exec(line);
    if (m && m[4] === rel) return { mode: m[1], type: m[2], sha: m[3] };
  }
  return null;
}

const fail = (what: string, e: unknown) => {
  if (e instanceof WorkError) return e;
  return new WorkError(500, `Couldn't ${what}: ${String((e as Error)?.message ?? e).slice(0, 240)}`);
};

export async function revertFile(ctx: Ctx, jobId: string, b: any) {
  const row = jobRow(ctx, jobId);
  if (BUSY.has(row.status)) throw new WorkError(409, "Wait for the agent to finish its turn, or stop it.");
  const rel = cleanPath(b?.path);
  const want = b?.turn == null || b.turn === "" ? 0 : Number(b.turn);
  if (!Number.isInteger(want) || want < 0) throw new WorkError(400, "turn is a turn number, or 0 for before the job started.");
  const { turns, gitDir, cwd, error } = await checkpointOf(ctx, row);
  const abs = fileIn(cwd, rel);
  const turn = want > 0 ? turns.find((t) => t.n === want) : turns.find((t) => t.before);
  if (!turn?.before) throw new WorkError(404, error ? `No checkpoint for that turn: ${error}` : "No checkpoint for that turn.");
  const tree = turn.before;
  try {
    return await withGit(gitDir, cwd, async (git) => {
      const entry = await entryOf(git, tree, rel);
      const st = statOf(abs);
      if (st?.isSymbolicLink()) throw new WorkError(409, "That's a link, not a file. Change it on the PC.");
      if (st?.isDirectory() || entry?.type === "tree") throw new WorkError(400, "That's a folder. Revert one file at a time.");
      if (entry && entry.type !== "blob") throw new WorkError(409, "That's another git repo inside the folder; revert it there.");
      // Not in the checkpoint and still here: deleting it is only right when git would have picked it up (not ignored).
      if (!entry && st && (await git(["check-ignore", "-q", "--no-index", "--", rel], { ok: [0, 1] })).code === 0)
        throw new WorkError(409, "Git ignores that file, so the job's checkpoints don't cover it.");
      const blob = st ? await saveBytes(git, rel) : null;
      let action: "restored" | "removed" | "unchanged" = "unchanged";
      if (entry) {
        const now = st ? (await git(["hash-object", "--", rel])).text.trim() : null;
        if (now !== entry.sha) {
          await git(["read-tree", tree]);
          await git(["checkout-index", "-f", "--", rel]);
          action = "restored";
        }
      } else if (st) {
        rmSync(abs, { force: true });
        action = "removed";
      }
      return { path: rel, turn: turn.n, action, undo: { path: rel, blob } };
    });
  } catch (e) { throw fail("put the file back", e); }
}

export async function restoreFile(ctx: Ctx, jobId: string, b: any) {
  const row = jobRow(ctx, jobId);
  if (BUSY.has(row.status)) throw new WorkError(409, "Wait for the agent to finish its turn, or stop it.");
  const rel = cleanPath(b?.path);
  const want = b?.blob ?? null;
  if (want !== null && !(typeof want === "string" && SHA.test(want))) throw new WorkError(400, "blob is the id the revert gave back, or null.");
  const { gitDir, cwd } = await checkpointOf(ctx, row);
  const abs = fileIn(cwd, rel);
  try {
    return await withGit(gitDir, cwd, async (git) => {
      const st = statOf(abs);
      if (st?.isSymbolicLink()) throw new WorkError(409, "That's a link, not a file. Change it on the PC.");
      if (st?.isDirectory()) throw new WorkError(400, "That's a folder. Restore one file at a time.");
      let bytes: Uint8Array | null = null;
      if (want) {
        const t = await git(["cat-file", "-t", want], { ok: [0, 1, 128] });
        if (t.code !== 0 || t.text.trim() !== "blob") throw new WorkError(404, "That saved copy isn't in the job's store any more.");
        bytes = (await git(["cat-file", "blob", want])).bytes;
      }
      const blob = st ? await saveBytes(git, rel) : null;
      let action: "restored" | "removed" | "unchanged" = "unchanged";
      if (bytes && blob !== want) {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, bytes);
        action = "restored";
      } else if (!want && st) {
        rmSync(abs, { force: true });
        action = "removed";
      }
      return { path: rel, action, undo: { path: rel, blob } };
    });
  } catch (e) { throw fail("restore the file", e); }
}

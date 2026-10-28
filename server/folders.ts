// Folder picker for projects: folders under the user profile (two levels), and the folders recent Claude/Codex
// sessions ran in. Owner only; never lists outside the profile.
import { readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { ApiError } from "./store";
import { listSessions, type Session } from "./sessions";

const HOME = process.env.USERPROFILE ?? homedir();
const SKIP = /^(\.|\$|AppData$|Application Data$|Cookies$|Local Settings$|NetHood$|PrintHood$|Recent$|SendTo$|Start Menu$|Templates$|My Documents$|NTUSER|ntuser|node_modules$|__pycache__$|IntelliJIdea|OneDrive - )/;
const lower = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
export const under = (child: string, parent: string) => {
  const c = lower(resolve(child)), p = lower(resolve(parent));
  return c === p || c.startsWith(p + "\\") || c.startsWith(p + "/");
};

function children(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => (d.isDirectory() || d.isSymbolicLink()) && !SKIP.test(d.name))
      .map((d) => join(dir, d.name))
      .filter((p) => { try { return statSync(p).isDirectory(); } catch { return false; } })
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  } catch { return []; }
}

export async function folders(q: { under?: string | null; extra?: string[] }) {
  const root = q.under ? resolve(q.under) : HOME;
  if (!under(root, HOME)) throw new ApiError(400, "Only folders under your user profile.");
  if (!existsSync(root)) throw new ApiError(404, "No such folder.");
  const out: { path: string; name: string; depth: number }[] = [];
  for (const a of children(root)) {
    out.push({ path: a, name: basename(a), depth: 1 });
    for (const b of children(a)) { out.push({ path: b, name: `${basename(a)}\\${basename(b)}`, depth: 2 }); if (out.length > 3000) break; }
    if (out.length > 3000) break;
  }
  let sessions: Session[] = [];
  try { sessions = await listSessions(30, 300); } catch {}
  const seen = new Set<string>(), recent: { path: string; name: string; at: string | null }[] = [];
  for (const p of [...(q.extra ?? []).map((path) => ({ path, at: null as string | null })), ...sessions.map((s) => ({ path: s.cwd, at: s.updatedAt }))]) {
    if (!p.path || seen.has(lower(p.path)) || !existsSync(p.path) || lower(p.path) === lower(HOME)) continue;
    seen.add(lower(p.path));
    recent.push({ path: p.path, name: basename(p.path), at: p.at });
    if (recent.length >= 25) break;
  }
  return { root, folders: out, recent };
}

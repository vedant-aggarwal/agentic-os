// Wyn's own Codex home (DATA_DIR/wyn/codex-home). Her brain is `codex exec` on the owner's ChatGPT login. Run in his
// normal CODEX_HOME, every turn loaded his coding setup: his global AGENTS.md ("always reply in English"), a ~40 KB
// skills list, his plugins' MCP tools, the multi-agent prompts, and the model's code mode, which hid her 130+ tools
// behind a script runner (she spent a step searching for tools in about a third of her turns). Her home holds:
//   auth.json    a link to his (a symlink, else a hard link): one login, one refresh token. Codex rewrites auth.json in
//                place (checked on codex-cli 0.162.1), so a refresh by either side lands in both. A copy would fork the
//                refresh token, and the first refresh on one side would sign the other out.
//   config.toml  her setup: no code mode, multi-agent, skills, plugins, apps, memories, browser, computer use or shell.
//                Her model, effort, MCP server and web search still come as -c flags on each turn (wyn.ts).
//   models.json  his model catalog (models_cache.json) with code mode, multi-agent and tool search taken out: the
//                catalog marks every model code_mode_only, which no feature flag overrides.
// No auth.json of his to link to (signed out, or a keyring login): ensureCodexHome returns null and she runs in his
// home as before.
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Codex features she runs without (names from `codex features list`, codex-cli 0.162.1). */
export const FEATURES_OFF = ["code_mode", "code_mode_only", "multi_agent", "multi_agent_v2", "skill_search", "browser_use", "browser_use_external",
  "computer_use", "apps", "plugins", "memories", "image_generation", "goals", "hooks", "shell_tool"];
/** What the catalog sets per model that she runs without: code mode, sub-agents, and MCP tools deferred behind a search. */
const MODEL_OFF = ["tool_mode", "multi_agent_version", "multi_agent_reasoning_effort"];

/** The owner's Codex home: where his login and model cache live. */
export const ownerCodexHome = () => process.env.WYN_OWNER_CODEX_HOME || process.env.CODEX_HOME || join(homedir(), ".codex");

/** His model catalog with code mode, multi-agent and tool search off, or null when it isn't a catalog. */
export function herCatalog(cache: any) {
  const models = Array.isArray(cache?.models) ? cache.models.filter((m: any) => m && typeof m.slug === "string") : [];
  if (!models.length) return null;
  return { models: models.map((m: any) => { const x = { ...m, supports_search_tool: false }; for (const k of MODEL_OFF) delete x[k]; return x; }) };
}

export function herConfig(catalog: string | null) {
  return [
    "# Wyn's Codex setup, written by Agentic OS (server/wyn-codex.ts) on start; edits here are overwritten.",
    "check_for_update_on_startup = false",
    "include_collaboration_mode_instructions = false",
    ...(catalog ? [`model_catalog_json = ${JSON.stringify(catalog.replace(/\\/g, "/"))}`] : []),
    "",
    "[features]",
    ...FEATURES_OFF.map((f) => `${f} = false`),
    "",
    "[skills]",
    "include_instructions = false",
    "",
    "[skills.bundled]",
    "enabled = false",
    "",
  ].join("\n");
}

const sameFile = (a: string, b: string) => { try { const x = statSync(a), y = statSync(b); return !!x.ino && x.ino === y.ino && x.dev === y.dev; } catch { return false; } };
const writeIfChanged = (f: string, text: string) => { try { if (readFileSync(f, "utf8") === text) return; } catch {} writeFileSync(f, text); };

/** auth.json in her home points at his: a symlink, else a hard link. False when neither can be made. */
function linkAuth(dir: string, owner: string) {
  const src = join(owner, "auth.json"), dst = join(dir, "auth.json");
  if (!existsSync(src)) return false;
  if (sameFile(src, dst)) return true;
  try { lstatSync(dst); rmSync(dst, { force: true }); } catch {}
  try { symlinkSync(src, dst, "file"); return true; } catch {}
  try { linkSync(src, dst); return true; } catch {}
  return false;
}

const built = new Map<string, string>();   // models.json path → the source and mtime it was last built from
/** Her models.json from his models_cache.json (or the one Codex keeps in her home), rebuilt when that changes. */
function writeCatalog(dir: string, owner: string) {
  const out = join(dir, "models.json");
  for (const src of [join(owner, "models_cache.json"), join(dir, "models_cache.json")]) {
    let stamp = "";
    try { stamp = `${src}|${statSync(src).mtimeMs}`; } catch { continue; }
    if (built.get(out) === stamp && existsSync(out)) return out;
    let cat = null;
    try { cat = herCatalog(JSON.parse(readFileSync(src, "utf8"))); } catch {}
    if (!cat) continue;
    writeIfChanged(out, JSON.stringify(cat));
    built.set(out, stamp);
    return out;
  }
  return existsSync(out) ? out : null;
}

/** Makes (or heals) her Codex home and returns its path; null means run in the owner's home instead. Cheap enough per turn. */
export function ensureCodexHome(dir: string, owner = ownerCodexHome()) {
  try {
    mkdirSync(dir, { recursive: true });
    if (!linkAuth(dir, owner)) return null;
    writeIfChanged(join(dir, "config.toml"), herConfig(writeCatalog(dir, owner)));
    return dir;
  } catch (e) {
    console.error("[wyn] codex home", e);
    return null;
  }
}

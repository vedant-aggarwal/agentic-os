import { expect, spyOn, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCodexHome, FEATURES_OFF, herCatalog, herConfig } from "./wyn-codex";
import { openWyn } from "./wyn";
import { setPref } from "./wyn-tools";
import { istDate } from "./store";

const cache = { fetched_at: "2026-10-23T00:00:00Z", models: [
  { slug: "gpt-6.1-sol", tool_mode: "code_mode_only", multi_agent_version: "v2", multi_agent_reasoning_effort: "xhigh", supports_search_tool: true, context_window: 500000 },
  { slug: "gpt-6-luna", tool_mode: "code_mode_only", supports_search_tool: true },
] };
/** An owner's Codex home with a login and a model cache, all in a temp folder. */
function ownerHome() {
  const dir = mkdtempSync(join(tmpdir(), "wyn-owner-codex-"));
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ auth_mode: "chatgpt", tokens: { refresh_token: "r1" } }));
  writeFileSync(join(dir, "models_cache.json"), JSON.stringify(cache));
  return dir;
}

test("her model catalog drops code mode, multi-agent and deferred tool search, and keeps the rest", () => {
  const c = herCatalog(cache)!;
  expect(c.models.map((m: any) => m.slug)).toEqual(["gpt-6.1-sol", "gpt-6-luna"]);
  for (const m of c.models) {
    expect(m.tool_mode).toBeUndefined();
    expect(m.multi_agent_version).toBeUndefined();
    expect(m.supports_search_tool).toBe(false);
  }
  expect(c.models[0].context_window).toBe(500000);
  expect(cache.models[0].tool_mode).toBe("code_mode_only");   // his cache object is untouched
  expect(herCatalog({})).toBeNull();
  expect(herCatalog("not json")).toBeNull();
});

test("her config.toml turns off his coding setup but not the code-mode host her tools would fall back to", () => {
  const t = herConfig("C:\\data\\wyn\\codex-home\\models.json");
  for (const f of ["code_mode", "multi_agent", "skill_search", "browser_use", "computer_use", "plugins", "shell_tool"]) expect(t).toContain(`\n${f} = false`);
  expect(FEATURES_OFF).not.toContain("code_mode_host");   // turning the host off fails code mode closed: no tools at all
  expect(t).toContain("[skills]\ninclude_instructions = false");
  expect(t).toContain("[skills.bundled]\nenabled = false");
  expect(t).toContain('model_catalog_json = "C:/data/wyn/codex-home/models.json"');
  expect(herConfig(null)).not.toContain("model_catalog_json");
});

test("her Codex home shares his login file instead of copying it, and heals a copy", () => {
  const owner = ownerHome(), dir = join(mkdtempSync(join(tmpdir(), "wyn-data-")), "codex-home");
  expect(ensureCodexHome(dir, owner)).toBe(dir);
  const a = statSync(join(owner, "auth.json")), b = statSync(join(dir, "auth.json"));
  expect(b.ino).toBe(a.ino);
  // Codex rewrites auth.json in place on a token refresh: a refresh on either side is the other side's refresh too.
  writeFileSync(join(owner, "auth.json"), JSON.stringify({ tokens: { refresh_token: "r2" } }));
  expect(JSON.parse(readFileSync(join(dir, "auth.json"), "utf8")).tokens.refresh_token).toBe("r2");
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ tokens: { refresh_token: "r3" } }));
  expect(JSON.parse(readFileSync(join(owner, "auth.json"), "utf8")).tokens.refresh_token).toBe("r3");
  const cfg = readFileSync(join(dir, "config.toml"), "utf8");
  expect(cfg).toContain("model_catalog_json");
  expect(JSON.parse(readFileSync(join(dir, "models.json"), "utf8")).models[0].tool_mode).toBeUndefined();
  // A copied auth.json (someone "fixed" it by hand) is put back as a link.
  rmSync(join(dir, "auth.json"));
  writeFileSync(join(dir, "auth.json"), JSON.stringify({ tokens: { refresh_token: "stale" } }));
  expect(ensureCodexHome(dir, owner)).toBe(dir);
  expect(statSync(join(dir, "auth.json")).ino).toBe(statSync(join(owner, "auth.json")).ino);
  expect(lstatSync(join(dir, "auth.json")).isFile() || lstatSync(join(dir, "auth.json")).isSymbolicLink()).toBe(true);
  // No login of his to share (signed out, or kept in the keyring): she stays in his home.
  const empty = mkdtempSync(join(tmpdir(), "wyn-owner-codex-"));
  expect(ensureCodexHome(join(mkdtempSync(join(tmpdir(), "wyn-data-")), "codex-home"), empty)).toBeNull();
});

test("every brain turn runs in her Codex home, and once more in his when hers fails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wyn-codex-wiring-"));
  const saved = { owner: process.env.WYN_OWNER_CODEX_HOME, jev: process.env.WYN_JEV };
  process.env.WYN_OWNER_CODEX_HOME = ownerHome(); process.env.WYN_JEV = "off";
  const user = { id: 778, name: "Fixture", role: "owner", agentos_db: join(dir, "fixture.db") } as any;
  const boot = { today: { date: istDate(), weekday: "Fri", tasks: [], events: [] }, week: { days: [] }, goals: { goals: [] }, areas: [] };
  const runs: { args: string[]; home?: string }[] = [];
  let fail = 0;
  const spawn = spyOn(Bun, "spawn").mockImplementation((args: any, opts: any) => {
    runs.push({ args, home: opts.env?.CODEX_HOME });
    const out = fail-- > 0 ? "" : JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Theek hai." } }) + "\n";
    return { stdout: new Response(out).body, stderr: new Response("config error").body, exited: Promise.resolve(out ? 0 : 1), exitCode: out ? 0 : 1, kill() {} } as any;
  });
  const wyn = openWyn({ dataDir: dir, ai: {} as any, storeFor: () => ({ bootstrap: () => boot }) as any, userById: () => user, owners: () => [] });
  const n = wyn.db(user); setPref(n, "onboard.done", "fixture");
  const turn = () => { const done = new Promise<void>((r) => wyn.onTurn({ done: () => r() })); wyn.send(user, "Kal ka plan?"); return done; };
  try {
    const herHome = join(dir, "wyn", "codex-home");
    expect(readFileSync(join(herHome, "config.toml"), "utf8")).toContain("code_mode = false");   // made on start
    await turn();
    expect(runs[0].home).toBe(herHome);
    expect(runs[0].args).not.toContain("--ignore-user-config");
    // Her home breaks (a Codex update that reads her config differently): the turn still gets an answer, from his.
    runs.length = 0; fail = 1;
    await turn();
    expect(runs.map((r) => r.home ?? "his")).toEqual([herHome, "his"]);
    expect(runs[1].args).toContain("--ignore-user-config");
    expect((n.query("SELECT text FROM messages WHERE role = 'wyn' ORDER BY id DESC LIMIT 1").get() as any).text).toBe("Theek hai.");
  } finally {
    spawn.mockRestore();
    for (const [k, v] of [["WYN_OWNER_CODEX_HOME", saved.owner], ["WYN_JEV", saved.jev]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
    n.close();
  }
});

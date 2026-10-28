// The module registry through the real CLI on a throwaway DB (the same path
// agentos.test.ts takes), plus the rules every registered module must keep:
// unique names, short help, idempotent migrate, user_version left alone.
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULES } from "./index";

const dir = mkdtempSync(join(tmpdir(), "agentos-mods-"));
const dbPath = join(dir, "t.db");
const CLI = join(import.meta.dir, "..", "agentos.ts");
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function cli(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], {
    env: { ...process.env, AGENTOS_DB: dbPath, AGENTOS_EVENTS: join(dir, "none.json"), AGENTOS_CONTENT_DB: join(dir, "content.db") },
  });
  return { text: r.stdout.toString(), code: r.exitCode };
}
const json = (...args: string[]) => JSON.parse(cli(...args, "--json").text);
const sql = (q: string) => {
  const d = new Database(dbPath);
  try { return d.query(q).all() as any[]; } finally { d.close(); }
};
const SLOW = 60_000; // each CLI call spawns bun, which can take seconds on a busy Windows box

describe("module registry", () => {
  test("every module has a unique lowercase name and 1 to 6 help lines naming its command", () => {
    const names = MODULES.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    for (const m of MODULES) {
      expect(m.name).toMatch(/^[a-z][a-z0-9-]*$/);
      const lines = m.help.trim().split("\n");
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(6);
      expect(lines[0]).toContain(`agentos ${m.name}`);
    }
  });

  test("agentos mods lists the registered modules with their first help line", () => {
    const r = json("mods");
    expect(r.count).toBe(MODULES.length);
    expect(r.modules.map((m: any) => m.name)).toEqual(MODULES.map((m) => m.name));
    expect(r.modules.find((m: any) => m.name === "mods").help).toMatch(/^agentos mods \[check\] /);
    const toon = cli("mods").text;
    expect(toon).toContain(`modules[${MODULES.length}]{name,help}:`);
    expect(toon).toContain("help[2]:");
  }, SLOW);

  test("agentos mods check re-runs every migrate and reports the tables each module owns", () => {
    const r = json("mods", "check");
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(MODULES.length);
    expect(r.user_version).toBe(sql("PRAGMA user_version")[0].user_version);
    expect(r.modules.find((m: any) => m.name === "mods")).toEqual({ name: "mods", tables: [], indexes: [] });
    for (const m of r.modules) for (const n of [...m.tables, ...m.indexes]) expect(n.startsWith(`${m.name}_`)).toBe(true);
  }, SLOW);

  test("module migrations are idempotent and never bump user_version", () => {
    expect(cli("mods").code).toBe(0); // the CLI creates the DB: core migrations, then every module's
    const d = new Database(dbPath);
    try {
      const schema = () => JSON.stringify(d.query("SELECT type, name, sql FROM sqlite_master ORDER BY type, name").all());
      const version = () => (d.query("PRAGMA user_version").get() as any).user_version;
      const [before, v] = [schema(), version()];
      for (const m of MODULES) m.migrate(d);
      for (const m of MODULES) m.migrate(d);
      expect(schema()).toBe(before);
      expect(version()).toBe(v);
    } finally {
      d.close();
    }
  }, SLOW);

  test("help has a Modules section; an unknown command is still a usage error (exit 2)", () => {
    const help = cli("help").text;
    expect(help).toContain("\nModules\n");
    for (const m of MODULES) expect(help).toContain(m.help.trim().split("\n")[0]);
    const bad = cli("no-such-command", "--json");
    expect(JSON.parse(bad.text)).toMatchObject({ ok: false });
    expect(bad.code).toBe(2);
  }, SLOW);
});

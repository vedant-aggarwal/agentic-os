// Reference module. `agentos mods` lists the registered modules; `agentos mods check`
// re-runs every module's migrate() and reports the tables and indexes each one owns.
// It owns no tables itself. Copy this file to start a module (details in MODULES.md):
//   1. src/modules/<name>.ts exports `const <name>: Module`; name is the CLI word.
//   2. migrate(): CREATE TABLE IF NOT EXISTS <name>_... and guarded ALTERs; never bump user_version.
//   3. run(): the subcommand is a._[1]; print with ctx.out({...}, [next-step hints]);
//      usage errors are `throw new ctx.UserError("...")`; run may be async.
//   4. One import line and one array entry in src/modules/index.ts, plus <name>.test.ts.
import type { Database } from "bun:sqlite";
import type { ModCtx, Module } from "./types";
// index.ts imports this file and this file reads MODULES from index.ts. The cycle is
// harmless: MODULES is only read inside run(), long after both files have loaded.
import { MODULES } from "./index";

export const mods: Module = {
  name: "mods",
  help: `agentos mods [check]            registered modules; check re-runs every migrate and lists each module's tables`,
  migrate() {
    // Nothing to create: this module only reads sqlite_master.
  },
  run(db, a, ctx) {
    const sub = a._[1];
    if (sub === "check") return check(db, ctx);
    if (sub) throw new ctx.UserError(`Unknown subcommand "${sub}". Use: agentos mods [check]`);
    ctx.out({
      count: MODULES.length,
      modules: MODULES.map((m) => ({ name: m.name, help: m.help.trim().split("\n")[0].replace(/\s+/g, " ") })),
    }, ["agentos mods check", "agentos help  # full help, Modules section"]);
  },
};

/** Names in sqlite_master of one type that start with `<name>_`: the prefix rule every module follows. */
function owned(db: Database, name: string, type: "table" | "index"): string[] {
  const rows = db.query("SELECT name FROM sqlite_master WHERE type = ?1 AND substr(name, 1, length(?2)) = ?2 ORDER BY name")
    .all(type, `${name}_`) as { name: string }[];
  return rows.map((r) => r.name);
}

/** Every migrate() already ran when the DB was opened, so running them again proves they are idempotent.
 *  user_version is read before and after: modules must never bump it (the core owns the schema number). */
function check(db: Database, ctx: ModCtx) {
  const version = () => (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
  const before = version();
  const modules = MODULES.map((m) => {
    m.migrate(db);
    const tables = owned(db, m.name, "table"), indexes = owned(db, m.name, "index");
    // TOON table rows hold scalars, so the lists are joined there; --json keeps the arrays.
    return { name: m.name, tables: ctx.jsonOut ? tables : tables.join(" "), indexes: ctx.jsonOut ? indexes : indexes.join(" ") };
  });
  const after = version();
  if (after !== before) throw new Error(`A module bumped PRAGMA user_version from ${before} to ${after}. Modules never touch it.`);
  ctx.out({ ok: true, checked: modules.length, user_version: after, modules }, ["agentos mods"]);
}

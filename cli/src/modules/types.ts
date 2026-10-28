// The agentos module contract (FOUNDATION.md section 3). A module is one file
// src/modules/<name>.ts exporting a Module, registered in src/modules/index.ts.
// agentos.ts runs every module's migrate() after the core migrations on every
// command, dispatches `agentos <name> ...` to run(), and appends help to its own.
// These shapes are shared with the phone server and desktop agents: change them
// only together with FOUNDATION.md.
import type { Database } from "bun:sqlite";

/** Parsed argv: positionals in `_` (`_[0]` is the module name, `_[1]` the subcommand); `--k v` and bare `--k` land in flags. */
export type Args = { _: string[]; flags: Record<string, string | boolean> };

/** Helpers owned by agentos.ts, handed to run() so a module never imports the core file. */
export type ModCtx = {
  out: (data: any, help?: string[]) => void;       // prints TOON or JSON like every other command
  jsonOut: boolean; str: (a: Args, k: string) => string | undefined;
  istDate: (d?: Date) => string; now: () => Date; iso: (d?: Date) => string;
  UserError: new (m: string) => Error;             // exit 2, printed as a usage error
  dbPath: string;                                  // the agentos.db path in use
  contentDbPath: string;                           // AGENTOS_CONTENT_DB or <dir of dbPath>/content.db
};

export type Module = {
  name: string;                                    // the CLI word: agentos <name> ...
  help: string;                                    // 1 to 6 lines, appended to agentos help
  migrate: (db: Database) => void;                 // idempotent: CREATE TABLE IF NOT EXISTS, guarded ALTERs
  run: (db: Database, a: Args, ctx: ModCtx) => void | Promise<void>;
};

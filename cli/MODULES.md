# agentos modules

A module is one file `src/modules/<name>.ts` that owns the command `agentos <name> ...` and its own `<name>_` tables in `agentos.db`. The contract (`Args`, `ModCtx`, `Module`) is `src/modules/types.ts`, fixed by `FOUNDATION.md` section 3. `src/modules/mods.ts` is the reference module: `agentos mods` lists what is registered, `agentos mods check` re-runs every migration and lists each module's tables.

## Add a module in 6 lines

1. Create `src/modules/<name>.ts`: `import type { Module } from "./types"; export const <name>: Module = { name: "<name>", help, migrate, run };`
2. `help`: 1 to 6 lines in the style of `agentos help`; first line `agentos <name> [sub] ...` padded to column 32, then what it does.
3. `migrate(db)`: idempotent (`CREATE TABLE IF NOT EXISTS <name>_...`, `ALTER` only after checking `PRAGMA table_info`); every table and index starts with `<name>_`; never touch `PRAGMA user_version`.
4. `run(db, a, ctx)`: the subcommand is `a._[1]`, flags come from `ctx.str(a, "flag")` (or `a.flags.x` for booleans); print with `ctx.out({...}, ["next step"])`, writes answer `{ ok: true, ... }`, usage errors are `throw new ctx.UserError("...")`; `run` may be async.
5. Register it: one import line and one array entry in `src/modules/index.ts`.
6. Test it: `src/modules/<name>.test.ts` on a temp DB (copy the `cli()` helper from `mods.test.ts`), then `bun test src` and `bun run build`.

## What `run` gets (`ModCtx`)

| field | what it is |
|---|---|
| `out(data, help?)` | prints TOON, or JSON with `--json`, like every core command; `help` lines are the next-step hints |
| `jsonOut` | true under `--json`; keep arrays then, join them to strings for TOON table rows |
| `str(a, k)` | the string value of `--k`, undefined for a bare flag or none |
| `istDate(d?)`, `now()`, `iso(d?)` | IST calendar date, current time, UTC ISO stamp (what the core stores) |
| `UserError` | throw it for usage errors: exit 2, printed as `error: ...` or `{ ok: false, error }` |
| `dbPath` | the `agentos.db` in use (`AGENTOS_DB` or `~/.agentos/agentos.db`) |
| `contentDbPath` | `AGENTOS_CONTENT_DB` or `content.db` beside `dbPath`; Content OS opens this itself and owns its `content_` tables and `user_version` |

## Rules

- The core runs every module's `migrate` on every command, after its own migrations. A migrate that throws breaks every command, so guard every step.
- Keep core tables read-only from modules unless your brief says otherwise; put module state in `<name>_` tables.
- `--json` works on every module command through `ctx.out`.
- No new dependencies. `bun test src` stays green. `bun run build` makes `dist/agentos.exe`; test it against a copy of the live DB (`test/agentos.db`, ignored by git) with `AGENTOS_DB` set, never against `~/.agentos/agentos.db`.

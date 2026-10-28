# How it works

```
 Phone (Capacitor app)                    Your PC
┌───────────────────────┐   https    ┌──────────────────────────────────────────┐
│ app/  (ES modules)    │  tunnel    │ server/index.ts  (Bun, port 8090)        │
│  offline store + sync ├───────────►│  auth · sync · modules · Wyn · jobs      │
│  native plugins (iOS) │            │        │                │                │
└───────────────────────┘            │        ▼                ▼                │
                                     │  agentos CLI       drivers/             │
                                     │  (cli/, SQLite)    Claude Agent SDK      │
                                     │  ~/.agentos/*.db   Codex app-server      │
                                     │                    git worktrees +       │
                                     │                    checkpoints           │
                                     └──────────────────────────────────────────┘
```

## The pieces

**`cli/` — agentos.** One SQLite file per user holds areas, projects, goals, tasks and the day timeline. Each module in `cli/src/modules/` adds its own tables (prefixed with the module name) and commands. The CLI owns the schema: the server calls it with `--json` for module routes (`/api/v1/mod/<name>/...`), so there is one place where data rules live. AI agents on your PC can use the same commands.

**`server/` — the PC server.**
- `auth.ts`: accounts, sessions and invite codes. The first invite is created on the PC with `bun server/admin.ts invite --owner`.
- `store.ts`: the per-user store the app's offline copy syncs with. Every write carries an `Idempotency-Key`, so a retried write is applied once (`idempotency.ts`).
- `modules/`: one file per area (body, mind, soul, mission, money, growth, people, content, scan, work…), following the contract in `modules/types.ts`.
- `jobs.ts` + `drivers/`: the Work engine. A driver starts an agent and streams its events:
  - `claude-sdk.ts` uses the Claude Agent SDK on your Claude Code sign-in; plan mode turns into an approval card.
  - `codex-app-server.ts` talks to `codex app-server` over stdio.
  - `acp.ts` is the older Agent Client Protocol path, kept as a fallback (`JOB_DRIVER=acp`).
- `checkpoints.ts` snapshots the job's folder in a private git dir before and after each turn, which powers diff and revert. `worktrees.ts` gives each job its own copy.
- `wyn*.ts`: the assistant. `wyn-soul.md` is her persona template, `wyn-tools.ts` her tools, `wyn-policy.ts` what she may do alone versus what needs your OK, `wyn-proactive.ts` her regular checks, `wyn-whatsapp.ts` and `wyn-call.ts` the optional channels.

**`app/` — the phone app.** Plain ES modules with no bundler, so the same files run in a browser, in the iOS app and in the Android app. `app/js/svc/` holds the services (api, sync, store, native bridge). `npm run www` copies `app/` into `www/`, which Capacitor packs into the native apps. Open `index.html?data=demo` to run it on demo data with no server.

**`ios/`, `android/` — native shells.** Capacitor 8 projects. iOS adds widgets, a Live Activity, a share extension and native plugins (Apple Health, Face ID, speech, CallKit). The JS bridge in `app/js/svc/native-plugins.js` falls back to web APIs where a native plugin is missing.

**`plugin/` — Claude Code plugin.** Lets Wyn reach a Claude Code session running on your PC: a hook long-polls the server for a prompt, wakes the session, and posts the reply back to Wyn.

## Trust model

- Wyn acts alone only on low-stakes, reversible changes and reports them with Undo. Money out, new contacts, deletes and anything irreversible wait for your OK (`server/wyn-policy.ts`).
- Agent commands in Work jobs follow the permission you pick per job, with Allow once / Always / Deny on the phone.
- Routes for local agents answer only on loopback and never through a tunnel.

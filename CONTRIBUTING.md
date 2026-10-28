# Contributing

Thanks for taking a look. Small, focused pull requests are easiest to review.

## Before you open a PR

1. `bun install`
2. `bun test server` and `cd cli && bun test src` pass.
3. If you changed the app, open it with `?data=demo` and check the screen you touched at phone width.
4. Never commit real personal data. Demo and test data use the fictional people in `app/js/data-demo.js` (Alex Morgan, Dad, Mom, Rohan, Kabir…) and `example.com` addresses.

## Where things go

- A new life area or tool: one module file in `server/modules/<name>.ts` (contract in `server/modules/types.ts`) and, if it owns tables, one in `cli/src/modules/<name>.ts` (listed once in `cli/src/modules/index.ts`; its `migrate` must be idempotent and its tables prefixed `<name>_`).
- App screens: `app/js/` (plain ES modules, no build step). Styles live in `app/css/` and `app/ui/`.
- Native code: `ios/App/` and `android/app/`. Run `npm run ios` or `npm run android` after changing `app/`.

## Reporting bugs

Open an issue with what you did, what you expected, what happened, and your OS, Bun version and phone. Please remove any personal data from logs first.

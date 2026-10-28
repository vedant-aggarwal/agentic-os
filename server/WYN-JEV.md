# Wyn and Jev follow-through

Wyn now considers practical consequences of each meaningful update: what changed, what existing records it affects, and which useful step she can take. Saving a memory or journal entry is no longer the default end of that reasoning. Her runtime persona applies this to existing users too; the default soul also carries the guidance for new users.

Jev is a typed adviser, not an executor. One request evaluates the available app domains independently and returns probabilities. Up to four domains above 0.7 become advisory leads, with actual available tool names and their `auto`/`ask` modes. Wyn checks current records, exact dates, scope and schemas, then acts under the existing gates. Temporary exceptions must not change an entire recurrence. Suggestions never count as approval.

## Server configuration

Use `server/config.json` (ignored by Git) or environment variables:

- `OPENROUTER_API_KEY`: enables Jev through the existing OpenRouter decisions API (`typesafe/jev-1.13`). Keep the key server-side; never put it in a phone bundle.
- `WYN_JEV`: defaults to `on`; set `off` to skip paid advice.
- `WYN_JEV_INSTRUCTIONS`: optional separate adviser preferences, capped at 1,000 characters. These supplement the fixed adviser rules; conversation stays in the data section.

No key was added or copied during this change. Without one, Wyn still receives the full independent follow-through rules. Missing keys, timeout, rate limits and malformed results do not prevent a normal Wyn reply. Requests have a 2.5-second deadline, no retry and no paid fallback. Successful replies retain provider-reported cost; no invented cost estimates.

## Context and channels

Each chat message (including WhatsApp messages entering Wyn's shared send path) and each user turn of the free voice path consults the adviser. Self-started onboarding and proactive turns do not. Realtime calls receive the same independent rules, and their `ask_wyn` reasoning path consults Jev; direct realtime responses do not run an extra adviser call.

The adviser receives the current message separately, the latest ten turns, up to three relevant older turns selected from the last 80, six ranked durable memories, four unexpired temporary notes, and three day summaries. Free voice adds the ongoing call transcript before selection. This is compact continuity, not the entire chat archive. Earlier details remain available through Wyn's recall tools. Current corrections win over summaries; completed work should not be repeated.

History entries are capped at 240 characters, memories at 3,200 characters and the current message at 4,000. The whole serialized Jev request is capped at 20,000 characters (a character bound, not an exact token guarantee). Advice includes only fixed guidance and allowlisted current tools; provider prose is never injected. No raw conversation or provider errors are logged. The final chat message's `meta.jev` records status, selected domains, latency and reported cost so disabled/unconfigured/unavailable states remain distinguishable from success.

## Verification

`bun test server/wyn-guidance.test.ts server/wyn-guidance-wiring.test.ts server/wyn-policy.test.ts server/agent-tools.test.ts server/wyn-calendar.test.ts server/wyn-call.test.ts`

Tests use synthetic temporary databases and mocked provider replies. They cover bounded history, per-user isolation, expired context, multiple domains, no-op advice, failure/timeout, the real tool catalog and preserved approval gates. The chat wiring test captures Wyn's real prompt construction with a simulated Codex stream, checks history on the next turn, and confirms provider failure still produces a normal chat reply with accurate status. They do not prove live model judgment or an actual calendar cancellation. A live acceptance check after configuring the key should include a temporary availability change, a corrected date, a money update and a vent-only message; inspect the resulting tool receipts and `meta.jev` rather than assuming a model reply proves execution.

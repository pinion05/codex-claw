# Cron Concurrent Execution Design

**Goal:** Allow scheduled cron jobs to execute and deliver Telegram messages at their scheduled time even while an interactive Codex reply is in progress.

**Decision:** Interactive runs are no longer a blocking condition for cron execution or cron delivery.

## Current Behavior

- Cron jobs already execute in fresh Codex threads by calling `codex.runTurn({ threadId: null, ... })`.
- The current runtime explicitly skips due cron jobs when `isInteractiveRunActive()` returns `true`.
- That skip is documented and covered by tests.

## Desired Behavior

- A due cron job must run at its scheduled minute regardless of interactive run state.
- Successful cron jobs must deliver their Telegram completion message immediately, even if the live chat is currently receiving a reply.
- There is no deferred delivery queue and no catch-up behavior for skipped jobs because active interactive runs no longer cause skips.

## Architecture

The smallest viable change is to remove the interactive-run gating from cron dispatch. Cron runtime should continue using fresh threads and existing delivery wiring. The scheduler remains responsible for due-minute detection only; it should not care whether an interactive run is active.

`createRuntimeDeps()` can stop wiring `isInteractiveRunActive` into cron runtime, or keep the dependency optional and unused. `createCronRuntime()` becomes responsible for only two execution gates:

1. no persisted target chat
2. cron execution or delivery failure

Everything else proceeds immediately.

## Risks Accepted By Design

- Cron Telegram messages may interleave with live interactive replies in the same chat.
- Cron and interactive runs share the same process and working directory, so concurrent file edits can race if both turns modify overlapping files.
- These risks are explicitly accepted for this feature because the user requirement is to ignore the active interactive run completely.

## Files Likely Affected

- `src/cron/runtime.ts`
- `src/runtime/create-runtime-deps.ts`
- `tests/integration/cron-runtime.test.ts`
- `tests/integration/cron-loader.test.ts`
- `README.md`
- `tests/smoke/readme.test.ts`

## Test Strategy

- Replace the current skip expectation with a concurrent execution expectation in cron runtime integration coverage.
- Verify that cron still executes in a fresh thread and still delivers immediately.
- Update runtime-deps integration coverage so the cron runtime is no longer wired around interactive state.
- Update README smoke coverage to reflect the new documented behavior.

## Out of Scope

- Serializing concurrent filesystem mutations
- Delayed or buffered cron delivery
- Dedicated cron workspaces
- Per-chat cron routing

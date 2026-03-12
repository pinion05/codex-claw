# Telegram Command Sync Always-On Design

**Date:** 2026-03-12
**Issue:** `#36` feat: make Telegram slash-command sync always-on

## Goal

Telegram slash-command menu synchronization should always be attempted during startup without requiring a feature flag.

## Scope

- Remove the `TELEGRAM_SYNC_COMMANDS` startup gate from runtime configuration.
- Always call Telegram command synchronization during bot startup.
- Keep sync failure non-fatal so the bot can continue starting.
- Update tests and README to match the always-on behavior.

## Non-Goals

- Adding a new opt-out flag
- Refactoring unrelated startup/runtime wiring
- Fixing the unrelated baseline test failures already present on `main`

## Current State

- [src/config.ts](../../src/config.ts) exposes `syncTelegramCommandsOnStartup`.
- [src/index.ts](../../src/index.ts) only calls Telegram sync when that flag is true.
- [README.md](../../README.md) documents `TELEGRAM_SYNC_COMMANDS=1` as the enable switch.

This makes command menu sync optional, which does not match the desired product behavior of "always keep Telegram command suggestions aligned."

## Approaches Considered

### 1. Remove the flag and always sync at startup

Delete the config field and unconditionalize the existing `syncTelegramCommands(bot)` call.

**Pros**
- Behavior matches the feature request exactly
- Lowest long-term maintenance cost
- Keeps the existing non-blocking failure policy intact

**Cons**
- Removes the ability to disable sync in edge-case environments

### 2. Keep a hidden internal flag

Document the feature as always-on while preserving an undocumented escape hatch.

**Pros**
- Easier rollback for maintainers

**Cons**
- Leaves dead-looking configuration paths behind
- Violates the explicit request for always-on behavior

### 3. Fold sync into a deeper startup refactor

Move command sync into a larger startup lifecycle abstraction.

**Pros**
- Could improve startup cohesion later

**Cons**
- Over-scoped for a small behavior change
- Increases regression risk

## Recommended Approach

Choose approach 1: remove the flag and always attempt sync at startup.

This keeps the behavior simple: if the bot starts, it also tries to keep the Telegram slash-command menu current. The existing warning-only failure handling already gives enough safety if Telegram rejects the sync request.

## Data Flow

1. App loads runtime configuration.
2. App creates the Telegram bot instance.
3. App registers handlers.
4. App always fires `syncTelegramCommands(bot)` without awaiting startup on it.
5. Bot startup continues even if sync fails.

## Error Handling

- `setMyCommands` failures remain warning-only.
- The sync call stays non-blocking relative to `bot.start()`.
- No new retry logic is introduced.

## Testing Strategy

### Unit

- `loadConfig()` no longer returns a sync flag.
- Startup always calls `syncTelegramCommands()`.
- Startup still does not wait on sync completion before starting.

### Docs / Smoke

- README no longer advertises an enable flag.
- README states that command sync happens on startup.

## Acceptance Criteria

- No runtime config field or env var controls Telegram command sync.
- Startup always attempts command sync.
- Startup still succeeds when sync hangs or fails.
- Documentation reflects the always-on behavior.

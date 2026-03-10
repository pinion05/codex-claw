# Cron Telegram Delivery Design

## Goal

Deliver scheduled cron job results back into the single persisted Telegram chat without changing cron job JSON schema, while preserving fresh-thread Codex execution and making cron tests deterministic.

## Decisions

- Keep the current single-chat product model. Do not add `chatId` or notify fields to cron job definitions.
- Keep cron Codex execution on `threadId: null`, so scheduled jobs still run in fresh Codex threads.
- Resolve the Telegram target chat through a read-only session lookup, not through `getOrCreate(chatId)`.
- Treat missing target chat as `skip + structured log`, not as a fatal process error and not as a user-visible Telegram error.
- Treat an active interactive run as `skip + structured log`, not as catch-up work for a later minute.
- Split `Codex execution success` from `Telegram delivery success`.
- Disable one-shot jobs after Codex execution succeeds, even if Telegram delivery fails afterward.
- Keep Telegram message formatting outside `src/cron/runtime.ts`.
- Make every cron-related test pass an explicit temporary `codexClawHomeDir` so the real `~/.codex-claw` state never contaminates baseline tests.

## Constraints

- The app currently assumes one persisted Telegram chat, stored in `workspace/state/session.json`.
- `FileSessionStore` currently exposes `getOrCreate(chatId)` but no read-only lookup for background consumers.
- `createRuntimeDeps()` builds runtime dependencies before wiring bot handlers, so Telegram delivery injection must be planned carefully.
- `cron runtime` and `interactive runtime` currently share the same Codex client and workspace.
- Cron success paths do not currently emit structured execution logs, so observability is weaker than the interactive path.

## Architecture

This change stays intentionally smaller than a full shared runtime refactor. The design keeps `agent runtime` and `cron runtime` as separate orchestrators, but narrows the contract between them and the rest of the app.

`createRuntimeDeps()` becomes the composition point for cron delivery behavior. Instead of letting `cron runtime` know how to parse session state or call Telegram APIs directly, it injects a narrow set of cron dependencies:

- `resolveCronTargetChatId(): Promise<bigint | null>`
- `isInteractiveRunActive(): Promise<boolean>`
- `deliverCronResult(chatId: bigint, message: string): Promise<void>`
- `logCronExecution(event): Promise<void> | void`

`src/cron/runtime.ts` remains responsible for schedule detection, reconciliation, ticking, and one-shot lifecycle. It does not own Telegram formatting or session parsing. It only:

1. decides whether a job should attempt execution,
2. runs Codex for that job,
3. disables one-shot jobs after successful Codex execution,
4. emits structured execution/delivery events through injected helpers.

The session layer grows a read-only API, such as `readCurrentSession()` or `getExistingSession()`, so background cron logic can discover the current target chat without accidentally creating a session or tripping chat mismatch validation intended for interactive turns.

Telegram delivery is performed through a small adapter built from `bot.api.sendMessage(...)` in `src/index.ts` and passed into `createRuntimeDeps()`. This avoids pushing Telegram-specific code into cron runtime internals while keeping delivery behavior explicit in startup wiring.

## Data Flow

### Normal successful cron run

1. `cron runtime` receives a due scheduled job.
2. It asks `resolveCronTargetChatId()` for the currently persisted chat target.
3. If no target exists, it logs a `skip` event and stops.
4. It asks `isInteractiveRunActive()`.
5. If an interactive run is active, it logs a `skip` event and stops.
6. It runs Codex with `threadId: null` and the job prompt.
7. If Codex succeeds:
   - write a cron execution log entry,
   - disable the one-shot definition when `date !== null`,
   - format a user-facing Telegram message outside cron runtime,
   - call `deliverCronResult(chatId, message)`,
   - log delivery success or failure separately.

### Missing target chat

1. Cron determines that a job is due.
2. No persisted chat is available from the read-only session lookup.
3. The job is not executed.
4. A structured `skip/no-target-chat` event is logged.
5. The process remains healthy and the user sees no Telegram error.

### Active interactive run

1. Cron determines that a job is due.
2. Target chat exists.
3. Interactive run state is active.
4. Cron skips that scheduled minute and logs `skip/interactive-run-active`.
5. There is no catch-up execution later.

### Codex success, Telegram delivery failure

1. Cron runs the prompt successfully in a fresh Codex thread.
2. Execution is logged as success.
3. One-shot jobs are disabled immediately after Codex success.
4. Telegram delivery throws or returns an error.
5. Cron logs `delivery-failed` with job id, phase, chat id, and thread id where possible.
6. Prompt execution is not retried because the work itself already succeeded.

## Error Handling

- `No target chat`
  - behavior: skip job execution
  - user-visible effect: none
  - log: structured skip event

- `Interactive run active`
  - behavior: skip job execution for that minute
  - user-visible effect: none
  - log: structured skip event

- `Codex execution failure`
  - behavior: do not disable one-shot job
  - user-visible effect: no Telegram success message
  - log: structured execution failure event
  - retry behavior: existing scheduler retry behavior remains intact

- `Telegram delivery failure after Codex success`
  - behavior: keep one-shot disable state if already successful
  - user-visible effect: no Telegram delivery
  - log: structured delivery failure event
  - retry behavior: do not re-run the prompt solely because delivery failed

- `Session file invalid or unreadable`
  - behavior: treat as missing target for cron delivery purposes unless the error indicates broader corruption that should surface via background error reporting
  - user-visible effect: none
  - log: structured skip or background error with phase metadata

## Testing

- Add or update integration tests for:
  - delivery on successful one-shot execution,
  - no disable on Codex failure,
  - disable preserved on delivery failure after Codex success,
  - skip when no target chat exists,
  - skip when an interactive run is active.

- Add unit coverage for the new read-only session API.

- Fix the baseline leak by making every cron runtime/integration test pass an explicit temporary `codexClawHomeDir`.

- Prefer asserting structured cron log payloads or injected logger calls over relying on the real user home directory or runtime log side effects.

## Documentation

Update `README.md` so it explicitly states:

- scheduled jobs still execute in fresh Codex threads,
- successful cron jobs can notify the persisted Telegram chat,
- Telegram delivery failure does not imply the Codex prompt was not executed,
- cron behavior depends on there being a persisted chat target.

## Out of Scope

- Multi-chat cron targeting
- Public cron job schema changes
- Catch-up scheduling for skipped jobs
- Reworking the entire interactive runtime into a shared execution service
- Streaming cron output into Telegram

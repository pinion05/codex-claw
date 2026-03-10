# Telegram Album Coalescing Implementation Plan

> Goal: redesign Telegram attachment intake so one logical upload, including albums grouped by `media_group_id`, becomes one stable local bundle and one Codex turn.

## Scope

This implementation replaces the abandoned draft PR path and targets the architecture described in:

- [2026-03-10-telegram-album-coalescing-sketch.md](/home/pinion/.config/superpowers/worktrees/codex-claw/telegram-album-redesign/docs/plans/2026-03-10-telegram-album-coalescing-sketch.md)

Included:

- single `document` intake
- single `photo` intake
- grouped album coalescing keyed by `chatId + media_group_id`
- transactional bundle publish
- stable bundle metadata with ordering
- one bundle => one Codex turn

Not included:

- bundle replay from Telegram reply chains
- automatic bundle cleanup retention policy
- outbound file sending

## Task 1: Add Bundle Metadata V2

Files:

- Modify: `src/files/telegram-message-bundle.ts`
- Modify: `tests/unit/telegram-message-bundle.test.ts`

Changes:

- add `mediaGroupId?: string | null` to bundle metadata
- add `index` to successful attachment metadata
- add `index` to failed attachment metadata
- update prompt builder to reflect preserved ordering
- keep caption-first prompt contract unchanged

Tests:

- bundle metadata includes `mediaGroupId`
- success attachments keep original order indexes
- failed attachments keep original order indexes
- prompt ordering stays deterministic when earlier attachments fail

Verification:

```bash
bun test tests/unit/telegram-message-bundle.test.ts
```

## Task 2: Replace Direct Writes With Transactional Bundle Publish

Files:

- Modify: `src/files/telegram-message-bundle.ts`
- Modify: `tests/unit/telegram-message-bundle.test.ts`

Changes:

- create a staging dir under inbox root
- write all attachments into staging dir
- write `bundle.json` in staging dir
- atomically rename staging dir to final bundle dir
- add best-effort cleanup for failed staging publishes
- reject or replace existing final dir using explicit behavior

Tests:

- successful publish leaves only final dir
- failed attachment write leaves no final orphan bundle
- manifest write failure leaves no final orphan bundle
- retry against same `messageId` follows explicit conflict rule

Verification:

```bash
bun test tests/unit/telegram-message-bundle.test.ts
```

## Task 3: Add Pending Bundle Collector

Files:

- Create: `src/files/telegram-bundle-collector.ts`
- Create: `tests/unit/telegram-bundle-collector.test.ts`

Changes:

- add collector keyed by `chatId + media_group_id`
- support immediate finalization for non-group uploads
- support quiet-period finalization for grouped uploads
- preserve first message id as bundle id
- preserve late-arriving caption if it appears on a later update before finalization
- keep collector states explicit: `collecting`, `finalizing`, `completed`, `failed`

Tests:

- non-group update finalizes immediately
- grouped photo updates coalesce into one logical bundle
- first message id is preserved as bundle id
- later caption overrides empty caption
- late arrival after finalizing is rejected deterministically

Verification:

```bash
bun test tests/unit/telegram-bundle-collector.test.ts
```

## Task 4: Wire Collector Into Telegram Bot Boundary

Files:

- Modify: `src/bot/create-bot.ts`
- Modify: `tests/integration/create-bot.test.ts`

Changes:

- route `message:document` and `message:photo` through collector input
- remove naive timer fire-and-forget path
- make grouped finalization awaited and error-tracked
- support real Telegram download handling for both single updates and grouped uploads
- keep plain text flow unchanged

Tests:

- single document update => one `runTurn`
- single photo update => one `runTurn`
- photo album => one `runTurn`
- document album, if Telegram emits grouped document updates in test shape => one `runTurn`
- late album item does not create second run
- download failure produces failed attachment metadata instead of fan-out
- plain text follow-up does not re-inject prior bundle

Verification:

```bash
bun test tests/integration/create-bot.test.ts
```

## Task 5: Rebuild Runtime Attachment Preparation Around V2 Metadata

Files:

- Modify: `src/runtime/create-runtime-deps.ts`
- Modify: `tests/integration/cron-loader.test.ts`

Changes:

- merge collector/download failures with storage failures using indexed metadata
- persist merged metadata back into final `bundle.json`
- ensure prompt and stored metadata match exactly

Tests:

- merged failed attachments persist into final `bundle.json`
- prompt and saved metadata show the same ordering/indexes

Verification:

```bash
bun test tests/integration/cron-loader.test.ts
```

## Task 6: Update Docs To Match Logical Upload Model

Files:

- Modify: `README.md`
- Modify: `tests/smoke/readme.test.ts`

Changes:

- document `single attachment or album => one Codex turn`
- document `media_group_id` coalescing
- document bundle path and metadata fields
- clarify that reply/replay is not included yet

Verification:

```bash
bun test tests/smoke/readme.test.ts
```

## Task 7: Full Regression And Review

Files:

- Verify only

Checks:

```bash
bun test
bun run typecheck
```

Review focus:

- collector/finalizer race handling
- bundle publish atomicity
- Telegram boundary correctness
- docs vs implementation parity

## Suggested Execution Strategy

Recommended order:

1. metadata v2
2. transactional publish
3. collector core
4. bot wiring
5. runtime merge path
6. docs
7. full review

This plan deliberately front-loads the storage contract before bot wiring so the Telegram boundary can target a stable bundle API instead of reworking both at once.
